export const surfaceId = "aios_verifier-claim-gate_blocker-report_067";
export const surfaceGroup = "verifier-claim-gate";
export const surfaceName = "blocker-report";

const DEFAULT_ALLOWED_ROLES = new Set(["owner", "admin", "verifier", "auditor"]);
const DEFAULT_ALLOWED_CLAIM_STATES = new Set(["ready", "verified", "waived"]);
const DEFAULT_REQUIRED_HEALTH_CHECKS = ["proof-store", "audit-log", "claim-index"];
const DEFAULT_REQUIRED_PROVIDER_CAPABILITIES = ["claim.blocker-report.v1", "proof.read", "audit.append", "sync.cursor"];
const HEALTHY_STATES = new Set(["ok", "healthy", "ready"]);
const DEGRADED_STATES = new Set(["degraded", "slow", "stale"]);
const FAILED_STATES = new Set(["down", "failed", "error", "timeout", "unreachable", "rate_limited"]);
const TRANSIENT_FAILURE_STATES = new Set(["timeout", "unreachable", "rate_limited", "slow"]);

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map(asNonEmptyString).filter(Boolean))].sort();
}

function asPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function asNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normalizeScope(input) {
  const tenantId = asNonEmptyString(input.tenantId ?? input.tenant?.id);
  const workspaceId = asNonEmptyString(input.workspaceId ?? input.workspace?.id);
  const requestedWorkspaceId = asNonEmptyString(input.requestedWorkspaceId ?? input.request?.workspaceId);
  const actor = input.actor && typeof input.actor === "object" ? input.actor : {};
  const actorTenantId = asNonEmptyString(actor.tenantId);
  const actorWorkspaceIds = asStringList(actor.workspaceIds);

  return {
    tenantId,
    workspaceId,
    requestedWorkspaceId: requestedWorkspaceId || workspaceId,
    actor: {
      id: asNonEmptyString(actor.id) || "anonymous",
      role: asNonEmptyString(actor.role).toLowerCase() || "anonymous",
      tenantId: actorTenantId,
      workspaceIds: actorWorkspaceIds,
      permissions: asStringList(actor.permissions)
    }
  };
}

function normalizeClaims(input) {
  const claims = Array.isArray(input.claims) ? input.claims : [];
  return claims.map((claim, index) => {
    const record = claim && typeof claim === "object" ? claim : {};
    return {
      id: asNonEmptyString(record.id) || `claim:${index + 1}`,
      workspaceId: asNonEmptyString(record.workspaceId),
      tenantId: asNonEmptyString(record.tenantId),
      state: asNonEmptyString(record.state).toLowerCase() || "unknown",
      requiresPermission: asNonEmptyString(record.requiresPermission),
      proofRef: asNonEmptyString(record.proofRef ?? record.evidenceRef),
      auditRef: asNonEmptyString(record.auditRef)
    };
  });
}

function normalizeProofReceipts(input) {
  const proofStore = input.proofStore && typeof input.proofStore === "object" ? input.proofStore : {};
  const receipts = Array.isArray(input.proofReceipts)
    ? input.proofReceipts
    : Array.isArray(proofStore.receipts)
      ? proofStore.receipts
      : [];

  return receipts.map((receipt, index) => {
    const record = receipt && typeof receipt === "object" ? receipt : {};
    const ref = asNonEmptyString(record.ref ?? record.proofRef ?? record.id) || `proof:${index + 1}`;
    const status = asNonEmptyString(record.status ?? record.state).toLowerCase() || "unknown";
    return {
      ref,
      claimId: asNonEmptyString(record.claimId),
      digest: asNonEmptyString(record.digest ?? record.hash ?? record.sha256),
      status,
      verifiedAt: asNonEmptyString(record.verifiedAt ?? record.validatedAt ?? record.signedAt),
      signer: asNonEmptyString(record.signer ?? record.issuer ?? record.principal),
      auditRef: asNonEmptyString(record.auditRef),
      source: asNonEmptyString(record.source ?? record.store) || "proof-store"
    };
  }).sort((left, right) => left.ref.localeCompare(right.ref));
}

function buildProofAuditLedger(scope, claims, input, now) {
  const proofStore = input.proofStore && typeof input.proofStore === "object" ? input.proofStore : {};
  const audit = input.audit && typeof input.audit === "object" ? input.audit : {};
  const trustedStatuses = new Set([
    "verified",
    "accepted",
    "sealed",
    ...asStringList(proofStore.trustedStatuses).map((status) => status.toLowerCase())
  ]);
  const receipts = normalizeProofReceipts(input);
  const receiptsByRef = new Map(receipts.map((receipt) => [receipt.ref, receipt]));
  const blockers = [];
  const claimProofs = claims.map((claim) => {
    const receipt = claim.proofRef ? receiptsByRef.get(claim.proofRef) : null;
    const auditRef = claim.auditRef || receipt?.auditRef || `audit:${scope.tenantId || "unknown"}:${scope.workspaceId || "unknown"}:${claim.id}`;
    const trusted = Boolean(receipt)
      && trustedStatuses.has(receipt.status)
      && Boolean(receipt.digest)
      && Boolean(receipt.signer);

    if (claim.proofRef && !receipt) {
      pushBlocker(blockers, "proof.receipt_missing", "blocking", "Claim proof reference has no proof-store receipt for audit handoff.", {
        claimId: claim.id,
        proofRef: claim.proofRef
      });
    } else if (receipt && !trusted) {
      pushBlocker(blockers, "proof.receipt_untrusted", "blocking", "Claim proof receipt is not trusted for hosted-kernel release.", {
        claimId: claim.id,
        proofRef: claim.proofRef,
        status: receipt.status,
        digestPresent: Boolean(receipt.digest),
        signerPresent: Boolean(receipt.signer)
      });
    }

    return {
      claimId: claim.id,
      proofRef: claim.proofRef || null,
      auditRef,
      receipt,
      trusted,
      appendRequired: Boolean(claim.proofRef),
      appendReady: Boolean(claim.proofRef) && trusted
    };
  });
  const appendRecords = claimProofs
    .filter((proof) => proof.appendRequired)
    .map((proof) => ({
      auditRef: proof.auditRef,
      claimId: proof.claimId,
      proofRef: proof.proofRef,
      proofDigest: proof.receipt?.digest || null,
      proofSigner: proof.receipt?.signer || null,
      receiptStatus: proof.receipt?.status || "missing",
      appendReady: proof.appendReady,
      route: `${surfaceGroup}/${surfaceName}`,
      generatedAt: now
    }));
  const appendReadyCount = appendRecords.filter((record) => record.appendReady).length;
  const appendRequired = appendRecords.length > 0;
  const auditAppendEnabled = audit.appendEnabled !== false;

  if (appendRequired && !auditAppendEnabled) {
    pushBlocker(blockers, "audit.append_disabled", "critical", "Audit append is disabled for a report with proof handoff records.", {
      appendRecordCount: appendRecords.length
    });
  }

  return {
    schema: "aios.verifierClaimGate.blockerReport.proofAuditLedger.v1",
    receiptCount: receipts.length,
    appendRequired,
    appendReady: appendRequired && auditAppendEnabled && appendReadyCount === appendRecords.length,
    appendReadyCount,
    trustedStatuses: [...trustedStatuses].sort(),
    receipts,
    claimProofs,
    appendRecords,
    blockers
  };
}

function normalizeDependencyChecks(input) {
  const health = input.operationalHealth && typeof input.operationalHealth === "object" ? input.operationalHealth : {};
  const dependencies = Array.isArray(input.dependencies)
    ? input.dependencies
    : Array.isArray(health.dependencies)
      ? health.dependencies
      : [];
  const checksByName = new Map();

  for (const dependency of dependencies) {
    const record = dependency && typeof dependency === "object" ? dependency : {};
    const name = asNonEmptyString(record.name ?? record.id);
    if (!name) {
      continue;
    }
    checksByName.set(name, {
      name,
      required: record.required !== false,
      status: asNonEmptyString(record.status ?? record.state).toLowerCase() || "unknown",
      validatedAt: asNonEmptyString(record.validatedAt ?? record.checkedAt),
      lastOkAt: asNonEmptyString(record.lastOkAt),
      errorCode: asNonEmptyString(record.errorCode ?? record.code),
      message: asNonEmptyString(record.message)
    });
  }

  for (const requiredName of DEFAULT_REQUIRED_HEALTH_CHECKS) {
    if (!checksByName.has(requiredName)) {
      checksByName.set(requiredName, {
        name: requiredName,
        required: true,
        status: "missing",
        validatedAt: "",
        lastOkAt: "",
        errorCode: "health.check_missing",
        message: "Required hosted-kernel health check was not supplied."
      });
    }
  }

  return [...checksByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function pushBlocker(blockers, code, severity, message, details = {}) {
  blockers.push({ code, severity, message, details });
}

function normalizeProviderContracts(input) {
  const integration = input.integration && typeof input.integration === "object" ? input.integration : {};
  const providers = Array.isArray(input.integrationProviders)
    ? input.integrationProviders
    : Array.isArray(integration.providers)
      ? integration.providers
      : [];

  return providers.map((provider, index) => {
    const record = provider && typeof provider === "object" ? provider : {};
    const sync = record.sync && typeof record.sync === "object" ? record.sync : {};
    const id = asNonEmptyString(record.id ?? record.name) || `provider:${index + 1}`;
    const status = asNonEmptyString(record.status ?? record.state).toLowerCase() || "unknown";
    const category = HEALTHY_STATES.has(status)
      ? "healthy"
      : DEGRADED_STATES.has(status)
        ? "degraded"
        : FAILED_STATES.has(status)
          ? "failed"
          : "unknown";

    return {
      id,
      type: asNonEmptyString(record.type ?? record.service) || "external",
      required: record.required !== false,
      status,
      category,
      contractVersion: asNonEmptyString(record.contractVersion ?? record.version),
      endpointRef: asNonEmptyString(record.endpointRef ?? record.endpointId),
      capabilities: asStringList(record.capabilities),
      sync: {
        cursor: asNonEmptyString(sync.cursor ?? record.syncCursor),
        watermark: asNonEmptyString(sync.watermark ?? sync.watermarkAt ?? record.watermark),
        state: asNonEmptyString(sync.state ?? record.syncState).toLowerCase() || "unknown",
        updatedAt: asNonEmptyString(sync.updatedAt ?? sync.syncedAt ?? record.syncedAt),
        lagMs: asNonNegativeInteger(sync.lagMs ?? record.syncLagMs, 0)
      }
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function evaluateProviderContracts(input, now) {
  const integration = input.integration && typeof input.integration === "object" ? input.integration : {};
  const maxSyncAgeMs = asPositiveInteger(integration.maxSyncAgeMs ?? input.maxProviderSyncAgeMs, 600000);
  const requiredCapabilities = asStringList([
    ...DEFAULT_REQUIRED_PROVIDER_CAPABILITIES,
    ...asStringList(input.requiredProviderCapabilities ?? integration.requiredCapabilities)
  ]);
  const nowMs = Date.parse(now);
  const providers = normalizeProviderContracts(input).map((provider) => {
    const updatedMs = Date.parse(provider.sync.updatedAt);
    const syncAgeMs = Number.isFinite(nowMs) && Number.isFinite(updatedMs) ? Math.max(0, nowMs - updatedMs) : null;
    const syncFresh = Boolean(provider.sync.cursor) && syncAgeMs !== null && syncAgeMs <= maxSyncAgeMs;
    const negotiatedCapabilities = provider.category === "failed" || !syncFresh
      ? []
      : provider.capabilities.filter((capability) => requiredCapabilities.includes(capability));

    return {
      ...provider,
      sync: { ...provider.sync, ageMs: syncAgeMs, fresh: syncFresh },
      negotiatedCapabilities
    };
  });
  const providedCapabilities = asStringList(providers.flatMap((provider) => provider.negotiatedCapabilities));
  const missingCapabilities = requiredCapabilities.filter((capability) => !providedCapabilities.includes(capability));
  const blockers = [];

  if (providers.length === 0) {
    pushBlocker(blockers, "integration.provider_missing", "critical", "No hosted-kernel integration provider contract was supplied.", {
      requiredCapabilities
    });
  }
  for (const provider of providers) {
    if (!provider.required) {
      continue;
    }
    if (provider.category === "failed" || provider.category === "unknown") {
      pushBlocker(blockers, "integration.provider_unavailable", "critical", "Required integration provider is not available for blocker-report handoff.", {
        providerId: provider.id,
        status: provider.status,
        category: provider.category
      });
    }
    if (!provider.contractVersion) {
      pushBlocker(blockers, "integration.contract_version_missing", "blocking", "Integration provider did not declare a contract version.", {
        providerId: provider.id
      });
    }
    if (!provider.sync.fresh) {
      pushBlocker(blockers, "integration.sync_stale", "blocking", "Integration provider sync cursor is missing or stale.", {
        providerId: provider.id,
        cursor: provider.sync.cursor || null,
        ageMs: provider.sync.ageMs,
        maxSyncAgeMs
      });
    }
  }
  for (const capability of missingCapabilities) {
    pushBlocker(blockers, "integration.capability_missing", "critical", "Hosted-kernel integration providers cannot satisfy a required handoff capability.", {
      capability,
      providedCapabilities
    });
  }

  return {
    providers,
    requiredCapabilities,
    providedCapabilities,
    missingCapabilities,
    maxSyncAgeMs,
    blockers,
    syncMetadata: {
      freshProviderCount: providers.filter((provider) => provider.sync.fresh).length,
      staleProviderIds: providers.filter((provider) => !provider.sync.fresh).map((provider) => provider.id),
      cursors: providers.map((provider) => ({
        providerId: provider.id,
        cursor: provider.sync.cursor || null,
        watermark: provider.sync.watermark || null,
        updatedAt: provider.sync.updatedAt || null,
        ageMs: provider.sync.ageMs,
        fresh: provider.sync.fresh
      }))
    }
  };
}

function normalizeProviderHandoffReceipts(input) {
  const integration = input.integration && typeof input.integration === "object" ? input.integration : {};
  const externalHandoff = input.externalHandoff && typeof input.externalHandoff === "object" ? input.externalHandoff : {};
  const receipts = Array.isArray(input.providerHandoffReceipts)
    ? input.providerHandoffReceipts
    : Array.isArray(externalHandoff.providerReceipts)
      ? externalHandoff.providerReceipts
      : Array.isArray(integration.handoffReceipts)
        ? integration.handoffReceipts
        : [];

  return receipts.map((receipt, index) => {
    const record = receipt && typeof receipt === "object" ? receipt : {};
    return {
      id: asNonEmptyString(record.id ?? record.receiptId) || `provider-handoff:${index + 1}`,
      providerId: asNonEmptyString(record.providerId ?? record.provider),
      handoffRef: asNonEmptyString(record.handoffRef ?? record.ref),
      status: asNonEmptyString(record.status ?? record.state).toLowerCase() || "unknown",
      contractVersion: asNonEmptyString(record.contractVersion ?? record.version),
      cursor: asNonEmptyString(record.cursor ?? record.syncCursor),
      acceptedCapabilities: asStringList(record.acceptedCapabilities ?? record.capabilities),
      receivedAt: asNonEmptyString(record.receivedAt ?? record.acknowledgedAt ?? record.updatedAt),
      expiresAt: asNonEmptyString(record.expiresAt),
      errorCode: asNonEmptyString(record.errorCode ?? record.code)
    };
  }).sort((left, right) => left.providerId.localeCompare(right.providerId) || left.id.localeCompare(right.id));
}

function evaluateProviderHandoffReceipts(input, providerContracts, now) {
  const integration = input.integration && typeof input.integration === "object" ? input.integration : {};
  const externalHandoff = input.externalHandoff && typeof input.externalHandoff === "object" ? input.externalHandoff : {};
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const requestedAction = asNonEmptyString(request.action ?? input.action).toLowerCase();
  const requireAcknowledgement = externalHandoff.requireProviderAcknowledgement === true
    || integration.requireProviderAcknowledgement === true
    || input.requireProviderHandoffAcknowledgement === true
    || requestedAction === "release-claims"
    || requestedAction === "append-audit";
  const acceptedStates = new Set(["accepted", "acknowledged", "ready", ...asStringList(externalHandoff.acceptedStates).map((state) => state.toLowerCase())]);
  const nowMs = Date.parse(now);
  const receipts = normalizeProviderHandoffReceipts(input);
  const providerById = new Map(providerContracts.providers.map((provider) => [provider.id, provider]));
  const receiptByProvider = new Map();

  for (const receipt of receipts) {
    if (!receipt.providerId) {
      continue;
    }
    const previous = receiptByProvider.get(receipt.providerId);
    const previousMs = Date.parse(previous?.receivedAt);
    const receiptMs = Date.parse(receipt.receivedAt);
    if (!previous || Number.isFinite(receiptMs) && (!Number.isFinite(previousMs) || receiptMs >= previousMs)) {
      receiptByProvider.set(receipt.providerId, receipt);
    }
  }

  const requiredProviderIds = providerContracts.providers
    .filter((provider) => provider.required && provider.negotiatedCapabilities.length > 0)
    .map((provider) => provider.id);
  const blockers = [];
  const handoffs = providerContracts.providers.map((provider) => {
    const receipt = receiptByProvider.get(provider.id) || null;
    const expiresMs = Date.parse(receipt?.expiresAt);
    const expired = Boolean(receipt?.expiresAt) && Number.isFinite(nowMs) && Number.isFinite(expiresMs) && expiresMs <= nowMs;
    const cursorMatches = !receipt || !provider.sync.cursor || !receipt.cursor || receipt.cursor === provider.sync.cursor;
    const contractVersionMatches = !receipt
      || !receipt.contractVersion
      || !provider.contractVersion
      || receipt.contractVersion === provider.contractVersion;
    const missingAcceptedCapabilities = provider.negotiatedCapabilities.filter((capability) => !receipt?.acceptedCapabilities.includes(capability));
    const statusAccepted = Boolean(receipt) && acceptedStates.has(receipt.status);
    const ready = Boolean(receipt) && statusAccepted && !expired && cursorMatches && contractVersionMatches && missingAcceptedCapabilities.length === 0;

    if (requireAcknowledgement && provider.required && provider.negotiatedCapabilities.length > 0 && !receipt) {
      pushBlocker(blockers, "integration.handoff_ack_missing", "blocking", "Required provider has not acknowledged the external handoff contract.", {
        providerId: provider.id,
        negotiatedCapabilities: provider.negotiatedCapabilities
      });
    } else if (receipt && !statusAccepted) {
      pushBlocker(blockers, "integration.handoff_ack_rejected", "critical", "Provider handoff acknowledgement is not in an accepted state.", {
        providerId: provider.id,
        receiptId: receipt.id,
        status: receipt.status,
        errorCode: receipt.errorCode || null
      });
    } else if (receipt && expired) {
      pushBlocker(blockers, "integration.handoff_ack_expired", "blocking", "Provider handoff acknowledgement has expired.", {
        providerId: provider.id,
        receiptId: receipt.id,
        expiresAt: receipt.expiresAt
      });
    } else if (receipt && !cursorMatches) {
      pushBlocker(blockers, "integration.handoff_cursor_mismatch", "blocking", "Provider handoff acknowledgement does not match the current sync cursor.", {
        providerId: provider.id,
        receiptId: receipt.id,
        receiptCursor: receipt.cursor || null,
        providerCursor: provider.sync.cursor || null
      });
    } else if (receipt && !contractVersionMatches) {
      pushBlocker(blockers, "integration.handoff_contract_mismatch", "critical", "Provider handoff acknowledgement does not match the negotiated contract version.", {
        providerId: provider.id,
        receiptId: receipt.id,
        receiptContractVersion: receipt.contractVersion || null,
        providerContractVersion: provider.contractVersion || null
      });
    } else if (receipt && missingAcceptedCapabilities.length > 0) {
      pushBlocker(blockers, "integration.handoff_capability_gap", "critical", "Provider handoff acknowledgement did not accept every negotiated capability.", {
        providerId: provider.id,
        receiptId: receipt.id,
        missingAcceptedCapabilities
      });
    }

    return {
      providerId: provider.id,
      required: provider.required,
      requiredForRelease: requiredProviderIds.includes(provider.id),
      receiptId: receipt?.id || null,
      handoffRef: receipt?.handoffRef || null,
      status: receipt?.status || "missing",
      ready,
      cursorMatches,
      contractVersionMatches,
      expired,
      acceptedCapabilities: receipt?.acceptedCapabilities || [],
      missingAcceptedCapabilities,
      receivedAt: receipt?.receivedAt || null,
      expiresAt: receipt?.expiresAt || null
    };
  });
  const unknownReceipts = receipts.filter((receipt) => receipt.providerId && !providerById.has(receipt.providerId));
  for (const receipt of unknownReceipts) {
    pushBlocker(blockers, "integration.handoff_provider_unknown", "blocking", "Provider handoff acknowledgement references an unknown provider contract.", {
      providerId: receipt.providerId,
      receiptId: receipt.id
    });
  }

  return {
    schema: "aios.verifierClaimGate.blockerReport.providerHandoff.v1",
    required: requireAcknowledgement,
    acceptedStates: [...acceptedStates].sort(),
    requiredProviderIds,
    receiptCount: receipts.length,
    readyProviderCount: handoffs.filter((handoff) => handoff.ready).length,
    unknownReceiptCount: unknownReceipts.length,
    state: blockers.length > 0
      ? "blocked"
      : !requireAcknowledgement
        ? "not-required"
        : requiredProviderIds.length === 0
          ? "awaiting-provider"
        : requiredProviderIds.every((providerId) => handoffs.some((handoff) => handoff.providerId === providerId && handoff.ready))
          ? "ready"
          : "awaiting-ack",
    receipts,
    handoffs,
    blockers
  };
}

function normalizeServiceContracts(input) {
  const integration = input.integration && typeof input.integration === "object" ? input.integration : {};
  const serviceContracts = Array.isArray(input.serviceContracts)
    ? input.serviceContracts
    : Array.isArray(integration.serviceContracts)
      ? integration.serviceContracts
      : [];

  return serviceContracts.map((contract, index) => {
    const record = contract && typeof contract === "object" ? contract : {};
    const sla = record.sla && typeof record.sla === "object" ? record.sla : {};
    const handoff = record.handoff && typeof record.handoff === "object" ? record.handoff : {};
    return {
      id: asNonEmptyString(record.id ?? record.contractId) || `service-contract:${index + 1}`,
      providerId: asNonEmptyString(record.providerId ?? record.provider),
      surface: asNonEmptyString(record.surface ?? record.route) || `${surfaceGroup}/${surfaceName}`,
      status: asNonEmptyString(record.status ?? record.state).toLowerCase() || "unknown",
      version: asNonEmptyString(record.version ?? record.contractVersion),
      owner: asNonEmptyString(record.owner ?? record.ownerTeam) || "runtime-orchestrator",
      dataResidency: asStringList(record.dataResidency ?? record.regions),
      allowedCallbackRoutes: asStringList(record.allowedCallbackRoutes ?? handoff.allowedRoutes),
      sla: {
        responseTimeMs: asPositiveInteger(sla.responseTimeMs ?? record.responseTimeMs, 0),
        maxSyncLagMs: asPositiveInteger(sla.maxSyncLagMs ?? record.maxSyncLagMs, 0),
        lastReviewAt: asNonEmptyString(sla.lastReviewAt ?? record.lastReviewAt),
        reviewIntervalMs: asPositiveInteger(sla.reviewIntervalMs ?? record.reviewIntervalMs, 2592000000)
      },
      handoff: {
        mode: asNonEmptyString(handoff.mode ?? record.handoffMode).toLowerCase() || "callback",
        callbackRoute: asNonEmptyString(handoff.callbackRoute ?? record.callbackRoute),
        externalTicketRef: asNonEmptyString(handoff.externalTicketRef ?? record.externalTicketRef),
        state: asNonEmptyString(handoff.state ?? record.handoffState).toLowerCase() || "unknown"
      }
    };
  }).sort((left, right) => left.providerId.localeCompare(right.providerId) || left.id.localeCompare(right.id));
}

function evaluateServiceContracts(input, scope, providerContracts, now) {
  const integration = input.integration && typeof input.integration === "object" ? input.integration : {};
  const requiredResidency = asStringList(input.requiredDataResidency ?? integration.requiredDataResidency);
  const maxResponseTimeMs = asPositiveInteger(integration.maxServiceResponseTimeMs ?? input.maxServiceResponseTimeMs, 5000);
  const nowMs = Date.parse(now);
  const serviceContracts = normalizeServiceContracts(input).map((contract) => {
    const provider = providerContracts.providers.find((candidate) => candidate.id === contract.providerId) || null;
    const reviewedMs = Date.parse(contract.sla.lastReviewAt);
    const reviewAgeMs = Number.isFinite(nowMs) && Number.isFinite(reviewedMs) ? Math.max(0, nowMs - reviewedMs) : null;
    const reviewFresh = reviewAgeMs !== null && reviewAgeMs <= contract.sla.reviewIntervalMs;
    const routeAllowed = contract.handoff.callbackRoute
      ? contract.allowedCallbackRoutes.includes(contract.handoff.callbackRoute)
      : false;
    const residencySatisfied = requiredResidency.length === 0
      || requiredResidency.every((region) => contract.dataResidency.includes(region));
    const syncLagWithinSla = !provider
      || contract.sla.maxSyncLagMs <= 0
      || provider.sync.lagMs <= contract.sla.maxSyncLagMs;
    const responseWithinSla = contract.sla.responseTimeMs > 0 && contract.sla.responseTimeMs <= maxResponseTimeMs;
    const surfaceMatches = contract.surface === `${surfaceGroup}/${surfaceName}`;
    const active = ["active", "ready", "accepted"].includes(contract.status);
    const handoffStateReady = ["ready", "open", "accepted", "callback-armed"].includes(contract.handoff.state);

    return {
      ...contract,
      providerKnown: Boolean(provider),
      providerStatus: provider?.status || "missing",
      reviewAgeMs,
      reviewFresh,
      routeAllowed,
      residencySatisfied,
      syncLagWithinSla,
      responseWithinSla,
      surfaceMatches,
      active,
      handoffStateReady,
      ready: Boolean(provider)
        && active
        && surfaceMatches
        && reviewFresh
        && routeAllowed
        && residencySatisfied
        && syncLagWithinSla
        && responseWithinSla
        && handoffStateReady
    };
  });
  const blockers = [];
  const requiredProviderIds = providerContracts.providers
    .filter((provider) => provider.required && provider.negotiatedCapabilities.length > 0)
    .map((provider) => provider.id);

  for (const providerId of requiredProviderIds) {
    if (!serviceContracts.some((contract) => contract.providerId === providerId)) {
      pushBlocker(blockers, "integration.service_contract_missing", "critical", "Required provider is missing a hosted-kernel service contract.", {
        providerId
      });
    }
  }
  for (const contract of serviceContracts) {
    if (!contract.providerKnown) {
      pushBlocker(blockers, "integration.service_provider_unknown", "critical", "Service contract references an unknown integration provider.", {
        contractId: contract.id,
        providerId: contract.providerId || null
      });
    } else if (!contract.active) {
      pushBlocker(blockers, "integration.service_contract_inactive", "blocking", "Service contract is not active for blocker-report handoff.", {
        contractId: contract.id,
        providerId: contract.providerId,
        status: contract.status
      });
    } else if (!contract.surfaceMatches) {
      pushBlocker(blockers, "integration.service_surface_mismatch", "critical", "Service contract is bound to a different verifier-claim-gate surface.", {
        contractId: contract.id,
        providerId: contract.providerId,
        surface: contract.surface
      });
    } else if (!contract.reviewFresh) {
      pushBlocker(blockers, "integration.service_contract_review_stale", "blocking", "Service contract review metadata is missing or stale.", {
        contractId: contract.id,
        providerId: contract.providerId,
        reviewAgeMs: contract.reviewAgeMs,
        reviewIntervalMs: contract.sla.reviewIntervalMs
      });
    } else if (!contract.routeAllowed) {
      pushBlocker(blockers, "integration.service_callback_route_denied", "critical", "Service contract callback route is not allowed for external handoff.", {
        contractId: contract.id,
        providerId: contract.providerId,
        callbackRoute: contract.handoff.callbackRoute || null
      });
    } else if (!contract.residencySatisfied) {
      pushBlocker(blockers, "integration.service_residency_gap", "critical", "Service contract does not satisfy required data residency for blocker-report handoff.", {
        contractId: contract.id,
        providerId: contract.providerId,
        requiredDataResidency: requiredResidency,
        contractDataResidency: contract.dataResidency
      });
    } else if (!contract.syncLagWithinSla || !contract.responseWithinSla) {
      pushBlocker(blockers, "integration.service_sla_breach", "blocking", "Service contract SLA is not satisfied for hosted-kernel handoff.", {
        contractId: contract.id,
        providerId: contract.providerId,
        syncLagMs: providerContracts.providers.find((provider) => provider.id === contract.providerId)?.sync.lagMs ?? null,
        maxSyncLagMs: contract.sla.maxSyncLagMs || null,
        responseTimeMs: contract.sla.responseTimeMs || null,
        maxResponseTimeMs
      });
    } else if (!contract.handoffStateReady) {
      pushBlocker(blockers, "integration.service_handoff_not_ready", "blocking", "Service contract external handoff state is not ready.", {
        contractId: contract.id,
        providerId: contract.providerId,
        handoffState: contract.handoff.state
      });
    }
  }

  return {
    schema: "aios.verifierClaimGate.blockerReport.serviceContracts.v1",
    generatedAt: now,
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    requiredProviderIds,
    requiredDataResidency: requiredResidency,
    maxResponseTimeMs,
    readyContractIds: serviceContracts.filter((contract) => contract.ready).map((contract) => contract.id),
    externalTickets: serviceContracts.map((contract) => ({
      providerId: contract.providerId || null,
      contractId: contract.id,
      owner: contract.owner,
      callbackRoute: contract.handoff.callbackRoute || null,
      externalTicketRef: contract.handoff.externalTicketRef || null,
      handoffState: contract.handoff.state,
      ready: contract.ready
    })),
    contracts: serviceContracts,
    blockers
  };
}

function normalizeHistorySnapshots(input) {
  const history = input.history && typeof input.history === "object" ? input.history : {};
  const snapshots = Array.isArray(input.historySnapshots)
    ? input.historySnapshots
    : Array.isArray(history.snapshots)
      ? history.snapshots
      : [];

  return snapshots.map((snapshot, index) => {
    const record = snapshot && typeof snapshot === "object" ? snapshot : {};
    const summary = record.summary && typeof record.summary === "object" ? record.summary : {};
    const blockerCodes = asStringList(record.blockerCodes ?? summary.blockerCodes);
    const blockerCount = asNonNegativeInteger(record.blockerCount ?? summary.blockerCount, blockerCodes.length);
    const criticalCount = asNonNegativeInteger(record.criticalCount ?? summary.criticalCount, 0);
    const blockingCount = asNonNegativeInteger(record.blockingCount ?? summary.blockingCount, Math.max(0, blockerCount - criticalCount));

    return {
      id: asNonEmptyString(record.id) || `snapshot:${index + 1}`,
      capturedAt: asNonEmptyString(record.capturedAt ?? record.generatedAt ?? record.at),
      decision: asNonEmptyString(record.decision).toLowerCase() || "unknown",
      healthStatus: asNonEmptyString(record.healthStatus ?? summary.healthStatus).toLowerCase() || "unknown",
      claimCount: asNonNegativeInteger(record.claimCount ?? summary.claimCount, 0),
      releasableClaimCount: asNonNegativeInteger(record.releasableClaimCount ?? summary.releasableClaimCount, 0),
      blockerCount,
      criticalCount,
      blockingCount,
      blockerCodes
    };
  }).sort((left, right) => {
    const leftTime = Date.parse(left.capturedAt);
    const rightTime = Date.parse(right.capturedAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });
}

function normalizeRetryLedgerEntries(input) {
  const operations = input.operations && typeof input.operations === "object" ? input.operations : {};
  const health = input.operationalHealth && typeof input.operationalHealth === "object" ? input.operationalHealth : {};
  const retryLedger = input.retryLedger && typeof input.retryLedger === "object"
    ? input.retryLedger
    : operations.retryLedger && typeof operations.retryLedger === "object"
      ? operations.retryLedger
      : health.retryLedger && typeof health.retryLedger === "object"
        ? health.retryLedger
        : {};
  const entries = Array.isArray(retryLedger.entries)
    ? retryLedger.entries
    : Array.isArray(retryLedger.failures)
      ? retryLedger.failures
      : [];

  return entries.map((entry, index) => {
    const record = entry && typeof entry === "object" ? entry : {};
    return {
      id: asNonEmptyString(record.id) || `retry:${index + 1}`,
      dependency: asNonEmptyString(record.dependency ?? record.name),
      code: asNonEmptyString(record.code ?? record.errorCode),
      attemptsUsed: asNonNegativeInteger(record.attemptsUsed ?? record.attempts ?? record.retryCount, 0),
      lastAttemptAt: asNonEmptyString(record.lastAttemptAt ?? record.attemptedAt),
      lastErrorCode: asNonEmptyString(record.lastErrorCode ?? record.errorCode ?? record.code),
      lockedUntil: asNonEmptyString(record.lockedUntil ?? record.nextAttemptAfter)
    };
  }).sort((left, right) => left.dependency.localeCompare(right.dependency) || left.code.localeCompare(right.code));
}

function buildRetryPlan(input, failures, now) {
  const retry = input.retry && typeof input.retry === "object" ? input.retry : {};
  const attempts = asPositiveInteger(retry.maxAttempts ?? input.maxRetryAttempts, 3);
  const baseDelayMs = asPositiveInteger(retry.baseDelayMs ?? input.retryBaseDelayMs, 1000);
  const maxDelayMs = asPositiveInteger(retry.maxDelayMs ?? input.retryMaxDelayMs, 30000);
  const ledgerEntries = normalizeRetryLedgerEntries(input);
  const ledgerForFailure = (failure) => ledgerEntries.find((entry) => entry.code === failure.code || entry.dependency === failure.name) || null;
  const backoffEntries = failures.map((failure) => {
    const ledger = ledgerForFailure(failure);
    const attemptsUsed = Math.min(attempts, ledger?.attemptsUsed ?? 0);
    const retryable = failure.transient && attemptsUsed < attempts;
    const terminal = !failure.transient || attemptsUsed >= attempts;
    const nextDelayMs = retryable ? Math.min(maxDelayMs, baseDelayMs * 2 ** attemptsUsed) : 0;
    const lockMs = Date.parse(ledger?.lockedUntil);
    const nowMs = Date.parse(now);
    const locked = Number.isFinite(lockMs) && Number.isFinite(nowMs) && lockMs > nowMs;

    return {
      dependency: failure.name,
      code: failure.code,
      status: failure.status,
      category: failure.category,
      retryable,
      terminal,
      exhausted: failure.transient && attemptsUsed >= attempts,
      staleEvidence: failure.stale,
      attemptsUsed,
      attemptsRemaining: Math.max(0, attempts - attemptsUsed),
      nextDelayMs,
      nextAttemptAt: locked ? ledger.lockedUntil : addMs(now, nextDelayMs),
      locked,
      lastAttemptAt: ledger?.lastAttemptAt || null,
      lastErrorCode: ledger?.lastErrorCode || failure.code,
      action: retryable
        ? "retry-after-backoff"
        : terminal && failure.transient
          ? "escalate-retry-budget-exhausted"
          : "manual-dependency-restore"
    };
  });
  const retryableEntries = backoffEntries.filter((entry) => entry.retryable);
  const nextDelayMs = retryableEntries.reduce(
    (minimum, entry) => minimum === 0 ? entry.nextDelayMs : Math.min(minimum, entry.nextDelayMs),
    0
  );

  return {
    schema: "aios.verifierClaimGate.blockerReport.retryPlan.v1",
    recommended: retryableEntries.length > 0,
    maxAttempts: attempts,
    baseDelayMs,
    maxDelayMs,
    nextDelayMs,
    strategy: "exponential-backoff",
    retryableCodes: retryableEntries.map((entry) => entry.code),
    exhaustedCodes: backoffEntries.filter((entry) => entry.exhausted).map((entry) => entry.code),
    terminalCodes: backoffEntries.filter((entry) => entry.terminal).map((entry) => entry.code),
    backoffEntries
  };
}

function makeActionableError(failure) {
  if (failure.code === "health.check_missing") {
    return {
      code: failure.code,
      owner: "kernel-operator",
      action: `Publish ${failure.name} readiness before rerunning verifier claim release.`
    };
  }
  if (failure.transient) {
    return {
      code: failure.code,
      owner: "runtime-orchestrator",
      action: `Retry ${failure.name} after backoff and preserve the current blocker report for audit correlation.`
    };
  }
  return {
    code: failure.code,
    owner: "kernel-operator",
    action: `Restore ${failure.name} to healthy state and rerun proof/audit validation.`
  };
}

function addMs(isoTimestamp, delayMs) {
  const timestampMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestampMs) || delayMs <= 0) {
    return null;
  }
  return new Date(timestampMs + delayMs).toISOString();
}

function normalizeScheduleWindows(input, now) {
  const lifecycle = input.lifecycle && typeof input.lifecycle === "object" ? input.lifecycle : {};
  const settings = input.settings?.blockerReport && typeof input.settings.blockerReport === "object"
    ? input.settings.blockerReport
    : input.blockerReportSettings && typeof input.blockerReportSettings === "object"
      ? input.blockerReportSettings
      : {};
  const scheduler = lifecycle.scheduler && typeof lifecycle.scheduler === "object"
    ? lifecycle.scheduler
    : settings.scheduler && typeof settings.scheduler === "object"
      ? settings.scheduler
      : {};
  const rawWindows = [
    ...(
      Array.isArray(scheduler.blackoutWindows)
        ? scheduler.blackoutWindows
        : Array.isArray(lifecycle.blackoutWindows)
          ? lifecycle.blackoutWindows
          : Array.isArray(settings.blackoutWindows)
            ? settings.blackoutWindows
            : []
    ).map((window) => ({ ...window, kind: "blackout" })),
    ...(
      Array.isArray(scheduler.maintenanceWindows)
        ? scheduler.maintenanceWindows
        : Array.isArray(lifecycle.maintenanceWindows)
          ? lifecycle.maintenanceWindows
          : Array.isArray(settings.maintenanceWindows)
            ? settings.maintenanceWindows
            : []
    ).map((window) => ({ ...window, kind: "maintenance" }))
  ];
  const nowMs = Date.parse(now);
  const windows = rawWindows.map((window, index) => {
    const record = window && typeof window === "object" ? window : {};
    const startsAt = asNonEmptyString(record.startsAt ?? record.startAt ?? record.from);
    const endsAt = asNonEmptyString(record.endsAt ?? record.endAt ?? record.until);
    const startsMs = Date.parse(startsAt);
    const endsMs = Date.parse(endsAt);
    const validRange = Boolean(startsAt && endsAt) && Number.isFinite(startsMs) && Number.isFinite(endsMs) && startsMs < endsMs;
    const active = validRange && Number.isFinite(nowMs) && startsMs <= nowMs && nowMs < endsMs;
    const commandPolicy = asNonEmptyString(record.commandPolicy ?? record.policy).toLowerCase()
      || (record.kind === "blackout" ? "block-run" : "allow-settings");

    return {
      id: asNonEmptyString(record.id) || `${record.kind}:window:${index + 1}`,
      kind: record.kind,
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      reason: asNonEmptyString(record.reason ?? record.label),
      commandPolicy,
      validRange,
      active,
      suppressesSchedule: active && ["block-run", "pause-schedule", "maintenance-only"].includes(commandPolicy),
      allowsSettingsSave: commandPolicy !== "block-all"
    };
  }).sort((left, right) => {
    const leftTime = Date.parse(left.startsAt);
    const rightTime = Date.parse(right.startsAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });

  return {
    schema: "aios.verifierClaimGate.blockerReport.scheduleWindows.v1",
    windows,
    activeWindowIds: windows.filter((window) => window.active).map((window) => window.id),
    invalidWindowIds: windows.filter((window) => !window.validRange).map((window) => window.id),
    scheduleSuppressed: windows.some((window) => window.suppressesSchedule),
    settingsSaveAllowed: windows.filter((window) => window.active).every((window) => window.allowsSettingsSave)
  };
}

function buildLifecycleCommandProjection({
  requestedCommand,
  commandAccepted,
  enabled,
  scheduleEnabled,
  paused,
  mode,
  intervalMs,
  requestedIntervalMs,
  now,
  lastRunAt,
  nextDueFromLastRun,
  due,
  actorId,
  scope,
  scheduleWindows,
  schedulerCommand
}) {
  const before = {
    enabled: enabled !== false,
    schedulerEnabled: scheduleEnabled !== false,
    schedulerPaused: paused,
    mode,
    intervalMs,
    lastRunAt: lastRunAt || null,
    nextDueAt: enabled === false || scheduleEnabled === false || paused || scheduleWindows.scheduleSuppressed ? null : nextDueFromLastRun,
    due
  };
  const after = { ...before };
  const auditEvents = [];

  if (commandAccepted) {
    if (requestedCommand === "enable-report") {
      after.enabled = true;
      after.nextDueAt = after.schedulerEnabled && !after.schedulerPaused && !scheduleWindows.scheduleSuppressed ? nextDueFromLastRun : null;
    } else if (requestedCommand === "disable-report") {
      after.enabled = false;
      after.nextDueAt = null;
      after.due = false;
    } else if (requestedCommand === "pause-schedule") {
      after.schedulerPaused = true;
      after.nextDueAt = null;
      after.due = false;
    } else if (requestedCommand === "resume-schedule") {
      after.schedulerPaused = false;
      after.nextDueAt = scheduleWindows.scheduleSuppressed ? null : nextDueFromLastRun;
      after.due = !scheduleWindows.scheduleSuppressed && Date.parse(nextDueFromLastRun) <= Date.parse(now);
    } else if (requestedCommand === "run-now") {
      after.lastRunAt = now;
      after.nextDueAt = addMs(now, intervalMs);
      after.due = false;
    } else if (requestedCommand === "save-settings") {
      after.mode = mode;
      after.intervalMs = intervalMs;
      after.nextDueAt = before.enabled && before.schedulerEnabled && !before.schedulerPaused && !scheduleWindows.scheduleSuppressed ? nextDueFromLastRun : null;
      after.due = before.enabled && before.schedulerEnabled && !before.schedulerPaused && !scheduleWindows.scheduleSuppressed && due;
    }

    auditEvents.push({
      type: "lifecycle-command",
      command: requestedCommand,
      actorId,
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      at: now,
      afterState: after,
      schedulerCommand
    });
  }

  return {
    schema: "aios.verifierClaimGate.blockerReport.lifecycleCommandProjection.v1",
    command: requestedCommand || null,
    accepted: commandAccepted,
    stateChanged: JSON.stringify(before) !== JSON.stringify(after),
    before,
    after,
    patch: commandAccepted
      ? {
        enabled: after.enabled,
        scheduler: {
          enabled: after.schedulerEnabled,
          paused: after.schedulerPaused,
          intervalMs: after.intervalMs,
          lastRunAt: after.lastRunAt,
          nextDueAt: after.nextDueAt,
          due: after.due
        },
        mode: after.mode,
        updatedAt: now,
        updatedBy: actorId,
        requestedIntervalMs,
        activeScheduleWindowIds: scheduleWindows.activeWindowIds,
        schedulerCommand
      }
      : null,
    schedulerCommand,
    auditEvents
  };
}

function normalizeLifecycleSettings(input, scope, now) {
  const lifecycle = input.lifecycle && typeof input.lifecycle === "object" ? input.lifecycle : {};
  const settings = input.settings?.blockerReport && typeof input.settings.blockerReport === "object"
    ? input.settings.blockerReport
    : input.blockerReportSettings && typeof input.blockerReportSettings === "object"
      ? input.blockerReportSettings
      : {};
  const scheduler = lifecycle.scheduler && typeof lifecycle.scheduler === "object"
    ? lifecycle.scheduler
    : settings.scheduler && typeof settings.scheduler === "object"
      ? settings.scheduler
      : {};
  const requestedCommand = asNonEmptyString(
    lifecycle.command
      ?? settings.command
      ?? input.lifecycleCommand
      ?? input.request?.lifecycleCommand
  ).toLowerCase();
  const enabled = lifecycle.enabled ?? settings.enabled ?? input.blockerReportEnabled;
  const scheduleEnabled = scheduler.enabled ?? lifecycle.scheduleEnabled ?? settings.scheduleEnabled;
  const configuredMinIntervalMs = asPositiveInteger(scheduler.minIntervalMs ?? settings.minScheduleIntervalMs, 60000);
  const configuredMaxIntervalMs = asPositiveInteger(scheduler.maxIntervalMs ?? settings.maxScheduleIntervalMs, 86400000);
  const intervalWindowInvalid = configuredMinIntervalMs > configuredMaxIntervalMs;
  const minIntervalMs = configuredMinIntervalMs;
  const maxIntervalMs = intervalWindowInvalid ? configuredMinIntervalMs : configuredMaxIntervalMs;
  const requestedIntervalMs = asPositiveInteger(
    scheduler.intervalMs ?? lifecycle.intervalMs ?? settings.intervalMs,
    300000
  );
  const clampedIntervalMs = Math.min(Math.max(requestedIntervalMs, minIntervalMs), maxIntervalMs);
  const paused = scheduler.paused === true || lifecycle.paused === true || settings.paused === true;
  const lastRunAt = asNonEmptyString(scheduler.lastRunAt ?? lifecycle.lastRunAt ?? settings.lastRunAt);
  const lastRunMs = Date.parse(lastRunAt);
  const nowMs = Date.parse(now);
  const nextDueFromLastRun = Number.isFinite(lastRunMs) ? new Date(lastRunMs + clampedIntervalMs).toISOString() : now;
  const scheduleWindows = normalizeScheduleWindows(input, now);
  const due = !paused
    && scheduleEnabled !== false
    && !scheduleWindows.scheduleSuppressed
    && Number.isFinite(nowMs)
    && Date.parse(nextDueFromLastRun) <= nowMs;
  const allowedModes = new Set(["manual", "scheduled", "hybrid"]);
  const mode = asNonEmptyString(lifecycle.mode ?? settings.mode).toLowerCase() || "hybrid";
  const commandSet = new Set([
    "enable-report",
    "disable-report",
    "pause-schedule",
    "resume-schedule",
    "run-now",
    "save-settings"
  ]);
  const canManageLifecycle = scope.actor.permissions.includes("verifier-claim-gate.lifecycle.manage")
    || scope.actor.permissions.includes("kernel.lifecycle.manage")
    || ["owner", "admin"].includes(scope.actor.role);
  const settingsSaveAllowedByWindow = requestedCommand !== "save-settings" || scheduleWindows.settingsSaveAllowed;
  const runAllowedByWindow = requestedCommand !== "run-now" || !scheduleWindows.scheduleSuppressed;
  const baseCommandApplicable = !requestedCommand
    || requestedCommand === "save-settings"
    || requestedCommand === "enable-report" && enabled === false
    || requestedCommand === "disable-report" && enabled !== false
    || requestedCommand === "pause-schedule" && enabled !== false && scheduleEnabled !== false && !paused
    || requestedCommand === "resume-schedule" && enabled !== false && scheduleEnabled !== false && paused
    || requestedCommand === "run-now" && enabled !== false && scheduleEnabled !== false && !paused;
  const commandApplicable = baseCommandApplicable && settingsSaveAllowedByWindow && runAllowedByWindow;
  const validationErrors = [
    ...(allowedModes.has(mode) ? [] : ["lifecycle.mode_invalid"]),
    ...(intervalWindowInvalid ? ["lifecycle.schedule_window_invalid"] : []),
    ...(requestedIntervalMs < minIntervalMs ? ["lifecycle.interval_below_minimum"] : []),
    ...(requestedIntervalMs > maxIntervalMs ? ["lifecycle.interval_above_maximum"] : []),
    ...(scheduleWindows.invalidWindowIds.length > 0 ? ["lifecycle.schedule_window_range_invalid"] : []),
    ...(scheduleWindows.scheduleSuppressed && requestedCommand === "run-now" ? ["lifecycle.run_now_blocked_by_schedule_window"] : []),
    ...(!scheduleWindows.settingsSaveAllowed && requestedCommand === "save-settings" ? ["lifecycle.settings_save_blocked_by_schedule_window"] : []),
    ...(requestedCommand && !commandSet.has(requestedCommand) ? ["lifecycle.command_unknown"] : []),
    ...(requestedCommand && !canManageLifecycle ? ["lifecycle.command_permission_denied"] : []),
    ...(requestedCommand && commandSet.has(requestedCommand) && !commandApplicable ? ["lifecycle.command_not_applicable"] : []),
    ...(scheduleEnabled !== false && paused && requestedCommand === "run-now" ? ["lifecycle.run_now_while_paused"] : [])
  ];
  const blockers = [];
  const commandAccepted = Boolean(requestedCommand) && commandSet.has(requestedCommand) && canManageLifecycle && validationErrors.length === 0;
  const schedulerCommand = {
    schema: "aios.verifierClaimGate.blockerReport.schedulerCommand.v1",
    id: `lifecycle:${scope.tenantId || "tenant"}:${scope.workspaceId || "workspace"}:${requestedCommand || "observe"}`,
    command: requestedCommand || (due ? "run-scheduled-report" : "observe-schedule"),
    actorId: scope.actor.id,
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    accepted: commandAccepted || !requestedCommand && due,
    executeAt: requestedCommand === "run-now" && commandAccepted
      ? now
      : due
        ? now
        : enabled === false || scheduleEnabled === false || paused || scheduleWindows.scheduleSuppressed
          ? null
          : nextDueFromLastRun,
    mode,
    intervalMs: clampedIntervalMs,
    reason: scheduleWindows.scheduleSuppressed
      ? "schedule_window_active"
      : validationErrors.length > 0
        ? "lifecycle_validation_failed"
        : due
          ? "schedule_due"
          : "schedule_waiting",
    activeScheduleWindowIds: scheduleWindows.activeWindowIds,
    statePatchRequired: commandAccepted || due
  };
  const commandProjection = buildLifecycleCommandProjection({
    requestedCommand,
    commandAccepted,
    enabled,
    scheduleEnabled,
    paused,
    mode,
    intervalMs: clampedIntervalMs,
    requestedIntervalMs,
    now,
    lastRunAt,
    nextDueFromLastRun,
    due,
    actorId: scope.actor.id,
    scope,
    scheduleWindows,
    schedulerCommand
  });

  if (enabled === false) {
    pushBlocker(blockers, "lifecycle.report_disabled", "blocking", "Blocker report lifecycle is disabled for this workspace.", {
      requestedCommand: requestedCommand || null,
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null
    });
  }
  for (const error of validationErrors) {
    pushBlocker(blockers, error, error === "lifecycle.command_permission_denied" ? "critical" : "blocking", "Lifecycle settings are not valid for hosted-kernel blocker-report execution.", {
      requestedCommand: requestedCommand || null,
      intervalMs: requestedIntervalMs,
      minIntervalMs,
      maxIntervalMs,
      mode,
      activeScheduleWindowIds: scheduleWindows.activeWindowIds,
      invalidScheduleWindowIds: scheduleWindows.invalidWindowIds
    });
  }

  return {
    schema: "aios.verifierClaimGate.blockerReport.lifecycleSettings.v1",
    generatedAt: now,
    enabled: enabled !== false,
    mode,
    valid: blockers.length === 0,
    validationErrors,
    controls: {
      requestedCommand: requestedCommand || null,
      commandKnown: !requestedCommand || commandSet.has(requestedCommand),
      commandApplicable,
      commandAccepted,
      canManageLifecycle,
      enableAllowed: canManageLifecycle && enabled === false,
      disableAllowed: canManageLifecycle && enabled !== false,
      pauseAllowed: canManageLifecycle && enabled !== false && scheduleEnabled !== false && !paused,
      resumeAllowed: canManageLifecycle && scheduleEnabled !== false && paused,
      runNowAllowed: canManageLifecycle && enabled !== false && scheduleEnabled !== false && !paused && !scheduleWindows.scheduleSuppressed,
      saveSettingsAllowed: canManageLifecycle && scheduleWindows.settingsSaveAllowed
    },
    scheduler: {
      enabled: scheduleEnabled !== false,
      paused,
      scheduleSuppressed: scheduleWindows.scheduleSuppressed,
      intervalMs: clampedIntervalMs,
      requestedIntervalMs,
      minIntervalMs,
      maxIntervalMs,
      configuredMaxIntervalMs,
      scheduleWindowValid: !intervalWindowInvalid && scheduleWindows.invalidWindowIds.length === 0,
      lastRunAt: lastRunAt || null,
      nextDueAt: enabled === false || scheduleEnabled === false || paused || scheduleWindows.scheduleSuppressed ? null : nextDueFromLastRun,
      due,
      command: schedulerCommand,
      windows: scheduleWindows
    },
    commandProjection,
    auditEvents: commandProjection.auditEvents,
    statePatch: commandProjection.patch,
    nextAction: enabled === false
      ? "enable-report"
      : validationErrors.length > 0
        ? "fix-lifecycle-settings"
        : scheduleWindows.scheduleSuppressed
          ? "await-schedule-window-clear"
        : requestedCommand && commandSet.has(requestedCommand) && canManageLifecycle
          ? requestedCommand
          : due
            ? "run-scheduled-report"
            : paused
              ? "resume-schedule"
              : "await-next-schedule",
    blockers
  };
}

function blockerOwner(blocker) {
  if (blocker.code.startsWith("client.")) {
    return "runtime-orchestrator";
  }
  if (blocker.code.startsWith("integration.")) {
    return "runtime-orchestrator";
  }
  if (blocker.code.startsWith("lifecycle.")) {
    return "kernel-operator";
  }
  if (blocker.code.startsWith("health.")) {
    return "kernel-operator";
  }
  if (blocker.code.startsWith("audit.")) {
    return "kernel-operator";
  }
  if (blocker.code.startsWith("permission.") || blocker.code.startsWith("tenant.") || blocker.code.startsWith("workspace.")) {
    return "workspace-admin";
  }
  if (blocker.code.startsWith("proof.")) {
    return "verifier";
  }
  return "claim-owner";
}

function remediationActionForBlocker(blocker) {
  if (blocker.code.startsWith("client.runtime_") || blocker.code === "client.state_patch_contract_missing") {
    return "Refresh the client runtime contract and confirm it accepts blocker-report state patches.";
  }
  if (blocker.code === "client.offline_release_blocked") {
    return "Reconnect the client runtime before executing release or audit append handoff.";
  }
  if (blocker.code === "client.selection_claim_unknown") {
    return "Clear stale claim selections and reload the hosted-kernel blocker report.";
  }
  if (blocker.code === "integration.sync_stale") {
    return "Refresh provider sync cursor and rerun blocker-report capability negotiation.";
  }
  if (blocker.code.startsWith("integration.handoff_")) {
    return "Refresh provider handoff acknowledgement for the current sync cursor before claim release.";
  }
  if (blocker.code === "integration.capability_missing") {
    return `Route to a hosted-kernel provider with ${blocker.details?.capability || "the required"} capability.`;
  }
  if (blocker.code === "integration.provider_unavailable" || blocker.code === "integration.provider_missing") {
    return "Restore hosted-kernel integration provider availability before claim release.";
  }
  if (blocker.code.startsWith("health.")) {
    return `Restore ${blocker.details?.dependency || "dependency"} health and preserve retry evidence.`;
  }
  if (blocker.code === "proof.missing") {
    return "Attach a proof reference for the blocked verifier claim.";
  }
  if (blocker.code.startsWith("proof.")) {
    return "Refresh proof-store receipt metadata and rerun blocker-report validation.";
  }
  if (blocker.code.startsWith("audit.")) {
    return "Enable audit append before releasing proof-backed verifier claims.";
  }
  if (blocker.code === "lifecycle.report_disabled") {
    return "Enable the blocker-report lifecycle control before claim release.";
  }
  if (blocker.code.startsWith("lifecycle.")) {
    return "Correct blocker-report lifecycle settings and save the hosted-kernel control state.";
  }
  if (blocker.code.startsWith("permission.")) {
    return "Review actor permissions and rerun the scoped claim-gate report.";
  }
  return "Review blocker details and rerun verifier claim-gate evaluation.";
}

function buildOperationalIncidentState(input, now, decision, blockers, operationalHealth, providerContracts) {
  const operations = input.operations && typeof input.operations === "object" ? input.operations : {};
  const retryLedger = operations.retryLedger && typeof operations.retryLedger === "object" ? operations.retryLedger : {};
  const maxRetryBudget = asPositiveInteger(operations.maxRetryBudget ?? input.maxOperationalRetryBudget, operationalHealth.retry.maxAttempts);
  const retryAttemptsUsed = Math.min(
    maxRetryBudget,
    asNonNegativeInteger(retryLedger.attemptsUsed ?? operations.retryAttemptsUsed ?? input.retryAttemptsUsed, 0)
  );
  const retryBudgetRemaining = Math.max(0, maxRetryBudget - retryAttemptsUsed);
  const providerRetryableBlockers = blockers.filter((blocker) => blocker.code === "integration.sync_stale");
  const healthRetryableBlockers = operationalHealth.retry.recommended
    ? blockers.filter((blocker) => operationalHealth.retry.retryableCodes.includes(blocker.code))
    : [];
  const retryableBlockers = [...healthRetryableBlockers, ...providerRetryableBlockers];
  const retryAllowed = retryableBlockers.length > 0 && retryBudgetRemaining > 0 && decision !== "release";
  const providerRetryDelayMs = providerRetryableBlockers.length > 0
    ? Math.min(60000, 2500 * 2 ** Math.max(0, retryAttemptsUsed))
    : 0;
  const nextRetryDelayMs = retryAllowed
    ? Math.max(operationalHealth.retry.nextDelayMs, providerRetryDelayMs)
    : 0;
  const criticalCodes = blockers
    .filter((blocker) => blocker.severity === "critical")
    .map((blocker) => blocker.code);
  const degradedReleaseEligible = decision === "hold"
    && operationalHealth.degradedMode
    && criticalCodes.length === 0
    && providerContracts.missingCapabilities.length === 0;
  const failureState = blockers.length === 0
    ? "none"
    : criticalCodes.length > 0 || providerContracts.missingCapabilities.length > 0
      ? "hard_blocked"
      : retryAllowed
        ? "retryable"
        : degradedReleaseEligible
          ? "degraded_remediation"
          : "manual_remediation";
  const remediationQueue = blockers.map((blocker, index) => ({
    id: `remediate:${index + 1}`,
    code: blocker.code,
    owner: blockerOwner(blocker),
    severity: blocker.severity,
    claimId: blocker.details?.claimId || null,
    dependency: blocker.details?.dependency || null,
    providerId: blocker.details?.providerId || null,
    retryable: retryableBlockers.includes(blocker),
    action: remediationActionForBlocker(blocker)
  }));

  return {
    schema: "aios.verifierClaimGate.blockerReport.operationalIncident.v1",
    state: failureState,
    degradedReleaseEligible,
    retry: {
      allowed: retryAllowed,
      budget: {
        maxAttempts: maxRetryBudget,
        attemptsUsed: retryAttemptsUsed,
        remaining: retryBudgetRemaining
      },
      nextAttemptAt: addMs(now, nextRetryDelayMs),
      nextDelayMs: nextRetryDelayMs,
      retryableCodes: asStringList(retryableBlockers.map((blocker) => blocker.code))
    },
    escalation: {
      required: failureState === "hard_blocked" || retryBudgetRemaining === 0 && retryableBlockers.length > 0,
      owner: criticalCodes.some((code) => code.startsWith("integration."))
        ? "runtime-orchestrator"
        : criticalCodes.some((code) => code.startsWith("health."))
          ? "kernel-operator"
          : "workspace-admin",
      codes: criticalCodes
    },
    remediationQueue
  };
}

function evaluateOperationalHealth(input, now) {
  const health = input.operationalHealth && typeof input.operationalHealth === "object" ? input.operationalHealth : {};
  const maxAgeMs = asPositiveInteger(health.maxAgeMs ?? input.maxHealthAgeMs, 300000);
  const degradedMode = health.degradedMode === true || input.degradedMode === true;
  const nowMs = Date.parse(now);
  const dependencyChecks = normalizeDependencyChecks(input).map((check) => {
    const validatedMs = Date.parse(check.validatedAt);
    const ageMs = Number.isFinite(nowMs) && Number.isFinite(validatedMs) ? Math.max(0, nowMs - validatedMs) : null;
    const futureValidatedAt = Boolean(check.validatedAt) && Number.isFinite(nowMs) && Number.isFinite(validatedMs) && validatedMs > nowMs;
    const validationMissing = check.required && check.status !== "missing" && !check.validatedAt;
    const stale = validationMissing || futureValidatedAt || (check.validatedAt ? ageMs === null || ageMs > maxAgeMs : false);
    const evidenceState = validationMissing
      ? "missing-validation-timestamp"
      : futureValidatedAt
        ? "future-validation-timestamp"
        : stale
          ? "stale"
          : check.validatedAt
            ? "fresh"
            : "not-supplied";
    const validationCode = validationMissing
      ? `health.${check.name}.validated_at_missing`
      : futureValidatedAt
        ? `health.${check.name}.validated_at_future`
        : "";
    const category = validationCode
      ? "failed"
      : stale || DEGRADED_STATES.has(check.status)
        ? "degraded"
        : HEALTHY_STATES.has(check.status)
          ? "healthy"
          : FAILED_STATES.has(check.status) || check.status === "missing"
            ? "failed"
            : "unknown";
    return { ...check, category, stale, ageMs, evidenceState, validationCode };
  });
  const failures = dependencyChecks
    .filter((check) => check.required && check.category !== "healthy")
    .map((check) => ({
      name: check.name,
      code: check.errorCode || check.validationCode || `health.${check.name}.${check.category}`,
      status: check.status,
      category: check.category,
      transient: TRANSIENT_FAILURE_STATES.has(check.status) || check.category === "degraded" && check.stale && !check.validationCode,
      stale: check.stale,
      evidenceState: check.evidenceState,
      validationCode: check.validationCode
    }));
  const retryPlan = buildRetryPlan(input, failures, now);
  const retryByCode = new Map(retryPlan.backoffEntries.map((entry) => [entry.code, entry]));
  const blockers = failures.map((failure) => ({
    code: failure.code,
    severity: degradedMode && failure.transient ? "blocking" : "critical",
    message: failure.validationCode
      ? `Required hosted-kernel dependency ${failure.name} has invalid health evidence.`
      : `Required hosted-kernel dependency ${failure.name} is ${failure.category}.`,
    details: {
      dependency: failure.name,
      status: failure.status,
      transient: failure.transient,
      stale: failure.stale,
      evidenceState: failure.evidenceState,
      retryAction: retryByCode.get(failure.code)?.action || "manual-dependency-restore",
      nextAttemptAt: retryByCode.get(failure.code)?.nextAttemptAt || null,
      attemptsRemaining: retryByCode.get(failure.code)?.attemptsRemaining ?? 0,
      degradedMode
    }
  }));
  const status = failures.length === 0
    ? dependencyChecks.some((check) => check.category === "degraded")
      ? "degraded"
      : "healthy"
    : degradedMode && failures.every((failure) => failure.transient)
      ? "degraded"
      : "failed";

  return {
    status,
    degradedMode,
    failureState: failures.length > 0 ? "dependency_unavailable" : status === "degraded" ? "degraded_dependency" : "none",
    maxAgeMs,
    dependencyChecks,
    validationFailures: failures
      .filter((failure) => failure.validationCode)
      .map((failure) => ({
        dependency: failure.name,
        code: failure.validationCode,
        evidenceState: failure.evidenceState,
        status: failure.status
      })),
    retry: retryPlan,
    actionableErrors: failures.map((failure) => ({
      ...makeActionableError(failure),
      retry: retryByCode.get(failure.code) || null
    })),
    blockers
  };
}

function evaluateBoundaries(scope, claims, input) {
  const blockers = [];
  const allowedRoles = new Set([...DEFAULT_ALLOWED_ROLES, ...asStringList(input.allowedRoles).map((role) => role.toLowerCase())]);
  const allowedClaimStates = new Set([
    ...DEFAULT_ALLOWED_CLAIM_STATES,
    ...asStringList(input.allowedClaimStates).map((state) => state.toLowerCase())
  ]);

  if (!scope.tenantId) {
    pushBlocker(blockers, "tenant.missing", "critical", "A tenant id is required before blocker reports can be trusted.");
  }
  if (!scope.workspaceId) {
    pushBlocker(blockers, "workspace.missing", "critical", "A workspace id is required for claim gate evaluation.");
  }
  if (scope.requestedWorkspaceId && scope.workspaceId && scope.requestedWorkspaceId !== scope.workspaceId) {
    pushBlocker(blockers, "workspace.route_mismatch", "critical", "Requested workspace does not match report workspace.", {
      requestedWorkspaceId: scope.requestedWorkspaceId,
      workspaceId: scope.workspaceId
    });
  }
  if (scope.actor.tenantId && scope.tenantId && scope.actor.tenantId !== scope.tenantId) {
    pushBlocker(blockers, "tenant.actor_mismatch", "critical", "Actor tenant does not match report tenant.", {
      actorTenantId: scope.actor.tenantId,
      tenantId: scope.tenantId
    });
  }
  if (!allowedRoles.has(scope.actor.role)) {
    pushBlocker(blockers, "permission.role_denied", "critical", "Actor role is not allowed to release verifier claim reports.", {
      role: scope.actor.role
    });
  }
  if (scope.workspaceId && scope.actor.workspaceIds.length > 0 && !scope.actor.workspaceIds.includes(scope.workspaceId)) {
    pushBlocker(blockers, "workspace.actor_not_bound", "critical", "Actor is not bound to the report workspace.", {
      actorWorkspaceIds: scope.actor.workspaceIds,
      workspaceId: scope.workspaceId
    });
  }

  for (const claim of claims) {
    if (claim.tenantId && scope.tenantId && claim.tenantId !== scope.tenantId) {
      pushBlocker(blockers, "claim.tenant_escape", "critical", "Claim belongs to a different tenant.", {
        claimId: claim.id,
        claimTenantId: claim.tenantId,
        tenantId: scope.tenantId
      });
    }
    if (claim.workspaceId && scope.workspaceId && claim.workspaceId !== scope.workspaceId) {
      pushBlocker(blockers, "claim.workspace_escape", "critical", "Claim belongs to a different workspace.", {
        claimId: claim.id,
        claimWorkspaceId: claim.workspaceId,
        workspaceId: scope.workspaceId
      });
    }
    if (!allowedClaimStates.has(claim.state)) {
      pushBlocker(blockers, "claim.state_blocked", "blocking", "Claim state is not releasable for hosted-kernel proof handoff.", {
        claimId: claim.id,
        state: claim.state
      });
    }
    if (claim.requiresPermission && !scope.actor.permissions.includes(claim.requiresPermission)) {
      pushBlocker(blockers, "permission.claim_missing", "blocking", "Actor lacks a claim-specific permission.", {
        claimId: claim.id,
        requiresPermission: claim.requiresPermission
      });
    }
    if (!claim.proofRef) {
      pushBlocker(blockers, "proof.missing", "blocking", "Claim is missing a proof reference for audit handoff.", {
        claimId: claim.id
      });
    }
  }

  return blockers;
}

function normalizeWorkspaceBindings(input, scope) {
  const access = input.access && typeof input.access === "object" ? input.access : {};
  const tenant = input.tenant && typeof input.tenant === "object" ? input.tenant : {};
  const bindings = Array.isArray(input.workspaceBindings)
    ? input.workspaceBindings
    : Array.isArray(access.workspaceBindings)
      ? access.workspaceBindings
      : Array.isArray(tenant.workspaceBindings)
        ? tenant.workspaceBindings
        : [];

  return bindings.map((binding, index) => {
    const record = binding && typeof binding === "object" ? binding : {};
    return {
      id: asNonEmptyString(record.id) || `workspace-binding:${index + 1}`,
      tenantId: asNonEmptyString(record.tenantId ?? scope.tenantId),
      workspaceId: asNonEmptyString(record.workspaceId ?? record.id),
      actorId: asNonEmptyString(record.actorId ?? record.principalId ?? record.userId),
      role: asNonEmptyString(record.role).toLowerCase(),
      permissions: asStringList(record.permissions ?? record.scopes),
      status: asNonEmptyString(record.status ?? record.state).toLowerCase() || "active",
      grantedBy: asNonEmptyString(record.grantedBy),
      grantedAt: asNonEmptyString(record.grantedAt ?? record.createdAt),
      expiresAt: asNonEmptyString(record.expiresAt)
    };
  }).sort((left, right) => left.workspaceId.localeCompare(right.workspaceId) || left.id.localeCompare(right.id));
}

function normalizeActorDelegations(input) {
  const access = input.access && typeof input.access === "object" ? input.access : {};
  const actor = input.actor && typeof input.actor === "object" ? input.actor : {};
  const delegations = Array.isArray(input.actorDelegations)
    ? input.actorDelegations
    : Array.isArray(access.delegations)
      ? access.delegations
      : Array.isArray(actor.delegations)
        ? actor.delegations
        : [];

  return delegations.map((delegation, index) => {
    const record = delegation && typeof delegation === "object" ? delegation : {};
    return {
      id: asNonEmptyString(record.id) || `delegation:${index + 1}`,
      tenantId: asNonEmptyString(record.tenantId),
      workspaceId: asNonEmptyString(record.workspaceId),
      delegatedBy: asNonEmptyString(record.delegatedBy ?? record.grantorId),
      delegatedTo: asNonEmptyString(record.delegatedTo ?? record.actorId ?? record.principalId),
      permissions: asStringList(record.permissions ?? record.scopes),
      status: asNonEmptyString(record.status ?? record.state).toLowerCase() || "active",
      expiresAt: asNonEmptyString(record.expiresAt),
      reason: asNonEmptyString(record.reason)
    };
  }).sort((left, right) => left.workspaceId.localeCompare(right.workspaceId) || left.id.localeCompare(right.id));
}

function buildAccessBoundaryReport(scope, claims, input, clientRequest, now) {
  const access = input.access && typeof input.access === "object" ? input.access : {};
  const policy = access.policy && typeof access.policy === "object" ? access.policy : {};
  const nowMs = Date.parse(now);
  const workspaceBindings = normalizeWorkspaceBindings(input, scope);
  const actorDelegations = normalizeActorDelegations(input);
  const requestedAction = clientRequest?.requestedAction || asNonEmptyString(input.action).toLowerCase() || "view-report";
  const requiredActionPermissions = asStringList([
    "verifier-claim-gate.blocker-report.read",
    ...(requestedAction === "release-claims" || requestedAction === "append-audit"
      ? ["verifier-claim-gate.claim.release", "audit.append"]
      : []),
    ...asStringList(access.requiredPermissions ?? policy.requiredPermissions)
  ]);
  const activeWorkspaceBindings = workspaceBindings.filter((binding) => {
    const expiresMs = Date.parse(binding.expiresAt);
    return binding.status === "active"
      && (!binding.tenantId || !scope.tenantId || binding.tenantId === scope.tenantId)
      && (!binding.workspaceId || !scope.workspaceId || binding.workspaceId === scope.workspaceId)
      && (!binding.actorId || binding.actorId === scope.actor.id)
      && (!binding.expiresAt || Number.isFinite(nowMs) && Number.isFinite(expiresMs) && expiresMs > nowMs);
  });
  const activeDelegations = actorDelegations.filter((delegation) => {
    const expiresMs = Date.parse(delegation.expiresAt);
    return delegation.status === "active"
      && (!delegation.tenantId || !scope.tenantId || delegation.tenantId === scope.tenantId)
      && (!delegation.workspaceId || !scope.workspaceId || delegation.workspaceId === scope.workspaceId)
      && (!delegation.delegatedTo || delegation.delegatedTo === scope.actor.id)
      && (!delegation.expiresAt || Number.isFinite(nowMs) && Number.isFinite(expiresMs) && expiresMs > nowMs);
  });
  const effectivePermissions = asStringList([
    ...scope.actor.permissions,
    ...activeWorkspaceBindings.flatMap((binding) => binding.permissions),
    ...activeDelegations.flatMap((delegation) => delegation.permissions)
  ]);
  const missingActionPermissions = requiredActionPermissions.filter((permission) => !effectivePermissions.includes(permission));
  const baseBlockers = evaluateBoundaries(scope, claims, input);
  const blockers = [...baseBlockers];
  const enforceWorkspaceBinding = policy.enforceWorkspaceBinding !== false && access.enforceWorkspaceBinding !== false;

  if (enforceWorkspaceBinding && scope.workspaceId && activeWorkspaceBindings.length === 0 && scope.actor.workspaceIds.length === 0) {
    pushBlocker(blockers, "workspace.binding_missing", "critical", "Actor has no active workspace binding for the blocker-report scope.", {
      actorId: scope.actor.id,
      workspaceId: scope.workspaceId,
      tenantId: scope.tenantId || null
    });
  }
  for (const permission of missingActionPermissions) {
    pushBlocker(blockers, "permission.action_missing", requestedAction === "view-report" ? "blocking" : "critical", "Actor lacks a required action permission for this blocker-report request.", {
      actorId: scope.actor.id,
      action: requestedAction,
      permission
    });
  }
  for (const binding of workspaceBindings.filter((binding) => binding.workspaceId && scope.workspaceId && binding.workspaceId !== scope.workspaceId)) {
    pushBlocker(blockers, "workspace.binding_out_of_scope", "blocking", "Workspace binding was supplied for a different workspace and cannot authorize this report.", {
      bindingId: binding.id,
      bindingWorkspaceId: binding.workspaceId,
      workspaceId: scope.workspaceId
    });
  }
  for (const delegation of actorDelegations.filter((delegation) => delegation.tenantId && scope.tenantId && delegation.tenantId !== scope.tenantId)) {
    pushBlocker(blockers, "tenant.delegation_escape", "critical", "Actor delegation belongs to a different tenant.", {
      delegationId: delegation.id,
      delegationTenantId: delegation.tenantId,
      tenantId: scope.tenantId
    });
  }

  return {
    schema: "aios.verifierClaimGate.blockerReport.accessBoundary.v1",
    generatedAt: now,
    state: blockers.some((blocker) => blocker.severity === "critical")
      ? "denied"
      : blockers.length > 0
        ? "restricted"
        : "authorized",
    requestedAction,
    enforceWorkspaceBinding,
    requiredActionPermissions,
    effectivePermissions,
    missingActionPermissions,
    workspaceBindings,
    activeWorkspaceBindingIds: activeWorkspaceBindings.map((binding) => binding.id),
    actorDelegations,
    activeDelegationIds: activeDelegations.map((delegation) => delegation.id),
    auditRows: claims.map((claim) => ({
      tenantId: claim.tenantId || scope.tenantId || null,
      workspaceId: claim.workspaceId || scope.workspaceId || null,
      claimId: claim.id,
      actorId: scope.actor.id,
      requestedAction,
      authorized: !blockers.some((blocker) => blocker.details?.claimId === claim.id || blocker.code.startsWith("tenant.") || blocker.code.startsWith("workspace.") || blocker.code.startsWith("permission.")),
      activeWorkspaceBindingIds: activeWorkspaceBindings.map((binding) => binding.id),
      activeDelegationIds: activeDelegations.map((delegation) => delegation.id),
      missingActionPermissions
    })),
    blockers
  };
}

function countBy(items, keySelector) {
  const counts = {};
  for (const item of items) {
    const key = keySelector(item);
    if (!key) {
      continue;
    }
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeExportProfile(input, clientRequest) {
  const exportRequest = input.exportRequest && typeof input.exportRequest === "object"
    ? input.exportRequest
    : input.export && typeof input.export === "object"
      ? input.export
      : input.reporting?.export && typeof input.reporting.export === "object"
        ? input.reporting.export
        : {};
  const requestedFormat = asNonEmptyString(exportRequest.format ?? exportRequest.type).toLowerCase() || "json";
  const allowedFormats = new Set(["json", "jsonl", "csv"]);
  const requestedSections = asStringList(exportRequest.sections);
  const defaultSections = ["blockers", "dependencies", "integrationProviders", "releasableClaims"];
  const includeSections = requestedSections.length > 0 ? requestedSections : defaultSections;
  const audience = asNonEmptyString(exportRequest.audience ?? clientRequest.channel).toLowerCase() || "hosted-kernel";
  const externalAudience = ["external", "partner", "provider", "auditor"].includes(audience);
  const includeProofDigests = exportRequest.includeProofDigests === true && !externalAudience;
  const includeActorPermissions = exportRequest.includeActorPermissions === true && !externalAudience;
  const rowLimit = asPositiveInteger(exportRequest.rowLimit ?? exportRequest.maxRows, 5000);
  const deliveryRef = asNonEmptyString(exportRequest.deliveryRef ?? exportRequest.destinationRef ?? exportRequest.sinkRef);
  const validationErrors = [
    ...(allowedFormats.has(requestedFormat) ? [] : ["export.format_unsupported"]),
    ...(includeSections.some((section) => ![
      "blockers",
      "dependencies",
      "integrationProviders",
      "providerHandoffs",
      "serviceContracts",
      "remediationQueue",
      "proofAuditAppendRecords",
      "lifecycleControls",
      "accessBoundaryAudit",
      "releasableClaims"
    ].includes(section)) ? ["export.section_unknown"] : [])
  ];

  return {
    schema: "aios.verifierClaimGate.blockerReport.exportProfile.v1",
    format: allowedFormats.has(requestedFormat) ? requestedFormat : "json",
    audience,
    deliveryRef: deliveryRef || null,
    rowLimit,
    includeSections,
    redaction: {
      proofDigests: includeProofDigests ? "included" : "redacted",
      actorPermissions: includeActorPermissions ? "included" : "redacted",
      externalAudience
    },
    ready: validationErrors.length === 0,
    validationErrors
  };
}

function buildAnalyticsCounters(claims, blockers, operationalHealth, providerContracts, providerHandoff, serviceContracts, historySnapshots, proofAuditLedger, accessBoundary) {
  const blockedClaimIds = new Set(blockers.map((blocker) => blocker.details?.claimId).filter(Boolean));
  const blockerCodes = countBy(blockers, (blocker) => blocker.code);
  const blockerSeverities = countBy(blockers, (blocker) => blocker.severity);
  const dependencyCategories = countBy(operationalHealth.dependencyChecks, (check) => check.category);
  const providerCategories = countBy(providerContracts.providers, (provider) => provider.category);
  const claimStates = countBy(claims, (claim) => claim.state);
  const previous = historySnapshots.at(-1);
  const blockerDelta = previous ? blockers.length - previous.blockerCount : blockers.length;
  const releaseDelta = previous
    ? claims.length - blockedClaimIds.size - previous.releasableClaimCount
    : claims.length - blockedClaimIds.size;

  return {
    claimStates,
    blockerCodes,
    blockerSeverities,
    dependencyCategories,
    providerCategories,
    blockedClaimCount: blockedClaimIds.size,
    missingProofCount: blockerCodes["proof.missing"] || 0,
    permissionBlockerCount: Object.entries(blockerCodes)
      .filter(([code]) => code.startsWith("permission."))
      .reduce((total, [, count]) => total + count, 0),
    accessBoundaryState: accessBoundary.state,
    missingActionPermissionCount: accessBoundary.missingActionPermissions.length,
    activeWorkspaceBindingCount: accessBoundary.activeWorkspaceBindingIds.length,
    activeDelegationCount: accessBoundary.activeDelegationIds.length,
    accessAuditRowCount: accessBoundary.auditRows.length,
    dependencyBlockerCount: operationalHealth.blockers.length,
    healthValidationFailureCount: operationalHealth.validationFailures.length,
    exhaustedHealthRetryCount: operationalHealth.retry.exhaustedCodes.length,
    providerBlockerCount: providerContracts.blockers.length,
    providerHandoffBlockerCount: providerHandoff.blockers.length,
    providerHandoffReceiptCount: providerHandoff.receiptCount,
    providerHandoffReadyProviderCount: providerHandoff.readyProviderCount,
    providerHandoffUnknownReceiptCount: providerHandoff.unknownReceiptCount,
    serviceContractCount: serviceContracts.contracts.length,
    serviceContractReadyCount: serviceContracts.readyContractIds.length,
    serviceContractBlockerCount: serviceContracts.blockers.length,
    serviceContractTicketCount: serviceContracts.externalTickets.length,
    proofReceiptCount: proofAuditLedger.receiptCount,
    proofAuditAppendRecordCount: proofAuditLedger.appendRecords.length,
    proofAuditAppendReadyCount: proofAuditLedger.appendReadyCount,
    untrustedProofReceiptCount: proofAuditLedger.claimProofs.filter((proof) => proof.proofRef && !proof.trusted).length,
    missingProviderCapabilityCount: providerContracts.missingCapabilities.length,
    staleProviderSyncCount: providerContracts.syncMetadata.staleProviderIds.length,
    transientDependencyCount: operationalHealth.dependencyChecks
      .filter((check) => TRANSIENT_FAILURE_STATES.has(check.status))
      .length,
    historySnapshotCount: historySnapshots.length,
    blockerDeltaFromPrevious: blockerDelta,
    releasableDeltaFromPrevious: releaseDelta
  };
}

function applyExportProfileRows(rows, exportProfile) {
  const selected = {};
  for (const [section, sectionRows] of Object.entries(rows)) {
    if (!exportProfile.includeSections.includes(section)) {
      continue;
    }
    selected[section] = sectionRows.slice(0, exportProfile.rowLimit).map((row) => {
      if (section === "proofAuditAppendRecords" && exportProfile.redaction.proofDigests === "redacted") {
        return { ...row, proofDigest: row.proofDigest ? "redacted" : null };
      }
      if (section === "accessBoundaryAudit" && exportProfile.redaction.actorPermissions === "redacted") {
        return { ...row, missingActionPermissions: row.missingActionPermissions.length > 0 ? ["redacted"] : [] };
      }
      return row;
    });
  }
  return selected;
}

function buildExportSummary(scope, claims, releasableClaims, blockers, operationalHealth, providerContracts, providerHandoff, serviceContracts, operationalIncident, analytics, proofAuditLedger, lifecycleSettings, accessBoundary, exportProfile, now) {
  const blockerRows = blockers.map((blocker) => ({
    code: blocker.code,
    severity: blocker.severity,
    claimId: blocker.details?.claimId || null,
    dependency: blocker.details?.dependency || null,
    providerId: blocker.details?.providerId || null,
    capability: blocker.details?.capability || null,
    message: blocker.message
  }));
  const allRows = {
    blockers: blockerRows,
    dependencies: operationalHealth.dependencyChecks.map((check) => ({
      name: check.name,
      required: check.required,
      status: check.status,
      category: check.category,
      evidenceState: check.evidenceState,
      validationCode: check.validationCode || null,
      stale: check.stale,
      ageMs: check.ageMs,
      retry: operationalHealth.retry.backoffEntries.find((entry) => entry.dependency === check.name) || null
    })),
    integrationProviders: providerContracts.providers.map((provider) => ({
      id: provider.id,
      type: provider.type,
      required: provider.required,
      status: provider.status,
      category: provider.category,
      contractVersion: provider.contractVersion || null,
      endpointRef: provider.endpointRef || null,
      capabilities: provider.capabilities,
      negotiatedCapabilities: provider.negotiatedCapabilities,
      sync: {
        cursor: provider.sync.cursor || null,
        watermark: provider.sync.watermark || null,
        state: provider.sync.state,
        updatedAt: provider.sync.updatedAt || null,
        ageMs: provider.sync.ageMs,
        fresh: provider.sync.fresh
      }
    })),
    providerHandoffs: providerHandoff.handoffs.map((handoff) => ({
      providerId: handoff.providerId,
      required: handoff.required,
      requiredForRelease: handoff.requiredForRelease,
      receiptId: handoff.receiptId,
      handoffRef: handoff.handoffRef,
      status: handoff.status,
      ready: handoff.ready,
      cursorMatches: handoff.cursorMatches,
      contractVersionMatches: handoff.contractVersionMatches,
      expired: handoff.expired,
      acceptedCapabilities: handoff.acceptedCapabilities,
      missingAcceptedCapabilities: handoff.missingAcceptedCapabilities,
      receivedAt: handoff.receivedAt,
      expiresAt: handoff.expiresAt
    })),
    serviceContracts: serviceContracts.contracts.map((contract) => ({
      id: contract.id,
      providerId: contract.providerId,
      owner: contract.owner,
      status: contract.status,
      version: contract.version || null,
      surface: contract.surface,
      ready: contract.ready,
      reviewFresh: contract.reviewFresh,
      routeAllowed: contract.routeAllowed,
      residencySatisfied: contract.residencySatisfied,
      syncLagWithinSla: contract.syncLagWithinSla,
      responseWithinSla: contract.responseWithinSla,
      callbackRoute: contract.handoff.callbackRoute || null,
      externalTicketRef: contract.handoff.externalTicketRef || null,
      handoffState: contract.handoff.state
    })),
    remediationQueue: operationalIncident.remediationQueue.map((item) => ({
      id: item.id,
      code: item.code,
      owner: item.owner,
      severity: item.severity,
      claimId: item.claimId,
      dependency: item.dependency,
      providerId: item.providerId,
      retryable: item.retryable,
      action: item.action
    })),
    proofAuditAppendRecords: proofAuditLedger.appendRecords.map((record) => ({
      auditRef: record.auditRef,
      claimId: record.claimId,
      proofRef: record.proofRef,
      proofDigest: record.proofDigest,
      proofSigner: record.proofSigner,
      receiptStatus: record.receiptStatus,
      appendReady: record.appendReady
    })),
    lifecycleControls: [{
      enabled: lifecycleSettings.enabled,
      mode: lifecycleSettings.mode,
      valid: lifecycleSettings.valid,
      requestedCommand: lifecycleSettings.controls.requestedCommand,
      commandAccepted: lifecycleSettings.controls.commandAccepted,
      canManageLifecycle: lifecycleSettings.controls.canManageLifecycle,
      nextAction: lifecycleSettings.nextAction,
      schedulerEnabled: lifecycleSettings.scheduler.enabled,
      schedulerPaused: lifecycleSettings.scheduler.paused,
      schedulerSuppressed: lifecycleSettings.scheduler.scheduleSuppressed,
      schedulerDue: lifecycleSettings.scheduler.due,
      nextDueAt: lifecycleSettings.scheduler.nextDueAt,
      schedulerCommand: lifecycleSettings.scheduler.command,
      activeScheduleWindowIds: lifecycleSettings.scheduler.windows.activeWindowIds,
      invalidScheduleWindowIds: lifecycleSettings.scheduler.windows.invalidWindowIds,
      validationErrors: lifecycleSettings.validationErrors
    }],
    accessBoundaryAudit: accessBoundary.auditRows.map((row) => ({
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      claimId: row.claimId,
      actorId: row.actorId,
      requestedAction: row.requestedAction,
      authorized: row.authorized,
      activeWorkspaceBindingIds: row.activeWorkspaceBindingIds,
      activeDelegationIds: row.activeDelegationIds,
      missingActionPermissions: row.missingActionPermissions
    })),
    releasableClaims: releasableClaims.map((claim) => ({
      id: claim.id,
      state: claim.state,
      proofRef: claim.proofRef,
      auditRef: claim.auditRef
    }))
  };
  const rows = applyExportProfileRows(allRows, exportProfile);
  const omittedSections = Object.keys(allRows).filter((section) => !Object.prototype.hasOwnProperty.call(rows, section));

  return {
    schema: "aios.verifierClaimGate.blockerReport.export.v1",
    generatedAt: now,
    route: `${surfaceGroup}/${surfaceName}`,
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    decisionInputs: {
      claimCount: claims.length,
      blockerCount: blockers.length,
      healthStatus: operationalHealth.status,
      retryRecommended: operationalHealth.retry.recommended,
      operationalFailureState: operationalIncident.state,
      nextRetryAt: operationalIncident.retry.nextAttemptAt,
      lifecycleEnabled: lifecycleSettings.enabled,
      lifecycleNextAction: lifecycleSettings.nextAction,
      missingProviderCapabilities: providerContracts.missingCapabilities,
      providerHandoffState: providerHandoff.state,
      readyServiceContractIds: serviceContracts.readyContractIds
    },
    counters: analytics,
    exportProfile,
    manifest: {
      format: exportProfile.format,
      deliveryRef: exportProfile.deliveryRef,
      ready: exportProfile.ready,
      rowLimit: exportProfile.rowLimit,
      includedSections: Object.keys(rows),
      omittedSections,
      rowCounts: Object.fromEntries(Object.entries(rows).map(([name, sectionRows]) => [name, sectionRows.length])),
      validationErrors: exportProfile.validationErrors
    },
    rows
  };
}

function buildExternalHandoffState(decision, providerContracts, providerHandoff, serviceContracts, operationalHealth, blockers) {
  const providerBlockerCodes = blockers
    .filter((blocker) => blocker.code.startsWith("integration."))
    .map((blocker) => blocker.code);
  const state = providerBlockerCodes.some((code) => code === "integration.provider_missing" || code === "integration.provider_unavailable" || code === "integration.capability_missing")
    ? "blocked"
    : decision === "release" && operationalHealth.status === "healthy"
      ? "ready"
      : decision === "hold"
        ? "pending-remediation"
        : "denied";

  return {
    state,
    protocol: "aios.hosted-kernel.external-handoff.v1",
    providerIds: providerContracts.providers.map((provider) => provider.id),
    capabilityNegotiation: {
      required: providerContracts.requiredCapabilities,
      provided: providerContracts.providedCapabilities,
      missing: providerContracts.missingCapabilities
    },
    providerAcknowledgements: {
      required: providerHandoff.required,
      state: providerHandoff.state,
      requiredProviderIds: providerHandoff.requiredProviderIds,
      readyProviderCount: providerHandoff.readyProviderCount,
      receiptCount: providerHandoff.receiptCount,
      unknownReceiptCount: providerHandoff.unknownReceiptCount,
      handoffs: providerHandoff.handoffs
    },
    serviceContracts: {
      requiredProviderIds: serviceContracts.requiredProviderIds,
      requiredDataResidency: serviceContracts.requiredDataResidency,
      readyContractIds: serviceContracts.readyContractIds,
      externalTickets: serviceContracts.externalTickets
    },
    syncMetadata: providerContracts.syncMetadata,
    pendingActions: providerBlockerCodes.length > 0
      ? providerBlockerCodes
      : operationalHealth.retry.recommended
        ? ["dependency.retry"]
        : []
  };
}

function buildTimeline(now, decision, blockers, operationalHealth, historySnapshots) {
  const currentEvent = {
    at: now,
    type: "current-report",
    decision,
    blockerCount: blockers.length,
    healthStatus: operationalHealth.status,
    blockerCodes: blockers.map((blocker) => blocker.code)
  };
  const historyEvents = historySnapshots.map((snapshot) => ({
    at: snapshot.capturedAt || null,
    type: "history-snapshot",
    decision: snapshot.decision,
    blockerCount: snapshot.blockerCount,
    healthStatus: snapshot.healthStatus,
    blockerCodes: snapshot.blockerCodes
  }));

  return [...historyEvents, currentEvent];
}

function buildReportingState(now, decision, claims, releasableClaims, blockers, operationalHealth, analytics, historySnapshots, exportSummary, timeline) {
  const previous = historySnapshots.at(-1) || null;
  const currentSnapshot = {
    schema: "aios.verifierClaimGate.blockerReport.historySnapshot.v1",
    id: `snapshot:${now}`,
    capturedAt: now,
    decision,
    healthStatus: operationalHealth.status,
    claimCount: claims.length,
    releasableClaimCount: releasableClaims.length,
    blockerCount: blockers.length,
    criticalCount: blockers.filter((blocker) => blocker.severity === "critical").length,
    blockingCount: blockers.filter((blocker) => blocker.severity === "blocking").length,
    blockerCodes: asStringList(blockers.map((blocker) => blocker.code))
  };
  const blockerDelta = previous ? currentSnapshot.blockerCount - previous.blockerCount : currentSnapshot.blockerCount;
  const criticalDelta = previous ? currentSnapshot.criticalCount - previous.criticalCount : currentSnapshot.criticalCount;
  const releasableDelta = previous ? currentSnapshot.releasableClaimCount - previous.releasableClaimCount : currentSnapshot.releasableClaimCount;
  const newBlockerCodes = previous
    ? currentSnapshot.blockerCodes.filter((code) => !previous.blockerCodes.includes(code))
    : currentSnapshot.blockerCodes;
  const resolvedBlockerCodes = previous
    ? previous.blockerCodes.filter((code) => !currentSnapshot.blockerCodes.includes(code))
    : [];
  const trend = blockerDelta > 0 || criticalDelta > 0
    ? "worsening"
    : blockerDelta < 0 || resolvedBlockerCodes.length > 0 || releasableDelta > 0
      ? "improving"
      : "stable";
  const alertLevel = currentSnapshot.criticalCount > 0 || exportSummary.exportProfile.validationErrors.length > 0
    ? "critical"
    : currentSnapshot.blockerCount > 0 || operationalHealth.status !== "healthy"
      ? "warning"
      : "clear";
  const reportingEvents = [
    {
      type: "report-snapshot",
      at: now,
      decision,
      trend,
      blockerCount: currentSnapshot.blockerCount,
      releasableClaimCount: currentSnapshot.releasableClaimCount
    },
    ...(exportSummary.manifest.ready
      ? [{
        type: "export-ready",
        at: now,
        format: exportSummary.manifest.format,
        sections: exportSummary.manifest.includedSections,
        rowCounts: exportSummary.manifest.rowCounts
      }]
      : [{
        type: "export-blocked",
        at: now,
        errors: exportSummary.manifest.validationErrors
      }])
  ];

  return {
    schema: "aios.verifierClaimGate.blockerReport.reportingState.v1",
    generatedAt: now,
    alertLevel,
    trend,
    currentSnapshot,
    previousSnapshotId: previous?.id || null,
    deltas: {
      blockers: blockerDelta,
      critical: criticalDelta,
      releasableClaims: releasableDelta,
      newBlockerCodes,
      resolvedBlockerCodes
    },
    counters: {
      blockerCodes: analytics.blockerCodes,
      blockerSeverities: analytics.blockerSeverities,
      providerCategories: analytics.providerCategories,
      dependencyCategories: analytics.dependencyCategories
    },
    exportManifest: exportSummary.manifest,
    timelineCursor: timeline.map((event) => event.at || "unknown").join("|"),
    reportingEvents
  };
}

function normalizeClientRequest(input, scope) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const client = input.client && typeof input.client === "object" ? input.client : {};
  const clientState = client.state && typeof client.state === "object" ? client.state : {};
  const runtime = input.runtime && typeof input.runtime === "object" ? input.runtime : {};
  const handoffIntent = input.handoffIntent && typeof input.handoffIntent === "object"
    ? input.handoffIntent
    : client.handoffIntent && typeof client.handoffIntent === "object"
      ? client.handoffIntent
      : request.handoffIntent && typeof request.handoffIntent === "object"
        ? request.handoffIntent
        : {};
  const requestedWorkspaceId = asNonEmptyString(request.workspaceId ?? client.workspaceId ?? scope.requestedWorkspaceId);
  const requestedTenantId = asNonEmptyString(request.tenantId ?? client.tenantId ?? scope.tenantId);

  return {
    schema: "aios.verifierClaimGate.blockerReport.clientRequest.v1",
    requestId: asNonEmptyString(request.id ?? request.requestId ?? input.requestId) || `request:${surfaceName}`,
    sessionId: asNonEmptyString(client.sessionId ?? request.sessionId),
    channel: asNonEmptyString(request.channel ?? client.channel) || "hosted-kernel",
    requestedAction: asNonEmptyString(request.action ?? client.action ?? input.action).toLowerCase() || "view-report",
    requestedRoute: asNonEmptyString(request.route) || `${surfaceGroup}/${surfaceName}`,
    tenantId: requestedTenantId || null,
    workspaceId: requestedWorkspaceId || null,
    routeMatchesScope: (!requestedTenantId || !scope.tenantId || requestedTenantId === scope.tenantId)
      && (!requestedWorkspaceId || !scope.workspaceId || requestedWorkspaceId === scope.workspaceId),
    clientState: {
      view: asNonEmptyString(clientState.view ?? client.view) || "blocker-report",
      selectedClaimIds: asStringList(clientState.selectedClaimIds ?? client.selectedClaimIds),
      expandedBlockerCodes: asStringList(clientState.expandedBlockerCodes),
      filterState: asNonEmptyString(clientState.filterState ?? client.filterState) || "all",
      stateCursor: asNonEmptyString(clientState.cursor ?? client.cursor ?? request.cursor)
    },
    runtime: {
      requestMode: asNonEmptyString(runtime.requestMode ?? request.mode) || "interactive",
      renderer: asNonEmptyString(runtime.renderer ?? client.renderer) || "unknown",
      offline: runtime.offline === true || client.offline === true,
      proofStoreCursor: asNonEmptyString(runtime.proofStoreCursor ?? request.proofStoreCursor),
      auditLogCursor: asNonEmptyString(runtime.auditLogCursor ?? request.auditLogCursor)
    },
    handoffIntent: {
      id: asNonEmptyString(handoffIntent.id ?? request.handoffIntentId ?? client.handoffIntentId),
      targetRoute: asNonEmptyString(handoffIntent.targetRoute ?? handoffIntent.route),
      action: asNonEmptyString(handoffIntent.action).toLowerCase(),
      claimId: asNonEmptyString(handoffIntent.claimId),
      blockerCode: asNonEmptyString(handoffIntent.blockerCode),
      correlationId: asNonEmptyString(handoffIntent.correlationId ?? request.correlationId ?? client.correlationId),
      returnRoute: asNonEmptyString(handoffIntent.returnRoute ?? client.returnRoute ?? request.returnRoute)
    }
  };
}

function normalizeClientRuntimeContracts(input, clientRequest) {
  const runtime = input.runtime && typeof input.runtime === "object" ? input.runtime : {};
  const client = input.client && typeof input.client === "object" ? input.client : {};
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const contracts = Array.isArray(runtime.clientContracts)
    ? runtime.clientContracts
    : Array.isArray(client.runtimeContracts)
      ? client.runtimeContracts
      : Array.isArray(request.clientContracts)
        ? request.clientContracts
        : [];

  return contracts.map((contract, index) => {
    const record = contract && typeof contract === "object" ? contract : {};
    return {
      id: asNonEmptyString(record.id ?? record.contractId) || `client-runtime-contract:${index + 1}`,
      route: asNonEmptyString(record.route ?? record.surfaceRoute) || clientRequest.requestedRoute,
      state: asNonEmptyString(record.state ?? record.status).toLowerCase() || "unknown",
      version: asNonEmptyString(record.version ?? record.contractVersion),
      renderer: asNonEmptyString(record.renderer ?? record.clientRenderer),
      capabilities: asStringList(record.capabilities),
      stateCursor: asNonEmptyString(record.stateCursor ?? record.cursor),
      acceptedPatchSchema: asNonEmptyString(record.acceptedPatchSchema ?? record.patchSchema),
      lastSeenAt: asNonEmptyString(record.lastSeenAt ?? record.updatedAt ?? record.receivedAt),
      returnRoute: asNonEmptyString(record.returnRoute ?? record.callbackRoute)
    };
  }).sort((left, right) => left.route.localeCompare(right.route) || left.id.localeCompare(right.id));
}

function buildClientRuntimeState(input, clientRequest, claims, currentBlockers, now) {
  const runtime = input.runtime && typeof input.runtime === "object" ? input.runtime : {};
  const client = input.client && typeof input.client === "object" ? input.client : {};
  const requestedAction = clientRequest.requestedAction;
  const requireRuntimeContract = runtime.requireClientRuntimeContract === true
    || client.requireRuntimeContract === true
    || ["release-claims", "append-audit"].includes(requestedAction)
    || clientRequest.handoffIntent.action === "release-claims"
    || clientRequest.handoffIntent.action === "append-audit";
  const maxAgeMs = asPositiveInteger(runtime.maxClientContractAgeMs ?? client.maxRuntimeContractAgeMs, 300000);
  const nowMs = Date.parse(now);
  const contracts = normalizeClientRuntimeContracts(input, clientRequest).map((contract) => {
    const lastSeenMs = Date.parse(contract.lastSeenAt);
    const ageMs = Number.isFinite(nowMs) && Number.isFinite(lastSeenMs) ? Math.max(0, nowMs - lastSeenMs) : null;
    const fresh = ageMs !== null && ageMs <= maxAgeMs;
    const routeMatches = contract.route === clientRequest.requestedRoute;
    const ready = ["ready", "active", "accepted"].includes(contract.state);
    const patchReady = contract.acceptedPatchSchema === "aios.verifierClaimGate.blockerReport.clientStatePatch.v1"
      || contract.capabilities.includes("client.state.patch.v1");

    return { ...contract, ageMs, fresh, routeMatches, ready, patchReady };
  });
  const requiredCapabilities = asStringList([
    "blocker-report.view.v1",
    "client.state.patch.v1",
    ...(requestedAction === "export-blockers" ? ["blocker-report.export.v1"] : []),
    ...(["release-claims", "append-audit"].includes(requestedAction) ? ["claim.release.preview.v1", "audit.append.intent.v1"] : []),
    ...(clientRequest.handoffIntent.targetRoute || clientRequest.handoffIntent.action || clientRequest.handoffIntent.claimId || clientRequest.handoffIntent.blockerCode ? ["workflow.handoff.intent.v1"] : [])
  ]);
  const usableContracts = contracts.filter((contract) => contract.routeMatches && contract.ready && contract.fresh);
  const providedCapabilities = asStringList(usableContracts.flatMap((contract) => contract.capabilities));
  const missingCapabilities = requiredCapabilities.filter((capability) => !providedCapabilities.includes(capability));
  const selectedUnknownClaimIds = clientRequest.clientState.selectedClaimIds
    .filter((claimId) => !claims.some((claim) => claim.id === claimId));
  const expandedUnknownBlockerCodes = clientRequest.clientState.expandedBlockerCodes
    .filter((code) => !currentBlockers.some((blocker) => blocker.code === code));
  const blockers = [];

  if (requireRuntimeContract && contracts.length === 0) {
    pushBlocker(blockers, "client.runtime_contract_missing", "critical", "Client runtime contract is required before hosted-kernel handoff can execute.", {
      requestedAction,
      requiredCapabilities
    });
  }
  for (const contract of contracts) {
    if (!contract.routeMatches) {
      pushBlocker(blockers, "client.runtime_route_mismatch", "critical", "Client runtime contract is bound to a different blocker-report route.", {
        contractId: contract.id,
        route: contract.route,
        requestedRoute: clientRequest.requestedRoute
      });
    } else if (!contract.ready) {
      pushBlocker(blockers, "client.runtime_not_ready", "blocking", "Client runtime contract is not ready to receive blocker-report state patches.", {
        contractId: contract.id,
        state: contract.state
      });
    } else if (!contract.fresh) {
      pushBlocker(blockers, "client.runtime_contract_stale", "blocking", "Client runtime contract heartbeat is missing or stale.", {
        contractId: contract.id,
        ageMs: contract.ageMs,
        maxAgeMs
      });
    } else if (!contract.patchReady) {
      pushBlocker(blockers, "client.state_patch_contract_missing", "blocking", "Client runtime cannot accept the blocker-report state patch schema.", {
        contractId: contract.id,
        acceptedPatchSchema: contract.acceptedPatchSchema || null
      });
    }
  }
  for (const capability of missingCapabilities) {
    if (requireRuntimeContract || contracts.length > 0) {
      pushBlocker(blockers, "client.runtime_capability_missing", "blocking", "Client runtime contract is missing a required workflow capability.", {
        capability,
        providedCapabilities
      });
    }
  }
  if (clientRequest.runtime.offline && ["release-claims", "append-audit"].includes(requestedAction)) {
    pushBlocker(blockers, "client.offline_release_blocked", "critical", "Offline clients cannot execute hosted-kernel release or audit append handoff.", {
      requestedAction
    });
  }
  if (selectedUnknownClaimIds.length > 0) {
    pushBlocker(blockers, "client.selection_claim_unknown", "blocking", "Client selected claim ids that are not present in this blocker report.", {
      selectedUnknownClaimIds
    });
  }

  return {
    schema: "aios.verifierClaimGate.blockerReport.clientRuntime.v1",
    generatedAt: now,
    required: requireRuntimeContract,
    maxAgeMs,
    state: blockers.some((blocker) => blocker.severity === "critical")
      ? "blocked"
      : blockers.length > 0
        ? "degraded"
        : contracts.length === 0
          ? "implicit"
          : "ready",
    contracts,
    requiredCapabilities,
    providedCapabilities,
    missingCapabilities,
    selectedUnknownClaimIds,
    expandedUnknownBlockerCodes,
    statePatchContract: {
      schema: "aios.verifierClaimGate.blockerReport.clientStatePatch.v1",
      cursor: clientRequest.clientState.stateCursor || null,
      route: clientRequest.requestedRoute,
      readyContractIds: usableContracts.filter((contract) => contract.patchReady).map((contract) => contract.id)
    },
    blockers
  };
}

function workflowTargetForBlocker(blocker) {
  const claimId = blocker.details?.claimId || null;
  if (blocker.code.startsWith("proof.")) {
    return {
      target: "proof-store",
      route: "verifier-claim-gate/proof-store",
      action: "attach-proof",
      owner: "verifier",
      claimId,
      blockerCode: blocker.code
    };
  }
  if (blocker.code.startsWith("audit.")) {
    return {
      target: "audit-log",
      route: "verifier-claim-gate/audit-log",
      action: "enable-audit-append",
      owner: "kernel-operator",
      claimId,
      blockerCode: blocker.code
    };
  }
  if (blocker.code.startsWith("permission.") || blocker.code.startsWith("tenant.") || blocker.code.startsWith("workspace.")) {
    return {
      target: "access-review",
      route: "verifier-claim-gate/access-review",
      action: "review-scope",
      owner: "workspace-admin",
      claimId,
      blockerCode: blocker.code
    };
  }
  if (blocker.code.startsWith("integration.")) {
    return {
      target: "provider-handoff",
      route: "verifier-claim-gate/provider-handoff",
      action: "repair-provider-contract",
      owner: "runtime-orchestrator",
      claimId,
      blockerCode: blocker.code
    };
  }
  if (blocker.code.startsWith("health.")) {
    return {
      target: "kernel-health",
      route: "verifier-claim-gate/kernel-health",
      action: "restore-dependency",
      owner: "kernel-operator",
      claimId,
      blockerCode: blocker.code
    };
  }
  if (blocker.code.startsWith("lifecycle.")) {
    return {
      target: "lifecycle-settings",
      route: "verifier-claim-gate/lifecycle-settings",
      action: blocker.code === "lifecycle.report_disabled" ? "enable-report" : "save-settings",
      owner: "kernel-operator",
      claimId,
      blockerCode: blocker.code
    };
  }
  return {
    target: "claim-review",
    route: "verifier-claim-gate/claim-review",
    action: "review-claim",
    owner: "verifier",
    claimId,
    blockerCode: blocker.code
  };
}

function buildClientHandoffIntentState(clientRequest, allowedActions, workflowTargets, releasableClaims, blockers, decision) {
  const intent = clientRequest.handoffIntent;
  const hasIntent = Boolean(intent.targetRoute || intent.action || intent.claimId || intent.blockerCode);
  const releasableClaimIds = new Set(releasableClaims.map((claim) => claim.id));
  const blockerMatches = blockers.filter((blocker) => {
    if (intent.claimId && blocker.details?.claimId !== intent.claimId) {
      return false;
    }
    if (intent.blockerCode && blocker.code !== intent.blockerCode) {
      return false;
    }
    return true;
  });
  const target = workflowTargets.find((candidate) => {
    if (intent.targetRoute && candidate.route !== intent.targetRoute) {
      return false;
    }
    if (intent.action && candidate.action !== intent.action) {
      return false;
    }
    if (intent.claimId && candidate.claimId !== intent.claimId) {
      return false;
    }
    if (intent.blockerCode && candidate.blockerCode !== intent.blockerCode) {
      return false;
    }
    return true;
  }) || null;
  const releaseIntent = intent.action === "release-claims" || intent.action === "append-audit";
  const releaseClaimValid = !intent.claimId || releasableClaimIds.has(intent.claimId);
  const accepted = hasIntent
    && clientRequest.routeMatchesScope
    && (
      target !== null && allowedActions.includes("open-remediation-workflow")
      || releaseIntent && allowedActions.includes(intent.action) && releaseClaimValid
    );

  return {
    schema: "aios.verifierClaimGate.blockerReport.handoffIntent.v1",
    present: hasIntent,
    accepted,
    intentId: intent.id || null,
    correlationId: intent.correlationId || null,
    requested: {
      route: intent.targetRoute || null,
      action: intent.action || null,
      claimId: intent.claimId || null,
      blockerCode: intent.blockerCode || null,
      returnRoute: intent.returnRoute || null
    },
    resolvedTarget: target,
    matchedBlockerCount: blockerMatches.length,
    deniedReason: accepted
      ? null
      : !hasIntent
        ? "handoff_intent_missing"
        : !clientRequest.routeMatchesScope
          ? "client_request_scope_mismatch"
          : releaseIntent && !releaseClaimValid
            ? "handoff_claim_not_releasable"
            : releaseIntent && !allowedActions.includes(intent.action)
              ? `handoff_release_not_allowed_for_${decision}`
              : target === null
                ? "handoff_target_not_available"
                : "handoff_action_not_allowed",
    nextAction: accepted
      ? releaseIntent
        ? intent.action
        : "open-remediation-workflow"
      : blockers.length > 0
        ? "refresh-blocker-report"
        : "view-report"
  };
}

function buildClientWorkflowHandoff(clientRequest, decision, scope, claims, releasableClaims, blockers, operationalHealth, providerContracts, providerHandoff, operationalIncident, exportSummary, lifecycleSettings, clientRuntimeState, now) {
  const selectedClaimIds = clientRequest.clientState.selectedClaimIds;
  const releasableClaimIds = new Set(releasableClaims.map((claim) => claim.id));
  const blockedClaimIds = new Set(blockers.map((blocker) => blocker.details?.claimId).filter(Boolean));
  const selectedReleasableClaimIds = selectedClaimIds.filter((claimId) => releasableClaimIds.has(claimId));
  const selectedBlockedClaimIds = selectedClaimIds.filter((claimId) => blockedClaimIds.has(claimId));
  const workflowTargets = [...new Map(blockers
    .map(workflowTargetForBlocker)
    .map((target) => [`${target.route}:${target.blockerCode}:${target.claimId || "scope"}`, target])
  ).values()];
  const canRelease = decision === "release" && clientRequest.routeMatchesScope && providerContracts.missingCapabilities.length === 0;
  const canRetry = operationalIncident.retry.allowed;
  const canEscalate = operationalIncident.escalation.required;
  const lifecycleActions = [
    ...(lifecycleSettings.controls.enableAllowed ? ["enable-report"] : []),
    ...(lifecycleSettings.controls.disableAllowed ? ["disable-report"] : []),
    ...(lifecycleSettings.controls.pauseAllowed ? ["pause-schedule"] : []),
    ...(lifecycleSettings.controls.resumeAllowed ? ["resume-schedule"] : []),
    ...(lifecycleSettings.controls.runNowAllowed ? ["run-now"] : []),
    ...(lifecycleSettings.controls.canManageLifecycle ? ["save-settings"] : [])
  ];
  const allowedActions = [
    "view-report",
    "export-blockers",
    ...lifecycleActions,
    ...(canRelease ? ["release-claims", "append-audit"] : []),
    ...(canRetry ? ["retry-runtime-checks"] : []),
    ...(canEscalate ? ["escalate-operational-incident"] : []),
    ...(workflowTargets.length > 0 ? ["open-remediation-workflow"] : [])
  ];
  const handoffIntent = buildClientHandoffIntentState(clientRequest, allowedActions, workflowTargets, releasableClaims, blockers, decision);

  return {
    schema: "aios.verifierClaimGate.blockerReport.clientWorkflowHandoff.v1",
    generatedAt: now,
    state: canRelease ? "ready" : decision === "hold" ? "needs-remediation" : "blocked",
    requestedAction: clientRequest.requestedAction,
    actionAccepted: allowedActions.includes(clientRequest.requestedAction),
    actionDeniedReason: allowedActions.includes(clientRequest.requestedAction)
      ? null
      : !clientRequest.routeMatchesScope
        ? "client_request_scope_mismatch"
        : `action_not_allowed_for_${decision}`,
    allowedActions,
    primaryAction: canRelease
      ? "release-claims"
      : canRetry
        ? "retry-runtime-checks"
        : canEscalate
          ? "escalate-operational-incident"
        : workflowTargets.length > 0
          ? "open-remediation-workflow"
          : "view-report",
    routeContext: {
      route: clientRequest.requestedRoute,
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      routeMatchesScope: clientRequest.routeMatchesScope
    },
    selection: {
      requestedClaimIds: selectedClaimIds,
      selectedReleasableClaimIds,
      selectedBlockedClaimIds,
      defaultClaimIds: selectedClaimIds.length > 0 ? selectedClaimIds : releasableClaims.map((claim) => claim.id)
    },
    statePatch: {
      decision,
      blockerCount: blockers.length,
      criticalBlockerCount: blockers.filter((blocker) => blocker.severity === "critical").length,
      releasableClaimIds: releasableClaims.map((claim) => claim.id),
      operationalFailureState: operationalIncident.state,
      nextRetryAt: operationalIncident.retry.nextAttemptAt,
      retryBudgetRemaining: operationalIncident.retry.budget.remaining,
      escalationRequired: operationalIncident.escalation.required,
      lifecycleEnabled: lifecycleSettings.enabled,
      lifecycleValid: lifecycleSettings.valid,
      lifecycleNextAction: lifecycleSettings.nextAction,
      lifecycleCommandAccepted: lifecycleSettings.controls.commandAccepted,
      lifecycleScheduleSuppressed: lifecycleSettings.scheduler.scheduleSuppressed,
      lifecycleSchedulerCommand: lifecycleSettings.scheduler.command,
      lifecycleScheduler: lifecycleSettings.scheduler,
      clientRuntimeState: clientRuntimeState.state,
      clientRuntimeContractIds: clientRuntimeState.contracts.map((contract) => contract.id),
      clientRuntimeRequiredCapabilities: clientRuntimeState.requiredCapabilities,
      clientRuntimeMissingCapabilities: clientRuntimeState.missingCapabilities,
      clientRuntimePatchReadyContractIds: clientRuntimeState.statePatchContract.readyContractIds,
      clientRuntimeSelectedUnknownClaimIds: clientRuntimeState.selectedUnknownClaimIds,
      providerSyncCursors: providerContracts.syncMetadata.cursors,
      providerHandoffState: providerHandoff.state,
      providerHandoffRequired: providerHandoff.required,
      providerHandoffReadyProviderCount: providerHandoff.readyProviderCount,
      providerHandoffReceiptCount: providerHandoff.receiptCount,
      handoffIntentAccepted: handoffIntent.accepted,
      handoffIntentNextAction: handoffIntent.nextAction,
      handoffCorrelationId: handoffIntent.correlationId,
      exportSchema: exportSummary.schema,
      exportRowCounts: Object.fromEntries(Object.entries(exportSummary.rows).map(([name, rows]) => [name, rows.length]))
    },
    handoffIntent,
    workflowTargets,
    userVisibleMessage: handoffIntent.present && handoffIntent.accepted
      ? `Handoff intent accepted for ${handoffIntent.nextAction}.`
      : handoffIntent.present
        ? `Handoff intent requires attention: ${handoffIntent.deniedReason}.`
        : blockers.length === 0
          ? `${releasableClaims.length} claim${releasableClaims.length === 1 ? "" : "s"} ready for hosted-kernel release.`
          : `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} require handoff before release.`
  };
}

function normalizeAcceptanceInput(input) {
  const acceptance = input.acceptance && typeof input.acceptance === "object" ? input.acceptance : {};
  const clientAcceptance = input.client?.acceptance && typeof input.client.acceptance === "object" ? input.client.acceptance : {};
  const requestedClaimIds = asStringList(acceptance.claimIds ?? clientAcceptance.claimIds);
  const acknowledgedBlockerCodes = asStringList(acceptance.acknowledgedBlockerCodes ?? clientAcceptance.acknowledgedBlockerCodes);
  const proofAppendRefs = asStringList(acceptance.proofAppendRefs ?? clientAcceptance.proofAppendRefs);

  return {
    schema: "aios.verifierClaimGate.blockerReport.acceptanceInput.v1",
    mode: asNonEmptyString(acceptance.mode ?? clientAcceptance.mode).toLowerCase() || "preview",
    accepted: acceptance.accepted === true || clientAcceptance.accepted === true,
    acceptedBy: asNonEmptyString(acceptance.acceptedBy ?? clientAcceptance.acceptedBy),
    acceptedAt: asNonEmptyString(acceptance.acceptedAt ?? clientAcceptance.acceptedAt),
    requestedClaimIds,
    acknowledgedBlockerCodes,
    proofAppendRefs,
    note: asNonEmptyString(acceptance.note ?? clientAcceptance.note)
  };
}

function buildPreviewRouteContracts({
  clientRequest,
  scope,
  acceptance,
  acceptanceAllowed,
  requestedClaimIds,
  requiredProofRefs,
  proofAuditLedger,
  clientWorkflowHandoff,
  validationGroups,
  now
}) {
  const blockingGroups = validationGroups.filter((group) => group.state !== "valid");
  const routeContext = {
    route: clientRequest.requestedRoute,
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    requestId: clientRequest.requestId,
    sessionId: clientRequest.sessionId || null,
    correlationId: clientRequest.handoffIntent.correlationId || null
  };
  const acceptancePayload = {
    accepted: acceptance.accepted,
    acceptedBy: acceptance.acceptedBy || null,
    acceptedAt: acceptance.acceptedAt || null,
    mode: acceptance.mode,
    note: acceptance.note || null,
    claimIds: requestedClaimIds,
    proofAppendRefs: requiredProofRefs,
    acknowledgedBlockerCodes: acceptance.acknowledgedBlockerCodes
  };
  const auditAppendPayload = {
    route: clientRequest.requestedRoute,
    tenantId: scope.tenantId || null,
    workspaceId: scope.workspaceId || null,
    claimIds: requestedClaimIds,
    appendRecords: proofAuditLedger.appendRecords
      .filter((record) => requestedClaimIds.includes(record.claimId))
      .map((record) => ({
        auditRef: record.auditRef,
        claimId: record.claimId,
        proofRef: record.proofRef,
        proofDigest: record.proofDigest,
        proofSigner: record.proofSigner,
        appendReady: record.appendReady
      }))
  };
  const statePatch = {
    previewAccepted: acceptanceAllowed,
    acceptedClaimIds: requestedClaimIds,
    acceptedProofAppendRefs: requiredProofRefs,
    blockedValidationGroups: blockingGroups.map((group) => group.id),
    nextAction: acceptanceAllowed ? "append-audit-and-release" : clientWorkflowHandoff.primaryAction,
    updatedAt: now
  };

  return {
    schema: "aios.verifierClaimGate.blockerReport.previewRouteContracts.v1",
    routeContext,
    contracts: [
      {
        id: "preview-state",
        consumer: "blocker-report-preview-route",
        method: "PATCH",
        route: clientRequest.requestedRoute,
        ready: true,
        payload: statePatch
      },
      {
        id: "acceptance-submit",
        consumer: "claim-gate-acceptance-client",
        method: "POST",
        route: `${clientRequest.requestedRoute}/acceptance`,
        ready: blockingGroups.length === 0,
        blockedBy: blockingGroups.map((group) => group.id),
        payload: acceptancePayload
      },
      {
        id: "audit-append",
        consumer: "hosted-kernel-audit-appender",
        method: "POST",
        route: "verifier-claim-gate/audit-log/append",
        ready: acceptanceAllowed,
        blockedBy: acceptanceAllowed ? [] : blockingGroups.map((group) => group.id),
        payload: auditAppendPayload
      }
    ],
    statePatch,
    acceptanceReceipt: acceptanceAllowed
      ? {
        schema: "aios.verifierClaimGate.blockerReport.acceptanceReceipt.v1",
        receiptId: `acceptance:${scope.tenantId || "tenant"}:${scope.workspaceId || "workspace"}:${clientRequest.requestId}`,
        acceptedBy: acceptance.acceptedBy,
        acceptedAt: acceptance.acceptedAt,
        claimIds: requestedClaimIds,
        proofAppendRefs: requiredProofRefs,
        auditAppendRecordCount: auditAppendPayload.appendRecords.length,
        nextRoute: "verifier-claim-gate/audit-log/append"
      }
      : null
  };
}

function normalizePersistedCommandLedger(input) {
  const persisted = input.persistedState && typeof input.persistedState === "object"
    ? input.persistedState
    : input.stateStore?.blockerReport && typeof input.stateStore.blockerReport === "object"
      ? input.stateStore.blockerReport
      : {};
  const ledger = Array.isArray(persisted.commandLedger)
    ? persisted.commandLedger
    : Array.isArray(persisted.commands)
      ? persisted.commands
      : [];

  return ledger.map((entry, index) => {
    const record = entry && typeof entry === "object" ? entry : {};
    return {
      id: asNonEmptyString(record.id) || `command:${index + 1}`,
      idempotencyKey: asNonEmptyString(record.idempotencyKey ?? record.key),
      command: asNonEmptyString(record.command ?? record.action).toLowerCase() || "unknown",
      status: asNonEmptyString(record.status ?? record.state).toLowerCase() || "unknown",
      reportFingerprint: asNonEmptyString(record.reportFingerprint ?? record.fingerprint),
      decision: asNonEmptyString(record.decision).toLowerCase() || "unknown",
      createdAt: asNonEmptyString(record.createdAt ?? record.requestedAt),
      completedAt: asNonEmptyString(record.completedAt ?? record.finishedAt),
      resultRef: asNonEmptyString(record.resultRef ?? record.auditRef ?? record.proofRef),
      errorCode: asNonEmptyString(record.errorCode ?? record.code)
    };
  }).sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });
}

function normalizePersistedReportState(input) {
  const persisted = input.persistedState && typeof input.persistedState === "object"
    ? input.persistedState
    : input.stateStore?.blockerReport && typeof input.stateStore.blockerReport === "object"
      ? input.stateStore.blockerReport
      : {};
  const lastSummary = persisted.lastSummary && typeof persisted.lastSummary === "object" ? persisted.lastSummary : {};

  return {
    schema: "aios.verifierClaimGate.blockerReport.persistedState.v1",
    present: Object.keys(persisted).length > 0,
    revision: asNonNegativeInteger(persisted.revision ?? persisted.version, 0),
    persistedAt: asNonEmptyString(persisted.persistedAt ?? persisted.updatedAt),
    reportFingerprint: asNonEmptyString(persisted.reportFingerprint ?? persisted.fingerprint),
    decision: asNonEmptyString(persisted.decision).toLowerCase() || "unknown",
    status: asNonEmptyString(persisted.status ?? persisted.state).toLowerCase() || "unknown",
    resumeCursor: asNonEmptyString(persisted.resumeCursor ?? persisted.cursor),
    lastSummary: {
      blockerCount: asNonNegativeInteger(lastSummary.blockerCount, 0),
      criticalCount: asNonNegativeInteger(lastSummary.criticalCount, 0),
      releasableClaimCount: asNonNegativeInteger(lastSummary.releasableClaimCount, 0),
      healthStatus: asNonEmptyString(lastSummary.healthStatus).toLowerCase() || "unknown",
      blockerCodes: asStringList(lastSummary.blockerCodes)
    },
    commandLedger: normalizePersistedCommandLedger(input)
  };
}

function normalizePersistedRecoveryEnvelope(input, now) {
  const persisted = input.persistedState && typeof input.persistedState === "object"
    ? input.persistedState
    : input.stateStore?.blockerReport && typeof input.stateStore.blockerReport === "object"
      ? input.stateStore.blockerReport
      : {};
  const recovery = persisted.recovery && typeof persisted.recovery === "object" ? persisted.recovery : {};
  const checkpoint = persisted.checkpoint && typeof persisted.checkpoint === "object" ? persisted.checkpoint : recovery.checkpoint && typeof recovery.checkpoint === "object" ? recovery.checkpoint : {};
  const leases = Array.isArray(recovery.commandLeases)
    ? recovery.commandLeases
    : Array.isArray(persisted.commandLeases)
      ? persisted.commandLeases
      : [];
  const nowMs = Date.parse(now);
  const normalizedLeases = leases.map((lease, index) => {
    const record = lease && typeof lease === "object" ? lease : {};
    const expiresAt = asNonEmptyString(record.expiresAt ?? record.leaseExpiresAt);
    const expiresMs = Date.parse(expiresAt);
    return {
      id: asNonEmptyString(record.id) || `lease:${index + 1}`,
      idempotencyKey: asNonEmptyString(record.idempotencyKey ?? record.key),
      command: asNonEmptyString(record.command ?? record.action).toLowerCase() || "unknown",
      status: asNonEmptyString(record.status ?? record.state).toLowerCase() || "unknown",
      ownerToken: asNonEmptyString(record.ownerToken ?? record.owner ?? record.workerId),
      acquiredAt: asNonEmptyString(record.acquiredAt ?? record.createdAt),
      heartbeatAt: asNonEmptyString(record.heartbeatAt ?? record.updatedAt),
      expiresAt,
      expired: Boolean(expiresAt) && Number.isFinite(nowMs) && Number.isFinite(expiresMs) && expiresMs <= nowMs,
      reportFingerprint: asNonEmptyString(record.reportFingerprint ?? record.fingerprint)
    };
  }).sort((left, right) => {
    const leftTime = Date.parse(left.acquiredAt);
    const rightTime = Date.parse(right.acquiredAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });

  return {
    schema: "aios.verifierClaimGate.blockerReport.persistedRecoveryEnvelope.v1",
    storeKey: asNonEmptyString(persisted.storeKey ?? recovery.storeKey) || `${surfaceGroup}/${surfaceName}`,
    schemaVersion: asNonEmptyString(persisted.schemaVersion ?? recovery.schemaVersion) || "v1",
    writeToken: asNonEmptyString(persisted.writeToken ?? persisted.etag ?? recovery.writeToken),
    checkpointState: asNonEmptyString(checkpoint.state ?? checkpoint.status ?? recovery.state).toLowerCase() || "unknown",
    checkpointCursor: asNonEmptyString(checkpoint.cursor ?? checkpoint.resumeCursor ?? persisted.resumeCursor),
    lastAppliedPatchId: asNonEmptyString(checkpoint.lastAppliedPatchId ?? recovery.lastAppliedPatchId),
    lastCommittedCommandId: asNonEmptyString(checkpoint.lastCommittedCommandId ?? recovery.lastCommittedCommandId),
    dirty: persisted.dirty === true || recovery.dirty === true || checkpoint.dirty === true,
    leases: normalizedLeases,
    expiredLeaseIds: normalizedLeases.filter((lease) => lease.expired).map((lease) => lease.id)
  };
}

function buildReportFingerprint(scope, claims, blockers, providerContracts, providerHandoff, serviceContracts, proofAuditLedger, clientRequest) {
  const claimKeys = claims.map((claim) => `${claim.id}:${claim.state}:${claim.proofRef || "no-proof"}`).sort();
  const blockerKeys = blockers
    .map((blocker) => `${blocker.code}:${blocker.severity}:${blocker.details?.claimId || blocker.details?.dependency || blocker.details?.providerId || "scope"}`)
    .sort();
  const providerKeys = providerContracts.providers
    .map((provider) => `${provider.id}:${provider.status}:${provider.sync.cursor || "no-cursor"}:${provider.sync.fresh ? "fresh" : "stale"}`)
    .sort();
  const proofKeys = proofAuditLedger.appendRecords
    .map((record) => `${record.claimId}:${record.proofRef}:${record.proofDigest || "no-digest"}:${record.appendReady ? "ready" : "blocked"}`)
    .sort();
  const handoffKeys = providerHandoff.handoffs
    .map((handoff) => `${handoff.providerId}:${handoff.receiptId || "no-receipt"}:${handoff.status}:${handoff.ready ? "ready" : "blocked"}`)
    .sort();
  const serviceContractKeys = serviceContracts.contracts
    .map((contract) => `${contract.providerId || "no-provider"}:${contract.id}:${contract.status}:${contract.handoff.callbackRoute || "no-callback"}:${contract.ready ? "ready" : "blocked"}`)
    .sort();

  return [
    surfaceId,
    scope.tenantId || "tenant:none",
    scope.workspaceId || "workspace:none",
    clientRequest.requestId,
    `claims=${claimKeys.join("|")}`,
    `blockers=${blockerKeys.join("|")}`,
    `providers=${providerKeys.join("|")}`,
    `handoffs=${handoffKeys.join("|")}`,
    `serviceContracts=${serviceContractKeys.join("|")}`,
    `proofs=${proofKeys.join("|")}`
  ].join("::");
}

function buildRestartPersistenceState(input, now, decision, scope, claims, releasableClaims, blockers, operationalHealth, providerContracts, providerHandoff, serviceContracts, proofAuditLedger, clientRequest, previewAcceptance) {
  const persistedState = normalizePersistedReportState(input);
  const recoveryEnvelope = normalizePersistedRecoveryEnvelope(input, now);
  const runtime = input.runtime && typeof input.runtime === "object" ? input.runtime : {};
  const restarted = runtime.restarted === true || input.restarted === true;
  const reportFingerprint = buildReportFingerprint(scope, claims, blockers, providerContracts, providerHandoff, serviceContracts, proofAuditLedger, clientRequest);
  const command = clientRequest.requestedAction;
  const idempotencyKey = asNonEmptyString(input.idempotencyKey ?? input.commandIdempotencyKey ?? input.request?.idempotencyKey)
    || `${scope.tenantId || "tenant"}:${scope.workspaceId || "workspace"}:${clientRequest.requestId}:${command}`;
  const matchingCommand = persistedState.commandLedger
    .filter((entry) => entry.idempotencyKey === idempotencyKey && entry.command === command)
    .at(-1) || null;
  const matchingLease = recoveryEnvelope.leases
    .filter((lease) => lease.idempotencyKey === idempotencyKey && lease.command === command)
    .at(-1) || null;
  const completedReplay = matchingCommand?.status === "completed" && matchingCommand.reportFingerprint === reportFingerprint;
  const pendingResume = matchingCommand && ["pending", "running", "accepted"].includes(matchingCommand.status) && matchingCommand.reportFingerprint === reportFingerprint;
  const activeLease = matchingLease && !matchingLease.expired && matchingLease.reportFingerprint === reportFingerprint;
  const expiredLease = matchingLease?.expired === true && (!matchingLease.reportFingerprint || matchingLease.reportFingerprint === reportFingerprint);
  const staleCommandReplay = matchingCommand && matchingCommand.reportFingerprint && matchingCommand.reportFingerprint !== reportFingerprint;
  const staleLeaseReplay = matchingLease && matchingLease.reportFingerprint && matchingLease.reportFingerprint !== reportFingerprint;
  const reportChangedSincePersist = persistedState.reportFingerprint && persistedState.reportFingerprint !== reportFingerprint;
  const priorHadFewerBlockers = persistedState.present && blockers.length > persistedState.lastSummary.blockerCount;
  const durableStatus = blockers.length === 0
    ? "ready-to-release"
    : operationalHealth.status === "failed" || providerContracts.missingCapabilities.length > 0
      ? "blocked-hard"
      : "blocked-recoverable";
  const recoveryState = !persistedState.present
    ? "cold-start"
    : completedReplay
      ? "idempotent-replay"
      : pendingResume || activeLease
        ? "resume-pending-command"
        : expiredLease
          ? "recover-expired-command-lease"
        : restarted && reportChangedSincePersist
          ? "restart-reconciled"
          : staleCommandReplay || staleLeaseReplay
            ? "command-state-stale"
            : reportChangedSincePersist
              ? "state-advanced"
              : "state-current";
  const commandStatus = completedReplay
    ? "replayed"
    : pendingResume
      ? "resume-required"
      : activeLease
        ? "leased"
        : expiredLease
          ? "lease-recovery-required"
      : previewAcceptance.validationSummary.acceptanceAllowed && command === "release-claims"
        ? "accepted"
        : blockers.length > 0
          ? "blocked"
          : "pending";
  const shouldExecuteCommand = !completedReplay && !pendingResume && !activeLease && !staleLeaseReplay && commandStatus !== "blocked";
  const restartSafeStatus = completedReplay
    ? "replay-safe"
    : staleCommandReplay || staleLeaseReplay
      ? "conflict"
      : activeLease
        ? "owned-by-active-lease"
        : expiredLease
          ? "lease-reclaim-required"
          : recoveryEnvelope.dirty || recoveryEnvelope.checkpointState === "dirty"
            ? "checkpoint-repair-required"
            : shouldExecuteCommand
              ? "ready-to-execute"
              : "blocked-before-execute";
  const storeOperation = persistedState.present ? "compare-and-swap" : "insert";
  const resumeCursor = [
    scope.tenantId || "tenant:none",
    scope.workspaceId || "workspace:none",
    reportFingerprint.length,
    blockers.length,
    providerContracts.syncMetadata.cursors.map((cursor) => cursor.cursor || "no-cursor").join(".")
  ].join(":");
  const recoveryWarnings = [
    ...(restarted && !persistedState.present ? ["restart_without_persisted_state"] : []),
    ...(reportChangedSincePersist ? ["persisted_report_fingerprint_changed"] : []),
    ...(priorHadFewerBlockers ? ["blocker_count_regressed_after_restore"] : []),
    ...(staleCommandReplay ? ["idempotency_key_seen_for_different_report"] : []),
    ...(staleLeaseReplay ? ["command_lease_seen_for_different_report"] : []),
    ...(activeLease ? ["active_command_lease_blocks_duplicate_execute"] : []),
    ...(expiredLease ? ["expired_command_lease_requires_reclaim"] : []),
    ...(recoveryEnvelope.dirty ? ["dirty_checkpoint_requires_rewrite"] : []),
    ...(pendingResume ? ["pending_command_requires_host_resume"] : [])
  ];

  return {
    schema: "aios.verifierClaimGate.blockerReport.restartPersistence.v1",
    generatedAt: now,
    reportFingerprint,
    recoveryState,
    restartDetected: restarted,
    durableWriteRequired: recoveryState !== "state-current" || commandStatus === "accepted" || shouldExecuteCommand,
    durableStatus,
    restartSafeStatus,
    persistedState,
    recoveryEnvelope,
    idempotentCommand: {
      idempotencyKey,
      command,
      status: commandStatus,
      shouldExecute: shouldExecuteCommand,
      replayedResultRef: completedReplay ? matchingCommand.resultRef || null : null,
      matchedCommandId: matchingCommand?.id || null,
      matchedLeaseId: matchingLease?.id || null,
      leaseExpired: matchingLease?.expired ?? null,
      deniedReason: commandStatus === "blocked"
        ? `command_blocked_for_${decision}`
        : staleCommandReplay || staleLeaseReplay
          ? "idempotency_key_conflicts_with_current_report"
          : activeLease
            ? "active_command_lease_exists"
          : null
    },
    recoveryPlan: {
      operation: storeOperation,
      expectedRevision: persistedState.present ? persistedState.revision : 0,
      expectedWriteToken: recoveryEnvelope.writeToken || null,
      expectedFingerprint: persistedState.reportFingerprint || null,
      acquireLease: shouldExecuteCommand || expiredLease,
      reclaimLeaseId: expiredLease ? matchingLease.id : null,
      preserveLeaseId: activeLease ? matchingLease.id : null,
      resumeCommandId: pendingResume ? matchingCommand.id : null,
      completeWithoutExecute: completedReplay,
      commandEffect: command === "release-claims"
        ? "append-audit-and-release-claims"
        : command === "append-audit"
          ? "append-audit-records"
          : command === "export-blockers"
            ? "emit-blocker-report-export"
            : command.startsWith("retry-")
              ? "resume-runtime-retry"
              : "persist-report-observation"
    },
    statePatch: {
      revision: persistedState.revision + 1,
      persistedAt: now,
      storeOperation,
      expectedWriteToken: recoveryEnvelope.writeToken || null,
      reportFingerprint,
      decision,
      status: durableStatus,
      restartSafeStatus,
      resumeCursor,
      recovery: {
        schemaVersion: recoveryEnvelope.schemaVersion,
        checkpointState: "clean",
        checkpointCursor: resumeCursor,
        lastAppliedPatchId: `patch:${persistedState.revision + 1}:${reportFingerprint.length}`,
        lastCommittedCommandId: completedReplay ? matchingCommand.id : null,
        commandLeases: activeLease
          ? recoveryEnvelope.leases
          : recoveryEnvelope.leases.filter((lease) => lease.id !== matchingLease?.id)
      },
      lastSummary: {
        blockerCount: blockers.length,
        criticalCount: blockers.filter((blocker) => blocker.severity === "critical").length,
        releasableClaimCount: releasableClaims.length,
        healthStatus: operationalHealth.status,
        blockerCodes: asStringList(blockers.map((blocker) => blocker.code))
      },
      commandLedgerEntry: {
        id: `command:${persistedState.commandLedger.length + 1}`,
        idempotencyKey,
        command,
        status: commandStatus === "accepted" ? "pending" : commandStatus,
        reportFingerprint,
        decision,
        createdAt: now,
        completedAt: completedReplay ? matchingCommand.completedAt || null : null,
        resultRef: completedReplay ? matchingCommand.resultRef || null : null,
        errorCode: commandStatus === "blocked" ? `command_blocked_for_${decision}` : null
      }
    },
    recoveryWarnings
  };
}

function buildPreviewAcceptanceState(input, clientRequest, decision, scope, claims, releasableClaims, blockers, operationalHealth, providerContracts, proofAuditLedger, clientWorkflowHandoff, now) {
  const acceptance = normalizeAcceptanceInput(input);
  const releasableClaimIds = releasableClaims.map((claim) => claim.id);
  const requestedClaimIds = acceptance.requestedClaimIds.length > 0
    ? acceptance.requestedClaimIds
    : clientWorkflowHandoff.selection.defaultClaimIds;
  const unknownRequestedClaimIds = requestedClaimIds.filter((claimId) => !claims.some((claim) => claim.id === claimId));
  const blockedRequestedClaimIds = requestedClaimIds.filter((claimId) => !releasableClaimIds.includes(claimId));
  const requiredProofRefs = releasableClaims
    .filter((claim) => requestedClaimIds.includes(claim.id))
    .map((claim) => claim.proofRef)
    .filter(Boolean);
  const missingProofAppendRefs = requiredProofRefs.filter((proofRef) => !acceptance.proofAppendRefs.includes(proofRef));
  const unacknowledgedBlockerCodes = asStringList(blockers.map((blocker) => blocker.code))
    .filter((code) => !acceptance.acknowledgedBlockerCodes.includes(code));
  const readinessChecks = [
    {
      id: "scope",
      label: "Route scope",
      state: clientRequest.routeMatchesScope && Boolean(scope.tenantId) && Boolean(scope.workspaceId) ? "ready" : "blocked",
      reason: clientRequest.routeMatchesScope ? "Client request matches the report tenant and workspace." : "Client request scope does not match this report."
    },
    {
      id: "claims",
      label: "Selected claims",
      state: requestedClaimIds.length > 0 && blockedRequestedClaimIds.length === 0 && unknownRequestedClaimIds.length === 0 ? "ready" : "blocked",
      reason: blockedRequestedClaimIds.length > 0
        ? "One or more selected claims still has blockers."
        : unknownRequestedClaimIds.length > 0
          ? "One or more selected claims is not present in this report."
          : "Selected claims are releasable."
    },
    {
      id: "proof-audit",
      label: "Proof audit append",
      state: proofAuditLedger.appendReady && missingProofAppendRefs.length === 0 ? "ready" : "blocked",
      reason: proofAuditLedger.appendReady ? "Proof receipts are trusted and audit append records are ready." : "Proof receipts or audit append readiness are incomplete."
    },
    {
      id: "runtime",
      label: "Hosted-kernel runtime",
      state: operationalHealth.status === "healthy" && providerContracts.missingCapabilities.length === 0 ? "ready" : "blocked",
      reason: operationalHealth.status === "healthy" ? "Runtime health checks and provider capabilities are available." : "Runtime health must be restored before release."
    },
    {
      id: "acceptance",
      label: "Operator acceptance",
      state: acceptance.accepted && Boolean(acceptance.acceptedBy) && Boolean(acceptance.acceptedAt) ? "ready" : "needs-input",
      reason: acceptance.accepted ? "Acceptance metadata is present." : "Operator acceptance has not been recorded."
    }
  ];
  const readinessState = readinessChecks.some((check) => check.state === "blocked")
    ? "blocked"
    : readinessChecks.some((check) => check.state === "needs-input")
      ? "awaiting-acceptance"
      : "ready";
  const acceptanceAllowed = decision === "release"
    && readinessState === "ready"
    && clientWorkflowHandoff.actionAccepted
    && clientWorkflowHandoff.allowedActions.includes("release-claims");
  const validationGroups = [
    {
      id: "route-scope",
      label: "Route scope",
      state: clientRequest.routeMatchesScope && Boolean(scope.tenantId) && Boolean(scope.workspaceId) ? "valid" : "invalid",
      deniedReasons: [
        ...(!clientRequest.routeMatchesScope ? ["route_scope_mismatch"] : []),
        ...(!scope.tenantId ? ["tenant_missing"] : []),
        ...(!scope.workspaceId ? ["workspace_missing"] : [])
      ]
    },
    {
      id: "claim-selection",
      label: "Claim selection",
      state: unknownRequestedClaimIds.length === 0 && blockedRequestedClaimIds.length === 0 && requestedClaimIds.length > 0 ? "valid" : "invalid",
      deniedReasons: [
        ...(requestedClaimIds.length === 0 ? ["claim_selection_empty"] : []),
        ...(unknownRequestedClaimIds.length > 0 ? ["unknown_claim_selection"] : []),
        ...(blockedRequestedClaimIds.length > 0 ? ["blocked_claim_selection"] : [])
      ]
    },
    {
      id: "proof-append",
      label: "Proof append refs",
      state: proofAuditLedger.appendReady && missingProofAppendRefs.length === 0 ? "valid" : "invalid",
      deniedReasons: [
        ...(!proofAuditLedger.appendReady ? ["proof_audit_append_not_ready"] : []),
        ...(missingProofAppendRefs.length > 0 ? ["missing_proof_append_refs"] : [])
      ]
    },
    {
      id: "operator-acceptance",
      label: "Operator acceptance",
      state: acceptance.accepted && acceptance.acceptedBy && acceptance.acceptedAt ? "valid" : "needs-input",
      deniedReasons: [
        ...(!acceptance.accepted ? ["operator_acceptance_missing"] : []),
        ...(acceptance.accepted && (!acceptance.acceptedBy || !acceptance.acceptedAt) ? ["operator_acceptance_metadata_missing"] : [])
      ]
    }
  ];
  const routeContracts = buildPreviewRouteContracts({
    clientRequest,
    scope,
    acceptance,
    acceptanceAllowed,
    requestedClaimIds,
    requiredProofRefs,
    proofAuditLedger,
    clientWorkflowHandoff,
    validationGroups,
    now
  });

  return {
    schema: "aios.verifierClaimGate.blockerReport.previewAcceptance.v1",
    generatedAt: now,
    mode: acceptance.mode,
    preview: {
      title: acceptanceAllowed ? "Ready to release verifier claims" : "Verifier claim release preview",
      message: blockers.length === 0
        ? `${requestedClaimIds.length} selected claim${requestedClaimIds.length === 1 ? "" : "s"} can be released after acceptance.`
        : `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} must be resolved or acknowledged before release.`,
      route: clientRequest.requestedRoute,
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      selectedClaimIds: requestedClaimIds,
      releasableClaimIds,
      blockedClaimIds: blockedRequestedClaimIds,
      proofAppendRefs: requiredProofRefs
    },
    readiness: {
      state: readinessState,
      checks: readinessChecks,
      readyCheckCount: readinessChecks.filter((check) => check.state === "ready").length,
      requiredCheckCount: readinessChecks.length
    },
    validationSummary: {
      accepted: acceptance.accepted,
      acceptedBy: acceptance.acceptedBy || null,
      acceptedAt: acceptance.acceptedAt || null,
      acceptanceAllowed,
      deniedReasons: [
        ...(!clientRequest.routeMatchesScope ? ["route_scope_mismatch"] : []),
        ...(decision !== "release" ? [`decision_${decision}`] : []),
        ...(unknownRequestedClaimIds.length > 0 ? ["unknown_claim_selection"] : []),
        ...(blockedRequestedClaimIds.length > 0 ? ["blocked_claim_selection"] : []),
        ...(missingProofAppendRefs.length > 0 ? ["missing_proof_append_refs"] : []),
        ...(unacknowledgedBlockerCodes.length > 0 ? ["unacknowledged_blockers"] : []),
        ...(!acceptance.accepted ? ["operator_acceptance_missing"] : []),
        ...(acceptance.accepted && (!acceptance.acceptedBy || !acceptance.acceptedAt) ? ["operator_acceptance_metadata_missing"] : [])
      ],
      unknownRequestedClaimIds,
      blockedRequestedClaimIds,
      missingProofAppendRefs,
      unacknowledgedBlockerCodes
    },
    validationGroups,
    routeContracts,
    nextSteps: clientWorkflowHandoff.workflowTargets.length > 0
      ? clientWorkflowHandoff.workflowTargets.map((target) => ({
        action: target.action,
        owner: target.owner,
        route: target.route,
        claimId: target.claimId,
        blockerCode: target.blockerCode,
        reason: "Resolve the blocker before accepting the hosted-kernel release preview."
      }))
      : [{
        action: acceptanceAllowed ? "append-audit-and-release" : "record-operator-acceptance",
        owner: acceptanceAllowed ? "runtime-orchestrator" : "verifier",
        route: clientRequest.requestedRoute,
        claimId: null,
        blockerCode: null,
        reason: acceptanceAllowed
          ? "All readiness checks passed and the route can consume audit append refs."
          : "Record acceptance metadata with selected claims and proof append refs."
      }]
  };
}

export function describeBlockerReportSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const scope = normalizeScope(input);
  const clientRequest = normalizeClientRequest(input, scope);
  const claims = normalizeClaims(input);
  const operationalHealth = evaluateOperationalHealth(input, now);
  const providerContracts = evaluateProviderContracts(input, now);
  const providerHandoff = evaluateProviderHandoffReceipts(input, providerContracts, now);
  const serviceContracts = evaluateServiceContracts(input, scope, providerContracts, now);
  const proofAuditLedger = buildProofAuditLedger(scope, claims, input, now);
  const lifecycleSettings = normalizeLifecycleSettings(input, scope, now);
  const accessBoundary = buildAccessBoundaryReport(scope, claims, input, clientRequest, now);
  const preClientRuntimeBlockers = [
    ...accessBoundary.blockers,
    ...proofAuditLedger.blockers,
    ...operationalHealth.blockers,
    ...providerContracts.blockers,
    ...providerHandoff.blockers,
    ...serviceContracts.blockers,
    ...lifecycleSettings.blockers
  ];
  const clientRuntimeState = buildClientRuntimeState(input, clientRequest, claims, preClientRuntimeBlockers, now);
  const blockers = [
    ...preClientRuntimeBlockers,
    ...clientRuntimeState.blockers
  ];
  const criticalCount = blockers.filter((blocker) => blocker.severity === "critical").length;
  const blockingCount = blockers.filter((blocker) => blocker.severity === "blocking").length;
  const proofAuditByClaimId = new Map(proofAuditLedger.claimProofs.map((proof) => [proof.claimId, proof]));
  const releasableClaims = claims
    .filter((claim) => !blockers.some((blocker) => blocker.details.claimId === claim.id))
    .map((claim) => ({
      id: claim.id,
      state: claim.state,
      proofRef: claim.proofRef,
      auditRef: proofAuditByClaimId.get(claim.id)?.auditRef || claim.auditRef || `audit:${scope.tenantId || "unknown"}:${scope.workspaceId || "unknown"}:${claim.id}`
    }));
  const decision = blockers.length === 0 ? "release" : criticalCount > 0 ? "deny" : "hold";
  const historySnapshots = normalizeHistorySnapshots(input);
  const analytics = buildAnalyticsCounters(claims, blockers, operationalHealth, providerContracts, providerHandoff, serviceContracts, historySnapshots, proofAuditLedger, accessBoundary);
  const operationalIncident = buildOperationalIncidentState(input, now, decision, blockers, operationalHealth, providerContracts);
  const exportProfile = normalizeExportProfile(input, clientRequest);
  const exportSummary = buildExportSummary(scope, claims, releasableClaims, blockers, operationalHealth, providerContracts, providerHandoff, serviceContracts, operationalIncident, analytics, proofAuditLedger, lifecycleSettings, accessBoundary, exportProfile, now);
  const timeline = buildTimeline(now, decision, blockers, operationalHealth, historySnapshots);
  const reportingState = buildReportingState(now, decision, claims, releasableClaims, blockers, operationalHealth, analytics, historySnapshots, exportSummary, timeline);
  const externalHandoffState = buildExternalHandoffState(decision, providerContracts, providerHandoff, serviceContracts, operationalHealth, blockers);
  const clientWorkflowHandoff = buildClientWorkflowHandoff(
    clientRequest,
    decision,
    scope,
    claims,
    releasableClaims,
    blockers,
    operationalHealth,
    providerContracts,
    providerHandoff,
    operationalIncident,
    exportSummary,
    lifecycleSettings,
    clientRuntimeState,
    now
  );
  const previewAcceptance = buildPreviewAcceptanceState(
    input,
    clientRequest,
    decision,
    scope,
    claims,
    releasableClaims,
    blockers,
    operationalHealth,
    providerContracts,
    proofAuditLedger,
    clientWorkflowHandoff,
    now
  );
  const restartPersistence = buildRestartPersistenceState(
    input,
    now,
    decision,
    scope,
    claims,
    releasableClaims,
    blockers,
    operationalHealth,
    providerContracts,
    providerHandoff,
    serviceContracts,
    proofAuditLedger,
    clientRequest,
    previewAcceptance
  );

  return {
    ok: blockers.length === 0,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel verifier claim blocker report",
    decision,
    scope,
    summary: {
      claimCount: claims.length,
      releasableClaimCount: releasableClaims.length,
      blockerCount: blockers.length,
      criticalCount,
      blockingCount,
      healthStatus: operationalHealth.status,
      operationalFailureState: operationalIncident.state,
      retryRecommended: operationalHealth.retry.recommended,
      retryAllowed: operationalIncident.retry.allowed,
      retryBudgetRemaining: operationalIncident.retry.budget.remaining,
      nextRetryAt: operationalIncident.retry.nextAttemptAt,
      escalationRequired: operationalIncident.escalation.required,
      integrationProviderCount: providerContracts.providers.length,
      missingProviderCapabilityCount: providerContracts.missingCapabilities.length,
      providerHandoffState: providerHandoff.state,
      providerHandoffRequired: providerHandoff.required,
      providerHandoffReceiptCount: providerHandoff.receiptCount,
      providerHandoffReadyProviderCount: providerHandoff.readyProviderCount,
      serviceContractCount: serviceContracts.contracts.length,
      serviceContractReadyCount: serviceContracts.readyContractIds.length,
      serviceContractBlockerCount: serviceContracts.blockers.length,
      clientWorkflowState: clientWorkflowHandoff.state,
      accessBoundaryState: accessBoundary.state,
      missingActionPermissionCount: accessBoundary.missingActionPermissions.length,
      activeWorkspaceBindingCount: accessBoundary.activeWorkspaceBindingIds.length,
      activeDelegationCount: accessBoundary.activeDelegationIds.length,
      clientRuntimeState: clientRuntimeState.state,
      clientRuntimeRequired: clientRuntimeState.required,
      clientRuntimeContractCount: clientRuntimeState.contracts.length,
      clientRuntimeReadyPatchContractCount: clientRuntimeState.statePatchContract.readyContractIds.length,
      clientRuntimeMissingCapabilityCount: clientRuntimeState.missingCapabilities.length,
      clientRuntimeBlockerCount: clientRuntimeState.blockers.length,
      clientPrimaryAction: clientWorkflowHandoff.primaryAction,
      clientHandoffIntentPresent: clientWorkflowHandoff.handoffIntent.present,
      clientHandoffIntentAccepted: clientWorkflowHandoff.handoffIntent.accepted,
      clientHandoffIntentNextAction: clientWorkflowHandoff.handoffIntent.nextAction,
      lifecycleEnabled: lifecycleSettings.enabled,
      lifecycleValid: lifecycleSettings.valid,
      lifecycleMode: lifecycleSettings.mode,
      lifecycleNextAction: lifecycleSettings.nextAction,
      lifecycleCommandAccepted: lifecycleSettings.controls.commandAccepted,
      lifecycleScheduleDue: lifecycleSettings.scheduler.due,
      lifecycleScheduleSuppressed: lifecycleSettings.scheduler.scheduleSuppressed,
      lifecycleNextDueAt: lifecycleSettings.scheduler.nextDueAt,
      previewReadinessState: previewAcceptance.readiness.state,
      acceptanceAllowed: previewAcceptance.validationSummary.acceptanceAllowed,
      previewDeniedReasonCount: previewAcceptance.validationSummary.deniedReasons.length,
      restartRecoveryState: restartPersistence.recoveryState,
      durableStatus: restartPersistence.durableStatus,
      durableWriteRequired: restartPersistence.durableWriteRequired,
      idempotentCommandStatus: restartPersistence.idempotentCommand.status,
      idempotentCommandShouldExecute: restartPersistence.idempotentCommand.shouldExecute,
      previousBlockerCount: historySnapshots.at(-1)?.blockerCount ?? null,
      blockerDeltaFromPrevious: analytics.blockerDeltaFromPrevious,
      reportingAlertLevel: reportingState.alertLevel,
      reportingTrend: reportingState.trend,
      reportingNewBlockerCodeCount: reportingState.deltas.newBlockerCodes.length,
      reportingResolvedBlockerCodeCount: reportingState.deltas.resolvedBlockerCodes.length,
      exportReady: exportSummary.manifest.ready,
      exportFormat: exportSummary.manifest.format,
      exportIncludedSectionCount: exportSummary.manifest.includedSections.length,
      exportValidationErrorCount: exportSummary.manifest.validationErrors.length
    },
    blockers,
    operationalHealth,
    operationalIncident,
    providerContracts,
    providerHandoff,
    serviceContracts,
    proofAuditLedger,
    lifecycleSettings,
    accessBoundary,
    clientRuntimeState,
    externalHandoffState,
    clientRequest,
    clientWorkflowHandoff,
    previewAcceptance,
    restartPersistence,
    analytics,
    historySnapshots,
    exportSummary,
    reportingState,
    timeline,
    auditHandoff: {
      required: blockers.length > 0 || claims.length > 0,
      tenantId: scope.tenantId || null,
      workspaceId: scope.workspaceId || null,
      actorId: scope.actor.id,
      generatedAt: now,
      route: `${surfaceGroup}/${surfaceName}`,
      proofRefs: releasableClaims.map((claim) => claim.proofRef).filter(Boolean),
      blockerCodes: blockers.map((blocker) => blocker.code),
      analyticsCounters: analytics,
      reportingState,
      currentHistorySnapshot: reportingState.currentSnapshot,
      reportingEvents: reportingState.reportingEvents,
      timelineEventCount: timeline.length,
      exportSchema: exportSummary.schema,
      exportProfile: exportSummary.exportProfile,
      exportManifest: exportSummary.manifest,
      externalHandoffState: externalHandoffState.state,
      operationalFailureState: operationalIncident.state,
      operationalRetry: operationalIncident.retry,
      operationalEscalation: operationalIncident.escalation,
      remediationQueueCount: operationalIncident.remediationQueue.length,
      proofAuditAppendRequired: proofAuditLedger.appendRequired,
      proofAuditAppendReady: proofAuditLedger.appendReady,
      proofAuditAppendRecords: proofAuditLedger.appendRecords,
      lifecycleEnabled: lifecycleSettings.enabled,
      lifecycleValid: lifecycleSettings.valid,
      lifecycleControls: lifecycleSettings.controls,
      lifecycleScheduler: lifecycleSettings.scheduler,
      lifecycleSchedulerCommand: lifecycleSettings.scheduler.command,
      lifecycleActiveScheduleWindowIds: lifecycleSettings.scheduler.windows.activeWindowIds,
      lifecycleInvalidScheduleWindowIds: lifecycleSettings.scheduler.windows.invalidWindowIds,
      lifecycleNextAction: lifecycleSettings.nextAction,
      lifecycleValidationErrors: lifecycleSettings.validationErrors,
      accessBoundaryState: accessBoundary.state,
      accessBoundarySchema: accessBoundary.schema,
      accessBoundaryRequestedAction: accessBoundary.requestedAction,
      accessBoundaryRequiredPermissions: accessBoundary.requiredActionPermissions,
      accessBoundaryEffectivePermissions: accessBoundary.effectivePermissions,
      accessBoundaryMissingPermissions: accessBoundary.missingActionPermissions,
      accessBoundaryWorkspaceBindingIds: accessBoundary.activeWorkspaceBindingIds,
      accessBoundaryDelegationIds: accessBoundary.activeDelegationIds,
      accessBoundaryAuditRows: accessBoundary.auditRows,
      clientRuntimeState: clientRuntimeState.state,
      clientRuntimeRequired: clientRuntimeState.required,
      clientRuntimeContracts: clientRuntimeState.contracts,
      clientRuntimeRequiredCapabilities: clientRuntimeState.requiredCapabilities,
      clientRuntimeMissingCapabilities: clientRuntimeState.missingCapabilities,
      clientRuntimeStatePatchContract: clientRuntimeState.statePatchContract,
      clientRuntimeSelectedUnknownClaimIds: clientRuntimeState.selectedUnknownClaimIds,
      clientWorkflowState: clientWorkflowHandoff.state,
      clientPrimaryAction: clientWorkflowHandoff.primaryAction,
      clientHandoffIntent: clientWorkflowHandoff.handoffIntent,
      previewReadinessState: previewAcceptance.readiness.state,
      acceptanceAllowed: previewAcceptance.validationSummary.acceptanceAllowed,
      acceptanceDeniedReasons: previewAcceptance.validationSummary.deniedReasons,
      acceptedClaimIds: previewAcceptance.preview.selectedClaimIds,
      restartRecoveryState: restartPersistence.recoveryState,
      durableStatus: restartPersistence.durableStatus,
      durableWriteRequired: restartPersistence.durableWriteRequired,
      restartRecoveryWarnings: restartPersistence.recoveryWarnings,
      persistedReportFingerprint: restartPersistence.reportFingerprint,
      persistedStatePatch: restartPersistence.statePatch,
      idempotentCommand: restartPersistence.idempotentCommand,
      providerSyncCursors: providerContracts.syncMetadata.cursors,
      requiredProviderCapabilities: providerContracts.requiredCapabilities,
      missingProviderCapabilities: providerContracts.missingCapabilities,
      providerHandoffState: providerHandoff.state,
      providerHandoffRequired: providerHandoff.required,
      providerHandoffReceipts: providerHandoff.receipts,
      providerHandoffRows: providerHandoff.handoffs,
      serviceContractSchema: serviceContracts.schema,
      serviceContractReadyIds: serviceContracts.readyContractIds,
      serviceContractRequiredProviderIds: serviceContracts.requiredProviderIds,
      serviceContractExternalTickets: serviceContracts.externalTickets,
      serviceContractBlockerCount: serviceContracts.blockers.length
    },
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    releasableClaims
  };
}

export default describeBlockerReportSurface;
