export const surfaceId = "aios_capability-security_destructive-action-guard_017";
export const surfaceGroup = "capability-security";
export const surfaceName = "destructive-action-guard";

const CONTRACT_VERSION = "destructive-action-guard.v1";
const EXECUTION_GATE_VERSION = `${CONTRACT_VERSION}.execution-gate`;
const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LEDGER_LIMIT = 50;
const DEFAULT_HISTORY_LIMIT = 25;
const DEFAULT_CLIENT_HANDOFF_LIMIT = 10;
const DEFAULT_EXPORT_ACTION_LIMIT = 10;
const DEFAULT_APPROVAL_REPORTING_SLA_MS = 15 * 60 * 1000;
const DEFAULT_LEASE_EXPIRY_WARNING_MS = 60 * 1000;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_RETRY_MAX_DELAY_MS = 30 * 1000;
const DEFAULT_RETRY_MAX_ATTEMPTS = 4;
const DEFAULT_IN_FLIGHT_COMMAND_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PROVIDER_HEARTBEAT_STALE_MS = 2 * 60 * 1000;
const MIN_LIFECYCLE_CONTROL_REASON_LENGTH = 8;
const MAX_LIFECYCLE_SCHEDULE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDER_CONTRACT_VERSION = `${CONTRACT_VERSION}.provider-contract`;
const REQUIRED_PROVIDER_CAPABILITIES = [
  "guard.decision.read",
  "guard.approval.request",
  "guard.audit.write",
  "guard.state.checkpoint"
];
const OPTIONAL_PROVIDER_CAPABILITIES = [
  "guard.execution.lease",
  "guard.preview.render",
  "guard.sync.delta",
  "guard.workflow.handoff"
];
const PROVIDER_SERVICE_ENDPOINTS = {
  decision: "/capability-security/destructive-action-guard/decision",
  approval: "/capability-security/destructive-action-guard/approval",
  checkpoint: "/capability-security/destructive-action-guard/checkpoint",
  audit: "/capability-security/destructive-action-guard/audit",
  handoff: "/capability-security/destructive-action-guard/handoff"
};
const PROVIDER_REQUIRED_ENDPOINT_TYPES = ["decision", "approval", "checkpoint", "audit"];
const SUPPORTED_COMMAND_TYPES = new Set([
  "approve",
  "deny",
  "disable",
  "enable",
  "evaluate",
  "execute",
  "recover",
  "replay",
  "schedule",
  "unschedule"
]);
const PROVIDER_READY_STATUSES = new Set(["healthy", "ready", "online"]);
const PROVIDER_DEGRADED_STATUSES = new Set(["degraded", "maintenance", "draining"]);
const PROVIDER_DOWN_STATUSES = new Set(["offline", "unavailable", "failed", "down"]);
const LIFECYCLE_COMMAND_TYPES = new Set(["disable", "enable", "schedule", "unschedule"]);
const ENFORCEMENT_MODES = new Set(["enforce", "monitor", "disabled"]);
const TERMINAL_COMMAND_STATUSES = new Set(["completed", "replayed", "blocked", "failed", "cancelled"]);
const ACTIVE_COMMAND_STATUSES = new Set(["pending", "started", "in_progress", "lease_issued"]);
const RECOVERY_COMMAND_STATUSES = new Set(["recovery_required", "recovering"]);
const TERMINAL_HANDOFF_STATUSES = new Set(["acknowledged", "completed", "dismissed", "cancelled", "expired"]);
const SUPPRESSIBLE_PROVIDER_OPERATION_TYPES = new Set(["approval", "handoff", "execution_lease"]);
const MIN_APPROVAL_TTL_MS = 30 * 1000;
const MAX_APPROVAL_TTL_MS = 60 * 60 * 1000;
const DESTRUCTIVE_OPERATIONS = new Set([
  "delete",
  "destroy",
  "drop",
  "erase",
  "format",
  "purge",
  "remove",
  "reset",
  "revoke",
  "truncate",
  "wipe"
]);
const DEPLOYMENT_OPERATIONS = new Set([
  "deploy",
  "promote",
  "publish",
  "release",
  "rollback",
  "rollout",
  "ship",
  "switch"
]);
const PRIVILEGED_MUTATION_OPERATIONS = new Set([
  "attach",
  "bind",
  "grant",
  "impersonate",
  "migrate",
  "override",
  "patch",
  "rotate",
  "set",
  "transfer",
  "update",
  "upgrade"
]);
const IRREVERSIBLE_OPERATIONS = new Set([
  "archive",
  "burn",
  "commit",
  "finalize",
  "lock",
  "seal",
  "terminate"
]);
const OPERATION_TOKEN_ALIASES = {
  del: "delete",
  harddelete: "delete",
  hard_deleted: "delete",
  hard_delete: "delete",
  rm: "remove",
  unpublish: "publish",
  undeploy: "deploy"
};
const PRIVILEGED_MUTATION_TARGET_HINTS = [
  "acl",
  "admin",
  "capability",
  "certificate",
  "entitlement",
  "iam",
  "permission",
  "role",
  "root",
  "scope",
  "service-account"
];
const IRREVERSIBLE_ACTION_HINTS = [
  "force",
  "hard-delete",
  "irreversible",
  "no-backup",
  "permanent",
  "skip-backup",
  "without-backup"
];
const SENSITIVE_TARGET_HINTS = [
  "account",
  "backup",
  "billing",
  "credential",
  "customer",
  "database",
  "filesystem",
  "identity",
  "key",
  "payment",
  "policy",
  "production",
  "secret",
  "tenant",
  "token",
  "user"
];
const EXTERNAL_SERVICE_OPERATION_PROFILES = {
  mailchimp: {
    routeHints: ["mailchimp", "campaign", "audience", "list", "member", "subscriber", "template", "journey"],
    destructiveOperations: ["delete", "archive", "remove", "unsubscribe", "clean", "purge"],
    privilegedOperations: ["send", "schedule", "unschedule", "replicate", "update", "patch", "set"],
    irreversibleOperations: ["delete", "purge", "send"],
    checkpointRequiredTargetKinds: ["campaign", "audience", "journey"],
    highImpactTargetKinds: ["audience", "journey"],
    previewRequiredOperations: ["delete", "purge", "send", "schedule", "unsubscribe"],
    remoteQuotaPolicy: {
      requiredOperations: ["send", "schedule", "unschedule", "unsubscribe", "delete", "purge"],
      requiredTargetKinds: ["campaign", "audience", "journey"],
      capability: "rate-limit.external-handoff.v1",
      rateClass: "external-system",
      quotaSnapshotRequired: true,
      acceptanceMaxAgeMs: 5 * 60 * 1000,
      retryHeaderNames: ["retry-after", "x-ratelimit-reset", "x-request-id"],
      resetHeaderNames: ["x-ratelimit-reset"],
      nextActionWhenMissing: "handoff.mailchimp.rate-limit-quota"
    },
    remoteReplayWindowMs: 10 * 60 * 1000,
    targetKinds: {
      campaign: ["campaign", "campaigns", "email-campaign", "email"],
      audience: ["audience", "audiences", "list", "lists", "member", "members", "subscriber"],
      template: ["template", "templates"],
      journey: ["journey", "customer-journey", "automation", "automations"]
    },
    remoteIdempotencyHeaders: ["X-Request-Id", "X-Idempotency-Key"],
    auditEventType: "mailchimp.marketing.operation",
    approvalReasonCode: "external_mailchimp_operation_requires_guard"
  }
};
const ROLE_PERMISSION_GRANTS = {
  "platform-admin": ["destructive-action:execute", "platform:admin", "tenant:admin", "workspace:admin"],
  owner: ["destructive-action:execute", "tenant:admin", "workspace:admin"],
  admin: ["destructive-action:execute", "workspace:admin"],
  operator: ["destructive-action:request"],
  auditor: ["destructive-action:audit"]
};

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}

function normalizeExternalProfileToken(value) {
  return asString(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function resolveExternalServiceProfile(input = {}, request = {}) {
  const source = asRecord(input.externalServiceProfile ?? input.providerProfile ?? request.externalService);
  const explicitProfile = normalizeExternalProfileToken(
    source.profile ?? source.provider ?? source.service ?? input.providerProfileName
  );
  const routeText = [
    explicitProfile,
    request.route,
    request.operation,
    request.targetType,
    request.target,
    JSON.stringify(request.args ?? {})
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const matchedProfile = Object.entries(EXTERNAL_SERVICE_OPERATION_PROFILES).find(([, profile]) => (
    profile.routeHints.some((hint) => routeText.includes(hint))
  ))?.[0] || "";
  const profileName = EXTERNAL_SERVICE_OPERATION_PROFILES[explicitProfile] ? explicitProfile : matchedProfile;
  const profile = EXTERNAL_SERVICE_OPERATION_PROFILES[profileName] || null;
  return {
    contractVersion: `${CONTRACT_VERSION}.external-service-profile`,
    profile: profileName || "generic",
    matched: Boolean(profile),
    source: explicitProfile ? "explicit" : profile ? "inferred" : "generic",
    routeHints: profile?.routeHints ?? [],
    destructiveOperations: profile?.destructiveOperations ?? [],
    privilegedOperations: profile?.privilegedOperations ?? [],
    targetKinds: profile?.targetKinds ?? {},
    irreversibleOperations: profile?.irreversibleOperations ?? [],
    checkpointRequiredTargetKinds: profile?.checkpointRequiredTargetKinds ?? [],
    highImpactTargetKinds: profile?.highImpactTargetKinds ?? [],
    previewRequiredOperations: profile?.previewRequiredOperations ?? [],
    remoteQuotaPolicy: profile?.remoteQuotaPolicy ?? null,
    remoteReplayWindowMs: profile?.remoteReplayWindowMs ?? 5 * 60 * 1000,
    remoteIdempotencyHeaders: asStringArray(source.remoteIdempotencyHeaders).length
      ? asStringArray(source.remoteIdempotencyHeaders)
      : profile?.remoteIdempotencyHeaders ?? [],
    auditEventType: asString(source.auditEventType, profile?.auditEventType ?? "external.service.operation"),
    approvalReasonCode: profile?.approvalReasonCode ?? "external_service_operation_requires_guard"
  };
}

function inferExternalTargetKind(profile, request) {
  const text = `${request.targetType} ${request.target} ${request.route} ${JSON.stringify(request.args)}`.toLowerCase();
  const matched = Object.entries(profile.targetKinds || {}).find(([, hints]) => (
    hints.some((hint) => text.includes(hint))
  ));
  return matched?.[0] || (profile.matched ? "service-resource" : "generic");
}

function buildExternalServiceQuotaHandoff({ profile, operationTokens, targetKind, explicit, request, remoteRequestId, idempotencyKey }) {
  const policy = asRecord(profile.remoteQuotaPolicy);
  const quota = asRecord(
    explicit.rateLimitHandoff ??
      explicit.remoteQuota ??
      request.args.rateLimitHandoff ??
      request.args.remoteQuota
  );
  const requiredOperations = asStringArray(policy.requiredOperations);
  const requiredTargetKinds = asStringArray(policy.requiredTargetKinds);
  const operationRequiresQuota = requiredOperations.some((operation) => operationTokens.includes(operation));
  const targetRequiresQuota = requiredTargetKinds.includes(targetKind);
  const required = Boolean(profile.matched && policy.capability && (operationRequiresQuota || targetRequiresQuota));
  const acceptedAt = asString(quota.acceptedAt ?? quota.recordedAt, "");
  const acceptedAtMs = Date.parse(acceptedAt);
  const nowMs = Date.now();
  const acceptanceMaxAgeMs = Math.max(
    60_000,
    asNonNegativeInteger(policy.acceptanceMaxAgeMs, 5 * 60 * 1000)
  );
  const acceptanceAgeMs = Number.isFinite(acceptedAtMs) ? Math.max(0, nowMs - acceptedAtMs) : null;
  const acceptanceStale = Boolean(
    required &&
      acceptedAt &&
      Number.isFinite(acceptedAtMs) &&
      acceptanceAgeMs > acceptanceMaxAgeMs
  );
  const acceptedBy = asString(quota.acceptedBy ?? quota.actorId ?? quota.principalId, "");
  const expectedAcceptanceKey = [
    profile.profile,
    request.boundary.tenantId,
    request.boundary.workspaceId,
    targetKind,
    remoteRequestId
  ].join(":");
  const acceptanceKey = asString(quota.acceptanceKey ?? quota.key, "");
  const quotaSnapshotId = asString(
    quota.snapshotId ?? quota.quotaSnapshotId ?? quota.checkpointId,
    required && policy.quotaSnapshotRequired ? `${CONTRACT_VERSION}:quota:${remoteRequestId}` : ""
  );
  const providerCursor = asString(quota.providerCursor ?? quota.cursor, "");
  const resetAt = asString(quota.resetAt ?? quota.remoteResetAt, "");
  const retryAfterMs = asNonNegativeInteger(quota.retryAfterMs ?? quota.retryAfter, 0);
  const remaining = Number.isInteger(quota.remaining) && quota.remaining >= 0 ? quota.remaining : null;
  const limit = Number.isInteger(quota.limit) && quota.limit >= 0 ? quota.limit : null;
  const accepted = !required || (
    !acceptanceStale &&
      (quota.accepted === true || Boolean(acceptedAt && acceptedBy && acceptanceKey === expectedAcceptanceKey))
  );
  const snapshotReady = !required || !policy.quotaSnapshotRequired || Boolean(quotaSnapshotId);
  const providerCursorReady = !required || Boolean(providerCursor || quotaSnapshotId);
  const blockedByRemoteQuota = required && remaining === 0;
  const violationCodes = [
    required && !accepted ? "external.rate-limit-acceptance-required" : "",
    acceptanceStale ? "external.rate-limit-acceptance-stale" : "",
    required && !snapshotReady ? "external.rate-limit-snapshot-required" : "",
    required && !providerCursorReady ? "external.rate-limit-provider-cursor-required" : "",
    blockedByRemoteQuota ? "external.rate-limit-remote-quota-exhausted" : ""
  ].filter(Boolean);
  const ready = required ? violationCodes.length === 0 : true;

  return {
    contractVersion: `${CONTRACT_VERSION}.external-service-quota-handoff`,
    profile: profile.profile,
    required,
    ready,
    state: !required ? "not-required" : ready ? "ready" : "blocked",
    capability: asString(policy.capability, ""),
    capabilityRateClass: asString(policy.rateClass, "external-system"),
    operationRequiresQuota,
    targetRequiresQuota,
    quotaSnapshotRequired: Boolean(policy.quotaSnapshotRequired),
    quotaSnapshotId,
    providerCursor,
    expectedAcceptanceKey,
    acceptanceKey,
    accepted,
    acceptedAt,
    acceptedBy,
    acceptanceMaxAgeMs,
    acceptanceAgeMs,
    acceptanceStale,
    remoteQuota: {
      limit,
      remaining,
      resetAt,
      retryAfterMs,
      retryHeaderNames: asStringArray(policy.retryHeaderNames),
      resetHeaderNames: asStringArray(policy.resetHeaderNames)
    },
    idempotency: {
      remoteRequestId,
      idempotencyKey,
      quotaFenceKey: `${profile.profile}:${targetKind}:${remoteRequestId}:quota`
    },
    nextAction: {
      actionId: ready
        ? "dispatch.external-service-operation"
        : acceptanceStale
          ? "refresh.external-service-rate-limit-acceptance"
        : asString(policy.nextActionWhenMissing, "handoff.external-service-rate-limit-quota"),
      owner: ready ? "kernel" : acceptanceStale || !accepted ? "operator" : "kernel",
      reasonCodes: violationCodes,
      retryAfterMs: blockedByRemoteQuota ? retryAfterMs : acceptanceStale ? acceptanceMaxAgeMs : 0
    },
    violationCodes
  };
}

function buildExternalServiceBoundaryProtocol({ profile, operationTokens, targetKind, explicit, request, remoteRequestId, idempotencyKey }) {
  const irreversibleMatches = operationTokens.filter((token) => profile.irreversibleOperations.includes(token));
  const previewMatches = operationTokens.filter((token) => profile.previewRequiredOperations.includes(token));
  const quotaHandoff = buildExternalServiceQuotaHandoff({
    profile,
    operationTokens,
    targetKind,
    explicit,
    request,
    remoteRequestId,
    idempotencyKey
  });
  const checkpointRequired = profile.checkpointRequiredTargetKinds.includes(targetKind)
    || irreversibleMatches.length > 0
    || quotaHandoff.required
    || asString(explicit.checkpointId || explicit.checkpointRef, "") !== "";
  const highImpactTarget = profile.highImpactTargetKinds.includes(targetKind);
  const previewRequired = previewMatches.length > 0 || highImpactTarget;
  const dryRunAccepted = explicit.dryRun === true || explicit.previewAccepted === true;
  const checkpointId = asString(
    explicit.checkpointId || explicit.checkpointRef || request.args.checkpointId,
    checkpointRequired ? `${CONTRACT_VERSION}:external-checkpoint:${remoteRequestId}` : ""
  );
  const confirmationPhrase = asString(
    explicit.confirmationPhrase || explicit.confirmation,
    ""
  );
  const expectedConfirmationPhrase = previewRequired
    ? buildConfirmationPhrase({
        ...request,
        operation: operationTokens[0] || request.operation,
        target: `${profile.profile}:${targetKind}:${request.target || request.id}`
      })
    : "";
  const confirmationAccepted = !previewRequired
    || confirmationPhrase === expectedConfirmationPhrase
    || explicit.confirmed === true;
  const remoteReplayWindowMs = Math.max(60_000, Number.isInteger(explicit.remoteReplayWindowMs)
    ? explicit.remoteReplayWindowMs
    : profile.remoteReplayWindowMs);
  const replayFenceKey = `${profile.profile}:${request.boundary.tenantId}:${request.boundary.workspaceId}:${targetKind}:${remoteRequestId}`;
  const violationCodes = [
    checkpointRequired && !checkpointId ? "external.checkpoint-required" : "",
    previewRequired && !dryRunAccepted ? "external.preview-required" : "",
    previewRequired && !confirmationAccepted ? "external.confirmation-required" : "",
    !idempotencyKey ? "external.idempotency-key-required" : "",
    ...quotaHandoff.violationCodes
  ].filter(Boolean);
  const dispatchMode = violationCodes.length
    ? "hold-for-operator-acceptance"
    : checkpointRequired || previewRequired
      ? "guarded-provider-dispatch"
      : "direct-provider-dispatch";

  return {
    contractVersion: `${CONTRACT_VERSION}.external-service-boundary-protocol`,
    profile: profile.profile,
    targetKind,
    highImpactTarget,
    checkpointRequired,
    previewRequired,
    dryRunAccepted,
    confirmationAccepted,
    expectedConfirmationPhrase,
    checkpointId,
    dispatchMode,
    safeToDispatch: violationCodes.length === 0,
    violationCodes,
    replayFence: {
      key: replayFenceKey,
      remoteRequestId,
      idempotencyKey,
      windowMs: remoteReplayWindowMs,
      duplicatePolicy: "block-and-audit"
    },
    quotaHandoff,
    matchedIrreversibleOperations: irreversibleMatches,
    matchedPreviewOperations: previewMatches,
    nextAction: violationCodes.length
      ? {
          actionId: quotaHandoff.required && !quotaHandoff.ready
            ? quotaHandoff.nextAction.actionId
            : "collect.external-service-operator-acceptance",
          owner: quotaHandoff.required && !quotaHandoff.ready
            ? quotaHandoff.nextAction.owner
            : "operator",
          reasonCodes: violationCodes,
          checkpointId,
          previewRequired,
          confirmationRequired: previewRequired && !confirmationAccepted,
          retryAfterMs: quotaHandoff.nextAction.retryAfterMs
        }
      : {
          actionId: "dispatch.external-service-operation",
          owner: "kernel",
          reasonCodes: [],
          checkpointId,
          previewRequired,
          confirmationRequired: false,
          retryAfterMs: 0
        }
  };
}

function buildExternalServiceOperation(input, request) {
  const profile = resolveExternalServiceProfile(input, request);
  const operationTokens = collectOperationTokens(request);
  const matchedDestructive = operationTokens.filter((token) => profile.destructiveOperations.includes(token));
  const matchedPrivileged = operationTokens.filter((token) => profile.privilegedOperations.includes(token));
  const targetKind = inferExternalTargetKind(profile, request);
  const explicit = asRecord(input.externalOperation ?? request.args.externalOperation);
  const remoteRequestId = asString(
    explicit.remoteRequestId ?? explicit.requestId ?? request.args.remoteRequestId,
    `${profile.profile}:${request.boundary.tenantId}:${request.boundary.workspaceId}:${request.id}`
  );
  const idempotencyKey = asString(
    explicit.idempotencyKey ?? explicit.remoteIdempotencyKey ?? request.args.idempotencyKey,
    `${CONTRACT_VERSION}:external:${remoteRequestId}`
  );
  const boundaryProtocol = buildExternalServiceBoundaryProtocol({
    profile,
    operationTokens,
    targetKind,
    explicit,
    request,
    remoteRequestId,
    idempotencyKey
  });
  const requiresApproval = profile.matched && (
    matchedDestructive.length > 0 ||
    matchedPrivileged.length > 0 ||
    ["campaign", "audience", "journey"].includes(targetKind) ||
    boundaryProtocol.previewRequired ||
    !boundaryProtocol.safeToDispatch
  );
  return {
    contractVersion: `${CONTRACT_VERSION}.external-service-operation`,
    profile: profile.profile,
    matched: profile.matched,
    source: profile.source,
    auditEventType: profile.auditEventType,
    targetKind,
    remoteRequestId,
    idempotencyKey,
    remoteIdempotencyHeaders: Object.fromEntries(
      profile.remoteIdempotencyHeaders.map((header) => [header, idempotencyKey])
    ),
    operationTokens,
    matchedDestructiveOperations: matchedDestructive,
    matchedPrivilegedOperations: matchedPrivileged,
    matchedIrreversibleOperations: boundaryProtocol.matchedIrreversibleOperations,
    requiresApproval,
    approvalReasonCode: requiresApproval ? profile.approvalReasonCode : "",
    restartSafeKey: `${profile.profile}:${request.boundary.tenantId}:${request.boundary.workspaceId}:${request.id}:${idempotencyKey}`,
    boundary: request.boundary,
    boundaryProtocol
  };
}

function buildExternalServiceReportingSlice(externalOperation = {}) {
  const operation = asRecord(externalOperation);
  const protocol = asRecord(operation.boundaryProtocol);
  const replayFence = asRecord(protocol.replayFence);
  const quotaHandoff = asRecord(protocol.quotaHandoff);
  const nextAction = asRecord(protocol.nextAction);
  const dispatchMode = asString(protocol.dispatchMode, "direct-provider-dispatch");
  const safeToDispatch = asBoolean(protocol.safeToDispatch, false);
  const violationCodes = asStringArray(protocol.violationCodes);
  const requiresOperatorAcceptance = operation.requiresApproval === true || violationCodes.length > 0;
  const remoteHeaders = asRecord(operation.remoteIdempotencyHeaders);
  const remoteHeaderNames = Object.keys(remoteHeaders).sort();
  const restartSafeKey = asString(operation.restartSafeKey, "");
  const replayFenceKey = asString(replayFence.key, "");
  const checkpointId = asString(protocol.checkpointId, "");
  const expectedConfirmationPhrase = asString(protocol.expectedConfirmationPhrase, "");
  const profile = asString(operation.profile, "generic");
  const targetKind = asString(operation.targetKind, "generic");
  const matched = asBoolean(operation.matched, false);
  const safeDispatchReady = matched && safeToDispatch && Boolean(restartSafeKey) && Boolean(replayFenceKey);
  const reportingState = !matched
    ? "not-external"
    : safeDispatchReady
      ? "dispatch-ready"
      : requiresOperatorAcceptance
        ? "acceptance-required"
        : "missing-replay-proof";
  const reportingCodes = [
    matched ? `external.profile.${profile}` : "",
    matched ? `external.target.${targetKind}` : "",
    operation.requiresApproval ? "external.requires-approval" : "",
    protocol.previewRequired ? "external.preview-required" : "",
    protocol.checkpointRequired ? "external.checkpoint-required" : "",
    !safeToDispatch && matched ? "external.dispatch-held" : "",
    matched && !restartSafeKey ? "external.restart-safe-key-missing" : "",
    matched && !replayFenceKey ? "external.replay-fence-missing" : "",
    matched && !remoteHeaderNames.length ? "external.remote-idempotency-header-missing" : "",
    ...violationCodes
  ].filter(Boolean);

  return {
    contractVersion: `${CONTRACT_VERSION}.external-service-reporting`,
    matched,
    profile,
    source: asString(operation.source, "generic"),
    targetKind,
    auditEventType: asString(operation.auditEventType, ""),
    remoteRequestId: asString(operation.remoteRequestId, ""),
    idempotencyKey: asString(operation.idempotencyKey, ""),
    remoteIdempotencyHeaders: remoteHeaders,
    remoteIdempotencyHeaderNames: remoteHeaderNames,
    restartSafeKey,
    replayFenceKey,
    replayWindowMs: asNonNegativeInteger(replayFence.windowMs, 0),
    duplicatePolicy: asString(replayFence.duplicatePolicy, ""),
    dispatchMode,
    safeToDispatch,
    reportingState,
    reportingCodes,
    requiresOperatorAcceptance,
    checkpointRequired: asBoolean(protocol.checkpointRequired, false),
    checkpointId,
    previewRequired: asBoolean(protocol.previewRequired, false),
    confirmationRequired: Boolean(expectedConfirmationPhrase && !protocol.confirmationAccepted),
    expectedConfirmationPhrase,
    nextActionId: asString(nextAction.actionId, safeToDispatch ? "dispatch.external-service-operation" : "collect.external-service-operator-acceptance"),
    nextActionOwner: asString(nextAction.owner, safeToDispatch ? "kernel" : "operator"),
    nextActionReasonCodes: asStringArray(nextAction.reasonCodes).length
      ? asStringArray(nextAction.reasonCodes)
      : violationCodes,
    quotaHandoff: {
      required: asBoolean(quotaHandoff.required, false),
      ready: asBoolean(quotaHandoff.ready, true),
      state: asString(quotaHandoff.state, "not-required"),
      capability: asString(quotaHandoff.capability, ""),
      capabilityRateClass: asString(quotaHandoff.capabilityRateClass, ""),
      quotaSnapshotId: asString(quotaHandoff.quotaSnapshotId, ""),
      providerCursor: asString(quotaHandoff.providerCursor, ""),
      expectedAcceptanceKey: asString(quotaHandoff.expectedAcceptanceKey, ""),
      acceptanceKey: asString(quotaHandoff.acceptanceKey, ""),
      accepted: asBoolean(quotaHandoff.accepted, false),
      acceptedAt: asString(quotaHandoff.acceptedAt, ""),
      acceptedBy: asString(quotaHandoff.acceptedBy, ""),
      acceptanceMaxAgeMs: asNonNegativeInteger(quotaHandoff.acceptanceMaxAgeMs, 0),
      acceptanceAgeMs: quotaHandoff.acceptanceAgeMs === null
        ? null
        : asNonNegativeInteger(quotaHandoff.acceptanceAgeMs, 0),
      acceptanceStale: asBoolean(quotaHandoff.acceptanceStale, false),
      nextActionId: asString(quotaHandoff.nextAction?.actionId, ""),
      nextActionOwner: asString(quotaHandoff.nextAction?.owner, ""),
      retryAfterMs: asNonNegativeInteger(quotaHandoff.nextAction?.retryAfterMs, 0),
      violationCodes: asStringArray(quotaHandoff.violationCodes),
      remoteQuota: asRecord(quotaHandoff.remoteQuota)
    },
    matchedDestructiveOperations: asStringArray(operation.matchedDestructiveOperations),
    matchedPrivilegedOperations: asStringArray(operation.matchedPrivilegedOperations),
    matchedIrreversibleOperations: asStringArray(operation.matchedIrreversibleOperations)
  };
}

function buildMailchimpOperationAnalyticsSlice({ request, externalReporting }) {
  const matched = externalReporting.profile === "mailchimp";
  const targetKind = externalReporting.targetKind || "generic";
  const remoteHeaders = externalReporting.remoteIdempotencyHeaders || {};
  const quotaHandoff = asRecord(externalReporting.quotaHandoff);
  const operationTokens = matched
    ? [
        ...asStringArray(request.externalOperation?.operationTokens),
        ...externalReporting.matchedDestructiveOperations,
        ...externalReporting.matchedPrivilegedOperations,
        ...externalReporting.matchedIrreversibleOperations
      ]
    : [];
  const remoteHeaderNames = Object.keys(remoteHeaders).sort();
  const irreversible = externalReporting.matchedIrreversibleOperations.length > 0;
  const audienceMutation = targetKind === "audience" && (
    operationTokens.includes("delete") ||
    operationTokens.includes("remove") ||
    operationTokens.includes("unsubscribe") ||
    operationTokens.includes("purge") ||
    operationTokens.includes("clean")
  );
  const campaignDispatch = targetKind === "campaign" && (
    operationTokens.includes("send") ||
    operationTokens.includes("schedule") ||
    operationTokens.includes("unschedule")
  );
  const journeyMutation = targetKind === "journey" && (
    operationTokens.includes("send") ||
    operationTokens.includes("schedule") ||
    operationTokens.includes("update") ||
    operationTokens.includes("patch")
  );
  const exportTags = [
    matched ? "mailchimp" : "",
    targetKind !== "generic" ? `mailchimp.${targetKind}` : "",
    audienceMutation ? "mailchimp.audience-mutation" : "",
    campaignDispatch ? "mailchimp.campaign-dispatch" : "",
    journeyMutation ? "mailchimp.journey-mutation" : "",
    externalReporting.checkpointRequired ? "mailchimp.checkpoint-required" : "",
    externalReporting.previewRequired ? "mailchimp.preview-required" : "",
    externalReporting.requiresOperatorAcceptance ? "mailchimp.acceptance-required" : "",
    quotaHandoff.required ? "mailchimp.rate-limit-handoff-required" : "",
    quotaHandoff.ready === false ? "mailchimp.rate-limit-handoff-blocked" : "",
    quotaHandoff.acceptanceStale ? "mailchimp.rate-limit-acceptance-stale" : "",
    irreversible ? "mailchimp.irreversible-operation" : "",
    externalReporting.safeToDispatch ? "mailchimp.dispatch-ready" : "mailchimp.dispatch-held"
  ].filter(Boolean);
  const blockingCodes = [
    matched && !externalReporting.restartSafeKey ? "mailchimp.restart-safe-key-missing" : "",
    matched && !externalReporting.replayFenceKey ? "mailchimp.replay-fence-missing" : "",
    matched && !remoteHeaderNames.length ? "mailchimp.remote-idempotency-header-missing" : "",
    matched && externalReporting.requiresOperatorAcceptance && !externalReporting.checkpointId
      ? "mailchimp.acceptance-checkpoint-missing"
      : "",
    matched && quotaHandoff.required && quotaHandoff.ready === false ? "mailchimp.rate-limit-handoff-not-ready" : "",
    matched && quotaHandoff.acceptanceStale ? "mailchimp.rate-limit-acceptance-stale" : "",
    ...asStringArray(quotaHandoff.violationCodes).map((code) => `mailchimp.${code.replace(/^external\./, "")}`),
    ...externalReporting.nextActionReasonCodes
      .filter((code) => code.startsWith("external."))
      .map((code) => `mailchimp.${code.slice("external.".length)}`)
  ].filter(Boolean);
  const reportingState = !matched
    ? "not-mailchimp"
    : blockingCodes.length
      ? "blocked"
      : externalReporting.safeToDispatch
        ? "export-ready"
        : "operator-action-required";

  return {
    contractVersion: `${CONTRACT_VERSION}.mailchimp-operation-analytics`,
    matched,
    reportingState,
    targetKind,
    route: request.route,
    operation: request.operation,
    remoteRequestId: externalReporting.remoteRequestId,
    idempotencyKey: externalReporting.idempotencyKey,
    remoteIdempotencyHeaderNames: remoteHeaderNames,
    remoteIdempotencyHeaders: remoteHeaders,
    restartSafeKey: externalReporting.restartSafeKey,
    replayFenceKey: externalReporting.replayFenceKey,
    replayWindowMs: externalReporting.replayWindowMs,
    checkpointId: externalReporting.checkpointId,
    checkpointRequired: externalReporting.checkpointRequired,
    previewRequired: externalReporting.previewRequired,
    confirmationRequired: externalReporting.confirmationRequired,
    requiresOperatorAcceptance: externalReporting.requiresOperatorAcceptance,
    safeToDispatch: externalReporting.safeToDispatch,
    dispatchMode: externalReporting.dispatchMode,
    rateLimitHandoff: {
      required: asBoolean(quotaHandoff.required, false),
      ready: asBoolean(quotaHandoff.ready, true),
      state: asString(quotaHandoff.state, "not-required"),
      capability: asString(quotaHandoff.capability, ""),
      capabilityRateClass: asString(quotaHandoff.capabilityRateClass, ""),
      quotaSnapshotId: asString(quotaHandoff.quotaSnapshotId, ""),
      providerCursor: asString(quotaHandoff.providerCursor, ""),
      accepted: asBoolean(quotaHandoff.accepted, false),
      acceptedAt: asString(quotaHandoff.acceptedAt, ""),
      acceptedBy: asString(quotaHandoff.acceptedBy, ""),
      acceptanceMaxAgeMs: asNonNegativeInteger(quotaHandoff.acceptanceMaxAgeMs, 0),
      acceptanceAgeMs: quotaHandoff.acceptanceAgeMs === null
        ? null
        : asNonNegativeInteger(quotaHandoff.acceptanceAgeMs, 0),
      acceptanceStale: asBoolean(quotaHandoff.acceptanceStale, false),
      expectedAcceptanceKey: asString(quotaHandoff.expectedAcceptanceKey, ""),
      nextActionId: asString(quotaHandoff.nextActionId, ""),
      retryAfterMs: asNonNegativeInteger(quotaHandoff.retryAfterMs, 0),
      remoteQuota: asRecord(quotaHandoff.remoteQuota),
      violationCodes: asStringArray(quotaHandoff.violationCodes)
    },
    nextActionId: externalReporting.nextActionId,
    nextActionOwner: externalReporting.nextActionOwner,
    nextActionReasonCodes: externalReporting.nextActionReasonCodes,
    operationTokens: uniqueStrings(operationTokens),
    audienceMutation,
    campaignDispatch,
    journeyMutation,
    irreversible,
    exportTags,
    blockingCodes,
    exportReady: matched && reportingState === "export-ready",
    summaryKey: matched
      ? [
          "mailchimp",
          request.boundary.tenantId,
          request.boundary.workspaceId,
          targetKind,
          externalReporting.remoteRequestId || request.id
        ].join(":")
      : ""
  };
}

const DEFAULT_EVIDENCE_REDACTION_FIELDS = [
  "accessToken",
  "apiKey",
  "authorization",
  "cookie",
  "password",
  "secret",
  "sessionToken"
];

function normalizeEvidenceRedactionToken(value) {
  return asString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldRedactEvidenceField(key, redactionFields) {
  const normalizedKey = normalizeEvidenceRedactionToken(key);
  if (!normalizedKey) return false;

  return redactionFields.some((field) => {
    const normalizedField = normalizeEvidenceRedactionToken(field);
    return normalizedField && (
      normalizedKey === normalizedField ||
      normalizedKey.endsWith(normalizedField) ||
      normalizedKey.includes(normalizedField)
    );
  });
}

function redactEvidenceValue(value, redactionFields) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactEvidenceValue(entry, redactionFields));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    shouldRedactEvidenceField(key, redactionFields)
      ? "[REDACTED]"
      : redactEvidenceValue(nested, redactionFields)
  ]));
}

function collectEvidenceRedactionPaths(value, redactionFields, path = []) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectEvidenceRedactionPaths(entry, redactionFields, path.concat(String(index))));
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) => {
    const nextPath = path.concat(key);
    if (shouldRedactEvidenceField(key, redactionFields)) {
      return [nextPath.join(".")];
    }
    return collectEvidenceRedactionPaths(nested, redactionFields, nextPath);
  });
}

function normalizeEvidenceBundle(input = {}) {
  const evidence = Array.isArray(input.evidence)
    ? input.evidence.filter((entry) => entry !== undefined)
    : [];
  const redactionFields = Array.from(new Set([
    ...DEFAULT_EVIDENCE_REDACTION_FIELDS,
    ...asStringArray(input.evidenceRedactionFields ?? input.redactionFields)
  ])).sort();
  const redactionPaths = collectEvidenceRedactionPaths(evidence, redactionFields)
    .map((path) => `evidence.${path}`);

  return {
    contractVersion: `${CONTRACT_VERSION}.evidence-redaction`,
    supplied: evidence.length > 0,
    entryCount: evidence.length,
    redactionFields,
    redactionPaths,
    redactionPathCount: redactionPaths.length,
    redacted: redactEvidenceValue(evidence, redactionFields)
  };
}

function asTimestamp(value, fallback) {
  const normalized = asString(value);
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function asNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function incrementCounter(counters, key, amount = 1) {
  if (!key) return counters;
  return {
    ...counters,
    [key]: asNonNegativeInteger(counters[key], 0) + amount
  };
}

function normalizeCounterMap(value) {
  const counters = asRecord(value);
  return Object.fromEntries(
    Object.entries(counters)
      .map(([key, count]) => [asString(key), asNonNegativeInteger(count, 0)])
      .filter(([key]) => key)
  );
}

function normalizeHistorySnapshot(value, now) {
  const snapshot = asRecord(value);
  const mailchimpOperation = asRecord(snapshot.mailchimpOperation);
  return {
    id: asString(snapshot.id, ""),
    recordedAt: asTimestamp(snapshot.recordedAt ?? snapshot.at, now),
    requestId: asString(snapshot.requestId, ""),
    commandId: asString(snapshot.commandId, ""),
    actor: asString(snapshot.actor, ""),
    status: asString(snapshot.status, "unknown"),
    operation: asString(snapshot.operation, ""),
    targetType: asString(snapshot.targetType, ""),
    route: asString(snapshot.route, ""),
    boundaryKey: asString(snapshot.boundaryKey, ""),
    permissionBoundarySource: asString(snapshot.permissionBoundarySource, ""),
    boundaryDenialCodes: asStringArray(snapshot.boundaryDenialCodes),
    requestWorkspaceExplicit: asBoolean(snapshot.requestWorkspaceExplicit, false),
    requestWorkspaceSource: asString(snapshot.requestWorkspaceSource, ""),
    explicitWorkspaceRequired: asBoolean(snapshot.explicitWorkspaceRequired, false),
    workspaceScopeAmbiguous: asBoolean(snapshot.workspaceScopeAmbiguous, false),
    riskScore: asNonNegativeInteger(snapshot.riskScore, 0),
    requiresApproval: asBoolean(snapshot.requiresApproval, false),
    approved: asBoolean(snapshot.approved, false),
    destructive: asBoolean(snapshot.destructive, false),
    guardedOperation: asBoolean(snapshot.guardedOperation, false),
    deploymentOperation: asBoolean(snapshot.deploymentOperation, false),
    privilegedMutation: asBoolean(snapshot.privilegedMutation, false),
    irreversibleOperation: asBoolean(snapshot.irreversibleOperation, false),
    operationFamily: asString(snapshot.operationFamily, ""),
    riskBand: asString(snapshot.riskBand, "low"),
    operationTokens: asStringArray(snapshot.operationTokens),
    matchedDestructiveOperations: asStringArray(snapshot.matchedDestructiveOperations),
    matchedDeploymentOperations: asStringArray(snapshot.matchedDeploymentOperations),
    matchedPrivilegedMutationOperations: asStringArray(snapshot.matchedPrivilegedMutationOperations),
    matchedIrreversibleOperations: asStringArray(snapshot.matchedIrreversibleOperations),
    guardedOperationClassifications: asStringArray(snapshot.guardedOperationClassifications),
    externalServiceProfile: asString(snapshot.externalServiceProfile, "generic"),
    externalServiceTargetKind: asString(snapshot.externalServiceTargetKind, "generic"),
    externalServiceReportingState: asString(snapshot.externalServiceReportingState, "not-external"),
    externalServiceDispatchMode: asString(snapshot.externalServiceDispatchMode, ""),
    externalServiceSafeToDispatch: asBoolean(snapshot.externalServiceSafeToDispatch, false),
    externalServiceRequiresAcceptance: asBoolean(snapshot.externalServiceRequiresAcceptance, false),
    externalServiceCheckpointRequired: asBoolean(snapshot.externalServiceCheckpointRequired, false),
    externalServicePreviewRequired: asBoolean(snapshot.externalServicePreviewRequired, false),
    externalServiceReplayFenceKey: asString(snapshot.externalServiceReplayFenceKey, ""),
    externalServiceRemoteRequestId: asString(snapshot.externalServiceRemoteRequestId, ""),
    externalServiceIdempotencyKey: asString(snapshot.externalServiceIdempotencyKey, ""),
    externalServiceRemoteHeaderNames: asStringArray(snapshot.externalServiceRemoteHeaderNames),
    externalServiceReportingCodes: asStringArray(snapshot.externalServiceReportingCodes),
    externalServiceNextActionId: asString(snapshot.externalServiceNextActionId, ""),
    mailchimpOperation: {
      contractVersion: asString(mailchimpOperation.contractVersion, `${CONTRACT_VERSION}.mailchimp-operation-analytics`),
      matched: asBoolean(mailchimpOperation.matched, false),
      reportingState: asString(mailchimpOperation.reportingState, "not-mailchimp"),
      targetKind: asString(mailchimpOperation.targetKind, "generic"),
      route: asString(mailchimpOperation.route, ""),
      operation: asString(mailchimpOperation.operation, ""),
      remoteRequestId: asString(mailchimpOperation.remoteRequestId, ""),
      idempotencyKey: asString(mailchimpOperation.idempotencyKey, ""),
      remoteIdempotencyHeaderNames: asStringArray(mailchimpOperation.remoteIdempotencyHeaderNames),
      remoteIdempotencyHeaders: asRecord(mailchimpOperation.remoteIdempotencyHeaders),
      restartSafeKey: asString(mailchimpOperation.restartSafeKey, ""),
      replayFenceKey: asString(mailchimpOperation.replayFenceKey, ""),
      replayWindowMs: asNonNegativeInteger(mailchimpOperation.replayWindowMs, 0),
      checkpointId: asString(mailchimpOperation.checkpointId, ""),
      checkpointRequired: asBoolean(mailchimpOperation.checkpointRequired, false),
      previewRequired: asBoolean(mailchimpOperation.previewRequired, false),
      confirmationRequired: asBoolean(mailchimpOperation.confirmationRequired, false),
      requiresOperatorAcceptance: asBoolean(mailchimpOperation.requiresOperatorAcceptance, false),
      safeToDispatch: asBoolean(mailchimpOperation.safeToDispatch, false),
      dispatchMode: asString(mailchimpOperation.dispatchMode, ""),
      nextActionId: asString(mailchimpOperation.nextActionId, ""),
      nextActionOwner: asString(mailchimpOperation.nextActionOwner, ""),
      nextActionReasonCodes: asStringArray(mailchimpOperation.nextActionReasonCodes),
      operationTokens: asStringArray(mailchimpOperation.operationTokens),
      audienceMutation: asBoolean(mailchimpOperation.audienceMutation, false),
      campaignDispatch: asBoolean(mailchimpOperation.campaignDispatch, false),
      journeyMutation: asBoolean(mailchimpOperation.journeyMutation, false),
      irreversible: asBoolean(mailchimpOperation.irreversible, false),
      exportTags: asStringArray(mailchimpOperation.exportTags),
      blockingCodes: asStringArray(mailchimpOperation.blockingCodes),
      exportReady: asBoolean(mailchimpOperation.exportReady, false),
      summaryKey: asString(mailchimpOperation.summaryKey, "")
    },
    dryRun: asBoolean(snapshot.dryRun, false),
    gateMode: asString(snapshot.gateMode, ""),
    executable: asBoolean(snapshot.executable, false),
    sideEffectsPermitted: asBoolean(snapshot.sideEffectsPermitted, false),
    approvalSlaDueAt: asTimestamp(snapshot.approvalSlaDueAt, ""),
    approvalSlaMs: asNonNegativeInteger(snapshot.approvalSlaMs, 0),
    approvalSlaBreached: asBoolean(snapshot.approvalSlaBreached, false),
    leaseExpiresAt: asTimestamp(snapshot.leaseExpiresAt, ""),
    leaseExpiresSoon: asBoolean(snapshot.leaseExpiresSoon, false),
    blockerCodes: asStringArray(snapshot.blockerCodes),
    validationCodes: asStringArray(snapshot.validationCodes),
    exportHealthCodes: asStringArray(snapshot.exportHealthCodes),
    nextActionType: asString(snapshot.nextActionType, ""),
    proofFingerprint: asString(snapshot.proofFingerprint, "")
  };
}

function normalizePersistedAnalytics(value, now) {
  const analytics = asRecord(value);
  const historyLimit = clampInteger(
    analytics.historyLimit,
    5,
    DEFAULT_LEDGER_LIMIT,
    DEFAULT_HISTORY_LIMIT
  );
  const rawHistory = Array.isArray(analytics.history) ? analytics.history : [];
  return {
    contractVersion: asString(analytics.contractVersion, `${CONTRACT_VERSION}.analytics`),
    updatedAt: asTimestamp(analytics.updatedAt, ""),
    historyLimit,
    counters: normalizeCounterMap(analytics.counters),
    statusCounts: normalizeCounterMap(analytics.statusCounts),
    operationCounts: normalizeCounterMap(analytics.operationCounts),
    targetTypeCounts: normalizeCounterMap(analytics.targetTypeCounts),
    actorCounts: normalizeCounterMap(analytics.actorCounts),
    history: rawHistory
      .map((entry) => normalizeHistorySnapshot(entry, now))
      .filter((entry) => entry.id)
      .slice(-historyLimit)
  };
}

function clampInteger(value, min, max, fallback) {
  const numeric = asNonNegativeInteger(value, fallback);
  return Math.min(max, Math.max(min, numeric));
}

function firstScopedString(sources, keys) {
  for (const source of sources) {
    const scope = asRecord(source.scope);
    for (const key of keys) {
      const value = asString(scope[key]);
      if (value) {
        return {
          value,
          key,
          source: source.source
        };
      }
    }
  }
  return {
    value: "",
    key: "",
    source: "default"
  };
}

function normalizeBoundaryContext(input, source = {}) {
  const boundary = asRecord(source.boundary ?? source.scope ?? source.context);
  const tenant = firstScopedString(
    [
      { source: "boundary", scope: boundary },
      { source: "source", scope: source },
      { source: "input", scope: input }
    ],
    ["tenantId", "tenant"]
  );
  const workspace = firstScopedString(
    [
      { source: "boundary", scope: boundary },
      { source: "source", scope: source },
      { source: "input", scope: input }
    ],
    ["workspaceId", "workspace"]
  );
  return {
    tenantId: tenant.value || "default-tenant",
    workspaceId: workspace.value || "default-workspace",
    tenantExplicit: Boolean(tenant.value),
    workspaceExplicit: Boolean(workspace.value),
    tenantSource: tenant.source,
    workspaceSource: workspace.source,
    tenantField: tenant.key,
    workspaceField: workspace.key
  };
}

function normalizeRolePermissions(input, client) {
  const roles = asStringArray(client.roles ?? input.roles).map((role) => role.toLowerCase());
  const explicitPermissions = asStringArray(client.permissions ?? input.permissions);
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSION_GRANTS[role] ?? []);
  return {
    roles,
    permissions: Array.from(new Set([...explicitPermissions, ...rolePermissions]))
  };
}

function normalizeWorkspaceGrantMap(value) {
  const grants = asRecord(value);
  return Object.fromEntries(
    Object.entries(grants)
      .map(([tenantId, workspaceIds]) => [asString(tenantId), asStringArray(workspaceIds)])
      .filter(([tenantId, workspaceIds]) => tenantId && workspaceIds.length)
  );
}

function normalizePermissionBoundary(input, client, clientBoundary) {
  const policy = asRecord(
    client.permissionBoundary ??
      client.boundaryPolicy ??
      client.accessBoundary ??
      input.permissionBoundary ??
      input.boundaryPolicy
  );
  const scopedTenants = asStringArray(policy.tenantIds ?? policy.allowedTenantIds ?? client.allowedTenantIds);
  const scopedWorkspaces = asStringArray(
    policy.workspaceIds ?? policy.allowedWorkspaceIds ?? client.allowedWorkspaceIds
  );
  const workspaceGrants = normalizeWorkspaceGrantMap(
    policy.workspaceGrants ?? policy.tenantWorkspaceGrants ?? client.workspaceGrants
  );
  const hasTenantScope = scopedTenants.length > 0;
  const hasWorkspaceScope = scopedWorkspaces.length > 0 || Object.keys(workspaceGrants).length > 0;
  return {
    contractVersion: `${CONTRACT_VERSION}.permission-boundary`,
    clientTenantId: clientBoundary.tenantId,
    clientWorkspaceId: clientBoundary.workspaceId,
    allowedTenantIds: scopedTenants,
    allowedWorkspaceIds: scopedWorkspaces,
    workspaceGrants,
    tenantRestricted: hasTenantScope,
    workspaceRestricted: hasWorkspaceScope,
    allowAllTenants: asBoolean(policy.allowAllTenants ?? client.allowAllTenants, !hasTenantScope),
    allowAllWorkspaces: asBoolean(
      policy.allowAllWorkspaces ?? client.allowAllWorkspaces,
      !hasWorkspaceScope
    ),
    allowTenantWideActions: asBoolean(policy.allowTenantWideActions ?? policy.allowTenantWide, false),
    requireExplicitWorkspaceGrant: asBoolean(policy.requireExplicitWorkspaceGrant, hasWorkspaceScope),
    source: hasTenantScope || hasWorkspaceScope ? "client_permission_boundary" : "default_client_boundary"
  };
}

function boundaryKey(boundary) {
  return `${boundary.tenantId}:${boundary.workspaceId}`;
}

function buildBoundaryAuditShape(boundaryDecision) {
  return {
    request: boundaryDecision.requestBoundary,
    client: boundaryDecision.clientBoundary,
    permissionBoundary: boundaryDecision.permissionBoundary,
    key: boundaryKey(boundaryDecision.requestBoundary),
    clientKey: boundaryKey(boundaryDecision.clientBoundary),
    denied: boundaryDecision.denied,
    denialCodes: boundaryDecision.denialCodes,
    tenantMatches: boundaryDecision.tenantMatches,
    workspaceMatches: boundaryDecision.workspaceMatches,
    tenantWide: boundaryDecision.tenantWide,
    tenantExplicitlyAllowed: boundaryDecision.tenantExplicitlyAllowed,
    workspaceExplicitlyAllowed: boundaryDecision.workspaceExplicitlyAllowed,
    requestTenantExplicit: Boolean(boundaryDecision.requestBoundary.tenantExplicit),
    requestWorkspaceExplicit: Boolean(boundaryDecision.requestBoundary.workspaceExplicit),
    requestTenantSource: boundaryDecision.requestBoundary.tenantSource,
    requestWorkspaceSource: boundaryDecision.requestBoundary.workspaceSource,
    clientTenantSource: boundaryDecision.clientBoundary.tenantSource,
    clientWorkspaceSource: boundaryDecision.clientBoundary.workspaceSource,
    explicitWorkspaceRequired: boundaryDecision.explicitWorkspaceRequired,
    workspaceScopeAmbiguous: boundaryDecision.workspaceScopeAmbiguous,
    workspaceScope: boundaryDecision.workspaceScope
  };
}

function normalizeGuardCommand(input) {
  const command = asRecord(input.command ?? input.guardCommand);
  const type = asString(command.type ?? input.commandType, "evaluate").toLowerCase();
  const id = asString(command.id ?? command.commandId ?? input.commandId, "");
  const replayOf = asString(command.replayOf ?? input.replayOf, "");
  return {
    id,
    type,
    replayOf,
    requestedBy: asString(command.requestedBy ?? input.requestedBy, "")
  };
}

function normalizeRetryState(input, now) {
  const retry = asRecord(input.retry ?? input.retryState ?? input.failureState?.retry);
  const failure = asRecord(input.failure ?? input.failureState);
  const attempts = asNonNegativeInteger(retry.attempts ?? retry.attemptCount ?? failure.attempts, 0);
  const maxAttempts = asNonNegativeInteger(
    retry.maxAttempts ?? input.maxRetryAttempts,
    DEFAULT_RETRY_MAX_ATTEMPTS
  );
  const baseDelayMs = Math.max(
    DEFAULT_RETRY_BASE_DELAY_MS,
    asNonNegativeInteger(retry.baseDelayMs ?? input.retryBaseDelayMs, DEFAULT_RETRY_BASE_DELAY_MS)
  );
  const maxDelayMs = Math.max(
    baseDelayMs,
    asNonNegativeInteger(retry.maxDelayMs ?? input.retryMaxDelayMs, DEFAULT_RETRY_MAX_DELAY_MS)
  );
  return {
    attempts,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    lastErrorCode: asString(failure.code ?? failure.lastErrorCode ?? retry.lastErrorCode, ""),
    lastFailedAt: asTimestamp(failure.at ?? failure.lastFailedAt ?? retry.lastFailedAt, ""),
    observedAt: now
  };
}

function normalizeProviderHealth(input, provider, now) {
  const health = asRecord(provider.health ?? provider.operationalHealth ?? input.providerHealth);
  const rawStatus = asString(health.status ?? provider.status, "healthy").toLowerCase();
  const status = PROVIDER_DOWN_STATUSES.has(rawStatus)
    ? "unavailable"
    : PROVIDER_DEGRADED_STATUSES.has(rawStatus)
      ? "degraded"
      : PROVIDER_READY_STATUSES.has(rawStatus)
        ? "healthy"
        : "unknown";
  const lastHeartbeatAt = asTimestamp(
    health.lastHeartbeatAt ?? health.heartbeatAt ?? provider.lastHeartbeatAt,
    now
  );
  const heartbeatStaleAfterMs = Math.max(
    DEFAULT_PROVIDER_HEARTBEAT_STALE_MS,
    asNonNegativeInteger(
      health.heartbeatStaleAfterMs ?? input.providerHeartbeatStaleAfterMs,
      DEFAULT_PROVIDER_HEARTBEAT_STALE_MS
    )
  );
  const observedMs = Date.parse(now);
  const heartbeatMs = Date.parse(lastHeartbeatAt);
  const heartbeatAgeMs =
    Number.isFinite(observedMs) && Number.isFinite(heartbeatMs)
      ? Math.max(0, observedMs - heartbeatMs)
      : 0;
  const stale = heartbeatAgeMs > heartbeatStaleAfterMs;
  const endpointErrors = asStringArray(
    health.endpointErrors ?? health.errors ?? provider.endpointErrors
  );
  const ready = status === "healthy" && !stale && endpointErrors.length === 0;
  return {
    contractVersion: `${PROVIDER_CONTRACT_VERSION}.health`,
    status,
    ready,
    degraded: status === "degraded" || stale || endpointErrors.length > 0,
    lastHeartbeatAt,
    heartbeatAgeMs,
    heartbeatStaleAfterMs,
    stale,
    endpointErrors,
    lastErrorCode: asString(health.lastErrorCode ?? health.errorCode ?? provider.lastErrorCode, ""),
    message: asString(health.message ?? provider.statusMessage, ""),
    observedAt: now
  };
}

function normalizeProviderEndpointContract(provider, service, now) {
  const overrides = asRecord(
    provider.endpoints ??
      provider.serviceEndpoints ??
      provider.providerEndpoints ??
      service.endpoints ??
      service.routes
  );
  const entries = Object.entries(PROVIDER_SERVICE_ENDPOINTS).map(([type, defaultEndpoint]) => {
    const suppliedEndpoint = asString(
      overrides[type] ??
        overrides[`${type}Endpoint`] ??
        overrides[`${type}Url`] ??
        overrides[`${type}Route`]
    );
    const effectiveEndpoint = suppliedEndpoint || defaultEndpoint;
    const valid = effectiveEndpoint.startsWith("/");
    const source = suppliedEndpoint ? "provider_override" : "kernel_default";
    return [
      type,
      {
        type,
        defaultEndpoint,
        endpoint: valid ? effectiveEndpoint : "",
        suppliedEndpoint,
        source,
        valid,
        required: PROVIDER_REQUIRED_ENDPOINT_TYPES.includes(type),
        capability:
          type === "handoff"
            ? "guard.workflow.handoff"
            : type === "approval"
              ? "guard.approval.request"
              : type === "checkpoint"
                ? "guard.state.checkpoint"
                : type === "audit"
                  ? "guard.audit.write"
                  : "guard.decision.read",
        validationCode: valid ? "" : `provider_${type}_endpoint_invalid`
      }
    ];
  });
  const endpoints = Object.fromEntries(entries);
  const invalidTypes = Object.values(endpoints)
    .filter((endpoint) => !endpoint.valid)
    .map((endpoint) => endpoint.type);
  const invalidRequiredTypes = Object.values(endpoints)
    .filter((endpoint) => endpoint.required && !endpoint.valid)
    .map((endpoint) => endpoint.type);
  return {
    contractVersion: `${PROVIDER_CONTRACT_VERSION}.endpoints`,
    generatedAt: now,
    endpoints,
    effective: Object.fromEntries(
      Object.entries(endpoints).map(([type, endpoint]) => [
        type,
        endpoint.endpoint
      ])
    ),
    invalidTypes,
    invalidRequiredTypes,
    overrideTypes: Object.values(endpoints)
      .filter((endpoint) => endpoint.source === "provider_override")
      .map((endpoint) => endpoint.type),
    ready: invalidRequiredTypes.length === 0
  };
}

function normalizeProviderState(input, now) {
  const provider = asRecord(input.provider ?? input.integrationProvider ?? input.serviceProvider);
  const service = asRecord(provider.service ?? provider.kernelService);
  const sync = asRecord(provider.sync ?? provider.syncState ?? input.syncState);
  const rawCapabilities = asStringArray(provider.capabilities ?? provider.negotiatedCapabilities);
  const capabilities = rawCapabilities.length
    ? rawCapabilities
    : [...REQUIRED_PROVIDER_CAPABILITIES, "guard.execution.lease", "guard.workflow.handoff"];
  return {
    id: asString(provider.id ?? provider.providerId, "hosted-kernel"),
    name: asString(provider.name, "Hosted Kernel Guard Provider"),
    serviceId: asString(service.id ?? provider.serviceId, "destructive-action-guard"),
    serviceVersion: asString(service.version ?? provider.serviceVersion, PROVIDER_CONTRACT_VERSION),
    route: asString(service.route ?? provider.route, "hosted-kernel"),
    capabilities: Array.from(new Set(capabilities)),
    health: normalizeProviderHealth(input, provider, now),
    endpoints: normalizeProviderEndpointContract(provider, service, now),
    sync: {
      cursor: asString(sync.cursor ?? sync.resumeCursor, ""),
      sequence: asNonNegativeInteger(sync.sequence ?? sync.seq, 0),
      checkpointId: asString(sync.checkpointId ?? sync.lastCheckpointId, ""),
      lastSyncedAt: asTimestamp(sync.lastSyncedAt ?? sync.syncedAt, ""),
      externalHandoffId: asString(sync.externalHandoffId ?? sync.handoffId, ""),
      dirty: asBoolean(sync.dirty ?? sync.hasLocalChanges, false),
      observedAt: now
    }
  };
}

function negotiateProviderCapabilities(providerState, command) {
  const advertised = new Set(providerState.capabilities);
  const missingRequired = REQUIRED_PROVIDER_CAPABILITIES.filter((capability) => !advertised.has(capability));
  const optionalGranted = OPTIONAL_PROVIDER_CAPABILITIES.filter((capability) => advertised.has(capability));
  const commandRequired = command.type === "execute"
    ? "guard.execution.lease"
    : command.type === "approve"
      ? "guard.approval.request"
      : LIFECYCLE_COMMAND_TYPES.has(command.type)
        ? "guard.state.checkpoint"
        : "guard.decision.read";
  const commandSupported =
    REQUIRED_PROVIDER_CAPABILITIES.includes(commandRequired) || advertised.has(commandRequired);
  return {
    advertised: providerState.capabilities,
    required: REQUIRED_PROVIDER_CAPABILITIES,
    optionalGranted,
    missingRequired,
    commandRequired,
    commandSupported,
    fullyNegotiated: missingRequired.length === 0 && commandSupported
  };
}

function buildPreviewId(request) {
  return `${CONTRACT_VERSION}:preview:${request.id}`;
}

function buildCommandId(request, command) {
  return command.id || `${request.id}:${command.type}`;
}

function buildConfirmationPhrase(request) {
  return `CONFIRM ${request.operation || "ACTION"} ${request.targetType}:${request.target}`;
}

function buildAcceptanceBinding(request) {
  const classification = classifyGuardedOperation(request);
  return {
    contractVersion: `${CONTRACT_VERSION}.acceptance-binding`,
    requestId: request.id,
    previewId: buildPreviewId(request),
    operation: request.operation,
    operationFamily: classification.operationFamily,
    operationTokens: classification.operationTokens,
    target: request.target,
    targetType: request.targetType,
    route: request.route,
    boundary: request.boundary,
    dryRun: request.dryRun,
    guardedOperationClassifications: classification.classifications,
    matchedOperations: classification.matchedOperations,
    externalOperation: {
      profile: request.externalOperation.profile,
      matched: request.externalOperation.matched,
      targetKind: request.externalOperation.targetKind,
      remoteRequestId: request.externalOperation.remoteRequestId,
      idempotencyKey: request.externalOperation.idempotencyKey,
      restartSafeKey: request.externalOperation.restartSafeKey,
      requiresApproval: request.externalOperation.requiresApproval
    }
  };
}

function buildAcceptanceBindingFingerprint(binding) {
  return buildProofFingerprint({
    contractVersion: binding.contractVersion,
    requestId: binding.requestId,
    previewId: binding.previewId,
    operation: binding.operation,
    operationFamily: binding.operationFamily,
    operationTokens: binding.operationTokens,
    target: binding.target,
    targetType: binding.targetType,
    route: binding.route,
    boundary: binding.boundary,
    dryRun: binding.dryRun,
    guardedOperationClassifications: binding.guardedOperationClassifications,
    matchedOperations: binding.matchedOperations,
    externalOperation: binding.externalOperation
  });
}

function buildOperationBindingDetails(value) {
  const raw = asString(value).toLowerCase();
  const tokens = splitGuardIdentifier(raw).map(canonicalizeOperationToken);
  const canonicalTokens = uniqueStrings(tokens);
  return {
    raw,
    canonical: canonicalTokens[0] || raw,
    tokens: canonicalTokens,
    supplied: Boolean(raw)
  };
}

function compareAcceptanceOperationBinding(submittedOperation, expectedBinding) {
  const submitted = buildOperationBindingDetails(submittedOperation);
  const expectedTokens = expectedBinding.operationTokens?.length
    ? uniqueStrings(expectedBinding.operationTokens.map(canonicalizeOperationToken))
    : buildOperationBindingDetails(expectedBinding.operation).tokens;
  const expected = {
    raw: asString(expectedBinding.operation).toLowerCase(),
    canonical: expectedTokens[0] || asString(expectedBinding.operation).toLowerCase(),
    tokens: expectedTokens,
    supplied: Boolean(expectedBinding.operation)
  };
  const overlappingTokens = submitted.tokens.filter((token) => expected.tokens.includes(token));
  const exactRawMatch = submitted.raw && submitted.raw === expected.raw;
  const canonicalMatch = overlappingTokens.length > 0;
  return {
    expected,
    submitted,
    exactRawMatch,
    canonicalMatch,
    overlappingTokens,
    equivalent: !submitted.supplied || exactRawMatch || canonicalMatch,
    mismatchCode:
      submitted.supplied && !exactRawMatch && !canonicalMatch
        ? "operation_mismatch"
        : ""
  };
}

function buildAcceptanceBindingCheck(acceptance, expectedBinding) {
  const expectedFingerprint = buildAcceptanceBindingFingerprint(expectedBinding);
  const submittedFingerprint = asString(
    acceptance.bindingFingerprint ?? acceptance.proofFingerprint ?? acceptance.previewFingerprint
  );
  const submittedPreviewId = asString(acceptance.previewId);
  const submittedRequestId = asString(acceptance.requestId);
  const submittedRoute = asString(acceptance.route);
  const submittedOperation = asString(acceptance.operation).toLowerCase();
  const submittedTarget = asString(acceptance.target);
  const submittedTargetType = asString(acceptance.targetType);
  const submittedBoundary = normalizeBoundaryContext({}, acceptance);
  const operationComparison = compareAcceptanceOperationBinding(submittedOperation, expectedBinding);
  const providedFields = [
    submittedPreviewId ? "previewId" : "",
    submittedRequestId ? "requestId" : "",
    submittedFingerprint ? "bindingFingerprint" : "",
    submittedRoute ? "route" : "",
    submittedOperation ? "operation" : "",
    submittedTarget ? "target" : "",
    submittedTargetType ? "targetType" : "",
    acceptance.boundary || acceptance.tenantId || acceptance.workspaceId ? "boundary" : ""
  ].filter(Boolean);
  const mismatchCodes = [
    submittedPreviewId && submittedPreviewId !== expectedBinding.previewId ? "preview_id_mismatch" : "",
    submittedRequestId && submittedRequestId !== expectedBinding.requestId ? "request_id_mismatch" : "",
    submittedFingerprint && submittedFingerprint !== expectedFingerprint ? "binding_fingerprint_mismatch" : "",
    submittedRoute && submittedRoute !== expectedBinding.route ? "route_mismatch" : "",
    operationComparison.mismatchCode,
    submittedTarget && submittedTarget !== expectedBinding.target ? "target_mismatch" : "",
    submittedTargetType && submittedTargetType !== expectedBinding.targetType ? "target_type_mismatch" : "",
    providedFields.includes("boundary") && boundaryKey(submittedBoundary) !== boundaryKey(expectedBinding.boundary)
      ? "boundary_mismatch"
      : ""
  ].filter(Boolean);
  const requiredFieldCodes = [
    submittedPreviewId ? "" : "preview_id_required",
    submittedRequestId ? "" : "request_id_required",
    submittedFingerprint ? "" : "binding_fingerprint_required"
  ].filter(Boolean);
  return {
    expectedBinding,
    expectedFingerprint,
    submittedFingerprint,
    submittedPreviewId,
    submittedRequestId,
    submittedBoundary,
    submittedOperation,
    submittedOperationTokens: operationComparison.submitted.tokens,
    expectedOperationTokens: operationComparison.expected.tokens,
    operationComparison,
    providedFields,
    requiredFieldCodes,
    mismatchCodes,
    complete: requiredFieldCodes.length === 0,
    matches: requiredFieldCodes.length === 0 && mismatchCodes.length === 0
  };
}

function normalizePreviewAcceptance(input, request, now) {
  const acceptance = asRecord(
    input.previewAcceptance ?? input.acceptance ?? input.userAcceptance ?? input.confirmation
  );
  const confirmationText = asString(
    acceptance.confirmationText ?? acceptance.confirmText ?? acceptance.phrase
  );
  const expectedConfirmationText = buildConfirmationPhrase(request);
  const binding = buildAcceptanceBindingCheck(acceptance, buildAcceptanceBinding(request));
  return {
    previewId: asString(acceptance.previewId, buildPreviewId(request)),
    accepted: asBoolean(acceptance.accepted ?? acceptance.confirmed, false),
    acceptedAt: asTimestamp(acceptance.acceptedAt, now),
    acceptedBy: asString(acceptance.acceptedBy ?? acceptance.actor, ""),
    confirmationText,
    expectedConfirmationText,
    confirmationMatches: confirmationText === expectedConfirmationText,
    requestId: binding.submittedRequestId,
    binding,
    bindingFingerprint: binding.submittedFingerprint,
    expectedBindingFingerprint: binding.expectedFingerprint,
    bindingComplete: binding.complete,
    bindingMatches: binding.matches,
    acknowledgedRiskCodes: asStringArray(
      acceptance.acknowledgedRiskCodes ?? acceptance.acknowledgedRisks ?? acceptance.riskCodes
    ),
    clientNonce: asString(acceptance.clientNonce ?? acceptance.nonce, ""),
    comment: asString(acceptance.comment ?? acceptance.reason, "")
  };
}

function buildRequiredAcknowledgementCodes(request, clientState) {
  const signals = buildRiskSignals(request, clientState);
  return [
    signals.guardedOperation ? "guarded_operation" : "",
    signals.destructiveOperation ? "destructive_operation" : "",
    signals.deploymentOperation ? "deployment_operation" : "",
    signals.privilegedMutation ? "privileged_mutation" : "",
    signals.irreversibleOperation ? "irreversible_operation" : "",
    signals.sensitiveTarget ? "sensitive_target" : "",
    signals.broadScope ? "broad_scope" : "",
    signals.lacksCapability ? "missing_execute_permission" : "",
    signals.boundary.tenantScopeDenied ? "tenant_not_in_permission_boundary" : "",
    signals.boundary.workspaceScopeDenied ? "workspace_not_in_permission_boundary" : "",
    signals.boundary.crossTenantDenied ? "cross_tenant_boundary" : "",
    signals.boundary.crossWorkspaceDenied ? "cross_workspace_boundary" : "",
    signals.boundary.tenantWideDenied ? "tenant_wide_boundary" : "",
    signals.boundary.workspaceScopeAmbiguous ? "explicit_workspace_scope_required" : "",
    request.externalOperation.requiresApproval ? request.externalOperation.approvalReasonCode : "",
    request.dryRun && signals.guardedOperation ? "dry_run_only" : ""
  ].filter(Boolean);
}

function buildAcknowledgementState(requiredCodes, previewAcceptance) {
  const acknowledgedCodes = new Set(previewAcceptance.acknowledgedRiskCodes);
  const missingCodes = requiredCodes.filter((code) => !acknowledgedCodes.has(code));
  const unexpectedCodes = previewAcceptance.acknowledgedRiskCodes.filter(
    (code) => !requiredCodes.includes(code)
  );
  return {
    requiredCodes,
    acknowledgedCodes: previewAcceptance.acknowledgedRiskCodes,
    missingCodes,
    unexpectedCodes,
    complete: missingCodes.length === 0
  };
}

function handoffIsExpired(handoff, nowMs) {
  const expiresAtMs = Date.parse(handoff.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

function handoffMatchesCurrentRequest(handoff, request, commandId) {
  if (handoff.requestId && handoff.requestId !== request.id) return false;
  if (handoff.commandId && handoff.commandId !== commandId) return false;
  return Boolean(handoff.requestId || handoff.commandId);
}

function summarizeHandoffForClientRuntime(handoff, nowMs) {
  const terminal = TERMINAL_HANDOFF_STATUSES.has(handoff.status);
  const expired = !terminal && handoffIsExpired(handoff, nowMs);
  return {
    id: handoff.id,
    requestId: handoff.requestId,
    commandId: handoff.commandId,
    status: handoff.status,
    terminal,
    expired,
    route: handoff.route,
    assignedTo: handoff.assignedTo,
    primaryAction: handoff.primaryAction,
    proofFingerprint: handoff.proofFingerprint,
    expiresAt: handoff.expiresAt
  };
}

function buildClientHandoffReconciliation({ clientState, request, command, nowMs }) {
  const runtime = clientState.guardRuntime;
  const commandId = buildCommandId(request, command);
  const currentHandoffs = runtime.handoffs.filter((handoff) =>
    handoffMatchesCurrentRequest(handoff, request, commandId)
  );
  const currentReceipts = runtime.handoffReceipts.filter((receipt) => {
    if (receipt.requestId && receipt.requestId !== request.id) return false;
    if (receipt.commandId && receipt.commandId !== commandId) return false;
    if (receipt.handoffId) return currentHandoffs.some((handoff) => receipt.handoffId === handoff.id);
    return Boolean(receipt.requestId || receipt.commandId);
  });
  const receiptMatchedHandoffIds = new Set(
    currentReceipts
      .map((receipt) =>
        currentHandoffs.find((handoff) => handoffReceiptMatches(receipt, handoff, request, commandId))?.id
      )
      .filter(Boolean)
  );
  const orphanReceipts = currentReceipts.filter(
    (receipt) =>
      !currentHandoffs.some((handoff) => handoffReceiptMatches(receipt, handoff, request, commandId))
  );
  const pendingHandoffs = currentHandoffs.filter(
    (handoff) => handoff.status === "pending" && !handoffIsExpired(handoff, nowMs)
  );
  const expiredHandoffs = currentHandoffs.filter((handoff) => handoffIsExpired(handoff, nowMs));
  const terminalHandoffs = currentHandoffs.filter((handoff) =>
    TERMINAL_HANDOFF_STATUSES.has(handoff.status)
  );
  const activeHandoff = runtime.activeHandoffId
    ? runtime.handoffs.find((handoff) => handoff.id === runtime.activeHandoffId) ?? null
    : null;
  const activeHandoffProblem = !runtime.activeHandoffId
    ? ""
    : !activeHandoff
      ? "active_handoff_missing"
      : TERMINAL_HANDOFF_STATUSES.has(activeHandoff.status)
        ? "active_handoff_terminal"
        : handoffIsExpired(activeHandoff, nowMs)
          ? "active_handoff_expired"
          : "";
  const continuityCodes = [
    activeHandoffProblem,
    orphanReceipts.length ? "handoff_receipt_without_matching_handoff" : "",
    expiredHandoffs.length ? "expired_handoff_in_inbox" : "",
    command.type === "approve" && currentHandoffs.length === 0 ? "approve_without_handoff_context" : "",
    pendingHandoffs.length > 1 ? "multiple_pending_handoffs_for_request" : ""
  ].filter(Boolean);
  return {
    contractVersion: `${CONTRACT_VERSION}.client-handoff-reconciliation`,
    generatedAtMs: nowMs,
    requestId: request.id,
    commandId,
    activeHandoffId: runtime.activeHandoffId,
    activeHandoffStatus: activeHandoff?.status || "",
    activeHandoffProblem,
    currentHandoffCount: currentHandoffs.length,
    pendingHandoffCount: pendingHandoffs.length,
    terminalHandoffCount: terminalHandoffs.length,
    expiredHandoffCount: expiredHandoffs.length,
    receiptCount: currentReceipts.length,
    matchedReceiptCount: receiptMatchedHandoffIds.size,
    orphanReceiptCount: orphanReceipts.length,
    continuityCodes,
    workflowContinuityHealthy: continuityCodes.length === 0,
    pendingHandoffs: pendingHandoffs.map((handoff) => summarizeHandoffForClientRuntime(handoff, nowMs)),
    terminalHandoffs: terminalHandoffs.map((handoff) => summarizeHandoffForClientRuntime(handoff, nowMs)),
    expiredHandoffIds: expiredHandoffs.map((handoff) => handoff.id),
    orphanReceipts: orphanReceipts.map((receipt) => ({
      id: receipt.id,
      handoffId: receipt.handoffId,
      requestId: receipt.requestId,
      commandId: receipt.commandId,
      action: receipt.action,
      actor: receipt.actor,
      acknowledgedAt: receipt.acknowledgedAt,
      outboxCursor: receipt.outboxCursor
    }))
  };
}

function normalizeRequest(input) {
  const request = asRecord(input.request ?? input.action ?? input.intent);
  const operation = asString(request.operation ?? request.verb ?? input.operation).toLowerCase();
  const target = asString(request.target ?? request.resource ?? input.target, "unknown");
  const targetType = asString(request.targetType ?? request.domain ?? input.targetType, "resource");
  const route = asString(request.route ?? input.route, "hosted-kernel");
  const args = asRecord(request.args ?? request.parameters ?? input.args);
  const dryRun = Boolean(request.dryRun ?? input.dryRun);
  const id = asString(request.id ?? input.requestId, `${operation || "request"}:${targetType}:${target}`);
  const boundary = normalizeBoundaryContext(input, request);
  const normalized = { id, operation, target, targetType, route, args, dryRun, boundary };
  return {
    ...normalized,
    externalOperation: buildExternalServiceOperation(input, normalized)
  };
}

function normalizeApprovalEntry(value, now) {
  const approval = asRecord(value);
  return {
    granted: Boolean(approval.granted),
    grantedAt: asTimestamp(approval.grantedAt, now),
    expiresAt: asTimestamp(approval.expiresAt, ""),
    actor: asString(approval.actor ?? approval.grantedBy, "unknown-actor"),
    requestId: asString(approval.requestId ?? approval.id, ""),
    recoverySource: asString(approval.recoverySource, ""),
    boundary: normalizeBoundaryContext({}, approval)
  };
}

function normalizePersistedCommandEntry(value, key, now) {
  const command = asRecord(value);
  const rawStatus = asString(command.status, "unknown").toLowerCase();
  const status = [
    ...TERMINAL_COMMAND_STATUSES,
    ...ACTIVE_COMMAND_STATUSES,
    ...RECOVERY_COMMAND_STATUSES,
    "unknown"
  ].includes(rawStatus)
    ? rawStatus
    : "unknown";
  const commandId = asString(command.commandId ?? key, key);
  const requestId = asString(command.requestId, "");
  const terminal = TERMINAL_COMMAND_STATUSES.has(status);
  const active = ACTIVE_COMMAND_STATUSES.has(status);
  const recoveryRequired = RECOVERY_COMMAND_STATUSES.has(status);
  return {
    status,
    statusSource: rawStatus === status ? "persisted" : "normalized_unknown",
    requestId,
    commandId,
    commandType: asString(command.commandType ?? command.type, ""),
    idempotencyKey: asString(command.idempotencyKey ?? command.idempotencyToken, commandId),
    resultStatus: asString(command.resultStatus, ""),
    phase: asString(
      command.phase,
      terminal ? "terminal" : active ? "active" : recoveryRequired ? "recovery" : "unknown"
    ),
    startedAt: asTimestamp(command.startedAt ?? command.createdAt, ""),
    lastSeenAt: asTimestamp(command.lastSeenAt ?? command.updatedAt ?? command.completedAt, ""),
    completedAt: asTimestamp(command.completedAt, ""),
    expiresAt: asTimestamp(command.expiresAt, ""),
    actor: asString(command.actor, ""),
    leaseToken: asString(command.leaseToken, ""),
    proofFingerprint: asString(command.proofFingerprint, ""),
    resumeToken: asString(
      command.resumeToken,
      requestId || commandId ? commandRecoveryResumeToken(requestId, commandId) : ""
    ),
    recoveryStatus: asString(
      command.recoveryStatus,
      terminal ? "checkpointed" : recoveryRequired ? "restart_recovery_required" : ""
    ),
    recoveryReason: asString(command.recoveryReason, ""),
    attempts: asNonNegativeInteger(command.attempts, 0),
    recoveredAt: asTimestamp(command.recoveredAt, ""),
    terminal,
    active,
    recoveryRequired,
    restartSafe: terminal || recoveryRequired
  };
}

function normalizeClientState(input) {
  const client = asRecord(input.clientState ?? input.client ?? input.session);
  const approvals = asRecord(client.approvals);
  const rolePermissions = normalizeRolePermissions(input, client);
  const boundary = normalizeBoundaryContext(input, client);
  return {
    id: asString(client.id ?? client.clientId ?? input.clientId, "anonymous-client"),
    actor: asString(client.actor ?? client.user ?? input.actor, "unknown-actor"),
    capabilities: asStringArray(client.capabilities ?? input.capabilities),
    roles: rolePermissions.roles,
    permissions: rolePermissions.permissions,
    approvalMode: asString(client.approvalMode ?? input.approvalMode, "explicit"),
    approvals,
    boundary,
    permissionBoundary: normalizePermissionBoundary(input, client, boundary),
    guardRuntime: normalizeClientGuardRuntime(client, input)
  };
}

function normalizeClientHandoffEntry(value) {
  const handoff = asRecord(value);
  return {
    id: asString(handoff.id ?? handoff.handoffId, ""),
    requestId: asString(handoff.requestId, ""),
    commandId: asString(handoff.commandId, ""),
    status: asString(handoff.status, "pending"),
    type: asString(handoff.type, "destructive_action_confirmation"),
    reason: asString(handoff.reason, ""),
    route: asString(handoff.route, "hosted-kernel"),
    assignedTo: asString(handoff.assignedTo ?? handoff.actor, ""),
    createdAt: asTimestamp(handoff.createdAt ?? handoff.at, ""),
    expiresAt: asTimestamp(handoff.expiresAt, ""),
    previewId: asString(handoff.previewId, ""),
    proofFingerprint: asString(handoff.proofFingerprint, ""),
    acknowledgedAt: asTimestamp(handoff.acknowledgedAt, ""),
    acknowledgedBy: asString(handoff.acknowledgedBy ?? handoff.receiptActor, ""),
    primaryAction: asString(handoff.primaryAction ?? handoff.action, ""),
    clientNonce: asString(handoff.clientNonce ?? handoff.nonce, "")
  };
}

function normalizeClientHandoffReceipt(value) {
  const receipt = asRecord(value);
  const action = asString(receipt.action ?? receipt.type, "acknowledge").toLowerCase();
  return {
    id: asString(receipt.id ?? receipt.receiptId, ""),
    handoffId: asString(receipt.handoffId ?? receipt.id, ""),
    requestId: asString(receipt.requestId, ""),
    commandId: asString(receipt.commandId, ""),
    action: ["acknowledge", "complete", "dismiss", "cancel"].includes(action) ? action : "acknowledge",
    actor: asString(receipt.actor ?? receipt.acknowledgedBy, ""),
    acknowledgedAt: asTimestamp(receipt.acknowledgedAt ?? receipt.completedAt ?? receipt.at, ""),
    proofFingerprint: asString(receipt.proofFingerprint, ""),
    clientNonce: asString(receipt.clientNonce ?? receipt.nonce, ""),
    outboxCursor: asString(receipt.outboxCursor ?? receipt.cursor, "")
  };
}

function normalizeClientGuardRuntime(client, input) {
  const runtime = asRecord(
    client.guardRuntime ??
      client.destructiveActionGuard ??
      input.clientGuardRuntime ??
      input.guardClientRuntime
  );
  const rawHandoffs = Array.isArray(runtime.handoffs)
    ? runtime.handoffs
    : Array.isArray(runtime.pendingHandoffs)
      ? runtime.pendingHandoffs
      : [];
  const rawReceipts = Array.isArray(runtime.handoffReceipts)
    ? runtime.handoffReceipts
    : Array.isArray(runtime.handoffAcknowledgements)
      ? runtime.handoffAcknowledgements
      : Array.isArray(runtime.acknowledgements)
        ? runtime.acknowledgements
        : [];
  return {
    contractVersion: asString(runtime.contractVersion, `${CONTRACT_VERSION}.client-runtime`),
    lastSeenAt: asTimestamp(runtime.lastSeenAt, ""),
    lastSeenRequestId: asString(runtime.lastSeenRequestId, ""),
    lastSeenCommandId: asString(runtime.lastSeenCommandId, ""),
    lastSeenProofFingerprint: asString(runtime.lastSeenProofFingerprint, ""),
    activeHandoffId: asString(runtime.activeHandoffId, ""),
    handoffs: rawHandoffs
      .map(normalizeClientHandoffEntry)
      .filter((handoff) => handoff.id)
      .slice(-DEFAULT_CLIENT_HANDOFF_LIMIT),
    handoffReceipts: rawReceipts
      .map(normalizeClientHandoffReceipt)
      .filter((receipt) => receipt.handoffId || receipt.requestId)
      .slice(-DEFAULT_CLIENT_HANDOFF_LIMIT),
    inboxCursor: asString(runtime.inboxCursor ?? runtime.cursor, ""),
    outboxCursor: asString(runtime.outboxCursor, ""),
    unreadCount: asNonNegativeInteger(runtime.unreadCount, 0)
  };
}

function normalizePersistedState(input, now) {
  const persisted = asRecord(input.persistedState ?? input.guardState ?? input.state);
  const rawApprovals = asRecord(persisted.approvals);
  const rawDecisions = asRecord(persisted.decisions);
  const rawCommands = asRecord(persisted.commands);
  const approvals = Object.fromEntries(
    Object.entries(rawApprovals)
      .map(([key, value]) => [asString(key), normalizeApprovalEntry(value, now)])
      .filter(([key]) => key)
  );
  const decisions = Object.fromEntries(
    Object.entries(rawDecisions)
      .map(([key, value]) => {
        const decision = asRecord(value);
        return [
          asString(key),
          {
            status: asString(decision.status, "unknown"),
            requestId: asString(decision.requestId ?? key, key),
            commandId: asString(decision.commandId, ""),
            recordedAt: asTimestamp(decision.recordedAt, now),
            recoveryStatus: asString(decision.recoveryStatus, "recovered"),
            boundaryKey: asString(decision.boundaryKey, ""),
            boundaryDenialCodes: asStringArray(decision.boundaryDenialCodes),
            permissionBoundarySource: asString(decision.permissionBoundarySource, ""),
            boundaryAudit: asRecord(decision.boundaryAudit)
          }
        ];
      })
      .filter(([key]) => key)
  );
  const commands = Object.fromEntries(
    Object.entries(rawCommands)
      .map(([key, value]) => [asString(key), normalizePersistedCommandEntry(value, key, now)])
      .filter(([key]) => key)
  );
  return {
    contractVersion: asString(persisted.contractVersion, CONTRACT_VERSION),
    recoveredAt: asTimestamp(persisted.recoveredAt, now),
    approvals,
    decisions,
    commands,
    lifecycle: normalizePersistedLifecycle(persisted.lifecycle, now),
    analytics: normalizePersistedAnalytics(persisted.analytics ?? persisted.reporting, now),
    recovery: {
      source: asString(persisted.recovery?.source, "client-supplied"),
      durable: Boolean(persisted.recovery?.durable),
      lastCheckpointAt: asTimestamp(persisted.recovery?.lastCheckpointAt, "")
    }
  };
}

function normalizePersistedLifecycle(value, now) {
  const lifecycle = asRecord(value);
  const schedule = asRecord(lifecycle.schedule);
  return {
    enabled: asBoolean(lifecycle.enabled, true),
    enforcementMode: ENFORCEMENT_MODES.has(asString(lifecycle.enforcementMode))
      ? asString(lifecycle.enforcementMode)
      : "enforce",
    approvalTtlMs: clampInteger(
      lifecycle.approvalTtlMs,
      MIN_APPROVAL_TTL_MS,
      MAX_APPROVAL_TTL_MS,
      DEFAULT_APPROVAL_TTL_MS
    ),
    schedule: {
      enabled: asBoolean(schedule.enabled, false),
      notBefore: asTimestamp(schedule.notBefore, ""),
      notAfter: asTimestamp(schedule.notAfter, ""),
      reason: asString(schedule.reason, "")
    },
    updatedAt: asTimestamp(lifecycle.updatedAt, now),
    updatedBy: asString(lifecycle.updatedBy, "")
  };
}

function scheduleWindowState(schedule, nowMs) {
  const notBeforeMs = Date.parse(schedule.notBefore);
  const notAfterMs = Date.parse(schedule.notAfter);
  const hasNotBefore = Number.isFinite(notBeforeMs);
  const hasNotAfter = Number.isFinite(notAfterMs);
  const beforeWindow = schedule.enabled && hasNotBefore && nowMs < notBeforeMs;
  const afterWindow = schedule.enabled && hasNotAfter && nowMs > notAfterMs;
  const withinWindow = !schedule.enabled || (!beforeWindow && !afterWindow);
  return {
    active: schedule.enabled,
    withinWindow,
    beforeWindow,
    afterWindow,
    hasNotBefore,
    hasNotAfter,
    opensAt: beforeWindow ? schedule.notBefore : "",
    closesAt: schedule.enabled && hasNotAfter && !afterWindow ? schedule.notAfter : "",
    expiredAt: afterWindow ? schedule.notAfter : "",
    windowMs: hasNotBefore && hasNotAfter ? Math.max(0, notAfterMs - notBeforeMs) : 0
  };
}

function buildLifecycleScheduleValidation({ schedule, scheduleState, command, nowMs }) {
  if (!schedule.enabled) {
    return {
      valid: true,
      blockingCodes: [],
      warningCodes: [],
      correctiveCommand: command.type === "unschedule" ? "checkpoint" : "",
      nextActionType: "none",
      nextActionReason: "schedule_disabled",
      actionableAt: "",
      invalidWindow: false,
      staleWindow: false,
      maximumWindowExceeded: false
    };
  }
  const notBeforeMs = Date.parse(schedule.notBefore);
  const notAfterMs = Date.parse(schedule.notAfter);
  const hasAnyBound = Number.isFinite(notBeforeMs) || Number.isFinite(notAfterMs);
  const invertedWindow =
    Number.isFinite(notBeforeMs) && Number.isFinite(notAfterMs) && notAfterMs < notBeforeMs;
  const staleWindow =
    command.type === "schedule" && Number.isFinite(notAfterMs) && notAfterMs <= nowMs;
  const maximumWindowExceeded = scheduleState.windowMs > MAX_LIFECYCLE_SCHEDULE_WINDOW_MS;
  const missingReason =
    LIFECYCLE_COMMAND_TYPES.has(command.type) &&
    command.type !== "enable" &&
    schedule.reason.length < MIN_LIFECYCLE_CONTROL_REASON_LENGTH;
  const blockingCodes = [
    hasAnyBound ? "" : "invalid_schedule_window",
    invertedWindow ? "inverted_schedule_window" : "",
    staleWindow ? "expired_schedule_window" : "",
    maximumWindowExceeded ? "schedule_window_too_large" : "",
    missingReason ? "lifecycle_control_reason_required" : ""
  ].filter(Boolean);
  const warningCodes = [
    scheduleState.beforeWindow ? "schedule_window_pending" : "",
    scheduleState.afterWindow && !staleWindow ? "schedule_window_elapsed" : "",
    scheduleState.hasNotBefore && !scheduleState.hasNotAfter ? "schedule_has_no_close_time" : "",
    scheduleState.hasNotAfter && !scheduleState.hasNotBefore ? "schedule_has_no_open_time" : ""
  ].filter(Boolean);
  const firstBlockingCode = blockingCodes[0] || "";
  const nextActionType = firstBlockingCode
    ? "correct_lifecycle_schedule"
    : scheduleState.beforeWindow
      ? "wait_for_schedule"
      : "checkpoint_lifecycle";
  return {
    valid: blockingCodes.length === 0,
    blockingCodes,
    warningCodes,
    correctiveCommand: firstBlockingCode === "expired_schedule_window" ? "unschedule" : "schedule",
    nextActionType,
    nextActionReason: firstBlockingCode || warningCodes[0] || "schedule_ready",
    actionableAt: scheduleState.opensAt || schedule.notBefore || "",
    invalidWindow: !hasAnyBound || invertedWindow,
    staleWindow,
    maximumWindowExceeded
  };
}

function buildLifecycleControlTransition({ persistedLifecycle, lifecycleSettings, command, clientState, now }) {
  const previous = {
    enabled: persistedLifecycle.enabled,
    enforcementMode: persistedLifecycle.enforcementMode,
    approvalTtlMs: persistedLifecycle.approvalTtlMs,
    schedule: persistedLifecycle.schedule
  };
  const requested = {
    enabled: lifecycleSettings.enabled,
    enforcementMode: lifecycleSettings.enforcementMode,
    approvalTtlMs: lifecycleSettings.approvalTtlMs,
    schedule: lifecycleSettings.schedule
  };
  const changedFields = [
    previous.enabled !== requested.enabled ? "enabled" : "",
    previous.enforcementMode !== requested.enforcementMode ? "enforcementMode" : "",
    previous.approvalTtlMs !== requested.approvalTtlMs ? "approvalTtlMs" : "",
    previous.schedule.enabled !== requested.schedule.enabled ? "schedule.enabled" : "",
    previous.schedule.notBefore !== requested.schedule.notBefore ? "schedule.notBefore" : "",
    previous.schedule.notAfter !== requested.schedule.notAfter ? "schedule.notAfter" : "",
    previous.schedule.reason !== requested.schedule.reason ? "schedule.reason" : ""
  ].filter(Boolean);
  const mutatingCommand = LIFECYCLE_COMMAND_TYPES.has(command.type);
  const reason = requested.schedule.reason;
  return {
    contractVersion: `${CONTRACT_VERSION}.lifecycle-transition`,
    changeId: `${CONTRACT_VERSION}:lifecycle:${command.type}:${now}`,
    commandType: command.type,
    mutatingCommand,
    actor: clientState.actor,
    requestedBy: command.requestedBy || clientState.actor,
    previous,
    requested,
    changedFields,
    noop: changedFields.length === 0,
    reason,
    reasonAccepted:
      !mutatingCommand ||
      command.type === "enable" ||
      reason.length >= MIN_LIFECYCLE_CONTROL_REASON_LENGTH,
    scheduleWindow: lifecycleSettings.scheduleState,
    scheduleValidation: lifecycleSettings.scheduleValidation,
    checkpointRequired: mutatingCommand && changedFields.length > 0,
    nextControlCommand: command.type === "disable"
      ? "enable"
      : command.type === "schedule"
        ? "unschedule"
        : command.type === "unschedule"
          ? "schedule"
          : ""
  };
}

function normalizeLifecycleSettings(input, persistedState, command, clientState, now, nowMs) {
  const settings = asRecord(input.lifecycleSettings ?? input.guardSettings ?? input.settings);
  const requestedSchedule = asRecord(settings.schedule ?? input.schedule);
  const persistedLifecycle = persistedState.lifecycle;
  const requestedMode = asString(settings.enforcementMode ?? input.enforcementMode).toLowerCase();
  const commandSetsEnabled =
    command.type === "enable" ? true : command.type === "disable" ? false : undefined;
  const enabled = commandSetsEnabled ?? asBoolean(settings.enabled ?? input.enabled, persistedLifecycle.enabled);
  const enforcementMode = command.type === "disable"
    ? "disabled"
    : command.type === "enable"
      ? "enforce"
      : ENFORCEMENT_MODES.has(requestedMode)
        ? requestedMode
        : persistedLifecycle.enforcementMode;
  const scheduleEnabled =
    command.type === "schedule"
      ? true
      : command.type === "unschedule"
        ? false
        : asBoolean(requestedSchedule.enabled, persistedLifecycle.schedule.enabled);
  const schedule = {
    enabled: scheduleEnabled,
    notBefore: asTimestamp(requestedSchedule.notBefore, persistedLifecycle.schedule.notBefore),
    notAfter: asTimestamp(requestedSchedule.notAfter, persistedLifecycle.schedule.notAfter),
    reason: asString(requestedSchedule.reason, persistedLifecycle.schedule.reason)
  };
  const scheduleState = scheduleWindowState(schedule, nowMs);
  const scheduleValidation = buildLifecycleScheduleValidation({
    schedule,
    scheduleState,
    command,
    nowMs
  });
  const lifecycleSettings = {
    enabled,
    enforcementMode,
    approvalTtlMs: clampInteger(
      settings.approvalTtlMs ?? input.approvalTtlMs,
      MIN_APPROVAL_TTL_MS,
      MAX_APPROVAL_TTL_MS,
      persistedLifecycle.approvalTtlMs
    ),
    schedule,
    scheduleState: {
      ...scheduleState,
      nextWindowOpensAt: scheduleState.opensAt,
      nextWindowClosesAt: scheduleState.closesAt,
      expiredAt: scheduleState.expiredAt,
      maxWindowMs: MAX_LIFECYCLE_SCHEDULE_WINDOW_MS
    },
    scheduleValidation,
    controlAction: LIFECYCLE_COMMAND_TYPES.has(command.type)
      ? {
          changeId: `${CONTRACT_VERSION}:lifecycle:${command.type}:${now}`,
          type: command.type,
          actor: clientState.actor,
          requestedBy: command.requestedBy || clientState.actor,
          appliedAt: now,
          reason: schedule.reason
        }
      : null
  };
  return {
    ...lifecycleSettings,
    transition: buildLifecycleControlTransition({
      persistedLifecycle,
      lifecycleSettings,
      command,
      clientState,
      now
    })
  };
}

function canControlLifecycle(clientState) {
  return ["platform:admin", "tenant:admin", "workspace:admin", "destructive-action:execute"].some(
    (permission) => hasPermission(clientState, permission)
  );
}

function validateOperationalInputs({
  now,
  nowMs,
  request,
  command,
  clientState,
  providerState,
  providerNegotiation,
  persistedState,
  lifecycleSettings,
  previewAcceptance,
  acknowledgementState,
  handoffReconciliation
}) {
  const issues = [];
  if (!Number.isFinite(nowMs)) {
    issues.push({
      code: "invalid_generated_at",
      severity: "warning",
      message: "Guard received an invalid timestamp and will use runtime clock for retry scheduling.",
      nextAction: "Send input.now as an ISO-8601 timestamp when replaying or auditing this guard decision."
    });
  }
  const lifecycleCommand = LIFECYCLE_COMMAND_TYPES.has(command.type);
  if (!lifecycleCommand && !request.operation) {
    issues.push({
      code: "missing_operation",
      severity: "error",
      message: "Destructive-action guard cannot classify a request without an operation.",
      nextAction: "Set request.operation or operation before invoking the hosted-kernel guard."
    });
  }
  if (!lifecycleCommand && request.target === "unknown") {
    issues.push({
      code: "missing_target",
      severity: "error",
      message: "Destructive-action guard cannot produce an auditable decision for an unknown target.",
      nextAction: "Set request.target or request.resource to the concrete resource identifier."
    });
  }
  if (!SUPPORTED_COMMAND_TYPES.has(command.type)) {
    issues.push({
      code: "unsupported_command_type",
      severity: "error",
      message: `Guard command type "${command.type}" is not supported by ${CONTRACT_VERSION}.`,
      nextAction: `Use one of: ${Array.from(SUPPORTED_COMMAND_TYPES).join(", ")}.`
    });
  }
  if (providerNegotiation.missingRequired.length) {
    issues.push({
      code: "provider_contract_missing_required_capabilities",
      severity: "error",
      message: `Integration provider is missing required guard capabilities: ${providerNegotiation.missingRequired.join(", ")}.`,
      nextAction: "Advertise the required destructive-action guard provider capabilities before evaluating hosted-kernel execution."
    });
  }
  if (!providerNegotiation.commandSupported) {
    issues.push({
      code: "provider_contract_command_not_supported",
      severity: "error",
      message: `Integration provider does not support the capability required for command "${command.type}".`,
      nextAction: `Add provider capability "${providerNegotiation.commandRequired}" or route this command to a compatible guard provider.`
    });
  }
  if (!providerState.health.ready) {
    const providerIssue = providerState.health.status === "unavailable"
      ? {
          code: "provider_unavailable",
          severity: "error",
          message: "Hosted-kernel destructive-action guard provider is unavailable.",
          nextAction: "Retry after the provider heartbeat is healthy or route the command to another guard provider.",
          retryable: true
        }
      : providerState.health.stale
        ? {
            code: "provider_heartbeat_stale",
            severity: command.type === "execute" ? "error" : "warning",
            message: "Hosted-kernel guard provider heartbeat is stale.",
            nextAction: "Refresh provider health before issuing execution leases or retry after the next heartbeat.",
            retryable: true
          }
        : {
            code: "provider_degraded",
            severity: "warning",
            message: "Hosted-kernel guard provider is reporting degraded readiness.",
            nextAction: "Continue in degraded mode, checkpoint the decision, and monitor provider endpoint errors.",
            retryable: true
          };
    issues.push(providerIssue);
  }
  if (providerState.health.endpointErrors.length) {
    issues.push({
      code: "provider_endpoint_errors",
      severity: command.type === "execute" ? "error" : "warning",
      message: `Hosted-kernel guard provider reported endpoint error(s): ${providerState.health.endpointErrors.join(", ")}.`,
      nextAction: "Resolve provider endpoint errors before dispatching approval, audit, checkpoint, or execution lease operations.",
      retryable: true
    });
  }
  if (providerState.endpoints.invalidRequiredTypes.length) {
    issues.push({
      code: "provider_required_endpoint_invalid",
      severity: "error",
      message: `Integration provider supplied invalid required endpoint route(s): ${providerState.endpoints.invalidRequiredTypes.join(", ")}.`,
      nextAction: "Use hosted-kernel-relative provider endpoint paths that begin with / for decision, approval, checkpoint, and audit services."
    });
  }
  const invalidOptionalEndpointTypes = providerState.endpoints.invalidTypes.filter(
    (type) => !providerState.endpoints.invalidRequiredTypes.includes(type)
  );
  if (invalidOptionalEndpointTypes.length) {
    issues.push({
      code: "provider_optional_endpoint_invalid",
      severity: "warning",
      message: `Integration provider supplied invalid optional endpoint route(s): ${invalidOptionalEndpointTypes.join(", ")}.`,
      nextAction: "Correct optional provider endpoint paths before dispatching workflow handoff operations."
    });
  }
  if (providerState.sync.dirty && command.type === "execute") {
    issues.push({
      code: "provider_sync_dirty_before_execute",
      severity: "error",
      message: "Hosted-kernel guard provider has dirty local sync state before execution.",
      nextAction: "Dispatch the checkpoint operation and retry execution after provider sync is clean.",
      retryable: true
    });
  }
  if (LIFECYCLE_COMMAND_TYPES.has(command.type) && !canControlLifecycle(clientState)) {
    issues.push({
      code: "lifecycle_control_permission_denied",
      severity: "error",
      message: `Guard lifecycle command "${command.type}" requires an administrator or destructive-action executor permission.`,
      nextAction: "Grant workspace, tenant, platform, or destructive-action execute permission before changing guard lifecycle controls."
    });
  }
  if (
    LIFECYCLE_COMMAND_TYPES.has(command.type) &&
    !lifecycleSettings.transition.reasonAccepted
  ) {
    issues.push({
      code: "lifecycle_control_reason_required",
      severity: "error",
      message: `Guard lifecycle command "${command.type}" requires a control reason of at least ${MIN_LIFECYCLE_CONTROL_REASON_LENGTH} characters.`,
      nextAction: "Set lifecycleSettings.schedule.reason or schedule.reason to an operator-readable change reason before applying the lifecycle command."
    });
  }
  if (LIFECYCLE_COMMAND_TYPES.has(command.type) && lifecycleSettings.transition.noop) {
    issues.push({
      code: "lifecycle_control_noop",
      severity: "warning",
      message: `Guard lifecycle command "${command.type}" does not change the persisted lifecycle settings.`,
      nextAction: "Review current lifecycleControls.transition.changedFields before checkpointing this control command."
    });
  }
  const boundaryDecision = buildBoundaryDecision(request, clientState);
  if (boundaryDecision.tenantScopeDenied) {
    issues.push({
      code: "tenant_not_in_permission_boundary",
      severity: "error",
      message: `Requested tenant "${request.boundary.tenantId}" is outside the caller permission boundary.`,
      nextAction: "Route the request to a client session scoped to the target tenant or add an explicit tenant grant."
    });
  }
  if (boundaryDecision.workspaceScopeDenied) {
    issues.push({
      code: "workspace_not_in_permission_boundary",
      severity: "error",
      message: `Requested workspace "${request.boundary.workspaceId}" is outside the caller permission boundary.`,
      nextAction: "Add an explicit workspace grant for this tenant/workspace before requesting destructive action approval."
    });
  }
  if (boundaryDecision.workspaceScopeAmbiguous) {
    issues.push({
      code: "explicit_workspace_scope_required",
      severity: "error",
      message: "Guarded destructive, deployment, privileged mutation, or irreversible operations require an explicit workspace scope.",
      nextAction: "Set request.boundary.workspaceId, request.workspaceId, or an explicit tenant-wide workspace marker before requesting approval or execution."
    });
  }
  if (command.type === "approve") {
    if (!previewAcceptance.accepted) {
      issues.push({
        code: "preview_acceptance_required",
        severity: "error",
        message: "Approval commands must include an accepted destructive-action preview.",
        nextAction: "Submit previewAcceptance.accepted=true with the confirmation phrase returned by the guard preview."
      });
    }
    if (!previewAcceptance.confirmationMatches) {
      issues.push({
        code: "preview_confirmation_mismatch",
        severity: "error",
        message: "Approval confirmation text did not match the guard preview phrase.",
        nextAction: `Use confirmationText="${previewAcceptance.expectedConfirmationText}" when accepting this preview.`
      });
    }
    if (!previewAcceptance.bindingComplete) {
      issues.push({
        code: "preview_binding_required",
        severity: "error",
        message: `Approval commands must include preview binding field(s): ${previewAcceptance.binding.requiredFieldCodes.join(", ")}.`,
        nextAction: "Submit previewId, requestId, and bindingFingerprint from the guard preview acceptance contract with the approval command."
      });
    }
    if (previewAcceptance.binding.mismatchCodes.length) {
      issues.push({
        code: "preview_binding_mismatch",
        severity: "error",
        message: `Approval binding did not match the guarded action: ${previewAcceptance.binding.mismatchCodes.join(", ")}.`,
        nextAction: "Refresh the destructive-action preview and approve only the current request, route, boundary, operation, and target."
      });
    }
    if (!acknowledgementState.complete) {
      issues.push({
        code: "preview_risk_acknowledgement_missing",
        severity: "error",
        message: `Approval omitted required destructive-action acknowledgement code(s): ${acknowledgementState.missingCodes.join(", ")}.`,
        nextAction: "Submit previewAcceptance.acknowledgedRiskCodes with every required acknowledgement code returned by the guard preview."
      });
    }
    if (!hasPermission(clientState, "destructive-action:execute")) {
      issues.push({
        code: "approval_permission_denied",
        severity: "error",
        message: "Accepting a destructive-action preview requires destructive-action execute permission.",
        nextAction: "Use an approver with destructive-action:execute, workspace admin, tenant admin, or platform admin permission."
      });
    }
  }
  if (!ENFORCEMENT_MODES.has(lifecycleSettings.enforcementMode)) {
    issues.push({
      code: "invalid_enforcement_mode",
      severity: "error",
      message: `Guard enforcement mode "${lifecycleSettings.enforcementMode}" is not supported.`,
      nextAction: `Use one of: ${Array.from(ENFORCEMENT_MODES).join(", ")}.`
    });
  }
  if (lifecycleSettings.schedule.enabled) {
    const scheduleIssueDetails = {
      invalid_schedule_window: {
        message: "Guard scheduling is enabled without a valid notBefore or notAfter timestamp.",
        nextAction: "Provide schedule.notBefore or schedule.notAfter as ISO-8601 timestamps, or unschedule the control."
      },
      inverted_schedule_window: {
        message: "Guard schedule.notAfter is earlier than schedule.notBefore.",
        nextAction: "Set schedule.notAfter later than schedule.notBefore before applying the lifecycle command."
      },
      expired_schedule_window: {
        message: "Guard schedule command targets a window that has already closed.",
        nextAction: "Set schedule.notAfter in the future or use unschedule to clear the expired guard control window."
      },
      schedule_window_too_large: {
        message: "Guard schedule window exceeds the maximum lifecycle control window.",
        nextAction: `Keep schedule.notBefore to schedule.notAfter within ${MAX_LIFECYCLE_SCHEDULE_WINDOW_MS} milliseconds.`
      }
    };
    for (const code of lifecycleSettings.scheduleValidation.blockingCodes) {
      if (code === "lifecycle_control_reason_required") continue;
      issues.push({
        code,
        severity: "error",
        message: scheduleIssueDetails[code]?.message || "Guard lifecycle schedule is not valid.",
        nextAction:
          scheduleIssueDetails[code]?.nextAction ||
          "Correct lifecycleSettings.schedule before applying this lifecycle command."
      });
    }
  }
  if (!clientState.id || clientState.id === "anonymous-client") {
    issues.push({
      code: "anonymous_client",
      severity: "warning",
      message: "Guard decision is attributable only to the anonymous client fallback.",
      nextAction: "Pass clientState.id or clientId so audit proof can bind the decision to a caller."
    });
  }
  if (handoffReconciliation.activeHandoffProblem) {
    issues.push({
      code: handoffReconciliation.activeHandoffProblem,
      severity: "warning",
      message: "Client runtime active handoff pointer does not match an actionable handoff.",
      nextAction: "Refresh the destructive-action guard client runtime from the returned clientRuntimeState before dispatching the next handoff."
    });
  }
  if (handoffReconciliation.orphanReceiptCount > 0) {
    issues.push({
      code: "handoff_receipt_without_matching_handoff",
      severity: "warning",
      message: "Client runtime included handoff receipt(s) that could not be reconciled to the current request handoff.",
      nextAction: "Replay the returned clientRuntimeState.outbox receipt messages or discard stale local receipt state."
    });
  }
  if (handoffReconciliation.expiredHandoffCount > 0) {
    issues.push({
      code: "expired_handoff_in_inbox",
      severity: "warning",
      message: "Client runtime still contains expired destructive-action handoff(s) for the current request.",
      nextAction: "Replace expired local handoff entries with the returned clientRuntimeState.handoffs list."
    });
  }
  if (handoffReconciliation.pendingHandoffCount > 1) {
    issues.push({
      code: "multiple_pending_handoffs_for_request",
      severity: "warning",
      message: "Client runtime has more than one pending handoff for this destructive-action request.",
      nextAction: "Use clientRuntimeState.activeHandoffId and dismiss stale pending handoffs before requesting approval."
    });
  }
  if (
    command.type === "approve" &&
    handoffReconciliation.currentHandoffCount === 0 &&
    !previewAcceptance.clientNonce
  ) {
    issues.push({
      code: "approve_without_handoff_context",
      severity: "warning",
      message: "Approval command did not include a matching client handoff or preview client nonce.",
      nextAction: "Submit approval from the returned routeAcceptanceContract acceptance form or include previewAcceptance.clientNonce."
    });
  }
  if (persistedState.contractVersion !== CONTRACT_VERSION) {
    issues.push({
      code: "state_contract_mismatch",
      severity: "warning",
      message: `Recovered guard state used ${persistedState.contractVersion}; current contract is ${CONTRACT_VERSION}.`,
      nextAction: "Checkpoint the returned persistedState before executing newly allowed destructive actions."
    });
  }
  if (!persistedState.recovery.durable) {
    issues.push({
      code: "non_durable_recovery",
      severity: "warning",
      message: "Guard state was recovered from a non-durable source.",
      nextAction: "Persist the returned restart-safe state before executing destructive side effects."
    });
  }
  return issues;
}

function buildOperationalHealth(validationIssues, providerState) {
  const errorCount = validationIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = validationIssues.filter((issue) => issue.severity === "warning").length;
  const status = errorCount ? "unhealthy" : warningCount ? "degraded" : "healthy";
  return {
    status,
    errorCount,
    warningCount,
    ready: errorCount === 0,
    degraded: status === "degraded",
    checkedAtContract: CONTRACT_VERSION,
    validationCodes: validationIssues.map((issue) => issue.code),
    provider: {
      id: providerState.id,
      serviceId: providerState.serviceId,
      status: providerState.health.status,
      ready: providerState.health.ready,
      degraded: providerState.health.degraded,
      stale: providerState.health.stale,
      heartbeatAgeMs: providerState.health.heartbeatAgeMs,
      endpointErrorCount: providerState.health.endpointErrors.length,
      lastErrorCode: providerState.health.lastErrorCode,
      endpointContractReady: providerState.endpoints.ready,
      endpointOverrideTypes: providerState.endpoints.overrideTypes,
      invalidEndpointTypes: providerState.endpoints.invalidTypes,
      invalidRequiredEndpointTypes: providerState.endpoints.invalidRequiredTypes
    }
  };
}

function applyLifecycleControls(decision, request, command, lifecycleSettings) {
  if (LIFECYCLE_COMMAND_TYPES.has(command.type)) {
    return {
      ...decision,
      status: decision.status === "blocked" ? "blocked" : "allowed",
      requiresApproval: decision.status === "blocked",
      signals: {
        ...decision.signals,
        lifecycleControlCommand: command.type,
        lifecycleEnabledAfterCommand: lifecycleSettings.enabled
      }
    };
  }
  const guardedExecution =
    command.type === "execute" && !request.dryRun && decision.signals.guardedOperation;
  const disabled = !lifecycleSettings.enabled || lifecycleSettings.enforcementMode === "disabled";
  const outsideSchedule = lifecycleSettings.schedule.enabled && !lifecycleSettings.scheduleState.withinWindow;
  if (!guardedExecution || (!disabled && !outsideSchedule)) return decision;
  const status = disabled ? "blocked" : "handoff_required";
  return {
    ...decision,
    status,
    requiresApproval: true,
    riskScore: decision.riskScore + (disabled ? 2 : 1),
    signals: {
      ...decision.signals,
      lifecycleGuardDisabled: disabled,
      lifecycleScheduleBlocked: outsideSchedule,
      lifecycleNextWindowOpensAt: lifecycleSettings.scheduleState.nextWindowOpensAt
    }
  };
}

function applyFailureAndDegradedMode(decision, validationIssues, request, persistedState) {
  const blockingCodes = validationIssues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);
  const nonDurableGuardedPath =
    !persistedState.recovery.durable &&
    decision.status === "allowed" &&
    !request.dryRun &&
    decision.signals.guardedOperation;
  if (!blockingCodes.length && !nonDurableGuardedPath) return decision;
  return {
    ...decision,
    status: blockingCodes.length ? "blocked" : "handoff_required",
    requiresApproval: true,
    riskScore: decision.riskScore + blockingCodes.length + (nonDurableGuardedPath ? 1 : 0),
    signals: {
      ...decision.signals,
      validationFailed: blockingCodes.length > 0,
      blockingValidationCodes: blockingCodes,
      degradedRecoveryRequiresCheckpoint: nonDurableGuardedPath
    }
  };
}

function buildFailureState({ validationIssues, decision, retryState, nowMs }) {
  const blocking = validationIssues.filter((issue) => issue.severity === "error");
  const activeCode = blocking[0]?.code || retryState.lastErrorCode || "";
  const failed = decision.status === "blocked" || blocking.length > 0;
  return {
    failed,
    code: failed ? activeCode || "guard_blocked" : "",
    severity: blocking.length ? "error" : decision.status === "handoff_required" ? "warning" : "none",
    retryable: blocking.every((issue) => issue.retryable ?? issue.code !== "unsupported_command_type"),
    attempts: retryState.attempts,
    lastFailedAt: failed ? new Date(nowMs).toISOString() : retryState.lastFailedAt,
    validationCodes: validationIssues.map((issue) => issue.code)
  };
}

function buildRetryPlan({ failureState, retryState, nowMs }) {
  if (!failureState.failed || !failureState.retryable) {
    return {
      retryable: false,
      attemptsRemaining: Math.max(0, retryState.maxAttempts - retryState.attempts),
      nextAttemptAt: "",
      backoffMs: 0,
      reason: failureState.failed ? "non_retryable_failure" : "no_failure"
    };
  }
  const attemptsRemaining = Math.max(0, retryState.maxAttempts - retryState.attempts);
  const backoffMs = Math.min(
    retryState.maxDelayMs,
    retryState.baseDelayMs * 2 ** Math.min(retryState.attempts, 8)
  );
  return {
    retryable: attemptsRemaining > 0,
    attemptsRemaining,
    nextAttemptAt: attemptsRemaining > 0 ? new Date(nowMs + backoffMs).toISOString() : "",
    backoffMs: attemptsRemaining > 0 ? backoffMs : 0,
    reason: attemptsRemaining > 0
      ? failureState.code.startsWith("provider_")
        ? "provider_health_or_sync_failure"
        : "validation_or_guard_failure"
      : "retry_budget_exhausted"
  };
}

function buildActionableErrors(validationIssues, retryPlan) {
  return validationIssues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    nextAction: issue.nextAction,
    retryable: issue.retryable ?? (issue.severity !== "error" || retryPlan.retryable),
    blocksExecution: issue.severity === "error"
  }));
}

function buildDegradedMode(health, validationIssues, persistedState) {
  const reasons = validationIssues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.code);
  const providerDegraded = health.provider.degraded && !health.provider.ready;
  return {
    active: health.status === "degraded" || providerDegraded,
    reasons,
    executionMode: health.status === "degraded" || providerDegraded
      ? "checkpoint_before_side_effects"
      : "normal",
    checkpointRequired:
      !persistedState.recovery.durable ||
      reasons.includes("state_contract_mismatch") ||
      providerDegraded,
    recoverySource: persistedState.recovery.source,
    durableRecovery: persistedState.recovery.durable,
    providerStatus: health.provider.status,
    providerReady: health.provider.ready,
    providerStale: health.provider.stale,
    providerEndpointErrorCount: health.provider.endpointErrorCount
  };
}

function mergeApprovalLedgers(clientState, persistedState) {
  return {
    ...persistedState.approvals,
    ...Object.fromEntries(
      Object.entries(clientState.approvals).map(([key, value]) => [
        key,
        normalizeApprovalEntry(value, "")
      ])
    )
  };
}

function buildAcceptedPreviewApproval({
  command,
  request,
  clientState,
  previewAcceptance,
  acknowledgementState,
  lifecycleSettings,
  now,
  nowMs
}) {
  if (command.type !== "approve") return null;
  if (!previewAcceptance.accepted || !previewAcceptance.confirmationMatches) return null;
  if (!previewAcceptance.bindingMatches) return null;
  if (!acknowledgementState.complete) return null;
  if (!hasPermission(clientState, "destructive-action:execute")) return null;
  return {
    granted: true,
    grantedAt: previewAcceptance.acceptedAt || now,
    expiresAt: new Date(nowMs + lifecycleSettings.approvalTtlMs).toISOString(),
    actor: previewAcceptance.acceptedBy || clientState.actor,
    requestId: request.id,
    recoverySource: "preview_acceptance",
    boundary: request.boundary,
    previewId: previewAcceptance.previewId,
    bindingFingerprint: previewAcceptance.expectedBindingFingerprint,
    binding: previewAcceptance.binding.expectedBinding,
    acknowledgedRiskCodes: acknowledgementState.acknowledgedCodes,
    requiredAcknowledgementCodes: acknowledgementState.requiredCodes,
    clientNonce: previewAcceptance.clientNonce
  };
}

function approvalCoversBoundary(approval, request) {
  const approvalBoundary = normalizeBoundaryContext({}, approval);
  return boundaryKey(approvalBoundary) === boundaryKey(request.boundary);
}

function hasActiveApproval(request, clientState, nowMs) {
  const approval = asRecord(clientState.approvals[request.id] ?? clientState.approvals[request.target]);
  if (!approval.granted) return false;
  if (!approvalCoversBoundary(approval, request)) return false;
  const expiresAt = Date.parse(asString(approval.expiresAt));
  return Number.isFinite(expiresAt) ? expiresAt >= nowMs : true;
}

function hasPermission(clientState, permission) {
  return clientState.permissions.includes(permission) || clientState.capabilities.includes(permission);
}

function guardedOperationNeedsWorkspaceScope(request) {
  const operationTokens = collectOperationTokens(request);
  const guardedToken = operationTokens.some(
    (token) =>
      DESTRUCTIVE_OPERATIONS.has(token) ||
      DEPLOYMENT_OPERATIONS.has(token) ||
      PRIVILEGED_MUTATION_OPERATIONS.has(token) ||
      IRREVERSIBLE_OPERATIONS.has(token)
  );
  const targetType = request.targetType.toLowerCase();
  const tenantScopedTarget = [
    "account",
    "billing",
    "organization",
    "org",
    "tenant",
    "tenant-policy",
    "subscription"
  ].includes(targetType);
  const workspaceScopedHint = textHasAnyHint(
    `${targetType} ${request.target} ${JSON.stringify(request.args)}`.toLowerCase(),
    ["workspace", "project", "environment", "service", "database", "filesystem"]
  );
  return {
    required: guardedToken && (!tenantScopedTarget || workspaceScopedHint),
    guardedToken,
    tenantScopedTarget,
    workspaceScopedHint
  };
}

function buildBoundaryDecision(request, clientState) {
  const tenantMatches = request.boundary.tenantId === clientState.boundary.tenantId;
  const workspaceMatches = request.boundary.workspaceId === clientState.boundary.workspaceId;
  const tenantWide = ["*", "all", "tenant"].includes(request.boundary.workspaceId.toLowerCase());
  const workspaceScope = guardedOperationNeedsWorkspaceScope(request);
  const policy = clientState.permissionBoundary;
  const tenantExplicitlyAllowed =
    policy.allowAllTenants ||
    tenantMatches ||
    policy.allowedTenantIds.includes(request.boundary.tenantId);
  const grantedWorkspacesForTenant = policy.workspaceGrants[request.boundary.tenantId] ?? [];
  const workspaceExplicitlyAllowed =
    policy.allowAllWorkspaces ||
    workspaceMatches ||
    policy.allowedWorkspaceIds.includes(request.boundary.workspaceId) ||
    grantedWorkspacesForTenant.includes(request.boundary.workspaceId);
  const clientWorkspaceGrantCoversRequest =
    workspaceExplicitlyAllowed && (!tenantWide || policy.allowTenantWideActions);
  const tenantScopeDenied = !tenantExplicitlyAllowed;
  const workspaceScopeDenied =
    !tenantWide && policy.requireExplicitWorkspaceGrant && !workspaceExplicitlyAllowed;
  const canAdminTenant = hasPermission(clientState, "tenant:admin") && tenantExplicitlyAllowed;
  const canAdminWorkspace =
    hasPermission(clientState, "workspace:admin") && tenantExplicitlyAllowed && clientWorkspaceGrantCoversRequest;
  const canCrossTenant = hasPermission(clientState, "platform:admin") && tenantExplicitlyAllowed;
  const canExecute = hasPermission(clientState, "destructive-action:execute");
  const crossTenantDenied = !tenantMatches && !canCrossTenant;
  const crossWorkspaceDenied = tenantMatches && !workspaceMatches && !tenantWide && !canAdminWorkspace;
  const tenantWideDenied = tenantWide && (!canAdminTenant || !policy.allowTenantWideActions);
  const workspaceScopeAmbiguous =
    workspaceScope.required &&
    !request.boundary.workspaceExplicit &&
    !tenantWide;
  const denialCodes = [
    tenantScopeDenied ? "tenant_not_in_permission_boundary" : "",
    workspaceScopeDenied ? "workspace_not_in_permission_boundary" : "",
    crossTenantDenied ? "cross_tenant_boundary" : "",
    crossWorkspaceDenied ? "cross_workspace_boundary" : "",
    tenantWideDenied ? "tenant_wide_boundary" : "",
    workspaceScopeAmbiguous ? "explicit_workspace_scope_required" : ""
  ].filter(Boolean);
  return {
    requestBoundary: request.boundary,
    clientBoundary: clientState.boundary,
    permissionBoundary: policy,
    tenantMatches,
    workspaceMatches,
    tenantWide,
    tenantExplicitlyAllowed,
    workspaceExplicitlyAllowed,
    tenantScopeDenied,
    workspaceScopeDenied,
    canAdminTenant,
    canAdminWorkspace,
    canCrossTenant,
    canExecute,
    crossTenantDenied,
    crossWorkspaceDenied,
    tenantWideDenied,
    workspaceScope,
    workspaceScopeAmbiguous,
    explicitWorkspaceRequired: workspaceScope.required,
    denialCodes,
    denied: denialCodes.length > 0
  };
}

function textHasAnyHint(text, hints) {
  return hints.some((hint) => text.includes(hint));
}

function booleanFlagIsSet(args, names) {
  return names.some((name) => asBoolean(args[name], false));
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => asString(value).toLowerCase()).filter(Boolean)));
}

function splitGuardIdentifier(value) {
  const raw = asString(value);
  if (!raw) return [];
  const camelSeparated = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const normalized = camelSeparated.toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]+/g, "");
  const parts = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return uniqueStrings([normalized, compact, ...parts]);
}

function canonicalizeOperationToken(token) {
  const normalized = asString(token).toLowerCase();
  return OPERATION_TOKEN_ALIASES[normalized] || normalized;
}

function collectOperationTokens(request) {
  const args = asRecord(request.args);
  const candidates = [
    request.operation,
    args.operation,
    args.action,
    args.verb,
    args.method,
    args.intent,
    args.command
  ];
  const rawTokens = candidates.flatMap((candidate) => splitGuardIdentifier(candidate));
  const canonicalTokens = rawTokens.map(canonicalizeOperationToken);
  return uniqueStrings(canonicalTokens);
}

function collectMatchedOperations(operationTokens, operationSet) {
  return operationTokens.filter((token) => operationSet.has(token));
}

function buildHintMatches(text, hints) {
  return hints.filter((hint) => text.includes(hint));
}

function buildClassificationSources({
  destructiveMatches,
  deploymentMatches,
  privilegedMutationMatches,
  irreversibleMatches,
  irreversibleFlagMatches,
  privilegedTargetHintMatches,
  sensitiveTargetHintMatches,
  broadScopeHintMatches
}) {
  return {
    destructive: destructiveMatches.map((token) => `operation:${token}`),
    deployment: deploymentMatches.map((token) => `operation:${token}`),
    privilegedMutation: [
      ...privilegedMutationMatches.map((token) => `operation:${token}`),
      ...privilegedTargetHintMatches.map((hint) => `target:${hint}`)
    ],
    irreversible: [
      ...irreversibleMatches.map((token) => `operation:${token}`),
      ...irreversibleFlagMatches.map((flag) => `flag:${flag}`)
    ],
    sensitiveTarget: sensitiveTargetHintMatches.map((hint) => `target:${hint}`),
    broadScope: broadScopeHintMatches.map((hint) => `scope:${hint}`)
  };
}

function classifyGuardedOperation(request) {
  const targetBlob = `${request.targetType} ${request.target} ${JSON.stringify(request.args)}`.toLowerCase();
  const operationTokens = collectOperationTokens(request);
  const destructiveMatches = collectMatchedOperations(operationTokens, DESTRUCTIVE_OPERATIONS);
  const deploymentMatches = collectMatchedOperations(operationTokens, DEPLOYMENT_OPERATIONS);
  const privilegedMutationMatches = collectMatchedOperations(
    operationTokens,
    PRIVILEGED_MUTATION_OPERATIONS
  );
  const irreversibleMatches = collectMatchedOperations(operationTokens, IRREVERSIBLE_OPERATIONS);
  const privilegedTargetHintMatches = buildHintMatches(targetBlob, PRIVILEGED_MUTATION_TARGET_HINTS);
  const targetTypeMatchesPrivilegedDomain = [
    "policy",
    "permission",
    "role",
    "identity",
    "credential",
    "key",
    "secret",
    "token"
  ].includes(request.targetType.toLowerCase());
  const irreversibleFlagNames = [
    "force",
    "hardDelete",
    "irreversible",
    "permanent",
    "skipBackup",
    "withoutBackup"
  ];
  const irreversibleFlagMatches = [
    ...irreversibleFlagNames.filter((flag) => asBoolean(request.args[flag], false)),
    ...buildHintMatches(targetBlob, IRREVERSIBLE_ACTION_HINTS)
  ];
  const destructiveOperation = destructiveMatches.length > 0;
  const deploymentOperation = deploymentMatches.length > 0;
  const privilegedMutation =
    privilegedMutationMatches.length > 0 &&
    (privilegedTargetHintMatches.length > 0 || targetTypeMatchesPrivilegedDomain);
  const irreversibleOperation =
    destructiveOperation ||
    irreversibleMatches.length > 0 ||
    irreversibleFlagMatches.length > 0;
  const classifications = [
    destructiveOperation ? "destructive" : "",
    deploymentOperation ? "deployment" : "",
    privilegedMutation ? "privileged_mutation" : "",
    irreversibleOperation ? "irreversible" : ""
  ].filter(Boolean);
  const operationFamily = destructiveOperation
    ? "destructive"
    : deploymentOperation
      ? "deployment"
      : privilegedMutation
        ? "privileged_mutation"
        : irreversibleOperation
          ? "irreversible"
          : "standard";
  return {
    targetBlob,
    operationTokens,
    matchedOperations: {
      destructive: destructiveMatches,
      deployment: deploymentMatches,
      privilegedMutation: privilegedMutationMatches,
      irreversible: irreversibleMatches
    },
    irreversibleFlagMatches,
    privilegedTargetHintMatches,
    targetTypeMatchesPrivilegedDomain,
    destructiveOperation,
    deploymentOperation,
    privilegedMutation,
    irreversibleOperation,
    guardedOperation: classifications.length > 0,
    operationFamily,
    classifications
  };
}

function buildRiskSignals(request, clientState) {
  const classification = classifyGuardedOperation(request);
  const sensitiveTargetHintMatches = buildHintMatches(classification.targetBlob, SENSITIVE_TARGET_HINTS);
  const broadScopeHintMatches = buildHintMatches(classification.targetBlob, [
    "*",
    "all",
    "global",
    "workspace",
    "tenant"
  ]);
  const sensitiveTarget = sensitiveTargetHintMatches.length > 0;
  const broadScope = broadScopeHintMatches.length > 0;
  const lacksCapability = classification.guardedOperation && !hasPermission(clientState, "destructive-action:execute");
  const dryRunBypass = classification.guardedOperation && request.dryRun;
  const boundary = buildBoundaryDecision(request, clientState);
  const classificationSources = buildClassificationSources({
    destructiveMatches: classification.matchedOperations.destructive,
    deploymentMatches: classification.matchedOperations.deployment,
    privilegedMutationMatches: classification.matchedOperations.privilegedMutation,
    irreversibleMatches: classification.matchedOperations.irreversible,
    irreversibleFlagMatches: classification.irreversibleFlagMatches,
    privilegedTargetHintMatches: classification.privilegedTargetHintMatches,
    sensitiveTargetHintMatches,
    broadScopeHintMatches
  });
  return {
    operationTokens: classification.operationTokens,
    matchedOperations: classification.matchedOperations,
    classificationSources,
    destructiveOperation: classification.destructiveOperation,
    deploymentOperation: classification.deploymentOperation,
    privilegedMutation: classification.privilegedMutation,
    irreversibleOperation: classification.irreversibleOperation,
    guardedOperation: classification.guardedOperation,
    externalServiceOperation: request.externalOperation.matched,
    externalServiceRequiresApproval: request.externalOperation.requiresApproval,
    externalOperation: request.externalOperation,
    operationFamily: classification.operationFamily,
    guardedOperationClassifications: classification.classifications,
    sensitiveTarget,
    broadScope,
    lacksCapability,
    dryRunBypass,
    boundary
  };
}

function decideGuardState(request, clientState, nowMs) {
  const signals = buildRiskSignals(request, clientState);
  const riskScore = [
    signals.guardedOperation,
    signals.externalServiceRequiresApproval,
    signals.deploymentOperation,
    signals.privilegedMutation,
    signals.irreversibleOperation && !signals.destructiveOperation,
    signals.sensitiveTarget,
    signals.broadScope,
    signals.lacksCapability,
    signals.boundary.denied
  ].filter(Boolean).length;
  const approved = hasActiveApproval(request, clientState, nowMs);
  const guardedOrExternal = signals.guardedOperation || signals.externalServiceRequiresApproval;
  const requiresApproval = guardedOrExternal && !request.dryRun && (riskScore > 1 || !approved);
  const blocked = !request.dryRun && (signals.boundary.denied || (signals.lacksCapability && guardedOrExternal && !approved));
  const status = blocked ? "blocked" : requiresApproval ? "handoff_required" : "allowed";
  return { status, riskScore, approved, requiresApproval, signals };
}

function commandRecoveryResumeToken(requestId, commandId) {
  return `${CONTRACT_VERSION}:recover:${requestId || "unknown-request"}:${commandId}`;
}

function buildPersistedCommandRuntimeState(commandEntry, nowMs) {
  const lastSeenMs = Date.parse(commandEntry.lastSeenAt || commandEntry.startedAt);
  const expiresAtMs = Date.parse(commandEntry.expiresAt);
  const leaseExpired = Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
  const staleByClock =
    commandEntry.active &&
    Number.isFinite(lastSeenMs) &&
    nowMs - lastSeenMs > DEFAULT_IN_FLIGHT_COMMAND_TTL_MS;
  const leaseExpiresInMs =
    commandEntry.expiresAt && Number.isFinite(expiresAtMs)
      ? Math.max(0, expiresAtMs - nowMs)
      : 0;
  const lastSeenAgeMs =
    Number.isFinite(lastSeenMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - lastSeenMs) : 0;
  return {
    terminal: commandEntry.terminal,
    active: commandEntry.active,
    recoveryRequired: commandEntry.recoveryRequired,
    restartSafe: commandEntry.restartSafe,
    leaseExpired,
    leaseExpiresInMs,
    staleByClock,
    stale: leaseExpired || staleByClock,
    lastSeenAgeMs,
    recoveryReason: leaseExpired
      ? "lease_expired_during_restart"
      : staleByClock
        ? "in_flight_command_ttl_elapsed"
        : commandEntry.recoveryReason || "",
    resumeToken: commandEntry.resumeToken
  };
}

function summarizeCurrentPersistedCommand(commandEntry, commandId, nowMs) {
  if (!commandEntry) {
    return {
      commandId,
      present: false,
      status: "new",
      phase: "new",
      active: false,
      terminal: false,
      recoveryRequired: false,
      stale: false,
      restartSafe: true,
      replayable: false,
      resumeToken: commandRecoveryResumeToken("", commandId),
      nextCommandType: "evaluate",
      reason: "command_not_seen_before"
    };
  }
  const runtime = buildPersistedCommandRuntimeState(commandEntry, nowMs);
  const replayable = commandEntry.terminal || commandEntry.recoveryRequired;
  return {
    commandId,
    requestId: commandEntry.requestId,
    present: true,
    status: commandEntry.status,
    resultStatus: commandEntry.resultStatus,
    phase: commandEntry.phase,
    active: commandEntry.active,
    terminal: commandEntry.terminal,
    recoveryRequired: commandEntry.recoveryRequired || runtime.stale,
    stale: runtime.stale,
    staleByClock: runtime.staleByClock,
    leaseExpired: runtime.leaseExpired,
    restartSafe: commandEntry.restartSafe && !runtime.stale,
    replayable,
    lastSeenAgeMs: runtime.lastSeenAgeMs,
    leaseExpiresInMs: runtime.leaseExpiresInMs,
    resumeToken: runtime.resumeToken || commandRecoveryResumeToken(commandEntry.requestId, commandId),
    nextCommandType: commandEntry.active && !runtime.stale ? "recover" : replayable ? "replay" : "evaluate",
    reason:
      runtime.recoveryReason ||
      (commandEntry.active ? "command_already_in_progress" : replayable ? "command_checkpoint_replay" : "unknown")
  };
}

function recoverPersistedCommandJournal({ persistedState, request, command, now, nowMs }) {
  const commandId = buildCommandId(request, command);
  const recovered = [];
  const active = [];
  const terminal = [];
  const recoveryRequired = [];
  const commands = Object.fromEntries(
    Object.entries(persistedState.commands).map(([key, entry]) => {
      const commandEntry = normalizePersistedCommandEntry(entry, key, now);
      const runtimeState = buildPersistedCommandRuntimeState(commandEntry, nowMs);
      if (commandEntry.active) active.push(commandEntry.commandId || key);
      if (commandEntry.terminal) terminal.push(commandEntry.commandId || key);
      if (commandEntry.recoveryRequired) recoveryRequired.push(commandEntry.commandId || key);
      if (!commandEntry.active || !runtimeState.stale) {
        return [key, commandEntry];
      }
      const requestId = commandEntry.requestId || request.id;
      const recoveredEntry = {
        ...commandEntry,
        status: "recovery_required",
        resultStatus: commandEntry.resultStatus || "handoff_required",
        phase: "recovery",
        completedAt: "",
        lastSeenAt: now,
        recoveredAt: now,
        resumeToken: commandEntry.resumeToken || commandRecoveryResumeToken(requestId, commandEntry.commandId || key),
        recoveryStatus: "stale_in_flight_command",
        recoveryReason: runtimeState.recoveryReason,
        active: false,
        recoveryRequired: true,
        restartSafe: true
      };
      recovered.push({
        commandId: commandEntry.commandId || key,
        requestId,
        statusBeforeRecovery: commandEntry.status,
        lastSeenAgeMs: runtimeState.lastSeenAgeMs,
        leaseExpiresInMs: runtimeState.leaseExpiresInMs,
        recoveryReason: recoveredEntry.recoveryReason,
        resumeToken: recoveredEntry.resumeToken,
        currentRequest: key === commandId
      });
      return [key, recoveredEntry];
    })
  );
  const currentCommandState = summarizeCurrentPersistedCommand(commands[commandId], commandId, nowMs);
  return {
    ...persistedState,
    commands,
    commandRecovery: {
      contractVersion: `${CONTRACT_VERSION}.command-recovery`,
      scannedAt: now,
      ttlMs: DEFAULT_IN_FLIGHT_COMMAND_TTL_MS,
      recoveredCount: recovered.length,
      recovered,
      activeCommandIds: active,
      terminalCommandIds: terminal,
      recoveryRequiredCommandIds: Array.from(new Set([...recoveryRequired, ...recovered.map((entry) => entry.commandId)])),
      currentCommandId: commandId,
      currentCommandRecovered: recovered.some((entry) => entry.currentRequest),
      currentCommandState,
      restartSafe:
        recovered.length === 0 &&
        !currentCommandState.active &&
        !currentCommandState.recoveryRequired,
      recoveryBlockingCodes: [
        currentCommandState.active && !currentCommandState.stale ? "current_command_already_in_progress" : "",
        currentCommandState.recoveryRequired ? "current_command_recovery_required" : "",
        recovered.length ? "stale_in_flight_commands_recovered" : ""
      ].filter(Boolean)
    }
  };
}

function findIdempotentReplay(command, persistedState, commandId = "") {
  const replayKey = command.id || command.replayOf || commandId;
  if (!replayKey) return null;
  const prior = asRecord(persistedState.commands[replayKey]);
  if (!prior.status) return null;
  const activeDuplicate = ACTIVE_COMMAND_STATUSES.has(prior.status);
  const recoveryRequired = RECOVERY_COMMAND_STATUSES.has(prior.status) || activeDuplicate;
  return {
    replayed: true,
    commandId: replayKey,
    requestId: prior.requestId,
    status: prior.status,
    resultStatus: recoveryRequired ? prior.resultStatus || "handoff_required" : prior.resultStatus,
    completedAt: prior.completedAt,
    terminal: TERMINAL_COMMAND_STATUSES.has(prior.status),
    recoveryRequired,
    activeDuplicate,
    restartSafeReplay: TERMINAL_COMMAND_STATUSES.has(prior.status) || RECOVERY_COMMAND_STATUSES.has(prior.status),
    recoveryStatus: prior.recoveryStatus || (activeDuplicate ? "active_duplicate_replay" : ""),
    recoveryReason: prior.recoveryReason || (activeDuplicate ? "command_already_in_progress" : ""),
    resumeToken: prior.resumeToken || commandRecoveryResumeToken(prior.requestId, replayKey)
  };
}

function buildLifecycleNextAction({ decision, command, lifecycleSettings }) {
  if (!lifecycleSettings.scheduleValidation?.valid) {
    return {
      type: lifecycleSettings.scheduleValidation.nextActionType,
      dueAt: lifecycleSettings.scheduleValidation.actionableAt,
      reason: lifecycleSettings.scheduleValidation.nextActionReason,
      commandType: lifecycleSettings.scheduleValidation.correctiveCommand || command.type,
      blockingCodes: lifecycleSettings.scheduleValidation.blockingCodes
    };
  }
  if (lifecycleSettings.transition?.checkpointRequired) {
    return {
      type: "checkpoint_lifecycle",
      dueAt: "",
      reason: `lifecycle_${command.type}_requires_checkpoint`,
      commandType: command.type,
      controlChangeId: lifecycleSettings.transition.changeId,
      changedFields: lifecycleSettings.transition.changedFields
    };
  }
  if (decision.status === "blocked" && lifecycleSettings.enforcementMode === "disabled") {
    return {
      type: "enable_guard",
      dueAt: "",
      reason: "guard_disabled",
      commandType: "enable"
    };
  }
  if (decision.signals.lifecycleScheduleBlocked) {
    return {
      type: "wait_for_schedule",
      dueAt: lifecycleSettings.scheduleState.nextWindowOpensAt,
      reason: "outside_scheduled_window",
      commandType: "execute"
    };
  }
  if (decision.signals.recoveryRequired) {
    return {
      type: "recover_in_flight_command",
      dueAt: "",
      reason: decision.signals.recoveryReason || "restart_recovery_required",
      commandType: "recover"
    };
  }
  if (decision.requiresApproval) {
    return {
      type: "collect_approval",
      dueAt: "",
      reason: "destructive_action_requires_confirmation",
      commandType: "approve"
    };
  }
  if (LIFECYCLE_COMMAND_TYPES.has(command.type)) {
    return {
      type: "checkpoint_lifecycle",
      dueAt: "",
      reason: `lifecycle_${command.type}_applied`,
      commandType: command.type
    };
  }
  return {
    type: "none",
    dueAt: "",
    reason: "decision_complete",
    commandType: command.type
  };
}

function shapePersistedState({ now, request, command, persistedState, decision, replay, lifecycleSettings }) {
  const commandId = buildCommandId(request, command);
  const lifecycleNextAction = buildLifecycleNextAction({ decision, command, lifecycleSettings });
  const commandRecovery = persistedState.commandRecovery ?? {
    contractVersion: `${CONTRACT_VERSION}.command-recovery`,
    scannedAt: now,
    ttlMs: DEFAULT_IN_FLIGHT_COMMAND_TTL_MS,
    recoveredCount: 0,
    recovered: [],
    activeCommandIds: [],
    terminalCommandIds: [],
    recoveryRequiredCommandIds: [],
    currentCommandId: commandId,
    currentCommandRecovered: false,
    currentCommandState: summarizeCurrentPersistedCommand(persistedState.commands[commandId], commandId, Date.parse(now)),
    restartSafe: true,
    recoveryBlockingCodes: []
  };
  const currentCommandState = commandRecovery.currentCommandState ??
    summarizeCurrentPersistedCommand(persistedState.commands[commandId], commandId, Date.parse(now));
  const decisionRecord = {
    status: decision.status,
    requestId: request.id,
    commandId,
    recordedAt: now,
    recoveryStatus: replay ? "idempotent_replay" : "checkpointed",
    boundaryKey: boundaryKey(request.boundary),
    boundaryDenialCodes: decision.signals.boundary?.denialCodes ?? [],
    permissionBoundarySource: decision.signals.boundary?.permissionBoundary?.source || "",
    boundaryAudit: decision.signals.boundary ? buildBoundaryAuditShape(decision.signals.boundary) : null,
    externalOperation: {
      profile: request.externalOperation.profile,
      matched: request.externalOperation.matched,
      targetKind: request.externalOperation.targetKind,
      auditEventType: request.externalOperation.auditEventType,
      remoteRequestId: request.externalOperation.remoteRequestId,
      idempotencyKey: request.externalOperation.idempotencyKey,
      restartSafeKey: request.externalOperation.restartSafeKey,
      requiresApproval: request.externalOperation.requiresApproval
    }
  };
  const nextCommands = {
    ...persistedState.commands,
    [commandId]: {
      status: replay?.recoveryRequired ? "recovery_required" : replay ? "replayed" : "completed",
      requestId: request.id,
      commandId,
      resultStatus: decision.status,
      phase: replay?.recoveryRequired ? "recovery" : "terminal",
      startedAt: persistedState.commands[commandId]?.startedAt || now,
      lastSeenAt: now,
      completedAt: replay?.recoveryRequired ? "" : now,
      resumeToken: replay?.resumeToken || commandRecoveryResumeToken(request.id, commandId),
      recoveryStatus: replay?.recoveryStatus || "",
      recoveryReason: replay?.recoveryReason || "",
      terminal: !replay?.recoveryRequired,
      active: false,
      recoveryRequired: Boolean(replay?.recoveryRequired),
      restartSafe: true,
      idempotencyKey: persistedState.commands[commandId]?.idempotencyKey || commandId
    }
  };
  const orderedCommandEntries = Object.entries(nextCommands).slice(-DEFAULT_LEDGER_LIMIT);
  return {
    contractVersion: CONTRACT_VERSION,
    recoveredAt: persistedState.recoveredAt,
    approvals: persistedState.approvals,
    decisions: {
      ...persistedState.decisions,
      [request.id]: decisionRecord
    },
    commands: Object.fromEntries(orderedCommandEntries),
    lifecycle: {
      enabled: lifecycleSettings.enabled,
      enforcementMode: lifecycleSettings.enforcementMode,
      approvalTtlMs: lifecycleSettings.approvalTtlMs,
      schedule: lifecycleSettings.schedule,
      scheduleValidation: lifecycleSettings.scheduleValidation,
      transition: lifecycleSettings.transition,
      updatedAt: lifecycleSettings.controlAction ? now : persistedState.lifecycle.updatedAt,
      updatedBy: lifecycleSettings.controlAction?.actor || persistedState.lifecycle.updatedBy
    },
    recovery: {
      source: persistedState.recovery.source,
      durable: persistedState.recovery.durable,
      lastCheckpointAt: now
    },
    commandRecovery,
    restartSafeStatus: {
      status: decision.status,
      requestId: request.id,
      commandId,
      idempotentReplay: Boolean(replay),
      activeDuplicateReplay: Boolean(replay?.activeDuplicate),
      restartSafeReplay: Boolean(replay?.restartSafeReplay),
      recoveryRequired: Boolean(replay?.recoveryRequired),
      commandAlreadyInProgress: Boolean(currentCommandState.active && !currentCommandState.stale),
      recoveredCommandCount: commandRecovery.recoveredCount || 0,
      recoveryBlockingCodes: commandRecovery.recoveryBlockingCodes ?? [],
      checkpointRequired:
        !persistedState.recovery.durable ||
        Boolean(replay?.recoveryRequired) ||
        (commandRecovery.recoveryBlockingCodes ?? []).length > 0,
      resumeToken: `${CONTRACT_VERSION}:${request.id}:${commandId}`,
      commandResumeToken: replay?.resumeToken || commandRecoveryResumeToken(request.id, commandId),
      currentCommandState,
      nextAction: lifecycleNextAction,
      externalOperation: {
        profile: request.externalOperation.profile,
        matched: request.externalOperation.matched,
        targetKind: request.externalOperation.targetKind,
        remoteRequestId: request.externalOperation.remoteRequestId,
        idempotencyKey: request.externalOperation.idempotencyKey,
        remoteIdempotencyHeaders: request.externalOperation.remoteIdempotencyHeaders,
        restartSafeKey: request.externalOperation.restartSafeKey,
        requiresApproval: request.externalOperation.requiresApproval
      },
      boundary: {
        request: request.boundary,
        denialCodes: decision.signals.boundary?.denialCodes ?? [],
        permissionBoundarySource: decision.signals.boundary?.permissionBoundary?.source || "",
        audit: decision.signals.boundary ? buildBoundaryAuditShape(decision.signals.boundary) : null,
        explicitWorkspaceRequired: Boolean(decision.signals.boundary?.explicitWorkspaceRequired),
        workspaceScopeAmbiguous: Boolean(decision.signals.boundary?.workspaceScopeAmbiguous)
      }
    }
  };
}

function buildWorkflowHandoff(request, clientState, decision, lifecycleSettings, acknowledgementState, nowMs) {
  if (decision.status === "allowed") return null;
  const externalReporting = buildExternalServiceReportingSlice(request.externalOperation);
  const approvalExpiresAt = new Date(nowMs + lifecycleSettings.approvalTtlMs).toISOString();
  const requiredPermissions = ["destructive-action:execute"];
  if (decision.signals.boundary?.tenantScopeDenied) requiredPermissions.push("tenant:grant");
  if (decision.signals.boundary?.workspaceScopeDenied) requiredPermissions.push("workspace:grant");
  if (decision.signals.boundary?.crossTenantDenied) requiredPermissions.push("platform:admin");
  if (decision.signals.boundary?.tenantWide) requiredPermissions.push("tenant:admin");
  if (decision.signals.boundary?.crossWorkspaceDenied) requiredPermissions.push("workspace:admin");
  return {
    type: "destructive_action_confirmation",
    title: "Confirm destructive action",
    requestId: request.id,
    actor: clientState.actor,
    route: request.route,
    requiredCapability: "destructive-action:execute",
    requiredPermissions,
    boundary: {
      request: request.boundary,
      client: clientState.boundary,
      permissionBoundary: clientState.permissionBoundary,
      audit: decision.signals.boundary ? buildBoundaryAuditShape(decision.signals.boundary) : null,
      denialCodes: decision.signals.boundary?.denialCodes ?? [],
      blockedByTenantScope: Boolean(decision.signals.boundary?.tenantScopeDenied),
      blockedByWorkspaceScope: Boolean(decision.signals.boundary?.workspaceScopeDenied),
      blockedByTenantIsolation: Boolean(decision.signals.boundary?.crossTenantDenied),
      blockedByWorkspaceBoundary: Boolean(decision.signals.boundary?.crossWorkspaceDenied),
      blockedByAmbiguousWorkspaceScope: Boolean(decision.signals.boundary?.workspaceScopeAmbiguous),
      explicitWorkspaceRequired: Boolean(decision.signals.boundary?.explicitWorkspaceRequired),
      requestWorkspaceExplicit: Boolean(request.boundary.workspaceExplicit),
      requestWorkspaceSource: request.boundary.workspaceSource
    },
    approvalTokenShape: {
      requestId: request.id,
      previewId: buildPreviewId(request),
      target: request.target,
      granted: true,
      expiresAt: approvalExpiresAt,
      boundary: request.boundary,
      requiredAcknowledgementCodes: acknowledgementState.requiredCodes,
      bindingFingerprint: buildAcceptanceBindingFingerprint(buildAcceptanceBinding(request)),
      externalOperation: {
        profile: request.externalOperation.profile,
        targetKind: request.externalOperation.targetKind,
        remoteRequestId: request.externalOperation.remoteRequestId,
        idempotencyKey: request.externalOperation.idempotencyKey,
        restartSafeKey: request.externalOperation.restartSafeKey,
        reporting: externalReporting
      }
    },
    externalServiceHandoff: externalReporting.matched
      ? {
          profile: externalReporting.profile,
          targetKind: externalReporting.targetKind,
          reportingState: externalReporting.reportingState,
          dispatchMode: externalReporting.dispatchMode,
          safeToDispatch: externalReporting.safeToDispatch,
          requiresOperatorAcceptance: externalReporting.requiresOperatorAcceptance,
          checkpointRequired: externalReporting.checkpointRequired,
          checkpointId: externalReporting.checkpointId,
          previewRequired: externalReporting.previewRequired,
          confirmationRequired: externalReporting.confirmationRequired,
          expectedConfirmationPhrase: externalReporting.expectedConfirmationPhrase,
          remoteRequestId: externalReporting.remoteRequestId,
          idempotencyKey: externalReporting.idempotencyKey,
          remoteIdempotencyHeaders: externalReporting.remoteIdempotencyHeaders,
          replayFenceKey: externalReporting.replayFenceKey,
          restartSafeKey: externalReporting.restartSafeKey,
          nextActionId: externalReporting.nextActionId,
          nextActionOwner: externalReporting.nextActionOwner,
          reasonCodes: externalReporting.reportingCodes
        }
      : null,
    acknowledgementState,
    lifecycle: {
      enabled: lifecycleSettings.enabled,
      enforcementMode: lifecycleSettings.enforcementMode,
      schedule: lifecycleSettings.schedule,
      nextWindowOpensAt: lifecycleSettings.scheduleState.nextWindowOpensAt,
      nextWindowClosesAt: lifecycleSettings.scheduleState.nextWindowClosesAt,
      transition: lifecycleSettings.transition
    },
    userVisibleSummary: `${clientState.actor} requested ${request.operation || "a destructive operation"} on ${request.targetType}:${request.target}.`
  };
}

function buildClientRuntimeHandoff({
  now,
  request,
  command,
  clientState,
  workflowHandoff,
  userVisiblePreview,
  executionGate,
  explainableNextSteps
}) {
  const commandId = buildCommandId(request, command);
  if (!workflowHandoff) {
    return executionGate.lease
      ? {
          id: `${CONTRACT_VERSION}:lease:${request.id}:${commandId}`,
          requestId: request.id,
          commandId,
          status: "lease_issued",
          type: "destructive_action_execution_lease",
          reason: "guard_allows_request",
          route: request.route,
          assignedTo: clientState.actor,
          createdAt: now,
          expiresAt: executionGate.lease.expiresAt,
          previewId: userVisiblePreview.previewId,
          proofFingerprint: executionGate.proofFingerprint,
          primaryAction: "execute"
        }
      : null;
  }
  const primaryStep = explainableNextSteps.find((step) => step.userVisible) ?? explainableNextSteps[0];
  return {
    id: workflowHandoff.id || `${CONTRACT_VERSION}:client-handoff:${request.id}:${commandId}`,
    requestId: request.id,
    commandId,
    status: workflowHandoff.status || "pending",
    type: workflowHandoff.type,
    reason: primaryStep?.reason || workflowHandoff.reason || "destructive_action_requires_confirmation",
    route: request.route,
    assignedTo: clientState.actor,
    createdAt: now,
    expiresAt: workflowHandoff.approvalTokenShape?.expiresAt || "",
    previewId: userVisiblePreview.previewId,
    proofFingerprint: executionGate.proofFingerprint,
    primaryAction: primaryStep?.commandType || "approve"
  };
}

function handoffReceiptMatches(receipt, handoff, request, commandId) {
  if (receipt.handoffId && receipt.handoffId === handoff.id) return true;
  if (receipt.requestId && receipt.requestId !== (handoff.requestId || request.id)) return false;
  if (receipt.commandId && receipt.commandId !== (handoff.commandId || commandId)) return false;
  return Boolean(receipt.requestId || receipt.commandId);
}

function receiptStatus(action) {
  if (action === "complete") return "completed";
  if (action === "dismiss") return "dismissed";
  if (action === "cancel") return "cancelled";
  return "acknowledged";
}

function applyClientRuntimeReceipts({ runtime, request, commandId, actor, now }) {
  const appliedReceipts = [];
  const handoffs = runtime.handoffs.map((handoff) => {
    if (TERMINAL_HANDOFF_STATUSES.has(handoff.status)) return handoff;
    const receipt = runtime.handoffReceipts.find((candidate) =>
      handoffReceiptMatches(candidate, handoff, request, commandId)
    );
    if (!receipt) return handoff;
    const acknowledgedAt = receipt.acknowledgedAt || now;
    const acknowledgedBy = receipt.actor || actor;
    const next = {
      ...handoff,
      status: receiptStatus(receipt.action),
      acknowledgedAt,
      acknowledgedBy,
      proofFingerprint: receipt.proofFingerprint || handoff.proofFingerprint,
      clientNonce: receipt.clientNonce || handoff.clientNonce
    };
    appliedReceipts.push({
      receiptId: receipt.id || `${handoff.id}:receipt`,
      handoffId: handoff.id,
      requestId: handoff.requestId || request.id,
      commandId: handoff.commandId || commandId,
      action: receipt.action,
      status: next.status,
      acknowledgedAt,
      acknowledgedBy,
      outboxCursor: receipt.outboxCursor
    });
    return next;
  });
  return { handoffs, appliedReceipts };
}

function buildClientRuntimeOutbox({
  request,
  command,
  commandId,
  nextHandoff,
  workflowHandoff,
  executionGate,
  userVisiblePreview,
  explainableNextSteps,
  appliedReceipts,
  cursor
}) {
  const primaryStep = explainableNextSteps.find((step) => step.userVisible) ?? explainableNextSteps[0];
  const messages = [];
  for (const receipt of appliedReceipts) {
    messages.push({
      id: `${cursor}:receipt:${receipt.handoffId}`,
      type: "handoff_receipt",
      status: "ready",
      requestId: receipt.requestId,
      commandId: receipt.commandId,
      handoffId: receipt.handoffId,
      receiptAction: receipt.action,
      receiptStatus: receipt.status,
      acknowledgedAt: receipt.acknowledgedAt,
      acknowledgedBy: receipt.acknowledgedBy,
      cursor: receipt.outboxCursor || `${cursor}:receipt:${receipt.handoffId}`
    });
  }
  if (nextHandoff && workflowHandoff) {
    messages.push({
      id: `${cursor}:handoff:${nextHandoff.id}`,
      type: "handoff_request",
      status: "ready",
      requestId: request.id,
      commandId,
      handoffId: nextHandoff.id,
      route: request.route,
      previewId: userVisiblePreview.previewId,
      requiredPermissions: workflowHandoff.requiredPermissions,
      requiredAcknowledgementCodes: workflowHandoff.acknowledgementState.requiredCodes,
      confirmationPhrase: userVisiblePreview.acceptance.expectedConfirmationText,
      bindingFingerprint: userVisiblePreview.acceptance.expectedBindingFingerprint,
      cursor: `${cursor}:handoff`
    });
  }
  if (executionGate.lease) {
    messages.push({
      id: `${cursor}:lease:${commandId}`,
      type: "execution_lease",
      status: "ready",
      requestId: request.id,
      commandId,
      commandType: command.type,
      leaseToken: executionGate.lease.token,
      expiresAt: executionGate.lease.expiresAt,
      proofFingerprint: executionGate.proofFingerprint,
      cursor: `${cursor}:lease`
    });
  }
  return {
    contractVersion: `${CONTRACT_VERSION}.client-outbox`,
    cursor,
    messageCount: messages.length,
    nextCommandType: primaryStep?.commandType || "none",
    messages
  };
}

function buildClientRuntimeHandoffPresentation({
  request,
  command,
  commandId,
  runtime,
  nextHandoff,
  handoffs,
  outbox,
  workflowHandoff,
  userVisiblePreview,
  validationSummary,
  executionGate,
  primaryStep,
  handoffReconciliation
}) {
  const activeHandoff = nextHandoff
    ? nextHandoff
    : [...handoffs].reverse().find((handoff) => handoff.status === "pending") ?? null;
  const handoffMessage = activeHandoff
    ? outbox.messages.find((message) => message.handoffId === activeHandoff.id)
    : null;
  const leaseMessage = executionGate.lease
    ? outbox.messages.find((message) => message.type === "execution_lease")
    : null;
  const workflowBlocked = validationSummary.blockingCodes.length > 0;
  const requiresUserInput =
    Boolean(workflowHandoff) &&
    !workflowBlocked &&
    Boolean(userVisiblePreview.acceptance.required) &&
    !userVisiblePreview.acceptance.complete;
  const terminalReason = executionGate.lease
    ? "execution_lease_issued"
    : workflowBlocked
      ? validationSummary.blockingCodes[0] || "validation_blocked"
      : userVisiblePreview.acceptance.complete
        ? "acceptance_complete"
        : "";
  const nextClientCommandType = requiresUserInput
    ? "approve"
    : executionGate.lease
      ? "execute"
      : primaryStep?.commandType || command.type;
  const primaryAction = requiresUserInput
    ? "submit_acceptance"
    : executionGate.lease
      ? "execute_with_lease"
      : workflowBlocked
        ? "resolve_blockers"
        : primaryStep?.type || "review";
  const visibleState = requiresUserInput
    ? "awaiting_user_acceptance"
    : executionGate.lease
      ? "lease_ready"
      : workflowBlocked
        ? "blocked"
        : activeHandoff
          ? activeHandoff.status
          : "idle";
  return {
    contractVersion: `${CONTRACT_VERSION}.client-handoff-presentation`,
    requestId: request.id,
    commandId,
    route: request.route,
    previousInboxCursor: runtime.inboxCursor,
    nextInboxCursor: outbox.cursor,
    activeHandoffId: activeHandoff?.id || "",
    activeHandoffStatus: activeHandoff?.status || "",
    assignedTo: activeHandoff?.assignedTo || "",
    visible: Boolean(activeHandoff) || workflowBlocked || Boolean(executionGate.lease),
    visibleState,
    requiresUserInput,
    terminalReason,
    primaryAction,
    nextClientCommandType,
    nextActionReason:
      handoffReconciliation.continuityCodes[0] ||
      validationSummary.blockingCodes[0] ||
      primaryStep?.reason ||
      terminalReason ||
      "decision_recorded",
    previewId: userVisiblePreview.previewId,
    proofFingerprint: executionGate.proofFingerprint,
    confirmationPhrase: requiresUserInput
      ? userVisiblePreview.acceptance.expectedConfirmationText
      : "",
    requiredAcknowledgementCodes: requiresUserInput
      ? userVisiblePreview.acceptance.requiredAcknowledgementCodes
      : [],
    missingAcknowledgements: requiresUserInput
      ? userVisiblePreview.acceptance.missingAcknowledgements
      : [],
    handoffMessageId: handoffMessage?.id || "",
    leaseMessageId: leaseMessage?.id || "",
    outboxCursor: handoffMessage?.cursor || leaseMessage?.cursor || outbox.messages.at(-1)?.cursor || "",
    workflowContinuityHealthy: handoffReconciliation.workflowContinuityHealthy,
    workflowContinuityCodes: handoffReconciliation.continuityCodes,
    staleClientRuntime:
      !handoffReconciliation.workflowContinuityHealthy ||
      (runtime.lastSeenRequestId === request.id && runtime.lastSeenCommandId !== commandId),
    clientResumeToken: `${CONTRACT_VERSION}:client:${request.id}:${commandId}:${nextClientCommandType}`
  };
}

function buildClientRuntimeState({
  now,
  request,
  command,
  clientState,
  workflowHandoff,
  userVisiblePreview,
  executionGate,
  explainableNextSteps,
  validationSummary,
  handoffReconciliation
}) {
  const commandId = buildCommandId(request, command);
  const runtime = clientState.guardRuntime;
  const receiptResult = applyClientRuntimeReceipts({
    runtime,
    request,
    commandId,
    actor: clientState.actor,
    now
  });
  const nextHandoff = buildClientRuntimeHandoff({
    now,
    request,
    command,
    clientState,
    workflowHandoff,
    userVisiblePreview,
    executionGate,
    explainableNextSteps
  });
  const previousHandoffs = receiptResult.handoffs.filter(
    (handoff) => handoff.requestId !== request.id || handoff.commandId !== commandId
  );
  const handoffs = nextHandoff
    ? [...previousHandoffs, nextHandoff].slice(-DEFAULT_CLIENT_HANDOFF_LIMIT)
    : previousHandoffs;
  const activeHandoffId =
    nextHandoff && nextHandoff.status !== "lease_issued"
      ? nextHandoff.id
      : [...handoffs].reverse().find((handoff) => handoff.status === "pending")?.id || "";
  const unreadCount = handoffs.filter(
    (handoff) => handoff.status === "pending" && !handoff.acknowledgedAt
  ).length;
  const cursor = `${CONTRACT_VERSION}.client-runtime:${request.id}:${commandId}`;
  const outbox = buildClientRuntimeOutbox({
    request,
    command,
    commandId,
    nextHandoff,
    workflowHandoff,
    executionGate,
    userVisiblePreview,
    explainableNextSteps,
    appliedReceipts: receiptResult.appliedReceipts,
    cursor
  });
  const primaryStep = explainableNextSteps.find((step) => step.userVisible) ?? explainableNextSteps[0];
  const handoffPresentation = buildClientRuntimeHandoffPresentation({
    request,
    command,
    commandId,
    runtime,
    nextHandoff,
    handoffs,
    outbox,
    workflowHandoff,
    userVisiblePreview,
    validationSummary,
    executionGate,
    primaryStep,
    handoffReconciliation
  });
  return {
    contractVersion: `${CONTRACT_VERSION}.client-runtime`,
    updatedAt: now,
    clientId: clientState.id,
    actor: clientState.actor,
    route: request.route,
    boundary: {
      request: request.boundary,
      client: clientState.boundary,
      permissionBoundary: clientState.permissionBoundary
    },
    inboxCursor: cursor,
    previousInboxCursor: runtime.inboxCursor,
    outboxCursor: outbox.messages.at(-1)?.cursor || runtime.outboxCursor,
    activeHandoffId,
    unreadCount,
    handoffReconciliation,
    handoffs,
    appliedReceipts: receiptResult.appliedReceipts,
    outbox,
    current: nextHandoff,
    handoffPresentation,
    uiState: {
      visible: Boolean(nextHandoff) || !validationSummary.valid,
      severity: validationSummary.blockingCodes.length
        ? "error"
        : workflowHandoff
          ? "warning"
          : executionGate.lease
            ? "success"
            : "info",
      title: workflowHandoff
        ? "Destructive action needs approval"
        : executionGate.lease
          ? "Destructive action lease issued"
          : "Destructive action guard updated",
      primaryAction: nextHandoff?.primaryAction || primaryStep?.commandType || "none",
      nextStepType: primaryStep?.type || "none",
      handoffVisibleState: handoffPresentation.visibleState,
      requiresUserInput: handoffPresentation.requiresUserInput,
      clientResumeToken: handoffPresentation.clientResumeToken,
      previewId: userVisiblePreview.previewId,
      proofFingerprint: executionGate.proofFingerprint,
      outboxMessageCount: outbox.messageCount,
      appliedReceiptCount: receiptResult.appliedReceipts.length,
      workflowContinuityHealthy: handoffReconciliation.workflowContinuityHealthy,
      workflowContinuityCodes: handoffReconciliation.continuityCodes
    }
  };
}

function buildValidationSummary(validationIssues, operationalHealth, finalDecision) {
  const blocking = validationIssues.filter((issue) => issue.severity === "error");
  const warnings = validationIssues.filter((issue) => issue.severity === "warning");
  return {
    valid: operationalHealth.ready,
    status: operationalHealth.status,
    decisionStatus: finalDecision.status,
    counts: {
      errors: blocking.length,
      warnings: warnings.length,
      total: validationIssues.length
    },
    blockingCodes: blocking.map((issue) => issue.code),
    warningCodes: warnings.map((issue) => issue.code),
    summaryText: blocking.length
      ? `${blocking.length} blocking guard validation issue(s) must be resolved before execution.`
      : warnings.length
        ? `${warnings.length} guard readiness warning(s) should be reviewed before execution.`
      : "Guard validation passed for this destructive-action request."
  };
}

function buildPreviewAcceptanceReadiness({
  request,
  command,
  clientState,
  finalDecision,
  previewAcceptance,
  acknowledgementState,
  validationSummary,
  explainableNextSteps
}) {
  const acceptanceRequired =
    finalDecision.requiresApproval || finalDecision.status === "handoff_required";
  const hasExecutePermission = hasPermission(clientState, "destructive-action:execute");
  const primaryStep = explainableNextSteps.find((step) => step.userVisible) ?? explainableNextSteps[0];
  const expectedBinding = previewAcceptance.binding.expectedBinding;
  const submittedFields = [
    previewAcceptance.accepted ? "accepted" : "",
    previewAcceptance.confirmationText ? "confirmationText" : "",
    previewAcceptance.bindingFingerprint ? "bindingFingerprint" : "",
    previewAcceptance.binding.submittedPreviewId ? "previewId" : "",
    previewAcceptance.binding.submittedRequestId ? "requestId" : "",
    previewAcceptance.acknowledgedRiskCodes.length ? "acknowledgedRiskCodes" : ""
  ].filter(Boolean);
  const checks = [
    {
      id: "guard_validation",
      required: true,
      satisfied: validationSummary.valid,
      severity: validationSummary.blockingCodes.length ? "error" : validationSummary.warningCodes.length ? "warning" : "none",
      blockingCodes: validationSummary.blockingCodes,
      nextField: "",
      expectedValue: "valid"
    },
    {
      id: "preview_acceptance",
      required: acceptanceRequired,
      satisfied: !acceptanceRequired || previewAcceptance.accepted,
      severity: acceptanceRequired && !previewAcceptance.accepted ? "error" : "none",
      blockingCodes: acceptanceRequired && !previewAcceptance.accepted ? ["preview_acceptance_required"] : [],
      nextField: "accepted",
      expectedValue: true
    },
    {
      id: "confirmation_phrase",
      required: acceptanceRequired,
      satisfied: !acceptanceRequired || previewAcceptance.confirmationMatches,
      severity: acceptanceRequired && !previewAcceptance.confirmationMatches ? "error" : "none",
      blockingCodes: acceptanceRequired && !previewAcceptance.confirmationMatches ? ["preview_confirmation_mismatch"] : [],
      nextField: "confirmationText",
      expectedValue: previewAcceptance.expectedConfirmationText
    },
    {
      id: "preview_binding",
      required: acceptanceRequired,
      satisfied: !acceptanceRequired || previewAcceptance.bindingMatches,
      severity: acceptanceRequired && !previewAcceptance.bindingMatches ? "error" : "none",
      blockingCodes: acceptanceRequired
        ? [...previewAcceptance.binding.requiredFieldCodes, ...previewAcceptance.binding.mismatchCodes]
        : [],
      nextField: "bindingFingerprint",
      expectedValue: previewAcceptance.expectedBindingFingerprint
    },
    {
      id: "risk_acknowledgements",
      required: acceptanceRequired && acknowledgementState.requiredCodes.length > 0,
      satisfied: !acceptanceRequired || acknowledgementState.complete,
      severity: acceptanceRequired && !acknowledgementState.complete ? "error" : "none",
      blockingCodes: acknowledgementState.missingCodes,
      nextField: "acknowledgedRiskCodes",
      expectedValue: acknowledgementState.requiredCodes
    },
    {
      id: "approver_permission",
      required: acceptanceRequired,
      satisfied: !acceptanceRequired || hasExecutePermission,
      severity: acceptanceRequired && !hasExecutePermission ? "error" : "none",
      blockingCodes: acceptanceRequired && !hasExecutePermission ? ["approval_permission_denied"] : [],
      nextField: "clientState.permissions",
      expectedValue: "destructive-action:execute"
    }
  ];
  const blockingChecks = checks.filter((check) => check.required && check.blockingCodes.length > 0);
  const unsatisfiedRequiredChecks = checks.filter((check) => check.required && !check.satisfied);
  const missingFields = unsatisfiedRequiredChecks
    .map((check) => check.nextField)
    .filter((field) => field && !submittedFields.includes(field));
  const blockingCodes = blockingChecks.flatMap((check) => check.blockingCodes);
  const hardBlockingCodes = [
    ...validationSummary.blockingCodes,
    ...previewAcceptance.binding.mismatchCodes,
    acceptanceRequired && !hasExecutePermission ? "approval_permission_denied" : ""
  ].filter(Boolean);
  const payloadTemplate = {
    previewId: buildPreviewId(request),
    requestId: request.id,
    commandType: "approve",
    accepted: true,
    confirmationText: previewAcceptance.expectedConfirmationText,
    bindingFingerprint: previewAcceptance.expectedBindingFingerprint,
    acknowledgedRiskCodes: acknowledgementState.requiredCodes,
    acceptedBy: clientState.actor,
    operation: request.operation,
    target: request.target,
    targetType: request.targetType,
    route: request.route,
    boundary: request.boundary
  };
  return {
    contractVersion: `${CONTRACT_VERSION}.acceptance-readiness`,
    requestId: request.id,
    commandId: buildCommandId(request, command),
    previewId: buildPreviewId(request),
    required: acceptanceRequired,
    submittedFields,
    missingFields,
    blockingCodes,
    checks,
    submitReady:
      acceptanceRequired &&
      validationSummary.valid &&
      unsatisfiedRequiredChecks.length === 0 &&
      blockingCodes.length === 0,
    canRenderForm: acceptanceRequired,
    canAttemptSubmission:
      acceptanceRequired &&
      validationSummary.valid &&
      hasExecutePermission &&
      previewAcceptance.binding.mismatchCodes.length === 0,
    hardBlockingCodes,
    nextField: missingFields[0] || unsatisfiedRequiredChecks[0]?.nextField || "",
    nextAction: {
      type: primaryStep?.type || (acceptanceRequired ? "accept_preview" : "none"),
      commandType: primaryStep?.commandType || (acceptanceRequired ? "approve" : command.type),
      reason: blockingCodes[0] || primaryStep?.reason || "acceptance_ready",
      dueAt: primaryStep?.dueAt || ""
    },
    expectedBinding,
    expectedBindingFingerprint: previewAcceptance.expectedBindingFingerprint,
    payloadTemplate
  };
}

function buildExplainableNextSteps({ finalDecision, validationSummary, retryPlan, lifecycleSettings }) {
  if (validationSummary.blockingCodes.length) {
    return validationSummary.blockingCodes.map((code) => ({
      type: "resolve_validation",
      reason: code,
      commandType: retryPlan.retryable ? "evaluate" : "recover",
      dueAt: retryPlan.nextAttemptAt,
      userVisible: true
    }));
  }
  if (finalDecision.signals.lifecycleScheduleBlocked) {
    return [
      {
        type: "wait_for_schedule",
        reason: "outside_scheduled_window",
        commandType: "execute",
        dueAt: lifecycleSettings.scheduleState.nextWindowOpensAt,
        userVisible: true
      }
    ];
  }
  if (finalDecision.signals.recoveryRequired) {
    return [
      {
        type: "recover_in_flight_command",
        reason: finalDecision.signals.recoveryReason || "restart_recovery_required",
        commandType: "recover",
        dueAt: "",
        userVisible: true
      }
    ];
  }
  if (finalDecision.requiresApproval) {
    return [
      {
        type: "accept_preview",
        reason: "destructive_action_requires_confirmation",
        commandType: "approve",
        dueAt: "",
        userVisible: true
      }
    ];
  }
  return [
    {
      type: "execute_or_checkpoint",
      reason: finalDecision.status === "allowed" ? "guard_allows_request" : "decision_recorded",
      commandType: finalDecision.status === "allowed" ? "execute" : "recover",
      dueAt: "",
      userVisible: finalDecision.status !== "allowed"
    }
  ];
}

function buildUserVisiblePreview({
  request,
  clientState,
  finalDecision,
  lifecycleSettings,
  previewAcceptance,
  acknowledgementState,
  validationSummary,
  explainableNextSteps,
  acceptanceReadiness
}) {
  const blockedReasons = [
    ...validationSummary.blockingCodes,
    finalDecision.signals.boundary?.tenantScopeDenied ? "tenant_not_in_permission_boundary" : "",
    finalDecision.signals.boundary?.workspaceScopeDenied ? "workspace_not_in_permission_boundary" : "",
    finalDecision.signals.boundary?.crossTenantDenied ? "cross_tenant_boundary" : "",
    finalDecision.signals.boundary?.crossWorkspaceDenied ? "cross_workspace_boundary" : "",
    finalDecision.signals.boundary?.workspaceScopeAmbiguous ? "explicit_workspace_scope_required" : "",
    finalDecision.signals.lifecycleGuardDisabled ? "guard_disabled" : "",
    finalDecision.signals.lifecycleScheduleBlocked ? "outside_scheduled_window" : ""
  ].filter(Boolean);
  const acceptanceRequired = finalDecision.requiresApproval || finalDecision.status === "handoff_required";
  return {
    contractVersion: `${CONTRACT_VERSION}.preview`,
    previewId: buildPreviewId(request),
    title: "Destructive action preview",
    summary: `${clientState.actor} is requesting ${request.operation || "an action"} on ${request.targetType}:${request.target}.`,
    impact: {
      operation: request.operation,
      target: request.target,
      targetType: request.targetType,
      route: request.route,
      boundary: request.boundary,
      permissionBoundary: clientState.permissionBoundary,
      boundaryAudit: finalDecision.signals.boundary
        ? buildBoundaryAuditShape(finalDecision.signals.boundary)
        : null,
      boundaryDenialCodes: finalDecision.signals.boundary?.denialCodes ?? [],
      dryRun: request.dryRun,
      destructive: finalDecision.signals.destructiveOperation,
      guardedOperation: finalDecision.signals.guardedOperation,
      deploymentOperation: finalDecision.signals.deploymentOperation,
      privilegedMutation: finalDecision.signals.privilegedMutation,
      irreversibleOperation: finalDecision.signals.irreversibleOperation,
      operationFamily: finalDecision.signals.operationFamily,
      operationTokens: finalDecision.signals.operationTokens,
      matchedOperations: finalDecision.signals.matchedOperations,
      classificationSources: finalDecision.signals.classificationSources,
      guardedOperationClassifications: finalDecision.signals.guardedOperationClassifications,
      externalOperation: {
        profile: request.externalOperation.profile,
        matched: request.externalOperation.matched,
        targetKind: request.externalOperation.targetKind,
        auditEventType: request.externalOperation.auditEventType,
        remoteRequestId: request.externalOperation.remoteRequestId,
        idempotencyKey: request.externalOperation.idempotencyKey,
        remoteIdempotencyHeaders: request.externalOperation.remoteIdempotencyHeaders,
        matchedDestructiveOperations: request.externalOperation.matchedDestructiveOperations,
        matchedPrivilegedOperations: request.externalOperation.matchedPrivilegedOperations,
        requiresApproval: request.externalOperation.requiresApproval,
        restartSafeKey: request.externalOperation.restartSafeKey,
        quotaHandoff: {
          required: request.externalOperation.boundaryProtocol.quotaHandoff.required,
          ready: request.externalOperation.boundaryProtocol.quotaHandoff.ready,
          state: request.externalOperation.boundaryProtocol.quotaHandoff.state,
          accepted: request.externalOperation.boundaryProtocol.quotaHandoff.accepted,
          acceptedAt: request.externalOperation.boundaryProtocol.quotaHandoff.acceptedAt,
          acceptanceAgeMs: request.externalOperation.boundaryProtocol.quotaHandoff.acceptanceAgeMs,
          acceptanceMaxAgeMs: request.externalOperation.boundaryProtocol.quotaHandoff.acceptanceMaxAgeMs,
          acceptanceStale: request.externalOperation.boundaryProtocol.quotaHandoff.acceptanceStale,
          nextActionId: request.externalOperation.boundaryProtocol.quotaHandoff.nextAction.actionId,
          violationCodes: request.externalOperation.boundaryProtocol.quotaHandoff.violationCodes
        }
      },
      sensitiveTarget: finalDecision.signals.sensitiveTarget,
      broadScope: finalDecision.signals.broadScope
    },
    readiness: {
      readyForExecution: finalDecision.status === "allowed" && validationSummary.valid,
      readyForApproval: acceptanceRequired && validationSummary.valid,
      status: validationSummary.status,
      blockedReasons,
      warningCodes: validationSummary.warningCodes
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: previewAcceptance.accepted,
      previewId: previewAcceptance.previewId,
      acceptedAt: previewAcceptance.acceptedAt,
      acceptedBy: previewAcceptance.acceptedBy || clientState.actor,
      expectedConfirmationText: previewAcceptance.expectedConfirmationText,
      confirmationMatches: previewAcceptance.confirmationMatches,
      expectedBinding: previewAcceptance.binding.expectedBinding,
      expectedBindingFingerprint: previewAcceptance.expectedBindingFingerprint,
      submittedBindingFingerprint: previewAcceptance.bindingFingerprint,
      operationComparison: previewAcceptance.binding.operationComparison,
      expectedOperationTokens: previewAcceptance.binding.expectedOperationTokens,
      submittedOperation: previewAcceptance.binding.submittedOperation,
      submittedOperationTokens: previewAcceptance.binding.submittedOperationTokens,
      bindingRequiredFields: previewAcceptance.binding.requiredFieldCodes,
      bindingMismatchCodes: previewAcceptance.binding.mismatchCodes,
      bindingMatches: previewAcceptance.bindingMatches,
      requiredAcknowledgementCodes: acknowledgementState.requiredCodes,
      acknowledgedRiskCodes: acknowledgementState.acknowledgedCodes,
      missingAcknowledgements: acknowledgementState.missingCodes,
      unexpectedAcknowledgements: acknowledgementState.unexpectedCodes,
      complete: acknowledgementState.complete && previewAcceptance.bindingMatches
    },
    acceptanceReadiness,
    validationSummary,
    nextSteps: explainableNextSteps
  };
}

function checklistStatus({ blocked, warning, complete, pending }) {
  if (blocked) return "blocked";
  if (warning) return "warning";
  if (complete) return "complete";
  if (pending) return "pending";
  return "ready";
}

function buildRoutePreviewAcceptanceContract({
  now,
  request,
  command,
  clientState,
  userVisiblePreview,
  acceptanceReadiness,
  validationSummary,
  explainableNextSteps,
  workflowHandoff,
  executionGate
}) {
  const primaryStep = explainableNextSteps.find((step) => step.userVisible) ?? explainableNextSteps[0];
  const acceptance = userVisiblePreview.acceptance;
  const readiness = userVisiblePreview.readiness;
  const validationBlocking = validationSummary.blockingCodes.length > 0;
  const acceptanceInputReasons = [
    acceptance.required && acceptance.missingAcknowledgements.length ? "missing_acknowledgements" : "",
    acceptance.required && acceptance.bindingRequiredFields.length ? "missing_binding_fields" : "",
    acceptance.required && !acceptance.confirmationMatches ? "confirmation_required" : ""
  ].filter(Boolean);
  const disabledReasons = [
    validationBlocking ? "blocking_validation" : "",
    readiness.blockedReasons.length ? "blocked_readiness" : "",
    acceptance.required && acceptance.bindingMismatchCodes.length ? "binding_mismatch" : "",
    ...acceptanceReadiness.hardBlockingCodes.filter(
      (code) => !validationSummary.blockingCodes.includes(code)
    ),
    executionGate.requiredCheckpoint ? "checkpoint_required" : ""
  ].filter(Boolean);
  const checklist = [
    {
      id: "validation",
      label: "Guard validation",
      status: checklistStatus({
        blocked: validationBlocking,
        warning: validationSummary.warningCodes.length > 0,
        complete: validationSummary.valid
      }),
      codes: [...validationSummary.blockingCodes, ...validationSummary.warningCodes],
      action: validationBlocking ? "resolve_validation" : "review"
    },
    {
      id: "readiness",
      label: "Execution readiness",
      status: checklistStatus({
        blocked: readiness.blockedReasons.length > 0,
        warning: readiness.warningCodes.length > 0,
        complete: readiness.readyForExecution || readiness.readyForApproval
      }),
      codes: [...readiness.blockedReasons, ...readiness.warningCodes],
      action: readiness.readyForExecution ? "execute" : readiness.readyForApproval ? "approve" : "wait"
    },
    {
      id: "acceptance",
      label: "Preview acceptance",
      status: checklistStatus({
        blocked:
          acceptance.required &&
          (disabledReasons.includes("missing_acknowledgements") ||
            disabledReasons.includes("missing_binding_fields") ||
            disabledReasons.includes("binding_mismatch")),
        complete: !acceptance.required || acceptance.complete,
        pending: acceptance.required && !acceptance.complete
      }),
      codes: acceptance.required
        ? [
            ...acceptance.missingAcknowledgements,
            ...acceptance.bindingRequiredFields,
            ...acceptance.bindingMismatchCodes
          ]
        : [],
      action: acceptance.required ? "accept_preview" : "not_required"
    },
    {
      id: "handoff",
      label: "Client handoff",
      status: workflowHandoff
        ? "pending"
        : executionGate.lease
          ? "complete"
          : primaryStep?.type === "resolve_validation"
            ? "blocked"
            : "not_required",
      codes: workflowHandoff?.boundary?.denialCodes ?? [],
      action: workflowHandoff ? "dispatch_handoff" : executionGate.lease ? "execute" : primaryStep?.type || "none"
    }
  ];
  return {
    contractVersion: `${CONTRACT_VERSION}.route-preview-acceptance`,
    generatedAt: now,
    route: request.route,
    requestId: request.id,
    commandId: buildCommandId(request, command),
    surfaceId,
    previewId: userVisiblePreview.previewId,
    actor: clientState.actor,
    status: validationBlocking
      ? "blocked"
      : acceptance.required
        ? acceptance.complete
          ? "accepted"
          : "awaiting_acceptance"
        : executionGate.executable
          ? "ready_to_execute"
          : "ready",
    banner: {
      severity: validationBlocking
        ? "error"
        : disabledReasons.length
          ? "warning"
          : executionGate.lease
            ? "success"
            : "info",
      title: userVisiblePreview.title,
      summary: userVisiblePreview.summary,
      primaryAction: primaryStep?.commandType || "none",
      disabledReasons
    },
    checklist,
    validationPanel: {
      status: validationSummary.status,
      summaryText: validationSummary.summaryText,
      blockingCodes: validationSummary.blockingCodes,
      warningCodes: validationSummary.warningCodes,
      firstActionType: primaryStep?.type || "none",
      firstActionReason: primaryStep?.reason || ""
    },
    acceptanceReadiness,
    acceptanceForm: {
      endpoint: PROVIDER_SERVICE_ENDPOINTS.approval,
      method: "POST",
      visible: acceptance.required,
      enabled: acceptance.required && !validationBlocking,
      submitEnabled: acceptance.required && acceptanceReadiness.canAttemptSubmission && disabledReasons.length === 0,
      submitDisabledReasons: disabledReasons,
      inputPendingReasons: acceptanceInputReasons,
      readinessStatus: acceptanceReadiness.submitReady
        ? "accepted_payload_ready"
        : acceptanceReadiness.canAttemptSubmission
          ? "awaiting_user_input"
          : acceptanceReadiness.canRenderForm
            ? "blocked"
            : "not_required",
      nextField: acceptanceReadiness.nextField,
      missingFields: acceptanceReadiness.missingFields,
      blockingCodes: acceptanceReadiness.blockingCodes,
      requiredFields: acceptance.required
        ? [
            "previewId",
            "requestId",
            "accepted",
            "confirmationText",
            "bindingFingerprint",
            "acknowledgedRiskCodes"
          ]
        : [],
      body: {
        ...acceptanceReadiness.payloadTemplate,
        clientNonce: acceptance.previewId
      }
    },
    nextStep: {
      type: primaryStep?.type || "none",
      commandType: primaryStep?.commandType || command.type,
      reason: primaryStep?.reason || "decision_complete",
      dueAt: primaryStep?.dueAt || "",
      userVisible: Boolean(primaryStep?.userVisible)
    },
    executionLease: executionGate.lease
      ? {
          issued: true,
          token: executionGate.lease.token,
          expiresAt: executionGate.lease.expiresAt,
          proofFingerprint: executionGate.proofFingerprint
        }
      : {
          issued: false,
          blockedBy: executionGate.blockers.map((blocker) => blocker.code),
          proofFingerprint: executionGate.proofFingerprint
        }
  };
}

function buildAuditProof({ now, request, clientState, decision, evidence }) {
  return {
    proofType: "capability-security.destructive-action-guard.audit",
    contractVersion: CONTRACT_VERSION,
    generatedAt: now,
    subject: {
      requestId: request.id,
      clientId: clientState.id,
      actor: clientState.actor,
      route: request.route,
      boundary: {
        request: request.boundary,
        client: clientState.boundary
      },
      permissionBoundary: clientState.permissionBoundary
    },
    decision: {
      status: decision.status,
      riskScore: decision.riskScore,
      approved: decision.approved,
      requiresApproval: decision.requiresApproval,
      signals: decision.signals
    },
    externalOperation: {
      profile: request.externalOperation.profile,
      matched: request.externalOperation.matched,
      targetKind: request.externalOperation.targetKind,
      auditEventType: request.externalOperation.auditEventType,
      remoteRequestId: request.externalOperation.remoteRequestId,
      idempotencyKey: request.externalOperation.idempotencyKey,
      restartSafeKey: request.externalOperation.restartSafeKey,
      requiresApproval: request.externalOperation.requiresApproval
    },
    evidence
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildProofFingerprint(parts) {
  const text = stableStringify(parts);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${EXECUTION_GATE_VERSION}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildExecutionBlockers({ command, finalDecision, validationSummary, lifecycleSettings, degradedMode }) {
  const blockers = validationSummary.blockingCodes.map((code) => ({
    code,
    source: "validation",
    recoverable: code !== "unsupported_command_type"
  }));
  for (const code of lifecycleSettings.scheduleValidation?.blockingCodes ?? []) {
    if (blockers.some((blocker) => blocker.code === code)) continue;
    blockers.push({
      code,
      source: "lifecycle_schedule",
      recoverable: code !== "inverted_schedule_window"
    });
  }
  if (command.type !== "execute") {
    blockers.push({ code: "not_execute_command", source: "command", recoverable: true });
  }
  if (finalDecision.status !== "allowed") {
    blockers.push({ code: `decision_${finalDecision.status}`, source: "decision", recoverable: true });
  }
  if (finalDecision.requiresApproval) {
    blockers.push({ code: "approval_required", source: "approval", recoverable: true });
  }
  for (const code of finalDecision.signals.boundary?.denialCodes ?? []) {
    blockers.push({
      code,
      source: "permission_boundary",
      recoverable: !code.startsWith("cross_tenant")
    });
  }
  if (finalDecision.signals.lifecycleGuardDisabled) {
    blockers.push({ code: "guard_disabled", source: "lifecycle", recoverable: true });
  }
  if (finalDecision.signals.lifecycleScheduleBlocked) {
    blockers.push({
      code: "outside_scheduled_window",
      source: "lifecycle",
      recoverable: Boolean(lifecycleSettings.scheduleState.nextWindowOpensAt)
    });
  }
  if (degradedMode.checkpointRequired) {
    blockers.push({ code: "checkpoint_required", source: "recovery", recoverable: true });
  }
  return blockers;
}

function buildHostedKernelExecutionGate({
  now,
  nowMs,
  request,
  command,
  clientState,
  finalDecision,
  lifecycleSettings,
  validationSummary,
  degradedMode,
  recovery
}) {
  const commandId = buildCommandId(request, command);
  const blockers = buildExecutionBlockers({
    command,
    finalDecision,
    validationSummary,
    lifecycleSettings,
    degradedMode
  });
  const guardedExecution =
    command.type === "execute" && !request.dryRun && finalDecision.signals.guardedOperation;
  const executable =
    command.type === "execute" &&
    finalDecision.status === "allowed" &&
    validationSummary.valid &&
    blockers.length === 0;
  const leaseExpiresAt = executable
    ? new Date(nowMs + Math.min(lifecycleSettings.approvalTtlMs, DEFAULT_APPROVAL_TTL_MS)).toISOString()
    : "";
  const proofFingerprint = buildProofFingerprint({
    requestId: request.id,
    commandId,
    actor: clientState.actor,
    status: finalDecision.status,
    boundary: request.boundary,
    permissionBoundarySource: finalDecision.signals.boundary?.permissionBoundary?.source || "",
    boundaryDenialCodes: finalDecision.signals.boundary?.denialCodes ?? [],
    boundaryScope: finalDecision.signals.boundary
      ? {
          requestWorkspaceExplicit: Boolean(finalDecision.signals.boundary.requestBoundary.workspaceExplicit),
          requestWorkspaceSource: finalDecision.signals.boundary.requestBoundary.workspaceSource,
          explicitWorkspaceRequired: Boolean(finalDecision.signals.boundary.explicitWorkspaceRequired),
          workspaceScopeAmbiguous: Boolean(finalDecision.signals.boundary.workspaceScopeAmbiguous)
        }
      : null,
    guardedExecution,
    operationFamily: finalDecision.signals.operationFamily,
    operationTokens: finalDecision.signals.operationTokens,
    matchedOperations: finalDecision.signals.matchedOperations,
    externalOperation: {
      profile: request.externalOperation.profile,
      targetKind: request.externalOperation.targetKind,
      remoteRequestId: request.externalOperation.remoteRequestId,
      idempotencyKey: request.externalOperation.idempotencyKey,
      restartSafeKey: request.externalOperation.restartSafeKey,
      requiresApproval: request.externalOperation.requiresApproval
    },
    classificationSources: finalDecision.signals.classificationSources,
    guardedOperationClassifications: finalDecision.signals.guardedOperationClassifications,
    leaseExpiresAt,
    blockers: blockers.map((blocker) => blocker.code),
    recoveryToken: recovery.resumeToken
  });
  return {
    contractVersion: EXECUTION_GATE_VERSION,
    generatedAt: now,
    commandId,
    requestId: request.id,
    route: request.route,
    executable,
    sideEffectsPermitted: executable && guardedExecution,
    guardedExecution,
    operationFamily: finalDecision.signals.operationFamily,
    operationTokens: finalDecision.signals.operationTokens,
    matchedOperations: finalDecision.signals.matchedOperations,
    externalOperation: {
      profile: request.externalOperation.profile,
      matched: request.externalOperation.matched,
      targetKind: request.externalOperation.targetKind,
      auditEventType: request.externalOperation.auditEventType,
      remoteRequestId: request.externalOperation.remoteRequestId,
      idempotencyKey: request.externalOperation.idempotencyKey,
      remoteIdempotencyHeaders: request.externalOperation.remoteIdempotencyHeaders,
      restartSafeKey: request.externalOperation.restartSafeKey,
      requiresApproval: request.externalOperation.requiresApproval
    },
    classificationSources: finalDecision.signals.classificationSources,
    guardedOperationClassifications: finalDecision.signals.guardedOperationClassifications,
    dryRun: request.dryRun,
    boundary: {
      request: request.boundary,
      permissionBoundarySource: finalDecision.signals.boundary?.permissionBoundary?.source || "",
      denialCodes: finalDecision.signals.boundary?.denialCodes ?? [],
      audit: finalDecision.signals.boundary ? buildBoundaryAuditShape(finalDecision.signals.boundary) : null
    },
    mode: executable ? "lease_issued" : blockers.length ? "blocked" : "monitor_only",
    lease: executable
      ? {
          token: `${EXECUTION_GATE_VERSION}:${request.id}:${commandId}:${proofFingerprint.split(":").at(-1)}`,
          expiresAt: leaseExpiresAt,
          actor: clientState.actor,
          boundary: request.boundary,
          operation: request.operation,
          operationFamily: finalDecision.signals.operationFamily,
          operationTokens: finalDecision.signals.operationTokens,
          matchedOperations: finalDecision.signals.matchedOperations,
          guardedOperationClassifications: finalDecision.signals.guardedOperationClassifications,
          externalOperation: {
            profile: request.externalOperation.profile,
            targetKind: request.externalOperation.targetKind,
            remoteRequestId: request.externalOperation.remoteRequestId,
            idempotencyKey: request.externalOperation.idempotencyKey,
            restartSafeKey: request.externalOperation.restartSafeKey
          },
          target: request.target,
          targetType: request.targetType
        }
      : null,
    blockers,
    requiredCheckpoint: degradedMode.checkpointRequired,
    recoveryToken: recovery.resumeToken,
    proofFingerprint
  };
}

function buildAnalyticsSnapshot({
  now,
  nowMs,
  request,
  command,
  clientState,
  finalDecision,
  validationSummary,
  executionGate,
  recovery,
  lifecycleSettings
}) {
  const commandId = buildCommandId(request, command);
  const externalReporting = buildExternalServiceReportingSlice(request.externalOperation);
  const mailchimpOperation = buildMailchimpOperationAnalyticsSlice({ request, externalReporting });
  const blockerCodes = executionGate.blockers.map((blocker) => blocker.code);
  const validationCodes = [
    ...validationSummary.blockingCodes,
    ...validationSummary.warningCodes
  ];
  const approvalSlaMs = Math.min(
    lifecycleSettings.approvalTtlMs,
    DEFAULT_APPROVAL_REPORTING_SLA_MS
  );
  const approvalSlaDueAt =
    finalDecision.requiresApproval && !finalDecision.approved
      ? new Date(nowMs + approvalSlaMs).toISOString()
      : "";
  const leaseExpiresAt = executionGate.lease?.expiresAt || "";
  const leaseExpiresAtMs = Date.parse(leaseExpiresAt);
  const leaseExpiresSoon =
    Number.isFinite(leaseExpiresAtMs) &&
    leaseExpiresAtMs > nowMs &&
    leaseExpiresAtMs - nowMs <= DEFAULT_LEASE_EXPIRY_WARNING_MS;
  const exportHealthCodes = [
    blockerCodes.length ? "blocked_export_row" : "",
    validationCodes.length ? "validation_signals_present" : "",
    externalReporting.matched && externalReporting.reportingState !== "dispatch-ready"
      ? `external_service_${externalReporting.reportingState}` : "",
    externalReporting.matched && !externalReporting.remoteIdempotencyHeaderNames.length
      ? "external_service_idempotency_header_missing" : "",
    mailchimpOperation.matched && mailchimpOperation.blockingCodes.length
      ? "mailchimp_export_blocked" : "",
    finalDecision.requiresApproval && !approvalSlaDueAt ? "approval_sla_due_at_missing" : "",
    leaseExpiresSoon ? "execution_lease_expires_soon" : ""
  ].filter(Boolean);
  return {
    id: `${CONTRACT_VERSION}.analytics:${request.id}:${commandId}`,
    recordedAt: now,
    requestId: request.id,
    commandId,
    actor: clientState.actor,
    status: finalDecision.status,
    operation: request.operation,
    targetType: request.targetType,
    route: request.route,
    boundaryKey: boundaryKey(request.boundary),
    permissionBoundarySource: finalDecision.signals.boundary?.permissionBoundary?.source || "",
    boundaryDenialCodes: finalDecision.signals.boundary?.denialCodes ?? [],
    requestWorkspaceExplicit: Boolean(finalDecision.signals.boundary?.requestBoundary.workspaceExplicit),
    requestWorkspaceSource: finalDecision.signals.boundary?.requestBoundary.workspaceSource || "",
    explicitWorkspaceRequired: Boolean(finalDecision.signals.boundary?.explicitWorkspaceRequired),
    workspaceScopeAmbiguous: Boolean(finalDecision.signals.boundary?.workspaceScopeAmbiguous),
    riskScore: finalDecision.riskScore,
    requiresApproval: finalDecision.requiresApproval,
    approved: finalDecision.approved,
    destructive: finalDecision.signals.destructiveOperation,
    guardedOperation: finalDecision.signals.guardedOperation,
    deploymentOperation: finalDecision.signals.deploymentOperation,
    privilegedMutation: finalDecision.signals.privilegedMutation,
    irreversibleOperation: finalDecision.signals.irreversibleOperation,
    operationFamily: finalDecision.signals.operationFamily,
    riskBand: riskBandForScore(finalDecision.riskScore),
    operationTokens: finalDecision.signals.operationTokens,
    matchedDestructiveOperations: finalDecision.signals.matchedOperations?.destructive ?? [],
    matchedDeploymentOperations: finalDecision.signals.matchedOperations?.deployment ?? [],
    matchedPrivilegedMutationOperations: finalDecision.signals.matchedOperations?.privilegedMutation ?? [],
    matchedIrreversibleOperations: finalDecision.signals.matchedOperations?.irreversible ?? [],
    guardedOperationClassifications: finalDecision.signals.guardedOperationClassifications,
    externalServiceProfile: externalReporting.profile,
    externalServiceTargetKind: externalReporting.targetKind,
    externalServiceReportingState: externalReporting.reportingState,
    externalServiceDispatchMode: externalReporting.dispatchMode,
    externalServiceSafeToDispatch: externalReporting.safeToDispatch,
    externalServiceRequiresAcceptance: externalReporting.requiresOperatorAcceptance,
    externalServiceCheckpointRequired: externalReporting.checkpointRequired,
    externalServicePreviewRequired: externalReporting.previewRequired,
    externalServiceReplayFenceKey: externalReporting.replayFenceKey,
    externalServiceRemoteRequestId: externalReporting.remoteRequestId,
    externalServiceIdempotencyKey: externalReporting.idempotencyKey,
    externalServiceRemoteHeaderNames: externalReporting.remoteIdempotencyHeaderNames,
    externalServiceReportingCodes: externalReporting.reportingCodes,
    externalServiceNextActionId: externalReporting.nextActionId,
    mailchimpOperation,
    dryRun: request.dryRun,
    gateMode: executionGate.mode,
    executable: executionGate.executable,
    sideEffectsPermitted: executionGate.sideEffectsPermitted,
    approvalSlaDueAt,
    approvalSlaMs,
    approvalSlaBreached: false,
    leaseExpiresAt,
    leaseExpiresSoon,
    blockerCodes,
    validationCodes,
    exportHealthCodes,
    nextActionType: recovery.nextAction?.type || "none",
    proofFingerprint: executionGate.proofFingerprint
  };
}

function buildAnalyticsCounters({ persistedAnalytics, snapshot, command, replay, degradedMode }) {
  let counters = {
    ...persistedAnalytics.counters,
    totalDecisions: asNonNegativeInteger(persistedAnalytics.counters.totalDecisions, 0) + 1
  };
  if (snapshot.destructive) counters = incrementCounter(counters, "destructiveDecisions");
  if (snapshot.guardedOperation) counters = incrementCounter(counters, "guardedOperationDecisions");
  if (snapshot.deploymentOperation) counters = incrementCounter(counters, "deploymentOperationDecisions");
  if (snapshot.privilegedMutation) counters = incrementCounter(counters, "privilegedMutationDecisions");
  if (snapshot.irreversibleOperation) counters = incrementCounter(counters, "irreversibleOperationDecisions");
  if (snapshot.dryRun) counters = incrementCounter(counters, "dryRunDecisions");
  if (snapshot.requiresApproval) counters = incrementCounter(counters, "approvalRequiredDecisions");
  if (snapshot.approvalSlaDueAt) counters = incrementCounter(counters, "approvalSlaTrackedDecisions");
  if (snapshot.approvalSlaBreached) counters = incrementCounter(counters, "approvalSlaBreachedDecisions");
  if (snapshot.approved) counters = incrementCounter(counters, "approvedDecisions");
  if (snapshot.executable) counters = incrementCounter(counters, "executableLeases");
  if (snapshot.sideEffectsPermitted) counters = incrementCounter(counters, "sideEffectsPermitted");
  if (snapshot.leaseExpiresAt) counters = incrementCounter(counters, "leaseExpiryTrackedDecisions");
  if (snapshot.leaseExpiresSoon) counters = incrementCounter(counters, "leaseExpiringSoonDecisions");
  if (snapshot.blockerCodes.length) counters = incrementCounter(counters, "blockedByPolicyOrReadiness");
  if (snapshot.validationCodes.length) counters = incrementCounter(counters, "decisionsWithValidationSignals");
  if (snapshot.exportHealthCodes.length) counters = incrementCounter(counters, "decisionsWithExportHealthSignals");
  if (snapshot.externalServiceProfile !== "generic" || snapshot.externalServiceReportingState !== "not-external") {
    counters = incrementCounter(counters, "externalServiceDecisions");
    counters = incrementCounter(counters, `externalServiceProfile.${snapshot.externalServiceProfile}`);
    counters = incrementCounter(counters, `externalServiceTargetKind.${snapshot.externalServiceTargetKind}`);
    counters = incrementCounter(counters, `externalServiceState.${snapshot.externalServiceReportingState}`);
  }
  if (snapshot.externalServiceRequiresAcceptance) counters = incrementCounter(counters, "externalServiceAcceptanceRequired");
  if (snapshot.externalServiceSafeToDispatch) counters = incrementCounter(counters, "externalServiceDispatchReady");
  if (snapshot.externalServiceCheckpointRequired) counters = incrementCounter(counters, "externalServiceCheckpointRequired");
  if (snapshot.externalServicePreviewRequired) counters = incrementCounter(counters, "externalServicePreviewRequired");
  if (snapshot.mailchimpOperation?.matched) {
    counters = incrementCounter(counters, "mailchimpDecisions");
    counters = incrementCounter(counters, `mailchimpTargetKind.${snapshot.mailchimpOperation.targetKind}`);
    counters = incrementCounter(counters, `mailchimpReportingState.${snapshot.mailchimpOperation.reportingState}`);
    if (snapshot.mailchimpOperation.exportReady) counters = incrementCounter(counters, "mailchimpExportReadyDecisions");
    if (snapshot.mailchimpOperation.requiresOperatorAcceptance) counters = incrementCounter(counters, "mailchimpAcceptanceRequiredDecisions");
    if (snapshot.mailchimpOperation.campaignDispatch) counters = incrementCounter(counters, "mailchimpCampaignDispatchDecisions");
    if (snapshot.mailchimpOperation.audienceMutation) counters = incrementCounter(counters, "mailchimpAudienceMutationDecisions");
    if (snapshot.mailchimpOperation.journeyMutation) counters = incrementCounter(counters, "mailchimpJourneyMutationDecisions");
    if (snapshot.mailchimpOperation.blockingCodes.length) counters = incrementCounter(counters, "mailchimpBlockedExportDecisions");
  }
  counters = incrementCounter(counters, `riskBand.${snapshot.riskBand || riskBandForScore(snapshot.riskScore)}`);
  if (replay) counters = incrementCounter(counters, "idempotentReplays");
  if (degradedMode.active) counters = incrementCounter(counters, "degradedModeDecisions");
  if (LIFECYCLE_COMMAND_TYPES.has(command.type)) counters = incrementCounter(counters, "lifecycleControlCommands");
  return {
    counters,
    statusCounts: incrementCounter(persistedAnalytics.statusCounts, snapshot.status),
    operationCounts: incrementCounter(persistedAnalytics.operationCounts, snapshot.operation || "unknown"),
    targetTypeCounts: incrementCounter(persistedAnalytics.targetTypeCounts, snapshot.targetType || "resource"),
    actorCounts: incrementCounter(persistedAnalytics.actorCounts, snapshot.actor || "unknown-actor")
  };
}

function buildAnalyticsTrendState(history, counters) {
  const previous = history.at(-2) ?? null;
  const latest = history.at(-1) ?? null;
  const recentWindow = history.slice(-5);
  const totalRisk = recentWindow.reduce((sum, entry) => sum + asNonNegativeInteger(entry.riskScore, 0), 0);
  const maxRisk = recentWindow.reduce(
    (highest, entry) => Math.max(highest, asNonNegativeInteger(entry.riskScore, 0)),
    0
  );
  const currentStatusStreak = latest
    ? [...history]
        .reverse()
        .findIndex((entry) => entry.status !== latest.status)
    : 0;
  return {
    contractVersion: `${CONTRACT_VERSION}.analytics-trends`,
    latestStatus: latest?.status || "none",
    previousStatus: previous?.status || "none",
    statusChanged: Boolean(previous && latest && previous.status !== latest.status),
    riskScoreDelta: latest && previous ? latest.riskScore - previous.riskScore : 0,
    recentWindowSize: recentWindow.length,
    recentAverageRiskScore: recentWindow.length ? Number((totalRisk / recentWindow.length).toFixed(2)) : 0,
    recentMaxRiskScore: maxRisk,
    currentStatusStreak: currentStatusStreak === -1 ? history.length : currentStatusStreak,
    destructiveDecisionRatio: counters.totalDecisions
      ? Number((asNonNegativeInteger(counters.destructiveDecisions, 0) / counters.totalDecisions).toFixed(4))
      : 0,
    guardedOperationDecisionRatio: counters.totalDecisions
      ? Number((asNonNegativeInteger(counters.guardedOperationDecisions, 0) / counters.totalDecisions).toFixed(4))
      : 0,
    approvalRequiredRatio: counters.totalDecisions
      ? Number((asNonNegativeInteger(counters.approvalRequiredDecisions, 0) / counters.totalDecisions).toFixed(4))
      : 0
  };
}

function buildAnalyticsActionQueue(history) {
  return [...history]
    .reverse()
    .filter((entry) => {
      if (entry.nextActionType && entry.nextActionType !== "none") return true;
      if (entry.requiresApproval || entry.blockerCodes.length) return true;
      return entry.status !== "allowed" && entry.status !== "completed";
    })
    .map((entry) => {
      const blocked = entry.status === "blocked" || entry.blockerCodes.length > 0;
      const approval = entry.requiresApproval || entry.nextActionType === "collect_approval";
      const actionType = entry.nextActionType && entry.nextActionType !== "none"
        ? entry.nextActionType
        : approval
          ? "collect_approval"
          : blocked
            ? "resolve_blockers"
            : "review_decision";
      return {
        id: `${CONTRACT_VERSION}.analytics-action:${entry.requestId}:${entry.commandId}`,
        requestId: entry.requestId,
        commandId: entry.commandId,
        actionType,
        priority: blocked ? "high" : entry.riskScore >= 3 ? "elevated" : "normal",
        status: entry.status,
        recordedAt: entry.recordedAt,
        actor: entry.actor,
        gateMode: entry.gateMode,
        riskScore: entry.riskScore,
        operationFamily: entry.operationFamily,
        operationTokens: entry.operationTokens,
        matchedDestructiveOperations: entry.matchedDestructiveOperations,
        matchedDeploymentOperations: entry.matchedDeploymentOperations,
        matchedPrivilegedMutationOperations: entry.matchedPrivilegedMutationOperations,
        matchedIrreversibleOperations: entry.matchedIrreversibleOperations,
        guardedOperationClassifications: entry.guardedOperationClassifications,
        externalServiceProfile: entry.externalServiceProfile,
        externalServiceTargetKind: entry.externalServiceTargetKind,
        externalServiceReportingState: entry.externalServiceReportingState,
        externalServiceDispatchMode: entry.externalServiceDispatchMode,
        externalServiceRequiresAcceptance: entry.externalServiceRequiresAcceptance,
        externalServiceSafeToDispatch: entry.externalServiceSafeToDispatch,
        externalServiceReportingCodes: entry.externalServiceReportingCodes,
        externalServiceNextActionId: entry.externalServiceNextActionId,
        mailchimpOperation: entry.mailchimpOperation,
        permissionBoundarySource: entry.permissionBoundarySource,
        boundaryDenialCodes: entry.boundaryDenialCodes,
        blockerCodes: entry.blockerCodes,
        validationCodes: entry.validationCodes,
        proofFingerprint: entry.proofFingerprint
      };
    })
    .slice(0, DEFAULT_EXPORT_ACTION_LIMIT);
}

function buildAnalyticsExportRows(history) {
  return history.map((entry) => ({
    recordedAt: entry.recordedAt,
    requestId: entry.requestId,
    commandId: entry.commandId,
    actor: entry.actor,
    operation: entry.operation || "unknown",
    operationFamily: entry.operationFamily || "standard",
    operationTokens: entry.operationTokens.join("|"),
    matchedDestructiveOperations: entry.matchedDestructiveOperations.join("|"),
    matchedDeploymentOperations: entry.matchedDeploymentOperations.join("|"),
    matchedPrivilegedMutationOperations: entry.matchedPrivilegedMutationOperations.join("|"),
    matchedIrreversibleOperations: entry.matchedIrreversibleOperations.join("|"),
    guardedOperation: entry.guardedOperation,
    deploymentOperation: entry.deploymentOperation,
    privilegedMutation: entry.privilegedMutation,
    irreversibleOperation: entry.irreversibleOperation,
    guardedOperationClassifications: entry.guardedOperationClassifications.join("|"),
    externalServiceProfile: entry.externalServiceProfile || "generic",
    externalServiceTargetKind: entry.externalServiceTargetKind || "generic",
    externalServiceReportingState: entry.externalServiceReportingState || "not-external",
    externalServiceDispatchMode: entry.externalServiceDispatchMode || "",
    externalServiceSafeToDispatch: entry.externalServiceSafeToDispatch,
    externalServiceRequiresAcceptance: entry.externalServiceRequiresAcceptance,
    externalServiceCheckpointRequired: entry.externalServiceCheckpointRequired,
    externalServicePreviewRequired: entry.externalServicePreviewRequired,
    externalServiceReplayFenceKey: entry.externalServiceReplayFenceKey,
    externalServiceRemoteRequestId: entry.externalServiceRemoteRequestId,
    externalServiceIdempotencyKey: entry.externalServiceIdempotencyKey,
    externalServiceRemoteHeaderNames: entry.externalServiceRemoteHeaderNames.join("|"),
    externalServiceReportingCodes: entry.externalServiceReportingCodes.join("|"),
    externalServiceNextActionId: entry.externalServiceNextActionId,
    mailchimpMatched: entry.mailchimpOperation?.matched === true,
    mailchimpReportingState: entry.mailchimpOperation?.reportingState || "not-mailchimp",
    mailchimpTargetKind: entry.mailchimpOperation?.targetKind || "generic",
    mailchimpSummaryKey: entry.mailchimpOperation?.summaryKey || "",
    mailchimpRemoteRequestId: entry.mailchimpOperation?.remoteRequestId || "",
    mailchimpIdempotencyKey: entry.mailchimpOperation?.idempotencyKey || "",
    mailchimpRemoteIdempotencyHeaderNames: (entry.mailchimpOperation?.remoteIdempotencyHeaderNames || []).join("|"),
    mailchimpCheckpointRequired: entry.mailchimpOperation?.checkpointRequired === true,
    mailchimpCheckpointId: entry.mailchimpOperation?.checkpointId || "",
    mailchimpPreviewRequired: entry.mailchimpOperation?.previewRequired === true,
    mailchimpRequiresOperatorAcceptance: entry.mailchimpOperation?.requiresOperatorAcceptance === true,
    mailchimpSafeToDispatch: entry.mailchimpOperation?.safeToDispatch === true,
    mailchimpExportReady: entry.mailchimpOperation?.exportReady === true,
    mailchimpNextActionId: entry.mailchimpOperation?.nextActionId || "",
    mailchimpExportTags: (entry.mailchimpOperation?.exportTags || []).join("|"),
    mailchimpBlockingCodes: (entry.mailchimpOperation?.blockingCodes || []).join("|"),
    targetType: entry.targetType || "resource",
    boundaryKey: entry.boundaryKey,
    permissionBoundarySource: entry.permissionBoundarySource,
    boundaryDenialCodes: entry.boundaryDenialCodes.join("|"),
    requestWorkspaceExplicit: entry.requestWorkspaceExplicit,
    requestWorkspaceSource: entry.requestWorkspaceSource,
    explicitWorkspaceRequired: entry.explicitWorkspaceRequired,
    workspaceScopeAmbiguous: entry.workspaceScopeAmbiguous,
    status: entry.status,
    gateMode: entry.gateMode,
    riskScore: entry.riskScore,
    riskBand: entry.riskBand || riskBandForScore(entry.riskScore),
    requiresApproval: entry.requiresApproval,
    executable: entry.executable,
    sideEffectsPermitted: entry.sideEffectsPermitted,
    approvalSlaDueAt: entry.approvalSlaDueAt,
    approvalSlaBreached: entry.approvalSlaBreached,
    leaseExpiresAt: entry.leaseExpiresAt,
    leaseExpiresSoon: entry.leaseExpiresSoon,
    blockerCodes: entry.blockerCodes.join("|"),
    validationCodes: entry.validationCodes.join("|"),
    exportHealthCodes: entry.exportHealthCodes.join("|"),
    nextActionType: entry.nextActionType || "none",
    proofFingerprint: entry.proofFingerprint
  }));
}

function riskBandForScore(score) {
  const normalized = asNonNegativeInteger(score, 0);
  if (normalized >= 6) return "critical";
  if (normalized >= 4) return "high";
  if (normalized >= 2) return "elevated";
  return "low";
}

function buildApprovalSlaState(entry, nowMs) {
  const dueAtMs = Date.parse(entry.approvalSlaDueAt);
  const pendingApproval =
    entry.requiresApproval &&
    !entry.approved &&
    !entry.sideEffectsPermitted &&
    !["allowed", "completed", "replayed"].includes(entry.status);
  const dueInMs = Number.isFinite(dueAtMs) ? dueAtMs - nowMs : 0;
  return {
    pendingApproval,
    dueAt: pendingApproval ? entry.approvalSlaDueAt : "",
    dueInMs: pendingApproval && Number.isFinite(dueAtMs) ? dueInMs : 0,
    breached: pendingApproval && Number.isFinite(dueAtMs) && dueInMs <= 0,
    riskBand: entry.riskBand || riskBandForScore(entry.riskScore)
  };
}

function buildLeaseExpiryState(entry, nowMs) {
  const expiresAtMs = Date.parse(entry.leaseExpiresAt);
  const hasLease = Boolean(entry.leaseExpiresAt);
  const expiresInMs = Number.isFinite(expiresAtMs) ? expiresAtMs - nowMs : 0;
  return {
    hasLease,
    expiresAt: hasLease ? entry.leaseExpiresAt : "",
    expiresInMs: hasLease && Number.isFinite(expiresAtMs) ? expiresInMs : 0,
    expired: hasLease && Number.isFinite(expiresAtMs) && expiresInMs <= 0,
    expiresSoon:
      hasLease &&
      Number.isFinite(expiresAtMs) &&
      expiresInMs > 0 &&
      expiresInMs <= DEFAULT_LEASE_EXPIRY_WARNING_MS
  };
}

function buildAnalyticsExportHealth(entry, nowMs) {
  const approvalSla = buildApprovalSlaState(entry, nowMs);
  const leaseExpiry = buildLeaseExpiryState(entry, nowMs);
  return [
    approvalSla.breached ? "approval_sla_breached" : "",
    approvalSla.pendingApproval && !approvalSla.dueAt ? "approval_sla_due_at_missing" : "",
    leaseExpiry.expired ? "execution_lease_expired" : "",
    leaseExpiry.expiresSoon ? "execution_lease_expires_soon" : "",
    entry.blockerCodes.length ? "blocked_export_row" : "",
    entry.validationCodes.length ? "validation_signals_present" : "",
    entry.externalServiceReportingState && !["not-external", "dispatch-ready"].includes(entry.externalServiceReportingState)
      ? `external_service_${entry.externalServiceReportingState}` : "",
    entry.externalServiceReportingCodes.length ? "external_service_reporting_codes_present" : ""
  ].filter(Boolean);
}

function buildAnalyticsTimelineEvent(entry, nowMs) {
  const approvalSla = buildApprovalSlaState(entry, nowMs);
  const leaseExpiry = buildLeaseExpiryState(entry, nowMs);
  const exportHealthCodes = buildAnalyticsExportHealth(entry, nowMs);
  const eventType = approvalSla.breached
    ? "approval_sla_breached"
    : leaseExpiry.expired
      ? "lease_expired"
      : leaseExpiry.expiresSoon
        ? "lease_expiring"
        : entry.blockerCodes.length
          ? "blocked_decision"
          : entry.requiresApproval
            ? "approval_pending"
            : entry.executable
              ? "lease_issued"
              : "decision_recorded";
  return {
    id: `${CONTRACT_VERSION}.analytics-timeline:${entry.requestId}:${entry.commandId}`,
    at: entry.recordedAt,
    requestId: entry.requestId,
    commandId: entry.commandId,
    eventType,
    status: entry.status,
    gateMode: entry.gateMode,
    riskScore: entry.riskScore,
    riskBand: approvalSla.riskBand,
    operationFamily: entry.operationFamily,
    guardedOperationClassifications: entry.guardedOperationClassifications,
    externalService: {
      profile: entry.externalServiceProfile,
      targetKind: entry.externalServiceTargetKind,
      reportingState: entry.externalServiceReportingState,
      dispatchMode: entry.externalServiceDispatchMode,
      safeToDispatch: entry.externalServiceSafeToDispatch,
      requiresAcceptance: entry.externalServiceRequiresAcceptance,
      nextActionId: entry.externalServiceNextActionId,
      reportingCodes: entry.externalServiceReportingCodes
    },
    mailchimpOperation: {
      matched: entry.mailchimpOperation?.matched === true,
      reportingState: entry.mailchimpOperation?.reportingState || "not-mailchimp",
      targetKind: entry.mailchimpOperation?.targetKind || "generic",
      exportReady: entry.mailchimpOperation?.exportReady === true,
      summaryKey: entry.mailchimpOperation?.summaryKey || "",
      nextActionId: entry.mailchimpOperation?.nextActionId || "",
      blockingCodes: entry.mailchimpOperation?.blockingCodes || [],
      exportTags: entry.mailchimpOperation?.exportTags || []
    },
    nextActionType: entry.nextActionType,
    approvalSla,
    leaseExpiry,
    blockerCount: entry.blockerCodes.length,
    validationCount: entry.validationCodes.length,
    exportHealthCodes,
    proofFingerprint: entry.proofFingerprint
  };
}

function buildAnalyticsReporting({
  now,
  nowMs,
  request,
  command,
  clientState,
  finalDecision,
  validationSummary,
  degradedMode,
  executionGate,
  recovery,
  lifecycleSettings,
  persistedAnalytics,
  replay
}) {
  const snapshot = buildAnalyticsSnapshot({
    now,
    nowMs,
    request,
    command,
    clientState,
    finalDecision,
    validationSummary,
    executionGate,
    recovery,
    lifecycleSettings
  });
  const nextCounts = buildAnalyticsCounters({
    persistedAnalytics,
    snapshot,
    command,
    replay,
    degradedMode
  });
  const historyLimit = persistedAnalytics.historyLimit || DEFAULT_HISTORY_LIMIT;
  const history = [...persistedAnalytics.history, snapshot]
    .slice(-historyLimit)
    .map((entry) => {
      const approvalSla = buildApprovalSlaState(entry, nowMs);
      const leaseExpiry = buildLeaseExpiryState(entry, nowMs);
      return {
        ...entry,
        riskBand: entry.riskBand || riskBandForScore(entry.riskScore),
        approvalSlaBreached: approvalSla.breached,
        leaseExpiresSoon: leaseExpiry.expiresSoon,
        exportHealthCodes: buildAnalyticsExportHealth(entry, nowMs)
      };
    });
  const retainedDecisionCount = history.length;
  const droppedDecisionCount = Math.max(0, nextCounts.counters.totalDecisions - retainedDecisionCount);
  const trendState = buildAnalyticsTrendState(history, nextCounts.counters);
  const actionQueue = buildAnalyticsActionQueue(history);
  const exportRows = buildAnalyticsExportRows(history);
  const timeline = history.map((entry) => buildAnalyticsTimelineEvent(entry, nowMs));
  const alertSummary = {
    approvalSlaBreachedCount: timeline.filter((event) => event.approvalSla.breached).length,
    pendingApprovalCount: timeline.filter((event) => event.approvalSla.pendingApproval).length,
    leaseExpiredCount: timeline.filter((event) => event.leaseExpiry.expired).length,
    leaseExpiringSoonCount: timeline.filter((event) => event.leaseExpiry.expiresSoon).length,
    blockedDecisionCount: timeline.filter((event) => event.blockerCount > 0).length,
    exportHealthSignalCount: timeline.reduce(
      (count, event) => count + event.exportHealthCodes.length,
      0
    ),
    highestRiskBand:
      ["critical", "high", "elevated", "low"].find((band) =>
        timeline.some((event) => event.riskBand === band)
      ) || "low"
  };
  const mailchimpHistory = history.filter((entry) => entry.mailchimpOperation?.matched);
  const mailchimpExportRows = exportRows.filter((row) => row.mailchimpMatched);
  const mailchimpReporting = {
    contractVersion: `${CONTRACT_VERSION}.mailchimp-reporting`,
    matchedDecisionCount: mailchimpHistory.length,
    exportReadyDecisionCount: mailchimpHistory.filter((entry) => entry.mailchimpOperation.exportReady).length,
    blockedExportDecisionCount: mailchimpHistory.filter((entry) => entry.mailchimpOperation.blockingCodes.length).length,
    acceptanceRequiredDecisionCount: mailchimpHistory.filter((entry) => entry.mailchimpOperation.requiresOperatorAcceptance).length,
    targetKindCounts: mailchimpHistory.reduce((counts, entry) => incrementCounter(counts, entry.mailchimpOperation.targetKind), {}),
    reportingStateCounts: mailchimpHistory.reduce((counts, entry) => incrementCounter(counts, entry.mailchimpOperation.reportingState), {}),
    latest: snapshot.mailchimpOperation,
    nextActionIds: Array.from(new Set(mailchimpHistory
      .map((entry) => entry.mailchimpOperation.nextActionId)
      .filter(Boolean)
    )).sort(),
    blockingCodes: Array.from(new Set(mailchimpHistory
      .flatMap((entry) => entry.mailchimpOperation.blockingCodes)
    )).sort(),
    exportTags: Array.from(new Set(mailchimpHistory
      .flatMap((entry) => entry.mailchimpOperation.exportTags)
    )).sort()
  };
  const exportSummary = {
    contractVersion: `${CONTRACT_VERSION}.analytics-export`,
    generatedAt: now,
    exportId: `${CONTRACT_VERSION}:export:${request.id}:${snapshot.commandId}`,
    surfaceId,
    scope: {
      route: request.route,
      tenantId: request.boundary.tenantId,
      workspaceId: request.boundary.workspaceId,
      actor: clientState.actor
    },
    totals: nextCounts.counters,
    breakdowns: {
      byStatus: nextCounts.statusCounts,
      byOperation: nextCounts.operationCounts,
      byTargetType: nextCounts.targetTypeCounts,
      byActor: nextCounts.actorCounts
    },
    latestDecision: {
      requestId: snapshot.requestId,
      commandId: snapshot.commandId,
      status: snapshot.status,
      gateMode: snapshot.gateMode,
      guardedOperation: snapshot.guardedOperation,
      deploymentOperation: snapshot.deploymentOperation,
      privilegedMutation: snapshot.privilegedMutation,
      irreversibleOperation: snapshot.irreversibleOperation,
      operationFamily: snapshot.operationFamily,
      riskBand: snapshot.riskBand,
      operationTokens: snapshot.operationTokens,
      matchedDestructiveOperations: snapshot.matchedDestructiveOperations,
      matchedDeploymentOperations: snapshot.matchedDeploymentOperations,
      matchedPrivilegedMutationOperations: snapshot.matchedPrivilegedMutationOperations,
      matchedIrreversibleOperations: snapshot.matchedIrreversibleOperations,
      guardedOperationClassifications: snapshot.guardedOperationClassifications,
      externalServiceProfile: snapshot.externalServiceProfile,
      externalServiceTargetKind: snapshot.externalServiceTargetKind,
      externalServiceReportingState: snapshot.externalServiceReportingState,
      externalServiceDispatchMode: snapshot.externalServiceDispatchMode,
      externalServiceSafeToDispatch: snapshot.externalServiceSafeToDispatch,
      externalServiceRequiresAcceptance: snapshot.externalServiceRequiresAcceptance,
      externalServiceCheckpointRequired: snapshot.externalServiceCheckpointRequired,
      externalServicePreviewRequired: snapshot.externalServicePreviewRequired,
      externalServiceReplayFenceKey: snapshot.externalServiceReplayFenceKey,
      externalServiceRemoteRequestId: snapshot.externalServiceRemoteRequestId,
      externalServiceRemoteHeaderNames: snapshot.externalServiceRemoteHeaderNames,
      externalServiceReportingCodes: snapshot.externalServiceReportingCodes,
      externalServiceNextActionId: snapshot.externalServiceNextActionId,
      mailchimpOperation: snapshot.mailchimpOperation,
      executable: snapshot.executable,
      sideEffectsPermitted: snapshot.sideEffectsPermitted,
      approvalSlaDueAt: snapshot.approvalSlaDueAt,
      approvalSlaBreached: snapshot.approvalSlaBreached,
      leaseExpiresAt: snapshot.leaseExpiresAt,
      leaseExpiresSoon: snapshot.leaseExpiresSoon,
      permissionBoundarySource: snapshot.permissionBoundarySource,
      boundaryDenialCodes: snapshot.boundaryDenialCodes,
      blockerCodes: snapshot.blockerCodes,
      validationCodes: snapshot.validationCodes,
      exportHealthCodes: snapshot.exportHealthCodes,
      proofFingerprint: snapshot.proofFingerprint
    },
    retention: {
      historyLimit,
      retainedDecisionCount,
      droppedDecisionCount,
      oldestRetainedAt: history[0]?.recordedAt || "",
      newestRetainedAt: history.at(-1)?.recordedAt || ""
    },
    trendState,
    alertSummary,
    mailchimpReporting,
    actionQueue,
    rows: exportRows,
    mailchimpRows: mailchimpExportRows,
    mailchimpColumns: [
      "mailchimpMatched",
      "mailchimpReportingState",
      "mailchimpTargetKind",
      "mailchimpSummaryKey",
      "mailchimpRemoteRequestId",
      "mailchimpIdempotencyKey",
      "mailchimpRemoteIdempotencyHeaderNames",
      "mailchimpCheckpointRequired",
      "mailchimpCheckpointId",
      "mailchimpPreviewRequired",
      "mailchimpRequiresOperatorAcceptance",
      "mailchimpSafeToDispatch",
      "mailchimpExportReady",
      "mailchimpNextActionId",
      "mailchimpExportTags",
      "mailchimpBlockingCodes"
    ]
  };
  return {
    contractVersion: `${CONTRACT_VERSION}.analytics`,
    updatedAt: now,
    historyLimit,
    counters: nextCounts.counters,
    statusCounts: nextCounts.statusCounts,
    operationCounts: nextCounts.operationCounts,
    targetTypeCounts: nextCounts.targetTypeCounts,
    actorCounts: nextCounts.actorCounts,
    latestSnapshot: snapshot,
    history,
    timeline,
    trendState,
    alertSummary,
    mailchimpReporting,
    actionQueue,
    exportRows,
    exportSummary,
    reportingState: {
      readyForExport: true,
      windowSize: history.length,
      lastStatus: snapshot.status,
      lastGateMode: snapshot.gateMode,
      lifecycleMode: lifecycleSettings.enforcementMode,
      degradedModeActive: degradedMode.active,
      replayedCommand: Boolean(replay),
      queuedActionCount: actionQueue.length,
      retainedDecisionCount,
      droppedDecisionCount,
      statusChanged: trendState.statusChanged,
      approvalSlaBreachedCount: alertSummary.approvalSlaBreachedCount,
      pendingApprovalCount: alertSummary.pendingApprovalCount,
      leaseExpiredCount: alertSummary.leaseExpiredCount,
      leaseExpiringSoonCount: alertSummary.leaseExpiringSoonCount,
      exportHealthSignalCount: alertSummary.exportHealthSignalCount,
      highestRiskBand: alertSummary.highestRiskBand,
      mailchimpMatchedDecisionCount: mailchimpReporting.matchedDecisionCount,
      mailchimpExportReadyDecisionCount: mailchimpReporting.exportReadyDecisionCount,
      mailchimpBlockedExportDecisionCount: mailchimpReporting.blockedExportDecisionCount,
      mailchimpAcceptanceRequiredDecisionCount: mailchimpReporting.acceptanceRequiredDecisionCount,
      mailchimpLatestReportingState: mailchimpReporting.latest.reportingState,
      externalServiceDecisionCount: asNonNegativeInteger(nextCounts.counters.externalServiceDecisions, 0),
      externalServiceAcceptanceRequiredCount: asNonNegativeInteger(nextCounts.counters.externalServiceAcceptanceRequired, 0),
      externalServiceDispatchReadyCount: asNonNegativeInteger(nextCounts.counters.externalServiceDispatchReady, 0),
      externalServiceCheckpointRequiredCount: asNonNegativeInteger(nextCounts.counters.externalServiceCheckpointRequired, 0)
    }
  };
}

function providerHasCapability(providerNegotiation, capability) {
  return providerNegotiation.advertised.includes(capability);
}

function buildProviderOperation({
  request,
  commandId,
  syncCursor,
  type,
  endpoint,
  endpointType,
  capability,
  required,
  wanted,
  providerNegotiation,
  proofFingerprint,
  payloadRef
}) {
  const capabilityGranted = providerHasCapability(providerNegotiation, capability);
  const enabled = Boolean(wanted && capabilityGranted);
  const status = enabled
    ? "ready"
    : wanted && !capabilityGranted
      ? "missing_capability"
      : "not_required";
  return {
    id: `${PROVIDER_CONTRACT_VERSION}:operation:${type}:${request.id}:${commandId}`,
    type,
    endpoint,
    endpointType: endpointType || type,
    capability,
    required,
    wanted: Boolean(wanted),
    enabled,
    status,
    idempotencyKey: `${syncCursor}:${type}`,
    requestId: request.id,
    commandId,
    boundary: request.boundary,
    payloadRef,
    proofFingerprint
  };
}

function endpointErrorMatches(endpointErrors, type, endpoint) {
  const needles = [type, endpoint].map((value) => value.toLowerCase()).filter(Boolean);
  return endpointErrors.filter((error) => {
    const normalized = error.toLowerCase();
    return needles.some((needle) => normalized.includes(needle));
  });
}

function buildProviderDispatchHealth({
  operation,
  providerState,
  validationSummary,
  retryPlan,
  degradedMode,
  nowMs
}) {
  const endpointErrors = endpointErrorMatches(
    providerState.health.endpointErrors,
    operation.type,
    operation.endpoint
  );
  const providerUnavailable = providerState.health.status === "unavailable";
  const providerStale = providerState.health.stale;
  const providerDegraded = providerState.health.degraded && !providerState.health.ready;
  const endpointContract = providerState.endpoints.endpoints[operation.endpointType] ?? {};
  const endpointInvalid = endpointContract.valid === false;
  const blockedByValidation =
    validationSummary.blockingCodes.length > 0 &&
    ["execution_lease", "approval", "handoff"].includes(operation.type);
  const blockedReasons = [
    operation.status === "missing_capability" ? "missing_provider_capability" : "",
    endpointInvalid ? endpointContract.validationCode || "provider_endpoint_invalid" : "",
    providerUnavailable ? "provider_unavailable" : "",
    providerStale ? "provider_heartbeat_stale" : "",
    endpointErrors.length ? "provider_endpoint_errors" : "",
    blockedByValidation ? "blocking_guard_validation" : "",
    degradedMode.checkpointRequired && operation.type === "execution_lease" ? "checkpoint_required" : ""
  ].filter(Boolean);
  const retryable = blockedReasons.some((reason) =>
    [
      "provider_unavailable",
      "provider_heartbeat_stale",
      "provider_endpoint_errors",
      "blocking_guard_validation",
      "checkpoint_required"
    ].includes(reason)
  );
  const dispatchState = !operation.wanted
    ? "not_required"
    : blockedReasons.length
      ? retryable
        ? "deferred"
        : "blocked"
      : providerDegraded && operation.type !== "decision"
        ? "degraded_dispatch"
        : operation.enabled
          ? "dispatchable"
          : "blocked";
  const nextAttemptAt =
    retryable && retryPlan.retryable
      ? retryPlan.nextAttemptAt
      : retryable && retryPlan.backoffMs
        ? new Date(nowMs + retryPlan.backoffMs).toISOString()
        : "";
  return {
    contractVersion: `${PROVIDER_CONTRACT_VERSION}.dispatch-health`,
    operationId: operation.id,
    operationType: operation.type,
    endpointType: operation.endpointType,
    endpoint: operation.endpoint,
    endpointSource: endpointContract.source || "kernel_default",
    dispatchState,
    blocked: dispatchState === "blocked" || dispatchState === "deferred",
    degradedDispatch: dispatchState === "degraded_dispatch",
    blockedReasons,
    retryable,
    nextAttemptAt,
    backoffMs: retryable ? retryPlan.backoffMs : 0,
    endpointErrors,
    providerStatus: providerState.health.status,
    providerReady: providerState.health.ready,
    providerStale,
    checkpointRequired: degradedMode.checkpointRequired,
    action: dispatchState === "dispatchable" || dispatchState === "degraded_dispatch"
      ? `Dispatch ${operation.type} to ${operation.endpoint}.`
      : dispatchState === "deferred"
        ? "Wait for provider health, checkpoint, or retry budget before dispatching this operation."
        : dispatchState === "not_required"
          ? "No provider dispatch is required for this operation."
          : "Fix provider capability or guard validation blockers before dispatch."
  };
}

function buildProviderDispatchSafetyBarrier({
  operation,
  providerState,
  validationSummary,
  retryPlan,
  degradedMode,
  command,
  nowMs
}) {
  const suppressible = SUPPRESSIBLE_PROVIDER_OPERATION_TYPES.has(operation.type);
  const providerRestricted =
    !providerState.health.ready ||
    providerState.health.stale ||
    providerState.health.endpointErrors.length > 0 ||
    !providerState.endpoints.ready;
  const unsafeExecutionLease =
    operation.type === "execution_lease" &&
    (degradedMode.checkpointRequired || validationSummary.blockingCodes.length > 0);
  const unsafeApprovalOrHandoff =
    ["approval", "handoff"].includes(operation.type) &&
    command.type !== "recover" &&
    providerRestricted &&
    degradedMode.active;
  const suppressedReasons = [
    suppressible && providerState.health.status === "unavailable" ? "provider_unavailable" : "",
    suppressible && providerState.health.stale ? "provider_heartbeat_stale" : "",
    suppressible && providerState.health.endpointErrors.length ? "provider_endpoint_errors" : "",
    suppressible && !providerState.endpoints.ready ? "provider_endpoint_contract_invalid" : "",
    suppressible && unsafeExecutionLease ? "checkpoint_required_before_side_effect" : "",
    suppressible && unsafeApprovalOrHandoff ? "degraded_provider_side_effect_suppressed" : ""
  ].filter(Boolean);
  const suppressed = Boolean(operation.wanted && suppressedReasons.length);
  const dispatchableWithoutBarrier = ["dispatchable", "degraded_dispatch"].includes(
    operation.dispatchHealth?.dispatchState
  );
  const nextAttemptAt =
    suppressed && retryPlan.retryable
      ? retryPlan.nextAttemptAt
      : suppressed && retryPlan.backoffMs
        ? new Date(nowMs + retryPlan.backoffMs).toISOString()
        : "";
  return {
    contractVersion: `${PROVIDER_CONTRACT_VERSION}.dispatch-safety`,
    operationId: operation.id,
    operationType: operation.type,
    suppressible,
    suppressed,
    safeToDispatch:
      Boolean(operation.wanted) &&
      operation.enabled &&
      dispatchableWithoutBarrier &&
      !suppressed,
    effectiveDispatchState: !operation.wanted
      ? "not_required"
      : suppressed
        ? "suppressed"
        : operation.dispatchHealth?.dispatchState || operation.status,
    suppressedReasons,
    providerRestricted,
    sideEffectClass: suppressible ? "external_side_effect" : "kernel_state",
    nextAttemptAt,
    retryable: suppressed && retryPlan.retryable,
    operatorAction: suppressed
      ? "Do not dispatch this provider operation until provider health is ready and checkpoint requirements are cleared."
      : dispatchableWithoutBarrier
        ? "Dispatch is permitted by provider safety barrier."
        : "Follow dispatchHealth.action before dispatch."
  };
}

function attachProviderDispatchHealth({
  operations,
  providerState,
  validationSummary,
  retryPlan,
  degradedMode,
  command,
  nowMs
}) {
  return operations.map((operation) => {
    const operationWithHealth = {
      ...operation,
      dispatchHealth: buildProviderDispatchHealth({
        operation,
        providerState,
        validationSummary,
        retryPlan,
        degradedMode,
        nowMs
      })
    };
    const safetyBarrier = buildProviderDispatchSafetyBarrier({
      operation: operationWithHealth,
      providerState,
      validationSummary,
      retryPlan,
      degradedMode,
      command,
      nowMs
    });
    return {
      ...operationWithHealth,
      dispatchSafety: safetyBarrier,
      effectiveEnabled: operationWithHealth.enabled && safetyBarrier.safeToDispatch,
      dispatchSuppressed: safetyBarrier.suppressed,
      suppressionReasons: safetyBarrier.suppressedReasons
    };
  });
}

function buildProviderServiceOperations({
  request,
  command,
  providerState,
  providerNegotiation,
  finalDecision,
  validationSummary,
  finalPersistedState,
  workflowHandoff,
  executionGate,
  syncCursor
}) {
  const commandId = buildCommandId(request, command);
  const checkpointWanted =
    finalPersistedState.restartSafeStatus.checkpointRequired ||
    finalPersistedState.restartSafeStatus.recoveryRequired ||
    validationSummary.blockingCodes.length > 0 ||
    LIFECYCLE_COMMAND_TYPES.has(command.type);
  const approvalWanted = finalDecision.requiresApproval || command.type === "approve";
  const handoffWanted = Boolean(workflowHandoff) || finalDecision.status === "handoff_required";
  const leaseWanted = Boolean(executionGate.lease);
  return [
    buildProviderOperation({
      request,
      commandId,
      syncCursor,
      type: "decision",
      endpoint: providerState.endpoints.effective.decision,
      endpointType: "decision",
      capability: "guard.decision.read",
      required: true,
      wanted: true,
      providerNegotiation,
      proofFingerprint: executionGate.proofFingerprint,
      payloadRef: `guardDecision:${request.id}`
    }),
    buildProviderOperation({
      request,
      commandId,
      syncCursor,
      type: "audit",
      endpoint: providerState.endpoints.effective.audit,
      endpointType: "audit",
      capability: "guard.audit.write",
      required: true,
      wanted: true,
      providerNegotiation,
      proofFingerprint: executionGate.proofFingerprint,
      payloadRef: `auditProof:${request.id}`
    }),
    buildProviderOperation({
      request,
      commandId,
      syncCursor,
      type: "checkpoint",
      endpoint: providerState.endpoints.effective.checkpoint,
      endpointType: "checkpoint",
      capability: "guard.state.checkpoint",
      required: true,
      wanted: checkpointWanted,
      providerNegotiation,
      proofFingerprint: executionGate.proofFingerprint,
      payloadRef: `persistedState:${request.id}`
    }),
    buildProviderOperation({
      request,
      commandId,
      syncCursor,
      type: "approval",
      endpoint: providerState.endpoints.effective.approval,
      endpointType: "approval",
      capability: "guard.approval.request",
      required: true,
      wanted: approvalWanted,
      providerNegotiation,
      proofFingerprint: executionGate.proofFingerprint,
      payloadRef: `userVisiblePreview:${request.id}`
    }),
    buildProviderOperation({
      request,
      commandId,
      syncCursor,
      type: "handoff",
      endpoint: providerState.endpoints.effective.handoff,
      endpointType: "handoff",
      capability: "guard.workflow.handoff",
      required: false,
      wanted: handoffWanted,
      providerNegotiation,
      proofFingerprint: executionGate.proofFingerprint,
      payloadRef: `workflowHandoff:${request.id}`
    }),
    buildProviderOperation({
      request,
      commandId,
      syncCursor,
      type: "execution_lease",
      endpoint: providerState.endpoints.effective.decision,
      endpointType: "decision",
      capability: "guard.execution.lease",
      required: false,
      wanted: leaseWanted,
      providerNegotiation,
      proofFingerprint: executionGate.proofFingerprint,
      payloadRef: `executionGate:${request.id}`
    })
  ];
}

function summarizeProviderOperations(operations) {
  const ready = operations.filter((operation) => operation.status === "ready");
  const missingCapability = operations.filter((operation) => operation.status === "missing_capability");
  const requiredBlocked = missingCapability.filter((operation) => operation.required);
  const dispatchBlocked = operations.filter((operation) => operation.dispatchHealth?.blocked);
  const degradedDispatch = operations.filter((operation) => operation.dispatchHealth?.degradedDispatch);
  const retryable = operations.filter((operation) => operation.dispatchHealth?.retryable);
  const suppressed = operations.filter((operation) => operation.dispatchSafety?.suppressed);
  const safeToDispatch = operations.filter((operation) => operation.dispatchSafety?.safeToDispatch);
  return {
    total: operations.length,
    readyCount: ready.length,
    safeToDispatchCount: safeToDispatch.length,
    missingCapabilityCount: missingCapability.length,
    requiredBlockedCount: requiredBlocked.length,
    dispatchBlockedCount: dispatchBlocked.length,
    degradedDispatchCount: degradedDispatch.length,
    retryableDispatchCount: retryable.length,
    suppressedDispatchCount: suppressed.length,
    readyTypes: ready.map((operation) => operation.type),
    safeToDispatchTypes: safeToDispatch.map((operation) => operation.type),
    missingCapabilityTypes: missingCapability.map((operation) => operation.type),
    blockedDispatchTypes: dispatchBlocked.map((operation) => operation.type),
    degradedDispatchTypes: degradedDispatch.map((operation) => operation.type),
    retryableDispatchTypes: retryable.map((operation) => operation.type),
    suppressedDispatchTypes: suppressed.map((operation) => operation.type),
    suppressedReasonsByType: Object.fromEntries(
      suppressed.map((operation) => [operation.type, operation.dispatchSafety.suppressedReasons])
    ),
    dispatchable: requiredBlocked.length === 0 && dispatchBlocked.length === 0 && suppressed.length === 0,
    nextDispatchType:
      safeToDispatch[0]?.type ||
      operations.find((operation) =>
        ["dispatchable", "degraded_dispatch"].includes(operation.dispatchHealth?.dispatchState)
      )?.type ||
      ready[0]?.type ||
      "",
    nextRetryAt: [...retryable, ...suppressed]
      .flatMap((operation) => [
        operation.dispatchHealth.nextAttemptAt,
        operation.dispatchSafety?.nextAttemptAt
      ])
      .filter(Boolean)
      .sort()[0] || ""
  };
}

function buildProviderServiceContract({
  now,
  nowMs,
  request,
  command,
  providerState,
  providerNegotiation,
  finalDecision,
  validationSummary,
  retryPlan,
  degradedMode,
  finalPersistedState,
  workflowHandoff,
  executionGate
}) {
  const commandId = buildCommandId(request, command);
  const syncSequence = providerState.sync.sequence + 1;
  const checkpointId = `${PROVIDER_CONTRACT_VERSION}:${request.id}:${commandId}:${syncSequence}`;
  const handoffRequired = Boolean(workflowHandoff) || finalDecision.status === "handoff_required";
  const handoffId =
    providerState.sync.externalHandoffId ||
    (handoffRequired ? `${PROVIDER_CONTRACT_VERSION}:handoff:${request.id}:${commandId}` : "");
  const syncCursor = `${PROVIDER_CONTRACT_VERSION}:${request.id}:${commandId}`;
  const operations = attachProviderDispatchHealth({
    operations: buildProviderServiceOperations({
      request,
      command,
      providerState,
      providerNegotiation,
      finalDecision,
      validationSummary,
      finalPersistedState,
      workflowHandoff,
      executionGate,
      syncCursor
    }),
    providerState,
    validationSummary,
    retryPlan,
    degradedMode,
    command,
    nowMs
  });
  const operationSummary = summarizeProviderOperations(operations);
  const handoffOperation = operations.find((operation) => operation.type === "handoff");
  return {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    generatedAt: now,
    provider: {
      id: providerState.id,
      name: providerState.name,
      serviceId: providerState.serviceId,
      serviceVersion: providerState.serviceVersion,
      route: providerState.route,
      health: providerState.health,
      endpoints: providerState.endpoints
    },
    negotiation: {
      status: providerNegotiation.fullyNegotiated ? "accepted" : "rejected",
      advertisedCapabilities: providerNegotiation.advertised,
      requiredCapabilities: providerNegotiation.required,
      optionalCapabilitiesGranted: providerNegotiation.optionalGranted,
      optionalCapabilitiesMissing: OPTIONAL_PROVIDER_CAPABILITIES.filter(
        (capability) => !providerNegotiation.optionalGranted.includes(capability)
      ),
      missingRequiredCapabilities: providerNegotiation.missingRequired,
      commandRequiredCapability: providerNegotiation.commandRequired,
      commandSupported: providerNegotiation.commandSupported,
      dispatchable: providerNegotiation.fullyNegotiated && operationSummary.dispatchable
    },
    services: {
      decision: providerState.endpoints.effective.decision,
      approval: finalDecision.requiresApproval ? providerState.endpoints.effective.approval : "",
      checkpoint: providerState.endpoints.effective.checkpoint,
      audit: providerState.endpoints.effective.audit,
      handoff: handoffRequired ? providerState.endpoints.effective.handoff : ""
    },
    endpointContract: {
      contractVersion: providerState.endpoints.contractVersion,
      ready: providerState.endpoints.ready,
      overrideTypes: providerState.endpoints.overrideTypes,
      invalidTypes: providerState.endpoints.invalidTypes,
      invalidRequiredTypes: providerState.endpoints.invalidRequiredTypes,
      endpoints: providerState.endpoints.endpoints
    },
    operations,
    operationSummary,
    sync: {
      cursor: syncCursor,
      previousCursor: providerState.sync.cursor,
      sequence: syncSequence,
      checkpointId,
      previousCheckpointId: providerState.sync.checkpointId,
      lastSyncedAt: now,
      dirty: !validationSummary.valid || finalPersistedState.restartSafeStatus.checkpointRequired,
      checkpointRequired: finalPersistedState.restartSafeStatus.checkpointRequired,
      restartSafeResumeToken: finalPersistedState.restartSafeStatus.resumeToken,
      commandResumeToken: finalPersistedState.restartSafeStatus.commandResumeToken,
      recoveredCommandCount: finalPersistedState.restartSafeStatus.recoveredCommandCount,
      recoveryRequired: finalPersistedState.restartSafeStatus.recoveryRequired
    },
    externalHandoff: {
      required: handoffRequired,
      id: handoffId,
      status: handoffRequired
        ? handoffOperation?.dispatchSafety?.suppressed
          ? "dispatch_suppressed"
          : providerHasCapability(providerNegotiation, "guard.workflow.handoff")
          ? "pending_dispatch"
          : "blocked_by_missing_capability"
        : "not_required",
      reason: workflowHandoff?.type || finalPersistedState.restartSafeStatus.nextAction.reason,
      targetService: handoffRequired ? providerState.endpoints.effective.handoff : "",
      targetEndpoint: handoffRequired ? providerState.endpoints.effective.handoff : "",
      approvalPreviewId: handoffRequired ? buildPreviewId(request) : "",
      executionGateFingerprint: executionGate.proofFingerprint,
      dispatchOperationId: handoffOperation?.id || "",
      dispatchSuppressed: Boolean(handoffOperation?.dispatchSafety?.suppressed),
      suppressedReasons: handoffOperation?.dispatchSafety?.suppressedReasons ?? [],
      nextRetryAt: handoffOperation?.dispatchSafety?.nextAttemptAt || ""
    }
  };
}

export function describeDestructiveActionGuardSurface(input = {}) {
  const requestedNow = input.now || new Date().toISOString();
  const nowMs = Date.parse(requestedNow);
  const effectiveNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const now = Number.isFinite(nowMs) ? requestedNow : new Date(effectiveNowMs).toISOString();
  const request = normalizeRequest(input);
  const clientState = normalizeClientState(input);
  const command = normalizeGuardCommand(input);
  const providerState = normalizeProviderState(input, now);
  const providerNegotiation = negotiateProviderCapabilities(providerState, command);
  const persistedState = normalizePersistedState(input, now);
  const retryState = normalizeRetryState(input, now);
  const previewAcceptance = normalizePreviewAcceptance(input, request, now);
  const acknowledgementState = buildAcknowledgementState(
    buildRequiredAcknowledgementCodes(request, clientState),
    previewAcceptance
  );
  const handoffReconciliation = buildClientHandoffReconciliation({
    clientState,
    request,
    command,
    nowMs: effectiveNowMs
  });
  const lifecycleSettings = normalizeLifecycleSettings(
    input,
    persistedState,
    command,
    clientState,
    now,
    effectiveNowMs
  );
  const validationIssues = validateOperationalInputs({
    now: requestedNow,
    nowMs,
    request,
    command,
    clientState,
    providerState,
    providerNegotiation,
    persistedState,
    lifecycleSettings,
    previewAcceptance,
    acknowledgementState,
    handoffReconciliation
  });
  const operationalHealth = buildOperationalHealth(validationIssues, providerState);
  const acceptedPreviewApproval = operationalHealth.ready
    ? buildAcceptedPreviewApproval({
        command,
        request,
        clientState,
        previewAcceptance,
        acknowledgementState,
        lifecycleSettings,
        now,
        nowMs: effectiveNowMs
      })
    : null;
  const effectivePersistedState = acceptedPreviewApproval
    ? {
        ...persistedState,
        approvals: {
          ...persistedState.approvals,
          [request.id]: acceptedPreviewApproval
        }
      }
    : persistedState;
  const recoveredPersistedState = recoverPersistedCommandJournal({
    persistedState: effectivePersistedState,
    request,
    command,
    now,
    nowMs: effectiveNowMs
  });
  const replay = findIdempotentReplay(command, recoveredPersistedState, buildCommandId(request, command));
  const mergedClientState = {
    ...clientState,
    approvals: mergeApprovalLedgers(clientState, recoveredPersistedState)
  };
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const decision = replay
    ? {
        status: replay.resultStatus || "allowed",
        riskScore: replay.recoveryRequired ? 1 : 0,
        approved: !replay.recoveryRequired,
        requiresApproval: Boolean(replay.recoveryRequired),
        signals: {
          operationTokens: [],
          matchedOperations: {
            destructive: [],
            deployment: [],
            privilegedMutation: [],
            irreversible: []
          },
          classificationSources: {
            destructive: [],
            deployment: [],
            privilegedMutation: [],
            irreversible: [],
            sensitiveTarget: [],
            broadScope: []
          },
          destructiveOperation: false,
          deploymentOperation: false,
          privilegedMutation: false,
          irreversibleOperation: false,
          guardedOperation: false,
          operationFamily: "replay",
          guardedOperationClassifications: [],
          sensitiveTarget: false,
          broadScope: false,
          lacksCapability: false,
          dryRunBypass: false,
          idempotentReplay: true,
          recoveryRequired: Boolean(replay.recoveryRequired),
          recoveryReason: replay.recoveryReason || ""
        }
      }
    : decideGuardState(request, mergedClientState, Number.isFinite(nowMs) ? nowMs : Date.now());
  const lifecycleDecision = applyLifecycleControls(decision, request, command, lifecycleSettings);
  const finalDecision = applyFailureAndDegradedMode(
    lifecycleDecision,
    validationIssues,
    request,
    recoveredPersistedState
  );
  const failureState = buildFailureState({
    validationIssues,
    decision: finalDecision,
    retryState,
    nowMs: effectiveNowMs
  });
  const retryPlan = buildRetryPlan({ failureState, retryState, nowMs: effectiveNowMs });
  const actionableErrors = buildActionableErrors(validationIssues, retryPlan);
  const degradedMode = buildDegradedMode(operationalHealth, validationIssues, recoveredPersistedState);
  const nextPersistedState = shapePersistedState({
    now,
    request,
    command,
    persistedState: recoveredPersistedState,
    decision: finalDecision,
    replay,
    lifecycleSettings
  });
  const validationSummary = buildValidationSummary(validationIssues, operationalHealth, finalDecision);
  const explainableNextSteps = buildExplainableNextSteps({
    finalDecision,
    validationSummary,
    retryPlan,
    lifecycleSettings
  });
  const acceptanceReadiness = buildPreviewAcceptanceReadiness({
    request,
    command,
    clientState: mergedClientState,
    finalDecision,
    previewAcceptance,
    acknowledgementState,
    validationSummary,
    explainableNextSteps
  });
  const userVisiblePreview = buildUserVisiblePreview({
    request,
    clientState: mergedClientState,
    finalDecision,
    lifecycleSettings,
    previewAcceptance,
    acknowledgementState,
    validationSummary,
    explainableNextSteps,
    acceptanceReadiness
  });
  const workflowHandoff = buildWorkflowHandoff(
    request,
    mergedClientState,
    finalDecision,
    lifecycleSettings,
    acknowledgementState,
    effectiveNowMs
  );
  const executionGate = buildHostedKernelExecutionGate({
    now,
    nowMs: effectiveNowMs,
    request,
    command,
    clientState: mergedClientState,
    finalDecision,
    lifecycleSettings,
    validationSummary,
    degradedMode,
    recovery: nextPersistedState.restartSafeStatus
  });
  const routeAcceptanceContract = buildRoutePreviewAcceptanceContract({
    now,
    request,
    command,
    clientState: mergedClientState,
    userVisiblePreview,
    acceptanceReadiness,
    validationSummary,
    explainableNextSteps,
    workflowHandoff,
    executionGate
  });
  const clientRuntimeState = buildClientRuntimeState({
    now,
    request,
    command,
    clientState: mergedClientState,
    workflowHandoff,
    userVisiblePreview,
    executionGate,
    explainableNextSteps,
    validationSummary,
    handoffReconciliation
  });
  const analyticsReporting = buildAnalyticsReporting({
    now,
    nowMs: effectiveNowMs,
    request,
    command,
    clientState: mergedClientState,
    finalDecision,
    validationSummary,
    degradedMode,
    executionGate,
    recovery: nextPersistedState.restartSafeStatus,
    lifecycleSettings,
    persistedAnalytics: recoveredPersistedState.analytics,
    replay
  });
  const providerCommandId = buildCommandId(request, command);
  const providerSyncSequence = providerState.sync.sequence + 1;
  const providerCheckpointId = `${PROVIDER_CONTRACT_VERSION}:${request.id}:${providerCommandId}:${providerSyncSequence}`;
  const providerHandoffRequired = Boolean(workflowHandoff) || finalDecision.status === "handoff_required";
  const providerHandoffId =
    providerState.sync.externalHandoffId ||
    (providerHandoffRequired
      ? `${PROVIDER_CONTRACT_VERSION}:handoff:${request.id}:${providerCommandId}`
      : "");
  const finalPersistedState = {
    ...nextPersistedState,
    analytics: {
      contractVersion: analyticsReporting.contractVersion,
      updatedAt: analyticsReporting.updatedAt,
      historyLimit: analyticsReporting.historyLimit,
      counters: analyticsReporting.counters,
      statusCounts: analyticsReporting.statusCounts,
      operationCounts: analyticsReporting.operationCounts,
      targetTypeCounts: analyticsReporting.targetTypeCounts,
      actorCounts: analyticsReporting.actorCounts,
      latestSnapshot: analyticsReporting.latestSnapshot,
      history: analyticsReporting.history,
      timeline: analyticsReporting.timeline,
      trendState: analyticsReporting.trendState,
      alertSummary: analyticsReporting.alertSummary,
      actionQueue: analyticsReporting.actionQueue,
      exportRows: analyticsReporting.exportRows,
      exportSummary: analyticsReporting.exportSummary,
      reportingState: analyticsReporting.reportingState
    },
    provider: {
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerId: providerState.id,
      serviceId: providerState.serviceId,
      serviceVersion: providerState.serviceVersion,
      health: providerState.health,
      endpoints: {
        contractVersion: providerState.endpoints.contractVersion,
        ready: providerState.endpoints.ready,
        effective: providerState.endpoints.effective,
        overrideTypes: providerState.endpoints.overrideTypes,
        invalidTypes: providerState.endpoints.invalidTypes,
        invalidRequiredTypes: providerState.endpoints.invalidRequiredTypes
      },
      negotiatedCapabilities: providerNegotiation.fullyNegotiated
        ? providerNegotiation.required.concat(providerNegotiation.optionalGranted)
        : providerNegotiation.advertised,
      sync: {
        cursor: `${PROVIDER_CONTRACT_VERSION}:${request.id}:${providerCommandId}`,
        checkpointId: providerCheckpointId,
        sequence: providerSyncSequence,
        lastSyncedAt: now,
        previousCursor: providerState.sync.cursor,
        previousCheckpointId: providerState.sync.checkpointId,
        observedSequence: providerState.sync.sequence,
        dirtyOnInput: providerState.sync.dirty,
        dirty: !validationSummary.valid || nextPersistedState.restartSafeStatus.checkpointRequired,
        restartSafeResumeToken: nextPersistedState.restartSafeStatus.resumeToken,
        commandResumeToken: nextPersistedState.restartSafeStatus.commandResumeToken,
        recoveredCommandCount: nextPersistedState.restartSafeStatus.recoveredCommandCount,
        recoveryRequired: nextPersistedState.restartSafeStatus.recoveryRequired
      },
      externalHandoff: {
        required: providerHandoffRequired,
        id: providerHandoffId,
        status: providerHandoffRequired ? "pending" : "not_required",
        reason: workflowHandoff?.type || nextPersistedState.restartSafeStatus.nextAction.reason
      }
    },
    clientRuntime: {
      contractVersion: clientRuntimeState.contractVersion,
      updatedAt: clientRuntimeState.updatedAt,
      clientId: clientRuntimeState.clientId,
      actor: clientRuntimeState.actor,
      inboxCursor: clientRuntimeState.inboxCursor,
      outboxCursor: clientRuntimeState.outboxCursor,
      activeHandoffId: clientRuntimeState.activeHandoffId,
      unreadCount: clientRuntimeState.unreadCount,
      handoffReconciliation: clientRuntimeState.handoffReconciliation,
      handoffs: clientRuntimeState.handoffs,
      appliedReceipts: clientRuntimeState.appliedReceipts,
      outbox: clientRuntimeState.outbox,
      current: clientRuntimeState.current,
      handoffPresentation: clientRuntimeState.handoffPresentation,
      uiState: clientRuntimeState.uiState,
      routeAcceptance: {
        contractVersion: routeAcceptanceContract.contractVersion,
        status: routeAcceptanceContract.status,
        previewId: routeAcceptanceContract.previewId,
        banner: routeAcceptanceContract.banner,
        checklist: routeAcceptanceContract.checklist,
        nextStep: routeAcceptanceContract.nextStep,
        acceptanceFormEnabled: routeAcceptanceContract.acceptanceForm.enabled,
        acceptanceSubmitEnabled: routeAcceptanceContract.acceptanceForm.submitEnabled,
        acceptanceEndpoint: routeAcceptanceContract.acceptanceForm.endpoint,
        acceptanceReadinessStatus: routeAcceptanceContract.acceptanceForm.readinessStatus,
        acceptanceNextField: routeAcceptanceContract.acceptanceForm.nextField,
        acceptanceMissingFields: routeAcceptanceContract.acceptanceForm.missingFields,
        acceptanceBlockingCodes: routeAcceptanceContract.acceptanceForm.blockingCodes,
        acceptanceHardBlockingCodes: acceptanceReadiness.hardBlockingCodes,
        acceptanceInputPendingReasons: routeAcceptanceContract.acceptanceForm.inputPendingReasons,
        acceptanceOperationComparison: userVisiblePreview.acceptance.operationComparison,
        acceptanceExpectedOperationTokens: userVisiblePreview.acceptance.expectedOperationTokens,
        acceptanceSubmittedOperationTokens: userVisiblePreview.acceptance.submittedOperationTokens
      }
    }
  };
  const providerContract = buildProviderServiceContract({
    now,
    nowMs: effectiveNowMs,
    request,
    command,
    providerState,
    providerNegotiation,
    finalDecision,
    validationSummary,
    retryPlan,
    degradedMode,
    finalPersistedState,
    workflowHandoff,
    executionGate
  });
  finalPersistedState.provider.dispatchHealth = {
    contractVersion: `${PROVIDER_CONTRACT_VERSION}.dispatch-health-summary`,
    generatedAt: now,
    dispatchable: providerContract.operationSummary.dispatchable,
    nextDispatchType: providerContract.operationSummary.nextDispatchType,
    nextRetryAt: providerContract.operationSummary.nextRetryAt,
    safeToDispatchTypes: providerContract.operationSummary.safeToDispatchTypes,
    blockedDispatchTypes: providerContract.operationSummary.blockedDispatchTypes,
    degradedDispatchTypes: providerContract.operationSummary.degradedDispatchTypes,
    retryableDispatchTypes: providerContract.operationSummary.retryableDispatchTypes,
    suppressedDispatchTypes: providerContract.operationSummary.suppressedDispatchTypes,
    suppressedReasonsByType: providerContract.operationSummary.suppressedReasonsByType,
    operationStates: Object.fromEntries(
      providerContract.operations.map((operation) => [
        operation.type,
        {
          endpointType: operation.endpointType,
          endpoint: operation.endpoint,
          endpointSource: operation.dispatchHealth.endpointSource,
          dispatchState: operation.dispatchHealth.dispatchState,
          effectiveDispatchState: operation.dispatchSafety.effectiveDispatchState,
          safeToDispatch: operation.dispatchSafety.safeToDispatch,
          effectiveEnabled: operation.effectiveEnabled,
          dispatchSuppressed: operation.dispatchSuppressed,
          blockedReasons: operation.dispatchHealth.blockedReasons,
          suppressedReasons: operation.suppressionReasons,
          nextAttemptAt: operation.dispatchHealth.nextAttemptAt,
          suppressionNextAttemptAt: operation.dispatchSafety.nextAttemptAt,
          retryable: operation.dispatchHealth.retryable || operation.dispatchSafety.retryable,
          operatorAction: operation.dispatchSafety.operatorAction
        }
      ])
    )
  };
  const auditProof = buildAuditProof({
    now,
    request,
    clientState: mergedClientState,
    decision: finalDecision,
    evidence: [
      ...evidence,
      {
        type: "operational_health",
        health: operationalHealth.status,
        degradedMode: degradedMode.active,
        validationCodes: operationalHealth.validationCodes
      },
      {
        type: "lifecycle_controls",
        enabled: lifecycleSettings.enabled,
        enforcementMode: lifecycleSettings.enforcementMode,
        scheduleState: lifecycleSettings.scheduleState,
        nextAction: nextPersistedState.restartSafeStatus.nextAction,
        transition: lifecycleSettings.transition
      },
      {
        type: "permission_boundary",
        requestBoundary: request.boundary,
        clientBoundary: mergedClientState.boundary,
        permissionBoundary: mergedClientState.permissionBoundary,
        audit: finalDecision.signals.boundary ? buildBoundaryAuditShape(finalDecision.signals.boundary) : null,
        denialCodes: finalDecision.signals.boundary?.denialCodes ?? [],
        tenantExplicitlyAllowed: Boolean(finalDecision.signals.boundary?.tenantExplicitlyAllowed),
        workspaceExplicitlyAllowed: Boolean(finalDecision.signals.boundary?.workspaceExplicitlyAllowed),
        requestWorkspaceExplicit: Boolean(finalDecision.signals.boundary?.requestBoundary.workspaceExplicit),
        requestWorkspaceSource: finalDecision.signals.boundary?.requestBoundary.workspaceSource || "",
        explicitWorkspaceRequired: Boolean(finalDecision.signals.boundary?.explicitWorkspaceRequired),
        workspaceScopeAmbiguous: Boolean(finalDecision.signals.boundary?.workspaceScopeAmbiguous)
      },
      {
        type: "command_journal_recovery",
        scannedAt: nextPersistedState.commandRecovery.scannedAt,
        recoveredCommandCount: nextPersistedState.commandRecovery.recoveredCount,
        currentCommandRecovered: nextPersistedState.commandRecovery.currentCommandRecovered,
        recoveryRequired: nextPersistedState.restartSafeStatus.recoveryRequired,
        commandResumeToken: nextPersistedState.restartSafeStatus.commandResumeToken
      },
      {
        type: "preview_acceptance",
        previewId: userVisiblePreview.previewId,
        accepted: previewAcceptance.accepted,
        requestId: request.id,
        expectedBindingFingerprint: previewAcceptance.expectedBindingFingerprint,
        submittedBindingFingerprint: previewAcceptance.bindingFingerprint,
        bindingMatches: previewAcceptance.bindingMatches,
        operationComparison: previewAcceptance.binding.operationComparison,
        expectedOperationTokens: previewAcceptance.binding.expectedOperationTokens,
        submittedOperation: previewAcceptance.binding.submittedOperation,
        submittedOperationTokens: previewAcceptance.binding.submittedOperationTokens,
        bindingRequiredFields: previewAcceptance.binding.requiredFieldCodes,
        bindingMismatchCodes: previewAcceptance.binding.mismatchCodes,
        acknowledgementComplete: acknowledgementState.complete,
        requiredAcknowledgementCodes: acknowledgementState.requiredCodes,
        missingAcknowledgements: acknowledgementState.missingCodes,
        acceptedApprovalRecorded: Boolean(acceptedPreviewApproval),
        acceptanceSubmitReady: acceptanceReadiness.submitReady,
        acceptanceCanAttemptSubmission: acceptanceReadiness.canAttemptSubmission,
        acceptanceMissingFields: acceptanceReadiness.missingFields,
        acceptanceBlockingCodes: acceptanceReadiness.blockingCodes,
        nextStepTypes: explainableNextSteps.map((step) => step.type)
      },
      {
        type: "hosted_kernel_execution_gate",
        executable: executionGate.executable,
        sideEffectsPermitted: executionGate.sideEffectsPermitted,
        mode: executionGate.mode,
        blockerCodes: executionGate.blockers.map((blocker) => blocker.code),
        proofFingerprint: executionGate.proofFingerprint
      },
      {
        type: "analytics_reporting",
        exportId: analyticsReporting.exportSummary.exportId,
        totalDecisions: analyticsReporting.counters.totalDecisions,
        historyWindowSize: analyticsReporting.reportingState.windowSize,
        retainedDecisionCount: analyticsReporting.reportingState.retainedDecisionCount,
        droppedDecisionCount: analyticsReporting.reportingState.droppedDecisionCount,
        queuedActionCount: analyticsReporting.reportingState.queuedActionCount,
        approvalSlaBreachedCount: analyticsReporting.reportingState.approvalSlaBreachedCount,
        pendingApprovalCount: analyticsReporting.reportingState.pendingApprovalCount,
        leaseExpiredCount: analyticsReporting.reportingState.leaseExpiredCount,
        leaseExpiringSoonCount: analyticsReporting.reportingState.leaseExpiringSoonCount,
        exportHealthSignalCount: analyticsReporting.reportingState.exportHealthSignalCount,
        highestRiskBand: analyticsReporting.reportingState.highestRiskBand,
        statusChanged: analyticsReporting.reportingState.statusChanged,
        lastGateMode: analyticsReporting.reportingState.lastGateMode
      },
      {
        type: "provider_service_contract",
        providerId: providerContract.provider.id,
        providerHealth: providerContract.provider.health.status,
        providerReady: providerContract.provider.health.ready,
        providerStale: providerContract.provider.health.stale,
        endpointContractReady: providerContract.endpointContract.ready,
        endpointOverrideTypes: providerContract.endpointContract.overrideTypes,
        invalidEndpointTypes: providerContract.endpointContract.invalidTypes,
        invalidRequiredEndpointTypes: providerContract.endpointContract.invalidRequiredTypes,
        negotiationStatus: providerContract.negotiation.status,
        dispatchable: providerContract.negotiation.dispatchable,
        missingCapabilities: providerContract.negotiation.missingRequiredCapabilities,
        syncCursor: providerContract.sync.cursor,
        readyOperationTypes: providerContract.operationSummary.readyTypes,
        blockedDispatchTypes: providerContract.operationSummary.blockedDispatchTypes,
        degradedDispatchTypes: providerContract.operationSummary.degradedDispatchTypes,
        retryableDispatchTypes: providerContract.operationSummary.retryableDispatchTypes,
        safeToDispatchTypes: providerContract.operationSummary.safeToDispatchTypes,
        suppressedDispatchTypes: providerContract.operationSummary.suppressedDispatchTypes,
        suppressedReasonsByType: providerContract.operationSummary.suppressedReasonsByType,
        nextProviderRetryAt: providerContract.operationSummary.nextRetryAt,
        missingCapabilityOperationTypes: providerContract.operationSummary.missingCapabilityTypes,
        externalHandoffRequired: providerContract.externalHandoff.required,
        externalHandoffStatus: providerContract.externalHandoff.status,
        externalHandoffId: providerContract.externalHandoff.id,
        externalHandoffDispatchSuppressed: providerContract.externalHandoff.dispatchSuppressed,
        externalHandoffSuppressedReasons: providerContract.externalHandoff.suppressedReasons,
        dispatchOperationId: providerContract.externalHandoff.dispatchOperationId
      },
      {
        type: "client_runtime_handoff",
        clientId: clientRuntimeState.clientId,
        inboxCursor: clientRuntimeState.inboxCursor,
        activeHandoffId: clientRuntimeState.activeHandoffId,
        unreadCount: clientRuntimeState.unreadCount,
        currentStatus: clientRuntimeState.current?.status || "none",
        uiSeverity: clientRuntimeState.uiState.severity,
        handoffVisibleState: clientRuntimeState.handoffPresentation.visibleState,
        handoffPrimaryAction: clientRuntimeState.handoffPresentation.primaryAction,
        handoffNextClientCommandType: clientRuntimeState.handoffPresentation.nextClientCommandType,
        handoffRequiresUserInput: clientRuntimeState.handoffPresentation.requiresUserInput,
        handoffClientResumeToken: clientRuntimeState.handoffPresentation.clientResumeToken,
        handoffStaleClientRuntime: clientRuntimeState.handoffPresentation.staleClientRuntime,
        workflowContinuityHealthy: clientRuntimeState.handoffReconciliation.workflowContinuityHealthy,
        workflowContinuityCodes: clientRuntimeState.handoffReconciliation.continuityCodes,
        orphanReceiptCount: clientRuntimeState.handoffReconciliation.orphanReceiptCount,
        expiredHandoffCount: clientRuntimeState.handoffReconciliation.expiredHandoffCount,
        appliedReceiptCount: clientRuntimeState.appliedReceipts.length,
        outboxMessageCount: clientRuntimeState.outbox.messageCount,
        nextOutboxCommandType: clientRuntimeState.outbox.nextCommandType,
        routeAcceptanceStatus: routeAcceptanceContract.status,
        routeAcceptancePrimaryAction: routeAcceptanceContract.banner.primaryAction
      }
    ]
  });

  return {
    ok: operationalHealth.ready,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: CONTRACT_VERSION,
    request,
    command,
    clientState: {
      id: mergedClientState.id,
      actor: mergedClientState.actor,
      capabilities: mergedClientState.capabilities,
      roles: mergedClientState.roles,
      permissions: mergedClientState.permissions,
      approvalMode: mergedClientState.approvalMode,
      boundary: mergedClientState.boundary,
      permissionBoundary: mergedClientState.permissionBoundary,
      guardRuntime: {
        contractVersion: clientRuntimeState.contractVersion,
        inboxCursor: clientRuntimeState.inboxCursor,
        outboxCursor: clientRuntimeState.outboxCursor,
        activeHandoffId: clientRuntimeState.activeHandoffId,
        unreadCount: clientRuntimeState.unreadCount,
        handoffVisibleState: clientRuntimeState.handoffPresentation.visibleState,
        handoffPrimaryAction: clientRuntimeState.handoffPresentation.primaryAction,
        handoffNextClientCommandType: clientRuntimeState.handoffPresentation.nextClientCommandType,
        handoffRequiresUserInput: clientRuntimeState.handoffPresentation.requiresUserInput,
        handoffClientResumeToken: clientRuntimeState.handoffPresentation.clientResumeToken,
        handoffStaleClientRuntime: clientRuntimeState.handoffPresentation.staleClientRuntime,
        workflowContinuityHealthy: clientRuntimeState.handoffReconciliation.workflowContinuityHealthy,
        workflowContinuityCodes: clientRuntimeState.handoffReconciliation.continuityCodes,
        pendingHandoffCount: clientRuntimeState.handoffReconciliation.pendingHandoffCount,
        orphanReceiptCount: clientRuntimeState.handoffReconciliation.orphanReceiptCount,
        expiredHandoffCount: clientRuntimeState.handoffReconciliation.expiredHandoffCount,
        appliedReceiptCount: clientRuntimeState.appliedReceipts.length,
        outboxMessageCount: clientRuntimeState.outbox.messageCount
      }
    },
    guardDecision: finalDecision,
    userVisiblePreview,
    readiness: userVisiblePreview.readiness,
    acceptance: userVisiblePreview.acceptance,
    acceptanceReadiness,
    routeAcceptanceContract,
    explainableNextSteps,
    lifecycleControls: {
      enabled: lifecycleSettings.enabled,
      enforcementMode: lifecycleSettings.enforcementMode,
      approvalTtlMs: lifecycleSettings.approvalTtlMs,
      schedule: lifecycleSettings.schedule,
      scheduleState: lifecycleSettings.scheduleState,
      controlAction: lifecycleSettings.controlAction,
      transition: lifecycleSettings.transition,
      nextAction: nextPersistedState.restartSafeStatus.nextAction
    },
    operationalHealth,
    validation: {
      valid: operationalHealth.ready,
      issues: validationIssues,
      summary: validationSummary
    },
    failureState,
    retryPlan,
    degradedMode,
    actionableErrors,
    executionGate,
    providerContract,
    clientRuntimeState,
    analytics: {
      counters: analyticsReporting.counters,
      statusCounts: analyticsReporting.statusCounts,
      operationCounts: analyticsReporting.operationCounts,
      targetTypeCounts: analyticsReporting.targetTypeCounts,
      actorCounts: analyticsReporting.actorCounts,
      latestSnapshot: analyticsReporting.latestSnapshot,
      trendState: analyticsReporting.trendState,
      alertSummary: analyticsReporting.alertSummary,
      mailchimpReporting: analyticsReporting.mailchimpReporting,
      actionQueue: analyticsReporting.actionQueue,
      exportRows: analyticsReporting.exportRows
    },
    timeline: analyticsReporting.timeline,
    reportingState: analyticsReporting.reportingState,
    exportSummary: analyticsReporting.exportSummary,
    persistedState: finalPersistedState,
    recovery: finalPersistedState.restartSafeStatus,
    workflowHandoff,
    auditProof,
    evidence
  };
}

export default describeDestructiveActionGuardSurface;
