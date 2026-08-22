const FIXTURE_PROTOCOL = "aios.testing.mailchimp-package-fixture.v1";

export const MAILCHIMP_PACKAGE_FIXTURE_SOURCE = Object.freeze({
  packageId: "pkg.mailchimp.campaign-ops",
  version: "2026.07.03",
  provider: "mailchimp",
  runtime: "aios-mailchimp-runtime",
  entrypoint: "jobs/campaign-draft.aios",
  jobs: [
    {
      id: "job.mailchimp.campaign-draft",
      action: "campaign.draft",
      adapter: "mailchimp",
      statusHandoff: "operator-preview",
      recovery: "retry-with-idempotency-key"
    }
  ],
  capabilities: [
    { name: "mailchimp.campaigns", mode: "local-draft", externalWrite: false },
    { name: "mailchimp.audiences", mode: "read", externalWrite: false },
    { name: "status:timeline.write", mode: "local-status", externalWrite: false }
  ],
  memory: [
    { name: "campaignDraft", mode: "readwrite", path: "memory://mailchimp/campaign-draft" },
    { name: "audienceSnapshot", mode: "readonly", path: "memory://mailchimp/audience-snapshot" },
    { name: "verifierEvidence", mode: "append", path: "memory://mailchimp/verifier-evidence" }
  ],
  verifierClaims: [
    "campaignDraft.subject.exists",
    "audienceSnapshot.segment.resolved",
    "adapter.recovery.status_handoff"
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

function normalizePackageSource(source) {
  return {
    ...source,
    packageId: compact(source.packageId),
    version: compact(source.version),
    provider: compact(source.provider || "mailchimp"),
    runtime: compact(source.runtime || "aios-mailchimp-runtime"),
    entrypoint: compact(source.entrypoint),
    jobs: Array.isArray(source.jobs) ? source.jobs : [],
    capabilities: Array.isArray(source.capabilities) ? source.capabilities : [],
    memory: Array.isArray(source.memory) ? source.memory : [],
    verifierClaims: Array.isArray(source.verifierClaims) ? source.verifierClaims : []
  };
}

function buildKernelContracts(source) {
  return source.jobs.map((job, index) => ({
    id: compact(job.id || `job.mailchimp.${index + 1}`),
    provider: source.provider,
    adapter: compact(job.adapter || source.provider),
    action: compact(job.action),
    packageRef: `${source.packageId}@${source.version}`,
    statusHandoff: compact(job.statusHandoff || "operator-preview"),
    recovery: {
      mode: compact(job.recovery || "retry-with-idempotency-key"),
      requiresVerifierEvidence: true,
      terminalOnAdapterFailure: false
    }
  }));
}

function buildCapabilityContracts(source) {
  return source.capabilities.map((capability) => ({
    name: compact(capability.name),
    mode: compact(capability.mode || "read"),
    provider: source.provider,
    externalWrite: capability.externalWrite === true,
    runtimeEnablement: capability.externalWrite ? "operator-approved" : "local-only",
    statusHandoffRequired: capability.externalWrite === true
  }));
}

function buildMemoryContracts(source) {
  return source.memory.map((mount) => ({
    name: compact(mount.name),
    mode: compact(mount.mode || "readonly"),
    path: compact(mount.path),
    provider: source.provider,
    persisted: true,
    recoveryRole: mount.name === "verifierEvidence" ? "resume-gate" : "runtime-state"
  }));
}

function validatePackageContract(contract) {
  const issues = [];
  const jobIds = uniqueSorted(contract.kernelJobs.map((job) => job.id));
  const capabilityNames = uniqueSorted(contract.capabilities.map((capability) => capability.name));
  const memoryNames = uniqueSorted(contract.memory.map((mount) => mount.name));
  const verifierClaims = uniqueSorted(contract.verifier.claims);

  if (!contract.packageId) issues.push(issue("mailchimp.package.missing_id", "error", "packageId", "Package id is required."));
  if (contract.provider !== "mailchimp") issues.push(issue("mailchimp.package.provider_mismatch", "error", "provider", "Package must target Mailchimp."));
  if (!jobIds.length) issues.push(issue("mailchimp.package.missing_jobs", "error", "jobs", "At least one kernel job is required."));
  if (!capabilityNames.includes("mailchimp.campaigns")) issues.push(issue("mailchimp.package.missing_campaign_capability", "error", "capabilities", "Mailchimp campaign capability is required."));
  if (!memoryNames.includes("campaignDraft")) issues.push(issue("mailchimp.package.missing_campaign_memory", "error", "memory", "Campaign draft memory mount is required."));
  if (!verifierClaims.includes("adapter.recovery.status_handoff")) issues.push(issue("mailchimp.package.missing_recovery_claim", "error", "verifierClaims", "Recovery/status handoff claim is required."));

  return {
    ok: issues.every((entry) => entry.severity !== "error"),
    issues,
    summary: {
      jobs: jobIds,
      capabilities: capabilityNames,
      memory: memoryNames,
      verifierClaims
    }
  };
}

export function buildMailchimpPackageFixture(source = MAILCHIMP_PACKAGE_FIXTURE_SOURCE) {
  const normalized = normalizePackageSource(source);
  const contract = {
    kind: "aios.packageContract",
    protocol: FIXTURE_PROTOCOL,
    packageId: normalized.packageId,
    version: normalized.version,
    provider: normalized.provider,
    runtime: normalized.runtime,
    entrypoint: normalized.entrypoint,
    kernelJobs: buildKernelContracts(normalized),
    capabilities: buildCapabilityContracts(normalized),
    memory: buildMemoryContracts(normalized),
    verifier: {
      required: true,
      claims: uniqueSorted(normalized.verifierClaims),
      blocksAdapterResume: true
    },
    adapterRecovery: {
      statusHandoff: "operator-preview",
      retrySemantics: "idempotent-replay",
      persistedState: "campaignDraft"
    }
  };
  const validation = validatePackageContract(contract);

  return {
    kind: "aios.testing.mailchimpPackageFixture",
    protocol: FIXTURE_PROTOCOL,
    source: normalized,
    contract,
    validation,
    expected: {
      packageRef: `${contract.packageId}@${contract.version}`,
      runtime: contract.runtime,
      provider: contract.provider,
      statusHandoff: contract.adapterRecovery.statusHandoff,
      resumeBlockedByVerifier: contract.verifier.blocksAdapterResume,
      externalWriteCapabilities: contract.capabilities.filter((capability) => capability.externalWrite).map((capability) => capability.name)
    }
  };
}

export function assertMailchimpPackageFixture(fixture = buildMailchimpPackageFixture()) {
  return {
    ok: fixture.validation.ok
      && fixture.contract.kind === "aios.packageContract"
      && fixture.expected.provider === "mailchimp"
      && fixture.expected.resumeBlockedByVerifier === true
      && fixture.expected.externalWriteCapabilities.length === 0,
    issueCodes: fixture.validation.issues.map((entry) => entry.code),
    packageRef: fixture.expected.packageRef,
    statusHandoff: fixture.expected.statusHandoff,
    summary: fixture.validation.summary
  };
}

export const MAILCHIMP_PACKAGE_FIXTURE_PROTOCOL = FIXTURE_PROTOCOL;
