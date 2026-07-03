export const surfaceId = "aios_artifact-filesystem_path-policy_039";
export const surfaceGroup = "artifact-filesystem";
export const surfaceName = "path-policy";

const DEFAULT_ARTIFACT_ROOT = "/artifacts";
const DEFAULT_QUARANTINE_FOLDER = ".quarantine/path-policy";
const FALLBACK_QUARANTINE_FOLDER = ".quarantine/path-policy/fallback";
const DEFAULT_DENIED_SEGMENTS = new Set(["", ".", "..", ".git", "node_modules"]);
const PERSISTED_STATE_VERSION = "2026-07-01.path-policy-state.v1";
const KERNEL_REQUIRED_CAPABILITIES = [
  "artifact.read",
  "artifact.write",
  "artifact.syncMetadata",
  "artifact.externalHandoff"
];
const ROLE_PERMISSION_GRANTS = {
  reader: ["artifact.read"],
  contributor: ["artifact.read", "artifact.write"],
  maintainer: ["artifact.read", "artifact.write", "artifact.syncMetadata", "artifact.externalHandoff"],
  owner: KERNEL_REQUIRED_CAPABILITIES,
  auditor: ["artifact.read", "artifact.syncMetadata"]
};
const ACCESS_PERMISSION = {
  read: "artifact.read",
  write: "artifact.write",
  sync: "artifact.syncMetadata"
};
const CROSS_WORKSPACE_READ_PERMISSION = "artifact.syncMetadata";
const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  initialDelayMs: 250,
  maxDelayMs: 5000,
  multiplier: 2
};
const DEFAULT_COMMAND_RECOVERY_POLICY = {
  preparedTtlMs: 15 * 60 * 1000,
  maxRecoveryAttempts: 3,
  quarantineRetainedCommands: 10
};
const DEFAULT_DEPENDENCY_POLICY = {
  staleAfterMs: 120000,
  maxLatencyMs: 2500,
  required: ["metadataStore", "commandJournal", "artifactProvider"],
  degradable: ["policyCache", "syncMetadata"]
};
const DEFAULT_LIFECYCLE_SETTINGS = {
  enabled: true,
  commandsEnabled: true,
  scheduleEnabled: false,
  scheduleIntervalMinutes: 60,
  timezone: "UTC"
};
const SERVICE_OPERATION_CONTRACTS = {
  read: {
    capability: "artifact.read",
    command: "artifact.open",
    route: "hosted-kernel.artifact.read"
  },
  write: {
    capability: "artifact.write",
    command: "artifact.commit",
    route: "hosted-kernel.artifact.write"
  },
  sync: {
    capability: "artifact.syncMetadata",
    command: "artifact.metadata.sync",
    route: "hosted-kernel.artifact.sync-metadata"
  },
  externalHandoff: {
    capability: "artifact.externalHandoff",
    command: "artifact.external-handoff.issue",
    route: "hosted-kernel.artifact.external-handoff"
  }
};
const SERVICE_ENDPOINT_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const SERVICE_ACK_MODES = new Set(["kernel-ack", "provider-ack", "fire-and-forget"]);
const SERVICE_HANDOFF_DELIVERY_MODES = new Set(["inline-token", "signed-url", "provider-ticket"]);
const DEFAULT_PROVIDER_ACCEPTED_MEDIA_TYPES = ["application/octet-stream", "text/plain", "application/json"];
const LIFECYCLE_COMMANDS = new Set([
  "evaluate-policy",
  "enable",
  "disable",
  "pause",
  "resume",
  "schedule",
  "run-now"
]);
const LIFECYCLE_COMMAND_ALIASES = {
  evaluate: "evaluate-policy",
  validate: "evaluate-policy",
  status: "evaluate-policy",
  start: "enable",
  on: "enable",
  stop: "disable",
  off: "disable",
  suspend: "pause",
  unsuspend: "resume",
  "schedule-run": "schedule",
  "run": "run-now",
  runNow: "run-now",
  runnow: "run-now",
  execute: "run-now"
};

function toIsoTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizePath(value, fallback = DEFAULT_ARTIFACT_ROOT) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const withoutProtocol = raw.replace(/^file:\/\//, "");
  const collapsed = withoutProtocol.replace(/\\/g, "/").replace(/\/+/g, "/");
  return collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
}

function pathSegments(pathname) {
  return normalizePath(pathname).split("/").filter(Boolean);
}

function lastPathSegment(pathname, fallback = "artifact") {
  return pathSegments(pathname).at(-1) || fallback;
}

function startsWithPath(pathname, prefix) {
  const normalizedPath = normalizePath(pathname);
  const normalizedPrefix = normalizePath(prefix);
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

function repoRelativeProofReference(pathname, artifactRoot) {
  return repoRelativeProofReferenceDetails(pathname, artifactRoot).reference;
}

function sanitizeProofReferenceSegment(value, fallback = "segment") {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const normalized = candidate
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[\u0000-\u001f\u007f]/gu, "-")
    .replace(/[%/\\:]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safe = normalized && normalized !== "." && normalized !== ".." ? normalized : fallback;
  const visible = safe.startsWith(".") ? `artifact${safe}` : safe;
  return visible.slice(0, 96) || fallback;
}

function buildSafeProofSegments(segments, fallback = "artifact") {
  const sanitized = segments
    .map((segment, index) => sanitizeProofReferenceSegment(segment, index === 0 ? fallback : "segment"))
    .filter(Boolean);

  return sanitized.length ? sanitized : [sanitizeProofReferenceSegment(fallback)];
}

function repoRelativeProofReferenceDetails(pathname, artifactRoot) {
  const normalizedPath = normalizePath(pathname);
  const normalizedRoot = normalizePath(artifactRoot);
  const rootName = sanitizeProofReferenceSegment(lastPathSegment(normalizedRoot, "artifacts"), "artifacts");
  const normalizedSegments = pathSegments(normalizedPath);
  const normalizedRootSegments = pathSegments(normalizedRoot);

  if (startsWithPath(normalizedPath, normalizedRoot)) {
    const relativeSegments = normalizedSegments.slice(normalizedRootSegments.length);
    const safeRelativeSegments = relativeSegments.length ? buildSafeProofSegments(relativeSegments, "artifact") : [];
    const safeSegments = [rootName, ...safeRelativeSegments];
    const reference = safeSegments.join("/");

    return {
      schema: "hosted-kernel-artifact-path-policy.repo-proof-reference.v1",
      reference,
      scope: "artifact-root",
      absolutePathExposed: false,
      rootName,
      hash: lightweightHash({ normalizedPath, normalizedRoot }),
      segmentCount: safeSegments.length,
      sanitizedSegments: safeSegments,
      sourceHadUnsafeSegments: stableJson(safeSegments) !== stableJson([rootName, ...relativeSegments]),
      redaction: {
        mode: "repo-relative",
        reason: "inside-artifact-root"
      }
    };
  }

  const pathHash = lightweightHash({ path: normalizedPath });
  const safeLeaf = sanitizeProofReferenceSegment(lastPathSegment(normalizedPath), "artifact");
  const safeSegments = ["external", pathHash, safeLeaf];

  return {
    schema: "hosted-kernel-artifact-path-policy.repo-proof-reference.v1",
    reference: safeSegments.join("/"),
    scope: "external-redacted",
    absolutePathExposed: false,
    rootName,
    hash: pathHash,
    segmentCount: safeSegments.length,
    sanitizedSegments: safeSegments,
    sourceHadUnsafeSegments: true,
    redaction: {
      mode: "hash-and-safe-leaf",
      reason: "outside-artifact-root"
    }
  };
}

function sanitizeQuarantineLeaf(value) {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : "artifact";
  const leaf = candidate
    .replace(/[%/\\:]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!leaf || leaf === "." || leaf === "..") return "artifact";
  return leaf.startsWith(".") ? `artifact${leaf}` : leaf;
}

function normalizePayloadMediaType(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const mediaType = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*(?:\s*;\s*[a-z0-9._-]+=[^;\s]+)*$/i.test(mediaType)
    ? mediaType
    : null;
}

function normalizePayloadDigest(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const digest = value.trim();
  const algorithmMatch = digest.match(/^([a-z0-9][a-z0-9-]{1,31}):([a-f0-9]{32,128})$/i);
  if (algorithmMatch) {
    return {
      value: `${algorithmMatch[1].toLowerCase()}:${algorithmMatch[2].toLowerCase()}`,
      algorithm: algorithmMatch[1].toLowerCase(),
      format: "algorithm-prefixed",
      valid: true
    };
  }

  const bareHex = digest.match(/^[a-f0-9]{64}$/i);
  if (bareHex) {
    return {
      value: digest.toLowerCase(),
      algorithm: "sha256",
      format: "sha256-hex",
      valid: true
    };
  }

  return {
    value: digest,
    algorithm: null,
    format: "unrecognized",
    valid: false
  };
}

function buildPayloadIntegrityProof(explicitPayload) {
  const declared = Boolean(explicitPayload);
  const digest = explicitPayload
    ? normalizePayloadDigest(explicitPayload.contentHash)
    : null;
  const byteLength = explicitPayload && Number.isInteger(explicitPayload.byteLength) && explicitPayload.byteLength >= 0
    ? explicitPayload.byteLength
    : null;
  const mediaType = explicitPayload ? normalizePayloadMediaType(explicitPayload.mediaType) : null;
  const violations = declared
    ? [
        ...(!digest ? ["write_payload_missing_content_hash"] : []),
        ...(digest && !digest.valid ? ["write_payload_invalid_content_hash"] : []),
        ...(byteLength === null ? ["write_payload_missing_byte_length"] : []),
        ...(byteLength === 0 ? ["write_payload_empty"] : []),
        ...(!mediaType ? ["write_payload_missing_media_type"] : [])
      ]
    : [];

  return {
    declared,
    contentHash: digest ? digest.value : null,
    hashAlgorithm: digest ? digest.algorithm : null,
    hashFormat: digest ? digest.format : null,
    byteLength,
    mediaType,
    integrityState: !declared
      ? "not-declared"
      : violations.length
        ? "invalid"
        : "verified-declaration",
    violations
  };
}

function containsEncodedTraversalOrSeparator(rawPath) {
  if (typeof rawPath !== "string") return false;

  try {
    const decoded = decodeURIComponent(rawPath);
    const decodedSegments = decoded.replace(/\\/g, "/").split("/");
    return decodedSegments.some((segment) => segment === ".." || segment === ".")
      || /%2f|%5c/i.test(rawPath);
  } catch {
    return true;
  }
}

function buildPathEvidence({ rawPath, normalizedPath, artifactRoot, tenantScope, deniedSegments, readOnlyPrefixes }) {
  const suppliedPath = typeof rawPath === "string" && rawPath.trim();
  const requestedRawPath = suppliedPath ? rawPath.trim() : artifactRoot;
  const normalizedSegments = pathSegments(normalizedPath);
  const denied = normalizedSegments.filter((segment) => deniedSegments.has(segment));
  const encodedTraversal = containsEncodedTraversalOrSeparator(requestedRawPath);
  const controlCharacter = /[\u0000-\u001f\u007f]/u.test(requestedRawPath);
  const driveLetterSegment = normalizedSegments.find((segment) => /^[a-zA-Z]:$/.test(segment)) || null;
  const rewritten = requestedRawPath !== normalizedPath;
  const rootRelativeSegments = startsWithPath(normalizedPath, artifactRoot)
    ? normalizedSegments.slice(pathSegments(artifactRoot).length)
    : [];
  const workspaceRelativeSegments = startsWithPath(normalizedPath, tenantScope.workspaceRoot)
    ? normalizedSegments.slice(pathSegments(tenantScope.workspaceRoot).length)
    : [];
  const nearestAllowedReadPrefix = tenantScope.allowedReadPrefixes.find((prefix) => startsWithPath(normalizedPath, prefix)) || null;
  const nearestAllowedWritePrefix = tenantScope.allowedWritePrefixes.find((prefix) => startsWithPath(normalizedPath, prefix)) || null;
  const nearestReadOnlyPrefix = readOnlyPrefixes.find((prefix) => startsWithPath(normalizedPath, prefix)) || null;
  const requestedProofReference = repoRelativeProofReferenceDetails(normalizedPath, artifactRoot);
  const workspaceProofReference = nearestAllowedReadPrefix
    ? repoRelativeProofReferenceDetails(nearestAllowedReadPrefix, artifactRoot)
    : null;
  const blockingViolations = [
    ...(controlCharacter ? ["path_control_character"] : []),
    ...(driveLetterSegment ? [`path_drive_letter_segment:${driveLetterSegment}`] : []),
    ...(encodedTraversal ? ["path_encoded_traversal_or_separator"] : [])
  ];

  return {
    schema: "hosted-kernel-artifact-path-policy.path-evidence.v1",
    supplied: Boolean(suppliedPath),
    rawPath: requestedRawPath,
    normalizedPath,
    rewritten,
    segmentCount: normalizedSegments.length,
    normalizedSegments,
    rootRelativeSegments,
    workspaceRelativeSegments,
    leafName: lastPathSegment(normalizedPath),
    proofReferences: {
      requested: requestedProofReference.reference,
      workspace: workspaceProofReference ? workspaceProofReference.reference : null,
      requestedDetails: requestedProofReference,
      workspaceDetails: workspaceProofReference,
      absolutePathExposed: false
    },
    containment: {
      insideArtifactRoot: startsWithPath(normalizedPath, artifactRoot),
      insideTenantRoot: startsWithPath(normalizedPath, tenantScope.tenantRoot),
      insideWorkspaceRoot: startsWithPath(normalizedPath, tenantScope.workspaceRoot),
      nearestAllowedReadPrefix,
      nearestAllowedWritePrefix,
      nearestReadOnlyPrefix
    },
    risk: {
      deniedSegments: denied,
      encodedTraversalOrSeparator: encodedTraversal,
      controlCharacter,
      driveLetterSegment,
      normalizedByPolicy: rewritten,
      blockingViolations
    },
    proof: {
      evidenceKey: `${surfaceId}:path-evidence:${lightweightHash({
        rawPath: requestedRawPath,
        normalizedPath,
        tenantId: tenantScope.tenantId,
        workspaceId: tenantScope.workspaceId,
        denied,
        encodedTraversal,
        controlCharacter,
        driveLetterSegment
      })}`,
      generatedBy: surfaceId
    }
  };
}

function buildArtifactWritePolicy({ input, generatedAt, decision, artifactRoot, deniedSegments }) {
  const writeLike = decision.access === "write" || decision.access === "sync";
  const rawPath = typeof input.path === "string" ? input.path : decision.path;
  const normalizedPath = decision.path;
  const segments = pathSegments(normalizedPath);
  const deniedWriteSegment = segments.find((segment) => deniedSegments.has(segment));
  const directoryLike = typeof rawPath === "string" && /[/\\]\s*$/.test(rawPath);
  const controlCharacter = typeof rawPath === "string" && /[\u0000-\u001f\u007f]/u.test(rawPath);
  const driveLetterSegment = segments.some((segment) => /^[a-zA-Z]:$/.test(segment));
  const encodedTraversal = containsEncodedTraversalOrSeparator(rawPath);
  const explicitPayload = input.artifact && typeof input.artifact === "object"
    ? input.artifact
    : input.writeArtifact && typeof input.writeArtifact === "object"
      ? input.writeArtifact
      : null;
  const contentHash = explicitPayload && typeof explicitPayload.contentHash === "string" && explicitPayload.contentHash.trim()
    ? explicitPayload.contentHash.trim()
    : null;
  const payloadProof = buildPayloadIntegrityProof(explicitPayload);
  const violations = writeLike
    ? [
        ...(!decision.workspace.writable ? ["write_target_outside_workspace"] : []),
        ...(decision.readOnly ? ["write_target_readonly"] : []),
        ...(deniedWriteSegment ? [`write_target_denied_segment:${deniedWriteSegment}`] : []),
        ...(directoryLike ? ["write_target_directory_like"] : []),
        ...(controlCharacter ? ["write_target_control_character"] : []),
        ...(driveLetterSegment ? ["write_target_drive_letter_segment"] : []),
        ...(encodedTraversal ? ["write_target_encoded_traversal"] : []),
        ...payloadProof.violations
      ]
    : [];
  const destinationState = !writeLike
    ? "not-applicable"
    : decision.allow && violations.length === 0
      ? "safe-write"
      : "quarantine";
  const workspaceQuarantineAllowed = startsWithPath(decision.workspace.workspaceRoot, artifactRoot)
    && startsWithPath(decision.workspace.workspaceRoot, decision.workspace.tenantRoot)
    && !decision.tenantBoundary.violations.includes("tenant_root_outside_artifact_root")
    && !decision.tenantBoundary.violations.includes("workspace_root_outside_tenant_root");
  const quarantineRoot = workspaceQuarantineAllowed
    ? normalizePath(`${decision.workspace.workspaceRoot}/${DEFAULT_QUARANTINE_FOLDER}`)
    : normalizePath(`${artifactRoot}/${FALLBACK_QUARANTINE_FOLDER}/${sanitizeProofReferenceSegment(decision.workspace.tenantId, "tenant")}/${sanitizeProofReferenceSegment(decision.workspace.workspaceId, "workspace")}`);
  const quarantineReasonCodes = [
    ...violations,
    ...(!workspaceQuarantineAllowed && writeLike ? ["quarantine_workspace_boundary_fallback"] : [])
  ];
  const quarantinePath = normalizePath(`${quarantineRoot}/${lightweightHash({
    path: normalizedPath,
    access: decision.access,
    violations,
    quarantineRoot
  })}-${sanitizeQuarantineLeaf(lastPathSegment(normalizedPath))}`);
  const activePath = !writeLike || destinationState === "safe-write" ? normalizedPath : quarantinePath;
  const requestedProofReference = repoRelativeProofReferenceDetails(normalizedPath, artifactRoot);
  const activeProofReference = repoRelativeProofReferenceDetails(activePath, artifactRoot);
  const quarantineProofReference = writeLike && destinationState === "quarantine"
    ? repoRelativeProofReferenceDetails(quarantinePath, artifactRoot)
    : null;

  return {
    schema: "hosted-kernel-artifact-path-policy.artifact-write.v1",
    generatedAt,
    writeLike,
    destinationState,
    allowDirectWrite: destinationState === "safe-write",
    requestedPath: normalizedPath,
    activePath,
    quarantine: {
      required: writeLike && destinationState === "quarantine",
      path: writeLike && destinationState === "quarantine" ? quarantinePath : null,
      proofReference: writeLike && destinationState === "quarantine"
        ? quarantineProofReference.reference
        : null,
      proofReferenceDetails: quarantineProofReference,
      root: writeLike && destinationState === "quarantine" ? quarantineRoot : null,
      rootScope: workspaceQuarantineAllowed ? "workspace" : "artifact-root-fallback",
      workspaceQuarantineAllowed,
      reasonCodes: quarantineReasonCodes.length ? quarantineReasonCodes : decision.violations
    },
    proofReferences: {
      requested: requestedProofReference.reference,
      active: activeProofReference.reference,
      requestedDetails: requestedProofReference,
      activeDetails: activeProofReference,
      absolutePathExposed: false
    },
    payloadProof,
    validation: {
      status: !writeLike ? "not-applicable" : violations.length ? "blocked" : "passed",
      violations,
      checkedSegments: segments,
      leafName: lastPathSegment(normalizedPath),
      payloadIntegrity: payloadProof.integrityState
    },
    proof: {
      writePolicyKey: `${surfaceId}:artifact-write:${lightweightHash({
        path: normalizedPath,
        access: decision.access,
        activePath,
        destinationState,
        violations,
        contentHash
      })}`,
      generatedBy: surfaceId
    }
  };
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function lightweightHash(value) {
  let hash = 2166136261;
  const source = stableJson(value);

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function millisecondsBetween(olderValue, newerValue) {
  const older = new Date(olderValue).getTime();
  const newer = new Date(newerValue).getTime();
  if (Number.isNaN(older) || Number.isNaN(newer)) return null;
  return Math.max(0, newer - older);
}

function addMinutesIso(timestamp, minutes) {
  const base = new Date(timestamp).getTime();
  if (Number.isNaN(base)) return null;
  return new Date(base + minutes * 60000).toISOString();
}

function normalizeLifecycleBoolean(value, fallback) {
  if (value === true || value === false) return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (["true", "enabled", "enable", "on", "yes"].includes(normalized)) return true;
  if (["false", "disabled", "disable", "off", "no"].includes(normalized)) return false;
  return fallback;
}

function normalizeLifecycleCommand(input = {}) {
  const lifecycleInput = input.lifecycle && typeof input.lifecycle === "object" ? input.lifecycle : {};
  const commandInput = input.command && typeof input.command === "object" ? input.command : {};
  const candidates = [
    ["lifecycleCommand", input.lifecycleCommand],
    ["lifecycleAction", input.lifecycleAction],
    ["lifecycle.command", lifecycleInput.command],
    ["lifecycle.action", lifecycleInput.action],
    ["command.lifecycle", commandInput.lifecycle],
    ["command.name", commandInput.name]
  ];
  const selected = candidates.find(([, value]) => typeof value === "string" && value.trim());
  const requested = selected ? selected[1].trim() : "evaluate-policy";
  const normalizedToken = requested.replace(/_/g, "-").toLowerCase();
  const command = LIFECYCLE_COMMANDS.has(normalizedToken)
    ? normalizedToken
    : LIFECYCLE_COMMAND_ALIASES[normalizedToken] || LIFECYCLE_COMMAND_ALIASES[requested] || "evaluate-policy";
  const unsupported = selected
    ? command === "evaluate-policy"
      && normalizedToken !== "evaluate-policy"
      && !["evaluate", "validate", "status"].includes(normalizedToken)
    : false;

  return {
    command,
    requested,
    source: selected ? selected[0] : "default",
    normalizedByAlias: command !== normalizedToken,
    unsupported
  };
}

function normalizeLifecycleTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return {
      supplied: false,
      value: null,
      valid: true
    };
  }

  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) {
    return {
      supplied: true,
      value: null,
      valid: false
    };
  }

  return {
    supplied: true,
    value: date.toISOString(),
    valid: true
  };
}

function normalizeDependencyPolicy(input = {}) {
  const policyInput = input.dependencyPolicy && typeof input.dependencyPolicy === "object"
    ? input.dependencyPolicy
    : input.healthPolicy && typeof input.healthPolicy === "object"
      ? input.healthPolicy
      : {};
  const staleAfterMs = Number.isInteger(policyInput.staleAfterMs) && policyInput.staleAfterMs >= 1000
    ? Math.min(policyInput.staleAfterMs, 24 * 60 * 60 * 1000)
    : DEFAULT_DEPENDENCY_POLICY.staleAfterMs;
  const maxLatencyMs = Number.isInteger(policyInput.maxLatencyMs) && policyInput.maxLatencyMs >= 1
    ? Math.min(policyInput.maxLatencyMs, 120000)
    : DEFAULT_DEPENDENCY_POLICY.maxLatencyMs;
  const required = uniqueStrings(policyInput.required).length
    ? uniqueStrings(policyInput.required)
    : DEFAULT_DEPENDENCY_POLICY.required;
  const degradable = uniqueStrings(policyInput.degradable).length
    ? uniqueStrings(policyInput.degradable)
    : DEFAULT_DEPENDENCY_POLICY.degradable;

  return { staleAfterMs, maxLatencyMs, required, degradable };
}

function normalizeDependencyProbe(name, probe, policy, generatedAt) {
  const raw = probe && typeof probe === "object" ? probe : {};
  const status = ["ok", "degraded", "down", "unknown"].includes(raw.status) ? raw.status : "unknown";
  const lastOkAt = raw.lastOkAt ? toIsoTimestamp(raw.lastOkAt) : null;
  const checkedAt = raw.checkedAt ? toIsoTimestamp(raw.checkedAt) : generatedAt;
  const ageMs = lastOkAt ? millisecondsBetween(lastOkAt, generatedAt) : null;
  const latencyMs = Number.isFinite(raw.latencyMs) && raw.latencyMs >= 0 ? Math.round(raw.latencyMs) : null;
  const required = policy.required.includes(name);
  const degradable = !required || policy.degradable.includes(name);
  const stale = ageMs === null || ageMs > policy.staleAfterMs;
  const slow = latencyMs !== null && latencyMs > policy.maxLatencyMs;
  const effectiveState = status === "down" || status === "unknown" || (required && stale)
    ? "failed"
    : status === "degraded" || stale || slow
      ? "degraded"
      : "healthy";

  return {
    name,
    required,
    degradable,
    status,
    effectiveState,
    checkedAt,
    lastOkAt,
    ageMs,
    latencyMs,
    stale,
    slow,
    route: typeof raw.route === "string" && raw.route.trim()
      ? raw.route.trim()
      : `hosted-kernel.health.${name}`,
    message: typeof raw.message === "string" && raw.message.trim() ? raw.message.trim() : null
  };
}

function buildDependencyHealth({ input, generatedAt }) {
  const policy = normalizeDependencyPolicy(input);
  const probesInput = input.dependencyHealth && typeof input.dependencyHealth === "object"
    ? input.dependencyHealth
    : input.healthChecks && typeof input.healthChecks === "object"
      ? input.healthChecks
      : {};
  const dependencyNames = uniqueStrings([
    ...policy.required,
    ...policy.degradable,
    ...Object.keys(probesInput)
  ]);
  const dependencies = dependencyNames.map((name) => normalizeDependencyProbe(name, probesInput[name], policy, generatedAt));
  const blocking = dependencies.filter((dependency) => dependency.required && dependency.effectiveState === "failed");
  const degraded = dependencies.filter((dependency) => dependency.effectiveState === "degraded" || (!dependency.required && dependency.effectiveState === "failed"));
  const unknownRequired = dependencies.filter((dependency) => dependency.required && dependency.status === "unknown");

  return {
    schema: "hosted-kernel-artifact-path-policy.dependency-health.v1",
    generatedAt,
    state: blocking.length ? "blocked" : degraded.length || unknownRequired.length ? "degraded" : "healthy",
    policy,
    dependencies,
    blocking,
    degraded,
    degradedMode: {
      allowed: blocking.length === 0,
      readOnlyRecommended: degraded.some((dependency) => dependency.name === "commandJournal" || dependency.name === "artifactProvider"),
      reasonCodes: degraded.map((dependency) => `dependency_${dependency.effectiveState}:${dependency.name}`)
    },
    proof: {
      dependencyHash: lightweightHash({
        policy,
        dependencies: dependencies.map(({ name, status, effectiveState, lastOkAt, latencyMs }) => ({
          name,
          status,
          effectiveState,
          lastOkAt,
          latencyMs
        }))
      }),
      generatedBy: surfaceId
    }
  };
}

function normalizeCommandRecoveryPolicy(input = {}) {
  const recoveryInput = input.commandRecovery && typeof input.commandRecovery === "object"
    ? input.commandRecovery
    : input.recoveryPolicy && typeof input.recoveryPolicy === "object"
      ? input.recoveryPolicy
      : {};
  const preparedTtlMs = Number.isInteger(recoveryInput.preparedTtlMs) && recoveryInput.preparedTtlMs >= 1000
    ? Math.min(recoveryInput.preparedTtlMs, 24 * 60 * 60 * 1000)
    : DEFAULT_COMMAND_RECOVERY_POLICY.preparedTtlMs;
  const maxRecoveryAttempts = Number.isInteger(recoveryInput.maxRecoveryAttempts) && recoveryInput.maxRecoveryAttempts >= 0
    ? Math.min(recoveryInput.maxRecoveryAttempts, 20)
    : DEFAULT_COMMAND_RECOVERY_POLICY.maxRecoveryAttempts;
  const quarantineRetainedCommands = Number.isInteger(recoveryInput.quarantineRetainedCommands) && recoveryInput.quarantineRetainedCommands >= 0
    ? Math.min(recoveryInput.quarantineRetainedCommands, 50)
    : DEFAULT_COMMAND_RECOVERY_POLICY.quarantineRetainedCommands;

  return {
    preparedTtlMs,
    maxRecoveryAttempts,
    quarantineRetainedCommands
  };
}

function normalizeRecoveryCheckpoint(value = {}) {
  const checkpoint = value && typeof value === "object" ? value : {};
  const quarantinedCommands = Array.isArray(checkpoint.quarantinedCommands)
    ? checkpoint.quarantinedCommands
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          commandKey: typeof entry.commandKey === "string" ? entry.commandKey : null,
          reason: typeof entry.reason === "string" ? entry.reason : "unknown",
          path: typeof entry.path === "string" ? normalizePath(entry.path) : null,
          revision: typeof entry.revision === "string" ? entry.revision : null,
          recordedAt: toIsoTimestamp(entry.recordedAt)
        }))
        .filter((entry) => entry.commandKey)
    : [];

  return {
    recoveredCommandKey: typeof checkpoint.recoveredCommandKey === "string" ? checkpoint.recoveredCommandKey : null,
    recoveryAttempt: Number.isInteger(checkpoint.recoveryAttempt) && checkpoint.recoveryAttempt >= 0
      ? checkpoint.recoveryAttempt
      : 0,
    lastRecoveryAction: typeof checkpoint.lastRecoveryAction === "string" ? checkpoint.lastRecoveryAction : null,
    lastRecoveryAt: checkpoint.lastRecoveryAt ? toIsoTimestamp(checkpoint.lastRecoveryAt) : null,
    quarantinedCommands
  };
}

function normalizePersistedCommandReceipt(entry = {}) {
  const raw = entry && typeof entry === "object" ? entry : {};
  const status = [
    "accepted",
    "prepared",
    "waiting",
    "blocked",
    "ready",
    "committed",
    "replayed",
    "recovered",
    "stale",
    "orphaned"
  ].includes(raw.status)
    ? raw.status
    : "prepared";
  const commandKey = typeof raw.commandKey === "string" && raw.commandKey.trim()
    ? raw.commandKey.trim()
    : null;

  return {
    receiptKey: typeof raw.receiptKey === "string" && raw.receiptKey.trim()
      ? raw.receiptKey.trim()
      : commandKey
        ? `${surfaceId}:receipt:${lightweightHash({
            commandKey,
            status,
            generation: Number.isInteger(raw.generation) ? raw.generation : 0
          })}`
        : null,
    commandKey,
    status,
    durableStatus: typeof raw.durableStatus === "string" && raw.durableStatus.trim()
      ? raw.durableStatus.trim()
      : status,
    route: typeof raw.route === "string" && raw.route.trim() ? raw.route.trim() : null,
    command: typeof raw.command === "string" && raw.command.trim() ? raw.command.trim() : null,
    path: typeof raw.path === "string" ? normalizePath(raw.path) : null,
    revision: typeof raw.revision === "string" ? raw.revision : null,
    generation: Number.isInteger(raw.generation) && raw.generation >= 0 ? raw.generation : 0,
    recordedAt: toIsoTimestamp(raw.recordedAt),
    finalizedAt: raw.finalizedAt ? toIsoTimestamp(raw.finalizedAt) : null,
    replayCount: Number.isInteger(raw.replayCount) && raw.replayCount >= 0 ? raw.replayCount : 0
  };
}

function normalizePersistedState(state = {}) {
  const raw = state && typeof state === "object" ? state : {};
  const commandLog = Array.isArray(raw.commandLog)
    ? raw.commandLog
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          commandKey: typeof entry.commandKey === "string" ? entry.commandKey : null,
          command: typeof entry.command === "string" ? entry.command : "artifact.path.policy",
          status: ["committed", "blocked", "prepared", "waiting", "recovered", "stale-prepared", "orphaned-prepared"].includes(entry.status)
            ? entry.status
            : "prepared",
          outcome: typeof entry.outcome === "string" ? entry.outcome : null,
          path: typeof entry.path === "string" ? normalizePath(entry.path) : null,
          revision: typeof entry.revision === "string" ? entry.revision : null,
          tenantId: typeof entry.tenantId === "string" ? entry.tenantId : null,
          workspaceId: typeof entry.workspaceId === "string" ? entry.workspaceId : null,
          recordedAt: toIsoTimestamp(entry.recordedAt),
          preparedAt: entry.preparedAt ? toIsoTimestamp(entry.preparedAt) : null,
          terminalAt: entry.terminalAt ? toIsoTimestamp(entry.terminalAt) : null,
          recoveryAttempt: Number.isInteger(entry.recoveryAttempt) && entry.recoveryAttempt >= 0 ? entry.recoveryAttempt : 0
        }))
        .filter((entry) => entry.commandKey)
    : [];
  const lastDecision = raw.lastDecision && typeof raw.lastDecision === "object"
    ? {
        path: typeof raw.lastDecision.path === "string" ? normalizePath(raw.lastDecision.path) : null,
        access: typeof raw.lastDecision.access === "string" ? raw.lastDecision.access : null,
        allow: raw.lastDecision.allow === true,
        revision: typeof raw.lastDecision.revision === "string" ? raw.lastDecision.revision : null,
        commandKey: typeof raw.lastDecision.commandKey === "string" ? raw.lastDecision.commandKey : null,
        tenantId: typeof raw.lastDecision.tenantId === "string" ? raw.lastDecision.tenantId : null,
        workspaceId: typeof raw.lastDecision.workspaceId === "string" ? raw.lastDecision.workspaceId : null,
        actorId: typeof raw.lastDecision.actorId === "string" ? raw.lastDecision.actorId : null,
        recordedAt: toIsoTimestamp(raw.lastDecision.recordedAt)
      }
    : null;

  return {
    version: raw.version === PERSISTED_STATE_VERSION ? raw.version : PERSISTED_STATE_VERSION,
    bootId: typeof raw.bootId === "string" && raw.bootId.trim() ? raw.bootId.trim() : null,
    generation: Number.isInteger(raw.generation) && raw.generation >= 0 ? raw.generation : 0,
    lastDecision,
    commandLog,
    commandReceipts: Array.isArray(raw.commandReceipts)
      ? raw.commandReceipts.map(normalizePersistedCommandReceipt).filter((entry) => entry.commandKey && entry.receiptKey)
      : Array.isArray(raw.statusReceipts)
        ? raw.statusReceipts.map(normalizePersistedCommandReceipt).filter((entry) => entry.commandKey && entry.receiptKey)
        : [],
    recoveryCheckpoint: normalizeRecoveryCheckpoint(raw.recoveryCheckpoint)
  };
}

function normalizeProvider(provider = {}) {
  const id = typeof provider.id === "string" && provider.id.trim()
    ? provider.id.trim()
    : "hosted-kernel-artifact-provider";
  const advertisedCapabilities = uniqueStrings(provider.capabilities);
  const capabilities = advertisedCapabilities.length
    ? advertisedCapabilities
    : KERNEL_REQUIRED_CAPABILITIES;
  const missingCapabilities = KERNEL_REQUIRED_CAPABILITIES.filter((capability) => !capabilities.includes(capability));

  return {
    id,
    mode: provider.mode === "external" ? "external" : "hosted-kernel",
    capabilities,
    missingCapabilities,
    acceptedMediaTypes: uniqueStrings(provider.acceptedMediaTypes),
    maxPayloadBytes: Number.isInteger(provider.maxPayloadBytes) && provider.maxPayloadBytes > 0
      ? provider.maxPayloadBytes
      : null,
    contractVersion: typeof provider.contractVersion === "string" ? provider.contractVersion : "2026-07-01",
    syncClock: provider.syncClock === "provider" ? "provider" : "kernel"
  };
}

function normalizeScopeToken(value, fallback) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const token = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return token || fallback;
}

function normalizeTenantScope(input = {}, artifactRoot) {
  const tenantInput = input.tenant && typeof input.tenant === "object" ? input.tenant : {};
  const workspaceInput = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const tenantId = normalizeScopeToken(input.tenantId || tenantInput.id, "default-tenant");
  const workspaceId = normalizeScopeToken(input.workspaceId || workspaceInput.id, "default-workspace");
  const tenantRoot = normalizePath(input.tenantRoot || tenantInput.root || `${artifactRoot}/tenants/${tenantId}`);
  const workspaceRoot = normalizePath(input.workspaceRoot || workspaceInput.root || `${tenantRoot}/workspaces/${workspaceId}`);
  const sharedReadPrefixes = uniqueStrings([
    ...(Array.isArray(input.sharedReadPrefixes) ? input.sharedReadPrefixes : []),
    ...(Array.isArray(tenantInput.sharedReadPrefixes) ? tenantInput.sharedReadPrefixes : [])
  ]).map((prefix) => normalizePath(prefix));
  const boundaryMode = input.crossWorkspace === true ? "explicit-cross-workspace" : "workspace-isolated";
  const allowedReadPrefixes = uniqueStrings([
    workspaceRoot,
    ...(boundaryMode === "explicit-cross-workspace" ? [tenantRoot] : []),
    ...sharedReadPrefixes
  ]);
  const allowedWritePrefixes = uniqueStrings([workspaceRoot]);

  return {
    tenantId,
    workspaceId,
    tenantRoot,
    workspaceRoot,
    allowedReadPrefixes,
    allowedWritePrefixes,
    sharedReadPrefixes,
    boundaryMode
  };
}

function normalizeActorPermissions(input = {}) {
  const actor = input.actor && typeof input.actor === "object" ? input.actor : {};
  const actorId = typeof input.actorId === "string" && input.actorId.trim()
    ? input.actorId.trim()
    : typeof actor.id === "string" && actor.id.trim()
      ? actor.id.trim()
      : null;
  const roles = uniqueStrings([
    ...(Array.isArray(input.roles) ? input.roles : []),
    ...(Array.isArray(actor.roles) ? actor.roles : [])
  ]);
  const directPermissions = uniqueStrings([
    ...(Array.isArray(input.permissions) ? input.permissions : []),
    ...(Array.isArray(actor.permissions) ? actor.permissions : [])
  ]);
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSION_GRANTS[role] || []);
  const permissions = uniqueStrings([
    ...(directPermissions.length || rolePermissions.length ? [] : ["artifact.read"]),
    ...directPermissions,
    ...rolePermissions
  ]);
  const tenantClaims = uniqueStrings([
    ...(Array.isArray(input.actorTenantIds) ? input.actorTenantIds : []),
    ...(Array.isArray(actor.tenantIds) ? actor.tenantIds : []),
    ...(typeof actor.tenantId === "string" ? [actor.tenantId] : []),
    ...(typeof input.actorTenantId === "string" ? [input.actorTenantId] : [])
  ]).map((claim) => normalizeScopeToken(claim, "tenant"));
  const workspaceClaims = uniqueStrings([
    ...(Array.isArray(input.actorWorkspaceIds) ? input.actorWorkspaceIds : []),
    ...(Array.isArray(actor.workspaceIds) ? actor.workspaceIds : []),
    ...(typeof actor.workspaceId === "string" ? [actor.workspaceId] : []),
    ...(typeof input.actorWorkspaceId === "string" ? [input.actorWorkspaceId] : [])
  ]).map((claim) => normalizeScopeToken(claim, "workspace"));
  const tenantWorkspaceClaims = Array.isArray(actor.tenantWorkspaces) || Array.isArray(input.actorTenantWorkspaces)
    ? [
        ...(Array.isArray(actor.tenantWorkspaces) ? actor.tenantWorkspaces : []),
        ...(Array.isArray(input.actorTenantWorkspaces) ? input.actorTenantWorkspaces : [])
      ]
        .filter((claim) => claim && typeof claim === "object")
        .map((claim) => ({
          tenantId: normalizeScopeToken(claim.tenantId || claim.tenant || "", "tenant"),
          workspaceId: normalizeScopeToken(claim.workspaceId || claim.workspace || "", "workspace")
        }))
        .filter((claim) => claim.tenantId !== "tenant" && claim.workspaceId !== "workspace")
    : [];

  return {
    actorId,
    roles,
    permissions,
    scopeClaims: {
      tenantIds: uniqueStrings(tenantClaims),
      workspaceIds: uniqueStrings(workspaceClaims),
      tenantWorkspaces: tenantWorkspaceClaims,
      supplied: tenantClaims.length > 0 || workspaceClaims.length > 0 || tenantWorkspaceClaims.length > 0
    },
    source: directPermissions.length && roles.length
      ? "actor-and-direct-grants"
      : directPermissions.length
        ? "direct-grants"
        : roles.length
          ? "role-grants"
          : "anonymous-read-only"
  };
}

function buildPermissionDecision({ access, externalHandoff, actorPermissions, tenantScope }) {
  const required = uniqueStrings([
    ACCESS_PERMISSION[access] || ACCESS_PERMISSION.read,
    externalHandoff === true ? "artifact.externalHandoff" : null
  ]);
  const scopeClaims = actorPermissions.scopeClaims || {
    tenantIds: [],
    workspaceIds: [],
    tenantWorkspaces: [],
    supplied: false
  };
  const scopedTenantMatch = scopeClaims.tenantIds.length === 0
    || scopeClaims.tenantIds.includes(tenantScope.tenantId);
  const scopedWorkspaceMatch = scopeClaims.workspaceIds.length === 0
    || scopeClaims.workspaceIds.includes(tenantScope.workspaceId);
  const scopedPairMatch = scopeClaims.tenantWorkspaces.length === 0
    || scopeClaims.tenantWorkspaces.some((claim) => (
      claim.tenantId === tenantScope.tenantId && claim.workspaceId === tenantScope.workspaceId
    ));
  const crossWorkspaceRead = access === "read" && actorPermissions.permissions.includes(CROSS_WORKSPACE_READ_PERMISSION);
  const scopeViolations = [
    ...(scopedTenantMatch ? [] : ["actor_tenant_scope_mismatch"]),
    ...(scopedWorkspaceMatch || crossWorkspaceRead ? [] : ["actor_workspace_scope_mismatch"]),
    ...(scopedPairMatch || crossWorkspaceRead ? [] : ["actor_tenant_workspace_scope_mismatch"])
  ];
  const missing = required.filter((permission) => !actorPermissions.permissions.includes(permission));

  return {
    actorId: actorPermissions.actorId,
    roles: actorPermissions.roles,
    grants: actorPermissions.permissions,
    source: actorPermissions.source,
    required,
    missing,
    scope: {
      supplied: scopeClaims.supplied,
      tenantIds: scopeClaims.tenantIds,
      workspaceIds: scopeClaims.workspaceIds,
      tenantWorkspaces: scopeClaims.tenantWorkspaces,
      targetTenantId: tenantScope.tenantId,
      targetWorkspaceId: tenantScope.workspaceId,
      crossWorkspaceReadOverride: crossWorkspaceRead,
      violations: scopeViolations,
      allow: scopeViolations.length === 0
    },
    allow: missing.length === 0 && scopeViolations.length === 0
  };
}

function buildTenantBoundaryContract({ artifactRoot, tenantScope, requestedAccess, permissionDecision }) {
  const tenantRootInsideArtifactRoot = startsWithPath(tenantScope.tenantRoot, artifactRoot);
  const workspaceRootInsideTenantRoot = startsWithPath(tenantScope.workspaceRoot, tenantScope.tenantRoot);
  const sharedReadPrefixStates = tenantScope.sharedReadPrefixes.map((prefix) => ({
    prefix,
    insideArtifactRoot: startsWithPath(prefix, artifactRoot),
    insideTenantRoot: startsWithPath(prefix, tenantScope.tenantRoot)
  }));
  const crossWorkspaceRequested = tenantScope.boundaryMode === "explicit-cross-workspace";
  const crossWorkspaceAllowed = !crossWorkspaceRequested
    || permissionDecision.grants.includes(CROSS_WORKSPACE_READ_PERMISSION);
  const violations = [
    ...(!tenantRootInsideArtifactRoot ? ["tenant_root_outside_artifact_root"] : []),
    ...(tenantRootInsideArtifactRoot && !workspaceRootInsideTenantRoot ? ["workspace_root_outside_tenant_root"] : []),
    ...sharedReadPrefixStates
      .filter((entry) => !entry.insideArtifactRoot || !entry.insideTenantRoot)
      .map((entry) => `shared_read_prefix_outside_tenant:${entry.prefix}`),
    ...(crossWorkspaceRequested && !crossWorkspaceAllowed ? [`missing_permission:${CROSS_WORKSPACE_READ_PERMISSION}`] : []),
    ...(crossWorkspaceRequested && requestedAccess !== "read" ? ["cross_workspace_write_blocked"] : [])
  ];

  return {
    schema: "hosted-kernel-artifact-path-policy.tenant-boundary.v1",
    state: violations.length ? "blocked" : "satisfied",
    tenantId: tenantScope.tenantId,
    workspaceId: tenantScope.workspaceId,
    artifactRoot,
    tenantRoot: tenantScope.tenantRoot,
    workspaceRoot: tenantScope.workspaceRoot,
    boundaryMode: tenantScope.boundaryMode,
    crossWorkspace: {
      requested: crossWorkspaceRequested,
      requiredPermission: crossWorkspaceRequested ? CROSS_WORKSPACE_READ_PERMISSION : null,
      allowed: crossWorkspaceAllowed,
      accessLimitedToRead: requestedAccess === "read"
    },
    sharedReadPrefixes: sharedReadPrefixStates,
    claims: {
      tenantRootInsideArtifactRoot,
      workspaceRootInsideTenantRoot,
      sharedPrefixesTenantBound: sharedReadPrefixStates.every((entry) => entry.insideArtifactRoot && entry.insideTenantRoot)
    },
    violations,
    proof: {
      scopeHash: lightweightHash({
        artifactRoot,
        tenantRoot: tenantScope.tenantRoot,
        workspaceRoot: tenantScope.workspaceRoot,
        sharedReadPrefixes: tenantScope.sharedReadPrefixes,
        boundaryMode: tenantScope.boundaryMode,
        actorId: permissionDecision.actorId
      }),
      generatedBy: surfaceId
    }
  };
}

function buildPathDecision({
  path,
  artifactRoot,
  deniedSegments,
  readOnlyPrefixes,
  requestedAccess,
  tenantScope,
  permissionDecision,
  tenantBoundary
}) {
  const normalizedPath = normalizePath(path, artifactRoot);
  const segments = pathSegments(normalizedPath);
  const deniedSegment = segments.find((segment) => deniedSegments.has(segment));
  const pathEvidence = buildPathEvidence({
    rawPath: path,
    normalizedPath,
    artifactRoot,
    tenantScope,
    deniedSegments,
    readOnlyPrefixes
  });
  const insideArtifactRoot = startsWithPath(normalizedPath, artifactRoot);
  const readOnly = readOnlyPrefixes.some((prefix) => startsWithPath(normalizedPath, prefix));
  const access = requestedAccess === "write" || requestedAccess === "sync" ? requestedAccess : "read";
  const workspaceReadable = tenantScope.allowedReadPrefixes.some((prefix) => startsWithPath(normalizedPath, prefix));
  const workspaceWritable = tenantScope.allowedWritePrefixes.some((prefix) => startsWithPath(normalizedPath, prefix));
  const workspaceScoped = access === "read" ? workspaceReadable : workspaceWritable;
  const violations = [];

  if (!insideArtifactRoot) violations.push("outside_artifact_root");
  if (insideArtifactRoot && !workspaceScoped) violations.push("outside_workspace_scope");
  for (const violation of tenantBoundary.violations) {
    violations.push(violation);
  }
  for (const violation of pathEvidence.risk.blockingViolations) {
    violations.push(violation);
  }
  if (deniedSegment) violations.push(`denied_segment:${deniedSegment}`);
  if (readOnly && access !== "read") violations.push("readonly_prefix");
  for (const permission of permissionDecision.missing) {
    violations.push(`missing_permission:${permission}`);
  }
  for (const scopeViolation of permissionDecision.scope.violations) {
    violations.push(scopeViolation);
  }

  return {
    path: normalizedPath,
    access,
    allow: violations.length === 0,
    scope: insideArtifactRoot ? "tenant-workspace" : "external",
    workspace: {
      tenantId: tenantScope.tenantId,
      workspaceId: tenantScope.workspaceId,
      tenantRoot: tenantScope.tenantRoot,
      workspaceRoot: tenantScope.workspaceRoot,
      readable: workspaceReadable,
      writable: workspaceWritable,
      boundaryMode: tenantScope.boundaryMode
    },
    tenantBoundary,
    pathEvidence,
    permission: permissionDecision,
    readOnly,
    violations
  };
}

function buildSyncMetadata({ decision, provider, input, generatedAt }) {
  const lastKnownRevision = typeof input.revision === "string" && input.revision.trim()
    ? input.revision.trim()
    : null;
  const syncIntent = input.syncIntent === "pull" || input.syncIntent === "push" ? input.syncIntent : "observe";
  const providerCanSync = provider.capabilities.includes("artifact.syncMetadata");

  return {
    enabled: decision.allow && providerCanSync,
    intent: syncIntent,
    revision: lastKnownRevision,
    clockOwner: provider.syncClock,
    generatedAt,
    proof: {
      pathAllowed: decision.allow,
      providerCanSync,
      access: decision.access
    }
  };
}

function normalizeMutationPreconditions(input = {}, decision, syncMetadata) {
  const preconditionInput = input.mutationPreconditions && typeof input.mutationPreconditions === "object"
    ? input.mutationPreconditions
    : input.writePreconditions && typeof input.writePreconditions === "object"
      ? input.writePreconditions
      : {};
  const writeLike = decision.access === "write" || decision.access === "sync";
  const requireRevisionMatch = writeLike && (
    preconditionInput.requireRevisionMatch === true
    || input.requireRevisionMatch === true
    || input.requireExpectedRevision === true
  );
  const requireContentHash = writeLike && (
    preconditionInput.requireContentHash === true
    || input.requireContentHash === true
  );
  const expectedRevision = typeof preconditionInput.expectedRevision === "string" && preconditionInput.expectedRevision.trim()
    ? preconditionInput.expectedRevision.trim()
    : typeof input.expectedRevision === "string" && input.expectedRevision.trim()
      ? input.expectedRevision.trim()
      : null;
  const observedRevision = syncMetadata.revision
    || (typeof preconditionInput.observedRevision === "string" && preconditionInput.observedRevision.trim()
      ? preconditionInput.observedRevision.trim()
      : null);
  const expectedContentHash = typeof preconditionInput.expectedContentHash === "string" && preconditionInput.expectedContentHash.trim()
    ? preconditionInput.expectedContentHash.trim()
    : typeof input.expectedContentHash === "string" && input.expectedContentHash.trim()
      ? input.expectedContentHash.trim()
      : null;
  const observedContentHash = typeof preconditionInput.observedContentHash === "string" && preconditionInput.observedContentHash.trim()
    ? preconditionInput.observedContentHash.trim()
    : input.artifact && typeof input.artifact.contentHash === "string" && input.artifact.contentHash.trim()
      ? input.artifact.contentHash.trim()
      : null;
  const revisionSatisfied = !requireRevisionMatch
    || (expectedRevision !== null && observedRevision !== null && expectedRevision === observedRevision);
  const contentHashSatisfied = !requireContentHash
    || (expectedContentHash !== null && observedContentHash !== null && expectedContentHash === observedContentHash);
  const violations = [
    ...(requireRevisionMatch && !expectedRevision ? ["missing_expected_revision"] : []),
    ...(requireRevisionMatch && !observedRevision ? ["missing_observed_revision"] : []),
    ...(requireRevisionMatch && expectedRevision && observedRevision && expectedRevision !== observedRevision ? ["revision_conflict"] : []),
    ...(requireContentHash && !expectedContentHash ? ["missing_expected_content_hash"] : []),
    ...(requireContentHash && !observedContentHash ? ["missing_observed_content_hash"] : []),
    ...(requireContentHash && expectedContentHash && observedContentHash && expectedContentHash !== observedContentHash ? ["content_hash_conflict"] : [])
  ];
  const idempotencySeed = {
    path: decision.path,
    access: decision.access,
    expectedRevision,
    observedRevision,
    expectedContentHash,
    observedContentHash
  };

  return {
    schema: "hosted-kernel-artifact-path-policy.mutation-preconditions.v1",
    required: requireRevisionMatch || requireContentHash,
    status: !writeLike
      ? "not-applicable"
      : violations.length
        ? "failed"
        : requireRevisionMatch || requireContentHash
          ? "satisfied"
          : "not-required",
    checks: {
      writeLike,
      revisionMatch: {
        required: requireRevisionMatch,
        expected: expectedRevision,
        observed: observedRevision,
        satisfied: revisionSatisfied
      },
      contentHashMatch: {
        required: requireContentHash,
        expected: expectedContentHash,
        observed: observedContentHash,
        satisfied: contentHashSatisfied
      }
    },
    violations,
    proof: {
      path: decision.path,
      access: decision.access,
      preconditionKey: `${surfaceId}:mutation:${lightweightHash(idempotencySeed)}`,
      generatedFromSyncRevision: observedRevision === syncMetadata.revision && observedRevision !== null
    }
  };
}

function buildExternalHandoff({ decision, provider, input, tenantScope, permissionDecision }) {
  const requested = input.externalHandoff === true || decision.scope === "external";
  const providerCanHandoff = provider.capabilities.includes("artifact.externalHandoff");
  const tenantBound = decision.scope === "external" || startsWithPath(decision.path, tenantScope.workspaceRoot);
  const actorCanHandoff = !requested || permissionDecision.grants.includes("artifact.externalHandoff");
  const state = !requested
    ? "not-requested"
    : providerCanHandoff
        && actorCanHandoff
        && tenantBound
        && decision.violations.every((violation) => violation === "outside_artifact_root")
      ? "ready"
      : "blocked";

  return {
    requested,
    state,
    providerId: provider.id,
    tenantId: tenantScope.tenantId,
    workspaceId: tenantScope.workspaceId,
    actorId: permissionDecision.actorId,
    boundary: tenantBound ? "tenant-bound" : "cross-tenant-blocked",
    reason: state === "blocked" ? decision.violations : [],
    token: state === "ready" ? `${surfaceId}:${provider.id}:${decision.path}` : null
  };
}

function normalizeLifecycleSettings(input = {}, generatedAt) {
  const settingsInput = input.lifecycleSettings && typeof input.lifecycleSettings === "object"
    ? input.lifecycleSettings
    : input.settings && typeof input.settings.lifecycle === "object"
      ? input.settings.lifecycle
      : input.lifecycle && typeof input.lifecycle === "object"
        ? input.lifecycle
        : {};
  const commandInfo = normalizeLifecycleCommand(input);
  const command = commandInfo.command;
  const enabled = normalizeLifecycleBoolean(settingsInput.enabled, DEFAULT_LIFECYCLE_SETTINGS.enabled);
  const commandsEnabled = normalizeLifecycleBoolean(settingsInput.commandsEnabled, DEFAULT_LIFECYCLE_SETTINGS.commandsEnabled);
  const scheduleEnabled = normalizeLifecycleBoolean(settingsInput.scheduleEnabled, DEFAULT_LIFECYCLE_SETTINGS.scheduleEnabled);
  const requestedInterval = Number.isInteger(settingsInput.scheduleIntervalMinutes)
    ? settingsInput.scheduleIntervalMinutes
    : DEFAULT_LIFECYCLE_SETTINGS.scheduleIntervalMinutes;
  const scheduleIntervalMinutes = Math.min(Math.max(requestedInterval, 5), 10080);
  const scheduleTimestamp = normalizeLifecycleTimestamp(
    typeof settingsInput.nextRunAt === "string" ? settingsInput.nextRunAt : input.scheduledFor
  );
  const scheduledFor = scheduleTimestamp.value;
  const scheduledDelayMs = scheduledFor ? millisecondsBetween(generatedAt, scheduledFor) : null;
  const scheduleDue = scheduleEnabled && scheduledFor !== null && new Date(scheduledFor).getTime() <= new Date(generatedAt).getTime();
  const computedNextRunAt = scheduleEnabled
    ? scheduledFor || addMinutesIso(generatedAt, scheduleIntervalMinutes)
    : null;
  const windowInput = settingsInput.maintenanceWindow && typeof settingsInput.maintenanceWindow === "object"
    ? settingsInput.maintenanceWindow
    : {};
  const startHourUtc = Number.isInteger(windowInput.startHourUtc) && windowInput.startHourUtc >= 0 && windowInput.startHourUtc <= 23
    ? windowInput.startHourUtc
    : null;
  const endHourUtc = Number.isInteger(windowInput.endHourUtc) && windowInput.endHourUtc >= 0 && windowInput.endHourUtc <= 23
    ? windowInput.endHourUtc
    : null;
  const hasWindow = startHourUtc !== null && endHourUtc !== null && startHourUtc !== endHourUtc;
  const currentHourUtc = new Date(generatedAt).getUTCHours();
  const windowActive = !hasWindow
    || (startHourUtc < endHourUtc
      ? currentHourUtc >= startHourUtc && currentHourUtc < endHourUtc
      : currentHourUtc >= startHourUtc || currentHourUtc < endHourUtc);
  const disabledReason = typeof settingsInput.disabledReason === "string" && settingsInput.disabledReason.trim()
    ? settingsInput.disabledReason.trim()
    : null;
  const commandAvailability = {
    "evaluate-policy": {
      enabled: true,
      reasonCodes: []
    },
    enable: {
      enabled: !enabled,
      reasonCodes: enabled ? ["lifecycle_already_enabled"] : []
    },
    disable: {
      enabled,
      reasonCodes: enabled ? [] : ["lifecycle_already_disabled"]
    },
    pause: {
      enabled: enabled && commandsEnabled,
      reasonCodes: [
        ...(!enabled ? ["lifecycle_disabled"] : []),
        ...(enabled && !commandsEnabled ? ["lifecycle_commands_already_paused"] : [])
      ]
    },
    resume: {
      enabled: enabled && !commandsEnabled,
      reasonCodes: [
        ...(!enabled ? ["lifecycle_disabled"] : []),
        ...(enabled && commandsEnabled ? ["lifecycle_commands_already_enabled"] : [])
      ]
    },
    schedule: {
      enabled: enabled && commandsEnabled && scheduleEnabled && scheduleTimestamp.valid,
      reasonCodes: [
        ...(!enabled ? ["lifecycle_disabled"] : []),
        ...(enabled && !commandsEnabled ? ["lifecycle_commands_disabled"] : []),
        ...(!scheduleEnabled ? ["schedule_disabled"] : []),
        ...(!scheduleTimestamp.valid ? ["schedule_invalid_next_run"] : [])
      ]
    },
    "run-now": {
      enabled: enabled && commandsEnabled && windowActive && (!scheduleEnabled || scheduleDue),
      reasonCodes: [
        ...(!enabled ? ["lifecycle_disabled"] : []),
        ...(enabled && !commandsEnabled ? ["lifecycle_commands_disabled"] : []),
        ...(scheduleEnabled && scheduledFor && !scheduleDue ? ["scheduled_run_not_due"] : []),
        ...(!windowActive ? ["maintenance_window_inactive"] : [])
      ]
    }
  };

  return {
    command,
    commandRequest: commandInfo,
    settings: {
      enabled,
      commandsEnabled,
      scheduleEnabled,
      scheduleIntervalMinutes,
      timezone: typeof settingsInput.timezone === "string" && settingsInput.timezone.trim()
        ? settingsInput.timezone.trim()
        : DEFAULT_LIFECYCLE_SETTINGS.timezone,
      disabledReason,
      nextRunAt: scheduledFor,
      computedNextRunAt,
      scheduleState: !scheduleEnabled
        ? "disabled"
        : !scheduleTimestamp.valid
          ? "invalid"
        : scheduledFor === null
          ? "unarmed"
          : scheduleDue
            ? "due"
            : "armed",
      scheduledDelayMs,
      maintenanceWindow: hasWindow
        ? {
            startHourUtc,
            endHourUtc,
            state: windowActive ? "active" : "inactive"
          }
        : null
    },
    controls: {
      canEnable: !enabled,
      canDisable: enabled,
      canPause: enabled && commandsEnabled,
      canResume: enabled && !commandsEnabled,
      canSchedule: enabled && commandsEnabled,
      canRunNow: enabled && commandsEnabled && windowActive,
      commandAvailability
    },
    violations: [
      ...(commandInfo.unsupported ? [`unsupported_lifecycle_command:${commandInfo.requested}`] : []),
      ...(!enabled && command !== "enable" ? ["lifecycle_disabled"] : []),
      ...(enabled && !commandsEnabled && command !== "resume" ? ["lifecycle_commands_disabled"] : []),
      ...(command === "schedule" && !scheduleEnabled ? ["schedule_disabled"] : []),
      ...(command === "schedule" && !scheduleTimestamp.valid ? ["schedule_invalid_next_run"] : []),
      ...(command === "schedule" && scheduleEnabled && scheduleTimestamp.valid && !scheduledFor ? ["schedule_missing_next_run"] : []),
      ...(command === "run-now" && !commandsEnabled ? ["run_now_requires_commands_enabled"] : []),
      ...(command === "run-now" && scheduleEnabled && scheduledFor && !scheduleDue ? ["scheduled_run_not_due"] : []),
      ...(command === "run-now" && !windowActive ? ["maintenance_window_inactive"] : [])
    ],
    warnings: [
      ...(commandInfo.normalizedByAlias && !commandInfo.unsupported ? ["lifecycle_command_alias_normalized"] : []),
      ...(requestedInterval !== scheduleIntervalMinutes ? ["schedule_interval_clamped"] : []),
      ...(!enabled && !disabledReason ? ["missing_disabled_reason"] : []),
      ...(scheduleEnabled && scheduleTimestamp.valid && !scheduledFor ? ["schedule_not_armed"] : [])
    ]
  };
}

function buildLifecycleCommandEffect(lifecycle, generatedAt) {
  const current = lifecycle.settings;
  const command = lifecycle.command;
  const schedulePatch = {
    scheduleEnabled: current.scheduleEnabled,
    scheduleIntervalMinutes: current.scheduleIntervalMinutes,
    nextRunAt: current.computedNextRunAt
  };
  const patches = {
    "evaluate-policy": {},
    enable: {
      enabled: true,
      commandsEnabled: current.commandsEnabled
    },
    disable: {
      enabled: false,
      commandsEnabled: false,
      disabledReason: current.disabledReason || "disabled-by-lifecycle-command"
    },
    pause: {
      commandsEnabled: false
    },
    resume: {
      enabled: true,
      commandsEnabled: true
    },
    schedule: schedulePatch,
    "run-now": {
      lastRunAt: generatedAt,
      nextRunAt: current.scheduleEnabled
        ? addMinutesIso(generatedAt, current.scheduleIntervalMinutes)
        : null
    }
  };
  const allowed = lifecycle.violations.length === 0;
  const mutatesSettings = command !== "evaluate-policy";
  const persistedPatch = allowed && mutatesSettings ? patches[command] : {};

  return {
    schema: "hosted-kernel-artifact-path-policy.lifecycle-command-effect.v1",
    command,
    commandRequest: lifecycle.commandRequest,
    allowed,
    mutatesSettings,
    persistedPatch,
    rejectedPatch: allowed ? null : patches[command],
    stateTransition: {
      from: {
        enabled: current.enabled,
        commandsEnabled: current.commandsEnabled,
        scheduleEnabled: current.scheduleEnabled,
        scheduleState: current.scheduleState
      },
      to: allowed
        ? {
            enabled: Object.prototype.hasOwnProperty.call(persistedPatch, "enabled") ? persistedPatch.enabled : current.enabled,
            commandsEnabled: Object.prototype.hasOwnProperty.call(persistedPatch, "commandsEnabled") ? persistedPatch.commandsEnabled : current.commandsEnabled,
            scheduleEnabled: Object.prototype.hasOwnProperty.call(persistedPatch, "scheduleEnabled") ? persistedPatch.scheduleEnabled : current.scheduleEnabled,
            scheduleState: command === "run-now" && current.scheduleEnabled
              ? "armed"
              : command === "schedule"
                ? "armed"
                : current.scheduleState
          }
        : null
    },
    audit: {
      effectHash: lightweightHash({
        command,
        allowed,
        persistedPatch,
        violations: lifecycle.violations,
        warnings: lifecycle.warnings
      }),
      generatedBy: surfaceId
    }
  };
}

function selectLifecycleNextAction(lifecycle, decision) {
  if (lifecycle.violations.some((violation) => violation.startsWith("unsupported_lifecycle_command:"))) {
    return "select-supported-lifecycle-command";
  }
  if (lifecycle.violations.includes("lifecycle_disabled")) return "enable-lifecycle";
  if (lifecycle.violations.includes("lifecycle_commands_disabled")) return "resume-lifecycle";
  if (lifecycle.violations.includes("schedule_disabled")) return "enable-scheduling";
  if (lifecycle.violations.includes("schedule_invalid_next_run")) return "fix-next-run";
  if (lifecycle.violations.includes("schedule_missing_next_run")) return "set-next-run";
  if (lifecycle.violations.includes("run_now_requires_commands_enabled")) return "resume-lifecycle";
  if (lifecycle.violations.includes("scheduled_run_not_due")) return "wait-for-scheduled-run";
  if (lifecycle.violations.includes("maintenance_window_inactive")) return "wait-for-maintenance-window";
  return decision.access === "sync" ? "commit-sync-lifecycle" : "continue-policy-lifecycle";
}

function buildLifecycleControls({ input, generatedAt, decision }) {
  const lifecycle = normalizeLifecycleSettings(input, generatedAt);
  const commandEffect = buildLifecycleCommandEffect(lifecycle, generatedAt);
  const commandLabels = {
    "evaluate-policy": "Evaluate path policy",
    enable: "Enable artifact lifecycle",
    disable: "Disable artifact lifecycle",
    pause: "Pause lifecycle commands",
    resume: "Resume lifecycle commands",
    schedule: "Schedule lifecycle run",
    "run-now": "Run lifecycle now"
  };
  const nextAction = selectLifecycleNextAction(lifecycle, decision);
  const commandRoutes = {
    "evaluate-policy": "hosted-kernel.artifact.lifecycle.evaluate-policy",
    enable: "hosted-kernel.artifact.lifecycle.enable",
    disable: "hosted-kernel.artifact.lifecycle.disable",
    pause: "hosted-kernel.artifact.lifecycle.pause",
    resume: "hosted-kernel.artifact.lifecycle.resume",
    schedule: "hosted-kernel.artifact.lifecycle.schedule",
    "run-now": "hosted-kernel.artifact.lifecycle.run-now"
  };

  return {
    schema: "hosted-kernel-artifact-path-policy.lifecycle.v1",
    command: lifecycle.command,
    commandRequest: lifecycle.commandRequest,
    label: commandLabels[lifecycle.command],
    route: commandRoutes[lifecycle.command],
    settings: lifecycle.settings,
    controls: lifecycle.controls,
    commandEffect,
    nextAction,
    nextActionState: {
      command: nextAction,
      reasonCodes: lifecycle.violations.length ? lifecycle.violations : lifecycle.warnings,
      readyForHostedKernel: lifecycle.violations.length === 0 && decision.allow,
      scheduleDue: lifecycle.settings.scheduleState === "due",
      nextRunAt: lifecycle.settings.computedNextRunAt,
      operatorRequired: lifecycle.violations.length > 0,
      commandAvailability: lifecycle.controls.commandAvailability[lifecycle.command]
    },
    validation: {
      status: lifecycle.violations.length ? "blocked" : lifecycle.warnings.length ? "warning" : "passed",
      violations: lifecycle.violations,
      warnings: lifecycle.warnings
    },
    proof: {
      path: decision.path,
      access: decision.access,
      generatedAt,
      commandAllowed: lifecycle.violations.length === 0,
      scheduleArmed: lifecycle.settings.scheduleEnabled && Boolean(lifecycle.settings.nextRunAt),
      scheduleState: lifecycle.settings.scheduleState,
      commandRequestSource: lifecycle.commandRequest.source,
      commandRequestNormalized: lifecycle.commandRequest.normalizedByAlias,
      commandEffectHash: commandEffect.audit.effectHash,
      maintenanceWindowState: lifecycle.settings.maintenanceWindow
        ? lifecycle.settings.maintenanceWindow.state
        : "not-configured"
    }
  };
}

function mutationPreconditionMessage(code) {
  const messages = {
    missing_expected_revision: "Write preconditions require an expected artifact revision.",
    missing_observed_revision: "Write preconditions require the hosted kernel's observed artifact revision.",
    revision_conflict: "Expected artifact revision does not match the hosted kernel's observed revision.",
    missing_expected_content_hash: "Write preconditions require an expected artifact content hash.",
    missing_observed_content_hash: "Write preconditions require the hosted kernel's observed artifact content hash.",
    content_hash_conflict: "Expected artifact content hash does not match the hosted kernel's observed content hash."
  };

  return messages[code] || "Artifact mutation preconditions are not satisfied.";
}

function artifactWritePolicyMessage(code) {
  if (code === "write_target_outside_workspace") return "Artifact writes must target the active tenant workspace.";
  if (code === "write_target_readonly") return "Artifact writes cannot target a read-only prefix.";
  if (code === "write_target_directory_like") return "Artifact writes must target a concrete artifact file path.";
  if (code === "write_target_control_character") return "Artifact write path contains a control character.";
  if (code === "write_target_drive_letter_segment") return "Artifact write path cannot contain a Windows drive-letter segment.";
  if (code === "write_target_encoded_traversal") return "Artifact write path contains encoded traversal or separator characters.";
  if (code === "write_payload_missing_content_hash") return "Declared artifact payloads must include a content hash before direct write.";
  if (code === "write_payload_invalid_content_hash") return "Declared artifact payload content hash must be sha256 hex or an algorithm-prefixed digest.";
  if (code === "write_payload_missing_byte_length") return "Declared artifact payloads must include a non-negative byte length.";
  if (code === "write_payload_empty") return "Declared artifact payload is empty and requires operator review before commit.";
  if (code === "write_payload_missing_media_type") return "Declared artifact payloads must include a valid media type.";
  if (code.startsWith("write_target_denied_segment:")) {
    return `Artifact write path contains a denied segment (${code.replace("write_target_denied_segment:", "")}).`;
  }
  return "Artifact write target is not safe for a direct write.";
}

function summarizeValidation({ decision, provider, syncMetadata, externalHandoff, lifecycleControls, mutationPreconditions, dependencyHealth, artifactWritePolicy }) {
  const failures = [
    ...decision.violations.map((violation) => ({
      code: violation,
      target: "path",
      message: violation === "outside_artifact_root"
        ? "Path is outside the hosted artifact root."
        : violation === "readonly_prefix"
          ? "Requested access writes to a read-only artifact prefix."
          : violation === "outside_workspace_scope"
            ? "Path is outside the active tenant workspace boundary."
            : violation === "tenant_root_outside_artifact_root"
              ? "Tenant root must remain inside the hosted artifact root."
              : violation === "workspace_root_outside_tenant_root"
                ? "Workspace root must remain inside the active tenant root."
            : violation === "cross_workspace_write_blocked"
              ? "Cross-workspace scope can only be used for read operations."
              : violation === "path_control_character"
                ? "Path contains a control character."
              : violation === "path_encoded_traversal_or_separator"
                ? "Path contains encoded traversal or separator characters."
              : violation.startsWith("path_drive_letter_segment:")
                ? "Path contains a Windows drive-letter segment."
                  : violation.startsWith("shared_read_prefix_outside_tenant:")
                    ? "Shared read prefixes must remain inside the active tenant root."
            : violation === "actor_tenant_scope_mismatch"
              ? "Actor tenant claims do not include the requested tenant."
              : violation === "actor_workspace_scope_mismatch"
                ? "Actor workspace claims do not include the requested workspace."
              : violation === "actor_tenant_workspace_scope_mismatch"
                ? "Actor tenant/workspace pair claims do not include the requested workspace boundary."
            : violation.startsWith("missing_permission:")
              ? `Actor is missing ${violation.replace("missing_permission:", "")}.`
              : `Path contains a denied segment (${violation.replace("denied_segment:", "")}).`
    })),
    ...provider.missingCapabilities.map((capability) => ({
      code: `missing_capability:${capability}`,
      target: "provider",
      message: `Provider does not advertise ${capability}.`
    })),
    ...lifecycleControls.validation.violations.map((violation) => ({
      code: violation,
      target: "lifecycle",
      message: violation.startsWith("unsupported_lifecycle_command:")
        ? "Requested lifecycle command is not supported by the artifact path-policy surface."
        : violation === "lifecycle_disabled"
        ? "Artifact lifecycle controls are disabled for this workspace."
        : violation === "lifecycle_commands_disabled"
          ? "Lifecycle commands are paused and must be resumed before continuing."
          : violation === "schedule_disabled"
            ? "Scheduling is disabled for lifecycle policy commands."
            : violation === "schedule_invalid_next_run"
              ? "Lifecycle scheduling requires a valid next run timestamp."
            : violation === "schedule_missing_next_run"
              ? "Scheduling requires a valid next run timestamp."
              : violation === "run_now_requires_commands_enabled"
                ? "Run-now requires lifecycle commands to be enabled."
                : violation === "scheduled_run_not_due"
                  ? "The scheduled lifecycle run is not due yet."
                  : "The requested lifecycle command is outside the active maintenance window."
    })),
    ...mutationPreconditions.violations.map((violation) => ({
      code: violation,
      target: "mutationPreconditions",
      message: mutationPreconditionMessage(violation)
    })),
    ...artifactWritePolicy.validation.violations.map((violation) => ({
      code: violation,
      target: "artifactWritePolicy",
      message: artifactWritePolicyMessage(violation)
    })),
    ...dependencyHealth.blocking.map((dependency) => ({
      code: `dependency_failed:${dependency.name}`,
      target: "dependencyHealth",
      message: dependency.message
        || `Hosted-kernel dependency ${dependency.name} is not healthy enough to execute artifact path-policy commands.`
    }))
  ];
  const warnings = [
    ...lifecycleControls.validation.warnings.map((warning) => ({
      code: warning,
      target: "lifecycle",
      message: warning === "lifecycle_command_alias_normalized"
        ? "Lifecycle command alias was normalized to a supported hosted-kernel command."
        : warning === "schedule_interval_clamped"
        ? "Lifecycle schedule interval was clamped to the supported range."
        : warning === "missing_disabled_reason"
          ? "Lifecycle is disabled without an operator-visible reason."
          : "Lifecycle scheduling is enabled but no next run is armed."
    })),
    ...dependencyHealth.degraded.map((dependency) => ({
      code: `dependency_degraded:${dependency.name}`,
      target: "dependencyHealth",
      message: dependency.message
        || `Hosted-kernel dependency ${dependency.name} is degraded; artifact path-policy may continue in degraded mode.`
    }))
  ];

  if (!syncMetadata.enabled && decision.allow) {
    warnings.push({
      code: "sync_metadata_unavailable",
      target: "syncMetadata",
      message: "Path access is allowed, but sync metadata cannot be committed by this provider."
    });
  }

  if (externalHandoff.requested && externalHandoff.state !== "ready") {
    warnings.push({
      code: "external_handoff_blocked",
      target: "externalHandoff",
      message: "External handoff was requested but no handoff token can be issued."
    });
  }

  return {
    status: failures.length ? "failed" : warnings.length ? "warning" : "passed",
    failureCount: failures.length,
    warningCount: warnings.length,
    checks: {
      rootBoundary: !decision.violations.includes("outside_artifact_root"),
      workspaceBoundary: !decision.violations.includes("outside_workspace_scope"),
      tenantBoundary: decision.tenantBoundary.state === "satisfied",
      pathEvidence: decision.pathEvidence.risk.blockingViolations.length === 0,
      deniedSegments: !decision.violations.some((violation) => violation.startsWith("denied_segment:")),
      accessMode: !decision.violations.includes("readonly_prefix"),
      actorPermissions: !decision.violations.some((violation) => violation.startsWith("missing_permission:")),
      actorScope: decision.permission.scope.allow,
      providerCapabilities: provider.missingCapabilities.length === 0,
      syncMetadata: syncMetadata.enabled,
      externalHandoff: !externalHandoff.requested || externalHandoff.state === "ready",
      lifecycleControls: lifecycleControls.validation.violations.length === 0,
      mutationPreconditions: mutationPreconditions.violations.length === 0,
      artifactWritePolicy: artifactWritePolicy.validation.violations.length === 0,
      dependencyHealth: dependencyHealth.blocking.length === 0
    },
    failures,
    warnings
  };
}

function buildUserPreview({ decision, syncMetadata, externalHandoff, validationSummary }) {
  const operation = decision.access === "read"
    ? "Read artifact"
    : decision.access === "sync"
      ? "Sync artifact metadata"
      : "Write artifact";
  const outcome = validationSummary.failureCount
    ? "blocked"
    : externalHandoff.state === "ready"
      ? "handoff-ready"
      : "ready";

  return {
    title: `${operation}: ${decision.path}`,
    outcome,
    badge: validationSummary.status,
    primaryAction: outcome === "blocked" ? "review-policy" : "accept-path-policy",
    visibleReasons: validationSummary.failures.length
      ? validationSummary.failures.map((failure) => failure.message)
      : [
          decision.readOnly ? "Path is readable under a read-only artifact prefix." : "Path is inside the artifact root.",
          decision.workspace.readable ? "Path is scoped to the active tenant workspace." : "Path requires tenant workspace review.",
          decision.tenantBoundary.state === "satisfied" ? "Tenant and workspace roots are boundary checked." : "Tenant workspace boundaries require review.",
          decision.permission.allow ? "Actor permissions satisfy the requested artifact operation." : "Actor permissions do not satisfy this operation.",
          syncMetadata.enabled ? "Sync metadata proof can be committed." : "Sync metadata proof is informational only.",
          externalHandoff.state === "ready" ? "External handoff token is available." : "No external handoff is required."
        ],
    affordances: {
      canRead: decision.allow,
      canWrite: decision.allow && decision.access !== "read" && !decision.readOnly,
      canSyncMetadata: syncMetadata.enabled,
      canIssueExternalHandoff: externalHandoff.state === "ready",
      tenantScoped: decision.workspace.readable || decision.workspace.writable
    }
  };
}

function normalizeAcceptedAcknowledgements(input = {}) {
  const acceptanceInput = input.acceptance && typeof input.acceptance === "object"
    ? input.acceptance
    : {};

  return uniqueStrings([
    ...(Array.isArray(input.acceptedAcknowledgements) ? input.acceptedAcknowledgements : []),
    ...(Array.isArray(input.acknowledgedAcceptanceCodes) ? input.acknowledgedAcceptanceCodes : []),
    ...(Array.isArray(acceptanceInput.acknowledgements) ? acceptanceInput.acknowledgements : []),
    ...(Array.isArray(acceptanceInput.acknowledgedCodes) ? acceptanceInput.acknowledgedCodes : [])
  ]).map((code) => normalizeScopeToken(code, "acknowledgement"));
}

function buildAcceptanceAcknowledgementRequirements({ decision, provider, validationSummary, externalHandoff, artifactWritePolicy }) {
  const writeLike = decision.access === "write" || decision.access === "sync";
  const requirements = [
    ...(writeLike ? [{
      code: "write-mutates-artifact-state",
      label: "Acknowledge artifact state change",
      severity: "required",
      reason: "The requested operation can change hosted artifact state.",
      proofReference: artifactWritePolicy.proofReferences.active
    }] : []),
    ...(artifactWritePolicy.payloadProof.declared ? [{
      code: "payload-integrity-declaration",
      label: "Acknowledge payload integrity metadata",
      severity: artifactWritePolicy.payloadProof.integrityState === "verified-declaration" ? "required" : "blocking",
      reason: artifactWritePolicy.payloadProof.integrityState === "verified-declaration"
        ? "The direct-write request depends on the declared payload hash, byte length, and media type."
        : "The payload declaration must be corrected before this artifact write can be accepted.",
      proofReference: artifactWritePolicy.proofReferences.active
    }] : []),
    ...(artifactWritePolicy.quarantine.required ? [{
      code: "quarantine-destination",
      label: "Acknowledge quarantine destination",
      severity: "blocking",
      reason: "The policy selected a quarantine destination instead of a direct artifact write.",
      proofReference: artifactWritePolicy.quarantine.proofReference
    }] : []),
    ...(externalHandoff.requested || provider.mode === "external" ? [{
      code: "external-provider-handoff",
      label: "Acknowledge external provider handoff",
      severity: externalHandoff.state === "ready" ? "required" : "blocking",
      reason: externalHandoff.state === "ready"
        ? "The provider may receive a scoped handoff token for this artifact operation."
        : "External handoff is not ready for this artifact operation.",
      proofReference: decision.pathEvidence.proofReferences.requested
    }] : []),
    ...validationSummary.warnings.map((warning) => ({
      code: `warning-${normalizeScopeToken(warning.code, "warning")}`,
      label: "Acknowledge validation warning",
      severity: "recommended",
      reason: warning.message,
      proofReference: decision.pathEvidence.proofReferences.requested
    }))
  ];

  return requirements.map((requirement) => ({
    ...requirement,
    route: "hosted-kernel.artifact.path-policy.accept",
    command: "artifact.policy.accept"
  }));
}

function buildAcceptanceContract({ decision, provider, validationSummary, externalHandoff, artifactWritePolicy, input }) {
  const acceptedBy = typeof input.acceptedBy === "string" && input.acceptedBy.trim()
    ? input.acceptedBy.trim()
    : null;
  const actorRequired = decision.access !== "read" || provider.mode === "external" || externalHandoff.requested;
  const acknowledgedCodes = normalizeAcceptedAcknowledgements(input);
  const acknowledgementRequirements = buildAcceptanceAcknowledgementRequirements({
    decision,
    provider,
    validationSummary,
    externalHandoff,
    artifactWritePolicy
  });
  const requiredAcknowledgements = acknowledgementRequirements
    .filter((requirement) => requirement.severity === "required")
    .map((requirement) => requirement.code);
  const blockingAcknowledgements = acknowledgementRequirements
    .filter((requirement) => requirement.severity === "blocking")
    .map((requirement) => requirement.code);
  const missingAcknowledgements = requiredAcknowledgements.filter((code) => !acknowledgedCodes.includes(code));
  const accepted = input.accept === true
    && validationSummary.failureCount === 0
    && blockingAcknowledgements.length === 0
    && missingAcknowledgements.length === 0
    && (!actorRequired || acceptedBy !== null);
  const blockedReasons = validationSummary.failures.map((failure) => failure.code);

  if (input.accept === true && actorRequired && !acceptedBy) {
    blockedReasons.push("missing_acceptance_actor");
  }
  for (const code of blockingAcknowledgements) {
    blockedReasons.push(`blocking_acknowledgement:${code}`);
  }
  for (const code of missingAcknowledgements) {
    blockedReasons.push(`missing_acknowledgement:${code}`);
  }

  return {
    required: actorRequired,
    requested: input.accept === true,
    accepted,
    actor: acceptedBy,
    contractVersion: provider.contractVersion,
    acceptedPath: accepted ? decision.path : null,
    acknowledgementRequirements,
    acknowledgedCodes,
    requiredAcknowledgements,
    missingAcknowledgements,
    actionPayload: {
      route: "hosted-kernel.artifact.path-policy.accept",
      command: "artifact.policy.accept",
      acceptedBy,
      acknowledgedCodes,
      pathProofReference: decision.pathEvidence.proofReferences.requested,
      activeProofReference: artifactWritePolicy.proofReferences.active
    },
    blockedReasons
  };
}

function normalizeLeaseMinutes(value) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 1440) : 15;
}

function normalizeProviderServiceEndpoint({ operation, serviceEndpoints, provider }) {
  const base = SERVICE_OPERATION_CONTRACTS[operation];
  const raw = serviceEndpoints[operation];
  const endpointInput = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : {};
  const explicitRoute = typeof raw === "string" && raw.trim()
    ? raw.trim()
    : typeof endpointInput.route === "string" && endpointInput.route.trim()
      ? endpointInput.route.trim()
      : typeof endpointInput.url === "string" && endpointInput.url.trim()
        ? endpointInput.url.trim()
        : null;
  const method = typeof endpointInput.method === "string" && SERVICE_ENDPOINT_METHODS.has(endpointInput.method.toUpperCase())
    ? endpointInput.method.toUpperCase()
    : operation === "read"
      ? "GET"
      : "POST";
  const timeoutMs = Number.isInteger(endpointInput.timeoutMs) && endpointInput.timeoutMs >= 100
    ? Math.min(endpointInput.timeoutMs, 120000)
    : operation === "externalHandoff"
      ? 30000
      : 15000;
  const ackMode = typeof endpointInput.ackMode === "string" && SERVICE_ACK_MODES.has(endpointInput.ackMode)
    ? endpointInput.ackMode
    : provider.mode === "external"
      ? "provider-ack"
      : "kernel-ack";
  const explicitlyBound = explicitRoute !== null;
  const route = explicitRoute || base.route;
  const requiresExplicitBinding = provider.mode === "external";
  const supportsReplay = endpointInput.supportsReplay !== false;
  const violations = [
    ...(requiresExplicitBinding && !explicitlyBound ? [`missing_endpoint:${operation}`] : []),
    ...((operation === "write" || operation === "sync" || operation === "externalHandoff") && !supportsReplay
      ? [`non_replayable_endpoint:${operation}`]
      : []),
    ...(ackMode === "fire-and-forget" && operation !== "read" ? [`ack_required:${operation}`] : [])
  ];

  return {
    schema: "hosted-kernel-artifact-path-policy.provider-service-endpoint.v1",
    operation,
    route,
    method,
    timeoutMs,
    ackMode,
    explicitlyBound,
    supportsReplay,
    requiresExplicitBinding,
    state: violations.length ? "invalid" : "bound",
    violations,
    proof: {
      endpointKey: `${surfaceId}:endpoint:${lightweightHash({
        providerId: provider.id,
        providerMode: provider.mode,
        operation,
        route,
        method,
        ackMode
      })}`,
      generatedBy: surfaceId
    }
  };
}

function normalizeProviderSyncState({ input, generatedAt, provider, syncMetadata }) {
  const syncInput = input.provider && input.provider.syncState && typeof input.provider.syncState === "object"
    ? input.provider.syncState
    : input.syncState && typeof input.syncState === "object"
      ? input.syncState
      : {};
  const lastSyncedAt = syncInput.lastSyncedAt ? toIsoTimestamp(syncInput.lastSyncedAt) : null;
  const observedRevision = typeof syncInput.observedRevision === "string" && syncInput.observedRevision.trim()
    ? syncInput.observedRevision.trim()
    : syncMetadata.revision;
  const watermark = typeof syncInput.watermark === "string" && syncInput.watermark.trim()
    ? syncInput.watermark.trim()
    : observedRevision
      ? `${provider.id}:${observedRevision}`
      : null;
  const maxStalenessMs = Number.isInteger(syncInput.maxStalenessMs) && syncInput.maxStalenessMs >= 1000
    ? Math.min(syncInput.maxStalenessMs, 24 * 60 * 60 * 1000)
    : 5 * 60 * 1000;
  const ageMs = lastSyncedAt ? millisecondsBetween(lastSyncedAt, generatedAt) : null;
  const fresh = ageMs !== null && ageMs <= maxStalenessMs;

  return {
    schema: "hosted-kernel-artifact-path-policy.provider-sync-state.v1",
    clockOwner: syncMetadata.clockOwner,
    observedRevision,
    watermark,
    lastSyncedAt,
    ageMs,
    maxStalenessMs,
    state: !syncMetadata.enabled
      ? "disabled"
      : fresh
        ? "fresh"
        : "stale",
    requiresRefresh: syncMetadata.enabled && !fresh,
    proof: {
      syncStateKey: `${surfaceId}:provider-sync:${lightweightHash({
        providerId: provider.id,
        observedRevision,
        watermark,
        lastSyncedAt,
        maxStalenessMs
      })}`,
      generatedBy: surfaceId
    }
  };
}

function providerContractInput(input = {}) {
  const providerContract = input.provider && input.provider.contract && typeof input.provider.contract === "object"
    ? input.provider.contract
    : {};
  const serviceContract = input.serviceContract && typeof input.serviceContract === "object"
    ? input.serviceContract
    : {};

  return {
    ...providerContract,
    ...serviceContract
  };
}

function normalizeProviderPayloadLimits({ input, provider }) {
  const contractInput = providerContractInput(input);
  const explicitPayload = input.artifact && typeof input.artifact === "object"
    ? input.artifact
    : input.writeArtifact && typeof input.writeArtifact === "object"
      ? input.writeArtifact
      : null;
  const payloadProof = buildPayloadIntegrityProof(explicitPayload);
  const acceptedMediaTypes = uniqueStrings([
    ...DEFAULT_PROVIDER_ACCEPTED_MEDIA_TYPES,
    ...uniqueStrings(provider.acceptedMediaTypes),
    ...uniqueStrings(contractInput.acceptedMediaTypes)
  ])
    .map((mediaType) => {
      const normalized = normalizePayloadMediaType(mediaType);
      if (normalized) return normalized;
      const wildcard = typeof mediaType === "string" && /^[a-z0-9][a-z0-9.+-]*\/\*$/i.test(mediaType.trim())
        ? mediaType.trim().toLowerCase()
        : null;
      return wildcard;
    })
    .filter(Boolean);
  const maxPayloadBytes = Number.isInteger(contractInput.maxPayloadBytes) && contractInput.maxPayloadBytes > 0
    ? Math.min(contractInput.maxPayloadBytes, 1024 * 1024 * 1024)
    : Number.isInteger(provider.maxPayloadBytes) && provider.maxPayloadBytes > 0
      ? Math.min(provider.maxPayloadBytes, 1024 * 1024 * 1024)
      : null;
  const mediaTypeAccepted = !payloadProof.declared
    || payloadProof.mediaType === null
    || acceptedMediaTypes.includes(payloadProof.mediaType)
    || acceptedMediaTypes.some((mediaType) => mediaType.endsWith("/*") && payloadProof.mediaType.startsWith(mediaType.slice(0, -1)));
  const sizeAccepted = !payloadProof.declared
    || maxPayloadBytes === null
    || payloadProof.byteLength === null
    || payloadProof.byteLength <= maxPayloadBytes;

  return {
    schema: "hosted-kernel-artifact-path-policy.provider-payload-limits.v1",
    declared: payloadProof.declared,
    acceptedMediaTypes,
    requestedMediaType: payloadProof.mediaType,
    requestedByteLength: payloadProof.byteLength,
    maxPayloadBytes,
    mediaTypeAccepted,
    sizeAccepted,
    state: mediaTypeAccepted && sizeAccepted ? "satisfied" : "blocked",
    violations: [
      ...(!mediaTypeAccepted ? [`provider_media_type_rejected:${payloadProof.mediaType || "missing"}`] : []),
      ...(!sizeAccepted ? ["provider_payload_too_large"] : [])
    ],
    proof: {
      payloadContractKey: `${surfaceId}:provider-payload:${lightweightHash({
        providerId: provider.id,
        requestedMediaType: payloadProof.mediaType,
        requestedByteLength: payloadProof.byteLength,
        acceptedMediaTypes,
        maxPayloadBytes
      })}`,
      generatedBy: surfaceId
    }
  };
}

function normalizeProviderHandoffRequirements({ input, decision, provider, externalHandoff, requestedProofReference }) {
  const contractInput = providerContractInput(input);
  const handoffInput = contractInput.externalHandoff && typeof contractInput.externalHandoff === "object"
    ? contractInput.externalHandoff
    : input.externalHandoffState && typeof input.externalHandoffState === "object"
      ? input.externalHandoffState
      : {};
  const requestedDeliveryMode = typeof handoffInput.deliveryMode === "string" && handoffInput.deliveryMode.trim()
    ? handoffInput.deliveryMode.trim()
    : provider.mode === "external"
      ? "provider-ticket"
      : "inline-token";
  const deliveryMode = SERVICE_HANDOFF_DELIVERY_MODES.has(requestedDeliveryMode)
    ? requestedDeliveryMode
    : "inline-token";
  const requiresProofReference = handoffInput.requiresProofReference === true
    || provider.mode === "external"
    || externalHandoff.requested;
  const allowedProofScopes = externalHandoff.requested
    ? ["external-redacted", "artifact-root"]
    : ["artifact-root"];
  const proofReferenceReady = !requiresProofReference
    || (requestedProofReference && requestedProofReference.absolutePathExposed === false && allowedProofScopes.includes(requestedProofReference.scope));
  const tenantWorkspaceBound = decision.workspace.tenantId !== null && decision.workspace.workspaceId !== null;
  const violations = [
    ...(!SERVICE_HANDOFF_DELIVERY_MODES.has(requestedDeliveryMode) ? [`unsupported_handoff_delivery:${requestedDeliveryMode}`] : []),
    ...(requiresProofReference && !proofReferenceReady ? ["handoff_proof_reference_not_bound"] : []),
    ...(externalHandoff.requested && !tenantWorkspaceBound ? ["handoff_missing_tenant_workspace"] : [])
  ];

  return {
    schema: "hosted-kernel-artifact-path-policy.provider-handoff-requirements.v1",
    requested: externalHandoff.requested,
    deliveryMode,
    requestedDeliveryMode,
    requiresProofReference,
    proofReferenceReady,
    proofReference: requestedProofReference ? requestedProofReference.reference : null,
    proofScope: requestedProofReference ? requestedProofReference.scope : null,
    allowedProofScopes,
    tenantWorkspaceBound,
    state: violations.length ? "blocked" : externalHandoff.requested ? "ready" : "not-requested",
    violations,
    proof: {
      handoffContractKey: `${surfaceId}:provider-handoff:${lightweightHash({
        providerId: provider.id,
        path: decision.path,
        deliveryMode,
        proofReference: requestedProofReference ? requestedProofReference.reference : null,
        tenantId: decision.workspace.tenantId,
        workspaceId: decision.workspace.workspaceId
      })}`,
      generatedBy: surfaceId
    }
  };
}

function buildProviderServiceContract({ input, generatedAt, decision, provider, syncMetadata, externalHandoff, validationSummary }) {
  const contractInput = providerContractInput(input);
  const requestedOperation = contractInput.operation === "externalHandoff"
    ? "externalHandoff"
    : decision.access;
  const serviceEndpoints = input.provider && input.provider.serviceEndpoints && typeof input.provider.serviceEndpoints === "object"
    ? input.provider.serviceEndpoints
    : {};
  const leaseMinutes = normalizeLeaseMinutes(contractInput.handoffLeaseMinutes);
  const leaseExpiresAt = new Date(new Date(generatedAt).getTime() + leaseMinutes * 60000).toISOString();
  const providerSyncState = normalizeProviderSyncState({ input, generatedAt, provider, syncMetadata });
  const requestedProofReference = repoRelativeProofReferenceDetails(decision.path, normalizePath(input.artifactRoot));
  const providerPayloadLimits = normalizeProviderPayloadLimits({ input, provider });
  const providerHandoffRequirements = normalizeProviderHandoffRequirements({
    input,
    decision,
    provider,
    externalHandoff,
    requestedProofReference
  });
  const operations = Object.fromEntries(
    Object.entries(SERVICE_OPERATION_CONTRACTS).map(([operation, contract]) => {
      const endpoint = normalizeProviderServiceEndpoint({ operation, serviceEndpoints, provider });
      const capabilityAdvertised = provider.capabilities.includes(contract.capability);
      const policyAllowed = operation === "externalHandoff"
        ? externalHandoff.state === "ready"
        : operation === "sync"
          ? syncMetadata.enabled
          : decision.access === operation && decision.allow;
      const syncReady = operation !== "sync" || providerSyncState.state === "fresh";
      const payloadReady = operation !== "write" || providerPayloadLimits.state === "satisfied";
      const handoffReady = operation !== "externalHandoff" || providerHandoffRequirements.state !== "blocked";
      const endpointValid = endpoint.state === "bound";

      return [operation, {
        capability: contract.capability,
        command: contract.command,
        route: endpoint.route,
        endpoint,
        state: capabilityAdvertised && policyAllowed && endpointValid && syncReady && payloadReady && handoffReady
          ? "available"
          : capabilityAdvertised && policyAllowed
            ? "policy-blocked"
            : "unavailable",
        capabilityAdvertised,
        policyAllowed,
        syncReady,
        payloadReady,
        handoffReady,
        endpointValid
      }];
    })
  );
  const requested = operations[requestedOperation] || operations.read;
  const incompatibleReasons = [
    ...(!requested.capabilityAdvertised ? [`missing_capability:${requested.capability}`] : []),
    ...(!requested.policyAllowed ? validationSummary.failures.map((failure) => failure.code) : []),
    ...requested.endpoint.violations,
    ...(requestedOperation === "sync" && providerSyncState.requiresRefresh ? ["sync_state_stale"] : []),
    ...(requestedOperation === "write" ? providerPayloadLimits.violations : []),
    ...(requestedOperation === "externalHandoff" ? providerHandoffRequirements.violations : [])
  ];
  const syncCommit = {
    enabled: syncMetadata.enabled,
    intent: syncMetadata.intent,
    revision: syncMetadata.revision,
    clockOwner: syncMetadata.clockOwner,
    providerState: providerSyncState.state,
    providerWatermark: providerSyncState.watermark,
    refreshRequired: providerSyncState.requiresRefresh,
    writeMode: syncMetadata.enabled ? "commit-proof" : "observe-only",
    proofKey: `${surfaceId}:sync:${lightweightHash({
      providerId: provider.id,
      path: decision.path,
      revision: syncMetadata.revision || "unversioned",
      providerWatermark: providerSyncState.watermark
    })}`
  };

  return {
    schema: "hosted-kernel-artifact-path-policy.provider-service-contract.v1",
    providerId: provider.id,
    providerMode: provider.mode,
    contractVersion: provider.contractVersion,
    requestedOperation,
    negotiation: {
      status: incompatibleReasons.length ? "incompatible" : provider.missingCapabilities.length ? "partial" : "compatible",
      missingCapabilities: provider.missingCapabilities,
      incompatibleReasons
    },
    operations,
    providerSyncState,
    providerPayloadLimits,
    providerHandoffRequirements,
    invocation: {
      command: requested.command,
      route: requested.route,
      method: requested.endpoint.method,
      timeoutMs: requested.endpoint.timeoutMs,
      ackMode: requested.endpoint.ackMode,
      state: incompatibleReasons.length ? "blocked" : "ready",
      idempotencyKey: `${surfaceId}:service:${lightweightHash({
        providerId: provider.id,
        operation: requestedOperation,
        path: decision.path,
        access: decision.access,
        endpointKey: requested.endpoint.proof.endpointKey,
        syncStateKey: providerSyncState.proof.syncStateKey
      })}`
    },
    syncCommit,
    externalHandoffEnvelope: {
      requested: externalHandoff.requested,
      state: externalHandoff.state,
      token: externalHandoff.token,
      leaseMinutes,
      expiresAt: externalHandoff.state === "ready" ? leaseExpiresAt : null,
      deliveryMode: providerHandoffRequirements.deliveryMode,
      proofReference: providerHandoffRequirements.proofReference,
      proofReferenceReady: providerHandoffRequirements.proofReferenceReady,
      subject: externalHandoff.state === "ready"
        ? {
            path: decision.path,
            tenantId: decision.workspace.tenantId,
            workspaceId: decision.workspace.workspaceId,
            actorId: decision.permission.actorId
          }
        : null
    }
  };
}

function buildReadiness({ decision, provider, syncMetadata, externalHandoff, acceptance, validationSummary, lifecycleControls, serviceContract, mutationPreconditions, dependencyHealth, artifactWritePolicy }) {
  const ready = validationSummary.failureCount === 0
    && provider.missingCapabilities.length === 0
    && (!acceptance.required || acceptance.accepted)
    && (!externalHandoff.requested || externalHandoff.state === "ready")
    && lifecycleControls.validation.violations.length === 0
    && mutationPreconditions.violations.length === 0
    && artifactWritePolicy.validation.violations.length === 0
    && dependencyHealth.blocking.length === 0
    && serviceContract.invocation.state === "ready";

  return {
    state: ready
      ? "ready"
      : validationSummary.failureCount || serviceContract.invocation.state !== "ready"
        ? "blocked"
        : "waiting-for-acceptance",
    ready,
    gates: {
      policyDecision: decision.allow || externalHandoff.state === "ready",
      pathEvidence: decision.pathEvidence.risk.blockingViolations.length === 0,
      tenantBoundary: decision.tenantBoundary.state === "satisfied",
      workspaceBoundary: !decision.violations.includes("outside_workspace_scope"),
      actorPermissions: decision.permission.missing.length === 0,
      actorScope: decision.permission.scope.allow,
      providerCapabilities: provider.missingCapabilities.length === 0,
      userAcceptance: !acceptance.required || acceptance.accepted,
      syncProof: decision.access === "read" || syncMetadata.enabled,
      handoff: !externalHandoff.requested || externalHandoff.state === "ready",
      lifecycleControls: lifecycleControls.validation.violations.length === 0,
      mutationPreconditions: mutationPreconditions.violations.length === 0,
      artifactWritePolicy: artifactWritePolicy.validation.violations.length === 0,
      dependencyHealth: dependencyHealth.blocking.length === 0,
      providerServiceContract: serviceContract.invocation.state === "ready"
    }
  };
}

function normalizeRetryPolicy(input = {}) {
  const retryInput = input.retryPolicy && typeof input.retryPolicy === "object" ? input.retryPolicy : {};
  const maxAttempts = Number.isInteger(retryInput.maxAttempts) && retryInput.maxAttempts >= 0
    ? Math.min(retryInput.maxAttempts, 10)
    : DEFAULT_RETRY_POLICY.maxAttempts;
  const initialDelayMs = Number.isInteger(retryInput.initialDelayMs) && retryInput.initialDelayMs >= 0
    ? Math.min(retryInput.initialDelayMs, 60000)
    : DEFAULT_RETRY_POLICY.initialDelayMs;
  const maxDelayMs = Number.isInteger(retryInput.maxDelayMs) && retryInput.maxDelayMs >= initialDelayMs
    ? Math.min(retryInput.maxDelayMs, 300000)
    : DEFAULT_RETRY_POLICY.maxDelayMs;
  const multiplier = typeof retryInput.multiplier === "number" && Number.isFinite(retryInput.multiplier) && retryInput.multiplier >= 1
    ? Math.min(retryInput.multiplier, 5)
    : DEFAULT_RETRY_POLICY.multiplier;

  return {
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
    multiplier
  };
}

function retryClassForFailure(code) {
  if (code.startsWith("dependency_failed:")) return "dependency-retry";
  if (code.startsWith("missing_capability:")) return "provider-config";
  if (code.startsWith("missing_permission:")) return "permission-grant";
  if (code.startsWith("actor_") && code.endsWith("_scope_mismatch")) return "permission-grant";
  if (code.startsWith("write_payload_")) return "payload-correction";
  if (code.startsWith("path_")) return "input-correction";
  if (code === "outside_artifact_root" || code === "outside_workspace_scope" || code.startsWith("denied_segment:")) {
    return "input-correction";
  }
  if (code === "readonly_prefix") return "input-correction";
  return "operator-review";
}

function buildActionableError(failure) {
  const retryClass = retryClassForFailure(failure.code);
  const commands = {
    "dependency-retry": "hosted-kernel.health.retry",
    "provider-config": "provider.select",
    "permission-grant": "artifact.permission.request",
    "payload-correction": "artifact.payload.edit",
    "input-correction": "artifact.path.edit",
    "operator-review": "artifact.policy.review"
  };

  return {
    code: failure.code,
    target: failure.target,
    message: failure.message,
    retryClass,
    retryable: retryClass === "dependency-retry" || retryClass === "provider-config" || retryClass === "permission-grant",
    action: {
      command: commands[retryClass],
      label: retryClass === "dependency-retry"
        ? "Retry hosted-kernel dependency health checks"
        : retryClass === "provider-config"
        ? "Choose a provider with artifact path-policy capabilities"
        : retryClass === "permission-grant"
          ? "Request the missing artifact permission"
          : retryClass === "payload-correction"
            ? "Update artifact payload integrity metadata"
          : retryClass === "input-correction"
            ? "Edit the artifact path or requested access"
            : "Review the artifact path policy state"
    }
  };
}

function buildOperationalHealth({ input, decision, provider, syncMetadata, externalHandoff, acceptance, readiness, validationSummary, dependencyHealth, generatedAt }) {
  const retryPolicy = normalizeRetryPolicy(input);
  const previousAttempts = Number.isInteger(input.retryAttempt) && input.retryAttempt >= 0
    ? Math.min(input.retryAttempt, retryPolicy.maxAttempts)
    : 0;
  const actionableErrors = validationSummary.failures.map(buildActionableError);
  const retryableErrors = actionableErrors.filter((error) => error.retryable);
  const permanentErrors = actionableErrors.filter((error) => !error.retryable);
  const softDegradations = [
    ...(!syncMetadata.enabled && decision.allow ? [{
      code: "sync_metadata_degraded",
      target: "syncMetadata",
      message: "Artifact access can proceed, but sync metadata proof will remain observational until a sync-capable provider is selected."
    }] : []),
    ...(externalHandoff.requested && externalHandoff.state !== "ready" && decision.allow ? [{
      code: "external_handoff_degraded",
      target: "externalHandoff",
      message: "Hosted-kernel access is valid, but external handoff is unavailable for this request."
    }] : []),
    ...dependencyHealth.degraded.map((dependency) => ({
      code: `dependency_degraded:${dependency.name}`,
      target: "dependencyHealth",
      message: dependency.message
        || `Hosted-kernel dependency ${dependency.name} is degraded; continuing requires degraded-mode handling.`
    }))
  ];
  const hardProviderOutage = provider.missingCapabilities.length === KERNEL_REQUIRED_CAPABILITIES.length;
  const hardDependencyOutage = dependencyHealth.blocking.length > 0;
  const degraded = softDegradations.length > 0
    || (provider.missingCapabilities.length > 0 && decision.allow)
    || dependencyHealth.state === "degraded";
  const failureState = readiness.ready
    ? "none"
    : permanentErrors.length
      ? "terminal"
      : retryableErrors.length
        ? previousAttempts >= retryPolicy.maxAttempts
          ? "exhausted"
          : "retryable"
        : acceptance.required && !acceptance.accepted
          ? "waiting-for-user"
          : degraded
            ? "degraded"
            : "operator-review";
  const nextDelayMs = failureState === "retryable"
    ? Math.min(
        retryPolicy.maxDelayMs,
        Math.round(retryPolicy.initialDelayMs * retryPolicy.multiplier ** previousAttempts)
      )
    : null;
  const operationMode = readiness.ready
    ? "normal"
    : hardProviderOutage
      ? "provider-offline"
      : hardDependencyOutage
        ? "dependency-down"
      : degraded
        ? "degraded"
        : "blocked";

  return {
    checkedAt: generatedAt,
    status: readiness.ready ? "healthy" : degraded && !permanentErrors.length ? "degraded" : "unhealthy",
    operationMode,
    failureState,
    retry: {
      supported: retryableErrors.length > 0 && permanentErrors.length === 0,
      attempt: previousAttempts,
      maxAttempts: retryPolicy.maxAttempts,
      nextDelayMs,
      exhausted: failureState === "exhausted",
      backoff: retryPolicy
    },
    degraded: {
      active: degraded,
      allowed: dependencyHealth.degradedMode.allowed && !hardDependencyOutage,
      readOnlyRecommended: dependencyHealth.degradedMode.readOnlyRecommended,
      reasons: softDegradations,
      dependencyReasonCodes: dependencyHealth.degradedMode.reasonCodes
    },
    dependencies: {
      state: dependencyHealth.state,
      blocking: dependencyHealth.blocking.map((dependency) => dependency.name),
      degraded: dependencyHealth.degraded.map((dependency) => dependency.name),
      policy: dependencyHealth.policy
    },
    actionableErrors,
    proof: {
      providerId: provider.id,
      providerMode: provider.mode,
      missingCapabilities: provider.missingCapabilities,
      pathAllowed: decision.allow,
      readinessState: readiness.state,
      acceptanceAccepted: acceptance.accepted,
      syncMetadataEnabled: syncMetadata.enabled,
      externalHandoffState: externalHandoff.state,
      dependencyState: dependencyHealth.state,
      dependencyHash: dependencyHealth.proof.dependencyHash
    }
  };
}

function normalizeCommandOutcome(input, { commandKey, decision, artifactWritePolicy, revision, generatedAt }) {
  const outcomeInput = input.commandOutcome && typeof input.commandOutcome === "object"
    ? input.commandOutcome
    : input.commandResult && typeof input.commandResult === "object"
      ? input.commandResult
      : {};
  const supplied = Object.keys(outcomeInput).length > 0;
  const outcomeCommandKey = typeof outcomeInput.commandKey === "string" && outcomeInput.commandKey.trim()
    ? outcomeInput.commandKey.trim()
    : null;
  const status = ["committed", "failed", "aborted"].includes(outcomeInput.status)
    ? outcomeInput.status
    : outcomeInput.committed === true
      ? "committed"
      : outcomeInput.failed === true
        ? "failed"
        : null;
  const finalizedAt = outcomeInput.finalizedAt ? toIsoTimestamp(outcomeInput.finalizedAt) : generatedAt;
  const committedPath = typeof outcomeInput.path === "string"
    ? normalizePath(outcomeInput.path)
    : typeof outcomeInput.activePath === "string"
      ? normalizePath(outcomeInput.activePath)
      : artifactWritePolicy.activePath;
  const expectedCommitPath = artifactWritePolicy.writeLike
    ? artifactWritePolicy.activePath
    : decision.path;
  const resultRevision = typeof outcomeInput.revision === "string" && outcomeInput.revision.trim()
    ? outcomeInput.revision.trim()
    : typeof outcomeInput.resultRevision === "string" && outcomeInput.resultRevision.trim()
      ? outcomeInput.resultRevision.trim()
      : revision;
  const providerReceipt = typeof outcomeInput.providerReceipt === "string" && outcomeInput.providerReceipt.trim()
    ? outcomeInput.providerReceipt.trim()
    : typeof outcomeInput.receipt === "string" && outcomeInput.receipt.trim()
      ? outcomeInput.receipt.trim()
      : null;
  const applied = Boolean(supplied && status && (!outcomeCommandKey || outcomeCommandKey === commandKey));
  const mismatchReasons = [
    ...(supplied && outcomeCommandKey && outcomeCommandKey !== commandKey ? ["outcome_command_key_mismatch"] : []),
    ...(applied && committedPath !== expectedCommitPath ? ["outcome_path_mismatch"] : [])
  ];
  const terminalStatus = !applied || mismatchReasons.length
    ? null
    : status === "committed"
      ? "committed"
      : "blocked";
  const durableStatus = mismatchReasons.length
    ? "outcome-mismatch"
    : !applied
      ? "ignored-outcome"
      : status === "committed"
        ? "committed"
        : `terminal-${status}`;

  return {
    schema: "hosted-kernel-artifact-path-policy.command-outcome.v1",
    supplied,
    applied,
    commandKey: outcomeCommandKey || commandKey,
    status,
    terminalStatus,
    durableStatus,
    finalizedAt,
    committedPath,
    expectedCommitPath,
    resultRevision,
    providerReceipt,
    mismatchReasons,
    proofReference: repoRelativeProofReference(committedPath, normalizePath(input.artifactRoot)),
    proof: {
      outcomeKey: `${surfaceId}:outcome:${lightweightHash({
        commandKey,
        outcomeCommandKey,
        status,
        committedPath,
        expectedCommitPath,
        resultRevision,
        providerReceipt,
        mismatchReasons
      })}`,
      generatedBy: surfaceId
    }
  };
}

function buildPersistenceContract({ input, generatedAt, decision, provider, syncMetadata, externalHandoff, acceptance, readiness, serviceContract, operationalHealth, artifactWritePolicy }) {
  const persistedState = normalizePersistedState(input.persistedState);
  const recoveryPolicy = normalizeCommandRecoveryPolicy(input);
  const revision = syncMetadata.revision || input.revision || "unversioned";
  const commandBasis = {
    surfaceId,
    providerId: provider.id,
    tenantId: decision.workspace.tenantId,
    workspaceId: decision.workspace.workspaceId,
    actorId: decision.permission.actorId,
    path: decision.path,
    access: decision.access,
    revision,
    acceptActor: acceptance.actor,
    externalHandoff: externalHandoff.requested
  };
  const commandKey = typeof input.commandKey === "string" && input.commandKey.trim()
    ? input.commandKey.trim()
    : `${surfaceId}:${lightweightHash(commandBasis)}`;
  const commandOutcome = normalizeCommandOutcome(input, {
    commandKey,
    decision,
    artifactWritePolicy,
    revision,
    generatedAt
  });
  const previousEntry = persistedState.commandLog.find((entry) => entry.commandKey === commandKey) || null;
  const previousDecision = persistedState.lastDecision;
  const previousAgeMs = previousEntry
    ? millisecondsBetween(previousEntry.preparedAt || previousEntry.recordedAt, generatedAt)
    : null;
  const sameDecision = Boolean(previousDecision
    && previousDecision.path === decision.path
    && previousDecision.access === decision.access
    && previousDecision.revision === revision
    && previousDecision.tenantId === decision.workspace.tenantId
    && previousDecision.workspaceId === decision.workspace.workspaceId);
  const restartDetected = Boolean(persistedState.bootId && input.bootId && persistedState.bootId !== input.bootId);
  const replayedTerminalCommand = previousEntry && ["committed", "blocked"].includes(previousEntry.status);
  const previousPreparedCommand = Boolean(previousEntry && !replayedTerminalCommand);
  const stalePreparedCommand = Boolean(previousPreparedCommand
    && previousAgeMs !== null
    && previousAgeMs > recoveryPolicy.preparedTtlMs);
  const exhaustedRecovery = previousPreparedCommand
    && previousEntry.recoveryAttempt >= recoveryPolicy.maxRecoveryAttempts;
  const orphanedPreparedCommand = Boolean(previousPreparedCommand && restartDetected && !sameDecision);
  const recoveredPreparedCommand = Boolean(previousPreparedCommand
    && restartDetected
    && sameDecision
    && !stalePreparedCommand
    && !exhaustedRecovery);
  const terminalOutcomeApplied = commandOutcome.applied && commandOutcome.terminalStatus !== null;
  const commandOutcomeMismatch = commandOutcome.supplied && commandOutcome.mismatchReasons.length > 0;
  const commandStatus = terminalOutcomeApplied
    ? commandOutcome.terminalStatus
    : commandOutcomeMismatch
      ? "blocked"
    : replayedTerminalCommand
    ? previousEntry.status
    : orphanedPreparedCommand
      ? "orphaned-prepared"
      : stalePreparedCommand || exhaustedRecovery
        ? "stale-prepared"
        : recoveredPreparedCommand
          ? "recovered"
          : readiness.ready
            ? "prepared"
            : readiness.state === "blocked"
              ? "blocked"
              : "waiting";
  let recoveryAction = "record-new-decision";
  if (terminalOutcomeApplied) {
    recoveryAction = commandOutcome.status === "committed"
      ? "finalize-committed-command"
      : `finalize-${commandOutcome.status}-command`;
  } else if (commandOutcomeMismatch) {
    recoveryAction = "reject-command-outcome-mismatch";
  } else if (replayedTerminalCommand) {
    recoveryAction = "return-persisted-outcome";
  } else if (orphanedPreparedCommand) {
    recoveryAction = "quarantine-orphaned-prepared-command";
  } else if (stalePreparedCommand) {
    recoveryAction = "expire-stale-prepared-command";
  } else if (exhaustedRecovery) {
    recoveryAction = "escalate-recovery-attempts-exhausted";
  } else if (recoveredPreparedCommand) {
    recoveryAction = "recover-prepared-command";
  } else if (restartDetected && sameDecision) {
    recoveryAction = "resume-current-decision";
  } else if (restartDetected) {
    recoveryAction = "revalidate-after-restart";
  } else if (sameDecision) {
    recoveryAction = "dedupe-current-decision";
  }

  let durableStatus = "awaiting-input";
  if (terminalOutcomeApplied) {
    durableStatus = commandOutcome.durableStatus;
  } else if (commandOutcomeMismatch) {
    durableStatus = commandOutcome.durableStatus;
  } else if (replayedTerminalCommand) {
    durableStatus = "replayed";
  } else if (orphanedPreparedCommand) {
    durableStatus = "orphaned-prepared";
  } else if (stalePreparedCommand || exhaustedRecovery) {
    durableStatus = "stale-prepared";
  } else if (recoveredPreparedCommand) {
    durableStatus = "recovered-prepared";
  } else if (readiness.ready) {
    durableStatus = "write-pending";
  } else if (readiness.state === "blocked") {
    durableStatus = "blocked-persistable";
  }
  const idempotentReplay = Boolean(terminalOutcomeApplied || replayedTerminalCommand || recoveredPreparedCommand || sameDecision);
  const nextRecoveryAttempt = recoveredPreparedCommand || stalePreparedCommand || orphanedPreparedCommand || exhaustedRecovery
    ? previousEntry.recoveryAttempt + 1
    : 0;
  const nextGeneration = persistedState.generation + (idempotentReplay ? 0 : 1);
  const receiptStatus = terminalOutcomeApplied
    ? commandOutcome.status === "committed"
      ? "committed"
      : "blocked"
    : commandOutcomeMismatch
      ? "blocked"
    : replayedTerminalCommand
    ? "replayed"
    : recoveredPreparedCommand
      ? "recovered"
      : orphanedPreparedCommand
        ? "orphaned"
        : stalePreparedCommand || exhaustedRecovery
          ? "stale"
          : readiness.ready
            ? "ready"
            : readiness.state === "blocked"
              ? "blocked"
              : "waiting";
  const previousReceipt = persistedState.commandReceipts.find((entry) => entry.commandKey === commandKey) || null;
  const commandRoute = serviceContract && serviceContract.invocation
    ? serviceContract.invocation.route
    : decision.access === "read"
      ? SERVICE_OPERATION_CONTRACTS.read.route
      : SERVICE_OPERATION_CONTRACTS.write.route;
  const commandName = serviceContract && serviceContract.invocation
    ? serviceContract.invocation.command
    : decision.access === "read"
      ? "artifact.open"
      : "artifact.commit";
  const receiptKey = previousReceipt && idempotentReplay
    ? previousReceipt.receiptKey
    : `${surfaceId}:receipt:${lightweightHash({
        commandKey,
        receiptStatus,
        durableStatus,
        route: commandRoute,
        generation: nextGeneration,
        recoveryAttempt: nextRecoveryAttempt
      })}`;
  const currentReceipt = {
    receiptKey,
    commandKey,
    status: receiptStatus,
    durableStatus,
    route: commandRoute,
    command: commandName,
    path: terminalOutcomeApplied ? commandOutcome.committedPath : decision.path,
    revision: terminalOutcomeApplied ? commandOutcome.resultRevision : revision,
    generation: nextGeneration,
    recordedAt: generatedAt,
    finalizedAt: terminalOutcomeApplied
      ? commandOutcome.finalizedAt
      : receiptStatus === "blocked" || receiptStatus === "replayed" || receiptStatus === "stale" || receiptStatus === "orphaned"
      ? generatedAt
      : null,
    replayCount: previousReceipt && idempotentReplay ? previousReceipt.replayCount + 1 : 0
  };
  const quarantinedCommands = [
    ...persistedState.recoveryCheckpoint.quarantinedCommands,
    ...(orphanedPreparedCommand || stalePreparedCommand || exhaustedRecovery
      ? [{
          commandKey: previousEntry.commandKey,
          reason: orphanedPreparedCommand
            ? "restart-changed-decision"
            : exhaustedRecovery
              ? "recovery-attempts-exhausted"
              : "prepared-command-expired",
          path: previousEntry.path,
          revision: previousEntry.revision,
          recordedAt: generatedAt
        }]
      : [])
  ].slice(-recoveryPolicy.quarantineRetainedCommands);
  const shapedState = {
    version: PERSISTED_STATE_VERSION,
    bootId: typeof input.bootId === "string" && input.bootId.trim() ? input.bootId.trim() : persistedState.bootId,
    generation: nextGeneration,
    lastDecision: {
      path: decision.path,
      access: decision.access,
      allow: decision.allow,
      revision,
      commandKey,
      tenantId: decision.workspace.tenantId,
      workspaceId: decision.workspace.workspaceId,
      actorId: decision.permission.actorId,
      recordedAt: generatedAt
    },
    recoveryCheckpoint: {
      recoveredCommandKey: recoveredPreparedCommand ? commandKey : persistedState.recoveryCheckpoint.recoveredCommandKey,
      recoveryAttempt: nextRecoveryAttempt,
      lastRecoveryAction: recoveryAction,
      lastRecoveryAt: terminalOutcomeApplied || restartDetected || previousPreparedCommand ? generatedAt : persistedState.recoveryCheckpoint.lastRecoveryAt,
      quarantinedCommands
    },
    commandReceipts: [
      ...persistedState.commandReceipts.filter((entry) => entry.commandKey !== commandKey).slice(-24),
      currentReceipt
    ],
    recoveryDispatch: {
      schema: "hosted-kernel-artifact-path-policy.recovery-dispatch.v1",
      commandKey,
      receiptKey,
      action: recoveryAction,
      status: receiptStatus,
      route: commandRoute,
      command: commandName,
      idempotentReplay,
      outcome: {
        supplied: commandOutcome.supplied,
        applied: commandOutcome.applied,
        status: commandOutcome.status,
        durableStatus: commandOutcome.durableStatus,
        mismatchReasons: commandOutcome.mismatchReasons,
        providerReceipt: commandOutcome.providerReceipt
      },
      operatorActionRequired: commandOutcome.mismatchReasons.length > 0 || orphanedPreparedCommand || stalePreparedCommand || exhaustedRecovery,
      nextAttemptAllowed: nextRecoveryAttempt < recoveryPolicy.maxRecoveryAttempts,
      restartSafe: terminalOutcomeApplied || (!orphanedPreparedCommand && !stalePreparedCommand && !exhaustedRecovery && commandOutcome.mismatchReasons.length === 0)
    },
    commandLog: [
      ...persistedState.commandLog.filter((entry) => entry.commandKey !== commandKey).slice(-19),
      {
        commandKey,
        command: commandName,
        status: commandStatus,
        outcome: terminalOutcomeApplied ? commandOutcome.status : readiness.ready ? "ready" : readiness.state,
        path: terminalOutcomeApplied ? commandOutcome.committedPath : decision.path,
        revision: terminalOutcomeApplied ? commandOutcome.resultRevision : revision,
        tenantId: decision.workspace.tenantId,
        workspaceId: decision.workspace.workspaceId,
        recordedAt: generatedAt,
        preparedAt: previousEntry && previousEntry.preparedAt ? previousEntry.preparedAt : generatedAt,
        terminalAt: commandStatus === "committed" || commandStatus === "blocked" ? commandOutcome.finalizedAt : null,
        recoveryAttempt: nextRecoveryAttempt
      }
    ]
  };

  return {
    version: PERSISTED_STATE_VERSION,
    commandKey,
    idempotent: idempotentReplay,
    restartDetected,
    recoveryAction,
    durableStatus,
    receipt: currentReceipt,
    restartStatus: {
      schema: "hosted-kernel-artifact-path-policy.restart-status.v1",
      state: receiptStatus,
      commandKey,
      receiptKey,
      route: commandRoute,
      command: commandName,
      replaySafe: idempotentReplay || readiness.ready,
      writeSafe: readiness.ready && !terminalOutcomeApplied && !orphanedPreparedCommand && !stalePreparedCommand && !exhaustedRecovery,
      restartDetected,
      idempotentReplay,
      terminalOutcomeApplied,
      healthStatus: operationalHealth ? operationalHealth.status : null,
      recoveryAction,
      operatorActionRequired: commandOutcome.mismatchReasons.length > 0 || orphanedPreparedCommand || stalePreparedCommand || exhaustedRecovery,
      proof: {
        receiptHash: lightweightHash(currentReceipt),
        previousReceiptKey: previousReceipt ? previousReceipt.receiptKey : null,
        generation: nextGeneration,
        generatedBy: surfaceId
      }
    },
    commandState: {
      status: commandStatus,
      terminal: Boolean(terminalOutcomeApplied || replayedTerminalCommand || commandStatus === "blocked"),
      replayed: Boolean(replayedTerminalCommand),
      recovered: recoveredPreparedCommand,
      finalized: terminalOutcomeApplied,
      stale: stalePreparedCommand || exhaustedRecovery,
      orphaned: orphanedPreparedCommand,
      ageMs: previousAgeMs,
      recoveryAttempt: nextRecoveryAttempt,
      maxRecoveryAttempts: recoveryPolicy.maxRecoveryAttempts
    },
    previous: {
      commandStatus: previousEntry ? previousEntry.status : null,
      commandAgeMs: previousAgeMs,
      generation: persistedState.generation,
      sameDecision,
      preparedCommand: previousPreparedCommand
    },
    commandOutcome,
    write: {
      required: !replayedTerminalCommand && !terminalOutcomeApplied,
      reason: replayedTerminalCommand
        ? "terminal-command-already-persisted"
        : terminalOutcomeApplied
          ? "terminal-command-outcome-finalized"
          : recoveryAction,
      state: shapedState,
      receipt: currentReceipt,
      dispatch: shapedState.recoveryDispatch
    },
    recovery: {
      policy: recoveryPolicy,
      checkpoint: shapedState.recoveryCheckpoint,
      dispatch: shapedState.recoveryDispatch,
      restartSafe: terminalOutcomeApplied || (!orphanedPreparedCommand && !stalePreparedCommand && !exhaustedRecovery && commandOutcome.mismatchReasons.length === 0),
      operatorActionRequired: commandOutcome.mismatchReasons.length > 0 || orphanedPreparedCommand || stalePreparedCommand || exhaustedRecovery
    }
  };
}

function buildNextSteps({ decision, provider, validationSummary, acceptance, readiness, lifecycleControls, serviceContract }) {
  if (readiness.ready) {
    return [{
      id: "continue-artifact-operation",
      label: "Continue artifact operation",
      reason: "Policy, provider capabilities, and acceptance gates are satisfied.",
      command: decision.access === "read" ? "artifact.open" : "artifact.commit"
    }];
  }

  const steps = validationSummary.failures.filter((failure) => failure.target !== "lifecycle").map((failure) => ({
    id: `resolve-${failure.code.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    label: failure.target === "dependencyHealth"
      ? "Retry dependency health"
      : failure.target === "provider"
      ? "Select compatible provider"
      : failure.code.startsWith("missing_permission:")
        ? "Request artifact permission"
        : failure.code.startsWith("write_payload_")
          ? "Update payload metadata"
        : "Adjust artifact path",
    reason: failure.message,
    command: failure.target === "dependencyHealth"
      ? "hosted-kernel.health.retry"
      : failure.target === "provider"
      ? "provider.select"
      : failure.code.startsWith("missing_permission:")
        ? "artifact.permission.request"
        : failure.code.startsWith("write_payload_")
          ? "artifact.payload.edit"
        : "artifact.path.edit"
  }));

  if (provider.missingCapabilities.length === 0 && acceptance.required && !acceptance.accepted) {
    steps.push({
      id: "accept-path-policy",
      label: "Accept path policy",
      reason: "This operation changes hosted artifact state and requires an explicit acceptance event.",
      command: "artifact.policy.accept"
    });
  }

  if (serviceContract.invocation.state !== "ready") {
    const endpointReasons = serviceContract.negotiation.incompatibleReasons
      .filter((reason) => reason.startsWith("missing_endpoint:") || reason.startsWith("non_replayable_endpoint:") || reason.startsWith("ack_required:"));
    const needsSyncRefresh = serviceContract.negotiation.incompatibleReasons.includes("sync_state_stale");
    const payloadContractReasons = serviceContract.negotiation.incompatibleReasons
      .filter((reason) => reason.startsWith("provider_media_type_rejected:") || reason === "provider_payload_too_large");
    const handoffContractReasons = serviceContract.negotiation.incompatibleReasons
      .filter((reason) => reason.startsWith("unsupported_handoff_delivery:")
        || reason === "handoff_proof_reference_not_bound"
        || reason === "handoff_missing_tenant_workspace");

    if (endpointReasons.length) {
      steps.push({
        id: "configure-provider-service-endpoint",
        label: "Configure provider endpoint",
        reason: endpointReasons.join(", "),
        command: "provider.service.configure"
      });
    }

    if (needsSyncRefresh) {
      steps.push({
        id: "refresh-provider-sync-state",
        label: "Refresh provider sync state",
        reason: "Provider sync state is stale for the requested metadata operation.",
        command: "artifact.metadata.sync.refresh"
      });
    }

    if (payloadContractReasons.length) {
      steps.push({
        id: "adjust-provider-payload-contract",
        label: "Adjust provider payload contract",
        reason: payloadContractReasons.join(", "),
        command: "provider.payload.configure"
      });
    }

    if (handoffContractReasons.length) {
      steps.push({
        id: "configure-provider-handoff-contract",
        label: "Configure provider handoff",
        reason: handoffContractReasons.join(", "),
        command: "provider.handoff.configure"
      });
    }
  }

  if (lifecycleControls.validation.violations.length) {
    steps.push({
      id: lifecycleControls.nextAction,
      label: lifecycleControls.nextAction === "enable-lifecycle"
        ? "Enable lifecycle controls"
        : lifecycleControls.nextAction === "select-supported-lifecycle-command"
          ? "Select lifecycle command"
        : lifecycleControls.nextAction === "resume-lifecycle"
          ? "Resume lifecycle commands"
            : lifecycleControls.nextAction === "enable-scheduling"
              ? "Enable lifecycle scheduling"
            : lifecycleControls.nextAction === "fix-next-run"
              ? "Fix next lifecycle run"
            : lifecycleControls.nextAction === "set-next-run"
              ? "Set next lifecycle run"
              : lifecycleControls.nextAction === "wait-for-scheduled-run"
                ? "Wait for scheduled run"
              : "Wait for maintenance window",
      reason: lifecycleControls.validation.violations.join(", "),
      command: lifecycleControls.nextAction === "enable-lifecycle"
        ? "artifact.lifecycle.enable"
        : lifecycleControls.nextAction === "select-supported-lifecycle-command"
          ? "artifact.lifecycle.command.select"
        : lifecycleControls.nextAction === "resume-lifecycle"
          ? "artifact.lifecycle.resume"
        : lifecycleControls.nextAction === "enable-scheduling"
          ? "artifact.lifecycle.schedule.enable"
        : lifecycleControls.nextAction === "fix-next-run"
          ? "artifact.lifecycle.schedule.fix"
        : lifecycleControls.nextAction === "set-next-run"
          ? "artifact.lifecycle.schedule"
          : lifecycleControls.nextAction === "wait-for-scheduled-run"
            ? "artifact.lifecycle.wait-scheduled-run"
          : "artifact.lifecycle.wait"
    });
  }

  return steps;
}

function normalizeClientRequestState(input = {}) {
  const stateInput = input.clientRequestState && typeof input.clientRequestState === "object"
    ? input.clientRequestState
    : input.requestState && typeof input.requestState === "object"
      ? input.requestState
      : input.clientState && typeof input.clientState === "object"
        ? input.clientState
        : {};
  const requestId = typeof stateInput.requestId === "string" && stateInput.requestId.trim()
    ? normalizeScopeToken(stateInput.requestId, "request")
    : typeof input.requestId === "string" && input.requestId.trim()
      ? normalizeScopeToken(input.requestId, "request")
      : null;
  const uiSessionId = typeof stateInput.uiSessionId === "string" && stateInput.uiSessionId.trim()
    ? normalizeScopeToken(stateInput.uiSessionId, "ui-session")
    : typeof stateInput.sessionId === "string" && stateInput.sessionId.trim()
      ? normalizeScopeToken(stateInput.sessionId, "ui-session")
      : null;
  const continuationToken = typeof stateInput.continuationToken === "string" && stateInput.continuationToken.trim()
    ? stateInput.continuationToken.trim()
    : typeof input.continuationToken === "string" && input.continuationToken.trim()
      ? input.continuationToken.trim()
      : null;
  const selectedStepId = typeof stateInput.selectedStepId === "string" && stateInput.selectedStepId.trim()
    ? stateInput.selectedStepId.trim()
    : typeof input.selectedStepId === "string" && input.selectedStepId.trim()
      ? input.selectedStepId.trim()
      : null;
  const mode = ["inline", "modal", "external"].includes(stateInput.handoffMode)
    ? stateInput.handoffMode
      : input.externalHandoff === true
        ? "external"
        : "inline";
  const requestedAction = ["continue", "review", "accept", "remediate", "retry", "handoff"].includes(stateInput.requestedAction)
    ? stateInput.requestedAction
    : ["continue", "review", "accept", "remediate", "retry", "handoff"].includes(input.requestedAction)
      ? input.requestedAction
      : null;
  const clientRouteIntent = typeof stateInput.routeIntent === "string" && stateInput.routeIntent.trim()
    ? normalizeScopeToken(stateInput.routeIntent, "route-intent")
    : typeof input.routeIntent === "string" && input.routeIntent.trim()
      ? normalizeScopeToken(input.routeIntent, "route-intent")
      : null;
  const lastKnownCommandKey = typeof stateInput.lastKnownCommandKey === "string" && stateInput.lastKnownCommandKey.trim()
    ? stateInput.lastKnownCommandKey.trim()
    : typeof input.lastKnownCommandKey === "string" && input.lastKnownCommandKey.trim()
      ? input.lastKnownCommandKey.trim()
      : null;
  const optimisticContinuation = stateInput.optimisticContinuation === true || input.optimisticContinuation === true;

  return {
    schema: "hosted-kernel-artifact-path-policy.client-request-state.v1",
    requestId,
    uiSessionId,
    continuationToken,
    selectedStepId,
    handoffMode: mode,
    requestedAction,
    routeIntent: clientRouteIntent,
    lastKnownCommandKey,
    optimisticContinuation,
    lastRoute: typeof stateInput.lastRoute === "string" && stateInput.lastRoute.trim()
      ? stateInput.lastRoute.trim()
      : null,
    acknowledgedWarnings: uniqueStrings(stateInput.acknowledgedWarnings),
    source: Object.keys(stateInput).length ? "client-supplied" : "kernel-derived"
  };
}

function normalizeClientRuntimeContract(input = {}) {
  const runtimeInput = input.clientRuntime && typeof input.clientRuntime === "object"
    ? input.clientRuntime
    : input.runtime && typeof input.runtime === "object"
      ? input.runtime
      : {};
  const protocolVersion = typeof runtimeInput.protocolVersion === "string" && runtimeInput.protocolVersion.trim()
    ? runtimeInput.protocolVersion.trim()
    : "2026-07-01";
  const supportedRoutes = uniqueStrings(runtimeInput.supportedRoutes);
  const supportedCommands = uniqueStrings(runtimeInput.supportedCommands);
  const supportedActions = uniqueStrings(runtimeInput.supportedActions);
  const offlinePersistence = runtimeInput.offlinePersistence === true;
  const backgroundRetry = runtimeInput.backgroundRetry === true;
  const externalHandoff = runtimeInput.externalHandoff === true;

  return {
    schema: "hosted-kernel-artifact-path-policy.client-runtime.v1",
    clientId: typeof runtimeInput.clientId === "string" && runtimeInput.clientId.trim()
      ? normalizeScopeToken(runtimeInput.clientId, "client")
      : null,
    protocolVersion,
    supportedRoutes,
    supportedCommands,
    supportedActions,
    capabilities: uniqueStrings([
      ...uniqueStrings(runtimeInput.capabilities),
      ...(offlinePersistence ? ["client.offlinePersistence"] : []),
      ...(backgroundRetry ? ["client.backgroundRetry"] : []),
      ...(externalHandoff ? ["client.externalHandoff"] : [])
    ]),
    supportMode: {
      routes: supportedRoutes.length ? "declared" : "wildcard",
      commands: supportedCommands.length ? "declared" : "wildcard",
      actions: supportedActions.length ? "declared" : "wildcard"
    },
    features: {
      offlinePersistence,
      backgroundRetry,
      externalHandoff
    },
    source: Object.keys(runtimeInput).length ? "client-supplied" : "kernel-default"
  };
}

function evaluateClientRuntimeInvocation({ clientRuntime, route, command, action }) {
  const routeSupported = clientRuntime.supportedRoutes.length === 0 || clientRuntime.supportedRoutes.includes(route);
  const commandSupported = clientRuntime.supportedCommands.length === 0 || clientRuntime.supportedCommands.includes(command);
  const actionSupported = clientRuntime.supportedActions.length === 0 || clientRuntime.supportedActions.includes(action);

  return {
    route,
    command,
    action,
    routeSupported,
    commandSupported,
    actionSupported,
    supported: routeSupported && commandSupported && actionSupported,
    missing: [
      ...(!routeSupported ? [`route:${route}`] : []),
      ...(!commandSupported ? [`command:${command}`] : []),
      ...(!actionSupported ? [`action:${action}`] : [])
    ]
  };
}

function workflowActionForStep(step, readiness, acceptance) {
  if (readiness.ready) return "continue";
  if (acceptance.required && !acceptance.accepted) return "accept";
  if (!step) return "review";
  if (step.command === "hosted-kernel.health.retry") return "retry";
  if (step.command === "artifact.policy.accept") return "accept";
  if (step.command === "provider.service.configure" || step.command === "artifact.metadata.sync.refresh") return "remediate";
  if (step.command === "provider.payload.configure" || step.command === "provider.handoff.configure") return "remediate";
  if (step.command && step.command.startsWith("artifact.lifecycle.")) return "remediate";
  return step.command === "artifact.commit" || step.command === "artifact.open" ? "continue" : "remediate";
}

function selectWorkflowStep({ requestState, stepResolution, readiness, acceptance }) {
  const selectedById = requestState.selectedStepId
    ? stepResolution.orderedSteps.find((step) => step.id === requestState.selectedStepId)
    : null;
  const selectedByAction = requestState.requestedAction
    ? stepResolution.orderedSteps.find((step) => workflowActionForStep(step, readiness, acceptance) === requestState.requestedAction)
    : null;
  const selectedByRouteIntent = requestState.routeIntent
    ? stepResolution.orderedSteps.find((step) => normalizeScopeToken(step.command || step.id, "route-intent") === requestState.routeIntent)
    : null;
  const selectedStep = selectedById || selectedByAction || selectedByRouteIntent || stepResolution.primary || null;

  return {
    step: selectedStep,
    source: selectedById
      ? "selected-step-id"
      : selectedByAction
        ? "requested-action"
        : selectedByRouteIntent
          ? "route-intent"
          : stepResolution.primary
            ? "primary-step"
            : "provider-invocation",
    requestedAction: requestState.requestedAction,
    resolvedAction: workflowActionForStep(selectedStep, readiness, acceptance)
  };
}

function buildContinuationContract({
  requestState,
  selectedStep,
  route,
  command,
  action,
  handoffState,
  runtimeInvocation,
  persistence,
  readiness,
  validationSummary,
  generatedAt
}) {
  const commandMatches = requestState.lastKnownCommandKey === null || requestState.lastKnownCommandKey === persistence.commandKey;
  const routeMatches = requestState.lastRoute === null || requestState.lastRoute === route;
  const staleReasons = [
    ...(!commandMatches ? ["command_key_changed"] : []),
    ...(!routeMatches ? ["route_changed"] : []),
    ...(requestState.selectedStepId && (!selectedStep || selectedStep.id !== requestState.selectedStepId) ? ["selected_step_unavailable"] : []),
    ...(!runtimeInvocation.supported
      ? runtimeInvocation.missing.map((entry) => `unsupported_client_${entry}`)
      : [])
  ];
  const canOptimisticallyContinue = requestState.optimisticContinuation
    && readiness.ready
    && validationSummary.failureCount === 0
    && runtimeInvocation.supported
    && staleReasons.length === 0;

  return {
    schema: "hosted-kernel-artifact-path-policy.continuation-contract.v1",
    generatedAt,
    state: staleReasons.length
      ? "stale-client-state"
      : canOptimisticallyContinue
        ? "optimistic-continue"
        : handoffState,
    commandKey: persistence.commandKey,
    previousCommandKey: requestState.lastKnownCommandKey,
    previousRoute: requestState.lastRoute,
    route,
    command,
    action,
    selectedStepId: selectedStep ? selectedStep.id : null,
    staleReasons,
    canOptimisticallyContinue,
    runtimeInvocation,
    proof: {
      continuationKey: `${surfaceId}:continuation:${lightweightHash({
        requestId: requestState.requestId,
        uiSessionId: requestState.uiSessionId,
        commandKey: persistence.commandKey,
        selectedStepId: selectedStep ? selectedStep.id : null,
        route,
        command,
        action,
        handoffState,
        staleReasons,
        runtimeSupported: runtimeInvocation.supported
      })}`,
      generatedBy: surfaceId
    }
  };
}

function stagePayloadForWorkflowStep(step, fallbackPayload = {}) {
  return step && step.payload && typeof step.payload === "object" ? step.payload : fallbackPayload;
}

function buildWorkflowTransferPlan({
  generatedAt,
  decision,
  artifactWritePolicy,
  externalHandoff,
  serviceContract,
  persistence,
  readiness,
  acceptance,
  validationSummary,
  primaryStep,
  route,
  command,
  resolvedAction,
  runtimeInvocation,
  continuation,
  requestState
}) {
  const writeLike = artifactWritePolicy.writeLike;
  const clientStateBlocked = !runtimeInvocation.supported || continuation.state === "stale-client-state";
  const policyBlocked = validationSummary.failureCount > 0 && !artifactWritePolicy.quarantine.required;
  const blocked = clientStateBlocked || policyBlocked;
  const operationPayload = {
    commandKey: persistence.commandKey,
    route,
    command,
    action: resolvedAction,
    path: artifactWritePolicy.activePath,
    requestedPath: artifactWritePolicy.requestedPath,
    access: decision.access,
    tenantId: decision.workspace.tenantId,
    workspaceId: decision.workspace.workspaceId,
    activeProofReference: artifactWritePolicy.proofReferences.active,
    requestedProofReference: artifactWritePolicy.proofReferences.requested
  };
  const stages = [];

  if (blocked) {
    stages.push({
      id: "client-state-repair",
      state: !runtimeInvocation.supported ? "runtime-upgrade-required" : "blocked",
      label: !runtimeInvocation.supported ? "Update client runtime support" : "Resolve path policy blockers",
      route,
      command,
      action: resolvedAction,
      terminal: false,
      payload: {
        ...operationPayload,
        selectedStep: stagePayloadForWorkflowStep(primaryStep, null),
        unsupportedRuntimeTargets: runtimeInvocation.missing,
        staleReasons: continuation.staleReasons,
        failureCodes: validationSummary.failures.map((failure) => failure.code)
      }
    });
  } else if (artifactWritePolicy.quarantine.required) {
    stages.push({
      id: "quarantine-review",
      state: "operator-review-required",
      label: "Review quarantined artifact write",
      route: "hosted-kernel.artifact.path-policy.quarantine.review",
      command: "artifact.quarantine.review",
      action: "review",
      terminal: false,
      payload: {
        ...operationPayload,
        path: artifactWritePolicy.quarantine.path,
        quarantineRoot: artifactWritePolicy.quarantine.root,
        quarantineProofReference: artifactWritePolicy.quarantine.proofReference,
        reasonCodes: artifactWritePolicy.quarantine.reasonCodes,
        workspaceQuarantineAllowed: artifactWritePolicy.quarantine.workspaceQuarantineAllowed
      }
    });
  } else if (externalHandoff.requested && externalHandoff.state === "ready") {
    stages.push({
      id: "provider-external-handoff",
      state: "ready",
      label: "Issue provider handoff",
      route: SERVICE_OPERATION_CONTRACTS.externalHandoff.route,
      command: SERVICE_OPERATION_CONTRACTS.externalHandoff.command,
      action: "handoff",
      terminal: readiness.ready,
      payload: {
        ...operationPayload,
        token: serviceContract.externalHandoffEnvelope.token,
        expiresAt: serviceContract.externalHandoffEnvelope.expiresAt,
        deliveryMode: serviceContract.externalHandoffEnvelope.deliveryMode,
        proofReference: serviceContract.externalHandoffEnvelope.proofReference,
        subject: serviceContract.externalHandoffEnvelope.subject
      }
    });
  } else if (writeLike && artifactWritePolicy.allowDirectWrite && readiness.ready) {
    stages.push({
      id: "direct-artifact-write",
      state: "ready",
      label: "Commit artifact write",
      route: serviceContract.invocation.route,
      command: serviceContract.invocation.command,
      action: "continue",
      terminal: true,
      payload: {
        ...operationPayload,
        providerInvocation: serviceContract.invocation,
        payloadProof: artifactWritePolicy.payloadProof,
        persistenceReceiptKey: persistence.receipt.receiptKey
      }
    });
  } else {
    stages.push({
      id: acceptance.required && !acceptance.accepted ? "await-acceptance" : "client-route-action",
      state: acceptance.required && !acceptance.accepted ? "awaiting-acceptance" : "awaiting-client-action",
      label: primaryStep ? primaryStep.label : "Continue path-policy workflow",
      route,
      command,
      action: resolvedAction,
      terminal: false,
      payload: {
        ...operationPayload,
        selectedStep: stagePayloadForWorkflowStep(primaryStep, null),
        acceptanceRequired: acceptance.required,
        missingAcknowledgements: acceptance.missingAcknowledgements
      }
    });
  }

  const currentStage = stages[0];

  return {
    schema: "hosted-kernel-artifact-path-policy.workflow-transfer-plan.v1",
    generatedAt,
    state: currentStage.state,
    currentStageId: currentStage.id,
    destinationState: artifactWritePolicy.destinationState,
    writeLike,
    stages,
    clientResume: {
      requestId: requestState.requestId,
      uiSessionId: requestState.uiSessionId,
      continuationState: continuation.state,
      continuationKey: continuation.proof.continuationKey,
      previousCommandKey: continuation.previousCommandKey,
      commandKey: persistence.commandKey,
      route,
      command,
      action: resolvedAction
    },
    proof: {
      transferKey: `${surfaceId}:transfer:${lightweightHash({
        commandKey: persistence.commandKey,
        currentStageId: currentStage.id,
        destinationState: artifactWritePolicy.destinationState,
        activeProofReference: artifactWritePolicy.proofReferences.active,
        route,
        command,
        action: resolvedAction,
        runtimeSupported: runtimeInvocation.supported,
        continuationState: continuation.state
      })}`,
      generatedBy: surfaceId
    }
  };
}

function commandRouteForNextStep(step, serviceContract, lifecycleControls) {
  if (!step) return serviceContract.invocation.route;

  const routes = {
    "provider.select": "hosted-kernel.provider.select",
    "artifact.permission.request": "hosted-kernel.artifact.permission.request",
    "artifact.path.edit": "hosted-kernel.artifact.path-policy.edit",
    "artifact.payload.edit": "hosted-kernel.artifact.payload.edit",
    "artifact.policy.accept": "hosted-kernel.artifact.path-policy.accept",
    "artifact.lifecycle.enable": "hosted-kernel.artifact.lifecycle.enable",
    "artifact.lifecycle.command.select": "hosted-kernel.artifact.lifecycle.command.select",
    "artifact.lifecycle.resume": "hosted-kernel.artifact.lifecycle.resume",
    "artifact.lifecycle.schedule.enable": "hosted-kernel.artifact.lifecycle.schedule.enable",
    "artifact.lifecycle.schedule.fix": "hosted-kernel.artifact.lifecycle.schedule.fix",
    "artifact.lifecycle.schedule": "hosted-kernel.artifact.lifecycle.schedule",
    "artifact.lifecycle.wait-scheduled-run": "hosted-kernel.artifact.lifecycle.wait-scheduled-run",
    "artifact.lifecycle.wait": "hosted-kernel.artifact.lifecycle.wait",
    "provider.service.configure": "hosted-kernel.provider.service.configure",
    "provider.payload.configure": "hosted-kernel.provider.payload.configure",
    "provider.handoff.configure": "hosted-kernel.provider.handoff.configure",
    "artifact.metadata.sync.refresh": "hosted-kernel.artifact.sync-metadata.refresh",
    "hosted-kernel.health.retry": "hosted-kernel.health.retry"
  };

  if (step.command && step.command.startsWith("artifact.lifecycle.")) {
    return routes[step.command] || `hosted-kernel.artifact.lifecycle.${lifecycleControls.nextAction}`;
  }

  return routes[step.command] || serviceContract.invocation.route;
}

function prerequisiteStateForStep(step, { acceptance, readiness, validationSummary, serviceContract, lifecycleControls }) {
  const unresolvedFailures = validationSummary.failures.map((failure) => failure.code);
  const requiresAcceptance = step.command === "artifact.policy.accept";
  const requiresEndpointRepair = step.command === "provider.service.configure";
  const requiresSyncRefresh = step.command === "artifact.metadata.sync.refresh";
  const requiresPayloadRepair = step.command === "provider.payload.configure";
  const requiresHandoffRepair = step.command === "provider.handoff.configure";
  const requiresLifecycleRepair = step.command && step.command.startsWith("artifact.lifecycle.");
  const blockedPrerequisites = [
    ...(!requiresAcceptance || acceptance.accepted ? [] : ["acceptance_pending"]),
    ...(!requiresEndpointRepair || serviceContract.negotiation.incompatibleReasons.some((reason) => reason.includes("_endpoint:") || reason.startsWith("ack_required:"))
      ? []
      : ["provider_endpoint_already_valid"]),
    ...(!requiresSyncRefresh || serviceContract.providerSyncState.requiresRefresh ? [] : ["sync_state_already_fresh"]),
    ...(!requiresPayloadRepair || serviceContract.providerPayloadLimits.state === "blocked" ? [] : ["provider_payload_contract_already_valid"]),
    ...(!requiresHandoffRepair || serviceContract.providerHandoffRequirements.state === "blocked" ? [] : ["provider_handoff_contract_already_valid"]),
    ...(!requiresLifecycleRepair || lifecycleControls.validation.violations.length ? [] : ["lifecycle_controls_already_valid"])
  ];

  return {
    readyToInvoke: readiness.ready || requiresAcceptance || unresolvedFailures.length > 0 || blockedPrerequisites.length === 0,
    unresolvedFailures,
    blockedPrerequisites,
    requiresAcceptance,
    requiresEndpointRepair,
    requiresSyncRefresh,
    requiresPayloadRepair,
    requiresHandoffRepair,
    requiresLifecycleRepair
  };
}

function buildStepResolutionContract({
  generatedAt,
  decision,
  acceptance,
  readiness,
  validationSummary,
  serviceContract,
  lifecycleControls,
  persistence,
  nextSteps
}) {
  const orderedSteps = nextSteps.map((step, index) => {
    const route = commandRouteForNextStep(step, serviceContract, lifecycleControls);
    const prerequisites = prerequisiteStateForStep(step, {
      acceptance,
      readiness,
      validationSummary,
      serviceContract,
      lifecycleControls
    });
    const payload = {
      commandKey: persistence.commandKey,
      path: decision.path,
      access: decision.access,
      tenantId: decision.workspace.tenantId,
      workspaceId: decision.workspace.workspaceId,
      actorId: decision.permission.actorId,
      stepId: step.id,
      requestedCommand: step.command,
      route
    };

    return {
      ...step,
      priority: index + 1,
      route,
      enabled: index === 0 && prerequisites.readyToInvoke,
      terminal: readiness.ready && index === 0,
      prerequisites,
      payload,
      audit: {
        resolutionKey: `${surfaceId}:step:${lightweightHash({
          stepId: step.id,
          command: step.command,
          route,
          commandKey: persistence.commandKey,
          readinessState: readiness.state,
          validationStatus: validationSummary.status
        })}`,
        generatedAt
      }
    };
  });
  const primary = orderedSteps[0] || null;

  return {
    schema: "hosted-kernel-artifact-path-policy.step-resolution.v1",
    generatedAt,
    state: readiness.ready
      ? "continuable"
      : validationSummary.failureCount
        ? "needs-remediation"
        : acceptance.required && !acceptance.accepted
          ? "needs-acceptance"
          : "needs-route-action",
    primary,
    orderedSteps,
    routeIndex: Object.fromEntries(orderedSteps.map((step) => [step.id, {
      route: step.route,
      command: step.command,
      enabled: step.enabled,
      priority: step.priority
    }])),
    proof: {
      commandKey: persistence.commandKey,
      path: decision.path,
      access: decision.access,
      stepCount: orderedSteps.length,
      primaryStepId: primary ? primary.id : null,
      resolutionHash: lightweightHash({
        commandKey: persistence.commandKey,
        readinessState: readiness.state,
        validationStatus: validationSummary.status,
        steps: orderedSteps.map(({ id, command, route, enabled }) => ({ id, command, route, enabled }))
      })
    }
  };
}

function buildClientWorkflowHandoff({
  input,
  generatedAt,
  decision,
  acceptance,
  readiness,
  validationSummary,
  serviceContract,
  lifecycleControls,
  artifactWritePolicy,
  externalHandoff,
  persistence,
  nextSteps,
  stepResolution
}) {
  const requestState = normalizeClientRequestState(input);
  const clientRuntime = normalizeClientRuntimeContract(input);
  const selectedWorkflow = selectWorkflowStep({
    requestState,
    stepResolution,
    readiness,
    acceptance
  });
  const primaryStep = selectedWorkflow.step;
  const route = primaryStep ? primaryStep.route : commandRouteForNextStep(primaryStep, serviceContract, lifecycleControls);
  const command = primaryStep
    ? primaryStep.command
    : serviceContract.invocation.command;
  const resolvedAction = selectedWorkflow.resolvedAction;
  const runtimeInvocation = evaluateClientRuntimeInvocation({
    clientRuntime,
    route,
    command,
    action: resolvedAction
  });
  const blockedReasonCodes = validationSummary.failures.map((failure) => failure.code);
  const warningCodes = validationSummary.warnings
    .map((warning) => warning.code)
    .filter((code) => !requestState.acknowledgedWarnings.includes(code));
  const policyHandoffState = readiness.ready
    ? "continue"
    : validationSummary.failureCount
      ? "blocked"
      : acceptance.required && !acceptance.accepted
        ? "awaiting-acceptance"
        : "awaiting-client-action";
  const handoffState = runtimeInvocation.supported ? policyHandoffState : "runtime-upgrade-required";
  const resumeBasis = {
    surfaceId,
    requestId: requestState.requestId,
    uiSessionId: requestState.uiSessionId,
    commandKey: persistence.commandKey,
    route,
    command,
    action: resolvedAction,
    path: decision.path,
    access: decision.access,
    handoffState
  };
  const resumeToken = `${surfaceId}:client:${lightweightHash(resumeBasis)}`;
  const continuationAccepted = requestState.continuationToken === null
    || requestState.continuationToken === resumeToken
    || requestState.continuationToken.startsWith(`${surfaceId}:client:`);
  const continuation = buildContinuationContract({
    requestState,
    selectedStep: primaryStep,
    route,
    command,
    action: resolvedAction,
    handoffState,
    runtimeInvocation,
    persistence,
    readiness,
    validationSummary,
    generatedAt
  });
  const selectedStepPriority = primaryStep
    ? primaryStep.priority || nextSteps.findIndex((step) => step.id === primaryStep.id) + 1
    : null;
  const transferPlan = buildWorkflowTransferPlan({
    generatedAt,
    decision,
    artifactWritePolicy,
    externalHandoff,
    serviceContract,
    persistence,
    readiness,
    acceptance,
    validationSummary,
    primaryStep,
    route,
    command,
    resolvedAction,
    runtimeInvocation,
    continuation,
    requestState
  });

  return {
    schema: "hosted-kernel-artifact-path-policy.client-workflow-handoff.v1",
    generatedAt,
    requestState,
    clientRuntime: {
      schema: clientRuntime.schema,
      clientId: clientRuntime.clientId,
      protocolVersion: clientRuntime.protocolVersion,
      supportMode: clientRuntime.supportMode,
      features: clientRuntime.features,
      capabilities: clientRuntime.capabilities,
      invocation: runtimeInvocation
    },
    state: handoffState,
    policyState: policyHandoffState,
    mode: requestState.handoffMode,
    route,
    command,
    resumeToken,
    continuationAccepted,
    continuation,
    transferPlan,
    selection: {
      source: selectedWorkflow.source,
      requestedAction: selectedWorkflow.requestedAction,
      resolvedAction,
      staleClientState: continuation.state === "stale-client-state"
    },
    selectedStep: primaryStep
      ? {
          id: primaryStep.id,
          label: primaryStep.label,
          reason: primaryStep.reason,
          priority: selectedStepPriority
        }
      : null,
    payload: {
      commandKey: persistence.commandKey,
      path: decision.path,
      access: decision.access,
      tenantId: decision.workspace.tenantId,
      workspaceId: decision.workspace.workspaceId,
      actorId: decision.permission.actorId,
      acceptedBy: acceptance.actor,
      providerInvocation: readiness.ready ? serviceContract.invocation : null,
      selectedStepPayload: primaryStep ? primaryStep.payload : null,
      transferStage: transferPlan.stages[0],
      blockedReasonCodes,
      warningCodes
    },
    clientEffects: {
      persistRequestState: true,
      writePersistenceState: persistence.write.required && runtimeInvocation.supported,
      requireUserInput: handoffState === "awaiting-acceptance"
        || handoffState === "awaiting-client-action"
        || handoffState === "runtime-upgrade-required",
      permitOptimisticContinue: continuation.canOptimisticallyContinue,
      allowBackgroundRetry: clientRuntime.features.backgroundRetry
        && runtimeInvocation.supported
        && policyHandoffState === "blocked"
        && blockedReasonCodes.every((code) => code.startsWith("missing_capability:") || code.startsWith("missing_permission:")),
      requireRuntimeUpgrade: !runtimeInvocation.supported,
      unsupportedRuntimeTargets: runtimeInvocation.missing,
      invalidatePreviousContinuation: requestState.continuationToken !== null && !continuationAccepted,
      refreshClientRoute: continuation.state === "stale-client-state",
      requiresQuarantineReview: transferPlan.currentStageId === "quarantine-review",
      issuesProviderHandoff: transferPlan.currentStageId === "provider-external-handoff",
      directWriteReady: transferPlan.currentStageId === "direct-artifact-write"
    },
    proof: {
      surfaceId,
      commandKey: persistence.commandKey,
      route,
      command,
      action: resolvedAction,
      stepResolutionHash: stepResolution.proof.resolutionHash,
      requestStateSource: requestState.source,
      clientRuntimeId: clientRuntime.clientId,
      clientRuntimeSupported: runtimeInvocation.supported,
      resumeHash: lightweightHash(resumeBasis),
      unacknowledgedWarningCount: warningCodes.length,
      continuationKey: continuation.proof.continuationKey,
      selectedStepSource: selectedWorkflow.source,
      transferKey: transferPlan.proof.transferKey
    }
  };
}

function summarizeGateLabel(key) {
  const labels = {
    policyDecision: "Path policy decision",
    pathEvidence: "Path evidence contract",
    tenantBoundary: "Tenant root boundary",
    workspaceBoundary: "Tenant workspace boundary",
    actorPermissions: "Actor permissions",
    actorScope: "Actor tenant/workspace scope",
    providerCapabilities: "Provider capabilities",
    userAcceptance: "User acceptance",
    syncProof: "Sync metadata proof",
    handoff: "External handoff",
    lifecycleControls: "Lifecycle controls",
    mutationPreconditions: "Mutation preconditions",
    artifactWritePolicy: "Artifact write policy",
    dependencyHealth: "Hosted-kernel dependencies",
    providerServiceContract: "Provider service contract"
  };

  return labels[key] || key;
}

function buildClientReviewPacket({
  generatedAt,
  decision,
  provider,
  preview,
  acceptance,
  readiness,
  validationSummary,
  lifecycleControls,
  artifactWritePolicy,
  dependencyHealth,
  serviceContract,
  persistence,
  clientWorkflowHandoff,
  stepResolution
}) {
  const validationItems = [
    ...validationSummary.failures.map((failure) => ({
      severity: "error",
      code: failure.code,
      target: failure.target,
      message: failure.message
    })),
    ...validationSummary.warnings.map((warning) => ({
      severity: "warning",
      code: warning.code,
      target: warning.target,
      message: warning.message
    }))
  ];
  const gateRows = Object.entries(readiness.gates).map(([key, passed]) => ({
    key,
    label: summarizeGateLabel(key),
    state: passed ? "passed" : "blocked",
    blocking: !passed
  }));
  const blockedGateCount = gateRows.filter((gate) => gate.blocking).length;
  const routeBindings = {
    preview: "hosted-kernel.artifact.path-policy.preview",
    accept: "hosted-kernel.artifact.path-policy.accept",
    validate: "hosted-kernel.artifact.path-policy.validate",
    continue: serviceContract.invocation.route,
    lifecycle: lifecycleControls.nextAction,
    audit: "hosted-kernel.artifact.path-policy.audit"
  };
  const primaryStep = stepResolution.primary;
  const acceptanceFields = acceptance.required
    ? [
        {
          name: "acceptedBy",
          type: "string",
          required: true,
          value: acceptance.actor,
          label: "Acceptance actor"
        },
        {
          name: "commandKey",
          type: "string",
          required: true,
          value: persistence.commandKey,
          label: "Policy command key"
        },
        {
          name: "acceptedPath",
          type: "string",
          required: true,
          value: decision.path,
          label: "Artifact path"
        },
        {
          name: "acknowledgedCodes",
          type: "string[]",
          required: acceptance.requiredAcknowledgements.length > 0,
          value: acceptance.acknowledgedCodes,
          label: "Acknowledged policy codes"
        }
      ]
    : [];

  return {
    schema: "hosted-kernel-artifact-path-policy.client-review.v1",
    generatedAt,
    title: preview.title,
    state: readiness.ready
      ? "ready"
      : validationSummary.failureCount
        ? "blocked"
        : acceptance.required && !acceptance.accepted
          ? "needs-acceptance"
          : "needs-review",
    summary: {
      outcome: preview.outcome,
      validationStatus: validationSummary.status,
      readinessState: readiness.state,
      blockedGateCount,
      failureCount: validationSummary.failureCount,
      warningCount: validationSummary.warningCount,
      providerId: provider.id,
      providerMode: provider.mode,
      commandKey: persistence.commandKey
    },
    previewCard: {
      badge: preview.badge,
      primaryAction: preview.primaryAction,
      reasons: preview.visibleReasons,
      affordances: preview.affordances
    },
    acceptancePanel: {
      required: acceptance.required,
      requested: acceptance.requested,
      accepted: acceptance.accepted,
      actor: acceptance.actor,
      acknowledgementRequirements: acceptance.acknowledgementRequirements,
      acknowledgedCodes: acceptance.acknowledgedCodes,
      requiredAcknowledgements: acceptance.requiredAcknowledgements,
      missingAcknowledgements: acceptance.missingAcknowledgements,
      blockedReasons: acceptance.blockedReasons,
      submit: {
        route: routeBindings.accept,
        command: "artifact.policy.accept",
        enabled: acceptance.required
          && !acceptance.accepted
          && validationSummary.failureCount === 0
          && !acceptance.blockedReasons.some((reason) => reason.startsWith("blocking_acknowledgement:")),
        payload: acceptance.actionPayload,
        fields: acceptanceFields
      }
    },
    validationPanel: {
      route: routeBindings.validate,
      status: validationSummary.status,
      items: validationItems,
      emptyState: validationItems.length === 0 ? "No validation issues found." : null
    },
    pathEvidencePanel: {
      schema: decision.pathEvidence.schema,
      supplied: decision.pathEvidence.supplied,
      rawPath: decision.pathEvidence.rawPath,
      normalizedPath: decision.pathEvidence.normalizedPath,
      rewritten: decision.pathEvidence.rewritten,
      leafName: decision.pathEvidence.leafName,
      segmentCount: decision.pathEvidence.segmentCount,
      rootRelativeSegments: decision.pathEvidence.rootRelativeSegments,
      workspaceRelativeSegments: decision.pathEvidence.workspaceRelativeSegments,
      containment: decision.pathEvidence.containment,
      risk: decision.pathEvidence.risk,
      proofReferences: decision.pathEvidence.proofReferences,
      evidenceKey: decision.pathEvidence.proof.evidenceKey
    },
    artifactWritePanel: {
      schema: artifactWritePolicy.schema,
      state: artifactWritePolicy.destinationState,
      allowDirectWrite: artifactWritePolicy.allowDirectWrite,
      requestedProofReference: artifactWritePolicy.proofReferences.requested,
      activeProofReference: artifactWritePolicy.proofReferences.active,
      quarantine: artifactWritePolicy.quarantine,
      payloadProof: artifactWritePolicy.payloadProof,
      validation: artifactWritePolicy.validation,
      writePolicyKey: artifactWritePolicy.proof.writePolicyKey
    },
    readinessPanel: {
      ready: readiness.ready,
      state: readiness.state,
      gates: gateRows
    },
    dependencyPanel: {
      schema: dependencyHealth.schema,
      state: dependencyHealth.state,
      degradedMode: dependencyHealth.degradedMode,
      dependencies: dependencyHealth.dependencies.map((dependency) => ({
        name: dependency.name,
        required: dependency.required,
        status: dependency.status,
        effectiveState: dependency.effectiveState,
        stale: dependency.stale,
        slow: dependency.slow,
        latencyMs: dependency.latencyMs,
        route: dependency.route,
        message: dependency.message
      }))
    },
    lifecyclePanel: {
      schema: lifecycleControls.schema,
      command: lifecycleControls.command,
      commandRequest: lifecycleControls.commandRequest,
      route: lifecycleControls.route,
      settings: lifecycleControls.settings,
      controls: lifecycleControls.controls,
      commandEffect: lifecycleControls.commandEffect,
      nextAction: lifecycleControls.nextAction,
      nextActionState: lifecycleControls.nextActionState,
      validation: lifecycleControls.validation
    },
    nextActionPanel: {
      route: primaryStep ? routeBindings.preview : routeBindings.continue,
      primaryStep: stepResolution.primary,
      steps: stepResolution.orderedSteps
    },
    stepResolutionPanel: {
      schema: stepResolution.schema,
      state: stepResolution.state,
      primaryStepId: stepResolution.proof.primaryStepId,
      routeIndex: stepResolution.routeIndex,
      resolutionHash: stepResolution.proof.resolutionHash
    },
    workflowHandoffPanel: {
      schema: clientWorkflowHandoff.schema,
      state: clientWorkflowHandoff.state,
      policyState: clientWorkflowHandoff.policyState,
      mode: clientWorkflowHandoff.mode,
      route: clientWorkflowHandoff.route,
      command: clientWorkflowHandoff.command,
      resumeToken: clientWorkflowHandoff.resumeToken,
      continuation: clientWorkflowHandoff.continuation,
      transferPlan: clientWorkflowHandoff.transferPlan,
      clientRuntime: clientWorkflowHandoff.clientRuntime,
      selection: clientWorkflowHandoff.selection,
      selectedStep: clientWorkflowHandoff.selectedStep,
      clientEffects: clientWorkflowHandoff.clientEffects
    },
    integration: {
      routes: routeBindings,
      providerInvocation: serviceContract.invocation,
      stepResolution: {
        state: stepResolution.state,
        primaryRoute: stepResolution.primary ? stepResolution.primary.route : null,
        primaryCommand: stepResolution.primary ? stepResolution.primary.command : null,
        resolutionHash: stepResolution.proof.resolutionHash
      },
      workflowHandoff: {
        route: clientWorkflowHandoff.route,
        command: clientWorkflowHandoff.command,
        continuationAccepted: clientWorkflowHandoff.continuationAccepted,
        continuationState: clientWorkflowHandoff.continuation.state,
        transferState: clientWorkflowHandoff.transferPlan.state,
        transferStageId: clientWorkflowHandoff.transferPlan.currentStageId,
        transferKey: clientWorkflowHandoff.transferPlan.proof.transferKey,
        runtimeSupported: clientWorkflowHandoff.clientRuntime.invocation.supported,
        unsupportedRuntimeTargets: clientWorkflowHandoff.clientRuntime.invocation.missing,
        selectedStepSource: clientWorkflowHandoff.selection.source,
        requestState: clientWorkflowHandoff.requestState
      },
      lifecycleCommand: lifecycleControls.command,
      persistence: {
        durableStatus: persistence.durableStatus,
        commandStatus: persistence.commandState.status,
        receiptKey: persistence.receipt.receiptKey,
        restartStatus: persistence.restartStatus.state,
        restartSafe: persistence.recovery.restartSafe,
        operatorActionRequired: persistence.recovery.operatorActionRequired,
        writeRequired: persistence.write.required,
        recoveryAction: persistence.recoveryAction,
        recoveryAttempt: persistence.commandState.recoveryAttempt,
        recoveryDispatch: persistence.recovery.dispatch
      }
    },
    proof: {
      surfaceId,
      path: decision.path,
      access: decision.access,
      tenantId: decision.workspace.tenantId,
      workspaceId: decision.workspace.workspaceId,
      providerId: provider.id,
      commandKey: persistence.commandKey,
      reviewHash: lightweightHash({
        path: decision.path,
        access: decision.access,
        providerId: provider.id,
        readinessState: readiness.state,
        commandKey: persistence.commandKey,
        resumeToken: clientWorkflowHandoff.resumeToken,
        validationStatus: validationSummary.status
      })
    }
  };
}

function incrementCounter(counters, key, amount = 1) {
  counters[key] = (counters[key] || 0) + amount;
}

function normalizeAnalyticsHistory(input = {}) {
  const historyInput = Array.isArray(input.analyticsHistory)
    ? input.analyticsHistory
    : Array.isArray(input.history)
      ? input.history
      : [];

  return historyInput
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      snapshotId: typeof entry.snapshotId === "string" && entry.snapshotId.trim() ? entry.snapshotId.trim() : null,
      recordedAt: toIsoTimestamp(entry.recordedAt),
      tenantId: typeof entry.tenantId === "string" ? entry.tenantId : null,
      workspaceId: typeof entry.workspaceId === "string" ? entry.workspaceId : null,
      access: typeof entry.access === "string" ? entry.access : "read",
      outcome: typeof entry.outcome === "string" ? entry.outcome : "unknown",
      readinessState: typeof entry.readinessState === "string" ? entry.readinessState : null,
      dependencyState: typeof entry.dependencyState === "string" ? entry.dependencyState : null,
      providerId: typeof entry.providerId === "string" ? entry.providerId : null,
      violationCodes: uniqueStrings(entry.violationCodes),
      warningCodes: uniqueStrings(entry.warningCodes),
      pathHash: typeof entry.pathHash === "string" ? entry.pathHash : null,
      commandKey: typeof entry.commandKey === "string" ? entry.commandKey : null,
      gates: normalizeAnalyticsGateStates(entry.gates),
      writeDestinationState: ["safe-write", "quarantine", "not-applicable"].includes(entry.writeDestinationState)
        ? entry.writeDestinationState
        : null,
      quarantineRequired: entry.quarantineRequired === true,
      payloadIntegrity: typeof entry.payloadIntegrity === "string" ? entry.payloadIntegrity : null,
      activeProofReference: typeof entry.activeProofReference === "string" ? entry.activeProofReference : null
    }))
    .filter((entry) => entry.snapshotId || entry.commandKey || entry.pathHash)
    .slice(-49);
}

function normalizeAnalyticsGateStates(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => typeof key === "string" && key.trim())
      .map(([key, passed]) => [key, passed === true])
  );
}

function buildPersistedAnalyticsSnapshots({ persistedState, artifactRoot, generatedAt }) {
  const receiptByCommand = new Map(
    persistedState.commandReceipts.map((receipt) => [receipt.commandKey, receipt])
  );

  return persistedState.commandLog
    .map((entry) => {
      const receipt = receiptByCommand.get(entry.commandKey) || null;
      const recordedAt = entry.terminalAt || entry.recordedAt || receipt?.recordedAt || generatedAt;
      const outcome = entry.outcome || entry.status || receipt?.status || "unknown";
      const blocked = entry.status === "blocked" || receipt?.status === "blocked" || outcome === "blocked";
      const pathHash = entry.path
        ? lightweightHash({ path: entry.path })
        : receipt?.path
          ? lightweightHash({ path: receipt.path })
          : null;

      return {
        snapshotId: `path-policy-persisted:${lightweightHash({
          commandKey: entry.commandKey,
          status: entry.status,
          path: entry.path,
          recordedAt
        })}`,
        recordedAt,
        tenantId: entry.tenantId,
        workspaceId: entry.workspaceId,
        access: receipt?.command === "artifact.open" ? "read" : "write",
        outcome,
        readinessState: blocked ? "blocked" : outcome === "ready" || entry.status === "prepared" ? "ready" : outcome,
        dependencyState: null,
        providerId: null,
        providerMode: null,
        pathHash,
        commandKey: entry.commandKey,
        violationCodes: blocked ? ["persisted_command_blocked"] : [],
        warningCodes: entry.status === "stale-prepared" || entry.status === "orphaned-prepared"
          ? [`persisted_${entry.status.replace(/-/g, "_")}`]
          : [],
        gates: {},
        writeDestinationState: receipt?.path && entry.path && receipt.path !== entry.path ? "quarantine" : null,
        quarantineRequired: Boolean(receipt?.path && entry.path && receipt.path !== entry.path),
        payloadIntegrity: null,
        activeProofReference: receipt?.path
          ? repoRelativeProofReference(receipt.path, artifactRoot)
          : null
      };
    })
    .filter((entry) => entry.snapshotId && entry.commandKey)
    .slice(-25);
}

function normalizeAnalyticsExportSettings(input = {}) {
  const exportInput = input.analyticsExport && typeof input.analyticsExport === "object"
    ? input.analyticsExport
    : input.exportOptions && typeof input.exportOptions === "object"
      ? input.exportOptions
      : {};
  const requestedFormat = typeof exportInput.format === "string" ? exportInput.format.toLowerCase() : "jsonl";
  const format = ["json", "jsonl", "csv"].includes(requestedFormat) ? requestedFormat : "jsonl";
  const maxRows = Number.isInteger(exportInput.maxRows) && exportInput.maxRows > 0
    ? Math.min(exportInput.maxRows, 50)
    : 50;
  const since = exportInput.since ? toIsoTimestamp(exportInput.since) : null;
  const until = exportInput.until ? toIsoTimestamp(exportInput.until) : null;
  const includeHistory = exportInput.includeHistory !== false;
  const includeTimeline = exportInput.includeTimeline !== false;
  const includeProof = exportInput.includeProof !== false;
  const redactionMode = ["none", "hash-only", "tenant-workspace"].includes(exportInput.redactionMode)
    ? exportInput.redactionMode
    : "hash-only";
  const route = typeof exportInput.route === "string" && exportInput.route.trim()
    ? exportInput.route.trim()
    : "hosted-kernel.artifact.path-policy.analytics.export";

  return {
    schema: "hosted-kernel-artifact-path-policy.analytics-export-settings.v1",
    format,
    maxRows,
    since,
    until,
    includeHistory,
    includeTimeline,
    includeProof,
    redactionMode,
    route,
    requestedBy: typeof exportInput.requestedBy === "string" && exportInput.requestedBy.trim()
      ? exportInput.requestedBy.trim()
      : null
  };
}

function snapshotInExportWindow(snapshot, settings) {
  const recordedAt = new Date(snapshot.recordedAt).getTime();
  const since = settings.since ? new Date(settings.since).getTime() : null;
  const until = settings.until ? new Date(settings.until).getTime() : null;

  if (Number.isNaN(recordedAt)) return false;
  if (since !== null && !Number.isNaN(since) && recordedAt < since) return false;
  if (until !== null && !Number.isNaN(until) && recordedAt > until) return false;
  return true;
}

function redactAnalyticsSnapshot(snapshot, settings) {
  if (settings.redactionMode === "none") return snapshot;

  return {
    ...snapshot,
    tenantId: settings.redactionMode === "tenant-workspace" ? snapshot.tenantId : null,
    workspaceId: settings.redactionMode === "tenant-workspace" ? snapshot.workspaceId : null,
    commandKey: settings.redactionMode === "tenant-workspace" ? snapshot.commandKey : null
  };
}

function buildAnalyticsDelta({ previousSnapshot, currentSnapshot, readiness, validationSummary }) {
  const previousViolations = new Set(previousSnapshot ? previousSnapshot.violationCodes : []);
  const currentViolations = new Set(currentSnapshot.violationCodes);
  const previousWarnings = new Set(previousSnapshot ? previousSnapshot.warningCodes : []);
  const currentWarnings = new Set(currentSnapshot.warningCodes);
  const newViolations = [...currentViolations].filter((code) => !previousViolations.has(code));
  const clearedViolations = [...previousViolations].filter((code) => !currentViolations.has(code));
  const newWarnings = [...currentWarnings].filter((code) => !previousWarnings.has(code));
  const clearedWarnings = [...previousWarnings].filter((code) => !currentWarnings.has(code));
  const readinessChanged = previousSnapshot
    ? previousSnapshot.readinessState !== currentSnapshot.readinessState
    : false;

  return {
    schema: "hosted-kernel-artifact-path-policy.analytics-delta.v1",
    baselineSnapshotId: previousSnapshot ? previousSnapshot.snapshotId : null,
    currentSnapshotId: currentSnapshot.snapshotId,
    state: !previousSnapshot
      ? "no-baseline"
      : readinessChanged || newViolations.length || clearedViolations.length || newWarnings.length || clearedWarnings.length
        ? "changed"
        : "unchanged",
    readinessChanged,
    fromReadinessState: previousSnapshot ? previousSnapshot.readinessState : null,
    toReadinessState: currentSnapshot.readinessState,
    newViolations,
    clearedViolations,
    newWarnings,
    clearedWarnings,
    currentFailureCount: validationSummary.failureCount,
    currentWarningCount: validationSummary.warningCount,
    gateDelta: Object.fromEntries(
      Object.entries(readiness.gates).map(([gate, passed]) => [gate, {
        current: passed ? "passed" : "blocked",
        changed: previousSnapshot && previousSnapshot.gates
          ? previousSnapshot.gates[gate] !== passed
          : false
      }])
    )
  };
}

function buildAnalyticsExports({
  input,
  generatedAt,
  artifactRoot,
  decision,
  provider,
  syncMetadata,
  externalHandoff,
  acceptance,
  readiness,
  validationSummary,
  artifactWritePolicy,
  operationalHealth,
  dependencyHealth,
  persistence
}) {
  const snapshotBasis = {
    surfaceId,
    tenantId: decision.workspace.tenantId,
    workspaceId: decision.workspace.workspaceId,
    path: decision.path,
    access: decision.access,
    commandKey: persistence.commandKey,
    generatedAt
  };
  const currentSnapshot = {
    snapshotId: `path-policy-snapshot:${lightweightHash(snapshotBasis)}`,
    recordedAt: generatedAt,
    tenantId: decision.workspace.tenantId,
    workspaceId: decision.workspace.workspaceId,
    access: decision.access,
    outcome: readiness.ready ? "ready" : readiness.state,
    readinessState: readiness.state,
    healthStatus: operationalHealth.status,
    dependencyState: dependencyHealth.state,
    providerId: provider.id,
    providerMode: provider.mode,
    pathHash: lightweightHash({ path: decision.path }),
    commandKey: persistence.commandKey,
    violationCodes: uniqueStrings([
      ...decision.violations,
      ...validationSummary.failures.map((failure) => failure.code)
    ]),
    warningCodes: validationSummary.warnings.map((warning) => warning.code),
    gates: readiness.gates,
    writeDestinationState: artifactWritePolicy.destinationState,
    quarantineRequired: artifactWritePolicy.quarantine.required,
    quarantineReasonCodes: artifactWritePolicy.quarantine.reasonCodes,
    payloadIntegrity: artifactWritePolicy.payloadProof.integrityState,
    activeProofReference: artifactWritePolicy.proofReferences.active
  };
  const normalizedHistory = normalizeAnalyticsHistory(input);
  const persistedHistory = buildPersistedAnalyticsSnapshots({
    persistedState: persistence.write.state,
    artifactRoot,
    generatedAt
  });
  const priorSnapshots = [...persistedHistory, ...normalizedHistory].slice(-49);
  const previousSnapshot = priorSnapshots.length ? priorSnapshots.at(-1) : null;
  const snapshots = [...priorSnapshots, currentSnapshot].slice(-50);
  const exportSettings = normalizeAnalyticsExportSettings(input);
  const reportSnapshots = snapshots
    .filter((snapshot) => snapshotInExportWindow(snapshot, exportSettings))
    .slice(-exportSettings.maxRows);
  const redactedReportSnapshots = reportSnapshots.map((snapshot) => redactAnalyticsSnapshot(snapshot, exportSettings));
  const delta = buildAnalyticsDelta({
    previousSnapshot,
    currentSnapshot,
    readiness,
    validationSummary
  });
  const counters = {
    totalSnapshots: snapshots.length,
    reportSnapshots: reportSnapshots.length,
    allowed: 0,
    blocked: 0,
    ready: 0,
    warningSnapshots: 0,
    handoffRequested: externalHandoff.requested ? 1 : 0,
    handoffReady: externalHandoff.state === "ready" ? 1 : 0,
    syncEnabled: syncMetadata.enabled ? 1 : 0,
    acceptanceRequired: acceptance.required ? 1 : 0,
    acceptanceAccepted: acceptance.accepted ? 1 : 0,
    degraded: operationalHealth.degraded.active ? 1 : 0,
    directWrites: 0,
    quarantinedWrites: 0,
    writeLikeSnapshots: 0,
    payloadDeclarationInvalid: 0,
    persistedHistorySnapshots: persistedHistory.length
  };
  const byAccess = {};
  const byViolation = {};
  const byProvider = {};
  const byReadinessState = {};
  const byWriteDestinationState = {};
  const byPayloadIntegrity = {};
  const quarantineReasons = {};

  for (const snapshot of snapshots) {
    const allowed = snapshot.outcome === "ready" || snapshot.outcome === "waiting-for-acceptance";
    incrementCounter(byAccess, snapshot.access || "read");
    incrementCounter(byProvider, snapshot.providerId || "unknown-provider");
    incrementCounter(byReadinessState, snapshot.readinessState || snapshot.outcome || "unknown");
    incrementCounter(byWriteDestinationState, snapshot.writeDestinationState || "not-recorded");
    incrementCounter(byPayloadIntegrity, snapshot.payloadIntegrity || "not-recorded");
    if (allowed) counters.allowed += 1;
    if (snapshot.outcome === "blocked" || snapshot.readinessState === "blocked") counters.blocked += 1;
    if (snapshot.outcome === "ready") counters.ready += 1;
    if (snapshot.warningCodes.length) counters.warningSnapshots += 1;
    if (snapshot.access === "write" || snapshot.access === "sync") counters.writeLikeSnapshots += 1;
    if (snapshot.writeDestinationState === "safe-write") counters.directWrites += 1;
    if (snapshot.quarantineRequired || snapshot.writeDestinationState === "quarantine") counters.quarantinedWrites += 1;
    if (snapshot.payloadIntegrity === "invalid") counters.payloadDeclarationInvalid += 1;
    for (const violation of snapshot.violationCodes) {
      incrementCounter(byViolation, violation);
    }
    for (const reason of snapshot.quarantineReasonCodes || []) {
      incrementCounter(quarantineReasons, reason);
    }
  }

  const timeline = snapshots.map((snapshot, index) => ({
    sequence: index + 1,
    at: snapshot.recordedAt,
    event: snapshot.snapshotId === currentSnapshot.snapshotId ? "current-decision" : "historical-decision",
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId,
    access: snapshot.access,
    outcome: snapshot.outcome,
    readinessState: snapshot.readinessState,
    dependencyState: snapshot.dependencyState || "unknown",
    providerId: snapshot.providerId,
    commandKey: snapshot.commandKey,
    violationCount: snapshot.violationCodes.length,
    warningCount: snapshot.warningCodes.length,
    writeDestinationState: snapshot.writeDestinationState || "not-recorded",
    quarantineRequired: snapshot.quarantineRequired === true,
    payloadIntegrity: snapshot.payloadIntegrity || "not-recorded",
    proofReference: snapshot.activeProofReference || null
  }));
  const exportRows = redactedReportSnapshots.map((snapshot) => ({
    recordedAt: snapshot.recordedAt,
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId,
    access: snapshot.access,
    outcome: snapshot.outcome,
    readinessState: snapshot.readinessState,
    dependencyState: snapshot.dependencyState || null,
    providerId: snapshot.providerId,
    pathHash: snapshot.pathHash,
    commandKey: snapshot.commandKey,
    violationCodes: snapshot.violationCodes.join("|"),
    warningCodes: snapshot.warningCodes.join("|"),
    writeDestinationState: snapshot.writeDestinationState || null,
    quarantineRequired: snapshot.quarantineRequired === true,
    quarantineReasonCodes: uniqueStrings(snapshot.quarantineReasonCodes).join("|"),
    payloadIntegrity: snapshot.payloadIntegrity || null,
    activeProofReference: snapshot.activeProofReference || null
  }));
  const exportManifest = {
    schema: "hosted-kernel-artifact-path-policy.analytics-export-manifest.v1",
    route: exportSettings.route,
    command: "artifact.path-policy.analytics.export",
    state: exportRows.length ? "ready" : "empty",
    format: exportSettings.format,
    redactionMode: exportSettings.redactionMode,
    rowCount: exportRows.length,
    requestedBy: exportSettings.requestedBy,
    cursor: currentSnapshot.snapshotId,
    window: {
      since: exportSettings.since,
      until: exportSettings.until,
      maxRows: exportSettings.maxRows
    },
    proof: exportSettings.includeProof
      ? {
          exportKey: `${surfaceId}:analytics-export:${lightweightHash({
            route: exportSettings.route,
            format: exportSettings.format,
            redactionMode: exportSettings.redactionMode,
            cursor: currentSnapshot.snapshotId,
            rowCount: exportRows.length,
            deltaState: delta.state
          })}`,
          snapshotHash: lightweightHash(redactedReportSnapshots),
          deltaHash: lightweightHash(delta),
          generatedBy: surfaceId
        }
      : null
  };

  return {
    schema: "hosted-kernel-artifact-path-policy.analytics.v1",
    generatedAt,
    currentSnapshot,
    exportSettings,
    delta,
    counters: {
      ...counters,
      byAccess,
      byViolation,
      byProvider,
      byReadinessState,
      byWriteDestinationState,
      byPayloadIntegrity,
      quarantineReasons
    },
    history: {
      retention: "last-50-policy-decisions",
      snapshots: exportSettings.includeHistory ? snapshots : [currentSnapshot],
      storedSnapshotCount: snapshots.length,
      reportSnapshotCount: reportSnapshots.length,
      sources: {
        suppliedAnalyticsHistory: normalizedHistory.length,
        persistedCommandHistory: persistedHistory.length,
        currentDecision: 1
      }
    },
    timeline: {
      cursor: currentSnapshot.snapshotId,
      eventCount: timeline.length,
      quarantineEventCount: timeline.filter((event) => event.quarantineRequired).length,
      events: exportSettings.includeTimeline ? timeline : timeline.slice(-1)
    },
    exports: {
      manifest: exportManifest,
      summary: {
        title: "Artifact path-policy decision history",
        format: exportSettings.format,
        rowCount: exportRows.length,
        state: exportManifest.state,
        route: exportManifest.route,
        redactionMode: exportSettings.redactionMode,
        deltaState: delta.state,
        fields: Object.keys(exportRows[0] || {
          recordedAt: null,
          tenantId: null,
          workspaceId: null,
          access: null,
          outcome: null,
          readinessState: null,
          dependencyState: null,
          providerId: null,
          pathHash: null,
          commandKey: null,
          violationCodes: null,
          warningCodes: null,
          writeDestinationState: null,
          quarantineRequired: null,
          quarantineReasonCodes: null,
          payloadIntegrity: null,
          activeProofReference: null
        })
      },
      rows: exportRows
    }
  };
}

export function describePathPolicySurface(input = {}) {
  const generatedAt = toIsoTimestamp(input.now);
  const artifactRoot = normalizePath(input.artifactRoot);
  const deniedSegments = new Set([...DEFAULT_DENIED_SEGMENTS, ...uniqueStrings(input.deniedSegments)]);
  const readOnlyPrefixes = uniqueStrings(input.readOnlyPrefixes).map((prefix) => normalizePath(prefix));
  const requestedAccess = input.access === "write" || input.access === "sync" ? input.access : "read";
  const tenantScope = normalizeTenantScope(input, artifactRoot);
  const actorPermissions = normalizeActorPermissions(input);
  const permissionDecision = buildPermissionDecision({
    access: requestedAccess,
    externalHandoff: input.externalHandoff,
    actorPermissions,
    tenantScope
  });
  const provider = normalizeProvider(input.provider);
  const tenantBoundary = buildTenantBoundaryContract({
    artifactRoot,
    tenantScope,
    requestedAccess,
    permissionDecision
  });
  const decision = buildPathDecision({
    path: input.path,
    artifactRoot,
    deniedSegments,
    readOnlyPrefixes,
    requestedAccess,
    tenantScope,
    permissionDecision,
    tenantBoundary
  });
  const syncMetadata = buildSyncMetadata({ decision, provider, input, generatedAt });
  const mutationPreconditions = normalizeMutationPreconditions(input, decision, syncMetadata);
  const externalHandoff = buildExternalHandoff({ decision, provider, input, tenantScope, permissionDecision });
  const lifecycleControls = buildLifecycleControls({ input, generatedAt, decision });
  const dependencyHealth = buildDependencyHealth({ input, generatedAt });
  const artifactWritePolicy = buildArtifactWritePolicy({
    input,
    generatedAt,
    decision,
    artifactRoot,
    deniedSegments
  });
  const validationSummary = summarizeValidation({
    decision,
    provider,
    syncMetadata,
    externalHandoff,
    lifecycleControls,
    mutationPreconditions,
    dependencyHealth,
    artifactWritePolicy
  });
  const preview = buildUserPreview({ decision, syncMetadata, externalHandoff, validationSummary });
  const acceptance = buildAcceptanceContract({
    decision,
    provider,
    validationSummary,
    externalHandoff,
    artifactWritePolicy,
    input
  });
  const serviceContract = buildProviderServiceContract({
    input,
    generatedAt,
    decision,
    provider,
    syncMetadata,
    externalHandoff,
    validationSummary
  });
  const readiness = buildReadiness({
    decision,
    provider,
    syncMetadata,
    externalHandoff,
    acceptance,
    validationSummary,
    lifecycleControls,
    serviceContract,
    mutationPreconditions,
    dependencyHealth,
    artifactWritePolicy
  });
  const operationalHealth = buildOperationalHealth({
    input,
    decision,
    provider,
    syncMetadata,
    externalHandoff,
    acceptance,
    readiness,
    validationSummary,
    dependencyHealth,
    generatedAt
  });
  const persistence = buildPersistenceContract({
    input,
    generatedAt,
    decision,
    provider,
    syncMetadata,
    externalHandoff,
    acceptance,
    readiness,
    serviceContract,
    operationalHealth,
    artifactWritePolicy
  });
  const nextSteps = buildNextSteps({
    decision,
    provider,
    validationSummary,
    acceptance,
    readiness,
    lifecycleControls,
    serviceContract
  });
  const stepResolution = buildStepResolutionContract({
    generatedAt,
    decision,
    acceptance,
    readiness,
    validationSummary,
    serviceContract,
    lifecycleControls,
    persistence,
    nextSteps
  });
  const clientWorkflowHandoff = buildClientWorkflowHandoff({
    input,
    generatedAt,
    decision,
    acceptance,
    readiness,
    validationSummary,
    serviceContract,
    lifecycleControls,
    artifactWritePolicy,
    externalHandoff,
    persistence,
    nextSteps,
    stepResolution
  });
  const clientReview = buildClientReviewPacket({
    generatedAt,
    decision,
    provider,
    preview,
    acceptance,
    readiness,
    validationSummary,
    lifecycleControls,
    artifactWritePolicy,
    dependencyHealth,
    serviceContract,
    persistence,
    clientWorkflowHandoff,
    nextSteps,
    stepResolution
  });
  const analytics = buildAnalyticsExports({
    input,
    generatedAt,
    artifactRoot,
    decision,
    provider,
    syncMetadata,
    externalHandoff,
    acceptance,
    readiness,
    validationSummary,
    artifactWritePolicy,
    operationalHealth,
    dependencyHealth,
    persistence
  });

  return {
    ok: readiness.ready,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt,
    wave: "ai-os-wave1-hosted-kernel-boot-proof",
    contract: {
      kind: "hosted-kernel-artifact-path-policy",
      version: "2026-07-01",
      artifactRoot,
      tenantScope,
      tenantBoundary,
      requiredCapabilities: KERNEL_REQUIRED_CAPABILITIES
    },
    provider,
    decision,
    syncMetadata,
    mutationPreconditions,
    artifactWritePolicy,
    externalHandoff,
    serviceContract,
    lifecycleControls,
    dependencyHealth,
    preview,
    acceptance,
    readiness,
    operationalHealth,
    persistence,
    analytics,
    validationSummary,
    nextSteps,
    stepResolution,
    clientWorkflowHandoff,
    clientReview,
    audit: {
      acceptedEvidence: Array.isArray(input.evidence) ? input.evidence.length : 0,
      checks: [
        "normalized-path",
        "path-evidence-contract",
        "raw-path-normalization-proof",
        "encoded-traversal-read-block",
        "path-control-character-block",
        "path-drive-letter-segment-block",
        "path-evidence-review-panel",
        "artifact-root-boundary",
        "tenant-workspace-boundary",
        "tenant-root-boundary-contract",
        "workspace-root-tenant-containment",
        "shared-read-prefix-tenant-containment",
        "cross-workspace-read-permission",
        "cross-workspace-write-block",
        "role-permission-grants",
        "actor-tenant-workspace-scope-claims",
        "denied-segment-filter",
        "readonly-prefix-filter",
        "provider-capability-negotiation",
        "sync-metadata-proof",
        "mutation-precondition-contract",
        "revision-conflict-detection",
        "content-hash-conflict-detection",
        "artifact-write-safe-target-policy",
        "artifact-write-quarantine-routing",
        "repo-relative-proof-reference-contract",
        "encoded-traversal-write-block",
        "external-handoff-state",
        "user-preview-contract",
        "acceptance-gate",
        "readiness-gates",
        "persisted-state-shaping",
        "persisted-recovery-checkpoint",
        "persisted-command-receipt-ledger",
        "restart-status-receipt-proof",
        "recovery-dispatch-state",
        "tenant-scoped-replay-key",
        "restart-recovery-path",
        "stale-prepared-command-expiry",
        "orphaned-prepared-command-quarantine",
        "terminal-command-outcome-finalization",
        "command-outcome-path-mismatch-guard",
        "restart-safe-command-status",
        "bounded-recovery-quarantine",
        "idempotent-command-key",
        "validation-summary",
        "explainable-next-steps",
        "operational-health-state",
        "retry-backoff-policy",
        "degraded-mode-contract",
        "actionable-error-contract",
        "analytics-counter-contract",
        "bounded-history-snapshots",
        "export-ready-policy-summary",
        "timeline-reporting-state",
        "analytics-export-settings-contract",
        "analytics-redacted-report-rows",
        "analytics-delta-reporting",
        "analytics-export-manifest-proof",
        "lifecycle-settings-validation",
        "lifecycle-command-alias-normalization",
        "unsupported-lifecycle-command-block",
        "lifecycle-enable-disable-controls",
        "lifecycle-command-availability-map",
        "lifecycle-command-gates",
        "schedule-control-contract",
        "invalid-schedule-timestamp-block",
        "maintenance-window-gating",
        "client-review-lifecycle-panel",
        "lifecycle-next-action-state",
        "provider-service-contract-negotiation",
        "service-invocation-idempotency",
        "sync-commit-service-plan",
        "leased-external-handoff-envelope",
        "client-review-packet",
        "client-request-state-normalization",
        "client-runtime-capability-contract",
        "client-runtime-route-command-action-gating",
        "client-workflow-handoff-contract",
        "resume-token-proof",
        "route-command-handoff-payload",
        "continuation-token-adoption",
        "workflow-transfer-plan-contract",
        "quarantine-review-transfer-stage",
        "direct-write-transfer-stage",
        "external-handoff-transfer-stage",
        "runtime-upgrade-required-handoff-state",
        "acceptance-panel-contract",
        "readiness-panel-gates",
        "validation-panel-items",
        "route-bound-next-actions",
        "step-resolution-route-index",
        "step-resolution-payload-contract",
        "step-resolution-audit-proof"
      ],
      evidence: Array.isArray(input.evidence) ? input.evidence : []
    }
  };
}

export default describePathPolicySurface;
