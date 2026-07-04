import { compileMailchimpAdapterHandoff } from './adapter-handoff.mjs';
import { buildMailchimpRecoveryPlan } from './recovery-handoff.mjs';
import { buildMailchimpStatusSnapshot } from './status-handoff.mjs';

const MEMORY_MODES = new Set(['read', 'write', 'append', 'claim']);
const MEMORY_SCOPES = new Set(['tenant', 'workspace', 'campaign', 'audience', 'segment', 'global']);
const VERIFIER_STATES = new Set(['required', 'optional', 'satisfied', 'blocked']);
const CLAIM_STATES = new Set(['draft', 'claimed', 'released', 'conflict']);
const ACTION_MEMORY_DEFAULTS = Object.freeze({
  'audience.sync': ['audience.profile', 'audience.merge_fields', 'audience.tags'],
  'campaign.draft': ['campaign.content', 'campaign.settings'],
  'campaign.schedule': ['campaign.content', 'campaign.schedule', 'provider.sync_cursor'],
  'campaign.pause': ['campaign.state', 'provider.sync_cursor'],
  'campaign.resume': ['campaign.state', 'provider.sync_cursor'],
  'journey.trigger': ['journey.trigger', 'audience.profile'],
  'segment.refresh': ['segment.definition', 'audience.profile'],
  'tag.apply': ['audience.tags', 'audience.profile'],
  'tag.remove': ['audience.tags', 'audience.profile'],
});

function compactString(value) {
  return String(value ?? '').trim();
}

function stableList(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(list.map(compactString).filter(Boolean))].sort();
}

function stableObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.keys(value).sort().reduce((next, key) => {
    const normalizedKey = compactString(key);
    if (!normalizedKey || value[key] === undefined) return next;
    const raw = value[key];
    next[normalizedKey] = Array.isArray(raw)
      ? raw.map((item) => (item && typeof item === 'object' ? stableObject(item) : item))
      : raw && typeof raw === 'object'
        ? stableObject(raw)
        : raw;
    return next;
  }, {});
}

function stableContractString(value) {
  return JSON.stringify(stableObject(value));
}

function stableHash(value) {
  const source = stableContractString(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function parsePrimitive(value) {
  const text = compactString(value);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function parseKeyValueTokens(tokens) {
  return tokens.reduce((next, token) => {
    const separator = token.indexOf('=');
    if (separator === -1) return next;
    const key = compactString(token.slice(0, separator));
    const value = compactString(token.slice(separator + 1));
    if (key) next[key] = parsePrimitive(value);
    return next;
  }, {});
}

function parseMemoryBindingSource(source = '') {
  const lines = compactString(source).split(/\r?\n/);
  const parsed = {
    adapter: 'mailchimp',
    action: '',
    tenant: '',
    workspace: '',
    truth: '',
    capabilities: [],
    memory: [],
    verifier: [],
    claims: [],
    metadata: {},
    diagnostics: [],
  };

  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    const directive = compactString(tokens.shift()).toLowerCase();
    const values = parseKeyValueTokens(tokens);
    const bare = tokens.filter((token) => !token.includes('=')).map(compactString).filter(Boolean);

    if (['adapter', 'action', 'tenant', 'workspace', 'truth'].includes(directive)) {
      parsed[directive] = compactString(bare[0] ?? values.value ?? values[directive]);
    } else if (directive === 'capability' || directive === 'cap') {
      parsed.capabilities.push(...stableList(bare.length > 0 ? bare : values.name || values.value));
    } else if (directive === 'memory' || directive === 'mem') {
      parsed.memory.push({ ...values, ref: compactString(values.ref || values.name || bare[0]) });
    } else if (directive === 'verifier' || directive === 'verify') {
      parsed.verifier.push({ ...values, name: compactString(values.name || values.value || bare[0]) });
    } else if (directive === 'claim') {
      parsed.claims.push({ ...values, name: compactString(values.name || values.value || bare[0]) });
    } else if (directive === 'meta' || directive === 'metadata') {
      parsed.metadata = { ...parsed.metadata, ...values };
    } else {
      parsed.diagnostics.push({
        code: 'mailchimp.memory_binding.unknown_directive',
        severity: 'warning',
        field: `source.line:${lineIndex + 1}`,
        message: `Unknown Mailchimp memory binding directive "${directive}".`,
      });
    }
  }

  return parsed;
}

function normalizeMemoryRef(ref, descriptor, index = 0) {
  const source = typeof ref === 'string' ? { ref } : ref && typeof ref === 'object' ? ref : {};
  const rawRef = compactString(source.ref || source.name || source.key || `memory:${index}`);
  const rawMode = compactString(source.mode || source.access || (source.write ? 'write' : 'read'))
    .toLowerCase()
    .replaceAll('-', '_');
  const rawScope = compactString(source.scope || source.boundary || descriptor.payload?.campaignId && 'campaign' || 'tenant')
    .toLowerCase()
    .replaceAll('-', '_');
  const retentionDays = positiveInteger(source.retentionDays ?? source.ttlDays, 30);
  const pii = source.pii === true || source.classification === 'pii';

  return {
    ref: rawRef,
    mode: MEMORY_MODES.has(rawMode) ? rawMode : 'read',
    scope: MEMORY_SCOPES.has(rawScope) ? rawScope : 'tenant',
    tenant: descriptor.tenant,
    workspace: compactString(source.workspace || descriptor.boundaryContract?.workspace),
    resource: compactString(source.resource || source.resourceId || descriptor.payload?.campaignId || descriptor.payload?.audienceId),
    classification: compactString(source.classification || (pii ? 'pii' : 'operational')) || 'operational',
    pii,
    retentionDays,
    required: source.required !== false,
    restartSafe: source.restartSafe !== false && retentionDays > 0,
  };
}

function normalizeVerifierContract(verifier, descriptor, index = 0) {
  const source = typeof verifier === 'string' ? { name: verifier } : verifier && typeof verifier === 'object' ? verifier : {};
  const rawState = compactString(source.state || (source.satisfied ? 'satisfied' : 'required'))
    .toLowerCase()
    .replaceAll('-', '_');
  const evidenceKey = compactString(source.evidenceKey || source.evidence || source.name || `verifier:${index}`);

  return {
    name: compactString(source.name || source.ref || evidenceKey),
    state: VERIFIER_STATES.has(rawState) ? rawState : 'required',
    required: source.required !== false,
    evidenceKey,
    scope: compactString(source.scope || 'mailchimp') || 'mailchimp',
    blocksExternalWrite: source.blocksExternalWrite !== false && descriptor.dryRun !== true,
  };
}

function normalizeClaim(sourceClaim, descriptor, index = 0) {
  const source = typeof sourceClaim === 'string'
    ? { name: sourceClaim }
    : sourceClaim && typeof sourceClaim === 'object'
      ? sourceClaim
      : {};
  const rawState = compactString(source.state || source.status || 'draft').toLowerCase().replaceAll('-', '_');
  const name = compactString(source.name || source.ref || `claim:${index}`);
  const owner = compactString(source.owner || source.actor || descriptor.boundaryContract?.actor);

  return {
    name,
    state: CLAIM_STATES.has(rawState) ? rawState : 'draft',
    owner,
    tenant: descriptor.tenant,
    action: descriptor.action,
    idempotencyKey: compactString(source.idempotencyKey || descriptor.idempotencyKey),
    memoryRefs: stableList(source.memoryRefs || source.memory || name),
    externalRequestId: compactString(source.externalRequestId || descriptor.externalHandoff?.requestId),
    releaseAfter: compactString(source.releaseAfter || source.expiresAt),
    restartSafe: Boolean(owner || descriptor.idempotencyKey),
  };
}

function normalizeBindingInput(input = {}) {
  const parsed = typeof input === 'string' ? parseMemoryBindingSource(input) : null;
  const raw = parsed || (input && typeof input === 'object' ? input : {});
  const providerJob = raw.providerJob && typeof raw.providerJob === 'object' ? raw.providerJob : {};
  const adapterHandoff = providerJob.adapterHandoff && typeof providerJob.adapterHandoff === 'object'
    ? providerJob.adapterHandoff
    : {};
  return {
    ...raw,
    adapter: compactString(raw.adapter || 'mailchimp') || 'mailchimp',
    action: compactString(raw.action || raw.operation),
    tenant: compactString(raw.tenant || raw.tenantId),
    workspace: compactString(raw.workspace || raw.workspaceId || raw.audienceId),
    truth: compactString(raw.truth || raw.truthBoundary || 'observed') || 'observed',
    capabilities: stableList(raw.capabilities || raw.capability),
    memory: Array.isArray(raw.memory)
      ? raw.memory
      : Array.isArray(raw.memoryRefs)
        ? raw.memoryRefs
        : stableList(raw.memory || raw.memoryRefs),
    verifier: Array.isArray(raw.verifier)
      ? raw.verifier
      : Array.isArray(raw.verifierContracts)
        ? raw.verifierContracts
        : stableList(raw.verifier || raw.verifiers),
    claims: Array.isArray(raw.claims) ? raw.claims : stableList(raw.claim || raw.claims),
    metadata: stableObject(raw.metadata),
    diagnostics: Array.isArray(raw.diagnostics) ? raw.diagnostics : parsed?.diagnostics || [],
    providerRuntimeHandoff: raw.clientRuntimeHandoff && typeof raw.clientRuntimeHandoff === 'object'
      ? raw.clientRuntimeHandoff
      : adapterHandoff.clientRuntimeHandoff && typeof adapterHandoff.clientRuntimeHandoff === 'object'
        ? adapterHandoff.clientRuntimeHandoff
        : providerJob.clientRuntimeHandoff && typeof providerJob.clientRuntimeHandoff === 'object'
          ? providerJob.clientRuntimeHandoff
          : {},
    providerRuntimeBoundary: raw.providerRuntimeBoundary && typeof raw.providerRuntimeBoundary === 'object'
      ? raw.providerRuntimeBoundary
      : raw.runtimeBoundary && typeof raw.runtimeBoundary === 'object'
        ? raw.runtimeBoundary
        : providerJob.runtimeBoundary && typeof providerJob.runtimeBoundary === 'object'
          ? providerJob.runtimeBoundary
          : adapterHandoff.runtimeBoundary && typeof adapterHandoff.runtimeBoundary === 'object'
            ? adapterHandoff.runtimeBoundary
            : providerJob.clientRuntimeHandoff?.handoffGuards?.runtimeBoundary
                && typeof providerJob.clientRuntimeHandoff.handoffGuards.runtimeBoundary === 'object'
            ? providerJob.clientRuntimeHandoff.handoffGuards.runtimeBoundary
              : {},
    operationalHealth: raw.operationalHealth && typeof raw.operationalHealth === 'object'
      ? raw.operationalHealth
      : raw.providerOperationalHealth && typeof raw.providerOperationalHealth === 'object'
        ? raw.providerOperationalHealth
        : adapterHandoff.operationalHealth && typeof adapterHandoff.operationalHealth === 'object'
          ? adapterHandoff.operationalHealth
          : providerJob.operationalHealth && typeof providerJob.operationalHealth === 'object'
            ? providerJob.operationalHealth
            : {},
  };
}

function workspaceForDescriptor(descriptor, input = {}) {
  return compactString(
    input.workspace
      || descriptor.boundaryContract?.workspace
      || descriptor.workspace
      || descriptor.workspaceId
      || descriptor.payload?.workspace
      || descriptor.payload?.workspaceId
      || descriptor.payload?.audienceId,
  );
}

function buildMemoryContract(descriptor, input) {
  const defaults = ACTION_MEMORY_DEFAULTS[descriptor.action] || [];
  const declared = input.memory.length > 0 ? input.memory : defaults;
  const refs = declared.map((ref, index) => normalizeMemoryRef(ref, descriptor, index));
  const mutatingRefs = refs.filter((ref) => ['write', 'append', 'claim'].includes(ref.mode));
  const piiRefs = refs.filter((ref) => ref.pii);
  const partition = [
    'mailchimp',
    descriptor.tenant || 'unknown-tenant',
    workspaceForDescriptor(descriptor, input) || 'all-workspaces',
    descriptor.action || 'unknown-action',
  ].join(':');

  return {
    protocol: 'aios.memory-binding.mailchimp.v1',
    namespace: 'mailchimp',
    partition,
    tenant: descriptor.tenant,
    workspace: workspaceForDescriptor(descriptor, input),
    action: descriptor.action,
    refs,
    summary: {
      totalRefs: refs.length,
      mutatingRefs: mutatingRefs.length,
      piiRefs: piiRefs.length,
      restartSafeRefs: refs.filter((ref) => ref.restartSafe).length,
      writeBlockedByTruth: mutatingRefs.length > 0 && descriptor.truthBoundary?.externalWritesAllowed !== true,
    },
    policy: {
      defaultMode: descriptor.truthBoundary?.externalWritesAllowed ? 'read_write_guarded' : 'read_only',
      piiRequiresVerifier: piiRefs.length > 0,
      retentionDays: refs.reduce((max, ref) => Math.max(max, ref.retentionDays), 0),
      externalWriteSuppressed: descriptor.truthBoundary?.externalWritesAllowed !== true,
      tenantIsolation: descriptor.tenant ? 'tenant_required' : 'tenant_missing',
      workspaceIsolation: workspaceForDescriptor(descriptor, input) ? 'workspace_bound' : 'workspace_unbound',
    },
  };
}

function buildVerifierBinding(descriptor, input, memoryContract) {
  const declared = input.verifier.length > 0
    ? input.verifier
    : descriptor.verifierContracts || [];
  const contracts = declared.map((verifier, index) => normalizeVerifierContract(verifier, descriptor, index));
  const piiRequiresVerifier = memoryContract.policy.piiRequiresVerifier;
  const missingPiiVerifier = piiRequiresVerifier && contracts.length === 0;
  const blocking = contracts.filter((contract) => (
    contract.required
    && contract.blocksExternalWrite
    && contract.state !== 'satisfied'
  ));

  return {
    protocol: 'aios.memory-verifier-binding.mailchimp.v1',
    required: contracts.some((contract) => contract.required) || piiRequiresVerifier,
    contracts,
    missingEvidence: blocking.map((contract) => contract.evidenceKey).sort(),
    satisfied: blocking.length === 0 && !missingPiiVerifier,
    blockedReasons: [
      ...(missingPiiVerifier ? ['pii_memory_requires_verifier'] : []),
      ...blocking.map((contract) => `missing_evidence:${contract.evidenceKey}`),
    ].sort(),
  };
}

function buildCapabilityBinding(descriptor, memoryContract, verifierBinding) {
  const requested = stableList([
    ...(descriptor.capabilities || []),
    ...memoryContract.refs.map((ref) => `memory.${ref.mode}.${ref.scope}`),
    ...(memoryContract.policy.piiRequiresVerifier ? ['memory.pii.verifier'] : []),
  ]);
  const denied = stableList([
    ...(descriptor.truthBoundary?.externalWritesAllowed ? [] : ['external.write']),
    ...(verifierBinding.satisfied ? [] : ['memory.verifier.unsatisfied']),
  ]);

  return {
    protocol: 'aios.memory-capability-binding.mailchimp.v1',
    requested,
    granted: requested.filter((capability) => !denied.includes(capability)).sort(),
    denied,
    externalWritesAllowed: descriptor.truthBoundary?.externalWritesAllowed === true && denied.length === 0,
  };
}

function buildClaimBinding(descriptor, input, memoryContract) {
  const claims = (input.claims.length > 0 ? input.claims : memoryContract.refs
    .filter((ref) => ref.mode === 'claim' || ref.mode === 'write')
    .map((ref) => ({ name: ref.ref, memoryRefs: [ref.ref], owner: descriptor.boundaryContract?.actor })))
    .map((claim, index) => normalizeClaim(claim, descriptor, index));
  const conflicts = claims
    .filter((claim) => claim.state === 'conflict' || !claim.restartSafe)
    .map((claim) => claim.name)
    .sort();

  return {
    protocol: 'aios.memory-claim-binding.mailchimp.v1',
    claims,
    restartSafe: conflicts.length === 0,
    conflicts,
    nextAction: conflicts.length > 0 ? 'resolve_memory_claims' : 'persist_memory_claims',
  };
}

function normalizeScopeGrant(runtime = {}) {
  const source = runtime.memoryScopeLease && typeof runtime.memoryScopeLease === 'object'
    ? runtime.memoryScopeLease
    : runtime.tenantBoundary && typeof runtime.tenantBoundary === 'object'
      ? runtime.tenantBoundary
      : runtime.permissionBoundary && typeof runtime.permissionBoundary === 'object'
        ? runtime.permissionBoundary
        : runtime.accessContext && typeof runtime.accessContext === 'object'
          ? runtime.accessContext
          : {};
  const scope = source.scope && typeof source.scope === 'object' ? source.scope : {};
  const actor = source.actor && typeof source.actor === 'object' ? source.actor : {};
  const grant = source.grant && typeof source.grant === 'object' ? source.grant : {};

  return {
    leaseId: compactString(source.leaseId || source.id || runtime.memoryLeaseId),
    tenant: compactString(source.tenant || source.tenantId || scope.tenant || scope.tenantId || runtime.tenant || runtime.tenantId),
    workspace: compactString(source.workspace || source.workspaceId || scope.workspace || scope.workspaceId || runtime.workspace || runtime.workspaceId),
    actor: compactString(source.actor || source.actorId || actor.id || actor.actorId || runtime.actorId || runtime.operatorId),
    permissions: stableList(source.permissions || grant.permissions || runtime.permissions),
    roles: stableList(source.roles || actor.roles || grant.roles || runtime.roles),
    source: compactString(source.source || grant.source || runtime.permissionSource || 'runtime'),
    policyVersion: compactString(source.policyVersion || grant.policyVersion || runtime.permissionPolicyVersion || '1'),
    issuedAt: compactString(source.issuedAt || source.at || runtime.memoryLeaseIssuedAt),
    expiresAt: compactString(source.expiresAt || source.expiry || runtime.memoryLeaseExpiresAt),
    state: compactString(source.state || source.status || runtime.memoryLeaseState || 'observed').toLowerCase().replaceAll('-', '_'),
  };
}

function normalizeProviderRuntimeBoundary(input = {}, runtime = {}) {
  const source = input.providerRuntimeBoundary && typeof input.providerRuntimeBoundary === 'object'
    ? input.providerRuntimeBoundary
    : runtime.providerRuntimeBoundary && typeof runtime.providerRuntimeBoundary === 'object'
      ? runtime.providerRuntimeBoundary
      : runtime.runtimeBoundary && typeof runtime.runtimeBoundary === 'object'
        ? runtime.runtimeBoundary
        : {};
  const controls = source.controls && typeof source.controls === 'object' ? source.controls : {};
  const handoffBoundary = source.runtimeBoundary && typeof source.runtimeBoundary === 'object' ? source.runtimeBoundary : {};
  const tenant = compactString(source.tenant || handoffBoundary.tenant || runtime.tenant || runtime.tenantId);
  const workspace = compactString(source.workspace || handoffBoundary.workspace || runtime.workspace || runtime.workspaceId);
  const leaseState = compactString(source.leaseState || source.state || handoffBoundary.leaseState || 'observed')
    .toLowerCase()
    .replaceAll('-', '_');
  const missingPermissions = stableList(source.missingPermissions || source.permissions?.missing || handoffBoundary.missingPermissions);
  const digest = compactString(source.digest || handoffBoundary.digest || `fnv1a32:${stableHash({
    tenant,
    workspace,
    leaseId: source.leaseId || handoffBoundary.leaseId,
    policyVersion: source.policyVersion || handoffBoundary.policyVersion,
  })}`);

  return {
    protocol: 'aios.provider-runtime-boundary.mailchimp.v1',
    tenant,
    workspace,
    actorId: compactString(source.actorId || source.actor),
    leaseId: compactString(source.leaseId || handoffBoundary.leaseId),
    leaseState,
    digest,
    auditSink: compactString(source.auditSink || handoffBoundary.auditSink || 'local-runtime-audit'),
    previewAllowed: controls.previewAllowed === true || source.previewAllowed === true || handoffBoundary.previewAllowed === true,
    commitAllowed: controls.commitAllowed === true || source.commitAllowed === true || handoffBoundary.commitAllowed === true,
    leaseActive: controls.leaseActive === true || !['expired', 'revoked', 'blocked'].includes(leaseState),
    missingPermissions,
    nextAction: compactString(source.nextAction || handoffBoundary.nextAction) || (missingPermissions.length ? 'bind-runtime-boundary' : 'review-runtime-boundary'),
  };
}

function normalizeProviderOperationalHealth(input = {}, runtime = {}) {
  const source = input.operationalHealth && typeof input.operationalHealth === 'object'
    ? input.operationalHealth
    : input.providerRuntimeHandoff?.operationalHealth && typeof input.providerRuntimeHandoff.operationalHealth === 'object'
      ? input.providerRuntimeHandoff.operationalHealth
      : runtime.operationalHealth && typeof runtime.operationalHealth === 'object'
        ? runtime.operationalHealth
        : runtime.providerOperationalHealth && typeof runtime.providerOperationalHealth === 'object'
          ? runtime.providerOperationalHealth
          : {};
  const observation = source.observation && typeof source.observation === 'object' ? source.observation : {};
  const retryPlan = source.retryPlan && typeof source.retryPlan === 'object' ? source.retryPlan : {};
  const failureState = source.failureState && typeof source.failureState === 'object' ? source.failureState : {};
  const degradedMode = source.degradedMode && typeof source.degradedMode === 'object' ? source.degradedMode : {};
  const status = compactString(source.status || observation.observedStatus || 'unknown')
    .toLowerCase()
    .replaceAll('-', '_');
  const retryAfterSeconds = positiveInteger(
    retryPlan.nextRetryDelaySeconds ?? retryPlan.retryAfterSeconds ?? observation.retryAfterSeconds,
    0,
  );
  const terminal = failureState.terminal === true
    || status === 'failed_provider_health'
    || status === 'auth_failed'
    || observation.observedStatus === 'auth_failed';
  const circuitOpen = failureState.circuitOpen === true
    || degradedMode.mode === 'local-preview-and-status-only'
    || observation.circuitState === 'open'
    || status === 'degraded_circuit_open';
  const degraded = source.degraded === true
    || degradedMode.enabled === true
    || status.startsWith('degraded')
    || circuitOpen;
  const providerUnavailable = failureState.providerUnavailable === true
    || ['rate_limited', 'unavailable'].includes(observation.observedStatus)
    || status === 'degraded_provider';

  return {
    protocol: 'aios.memory-provider-operational-health.mailchimp.v1',
    status,
    degraded,
    terminal,
    providerUnavailable,
    circuitOpen,
    externalCommitSuppressed: degradedMode.externalCommitSuppressed === true || terminal || circuitOpen || providerUnavailable,
    observation: {
      observedStatus: compactString(observation.observedStatus || status || 'unknown'),
      httpStatus: positiveInteger(observation.httpStatus, 0) || null,
      lastErrorCode: compactString(observation.lastErrorCode),
      checkedAt: compactString(observation.checkedAt),
      consecutiveFailures: positiveInteger(observation.consecutiveFailures, 0),
      circuitState: compactString(observation.circuitState || (circuitOpen ? 'open' : 'closed')),
    },
    retryPlan: {
      mode: compactString(retryPlan.mode || (terminal ? 'do-not-retry-until-provider-repair' : 'bounded-runtime-retry')),
      limit: positiveInteger(retryPlan.limit ?? retryPlan.retryLimit, 3),
      backoff: compactString(retryPlan.backoff || (terminal ? 'none' : 'exponential-with-jitter')),
      retryAfterSeconds,
      retryableIssueCodes: stableList(retryPlan.retryableIssueCodes),
    },
    failureState: {
      statusOnFailure: compactString(failureState.statusOnFailure || (terminal ? 'provider_health_repair_required' : 'needs_operator_review')),
      actionableIssueCodes: stableList(failureState.actionableIssueCodes),
      actionableErrors: Array.isArray(failureState.actionableErrors)
        ? failureState.actionableErrors.map((entry) => stableObject(entry)).filter((entry) => Object.keys(entry).length)
        : [],
    },
    clientStatus: stableObject(source.clientStatus),
  };
}

function scopePermissionAllows(granted, required) {
  if (!required) return true;
  if (granted.includes('*') || granted.includes(required)) return true;
  return granted.some((permission) => {
    if (!permission.endsWith('*')) return false;
    return required.startsWith(permission.slice(0, -1));
  });
}

function buildProviderBoundaryLink(descriptor, input, runtime, memoryContract, scopeLease) {
  const boundary = normalizeProviderRuntimeBoundary(input, runtime);
  const tenantMatches = Boolean(!boundary.tenant || !scopeLease.tenant || boundary.tenant === scopeLease.tenant);
  const workspaceMatches = Boolean(!boundary.workspace || !scopeLease.workspace || boundary.workspace === scopeLease.workspace);
  const providerReady = boundary.leaseActive
    && boundary.previewAllowed !== false
    && boundary.missingPermissions.length === 0
    && tenantMatches
    && workspaceMatches;
  const commitCompatible = memoryContract.summary.mutatingRefs === 0
    || boundary.commitAllowed === true
    || descriptor.truthBoundary?.externalWritesAllowed !== true;
  const blockedReasons = stableList([
    boundary.tenant ? '' : 'provider_boundary_missing_tenant',
    boundary.workspace ? '' : 'provider_boundary_missing_workspace',
    tenantMatches ? '' : 'provider_boundary_tenant_mismatch',
    workspaceMatches ? '' : 'provider_boundary_workspace_mismatch',
    boundary.leaseActive ? '' : 'provider_boundary_lease_inactive',
    ...boundary.missingPermissions.map((permission) => `provider_boundary_missing_permission:${permission}`),
    commitCompatible ? '' : 'provider_boundary_commit_not_allowed',
  ]);

  return {
    protocol: 'aios.memory-provider-boundary-link.mailchimp.v1',
    digest: boundary.digest,
    tenant: boundary.tenant,
    workspace: boundary.workspace,
    leaseId: boundary.leaseId,
    leaseState: boundary.leaseState,
    auditSink: boundary.auditSink,
    providerReady,
    commitCompatible,
    tenantMatches,
    workspaceMatches,
    blockedReasons,
    auditEvent: {
      type: 'mailchimp.memory.provider_boundary.checked',
      tenant: boundary.tenant || scopeLease.tenant,
      workspace: boundary.workspace || scopeLease.workspace,
      memoryPartition: memoryContract.partition,
      leaseId: boundary.leaseId,
      boundaryDigest: boundary.digest,
      allowed: blockedReasons.length === 0,
      restartSafe: true,
    },
    nextAction: blockedReasons.length ? boundary.nextAction : 'dispatch_kernel_job',
  };
}

function buildProviderOperationalHealthLink(descriptor, input, runtime, memoryContract, providerBoundaryLink) {
  const health = normalizeProviderOperationalHealth(input, runtime);
  const mutating = memoryContract.summary.mutatingRefs > 0;
  const canUseLocalPreview = health.terminal !== true
    && (providerBoundaryLink.blockedReasons.length === 0 || health.degraded === true);
  const canDispatchExternalCommit = mutating === false
    || (
      health.externalCommitSuppressed !== true
      && health.terminal !== true
      && providerBoundaryLink.commitCompatible === true
      && providerBoundaryLink.blockedReasons.length === 0
    );
  const blockedReasons = stableList([
    health.terminal ? 'provider_health_terminal' : '',
    health.circuitOpen && mutating ? 'provider_health_circuit_open' : '',
    health.providerUnavailable && mutating ? 'provider_health_unavailable' : '',
    health.externalCommitSuppressed && mutating ? 'provider_health_external_commit_suppressed' : '',
    providerBoundaryLink.blockedReasons.length && canUseLocalPreview === false ? 'provider_boundary_not_ready_for_health_handoff' : '',
  ]);
  const retryable = blockedReasons.length === 0
    ? false
    : health.terminal !== true
      && health.retryPlan.mode !== 'do-not-retry-until-provider-repair';
  const status = blockedReasons.length
    ? retryable
      ? 'retry_scheduled'
      : 'blocked'
    : health.degraded
      ? 'degraded'
      : 'ready';
  const actionCards = buildProviderHealthActionCards(
    health,
    providerBoundaryLink,
    memoryContract,
    blockedReasons,
    retryable,
    canUseLocalPreview,
    canDispatchExternalCommit,
  );

  return {
    protocol: 'aios.memory-provider-health-link.mailchimp.v1',
    status,
    health,
    canUseLocalPreview,
    canDispatchExternalCommit,
    blockedReasons,
    retryable,
    retryPlan: {
      mode: retryable ? health.retryPlan.mode : 'operator-repair-required',
      limit: health.retryPlan.limit,
      backoff: retryable ? health.retryPlan.backoff : 'none',
      retryAfterSeconds: retryable ? health.retryPlan.retryAfterSeconds : 0,
      retryableIssueCodes: health.retryPlan.retryableIssueCodes,
    },
    actionCards,
    retryWindow: {
      scheduled: retryable,
      opensAfterSeconds: retryable ? health.retryPlan.retryAfterSeconds : 0,
      maxAttempts: health.retryPlan.limit,
      backoff: retryable ? health.retryPlan.backoff : 'none',
      issueCodes: retryable
        ? stableList([
          ...health.retryPlan.retryableIssueCodes,
          ...health.failureState.actionableIssueCodes,
        ])
        : [],
    },
    degradedMode: {
      active: health.degraded,
      memoryDispatchMode: canDispatchExternalCommit
        ? 'kernel-dispatch'
        : canUseLocalPreview
          ? 'local-preview-status-only'
          : 'blocked',
      externalCommitSuppressed: health.externalCommitSuppressed,
    },
    auditEvent: {
      type: 'mailchimp.memory.provider_health.checked',
      tenant: providerBoundaryLink.tenant || descriptor.tenant,
      workspace: providerBoundaryLink.workspace || memoryContract.workspace,
      memoryPartition: memoryContract.partition,
      status,
      blockedReasons,
      retryAfterSeconds: retryable ? health.retryPlan.retryAfterSeconds : 0,
      restartSafe: health.terminal !== true,
    },
    nextAction: blockedReasons.length
      ? retryable
        ? 'wait_provider_health_backoff'
        : 'repair_provider_health'
      : health.degraded
        ? 'dispatch_degraded_memory_preview'
        : 'dispatch_kernel_job',
  };
}

function buildProviderHealthActionCards(
  health,
  providerBoundaryLink,
  memoryContract,
  blockedReasons,
  retryable,
  canUseLocalPreview,
  canDispatchExternalCommit,
) {
  const baseCards = [];
  if (blockedReasons.length === 0) {
    baseCards.push({
      key: 'provider-health-ready',
      status: health.degraded ? 'degraded' : 'ready',
      command: health.degraded ? 'memory.preview.dispatch' : 'kernel.job.dispatch',
      label: health.degraded ? 'Dispatch local preview' : 'Dispatch kernel job',
      reason: health.degraded
        ? 'provider is degraded, so external commit remains suppressed'
        : 'provider boundary and operational health checks are ready',
      retryable: false,
    });
  }

  for (const reason of blockedReasons) {
    baseCards.push({
      key: `provider-health:${reason}`,
      status: retryable && reason.startsWith('provider_health') ? 'retryable' : 'blocked',
      command: reason.includes('boundary')
        ? providerBoundaryLink.nextAction
        : retryable
          ? 'memory.provider-health.retry'
          : 'memory.provider-health.repair',
      label: reason.includes('boundary')
        ? 'Repair provider boundary'
        : retryable
          ? 'Retry provider health'
          : 'Repair provider health',
      reason,
      retryable: retryable && reason.startsWith('provider_health'),
    });
  }

  if (health.failureState.actionableErrors.length > 0) {
    for (const error of health.failureState.actionableErrors.slice(0, 5)) {
      baseCards.push({
        key: `provider-error:${compactString(error.code || error.message)}`,
        status: health.terminal ? 'blocked' : 'review',
        command: compactString(error.action || 'memory.provider-health.review'),
        label: compactString(error.label || 'Provider error'),
        reason: compactString(error.message || error.code || 'provider health requires review'),
        retryable: retryable && !health.terminal,
      });
    }
  }

  if (memoryContract.summary.mutatingRefs > 0 && !canDispatchExternalCommit) {
    baseCards.push({
      key: 'external-commit-suppressed',
      status: canUseLocalPreview ? 'degraded' : 'blocked',
      command: canUseLocalPreview ? 'memory.preview.dispatch' : 'memory.commit.review',
      label: canUseLocalPreview ? 'Use local preview' : 'Review external commit',
      reason: 'mutating memory refs cannot dispatch external commit under current provider health',
      retryable,
    });
  }

  return baseCards.slice(0, 10).map((card, index) => ({
    index,
    key: card.key,
    status: card.status,
    command: card.command,
    label: card.label,
    reason: card.reason,
    retryable: Boolean(card.retryable),
    idempotencyKey: `mailchimp:memory-provider-health:${stableHash({
      index,
      key: card.key,
      command: card.command,
      reason: card.reason,
      status: health.status,
      partition: memoryContract.partition,
    })}`,
  }));
}

function buildMemoryScopeLease(descriptor, input, memoryContract, claimBinding, runtime = {}) {
  const grant = normalizeScopeGrant(runtime);
  const tenant = descriptor.tenant || input.tenant;
  const workspace = memoryContract.workspace || workspaceForDescriptor(descriptor, input);
  const mutating = memoryContract.refs.filter((ref) => ['write', 'append', 'claim'].includes(ref.mode));
  const requiredPermissions = stableList([
    tenant ? `tenant.${tenant}.memory` : 'tenant.memory',
    workspace ? `workspace.${workspace}.memory` : '',
    ...mutating.map((ref) => `memory.${ref.mode}.${ref.scope}`),
    claimBinding.claims.length > 0 ? 'memory.claim.persist' : '',
  ]);
  const privileged = grant.roles.some((role) => ['admin', 'owner', 'memory_admin', 'rollback_operator'].includes(role));
  const missingPermissions = requiredPermissions.filter((permission) => !scopePermissionAllows(grant.permissions, permission));
  const tenantMatches = Boolean(!grant.tenant || !tenant || grant.tenant === tenant);
  const workspaceMatches = Boolean(!grant.workspace || !workspace || grant.workspace === workspace);
  const expired = ['expired', 'revoked', 'blocked'].includes(grant.state);
  const canPersist = Boolean(
    tenant
      && tenantMatches
      && workspaceMatches
      && expired === false
      && (missingPermissions.length === 0 || privileged)
      && claimBinding.restartSafe === true
  );
  const leaseId = grant.leaseId || `mailchimp.memory:${tenant || 'tenant'}:${workspace || 'workspace'}:${stableHash({
    partition: memoryContract.partition,
    claims: claimBinding.claims.map((claim) => claim.name),
  })}`;

  return {
    protocol: 'aios.memory-scope-lease.mailchimp.v1',
    leaseId,
    state: canPersist ? 'active' : expired ? grant.state : 'held',
    canPersist,
    source: grant.source,
    policyVersion: grant.policyVersion,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
    tenant,
    workspace,
    actor: grant.actor,
    partition: memoryContract.partition,
    refs: memoryContract.refs.map((ref) => ({
      ref: ref.ref,
      mode: ref.mode,
      scope: ref.scope,
      tenant: ref.tenant,
      workspace: ref.workspace || workspace,
      restartSafe: ref.restartSafe,
    })),
    permissions: {
      required: requiredPermissions,
      granted: grant.permissions,
      missing: missingPermissions,
      privileged,
    },
    checks: [
      {
        code: 'mailchimp.memory_scope.tenant',
        ok: Boolean(tenant) && tenantMatches,
        severity: tenant && tenantMatches ? 'info' : 'error',
        message: tenant
          ? tenantMatches
            ? 'Memory lease tenant matches the runtime scope.'
            : 'Memory lease tenant does not match the runtime scope.'
          : 'Memory lease requires a tenant partition.',
      },
      {
        code: 'mailchimp.memory_scope.workspace',
        ok: workspaceMatches,
        severity: workspaceMatches ? 'info' : 'warning',
        message: workspaceMatches
          ? 'Memory lease workspace matches the runtime scope.'
          : 'Memory lease workspace does not match the runtime scope.',
      },
      {
        code: 'mailchimp.memory_scope.permissions',
        ok: missingPermissions.length === 0 || privileged,
        severity: missingPermissions.length === 0 || privileged ? 'info' : 'error',
        message: missingPermissions.length === 0 || privileged
          ? 'Memory lease permissions cover declared refs and claims.'
          : `Memory lease is missing permissions: ${missingPermissions.join(', ')}.`,
      },
      {
        code: 'mailchimp.memory_scope.restart_safe_claims',
        ok: claimBinding.restartSafe === true,
        severity: claimBinding.restartSafe === true ? 'info' : 'error',
        message: claimBinding.restartSafe === true
          ? 'Memory claims can be resumed across restart.'
          : 'Memory claims must be resolved before restart-safe persistence.',
      },
    ],
    persistedStateKey: [
      'mailchimp',
      tenant || 'unknown-tenant',
      workspace || 'all-workspaces',
      'memory',
      leaseId,
    ].join(':'),
    nextAction: canPersist ? 'persist_memory_scope_lease' : 'resolve_memory_scope_lease',
  };
}

function buildKernelJobBinding(descriptor, memoryContract, capabilityBinding, verifierBinding, claimBinding, scopeLease, providerBoundaryLink, providerHealthLink) {
  const blockedReasons = [
    ...(capabilityBinding.denied || []).map((capability) => `capability_denied:${capability}`),
    ...verifierBinding.blockedReasons,
    ...claimBinding.conflicts.map((claim) => `claim_conflict:${claim}`),
    ...(scopeLease?.canPersist === true ? [] : ['scope_lease_held']),
    ...(providerBoundaryLink?.blockedReasons || []),
    ...(providerHealthLink?.blockedReasons || []),
  ].sort();
  const memoryHash = stableHash({
    requestId: descriptor.requestId,
    memory: memoryContract.refs,
    capabilities: capabilityBinding.requested,
    verifier: verifierBinding.contracts,
    claims: claimBinding.claims,
  });

  return {
    protocol: 'aios.memory-kernel-job.mailchimp.v1',
    type: 'KernelJobMemoryBinding',
    requestId: descriptor.requestId,
    tenant: descriptor.tenant,
    workspace: memoryContract.workspace,
    action: descriptor.action,
    adapter: 'mailchimp',
    memoryHash,
    dispatchable: blockedReasons.length === 0 && descriptor.diagnostics?.every((item) => item.severity !== 'error') !== false,
    blockedReasons,
    idempotencyKey: descriptor.idempotencyKey || `mailchimp:memory:${memoryHash}`,
    scopeLease: {
      leaseId: scopeLease?.leaseId || '',
      state: scopeLease?.state || 'unbound',
      canPersist: scopeLease?.canPersist === true,
      persistedStateKey: scopeLease?.persistedStateKey || '',
      nextAction: scopeLease?.nextAction || 'resolve_memory_scope_lease',
    },
    providerBoundary: {
      digest: providerBoundaryLink?.digest || '',
      tenant: providerBoundaryLink?.tenant || '',
      workspace: providerBoundaryLink?.workspace || '',
      leaseId: providerBoundaryLink?.leaseId || '',
      providerReady: providerBoundaryLink?.providerReady === true,
      commitCompatible: providerBoundaryLink?.commitCompatible === true,
      auditSink: providerBoundaryLink?.auditSink || '',
      nextAction: providerBoundaryLink?.nextAction || 'bind-runtime-boundary',
    },
    providerHealth: {
      status: providerHealthLink?.status || 'unknown',
      degraded: providerHealthLink?.health?.degraded === true,
      terminal: providerHealthLink?.health?.terminal === true,
      retryable: providerHealthLink?.retryable === true,
      retryAfterSeconds: providerHealthLink?.retryPlan?.retryAfterSeconds || 0,
      nextAction: providerHealthLink?.nextAction || 'review_provider_health',
    },
    handoff: {
      externalState: descriptor.externalHandoff?.state || 'local_only',
      externalRequestId: descriptor.externalHandoff?.requestId || '',
      truthLevel: descriptor.truthBoundary?.level || 'unknown',
    },
  };
}

function normalizeClientRuntimeHandoff(input = {}, runtime = {}, descriptor = {}) {
  const source = input.providerRuntimeHandoff && typeof input.providerRuntimeHandoff === 'object'
    ? input.providerRuntimeHandoff
    : runtime.clientRuntimeHandoff && typeof runtime.clientRuntimeHandoff === 'object'
      ? runtime.clientRuntimeHandoff
      : {};
  const requestState = source.requestState && typeof source.requestState === 'object' ? source.requestState : {};
  const workflowHandoff = source.workflowHandoff && typeof source.workflowHandoff === 'object' ? source.workflowHandoff : {};
  const retryPolicy = source.retryPolicy && typeof source.retryPolicy === 'object' ? source.retryPolicy : {};
  const required = stableList(source.requiredClientState || ['requestId', 'workflowId', 'workflowStep']);
  const requestId = compactString(requestState.requestId || runtime.requestId || descriptor.requestId);
  const workflowId = compactString(requestState.workflowId || runtime.workflowId || descriptor.workflowId);
  const workflowStep = compactString(requestState.workflowStep || runtime.workflowStep || descriptor.workflowStep);
  const missingFields = stableList([
    ...(Array.isArray(requestState.missingFields) ? requestState.missingFields : []),
    ...required.filter((field) => {
      if (field === 'requestId') return !requestId;
      if (field === 'workflowId') return !workflowId;
      if (field === 'workflowStep') return !workflowStep;
      return !compactString(requestState[field] || runtime[field]);
    }),
  ]);

  return {
    protocol: 'aios.memory-client-runtime-handoff.mailchimp.v1',
    status: compactString(source.status || (missingFields.length ? 'needs_client_state' : 'ready_for_client_handoff')),
    requestState: {
      requestId,
      workflowId,
      workflowStep,
      conversationId: compactString(requestState.conversationId || runtime.conversationId),
      userMessageId: compactString(requestState.userMessageId || runtime.userMessageId),
      clientVisibleStatus: compactString(requestState.clientVisibleStatus || runtime.clientVisibleStatus || 'memory_binding_review'),
      missingFields,
    },
    workflowHandoff: {
      handoffStatus: compactString(workflowHandoff.handoffStatus || runtime.handoffStatus || 'not_started'),
      adapterRunId: compactString(workflowHandoff.adapterRunId || runtime.adapterRunId),
      resumeToken: compactString(workflowHandoff.resumeToken || runtime.resumeToken),
      continuationKey: compactString(workflowHandoff.continuationKey || runtime.continuationKey),
      nextClientAction: compactString(workflowHandoff.nextClientAction || source.nextClientAction || 'review-memory-binding'),
    },
    retryPolicy: {
      retryable: retryPolicy.retryable !== false,
      retryLimit: positiveInteger(retryPolicy.retryLimit ?? runtime.retryLimit, 3),
      backoff: compactString(retryPolicy.backoff || 'exponential-with-jitter'),
      retryableIssueCodes: stableList(retryPolicy.retryableIssueCodes),
      blockedIssueCodes: stableList(retryPolicy.blockedIssueCodes),
    },
    handoffGuards: stableObject(source.handoffGuards),
  };
}

function buildRuntimeAdoptionHealth(binding, clientRuntimeHandoff, diagnostics) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
  const missingClientState = clientRuntimeHandoff.requestState.missingFields;
  const blockedIssueCodes = stableList([
    ...errors.map((diagnostic) => diagnostic.code),
    ...clientRuntimeHandoff.retryPolicy.blockedIssueCodes,
  ]);
  const retryable = clientRuntimeHandoff.retryPolicy.retryable
    && blockedIssueCodes.length === 0
    && binding.kernelJob.blockedReasons.length === 0;
  const degraded = warnings.length > 0
    || missingClientState.length > 0
    || clientRuntimeHandoff.status !== 'ready_for_client_handoff';
  const status = errors.length
    ? 'blocked'
    : missingClientState.length
      ? 'needs_client_state'
      : binding.kernelJob.dispatchable && clientRuntimeHandoff.status === 'ready_for_client_handoff'
        ? 'ready'
        : degraded
          ? 'degraded'
          : 'ready';

  return {
    protocol: 'aios.memory-runtime-adoption-health.mailchimp.v1',
    status,
    degraded,
    retryable,
    nextAction: status === 'ready'
      ? 'dispatch_kernel_job'
      : missingClientState.length
        ? 'bind-client-runtime-state'
        : clientRuntimeHandoff.workflowHandoff.nextClientAction || 'repair_memory_binding',
    missingClientState,
    blockedIssueCodes,
    warningIssueCodes: warnings.map((diagnostic) => diagnostic.code).sort(),
    retryPlan: {
      mode: retryable ? 'bounded-runtime-retry' : 'operator-repair-required',
      limit: clientRuntimeHandoff.retryPolicy.retryLimit,
      backoff: retryable ? clientRuntimeHandoff.retryPolicy.backoff : 'none',
      retryableIssueCodes: clientRuntimeHandoff.retryPolicy.retryableIssueCodes,
    },
    handoff: {
      continuationKey: clientRuntimeHandoff.workflowHandoff.continuationKey,
      handoffStatus: clientRuntimeHandoff.workflowHandoff.handoffStatus,
      adapterRunId: clientRuntimeHandoff.workflowHandoff.adapterRunId,
      resumeToken: clientRuntimeHandoff.workflowHandoff.resumeToken,
      nextClientAction: clientRuntimeHandoff.workflowHandoff.nextClientAction,
    },
  };
}

function validateMemoryBinding(binding) {
  const diagnostics = [];
  if (binding.adapterHandoff.adapter !== 'mailchimp') {
    diagnostics.push({
      code: 'mailchimp.memory_binding.adapter_mismatch',
      severity: 'error',
      field: 'adapter',
      message: 'Mailchimp memory bindings require a Mailchimp adapter handoff.',
    });
  }
  if (!binding.adapterHandoff.tenant) {
    diagnostics.push({
      code: 'mailchimp.memory_binding.missing_tenant',
      severity: 'error',
      field: 'tenant',
      message: 'Mailchimp memory bindings require a tenant partition.',
    });
  }
  if (binding.scopeLease?.canPersist !== true) {
    diagnostics.push({
      code: 'mailchimp.memory_binding.scope_lease_held',
      severity: 'error',
      field: 'scopeLease',
      message: 'Mailchimp memory binding requires an active tenant/workspace scope lease before persistence.',
    });
  }
  for (const reason of binding.providerBoundaryLink?.blockedReasons || []) {
    diagnostics.push({
      code: `mailchimp.memory_binding.${reason.split(':')[0]}`,
      severity: reason.includes('missing_permission') ? 'error' : 'error',
      field: 'providerBoundaryLink',
      message: `Mailchimp memory binding provider boundary is not ready: ${reason}.`,
    });
  }
  for (const reason of binding.providerHealthLink?.blockedReasons || []) {
    diagnostics.push({
      code: `mailchimp.memory_binding.${reason.split(':')[0]}`,
      severity: binding.providerHealthLink?.retryable === true ? 'warning' : 'error',
      field: 'providerHealthLink',
      message: `Mailchimp memory binding provider health is not ready: ${reason}.`,
    });
  }
  if (binding.memory.refs.length === 0) {
    diagnostics.push({
      code: 'mailchimp.memory_binding.empty_memory_contract',
      severity: 'warning',
      field: 'memory',
      message: 'No Mailchimp memory refs were declared or inferred for this action.',
    });
  }
  for (const ref of binding.memory.refs) {
    if (!ref.ref) {
      diagnostics.push({
        code: 'mailchimp.memory_binding.missing_ref',
        severity: 'error',
        field: 'memory.ref',
        message: 'Each Mailchimp memory binding ref requires a stable ref value.',
      });
    }
  }
  for (const reason of binding.kernelJob.blockedReasons) {
    const retryableProviderHealth = reason.startsWith('provider_health')
      && binding.providerHealthLink?.retryable === true;
    diagnostics.push({
      code: `mailchimp.memory_binding.${reason.split(':')[0]}`,
      severity: reason.startsWith('capability_denied:external.write') || retryableProviderHealth ? 'warning' : 'error',
      field: 'kernelJob.blockedReasons',
      message: `Mailchimp memory binding blocked kernel dispatch: ${reason}.`,
    });
  }
  for (const check of binding.scopeLease?.checks || []) {
    if (check.ok === false) {
      diagnostics.push({
        code: check.code,
        severity: check.severity,
        field: 'scopeLease',
        message: check.message,
      });
    }
  }
  return diagnostics.sort((left, right) => left.code.localeCompare(right.code));
}

function buildStatusRuntime(runtime, binding) {
  const supplied = runtime && typeof runtime === 'object' ? runtime : {};
  const verifierEvidence = { ...(supplied.verifierEvidence || {}) };
  for (const contract of binding.verifier.contracts) {
    if (contract.state === 'satisfied') verifierEvidence[contract.name] = true;
  }
  return {
    ...supplied,
    verifierEvidence,
    memoryBinding: {
      protocol: binding.protocol,
      memoryHash: binding.kernelJob.memoryHash,
      blockedReasons: binding.kernelJob.blockedReasons,
      claimRestartSafe: binding.claims.restartSafe,
      scopeLeaseId: binding.scopeLease?.leaseId || '',
      scopeLeaseState: binding.scopeLease?.state || 'unbound',
      persistedStateKey: binding.scopeLease?.persistedStateKey || '',
      providerBoundaryDigest: binding.providerBoundaryLink?.digest || '',
      providerBoundaryReady: binding.providerBoundaryLink?.blockedReasons?.length === 0,
      providerBoundaryAuditSink: binding.providerBoundaryLink?.auditSink || '',
      providerHealthStatus: binding.providerHealthLink?.status || '',
      providerHealthRetryAfterSeconds: binding.providerHealthLink?.retryPlan?.retryAfterSeconds || 0,
      clientRuntimeStatus: binding.clientRuntimeHandoff?.status || '',
      clientRuntimeNextAction: binding.runtimeAdoptionHealth?.nextAction || '',
    },
  };
}

function countBySeverity(diagnostics = []) {
  return diagnostics.reduce((counts, diagnostic) => {
    const severity = compactString(diagnostic.severity || 'unknown') || 'unknown';
    counts[severity] = (counts[severity] || 0) + 1;
    return counts;
  }, {});
}

function buildMemoryTimelineEvent(index, phase, status, detail = {}) {
  return {
    index,
    phase,
    status,
    at: compactString(detail.at),
    code: compactString(detail.code),
    action: compactString(detail.action),
    message: compactString(detail.message),
    restartSafe: detail.restartSafe !== false,
    digest: `fnv1a32:${stableHash({
      index,
      phase,
      status,
      code: detail.code,
      action: detail.action,
      message: detail.message,
      at: detail.at,
    })}`,
  };
}

function buildMemoryBindingTimeline(binding, runtimeAdoptionHealth, status, recovery, diagnostics) {
  const events = [
    buildMemoryTimelineEvent(0, 'compile', binding.kernelJob.dispatchable ? 'dispatchable' : 'blocked', {
      message: binding.kernelJob.dispatchable
        ? 'Kernel memory job can be dispatched after runtime adoption checks.'
        : 'Kernel memory job is blocked by capabilities, verifier, claim, or lease state.',
      action: binding.kernelJob.dispatchable ? 'dispatch_kernel_job' : 'repair_memory_binding',
      restartSafe: binding.claims.restartSafe,
    }),
    buildMemoryTimelineEvent(1, 'scope-lease', binding.scopeLease.canPersist ? 'active' : binding.scopeLease.state, {
      action: binding.scopeLease.nextAction,
      message: binding.scopeLease.canPersist
        ? 'Tenant/workspace memory scope can persist declared refs.'
        : 'Tenant/workspace memory scope must be repaired before persistence.',
      restartSafe: binding.scopeLease.canPersist,
    }),
    buildMemoryTimelineEvent(2, 'client-runtime', runtimeAdoptionHealth.status, {
      action: runtimeAdoptionHealth.nextAction,
      message: runtimeAdoptionHealth.missingClientState.length
        ? `Missing client runtime state: ${runtimeAdoptionHealth.missingClientState.join(', ')}.`
        : 'Client runtime handoff is bound to the memory contract.',
      restartSafe: runtimeAdoptionHealth.status !== 'blocked',
    }),
    buildMemoryTimelineEvent(3, 'status-handoff', status.readiness?.ready === false ? 'blocked' : 'observed', {
      action: status.readiness?.nextStep,
      message: status.readiness?.ready === false
        ? 'Status handoff reports unresolved readiness gates.'
        : 'Status handoff can be replayed from deterministic runtime state.',
      restartSafe: true,
    }),
    buildMemoryTimelineEvent(4, 'recovery', recovery.lifecycle?.blocked ? 'blocked' : 'restart_safe', {
      action: recovery.lifecycle?.nextAction,
      message: recovery.lifecycle?.blocked
        ? 'Recovery plan requires operator repair before resume.'
        : 'Recovery plan can resume from persisted memory/status state.',
      restartSafe: recovery.lifecycle?.blocked !== true,
    }),
  ];
  const diagnosticEvents = diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error' || diagnostic.severity === 'warning')
    .slice(0, 20)
    .map((diagnostic, offset) => buildMemoryTimelineEvent(5 + offset, 'diagnostic', diagnostic.severity, {
      code: diagnostic.code,
      action: diagnostic.severity === 'error' ? 'repair_memory_binding' : 'review_memory_binding',
      message: diagnostic.message,
      restartSafe: diagnostic.severity !== 'error',
    }));

  return [...events, ...diagnosticEvents];
}

function buildMemoryBindingAnalytics(binding, runtimeAdoptionHealth, status, recovery, diagnostics) {
  const refsByMode = binding.memory.refs.reduce((counts, ref) => {
    counts[ref.mode] = (counts[ref.mode] || 0) + 1;
    return counts;
  }, {});
  const refsByScope = binding.memory.refs.reduce((counts, ref) => {
    counts[ref.scope] = (counts[ref.scope] || 0) + 1;
    return counts;
  }, {});
  const timeline = buildMemoryBindingTimeline(binding, runtimeAdoptionHealth, status, recovery, diagnostics);
  const blockedReasons = stableList([
    ...binding.kernelJob.blockedReasons,
    ...runtimeAdoptionHealth.blockedIssueCodes,
    ...(status.readiness?.validationSummary?.blockedReasons || []),
    ...(recovery.persistedState?.blockedReasons || []),
    ...(binding.providerHealthLink?.blockedReasons || []),
  ]);
  const restartSafe = binding.claims.restartSafe
    && binding.scopeLease.canPersist
    && recovery.lifecycle?.blocked !== true
    && timeline.every((event) => event.restartSafe !== false);

  return {
    protocol: 'aios.memory-binding-analytics.mailchimp.v1',
    memoryHash: binding.kernelJob.memoryHash,
    partition: binding.memory.partition,
    status: blockedReasons.length ? 'blocked' : runtimeAdoptionHealth.status,
    restartSafe,
    counters: {
      totalRefs: binding.memory.refs.length,
      mutatingRefs: binding.memory.summary.mutatingRefs,
      piiRefs: binding.memory.summary.piiRefs,
      restartSafeRefs: binding.memory.summary.restartSafeRefs,
      verifierContracts: binding.verifier.contracts.length,
      missingEvidence: binding.verifier.missingEvidence.length,
      claims: binding.claims.claims.length,
      claimConflicts: binding.claims.conflicts.length,
      grantedCapabilities: binding.capabilities.granted.length,
      deniedCapabilities: binding.capabilities.denied.length,
      blockedReasons: blockedReasons.length,
      diagnostics: diagnostics.length,
    },
    refsByMode,
    refsByScope,
    diagnosticsBySeverity: countBySeverity(diagnostics),
    historySnapshot: {
      stateKey: binding.scopeLease.persistedStateKey,
      leaseId: binding.scopeLease.leaseId,
      leaseState: binding.scopeLease.state,
      continuationKey: binding.clientRuntimeHandoff.workflowHandoff.continuationKey,
      handoffStatus: binding.clientRuntimeHandoff.workflowHandoff.handoffStatus,
      adapterRunId: binding.clientRuntimeHandoff.workflowHandoff.adapterRunId,
      resumeTokenPresent: Boolean(binding.clientRuntimeHandoff.workflowHandoff.resumeToken),
      exportDigest: `fnv1a32:${stableHash({
        memoryHash: binding.kernelJob.memoryHash,
        blockedReasons,
        providerBoundary: binding.providerBoundaryLink,
        runtimeAdoptionHealth,
        statusProtocol: status.protocol,
        recoveryProtocol: recovery.protocol,
      })}`,
    },
    timeline,
    report: {
      title: 'Mailchimp memory binding runtime report',
      nextAction: blockedReasons.length
        ? runtimeAdoptionHealth.nextAction || 'repair_memory_binding'
        : 'dispatch_kernel_job',
      blockedReasons,
      warningIssueCodes: runtimeAdoptionHealth.warningIssueCodes,
      missingClientState: runtimeAdoptionHealth.missingClientState,
      externalWritesAllowed: binding.capabilities.externalWritesAllowed,
      providerBoundary: {
        digest: binding.providerBoundaryLink.digest,
        tenant: binding.providerBoundaryLink.tenant,
        workspace: binding.providerBoundaryLink.workspace,
        ready: binding.providerBoundaryLink.blockedReasons.length === 0,
        auditSink: binding.providerBoundaryLink.auditSink,
        blockedReasons: binding.providerBoundaryLink.blockedReasons,
      },
      providerHealth: {
        status: binding.providerHealthLink.status,
        degraded: binding.providerHealthLink.health.degraded,
        terminal: binding.providerHealthLink.health.terminal,
        retryable: binding.providerHealthLink.retryable,
        retryAfterSeconds: binding.providerHealthLink.retryPlan.retryAfterSeconds,
        blockedReasons: binding.providerHealthLink.blockedReasons,
        actionCards: binding.providerHealthLink.actionCards,
        retryWindow: binding.providerHealthLink.retryWindow,
        nextAction: binding.providerHealthLink.nextAction,
      },
      persistedStateKey: binding.scopeLease.persistedStateKey,
    },
  };
}

function buildMemoryRuntimeAdoptionContractFromBinding(binding, runtimeAdoptionHealth, status, recovery, analytics, ready) {
  const blockedReasons = stableList([
    ...binding.kernelJob.blockedReasons,
    ...runtimeAdoptionHealth.blockedIssueCodes,
    ...(status.readiness?.validationSummary?.blockedReasons || []),
    ...(recovery.persistedState?.blockedReasons || []),
    ...(binding.providerBoundaryLink?.blockedReasons || []),
    ...(binding.providerHealthLink?.blockedReasons || []),
  ]);
  const canResume = Boolean(
    binding.clientRuntimeHandoff.workflowHandoff.resumeToken
      || binding.scopeLease.canPersist
      || recovery.lifecycle?.resumeToken,
  );
  const adoptionKey = `mailchimp:memory-adoption:${stableHash({
    requestId: binding.adapterHandoff.requestId,
    memoryHash: binding.kernelJob.memoryHash,
    continuationKey: binding.clientRuntimeHandoff.workflowHandoff.continuationKey,
    status: runtimeAdoptionHealth.status,
    ready,
  })}`;
  const commandState = ready ? 'ready' : blockedReasons.length ? 'blocked' : 'pending';
  const commands = ready
    ? [
      {
        command: 'memory.runtime-adoption.record',
        label: 'Record memory runtime adoption',
        reason: 'memory contract, scope lease, status, and recovery handoff are aligned',
        state: 'ready',
        idempotencyKey: `${adoptionKey}:record`,
        writes: [binding.scopeLease.persistedStateKey],
      },
      {
        command: binding.kernelJob.providerHealth.nextAction === 'dispatch_degraded_memory_preview'
          ? 'memory.preview.dispatch'
          : 'kernel.job.dispatch',
        label: 'Dispatch memory-bound job',
        reason: binding.providerHealthLink.health.degraded
          ? 'provider is degraded, so dispatch stays in local preview/status mode'
          : 'provider boundary and health checks allow kernel dispatch',
        state: 'ready',
        idempotencyKey: binding.kernelJob.idempotencyKey,
        continuationKey: binding.clientRuntimeHandoff.workflowHandoff.continuationKey,
      },
    ]
    : blockedReasons.map((reason, index) => ({
      command: reason.includes('client')
        ? 'memory.client-runtime.bind'
        : reason.includes('provider_health')
          ? binding.providerHealthLink.nextAction
          : reason.includes('provider_boundary')
            ? binding.providerBoundaryLink.nextAction
            : runtimeAdoptionHealth.nextAction,
      label: 'Resolve memory runtime adoption',
      reason,
      state: commandState,
      idempotencyKey: `${adoptionKey}:blocker:${index + 1}:${stableHash({ reason })}`,
    }));

  return {
    protocol: 'aios.memory-runtime-adoption.mailchimp.v1',
    adoptionKey,
    ready,
    status: ready
      ? 'runtime-adoption-ready'
      : runtimeAdoptionHealth.status === 'needs_client_state'
        ? 'client-runtime-state-required'
        : blockedReasons.length
          ? 'runtime-adoption-blocked'
          : 'runtime-adoption-pending',
    nextAction: commands.find((command) => command.state === 'ready')?.command
      ?? commands[0]?.command
      ?? runtimeAdoptionHealth.nextAction,
    requestState: {
      requestId: binding.clientRuntimeHandoff.requestState.requestId,
      workflowId: binding.clientRuntimeHandoff.requestState.workflowId,
      workflowStep: binding.clientRuntimeHandoff.requestState.workflowStep,
      clientVisibleStatus: ready ? 'memory_binding_ready' : binding.clientRuntimeHandoff.requestState.clientVisibleStatus,
      missingFields: binding.clientRuntimeHandoff.requestState.missingFields,
    },
    handoff: {
      continuationKey: binding.clientRuntimeHandoff.workflowHandoff.continuationKey,
      handoffStatus: binding.clientRuntimeHandoff.workflowHandoff.handoffStatus,
      adapterRunId: binding.clientRuntimeHandoff.workflowHandoff.adapterRunId,
      resumeToken: binding.clientRuntimeHandoff.workflowHandoff.resumeToken,
      canResume,
      statusSnapshotProtocol: status.protocol,
      recoveryProtocol: recovery.protocol,
    },
    persistedState: {
      key: binding.scopeLease.persistedStateKey,
      leaseId: binding.scopeLease.leaseId,
      leaseState: binding.scopeLease.state,
      restartSafe: analytics.restartSafe && canResume,
      analyticsDigest: analytics.historySnapshot.exportDigest,
    },
    commands,
    validation: {
      valid: ready,
      blockedReasons,
      checked: {
        kernelDispatchable: binding.kernelJob.dispatchable,
        scopeLeaseCanPersist: binding.scopeLease.canPersist,
        runtimeAdoptionStatus: runtimeAdoptionHealth.status,
        statusReady: status.readiness?.ready !== false,
        recoveryBlocked: recovery.lifecycle?.blocked === true,
        providerBoundaryReady: binding.providerBoundaryLink.blockedReasons.length === 0,
        providerHealthReady: binding.providerHealthLink.blockedReasons.length === 0,
      },
    },
  };
}

function normalizeRuntimeCommandReceipts(runtime = {}) {
  const source = runtime.priorCommandReceipts
    || runtime.commandReceipts
    || runtime.memoryCommandReceipts
    || runtime.persistedCommandLedger?.receipts
    || [];
  const rows = Array.isArray(source) ? source : Object.values(source);
  return new Map(rows.map((entry) => {
    const id = compactString(entry?.id || entry?.command || entry?.idempotencyKey);
    return [id, {
      status: compactString(entry?.status || 'applied') || 'applied',
      receipt: compactString(entry?.receipt || entry?.resultReceipt),
      appliedAt: compactString(entry?.appliedAt || entry?.at),
      cursor: compactString(entry?.cursor || entry?.resumeCursor),
    }];
  }).filter(([id]) => Boolean(id)));
}

function buildMemoryCommandLedger(binding, runtimeAdoptionHealth, status, recovery, analytics, ready, runtime = {}) {
  const priorReceipts = normalizeRuntimeCommandReceipts(runtime);
  const ledgerKey = `${binding.scopeLease.persistedStateKey}:command-ledger:${binding.kernelJob.memoryHash}`;
  const blockedReasons = stableList([
    ...binding.kernelJob.blockedReasons,
    ...runtimeAdoptionHealth.blockedIssueCodes,
    ...(status.readiness?.validationSummary?.blockedReasons || []),
    ...(recovery.persistedState?.blockedReasons || []),
    ...(binding.providerBoundaryLink?.blockedReasons || []),
    ...(binding.providerHealthLink?.blockedReasons || []),
  ]);
  const commandSources = [
    {
      command: 'memory.scope-lease.persist',
      reason: 'persist tenant/workspace memory lease before dispatch',
      writes: [binding.scopeLease.persistedStateKey],
      restartSafe: binding.scopeLease.canPersist,
      blocker: binding.scopeLease.canPersist ? '' : 'scope_lease_held',
    },
    {
      command: 'memory.claims.persist',
      reason: 'persist restart-safe memory claims for replay',
      writes: binding.claims.claims.map((claim) => `${binding.scopeLease.persistedStateKey}:claim:${claim.name}`),
      restartSafe: binding.claims.restartSafe,
      blocker: binding.claims.restartSafe ? '' : 'memory_claim_conflict',
    },
    {
      command: 'status.snapshot.record',
      reason: 'record status snapshot for adapter handoff recovery',
      writes: [`${binding.scopeLease.persistedStateKey}:status:${binding.kernelJob.memoryHash}`],
      restartSafe: status.readiness?.ready !== false,
      blocker: status.readiness?.ready === false ? 'status_snapshot_blocked' : '',
    },
    {
      command: 'recovery.plan.record',
      reason: 'record recovery plan and resume token semantics',
      writes: [`${binding.scopeLease.persistedStateKey}:recovery:${binding.kernelJob.memoryHash}`],
      restartSafe: recovery.lifecycle?.blocked !== true,
      blocker: recovery.lifecycle?.blocked === true ? 'recovery_plan_blocked' : '',
    },
    {
      command: binding.providerHealthLink.nextAction === 'dispatch_degraded_memory_preview'
        ? 'memory.preview.dispatch'
        : 'kernel.job.dispatch',
      reason: binding.providerHealthLink.health.degraded
        ? 'provider degraded mode permits local preview/status dispatch only'
        : 'kernel job can dispatch with provider boundary and health checks',
      writes: [],
      restartSafe: ready,
      blocker: ready ? '' : blockedReasons[0] || 'runtime_adoption_not_ready',
    },
  ];
  const rows = commandSources.map((source, index) => {
    const idempotencyKey = `${binding.kernelJob.idempotencyKey}:ledger:${index + 1}:${source.command}`;
    const prior = priorReceipts.get(source.command)
      || priorReceipts.get(idempotencyKey)
      || null;
    const commandBlocked = Boolean(source.blocker) || blockedReasons.length > 0 && source.command === 'kernel.job.dispatch';
    const desiredStatus = commandBlocked
      ? 'blocked'
      : prior?.status === 'applied'
        ? 'applied'
        : ready ? 'pending-replay' : 'pending';

    return {
      index: index + 1,
      command: source.command,
      reason: source.reason,
      state: desiredStatus,
      idempotencyKey,
      ledgerEntryKey: `${ledgerKey}:entry:${index + 1}`,
      writes: source.writes,
      receipt: prior?.receipt || null,
      appliedAt: prior?.appliedAt || null,
      resumeCursor: prior?.cursor || `${binding.kernelJob.requestId}:memory-ledger:${index + 1}`,
      restartSafe: source.restartSafe === true && commandBlocked === false,
      blocker: source.blocker || null,
    };
  });

  return {
    protocol: 'aios.memory-command-ledger.mailchimp.v1',
    ledgerKey,
    ready: ready && rows.every((row) => row.restartSafe || row.state === 'applied'),
    status: blockedReasons.length
      ? 'ledger-blocked'
      : rows.every((row) => row.state === 'applied')
        ? 'ledger-complete'
        : 'ledger-replay-ready',
    replayToken: ready ? `memory-ledger:${stableHash({
      ledgerKey,
      rows: rows.map((row) => `${row.command}:${row.state}:${row.receipt || ''}`),
    })}` : null,
    summary: {
      totalCommands: rows.length,
      appliedCommands: rows.filter((row) => row.state === 'applied').length,
      replayableCommands: rows.filter((row) => row.state === 'pending-replay').length,
      blockedCommands: rows.filter((row) => row.state === 'blocked').length,
      blockedReasons,
    },
    rows,
  };
}

function buildMemoryOperationalHandoff(binding, runtimeAdoptionHealth, status, recovery, analytics, commandLedger, ready) {
  const providerHealth = binding.providerHealthLink;
  const providerBoundary = binding.providerBoundaryLink;
  const blockedReasons = stableList([
    ...binding.kernelJob.blockedReasons,
    ...runtimeAdoptionHealth.blockedIssueCodes,
    ...(providerBoundary.blockedReasons || []),
    ...(providerHealth.blockedReasons || []),
    ...(status.readiness?.validationSummary?.blockedReasons || []),
    ...(recovery.persistedState?.blockedReasons || []),
    ...(commandLedger.summary?.blockedReasons || []),
  ]);
  const degraded = providerHealth.health.degraded === true || runtimeAdoptionHealth.degraded === true;
  const retryable = providerHealth.retryable === true
    && providerHealth.health.terminal !== true
    && blockedReasons.some((reason) => reason.startsWith('provider_health'));
  const failureState = {
    terminal: providerHealth.health.terminal === true,
    circuitOpen: providerHealth.health.circuitOpen === true,
    providerUnavailable: providerHealth.health.providerUnavailable === true,
    externalCommitSuppressed: providerHealth.health.externalCommitSuppressed === true,
    actionableIssueCodes: stableList([
      ...providerHealth.health.failureState.actionableIssueCodes,
      ...blockedReasons.filter((reason) => reason.startsWith('provider_health')),
    ]),
    actionableErrors: providerHealth.health.failureState.actionableErrors,
  };
  const commands = [
    {
      command: 'memory.provider-health.observe',
      state: providerHealth.blockedReasons.length ? 'blocked' : 'ready',
      reason: providerHealth.blockedReasons[0] || 'provider health can be recorded for runtime handoff',
      idempotencyKey: `${binding.kernelJob.idempotencyKey}:operational:provider-health`,
      restartSafe: providerHealth.health.terminal !== true,
    },
    {
      command: retryable ? 'memory.provider-health.retry' : 'memory.provider-health.repair',
      state: retryable ? 'scheduled' : blockedReasons.length ? 'blocked' : 'ready',
      reason: retryable
        ? 'provider health retry is bounded by the retry window'
        : blockedReasons[0] || 'provider health does not require retry',
      idempotencyKey: `${binding.kernelJob.idempotencyKey}:operational:${retryable ? 'retry' : 'repair'}`,
      restartSafe: retryable || blockedReasons.length === 0,
    },
    {
      command: degraded ? 'memory.preview.dispatch' : 'kernel.job.dispatch',
      state: ready ? 'ready' : degraded && providerHealth.canUseLocalPreview ? 'ready' : 'blocked',
      reason: degraded
        ? 'provider degradation limits dispatch to local preview/status handoff'
        : blockedReasons[0] || 'kernel dispatch can proceed',
      idempotencyKey: `${binding.kernelJob.idempotencyKey}:operational:dispatch`,
      restartSafe: ready || degraded,
    },
  ];

  return {
    protocol: 'aios.memory-operational-handoff.mailchimp.v1',
    handoffKey: `mailchimp:memory-operational:${stableHash({
      memoryHash: binding.kernelJob.memoryHash,
      providerHealthStatus: providerHealth.status,
      retryable,
      degraded,
      blockedReasons,
    })}`,
    ready: ready && blockedReasons.length === 0,
    status: blockedReasons.length
      ? retryable
        ? 'retry_scheduled'
        : 'blocked'
      : degraded
        ? 'degraded'
        : 'ready',
    nextAction: blockedReasons.length
      ? retryable
        ? 'memory.provider-health.retry'
        : providerHealth.nextAction || runtimeAdoptionHealth.nextAction
      : degraded
        ? 'memory.preview.dispatch'
        : 'kernel.job.dispatch',
    degradedMode: {
      active: degraded,
      mode: providerHealth.degradedMode.memoryDispatchMode,
      externalCommitSuppressed: providerHealth.degradedMode.externalCommitSuppressed,
      localPreviewAllowed: providerHealth.canUseLocalPreview,
    },
    retryBackoff: {
      retryable,
      scheduled: retryable,
      mode: retryable ? providerHealth.retryPlan.mode : 'operator-repair-required',
      backoff: retryable ? providerHealth.retryPlan.backoff : 'none',
      retryAfterSeconds: retryable ? providerHealth.retryPlan.retryAfterSeconds : 0,
      maxAttempts: providerHealth.retryPlan.limit,
      issueCodes: retryable ? providerHealth.retryWindow.issueCodes : [],
    },
    failureState,
    providerBoundary: {
      digest: providerBoundary.digest,
      ready: providerBoundary.blockedReasons.length === 0,
      tenant: providerBoundary.tenant,
      workspace: providerBoundary.workspace,
      leaseId: providerBoundary.leaseId,
      blockedReasons: providerBoundary.blockedReasons,
      auditSink: providerBoundary.auditSink,
    },
    blockedReasons,
    actionCards: providerHealth.actionCards,
    commands,
    auditEvent: {
      type: 'mailchimp.memory.operational_handoff.checked',
      tenant: providerBoundary.tenant || binding.adapterHandoff.tenant,
      workspace: providerBoundary.workspace || binding.memory.workspace,
      memoryHash: binding.kernelJob.memoryHash,
      handoffStatus: blockedReasons.length ? 'blocked' : 'ready',
      retryAfterSeconds: retryable ? providerHealth.retryPlan.retryAfterSeconds : 0,
      restartSafe: failureState.terminal !== true,
    },
    analyticsDigest: analytics.historySnapshot.exportDigest,
    commandLedgerKey: commandLedger.ledgerKey,
  };
}

function buildMemoryProviderSyncCheckpoint(binding, runtimeAdoptionHealth, status, recovery, commandLedger, operationalHandoff, ready, runtime = {}) {
  const providerHealth = binding.providerHealthLink;
  const providerBoundary = binding.providerBoundaryLink;
  const runtimeSync = runtime.providerSyncCheckpoint && typeof runtime.providerSyncCheckpoint === 'object'
    ? runtime.providerSyncCheckpoint
    : runtime.providerSyncMetadata && typeof runtime.providerSyncMetadata === 'object'
      ? runtime.providerSyncMetadata
      : runtime.syncMetadata && typeof runtime.syncMetadata === 'object'
        ? runtime.syncMetadata
        : {};
  const handoffSync = binding.clientRuntimeHandoff.handoffGuards?.providerSync
    && typeof binding.clientRuntimeHandoff.handoffGuards.providerSync === 'object'
    ? binding.clientRuntimeHandoff.handoffGuards.providerSync
    : {};
  const externalHandoffSource = runtime.externalHandoff && typeof runtime.externalHandoff === 'object'
    ? runtime.externalHandoff
    : runtime.providerExternalHandoff && typeof runtime.providerExternalHandoff === 'object'
      ? runtime.providerExternalHandoff
      : {};
  const cursor = compactString(
    runtimeSync.cursor
      || runtimeSync.syncCursor
      || handoffSync.cursor
      || binding.adapterHandoff.externalHandoff?.cursor
      || binding.adapterHandoff.externalHandoff?.syncCursor
      || binding.kernelJob.handoff.externalRequestId,
  );
  const lastProviderRequestId = compactString(
    runtimeSync.lastProviderRequestId
      || runtimeSync.requestId
      || handoffSync.lastProviderRequestId
      || binding.kernelJob.handoff.externalRequestId,
  );
  const observedAt = compactString(runtimeSync.observedAt || runtimeSync.checkedAt || handoffSync.observedAt);
  const availableCapabilities = stableList(
    runtimeSync.availableCapabilities
      || runtimeSync.capabilities
      || handoffSync.availableCapabilities
      || binding.capabilities.granted,
  );
  const requiredCapabilities = stableList([
    ...binding.capabilities.requested,
    binding.memory.summary.mutatingRefs > 0 ? 'provider.mailchimp.memory.write' : 'provider.mailchimp.memory.read',
    providerHealth.canDispatchExternalCommit ? 'provider.mailchimp.external_commit' : '',
    operationalHandoff.degradedMode.active ? 'provider.mailchimp.degraded_preview' : '',
  ]);
  const disabledCapabilities = stableList(runtimeSync.disabledCapabilities || handoffSync.disabledCapabilities);
  const missingCapabilities = requiredCapabilities
    .filter((capability) => !availableCapabilities.includes(capability))
    .filter((capability) => !binding.capabilities.denied.includes(capability));
  const deniedCapabilities = stableList([
    ...binding.capabilities.denied,
    ...disabledCapabilities.filter((capability) => requiredCapabilities.includes(capability)),
  ]);
  const blockedReasons = stableList([
    ...binding.kernelJob.blockedReasons,
    ...runtimeAdoptionHealth.blockedIssueCodes,
    ...(providerBoundary.blockedReasons || []),
    ...(providerHealth.blockedReasons || []),
    ...(status.readiness?.validationSummary?.blockedReasons || []),
    ...(recovery.persistedState?.blockedReasons || []),
    ...(commandLedger.summary?.blockedReasons || []),
    ...missingCapabilities.map((capability) => `provider_sync.capability_missing:${capability}`),
    ...deniedCapabilities.map((capability) => `provider_sync.capability_denied:${capability}`),
    cursor || binding.memory.summary.mutatingRefs === 0 ? '' : 'provider_sync.cursor_missing',
  ]);
  const retryable = providerHealth.retryable === true
    && providerHealth.health.terminal !== true
    && blockedReasons.some((reason) => (
      reason.startsWith('provider_health')
        || reason.startsWith('provider_sync.cursor')
    ));
  const state = blockedReasons.length
    ? retryable
      ? 'retry_scheduled'
      : 'blocked'
    : operationalHandoff.degradedMode.active
      ? 'degraded_checkpoint'
      : ready
        ? 'ready'
        : 'observing';
  const checkpointKey = `mailchimp:memory-provider-sync:${stableHash({
    memoryHash: binding.kernelJob.memoryHash,
    cursor,
    lastProviderRequestId,
    state,
    blockedReasons,
  })}`;
  const externalState = compactString(
    externalHandoffSource.state
      || externalHandoffSource.status
      || binding.adapterHandoff.externalHandoff?.state
      || binding.kernelJob.handoff.externalState
      || 'local_only',
  );
  const commands = [
    {
      command: 'memory.provider-sync.checkpoint',
      state: blockedReasons.length ? 'blocked' : 'ready',
      reason: blockedReasons[0] || 'provider sync cursor and capability negotiation are restart-safe',
      idempotencyKey: `${checkpointKey}:record`,
      writes: [`${binding.scopeLease.persistedStateKey}:provider-sync`],
      restartSafe: blockedReasons.length === 0 || retryable,
    },
    {
      command: retryable ? 'memory.provider-sync.retry' : 'memory.provider-sync.handoff',
      state: retryable ? 'scheduled' : blockedReasons.length ? 'blocked' : 'ready',
      reason: retryable
        ? 'provider sync checkpoint can retry after provider health backoff'
        : blockedReasons[0] || 'external handoff can consume the provider sync checkpoint',
      idempotencyKey: `${checkpointKey}:${retryable ? 'retry' : 'handoff'}`,
      writes: [],
      restartSafe: retryable || blockedReasons.length === 0,
    },
  ];

  return {
    protocol: 'aios.memory-provider-sync-checkpoint.mailchimp.v1',
    checkpointKey,
    ready: state === 'ready' || state === 'degraded_checkpoint',
    status: state,
    provider: 'mailchimp',
    tenant: providerBoundary.tenant || binding.adapterHandoff.tenant,
    workspace: providerBoundary.workspace || binding.memory.workspace,
    memoryHash: binding.kernelJob.memoryHash,
    persistedStateKey: `${binding.scopeLease.persistedStateKey}:provider-sync`,
    syncMetadata: {
      cursor,
      observedAt,
      lastProviderRequestId,
      state: compactString(runtimeSync.state || runtimeSync.status || state),
      consecutiveFailures: positiveInteger(
        runtimeSync.consecutiveFailures
          ?? handoffSync.consecutiveFailures
          ?? providerHealth.health.observation.consecutiveFailures,
        0,
      ),
      retryable,
      retryAfterSeconds: retryable ? providerHealth.retryPlan.retryAfterSeconds : 0,
    },
    capabilityNegotiation: {
      status: missingCapabilities.length || deniedCapabilities.length ? 'blocked' : 'ready',
      required: requiredCapabilities,
      available: availableCapabilities,
      granted: requiredCapabilities.filter((capability) => (
        availableCapabilities.includes(capability)
          && !deniedCapabilities.includes(capability)
      )),
      missing: missingCapabilities,
      denied: deniedCapabilities,
      disabled: disabledCapabilities,
    },
    externalHandoff: {
      target: compactString(externalHandoffSource.target || binding.adapterHandoff.externalHandoff?.target || 'operator-console'),
      queue: compactString(externalHandoffSource.queue || binding.adapterHandoff.externalHandoff?.queue || 'memory-provider-sync'),
      state: externalState,
      correlationId: compactString(externalHandoffSource.correlationId || `${checkpointKey}:handoff`),
      requestId: lastProviderRequestId,
      restartSafe: providerHealth.health.terminal !== true && binding.scopeLease.canPersist === true,
      nextAction: blockedReasons.length
        ? retryable
          ? 'memory.provider-sync.retry'
          : 'memory.provider-sync.repair'
        : operationalHandoff.nextAction,
    },
    blockedReasons,
    retryBackoff: {
      retryable,
      mode: retryable ? providerHealth.retryPlan.mode : 'operator-repair-required',
      backoff: retryable ? providerHealth.retryPlan.backoff : 'none',
      retryAfterSeconds: retryable ? providerHealth.retryPlan.retryAfterSeconds : 0,
      maxAttempts: providerHealth.retryPlan.limit,
      issueCodes: retryable ? providerHealth.retryWindow.issueCodes : [],
    },
    commands,
    auditEvent: {
      type: 'mailchimp.memory.provider_sync_checkpoint.checked',
      tenant: providerBoundary.tenant || binding.adapterHandoff.tenant,
      workspace: providerBoundary.workspace || binding.memory.workspace,
      memoryHash: binding.kernelJob.memoryHash,
      checkpointKey,
      status: state,
      cursorPresent: Boolean(cursor),
      restartSafe: providerHealth.health.terminal !== true,
    },
  };
}

export function compileMailchimpMemoryBinding(input = {}, runtime = {}) {
  const normalized = normalizeBindingInput(input);
  const adapterHandoff = compileMailchimpAdapterHandoff({
    ...normalized,
    truthBoundary: normalized.truth,
    verifier: normalized.verifier.map((verifier) => (typeof verifier === 'string' ? verifier : verifier.name)),
    memory: normalized.memory.map((ref) => (typeof ref === 'string' ? ref : ref.ref || ref.name)).filter(Boolean),
  });
  const memory = buildMemoryContract(adapterHandoff, normalized);
  const verifier = buildVerifierBinding(adapterHandoff, normalized, memory);
  const capabilities = buildCapabilityBinding(adapterHandoff, memory, verifier);
  const claims = buildClaimBinding(adapterHandoff, normalized, memory);
  const scopeLease = buildMemoryScopeLease(adapterHandoff, normalized, memory, claims, runtime);
  const providerBoundaryLink = buildProviderBoundaryLink(adapterHandoff, normalized, runtime, memory, scopeLease);
  const providerHealthLink = buildProviderOperationalHealthLink(adapterHandoff, normalized, runtime, memory, providerBoundaryLink);
  const kernelJob = buildKernelJobBinding(
    adapterHandoff,
    memory,
    capabilities,
    verifier,
    claims,
    scopeLease,
    providerBoundaryLink,
    providerHealthLink,
  );
  const clientRuntimeHandoff = normalizeClientRuntimeHandoff(normalized, runtime, adapterHandoff);
  const baseBinding = {
    protocol: 'aios.memory-binding-compile.mailchimp.v1',
    adapter: 'mailchimp',
    sourceKind: typeof input === 'string' ? 'source' : 'object',
    adapterHandoff,
    memory,
    verifier,
    capabilities,
    claims,
    scopeLease,
    providerBoundaryLink,
    providerHealthLink,
    kernelJob,
    clientRuntimeHandoff,
    metadata: normalized.metadata,
    diagnostics: [...normalized.diagnostics, ...(adapterHandoff.diagnostics || [])],
  };
  const diagnostics = [...baseBinding.diagnostics, ...validateMemoryBinding(baseBinding)];
  const runtimeAdoptionHealth = buildRuntimeAdoptionHealth(baseBinding, clientRuntimeHandoff, diagnostics);
  const statusRuntime = buildStatusRuntime(runtime, { ...baseBinding, diagnostics, runtimeAdoptionHealth });
  const status = buildMailchimpStatusSnapshot(adapterHandoff, statusRuntime);
  const recovery = buildMailchimpRecoveryPlan(status, statusRuntime);
  const analytics = buildMemoryBindingAnalytics(baseBinding, runtimeAdoptionHealth, status, recovery, diagnostics);
  const ready = diagnostics.every((diagnostic) => diagnostic.severity !== 'error')
    && kernelJob.dispatchable
    && runtimeAdoptionHealth.status === 'ready'
    && status.readiness?.ready !== false
    && recovery.lifecycle?.blocked !== true;
  const clientAdoption = buildMemoryRuntimeAdoptionContractFromBinding(
    baseBinding,
    runtimeAdoptionHealth,
    status,
    recovery,
    analytics,
    ready,
  );
  const commandLedger = buildMemoryCommandLedger(
    baseBinding,
    runtimeAdoptionHealth,
    status,
    recovery,
    analytics,
    ready,
    runtime,
  );
  const operationalHandoff = buildMemoryOperationalHandoff(
    baseBinding,
    runtimeAdoptionHealth,
    status,
    recovery,
    analytics,
    commandLedger,
    ready,
  );
  const providerSyncCheckpoint = buildMemoryProviderSyncCheckpoint(
    baseBinding,
    runtimeAdoptionHealth,
    status,
    recovery,
    commandLedger,
    operationalHandoff,
    ready,
    runtime,
  );

  return {
    ...baseBinding,
    diagnostics,
    runtimeAdoptionHealth,
    status,
    recovery,
    analytics,
    commandLedger,
    operationalHandoff,
    providerSyncCheckpoint,
    exportContract: {
      protocol: 'aios.memory-binding-export.mailchimp.v1',
      requestId: adapterHandoff.requestId,
      memoryHash: kernelJob.memoryHash,
      ready,
      nextAction: ready
        ? 'dispatch_kernel_job'
        : runtimeAdoptionHealth.nextAction
          || recovery.lifecycle?.nextAction
          || status.readiness?.nextStep
          || 'repair_memory_binding',
      blockedReasons: stableList([
        ...kernelJob.blockedReasons,
        ...runtimeAdoptionHealth.blockedIssueCodes,
        ...(status.readiness?.validationSummary?.blockedReasons || []),
        ...(recovery.persistedState?.blockedReasons || []),
        ...(providerHealthLink.blockedReasons || []),
      ]),
      analytics: {
        protocol: analytics.protocol,
        status: analytics.status,
        restartSafe: analytics.restartSafe,
        counters: analytics.counters,
        diagnosticsBySeverity: analytics.diagnosticsBySeverity,
        historySnapshot: analytics.historySnapshot,
        report: analytics.report,
        timeline: analytics.timeline,
      },
      providerSync: {
        protocol: providerSyncCheckpoint.protocol,
        checkpointKey: providerSyncCheckpoint.checkpointKey,
        ready: providerSyncCheckpoint.ready,
        status: providerSyncCheckpoint.status,
        persistedStateKey: providerSyncCheckpoint.persistedStateKey,
        syncMetadata: providerSyncCheckpoint.syncMetadata,
        capabilityNegotiation: providerSyncCheckpoint.capabilityNegotiation,
        externalHandoff: providerSyncCheckpoint.externalHandoff,
        blockedReasons: providerSyncCheckpoint.blockedReasons,
        retryBackoff: providerSyncCheckpoint.retryBackoff,
        commands: providerSyncCheckpoint.commands.map((command) => ({
          command: command.command,
          state: command.state,
          idempotencyKey: command.idempotencyKey,
          restartSafe: command.restartSafe,
        })),
        auditEvent: providerSyncCheckpoint.auditEvent,
      },
      clientAdoption,
      commandLedger: {
        protocol: commandLedger.protocol,
        ledgerKey: commandLedger.ledgerKey,
        ready: commandLedger.ready,
        status: commandLedger.status,
        replayToken: commandLedger.replayToken,
        summary: commandLedger.summary,
        rows: commandLedger.rows.map((row) => ({
          command: row.command,
          state: row.state,
          idempotencyKey: row.idempotencyKey,
          ledgerEntryKey: row.ledgerEntryKey,
          restartSafe: row.restartSafe,
          blocker: row.blocker,
        })),
      },
      contracts: {
        memory: memory.protocol,
        verifier: verifier.protocol,
        capabilities: capabilities.protocol,
        claims: claims.protocol,
        scopeLease: scopeLease.protocol,
        providerBoundaryLink: providerBoundaryLink.protocol,
        providerHealthLink: providerHealthLink.protocol,
        kernelJob: kernelJob.protocol,
        status: status.protocol,
        recovery: recovery.protocol,
        clientRuntimeHandoff: clientRuntimeHandoff.protocol,
        runtimeAdoptionHealth: runtimeAdoptionHealth.protocol,
        commandLedger: commandLedger.protocol,
        operationalHandoff: operationalHandoff.protocol,
        providerSyncCheckpoint: providerSyncCheckpoint.protocol,
      },
      persistedState: {
        key: scopeLease.persistedStateKey,
        leaseId: scopeLease.leaseId,
        leaseState: scopeLease.state,
        tenant: scopeLease.tenant,
        workspace: scopeLease.workspace,
        restartSafeStatus: scopeLease.canPersist ? 'lease-active-or-replayable' : 'held-for-boundary',
        nextAction: scopeLease.nextAction,
      },
      providerBoundary: {
        digest: providerBoundaryLink.digest,
        tenant: providerBoundaryLink.tenant,
        workspace: providerBoundaryLink.workspace,
        leaseId: providerBoundaryLink.leaseId,
        ready: providerBoundaryLink.blockedReasons.length === 0,
        auditEvent: providerBoundaryLink.auditEvent,
        nextAction: providerBoundaryLink.nextAction,
      },
      providerHealth: {
        status: providerHealthLink.status,
        degraded: providerHealthLink.health.degraded,
        terminal: providerHealthLink.health.terminal,
        retryable: providerHealthLink.retryable,
        retryPlan: providerHealthLink.retryPlan,
        retryWindow: providerHealthLink.retryWindow,
        actionCards: providerHealthLink.actionCards,
        auditEvent: providerHealthLink.auditEvent,
        nextAction: providerHealthLink.nextAction,
      },
      operationalHandoff,
      providerSyncCheckpoint,
    },
  };
}

export function buildMailchimpMemoryRuntimeAdoptionContract(input = {}, runtime = {}) {
  const binding = input?.protocol === 'aios.memory-binding-compile.mailchimp.v1'
    ? input
    : compileMailchimpMemoryBinding(input, runtime);
  return binding.exportContract.clientAdoption;
}

export function validateMailchimpMemoryBinding(input = {}, runtime = {}) {
  const binding = input?.protocol === 'aios.memory-binding-compile.mailchimp.v1'
    ? input
    : compileMailchimpMemoryBinding(input, runtime);
  const diagnostics = validateMemoryBinding(binding);
  return {
    protocol: 'aios.memory-binding-validation.mailchimp.v1',
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
    diagnostics,
    memoryHash: binding.kernelJob?.memoryHash || '',
    blockedReasons: binding.kernelJob?.blockedReasons || [],
    scopeLease: binding.scopeLease || {},
    providerBoundaryLink: binding.providerBoundaryLink || {},
    providerHealthLink: binding.providerHealthLink || {},
  };
}

export function buildMailchimpMemoryBindingSelfCheck(input = {}, runtime = {}) {
  const first = compileMailchimpMemoryBinding(input, runtime);
  const second = compileMailchimpMemoryBinding(input, runtime);
  const firstHash = stableHash(first.exportContract);
  const secondHash = stableHash(second.exportContract);
  return {
    protocol: 'aios.memory-binding-self-check.mailchimp.v1',
    deterministic: firstHash === secondHash && first.kernelJob.memoryHash === second.kernelJob.memoryHash,
    exportHash: firstHash,
    memoryHash: first.kernelJob.memoryHash,
    ready: first.exportContract.ready,
    diagnostics: first.diagnostics,
    nextAction: first.exportContract.nextAction,
    scopeLeaseId: first.scopeLease.leaseId,
    persistedStateKey: first.scopeLease.persistedStateKey,
    clientAdoptionKey: first.exportContract.clientAdoption.adoptionKey,
    clientAdoptionReady: first.exportContract.clientAdoption.ready,
    commandLedgerKey: first.commandLedger.ledgerKey,
    commandLedgerStatus: first.commandLedger.status,
    commandLedgerReplayToken: first.commandLedger.replayToken,
    commandLedgerReplayableCommands: first.commandLedger.summary.replayableCommands,
    providerBoundaryDigest: first.providerBoundaryLink.digest,
    providerBoundaryReady: first.providerBoundaryLink.blockedReasons.length === 0,
    providerHealthStatus: first.providerHealthLink.status,
    providerHealthReady: first.providerHealthLink.blockedReasons.length === 0,
    providerHealthActionCards: first.providerHealthLink.actionCards.length,
    providerHealthRetryScheduled: first.providerHealthLink.retryWindow.scheduled,
    operationalHandoffStatus: first.operationalHandoff.status,
    operationalHandoffReady: first.operationalHandoff.ready,
    operationalHandoffRetryAfterSeconds: first.operationalHandoff.retryBackoff.retryAfterSeconds,
    providerSyncCheckpointKey: first.providerSyncCheckpoint.checkpointKey,
    providerSyncStatus: first.providerSyncCheckpoint.status,
    providerSyncReady: first.providerSyncCheckpoint.ready,
    providerSyncCapabilityStatus: first.providerSyncCheckpoint.capabilityNegotiation.status,
    providerSyncRetryAfterSeconds: first.providerSyncCheckpoint.retryBackoff.retryAfterSeconds,
    analyticsDigest: first.analytics.historySnapshot.exportDigest,
    timelineLength: first.analytics.timeline.length,
  };
}

export {
  ACTION_MEMORY_DEFAULTS,
  CLAIM_STATES,
  MEMORY_MODES,
  MEMORY_SCOPES,
  VERIFIER_STATES,
  buildMemoryProviderSyncCheckpoint,
  parseMemoryBindingSource,
};
