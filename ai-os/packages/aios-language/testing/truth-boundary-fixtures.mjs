const FIXTURE_PROTOCOL = "aios.testing.mailchimp-truth-boundary-fixture.v1";

export const MAILCHIMP_TRUTH_BOUNDARY_FIXTURE_SOURCE = Object.freeze({
  boundaryId: "truth.mailchimp.campaign-draft",
  provider: "mailchimp",
  declaredFacts: [
    { claim: "campaign.content.source", source: "campaignDraft", authority: "local-memory" },
    { claim: "audience.segment.source", source: "audienceSnapshot", authority: "provider-read" },
    { claim: "adapter.recovery.status_handoff", source: "operatorStatus", authority: "runtime" }
  ],
  blockedFacts: [
    { claim: "campaign.performance.predicted", reason: "No provider report exists before send." },
    { claim: "audience.consent.inferred", reason: "Consent must come from provider evidence." }
  ],
  verifierChecks: [
    { name: "campaignDraft.subject.exists", fact: "campaign.content.source", required: true },
    { name: "audienceSnapshot.segment.resolved", fact: "audience.segment.source", required: true },
    { name: "adapterRecovery.status.handoff", fact: "adapter.recovery.status_handoff", required: true }
  ]
});

function compact(value) {
  return String(value ?? "").trim();
}

function uniqueSorted(values) {
  return [...new Set(values.map(compact).filter(Boolean))].sort();
}

function issue(code, severity, field, message) {
  return { code: compact(code), severity: compact(severity), field: compact(field), message: compact(message) };
}

function normalizeTruthSource(source) {
  return {
    ...source,
    boundaryId: compact(source.boundaryId),
    provider: compact(source.provider || "mailchimp"),
    declaredFacts: Array.isArray(source.declaredFacts) ? source.declaredFacts : [],
    blockedFacts: Array.isArray(source.blockedFacts) ? source.blockedFacts : [],
    verifierChecks: Array.isArray(source.verifierChecks) ? source.verifierChecks : []
  };
}

function compileDeclaredFacts(source) {
  return source.declaredFacts.map((fact) => ({
    claim: compact(fact.claim),
    source: compact(fact.source),
    authority: compact(fact.authority),
    provider: source.provider,
    exportableToClaimPacket: true
  }));
}

function compileBlockedFacts(source) {
  return source.blockedFacts.map((fact) => ({
    claim: compact(fact.claim),
    reason: compact(fact.reason),
    provider: source.provider,
    severity: "error",
    runtimeEffect: "block_claim_export"
  }));
}

function compileVerifierChecks(source, declaredFacts) {
  const declared = new Set(declaredFacts.map((fact) => fact.claim));

  return source.verifierChecks.map((check) => ({
    name: compact(check.name),
    fact: compact(check.fact),
    required: check.required !== false,
    provider: source.provider,
    declared: declared.has(compact(check.fact)),
    failureStatus: "operator_review_required"
  }));
}

function buildClaimBoundary(declaredFacts, blockedFacts, verifierChecks) {
  return {
    allowedClaims: declaredFacts.map((fact) => fact.claim).sort(),
    blockedClaims: blockedFacts.map((fact) => fact.claim).sort(),
    claimPacketEvidence: verifierChecks
      .filter((check) => check.required)
      .map((check) => ({
        check: check.name,
        claim: check.fact,
        statusOnFailure: check.failureStatus
      }))
      .sort((left, right) => left.check.localeCompare(right.check))
  };
}

function validateTruthBoundaryContract(contract) {
  const issues = [];
  const allowedClaims = new Set(contract.claimBoundary.allowedClaims);
  const blockedClaims = new Set(contract.claimBoundary.blockedClaims);
  const undeclaredChecks = contract.verifierChecks.filter((check) => !check.declared).map((check) => check.name);
  const overlap = [...allowedClaims].filter((claim) => blockedClaims.has(claim));

  if (contract.provider !== "mailchimp") issues.push(issue("mailchimp.truth.provider_mismatch", "error", "provider", "Truth boundary must target Mailchimp."));
  if (!allowedClaims.has("adapter.recovery.status_handoff")) issues.push(issue("mailchimp.truth.missing_recovery_claim", "error", "declaredFacts", "Recovery/status handoff must be declared as a fact."));
  if (undeclaredChecks.length) issues.push(issue("mailchimp.truth.undeclared_verifier_fact", "error", "verifierChecks", `Verifier checks reference undeclared facts: ${undeclaredChecks.join(",")}.`));
  if (overlap.length) issues.push(issue("mailchimp.truth.allowed_blocked_overlap", "error", "blockedFacts", `Claims cannot be both allowed and blocked: ${overlap.join(",")}.`));
  if (!blockedClaims.has("campaign.performance.predicted")) issues.push(issue("mailchimp.truth.prediction_not_blocked", "warning", "blockedFacts", "Pre-send performance prediction should be blocked from claim export."));

  return {
    ok: issues.every((entry) => entry.severity !== "error"),
    issues,
    summary: {
      allowedClaims: uniqueSorted([...allowedClaims]),
      blockedClaims: uniqueSorted([...blockedClaims]),
      verifierChecks: contract.verifierChecks.map((check) => check.name).sort()
    }
  };
}

export function buildMailchimpTruthBoundaryFixture(source = MAILCHIMP_TRUTH_BOUNDARY_FIXTURE_SOURCE) {
  const normalized = normalizeTruthSource(source);
  const declaredFacts = compileDeclaredFacts(normalized);
  const blockedFacts = compileBlockedFacts(normalized);
  const verifierChecks = compileVerifierChecks(normalized, declaredFacts);
  const claimBoundary = buildClaimBoundary(declaredFacts, blockedFacts, verifierChecks);
  const contract = {
    kind: "aios.truthBoundaryContract",
    protocol: FIXTURE_PROTOCOL,
    boundaryId: normalized.boundaryId,
    provider: normalized.provider,
    declaredFacts,
    blockedFacts,
    verifierChecks,
    claimBoundary,
    adapterRecovery: {
      statusOnVerifierFailure: "operator_review_required",
      handoffClaim: "adapter.recovery.status_handoff"
    }
  };
  const validation = validateTruthBoundaryContract(contract);

  return {
    kind: "aios.testing.mailchimpTruthBoundaryFixture",
    protocol: FIXTURE_PROTOCOL,
    source: normalized,
    contract,
    validation,
    expected: {
      allowedClaims: claimBoundary.allowedClaims,
      blockedClaims: claimBoundary.blockedClaims,
      requiredEvidenceChecks: claimBoundary.claimPacketEvidence.map((entry) => entry.check),
      statusOnVerifierFailure: contract.adapterRecovery.statusOnVerifierFailure
    }
  };
}

export function assertMailchimpTruthBoundaryFixture(fixture = buildMailchimpTruthBoundaryFixture()) {
  return {
    ok: fixture.validation.ok
      && fixture.contract.kind === "aios.truthBoundaryContract"
      && fixture.expected.allowedClaims.includes("adapter.recovery.status_handoff")
      && fixture.expected.blockedClaims.includes("campaign.performance.predicted")
      && fixture.expected.statusOnVerifierFailure === "operator_review_required",
    issueCodes: fixture.validation.issues.map((entry) => entry.code),
    claimBoundary: fixture.contract.claimBoundary,
    summary: fixture.validation.summary
  };
}

export const MAILCHIMP_TRUTH_BOUNDARY_FIXTURE_PROTOCOL = FIXTURE_PROTOCOL;
