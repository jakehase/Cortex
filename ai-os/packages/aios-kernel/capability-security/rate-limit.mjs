export const surfaceId = "aios_capability-security_rate-limit_015";
export const surfaceGroup = "capability-security";
export const surfaceName = "rate-limit";

const DEFAULT_RATE_LIMIT_CONTRACT = Object.freeze({
  version: 1,
  unit: "requests",
  windowMs: 60_000,
  maxRequests: 120,
  burstRequests: 20,
  scope: "tenant-capability-provider",
  enforcement: "kernel-mediated"
});

const SUPPORTED_PROVIDER_CAPABILITIES = Object.freeze([
  "rate-limit.snapshot.v1",
  "rate-limit.reserve.v1",
  "rate-limit.release.v1",
  "rate-limit.audit.v1",
  "rate-limit.external-handoff.v1"
]);

const DEFAULT_RATE_LIMIT_PERMISSION = "capability.rate-limit.consume";
const SUPPORTED_BOUNDARY_ROLES = Object.freeze(["viewer", "operator", "admin", "service"]);
const SUPPORTED_CAPABILITY_RATE_CLASSES = Object.freeze([
  "default",
  "model-call",
  "external-system",
  "operator-interrupt"
]);
const EXTERNAL_PROVIDER_PROFILES = Object.freeze({
  mailchimp: Object.freeze({
    providerKeys: ["mailchimp", "mailchimp-marketing", "mailchimp-transactional"],
    serviceHints: ["mailchimp", "campaign", "audience", "list", "member", "segment", "template", "journey"],
    requiredCapabilities: ["rate-limit.snapshot.v1", "rate-limit.audit.v1", "rate-limit.external-handoff.v1"],
    preferredCapabilityRateClass: "external-system",
    retryHeaderNames: ["retry-after", "x-ratelimit-reset", "x-request-id"],
    remoteIdempotencyHeaders: ["X-Request-Id", "X-Idempotency-Key"],
    remoteQuotaPolicy: Object.freeze({
      requiredOperationKinds: ["campaign", "audience", "automation"],
      capability: "rate-limit.external-handoff.v1",
      acceptanceRequired: true,
      snapshotMaxAgeMs: 2 * 60 * 1000,
      acceptanceMaxAgeMs: 5 * 60 * 1000,
      minRemainingForDispatch: 1,
      retryHeaderNames: ["retry-after", "x-ratelimit-reset", "x-request-id"],
      resetHeaderNames: ["x-ratelimit-reset"],
      nextActionWhenMissing: "sync.rate-limit.mailchimp-remote-quota"
    }),
    defaultEndpointPath: "/provider/mailchimp/rate-limit/handoff",
    remoteReplayWindowMs: 10 * 60 * 1000,
    acceptanceRequiredKinds: ["campaign", "audience", "automation"],
    checkpointRequiredKinds: ["campaign", "audience", "automation"],
    dispatchRiskByKind: Object.freeze({
      campaign: "high",
      audience: "critical",
      automation: "high",
      template: "medium"
    }),
    operationKinds: Object.freeze({
      campaign: ["campaign", "campaigns", "send", "schedule", "unschedule", "email"],
      audience: ["audience", "audiences", "list", "lists", "member", "members", "subscriber"],
      automation: ["journey", "automation", "automations", "customer-journey"],
      template: ["template", "templates"]
    })
  })
});
const CAPABILITY_RATE_CLASS_ALIASES = Object.freeze({
  model: "model-call",
  llm: "model-call",
  completion: "model-call",
  inference: "model-call",
  embedding: "model-call",
  embeddings: "model-call",
  "model-call": "model-call",
  "external-system": "external-system",
  external: "external-system",
  provider: "external-system",
  connector: "external-system",
  tool: "external-system",
  interrupt: "operator-interrupt",
  cancel: "operator-interrupt",
  abort: "operator-interrupt",
  "operator-interrupt": "operator-interrupt"
});
const CAPABILITY_RATE_CLASS_POLICIES = Object.freeze({
  default: Object.freeze({
    classWeight: 1,
    burstShare: 1,
    pressureThreshold: 0.9,
    reservationStrategy: "when-burst-exhausted",
    emergencyBurstRequests: 0,
    handoffRequired: false
  }),
  "model-call": Object.freeze({
    classWeight: 2,
    burstShare: 0.5,
    pressureThreshold: 0.8,
    reservationStrategy: "prefer-provider-reservation",
    emergencyBurstRequests: 0,
    handoffRequired: false
  }),
  "external-system": Object.freeze({
    classWeight: 1,
    burstShare: 0.35,
    pressureThreshold: 0.75,
    reservationStrategy: "prefer-provider-reservation",
    emergencyBurstRequests: 0,
    handoffRequired: true
  }),
  "operator-interrupt": Object.freeze({
    classWeight: 1,
    burstShare: 1,
    pressureThreshold: 0.98,
    reservationStrategy: "local-emergency",
    emergencyBurstRequests: 3,
    handoffRequired: false
  })
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asPositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function asIdentifier(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asIdentifierList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()))]
    : [];
}

function normalizeProviderProfileToken(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    : "";
}

function resolveExternalProviderProfile(input = {}, providerContract = {}, serviceContract = {}, requestState = {}) {
  const source = asObject(input.externalProviderProfile || input.providerProfile || input.integrationProfile);
  const explicitProfile = normalizeProviderProfileToken(
    source.profile || source.kind || source.provider || source.name || input.providerProfileName
  );
  const candidateText = [
    explicitProfile,
    providerContract.providerId,
    providerContract.endpoint,
    serviceContract.serviceId,
    serviceContract.capabilityId,
    requestState.routeId,
    requestState.workflowId
  ]
    .filter((entry) => typeof entry === "string")
    .join(" ")
    .toLowerCase();
  const matchedProfileName = Object.entries(EXTERNAL_PROVIDER_PROFILES).find(([, profile]) => (
    profile.providerKeys.some((key) => candidateText.includes(key))
      || profile.serviceHints.some((hint) => candidateText.includes(hint))
  ))?.[0] || "";
  const profileName = EXTERNAL_PROVIDER_PROFILES[explicitProfile] ? explicitProfile : matchedProfileName;
  const profile = EXTERNAL_PROVIDER_PROFILES[profileName] || null;
  const declaredRemoteHeaders = asIdentifierList(source.remoteIdempotencyHeaders || source.idempotencyHeaders);
  const declaredRetryHeaders = asIdentifierList(source.retryHeaderNames || source.retryHeaders);
  return {
    schema: "rate-limit.external-provider-profile.v1",
    providerProfile: profileName || "generic",
    matched: Boolean(profile),
    preferredCapabilityRateClass: profile?.preferredCapabilityRateClass || null,
    requiredCapabilities: profile?.requiredCapabilities || ["rate-limit.snapshot.v1", "rate-limit.audit.v1"],
    remoteIdempotencyHeaders: declaredRemoteHeaders.length
      ? declaredRemoteHeaders
      : profile?.remoteIdempotencyHeaders || [],
    retryHeaderNames: declaredRetryHeaders.length
      ? declaredRetryHeaders
      : profile?.retryHeaderNames || [],
    remoteQuotaPolicy: {
      ...(profile?.remoteQuotaPolicy || {}),
      ...(asObject(source.remoteQuotaPolicy || source.quotaPolicy))
    },
    defaultEndpointPath: asIdentifier(source.defaultEndpointPath, profile?.defaultEndpointPath || ""),
    remoteReplayWindowMs: asPositiveInteger(source.remoteReplayWindowMs, profile?.remoteReplayWindowMs || 5 * 60 * 1000),
    acceptanceRequiredKinds: asIdentifierList(source.acceptanceRequiredKinds).length
      ? asIdentifierList(source.acceptanceRequiredKinds)
      : profile?.acceptanceRequiredKinds || [],
    checkpointRequiredKinds: asIdentifierList(source.checkpointRequiredKinds).length
      ? asIdentifierList(source.checkpointRequiredKinds)
      : profile?.checkpointRequiredKinds || [],
    dispatchRiskByKind: profile?.dispatchRiskByKind || {},
    operationKinds: profile?.operationKinds || {},
    source: explicitProfile ? "explicit" : profile ? "inferred" : "generic"
  };
}

function inferExternalProviderOperationKind(providerProfile, requestState, serviceContract) {
  const operationText = [
    requestState.routeId,
    requestState.workflowId,
    serviceContract.capabilityId,
    serviceContract.serviceId
  ]
    .filter((entry) => typeof entry === "string")
    .join(" ")
    .toLowerCase();
  const matched = Object.entries(providerProfile.operationKinds || {}).find(([, hints]) => (
    hints.some((hint) => operationText.includes(hint))
  ));
  return matched?.[0] || (providerProfile.matched ? "provider-operation" : "generic");
}

function normalizeExternalProviderQuotaTelemetry({
  providerProfile,
  operationKind,
  serviceContract,
  syncMetadata,
  requestState,
  source = {}
}) {
  const policy = asObject(providerProfile.remoteQuotaPolicy);
  const quota = asObject(
    source.remoteQuota ??
      source.providerQuota ??
      source.rateLimitHandoff?.remoteQuota ??
      source.rateLimitQuota
  );
  const handoff = asObject(source.rateLimitHandoff ?? source.quotaHandoff ?? source.externalHandoff);
  const requiredOperationKinds = asIdentifierList(policy.requiredOperationKinds);
  const required = Boolean(
    providerProfile.matched &&
      policy.capability &&
      (requiredOperationKinds.length === 0 || requiredOperationKinds.includes(operationKind))
  );
  const nowMs = asTimestampMs(syncMetadata.generatedAt) || Date.now();
  const observedAt = asIdentifier(quota.observedAt || quota.recordedAt || handoff.recordedAt, null);
  const observedAtMs = asTimestampMs(observedAt);
  const snapshotMaxAgeMs = asPositiveInteger(policy.snapshotMaxAgeMs, 2 * 60 * 1000);
  const snapshotAgeMs = observedAtMs ? Math.max(0, nowMs - observedAtMs) : null;
  const snapshotStale = Boolean(required && (!observedAtMs || snapshotAgeMs > snapshotMaxAgeMs));
  const snapshotId = asIdentifier(
    quota.snapshotId || quota.quotaSnapshotId || handoff.quotaSnapshotId,
    required ? `${syncMetadata.syncKey}:remote-quota:${requestState.requestId}` : null
  );
  const providerCursor = asIdentifier(
    quota.providerCursor || quota.cursor || handoff.providerCursor,
    null
  );
  const expectedCursor = syncMetadata.cursor;
  const acceptedAt = asIdentifier(handoff.acceptedAt || quota.acceptedAt, null);
  const acceptedAtMs = asTimestampMs(acceptedAt);
  const acceptedBy = asIdentifier(handoff.acceptedBy || handoff.actorId || quota.acceptedBy, null);
  const expectedAcceptanceKey = [
    providerProfile.providerProfile || "generic",
    serviceContract.tenantId,
    serviceContract.workspaceId,
    operationKind,
    requestState.requestId
  ].join(":");
  const acceptanceKey = asIdentifier(handoff.acceptanceKey || quota.acceptanceKey, null);
  const acceptanceRequired = required && policy.acceptanceRequired !== false;
  const acceptanceMaxAgeMs = asPositiveInteger(policy.acceptanceMaxAgeMs, 5 * 60 * 1000);
  const acceptanceAgeMs = acceptedAtMs ? Math.max(0, nowMs - acceptedAtMs) : null;
  const acceptanceStale = Boolean(
    acceptanceRequired &&
      acceptedAtMs &&
      acceptanceAgeMs > acceptanceMaxAgeMs
  );
  const accepted = !acceptanceRequired || (
    !acceptanceStale &&
      (handoff.accepted === true || Boolean(acceptedAt && acceptedBy && acceptanceKey === expectedAcceptanceKey))
  );
  const limit = Number.isInteger(quota.limit) && quota.limit >= 0 ? quota.limit : null;
  const remaining = Number.isInteger(quota.remaining) && quota.remaining >= 0 ? quota.remaining : null;
  const resetAt = asIdentifier(quota.resetAt || quota.remoteResetAt, null);
  const retryAfterMs = asNonNegativeInteger(quota.retryAfterMs || quota.retryAfter, 0);
  const minRemaining = asNonNegativeInteger(policy.minRemainingForDispatch, 1);
  const exhausted = required && remaining !== null && remaining < minRemaining;
  const cursorReady = !required || Boolean(providerCursor || snapshotId);
  const snapshotReady = !required || Boolean(snapshotId) && !snapshotStale;
  const violationCodes = [
    acceptanceRequired && !accepted ? "remote-quota.acceptance-required" : null,
    acceptanceStale ? "remote-quota.acceptance-stale" : null,
    required && !snapshotId ? "remote-quota.snapshot-required" : null,
    snapshotStale ? "remote-quota.snapshot-stale" : null,
    required && !cursorReady ? "remote-quota.provider-cursor-required" : null,
    exhausted ? "remote-quota.exhausted" : null
  ].filter(Boolean);
  const ready = !required || violationCodes.length === 0;
  const nextActionId = ready
    ? "dispatch.rate-limit.external-provider-handoff"
    : exhausted
      ? "wait.rate-limit.remote-quota-reset"
      : acceptanceStale
        ? "refresh.rate-limit.external-provider-acceptance"
      : !accepted
        ? "accept.rate-limit.external-provider-preview"
        : asIdentifier(policy.nextActionWhenMissing, "sync.rate-limit.remote-quota");

  return {
    schema: "rate-limit.external-provider-quota-telemetry.v1",
    providerProfile: providerProfile.providerProfile || "generic",
    operationKind,
    required,
    ready,
    state: !required ? "not-required" : ready ? "ready" : exhausted ? "exhausted" : "blocked",
    capability: asIdentifier(policy.capability, ""),
    requiredOperationKinds,
    snapshot: {
      snapshotId,
      observedAt,
      ageMs: snapshotAgeMs,
      maxAgeMs: snapshotMaxAgeMs,
      stale: snapshotStale,
      providerCursor,
      expectedCursor
    },
    acceptance: {
      required: acceptanceRequired,
      accepted,
      expectedAcceptanceKey,
      acceptanceKey,
      acceptedAt,
      acceptedBy,
      maxAgeMs: acceptanceMaxAgeMs,
      ageMs: acceptanceAgeMs,
      stale: acceptanceStale
    },
    quota: {
      limit,
      remaining,
      minRemainingForDispatch: minRemaining,
      resetAt,
      retryAfterMs,
      retryHeaderNames: asIdentifierList(policy.retryHeaderNames),
      resetHeaderNames: asIdentifierList(policy.resetHeaderNames)
    },
    nextAction: {
      actionId: nextActionId,
      owner: nextActionId.startsWith("accept.") || nextActionId.startsWith("refresh.") ? "operator" : "kernel",
      retryAfterMs: exhausted ? retryAfterMs : acceptanceStale ? acceptanceMaxAgeMs : 0,
      reasonCodes: violationCodes
    },
    violationCodes
  };
}

function buildExternalProviderSafetyEnvelope({
  providerProfile,
  operationKind,
  providerContract,
  serviceContract,
  syncMetadata,
  requestState,
  accessBoundary,
  runtimeDecision = null,
  source = {}
}) {
  const quotaTelemetry = normalizeExternalProviderQuotaTelemetry({
    providerProfile,
    operationKind,
    serviceContract,
    syncMetadata,
    requestState,
    source
  });
  const acceptance = asObject(source.acceptance || source.operatorAcceptance || source.previewAcceptance);
  const checkpoint = asObject(source.checkpoint || source.providerCheckpoint || source.handoffCheckpoint);
  const acceptedAt = asIdentifier(acceptance.acceptedAt || acceptance.recordedAt, null);
  const acceptedBy = asIdentifier(acceptance.acceptedBy || acceptance.actorId || acceptance.principalId, null);
  const expectedAcceptanceKey = `${serviceContract.subjectKey}:${requestState.requestId}:${operationKind}`;
  const acceptanceKey = asIdentifier(acceptance.acceptanceKey || acceptance.key, null);
  const checkpointId = asIdentifier(
    checkpoint.checkpointId || checkpoint.id,
    `${syncMetadata.syncKey}:external-checkpoint:${requestState.requestId}`
  );
  const checkpointCursor = asIdentifier(checkpoint.cursor || checkpoint.providerCursor, null);
  const acceptanceRequired = providerProfile.acceptanceRequiredKinds.includes(operationKind);
  const checkpointRequired = providerProfile.checkpointRequiredKinds.includes(operationKind);
  const acceptanceMatches = Boolean(
    !acceptanceRequired ||
    acceptance.accepted === true ||
    (acceptedAt && acceptedBy && acceptanceKey === expectedAcceptanceKey)
  );
  const checkpointMatches = Boolean(
    !checkpointRequired ||
    (checkpointId && (!checkpointCursor || checkpointCursor === syncMetadata.cursor))
  );
  const boundarySatisfied = accessBoundary.state === "satisfied";
  const providerWritable = syncMetadata.providerSyncLease.writeAllowed === true;
  const runtimeAllowed = runtimeDecision ? runtimeDecision.allowed === true : true;
  const remoteReplayWindowMs = providerProfile.remoteReplayWindowMs;
  const remoteReplayFenceKey = [
    providerProfile.providerProfile || "generic",
    serviceContract.tenantId,
    serviceContract.workspaceId,
    serviceContract.capabilityId,
    requestState.requestId
  ].join(":");
  const risk = providerProfile.dispatchRiskByKind?.[operationKind] || (
    acceptanceRequired ? "high" : checkpointRequired ? "medium" : "low"
  );
  const violationCodes = [
    !boundarySatisfied ? "provider-safety.boundary-not-satisfied" : null,
    !providerWritable ? "provider-safety.sync-lease-not-writable" : null,
    !runtimeAllowed ? "provider-safety.runtime-not-allowed" : null,
    acceptanceRequired && !acceptanceMatches ? "provider-safety.acceptance-required" : null,
    checkpointRequired && !checkpointMatches ? "provider-safety.checkpoint-required" : null,
    ...quotaTelemetry.violationCodes.map((code) => `provider-safety.${code}`)
  ].filter(Boolean);
  const dispatchState = violationCodes.length
    ? "hold"
    : risk === "critical"
      ? "dispatch-with-audit-lock"
      : "dispatchable";
  const nextActionId = !boundarySatisfied
    ? "repair.rate-limit.boundary-grants"
    : !providerWritable
      ? "acquire.rate-limit.provider-sync-lease"
      : !runtimeAllowed
        ? "wait.rate-limit.admission"
        : acceptanceRequired && !acceptanceMatches
        ? "accept.rate-limit.external-provider-preview"
        : quotaTelemetry.required && !quotaTelemetry.ready
          ? quotaTelemetry.nextAction.actionId
          : checkpointRequired && !checkpointMatches
            ? "checkpoint.rate-limit.external-provider-handoff"
            : "dispatch.rate-limit.external-provider-handoff";

  return {
    schema: "rate-limit.external-provider-safety-envelope.v1",
    state: dispatchState,
    providerProfile: providerProfile.providerProfile || "generic",
    operationKind,
    risk,
    required: acceptanceRequired || checkpointRequired,
    safeToDispatch: violationCodes.length === 0,
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceMatches,
      expectedAcceptanceKey,
      acceptanceKey,
      acceptedAt,
      acceptedBy
    },
    checkpoint: {
      required: checkpointRequired,
      ready: checkpointMatches,
      checkpointId,
      cursor: checkpointCursor,
      expectedCursor: syncMetadata.cursor
    },
    remoteQuota: quotaTelemetry,
    replayFence: {
      key: remoteReplayFenceKey,
      windowMs: remoteReplayWindowMs,
      duplicatePolicy: "block-and-audit",
      idempotencyScope: `${serviceContract.subjectKey}:${requestState.requestId}`
    },
    dispatch: {
      nextActionId,
      canDispatch: violationCodes.length === 0,
      reasonCodes: violationCodes,
      auditLockRequired: risk === "critical",
      providerWritable,
      boundarySatisfied,
      runtimeAllowed,
      remoteQuotaReady: quotaTelemetry.ready
    }
  };
}

function buildExternalProviderWorkflowContract({
  providerProfile,
  operationKind,
  serviceContract,
  syncMetadata,
  requestState,
  safetyEnvelope,
  providerContract = null,
  runtimeDecision = null
}) {
  const remoteIdempotencyKey = [
    providerProfile.providerProfile || "generic",
    serviceContract.subjectKey,
    requestState.requestId,
    operationKind
  ].join(":");
  const remoteHeaders = Object.fromEntries(
    (providerProfile.remoteIdempotencyHeaders || []).map((header) => [header, remoteIdempotencyKey])
  );
  const requiredCapabilities = providerProfile.requiredCapabilities || [];
  const blocking = safetyEnvelope.safeToDispatch !== true;
  const acceptanceBlocking = safetyEnvelope.acceptance.required && !safetyEnvelope.acceptance.accepted;
  const checkpointBlocking = safetyEnvelope.checkpoint.required && !safetyEnvelope.checkpoint.ready;
  const quotaBlocking = safetyEnvelope.remoteQuota.required && !safetyEnvelope.remoteQuota.ready;
  const syncLeaseBlocking = safetyEnvelope.dispatch.providerWritable !== true;
  const dispatchActionId = blocking
    ? acceptanceBlocking
      ? "accept.rate-limit.external-provider-preview"
      : quotaBlocking
        ? safetyEnvelope.remoteQuota.nextAction.actionId
        : checkpointBlocking
        ? "checkpoint.rate-limit.external-provider-handoff"
        : syncLeaseBlocking
          ? "lease.rate-limit.provider-sync"
          : safetyEnvelope.dispatch.nextActionId
    : "dispatch.rate-limit.external-provider-handoff";
  const clientState = !providerProfile.matched
    ? "generic-provider"
    : blocking
      ? acceptanceBlocking
      ? "awaiting-operator-acceptance"
        : quotaBlocking
          ? safetyEnvelope.remoteQuota.state === "exhausted"
            ? "awaiting-remote-quota-reset"
            : "awaiting-remote-quota-sync"
        : checkpointBlocking
          ? "awaiting-provider-checkpoint"
          : syncLeaseBlocking
            ? "awaiting-provider-sync-lease"
            : "blocked"
      : safetyEnvelope.risk === "critical"
        ? "ready-with-audit-lock"
        : "ready";
  const handoffRequired = safetyEnvelope.required
    || safetyEnvelope.remoteQuota.required
    || requiredCapabilities.includes("rate-limit.external-handoff.v1");
  const reasonCodes = [
    handoffRequired ? "workflow.external-provider-handoff-required" : "workflow.external-provider-handoff-optional",
    providerProfile.providerProfile !== "generic" ? `workflow.profile.${providerProfile.providerProfile}` : null,
    `workflow.operation-kind.${operationKind}`,
    safetyEnvelope.risk === "critical" ? "workflow.audit-lock-required" : null,
    acceptanceBlocking ? "workflow.operator-acceptance-required" : null,
    quotaBlocking ? "workflow.remote-quota-required" : null,
    checkpointBlocking ? "workflow.provider-checkpoint-required" : null,
    syncLeaseBlocking ? "workflow.provider-sync-lease-required" : null,
    ...safetyEnvelope.dispatch.reasonCodes
  ].filter(Boolean);

  return {
    schema: "rate-limit.external-provider-workflow-contract.v1",
    providerProfile: providerProfile.providerProfile || "generic",
    operationKind,
    serviceId: serviceContract.serviceId,
    subjectKey: serviceContract.subjectKey,
    requestId: requestState.requestId,
    routeId: requestState.routeId,
    workflowId: requestState.workflowId,
    providerId: providerContract?.providerId || "",
    state: clientState,
    required: handoffRequired,
    blocking,
    dispatchActionId,
    owner: acceptanceBlocking ? "operator" : syncLeaseBlocking || checkpointBlocking || quotaBlocking ? "kernel" : "client",
    retryAfterMs: quotaBlocking
      ? safetyEnvelope.remoteQuota.nextAction.retryAfterMs
      : syncLeaseBlocking
        ? syncMetadata.nextRefreshAfterMs
        : 0,
    checkpointPolicy: checkpointBlocking
      ? "persist-provider-checkpoint-before-dispatch"
      : quotaBlocking
        ? "persist-remote-quota-before-dispatch"
      : handoffRequired
        ? "persist-handoff-delivery"
        : "local-proof-only",
    acceptance: {
      required: safetyEnvelope.acceptance.required,
      accepted: safetyEnvelope.acceptance.accepted,
      expectedAcceptanceKey: safetyEnvelope.acceptance.expectedAcceptanceKey,
      acceptanceKey: safetyEnvelope.acceptance.acceptanceKey,
      acceptedAt: safetyEnvelope.acceptance.acceptedAt,
      acceptedBy: safetyEnvelope.acceptance.acceptedBy
    },
    checkpoint: {
      required: safetyEnvelope.checkpoint.required,
      ready: safetyEnvelope.checkpoint.ready,
      checkpointId: safetyEnvelope.checkpoint.checkpointId,
      cursor: safetyEnvelope.checkpoint.cursor,
      expectedCursor: safetyEnvelope.checkpoint.expectedCursor
    },
    remoteQuota: safetyEnvelope.remoteQuota,
    remoteIdempotency: {
      key: remoteIdempotencyKey,
      headers: remoteHeaders,
      headerNames: Object.keys(remoteHeaders).sort(),
      replayFenceKey: safetyEnvelope.replayFence.key,
      replayWindowMs: safetyEnvelope.replayFence.windowMs,
      duplicatePolicy: safetyEnvelope.replayFence.duplicatePolicy,
      restartSafeDeliveryKey: `${syncMetadata.syncKey}:external-provider:${remoteIdempotencyKey}`
    },
    safety: {
      state: safetyEnvelope.state,
      risk: safetyEnvelope.risk,
      safeToDispatch: safetyEnvelope.safeToDispatch,
      auditLockRequired: safetyEnvelope.dispatch.auditLockRequired,
      violationCodes: safetyEnvelope.dispatch.reasonCodes
    },
    runtime: runtimeDecision
      ? {
          decision: runtimeDecision.decision,
          allowed: runtimeDecision.allowed,
          reservationRequired: runtimeDecision.reservationRequired,
          capabilityRateClass: runtimeDecision.request.capabilityRateClass
        }
      : null,
    reasonCodes
  };
}

function normalizeCapabilityRateClassToken(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const token = value.trim().toLowerCase().replaceAll("_", "-");
  return CAPABILITY_RATE_CLASS_ALIASES[token] || token;
}

function normalizeEvidence(evidence) {
  return Array.isArray(evidence)
    ? evidence.filter((entry) => entry && typeof entry === "object")
    : [];
}

function asBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asNonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function readNonNegativeInteger(source, keys, fallback) {
  const value = firstDefined(...keys.map((key) => source[key]));
  return asNonNegativeInteger(value, fallback);
}

function asTimestampMs(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveCapabilityRateClass(request, input, serviceContract) {
  const explicitClass = asIdentifier(
    request.capabilityRateClass || request.capabilityClass || request.kind || input.capabilityRateClass,
    null
  );
  const normalizedExplicit = normalizeCapabilityRateClassToken(explicitClass);

  if (SUPPORTED_CAPABILITY_RATE_CLASSES.includes(normalizedExplicit)) {
    return normalizedExplicit;
  }

  const hintText = [
    request.capabilityId,
    request.capability,
    request.routeId,
    request.route,
    serviceContract.capabilityId,
    serviceContract.serviceId
  ]
    .filter((entry) => typeof entry === "string")
    .join(" ")
    .toLowerCase();

  if (/\b(model|llm|completion|inference|embedding)\b/.test(hintText)) {
    return "model-call";
  }

  if (/\b(external|provider|connector|webhook|tool)\b/.test(hintText)) {
    return "external-system";
  }

  if (/\b(interrupt|cancel|abort|operator-stop)\b/.test(hintText)) {
    return "operator-interrupt";
  }

  return "default";
}

function normalizeCapabilityRateProfile(request, input, serviceContract) {
  const capabilityRateClass = resolveCapabilityRateClass(request, input, serviceContract);
  const policy = CAPABILITY_RATE_CLASS_POLICIES[capabilityRateClass] || CAPABILITY_RATE_CLASS_POLICIES.default;
  const requestedWeight = asPositiveInteger(request.classWeight || request.costWeight, policy.classWeight);
  const classWeight = Math.max(1, Math.min(10, requestedWeight));
  const rawCost = asPositiveInteger(request.cost || request.requestCost || request.units, 1);
  const chargedCost = Math.max(1, rawCost * classWeight);
  const requestedBurstShare = typeof request.burstShare === "number" ? request.burstShare : policy.burstShare;
  const burstShare = Math.max(0, Math.min(1, requestedBurstShare));
  const requestedPressureThreshold = typeof request.pressureThreshold === "number"
    ? request.pressureThreshold
    : policy.pressureThreshold;
  const pressureThreshold = Math.max(0.5, Math.min(0.99, requestedPressureThreshold));

  return {
    schema: "rate-limit.capability-rate-profile.v1",
    capabilityRateClass,
    baseCost: rawCost,
    chargedCost,
    classWeight,
    burstShare,
    pressureThreshold,
    reservationStrategy: policy.reservationStrategy,
    emergencyBurstRequests: policy.emergencyBurstRequests,
    handoffRequired: policy.handoffRequired
  };
}

function emptyCapabilityClassLedger() {
  return Object.fromEntries(SUPPORTED_CAPABILITY_RATE_CLASSES.map((capabilityRateClass) => ([
    capabilityRateClass,
    {
      windowUsed: 0,
      reserved: 0,
      localPending: 0,
      accountedRequests: 0
    }
  ])));
}

function normalizeCapabilityClassLedgerEntry(entry) {
  if (Number.isInteger(entry) && entry >= 0) {
    return {
      windowUsed: entry,
      reserved: 0,
      localPending: 0,
      accountedRequests: entry
    };
  }

  const source = asObject(entry);
  const windowUsed = readNonNegativeInteger(source, ["windowUsed", "usedRequests", "used"], 0);
  const reserved = readNonNegativeInteger(source, ["reserved", "reservedRequests"], 0);
  const localPending = readNonNegativeInteger(source, ["localPending", "pendingRequests", "pending"], 0);
  const accountedRequests = asNonNegativeInteger(
    firstDefined(source.accountedRequests, source.totalRequests),
    windowUsed + reserved + localPending
  );

  return {
    windowUsed,
    reserved,
    localPending,
    accountedRequests
  };
}

function normalizeCapabilityClassLedger(rawLedger) {
  const classLedger = emptyCapabilityClassLedger();

  Object.entries(asObject(rawLedger)).forEach(([rawClass, entry]) => {
    const capabilityRateClass = normalizeCapabilityRateClassToken(rawClass);

    if (!SUPPORTED_CAPABILITY_RATE_CLASSES.includes(capabilityRateClass)) {
      return;
    }

    const normalizedEntry = normalizeCapabilityClassLedgerEntry(entry);
    classLedger[capabilityRateClass] = {
      windowUsed: classLedger[capabilityRateClass].windowUsed + normalizedEntry.windowUsed,
      reserved: classLedger[capabilityRateClass].reserved + normalizedEntry.reserved,
      localPending: classLedger[capabilityRateClass].localPending + normalizedEntry.localPending,
      accountedRequests: classLedger[capabilityRateClass].accountedRequests + normalizedEntry.accountedRequests
    };
  });

  return classLedger;
}

function buildLedgerReconciliation(observedTotals, durableTotals, capabilityClassLedger) {
  const observedAccountedRequests = observedTotals.windowUsed + observedTotals.reserved + observedTotals.localPending;
  const durableAccountedRequests = durableTotals.windowUsed + durableTotals.reserved + durableTotals.localPending;
  const classAccountedRequests = Object.values(capabilityClassLedger).reduce((total, entry) => (
    total + entry.accountedRequests
  ), 0);
  const deltas = {
    windowUsed: durableTotals.windowUsed - observedTotals.windowUsed,
    reserved: durableTotals.reserved - observedTotals.reserved,
    localPending: durableTotals.localPending - observedTotals.localPending,
    accountedRequests: durableAccountedRequests - observedAccountedRequests,
    capabilityClassAccountedRequests: classAccountedRequests - durableAccountedRequests
  };
  const driftReasons = [
    deltas.windowUsed !== 0 ? "ledger.window-used-drift" : null,
    deltas.reserved !== 0 ? "ledger.reserved-drift" : null,
    deltas.localPending !== 0 ? "ledger.local-pending-drift" : null,
    deltas.capabilityClassAccountedRequests !== 0 ? "ledger.capability-class-total-drift" : null
  ].filter(Boolean);
  const replayDirection = durableAccountedRequests > observedAccountedRequests
    ? "replay-durable-forward"
    : durableAccountedRequests < observedAccountedRequests
      ? "refresh-durable-from-snapshot"
      : classAccountedRequests !== durableAccountedRequests
        ? "rebuild-capability-class-ledger"
        : "none";

  return {
    schema: "rate-limit.ledger-reconciliation.v1",
    state: driftReasons.length ? "drift-detected" : "aligned",
    observed: {
      ...observedTotals,
      accountedRequests: observedAccountedRequests
    },
    durable: {
      ...durableTotals,
      accountedRequests: durableAccountedRequests
    },
    capabilityClassAccountedRequests: classAccountedRequests,
    deltas,
    replayDirection,
    driftReasons
  };
}

function capabilityRatePolicy(capabilityRateClass) {
  return CAPABILITY_RATE_CLASS_POLICIES[capabilityRateClass] || CAPABILITY_RATE_CLASS_POLICIES.default;
}

function capabilityClassWindowLimit(serviceContract, capabilityRateClass, effectiveMaxRequests = serviceContract.policy.maxRequests) {
  const hardLimit = Math.max(1, Math.min(serviceContract.policy.maxRequests, effectiveMaxRequests));

  if (capabilityRateClass === "default") {
    return hardLimit;
  }

  return Math.max(1, Math.min(hardLimit, Math.floor(hardLimit * capabilityRatePolicy(capabilityRateClass).burstShare)));
}

function buildProjectedCapabilityClassLedger(serviceContract, runtimeDecision, shouldAccountRequest, shouldReserveRequest) {
  const sourceLedger = normalizeCapabilityClassLedger(runtimeDecision.clientQuota.capabilityClassLedger);
  const activeClass = runtimeDecision.request.capabilityRateClass;
  const requestedCost = runtimeDecision.accounting.requestedCost;
  const classDeltas = {
    windowUsed: shouldAccountRequest ? requestedCost : 0,
    reserved: shouldReserveRequest ? requestedCost : 0,
    localPending: 0,
    accountedRequests: shouldAccountRequest || shouldReserveRequest ? requestedCost : 0
  };
  const byClass = Object.fromEntries(SUPPORTED_CAPABILITY_RATE_CLASSES.map((capabilityRateClass) => {
    const current = sourceLedger[capabilityRateClass] || normalizeCapabilityClassLedgerEntry(null);
    const delta = capabilityRateClass === activeClass
      ? classDeltas
      : {
          windowUsed: 0,
          reserved: 0,
          localPending: 0,
          accountedRequests: 0
        };
    const projected = {
      windowUsed: current.windowUsed + delta.windowUsed,
      reserved: current.reserved + delta.reserved,
      localPending: current.localPending + delta.localPending,
      accountedRequests: current.accountedRequests + delta.accountedRequests
    };
    const classWindowLimit = capabilityClassWindowLimit(
      serviceContract,
      capabilityRateClass,
      runtimeDecision.accounting.hardLimit
    );
    const remainingAfterRequest = Math.max(0, classWindowLimit - projected.accountedRequests);
    const overflowUnits = Math.max(0, projected.accountedRequests - classWindowLimit);
    const pressureRatio = classWindowLimit > 0
      ? Number((projected.accountedRequests / classWindowLimit).toFixed(4))
      : 1;

    return [
      capabilityRateClass,
      {
        capabilityRateClass,
        classWindowLimit,
        current,
        delta,
        projected,
        remainingAfterRequest,
        overflowUnits,
        pressureRatio,
        state: overflowUnits
          ? "over-limit"
          : pressureRatio >= capabilityRatePolicy(capabilityRateClass).pressureThreshold
            ? "pressure"
            : "within-limit"
      }
    ];
  }));
  const activeProjection = byClass[activeClass] || byClass.default;
  const overLimitClasses = Object.values(byClass).filter((entry) => entry.overflowUnits > 0);

  return {
    schema: "rate-limit.projected-capability-class-ledger.v1",
    activeClass,
    operation: shouldReserveRequest
      ? "reserve"
      : shouldAccountRequest
        ? "account-local-dispatch"
        : "observe-only",
    requestedCost,
    byClass,
    activeProjection,
    overLimitClasses: overLimitClasses.map((entry) => ({
      capabilityRateClass: entry.capabilityRateClass,
      overflowUnits: entry.overflowUnits,
      classWindowLimit: entry.classWindowLimit,
      projectedAccountedRequests: entry.projected.accountedRequests
    })),
    totalProjectedAccountedRequests: Object.values(byClass).reduce((total, entry) => (
      total + entry.projected.accountedRequests
    ), 0)
  };
}

function minLaneUnits(maxRequests, share) {
  return Math.max(1, Math.min(maxRequests, Math.floor(maxRequests * share)));
}

function buildCapabilityLanePlan(serviceContract, quotaState, requestState) {
  const hardLimit = Math.min(serviceContract.policy.maxRequests, quotaState.observedMaxRequests);
  const classLedger = quotaState.capabilityClassLedger || emptyCapabilityClassLedger();
  const protectedClasses = ["model-call", "external-system", "operator-interrupt"];
  const laneWeights = {
    "model-call": 0.45,
    "external-system": 0.25,
    "operator-interrupt": 0.05
  };
  const protectedLaneMinimums = {
    "model-call": minLaneUnits(hardLimit, laneWeights["model-call"]),
    "external-system": minLaneUnits(hardLimit, laneWeights["external-system"]),
    "operator-interrupt": Math.min(
      hardLimit,
      Math.max(1, CAPABILITY_RATE_CLASS_POLICIES["operator-interrupt"].emergencyBurstRequests)
    )
  };
  const protectedLaneTotal = Math.min(
    hardLimit,
    Object.values(protectedLaneMinimums).reduce((total, units) => total + units, 0)
  );
  const sharedPoolCapacity = Math.max(0, hardLimit - protectedLaneTotal);
  const laneMinimums = {
    default: sharedPoolCapacity,
    ...protectedLaneMinimums
  };
  const laneEntries = SUPPORTED_CAPABILITY_RATE_CLASSES.map((capabilityRateClass) => {
    const ledgerEntry = classLedger[capabilityRateClass] || normalizeCapabilityClassLedgerEntry(null);
    const accountedRequests = Math.max(0, ledgerEntry.accountedRequests);
    const minimumUnits = Math.min(hardLimit, laneMinimums[capabilityRateClass] || 0);
    const pressureRatio = minimumUnits > 0
      ? Number((accountedRequests / minimumUnits).toFixed(4))
      : 1;

    return {
      capabilityRateClass,
      minimumUnits,
      accountedRequests,
      remainingUnits: Math.max(0, minimumUnits - accountedRequests),
      protected: protectedClasses.includes(capabilityRateClass),
      pressureRatio,
      state: accountedRequests >= minimumUnits ? "exhausted" : "available"
    };
  });
  const requestedLane = laneEntries.find((entry) => (
    entry.capabilityRateClass === requestState.capabilityRateClass
  )) || laneEntries[0];
  const defaultLane = laneEntries.find((entry) => entry.capabilityRateClass === "default");
  const protectedOverflowUsed = laneEntries
    .filter((entry) => entry.protected)
    .reduce((total, entry) => total + Math.max(0, entry.accountedRequests - entry.minimumUnits), 0);
  const sharedPoolUsed = Math.max(0, (defaultLane?.accountedRequests || 0) + protectedOverflowUsed);
  const sharedPoolRemaining = Math.max(0, sharedPoolCapacity - sharedPoolUsed);
  const canUseSharedPool = requestedLane.protected;
  const laneRemainingBeforeRequest = requestedLane.protected
    ? requestedLane.remainingUnits + sharedPoolRemaining
    : sharedPoolRemaining;
  const laneDeficit = Math.max(0, requestState.cost - laneRemainingBeforeRequest);

  return {
    schema: "rate-limit.capability-lane-plan.v1",
    hardLimit,
    requestedClass: requestState.capabilityRateClass,
    requestedCost: requestState.cost,
    lanes: laneEntries,
    requestedLane,
    protectedLaneTotal: Math.min(hardLimit, protectedLaneTotal),
    sharedPoolCapacity,
    sharedPoolUsed,
    sharedPoolRemaining,
    canUseSharedPool,
    laneRemainingBeforeRequest,
    laneRemainingAfterRequest: Math.max(0, laneRemainingBeforeRequest - requestState.cost),
    laneDeficit,
    laneSatisfied: laneDeficit === 0,
    state: laneDeficit ? "lane-exhausted" : requestedLane.state
  };
}

function buildCapabilityEmergencyAdmission(requestState, rateProfile, budgetState) {
  const emergencyBurstLimit = Math.max(0, asNonNegativeInteger(rateProfile.emergencyBurstRequests, 0));
  const eligible = rateProfile.reservationStrategy === "local-emergency"
    && requestState.capabilityRateClass === "operator-interrupt"
    && requestState.priority === "critical"
    && emergencyBurstLimit > 0;
  const windowDeficit = Math.max(0, requestState.cost - budgetState.remainingBeforeRequest);
  const classDeficit = Math.max(0, requestState.cost - budgetState.classRemainingBeforeRequest);
  const laneDeficit = Math.max(0, requestState.cost - budgetState.laneRemainingBeforeRequest);
  const unitsRequired = Math.max(windowDeficit, classDeficit, laneDeficit);
  const allowed = eligible && unitsRequired > 0 && unitsRequired <= emergencyBurstLimit;
  const withinNormalBudget = windowDeficit === 0 && classDeficit === 0 && laneDeficit === 0;

  return {
    schema: "rate-limit.emergency-admission.v1",
    eligible,
    allowed,
    withinNormalBudget,
    capabilityRateClass: requestState.capabilityRateClass,
    priority: requestState.priority,
    strategy: rateProfile.reservationStrategy,
    limit: emergencyBurstLimit,
    unitsRequired,
    unitsGranted: allowed ? unitsRequired : 0,
    deficits: {
      window: windowDeficit,
      capabilityClass: classDeficit,
      capabilityLane: laneDeficit
    },
    remainingEmergencyUnits: allowed
      ? Math.max(0, emergencyBurstLimit - unitsRequired)
      : emergencyBurstLimit,
    state: !eligible
      ? "not-eligible"
      : withinNormalBudget
        ? "not-needed"
        : allowed
          ? "granted"
          : "exhausted",
    reasonCodes: [
      !eligible ? "emergency.not-eligible" : null,
      windowDeficit ? "emergency.window-deficit" : null,
      classDeficit ? "emergency.class-deficit" : null,
      laneDeficit ? "emergency.lane-deficit" : null,
      eligible && unitsRequired > emergencyBurstLimit ? "emergency.limit-exceeded" : null
    ].filter(Boolean)
  };
}

function buildCapabilityAdmissionPacket(requestState, rateProfile, budgetState, lanePlan, options = {}) {
  const providerReservationAvailable = asBoolean(options.providerReservationAvailable, false);
  const externalHandoffNegotiated = asBoolean(options.externalHandoffNegotiated, false);
  const externalHandoffReady = asBoolean(options.externalHandoffReady, externalHandoffNegotiated);
  const externalHandoffState = asIdentifier(options.externalHandoffState, externalHandoffReady ? "ready" : "not-negotiated");
  const externalHandoffReasonCodes = asIdentifierList(options.externalHandoffReasonCodes);
  const windowDeficit = Math.max(0, requestState.cost - budgetState.remainingBeforeRequest);
  const classDeficit = Math.max(0, requestState.cost - budgetState.classRemainingBeforeRequest);
  const laneDeficit = Math.max(0, requestState.cost - budgetState.laneRemainingBeforeRequest);
  const emergencyAdmission = buildCapabilityEmergencyAdmission(requestState, rateProfile, budgetState);
  const handoffBlocked = rateProfile.handoffRequired && !externalHandoffReady;
  const reservationUsable = providerReservationAvailable && requestState.expectsReservation;
  const pressureState = budgetState.classPressure || lanePlan.state === "exhausted"
    ? "elevated"
    : "normal";
  const path = requestState.capabilityRateClass === "operator-interrupt"
    ? emergencyAdmission.allowed
      ? "local-emergency"
      : "local-proof"
      : rateProfile.handoffRequired
        ? handoffBlocked
        ? externalHandoffNegotiated ? "blocked-external-sync-handoff" : "blocked-external-handoff"
        : reservationUsable
          ? "provider-reservation-handoff"
          : "external-handoff-local-proof"
      : rateProfile.reservationStrategy === "prefer-provider-reservation" && reservationUsable
        ? "provider-reservation"
        : "local-proof";
  const action = handoffBlocked
    ? externalHandoffNegotiated ? "sync-external-handoff" : "negotiate-external-handoff"
    : emergencyAdmission.allowed
      ? "admit-emergency-interrupt"
      : windowDeficit || classDeficit || laneDeficit
        ? "wait-for-capability-budget"
        : path.includes("reservation")
          ? "reserve-before-dispatch"
          : "account-local-dispatch";

  return {
    schema: "rate-limit.capability-admission-packet.v1",
    capabilityRateClass: requestState.capabilityRateClass,
    path,
    action,
    cost: requestState.cost,
    baseCost: requestState.baseCost,
    classWeight: rateProfile.classWeight,
    reservationStrategy: rateProfile.reservationStrategy,
    pressureState,
    limits: {
      windowRemaining: budgetState.remainingBeforeRequest,
      classRemaining: budgetState.classRemainingBeforeRequest,
      laneRemaining: budgetState.laneRemainingBeforeRequest,
      pressureThreshold: rateProfile.pressureThreshold
    },
    requirements: {
      providerReservation: path.includes("reservation"),
      externalHandoff: rateProfile.handoffRequired,
      emergencyAdmission: requestState.capabilityRateClass === "operator-interrupt",
      auditProof: true
    },
    deficits: {
      window: windowDeficit,
      capabilityClass: classDeficit,
      capabilityLane: laneDeficit
    },
    negotiated: {
      providerReservationAvailable,
      externalHandoffNegotiated,
      externalHandoffReady,
      externalHandoffState
    },
    emergencyAdmission,
    reasonCodes: [
      rateProfile.handoffRequired ? "capability.external-handoff-required" : null,
      handoffBlocked && !externalHandoffNegotiated ? "capability.external-handoff-not-negotiated" : null,
      handoffBlocked && externalHandoffNegotiated ? "capability.external-handoff-sync-not-ready" : null,
      ...externalHandoffReasonCodes.map((reasonCode) => `capability.${reasonCode}`),
      path.includes("reservation") ? "capability.provider-reservation-path" : null,
      emergencyAdmission.allowed ? "capability.operator-interrupt-emergency-admitted" : null,
      emergencyAdmission.state === "exhausted" ? "capability.operator-interrupt-emergency-exhausted" : null,
      windowDeficit ? "capability.window-deficit" : null,
      classDeficit ? "capability.class-deficit" : null,
      laneDeficit ? "capability.lane-deficit" : null,
      pressureState === "elevated" ? "capability.pressure-elevated" : null
    ].filter(Boolean)
  };
}

function buildCapabilityExternalHandoffWorkflow(syncMetadata, syncLease, requestState, required, negotiated, handoffReady, blockerCodes) {
  const leaseState = asIdentifier(syncLease.lease?.state, "missing");
  const handoffState = asIdentifier(syncLease.handoffState, "not-negotiated");
  const cursorState = asIdentifier(syncLease.providerWatermark?.state, "unseen");
  const acknowledgementState = asIdentifier(syncLease.capabilityAcknowledgement?.state, "incomplete");
  const leaseExpiresInMs = asNonNegativeInteger(syncLease.lease?.expiresInMs, 0);
  const blocking = required && !handoffReady;
  const nextActionId = !required
    ? "observe.rate-limit.local-proof"
    : handoffReady
      ? "deliver.rate-limit.external-handoff"
      : !negotiated
        ? "negotiate.rate-limit.external-handoff"
        : leaseState === "foreign-owner"
          ? "wait.rate-limit.provider-sync-lease"
          : leaseState === "expired" || leaseState === "missing"
            ? "lease.rate-limit.provider-sync"
            : acknowledgementState !== "complete"
              ? "ack.rate-limit.provider-capabilities"
              : cursorState === "behind"
                ? "sync.rate-limit.provider-cursor"
                : syncLease.providerWatermark.clockState === "skewed"
                  ? "retry.rate-limit.provider-clock"
                  : "sync.rate-limit.external-handoff";
  const owner = nextActionId.startsWith("negotiate.")
    || nextActionId.startsWith("lease.")
    || nextActionId.startsWith("sync.")
    || nextActionId.startsWith("ack.")
    || nextActionId.startsWith("retry.")
    ? "kernel"
    : nextActionId.startsWith("wait.")
      ? "provider"
      : "client";
  const retryAfterMs = nextActionId === "wait.rate-limit.provider-sync-lease"
    ? leaseExpiresInMs || syncMetadata.nextRefreshAfterMs
    : nextActionId.startsWith("retry.")
      ? syncMetadata.nextRefreshAfterMs
      : 0;
  const clientDisposition = !required
    ? "local-proof-ok"
    : handoffReady
      ? "handoff-ready"
      : "hold-before-dispatch";
  const checkpointPolicy = blocking
    ? "persist-handoff-checkpoint-before-retry"
    : handoffReady
      ? "checkpoint-provider-delivery"
      : "checkpoint-local-proof";
  const reasonCodes = [
    required ? "handoff.required-for-capability-class" : "handoff.not-required",
    blocking ? "handoff.workflow-blocking" : null,
    handoffReady ? "handoff.ready" : null,
    ...blockerCodes
  ].filter(Boolean);

  return {
    schema: "rate-limit.capability-handoff-workflow.v1",
    state: !required
      ? "not-required"
      : handoffReady
        ? "ready"
        : "blocked",
    blocking,
    required,
    requestId: requestState.requestId,
    clientId: requestState.clientId,
    workflowId: requestState.workflowId,
    capabilityRateClass: requestState.capabilityRateClass,
    nextActionId,
    owner,
    retryAfterMs,
    clientDisposition,
    resumePolicy: blocking ? "resume-after-handoff-action" : "resume-immediately",
    checkpointPolicy,
    payloadRequired: required,
    payloadCursor: syncMetadata.cursor,
    leaseState,
    handoffState,
    cursorState,
    acknowledgementState,
    reasonCodes
  };
}

function buildCapabilityExternalHandoffContract(serviceContract, providerContract, negotiation, syncMetadata, requestState, rateProfile) {
  const required = rateProfile.handoffRequired === true;
  const negotiated = negotiation.accepted.includes("rate-limit.external-handoff.v1");
  const syncLease = syncMetadata.providerSyncLease;
  const leaseWritable = syncLease.writeAllowed === true;
  const handoffState = asIdentifier(syncLease.handoffState, "not-negotiated");
  const cursorState = asIdentifier(syncLease.providerWatermark?.state, "unseen");
  const capabilityAckState = asIdentifier(syncLease.capabilityAcknowledgement?.state, "incomplete");
  const handoffReady = !required || (
    negotiated
    && leaseWritable
    && capabilityAckState === "complete"
    && ["ready-to-handoff", "provider-current"].includes(handoffState)
  );
  const blockerCodes = [
    required && !negotiated ? "external-handoff.capability-not-negotiated" : null,
    required && negotiated && !leaseWritable ? "external-handoff.sync-lease-not-writable" : null,
    required && capabilityAckState !== "complete" ? "external-handoff.capability-ack-incomplete" : null,
    required && cursorState === "behind" ? "external-handoff.provider-cursor-behind" : null,
    required && syncLease.lease.state === "foreign-owner" ? "external-handoff.lease-foreign-owner" : null,
    required && syncLease.lease.state === "expired" ? "external-handoff.lease-expired" : null,
    required && syncLease.providerWatermark.clockState === "skewed" ? "external-handoff.provider-clock-skew" : null
  ].filter(Boolean);
  const state = !required
    ? "not-required"
    : handoffReady
      ? "ready"
      : !negotiated
        ? "negotiation-required"
        : syncLease.lease.state === "foreign-owner"
          ? "blocked-by-foreign-lease"
          : leaseWritable
            ? "awaiting-provider-cursor"
            : "awaiting-sync-lease";
  const workflow = buildCapabilityExternalHandoffWorkflow(
    syncMetadata,
    syncLease,
    requestState,
    required,
    negotiated,
    handoffReady,
    blockerCodes
  );

  return {
    schema: "rate-limit.capability-external-handoff-contract.v1",
    required,
    ready: handoffReady,
    state,
    providerId: providerContract.providerId,
    serviceId: serviceContract.serviceId,
    subjectKey: serviceContract.subjectKey,
    requestId: requestState.requestId,
    capabilityRateClass: requestState.capabilityRateClass,
    syncKey: syncMetadata.syncKey,
    cursor: syncMetadata.cursor,
    endpoint: providerContract.endpoint,
    negotiated,
    leaseWritable,
    handoffState,
    cursorState,
    capabilityAcknowledgementState: capabilityAckState,
    lease: {
      leaseId: syncLease.lease.leaseId,
      state: syncLease.lease.state,
      owner: syncLease.lease.owner,
      expectedOwner: syncLease.lease.expectedOwner,
      expiresInMs: syncLease.lease.expiresInMs
    },
    providerWatermark: syncLease.providerWatermark,
    workflow,
    reasonCodes: [...new Set([...blockerCodes, ...syncLease.reasonCodes])]
  };
}

function normalizeRequestState(input = {}, serviceContract) {
  const request = asObject(input.request || input.requestState);
  const rateProfile = normalizeCapabilityRateProfile(request, input, serviceContract);
  const priority = ["background", "interactive", "critical"].includes(request.priority)
    ? request.priority
    : rateProfile.capabilityRateClass === "operator-interrupt"
      ? "critical"
      : "interactive";

  return {
    requestId: asIdentifier(request.requestId || request.id, "current-request"),
    routeId: asIdentifier(request.routeId || request.route, "capability-route"),
    clientId: asIdentifier(request.clientId || input.clientId, "default-client"),
    tenantId: asIdentifier(request.tenantId || input.tenantId, null),
    workspaceId: asIdentifier(request.workspaceId || input.workspaceId, null),
    cost: rateProfile.chargedCost,
    baseCost: rateProfile.baseCost,
    capabilityRateClass: rateProfile.capabilityRateClass,
    rateProfile,
    priority,
    expectsReservation: request.expectsReservation !== false,
    workflowId: asIdentifier(request.workflowId, "rate-limit-workflow")
  };
}

function normalizeClientQuotaState(input = {}, serviceContract) {
  const state = asObject(input.clientState || input.quotaState || input.runtimeState);
  const windowUsed = readNonNegativeInteger(state, ["windowUsed", "usedRequests"], 0);
  const reserved = readNonNegativeInteger(state, ["reserved", "reservedRequests"], 0);
  const localPending = readNonNegativeInteger(state, ["localPending", "pendingRequests"], 0);
  const observedMax = asPositiveInteger(state.observedMaxRequests, serviceContract.policy.maxRequests);
  const effectiveMax = Math.min(serviceContract.policy.maxRequests, observedMax);
  const resetAt = asIdentifier(state.resetAt, null);
  const snapshotId = asIdentifier(state.snapshotId, `${serviceContract.subjectKey}:local`);
  const classLedger = normalizeCapabilityClassLedger(
    state.capabilityClassLedger || state.classLedger || state.classUsage || input.capabilityClassLedger || input.classLedger
  );

  return {
    schema: "rate-limit.client-quota-state.v1",
    snapshotId,
    resetAt,
    windowUsed,
    reserved,
    localPending,
    observedMaxRequests: effectiveMax,
    accountedRequests: windowUsed + reserved + localPending,
    capabilityClassLedger: classLedger
  };
}

function normalizePersistedRateLimitState(input = {}, serviceContract, quotaState) {
  const persisted = asObject(input.persistedState || input.rateLimitState || input.recoveredState);
  const ledger = asObject(persisted.ledger);
  const reservations = Array.isArray(persisted.reservations) ? persisted.reservations : [];
  const appliedRequestIds = Array.isArray(persisted.appliedRequestIds) ? persisted.appliedRequestIds : [];
  const appliedCommandKeys = Array.isArray(persisted.appliedCommandKeys) ? persisted.appliedCommandKeys : [];
  const commandJournal = Array.isArray(persisted.commandJournal || persisted.commands)
    ? persisted.commandJournal || persisted.commands
    : [];
  const commandSequence = asPositiveInteger(persisted.commandSequence, 0);
  const restartCount = asPositiveInteger(persisted.restartCount || input.restartCount, 0);
  const lastSnapshotId = asIdentifier(
    persisted.lastSnapshotId || persisted.snapshotId,
    quotaState.snapshotId
  );
  const persistedSubjectKey = asIdentifier(persisted.subjectKey, serviceContract.subjectKey);
  const cursor = asIdentifier(persisted.cursor, `${persistedSubjectKey}:cold-start`);
  const normalizedReservations = reservations
    .filter((reservation) => reservation && typeof reservation === "object")
    .map((reservation, index) => ({
      reservationId: asIdentifier(reservation.reservationId || reservation.id, `${lastSnapshotId}:reservation:${index + 1}`),
      requestId: asIdentifier(reservation.requestId, "unknown-request"),
      units: asPositiveInteger(reservation.units || reservation.cost, 1),
      status: ["pending", "applied", "released"].includes(reservation.status)
        ? reservation.status
        : "pending",
      commandKey: asIdentifier(reservation.commandKey, null)
    }));
  const pendingReservations = normalizedReservations.filter((reservation) => reservation.status === "pending");
  const normalizedCommandJournal = commandJournal
    .filter((entry) => entry && typeof entry === "object")
    .slice(-100)
    .map((entry, index) => ({
      commandId: asIdentifier(entry.commandId || entry.id, `${lastSnapshotId}:command:${index + 1}`),
      idempotencyKey: asIdentifier(entry.idempotencyKey || entry.commandKey, null),
      type: asIdentifier(entry.type, "rate-limit.command.v1"),
      state: ["pending", "applied", "failed", "compensated"].includes(entry.state)
        ? entry.state
        : "applied",
      requestId: asIdentifier(entry.requestId, null),
      sequence: asNonNegativeInteger(entry.sequence, index + 1),
      cursor: asIdentifier(entry.cursor, cursor),
      appliedAt: asIdentifier(entry.appliedAt || entry.observedAt, null)
    }));
  const durableAppliedCommandKeys = [
    ...appliedCommandKeys,
    ...normalizedCommandJournal
      .filter((entry) => entry.state === "applied" && entry.idempotencyKey)
      .map((entry) => entry.idempotencyKey)
  ]
    .filter((key) => typeof key === "string" && key.trim())
    .map((key) => key.trim());
  const durableTotals = {
    windowUsed: readNonNegativeInteger(ledger, ["windowUsed", "usedRequests", "used"], quotaState.windowUsed),
    reserved: readNonNegativeInteger(ledger, ["reserved", "reservedRequests"], quotaState.reserved),
    localPending: readNonNegativeInteger(ledger, ["localPending", "pendingRequests", "pending"], quotaState.localPending)
  };
  const ledgerReconciliation = buildLedgerReconciliation(
    {
      windowUsed: quotaState.windowUsed,
      reserved: quotaState.reserved,
      localPending: quotaState.localPending
    },
    durableTotals,
    quotaState.capabilityClassLedger
  );

  return {
    schema: "rate-limit.persisted-state.v1",
    stateKey: `${surfaceId}:${serviceContract.subjectKey}:persisted`,
    subjectKey: persistedSubjectKey,
    isSubjectMatch: persistedSubjectKey === serviceContract.subjectKey,
    cursor,
    lastSnapshotId,
    commandSequence,
    restartCount,
    recoveredAt: asIdentifier(persisted.recoveredAt || input.now, null),
    durableTotals,
    ledgerReconciliation,
    reservations: normalizedReservations,
    pendingReservationCount: pendingReservations.length,
    pendingReservedUnits: pendingReservations.reduce((total, reservation) => total + reservation.units, 0),
    appliedRequestIds: appliedRequestIds
      .filter((requestId) => typeof requestId === "string" && requestId.trim())
      .map((requestId) => requestId.trim())
      .slice(-100),
    commandJournal: normalizedCommandJournal,
    appliedCommandKeys: [...new Set(durableAppliedCommandKeys)].slice(-100)
  };
}

function buildRecoveryPlan(now, serviceContract, syncMetadata, quotaState, persistedState) {
  const needsSubjectReset = !persistedState.isSubjectMatch;
  const needsSnapshotRefresh = persistedState.lastSnapshotId !== quotaState.snapshotId;
  const needsReservationReplay = persistedState.pendingReservationCount > 0;
  const needsLedgerReconciliation = persistedState.ledgerReconciliation.state === "drift-detected";
  const recoveryActions = [];

  if (needsSubjectReset) {
    recoveryActions.push({
      actionId: "recover.rate-limit.subject-reset",
      priority: "required",
      idempotencyKey: `${persistedState.stateKey}:subject-reset:${serviceContract.subjectKey}`,
      reasonCode: "persisted.subject-mismatch"
    });
  }

  if (needsSnapshotRefresh) {
    recoveryActions.push({
      actionId: "recover.rate-limit.snapshot-refresh",
      priority: needsSubjectReset ? "required" : "recommended",
      idempotencyKey: `${persistedState.stateKey}:snapshot:${quotaState.snapshotId}`,
      reasonCode: "persisted.snapshot-drift",
      expectedSnapshotId: quotaState.snapshotId
    });
  }

  if (needsReservationReplay) {
    recoveryActions.push({
      actionId: "recover.rate-limit.reservation-replay",
      priority: "required",
      idempotencyKey: `${persistedState.stateKey}:replay:${persistedState.cursor}`,
      reasonCode: "persisted.pending-reservations",
      pendingReservationCount: persistedState.pendingReservationCount,
      pendingReservedUnits: persistedState.pendingReservedUnits
    });
  }

  if (needsLedgerReconciliation) {
    recoveryActions.push({
      actionId: "recover.rate-limit.ledger-reconcile",
      priority: persistedState.ledgerReconciliation.replayDirection === "rebuild-capability-class-ledger"
        ? "recommended"
        : "required",
      idempotencyKey: `${persistedState.stateKey}:ledger:${persistedState.cursor}`,
      reasonCode: "persisted.ledger-drift",
      replayDirection: persistedState.ledgerReconciliation.replayDirection,
      driftReasons: persistedState.ledgerReconciliation.driftReasons,
      deltas: persistedState.ledgerReconciliation.deltas
    });
  }

  return {
    schema: "rate-limit.recovery-plan.v1",
    generatedAt: now,
    state: recoveryActions.some((action) => action.priority === "required") ? "recovery-required" : "clean",
    restartSafe: !needsSubjectReset,
    syncKey: syncMetadata.syncKey,
    cursor: persistedState.cursor,
    durableCursor: `${serviceContract.subjectKey}#${persistedState.commandSequence}`,
    ledgerReconciliation: persistedState.ledgerReconciliation,
    actions: recoveryActions
  };
}

function normalizeProviderContract(inputProvider = {}) {
  const provider = asObject(inputProvider);
  const providerId = asIdentifier(provider.providerId || provider.id, "hosted-kernel-rate-limit-provider");
  const endpoint = asIdentifier(provider.endpoint, `kernel://${surfaceGroup}/${surfaceName}/${providerId}`);
  const advertised = Array.isArray(provider.capabilities) ? provider.capabilities : SUPPORTED_PROVIDER_CAPABILITIES;
  const capabilities = advertised.filter((capability) => SUPPORTED_PROVIDER_CAPABILITIES.includes(capability));
  const requestedHealth = asIdentifier(provider.health || provider.status, "ready");
  const health = ["ready", "degraded", "offline", "failed"].includes(requestedHealth)
    ? requestedHealth
    : "degraded";

  return {
    providerId,
    endpoint,
    contractVersion: asPositiveInteger(provider.contractVersion, 1),
    capabilities: capabilities.length ? capabilities : ["rate-limit.snapshot.v1"],
    health
  };
}

function normalizeFailureState(input = {}, providerContract) {
  const operational = asObject(input.operationalHealth || input.health || input.providerHealth);
  const failure = asObject(input.failureState || operational.failure || input.lastFailure);
  const retry = asObject(input.retryPolicy || operational.retryPolicy);
  const lastError = asIdentifier(
    failure.errorCode || failure.code || operational.errorCode,
    providerContract.health === "ready" ? null : "provider.health.not-ready"
  );
  const failedOperation = asIdentifier(
    failure.operation || operational.operation,
    providerContract.health === "ready" ? null : "rate-limit.snapshot"
  );
  const consecutiveFailures = Math.max(0, asPositiveInteger(
    failure.consecutiveFailures || operational.consecutiveFailures,
    providerContract.health === "ready" ? 0 : 1
  ));
  const baseBackoffMs = Math.max(250, asPositiveInteger(retry.baseBackoffMs, 1_000));
  const maxBackoffMs = Math.max(baseBackoffMs, asPositiveInteger(retry.maxBackoffMs, 30_000));
  const attempt = Math.max(0, consecutiveFailures);
  const exponentialDelay = baseBackoffMs * (2 ** Math.min(attempt, 6));
  const retryAfterMs = providerContract.health === "ready"
    ? 0
    : Math.min(maxBackoffMs, exponentialDelay);
  const severity = providerContract.health === "failed" || providerContract.health === "offline"
    ? "blocking"
    : providerContract.health === "degraded" || consecutiveFailures > 0
      ? "degraded"
      : "healthy";

  return {
    schema: "rate-limit.failure-state.v1",
    providerId: providerContract.providerId,
    state: severity === "healthy" ? "clear" : "active",
    severity,
    errorCode: lastError,
    operation: failedOperation,
    message: asIdentifier(failure.message || operational.message, null),
    consecutiveFailures,
    lastFailureAt: asIdentifier(failure.lastFailureAt || operational.lastFailureAt, null),
    retry: {
      strategy: retry.strategy === "fixed" ? "fixed" : "exponential-backoff",
      retryable: severity !== "healthy" && failure.retryable !== false,
      baseBackoffMs,
      maxBackoffMs,
      retryAfterMs,
      nextAttemptAfter: retryAfterMs
        ? asIdentifier(failure.nextAttemptAfter || operational.nextAttemptAfter, null)
        : null
    }
  };
}

function buildOperationalHealth(providerContract, serviceContract, negotiation, syncMetadata, quotaState, failureState) {
  const capabilityBlocked = negotiation.missingRequired.length > 0;
  const providerUnavailable = providerContract.health === "offline" || providerContract.health === "failed";
  const localProofUsable = quotaState.accountedRequests <= serviceContract.policy.maxRequests
    && providerContract.capabilities.includes("rate-limit.snapshot.v1");
  const degradedMode = providerUnavailable
    ? "deny-new-reservations"
    : providerContract.health === "degraded" || failureState.state === "active" || negotiation.status !== "accepted"
      ? "local-proof-only"
      : "live-reservation";
  const state = capabilityBlocked || providerUnavailable
    ? "unhealthy"
    : degradedMode === "local-proof-only"
      ? "degraded"
      : "healthy";

  return {
    schema: "rate-limit.operational-health.v1",
    state,
    degradedMode,
    providerId: providerContract.providerId,
    subjectKey: serviceContract.subjectKey,
    syncKey: syncMetadata.syncKey,
    failureState,
    localProofUsable,
    providerUnavailable,
    capabilityBlocked,
    missingCapabilities: negotiation.missingRequired,
    reservePath: degradedMode === "live-reservation" ? "provider" : "disabled",
    auditPath: providerContract.capabilities.includes("rate-limit.audit.v1") ? "provider-audit" : "local-audit-proof",
    retryAfterMs: failureState.retry.retryable ? failureState.retry.retryAfterMs : 0,
    signals: [
      providerContract.health !== "ready" ? `provider.${providerContract.health}` : null,
      capabilityBlocked ? "provider.missing-required-capability" : null,
      failureState.state === "active" ? failureState.errorCode : null,
      degradedMode !== "live-reservation" ? `degraded.${degradedMode}` : null
    ].filter(Boolean)
  };
}

function buildHealthAdmissionPolicy(operationalHealth, requestState, lifecycleControls) {
  const auditProofAvailable = lifecycleControls.auditEnabled && operationalHealth.auditPath !== "disabled";
  const degradedLocalProofAllowed = operationalHealth.localProofUsable
    && auditProofAvailable
    && lifecycleControls.enforcementEnabled
    && !operationalHealth.capabilityBlocked
    && requestState.capabilityRateClass !== "external-system";
  const providerUnavailable = operationalHealth.providerUnavailable || operationalHealth.state === "unhealthy";
  const reservationAllowed = operationalHealth.degradedMode === "live-reservation"
    && operationalHealth.reservePath === "provider"
    && !providerUnavailable
    && lifecycleControls.reservationsEnabled;
  const operatorInterruptBypass = requestState.capabilityRateClass === "operator-interrupt"
    && requestState.priority === "critical"
    && degradedLocalProofAllowed;
  const blocking = operationalHealth.capabilityBlocked
    || (providerUnavailable && !degradedLocalProofAllowed && !operatorInterruptBypass)
    || (!auditProofAvailable && operationalHealth.failureState.state === "active");
  const dispatchMode = blocking
    ? "hold-provider-health"
    : providerUnavailable || operationalHealth.degradedMode === "local-proof-only"
      ? "local-proof-degraded"
      : reservationAllowed
        ? "live-provider"
        : "local-proof";
  const nextActionId = operationalHealth.capabilityBlocked
    ? "contract.rate-limit.provider-capabilities"
    : providerUnavailable
      ? "retry.rate-limit.provider-operation"
      : !auditProofAvailable
        ? "enable.rate-limit.audit-proof"
        : operationalHealth.degradedMode === "deny-new-reservations"
          ? "degrade.rate-limit.local-proof"
          : "monitor.rate-limit.health";
  const retryAfterMs = blocking || providerUnavailable || operationalHealth.failureState.state === "active"
    ? operationalHealth.retryAfterMs
    : 0;
  const primaryCode = operationalHealth.capabilityBlocked
    ? "health.provider-capability-blocked"
    : providerUnavailable
      ? "health.provider-unavailable"
      : !auditProofAvailable
        ? "health.audit-proof-unavailable"
        : operationalHealth.failureState.errorCode
          ? `health.${operationalHealth.failureState.errorCode}`
          : null;
  const reasonCodes = [
    primaryCode,
    reservationAllowed ? "health.reservation-path-live" : "health.reservation-path-disabled",
    degradedLocalProofAllowed ? "health.degraded-local-proof-allowed" : null,
    operatorInterruptBypass ? "health.operator-interrupt-critical-bypass" : null,
    operationalHealth.degradedMode !== "live-reservation" ? `health.degraded-mode-${operationalHealth.degradedMode}` : null,
    ...operationalHealth.signals.map((signal) => `health.signal.${signal}`)
  ].filter(Boolean);

  return {
    schema: "rate-limit.health-admission-policy.v1",
    state: blocking ? "blocked" : dispatchMode === "live-provider" ? "open" : "degraded",
    blocking,
    dispatchMode,
    reservationAllowed,
    degradedLocalProofAllowed,
    operatorInterruptBypass,
    auditProofAvailable,
    providerUnavailable,
    retryAfterMs,
    nextActionId,
    reasonCodes,
    errorContract: primaryCode
      ? {
          schema: "rate-limit.health-admission-error.v1",
          code: primaryCode,
          severity: blocking ? "blocking" : "retryable",
          message: blocking
            ? "Provider health blocks rate-limit dispatch for this capability request"
            : "Provider health requires degraded local-proof handling before dispatch",
          actionId: nextActionId,
          retryable: retryAfterMs > 0,
          retryAfterMs,
          target: {
            requestId: requestState.requestId,
            routeId: requestState.routeId,
            capabilityRateClass: requestState.capabilityRateClass,
            degradedMode: operationalHealth.degradedMode,
            providerId: operationalHealth.providerId
          }
        }
      : null
  };
}

function normalizeServiceContract(inputService = {}, providerContract, input = {}) {
  const service = asObject(inputService);
  const serviceId = asIdentifier(service.serviceId || service.id, "hosted-kernel-service");
  const tenantId = asIdentifier(service.tenantId, "default-tenant");
  const workspaceId = asIdentifier(service.workspaceId || service.workspace, "default-workspace");
  const capabilityId = asIdentifier(service.capabilityId, "default-capability");
  const requestedWindowMs = asPositiveInteger(service.windowMs, DEFAULT_RATE_LIMIT_CONTRACT.windowMs);
  const requestedMax = asPositiveInteger(service.maxRequests, DEFAULT_RATE_LIMIT_CONTRACT.maxRequests);
  const requestedBurst = asPositiveInteger(service.burstRequests, DEFAULT_RATE_LIMIT_CONTRACT.burstRequests);
  const providerCanReserve = providerContract.capabilities.includes("rate-limit.reserve.v1");
  const externalProviderProfile = resolveExternalProviderProfile(input, providerContract, {
    serviceId,
    tenantId,
    workspaceId,
    capabilityId
  });
  const providerRequiredCapabilities = externalProviderProfile.requiredCapabilities.filter((capability) => (
    SUPPORTED_PROVIDER_CAPABILITIES.includes(capability)
  ));
  const missingProviderCapabilities = providerRequiredCapabilities.filter((capability) => (
    !providerContract.capabilities.includes(capability)
  ));
  const profileRequiresExternalHandoff = providerRequiredCapabilities.includes("rate-limit.external-handoff.v1");

  return {
    serviceId,
    tenantId,
    workspaceId,
    capabilityId,
    externalProviderProfile,
    policy: {
      ...DEFAULT_RATE_LIMIT_CONTRACT,
      windowMs: Math.max(1_000, requestedWindowMs),
      maxRequests: Math.max(1, requestedMax),
      burstRequests: Math.min(Math.max(0, requestedBurst), requestedMax),
      reservationMode: providerCanReserve ? "provider-reservation" : "snapshot-only",
      externalProviderProfile: externalProviderProfile.providerProfile,
      externalHandoffRequired: profileRequiresExternalHandoff,
      externalProviderRequiredCapabilities: providerRequiredCapabilities,
      externalProviderMissingCapabilities: missingProviderCapabilities
    },
    subjectKey: `${tenantId}:${workspaceId}:${capabilityId}:${serviceId}`
  };
}

function normalizeBoundaryGrants(input, boundary, principal, serviceContract, requestState, now) {
  const inputGrants = Array.isArray(input.workspaceGrants)
    ? input.workspaceGrants
    : Array.isArray(input.accessGrants)
      ? input.accessGrants
      : [];
  const rawGrants = Array.isArray(boundary.workspaceGrants)
    ? boundary.workspaceGrants
    : Array.isArray(boundary.grants)
      ? boundary.grants
      : Array.isArray(principal.workspaceGrants)
        ? principal.workspaceGrants
        : Array.isArray(principal.grants)
          ? principal.grants
          : inputGrants;
  const nowMs = Date.parse(now);

  return rawGrants
    .filter((grant) => grant && typeof grant === "object")
    .slice(-25)
    .map((grant, index) => {
      const scope = asObject(grant.scope);
      const tenantId = asIdentifier(grant.tenantId || scope.tenantId, serviceContract.tenantId);
      const workspaceId = asIdentifier(
        grant.workspaceId || grant.workspace || scope.workspaceId,
        serviceContract.workspaceId
      );
      const capabilityIds = asIdentifierList(grant.capabilityIds || grant.capabilities || scope.capabilityIds);
      const routeIds = asIdentifierList(grant.routeIds || grant.routes || scope.routeIds);
      const roles = asIdentifierList(grant.roles || grant.allowedRoles).filter((entry) => (
        SUPPORTED_BOUNDARY_ROLES.includes(entry)
      ));
      const permissions = asIdentifierList(grant.permissions || grant.grantedPermissions);
      const expiresAt = asIdentifier(grant.expiresAt || grant.validUntil, null);
      const expiresAtMs = asTimestampMs(expiresAt);
      const revoked = asBoolean(grant.revoked, false);
      const tenantMatches = tenantId === serviceContract.tenantId;
      const workspaceMatches = workspaceId === serviceContract.workspaceId;
      const requestTenantMatches = !requestState.tenantId || tenantId === requestState.tenantId;
      const requestWorkspaceMatches = !requestState.workspaceId || workspaceId === requestState.workspaceId;
      const capabilityMatches = capabilityIds.length === 0 || capabilityIds.includes(serviceContract.capabilityId);
      const routeMatches = routeIds.length === 0 || routeIds.includes(requestState.routeId);
      const active = !revoked && (!expiresAtMs || expiresAtMs > nowMs);

      return {
        grantId: asIdentifier(grant.grantId || grant.id, `${serviceContract.subjectKey}:grant:${index + 1}`),
        tenantId,
        workspaceId,
        capabilityIds,
        routeIds,
        roles,
        permissions,
        expiresAt,
        revoked,
        active,
        matches: {
          tenant: tenantMatches,
          workspace: workspaceMatches,
          requestTenant: requestTenantMatches,
          requestWorkspace: requestWorkspaceMatches,
          capability: capabilityMatches,
          route: routeMatches
        },
        state: active
          && tenantMatches
          && workspaceMatches
          && requestTenantMatches
          && requestWorkspaceMatches
          && capabilityMatches
          && routeMatches
          ? "eligible"
          : "not-eligible",
        reasonCodes: [
          revoked ? "grant.revoked" : null,
          expiresAtMs && expiresAtMs <= nowMs ? "grant.expired" : null,
          !tenantMatches ? "grant.tenant-mismatch" : null,
          !workspaceMatches ? "grant.workspace-mismatch" : null,
          !requestTenantMatches ? "grant.request-tenant-mismatch" : null,
          !requestWorkspaceMatches ? "grant.request-workspace-mismatch" : null,
          !capabilityMatches ? "grant.capability-mismatch" : null,
          !routeMatches ? "grant.route-mismatch" : null
        ].filter(Boolean)
      };
    });
}

function buildBoundaryRequestScope(boundary, principal, serviceContract, requestState) {
  const assertedTenantId = asIdentifier(
    boundary.tenantId || principal.tenantId || requestState.tenantId,
    serviceContract.tenantId
  );
  const assertedWorkspaceId = asIdentifier(
    boundary.workspaceId || boundary.workspace || principal.workspaceId || requestState.workspaceId,
    serviceContract.workspaceId
  );
  const requestTenantId = asIdentifier(requestState.tenantId, serviceContract.tenantId);
  const requestWorkspaceId = asIdentifier(requestState.workspaceId, serviceContract.workspaceId);
  const requestDeclaredTenant = Boolean(requestState.tenantId);
  const requestDeclaredWorkspace = Boolean(requestState.workspaceId);
  const assertedTenantMatchesService = assertedTenantId === serviceContract.tenantId;
  const assertedWorkspaceMatchesService = assertedWorkspaceId === serviceContract.workspaceId;
  const requestTenantMatchesService = requestTenantId === serviceContract.tenantId;
  const requestWorkspaceMatchesService = requestWorkspaceId === serviceContract.workspaceId;
  const requestTenantMatchesAssertion = requestTenantId === assertedTenantId;
  const requestWorkspaceMatchesAssertion = requestWorkspaceId === assertedWorkspaceId;
  const violations = [
    !assertedTenantMatchesService ? "tenant.mismatch" : null,
    !assertedWorkspaceMatchesService ? "workspace.mismatch" : null,
    requestDeclaredTenant && !requestTenantMatchesService ? "request.tenant-mismatch" : null,
    requestDeclaredWorkspace && !requestWorkspaceMatchesService ? "request.workspace-mismatch" : null,
    requestDeclaredTenant && !requestTenantMatchesAssertion ? "request.tenant-assertion-mismatch" : null,
    requestDeclaredWorkspace && !requestWorkspaceMatchesAssertion ? "request.workspace-assertion-mismatch" : null
  ].filter(Boolean);

  return {
    schema: "rate-limit.boundary-request-scope.v1",
    subjectKey: serviceContract.subjectKey,
    asserted: {
      tenantId: assertedTenantId,
      workspaceId: assertedWorkspaceId
    },
    request: {
      tenantId: requestTenantId,
      workspaceId: requestWorkspaceId,
      tenantDeclared: requestDeclaredTenant,
      workspaceDeclared: requestDeclaredWorkspace
    },
    expected: {
      tenantId: serviceContract.tenantId,
      workspaceId: serviceContract.workspaceId
    },
    matches: {
      assertedTenant: assertedTenantMatchesService,
      assertedWorkspace: assertedWorkspaceMatchesService,
      requestTenant: requestTenantMatchesService,
      requestWorkspace: requestWorkspaceMatchesService,
      requestTenantAssertion: requestTenantMatchesAssertion,
      requestWorkspaceAssertion: requestWorkspaceMatchesAssertion
    },
    satisfied: violations.length === 0,
    drift: violations.length > 0,
    violations
  };
}

function normalizeAccessBoundary(input = {}, serviceContract, requestState, now) {
  const boundary = asObject(input.accessBoundary || input.tenantBoundary || input.workspaceBoundary);
  const rawPrincipal = input.principal || input.actor || input.securityContext;
  const principal = asObject(rawPrincipal);
  const requestScope = buildBoundaryRequestScope(boundary, principal, serviceContract, requestState);
  const explicitGrantsRequired = asBoolean(boundary.requireExplicitWorkspaceGrant, false);
  const boundaryGrants = normalizeBoundaryGrants(input, boundary, principal, serviceContract, requestState, now);
  const eligibleGrants = boundaryGrants.filter((grant) => grant.state === "eligible");
  const boundaryRequiredPermissions = asIdentifierList(boundary.requiredPermissions);
  const requiredPermissions = boundaryRequiredPermissions.length
    ? boundaryRequiredPermissions
    : [DEFAULT_RATE_LIMIT_PERMISSION];
  const explicitGrantedPermissions = asIdentifierList(
    principal.permissions || input.permissions || boundary.grantedPermissions
  );
  const hasExplicitPrincipal = Boolean(
    rawPrincipal || input.permissions || input.role || boundary.role || boundary.grantedPermissions
  );
  const grantedPermissions = [
    ...(explicitGrantedPermissions.length || hasExplicitPrincipal ? explicitGrantedPermissions : requiredPermissions),
    ...eligibleGrants.flatMap((grant) => grant.permissions)
  ];
  const requestedRole = asIdentifier(principal.role || boundary.role || input.role, hasExplicitPrincipal ? "viewer" : "service");
  const role = SUPPORTED_BOUNDARY_ROLES.includes(requestedRole) ? requestedRole : "viewer";
  const allowedRoles = asIdentifierList(boundary.allowedRoles).filter((entry) => SUPPORTED_BOUNDARY_ROLES.includes(entry));
  const effectiveAllowedRoles = allowedRoles.length ? allowedRoles : ["operator", "admin", "service"];
  const tenantId = requestScope.asserted.tenantId;
  const workspaceId = requestScope.asserted.workspaceId;
  const allowedTenantIds = asIdentifierList(boundary.allowedTenantIds || boundary.tenantIds);
  const allowedWorkspaceIds = asIdentifierList(boundary.allowedWorkspaceIds || boundary.workspaceIds);
  const allowedCapabilityIds = asIdentifierList(boundary.allowedCapabilityIds || boundary.capabilityIds);
  const allowedRouteIds = asIdentifierList(boundary.allowedRouteIds || boundary.routeIds);
  const matchingRoleGrants = eligibleGrants.filter((grant) => (
    grant.roles.length === 0 || grant.roles.includes(role)
  ));
  const matchingPermissionGrants = matchingRoleGrants.filter((grant) => (
    requiredPermissions.every((permission) => (
      grant.permissions.length === 0 || grant.permissions.includes(permission) || grantedPermissions.includes(permission)
    ))
  ));
  const hasExplicitGrant = boundaryGrants.length > 0;
  const grantAccepted = requestScope.satisfied && !hasExplicitGrant && !explicitGrantsRequired
    ? true
    : requestScope.satisfied && matchingPermissionGrants.length > 0;
  const missingPermissions = requiredPermissions.filter((permission) => !grantedPermissions.includes(permission));
  const violations = [];

  if (tenantId !== serviceContract.tenantId) {
    violations.push("tenant.mismatch");
  }

  if (workspaceId !== serviceContract.workspaceId) {
    violations.push("workspace.mismatch");
  }

  requestScope.violations.forEach((violation) => {
    if (!violations.includes(violation)) {
      violations.push(violation);
    }
  });

  if (!effectiveAllowedRoles.includes(role)) {
    violations.push("role.not-authorized");
  }

  if (missingPermissions.length) {
    violations.push("permission.missing");
  }

  if (allowedTenantIds.length && !allowedTenantIds.includes(serviceContract.tenantId)) {
    violations.push("tenant.not-in-allowlist");
  }

  if (allowedWorkspaceIds.length && !allowedWorkspaceIds.includes(serviceContract.workspaceId)) {
    violations.push("workspace.not-in-allowlist");
  }

  if (allowedCapabilityIds.length && !allowedCapabilityIds.includes(serviceContract.capabilityId)) {
    violations.push("capability.not-in-allowlist");
  }

  if (allowedRouteIds.length && !allowedRouteIds.includes(requestState.routeId)) {
    violations.push("route.not-in-allowlist");
  }

  if (!grantAccepted) {
    violations.push(explicitGrantsRequired ? "workspace.grant-required" : "workspace.grant-missing");
  }

  return {
    schema: "rate-limit.access-boundary.v1",
    mode: boundary.mode === "audit-only" ? "audit-only" : "enforce",
    subjectKey: serviceContract.subjectKey,
    tenantId,
    workspaceId,
    expectedTenantId: serviceContract.tenantId,
    expectedWorkspaceId: serviceContract.workspaceId,
    requestScope,
    role,
    allowedRoles: effectiveAllowedRoles,
    requiredPermissions,
    grantedPermissions: [...new Set(grantedPermissions)],
    missingPermissions,
    allowlists: {
      tenantIds: allowedTenantIds,
      workspaceIds: allowedWorkspaceIds,
      capabilityIds: allowedCapabilityIds,
      routeIds: allowedRouteIds
    },
    workspaceGrant: {
      required: explicitGrantsRequired,
      present: hasExplicitGrant,
      accepted: grantAccepted,
      eligibleGrantIds: eligibleGrants.map((grant) => grant.grantId),
      matchedGrantIds: matchingPermissionGrants.map((grant) => grant.grantId),
      rejectedGrantIds: boundaryGrants
        .filter((grant) => grant.state !== "eligible")
        .map((grant) => grant.grantId),
      rejectedGrantReasons: Object.fromEntries(boundaryGrants
        .filter((grant) => grant.state !== "eligible")
        .map((grant) => [grant.grantId, grant.reasonCodes])),
      grants: boundaryGrants
    },
    isTenantScoped: tenantId === serviceContract.tenantId,
    isWorkspaceScoped: workspaceId === serviceContract.workspaceId,
    isRequestScoped: requestScope.satisfied,
    isCapabilityScoped: !allowedCapabilityIds.length || allowedCapabilityIds.includes(serviceContract.capabilityId),
    isRouteScoped: !allowedRouteIds.length || allowedRouteIds.includes(requestState.routeId),
    state: violations.length ? "violated" : "satisfied",
    enforced: boundary.mode !== "audit-only",
    violations
  };
}

function buildNegotiation(providerContract, serviceContract) {
  const required = ["rate-limit.snapshot.v1", "rate-limit.audit.v1"];
  const optional = ["rate-limit.reserve.v1", "rate-limit.release.v1", "rate-limit.external-handoff.v1"];
  const accepted = [...required, ...optional].filter((capability) => providerContract.capabilities.includes(capability));
  const missingRequired = required.filter((capability) => !providerContract.capabilities.includes(capability));

  return {
    status: missingRequired.length ? "limited" : "accepted",
    required,
    accepted,
    missingRequired,
    effectiveReservationMode: serviceContract.policy.reservationMode,
    providerHealth: providerContract.health
  };
}

function buildProviderSyncLease(input, now, serviceContract, providerContract, negotiation, syncKey, cursor) {
  const rawSync = asObject(input.providerSync || input.syncState || input.rateLimitSync);
  const rawLease = asObject(rawSync.lease || rawSync.providerLease);
  const expectedOwner = `${providerContract.providerId}:${serviceContract.subjectKey}`;
  const leaseOwner = asIdentifier(rawLease.owner || rawLease.leaseOwner || rawSync.owner, null);
  const leaseId = asIdentifier(rawLease.leaseId || rawSync.leaseId, `${syncKey}:lease`);
  const expiresAt = asIdentifier(rawLease.expiresAt || rawSync.leaseExpiresAt, null);
  const expiresAtMs = asTimestampMs(expiresAt);
  const nowMs = Date.parse(now);
  const lastProviderCursor = asIdentifier(
    rawSync.lastProviderCursor || rawSync.acknowledgedCursor || rawSync.cursor,
    null
  );
  const providerClock = asIdentifier(rawSync.providerClock || rawSync.observedAt, null);
  const providerClockMs = asTimestampMs(providerClock);
  const clockSkewMs = providerClockMs ? providerClockMs - nowMs : 0;
  const acknowledgedCapabilities = asIdentifierList(
    rawSync.acknowledgedCapabilities || rawSync.capabilities
  ).filter((capability) => SUPPORTED_PROVIDER_CAPABILITIES.includes(capability));
  const requiredAcknowledgements = negotiation.accepted.filter((capability) => (
    capability === "rate-limit.snapshot.v1"
      || capability === "rate-limit.audit.v1"
      || capability === "rate-limit.external-handoff.v1"
  ));
  const missingAcknowledgements = requiredAcknowledgements.filter((capability) => (
    !acknowledgedCapabilities.includes(capability)
  ));
  const leaseMissing = !leaseOwner;
  const leaseForeign = Boolean(leaseOwner && leaseOwner !== expectedOwner);
  const leaseExpired = Boolean(expiresAtMs && expiresAtMs <= nowMs);
  const cursorState = !lastProviderCursor
    ? "unseen"
    : lastProviderCursor === cursor
      ? "current"
      : "behind";
  const leaseState = leaseMissing
    ? "missing"
    : leaseForeign
      ? "foreign-owner"
      : leaseExpired
        ? "expired"
        : "active";
  const writeAllowed = negotiation.status === "accepted"
    && leaseState === "active"
    && missingAcknowledgements.length === 0;
  const handoffState = !negotiation.accepted.includes("rate-limit.external-handoff.v1")
    ? "not-negotiated"
    : !writeAllowed
      ? "awaiting-sync-lease"
      : cursorState === "current"
        ? "provider-current"
        : "ready-to-handoff";

  return {
    schema: "rate-limit.provider-sync-lease.v1",
    syncKey,
    cursor,
    providerId: providerContract.providerId,
    subjectKey: serviceContract.subjectKey,
    lease: {
      leaseId,
      owner: leaseOwner,
      expectedOwner,
      state: leaseState,
      expiresAt,
      expiresInMs: expiresAtMs ? Math.max(0, expiresAtMs - nowMs) : null
    },
    providerWatermark: {
      cursor: lastProviderCursor,
      state: cursorState,
      providerClock,
      clockSkewMs,
      clockState: Math.abs(clockSkewMs) > 30_000 ? "skewed" : "aligned"
    },
    capabilityAcknowledgement: {
      required: requiredAcknowledgements,
      acknowledged: acknowledgedCapabilities,
      missing: missingAcknowledgements,
      state: missingAcknowledgements.length ? "incomplete" : "complete"
    },
    writeAllowed,
    handoffState,
    reasonCodes: [
      leaseMissing ? "sync.lease-missing" : null,
      leaseForeign ? "sync.lease-foreign-owner" : null,
      leaseExpired ? "sync.lease-expired" : null,
      missingAcknowledgements.length ? "sync.capability-ack-missing" : null,
      cursorState === "behind" ? "sync.provider-cursor-behind" : null,
      Math.abs(clockSkewMs) > 30_000 ? "sync.provider-clock-skew" : null
    ].filter(Boolean)
  };
}

function readLifecycleCommandOverrides(command) {
  const source = asObject(command.settings || command.effect || command.patch || command.controls);

  return {
    hasEnabled: typeof source.enabled === "boolean",
    enabled: source.enabled,
    hasEnforcementEnabled: typeof source.enforcementEnabled === "boolean",
    enforcementEnabled: source.enforcementEnabled,
    hasReservationsEnabled: typeof source.reservationsEnabled === "boolean",
    reservationsEnabled: source.reservationsEnabled,
    hasAuditEnabled: typeof source.auditEnabled === "boolean",
    auditEnabled: source.auditEnabled,
    resetWindow: source.resetWindow === true
  };
}

function lifecycleBooleanOverrideIssue(command, field, value) {
  if (value === undefined || value === null || typeof value === "boolean") {
    return null;
  }

  return {
    field,
    commandId: asIdentifier(command.commandId || command.id, null),
    reasonCode: `lifecycle.command.${field}-must-be-boolean`,
    suppliedType: typeof value
  };
}

function normalizeLifecycleSettingsPatch(command, serviceContract, baseSettings) {
  const source = asObject(command.settings || command.effect || command.patch || command.controls);
  const issues = [
    lifecycleBooleanOverrideIssue(command, "enabled", source.enabled),
    lifecycleBooleanOverrideIssue(command, "enforcementEnabled", source.enforcementEnabled),
    lifecycleBooleanOverrideIssue(command, "reservationsEnabled", source.reservationsEnabled),
    lifecycleBooleanOverrideIssue(command, "auditEnabled", source.auditEnabled),
    lifecycleBooleanOverrideIssue(command, "resetWindow", source.resetWindow)
  ].filter(Boolean);
  const patch = {
    enabled: typeof source.enabled === "boolean" ? source.enabled : null,
    enforcementEnabled: typeof source.enforcementEnabled === "boolean" ? source.enforcementEnabled : null,
    reservationsEnabled: typeof source.reservationsEnabled === "boolean" ? source.reservationsEnabled : null,
    auditEnabled: typeof source.auditEnabled === "boolean" ? source.auditEnabled : null,
    resetWindow: source.resetWindow === true
  };
  const effective = {
    enabled: patch.enabled ?? baseSettings.enabled,
    enforcementEnabled: patch.enforcementEnabled ?? baseSettings.enforcementEnabled,
    reservationsEnabled: patch.reservationsEnabled ?? baseSettings.reservationsEnabled,
    auditEnabled: patch.auditEnabled ?? baseSettings.auditEnabled,
    resetWindow: baseSettings.resetWindow === true || patch.resetWindow
  };
  const coerced = {
    enabled: effective.enabled,
    enforcementEnabled: effective.enabled && effective.enforcementEnabled,
    reservationsEnabled: effective.enabled
      && effective.enforcementEnabled
      && effective.reservationsEnabled
      && serviceContract.policy.reservationMode === "provider-reservation",
    auditEnabled: effective.auditEnabled,
    resetWindow: effective.resetWindow
  };
  const changedFields = [
    typeof source.enabled === "boolean" ? "enabled" : null,
    typeof source.enforcementEnabled === "boolean" ? "enforcementEnabled" : null,
    typeof source.reservationsEnabled === "boolean" ? "reservationsEnabled" : null,
    typeof source.auditEnabled === "boolean" ? "auditEnabled" : null,
    typeof source.resetWindow === "boolean" ? "resetWindow" : null
  ].filter(Boolean);
  const policyIssues = [
    coerced.enforcementEnabled && !coerced.auditEnabled ? "lifecycle.command.enforcement-audit-required" : null,
    effective.reservationsEnabled && serviceContract.policy.reservationMode !== "provider-reservation"
      ? "lifecycle.command.reservation-mode-unavailable"
      : null,
    effective.reservationsEnabled && !coerced.enforcementEnabled
      ? "lifecycle.command.reservation-without-enforcement"
      : null,
    effective.enforcementEnabled && !effective.enabled ? "lifecycle.command.enforcement-without-enable" : null
  ].filter(Boolean);

  return {
    schema: "rate-limit.lifecycle-settings-patch.v1",
    present: changedFields.length > 0,
    changedFields,
    patch,
    effective,
    coerced,
    providerReservationAvailable: serviceContract.policy.reservationMode === "provider-reservation",
    validationIssues: [
      ...issues.map((issue) => issue.reasonCode),
      ...policyIssues
    ],
    issueDetails: issues
  };
}

function buildLifecycleCommandClientState({ command, statePatch, persistence, now, syncMetadata }) {
  const blocking = command.state === "rejected" || command.state === "duplicate";
  const replay = command.state === "replay";
  const alreadyApplied = command.state === "already-applied";
  const ready = command.state === "ready" || command.state === "pending" || replay;
  const scheduled = command.state === "scheduled";
  const actionId = alreadyApplied
    ? "skip.rate-limit.lifecycle-command"
    : blocking
      ? "review.rate-limit.lifecycle-command"
      : replay
        ? "replay.rate-limit.lifecycle-command"
        : scheduled
          ? "wait.rate-limit.lifecycle-command"
          : ready
            ? `apply.rate-limit.lifecycle.${command.type}`
            : "observe.rate-limit.lifecycle-command";
  const dueAt = scheduled || ready ? command.timing.dueAt : now;

  return {
    schema: "rate-limit.lifecycle-command-client-state.v1",
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    state: command.state,
    actionId,
    dueAt,
    retryAfterMs: scheduled ? command.timing.delayMs : 0,
    restartAction: persistence.restartAction,
    restartSafe: alreadyApplied || scheduled || ready || replay,
    blocking,
    replayRequired: replay,
    clientPatch: {
      subjectKey: command.target.subjectKey,
      syncKey: syncMetadata.syncKey,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      settings: statePatch.coerced,
      changedFields: statePatch.changedFields,
      validationIssues: statePatch.validationIssues,
      persistenceState: command.state
    }
  };
}

function buildLifecycleCommandEffect(command, type, baseEffect, settings, serviceContract) {
  const overrides = readLifecycleCommandOverrides(command);
  const enabled = overrides.hasEnabled ? overrides.enabled : baseEffect.enabled;
  const enforcementEnabled = enabled && (
    overrides.hasEnforcementEnabled ? overrides.enforcementEnabled : baseEffect.enforcementEnabled
  );
  const reservationRequested = overrides.hasReservationsEnabled
    ? overrides.reservationsEnabled
    : baseEffect.reservationsEnabled;
  const providerReservationAvailable = serviceContract.policy.reservationMode === "provider-reservation";
  const reservationsEnabled = enabled && enforcementEnabled && reservationRequested && providerReservationAvailable;
  const auditEnabled = overrides.hasAuditEnabled ? overrides.auditEnabled : settings.auditEnabled;
  const resetWindow = Boolean(baseEffect.resetWindow || overrides.resetWindow);
  const overrideFields = [
    overrides.hasEnabled ? "enabled" : null,
    overrides.hasEnforcementEnabled ? "enforcementEnabled" : null,
    overrides.hasReservationsEnabled ? "reservationsEnabled" : null,
    overrides.hasAuditEnabled ? "auditEnabled" : null,
    overrides.resetWindow ? "resetWindow" : null
  ].filter(Boolean);
  const validationIssues = [
    enforcementEnabled && !enabled ? "lifecycle.command.enforcement-without-enable" : null,
    reservationRequested && !providerReservationAvailable ? "lifecycle.command.reservation-mode-unavailable" : null,
    reservationRequested && !enforcementEnabled ? "lifecycle.command.reservation-without-enforcement" : null,
    type === "enable" && auditEnabled === false ? "lifecycle.command.enable-without-audit" : null,
    type === "refresh" && resetWindow ? "lifecycle.command.refresh-cannot-reset-window" : null
  ].filter(Boolean);

  return {
    enabled,
    enforcementEnabled,
    reservationsEnabled,
    auditEnabled,
    resetWindow,
    overrideFields,
    validationIssues,
    providerReservationAvailable
  };
}

function buildSyncMetadata(now, input, serviceContract, providerContract, negotiation) {
  const syncKey = `${surfaceId}:${serviceContract.subjectKey}`;
  const cursor = `${serviceContract.subjectKey}@${now}`;
  const providerSyncLease = buildProviderSyncLease(input, now, serviceContract, providerContract, negotiation, syncKey, cursor);

  return {
    generatedAt: now,
    syncKey,
    cursor,
    providerId: providerContract.providerId,
    subjectKey: serviceContract.subjectKey,
    policyVersion: serviceContract.policy.version,
    nextRefreshAfterMs: negotiation.status === "accepted" ? serviceContract.policy.windowMs : 15_000,
    conflictStrategy: "kernel-policy-wins",
    externalConsistency: providerContract.health === "ready" && providerSyncLease.writeAllowed
      ? "handoff-ready"
      : "local-proof-only",
    providerSyncLease
  };
}

function reconcileLifecycleCommandPersistence(command, persistedState, seenKeys) {
  const key = command.idempotencyKey;
  const journalEntry = key
    ? persistedState.commandJournal.find((entry) => entry.idempotencyKey === key)
    : null;
  const durableApplied = Boolean(
    key
    && (persistedState.appliedCommandKeys.includes(key) || journalEntry?.state === "applied")
  );
  const duplicateInBatch = Boolean(key && seenKeys.has(key));
  const replayRequired = Boolean(
    journalEntry
    && ["pending", "failed"].includes(journalEntry.state)
    && !durableApplied
  );
  const persistenceReason = !key
    ? "lifecycle.command.idempotency-key-missing"
    : duplicateInBatch
      ? "lifecycle.command.duplicate-idempotency-key"
      : durableApplied
        ? "lifecycle.command.already-applied"
        : replayRequired
          ? `lifecycle.command.replay-${journalEntry.state}`
          : command.reasonCode;
  const state = duplicateInBatch
    ? "duplicate"
    : durableApplied
      ? "already-applied"
      : replayRequired && command.state !== "scheduled"
        ? "replay"
        : command.state;

  if (key) {
    seenKeys.add(key);
  }

  return {
    ...command,
    state,
    reasonCode: persistenceReason,
    persistence: {
      schema: "rate-limit.lifecycle-command-persistence.v1",
      idempotencyKey: key,
      durableApplied,
      duplicateInBatch,
      replayRequired,
      journalState: journalEntry ? journalEntry.state : "missing",
      journalSequence: journalEntry ? journalEntry.sequence : null,
      restartAction: durableApplied
        ? "skip-already-applied"
        : duplicateInBatch
          ? "ignore-duplicate-command"
          : replayRequired
            ? "replay-before-new-append"
            : command.state === "scheduled"
              ? "wait-until-due"
              : command.state === "rejected"
                ? "reject"
                : "append-before-apply"
    }
  };
}

function reconcileLifecycleCommandsWithPersistence(lifecycleCommands, persistedState) {
  const seenKeys = new Set();
  const commands = lifecycleCommands.map((command) => (
    reconcileLifecycleCommandPersistence(command, persistedState, seenKeys)
  ));
  const countByState = commands.reduce((counts, command) => {
    counts[command.state] = (counts[command.state] || 0) + 1;
    return counts;
  }, {});

  return {
    schema: "rate-limit.lifecycle-command-persistence-index.v1",
    commands,
    alreadyAppliedCount: countByState["already-applied"] || 0,
    replayCount: countByState.replay || 0,
    duplicateCount: countByState.duplicate || 0,
    restartBlockingCount: (countByState.replay || 0) + (countByState.duplicate || 0),
    reasonCodes: commands
      .filter((command) => ["already-applied", "replay", "duplicate"].includes(command.state))
      .map((command) => command.reasonCode)
  };
}

function buildLifecycleTransitionPlan(now, serviceContract, syncMetadata, currentState, readyCommands, scheduledCommands, rejectedCommands, persistedCommands = []) {
  const orderedCommands = [...readyCommands].sort((left, right) => (
    left.timing.dueAt.localeCompare(right.timing.dueAt)
    || left.commandId.localeCompare(right.commandId)
  ));
  const scheduledDelays = scheduledCommands
    .map((command) => command.timing.delayMs)
    .filter((delayMs) => Number.isInteger(delayMs) && delayMs > 0);
  const projectedSettings = orderedCommands.reduce((settings, command) => ({
    ...settings,
    enabled: asBoolean(command.effect.enabled, settings.enabled),
    enforcementEnabled: asBoolean(command.effect.enforcementEnabled, settings.enforcementEnabled),
    reservationsEnabled: asBoolean(command.effect.reservationsEnabled, settings.reservationsEnabled),
    auditEnabled: asBoolean(command.effect.auditEnabled, settings.auditEnabled),
    resetWindow: settings.resetWindow || command.effect.resetWindow === true,
    lastCommandId: command.commandId,
    lastCommandType: command.type
  }), {
    enabled: currentState.enabled,
    enforcementEnabled: currentState.enforcementEnabled,
    reservationsEnabled: currentState.reservationsEnabled,
    auditEnabled: currentState.auditEnabled,
    resetWindow: false,
    lastCommandId: null,
    lastCommandType: null
  });
  const projectedBlockingIssues = [
    projectedSettings.enabled && !projectedSettings.auditEnabled ? "lifecycle.transition.audit-disabled" : null,
    projectedSettings.reservationsEnabled
      && serviceContract.policy.reservationMode !== "provider-reservation"
      ? "lifecycle.transition.reservation-mode-unavailable"
      : null,
    projectedSettings.enforcementEnabled && !projectedSettings.enabled
      ? "lifecycle.transition.enforcement-without-enable"
      : null
  ].filter(Boolean);
  const transitionState = projectedBlockingIssues.length
    ? "blocked"
    : orderedCommands.length
      ? "ready-to-apply"
      : scheduledCommands.length
        ? "scheduled"
        : rejectedCommands.length
          ? "rejected"
          : "idle";
  const nextScheduledDelayMs = scheduledDelays.length ? Math.min(...scheduledDelays) : 0;
  const firstReadyCommand = orderedCommands[0] || null;
  const firstScheduledCommand = scheduledCommands
    .slice()
    .sort((left, right) => left.timing.delayMs - right.timing.delayMs)[0] || null;

  return {
    schema: "rate-limit.lifecycle-transition-plan.v1",
    generatedAt: now,
    state: transitionState,
    syncKey: syncMetadata.syncKey,
    subjectKey: serviceContract.subjectKey,
    applyOrder: orderedCommands.map((command, index) => ({
      ordinal: index + 1,
      commandId: command.commandId,
      type: command.type,
      idempotencyKey: command.idempotencyKey,
      dueAt: command.timing.dueAt,
      effect: command.effect
    })),
    projectedSettings: {
      enabled: projectedSettings.enabled,
      enforcementEnabled: projectedSettings.enabled && projectedSettings.enforcementEnabled,
      reservationsEnabled: projectedSettings.enabled
        && projectedSettings.enforcementEnabled
        && projectedSettings.reservationsEnabled
        && serviceContract.policy.reservationMode === "provider-reservation",
      auditEnabled: projectedSettings.auditEnabled,
      resetWindow: projectedSettings.resetWindow,
      sourceCommandId: projectedSettings.lastCommandId,
      sourceCommandType: projectedSettings.lastCommandType
    },
    commandCounts: {
      ready: orderedCommands.length,
      scheduled: scheduledCommands.length,
      rejected: rejectedCommands.length,
      alreadyApplied: persistedCommands.filter((command) => command.state === "already-applied").length,
      replay: persistedCommands.filter((command) => command.state === "replay").length,
      duplicate: persistedCommands.filter((command) => command.state === "duplicate").length
    },
    nextCommand: firstReadyCommand
      ? {
          commandId: firstReadyCommand.commandId,
          type: firstReadyCommand.type,
          state: firstReadyCommand.state === "replay" ? "replay" : "ready",
          dueAt: firstReadyCommand.timing.dueAt,
          delayMs: 0
        }
      : firstScheduledCommand
        ? {
            commandId: firstScheduledCommand.commandId,
            type: firstScheduledCommand.type,
            state: "scheduled",
            dueAt: firstScheduledCommand.timing.dueAt,
            delayMs: firstScheduledCommand.timing.delayMs
          }
        : null,
    blockingIssues: projectedBlockingIssues,
    nextAction: {
      actionId: projectedBlockingIssues.length
        ? "resolve.rate-limit.lifecycle-transition"
        : firstReadyCommand?.state === "replay"
          ? "replay.rate-limit.lifecycle-command"
        : firstReadyCommand
          ? `apply.rate-limit.lifecycle.${firstReadyCommand.type}`
          : firstScheduledCommand
            ? "wait.rate-limit.lifecycle-command"
            : "monitor.rate-limit.lifecycle-transition",
      retryAfterMs: firstReadyCommand || projectedBlockingIssues.length ? 0 : nextScheduledDelayMs,
      dueAt: firstReadyCommand || projectedBlockingIssues.length
        ? now
        : nextScheduledDelayMs
          ? new Date(Date.parse(now) + nextScheduledDelayMs).toISOString()
          : now
    },
    proof: {
      proofId: `${syncMetadata.syncKey}:lifecycle-transition`,
      idempotencyScope: `${serviceContract.subjectKey}:lifecycle`,
      readyCommandKeys: orderedCommands.map((command) => command.idempotencyKey),
      rejectedCommandIds: rejectedCommands.map((command) => command.commandId),
      skippedCommandKeys: persistedCommands
        .filter((command) => command.state === "already-applied" || command.state === "duplicate")
        .map((command) => command.idempotencyKey)
    }
  };
}

function buildLifecycleControls(now, input = {}, serviceContract, syncMetadata, persistedState = null) {
  const settings = asObject(input.lifecycleSettings || input.settings || input.rateLimitSettings);
  const schedule = asObject(settings.schedule || input.schedule || input.rateLimitSchedule);
  const commandDefaults = asObject(settings.commandDefaults || input.lifecycleCommandDefaults);
  const rawCommands = Array.isArray(settings.commands)
    ? settings.commands
    : Array.isArray(input.lifecycleCommands)
      ? input.lifecycleCommands
      : [];
  const enabled = asBoolean(settings.enabled, true);
  const requestedEnforcementEnabled = asBoolean(settings.enforcementEnabled, true);
  const enforcementEnabled = enabled && requestedEnforcementEnabled;
  const reservationsEnabled = enforcementEnabled && asBoolean(settings.reservationsEnabled, true);
  const auditEnabled = asBoolean(settings.auditEnabled, true);
  const scheduleEnabled = asBoolean(schedule.enabled, true);
  const requestedScheduleMode = asIdentifier(schedule.mode || settings.scheduleMode, "interval");
  const scheduleMode = ["interval", "manual", "window-reset"].includes(requestedScheduleMode)
    ? requestedScheduleMode
    : "interval";
  const requestedRefreshEveryMs = schedule.refreshEveryMs || settings.refreshEveryMs;
  const normalizedRefreshEveryMs = asPositiveInteger(requestedRefreshEveryMs, serviceContract.policy.windowMs);
  const refreshEveryMs = Math.max(1_000, normalizedRefreshEveryMs);
  const maxDriftMs = Math.max(0, asNonNegativeInteger(schedule.maxDriftMs, Math.round(refreshEveryMs / 2)));
  const nowMs = Date.parse(now);
  const pauseUntil = asIdentifier(settings.pauseUntil || schedule.pauseUntil, null);
  const pauseUntilMs = asTimestampMs(pauseUntil);
  const nextRunAt = asIdentifier(schedule.nextRunAt || settings.nextRefreshAt, null);
  const nextRunAtMs = asTimestampMs(nextRunAt);
  const blockedUntilMs = pauseUntilMs && pauseUntilMs > nowMs ? pauseUntilMs : null;
  const scheduleDriftMs = nextRunAtMs && nextRunAtMs < nowMs ? nowMs - nextRunAtMs : 0;
  const autoScheduleActive = scheduleEnabled && scheduleMode !== "manual";
  const effectiveNextRunAtMs = autoScheduleActive && !blockedUntilMs
    ? nextRunAtMs && nextRunAtMs > nowMs
      ? nextRunAtMs
      : nowMs + refreshEveryMs
    : null;
  const effectiveNextRunAt = effectiveNextRunAtMs ? new Date(effectiveNextRunAtMs).toISOString() : null;
  const refreshDue = autoScheduleActive
    && !blockedUntilMs
    && (!nextRunAtMs || nextRunAtMs <= nowMs || scheduleDriftMs > maxDriftMs);
  const commandSubjectKey = asIdentifier(commandDefaults.subjectKey, serviceContract.subjectKey);
  const allowedCommands = new Set(["enable", "disable", "pause", "resume", "refresh", "rotate-window"]);
  const commandStatePatch = {
    enable: {
      enabled: true,
      enforcementEnabled: requestedEnforcementEnabled,
      reservationsEnabled: reservationsEnabled || serviceContract.policy.reservationMode === "provider-reservation"
    },
    disable: {
      enabled: false,
      enforcementEnabled: false,
      reservationsEnabled: false
    },
    pause: {
      enabled,
      enforcementEnabled: false,
      reservationsEnabled: false
    },
    resume: {
      enabled: true,
      enforcementEnabled: requestedEnforcementEnabled,
      reservationsEnabled: serviceContract.policy.reservationMode === "provider-reservation"
        && asBoolean(settings.reservationsEnabled, true)
    },
    refresh: {
      enabled,
      enforcementEnabled,
      reservationsEnabled
    },
    "rotate-window": {
      enabled,
      enforcementEnabled,
      reservationsEnabled,
      resetWindow: true
    }
  };
  const lifecycleCommands = rawCommands
    .filter((command) => command && typeof command === "object")
    .slice(-10)
    .map((command, index) => {
      const type = asIdentifier(command.type || command.command, "refresh");
      const accepted = allowedCommands.has(type);
      const commandAt = asIdentifier(command.runAt || command.applyAt || command.at, null);
      const commandAtMs = asTimestampMs(commandAt);
      const commandScope = asObject(command.scope);
      const commandTenantId = asIdentifier(command.tenantId || commandScope.tenantId, serviceContract.tenantId);
      const commandWorkspaceId = asIdentifier(
        command.workspaceId || command.workspace || commandScope.workspaceId,
        serviceContract.workspaceId
      );
      const commandCapabilityId = asIdentifier(
        command.capabilityId || commandScope.capabilityId,
        serviceContract.capabilityId
      );
      const targetSubjectKey = asIdentifier(
        command.subjectKey || commandScope.subjectKey || commandDefaults.subjectKey,
        `${commandTenantId}:${commandWorkspaceId}:${commandCapabilityId}:${serviceContract.serviceId}`
      );
      const scopeViolations = [
        commandSubjectKey !== serviceContract.subjectKey ? "lifecycle.command-default-subject-mismatch" : null,
        targetSubjectKey !== serviceContract.subjectKey ? "lifecycle.command-subject-mismatch" : null,
        commandTenantId !== serviceContract.tenantId ? "lifecycle.command-tenant-mismatch" : null,
        commandWorkspaceId !== serviceContract.workspaceId ? "lifecycle.command-workspace-mismatch" : null,
        commandCapabilityId !== serviceContract.capabilityId ? "lifecycle.command-capability-mismatch" : null
      ].filter(Boolean);
      const baseEffect = commandStatePatch[accepted ? type : "refresh"];
      const commandEffect = buildLifecycleCommandEffect(command, accepted ? type : "refresh", baseEffect, {
        enabled,
        enforcementEnabled,
        reservationsEnabled,
        auditEnabled
      }, serviceContract);
      const settingsPatch = normalizeLifecycleSettingsPatch(command, serviceContract, {
        enabled: commandEffect.enabled,
        enforcementEnabled: commandEffect.enforcementEnabled,
        reservationsEnabled: commandEffect.reservationsEnabled,
        auditEnabled: commandEffect.auditEnabled,
        resetWindow: commandEffect.resetWindow
      });
      const effectViolations = [
        ...commandEffect.validationIssues,
        ...settingsPatch.validationIssues
      ];
      const commandBlocked = Boolean(blockedUntilMs && type !== "resume") || Boolean(commandAt && !commandAtMs);
      const commandReady = accepted && !scopeViolations.length && !effectViolations.length && !commandBlocked
        && (!commandAtMs || commandAtMs <= nowMs);
      const commandScheduled = accepted && !scopeViolations.length && !effectViolations.length && !commandBlocked
        && commandAtMs > nowMs;
      const rejectedReason = !accepted
        ? "lifecycle.command.unsupported"
        : scopeViolations[0]
          || effectViolations[0]
          || (commandAt && !commandAtMs ? "lifecycle.command.run-at-invalid" : null)
          || (blockedUntilMs && type !== "resume" ? "lifecycle.command.blocked-by-pause" : null);

      return {
        commandId: asIdentifier(command.commandId || command.id, `${syncMetadata.syncKey}:lifecycle:${index + 1}`),
        type: accepted ? type : "unsupported",
        requestedType: type,
        state: rejectedReason
          ? "rejected"
          : commandReady
            ? "ready"
            : commandScheduled
              ? "scheduled"
              : "pending",
        idempotencyKey: asIdentifier(command.idempotencyKey, `${syncMetadata.syncKey}:lifecycle:${type}:${index + 1}`),
        reasonCode: rejectedReason,
        target: {
          subjectKey: targetSubjectKey,
          tenantId: commandTenantId,
          workspaceId: commandWorkspaceId,
          capabilityId: commandCapabilityId
        },
        timing: {
          requestedAt: commandAt,
          dueAt: commandAtMs ? new Date(commandAtMs).toISOString() : now,
          delayMs: commandAtMs ? Math.max(0, commandAtMs - nowMs) : 0,
          blockedUntilMs
        },
        effect: {
          enabled: settingsPatch.coerced.enabled,
          enforcementEnabled: settingsPatch.coerced.enforcementEnabled,
          reservationsEnabled: settingsPatch.coerced.reservationsEnabled,
          auditEnabled: settingsPatch.coerced.auditEnabled,
          resetWindow: settingsPatch.coerced.resetWindow
        },
        settingsOverride: {
          present: commandEffect.overrideFields.length > 0 || settingsPatch.present,
          fields: [...new Set([...commandEffect.overrideFields, ...settingsPatch.changedFields])],
          providerReservationAvailable: settingsPatch.providerReservationAvailable,
          validationIssues: effectViolations,
          issueDetails: settingsPatch.issueDetails
        },
        effectiveSettings: settingsPatch
      };
    });
  const persistenceIndex = reconcileLifecycleCommandsWithPersistence(
    lifecycleCommands,
    persistedState || {
      commandJournal: [],
      appliedCommandKeys: []
    }
  );
  const persistedLifecycleCommands = persistenceIndex.commands;
  const commandClientStates = persistedLifecycleCommands.map((command) => buildLifecycleCommandClientState({
    command,
    statePatch: command.effectiveSettings,
    persistence: command.persistence,
    now,
    syncMetadata
  }));
  const rejectedCommands = persistedLifecycleCommands.filter((command) => (
    command.state === "rejected" || command.state === "duplicate"
  ));
  const readyCommands = persistedLifecycleCommands.filter((command) => (
    command.state === "ready" || command.state === "pending" || command.state === "replay"
  ));
  const scheduledCommands = persistedLifecycleCommands.filter((command) => command.state === "scheduled");
  const commandDelayMs = scheduledCommands
    .map((command) => command.timing.delayMs)
    .filter((delayMs) => Number.isInteger(delayMs) && delayMs > 0);
  const nextCommandDelayMs = commandDelayMs.length ? Math.min(...commandDelayMs) : 0;
  const lifecycleTransitionPlan = buildLifecycleTransitionPlan(
    now,
    serviceContract,
    syncMetadata,
    {
      enabled,
      enforcementEnabled,
      reservationsEnabled,
      auditEnabled
    },
    readyCommands,
    scheduledCommands,
    rejectedCommands,
    persistedLifecycleCommands
  );
  const validationIssues = [
    requestedScheduleMode !== scheduleMode ? "lifecycle.schedule.mode-unsupported" : null,
    Number.isInteger(requestedRefreshEveryMs) && requestedRefreshEveryMs < 1_000 ? "lifecycle.refresh-too-low" : null,
    !auditEnabled ? "lifecycle.audit-disabled" : null,
    !enabled && requestedEnforcementEnabled ? "lifecycle.enforcement-inconsistent" : null,
    requestedEnforcementEnabled && !auditEnabled ? "lifecycle.enforcement-audit-required" : null,
    reservationsEnabled && serviceContract.policy.reservationMode !== "provider-reservation"
      ? "lifecycle.reservation-mode-unavailable"
      : null,
    scheduleMode === "manual" && nextRunAt ? "lifecycle.schedule.manual-next-run-ignored" : null,
    nextRunAt && !nextRunAtMs ? "lifecycle.schedule.next-run-invalid" : null,
    pauseUntil && !pauseUntilMs ? "lifecycle.pause-until-invalid" : null,
    commandSubjectKey !== serviceContract.subjectKey ? "lifecycle.command-default-subject-mismatch" : null,
    rejectedCommands.length ? "lifecycle.command.rejected" : null,
    persistenceIndex.duplicateCount ? "lifecycle.command.duplicate-idempotency-key" : null,
    persistenceIndex.replayCount ? "lifecycle.command.replay-required" : null,
    commandClientStates.some((entry) => entry.clientPatch.validationIssues.length)
      ? "lifecycle.command.effective-settings-invalid"
      : null,
    ...lifecycleTransitionPlan.blockingIssues
  ].filter(Boolean);
  const blockingIssues = validationIssues.filter((issue) => !["lifecycle.audit-disabled"].includes(issue));
  const state = blockingIssues.length
    ? "invalid"
      : !enabled
        ? "disabled"
        : blockedUntilMs
          ? "paused"
        : autoScheduleActive && scheduleDriftMs > maxDriftMs
          ? "schedule-drift"
          : "enabled";
  const nextActionId = state === "invalid"
    ? "resolve.rate-limit.lifecycle-settings"
    : state === "disabled"
      ? "enable.rate-limit.lifecycle"
      : state === "paused"
        ? "wait.rate-limit.lifecycle-resume"
        : state === "schedule-drift"
          ? "refresh.rate-limit.schedule"
          : readyCommands.length
            ? "apply.rate-limit.lifecycle-command"
            : scheduledCommands.length
              ? "wait.rate-limit.lifecycle-command"
              : refreshDue
                ? "refresh.rate-limit.snapshot"
            : "monitor.rate-limit.lifecycle";
  const nextActionDelayMs = blockedUntilMs
    ? Math.max(0, blockedUntilMs - nowMs)
    : nextActionId === "wait.rate-limit.lifecycle-command"
      ? nextCommandDelayMs
      : refreshDue || nextActionId === "refresh.rate-limit.schedule"
        ? 0
        : effectiveNextRunAtMs
          ? Math.max(0, effectiveNextRunAtMs - nowMs)
          : 0;

  return {
    schema: "rate-limit.lifecycle-controls.v1",
    state,
    enabled,
    enforcementEnabled,
    reservationsEnabled,
    auditEnabled,
    validationIssues,
    blockingIssues,
    schedule: {
      enabled: scheduleEnabled,
      mode: scheduleMode,
      requestedMode: requestedScheduleMode,
      autoScheduleActive,
      refreshEveryMs,
      maxDriftMs,
      nextRunAt,
      effectiveNextRunAt,
      pauseUntil,
      blockedUntilMs,
      scheduleDriftMs,
      refreshDue
    },
    commands: persistedLifecycleCommands,
    commandClientStates,
    commandPersistence: persistenceIndex,
    transitionPlan: lifecycleTransitionPlan,
    commandSummary: {
      readyCount: readyCommands.length,
      scheduledCount: scheduledCommands.length,
      rejectedCount: rejectedCommands.length,
      alreadyAppliedCount: persistenceIndex.alreadyAppliedCount,
      replayCount: persistenceIndex.replayCount,
      duplicateCount: persistenceIndex.duplicateCount,
      nextCommandDelayMs,
      commandSubjectKey,
      pendingEffectTypes: readyCommands.map((command) => command.type),
      overrideCommandIds: persistedLifecycleCommands
        .filter((command) => command.settingsOverride.present)
        .map((command) => command.commandId),
      rejectedOverrideIssues: rejectedCommands
        .flatMap((command) => command.settingsOverride.validationIssues)
        .filter(Boolean),
      effectiveSettingsIssues: commandClientStates
        .flatMap((entry) => entry.clientPatch.validationIssues)
        .filter(Boolean),
      nextCommandClientState: commandClientStates.find((entry) => (
        entry.commandId === (readyCommands[0]?.commandId || scheduledCommands[0]?.commandId)
      )) || null,
      transitionState: lifecycleTransitionPlan.state,
      projectedEnabled: lifecycleTransitionPlan.projectedSettings.enabled,
      projectedEnforcementEnabled: lifecycleTransitionPlan.projectedSettings.enforcementEnabled,
      projectedReservationsEnabled: lifecycleTransitionPlan.projectedSettings.reservationsEnabled,
      projectedAuditEnabled: lifecycleTransitionPlan.projectedSettings.auditEnabled
    },
    nextAction: {
      actionId: nextActionId,
      state,
      retryAfterMs: nextActionDelayMs,
      syncKey: syncMetadata.syncKey,
      dueAt: nextActionDelayMs > 0 ? new Date(nowMs + nextActionDelayMs).toISOString() : now,
      commandId: readyCommands[0]?.commandId || scheduledCommands[0]?.commandId || null,
      commandClientState: commandClientStates.find((entry) => (
        entry.commandId === (readyCommands[0]?.commandId || scheduledCommands[0]?.commandId)
      )) || null,
      scheduleMode,
      autoScheduleActive,
      reasonCodes: [
        blockingIssues[0],
        scheduleMode === "manual" ? "lifecycle.manual-schedule" : null,
        state === "schedule-drift" ? "lifecycle.schedule-drift" : null,
        refreshDue ? "lifecycle.refresh-due" : null,
        readyCommands.length ? "lifecycle.command-ready" : null,
        scheduledCommands.length ? "lifecycle.command-scheduled" : null
      ].filter(Boolean)
    }
  };
}

function buildAdmissionGuard(serviceContract, providerContract, negotiation, syncMetadata, requestState, quotaState, lifecycleControls) {
  const rateProfile = requestState.rateProfile || CAPABILITY_RATE_CLASS_POLICIES.default;
  const hardLimit = Math.min(serviceContract.policy.maxRequests, quotaState.observedMaxRequests);
  const classLedger = quotaState.capabilityClassLedger || emptyCapabilityClassLedger();
  const currentClassLedger = classLedger[requestState.capabilityRateClass] || normalizeCapabilityClassLedgerEntry(null);
  const lanePlan = buildCapabilityLanePlan(serviceContract, quotaState, requestState);
  const externalHandoffContract = buildCapabilityExternalHandoffContract(
    serviceContract,
    providerContract,
    negotiation,
    syncMetadata,
    requestState,
    rateProfile
  );
  const classBurstLimit = Math.max(0, Math.floor(serviceContract.policy.burstRequests * rateProfile.burstShare));
  const classWindowLimit = Math.min(
    hardLimit,
    capabilityClassWindowLimit(serviceContract, requestState.capabilityRateClass, hardLimit)
  );
  const burstLimit = Math.min(classBurstLimit, hardLimit);
  const emergencyBurstLimit = Math.min(rateProfile.emergencyBurstRequests || 0, hardLimit);
  const steadyLimit = Math.max(0, hardLimit - burstLimit);
  const accountedRequests = Math.max(0, quotaState.accountedRequests);
  const classAccountedRequests = Math.max(0, currentClassLedger.accountedRequests);
  const burstInFlight = Math.max(0, quotaState.localPending + quotaState.reserved);
  const classInFlight = Math.max(0, currentClassLedger.localPending + currentClassLedger.reserved);
  const remainingBeforeRequest = Math.max(0, hardLimit - accountedRequests);
  const classRemainingBeforeRequest = Math.max(0, classWindowLimit - classAccountedRequests);
  const remainingAfterRequest = Math.max(0, remainingBeforeRequest - requestState.cost);
  const classRemainingAfterRequest = Math.max(0, classRemainingBeforeRequest - requestState.cost);
  const laneRemainingBeforeRequest = lanePlan.laneRemainingBeforeRequest;
  const laneRemainingAfterRequest = lanePlan.laneRemainingAfterRequest;
  const burstBudgetRemaining = Math.max(0, burstLimit - burstInFlight);
  const classBudgetRemaining = Math.max(0, classWindowLimit - classAccountedRequests);
  const steadyBudgetRemaining = Math.max(0, steadyLimit - quotaState.windowUsed);
  const fitsWindow = requestState.cost <= remainingBeforeRequest;
  const fitsClassWindow = requestState.cost <= classRemainingBeforeRequest;
  const fitsCapabilityLane = lanePlan.laneSatisfied;
  const fitsBurst = requestState.cost <= burstBudgetRemaining;
  const providerReservationAvailable = serviceContract.policy.reservationMode === "provider-reservation"
    && providerContract.health === "ready"
    && negotiation.accepted.includes("rate-limit.reserve.v1")
    && lifecycleControls.reservationsEnabled;
  const prefersReservation = rateProfile.reservationStrategy === "prefer-provider-reservation";
  const emergencyAdmission = buildCapabilityEmergencyAdmission(requestState, rateProfile, {
    remainingBeforeRequest,
    classRemainingBeforeRequest,
    laneRemainingBeforeRequest
  });
  const localEmergencyEligible = emergencyAdmission.allowed;
  const laneEmergencyEligible = emergencyAdmission.allowed;
  const classHandoffBlocked = externalHandoffContract.required && !externalHandoffContract.ready;
  const reservationPreferred = fitsWindow
    && fitsClassWindow
    && fitsCapabilityLane
    && prefersReservation
    && requestState.expectsReservation
    && providerReservationAvailable;
  const burstReservationRequired = fitsWindow
    && fitsClassWindow
    && fitsCapabilityLane
    && !fitsBurst
    && requestState.expectsReservation
    && providerReservationAvailable;
  const burstCapacityBlocked = fitsWindow
    && !fitsBurst
    && !burstReservationRequired
    && !laneEmergencyEligible;
  const classWindowExhausted = !fitsClassWindow && !laneEmergencyEligible;
  const capabilityLaneExhausted = !fitsCapabilityLane && !laneEmergencyEligible;
  const quotaExhausted = (!fitsWindow || classWindowExhausted || capabilityLaneExhausted) && !laneEmergencyEligible;
  const pressureRatio = hardLimit > 0
    ? Number((accountedRequests / hardLimit).toFixed(4))
    : 1;
  const classPressureRatio = classWindowLimit > 0
    ? Number((classAccountedRequests / classWindowLimit).toFixed(4))
    : 1;
  const pressureThreshold = rateProfile.pressureThreshold || CAPABILITY_RATE_CLASS_POLICIES.default.pressureThreshold;
  const classPressure = (pressureRatio >= pressureThreshold || classPressureRatio >= pressureThreshold)
    && fitsWindow
    && fitsClassWindow;
  const capabilityAdmissionPacket = buildCapabilityAdmissionPacket(
    requestState,
    rateProfile,
    {
      remainingBeforeRequest,
      classRemainingBeforeRequest,
      laneRemainingBeforeRequest,
      classPressure
    },
    lanePlan,
    {
      providerReservationAvailable,
      externalHandoffNegotiated: externalHandoffContract.negotiated,
      externalHandoffReady: externalHandoffContract.ready,
      externalHandoffState: externalHandoffContract.state,
      externalHandoffReasonCodes: externalHandoffContract.reasonCodes
    }
  );
  const externalHandoffWorkflow = externalHandoffContract.workflow;
  const reasonCodes = [
    ...capabilityAdmissionPacket.reasonCodes,
    ...externalHandoffWorkflow.reasonCodes.map((reasonCode) => `admission.${reasonCode}`),
    classWindowExhausted ? "admission.class-window-exhausted" : null,
    !fitsWindow && !localEmergencyEligible ? "admission.window-exhausted" : null,
    burstCapacityBlocked ? "admission.burst-capacity-exhausted" : null,
    burstReservationRequired ? "admission.reserve-over-burst" : null,
    reservationPreferred ? "admission.capability-prefers-reservation" : null,
    localEmergencyEligible ? "admission.operator-interrupt-emergency-burst" : null,
    emergencyAdmission.state === "exhausted" ? "admission.operator-interrupt-emergency-exhausted" : null,
    capabilityLaneExhausted ? "admission.capability-lane-exhausted" : null,
    classHandoffBlocked && !externalHandoffContract.negotiated ? "admission.external-handoff-capability-missing" : null,
    classHandoffBlocked && externalHandoffContract.negotiated ? "admission.external-handoff-sync-not-ready" : null,
    ...externalHandoffContract.reasonCodes.map((reasonCode) => `admission.${reasonCode}`),
    classPressure ? `admission.${requestState.capabilityRateClass}-pressure-high` : null,
    !providerReservationAvailable && !fitsBurst ? "admission.provider-reservation-unavailable" : null
  ].filter(Boolean);

  return {
    schema: "rate-limit.admission-guard.v1",
    state: classHandoffBlocked || quotaExhausted || burstCapacityBlocked
      ? "blocked"
      : reservationPreferred || burstReservationRequired
        ? "reservation-required"
        : classPressure
          ? "pressure"
          : "open",
    subjectKey: serviceContract.subjectKey,
    requestId: requestState.requestId,
    routeId: requestState.routeId,
    capabilityRateClass: requestState.capabilityRateClass,
    rateProfile,
    capabilityAdmissionPacket,
    hardLimit,
    burstLimit,
    classBurstLimit,
    classWindowLimit,
    emergencyBurstLimit,
    emergencyAdmission,
    emergencyUnitsRequired: emergencyAdmission.unitsRequired,
    emergencyUnitsGranted: emergencyAdmission.unitsGranted,
    emergencyRemainingUnits: emergencyAdmission.remainingEmergencyUnits,
    externalHandoffContract,
    externalHandoffWorkflow,
    externalHandoffReady: externalHandoffContract.ready,
    externalHandoffState: externalHandoffContract.state,
    capabilityLanePlan: lanePlan,
    capabilityLaneState: lanePlan.state,
    capabilityLaneRemainingBeforeRequest: laneRemainingBeforeRequest,
    capabilityLaneRemainingAfterRequest: laneRemainingAfterRequest,
    capabilityLaneDeficit: lanePlan.laneDeficit,
    steadyLimit,
    accountedRequests,
    classWindowUsed: currentClassLedger.windowUsed,
    classReserved: currentClassLedger.reserved,
    classLocalPending: currentClassLedger.localPending,
    classAccountedRequests,
    requestedCost: requestState.cost,
    baseCost: requestState.baseCost,
    remainingBeforeRequest,
    remainingAfterRequest,
    classRemainingBeforeRequest,
    classRemainingAfterRequest,
    burstBudgetRemaining,
    classBudgetRemaining,
    steadyBudgetRemaining,
    burstInFlight,
    classInFlight,
    pressureRatio,
    classPressureRatio,
    pressureThreshold,
    fitsWindow,
    fitsClassWindow,
    fitsCapabilityLane,
    fitsBurst,
    providerReservationAvailable,
    reservationPreferred,
    burstReservationRequired: reservationPreferred || burstReservationRequired,
    burstCapacityBlocked,
    localEmergencyEligible,
    laneEmergencyEligible,
    classHandoffBlocked,
    classWindowExhausted,
    capabilityLaneExhausted,
    quotaExhausted,
    reasonCodes,
    nextActionId: classHandoffBlocked
      ? externalHandoffWorkflow.nextActionId
      : quotaExhausted
      ? "wait.rate-limit.window"
      : burstCapacityBlocked
        ? "wait.rate-limit.burst-capacity"
        : reservationPreferred || burstReservationRequired
          ? "reserve.rate-limit.quota"
          : "dispatch.capability.request"
  };
}

function buildRuntimeWorkflowHandoff(now, serviceContract, requestState, quotaState, accessBoundary, lifecycleControls, admissionGuard, healthAdmissionPolicy, decision, boundaryDenied, lifecycleBlocked, capabilityBlocked, healthBlocked, shouldReserve) {
  const throttled = decision === "throttle" || decision === "throttle-burst";
  const dispatchAllowed = !boundaryDenied
    && !lifecycleBlocked
    && !capabilityBlocked
    && !healthBlocked
    && !throttled
    && decision !== "deny-lifecycle-invalid";
  const retryAfterMs = throttled
    ? serviceContract.policy.windowMs
    : decision === "lifecycle-paused"
      ? lifecycleControls.nextAction.retryAfterMs
      : healthBlocked
        ? healthAdmissionPolicy.retryAfterMs
      : capabilityBlocked
        ? admissionGuard.externalHandoffWorkflow.retryAfterMs
      : 0;
  const state = boundaryDenied
    ? "deny-at-tenant-workspace-boundary"
    : lifecycleBlocked
      ? "hold-for-lifecycle-control"
      : healthBlocked
        ? "hold-for-provider-health"
      : capabilityBlocked
        ? "hold-for-capability-handoff"
      : throttled
        ? "wait-for-window"
        : shouldReserve
          ? "reserve-before-dispatch"
          : "dispatch-with-local-proof";
  const nextActionId = boundaryDenied
    ? "deny.capability.boundary"
    : lifecycleBlocked
      ? lifecycleControls.nextAction.actionId
      : healthBlocked
        ? healthAdmissionPolicy.nextActionId
      : capabilityBlocked
        ? admissionGuard.nextActionId
      : throttled
        ? admissionGuard.nextActionId
        : shouldReserve
          ? "reserve.rate-limit.quota"
          : "dispatch.capability.request";
  const continuationToken = [
    surfaceId,
    serviceContract.subjectKey,
    requestState.clientId,
    requestState.routeId,
    requestState.requestId
  ].join(":");
  const reasonCodes = [
    ...accessBoundary.violations.map((violation) => `boundary.${violation}`),
    ...lifecycleControls.blockingIssues,
    ...healthAdmissionPolicy.reasonCodes,
    ...admissionGuard.reasonCodes,
    healthBlocked ? "workflow.provider-health-blocked" : null,
    capabilityBlocked ? "workflow.capability-contract-required" : null,
    shouldReserve ? "workflow.reservation-required" : null,
    dispatchAllowed && !shouldReserve ? "workflow.local-proof-dispatch" : null
  ].filter(Boolean);

  return {
    schema: "rate-limit.runtime-workflow-handoff.v1",
    generatedAt: now,
    state,
    nextActionId,
    routeId: requestState.routeId,
    workflowId: requestState.workflowId,
    clientId: requestState.clientId,
    subjectKey: serviceContract.subjectKey,
    continuation: {
      token: continuationToken,
      checkpointKey: `${continuationToken}:checkpoint:${quotaState.snapshotId}`,
      expectedSnapshotId: quotaState.snapshotId,
      resetAt: quotaState.resetAt,
      resumePolicy: capabilityBlocked
        ? admissionGuard.externalHandoffWorkflow.resumePolicy
        : throttled || lifecycleBlocked
          ? "resume-after-next-action"
          : "resume-immediately",
      capabilityHandoffCheckpoint: capabilityBlocked
        ? `${continuationToken}:handoff:${admissionGuard.externalHandoffWorkflow.payloadCursor}`
        : null
    },
    dispatch: {
      allowed: dispatchAllowed && !shouldReserve,
      mode: shouldReserve
        ? "provider-reservation-first"
        : dispatchAllowed
          ? "local-proof"
          : "held",
      retryAfterMs,
      reasonCodes,
      proofRequired: true,
      healthAdmission: {
        schema: healthAdmissionPolicy.schema,
        state: healthAdmissionPolicy.state,
        dispatchMode: healthAdmissionPolicy.dispatchMode,
        reservationAllowed: healthAdmissionPolicy.reservationAllowed,
        degradedLocalProofAllowed: healthAdmissionPolicy.degradedLocalProofAllowed,
        retryAfterMs: healthAdmissionPolicy.retryAfterMs,
        nextActionId: healthAdmissionPolicy.nextActionId,
        errorContract: healthAdmissionPolicy.errorContract
      },
      capabilityHandoffDisposition: admissionGuard.externalHandoffWorkflow.clientDisposition
    },
    capabilityHandoff: {
      schema: admissionGuard.externalHandoffWorkflow.schema,
      state: admissionGuard.externalHandoffWorkflow.state,
      required: admissionGuard.externalHandoffWorkflow.required,
      blocking: admissionGuard.externalHandoffWorkflow.blocking,
      nextActionId: admissionGuard.externalHandoffWorkflow.nextActionId,
      owner: admissionGuard.externalHandoffWorkflow.owner,
      retryAfterMs: admissionGuard.externalHandoffWorkflow.retryAfterMs,
      checkpointPolicy: admissionGuard.externalHandoffWorkflow.checkpointPolicy,
      payloadCursor: admissionGuard.externalHandoffWorkflow.payloadCursor,
      reasonCodes: admissionGuard.externalHandoffWorkflow.reasonCodes
    },
    reservation: {
      required: shouldReserve,
      reservationId: shouldReserve ? `${continuationToken}:reservation` : null,
      idempotencyKey: shouldReserve ? `${continuationToken}:reserve:${requestState.cost}` : null,
      units: requestState.cost,
      providerReservationAvailable: admissionGuard.providerReservationAvailable,
      commitBeforeDispatch: shouldReserve,
      releaseOnWorkflowCancel: shouldReserve
    },
    clientStatePatch: {
      schema: "rate-limit.client-state-patch.v1",
      operation: shouldReserve
        ? "reserve"
        : dispatchAllowed
          ? "account-local-dispatch"
          : "observe-hold",
      snapshotId: quotaState.snapshotId,
      windowUsed: quotaState.windowUsed + (dispatchAllowed && !shouldReserve ? requestState.cost : 0),
      reserved: quotaState.reserved + (shouldReserve ? requestState.cost : 0),
      localPending: quotaState.localPending,
      remainingAfterRequest: admissionGuard.remainingAfterRequest,
      capabilityClassLedger: {
        capabilityRateClass: requestState.capabilityRateClass,
        capabilityLaneState: admissionGuard.capabilityLaneState,
        externalHandoffState: admissionGuard.externalHandoffState,
        externalHandoffReady: admissionGuard.externalHandoffReady,
        admissionPath: admissionGuard.capabilityAdmissionPacket.path,
        admissionAction: admissionGuard.capabilityAdmissionPacket.action,
        operation: shouldReserve
          ? "reserve"
          : dispatchAllowed
            ? "account-local-dispatch"
            : "observe-hold",
        windowUsed: admissionGuard.classWindowUsed + (dispatchAllowed && !shouldReserve ? requestState.cost : 0),
        reserved: admissionGuard.classReserved + (shouldReserve ? requestState.cost : 0),
        localPending: admissionGuard.classLocalPending,
        accountedRequests: admissionGuard.classAccountedRequests + (
          shouldReserve || (dispatchAllowed && !shouldReserve) ? requestState.cost : 0
        ),
        remainingAfterRequest: admissionGuard.classRemainingAfterRequest,
        classWindowLimit: admissionGuard.classWindowLimit,
        laneRemainingAfterRequest: admissionGuard.capabilityLaneRemainingAfterRequest,
        laneDeficit: admissionGuard.capabilityLaneDeficit,
        emergencyAdmission: admissionGuard.emergencyAdmission
      },
      capabilityAdmissionPacket: admissionGuard.capabilityAdmissionPacket,
      externalHandoffContract: admissionGuard.externalHandoffContract,
      externalHandoffWorkflow: admissionGuard.externalHandoffWorkflow,
      emergencyAdmission: admissionGuard.emergencyAdmission,
      pressureRatio: admissionGuard.pressureRatio
    },
    proof: {
      proofId: `${continuationToken}:proof`,
      auditSubject: serviceContract.subjectKey,
      requestedCost: requestState.cost,
      decision,
      capabilityRateClass: requestState.capabilityRateClass,
      boundaryState: accessBoundary.state,
      lifecycleState: lifecycleControls.state,
      admissionGuardState: admissionGuard.state,
      healthAdmissionState: healthAdmissionPolicy.state,
      healthAdmissionPolicy,
      capabilityAdmissionPacket: admissionGuard.capabilityAdmissionPacket,
      externalHandoffContract: admissionGuard.externalHandoffContract,
      externalHandoffWorkflow: admissionGuard.externalHandoffWorkflow,
      reasonCodes
    }
  };
}

function buildRuntimeDecision(now, serviceContract, providerContract, negotiation, syncMetadata, requestState, quotaState, accessBoundary, lifecycleControls, operationalHealth) {
  const admissionGuard = buildAdmissionGuard(serviceContract, providerContract, negotiation, syncMetadata, requestState, quotaState, lifecycleControls);
  const healthAdmissionPolicy = buildHealthAdmissionPolicy(operationalHealth, requestState, lifecycleControls);
  const boundaryDenied = accessBoundary.enforced && accessBoundary.violations.length > 0;
  const lifecycleBlocked = lifecycleControls.state === "invalid" || lifecycleControls.state === "paused";
  const capabilityBlocked = admissionGuard.classHandoffBlocked;
  const healthBlocked = healthAdmissionPolicy.blocking;
  const locallyAdmissible = admissionGuard.fitsWindow || admissionGuard.localEmergencyEligible;
  const shouldReserve = lifecycleControls.enforcementEnabled
    && !boundaryDenied
    && !lifecycleBlocked
    && !capabilityBlocked
    && !healthBlocked
    && healthAdmissionPolicy.reservationAllowed
    && admissionGuard.fitsWindow
    && admissionGuard.fitsCapabilityLane
    && requestState.expectsReservation
    && admissionGuard.providerReservationAvailable
    && admissionGuard.burstReservationRequired;
  const decision = boundaryDenied
    ? "deny-boundary"
    : lifecycleControls.state === "invalid"
      ? "deny-lifecycle-invalid"
      : lifecycleControls.state === "paused"
        ? "lifecycle-paused"
        : capabilityBlocked
          ? "deny-capability-contract"
        : healthBlocked
          ? "deny-provider-unhealthy"
        : !lifecycleControls.enforcementEnabled
          ? "bypass-disabled"
          : admissionGuard.quotaExhausted
            ? "throttle"
            : admissionGuard.burstCapacityBlocked
              ? "throttle-burst"
              : locallyAdmissible
          ? shouldReserve ? "reserve" : "allow-local"
            : "throttle";
  const workflowHandoff = buildRuntimeWorkflowHandoff(
    now,
    serviceContract,
    requestState,
    quotaState,
    accessBoundary,
    lifecycleControls,
    admissionGuard,
    healthAdmissionPolicy,
    decision,
    boundaryDenied,
    lifecycleBlocked,
    capabilityBlocked,
    healthBlocked,
    shouldReserve
  );

  return {
    schema: "rate-limit.runtime-decision.v1",
    generatedAt: now,
    subjectKey: serviceContract.subjectKey,
    request: requestState,
    clientQuota: quotaState,
    admissionGuard,
    healthAdmissionPolicy,
    accounting: {
      hardLimit: admissionGuard.hardLimit,
      remainingBeforeRequest: admissionGuard.remainingBeforeRequest,
      remainingAfterRequest: admissionGuard.remainingAfterRequest,
      requestedCost: requestState.cost,
      baseCost: requestState.baseCost,
      capabilityRateClass: requestState.capabilityRateClass,
      classWeight: requestState.rateProfile.classWeight,
      capabilityAdmissionPacket: admissionGuard.capabilityAdmissionPacket,
      externalHandoffContract: admissionGuard.externalHandoffContract,
      externalHandoffWorkflow: admissionGuard.externalHandoffWorkflow,
      classWindowLimit: admissionGuard.classWindowLimit,
      capabilityLanePlan: admissionGuard.capabilityLanePlan,
      capabilityLaneState: admissionGuard.capabilityLaneState,
      capabilityLaneRemainingBeforeRequest: admissionGuard.capabilityLaneRemainingBeforeRequest,
      capabilityLaneRemainingAfterRequest: admissionGuard.capabilityLaneRemainingAfterRequest,
      capabilityLaneDeficit: admissionGuard.capabilityLaneDeficit,
      emergencyAdmission: admissionGuard.emergencyAdmission,
      emergencyUnitsGranted: admissionGuard.emergencyUnitsGranted,
      classAccountedRequests: admissionGuard.classAccountedRequests,
      classRemainingBeforeRequest: admissionGuard.classRemainingBeforeRequest,
      classRemainingAfterRequest: admissionGuard.classRemainingAfterRequest,
      classBudgetRemaining: admissionGuard.classBudgetRemaining,
      classPressureRatio: admissionGuard.classPressureRatio,
      burstBudgetRemaining: admissionGuard.burstBudgetRemaining,
      steadyBudgetRemaining: admissionGuard.steadyBudgetRemaining,
      burstInFlight: admissionGuard.burstInFlight,
      pressureRatio: admissionGuard.pressureRatio
    },
    decision,
    allowed: !["throttle", "throttle-burst", "deny-boundary", "deny-lifecycle-invalid", "deny-capability-contract", "deny-provider-unhealthy", "lifecycle-paused"].includes(decision),
    boundaryAllowed: !boundaryDenied,
    capabilityContractAllowed: !capabilityBlocked,
    providerHealthAllowed: !healthBlocked,
    reservationRequired: decision === "reserve",
    retryAfterMs: decision === "throttle" || decision === "throttle-burst"
      ? serviceContract.policy.windowMs
      : decision === "lifecycle-paused"
        ? lifecycleControls.nextAction.retryAfterMs
        : decision === "deny-provider-unhealthy"
          ? healthAdmissionPolicy.retryAfterMs
        : 0,
    lifecycle: {
      state: lifecycleControls.state,
      enabled: lifecycleControls.enabled,
      enforcementEnabled: lifecycleControls.enforcementEnabled,
      reservationsEnabled: lifecycleControls.reservationsEnabled,
      nextActionId: lifecycleControls.nextAction.actionId,
      validationIssues: lifecycleControls.validationIssues
    },
    accessBoundary: {
      state: accessBoundary.state,
      mode: accessBoundary.mode,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      requestScope: accessBoundary.requestScope,
      role: accessBoundary.role,
      violations: accessBoundary.violations,
      missingPermissions: accessBoundary.missingPermissions,
      allowlists: accessBoundary.allowlists,
      workspaceGrant: {
        required: accessBoundary.workspaceGrant.required,
        present: accessBoundary.workspaceGrant.present,
        accepted: accessBoundary.workspaceGrant.accepted,
        matchedGrantIds: accessBoundary.workspaceGrant.matchedGrantIds,
        rejectedGrantIds: accessBoundary.workspaceGrant.rejectedGrantIds,
        rejectedGrantReasons: accessBoundary.workspaceGrant.rejectedGrantReasons
      }
    },
    workflowHandoff
  };
}

function buildExternalHandoff(input, providerContract, serviceContract, syncMetadata, negotiation, runtimeDecision, accessBoundary) {
  const handoff = asObject(input.externalHandoff);
  const providerProfile = resolveExternalProviderProfile(input, providerContract, serviceContract, runtimeDecision.request);
  const operationKind = inferExternalProviderOperationKind(providerProfile, runtimeDecision.request, serviceContract);
  const safetyEnvelope = buildExternalProviderSafetyEnvelope({
    providerProfile,
    operationKind,
    providerContract,
    serviceContract,
    syncMetadata,
    requestState: runtimeDecision.request,
    accessBoundary,
    runtimeDecision,
    source: handoff
  });
  const workflowContract = buildExternalProviderWorkflowContract({
    providerProfile,
    operationKind,
    providerContract,
    serviceContract,
    syncMetadata,
    requestState: runtimeDecision.request,
    runtimeDecision,
    safetyEnvelope
  });
  const profileCapabilitiesMissing = providerProfile.requiredCapabilities.filter((capability) => (
    !providerContract.capabilities.includes(capability)
  ));
  const profileNegotiationMissing = providerProfile.requiredCapabilities.filter((capability) => (
    !negotiation.accepted.includes(capability)
  ));
  const requested = handoff.enabled !== false
    && negotiation.accepted.includes("rate-limit.external-handoff.v1")
    && accessBoundary.state === "satisfied"
    && profileNegotiationMissing.length === 0;

  return {
    enabled: requested && safetyEnvelope.safeToDispatch,
    state: requested
      ? safetyEnvelope.safeToDispatch
        ? "ready"
        : "blocked-by-provider-safety"
      : accessBoundary.state !== "satisfied"
        ? "blocked-by-boundary"
        : profileNegotiationMissing.length
          ? "blocked-by-provider-profile"
          : "disabled",
    destination: requested
      ? asIdentifier(
          handoff.destination,
          providerProfile.defaultEndpointPath
            ? `${providerContract.endpoint}${providerProfile.defaultEndpointPath}`
            : providerContract.endpoint
        )
      : null,
    handoffKey: requested ? `${syncMetadata.syncKey}:external` : null,
    providerProfile: {
      schema: providerProfile.schema,
      providerProfile: providerProfile.providerProfile,
      source: providerProfile.source,
      operationKind,
      preferredCapabilityRateClass: providerProfile.preferredCapabilityRateClass,
      requiredCapabilities: providerProfile.requiredCapabilities,
      missingCapabilities: profileCapabilitiesMissing,
      missingNegotiatedCapabilities: profileNegotiationMissing,
      remoteIdempotencyHeaders: providerProfile.remoteIdempotencyHeaders,
      retryHeaderNames: providerProfile.retryHeaderNames
    },
    workflowContract,
    providerSafety: safetyEnvelope,
    payloadContract: requested
      ? {
          surfaceId,
          providerId: providerContract.providerId,
          serviceId: serviceContract.serviceId,
          subjectKey: serviceContract.subjectKey,
          policy: serviceContract.policy,
          externalProviderProfile: {
            providerProfile: providerProfile.providerProfile,
            operationKind,
            requiredCapabilities: providerProfile.requiredCapabilities,
            remoteIdempotencyHeaders: providerProfile.remoteIdempotencyHeaders,
            retryHeaderNames: providerProfile.retryHeaderNames
          },
          workflowContract,
          providerSafety: safetyEnvelope,
          cursor: syncMetadata.cursor,
          runtimeDecision: runtimeDecision
            ? {
                requestId: runtimeDecision.request.requestId,
                clientId: runtimeDecision.request.clientId,
                capabilityRateClass: runtimeDecision.request.capabilityRateClass,
                decision: runtimeDecision.decision,
                requestedCost: runtimeDecision.accounting.requestedCost,
                baseCost: runtimeDecision.accounting.baseCost,
                capabilityAdmissionPacket: runtimeDecision.accounting.capabilityAdmissionPacket,
                remainingAfterRequest: runtimeDecision.accounting.remainingAfterRequest,
                classWindowLimit: runtimeDecision.accounting.classWindowLimit,
                classRemainingAfterRequest: runtimeDecision.accounting.classRemainingAfterRequest,
                capabilityLaneState: runtimeDecision.accounting.capabilityLaneState,
                capabilityLaneRemainingAfterRequest: runtimeDecision.accounting.capabilityLaneRemainingAfterRequest,
                emergencyAdmission: runtimeDecision.accounting.emergencyAdmission,
                admissionGuard: {
                  state: runtimeDecision.admissionGuard.state,
                  capabilityAdmissionPacket: runtimeDecision.admissionGuard.capabilityAdmissionPacket,
                  externalHandoffWorkflow: runtimeDecision.admissionGuard.externalHandoffWorkflow,
                  burstBudgetRemaining: runtimeDecision.admissionGuard.burstBudgetRemaining,
                  classBudgetRemaining: runtimeDecision.admissionGuard.classBudgetRemaining,
                  capabilityLaneDeficit: runtimeDecision.admissionGuard.capabilityLaneDeficit,
                  emergencyUnitsGranted: runtimeDecision.admissionGuard.emergencyUnitsGranted,
                  pressureRatio: runtimeDecision.admissionGuard.pressureRatio,
                  classPressureRatio: runtimeDecision.admissionGuard.classPressureRatio,
                  reasonCodes: runtimeDecision.admissionGuard.reasonCodes,
                  nextActionId: runtimeDecision.admissionGuard.nextActionId
                },
                accessBoundary: runtimeDecision.accessBoundary,
                workflowHandoff: runtimeDecision.workflowHandoff
              }
            : null
        }
      : null
  };
}

function buildProviderServiceBridge(input, providerContract, serviceContract, syncMetadata, negotiation, runtimeDecision, externalHandoff, accessBoundary, operationalHealth) {
  const bridge = asObject(input.providerServiceBridge || input.serviceProviderBridge || input.externalProviderState);
  const delivery = asObject(bridge.delivery || bridge.handoffDelivery);
  const acknowledgement = asObject(bridge.acknowledgement || bridge.ack || bridge.providerAck);
  const providerProfile = externalHandoff.providerProfile || resolveExternalProviderProfile(
    input,
    providerContract,
    serviceContract,
    runtimeDecision.request
  );
  const providerSafety = externalHandoff.providerSafety || buildExternalProviderSafetyEnvelope({
    providerProfile,
    operationKind: providerProfile.operationKind || inferExternalProviderOperationKind(
      providerProfile,
      runtimeDecision.request,
      serviceContract
    ),
    providerContract,
    serviceContract,
    syncMetadata,
    requestState: runtimeDecision.request,
    accessBoundary,
    runtimeDecision,
    source: bridge
  });
  const supportedProtocolVersions = Array.isArray(bridge.protocolVersions)
    ? bridge.protocolVersions.filter((version) => Number.isInteger(version) && version > 0)
    : [1];
  const protocolVersion = supportedProtocolVersions.includes(1) ? 1 : supportedProtocolVersions[0] || 1;
  const requestedState = asIdentifier(bridge.state || delivery.state, null);
  const destination = externalHandoff.destination || asIdentifier(bridge.destination, providerContract.endpoint);
  const ackTimeoutMs = Math.max(1_000, asPositiveInteger(
    acknowledgement.timeoutMs || bridge.ackTimeoutMs,
    Math.min(30_000, Math.max(1_000, Math.round(serviceContract.policy.windowMs / 2)))
  ));
  const lastAckCursor = asIdentifier(
    acknowledgement.cursor || acknowledgement.lastCursor || bridge.lastAckCursor,
    null
  );
  const requestedDeliveryId = asIdentifier(
    delivery.deliveryId || bridge.deliveryId,
    `${syncMetadata.syncKey}:handoff:${runtimeDecision.request.requestId}`
  );
  const remoteIdempotencyKey = asIdentifier(
    delivery.remoteIdempotencyKey || bridge.remoteIdempotencyKey || bridge.idempotencyKey,
    `${serviceContract.subjectKey}:${runtimeDecision.request.requestId}:${runtimeDecision.accounting.requestedCost}`
  );
  const handoffPossible = externalHandoff.enabled
    && accessBoundary.state === "satisfied"
    && negotiation.accepted.includes("rate-limit.external-handoff.v1")
    && syncMetadata.providerSyncLease.writeAllowed
    && operationalHealth.state !== "unhealthy"
    && providerSafety.safeToDispatch;
  const workflowContract = externalHandoff.workflowContract || buildExternalProviderWorkflowContract({
    providerProfile,
    operationKind: providerProfile.operationKind || inferExternalProviderOperationKind(
      providerProfile,
      runtimeDecision.request,
      serviceContract
    ),
    providerContract,
    serviceContract,
    syncMetadata,
    requestState: runtimeDecision.request,
    runtimeDecision,
    safetyEnvelope: providerSafety
  });
  const dispatchAllowed = runtimeDecision.allowed
    && !runtimeDecision.reservationRequired
    && handoffPossible;
  const bridgeState = !handoffPossible
    ? "not-available"
    : operationalHealth.state === "degraded"
      ? "degraded-local-proof"
      : requestedState && ["delivered", "acknowledged", "failed"].includes(requestedState)
        ? requestedState
        : dispatchAllowed
          ? "ready-to-deliver"
          : "hold-before-delivery";
  const requiredAck = bridgeState === "ready-to-deliver" || bridgeState === "delivered";
  const cursorAcknowledged = Boolean(lastAckCursor && lastAckCursor === syncMetadata.cursor);
  const ackState = !requiredAck
    ? "not-required"
    : cursorAcknowledged || bridgeState === "acknowledged"
      ? "acknowledged"
      : "pending";

  return {
    schema: "rate-limit.provider-service-bridge.v1",
    state: bridgeState,
    providerId: providerContract.providerId,
    serviceId: serviceContract.serviceId,
    subjectKey: serviceContract.subjectKey,
    syncKey: syncMetadata.syncKey,
    protocol: {
      name: "hosted-kernel-rate-limit-handoff",
      version: protocolVersion,
      endpoint: destination,
      requiredCapabilities: ["rate-limit.snapshot.v1", "rate-limit.audit.v1", "rate-limit.external-handoff.v1"],
      negotiatedCapabilities: negotiation.accepted,
      unsupportedCapabilities: negotiation.missingRequired,
      providerProfile: providerProfile.providerProfile || "generic",
      providerOperationKind: providerProfile.operationKind || inferExternalProviderOperationKind(
        providerProfile,
        runtimeDecision.request,
        serviceContract
      )
    },
    delivery: {
      deliveryId: requestedDeliveryId,
      state: bridgeState,
      dispatchAllowed,
      reasonCode: !syncMetadata.providerSyncLease.writeAllowed
        ? "bridge.sync-lease-not-writable"
        : !providerSafety.safeToDispatch
          ? providerSafety.dispatch.reasonCodes[0] || "bridge.provider-safety-hold"
        : !handoffPossible
          ? "bridge.handoff-not-available"
        : !runtimeDecision.allowed
          ? `bridge.runtime-${runtimeDecision.decision}`
          : runtimeDecision.reservationRequired
            ? "bridge.awaiting-reservation-commit"
            : operationalHealth.state === "degraded"
              ? "bridge.degraded-local-proof"
              : "bridge.ready",
      attempt: Math.max(0, asNonNegativeInteger(delivery.attempt, 0)),
      nextAttemptAfterMs: operationalHealth.retryAfterMs,
      cursor: syncMetadata.cursor,
      remoteIdempotencyKey,
      remoteIdempotencyHeaders: Object.fromEntries(
        (providerProfile.remoteIdempotencyHeaders || []).map((header) => [header, remoteIdempotencyKey])
      ),
      retryHeaderNames: providerProfile.retryHeaderNames || []
    },
    providerSafety,
    syncLease: {
      state: syncMetadata.providerSyncLease.lease.state,
      handoffState: syncMetadata.providerSyncLease.handoffState,
      writeAllowed: syncMetadata.providerSyncLease.writeAllowed,
      providerWatermarkState: syncMetadata.providerSyncLease.providerWatermark.state,
      reasonCodes: syncMetadata.providerSyncLease.reasonCodes
    },
    acknowledgement: {
      required: requiredAck,
      state: ackState,
      timeoutMs: ackTimeoutMs,
      lastAckCursor,
      idempotencyKey: `${requestedDeliveryId}:ack:${syncMetadata.cursor}`
    },
    serviceEnvelope: {
      schema: "rate-limit.service-envelope.v1",
      requestId: runtimeDecision.request.requestId,
      routeId: runtimeDecision.request.routeId,
      workflowId: runtimeDecision.request.workflowId,
      clientId: runtimeDecision.request.clientId,
      decision: runtimeDecision.decision,
      allowed: runtimeDecision.allowed,
      requestedCost: runtimeDecision.accounting.requestedCost,
      capabilityAdmissionPacket: runtimeDecision.accounting.capabilityAdmissionPacket,
      remainingAfterRequest: runtimeDecision.accounting.remainingAfterRequest,
      classWindowLimit: runtimeDecision.accounting.classWindowLimit,
      classRemainingAfterRequest: runtimeDecision.accounting.classRemainingAfterRequest,
      capabilityLaneState: runtimeDecision.accounting.capabilityLaneState,
      capabilityLaneRemainingAfterRequest: runtimeDecision.accounting.capabilityLaneRemainingAfterRequest,
      emergencyAdmission: runtimeDecision.accounting.emergencyAdmission,
      admissionGuardState: runtimeDecision.admissionGuard.state,
      admissionGuardReasons: runtimeDecision.admissionGuard.reasonCodes,
      policyVersion: serviceContract.policy.version,
      windowMs: serviceContract.policy.windowMs,
      maxRequests: serviceContract.policy.maxRequests,
      cursor: syncMetadata.cursor
    },
    providerProfile: {
      schema: "rate-limit.provider-service-bridge-profile.v1",
      providerProfile: providerProfile.providerProfile || "generic",
      operationKind: providerProfile.operationKind || inferExternalProviderOperationKind(
        providerProfile,
        runtimeDecision.request,
        serviceContract
      ),
      requiredCapabilities: providerProfile.requiredCapabilities || [],
      remoteIdempotencyKey,
      remoteIdempotencyHeaders: providerProfile.remoteIdempotencyHeaders || [],
      retryHeaderNames: providerProfile.retryHeaderNames || [],
      restartSafeDeliveryKey: `${requestedDeliveryId}:remote:${remoteIdempotencyKey}`,
      safetyEnvelopeState: providerSafety.state,
      safetyNextActionId: providerSafety.dispatch.nextActionId,
      replayFenceKey: providerSafety.replayFence.key
    },
    workflowContract
  };
}

function buildProviderHandoffReceipt(now, input, serviceContract, syncMetadata, runtimeDecision, externalHandoff, providerServiceBridge) {
  const bridge = asObject(input.providerServiceBridge || input.serviceProviderBridge || input.externalProviderState);
  const receiptSource = asObject(
    input.providerHandoffReceipt || input.handoffReceipt || bridge.receipt || bridge.providerReceipt
  );
  const errors = Array.isArray(receiptSource.errors)
    ? receiptSource.errors
        .filter((error) => error && typeof error === "object")
        .slice(0, 10)
        .map((error, index) => ({
          code: asIdentifier(error.code, `provider-receipt.error.${index + 1}`),
          message: asIdentifier(error.message, null),
          retryable: asBoolean(error.retryable, false)
        }))
    : [];
  const required = externalHandoff.enabled
    && providerServiceBridge.acknowledgement.required
    && providerServiceBridge.delivery.state !== "not-available";
  const expectedDeliveryId = providerServiceBridge.delivery.deliveryId;
  const expectedCursor = syncMetadata.cursor;
  const receiptId = asIdentifier(receiptSource.receiptId || receiptSource.id, null);
  const deliveryId = asIdentifier(receiptSource.deliveryId, null);
  const cursor = asIdentifier(receiptSource.cursor || receiptSource.ackCursor, null);
  const receivedAt = asIdentifier(receiptSource.receivedAt || receiptSource.observedAt || receiptSource.at, null);
  const receivedAtMs = asTimestampMs(receivedAt);
  const nowMs = Date.parse(now);
  const status = ["accepted", "queued", "rejected", "duplicate"].includes(receiptSource.status)
    ? receiptSource.status
    : receiptId
      ? "accepted"
      : "missing";
  const deliveryMatches = Boolean(deliveryId && deliveryId === expectedDeliveryId);
  const cursorMatches = Boolean(cursor && cursor === expectedCursor);
  const staleReceipt = Boolean(receivedAtMs && nowMs - receivedAtMs > providerServiceBridge.acknowledgement.timeoutMs);
  const signatureRef = asIdentifier(receiptSource.signatureRef || receiptSource.signature || receiptSource.proof, null);
  const replayToken = asIdentifier(receiptSource.replayToken || receiptSource.replayKey, null);
  const rejectionReason = asIdentifier(receiptSource.reasonCode || receiptSource.rejectionReason, null);
  const violationCodes = [
    required && !receiptId ? "receipt.missing" : null,
    receiptId && !deliveryMatches ? "receipt.delivery-mismatch" : null,
    receiptId && !cursorMatches ? "receipt.cursor-mismatch" : null,
    receiptId && status === "rejected" ? "receipt.rejected" : null,
    receiptId && staleReceipt ? "receipt.stale" : null,
    errors.length ? "receipt.provider-errors" : null
  ].filter(Boolean);
  const acceptedStatus = ["accepted", "queued", "duplicate"].includes(status);
  const state = !required
    ? "not-required"
    : !receiptId
      ? "awaiting-receipt"
      : violationCodes.length
        ? "invalid"
        : acceptedStatus
          ? "accepted"
          : "pending";

  return {
    schema: "rate-limit.provider-handoff-receipt.v1",
    generatedAt: now,
    state,
    required,
    providerId: providerServiceBridge.providerId,
    serviceId: serviceContract.serviceId,
    subjectKey: serviceContract.subjectKey,
    syncKey: syncMetadata.syncKey,
    receipt: {
      receiptId,
      status,
      deliveryId,
      expectedDeliveryId,
      cursor,
      expectedCursor,
      receivedAt,
      staleReceipt,
      signatureRef,
      replayToken,
      rejectionReason,
      errors
    },
    matches: {
      delivery: deliveryMatches,
      cursor: cursorMatches,
      acknowledgement: providerServiceBridge.acknowledgement.state === "acknowledged"
    },
    durability: {
      state: state === "accepted"
        ? "ready-to-persist"
        : state === "not-required"
          ? "not-applicable"
          : "hold",
      ledgerCursor: asIdentifier(receiptSource.ledgerCursor || receiptSource.providerCursor, null),
      idempotencyKey: `${expectedDeliveryId}:receipt:${expectedCursor}`,
      persistBeforeDispatch: required && runtimeDecision.allowed,
      replayTokenRequired: required && status === "queued"
    },
    violationCodes,
    nextAction: {
      actionId: state === "accepted" || state === "not-required"
        ? "persist.rate-limit.provider-handoff-receipt"
        : state === "invalid"
          ? "repair.rate-limit.provider-handoff-receipt"
          : "await.rate-limit.provider-handoff-receipt",
      retryAfterMs: state === "awaiting-receipt" ? providerServiceBridge.acknowledgement.timeoutMs : 0
    },
    proof: {
      proofId: `${expectedDeliveryId}:receipt-proof:${expectedCursor}`,
      deliveryId: expectedDeliveryId,
      cursor: expectedCursor,
      receiptId,
      violationCodes
    }
  };
}

function buildProviderOperationContract(input, providerContract, serviceContract, negotiation, syncMetadata, runtimeDecision, externalHandoff, providerServiceBridge) {
  const source = asObject(input.providerOperationContract || input.operationContract || input.providerOperations);
  const declaredOperations = asObject(source.operations || source);
  const defaults = asObject(source.defaults);
  const providerProfile = providerServiceBridge.providerProfile || externalHandoff.providerProfile || resolveExternalProviderProfile(
    input,
    providerContract,
    serviceContract,
    runtimeDecision.request
  );
  const providerOperationKind = providerProfile.operationKind || inferExternalProviderOperationKind(
    providerProfile,
    runtimeDecision.request,
    serviceContract
  );
  const defaultTtlMs = Math.max(1_000, asPositiveInteger(
    defaults.ttlMs || source.ttlMs,
    Math.min(serviceContract.policy.windowMs, 30_000)
  ));
  const defaultTimeoutMs = Math.max(250, asPositiveInteger(defaults.timeoutMs || source.timeoutMs, 2_500));
  const operationSpecs = [
    {
      operation: "snapshot",
      capability: "rate-limit.snapshot.v1",
      required: true,
      mutatesLedger: false,
      defaultPath: "/rate-limit/snapshot",
      defaultMethod: "GET"
    },
    {
      operation: "reserve",
      capability: "rate-limit.reserve.v1",
      required: runtimeDecision.reservationRequired,
      mutatesLedger: true,
      defaultPath: "/rate-limit/reservations",
      defaultMethod: "POST"
    },
    {
      operation: "release",
      capability: "rate-limit.release.v1",
      required: false,
      mutatesLedger: true,
      defaultPath: "/rate-limit/reservations/release",
      defaultMethod: "POST"
    },
    {
      operation: "audit",
      capability: "rate-limit.audit.v1",
      required: true,
      mutatesLedger: false,
      defaultPath: "/rate-limit/audit",
      defaultMethod: "POST"
    },
    {
      operation: "external-handoff",
      capability: "rate-limit.external-handoff.v1",
      required: externalHandoff.enabled,
      mutatesLedger: false,
      defaultPath: "/rate-limit/handoff",
      defaultMethod: "POST"
    }
  ];
  const operations = operationSpecs.map((spec) => {
    const declared = asObject(declaredOperations[spec.operation]);
    const requiredCapabilities = asIdentifierList(declared.requiredCapabilities).length
      ? asIdentifierList(declared.requiredCapabilities)
      : [spec.capability];
    const advertised = providerContract.capabilities.includes(spec.capability);
    const negotiated = negotiation.accepted.includes(spec.capability);
    const missingCapabilities = requiredCapabilities.filter((capability) => (
      !providerContract.capabilities.includes(capability)
    ));
    const endpoint = asIdentifier(
      declared.endpoint || declared.url,
      `${providerContract.endpoint}${spec.defaultPath}`
    );
    const method = asIdentifier(declared.method, spec.defaultMethod).toUpperCase();
    const ttlMs = Math.max(1_000, asPositiveInteger(declared.ttlMs, defaultTtlMs));
    const timeoutMs = Math.max(250, asPositiveInteger(declared.timeoutMs, defaultTimeoutMs));
    const idempotencyRequired = asBoolean(declared.idempotencyRequired, spec.mutatesLedger);
    const idempotencyKey = asIdentifier(
      declared.idempotencyKey,
      `${syncMetadata.syncKey}:${spec.operation}:${runtimeDecision.request.requestId}`
    );
    const remoteIdempotencyKey = asIdentifier(
      declared.remoteIdempotencyKey,
      providerServiceBridge.delivery.remoteIdempotencyKey || idempotencyKey
    );
    const supportsDryRun = asBoolean(declared.supportsDryRun, !spec.mutatesLedger);
    const consistency = spec.mutatesLedger
      ? syncMetadata.providerSyncLease.writeAllowed ? "sync-lease-required" : "blocked-by-sync-lease"
      : "snapshot-consistent";
    const violationCodes = [
      advertised ? null : "operation.capability-not-advertised",
      negotiated ? null : "operation.capability-not-negotiated",
      missingCapabilities.length ? "operation.required-capability-missing" : null,
      !endpoint ? "operation.endpoint-missing" : null,
      spec.mutatesLedger && idempotencyRequired && !idempotencyKey ? "operation.idempotency-key-missing" : null,
      timeoutMs > ttlMs ? "operation.timeout-exceeds-ttl" : null,
      spec.mutatesLedger && !syncMetadata.providerSyncLease.writeAllowed ? "operation.sync-lease-not-writable" : null
    ].filter(Boolean);
    const optionalBlocked = !spec.required && violationCodes.length > 0;

    return {
      schema: "rate-limit.provider-operation.v1",
      operation: spec.operation,
      capability: spec.capability,
      required: spec.required,
      advertised,
      negotiated,
      state: violationCodes.length
        ? spec.required ? "invalid" : "unavailable"
        : "ready",
      endpoint,
      method,
      timeoutMs,
      ttlMs,
      idempotency: {
        required: idempotencyRequired,
        key: idempotencyRequired ? idempotencyKey : null,
        scope: `${serviceContract.subjectKey}:${spec.operation}`,
        remoteKey: idempotencyRequired ? remoteIdempotencyKey : null,
        remoteHeaders: idempotencyRequired
          ? Object.fromEntries((providerProfile.remoteIdempotencyHeaders || []).map((header) => [
              header,
              remoteIdempotencyKey
            ]))
          : {}
      },
      consistency,
      supportsDryRun,
      externalProvider: {
        providerProfile: providerProfile.providerProfile || "generic",
        operationKind: providerOperationKind,
        retryHeaderNames: providerProfile.retryHeaderNames || [],
        restartSafeDeliveryKey: providerServiceBridge.providerProfile?.restartSafeDeliveryKey || ""
      },
      missingCapabilities,
      violationCodes: optionalBlocked
        ? violationCodes.filter((code) => code !== "operation.sync-lease-not-writable")
        : violationCodes
    };
  });
  const requiredOperations = operations.filter((operation) => operation.required);
  const invalidRequired = requiredOperations.filter((operation) => operation.state === "invalid");
  const warningOperations = operations.filter((operation) => operation.state === "unavailable");
  const reserveOperation = operations.find((operation) => operation.operation === "reserve");
  const handoffOperation = operations.find((operation) => operation.operation === "external-handoff");

  return {
    schema: "rate-limit.provider-operation-contract.v1",
    state: invalidRequired.length
      ? "invalid"
      : warningOperations.length
        ? "degraded"
        : "ready",
    providerId: providerContract.providerId,
    serviceId: serviceContract.serviceId,
    subjectKey: serviceContract.subjectKey,
    syncKey: syncMetadata.syncKey,
    bridgeDeliveryId: providerServiceBridge.delivery.deliveryId,
    externalProvider: {
      providerProfile: providerProfile.providerProfile || "generic",
      operationKind: providerOperationKind,
      remoteIdempotencyKey: providerServiceBridge.delivery.remoteIdempotencyKey,
      requiredCapabilities: providerProfile.requiredCapabilities || [],
      retryHeaderNames: providerProfile.retryHeaderNames || [],
      restartSafeDeliveryKey: providerServiceBridge.providerProfile?.restartSafeDeliveryKey || ""
    },
    defaults: {
      ttlMs: defaultTtlMs,
      timeoutMs: defaultTimeoutMs,
      endpointBase: providerContract.endpoint
    },
    operations,
    capabilityMatrix: operations.map((operation) => ({
      operation: operation.operation,
      capability: operation.capability,
      advertised: operation.advertised,
      negotiated: operation.negotiated,
      required: operation.required,
      state: operation.state
    })),
    reserveState: reserveOperation ? reserveOperation.state : "unavailable",
    externalHandoffState: handoffOperation ? handoffOperation.state : "unavailable",
    blockingIssues: invalidRequired.flatMap((operation) => (
      operation.violationCodes.map((code) => `${operation.operation}.${code}`)
    )),
    warningIssues: warningOperations.flatMap((operation) => (
      operation.violationCodes.map((code) => `${operation.operation}.${code}`)
    )),
    proof: {
      proofId: `${syncMetadata.syncKey}:provider-operation-contract:${runtimeDecision.request.requestId}`,
      idempotencyScope: `${serviceContract.subjectKey}:${runtimeDecision.request.requestId}`,
      readyOperationCount: operations.filter((operation) => operation.state === "ready").length,
      requiredOperationCount: requiredOperations.length
    }
  };
}

function buildWorkflowHandoffQueue(now, input, serviceContract, syncMetadata, runtimeDecision, providerServiceBridge, lifecycleControls, idempotentCommands, reservationExecutionPlan) {
  const handoffState = asObject(input.workflowHandoff || input.clientWorkflow || input.dispatchWorkflow);
  const rawCheckpoint = asObject(handoffState.checkpoint || handoffState.clientCheckpoint);
  const rawClientCursor = asIdentifier(
    rawCheckpoint.cursor || handoffState.cursor || handoffState.lastCursor,
    null
  );
  const clientCursorState = !rawClientCursor
    ? "new"
    : rawClientCursor === syncMetadata.cursor
      ? "current"
      : "stale";
  const requestedOwner = asIdentifier(
    handoffState.owner || handoffState.clientId,
    runtimeDecision.request.clientId
  );
  const pendingCommands = idempotentCommands.commands.filter((command) => command.state === "pending");
  const auditCommand = idempotentCommands.commands.find((command) => command.type === "rate-limit.audit.v1");
  const requiresProviderAck = providerServiceBridge.acknowledgement.required
    && providerServiceBridge.acknowledgement.state !== "acknowledged";
  const capabilityHandoffWorkflow = runtimeDecision.admissionGuard.externalHandoffWorkflow;
  const externalProviderWorkflow = providerServiceBridge.workflowContract || null;
  const requiresCapabilityHandoff = capabilityHandoffWorkflow.blocking === true;
  const requiresExternalProviderWorkflow = Boolean(
    externalProviderWorkflow &&
    externalProviderWorkflow.required &&
    externalProviderWorkflow.blocking
  );
  const requiresCommandReplay = pendingCommands.some((command) => command.type !== "rate-limit.audit.v1");
  const reservationSatisfied = !runtimeDecision.reservationRequired
    || reservationExecutionPlan.state === "already-committed";
  const canDispatchNow = runtimeDecision.allowed
    && reservationSatisfied
    && !requiresCapabilityHandoff
    && !requiresExternalProviderWorkflow
    && lifecycleControls.state === "enabled"
    && !requiresProviderAck
    && !requiresCommandReplay;
  const queueState = canDispatchNow
    ? "ready-to-dispatch"
    : !runtimeDecision.allowed
      ? "held-by-runtime"
      : !reservationSatisfied
        ? "awaiting-reservation"
        : requiresCapabilityHandoff
          ? "awaiting-capability-handoff"
          : requiresExternalProviderWorkflow
            ? "awaiting-external-provider-workflow"
        : requiresCommandReplay
          ? "awaiting-command-replay"
          : requiresProviderAck
            ? "awaiting-provider-ack"
            : lifecycleControls.state !== "enabled"
              ? "held-by-lifecycle"
              : "ready-to-dispatch";
  const handoffId = asIdentifier(
    handoffState.handoffId || handoffState.id,
    `${syncMetadata.syncKey}:workflow:${runtimeDecision.request.requestId}`
  );
  const nextActionId = queueState === "ready-to-dispatch"
    ? runtimeDecision.workflowHandoff.nextActionId
    : queueState === "awaiting-provider-ack"
      ? "ack.rate-limit.provider-service-bridge"
      : queueState === "awaiting-command-replay"
        ? pendingCommands[0]?.type === "rate-limit.reserve.v1"
          ? "reserve.rate-limit.quota"
          : pendingCommands[0]?.type.startsWith("rate-limit.recovery.")
            ? "recover.rate-limit.state"
            : "apply.rate-limit.command"
      : queueState === "awaiting-reservation"
      ? reservationExecutionPlan.nextAction.actionId
      : queueState === "awaiting-capability-handoff"
        ? capabilityHandoffWorkflow.nextActionId
      : queueState === "awaiting-external-provider-workflow"
        ? externalProviderWorkflow.dispatchActionId
      : queueState === "held-by-lifecycle"
        ? lifecycleControls.nextAction.actionId
        : runtimeDecision.workflowHandoff.nextActionId;

  return {
    schema: "rate-limit.workflow-handoff-queue.v1",
    generatedAt: now,
    handoffId,
    state: queueState,
    owner: requestedOwner,
    subjectKey: serviceContract.subjectKey,
    syncKey: syncMetadata.syncKey,
    request: {
      requestId: runtimeDecision.request.requestId,
      routeId: runtimeDecision.request.routeId,
      workflowId: runtimeDecision.request.workflowId,
      clientId: runtimeDecision.request.clientId,
      cost: runtimeDecision.request.cost,
      decision: runtimeDecision.decision,
      allowed: runtimeDecision.allowed,
      reservationRequired: runtimeDecision.reservationRequired,
      reservationState: reservationExecutionPlan.state
    },
    clientCheckpoint: {
      cursor: rawClientCursor,
      expectedCursor: syncMetadata.cursor,
      state: clientCursorState,
      checkpointKey: `${handoffId}:checkpoint:${syncMetadata.cursor}`
    },
    dispatch: {
      canDispatch: canDispatchNow,
      state: runtimeDecision.workflowHandoff.state,
      nextActionId,
      retryAfterMs: runtimeDecision.retryAfterMs
        || capabilityHandoffWorkflow.retryAfterMs
        || lifecycleControls.nextAction.retryAfterMs,
      providerBridgeState: providerServiceBridge.state,
      providerAckState: providerServiceBridge.acknowledgement.state,
      deliveryId: providerServiceBridge.delivery.deliveryId,
      reservationState: reservationExecutionPlan.state,
      capabilityHandoffState: capabilityHandoffWorkflow.state,
      capabilityHandoffActionId: capabilityHandoffWorkflow.nextActionId,
      capabilityHandoffOwner: capabilityHandoffWorkflow.owner,
      externalProviderWorkflowState: externalProviderWorkflow?.state || "not-required",
      externalProviderWorkflowActionId: externalProviderWorkflow?.dispatchActionId || "",
      externalProviderWorkflowOwner: externalProviderWorkflow?.owner || ""
    },
    reservationPlan: {
      schema: reservationExecutionPlan.schema,
      state: reservationExecutionPlan.state,
      required: reservationExecutionPlan.required,
      canCommit: reservationExecutionPlan.execution.canCommit,
      commandId: reservationExecutionPlan.command?.commandId || null,
      idempotencyKey: reservationExecutionPlan.command?.idempotencyKey || null,
      providerReady: reservationExecutionPlan.provider.ready,
      reasonCodes: reservationExecutionPlan.reasonCodes,
      nextAction: reservationExecutionPlan.nextAction
    },
    commandBacklog: {
      pendingCount: pendingCommands.length,
      requiresCommandReplay,
      auditCommandState: auditCommand ? auditCommand.state : "missing",
      pendingCommandIds: pendingCommands.map((command) => command.commandId).slice(0, 10)
    },
    capabilityHandoff: {
      schema: capabilityHandoffWorkflow.schema,
      state: capabilityHandoffWorkflow.state,
      required: capabilityHandoffWorkflow.required,
      blocking: requiresCapabilityHandoff,
      nextActionId: capabilityHandoffWorkflow.nextActionId,
      owner: capabilityHandoffWorkflow.owner,
      retryAfterMs: capabilityHandoffWorkflow.retryAfterMs,
      checkpointPolicy: capabilityHandoffWorkflow.checkpointPolicy,
      reasonCodes: capabilityHandoffWorkflow.reasonCodes
    },
    externalProviderWorkflow: externalProviderWorkflow
      ? {
          schema: externalProviderWorkflow.schema,
          providerProfile: externalProviderWorkflow.providerProfile,
          operationKind: externalProviderWorkflow.operationKind,
          state: externalProviderWorkflow.state,
          required: externalProviderWorkflow.required,
          blocking: externalProviderWorkflow.blocking,
          dispatchActionId: externalProviderWorkflow.dispatchActionId,
          owner: externalProviderWorkflow.owner,
          retryAfterMs: externalProviderWorkflow.retryAfterMs,
          checkpointPolicy: externalProviderWorkflow.checkpointPolicy,
          remoteIdempotency: externalProviderWorkflow.remoteIdempotency,
          acceptance: externalProviderWorkflow.acceptance,
          checkpoint: externalProviderWorkflow.checkpoint,
          safety: externalProviderWorkflow.safety,
          reasonCodes: externalProviderWorkflow.reasonCodes
        }
      : {
          schema: "rate-limit.external-provider-workflow-contract.v1",
          providerProfile: "generic",
          operationKind: "generic",
          state: "not-required",
          required: false,
          blocking: false,
          dispatchActionId: "",
          owner: "",
          retryAfterMs: 0,
          checkpointPolicy: "local-proof-only",
          remoteIdempotency: null,
          acceptance: null,
          checkpoint: null,
          safety: null,
          reasonCodes: []
        },
    proof: {
      auditReady: Boolean(auditCommand) && auditCommand.state !== "held",
      idempotencyKey: `${handoffId}:proof:${syncMetadata.cursor}`,
      reasonCodes: [
        !runtimeDecision.allowed ? `runtime.${runtimeDecision.decision}` : null,
        !reservationSatisfied ? `workflow.reservation-${reservationExecutionPlan.state}` : null,
        requiresCapabilityHandoff ? "workflow.capability-handoff-required" : null,
        requiresExternalProviderWorkflow ? "workflow.external-provider-workflow-required" : null,
        requiresCommandReplay ? "workflow.command-replay-required" : null,
        requiresProviderAck ? "workflow.provider-ack-required" : null,
        lifecycleControls.state !== "enabled" ? `workflow.lifecycle-${lifecycleControls.state}` : null,
        clientCursorState === "stale" ? "workflow.client-cursor-stale" : null
      ].filter(Boolean)
    }
  };
}

function buildIdempotentCommands(now, serviceContract, syncMetadata, runtimeDecision, persistedState, recoveryPlan, lifecycleControls) {
  const baseKey = `${persistedState.stateKey}:${runtimeDecision.request.requestId}`;
  const alreadyApplied = persistedState.appliedRequestIds.includes(runtimeDecision.request.requestId);
  const hasAppliedCommand = (idempotencyKey) => persistedState.appliedCommandKeys.includes(idempotencyKey);
  const reserveIdempotencyKey = `${baseKey}:reserve:${runtimeDecision.accounting.requestedCost}`;
  const auditIdempotencyKey = `${baseKey}:audit:${syncMetadata.cursor}`;
  const externalProviderProfile = serviceContract.externalProviderProfile || {
    providerProfile: "generic",
    requiredCapabilities: [],
    remoteIdempotencyHeaders: []
  };
  const externalHandoffRequired = runtimeDecision.accounting.externalHandoffContract?.required === true
    || serviceContract.policy.externalHandoffRequired === true;
  const externalHandoffKey = `${baseKey}:external-handoff:${externalProviderProfile.providerProfile}:${runtimeDecision.request.routeId}`;
  const reserveCommand = runtimeDecision.reservationRequired
    ? {
        commandId: `${baseKey}:reserve`,
        type: "rate-limit.reserve.v1",
        idempotencyKey: reserveIdempotencyKey,
        state: alreadyApplied || hasAppliedCommand(reserveIdempotencyKey) ? "already-applied" : "pending",
        subjectKey: serviceContract.subjectKey,
        requestId: runtimeDecision.request.requestId,
        units: runtimeDecision.accounting.requestedCost,
        sequence: persistedState.commandSequence + 1
      }
    : null;
  const auditCommand = {
    commandId: `${baseKey}:audit`,
    type: "rate-limit.audit.v1",
    idempotencyKey: auditIdempotencyKey,
    state: hasAppliedCommand(auditIdempotencyKey)
      ? "already-applied"
      : runtimeDecision.allowed
      ? "ready"
      : runtimeDecision.decision === "deny-boundary"
        ? "denied"
        : runtimeDecision.decision.startsWith("lifecycle")
          || runtimeDecision.decision === "deny-lifecycle-invalid"
          ? "held"
          : "throttled",
    subjectKey: serviceContract.subjectKey,
    requestId: runtimeDecision.request.requestId,
    decision: runtimeDecision.decision,
      generatedAt: now
  };
  const externalHandoffCommand = externalHandoffRequired
    ? {
        commandId: `${baseKey}:external-handoff`,
        type: "rate-limit.external-handoff.v1",
        idempotencyKey: externalHandoffKey,
        state: hasAppliedCommand(externalHandoffKey)
          ? "already-applied"
          : runtimeDecision.accounting.externalHandoffContract?.ready
            ? "ready"
            : "pending",
        subjectKey: serviceContract.subjectKey,
        requestId: runtimeDecision.request.requestId,
        providerProfile: externalProviderProfile.providerProfile,
        remoteIdempotencyHeaders: Object.fromEntries(
          (externalProviderProfile.remoteIdempotencyHeaders || []).map((header) => [header, externalHandoffKey])
        ),
        requiredCapabilities: externalProviderProfile.requiredCapabilities || [],
        sequence: persistedState.commandSequence + (reserveCommand ? 2 : 1),
        generatedAt: now
      }
    : null;
  const recoveryCommands = recoveryPlan.actions.map((action, index) => ({
    commandId: `${persistedState.stateKey}:recovery:${index + 1}`,
    type: "rate-limit.recovery.v1",
    idempotencyKey: action.idempotencyKey,
    state: hasAppliedCommand(action.idempotencyKey) ? "already-applied" : "pending",
    subjectKey: serviceContract.subjectKey,
    reasonCode: action.reasonCode,
    sequence: persistedState.commandSequence + index + 1
  }));
  const lifecycleCommands = lifecycleControls.commands
    .filter((command) => command.state === "pending" || command.state === "ready")
    .map((command, index) => ({
      commandId: command.commandId,
      type: `rate-limit.lifecycle.${command.type}.v1`,
      idempotencyKey: command.idempotencyKey,
      state: hasAppliedCommand(command.idempotencyKey) ? "already-applied" : "pending",
      subjectKey: serviceContract.subjectKey,
      syncKey: syncMetadata.syncKey,
      reasonCode: `lifecycle.${command.type}`,
      sequence: persistedState.commandSequence + recoveryCommands.length + index + 1,
      generatedAt: now
    }));

  return {
    schema: "rate-limit.idempotent-commands.v1",
    replayPolicy: "dedupe-by-idempotency-key",
    alreadyApplied,
    externalProvider: {
      providerProfile: externalProviderProfile.providerProfile,
      externalHandoffRequired,
      externalHandoffKey,
      remoteIdempotencyHeaders: externalProviderProfile.remoteIdempotencyHeaders || []
    },
    commands: [reserveCommand, externalHandoffCommand, auditCommand, ...recoveryCommands, ...lifecycleCommands].filter(Boolean)
  };
}

function buildCommandRecoveryIndex(now, persistedState, idempotentCommands, runtimeDecision, lifecycleControls) {
  const journalByKey = new Map();
  const duplicateJournalKeys = [];

  persistedState.commandJournal.forEach((entry) => {
    if (!entry.idempotencyKey) {
      return;
    }

    if (journalByKey.has(entry.idempotencyKey)) {
      duplicateJournalKeys.push(entry.idempotencyKey);
    }

    journalByKey.set(entry.idempotencyKey, entry);
  });

  const currentByKey = new Map();
  const duplicateCurrentKeys = [];
  idempotentCommands.commands.forEach((command) => {
    if (!command.idempotencyKey) {
      return;
    }

    if (currentByKey.has(command.idempotencyKey)) {
      duplicateCurrentKeys.push(command.idempotencyKey);
    }

    currentByKey.set(command.idempotencyKey, command);
  });

  const commandDisposition = idempotentCommands.commands.map((command) => {
    const journalEntry = command.idempotencyKey ? journalByKey.get(command.idempotencyKey) : null;
    const durableApplied = command.idempotencyKey
      ? persistedState.appliedCommandKeys.includes(command.idempotencyKey)
        || journalEntry?.state === "applied"
      : false;
    const replayableJournal = journalEntry
      && ["pending", "failed"].includes(journalEntry.state)
      && command.state !== "already-applied";
    const blockedByLifecycle = command.type.startsWith("rate-limit.lifecycle.")
      && lifecycleControls.state === "paused"
      && !command.type.includes(".resume.");
    const disposition = !command.idempotencyKey
      ? "invalid-missing-idempotency-key"
      : durableApplied || command.state === "already-applied"
        ? "durable-applied"
        : replayableJournal
          ? "replay-persisted"
          : blockedByLifecycle
            ? "hold-lifecycle-paused"
            : command.state === "pending" || command.state === "ready"
              ? "append-new"
              : "observe-only";

    return {
      commandId: command.commandId,
      type: command.type,
      idempotencyKey: command.idempotencyKey,
      requestId: command.requestId || runtimeDecision.request.requestId,
      requestedState: command.state,
      journalState: journalEntry ? journalEntry.state : "missing",
      journalSequence: journalEntry ? journalEntry.sequence : null,
      disposition,
      restartAction: disposition === "durable-applied"
        ? "skip"
        : disposition === "replay-persisted"
          ? "replay-with-existing-journal-entry"
          : disposition === "append-new"
            ? "append-before-dispatch"
            : disposition === "hold-lifecycle-paused"
              ? "hold-until-lifecycle-resume"
              : "audit"
    };
  });

  const staleJournalEntries = persistedState.commandJournal
    .filter((entry) => entry.idempotencyKey && !currentByKey.has(entry.idempotencyKey))
    .slice(-20)
    .map((entry) => ({
      commandId: entry.commandId,
      idempotencyKey: entry.idempotencyKey,
      type: entry.type,
      state: entry.state,
      sequence: entry.sequence,
      cursor: entry.cursor,
      restartAction: ["pending", "failed"].includes(entry.state)
        ? "reconcile-or-compensate"
        : "retain-for-dedupe"
    }));
  const replayRequired = commandDisposition.filter((entry) => entry.disposition === "replay-persisted");
  const appendRequired = commandDisposition.filter((entry) => entry.disposition === "append-new");
  const invalidCommands = commandDisposition.filter((entry) => entry.disposition === "invalid-missing-idempotency-key");
  const staleReplayRequired = staleJournalEntries.filter((entry) => entry.restartAction === "reconcile-or-compensate");
  const duplicateKeys = [...new Set([...duplicateJournalKeys, ...duplicateCurrentKeys])];

  return {
    schema: "rate-limit.command-recovery-index.v1",
    generatedAt: now,
    stateKey: persistedState.stateKey,
    requestId: runtimeDecision.request.requestId,
    state: invalidCommands.length
      ? "invalid"
      : replayRequired.length || staleReplayRequired.length
        ? "replay-required"
        : appendRequired.length
          ? "append-required"
          : "deduped",
    commandDisposition,
    staleJournalEntries,
    duplicateKeys,
    replayRequiredCount: replayRequired.length + staleReplayRequired.length,
    appendRequiredCount: appendRequired.length,
    durableAppliedCount: commandDisposition.filter((entry) => entry.disposition === "durable-applied").length,
    invalidCommandCount: invalidCommands.length,
    restartProof: {
      proofId: `${persistedState.stateKey}:command-recovery:${runtimeDecision.request.requestId}`,
      resumeCursor: `${persistedState.subjectKey}#${persistedState.commandSequence}`,
      duplicatePolicy: "reuse-existing-journal-entry-before-append",
      replayKeys: replayRequired.map((entry) => entry.idempotencyKey).slice(0, 20),
      staleReplayKeys: staleReplayRequired.map((entry) => entry.idempotencyKey).slice(0, 20),
      appendKeys: appendRequired.map((entry) => entry.idempotencyKey).slice(0, 20)
    }
  };
}

function buildReservationExecutionPlan(now, serviceContract, syncMetadata, runtimeDecision, persistedState, idempotentCommands, commandRecoveryIndex, providerOperationContract) {
  const reserveCommand = idempotentCommands.commands.find((command) => command.type === "rate-limit.reserve.v1") || null;
  const reserveOperation = providerOperationContract.operations.find((operation) => operation.operation === "reserve") || null;
  const persistedReservation = persistedState.reservations.find((reservation) => (
    reservation.requestId === runtimeDecision.request.requestId
    && reservation.units === runtimeDecision.accounting.requestedCost
    && reservation.status !== "released"
  )) || null;
  const reserveDisposition = reserveCommand
    ? commandRecoveryIndex.commandDisposition.find((entry) => entry.idempotencyKey === reserveCommand.idempotencyKey) || null
    : null;
  const durableReserveApplied = Boolean(
    persistedReservation?.status === "applied"
    || reserveCommand?.state === "already-applied"
    || reserveDisposition?.disposition === "durable-applied"
  );
  const pendingReserveHeld = Boolean(persistedReservation?.status === "pending");
  const providerReady = providerOperationContract.reserveState === "ready"
    && reserveOperation?.state === "ready";
  const commandReplayRequired = Boolean(
    reserveDisposition
    && ["replay-persisted", "append-new"].includes(reserveDisposition.disposition)
  );
  const commandInvalid = commandRecoveryIndex.invalidCommandCount > 0
    || reserveDisposition?.disposition === "invalid-missing-idempotency-key";
  const runtimeRequiresReservation = runtimeDecision.reservationRequired;
  const canCommit = runtimeRequiresReservation
    && providerReady
    && reserveCommand
    && !commandInvalid
    && !durableReserveApplied
    && !pendingReserveHeld;
  const state = !runtimeRequiresReservation
    ? "not-required"
    : durableReserveApplied
      ? "already-committed"
      : pendingReserveHeld
        ? "pending-provider-commit"
        : commandInvalid
          ? "blocked-by-command-recovery"
          : !providerReady
            ? "blocked-by-provider-operation"
            : commandReplayRequired
              ? "ready-to-commit"
              : reserveCommand
                ? "ready-to-commit"
                : "missing-reserve-command";

  return {
    schema: "rate-limit.reservation-execution-plan.v1",
    generatedAt: now,
    state,
    required: runtimeRequiresReservation,
    subjectKey: serviceContract.subjectKey,
    syncKey: syncMetadata.syncKey,
    requestId: runtimeDecision.request.requestId,
    capabilityRateClass: runtimeDecision.request.capabilityRateClass,
    units: runtimeDecision.accounting.requestedCost,
    provider: {
      state: providerOperationContract.reserveState,
      ready: providerReady,
      operationIdempotencyKey: reserveOperation?.idempotency.key || null,
      consistency: reserveOperation?.consistency || "unavailable",
      blockingIssues: providerOperationContract.blockingIssues.filter((issue) => issue.startsWith("reserve."))
    },
    command: reserveCommand
      ? {
          commandId: reserveCommand.commandId,
          state: reserveCommand.state,
          idempotencyKey: reserveCommand.idempotencyKey,
          sequence: reserveCommand.sequence || null,
          disposition: reserveDisposition?.disposition || "missing-recovery-disposition",
          restartAction: reserveDisposition?.restartAction || "audit"
        }
      : null,
    persistedReservation: persistedReservation
      ? {
          reservationId: persistedReservation.reservationId,
          status: persistedReservation.status,
          commandKey: persistedReservation.commandKey,
          units: persistedReservation.units
        }
      : null,
    execution: {
      canCommit,
      commitBeforeDispatch: runtimeRequiresReservation && !durableReserveApplied,
      dispatchAfterCommit: runtimeRequiresReservation && (canCommit || durableReserveApplied),
      releaseOnWorkflowCancel: runtimeRequiresReservation,
      replayBeforeAppend: reserveDisposition?.disposition === "replay-persisted",
      appendBeforeDispatch: reserveDisposition?.disposition === "append-new"
    },
    reasonCodes: [
      !runtimeRequiresReservation ? "reservation.not-required" : null,
      durableReserveApplied ? "reservation.already-committed" : null,
      pendingReserveHeld ? "reservation.pending-provider-commit" : null,
      commandInvalid ? "reservation.command-recovery-invalid" : null,
      runtimeRequiresReservation && !providerReady ? "reservation.provider-operation-not-ready" : null,
      runtimeRequiresReservation && !reserveCommand ? "reservation.command-missing" : null,
      reserveDisposition?.disposition === "replay-persisted" ? "reservation.replay-persisted-command" : null,
      reserveDisposition?.disposition === "append-new" ? "reservation.append-command-before-dispatch" : null
    ].filter(Boolean),
    nextAction: {
      actionId: state === "not-required" || state === "already-committed"
        ? "dispatch.capability.request"
        : state === "blocked-by-provider-operation"
          ? "contract.rate-limit.provider-operations"
          : state === "blocked-by-command-recovery"
            ? "repair.rate-limit.command-journal"
            : state === "pending-provider-commit"
              ? "commit.rate-limit.pending-reservation"
              : "reserve.rate-limit.quota",
      retryAfterMs: providerReady || !runtimeRequiresReservation ? 0 : syncMetadata.nextRefreshAfterMs
    }
  };
}

function buildDurableStateProjection(now, serviceContract, syncMetadata, runtimeDecision, persistedState, recoveryPlan, idempotentCommands, commandRecoveryIndex) {
  const pendingCommands = idempotentCommands.commands.filter((command) => command.state === "pending");
  const replayableCommands = idempotentCommands.commands.filter((command) => (
    command.state === "pending" || command.state === "ready"
  ));
  const appendableKeys = new Set(commandRecoveryIndex.commandDisposition
    .filter((entry) => entry.disposition === "append-new")
    .map((entry) => entry.idempotencyKey));
  const requestAlreadyDurable = persistedState.appliedRequestIds.includes(runtimeDecision.request.requestId);
  const shouldAccountRequest = runtimeDecision.allowed
    && !runtimeDecision.reservationRequired
    && !requestAlreadyDurable
    && runtimeDecision.decision !== "bypass-disabled";
  const shouldReserveRequest = runtimeDecision.reservationRequired
    && !requestAlreadyDurable
    && pendingCommands.some((command) => command.type === "rate-limit.reserve.v1");
  const projectedWindowUsed = persistedState.durableTotals.windowUsed
    + (shouldAccountRequest ? runtimeDecision.accounting.requestedCost : 0);
  const projectedReserved = persistedState.durableTotals.reserved
    + (shouldReserveRequest ? runtimeDecision.accounting.requestedCost : 0);
  const projectedLocalPending = Math.max(0, persistedState.durableTotals.localPending);
  const projectedAccountedRequests = projectedWindowUsed + projectedReserved + projectedLocalPending;
  const projectedClassAccountedRequests = runtimeDecision.accounting.classAccountedRequests
    + (shouldAccountRequest || shouldReserveRequest ? runtimeDecision.accounting.requestedCost : 0);
  const projectedCapabilityClassLedger = buildProjectedCapabilityClassLedger(
    serviceContract,
    runtimeDecision,
    shouldAccountRequest,
    shouldReserveRequest
  );
  const projectedAppliedRequestIds = runtimeDecision.allowed && !requestAlreadyDurable
    ? [...persistedState.appliedRequestIds, runtimeDecision.request.requestId].slice(-100)
    : persistedState.appliedRequestIds;
  const journalEntries = replayableCommands
    .filter((command) => appendableKeys.has(command.idempotencyKey))
    .map((command, index) => ({
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      type: command.type,
      state: command.state === "ready" ? "applied-on-dispatch" : "pending",
      requestId: command.requestId || runtimeDecision.request.requestId,
      sequence: command.sequence || persistedState.commandSequence + index + 1,
      cursor: syncMetadata.cursor,
      observedAt: now
    }));
  const projectedAppliedCommandKeys = [
    ...persistedState.appliedCommandKeys,
    ...journalEntries
      .filter((entry) => entry.state === "applied-on-dispatch")
      .map((entry) => entry.idempotencyKey)
  ].filter(Boolean);
  const overflowUnits = Math.max(0, projectedAccountedRequests - serviceContract.policy.maxRequests);
  const emergencyOverflowAllowance = runtimeDecision.allowed
    && !runtimeDecision.reservationRequired
    && runtimeDecision.admissionGuard.emergencyAdmission.allowed
    ? runtimeDecision.admissionGuard.emergencyAdmission.unitsGranted
    : 0;
  const unapprovedOverflowUnits = Math.max(0, overflowUnits - emergencyOverflowAllowance);
  const activeClassOverflowAllowance = runtimeDecision.admissionGuard.emergencyAdmission.allowed
    ? runtimeDecision.admissionGuard.emergencyAdmission.unitsGranted
    : 0;
  const unapprovedClassOverflowUnits = projectedCapabilityClassLedger.overLimitClasses.reduce((total, entry) => {
    const allowedOverflow = entry.capabilityRateClass === runtimeDecision.request.capabilityRateClass
      ? activeClassOverflowAllowance
      : 0;

    return total + Math.max(0, entry.overflowUnits - allowedOverflow);
  }, 0);
  const invariantViolations = [
    unapprovedOverflowUnits > 0 ? "projection.exceeds-policy-window" : null,
    unapprovedClassOverflowUnits > 0 ? "projection.capability-class-exceeds-limit" : null,
    !persistedState.isSubjectMatch ? "projection.subject-mismatch" : null,
    persistedState.ledgerReconciliation.state === "drift-detected"
      && persistedState.ledgerReconciliation.replayDirection !== "rebuild-capability-class-ledger"
      ? "projection.ledger-reconciliation-required"
      : null,
    recoveryPlan.state === "recovery-required" ? "projection.recovery-required" : null,
    commandRecoveryIndex.state === "invalid" ? "projection.command-recovery-invalid" : null,
    pendingCommands.some((command) => !command.idempotencyKey) ? "projection.command-missing-idempotency-key" : null
  ].filter(Boolean);

  return {
    schema: "rate-limit.durable-state-projection.v1",
    generatedAt: now,
    stateKey: persistedState.stateKey,
    subjectKey: serviceContract.subjectKey,
    cursor: syncMetadata.cursor,
    previousCursor: persistedState.cursor,
    state: invariantViolations.length
      ? "hold-for-recovery"
      : commandRecoveryIndex.replayRequiredCount || pendingCommands.length
        ? "replay-pending"
        : "ready-to-persist",
    writeIntent: {
      mode: runtimeDecision.reservationRequired
        ? "reserve-before-dispatch"
        : shouldAccountRequest
          ? "account-local-dispatch"
          : runtimeDecision.allowed
            ? "dedupe-existing-dispatch"
            : "audit-only",
      idempotencyScope: `${persistedState.stateKey}:${runtimeDecision.request.requestId}`,
      requestAlreadyDurable,
      shouldAccountRequest,
      shouldReserveRequest,
      emergencyOverflowAllowance,
      unapprovedOverflowUnits,
      ledgerReplayDirection: persistedState.ledgerReconciliation.replayDirection
    },
    projectedLedger: {
      windowUsed: projectedWindowUsed,
      reserved: projectedReserved,
      localPending: projectedLocalPending,
      accountedRequests: projectedAccountedRequests,
      capabilityClass: {
        capabilityRateClass: runtimeDecision.request.capabilityRateClass,
        admissionPath: runtimeDecision.accounting.capabilityAdmissionPacket.path,
        admissionAction: runtimeDecision.accounting.capabilityAdmissionPacket.action,
        classWindowLimit: runtimeDecision.accounting.classWindowLimit,
        accountedRequests: projectedClassAccountedRequests,
        remainingAfterRequest: Math.max(0, runtimeDecision.accounting.classWindowLimit - projectedClassAccountedRequests),
        pressureRatio: runtimeDecision.accounting.classWindowLimit > 0
          ? Number((projectedClassAccountedRequests / runtimeDecision.accounting.classWindowLimit).toFixed(4))
          : 1,
        emergencyAdmission: runtimeDecision.accounting.emergencyAdmission
      },
      capabilityClasses: projectedCapabilityClassLedger,
      maxRequests: serviceContract.policy.maxRequests,
      overflowUnits,
      emergencyOverflowAllowance,
      unapprovedClassOverflowUnits,
      unapprovedOverflowUnits
    },
    projectedAppliedRequestIds,
    projectedAppliedCommandKeys: [...new Set(projectedAppliedCommandKeys)].slice(-100),
    commandJournalAppend: journalEntries,
    commandRecovery: {
      schema: commandRecoveryIndex.schema,
      state: commandRecoveryIndex.state,
      replayRequiredCount: commandRecoveryIndex.replayRequiredCount,
      appendRequiredCount: commandRecoveryIndex.appendRequiredCount,
      durableAppliedCount: commandRecoveryIndex.durableAppliedCount,
      duplicateKeys: commandRecoveryIndex.duplicateKeys,
      staleJournalEntryCount: commandRecoveryIndex.staleJournalEntries.length
    },
    ledgerReconciliation: persistedState.ledgerReconciliation,
    pendingCommandCount: pendingCommands.length,
    invariantViolations,
    restartContract: {
      resumeCursor: `${serviceContract.subjectKey}#${persistedState.commandSequence + journalEntries.length}`,
      commandSequenceAfterWrite: persistedState.commandSequence + journalEntries.length,
      duplicateCommandPolicy: idempotentCommands.replayPolicy,
      recoveryRequiredBeforeDispatch: recoveryPlan.state === "recovery-required"
    }
  };
}

function buildRestartSafeStatus(readiness, runtimeDecision, persistedState, recoveryPlan, idempotentCommands, durableProjection, commandRecoveryIndex) {
  const pendingCommandCount = idempotentCommands.commands.filter((command) => command.state === "pending").length;
  const blockedByRecovery = recoveryPlan.actions.some((action) => action.priority === "required");
  const restartState = blockedByRecovery
    || durableProjection.state === "hold-for-recovery"
    ? "recovering"
    : commandRecoveryIndex.replayRequiredCount
      ? "replaying"
    : readiness.state === "blocked"
      ? "blocked"
      : runtimeDecision.allowed
        ? "enforcing"
        : "throttled";

  return {
    schema: "rate-limit.restart-safe-status.v1",
    state: restartState,
    durable: recoveryPlan.restartSafe && durableProjection.invariantViolations.length === 0,
    resumeCursor: durableProjection.restartContract.resumeCursor || recoveryPlan.durableCursor,
    lastSnapshotId: persistedState.lastSnapshotId,
    pendingCommandCount,
    pendingReservationCount: persistedState.pendingReservationCount,
    commandDedupe: {
      strategy: idempotentCommands.replayPolicy,
      appliedRequestIdsRetained: persistedState.appliedRequestIds.length,
      appliedCommandKeysRetained: persistedState.appliedCommandKeys.length
    },
    ledgerReconciliation: {
      schema: persistedState.ledgerReconciliation.schema,
      state: persistedState.ledgerReconciliation.state,
      replayDirection: persistedState.ledgerReconciliation.replayDirection,
      driftReasons: persistedState.ledgerReconciliation.driftReasons,
      deltas: persistedState.ledgerReconciliation.deltas
    },
    commandRecovery: {
      schema: commandRecoveryIndex.schema,
      state: commandRecoveryIndex.state,
      replayRequiredCount: commandRecoveryIndex.replayRequiredCount,
      appendRequiredCount: commandRecoveryIndex.appendRequiredCount,
      durableAppliedCount: commandRecoveryIndex.durableAppliedCount,
      invalidCommandCount: commandRecoveryIndex.invalidCommandCount,
      duplicateKeys: commandRecoveryIndex.duplicateKeys,
      restartProof: commandRecoveryIndex.restartProof
    },
    durableProjection: {
      schema: durableProjection.schema,
      state: durableProjection.state,
      writeMode: durableProjection.writeIntent.mode,
      projectedAccountedRequests: durableProjection.projectedLedger.accountedRequests,
      overflowUnits: durableProjection.projectedLedger.overflowUnits,
      capabilityClassLedger: {
        schema: durableProjection.projectedLedger.capabilityClasses.schema,
        activeClass: durableProjection.projectedLedger.capabilityClasses.activeClass,
        operation: durableProjection.projectedLedger.capabilityClasses.operation,
        activeProjection: durableProjection.projectedLedger.capabilityClasses.activeProjection,
        overLimitClasses: durableProjection.projectedLedger.capabilityClasses.overLimitClasses,
        totalProjectedAccountedRequests: durableProjection.projectedLedger.capabilityClasses.totalProjectedAccountedRequests
      },
      pendingCommandCount: durableProjection.pendingCommandCount,
      invariantViolations: durableProjection.invariantViolations,
      ledgerReconciliation: durableProjection.ledgerReconciliation
    },
    semantics: {
      reserve: runtimeDecision.reservationRequired ? "must-commit-before-dispatch" : "not-required",
      dispatch: restartState === "enforcing" ? "safe-to-dispatch" : "hold-until-status-ready",
      replay: commandRecoveryIndex.replayRequiredCount ? "replay-before-new-append" : "no-replay-required",
      audit: "safe-to-retry"
    }
  };
}

function buildAuditProof(now, providerContract, serviceContract, negotiation, syncMetadata, evidence, runtimeDecision, persistedState, recoveryPlan, restartStatus, durableProjection, accessBoundary, operationalHealth, lifecycleControls, providerServiceBridge, providerHandoffReceipt, providerOperationContract, workflowHandoffQueue, reservationExecutionPlan, operationalRecovery) {
  return {
    proofType: "rate-limit-provider-contract",
    generatedAt: now,
    surfaceId,
    providerId: providerContract.providerId,
    subjectKey: serviceContract.subjectKey,
    negotiatedStatus: negotiation.status,
    syncKey: syncMetadata.syncKey,
    evidenceCount: evidence.length,
    runtimeDecision: runtimeDecision
      ? {
          requestId: runtimeDecision.request.requestId,
          decision: runtimeDecision.decision,
          allowed: runtimeDecision.allowed,
          capabilityRateClass: runtimeDecision.request.capabilityRateClass,
          healthAdmissionPolicy: runtimeDecision.healthAdmissionPolicy,
          remainingAfterRequest: runtimeDecision.accounting.remainingAfterRequest,
          capabilityAdmissionPacket: runtimeDecision.accounting.capabilityAdmissionPacket,
          admissionGuard: {
            schema: runtimeDecision.admissionGuard.schema,
            state: runtimeDecision.admissionGuard.state,
            healthAdmissionState: runtimeDecision.healthAdmissionPolicy.state,
            capabilityAdmissionPacket: runtimeDecision.admissionGuard.capabilityAdmissionPacket,
            burstBudgetRemaining: runtimeDecision.admissionGuard.burstBudgetRemaining,
            classBudgetRemaining: runtimeDecision.admissionGuard.classBudgetRemaining,
            capabilityLaneState: runtimeDecision.admissionGuard.capabilityLaneState,
            capabilityLaneDeficit: runtimeDecision.admissionGuard.capabilityLaneDeficit,
            externalHandoffContract: runtimeDecision.admissionGuard.externalHandoffContract,
            externalHandoffWorkflow: runtimeDecision.admissionGuard.externalHandoffWorkflow,
            emergencyAdmission: runtimeDecision.admissionGuard.emergencyAdmission,
            steadyBudgetRemaining: runtimeDecision.admissionGuard.steadyBudgetRemaining,
            pressureRatio: runtimeDecision.admissionGuard.pressureRatio,
            classPressureRatio: runtimeDecision.admissionGuard.classPressureRatio,
            reasonCodes: runtimeDecision.admissionGuard.reasonCodes,
            nextActionId: runtimeDecision.admissionGuard.nextActionId
          }
        }
      : null,
    persistence: {
      stateKey: persistedState.stateKey,
      cursor: persistedState.cursor,
      restartState: restartStatus.state,
      recoveryState: recoveryPlan.state,
      pendingReservationCount: persistedState.pendingReservationCount,
      ledgerReconciliation: persistedState.ledgerReconciliation,
      durableProjection: {
        schema: durableProjection.schema,
        state: durableProjection.state,
        writeMode: durableProjection.writeIntent.mode,
        projectedLedger: durableProjection.projectedLedger,
        pendingCommandCount: durableProjection.pendingCommandCount,
        invariantViolations: durableProjection.invariantViolations,
        resumeCursor: durableProjection.restartContract.resumeCursor,
        commandRecovery: durableProjection.commandRecovery
      }
    },
    accessBoundary: {
      schema: accessBoundary.schema,
      state: accessBoundary.state,
      mode: accessBoundary.mode,
      enforced: accessBoundary.enforced,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      expectedTenantId: accessBoundary.expectedTenantId,
      expectedWorkspaceId: accessBoundary.expectedWorkspaceId,
      requestScope: accessBoundary.requestScope,
      role: accessBoundary.role,
      violations: accessBoundary.violations,
      missingPermissions: accessBoundary.missingPermissions,
      allowlists: accessBoundary.allowlists,
      workspaceGrant: accessBoundary.workspaceGrant
    },
    operationalHealth: {
      schema: operationalHealth.schema,
      state: operationalHealth.state,
      degradedMode: operationalHealth.degradedMode,
      retryAfterMs: operationalHealth.retryAfterMs,
      healthAdmissionPolicy: runtimeDecision.healthAdmissionPolicy,
      signals: operationalHealth.signals
    },
    lifecycleControls: {
      schema: lifecycleControls.schema,
      state: lifecycleControls.state,
      enabled: lifecycleControls.enabled,
      enforcementEnabled: lifecycleControls.enforcementEnabled,
      reservationsEnabled: lifecycleControls.reservationsEnabled,
      auditEnabled: lifecycleControls.auditEnabled,
      nextActionId: lifecycleControls.nextAction.actionId,
      validationIssues: lifecycleControls.validationIssues,
      schedule: lifecycleControls.schedule,
      transitionPlan: {
        schema: lifecycleControls.transitionPlan.schema,
        state: lifecycleControls.transitionPlan.state,
        projectedSettings: lifecycleControls.transitionPlan.projectedSettings,
        nextAction: lifecycleControls.transitionPlan.nextAction,
        blockingIssues: lifecycleControls.transitionPlan.blockingIssues,
        proof: lifecycleControls.transitionPlan.proof
      },
      pendingCommandCount: lifecycleControls.commands.filter((command) => command.state === "pending").length
    },
    providerServiceBridge: {
      schema: providerServiceBridge.schema,
      state: providerServiceBridge.state,
      protocol: providerServiceBridge.protocol,
      delivery: providerServiceBridge.delivery,
      syncLease: providerServiceBridge.syncLease,
      acknowledgement: providerServiceBridge.acknowledgement,
      workflowContract: providerServiceBridge.workflowContract
    },
    providerHandoffReceipt: {
      schema: providerHandoffReceipt.schema,
      state: providerHandoffReceipt.state,
      required: providerHandoffReceipt.required,
      receipt: providerHandoffReceipt.receipt,
      durability: providerHandoffReceipt.durability,
      violationCodes: providerHandoffReceipt.violationCodes,
      proof: providerHandoffReceipt.proof
    },
    providerOperationContract: {
      schema: providerOperationContract.schema,
      state: providerOperationContract.state,
      reserveState: providerOperationContract.reserveState,
      externalHandoffState: providerOperationContract.externalHandoffState,
      blockingIssues: providerOperationContract.blockingIssues,
      warningIssues: providerOperationContract.warningIssues,
      capabilityMatrix: providerOperationContract.capabilityMatrix,
      proof: providerOperationContract.proof
    },
    reservationExecutionPlan: {
      schema: reservationExecutionPlan.schema,
      state: reservationExecutionPlan.state,
      required: reservationExecutionPlan.required,
      provider: reservationExecutionPlan.provider,
      command: reservationExecutionPlan.command,
      persistedReservation: reservationExecutionPlan.persistedReservation,
      execution: reservationExecutionPlan.execution,
      reasonCodes: reservationExecutionPlan.reasonCodes,
      nextAction: reservationExecutionPlan.nextAction
    },
    workflowHandoffQueue: {
      schema: workflowHandoffQueue.schema,
      state: workflowHandoffQueue.state,
      handoffId: workflowHandoffQueue.handoffId,
      owner: workflowHandoffQueue.owner,
      clientCheckpoint: workflowHandoffQueue.clientCheckpoint,
      dispatch: workflowHandoffQueue.dispatch,
      externalProviderWorkflow: workflowHandoffQueue.externalProviderWorkflow,
      commandBacklog: workflowHandoffQueue.commandBacklog,
      proof: workflowHandoffQueue.proof
    },
    operationalRecovery: {
      schema: operationalRecovery.schema,
      state: operationalRecovery.state,
      primaryError: operationalRecovery.primaryError,
      retryPlan: operationalRecovery.retryPlan,
      degradedPolicy: operationalRecovery.degradedPolicy,
      dispatchGate: operationalRecovery.dispatchGate,
      remediationProof: operationalRecovery.remediationProof
    },
    assertions: [
      "policy.windowMs is positive",
      "policy.maxRequests is positive",
      "burstRequests does not exceed maxRequests",
      "provider capabilities are intersected with hosted-kernel supported capabilities",
      "runtime request cost is accounted against current client quota state",
      "tenant and workspace boundary checks run before dispatch or external handoff",
      "role and permission grants are normalized into the rate-limit audit proof",
      "persisted state is normalized before restart recovery decisions",
      "commands include idempotency keys for safe replay",
      "provider health failures are converted into degraded-mode and retry guidance",
      "lifecycle settings can disable, pause, or schedule enforcement before dispatch",
      "lifecycle commands are normalized with idempotency keys for safe application",
      "provider/service bridge envelopes carry request, policy, cursor, and acknowledgement state",
      "external provider workflow contracts expose Mailchimp-style operator acceptance, checkpoint, remote idempotency, replay fence, and next-action handoff data",
      "provider handoff receipts validate delivery id, cursor, stale acknowledgement, and durable replay token state",
      "provider operation contracts validate endpoint, TTL, idempotency, sync-lease, and capability requirements per operation",
      "reservation execution plans reconcile provider reserve readiness, durable command replay, and pending reservation state before dispatch",
      "provider sync leases gate external handoff writes and expose cursor watermark drift",
      "admission guard enforces capability class ledgers for model calls, external systems, operator interrupts, burst pressure, reservations, emergency interrupt burst, and quota exhaustion reasons",
      "client workflow handoff queues expose checkpoint, dispatch, acknowledgement, and replay state",
      "operational recovery envelopes correlate provider, lifecycle, runtime, and workflow failures into retryable remediation proof",
      "durable state projection shapes the next persisted ledger, command journal, and resume cursor before restart",
      "persisted command journals are indexed by idempotency key before appending new restart-safe commands"
    ]
  };
}

function buildValidationSummary(providerContract, serviceContract, negotiation, externalHandoff, evidence, runtimeDecision, persistedState, recoveryPlan, durableProjection, accessBoundary, operationalHealth, lifecycleControls, providerServiceBridge, providerHandoffReceipt, providerOperationContract, workflowHandoffQueue, reservationExecutionPlan) {
  const checks = [
    {
      code: "provider.snapshot",
      label: "Provider can produce rate-limit snapshots",
      status: providerContract.capabilities.includes("rate-limit.snapshot.v1") ? "pass" : "fail",
      severity: "blocking"
    },
    {
      code: "provider.audit",
      label: "Provider can emit audit proof",
      status: providerContract.capabilities.includes("rate-limit.audit.v1") ? "pass" : "fail",
      severity: "blocking"
    },
    {
      code: "policy.window",
      label: "Policy window is enforceable",
      status: serviceContract.policy.windowMs >= 1_000 ? "pass" : "fail",
      severity: "blocking"
    },
    {
      code: "policy.burst",
      label: "Burst allowance fits inside the request cap",
      status: serviceContract.policy.burstRequests <= serviceContract.policy.maxRequests ? "pass" : "fail",
      severity: "blocking"
    },
    {
      code: "provider.health",
      label: "Provider reports ready health",
      status: operationalHealth.providerUnavailable ? "fail" : providerContract.health === "ready" ? "pass" : "warn",
      severity: operationalHealth.providerUnavailable ? "blocking" : "advisory"
    },
    {
      code: "provider.failure-state",
      label: "Provider failure state has retry or degraded-mode guidance",
      status: operationalHealth.failureState.state === "clear"
        ? "pass"
        : operationalHealth.failureState.retry.retryable || operationalHealth.degradedMode !== "live-reservation"
          ? "warn"
          : "fail",
      severity: operationalHealth.failureState.retry.retryable ? "advisory" : "blocking"
    },
    {
      code: "provider.health-admission",
      label: "Provider health gate has an actionable dispatch, degraded-mode, or retry policy",
      status: runtimeDecision.healthAdmissionPolicy.blocking
        ? "fail"
        : runtimeDecision.healthAdmissionPolicy.state === "degraded"
          ? "warn"
          : "pass",
      severity: runtimeDecision.healthAdmissionPolicy.blocking ? "blocking" : "advisory"
    },
    {
      code: "lifecycle.settings",
      label: "Lifecycle settings are valid for hosted-kernel rate-limit enforcement",
      status: lifecycleControls.blockingIssues.length ? "fail" : lifecycleControls.validationIssues.length ? "warn" : "pass",
      severity: lifecycleControls.blockingIssues.length ? "blocking" : "advisory"
    },
    {
      code: "lifecycle.enforcement",
      label: "Rate-limit enforcement is enabled for this capability route",
      status: lifecycleControls.enabled && lifecycleControls.enforcementEnabled
        ? "pass"
        : lifecycleControls.state === "paused"
          ? "warn"
          : "skip",
      severity: lifecycleControls.state === "paused" ? "advisory" : "advisory"
    },
    {
      code: "lifecycle.schedule",
      label: "Lifecycle scheduler has a fresh refresh target",
      status: lifecycleControls.state === "schedule-drift" ? "warn" : "pass",
      severity: "advisory"
    },
    {
      code: "lifecycle.transition-plan",
      label: "Lifecycle command transition plan has a deterministic projected state",
      status: lifecycleControls.transitionPlan.blockingIssues.length
        ? "fail"
        : lifecycleControls.transitionPlan.state === "rejected"
          ? "warn"
          : "pass",
      severity: lifecycleControls.transitionPlan.blockingIssues.length ? "blocking" : "advisory"
    },
    {
      code: "reservation.mode",
      label: "Reservation API is available for quota holds",
      status: serviceContract.policy.reservationMode === "provider-reservation" ? "pass" : "warn",
      severity: "advisory"
    },
    {
      code: "external.handoff",
      label: "External handoff payload is prepared",
      status: externalHandoff.enabled ? "pass" : "skip",
      severity: "advisory"
    },
    {
      code: "provider.service-bridge",
      label: "Provider/service bridge has a delivery contract and acknowledgement state",
      status: providerServiceBridge.state === "not-available"
        ? "skip"
        : providerServiceBridge.delivery.dispatchAllowed
          || providerServiceBridge.state === "degraded-local-proof"
          || providerServiceBridge.acknowledgement.state === "acknowledged"
          ? "pass"
          : "warn",
      severity: "advisory"
    },
    {
      code: "provider.external-workflow",
      label: "External provider workflow exposes acceptance, checkpoint, remote idempotency, and replay-fence state",
      status: !providerServiceBridge.workflowContract?.required
        ? "skip"
        : providerServiceBridge.workflowContract.blocking
          ? providerServiceBridge.workflowContract.dispatchActionId
            && providerServiceBridge.workflowContract.remoteIdempotency?.replayFenceKey
            ? "warn"
            : "fail"
          : providerServiceBridge.workflowContract.remoteIdempotency?.headerNames?.length
            ? "pass"
            : "warn",
      severity: providerServiceBridge.workflowContract?.required
        && providerServiceBridge.workflowContract.blocking
        && !providerServiceBridge.workflowContract.dispatchActionId
        ? "blocking"
        : "advisory"
    },
    {
      code: "provider.handoff-receipt",
      label: "Provider handoff receipt matches the delivery id, cursor, and acknowledgement window",
      status: !providerHandoffReceipt.required
        ? "skip"
        : providerHandoffReceipt.state === "accepted"
          ? "pass"
          : providerHandoffReceipt.state === "awaiting-receipt"
            ? "warn"
            : "fail",
      severity: providerHandoffReceipt.state === "invalid" ? "blocking" : "advisory"
    },
    {
      code: "provider.handoff-receipt-durability",
      label: "Provider handoff receipt has durable replay metadata before dispatch",
      status: !providerHandoffReceipt.required
        ? "skip"
        : providerHandoffReceipt.durability.state === "ready-to-persist"
          ? "pass"
          : providerHandoffReceipt.durability.replayTokenRequired && !providerHandoffReceipt.receipt.replayToken
            ? "fail"
            : "warn",
      severity: providerHandoffReceipt.durability.replayTokenRequired && !providerHandoffReceipt.receipt.replayToken
        ? "blocking"
        : "advisory"
    },
    {
      code: "provider.operation-contract",
      label: "Provider operations expose valid endpoint, capability, TTL, and idempotency contracts",
      status: providerOperationContract.blockingIssues.length
        ? "fail"
        : providerOperationContract.warningIssues.length
          ? "warn"
          : "pass",
      severity: providerOperationContract.blockingIssues.length ? "blocking" : "advisory"
    },
    {
      code: "provider.operation-reserve",
      label: "Provider reserve operation is usable when runtime requires a reservation",
      status: runtimeDecision.reservationRequired
        ? providerOperationContract.reserveState === "ready" ? "pass" : "fail"
        : providerOperationContract.reserveState === "ready" ? "pass" : "skip",
      severity: runtimeDecision.reservationRequired ? "blocking" : "advisory"
    },
    {
      code: "reservation.execution-plan",
      label: "Reservation execution has provider readiness, idempotency, and replay proof before dispatch",
      status: !reservationExecutionPlan.required
        ? "skip"
        : ["ready-to-commit", "already-committed", "pending-provider-commit"].includes(reservationExecutionPlan.state)
          ? reservationExecutionPlan.state === "pending-provider-commit" ? "warn" : "pass"
          : "fail",
      severity: reservationExecutionPlan.required
        && ["blocked-by-provider-operation", "blocked-by-command-recovery", "missing-reserve-command"].includes(reservationExecutionPlan.state)
        ? "blocking"
        : "advisory"
    },
    {
      code: "provider.operation-handoff",
      label: "Provider external handoff operation is usable when handoff is enabled",
      status: externalHandoff.enabled
        ? providerOperationContract.externalHandoffState === "ready" ? "pass" : "fail"
        : "skip",
      severity: externalHandoff.enabled ? "blocking" : "advisory"
    },
    {
      code: "workflow.handoff-queue",
      label: "Client workflow handoff has dispatch, checkpoint, and replay state",
      status: workflowHandoffQueue.dispatch.canDispatch
        || ["held-by-runtime", "awaiting-reservation", "awaiting-capability-handoff", "awaiting-command-replay", "awaiting-provider-ack", "held-by-lifecycle"].includes(workflowHandoffQueue.state)
        ? "pass"
        : "fail",
      severity: "blocking"
    },
    {
      code: "workflow.capability-handoff",
      label: "External capability handoff has a client-visible owner, checkpoint, and next action",
      status: runtimeDecision.admissionGuard.externalHandoffWorkflow.blocking
        ? workflowHandoffQueue.capabilityHandoff.nextActionId
          && workflowHandoffQueue.capabilityHandoff.checkpointPolicy
          ? "warn"
          : "fail"
        : "pass",
      severity: runtimeDecision.admissionGuard.externalHandoffWorkflow.blocking ? "advisory" : "advisory"
    },
    {
      code: "workflow.client-checkpoint",
      label: "Client workflow checkpoint is aligned with the hosted-kernel cursor",
      status: workflowHandoffQueue.clientCheckpoint.state === "stale" ? "warn" : "pass",
      severity: "advisory"
    },
    {
      code: "provider.sync-lease",
      label: "Provider sync lease is writable for external handoff",
      status: providerServiceBridge.syncLease.writeAllowed
        ? "pass"
        : providerServiceBridge.syncLease.handoffState === "not-negotiated"
          ? "skip"
          : providerServiceBridge.syncLease.reasonCodes.some((code) => code === "sync.lease-foreign-owner")
            ? "fail"
            : "warn",
      severity: providerServiceBridge.syncLease.reasonCodes.some((code) => code === "sync.lease-foreign-owner")
        ? "blocking"
        : "advisory"
    },
    {
      code: "evidence.attached",
      label: "Runtime evidence was attached to the response",
      status: evidence.length ? "pass" : "warn",
      severity: "advisory"
    },
    {
      code: "runtime.request-cost",
      label: "Request cost fits the effective rate-limit window",
      status: runtimeDecision.admissionGuard.quotaExhausted || runtimeDecision.admissionGuard.classWindowExhausted
        ? "fail"
        : "pass",
      severity: "blocking"
    },
    {
      code: "runtime.capability-class-budget",
      label: "Capability class budget has room for this model, external, or interrupt request",
      status: runtimeDecision.admissionGuard.classWindowExhausted
        ? "fail"
        : runtimeDecision.admissionGuard.classPressureRatio >= runtimeDecision.admissionGuard.pressureThreshold
          ? "warn"
          : "pass",
      severity: runtimeDecision.admissionGuard.classWindowExhausted ? "blocking" : "advisory"
    },
    {
      code: "runtime.capability-lane",
      label: "Capability lane budget protects model calls, external systems, and operator interrupts",
      status: runtimeDecision.admissionGuard.capabilityLaneExhausted
        ? "fail"
        : runtimeDecision.admissionGuard.capabilityLaneState === "exhausted"
          ? "warn"
          : "pass",
      severity: runtimeDecision.admissionGuard.capabilityLaneExhausted ? "blocking" : "advisory"
    },
    {
      code: "runtime.capability-rate-class",
      label: "Capability class has an enforceable rate-limit profile",
      status: runtimeDecision.admissionGuard.classHandoffBlocked
        ? "fail"
        : runtimeDecision.request.capabilityRateClass === "operator-interrupt"
          && runtimeDecision.admissionGuard.localEmergencyEligible
          ? "warn"
          : "pass",
      severity: runtimeDecision.admissionGuard.classHandoffBlocked ? "blocking" : "advisory"
    },
    {
      code: "runtime.capability-admission-packet",
      label: "Capability admission packet declares the dispatch, reservation, handoff, or emergency path",
      status: runtimeDecision.accounting.capabilityAdmissionPacket.action === "wait-for-capability-budget"
        && runtimeDecision.allowed
        ? "fail"
        : runtimeDecision.accounting.capabilityAdmissionPacket.pressureState === "elevated"
          ? "warn"
          : "pass",
      severity: runtimeDecision.accounting.capabilityAdmissionPacket.action === "wait-for-capability-budget"
        && runtimeDecision.allowed
        ? "blocking"
        : "advisory"
    },
    {
      code: "runtime.operator-interrupt-emergency",
      label: "Operator interrupt emergency burst is bounded and auditable",
      status: runtimeDecision.admissionGuard.emergencyAdmission.state === "exhausted"
        ? "fail"
        : runtimeDecision.admissionGuard.emergencyAdmission.state === "granted"
          ? "warn"
          : "pass",
      severity: runtimeDecision.admissionGuard.emergencyAdmission.state === "exhausted"
        ? "blocking"
        : "advisory"
    },
    {
      code: "runtime.admission-guard",
      label: "Admission guard can route the request through local proof, reservation, or wait state",
      status: runtimeDecision.admissionGuard.state === "blocked"
        ? "fail"
        : runtimeDecision.admissionGuard.state === "pressure"
          || runtimeDecision.admissionGuard.state === "reservation-required"
          ? "warn"
          : "pass",
      severity: runtimeDecision.admissionGuard.state === "blocked" ? "blocking" : "advisory"
    },
    {
      code: "runtime.workflow-handoff",
      label: "Workflow has a concrete next action for the request",
      status: runtimeDecision.workflowHandoff.nextActionId ? "pass" : "fail",
      severity: "blocking"
    },
    {
      code: "boundary.tenant-workspace",
      label: "Request is scoped to the negotiated tenant and workspace",
      status: accessBoundary.isTenantScoped && accessBoundary.isWorkspaceScoped && accessBoundary.isRequestScoped
        ? "pass"
        : accessBoundary.mode === "audit-only"
          ? "warn"
          : "fail",
      severity: accessBoundary.mode === "audit-only" ? "advisory" : "blocking"
    },
    {
      code: "boundary.capability-route",
      label: "Request capability and route are inside the configured boundary allowlists",
      status: accessBoundary.isCapabilityScoped && accessBoundary.isRouteScoped ? "pass" : "fail",
      severity: "blocking"
    },
    {
      code: "boundary.workspace-grant",
      label: "Explicit workspace grants authorize this tenant, workspace, capability, route, role, and permission",
      status: accessBoundary.workspaceGrant.accepted
        ? "pass"
        : accessBoundary.mode === "audit-only"
          ? "warn"
          : "fail",
      severity: accessBoundary.mode === "audit-only" ? "advisory" : "blocking"
    },
    {
      code: "boundary.role-permission",
      label: "Principal role and permissions can consume rate-limit quota",
      status: accessBoundary.violations.some((violation) => violation === "role.not-authorized" || violation === "permission.missing")
        ? accessBoundary.mode === "audit-only" ? "warn" : "fail"
        : "pass",
      severity: accessBoundary.mode === "audit-only" ? "advisory" : "blocking"
    },
    {
      code: "persistence.subject",
      label: "Persisted state belongs to the negotiated subject",
      status: persistedState.isSubjectMatch ? "pass" : "fail",
      severity: "blocking"
    },
    {
      code: "persistence.ledger-reconciliation",
      label: "Persisted ledger totals reconcile with the observed client quota snapshot",
      status: persistedState.ledgerReconciliation.state === "aligned"
        ? "pass"
        : persistedState.ledgerReconciliation.replayDirection === "rebuild-capability-class-ledger"
          ? "warn"
          : "fail",
      severity: persistedState.ledgerReconciliation.replayDirection === "rebuild-capability-class-ledger"
        ? "advisory"
        : "blocking"
    },
    {
      code: "persistence.recovery",
      label: "Restart recovery has a deterministic replay plan",
      status: recoveryPlan.actions.every((action) => action.idempotencyKey) ? "pass" : "fail",
      severity: "blocking"
    },
    {
      code: "persistence.durable-projection",
      label: "Next persisted ledger projection is restart-safe and within policy",
      status: durableProjection.invariantViolations.length
        ? durableProjection.invariantViolations.includes("projection.recovery-required")
          ? "warn"
          : "fail"
        : "pass",
      severity: durableProjection.invariantViolations.includes("projection.recovery-required")
        ? "advisory"
        : "blocking"
    },
    {
      code: "persistence.command-recovery",
      label: "Persisted command journal can be replayed without duplicate command append",
      status: durableProjection.commandRecovery.state === "invalid"
        ? "fail"
        : durableProjection.commandRecovery.replayRequiredCount
          ? "warn"
          : "pass",
      severity: durableProjection.commandRecovery.state === "invalid" ? "blocking" : "advisory"
    }
  ];
  const failed = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");

  return {
    status: failed.length ? "failed" : warnings.length ? "warning" : "passed",
    blockingFailureCount: failed.length,
    warningCount: warnings.length,
    negotiationStatus: negotiation.status,
    checks
  };
}

function buildAcceptance(validationSummary, providerContract, serviceContract, negotiation, externalHandoff, providerServiceBridge, providerOperationContract) {
  const accepted = validationSummary.blockingFailureCount === 0 && negotiation.status === "accepted";
  const mode = accepted && providerContract.health === "ready" ? "hosted-kernel-live" : "hosted-kernel-preview";

  return {
    accepted,
    mode,
    decision: accepted ? "accept" : "hold-for-remediation",
    subjectKey: serviceContract.subjectKey,
    acceptedCapabilities: negotiation.accepted,
    externalHandoffAccepted: accepted
      && externalHandoff.enabled
      && providerServiceBridge.delivery.dispatchAllowed
      && providerOperationContract.externalHandoffState === "ready",
    providerSyncAccepted: accepted && providerServiceBridge.syncLease.writeAllowed,
    providerOperationState: providerOperationContract.state,
    reasonCodes: validationSummary.checks
      .filter((check) => check.status === "fail" || check.status === "warn")
      .map((check) => check.code)
  };
}

function buildReadiness(providerContract, serviceContract, negotiation, validationSummary, externalHandoff, recoveryPlan, operationalHealth, providerServiceBridge, providerOperationContract) {
  const blockers = validationSummary.checks
    .filter((check) => check.status === "fail")
    .map((check) => check.code);
  const degraded = operationalHealth.state === "degraded" || providerContract.health !== "ready" || negotiation.status !== "accepted";
  const recoveryRequired = recoveryPlan.state === "recovery-required";

  return {
    state: blockers.length || operationalHealth.state === "unhealthy" ? "blocked" : recoveryRequired ? "recovering" : degraded ? "degraded" : "ready",
    canEnforce: blockers.length === 0,
    canReserve: serviceContract.policy.reservationMode === "provider-reservation"
      && providerOperationContract.reserveState === "ready"
      && operationalHealth.degradedMode === "live-reservation"
      && !blockers.length
      && !recoveryRequired,
    canRelease: providerContract.capabilities.includes("rate-limit.release.v1") && !blockers.length && !recoveryRequired,
    canExternalHandoff: externalHandoff.enabled
      && providerServiceBridge.delivery.dispatchAllowed
      && providerOperationContract.externalHandoffState === "ready"
      && !blockers.length
      && !recoveryRequired,
    canWriteProviderSync: providerServiceBridge.syncLease.writeAllowed && !blockers.length && !recoveryRequired,
    blockerCodes: blockers,
    refreshAfterMs: operationalHealth.retryAfterMs || (degraded || recoveryRequired ? 15_000 : serviceContract.policy.windowMs),
    degradedMode: operationalHealth.degradedMode,
    operationalSignals: operationalHealth.signals,
    providerSyncLeaseState: providerServiceBridge.syncLease.state,
    providerSyncHandoffState: providerServiceBridge.syncLease.handoffState,
    providerBridgeState: providerServiceBridge.state,
    providerBridgeAckState: providerServiceBridge.acknowledgement.state,
    providerOperationState: providerOperationContract.state,
    providerReserveOperationState: providerOperationContract.reserveState,
    providerHandoffOperationState: providerOperationContract.externalHandoffState,
    externalProviderWorkflowState: providerServiceBridge.workflowContract?.state || "not-required",
    externalProviderWorkflowActionId: providerServiceBridge.workflowContract?.dispatchActionId || "",
    externalProviderWorkflowBlocking: providerServiceBridge.workflowContract?.blocking || false,
    externalProviderWorkflowReasonCodes: providerServiceBridge.workflowContract?.reasonCodes || []
  };
}

function buildUserPreview(now, serviceContract, providerContract, negotiation, readiness, validationSummary, runtimeDecision, operationalHealth, lifecycleControls, providerServiceBridge = null) {
  const windowSeconds = Math.round(serviceContract.policy.windowMs / 1_000);
  const remainingAfterBurst = Math.max(0, serviceContract.policy.maxRequests - serviceContract.policy.burstRequests);
  const providerSafety = providerServiceBridge?.providerSafety || null;

  return {
    title: "Rate limit preview",
    generatedAt: now,
    summary: `${serviceContract.policy.maxRequests} ${serviceContract.policy.unit} per ${windowSeconds}s for ${serviceContract.capabilityId}`,
    subject: {
      tenantId: serviceContract.tenantId,
      workspaceId: serviceContract.workspaceId,
      capabilityId: serviceContract.capabilityId,
      serviceId: serviceContract.serviceId,
      subjectKey: serviceContract.subjectKey
    },
    policyPreview: {
      windowSeconds,
      maxRequests: serviceContract.policy.maxRequests,
      burstRequests: serviceContract.policy.burstRequests,
      steadyRequestsAfterBurst: remainingAfterBurst,
      reservationMode: serviceContract.policy.reservationMode,
      enforcement: serviceContract.policy.enforcement
    },
    providerPreview: {
      providerId: providerContract.providerId,
      health: providerContract.health,
      negotiatedStatus: negotiation.status,
      readinessState: readiness.state,
      validationStatus: validationSummary.status,
      degradedMode: operationalHealth.degradedMode,
      retryAfterMs: operationalHealth.retryAfterMs,
      syncLeaseState: readiness.providerSyncLeaseState,
      syncHandoffState: readiness.providerSyncHandoffState,
      operationContractState: readiness.providerOperationState,
      reserveOperationState: readiness.providerReserveOperationState,
      handoffOperationState: readiness.providerHandoffOperationState,
      safetyEnvelopeState: providerSafety?.state || "not-evaluated",
      safetyNextActionId: providerSafety?.dispatch?.nextActionId || "",
      safetyCanDispatch: providerSafety?.dispatch?.canDispatch ?? false,
      safetyRisk: providerSafety?.risk || "unknown",
      safetyReasonCodes: providerSafety?.dispatch?.reasonCodes || [],
      externalProviderWorkflow: providerServiceBridge?.workflowContract
        ? {
            state: providerServiceBridge.workflowContract.state,
            required: providerServiceBridge.workflowContract.required,
            blocking: providerServiceBridge.workflowContract.blocking,
            dispatchActionId: providerServiceBridge.workflowContract.dispatchActionId,
            owner: providerServiceBridge.workflowContract.owner,
            checkpointPolicy: providerServiceBridge.workflowContract.checkpointPolicy,
            remoteIdempotency: providerServiceBridge.workflowContract.remoteIdempotency,
            acceptance: providerServiceBridge.workflowContract.acceptance,
            checkpoint: providerServiceBridge.workflowContract.checkpoint,
            reasonCodes: providerServiceBridge.workflowContract.reasonCodes
          }
        : null,
      signals: operationalHealth.signals
    },
    lifecyclePreview: {
      state: lifecycleControls.state,
      enabled: lifecycleControls.enabled,
      enforcementEnabled: lifecycleControls.enforcementEnabled,
      reservationsEnabled: lifecycleControls.reservationsEnabled,
      auditEnabled: lifecycleControls.auditEnabled,
      nextActionId: lifecycleControls.nextAction.actionId,
      retryAfterMs: lifecycleControls.nextAction.retryAfterMs,
      scheduleMode: lifecycleControls.schedule.mode,
      nextRunAt: lifecycleControls.schedule.nextRunAt,
      transitionState: lifecycleControls.transitionPlan.state,
      projectedSettings: lifecycleControls.transitionPlan.projectedSettings,
      transitionNextActionId: lifecycleControls.transitionPlan.nextAction.actionId,
      validationIssues: lifecycleControls.validationIssues
    },
    requestPreview: {
      requestId: runtimeDecision.request.requestId,
      clientId: runtimeDecision.request.clientId,
      routeId: runtimeDecision.request.routeId,
      capabilityRateClass: runtimeDecision.request.capabilityRateClass,
      decision: runtimeDecision.decision,
      allowed: runtimeDecision.allowed,
      boundaryState: runtimeDecision.accessBoundary.state,
      boundaryViolations: runtimeDecision.accessBoundary.violations,
      workspaceGrantAccepted: runtimeDecision.accessBoundary.workspaceGrant.accepted,
      workspaceGrantIds: runtimeDecision.accessBoundary.workspaceGrant.matchedGrantIds,
      remainingBeforeRequest: runtimeDecision.accounting.remainingBeforeRequest,
      remainingAfterRequest: runtimeDecision.accounting.remainingAfterRequest,
      requestedCost: runtimeDecision.accounting.requestedCost,
      baseCost: runtimeDecision.accounting.baseCost,
      classWeight: runtimeDecision.accounting.classWeight,
      capabilityAdmissionPacket: runtimeDecision.accounting.capabilityAdmissionPacket,
      classWindowLimit: runtimeDecision.accounting.classWindowLimit,
      capabilityLaneState: runtimeDecision.accounting.capabilityLaneState,
      capabilityLaneRemainingBeforeRequest: runtimeDecision.accounting.capabilityLaneRemainingBeforeRequest,
      capabilityLaneRemainingAfterRequest: runtimeDecision.accounting.capabilityLaneRemainingAfterRequest,
      capabilityLaneDeficit: runtimeDecision.accounting.capabilityLaneDeficit,
      emergencyAdmission: runtimeDecision.accounting.emergencyAdmission,
      classAccountedRequests: runtimeDecision.accounting.classAccountedRequests,
      classRemainingBeforeRequest: runtimeDecision.accounting.classRemainingBeforeRequest,
      classRemainingAfterRequest: runtimeDecision.accounting.classRemainingAfterRequest,
      classBudgetRemaining: runtimeDecision.accounting.classBudgetRemaining,
      admissionGuardState: runtimeDecision.admissionGuard.state,
      healthAdmissionState: runtimeDecision.healthAdmissionPolicy.state,
      healthAdmissionDispatchMode: runtimeDecision.healthAdmissionPolicy.dispatchMode,
      healthAdmissionError: runtimeDecision.healthAdmissionPolicy.errorContract,
      externalHandoffState: runtimeDecision.admissionGuard.externalHandoffState,
      externalHandoffReady: runtimeDecision.admissionGuard.externalHandoffReady,
      externalHandoffContract: runtimeDecision.admissionGuard.externalHandoffContract,
      externalHandoffWorkflow: runtimeDecision.admissionGuard.externalHandoffWorkflow,
      providerSafety,
      admissionPath: runtimeDecision.accounting.capabilityAdmissionPacket.path,
      admissionAction: runtimeDecision.accounting.capabilityAdmissionPacket.action,
      admissionGuardReasons: runtimeDecision.admissionGuard.reasonCodes,
      pressureThreshold: runtimeDecision.admissionGuard.pressureThreshold,
      burstBudgetRemaining: runtimeDecision.accounting.burstBudgetRemaining,
      pressureRatio: runtimeDecision.accounting.pressureRatio,
      classPressureRatio: runtimeDecision.accounting.classPressureRatio,
      nextActionId: runtimeDecision.workflowHandoff.nextActionId
    }
  };
}

function buildActionableErrors(validationSummary, readiness, operationalHealth, runtimeDecision, recoveryPlan, lifecycleControls, providerServiceBridge, providerHandoffReceipt, providerOperationContract, workflowHandoffQueue, syncMetadata) {
  const errors = [];
  const seenErrorKeys = new Set();
  const pushError = (error) => {
    if (!error || !error.code) {
      return;
    }

    const source = asIdentifier(error.source, "rate-limit");
    const code = asIdentifier(error.code, "unknown");
    const key = `${source}:${code}:${asIdentifier(error.actionId, "observe")}`;

    if (seenErrorKeys.has(key)) {
      return;
    }

    seenErrorKeys.add(key);
    errors.push({
      schema: "rate-limit.actionable-error.v1",
      errorId: `${runtimeDecision.subjectKey}:error:${errors.length + 1}`,
      code,
      source,
      severity: ["blocking", "retryable", "warning"].includes(error.severity)
        ? error.severity
        : "warning",
      message: asIdentifier(error.message, "Rate-limit surface requires operator attention"),
      actionId: asIdentifier(error.actionId, `resolve.${code}`),
      retryable: asBoolean(error.retryable, error.severity === "retryable" || error.retryAfterMs > 0),
      retryAfterMs: Math.max(0, asNonNegativeInteger(error.retryAfterMs, 0)),
      degradedMode: asIdentifier(error.degradedMode, operationalHealth.degradedMode),
      target: asObject(error.target),
      evidenceRefs: asIdentifierList(error.evidenceRefs)
    });
  };

  validationSummary.checks
    .filter((check) => check.status === "fail" || check.status === "warn")
    .forEach((check) => {
      pushError({
        code: check.code,
        source: "validation",
        severity: check.severity === "blocking" ? "blocking" : "warning",
        message: check.label,
        actionId: `resolve.${check.code}`,
        retryAfterMs: check.code.startsWith("provider.") ? operationalHealth.retryAfterMs : 0,
        target: {
          validationStatus: check.status,
          readinessState: readiness.state
        },
        evidenceRefs: [`validation.${check.code}`]
      });
    });

  if (operationalHealth.failureState.state === "active") {
    pushError({
      code: operationalHealth.failureState.errorCode || "provider.failure-active",
      source: "provider-health",
      severity: operationalHealth.failureState.severity === "blocking" ? "blocking" : "retryable",
      message: operationalHealth.failureState.message || "Hosted-kernel rate-limit provider is not ready",
      actionId: "retry.rate-limit.provider-operation",
      retryable: operationalHealth.failureState.retry.retryable,
      retryAfterMs: operationalHealth.failureState.retry.retryAfterMs,
      target: {
        providerId: operationalHealth.providerId,
        operation: operationalHealth.failureState.operation,
        consecutiveFailures: operationalHealth.failureState.consecutiveFailures
      },
      evidenceRefs: ["operationalHealth.failureState"]
    });
  }

  syncMetadata.providerSyncLease.reasonCodes.forEach((reasonCode) => {
    pushError({
      code: reasonCode,
      source: "provider-sync-lease",
      severity: reasonCode === "sync.lease-foreign-owner" ? "blocking" : "retryable",
      message: "Provider sync lease is not writable for hosted-kernel rate-limit handoff",
      actionId: "lease.rate-limit.provider-sync",
      retryAfterMs: readiness.refreshAfterMs,
      target: {
        leaseId: syncMetadata.providerSyncLease.lease.leaseId,
        leaseState: syncMetadata.providerSyncLease.lease.state,
        handoffState: syncMetadata.providerSyncLease.handoffState
      },
      evidenceRefs: ["sync.providerSyncLease"]
    });
  });

  providerOperationContract.blockingIssues.forEach((issue) => {
    pushError({
      code: issue,
      source: "provider-operation-contract",
      severity: "blocking",
      message: "Provider operation contract is missing required capability, endpoint, idempotency, or sync-lease support",
      actionId: "contract.rate-limit.provider-operations",
      target: {
        providerOperationState: providerOperationContract.state,
        reserveState: providerOperationContract.reserveState,
        externalHandoffState: providerOperationContract.externalHandoffState
      },
      evidenceRefs: ["providerOperationContract.blockingIssues"]
    });
  });

  providerOperationContract.warningIssues.forEach((issue) => {
    pushError({
      code: issue,
      source: "provider-operation-contract",
      severity: "warning",
      message: "Optional provider operation is unavailable for this rate-limit surface",
      actionId: "contract.rate-limit.provider-operations",
      target: {
        providerOperationState: providerOperationContract.state
      },
      evidenceRefs: ["providerOperationContract.warningIssues"]
    });
  });

  lifecycleControls.blockingIssues.forEach((issue) => {
    pushError({
      code: issue,
      source: "lifecycle",
      severity: "blocking",
      message: "Lifecycle settings block hosted-kernel rate-limit enforcement",
      actionId: lifecycleControls.nextAction.actionId,
      retryAfterMs: lifecycleControls.nextAction.retryAfterMs,
      target: {
        lifecycleState: lifecycleControls.state,
        scheduleMode: lifecycleControls.schedule.mode
      },
      evidenceRefs: ["lifecycleControls.blockingIssues"]
    });
  });

  lifecycleControls.validationIssues
    .filter((issue) => !lifecycleControls.blockingIssues.includes(issue))
    .forEach((issue) => {
      pushError({
        code: issue,
        source: "lifecycle",
        severity: "warning",
        message: "Lifecycle settings should be reviewed before live rate-limit enforcement",
        actionId: lifecycleControls.nextAction.actionId,
        retryAfterMs: lifecycleControls.nextAction.retryAfterMs,
        target: {
          lifecycleState: lifecycleControls.state
        },
        evidenceRefs: ["lifecycleControls.validationIssues"]
      });
    });

  if (providerServiceBridge.state !== "not-available" && !providerServiceBridge.delivery.dispatchAllowed) {
    pushError({
      code: providerServiceBridge.delivery.reasonCode,
      source: "provider-service-bridge",
      severity: providerServiceBridge.syncLease.reasonCodes.includes("sync.lease-foreign-owner") ? "blocking" : "retryable",
      message: "Provider service bridge cannot deliver the rate-limit handoff yet",
      actionId: providerServiceBridge.acknowledgement.required
        ? "ack.rate-limit.provider-service-bridge"
        : "handoff.rate-limit.external",
      retryAfterMs: providerServiceBridge.delivery.nextAttemptAfterMs,
      target: {
        deliveryId: providerServiceBridge.delivery.deliveryId,
        bridgeState: providerServiceBridge.state,
        acknowledgementState: providerServiceBridge.acknowledgement.state
      },
      evidenceRefs: ["providerServiceBridge.delivery"]
    });
  }

  if (providerServiceBridge.workflowContract?.blocking) {
    pushError({
      code: providerServiceBridge.workflowContract.reasonCodes[0] || "external-provider-workflow.blocked",
      source: "external-provider-workflow",
      severity: providerServiceBridge.workflowContract.owner === "operator" ? "warning" : "retryable",
      message: "External provider workflow requires acceptance, checkpoint, sync lease, or replay-fence remediation before dispatch",
      actionId: providerServiceBridge.workflowContract.dispatchActionId,
      retryAfterMs: providerServiceBridge.workflowContract.retryAfterMs,
      target: {
        providerProfile: providerServiceBridge.workflowContract.providerProfile,
        operationKind: providerServiceBridge.workflowContract.operationKind,
        state: providerServiceBridge.workflowContract.state,
        owner: providerServiceBridge.workflowContract.owner,
        replayFenceKey: providerServiceBridge.workflowContract.remoteIdempotency?.replayFenceKey || ""
      },
      evidenceRefs: ["providerServiceBridge.workflowContract"]
    });
  }

  if (providerHandoffReceipt.required && providerHandoffReceipt.state !== "accepted") {
    pushError({
      code: providerHandoffReceipt.violationCodes[0] || `provider-handoff-receipt.${providerHandoffReceipt.state}`,
      source: "provider-handoff-receipt",
      severity: providerHandoffReceipt.state === "invalid" ? "blocking" : "retryable",
      message: "Provider handoff receipt must match the delivery id and hosted-kernel cursor before durable dispatch",
      actionId: providerHandoffReceipt.nextAction.actionId,
      retryAfterMs: providerHandoffReceipt.nextAction.retryAfterMs,
      target: {
        receiptId: providerHandoffReceipt.receipt.receiptId,
        deliveryId: providerHandoffReceipt.receipt.expectedDeliveryId,
        cursor: providerHandoffReceipt.receipt.expectedCursor,
        durabilityState: providerHandoffReceipt.durability.state
      },
      evidenceRefs: ["providerHandoffReceipt.proof"]
    });
  }

  if (!workflowHandoffQueue.dispatch.canDispatch) {
    pushError({
      code: workflowHandoffQueue.proof.reasonCodes[0] || `workflow.${workflowHandoffQueue.state}`,
      source: "workflow-handoff",
      severity: workflowHandoffQueue.state === "held-by-runtime" ? "blocking" : "retryable",
      message: "Client workflow is held until rate-limit proof, reservation, replay, or acknowledgement completes",
      actionId: workflowHandoffQueue.dispatch.nextActionId,
      retryAfterMs: workflowHandoffQueue.dispatch.retryAfterMs,
      target: {
        handoffId: workflowHandoffQueue.handoffId,
        queueState: workflowHandoffQueue.state,
        pendingCommandCount: workflowHandoffQueue.commandBacklog.pendingCount
      },
      evidenceRefs: ["workflowHandoffQueue.proof"]
    });
  }

  if (workflowHandoffQueue.capabilityHandoff.blocking) {
    pushError({
      code: workflowHandoffQueue.capabilityHandoff.reasonCodes[0] || "workflow.capability-handoff-blocked",
      source: "capability-handoff",
      severity: workflowHandoffQueue.capabilityHandoff.owner === "provider" ? "retryable" : "blocking",
      message: "External-system rate-limit handoff must complete before the client workflow can dispatch",
      actionId: workflowHandoffQueue.capabilityHandoff.nextActionId,
      retryAfterMs: workflowHandoffQueue.capabilityHandoff.retryAfterMs,
      target: {
        handoffId: workflowHandoffQueue.handoffId,
        owner: workflowHandoffQueue.capabilityHandoff.owner,
        checkpointPolicy: workflowHandoffQueue.capabilityHandoff.checkpointPolicy,
        capabilityHandoffState: workflowHandoffQueue.capabilityHandoff.state
      },
      evidenceRefs: ["workflowHandoffQueue.capabilityHandoff"]
    });
  }

  const runtimeError = runtimeDecision.allowed
    ? null
    : {
        code: runtimeDecision.decision,
        source: "runtime",
        severity: ["deny-boundary", "deny-lifecycle-invalid", "deny-capability-contract"].includes(runtimeDecision.decision) ? "blocking" : "retryable",
        message: runtimeDecision.decision === "deny-boundary"
          ? "Rate-limit request is outside the allowed tenant, workspace, role, or permission boundary"
          : runtimeDecision.decision === "deny-lifecycle-invalid"
            ? "Rate-limit lifecycle settings are invalid for this capability route"
            : runtimeDecision.decision === "deny-capability-contract"
              ? "Rate-limit capability class requires a provider contract that was not negotiated"
            : runtimeDecision.decision === "deny-provider-unhealthy"
              ? "Rate-limit provider health blocks this request until retry or degraded-mode proof is available"
            : runtimeDecision.decision === "lifecycle-paused"
              ? "Rate-limit lifecycle is paused until the configured resume time"
              : runtimeDecision.decision === "throttle-burst"
                ? "Rate-limit burst capacity is exhausted and no hosted-kernel reservation can admit this request"
                : "Rate-limit quota is exhausted for the active policy window",
        actionId: runtimeDecision.workflowHandoff.nextActionId,
        retryAfterMs: runtimeDecision.retryAfterMs,
        target: {
          requestId: runtimeDecision.request.requestId,
          routeId: runtimeDecision.request.routeId,
          admissionGuardState: runtimeDecision.admissionGuard.state,
          healthAdmissionState: runtimeDecision.healthAdmissionPolicy.state,
          healthDispatchMode: runtimeDecision.healthAdmissionPolicy.dispatchMode
        },
        evidenceRefs: ["runtime.workflowHandoff", "runtime.admissionGuard"]
      };

  pushError(runtimeError);
  pushError(runtimeDecision.healthAdmissionPolicy.errorContract
    ? {
        ...runtimeDecision.healthAdmissionPolicy.errorContract,
        source: "health-admission",
        evidenceRefs: ["runtime.healthAdmissionPolicy", "operationalHealth"]
      }
    : null);
  recoveryPlan.actions.forEach((action) => {
    pushError({
      code: action.reasonCode,
      source: "persistence-recovery",
      severity: action.priority === "required" ? "blocking" : "warning",
      message: "Persisted rate-limit state must be reconciled before dispatch",
      actionId: action.actionId,
      retryAfterMs: readiness.refreshAfterMs,
      target: {
        syncKey: syncMetadata.syncKey,
        cursor: syncMetadata.cursor,
        idempotencyKey: action.idempotencyKey
      },
      evidenceRefs: ["persistence.recovery.actions"]
    });
  });

  const blockingCount = errors.filter((error) => error.severity === "blocking").length;
  const retryableCount = errors.filter((error) => error.severity === "retryable").length;
  const warningCount = errors.filter((error) => error.severity === "warning").length;

  return {
    schema: "rate-limit.actionable-errors.v1",
    state: blockingCount ? "blocking" : retryableCount ? "retryable" : warningCount ? "warning" : "clear",
    hasErrors: errors.length > 0,
    blockingCount,
    retryableCount,
    warningCount,
    primaryError: errors.find((error) => error.severity === "blocking")
      || errors.find((error) => error.severity === "retryable")
      || errors[0]
      || null,
    errors
  };
}

function addMsToTimestamp(timestamp, delayMs) {
  const timestampMs = Date.parse(timestamp);

  return Number.isFinite(timestampMs) && delayMs > 0
    ? new Date(timestampMs + delayMs).toISOString()
    : null;
}

function buildOperationalRecoveryEnvelope(now, readiness, operationalHealth, actionableErrors, runtimeDecision, lifecycleControls, providerServiceBridge, workflowHandoffQueue) {
  const blockingErrors = actionableErrors.errors.filter((error) => error.severity === "blocking");
  const retryableErrors = actionableErrors.errors.filter((error) => (
    error.severity === "retryable" || error.retryAfterMs > 0
  ));
  const warningErrors = actionableErrors.errors.filter((error) => error.severity === "warning");
  const positiveRetryDelays = [
    operationalHealth.retryAfterMs,
    runtimeDecision.retryAfterMs,
    lifecycleControls.nextAction.retryAfterMs,
    workflowHandoffQueue.dispatch.retryAfterMs
  ].filter((delayMs) => Number.isInteger(delayMs) && delayMs > 0);
  const retryAfterMs = positiveRetryDelays.length ? Math.min(...positiveRetryDelays) : 0;
  const primaryError = blockingErrors[0] || retryableErrors[0] || warningErrors[0] || null;
  const providerDeliveryBlocked = providerServiceBridge.state !== "not-available"
    && !providerServiceBridge.delivery.dispatchAllowed;
  const workflowHeld = !workflowHandoffQueue.dispatch.canDispatch;
  const degradedDispatchAllowed = runtimeDecision.allowed
    && operationalHealth.localProofUsable
    && operationalHealth.degradedMode === "local-proof-only"
    && lifecycleControls.enforcementEnabled
    && lifecycleControls.auditEnabled
    && !blockingErrors.some((error) => error.code.startsWith("boundary.") || error.code === "deny-boundary");
  const recoveryState = blockingErrors.length
    ? "blocked"
    : retryableErrors.length || providerDeliveryBlocked || workflowHeld
      ? "retryable"
      : warningErrors.length || readiness.state === "degraded"
        ? "degraded"
        : "ready";
  const nextActionId = primaryError
    ? primaryError.actionId
    : workflowHeld
      ? workflowHandoffQueue.dispatch.nextActionId
      : providerDeliveryBlocked
        ? "handoff.rate-limit.external"
        : "monitor.rate-limit.health";

  return {
    schema: "rate-limit.operational-recovery-envelope.v1",
    generatedAt: now,
    state: recoveryState,
    subjectKey: runtimeDecision.subjectKey,
    requestId: runtimeDecision.request.requestId,
    routeId: runtimeDecision.request.routeId,
    primaryError: primaryError
      ? {
          code: primaryError.code,
          severity: primaryError.severity,
          actionId: primaryError.actionId,
          retryAfterMs: primaryError.retryAfterMs
        }
      : null,
    retryPlan: {
      strategy: operationalHealth.failureState.retry.strategy,
      retryable: retryableErrors.length > 0 || operationalHealth.failureState.retry.retryable,
      retryAfterMs,
      nextAttemptAt: addMsToTimestamp(now, retryAfterMs),
      providerRetryAfterMs: operationalHealth.retryAfterMs,
      runtimeRetryAfterMs: runtimeDecision.retryAfterMs,
      lifecycleRetryAfterMs: lifecycleControls.nextAction.retryAfterMs,
      workflowRetryAfterMs: workflowHandoffQueue.dispatch.retryAfterMs,
      consecutiveFailures: operationalHealth.failureState.consecutiveFailures
    },
    degradedPolicy: {
      mode: operationalHealth.degradedMode,
      localProofUsable: operationalHealth.localProofUsable,
      allowLocalDispatch: degradedDispatchAllowed,
      denyNewReservations: operationalHealth.degradedMode === "deny-new-reservations",
      requireAuditProof: lifecycleControls.auditEnabled,
      reservePath: operationalHealth.reservePath,
      auditPath: operationalHealth.auditPath
    },
    dispatchGate: {
      state: runtimeDecision.workflowHandoff.state,
      canDispatch: workflowHandoffQueue.dispatch.canDispatch || degradedDispatchAllowed,
      runtimeAllowed: runtimeDecision.allowed,
      providerBridgeState: providerServiceBridge.state,
      providerDeliveryAllowed: providerServiceBridge.delivery.dispatchAllowed,
      providerAckState: providerServiceBridge.acknowledgement.state,
      workflowQueueState: workflowHandoffQueue.state,
      nextActionId
    },
    errorRollup: {
      blockingCount: blockingErrors.length,
      retryableCount: retryableErrors.length,
      warningCount: warningErrors.length,
      codes: actionableErrors.errors.map((error) => error.code).slice(0, 12)
    },
    remediationProof: {
      proofId: `${runtimeDecision.subjectKey}:recovery:${runtimeDecision.request.requestId}`,
      idempotencyKey: `${runtimeDecision.subjectKey}:recovery:${runtimeDecision.request.requestId}:${nextActionId}`,
      actionId: nextActionId,
      reasonCodes: [
        primaryError ? primaryError.code : null,
        operationalHealth.failureState.errorCode,
        providerDeliveryBlocked ? providerServiceBridge.delivery.reasonCode : null,
        workflowHeld ? workflowHandoffQueue.proof.reasonCodes[0] : null,
        readiness.state !== "ready" ? `readiness.${readiness.state}` : null
      ].filter(Boolean)
    }
  };
}

function buildNextSteps(validationSummary, readiness, externalHandoff, syncMetadata, runtimeDecision, recoveryPlan, idempotentCommands, operationalHealth, lifecycleControls, providerServiceBridge, providerHandoffReceipt, providerOperationContract, workflowHandoffQueue, commandRecoveryIndex, reservationExecutionPlan) {
  const remediationSteps = validationSummary.checks
    .filter((check) => check.status === "fail" || check.status === "warn")
    .map((check) => ({
      actionId: `resolve.${check.code}`,
      priority: check.severity === "blocking" ? "required" : "recommended",
      label: check.label,
      reasonCode: check.code
    }));
  const operationalSteps = [
    {
      actionId: "health.rate-limit.provider",
      priority: operationalHealth.state === "healthy" ? "ready" : operationalHealth.state === "degraded" ? "recommended" : "required",
      label: operationalHealth.state === "healthy"
        ? "Provider health is ready for live rate-limit enforcement"
        : "Apply provider retry or degraded-mode handling before live reservation",
      reasonCode: operationalHealth.failureState.errorCode,
      degradedMode: operationalHealth.degradedMode,
      retryAfterMs: operationalHealth.retryAfterMs
    },
    {
      actionId: "sync.rate-limit.snapshot",
      priority: readiness.canEnforce ? "ready" : "blocked",
      label: "Fetch hosted-kernel rate-limit snapshot",
      syncKey: syncMetadata.syncKey
    },
    {
      actionId: "audit.rate-limit.proof",
      priority: readiness.canEnforce ? "ready" : "blocked",
      label: "Attach audit proof to the capability route response",
      syncKey: syncMetadata.syncKey
    }
  ];

  operationalSteps.push({
    actionId: "lease.rate-limit.provider-sync",
    priority: readiness.canWriteProviderSync
      ? "ready"
      : syncMetadata.providerSyncLease.lease.state === "foreign-owner"
        ? "required"
        : "recommended",
    label: readiness.canWriteProviderSync
      ? "Provider sync lease is writable for hosted-kernel handoff"
      : "Acquire or refresh the provider sync lease before external handoff",
    reasonCode: syncMetadata.providerSyncLease.reasonCodes[0] || `sync.${syncMetadata.providerSyncLease.handoffState}`,
    leaseId: syncMetadata.providerSyncLease.lease.leaseId,
    leaseState: syncMetadata.providerSyncLease.lease.state,
    handoffState: syncMetadata.providerSyncLease.handoffState,
    providerWatermarkState: syncMetadata.providerSyncLease.providerWatermark.state,
    cursor: syncMetadata.cursor
  });

  operationalSteps.push({
    actionId: "contract.rate-limit.provider-operations",
    priority: providerOperationContract.blockingIssues.length
      ? "required"
      : providerOperationContract.warningIssues.length
        ? "recommended"
        : "ready",
    label: providerOperationContract.state === "ready"
      ? "Provider operation contracts are ready for hosted-kernel rate-limit integration"
      : "Resolve provider operation capability, endpoint, TTL, idempotency, or sync-lease issues",
    reasonCode: providerOperationContract.blockingIssues[0]
      || providerOperationContract.warningIssues[0]
      || `provider-operations.${providerOperationContract.state}`,
    operationState: providerOperationContract.state,
    reserveState: providerOperationContract.reserveState,
    externalHandoffState: providerOperationContract.externalHandoffState,
    proofId: providerOperationContract.proof.proofId
  });

  if (providerServiceBridge.providerSafety.remoteQuota.acceptance.stale) {
    operationalSteps.push({
      actionId: "refresh.rate-limit.external-provider-acceptance",
      priority: "required",
      label: "Refresh the external provider quota acceptance before dispatch",
      reasonCode: "remote-quota.acceptance-stale",
      providerProfile: providerServiceBridge.providerSafety.providerProfile,
      operationKind: providerServiceBridge.providerSafety.operationKind,
      acceptedAt: providerServiceBridge.providerSafety.remoteQuota.acceptance.acceptedAt,
      ageMs: providerServiceBridge.providerSafety.remoteQuota.acceptance.ageMs,
      maxAgeMs: providerServiceBridge.providerSafety.remoteQuota.acceptance.maxAgeMs,
      expectedAcceptanceKey: providerServiceBridge.providerSafety.remoteQuota.acceptance.expectedAcceptanceKey,
      retryAfterMs: providerServiceBridge.providerSafety.remoteQuota.nextAction.retryAfterMs
    });
  }

  if (reservationExecutionPlan.required) {
    operationalSteps.push({
      actionId: reservationExecutionPlan.nextAction.actionId,
      priority: reservationExecutionPlan.state === "ready-to-commit" || reservationExecutionPlan.state === "already-committed"
        ? "ready"
        : ["blocked-by-provider-operation", "blocked-by-command-recovery", "missing-reserve-command"].includes(reservationExecutionPlan.state)
          ? "required"
          : "recommended",
      label: reservationExecutionPlan.state === "already-committed"
        ? "Reservation is already durable for this request"
        : "Commit or replay the rate-limit reservation before capability dispatch",
      reasonCode: reservationExecutionPlan.reasonCodes[0] || `reservation.${reservationExecutionPlan.state}`,
      requestId: reservationExecutionPlan.requestId,
      units: reservationExecutionPlan.units,
      providerReady: reservationExecutionPlan.provider.ready,
      reservationState: reservationExecutionPlan.state,
      commandId: reservationExecutionPlan.command?.commandId || null,
      idempotencyKey: reservationExecutionPlan.command?.idempotencyKey || null,
      retryAfterMs: reservationExecutionPlan.nextAction.retryAfterMs
    });
  }

  if (externalHandoff.enabled) {
    operationalSteps.push({
      actionId: "handoff.rate-limit.external",
      priority: readiness.canExternalHandoff ? "ready" : "blocked",
      label: "Forward rate-limit policy to the external provider endpoint",
      handoffKey: externalHandoff.handoffKey,
      deliveryId: providerServiceBridge.delivery.deliveryId,
      bridgeState: providerServiceBridge.state
    });
  }

  if (providerServiceBridge.acknowledgement.required) {
    operationalSteps.push({
      actionId: "ack.rate-limit.provider-service-bridge",
      priority: providerServiceBridge.acknowledgement.state === "acknowledged" ? "ready" : "recommended",
      label: "Record provider acknowledgement for the external rate-limit handoff cursor",
      reasonCode: `provider-bridge.${providerServiceBridge.acknowledgement.state}`,
      idempotencyKey: providerServiceBridge.acknowledgement.idempotencyKey,
      timeoutMs: providerServiceBridge.acknowledgement.timeoutMs
    });
  }

  if (providerHandoffReceipt.required) {
    operationalSteps.push({
      actionId: providerHandoffReceipt.nextAction.actionId,
      priority: providerHandoffReceipt.state === "accepted"
        ? "ready"
        : providerHandoffReceipt.state === "invalid"
          ? "required"
          : "recommended",
      label: providerHandoffReceipt.state === "accepted"
        ? "Persist provider handoff receipt before completing hosted-kernel dispatch"
        : "Wait for or repair the provider handoff receipt for this delivery cursor",
      reasonCode: providerHandoffReceipt.violationCodes[0] || `provider-receipt.${providerHandoffReceipt.state}`,
      receiptId: providerHandoffReceipt.receipt.receiptId,
      deliveryId: providerHandoffReceipt.receipt.expectedDeliveryId,
      cursor: providerHandoffReceipt.receipt.expectedCursor,
      durabilityState: providerHandoffReceipt.durability.state,
      idempotencyKey: providerHandoffReceipt.durability.idempotencyKey,
      retryAfterMs: providerHandoffReceipt.nextAction.retryAfterMs
    });
  }

  operationalSteps.push({
    actionId: lifecycleControls.nextAction.actionId,
    priority: lifecycleControls.blockingIssues.length
      ? "required"
      : lifecycleControls.state === "enabled"
        ? "ready"
        : "recommended",
    label: lifecycleControls.state === "enabled"
      ? "Lifecycle controls are ready for hosted-kernel rate-limit enforcement"
      : "Apply lifecycle settings or scheduling control before live enforcement",
    reasonCode: lifecycleControls.validationIssues[0] || `lifecycle.${lifecycleControls.state}`,
    retryAfterMs: lifecycleControls.nextAction.retryAfterMs,
    pendingCommandCount: lifecycleControls.commands.filter((command) => command.state === "pending").length
  });

  operationalSteps.push({
    actionId: workflowHandoffQueue.dispatch.nextActionId,
    priority: workflowHandoffQueue.dispatch.canDispatch
      ? "ready"
      : workflowHandoffQueue.state === "held-by-runtime" || workflowHandoffQueue.state === "awaiting-command-replay"
        ? "required"
        : "recommended",
    label: workflowHandoffQueue.dispatch.canDispatch
      ? "Client workflow can dispatch with hosted-kernel rate-limit proof"
      : "Hold the client workflow until rate-limit handoff requirements are satisfied",
    reasonCode: workflowHandoffQueue.proof.reasonCodes[0] || `workflow.${workflowHandoffQueue.state}`,
    handoffId: workflowHandoffQueue.handoffId,
    owner: workflowHandoffQueue.owner,
    checkpointState: workflowHandoffQueue.clientCheckpoint.state,
    pendingCommandCount: workflowHandoffQueue.commandBacklog.pendingCount,
    providerAckState: workflowHandoffQueue.dispatch.providerAckState,
    retryAfterMs: workflowHandoffQueue.dispatch.retryAfterMs
  });

  if (workflowHandoffQueue.capabilityHandoff.required) {
    operationalSteps.push({
      actionId: workflowHandoffQueue.capabilityHandoff.nextActionId,
      priority: workflowHandoffQueue.capabilityHandoff.blocking
        ? workflowHandoffQueue.capabilityHandoff.owner === "provider" ? "recommended" : "required"
        : "ready",
      label: workflowHandoffQueue.capabilityHandoff.blocking
        ? "Complete the capability handoff workflow before external-system dispatch"
        : "Capability handoff workflow is ready for external-system dispatch",
      reasonCode: workflowHandoffQueue.capabilityHandoff.reasonCodes[0] || `capability-handoff.${workflowHandoffQueue.capabilityHandoff.state}`,
      handoffId: workflowHandoffQueue.handoffId,
      owner: workflowHandoffQueue.capabilityHandoff.owner,
      checkpointPolicy: workflowHandoffQueue.capabilityHandoff.checkpointPolicy,
      retryAfterMs: workflowHandoffQueue.capabilityHandoff.retryAfterMs
    });
  }

  if (commandRecoveryIndex.state !== "deduped") {
    operationalSteps.push({
      actionId: commandRecoveryIndex.replayRequiredCount
        ? "replay.rate-limit.command-journal"
        : commandRecoveryIndex.invalidCommandCount
          ? "repair.rate-limit.command-journal"
          : "persist.rate-limit.command-journal",
      priority: commandRecoveryIndex.invalidCommandCount
        ? "required"
        : commandRecoveryIndex.replayRequiredCount
          ? "recommended"
          : "ready",
      label: commandRecoveryIndex.replayRequiredCount
        ? "Replay persisted rate-limit commands before appending new commands"
        : "Persist the next rate-limit command journal append with idempotency proof",
      reasonCode: `command-recovery.${commandRecoveryIndex.state}`,
      replayRequiredCount: commandRecoveryIndex.replayRequiredCount,
      appendRequiredCount: commandRecoveryIndex.appendRequiredCount,
      durableAppliedCount: commandRecoveryIndex.durableAppliedCount,
      duplicateKeyCount: commandRecoveryIndex.duplicateKeys.length,
      proofId: commandRecoveryIndex.restartProof.proofId
    });
  }

  recoveryPlan.actions.forEach((action) => {
    operationalSteps.push({
      actionId: action.actionId,
      priority: action.priority,
      label: "Replay or reconcile persisted rate-limit state before dispatch",
      reasonCode: action.reasonCode,
      idempotencyKey: action.idempotencyKey
    });
  });

  operationalSteps.push({
    actionId: runtimeDecision.workflowHandoff.nextActionId,
    priority: runtimeDecision.allowed && readiness.state !== "recovering" ? "ready" : "blocked",
    label: runtimeDecision.allowed
      ? "Continue capability request with the negotiated rate-limit decision"
      : runtimeDecision.decision === "deny-boundary"
        ? "Deny capability request at the tenant or workspace boundary"
        : runtimeDecision.decision === "throttle-burst"
          ? "Pause capability request until burst capacity or reservation admission is available"
        : "Pause capability request until quota is available",
    requestId: runtimeDecision.request.requestId,
    retryAfterMs: runtimeDecision.retryAfterMs,
    commandCount: idempotentCommands.commands.length
  });

  return {
    schema: "rate-limit.next-steps.v1",
    hasBlockingWork: readiness.state === "blocked",
    actions: [...remediationSteps, ...operationalSteps]
  };
}

function buildClientReviewContract(now, preview, acceptance, readiness, validationSummary, nextSteps, actionableErrors, runtimeDecision, providerServiceBridge, providerHandoffReceipt, providerOperationContract, workflowHandoffQueue, reservationExecutionPlan, operationalRecovery) {
  const blockingChecks = validationSummary.checks.filter((check) => check.status === "fail");
  const warningChecks = validationSummary.checks.filter((check) => check.status === "warn");
  const readyActions = nextSteps.actions.filter((action) => action.priority === "ready");
  const requiredActions = nextSteps.actions.filter((action) => action.priority === "required" || action.priority === "blocked");
  const recommendedActions = nextSteps.actions.filter((action) => action.priority === "recommended");
  const routeCanProceed = acceptance.accepted
    && readiness.canEnforce
    && runtimeDecision.allowed
    && readiness.state !== "recovering";
  const primaryBlocker = blockingChecks[0]
    || actionableErrors.errors.find((error) => error.severity === "blocking")
    || null;
  const acceptanceState = routeCanProceed
    ? "accepted"
    : acceptance.accepted && runtimeDecision.allowed
      ? "accepted-with-hold"
      : blockingChecks.length
        ? "requires-fix"
        : "preview-only";

  return {
    schema: "rate-limit.client-review-contract.v1",
    generatedAt: now,
    routePayloadKind: "hosted-kernel-rate-limit-review",
    surfaceId,
    subjectKey: preview.subject.subjectKey,
    gate: {
      state: acceptanceState,
      decision: acceptance.decision,
      routeCanProceed,
      dispatchState: runtimeDecision.workflowHandoff.state,
      nextActionId: runtimeDecision.workflowHandoff.nextActionId,
      retryAfterMs: runtimeDecision.retryAfterMs || readiness.refreshAfterMs,
      blockerCode: primaryBlocker ? primaryBlocker.code : null,
      acceptedCapabilities: acceptance.acceptedCapabilities,
      workflowQueueState: workflowHandoffQueue.state,
      workflowCanDispatch: workflowHandoffQueue.dispatch.canDispatch,
      reservationState: reservationExecutionPlan.state
    },
    previewCards: [
      {
        cardId: "policy",
        title: "Policy",
        state: readiness.canEnforce ? "ready" : "blocked",
        value: preview.summary,
        detail: {
          windowSeconds: preview.policyPreview.windowSeconds,
          maxRequests: preview.policyPreview.maxRequests,
          burstRequests: preview.policyPreview.burstRequests,
          reservationMode: preview.policyPreview.reservationMode
        }
      },
      {
        cardId: "provider",
        title: "Provider",
        state: preview.providerPreview.readinessState,
        value: preview.providerPreview.providerId,
        detail: {
          health: preview.providerPreview.health,
          degradedMode: preview.providerPreview.degradedMode,
          syncLeaseState: preview.providerPreview.syncLeaseState,
          bridgeState: providerServiceBridge.state,
          operationContractState: providerOperationContract.state,
          reserveOperationState: providerOperationContract.reserveState,
          handoffOperationState: providerOperationContract.externalHandoffState
        }
      },
      {
        cardId: "provider-operations",
        title: "Operations",
        state: providerOperationContract.state,
        value: `${providerOperationContract.proof.readyOperationCount}/${providerOperationContract.operations.length} ready`,
        detail: {
          reserveState: providerOperationContract.reserveState,
          externalHandoffState: providerOperationContract.externalHandoffState,
          blockingIssues: providerOperationContract.blockingIssues,
          warningIssues: providerOperationContract.warningIssues
        }
      },
      {
        cardId: "provider-safety",
        title: "Provider safety",
        state: providerServiceBridge.providerSafety.state,
        value: providerServiceBridge.providerSafety.dispatch.nextActionId,
        detail: {
          providerProfile: providerServiceBridge.providerSafety.providerProfile,
          operationKind: providerServiceBridge.providerSafety.operationKind,
          risk: providerServiceBridge.providerSafety.risk,
          safeToDispatch: providerServiceBridge.providerSafety.safeToDispatch,
          acceptanceRequired: providerServiceBridge.providerSafety.acceptance.required,
          acceptanceAccepted: providerServiceBridge.providerSafety.acceptance.accepted,
          checkpointRequired: providerServiceBridge.providerSafety.checkpoint.required,
          checkpointReady: providerServiceBridge.providerSafety.checkpoint.ready,
          replayFenceKey: providerServiceBridge.providerSafety.replayFence.key,
          reasonCodes: providerServiceBridge.providerSafety.dispatch.reasonCodes
        }
      },
      {
        cardId: "provider-receipt",
        title: "Receipt",
        state: providerHandoffReceipt.state,
        value: providerHandoffReceipt.receipt.receiptId || providerHandoffReceipt.nextAction.actionId,
        detail: {
          required: providerHandoffReceipt.required,
          deliveryId: providerHandoffReceipt.receipt.expectedDeliveryId,
          cursor: providerHandoffReceipt.receipt.expectedCursor,
          durabilityState: providerHandoffReceipt.durability.state,
          violationCodes: providerHandoffReceipt.violationCodes
        }
      },
      {
        cardId: "reservation",
        title: "Reservation",
        state: reservationExecutionPlan.state,
        value: reservationExecutionPlan.required
          ? reservationExecutionPlan.nextAction.actionId
          : "not-required",
        detail: {
          required: reservationExecutionPlan.required,
          units: reservationExecutionPlan.units,
          providerReady: reservationExecutionPlan.provider.ready,
          canCommit: reservationExecutionPlan.execution.canCommit,
          commandId: reservationExecutionPlan.command?.commandId || null,
          idempotencyKey: reservationExecutionPlan.command?.idempotencyKey || null,
          reasonCodes: reservationExecutionPlan.reasonCodes
        }
      },
      {
        cardId: "request",
        title: "Request",
        state: runtimeDecision.allowed ? "allowed" : "held",
        value: runtimeDecision.decision,
        detail: {
          requestId: preview.requestPreview.requestId,
          routeId: preview.requestPreview.routeId,
          capabilityRateClass: preview.requestPreview.capabilityRateClass,
          requestedCost: preview.requestPreview.requestedCost,
          baseCost: preview.requestPreview.baseCost,
          classWeight: preview.requestPreview.classWeight,
          admissionPath: preview.requestPreview.admissionPath,
          admissionAction: preview.requestPreview.admissionAction,
          capabilityAdmissionPacket: preview.requestPreview.capabilityAdmissionPacket,
          classWindowLimit: preview.requestPreview.classWindowLimit,
          capabilityLaneState: preview.requestPreview.capabilityLaneState,
          capabilityLaneRemainingAfterRequest: preview.requestPreview.capabilityLaneRemainingAfterRequest,
          capabilityLaneDeficit: preview.requestPreview.capabilityLaneDeficit,
          emergencyAdmission: preview.requestPreview.emergencyAdmission,
          classRemainingAfterRequest: preview.requestPreview.classRemainingAfterRequest,
          classBudgetRemaining: preview.requestPreview.classBudgetRemaining,
          classPressureRatio: preview.requestPreview.classPressureRatio,
          remainingAfterRequest: preview.requestPreview.remainingAfterRequest,
          admissionGuardState: preview.requestPreview.admissionGuardState,
          externalHandoffState: preview.requestPreview.externalHandoffState,
          externalHandoffReady: preview.requestPreview.externalHandoffReady,
          externalHandoffContract: preview.requestPreview.externalHandoffContract,
          externalHandoffWorkflow: preview.requestPreview.externalHandoffWorkflow,
          pressureThreshold: preview.requestPreview.pressureThreshold
        }
      },
      {
        cardId: "workflow-handoff",
        title: "Workflow",
        state: workflowHandoffQueue.dispatch.canDispatch ? "ready" : workflowHandoffQueue.state,
        value: workflowHandoffQueue.dispatch.nextActionId,
        detail: {
          handoffId: workflowHandoffQueue.handoffId,
          owner: workflowHandoffQueue.owner,
          checkpointState: workflowHandoffQueue.clientCheckpoint.state,
          pendingCommandCount: workflowHandoffQueue.commandBacklog.pendingCount,
          providerAckState: workflowHandoffQueue.dispatch.providerAckState,
          capabilityHandoffState: workflowHandoffQueue.capabilityHandoff.state,
          capabilityHandoffOwner: workflowHandoffQueue.capabilityHandoff.owner,
          capabilityHandoffActionId: workflowHandoffQueue.capabilityHandoff.nextActionId
        }
      },
      {
        cardId: "validation",
        title: "Validation",
        state: validationSummary.status,
        value: `${validationSummary.blockingFailureCount} blocking, ${validationSummary.warningCount} warnings`,
        detail: {
          blockingCodes: blockingChecks.map((check) => check.code),
          warningCodes: warningChecks.map((check) => check.code)
        }
      }
    ],
    validationRollup: {
      status: validationSummary.status,
      blockingFailureCount: validationSummary.blockingFailureCount,
      warningCount: validationSummary.warningCount,
      blocking: blockingChecks.map((check) => ({
        code: check.code,
        label: check.label,
        actionId: `resolve.${check.code}`
      })),
      warnings: warningChecks.map((check) => ({
        code: check.code,
        label: check.label,
        actionId: `resolve.${check.code}`
      }))
    },
    nextStepPlan: {
      state: requiredActions.length ? "action-required" : recommendedActions.length ? "review-recommended" : "ready",
      requiredCount: requiredActions.length,
      recommendedCount: recommendedActions.length,
      readyCount: readyActions.length,
      primaryAction: requiredActions[0] || recommendedActions[0] || readyActions[0] || null,
      actions: [...requiredActions, ...recommendedActions, ...readyActions].slice(0, 8)
    },
    workflowHandoff: {
      schema: workflowHandoffQueue.schema,
      handoffId: workflowHandoffQueue.handoffId,
      state: workflowHandoffQueue.state,
      nextActionId: workflowHandoffQueue.dispatch.nextActionId,
      canDispatch: workflowHandoffQueue.dispatch.canDispatch,
      checkpointState: workflowHandoffQueue.clientCheckpoint.state,
      pendingCommandCount: workflowHandoffQueue.commandBacklog.pendingCount,
      reservationState: reservationExecutionPlan.state,
      reservationRequired: reservationExecutionPlan.required,
      capabilityHandoff: workflowHandoffQueue.capabilityHandoff,
      reasonCodes: workflowHandoffQueue.proof.reasonCodes
    },
    providerSafety: {
      schema: providerServiceBridge.providerSafety.schema,
      state: providerServiceBridge.providerSafety.state,
      providerProfile: providerServiceBridge.providerSafety.providerProfile,
      operationKind: providerServiceBridge.providerSafety.operationKind,
      risk: providerServiceBridge.providerSafety.risk,
      safeToDispatch: providerServiceBridge.providerSafety.safeToDispatch,
      nextActionId: providerServiceBridge.providerSafety.dispatch.nextActionId,
      reasonCodes: providerServiceBridge.providerSafety.dispatch.reasonCodes,
      acceptance: providerServiceBridge.providerSafety.acceptance,
      remoteQuotaAcceptance: {
        required: providerServiceBridge.providerSafety.remoteQuota.acceptance.required,
        accepted: providerServiceBridge.providerSafety.remoteQuota.acceptance.accepted,
        stale: providerServiceBridge.providerSafety.remoteQuota.acceptance.stale,
        ageMs: providerServiceBridge.providerSafety.remoteQuota.acceptance.ageMs,
        maxAgeMs: providerServiceBridge.providerSafety.remoteQuota.acceptance.maxAgeMs,
        acceptedAt: providerServiceBridge.providerSafety.remoteQuota.acceptance.acceptedAt,
        expectedAcceptanceKey: providerServiceBridge.providerSafety.remoteQuota.acceptance.expectedAcceptanceKey
      },
      checkpoint: providerServiceBridge.providerSafety.checkpoint,
      replayFence: providerServiceBridge.providerSafety.replayFence
    },
    providerHandoffReceipt: {
      schema: providerHandoffReceipt.schema,
      state: providerHandoffReceipt.state,
      required: providerHandoffReceipt.required,
      receiptId: providerHandoffReceipt.receipt.receiptId,
      deliveryId: providerHandoffReceipt.receipt.expectedDeliveryId,
      cursor: providerHandoffReceipt.receipt.expectedCursor,
      durabilityState: providerHandoffReceipt.durability.state,
      nextActionId: providerHandoffReceipt.nextAction.actionId,
      violationCodes: providerHandoffReceipt.violationCodes
    },
    errorSummary: {
      hasErrors: actionableErrors.hasErrors,
      blockingCount: actionableErrors.errors.filter((error) => error.severity === "blocking").length,
      retryableCount: actionableErrors.errors.filter((error) => error.severity === "retryable").length,
      firstError: actionableErrors.errors[0] || null,
      recoveryState: operationalRecovery.state,
      retryAfterMs: operationalRecovery.retryPlan.retryAfterMs,
      nextAttemptAt: operationalRecovery.retryPlan.nextAttemptAt,
      nextActionId: operationalRecovery.dispatchGate.nextActionId,
      canUseDegradedLocalDispatch: operationalRecovery.degradedPolicy.allowLocalDispatch
    }
  };
}

function buildRouteClientResponseContract(now, serviceContract, acceptance, readiness, validationSummary, runtimeDecision, workflowHandoffQueue, reservationExecutionPlan, operationalRecovery, nextSteps) {
  const primaryAction = nextSteps.actions.find((action) => (
    action.priority === "required" || action.priority === "blocked"
  )) || nextSteps.actions.find((action) => action.priority === "recommended")
    || nextSteps.actions.find((action) => action.priority === "ready")
    || null;
  const heldByRetry = runtimeDecision.decision === "throttle"
    || runtimeDecision.decision === "throttle-burst"
    || runtimeDecision.decision === "lifecycle-paused"
    || workflowHandoffQueue.state === "awaiting-provider-ack"
    || workflowHandoffQueue.state === "awaiting-capability-handoff"
    || workflowHandoffQueue.state === "awaiting-reservation";
  const retryableValidationCodes = new Set([
    "runtime.request-cost",
    "runtime.capability-class-budget",
    "runtime.capability-lane",
    "runtime.operator-interrupt-emergency",
    "runtime.admission-guard",
    "workflow.handoff-queue",
    "provider.service-bridge",
    "provider.handoff-receipt"
  ]);
  const conflictFailureCount = validationSummary.checks.filter((check) => (
    check.status === "fail" && !retryableValidationCodes.has(check.code)
  )).length;
  const responseStatus = runtimeDecision.allowed && workflowHandoffQueue.dispatch.canDispatch
    ? 200
    : runtimeDecision.decision === "deny-boundary"
      ? 403
      : runtimeDecision.decision === "deny-capability-contract"
        || runtimeDecision.decision === "deny-lifecycle-invalid"
        ? 409
        : runtimeDecision.decision === "deny-provider-unhealthy"
          ? runtimeDecision.healthAdmissionPolicy.retryAfterMs > 0 ? 503 : 409
        : conflictFailureCount
          ? 409
        : heldByRetry
          ? 429
          : 202;
  const retryAfterMs = Math.max(
    runtimeDecision.retryAfterMs,
    workflowHandoffQueue.dispatch.retryAfterMs,
    operationalRecovery.retryPlan.retryAfterMs,
    readiness.refreshAfterMs && readiness.state !== "ready" ? readiness.refreshAfterMs : 0
  );
  const retryAfterSeconds = retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1_000) : 0;
  const cacheScope = runtimeDecision.allowed && responseStatus === 200
    ? "request"
    : responseStatus === 429
      ? "window"
      : "none";
  const routeState = responseStatus === 200
    ? "dispatchable"
    : responseStatus === 202
      ? "accepted-pending"
      : responseStatus === 429 || responseStatus === 503
        ? "retry-after"
        : "blocked";

  return {
    schema: "rate-limit.route-client-response-contract.v1",
    generatedAt: now,
    state: routeState,
    requestId: runtimeDecision.request.requestId,
    routeId: runtimeDecision.request.routeId,
    subjectKey: runtimeDecision.subjectKey,
    http: {
      status: responseStatus,
      retryAfterSeconds,
      cacheScope,
      headers: {
        "RateLimit-Policy": `${runtimeDecision.accounting.hardLimit};w=${Math.round(serviceContract.policy.windowMs / 1_000)}`,
        "RateLimit-Limit": String(runtimeDecision.accounting.hardLimit),
        "RateLimit-Remaining": String(runtimeDecision.accounting.remainingBeforeRequest),
        "RateLimit-Reset": runtimeDecision.clientQuota.resetAt || "",
        "Retry-After": retryAfterSeconds ? String(retryAfterSeconds) : "",
        "X-RateLimit-Capability-Class": runtimeDecision.request.capabilityRateClass,
        "X-RateLimit-Capability-Handoff": workflowHandoffQueue.capabilityHandoff.state,
        "X-RateLimit-Decision": runtimeDecision.decision,
        "X-RateLimit-Health-Gate": runtimeDecision.healthAdmissionPolicy.state,
        "X-RateLimit-Next-Action": workflowHandoffQueue.dispatch.nextActionId
      }
    },
    bodyContract: {
      schema: "rate-limit.route-response-body.v1",
      decision: runtimeDecision.decision,
      allowed: runtimeDecision.allowed,
      accepted: acceptance.accepted,
      readinessState: readiness.state,
      validationStatus: validationSummary.status,
      workflowState: workflowHandoffQueue.state,
      workflowCanDispatch: workflowHandoffQueue.dispatch.canDispatch,
      capabilityHandoffState: workflowHandoffQueue.capabilityHandoff.state,
      capabilityHandoffNextActionId: workflowHandoffQueue.capabilityHandoff.nextActionId,
      capabilityHandoffOwner: workflowHandoffQueue.capabilityHandoff.owner,
      reservationRequired: reservationExecutionPlan.required,
      reservationState: reservationExecutionPlan.state,
      nextActionId: primaryAction?.actionId || workflowHandoffQueue.dispatch.nextActionId,
      primaryReasonCode: primaryAction?.reasonCode || workflowHandoffQueue.proof.reasonCodes[0] || runtimeDecision.decision,
      retryAfterMs,
      explain: {
        admissionPath: runtimeDecision.accounting.capabilityAdmissionPacket.path,
        admissionAction: runtimeDecision.accounting.capabilityAdmissionPacket.action,
        admissionGuardState: runtimeDecision.admissionGuard.state,
        healthAdmissionState: runtimeDecision.healthAdmissionPolicy.state,
        healthDispatchMode: runtimeDecision.healthAdmissionPolicy.dispatchMode,
        capabilityRateClass: runtimeDecision.request.capabilityRateClass,
        requestedCost: runtimeDecision.accounting.requestedCost,
        remainingAfterRequest: runtimeDecision.accounting.remainingAfterRequest,
        classRemainingAfterRequest: runtimeDecision.accounting.classRemainingAfterRequest,
        capabilityLaneState: runtimeDecision.accounting.capabilityLaneState,
        capabilityLaneDeficit: runtimeDecision.accounting.capabilityLaneDeficit,
        emergencyAdmissionState: runtimeDecision.accounting.emergencyAdmission.state,
        externalHandoffState: runtimeDecision.admissionGuard.externalHandoffState,
        externalHandoffWorkflowState: runtimeDecision.admissionGuard.externalHandoffWorkflow.state,
        externalHandoffWorkflowActionId: runtimeDecision.admissionGuard.externalHandoffWorkflow.nextActionId
      }
    },
    clientEvents: [
      {
        event: "rate-limit.preview",
        when: "before-dispatch",
        payloadPath: "preview"
      },
      {
        event: responseStatus === 200 ? "rate-limit.accepted" : "rate-limit.held",
        when: responseStatus === 200 ? "dispatch" : "before-dispatch",
        payloadPath: "routeClientResponse.bodyContract"
      },
      retryAfterMs > 0
        ? {
            event: "rate-limit.retry-scheduled",
            when: "retry-after",
            retryAfterMs,
            nextAttemptAt: operationalRecovery.retryPlan.nextAttemptAt,
            payloadPath: "operationalRecovery.retryPlan"
          }
        : null
    ].filter(Boolean),
    routeGuards: {
      requireAuditProof: true,
      requireReservationCommit: reservationExecutionPlan.required && reservationExecutionPlan.state !== "already-committed",
      requireProviderAck: workflowHandoffQueue.dispatch.providerAckState === "pending",
      requireDurableCheckpoint: workflowHandoffQueue.clientCheckpoint.state === "stale",
      blockDispatch: responseStatus !== 200
    }
  };
}

function normalizeAnalyticsHistory(input = {}, now, serviceContract, runtimeDecision, accessBoundary, operationalHealth) {
  const analytics = asObject(input.analytics || input.reporting || input.rateLimitAnalytics);
  const history = asObject(input.history || analytics.history);
  const rawEvents = Array.isArray(history.events)
    ? history.events
    : Array.isArray(analytics.events)
      ? analytics.events
      : Array.isArray(input.rateLimitHistory)
        ? input.rateLimitHistory
        : [];
  const supportedTypes = new Set([
    "decision",
    "allow-local",
    "reserve",
    "throttle",
    "throttle-burst",
    "deny-boundary",
    "deny-lifecycle-invalid",
    "deny-capability-contract",
    "deny-provider-unhealthy",
    "lifecycle-paused",
    "bypass-disabled",
    "release",
    "snapshot",
    "provider-failure",
    "recovery"
  ]);
  const historicalEvents = rawEvents
    .filter((event) => event && typeof event === "object")
    .slice(-49)
    .map((event, index) => {
      const decision = asIdentifier(event.decision || event.type, "decision");
      const eventType = supportedTypes.has(decision) ? decision : "decision";
      const units = asPositiveInteger(event.units || event.cost || event.requestedCost, 1);
      const allowed = asBoolean(
        event.allowed,
        eventType === "reserve" || eventType === "allow-local" || eventType === "release"
      );

      return {
        schema: "rate-limit.analytics-event.v1",
        eventId: asIdentifier(event.eventId || event.id, `${serviceContract.subjectKey}:history:${index + 1}`),
        observedAt: asIdentifier(event.observedAt || event.at || event.timestamp, now),
        subjectKey: asIdentifier(event.subjectKey, serviceContract.subjectKey),
        requestId: asIdentifier(event.requestId, null),
        clientId: asIdentifier(event.clientId, runtimeDecision.request.clientId),
        routeId: asIdentifier(event.routeId, runtimeDecision.request.routeId),
        capabilityRateClass: normalizeCapabilityRateClassToken(event.capabilityRateClass)
          || runtimeDecision.request.capabilityRateClass,
        type: eventType,
        decision,
        units,
        allowed,
        boundaryState: asIdentifier(event.boundaryState, accessBoundary.state),
        providerHealth: asIdentifier(event.providerHealth, operationalHealth.state),
        admissionGuardState: asIdentifier(event.admissionGuardState, runtimeDecision.admissionGuard.state),
        emergencyAdmissionState: asIdentifier(
          event.emergencyAdmissionState || event.emergencyState,
          runtimeDecision.admissionGuard.emergencyAdmission.state
        ),
        emergencyUnitsGranted: asNonNegativeInteger(event.emergencyUnitsGranted, 0),
        admissionPath: asIdentifier(event.admissionPath, runtimeDecision.accounting.capabilityAdmissionPacket.path),
        admissionAction: asIdentifier(event.admissionAction, runtimeDecision.accounting.capabilityAdmissionPacket.action)
      };
    });
  const currentEvent = {
    schema: "rate-limit.analytics-event.v1",
    eventId: `${serviceContract.subjectKey}:current:${runtimeDecision.request.requestId}`,
    observedAt: now,
    subjectKey: serviceContract.subjectKey,
    requestId: runtimeDecision.request.requestId,
    clientId: runtimeDecision.request.clientId,
    routeId: runtimeDecision.request.routeId,
    capabilityRateClass: runtimeDecision.request.capabilityRateClass,
    type: runtimeDecision.decision,
    decision: runtimeDecision.decision,
    units: runtimeDecision.accounting.requestedCost,
    allowed: runtimeDecision.allowed,
    boundaryState: accessBoundary.state,
    providerHealth: operationalHealth.state,
    admissionGuardState: runtimeDecision.admissionGuard.state,
    emergencyAdmissionState: runtimeDecision.admissionGuard.emergencyAdmission.state,
    emergencyUnitsGranted: runtimeDecision.admissionGuard.emergencyUnitsGranted,
    admissionPath: runtimeDecision.accounting.capabilityAdmissionPacket.path,
    admissionAction: runtimeDecision.accounting.capabilityAdmissionPacket.action
  };

  return [...historicalEvents, currentEvent];
}

function normalizeAnalyticsSnapshots(input = {}, serviceContract, providerContract, syncMetadata) {
  const analytics = asObject(input.analytics || input.reporting || input.rateLimitAnalytics);
  const history = asObject(input.history || analytics.history);
  const rawSnapshots = Array.isArray(history.snapshots)
    ? history.snapshots
    : Array.isArray(analytics.snapshots)
      ? analytics.snapshots
      : Array.isArray(input.rateLimitSnapshots)
        ? input.rateLimitSnapshots
      : [];

  return rawSnapshots
    .filter((snapshot) => snapshot && typeof snapshot === "object")
    .slice(-11)
    .map((snapshot, index) => {
      const maxRequests = asPositiveInteger(snapshot.maxRequests, serviceContract.policy.maxRequests);
      const windowUsed = readNonNegativeInteger(snapshot, ["windowUsed", "usedRequests"], 0);
      const reserved = readNonNegativeInteger(snapshot, ["reserved", "reservedRequests"], 0);
      const localPending = readNonNegativeInteger(snapshot, ["localPending", "pendingRequests"], 0);
      const accountedRequests = asNonNegativeInteger(
        snapshot.accountedRequests,
        windowUsed + reserved + localPending
      );
      const capabilityClassLedger = normalizeCapabilityClassLedger(
        snapshot.capabilityClassLedger || snapshot.classLedger || snapshot.classUsage
      );

      return {
        schema: "rate-limit.history-snapshot.v1",
        snapshotId: asIdentifier(snapshot.snapshotId || snapshot.id, `${serviceContract.subjectKey}:snapshot:${index + 1}`),
        capturedAt: asIdentifier(snapshot.capturedAt || snapshot.observedAt || snapshot.at, null),
        subjectKey: asIdentifier(snapshot.subjectKey, serviceContract.subjectKey),
        syncKey: asIdentifier(snapshot.syncKey, syncMetadata.syncKey),
        providerId: asIdentifier(snapshot.providerId, providerContract.providerId),
        windowMs: asPositiveInteger(snapshot.windowMs, serviceContract.policy.windowMs),
        maxRequests,
        windowUsed,
        reserved,
        localPending,
        accountedRequests,
        remainingRequests: Math.max(0, asNonNegativeInteger(snapshot.remainingRequests, maxRequests - accountedRequests)),
        remainingAfterCurrentRequest: asNonNegativeInteger(snapshot.remainingAfterCurrentRequest, 0),
        admissionGuardState: asIdentifier(snapshot.admissionGuardState, "unknown"),
        admissionGuardReasons: asIdentifierList(snapshot.admissionGuardReasons || snapshot.reasonCodes),
        burstBudgetRemaining: asNonNegativeInteger(snapshot.burstBudgetRemaining, 0),
        capabilityClassLedger,
        steadyBudgetRemaining: asNonNegativeInteger(snapshot.steadyBudgetRemaining, 0),
        pressureRatio: typeof snapshot.pressureRatio === "number"
          ? Number(Math.max(0, snapshot.pressureRatio).toFixed(4))
          : maxRequests > 0
            ? Number((accountedRequests / maxRequests).toFixed(4))
            : 1,
        resetAt: asIdentifier(snapshot.resetAt, null),
        restartState: asIdentifier(snapshot.restartState, "historical")
      };
    });
}

function incrementCounter(counter, key, amount = 1) {
  const normalizedKey = asIdentifier(key, "unknown");
  counter[normalizedKey] = (counter[normalizedKey] || 0) + amount;
  return counter;
}

function buildCapabilityClassAnalyticsReport(serviceContract, runtimeDecision, currentSnapshot, previousSnapshot) {
  const activeClass = runtimeDecision.request.capabilityRateClass;
  const previousLedger = normalizeCapabilityClassLedger(previousSnapshot?.capabilityClassLedger);
  const currentLedger = normalizeCapabilityClassLedger(currentSnapshot.capabilityClassLedger);
  const shouldProjectLocalAccount = runtimeDecision.allowed
    && !runtimeDecision.reservationRequired
    && runtimeDecision.decision !== "bypass-disabled";
  const shouldProjectReservation = runtimeDecision.reservationRequired;
  const activeClassDelta = shouldProjectLocalAccount || shouldProjectReservation
    ? runtimeDecision.accounting.requestedCost
    : 0;
  const projectedCurrentLedger = Object.fromEntries(Object.entries(currentLedger).map(([capabilityRateClass, entry]) => {
    if (capabilityRateClass !== activeClass || activeClassDelta === 0) {
      return [capabilityRateClass, entry];
    }

    return [
      capabilityRateClass,
      {
        windowUsed: entry.windowUsed + (shouldProjectLocalAccount ? activeClassDelta : 0),
        reserved: entry.reserved + (shouldProjectReservation ? activeClassDelta : 0),
        localPending: entry.localPending,
        accountedRequests: entry.accountedRequests + activeClassDelta
      }
    ];
  }));
  const classRows = SUPPORTED_CAPABILITY_RATE_CLASSES.map((capabilityRateClass) => {
    const policy = capabilityRatePolicy(capabilityRateClass);
    const current = projectedCurrentLedger[capabilityRateClass] || normalizeCapabilityClassLedgerEntry(null);
    const previous = previousLedger[capabilityRateClass] || normalizeCapabilityClassLedgerEntry(null);
    const classWindowLimit = capabilityClassWindowLimit(
      serviceContract,
      capabilityRateClass,
      runtimeDecision.accounting.hardLimit
    );
    const accountedDelta = current.accountedRequests - previous.accountedRequests;
    const reservedDelta = current.reserved - previous.reserved;
    const pendingDelta = current.localPending - previous.localPending;
    const utilizationRatio = classWindowLimit > 0
      ? Number((current.accountedRequests / classWindowLimit).toFixed(4))
      : 1;
    const remainingUnits = Math.max(0, classWindowLimit - current.accountedRequests);
    const overflowUnits = Math.max(0, current.accountedRequests - classWindowLimit);
    const pressureState = overflowUnits
      ? "over-limit"
      : utilizationRatio >= policy.pressureThreshold
        ? "pressure"
        : accountedDelta > 0
          ? "rising"
          : "stable";

    return {
      schema: "rate-limit.capability-class-analytics-row.v1",
      capabilityRateClass,
      active: capabilityRateClass === activeClass,
      policy: {
        classWeight: policy.classWeight,
        burstShare: policy.burstShare,
        pressureThreshold: policy.pressureThreshold,
        reservationStrategy: policy.reservationStrategy,
        handoffRequired: policy.handoffRequired
      },
      current: {
        windowUsed: current.windowUsed,
        reserved: current.reserved,
        localPending: current.localPending,
        accountedRequests: current.accountedRequests
      },
      previous: previousSnapshot
        ? {
            windowUsed: previous.windowUsed,
            reserved: previous.reserved,
            localPending: previous.localPending,
            accountedRequests: previous.accountedRequests
          }
        : null,
      delta: {
        windowUsed: current.windowUsed - previous.windowUsed,
        reserved: reservedDelta,
        localPending: pendingDelta,
        accountedRequests: accountedDelta
      },
      classWindowLimit,
      remainingUnits,
      overflowUnits,
      utilizationRatio,
      pressureState,
      exportReady: true
    };
  });
  const pressureClassRows = classRows.filter((row) => row.pressureState === "pressure" || row.pressureState === "over-limit");
  const topPressureClass = classRows.slice().sort((left, right) => (
    right.utilizationRatio - left.utilizationRatio
    || right.current.accountedRequests - left.current.accountedRequests
  ))[0] || null;

  return {
    schema: "rate-limit.capability-class-analytics-report.v1",
    state: pressureClassRows.some((row) => row.pressureState === "over-limit")
      ? "over-limit"
      : pressureClassRows.length
        ? "pressure"
        : classRows.some((row) => row.delta.accountedRequests > 0)
          ? "activity-observed"
          : "stable",
    activeClass,
    projection: {
      mode: shouldProjectReservation
        ? "reserve-before-dispatch"
        : shouldProjectLocalAccount
          ? "account-local-dispatch"
          : "observe-only",
      projectedRequestUnits: activeClassDelta,
      sourceSnapshotId: currentSnapshot.snapshotId
    },
    currentSnapshotId: currentSnapshot.snapshotId,
    previousSnapshotId: previousSnapshot?.snapshotId || null,
    classRows,
    counters: {
      classCount: classRows.length,
      pressuredClassCount: pressureClassRows.length,
      overLimitClassCount: classRows.filter((row) => row.pressureState === "over-limit").length,
      activeClassAccountedRequests: classRows.find((row) => row.active)?.current.accountedRequests || 0,
      activeClassRemainingUnits: classRows.find((row) => row.active)?.remainingUnits || 0,
      totalClassAccountedRequests: classRows.reduce((total, row) => total + row.current.accountedRequests, 0),
      totalClassReserved: classRows.reduce((total, row) => total + row.current.reserved, 0),
      totalClassPending: classRows.reduce((total, row) => total + row.current.localPending, 0)
    },
    topPressureClass: topPressureClass
      ? {
          capabilityRateClass: topPressureClass.capabilityRateClass,
          utilizationRatio: topPressureClass.utilizationRatio,
          pressureState: topPressureClass.pressureState,
          remainingUnits: topPressureClass.remainingUnits,
          overflowUnits: topPressureClass.overflowUnits
        }
      : null,
    exportRows: classRows.map((row) => ({
      snapshotId: currentSnapshot.snapshotId,
      subjectKey: serviceContract.subjectKey,
      capabilityRateClass: row.capabilityRateClass,
      active: row.active,
      classWindowLimit: row.classWindowLimit,
      accountedRequests: row.current.accountedRequests,
      reserved: row.current.reserved,
      localPending: row.current.localPending,
      remainingUnits: row.remainingUnits,
      overflowUnits: row.overflowUnits,
      utilizationRatio: row.utilizationRatio,
      pressureState: row.pressureState,
      accountedRequestsDelta: row.delta.accountedRequests,
      reservationStrategy: row.policy.reservationStrategy,
      handoffRequired: row.policy.handoffRequired
    }))
  };
}

function buildMailchimpProviderAnalyticsReport({
  now,
  serviceContract,
  providerContract,
  syncMetadata,
  runtimeDecision,
  persistedState,
  recoveryPlan,
  workflowHandoffQueue,
  readiness,
  validationSummary,
  exportRows,
  events
}) {
  const profile = serviceContract.externalProviderProfile || {};
  const matched = profile.providerProfile === "mailchimp";
  const workflow = runtimeDecision.accounting.externalHandoffWorkflow || {};
  const contract = runtimeDecision.accounting.externalHandoffContract || {};
  const remote = contract.workflow?.remoteIdempotency || workflow.remoteIdempotency || {};
  const operationKind = inferExternalProviderOperationKind(profile, runtimeDecision.request, serviceContract);
  const commandJournal = persistedState.commandJournal.filter((entry) => (
    asIdentifier(entry.type, "").includes("external-handoff") ||
    asIdentifier(entry.idempotencyKey, "").includes("mailchimp")
  ));
  const recoveryActions = recoveryPlan.actions.filter((action) => (
    asIdentifier(action.idempotencyKey, "").includes("mailchimp") ||
    asIdentifier(action.reasonCode, "").startsWith("persisted.")
  ));
  const mailchimpEvents = events.filter((event) => (
    matched ||
    event.routeId.toLowerCase().includes("mailchimp") ||
    event.workflowId?.toLowerCase?.().includes("mailchimp")
  ));
  const blockingCodes = [
    matched && validationSummary.blockingFailureCount ? "mailchimp.validation-blocked" : null,
    matched && readiness.state === "blocked" ? "mailchimp.readiness-blocked" : null,
    matched && contract.required && !contract.ready ? "mailchimp.external-handoff-not-ready" : null,
    matched && workflowHandoffQueue.commandBacklog.requiresCommandReplay ? "mailchimp.command-replay-required" : null,
    matched && recoveryPlan.actions.some((action) => action.priority === "required") ? "mailchimp.recovery-required" : null,
    matched && !(remote.headerNames || []).length ? "mailchimp.remote-idempotency-header-missing" : null
  ].filter(Boolean);
  const exportReady = matched
    && blockingCodes.length === 0
    && readiness.state !== "blocked"
    && validationSummary.blockingFailureCount === 0;
  const status = !matched
    ? "not-mailchimp"
    : exportReady && runtimeDecision.allowed
      ? "dispatch-ready"
      : exportReady
        ? "export-ready"
        : "attention";
  const nextActionId = blockingCodes.length
    ? workflowHandoffQueue.dispatch.nextActionId || workflow.nextActionId || "repair.rate-limit.mailchimp-handoff"
    : runtimeDecision.allowed
      ? "dispatch.rate-limit.mailchimp-provider"
      : runtimeDecision.workflowHandoff.nextActionId;
  const rows = exportRows
    .filter((row) => matched || row.routeId.toLowerCase().includes("mailchimp"))
    .map((row) => ({
      ...row,
      mailchimpMatched: matched,
      mailchimpStatus: status,
      mailchimpOperationKind: operationKind,
      mailchimpProviderId: providerContract.providerId,
      mailchimpSyncKey: syncMetadata.syncKey,
      mailchimpCursor: syncMetadata.cursor,
      mailchimpRemoteIdempotencyKey: remote.key || "",
      mailchimpRemoteHeaderNames: (remote.headerNames || []).join("|"),
      mailchimpRestartSafeDeliveryKey: remote.restartSafeDeliveryKey || "",
      mailchimpWorkflowState: workflow.state || "not-required",
      mailchimpWorkflowBlocking: workflow.blocking === true,
      mailchimpNextActionId: nextActionId,
      mailchimpExportReady: exportReady,
      mailchimpBlockingCodes: blockingCodes.join("|")
    }));

  return {
    schema: "rate-limit.mailchimp-provider-analytics.v1",
    generatedAt: now,
    matched,
    status,
    exportReady,
    providerId: providerContract.providerId,
    subjectKey: serviceContract.subjectKey,
    operationKind,
    capabilityRateClass: runtimeDecision.request.capabilityRateClass,
    requiredCapabilities: profile.requiredCapabilities || [],
    missingCapabilities: serviceContract.policy.externalProviderMissingCapabilities || [],
    workflow: {
      state: workflow.state || "not-required",
      required: workflow.required === true,
      blocking: workflow.blocking === true,
      nextActionId,
      owner: workflow.owner || "",
      retryAfterMs: asNonNegativeInteger(workflow.retryAfterMs, 0),
      checkpointPolicy: workflow.checkpointPolicy || "",
      reasonCodes: workflow.reasonCodes || []
    },
    remoteIdempotency: {
      key: remote.key || "",
      headerNames: remote.headerNames || [],
      replayFenceKey: remote.replayFenceKey || "",
      replayWindowMs: asNonNegativeInteger(remote.replayWindowMs, 0),
      restartSafeDeliveryKey: remote.restartSafeDeliveryKey || ""
    },
    persistence: {
      stateKey: persistedState.stateKey,
      pendingCommandCount: commandJournal.filter((entry) => entry.state === "pending").length,
      failedCommandCount: commandJournal.filter((entry) => entry.state === "failed").length,
      appliedCommandCount: persistedState.appliedCommandKeys.filter((key) => key.includes("mailchimp")).length,
      recoveryActionCount: recoveryActions.length,
      restartSafe: recoveryActions.every((action) => action.priority !== "required")
    },
    counters: {
      eventCount: mailchimpEvents.length,
      allowedCount: mailchimpEvents.filter((event) => event.allowed).length,
      throttledCount: mailchimpEvents.filter((event) => event.type === "throttle" || event.type === "throttle-burst").length,
      heldWorkflowCount: workflowHandoffQueue.dispatch.canDispatch ? 0 : 1,
      exportRowCount: rows.length,
      blockingCodeCount: blockingCodes.length
    },
    blockingCodes,
    rows,
    summaryKey: matched
      ? `${syncMetadata.syncKey}:mailchimp:${runtimeDecision.request.requestId}:${operationKind}`
      : ""
  };
}

function buildAnalyticsExports(now, input, serviceContract, providerContract, syncMetadata, runtimeDecision, quotaState, persistedState, recoveryPlan, accessBoundary, operationalHealth, validationSummary, readiness, workflowHandoffQueue, idempotentCommands) {
  const events = normalizeAnalyticsHistory(input, now, serviceContract, runtimeDecision, accessBoundary, operationalHealth);
  const currentWindowSnapshot = {
    schema: "rate-limit.history-snapshot.v1",
    snapshotId: quotaState.snapshotId,
    capturedAt: now,
    subjectKey: serviceContract.subjectKey,
    syncKey: syncMetadata.syncKey,
    providerId: providerContract.providerId,
    windowMs: serviceContract.policy.windowMs,
    maxRequests: serviceContract.policy.maxRequests,
    windowUsed: quotaState.windowUsed,
    reserved: quotaState.reserved,
    localPending: quotaState.localPending,
    accountedRequests: quotaState.accountedRequests,
    remainingRequests: runtimeDecision.accounting.remainingBeforeRequest,
    remainingAfterCurrentRequest: runtimeDecision.accounting.remainingAfterRequest,
    admissionGuardState: runtimeDecision.admissionGuard.state,
    admissionGuardReasons: runtimeDecision.admissionGuard.reasonCodes,
    burstBudgetRemaining: runtimeDecision.accounting.burstBudgetRemaining,
    classWindowLimit: runtimeDecision.accounting.classWindowLimit,
    classAccountedRequests: runtimeDecision.accounting.classAccountedRequests,
    classRemainingAfterRequest: runtimeDecision.accounting.classRemainingAfterRequest,
    classBudgetRemaining: runtimeDecision.accounting.classBudgetRemaining,
    capabilityClassLedger: runtimeDecision.clientQuota.capabilityClassLedger,
    capabilityLaneState: runtimeDecision.accounting.capabilityLaneState,
    capabilityLaneRemainingAfterRequest: runtimeDecision.accounting.capabilityLaneRemainingAfterRequest,
    capabilityLaneDeficit: runtimeDecision.accounting.capabilityLaneDeficit,
    emergencyAdmission: runtimeDecision.accounting.emergencyAdmission,
    emergencyUnitsGranted: runtimeDecision.accounting.emergencyUnitsGranted,
    steadyBudgetRemaining: runtimeDecision.accounting.steadyBudgetRemaining,
    pressureRatio: runtimeDecision.accounting.pressureRatio,
    classPressureRatio: runtimeDecision.accounting.classPressureRatio,
    resetAt: quotaState.resetAt,
    restartState: persistedState.pendingReservationCount ? "pending-replay" : "clean"
  };
  const historicalSnapshots = normalizeAnalyticsSnapshots(input, serviceContract, providerContract, syncMetadata);
  const historySnapshots = [...historicalSnapshots, currentWindowSnapshot]
    .sort((left, right) => asIdentifier(left.capturedAt, "").localeCompare(asIdentifier(right.capturedAt, "")))
    .slice(-12);
  const previousSnapshot = historySnapshots.length > 1
    ? historySnapshots[historySnapshots.length - 2]
    : null;
  const capabilityClassReport = buildCapabilityClassAnalyticsReport(
    serviceContract,
    runtimeDecision,
    currentWindowSnapshot,
    previousSnapshot
  );
  const snapshotDelta = previousSnapshot
    ? {
        fromSnapshotId: previousSnapshot.snapshotId,
        toSnapshotId: currentWindowSnapshot.snapshotId,
        accountedRequestsDelta: currentWindowSnapshot.accountedRequests - previousSnapshot.accountedRequests,
        remainingRequestsDelta: currentWindowSnapshot.remainingRequests - previousSnapshot.remainingRequests,
        pressureRatioDelta: Number((currentWindowSnapshot.pressureRatio - previousSnapshot.pressureRatio).toFixed(4)),
        state: currentWindowSnapshot.pressureRatio > previousSnapshot.pressureRatio
          ? "pressure-rising"
          : currentWindowSnapshot.pressureRatio < previousSnapshot.pressureRatio
            ? "pressure-falling"
            : "pressure-flat"
      }
    : {
        fromSnapshotId: null,
        toSnapshotId: currentWindowSnapshot.snapshotId,
        accountedRequestsDelta: 0,
        remainingRequestsDelta: 0,
        pressureRatioDelta: 0,
        state: "baseline"
      };
  const counters = events.reduce((totals, event) => {
    totals.eventCount += 1;
    totals.unitsRequested += event.units;
    incrementCounter(totals.byDecision, event.decision);
    incrementCounter(totals.byRoute, event.routeId);
    incrementCounter(totals.unitsByRoute, event.routeId, event.units);
    incrementCounter(totals.byCapabilityRateClass, event.capabilityRateClass);
    incrementCounter(totals.unitsByCapabilityRateClass, event.capabilityRateClass, event.units);
    incrementCounter(totals.byAdmissionGuardState, event.admissionGuardState);

    if (event.allowed) {
      totals.allowedCount += 1;
      totals.unitsAllowed += event.units;
    }

    if (event.type === "reserve") {
      totals.reservationCount += 1;
    }

    if (event.type === "throttle") {
      totals.throttleCount += 1;
      totals.unitsThrottled += event.units;
    }

    if (event.type === "throttle-burst") {
      totals.burstThrottleCount += 1;
      totals.unitsThrottled += event.units;
    }

    if (event.type === "deny-boundary") {
      totals.boundaryDenialCount += 1;
    }

    if (event.admissionGuardState === "pressure" || event.admissionGuardState === "reservation-required") {
      totals.admissionPressureCount += 1;
    }

    if (event.emergencyAdmissionState === "granted") {
      totals.emergencyAdmissionCount += 1;
      totals.emergencyUnitsGranted += event.emergencyUnitsGranted;
    }

    if (!["healthy", "ready"].includes(event.providerHealth)) {
      totals.degradedObservationCount += 1;
    }

    return totals;
  }, {
    eventCount: 0,
    allowedCount: 0,
    throttleCount: 0,
    boundaryDenialCount: 0,
    reservationCount: 0,
    burstThrottleCount: 0,
    admissionPressureCount: 0,
    emergencyAdmissionCount: 0,
    degradedObservationCount: 0,
    recoveryActionCount: recoveryPlan.actions.length,
    workflowHandoffHeldCount: workflowHandoffQueue.dispatch.canDispatch ? 0 : 1,
    workflowPendingCommandCount: workflowHandoffQueue.commandBacklog.pendingCount,
    unitsRequested: 0,
    unitsAllowed: 0,
    unitsThrottled: 0,
    emergencyUnitsGranted: 0,
    byDecision: {},
    byRoute: {},
    unitsByRoute: {},
    byCapabilityRateClass: {},
    unitsByCapabilityRateClass: {},
    byAdmissionGuardState: {}
  });
  const timeline = events
    .map((event) => ({
      at: event.observedAt,
      eventId: event.eventId,
      type: event.type,
      requestId: event.requestId,
      clientId: event.clientId,
      routeId: event.routeId,
      capabilityRateClass: event.capabilityRateClass,
      decision: event.decision,
      units: event.units,
      allowed: event.allowed,
      boundaryState: event.boundaryState,
      providerHealth: event.providerHealth,
      admissionGuardState: event.admissionGuardState,
      emergencyAdmissionState: event.emergencyAdmissionState,
      emergencyUnitsGranted: event.emergencyUnitsGranted
    }))
    .sort((left, right) => left.at.localeCompare(right.at))
    .slice(-50);
  const exportRows = timeline.map((event) => ({
    observedAt: event.at,
    subjectKey: serviceContract.subjectKey,
    providerId: providerContract.providerId,
    routeId: event.routeId,
    capabilityRateClass: event.capabilityRateClass,
    clientId: event.clientId,
    requestId: event.requestId,
    decision: event.decision,
    units: event.units,
    allowed: event.allowed,
    admissionGuardState: event.admissionGuardState,
    boundaryState: event.boundaryState,
    providerHealth: event.providerHealth,
    readinessState: readiness.state,
    workflowHandoffState: workflowHandoffQueue.state,
    workflowNextActionId: workflowHandoffQueue.dispatch.nextActionId,
    capabilityLaneState: runtimeDecision.accounting.capabilityLaneState,
    capabilityLaneDeficit: runtimeDecision.accounting.capabilityLaneDeficit,
    emergencyAdmissionState: runtimeDecision.accounting.emergencyAdmission.state,
    emergencyUnitsGranted: runtimeDecision.accounting.emergencyUnitsGranted
  }));
  const mailchimpProviderReport = buildMailchimpProviderAnalyticsReport({
    now,
    serviceContract,
    providerContract,
    syncMetadata,
    runtimeDecision,
    persistedState,
    recoveryPlan,
    workflowHandoffQueue,
    readiness,
    validationSummary,
    exportRows,
    events
  });
  const enrichedExportRows = mailchimpProviderReport.rows.length
    ? mailchimpProviderReport.rows
    : exportRows;
  const reportTimeline = historySnapshots.map((snapshot) => ({
    at: snapshot.capturedAt,
    snapshotId: snapshot.snapshotId,
    accountedRequests: snapshot.accountedRequests,
    remainingRequests: snapshot.remainingRequests,
    pressureRatio: snapshot.pressureRatio,
    admissionGuardState: snapshot.admissionGuardState,
    restartState: snapshot.restartState
  }));
  const topRoutesByUnits = Object.entries(counters.unitsByRoute)
    .map(([routeId, units]) => ({ routeId, units, eventCount: counters.byRoute[routeId] || 0 }))
    .sort((left, right) => right.units - left.units)
    .slice(0, 5);
  const timelineState = timeline.some((event) => event.type === "deny-boundary")
    ? "boundary-denials-observed"
    : timeline.some((event) => event.type === "throttle" || event.type === "throttle-burst")
      ? "throttles-observed"
      : snapshotDelta.state === "pressure-rising" && currentWindowSnapshot.pressureRatio >= 0.8
        ? "pressure-rising"
        : "nominal";
  const commandStateCounters = idempotentCommands.commands.reduce((totals, command) => {
    incrementCounter(totals.byState, command.state);
    incrementCounter(totals.byType, command.type);
    if (command.state === "pending") totals.pending += 1;
    if (command.state === "held") totals.held += 1;
    if (command.state === "failed") totals.failed += 1;
    if (command.state === "already-applied") totals.alreadyApplied += 1;
    return totals;
  }, {
    pending: 0,
    held: 0,
    failed: 0,
    alreadyApplied: 0,
    byState: {},
    byType: {}
  });
  const recoveryCommandCounters = recoveryPlan.actions.reduce((totals, action) => {
    incrementCounter(totals.byPriority, action.priority);
    incrementCounter(totals.byReasonCode, action.reasonCode);
    if (action.priority === "required") totals.required += 1;
    if (action.priority === "recommended") totals.recommended += 1;
    return totals;
  }, {
    required: 0,
    recommended: 0,
    byPriority: {},
    byReasonCode: {}
  });
  const exportHealthCodes = [
    !exportRows.length ? "export.no-rows" : null,
    validationSummary.blockingFailureCount ? "export.validation-blocked" : null,
    readiness.state === "blocked" ? "export.readiness-blocked" : null,
    workflowHandoffQueue.commandBacklog.pendingCount ? "export.pending-command-backlog" : null,
    recoveryPlan.actions.some((action) => action.priority === "required") ? "export.recovery-required" : null,
    timelineState !== "nominal" ? `export.timeline-${timelineState}` : null,
    capabilityClassReport.counters.overLimitClassCount ? "export.capability-class-over-limit" : null,
    mailchimpProviderReport.matched && !mailchimpProviderReport.exportReady ? "export.mailchimp-attention" : null,
    ...mailchimpProviderReport.blockingCodes.map((code) => `export.${code}`)
  ].filter(Boolean);
  const exportHealth = {
    schema: "rate-limit.export-health.v1",
    state: exportHealthCodes.some((code) => code.includes("blocked") || code.includes("over-limit"))
      ? "blocked"
      : exportHealthCodes.length
        ? "attention"
        : "ready",
    generatedAt: now,
    exportReady: exportRows.length > 0 && validationSummary.blockingFailureCount === 0,
    rowCount: exportRows.length,
    healthCodes: exportHealthCodes,
    commandStateCounters,
    recoveryCommandCounters,
    queue: {
      state: workflowHandoffQueue.state,
      canDispatch: workflowHandoffQueue.dispatch.canDispatch,
      pendingCommandCount: workflowHandoffQueue.commandBacklog.pendingCount,
      requiresCommandReplay: workflowHandoffQueue.commandBacklog.requiresCommandReplay,
      reservationState: workflowHandoffQueue.reservationPlan.state,
      capabilityHandoffState: workflowHandoffQueue.capabilityHandoff.state
    },
    digest: `${serviceContract.subjectKey}:${quotaState.snapshotId}:${runtimeDecision.request.requestId}:${exportHealthCodes.join("|") || "ready"}`
  };

  return {
    schema: "rate-limit.analytics-exports.v1",
    generatedAt: now,
    counters: {
      ...counters,
      currentWindowUsed: quotaState.windowUsed,
      currentReserved: quotaState.reserved,
      currentLocalPending: quotaState.localPending,
      currentRemaining: runtimeDecision.accounting.remainingBeforeRequest,
      currentAdmissionGuardState: runtimeDecision.admissionGuard.state,
      currentBurstBudgetRemaining: runtimeDecision.accounting.burstBudgetRemaining,
      currentClassWindowLimit: runtimeDecision.accounting.classWindowLimit,
      currentClassAccountedRequests: runtimeDecision.accounting.classAccountedRequests,
      currentClassBudgetRemaining: runtimeDecision.accounting.classBudgetRemaining,
      currentClassPressureRatio: runtimeDecision.accounting.classPressureRatio,
      currentCapabilityLaneState: runtimeDecision.accounting.capabilityLaneState,
      currentCapabilityLaneRemaining: runtimeDecision.accounting.capabilityLaneRemainingBeforeRequest,
      currentCapabilityLaneDeficit: runtimeDecision.accounting.capabilityLaneDeficit,
      currentEmergencyAdmissionState: runtimeDecision.accounting.emergencyAdmission.state,
      currentEmergencyUnitsGranted: runtimeDecision.accounting.emergencyUnitsGranted,
      capabilityClassPressureCount: capabilityClassReport.counters.pressuredClassCount,
      capabilityClassOverLimitCount: capabilityClassReport.counters.overLimitClassCount,
      activeClassRemainingUnits: capabilityClassReport.counters.activeClassRemainingUnits,
      activeClassAccountedRequests: capabilityClassReport.counters.activeClassAccountedRequests,
      topPressureCapabilityClass: capabilityClassReport.topPressureClass?.capabilityRateClass || null,
      validationWarnings: validationSummary.warningCount,
      validationFailures: validationSummary.blockingFailureCount,
      pendingCommandCount: commandStateCounters.pending,
      heldCommandCount: commandStateCounters.held,
      failedCommandCount: commandStateCounters.failed,
      alreadyAppliedCommandCount: commandStateCounters.alreadyApplied,
      requiredRecoveryActionCount: recoveryCommandCounters.required,
      recommendedRecoveryActionCount: recoveryCommandCounters.recommended,
      exportHealthCodeCount: exportHealth.healthCodes.length,
      mailchimpMatched: mailchimpProviderReport.matched ? 1 : 0,
      mailchimpExportReady: mailchimpProviderReport.exportReady ? 1 : 0,
      mailchimpEventCount: mailchimpProviderReport.counters.eventCount,
      mailchimpHeldWorkflowCount: mailchimpProviderReport.counters.heldWorkflowCount,
      mailchimpBlockingCodeCount: mailchimpProviderReport.counters.blockingCodeCount
    },
    commandStateCounters,
    recoveryCommandCounters,
    historySnapshots,
    snapshotTrend: snapshotDelta,
    capabilityClassReport,
    mailchimpProviderReport,
    timeline,
    exportSummary: {
      schema: "rate-limit.export-summary.v1",
      exportId: `${syncMetadata.syncKey}:analytics:${runtimeDecision.request.requestId}`,
      format: "jsonl-ready",
      rowCount: enrichedExportRows.length,
      partitionKeys: {
        subjectKey: serviceContract.subjectKey,
        providerId: providerContract.providerId,
        windowSnapshotId: currentWindowSnapshot.snapshotId,
        routeCount: Object.keys(counters.byRoute).length
      },
      columns: [
        "observedAt",
        "subjectKey",
        "providerId",
        "routeId",
        "capabilityRateClass",
        "clientId",
        "requestId",
        "decision",
        "units",
        "allowed",
        "admissionGuardState",
        "boundaryState",
        "providerHealth",
        "readinessState",
        "workflowHandoffState",
        "workflowNextActionId",
        "capabilityLaneState",
        "capabilityLaneDeficit",
        "emergencyAdmissionState",
        "emergencyUnitsGranted",
        "mailchimpMatched",
        "mailchimpStatus",
        "mailchimpOperationKind",
        "mailchimpProviderId",
        "mailchimpSyncKey",
        "mailchimpCursor",
        "mailchimpRemoteIdempotencyKey",
        "mailchimpRemoteHeaderNames",
        "mailchimpRestartSafeDeliveryKey",
        "mailchimpWorkflowState",
        "mailchimpWorkflowBlocking",
        "mailchimpNextActionId",
        "mailchimpExportReady",
        "mailchimpBlockingCodes"
      ],
      aggregates: {
        byDecision: counters.byDecision,
        byRoute: counters.byRoute,
        byCapabilityRateClass: counters.byCapabilityRateClass,
        unitsByCapabilityRateClass: counters.unitsByCapabilityRateClass,
        byAdmissionGuardState: counters.byAdmissionGuardState,
        topRoutesByUnits,
        capabilityClassState: Object.fromEntries(capabilityClassReport.classRows.map((row) => ([
          row.capabilityRateClass,
          {
            pressureState: row.pressureState,
            utilizationRatio: row.utilizationRatio,
            remainingUnits: row.remainingUnits,
            accountedRequestsDelta: row.delta.accountedRequests
          }
        ])))
      },
      health: exportHealth,
      rows: enrichedExportRows,
      capabilityClassRows: capabilityClassReport.exportRows,
      mailchimpRows: mailchimpProviderReport.rows,
      mailchimpProviderReport
    },
    reportTimeline: {
      schema: "rate-limit.report-timeline.v1",
      state: timelineState,
      snapshotCount: reportTimeline.length,
      eventCount: timeline.length,
      pressureState: snapshotDelta.state,
      currentPressureRatio: currentWindowSnapshot.pressureRatio,
      points: reportTimeline
    },
    workflowHandoffSnapshot: {
      schema: "rate-limit.workflow-handoff-analytics.v1",
      handoffId: workflowHandoffQueue.handoffId,
      state: workflowHandoffQueue.state,
      canDispatch: workflowHandoffQueue.dispatch.canDispatch,
      checkpointState: workflowHandoffQueue.clientCheckpoint.state,
      pendingCommandCount: workflowHandoffQueue.commandBacklog.pendingCount,
      reasonCodes: workflowHandoffQueue.proof.reasonCodes
    },
    reportingState: {
      schema: "rate-limit.reporting-state.v1",
      state: readiness.state === "blocked" || validationSummary.blockingFailureCount
        ? "blocked"
        : counters.throttleCount || counters.boundaryDenialCount || counters.degradedObservationCount
          ? "attention"
          : "ready",
      reportKey: `${serviceContract.subjectKey}:rate-limit:${quotaState.snapshotId}`,
      freshness: quotaState.resetAt ? "window-bound" : "snapshot-only",
      nextRefreshAfterMs: readiness.refreshAfterMs,
      auditReady: validationSummary.blockingFailureCount === 0,
      exportReady: exportRows.length > 0,
      exportHealthState: exportHealth.state,
      exportHealthCodes: exportHealth.healthCodes,
      timelineState,
      pressureTrend: snapshotDelta.state,
      snapshotCount: historySnapshots.length,
      exportRowCount: enrichedExportRows.length,
      mailchimpStatus: mailchimpProviderReport.status,
      mailchimpExportReady: mailchimpProviderReport.exportReady,
      mailchimpSummaryKey: mailchimpProviderReport.summaryKey,
      mailchimpNextActionId: mailchimpProviderReport.workflow.nextActionId,
      mailchimpBlockingCodes: mailchimpProviderReport.blockingCodes
    },
    exportHealth
  };
}

export function describeRateLimitSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const providerContract = normalizeProviderContract(input.provider || input.providerContract);
  const serviceContract = normalizeServiceContract(input.service || input.serviceContract, providerContract, input);
  const negotiation = buildNegotiation(providerContract, serviceContract);
  const syncMetadata = buildSyncMetadata(now, input, serviceContract, providerContract, negotiation);
  const requestState = normalizeRequestState(input, serviceContract);
  const accessBoundary = normalizeAccessBoundary(input, serviceContract, requestState, now);
  const quotaState = normalizeClientQuotaState(input, serviceContract);
  const persistedState = normalizePersistedRateLimitState(input, serviceContract, quotaState);
  const recoveryPlan = buildRecoveryPlan(now, serviceContract, syncMetadata, quotaState, persistedState);
  const lifecycleControls = buildLifecycleControls(now, input, serviceContract, syncMetadata, persistedState);
  const failureState = normalizeFailureState(input, providerContract);
  const operationalHealth = buildOperationalHealth(providerContract, serviceContract, negotiation, syncMetadata, quotaState, failureState);
  const runtimeDecision = buildRuntimeDecision(now, serviceContract, providerContract, negotiation, syncMetadata, requestState, quotaState, accessBoundary, lifecycleControls, operationalHealth);
  const externalHandoff = buildExternalHandoff(input, providerContract, serviceContract, syncMetadata, negotiation, runtimeDecision, accessBoundary);
  const evidence = normalizeEvidence(input.evidence);
  const providerServiceBridge = buildProviderServiceBridge(input, providerContract, serviceContract, syncMetadata, negotiation, runtimeDecision, externalHandoff, accessBoundary, operationalHealth);
  const providerHandoffReceipt = buildProviderHandoffReceipt(now, input, serviceContract, syncMetadata, runtimeDecision, externalHandoff, providerServiceBridge);
  const providerOperationContract = buildProviderOperationContract(input, providerContract, serviceContract, negotiation, syncMetadata, runtimeDecision, externalHandoff, providerServiceBridge);
  const idempotentCommands = buildIdempotentCommands(now, serviceContract, syncMetadata, runtimeDecision, persistedState, recoveryPlan, lifecycleControls);
  const commandRecoveryIndex = buildCommandRecoveryIndex(now, persistedState, idempotentCommands, runtimeDecision, lifecycleControls);
  const reservationExecutionPlan = buildReservationExecutionPlan(now, serviceContract, syncMetadata, runtimeDecision, persistedState, idempotentCommands, commandRecoveryIndex, providerOperationContract);
  const durableProjection = buildDurableStateProjection(now, serviceContract, syncMetadata, runtimeDecision, persistedState, recoveryPlan, idempotentCommands, commandRecoveryIndex);
  const workflowHandoffQueue = buildWorkflowHandoffQueue(now, input, serviceContract, syncMetadata, runtimeDecision, providerServiceBridge, lifecycleControls, idempotentCommands, reservationExecutionPlan);
  const validationSummary = buildValidationSummary(providerContract, serviceContract, negotiation, externalHandoff, evidence, runtimeDecision, persistedState, recoveryPlan, durableProjection, accessBoundary, operationalHealth, lifecycleControls, providerServiceBridge, providerHandoffReceipt, providerOperationContract, workflowHandoffQueue, reservationExecutionPlan);
  const acceptance = buildAcceptance(validationSummary, providerContract, serviceContract, negotiation, externalHandoff, providerServiceBridge, providerOperationContract);
  const readiness = buildReadiness(providerContract, serviceContract, negotiation, validationSummary, externalHandoff, recoveryPlan, operationalHealth, providerServiceBridge, providerOperationContract);
  const restartStatus = buildRestartSafeStatus(readiness, runtimeDecision, persistedState, recoveryPlan, idempotentCommands, durableProjection, commandRecoveryIndex);
  const preview = buildUserPreview(now, serviceContract, providerContract, negotiation, readiness, validationSummary, runtimeDecision, operationalHealth, lifecycleControls, providerServiceBridge);
  const actionableErrors = buildActionableErrors(validationSummary, readiness, operationalHealth, runtimeDecision, recoveryPlan, lifecycleControls, providerServiceBridge, providerHandoffReceipt, providerOperationContract, workflowHandoffQueue, syncMetadata);
  const operationalRecovery = buildOperationalRecoveryEnvelope(now, readiness, operationalHealth, actionableErrors, runtimeDecision, lifecycleControls, providerServiceBridge, workflowHandoffQueue);
  const nextSteps = buildNextSteps(validationSummary, readiness, externalHandoff, syncMetadata, runtimeDecision, recoveryPlan, idempotentCommands, operationalHealth, lifecycleControls, providerServiceBridge, providerHandoffReceipt, providerOperationContract, workflowHandoffQueue, commandRecoveryIndex, reservationExecutionPlan);
  const clientReview = buildClientReviewContract(now, preview, acceptance, readiness, validationSummary, nextSteps, actionableErrors, runtimeDecision, providerServiceBridge, providerHandoffReceipt, providerOperationContract, workflowHandoffQueue, reservationExecutionPlan, operationalRecovery);
  const routeClientResponse = buildRouteClientResponseContract(now, serviceContract, acceptance, readiness, validationSummary, runtimeDecision, workflowHandoffQueue, reservationExecutionPlan, operationalRecovery, nextSteps);
  const analytics = buildAnalyticsExports(now, input, serviceContract, providerContract, syncMetadata, runtimeDecision, quotaState, persistedState, recoveryPlan, accessBoundary, operationalHealth, validationSummary, readiness, workflowHandoffQueue, idempotentCommands);

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: {
      type: "hosted-kernel-rate-limit-provider-service-contract",
      provider: providerContract,
      service: serviceContract,
      negotiation,
      accessBoundary,
      lifecycleControls,
      providerServiceBridge,
      providerHandoffReceipt,
      providerOperationContract,
      reservationExecutionPlan
    },
    sync: syncMetadata,
    runtime: runtimeDecision,
    accessBoundary,
    lifecycleControls,
    persistence: {
      state: persistedState,
      recovery: recoveryPlan,
      commands: idempotentCommands,
      commandRecovery: commandRecoveryIndex,
      durableProjection,
      restartStatus
    },
    externalHandoff,
    providerServiceBridge,
    providerHandoffReceipt,
    providerOperationContract,
    reservationExecutionPlan,
    workflowHandoffQueue,
    operationalHealth,
    preview,
    acceptance,
    readiness,
    validationSummary,
    clientReview,
    routeClientResponse,
    analytics,
    actionableErrors,
    operationalRecovery,
    nextSteps,
    auditProof: buildAuditProof(now, providerContract, serviceContract, negotiation, syncMetadata, evidence, runtimeDecision, persistedState, recoveryPlan, restartStatus, durableProjection, accessBoundary, operationalHealth, lifecycleControls, providerServiceBridge, providerHandoffReceipt, providerOperationContract, workflowHandoffQueue, reservationExecutionPlan, operationalRecovery),
    evidence
  };
}

export default describeRateLimitSurface;
