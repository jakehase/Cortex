const DEFAULT_SOURCE_ID = 'inline.aios';
const DEFAULT_CAPABILITY_SCOPE = 'mailchimp.campaign';
const KNOWN_DECLARATIONS = new Set(['job', 'capability', 'memory', 'verifier', 'claim']);
const DEFAULT_PROVIDER_SERVICE = 'mailchimp-marketing';
const DEFAULT_PROVIDER_REGION = 'us';
const DEFAULT_SYNC_STRATEGY = 'incremental';
const DEFAULT_EXTERNAL_STATE = 'provider-status';

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const stableHash = (value) => {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const normalizeName = (value, fallback) => {
  const text = String(value ?? '').trim().toLowerCase();
  const slug = text.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || fallback;
};

const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort();

const splitList = (value) => uniqueSorted(String(value || '')
  .split(',')
  .map((entry) => normalizeName(entry, '')));

const scopeToOperation = (scope) => {
  const [, resource = 'campaign'] = String(scope || DEFAULT_CAPABILITY_SCOPE).split('.');
  if (resource === 'audience') {
    return 'read-audience';
  }
  if (resource === 'template') {
    return 'read-template';
  }
  return resource === 'campaign' ? 'send-campaign' : `sync-${resource}`;
};

const scopeToSyncCursor = (scope) => `cursor.${normalizeName(scope, DEFAULT_CAPABILITY_SCOPE)}`;

const readPairs = (body) => {
  const pairs = {};
  for (const segment of body.split(/\s+/u)) {
    const match = segment.match(/^([a-zA-Z][\w.-]*)=(.+)$/u);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    pairs[key] = rawValue.replace(/^["']|["']$/g, '');
  }
  return pairs;
};

export const AIOS_CONCEPT_MODEL_VERSION = 'aios-language.concepts-model.v1';

export const createEmptyConceptModel = (sourceId = DEFAULT_SOURCE_ID) => ({
  version: AIOS_CONCEPT_MODEL_VERSION,
  sourceId,
  declarations: [],
  diagnostics: [],
  jobs: [],
  capabilities: [],
  memories: [],
  verifiers: [],
  claims: [],
  recovery: {
    status: 'ready',
    handoff: 'adapter.status.ready',
    retryable: false,
    reasons: [],
  },
  providerContracts: [],
  providerSyncPlan: {
    status: 'ready',
    handoff: 'adapter.status.ready',
    providers: [],
    externalStateKeys: [],
    requiredCapabilities: [],
    readiness: {
      accepted: true,
      reasons: [],
    },
  },
});

export const parseConceptSource = (source, options = {}) => {
  const sourceId = options.sourceId || DEFAULT_SOURCE_ID;
  const model = createEmptyConceptModel(sourceId);
  const text = String(source ?? '').replace(/\r\n?/g, '\n');

  text.split('\n').forEach((lineText, offset) => {
    const line = offset + 1;
    const cleanLine = lineText.replace(/#.*/u, '').trim();
    if (!cleanLine) {
      return;
    }

    const match = cleanLine.match(/^([a-zA-Z][\w-]*)\s+([a-zA-Z0-9_.:-]+)(?:\s+(.*))?$/u);
    if (!match) {
      model.diagnostics.push({
        code: 'aios.syntax.unrecognized',
        severity: 'error',
        line,
        message: `Cannot parse declaration at line ${line}.`,
      });
      return;
    }

    const [, kind, name, body = ''] = match;
    const normalizedKind = kind.toLowerCase();
    if (!KNOWN_DECLARATIONS.has(normalizedKind)) {
      model.diagnostics.push({
        code: 'aios.syntax.unknown-declaration',
        severity: 'error',
        line,
        message: `Unknown declaration "${kind}" at line ${line}.`,
      });
      return;
    }

    model.declarations.push({
      kind: normalizedKind,
      name: normalizeName(name, `${normalizedKind}-${line}`),
      rawName: name,
      line,
      attrs: readPairs(body),
    });
  });

  return shapeConceptModel(model, options);
};

export const shapeConceptModel = (model, options = {}) => {
  const defaultScope = normalizeName(options.defaultScope || DEFAULT_CAPABILITY_SCOPE, DEFAULT_CAPABILITY_SCOPE);
  const jobNames = model.declarations.filter((entry) => entry.kind === 'job').map((entry) => entry.name);
  const capabilityNames = model.declarations.filter((entry) => entry.kind === 'capability').map((entry) => entry.name);
  const memoryNames = model.declarations.filter((entry) => entry.kind === 'memory').map((entry) => entry.name);
  const verifierNames = model.declarations.filter((entry) => entry.kind === 'verifier').map((entry) => entry.name);
  const claimNames = model.declarations.filter((entry) => entry.kind === 'claim').map((entry) => entry.name);

  model.jobs = model.declarations.filter((entry) => entry.kind === 'job').map((entry) => ({
    id: `job.${entry.name}`,
    name: entry.name,
    sourceLine: entry.line,
    capabilityRefs: uniqueSorted((entry.attrs.uses || capabilityNames.join(',')).split(',').map((value) => normalizeName(value, ''))),
    memoryRefs: uniqueSorted((entry.attrs.memory || memoryNames.join(',')).split(',').map((value) => normalizeName(value, ''))),
    verifierRefs: uniqueSorted((entry.attrs.verify || verifierNames.join(',')).split(',').map((value) => normalizeName(value, ''))),
    claimRefs: uniqueSorted((entry.attrs.claim || claimNames.join(',')).split(',').map((value) => normalizeName(value, ''))),
    providerCommand: normalizeName(entry.attrs.command || entry.name, entry.name),
    idempotencyKey: normalizeName(entry.attrs.idempotency || `${model.sourceId}-${entry.name}`, entry.name),
  }));

  model.capabilities = model.declarations.filter((entry) => entry.kind === 'capability').map((entry) => ({
    id: `capability.${entry.name}`,
    name: entry.name,
    sourceLine: entry.line,
    scope: normalizeName(entry.attrs.scope || defaultScope, defaultScope),
    adapter: normalizeName(entry.attrs.adapter || 'mailchimp', 'mailchimp'),
    recovery: normalizeName(entry.attrs.recovery || 'status-handoff', 'status-handoff'),
    providerService: normalizeName(entry.attrs.service || DEFAULT_PROVIDER_SERVICE, DEFAULT_PROVIDER_SERVICE),
    providerRegion: normalizeName(entry.attrs.region || DEFAULT_PROVIDER_REGION, DEFAULT_PROVIDER_REGION),
    operation: normalizeName(entry.attrs.operation || scopeToOperation(entry.attrs.scope || defaultScope), scopeToOperation(defaultScope)),
    syncStrategy: normalizeName(entry.attrs.sync || DEFAULT_SYNC_STRATEGY, DEFAULT_SYNC_STRATEGY),
    syncCursor: normalizeName(entry.attrs.cursor || scopeToSyncCursor(entry.attrs.scope || defaultScope), scopeToSyncCursor(defaultScope)),
    externalState: normalizeName(entry.attrs.state || DEFAULT_EXTERNAL_STATE, DEFAULT_EXTERNAL_STATE),
    negotiates: splitList(entry.attrs.negotiates || 'oauth,rate-limit,webhook-status'),
  }));

  model.memories = model.declarations.filter((entry) => entry.kind === 'memory').map((entry) => ({
    id: `memory.${entry.name}`,
    name: entry.name,
    sourceLine: entry.line,
    durability: normalizeName(entry.attrs.durability || 'ephemeral', 'ephemeral'),
    retention: normalizeName(entry.attrs.retention || 'job', 'job'),
  }));

  model.verifiers = model.declarations.filter((entry) => entry.kind === 'verifier').map((entry) => ({
    id: `verifier.${entry.name}`,
    name: entry.name,
    sourceLine: entry.line,
    mode: normalizeName(entry.attrs.mode || 'deterministic', 'deterministic'),
    requires: uniqueSorted((entry.attrs.requires || '').split(',').map((value) => normalizeName(value, ''))),
  }));

  model.claims = model.declarations.filter((entry) => entry.kind === 'claim').map((entry) => ({
    id: `claim.${entry.name}`,
    name: entry.name,
    sourceLine: entry.line,
    verifierRef: normalizeName(entry.attrs.verifier || verifierNames[0] || 'contract', 'contract'),
    evidence: normalizeName(entry.attrs.evidence || 'adapter-status', 'adapter-status'),
  }));

  model.recovery = deriveRecoveryStatus(model);
  model.providerContracts = deriveProviderContracts(model);
  model.providerSyncPlan = deriveProviderSyncPlan(model);
  return model;
};

export const deriveProviderContracts = (model) => {
  const providerMap = new Map();
  for (const capability of model.capabilities) {
    const key = `${capability.adapter}:${capability.providerService}:${capability.providerRegion}`;
    const existing = providerMap.get(key) || {
      id: `provider.${capability.adapter}.${capability.providerService}.${capability.providerRegion}`,
      adapter: capability.adapter,
      service: capability.providerService,
      region: capability.providerRegion,
      capabilityIds: [],
      scopes: [],
      operations: [],
      syncCursors: [],
      externalStateKeys: [],
      negotiation: {
        required: [],
        status: 'ready',
        handoff: 'adapter.status.ready',
      },
    };

    existing.capabilityIds.push(capability.id);
    existing.scopes.push(capability.scope);
    existing.operations.push(capability.operation);
    existing.syncCursors.push(capability.syncCursor);
    existing.externalStateKeys.push(capability.externalState);
    existing.negotiation.required.push(...capability.negotiates);
    providerMap.set(key, existing);
  }

  return [...providerMap.values()]
    .map((provider) => ({
      ...provider,
      capabilityIds: uniqueSorted(provider.capabilityIds),
      scopes: uniqueSorted(provider.scopes),
      operations: uniqueSorted(provider.operations),
      syncCursors: uniqueSorted(provider.syncCursors),
      externalStateKeys: uniqueSorted(provider.externalStateKeys),
      negotiation: {
        ...provider.negotiation,
        required: uniqueSorted(provider.negotiation.required),
      },
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

export const deriveProviderSyncPlan = (model) => {
  const reasons = [];
  const memoryNames = new Set(model.memories.map((memory) => memory.name));
  const durableMemory = model.memories.find((memory) => memory.durability === 'durable');
  const statusMemory = model.memories.find((memory) => memory.name === 'adapter-status');

  if (!durableMemory) {
    reasons.push('provider.sync.missing-durable-memory');
  }
  if (!statusMemory) {
    reasons.push('provider.sync.missing-adapter-status-memory');
  }

  for (const capability of model.capabilities) {
    if (!capability.scope.startsWith(`${capability.adapter}-`)) {
      reasons.push(`provider.scope.adapter-mismatch.${capability.name}`);
    }
    if (!memoryNames.has(capability.externalState) && capability.externalState !== DEFAULT_EXTERNAL_STATE) {
      reasons.push(`provider.sync.external-state-unbacked.${capability.externalState}`);
    }
  }

  const providerReasons = uniqueSorted([...reasons, ...model.recovery.reasons]);
  const status = model.recovery.status === 'invalid'
    ? 'blocked'
    : providerReasons.length > 0
      ? 'recoverable'
      : 'ready';

  return {
    status,
    handoff: status === 'ready' ? 'adapter.status.ready' : status === 'recoverable' ? 'adapter.status.recover' : 'adapter.status.blocked',
    retryable: status === 'recoverable',
    providers: model.providerContracts.map((provider) => ({
      id: provider.id,
      adapter: provider.adapter,
      service: provider.service,
      region: provider.region,
      operations: provider.operations,
      negotiation: provider.negotiation,
    })),
    externalStateKeys: uniqueSorted(model.capabilities.map((capability) => capability.externalState)),
    requiredCapabilities: uniqueSorted(model.capabilities.map((capability) => capability.id)),
    statusMemoryRef: statusMemory?.id || null,
    durableMemoryRef: durableMemory?.id || null,
    readiness: {
      accepted: status === 'ready',
      reasons: providerReasons,
    },
  };
};

export const deriveRecoveryStatus = (model) => {
  const reasons = [];
  const capabilityNames = new Set(model.capabilities.map((capability) => capability.name));
  const memoryNames = new Set(model.memories.map((memory) => memory.name));
  const verifierNames = new Set(model.verifiers.map((verifier) => verifier.name));
  const claimNames = new Set(model.claims.map((claim) => claim.name));

  for (const job of model.jobs) {
    for (const name of job.capabilityRefs) {
      if (!capabilityNames.has(name)) {
        reasons.push(`job.${job.name}.missing-capability.${name}`);
      }
    }
    for (const name of job.memoryRefs) {
      if (!memoryNames.has(name)) {
        reasons.push(`job.${job.name}.missing-memory.${name}`);
      }
    }
    for (const name of job.verifierRefs) {
      if (!verifierNames.has(name)) {
        reasons.push(`job.${job.name}.missing-verifier.${name}`);
      }
    }
    for (const name of job.claimRefs) {
      if (!claimNames.has(name)) {
        reasons.push(`job.${job.name}.missing-claim.${name}`);
      }
    }
  }

  const errors = model.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const status = errors.length > 0 ? 'invalid' : reasons.length > 0 ? 'recoverable' : 'ready';
  return {
    status,
    handoff: status === 'ready' ? 'adapter.status.ready' : status === 'recoverable' ? 'adapter.status.recover' : 'adapter.status.blocked',
    retryable: status === 'recoverable',
    reasons: uniqueSorted([...errors.map((diagnostic) => diagnostic.code), ...reasons]),
  };
};

export const compileConceptModel = (source, options = {}) => {
  const model = parseConceptSource(source, options);
  const contract = {
    version: AIOS_CONCEPT_MODEL_VERSION,
    sourceId: model.sourceId,
    contractId: `contract.${stableHash({
      declarations: model.declarations,
      sourceId: model.sourceId,
      version: AIOS_CONCEPT_MODEL_VERSION,
    })}`,
    jobs: model.jobs,
    capabilities: model.capabilities,
    memories: model.memories,
    verifiers: model.verifiers,
    claims: model.claims,
    providerContracts: model.providerContracts,
    providerSyncPlan: model.providerSyncPlan,
    diagnostics: model.diagnostics,
    recovery: model.recovery,
  };

  return Object.freeze(contract);
};

export const createConceptAcceptancePreview = (contract) => {
  const ready = contract?.recovery?.status === 'ready' && contract?.providerSyncPlan?.status === 'ready';
  const providerCount = contract?.providerContracts?.length || 0;
  const stepCount = contract?.jobs?.length || 0;
  const capabilityCount = contract?.capabilities?.length || 0;
  const reasons = uniqueSorted([
    ...(contract?.recovery?.reasons || []),
    ...(contract?.providerSyncPlan?.readiness?.reasons || []),
  ]);

  return Object.freeze({
    accepted: ready,
    readiness: ready ? 'ready' : reasons.length > 0 ? 'needs-recovery' : 'incomplete',
    summary: {
      providerCount,
      stepCount,
      capabilityCount,
      externalStateKeys: contract?.providerSyncPlan?.externalStateKeys || [],
    },
    nextSteps: ready
      ? ['handoff.adapter-status.ready', 'persist.provider-sync-plan']
      : ['resolve.provider-contract-gaps', 'retry.adapter-status-handoff'],
    validation: {
      status: contract?.providerSyncPlan?.status || 'blocked',
      handoff: contract?.providerSyncPlan?.handoff || 'adapter.status.blocked',
      retryable: contract?.providerSyncPlan?.retryable === true,
      reasons,
    },
  });
};

export const assertConceptModelReady = (contract) => {
  if (!contract || contract.recovery?.status !== 'ready') {
    const reasons = contract?.recovery?.reasons?.join(', ') || 'missing-contract';
    throw new Error(`AI OS concept contract is not ready: ${reasons}`);
  }
  return contract;
};

export const conceptModelSelfCheck = () => {
  const contract = compileConceptModel(`
    capability mailchimp-send scope=mailchimp.campaign adapter=mailchimp
    memory campaign-state durability=durable retention=workflow
    memory adapter-status durability=ephemeral retention=job
    verifier campaign-contract mode=deterministic requires=mailchimp-send
    claim campaign-ready verifier=campaign-contract evidence=adapter-status
    job send-campaign uses=mailchimp-send memory=campaign-state,adapter-status verify=campaign-contract claim=campaign-ready
  `, { sourceId: 'self-check.aios' });

  return {
    ok: contract.recovery.status === 'ready' && contract.providerSyncPlan.status === 'ready' && contract.jobs.length === 1,
    contractId: contract.contractId,
    recovery: contract.recovery,
    preview: createConceptAcceptancePreview(contract),
  };
};
