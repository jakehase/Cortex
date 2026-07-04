import {
  assertConceptModelReady,
  compileConceptModel,
  createConceptAcceptancePreview,
} from './concepts-model.mjs';

export const AIOS_LANGUAGE_TOUR_VERSION = 'aios-language.tour.v1';

export const TOUR_SOURCE = `
  capability mailchimp-audience-read scope=mailchimp.audience adapter=mailchimp recovery=status-handoff
  capability mailchimp-campaign-send scope=mailchimp.campaign adapter=mailchimp recovery=status-handoff
  memory campaign-draft durability=durable retention=workflow
  memory adapter-status durability=ephemeral retention=job
  verifier consent-and-content mode=deterministic requires=mailchimp-audience-read,mailchimp-campaign-send
  claim send-is-safe verifier=consent-and-content evidence=adapter-status
  job prepare-campaign uses=mailchimp-audience-read memory=campaign-draft,adapter-status verify=consent-and-content claim=send-is-safe
  job send-campaign uses=mailchimp-campaign-send memory=campaign-draft,adapter-status verify=consent-and-content claim=send-is-safe
`;

const describeJobStep = (job, contract) => {
  const capabilities = job.capabilityRefs.map((name) => contract.capabilities.find((capability) => capability.name === name));
  const memories = job.memoryRefs.map((name) => contract.memories.find((memory) => memory.name === name));
  const verifiers = job.verifierRefs.map((name) => contract.verifiers.find((verifier) => verifier.name === name));
  const claims = job.claimRefs.map((name) => contract.claims.find((claim) => claim.name === name));

  return {
    id: `tour.step.${job.name}`,
    title: job.name,
    sourceLine: job.sourceLine,
    kernelJob: job.id,
    capabilityContracts: capabilities.filter(Boolean).map((capability) => ({
      id: capability.id,
      scope: capability.scope,
      adapter: capability.adapter,
      providerService: capability.providerService,
      providerRegion: capability.providerRegion,
      operation: capability.operation,
      syncStrategy: capability.syncStrategy,
      syncCursor: capability.syncCursor,
      externalState: capability.externalState,
      negotiates: capability.negotiates,
      recovery: capability.recovery,
    })),
    memoryContracts: memories.filter(Boolean).map((memory) => ({
      id: memory.id,
      durability: memory.durability,
      retention: memory.retention,
    })),
    verifierContracts: verifiers.filter(Boolean).map((verifier) => ({
      id: verifier.id,
      mode: verifier.mode,
      requires: verifier.requires,
    })),
    claimContracts: claims.filter(Boolean).map((claim) => ({
      id: claim.id,
      verifierRef: claim.verifierRef,
      evidence: claim.evidence,
    })),
    clientRuntime: {
      command: job.providerCommand,
      idempotencyKey: job.idempotencyKey,
      statusTopic: `client.runtime.${job.name}.status`,
      resumeToken: `resume.${contract.contractId}.${job.name}`,
      externalStateKeys: capabilities.filter(Boolean).map((capability) => capability.externalState).sort(),
      syncCursors: capabilities.filter(Boolean).map((capability) => capability.syncCursor).sort(),
    },
  };
};

const buildWorkflowHandoff = (contract, steps) => {
  const preview = createConceptAcceptancePreview(contract);
  const stepStates = steps.map((step, index) => ({
    stepId: step.id,
    order: index + 1,
    command: step.clientRuntime.command,
    idempotencyKey: step.clientRuntime.idempotencyKey,
    resumeToken: step.clientRuntime.resumeToken,
    statusTopic: step.clientRuntime.statusTopic,
    providerOperations: step.capabilityContracts.map((capability) => ({
      capabilityId: capability.id,
      adapter: capability.adapter,
      service: capability.providerService,
      operation: capability.operation,
      syncCursor: capability.syncCursor,
      externalState: capability.externalState,
    })),
  }));

  return {
    accepted: preview.accepted,
    readiness: preview.readiness,
    status: contract.providerSyncPlan.status,
    route: contract.providerSyncPlan.handoff,
    retryable: contract.providerSyncPlan.retryable,
    nextSteps: preview.nextSteps,
    requiredCapabilities: contract.providerSyncPlan.requiredCapabilities,
    providerServices: contract.providerContracts.map((provider) => ({
      id: provider.id,
      adapter: provider.adapter,
      service: provider.service,
      region: provider.region,
      negotiation: provider.negotiation,
    })),
    externalStateKeys: contract.providerSyncPlan.externalStateKeys,
    statusMemory: contract.providerSyncPlan.statusMemoryRef,
    durableMemory: contract.providerSyncPlan.durableMemoryRef,
    stepStates,
  };
};

export const createLanguageTour = (source = TOUR_SOURCE, options = {}) => {
  const contract = assertConceptModelReady(compileConceptModel(source, {
    sourceId: options.sourceId || 'language-tour.aios',
    defaultScope: options.defaultScope,
  }));

  const steps = contract.jobs.map((job) => describeJobStep(job, contract));
  const adapterHandoff = {
    status: contract.recovery.status,
    route: contract.recovery.handoff,
    retryable: contract.recovery.retryable,
    requiredCapabilities: contract.capabilities.map((capability) => capability.id),
    statusMemory: contract.memories.find((memory) => memory.name === 'adapter-status')?.id || null,
    providerSync: contract.providerSyncPlan,
  };
  const workflowHandoff = buildWorkflowHandoff(contract, steps);

  return Object.freeze({
    version: AIOS_LANGUAGE_TOUR_VERSION,
    contractId: contract.contractId,
    sourceId: contract.sourceId,
    steps,
    adapterHandoff,
    workflowHandoff,
  });
};

export const explainTourStep = (tour, stepId) => {
  const step = tour.steps.find((candidate) => candidate.id === stepId || candidate.title === stepId);
  if (!step) {
    return {
      found: false,
      stepId,
      recovery: {
        status: 'recoverable',
        handoff: 'adapter.status.recover',
        retryable: true,
        reasons: [`tour.step.missing.${stepId}`],
      },
    };
  }

  return {
    found: true,
    stepId: step.id,
    kernelJob: step.kernelJob,
    capabilities: step.capabilityContracts.map((capability) => capability.id),
    providerOperations: step.capabilityContracts.map((capability) => ({
      capabilityId: capability.id,
      adapter: capability.adapter,
      service: capability.providerService,
      operation: capability.operation,
      syncCursor: capability.syncCursor,
      externalState: capability.externalState,
      negotiation: capability.negotiates,
    })),
    memories: step.memoryContracts.map((memory) => memory.id),
    verifiers: step.verifierContracts.map((verifier) => verifier.id),
    claims: step.claimContracts.map((claim) => claim.id),
    clientRuntime: step.clientRuntime,
    recovery: {
      status: 'ready',
      handoff: 'adapter.status.ready',
      retryable: false,
      reasons: [],
    },
  };
};

export const languageTourSelfCheck = () => {
  const tour = createLanguageTour();
  const sendStep = explainTourStep(tour, 'send-campaign');
  return {
    ok: tour.steps.length === 2 && sendStep.found && tour.adapterHandoff.status === 'ready' && tour.workflowHandoff.status === 'ready',
    contractId: tour.contractId,
    stepCount: tour.steps.length,
    adapterHandoff: tour.adapterHandoff,
    workflowHandoff: tour.workflowHandoff,
  };
};
