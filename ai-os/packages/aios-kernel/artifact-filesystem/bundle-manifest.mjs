import { createHash } from "node:crypto";

export const surfaceId = "aios_artifact-filesystem_bundle-manifest_033";
export const surfaceGroup = "artifact-filesystem";
export const surfaceName = "bundle-manifest";

const DEFAULT_RUNTIME = "hosted-kernel";
const DEFAULT_ROUTE = "artifact-filesystem.bundle-manifest";
const BUNDLE_MANIFEST_SCHEMA = "aios.artifactFilesystem.bundleManifest.v1";
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const DIGEST_PROOF_PATTERN = /^(sha256|sha384|sha512|blake3)[:=-]([A-Fa-f0-9]{32,256})$/;
const RECOVERABLE_STATUSES = new Set(["accepted", "persisted", "publishing", "handoff-ready"]);
const TERMINAL_STATUSES = new Set(["published", "failed", "abandoned"]);
const HEALTH_SEVERITY_RANK = { healthy: 0, degraded: 1, retrying: 2, failed: 3 };
const REQUIRED_PROVIDER_CAPABILITIES = ["artifact.persist", "artifact.publish", "manifest.audit"];
const OPTIONAL_PROVIDER_CAPABILITIES = ["manifest.sync", "handoff.external", "digest.verify"];
const PROVIDER_CAPABILITY_PROFILES = {
  "durable-external": ["artifact.persist", "artifact.publish", "manifest.audit", "manifest.sync", "handoff.external", "digest.verify"],
  "audited-inline": ["artifact.persist", "artifact.publish", "manifest.audit", "manifest.sync"],
  "stateless-audit": ["artifact.persist", "artifact.publish", "manifest.audit"]
};
const SUPPORTED_PROVIDER_CAPABILITIES = new Set([
  ...REQUIRED_PROVIDER_CAPABILITIES,
  ...OPTIONAL_PROVIDER_CAPABILITIES,
  "manifest.preview",
  "manifest.analytics"
]);
const FAILURE_CLASS_BY_ISSUE_CODE = {
  "invalid-artifact-path": "validation",
  "invalid-artifact-digest": "proof-gap",
  "missing-artifact-digest": "proof-gap",
  "tenant-workspace-mismatch": "boundary",
  "artifact-tenant-boundary-violation": "boundary",
  "artifact-workspace-boundary-violation": "boundary",
  "tenant-handoff-requires-trusted-role": "authorization",
  "tenant-handoff-audit-required": "boundary",
  "role-outside-workspace-boundary": "authorization",
  "missing-publish-permissions": "authorization",
  "artifact-outside-workspace-scope": "boundary",
  "artifact-crosses-workspace-boundary": "boundary",
  "packet-boundary-attestation-blocked": "boundary",
  "lifecycle-disabled": "lifecycle",
  "lifecycle-schedule-window-closed": "lifecycle",
  "lifecycle-unknown-command": "validation",
  "lifecycle-invalid-schedule": "validation",
  "provider-unavailable": "provider",
  "provider-missing-capability": "provider",
  "provider-unsupported-capability": "provider",
  "provider-contract-mismatch": "provider",
  "stale-command-ack": "persistence",
  "stale-command-completion": "persistence",
  "command-retry-exhausted": "persistence"
};
const ACTION_BY_FAILURE_CLASS = {
  authorization: "Grant the actor publish access or route the handoff through a kernel-worker with artifact publish permission.",
  boundary: "Move artifacts under the workspace root or update the workspace scope before retrying the bundle handoff.",
  validation: "Repair bundle artifact fields before retrying; invalid paths are never replayed by the hosted kernel.",
  "proof-gap": "Attach content digests before final publish, or continue in degraded handoff mode with digest follow-up required.",
  persistence: "Retry persistence with the same idempotency key after the backoff window.",
  empty: "Attach at least one artifact before requesting bundle manifest handoff.",
  lifecycle: "Enable the bundle-manifest lifecycle control or wait for the scheduled activation window before replaying.",
  provider: "Select a hosted-kernel provider that is online and advertises artifact persistence, publish, and audit capabilities."
};
const RETRYABLE_FAILURE_CLASSES = new Set(["persistence"]);
const DEFAULT_HEALTH_POLICY = {
  maxRetryAttempts: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 30000,
  commandAckTimeoutMs: 45000,
  commandCompletionTimeoutMs: 300000,
  degradedModeEnabled: true
};
const ROLE_PERMISSIONS = {
  owner: ["artifact:read", "artifact:write", "artifact:publish", "artifact:audit"],
  maintainer: ["artifact:read", "artifact:write", "artifact:publish", "artifact:audit"],
  contributor: ["artifact:read", "artifact:write", "artifact:audit"],
  reviewer: ["artifact:read", "artifact:audit"],
  viewer: ["artifact:read"],
  "kernel-worker": ["artifact:read", "artifact:write", "artifact:publish", "artifact:audit"]
};
const REQUIRED_PUBLISH_PERMISSIONS = ["artifact:read", "artifact:write", "artifact:publish"];
const LIFECYCLE_COMMANDS = new Set(["publish", "pause", "resume", "disable", "enable", "reschedule"]);
const LIFECYCLE_SCHEDULE_MODES = new Set(["immediate", "scheduled", "paused"]);
const LIFECYCLE_OPEN_COMMANDS = new Set(["publish", "resume", "enable"]);
const LIFECYCLE_HOLD_COMMANDS = new Set(["pause", "disable"]);
const LIFECYCLE_DISABLE_COMMANDS = new Set(["disable"]);
const DEFAULT_LIFECYCLE_SCHEDULE_POLICY = {
  minLeadTimeMs: 0,
  maxLeadTimeMs: 30 * 24 * 60 * 60 * 1000,
  maxDisableMs: 7 * 24 * 60 * 60 * 1000
};
const LIFECYCLE_COMMAND_LABELS = {
  publish: "Publish now",
  pause: "Pause publishing",
  resume: "Resume publishing",
  disable: "Disable lifecycle",
  enable: "Enable lifecycle",
  reschedule: "Reschedule publish"
};
const CLIENT_HANDOFF_CHANNELS = new Set(["inline", "external", "deferred", "audit-only"]);
const CLIENT_NOTIFY_EVENTS = new Set(["accepted", "blocked", "published", "failed", "digest-followup"]);
const CLIENT_RESPONSE_FORMATS = new Set(["summary", "manifest", "audit-envelope", "handoff-envelope"]);
const CLIENT_URGENCY_LEVELS = new Set(["background", "interactive", "blocking"]);
const PREVIEW_DECISION_ACTIONS = new Set(["accept", "defer", "reject", "request-changes"]);
const COMMAND_JOURNAL_STATUSES = new Set(["queued", "in-flight", "acknowledged", "completed", "failed", "abandoned"]);
const COMMAND_TERMINAL_STATUSES = new Set(["acknowledged", "completed", "abandoned"]);
const COMMAND_SUCCESS_STATUSES = new Set(["acknowledged", "completed"]);
const PACKET_CHECKPOINT_STATES = new Set(["missing", "written", "claimed", "released", "failed"]);
const PACKET_CHECKPOINT_TERMINAL_STATES = new Set(["claimed", "released"]);
const TENANT_ISOLATION_MODES = new Set(["strict", "handoff-only", "shared-read"]);
const TRUSTED_HANDOFF_ROLES = new Set(["owner", "maintainer", "kernel-worker"]);
const VALIDATION_SEVERITIES = ["error", "warning", "info"];
const CONTENT_ADDRESSED_PACKET_KINDS = ["boot", "run", "claim", "release", "recovery"];
const PACKET_KIND_STAGE = {
  boot: "runtime-bootstrap",
  run: "publish-command",
  claim: "provider-claim",
  release: "client-release",
  recovery: "recovery-ticket"
};
const REQUIRED_PACKET_SUBJECT_FIELDS = {
  boot: ["bundleId", "route", "runtime", "tenantId", "workspaceId", "actorId", "actorRole", "providerId"],
  run: ["bundleId", "route", "tenantId", "workspaceId", "command", "commandId", "durableCommandId"],
  claim: ["bundleId", "route", "tenantId", "workspaceId", "providerId", "negotiationProofId", "externalHandoffId"],
  release: ["bundleId", "route", "tenantId", "workspaceId", "acceptanceState", "decisionState", "deliveryState"],
  recovery: ["bundleId", "route", "tenantId", "workspaceId", "healthStatus", "recoveryTicketId", "recoveryTicketState"]
};
const PACKET_FAILURE_ACTIONS = {
  boundary: "Resolve packet boundary attestations before replaying the content-addressed packet set.",
  persistence: "Rewrite the packet checkpoint with the same subject digest after the retry window opens.",
  validation: "Repair the packet subject fields and regenerate the content-addressed packet proof.",
  "proof-gap": "Regenerate the packet proof envelope before handing the packet to the provider."
};

function asIsoTimestamp(value) {
  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function normalizeIdentifier(value, fallback) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return SAFE_ID_PATTERN.test(candidate) ? candidate : fallback;
}

function normalizeOptionalIdentifier(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return SAFE_ID_PATTERN.test(candidate) ? candidate : null;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))];
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Digest(value) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function isPresentPacketValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  return typeof value !== "string" || value.trim().length > 0;
}

function digestParts(value, fallbackAlgorithm = "sha256") {
  const raw = typeof value === "string" ? value.trim() : "";
  const match = /^(sha256|sha384|sha512|blake3):([A-Fa-f0-9]{32,256})$/.exec(raw);
  if (!match) {
    return {
      algorithm: fallbackAlgorithm,
      hex: null,
      digest: null,
      valid: false
    };
  }
  const algorithm = match[1];
  const hex = match[2].toLowerCase();
  return {
    algorithm,
    hex,
    digest: `${algorithm}:${hex}`,
    valid: true
  };
}

function decodeReferencePath(value) {
  try {
    return {
      value: decodeURIComponent(value),
      malformed: false
    };
  } catch {
    return {
      value,
      malformed: true
    };
  }
}

function inspectReferencePath(value, fallback, options = {}) {
  const raw = typeof value === "string" ? value.trim() : "";
  const reasons = [];
  let candidate = raw || fallback;

  if (!raw) {
    reasons.push("path-missing-used-fallback");
  }
  if (typeof value === "string" && value !== raw) {
    reasons.push("path-trimmed");
  }
  if (/[\u0000-\u001F\u007F]/.test(candidate)) {
    reasons.push("path-contains-control-character");
  }

  const schemeMatch = candidate.match(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/]*)(\/?.*)$/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    const host = schemeMatch[2];
    const path = schemeMatch[3] || "";
    if (scheme === "aios://" && host === "artifact-root") {
      candidate = path;
      reasons.push("path-root-uri-stripped");
    } else {
      reasons.push("path-uses-unsupported-root-uri");
      candidate = path || host || fallback;
    }
  }

  if (candidate.startsWith("/")) {
    reasons.push("path-was-absolute");
  }
  if (candidate.includes("\\")) {
    reasons.push("path-contained-backslash");
    candidate = candidate.replace(/\\/g, "/");
  }

  const decoded = decodeReferencePath(candidate);
  if (decoded.malformed) {
    reasons.push("path-has-malformed-encoding");
  }
  if (decoded.value !== candidate) {
    reasons.push("path-was-percent-decoded");
  }
  candidate = decoded.value;

  const segments = [];
  for (const segment of candidate.replace(/^\/+/, "").split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      reasons.push("path-traversal-segment");
      continue;
    }
    if (/[\u0000-\u001F\u007F]/.test(segment)) {
      reasons.push("path-segment-contains-control-character");
      continue;
    }
    segments.push(segment);
  }

  const normalizedPath = (segments.length > 0 ? segments.join("/") : fallback).replace(/\/$/g, "");
  const blockingReasons = reasons.filter((reason) => [
    "path-contains-control-character",
    "path-uses-unsupported-root-uri",
    "path-was-absolute",
    "path-has-malformed-encoding",
    "path-traversal-segment",
    "path-segment-contains-control-character",
    ...(options.requireInput ? ["path-missing-used-fallback"] : [])
  ].includes(reason));

  return {
    originalPath: typeof value === "string" ? value : null,
    normalizedPath,
    canonicalPath: normalizedPath,
    pathChanged: raw !== normalizedPath,
    valid: blockingReasons.length === 0,
    reasons: normalizeStringList(reasons),
    blockingReasons: normalizeStringList(blockingReasons)
  };
}

function normalizeReferencePath(value, fallback) {
  return inspectReferencePath(value, fallback).normalizedPath;
}

export function createBundleManifestReference(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const bundleId = normalizeIdentifier(source.bundleId, "bundle-manifest");
  const digestSource = source.manifestDigest || source.digest || source.subjectDigest;
  const parsed = digestParts(digestSource);
  const digest = parsed.valid ? parsed.digest : sha256Digest({
    bundleId,
    artifacts: Array.isArray(source.artifacts) ? source.artifacts : [],
    route: source.route || DEFAULT_ROUTE,
    tenantId: source.tenantId || "local-workspace",
    workspaceId: source.workspaceId || source.tenantId || "local-workspace"
  });
  const resolved = digestParts(digest);
  const contentAddressRootInspection = inspectReferencePath(source.contentAddressRoot || source.casRoot, "cas/bundle-manifests");
  const logicalRootInspection = inspectReferencePath(source.logicalRoot || source.rootPrefix, "manifests");
  const prefix = contentAddressRootInspection.normalizedPath;
  const logicalRoot = logicalRootInspection.normalizedPath;
  const digestDirectory = `${prefix}/${resolved.algorithm}/${resolved.hex}`;
  const manifestPath = `${digestDirectory}/manifest.json`;
  const proofPath = `${digestDirectory}/proof.json`;
  const indexPath = `${logicalRoot}/${bundleId}/manifest.ref.json`;
  const referencePathPolicy = {
    contractVersion: `${BUNDLE_MANIFEST_SCHEMA}.referencePathPolicy.v1`,
    valid: contentAddressRootInspection.valid && logicalRootInspection.valid,
    contentAddressRoot: contentAddressRootInspection,
    logicalRoot: logicalRootInspection,
    blockingReasons: normalizeStringList([
      ...contentAddressRootInspection.blockingReasons.map((reason) => `contentAddressRoot:${reason}`),
      ...logicalRootInspection.blockingReasons.map((reason) => `logicalRoot:${reason}`)
    ])
  };

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.contentAddressedManifestReference`,
    bundleId,
    digest: resolved.digest,
    algorithm: resolved.algorithm,
    hex: resolved.hex,
    contentAddressRoot: prefix,
    digestDirectory,
    manifestPath,
    proofPath,
    indexPath,
    uri: `aios://artifact-root/${manifestPath}`,
    immutable: true,
    referenceType: "content-addressed-bundle-manifest",
    pathPolicy: referencePathPolicy,
    verification: {
      digestValid: resolved.valid,
      expectedDigest: resolved.digest,
      requiredPaths: [manifestPath, proofPath, indexPath],
      pathPolicyClear: referencePathPolicy.valid,
      replaySafe: resolved.valid && referencePathPolicy.valid
    }
  };
}

function createContentAddressedPacketReference({ bundleId, kind, subject, manifestReference, route, boundaryGate }) {
  const subjectDigest = sha256Digest(subject);
  const digest = digestParts(subjectDigest);
  const root = normalizeReferencePath(manifestReference.contentAddressRoot, "cas/bundle-manifests");
  const packetDirectory = `${root}/${digest.algorithm}/${digest.hex}/packets/${kind}`;
  const packetPath = `${packetDirectory}/packet.json`;
  const proofPath = `${packetDirectory}/packet.proof.json`;
  const requiredSubjectFields = REQUIRED_PACKET_SUBJECT_FIELDS[kind] || ["bundleId", "route", "tenantId", "workspaceId"];
  const missingSubjectFields = requiredSubjectFields.filter((field) => !isPresentPacketValue(subject[field]));
  const subjectComplete = missingSubjectFields.length === 0;
  const boundaryClear = boundaryGate?.clear !== false;
  const proofId = `${bundleId}:packet:${kind}:${digest.hex.slice(0, 16)}`;
  const replaySafe = digest.valid && subjectComplete && boundaryClear;
  const issue = !subjectComplete
    ? {
        code: "packet-subject-incomplete",
        severity: "error",
        packetKind: kind,
        missingSubjectFields,
        detail: "Content-addressed bundle manifest packet subject is missing fields required for replay verification."
      }
    : !boundaryClear
      ? {
          code: "packet-boundary-attestation-blocked",
          severity: "error",
          packetKind: kind,
          clearanceState: boundaryGate.clearanceState,
          blockingIssueCodes: boundaryGate.blockingIssueCodes,
          detail: "Content-addressed bundle manifest packet cannot replay until workspace, tenant, and audit handoff boundary attestations are clear."
        }
      : null;

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.contentAddressedPacketReference`,
    packetKind: kind,
    stage: PACKET_KIND_STAGE[kind],
    bundleId,
    route: `${route}.${kind}`,
    subjectDigest,
    digestAlgorithm: digest.algorithm,
    digestHex: digest.hex,
    packetDirectory,
    packetPath,
    proofPath,
    uri: `aios://artifact-root/${packetPath}`,
    proofId,
    immutable: true,
    subjectComplete,
    replaySafe,
    issue,
    verification: {
      digestValid: digest.valid,
      expectedDigest: subjectDigest,
      proofId,
      requiredPaths: [packetPath, proofPath],
      requiredSubjectFields,
      missingSubjectFields,
      subjectComplete,
      boundaryClear,
      boundaryGate,
      replaySafe,
      canonicalSubject: subject
    }
  };
}

function buildPacketBoundaryAttestation({ bundleId, generatedAt, requestState, workspaceScope, actorAccess, boundaryEvaluation, tenantIsolation }) {
  const boundaryBlockingCodes = boundaryEvaluation.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);
  const tenantBlockingCodes = tenantIsolation.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);
  const boundaryClear = boundaryEvaluation.blockingIssueCount === 0 || boundaryEvaluation.boundaryMode === "advisory";
  const auditHandoffReady = tenantIsolation.auditHandoff.ready;
  const isolationClear = tenantIsolation.clear;
  const common = {
    tenantId: requestState.tenantId,
    workspaceId: workspaceScope.workspaceId,
    workspaceRootPrefix: workspaceScope.rootPrefix || "bundle-relative",
    actorId: actorAccess.actorId,
    actorRole: actorAccess.role,
    actorCanPublish: actorAccess.canPublish,
    isolationMode: tenantIsolation.isolationMode,
    auditHandoffRequired: tenantIsolation.auditHandoff.required,
    auditHandoffReady,
    auditHandoffToken: tenantIsolation.auditHandoff.required ? tenantIsolation.auditHandoff.token : null,
    crossTenantArtifactIds: tenantIsolation.crossTenantArtifactIds,
    crossWorkspaceArtifactIds: tenantIsolation.crossWorkspaceArtifactIds
  };
  const packetRequirements = {
    boot: ["workspace-boundary", "role-allowed"],
    run: ["workspace-boundary", "tenant-isolation", "publish-permission"],
    claim: ["workspace-boundary", "tenant-isolation", "audit-handoff"],
    release: ["workspace-boundary", "client-visible-boundary-state"],
    recovery: ["workspace-boundary", "replay-safe-boundary-state"]
  };
  const gateByKind = Object.fromEntries(CONTENT_ADDRESSED_PACKET_KINDS.map((kind) => {
    const requiresAudit = packetRequirements[kind].includes("audit-handoff");
    const clear = boundaryClear
      && isolationClear
      && actorAccess.canPublish
      && (!requiresAudit || auditHandoffReady);
    const blockingIssueCodes = [
      ...boundaryBlockingCodes,
      ...tenantBlockingCodes,
      ...actorAccess.missingPublishPermissions.map((permission) => `missing:${permission}`),
      requiresAudit && !auditHandoffReady ? "tenant-audit-handoff-not-ready" : null
    ].filter(Boolean);
    const clearanceState = clear
      ? "clear"
      : requiresAudit && !auditHandoffReady
        ? "audit-handoff-blocked"
        : !isolationClear
          ? "tenant-isolation-blocked"
          : !boundaryClear
            ? "workspace-boundary-blocked"
            : "publish-permission-blocked";
    const subject = {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.packetBoundaryAttestationSubject`,
      bundleId,
      packetKind: kind,
      generatedAt,
      route: `${requestState.route}.${kind}`,
      requiredClearances: packetRequirements[kind],
      clearanceState,
      clear,
      blockingIssueCodes,
      ...common
    };

    return [kind, {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.packetBoundaryGate`,
      packetKind: kind,
      requiredClearances: packetRequirements[kind],
      clear,
      clearanceState,
      blockingIssueCodes,
      subjectDigest: sha256Digest(subject),
      canonicalSubject: subject
    }];
  }));

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.packetBoundaryAttestation`,
    bundleId,
    generatedAt,
    state: CONTENT_ADDRESSED_PACKET_KINDS.every((kind) => gateByKind[kind].clear) ? "clear" : "blocked",
    boundaryClear,
    isolationClear,
    actorCanPublish: actorAccess.canPublish,
    auditHandoffReady,
    gateByKind,
    blockedPacketKinds: CONTENT_ADDRESSED_PACKET_KINDS.filter((kind) => !gateByKind[kind].clear),
    attestationDigest: sha256Digest({
      bundleId,
      boundaryClear,
      isolationClear,
      actorCanPublish: actorAccess.canPublish,
      auditHandoffReady,
      gates: CONTENT_ADDRESSED_PACKET_KINDS.map((kind) => ({
        packetKind: kind,
        clearanceState: gateByKind[kind].clearanceState,
        subjectDigest: gateByKind[kind].subjectDigest
      }))
    })
  };
}

function buildContentAddressedPacketClaim({ bundleId, generatedAt, manifestDigest, packet, ordinal, packetSetDirectory }) {
  const claimSubject = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.contentAddressedPacketClaimSubject`,
    bundleId,
    generatedAt,
    manifestDigest,
    packetKind: packet.packetKind,
    stage: packet.stage,
    packetPath: packet.packetPath,
    proofPath: packet.proofPath,
    packetSubjectDigest: packet.subjectDigest,
    packetProofId: packet.proofId,
    subjectComplete: packet.subjectComplete,
    replaySafe: packet.replaySafe
  };
  const claimDigest = sha256Digest(claimSubject);
  const claimHex = digestParts(claimDigest).hex;
  const claimPath = `${packetSetDirectory}/claims/${String(ordinal + 1).padStart(2, "0")}-${packet.packetKind}.claim.json`;

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.contentAddressedPacketClaim`,
    bundleId,
    generatedAt,
    packetKind: packet.packetKind,
    stage: packet.stage,
    claimId: `${bundleId}:packet-claim:${packet.packetKind}:${claimHex.slice(0, 16)}`,
    claimDigest,
    claimPath,
    uri: `aios://artifact-root/${claimPath}`,
    manifestDigest,
    packetSubjectDigest: packet.subjectDigest,
    packetProofId: packet.proofId,
    packetPath: packet.packetPath,
    proofPath: packet.proofPath,
    subjectComplete: packet.subjectComplete,
    replaySafe: packet.replaySafe,
    canonicalSubject: claimSubject,
    verification: {
      digestValid: true,
      expectedDigest: claimDigest,
      requiredPaths: [claimPath, packet.packetPath, packet.proofPath],
      requiredPacketKind: packet.packetKind,
      requiredStage: packet.stage,
      replaySafe: packet.replaySafe
    }
  };
}

function buildPacketRecoveryProfile({ packet, persistedCheckpoint, operationalHealth, generatedAt }) {
  const checkpointFailed = persistedCheckpoint?.state === "failed";
  const issueClass = packet.issue
    ? FAILURE_CLASS_BY_ISSUE_CODE[packet.issue.code] || (packet.issue.code === "packet-subject-incomplete" ? "validation" : "boundary")
    : checkpointFailed
      ? "persistence"
      : !packet.replaySafe
        ? "proof-gap"
        : null;
  const issueCode = packet.issue?.code || (checkpointFailed ? "packet-checkpoint-failed" : !packet.replaySafe ? "packet-proof-unavailable" : null);
  const severity = packet.issue?.severity || (checkpointFailed ? "warning" : !packet.replaySafe ? "warning" : "info");
  const retryable = issueClass === "persistence"
    && packet.subjectComplete
    && packet.verification.boundaryClear
    && !operationalHealth.retryPlan.exhausted;
  const degradedAllowed = operationalHealth.degradedMode
    && packet.packetKind !== "run"
    && packet.subjectComplete
    && packet.verification.boundaryClear
    && issueClass === "proof-gap";
  const failureState = issueCode
    ? {
        schema: `${BUNDLE_MANIFEST_SCHEMA}.packetFailureState`,
        packetKind: packet.packetKind,
        code: issueCode,
        severity,
        class: issueClass,
        retryable,
        degradedAllowed,
        checkpointState: persistedCheckpoint?.state || "missing",
        missingSubjectFields: packet.verification.missingSubjectFields,
        blockingIssueCodes: packet.verification.boundaryGate?.blockingIssueCodes || [],
        action: PACKET_FAILURE_ACTIONS[issueClass] || PACKET_FAILURE_ACTIONS.validation
      }
    : null;
  const retryWindow = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.packetRetryWindow`,
    retryable,
    attempt: operationalHealth.retryPlan.attempt,
    maxAttempts: operationalHealth.retryPlan.maxAttempts,
    exhausted: operationalHealth.retryPlan.exhausted,
    backoffMs: retryable ? operationalHealth.retryPlan.backoffMs : 0,
    retryAt: retryable ? operationalHealth.retryPlan.retryAt || generatedAt : null,
    idempotencyKey: operationalHealth.retryPlan.idempotencyKey,
    commandId: retryable ? operationalHealth.retryPlan.commandId : null
  };
  const state = !failureState
    ? "clear"
    : failureState.severity === "error"
      ? "blocked"
      : retryable
        ? "retry-scheduled"
        : degradedAllowed
          ? "degraded"
          : "attention-required";
  const actionableError = failureState
    ? {
        schema: `${BUNDLE_MANIFEST_SCHEMA}.packetActionableError`,
        packetKind: packet.packetKind,
        code: failureState.code,
        class: failureState.class,
        severity: failureState.severity,
        message: failureState.code === "packet-subject-incomplete"
          ? `The ${packet.packetKind} packet is missing ${failureState.missingSubjectFields.join(", ")}.`
          : failureState.code === "packet-boundary-attestation-blocked"
            ? `The ${packet.packetKind} packet is blocked by ${failureState.blockingIssueCodes.join(", ") || "packet boundary attestations"}.`
            : failureState.code === "packet-checkpoint-failed"
              ? `The ${packet.packetKind} packet checkpoint failed and should be rewritten with its current subject digest.`
              : `The ${packet.packetKind} packet proof is not replay-safe yet.`,
        nextAction: retryable
          ? "retry-packet-checkpoint-after-backoff"
          : degradedAllowed
            ? "continue-degraded-packet-handoff"
            : failureState.action,
        retryAt: retryWindow.retryAt,
        recoveryTicketId: operationalHealth.recoveryTicket.ticketId
      }
    : null;

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.packetRecoveryProfile`,
    packetKind: packet.packetKind,
    state,
    healthy: state === "clear",
    replaySafe: packet.replaySafe,
    failureState,
    retryWindow,
    degradedAllowed,
    actionableError,
    checkpointState: persistedCheckpoint?.state || "missing",
    recoveredFromCheckpoint: Boolean(persistedCheckpoint?.subjectDigest && persistedCheckpoint.subjectDigest === packet.subjectDigest)
  };
}

function buildContentAddressedPacketManifest({
  bundleId,
  generatedAt,
  requestState,
  clientState,
  workspaceScope,
  actorAccess,
  boundaryEvaluation,
  manifestIntegrity,
  persistedState,
  restartStatus,
  command,
  commandReplay,
  lifecycleSettings,
  providerContract,
  tenantIsolation,
  validationSummary,
  acceptance,
  previewDecision,
  clientWorkflow,
  operationalHealth
}) {
  const packetBoundaryAttestation = buildPacketBoundaryAttestation({
    bundleId,
    generatedAt,
    requestState,
    workspaceScope,
    actorAccess,
    boundaryEvaluation,
    tenantIsolation
  });
  const commonSubject = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.packetCommonSubject`,
    bundleId,
    generatedAt,
    route: requestState.route,
    runtime: requestState.runtime,
    tenantId: requestState.tenantId,
    workspaceId: workspaceScope.workspaceId,
    requestId: clientState.requestId,
    correlationId: clientState.correlationId,
    manifestDigest: manifestIntegrity.manifestDigest,
    manifestReferenceUri: manifestIntegrity.manifestReference.uri,
    durableCommandId: commandReplay.durableCommandId,
    idempotencyKey: command.idempotencyKey,
    boundaryAttestationDigest: packetBoundaryAttestation.attestationDigest
  };
  const packetSubjects = {
    boot: {
      ...commonSubject,
      schema: `${BUNDLE_MANIFEST_SCHEMA}.bootPacketSubject`,
      stage: PACKET_KIND_STAGE.boot,
      actorId: actorAccess.actorId,
      actorRole: actorAccess.role,
      boundaryClearanceState: packetBoundaryAttestation.gateByKind.boot.clearanceState,
      boundaryGateDigest: packetBoundaryAttestation.gateByKind.boot.subjectDigest,
      lifecycleCommandId: lifecycleSettings.commandId,
      lifecycleEffectiveState: lifecycleSettings.effectiveState,
      lifecycleControlAccepted: lifecycleSettings.commandState.accepted,
      lifecycleNextAction: lifecycleSettings.nextLifecycleAction,
      providerId: providerContract.providerId,
      providerSelectedMode: providerContract.capabilityProfile.selectedMode,
      restartRevision: persistedState.revision
    },
    run: {
      ...commonSubject,
      schema: `${BUNDLE_MANIFEST_SCHEMA}.runPacketSubject`,
      stage: PACKET_KIND_STAGE.run,
      command: command.command,
      commandId: command.commandId,
      safeToReplay: command.safeToReplay,
      artifactIds: command.artifactIds,
      commandReplayDisposition: commandReplay.disposition,
      duplicateSuppressed: commandReplay.duplicateSuppressed,
      boundaryClearanceState: packetBoundaryAttestation.gateByKind.run.clearanceState,
      boundaryGateDigest: packetBoundaryAttestation.gateByKind.run.subjectDigest,
      lifecycleCommandId: lifecycleSettings.commandId,
      lifecycleResumeToken: lifecycleSettings.commandState.resumeToken,
      lifecyclePublishAllowedNow: lifecycleSettings.publishAllowedNow,
      restartStatus: restartStatus.status
    },
    claim: {
      ...commonSubject,
      schema: `${BUNDLE_MANIFEST_SCHEMA}.claimPacketSubject`,
      stage: PACKET_KIND_STAGE.claim,
      providerId: providerContract.providerId,
      negotiationProofId: providerContract.capabilityNegotiation.proofId,
      negotiationDigest: providerContract.capabilityNegotiation.subjectDigest,
      externalHandoffId: providerContract.externalHandoff.id,
      externalHandoffState: providerContract.externalHandoff.state,
      syncWatermark: providerContract.sync.watermark,
      boundaryClearanceState: packetBoundaryAttestation.gateByKind.claim.clearanceState,
      boundaryGateDigest: packetBoundaryAttestation.gateByKind.claim.subjectDigest,
      tenantAuditHandoffToken: tenantIsolation.auditHandoff.required ? tenantIsolation.auditHandoff.token : null
    },
    release: {
      ...commonSubject,
      schema: `${BUNDLE_MANIFEST_SCHEMA}.releasePacketSubject`,
      stage: PACKET_KIND_STAGE.release,
      acceptanceState: acceptance.state,
      acceptanceToken: acceptance.acceptanceToken,
      decisionState: previewDecision.state,
      decisionToken: previewDecision.decisionToken,
      deliveryState: clientWorkflow.delivery.state,
      deliveryEnvelopeId: clientWorkflow.delivery.envelopeId,
      boundaryClearanceState: packetBoundaryAttestation.gateByKind.release.clearanceState,
      boundaryGateDigest: packetBoundaryAttestation.gateByKind.release.subjectDigest,
      callbackEventName: clientWorkflow.callbackEvent.eventName
    },
    recovery: {
      ...commonSubject,
      schema: `${BUNDLE_MANIFEST_SCHEMA}.recoveryPacketSubject`,
      stage: PACKET_KIND_STAGE.recovery,
      healthStatus: operationalHealth.status,
      recoveryTicketId: operationalHealth.recoveryTicket.ticketId,
      recoveryTicketState: operationalHealth.recoveryTicket.state,
      recoveryTicketDigest: operationalHealth.recoveryTicket.subjectDigest,
      retryAt: operationalHealth.retryPlan.retryAt,
      boundaryClearanceState: packetBoundaryAttestation.gateByKind.recovery.clearanceState,
      boundaryGateDigest: packetBoundaryAttestation.gateByKind.recovery.subjectDigest,
      replayWatchdogState: operationalHealth.replayWatchdog.state,
      blockingIssueCount: validationSummary.counts.errors
    }
  };
  const packets = Object.fromEntries(CONTENT_ADDRESSED_PACKET_KINDS.map((kind) => [
    kind,
    createContentAddressedPacketReference({
      bundleId,
      kind,
      subject: packetSubjects[kind],
      manifestReference: manifestIntegrity.manifestReference,
      route: requestState.route,
      boundaryGate: packetBoundaryAttestation.gateByKind[kind]
    })
  ]));
  const packetList = CONTENT_ADDRESSED_PACKET_KINDS.map((kind) => packets[kind]);
  const unresolvedPackets = packetList
    .filter((packet) => !packet.verification.replaySafe)
    .map((packet) => packet.packetKind);
  const packetIssues = packetList
    .map((packet) => packet.issue)
    .filter(Boolean);
  const manifestDigest = digestParts(manifestIntegrity.manifestDigest);
  const packetSetDirectory = `${manifestIntegrity.manifestReference.contentAddressRoot}/${manifestDigest.algorithm}/${manifestDigest.hex}/packet-set`;
  const contentAddressedIndexPath = `${packetSetDirectory}/packets.index.json`;
  const proofEnvelopePath = `${packetSetDirectory}/packets.proof.json`;
  const replayLedgerPath = `${packetSetDirectory}/replay-ledger.json`;
  const packetClaims = packetList.map((packet, ordinal) => buildContentAddressedPacketClaim({
    bundleId,
    generatedAt,
    manifestDigest: manifestIntegrity.manifestDigest,
    packet,
    ordinal,
    packetSetDirectory
  }));
  const packetClaimsByKind = Object.fromEntries(packetClaims.map((claim) => [claim.packetKind, claim]));
  const packetRecoveryProfiles = packetList.map((packet) => buildPacketRecoveryProfile({
    packet,
    persistedCheckpoint: persistedState.packetCheckpoints[packet.packetKind],
    operationalHealth,
    generatedAt
  }));
  const packetRecoveryProfilesByKind = Object.fromEntries(packetRecoveryProfiles.map((profile) => [profile.packetKind, profile]));
  const blockedPacketProfiles = packetRecoveryProfiles.filter((profile) => profile.state === "blocked");
  const retryPacketProfiles = packetRecoveryProfiles.filter((profile) => profile.state === "retry-scheduled");
  const degradedPacketProfiles = packetRecoveryProfiles.filter((profile) => profile.state === "degraded");
  const packetSetSubject = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.contentAddressedPacketSetSubject`,
    bundleId,
    generatedAt,
    manifestDigest: manifestIntegrity.manifestDigest,
    manifestReferenceUri: manifestIntegrity.manifestReference.uri,
    requiredPacketKinds: CONTENT_ADDRESSED_PACKET_KINDS,
    packets: packetList.map((packet) => ({
      packetKind: packet.packetKind,
      stage: packet.stage,
      subjectDigest: packet.subjectDigest,
      proofId: packet.proofId,
      packetPath: packet.packetPath,
      proofPath: packet.proofPath,
      subjectComplete: packet.subjectComplete,
      replaySafe: packet.replaySafe
    })),
    recoveryProfiles: packetRecoveryProfiles.map((profile) => ({
      packetKind: profile.packetKind,
      state: profile.state,
      failureCode: profile.failureState?.code || null,
      retryAt: profile.retryWindow.retryAt,
      degradedAllowed: profile.degradedAllowed
    })),
    claims: packetClaims.map((claim) => ({
      packetKind: claim.packetKind,
      claimId: claim.claimId,
      claimDigest: claim.claimDigest,
      claimPath: claim.claimPath
    }))
  };
  const indexDigest = sha256Digest({
    bundleId,
    manifestDigest: manifestIntegrity.manifestDigest,
    packets: packetList.map((packet) => ({
      packetKind: packet.packetKind,
      subjectDigest: packet.subjectDigest,
      proofId: packet.proofId,
      packetPath: packet.packetPath,
      proofPath: packet.proofPath
    }))
  });
  const packetSetDigest = sha256Digest(packetSetSubject);
  const proofEnvelopeDigest = sha256Digest({
    bundleId,
    manifestDigest: manifestIntegrity.manifestDigest,
    indexDigest,
    packetSetDigest,
    packetProofIds: packetList.map((packet) => packet.proofId),
    packetClaimIds: packetClaims.map((claim) => claim.claimId),
    unresolvedPackets
  });
  const complete = unresolvedPackets.length === 0;

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.contentAddressedPacketManifest`,
    bundleId,
    generatedAt,
    manifestDigest: manifestIntegrity.manifestDigest,
    manifestReferenceUri: manifestIntegrity.manifestReference.uri,
    contentAddressedRoot: manifestIntegrity.manifestReference.contentAddressRoot,
    packetSetDirectory,
    packetSetDigest,
    packetBoundaryAttestation,
    indexDigest,
    indexPath: manifestIntegrity.manifestReference.indexPath.replace(/manifest\.ref\.json$/, "packets.ref.json"),
    contentAddressedIndexPath,
    proofEnvelopePath,
    replayLedgerPath,
    requiredPacketKinds: CONTENT_ADDRESSED_PACKET_KINDS,
    complete,
    unresolvedPackets,
    packetIssues,
    packetRecoveryProfiles,
    packetRecoveryProfilesByKind,
    packetHealthSummary: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.packetHealthSummary`,
      status: blockedPacketProfiles.length > 0
        ? "failed"
        : retryPacketProfiles.length > 0
          ? "retrying"
          : degradedPacketProfiles.length > 0
            ? "degraded"
            : complete
              ? "healthy"
              : "attention-required",
      blockedPacketKinds: blockedPacketProfiles.map((profile) => profile.packetKind),
      retryPacketKinds: retryPacketProfiles.map((profile) => profile.packetKind),
      degradedPacketKinds: degradedPacketProfiles.map((profile) => profile.packetKind),
      actionableErrors: packetRecoveryProfiles
        .map((profile) => profile.actionableError)
        .filter(Boolean),
      nextPacketAction: blockedPacketProfiles[0]?.actionableError?.nextAction
        || retryPacketProfiles[0]?.actionableError?.nextAction
        || degradedPacketProfiles[0]?.actionableError?.nextAction
        || "continue-content-addressed-packet-handoff",
      retryAt: retryPacketProfiles
        .map((profile) => profile.retryWindow.retryAt)
        .filter(Boolean)
        .sort()[0] || null
    },
    verificationSummary: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.contentAddressedPacketVerificationSummary`,
      status: complete
        ? "complete"
        : blockedPacketProfiles.length > 0
          ? "blocked"
          : retryPacketProfiles.length > 0
            ? "retrying"
            : degradedPacketProfiles.length > 0
              ? "degraded"
              : "attention-required",
      packetCount: packetList.length,
      completePacketCount: packetList.filter((packet) => packet.verification.replaySafe).length,
      unresolvedPacketCount: unresolvedPackets.length,
      digestValidPacketCount: packetList.filter((packet) => packet.verification.digestValid).length,
      subjectCompletePacketCount: packetList.filter((packet) => packet.verification.subjectComplete).length,
      claimCount: packetClaims.length,
      replaySafeClaimCount: packetClaims.filter((claim) => claim.verification.replaySafe).length,
      unresolvedPackets,
      blockedPacketKinds: blockedPacketProfiles.map((profile) => profile.packetKind),
      retryPacketKinds: retryPacketProfiles.map((profile) => profile.packetKind),
      degradedPacketKinds: degradedPacketProfiles.map((profile) => profile.packetKind),
      packetSetDigest,
      proofEnvelopeDigest
    },
    proofEnvelope: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.contentAddressedPacketProofEnvelope`,
      proofId: `${bundleId}:packet-index:${proofEnvelopeDigest.slice(7, 23)}`,
      subjectDigest: proofEnvelopeDigest,
      manifestDigest: manifestIntegrity.manifestDigest,
      indexDigest,
      packetSetDigest,
      indexPath: manifestIntegrity.manifestReference.indexPath.replace(/manifest\.ref\.json$/, "packets.ref.json"),
      contentAddressedIndexPath,
      proofEnvelopePath,
      replayLedgerPath,
      requiredPacketKinds: CONTENT_ADDRESSED_PACKET_KINDS,
      packetProofIds: packetList.map((packet) => packet.proofId),
      packetClaimIds: packetClaims.map((claim) => claim.claimId),
      replaySafe: complete
    },
    packetSet: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.contentAddressedPacketSet`,
      directory: packetSetDirectory,
      digest: packetSetDigest,
      indexPath: contentAddressedIndexPath,
      proofPath: proofEnvelopePath,
      replayLedgerPath,
      subject: packetSetSubject,
      replaySafe: complete,
      requiredPaths: [
        contentAddressedIndexPath,
        proofEnvelopePath,
        replayLedgerPath,
        ...packetClaims.map((claim) => claim.claimPath),
        ...packetList.flatMap((packet) => [packet.packetPath, packet.proofPath])
      ]
    },
    packets,
    packetList,
    packetClaims,
    packetClaimsByKind,
    bootPacketUri: packets.boot.uri,
    runPacketUri: packets.run.uri,
    claimPacketUri: packets.claim.uri,
    releasePacketUri: packets.release.uri,
    recoveryPacketUri: packets.recovery.uri
  };
}

function buildPacketClientReadinessContract({
  bundleId,
  generatedAt,
  packetManifest,
  acceptance,
  previewDecision,
  validationSummary,
  nextSteps,
  clientWorkflow,
  operationalHealth
}) {
  const packetGateByKind = {
    boot: {
      gate: "runtime-bootstrap",
      accepted: acceptance.accepted,
      action: acceptance.accepted ? "load-boot-packet" : "wait-for-manifest-acceptance"
    },
    run: {
      gate: "publish-command",
      accepted: previewDecision.readyForPublish || previewDecision.readyForDegradedHandoff,
      action: previewDecision.nextAction || nextSteps.primary?.action || "hold-run-packet"
    },
    claim: {
      gate: "provider-claim",
      accepted: clientWorkflow.providerHandoff.externalHandoffState === "ready"
        || clientWorkflow.providerHandoff.selectedTransport === "kernel-response-envelope",
      action: clientWorkflow.providerHandoff.selectedTransport === "provider-external-handoff"
        ? "deliver-provider-claim"
        : "attach-inline-provider-claim"
    },
    release: {
      gate: "client-release",
      accepted: clientWorkflow.delivery.state !== "blocked" && clientWorkflow.delivery.state !== "expired",
      action: clientWorkflow.delivery.nextClientAction
    },
    recovery: {
      gate: "recovery-ticket",
      accepted: operationalHealth.recoveryTicket.state !== "escalation-required",
      action: operationalHealth.recoveryTicket.dispatchCommand
    }
  };
  const rows = packetManifest.packetList.map((packet) => {
    const claim = packetManifest.packetClaimsByKind[packet.packetKind] || null;
    const recoveryProfile = packetManifest.packetRecoveryProfilesByKind[packet.packetKind] || null;
    const gate = packetGateByKind[packet.packetKind];
    const issue = packet.issue;
    const validationState = issue
      ? "blocked"
      : validationSummary.status === "blocked" && (packet.packetKind === "run" || packet.packetKind === "release")
        ? "blocked-by-manifest"
        : recoveryProfile?.state === "retry-scheduled"
          ? "retry-scheduled"
          : recoveryProfile?.state === "degraded"
            ? "degraded"
            : packet.replaySafe
              ? "clear"
              : "incomplete";
    const readinessState = !packet.subjectComplete
      ? "subject-incomplete"
      : !gate.accepted
        ? "waiting"
        : packet.replaySafe
          ? "ready"
          : "needs-proof";

    return {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.packetClientReadinessRow`,
      packetKind: packet.packetKind,
      stage: packet.stage,
      gate: gate.gate,
      readinessState,
      acceptedByGate: gate.accepted,
      validationState,
      replaySafe: packet.replaySafe,
      subjectComplete: packet.subjectComplete,
      subjectDigest: packet.subjectDigest,
      proofId: packet.proofId,
      packetUri: packet.uri,
      packetPath: packet.packetPath,
      proofPath: packet.proofPath,
      claimId: claim?.claimId || null,
      claimDigest: claim?.claimDigest || null,
      claimPath: claim?.claimPath || null,
      claimUri: claim?.uri || null,
      packetHealthState: recoveryProfile?.state || "unknown",
      packetFailureCode: recoveryProfile?.failureState?.code || null,
      packetFailureClass: recoveryProfile?.failureState?.class || null,
      packetRetryAt: recoveryProfile?.retryWindow.retryAt || null,
      packetRetryable: recoveryProfile?.retryWindow.retryable || false,
      packetDegradedAllowed: recoveryProfile?.degradedAllowed || false,
      missingSubjectFields: packet.verification.missingSubjectFields,
      blockingIssueCode: issue?.code || null,
      nextAction: recoveryProfile?.actionableError?.nextAction || (issue ? "repair-content-addressed-packet-subject" : gate.action),
      userVisibleMessage: recoveryProfile?.actionableError?.message
        || (issue
          ? `The ${packet.packetKind} packet is missing fields required for replay verification.`
        : readinessState === "ready"
          ? `${packet.packetKind} packet is ready for ${gate.gate}.`
          : `The ${packet.packetKind} packet is waiting on ${gate.action}.`)
    };
  });
  const blockedRows = rows.filter((row) => row.validationState === "blocked" || row.readinessState === "subject-incomplete");
  const waitingRows = rows.filter((row) => row.readinessState === "waiting");
  const retryRows = rows.filter((row) => row.validationState === "retry-scheduled");
  const degradedRows = rows.filter((row) => row.validationState === "degraded");
  const readyRows = rows.filter((row) => row.readinessState === "ready");
  const contractDigest = sha256Digest({
    bundleId,
    packetSetDigest: packetManifest.packetSetDigest,
    acceptanceState: acceptance.state,
    decisionState: previewDecision.state,
    deliveryState: clientWorkflow.delivery.state,
    rows: rows.map((row) => ({
      packetKind: row.packetKind,
      readinessState: row.readinessState,
      validationState: row.validationState,
      proofId: row.proofId,
      claimId: row.claimId,
      nextAction: row.nextAction
    }))
  });

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.packetClientReadiness`,
    bundleId,
    generatedAt,
    contractDigest,
    state: blockedRows.length > 0
      ? "blocked"
      : retryRows.length > 0
        ? "retrying"
        : degradedRows.length > 0
          ? "degraded"
          : waitingRows.length > 0
            ? "waiting"
            : readyRows.length === rows.length
              ? "ready"
              : "needs-proof",
    ready: blockedRows.length === 0 && waitingRows.length === 0 && packetManifest.complete,
    packetSetDigest: packetManifest.packetSetDigest,
    packetSetDirectory: packetManifest.packetSetDirectory,
    proofEnvelopeId: packetManifest.proofEnvelope.proofId,
    validationStatus: validationSummary.status,
    acceptanceState: acceptance.state,
    previewDecisionState: previewDecision.state,
    deliveryState: clientWorkflow.delivery.state,
    primaryPacketAction: blockedRows[0]?.nextAction
      || retryRows[0]?.nextAction
      || degradedRows[0]?.nextAction
      || waitingRows[0]?.nextAction
      || nextSteps.primary?.action
      || clientWorkflow.delivery.nextClientAction,
    rows,
    counts: {
      total: rows.length,
      ready: readyRows.length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      retrying: retryRows.length,
      degraded: degradedRows.length,
      replaySafe: rows.filter((row) => row.replaySafe).length,
      subjectComplete: rows.filter((row) => row.subjectComplete).length
    }
  };
}

function buildPacketWorkflowHandoffPlan({
  bundleId,
  generatedAt,
  packetClientReadiness,
  clientWorkflow,
  previewDecision,
  commandReplay,
  providerContract,
  operationalHealth
}) {
  const acknowledgementToken = clientWorkflow.acknowledgement.token;
  const externalTransport = clientWorkflow.providerHandoff.selectedTransport === "provider-external-handoff";
  const rowsByKind = Object.fromEntries(packetClientReadiness.rows.map((row) => [row.packetKind, row]));
  const stageOrder = CONTENT_ADDRESSED_PACKET_KINDS;
  const steps = stageOrder.map((packetKind, index) => {
    const row = rowsByKind[packetKind];
    const providerAckRequired = packetKind === "claim" && externalTransport && providerContract.externalHandoff.ackExpected;
    const clientAckRequired = packetKind === "release" && clientWorkflow.acknowledgement.required;
    const recoveryAckRequired = packetKind === "recovery" && operationalHealth.recoveryTicket.state !== "clear";
    const ackRequired = providerAckRequired || clientAckRequired || recoveryAckRequired;
    const blocked = row.validationState === "blocked"
      || row.validationState === "blocked-by-manifest"
      || row.readinessState === "subject-incomplete";
    const retrying = !blocked && row.validationState === "retry-scheduled";
    const degraded = !blocked && !retrying && row.validationState === "degraded";
    const waiting = !blocked && row.readinessState === "waiting";
    const deliverable = !blocked && !retrying && !degraded && !waiting && row.replaySafe && row.acceptedByGate;
    const deliveryState = blocked
      ? "blocked"
      : retrying
        ? "retry-scheduled"
        : degraded
          ? "degraded-handoff"
          : waiting
            ? "waiting"
            : deliverable
              ? ackRequired ? "awaiting-acknowledgement" : "deliverable"
              : "needs-proof";

    return {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.packetWorkflowHandoffStep`,
      ordinal: index + 1,
      packetKind,
      stage: row.stage,
      gate: row.gate,
      deliveryState,
      packetUri: row.packetUri,
      packetPath: row.packetPath,
      proofPath: row.proofPath,
      claimUri: row.claimUri,
      claimPath: row.claimPath,
      proofId: row.proofId,
      claimId: row.claimId,
      ackRequired,
      ackToken: ackRequired ? acknowledgementToken || `${commandReplay.durableCommandId}:${packetKind}:ack` : null,
      ackExpectedBy: ackRequired
        ? providerAckRequired
          ? providerContract.externalHandoff.target
          : clientWorkflow.acknowledgement.expectedBy
        : null,
      resumeCursor: `${commandReplay.durableCommandId}:${packetKind}:${row.subjectDigest.slice(7, 23)}`,
      nextAction: blocked
        ? row.nextAction
        : retrying
          ? "retry-packet-checkpoint-after-backoff"
          : degraded
            ? "continue-degraded-packet-handoff"
            : waiting
              ? row.nextAction
              : ackRequired
                ? `acknowledge-${packetKind}-packet`
                : row.nextAction,
      userVisibleMessage: blocked
        ? row.userVisibleMessage
        : retrying
          ? `${packetKind} packet checkpoint retry is scheduled after ${row.packetRetryAt}.`
          : degraded
            ? `${packetKind} packet can continue in degraded handoff mode.`
            : ackRequired
              ? `${packetKind} packet is ready and requires acknowledgement before the workflow advances.`
              : row.userVisibleMessage
    };
  });
  const blockedSteps = steps.filter((step) => step.deliveryState === "blocked");
  const waitingSteps = steps.filter((step) => step.deliveryState === "waiting");
  const retrySteps = steps.filter((step) => step.deliveryState === "retry-scheduled");
  const degradedSteps = steps.filter((step) => step.deliveryState === "degraded-handoff");
  const acknowledgementSteps = steps.filter((step) => step.deliveryState === "awaiting-acknowledgement");
  const proofSteps = steps.filter((step) => step.deliveryState === "needs-proof");
  const currentStep = blockedSteps[0] || retrySteps[0] || degradedSteps[0] || waitingSteps[0] || proofSteps[0] || acknowledgementSteps[0] || steps[0];
  const handoffState = blockedSteps.length > 0
    ? "blocked"
    : retrySteps.length > 0
      ? "retrying"
      : degradedSteps.length > 0
        ? "degraded"
        : waitingSteps.length > 0
          ? "waiting"
          : proofSteps.length > 0
            ? "needs-proof"
            : acknowledgementSteps.length > 0
              ? "awaiting-acknowledgement"
              : "ready";
  const planDigest = sha256Digest({
    bundleId,
    packetReadinessDigest: packetClientReadiness.contractDigest,
    deliveryEnvelopeId: clientWorkflow.delivery.envelopeId,
    previewDecisionState: previewDecision.state,
    commandId: commandReplay.durableCommandId,
    handoffState,
    steps: steps.map((step) => ({
      packetKind: step.packetKind,
      deliveryState: step.deliveryState,
      ackRequired: step.ackRequired,
      proofId: step.proofId,
      claimId: step.claimId,
      resumeCursor: step.resumeCursor
    }))
  });

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.packetWorkflowHandoffPlan`,
    bundleId,
    generatedAt,
    planDigest,
    state: handoffState,
    ready: handoffState === "ready" && packetClientReadiness.ready,
    currentStep,
    nextClientAction: currentStep?.nextAction || clientWorkflow.delivery.nextClientAction,
    deliveryEnvelopeId: clientWorkflow.delivery.envelopeId,
    deliveryState: clientWorkflow.delivery.state,
    selectedTransport: clientWorkflow.providerHandoff.selectedTransport,
    externalHandoffId: clientWorkflow.providerHandoff.externalHandoffId,
    recoveryTicketId: operationalHealth.recoveryTicket.ticketId,
    acknowledgement: {
      required: acknowledgementSteps.length > 0,
      pendingPacketKinds: acknowledgementSteps.map((step) => step.packetKind),
      token: acknowledgementSteps[0]?.ackToken || null,
      expectedBy: acknowledgementSteps[0]?.ackExpectedBy || null
    },
    counts: {
      total: steps.length,
      deliverable: steps.filter((step) => step.deliveryState === "deliverable").length,
      waiting: waitingSteps.length,
      blocked: blockedSteps.length,
      retrying: retrySteps.length,
      degraded: degradedSteps.length,
      awaitingAcknowledgement: acknowledgementSteps.length,
      needsProof: proofSteps.length
    },
    steps,
    userVisibleMessage: handoffState === "ready"
      ? "All content-addressed bundle packets are ready for workflow handoff."
      : currentStep?.userVisibleMessage || "Content-addressed bundle packet handoff is waiting for the next workflow step."
  };
}

function buildPacketProviderDispatchContract({
  bundleId,
  generatedAt,
  providerContract,
  packetManifest,
  packetClientReadiness,
  packetWorkflowHandoff,
  manifestIntegrity,
  clientWorkflow,
  commandReplay,
  operationalHealth
}) {
  const rowsByKind = Object.fromEntries(packetClientReadiness.rows.map((row) => [row.packetKind, row]));
  const externalReady = providerContract.externalHandoff.state === "ready"
    && providerContract.externalHandoff.durable
    && clientWorkflow.providerHandoff.selectedTransport === "provider-external-handoff";
  const syncEnabled = providerContract.sync.mode === "cursor";
  const providerBlocked = !providerContract.negotiationComplete || !providerContract.online;
  const dispatchRows = packetWorkflowHandoff.steps.map((step) => {
    const row = rowsByKind[step.packetKind];
    const claim = packetManifest.packetClaimsByKind[step.packetKind] || null;
    const capabilityRequirements = step.packetKind === "claim"
      ? ["artifact.publish", "manifest.audit", externalReady ? "handoff.external" : "manifest.audit"]
      : step.packetKind === "recovery"
        ? ["manifest.audit", syncEnabled ? "manifest.sync" : "manifest.audit"]
        : step.packetKind === "run"
          ? ["artifact.persist", "artifact.publish"]
          : ["manifest.audit"];
    const missingCapabilities = [...new Set(capabilityRequirements)]
      .filter((capability) => !providerContract.advertisedCapabilities.includes(capability));
    const dispatchBlocked = providerBlocked
      || missingCapabilities.length > 0
      || ["blocked", "retry-scheduled", "needs-proof", "waiting"].includes(step.deliveryState);
    const dispatchState = providerBlocked
      ? "provider-blocked"
      : missingCapabilities.length > 0
        ? "capability-blocked"
        : step.deliveryState === "blocked"
          ? "packet-blocked"
          : step.deliveryState === "retry-scheduled"
            ? "retry-scheduled"
            : step.deliveryState === "degraded-handoff"
              ? "degraded-dispatch"
              : step.deliveryState === "waiting"
                ? "waiting"
                : step.deliveryState === "needs-proof"
                  ? "proof-required"
                  : externalReady
                    ? "external-dispatch-ready"
                    : "inline-dispatch-ready";
    const syncSequence = `${providerContract.sync.watermark}:${String(step.ordinal).padStart(2, "0")}:${step.packetKind}`;
    const dispatchSubject = {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.packetProviderDispatchSubject`,
      bundleId,
      providerId: providerContract.providerId,
      serviceId: providerContract.serviceId,
      contractVersion: providerContract.contractVersion,
      packetKind: step.packetKind,
      packetSubjectDigest: row.subjectDigest,
      claimDigest: claim?.claimDigest || null,
      deliveryState: step.deliveryState,
      dispatchState,
      syncSequence
    };
    const dispatchDigest = sha256Digest(dispatchSubject);

    return {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.packetProviderDispatchRow`,
      ordinal: step.ordinal,
      packetKind: step.packetKind,
      stage: step.stage,
      dispatchState,
      dispatchDigest,
      providerId: providerContract.providerId,
      serviceId: providerContract.serviceId,
      contractVersion: providerContract.contractVersion,
      selectedMode: providerContract.capabilityProfile.selectedMode,
      selectedTransport: externalReady ? "external-provider-lease" : "inline-provider-envelope",
      route: `${providerContract.route}.provider.${step.packetKind}`,
      packetUri: step.packetUri,
      packetPath: step.packetPath,
      proofPath: step.proofPath,
      proofId: step.proofId,
      claimUri: step.claimUri,
      claimPath: step.claimPath,
      claimId: step.claimId,
      claimDigest: claim?.claimDigest || null,
      packetSubjectDigest: row.subjectDigest,
      replaySafe: row.replaySafe,
      deliveryState: step.deliveryState,
      workflowResumeCursor: step.resumeCursor,
      providerResumeToken: externalReady ? providerContract.externalHandoff.resumeToken : null,
      externalHandoffId: providerContract.externalHandoff.id,
      externalHandoffState: providerContract.externalHandoff.state,
      externalLeaseId: externalReady ? providerContract.externalHandoff.lease.leaseId : null,
      externalLeaseExpiresAt: externalReady ? providerContract.externalHandoff.lease.expiresAt : null,
      syncMode: providerContract.sync.mode,
      syncCursor: providerContract.sync.cursor,
      syncWatermark: providerContract.sync.watermark,
      syncSequence,
      syncDeltaToken: syncEnabled ? `${providerContract.sync.deltaToken}:${step.packetKind}` : null,
      ackRequired: step.ackRequired || providerContract.sync.requiresAcknowledgement,
      ackToken: step.ackToken || (providerContract.sync.requiresAcknowledgement ? `${commandReplay.durableCommandId}:${step.packetKind}:provider-ack` : null),
      ackExpectedBy: step.ackExpectedBy || providerContract.providerId,
      digestVerificationRequired: providerContract.externalHandoff.proofEnvelope.requiresDigestVerification
        || !manifestIntegrity.complete
        || !row.replaySafe,
      requiredCapabilities: [...new Set(capabilityRequirements)],
      missingCapabilities,
      dispatchBlocked,
      nextProviderAction: dispatchBlocked
        ? missingCapabilities.length > 0
          ? "renegotiate-provider-capabilities"
          : step.nextAction
        : step.ackRequired
          ? "dispatch-packet-and-await-provider-ack"
          : "dispatch-packet-to-provider",
      canonicalSubject: dispatchSubject
    };
  });
  const blockedRows = dispatchRows.filter((row) => row.dispatchBlocked);
  const externalRows = dispatchRows.filter((row) => row.selectedTransport === "external-provider-lease");
  const ackRows = dispatchRows.filter((row) => row.ackRequired && !row.dispatchBlocked);
  const digestFollowupRows = dispatchRows.filter((row) => row.digestVerificationRequired);
  const contractDigest = sha256Digest({
    bundleId,
    providerId: providerContract.providerId,
    negotiationDigest: providerContract.capabilityNegotiation.subjectDigest,
    packetSetDigest: packetManifest.packetSetDigest,
    workflowDigest: packetWorkflowHandoff.planDigest,
    syncWatermark: providerContract.sync.watermark,
    externalHandoffState: providerContract.externalHandoff.state,
    rows: dispatchRows.map((row) => ({
      packetKind: row.packetKind,
      dispatchState: row.dispatchState,
      dispatchDigest: row.dispatchDigest,
      syncSequence: row.syncSequence
    }))
  });

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.packetProviderDispatchContract`,
    bundleId,
    generatedAt,
    contractDigest,
    providerId: providerContract.providerId,
    serviceId: providerContract.serviceId,
    contractVersion: providerContract.contractVersion,
    negotiationProofId: providerContract.capabilityNegotiation.proofId,
    negotiationDigest: providerContract.capabilityNegotiation.subjectDigest,
    state: providerBlocked
      ? "provider-blocked"
      : blockedRows.length > 0
        ? "blocked"
        : operationalHealth.status === "degraded"
          ? "degraded"
          : ackRows.length > 0
            ? "awaiting-provider-ack"
            : "ready",
    ready: !providerBlocked && blockedRows.length === 0,
    packetSetDigest: packetManifest.packetSetDigest,
    workflowDigest: packetWorkflowHandoff.planDigest,
    sync: {
      mode: providerContract.sync.mode,
      cursor: providerContract.sync.cursor,
      epoch: providerContract.sync.epoch,
      watermark: providerContract.sync.watermark,
      deltaToken: providerContract.sync.deltaToken,
      replayWindowMs: providerContract.sync.replayWindowMs,
      consistency: providerContract.sync.consistency
    },
    externalHandoff: {
      id: providerContract.externalHandoff.id,
      state: providerContract.externalHandoff.state,
      target: providerContract.externalHandoff.target,
      durable: providerContract.externalHandoff.durable,
      lease: providerContract.externalHandoff.lease,
      resumeToken: providerContract.externalHandoff.resumeToken,
      proofEnvelope: providerContract.externalHandoff.proofEnvelope
    },
    capabilityNegotiation: providerContract.capabilityNegotiation,
    dispatchRows,
    blockedPacketKinds: blockedRows.map((row) => row.packetKind),
    externalPacketKinds: externalRows.map((row) => row.packetKind),
    acknowledgementPacketKinds: ackRows.map((row) => row.packetKind),
    digestFollowupPacketKinds: digestFollowupRows.map((row) => row.packetKind),
    nextProviderAction: blockedRows[0]?.nextProviderAction
      || ackRows[0]?.nextProviderAction
      || "dispatch-content-addressed-packet-set",
    providerVisibleMessage: providerBlocked
      ? "Provider dispatch is blocked until the service contract negotiation is complete."
      : blockedRows.length > 0
        ? `${blockedRows[0].packetKind} packet is not ready for provider dispatch.`
        : "Provider dispatch contract is ready for the content-addressed packet set."
  };
}

function buildPacketRecoveryCheckpoint({
  bundleId,
  generatedAt,
  persistedState,
  packetManifest,
  packetWorkflowHandoff,
  commandReplay,
  operationalHealth
}) {
  const stepsByKind = Object.fromEntries(packetWorkflowHandoff.steps.map((step) => [step.packetKind, step]));
  const rows = packetManifest.packetList.map((packet) => {
    const prior = persistedState.packetCheckpoints[packet.packetKind];
    const claim = packetManifest.packetClaimsByKind[packet.packetKind] || null;
    const step = stepsByKind[packet.packetKind] || null;
    const recoveryProfile = packetManifest.packetRecoveryProfilesByKind[packet.packetKind] || null;
    const digestMatches = prior.subjectDigest === packet.subjectDigest;
    const claimMatches = Boolean(claim && prior.claimDigest === claim.claimDigest);
    const pathMatches = prior.packetPath === packet.packetPath && prior.proofPath === packet.proofPath;
    const reusable = packet.replaySafe
      && PACKET_CHECKPOINT_TERMINAL_STATES.has(prior.state)
      && digestMatches
      && pathMatches
      && (prior.state !== "claimed" || claimMatches);
    const needsRepair = packet.issue || step?.deliveryState === "blocked";
    const restartAction = reusable
      ? "reuse-persisted-packet"
      : recoveryProfile?.state === "retry-scheduled"
        ? "retry-packet-checkpoint-after-backoff"
        : recoveryProfile?.state === "degraded"
          ? "continue-degraded-packet-handoff"
          : needsRepair
            ? "repair-packet-subject"
            : prior.state === "failed"
              ? "rewrite-failed-packet"
              : digestMatches && prior.state === "written"
                ? "claim-written-packet"
                : "write-packet-checkpoint";
    const nextState = reusable
      ? prior.state
      : recoveryProfile?.state === "retry-scheduled"
        ? "failed"
        : recoveryProfile?.state === "degraded"
          ? "written"
          : packet.replaySafe && claim
            ? "claimed"
            : packet.replaySafe
              ? "written"
              : needsRepair
                ? "failed"
                : "missing";

    return {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.packetRecoveryCheckpointRow`,
      packetKind: packet.packetKind,
      stage: packet.stage,
      priorState: prior.state,
      nextState,
      reusable,
      restartAction,
      deliveryState: step?.deliveryState || "unknown",
      packetHealthState: recoveryProfile?.state || "unknown",
      packetFailureCode: recoveryProfile?.failureState?.code || null,
      packetRetryAt: recoveryProfile?.retryWindow.retryAt || null,
      subjectDigest: packet.subjectDigest,
      priorSubjectDigest: prior.subjectDigest,
      digestMatches,
      claimDigest: claim?.claimDigest || null,
      priorClaimDigest: prior.claimDigest,
      claimMatches: Boolean(claimMatches),
      packetPath: packet.packetPath,
      proofPath: packet.proofPath,
      claimPath: claim?.claimPath || null,
      resumeCursor: step?.resumeCursor || prior.resumeCursor || `${commandReplay.durableCommandId}:${packet.packetKind}`,
      recoveryNote: reusable
        ? "Persisted packet checkpoint matches the current content-addressed subject and can be reused after restart."
        : recoveryProfile?.state === "retry-scheduled"
          ? "Packet checkpoint retry is scheduled; replay must reuse the current subject digest and idempotency key after backoff."
          : recoveryProfile?.state === "degraded"
            ? "Packet checkpoint can continue in degraded handoff mode while proof follow-up remains pending."
            : needsRepair
              ? "Packet checkpoint cannot be replayed until the packet subject or manifest validation issue is repaired."
              : "Packet checkpoint will be rewritten with the current content-addressed subject before workflow handoff."
    };
  });
  const blockedRows = rows.filter((row) => row.restartAction === "repair-packet-subject");
  const retryRows = rows.filter((row) => row.restartAction === "retry-packet-checkpoint-after-backoff");
  const degradedRows = rows.filter((row) => row.restartAction === "continue-degraded-packet-handoff");
  const rewriteRows = rows.filter((row) => [
    "write-packet-checkpoint",
    "rewrite-failed-packet",
    "claim-written-packet"
  ].includes(row.restartAction));
  const reusableRows = rows.filter((row) => row.reusable);
  const checkpointSubject = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.packetRecoveryCheckpointSubject`,
    bundleId,
    revision: persistedState.revision,
    durableCommandId: commandReplay.durableCommandId,
    packetSetDigest: packetManifest.packetSetDigest,
    workflowDigest: packetWorkflowHandoff.planDigest,
    healthStatus: operationalHealth.status,
    rows: rows.map((row) => ({
      packetKind: row.packetKind,
      priorState: row.priorState,
      nextState: row.nextState,
      restartAction: row.restartAction,
      subjectDigest: row.subjectDigest,
      claimDigest: row.claimDigest,
      resumeCursor: row.resumeCursor
    }))
  };
  const checkpointDigest = sha256Digest(checkpointSubject);

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.packetRecoveryCheckpoint`,
    bundleId,
    generatedAt,
    revision: persistedState.revision,
    checkpointId: `${bundleId}:packet-recovery:r${persistedState.revision}:${checkpointDigest.slice(7, 23)}`,
    checkpointDigest,
    state: blockedRows.length > 0
      ? "repair-required"
      : retryRows.length > 0
        ? "retry-scheduled"
        : degradedRows.length > 0
          ? "degraded"
          : rewriteRows.length > 0
            ? "rewrite-required"
            : reusableRows.length === rows.length
              ? "reused"
              : "ready",
    restartSafe: blockedRows.length === 0 && packetManifest.complete,
    durableCommandId: commandReplay.durableCommandId,
    packetSetDigest: packetManifest.packetSetDigest,
    workflowDigest: packetWorkflowHandoff.planDigest,
    nextRestartCommand: blockedRows[0]?.restartAction
      || retryRows[0]?.restartAction
      || degradedRows[0]?.restartAction
      || rewriteRows[0]?.restartAction
      || packetWorkflowHandoff.nextClientAction,
    reusablePacketKinds: reusableRows.map((row) => row.packetKind),
    rewritePacketKinds: rewriteRows.map((row) => row.packetKind),
    retryPacketKinds: retryRows.map((row) => row.packetKind),
    degradedPacketKinds: degradedRows.map((row) => row.packetKind),
    blockedPacketKinds: blockedRows.map((row) => row.packetKind),
    rows,
    checkpointAppend: rows.map((row) => ({
      packetKind: row.packetKind,
      state: row.nextState,
      subjectDigest: row.subjectDigest,
      proofId: packetManifest.packets[row.packetKind].proofId,
      packetPath: row.packetPath,
      proofPath: row.proofPath,
      claimId: packetManifest.packetClaimsByKind[row.packetKind]?.claimId || null,
      claimDigest: row.claimDigest,
      claimPath: row.claimPath,
      resumeCursor: row.resumeCursor,
      packetHealthState: row.packetHealthState,
      failureCode: row.packetFailureCode,
      retryAt: row.packetRetryAt,
      updatedAt: generatedAt,
      recoveryNote: row.recoveryNote
    })),
    canonicalSubject: checkpointSubject
  };
}

function normalizeDigestProof(value, { artifactId, path, bytes }) {
  const rawDigest = typeof value === "string" && value.trim() ? value.trim() : null;
  if (!rawDigest) {
    return {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.artifactDigestProof`,
      artifactId,
      state: "missing",
      algorithm: null,
      digest: null,
      verifier: "hosted-kernel.digest-proof",
      verified: false,
      proofRequired: true,
      canonicalSubject: { artifactId, path, bytes }
    };
  }

  const match = DIGEST_PROOF_PATTERN.exec(rawDigest);
  if (!match) {
    return {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.artifactDigestProof`,
      artifactId,
      state: "invalid",
      algorithm: "unknown",
      digest: rawDigest,
      verifier: "hosted-kernel.digest-proof",
      verified: false,
      proofRequired: true,
      canonicalSubject: { artifactId, path, bytes }
    };
  }

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.artifactDigestProof`,
    artifactId,
    state: "verified",
    algorithm: match[1],
    digest: `${match[1]}:${match[2].toLowerCase()}`,
    verifier: "hosted-kernel.digest-proof",
    verified: true,
    proofRequired: false,
    canonicalSubject: { artifactId, path, bytes }
  };
}

function hasPermission(permissions, permission) {
  return permissions.includes(permission) || permissions.includes("artifact:*");
}

function normalizeBoundaryMode(value) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return candidate === "advisory" ? "advisory" : "enforced";
}

function normalizeStatus(value) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (RECOVERABLE_STATUSES.has(candidate) || TERMINAL_STATUSES.has(candidate)) {
    return candidate;
  }
  return "accepted";
}

function normalizeAttempt(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizePositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeOptionalIsoTimestamp(value) {
  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
}

function normalizeLifecyclePriorState(value) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["enabled", "disabled", "paused", "scheduled", "publishing"].includes(candidate)) {
    return candidate;
  }
  return "enabled";
}

function normalizeDurationMs(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function normalizeLifecycleCommandControls(source = {}) {
  const controls = source.controls && typeof source.controls === "object" ? source.controls : {};
  const disabledCommands = normalizeStringList(source.disabledCommands || controls.disabledCommands)
    .map((command) => command.toLowerCase())
    .filter((command) => LIFECYCLE_COMMANDS.has(command));
  const commandOverrides = Object.fromEntries([...LIFECYCLE_COMMANDS].map((command) => {
    const explicit = controls[command] && typeof controls[command] === "object" ? controls[command] : {};
    return [command, {
      enabled: explicit.enabled === false || disabledCommands.includes(command) ? false : true,
      requiresOperatorMemo: explicit.requiresOperatorMemo === true,
      reason: typeof explicit.reason === "string" && explicit.reason.trim()
        ? explicit.reason.trim().slice(0, 180)
        : null
    }];
  }));

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.lifecycleCommandControls`,
    enabled: source.controlsEnabled === false || controls.enabled === false ? false : true,
    disabledCommands,
    commandOverrides
  };
}

function normalizeLifecycleSchedulePolicy(source = {}) {
  const policy = source.schedulePolicy && typeof source.schedulePolicy === "object"
    ? source.schedulePolicy
    : source.policy && typeof source.policy === "object"
      ? source.policy
      : {};
  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.lifecycleSchedulePolicy`,
    minLeadTimeMs: normalizeDurationMs(policy.minLeadTimeMs, DEFAULT_LIFECYCLE_SCHEDULE_POLICY.minLeadTimeMs),
    maxLeadTimeMs: normalizeDurationMs(policy.maxLeadTimeMs, DEFAULT_LIFECYCLE_SCHEDULE_POLICY.maxLeadTimeMs),
    maxDisableMs: normalizeDurationMs(policy.maxDisableMs, DEFAULT_LIFECYCLE_SCHEDULE_POLICY.maxDisableMs),
    allowPastDueImmediatePublish: policy.allowPastDueImmediatePublish === true,
    requireOperatorMemoForDisable: policy.requireOperatorMemoForDisable === true
  };
}

function normalizeLifecycleSettings(input = {}, { generatedAt }) {
  const source = input && typeof input === "object" ? input : {};
  const requestedCommand = typeof source.command === "string"
    ? source.command.trim().toLowerCase()
    : "publish";
  const commandId = normalizeIdentifier(source.commandId || source.lifecycleCommandId || source.controlId, `lifecycle:${requestedCommand}`);
  const operatorMemo = typeof source.operatorMemo === "string" && source.operatorMemo.trim()
    ? source.operatorMemo.trim().slice(0, 180)
    : null;
  const controls = normalizeLifecycleCommandControls(source);
  const schedulePolicy = normalizeLifecycleSchedulePolicy(source);
  const scheduleMode = typeof source.scheduleMode === "string"
    ? source.scheduleMode.trim().toLowerCase()
    : source.enabled === false
      ? "paused"
      : source.notBefore || source.runAfter
        ? "scheduled"
        : "immediate";
  const notBefore = normalizeOptionalIsoTimestamp(source.notBefore || source.runAfter);
  const rawDisableUntil = normalizeOptionalIsoTimestamp(source.disableUntil || source.suspendedUntil);
  const nowMs = new Date(generatedAt).valueOf();
  const issues = [];
  const commandKnown = LIFECYCLE_COMMANDS.has(requestedCommand);
  const normalizedCommand = commandKnown ? requestedCommand : "publish";
  const scheduleKnown = LIFECYCLE_SCHEDULE_MODES.has(scheduleMode);
  const normalizedScheduleMode = scheduleKnown
    ? LIFECYCLE_HOLD_COMMANDS.has(normalizedCommand)
      ? "paused"
      : scheduleMode
    : "immediate";
  const opensLifecycle = LIFECYCLE_OPEN_COMMANDS.has(normalizedCommand);
  const holdsLifecycle = LIFECYCLE_HOLD_COMMANDS.has(normalizedCommand);
  const priorState = normalizeLifecyclePriorState(source.priorState || source.currentState || source.state);
  const commandControl = controls.commandOverrides[normalizedCommand] || { enabled: true, requiresOperatorMemo: false, reason: null };
  const commandControlEnabled = controls.enabled && commandControl.enabled;
  const memoRequired = commandControl.requiresOperatorMemo
    || (schedulePolicy.requireOperatorMemoForDisable && LIFECYCLE_DISABLE_COMMANDS.has(normalizedCommand));

  if (!commandKnown) {
    issues.push({
      code: "lifecycle-unknown-command",
      severity: "error",
      command: requestedCommand || "missing",
      detail: "Bundle manifest lifecycle command must be one of publish, pause, resume, disable, enable, or reschedule."
    });
  }
  if (!scheduleKnown) {
    issues.push({
      code: "lifecycle-invalid-schedule",
      severity: "error",
      scheduleMode: scheduleMode || "missing",
      detail: "Lifecycle schedule mode must be immediate, scheduled, or paused."
    });
  }
  if (!commandControlEnabled) {
    issues.push({
      code: "lifecycle-disabled",
      severity: "error",
      command: normalizedCommand,
      commandId,
      detail: commandControl.reason || "Requested lifecycle command is disabled by bundle manifest lifecycle controls."
    });
  }
  if (memoRequired && !operatorMemo) {
    issues.push({
      code: "lifecycle-invalid-schedule",
      severity: "error",
      command: normalizedCommand,
      commandId,
      detail: "Requested lifecycle command requires an operator memo before it can be accepted."
    });
  }

  if (normalizedCommand === "reschedule" && normalizedScheduleMode !== "scheduled") {
    issues.push({
      code: "lifecycle-invalid-schedule",
      severity: "error",
      command: normalizedCommand,
      scheduleMode: normalizedScheduleMode,
      detail: "Reschedule lifecycle command must provide scheduled mode with a valid activation timestamp."
    });
  }

  const enabled = holdsLifecycle
    ? false
    : opensLifecycle
      ? true
      : source.enabled === false
        ? false
        : true;
  const activationAt = normalizedScheduleMode === "scheduled" ? notBefore : null;
  const disabledUntil = opensLifecycle ? null : rawDisableUntil;
  const activationMs = activationAt ? new Date(activationAt).valueOf() : NaN;
  const disabledUntilMs = disabledUntil ? new Date(disabledUntil).valueOf() : NaN;
  const disabledUntilActive = disabledUntil && disabledUntilMs > nowMs;
  const scheduledForFuture = activationAt && activationMs > nowMs;
  const scheduleLeadTimeMs = Number.isFinite(activationMs) ? activationMs - nowMs : null;
  const disableDurationMs = Number.isFinite(disabledUntilMs) ? disabledUntilMs - nowMs : null;
  const schedulePastDue = normalizedScheduleMode === "scheduled"
    && Number.isFinite(scheduleLeadTimeMs)
    && scheduleLeadTimeMs <= 0;
  const scheduleTooSoon = normalizedScheduleMode === "scheduled"
    && Number.isFinite(scheduleLeadTimeMs)
    && scheduleLeadTimeMs > 0
    && scheduleLeadTimeMs < schedulePolicy.minLeadTimeMs;
  const scheduleTooLate = normalizedScheduleMode === "scheduled"
    && Number.isFinite(scheduleLeadTimeMs)
    && scheduleLeadTimeMs > schedulePolicy.maxLeadTimeMs;
  const disableTooLong = disabledUntil
    && Number.isFinite(disableDurationMs)
    && disableDurationMs > schedulePolicy.maxDisableMs;
  const paused = normalizedScheduleMode === "paused" || holdsLifecycle;
  const publishAllowedNow = commandControlEnabled
    && enabled
    && !disabledUntilActive
    && !scheduledForFuture
    && !paused
    && !scheduleTooSoon
    && !scheduleTooLate
    && !disableTooLong
    && (normalizedScheduleMode !== "scheduled" || schedulePolicy.allowPastDueImmediatePublish || !schedulePastDue);
  const effectiveState = !enabled || disabledUntilActive
    ? "disabled"
    : paused
      ? "paused"
      : scheduledForFuture
        ? "scheduled"
        : commandControlEnabled
          ? "open"
          : "disabled";
  const nextLifecycleAction = publishAllowedNow
    ? "issue-hosted-kernel-publish"
    : !commandControlEnabled
      ? "enable-lifecycle-command-control"
      : scheduleTooSoon || scheduleTooLate || schedulePastDue
        ? "adjust-lifecycle-schedule-window"
        : disableTooLong
          ? "shorten-lifecycle-disable-window"
          : effectiveState === "scheduled"
            ? "wait-for-scheduled-lifecycle-window"
            : effectiveState === "paused"
              ? "resume-bundle-manifest-lifecycle"
              : "enable-bundle-manifest-lifecycle";
  const transition = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.lifecycleTransition`,
    commandId,
    priorState,
    command: normalizedCommand,
    commandLabel: LIFECYCLE_COMMAND_LABELS[normalizedCommand],
    effectiveState,
    changed: priorState !== effectiveState,
    activationAt,
    disabledUntil,
    publishAllowedNow,
    operatorIntent: normalizedCommand === "reschedule"
      ? "move-publish-window"
      : holdsLifecycle
        ? "hold-publish-replay"
        : opensLifecycle
          ? "open-publish-replay"
          : "publish-replay",
    controlAccepted: commandKnown
      && scheduleKnown
      && commandControlEnabled
      && (!memoRequired || Boolean(operatorMemo))
      && !scheduleTooSoon
      && !scheduleTooLate
      && (!schedulePastDue || schedulePolicy.allowPastDueImmediatePublish)
      && !disableTooLong
  };

  if (!enabled || disabledUntilActive || paused) {
    issues.push({
      code: "lifecycle-disabled",
      severity: normalizedCommand === "enable" || normalizedCommand === "resume" ? "warning" : "error",
      command: normalizedCommand,
      disabledUntil,
      effectiveState,
      detail: "Bundle manifest lifecycle is disabled or paused; publish replay is held until explicitly enabled."
    });
  }
  if (normalizedScheduleMode === "scheduled" && !activationAt) {
    issues.push({
      code: "lifecycle-invalid-schedule",
      severity: "error",
      command: normalizedCommand,
      detail: "Scheduled lifecycle mode requires a valid notBefore timestamp."
    });
  } else if (schedulePastDue && !schedulePolicy.allowPastDueImmediatePublish) {
    issues.push({
      code: "lifecycle-invalid-schedule",
      severity: "error",
      command: normalizedCommand,
      notBefore: activationAt,
      detail: "Scheduled lifecycle activation timestamp is in the past; reschedule or allow past-due immediate publish."
    });
  } else if (scheduleTooSoon || scheduleTooLate) {
    issues.push({
      code: "lifecycle-invalid-schedule",
      severity: "error",
      command: normalizedCommand,
      notBefore: activationAt,
      scheduleLeadTimeMs,
      minLeadTimeMs: schedulePolicy.minLeadTimeMs,
      maxLeadTimeMs: schedulePolicy.maxLeadTimeMs,
      detail: "Scheduled lifecycle activation is outside the configured lifecycle schedule policy window."
    });
  } else if (scheduledForFuture) {
    issues.push({
      code: "lifecycle-schedule-window-closed",
      severity: "warning",
      notBefore: activationAt,
      detail: "Bundle manifest publish is scheduled for a future activation window."
    });
  }
  if (disableTooLong) {
    issues.push({
      code: "lifecycle-invalid-schedule",
      severity: "error",
      command: normalizedCommand,
      disabledUntil,
      disableDurationMs,
      maxDisableMs: schedulePolicy.maxDisableMs,
      detail: "Lifecycle disable window exceeds the configured maximum disable duration."
    });
  }

  const commandState = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.lifecycleCommandState`,
    commandId,
    requestedCommand: normalizedCommand,
    accepted: commandKnown
      && scheduleKnown
      && commandControlEnabled
      && (!memoRequired || Boolean(operatorMemo))
      && !scheduleTooSoon
      && !scheduleTooLate
      && (!schedulePastDue || schedulePolicy.allowPastDueImmediatePublish)
      && !disableTooLong,
    controlEnabled: commandControlEnabled,
    memoRequired,
    hasOperatorMemo: Boolean(operatorMemo),
    schedulePolicy,
    scheduleLeadTimeMs,
    disableDurationMs,
    schedulePastDue,
    scheduleWithinPolicy: !scheduleTooSoon && !scheduleTooLate && (!schedulePastDue || schedulePolicy.allowPastDueImmediatePublish),
    disableWithinPolicy: !disableTooLong,
    nextAction: nextLifecycleAction,
    resumeToken: `${commandId}:${normalizedCommand}:${effectiveState}`,
    blocksPublish: !publishAllowedNow
  };

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.lifecycleSettings`,
    commandId,
    enabled,
    requestedCommand: normalizedCommand,
    requestedCommandLabel: LIFECYCLE_COMMAND_LABELS[normalizedCommand],
    priorState,
    effectiveState,
    scheduleMode: normalizedScheduleMode,
    activationAt,
    disabledUntil,
    scheduledForFuture: Boolean(scheduledForFuture),
    publishAllowedNow,
    transition,
    commandState,
    controls,
    schedulePolicy,
    nextLifecycleAction,
    auditControl: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.lifecycleAuditControl`,
      controlId: commandId,
      commandAccepted: commandState.accepted,
      replayGateClosed: !publishAllowedNow,
      requiresOperatorAction: !publishAllowedNow && effectiveState !== "scheduled",
      scheduledActivationRequired: normalizedCommand === "reschedule" || effectiveState === "scheduled",
      disabledByControl: !commandControlEnabled,
      nextAction: nextLifecycleAction,
      resumeToken: commandState.resumeToken
    },
    operatorMemo,
    issues
  };
}

function normalizeHealthPolicy(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const initialBackoffMs = normalizePositiveInteger(source.initialBackoffMs, DEFAULT_HEALTH_POLICY.initialBackoffMs);
  const maxBackoffMs = Math.max(
    initialBackoffMs,
    normalizePositiveInteger(source.maxBackoffMs, DEFAULT_HEALTH_POLICY.maxBackoffMs)
  );
  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.healthPolicy`,
    maxRetryAttempts: normalizePositiveInteger(source.maxRetryAttempts, DEFAULT_HEALTH_POLICY.maxRetryAttempts),
    initialBackoffMs,
    maxBackoffMs,
    commandAckTimeoutMs: normalizePositiveInteger(source.commandAckTimeoutMs, DEFAULT_HEALTH_POLICY.commandAckTimeoutMs),
    commandCompletionTimeoutMs: normalizePositiveInteger(
      source.commandCompletionTimeoutMs,
      DEFAULT_HEALTH_POLICY.commandCompletionTimeoutMs
    ),
    degradedModeEnabled: source.degradedModeEnabled === false ? false : DEFAULT_HEALTH_POLICY.degradedModeEnabled
  };
}

function normalizePersistedArtifactState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    persistedPath: typeof source.persistedPath === "string" && source.persistedPath.trim()
      ? source.persistedPath.trim()
      : null,
    lastDigest: typeof source.lastDigest === "string" && source.lastDigest.trim()
      ? source.lastDigest.trim()
      : null,
    committedAt: source.committedAt ? asIsoTimestamp(source.committedAt) : null,
    status: normalizeStatus(source.status)
  };
}

function normalizePersistedMailchimpManifestState(value = {}, { bundleId, generatedAt }) {
  const source = value && typeof value === "object" ? value : {};
  const lastHandoff = source.lastHandoff && typeof source.lastHandoff === "object"
    ? source.lastHandoff
    : source.handoff && typeof source.handoff === "object"
      ? source.handoff
      : {};
  const statusCandidate = typeof source.status === "string" ? source.status.trim().toLowerCase() : "";
  const status = [
    "missing",
    "previewed",
    "accepted",
    "dispatching",
    "acknowledged",
    "failed",
    "blocked"
  ].includes(statusCandidate)
    ? statusCandidate
    : lastHandoff.payloadDigest
      ? "previewed"
      : "missing";
  const payloadDigest = digestParts(
    source.payloadDigest || lastHandoff.payloadDigest || source.lastPayloadDigest
  );
  const targetScopeDigest = digestParts(
    source.targetScopeDigest || lastHandoff.targetScopeDigest || source.lastTargetScopeDigest
  );
  const acceptedAt = normalizeOptionalIsoTimestamp(source.acceptedAt || lastHandoff.acceptedAt);
  const acknowledgedAt = normalizeOptionalIsoTimestamp(source.acknowledgedAt || lastHandoff.acknowledgedAt);
  const failedAt = normalizeOptionalIsoTimestamp(source.failedAt || lastHandoff.failedAt);
  const retryAfter = normalizeOptionalIsoTimestamp(source.retryAfter || lastHandoff.retryAfter);
  const attempt = normalizeAttempt(source.attempt || lastHandoff.attempt);
  const commandId = normalizeIdentifier(
    source.commandId || lastHandoff.commandId,
    `${bundleId}:mailchimp-manifest`
  );
  const idempotencyKey = normalizeIdentifier(
    source.idempotencyKey || lastHandoff.idempotencyKey,
    commandId
  );

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.persistedMailchimpManifestState`,
    status,
    recoveredAt: generatedAt,
    commandId,
    idempotencyKey,
    payloadDigest: payloadDigest.digest,
    payloadDigestValid: payloadDigest.valid,
    targetScopeDigest: targetScopeDigest.digest,
    targetScopeDigestValid: targetScopeDigest.valid,
    resumeToken: typeof source.resumeToken === "string" && source.resumeToken.trim()
      ? source.resumeToken.trim()
      : typeof lastHandoff.resumeToken === "string" && lastHandoff.resumeToken.trim()
        ? lastHandoff.resumeToken.trim()
        : null,
    acknowledgementToken: typeof source.acknowledgementToken === "string" && source.acknowledgementToken.trim()
      ? source.acknowledgementToken.trim()
      : null,
    acceptedAt,
    acknowledgedAt,
    failedAt,
    retryAfter,
    attempt,
    replayable: ["accepted", "dispatching", "failed"].includes(status),
    terminal: ["acknowledged", "blocked"].includes(status),
    failureReason: typeof source.failureReason === "string" && source.failureReason.trim()
      ? source.failureReason.trim().slice(0, 220)
      : typeof lastHandoff.failureReason === "string" && lastHandoff.failureReason.trim()
        ? lastHandoff.failureReason.trim().slice(0, 220)
        : null
  };
}

function normalizeCommandJournal(input = []) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((entry) => entry && typeof entry === "object")
    .slice(-20)
    .map((entry, index) => {
      const commandId = normalizeIdentifier(entry.commandId || entry.id, `persisted-command-${index + 1}`);
      const idempotencyKey = normalizeIdentifier(entry.idempotencyKey || entry.key, commandId);
      const statusCandidate = typeof entry.status === "string" ? entry.status.trim().toLowerCase() : "";
      const status = COMMAND_JOURNAL_STATUSES.has(statusCandidate) ? statusCandidate : "queued";
      return {
        schema: `${BUNDLE_MANIFEST_SCHEMA}.persistedCommand`,
        commandId,
        idempotencyKey,
        command: normalizeIdentifier(entry.command || entry.action, "resume-bundle-manifest-publish"),
        status,
        attempt: normalizeAttempt(entry.attempt),
        issuedAt: entry.issuedAt ? asIsoTimestamp(entry.issuedAt) : null,
        acknowledgedAt: entry.acknowledgedAt ? asIsoTimestamp(entry.acknowledgedAt) : null,
        completedAt: entry.completedAt ? asIsoTimestamp(entry.completedAt) : null,
        artifactIds: normalizeStringList(entry.artifactIds),
        recoveryNote: typeof entry.recoveryNote === "string" && entry.recoveryNote.trim()
          ? entry.recoveryNote.trim().slice(0, 180)
          : null
      };
    });
}

function normalizePacketCheckpointEntry(value = {}, kind) {
  const source = value && typeof value === "object" ? value : {};
  const stateCandidate = typeof source.state === "string" ? source.state.trim().toLowerCase() : "";
  const state = PACKET_CHECKPOINT_STATES.has(stateCandidate) ? stateCandidate : "missing";
  const packetPath = typeof source.packetPath === "string" && source.packetPath.trim()
    ? normalizeReferencePath(source.packetPath, "")
    : null;
  const proofPath = typeof source.proofPath === "string" && source.proofPath.trim()
    ? normalizeReferencePath(source.proofPath, "")
    : null;
  const claimPath = typeof source.claimPath === "string" && source.claimPath.trim()
    ? normalizeReferencePath(source.claimPath, "")
    : null;
  const subjectDigest = digestParts(source.subjectDigest || source.packetSubjectDigest);
  const claimDigest = digestParts(source.claimDigest);

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.persistedPacketCheckpoint`,
    packetKind: kind,
    state,
    subjectDigest: subjectDigest.valid ? subjectDigest.digest : null,
    proofId: normalizeOptionalIdentifier(source.proofId || source.packetProofId),
    packetPath,
    proofPath,
    claimId: normalizeOptionalIdentifier(source.claimId),
    claimDigest: claimDigest.valid ? claimDigest.digest : null,
    claimPath,
    resumeCursor: normalizeOptionalIdentifier(source.resumeCursor),
    updatedAt: source.updatedAt || source.observedAt || source.committedAt
      ? asIsoTimestamp(source.updatedAt || source.observedAt || source.committedAt)
      : null,
    failureCode: normalizeOptionalIdentifier(source.failureCode || source.errorCode),
    recoveryNote: typeof source.recoveryNote === "string" && source.recoveryNote.trim()
      ? source.recoveryNote.trim().slice(0, 180)
      : null
  };
}

function normalizePacketCheckpoints(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const entries = Array.isArray(source)
    ? Object.fromEntries(source
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => [entry.packetKind, entry]))
    : source;

  return Object.fromEntries(CONTENT_ADDRESSED_PACKET_KINDS.map((kind) => [
    kind,
    normalizePacketCheckpointEntry(entries[kind] || entries[PACKET_KIND_STAGE[kind]], kind)
  ]));
}

function normalizeClientState(client = {}) {
  const workflow = client.workflow && typeof client.workflow === "object"
    ? client.workflow
    : client.handoff && typeof client.handoff === "object"
      ? client.handoff
      : {};
  const requestedChannel = typeof workflow.channel === "string"
    ? workflow.channel.trim().toLowerCase()
    : typeof client.handoffChannel === "string"
      ? client.handoffChannel.trim().toLowerCase()
      : "inline";
  const notifyOn = normalizeStringList(workflow.notifyOn || client.notifyOn)
    .filter((eventName) => CLIENT_NOTIFY_EVENTS.has(eventName));
  const requestedResponseFormat = typeof workflow.responseFormat === "string"
    ? workflow.responseFormat.trim().toLowerCase()
    : typeof client.responseFormat === "string"
      ? client.responseFormat.trim().toLowerCase()
      : "handoff-envelope";
  const requestedUrgency = typeof workflow.urgency === "string"
    ? workflow.urgency.trim().toLowerCase()
    : typeof client.urgency === "string"
      ? client.urgency.trim().toLowerCase()
      : "interactive";
  const deadlineAt = normalizeOptionalIsoTimestamp(
    workflow.deadlineAt || workflow.expiresAt || client.deadlineAt || client.expiresAt
  );
  return {
    clientId: normalizeIdentifier(client.clientId || client.id, "anonymous-client"),
    sessionId: normalizeIdentifier(client.sessionId || client.threadId, "ephemeral-session"),
    requestId: normalizeIdentifier(client.requestId || client.traceId, "local-request"),
    correlationId: normalizeIdentifier(client.correlationId || workflow.correlationId || client.requestId || client.traceId, "local-request"),
    capabilities: normalizeStringList(client.capabilities),
    handoffTarget: normalizeIdentifier(client.handoffTarget, "artifact-review"),
    workflow: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.clientWorkflow`,
      channel: CLIENT_HANDOFF_CHANNELS.has(requestedChannel) ? requestedChannel : "inline",
      callbackRoute: normalizeIdentifier(workflow.callbackRoute || client.callbackRoute, DEFAULT_ROUTE),
      returnTo: normalizeIdentifier(workflow.returnTo || client.returnTo || client.handoffTarget, "artifact-review"),
      requestedAction: normalizeIdentifier(workflow.requestedAction || client.requestedAction, "review-bundle-manifest"),
      expectsPreview: workflow.expectsPreview === false ? false : true,
      requireAcknowledgement: workflow.requireAcknowledgement === true || client.requireAcknowledgement === true,
      notifyOn: notifyOn.length > 0 ? notifyOn : ["accepted", "blocked", "failed"],
      responseFormat: CLIENT_RESPONSE_FORMATS.has(requestedResponseFormat) ? requestedResponseFormat : "handoff-envelope",
      urgency: CLIENT_URGENCY_LEVELS.has(requestedUrgency) ? requestedUrgency : "interactive",
      deadlineAt,
      wantsAuditEnvelope: workflow.includeAuditEnvelope === true
        || client.includeAuditEnvelope === true
        || requestedResponseFormat === "audit-envelope",
      wantsManifestPayload: workflow.includeManifest === true
        || client.includeManifest === true
        || requestedResponseFormat === "manifest"
        || requestedResponseFormat === "handoff-envelope"
    }
  };
}

function normalizeProviderCapabilityList(value, fallback = []) {
  const raw = Array.isArray(value) ? value : fallback;
  const seen = new Set();
  const duplicates = new Set();
  const normalized = [];

  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const capability = item.trim().toLowerCase();
    if (!capability) {
      continue;
    }
    if (seen.has(capability)) {
      duplicates.add(capability);
      continue;
    }
    seen.add(capability);
    normalized.push(capability);
  }

  const supported = normalized.filter((capability) => SUPPORTED_PROVIDER_CAPABILITIES.has(capability));
  const unsupported = normalized.filter((capability) => !SUPPORTED_PROVIDER_CAPABILITIES.has(capability));

  return {
    normalized,
    supported,
    unsupported,
    duplicates: [...duplicates]
  };
}

function normalizeProviderContract(input = {}, { generatedAt, requestState, clientState }) {
  const source = input && typeof input === "object" ? input : {};
  const suppliedCapabilities = Array.isArray(source.capabilities) || Array.isArray(source.advertisedCapabilities);
  const advertisedCapabilityInput = suppliedCapabilities
    ? source.capabilities || source.advertisedCapabilities
    : [...REQUIRED_PROVIDER_CAPABILITIES, "manifest.sync", "handoff.external"];
  const advertisedCapabilitySet = normalizeProviderCapabilityList(advertisedCapabilityInput);
  const capabilities = advertisedCapabilitySet.supported;
  const rawAdvertisedCapabilities = advertisedCapabilitySet.normalized;
  const unsupportedAdvertisedCapabilities = advertisedCapabilitySet.unsupported;
  const duplicateAdvertisedCapabilities = advertisedCapabilitySet.duplicates;
  const requestedProfileCandidate = typeof (source.profile || source.serviceProfile) === "string"
    ? (source.profile || source.serviceProfile).trim()
    : "";
  const requestedProfileKnown = Object.prototype.hasOwnProperty.call(PROVIDER_CAPABILITY_PROFILES, requestedProfileCandidate);
  const requestedProfile = requestedProfileKnown ? requestedProfileCandidate : "durable-external";
  const profileCapabilities = PROVIDER_CAPABILITY_PROFILES[requestedProfile];
  const requiredCapabilitySet = normalizeProviderCapabilityList(source.requiredCapabilities, REQUIRED_PROVIDER_CAPABILITIES);
  const requiredCapabilities = requiredCapabilitySet.supported.length > 0
    ? requiredCapabilitySet.supported
    : REQUIRED_PROVIDER_CAPABILITIES;
  const unsupportedRequiredCapabilities = requiredCapabilitySet.unsupported;
  const duplicateRequiredCapabilities = requiredCapabilitySet.duplicates;
  const clientCapabilitySet = normalizeProviderCapabilityList(
    source.clientRequestedCapabilities || source.clientCapabilities || source.negotiatedCapabilities
  );
  const clientRequestedCapabilities = clientCapabilitySet.supported;
  const missingCapabilities = requiredCapabilities.filter((capability) => !capabilities.includes(capability));
  const unsupportedRequestedCapabilities = clientCapabilitySet.unsupported;
  const duplicateRequestedCapabilities = clientCapabilitySet.duplicates;
  const acceptedClientCapabilities = clientRequestedCapabilities
    .filter((capability) => capabilities.includes(capability));
  const declinedClientCapabilities = clientRequestedCapabilities
    .filter((capability) => !capabilities.includes(capability));
  const optionalCapabilities = OPTIONAL_PROVIDER_CAPABILITIES.filter((capability) => capabilities.includes(capability));
  const profileGaps = profileCapabilities.filter((capability) => !capabilities.includes(capability));
  const syncCapable = capabilities.includes("manifest.sync");
  const externalCapable = capabilities.includes("handoff.external");
  const digestVerifyCapable = capabilities.includes("digest.verify");
  const auditCapable = capabilities.includes("manifest.audit");
  const providerStatus = normalizeIdentifier(source.status || source.availability, "online");
  const providerId = normalizeIdentifier(source.providerId || source.id, "hosted-kernel-artifact-provider");
  const serviceId = normalizeIdentifier(source.serviceId || source.service, "artifact-filesystem");
  const contractVersion = normalizeIdentifier(source.contractVersion || source.version, "v1");
  const syncCursor = normalizeIdentifier(source.syncCursor || source.cursor, `r0:${clientState.requestId}`);
  const syncEpoch = normalizeIdentifier(source.syncEpoch || source.epoch, `${requestState.tenantId}:${serviceId}`);
  const syncWatermark = normalizeIdentifier(source.syncWatermark || source.watermark, `${syncEpoch}:${syncCursor}`);
  const replayWindowMs = normalizePositiveInteger(source.replayWindowMs, 15 * 60 * 1000);
  const externalHandoffId = normalizeIdentifier(
    source.externalHandoffId || source.handoffId,
    `${requestState.tenantId}:${clientState.requestId}:${providerId}`
  );
  const handoffLeaseMs = normalizePositiveInteger(source.handoffLeaseMs || source.leaseMs, replayWindowMs);
  const handoffLeaseExpiresAt = asIsoTimestamp(new Date(new Date(generatedAt).valueOf() + handoffLeaseMs));
  const online = !["offline", "disabled", "unavailable"].includes(providerStatus);
  const acceptsRoute = source.route === undefined || normalizeIdentifier(source.route, requestState.route) === requestState.route;
  const strictCapabilityNegotiation = source.strictCapabilities === true || source.strictCapabilityNegotiation === true;
  const issues = [];

  if (requestedProfileCandidate && !requestedProfileKnown) {
    issues.push({
      code: "provider-contract-mismatch",
      severity: strictCapabilityNegotiation ? "error" : "warning",
      providerId,
      requestedProfile: requestedProfileCandidate,
      selectedProfile: requestedProfile,
      detail: "Provider capability profile must be one of durable-external, audited-inline, or stateless-audit; durable-external was selected as the fallback profile."
    });
  }
  if (!online) {
    issues.push({
      code: "provider-unavailable",
      severity: "error",
      providerId,
      status: providerStatus,
      detail: "Hosted-kernel bundle manifest provider must be online before external handoff can be replayed."
    });
  }
  if (!acceptsRoute) {
    issues.push({
      code: "provider-contract-mismatch",
      severity: "error",
      providerId,
      expectedRoute: requestState.route,
      actualRoute: normalizeIdentifier(source.route, "unknown"),
      detail: "Provider contract route must match the bundle manifest request route."
    });
  }
  for (const capability of unsupportedAdvertisedCapabilities) {
    issues.push({
      code: "provider-unsupported-capability",
      severity: strictCapabilityNegotiation ? "error" : "warning",
      providerId,
      capability,
      capabilitySource: "advertised",
      detail: "Provider advertised a capability outside the bundle manifest provider contract and it was excluded from dispatch decisions."
    });
  }
  for (const capability of unsupportedRequiredCapabilities) {
    issues.push({
      code: "provider-unsupported-capability",
      severity: "error",
      providerId,
      capability,
      capabilitySource: "required",
      detail: "Required provider capabilities must be supported by the bundle manifest provider contract before negotiation can complete."
    });
  }
  for (const capability of missingCapabilities) {
    issues.push({
      code: "provider-missing-capability",
      severity: "error",
      providerId,
      capability,
      detail: "Provider contract is missing a required artifact bundle capability."
    });
  }
  for (const capability of declinedClientCapabilities) {
    issues.push({
      code: "provider-missing-capability",
      severity: strictCapabilityNegotiation ? "error" : "warning",
      providerId,
      capability,
      detail: "Provider does not advertise a client-requested bundle manifest capability."
    });
  }
  for (const capability of unsupportedRequestedCapabilities) {
    issues.push({
      code: "provider-unsupported-capability",
      severity: strictCapabilityNegotiation ? "error" : "warning",
      providerId,
      capability,
      detail: "Provider capability negotiation only accepts artifact persistence, publish, audit, sync, external handoff, digest verification, preview, or analytics capabilities."
    });
  }
  const blockingIssueCount = issues.filter((issue) => issue.severity === "error").length;
  const negotiationComplete = blockingIssueCount === 0;
  const selectedMode = !negotiationComplete
    ? "blocked"
    : externalCapable
      ? "durable-external-handoff"
      : syncCapable
        ? "audited-sync-envelope"
        : "inline-audit-envelope";
  const negotiationDigest = sha256Digest({
    providerId,
    serviceId,
    contractVersion,
    route: requestState.route,
    requestedProfile,
    rawAdvertisedCapabilities,
    capabilities,
    requiredCapabilities,
    acceptedClientCapabilities,
    declinedClientCapabilities,
    unsupportedRequestedCapabilities,
    unsupportedAdvertisedCapabilities,
    unsupportedRequiredCapabilities,
    syncCursor,
    externalHandoffId
  });

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.providerContract`,
    providerId,
    serviceId,
    contractVersion,
    status: providerStatus,
    online,
    route: requestState.route,
    advertisedCapabilities: capabilities,
    rawAdvertisedCapabilities,
    requiredCapabilities,
    optionalCapabilities,
    missingCapabilities,
    acceptsRoute,
    capabilityProfile: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.providerCapabilityProfile`,
      requestedProfile,
      requestedProfileKnown,
      selectedMode,
      profileCapabilities,
      profileGaps,
      supportsDurableExternalHandoff: externalCapable && syncCapable,
      supportsAuditedInlineHandoff: auditCapable,
      supportsDigestFollowupVerification: digestVerifyCapable,
      strictCapabilityNegotiation
    },
    capabilityNegotiation: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.providerCapabilityNegotiation`,
      complete: negotiationComplete,
      proofId: `${externalHandoffId}:negotiation:${negotiationDigest.slice(7, 23)}`,
      subjectDigest: negotiationDigest,
      requestedByClient: clientRequestedCapabilities,
      accepted: acceptedClientCapabilities,
      declined: declinedClientCapabilities,
      unsupported: unsupportedRequestedCapabilities,
      unsupportedAdvertised: unsupportedAdvertisedCapabilities,
      unsupportedRequired: unsupportedRequiredCapabilities,
      duplicateAdvertised: duplicateAdvertisedCapabilities,
      duplicateRequired: duplicateRequiredCapabilities,
      duplicateRequested: duplicateRequestedCapabilities,
      requiredSatisfied: missingCapabilities.length === 0,
      advertisedSupported: capabilities,
      advertisedRaw: rawAdvertisedCapabilities,
      optionalAccepted: optionalCapabilities,
      nextAction: negotiationComplete
        ? "use-negotiated-provider-contract"
        : unsupportedRequiredCapabilities.length > 0
          ? "remove-unsupported-required-provider-capabilities"
          : missingCapabilities.length > 0 || declinedClientCapabilities.length > 0
          ? "select-provider-with-required-capabilities"
          : "drop-unsupported-provider-capability-request"
    },
    sync: {
      mode: syncCapable ? "cursor" : "stateless",
      cursor: syncCursor,
      epoch: syncEpoch,
      watermark: syncWatermark,
      observedAt: generatedAt,
      replayWindowMs,
      deltaToken: syncCapable ? `${providerId}:${syncWatermark}:delta` : null,
      consistency: syncCapable ? "at-least-once" : "request-bound",
      requiresAcknowledgement: source.requiresAcknowledgement !== false
    },
    externalHandoff: {
      id: externalHandoffId,
      target: normalizeIdentifier(source.externalTarget || source.target || clientState.handoffTarget, clientState.handoffTarget),
      state: negotiationComplete ? externalCapable ? "ready" : "inline-only" : "blocked",
      durable: externalCapable,
      ackExpected: source.requiresAcknowledgement !== false,
      lease: {
        schema: `${BUNDLE_MANIFEST_SCHEMA}.externalHandoffLease`,
        leaseId: `${externalHandoffId}:lease`,
        issuedAt: generatedAt,
        expiresAt: externalCapable ? handoffLeaseExpiresAt : null,
        ttlMs: externalCapable ? handoffLeaseMs : 0,
        renewable: externalCapable && syncCapable
      },
      resumeToken: externalCapable ? `${externalHandoffId}:resume:${syncCursor}` : null,
      proofEnvelope: {
        schema: `${BUNDLE_MANIFEST_SCHEMA}.providerHandoffProofEnvelope`,
        proofId: `${externalHandoffId}:proof:${negotiationDigest.slice(7, 23)}`,
        subjectDigest: negotiationDigest,
        syncWatermark,
        requiresDigestVerification: !digestVerifyCapable,
        auditRequired: true,
        auditCapable
      }
    },
    negotiationComplete,
    issues
  };
}

function normalizeWorkspaceScope(input = {}, { tenantId, requestedBy }) {
  const source = input && typeof input === "object" ? input : {};
  const workspaceId = normalizeIdentifier(source.workspaceId || source.id || tenantId, tenantId);
  const hasRootPrefix = typeof source.rootPrefix === "string" && source.rootPrefix.trim();
  const rootPrefixCandidate = hasRootPrefix
    ? source.rootPrefix.trim().replace(/^\/+/, "").replace(/\/+$/g, "")
    : null;
  const rootPrefix = rootPrefixCandidate && !rootPrefixCandidate.includes("..")
    ? rootPrefixCandidate
    : null;
  const allowedRoles = normalizeStringList(source.allowedRoles).length > 0
    ? normalizeStringList(source.allowedRoles)
    : ["owner", "maintainer", "contributor", "kernel-worker"];
  const requestedIsolationMode = typeof source.tenantIsolationMode === "string"
    ? source.tenantIsolationMode.trim().toLowerCase()
    : typeof source.isolationMode === "string"
      ? source.isolationMode.trim().toLowerCase()
      : source.allowSharedArtifacts === true
        ? "shared-read"
        : "strict";
  const trustedTenantIds = normalizeStringList(source.trustedTenantIds || source.allowedTenantIds)
    .filter((candidate) => candidate !== tenantId);
  const sharedWorkspaceIds = normalizeStringList(source.sharedWorkspaceIds || source.allowedWorkspaceIds)
    .filter((candidate) => candidate !== workspaceId);
  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.workspaceScope`,
    tenantId,
    workspaceId,
    rootPrefix,
    boundaryMode: normalizeBoundaryMode(source.boundaryMode),
    allowSharedArtifacts: source.allowSharedArtifacts === true,
    allowedRoles,
    ownerActorId: normalizeIdentifier(source.ownerActorId || requestedBy, requestedBy),
    tenantBoundary: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.tenantBoundaryPolicy`,
      isolationMode: TENANT_ISOLATION_MODES.has(requestedIsolationMode) ? requestedIsolationMode : "strict",
      trustedTenantIds,
      sharedWorkspaceIds,
      allowCrossTenantArtifacts: source.allowCrossTenantArtifacts === true,
      requireAuditHandoff: source.requireAuditHandoff === false ? false : true,
      handoffAudience: normalizeIdentifier(source.handoffAudience || source.auditAudience, "tenant-audit-log")
    }
  };
}

function normalizeActorAccess(input = {}, { requestedBy, clientCapabilities, workspaceScope }) {
  const source = input && typeof input === "object" ? input : {};
  const role = normalizeIdentifier(source.role || source.actorRole, requestedBy === workspaceScope.ownerActorId ? "owner" : "contributor");
  const explicitPermissions = normalizeStringList(source.permissions);
  const rolePermissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.contributor;
  const permissions = [...new Set([...rolePermissions, ...clientCapabilities, ...explicitPermissions])];
  const missingPublishPermissions = REQUIRED_PUBLISH_PERMISSIONS
    .filter((permission) => !hasPermission(permissions, permission));
  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.actorAccess`,
    actorId: normalizeIdentifier(source.actorId || requestedBy, requestedBy),
    role,
    permissions,
    roleAllowedInWorkspace: workspaceScope.allowedRoles.includes(role),
    canPublish: missingPublishPermissions.length === 0,
    missingPublishPermissions
  };
}

function normalizePersistedBundleState(input = {}, { bundleId, generatedAt }) {
  const persisted = input && typeof input === "object" ? input : {};
  const priorBundleId = normalizeIdentifier(persisted.bundleId, bundleId);
  const revision = normalizeAttempt(persisted.revision) + 1;
  const commandJournal = normalizeCommandJournal(persisted.commandJournal || persisted.commands || persisted.replayJournal);
  const lastJournalCommand = commandJournal.length > 0 ? commandJournal[commandJournal.length - 1] : null;
  const lastCommandId = normalizeIdentifier(persisted.lastCommandId || lastJournalCommand?.commandId, "none");
  const packetCheckpoints = normalizePacketCheckpoints(
    persisted.packetCheckpoints || persisted.packetCheckpoint || persisted.packetRecovery || persisted.packets
  );
  const mailchimpManifest = normalizePersistedMailchimpManifestState(
    persisted.mailchimpManifest || persisted.mailchimpManifestReadiness || persisted.mailchimp || {},
    { bundleId, generatedAt }
  );
  const artifactStates = persisted.artifacts && typeof persisted.artifacts === "object"
    ? persisted.artifacts
    : {};

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.persistedState`,
    bundleId: priorBundleId === bundleId ? bundleId : priorBundleId,
    revision,
    lastCommandId,
    recoveredAt: generatedAt,
    restartCount: normalizeAttempt(persisted.restartCount) + (persisted.bundleId ? 1 : 0),
    commandJournal,
    commandJournalSummary: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.commandJournalSummary`,
      entryCount: commandJournal.length,
      lastCommandId,
      lastCommandStatus: lastJournalCommand?.status || "none",
      inFlightCommandIds: commandJournal
        .filter((entry) => entry.status === "queued" || entry.status === "in-flight")
        .map((entry) => entry.commandId),
      completedIdempotencyKeys: commandJournal
        .filter((entry) => COMMAND_SUCCESS_STATUSES.has(entry.status))
        .map((entry) => entry.idempotencyKey)
    },
    packetCheckpoints,
    packetCheckpointSummary: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.packetCheckpointSummary`,
      entryCount: CONTENT_ADDRESSED_PACKET_KINDS.length,
      reusablePacketKinds: CONTENT_ADDRESSED_PACKET_KINDS
        .filter((kind) => PACKET_CHECKPOINT_TERMINAL_STATES.has(packetCheckpoints[kind].state)),
      failedPacketKinds: CONTENT_ADDRESSED_PACKET_KINDS
        .filter((kind) => packetCheckpoints[kind].state === "failed"),
      missingPacketKinds: CONTENT_ADDRESSED_PACKET_KINDS
        .filter((kind) => packetCheckpoints[kind].state === "missing"),
      lastUpdatedAt: CONTENT_ADDRESSED_PACKET_KINDS
        .map((kind) => packetCheckpoints[kind].updatedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || null
    },
    mailchimpManifest,
    mailchimpManifestSummary: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.mailchimpManifestPersistedSummary`,
      status: mailchimpManifest.status,
      replayable: mailchimpManifest.replayable,
      terminal: mailchimpManifest.terminal,
      commandId: mailchimpManifest.commandId,
      idempotencyKey: mailchimpManifest.idempotencyKey,
      payloadDigestValid: mailchimpManifest.payloadDigestValid,
      targetScopeDigestValid: mailchimpManifest.targetScopeDigestValid,
      retryAfter: mailchimpManifest.retryAfter,
      acknowledgementToken: mailchimpManifest.acknowledgementToken
    },
    artifacts: Object.fromEntries(Object.entries(artifactStates)
      .filter(([artifactId]) => normalizeIdentifier(artifactId, "") === artifactId)
      .map(([artifactId, state]) => [artifactId, normalizePersistedArtifactState(state)]))
  };
}

function normalizeRequestState(request = {}) {
  return {
    route: normalizeIdentifier(request.route, DEFAULT_ROUTE),
    runtime: normalizeIdentifier(request.runtime, DEFAULT_RUNTIME),
    tenantId: normalizeIdentifier(request.tenantId || request.workspaceId, "local-workspace"),
    requestedBy: normalizeIdentifier(request.requestedBy || request.actorId, "kernel-worker"),
    intent: typeof request.intent === "string" && request.intent.trim()
      ? request.intent.trim().slice(0, 240)
      : "publish artifact bundle manifest"
  };
}

function buildIdempotencyKey({ bundleId, requestState, clientState }) {
  return [
    "bundle-manifest",
    requestState.tenantId,
    requestState.route,
    clientState.requestId,
    bundleId
  ].join(":");
}

function normalizeArtifactEntry(entry, index) {
  const source = entry && typeof entry === "object" ? entry : {};
  const id = normalizeIdentifier(source.id || source.artifactId || `artifact-${index + 1}`, `artifact-${index + 1}`);
  const path = typeof source.path === "string" ? source.path.trim() : "";
  const mediaType = typeof source.mediaType === "string" && source.mediaType.trim()
    ? source.mediaType.trim()
    : "application/octet-stream";
  const bytes = Number.isInteger(source.bytes) && source.bytes >= 0 ? source.bytes : null;
  const role = normalizeIdentifier(source.role, "bundle-member");
  const pathInspection = inspectReferencePath(path, `unplaced/${id}`, { requireInput: true });
  const normalizedPath = pathInspection.normalizedPath;
  const digestProof = normalizeDigestProof(source.digest || source.contentDigest || source.integrity, {
    artifactId: id,
    path: normalizedPath,
    bytes
  });
  const digest = digestProof.verified ? digestProof.digest : null;
  const issues = [];

  if (!pathInspection.valid) {
    issues.push({
      code: "invalid-artifact-path",
      severity: "error",
      artifactId: id,
      path: pathInspection.originalPath,
      normalizedPath,
      reasons: pathInspection.blockingReasons,
      detail: "Artifact paths must be relative bundle paths under the artifact root, without unsupported URI roots, control characters, or parent traversal."
    });
  }
  if (digestProof.state === "missing") {
    issues.push({
      code: "missing-artifact-digest",
      severity: "warning",
      artifactId: id,
      detail: "Artifact is accepted for handoff but cannot be independently verified until a digest is supplied."
    });
  } else if (digestProof.state === "invalid") {
    issues.push({
      code: "invalid-artifact-digest",
      severity: "warning",
      artifactId: id,
      detail: "Artifact digest must use sha256, sha384, sha512, or blake3 with a hex digest before it can satisfy proof coverage."
    });
  }

  return {
    artifact: {
      id,
      path: normalizedPath,
      tenantId: normalizeOptionalIdentifier(source.tenantId || source.ownerTenantId || source.provenanceTenantId),
      workspaceId: normalizeOptionalIdentifier(source.workspaceId || source.ownerWorkspaceId || source.provenanceWorkspaceId),
      mediaType,
      bytes,
      digest,
      digestProof,
      role,
      pathPolicy: pathInspection,
      proofRequired: digestProof.proofRequired
    },
    issues
  };
}

function isPathInsideWorkspace(path, workspaceScope) {
  if (!workspaceScope.rootPrefix) {
    return true;
  }
  return path === workspaceScope.rootPrefix || path.startsWith(`${workspaceScope.rootPrefix}/`);
}

function buildBoundaryEvaluation({ bundleId, artifacts, requestState, workspaceScope, actorAccess }) {
  const issues = [];
  if (workspaceScope.tenantId !== requestState.tenantId) {
    issues.push({
      code: "tenant-workspace-mismatch",
      severity: "error",
      tenantId: requestState.tenantId,
      workspaceTenantId: workspaceScope.tenantId,
      detail: "Workspace scope tenant must match the request tenant before bundle handoff."
    });
  }
  if (!actorAccess.roleAllowedInWorkspace) {
    issues.push({
      code: "role-outside-workspace-boundary",
      severity: "error",
      actorId: actorAccess.actorId,
      role: actorAccess.role,
      detail: "Actor role is not allowed to publish manifests for this workspace scope."
    });
  }
  if (!actorAccess.canPublish) {
    issues.push({
      code: "missing-publish-permissions",
      severity: "error",
      actorId: actorAccess.actorId,
      missingPermissions: actorAccess.missingPublishPermissions,
      detail: "Actor must have read, write, and publish permissions for hosted-kernel artifact handoff."
    });
  }
  for (const artifact of artifacts) {
    if (!isPathInsideWorkspace(artifact.path, workspaceScope)) {
      issues.push({
        code: workspaceScope.allowSharedArtifacts ? "artifact-outside-workspace-scope" : "artifact-crosses-workspace-boundary",
        severity: workspaceScope.allowSharedArtifacts ? "warning" : "error",
        artifactId: artifact.id,
        path: artifact.path,
        expectedPrefix: workspaceScope.rootPrefix,
        detail: "Artifact path must stay inside the normalized workspace root unless shared artifacts are explicitly allowed."
      });
    }
  }
  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.boundaryEvaluation`,
    bundleId,
    tenantId: requestState.tenantId,
    workspaceId: workspaceScope.workspaceId,
    boundaryMode: workspaceScope.boundaryMode,
    enforced: workspaceScope.boundaryMode === "enforced",
    issueCount: issues.length,
    blockingIssueCount: issues.filter((issue) => issue.severity === "error").length,
    issues
  };
}

function buildTenantIsolationEvaluation({ bundleId, artifacts, generatedAt, requestState, workspaceScope, actorAccess, providerContract }) {
  const policy = workspaceScope.tenantBoundary;
  const issues = [];
  const crossTenantArtifacts = [];
  const crossWorkspaceArtifacts = [];
  const auditSubjects = [];

  for (const artifact of artifacts) {
    const artifactTenantId = artifact.tenantId || requestState.tenantId;
    const artifactWorkspaceId = artifact.workspaceId || workspaceScope.workspaceId;
    const crossesTenant = artifactTenantId !== requestState.tenantId;
    const crossesWorkspace = artifactWorkspaceId !== workspaceScope.workspaceId;
    const tenantTrusted = policy.trustedTenantIds.includes(artifactTenantId);
    const workspaceShared = policy.sharedWorkspaceIds.includes(artifactWorkspaceId);
    const tenantAllowed = !crossesTenant
      || (policy.isolationMode !== "strict" && policy.allowCrossTenantArtifacts && tenantTrusted);
    const workspaceAllowed = !crossesWorkspace
      || (policy.isolationMode !== "strict" && (workspaceShared || workspaceScope.allowSharedArtifacts));

    if (crossesTenant) {
      crossTenantArtifacts.push(artifact.id);
      auditSubjects.push(`${artifact.id}@${artifactTenantId}`);
      if (!tenantAllowed) {
        issues.push({
          code: "artifact-tenant-boundary-violation",
          severity: "error",
          artifactId: artifact.id,
          artifactTenantId,
          requestTenantId: requestState.tenantId,
          isolationMode: policy.isolationMode,
          detail: "Artifact tenant provenance must match the request tenant unless the workspace policy explicitly trusts that tenant for handoff."
        });
      }
    }

    if (crossesWorkspace) {
      crossWorkspaceArtifacts.push(artifact.id);
      auditSubjects.push(`${artifact.id}@${artifactWorkspaceId}`);
      if (!workspaceAllowed) {
        issues.push({
          code: "artifact-workspace-boundary-violation",
          severity: workspaceScope.boundaryMode === "advisory" ? "warning" : "error",
          artifactId: artifact.id,
          artifactWorkspaceId,
          workspaceId: workspaceScope.workspaceId,
          isolationMode: policy.isolationMode,
          detail: "Artifact workspace provenance must be the active workspace or an explicitly shared workspace before handoff."
        });
      }
    }
  }

  const hasCrossBoundary = crossTenantArtifacts.length > 0 || crossWorkspaceArtifacts.length > 0;
  const trustedRole = TRUSTED_HANDOFF_ROLES.has(actorAccess.role) || hasPermission(actorAccess.permissions, "artifact:*");
  const auditCapable = providerContract.advertisedCapabilities.includes("manifest.audit");

  if (hasCrossBoundary && !trustedRole) {
    issues.push({
      code: "tenant-handoff-requires-trusted-role",
      severity: "error",
      actorId: actorAccess.actorId,
      role: actorAccess.role,
      detail: "Cross-tenant or shared-workspace artifact handoff requires an owner, maintainer, or kernel-worker role."
    });
  }
  if (hasCrossBoundary && policy.requireAuditHandoff && !auditCapable) {
    issues.push({
      code: "tenant-handoff-audit-required",
      severity: "error",
      providerId: providerContract.providerId,
      detail: "Cross-boundary bundle handoff requires a provider that accepts manifest audit records."
    });
  }

  const canonicalSubject = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.tenantIsolationSubject`,
    bundleId,
    route: requestState.route,
    tenantId: requestState.tenantId,
    workspaceId: workspaceScope.workspaceId,
    isolationMode: policy.isolationMode,
    crossTenantArtifacts,
    crossWorkspaceArtifacts,
    auditSubjects: [...new Set(auditSubjects)].sort()
  };
  const subjectDigest = sha256Digest(canonicalSubject);

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.tenantIsolation`,
    bundleId,
    generatedAt,
    tenantId: requestState.tenantId,
    workspaceId: workspaceScope.workspaceId,
    isolationMode: policy.isolationMode,
    requireAuditHandoff: policy.requireAuditHandoff,
    trustedRole,
    auditCapable,
    crossTenantArtifactIds: crossTenantArtifacts,
    crossWorkspaceArtifactIds: crossWorkspaceArtifacts,
    clear: issues.filter((issue) => issue.severity === "error").length === 0,
    issueCount: issues.length,
    blockingIssueCount: issues.filter((issue) => issue.severity === "error").length,
    auditHandoff: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.tenantAuditHandoff`,
      required: hasCrossBoundary && policy.requireAuditHandoff,
      ready: !hasCrossBoundary || ((!policy.requireAuditHandoff || auditCapable) && trustedRole),
      audience: policy.handoffAudience,
      providerId: providerContract.providerId,
      subjectDigest,
      token: `${bundleId}:tenant-boundary:${subjectDigest.slice(7, 23)}`,
      artifactIds: [...new Set([...crossTenantArtifacts, ...crossWorkspaceArtifacts])]
    },
    issues
  };
}

function shapeRecoverableArtifacts({ artifacts, persistedState, generatedAt }) {
  return artifacts.map((artifact) => {
    const previous = persistedState.artifacts[artifact.id] || {};
    const digestChanged = Boolean(previous.lastDigest && artifact.digest && previous.lastDigest !== artifact.digest);
    const alreadyPublished = previous.status === "published" && !digestChanged;
    const missingPersistedPath = !previous.persistedPath;
    const status = alreadyPublished
      ? "published"
      : digestChanged
        ? "accepted"
        : previous.status || "accepted";

    return {
      ...artifact,
      persistedState: {
        status,
        restartSafe: status === "published" || Boolean(previous.persistedPath),
        commandRequired: status === "published"
          ? "none"
          : missingPersistedPath
            ? "persist-artifact"
            : "resume-artifact-publish",
        persistedPath: previous.persistedPath || artifact.path,
        lastDigest: artifact.digest || previous.lastDigest || null,
        recoveredFromPriorRun: Boolean(previous.persistedPath || previous.lastDigest || previous.committedAt),
        digestChangedSinceLastCommit: digestChanged,
        observedAt: generatedAt
      }
    };
  });
}

function buildManifestIntegrity({ bundleId, artifacts, generatedAt, requestState, workspaceScope, providerContract }) {
  const artifactProofs = artifacts.map((artifact) => ({
    schema: `${BUNDLE_MANIFEST_SCHEMA}.manifestArtifactProof`,
    artifactId: artifact.id,
    path: artifact.path,
    mediaType: artifact.mediaType,
    bytes: artifact.bytes,
    digest: artifact.digest,
    digestState: artifact.digestProof.state,
    digestAlgorithm: artifact.digestProof.algorithm,
    verified: artifact.digestProof.verified,
    persistedPath: artifact.persistedState.persistedPath,
    commandRequired: artifact.persistedState.commandRequired
  }));
  const verifiedArtifactIds = artifactProofs
    .filter((proof) => proof.verified)
    .map((proof) => proof.artifactId);
  const unresolvedArtifactIds = artifactProofs
    .filter((proof) => !proof.verified)
    .map((proof) => proof.artifactId);
  const canonicalManifest = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.canonicalIntegritySubject`,
    bundleId,
    route: requestState.route,
    tenantId: requestState.tenantId,
    workspaceId: workspaceScope.workspaceId,
    workspaceRootPrefix: workspaceScope.rootPrefix || "bundle-relative",
    providerId: providerContract.providerId,
    artifacts: artifactProofs.map((proof) => ({
      artifactId: proof.artifactId,
      path: proof.path,
      mediaType: proof.mediaType,
      bytes: proof.bytes,
      digest: proof.digest,
      persistedPath: proof.persistedPath
    }))
  };
  const manifestDigest = sha256Digest(canonicalManifest);
  const manifestReference = createBundleManifestReference({
    bundleId,
    manifestDigest,
    route: requestState.route,
    tenantId: requestState.tenantId,
    workspaceId: workspaceScope.workspaceId,
    logicalRoot: workspaceScope.rootPrefix
      ? `${workspaceScope.rootPrefix}/manifests`
      : `manifests/${requestState.tenantId}/${workspaceScope.workspaceId}`
  });

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.manifestIntegrity`,
    generatedAt,
    algorithm: "sha256",
    bundleId,
    manifestDigest,
    manifestReference,
    canonicalManifest,
    artifactProofs,
    verifiedArtifactIds,
    unresolvedArtifactIds,
    complete: artifacts.length > 0 && unresolvedArtifactIds.length === 0,
    proofGapCount: unresolvedArtifactIds.length,
    verifierRoute: `${requestState.route}.integrity`,
    auditProof: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.integrityAuditProof`,
      proofId: `${bundleId}:integrity:${manifestDigest.slice(7, 23)}`,
      subjectDigest: manifestDigest,
      manifestReferenceUri: manifestReference.uri,
      manifestPath: manifestReference.manifestPath,
      proofPath: manifestReference.proofPath,
      providerId: providerContract.providerId,
      generatedAt,
      verifiedArtifactCount: verifiedArtifactIds.length,
      unresolvedArtifactCount: unresolvedArtifactIds.length,
      replaySafe: unresolvedArtifactIds.length === 0 || providerContract.advertisedCapabilities.includes("digest.verify")
    }
  };
}

function buildBundleProof({ artifacts, generatedAt, requestState, clientState, workspaceScope, actorAccess, boundaryEvaluation, tenantIsolation, providerContract, manifestIntegrity }) {
  const digestCoverage = artifacts.filter((artifact) => artifact.digest).length;
  const boundaryClear = (boundaryEvaluation.blockingIssueCount === 0 || boundaryEvaluation.boundaryMode === "advisory")
    && tenantIsolation.clear;
  const providerReady = providerContract.negotiationComplete && providerContract.online;
  return {
    proofType: "hosted-kernel.bundle-manifest",
    generatedAt,
    route: requestState.route,
    runtime: requestState.runtime,
    tenantId: requestState.tenantId,
    workspaceId: workspaceScope.workspaceId,
    workspaceRootPrefix: workspaceScope.rootPrefix || "bundle-relative",
    actorRole: actorAccess.role,
    actorCanPublish: actorAccess.canPublish,
    requestId: clientState.requestId,
    artifactCount: artifacts.length,
    digestCoverage,
    digestCoverageRatio: artifacts.length > 0 ? Number((digestCoverage / artifacts.length).toFixed(4)) : 0,
    completeDigestCoverage: artifacts.length > 0 && digestCoverage === artifacts.length,
    manifestDigest: manifestIntegrity.manifestDigest,
    manifestReferenceUri: manifestIntegrity.manifestReference.uri,
    manifestReferencePath: manifestIntegrity.manifestReference.manifestPath,
    integrityComplete: manifestIntegrity.complete,
    integrityProofId: manifestIntegrity.auditProof.proofId,
    unresolvedIntegrityArtifactIds: manifestIntegrity.unresolvedArtifactIds,
    boundaryClear,
    tenantIsolationClear: tenantIsolation.clear,
    tenantAuditHandoffReady: tenantIsolation.auditHandoff.ready,
    tenantAuditHandoffToken: tenantIsolation.auditHandoff.required ? tenantIsolation.auditHandoff.token : null,
    providerReady,
    providerId: providerContract.providerId,
    providerCapabilities: providerContract.advertisedCapabilities,
    handoffReady: artifacts.length > 0
      && boundaryClear
      && providerReady
      && actorAccess.canPublish
      && artifacts.every((artifact) => artifact.path && !artifact.path.includes(".."))
  };
}

function buildRestartStatus({ artifacts, validation, persistedState }) {
  const blockingIssues = validation.filter((issue) => issue.severity === "error");
  const pendingArtifacts = artifacts.filter((artifact) => artifact.persistedState.commandRequired !== "none");
  const digestChanges = artifacts.filter((artifact) => artifact.persistedState.digestChangedSinceLastCommit);
  const publishedArtifacts = artifacts.filter((artifact) => artifact.persistedState.status === "published");
  const restartSafe = blockingIssues.length === 0
    && artifacts.length > 0
    && artifacts.every((artifact) => artifact.persistedState.restartSafe || artifact.persistedState.commandRequired === "persist-artifact");

  return {
    status: blockingIssues.length > 0
      ? "blocked"
      : pendingArtifacts.length === 0
        ? "complete"
        : "recoverable",
    restartSafe,
    revision: persistedState.revision,
    recoveredArtifactCount: artifacts.filter((artifact) => artifact.persistedState.recoveredFromPriorRun).length,
    publishedArtifactCount: publishedArtifacts.length,
    pendingArtifactCount: pendingArtifacts.length,
    digestChangeCount: digestChanges.length,
    nextRecoveryCommand: blockingIssues.length > 0
      ? "repair-bundle-artifact-inputs"
      : pendingArtifacts.length === 0
        ? "acknowledge-bundle-published"
        : "resume-bundle-manifest-publish"
  };
}

function buildIdempotentCommand({ bundleId, generatedAt, requestState, clientState, artifacts, restartStatus, workspaceScope, boundaryEvaluation, tenantIsolation, lifecycleSettings, providerContract }) {
  const idempotencyKey = buildIdempotencyKey({ bundleId, requestState, clientState });
  const lifecycleBlocked = !lifecycleSettings.publishAllowedNow;
  const providerBlocked = !providerContract.negotiationComplete;
  return {
    command: providerBlocked
      ? "negotiate-provider-contract"
      : lifecycleBlocked
        ? `lifecycle-${lifecycleSettings.requestedCommand}-hold`
        : restartStatus.nextRecoveryCommand,
    idempotencyKey,
    commandId: `${idempotencyKey}:r${restartStatus.revision}`,
    issuedAt: generatedAt,
    route: requestState.route,
    tenantId: requestState.tenantId,
    workspaceId: workspaceScope.workspaceId,
    workspaceRootPrefix: workspaceScope.rootPrefix || "bundle-relative",
    bundleId,
    artifactIds: artifacts
      .filter((artifact) => artifact.persistedState.commandRequired !== "none")
      .map((artifact) => artifact.id),
    boundaryToken: `${requestState.tenantId}:${workspaceScope.workspaceId}:${workspaceScope.rootPrefix || "bundle-relative"}`,
    tenantBoundaryToken: tenantIsolation.auditHandoff.token,
    auditHandoffToken: tenantIsolation.auditHandoff.required ? tenantIsolation.auditHandoff.token : null,
    lifecycleGate: {
      enabled: lifecycleSettings.enabled,
      commandId: lifecycleSettings.commandId,
      requestedCommand: lifecycleSettings.requestedCommand,
      requestedCommandLabel: lifecycleSettings.requestedCommandLabel,
      effectiveState: lifecycleSettings.effectiveState,
      scheduleMode: lifecycleSettings.scheduleMode,
      activationAt: lifecycleSettings.activationAt,
      disabledUntil: lifecycleSettings.disabledUntil,
      publishAllowedNow: lifecycleSettings.publishAllowedNow,
      nextLifecycleAction: lifecycleSettings.nextLifecycleAction,
      commandState: lifecycleSettings.commandState,
      auditControl: lifecycleSettings.auditControl
    },
    providerGate: {
      providerId: providerContract.providerId,
      serviceId: providerContract.serviceId,
      contractVersion: providerContract.contractVersion,
      negotiationComplete: providerContract.negotiationComplete,
      selectedMode: providerContract.capabilityProfile.selectedMode,
      negotiationProofId: providerContract.capabilityNegotiation.proofId,
      missingCapabilities: providerContract.missingCapabilities,
      declinedCapabilities: providerContract.capabilityNegotiation.declined,
      unsupportedCapabilities: providerContract.capabilityNegotiation.unsupported,
      externalHandoffId: providerContract.externalHandoff.id,
      externalHandoffState: providerContract.externalHandoff.state,
      externalHandoffLeaseExpiresAt: providerContract.externalHandoff.lease.expiresAt,
      syncCursor: providerContract.sync.cursor
    },
    safeToReplay: restartStatus.status !== "blocked"
      && boundaryEvaluation.blockingIssueCount === 0
      && tenantIsolation.blockingIssueCount === 0
      && tenantIsolation.auditHandoff.ready
      && lifecycleSettings.publishAllowedNow
      && providerContract.negotiationComplete
  };
}

function buildCommandReplayState({ command, persistedState, restartStatus, artifacts, generatedAt }) {
  const matchingCommands = persistedState.commandJournal
    .filter((entry) => entry.idempotencyKey === command.idempotencyKey);
  const priorCommand = matchingCommands.length > 0 ? matchingCommands[matchingCommands.length - 1] : null;
  const pendingArtifactIds = artifacts
    .filter((artifact) => artifact.persistedState.commandRequired !== "none")
    .map((artifact) => artifact.id);
  const priorTerminal = priorCommand && COMMAND_TERMINAL_STATUSES.has(priorCommand.status);
  const priorSuccessful = priorCommand && COMMAND_SUCCESS_STATUSES.has(priorCommand.status);
  const priorInFlight = priorCommand && (priorCommand.status === "queued" || priorCommand.status === "in-flight");
  const priorFailed = priorCommand?.status === "failed";
  const completedWithNoPending = priorSuccessful && pendingArtifactIds.length === 0;
  const disposition = completedWithNoPending
    ? "already-completed"
    : priorInFlight
      ? "resume-in-flight"
      : priorFailed
        ? "retry-failed-command"
        : priorCommand?.status === "abandoned"
          ? "restart-after-abandoned-command"
        : priorTerminal
          ? "new-revision-after-terminal"
          : "issue-new-command";
  const durableCommandId = disposition === "already-completed" || disposition === "resume-in-flight"
    ? priorCommand.commandId
    : command.commandId;

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.commandReplay`,
    idempotencyKey: command.idempotencyKey,
    requestedCommandId: command.commandId,
    durableCommandId,
    disposition,
    duplicateSuppressed: disposition === "already-completed",
    resumesPriorCommand: disposition === "resume-in-flight",
    retryingPriorFailure: disposition === "retry-failed-command",
    priorCommand: priorCommand
      ? {
          commandId: priorCommand.commandId,
          command: priorCommand.command,
          status: priorCommand.status,
          attempt: priorCommand.attempt,
          issuedAt: priorCommand.issuedAt,
          acknowledgedAt: priorCommand.acknowledgedAt,
          completedAt: priorCommand.completedAt
        }
      : null,
    pendingArtifactIds,
    restartSafeStatus: restartStatus.status === "blocked"
      ? "blocked"
      : completedWithNoPending
        ? "complete"
        : priorInFlight
          ? "resume-required"
          : command.safeToReplay
            ? "replay-ready"
            : "held",
    journalAppend: completedWithNoPending
      ? null
      : {
          schema: `${BUNDLE_MANIFEST_SCHEMA}.persistedCommand`,
          commandId: durableCommandId,
          idempotencyKey: command.idempotencyKey,
          command: command.command,
          status: priorInFlight ? priorCommand.status : "queued",
          attempt: priorInFlight ? priorCommand.attempt : normalizeAttempt(persistedState.revision - 1),
          issuedAt: priorInFlight ? priorCommand.issuedAt : generatedAt,
          acknowledgedAt: priorInFlight ? priorCommand.acknowledgedAt : null,
          completedAt: null,
          artifactIds: pendingArtifactIds,
          recoveryNote: priorInFlight
            ? "Restart recovered an in-flight hosted-kernel command; resume without issuing a duplicate publish."
            : priorFailed
              ? "Restart will replay a previously failed hosted-kernel command with the same idempotency key."
              : "Restart created a durable hosted-kernel command journal entry for replay."
        }
  };
}

function compareHealthStatus(current, candidate) {
  return HEALTH_SEVERITY_RANK[candidate] > HEALTH_SEVERITY_RANK[current] ? candidate : current;
}

function buildFailureState(issue) {
  const failureClass = FAILURE_CLASS_BY_ISSUE_CODE[issue.code] || "validation";
  return {
    code: issue.code,
    severity: issue.severity,
    class: failureClass,
    retryable: issue.severity !== "error" && RETRYABLE_FAILURE_CLASSES.has(failureClass),
    artifactId: issue.artifactId || null,
    action: ACTION_BY_FAILURE_CLASS[failureClass] || ACTION_BY_FAILURE_CLASS.validation
  };
}

function calculateRetryPlan({ failureStates, restartStatus, command, healthPolicy, generatedAt }) {
  const attempt = normalizeAttempt(restartStatus.revision - 1);
  const retryable = command.safeToReplay
    && restartStatus.status !== "complete"
    && failureStates.every((failure) => failure.retryable || failure.severity !== "error")
    && attempt < healthPolicy.maxRetryAttempts;
  const backoffMs = Math.min(
    healthPolicy.maxBackoffMs,
    healthPolicy.initialBackoffMs * (2 ** Math.max(0, attempt))
  );
  const retryAt = retryable
    ? asIsoTimestamp(new Date(new Date(generatedAt).valueOf() + backoffMs))
    : null;

  return {
    retryable,
    attempt,
    maxAttempts: healthPolicy.maxRetryAttempts,
    exhausted: attempt >= healthPolicy.maxRetryAttempts,
    backoffMs: retryable ? backoffMs : 0,
    retryAt,
    commandId: retryable ? command.commandId : null,
    idempotencyKey: command.idempotencyKey
  };
}

function buildRecoveryTicket({ bundleId, generatedAt, proof, command, commandReplay, retryPlan, replayWatchdog, failureStates, degradedMode }) {
  const blockingFailures = failureStates.filter((failure) => failure.severity === "error");
  const retryFailures = failureStates.filter((failure) => failure.retryable);
  const proofGapFailures = failureStates.filter((failure) => failure.class === "proof-gap");
  const firstBlockingFailure = blockingFailures[0] || null;
  const firstRetryFailure = retryFailures[0] || null;
  const ticketState = blockingFailures.length > 0
    ? retryPlan.exhausted || replayWatchdog.exhausted
      ? "escalation-required"
      : "blocked"
    : retryPlan.retryable
      ? "retry-scheduled"
      : degradedMode
        ? "degraded-handoff"
        : failureStates.length > 0
          ? "attention-required"
          : "clear";
  const dispatchCommand = ticketState === "retry-scheduled"
    ? "dispatch-retry-after-backoff"
    : ticketState === "degraded-handoff"
      ? "dispatch-degraded-handoff-with-proof-followup"
      : ticketState === "escalation-required"
        ? "escalate-hosted-kernel-replay"
        : ticketState === "blocked"
          ? firstBlockingFailure?.action || "repair-bundle-manifest-before-replay"
          : command.command;
  const blockedBy = blockingFailures.map((failure) => ({
    code: failure.code,
    class: failure.class,
    artifactId: failure.artifactId || null,
    commandId: failure.commandId || null,
    action: failure.action
  }));
  const retryWindow = {
    retryable: retryPlan.retryable,
    attempt: retryPlan.attempt,
    maxAttempts: retryPlan.maxAttempts,
    exhausted: retryPlan.exhausted || replayWatchdog.exhausted,
    backoffMs: retryPlan.backoffMs,
    retryAt: retryPlan.retryAt,
    retryCommandId: retryPlan.commandId,
    idempotencyKey: retryPlan.idempotencyKey
  };
  const subjectDigest = sha256Digest({
    bundleId,
    commandId: commandReplay.durableCommandId,
    idempotencyKey: command.idempotencyKey,
    ticketState,
    retryWindow,
    blockedBy,
    proofGaps: proofGapFailures.map((failure) => failure.artifactId).filter(Boolean)
  });

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.recoveryTicket`,
    ticketId: `${commandReplay.durableCommandId}:recovery:${subjectDigest.slice(7, 23)}`,
    generatedAt,
    state: ticketState,
    dispatchCommand,
    route: `${command.route}.recovery`,
    severity: blockingFailures.length > 0 ? "error" : retryFailures.length > 0 ? "warning" : "info",
    subjectDigest,
    durableCommandId: commandReplay.durableCommandId,
    idempotencyKey: command.idempotencyKey,
    safeToReplay: command.safeToReplay && blockingFailures.length === 0,
    degradedHandoffAllowed: degradedMode && blockingFailures.length === 0,
    retryWindow,
    watchdog: {
      state: replayWatchdog.state,
      stale: replayWatchdog.stale,
      exhausted: replayWatchdog.exhausted,
      recoveryCommand: replayWatchdog.recoveryCommand,
      nextRetryAt: replayWatchdog.nextRetryAt
    },
    blockedBy,
    proofFollowupArtifactIds: proofGapFailures.map((failure) => failure.artifactId).filter(Boolean),
    primaryAction: firstBlockingFailure?.action || firstRetryFailure?.action || dispatchCommand,
    operatorRunbook: ticketState === "retry-scheduled"
      ? "Replay the durable command with the same idempotency key after retryAt; do not mint a replacement command."
      : ticketState === "degraded-handoff"
        ? "Continue handoff and require digest proof follow-up before final publish acknowledgement."
        : ticketState === "escalation-required"
          ? "Stop automatic replay and inspect the hosted-kernel command journal before another publish attempt."
          : ticketState === "blocked"
            ? "Resolve blocking bundle manifest failures before hosted-kernel replay."
            : "No recovery action is required.",
    userVisibleMessage: ticketState === "retry-scheduled"
      ? `Hosted-kernel replay is scheduled after ${retryPlan.retryAt}.`
      : ticketState === "degraded-handoff"
        ? "Bundle manifest can continue in degraded mode with digest proof follow-up."
        : ticketState === "escalation-required"
          ? "Hosted-kernel replay exhausted its retry budget and needs operator review."
          : firstBlockingFailure?.action || "Hosted-kernel bundle manifest recovery is clear."
  };
}

function buildCommandReplayWatchdog({ commandReplay, healthPolicy, generatedAt }) {
  const priorCommand = commandReplay.priorCommand;
  const nowMs = new Date(generatedAt).valueOf();
  const observedAt = priorCommand?.acknowledgedAt || priorCommand?.issuedAt || null;
  const observedMs = observedAt ? new Date(observedAt).valueOf() : NaN;
  const ageMs = Number.isFinite(observedMs) ? Math.max(0, nowMs - observedMs) : 0;
  const timeoutMs = priorCommand?.status === "queued"
    ? healthPolicy.commandAckTimeoutMs
    : healthPolicy.commandCompletionTimeoutMs;
  const watching = commandReplay.resumesPriorCommand && Boolean(priorCommand);
  const stale = watching && ageMs > timeoutMs;
  const attempt = normalizeAttempt(priorCommand?.attempt);
  const exhausted = stale && attempt >= healthPolicy.maxRetryAttempts;
  const backoffMs = stale
    ? Math.min(
        healthPolicy.maxBackoffMs,
        healthPolicy.initialBackoffMs * (2 ** Math.max(0, attempt))
      )
    : 0;
  const retryAt = stale && !exhausted
    ? asIsoTimestamp(new Date(nowMs + backoffMs))
    : null;
  const issueCode = priorCommand?.status === "queued" ? "stale-command-ack" : "stale-command-completion";
  const issue = stale
    ? {
        code: exhausted ? "command-retry-exhausted" : issueCode,
        severity: exhausted ? "error" : "warning",
        commandId: commandReplay.durableCommandId,
        idempotencyKey: commandReplay.idempotencyKey,
        ageMs,
        timeoutMs,
        attempt,
        retryAt,
        detail: exhausted
          ? "Hosted-kernel command replay exceeded the retry budget; operator intervention is required before another publish attempt."
          : "Hosted-kernel command replay has not advanced within the watchdog window; retry should use the durable idempotency key."
      }
    : null;

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.commandReplayWatchdog`,
    state: !watching
      ? "not-watching"
      : stale
        ? exhausted ? "retry-exhausted" : "stale"
        : "within-window",
    watching,
    stale,
    exhausted,
    observedAt,
    ageMs,
    timeoutMs: watching ? timeoutMs : 0,
    attempt,
    maxAttempts: healthPolicy.maxRetryAttempts,
    nextRetryAt: retryAt,
    backoffMs,
    issue,
    recoveryCommand: stale
      ? exhausted ? "escalate-stale-bundle-command" : "retry-stale-bundle-command"
      : commandReplay.resumesPriorCommand
        ? "wait-for-hosted-kernel-command-ack"
        : "none",
    durableCommandId: commandReplay.durableCommandId,
    idempotencyKey: commandReplay.idempotencyKey
  };
}

function buildOperationalHealth({ bundleId, artifacts, validation, proof, restartStatus, command, commandReplay, healthPolicy, generatedAt }) {
  const failureStates = validation.map(buildFailureState);
  const replayWatchdog = buildCommandReplayWatchdog({ commandReplay, healthPolicy, generatedAt });
  for (const artifact of artifacts) {
    if (artifact.persistedState.status === "failed") {
      failureStates.push({
        code: "artifact-persistence-failed",
        severity: "warning",
        class: "persistence",
        retryable: true,
        artifactId: artifact.id,
        action: ACTION_BY_FAILURE_CLASS.persistence
      });
    }
  }
  if (artifacts.length === 0) {
    failureStates.push({
      code: "empty-bundle-manifest",
      severity: "error",
      class: "empty",
      retryable: false,
      artifactId: null,
      action: ACTION_BY_FAILURE_CLASS.empty
    });
  }
  if (replayWatchdog.issue) {
    failureStates.push({
      code: replayWatchdog.issue.code,
      severity: replayWatchdog.issue.severity,
      class: "persistence",
      retryable: !replayWatchdog.exhausted,
      artifactId: null,
      commandId: replayWatchdog.durableCommandId,
      retryAt: replayWatchdog.nextRetryAt,
      action: replayWatchdog.exhausted
        ? "Escalate the stale hosted-kernel command before replaying; the retry budget has been exhausted."
        : ACTION_BY_FAILURE_CLASS.persistence
    });
  }

  const retryPlan = calculateRetryPlan({ failureStates, restartStatus, command, healthPolicy, generatedAt });
  const staleReplayRetryable = replayWatchdog.stale
    && !replayWatchdog.exhausted
    && command.safeToReplay
    && failureStates.every((failure) => failure.severity !== "error");
  const effectiveRetryPlan = staleReplayRetryable
    ? {
        ...retryPlan,
        retryable: true,
        attempt: replayWatchdog.attempt,
        maxAttempts: replayWatchdog.maxAttempts,
        exhausted: false,
        backoffMs: replayWatchdog.backoffMs,
        retryAt: replayWatchdog.nextRetryAt,
        commandId: replayWatchdog.durableCommandId,
        idempotencyKey: replayWatchdog.idempotencyKey,
        reason: replayWatchdog.issue.code
      }
    : retryPlan;
  const degradedMode = healthPolicy.degradedModeEnabled
    && proof.artifactCount > 0
    && proof.boundaryClear
    && !replayWatchdog.exhausted
    && failureStates.every((failure) => failure.class === "proof-gap" || failure.class === "persistence" || failure.severity !== "error");
  let status = "healthy";
  if (failureStates.some((failure) => failure.severity === "error")) {
    status = "failed";
  }
  if (degradedMode && status !== "failed" && !proof.completeDigestCoverage) {
    status = compareHealthStatus(status, "degraded");
  }
  if (effectiveRetryPlan.retryable) {
    status = compareHealthStatus(status, "retrying");
  }
  const recoveryTicket = buildRecoveryTicket({
    bundleId,
    generatedAt,
    proof,
    command,
    commandReplay,
    retryPlan: effectiveRetryPlan,
    replayWatchdog,
    failureStates,
    degradedMode
  });

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.operationalHealth`,
    status,
    degradedMode,
    actionable: failureStates.length > 0,
    failureStates,
    retryPlan: effectiveRetryPlan,
    replayWatchdog,
    recoveryTicket,
    userVisibleErrors: failureStates
      .filter((failure) => failure.severity === "error")
      .map((failure) => ({
        code: failure.code,
        artifactId: failure.artifactId,
        commandId: failure.commandId || null,
        action: failure.action,
        recoveryTicketId: recoveryTicket.ticketId
      })),
    nextOperatorAction: recoveryTicket.primaryAction || failureStates[0]?.action || "Continue hosted-kernel bundle handoff."
  };
}

function buildValidationSummary({ artifacts, validation, boundaryEvaluation, tenantIsolation, lifecycleSettings, providerContract }) {
  const bySeverity = Object.fromEntries(VALIDATION_SEVERITIES.map((severity) => [severity, 0]));
  const byFailureClass = {};
  const blockingArtifactIds = new Set();
  const digestProofGapArtifactIds = new Set();

  for (const issue of validation) {
    const severity = VALIDATION_SEVERITIES.includes(issue.severity) ? issue.severity : "info";
    const failureClass = FAILURE_CLASS_BY_ISSUE_CODE[issue.code] || "validation";
    bySeverity[severity] += 1;
    byFailureClass[failureClass] = (byFailureClass[failureClass] || 0) + 1;
    if (issue.artifactId && severity === "error") {
      blockingArtifactIds.add(issue.artifactId);
    }
    if ((issue.code === "missing-artifact-digest" || issue.code === "invalid-artifact-digest") && issue.artifactId) {
      digestProofGapArtifactIds.add(issue.artifactId);
    }
  }

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.validationSummary`,
    status: bySeverity.error > 0 ? "blocked" : bySeverity.warning > 0 ? "needs-attention" : "clear",
    counts: {
      total: validation.length,
      errors: bySeverity.error,
      warnings: bySeverity.warning,
      info: bySeverity.info,
      artifactCount: artifacts.length,
      blockingArtifactCount: blockingArtifactIds.size,
      digestProofGapCount: digestProofGapArtifactIds.size,
      boundaryIssueCount: boundaryEvaluation.issueCount,
      tenantIsolationIssueCount: tenantIsolation.issueCount,
      tenantIsolationBlockingIssueCount: tenantIsolation.blockingIssueCount,
      crossTenantArtifactCount: tenantIsolation.crossTenantArtifactIds.length,
      crossWorkspaceArtifactCount: tenantIsolation.crossWorkspaceArtifactIds.length,
      lifecycleIssueCount: lifecycleSettings.issues.length,
      providerIssueCount: providerContract.issues.length
    },
    bySeverity,
    byFailureClass,
    blockingArtifactIds: [...blockingArtifactIds],
    digestProofGapArtifactIds: [...digestProofGapArtifactIds],
    firstBlockingIssue: validation.find((issue) => issue.severity === "error") || null,
    userVisibleMessage: bySeverity.error > 0
      ? "Bundle manifest has blocking validation issues that must be repaired before hosted-kernel handoff."
      : bySeverity.warning > 0
        ? "Bundle manifest can continue, but proof or lifecycle warnings should be reviewed."
        : "Bundle manifest validation is clear for hosted-kernel handoff."
  };
}

function buildPreviewContract({ bundleId, artifacts, validation, workspaceScope, restartStatus, operationalHealth }) {
  const issueCodesByArtifact = new Map();
  for (const issue of validation) {
    if (!issue.artifactId) {
      continue;
    }
    const existing = issueCodesByArtifact.get(issue.artifactId) || [];
    existing.push(issue.code);
    issueCodesByArtifact.set(issue.artifactId, existing);
  }

  const rows = artifacts.map((artifact, index) => {
    const issueCodes = issueCodesByArtifact.get(artifact.id) || [];
    const blocked = issueCodes.some((code) => (FAILURE_CLASS_BY_ISSUE_CODE[code] || "validation") !== "proof-gap");
    const digestState = artifact.digestProof.state;
    const replayState = artifact.persistedState.commandRequired === "none"
      ? "published"
      : artifact.persistedState.commandRequired === "persist-artifact"
        ? "needs-persist"
        : "needs-resume";

    return {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.artifactPreviewRow`,
      ordinal: index + 1,
      artifactId: artifact.id,
      path: artifact.path,
      mediaType: artifact.mediaType,
      bytes: artifact.bytes,
      role: artifact.role,
      tenantId: artifact.tenantId || workspaceScope.tenantId,
      workspaceId: artifact.workspaceId || workspaceScope.workspaceId,
      crossesTenantBoundary: artifact.tenantId ? artifact.tenantId !== workspaceScope.tenantId : false,
      crossesWorkspaceBoundary: artifact.workspaceId ? artifact.workspaceId !== workspaceScope.workspaceId : false,
      workspaceRelativePath: workspaceScope.rootPrefix ? artifact.path.replace(`${workspaceScope.rootPrefix}/`, "") : artifact.path,
      digestState,
      digestAlgorithm: artifact.digestProof.algorithm,
      digestVerified: artifact.digestProof.verified,
      replayState,
      statusBadge: blocked ? "blocked" : artifact.proofRequired ? "proof-needed" : replayState,
      persistedPath: artifact.persistedState.persistedPath,
      commandRequired: artifact.persistedState.commandRequired,
      recoveredFromPriorRun: artifact.persistedState.recoveredFromPriorRun,
      issueCodes,
      userVisibleLabel: `${artifact.path} (${digestState === "verified" ? "digest attached" : "digest needed"})`
    };
  });

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.preview`,
    bundleId,
    title: `Bundle manifest ${bundleId}`,
    status: operationalHealth.status,
    restartStatus: restartStatus.status,
    artifactCount: rows.length,
    rows,
    emptyState: rows.length === 0 ? "Attach artifacts to preview the hosted-kernel bundle manifest." : null
  };
}

function buildAcceptanceContract({ proof, restartStatus, command, commandReplay, lifecycleSettings, providerContract, tenantIsolation, validationSummary, operationalHealth }) {
  const checklist = [
    {
      key: "artifacts-present",
      label: "Artifacts attached",
      passed: proof.artifactCount > 0,
      detail: `${proof.artifactCount} artifact${proof.artifactCount === 1 ? "" : "s"} in the bundle manifest.`
    },
    {
      key: "validation-clear",
      label: "Blocking validation clear",
      passed: validationSummary.counts.errors === 0,
      detail: validationSummary.userVisibleMessage
    },
    {
      key: "tenant-boundary-clear",
      label: "Tenant boundary clear",
      passed: tenantIsolation.clear && tenantIsolation.auditHandoff.ready,
      detail: tenantIsolation.clear
        ? "Tenant and workspace provenance are clear for this handoff."
        : "Cross-tenant or shared-workspace provenance must be approved before handoff."
    },
    {
      key: "provider-ready",
      label: "Hosted-kernel provider ready",
      passed: providerContract.negotiationComplete,
      detail: providerContract.negotiationComplete
        ? `${providerContract.providerId} accepted the route contract.`
        : "Provider contract must be negotiated before handoff."
    },
    {
      key: "lifecycle-open",
      label: "Lifecycle gate open",
      passed: lifecycleSettings.publishAllowedNow,
      detail: lifecycleSettings.publishAllowedNow
        ? "Lifecycle settings allow immediate publish replay."
        : `${lifecycleSettings.requestedCommandLabel} leaves lifecycle ${lifecycleSettings.effectiveState}; ${lifecycleSettings.nextLifecycleAction} is required.`
    },
    {
      key: "replay-safe",
      label: "Replay command safe",
      passed: command.safeToReplay && restartStatus.status !== "blocked",
      detail: command.safeToReplay ? `Replay command ${command.command} is idempotent.` : "Replay is blocked until the manifest gates are clear."
    }
  ];
  const failed = checklist.filter((item) => !item.passed);
  const accepted = failed.length === 0 && operationalHealth.status !== "failed";

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.acceptance`,
    accepted,
    state: accepted
      ? operationalHealth.status === "degraded" ? "accepted-with-proof-followup" : "accepted"
      : failed.some((item) => item.key === "lifecycle-open") && lifecycleSettings.scheduledForFuture
        ? "scheduled"
        : "blocked",
    readyForPublish: accepted && proof.completeDigestCoverage,
    readyForDegradedHandoff: accepted && !proof.completeDigestCoverage && operationalHealth.degradedMode,
    checklist,
    failedChecklistKeys: failed.map((item) => item.key),
    acceptanceToken: accepted ? `${commandReplay.durableCommandId}:accepted` : null,
    commandId: commandReplay.durableCommandId,
    commandReplayDisposition: commandReplay.disposition,
    idempotencyKey: command.idempotencyKey
  };
}

function buildExplainableNextSteps({ validationSummary, acceptance, lifecycleSettings, providerContract, command, operationalHealth }) {
  const steps = [];
  const recoveryTicket = operationalHealth.recoveryTicket;
  if (validationSummary.counts.errors > 0) {
    const firstBlockingCode = validationSummary.firstBlockingIssue?.code || "";
    const tenantBoundaryBlocked = firstBlockingCode.startsWith("tenant-")
      || firstBlockingCode.startsWith("artifact-tenant")
      || firstBlockingCode.startsWith("artifact-workspace");
    steps.push({
      stepId: "repair-validation",
      priority: 1,
      action: firstBlockingCode === "missing-publish-permissions"
        ? "update-actor-permissions"
        : tenantBoundaryBlocked
          ? "resolve-tenant-boundary-handoff"
          : "repair-bundle-artifact-inputs",
      reason: validationSummary.firstBlockingIssue?.detail || validationSummary.userVisibleMessage,
      blocksAcceptance: true
    });
  }
  if (operationalHealth.replayWatchdog.stale) {
    steps.push({
      stepId: "recover-stale-command",
      priority: operationalHealth.replayWatchdog.exhausted ? 1 : 2,
      action: operationalHealth.replayWatchdog.recoveryCommand,
      reason: operationalHealth.replayWatchdog.issue?.detail || "Hosted-kernel command replay has not advanced within the watchdog window.",
      blocksAcceptance: operationalHealth.replayWatchdog.exhausted,
      commandId: operationalHealth.replayWatchdog.durableCommandId,
      retryAt: operationalHealth.replayWatchdog.nextRetryAt
    });
  }
  if (recoveryTicket.state === "retry-scheduled" && !operationalHealth.replayWatchdog.stale) {
    steps.push({
      stepId: "retry-after-backoff",
      priority: 2,
      action: recoveryTicket.dispatchCommand,
      reason: recoveryTicket.userVisibleMessage,
      blocksAcceptance: false,
      recoveryTicketId: recoveryTicket.ticketId,
      commandId: recoveryTicket.durableCommandId,
      retryAt: recoveryTicket.retryWindow.retryAt,
      idempotencyKey: recoveryTicket.idempotencyKey
    });
  }
  if (recoveryTicket.state === "escalation-required") {
    steps.push({
      stepId: "escalate-recovery-ticket",
      priority: 1,
      action: recoveryTicket.dispatchCommand,
      reason: recoveryTicket.operatorRunbook,
      blocksAcceptance: true,
      recoveryTicketId: recoveryTicket.ticketId,
      commandId: recoveryTicket.durableCommandId
    });
  }
  if (!providerContract.negotiationComplete) {
    steps.push({
      stepId: "negotiate-provider",
      priority: 2,
      action: "negotiate-provider-contract",
      reason: providerContract.issues[0]?.detail || "Hosted-kernel provider contract is not ready.",
      blocksAcceptance: true
    });
  }
  if (!lifecycleSettings.publishAllowedNow) {
    steps.push({
      stepId: "open-lifecycle",
      priority: 3,
      action: lifecycleSettings.nextLifecycleAction,
      reason: lifecycleSettings.issues[0]?.detail || `Lifecycle gate is ${lifecycleSettings.effectiveState}.`,
      blocksAcceptance: true
    });
  }
  if (acceptance.accepted && acceptance.readyForDegradedHandoff) {
    steps.push({
      stepId: "attach-digests",
      priority: 4,
      action: "attach-digest-proof-followup",
      reason: "Bundle is accepted in degraded mode because at least one artifact is missing digest proof.",
      blocksAcceptance: false
    });
  }
  if (steps.length === 0) {
    steps.push({
      stepId: "execute-command",
      priority: 1,
      action: command.command,
      reason: operationalHealth.nextOperatorAction,
      blocksAcceptance: false
    });
  }

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.nextSteps`,
    currentCommand: command.command,
    safeToReplay: command.safeToReplay,
    nextStepCount: steps.length,
    primary: steps[0],
    steps: steps.sort((left, right) => left.priority - right.priority)
  };
}

function normalizePreviewDecisionInput(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const requestedAction = typeof source.action === "string"
    ? source.action.trim().toLowerCase()
    : typeof source.decision === "string"
      ? source.decision.trim().toLowerCase()
      : null;
  const action = PREVIEW_DECISION_ACTIONS.has(requestedAction) ? requestedAction : "accept";
  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.previewDecisionInput`,
    action,
    requestedAction: requestedAction || "accept",
    actorId: normalizeOptionalIdentifier(source.actorId || source.acceptedBy || source.reviewedBy),
    reason: typeof source.reason === "string" && source.reason.trim()
      ? source.reason.trim().slice(0, 220)
      : null,
    acknowledgedChecklistKeys: normalizeStringList(source.acknowledgedChecklistKeys || source.acknowledgedKeys),
    acknowledgedArtifactIds: normalizeStringList(source.acknowledgedArtifactIds || source.artifactIds)
  };
}

function buildPreviewDecisionContract({
  bundleId,
  generatedAt,
  requestState,
  clientState,
  preview,
  acceptance,
  validationSummary,
  nextSteps,
  command,
  commandReplay,
  manifestIntegrity,
  requestedDecision
}) {
  const decisionInput = normalizePreviewDecisionInput(requestedDecision);
  const failedKeys = new Set(acceptance.failedChecklistKeys);
  const acknowledgedFailedKeys = decisionInput.acknowledgedChecklistKeys
    .filter((key) => failedKeys.has(key));
  const missingAcknowledgements = acceptance.readyForDegradedHandoff
    ? acceptance.failedChecklistKeys
        .filter((key) => key !== "validation-clear")
        .filter((key) => !decisionInput.acknowledgedChecklistKeys.includes(key))
    : [];
  const rejectRequested = decisionInput.action === "reject" || decisionInput.action === "request-changes";
  const deferRequested = decisionInput.action === "defer";
  const acceptRequested = decisionInput.action === "accept";
  const blockedReasons = [];

  if (acceptRequested && !acceptance.accepted) {
    blockedReasons.push("preview-not-accepted");
  }
  if (acceptRequested && validationSummary.counts.errors > 0) {
    blockedReasons.push("validation-errors");
  }
  if (acceptRequested && missingAcknowledgements.length > 0) {
    blockedReasons.push("missing-degraded-handoff-acknowledgement");
  }
  if (rejectRequested && !decisionInput.reason) {
    blockedReasons.push("review-reason-required");
  }

  const decisionState = blockedReasons.length > 0
    ? "blocked"
    : rejectRequested
      ? "changes-requested"
      : deferRequested || acceptance.state === "scheduled"
        ? "deferred"
        : acceptance.readyForPublish
          ? "approved-for-publish"
          : acceptance.readyForDegradedHandoff
            ? "approved-with-proof-followup"
            : "accepted";
  const decisionDigest = sha256Digest({
    bundleId,
    requestId: clientState.requestId,
    action: decisionInput.action,
    decisionState,
    manifestDigest: manifestIntegrity.manifestDigest,
    commandId: commandReplay.durableCommandId,
    failedChecklistKeys: acceptance.failedChecklistKeys,
    acknowledgedChecklistKeys: decisionInput.acknowledgedChecklistKeys,
    reason: decisionInput.reason
  });
  const callbackEvent = decisionState === "changes-requested"
    ? "blocked"
    : decisionState === "deferred"
      ? "accepted"
      : acceptance.readyForDegradedHandoff
        ? "digest-followup"
        : acceptance.accepted
          ? "accepted"
          : "blocked";

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.previewDecision`,
    bundleId,
    generatedAt,
    route: requestState.route,
    requestId: clientState.requestId,
    clientId: clientState.clientId,
    previewTitle: preview.title,
    action: decisionInput.action,
    state: decisionState,
    acceptedByKernel: acceptance.accepted,
    readyForPublish: acceptance.readyForPublish && decisionState === "approved-for-publish",
    readyForDegradedHandoff: acceptance.readyForDegradedHandoff && decisionState === "approved-with-proof-followup",
    blockedReasons,
    requiresOperatorReason: rejectRequested,
    requiresDigestAcknowledgement: acceptance.readyForDegradedHandoff,
    missingAcknowledgements,
    acknowledgedFailedChecklistKeys: acknowledgedFailedKeys,
    acknowledgedArtifactIds: decisionInput.acknowledgedArtifactIds
      .filter((artifactId) => preview.rows.some((row) => row.artifactId === artifactId)),
    decisionToken: blockedReasons.length === 0
      ? `${commandReplay.durableCommandId}:preview:${decisionDigest.slice(7, 23)}`
      : null,
    decisionDigest,
    manifestDigest: manifestIntegrity.manifestDigest,
    commandId: commandReplay.durableCommandId,
    idempotencyKey: command.idempotencyKey,
    nextAction: decisionState === "changes-requested"
      ? "return-preview-for-changes"
      : decisionState === "deferred"
        ? "hold-preview-decision"
        : nextSteps.primary?.action || command.command,
    callback: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.previewDecisionCallback`,
      eventName: callbackEvent,
      route: clientState.workflow.callbackRoute,
      subscribed: clientState.workflow.notifyOn.includes(callbackEvent),
      payload: {
        bundleId,
        requestId: clientState.requestId,
        state: decisionState,
        action: decisionInput.action,
        commandId: commandReplay.durableCommandId,
        decisionToken: blockedReasons.length === 0
          ? `${commandReplay.durableCommandId}:preview:${decisionDigest.slice(7, 23)}`
          : null
      }
    },
    userVisibleMessage: blockedReasons.length > 0
      ? "Preview decision is blocked until the listed requirements are cleared."
      : decisionState === "changes-requested"
        ? "Preview returned for changes before hosted-kernel handoff."
        : decisionState === "deferred"
          ? "Preview decision deferred; hosted-kernel replay remains held."
          : acceptance.readyForDegradedHandoff
            ? "Preview approved with digest proof follow-up required."
      : "Preview approved for hosted-kernel publish replay."
  };
}

function normalizeMailchimpManifestSettings(input = {}) {
  const source = input.mailchimpManifest
    || input.mailchimp
    || input.integration?.mailchimp
    || input.client?.mailchimp
    || {};
  const audienceId = normalizeOptionalIdentifier(source.audienceId || source.listId || source.audience);
  const campaignId = normalizeOptionalIdentifier(source.campaignId || source.campaign);
  const accountId = normalizeOptionalIdentifier(source.accountId || source.providerAccountId || source.mailchimpAccountId);
  const dataCenterSource = typeof source.dataCenter === "string"
    ? source.dataCenter
    : typeof source.dc === "string"
      ? source.dc
      : source.serverPrefix;
  const dataCenter = normalizeOptionalIdentifier(
    typeof dataCenterSource === "string"
      ? dataCenterSource.trim().toLowerCase().replace(/[^a-z0-9-]/g, "")
      : null
  );
  const journeyId = normalizeOptionalIdentifier(source.journeyId || source.automationId || source.customerJourneyId);
  const syncCursor = normalizeOptionalIdentifier(source.syncCursor || source.cursor || source.lastWebhookCursor);
  const mode = typeof source.mode === "string" ? source.mode.trim().toLowerCase() : "campaign-manifest";
  const mergeTagPrefix = typeof source.mergeTagPrefix === "string" && source.mergeTagPrefix.trim()
    ? source.mergeTagPrefix.trim().replace(/[^A-Za-z0-9_:-]/g, "_").slice(0, 40)
    : "AIOS_BUNDLE";
  const enabled = typeof source.enabled === "boolean"
    ? source.enabled
    : Boolean(audienceId || campaignId || source.requireAcceptance === true);

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.mailchimpManifestSettings`,
    enabled,
    mode: ["campaign-manifest", "audience-archive", "journey-proof"].includes(mode)
      ? mode
      : "campaign-manifest",
    accountId,
    dataCenter,
    audienceId,
    campaignId,
    journeyId,
    syncCursor,
    requireAcceptance: source.requireAcceptance !== false,
    requireDigestCoverage: source.requireDigestCoverage !== false,
    allowDegradedProofFollowup: source.allowDegradedProofFollowup === true,
    requireAcknowledgement: source.requireAcknowledgement !== false,
    mergeTagPrefix,
    webhookRoute: typeof source.webhookRoute === "string" && source.webhookRoute.startsWith("/")
      ? source.webhookRoute
      : null
  };
}

function buildMailchimpManifestTargetScope({ bundleId, generatedAt, settings, requestState, clientState, artifactRows }) {
  const targetKind = settings.mode === "campaign-manifest"
    ? "campaign"
    : settings.mode === "journey-proof"
      ? "journey"
      : "audience";
  const targetId = targetKind === "campaign"
    ? settings.campaignId
    : targetKind === "journey"
      ? settings.journeyId
      : settings.audienceId;
  const targetKey = [
    "mailchimp",
    settings.accountId || "account-unbound",
    settings.dataCenter || "dc-unbound",
    targetKind,
    targetId || "target-unbound"
  ].join(":");
  const workspaceId = requestState.workspaceId || requestState.tenantId;
  const workspaceKey = `${requestState.tenantId}:${workspaceId}`;
  const missingBindings = [
    !settings.accountId ? "mailchimp-account-id-required" : null,
    !settings.dataCenter ? "mailchimp-data-center-required" : null,
    !targetId ? `mailchimp-${targetKind}-id-required` : null
  ].filter(Boolean);
  const exportableRows = artifactRows.filter((row) => row.exportable).length;
  const scopeSubject = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.mailchimpTargetScopeSubject`,
    bundleId,
    generatedAt,
    requestId: clientState.requestId,
    correlationId: clientState.correlationId,
    workspaceKey,
    targetKey,
    targetKind,
    targetId,
    syncCursor: settings.syncCursor,
    exportableRows
  };

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.mailchimpTargetScope`,
    provider: "mailchimp",
    tenantId: requestState.tenantId,
    workspaceId,
    workspaceKey,
    accountId: settings.accountId,
    dataCenter: settings.dataCenter,
    audienceId: settings.audienceId,
    campaignId: settings.campaignId,
    journeyId: settings.journeyId,
    targetKind,
    targetId,
    targetKey,
    syncCursor: settings.syncCursor,
    exportableRows,
    missingBindings,
    bound: missingBindings.length === 0,
    subjectDigest: sha256Digest(scopeSubject),
    canonicalSubject: scopeSubject
  };
}

function buildMailchimpManifestReadiness({
  bundleId,
  generatedAt,
  requestState,
  clientState,
  preview,
  acceptance,
  previewDecision,
  validationSummary,
  nextSteps,
  command,
  commandReplay,
  manifestIntegrity,
  providerContract,
  lifecycleSettings,
  operationalHealth,
  persistedState,
  input
}) {
  const settings = normalizeMailchimpManifestSettings(input);
  const artifactRows = preview.rows.map((row) => {
    const blockedReasons = [
      row.statusBadge === "blocked" ? "artifact-preview-blocked" : null,
      settings.requireDigestCoverage && !row.digestVerified ? "digest-proof-required" : null,
      row.crossesTenantBoundary ? "tenant-boundary-review-required" : null,
      row.crossesWorkspaceBoundary ? "workspace-boundary-review-required" : null
    ].filter(Boolean);

    return {
      rowId: sha256Digest({
        bundleId,
        artifactId: row.artifactId,
        path: row.path,
        mailchimpMode: settings.mode,
        blockedReasons
      }),
      artifactId: row.artifactId,
      path: row.path,
      status: blockedReasons.length === 0 ? "exportable" : "blocked",
      exportable: blockedReasons.length === 0,
      blockedReasons,
      mergeFields: {
        AIOS_BUNDLE_ID: bundleId,
        AIOS_ARTIFACT_ID: row.artifactId,
        AIOS_PATH: row.workspaceRelativePath,
        AIOS_DIGEST: row.digestVerified ? row.digestAlgorithm : "missing",
        AIOS_COMMAND: commandReplay.durableCommandId
      },
      tags: normalizeStringList([
        `${settings.mergeTagPrefix}:BUNDLE:${bundleId}`,
        `${settings.mergeTagPrefix}:ARTIFACT:${row.artifactId}`,
        row.digestVerified ? `${settings.mergeTagPrefix}:DIGESTED` : `${settings.mergeTagPrefix}:DIGEST_FOLLOWUP`,
        row.statusBadge === "blocked" ? `${settings.mergeTagPrefix}:BLOCKED` : `${settings.mergeTagPrefix}:READY`
      ].map((tag) => tag.toUpperCase()))
    };
  });
  const exportableRows = artifactRows.filter((row) => row.exportable);
  const blockedRows = artifactRows.filter((row) => !row.exportable);
  const targetScope = buildMailchimpManifestTargetScope({
    bundleId,
    generatedAt,
    settings,
    requestState,
    clientState,
    artifactRows
  });
  const degradedAllowed = settings.allowDegradedProofFollowup
    && acceptance.readyForDegradedHandoff
    && operationalHealth.degradedMode;
  const blockedReasons = [
    !settings.enabled ? "mailchimp-manifest-disabled" : null,
    settings.mode !== "campaign-manifest" && !settings.audienceId ? "mailchimp-audience-id-required" : null,
    settings.mode === "campaign-manifest" && !settings.campaignId ? "mailchimp-campaign-id-required" : null,
    settings.mode === "journey-proof" && !settings.journeyId ? "mailchimp-journey-id-required" : null,
    !targetScope.bound ? "mailchimp-target-scope-unbound" : null,
    settings.requireAcceptance && !acceptance.accepted ? "manifest-acceptance-required" : null,
    previewDecision.state === "blocked" ? "preview-decision-blocked" : null,
    validationSummary.counts.errors > 0 ? "manifest-validation-errors" : null,
    !providerContract.negotiationComplete ? "provider-contract-not-ready" : null,
    !lifecycleSettings.publishAllowedNow ? "lifecycle-gate-not-open" : null,
    operationalHealth.status === "failed" ? "operational-health-failed" : null,
    settings.requireDigestCoverage && blockedRows.some((row) => row.blockedReasons.includes("digest-proof-required")) && !degradedAllowed
      ? "digest-proof-followup-not-allowed"
      : null,
    artifactRows.length === 0 ? "mailchimp-manifest-empty" : null
  ].filter(Boolean);
  const status = blockedReasons.length === 0 && blockedRows.length === 0
    ? "ready"
    : settings.enabled && degradedAllowed && exportableRows.length > 0 && validationSummary.counts.errors === 0
      ? "degraded-ready"
      : "blocked";
  const payloadDigest = sha256Digest({
    bundleId,
    generatedAt,
    settings,
    commandId: commandReplay.durableCommandId,
    manifestDigest: manifestIntegrity.manifestDigest,
    rowIds: artifactRows.map((row) => row.rowId),
    status
  });
  const persistedMailchimp = persistedState.mailchimpManifest;
  const payloadMatchesPersisted = persistedMailchimp.payloadDigest === payloadDigest;
  const targetMatchesPersisted = persistedMailchimp.targetScopeDigest === targetScope.subjectDigest;
  const acknowledgedDuplicate = payloadMatchesPersisted
    && targetMatchesPersisted
    && persistedMailchimp.status === "acknowledged";
  const replayablePriorHandoff = payloadMatchesPersisted
    && targetMatchesPersisted
    && persistedMailchimp.replayable;
  const recoveryBlocked = persistedMailchimp.status === "failed"
    && persistedMailchimp.retryAfter
    && new Date(persistedMailchimp.retryAfter).valueOf() > new Date(generatedAt).valueOf();
  const nextAction = status === "ready"
    ? acknowledgedDuplicate
      ? "reuse-acknowledged-mailchimp-manifest"
      : replayablePriorHandoff
        ? "replay-mailchimp-manifest-handoff"
        : "dispatch-mailchimp-manifest"
    : status === "degraded-ready"
      ? replayablePriorHandoff
        ? "replay-mailchimp-manifest-handoff-with-digest-followup"
        : "dispatch-mailchimp-manifest-with-digest-followup"
      : blockedReasons.includes("lifecycle-gate-not-open")
        ? lifecycleSettings.nextLifecycleAction
        : blockedReasons.includes("provider-contract-not-ready")
          ? "negotiate-provider-contract"
          : blockedReasons.includes("manifest-acceptance-required")
            ? "accept-bundle-preview"
            : nextSteps.primary?.action || "repair-mailchimp-manifest";
  const handoffDispatchable = status === "ready" && !acknowledgedDuplicate && !recoveryBlocked;
  const degradedDispatchable = status === "degraded-ready" && !acknowledgedDuplicate && !recoveryBlocked;
  const recoveryCheckpoint = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.mailchimpManifestRecoveryCheckpoint`,
    state: acknowledgedDuplicate
      ? "already-acknowledged"
      : recoveryBlocked
        ? "retry-window-open"
        : replayablePriorHandoff
          ? "replayable"
          : payloadMatchesPersisted || targetMatchesPersisted
            ? "changed"
            : "new",
    priorStatus: persistedMailchimp.status,
    priorCommandId: persistedMailchimp.commandId,
    priorIdempotencyKey: persistedMailchimp.idempotencyKey,
    priorPayloadDigest: persistedMailchimp.payloadDigest,
    priorTargetScopeDigest: persistedMailchimp.targetScopeDigest,
    payloadMatchesPersisted,
    targetMatchesPersisted,
    acknowledgedDuplicate,
    replayablePriorHandoff,
    retryAfter: persistedMailchimp.retryAfter,
    resumeToken: persistedMailchimp.resumeToken,
    acknowledgementToken: persistedMailchimp.acknowledgementToken,
    restartSafe: acknowledgedDuplicate || replayablePriorHandoff || status === "blocked",
    nextRecoveryAction: acknowledgedDuplicate
      ? "reuse-acknowledged-mailchimp-manifest"
      : recoveryBlocked
        ? "wait-for-mailchimp-retry-window"
        : replayablePriorHandoff
          ? "replay-mailchimp-manifest-handoff"
          : status === "blocked"
            ? "persist-blocked-mailchimp-preview"
            : "write-mailchimp-manifest-checkpoint"
  };

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.mailchimpManifestReadiness`,
    bundleId,
    generatedAt,
    status,
    ready: status === "ready",
    degradedReady: status === "degraded-ready",
    settings,
    target: {
      provider: "mailchimp",
      accountId: settings.accountId,
      dataCenter: settings.dataCenter,
      audienceId: settings.audienceId,
      campaignId: settings.campaignId,
      journeyId: settings.journeyId,
      scopeKey: targetScope.targetKey,
      webhookRoute: settings.webhookRoute
    },
    targetScope,
    validationSummary: {
      ok: status === "ready" && !recoveryBlocked,
      blockedReasons,
      recoveryBlocked,
      artifactRows: artifactRows.length,
      exportableRows: exportableRows.length,
      blockedRows: blockedRows.length,
      degradedAllowed
    },
    recoveryCheckpoint,
    handoff: {
      command: "bundle-manifest.mailchimp.dispatch",
      route: "/artifact-filesystem/bundle-manifest/handoff/mailchimp",
      method: "POST",
      dispatchable: handoffDispatchable,
      degradedDispatchable,
      payloadContract: `${BUNDLE_MANIFEST_SCHEMA}.mailchimpPayload.v1`,
      payloadDigest,
      targetScopeDigest: targetScope.subjectDigest,
      resumeToken: sha256Digest({
        bundleId,
        commandId: commandReplay.durableCommandId,
        targetKey: targetScope.targetKey,
        syncCursor: settings.syncCursor,
        payloadDigest
      }),
      acknowledgement: {
        required: settings.requireAcknowledgement,
        expectedState: settings.requireAcknowledgement ? "mailchimp-handoff-acknowledged" : "not-required",
        webhookRoute: settings.webhookRoute,
        syncCursor: settings.syncCursor,
        targetScopeDigest: targetScope.subjectDigest
      },
      idempotencyKey: sha256Digest({
        bundleId,
        commandId: commandReplay.durableCommandId,
        providerId: providerContract.providerId,
        targetScope: targetScope.subjectDigest,
        payloadDigest
      }),
      duplicateSuppressed: acknowledgedDuplicate,
      replayingPriorHandoff: replayablePriorHandoff,
      recoveryCheckpointState: recoveryCheckpoint.state
    },
    nextAction: {
      action: nextAction,
      status: status === "blocked" || recoveryBlocked ? "blocked" : acknowledgedDuplicate ? "complete" : "ready",
      reason: recoveryBlocked ? "mailchimp-retry-window-open" : blockedReasons[0] || recoveryCheckpoint.state || status,
      commandId: commandReplay.durableCommandId
    },
    rows: artifactRows,
    previewRows: artifactRows.slice(0, 25),
    proof: sha256Digest({
      bundleId,
      status,
      blockedReasons,
      payloadDigest,
      manifestDigest: manifestIntegrity.manifestDigest
    })
  };
}

function buildClientWorkflowHandoff({
  bundleId,
  generatedAt,
  requestState,
  clientState,
  preview,
  acceptance,
  previewDecision,
  validationSummary,
  nextSteps,
  command,
  commandReplay,
  manifestIntegrity,
  providerContract,
  tenantIsolation,
  operationalHealth
}) {
  const workflow = clientState.workflow;
  const providerSupportsExternal = providerContract.externalHandoff.durable && providerContract.externalHandoff.state === "ready";
  const preferredChannel = workflow.channel === "external" && providerSupportsExternal
    ? "external"
    : workflow.channel === "audit-only"
      ? "audit-only"
      : acceptance.state === "scheduled"
        ? "deferred"
        : workflow.channel === "deferred"
          ? "deferred"
          : "inline";
  const terminal = acceptance.accepted && operationalHealth.status !== "retrying";
  const blocked = validationSummary.counts.errors > 0 || operationalHealth.status === "failed";
  const workflowState = blocked
    ? "blocked"
    : acceptance.readyForPublish
      ? "publish-ready"
      : acceptance.readyForDegradedHandoff
        ? "proof-followup-required"
        : acceptance.state === "scheduled"
          ? "scheduled"
          : terminal
            ? "accepted"
            : "in-progress";
  const acknowledgementRequired = workflow.requireAcknowledgement || providerContract.sync.requiresAcknowledgement;
  const callbackEvent = blocked
    ? "blocked"
    : acceptance.readyForDegradedHandoff
      ? "digest-followup"
      : acceptance.accepted
        ? "accepted"
        : operationalHealth.status === "failed"
          ? "failed"
          : "blocked";
  const publishableArtifactIds = preview.rows
    .filter((row) => row.commandRequired !== "none" && row.statusBadge !== "blocked")
    .map((row) => row.artifactId);
  const deadlineMs = workflow.deadlineAt ? new Date(workflow.deadlineAt).valueOf() : NaN;
  const deadlineExpired = Number.isFinite(deadlineMs) && deadlineMs <= new Date(generatedAt).valueOf();
  const responseFormat = workflow.responseFormat;
  const includesManifestPayload = workflow.wantsManifestPayload && responseFormat !== "summary";
  const includesAuditEnvelope = workflow.wantsAuditEnvelope || responseFormat === "audit-envelope";
  const recoveryTicket = operationalHealth.recoveryTicket;
  const deliveryState = deadlineExpired
    ? "expired"
    : blocked
      ? "blocked"
      : recoveryTicket.state === "retry-scheduled"
        ? "retry-scheduled"
      : preferredChannel === "external" && providerSupportsExternal
        ? "leased-external"
        : preferredChannel === "deferred" || acceptance.state === "scheduled"
          ? "deferred"
          : acknowledgementRequired
            ? "awaiting-acknowledgement"
            : "deliverable";
  const callbackDeliveryState = !workflow.notifyOn.includes(callbackEvent)
    ? "not-subscribed"
    : deadlineExpired
      ? "expired"
      : blocked
        ? "deliver-blocked"
        : "deliver-ready";
  const handoffEnvelopeDigest = sha256Digest({
    bundleId,
    requestId: clientState.requestId,
    correlationId: clientState.correlationId,
    workflowState,
    channel: preferredChannel,
    responseFormat,
    callbackEvent,
    commandId: commandReplay.durableCommandId,
    externalHandoffId: providerContract.externalHandoff.id,
    manifestReferenceUri: manifestIntegrity.manifestReference.uri,
    decisionToken: previewDecision.decisionToken
  });

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.clientWorkflowHandoff`,
    bundleId,
    generatedAt,
    clientId: clientState.clientId,
    sessionId: clientState.sessionId,
    requestId: clientState.requestId,
    correlationId: clientState.correlationId,
    route: requestState.route,
    target: clientState.handoffTarget,
    channel: preferredChannel,
    callbackRoute: workflow.callbackRoute,
    returnTo: workflow.returnTo,
    requestedAction: workflow.requestedAction,
    responseFormat,
    urgency: workflow.urgency,
    deadlineAt: workflow.deadlineAt,
    deadlineExpired,
    state: workflowState,
    userVisibleTitle: preview.title,
    userVisibleStatus: validationSummary.userVisibleMessage,
    delivery: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.clientDelivery`,
      state: deliveryState,
      envelopeId: `${commandReplay.durableCommandId}:client-envelope:${handoffEnvelopeDigest.slice(7, 23)}`,
      subjectDigest: handoffEnvelopeDigest,
      format: responseFormat,
      channel: preferredChannel,
      urgency: workflow.urgency,
      deadlineAt: workflow.deadlineAt,
      expired: deadlineExpired,
      includesManifestPayload,
      includesAuditEnvelope,
      includesPreviewRows: workflow.expectsPreview,
      callbackDeliveryState,
      callbackRoute: workflow.callbackRoute,
      correlationId: clientState.correlationId,
      externalLeaseExpiresAt: preferredChannel === "external" ? providerContract.externalHandoff.lease.expiresAt : null,
      manifestReferenceUri: includesManifestPayload ? manifestIntegrity.manifestReference.uri : null,
      manifestReferencePath: includesManifestPayload ? manifestIntegrity.manifestReference.manifestPath : null,
      nextClientAction: deadlineExpired
        ? "refresh-bundle-manifest-request"
        : blocked
          ? "review-blocking-bundle-manifest-errors"
          : recoveryTicket.state === "retry-scheduled"
            ? recoveryTicket.dispatchCommand
          : previewDecision.readyForPublish
            ? "submit-approved-bundle-manifest"
            : previewDecision.readyForDegradedHandoff
              ? "acknowledge-digest-proof-followup"
              : nextSteps.primary?.action || command.command
    },
    recovery: {
      ticketId: recoveryTicket.ticketId,
      state: recoveryTicket.state,
      route: recoveryTicket.route,
      dispatchCommand: recoveryTicket.dispatchCommand,
      retryAt: recoveryTicket.retryWindow.retryAt,
      degradedHandoffAllowed: recoveryTicket.degradedHandoffAllowed,
      proofFollowupArtifactIds: recoveryTicket.proofFollowupArtifactIds,
      userVisibleMessage: recoveryTicket.userVisibleMessage
    },
    previewDecision: {
      state: previewDecision.state,
      action: previewDecision.action,
      decisionToken: previewDecision.decisionToken,
      readyForPublish: previewDecision.readyForPublish,
      readyForDegradedHandoff: previewDecision.readyForDegradedHandoff,
      blockedReasons: previewDecision.blockedReasons,
      userVisibleMessage: previewDecision.userVisibleMessage
    },
    primaryAction: nextSteps.primary?.action || command.command,
    primaryActionBlocked: nextSteps.primary?.blocksAcceptance === true,
    nextActionCommandId: commandReplay.durableCommandId,
    idempotencyKey: command.idempotencyKey,
    commandReplay: {
      disposition: commandReplay.disposition,
      duplicateSuppressed: commandReplay.duplicateSuppressed,
      resumesPriorCommand: commandReplay.resumesPriorCommand,
      restartSafeStatus: commandReplay.restartSafeStatus
    },
    acknowledgement: {
      required: acknowledgementRequired,
      expectedBy: preferredChannel === "external" ? providerContract.externalHandoff.target : clientState.clientId,
      token: acknowledgementRequired ? `${commandReplay.durableCommandId}:ack` : null,
      syncCursor: providerContract.sync.cursor
    },
    callbackEvent: {
      eventName: callbackEvent,
      subscribed: workflow.notifyOn.includes(callbackEvent),
      route: workflow.callbackRoute,
      payload: {
        bundleId,
        requestId: clientState.requestId,
        correlationId: clientState.correlationId,
        state: workflowState,
        acceptanceState: acceptance.state,
        healthStatus: operationalHealth.status,
        recoveryTicketId: recoveryTicket.ticketId,
        recoveryTicketState: recoveryTicket.state,
        commandId: commandReplay.durableCommandId,
        deliveryState,
        responseFormat
      }
    },
    artifactSelection: {
      total: preview.artifactCount,
      publishableArtifactIds,
      blockedArtifactIds: validationSummary.blockingArtifactIds,
      digestFollowupArtifactIds: validationSummary.digestProofGapArtifactIds
    },
    providerHandoff: {
      providerId: providerContract.providerId,
      selectedMode: providerContract.capabilityProfile.selectedMode,
      negotiationProofId: providerContract.capabilityNegotiation.proofId,
      externalHandoffId: providerContract.externalHandoff.id,
      externalHandoffState: providerContract.externalHandoff.state,
      durableExternalHandoff: providerContract.externalHandoff.durable,
      selectedTransport: preferredChannel === "external" ? "provider-external-handoff" : "kernel-response-envelope",
      leaseExpiresAt: providerContract.externalHandoff.lease.expiresAt,
      resumeToken: providerContract.externalHandoff.resumeToken,
      syncWatermark: providerContract.sync.watermark
    },
    manifestReference: {
      uri: manifestIntegrity.manifestReference.uri,
      manifestPath: manifestIntegrity.manifestReference.manifestPath,
      proofPath: manifestIntegrity.manifestReference.proofPath,
      indexPath: manifestIntegrity.manifestReference.indexPath,
      digest: manifestIntegrity.manifestReference.digest
    },
    tenantBoundary: {
      isolationMode: tenantIsolation.isolationMode,
      clear: tenantIsolation.clear,
      crossTenantArtifactIds: tenantIsolation.crossTenantArtifactIds,
      crossWorkspaceArtifactIds: tenantIsolation.crossWorkspaceArtifactIds,
      auditHandoffRequired: tenantIsolation.auditHandoff.required,
      auditHandoffReady: tenantIsolation.auditHandoff.ready,
      auditHandoffToken: tenantIsolation.auditHandoff.required ? tenantIsolation.auditHandoff.token : null
    }
  };
}

function normalizeAnalyticsHistory(input = []) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((entry) => entry && typeof entry === "object")
    .slice(-12)
    .map((entry, index) => ({
      schema: `${BUNDLE_MANIFEST_SCHEMA}.analyticsSnapshot`,
      snapshotId: normalizeIdentifier(entry.snapshotId || entry.id, `history-${index + 1}`),
      observedAt: asIsoTimestamp(entry.observedAt || entry.generatedAt || entry.timestamp),
      revision: normalizeAttempt(entry.revision),
      artifactCount: normalizeAttempt(entry.artifactCount),
      persistedArtifactCount: normalizeAttempt(entry.persistedArtifactCount),
      publishedArtifactCount: normalizeAttempt(entry.publishedArtifactCount),
      pendingArtifactCount: normalizeAttempt(entry.pendingArtifactCount),
      blockingIssueCount: normalizeAttempt(entry.blockingIssueCount),
      warningIssueCount: normalizeAttempt(entry.warningIssueCount),
      digestCoverageRatio: typeof entry.digestCoverageRatio === "number" && Number.isFinite(entry.digestCoverageRatio)
        ? Math.max(0, Math.min(1, entry.digestCoverageRatio))
        : 0,
      healthStatus: normalizeIdentifier(entry.healthStatus, "unknown"),
      handoffReady: entry.handoffReady === true
    }));
}

function buildAnalyticsState({
  bundleId,
  generatedAt,
  requestState,
  clientState,
  artifacts,
  validation,
  proof,
  persistedState,
  restartStatus,
  command,
  commandReplay,
  operationalHealth,
  boundaryEvaluation,
  tenantIsolation,
  lifecycleSettings,
  providerContract,
  clientWorkflow,
  manifestIntegrity,
  packetManifest,
  packetRecoveryCheckpoint,
  evidence,
  analyticsHistory
}) {
  const blockingIssueCount = validation.filter((issue) => issue.severity === "error").length;
  const warningIssueCount = validation.filter((issue) => issue.severity !== "error").length;
  const persistedArtifactCount = artifacts.filter((artifact) => artifact.persistedState.persistedPath).length;
  const proofGapCount = artifacts.filter((artifact) => artifact.proofRequired).length;
  const replayArtifactCount = command.artifactIds.length;
  const digestCoverageRatio = artifacts.length > 0 ? proof.digestCoverage / artifacts.length : 0;
  const currentSnapshot = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.analyticsSnapshot`,
    snapshotId: `${bundleId}:r${persistedState.revision}`,
    observedAt: generatedAt,
    revision: persistedState.revision,
    artifactCount: artifacts.length,
    persistedArtifactCount,
    publishedArtifactCount: restartStatus.publishedArtifactCount,
    pendingArtifactCount: restartStatus.pendingArtifactCount,
    blockingIssueCount,
    warningIssueCount,
      digestCoverageRatio,
      healthStatus: operationalHealth.status,
      handoffReady: proof.handoffReady && packetManifest.complete && operationalHealth.status !== "failed" && command.safeToReplay
  };
  const priorSnapshots = normalizeAnalyticsHistory(analyticsHistory);
  const snapshots = [...priorSnapshots, currentSnapshot].slice(-13);
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const trend = previous
    ? {
        artifactDelta: currentSnapshot.artifactCount - previous.artifactCount,
        pendingDelta: currentSnapshot.pendingArtifactCount - previous.pendingArtifactCount,
        blockingIssueDelta: currentSnapshot.blockingIssueCount - previous.blockingIssueCount,
        digestCoverageDelta: Number((currentSnapshot.digestCoverageRatio - previous.digestCoverageRatio).toFixed(4)),
        healthChanged: currentSnapshot.healthStatus !== previous.healthStatus,
        handoffReadinessChanged: currentSnapshot.handoffReady !== previous.handoffReady
      }
    : {
        artifactDelta: currentSnapshot.artifactCount,
        pendingDelta: currentSnapshot.pendingArtifactCount,
        blockingIssueDelta: currentSnapshot.blockingIssueCount,
        digestCoverageDelta: Number(currentSnapshot.digestCoverageRatio.toFixed(4)),
        healthChanged: false,
        handoffReadinessChanged: false
      };

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.analytics`,
    counters: {
      artifactCount: artifacts.length,
      persistedArtifactCount,
      publishedArtifactCount: restartStatus.publishedArtifactCount,
      recoveredArtifactCount: restartStatus.recoveredArtifactCount,
      pendingArtifactCount: restartStatus.pendingArtifactCount,
      replayArtifactCount,
      proofGapCount,
      commandJournalEntryCount: persistedState.commandJournalSummary.entryCount,
      inFlightCommandCount: persistedState.commandJournalSummary.inFlightCommandIds.length,
      digestCoverageCount: proof.digestCoverage,
      blockingIssueCount,
      warningIssueCount,
      boundaryIssueCount: boundaryEvaluation.issueCount,
      boundaryBlockingIssueCount: boundaryEvaluation.blockingIssueCount,
      tenantIsolationIssueCount: tenantIsolation.issueCount,
      tenantIsolationBlockingIssueCount: tenantIsolation.blockingIssueCount,
      crossTenantArtifactCount: tenantIsolation.crossTenantArtifactIds.length,
      crossWorkspaceArtifactCount: tenantIsolation.crossWorkspaceArtifactIds.length,
      lifecycleIssueCount: lifecycleSettings.issues.length,
      providerIssueCount: providerContract.issues.length,
      providerMissingCapabilityCount: providerContract.missingCapabilities.length,
      integrityProofGapCount: manifestIntegrity.proofGapCount,
      packetManifestCompleteCount: packetManifest.complete ? 1 : 0,
      packetManifestUnresolvedCount: packetManifest.unresolvedPackets.length,
      packetManifestIssueCount: packetManifest.packetIssues.length,
      packetManifestClaimCount: packetManifest.packetClaims.length,
      packetManifestReplaySafeClaimCount: packetManifest.packetClaims.filter((claim) => claim.replaySafe).length,
      packetManifestRequiredPathCount: packetManifest.packetSet.requiredPaths.length,
      packetBoundaryAttestationClearCount: packetManifest.packetBoundaryAttestation.state === "clear" ? 1 : 0,
      packetBoundaryBlockedCount: packetManifest.packetBoundaryAttestation.blockedPacketKinds.length,
      packetRecoveryReusableCount: packetRecoveryCheckpoint.reusablePacketKinds.length,
      packetRecoveryRewriteCount: packetRecoveryCheckpoint.rewritePacketKinds.length,
      packetRecoveryBlockedCount: packetRecoveryCheckpoint.blockedPacketKinds.length,
      packetRecoveryRestartSafeCount: packetRecoveryCheckpoint.restartSafe ? 1 : 0,
      evidenceCount: evidence.length,
      restartCount: persistedState.restartCount,
      replayWatchdogStaleCount: operationalHealth.replayWatchdog.stale ? 1 : 0,
      replayWatchdogExhaustedCount: operationalHealth.replayWatchdog.exhausted ? 1 : 0,
      recoveryTicketIssuedCount: operationalHealth.recoveryTicket.state === "clear" ? 0 : 1,
      recoveryBlockedFailureCount: operationalHealth.recoveryTicket.blockedBy.length,
      recoveryProofFollowupArtifactCount: operationalHealth.recoveryTicket.proofFollowupArtifactIds.length
    },
    ratios: {
      digestCoverage: Number(digestCoverageRatio.toFixed(4)),
      persistedCoverage: artifacts.length > 0 ? Number((persistedArtifactCount / artifacts.length).toFixed(4)) : 0,
      publishedCoverage: artifacts.length > 0 ? Number((restartStatus.publishedArtifactCount / artifacts.length).toFixed(4)) : 0
    },
    timeline: {
      firstObservedAt: snapshots[0]?.observedAt || generatedAt,
      latestObservedAt: generatedAt,
      snapshotCount: snapshots.length,
      currentSnapshot,
      trend,
      snapshots
    },
    exportSummary: {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.analyticsExportSummary`,
      exportId: `${commandReplay.durableCommandId}:analytics`,
      generatedAt,
      route: requestState.route,
      tenantId: requestState.tenantId,
      requestId: clientState.requestId,
      bundleId,
      revision: persistedState.revision,
      healthStatus: operationalHealth.status,
      restartStatus: restartStatus.status,
      nextAction: command.command,
      commandReplayDisposition: commandReplay.disposition,
      durableCommandId: commandReplay.durableCommandId,
      duplicateCommandSuppressed: commandReplay.duplicateSuppressed,
      resumesPriorCommand: commandReplay.resumesPriorCommand,
      replayWatchdogState: operationalHealth.replayWatchdog.state,
      replayWatchdogStale: operationalHealth.replayWatchdog.stale,
      replayWatchdogExhausted: operationalHealth.replayWatchdog.exhausted,
      replayWatchdogNextRetryAt: operationalHealth.replayWatchdog.nextRetryAt,
      replayWatchdogAgeMs: operationalHealth.replayWatchdog.ageMs,
      recoveryTicketId: operationalHealth.recoveryTicket.ticketId,
      recoveryTicketState: operationalHealth.recoveryTicket.state,
      recoveryTicketRoute: operationalHealth.recoveryTicket.route,
      recoveryTicketDispatchCommand: operationalHealth.recoveryTicket.dispatchCommand,
      recoveryTicketRetryAt: operationalHealth.recoveryTicket.retryWindow.retryAt,
      recoveryTicketEscalationRequired: operationalHealth.recoveryTicket.state === "escalation-required",
      recoveryTicketDigest: operationalHealth.recoveryTicket.subjectDigest,
      packetRecoveryCheckpointId: packetRecoveryCheckpoint.checkpointId,
      packetRecoveryCheckpointState: packetRecoveryCheckpoint.state,
      packetRecoveryCheckpointDigest: packetRecoveryCheckpoint.checkpointDigest,
      packetRecoveryRestartSafe: packetRecoveryCheckpoint.restartSafe,
      packetRecoveryNextCommand: packetRecoveryCheckpoint.nextRestartCommand,
      packetRecoveryReusablePacketKinds: packetRecoveryCheckpoint.reusablePacketKinds,
      packetRecoveryRewritePacketKinds: packetRecoveryCheckpoint.rewritePacketKinds,
      packetRecoveryBlockedPacketKinds: packetRecoveryCheckpoint.blockedPacketKinds,
      safeToReplay: command.safeToReplay,
      lifecycleEnabled: lifecycleSettings.enabled,
      lifecycleCommandId: lifecycleSettings.commandId,
      lifecycleScheduleMode: lifecycleSettings.scheduleMode,
      lifecycleEffectiveState: lifecycleSettings.effectiveState,
      lifecycleNextAction: lifecycleSettings.nextLifecycleAction,
      lifecycleActivationAt: lifecycleSettings.activationAt,
      lifecycleCommandAccepted: lifecycleSettings.commandState.accepted,
      lifecycleControlEnabled: lifecycleSettings.commandState.controlEnabled,
      lifecycleResumeToken: lifecycleSettings.commandState.resumeToken,
      lifecycleScheduleWithinPolicy: lifecycleSettings.commandState.scheduleWithinPolicy,
      lifecycleDisableWithinPolicy: lifecycleSettings.commandState.disableWithinPolicy,
      lifecycleScheduleLeadTimeMs: lifecycleSettings.commandState.scheduleLeadTimeMs,
      lifecycleDisableDurationMs: lifecycleSettings.commandState.disableDurationMs,
      providerId: providerContract.providerId,
      providerReady: providerContract.negotiationComplete,
      providerSelectedMode: providerContract.capabilityProfile.selectedMode,
      providerNegotiationProofId: providerContract.capabilityNegotiation.proofId,
      providerAcceptedCapabilities: providerContract.capabilityNegotiation.accepted,
      providerDeclinedCapabilities: providerContract.capabilityNegotiation.declined,
      providerUnsupportedCapabilities: providerContract.capabilityNegotiation.unsupported,
      providerSyncMode: providerContract.sync.mode,
      providerSyncCursor: providerContract.sync.cursor,
      providerSyncWatermark: providerContract.sync.watermark,
      externalHandoffId: providerContract.externalHandoff.id,
      externalHandoffState: providerContract.externalHandoff.state,
      externalHandoffLeaseExpiresAt: providerContract.externalHandoff.lease.expiresAt,
      externalHandoffResumeToken: providerContract.externalHandoff.resumeToken,
      manifestDigest: manifestIntegrity.manifestDigest,
      integrityProofId: manifestIntegrity.auditProof.proofId,
      integrityComplete: manifestIntegrity.complete,
      integrityProofGapCount: manifestIntegrity.proofGapCount,
      packetManifestIndexDigest: packetManifest.indexDigest,
      packetManifestIndexPath: packetManifest.indexPath,
      packetManifestPacketSetDigest: packetManifest.packetSetDigest,
      packetManifestPacketSetDirectory: packetManifest.packetSetDirectory,
      packetManifestContentAddressedIndexPath: packetManifest.contentAddressedIndexPath,
      packetManifestProofEnvelopePath: packetManifest.proofEnvelopePath,
      packetManifestReplayLedgerPath: packetManifest.replayLedgerPath,
      packetManifestProofId: packetManifest.proofEnvelope.proofId,
      packetManifestComplete: packetManifest.complete,
      packetManifestUnresolvedPackets: packetManifest.unresolvedPackets,
      packetManifestReplaySafe: packetManifest.proofEnvelope.replaySafe,
      packetManifestClaimIds: packetManifest.packetClaims.map((claim) => claim.claimId),
      packetManifestClaimPaths: Object.fromEntries(packetManifest.packetClaims.map((claim) => [claim.packetKind, claim.claimPath])),
      packetManifestRequiredPaths: packetManifest.packetSet.requiredPaths,
      packetBoundaryAttestationState: packetManifest.packetBoundaryAttestation.state,
      packetBoundaryAttestationDigest: packetManifest.packetBoundaryAttestation.attestationDigest,
      packetBoundaryBlockedPacketKinds: packetManifest.packetBoundaryAttestation.blockedPacketKinds,
      clientWorkflowState: clientWorkflow.state,
      clientWorkflowChannel: clientWorkflow.channel,
      clientCorrelationId: clientState.correlationId,
      clientResponseFormat: clientWorkflow.responseFormat,
      clientDeliveryState: clientWorkflow.delivery.state,
      clientDeliveryEnvelopeId: clientWorkflow.delivery.envelopeId,
      clientDeliveryDigest: clientWorkflow.delivery.subjectDigest,
      clientDeliveryDeadlineAt: clientWorkflow.delivery.deadlineAt,
      clientDeliveryExpired: clientWorkflow.delivery.expired,
      clientDeliveryNextAction: clientWorkflow.delivery.nextClientAction,
      clientCallbackRoute: clientWorkflow.callbackRoute,
      clientAcknowledgementRequired: clientWorkflow.acknowledgement.required,
      clientCallbackSubscribed: clientWorkflow.callbackEvent.subscribed,
      tenantIsolationMode: tenantIsolation.isolationMode,
      tenantIsolationClear: tenantIsolation.clear,
      tenantAuditHandoffRequired: tenantIsolation.auditHandoff.required,
      tenantAuditHandoffReady: tenantIsolation.auditHandoff.ready,
      tenantAuditHandoffToken: tenantIsolation.auditHandoff.required ? tenantIsolation.auditHandoff.token : null,
      handoffReady: currentSnapshot.handoffReady,
      digestCoveragePercent: Number((digestCoverageRatio * 100).toFixed(2)),
      issueTotal: blockingIssueCount + warningIssueCount,
      evidenceCount: evidence.length
    }
  };
}

function buildAnalyticsReportState({
  bundleId,
  generatedAt,
  requestState,
  clientState,
  analytics,
  validationSummary,
  acceptance,
  nextSteps,
  command,
  commandReplay,
  operationalHealth,
  lifecycleSettings,
  providerContract,
  manifestIntegrity,
  tenantIsolation,
  packetManifest,
  packetClientReadiness,
  packetWorkflowHandoff,
  packetRecoveryCheckpoint
}) {
  const counterRows = Object.entries(analytics.counters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([metric, value]) => ({
      schema: `${BUNDLE_MANIFEST_SCHEMA}.analyticsCounterExportRow`,
      metric,
      value,
      exportKey: `${requestState.route}.${bundleId}.${metric}`,
      observedAt: generatedAt
    }));
  const failureClassRows = Object.entries(validationSummary.byFailureClass)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([failureClass, count]) => ({
      schema: `${BUNDLE_MANIFEST_SCHEMA}.analyticsIssueExportRow`,
      failureClass,
      count,
      blocking: validationSummary.firstBlockingIssue
        ? (FAILURE_CLASS_BY_ISSUE_CODE[validationSummary.firstBlockingIssue.code] || "validation") === failureClass
        : false
    }));
  const severityRows = Object.entries(validationSummary.bySeverity)
    .map(([severity, count]) => ({
      schema: `${BUNDLE_MANIFEST_SCHEMA}.analyticsSeverityExportRow`,
      severity,
      count,
      blocksPublish: severity === "error" && count > 0
    }));
  const handoffStepByKind = Object.fromEntries(packetWorkflowHandoff.steps.map((step) => [step.packetKind, step]));
  const recoveryRowByKind = Object.fromEntries(packetRecoveryCheckpoint.rows.map((row) => [row.packetKind, row]));
  const packetRows = packetClientReadiness.rows.map((row) => {
    const claim = packetManifest.packetClaimsByKind[row.packetKind] || null;
    const handoffStep = handoffStepByKind[row.packetKind] || null;
    const recoveryRow = recoveryRowByKind[row.packetKind] || null;
    const terminal = row.readinessState === "ready"
      && row.replaySafe
      && ["deliverable", "awaiting-acknowledgement"].includes(handoffStep?.deliveryState);
    const exportState = row.validationState === "blocked" || row.readinessState === "subject-incomplete"
      ? "blocked"
      : handoffStep?.deliveryState === "retry-scheduled" || row.validationState === "retry-scheduled"
        ? "retrying"
        : handoffStep?.deliveryState === "degraded-handoff" || row.validationState === "degraded"
          ? "degraded"
          : terminal
            ? "terminal-ready"
            : row.readinessState;

    return {
      schema: `${BUNDLE_MANIFEST_SCHEMA}.analyticsPacketExportRow`,
      packetKind: row.packetKind,
      stage: row.stage,
      exportKey: `${requestState.route}.${bundleId}.packet.${row.packetKind}`,
      observedAt: generatedAt,
      exportState,
      readinessState: row.readinessState,
      validationState: row.validationState,
      deliveryState: handoffStep?.deliveryState || "unknown",
      checkpointState: recoveryRow?.nextState || "missing",
      restartAction: recoveryRow?.restartAction || "unknown",
      acceptedByGate: row.acceptedByGate,
      replaySafe: row.replaySafe,
      subjectComplete: row.subjectComplete,
      subjectDigest: row.subjectDigest,
      proofId: row.proofId,
      claimId: claim?.claimId || null,
      claimDigest: claim?.claimDigest || null,
      packetUri: row.packetUri,
      packetPath: row.packetPath,
      proofPath: row.proofPath,
      claimPath: claim?.claimPath || null,
      retryAt: row.packetRetryAt || handoffStep?.retryAt || null,
      failureCode: row.packetFailureCode,
      failureClass: row.packetFailureClass,
      nextAction: handoffStep?.nextAction || row.nextAction,
      resumeCursor: handoffStep?.resumeCursor || recoveryRow?.resumeCursor || null,
      terminal
    };
  });
  const packetCounterRows = [
    ["packetReadyCount", packetRows.filter((row) => row.exportState === "terminal-ready").length],
    ["packetBlockedCount", packetRows.filter((row) => row.exportState === "blocked").length],
    ["packetRetryingCount", packetRows.filter((row) => row.exportState === "retrying").length],
    ["packetDegradedCount", packetRows.filter((row) => row.exportState === "degraded").length],
    ["packetReplaySafeCount", packetRows.filter((row) => row.replaySafe).length],
    ["packetClaimedCount", packetRows.filter((row) => row.claimId).length]
  ].map(([metric, value]) => ({
    schema: `${BUNDLE_MANIFEST_SCHEMA}.analyticsCounterExportRow`,
    metric,
    value,
    exportKey: `${requestState.route}.${bundleId}.${metric}`,
    observedAt: generatedAt
  }));
  const currentSnapshot = analytics.timeline.currentSnapshot;
  const packetTimelineEvents = packetRows
    .filter((row) => row.exportState !== "waiting")
    .map((row) => ({
      eventId: `${bundleId}:packet:${row.packetKind}:${row.subjectDigest.slice(7, 23)}`,
      eventType: "content-addressed-packet",
      occurredAt: row.retryAt || generatedAt,
      state: row.exportState,
      detail: row.exportState === "terminal-ready"
        ? `${row.packetKind} packet is replay-safe and ready for ${row.deliveryState}.`
        : row.exportState === "blocked"
          ? `${row.packetKind} packet is blocked by ${row.failureCode || row.validationState}.`
          : row.exportState === "retrying"
            ? `${row.packetKind} packet retry is scheduled.`
            : `${row.packetKind} packet is in ${row.exportState} state.`,
      packetKind: row.packetKind,
      proofId: row.proofId,
      claimId: row.claimId,
      resumeCursor: row.resumeCursor
    }));
  const timelineEvents = [
    {
      eventId: `${bundleId}:snapshot:${currentSnapshot.revision}`,
      eventType: "analytics-snapshot",
      occurredAt: currentSnapshot.observedAt,
      state: currentSnapshot.healthStatus,
      detail: `${currentSnapshot.artifactCount} artifacts, ${currentSnapshot.pendingArtifactCount} pending replay.`
    },
    lifecycleSettings.activationAt
      ? {
          eventId: `${bundleId}:lifecycle:${lifecycleSettings.requestedCommand}`,
          eventType: "lifecycle-gate",
          occurredAt: lifecycleSettings.activationAt,
          state: lifecycleSettings.publishAllowedNow ? "open" : "scheduled",
          detail: `Lifecycle ${lifecycleSettings.requestedCommand} is ${lifecycleSettings.scheduleMode}.`
        }
      : null,
    operationalHealth.retryPlan.retryAt
      ? {
          eventId: `${commandReplay.durableCommandId}:retry`,
          eventType: "retry-window",
          occurredAt: operationalHealth.retryPlan.retryAt,
          state: operationalHealth.retryPlan.exhausted ? "exhausted" : "retryable",
          detail: `Retry attempt ${operationalHealth.retryPlan.attempt} of ${operationalHealth.retryPlan.maxAttempts}.`
        }
      : null,
    operationalHealth.recoveryTicket.state !== "clear"
      ? {
          eventId: operationalHealth.recoveryTicket.ticketId,
          eventType: "recovery-ticket",
          occurredAt: generatedAt,
          state: operationalHealth.recoveryTicket.state,
          detail: operationalHealth.recoveryTicket.userVisibleMessage
        }
      : null,
    acceptance.acceptanceToken
      ? {
          eventId: acceptance.acceptanceToken,
          eventType: "acceptance",
          occurredAt: generatedAt,
          state: acceptance.state,
          detail: acceptance.readyForPublish ? "Ready for publish." : "Accepted with follow-up requirements."
        }
      : null,
    providerContract.externalHandoff.state === "ready"
      ? {
          eventId: providerContract.externalHandoff.id,
          eventType: "provider-handoff",
          occurredAt: providerContract.sync.observedAt,
          state: providerContract.externalHandoff.state,
          detail: `Provider ${providerContract.providerId} selected ${providerContract.sync.mode} sync.`
        }
      : null
  ].filter(Boolean).concat(packetTimelineEvents);
  const reportDigest = sha256Digest({
    bundleId,
    generatedAt,
    counters: analytics.counters,
    validation: validationSummary.counts,
    commandId: commandReplay.durableCommandId,
    manifestDigest: manifestIntegrity.manifestDigest,
    packetRows: packetRows.map((row) => ({
      packetKind: row.packetKind,
      exportState: row.exportState,
      deliveryState: row.deliveryState,
      checkpointState: row.checkpointState,
      subjectDigest: row.subjectDigest,
      claimDigest: row.claimDigest
    }))
  });
  const packetExportSummary = {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.analyticsPacketExportSummary`,
    packetSetDigest: packetManifest.packetSetDigest,
    packetSetDirectory: packetManifest.packetSetDirectory,
    proofEnvelopeId: packetManifest.proofEnvelope.proofId,
    workflowDigest: packetWorkflowHandoff.planDigest,
    checkpointDigest: packetRecoveryCheckpoint.checkpointDigest,
    requiredPacketKinds: packetManifest.requiredPacketKinds,
    blockedPacketKinds: packetRows.filter((row) => row.exportState === "blocked").map((row) => row.packetKind),
    retryPacketKinds: packetRows.filter((row) => row.exportState === "retrying").map((row) => row.packetKind),
    degradedPacketKinds: packetRows.filter((row) => row.exportState === "degraded").map((row) => row.packetKind),
    terminalPacketKinds: packetRows.filter((row) => row.terminal).map((row) => row.packetKind),
    unresolvedPacketKinds: packetManifest.unresolvedPackets,
    currentPacketKind: packetWorkflowHandoff.currentStep?.packetKind || null,
    currentPacketState: packetWorkflowHandoff.currentStep?.deliveryState || null,
    nextPacketAction: packetWorkflowHandoff.nextClientAction,
    replayLedgerPath: packetManifest.replayLedgerPath,
    packetIndexPath: packetManifest.contentAddressedIndexPath,
    proofEnvelopePath: packetManifest.proofEnvelopePath
  };

  return {
    schema: `${BUNDLE_MANIFEST_SCHEMA}.analyticsReport`,
    reportId: `${bundleId}:analytics-report:${reportDigest.slice(7, 23)}`,
    generatedAt,
    exportFormat: "application/vnd.aios.bundle-manifest.analytics+json",
    route: requestState.route,
    tenantId: requestState.tenantId,
    clientId: clientState.clientId,
    requestId: clientState.requestId,
    bundleId,
    manifestDigest: manifestIntegrity.manifestDigest,
    reportDigest,
    headline: {
      healthStatus: operationalHealth.status,
      acceptanceState: acceptance.state,
      readyForPublish: acceptance.readyForPublish,
      nextAction: nextSteps.primary?.action || command.command,
      durableCommandId: commandReplay.durableCommandId,
      tenantIsolationClear: tenantIsolation.clear,
      providerReady: providerContract.negotiationComplete
    },
    exportTables: {
      counters: [...counterRows, ...packetCounterRows],
      severity: severityRows,
      failureClasses: failureClassRows,
      packets: packetRows
    },
    packetExportSummary,
    timelineEvents,
    historyWindow: analytics.timeline.snapshots.map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      observedAt: snapshot.observedAt,
      revision: snapshot.revision,
      healthStatus: snapshot.healthStatus,
      handoffReady: snapshot.handoffReady,
      artifactCount: snapshot.artifactCount,
      pendingArtifactCount: snapshot.pendingArtifactCount,
      blockingIssueCount: snapshot.blockingIssueCount,
      digestCoverageRatio: snapshot.digestCoverageRatio
    })),
    subscriptions: {
      exportRoute: `${requestState.route}.analytics.export`,
      reportRoute: `${requestState.route}.analytics.report`,
      callbackRoute: `${requestState.route}.analytics.timeline`,
      cursor: providerContract.sync.cursor
    }
  };
}

export function describeBundleManifestSurface(input = {}) {
  const generatedAt = asIsoTimestamp(input.now);
  const requestState = normalizeRequestState(input.request || input.requestState);
  const clientState = normalizeClientState(input.client || input.clientState);
  const bundleId = normalizeIdentifier(input.bundleId, `${requestState.tenantId}:${clientState.requestId}`);
  const workspaceScope = normalizeWorkspaceScope(input.workspaceScope || input.workspace || input.scope, requestState);
  const actorAccess = normalizeActorAccess(input.actorAccess || input.access || input.actor, {
    requestedBy: requestState.requestedBy,
    clientCapabilities: clientState.capabilities,
    workspaceScope
  });
  const normalized = Array.isArray(input.artifacts)
    ? input.artifacts.map((entry, index) => normalizeArtifactEntry(entry, index))
    : [];
  const persistedState = normalizePersistedBundleState(input.persistedState || input.state, { bundleId, generatedAt });
  const healthPolicy = normalizeHealthPolicy(input.healthPolicy || input.retryPolicy || input.operationalPolicy);
  const lifecycleSettings = normalizeLifecycleSettings(input.lifecycleSettings || input.lifecycle || input.settings, { generatedAt });
  const providerContract = normalizeProviderContract(input.providerContract || input.provider || input.serviceContract, {
    generatedAt,
    requestState,
    clientState
  });
  const artifacts = shapeRecoverableArtifacts({
    artifacts: normalized.map((entry) => entry.artifact),
    persistedState,
    generatedAt
  });
  const boundaryEvaluation = buildBoundaryEvaluation({
    bundleId,
    artifacts,
    requestState,
    workspaceScope,
    actorAccess
  });
  const tenantIsolation = buildTenantIsolationEvaluation({
    bundleId,
    artifacts,
    generatedAt,
    requestState,
    workspaceScope,
    actorAccess,
    providerContract
  });
  const validation = [
    ...normalized.flatMap((entry) => entry.issues),
    ...boundaryEvaluation.issues,
    ...tenantIsolation.issues,
    ...lifecycleSettings.issues,
    ...providerContract.issues
  ];
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const manifestIntegrity = buildManifestIntegrity({
    bundleId,
    artifacts,
    generatedAt,
    requestState,
    workspaceScope,
    providerContract
  });
  const proof = buildBundleProof({
    artifacts,
    generatedAt,
    requestState,
    clientState,
    workspaceScope,
    actorAccess,
    boundaryEvaluation,
    tenantIsolation,
    providerContract,
    manifestIntegrity
  });
  const blockingIssues = validation.filter((issue) => issue.severity === "error");
  const restartStatus = buildRestartStatus({ artifacts, validation, persistedState });
  const command = buildIdempotentCommand({
    bundleId,
    generatedAt,
    requestState,
    clientState,
    artifacts,
    restartStatus,
    workspaceScope,
    boundaryEvaluation,
    tenantIsolation,
    lifecycleSettings,
    providerContract
  });
  const commandReplay = buildCommandReplayState({
    command,
    persistedState,
    restartStatus,
    artifacts,
    generatedAt
  });
  const operationalHealth = buildOperationalHealth({
    bundleId,
    artifacts,
    validation,
    proof,
    restartStatus,
    command,
    commandReplay,
    healthPolicy,
    generatedAt
  });
  const validationSummary = buildValidationSummary({
    artifacts,
    validation,
    boundaryEvaluation,
    tenantIsolation,
    lifecycleSettings,
    providerContract
  });
  const preview = buildPreviewContract({
    bundleId,
    artifacts,
    validation,
    workspaceScope,
    restartStatus,
    operationalHealth
  });
  const acceptance = buildAcceptanceContract({
    proof,
    restartStatus,
    command,
    commandReplay,
    lifecycleSettings,
    providerContract,
    tenantIsolation,
    validationSummary,
    operationalHealth
  });
  const nextSteps = buildExplainableNextSteps({
    validationSummary,
    acceptance,
    lifecycleSettings,
    providerContract,
    command,
    operationalHealth
  });
  const previewDecision = buildPreviewDecisionContract({
    bundleId,
    generatedAt,
    requestState,
    clientState,
    preview,
    acceptance,
    validationSummary,
    nextSteps,
    command,
    commandReplay,
    manifestIntegrity,
    requestedDecision: input.previewDecision || input.acceptanceDecision || input.decision
  });
  const mailchimpManifestReadiness = buildMailchimpManifestReadiness({
    bundleId,
    generatedAt,
    requestState,
    clientState,
    preview,
    acceptance,
    previewDecision,
    validationSummary,
    nextSteps,
    command,
    commandReplay,
    manifestIntegrity,
    providerContract,
    lifecycleSettings,
    operationalHealth,
    persistedState,
    input
  });
  const clientWorkflow = buildClientWorkflowHandoff({
    bundleId,
    generatedAt,
    requestState,
    clientState,
    preview,
    acceptance,
    previewDecision,
    validationSummary,
    nextSteps,
    command,
    commandReplay,
    manifestIntegrity,
    providerContract,
    tenantIsolation,
    operationalHealth
  });
  const packetManifest = buildContentAddressedPacketManifest({
    bundleId,
    generatedAt,
    requestState,
    clientState,
    workspaceScope,
    actorAccess,
    boundaryEvaluation,
    manifestIntegrity,
    persistedState,
    restartStatus,
    command,
    commandReplay,
    lifecycleSettings,
    providerContract,
    tenantIsolation,
    validationSummary,
    acceptance,
    previewDecision,
    clientWorkflow,
    operationalHealth
  });
  const packetClientReadiness = buildPacketClientReadinessContract({
    bundleId,
    generatedAt,
    packetManifest,
    acceptance,
    previewDecision,
    validationSummary,
    nextSteps,
    clientWorkflow,
    operationalHealth
  });
  const packetWorkflowHandoff = buildPacketWorkflowHandoffPlan({
    bundleId,
    generatedAt,
    packetClientReadiness,
    clientWorkflow,
    previewDecision,
    commandReplay,
    providerContract,
    operationalHealth
  });
  const packetProviderDispatch = buildPacketProviderDispatchContract({
    bundleId,
    generatedAt,
    providerContract,
    packetManifest,
    packetClientReadiness,
    packetWorkflowHandoff,
    manifestIntegrity,
    clientWorkflow,
    commandReplay,
    operationalHealth
  });
  const packetRecoveryCheckpoint = buildPacketRecoveryCheckpoint({
    bundleId,
    generatedAt,
    persistedState,
    packetManifest,
    packetWorkflowHandoff,
    commandReplay,
    operationalHealth
  });
  const analytics = buildAnalyticsState({
    bundleId,
    generatedAt,
    requestState,
    clientState,
    artifacts,
    validation,
    proof,
    persistedState,
    restartStatus,
    command,
    commandReplay,
    operationalHealth,
    boundaryEvaluation,
    tenantIsolation,
    lifecycleSettings,
    providerContract,
    clientWorkflow,
    manifestIntegrity,
    packetManifest,
    packetRecoveryCheckpoint,
    evidence,
    analyticsHistory: input.analyticsHistory || input.history || input.snapshots
  });
  const analyticsReport = buildAnalyticsReportState({
    bundleId,
    generatedAt,
    requestState,
    clientState,
    analytics,
    validationSummary,
    acceptance,
    nextSteps,
    command,
    commandReplay,
    operationalHealth,
    lifecycleSettings,
    providerContract,
    manifestIntegrity,
    tenantIsolation,
    packetManifest,
    packetClientReadiness,
    packetWorkflowHandoff,
    packetRecoveryCheckpoint
  });
  const nextAction = commandReplay.duplicateSuppressed
    ? "acknowledge-existing-bundle-publish"
    : commandReplay.resumesPriorCommand
      ? "resume-in-flight-bundle-publish"
      : commandReplay.retryingPriorFailure
        ? "retry-failed-bundle-publish"
    : blockingIssues.length > 0
    ? providerContract.issues.some((issue) => issue.severity === "error")
      ? "negotiate-provider-contract"
      : lifecycleSettings.issues.some((issue) => issue.severity === "error")
      ? "enable-or-reschedule-bundle-lifecycle"
      : tenantIsolation.issues.some((issue) => issue.severity === "error")
      ? "resolve-tenant-boundary-handoff"
      : "repair-bundle-artifact-inputs"
    : operationalHealth.status === "retrying"
      ? "retry-after-backoff"
      : lifecycleSettings.scheduledForFuture
        ? "wait-for-scheduled-lifecycle-window"
      : operationalHealth.status === "degraded"
        ? "handoff-in-degraded-mode"
        : proof.completeDigestCoverage
          ? command.command
          : "handoff-with-digest-followup";

  return {
    ok: blockingIssues.length === 0,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: BUNDLE_MANIFEST_SCHEMA,
    requestState,
    clientState,
    manifest: {
      schema: BUNDLE_MANIFEST_SCHEMA,
      bundleId,
      artifacts,
      validation,
      proof,
      manifestIntegrity,
      persistedState,
      restartStatus,
      command,
      commandReplay,
      healthPolicy,
      lifecycleSettings,
      operationalHealth,
      validationSummary,
      preview,
      acceptance,
      previewDecision,
      mailchimpManifestReadiness,
      clientWorkflow,
      packetManifest,
      packetClientReadiness,
      packetWorkflowHandoff,
      packetProviderDispatch,
      packetRecoveryCheckpoint,
      readiness: {
        schema: `${BUNDLE_MANIFEST_SCHEMA}.readiness`,
        state: acceptance.state,
        ready: acceptance.accepted,
        publishReady: acceptance.readyForPublish,
        degradedHandoffReady: acceptance.readyForDegradedHandoff,
        handoffReady: proof.handoffReady && packetManifest.complete && operationalHealth.status !== "failed" && command.safeToReplay,
        restartSafe: restartStatus.restartSafe,
        providerReady: proof.providerReady,
        providerSelectedMode: providerContract.capabilityProfile.selectedMode,
        providerNegotiationProofId: providerContract.capabilityNegotiation.proofId,
        providerSyncWatermark: providerContract.sync.watermark,
        externalHandoffLeaseExpiresAt: providerContract.externalHandoff.lease.expiresAt,
        boundaryClear: proof.boundaryClear,
        tenantIsolationClear: tenantIsolation.clear,
        tenantAuditHandoffReady: tenantIsolation.auditHandoff.ready,
        tenantAuditHandoffToken: tenantIsolation.auditHandoff.required ? tenantIsolation.auditHandoff.token : null,
        lifecycleOpen: lifecycleSettings.publishAllowedNow,
        lifecycleCommandId: lifecycleSettings.commandId,
        lifecycleEffectiveState: lifecycleSettings.effectiveState,
        lifecycleNextAction: lifecycleSettings.nextLifecycleAction,
        lifecycleCommandAccepted: lifecycleSettings.commandState.accepted,
        lifecycleResumeToken: lifecycleSettings.commandState.resumeToken,
        lifecycleScheduleWithinPolicy: lifecycleSettings.commandState.scheduleWithinPolicy,
        lifecycleDisableWithinPolicy: lifecycleSettings.commandState.disableWithinPolicy,
        lifecycleTransition: lifecycleSettings.transition,
        mailchimpManifestStatus: mailchimpManifestReadiness.status,
        mailchimpManifestReady: mailchimpManifestReadiness.ready,
        mailchimpManifestDegradedReady: mailchimpManifestReadiness.degradedReady,
        mailchimpManifestNextAction: mailchimpManifestReadiness.nextAction.action,
        mailchimpManifestPayloadDigest: mailchimpManifestReadiness.handoff.payloadDigest,
        mailchimpManifestBlockedReasons: mailchimpManifestReadiness.validationSummary.blockedReasons,
        digestProofComplete: proof.completeDigestCoverage,
        integrityComplete: manifestIntegrity.complete,
        manifestDigest: manifestIntegrity.manifestDigest,
        manifestReferenceUri: manifestIntegrity.manifestReference.uri,
        manifestReferencePath: manifestIntegrity.manifestReference.manifestPath,
        packetManifestIndexDigest: packetManifest.indexDigest,
        packetManifestIndexPath: packetManifest.indexPath,
        packetManifestPacketSetDigest: packetManifest.packetSetDigest,
        packetManifestPacketSetDirectory: packetManifest.packetSetDirectory,
        packetManifestContentAddressedIndexPath: packetManifest.contentAddressedIndexPath,
        packetManifestReplayLedgerPath: packetManifest.replayLedgerPath,
        packetManifestProofId: packetManifest.proofEnvelope.proofId,
        packetManifestReplaySafe: packetManifest.proofEnvelope.replaySafe,
        packetManifestComplete: packetManifest.complete,
        packetManifestUnresolvedPackets: packetManifest.unresolvedPackets,
        packetBoundaryAttestationState: packetManifest.packetBoundaryAttestation.state,
        packetBoundaryAttestationDigest: packetManifest.packetBoundaryAttestation.attestationDigest,
        packetBoundaryBlockedPacketKinds: packetManifest.packetBoundaryAttestation.blockedPacketKinds,
        packetManifestClaimIds: packetManifest.packetClaims.map((claim) => claim.claimId),
        packetManifestClaimPaths: Object.fromEntries(packetManifest.packetClaims.map((claim) => [claim.packetKind, claim.claimPath])),
        packetClientReadinessState: packetClientReadiness.state,
        packetClientReadinessDigest: packetClientReadiness.contractDigest,
        packetClientReadinessReady: packetClientReadiness.ready,
        packetClientReadinessPrimaryAction: packetClientReadiness.primaryPacketAction,
        packetClientReadinessCounts: packetClientReadiness.counts,
        packetWorkflowHandoffState: packetWorkflowHandoff.state,
        packetWorkflowHandoffDigest: packetWorkflowHandoff.planDigest,
        packetWorkflowHandoffReady: packetWorkflowHandoff.ready,
        packetWorkflowHandoffNextAction: packetWorkflowHandoff.nextClientAction,
        packetWorkflowHandoffCurrentPacket: packetWorkflowHandoff.currentStep?.packetKind || null,
        packetWorkflowHandoffCounts: packetWorkflowHandoff.counts,
        packetProviderDispatchState: packetProviderDispatch.state,
        packetProviderDispatchReady: packetProviderDispatch.ready,
        packetProviderDispatchDigest: packetProviderDispatch.contractDigest,
        packetProviderDispatchNextAction: packetProviderDispatch.nextProviderAction,
        packetProviderDispatchBlockedPackets: packetProviderDispatch.blockedPacketKinds,
        packetProviderDispatchExternalPackets: packetProviderDispatch.externalPacketKinds,
        packetProviderDispatchAckPackets: packetProviderDispatch.acknowledgementPacketKinds,
        packetProviderDispatchDigestFollowupPackets: packetProviderDispatch.digestFollowupPacketKinds,
        packetRecoveryCheckpointId: packetRecoveryCheckpoint.checkpointId,
        packetRecoveryCheckpointState: packetRecoveryCheckpoint.state,
        packetRecoveryCheckpointDigest: packetRecoveryCheckpoint.checkpointDigest,
        packetRecoveryCheckpointRestartSafe: packetRecoveryCheckpoint.restartSafe,
        packetRecoveryNextCommand: packetRecoveryCheckpoint.nextRestartCommand,
        packetRecoveryReusablePacketKinds: packetRecoveryCheckpoint.reusablePacketKinds,
        packetRecoveryRewritePacketKinds: packetRecoveryCheckpoint.rewritePacketKinds,
        packetRecoveryBlockedPacketKinds: packetRecoveryCheckpoint.blockedPacketKinds,
        bootPacketUri: packetManifest.bootPacketUri,
        runPacketUri: packetManifest.runPacketUri,
        claimPacketUri: packetManifest.claimPacketUri,
        releasePacketUri: packetManifest.releasePacketUri,
        recoveryPacketUri: packetManifest.recoveryPacketUri,
        integrityProofId: manifestIntegrity.auditProof.proofId,
        replayWatchdogState: operationalHealth.replayWatchdog.state,
        replayWatchdogStale: operationalHealth.replayWatchdog.stale,
        replayRetryAt: operationalHealth.replayWatchdog.nextRetryAt,
        recoveryTicketId: operationalHealth.recoveryTicket.ticketId,
        recoveryTicketState: operationalHealth.recoveryTicket.state,
        recoveryTicketRoute: operationalHealth.recoveryTicket.route,
        recoveryDispatchCommand: operationalHealth.recoveryTicket.dispatchCommand,
        recoverySafeToReplay: operationalHealth.recoveryTicket.safeToReplay,
        failedChecklistKeys: acceptance.failedChecklistKeys
      },
      nextSteps,
      analytics,
      analyticsReport,
      workspaceScope,
      actorAccess,
      boundaryEvaluation,
      tenantIsolation,
      providerContract
    },
    audit: {
      surfaceId,
      route: requestState.route,
      generatedAt,
      actor: requestState.requestedBy,
      actorRole: actorAccess.role,
      event: "bundle-manifest-described",
      tenantId: requestState.tenantId,
      workspaceId: workspaceScope.workspaceId,
      workspaceRootPrefix: workspaceScope.rootPrefix || "bundle-relative",
      validationErrorCount: blockingIssues.length,
      validationWarningCount: validation.length - blockingIssues.length,
      boundaryIssueCount: boundaryEvaluation.issueCount,
      boundaryBlockingIssueCount: boundaryEvaluation.blockingIssueCount,
      tenantIsolationMode: tenantIsolation.isolationMode,
      tenantIsolationClear: tenantIsolation.clear,
      tenantIsolationIssueCount: tenantIsolation.issueCount,
      tenantIsolationBlockingIssueCount: tenantIsolation.blockingIssueCount,
      crossTenantArtifactIds: tenantIsolation.crossTenantArtifactIds,
      crossWorkspaceArtifactIds: tenantIsolation.crossWorkspaceArtifactIds,
      tenantAuditHandoffRequired: tenantIsolation.auditHandoff.required,
      tenantAuditHandoffReady: tenantIsolation.auditHandoff.ready,
      tenantAuditHandoffToken: tenantIsolation.auditHandoff.required ? tenantIsolation.auditHandoff.token : null,
      tenantAuditHandoffAudience: tenantIsolation.auditHandoff.audience,
      persistedRevision: persistedState.revision,
      restartStatus: restartStatus.status,
      commandReplayDisposition: commandReplay.disposition,
      durableCommandId: commandReplay.durableCommandId,
      duplicateCommandSuppressed: commandReplay.duplicateSuppressed,
      resumesPriorCommand: commandReplay.resumesPriorCommand,
      commandJournalEntryCount: persistedState.commandJournalSummary.entryCount,
      inFlightCommandIds: persistedState.commandJournalSummary.inFlightCommandIds,
      idempotencyKey: command.idempotencyKey,
      replayCommand: command.command,
      safeToReplay: command.safeToReplay,
      manifestDigest: manifestIntegrity.manifestDigest,
      packetManifestIndexDigest: packetManifest.indexDigest,
      packetManifestIndexPath: packetManifest.indexPath,
      packetManifestPacketSetDigest: packetManifest.packetSetDigest,
      packetManifestPacketSetDirectory: packetManifest.packetSetDirectory,
      packetManifestContentAddressedIndexPath: packetManifest.contentAddressedIndexPath,
      packetManifestReplayLedgerPath: packetManifest.replayLedgerPath,
      packetManifestProofId: packetManifest.proofEnvelope.proofId,
      packetManifestComplete: packetManifest.complete,
      packetManifestUnresolvedPackets: packetManifest.unresolvedPackets,
      packetManifestIssueCount: packetManifest.packetIssues.length,
      packetBoundaryAttestationState: packetManifest.packetBoundaryAttestation.state,
      packetBoundaryAttestationDigest: packetManifest.packetBoundaryAttestation.attestationDigest,
      packetBoundaryBlockedPacketKinds: packetManifest.packetBoundaryAttestation.blockedPacketKinds,
      packetManifestClaimCount: packetManifest.packetClaims.length,
      packetManifestClaimIds: packetManifest.packetClaims.map((claim) => claim.claimId),
      packetClientReadinessState: packetClientReadiness.state,
      packetClientReadinessDigest: packetClientReadiness.contractDigest,
      packetClientReadinessReady: packetClientReadiness.ready,
      packetClientReadinessPrimaryAction: packetClientReadiness.primaryPacketAction,
      packetClientReadinessCounts: packetClientReadiness.counts,
      packetWorkflowHandoffState: packetWorkflowHandoff.state,
      packetWorkflowHandoffDigest: packetWorkflowHandoff.planDigest,
      packetWorkflowHandoffReady: packetWorkflowHandoff.ready,
      packetWorkflowHandoffNextAction: packetWorkflowHandoff.nextClientAction,
      packetWorkflowHandoffCurrentPacket: packetWorkflowHandoff.currentStep?.packetKind || null,
      packetWorkflowHandoffCurrentState: packetWorkflowHandoff.currentStep?.deliveryState || null,
      packetWorkflowHandoffCounts: packetWorkflowHandoff.counts,
      packetWorkflowHandoffAckRequired: packetWorkflowHandoff.acknowledgement.required,
      packetWorkflowHandoffAckPacketKinds: packetWorkflowHandoff.acknowledgement.pendingPacketKinds,
      packetProviderDispatchState: packetProviderDispatch.state,
      packetProviderDispatchReady: packetProviderDispatch.ready,
      packetProviderDispatchDigest: packetProviderDispatch.contractDigest,
      packetProviderDispatchNextAction: packetProviderDispatch.nextProviderAction,
      packetProviderDispatchBlockedPacketKinds: packetProviderDispatch.blockedPacketKinds,
      packetProviderDispatchExternalPacketKinds: packetProviderDispatch.externalPacketKinds,
      packetProviderDispatchAckPacketKinds: packetProviderDispatch.acknowledgementPacketKinds,
      packetProviderDispatchDigestFollowupPacketKinds: packetProviderDispatch.digestFollowupPacketKinds,
      packetProviderDispatchRows: packetProviderDispatch.dispatchRows.map((row) => ({
        packetKind: row.packetKind,
        dispatchState: row.dispatchState,
        dispatchBlocked: row.dispatchBlocked,
        selectedTransport: row.selectedTransport,
        syncSequence: row.syncSequence,
        missingCapabilities: row.missingCapabilities,
        digestVerificationRequired: row.digestVerificationRequired
      })),
      packetRecoveryCheckpointId: packetRecoveryCheckpoint.checkpointId,
      packetRecoveryCheckpointState: packetRecoveryCheckpoint.state,
      packetRecoveryCheckpointDigest: packetRecoveryCheckpoint.checkpointDigest,
      packetRecoveryCheckpointRestartSafe: packetRecoveryCheckpoint.restartSafe,
      packetRecoveryNextCommand: packetRecoveryCheckpoint.nextRestartCommand,
      packetRecoveryReusablePacketKinds: packetRecoveryCheckpoint.reusablePacketKinds,
      packetRecoveryRewritePacketKinds: packetRecoveryCheckpoint.rewritePacketKinds,
      packetRecoveryBlockedPacketKinds: packetRecoveryCheckpoint.blockedPacketKinds,
      packetRecoveryRows: packetRecoveryCheckpoint.rows.map((row) => ({
        packetKind: row.packetKind,
        priorState: row.priorState,
        nextState: row.nextState,
        restartAction: row.restartAction,
        reusable: row.reusable,
        digestMatches: row.digestMatches
      })),
      packetClientReadinessRows: packetClientReadiness.rows.map((row) => ({
        packetKind: row.packetKind,
        readinessState: row.readinessState,
        validationState: row.validationState,
        acceptedByGate: row.acceptedByGate,
        replaySafe: row.replaySafe,
        nextAction: row.nextAction
      })),
      contentAddressedPacketKinds: packetManifest.requiredPacketKinds,
      contentAddressedPacketUris: Object.fromEntries(packetManifest.packetList.map((packet) => [packet.packetKind, packet.uri])),
      contentAddressedPacketClaimUris: Object.fromEntries(packetManifest.packetClaims.map((claim) => [claim.packetKind, claim.uri])),
      integrityProofId: manifestIntegrity.auditProof.proofId,
      integrityComplete: manifestIntegrity.complete,
      integrityProofGapCount: manifestIntegrity.proofGapCount,
      unresolvedIntegrityArtifactIds: manifestIntegrity.unresolvedArtifactIds,
      healthStatus: operationalHealth.status,
      degradedMode: operationalHealth.degradedMode,
      retryable: operationalHealth.retryPlan.retryable,
      retryAt: operationalHealth.retryPlan.retryAt,
      replayWatchdogState: operationalHealth.replayWatchdog.state,
      replayWatchdogStale: operationalHealth.replayWatchdog.stale,
      replayWatchdogExhausted: operationalHealth.replayWatchdog.exhausted,
      replayWatchdogAgeMs: operationalHealth.replayWatchdog.ageMs,
      replayWatchdogTimeoutMs: operationalHealth.replayWatchdog.timeoutMs,
      replayWatchdogNextRetryAt: operationalHealth.replayWatchdog.nextRetryAt,
      replayWatchdogRecoveryCommand: operationalHealth.replayWatchdog.recoveryCommand,
      recoveryTicketId: operationalHealth.recoveryTicket.ticketId,
      recoveryTicketState: operationalHealth.recoveryTicket.state,
      recoveryTicketRoute: operationalHealth.recoveryTicket.route,
      recoveryTicketDispatchCommand: operationalHealth.recoveryTicket.dispatchCommand,
      recoveryTicketDigest: operationalHealth.recoveryTicket.subjectDigest,
      recoveryTicketBlockedBy: operationalHealth.recoveryTicket.blockedBy,
      recoveryTicketProofFollowupArtifactIds: operationalHealth.recoveryTicket.proofFollowupArtifactIds,
      recoveryTicketUserVisibleMessage: operationalHealth.recoveryTicket.userVisibleMessage,
      lifecycleEnabled: lifecycleSettings.enabled,
      lifecycleCommandId: lifecycleSettings.commandId,
      lifecycleCommand: lifecycleSettings.requestedCommand,
      lifecycleCommandLabel: lifecycleSettings.requestedCommandLabel,
      lifecycleScheduleMode: lifecycleSettings.scheduleMode,
      lifecycleEffectiveState: lifecycleSettings.effectiveState,
      lifecycleActivationAt: lifecycleSettings.activationAt,
      lifecycleDisabledUntil: lifecycleSettings.disabledUntil,
      lifecycleNextAction: lifecycleSettings.nextLifecycleAction,
      lifecycleCommandAccepted: lifecycleSettings.commandState.accepted,
      lifecycleResumeToken: lifecycleSettings.commandState.resumeToken,
      lifecycleScheduleWithinPolicy: lifecycleSettings.commandState.scheduleWithinPolicy,
      lifecycleDisableWithinPolicy: lifecycleSettings.commandState.disableWithinPolicy,
      lifecycleTransition: lifecycleSettings.transition,
      lifecycleAuditControl: lifecycleSettings.auditControl,
      lifecycleIssueCount: lifecycleSettings.issues.length,
      providerId: providerContract.providerId,
      providerReady: providerContract.negotiationComplete,
      providerSelectedMode: providerContract.capabilityProfile.selectedMode,
      providerNegotiationProofId: providerContract.capabilityNegotiation.proofId,
      providerNegotiationDigest: providerContract.capabilityNegotiation.subjectDigest,
      providerAcceptedCapabilities: providerContract.capabilityNegotiation.accepted,
      providerDeclinedCapabilities: providerContract.capabilityNegotiation.declined,
      providerUnsupportedCapabilities: providerContract.capabilityNegotiation.unsupported,
      providerIssueCount: providerContract.issues.length,
      providerMissingCapabilities: providerContract.missingCapabilities,
      providerSyncCursor: providerContract.sync.cursor,
      providerSyncEpoch: providerContract.sync.epoch,
      providerSyncWatermark: providerContract.sync.watermark,
      providerSyncReplayWindowMs: providerContract.sync.replayWindowMs,
      externalHandoffId: providerContract.externalHandoff.id,
      externalHandoffState: providerContract.externalHandoff.state,
      externalHandoffLeaseExpiresAt: providerContract.externalHandoff.lease.expiresAt,
      externalHandoffResumeToken: providerContract.externalHandoff.resumeToken,
      nextOperatorAction: operationalHealth.nextOperatorAction,
      previewArtifactCount: preview.artifactCount,
      acceptanceState: acceptance.state,
      acceptanceToken: acceptance.acceptanceToken,
      previewDecisionState: previewDecision.state,
      previewDecisionAction: previewDecision.action,
      previewDecisionToken: previewDecision.decisionToken,
      previewDecisionBlockedReasons: previewDecision.blockedReasons,
      mailchimpManifestStatus: mailchimpManifestReadiness.status,
      mailchimpManifestReady: mailchimpManifestReadiness.ready,
      mailchimpManifestDegradedReady: mailchimpManifestReadiness.degradedReady,
      mailchimpManifestAudienceId: mailchimpManifestReadiness.target.audienceId,
      mailchimpManifestCampaignId: mailchimpManifestReadiness.target.campaignId,
      mailchimpManifestPayloadDigest: mailchimpManifestReadiness.handoff.payloadDigest,
      mailchimpManifestDispatchable: mailchimpManifestReadiness.handoff.dispatchable,
      mailchimpManifestBlockedReasons: mailchimpManifestReadiness.validationSummary.blockedReasons,
      mailchimpManifestNextAction: mailchimpManifestReadiness.nextAction.action,
      readinessPublishReady: acceptance.readyForPublish,
      readinessDegradedHandoffReady: acceptance.readyForDegradedHandoff,
      validationSummaryStatus: validationSummary.status,
      validationSummaryCounts: validationSummary.counts,
      primaryNextStep: nextSteps.primary,
      clientWorkflowState: clientWorkflow.state,
      clientWorkflowChannel: clientWorkflow.channel,
      clientCorrelationId: clientState.correlationId,
      clientResponseFormat: clientWorkflow.responseFormat,
      clientDeliveryState: clientWorkflow.delivery.state,
      clientDeliveryEnvelopeId: clientWorkflow.delivery.envelopeId,
      clientDeliveryDigest: clientWorkflow.delivery.subjectDigest,
      clientDeliveryDeadlineAt: clientWorkflow.delivery.deadlineAt,
      clientDeliveryExpired: clientWorkflow.delivery.expired,
      clientDeliveryNextAction: clientWorkflow.delivery.nextClientAction,
      clientCallbackRoute: clientWorkflow.callbackRoute,
      clientAcknowledgementRequired: clientWorkflow.acknowledgement.required,
      clientCallbackEvent: clientWorkflow.callbackEvent.eventName,
      clientCallbackSubscribed: clientWorkflow.callbackEvent.subscribed,
      analyticsExportId: analytics.exportSummary.exportId,
      analyticsReportId: analyticsReport.reportId,
      analyticsReportDigest: analyticsReport.reportDigest,
      analyticsSnapshotCount: analytics.timeline.snapshotCount,
      analyticsTimelineEventCount: analyticsReport.timelineEvents.length,
      analyticsCounterExportRowCount: analyticsReport.exportTables.counters.length,
      analyticsFailureClassExportRowCount: analyticsReport.exportTables.failureClasses.length,
      digestCoveragePercent: analytics.exportSummary.digestCoveragePercent,
      pendingArtifactCount: analytics.counters.pendingArtifactCount,
      replayArtifactCount: analytics.counters.replayArtifactCount,
      evidenceCount: evidence.length
    },
    handoff: {
      target: clientState.handoffTarget,
      ready: blockingIssues.length === 0
        && restartStatus.status !== "blocked"
        && proof.handoffReady
        && packetManifest.complete
        && operationalHealth.status !== "failed"
        && command.safeToReplay,
      nextAction,
      restartSafe: restartStatus.restartSafe,
      commandReplay,
      lifecycleGate: command.lifecycleGate,
      lifecycleControl: {
        schema: `${BUNDLE_MANIFEST_SCHEMA}.lifecycleControl`,
        enabled: lifecycleSettings.enabled,
        commandId: lifecycleSettings.commandId,
        priorState: lifecycleSettings.priorState,
        effectiveState: lifecycleSettings.effectiveState,
        requestedCommand: lifecycleSettings.requestedCommand,
        requestedCommandLabel: lifecycleSettings.requestedCommandLabel,
        scheduleMode: lifecycleSettings.scheduleMode,
        activationAt: lifecycleSettings.activationAt,
        disabledUntil: lifecycleSettings.disabledUntil,
        publishAllowedNow: lifecycleSettings.publishAllowedNow,
        nextLifecycleAction: lifecycleSettings.nextLifecycleAction,
        commandState: lifecycleSettings.commandState,
        controls: lifecycleSettings.controls,
        schedulePolicy: lifecycleSettings.schedulePolicy,
        transition: lifecycleSettings.transition,
        auditControl: lifecycleSettings.auditControl
      },
      providerGate: command.providerGate,
      providerSync: providerContract.sync,
      externalHandoff: providerContract.externalHandoff,
      providerNegotiation: providerContract.capabilityNegotiation,
      providerCapabilityProfile: providerContract.capabilityProfile,
      packetManifest: {
        schema: packetManifest.schema,
        indexDigest: packetManifest.indexDigest,
        indexPath: packetManifest.indexPath,
        packetSetDigest: packetManifest.packetSetDigest,
        packetSetDirectory: packetManifest.packetSetDirectory,
        contentAddressedIndexPath: packetManifest.contentAddressedIndexPath,
        proofEnvelopePath: packetManifest.proofEnvelopePath,
        replayLedgerPath: packetManifest.replayLedgerPath,
        complete: packetManifest.complete,
        unresolvedPackets: packetManifest.unresolvedPackets,
        verificationSummary: packetManifest.verificationSummary,
        packetBoundaryAttestation: packetManifest.packetBoundaryAttestation,
        proofEnvelope: packetManifest.proofEnvelope,
        packetSet: {
          directory: packetManifest.packetSet.directory,
          digest: packetManifest.packetSet.digest,
          indexPath: packetManifest.packetSet.indexPath,
          proofPath: packetManifest.packetSet.proofPath,
          replayLedgerPath: packetManifest.packetSet.replayLedgerPath,
          replaySafe: packetManifest.packetSet.replaySafe,
          requiredPaths: packetManifest.packetSet.requiredPaths
        },
        packets: Object.fromEntries(packetManifest.packetList.map((packet) => [
          packet.packetKind,
          {
            uri: packet.uri,
            packetPath: packet.packetPath,
            proofPath: packet.proofPath,
            proofId: packet.proofId,
            subjectDigest: packet.subjectDigest,
            claimId: packetManifest.packetClaimsByKind[packet.packetKind]?.claimId || null,
            claimDigest: packetManifest.packetClaimsByKind[packet.packetKind]?.claimDigest || null,
            claimPath: packetManifest.packetClaimsByKind[packet.packetKind]?.claimPath || null,
            claimUri: packetManifest.packetClaimsByKind[packet.packetKind]?.uri || null,
            subjectComplete: packet.subjectComplete,
            boundaryClear: packet.verification.boundaryClear,
            boundaryGate: packet.verification.boundaryGate,
            replaySafe: packet.replaySafe
          }
        ]))
      },
      packetClientReadiness,
      packetWorkflowHandoff,
      packetProviderDispatch,
      packetRecoveryCheckpoint,
      workspaceId: workspaceScope.workspaceId,
      boundaryClear: proof.boundaryClear,
      tenantIsolationClear: tenantIsolation.clear,
      tenantBoundary: {
        isolationMode: tenantIsolation.isolationMode,
        crossTenantArtifactIds: tenantIsolation.crossTenantArtifactIds,
        crossWorkspaceArtifactIds: tenantIsolation.crossWorkspaceArtifactIds,
        auditHandoff: tenantIsolation.auditHandoff
      },
      providerReady: proof.providerReady,
      actorCanPublish: actorAccess.canPublish,
      manifestDigest: manifestIntegrity.manifestDigest,
      integrityProof: manifestIntegrity.auditProof,
      unresolvedIntegrityArtifactIds: manifestIntegrity.unresolvedArtifactIds,
      healthStatus: operationalHealth.status,
      retryAt: operationalHealth.retryPlan.retryAt,
      recoveryTicket: operationalHealth.recoveryTicket,
      replayWatchdog: {
        state: operationalHealth.replayWatchdog.state,
        stale: operationalHealth.replayWatchdog.stale,
        exhausted: operationalHealth.replayWatchdog.exhausted,
        ageMs: operationalHealth.replayWatchdog.ageMs,
        timeoutMs: operationalHealth.replayWatchdog.timeoutMs,
        nextRetryAt: operationalHealth.replayWatchdog.nextRetryAt,
        recoveryCommand: operationalHealth.replayWatchdog.recoveryCommand,
        issue: operationalHealth.replayWatchdog.issue
      },
      degradedMode: operationalHealth.degradedMode,
      preview,
      acceptance,
      previewDecision,
      mailchimpManifestReadiness,
      clientWorkflow,
      clientDelivery: clientWorkflow.delivery,
      readiness: {
        state: acceptance.state,
        ready: acceptance.accepted,
        publishReady: acceptance.readyForPublish,
        degradedHandoffReady: acceptance.readyForDegradedHandoff,
        packetManifestComplete: packetManifest.complete,
        packetManifestProofId: packetManifest.proofEnvelope.proofId,
        packetClientReadinessState: packetClientReadiness.state,
        packetClientReadinessReady: packetClientReadiness.ready,
        packetClientReadinessDigest: packetClientReadiness.contractDigest,
        packetWorkflowHandoffState: packetWorkflowHandoff.state,
        packetWorkflowHandoffReady: packetWorkflowHandoff.ready,
        packetWorkflowHandoffDigest: packetWorkflowHandoff.planDigest,
        packetWorkflowHandoffNextAction: packetWorkflowHandoff.nextClientAction,
        packetProviderDispatchState: packetProviderDispatch.state,
        packetProviderDispatchReady: packetProviderDispatch.ready,
        packetProviderDispatchDigest: packetProviderDispatch.contractDigest,
        packetProviderDispatchNextAction: packetProviderDispatch.nextProviderAction,
        packetRecoveryCheckpointState: packetRecoveryCheckpoint.state,
        packetRecoveryCheckpointDigest: packetRecoveryCheckpoint.checkpointDigest,
        packetRecoveryRestartSafe: packetRecoveryCheckpoint.restartSafe,
        packetRecoveryNextCommand: packetRecoveryCheckpoint.nextRestartCommand,
        mailchimpManifestStatus: mailchimpManifestReadiness.status,
        mailchimpManifestReady: mailchimpManifestReadiness.ready,
        mailchimpManifestDegradedReady: mailchimpManifestReadiness.degradedReady,
        mailchimpManifestNextAction: mailchimpManifestReadiness.nextAction.action,
        mailchimpManifestPayloadDigest: mailchimpManifestReadiness.handoff.payloadDigest,
        mailchimpManifestBlockedReasons: mailchimpManifestReadiness.validationSummary.blockedReasons,
        validationStatus: validationSummary.status,
        failedChecklistKeys: acceptance.failedChecklistKeys
      },
      validationSummary,
      nextSteps,
      actionableErrors: operationalHealth.userVisibleErrors,
      analyticsSummary: analytics.exportSummary,
      analyticsReport: {
        reportId: analyticsReport.reportId,
        reportDigest: analyticsReport.reportDigest,
        exportFormat: analyticsReport.exportFormat,
        timelineEventCount: analyticsReport.timelineEvents.length,
        counterRowCount: analyticsReport.exportTables.counters.length,
        failureClassRowCount: analyticsReport.exportTables.failureClasses.length,
        exportRoute: analyticsReport.subscriptions.exportRoute
      },
      userVisibleSummary: artifacts.length === 0
        ? "No bundle artifacts were provided for this request."
        : !lifecycleSettings.publishAllowedNow
          ? lifecycleSettings.scheduledForFuture
            ? `Bundle manifest publish is scheduled for ${lifecycleSettings.activationAt}; replay is held until then.`
            : "Bundle manifest lifecycle is disabled or paused; enable it before replay."
        : operationalHealth.status === "failed"
          ? operationalHealth.nextOperatorAction
          : operationalHealth.status === "degraded"
            ? `${artifacts.length} bundle artifact${artifacts.length === 1 ? "" : "s"} prepared in degraded mode; digest follow-up is required.`
            : `${artifacts.length} bundle artifact${artifacts.length === 1 ? "" : "s"} prepared for ${clientState.handoffTarget}; ${restartStatus.pendingArtifactCount} require replay.`
    },
    evidence
  };
}

export default describeBundleManifestSurface;
