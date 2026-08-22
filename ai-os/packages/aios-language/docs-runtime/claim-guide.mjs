const DEFAULT_ROUTE = "claim-guide";
const CONTRACT_VERSION = "claim-guide.contract.v1";
const VALID_EFFECTS = new Set(["read", "write", "network", "execute", "memory", "artifact"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "blocked", "recovered"]);
const DEFAULT_PROVIDER_ID = "mailchimp";
const DEFAULT_PROVIDER_SERVICES = ["audiences", "campaigns", "templates", "reports"];
const VALID_PROVIDER_AUTH = new Set(["api-key", "oauth2", "session", "none"]);
const VALID_SYNC_MODES = new Set(["pull", "push", "bidirectional", "webhook"]);
const VALID_NEGOTIATION = new Set(["required", "preferred", "optional"]);

const stableText = (value) => String(value ?? "").trim();

const stableId = (prefix, parts) => {
  const text = parts.map((part) => stableText(part).toLowerCase()).filter(Boolean).join(":");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36).padStart(7, "0")}`;
};

const asArray = (value) => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const uniqueSorted = (values) => {
  return [...new Set(values.map(stableText).filter(Boolean))].sort((left, right) => left.localeCompare(right));
};

const asObject = (value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {});

const diagnostic = (code, message, path, severity = "error") => ({ code, message, path, severity });

const normalizeProviderService = (service, providerId, index) => {
  const serviceObject = typeof service === "string" ? { name: service } : asObject(service);
  const name = stableText(serviceObject.name ?? serviceObject.service);
  const id = stableText(serviceObject.id) || stableId("service", [providerId, index, name]);
  const sync = asObject(serviceObject.sync);
  const cursor = asObject(sync.cursor ?? serviceObject.cursor);
  const scopes = uniqueSorted(asArray(serviceObject.scopes ?? serviceObject.scope));
  const capabilities = uniqueSorted(asArray(serviceObject.capabilities ?? serviceObject.capability));
  const effects = uniqueSorted(asArray(serviceObject.effects).map((effect) => effect.toLowerCase()));

  return {
    id,
    name,
    scopes,
    capabilities,
    effects,
    auth: stableText(serviceObject.auth) || "api-key",
    sync: {
      mode: stableText(sync.mode ?? serviceObject.syncMode) || "pull",
      topic: stableText(sync.topic) || `${providerId}.${name || id}.sync`,
      cursor: {
        key: stableText(cursor.key) || `${name || id}.updated_at`,
        source: stableText(cursor.source) || "provider",
        checkpoint: stableText(cursor.checkpoint ?? sync.checkpoint),
      },
      metadata: Object.fromEntries(
        Object.entries(asObject(sync.metadata ?? serviceObject.syncMetadata)).map(([key, value]) => [stableText(key), stableText(value) || value]),
      ),
    },
  };
};

const normalizeProvider = (source = {}, route = DEFAULT_ROUTE) => {
  const providerSource = asObject(source.provider ?? source.integrationProvider);
  const providerId = stableText(providerSource.id ?? providerSource.name) || DEFAULT_PROVIDER_ID;
  const rawServices = asArray(providerSource.services ?? providerSource.service);
  const serviceInputs = rawServices.length > 0 ? rawServices : DEFAULT_PROVIDER_SERVICES;
  const services = serviceInputs.map((service, index) => normalizeProviderService(service, providerId, index));
  const handoff = asObject(providerSource.handoff);

  return {
    id: providerId,
    product: stableText(providerSource.product) || "mailchimp",
    displayName: stableText(providerSource.displayName) || "Mailchimp",
    version: stableText(providerSource.version) || "2026-07",
    baseUrl: stableText(providerSource.baseUrl) || "https://api.mailchimp.com/3.0",
    services,
    handoff: {
      stateTopic: stableText(handoff.stateTopic) || `${route}.${providerId}.external-state`,
      statusTopic: stableText(handoff.statusTopic) || `${route}.${providerId}.provider-status`,
      recoveryTopic: stableText(handoff.recoveryTopic) || `${route}.${providerId}.provider-recovery`,
    },
  };
};

export const normalizeClaimGuideSource = (source = {}) => {
  const route = stableText(source.route) || DEFAULT_ROUTE;
  const title = stableText(source.title) || route;
  const intent = stableText(source.intent ?? source.goal);
  const provider = normalizeProvider(source, route);
  const rawClaims = asArray(source.claims);
  const claims = rawClaims.map((claim, index) => {
    const claimText = stableText(typeof claim === "string" ? claim : claim.text ?? claim.claim);
    const id = stableText(claim.id) || stableId("claim", [route, index, claimText]);
    const effects = uniqueSorted(asArray(claim.effects).map((effect) => effect.toLowerCase()));
    const capabilities = uniqueSorted(asArray(claim.capabilities));
    const memories = uniqueSorted(asArray(claim.memories ?? claim.memory));
    const providerServices = uniqueSorted(asArray(claim.providerServices ?? claim.services ?? claim.service));
    const negotiation = asObject(claim.negotiation);
    const verifier = typeof claim.verifier === "object" && claim.verifier !== null ? claim.verifier : {};
    const requiresEvidence = claim.requiresEvidence !== false;

    return {
      id,
      text: claimText,
      effects,
      capabilities,
      memories,
      providerServices,
      negotiation: {
        mode: stableText(negotiation.mode ?? claim.negotiationMode) || "required",
        fallbackService: stableText(negotiation.fallbackService ?? claim.fallbackService),
        externalHandoff: stableText(negotiation.externalHandoff ?? claim.externalHandoff) || provider.handoff.stateTopic,
      },
      requiresEvidence,
      verifier: {
        id: stableText(verifier.id) || stableId("verifier", [route, id, claimText]),
        mode: stableText(verifier.mode) || "deterministic",
        evidence: uniqueSorted(asArray(verifier.evidence ?? claim.evidence)),
        recovery: stableText(verifier.recovery ?? claim.recovery) || "adapter-status-handoff",
      },
    };
  });

  return {
    contractVersion: CONTRACT_VERSION,
    route,
    title,
    intent,
    provider,
    claims,
    adapter: {
      id: stableText(source.adapter?.id) || stableId("adapter", [route, title]),
      statusTopic: stableText(source.adapter?.statusTopic) || `${route}.status`,
      recoveryTopic: stableText(source.adapter?.recoveryTopic) || `${route}.recovery`,
    },
    memoryScope: stableText(source.memoryScope) || route,
  };
};

export const validateClaimGuideSource = (source = {}) => {
  const normalized = normalizeClaimGuideSource(source);
  const diagnostics = [];

  if (!normalized.intent) {
    diagnostics.push(diagnostic("claim_guide.intent.missing", "Claim guide source must declare an intent or goal.", "intent"));
  }

  if (normalized.claims.length === 0) {
    diagnostics.push(diagnostic("claim_guide.claims.empty", "Claim guide source must contain at least one claim.", "claims"));
  }

  if (!normalized.provider.id) {
    diagnostics.push(diagnostic("claim_guide.provider.id.missing", "Provider contract must include a stable provider id.", "provider.id"));
  }

  const serviceNames = new Set(normalized.provider.services.map((service) => service.name).filter(Boolean));
  const serviceIds = new Set(normalized.provider.services.map((service) => service.id).filter(Boolean));
  normalized.provider.services.forEach((service, serviceIndex) => {
    const path = `provider.services[${serviceIndex}]`;
    if (!service.name) {
      diagnostics.push(diagnostic("claim_guide.provider.service.name.missing", "Provider service contracts must declare a service name.", `${path}.name`));
    }
    if (!VALID_PROVIDER_AUTH.has(service.auth)) {
      diagnostics.push(diagnostic("claim_guide.provider.service.auth.invalid", `Unsupported provider auth mode "${service.auth}".`, `${path}.auth`));
    }
    if (!VALID_SYNC_MODES.has(service.sync.mode)) {
      diagnostics.push(diagnostic("claim_guide.provider.service.sync.invalid", `Unsupported provider sync mode "${service.sync.mode}".`, `${path}.sync.mode`));
    }
    const invalidServiceEffects = service.effects.filter((effect) => !VALID_EFFECTS.has(effect));
    invalidServiceEffects.forEach((effect) => {
      diagnostics.push(diagnostic("claim_guide.provider.service.effect.invalid", `Unsupported provider service effect "${effect}".`, `${path}.effects`));
    });
    if (service.sync.mode !== "push" && !service.sync.cursor.key) {
      diagnostics.push(diagnostic("claim_guide.provider.service.cursor.missing", "Pulling provider services must define a sync cursor key.", `${path}.sync.cursor.key`));
    }
  });

  normalized.claims.forEach((claim, claimIndex) => {
    const path = `claims[${claimIndex}]`;
    if (!claim.text) {
      diagnostics.push(diagnostic("claim_guide.claim.text.missing", "Each claim must provide stable claim text.", `${path}.text`));
    }
    const invalidEffects = claim.effects.filter((effect) => !VALID_EFFECTS.has(effect));
    invalidEffects.forEach((effect) => {
      diagnostics.push(diagnostic("claim_guide.claim.effect.invalid", `Unsupported claim effect "${effect}".`, `${path}.effects`));
    });
    if (claim.requiresEvidence && claim.verifier.evidence.length === 0) {
      diagnostics.push(
        diagnostic(
          "claim_guide.claim.evidence.missing",
          "Evidence-required claims must declare verifier evidence inputs.",
          `${path}.verifier.evidence`,
        ),
      );
    }
    if (!VALID_NEGOTIATION.has(claim.negotiation.mode)) {
      diagnostics.push(diagnostic("claim_guide.claim.negotiation.invalid", `Unsupported capability negotiation mode "${claim.negotiation.mode}".`, `${path}.negotiation.mode`));
    }
    claim.providerServices.forEach((serviceName) => {
      if (!serviceNames.has(serviceName) && !serviceIds.has(serviceName)) {
        diagnostics.push(
          diagnostic(
            "claim_guide.claim.provider_service.unknown",
            `Claim references unknown provider service "${serviceName}".`,
            `${path}.providerServices`,
          ),
        );
      }
    });
  });

  return {
    ok: diagnostics.every((entry) => entry.severity !== "error"),
    normalized,
    diagnostics,
  };
};

const emitCapabilityContracts = (claim) => {
  return claim.capabilities.map((name) => ({
    id: stableId("capability", [claim.id, name]),
    claimId: claim.id,
    name,
    effects: claim.effects,
    required: true,
  }));
};

const emitProviderServiceContracts = (normalized) => {
  return normalized.provider.services.map((service, order) => ({
    id: stableId("provider_service", [normalized.provider.id, service.id, service.name]),
    providerId: normalized.provider.id,
    order,
    serviceId: service.id,
    name: service.name,
    scopes: service.scopes,
    capabilities: service.capabilities,
    effects: service.effects,
    auth: service.auth,
    sync: service.sync,
  }));
};

const resolveClaimProviderServices = (claim, providerServiceContracts) => {
  if (claim.providerServices.length === 0) {
    return providerServiceContracts
      .filter((service) => service.capabilities.some((capability) => claim.capabilities.includes(capability)))
      .map((service) => service.id);
  }

  return providerServiceContracts
    .filter((service) => claim.providerServices.includes(service.name) || claim.providerServices.includes(service.serviceId))
    .map((service) => service.id);
};

const emitNegotiationContracts = (normalized, providerServiceContracts) => {
  return normalized.claims.map((claim) => {
    const providerServices = resolveClaimProviderServices(claim, providerServiceContracts);
    const requiredCapabilities = uniqueSorted([
      ...claim.capabilities,
      ...providerServiceContracts
        .filter((service) => providerServices.includes(service.id))
        .flatMap((service) => service.capabilities),
    ]);

    return {
      id: stableId("negotiation", [normalized.provider.id, claim.id, claim.negotiation.mode, providerServices.join(",")]),
      claimId: claim.id,
      providerId: normalized.provider.id,
      mode: claim.negotiation.mode,
      providerServices,
      requiredCapabilities,
      fallbackService: claim.negotiation.fallbackService || null,
      externalHandoff: claim.negotiation.externalHandoff,
      satisfied: claim.negotiation.mode !== "required" || providerServices.length > 0 || requiredCapabilities.length === 0,
    };
  });
};

const emitMemoryContracts = (claim, memoryScope) => {
  return claim.memories.map((name) => ({
    id: stableId("memory", [memoryScope, claim.id, name]),
    claimId: claim.id,
    scope: memoryScope,
    name,
    mode: claim.effects.includes("write") || claim.effects.includes("memory") ? "readwrite" : "readonly",
  }));
};

const emitVerifierContract = (claim) => ({
  id: claim.verifier.id,
  claimId: claim.id,
  mode: claim.verifier.mode,
  evidence: claim.verifier.evidence,
  recovery: claim.verifier.recovery,
  deterministic: claim.verifier.mode === "deterministic",
});

export const compileClaimGuide = (source = {}) => {
  const validation = validateClaimGuideSource(source);
  const normalized = validation.normalized;
  const claimContracts = normalized.claims.map((claim, order) => ({
    id: claim.id,
    order,
    text: claim.text,
    effects: claim.effects,
    providerServices: claim.providerServices,
    requiresEvidence: claim.requiresEvidence,
  }));
  const providerServiceContracts = emitProviderServiceContracts(normalized);
  const negotiationContracts = emitNegotiationContracts(normalized, providerServiceContracts);
  const capabilityContracts = normalized.claims.flatMap(emitCapabilityContracts);
  const memoryContracts = normalized.claims.flatMap((claim) => emitMemoryContracts(claim, normalized.memoryScope));
  const verifierContracts = normalized.claims.map(emitVerifierContract);
  const jobContract = {
    id: stableId("job", [normalized.route, normalized.title, normalized.intent]),
    route: normalized.route,
    title: normalized.title,
    intent: normalized.intent,
    provider: normalized.provider.id,
    claims: claimContracts.map((claim) => claim.id),
    capabilities: capabilityContracts.map((capability) => capability.id),
    memories: memoryContracts.map((memory) => memory.id),
    verifiers: verifierContracts.map((verifier) => verifier.id),
    providerServices: providerServiceContracts.map((service) => service.id),
    negotiations: negotiationContracts.map((negotiation) => negotiation.id),
  };

  return {
    ok: validation.ok,
    diagnostics: validation.diagnostics,
    contractVersion: normalized.contractVersion,
    jobContract,
    claimContracts,
    providerContract: {
      id: normalized.provider.id,
      product: normalized.provider.product,
      displayName: normalized.provider.displayName,
      version: normalized.provider.version,
      baseUrl: normalized.provider.baseUrl,
      handoff: normalized.provider.handoff,
    },
    providerServiceContracts,
    negotiationContracts,
    capabilityContracts,
    memoryContracts,
    verifierContracts,
    adapterHandoff: createAdapterHandoff(normalized, jobContract, validation.diagnostics),
  };
};

export const createAdapterHandoff = (normalized, jobContract, diagnostics = []) => {
  const severity = diagnostics.some((entry) => entry.severity === "error") ? "blocked" : "ready";
  return {
    adapterId: normalized.adapter.id,
    providerId: normalized.provider.id,
    statusTopic: normalized.adapter.statusTopic,
    recoveryTopic: normalized.adapter.recoveryTopic,
    externalStateTopic: normalized.provider.handoff.stateTopic,
    providerStatusTopic: normalized.provider.handoff.statusTopic,
    providerRecoveryTopic: normalized.provider.handoff.recoveryTopic,
    jobId: jobContract.id,
    route: normalized.route,
    status: severity,
    diagnostics: diagnostics.map(({ code, message, path, severity: entrySeverity }) => ({
      code,
      message,
      path,
      severity: entrySeverity,
    })),
  };
};

export const createProviderExternalState = (compiled, state = {}) => {
  const serviceName = stableText(state.service ?? state.serviceName);
  const service = serviceName
    ? compiled.providerServiceContracts.find((entry) => entry.name === serviceName || entry.serviceId === serviceName)
    : null;
  const diagnostics = [];

  if (serviceName && !service) {
    diagnostics.push(diagnostic("claim_guide.provider_state.service.unknown", `Unknown provider service "${serviceName}".`, "state.service"));
  }

  return {
    ok: diagnostics.length === 0,
    providerId: compiled.providerContract.id,
    topic: compiled.providerContract.handoff.stateTopic,
    jobId: compiled.jobContract.id,
    serviceId: service?.serviceId ?? null,
    serviceName: (service?.name ?? serviceName) || null,
    syncMode: (service?.sync.mode ?? stableText(state.syncMode)) || "pull",
    cursor: {
      key: (service?.sync.cursor.key ?? stableText(state.cursorKey)) || null,
      source: (service?.sync.cursor.source ?? stableText(state.cursorSource)) || "provider",
      checkpoint: stableText(state.checkpoint) || service?.sync.cursor.checkpoint || null,
    },
    externalStatus: stableText(state.status) || "pending",
    metadata: Object.fromEntries(
      Object.entries(asObject(state.metadata)).map(([key, value]) => [stableText(key), stableText(value) || value]),
    ),
    diagnostics,
  };
};

export const negotiateProviderCapabilities = (compiled, request = {}) => {
  const requestedClaimId = stableText(request.claimId);
  const requestedService = stableText(request.service ?? request.serviceName);
  const claimNegotiations = requestedClaimId
    ? compiled.negotiationContracts.filter((entry) => entry.claimId === requestedClaimId)
    : compiled.negotiationContracts;
  const diagnostics = [];

  if (requestedClaimId && claimNegotiations.length === 0) {
    diagnostics.push(diagnostic("claim_guide.provider_negotiation.claim.unknown", `Unknown claim "${requestedClaimId}".`, "request.claimId"));
  }

  const serviceContracts = requestedService
    ? compiled.providerServiceContracts.filter((service) => service.name === requestedService || service.serviceId === requestedService)
    : compiled.providerServiceContracts;

  if (requestedService && serviceContracts.length === 0) {
    diagnostics.push(
      diagnostic("claim_guide.provider_negotiation.service.unknown", `Unknown provider service "${requestedService}".`, "request.service"),
    );
  }

  const serviceIds = new Set(serviceContracts.map((service) => service.id));
  const matched = claimNegotiations.map((negotiation) => {
    const services = negotiation.providerServices.filter((serviceId) => serviceIds.has(serviceId));
    const selectedServices = services.length > 0 ? services : negotiation.providerServices;
    return {
      claimId: negotiation.claimId,
      negotiationId: negotiation.id,
      mode: negotiation.mode,
      providerServices: selectedServices,
      capabilities: negotiation.requiredCapabilities,
      externalHandoff: negotiation.externalHandoff,
      fallbackService: negotiation.fallbackService,
      satisfied: negotiation.mode !== "required" || selectedServices.length > 0 || negotiation.requiredCapabilities.length === 0,
    };
  });

  return {
    ok: diagnostics.length === 0 && matched.every((entry) => entry.satisfied),
    providerId: compiled.providerContract.id,
    jobId: compiled.jobContract.id,
    topic: compiled.providerContract.handoff.statusTopic,
    matched,
    diagnostics,
  };
};

export const createClaimStatusUpdate = (compiled, status, details = {}) => {
  const cleanStatus = stableText(status) || "unknown";
  const claimId = stableText(details.claimId);
  const knownClaim = !claimId || compiled.claimContracts.some((claim) => claim.id === claimId);
  const diagnostics = knownClaim
    ? []
    : [diagnostic("claim_guide.status.claim.unknown", `Unknown claim "${claimId}" in status handoff.`, "details.claimId")];

  return {
    ok: diagnostics.length === 0 && cleanStatus !== "unknown",
    terminal: TERMINAL_STATUSES.has(cleanStatus),
    adapterId: compiled.adapterHandoff.adapterId,
    topic: compiled.adapterHandoff.statusTopic,
    jobId: compiled.jobContract.id,
    claimId: claimId || null,
    status: cleanStatus,
    details: Object.fromEntries(
      Object.entries(details)
        .filter(([key]) => key !== "claimId")
        .map(([key, value]) => [key, stableText(value) || value]),
    ),
    diagnostics,
  };
};

export const createRecoveryHandoff = (compiled, failure = {}) => {
  const failedClaimId = stableText(failure.claimId);
  const claim = compiled.claimContracts.find((entry) => entry.id === failedClaimId) ?? null;
  const verifier = claim ? compiled.verifierContracts.find((entry) => entry.claimId === claim.id) : null;
  const diagnostics = [];

  if (!failedClaimId) {
    diagnostics.push(diagnostic("claim_guide.recovery.claim.missing", "Recovery handoff must identify the failed claim.", "failure.claimId"));
  } else if (!claim) {
    diagnostics.push(diagnostic("claim_guide.recovery.claim.unknown", `Unknown failed claim "${failedClaimId}".`, "failure.claimId"));
  }

  return {
    ok: diagnostics.length === 0,
    adapterId: compiled.adapterHandoff.adapterId,
    topic: compiled.adapterHandoff.recoveryTopic,
    providerId: compiled.providerContract?.id ?? compiled.adapterHandoff.providerId ?? null,
    providerRecoveryTopic: compiled.providerContract?.handoff?.recoveryTopic ?? compiled.adapterHandoff.providerRecoveryTopic ?? null,
    jobId: compiled.jobContract.id,
    failedClaimId: failedClaimId || null,
    verifierId: verifier?.id ?? null,
    recovery: verifier?.recovery ?? "manual-review",
    reason: stableText(failure.reason) || "unspecified",
    retryable: failure.retryable !== false,
    externalState: createProviderExternalState(compiled, {
      service: failure.service,
      status: "recovery-requested",
      checkpoint: failure.checkpoint,
      metadata: {
        reason: stableText(failure.reason) || "unspecified",
        retryable: failure.retryable !== false,
      },
    }),
    diagnostics,
  };
};

export const selfCheckClaimGuide = (source = {}) => {
  const compiled = compileClaimGuide(source);
  const ids = [
    compiled.jobContract.id,
    ...compiled.claimContracts.map((claim) => claim.id),
    ...compiled.capabilityContracts.map((capability) => capability.id),
    ...compiled.memoryContracts.map((memory) => memory.id),
    ...compiled.verifierContracts.map((verifier) => verifier.id),
  ];
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

  return {
    ok: compiled.ok && duplicateIds.length === 0,
    duplicateIds: uniqueSorted(duplicateIds),
    contractCounts: {
      claims: compiled.claimContracts.length,
      providerServices: compiled.providerServiceContracts.length,
      negotiations: compiled.negotiationContracts.length,
      capabilities: compiled.capabilityContracts.length,
      memories: compiled.memoryContracts.length,
      verifiers: compiled.verifierContracts.length,
    },
    diagnostics: [
      ...compiled.diagnostics,
      ...duplicateIds.map((id) => diagnostic("claim_guide.contract.id.duplicate", `Duplicate contract id "${id}".`, "contracts")),
    ],
  };
};

export default compileClaimGuide;
