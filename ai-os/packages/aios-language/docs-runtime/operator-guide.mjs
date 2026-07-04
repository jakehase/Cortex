import {
  compileClaimGuide,
  createClaimStatusUpdate,
  createProviderExternalState,
  createRecoveryHandoff,
  negotiateProviderCapabilities,
} from "./claim-guide.mjs";

const OPERATOR_CONTRACT_VERSION = "operator-guide.contract.v1";

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

const asObject = (value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {});

const uniqueSorted = (values) => {
  return [...new Set(values.map(stableText).filter(Boolean))].sort((left, right) => left.localeCompare(right));
};

const diagnostic = (code, message, path, severity = "error") => ({ code, message, path, severity });

const normalizeOperatorAction = (action, compiled, index) => {
  const actionObject = typeof action === "string" ? { name: action } : asObject(action);
  const serviceName = stableText(actionObject.service ?? actionObject.serviceName);
  const claimId = stableText(actionObject.claimId);
  const service = compiled.providerServiceContracts.find((entry) => entry.name === serviceName || entry.serviceId === serviceName) ?? null;
  const claim = compiled.claimContracts.find((entry) => entry.id === claimId) ?? null;
  const type = stableText(actionObject.type) || (service?.sync.mode === "webhook" ? "inspect-webhook" : "resync-service");

  return {
    id: stableText(actionObject.id) || stableId("operator_action", [compiled.jobContract.id, index, type, serviceName, claimId]),
    type,
    providerId: compiled.providerContract.id,
    serviceId: service?.serviceId ?? null,
    serviceName: (service?.name ?? serviceName) || null,
    claimId: (claim?.id ?? claimId) || null,
    status: stableText(actionObject.status) || "pending",
    retryable: actionObject.retryable !== false,
    evidence: uniqueSorted(asArray(actionObject.evidence)),
    externalState: createProviderExternalState(compiled, {
      service: service?.name ?? serviceName,
      status: stableText(actionObject.externalStatus) || "operator-review",
      checkpoint: actionObject.checkpoint,
      metadata: {
        actionType: type,
        claimId: claim?.id ?? claimId,
      },
    }),
  };
};

export const normalizeOperatorGuideSource = (source = {}) => {
  const claimSource = {
    ...source,
    route: stableText(source.route) || "mailchimp-operator-guide",
    provider: {
      product: "mailchimp",
      ...asObject(source.provider),
    },
  };
  const compiledClaimGuide = compileClaimGuide(claimSource);
  const operator = asObject(source.operator);
  const rawActions = asArray(operator.actions ?? source.actions);
  const actions = rawActions.length > 0
    ? rawActions.map((action, index) => normalizeOperatorAction(action, compiledClaimGuide, index))
    : compiledClaimGuide.providerServiceContracts.map((service, index) =>
        normalizeOperatorAction({ service: service.name, type: "resync-service" }, compiledClaimGuide, index),
      );

  return {
    contractVersion: OPERATOR_CONTRACT_VERSION,
    id: stableText(operator.id) || stableId("operator", [compiledClaimGuide.jobContract.id, compiledClaimGuide.providerContract.id]),
    providerId: compiledClaimGuide.providerContract.id,
    claimGuide: compiledClaimGuide,
    actions,
    statusTopic: stableText(operator.statusTopic) || compiledClaimGuide.providerContract.handoff.statusTopic,
    recoveryTopic: stableText(operator.recoveryTopic) || compiledClaimGuide.providerContract.handoff.recoveryTopic,
  };
};

export const validateOperatorGuideSource = (source = {}) => {
  const normalized = normalizeOperatorGuideSource(source);
  const diagnostics = [...normalized.claimGuide.diagnostics];
  const serviceNames = new Set(normalized.claimGuide.providerServiceContracts.map((service) => service.name));
  const claimIds = new Set(normalized.claimGuide.claimContracts.map((claim) => claim.id));

  if (normalized.actions.length === 0) {
    diagnostics.push(diagnostic("operator_guide.actions.empty", "Operator guide must define at least one provider action.", "operator.actions"));
  }

  normalized.actions.forEach((action, index) => {
    const path = `operator.actions[${index}]`;
    if (!action.serviceName) {
      diagnostics.push(diagnostic("operator_guide.action.service.missing", "Operator actions must target a Mailchimp provider service.", `${path}.service`));
    } else if (!serviceNames.has(action.serviceName)) {
      diagnostics.push(diagnostic("operator_guide.action.service.unknown", `Unknown provider service "${action.serviceName}".`, `${path}.service`));
    }
    if (action.claimId && !claimIds.has(action.claimId)) {
      diagnostics.push(diagnostic("operator_guide.action.claim.unknown", `Unknown claim "${action.claimId}".`, `${path}.claimId`));
    }
  });

  return {
    ok: diagnostics.every((entry) => entry.severity !== "error"),
    normalized,
    diagnostics,
  };
};

export const compileOperatorGuide = (source = {}) => {
  const validation = validateOperatorGuideSource(source);
  const normalized = validation.normalized;
  const negotiation = negotiateProviderCapabilities(normalized.claimGuide);
  const actionContracts = normalized.actions.map((action, order) => ({
    id: action.id,
    order,
    type: action.type,
    providerId: action.providerId,
    serviceId: action.serviceId,
    serviceName: action.serviceName,
    claimId: action.claimId,
    status: action.status,
    retryable: action.retryable,
    evidence: action.evidence,
    externalState: action.externalState,
  }));

  return {
    ok: validation.ok && negotiation.ok,
    diagnostics: [...validation.diagnostics, ...negotiation.diagnostics],
    contractVersion: normalized.contractVersion,
    operatorContract: {
      id: normalized.id,
      providerId: normalized.providerId,
      jobId: normalized.claimGuide.jobContract.id,
      statusTopic: normalized.statusTopic,
      recoveryTopic: normalized.recoveryTopic,
      actions: actionContracts.map((action) => action.id),
    },
    actionContracts,
    negotiation,
    providerContract: normalized.claimGuide.providerContract,
    adapterHandoff: {
      adapterId: normalized.claimGuide.adapterHandoff.adapterId,
      providerId: normalized.providerId,
      topic: normalized.statusTopic,
      recoveryTopic: normalized.recoveryTopic,
      status: validation.ok ? "ready" : "blocked",
    },
  };
};

export const createOperatorStatusHandoff = (compiled, actionId, status, details = {}) => {
  const action = compiled.actionContracts.find((entry) => entry.id === actionId) ?? null;
  const diagnostics = action
    ? []
    : [diagnostic("operator_guide.status.action.unknown", `Unknown operator action "${stableText(actionId)}".`, "actionId")];

  return {
    ok: diagnostics.length === 0,
    providerId: compiled.operatorContract.providerId,
    topic: compiled.operatorContract.statusTopic,
    actionId: (action?.id ?? stableText(actionId)) || null,
    status: stableText(status) || "unknown",
    serviceName: action?.serviceName ?? null,
    claimStatus: createClaimStatusUpdate(
      {
        adapterHandoff: {
          adapterId: "operator-guide",
          statusTopic: compiled.operatorContract.statusTopic,
        },
        jobContract: { id: compiled.operatorContract.jobId },
        claimContracts: action?.claimId ? [{ id: action.claimId }] : [],
      },
      status,
      { ...details, claimId: action?.claimId ?? details.claimId },
    ),
    diagnostics,
  };
};

export const createOperatorRecoveryHandoff = (compiled, actionId, reason = "operator-action-failed") => {
  const action = compiled.actionContracts.find((entry) => entry.id === actionId) ?? null;
  const diagnostics = action
    ? []
    : [diagnostic("operator_guide.recovery.action.unknown", `Unknown operator action "${stableText(actionId)}".`, "actionId")];

  return {
    ok: diagnostics.length === 0,
    providerId: compiled.operatorContract.providerId,
    topic: compiled.operatorContract.recoveryTopic,
    actionId: (action?.id ?? stableText(actionId)) || null,
    recovery: action
      ? createRecoveryHandoff(
          {
            adapterHandoff: {
              adapterId: "operator-guide",
              recoveryTopic: compiled.operatorContract.recoveryTopic,
              providerRecoveryTopic: compiled.operatorContract.recoveryTopic,
            },
            providerContract: compiled.providerContract,
            providerServiceContracts: compiled.actionContracts.map((entry) => ({
              serviceId: entry.serviceId,
              name: entry.serviceName,
              sync: entry.externalState,
            })),
            jobContract: { id: compiled.operatorContract.jobId },
            claimContracts: action.claimId ? [{ id: action.claimId }] : [],
            verifierContracts: action.claimId ? [{ id: stableId("operator_verifier", [action.id]), claimId: action.claimId, recovery: action.type }] : [],
          },
          { claimId: action.claimId, service: action.serviceName, reason, retryable: action.retryable },
        )
      : null,
    diagnostics,
  };
};

export const selfCheckOperatorGuide = (source = {}) => {
  const compiled = compileOperatorGuide(source);
  const ids = [compiled.operatorContract.id, ...compiled.actionContracts.map((entry) => entry.id)];
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

  return {
    ok: compiled.ok && duplicateIds.length === 0,
    duplicateIds: uniqueSorted(duplicateIds),
    contractCounts: {
      actions: compiled.actionContracts.length,
      negotiatedClaims: compiled.negotiation.matched.length,
    },
    diagnostics: [
      ...compiled.diagnostics,
      ...duplicateIds.map((id) => diagnostic("operator_guide.contract.id.duplicate", `Duplicate operator contract id "${id}".`, "contracts")),
    ],
  };
};

export default compileOperatorGuide;
