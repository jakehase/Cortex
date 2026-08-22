import { buildMailchimpOperatorFixture } from "./operator-fixtures.mjs";
import { buildMailchimpPackageFixture } from "./package-fixtures.mjs";
import { buildMailchimpTruthBoundaryFixture } from "./truth-boundary-fixtures.mjs";

const HARNESS_PROTOCOL = "aios.testing.mailchimp-integration-harness.v1";

function compact(value) {
  return String(value ?? "").trim();
}

function uniqueSorted(values) {
  return [...new Set(values.map(compact).filter(Boolean))].sort();
}

function issue(code, severity, field, message) {
  return { code: compact(code), severity: compact(severity), field: compact(field), message: compact(message) };
}

function collectIssues(fixtures) {
  return Object.entries(fixtures).flatMap(([fixtureName, fixture]) => (
    fixture.validation.issues.map((entry) => ({
      ...entry,
      fixture: fixtureName
    }))
  ));
}

function buildRuntimeEnvelope(packageFixture, operatorFixture, truthFixture) {
  const packageContract = packageFixture.contract;
  const operatorContract = operatorFixture.contract;
  const truthContract = truthFixture.contract;
  const job = packageContract.kernelJobs[0] || {};
  const reviewState = operatorContract.statusMatrix.find((entry) => entry.state === operatorFixture.expected.reviewState);
  const readyState = operatorContract.statusMatrix.find((entry) => entry.state === "preview_ready");

  return {
    kind: "aios.integration.runtimeEnvelope",
    provider: "mailchimp",
    packageRef: packageFixture.expected.packageRef,
    jobId: job.id || null,
    adapter: job.adapter || "mailchimp",
    statusHandoff: {
      initialState: "queued",
      readyState: readyState?.state || "preview_ready",
      recoveryState: reviewState?.state || "operator_review_required",
      nextActionOnAdapterFailure: reviewState?.nextAction || operatorFixture.expected.retryCommand,
      visibleStates: operatorFixture.expected.operatorVisibleStates
    },
    recovery: {
      mode: job.recovery?.mode || "retry-with-idempotency-key",
      retryCommand: operatorFixture.expected.retryCommand,
      maxAttempts: operatorContract.recovery.maxAttempts,
      blocksResumeWithoutVerifier: packageContract.verifier.blocksAdapterResume === true,
      statusOnVerifierFailure: truthFixture.expected.statusOnVerifierFailure
    },
    contracts: {
      capabilities: packageContract.capabilities.map((capability) => capability.name).sort(),
      memory: packageContract.memory.map((mount) => mount.name).sort(),
      allowedClaims: truthFixture.expected.allowedClaims,
      blockedClaims: truthFixture.expected.blockedClaims
    }
  };
}

function buildClaimExportEnvelope(runtimeEnvelope, truthFixture) {
  const evidenceChecks = truthFixture.contract.claimBoundary.claimPacketEvidence;

  return {
    kind: "aios.integration.claimExportEnvelope",
    provider: runtimeEnvelope.provider,
    packageRef: runtimeEnvelope.packageRef,
    exportStatus: "ready_for_operator_preview",
    resumeGuard: {
      required: true,
      evidenceChecks: evidenceChecks.map((entry) => entry.check),
      failureStatus: runtimeEnvelope.recovery.statusOnVerifierFailure
    },
    exportedClaims: truthFixture.expected.allowedClaims.map((claim) => ({
      claim,
      source: truthFixture.contract.declaredFacts.find((fact) => fact.claim === claim)?.source || "unknown",
      authority: truthFixture.contract.declaredFacts.find((fact) => fact.claim === claim)?.authority || "unknown"
    })),
    suppressedClaims: truthFixture.expected.blockedClaims.map((claim) => ({
      claim,
      reason: truthFixture.contract.blockedFacts.find((fact) => fact.claim === claim)?.reason || "blocked by truth boundary"
    }))
  };
}

function validateHarness(harness) {
  const issues = collectIssues(harness.fixtures);
  const runtime = harness.runtimeEnvelope;
  const claimExport = harness.claimExportEnvelope;
  const packageClaims = new Set(harness.fixtures.package.contract.verifier.claims);
  const truthClaims = new Set(harness.fixtures.truth.expected.allowedClaims);
  const truthEvidenceChecks = new Set(harness.fixtures.truth.expected.requiredEvidenceChecks);
  const missingTruthClaims = [...packageClaims].filter((claim) => !truthClaims.has(claim) && !truthEvidenceChecks.has(claim));
  const missingEvidence = claimExport.resumeGuard.evidenceChecks.filter((check) => !harness.fixtures.truth.expected.requiredEvidenceChecks.includes(check));

  if (runtime.provider !== "mailchimp") issues.push(issue("mailchimp.harness.provider_mismatch", "error", "runtimeEnvelope.provider", "Harness must target Mailchimp."));
  if (runtime.recovery.retryCommand !== "repair_descriptor") issues.push(issue("mailchimp.harness.retry_command_drift", "error", "runtimeEnvelope.recovery", "Runtime recovery must hand off descriptor repair."));
  if (runtime.recovery.blocksResumeWithoutVerifier !== true) issues.push(issue("mailchimp.harness.resume_guard_missing", "error", "runtimeEnvelope.recovery", "Runtime resume must be blocked until verifier evidence exists."));
  if (runtime.recovery.statusOnVerifierFailure !== "operator_review_required") issues.push(issue("mailchimp.harness.failure_status_drift", "error", "runtimeEnvelope.recovery", "Verifier failure must route to operator review."));
  if (missingTruthClaims.length) issues.push(issue("mailchimp.harness.truth_claim_gap", "error", "truth.allowedClaims", `Package verifier claims missing from truth boundary: ${missingTruthClaims.join(",")}.`));
  if (missingEvidence.length) issues.push(issue("mailchimp.harness.evidence_gap", "error", "claimExport.resumeGuard", `Resume guard references unknown checks: ${missingEvidence.join(",")}.`));

  return {
    ok: issues.every((entry) => entry.severity !== "error"),
    issueCodes: uniqueSorted(issues.map((entry) => entry.code)),
    issues,
    summary: {
      packageRef: runtime.packageRef,
      jobId: runtime.jobId,
      retryCommand: runtime.recovery.retryCommand,
      recoveryState: runtime.statusHandoff.recoveryState,
      exportedClaims: claimExport.exportedClaims.map((entry) => entry.claim).sort(),
      suppressedClaims: claimExport.suppressedClaims.map((entry) => entry.claim).sort()
    }
  };
}

export function buildMailchimpIntegrationHarness(options = {}) {
  const fixtures = {
    package: buildMailchimpPackageFixture(options.packageSource),
    operator: buildMailchimpOperatorFixture(options.operatorSource),
    truth: buildMailchimpTruthBoundaryFixture(options.truthSource)
  };
  const runtimeEnvelope = buildRuntimeEnvelope(fixtures.package, fixtures.operator, fixtures.truth);
  const claimExportEnvelope = buildClaimExportEnvelope(runtimeEnvelope, fixtures.truth);
  const harness = {
    kind: "aios.testing.mailchimpIntegrationHarness",
    protocol: HARNESS_PROTOCOL,
    provider: "mailchimp",
    fixtures,
    runtimeEnvelope,
    claimExportEnvelope
  };
  const validation = validateHarness(harness);

  return {
    ...harness,
    validation,
    expected: validation.summary
  };
}

export function selfCheckMailchimpIntegrationHarness() {
  const harness = buildMailchimpIntegrationHarness();

  return {
    protocol: `${HARNESS_PROTOCOL}.self-check`,
    ok: harness.validation.ok,
    issueCodes: harness.validation.issueCodes,
    packageRef: harness.expected.packageRef,
    jobId: harness.expected.jobId,
    retryCommand: harness.expected.retryCommand,
    exportedClaims: harness.expected.exportedClaims,
    suppressedClaims: harness.expected.suppressedClaims
  };
}

export const MAILCHIMP_INTEGRATION_HARNESS_PROTOCOL = HARNESS_PROTOCOL;
