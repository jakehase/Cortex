export const surfaceId = "aios_verifier-claim-gate_human-review_069";
export const surfaceGroup = "verifier-claim-gate";
export const surfaceName = "human-review";

const FINAL_REVIEW_STATES = new Set(["approved", "rejected", "escalated"]);
const ACTION_TYPES = new Set(["approve", "reject", "request_changes", "escalate", "comment"]);
const LIFECYCLE_COMMANDS = new Set(["enable", "disable", "pause", "resume", "schedule_review", "cancel_schedule"]);
const CLIENT_HANDOFF_ACTIONS = new Set(["open_queue", "open_claim", "request_proof", "open_settings", "export_report"]);
const PROVIDER_CAPABILITIES = new Set(["claim-sync", "proof-fetch", "decision-write", "audit-export", "reviewer-assignment", "external-ticket"]);
const EXTERNAL_HANDOFF_STATES = new Set(["draft", "opened", "acknowledged", "synced", "closed", "failed"]);
const REVIEW_PERMISSIONS = new Set(["review:read", "review:assign", "review:decide", "proof:request", "audit:export", "settings:write"]);
const RETRYABLE_OPERATION_CODES = new Set(["provider_sync_missing", "provider_sync_stale", "provider_sync_ack_failed", "external_handoff_incomplete"]);
const ROLE_PERMISSIONS = {
  reviewer: ["review:read", "review:decide", "proof:request"],
  lead_reviewer: ["review:read", "review:assign", "review:decide", "proof:request", "audit:export"],
  auditor: ["review:read", "audit:export"],
  admin: ["review:read", "review:assign", "review:decide", "proof:request", "audit:export", "settings:write"]
};
const DEFAULT_SETTINGS = {
  enabled: true,
  requireProof: true,
  autoAssignReviewer: false,
  maxOpenClaims: 25,
  reviewSlaHours: 48,
  scheduledReviewAt: null,
  reviewerPool: []
};
const DEFAULT_COUNTERS = {
  totalClaims: 0,
  pendingReview: 0,
  approved: 0,
  rejected: 0,
  escalated: 0,
  blockedByMissingProof: 0,
  reviewerActions: 0
};

function list(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(value) {
  return [...new Set(list(value).map((item) => String(item || "").trim()).filter(Boolean))].sort();
}

function normalizeClaim(raw, index) {
  const proof = raw?.proof && typeof raw.proof === "object" ? raw.proof : {};
  const review = raw?.review && typeof raw.review === "object" ? raw.review : {};
  const scope = raw?.scope && typeof raw.scope === "object" ? raw.scope : {};
  const status = typeof review.status === "string" ? review.status : "pending";
  return {
    claimId: String(raw?.claimId || raw?.id || `claim-${index + 1}`),
    tenantId: String(raw?.tenantId || scope.tenantId || "default-tenant"),
    workspaceId: String(raw?.workspaceId || scope.workspaceId || raw?.workspace || "default-workspace"),
    route: String(raw?.route || "unrouted"),
    owner: String(raw?.owner || "unassigned"),
    status,
    submittedAt: raw?.submittedAt || null,
    reviewer: review.reviewer ? String(review.reviewer) : null,
    proofCount: list(proof.items).length,
    missingProof: proof.required === true && list(proof.items).length === 0,
    risk: Number.isFinite(raw?.risk) ? raw.risk : 0
  };
}

function normalizeAction(raw, index) {
  const type = ACTION_TYPES.has(raw?.type) ? raw.type : "comment";
  const actorScope = raw?.scope && typeof raw.scope === "object" ? raw.scope : {};
  const tenantId = raw?.tenantId || actorScope.tenantId;
  const workspaceId = raw?.workspaceId || actorScope.workspaceId;
  return {
    actionId: String(raw?.actionId || raw?.id || `action-${index + 1}`),
    claimId: raw?.claimId ? String(raw.claimId) : null,
    type,
    actor: String(raw?.actor || "reviewer"),
    tenantId: tenantId ? String(tenantId) : null,
    workspaceId: workspaceId ? String(workspaceId) : null,
    at: raw?.at || null,
    note: raw?.note ? String(raw.note) : ""
  };
}

function normalizeScope(rawInput = {}) {
  const request = rawInput.request && typeof rawInput.request === "object" ? rawInput.request : {};
  const client = rawInput.client && typeof rawInput.client === "object" ? rawInput.client : {};
  const rawRuntime = rawInput.runtime && typeof rawInput.runtime === "object" ? rawInput.runtime : {};
  const rawScope = rawInput.scope && typeof rawInput.scope === "object" ? rawInput.scope : {};
  const tenantId = String(rawScope.tenantId || request.tenantId || client.tenantId || rawRuntime.tenantId || "default-tenant");
  const workspaceId = String(rawScope.workspaceId || request.workspaceId || client.workspaceId || rawRuntime.workspaceId || "default-workspace");
  const roles = list(rawScope.roles ?? request.roles ?? client.roles ?? rawRuntime.roles)
    .map((role) => String(role || "").trim())
    .filter(Boolean);
  const explicitPermissions = list(rawScope.permissions ?? request.permissions ?? client.permissions ?? rawRuntime.permissions)
    .map((permission) => String(permission || "").trim())
    .filter((permission) => REVIEW_PERMISSIONS.has(permission));
  const effectiveRoles = roles.length > 0 ? roles : ["reviewer"];
  const knownRoles = effectiveRoles.filter((role) => ROLE_PERMISSIONS[role]);
  const unknownRoles = effectiveRoles.filter((role) => !ROLE_PERMISSIONS[role]);
  const rolePermissions = effectiveRoles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  const allowedTenantIds = uniqueStrings([
    ...list(rawScope.allowedTenantIds ?? request.allowedTenantIds ?? client.allowedTenantIds ?? rawRuntime.allowedTenantIds),
    tenantId
  ]);
  const allowedWorkspaceIds = uniqueStrings([
    ...list(rawScope.allowedWorkspaceIds ?? request.allowedWorkspaceIds ?? client.allowedWorkspaceIds ?? rawRuntime.allowedWorkspaceIds),
    workspaceId
  ]);
  return {
    contractType: "human-review.scope",
    schemaVersion: 1,
    tenantId,
    workspaceId,
    roles: [...new Set(effectiveRoles)].sort(),
    knownRoles: [...new Set(knownRoles)].sort(),
    unknownRoles: [...new Set(unknownRoles)].sort(),
    permissions: [...new Set([...rolePermissions, ...explicitPermissions])].sort(),
    allowedTenantIds,
    allowedWorkspaceIds,
    permissionGrantSummary: {
      roleGrantedPermissions: [...new Set(rolePermissions)].sort(),
      explicitlyGrantedPermissions: explicitPermissions,
      ignoredExplicitPermissions: list(rawScope.permissions ?? request.permissions ?? client.permissions ?? rawRuntime.permissions)
        .map((permission) => String(permission || "").trim())
        .filter((permission) => permission && !REVIEW_PERMISSIONS.has(permission))
        .sort()
    },
    isolationKey: `${tenantId}:${workspaceId}`
  };
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function parseTimestamp(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function externalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeProviderAckList(value) {
  return list(value)
    .map((id) => String(id || "").trim())
    .filter(Boolean);
}

function normalizeSettings(rawSettings = {}) {
  const settings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  const reviewerPool = list(settings.reviewerPool ?? settings.reviewers)
    .map((reviewer) => String(reviewer || "").trim())
    .filter(Boolean);
  return {
    enabled: settings.enabled !== false,
    requireProof: settings.requireProof !== false,
    autoAssignReviewer: settings.autoAssignReviewer === true,
    maxOpenClaims: positiveInteger(settings.maxOpenClaims, DEFAULT_SETTINGS.maxOpenClaims, { min: 1, max: 500 }),
    reviewSlaHours: positiveInteger(settings.reviewSlaHours, DEFAULT_SETTINGS.reviewSlaHours, { min: 1, max: 24 * 30 }),
    scheduledReviewAt: settings.scheduledReviewAt ? String(settings.scheduledReviewAt) : null,
    reviewerPool
  };
}

function normalizeLifecycleCommand(raw, index) {
  const command = raw && typeof raw === "object" ? raw : {};
  const type = LIFECYCLE_COMMANDS.has(command.type) ? command.type : "schedule_review";
  return {
    commandId: String(command.commandId || command.id || `lifecycle-command-${index + 1}`),
    type,
    actor: String(command.actor || "system"),
    at: command.at || null,
    reason: command.reason ? String(command.reason) : "",
    scheduledReviewAt: command.scheduledReviewAt ? String(command.scheduledReviewAt) : null
  };
}

function stableListFingerprint(values) {
  return [...new Set(list(values).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort()
    .join("|");
}

function normalizePersistedSnapshot(rawState = {}) {
  const acceptance = rawState.acceptance && typeof rawState.acceptance === "object" ? rawState.acceptance : {};
  const readiness = rawState.readiness && typeof rawState.readiness === "object" ? rawState.readiness : {};
  const provider = rawState.provider && typeof rawState.provider === "object" ? rawState.provider : {};
  const queues = rawState.queues && typeof rawState.queues === "object" ? rawState.queues : {};
  const pendingClaimIds = list(queues.pendingClaimIds ?? acceptance.pendingClaimIds);
  const decisionReadyClaimIds = list(queues.decisionReadyClaimIds ?? acceptance.decisionReadyClaimIds);
  const blockedClaimIds = list(queues.blockedClaimIds ?? acceptance.blockers);
  const terminalClaimIds = list(queues.terminalClaimIds ?? acceptance.acceptedClaimIds);
  return {
    contractType: "human-review.persisted-snapshot",
    schemaVersion: 1,
    status: rawState.status ? String(rawState.status) : null,
    pendingClaimIds: pendingClaimIds.map((id) => String(id || "").trim()).filter(Boolean).sort(),
    decisionReadyClaimIds: decisionReadyClaimIds.map((id) => String(id || "").trim()).filter(Boolean).sort(),
    blockedClaimIds: blockedClaimIds.map((id) => String(id || "").trim()).filter(Boolean).sort(),
    terminalClaimIds: terminalClaimIds.map((id) => String(id || "").trim()).filter(Boolean).sort(),
    canAcceptDispositions: acceptance.canAcceptDispositions === true ? true : acceptance.canAcceptDispositions === false ? false : null,
    canExport: acceptance.canExport === true ? true : acceptance.canExport === false ? false : null,
    readinessReady: readiness.ready === true ? true : readiness.ready === false ? false : null,
    readyForExport: readiness.readyForExport === true ? true : readiness.readyForExport === false ? false : null,
    providerId: provider.providerId ? String(provider.providerId) : null,
    providerSyncState: provider.syncState ? String(provider.syncState) : null,
    providerSyncRevision: provider.syncRevision ? String(provider.syncRevision) : null,
    providerCheckpointKey: provider.checkpointKey ? String(provider.checkpointKey) : null,
    queueFingerprint: [
      stableListFingerprint(pendingClaimIds),
      stableListFingerprint(decisionReadyClaimIds),
      stableListFingerprint(blockedClaimIds),
      stableListFingerprint(terminalClaimIds)
    ].join("::")
  };
}

function normalizePersistedState(rawInput = {}, scope, now) {
  const rawPersisted = rawInput.persistedState && typeof rawInput.persistedState === "object"
    ? rawInput.persistedState
    : rawInput.state && typeof rawInput.state === "object"
      ? rawInput.state
      : rawInput.recoveredState && typeof rawInput.recoveredState === "object"
        ? rawInput.recoveredState
        : {};
  const rawState = rawPersisted.nextState && typeof rawPersisted.nextState === "object"
    ? rawPersisted.nextState
    : rawPersisted;
  const recoverySource = rawPersisted.nextState && typeof rawPersisted.nextState === "object"
    ? "persistence_contract_next_state"
    : Object.keys(rawPersisted).length > 0
      ? "checkpoint"
      : "none";
  const lifecycle = rawState.lifecycle && typeof rawState.lifecycle === "object" ? rawState.lifecycle : {};
  const commandLedger = list(rawState.commandLedger ?? lifecycle.commandLedger)
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => ({
      commandId: String(entry.commandId || entry.id || `persisted-command-${index + 1}`),
      type: entry.type ? String(entry.type) : null,
      status: entry.status === "rejected" ? "rejected" : entry.status === "replayed" ? "replayed" : "accepted",
      appliedAt: entry.appliedAt || entry.at || null
    }));
  const duplicateLedgerIds = commandLedger
    .map((entry) => entry.commandId)
    .filter((commandId, index, values) => values.indexOf(commandId) !== index);
  const processedCommandIds = [
    ...list(rawState.processedCommandIds ?? lifecycle.processedCommandIds).map((id) => String(id || "").trim()).filter(Boolean),
    ...commandLedger.map((entry) => entry.commandId)
  ];
  const persistedTenantId = rawState.tenantId || rawState.scope?.tenantId || lifecycle.tenantId;
  const persistedWorkspaceId = rawState.workspaceId || rawState.scope?.workspaceId || lifecycle.workspaceId;
  const persistedIsolationKey = rawState.isolationKey || (persistedTenantId && persistedWorkspaceId ? `${persistedTenantId}:${persistedWorkspaceId}` : null);
  const scopeMatches = !persistedIsolationKey || persistedIsolationKey === scope.isolationKey;
  const checkpointAt = rawState.checkpointAt || rawState.generatedAt || rawState.updatedAt || null;
  const checkpointMs = parseTimestamp(checkpointAt);
  const findings = [];
  if (!scopeMatches) {
    findings.push({
      severity: "warning",
      code: "persisted_state_scope_mismatch",
      message: "Recovered human review state was ignored because it belongs to a different tenant/workspace.",
      persistedIsolationKey,
      activeIsolationKey: scope.isolationKey
    });
  }
  if (checkpointAt && checkpointMs === null) {
    findings.push({
      severity: "warning",
      code: "persisted_checkpoint_invalid",
      message: "Recovered human review checkpoint timestamp is not ISO-parseable."
    });
  }
  if (duplicateLedgerIds.length > 0) {
    findings.push({
      severity: "warning",
      code: "persisted_command_ledger_duplicates",
      message: "Recovered human review command ledger contained duplicate command ids; replay will de-duplicate them.",
      commandIds: [...new Set(duplicateLedgerIds)].sort()
    });
  }
  const snapshot = normalizePersistedSnapshot(rawState);
  return {
    contractType: "human-review.persisted-state",
    schemaVersion: 1,
    stateId: String(rawState.stateId || rawState.id || `${scope.isolationKey}:human-review`),
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    isolationKey: scope.isolationKey,
    recovered: Object.keys(rawState).length > 0,
    usable: scopeMatches,
    recoverySource,
    checkpointAt,
    checkpointAgeMinutes: checkpointMs === null ? null : Math.max(0, Math.round((Date.parse(now) - checkpointMs) / (60 * 1000))),
    lifecycle: {
      hasCheckpoint: scopeMatches && Object.keys(lifecycle).length > 0,
      enabled: lifecycle.enabled === false ? false : lifecycle.enabled === true ? true : null,
      paused: lifecycle.paused === true,
      scheduledReviewAt: lifecycle.scheduledReviewAt ? String(lifecycle.scheduledReviewAt) : null,
      lastCommandId: lifecycle.lastCommand?.commandId || lifecycle.lastCommandId || null,
      processedCommandIds: [...new Set(scopeMatches ? processedCommandIds : [])].sort()
    },
    commandLedger: scopeMatches ? commandLedger : [],
    snapshot: scopeMatches ? snapshot : normalizePersistedSnapshot({}),
    recoveryFindings: findings,
    recoveryMode: !Object.keys(rawState).length ? "cold_start" : scopeMatches ? "recovered" : "ignored_scope_mismatch"
  };
}

function normalizeClientRuntime(rawInput = {}) {
  const request = rawInput.request && typeof rawInput.request === "object" ? rawInput.request : {};
  const client = rawInput.client && typeof rawInput.client === "object" ? rawInput.client : {};
  const rawRuntime = rawInput.runtime && typeof rawInput.runtime === "object" ? rawInput.runtime : {};
  const requestedAction = request.action || client.action || rawRuntime.action;
  const selectedClaimId = request.claimId || request.selectedClaimId || client.selectedClaimId || rawRuntime.selectedClaimId;
  const capabilities = new Set(
    list(client.capabilities ?? request.capabilities ?? rawRuntime.capabilities)
      .map((capability) => String(capability || "").trim())
      .filter(Boolean)
  );
  return {
    contractType: "human-review.client-runtime",
    schemaVersion: 1,
    sessionId: String(request.sessionId || client.sessionId || rawRuntime.sessionId || "anonymous-session"),
    actor: String(request.actor || client.actor || rawRuntime.actor || "reviewer"),
    currentRoute: String(request.route || client.route || rawRuntime.route || "review-queue"),
    returnTo: String(request.returnTo || client.returnTo || rawRuntime.returnTo || "review-queue"),
    selectedClaimId: selectedClaimId ? String(selectedClaimId) : null,
    requestedAction: CLIENT_HANDOFF_ACTIONS.has(requestedAction) ? requestedAction : "open_queue",
    capabilities: [...capabilities].sort(),
    supportsInlineProof: capabilities.has("inline-proof"),
    supportsAuditExport: capabilities.has("audit-export"),
    supportsReviewAssignment: capabilities.has("review-assignment")
  };
}

function normalizeProviderRuntime(rawInput = {}) {
  const provider = rawInput.provider && typeof rawInput.provider === "object" ? rawInput.provider : {};
  const service = rawInput.service && typeof rawInput.service === "object" ? rawInput.service : {};
  const integration = rawInput.integration && typeof rawInput.integration === "object" ? rawInput.integration : {};
  const source = Object.keys(provider).length > 0 ? provider : Object.keys(service).length > 0 ? service : integration;
  const rawCapabilities = list(source.capabilities ?? source.serviceCapabilities ?? source.supportedCapabilities);
  const mode = source.mode === "external" ? "external" : source.mode === "hybrid" ? "hybrid" : "hosted";
  const defaultCapabilities = mode === "hosted"
    ? ["claim-sync", "proof-fetch", "decision-write", "audit-export", "reviewer-assignment"]
    : [];
  const capabilities = (rawCapabilities.length > 0 ? rawCapabilities : defaultCapabilities)
    .map((capability) => String(capability || "").trim())
    .filter((capability) => PROVIDER_CAPABILITIES.has(capability));
  const sync = source.sync && typeof source.sync === "object" ? source.sync : {};
  const handoff = source.handoff && typeof source.handoff === "object" ? source.handoff : {};
  const external = source.external && typeof source.external === "object" ? source.external : {};
  return {
    contractType: "human-review.provider-runtime",
    schemaVersion: 1,
    providerId: String(source.providerId || source.id || source.name || "hosted-kernel"),
    serviceName: String(source.serviceName || source.name || "human-review-provider"),
    endpointRef: String(source.endpointRef || source.endpoint || "kernel://verifier-claim-gate/human-review"),
    mode,
    capabilities: [...new Set(capabilities)].sort(),
    sync: {
      cursor: sync.cursor || source.cursor || null,
      lastSyncedAt: sync.lastSyncedAt || source.lastSyncedAt || null,
      watermark: sync.watermark || source.watermark || null,
      revision: String(sync.revision || source.revision || "0"),
      acknowledgedRevision: sync.acknowledgedRevision || source.acknowledgedRevision
        ? String(sync.acknowledgedRevision || source.acknowledgedRevision)
        : null,
      acknowledgedClaimIds: normalizeProviderAckList(sync.acknowledgedClaimIds ?? source.acknowledgedClaimIds),
      failedClaimIds: normalizeProviderAckList(sync.failedClaimIds ?? source.failedClaimIds),
      ackedAt: sync.ackedAt || source.ackedAt || null
    },
    handoff: {
      externalSystem: String(handoff.externalSystem || external.system || source.externalSystem || ""),
      externalCaseId: handoff.externalCaseId || external.caseId || source.externalCaseId || null,
      callbackUrl: handoff.callbackUrl || external.callbackUrl || source.callbackUrl || null,
      ticketUrl: handoff.ticketUrl || external.ticketUrl || source.ticketUrl || null,
      state: EXTERNAL_HANDOFF_STATES.has(handoff.state || external.state || source.handoffState)
        ? handoff.state || external.state || source.handoffState
        : "draft",
      lastHandoffAt: handoff.lastHandoffAt || external.lastHandoffAt || source.lastHandoffAt || null,
      callbackSecretRef: handoff.callbackSecretRef || external.callbackSecretRef || source.callbackSecretRef || null
    }
  };
}

function normalizeOperationalRuntime(rawInput = {}) {
  const rawHealth = rawInput.health && typeof rawInput.health === "object" ? rawInput.health : {};
  const rawOperations = rawInput.operations && typeof rawInput.operations === "object" ? rawInput.operations : {};
  const rawRetry = rawOperations.retry && typeof rawOperations.retry === "object"
    ? rawOperations.retry
    : rawHealth.retry && typeof rawHealth.retry === "object"
      ? rawHealth.retry
      : {};
  const rawDegraded = rawHealth.degradedMode && typeof rawHealth.degradedMode === "object" ? rawHealth.degradedMode : {};
  return {
    contractType: "human-review.operational-runtime",
    schemaVersion: 1,
    probeId: String(rawHealth.probeId || rawOperations.probeId || "human-review-health"),
    lastProbeAt: rawHealth.lastProbeAt || rawOperations.lastProbeAt || null,
    consecutiveFailures: positiveInteger(rawHealth.consecutiveFailures ?? rawOperations.consecutiveFailures, 0, { min: 0, max: 1000 }),
    lastErrorCode: rawHealth.lastErrorCode || rawOperations.lastErrorCode ? String(rawHealth.lastErrorCode || rawOperations.lastErrorCode) : null,
    lastErrorMessage: rawHealth.lastErrorMessage || rawOperations.lastErrorMessage ? String(rawHealth.lastErrorMessage || rawOperations.lastErrorMessage) : "",
    retry: {
      attempts: positiveInteger(rawRetry.attempts, 0, { min: 0, max: 1000 }),
      maxAttempts: positiveInteger(rawRetry.maxAttempts, 3, { min: 1, max: 20 }),
      baseDelayMs: positiveInteger(rawRetry.baseDelayMs, 1000, { min: 100, max: 60 * 1000 }),
      maxDelayMs: positiveInteger(rawRetry.maxDelayMs, 30 * 1000, { min: 1000, max: 15 * 60 * 1000 }),
      lastAttemptAt: rawRetry.lastAttemptAt || null
    },
    degradedMode: {
      forced: rawDegraded.forced === true || rawHealth.forceDegraded === true,
      reason: rawDegraded.reason || rawHealth.degradedReason ? String(rawDegraded.reason || rawHealth.degradedReason) : "",
      allowReadOnlyQueue: rawDegraded.allowReadOnlyQueue !== false,
      allowAuditExport: rawDegraded.allowAuditExport === true
    }
  };
}

function buildOperationalRuntimeValidation({ operationalRuntime, now }) {
  const nowMs = Date.parse(now);
  const probeMs = parseTimestamp(operationalRuntime.lastProbeAt);
  const lastAttemptMs = parseTimestamp(operationalRuntime.retry.lastAttemptAt);
  const findings = [];
  if (operationalRuntime.lastProbeAt && probeMs === null) {
    findings.push({
      severity: "error",
      source: "operation_probe",
      code: "health_probe_timestamp_invalid",
      message: "Human review health probe lastProbeAt must be an ISO-parseable timestamp."
    });
  }
  if (probeMs !== null && probeMs > nowMs + 5 * 60 * 1000) {
    findings.push({
      severity: "warning",
      source: "operation_probe",
      code: "health_probe_timestamp_future",
      message: "Human review health probe timestamp is more than five minutes in the future.",
      lastProbeAt: operationalRuntime.lastProbeAt
    });
  }
  if (operationalRuntime.retry.lastAttemptAt && lastAttemptMs === null) {
    findings.push({
      severity: "error",
      source: "retry",
      code: "retry_last_attempt_timestamp_invalid",
      message: "Human review retry lastAttemptAt must be an ISO-parseable timestamp."
    });
  }
  if (lastAttemptMs !== null && lastAttemptMs > nowMs + 5 * 60 * 1000) {
    findings.push({
      severity: "warning",
      source: "retry",
      code: "retry_last_attempt_timestamp_future",
      message: "Human review retry lastAttemptAt is more than five minutes in the future.",
      lastAttemptAt: operationalRuntime.retry.lastAttemptAt
    });
  }
  if (probeMs !== null && lastAttemptMs !== null && lastAttemptMs < probeMs && operationalRuntime.retry.attempts > 0) {
    findings.push({
      severity: "info",
      source: "retry",
      code: "retry_attempt_precedes_latest_probe",
      message: "Recorded retry attempt predates the latest health probe and will not delay the next probe-derived retry."
    });
  }
  if (operationalRuntime.retry.maxDelayMs < operationalRuntime.retry.baseDelayMs) {
    findings.push({
      severity: "warning",
      source: "retry",
      code: "retry_max_delay_below_base",
      message: "Human review retry maxDelayMs is lower than baseDelayMs; retry backoff will be capped immediately.",
      baseDelayMs: operationalRuntime.retry.baseDelayMs,
      maxDelayMs: operationalRuntime.retry.maxDelayMs
    });
  }
  if (operationalRuntime.consecutiveFailures > 0 && !operationalRuntime.lastErrorCode) {
    findings.push({
      severity: "warning",
      source: "operation_probe",
      code: "health_failure_code_missing",
      message: "Human review reported consecutive probe failures without a lastErrorCode."
    });
  }
  if (operationalRuntime.degradedMode.forced && !operationalRuntime.degradedMode.reason) {
    findings.push({
      severity: "warning",
      source: "degraded_mode",
      code: "degraded_mode_reason_missing",
      message: "Forced degraded mode should include a reason for operator audit."
    });
  }
  return {
    contractType: "human-review.operational-validation",
    schemaVersion: 1,
    valid: findings.every((finding) => finding.severity !== "error"),
    findingCount: findings.length,
    errorCount: findings.filter((finding) => finding.severity === "error").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
    findings
  };
}

function resolveOperationalRecovery({ status, canRetry, retryExhausted, operationIssues, workflowHandoff }) {
  const topError = operationIssues.find((issue) => issue.severity === "error");
  const topWarning = operationIssues.find((issue) => issue.severity === "warning");
  const topIssue = topError || topWarning || null;
  if (status === "healthy") {
    return {
      state: "available",
      reasonCode: null,
      recoveryAction: "continue_review",
      operatorRoute: workflowHandoff.route,
      message: "Human review operations are available."
    };
  }
  if (canRetry) {
    return {
      state: "retry_scheduled",
      reasonCode: topIssue?.code || "retryable_operation_issue",
      recoveryAction: "retry_provider_sync",
      operatorRoute: "review-queue",
      message: topIssue?.message || "Retryable human review operation issue detected."
    };
  }
  if (retryExhausted) {
    return {
      state: "manual_intervention_required",
      reasonCode: topIssue?.code || "retry_exhausted",
      recoveryAction: "open_operational_incident",
      operatorRoute: "review-settings",
      message: "Human review retry budget is exhausted and requires operator intervention."
    };
  }
  return {
    state: status === "degraded" ? "degraded_read_only" : "attention_required",
    reasonCode: topIssue?.code || "operational_attention_required",
    recoveryAction: topIssue?.source === "settings" ? "open_settings" : "inspect_human_review",
    operatorRoute: topIssue?.source === "settings" ? "review-settings" : workflowHandoff.route,
    message: topIssue?.message || "Human review operations require attention."
  };
}

function buildQueueFailureContract({ claims, counters, settings, lifecycle, acceptanceContract, dispositionContract, providerServiceContract, now }) {
  const nowMs = Date.parse(now);
  const openRecords = dispositionContract.records.filter((record) => !record.terminal);
  const openClaimIds = openRecords.map((record) => record.claimId);
  const unassignedClaimIds = claims
    .filter((claim) => !FINAL_REVIEW_STATES.has(claim.status) && !claim.reviewer)
    .map((claim) => claim.claimId);
  const overdueClaimIds = openRecords
    .filter((record) => record.ageHours !== null && record.ageHours > settings.reviewSlaHours)
    .map((record) => record.claimId);
  const stalledProofClaimIds = openRecords
    .filter((record) => record.proof.required && record.proof.missing)
    .map((record) => record.claimId);
  const providerBlockedClaimIds = providerServiceContract.syncBatch.items
    .filter((item) => openClaimIds.includes(item.claimId) && item.blockerCodes.length > 0)
    .map((item) => item.claimId);
  const failedAckClaimIds = providerServiceContract.syncBatch.items
    .filter((item) => item.ackState === "failed")
    .map((item) => item.claimId);
  const pendingAckClaimIds = providerServiceContract.syncBatch.items
    .filter((item) => item.ackState === "pending" && !item.dispatchable)
    .map((item) => item.claimId);
  const noDispatchPath = counters.pendingReview > 0 &&
    providerServiceContract.syncBatch.dispatchableCount === 0 &&
    !acceptanceContract.canAcceptDispositions;
  const queueAgeHours = openRecords
    .map((record) => record.ageHours)
    .filter((ageHours) => Number.isFinite(ageHours));
  const oldestOpenAgeHours = queueAgeHours.length > 0 ? Math.max(...queueAgeHours) : null;
  const incidents = [
    ...(overdueClaimIds.length > 0 ? [{
      severity: "warning",
      source: "queue",
      code: "review_queue_sla_overdue",
      message: "One or more open human review claims are older than the configured review SLA.",
      claimIds: overdueClaimIds,
      action: "escalate_overdue_claim"
    }] : []),
    ...(stalledProofClaimIds.length > 0 ? [{
      severity: "warning",
      source: "queue",
      code: "review_queue_waiting_on_proof",
      message: "Open human review claims are blocked until required proof is collected.",
      claimIds: stalledProofClaimIds,
      action: "request_proof"
    }] : []),
    ...(unassignedClaimIds.length > 0 && settings.autoAssignReviewer ? [{
      severity: "error",
      source: "queue",
      code: "review_queue_assignment_failed",
      message: "Automatic reviewer assignment is enabled but open claims remain unassigned.",
      claimIds: unassignedClaimIds,
      action: "repair_reviewer_assignment"
    }] : []),
    ...(failedAckClaimIds.length > 0 ? [{
      severity: "warning",
      source: "provider_sync",
      code: "review_queue_provider_ack_failed",
      message: "Provider acknowledgement failed for queued human review claims.",
      claimIds: failedAckClaimIds,
      action: "retry_provider_sync"
    }] : []),
    ...(providerBlockedClaimIds.length > 0 && noDispatchPath ? [{
      severity: "error",
      source: "provider_sync",
      code: "review_queue_no_dispatch_path",
      message: "Open human review claims cannot accept dispositions and have no dispatchable provider sync path.",
      claimIds: [...new Set(providerBlockedClaimIds)].sort(),
      action: "inspect_provider_sync"
    }] : []),
    ...(pendingAckClaimIds.length > 0 && providerServiceContract.syncBatch.requiresExternalAck ? [{
      severity: "info",
      source: "provider_sync",
      code: "review_queue_waiting_on_external_ack",
      message: "Open human review claims are waiting for external provider acknowledgement.",
      claimIds: pendingAckClaimIds,
      action: "monitor_external_handoff"
    }] : [])
  ];
  const failureSeverity = incidents.some((incident) => incident.severity === "error")
    ? "error"
    : incidents.some((incident) => incident.severity === "warning")
      ? "warning"
      : "info";
  const state = counters.pendingReview === 0
    ? "empty"
    : failureSeverity === "error"
      ? "stalled"
      : failureSeverity === "warning"
        ? "attention_required"
        : providerServiceContract.syncBatch.readyToDispatch
          ? "dispatch_ready"
          : acceptanceContract.canAcceptDispositions
            ? "decision_ready"
            : "monitoring";
  const topIncident = incidents.find((incident) => incident.severity === "error") ||
    incidents.find((incident) => incident.severity === "warning") ||
    incidents[0] ||
    null;
  return {
    contractType: "human-review.queue-failure",
    schemaVersion: 1,
    generatedAt: now,
    state,
    healthy: state === "empty" || state === "decision_ready" || state === "dispatch_ready" || state === "monitoring",
    stalled: state === "stalled",
    pendingClaimCount: counters.pendingReview,
    oldestOpenAgeHours,
    slaHours: settings.reviewSlaHours,
    openClaimIds,
    decisionReadyClaimIds: dispositionContract.decisionReadyClaimIds,
    blockedClaimIds: dispositionContract.blockedClaimIds,
    unassignedClaimIds,
    overdueClaimIds,
    stalledProofClaimIds,
    providerBlockedClaimIds: [...new Set(providerBlockedClaimIds)].sort(),
    failedAckClaimIds,
    nextOperatorAction: topIncident?.action || (counters.pendingReview > 0 ? "review_next_claim" : "none"),
    nextOperatorClaimId: topIncident?.claimIds?.[0] || dispositionContract.decisionReadyClaimIds[0] || openClaimIds[0] || null,
    incidents,
    proof: {
      evaluatedAt: now,
      lifecycleEnabled: lifecycle.enabled,
      lifecyclePaused: lifecycle.paused,
      acceptanceAvailable: acceptanceContract.canAcceptDispositions,
      providerBatchReady: providerServiceContract.syncBatch.readyToDispatch,
      providerCheckpointKey: providerServiceContract.sync.checkpointKey,
      evaluationWindowMs: Number.isFinite(nowMs) ? settings.reviewSlaHours * 60 * 60 * 1000 : null
    }
  };
}

function buildOperationalHealthContract({ operationalRuntime, operationalValidation, providerServiceContract, settings, settingsStatus, lifecycle, counters, readinessContract, acceptanceContract, workflowHandoff, queueFailureContract, now }) {
  const nowMs = Date.parse(now);
  const retryAttempt = Math.min(operationalRuntime.retry.maxAttempts, operationalRuntime.retry.attempts + 1);
  const exponentialDelayMs = operationalRuntime.retry.baseDelayMs * (2 ** Math.max(0, retryAttempt - 1));
  const nextRetryDelayMs = Math.min(operationalRuntime.retry.maxDelayMs, exponentialDelayMs);
  const lastProbeMs = parseTimestamp(operationalRuntime.lastProbeAt);
  const probeAgeMinutes = lastProbeMs === null ? null : Math.max(0, Math.round((nowMs - lastProbeMs) / (60 * 1000)));
  const providerErrors = providerServiceContract.findings.filter((finding) => finding.severity === "error");
  const providerWarnings = providerServiceContract.findings.filter((finding) => finding.severity === "warning");
  const staleProbeLimitMinutes = Math.max(15, settings.reviewSlaHours * 60);
  const operationIssues = [
    ...providerErrors.map((finding) => ({
      severity: "error",
      source: "provider",
      retryable: RETRYABLE_OPERATION_CODES.has(finding.code),
      ...finding
    })),
    ...providerWarnings.map((finding) => ({
      severity: "warning",
      source: "provider",
      retryable: RETRYABLE_OPERATION_CODES.has(finding.code),
      ...finding
    })),
    ...settingsStatus.errors.map((error) => ({ severity: "error", source: "settings", retryable: false, ...error })),
    ...(!lifecycle.enabled ? [{
      severity: "error",
      source: "lifecycle",
      retryable: false,
      code: "review_gate_disabled",
      message: "Human review operations are stopped until the gate is enabled."
    }] : []),
    ...(lifecycle.paused ? [{
      severity: "warning",
      source: "lifecycle",
      retryable: false,
      code: "review_gate_paused",
      message: "Human review operations are paused and will not accept dispositions."
    }] : []),
    ...(operationalRuntime.lastErrorCode ? [{
      severity: operationalRuntime.consecutiveFailures >= operationalRuntime.retry.maxAttempts ? "error" : "warning",
      source: "operation_probe",
      retryable: operationalRuntime.retry.attempts < operationalRuntime.retry.maxAttempts,
      code: operationalRuntime.lastErrorCode,
      message: operationalRuntime.lastErrorMessage || "Last human review operational probe reported an error."
    }] : []),
    ...operationalValidation.findings.map((finding) => ({
      retryable: finding.severity !== "error" && (finding.source === "retry" || finding.source === "operation_probe"),
      ...finding
    })),
    ...(counters.totalClaims > 0 && !operationalRuntime.lastProbeAt ? [{
      severity: "warning",
      source: "operation_probe",
      retryable: false,
      code: "health_probe_missing",
      message: "Human review has scoped claims but no operational health probe timestamp."
    }] : []),
    ...(probeAgeMinutes !== null && counters.totalClaims > 0 && probeAgeMinutes > staleProbeLimitMinutes ? [{
      severity: "warning",
      source: "operation_probe",
      retryable: false,
      code: "health_probe_age_attention",
      message: "Human review operational probe is older than the configured review SLA window.",
      probeAgeMinutes,
      staleProbeLimitMinutes
    }] : []),
    ...queueFailureContract.incidents.map((incident) => ({
      severity: incident.severity,
      source: incident.source,
      retryable: incident.action === "retry_provider_sync",
      code: incident.code,
      message: incident.message,
      claimIds: incident.claimIds,
      route: incident.claimIds?.[0] ? `claims/${incident.claimIds[0]}/review` : workflowHandoff.route,
      recommendedAction: incident.action
    }))
  ];
  const retryableIssueCodes = operationIssues
    .filter((issue) => issue.retryable)
    .map((issue) => issue.code);
  const retryExhausted = operationalRuntime.retry.attempts >= operationalRuntime.retry.maxAttempts ||
    operationalRuntime.consecutiveFailures >= operationalRuntime.retry.maxAttempts;
  const queuePressure = counters.pendingReview > 0 && !acceptanceContract.canAcceptDispositions;
  const degraded = operationalRuntime.degradedMode.forced ||
    providerWarnings.length > 0 ||
    providerServiceContract.sync.state === "stale" ||
    queueFailureContract.state === "attention_required" ||
    (queuePressure && readinessContract.readyCheckCount > 0);
  const failed = operationIssues.some((issue) => issue.severity === "error") && (!degraded || retryExhausted || providerErrors.length > 0 || queueFailureContract.stalled);
  const canRetry = retryableIssueCodes.length > 0 && !retryExhausted;
  const status = failed
    ? "failing"
    : degraded
      ? "degraded"
      : operationIssues.length > 0
        ? "attention_required"
        : "healthy";
  const nextRetryAt = canRetry
    ? new Date(nowMs + nextRetryDelayMs).toISOString()
    : null;
  const readOnly = status === "degraded" || status === "failing";
  const recovery = resolveOperationalRecovery({
    status,
    canRetry,
    retryExhausted,
    operationIssues,
    workflowHandoff
  });
  return {
    contractType: "human-review.operational-health",
    schemaVersion: 1,
    generatedAt: now,
    probeId: operationalRuntime.probeId,
    status,
    healthy: status === "healthy",
    degraded,
    failed: status === "failing",
    validation: operationalValidation,
    mode: readOnly
      ? operationalRuntime.degradedMode.allowReadOnlyQueue
        ? "read_only_review_queue"
        : "blocked"
      : "normal",
    probe: {
      lastProbeAt: operationalRuntime.lastProbeAt,
      probeAgeMinutes,
      consecutiveFailures: operationalRuntime.consecutiveFailures,
      lastErrorCode: operationalRuntime.lastErrorCode,
      lastErrorMessage: operationalRuntime.lastErrorMessage
    },
    retryPlan: {
      canRetry,
      retryExhausted,
      attempts: operationalRuntime.retry.attempts,
      maxAttempts: operationalRuntime.retry.maxAttempts,
      nextAttempt: canRetry ? retryAttempt : null,
      nextRetryDelayMs: canRetry ? nextRetryDelayMs : null,
      nextRetryAt,
      retryableIssueCodes: [...new Set(retryableIssueCodes)].sort()
    },
    failureState: {
      state: recovery.state,
      reasonCode: recovery.reasonCode,
      recoveryAction: recovery.recoveryAction,
      operatorRoute: recovery.operatorRoute,
      message: recovery.message,
      retryAfterMs: canRetry ? nextRetryDelayMs : null,
      readOnlyQueueAllowed: readOnly && operationalRuntime.degradedMode.allowReadOnlyQueue,
      auditExportAllowed: operationalRuntime.degradedMode.allowAuditExport && readinessContract.readyForExport,
      queueState: queueFailureContract.state,
      queueAction: queueFailureContract.nextOperatorAction,
      queueClaimId: queueFailureContract.nextOperatorClaimId
    },
    queueFailure: queueFailureContract,
    degradedMode: {
      forced: operationalRuntime.degradedMode.forced,
      reason: operationalRuntime.degradedMode.reason || (degraded ? operationIssues[0]?.code || "provider_degraded" : ""),
      allowReadOnlyQueue: operationalRuntime.degradedMode.allowReadOnlyQueue,
      allowAuditExport: operationalRuntime.degradedMode.allowAuditExport && readinessContract.readyForExport
    },
    actionableErrors: operationIssues
      .filter((issue) => issue.severity === "error" || issue.severity === "warning")
      .map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        source: issue.source,
        message: issue.message,
        retryable: issue.retryable,
        action: issue.retryable
          ? "retry_provider_sync"
          : issue.recommendedAction
            ? issue.recommendedAction
          : issue.code === "health_probe_timestamp_invalid" || issue.code === "retry_last_attempt_timestamp_invalid"
            ? "repair_health_probe_payload"
          : issue.source === "settings"
            ? "open_settings"
            : issue.code === "review_gate_disabled"
              ? "enable_gate"
              : issue.code === "review_gate_paused"
                ? "resume_gate"
                : "inspect_human_review",
        route: issue.source === "settings"
          ? "review-settings"
          : workflowHandoff.route
      })),
    checks: [
      { key: "provider_negotiated", ok: providerServiceContract.negotiated, severity: providerServiceContract.negotiated ? "info" : "error" },
      { key: "provider_sync_current", ok: providerServiceContract.sync.state === "current" || counters.totalClaims === 0, severity: providerServiceContract.sync.state === "stale" ? "warning" : "info" },
      { key: "provider_sync_batch_dispatchable", ok: providerServiceContract.syncBatch.readyToDispatch || providerServiceContract.syncBatch.itemCount === 0, severity: providerServiceContract.syncBatch.failedAckCount > 0 ? "warning" : "info" },
      { key: "operational_payload_valid", ok: operationalValidation.valid, severity: operationalValidation.valid ? "info" : "error" },
      { key: "queue_not_stalled", ok: !queueFailureContract.stalled, severity: queueFailureContract.stalled ? "error" : queueFailureContract.incidents.length > 0 ? "warning" : "info" },
      { key: "settings_valid", ok: settingsStatus.valid, severity: settingsStatus.valid ? "info" : "error" },
      { key: "lifecycle_accepting", ok: lifecycle.enabled && !lifecycle.paused, severity: !lifecycle.enabled ? "error" : lifecycle.paused ? "warning" : "info" },
      { key: "acceptance_available", ok: acceptanceContract.canAcceptDispositions || counters.pendingReview === 0, severity: acceptanceContract.canAcceptDispositions ? "info" : "warning" }
    ]
  };
}

function buildExternalHandoffPlan({ providerRuntime, dispositionContract, workflowHandoff, now }) {
  const required = providerRuntime.mode !== "hosted";
  const callbackUrl = externalUrl(providerRuntime.handoff.callbackUrl);
  const ticketUrl = externalUrl(providerRuntime.handoff.ticketUrl);
  const rawCallbackUrl = providerRuntime.handoff.callbackUrl ? String(providerRuntime.handoff.callbackUrl) : null;
  const rawTicketUrl = providerRuntime.handoff.ticketUrl ? String(providerRuntime.handoff.ticketUrl) : null;
  const openRecords = dispositionContract.records.filter((record) => !record.terminal);
  const selectedRecord = workflowHandoff.claimId
    ? openRecords.find((record) => record.claimId === workflowHandoff.claimId) || null
    : null;
  const orderedRecords = [
    ...(selectedRecord ? [selectedRecord] : []),
    ...openRecords.filter((record) => record.claimId !== selectedRecord?.claimId)
  ];
  const items = orderedRecords.map((record) => {
    const needsProof = record.proof.required && record.proof.missing;
    const operation = needsProof
      ? "request_proof"
      : record.canAcceptDecision
        ? "sync_decision_ready_claim"
        : "sync_blocked_claim";
    return {
      contractType: "human-review.external-handoff-item",
      schemaVersion: 1,
      claimId: record.claimId,
      operation,
      route: operation === "request_proof" ? `claims/${record.claimId}/proof` : `claims/${record.claimId}/review`,
      priority: record.risk >= 80 ? "critical" : record.risk >= 50 ? "high" : "standard",
      blockerCodes: record.blockerCodes,
      canAcceptDecision: record.canAcceptDecision,
      proofMissing: record.proof.missing,
      syncKey: `${providerRuntime.providerId}:${record.tenantId}:${record.workspaceId}:${record.claimId}`,
      payload: {
        claimId: record.claimId,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        status: record.status,
        reviewer: record.reviewer,
        route: record.route,
        owner: record.owner,
        risk: record.risk
      }
    };
  });
  const findings = [];
  if (required && !providerRuntime.handoff.externalSystem) {
    findings.push({
      severity: "error",
      code: "external_system_missing",
      message: "External human review handoff requires an external system identifier."
    });
  }
  if (required && rawCallbackUrl && !callbackUrl) {
    findings.push({
      severity: "error",
      code: "external_callback_url_invalid",
      message: "External human review callbackUrl must be an http or https URL."
    });
  }
  if (required && rawTicketUrl && !ticketUrl) {
    findings.push({
      severity: "warning",
      code: "external_ticket_url_invalid",
      message: "External human review ticketUrl was ignored because it is not an http or https URL."
    });
  }
  if (required && providerRuntime.handoff.state === "failed") {
    findings.push({
      severity: "error",
      code: "external_handoff_failed",
      message: "External provider reported the human review handoff as failed."
    });
  }
  const ready = !required || (
    providerRuntime.handoff.externalSystem &&
    (providerRuntime.handoff.externalCaseId || callbackUrl) &&
    providerRuntime.handoff.state !== "failed"
  );
  return {
    contractType: "human-review.external-handoff-plan",
    schemaVersion: 1,
    generatedAt: now,
    required,
    ready,
    state: !required
      ? "not_required"
      : !ready
        ? "blocked"
        : providerRuntime.handoff.state,
    providerId: providerRuntime.providerId,
    system: providerRuntime.handoff.externalSystem || null,
    caseId: providerRuntime.handoff.externalCaseId,
    callbackUrl,
    ticketUrl,
    callbackSecretRef: providerRuntime.handoff.callbackSecretRef || null,
    lastHandoffAt: providerRuntime.handoff.lastHandoffAt,
    targetClaimIds: items.map((item) => item.claimId),
    pendingOperationCount: items.length,
    nextOperation: items[0]?.operation || null,
    items,
    findings
  };
}

function buildProviderSyncBatch({ providerRuntime, scope, dispositionContract, externalHandoffPlan, missingCapabilities, revisionValid, now }) {
  const missingCapabilitySet = new Set(missingCapabilities);
  const acknowledgedClaimIds = new Set(providerRuntime.sync.acknowledgedClaimIds);
  const failedClaimIds = new Set(providerRuntime.sync.failedClaimIds);
  const syncRevision = revisionValid ? Number(providerRuntime.sync.revision) : null;
  const nextRevision = revisionValid ? String(syncRevision + 1) : null;
  const records = dispositionContract.records
    .filter((record) => !record.terminal || record.latestAction)
    .sort((a, b) => {
      const priority = Number(b.canAcceptDecision) - Number(a.canAcceptDecision);
      return priority || b.risk - a.risk || a.claimId.localeCompare(b.claimId);
    });
  const items = records.map((record, index) => {
    const latestAction = record.latestAction;
    const needsProof = record.proof.required && record.proof.missing;
    const terminalDecision = record.terminal && latestAction && ["approve", "reject", "escalate"].includes(latestAction.type);
    const operation = terminalDecision
      ? "write_terminal_decision"
      : needsProof
        ? "request_proof"
        : record.canAcceptDecision
          ? "open_decision_slot"
          : "mirror_blocked_claim";
    const requiredCapabilities = [
      "claim-sync",
      ...(needsProof ? ["proof-fetch"] : []),
      ...(terminalDecision || record.canAcceptDecision ? ["decision-write"] : []),
      ...(providerRuntime.mode !== "hosted" ? ["external-ticket"] : [])
    ];
    const syncBlockingCodes = operation === "open_decision_slot" || operation === "write_terminal_decision"
      ? record.blockerCodes
      : record.blockerCodes.filter((code) => [
          "tenant_boundary_invalid",
          "review_gate_disabled",
          "review_gate_paused",
          "settings_invalid"
        ].includes(code));
    const ackState = failedClaimIds.has(record.claimId)
      ? "failed"
      : acknowledgedClaimIds.has(record.claimId)
        ? "acknowledged"
        : "pending";
    const blockerCodes = [
      ...syncBlockingCodes,
      ...requiredCapabilities.filter((capability) => missingCapabilitySet.has(capability)).map((capability) => `capability_missing:${capability}`),
      ...(failedClaimIds.has(record.claimId) ? ["provider_ack_failed"] : [])
    ];
    return {
      contractType: "human-review.provider-sync-item",
      schemaVersion: 1,
      sequence: index + 1,
      claimId: record.claimId,
      operation,
      requiredCapabilities,
      ackState,
      dispatchable: blockerCodes.length === 0 && revisionValid && ackState === "pending",
      idempotencyKey: `${scope.isolationKey}:${providerRuntime.providerId}:${providerRuntime.sync.revision}:${record.claimId}:${latestAction?.actionId || record.status}`,
      externalRoute: externalHandoffPlan.required
        ? externalHandoffPlan.items.find((item) => item.claimId === record.claimId)?.route || `claims/${record.claimId}/review`
        : null,
      payload: {
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        status: record.status,
        reviewer: record.reviewer,
        route: record.route,
        owner: record.owner,
        risk: record.risk,
        proof: record.proof,
        latestAction: latestAction
          ? {
              actionId: latestAction.actionId,
              type: latestAction.type,
              actor: latestAction.actor,
              at: latestAction.at
            }
          : null
      },
      blockerCodes
    };
  });
  const dispatchableItems = items.filter((item) => item.dispatchable);
  const pendingAckItems = items.filter((item) => item.ackState === "pending");
  return {
    contractType: "human-review.provider-sync-batch",
    schemaVersion: 1,
    generatedAt: now,
    providerId: providerRuntime.providerId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    isolationKey: scope.isolationKey,
    mode: providerRuntime.mode,
    revision: providerRuntime.sync.revision,
    nextRevision,
    acknowledgedRevision: providerRuntime.sync.acknowledgedRevision,
    ackedAt: providerRuntime.sync.ackedAt,
    cursor: providerRuntime.sync.cursor,
    watermark: providerRuntime.sync.watermark,
    itemCount: items.length,
    dispatchableCount: dispatchableItems.length,
    pendingAckCount: pendingAckItems.length,
    failedAckCount: items.filter((item) => item.ackState === "failed").length,
    readyToDispatch: revisionValid && dispatchableItems.length > 0 && missingCapabilities.length === 0,
    nextDispatchClaimId: dispatchableItems[0]?.claimId || null,
    requiresExternalAck: providerRuntime.mode !== "hosted" && dispatchableItems.length > 0,
    items
  };
}

function buildProviderServiceContract({ providerRuntime, scope, counters, settings, lifecycle, acceptanceContract, readinessContract, dispositionContract, workflowHandoff, now }) {
  const requiredCapabilities = [
    "claim-sync",
    ...(settings.requireProof ? ["proof-fetch"] : []),
    ...(acceptanceContract.canAcceptDispositions ? ["decision-write"] : []),
    ...(readinessContract.readyForExport ? ["audit-export"] : []),
    ...(settings.autoAssignReviewer ? ["reviewer-assignment"] : []),
    ...(providerRuntime.mode !== "hosted" ? ["external-ticket"] : [])
  ];
  const capabilitySet = new Set(providerRuntime.capabilities);
  const missingCapabilities = [...new Set(requiredCapabilities)].filter((capability) => !capabilitySet.has(capability));
  const lastSyncedMs = parseTimestamp(providerRuntime.sync.lastSyncedAt);
  const nowMs = Date.parse(now);
  const syncAgeMinutes = lastSyncedMs === null ? null : Math.max(0, Math.round((nowMs - lastSyncedMs) / (60 * 1000)));
  const syncState = lastSyncedMs === null
    ? "unsynced"
    : syncAgeMinutes > settings.reviewSlaHours * 60
      ? "stale"
      : "current";
  const externalHandoffRequired = providerRuntime.mode !== "hosted";
  const externalHandoffReady = !externalHandoffRequired || (
    capabilitySet.has("external-ticket") &&
    Boolean(providerRuntime.handoff.externalSystem) &&
    Boolean(providerRuntime.handoff.externalCaseId || providerRuntime.handoff.callbackUrl)
  );
  const syncRevisionNumber = Number(providerRuntime.sync.revision);
  const revisionValid = Number.isFinite(syncRevisionNumber) && syncRevisionNumber >= 0;
  const externalHandoffPlan = buildExternalHandoffPlan({ providerRuntime, dispositionContract, workflowHandoff, now });
  const providerSyncBatch = buildProviderSyncBatch({
    providerRuntime,
    scope,
    dispositionContract,
    externalHandoffPlan,
    missingCapabilities,
    revisionValid,
    now
  });
  const findings = [];
  if (missingCapabilities.length > 0) {
    findings.push({
      severity: "error",
      code: "provider_capability_missing",
      message: "Provider did not declare every capability required for the current human review state.",
      missingCapabilities
    });
  }
  if (syncState === "unsynced" && counters.totalClaims > 0) {
    findings.push({
      severity: "warning",
      code: "provider_sync_missing",
      message: "Provider has claims in scope but did not report sync metadata."
    });
  }
  if (syncState === "stale") {
    findings.push({
      severity: "warning",
      code: "provider_sync_stale",
      message: "Provider sync metadata is older than the configured review SLA window.",
      syncAgeMinutes
    });
  }
  if (!externalHandoffReady) {
    findings.push({
      severity: "error",
      code: "external_handoff_incomplete",
      message: "External provider handoff requires external-ticket capability plus a case id or callback URL."
    });
  }
  if (!revisionValid) {
    findings.push({
      severity: "warning",
      code: "provider_sync_revision_invalid",
      message: "Provider sync revision should be a non-negative numeric token for deterministic replay."
    });
  }
  if (providerSyncBatch.failedAckCount > 0) {
    findings.push({
      severity: "warning",
      code: "provider_sync_ack_failed",
      message: "Provider reported failed acknowledgement for one or more human review claim sync items.",
      failedClaimIds: providerRuntime.sync.failedClaimIds
    });
  }
  if (providerSyncBatch.requiresExternalAck && providerSyncBatch.pendingAckCount > 0) {
    findings.push({
      severity: "info",
      code: "provider_sync_ack_pending",
      message: "External provider sync batch has items awaiting acknowledgement.",
      pendingAckCount: providerSyncBatch.pendingAckCount
    });
  }
  findings.push(...externalHandoffPlan.findings.map((finding) => ({ source: "external_handoff", ...finding })));
  return {
    contractType: "human-review.provider-service-contract",
    schemaVersion: 1,
    generatedAt: now,
    providerId: providerRuntime.providerId,
    serviceName: providerRuntime.serviceName,
    endpointRef: providerRuntime.endpointRef,
    mode: providerRuntime.mode,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    isolationKey: scope.isolationKey,
    declaredCapabilities: providerRuntime.capabilities,
    requiredCapabilities: [...new Set(requiredCapabilities)].sort(),
    missingCapabilities,
    negotiated: missingCapabilities.length === 0,
    sync: {
      ...providerRuntime.sync,
      state: syncState,
      ageMinutes: syncAgeMinutes,
      claimCount: counters.totalClaims,
      pendingReview: counters.pendingReview,
      decisionReadyClaimIds: dispositionContract.decisionReadyClaimIds,
      revisionValid,
      revisionNumber: revisionValid ? syncRevisionNumber : null,
      nextRevision: revisionValid ? String(syncRevisionNumber + 1) : null,
      acknowledgedRevision: providerRuntime.sync.acknowledgedRevision,
      acknowledgedClaimIds: providerRuntime.sync.acknowledgedClaimIds,
      failedClaimIds: providerRuntime.sync.failedClaimIds,
      ackedAt: providerRuntime.sync.ackedAt,
      checkpointKey: `${scope.isolationKey}:${providerRuntime.providerId}:${providerRuntime.sync.revision}`,
      cursorRequired: counters.totalClaims > 0,
      cursorPresent: Boolean(providerRuntime.sync.cursor),
      watermarkPresent: Boolean(providerRuntime.sync.watermark),
      batchReady: providerSyncBatch.readyToDispatch,
      batchItemCount: providerSyncBatch.itemCount,
      batchDispatchableCount: providerSyncBatch.dispatchableCount,
      pendingAckCount: providerSyncBatch.pendingAckCount,
      failedAckCount: providerSyncBatch.failedAckCount,
      nextDispatchClaimId: providerSyncBatch.nextDispatchClaimId
    },
    syncBatch: providerSyncBatch,
    externalHandoff: {
      required: externalHandoffRequired,
      ready: externalHandoffReady && externalHandoffPlan.ready,
      state: externalHandoffPlan.state,
      system: providerRuntime.handoff.externalSystem || null,
      caseId: providerRuntime.handoff.externalCaseId,
      callbackUrl: externalHandoffPlan.callbackUrl,
      ticketUrl: externalHandoffPlan.ticketUrl,
      lastHandoffAt: providerRuntime.handoff.lastHandoffAt,
      route: workflowHandoff.route,
      action: workflowHandoff.resolvedAction,
      selectedClaimId: workflowHandoff.claimId,
      plan: externalHandoffPlan
    },
    lifecycleBinding: {
      enabled: lifecycle.enabled,
      paused: lifecycle.paused,
      scheduledReviewAt: lifecycle.scheduledReviewAt
    },
    valid: findings.every((finding) => finding.severity !== "error"),
    findings
  };
}

function buildClientRuntimeValidation({ clientRuntime, claims, acceptanceContract }) {
  const claimIds = new Set(claims.map((claim) => claim.claimId));
  const selectedClaim = clientRuntime.selectedClaimId ? claims.find((claim) => claim.claimId === clientRuntime.selectedClaimId) : null;
  const findings = [];
  if (clientRuntime.selectedClaimId && !claimIds.has(clientRuntime.selectedClaimId)) {
    findings.push({
      severity: "error",
      code: "selected_claim_missing",
      message: "Requested client claim is not present in the human review payload.",
      claimId: clientRuntime.selectedClaimId
    });
  }
  if (clientRuntime.requestedAction === "export_report" && !acceptanceContract.canExport) {
    findings.push({
      severity: "error",
      code: "export_not_ready",
      message: "Client requested report export before human review acceptance is complete."
    });
  }
  if (clientRuntime.requestedAction === "request_proof" && !clientRuntime.supportsInlineProof) {
    findings.push({
      severity: "warning",
      code: "inline_proof_capability_missing",
      message: "Client requested proof collection without declaring inline-proof capability."
    });
  }
  if (selectedClaim && FINAL_REVIEW_STATES.has(selectedClaim.status) && clientRuntime.requestedAction === "open_claim") {
    findings.push({
      severity: "info",
      code: "selected_claim_closed",
      message: "Selected claim already has a final human review disposition.",
      claimId: selectedClaim.claimId
    });
  }
  return {
    contractType: "human-review.client-runtime-validation",
    schemaVersion: 1,
    valid: findings.every((finding) => finding.severity !== "error"),
    selectedClaim,
    findingCount: findings.length,
    findings
  };
}

function settingsValidation(settings, claims) {
  const openClaimCount = claims.filter((claim) => !FINAL_REVIEW_STATES.has(claim.status)).length;
  const errors = [];
  const warnings = [];
  if (settings.requireProof && claims.some((claim) => claim.proofCount === 0)) {
    errors.push({
      code: "proof_required",
      message: "Human review is configured to require proof before final disposition."
    });
  }
  if (openClaimCount > settings.maxOpenClaims) {
    warnings.push({
      code: "open_claim_limit_exceeded",
      message: `Open review queue has ${openClaimCount} claims, above configured maxOpenClaims ${settings.maxOpenClaims}.`
    });
  }
  if (settings.autoAssignReviewer && settings.reviewerPool.length === 0) {
    errors.push({
      code: "reviewer_pool_required",
      message: "autoAssignReviewer requires at least one reviewer in reviewerPool."
    });
  }
  if (settings.scheduledReviewAt && Number.isNaN(Date.parse(settings.scheduledReviewAt))) {
    errors.push({
      code: "invalid_schedule",
      message: "scheduledReviewAt must be an ISO-parseable timestamp."
    });
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    openClaimLimit: settings.maxOpenClaims,
    openClaimCount
  };
}

function commandRejection(command, lifecycle, { now, openClaimCount }) {
  if (command.type === "schedule_review" && !parseTimestamp(command.scheduledReviewAt)) {
    return {
      code: "invalid_command_schedule",
      message: "schedule_review commands require an ISO-parseable scheduledReviewAt timestamp."
    };
  }
  if (command.type === "schedule_review" && parseTimestamp(command.scheduledReviewAt) < Date.parse(now)) {
    return {
      code: "past_command_schedule",
      message: "schedule_review commands cannot move the next review window into the past."
    };
  }
  if (command.type === "resume" && !lifecycle.paused) {
    return {
      code: "resume_without_pause",
      message: "resume commands are ignored unless the human review gate is paused."
    };
  }
  if (command.type === "cancel_schedule" && !lifecycle.scheduledReviewAt) {
    return {
      code: "schedule_not_set",
      message: "cancel_schedule commands are ignored when no scheduled review exists."
    };
  }
  if (command.type === "disable" && openClaimCount > 0 && !command.reason) {
    return {
      code: "disable_reason_required",
      message: "disable commands require a reason while claims are still open."
    };
  }
  return null;
}

function applyLifecycleCommands(settings, commands, context = {}) {
  const now = context.now || new Date().toISOString();
  const openClaimCount = Number.isFinite(context.openClaimCount) ? context.openClaimCount : 0;
  const persistedState = context.persistedState && typeof context.persistedState === "object" ? context.persistedState : null;
  const recoveredLifecycle = persistedState?.usable && persistedState.lifecycle?.hasCheckpoint ? persistedState.lifecycle : null;
  const processedCommandIds = new Set(recoveredLifecycle?.processedCommandIds || []);
  const lifecycle = {
    enabled: recoveredLifecycle?.enabled === null || recoveredLifecycle?.enabled === undefined ? settings.enabled : recoveredLifecycle.enabled,
    paused: recoveredLifecycle?.paused === true,
    scheduledReviewAt: recoveredLifecycle?.scheduledReviewAt || settings.scheduledReviewAt,
    lastCommand: null,
    acceptedCommandCount: 0,
    rejectedCommandCount: 0,
    replayedCommandCount: 0,
    auditTrail: [],
    commandFindings: [],
    processedCommandIds: [...processedCommandIds].sort(),
    recoveredFromCheckpoint: Boolean(recoveredLifecycle),
    recoveryMode: persistedState?.recoveryMode || "cold_start"
  };
  for (const command of commands) {
    const before = {
      enabled: lifecycle.enabled,
      paused: lifecycle.paused,
      scheduledReviewAt: lifecycle.scheduledReviewAt
    };
    if (processedCommandIds.has(command.commandId)) {
      lifecycle.replayedCommandCount += 1;
      lifecycle.commandFindings.push({
        severity: "info",
        source: "lifecycle_command",
        commandId: command.commandId,
        type: command.type,
        code: "command_replayed",
        message: "Lifecycle command was already recorded in recovered state and was treated as an idempotent no-op."
      });
      lifecycle.auditTrail.push({
        commandId: command.commandId,
        type: command.type,
        actor: command.actor,
        at: command.at,
        reason: command.reason,
        status: "replayed",
        before,
        after: before
      });
      continue;
    }
    const rejection = commandRejection(command, lifecycle, { now, openClaimCount });
    processedCommandIds.add(command.commandId);
    if (rejection) {
      lifecycle.rejectedCommandCount += 1;
      lifecycle.commandFindings.push({
        severity: command.type === "schedule_review" || command.type === "disable" ? "error" : "info",
        source: "lifecycle_command",
        commandId: command.commandId,
        type: command.type,
        ...rejection
      });
      lifecycle.auditTrail.push({
        commandId: command.commandId,
        type: command.type,
        actor: command.actor,
        at: command.at,
        reason: command.reason,
        status: "rejected",
        rejectionCode: rejection.code,
        before,
        after: before
      });
      continue;
    }
    if (command.type === "enable") lifecycle.enabled = true;
    if (command.type === "disable") lifecycle.enabled = false;
    if (command.type === "pause") lifecycle.paused = true;
    if (command.type === "resume") lifecycle.paused = false;
    if (command.type === "schedule_review") lifecycle.scheduledReviewAt = command.scheduledReviewAt || lifecycle.scheduledReviewAt;
    if (command.type === "cancel_schedule") lifecycle.scheduledReviewAt = null;
    lifecycle.lastCommand = command;
    lifecycle.acceptedCommandCount += 1;
    lifecycle.auditTrail.push({
      commandId: command.commandId,
      type: command.type,
      actor: command.actor,
      at: command.at,
      reason: command.reason,
      status: "accepted",
      before,
      after: {
        enabled: lifecycle.enabled,
        paused: lifecycle.paused,
        scheduledReviewAt: lifecycle.scheduledReviewAt
      }
    });
  }
  lifecycle.processedCommandIds = [...processedCommandIds].sort();
  return lifecycle;
}

function buildLifecycleControls({ scope, settings, settingsStatus, lifecycle, commands, counters, now }) {
  const canWriteSettings = scope.permissions.includes("settings:write");
  const scheduleMs = parseTimestamp(lifecycle.scheduledReviewAt);
  const nowMs = Date.parse(now);
  const scheduledInHours = scheduleMs
    ? Math.max(0, Number(((scheduleMs - nowMs) / (60 * 60 * 1000)).toFixed(2)))
    : null;
  const scheduleState = !lifecycle.scheduledReviewAt
    ? "not_scheduled"
    : scheduleMs === null
      ? "invalid"
      : scheduleMs <= nowMs
        ? "due"
        : "scheduled";
  const writeReason = canWriteSettings ? [] : ["settings_write_permission_required"];
  const control = (command, enabled, reasons = []) => ({
    command,
    enabled: canWriteSettings && enabled,
    disabledReasons: [...writeReason, ...(enabled ? [] : reasons)],
    requiresReason: command === "disable" && counters.pendingReview > 0,
    auditRequired: ["disable", "pause", "resume", "schedule_review", "cancel_schedule"].includes(command)
  });
  const controls = [
    control("enable", !lifecycle.enabled, ["already_enabled"]),
    control("disable", lifecycle.enabled, ["already_disabled"]),
    control("pause", lifecycle.enabled && !lifecycle.paused, lifecycle.enabled ? ["already_paused"] : ["gate_disabled"]),
    control("resume", lifecycle.enabled && lifecycle.paused, lifecycle.enabled ? ["not_paused"] : ["gate_disabled"]),
    control("schedule_review", settingsStatus.valid, ["settings_invalid"]),
    control("cancel_schedule", Boolean(lifecycle.scheduledReviewAt), ["schedule_not_set"])
  ];
  const nextRunnableCommand = controls.find((item) => item.enabled)?.command || null;
  return {
    contractType: "human-review.lifecycle-controls",
    schemaVersion: 1,
    canWriteSettings,
    lifecycleMode: !lifecycle.enabled ? "disabled" : lifecycle.paused ? "paused" : "active",
    scheduleState,
    scheduledReviewAt: lifecycle.scheduledReviewAt,
    scheduledInHours,
    nextRunnableCommand,
    settingsBounds: {
      maxOpenClaims: settings.maxOpenClaims,
      reviewSlaHours: settings.reviewSlaHours,
      reviewerPoolSize: settings.reviewerPool.length
    },
    commandSummary: {
      received: commands.length,
      accepted: lifecycle.acceptedCommandCount,
      rejected: lifecycle.rejectedCommandCount,
      replayed: lifecycle.replayedCommandCount,
      recoveredFromCheckpoint: lifecycle.recoveredFromCheckpoint
    },
    controls,
    commandFindings: lifecycle.commandFindings
  };
}

function buildCounters(claims, actions) {
  const counters = { ...DEFAULT_COUNTERS, totalClaims: claims.length, reviewerActions: actions.length };
  for (const claim of claims) {
    if (claim.status === "approved") counters.approved += 1;
    else if (claim.status === "rejected") counters.rejected += 1;
    else if (claim.status === "escalated") counters.escalated += 1;
    else counters.pendingReview += 1;
    if (claim.missingProof) counters.blockedByMissingProof += 1;
  }
  return counters;
}

function buildHistorySnapshots(claims, priorSnapshots, now) {
  const previous = list(priorSnapshots)
    .filter((snapshot) => snapshot && typeof snapshot === "object")
    .slice(-4)
    .map((snapshot) => ({
      at: snapshot.at || snapshot.generatedAt || null,
      counters: snapshot.counters && typeof snapshot.counters === "object" ? snapshot.counters : {}
    }));
  return [
    ...previous,
    {
      at: now,
      counters: buildCounters(claims, [])
    }
  ];
}

function buildTimeline(claims, actions, now) {
  const submitted = claims.map((claim) => ({
    at: claim.submittedAt || now,
    type: "claim_submitted",
    claimId: claim.claimId,
    label: `${claim.route} submitted for human review`
  }));
  const reviewed = actions.map((action) => ({
    at: action.at || now,
    type: `review_${action.type}`,
    claimId: action.claimId,
    label: `${action.actor} recorded ${action.type}`
  }));
  return [...submitted, ...reviewed].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function buildNextActionState({ claims, counters, settings, settingsStatus, lifecycle, now }) {
  const proofBlockers = claims.filter((claim) => claim.missingProof).map((claim) => claim.claimId);
  const openClaims = claims.filter((claim) => !FINAL_REVIEW_STATES.has(claim.status));
  const rejectedCommandError = lifecycle.commandFindings.find((finding) => finding.severity === "error");
  const overdueClaims = openClaims
    .filter((claim) => claim.submittedAt && Date.parse(now) - Date.parse(claim.submittedAt) > settings.reviewSlaHours * 60 * 60 * 1000)
    .map((claim) => claim.claimId);
  const highestRiskOpenClaim = openClaims
    .slice()
    .sort((a, b) => b.risk - a.risk || a.claimId.localeCompare(b.claimId))[0];
  if (!lifecycle.enabled) {
    return { state: "disabled", action: "enable", claimId: null, reason: "Human review gate is disabled." };
  }
  if (lifecycle.paused) {
    return { state: "paused", action: "resume", claimId: null, reason: "Human review gate is paused." };
  }
  if (!settingsStatus.valid) {
    return { state: "settings_blocked", action: "fix_settings", claimId: null, reason: settingsStatus.errors[0]?.code || "invalid_settings" };
  }
  if (rejectedCommandError) {
    return {
      state: "lifecycle_command_blocked",
      action: "fix_settings",
      claimId: null,
      reason: rejectedCommandError.code
    };
  }
  if (proofBlockers.length > 0) {
    return { state: "proof_blocked", action: "request_proof", claimId: proofBlockers[0], reason: "Required proof is missing." };
  }
  if (overdueClaims.length > 0) {
    return { state: "sla_overdue", action: "escalate", claimId: overdueClaims[0], reason: "Review SLA has elapsed." };
  }
  if (highestRiskOpenClaim) {
    return { state: "ready_for_review", action: "review_claim", claimId: highestRiskOpenClaim.claimId, reason: "Open claim selected by risk priority." };
  }
  return {
    state: counters.totalClaims === 0 ? "idle" : "complete",
    action: lifecycle.scheduledReviewAt ? "wait_for_schedule" : "export",
    claimId: null,
    reason: lifecycle.scheduledReviewAt ? "Next scheduled review is pending." : "No open review work remains."
  };
}

function buildLifecycleProof({ settings, settingsStatus, lifecycle, lifecycleControls, nextAction }) {
  return {
    proofVersion: "human-review.lifecycle-proof.v1",
    enabled: lifecycle.enabled,
    paused: lifecycle.paused,
    scheduledReviewAt: lifecycle.scheduledReviewAt,
    scheduleState: lifecycleControls.scheduleState,
    settingsValid: settingsStatus.valid,
    requireProof: settings.requireProof,
    autoAssignReviewer: settings.autoAssignReviewer,
    reviewerPoolSize: settings.reviewerPool.length,
    nextAction: nextAction.action,
    nextActionState: nextAction.state,
    acceptedCommandCount: lifecycle.acceptedCommandCount,
    rejectedCommandCount: lifecycle.rejectedCommandCount,
    replayedCommandCount: lifecycle.replayedCommandCount,
    recoveredFromCheckpoint: lifecycle.recoveredFromCheckpoint,
    recoveryMode: lifecycle.recoveryMode,
    commandCount: lifecycle.auditTrail.length,
    commandFindings: lifecycle.commandFindings,
    auditTrail: lifecycle.auditTrail
  };
}

function buildRestartStatusContract({ persistedState, lifecycle, acceptanceContract, readinessContract, providerServiceContract, now }) {
  const recoveredSnapshot = persistedState.snapshot || normalizePersistedSnapshot({});
  const currentPendingClaimIds = acceptanceContract.pendingClaimIds.slice().sort();
  const currentDecisionReadyClaimIds = acceptanceContract.decisionReadyClaimIds.slice().sort();
  const currentBlockedClaimIds = acceptanceContract.dispositionBlockedClaimIds.slice().sort();
  const currentTerminalClaimIds = acceptanceContract.acceptedClaimIds.slice().sort();
  const currentQueueFingerprint = [
    stableListFingerprint(currentPendingClaimIds),
    stableListFingerprint(currentDecisionReadyClaimIds),
    stableListFingerprint(currentBlockedClaimIds),
    stableListFingerprint(currentTerminalClaimIds)
  ].join("::");
  const recoveredQueueChanged = persistedState.recovered && recoveredSnapshot.queueFingerprint &&
    recoveredSnapshot.queueFingerprint !== currentQueueFingerprint;
  const providerRevisionChanged = persistedState.recovered && recoveredSnapshot.providerSyncRevision &&
    recoveredSnapshot.providerSyncRevision !== providerServiceContract.sync.revision;
  const providerCheckpointChanged = persistedState.recovered && recoveredSnapshot.providerCheckpointKey &&
    recoveredSnapshot.providerCheckpointKey !== providerServiceContract.sync.checkpointKey;
  const staleCheckpoint = persistedState.checkpointAgeMinutes !== null &&
    persistedState.checkpointAgeMinutes > 24 * 60;
  const restartBlockers = [
    ...(!persistedState.usable && persistedState.recovered ? ["persisted_state_unusable"] : []),
    ...(persistedState.recoveryFindings.filter((finding) => finding.severity === "error").map((finding) => finding.code)),
    ...(providerCheckpointChanged ? ["provider_checkpoint_changed"] : [])
  ];
  const restartWarnings = [
    ...(staleCheckpoint ? ["checkpoint_older_than_24h"] : []),
    ...(recoveredQueueChanged ? ["queue_shape_changed_since_checkpoint"] : []),
    ...(providerRevisionChanged ? ["provider_revision_changed_since_checkpoint"] : []),
    ...(lifecycle.replayedCommandCount > 0 ? ["commands_replayed_idempotently"] : [])
  ];
  const replayState = !persistedState.recovered
    ? "cold_start"
    : restartBlockers.length > 0
      ? "blocked"
      : recoveredQueueChanged || providerRevisionChanged || staleCheckpoint
        ? "recovered_with_refresh"
        : lifecycle.replayedCommandCount > 0
          ? "idempotent_replay"
          : "clean_recovery";
  return {
    contractType: "human-review.restart-status",
    schemaVersion: 1,
    generatedAt: now,
    stateId: persistedState.stateId,
    recoveryMode: persistedState.recoveryMode,
    recoverySource: persistedState.recoverySource,
    replayState,
    restartSafe: restartBlockers.length === 0,
    refreshRequired: replayState === "recovered_with_refresh",
    checkpoint: {
      checkpointAt: persistedState.checkpointAt,
      checkpointAgeMinutes: persistedState.checkpointAgeMinutes,
      stale: staleCheckpoint,
      recoveredStatus: recoveredSnapshot.status,
      recoveredQueueFingerprint: recoveredSnapshot.queueFingerprint || null,
      currentQueueFingerprint
    },
    queues: {
      recoveredPendingClaimIds: recoveredSnapshot.pendingClaimIds,
      currentPendingClaimIds,
      recoveredDecisionReadyClaimIds: recoveredSnapshot.decisionReadyClaimIds,
      currentDecisionReadyClaimIds,
      recoveredBlockedClaimIds: recoveredSnapshot.blockedClaimIds,
      currentBlockedClaimIds,
      recoveredTerminalClaimIds: recoveredSnapshot.terminalClaimIds,
      currentTerminalClaimIds,
      changed: Boolean(recoveredQueueChanged)
    },
    provider: {
      recoveredProviderId: recoveredSnapshot.providerId,
      currentProviderId: providerServiceContract.providerId,
      recoveredSyncState: recoveredSnapshot.providerSyncState,
      currentSyncState: providerServiceContract.sync.state,
      recoveredRevision: recoveredSnapshot.providerSyncRevision,
      currentRevision: providerServiceContract.sync.revision,
      recoveredCheckpointKey: recoveredSnapshot.providerCheckpointKey,
      currentCheckpointKey: providerServiceContract.sync.checkpointKey,
      revisionChanged: Boolean(providerRevisionChanged),
      checkpointChanged: Boolean(providerCheckpointChanged)
    },
    idempotency: {
      processedCommandIds: lifecycle.processedCommandIds,
      replayedCommandIds: lifecycle.auditTrail.filter((entry) => entry.status === "replayed").map((entry) => entry.commandId),
      acceptedCommandIds: lifecycle.auditTrail.filter((entry) => entry.status === "accepted").map((entry) => entry.commandId),
      rejectedCommandIds: lifecycle.auditTrail.filter((entry) => entry.status === "rejected").map((entry) => entry.commandId)
    },
    blockers: [...new Set(restartBlockers)].sort(),
    warnings: [...new Set(restartWarnings)].sort()
  };
}

function buildPersistenceContract({ scope, persistedState, lifecycle, counters, acceptanceContract, readinessContract, providerServiceContract, operationalHealth, now }) {
  const replayedCommandIds = lifecycle.auditTrail
    .filter((entry) => entry.status === "replayed")
    .map((entry) => entry.commandId);
  const commandLedger = [
    ...persistedState.commandLedger,
    ...lifecycle.auditTrail
      .filter((entry) => entry.status !== "replayed")
      .map((entry) => ({
        commandId: entry.commandId,
        type: entry.type,
        status: entry.status,
        appliedAt: entry.at || now
      }))
  ];
  const status = !lifecycle.enabled
    ? "disabled"
    : lifecycle.paused
      ? "paused"
      : acceptanceContract.canExport
        ? "export_ready"
        : acceptanceContract.canAcceptDispositions
      ? "accepting_dispositions"
      : "blocked";
  const restartStatus = buildRestartStatusContract({
    persistedState,
    lifecycle,
    acceptanceContract,
    readinessContract,
    providerServiceContract,
    now
  });
  return {
    contractType: "human-review.persistence-contract",
    schemaVersion: 1,
    stateId: persistedState.stateId,
    generatedAt: now,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    isolationKey: scope.isolationKey,
    recoveryMode: persistedState.recoveryMode,
    recoverySource: persistedState.recoverySource,
    recovered: persistedState.recovered,
    usableRecoveredState: persistedState.usable,
    checkpointAgeMinutes: persistedState.checkpointAgeMinutes,
    status,
    restartSafe: restartStatus.restartSafe,
    restartStatus,
    idempotency: {
      processedCommandIds: lifecycle.processedCommandIds,
      replayedCommandIds,
      replayedCommandCount: lifecycle.replayedCommandCount
    },
    nextState: {
      stateId: persistedState.stateId,
      schemaVersion: 1,
      checkpointAt: now,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      isolationKey: scope.isolationKey,
      status,
      lifecycle: {
        enabled: lifecycle.enabled,
        paused: lifecycle.paused,
        scheduledReviewAt: lifecycle.scheduledReviewAt,
        lastCommandId: lifecycle.lastCommand?.commandId || persistedState.lifecycle.lastCommandId,
        processedCommandIds: lifecycle.processedCommandIds
      },
      commandLedger: commandLedger.slice(-100),
      counters,
      acceptance: {
        canAcceptDispositions: acceptanceContract.canAcceptDispositions,
        canExport: acceptanceContract.canExport,
        blockers: acceptanceContract.blockers,
        pendingClaimIds: acceptanceContract.pendingClaimIds,
        decisionReadyClaimIds: acceptanceContract.decisionReadyClaimIds,
        acceptedClaimIds: acceptanceContract.acceptedClaimIds
      },
      readiness: {
        ready: readinessContract.ready,
        readyForExport: readinessContract.readyForExport
      },
      queues: {
        pendingClaimIds: acceptanceContract.pendingClaimIds,
        decisionReadyClaimIds: acceptanceContract.decisionReadyClaimIds,
        blockedClaimIds: acceptanceContract.dispositionBlockedClaimIds,
        terminalClaimIds: acceptanceContract.acceptedClaimIds,
        queueFingerprint: restartStatus.checkpoint.currentQueueFingerprint
      },
      provider: {
        providerId: providerServiceContract.providerId,
        syncState: providerServiceContract.sync.state,
        syncCursor: providerServiceContract.sync.cursor,
        syncRevision: providerServiceContract.sync.revision,
        nextRevision: providerServiceContract.sync.nextRevision,
        acknowledgedRevision: providerServiceContract.sync.acknowledgedRevision,
        acknowledgedClaimIds: providerServiceContract.sync.acknowledgedClaimIds,
        failedClaimIds: providerServiceContract.sync.failedClaimIds,
        checkpointKey: providerServiceContract.sync.checkpointKey,
        negotiated: providerServiceContract.negotiated,
        syncBatch: {
          revision: providerServiceContract.syncBatch.revision,
          nextRevision: providerServiceContract.syncBatch.nextRevision,
          itemCount: providerServiceContract.syncBatch.itemCount,
          dispatchableCount: providerServiceContract.syncBatch.dispatchableCount,
          pendingAckCount: providerServiceContract.syncBatch.pendingAckCount,
          failedAckCount: providerServiceContract.syncBatch.failedAckCount,
          readyToDispatch: providerServiceContract.syncBatch.readyToDispatch,
          nextDispatchClaimId: providerServiceContract.syncBatch.nextDispatchClaimId,
          requiresExternalAck: providerServiceContract.syncBatch.requiresExternalAck
        },
        externalHandoff: {
          state: providerServiceContract.externalHandoff.state,
          ready: providerServiceContract.externalHandoff.ready,
          system: providerServiceContract.externalHandoff.system,
          caseId: providerServiceContract.externalHandoff.caseId,
          targetClaimIds: providerServiceContract.externalHandoff.plan.targetClaimIds,
          pendingOperationCount: providerServiceContract.externalHandoff.plan.pendingOperationCount,
          nextOperation: providerServiceContract.externalHandoff.plan.nextOperation,
          lastHandoffAt: providerServiceContract.externalHandoff.lastHandoffAt
        }
      },
      operationalHealth: {
        status: operationalHealth.status,
        mode: operationalHealth.mode,
        healthy: operationalHealth.healthy,
        degraded: operationalHealth.degraded,
        failed: operationalHealth.failed,
        probeId: operationalHealth.probeId,
        lastProbeAt: operationalHealth.probe.lastProbeAt,
        consecutiveFailures: operationalHealth.probe.consecutiveFailures,
        lastErrorCode: operationalHealth.probe.lastErrorCode,
        validationValid: operationalHealth.validation.valid,
        validationErrorCount: operationalHealth.validation.errorCount,
        retryPlan: {
          canRetry: operationalHealth.retryPlan.canRetry,
          retryExhausted: operationalHealth.retryPlan.retryExhausted,
          attempts: operationalHealth.retryPlan.attempts,
          maxAttempts: operationalHealth.retryPlan.maxAttempts,
          nextRetryAt: operationalHealth.retryPlan.nextRetryAt,
          retryableIssueCodes: operationalHealth.retryPlan.retryableIssueCodes
        },
        failureState: {
          state: operationalHealth.failureState.state,
          reasonCode: operationalHealth.failureState.reasonCode,
          recoveryAction: operationalHealth.failureState.recoveryAction,
          operatorRoute: operationalHealth.failureState.operatorRoute,
          readOnlyQueueAllowed: operationalHealth.failureState.readOnlyQueueAllowed,
          queueState: operationalHealth.failureState.queueState,
          queueAction: operationalHealth.failureState.queueAction,
          queueClaimId: operationalHealth.failureState.queueClaimId
        },
        queueFailure: {
          state: operationalHealth.queueFailure.state,
          stalled: operationalHealth.queueFailure.stalled,
          pendingClaimCount: operationalHealth.queueFailure.pendingClaimCount,
          oldestOpenAgeHours: operationalHealth.queueFailure.oldestOpenAgeHours,
          overdueClaimIds: operationalHealth.queueFailure.overdueClaimIds,
          stalledProofClaimIds: operationalHealth.queueFailure.stalledProofClaimIds,
          providerBlockedClaimIds: operationalHealth.queueFailure.providerBlockedClaimIds,
          failedAckClaimIds: operationalHealth.queueFailure.failedAckClaimIds,
          nextOperatorAction: operationalHealth.queueFailure.nextOperatorAction,
          nextOperatorClaimId: operationalHealth.queueFailure.nextOperatorClaimId,
          incidentCodes: operationalHealth.queueFailure.incidents.map((incident) => incident.code)
        },
        actionableErrorCount: operationalHealth.actionableErrors.length
      }
    },
    recoveryFindings: persistedState.recoveryFindings
  };
}

function buildExportSummary(claims, actions, counters, now, scope, dispositionContract, boundaryContract) {
  const completeClaims = counters.approved + counters.rejected + counters.escalated;
  return {
    exportVersion: "human-review.analytics.v1",
    generatedAt: now,
    surfaceId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    isolationKey: scope.isolationKey,
    totals: counters,
    completionRate: counters.totalClaims === 0 ? 0 : Number((completeClaims / counters.totalClaims).toFixed(4)),
    dispositionProof: {
      contractType: dispositionContract.contractType,
      schemaVersion: dispositionContract.schemaVersion,
      decisionReadyClaimIds: dispositionContract.decisionReadyClaimIds,
      blockedClaimIds: dispositionContract.blockedClaimIds,
      terminalClaimIds: dispositionContract.terminalClaimIds,
      missingProofClaimIds: dispositionContract.missingProofClaimIds
    },
    boundaryProof: {
      contractType: boundaryContract.contractType,
      schemaVersion: boundaryContract.schemaVersion,
      isolationKey: boundaryContract.isolationKey,
      tenantBoundaryValid: boundaryContract.valid,
      allowedTenantIds: boundaryContract.allowedTenantIds,
      allowedWorkspaceIds: boundaryContract.allowedWorkspaceIds,
      scopedClaimIds: boundaryContract.scopedClaimIds,
      outOfScopeClaimIds: boundaryContract.outOfScopeClaimIds,
      visibleCrossWorkspaceClaimIds: boundaryContract.visibleCrossWorkspaceClaimIds,
      quarantinedClaimIds: boundaryContract.quarantinedClaimIds,
      outOfScopeActionIds: boundaryContract.outOfScopeActionIds,
      quarantinedActionIds: boundaryContract.quarantinedActionIds,
      deniedActionIds: boundaryContract.permissionDenials.map((denial) => denial.actionId),
      requestedPermission: boundaryContract.requestedPermission,
      selectedClaimBoundary: boundaryContract.selectedClaimBoundary,
      auditHandoff: boundaryContract.auditHandoff
    },
    claims: claims.map((claim) => ({
      claimId: claim.claimId,
      tenantId: claim.tenantId,
      workspaceId: claim.workspaceId,
      route: claim.route,
      owner: claim.owner,
      status: claim.status,
      reviewer: claim.reviewer,
      proofCount: claim.proofCount,
      missingProof: claim.missingProof,
      canAcceptDecision: dispositionContract.records.find((record) => record.claimId === claim.claimId)?.canAcceptDecision === true,
      risk: claim.risk
    })),
    actions: actions.map(({ actionId, claimId, type, actor, tenantId, workspaceId, at }) => ({
      actionId,
      claimId,
      type,
      actor,
      tenantId,
      workspaceId,
      at
    }))
  };
}

function buildValidationSummary({ claims, actions, settingsStatus, lifecycle, persistedState }) {
  const claimIds = new Set(claims.map((claim) => claim.claimId));
  const orphanActions = actions.filter((action) => action.claimId && !claimIds.has(action.claimId));
  const unassignedOpenClaims = claims.filter((claim) => !FINAL_REVIEW_STATES.has(claim.status) && !claim.reviewer);
  const missingRouteClaims = claims.filter((claim) => claim.route === "unrouted");
  const findings = [
    ...settingsStatus.errors.map((error) => ({ severity: "error", source: "settings", ...error })),
    ...settingsStatus.warnings.map((warning) => ({ severity: "warning", source: "settings", ...warning })),
    ...list(persistedState?.recoveryFindings).map((finding) => ({ source: "persistence", ...finding })),
    ...lifecycle.commandFindings
  ];
  if (!lifecycle.enabled) {
    findings.push({
      severity: "error",
      source: "lifecycle",
      code: "review_gate_disabled",
      message: "Human review acceptance is unavailable while the gate is disabled."
    });
  }
  if (lifecycle.paused) {
    findings.push({
      severity: "warning",
      source: "lifecycle",
      code: "review_gate_paused",
      message: "Human review queue is paused and cannot accept new dispositions."
    });
  }
  if (orphanActions.length > 0) {
    findings.push({
      severity: "warning",
      source: "actions",
      code: "orphan_review_actions",
      message: `${orphanActions.length} review action(s) reference claims not present in this payload.`,
      actionIds: orphanActions.map((action) => action.actionId)
    });
  }
  if (unassignedOpenClaims.length > 0) {
    findings.push({
      severity: "info",
      source: "claims",
      code: "open_claims_unassigned",
      message: `${unassignedOpenClaims.length} open claim(s) do not have a reviewer assigned.`,
      claimIds: unassignedOpenClaims.map((claim) => claim.claimId)
    });
  }
  if (missingRouteClaims.length > 0) {
    findings.push({
      severity: "info",
      source: "claims",
      code: "claim_route_missing",
      message: `${missingRouteClaims.length} claim(s) are missing route metadata.`,
      claimIds: missingRouteClaims.map((claim) => claim.claimId)
    });
  }
  return {
    contractType: "human-review.validation-summary",
    schemaVersion: 1,
    valid: findings.every((finding) => finding.severity !== "error"),
    errorCount: findings.filter((finding) => finding.severity === "error").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
    infoCount: findings.filter((finding) => finding.severity === "info").length,
    findings
  };
}

function permissionForAction(action) {
  if (action.type === "approve" || action.type === "reject" || action.type === "escalate") return "review:decide";
  if (action.type === "request_changes") return "proof:request";
  return "review:read";
}

function buildBoundaryContract({ scope, claims, actions, clientRuntime }) {
  const allowedTenantIds = new Set(scope.allowedTenantIds || [scope.tenantId]);
  const allowedWorkspaceIds = new Set(scope.allowedWorkspaceIds || [scope.workspaceId]);
  const inScopeClaims = claims.filter((claim) => claim.tenantId === scope.tenantId && claim.workspaceId === scope.workspaceId);
  const outOfScopeClaims = claims.filter((claim) => claim.tenantId !== scope.tenantId || claim.workspaceId !== scope.workspaceId);
  const claimScopeById = new Map(claims.map((claim) => [claim.claimId, claim]));
  const quarantinedClaimIds = outOfScopeClaims
    .filter((claim) => !allowedTenantIds.has(claim.tenantId) || !allowedWorkspaceIds.has(claim.workspaceId))
    .map((claim) => claim.claimId);
  const visibleCrossWorkspaceClaimIds = outOfScopeClaims
    .filter((claim) => allowedTenantIds.has(claim.tenantId) && allowedWorkspaceIds.has(claim.workspaceId))
    .map((claim) => claim.claimId);
  const outOfScopeActions = actions.filter((action) => {
    const claim = action.claimId ? claimScopeById.get(action.claimId) : null;
    const actionTenantMismatch = action.tenantId && action.tenantId !== scope.tenantId;
    const actionWorkspaceMismatch = action.workspaceId && action.workspaceId !== scope.workspaceId;
    const claimScopeMismatch = claim && (claim.tenantId !== scope.tenantId || claim.workspaceId !== scope.workspaceId);
    return actionTenantMismatch || actionWorkspaceMismatch || claimScopeMismatch;
  });
  const quarantinedActionIds = outOfScopeActions
    .filter((action) => {
      const claim = action.claimId ? claimScopeById.get(action.claimId) : null;
      const tenantId = action.tenantId || claim?.tenantId;
      const workspaceId = action.workspaceId || claim?.workspaceId;
      return (tenantId && !allowedTenantIds.has(tenantId)) || (workspaceId && !allowedWorkspaceIds.has(workspaceId));
    })
    .map((action) => action.actionId);
  const missingPermissionActions = actions
    .map((action) => ({ action, requiredPermission: permissionForAction(action) }))
    .filter(({ requiredPermission }) => !scope.permissions.includes(requiredPermission));
  const permissionDenials = missingPermissionActions.map(({ action, requiredPermission }) => ({
    actionId: action.actionId,
    claimId: action.claimId,
    type: action.type,
    actor: action.actor,
    requiredPermission,
    granted: false,
    denialCode: `permission_required:${requiredPermission}`
  }));
  const requestedPermission = clientRuntime.requestedAction === "export_report"
    ? "audit:export"
    : clientRuntime.requestedAction === "open_settings"
      ? "settings:write"
      : clientRuntime.requestedAction === "request_proof"
        ? "proof:request"
        : "review:read";
  const canUseRequestedAction = scope.permissions.includes(requestedPermission);
  const selectedClaim = clientRuntime.selectedClaimId ? claimScopeById.get(clientRuntime.selectedClaimId) || null : null;
  const selectedClaimBoundary = !selectedClaim
    ? "not_selected"
    : selectedClaim.tenantId === scope.tenantId && selectedClaim.workspaceId === scope.workspaceId
      ? "active_scope"
      : allowedTenantIds.has(selectedClaim.tenantId) && allowedWorkspaceIds.has(selectedClaim.workspaceId)
        ? "visible_cross_workspace"
        : "quarantined";
  const findings = [];
  if (scope.unknownRoles.length > 0) {
    findings.push({
      severity: "warning",
      code: "unknown_review_roles_ignored",
      message: "One or more review roles were not recognized and did not grant permissions.",
      roles: scope.unknownRoles
    });
  }
  if (outOfScopeClaims.length > 0) {
    findings.push({
      severity: "error",
      code: "claim_scope_violation",
      message: "Human review payload contains claims outside the active tenant/workspace scope.",
      claimIds: outOfScopeClaims.map((claim) => claim.claimId)
    });
  }
  if (quarantinedClaimIds.length > 0) {
    findings.push({
      severity: "error",
      code: "claim_quarantined_by_scope_acl",
      message: "Human review payload contains claims outside the actor's declared tenant/workspace access boundary.",
      claimIds: quarantinedClaimIds
    });
  }
  if (outOfScopeActions.length > 0) {
    findings.push({
      severity: "error",
      code: "action_scope_violation",
      message: "Review actions reference claims or actor scopes outside the active tenant/workspace.",
      actionIds: outOfScopeActions.map((action) => action.actionId)
    });
  }
  if (quarantinedActionIds.length > 0) {
    findings.push({
      severity: "error",
      code: "action_quarantined_by_scope_acl",
      message: "Review actions were quarantined because their actor or claim scope is outside the declared access boundary.",
      actionIds: quarantinedActionIds
    });
  }
  if (missingPermissionActions.length > 0) {
    findings.push({
      severity: "error",
      code: "review_permission_missing",
      message: "One or more review actions require permissions not granted to the active actor.",
      requiredPermissions: [...new Set(missingPermissionActions.map(({ requiredPermission }) => requiredPermission))].sort(),
      actionIds: missingPermissionActions.map(({ action }) => action.actionId)
    });
  }
  if (!canUseRequestedAction) {
    findings.push({
      severity: "warning",
      code: "requested_action_permission_missing",
      message: "Requested handoff action is not permitted for the active actor.",
      requestedAction: clientRuntime.requestedAction,
      requiredPermission: requestedPermission
    });
  }
  if (selectedClaimBoundary === "visible_cross_workspace" || selectedClaimBoundary === "quarantined") {
    findings.push({
      severity: selectedClaimBoundary === "quarantined" ? "error" : "warning",
      code: selectedClaimBoundary === "quarantined" ? "selected_claim_quarantined" : "selected_claim_cross_workspace",
      message: selectedClaimBoundary === "quarantined"
        ? "Selected claim is outside the actor's declared access boundary."
        : "Selected claim is visible to the actor but outside the active tenant/workspace and will not be opened in this review queue.",
      claimId: clientRuntime.selectedClaimId
    });
  }
  return {
    contractType: "human-review.boundary",
    schemaVersion: 1,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    isolationKey: scope.isolationKey,
    allowedTenantIds: [...allowedTenantIds].sort(),
    allowedWorkspaceIds: [...allowedWorkspaceIds].sort(),
    allowedPermissionCount: scope.permissions.length,
    roleGrantSummary: scope.permissionGrantSummary,
    scopedClaimIds: inScopeClaims.map((claim) => claim.claimId),
    outOfScopeClaimIds: outOfScopeClaims.map((claim) => claim.claimId),
    visibleCrossWorkspaceClaimIds,
    quarantinedClaimIds,
    outOfScopeActionIds: outOfScopeActions.map((action) => action.actionId),
    quarantinedActionIds,
    permissionDenials,
    requestedPermission,
    canUseRequestedAction,
    selectedClaimBoundary,
    quarantine: {
      enforced: true,
      mode: "drop_from_active_queue",
      claimIds: quarantinedClaimIds,
      actionIds: quarantinedActionIds,
      crossWorkspaceVisibleClaimIds: visibleCrossWorkspaceClaimIds
    },
    auditHandoff: {
      target: "hosted-kernel-human-review",
      reasonCode: findings.find((finding) => finding.severity === "error")?.code || null,
      deniedActionIds: permissionDenials.map((denial) => denial.actionId),
      quarantinedRecordCount: quarantinedClaimIds.length + quarantinedActionIds.length,
      activeRecordCount: inScopeClaims.length
    },
    valid: findings.every((finding) => finding.severity !== "error"),
    findings
  };
}

function buildReviewPreview({ claims, actions, settings, lifecycle, nextActionState, now }) {
  const actionByClaimId = new Map();
  for (const action of actions) {
    if (action.claimId) actionByClaimId.set(action.claimId, action);
  }
  const cards = claims
    .map((claim) => {
      const latestAction = actionByClaimId.get(claim.claimId) || null;
      const terminal = FINAL_REVIEW_STATES.has(claim.status);
      const submittedAtMs = claim.submittedAt ? Date.parse(claim.submittedAt) : NaN;
      const ageHours = Number.isFinite(submittedAtMs)
        ? Math.max(0, Math.round((Date.parse(now) - submittedAtMs) / (60 * 60 * 1000)))
        : null;
      const blockedReasons = [
        ...(!lifecycle.enabled ? ["review_gate_disabled"] : []),
        ...(lifecycle.paused ? ["review_gate_paused"] : []),
        ...(settings.requireProof && claim.proofCount === 0 ? ["missing_required_proof"] : [])
      ];
      return {
        contractType: "human-review.preview-card",
        schemaVersion: 1,
        claimId: claim.claimId,
        title: `${claim.route} / ${claim.owner}`,
        status: claim.status,
        reviewer: claim.reviewer,
        risk: claim.risk,
        proofCount: claim.proofCount,
        ageHours,
        priority: terminal ? "closed" : claim.risk >= 80 ? "critical" : claim.risk >= 50 ? "high" : "standard",
        userVisibleState: terminal ? "Closed" : blockedReasons.length > 0 ? "Blocked" : "Ready for review",
        blockedReasons,
        latestAction,
        isNextRecommended: nextActionState.claimId === claim.claimId
      };
    })
    .sort((a, b) => Number(b.isNextRecommended) - Number(a.isNextRecommended) || b.risk - a.risk || a.claimId.localeCompare(b.claimId));
  return {
    contractType: "human-review.preview",
    schemaVersion: 1,
    generatedAt: now,
    empty: cards.length === 0,
    headline: cards.length === 0 ? "No claims waiting for human review" : `${cards.length} claim(s) available for human review`,
    cards
  };
}

function buildDispositionContract({ scope, claims, actions, settings, settingsStatus, lifecycle, boundaryContract, now }) {
  const actionsByClaimId = new Map();
  for (const action of actions) {
    if (!action.claimId) continue;
    const bucket = actionsByClaimId.get(action.claimId) || [];
    bucket.push(action);
    actionsByClaimId.set(action.claimId, bucket);
  }
  const canDecide = scope.permissions.includes("review:decide");
  const canRequestProof = scope.permissions.includes("proof:request");
  const records = claims.map((claim) => {
    const claimActions = (actionsByClaimId.get(claim.claimId) || [])
      .slice()
      .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
    const latestAction = claimActions.at(-1) || null;
    const terminal = FINAL_REVIEW_STATES.has(claim.status);
    const submittedAtMs = claim.submittedAt ? Date.parse(claim.submittedAt) : NaN;
    const ageHours = Number.isFinite(submittedAtMs)
      ? Math.max(0, Number(((Date.parse(now) - submittedAtMs) / (60 * 60 * 1000)).toFixed(2)))
      : null;
    const blockerCodes = [
      ...(!boundaryContract.valid ? ["tenant_boundary_invalid"] : []),
      ...(!lifecycle.enabled ? ["review_gate_disabled"] : []),
      ...(lifecycle.paused ? ["review_gate_paused"] : []),
      ...(!settingsStatus.valid ? ["settings_invalid"] : []),
      ...(settings.requireProof && claim.proofCount === 0 ? ["missing_required_proof"] : []),
      ...(!canDecide ? ["review_decision_permission_missing"] : []),
      ...(terminal ? ["claim_already_final"] : [])
    ];
    const canAcceptDecision = blockerCodes.length === 0;
    const allowedActions = [
      ...(canAcceptDecision ? ["approve", "reject", "escalate"] : []),
      ...(!terminal && claim.missingProof && canRequestProof && lifecycle.enabled && !lifecycle.paused ? ["request_changes"] : []),
      "comment"
    ];
    return {
      contractType: "human-review.disposition-record",
      schemaVersion: 1,
      claimId: claim.claimId,
      tenantId: claim.tenantId,
      workspaceId: claim.workspaceId,
      status: claim.status,
      terminal,
      reviewer: claim.reviewer,
      route: claim.route,
      owner: claim.owner,
      ageHours,
      risk: claim.risk,
      proof: {
        required: settings.requireProof,
        count: claim.proofCount,
        missing: claim.missingProof,
        satisfiable: !settings.requireProof || claim.proofCount > 0
      },
      latestAction,
      actionCount: claimActions.length,
      allowedActions,
      canAcceptDecision,
      blockerCodes,
      auditProof: {
        actorPermissionCount: scope.permissions.length,
        lifecycleEnabled: lifecycle.enabled,
        lifecyclePaused: lifecycle.paused,
        settingsValid: settingsStatus.valid,
        tenantBoundaryValid: boundaryContract.valid,
        evaluatedAt: now
      }
    };
  });
  const blockedRecords = records.filter((record) => !record.canAcceptDecision && !record.terminal);
  const decisionReadyRecords = records.filter((record) => record.canAcceptDecision);
  return {
    contractType: "human-review.disposition-contract",
    schemaVersion: 1,
    generatedAt: now,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    isolationKey: scope.isolationKey,
    canAcceptAnyDecision: decisionReadyRecords.length > 0,
    decisionReadyClaimIds: decisionReadyRecords.map((record) => record.claimId),
    blockedClaimIds: blockedRecords.map((record) => record.claimId),
    terminalClaimIds: records.filter((record) => record.terminal).map((record) => record.claimId),
    missingProofClaimIds: records.filter((record) => record.proof.missing).map((record) => record.claimId),
    records
  };
}

function buildAcceptanceContract({ claims, counters, settingsStatus, lifecycle, validationSummary, boundaryContract, nextActionState, dispositionContract }) {
  const proofBlockers = claims.filter((claim) => claim.missingProof).map((claim) => claim.claimId);
  const openClaims = claims.filter((claim) => !FINAL_REVIEW_STATES.has(claim.status));
  const acceptedClaimIds = claims.filter((claim) => FINAL_REVIEW_STATES.has(claim.status)).map((claim) => claim.claimId);
  const lifecycleCommandBlockers = lifecycle.commandFindings
    .filter((finding) => finding.severity === "error")
    .map((finding) => finding.code);
  const blockers = [
    ...(!lifecycle.enabled ? ["review_gate_disabled"] : []),
    ...(lifecycle.paused ? ["review_gate_paused"] : []),
    ...(!settingsStatus.valid ? settingsStatus.errors.map((error) => error.code) : []),
    ...lifecycleCommandBlockers,
    ...(!boundaryContract.valid ? boundaryContract.findings.filter((finding) => finding.severity === "error").map((finding) => finding.code) : []),
    ...(proofBlockers.length > 0 ? ["missing_required_proof"] : [])
  ];
  return {
    contractType: "human-review.acceptance",
    schemaVersion: 1,
    canAcceptDispositions: blockers.length === 0,
    canExport: blockers.length === 0 && counters.pendingReview === 0,
    acceptedClaimIds,
    pendingClaimIds: openClaims.map((claim) => claim.claimId),
    decisionReadyClaimIds: dispositionContract.decisionReadyClaimIds,
    dispositionBlockedClaimIds: dispositionContract.blockedClaimIds,
    proofBlockerClaimIds: proofBlockers,
    scopedClaimIds: boundaryContract.scopedClaimIds,
    outOfScopeClaimIds: boundaryContract.outOfScopeClaimIds,
    blockers,
    recommendedAction: nextActionState.action,
    validationFindingCount: validationSummary.findings.length + boundaryContract.findings.length
  };
}

function buildReadinessContract({ counters, lifecycle, settingsStatus, acceptanceContract, dispositionContract }) {
  const checks = [
    { key: "lifecycle_enabled", ready: lifecycle.enabled, label: "Human review gate enabled" },
    { key: "lifecycle_not_paused", ready: !lifecycle.paused, label: "Human review gate accepting work" },
    { key: "settings_valid", ready: settingsStatus.valid, label: "Human review settings valid" },
    { key: "proof_complete", ready: counters.blockedByMissingProof === 0, label: "Required proof present" },
    { key: "dispositions_ready", ready: counters.pendingReview === 0 || dispositionContract.canAcceptAnyDecision, label: "At least one open claim can receive a disposition" },
    { key: "queue_closed", ready: counters.pendingReview === 0, label: "No claims pending review" },
    { key: "acceptance_available", ready: acceptanceContract.canAcceptDispositions, label: "Disposition acceptance available" }
  ];
  return {
    contractType: "human-review.readiness",
    schemaVersion: 1,
    ready: checks.every((check) => check.ready),
    readyForExport: acceptanceContract.canExport,
    readyCheckCount: checks.filter((check) => check.ready).length,
    totalCheckCount: checks.length,
    checks
  };
}

function buildExplainableNextStep({ nextActionState, validationSummary, boundaryContract, acceptanceContract }) {
  const blockingFinding = [
    ...boundaryContract.findings,
    ...validationSummary.findings
  ].find((finding) => finding.severity === "error");
  return {
    contractType: "human-review.next-step",
    schemaVersion: 1,
    state: nextActionState.state,
    action: nextActionState.action,
    claimId: nextActionState.claimId,
    explanation: blockingFinding?.message || nextActionState.reason,
    blockerCodes: acceptanceContract.blockers,
    clientRouteHint: nextActionState.claimId ? `claims/${nextActionState.claimId}/review` : "review-queue",
    requiresHumanInput: ["review_claim", "request_proof", "fix_settings", "escalate", "resume", "enable"].includes(nextActionState.action)
  };
}

function resolveHandoffOperation({ action, selectedDisposition, acceptanceContract, readinessContract, providerServiceContract, operationalHealth }) {
  if (operationalHealth.mode === "blocked") return "inspect_human_review";
  if (action === "open_settings") return "open_settings";
  if (action === "export_report") return readinessContract.readyForExport ? "download_audit_report" : "prepare_audit_report";
  if (action === "request_proof") return "collect_required_proof";
  if (selectedDisposition?.canAcceptDecision) return "record_human_disposition";
  if (acceptanceContract.proofBlockerClaimIds.includes(selectedDisposition?.claimId)) return "collect_required_proof";
  if (providerServiceContract.sync.nextDispatchClaimId === selectedDisposition?.claimId) return "sync_claim_with_provider";
  return selectedDisposition ? "inspect_claim_blockers" : "open_review_queue";
}

function buildClientHandoffCommandEnvelope({
  scope,
  clientRuntime,
  workflowHandoff,
  acceptanceContract,
  readinessContract,
  dispositionContract,
  providerServiceContract,
  operationalHealth,
  explainableNextStep,
  now
}) {
  const selectedClaimId = workflowHandoff.claimId || explainableNextStep.claimId;
  const selectedDisposition = selectedClaimId
    ? dispositionContract.records.find((record) => record.claimId === selectedClaimId) || null
    : null;
  const providerSyncItem = selectedClaimId
    ? providerServiceContract.syncBatch.items.find((item) => item.claimId === selectedClaimId) || null
    : null;
  const handoffPlanItem = selectedClaimId
    ? providerServiceContract.externalHandoff.plan.items.find((item) => item.claimId === selectedClaimId) || null
    : null;
  const operation = resolveHandoffOperation({
    action: workflowHandoff.resolvedAction,
    selectedDisposition,
    acceptanceContract,
    readinessContract,
    providerServiceContract,
    operationalHealth
  });
  const blockerCodes = [
    ...acceptanceContract.blockers,
    ...(selectedDisposition?.blockerCodes || []),
    ...(providerSyncItem?.blockerCodes || []),
    ...(!providerServiceContract.negotiated ? ["provider_contract_not_negotiated"] : []),
    ...(operationalHealth.failed ? ["operational_health_failing"] : [])
  ];
  const uniqueBlockerCodes = [...new Set(blockerCodes)].sort();
  const commandEnabled = uniqueBlockerCodes.length === 0 ||
    ["open_review_queue", "inspect_claim_blockers", "collect_required_proof", "open_settings", "inspect_human_review"].includes(operation);
  const commandIdParts = [
    scope.isolationKey,
    clientRuntime.sessionId,
    workflowHandoff.resolvedAction,
    selectedClaimId || "queue",
    providerServiceContract.sync.revision,
    operation
  ];
  const command = {
    contractType: "human-review.client-handoff-command",
    schemaVersion: 1,
    commandId: commandIdParts.join(":"),
    generatedAt: now,
    sessionId: clientRuntime.sessionId,
    actor: clientRuntime.actor,
    operation,
    enabled: commandEnabled,
    route: workflowHandoff.route,
    returnTo: workflowHandoff.returnTo,
    claimId: selectedClaimId || null,
    blocked: !commandEnabled,
    blockerCodes: uniqueBlockerCodes,
    idempotencyKey: `${scope.isolationKey}:${selectedClaimId || "queue"}:${workflowHandoff.resolvedAction}:${providerServiceContract.sync.revision}`,
    payload: {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      selectedClaimId: selectedClaimId || null,
      requestedAction: clientRuntime.requestedAction,
      resolvedAction: workflowHandoff.resolvedAction,
      selectedAllowedActions: selectedDisposition?.allowedActions || [],
      canAcceptDecision: selectedDisposition?.canAcceptDecision === true,
      proofMissing: selectedDisposition?.proof?.missing === true,
      providerSyncOperation: providerSyncItem?.operation || null,
      providerDispatchable: providerSyncItem?.dispatchable === true,
      externalHandoffOperation: handoffPlanItem?.operation || null,
      externalHandoffRoute: handoffPlanItem?.route || null
    }
  };
  return {
    contractType: "human-review.client-handoff-envelope",
    schemaVersion: 1,
    generatedAt: now,
    command,
    clientStatePatch: {
      activeRoute: workflowHandoff.route,
      selectedClaimId: selectedClaimId || null,
      returnTo: workflowHandoff.returnTo,
      disabledControls: workflowHandoff.disabledControls,
      pendingClaimIds: acceptanceContract.pendingClaimIds,
      readinessReadyForExport: readinessContract.readyForExport,
      providerSyncState: providerServiceContract.sync.state,
      operationalStatus: operationalHealth.status
    },
    auditProof: {
      source: "hosted-kernel-human-review",
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      isolationKey: scope.isolationKey,
      permissionCount: scope.permissions.length,
      selectedDispositionProof: selectedDisposition?.auditProof || null,
      providerCheckpointKey: providerServiceContract.sync.checkpointKey,
      providerBatchReady: providerServiceContract.syncBatch.readyToDispatch,
      operationalMode: operationalHealth.mode,
      evaluatedAt: now
    }
  };
}

function buildWorkflowHandoff({ scope, boundaryContract, clientRuntime, clientRuntimeValidation, claims, reviewPreview, acceptanceContract, readinessContract, dispositionContract, explainableNextStep }) {
  const recommendedClaimId = explainableNextStep.claimId || clientRuntime.selectedClaimId;
  const selectedCard = recommendedClaimId
    ? reviewPreview.cards.find((card) => card.claimId === recommendedClaimId) || null
    : null;
  const selectedDisposition = recommendedClaimId
    ? dispositionContract.records.find((record) => record.claimId === recommendedClaimId) || null
    : null;
  const pendingClaimIds = acceptanceContract.pendingClaimIds.slice();
  const routeClaimId = selectedCard?.claimId || pendingClaimIds[0] || null;
  const routeByAction = {
    open_queue: "review-queue",
    open_claim: routeClaimId ? `claims/${routeClaimId}/review` : "review-queue",
    request_proof: routeClaimId ? `claims/${routeClaimId}/proof` : "review-queue",
    open_settings: "review-settings",
    export_report: "review-export"
  };
  const action = explainableNextStep.action === "fix_settings"
    ? "open_settings"
    : explainableNextStep.action === "request_proof"
      ? "request_proof"
      : explainableNextStep.action === "export"
        ? "export_report"
        : routeClaimId
          ? "open_claim"
          : "open_queue";
  const resolvedAction = CLIENT_HANDOFF_ACTIONS.has(clientRuntime.requestedAction) && clientRuntimeValidation.valid
    ? clientRuntime.requestedAction
    : action;
  const disabledControls = [
    ...(!acceptanceContract.canAcceptDispositions ? ["accept_disposition"] : []),
    ...(!readinessContract.readyForExport ? ["export_report"] : []),
    ...(!scope.permissions.includes("review:assign") ? ["reviewer_assignment"] : []),
    ...(!scope.permissions.includes("review:decide") ? ["final_disposition"] : []),
    ...(!scope.permissions.includes("settings:write") ? ["settings_write"] : []),
    ...(!boundaryContract.canUseRequestedAction ? ["requested_action"] : []),
    ...(!clientRuntime.supportsInlineProof ? ["inline_proof_upload"] : []),
    ...(!clientRuntime.supportsAuditExport ? ["audit_bundle_download"] : [])
  ];
  return {
    contractType: "human-review.workflow-handoff",
    schemaVersion: 1,
    sessionId: clientRuntime.sessionId,
    actor: clientRuntime.actor,
    requestedAction: clientRuntime.requestedAction,
    resolvedAction,
    route: routeByAction[resolvedAction] || "review-queue",
    returnTo: clientRuntime.returnTo,
    claimId: routeClaimId,
    headline: selectedCard?.title || reviewPreview.headline,
    userVisibleState: selectedCard?.userVisibleState || explainableNextStep.state,
    disabledControls,
    payload: {
      selectedClaimId: routeClaimId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      pendingClaimIds,
      decisionReadyClaimIds: dispositionContract.decisionReadyClaimIds,
      selectedDisposition,
      blockerCodes: acceptanceContract.blockers,
      nextStep: explainableNextStep,
      validationFindings: [...clientRuntimeValidation.findings, ...boundaryContract.findings]
    },
    audit: {
      currentRoute: clientRuntime.currentRoute,
      source: "hosted-kernel-human-review",
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      isolationKey: scope.isolationKey,
      capabilityCount: clientRuntime.capabilities.length,
      permissionCount: scope.permissions.length,
      boundaryFindingCount: boundaryContract.findings.length,
      claimCount: claims.length
    }
  };
}

function buildRoutePreviewAcceptanceContract({ scope, clientRuntime, reviewPreview, acceptanceContract, readinessContract, validationSummary, dispositionContract, workflowHandoff, providerServiceContract, operationalHealth, explainableNextStep, now }) {
  const validationFindings = [
    ...validationSummary.findings,
    ...providerServiceContract.findings,
    ...operationalHealth.actionableErrors
  ];
  const selectedClaimId = workflowHandoff.claimId || explainableNextStep.claimId;
  const selectedDisposition = selectedClaimId
    ? dispositionContract.records.find((record) => record.claimId === selectedClaimId) || null
    : null;
  const activeBlockerCodes = [
    ...acceptanceContract.blockers,
    ...validationFindings
      .filter((finding) => finding.severity === "error")
      .map((finding) => finding.code)
  ];
  const readinessPercent = readinessContract.totalCheckCount === 0
    ? 100
    : Math.round((readinessContract.readyCheckCount / readinessContract.totalCheckCount) * 100);
  const routeTabs = [
    {
      id: "queue",
      route: "review-queue",
      label: "Review queue",
      active: workflowHandoff.route === "review-queue",
      badgeCount: acceptanceContract.pendingClaimIds.length
    },
    {
      id: "claim",
      route: selectedClaimId ? `claims/${selectedClaimId}/review` : "review-queue",
      label: "Selected claim",
      active: workflowHandoff.route.includes("/review"),
      disabled: !selectedClaimId,
      badgeCount: selectedClaimId ? 1 : 0
    },
    {
      id: "proof",
      route: selectedClaimId ? `claims/${selectedClaimId}/proof` : "review-queue",
      label: "Proof",
      active: workflowHandoff.route.includes("/proof"),
      disabled: acceptanceContract.proofBlockerClaimIds.length === 0,
      badgeCount: acceptanceContract.proofBlockerClaimIds.length
    },
    {
      id: "export",
      route: "review-export",
      label: "Export",
      active: workflowHandoff.route === "review-export",
      disabled: !readinessContract.readyForExport,
      badgeCount: readinessContract.readyForExport ? 1 : 0
    }
  ];
  const primaryAction = !operationalHealth.healthy && operationalHealth.mode === "blocked"
    ? "inspect_human_review"
    : workflowHandoff.resolvedAction;
  const clientHandoffEnvelope = buildClientHandoffCommandEnvelope({
    scope,
    clientRuntime,
    workflowHandoff,
    acceptanceContract,
    readinessContract,
    dispositionContract,
    providerServiceContract,
    operationalHealth,
    explainableNextStep,
    now
  });
  return {
    contractType: "human-review.route-preview-acceptance",
    schemaVersion: 1,
    generatedAt: now,
    route: workflowHandoff.route,
    returnTo: workflowHandoff.returnTo,
    sessionId: clientRuntime.sessionId,
    actor: clientRuntime.actor,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    isolationKey: scope.isolationKey,
    headline: workflowHandoff.headline,
    userVisibleState: workflowHandoff.userVisibleState,
    primaryAction,
    primaryActionEnabled: activeBlockerCodes.length === 0 || ["open_queue", "open_claim", "request_proof", "open_settings", "inspect_human_review"].includes(primaryAction),
    primaryActionRoute: workflowHandoff.route,
    clientHandoffEnvelope,
    tabs: routeTabs,
    readinessMeter: {
      percent: readinessPercent,
      ready: readinessContract.ready,
      readyForExport: readinessContract.readyForExport,
      completedChecks: readinessContract.readyCheckCount,
      totalChecks: readinessContract.totalCheckCount,
      nextFailedCheck: readinessContract.checks.find((check) => !check.ready)?.key || null
    },
    acceptancePanel: {
      canAcceptDispositions: acceptanceContract.canAcceptDispositions,
      canExport: acceptanceContract.canExport,
      decisionReadyCount: acceptanceContract.decisionReadyClaimIds.length,
      blockedCount: acceptanceContract.dispositionBlockedClaimIds.length,
      pendingCount: acceptanceContract.pendingClaimIds.length,
      selectedClaimId,
      selectedClaimCanAccept: selectedDisposition?.canAcceptDecision === true,
      selectedAllowedActions: selectedDisposition?.allowedActions || [],
      blockerCodes: [...new Set(activeBlockerCodes)].sort()
    },
    validationDigest: {
      valid: validationFindings.every((finding) => finding.severity !== "error"),
      errorCount: validationFindings.filter((finding) => finding.severity === "error").length,
      warningCount: validationFindings.filter((finding) => finding.severity === "warning").length,
      infoCount: validationFindings.filter((finding) => finding.severity === "info").length,
      topFindings: validationFindings.slice(0, 5).map((finding) => ({
        severity: finding.severity,
        source: finding.source || "human_review",
        code: finding.code,
        message: finding.message,
        route: finding.route || workflowHandoff.route
      }))
    },
    claimRows: reviewPreview.cards.map((card) => {
      const disposition = dispositionContract.records.find((record) => record.claimId === card.claimId);
      return {
        claimId: card.claimId,
        title: card.title,
        status: card.status,
        priority: card.priority,
        userVisibleState: card.userVisibleState,
        isSelected: card.claimId === selectedClaimId,
        isNextRecommended: card.isNextRecommended,
        route: `claims/${card.claimId}/review`,
        proofRoute: `claims/${card.claimId}/proof`,
        canAcceptDecision: disposition?.canAcceptDecision === true,
        allowedActions: disposition?.allowedActions || ["comment"],
        blockerCodes: disposition?.blockerCodes || card.blockedReasons,
        acceptancePayload: {
          claimId: card.claimId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          idempotencyKey: `${scope.isolationKey}:${card.claimId}:${disposition?.latestAction?.actionId || card.status}`,
          auditRoute: workflowHandoff.route,
          proofSatisfied: disposition?.proof?.satisfiable === true,
          evaluatedAt: now
        }
      };
    }),
    nextStep: {
      ...explainableNextStep,
      route: workflowHandoff.route,
      providerSyncState: providerServiceContract.sync.state,
      operationalStatus: operationalHealth.status
    }
  };
}

function buildClientAcceptanceReviewDeck({ scope, routePreviewAcceptance, acceptanceContract, readinessContract, validationSummary, dispositionContract, providerServiceContract, operationalHealth, explainableNextStep, now }) {
  const validationFindings = [
    ...validationSummary.findings,
    ...providerServiceContract.findings,
    ...operationalHealth.actionableErrors
  ];
  const severityRank = { error: 0, warning: 1, info: 2 };
  const selectedClaimId = routePreviewAcceptance.acceptancePanel.selectedClaimId;
  const selectedRecord = selectedClaimId
    ? dispositionContract.records.find((record) => record.claimId === selectedClaimId) || null
    : null;
  const checksByKey = new Map(readinessContract.checks.map((check) => [check.key, check]));
  const readinessGroups = [
    {
      id: "gate",
      label: "Gate",
      checkKeys: ["lifecycle_enabled", "lifecycle_not_paused", "settings_valid"]
    },
    {
      id: "queue",
      label: "Queue",
      checkKeys: ["proof_complete", "dispositions_ready", "queue_closed"]
    },
    {
      id: "acceptance",
      label: "Acceptance",
      checkKeys: ["acceptance_available"]
    }
  ].map((group) => {
    const checks = group.checkKeys
      .map((key) => checksByKey.get(key))
      .filter(Boolean);
    return {
      ...group,
      ready: checks.every((check) => check.ready),
      completed: checks.filter((check) => check.ready).length,
      total: checks.length,
      failedCheckKeys: checks.filter((check) => !check.ready).map((check) => check.key)
    };
  });
  const operatorActions = [
    {
      action: routePreviewAcceptance.primaryAction,
      route: routePreviewAcceptance.primaryActionRoute,
      enabled: routePreviewAcceptance.primaryActionEnabled,
      claimId: selectedClaimId,
      reasonCode: routePreviewAcceptance.primaryActionEnabled
        ? "primary_action_available"
        : routePreviewAcceptance.acceptancePanel.blockerCodes[0] || "primary_action_blocked"
    },
    {
      action: "request_proof",
      route: selectedClaimId ? `claims/${selectedClaimId}/proof` : "review-queue",
      enabled: acceptanceContract.proofBlockerClaimIds.length > 0 && !operationalHealth.failed,
      claimId: acceptanceContract.proofBlockerClaimIds[0] || selectedClaimId || null,
      reasonCode: acceptanceContract.proofBlockerClaimIds.length > 0 ? "proof_missing" : "proof_not_required"
    },
    {
      action: "export_report",
      route: "review-export",
      enabled: readinessContract.readyForExport && operationalHealth.degradedMode.allowAuditExport !== false,
      claimId: null,
      reasonCode: readinessContract.readyForExport ? "export_ready" : "export_blocked"
    }
  ];
  const highlightedFindings = validationFindings
    .slice()
    .sort((a, b) => (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3) || String(a.code).localeCompare(String(b.code)))
    .slice(0, 8)
    .map((finding) => ({
      severity: finding.severity,
      source: finding.source || "human_review",
      code: finding.code,
      message: finding.message,
      route: finding.route || routePreviewAcceptance.route,
      action: finding.retryable
        ? "retry_provider_sync"
        : finding.source === "settings"
          ? "open_settings"
          : finding.code === "review_gate_disabled"
            ? "enable_gate"
            : finding.code === "review_gate_paused"
              ? "resume_gate"
              : "inspect_claim"
    }));
  const claimDecisionPreview = routePreviewAcceptance.claimRows.map((row) => {
    const syncItem = providerServiceContract.syncBatch.items.find((item) => item.claimId === row.claimId) || null;
    const handoffItem = providerServiceContract.externalHandoff.plan.items.find((item) => item.claimId === row.claimId) || null;
    return {
      claimId: row.claimId,
      route: row.route,
      proofRoute: row.proofRoute,
      state: row.userVisibleState,
      selected: row.isSelected,
      recommended: row.isNextRecommended,
      canAcceptDecision: row.canAcceptDecision,
      allowedActions: row.allowedActions,
      blockerCodes: row.blockerCodes,
      providerSync: {
        operation: syncItem?.operation || null,
        dispatchable: syncItem?.dispatchable === true,
        ackState: syncItem?.ackState || "not_applicable",
        idempotencyKey: syncItem?.idempotencyKey || null
      },
      externalHandoff: {
        operation: handoffItem?.operation || null,
        route: handoffItem?.route || null,
        priority: handoffItem?.priority || row.priority
      },
      acceptancePayload: row.acceptancePayload
    };
  });
  const nextStepEvidence = {
    source: "hosted-kernel-human-review",
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    isolationKey: scope.isolationKey,
    selectedClaimId,
    selectedClaimCanAccept: selectedRecord?.canAcceptDecision === true,
    selectedClaimBlockers: selectedRecord?.blockerCodes || [],
    providerCheckpointKey: providerServiceContract.sync.checkpointKey,
    providerBatchReady: providerServiceContract.syncBatch.readyToDispatch,
    operationalStatus: operationalHealth.status,
    readinessPercent: routePreviewAcceptance.readinessMeter.percent,
    evaluatedAt: now
  };
  return {
    contractType: "human-review.client-acceptance-review-deck",
    schemaVersion: 1,
    generatedAt: now,
    route: routePreviewAcceptance.route,
    sessionId: routePreviewAcceptance.sessionId,
    actor: routePreviewAcceptance.actor,
    headline: routePreviewAcceptance.headline,
    userVisibleState: routePreviewAcceptance.userVisibleState,
    selectedClaimId,
    primaryAction: routePreviewAcceptance.primaryAction,
    primaryActionEnabled: routePreviewAcceptance.primaryActionEnabled,
    readinessGroups,
    operatorActions,
    validationSummary: {
      valid: highlightedFindings.every((finding) => finding.severity !== "error"),
      errorCount: validationFindings.filter((finding) => finding.severity === "error").length,
      warningCount: validationFindings.filter((finding) => finding.severity === "warning").length,
      infoCount: validationFindings.filter((finding) => finding.severity === "info").length,
      highlightedFindings
    },
    acceptanceSummary: {
      canAcceptDispositions: acceptanceContract.canAcceptDispositions,
      canExport: acceptanceContract.canExport,
      pendingClaimIds: acceptanceContract.pendingClaimIds,
      decisionReadyClaimIds: acceptanceContract.decisionReadyClaimIds,
      blockedClaimIds: acceptanceContract.dispositionBlockedClaimIds,
      proofBlockerClaimIds: acceptanceContract.proofBlockerClaimIds
    },
    claimDecisionPreview,
    nextStep: {
      ...explainableNextStep,
      route: routePreviewAcceptance.route,
      evidence: nextStepEvidence
    },
    auditProof: nextStepEvidence
  };
}

export function describeHumanReviewSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const allClaims = list(input.claims ?? input.evidence).map(normalizeClaim);
  const allActions = list(input.reviewActions ?? input.actions).map(normalizeAction);
  const scope = normalizeScope(input);
  const persistedState = normalizePersistedState(input, scope, now);
  const clientRuntime = normalizeClientRuntime(input);
  const providerRuntime = normalizeProviderRuntime(input);
  const operationalRuntime = normalizeOperationalRuntime(input);
  const operationalValidation = buildOperationalRuntimeValidation({ operationalRuntime, now });
  const boundaryContract = buildBoundaryContract({ scope, claims: allClaims, actions: allActions, clientRuntime });
  const scopedClaimIds = new Set(boundaryContract.scopedClaimIds);
  const outOfScopeActionIds = new Set(boundaryContract.outOfScopeActionIds);
  const permissionDeniedActionIds = new Set(boundaryContract.permissionDenials.map((denial) => denial.actionId));
  const claims = allClaims.filter((claim) => scopedClaimIds.has(claim.claimId));
  const actions = allActions.filter((action) => {
    if (outOfScopeActionIds.has(action.actionId)) return false;
    if (permissionDeniedActionIds.has(action.actionId)) return false;
    return !action.claimId || scopedClaimIds.has(action.claimId);
  });
  const settings = normalizeSettings(input.settings ?? input.lifecycleSettings);
  const lifecycleCommands = list(input.lifecycleCommands ?? input.commands).map(normalizeLifecycleCommand);
  const settingsStatus = settingsValidation(settings, claims);
  const counters = buildCounters(claims, actions);
  const lifecycle = applyLifecycleCommands(settings, lifecycleCommands, {
    now,
    openClaimCount: counters.pendingReview,
    persistedState
  });
  const timeline = buildTimeline(claims, actions, now);
  const historySnapshots = buildHistorySnapshots(claims, input.historySnapshots, now);
  const nextActionState = buildNextActionState({ claims, counters, settings, settingsStatus, lifecycle, now });
  const lifecycleControls = buildLifecycleControls({
    scope,
    settings,
    settingsStatus,
    lifecycle,
    commands: lifecycleCommands,
    counters,
    now
  });
  const lifecycleProof = buildLifecycleProof({ settings, settingsStatus, lifecycle, lifecycleControls, nextAction: nextActionState });
  const validationSummary = buildValidationSummary({ claims, actions, settingsStatus, lifecycle, persistedState });
  const reviewPreview = buildReviewPreview({ claims, actions, settings, lifecycle, nextActionState, now });
  const dispositionContract = buildDispositionContract({
    scope,
    claims,
    actions,
    settings,
    settingsStatus,
    lifecycle,
    boundaryContract,
    now
  });
  const acceptanceContract = buildAcceptanceContract({
    claims,
    counters,
    settingsStatus,
    lifecycle,
    validationSummary,
    boundaryContract,
    nextActionState,
    dispositionContract
  });
  const readinessContract = buildReadinessContract({ counters, lifecycle, settingsStatus, acceptanceContract, dispositionContract });
  const explainableNextStep = buildExplainableNextStep({ nextActionState, validationSummary, boundaryContract, acceptanceContract });
  const clientRuntimeValidation = buildClientRuntimeValidation({ clientRuntime, claims, acceptanceContract });
  const workflowHandoff = buildWorkflowHandoff({
    scope,
    boundaryContract,
    clientRuntime,
    clientRuntimeValidation,
    claims,
    reviewPreview,
    acceptanceContract,
    readinessContract,
    dispositionContract,
    explainableNextStep
  });
  const providerServiceContract = buildProviderServiceContract({
    providerRuntime,
    scope,
    counters,
    settings,
    lifecycle,
    acceptanceContract,
    readinessContract,
    dispositionContract,
    workflowHandoff,
    now
  });
  const queueFailureContract = buildQueueFailureContract({
    claims,
    counters,
    settings,
    lifecycle,
    acceptanceContract,
    dispositionContract,
    providerServiceContract,
    now
  });
  const operationalHealth = buildOperationalHealthContract({
    operationalRuntime,
    operationalValidation,
    providerServiceContract,
    settings,
    settingsStatus,
    lifecycle,
    counters,
    readinessContract,
    acceptanceContract,
    workflowHandoff,
    queueFailureContract,
    now
  });
  const persistenceContract = buildPersistenceContract({
    scope,
    persistedState,
    lifecycle,
    counters,
    acceptanceContract,
    readinessContract,
    providerServiceContract,
    operationalHealth,
    now
  });
  const exportSummary = buildExportSummary(claims, actions, counters, now, scope, dispositionContract, boundaryContract);
  const routePreviewAcceptance = buildRoutePreviewAcceptanceContract({
    scope,
    clientRuntime,
    reviewPreview,
    acceptanceContract,
    readinessContract,
    validationSummary,
    dispositionContract,
    workflowHandoff,
    providerServiceContract,
    operationalHealth,
    explainableNextStep,
    now
  });
  const clientAcceptanceReviewDeck = buildClientAcceptanceReviewDeck({
    scope,
    routePreviewAcceptance,
    acceptanceContract,
    readinessContract,
    validationSummary,
    dispositionContract,
    providerServiceContract,
    operationalHealth,
    explainableNextStep,
    now
  });
  const openClaimIds = claims
    .filter((claim) => !FINAL_REVIEW_STATES.has(claim.status))
    .map((claim) => claim.claimId);

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel human review analytics and export contract",
    scope,
    boundaryContract,
    analytics: counters,
    settings,
    settingsStatus,
    persistedState,
    lifecycle: {
      enabled: lifecycle.enabled,
      paused: lifecycle.paused,
      scheduledReviewAt: lifecycle.scheduledReviewAt,
      lastCommand: lifecycle.lastCommand,
      commandCount: lifecycle.auditTrail.length,
      acceptedCommandCount: lifecycle.acceptedCommandCount,
      rejectedCommandCount: lifecycle.rejectedCommandCount,
      replayedCommandCount: lifecycle.replayedCommandCount,
      recoveredFromCheckpoint: lifecycle.recoveredFromCheckpoint,
      recoveryMode: lifecycle.recoveryMode,
      processedCommandIds: lifecycle.processedCommandIds
    },
    lifecycleControls,
    nextActionState,
    explainableNextStep,
    lifecycleProof,
    validationSummary,
    reviewPreview,
    dispositionContract,
    acceptanceContract,
    readinessContract,
    clientRuntime,
    clientRuntimeValidation,
    providerRuntime,
    providerServiceContract,
    queueFailureContract,
    operationalRuntime,
    operationalValidation,
    operationalHealth,
    persistenceContract,
    workflowHandoff,
    routePreviewAcceptance,
    clientAcceptanceReviewDeck,
    historySnapshots,
    timeline,
    reportState: {
      readyForExport: readinessContract.readyForExport,
      openClaimIds,
      needsHumanReview: openClaimIds.length > 0,
      proofBlockers: claims.filter((claim) => claim.missingProof).map((claim) => claim.claimId),
      decisionReadyClaimIds: dispositionContract.decisionReadyClaimIds,
      dispositionBlockedClaimIds: dispositionContract.blockedClaimIds,
      scopedClaimIds: boundaryContract.scopedClaimIds,
      outOfScopeClaimIds: boundaryContract.outOfScopeClaimIds,
      outOfScopeActionIds: boundaryContract.outOfScopeActionIds,
      tenantBoundaryValid: boundaryContract.valid,
      isolationKey: scope.isolationKey,
      nextAction: nextActionState.action,
      nextStep: explainableNextStep,
      canAcceptDispositions: acceptanceContract.canAcceptDispositions,
      blockedByLifecycle: !lifecycle.enabled || lifecycle.paused,
      blockedBySettings: !settingsStatus.valid,
      handoffRoute: workflowHandoff.route,
      handoffAction: workflowHandoff.resolvedAction,
      selectedClaimId: workflowHandoff.claimId,
      routePreviewPrimaryAction: routePreviewAcceptance.primaryAction,
      routePreviewPrimaryActionEnabled: routePreviewAcceptance.primaryActionEnabled,
      routePreviewReadinessPercent: routePreviewAcceptance.readinessMeter.percent,
      routePreviewValidationErrorCount: routePreviewAcceptance.validationDigest.errorCount,
      routePreviewDecisionReadyCount: routePreviewAcceptance.acceptancePanel.decisionReadyCount,
      clientAcceptanceDeckPrimaryAction: clientAcceptanceReviewDeck.primaryAction,
      clientAcceptanceDeckPrimaryActionEnabled: clientAcceptanceReviewDeck.primaryActionEnabled,
      clientAcceptanceDeckSelectedClaimId: clientAcceptanceReviewDeck.selectedClaimId,
      clientAcceptanceDeckValidationErrorCount: clientAcceptanceReviewDeck.validationSummary.errorCount,
      clientAcceptanceDeckHighlightedFindingCodes: clientAcceptanceReviewDeck.validationSummary.highlightedFindings.map((finding) => finding.code),
      clientAcceptanceDeckReadyGroupIds: clientAcceptanceReviewDeck.readinessGroups.filter((group) => group.ready).map((group) => group.id),
      clientAcceptanceDeckDecisionPreviewCount: clientAcceptanceReviewDeck.claimDecisionPreview.length,
      clientHandoffCommandId: routePreviewAcceptance.clientHandoffEnvelope.command.commandId,
      clientHandoffOperation: routePreviewAcceptance.clientHandoffEnvelope.command.operation,
      clientHandoffEnabled: routePreviewAcceptance.clientHandoffEnvelope.command.enabled,
      clientHandoffBlocked: routePreviewAcceptance.clientHandoffEnvelope.command.blocked,
      clientHandoffBlockerCodes: routePreviewAcceptance.clientHandoffEnvelope.command.blockerCodes,
      clientHandoffActiveRoute: routePreviewAcceptance.clientHandoffEnvelope.clientStatePatch.activeRoute,
      clientHandoffProviderSyncState: routePreviewAcceptance.clientHandoffEnvelope.clientStatePatch.providerSyncState,
      providerNegotiated: providerServiceContract.negotiated,
      providerSyncState: providerServiceContract.sync.state,
      providerSyncCursor: providerServiceContract.sync.cursor,
      providerSyncRevision: providerServiceContract.sync.revision,
      providerSyncNextRevision: providerServiceContract.sync.nextRevision,
      providerSyncAcknowledgedRevision: providerServiceContract.sync.acknowledgedRevision,
      providerSyncAcknowledgedClaimIds: providerServiceContract.sync.acknowledgedClaimIds,
      providerSyncFailedClaimIds: providerServiceContract.sync.failedClaimIds,
      providerSyncCheckpointKey: providerServiceContract.sync.checkpointKey,
      providerSyncRevisionValid: providerServiceContract.sync.revisionValid,
      providerSyncBatchReady: providerServiceContract.syncBatch.readyToDispatch,
      providerSyncBatchItemCount: providerServiceContract.syncBatch.itemCount,
      providerSyncDispatchableCount: providerServiceContract.syncBatch.dispatchableCount,
      providerSyncPendingAckCount: providerServiceContract.syncBatch.pendingAckCount,
      providerSyncFailedAckCount: providerServiceContract.syncBatch.failedAckCount,
      providerSyncNextDispatchClaimId: providerServiceContract.syncBatch.nextDispatchClaimId,
      providerSyncRequiresExternalAck: providerServiceContract.syncBatch.requiresExternalAck,
      externalHandoffState: providerServiceContract.externalHandoff.state,
      externalHandoffReady: providerServiceContract.externalHandoff.ready,
      externalHandoffSystem: providerServiceContract.externalHandoff.system,
      externalHandoffCaseId: providerServiceContract.externalHandoff.caseId,
      externalHandoffTargetClaimIds: providerServiceContract.externalHandoff.plan.targetClaimIds,
      externalHandoffPendingOperationCount: providerServiceContract.externalHandoff.plan.pendingOperationCount,
      externalHandoffNextOperation: providerServiceContract.externalHandoff.plan.nextOperation,
      providerFindingCount: providerServiceContract.findings.length,
      operationalStatus: operationalHealth.status,
      operationalMode: operationalHealth.mode,
      operationalHealthy: operationalHealth.healthy,
      operationalFailed: operationalHealth.failed,
      operationalDegraded: operationalHealth.degraded,
      operationalValidationValid: operationalValidation.valid,
      operationalValidationErrorCount: operationalValidation.errorCount,
      operationalFailureState: operationalHealth.failureState.state,
      operationalFailureReasonCode: operationalHealth.failureState.reasonCode,
      operationalRecoveryAction: operationalHealth.failureState.recoveryAction,
      operationalOperatorRoute: operationalHealth.failureState.operatorRoute,
      queueFailureState: queueFailureContract.state,
      queueFailureStalled: queueFailureContract.stalled,
      queueFailureOldestOpenAgeHours: queueFailureContract.oldestOpenAgeHours,
      queueFailureNextOperatorAction: queueFailureContract.nextOperatorAction,
      queueFailureNextOperatorClaimId: queueFailureContract.nextOperatorClaimId,
      queueFailureIncidentCodes: queueFailureContract.incidents.map((incident) => incident.code),
      queueFailureOverdueClaimIds: queueFailureContract.overdueClaimIds,
      queueFailureProviderBlockedClaimIds: queueFailureContract.providerBlockedClaimIds,
      retryableOperation: operationalHealth.retryPlan.canRetry,
      nextRetryAt: operationalHealth.retryPlan.nextRetryAt,
      actionableErrorCount: operationalHealth.actionableErrors.length,
      persistedStatus: persistenceContract.status,
      restartSafe: persistenceContract.restartSafe,
      restartReplayState: persistenceContract.restartStatus.replayState,
      restartRefreshRequired: persistenceContract.restartStatus.refreshRequired,
      restartBlockers: persistenceContract.restartStatus.blockers,
      restartWarnings: persistenceContract.restartStatus.warnings,
      restartQueueChanged: persistenceContract.restartStatus.queues.changed,
      restartProviderRevisionChanged: persistenceContract.restartStatus.provider.revisionChanged,
      restartProviderCheckpointChanged: persistenceContract.restartStatus.provider.checkpointChanged,
      recoveredFromCheckpoint: persistenceContract.recovered,
      recoverySource: persistenceContract.recoverySource,
      replayedCommandCount: persistenceContract.idempotency.replayedCommandCount,
      nextStateId: persistenceContract.nextState.stateId
    },
    exportSummary,
    evidence: claims
  };
}

export default describeHumanReviewSurface;
