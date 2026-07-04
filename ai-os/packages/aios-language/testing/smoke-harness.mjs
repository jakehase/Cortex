import {
  compileConceptModel,
  conceptModelSelfCheck,
  createConceptAcceptancePreview,
} from '../docs-runtime/concepts-model.mjs';
import {
  capabilityGuideSelfCheck,
  createCapabilityGuide,
  planCapabilityRecoveryCommand,
  validateCapabilityRequest,
} from '../docs-runtime/capability-guide.mjs';
import {
  createLanguageTour,
  explainTourStep,
  languageTourSelfCheck,
} from '../docs-runtime/language-tour.mjs';

export const AIOS_SMOKE_HARNESS_VERSION = 'aios-language.smoke-harness.v1';

export const SMOKE_SOURCE = `
  capability mailchimp-audience-read scope=mailchimp.audience adapter=mailchimp recovery=status-handoff
  capability mailchimp-campaign-send scope=mailchimp.campaign adapter=mailchimp recovery=status-handoff
  memory smoke-ledger durability=durable retention=workflow
  memory adapter-status durability=ephemeral retention=job
  verifier smoke-contract mode=deterministic requires=mailchimp-audience-read,mailchimp-campaign-send
  claim smoke-ready verifier=smoke-contract evidence=adapter-status
  job smoke-prepare uses=mailchimp-audience-read memory=smoke-ledger,adapter-status verify=smoke-contract claim=smoke-ready
  job smoke-send uses=mailchimp-campaign-send memory=smoke-ledger,adapter-status verify=smoke-contract claim=smoke-ready
`;

const isSuccessfulResult = (result) => result.ok === true || result.found === true || result.status === 'ready';

const buildCheck = (name, result) => {
  const ok = isSuccessfulResult(result);
  return {
    name,
    ok,
    recovery: result.recovery || result.adapterHandoff || result.validation || {
      status: ok ? 'ready' : 'blocked',
      handoff: ok ? 'adapter.status.ready' : 'adapter.status.blocked',
      retryable: false,
      reasons: ok ? [] : [`${name}.failed`],
    },
    details: result,
  };
};

const buildProviderSmokeMatrix = (contract, tour, guide) => {
  const contractProviders = contract.providerContracts.map((provider) => provider.id);
  const tourProviders = tour.workflowHandoff.providerServices.map((provider) => provider.id);
  const guideProviders = guide.providerServices.map((provider) => provider.id);
  const providerIds = [...new Set([...contractProviders, ...tourProviders, ...guideProviders])].sort();

  return providerIds.map((providerId) => {
    const inContract = contractProviders.includes(providerId);
    const inTour = tourProviders.includes(providerId);
    const inGuide = guideProviders.includes(providerId);
    const guideProvider = guide.providerServices.find((provider) => provider.id === providerId);
    const workflowProvider = tour.workflowHandoff.providerServices.find((provider) => provider.id === providerId);
    const operations = [...new Set([
      ...(guideProvider?.operations || []),
      ...(workflowProvider?.negotiation?.required || []),
    ])].sort();

    return {
      providerId,
      ok: inContract && inTour && inGuide,
      surfaces: {
        contract: inContract,
        tour: inTour,
        guide: inGuide,
      },
      operations,
      handoff: {
        status: inContract && inTour && inGuide ? 'ready' : 'recoverable',
        route: inContract && inTour && inGuide ? 'adapter.status.ready' : 'adapter.status.recover',
        retryable: !(inContract && inTour && inGuide),
      },
    };
  });
};

const validateProviderHandoff = ({ contract, tour, guide, validation, recoveryCommand }) => {
  const preview = createConceptAcceptancePreview(contract);
  const providerMatrix = buildProviderSmokeMatrix(contract, tour, guide);
  const missingProviders = providerMatrix
    .filter((entry) => !entry.ok)
    .map((entry) => `provider.surface.missing.${entry.providerId}`);
  const missingState = contract.providerSyncPlan.externalStateKeys
    .filter((stateKey) => !tour.workflowHandoff.externalStateKeys.includes(stateKey))
    .map((stateKey) => `provider.state.missing-tour.${stateKey}`);
  const missingGuideState = contract.providerSyncPlan.externalStateKeys
    .filter((stateKey) => !guide.persistedState.some((entry) => entry.stateKeys.includes(stateKey)))
    .map((stateKey) => `provider.state.missing-guide.${stateKey}`);
  const commandReady = recoveryCommand.command.idempotencyKey
    && recoveryCommand.restartSafe.statusMemoryRef
    && recoveryCommand.restartSafe.stateKeys.length > 0;
  const reasons = [
    ...missingProviders,
    ...missingState,
    ...missingGuideState,
    ...(preview.accepted ? [] : preview.validation.reasons),
    ...(validation.ok ? [] : validation.reasons),
    ...(commandReady ? [] : ['provider.command.not-restart-safe']),
  ].sort();
  const status = reasons.length === 0 ? 'ready' : reasons.some((reason) => reason.includes('missing-guide')) ? 'recoverable' : 'blocked';

  return {
    ok: reasons.length === 0,
    status,
    recovery: {
      status,
      handoff: status === 'ready' ? 'adapter.status.ready' : status === 'recoverable' ? 'adapter.status.recover' : 'adapter.status.blocked',
      retryable: status === 'recoverable',
      reasons,
    },
    preview,
    providerMatrix,
    externalHandoff: {
      statusMemoryRef: contract.providerSyncPlan.statusMemoryRef,
      durableMemoryRef: contract.providerSyncPlan.durableMemoryRef,
      stateKeys: contract.providerSyncPlan.externalStateKeys,
      route: tour.workflowHandoff.route,
      recoveryCommand: recoveryCommand.command,
      restartSafe: recoveryCommand.restartSafe,
    },
  };
};

export const createSmokeContract = (source = SMOKE_SOURCE, options = {}) => compileConceptModel(source, {
  sourceId: options.sourceId || 'smoke-harness.aios',
  defaultScope: options.defaultScope,
});

export const runAiosLanguageSmokeHarness = (options = {}) => {
  const contract = createSmokeContract(options.source, options);
  const tour = createLanguageTour(options.tourSource, {
    sourceId: options.tourSourceId || 'smoke-language-tour.aios',
  });
  const guide = createCapabilityGuide(options.guideSource, {
    sourceId: options.guideSourceId || 'smoke-capability-guide.aios',
  });
  const capabilityValidation = validateCapabilityRequest(guide, {
    adapter: 'mailchimp',
    scope: 'mailchimp.campaign',
  });
  const recoveryCommand = planCapabilityRecoveryCommand(guide, {
    adapter: 'mailchimp',
    scope: 'mailchimp.campaign',
  });
  const providerHandoff = validateProviderHandoff({
    contract,
    tour,
    guide,
    validation: capabilityValidation,
    recoveryCommand,
  });

  const checks = [
    buildCheck('concept-model', conceptModelSelfCheck()),
    buildCheck('language-tour', languageTourSelfCheck()),
    buildCheck('capability-guide', capabilityGuideSelfCheck()),
    buildCheck('smoke-contract-ready', {
      ok: contract.recovery.status === 'ready',
      recovery: contract.recovery,
      contractId: contract.contractId,
    }),
    buildCheck('smoke-tour-step', explainTourStep(tour, 'send-campaign')),
    buildCheck('smoke-capability-request', capabilityValidation),
    buildCheck('smoke-provider-handoff', providerHandoff),
  ];

  const failed = checks.filter((check) => !check.ok);
  const recoverable = checks.filter((check) => check.recovery?.retryable);
  const status = failed.length === 0 ? 'ready' : recoverable.length === failed.length ? 'recoverable' : 'blocked';

  return Object.freeze({
    version: AIOS_SMOKE_HARNESS_VERSION,
    ok: failed.length === 0,
    status,
    contractId: contract.contractId,
    recovery: {
      status,
      handoff: status === 'ready' ? 'adapter.status.ready' : status === 'recoverable' ? 'adapter.status.recover' : 'adapter.status.blocked',
      retryable: status === 'recoverable',
      reasons: failed.flatMap((check) => check.recovery?.reasons || [`${check.name}.failed`]).sort(),
    },
    providerHandoff: providerHandoff.externalHandoff,
    providerMatrix: providerHandoff.providerMatrix,
    checks,
    exports: {
      contractJobs: contract.jobs.map((job) => job.id),
      contractCapabilities: contract.capabilities.map((capability) => capability.id),
      providerContracts: contract.providerContracts.map((provider) => provider.id),
      providerStateKeys: contract.providerSyncPlan.externalStateKeys,
      tourSteps: tour.steps.map((step) => step.id),
      tourResumeTokens: tour.workflowHandoff.stepStates.map((step) => step.resumeToken),
      guideAdapters: guide.adapterContracts.map((adapterContract) => adapterContract.adapter),
      guideRecoveryCommands: guide.persistedState.map((state) => state.commandId),
    },
  });
};

export const smokeHarnessSelfCheck = () => {
  const result = runAiosLanguageSmokeHarness();
  return {
    ok: result.ok && result.status === 'ready' && result.checks.length === 7 && result.providerMatrix.every((entry) => entry.ok),
    status: result.status,
    contractId: result.contractId,
    checkCount: result.checks.length,
    recovery: result.recovery,
    providerHandoff: result.providerHandoff,
  };
};
