const CLAIM_PROTOCOL = "aios.mailchimp.claim-contract.v1";
const EVIDENCE_PROTOCOL = "aios.mailchimp.claim-evidence.v1";
const CLAIM_READINESS_PROTOCOL = "aios.mailchimp.claim-readiness-preview.v1";

const CLAIM_RULES = Object.freeze({
  campaign_identity: Object.freeze(["campaignId", "campaignName"]),
  audience_bound: Object.freeze(["listId"]),
  content_ready: Object.freeze(["subjectLine", "previewText", "templateId"]),
  schedule_intent: Object.freeze(["sendAt"]),
  adapter_safe_handoff: Object.freeze(["idempotencyKey", "tenantId", "workspaceId"])
});

function compactString(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return compactString(value).toLowerCase().replaceAll("-", "_");
}

function stableList(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : String(value).split(",");
  return [...new Set(list.map(compactString).filter(Boolean))].sort();
}

function stableObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getFact(source, key) {
  const facts = stableObject(source.facts);
  const payload = stableObject(source.payload);
  const runtimeScope = stableObject(source.runtimeScope);
  return source[key] ?? facts[key] ?? payload[key] ?? runtimeScope[key] ?? "";
}

function claimIdFor(kind, source) {
  const tenantId = compactString(getFact(source, "tenantId")) || "tenant";
  const workspaceId = compactString(getFact(source, "workspaceId")) || "workspace";
  const campaignId = compactString(getFact(source, "campaignId")) || compactString(getFact(source, "campaignName")) || "campaign";
  return ["mailchimp.claim", tenantId, workspaceId, campaignId, kind].map(normalizeToken).join(".");
}

function buildClaim(kind, source, options = {}) {
  const requiredFacts = stableList(options.requiredFacts ?? CLAIM_RULES[kind] ?? []);
  const facts = Object.fromEntries(requiredFacts.map((fact) => [fact, compactString(getFact(source, fact))]));
  const missingFacts = requiredFacts.filter((fact) => !facts[fact]);
  const evidence = stableList(source.evidence?.[kind] ?? source.evidenceIds ?? options.evidenceIds);
  const requiresEvidence = options.requiresEvidence !== false;
  const evidenceSatisfied = !requiresEvidence || evidence.length > 0;
  const status = missingFacts.length > 0 ? "missing_facts" : evidenceSatisfied ? "satisfied" : "missing_evidence";

  return {
    id: claimIdFor(kind, source),
    kind,
    status,
    requiredFacts,
    facts,
    missingFacts,
    evidence,
    requiresEvidence,
    restartSafe: status === "satisfied",
    recoveryCode:
      status === "missing_facts"
        ? "mailchimp.claim.missing_facts"
        : status === "missing_evidence"
          ? "mailchimp.claim.missing_evidence"
          : null
  };
}

export function compileMailchimpClaimContract(source = {}, options = {}) {
  const kinds = stableList(options.claimKinds ?? source.claimKinds ?? Object.keys(CLAIM_RULES));
  const claims = kinds.map((kind) => buildClaim(normalizeToken(kind), source, options.claimOptions?.[kind] ?? {}));
  const failed = claims.filter((claim) => claim.status !== "satisfied");
  const externalWrite = source.externalWrite === true || source.kind === "campaign-send";

  return {
    protocol: CLAIM_PROTOCOL,
    adapter: "mailchimp",
    tenantId: compactString(getFact(source, "tenantId")),
    workspaceId: compactString(getFact(source, "workspaceId")),
    campaignId: compactString(getFact(source, "campaignId")),
    sourceId: compactString(source.sourceId || source.requestId || source.id),
    claims,
    status: failed.length === 0 ? "satisfied" : "blocked",
    restartSafe: failed.length === 0,
    externalWritePermittedAfterVerification: externalWrite && failed.length === 0,
    blockedClaims: failed.map((claim) => claim.id),
    recovery: failed.map((claim) => ({
      code: claim.recoveryCode,
      claimId: claim.id,
      kind: claim.kind,
      missingFacts: claim.missingFacts,
      action: claim.status === "missing_evidence" ? "collect-verifier-evidence" : "bind-required-mailchimp-facts"
    })),
    truthBoundary: {
      source: "mailchimp-claim-stdlib",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: CLAIM_PROTOCOL
    }
  };
}

export function buildMailchimpClaimEvidence(contract = {}, runtime = {}) {
  const claims = Array.isArray(contract.claims) ? contract.claims : [];
  const verifier = stableObject(runtime.verifier);
  const evidenceIds = stableList(runtime.evidenceIds ?? verifier.evidenceIds);

  return {
    protocol: EVIDENCE_PROTOCOL,
    adapter: "mailchimp",
    contractProtocol: contract.protocol || CLAIM_PROTOCOL,
    checkedAt: compactString(runtime.checkedAt),
    claimEvidence: claims.map((claim) => {
      const directEvidence = stableList(runtime.evidence?.[claim.kind] ?? claim.evidence);
      const evidence = stableList([...directEvidence, ...evidenceIds.filter((id) => id.includes(claim.kind))]);
      return {
        claimId: compactString(claim.id),
        kind: compactString(claim.kind),
        evidence,
        satisfied: claim.requiresEvidence === false || evidence.length > 0,
        missingFacts: stableList(claim.missingFacts)
      };
    })
  };
}

export function buildMailchimpClaimStatusHandoff(contract = {}, runtime = {}) {
  const normalized =
    contract.protocol === CLAIM_PROTOCOL ? contract : compileMailchimpClaimContract(contract, runtime.compileOptions ?? {});
  const evidence = buildMailchimpClaimEvidence(normalized, runtime);
  const validation = validateMailchimpClaimContract(normalized, runtime);
  const operationalHealth = buildMailchimpClaimOperationalHealth(normalized, runtime);
  const failedKinds = validation.failedClaims.map((claim) => claim.kind);
  const missingFacts = uniqueSorted(validation.failedClaims.flatMap((claim) => claim.missingFacts));
  const missingEvidence = validation.failedClaims
    .filter((claim) => claim.code === "mailchimp.claim.missing_evidence")
    .map((claim) => claim.kind);
  const acceptedEvidence = evidence.claimEvidence
    .filter((entry) => entry.satisfied)
    .flatMap((entry) => entry.evidence);
  const status = validation.passed
    ? "claims_satisfied"
    : missingFacts.length > 0
      ? "claims_missing_facts"
      : "claims_missing_evidence";

  return {
    protocol: "aios.mailchimp.claim-status-handoff.v1",
    adapter: "mailchimp",
    contractProtocol: normalized.protocol,
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    campaignId: normalized.campaignId,
    sourceId: normalized.sourceId,
    status,
    ready: validation.passed,
    restartSafe: validation.passed && normalized.restartSafe,
    degraded: operationalHealth.mode === "degraded",
    adapterStatus: validation.passed ? "adapter-claims-ready" : "adapter-claims-blocked",
    nextAction: validation.passed
      ? "package.approval.request"
      : missingFacts.length > 0
        ? "package.settings.fix"
        : "process.verify",
    verifier: {
      requiredEvidence: normalized.claims
        .filter((claim) => claim.requiresEvidence)
        .map((claim) => claim.kind),
      acceptedEvidence: stableList(acceptedEvidence),
      missingEvidence,
      missingFacts,
    },
    operationalHealth,
    blockedReasons: uniqueSorted([
      ...missingFacts.map((fact) => `missing Mailchimp fact: ${fact}`),
      ...missingEvidence.map((kind) => `missing verifier evidence for claim: ${kind}`),
      ...operationalHealth.actionableErrors.map((error) => error.message),
    ]),
    recovery: validation.recovery.map((entry) => ({
      code: entry.code,
      claimId: entry.claimId,
      kind: entry.kind,
      command: entry.action === "collect-verifier-evidence" ? "process.verify" : "package.settings.fix",
      restartSafe: false,
      action: entry.action,
    })),
    truthBoundary: {
      localOnly: true,
      externalWritesPermitted: normalized.externalWritePermittedAfterVerification === true && validation.passed,
      externalWritesObserved: [],
      evaluatedAgainst: normalized.truthBoundary.evaluatedAgainst,
    },
  };
}

export function buildMailchimpClaimReadinessPreview(contract = {}, runtime = {}) {
  const normalized =
    contract.protocol === CLAIM_PROTOCOL ? contract : compileMailchimpClaimContract(contract, runtime.compileOptions ?? {});
  const evidence = buildMailchimpClaimEvidence(normalized, runtime);
  const validation = validateMailchimpClaimContract(normalized, runtime);
  const operationalHealth = buildMailchimpClaimOperationalHealth(normalized, runtime);
  const evidenceByClaim = new Map(evidence.claimEvidence.map((entry) => [entry.claimId, entry]));
  const rows = normalized.claims.map((claim) => {
    const evidenceEntry = evidenceByClaim.get(claim.id) ?? {};
    const missingFacts = stableList(claim.missingFacts);
    const missingEvidence = claim.requiresEvidence !== false && evidenceEntry.satisfied !== true;
    const passed = missingFacts.length === 0 && !missingEvidence;
    return {
      claimId: claim.id,
      kind: claim.kind,
      status: passed ? "ready" : missingFacts.length > 0 ? "missing_facts" : "missing_evidence",
      badge: passed ? "accepted" : missingFacts.length > 0 ? "settings" : "verify",
      requiredFacts: claim.requiredFacts,
      missingFacts,
      evidence: stableList(evidenceEntry.evidence),
      requiresEvidence: claim.requiresEvidence !== false,
      command: passed
        ? null
        : missingFacts.length > 0 ? "package.settings.fix" : "process.verify",
      restartSafe: passed && claim.restartSafe === true,
    };
  });
  const missingFacts = uniqueSorted(rows.flatMap((row) => row.missingFacts));
  const missingEvidence = rows
    .filter((row) => row.status === "missing_evidence")
    .map((row) => row.kind);
  const accepted = rows.filter((row) => row.status === "ready");
  const ready = validation.passed && missingFacts.length === 0 && missingEvidence.length === 0;
  const nextAction = ready
    ? "package.approval.request"
    : missingFacts.length > 0 ? "package.settings.fix" : "process.verify";
  const blockers = uniqueSorted([
    ...missingFacts.map((fact) => `missing Mailchimp fact: ${fact}`),
    ...missingEvidence.map((kind) => `missing verifier evidence for claim: ${kind}`),
    ...operationalHealth.actionableErrors.map((error) => error.message),
  ]);

  return {
    protocol: CLAIM_READINESS_PROTOCOL,
    adapter: "mailchimp",
    contractProtocol: normalized.protocol,
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    campaignId: normalized.campaignId,
    sourceId: normalized.sourceId,
    status: ready ? "ready_for_approval" : "blocked",
    ready,
    restartSafe: ready && normalized.restartSafe,
    degraded: operationalHealth.mode === "degraded",
    nextAction,
    message: blockers.length > 0
      ? blockers.join("; ")
      : "Mailchimp claim readiness is satisfied for operator approval.",
    counters: {
      required: rows.length,
      ready: accepted.length,
      missingFacts: missingFacts.length,
      missingEvidence: missingEvidence.length,
      evidenceAccepted: uniqueSorted(accepted.flatMap((row) => row.evidence)).length,
      blockerCount: blockers.length,
      healthErrors: operationalHealth.actionableErrors.length,
      retryableErrors: operationalHealth.retryPlan.retryable ? 1 : 0,
    },
    operationalHealth,
    acceptanceGate: {
      requiredBeforeApproval: true,
      command: ready ? "package.approval.request" : nextAction,
      satisfied: ready,
      reason: ready
        ? "claim facts and verifier evidence are complete"
        : blockers[0] ?? "claim readiness is blocked",
    },
    validationSummary: {
      valid: ready,
      errors: blockers,
      warnings: [],
      blockedReasons: blockers,
      checked: {
        claimCount: rows.length,
        requiredEvidence: rows.filter((row) => row.requiresEvidence).length,
        missingFactCount: missingFacts.length,
        missingEvidenceCount: missingEvidence.length,
      },
    },
    rows,
    nextSteps: ready
      ? [{
        action: "package.approval.request",
        label: "Request operator approval",
        reason: "claims are ready for the Mailchimp approval workflow",
      }]
      : blockers.map((reason) => ({
        action: nextAction,
        label: reason.startsWith("missing verifier evidence")
          ? "Collect verifier evidence"
          : "Update Mailchimp settings",
        reason,
      })),
    localOnly: true,
  };
}

export function validateMailchimpClaimContract(contract = {}, runtime = {}) {
  const normalized =
    contract.protocol === CLAIM_PROTOCOL ? contract : compileMailchimpClaimContract(contract, runtime.compileOptions ?? {});
  const evidence = buildMailchimpClaimEvidence(normalized, runtime);
  const evidenceByClaim = new Map(evidence.claimEvidence.map((entry) => [entry.claimId, entry]));
  const results = normalized.claims.map((claim) => {
    const entry = evidenceByClaim.get(claim.id) ?? {};
    const missingFacts = stableList(claim.missingFacts);
    const evidenceSatisfied = claim.requiresEvidence === false || entry.satisfied === true;
    const passed = missingFacts.length === 0 && evidenceSatisfied;
    return {
      claimId: claim.id,
      kind: claim.kind,
      passed,
      code: passed
        ? "ok"
        : missingFacts.length > 0
          ? "mailchimp.claim.missing_facts"
          : "mailchimp.claim.missing_evidence",
      missingFacts,
      evidence: stableList(entry.evidence)
    };
  });
  const failed = results.filter((result) => !result.passed);

  return {
    protocol: "aios.mailchimp.claim-validation.v1",
    adapter: "mailchimp",
    contractProtocol: normalized.protocol,
    passed: failed.length === 0,
    status: failed.length === 0 ? "ready" : "blocked",
    results,
    failedClaims: failed,
    recovery: failed.map((result) => ({
      code: result.code,
      claimId: result.claimId,
      kind: result.kind,
      action: result.missingFacts.length > 0 ? "bind-required-mailchimp-facts" : "collect-verifier-evidence"
    }))
  };
}

export function buildMailchimpClaimOperationalHealth(contract = {}, runtime = {}) {
  const normalized =
    contract.protocol === CLAIM_PROTOCOL ? contract : compileMailchimpClaimContract(contract, runtime.compileOptions ?? {});
  const validation = validateMailchimpClaimContract(normalized, runtime);
  const adapterStatus = normalizeToken(runtime.adapterHealth?.status ?? runtime.adapterStatus ?? "unknown");
  const adapterRetryAfter = Number(runtime.adapterHealth?.retryAfterSeconds ?? runtime.retryAfterSeconds);
  const observedFailures = stableList(runtime.failures ?? runtime.failureCodes);
  const attemptCount = Number(runtime.attemptCount ?? runtime.retry?.attempts ?? 0);
  const maxAttempts = Number(runtime.maxAttempts ?? runtime.retry?.maxAttempts ?? 3);
  const exhausted = Number.isFinite(maxAttempts) && maxAttempts >= 0 && attemptCount >= maxAttempts;
  const adapterDegraded = ["degraded", "rate_limited", "timeout"].includes(adapterStatus);
  const adapterUnhealthy = ["failed", "unhealthy", "offline"].includes(adapterStatus);
  const validationErrors = validation.failedClaims.map((claim) => ({
    code: claim.code,
    claimId: claim.claimId,
    kind: claim.kind,
    severity: claim.code === "mailchimp.claim.missing_facts" ? "blocking" : "recoverable",
    command: claim.code === "mailchimp.claim.missing_facts" ? "package.settings.fix" : "process.verify",
    message: claim.code === "mailchimp.claim.missing_facts"
      ? `missing Mailchimp fact for claim: ${claim.kind}`
      : `missing verifier evidence for claim: ${claim.kind}`,
    retryable: claim.code !== "mailchimp.claim.missing_facts",
  }));
  const runtimeErrors = observedFailures.map((code) => ({
    code,
    claimId: null,
    kind: "runtime",
    severity: adapterUnhealthy ? "blocking" : "recoverable",
    command: adapterUnhealthy ? "process.inspect" : "process.retry",
    message: `Mailchimp claim runtime observed failure: ${code}`,
    retryable: !adapterUnhealthy,
  }));
  const adapterErrors = [
    ...(adapterDegraded ? [{
      code: "mailchimp.claim.adapter_degraded",
      claimId: null,
      kind: "adapter",
      severity: "recoverable",
      command: "process.retry",
      message: "Mailchimp claim verifier is degraded; retry after backoff",
      retryable: true,
    }] : []),
    ...(adapterUnhealthy ? [{
      code: "mailchimp.claim.adapter_unhealthy",
      claimId: null,
      kind: "adapter",
      severity: "blocking",
      command: "process.inspect",
      message: "Mailchimp claim verifier is unhealthy",
      retryable: false,
    }] : []),
  ];
  const actionableErrors = uniqueByCodeAndSubject([
    ...validationErrors,
    ...runtimeErrors,
    ...adapterErrors,
  ]);
  const retryableErrors = actionableErrors.filter((error) => error.retryable);
  const retryAfterSeconds = Number.isFinite(adapterRetryAfter)
    ? Math.max(0, Math.floor(adapterRetryAfter))
    : retryableErrors.length > 0
      ? Math.min(300, 15 * (2 ** Math.max(0, Math.min(4, attemptCount))))
      : null;
  const mode = actionableErrors.length === 0
    ? "healthy"
    : actionableErrors.every((error) => error.retryable) && !exhausted
      ? "degraded"
      : "failed";
  const primaryAction = mode === "healthy"
    ? "package.approval.request"
    : actionableErrors.find((error) => error.severity === "blocking")?.command
      ?? actionableErrors[0]?.command
      ?? "process.inspect";

  return {
    protocol: "aios.mailchimp.claim-operational-health.v1",
    adapter: "mailchimp",
    contractProtocol: normalized.protocol,
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
    mode,
    ready: mode === "healthy" && validation.passed,
    degraded: mode === "degraded",
    validationStatus: validation.status,
    adapterStatus: adapterStatus || "unknown",
    primaryAction,
    actionableErrors,
    retryPlan: {
      retryable: retryableErrors.length > 0 && !exhausted,
      attemptCount: Number.isFinite(attemptCount) ? Math.max(0, Math.floor(attemptCount)) : 0,
      maxAttempts: Number.isFinite(maxAttempts) ? Math.max(0, Math.floor(maxAttempts)) : 3,
      exhausted,
      retryAfterSeconds,
      command: retryableErrors.length > 0 && !exhausted ? "process.retry" : primaryAction,
      backoff: retryAfterSeconds == null ? "none" : "exponential",
    },
    degradedMode: {
      allowed: mode === "degraded" && !exhausted,
      command: "process.degraded-mode",
      reason: actionableErrors.map((error) => error.message).join("; ") || null,
    },
    recovery: actionableErrors.map((error) => ({
      code: error.code,
      claimId: error.claimId,
      kind: error.kind,
      command: error.command,
      retryable: error.retryable,
      severity: error.severity,
    })),
    truthBoundary: {
      source: "mailchimp-claim-operational-health",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: normalized.truthBoundary.evaluatedAgainst,
    },
  };
}

export function mailchimpClaimContractSelfCheck(source = {}) {
  const contract = compileMailchimpClaimContract(source);
  const validation = validateMailchimpClaimContract(contract, source.runtime ?? {});
  const operationalHealth = buildMailchimpClaimOperationalHealth(contract, source.runtime ?? {});
  return {
    protocol: "aios.mailchimp.claim-self-check.v1",
    deterministic: true,
    importSideEffects: false,
    contractStatus: contract.status,
    validationStatus: validation.status,
    healthMode: operationalHealth.mode,
    retryable: operationalHealth.retryPlan.retryable,
    blockedClaims: contract.blockedClaims
  };
}

export const mailchimpClaimProtocols = Object.freeze({
  contract: CLAIM_PROTOCOL,
  evidence: EVIDENCE_PROTOCOL,
  readinessPreview: CLAIM_READINESS_PROTOCOL,
  operationalHealth: "aios.mailchimp.claim-operational-health.v1",
  statusHandoff: "aios.mailchimp.claim-status-handoff.v1"
});

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))].sort();
}

function uniqueByCodeAndSubject(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = [value.code, value.claimId ?? value.kind, value.command].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
