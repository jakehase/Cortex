import {
  compileConceptModel,
} from './concepts-model.mjs';

export const AIOS_CAPABILITY_GUIDE_VERSION = 'aios-language.capability-guide.v1';

export const CAPABILITY_GUIDE_SOURCE = `
  capability mailchimp-template-read scope=mailchimp.template adapter=mailchimp recovery=status-handoff
  capability mailchimp-audience-read scope=mailchimp.audience adapter=mailchimp recovery=status-handoff
  capability mailchimp-campaign-send scope=mailchimp.campaign adapter=mailchimp recovery=status-handoff
  memory capability-ledger durability=durable retention=workflow
  memory adapter-status durability=ephemeral retention=job
  verifier capability-boundary mode=deterministic requires=mailchimp-template-read,mailchimp-audience-read,mailchimp-campaign-send
  claim capability-ledger-ready verifier=capability-boundary evidence=adapter-status
  job authorize-campaign-send uses=mailchimp-template-read,mailchimp-audience-read,mailchimp-campaign-send memory=capability-ledger,adapter-status verify=capability-boundary claim=capability-ledger-ready
`;

const groupByAdapter = (capabilities) => capabilities.reduce((groups, capability) => {
  const adapter = capability.adapter;
  groups[adapter] = groups[adapter] || [];
  groups[adapter].push(capability);
  return groups;
}, {});

const normalizeRequestToken = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const stableCommandToken = (parts) => parts
  .map((part) => normalizeRequestToken(part))
  .filter(Boolean)
  .join('.');

const buildProviderServiceContracts = (contract, grouped) => contract.providerContracts.map((provider) => {
  const capabilities = (grouped[provider.adapter] || [])
    .filter((capability) => provider.capabilityIds.includes(capability.id))
    .map((capability) => ({
      id: capability.id,
      scope: capability.scope,
      operation: capability.operation,
      syncStrategy: capability.syncStrategy,
      syncCursor: capability.syncCursor,
      externalState: capability.externalState,
      negotiation: capability.negotiates,
    }));

  return {
    id: provider.id,
    adapter: provider.adapter,
    service: provider.service,
    region: provider.region,
    capabilities,
    operations: provider.operations,
    syncCursors: provider.syncCursors,
    externalStateKeys: provider.externalStateKeys,
    negotiation: {
      ...provider.negotiation,
      commandId: stableCommandToken([provider.adapter, provider.service, provider.region, 'negotiate']),
    },
  };
});

const buildPersistedStateShape = (guide, adapterContract) => {
  const providerContracts = guide.providerServices.filter((provider) => provider.adapter === adapterContract.adapter);
  const capabilityIds = adapterContract.capabilities.map((capability) => capability.id);
  const syncCursors = providerContracts.flatMap((provider) => provider.syncCursors);
  const externalStateKeys = providerContracts.flatMap((provider) => provider.externalStateKeys);
  const commandId = stableCommandToken([adapterContract.adapter, capabilityIds.join('-'), guide.contractId]);

  return {
    commandId,
    idempotencyKey: `capability-command.${commandId}`,
    ledgerMemoryRef: guide.ledger.memoryRef,
    statusMemoryRef: guide.ledger.statusMemoryRef,
    stateKeys: [...new Set([
      ...externalStateKeys,
      `ledger.${adapterContract.adapter}`,
      `status.${adapterContract.adapter}`,
    ])].sort(),
    syncCursors: [...new Set(syncCursors)].sort(),
    restart: {
      status: guide.providerSync.status,
      handoff: guide.providerSync.handoff,
      retryable: guide.providerSync.retryable,
      reasons: guide.providerSync.readiness.reasons,
    },
  };
};

export const createCapabilityGuide = (source = CAPABILITY_GUIDE_SOURCE, options = {}) => {
  const contract = compileConceptModel(source, {
    sourceId: options.sourceId || 'capability-guide.aios',
    defaultScope: options.defaultScope,
  });
  const grouped = groupByAdapter(contract.capabilities);
  const ledgerMemory = contract.memories.find((memory) => memory.name === 'capability-ledger') || null;
  const statusMemory = contract.memories.find((memory) => memory.name === 'adapter-status') || null;

  const adapterContracts = Object.keys(grouped).sort().map((adapter) => ({
    adapter,
    capabilities: grouped[adapter].map((capability) => ({
      id: capability.id,
      scope: capability.scope,
      operation: capability.operation,
      syncStrategy: capability.syncStrategy,
      syncCursor: capability.syncCursor,
      externalState: capability.externalState,
      recovery: capability.recovery,
      sourceLine: capability.sourceLine,
    })),
    verifierRefs: contract.verifiers
      .filter((verifier) => grouped[adapter].some((capability) => verifier.requires.includes(capability.name)))
      .map((verifier) => verifier.id),
    claimRefs: contract.claims.map((claim) => claim.id),
  }));

  const providerServices = buildProviderServiceContracts(contract, grouped);

  const guide = {
    version: AIOS_CAPABILITY_GUIDE_VERSION,
    contractId: contract.contractId,
    sourceId: contract.sourceId,
    recovery: contract.recovery,
    adapterContracts,
    providerServices,
    providerSync: contract.providerSyncPlan,
    ledger: {
      memoryRef: ledgerMemory?.id || null,
      durability: ledgerMemory?.durability || null,
      retention: ledgerMemory?.retention || null,
      statusMemoryRef: statusMemory?.id || null,
    },
    statusHandoff: {
      route: contract.recovery.handoff,
      retryable: contract.recovery.retryable,
      reasons: contract.recovery.reasons,
    },
  };

  return Object.freeze({
    ...guide,
    persistedState: adapterContracts.map((adapterContract) => ({
      adapter: adapterContract.adapter,
      ...buildPersistedStateShape(guide, adapterContract),
    })),
  });
};

export const validateCapabilityRequest = (guide, request = {}) => {
  const adapter = normalizeRequestToken(request.adapter || 'mailchimp');
  const scope = normalizeRequestToken(request.scope);
  const capabilityId = request.capabilityId ? `capability.${normalizeRequestToken(String(request.capabilityId).replace(/^capability\./u, ''))}` : null;
  const adapterContract = guide.adapterContracts.find((candidate) => candidate.adapter === adapter);

  if (!adapterContract) {
    return {
      ok: false,
      status: 'blocked',
      handoff: 'adapter.status.blocked',
      retryable: false,
      reasons: [`capability.adapter.unknown.${adapter}`],
    };
  }

  const capability = adapterContract.capabilities.find((candidate) => candidate.scope === scope || candidate.id === capabilityId);
  if (!capability) {
    return {
      ok: false,
      status: 'recoverable',
      handoff: 'adapter.status.recover',
      retryable: true,
      reasons: [`capability.scope.missing.${scope || 'unspecified'}`],
    };
  }

  const providerService = guide.providerServices.find((provider) => provider.capabilities.some((candidate) => candidate.id === capability.id));
  const persistedState = guide.persistedState.find((entry) => entry.adapter === adapter) || null;
  const missingNegotiation = (request.acceptedNegotiation || [])
    .map((entry) => normalizeRequestToken(entry))
    .filter(Boolean);
  const requiredNegotiation = providerService?.negotiation.required || [];
  const negotiationGaps = requiredNegotiation.filter((entry) => !missingNegotiation.includes(entry));
  const negotiationStatus = negotiationGaps.length === 0 || missingNegotiation.length === 0 ? 'ready' : 'recoverable';

  return {
    ok: negotiationStatus === 'ready',
    status: negotiationStatus,
    handoff: negotiationStatus === 'ready' ? 'adapter.status.ready' : 'adapter.status.recover',
    retryable: negotiationStatus === 'recoverable',
    reasons: negotiationStatus === 'ready' ? [] : negotiationGaps.map((entry) => `capability.negotiation.missing.${entry}`),
    capabilityId: capability.id,
    operation: capability.operation,
    syncStrategy: capability.syncStrategy,
    syncCursor: capability.syncCursor,
    externalState: capability.externalState,
    providerServiceId: providerService?.id || null,
    providerNegotiation: providerService?.negotiation || null,
    verifierRefs: adapterContract.verifierRefs,
    claimRefs: adapterContract.claimRefs,
    ledgerMemoryRef: guide.ledger.memoryRef,
    statusMemoryRef: guide.ledger.statusMemoryRef,
    persistedState,
  };
};

export const planCapabilityRecoveryCommand = (guide, request = {}) => {
  const validation = validateCapabilityRequest(guide, request);
  const adapter = normalizeRequestToken(request.adapter || 'mailchimp');
  const persistedState = guide.persistedState.find((entry) => entry.adapter === adapter) || null;

  return Object.freeze({
    accepted: validation.ok,
    status: validation.status,
    handoff: validation.handoff,
    retryable: validation.retryable,
    reasons: validation.reasons,
    command: {
      id: persistedState?.commandId || stableCommandToken([adapter, 'capability-recovery', guide.contractId]),
      idempotencyKey: persistedState?.idempotencyKey || `capability-command.${adapter}.recovery`,
      adapter,
      capabilityId: validation.capabilityId || null,
      providerServiceId: validation.providerServiceId || null,
      operation: validation.operation || 'negotiate-provider',
      externalState: validation.externalState || `status.${adapter}`,
      syncCursor: validation.syncCursor || null,
    },
    restartSafe: {
      ledgerMemoryRef: persistedState?.ledgerMemoryRef || guide.ledger.memoryRef,
      statusMemoryRef: persistedState?.statusMemoryRef || guide.ledger.statusMemoryRef,
      stateKeys: persistedState?.stateKeys || [`status.${adapter}`],
      retryFromStatus: validation.retryable ? validation.handoff : 'adapter.status.ready',
    },
  });
};

export const capabilityGuideSelfCheck = () => {
  const guide = createCapabilityGuide();
  const validation = validateCapabilityRequest(guide, {
    adapter: 'mailchimp',
    scope: 'mailchimp.campaign',
  });

  return {
    ok: guide.recovery.status === 'ready' && guide.providerSync.status === 'ready' && validation.ok,
    contractId: guide.contractId,
    adapterCount: guide.adapterContracts.length,
    providerServiceCount: guide.providerServices.length,
    validation,
    recoveryCommand: planCapabilityRecoveryCommand(guide, {
      adapter: 'mailchimp',
      scope: 'mailchimp.campaign',
    }),
  };
};
