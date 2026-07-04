const DEFAULT_VERIFIER_POLICY = Object.freeze({
  maxUnverifiedClaims: 0,
  requireEvidenceForExternalClaims: true,
  requireCapabilityForExternalEffects: true,
  allowRecoveredStatus: true,
});

const CONTRACT_TYPES = Object.freeze([
  "kernelJob",
  "capability",
  "memory",
  "verifier",
  "claim",
]);

const RECOVERABLE_STATUSES = new Set(["degraded", "recovering", "blocked"]);
const TERMINAL_STATUSES = new Set(["ready", "blocked", "failed"]);

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
};

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const stableId = (prefix, value) => {
  let hash = 2166136261;
  const input = stableStringify(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
};

const normalizeText = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const normalizeList = (values) =>
  [...new Set(toArray(values).map((value) => normalizeText(value)).filter(Boolean))].sort();

const normalizeStatus = (status) => {
  const normalized = normalizeText(status, "draft").toLowerCase();
  if (["draft", "ready", "degraded", "recovering", "blocked", "failed"].includes(normalized)) {
    return normalized;
  }
  return "degraded";
};

const normalizeClaim = (claim, index = 0) => {
  const normalized = typeof claim === "string" ? { statement: claim } : { ...claim };
  const statement = normalizeText(normalized.statement || normalized.text, `claim ${index + 1}`);
  const evidence = normalizeList(normalized.evidence || normalized.sources);
  const boundary = normalizeText(normalized.boundary || normalized.scope, "runtime");
  const confidence = Number.isFinite(normalized.confidence)
    ? Math.max(0, Math.min(1, normalized.confidence))
    : evidence.length > 0
      ? 1
      : 0;

  return {
    id: normalizeText(normalized.id, stableId("claim", { boundary, evidence, statement })),
    statement,
    boundary,
    evidence,
    confidence,
    verified: evidence.length > 0 && confidence > 0,
  };
};

const normalizeCapability = (capability, index = 0) => {
  const normalized = typeof capability === "string" ? { name: capability } : { ...capability };
  const name = normalizeText(normalized.name || normalized.id, `capability_${index + 1}`);
  const effects = normalizeList(normalized.effects || normalized.effect || normalized.permissions);
  const recovery = normalizeText(normalized.recovery || normalized.recoveryMode, "status-handoff");

  return {
    id: normalizeText(normalized.id, stableId("capability", { effects, name, recovery })),
    name,
    effects,
    recovery,
    required: normalized.required !== false,
  };
};

const normalizeMemoryBinding = (binding, index = 0) => {
  const normalized = typeof binding === "string" ? { key: binding } : { ...binding };
  const key = normalizeText(normalized.key || normalized.name, `memory_${index + 1}`);
  const mode = normalizeText(normalized.mode || normalized.access, "read").toLowerCase();
  const retention = normalizeText(normalized.retention || normalized.ttl, "session");

  return {
    id: normalizeText(normalized.id, stableId("memory", { key, mode, retention })),
    key,
    mode: ["read", "write", "append", "ephemeral"].includes(mode) ? mode : "read",
    retention,
    required: normalized.required !== false,
  };
};

const normalizeKernelJob = (source) => {
  const job = source.kernelJob || source.job || {};
  const objective = normalizeText(job.objective || source.objective || source.intent, "truth boundary evaluation");
  const route = normalizeList(job.route || source.route);
  const status = normalizeStatus(job.status || source.status);

  return {
    id: normalizeText(job.id, stableId("kernel_job", { objective, route })),
    objective,
    route,
    status,
    adapter: normalizeText(job.adapter || source.adapter, "truth-boundaries"),
  };
};

const normalizeVerifierPolicy = (policy = {}) => ({
  ...DEFAULT_VERIFIER_POLICY,
  ...policy,
  maxUnverifiedClaims: Number.isInteger(policy.maxUnverifiedClaims)
    ? Math.max(0, policy.maxUnverifiedClaims)
    : DEFAULT_VERIFIER_POLICY.maxUnverifiedClaims,
});

const buildClaimDiagnostics = (claims, policy) => {
  const unverifiedClaims = claims.filter((claim) => !claim.verified);
  const diagnostics = [];

  if (unverifiedClaims.length > policy.maxUnverifiedClaims) {
    diagnostics.push({
      code: "truth.unverified_claim_limit",
      severity: "error",
      message: `unverified claim count ${unverifiedClaims.length} exceeds limit ${policy.maxUnverifiedClaims}`,
      claimIds: unverifiedClaims.map((claim) => claim.id),
    });
  }

  if (policy.requireEvidenceForExternalClaims) {
    const externalWithoutEvidence = claims.filter(
      (claim) => claim.boundary === "external" && claim.evidence.length === 0,
    );
    if (externalWithoutEvidence.length > 0) {
      diagnostics.push({
        code: "truth.external_claim_without_evidence",
        severity: "error",
        message: "external claims require evidence before verifier handoff",
        claimIds: externalWithoutEvidence.map((claim) => claim.id),
      });
    }
  }

  return diagnostics;
};

const buildCapabilityDiagnostics = (capabilities, policy) => {
  if (!policy.requireCapabilityForExternalEffects) return [];
  const externalEffects = capabilities.filter((capability) => capability.effects.includes("external"));
  if (externalEffects.length > 0) return [];
  return [
    {
      code: "truth.external_effect_capability_missing",
      severity: "warning",
      message: "no capability declares an external effect boundary",
      capabilityIds: [],
    },
  ];
};

const statusFromDiagnostics = (requestedStatus, diagnostics) => {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return requestedStatus === "failed" ? "failed" : "blocked";
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    return requestedStatus === "ready" ? "degraded" : requestedStatus;
  }
  return requestedStatus === "draft" ? "ready" : requestedStatus;
};

const buildRecoveryHandoff = ({ kernelJob, capabilities, diagnostics, requestedStatus }) => {
  const status = statusFromDiagnostics(requestedStatus, diagnostics);
  const recoveryCapabilities = capabilities
    .filter((capability) => capability.required && capability.recovery)
    .map((capability) => ({
      capabilityId: capability.id,
      recovery: capability.recovery,
    }));

  return {
    adapter: kernelJob.adapter,
    fromStatus: requestedStatus,
    status,
    terminal: TERMINAL_STATUSES.has(status),
    recoverable: RECOVERABLE_STATUSES.has(status),
    recoveryCapabilities,
    diagnostics: diagnostics.map((diagnostic) => diagnostic.code),
  };
};

export const compileTruthBoundaryContracts = (source = {}, options = {}) => {
  const policy = normalizeVerifierPolicy(options.verifierPolicy || source.verifierPolicy);
  const kernelJob = normalizeKernelJob(source);
  const claims = toArray(source.claims).map((claim, index) => normalizeClaim(claim, index));
  const capabilities = toArray(source.capabilities).map((capability, index) =>
    normalizeCapability(capability, index),
  );
  const memory = toArray(source.memory || source.memoryBindings).map((binding, index) =>
    normalizeMemoryBinding(binding, index),
  );
  const claimDiagnostics = buildClaimDiagnostics(claims, policy);
  const capabilityDiagnostics = buildCapabilityDiagnostics(capabilities, policy);
  const diagnostics = [...claimDiagnostics, ...capabilityDiagnostics].sort((left, right) =>
    left.code.localeCompare(right.code),
  );
  const recovery = buildRecoveryHandoff({
    kernelJob,
    capabilities,
    diagnostics,
    requestedStatus: kernelJob.status,
  });

  return {
    schema: "aios.truth-boundaries.contracts.v1",
    contractTypes: CONTRACT_TYPES,
    kernelJob: {
      ...kernelJob,
      status: recovery.status,
    },
    capabilities,
    memory,
    verifier: {
      id: stableId("verifier", { claims, policy }),
      policy,
      diagnostics,
      accepted: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    },
    claims,
    recovery,
    checksum: stableId("truth_contracts", {
      capabilities,
      claims,
      diagnostics,
      kernelJob,
      memory,
      policy,
      recovery,
    }),
  };
};

export const validateTruthBoundaryContracts = (contracts = {}) => {
  const diagnostics = [];
  const requiredArrays = ["capabilities", "memory", "claims"];

  for (const key of requiredArrays) {
    if (!Array.isArray(contracts[key])) {
      diagnostics.push({
        code: `truth.contract.${key}_not_array`,
        severity: "error",
        message: `${key} must be an array`,
      });
    }
  }

  if (!contracts.kernelJob || typeof contracts.kernelJob !== "object") {
    diagnostics.push({
      code: "truth.contract.kernel_job_missing",
      severity: "error",
      message: "kernelJob contract is required",
    });
  }

  if (!contracts.verifier || contracts.verifier.accepted !== true) {
    diagnostics.push({
      code: "truth.contract.verifier_not_accepted",
      severity: "error",
      message: "verifier must accept the contract before runtime handoff",
    });
  }

  if (!contracts.recovery || typeof contracts.recovery.status !== "string") {
    diagnostics.push({
      code: "truth.contract.recovery_status_missing",
      severity: "error",
      message: "recovery status handoff is required",
    });
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
  };
};

export const createTruthBoundaryStatusHandoff = (source = {}, options = {}) => {
  const contracts = compileTruthBoundaryContracts(source, options);
  const validation = validateTruthBoundaryContracts(contracts);

  return {
    ok: validation.ok,
    status: contracts.recovery.status,
    adapter: contracts.recovery.adapter,
    recoverable: contracts.recovery.recoverable,
    terminal: contracts.recovery.terminal,
    checksum: contracts.checksum,
    diagnostics: [...contracts.verifier.diagnostics, ...validation.diagnostics],
  };
};

export const selfCheckTruthBoundariesGuide = () => {
  const sample = compileTruthBoundaryContracts({
    objective: "publish supported claim with explicit tool boundary",
    route: ["kernel", "verifier"],
    status: "draft",
    claims: [
      {
        statement: "adapter handoff preserves status",
        boundary: "external",
        evidence: ["contract.fixture"],
      },
    ],
    capabilities: [
      {
        name: "mailchimp-adapter-status",
        effects: ["external", "status"],
      },
    ],
    memory: [
      {
        key: "truth.boundary.last_handoff",
        mode: "write",
      },
    ],
  });
  const validation = validateTruthBoundaryContracts(sample);

  return {
    ok: validation.ok && sample.kernelJob.status === "ready" && sample.verifier.accepted,
    checksum: sample.checksum,
    diagnostics: validation.diagnostics,
  };
};

export default Object.freeze({
  compileTruthBoundaryContracts,
  createTruthBoundaryStatusHandoff,
  selfCheckTruthBoundariesGuide,
  validateTruthBoundaryContracts,
});
