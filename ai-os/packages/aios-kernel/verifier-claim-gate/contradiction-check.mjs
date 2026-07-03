export const surfaceId = "aios_verifier-claim-gate_contradiction-check_065";
export const surfaceGroup = "verifier-claim-gate";
export const surfaceName = "contradiction-check";

const DEFAULT_BLOCKING_SEVERITY = "high";
const SUPPORTED_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const SUPPORTED_LIFECYCLE_COMMANDS = new Set(["enable", "disable", "pause", "resume", "run-now", "schedule"]);
const SUPPORTED_SCHEDULE_MODES = new Set(["manual", "interval", "on-evidence-change"]);
const MAX_RETRY_ATTEMPTS = 4;
const MAX_HISTORY_SNAPSHOTS = 12;
const MIN_SCHEDULE_INTERVAL_MS = 60000;
const MAX_SCHEDULE_INTERVAL_MS = 86400000;
const MAX_PERSISTED_COMMAND_RECEIPTS = 20;
const REQUIRED_PROVIDER_CAPABILITIES = ["claim-read", "evidence-read", "proof-export"];
const OPTIONAL_PROVIDER_CAPABILITIES = ["resolution-handoff", "cursor-sync", "operator-escalation"];
const SUPPORTED_HANDOFF_MODES = new Set(["inline", "external", "hybrid"]);
const MAX_SYNC_AGE_MS = 3600000;
const MAX_KERNEL_HEARTBEAT_AGE_MS = 120000;
const MAX_KERNEL_EXECUTION_LATENCY_MS = 15000;
const MAX_KERNEL_QUEUE_DEPTH = 250;
const SUPPORTED_CIRCUIT_STATES = new Set(["closed", "half-open", "open"]);
const MAX_RECOVERY_LEASE_AGE_MS = 300000;
const SUPPORTED_PERSISTED_CHECKPOINT_STATUSES = new Set(["none", "queued", "running", "in-flight", "recovering", "completed", "failed", "abandoned"]);
const REQUIRED_GATE_PERMISSIONS = ["claim:read", "evidence:read", "proof:export"];
const CLIENT_RUNTIME_CAPABILITIES = ["audit-preview", "proof-preview", "handoff-state", "route-replace"];
const ROLE_PERMISSION_GRANTS = {
  viewer: ["claim:read", "evidence:read"],
  verifier: ["claim:read", "evidence:read", "proof:export"],
  operator: ["claim:read", "evidence:read", "proof:export", "resolution:handoff"],
  admin: ["claim:read", "evidence:read", "proof:export", "resolution:handoff", "tenant:boundary.override"],
  service: ["claim:read", "evidence:read", "proof:export", "resolution:handoff"]
};

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSeverity(value, fallback = "medium") {
  const severity = asText(value).toLowerCase();
  return SUPPORTED_SEVERITIES.has(severity) ? severity : fallback;
}

function normalizeClaim(rawClaim, index) {
  const claim = asRecord(rawClaim);
  const id = asText(claim.id) || `claim-${index + 1}`;
  const text = asText(claim.text || claim.claim || claim.statement);
  const source = asText(claim.source || claim.sourceId || claim.origin);
  const confidence = Number.isFinite(claim.confidence) ? claim.confidence : undefined;

  return {
    id,
    text,
    source,
    confidence,
    tenantId: asText(claim.tenantId || claim.tenant || claim.orgId),
    workspaceId: asText(claim.workspaceId || claim.workspace || claim.projectId),
    requiresVerification: claim.requiresVerification !== false
  };
}

function normalizeEvidence(rawEvidence, index) {
  const evidence = asRecord(rawEvidence);
  const claimId = asText(evidence.claimId || evidence.claim_id || evidence.refutesClaimId);
  const id = asText(evidence.id) || `evidence-${index + 1}`;
  const text = asText(evidence.text || evidence.summary || evidence.observation);
  const verdict = asText(evidence.verdict || evidence.status).toLowerCase();
  const severity = normalizeSeverity(evidence.severity);

  return {
    id,
    claimId,
    text,
    verdict,
    severity,
    source: asText(evidence.source || evidence.sourceId || evidence.url),
    proofRef: asText(evidence.proofRef || evidence.proof || evidence.artifact),
    tenantId: asText(evidence.tenantId || evidence.tenant || evidence.orgId),
    workspaceId: asText(evidence.workspaceId || evidence.workspace || evidence.projectId)
  };
}

function normalizeRequest(input) {
  const request = asRecord(input.request || input.clientRequest);
  return {
    id: asText(request.id || input.requestId) || "untracked-request",
    route: asText(request.route || input.route) || `${surfaceGroup}/${surfaceName}`,
    actor: asText(request.actor || request.client || input.actor) || "unknown-client",
    intent: asText(request.intent || input.intent)
  };
}

function normalizeClientState(input) {
  const clientState = asRecord(input.clientState || input.state);
  const workflow = asRecord(clientState.workflow);
  return {
    sessionId: asText(clientState.sessionId || input.sessionId) || "untracked-session",
    workflowId: asText(workflow.id || clientState.workflowId || input.workflowId) || "claim-verification",
    currentStep: asText(workflow.currentStep || clientState.currentStep) || surfaceName,
    priorGate: asText(clientState.priorGate || workflow.priorGate)
  };
}

function isContradictingEvidence(evidence) {
  return evidence.verdict === "contradicts" ||
    evidence.verdict === "refuted" ||
    evidence.verdict === "false" ||
    evidence.verdict === "conflict";
}

function severityRank(severity) {
  return ["low", "medium", "high", "critical"].indexOf(severity);
}

function normalizeRetryState(input) {
  const retry = asRecord(input.retry || input.retryState || input.operationalRetry);
  const attemptRaw = Number(retry.attempt ?? retry.attempts ?? input.retryAttempt ?? 0);
  const attempt = Number.isFinite(attemptRaw) && attemptRaw > 0 ? Math.floor(attemptRaw) : 0;
  const lastError = asText(retry.lastError || retry.error || input.lastOperationalError);

  return {
    attempt,
    maxAttempts: MAX_RETRY_ATTEMPTS,
    exhausted: attempt >= MAX_RETRY_ATTEMPTS,
    lastError
  };
}

function normalizeDependencyHealth(rawDependency, index) {
  const dependency = asRecord(rawDependency);
  const status = asText(dependency.status || dependency.state || "ready").toLowerCase();
  const latencyRaw = Number(dependency.latencyMs ?? dependency.responseTimeMs);
  const latencyMs = Number.isFinite(latencyRaw) && latencyRaw >= 0 ? Math.floor(latencyRaw) : null;

  return {
    id: asText(dependency.id || dependency.name || dependency.serviceName) || `dependency-${index + 1}`,
    route: asText(dependency.route || dependency.endpointRoute || dependency.endpoint) || null,
    status,
    ready: ["ready", "healthy", "online", "available"].includes(status),
    latencyMs,
    lastError: asText(dependency.lastError || dependency.error || dependency.message) || null
  };
}

function normalizeKernelExecutionHealth(input, now) {
  const rawHealth = asRecord(input.kernelHealth || input.executionHealth || input.hostedKernelHealth);
  const heartbeat = asRecord(rawHealth.heartbeat || rawHealth.lastHeartbeat || input.heartbeat);
  const queue = asRecord(rawHealth.queue || rawHealth.workQueue || input.workQueue);
  const runtime = asRecord(rawHealth.runtime || rawHealth.worker || input.workerRuntime);
  const dependencyHealth = asList(rawHealth.dependencies || rawHealth.dependencyHealth || input.dependencyHealth)
    .map(normalizeDependencyHealth);
  const circuitStateRaw = asText(rawHealth.circuitState || runtime.circuitState || input.circuitState || "closed").toLowerCase();
  const acceptedCircuitState = SUPPORTED_CIRCUIT_STATES.has(circuitStateRaw) ? circuitStateRaw : "open";
  const observedAt = asText(rawHealth.observedAt || heartbeat.at || heartbeat.observedAt || runtime.observedAt);
  const observedAtMs = Date.parse(observedAt);
  const nowMs = Date.parse(now);
  const heartbeatAgeMs = Number.isFinite(observedAtMs) && Number.isFinite(nowMs)
    ? Math.max(0, nowMs - observedAtMs)
    : null;
  const latencyRaw = Number(runtime.latencyMs ?? rawHealth.latencyMs ?? rawHealth.executionLatencyMs);
  const latencyMs = Number.isFinite(latencyRaw) && latencyRaw >= 0 ? Math.floor(latencyRaw) : null;
  const queueDepth = asPositiveInteger(queue.depth ?? queue.pending ?? rawHealth.queueDepth, 0);
  const validationErrors = [];

  if (circuitStateRaw && !SUPPORTED_CIRCUIT_STATES.has(circuitStateRaw)) {
    validationErrors.push({
      code: "kernel_circuit_state_unsupported",
      message: "Hosted-kernel circuit state must be closed, half-open, or open.",
      circuitState: circuitStateRaw
    });
  }

  if (acceptedCircuitState === "open") {
    validationErrors.push({
      code: "kernel_circuit_open",
      message: "Hosted-kernel contradiction-check execution circuit is open.",
      route: "verifier-claim-gate/contradiction-check/health"
    });
  }

  if (heartbeatAgeMs !== null && heartbeatAgeMs > MAX_KERNEL_HEARTBEAT_AGE_MS) {
    validationErrors.push({
      code: "kernel_heartbeat_stale",
      message: "Hosted-kernel heartbeat is older than the contradiction-check health budget.",
      heartbeatAgeMs,
      maxHeartbeatAgeMs: MAX_KERNEL_HEARTBEAT_AGE_MS
    });
  }

  if (latencyMs !== null && latencyMs > MAX_KERNEL_EXECUTION_LATENCY_MS) {
    validationErrors.push({
      code: "kernel_execution_latency_high",
      message: "Hosted-kernel contradiction-check execution latency exceeds the product SLA.",
      latencyMs,
      maxLatencyMs: MAX_KERNEL_EXECUTION_LATENCY_MS
    });
  }

  if (queueDepth > MAX_KERNEL_QUEUE_DEPTH) {
    validationErrors.push({
      code: "kernel_queue_saturated",
      message: "Hosted-kernel contradiction-check queue depth exceeds the retry-safe budget.",
      queueDepth,
      maxQueueDepth: MAX_KERNEL_QUEUE_DEPTH
    });
  }

  const failedDependencies = dependencyHealth.filter((dependency) => !dependency.ready);
  if (failedDependencies.length > 0) {
    validationErrors.push({
      code: "kernel_dependency_unavailable",
      message: "A hosted-kernel dependency required for contradiction-check execution is unavailable.",
      dependencyIds: failedDependencies.map((dependency) => dependency.id)
    });
  }

  const hardErrorCodes = new Set(["kernel_circuit_state_unsupported", "kernel_circuit_open", "kernel_dependency_unavailable"]);
  const failureMode = validationErrors.some((error) => hardErrorCodes.has(error.code))
    ? "failed"
    : validationErrors.length > 0 || acceptedCircuitState === "half-open"
      ? "degraded"
      : "healthy";
  const retryDelayMs = acceptedCircuitState === "open"
    ? 30000
    : queueDepth > MAX_KERNEL_QUEUE_DEPTH
      ? 15000
      : latencyMs !== null && latencyMs > MAX_KERNEL_EXECUTION_LATENCY_MS
        ? 10000
        : 5000;

  return {
    contractVersion: "contradiction-check.kernel-execution-health.v1",
    state: failureMode,
    observedAt: observedAt || null,
    heartbeatAgeMs,
    circuitState: acceptedCircuitState,
    queue: {
      depth: queueDepth,
      maxDepth: MAX_KERNEL_QUEUE_DEPTH,
      saturated: queueDepth > MAX_KERNEL_QUEUE_DEPTH
    },
    latency: {
      executionMs: latencyMs,
      maxExecutionMs: MAX_KERNEL_EXECUTION_LATENCY_MS,
      breached: latencyMs !== null && latencyMs > MAX_KERNEL_EXECUTION_LATENCY_MS
    },
    dependencies: dependencyHealth,
    degradedMode: {
      active: failureMode !== "healthy",
      reasonCodes: validationErrors.map((error) => error.code),
      proofExportAllowed: failureMode === "healthy",
      auditPreviewAllowed: true
    },
    retryPlan: {
      retryable: failureMode !== "healthy" && acceptedCircuitState !== "open",
      retryAfterMs: failureMode === "healthy" ? null : retryDelayMs,
      route: "verifier-claim-gate/contradiction-check/health"
    },
    validationErrors
  };
}

function normalizeCapabilityList(value) {
  return asList(value)
    .map((item) => asText(item).toLowerCase())
    .filter(Boolean);
}

function normalizeScopedList(...values) {
  return [...new Set(values.flatMap((value) => asList(value)).map(asText).filter(Boolean))];
}

function permissionsForRoles(roles) {
  return roles.flatMap((role) => ROLE_PERMISSION_GRANTS[role] || []);
}

function normalizeAccessBoundary(input, request, clientState, claims, evidence) {
  const boundary = asRecord(input.boundary || input.tenantBoundary || input.workspaceBoundary);
  const actor = asRecord(input.actorContext || input.principal || input.identity);
  const tenant = asRecord(input.tenant || boundary.tenant);
  const workspace = asRecord(input.workspace || boundary.workspace);
  const tenantId = asText(boundary.tenantId || tenant.id || input.tenantId) || "hosted-kernel-tenant";
  const workspaceId = asText(boundary.workspaceId || workspace.id || input.workspaceId || clientState.workflowId) || "claim-verification";
  const roles = normalizeCapabilityList(actor.roles || boundary.roles || input.roles);
  const effectiveRoles = roles.length > 0 ? roles : ["service"];
  const explicitPermissions = normalizeCapabilityList(actor.permissions || boundary.permissions || input.permissions);
  const effectivePermissions = [...new Set([...permissionsForRoles(effectiveRoles), ...explicitPermissions])];
  const requiredPermissions = normalizeCapabilityList(boundary.requiredPermissions).length > 0
    ? normalizeCapabilityList(boundary.requiredPermissions)
    : REQUIRED_GATE_PERMISSIONS;
  const allowedTenantIds = normalizeScopedList(boundary.allowedTenantIds, actor.allowedTenantIds, [tenantId]);
  const allowedWorkspaceIds = normalizeScopedList(boundary.allowedWorkspaceIds, actor.allowedWorkspaceIds, [workspaceId]);
  const missingPermissions = requiredPermissions.filter((permission) => !effectivePermissions.includes(permission));
  const canOverrideBoundary = effectivePermissions.includes("tenant:boundary.override");
  const claimScopeViolations = claims
    .filter((claim) => claim.tenantId || claim.workspaceId)
    .filter((claim) => {
      const tenantAllowed = !claim.tenantId || allowedTenantIds.includes(claim.tenantId);
      const workspaceAllowed = !claim.workspaceId || allowedWorkspaceIds.includes(claim.workspaceId);
      return !canOverrideBoundary && (!tenantAllowed || !workspaceAllowed);
    })
    .map((claim) => ({ claimId: claim.id, tenantId: claim.tenantId || null, workspaceId: claim.workspaceId || null }));
  const evidenceScopeViolations = evidence
    .filter((item) => item.tenantId || item.workspaceId)
    .filter((item) => {
      const tenantAllowed = !item.tenantId || allowedTenantIds.includes(item.tenantId);
      const workspaceAllowed = !item.workspaceId || allowedWorkspaceIds.includes(item.workspaceId);
      return !canOverrideBoundary && (!tenantAllowed || !workspaceAllowed);
    })
    .map((item) => ({ evidenceId: item.id, tenantId: item.tenantId || null, workspaceId: item.workspaceId || null }));
  const validationErrors = [];

  if (missingPermissions.length > 0) {
    validationErrors.push({
      code: "actor_missing_gate_permission",
      message: "Actor lacks required permissions for contradiction-check proof gating.",
      missingPermissions
    });
  }

  if (claimScopeViolations.length > 0 || evidenceScopeViolations.length > 0) {
    validationErrors.push({
      code: "tenant_workspace_scope_violation",
      message: "Claims or evidence cross the active tenant/workspace boundary.",
      claimIds: claimScopeViolations.map((item) => item.claimId),
      evidenceIds: evidenceScopeViolations.map((item) => item.evidenceId)
    });
  }

  return {
    contractVersion: "contradiction-check.access-boundary.v1",
    actorId: asText(actor.id || actor.actorId || request.actor) || "unknown-client",
    tenantId,
    workspaceId,
    isolationMode: asText(boundary.isolationMode || input.isolationMode) || "tenant-workspace",
    roles: effectiveRoles,
    permissions: {
      required: requiredPermissions,
      effective: effectivePermissions,
      missing: missingPermissions
    },
    allowedTenantIds,
    allowedWorkspaceIds,
    canOverrideBoundary,
    scopedResourceCounts: {
      claimsWithScope: claims.filter((claim) => claim.tenantId || claim.workspaceId).length,
      evidenceWithScope: evidence.filter((item) => item.tenantId || item.workspaceId).length,
      claimScopeViolations: claimScopeViolations.length,
      evidenceScopeViolations: evidenceScopeViolations.length
    },
    claimScopeViolations,
    evidenceScopeViolations,
    ready: validationErrors.length === 0,
    validationErrors
  };
}

function applyAccessBoundaryScope({ claims, evidence, accessBoundary }) {
  const blockedClaimIds = new Set(accessBoundary.claimScopeViolations.map((item) => item.claimId));
  const blockedEvidenceIds = new Set(accessBoundary.evidenceScopeViolations.map((item) => item.evidenceId));
  const claimIds = new Set(claims.map((claim) => claim.id));
  const quarantinedClaims = claims
    .filter((claim) => blockedClaimIds.has(claim.id))
    .map((claim) => ({
      claimId: claim.id,
      tenantId: claim.tenantId || null,
      workspaceId: claim.workspaceId || null,
      reasonCode: "claim_outside_access_boundary"
    }));
  const quarantinedEvidence = evidence
    .filter((item) => {
      return blockedEvidenceIds.has(item.id) ||
        blockedClaimIds.has(item.claimId) ||
        (item.claimId && !claimIds.has(item.claimId));
    })
    .map((item) => ({
      evidenceId: item.id,
      claimId: item.claimId || null,
      tenantId: item.tenantId || null,
      workspaceId: item.workspaceId || null,
      reasonCode: blockedEvidenceIds.has(item.id)
        ? "evidence_outside_access_boundary"
        : blockedClaimIds.has(item.claimId)
          ? "evidence_for_quarantined_claim"
          : "evidence_for_unknown_claim"
    }));
  const quarantinedEvidenceIds = new Set(quarantinedEvidence.map((item) => item.evidenceId));
  const scopedClaims = claims.filter((claim) => !blockedClaimIds.has(claim.id));
  const scopedClaimIds = new Set(scopedClaims.map((claim) => claim.id));
  const scopedEvidence = evidence.filter((item) => {
    if (quarantinedEvidenceIds.has(item.id)) {
      return false;
    }

    return !item.claimId || scopedClaimIds.has(item.claimId);
  });
  const isolationState = quarantinedClaims.length > 0 || quarantinedEvidence.length > 0
    ? "quarantined"
    : accessBoundary.ready
      ? "clear"
      : "permission-blocked";

  return {
    contractVersion: "contradiction-check.tenant-isolation.v1",
    isolationState,
    enforcementMode: accessBoundary.canOverrideBoundary ? "override-audited" : "strict-quarantine",
    tenantId: accessBoundary.tenantId,
    workspaceId: accessBoundary.workspaceId,
    actorId: accessBoundary.actorId,
    sourceCounts: {
      claims: claims.length,
      evidence: evidence.length
    },
    scopedCounts: {
      claims: scopedClaims.length,
      evidence: scopedEvidence.length,
      quarantinedClaims: quarantinedClaims.length,
      quarantinedEvidence: quarantinedEvidence.length
    },
    scopedClaims,
    scopedEvidence,
    quarantinedResources: {
      claims: quarantinedClaims,
      evidence: quarantinedEvidence
    },
    auditHandoff: {
      route: "verifier-claim-gate/contradiction-check/access-boundary",
      required: isolationState !== "clear",
      reasonCodes: uniqueReasonCodes(
        accessBoundary.validationErrors.map((error) => error.code),
        quarantinedClaims.map((item) => item.reasonCode),
        quarantinedEvidence.map((item) => item.reasonCode)
      )
    }
  };
}

function normalizeProviderContract(input) {
  const provider = asRecord(input.provider || input.integrationProvider || input.serviceProvider);
  const service = asRecord(provider.service || input.providerService);
  const sync = asRecord(provider.sync || provider.syncMetadata || input.syncMetadata);
  const handoff = asRecord(provider.handoff || provider.externalHandoff || input.externalHandoff);
  const requestedCapabilities = normalizeCapabilityList(
    provider.requestedCapabilities || provider.requiredCapabilities || input.requestedCapabilities
  );
  const offeredCapabilities = normalizeCapabilityList(
    provider.capabilities || provider.offeredCapabilities || service.capabilities
  );
  const requiredCapabilities = requestedCapabilities.length > 0
    ? requestedCapabilities
    : REQUIRED_PROVIDER_CAPABILITIES;
  const missingCapabilities = requiredCapabilities.filter((capability) => !offeredCapabilities.includes(capability));
  const extraCapabilities = offeredCapabilities.filter((capability) => OPTIONAL_PROVIDER_CAPABILITIES.includes(capability));
  const handoffMode = asText(handoff.mode || provider.handoffMode || service.handoffMode || "inline").toLowerCase();
  const syncAgeMsRaw = Number(sync.ageMs ?? provider.syncAgeMs);
  const syncAgeMs = Number.isFinite(syncAgeMsRaw) && syncAgeMsRaw >= 0 ? Math.floor(syncAgeMsRaw) : null;
  const healthyStates = new Set(["ready", "online", "healthy", "available"]);
  const status = asText(provider.status || service.status || "ready").toLowerCase();
  const acceptedHandoffMode = SUPPORTED_HANDOFF_MODES.has(handoffMode);
  const staleSync = syncAgeMs !== null && syncAgeMs > MAX_SYNC_AGE_MS;
  const validationErrors = [];

  if (missingCapabilities.length > 0) {
    validationErrors.push({
      code: "provider_missing_capability",
      message: "Integration provider does not offer required contradiction-check capabilities.",
      missingCapabilities
    });
  }

  if (!acceptedHandoffMode) {
    validationErrors.push({
      code: "unsupported_provider_handoff_mode",
      message: "Provider handoff mode must be inline, external, or hybrid.",
      handoffMode
    });
  }

  if (staleSync) {
    validationErrors.push({
      code: "provider_sync_stale",
      message: "Provider sync metadata is older than the contradiction-check freshness budget.",
      maxSyncAgeMs: MAX_SYNC_AGE_MS,
      syncAgeMs
    });
  }

  return {
    providerId: asText(provider.id || provider.providerId || service.providerId) || "hosted-kernel",
    serviceName: asText(service.name || provider.serviceName || provider.name) || "verifier-claim-gate",
    contractVersion: asText(provider.contractVersion || service.contractVersion) || "contradiction-check.provider.v1",
    status,
    ready: healthyStates.has(status) && validationErrors.length === 0,
    endpointRoute: asText(service.route || service.endpointRoute || provider.endpointRoute) || "verifier-claim-gate/contradiction-check/provider",
    capabilities: {
      required: requiredCapabilities,
      offered: offeredCapabilities,
      optionalAccepted: extraCapabilities,
      missing: missingCapabilities
    },
    sync: {
      cursor: asText(sync.cursor || sync.syncCursor || provider.cursor),
      sourceRevision: asText(sync.sourceRevision || sync.revision || provider.sourceRevision),
      receivedAt: asText(sync.receivedAt || sync.syncedAt || provider.syncedAt),
      ageMs: syncAgeMs,
      stale: staleSync
    },
    externalHandoff: {
      mode: acceptedHandoffMode ? handoffMode : "inline",
      requestedMode: handoffMode,
      ticketId: asText(handoff.ticketId || handoff.externalId || provider.externalTicketId),
      route: asText(handoff.route || handoff.endpointRoute) || "verifier-claim-gate/external-resolution",
      state: asText(handoff.state || handoff.status) || "not-started",
      owner: asText(handoff.owner || handoff.assignee || handoff.providerOwner)
    },
    validationErrors
  };
}

function asBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function parseTimestampMs(value) {
  const text = asText(value);
  if (!text) {
    return null;
  }

  const timestampMs = Date.parse(text);
  return Number.isFinite(timestampMs) ? timestampMs : NaN;
}

function normalizeLifecycleCommand(rawCommand) {
  const command = asRecord(rawCommand);
  const type = asText(command.type || command.command || command.action).toLowerCase();
  const accepted = SUPPORTED_LIFECYCLE_COMMANDS.has(type);

  return {
    id: asText(command.id || command.commandId) || (accepted ? `${type}-command` : "unknown-command"),
    idempotencyKey: asText(command.idempotencyKey || command.dedupeKey || command.commandKey || command.id || command.commandId),
    type,
    accepted,
    requestedBy: asText(command.requestedBy || command.actor || command.source) || "unknown-client",
    reason: asText(command.reason || command.note),
    effectiveAt: asText(command.effectiveAt || command.scheduledFor || command.at)
  };
}

function normalizeLifecycleControls(input, now) {
  const lifecycle = asRecord(input.lifecycle || input.lifecycleControls);
  const settings = asRecord(input.settings || lifecycle.settings || input.contradictionCheckSettings);
  const schedule = asRecord(settings.schedule || lifecycle.schedule || input.schedule);
  const command = normalizeLifecycleCommand(lifecycle.command || input.command || settings.command);
  const scheduleMode = asText(schedule.mode || settings.scheduleMode || "manual").toLowerCase();
  const scheduleIntervalMs = asPositiveInteger(schedule.intervalMs || settings.intervalMs, 0);
  const nowMs = parseTimestampMs(now);
  const commandEffectiveAtMs = parseTimestampMs(command.effectiveAt);
  const commandTimestampInvalid = Number.isNaN(commandEffectiveAtMs);
  const commandPending = command.accepted &&
    command.effectiveAt &&
    !commandTimestampInvalid &&
    Number.isFinite(nowMs) &&
    commandEffectiveAtMs > nowMs;
  const commandAppliesNow = command.accepted && !commandPending && !commandTimestampInvalid;
  const baseEnabled = asBoolean(settings.enabled ?? lifecycle.enabled, true);
  const basePaused = asBoolean(settings.paused ?? lifecycle.paused, false);
  const enabled = commandAppliesNow && command.type === "enable"
    ? true
    : commandAppliesNow && command.type === "disable"
      ? false
      : baseEnabled;
  const paused = commandAppliesNow && command.type === "pause"
    ? true
    : commandAppliesNow && command.type === "resume"
      ? false
      : basePaused;
  const lastRunAt = asText(schedule.lastRunAt || settings.lastRunAt);
  const requestedNextRunAt = asText(schedule.nextRunAt || settings.nextRunAt);
  const lastRunAtMs = parseTimestampMs(lastRunAt);
  const requestedNextRunAtMs = parseTimestampMs(requestedNextRunAt);
  const computedIntervalNextRunAtMs = scheduleMode === "interval" &&
    scheduleIntervalMs >= MIN_SCHEDULE_INTERVAL_MS &&
    Number.isFinite(lastRunAtMs)
    ? lastRunAtMs + scheduleIntervalMs
    : null;
  const effectiveNextRunAtMs = Number.isFinite(requestedNextRunAtMs)
    ? requestedNextRunAtMs
    : computedIntervalNextRunAtMs;
  const effectiveNextRunAt = Number.isFinite(effectiveNextRunAtMs)
    ? new Date(effectiveNextRunAtMs).toISOString()
    : requestedNextRunAt;
  const evidenceCursor = asText(schedule.evidenceCursor || lifecycle.evidenceCursor || input.evidenceCursor);
  const processedEvidenceCursor = asText(
    schedule.processedEvidenceCursor ||
    schedule.lastProcessedEvidenceCursor ||
    lifecycle.processedEvidenceCursor ||
    input.processedEvidenceCursor
  );
  const evidenceChanged = Boolean(evidenceCursor && evidenceCursor !== processedEvidenceCursor);
  const intervalDue = scheduleMode === "interval" &&
    Number.isFinite(effectiveNextRunAtMs) &&
    Number.isFinite(nowMs) &&
    effectiveNextRunAtMs <= nowMs;
  const runNowRequested = commandAppliesNow && command.type === "run-now";
  const scheduleCommandRequested = commandAppliesNow && command.type === "schedule";
  const runnableByCommand = runNowRequested || scheduleCommandRequested;
  const runnableBySchedule = intervalDue || (scheduleMode === "on-evidence-change" && evidenceChanged);
  const executionSuppressed = !enabled || paused;
  const validationErrors = [];

  if (command.type && !command.accepted) {
    validationErrors.push({
      code: "unsupported_lifecycle_command",
      message: "Lifecycle command is not supported by contradiction-check.",
      command: command.type
    });
  }

  if (commandTimestampInvalid) {
    validationErrors.push({
      code: "lifecycle_command_effective_at_invalid",
      message: "Lifecycle command effectiveAt must be a valid timestamp.",
      commandId: command.id,
      effectiveAt: command.effectiveAt
    });
  }

  if ((command.type === "disable" || command.type === "pause") && !command.reason) {
    validationErrors.push({
      code: "lifecycle_command_reason_required",
      message: "Disable and pause commands require an audit reason.",
      command: command.type,
      commandId: command.id
    });
  }

  if (!SUPPORTED_SCHEDULE_MODES.has(scheduleMode)) {
    validationErrors.push({
      code: "unsupported_schedule_mode",
      message: "Schedule mode must be manual, interval, or on-evidence-change.",
      scheduleMode
    });
  }

  if (scheduleMode === "interval" && scheduleIntervalMs < MIN_SCHEDULE_INTERVAL_MS) {
    validationErrors.push({
      code: "schedule_interval_too_short",
      message: "Interval schedules must be at least one minute.",
      minIntervalMs: MIN_SCHEDULE_INTERVAL_MS,
      intervalMs: scheduleIntervalMs
    });
  }

  if (scheduleMode === "interval" && scheduleIntervalMs > MAX_SCHEDULE_INTERVAL_MS) {
    validationErrors.push({
      code: "schedule_interval_too_long",
      message: "Interval schedules must not exceed one day.",
      maxIntervalMs: MAX_SCHEDULE_INTERVAL_MS,
      intervalMs: scheduleIntervalMs
    });
  }

  if (lastRunAt && Number.isNaN(lastRunAtMs)) {
    validationErrors.push({
      code: "schedule_last_run_at_invalid",
      message: "Schedule lastRunAt must be a valid timestamp.",
      lastRunAt
    });
  }

  if (requestedNextRunAt && Number.isNaN(requestedNextRunAtMs)) {
    validationErrors.push({
      code: "schedule_next_run_at_invalid",
      message: "Schedule nextRunAt must be a valid timestamp.",
      nextRunAt: requestedNextRunAt
    });
  }

  if (command.type === "schedule" && scheduleMode === "manual") {
    validationErrors.push({
      code: "schedule_command_requires_automated_mode",
      message: "Schedule lifecycle commands require interval or on-evidence-change mode.",
      commandId: command.id
    });
  }

  if (runNowRequested && executionSuppressed) {
    validationErrors.push({
      code: enabled ? "run_now_blocked_while_paused" : "run_now_blocked_while_disabled",
      message: "Run-now commands cannot execute while contradiction-check is disabled or paused.",
      commandId: command.id
    });
  }

  const nextRunDue = !executionSuppressed && validationErrors.length === 0 && (runnableByCommand || runnableBySchedule);
  const runState = executionSuppressed
    ? "suppressed"
    : validationErrors.length > 0
      ? "invalid"
      : commandPending
        ? "command-pending"
        : nextRunDue
          ? "due"
          : scheduleMode === "manual"
            ? "manual"
            : "scheduled";
  const triggerReasonCodes = [
    runNowRequested ? "command_run_now" : "",
    scheduleCommandRequested ? "command_schedule" : "",
    intervalDue ? "interval_due" : "",
    scheduleMode === "on-evidence-change" && evidenceChanged ? "evidence_changed" : "",
    commandPending ? "command_pending_effective_at" : "",
    !enabled ? "lifecycle_disabled" : "",
    paused ? "lifecycle_paused" : ""
  ].filter(Boolean);

  return {
    enabled,
    paused,
    command: {
      ...command,
      appliesNow: commandAppliesNow,
      pending: commandPending,
      effectiveAtMs: Number.isFinite(commandEffectiveAtMs) ? commandEffectiveAtMs : null,
      disposition: !command.type
        ? "none"
        : !command.accepted || commandTimestampInvalid
          ? "rejected"
          : commandPending
            ? "pending"
            : "applied"
    },
    controls: {
      baseEnabled,
      basePaused,
      executionSuppressed,
      manualRunAllowed: asBoolean(settings.manualRunAllowed ?? lifecycle.manualRunAllowed, true),
      proofExportWhilePausedAllowed: false
    },
    schedule: {
      mode: SUPPORTED_SCHEDULE_MODES.has(scheduleMode) ? scheduleMode : "manual",
      requestedMode: scheduleMode,
      intervalMs: scheduleIntervalMs || null,
      nextRunAt: effectiveNextRunAt || null,
      requestedNextRunAt: requestedNextRunAt || null,
      computedNextRunAt: computedIntervalNextRunAtMs ? new Date(computedIntervalNextRunAtMs).toISOString() : null,
      lastRunAt,
      timezone: asText(schedule.timezone || settings.timezone) || "UTC",
      due: nextRunDue,
      overdueMs: intervalDue && Number.isFinite(nowMs) ? Math.max(0, nowMs - effectiveNextRunAtMs) : 0,
      runState,
      triggerReasonCodes,
      evidenceCursor: evidenceCursor || null,
      processedEvidenceCursor: processedEvidenceCursor || null,
      evidenceChanged
    },
    validationErrors,
    settingsVersion: asText(settings.version || lifecycle.settingsVersion) || "contradiction-check.lifecycle.v1"
  };
}

function buildNextAction({ handoff, operationalHealth, lifecycleControls }) {
  if (!lifecycleControls.enabled) {
    return {
      type: "disabled",
      label: "Enable contradiction-check",
      route: "verifier-claim-gate/contradiction-check/settings",
      runnable: false,
      reasonCodes: ["lifecycle_disabled"]
    };
  }

  if (lifecycleControls.paused) {
    return {
      type: "paused",
      label: "Resume contradiction-check",
      route: "verifier-claim-gate/contradiction-check/settings",
      runnable: false,
      reasonCodes: ["lifecycle_paused"]
    };
  }

  if (lifecycleControls.validationErrors.length > 0) {
    return {
      type: "settings_repair",
      label: "Repair lifecycle settings",
      route: "verifier-claim-gate/contradiction-check/settings",
      runnable: false,
      reasonCodes: lifecycleControls.validationErrors.map((error) => error.code)
    };
  }

  if (operationalHealth.state === "failed") {
    return {
      type: "repair_input",
      label: "Repair contradiction-check input",
      route: handoff.route,
      runnable: operationalHealth.retryable,
      retryAfterMs: operationalHealth.retryAfterMs,
      reasonCodes: operationalHealth.failureState.reasonCodes
    };
  }

  if (handoff.blocked) {
    return {
      type: "resolve_contradiction",
      label: "Resolve blocking contradiction",
      route: handoff.route,
      runnable: true,
      contradictionIds: handoff.blockingContradictionIds
    };
  }

  if (lifecycleControls.command.type === "run-now") {
    return {
      type: "proof_export",
      label: "Export proof now",
      route: "verifier-claim-gate/proof-export",
      runnable: operationalHealth.state === "healthy"
    };
  }

  if (lifecycleControls.schedule.due) {
    return {
      type: lifecycleControls.schedule.mode === "interval" ? "scheduled_run_due" : "evidence_change_run_due",
      label: lifecycleControls.schedule.mode === "interval" ? "Run scheduled contradiction-check" : "Run contradiction-check for new evidence",
      route: "verifier-claim-gate/contradiction-check/run",
      runnable: operationalHealth.state === "healthy",
      nextRunAt: lifecycleControls.schedule.nextRunAt || null,
      overdueMs: lifecycleControls.schedule.overdueMs,
      reasonCodes: lifecycleControls.schedule.triggerReasonCodes
    };
  }

  if (lifecycleControls.command.pending) {
    return {
      type: "lifecycle_command_pending",
      label: "Await lifecycle command effective time",
      route: "verifier-claim-gate/contradiction-check/settings",
      runnable: false,
      effectiveAt: lifecycleControls.command.effectiveAt || null,
      reasonCodes: lifecycleControls.schedule.triggerReasonCodes
    };
  }

  return {
    type: lifecycleControls.schedule.mode === "manual" ? "await_manual_run" : "await_schedule",
    label: lifecycleControls.schedule.mode === "manual" ? "Await manual contradiction-check run" : "Await scheduled contradiction-check run",
    route: "verifier-claim-gate/contradiction-check",
    runnable: lifecycleControls.schedule.mode === "manual" && lifecycleControls.controls.manualRunAllowed,
    nextRunAt: lifecycleControls.schedule.nextRunAt || null,
    runState: lifecycleControls.schedule.runState,
    reasonCodes: lifecycleControls.schedule.triggerReasonCodes
  };
}

function normalizeHistorySnapshot(rawSnapshot, index) {
  const snapshot = asRecord(rawSnapshot);
  const audit = asRecord(snapshot.audit);
  const handoff = asRecord(snapshot.handoff);
  const operationalHealth = asRecord(snapshot.operationalHealth || snapshot.health);
  const contradictionCountRaw = Number(snapshot.contradictionCount ?? audit.contradictionCount ?? 0);
  const blocked = Boolean(snapshot.blocked ?? handoff.blocked);
  const healthState = asText(snapshot.healthState || audit.healthState || operationalHealth.state) || "unknown";

  return {
    id: asText(snapshot.id || snapshot.snapshotId) || `history-${index + 1}`,
    generatedAt: asText(snapshot.generatedAt || snapshot.createdAt || snapshot.timestamp),
    requestId: asText(snapshot.requestId || asRecord(snapshot.request).id),
    workflowId: asText(snapshot.workflowId || asRecord(snapshot.clientState).workflowId),
    blocked,
    healthState,
    contradictionCount: Number.isFinite(contradictionCountRaw) && contradictionCountRaw > 0
      ? Math.floor(contradictionCountRaw)
      : 0,
    healthIssueCodes: asList(snapshot.healthIssueCodes || audit.healthIssueCodes)
      .map(asText)
      .filter(Boolean)
  };
}

function normalizeHistorySnapshots(input) {
  return asList(input.history || input.historySnapshots || input.priorSnapshots)
    .slice(-MAX_HISTORY_SNAPSHOTS)
    .map(normalizeHistorySnapshot);
}

function normalizePersistedCommandReceipt(rawReceipt, index) {
  const receipt = asRecord(rawReceipt);

  return {
    idempotencyKey: asText(receipt.idempotencyKey || receipt.commandId || receipt.id) || `persisted-command-${index + 1}`,
    commandId: asText(receipt.commandId || receipt.id),
    commandType: asText(receipt.commandType || receipt.type || receipt.command).toLowerCase(),
    requestId: asText(receipt.requestId || asRecord(receipt.request).id),
    workflowId: asText(receipt.workflowId || asRecord(receipt.clientState).workflowId),
    status: asText(receipt.status || receipt.state) || "accepted",
    appliedAt: asText(receipt.appliedAt || receipt.createdAt || receipt.timestamp),
    resultCursor: asText(receipt.resultCursor || receipt.cursor || receipt.checkpointCursor)
  };
}

function normalizeRecoveryLease(rawLease, request, now) {
  const lease = asRecord(rawLease);
  const acquiredAt = asText(lease.acquiredAt || lease.createdAt || lease.timestamp);
  const expiresAt = asText(lease.expiresAt || lease.expiry || lease.ttlUntil);
  const acquiredAtMs = parseTimestampMs(acquiredAt);
  const expiresAtMs = parseTimestampMs(expiresAt);
  const nowMs = parseTimestampMs(now);
  const epoch = asPositiveInteger(lease.epoch || lease.fence || lease.fencingToken, 0);
  const owner = asText(lease.owner || lease.ownerId || lease.workerId || lease.actor);
  const token = asText(lease.token || lease.leaseToken || lease.id);
  const acquiredAgeMs = Number.isFinite(acquiredAtMs) && Number.isFinite(nowMs)
    ? Math.max(0, nowMs - acquiredAtMs)
    : null;
  const expiresInMs = Number.isFinite(expiresAtMs) && Number.isFinite(nowMs)
    ? expiresAtMs - nowMs
    : null;
  const expiredByExpiry = expiresInMs !== null && expiresInMs <= 0;
  const expiredByAge = acquiredAgeMs !== null && acquiredAgeMs > MAX_RECOVERY_LEASE_AGE_MS;
  const held = Boolean(owner || token || epoch);
  const ownedByRequest = held && (owner === request.actor || owner === request.id || token === request.id);
  const active = held && !expiredByExpiry && !expiredByAge;

  return {
    contractVersion: "contradiction-check.recovery-lease.v1",
    held,
    active,
    owner: owner || null,
    token: token || null,
    epoch,
    ownedByRequest,
    acquiredAt: acquiredAt || null,
    expiresAt: expiresAt || null,
    acquiredAgeMs,
    expiresInMs,
    maxLeaseAgeMs: MAX_RECOVERY_LEASE_AGE_MS,
    stale: held && !active,
    invalidTimestamps: [
      acquiredAt && Number.isNaN(acquiredAtMs) ? "acquiredAt" : "",
      expiresAt && Number.isNaN(expiresAtMs) ? "expiresAt" : ""
    ].filter(Boolean)
  };
}

function buildPersistenceWritePlan({ request, clientState, lifecycleControls, checkpoint, commandLedger, recoveryLease, restartSafeStatus, recoveryPaths, now }) {
  const command = lifecycleControls.command;
  const shouldAppendReceipt = command.accepted &&
    commandLedger.disposition === "accepted-new" &&
    !command.pending &&
    command.disposition === "applied";
  const shouldAcquireLease = recoveryPaths.some((path) => path.type === "acquire_recovery_lease");
  const shouldReleaseLease = recoveryLease.ownedByRequest &&
    ["restored", "fresh", "idempotent-replay"].includes(restartSafeStatus);
  const shouldAdvanceCheckpoint = lifecycleControls.schedule.due || command.type === "run-now";
  const operations = [];

  if (shouldAcquireLease) {
    operations.push({
      type: recoveryLease.held ? "steal_recovery_lease" : "create_recovery_lease",
      path: "persistedState.recoveryLease",
      compare: {
        token: recoveryLease.token,
        epoch: recoveryLease.epoch,
        stale: recoveryLease.stale
      },
      value: {
        owner: request.actor,
        token: `${request.id}:${clientState.workflowId}:recovery`,
        epoch: recoveryLease.epoch + 1,
        acquiredAt: now,
        maxLeaseAgeMs: MAX_RECOVERY_LEASE_AGE_MS
      }
    });
  }

  if (shouldAppendReceipt) {
    operations.push({
      type: "append_command_receipt",
      path: "persistedState.commandReceipts",
      idempotencyKey: commandLedger.activeIdempotencyKey,
      value: {
        idempotencyKey: commandLedger.activeIdempotencyKey,
        commandId: command.id,
        commandType: command.type,
        requestId: request.id,
        workflowId: clientState.workflowId,
        status: command.disposition,
        appliedAt: now,
        resultCursor: lifecycleControls.schedule.evidenceCursor || checkpoint.cursor
      },
      retentionLimit: MAX_PERSISTED_COMMAND_RECEIPTS
    });
  }

  if (shouldAdvanceCheckpoint) {
    operations.push({
      type: "upsert_checkpoint",
      path: "persistedState.checkpoint",
      compare: {
        workflowId: clientState.workflowId,
        cursor: checkpoint.cursor,
        revision: checkpoint.revision
      },
      value: {
        requestId: request.id,
        sessionId: clientState.sessionId,
        workflowId: clientState.workflowId,
        status: lifecycleControls.schedule.due ? "queued" : "completed",
        cursor: lifecycleControls.schedule.evidenceCursor || checkpoint.cursor,
        revision: `${request.id}:${clientState.workflowId}:${now}`,
        updatedAt: now
      }
    });
  }

  if (shouldReleaseLease) {
    operations.push({
      type: "release_recovery_lease",
      path: "persistedState.recoveryLease",
      compare: {
        token: recoveryLease.token,
        owner: recoveryLease.owner,
        epoch: recoveryLease.epoch
      },
      value: null
    });
  }

  return {
    contractVersion: "contradiction-check.persistence-write-plan.v1",
    required: operations.length > 0,
    mode: operations.length > 0 ? "compare-and-swap" : "read-only",
    restartSafeStatus,
    operationCount: operations.length,
    operations
  };
}

function normalizePersistedState(input, request, clientState, lifecycleControls, now) {
  const persisted = asRecord(input.persistedState || input.stateStore || input.persistence);
  const checkpoint = asRecord(persisted.checkpoint || persisted.lastCheckpoint || input.checkpoint);
  const recoveryLease = normalizeRecoveryLease(
    persisted.recoveryLease || persisted.lease || checkpoint.recoveryLease || input.recoveryLease,
    request,
    now
  );
  const rawReceipts = asList(persisted.commandReceipts || persisted.commands || input.commandReceipts)
    .slice(-MAX_PERSISTED_COMMAND_RECEIPTS);
  const commandReceipts = rawReceipts.map(normalizePersistedCommandReceipt);
  const activeCommand = lifecycleControls.command.accepted ? lifecycleControls.command : null;
  const activeIdempotencyKey = activeCommand
    ? asText(activeCommand.idempotencyKey || activeCommand.id || lifecycleControls.command.id)
    : "";
  const matchingReceipt = activeCommand
    ? commandReceipts.find((receipt) => {
      return receipt.idempotencyKey === activeIdempotencyKey ||
        (receipt.commandId && receipt.commandId === activeCommand.id);
    })
    : null;
  const conflictingReceipt = matchingReceipt && matchingReceipt.commandType && matchingReceipt.commandType !== activeCommand.type;
  const checkpointWorkflowId = asText(checkpoint.workflowId || asRecord(checkpoint.clientState).workflowId);
  const checkpointSessionId = asText(checkpoint.sessionId || asRecord(checkpoint.clientState).sessionId);
  const checkpointRequestId = asText(checkpoint.requestId || asRecord(checkpoint.request).id);
  const checkpointStatus = asText(checkpoint.status || checkpoint.runStatus || checkpoint.state).toLowerCase();
  const checkpointCursor = asText(checkpoint.cursor || checkpoint.checkpointCursor || persisted.cursor);
  const checkpointRevision = asText(checkpoint.revision || checkpoint.version || persisted.revision);
  const checkpointUpdatedAt = asText(checkpoint.generatedAt || checkpoint.updatedAt || checkpoint.timestamp);
  const checkpointUpdatedAtMs = parseTimestampMs(checkpointUpdatedAt);
  const checkpointStatusAccepted = !checkpointStatus || SUPPORTED_PERSISTED_CHECKPOINT_STATUSES.has(checkpointStatus);
  const inFlight = checkpointStatus === "running" || checkpointStatus === "in-flight" || checkpointStatus === "recovering";
  const workflowMismatch = checkpointWorkflowId && checkpointWorkflowId !== clientState.workflowId;
  const sessionMismatch = checkpointSessionId && checkpointSessionId !== clientState.sessionId;
  const validationErrors = [];

  if (!checkpointStatusAccepted) {
    validationErrors.push({
      code: "persisted_checkpoint_status_unsupported",
      message: "Persisted contradiction-check checkpoint status is not supported.",
      checkpointStatus,
      supportedStatuses: [...SUPPORTED_PERSISTED_CHECKPOINT_STATUSES]
    });
  }

  if (checkpointUpdatedAt && Number.isNaN(checkpointUpdatedAtMs)) {
    validationErrors.push({
      code: "persisted_checkpoint_timestamp_invalid",
      message: "Persisted contradiction-check checkpoint timestamp must be valid before recovery.",
      checkpointUpdatedAt
    });
  }

  if (workflowMismatch) {
    validationErrors.push({
      code: "persisted_workflow_mismatch",
      message: "Persisted contradiction-check checkpoint belongs to a different workflow.",
      expectedWorkflowId: clientState.workflowId,
      actualWorkflowId: checkpointWorkflowId
    });
  }

  if (conflictingReceipt) {
    validationErrors.push({
      code: "idempotency_key_command_conflict",
      message: "Persisted command receipt reuses an idempotency key for a different lifecycle command.",
      idempotencyKey: matchingReceipt.idempotencyKey,
      previousCommandType: matchingReceipt.commandType,
      requestedCommandType: activeCommand.type
    });
  }

  if (recoveryLease.invalidTimestamps.length > 0) {
    validationErrors.push({
      code: "persisted_recovery_lease_timestamp_invalid",
      message: "Persisted recovery lease timestamps must be valid before restart-safe recovery.",
      invalidFields: recoveryLease.invalidTimestamps
    });
  }

  if (inFlight && recoveryLease.active && !recoveryLease.ownedByRequest) {
    validationErrors.push({
      code: "persisted_recovery_lease_active",
      message: "Persisted contradiction-check checkpoint is already owned by an active recovery lease.",
      leaseOwner: recoveryLease.owner,
      leaseEpoch: recoveryLease.epoch,
      expiresAt: recoveryLease.expiresAt
    });
  }

  const commandDisposition = !activeCommand
    ? "none"
    : conflictingReceipt
      ? "rejected-conflict"
      : matchingReceipt
        ? "replayed"
        : "accepted-new";
  const recoveryPaths = [];

  if (workflowMismatch) {
    recoveryPaths.push({
      type: "discard_checkpoint",
      route: "verifier-claim-gate/contradiction-check/recover",
      required: true,
      reasonCode: "persisted_workflow_mismatch"
    });
  }

  if (inFlight && !workflowMismatch) {
    recoveryPaths.push({
      type: "resume_in_flight_run",
      route: "verifier-claim-gate/contradiction-check/recover",
      required: true,
      reasonCode: "checkpoint_in_flight",
      checkpointCursor: checkpointCursor || null
    });

    if (!recoveryLease.active || recoveryLease.stale) {
      recoveryPaths.push({
        type: "acquire_recovery_lease",
        route: "verifier-claim-gate/contradiction-check/recover",
        required: true,
        reasonCode: recoveryLease.stale ? "recovery_lease_stale" : "recovery_lease_missing",
        previousLeaseToken: recoveryLease.token
      });
    }
  }

  if (commandDisposition === "replayed") {
    recoveryPaths.push({
      type: "reuse_command_receipt",
      route: "verifier-claim-gate/contradiction-check/commands",
      required: false,
      reasonCode: "idempotent_command_replay",
      idempotencyKey: matchingReceipt.idempotencyKey
    });
  }

  if (sessionMismatch && !workflowMismatch) {
    recoveryPaths.push({
      type: "restore_session_projection",
      route: "verifier-claim-gate/contradiction-check/state",
      required: false,
      reasonCode: "persisted_session_changed"
    });
  }

  const restartSafeStatus = validationErrors.length > 0
    ? "blocked"
    : inFlight
      ? "recovering"
      : commandDisposition === "replayed"
        ? "idempotent-replay"
        : checkpointCursor || checkpointRevision
      ? "restored"
      : "fresh";
  const checkpointProjection = {
    requestId: checkpointRequestId || null,
    sessionId: checkpointSessionId || null,
    workflowId: checkpointWorkflowId || null,
    status: checkpointStatus || "none",
    cursor: checkpointCursor || null,
    revision: checkpointRevision || null,
    generatedAt: checkpointUpdatedAt || null,
    inFlight
  };
  const commandLedger = {
    retainedReceiptCount: commandReceipts.length,
    maxRetainedReceipts: MAX_PERSISTED_COMMAND_RECEIPTS,
    activeCommandId: activeCommand?.id || null,
    activeCommandType: activeCommand?.type || "none",
    activeIdempotencyKey: activeIdempotencyKey || null,
    disposition: commandDisposition,
    replayedReceipt: matchingReceipt || null,
    receipts: commandReceipts
  };
  const writePlan = buildPersistenceWritePlan({
    request,
    clientState,
    lifecycleControls,
    checkpoint: checkpointProjection,
    commandLedger,
    recoveryLease,
    restartSafeStatus,
    recoveryPaths,
    now
  });

  return {
    contractVersion: "contradiction-check.persistence.v1",
    requestId: request.id,
    sessionId: clientState.sessionId,
    workflowId: clientState.workflowId,
    checkpoint: checkpointProjection,
    recoveryLease,
    commandLedger,
    writePlan,
    restartSafeStatus,
    ready: validationErrors.length === 0 && !writePlan.operations.some((operation) => operation.type === "steal_recovery_lease"),
    recoveredFromCheckpoint: Boolean((checkpointCursor || checkpointRevision) && !workflowMismatch),
    recoveryRequired: recoveryPaths.some((path) => path.required),
    recoveryPaths,
    validationErrors
  };
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    if (key) {
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, {});
}

function buildAnalytics({ claims, evidence, contradictions, claimResolutionPackets, missingEvidenceClaimIds, operationalHealth, handoff, historySnapshots, lifecycleControls, providerContract, accessBoundary, tenantIsolation, clientRuntime, clientHandoffAdoption, persistedState, kernelExecutionHealth }) {
  const mappedContradictionCount = contradictions.filter((item) => item.mapped).length;
  const blockingContradictionCount = contradictions.filter((item) => handoff.blockingContradictionIds.includes(item.evidenceId)).length;
  const proofBackedContradictionCount = contradictions.filter((item) => item.proofRef).length;
  const supportEvidenceCount = evidence.filter((item) => item.verdict === "supports").length;
  const unknownEvidenceCount = evidence.filter((item) => item.verdict === "unknown" || !item.verdict).length;
  const previousBlockedCount = historySnapshots.filter((item) => item.blocked).length;
  const previousContradictionTotal = historySnapshots.reduce((sum, item) => sum + item.contradictionCount, 0);

  return {
    counters: {
      claims: claims.length,
      verificationRequiredClaims: claims.filter((claim) => claim.requiresVerification).length,
      evidence: evidence.length,
      supportEvidence: supportEvidenceCount,
      unknownEvidence: unknownEvidenceCount,
      contradictions: contradictions.length,
      mappedContradictions: mappedContradictionCount,
      unmappedContradictions: contradictions.length - mappedContradictionCount,
      blockingContradictions: blockingContradictionCount,
      proofBackedContradictions: proofBackedContradictionCount,
      missingEvidenceClaims: missingEvidenceClaimIds.length,
      healthIssues: operationalHealth.issues.length,
      lifecycleSettingsErrors: lifecycleControls.validationErrors.length,
      lifecycleEnabled: lifecycleControls.enabled ? 1 : 0,
      lifecyclePaused: lifecycleControls.paused ? 1 : 0,
      lifecycleCommandPending: lifecycleControls.command.pending ? 1 : 0,
      lifecycleCommandApplied: lifecycleControls.command.disposition === "applied" ? 1 : 0,
      scheduleRunDue: lifecycleControls.schedule.due ? 1 : 0,
      scheduleEvidenceChanged: lifecycleControls.schedule.evidenceChanged ? 1 : 0,
      providerReady: providerContract.ready ? 1 : 0,
      providerMissingCapabilities: providerContract.capabilities.missing.length,
      providerSyncStale: providerContract.sync.stale ? 1 : 0,
      accessBoundaryReady: accessBoundary.ready ? 1 : 0,
      missingGatePermissions: accessBoundary.permissions.missing.length,
      claimScopeViolations: accessBoundary.claimScopeViolations.length,
      evidenceScopeViolations: accessBoundary.evidenceScopeViolations.length,
      sourceClaimsBeforeIsolation: tenantIsolation.sourceCounts.claims,
      sourceEvidenceBeforeIsolation: tenantIsolation.sourceCounts.evidence,
      scopedClaimsAfterIsolation: tenantIsolation.scopedCounts.claims,
      scopedEvidenceAfterIsolation: tenantIsolation.scopedCounts.evidence,
      quarantinedClaims: tenantIsolation.scopedCounts.quarantinedClaims,
      quarantinedEvidence: tenantIsolation.scopedCounts.quarantinedEvidence,
      isolationAuditHandoffRequired: tenantIsolation.auditHandoff.required ? 1 : 0,
      clientRuntimeReady: clientRuntime.ready ? 1 : 0,
      clientRuntimeErrors: clientRuntime.validationErrors.length,
      clientRuntimeMissingCapabilities: clientRuntime.missingCapabilities.length,
      clientRouteNeedsReplace: clientRuntime.navigation.replace ? 1 : 0,
      clientHandoffAdoptionReady: clientHandoffAdoption.ready ? 1 : 0,
      clientHandoffRequiresMutation: clientHandoffAdoption.statePatch.required ? 1 : 0,
      clientHandoffAcknowledgements: clientHandoffAdoption.acknowledgement.requiredReasonCodes.length,
      clientHandoffStorageWrites: clientHandoffAdoption.storageWrites.length,
      clientHandoffValidationErrors: clientHandoffAdoption.validationErrors.length,
      persistedStateReady: persistedState.ready ? 1 : 0,
      persistedRecoveryRequired: persistedState.recoveryRequired ? 1 : 0,
      persistedCommandReceipts: persistedState.commandLedger.retainedReceiptCount,
      persistedCommandReplay: persistedState.commandLedger.disposition === "replayed" ? 1 : 0,
      persistedRecoveryLeaseActive: persistedState.recoveryLease.active ? 1 : 0,
      persistedRecoveryLeaseStale: persistedState.recoveryLease.stale ? 1 : 0,
      persistedWritePlanRequired: persistedState.writePlan.required ? 1 : 0,
      persistedWriteOperations: persistedState.writePlan.operationCount,
      kernelExecutionReady: kernelExecutionHealth.state === "healthy" ? 1 : 0,
      kernelExecutionErrors: kernelExecutionHealth.validationErrors.length,
      kernelQueueDepth: kernelExecutionHealth.queue.depth,
      kernelQueueSaturated: kernelExecutionHealth.queue.saturated ? 1 : 0,
      kernelLatencyBreached: kernelExecutionHealth.latency.breached ? 1 : 0,
      kernelDependenciesUnavailable: kernelExecutionHealth.dependencies.filter((dependency) => !dependency.ready).length,
      claimResolutionPackets: claimResolutionPackets.length,
      exportableClaimPackets: claimResolutionPackets.filter((packet) => packet.exportable).length,
      blockedClaimPackets: claimResolutionPackets.filter((packet) => packet.resolutionState === "blocked").length,
      packetsMissingProof: claimResolutionPackets.filter((packet) => packet.evidenceSummary.missingProofEvidenceIds.length > 0).length,
      historySnapshots: historySnapshots.length,
      historicalBlockedRuns: previousBlockedCount,
      historicalContradictions: previousContradictionTotal
    },
    severityCounts: countBy(contradictions, (item) => item.severity),
    verdictCounts: countBy(evidence, (item) => item.verdict || "unknown"),
    healthIssueCounts: countBy(operationalHealth.issues, (item) => item.code),
    lifecycleErrorCounts: countBy(lifecycleControls.validationErrors, (item) => item.code),
    lifecycleTriggerCounts: countBy(
      lifecycleControls.schedule.triggerReasonCodes.map((code) => ({ code })),
      (item) => item.code
    ),
    providerErrorCounts: countBy(providerContract.validationErrors, (item) => item.code),
    accessBoundaryErrorCounts: countBy(accessBoundary.validationErrors, (item) => item.code),
    tenantIsolationReasonCounts: countBy([
      ...tenantIsolation.quarantinedResources.claims,
      ...tenantIsolation.quarantinedResources.evidence
    ], (item) => item.reasonCode),
    clientRuntimeErrorCounts: countBy(clientRuntime.validationErrors, (item) => item.code),
    clientHandoffAdoptionErrorCounts: countBy(clientHandoffAdoption.validationErrors, (item) => item.code),
    clientHandoffMutationCounts: countBy(clientHandoffAdoption.statePatch.operations, (item) => item.type),
    persistedStateErrorCounts: countBy(persistedState.validationErrors, (item) => item.code),
    kernelExecutionErrorCounts: countBy(kernelExecutionHealth.validationErrors, (item) => item.code),
    claimResolutionStateCounts: countBy(claimResolutionPackets, (item) => item.resolutionState),
    rates: {
      contradictionPerClaim: claims.length ? Number((contradictions.length / claims.length).toFixed(4)) : 0,
      proofCoverage: contradictions.length ? Number((proofBackedContradictionCount / contradictions.length).toFixed(4)) : 1,
      mappedContradictionCoverage: contradictions.length ? Number((mappedContradictionCount / contradictions.length).toFixed(4)) : 1,
      historicalBlockRate: historySnapshots.length ? Number((previousBlockedCount / historySnapshots.length).toFixed(4)) : 0
    }
  };
}

function buildTimeline({ now, request, clientState, contradictions, operationalHealth, handoff, historySnapshots, lifecycleControls, providerContract, accessBoundary, tenantIsolation, nextAction, clientRuntime, clientHandoffAdoption, persistedState, kernelExecutionHealth }) {
  const priorEvents = historySnapshots.map((snapshot) => ({
    type: "history_snapshot",
    at: snapshot.generatedAt || "unknown-time",
    requestId: snapshot.requestId || "unknown-request",
    workflowId: snapshot.workflowId || clientState.workflowId,
    status: snapshot.blocked ? "blocked" : snapshot.healthState,
    contradictionCount: snapshot.contradictionCount,
    healthIssueCodes: snapshot.healthIssueCodes
  }));

  return [
    ...priorEvents,
    {
      type: "contradiction_check_evaluated",
      at: now,
      requestId: request.id,
      workflowId: clientState.workflowId,
      status: operationalHealth.state,
      contradictionCount: contradictions.length,
      blockingContradictionIds: handoff.blockingContradictionIds
    },
    {
      type: "lifecycle_controls_evaluated",
      at: now,
      requestId: request.id,
      workflowId: clientState.workflowId,
      enabled: lifecycleControls.enabled,
      paused: lifecycleControls.paused,
      command: lifecycleControls.command.type || "none",
      commandDisposition: lifecycleControls.command.disposition,
      scheduleMode: lifecycleControls.schedule.mode,
      scheduleRunState: lifecycleControls.schedule.runState,
      scheduleDue: lifecycleControls.schedule.due,
      scheduleTriggerReasonCodes: lifecycleControls.schedule.triggerReasonCodes,
      validationErrorCodes: lifecycleControls.validationErrors.map((error) => error.code)
    },
    {
      type: "provider_contract_negotiated",
      at: now,
      requestId: request.id,
      workflowId: clientState.workflowId,
      providerId: providerContract.providerId,
      ready: providerContract.ready,
      handoffMode: providerContract.externalHandoff.mode,
      missingCapabilities: providerContract.capabilities.missing,
      syncCursor: providerContract.sync.cursor || null
    },
    {
      type: "access_boundary_evaluated",
      at: now,
      requestId: request.id,
      workflowId: clientState.workflowId,
      actorId: accessBoundary.actorId,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      ready: accessBoundary.ready,
      missingPermissions: accessBoundary.permissions.missing,
      claimScopeViolationCount: accessBoundary.claimScopeViolations.length,
      evidenceScopeViolationCount: accessBoundary.evidenceScopeViolations.length
    },
    {
      type: "tenant_isolation_applied",
      at: now,
      requestId: request.id,
      workflowId: clientState.workflowId,
      isolationState: tenantIsolation.isolationState,
      enforcementMode: tenantIsolation.enforcementMode,
      scopedClaimCount: tenantIsolation.scopedCounts.claims,
      scopedEvidenceCount: tenantIsolation.scopedCounts.evidence,
      quarantinedClaimCount: tenantIsolation.scopedCounts.quarantinedClaims,
      quarantinedEvidenceCount: tenantIsolation.scopedCounts.quarantinedEvidence,
      auditHandoffRequired: tenantIsolation.auditHandoff.required,
      auditReasonCodes: tenantIsolation.auditHandoff.reasonCodes
    },
    {
      type: "persisted_state_recovered",
      at: now,
      requestId: request.id,
      workflowId: clientState.workflowId,
      restartSafeStatus: persistedState.restartSafeStatus,
      checkpointCursor: persistedState.checkpoint.cursor,
      recoveryLeaseActive: persistedState.recoveryLease.active,
      recoveryLeaseOwner: persistedState.recoveryLease.owner,
      recoveryLeaseEpoch: persistedState.recoveryLease.epoch,
      commandDisposition: persistedState.commandLedger.disposition,
      writePlanRequired: persistedState.writePlan.required,
      writeOperationTypes: persistedState.writePlan.operations.map((operation) => operation.type),
      recoveryRequired: persistedState.recoveryRequired,
      validationErrorCodes: persistedState.validationErrors.map((error) => error.code)
    },
    {
      type: "kernel_execution_health_evaluated",
      at: now,
      requestId: request.id,
      workflowId: clientState.workflowId,
      state: kernelExecutionHealth.state,
      circuitState: kernelExecutionHealth.circuitState,
      queueDepth: kernelExecutionHealth.queue.depth,
      executionLatencyMs: kernelExecutionHealth.latency.executionMs,
      degradedModeActive: kernelExecutionHealth.degradedMode.active,
      retryAfterMs: kernelExecutionHealth.retryPlan.retryAfterMs,
      validationErrorCodes: kernelExecutionHealth.validationErrors.map((error) => error.code)
    },
    {
      type: "workflow_handoff_selected",
      at: now,
      requestId: request.id,
      workflowId: clientState.workflowId,
      route: handoff.route,
      nextStep: handoff.nextStep,
      blocked: handoff.blocked
    },
    {
      type: "client_runtime_handoff_adopted",
      at: now,
      requestId: request.id,
      workflowId: clientState.workflowId,
      currentRoute: clientRuntime.currentRoute,
      targetRoute: clientRuntime.navigation.targetRoute,
      replace: clientRuntime.navigation.replace,
      ready: clientRuntime.ready,
      validationErrorCodes: clientRuntime.validationErrors.map((error) => error.code)
    },
    {
      type: "client_handoff_state_patch_prepared",
      at: now,
      requestId: request.id,
      workflowId: clientState.workflowId,
      adoptionState: clientHandoffAdoption.adoptionState,
      targetRoute: clientHandoffAdoption.routeTransition.to,
      statePatchRequired: clientHandoffAdoption.statePatch.required,
      operationTypes: clientHandoffAdoption.statePatch.operations.map((operation) => operation.type),
      acknowledgementRequired: clientHandoffAdoption.acknowledgement.required,
      proofExportArmed: clientHandoffAdoption.proofExport.armed,
      validationErrorCodes: clientHandoffAdoption.validationErrors.map((error) => error.code)
    },
    {
      type: "next_action_selected",
      at: now,
      requestId: request.id,
      workflowId: clientState.workflowId,
      route: nextAction.route,
      actionType: nextAction.type,
      runnable: nextAction.runnable
    }
  ];
}

function buildExportSummary({ request, clientState, analytics, contradictions, missingEvidenceClaimIds, operationalHealth, handoff, lifecycleControls, providerContract, accessBoundary, tenantIsolation, clientRuntime, clientHandoffAdoption, persistedState, kernelExecutionHealth, nextAction, validationSummary, readiness, acceptance, nextSteps, resolutionManifest, clientRouteContracts }) {
  return {
    exportType: "verifier-claim-gate.contradiction-check.report.v1",
    requestId: request.id,
    sessionId: clientState.sessionId,
    workflowId: clientState.workflowId,
    route: request.route,
    outcome: handoff.blocked ? "blocked" : operationalHealth.state,
    nextStep: handoff.nextStep,
    counters: analytics.counters,
    rates: analytics.rates,
    contradictionEvidenceIds: contradictions.map((item) => item.evidenceId),
    blockingContradictionIds: handoff.blockingContradictionIds,
    missingEvidenceClaimIds,
    healthIssueCodes: operationalHealth.issues.map((issue) => issue.code),
    lifecycle: {
      enabled: lifecycleControls.enabled,
      paused: lifecycleControls.paused,
      command: lifecycleControls.command.type || "none",
      commandDisposition: lifecycleControls.command.disposition,
      commandPending: lifecycleControls.command.pending,
      commandEffectiveAt: lifecycleControls.command.effectiveAt || null,
      scheduleMode: lifecycleControls.schedule.mode,
      nextRunAt: lifecycleControls.schedule.nextRunAt || null,
      scheduleRunState: lifecycleControls.schedule.runState,
      scheduleDue: lifecycleControls.schedule.due,
      scheduleOverdueMs: lifecycleControls.schedule.overdueMs,
      scheduleTriggerReasonCodes: lifecycleControls.schedule.triggerReasonCodes,
      evidenceCursor: lifecycleControls.schedule.evidenceCursor,
      processedEvidenceCursor: lifecycleControls.schedule.processedEvidenceCursor,
      settingsErrorCodes: lifecycleControls.validationErrors.map((error) => error.code)
    },
    provider: {
      providerId: providerContract.providerId,
      serviceName: providerContract.serviceName,
      contractVersion: providerContract.contractVersion,
      ready: providerContract.ready,
      endpointRoute: providerContract.endpointRoute,
      missingCapabilities: providerContract.capabilities.missing,
      syncCursor: providerContract.sync.cursor || null,
      syncStale: providerContract.sync.stale,
      externalHandoffState: providerContract.externalHandoff.state
    },
    accessBoundary: {
      actorId: accessBoundary.actorId,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      isolationMode: accessBoundary.isolationMode,
      ready: accessBoundary.ready,
      missingPermissions: accessBoundary.permissions.missing,
      claimScopeViolationCount: accessBoundary.claimScopeViolations.length,
      evidenceScopeViolationCount: accessBoundary.evidenceScopeViolations.length
    },
    tenantIsolation: {
      contractVersion: tenantIsolation.contractVersion,
      isolationState: tenantIsolation.isolationState,
      enforcementMode: tenantIsolation.enforcementMode,
      scopedCounts: tenantIsolation.scopedCounts,
      quarantinedClaimIds: tenantIsolation.quarantinedResources.claims.map((item) => item.claimId),
      quarantinedEvidenceIds: tenantIsolation.quarantinedResources.evidence.map((item) => item.evidenceId),
      auditHandoff: tenantIsolation.auditHandoff
    },
    clientRuntime: {
      contractVersion: clientRuntime.contractVersion,
      currentRoute: clientRuntime.currentRoute,
      targetRoute: clientRuntime.navigation.targetRoute,
      workflowId: clientRuntime.workflowId,
      ready: clientRuntime.ready,
      missingCapabilities: clientRuntime.missingCapabilities,
      validationErrorCodes: clientRuntime.validationErrors.map((error) => error.code)
    },
    clientHandoffAdoption: {
      contractVersion: clientHandoffAdoption.contractVersion,
      adoptionState: clientHandoffAdoption.adoptionState,
      ready: clientHandoffAdoption.ready,
      routeTransition: clientHandoffAdoption.routeTransition,
      statePatchRequired: clientHandoffAdoption.statePatch.required,
      statePatchOperations: clientHandoffAdoption.statePatch.operations,
      acknowledgement: clientHandoffAdoption.acknowledgement,
      proofExport: clientHandoffAdoption.proofExport,
      validationErrorCodes: clientHandoffAdoption.validationErrors.map((error) => error.code)
    },
    persistence: {
      contractVersion: persistedState.contractVersion,
      restartSafeStatus: persistedState.restartSafeStatus,
      recoveredFromCheckpoint: persistedState.recoveredFromCheckpoint,
      recoveryRequired: persistedState.recoveryRequired,
      checkpointCursor: persistedState.checkpoint.cursor,
      checkpointRevision: persistedState.checkpoint.revision,
      recoveryLease: {
        active: persistedState.recoveryLease.active,
        stale: persistedState.recoveryLease.stale,
        owner: persistedState.recoveryLease.owner,
        epoch: persistedState.recoveryLease.epoch,
        expiresAt: persistedState.recoveryLease.expiresAt
      },
      commandDisposition: persistedState.commandLedger.disposition,
      activeIdempotencyKey: persistedState.commandLedger.activeIdempotencyKey,
      writePlan: {
        required: persistedState.writePlan.required,
        mode: persistedState.writePlan.mode,
        operationTypes: persistedState.writePlan.operations.map((operation) => operation.type)
      },
      validationErrorCodes: persistedState.validationErrors.map((error) => error.code),
      recoveryPathTypes: persistedState.recoveryPaths.map((path) => path.type)
    },
    kernelExecution: {
      contractVersion: kernelExecutionHealth.contractVersion,
      state: kernelExecutionHealth.state,
      circuitState: kernelExecutionHealth.circuitState,
      queueDepth: kernelExecutionHealth.queue.depth,
      maxQueueDepth: kernelExecutionHealth.queue.maxDepth,
      executionLatencyMs: kernelExecutionHealth.latency.executionMs,
      maxExecutionLatencyMs: kernelExecutionHealth.latency.maxExecutionMs,
      dependencyIds: kernelExecutionHealth.dependencies.map((dependency) => dependency.id),
      unavailableDependencyIds: kernelExecutionHealth.dependencies
        .filter((dependency) => !dependency.ready)
        .map((dependency) => dependency.id),
      degradedReasonCodes: kernelExecutionHealth.degradedMode.reasonCodes,
      retryAfterMs: kernelExecutionHealth.retryPlan.retryAfterMs,
      validationErrorCodes: kernelExecutionHealth.validationErrors.map((error) => error.code)
    },
    nextAction,
    validationSummary: validationSummary || null,
    readiness: readiness || null,
    acceptance: acceptance || null,
    resolutionManifest: resolutionManifest || null,
    explainableNextSteps: nextSteps || null,
    clientRouteContracts: clientRouteContracts ? {
      contractVersion: clientRouteContracts.contractVersion,
      activeRoute: clientRouteContracts.activeRoute,
      routeOrder: clientRouteContracts.routeOrder,
      enabledActionIds: clientRouteContracts.consumableActions
        .filter((action) => action.enabled)
        .map((action) => action.id),
      disabledActionIds: clientRouteContracts.consumableActions
        .filter((action) => !action.enabled)
        .map((action) => action.id)
    } : null,
    proofRefs: contradictions.map((item) => item.proofRef).filter(Boolean),
    readyForProofExport: readiness
      ? readiness.canExportProof
      : providerContract.ready && !handoff.blocked && operationalHealth.state === "healthy" && kernelExecutionHealth.state === "healthy" && nextAction.runnable !== false
  };
}

function uniqueReasonCodes(...groups) {
  return [...new Set(groups.flat().map(asText).filter(Boolean))];
}

function buildValidationSummary({ claims, evidence, contradictions, missingEvidenceClaimIds, operationalHealth, lifecycleControls, providerContract, accessBoundary, clientRuntime, persistedState, kernelExecutionHealth, blockingSeverity }) {
  const blockingContradictions = contradictions.filter((item) => severityRank(item.severity) >= severityRank(blockingSeverity));
  const blockingEvidenceIds = blockingContradictions.map((item) => item.evidenceId);
  const errorCodes = operationalHealth.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);
  const warningCodes = operationalHealth.issues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.code);

  return {
    contractVersion: "contradiction-check.validation-summary.v1",
    valid: errorCodes.length === 0 && lifecycleControls.validationErrors.length === 0 && providerContract.validationErrors.length === 0 && accessBoundary.validationErrors.length === 0 && clientRuntime.validationErrors.length === 0 && persistedState.validationErrors.length === 0 && kernelExecutionHealth.validationErrors.length === 0,
    readyForAcceptance: errorCodes.length === 0 && blockingEvidenceIds.length === 0 && providerContract.ready && accessBoundary.ready && clientRuntime.ready && persistedState.ready && kernelExecutionHealth.state === "healthy" && lifecycleControls.enabled && !lifecycleControls.paused,
    counters: {
      normalizedClaims: claims.length,
      normalizedEvidence: evidence.length,
      contradictions: contradictions.length,
      blockingContradictions: blockingEvidenceIds.length,
      missingEvidenceClaims: missingEvidenceClaimIds.length,
      accessBoundaryErrors: accessBoundary.validationErrors.length,
      clientRuntimeErrors: clientRuntime.validationErrors.length,
      persistedStateErrors: persistedState.validationErrors.length,
      kernelExecutionErrors: kernelExecutionHealth.validationErrors.length,
      errors: errorCodes.length,
      warnings: warningCodes.length
    },
    errorCodes: uniqueReasonCodes(errorCodes, lifecycleControls.validationErrors.map((error) => error.code), providerContract.validationErrors.map((error) => error.code), accessBoundary.validationErrors.map((error) => error.code), clientRuntime.validationErrors.map((error) => error.code), persistedState.validationErrors.map((error) => error.code), kernelExecutionHealth.validationErrors.map((error) => error.code)),
    warningCodes,
    blockingEvidenceIds,
    missingEvidenceClaimIds,
    providerErrorCodes: providerContract.validationErrors.map((error) => error.code),
    accessBoundaryErrorCodes: accessBoundary.validationErrors.map((error) => error.code),
    clientRuntimeErrorCodes: clientRuntime.validationErrors.map((error) => error.code),
    persistedStateErrorCodes: persistedState.validationErrors.map((error) => error.code),
    kernelExecutionErrorCodes: kernelExecutionHealth.validationErrors.map((error) => error.code),
    lifecycleErrorCodes: lifecycleControls.validationErrors.map((error) => error.code)
  };
}

function buildReadinessContract({ request, clientState, handoff, operationalHealth, lifecycleControls, providerContract, accessBoundary, clientRuntime, persistedState, kernelExecutionHealth, validationSummary }) {
  const blockers = [];

  if (!lifecycleControls.enabled) {
    blockers.push({ code: "lifecycle_disabled", label: "Contradiction-check is disabled", route: "verifier-claim-gate/contradiction-check/settings" });
  }

  if (lifecycleControls.paused) {
    blockers.push({ code: "lifecycle_paused", label: "Contradiction-check is paused", route: "verifier-claim-gate/contradiction-check/settings" });
  }

  if (!providerContract.ready) {
    blockers.push({ code: "provider_not_ready", label: "Provider contract is not ready", route: providerContract.endpointRoute });
  }

  if (!accessBoundary.ready) {
    blockers.push({
      code: "access_boundary_not_ready",
      label: "Tenant, workspace, or permission boundary prevents proof export",
      route: "verifier-claim-gate/contradiction-check/access-boundary"
    });
  }

  if (!clientRuntime.ready) {
    blockers.push({
      code: "client_runtime_not_ready",
      label: "Client workflow state is not ready to adopt the contradiction-check handoff",
      route: clientRuntime.navigation.targetRoute
    });
  }

  if (!persistedState.ready) {
    blockers.push({
      code: "persisted_state_not_ready",
      label: "Persisted verifier state cannot be safely recovered",
      route: "verifier-claim-gate/contradiction-check/recover"
    });
  }

  if (kernelExecutionHealth.state !== "healthy") {
    blockers.push({
      code: "kernel_execution_not_ready",
      label: "Hosted-kernel execution health prevents contradiction-check proof export",
      route: kernelExecutionHealth.retryPlan.route
    });
  }

  if (validationSummary.blockingEvidenceIds.length > 0) {
    blockers.push({ code: "blocking_contradiction", label: "Blocking contradictions require resolution", route: "verifier-claim-gate/resolve" });
  }

  for (const issue of operationalHealth.actionableErrors) {
    blockers.push({ code: issue.code, label: issue.message, route: operationalHealth.failureState?.route || handoff.route });
  }

  return {
    contractVersion: "contradiction-check.readiness.v1",
    requestId: request.id,
    sessionId: clientState.sessionId,
    workflowId: clientState.workflowId,
    state: blockers.length > 0 ? "blocked" : operationalHealth.state === "healthy" ? "ready" : "review",
    canPreview: true,
    canAccept: blockers.length === 0 && validationSummary.readyForAcceptance && operationalHealth.state === "healthy" && kernelExecutionHealth.state === "healthy",
    canExportProof: blockers.length === 0 && providerContract.ready && accessBoundary.ready && persistedState.ready && operationalHealth.state === "healthy" && kernelExecutionHealth.state === "healthy",
    blockers,
    reasonCodes: uniqueReasonCodes(blockers.map((blocker) => blocker.code), validationSummary.errorCodes)
  };
}

function buildAcceptanceContract({ request, clientState, handoff, validationSummary, readiness, contradictions, providerContract }) {
  const accepted = readiness.canAccept && readiness.canExportProof && !handoff.blocked;
  const unresolvedContradictions = contradictions
    .filter((item) => validationSummary.blockingEvidenceIds.includes(item.evidenceId) || !item.proofRef || !item.mapped)
    .map((item) => ({
      claimId: item.claimId,
      evidenceId: item.evidenceId,
      severity: item.severity,
      reasonCodes: [
        validationSummary.blockingEvidenceIds.includes(item.evidenceId) ? "blocking_contradiction" : "",
        item.mapped ? "" : "unmapped_contradiction",
        item.proofRef ? "" : "missing_contradiction_proof_ref"
      ].filter(Boolean)
    }));

  return {
    contractVersion: "contradiction-check.acceptance.v1",
    requestId: request.id,
    workflowId: clientState.workflowId,
    accepted,
    decision: accepted ? "accept-proof-export" : "hold-for-review",
    decisionRoute: accepted ? "verifier-claim-gate/proof-export" : handoff.route,
    requiredAcknowledgements: accepted ? [] : readiness.reasonCodes,
    unresolvedContradictions,
    proofExportToken: accepted ? `${request.id}:${clientState.workflowId}:${providerContract.sync.cursor || "no-cursor"}` : null,
    auditLabel: accepted ? "No blocking contradictions remain" : "Contradiction-check requires operator or provider action"
  };
}

function buildClaimResolutionPackets({ request, clientState, claims, evidence, contradictions, validationSummary, accessBoundary, providerContract }) {
  const evidenceByClaimId = evidence.reduce((groups, item) => {
    const key = item.claimId || "unmapped-claim";
    groups.set(key, [...(groups.get(key) || []), item]);
    return groups;
  }, new Map());
  const contradictionsByClaimId = contradictions.reduce((groups, item) => {
    const key = item.claimId || "unmapped-claim";
    groups.set(key, [...(groups.get(key) || []), item]);
    return groups;
  }, new Map());

  return claims.map((claim) => {
    const claimEvidence = evidenceByClaimId.get(claim.id) || [];
    const claimContradictions = contradictionsByClaimId.get(claim.id) || [];
    const blockingEvidenceIds = claimContradictions
      .filter((item) => validationSummary.blockingEvidenceIds.includes(item.evidenceId))
      .map((item) => item.evidenceId);
    const missingProofEvidenceIds = claimContradictions
      .filter((item) => !item.proofRef)
      .map((item) => item.evidenceId);
    const supportEvidenceIds = claimEvidence
      .filter((item) => item.verdict === "supports")
      .map((item) => item.id);
    const unknownEvidenceIds = claimEvidence
      .filter((item) => item.verdict === "unknown" || !item.verdict)
      .map((item) => item.id);
    const evidenceSources = [...new Set(claimEvidence.map((item) => item.source).filter(Boolean))];
    const proofRefs = [...new Set(claimContradictions.map((item) => item.proofRef).filter(Boolean))];
    const scopeViolation = accessBoundary.claimScopeViolations.some((item) => item.claimId === claim.id);
    const resolutionState = blockingEvidenceIds.length > 0
      ? "blocked"
      : missingProofEvidenceIds.length > 0 || scopeViolation
        ? "needs-proof"
        : claimContradictions.length > 0
          ? "reviewed"
          : supportEvidenceIds.length > 0
            ? "supported"
            : "unverified";

    return {
      contractVersion: "contradiction-check.claim-resolution.v1",
      packetId: `${request.id}:${clientState.workflowId}:${claim.id}`,
      claimId: claim.id,
      claimText: claim.text,
      source: claim.source || null,
      tenantId: claim.tenantId || accessBoundary.tenantId,
      workspaceId: claim.workspaceId || accessBoundary.workspaceId,
      requiresVerification: claim.requiresVerification,
      resolutionState,
      route: resolutionState === "blocked"
        ? "verifier-claim-gate/resolve"
        : "verifier-claim-gate/contradiction-check/audit",
      exportable: resolutionState !== "blocked" && missingProofEvidenceIds.length === 0 && providerContract.ready && !scopeViolation,
      evidenceSummary: {
        totalEvidence: claimEvidence.length,
        supportEvidenceIds,
        contradictionEvidenceIds: claimContradictions.map((item) => item.evidenceId),
        blockingEvidenceIds,
        unknownEvidenceIds,
        missingProofEvidenceIds,
        sources: evidenceSources,
        proofRefs
      },
      auditRef: {
        requestId: request.id,
        workflowId: clientState.workflowId,
        providerId: providerContract.providerId,
        syncCursor: providerContract.sync.cursor || null,
        scopeViolation
      }
    };
  });
}

function buildResolutionManifest({ request, clientState, claimResolutionPackets, readiness, acceptance }) {
  const blockedPackets = claimResolutionPackets.filter((packet) => packet.resolutionState === "blocked");
  const exportablePackets = claimResolutionPackets.filter((packet) => packet.exportable);
  const proofRefs = [...new Set(claimResolutionPackets.flatMap((packet) => packet.evidenceSummary.proofRefs))];

  return {
    contractVersion: "contradiction-check.resolution-manifest.v1",
    requestId: request.id,
    sessionId: clientState.sessionId,
    workflowId: clientState.workflowId,
    state: blockedPackets.length > 0 ? "blocked" : readiness.state,
    accepted: acceptance.accepted,
    exportableClaimIds: exportablePackets.map((packet) => packet.claimId),
    blockedClaimIds: blockedPackets.map((packet) => packet.claimId),
    packetsRequiringProof: claimResolutionPackets
      .filter((packet) => packet.evidenceSummary.missingProofEvidenceIds.length > 0)
      .map((packet) => packet.claimId),
    proofRefs,
    exportManifestKey: acceptance.accepted
      ? `${acceptance.proofExportToken}:${exportablePackets.length}:${proofRefs.length}`
      : null
  };
}

function buildUserPreview({ request, clientState, claims, evidence, contradictions, claimResolutionPackets, resolutionManifest, handoff, clientRuntime, clientHandoffAdoption, persistedState, kernelExecutionHealth, validationSummary, readiness, acceptance }) {
  const topContradictions = contradictions
    .slice()
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity))
    .slice(0, 5)
    .map((item) => ({
      claimId: item.claimId,
      claimText: item.claimText,
      evidenceId: item.evidenceId,
      evidenceText: item.evidenceText,
      severity: item.severity,
      source: item.source || null,
      proofRef: item.proofRef || null,
      blocking: validationSummary.blockingEvidenceIds.includes(item.evidenceId)
    }));

  return {
    contractVersion: "contradiction-check.ui-preview.v1",
    title: readiness.canAccept ? "Contradiction-check ready" : "Contradiction-check needs review",
    requestId: request.id,
    sessionId: clientState.sessionId,
    workflowId: clientState.workflowId,
    status: readiness.state,
    summary: {
      claimsChecked: claims.length,
      evidenceChecked: evidence.length,
      contradictionsFound: contradictions.length,
      blockingContradictions: validationSummary.counters.blockingContradictions,
      missingEvidenceClaims: validationSummary.counters.missingEvidenceClaims
    },
    primaryAction: {
      label: acceptance.accepted ? "Export proof" : "Review next step",
      route: clientRuntime.navigation.targetRoute || acceptance.decisionRoute,
      enabled: readiness.canAccept || readiness.blockers.length > 0,
      reasonCodes: readiness.reasonCodes
    },
    secondaryAction: {
      label: "View audit report",
      route: "verifier-claim-gate/contradiction-check/audit",
      enabled: true
    },
    topContradictions,
    claimResolutionPreview: claimResolutionPackets.slice(0, 5).map((packet) => ({
      claimId: packet.claimId,
      resolutionState: packet.resolutionState,
      route: packet.route,
      exportable: packet.exportable,
      evidenceCount: packet.evidenceSummary.totalEvidence,
      blockingEvidenceIds: packet.evidenceSummary.blockingEvidenceIds,
      missingProofEvidenceIds: packet.evidenceSummary.missingProofEvidenceIds
    })),
    resolutionManifest: {
      state: resolutionManifest.state,
      exportableClaimCount: resolutionManifest.exportableClaimIds.length,
      blockedClaimCount: resolutionManifest.blockedClaimIds.length,
      proofRefCount: resolutionManifest.proofRefs.length
    },
    handoffPreview: {
      nextStep: handoff.nextStep,
      route: handoff.route,
      blocked: handoff.blocked,
      degraded: Boolean(handoff.degraded),
      clientRoute: clientRuntime.currentRoute,
      replaceRoute: clientRuntime.navigation.replace,
      handoffCursor: clientRuntime.handoffCursor || null,
      adoptionState: clientHandoffAdoption.adoptionState,
      statePatchRequired: clientHandoffAdoption.statePatch.required,
      statePatchOperations: clientHandoffAdoption.statePatch.operations.map((operation) => operation.type),
      acknowledgementRequired: clientHandoffAdoption.acknowledgement.required,
      proofExportArmed: clientHandoffAdoption.proofExport.armed,
      restartSafeStatus: persistedState.restartSafeStatus,
      commandDisposition: persistedState.commandLedger.disposition,
      recoveryRequired: persistedState.recoveryRequired,
      recoveryLeaseState: persistedState.recoveryLease.active
        ? "active"
        : persistedState.recoveryLease.stale
          ? "stale"
          : "none",
      persistenceWriteRequired: persistedState.writePlan.required
    },
    executionHealthPreview: {
      state: kernelExecutionHealth.state,
      circuitState: kernelExecutionHealth.circuitState,
      queueDepth: kernelExecutionHealth.queue.depth,
      executionLatencyMs: kernelExecutionHealth.latency.executionMs,
      degraded: kernelExecutionHealth.degradedMode.active,
      retryAfterMs: kernelExecutionHealth.retryPlan.retryAfterMs,
      reasonCodes: kernelExecutionHealth.degradedMode.reasonCodes
    }
  };
}

function buildExplainableNextSteps({ handoff, readiness, acceptance, operationalHealth, providerContract, persistedState, kernelExecutionHealth }) {
  const steps = [];

  if (!providerContract.ready) {
    steps.push({
      id: "negotiate-provider-contract",
      label: "Refresh provider contract",
      route: providerContract.endpointRoute,
      required: true,
      reasonCodes: providerContract.validationErrors.map((error) => error.code)
    });
  }

  for (const blocker of readiness.blockers) {
    steps.push({
      id: blocker.code,
      label: blocker.label,
      route: blocker.route,
      required: true,
      reasonCodes: [blocker.code]
    });
  }

  for (const recoveryPath of persistedState.recoveryPaths.filter((path) => path.required)) {
    steps.push({
      id: recoveryPath.reasonCode,
      label: recoveryPath.type === "resume_in_flight_run" ? "Resume persisted contradiction-check run" : "Recover persisted contradiction-check state",
      route: recoveryPath.route,
      required: true,
      reasonCodes: [recoveryPath.reasonCode]
    });
  }

  if (kernelExecutionHealth.state !== "healthy") {
    steps.push({
      id: "repair-kernel-execution-health",
      label: kernelExecutionHealth.circuitState === "open"
        ? "Close hosted-kernel execution circuit"
        : "Retry hosted-kernel contradiction-check execution",
      route: kernelExecutionHealth.retryPlan.route,
      required: kernelExecutionHealth.state === "failed",
      retryAfterMs: kernelExecutionHealth.retryPlan.retryAfterMs,
      reasonCodes: kernelExecutionHealth.degradedMode.reasonCodes
    });
  }

  if (steps.length === 0) {
    steps.push({
      id: acceptance.accepted ? "export-proof" : "review-contradiction-check",
      label: acceptance.accepted ? "Export proof" : "Review contradiction-check output",
      route: acceptance.decisionRoute,
      required: false,
      reasonCodes: acceptance.requiredAcknowledgements
    });
  }

  return {
    contractVersion: "contradiction-check.next-steps.v1",
    route: handoff.route,
    retryable: operationalHealth.retryable,
    retryAfterMs: operationalHealth.retryAfterMs,
    steps
  };
}

function routeContract(route, title, state, payload, options = {}) {
  return {
    route,
    title,
    state,
    method: options.method || "GET",
    cacheScope: options.cacheScope || "request",
    visible: options.visible !== false,
    enabled: options.enabled !== false,
    reasonCodes: normalizeScopedList(options.reasonCodes || []),
    payload
  };
}

function buildClientRouteContracts({ request, clientState, uiPreview, validationSummary, readiness, acceptance, explainableNextSteps, resolutionManifest, clientRuntime, clientHandoffAdoption }) {
  const firstRequiredStep = explainableNextSteps.steps.find((step) => step.required) || null;
  const acceptanceReasons = acceptance.accepted
    ? []
    : uniqueReasonCodes(acceptance.requiredAcknowledgements, readiness.reasonCodes);
  const proofExportEnabled = acceptance.accepted && readiness.canExportProof;
  const acceptanceRouteState = acceptance.accepted
    ? "accepted"
    : readiness.canAccept
      ? "awaiting-operator-ack"
      : "blocked";
  const routeOrder = [
    "verifier-claim-gate/contradiction-check/preview",
    "verifier-claim-gate/contradiction-check/validation",
    "verifier-claim-gate/contradiction-check/readiness",
    acceptance.decisionRoute,
    "verifier-claim-gate/contradiction-check/next-steps"
  ].filter(Boolean);

  return {
    contractVersion: "contradiction-check.client-route-contracts.v1",
    requestId: request.id,
    sessionId: clientState.sessionId,
    workflowId: clientState.workflowId,
    activeRoute: clientRuntime.navigation.targetRoute || uiPreview.primaryAction.route,
    routeOrder: [...new Set(routeOrder)],
    navigation: {
      sourceRoute: clientRuntime.navigation.sourceRoute,
      targetRoute: clientRuntime.navigation.targetRoute,
      replace: clientRuntime.navigation.replace,
      preserveScroll: clientRuntime.navigation.preserveScroll,
      reasonCodes: clientRuntime.navigation.reasonCodes
    },
    routes: {
      preview: routeContract(
        "verifier-claim-gate/contradiction-check/preview",
        uiPreview.title,
        uiPreview.status,
        {
          summary: uiPreview.summary,
          primaryAction: uiPreview.primaryAction,
          secondaryAction: uiPreview.secondaryAction,
          topContradictions: uiPreview.topContradictions,
          resolutionManifest: uiPreview.resolutionManifest,
          handoffPreview: uiPreview.handoffPreview,
          handoffAdoption: {
            adoptionState: clientHandoffAdoption.adoptionState,
            routeTransition: clientHandoffAdoption.routeTransition,
            statePatch: clientHandoffAdoption.statePatch,
            acknowledgement: clientHandoffAdoption.acknowledgement,
            proofExport: clientHandoffAdoption.proofExport
          },
          executionHealthPreview: uiPreview.executionHealthPreview
        }
      ),
      validation: routeContract(
        "verifier-claim-gate/contradiction-check/validation",
        validationSummary.valid ? "Validation passed" : "Validation requires attention",
        validationSummary.valid ? "valid" : "invalid",
        {
          counters: validationSummary.counters,
          errorCodes: validationSummary.errorCodes,
          warningCodes: validationSummary.warningCodes,
          blockingEvidenceIds: validationSummary.blockingEvidenceIds,
          missingEvidenceClaimIds: validationSummary.missingEvidenceClaimIds
        },
        { enabled: true, reasonCodes: validationSummary.errorCodes }
      ),
      readiness: routeContract(
        "verifier-claim-gate/contradiction-check/readiness",
        readiness.state === "ready" ? "Ready for acceptance" : "Readiness blocked",
        readiness.state,
        {
          canPreview: readiness.canPreview,
          canAccept: readiness.canAccept,
          canExportProof: readiness.canExportProof,
          blockers: readiness.blockers,
          reasonCodes: readiness.reasonCodes
        },
        { enabled: readiness.canPreview, reasonCodes: readiness.reasonCodes }
      ),
      acceptance: routeContract(
        acceptance.decisionRoute,
        acceptance.accepted ? "Proof export accepted" : "Acceptance held for review",
        acceptanceRouteState,
        {
          accepted: acceptance.accepted,
          decision: acceptance.decision,
          requiredAcknowledgements: acceptance.requiredAcknowledgements,
          unresolvedContradictions: acceptance.unresolvedContradictions,
          proofExportToken: acceptance.proofExportToken,
          auditLabel: acceptance.auditLabel
        },
        {
          method: acceptance.accepted ? "POST" : "GET",
          enabled: readiness.canAccept || acceptance.unresolvedContradictions.length > 0,
          reasonCodes: acceptanceReasons
        }
      ),
      nextSteps: routeContract(
        "verifier-claim-gate/contradiction-check/next-steps",
        firstRequiredStep ? firstRequiredStep.label : "Next step available",
        firstRequiredStep ? "required" : "optional",
        {
          retryable: explainableNextSteps.retryable,
          retryAfterMs: explainableNextSteps.retryAfterMs,
          steps: explainableNextSteps.steps
        },
        {
          enabled: explainableNextSteps.steps.length > 0,
          reasonCodes: explainableNextSteps.steps.flatMap((step) => step.reasonCodes)
        }
      ),
      proofExport: routeContract(
        "verifier-claim-gate/proof-export",
        proofExportEnabled ? "Export proof" : "Proof export unavailable",
        proofExportEnabled ? "enabled" : "disabled",
        {
          exportableClaimIds: resolutionManifest.exportableClaimIds,
          proofRefs: resolutionManifest.proofRefs,
          exportManifestKey: resolutionManifest.exportManifestKey,
          proofExportToken: acceptance.proofExportToken
        },
        {
          method: "POST",
          visible: readiness.canExportProof || resolutionManifest.exportableClaimIds.length > 0,
          enabled: proofExportEnabled,
          reasonCodes: proofExportEnabled ? [] : acceptanceReasons
        }
      )
    },
    consumableActions: [
      {
        id: "open-preview",
        label: uiPreview.primaryAction.label,
        route: uiPreview.primaryAction.route,
        method: "GET",
        enabled: uiPreview.primaryAction.enabled,
        reasonCodes: uiPreview.primaryAction.reasonCodes
      },
      {
        id: "accept-proof-export",
        label: acceptance.accepted ? "Export proof" : "Acknowledge review hold",
        route: acceptance.decisionRoute,
        method: acceptance.accepted ? "POST" : "GET",
        enabled: acceptance.accepted,
        reasonCodes: acceptanceReasons
      },
      {
        id: "follow-next-step",
        label: firstRequiredStep?.label || explainableNextSteps.steps[0]?.label || "Review contradiction-check",
        route: firstRequiredStep?.route || explainableNextSteps.steps[0]?.route || uiPreview.primaryAction.route,
        method: "GET",
        enabled: Boolean(firstRequiredStep || explainableNextSteps.steps.length > 0),
        retryAfterMs: firstRequiredStep?.retryAfterMs || explainableNextSteps.retryAfterMs || null,
        reasonCodes: firstRequiredStep?.reasonCodes || explainableNextSteps.steps[0]?.reasonCodes || []
      }
    ]
  };
}

function addHealthIssue(issues, code, severity, message, action, details = {}) {
  issues.push({
    code,
    severity,
    message,
    action,
    ...details
  });
}

function buildOperationalHealth({ claims, evidence, contradictions, missingEvidenceClaimIds, retryState, lifecycleControls, providerContract, accessBoundary, persistedState, kernelExecutionHealth }) {
  const issues = [];
  const unmappedContradictions = contradictions.filter((item) => !item.mapped);
  const unsupportedVerdictEvidenceIds = evidence
    .filter((item) => item.verdict)
    .filter((item) => !isContradictingEvidence(item) && item.verdict !== "supports" && item.verdict !== "unknown")
    .map((item) => item.id);
  const evidenceWithoutProofRefs = evidence
    .filter((item) => isContradictingEvidence(item))
    .filter((item) => !item.proofRef)
    .map((item) => item.id);

  if (!lifecycleControls.enabled) {
    addHealthIssue(
      issues,
      "lifecycle_disabled",
      "warning",
      "Contradiction-check is disabled by lifecycle settings.",
      "Enable contradiction-check before allowing proof export from this gate.",
      { commandId: lifecycleControls.command.id }
    );
  }

  if (lifecycleControls.paused) {
    addHealthIssue(
      issues,
      "lifecycle_paused",
      "warning",
      "Contradiction-check is paused by lifecycle settings.",
      "Resume contradiction-check or keep the workflow waiting for a manual run.",
      { commandId: lifecycleControls.command.id }
    );
  }

  for (const validationError of lifecycleControls.validationErrors) {
    addHealthIssue(
      issues,
      validationError.code,
      "error",
      validationError.message,
      "Repair contradiction-check lifecycle settings before running the verifier gate.",
      validationError
    );
  }

  if (!providerContract.ready) {
    addHealthIssue(
      issues,
      "provider_contract_not_ready",
      providerContract.capabilities.missing.length > 0 ? "error" : "warning",
      "Integration provider contract is not ready for contradiction-check execution.",
      "Negotiate required provider capabilities and refresh sync metadata before releasing proof export.",
      {
        providerId: providerContract.providerId,
        status: providerContract.status,
        missingCapabilities: providerContract.capabilities.missing,
        providerErrorCodes: providerContract.validationErrors.map((error) => error.code)
      }
    );
  }

  for (const validationError of providerContract.validationErrors) {
    addHealthIssue(
      issues,
      validationError.code,
      validationError.code === "provider_missing_capability" ? "error" : "warning",
      validationError.message,
      "Repair the provider/service contract before continuing the hosted-kernel contradiction gate.",
      validationError
    );
  }

  for (const validationError of accessBoundary.validationErrors) {
    addHealthIssue(
      issues,
      validationError.code,
      "error",
      validationError.message,
      "Repair actor permissions or tenant/workspace scope before releasing contradiction-check proof export.",
      {
        ...validationError,
        actorId: accessBoundary.actorId,
        tenantId: accessBoundary.tenantId,
        workspaceId: accessBoundary.workspaceId
      }
    );
  }

  for (const validationError of persistedState.validationErrors) {
    addHealthIssue(
      issues,
      validationError.code,
      "error",
      validationError.message,
      "Recover or discard the persisted contradiction-check checkpoint before continuing.",
      {
        ...validationError,
        restartSafeStatus: persistedState.restartSafeStatus,
        checkpointCursor: persistedState.checkpoint.cursor,
        commandDisposition: persistedState.commandLedger.disposition
      }
    );
  }

  for (const validationError of kernelExecutionHealth.validationErrors) {
    const hardFailure = validationError.code === "kernel_circuit_open" ||
      validationError.code === "kernel_circuit_state_unsupported" ||
      validationError.code === "kernel_dependency_unavailable";
    addHealthIssue(
      issues,
      validationError.code,
      hardFailure ? "error" : "warning",
      validationError.message,
      hardFailure
        ? "Route contradiction-check traffic to health repair and prevent proof export until the hosted-kernel execution lane is ready."
        : "Use degraded preview mode and retry contradiction-check execution after the hosted-kernel retry window.",
      {
        ...validationError,
        circuitState: kernelExecutionHealth.circuitState,
        queueDepth: kernelExecutionHealth.queue.depth,
        executionLatencyMs: kernelExecutionHealth.latency.executionMs,
        retryAfterMs: kernelExecutionHealth.retryPlan.retryAfterMs
      }
    );
  }

  if (persistedState.recoveryRequired && persistedState.ready) {
    addHealthIssue(
      issues,
      "persisted_recovery_required",
      "warning",
      "Contradiction-check recovered persisted state that requires a restart-safe recovery action.",
      "Resume the persisted run or restore the session projection before allowing a new proof export.",
      {
        restartSafeStatus: persistedState.restartSafeStatus,
        recoveryPathTypes: persistedState.recoveryPaths.map((path) => path.type)
      }
    );
  }

  if (claims.length === 0) {
    addHealthIssue(
      issues,
      "no_claims",
      "error",
      "Contradiction check requires at least one normalized claim.",
      "Send claims with a stable id and non-empty text before opening the verifier gate."
    );
  }

  if (evidence.length === 0) {
    addHealthIssue(
      issues,
      "no_evidence",
      "warning",
      "No evidence was available for contradiction evaluation.",
      "Retry after evidence collection or mark claims as not requiring verification."
    );
  }

  if (missingEvidenceClaimIds.length > 0) {
    addHealthIssue(
      issues,
      "missing_claim_evidence",
      "warning",
      "Some verification-required claims have no mapped evidence.",
      "Collect evidence for each missing claim before exporting proof.",
      { claimIds: missingEvidenceClaimIds }
    );
  }

  if (unmappedContradictions.length > 0) {
    addHealthIssue(
      issues,
      "unmapped_contradiction",
      "error",
      "Contradicting evidence was present but did not map to a known claim id.",
      "Attach each contradiction to a claimId so the gate can produce an auditable resolution path.",
      { evidenceIds: unmappedContradictions.map((item) => item.evidenceId) }
    );
  }

  if (unsupportedVerdictEvidenceIds.length > 0) {
    addHealthIssue(
      issues,
      "unsupported_evidence_verdict",
      "warning",
      "Evidence used a verdict outside the verifier claim-gate contract.",
      "Normalize verdicts to supports, unknown, contradicts, refuted, false, or conflict.",
      { evidenceIds: unsupportedVerdictEvidenceIds }
    );
  }

  if (evidenceWithoutProofRefs.length > 0) {
    addHealthIssue(
      issues,
      "missing_contradiction_proof_ref",
      "warning",
      "Contradicting evidence is missing proof artifact references.",
      "Attach proofRef values so downstream resolution can cite source-backed artifacts.",
      { evidenceIds: evidenceWithoutProofRefs }
    );
  }

  if (retryState.exhausted) {
    addHealthIssue(
      issues,
      "retry_budget_exhausted",
      "error",
      "Retry budget for contradiction-check recovery has been exhausted.",
      "Stop automatic retries and escalate the verifier gate state to an operator.",
      { attempt: retryState.attempt, maxAttempts: retryState.maxAttempts, lastError: retryState.lastError }
    );
  }

  const hasError = issues.some((issue) => issue.severity === "error");
  const degraded = hasError || issues.some((issue) => issue.severity === "warning");
  const computedRetryAfterMs = Math.min(30000, 1000 * 2 ** retryState.attempt);
  const retryAfterMs = retryState.exhausted
    ? null
    : kernelExecutionHealth.retryPlan.retryAfterMs
      ? Math.max(computedRetryAfterMs, kernelExecutionHealth.retryPlan.retryAfterMs)
      : computedRetryAfterMs;
  const failureRoute = !accessBoundary.ready
    ? "verifier-claim-gate/contradiction-check/access-boundary"
    : kernelExecutionHealth.state === "failed"
      ? kernelExecutionHealth.retryPlan.route
    : "verifier-claim-gate/contradiction-check/recover";

  return {
    state: hasError ? "failed" : degraded ? "degraded" : "healthy",
    degraded,
    retryable: degraded && !retryState.exhausted,
    retryAfterMs,
    issues,
    actionableErrors: issues.filter((issue) => issue.severity === "error"),
    failureState: hasError ? {
      route: persistedState.validationErrors.length > 0
        ? "verifier-claim-gate/contradiction-check/recover"
        : failureRoute,
      reasonCodes: issues.filter((issue) => issue.severity === "error").map((issue) => issue.code),
      operatorActionRequired: retryState.exhausted || claims.length === 0 || lifecycleControls.validationErrors.length > 0 || providerContract.capabilities.missing.length > 0 || !accessBoundary.ready || !persistedState.ready || kernelExecutionHealth.state === "failed"
    } : null
  };
}

function buildContradictions(claims, evidence) {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  return evidence
    .filter(isContradictingEvidence)
    .map((item) => {
      const claim = claimsById.get(item.claimId);
      return {
        claimId: item.claimId || "unmapped-claim",
        claimText: claim?.text || "",
        evidenceId: item.id,
        evidenceText: item.text,
        severity: item.severity,
        source: item.source,
        proofRef: item.proofRef,
        mapped: Boolean(claim)
      };
    });
}

function buildWorkflowHandoff({ request, clientState, contradictions, blockingSeverity }) {
  const blockingContradictions = contradictions.filter(
    (item) => severityRank(item.severity) >= severityRank(blockingSeverity)
  );
  const blocked = blockingContradictions.length > 0;

  return {
    nextStep: blocked ? "resolve-claim-contradiction" : "claim-gate-ready",
    route: blocked ? "verifier-claim-gate/resolve" : "verifier-claim-gate/proof-export",
    requestId: request.id,
    sessionId: clientState.sessionId,
    workflowId: clientState.workflowId,
    blocked,
    blockingContradictionIds: blockingContradictions.map((item) => item.evidenceId)
  };
}

function shapeOperationalHandoff(handoff, health) {
  if (health.state === "failed") {
    return {
      ...handoff,
      nextStep: "repair-contradiction-check-input",
      route: health.failureState.route,
      blocked: true,
      degraded: true,
      retryable: health.retryable,
      retryAfterMs: health.retryAfterMs,
      failureReasonCodes: health.failureState.reasonCodes
    };
  }

  if (health.state === "degraded") {
    return {
      ...handoff,
      degraded: true,
      retryable: health.retryable,
      retryAfterMs: health.retryAfterMs,
      warnings: health.issues.map((issue) => issue.code)
    };
  }

  return {
    ...handoff,
    degraded: false,
    retryable: false,
    retryAfterMs: null
  };
}

function shapeLifecycleHandoff(handoff, lifecycleControls, nextAction) {
  if (nextAction.type === "disabled" || nextAction.type === "paused" || nextAction.type === "settings_repair") {
    return {
      ...handoff,
      nextStep: nextAction.type,
      route: nextAction.route,
      blocked: true,
      lifecycleBlocked: true,
      lifecycleCommand: lifecycleControls.command.type || "none",
      nextAction
    };
  }

  return {
    ...handoff,
    lifecycleBlocked: false,
    lifecycleCommand: lifecycleControls.command.type || "none",
    scheduledNextRunAt: lifecycleControls.schedule.nextRunAt || null,
    nextAction
  };
}

function shapeProviderHandoff(handoff, providerContract) {
  const externalState = {
    providerId: providerContract.providerId,
    serviceName: providerContract.serviceName,
    contractVersion: providerContract.contractVersion,
    endpointRoute: providerContract.endpointRoute,
    mode: providerContract.externalHandoff.mode,
    ticketId: providerContract.externalHandoff.ticketId || null,
    state: providerContract.externalHandoff.state,
    owner: providerContract.externalHandoff.owner || null,
    syncCursor: providerContract.sync.cursor || null,
    sourceRevision: providerContract.sync.sourceRevision || null,
    ready: providerContract.ready
  };

  if (!providerContract.ready) {
    return {
      ...handoff,
      nextStep: "negotiate-provider-contract",
      route: providerContract.endpointRoute,
      blocked: true,
      providerBlocked: true,
      providerReasonCodes: providerContract.validationErrors.map((error) => error.code),
      externalState
    };
  }

  if (providerContract.externalHandoff.mode === "external" && handoff.blocked) {
    return {
      ...handoff,
      route: providerContract.externalHandoff.route,
      providerBlocked: false,
      externalState: {
        ...externalState,
        state: providerContract.externalHandoff.ticketId ? providerContract.externalHandoff.state : "ticket-required"
      }
    };
  }

  return {
    ...handoff,
    providerBlocked: false,
    externalState
  };
}

function buildClientRuntimeContract({ input, request, clientState, handoff, nextAction, providerContract }) {
  const runtime = asRecord(input.clientRuntime || input.runtimeClient || input.client);
  const routeState = asRecord(runtime.routeState || runtime.navigation || input.navigation);
  const declaredCapabilities = normalizeCapabilityList(runtime.capabilities || runtime.clientCapabilities);
  const capabilities = declaredCapabilities.length > 0 ? declaredCapabilities : CLIENT_RUNTIME_CAPABILITIES;
  const currentRoute = asText(routeState.currentRoute || routeState.route || runtime.currentRoute || runtime.route || request.route);
  const targetRoute = handoff.route || nextAction.route;
  const workflowId = asText(runtime.workflowId || runtime.activeWorkflowId || routeState.workflowId || clientState.workflowId);
  const sessionId = asText(runtime.sessionId || routeState.sessionId || clientState.sessionId);
  const handoffCursor = asText(runtime.handoffCursor || routeState.handoffCursor || providerContract.sync.cursor);
  const requestedStep = asText(runtime.requestedStep || routeState.step || clientState.currentStep || handoff.nextStep);
  const visibleRoutes = [
    request.route,
    handoff.route,
    nextAction.route,
    providerContract.endpointRoute,
    providerContract.externalHandoff.route,
    "verifier-claim-gate/contradiction-check",
    "verifier-claim-gate/contradiction-check/audit"
  ].map(asText).filter(Boolean);
  const allowedRoutes = [...new Set(visibleRoutes)];
  const requiredCapabilities = [
    "handoff-state",
    handoff.blocked || nextAction.type === "resolve_contradiction" ? "audit-preview" : "proof-preview",
    currentRoute !== targetRoute ? "route-replace" : ""
  ].filter(Boolean);
  const missingCapabilities = requiredCapabilities.filter((capability) => !capabilities.includes(capability));
  const validationErrors = [];

  if (workflowId !== clientState.workflowId) {
    validationErrors.push({
      code: "client_workflow_mismatch",
      message: "Client runtime workflow id does not match the contradiction-check workflow.",
      expectedWorkflowId: clientState.workflowId,
      actualWorkflowId: workflowId
    });
  }

  if (sessionId !== clientState.sessionId) {
    validationErrors.push({
      code: "client_session_mismatch",
      message: "Client runtime session id does not match the contradiction-check session.",
      expectedSessionId: clientState.sessionId,
      actualSessionId: sessionId
    });
  }

  if (currentRoute && !allowedRoutes.includes(currentRoute)) {
    validationErrors.push({
      code: "client_route_out_of_scope",
      message: "Client runtime route is outside the hosted contradiction-check handoff routes.",
      currentRoute,
      allowedRoutes
    });
  }

  if (missingCapabilities.length > 0) {
    validationErrors.push({
      code: "client_runtime_missing_capability",
      message: "Client runtime cannot render the selected contradiction-check workflow handoff.",
      missingCapabilities
    });
  }

  return {
    contractVersion: "contradiction-check.client-runtime.v1",
    requestId: request.id,
    sessionId,
    workflowId,
    currentStep: requestedStep || handoff.nextStep,
    currentRoute,
    handoffCursor,
    capabilities: {
      required: requiredCapabilities,
      effective: capabilities,
      missing: missingCapabilities
    },
    missingCapabilities,
    navigation: {
      sourceRoute: currentRoute || request.route,
      targetRoute,
      targetStep: handoff.nextStep,
      replace: Boolean(currentRoute && currentRoute !== targetRoute),
      preserveScroll: nextAction.type === "await_schedule" ||
        nextAction.type === "await_manual_run" ||
        nextAction.type === "lifecycle_command_pending",
      reasonCodes: uniqueReasonCodes(nextAction.reasonCodes || [], handoff.failureReasonCodes || [], handoff.providerReasonCodes || [])
    },
    userVisibleHandoff: {
      title: handoff.blocked ? "Contradiction-check handoff required" : "Contradiction-check handoff ready",
      route: targetRoute,
      actionType: nextAction.type,
      actionLabel: nextAction.label,
      blocked: handoff.blocked,
      runnable: nextAction.runnable,
      runState: nextAction.runState || null,
      nextRunAt: nextAction.nextRunAt || null,
      effectiveAt: nextAction.effectiveAt || null,
      retryable: Boolean(handoff.retryable),
      retryAfterMs: handoff.retryAfterMs || null
    },
    ready: validationErrors.length === 0,
    validationErrors
  };
}

function buildClientHandoffAdoption({ request, clientState, handoff, nextAction, clientRuntime, readiness, acceptance, resolutionManifest, persistedState }) {
  const targetRoute = clientRuntime.navigation.targetRoute || handoff.route || nextAction.route;
  const targetStep = clientRuntime.navigation.targetStep || handoff.nextStep;
  const expectedWorkflowState = readiness.canAccept
    ? "ready-for-proof-export"
    : handoff.blocked
      ? "blocked-by-contradiction-check"
      : persistedState.recoveryRequired
        ? "recovering-contradiction-check"
        : "review-contradiction-check";
  const statePatchOperations = [];
  const validationErrors = [];

  if (clientRuntime.currentRoute !== targetRoute) {
    statePatchOperations.push({
      type: clientRuntime.navigation.replace ? "replace_route" : "set_route",
      path: "route.current",
      value: targetRoute,
      previousValue: clientRuntime.currentRoute || null
    });
  }

  if (clientState.currentStep !== targetStep) {
    statePatchOperations.push({
      type: "set_workflow_step",
      path: "workflow.currentStep",
      value: targetStep,
      previousValue: clientState.currentStep || null
    });
  }

  if (clientState.priorGate !== surfaceName) {
    statePatchOperations.push({
      type: "stamp_prior_gate",
      path: "workflow.priorGate",
      value: surfaceName,
      previousValue: clientState.priorGate || null
    });
  }

  if (clientRuntime.handoffCursor) {
    statePatchOperations.push({
      type: "set_handoff_cursor",
      path: "workflow.handoffCursor",
      value: clientRuntime.handoffCursor,
      previousValue: null
    });
  }

  const acknowledgementReasonCodes = acceptance.accepted
    ? []
    : uniqueReasonCodes(acceptance.requiredAcknowledgements, readiness.reasonCodes, nextAction.reasonCodes || []);
  const proofExportArmed = acceptance.accepted && readiness.canExportProof && resolutionManifest.exportManifestKey;

  if (statePatchOperations.length > 0 && !clientRuntime.capabilities.effective.includes("handoff-state")) {
    validationErrors.push({
      code: "client_handoff_state_patch_unsupported",
      message: "Client runtime must support handoff-state before applying contradiction-check workflow mutations.",
      operationTypes: statePatchOperations.map((operation) => operation.type)
    });
  }

  if (clientRuntime.navigation.replace && !clientRuntime.capabilities.effective.includes("route-replace")) {
    validationErrors.push({
      code: "client_route_replace_unsupported",
      message: "Client runtime must support route-replace before adopting the selected contradiction-check route.",
      sourceRoute: clientRuntime.currentRoute,
      targetRoute
    });
  }

  const adoptionState = validationErrors.length > 0 || !clientRuntime.ready
    ? "blocked"
    : persistedState.recoveryRequired
      ? "recovering"
      : statePatchOperations.length > 0
        ? "patch-required"
        : proofExportArmed
          ? "proof-export-armed"
          : "adopted";

  return {
    contractVersion: "contradiction-check.client-handoff-adoption.v1",
    requestId: request.id,
    sessionId: clientState.sessionId,
    workflowId: clientState.workflowId,
    adoptionState,
    ready: adoptionState !== "blocked",
    routeTransition: {
      from: clientRuntime.currentRoute || request.route,
      to: targetRoute,
      replace: clientRuntime.navigation.replace,
      preserveScroll: clientRuntime.navigation.preserveScroll,
      reasonCodes: clientRuntime.navigation.reasonCodes
    },
    statePatch: {
      required: statePatchOperations.length > 0,
      expectedWorkflowState,
      operations: statePatchOperations
    },
    storageWrites: [
      {
        key: `contradiction-check:${clientState.workflowId}:handoff`,
        value: {
          requestId: request.id,
          route: targetRoute,
          step: targetStep,
          cursor: clientRuntime.handoffCursor || null,
          restartSafeStatus: persistedState.restartSafeStatus
        }
      }
    ],
    acknowledgement: {
      required: acknowledgementReasonCodes.length > 0,
      requiredReasonCodes: acknowledgementReasonCodes,
      route: acceptance.decisionRoute,
      label: acceptance.accepted ? "Proof export accepted" : "Acknowledge contradiction-check review hold"
    },
    proofExport: {
      armed: Boolean(proofExportArmed),
      route: "verifier-claim-gate/proof-export",
      token: acceptance.proofExportToken,
      exportManifestKey: resolutionManifest.exportManifestKey,
      exportableClaimIds: resolutionManifest.exportableClaimIds
    },
    userVisibleHandoff: {
      title: clientRuntime.userVisibleHandoff.title,
      actionLabel: clientRuntime.userVisibleHandoff.actionLabel,
      route: targetRoute,
      blocked: handoff.blocked || adoptionState === "blocked",
      recoveryRequired: persistedState.recoveryRequired,
      nextStep: targetStep
    },
    validationErrors
  };
}

export function describeContradictionCheckSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const request = normalizeRequest(input);
  const clientState = normalizeClientState(input);
  const sourceClaims = asList(input.claims).map(normalizeClaim).filter((claim) => claim.text);
  const sourceEvidence = asList(input.evidence).map(normalizeEvidence).filter((item) => item.text || item.verdict);
  const blockingSeverity = normalizeSeverity(input.blockingSeverity, DEFAULT_BLOCKING_SEVERITY);
  const lifecycleControls = normalizeLifecycleControls(input, now);
  const providerContract = normalizeProviderContract(input);
  const accessBoundary = normalizeAccessBoundary(input, request, clientState, sourceClaims, sourceEvidence);
  const tenantIsolation = applyAccessBoundaryScope({
    claims: sourceClaims,
    evidence: sourceEvidence,
    accessBoundary
  });
  const claims = tenantIsolation.scopedClaims;
  const evidence = tenantIsolation.scopedEvidence;
  const contradictions = buildContradictions(claims, evidence);
  const missingEvidenceClaimIds = claims
    .filter((claim) => claim.requiresVerification)
    .filter((claim) => !evidence.some((item) => item.claimId === claim.id))
    .map((claim) => claim.id);
  const retryState = normalizeRetryState(input);
  const historySnapshots = normalizeHistorySnapshots(input);
  const persistedState = normalizePersistedState(input, request, clientState, lifecycleControls, now);
  const kernelExecutionHealth = normalizeKernelExecutionHealth(input, now);
  const operationalHealth = buildOperationalHealth({
    claims,
    evidence,
    contradictions,
    missingEvidenceClaimIds,
    retryState,
    lifecycleControls,
    providerContract,
    accessBoundary,
    persistedState,
    kernelExecutionHealth
  });
  const baseHandoff = buildWorkflowHandoff({ request, clientState, contradictions, blockingSeverity });
  const operationalHandoff = shapeOperationalHandoff(baseHandoff, operationalHealth);
  const nextAction = buildNextAction({ handoff: operationalHandoff, operationalHealth, lifecycleControls });
  const lifecycleHandoff = shapeLifecycleHandoff(operationalHandoff, lifecycleControls, nextAction);
  const handoff = shapeProviderHandoff(lifecycleHandoff, providerContract);
  const clientRuntime = buildClientRuntimeContract({
    input,
    request,
    clientState,
    handoff,
    nextAction,
    providerContract
  });
  const validationSummary = buildValidationSummary({
    claims,
    evidence,
    contradictions,
    missingEvidenceClaimIds,
    operationalHealth,
    lifecycleControls,
    providerContract,
    accessBoundary,
    tenantIsolation,
    clientRuntime,
    persistedState,
    kernelExecutionHealth,
    blockingSeverity
  });
  const readiness = buildReadinessContract({
    request,
    clientState,
    handoff,
    operationalHealth,
    lifecycleControls,
    providerContract,
    accessBoundary,
    clientRuntime,
    persistedState,
    kernelExecutionHealth,
    validationSummary
  });
  const acceptance = buildAcceptanceContract({
    request,
    clientState,
    handoff,
    validationSummary,
    readiness,
    contradictions,
    providerContract
  });
  const claimResolutionPackets = buildClaimResolutionPackets({
    request,
    clientState,
    claims,
    evidence,
    contradictions,
    validationSummary,
    accessBoundary,
    providerContract
  });
  const resolutionManifest = buildResolutionManifest({
    request,
    clientState,
    claimResolutionPackets,
    readiness,
    acceptance
  });
  const clientHandoffAdoption = buildClientHandoffAdoption({
    request,
    clientState,
    handoff,
    nextAction,
    clientRuntime,
    readiness,
    acceptance,
    resolutionManifest,
    persistedState
  });
  const uiPreview = buildUserPreview({
    request,
    clientState,
    claims,
    evidence,
    contradictions,
    claimResolutionPackets,
    resolutionManifest,
    handoff,
    clientRuntime,
    clientHandoffAdoption,
    persistedState,
    kernelExecutionHealth,
    validationSummary,
    readiness,
    acceptance
  });
  const explainableNextSteps = buildExplainableNextSteps({
    handoff,
    readiness,
    acceptance,
    operationalHealth,
    providerContract,
    persistedState,
    kernelExecutionHealth
  });
  const clientRouteContracts = buildClientRouteContracts({
    request,
    clientState,
    uiPreview,
    validationSummary,
    readiness,
    acceptance,
    explainableNextSteps,
    resolutionManifest,
    clientRuntime,
    clientHandoffAdoption
  });
  const analytics = buildAnalytics({
    claims,
    evidence,
    contradictions,
    claimResolutionPackets,
    missingEvidenceClaimIds,
    operationalHealth,
    handoff,
    historySnapshots,
    lifecycleControls,
    providerContract,
    accessBoundary,
    tenantIsolation,
    clientRuntime,
    clientHandoffAdoption,
    persistedState,
    kernelExecutionHealth
  });
  const timeline = buildTimeline({
    now,
    request,
    clientState,
    contradictions,
    operationalHealth,
    handoff,
    historySnapshots,
    lifecycleControls,
    providerContract,
    accessBoundary,
    tenantIsolation,
    clientRuntime,
    clientHandoffAdoption,
    persistedState,
    kernelExecutionHealth,
    nextAction
  });
  const exportSummary = buildExportSummary({
    request,
    clientState,
    analytics,
    contradictions,
    missingEvidenceClaimIds,
    operationalHealth,
    handoff,
    lifecycleControls,
    providerContract,
    accessBoundary,
    tenantIsolation,
    clientRuntime,
    clientHandoffAdoption,
    persistedState,
    kernelExecutionHealth,
    nextAction,
    validationSummary,
    readiness,
    acceptance,
    nextSteps: explainableNextSteps,
    resolutionManifest,
    clientRouteContracts
  });

  return {
    ok: !handoff.blocked && operationalHealth.state !== "failed",
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'verifier claim gate contradiction check runtime contract',
    request,
    clientState,
    policy: {
      blockingSeverity,
      contradictionVerdicts: ["contradicts", "refuted", "false", "conflict"],
      lifecycleCommands: [...SUPPORTED_LIFECYCLE_COMMANDS],
      scheduleModes: [...SUPPORTED_SCHEDULE_MODES],
      scheduleIntervalBoundsMs: {
        min: MIN_SCHEDULE_INTERVAL_MS,
        max: MAX_SCHEDULE_INTERVAL_MS
      },
      lifecycleControls: {
        disableReasonRequired: true,
        pauseReasonRequired: true,
        futureEffectiveCommands: "pending",
        runNowRequiresEnabledAndUnpaused: true
      },
      requiredProviderCapabilities: REQUIRED_PROVIDER_CAPABILITIES,
      optionalProviderCapabilities: OPTIONAL_PROVIDER_CAPABILITIES,
      providerHandoffModes: [...SUPPORTED_HANDOFF_MODES],
      maxProviderSyncAgeMs: MAX_SYNC_AGE_MS,
      kernelExecutionHealth: {
        maxHeartbeatAgeMs: MAX_KERNEL_HEARTBEAT_AGE_MS,
        maxExecutionLatencyMs: MAX_KERNEL_EXECUTION_LATENCY_MS,
        maxQueueDepth: MAX_KERNEL_QUEUE_DEPTH,
        circuitStates: [...SUPPORTED_CIRCUIT_STATES]
      },
      requiredGatePermissions: REQUIRED_GATE_PERMISSIONS,
      rolePermissionGrants: ROLE_PERMISSION_GRANTS,
      clientRuntimeCapabilities: CLIENT_RUNTIME_CAPABILITIES,
      maxPersistedCommandReceipts: MAX_PERSISTED_COMMAND_RECEIPTS,
      maxRecoveryLeaseAgeMs: MAX_RECOVERY_LEASE_AGE_MS,
      persistedCheckpointStatuses: [...SUPPORTED_PERSISTED_CHECKPOINT_STATUSES]
    },
    lifecycleControls,
    providerContract,
    accessBoundary,
    tenantIsolation,
    clientRuntime,
    clientHandoffAdoption,
    persistedState,
    kernelExecutionHealth,
    claims,
    evidence,
    contradictions,
    validationSummary,
    readiness,
    acceptance,
    claimResolutionPackets,
    resolutionManifest,
    uiPreview,
    explainableNextSteps,
    clientRouteContracts,
    operationalHealth,
    retryState,
    analytics,
    history: {
      retainedSnapshotCount: historySnapshots.length,
      maxRetainedSnapshots: MAX_HISTORY_SNAPSHOTS,
      snapshots: historySnapshots
    },
    timeline,
    report: exportSummary,
    audit: {
      checkedClaimCount: claims.length,
      checkedEvidenceCount: evidence.length,
      contradictionCount: contradictions.length,
      missingEvidenceClaimIds,
      healthState: operationalHealth.state,
      healthIssueCodes: operationalHealth.issues.map((issue) => issue.code),
      lifecycleEnabled: lifecycleControls.enabled,
      lifecyclePaused: lifecycleControls.paused,
      lifecycleCommand: lifecycleControls.command.type || "none",
      lifecycleCommandDisposition: lifecycleControls.command.disposition,
      lifecycleCommandPending: lifecycleControls.command.pending,
      lifecycleCommandEffectiveAt: lifecycleControls.command.effectiveAt || null,
      lifecycleExecutionSuppressed: lifecycleControls.controls.executionSuppressed,
      lifecycleSettingsErrorCodes: lifecycleControls.validationErrors.map((error) => error.code),
      providerId: providerContract.providerId,
      providerReady: providerContract.ready,
      providerMissingCapabilities: providerContract.capabilities.missing,
      providerSyncCursor: providerContract.sync.cursor || null,
      externalHandoffState: providerContract.externalHandoff.state,
      actorId: accessBoundary.actorId,
      tenantId: accessBoundary.tenantId,
      workspaceId: accessBoundary.workspaceId,
      accessBoundaryReady: accessBoundary.ready,
      missingGatePermissions: accessBoundary.permissions.missing,
      claimScopeViolationIds: accessBoundary.claimScopeViolations.map((item) => item.claimId),
      evidenceScopeViolationIds: accessBoundary.evidenceScopeViolations.map((item) => item.evidenceId),
      tenantIsolationState: tenantIsolation.isolationState,
      tenantIsolationMode: tenantIsolation.enforcementMode,
      sourceClaimCountBeforeIsolation: tenantIsolation.sourceCounts.claims,
      sourceEvidenceCountBeforeIsolation: tenantIsolation.sourceCounts.evidence,
      scopedClaimCountAfterIsolation: tenantIsolation.scopedCounts.claims,
      scopedEvidenceCountAfterIsolation: tenantIsolation.scopedCounts.evidence,
      quarantinedClaimIds: tenantIsolation.quarantinedResources.claims.map((item) => item.claimId),
      quarantinedEvidenceIds: tenantIsolation.quarantinedResources.evidence.map((item) => item.evidenceId),
      tenantIsolationAuditRoute: tenantIsolation.auditHandoff.route,
      tenantIsolationAuditRequired: tenantIsolation.auditHandoff.required,
      tenantIsolationReasonCodes: tenantIsolation.auditHandoff.reasonCodes,
      clientRuntimeReady: clientRuntime.ready,
      clientCurrentRoute: clientRuntime.currentRoute,
      clientTargetRoute: clientRuntime.navigation.targetRoute,
      clientHandoffCursor: clientRuntime.handoffCursor || null,
      clientRuntimeErrorCodes: clientRuntime.validationErrors.map((error) => error.code),
      clientRuntimeMissingCapabilities: clientRuntime.missingCapabilities,
      clientHandoffAdoptionState: clientHandoffAdoption.adoptionState,
      clientHandoffAdoptionReady: clientHandoffAdoption.ready,
      clientHandoffPatchRequired: clientHandoffAdoption.statePatch.required,
      clientHandoffPatchOperationTypes: clientHandoffAdoption.statePatch.operations.map((operation) => operation.type),
      clientHandoffStorageKeys: clientHandoffAdoption.storageWrites.map((write) => write.key),
      clientHandoffAcknowledgementRequired: clientHandoffAdoption.acknowledgement.required,
      clientHandoffAcknowledgementReasonCodes: clientHandoffAdoption.acknowledgement.requiredReasonCodes,
      clientHandoffProofExportArmed: clientHandoffAdoption.proofExport.armed,
      clientHandoffAdoptionErrorCodes: clientHandoffAdoption.validationErrors.map((error) => error.code),
      persistedRestartSafeStatus: persistedState.restartSafeStatus,
      persistedStateReady: persistedState.ready,
      persistedRecoveredFromCheckpoint: persistedState.recoveredFromCheckpoint,
      persistedRecoveryRequired: persistedState.recoveryRequired,
      persistedCheckpointCursor: persistedState.checkpoint.cursor,
      persistedCheckpointRevision: persistedState.checkpoint.revision,
      persistedRecoveryLeaseActive: persistedState.recoveryLease.active,
      persistedRecoveryLeaseStale: persistedState.recoveryLease.stale,
      persistedRecoveryLeaseOwner: persistedState.recoveryLease.owner,
      persistedRecoveryLeaseEpoch: persistedState.recoveryLease.epoch,
      persistedCommandDisposition: persistedState.commandLedger.disposition,
      persistedActiveIdempotencyKey: persistedState.commandLedger.activeIdempotencyKey,
      persistedWritePlanRequired: persistedState.writePlan.required,
      persistedWritePlanMode: persistedState.writePlan.mode,
      persistedWriteOperationTypes: persistedState.writePlan.operations.map((operation) => operation.type),
      persistedRecoveryPathTypes: persistedState.recoveryPaths.map((path) => path.type),
      persistedStateErrorCodes: persistedState.validationErrors.map((error) => error.code),
      kernelExecutionState: kernelExecutionHealth.state,
      kernelCircuitState: kernelExecutionHealth.circuitState,
      kernelHeartbeatAgeMs: kernelExecutionHealth.heartbeatAgeMs,
      kernelQueueDepth: kernelExecutionHealth.queue.depth,
      kernelQueueSaturated: kernelExecutionHealth.queue.saturated,
      kernelExecutionLatencyMs: kernelExecutionHealth.latency.executionMs,
      kernelExecutionLatencyBreached: kernelExecutionHealth.latency.breached,
      kernelDependencyIds: kernelExecutionHealth.dependencies.map((dependency) => dependency.id),
      kernelUnavailableDependencyIds: kernelExecutionHealth.dependencies
        .filter((dependency) => !dependency.ready)
        .map((dependency) => dependency.id),
      kernelDegradedReasonCodes: kernelExecutionHealth.degradedMode.reasonCodes,
      kernelRetryAfterMs: kernelExecutionHealth.retryPlan.retryAfterMs,
      kernelExecutionErrorCodes: kernelExecutionHealth.validationErrors.map((error) => error.code),
      scheduleMode: lifecycleControls.schedule.mode,
      scheduledNextRunAt: lifecycleControls.schedule.nextRunAt || null,
      scheduleRequestedNextRunAt: lifecycleControls.schedule.requestedNextRunAt,
      scheduleComputedNextRunAt: lifecycleControls.schedule.computedNextRunAt,
      scheduleRunState: lifecycleControls.schedule.runState,
      scheduleDue: lifecycleControls.schedule.due,
      scheduleOverdueMs: lifecycleControls.schedule.overdueMs,
      scheduleTriggerReasonCodes: lifecycleControls.schedule.triggerReasonCodes,
      scheduleEvidenceCursor: lifecycleControls.schedule.evidenceCursor,
      scheduleProcessedEvidenceCursor: lifecycleControls.schedule.processedEvidenceCursor,
      scheduleEvidenceChanged: lifecycleControls.schedule.evidenceChanged,
      nextAction,
      readinessState: readiness.state,
      canAccept: readiness.canAccept,
      canExportProof: readiness.canExportProof,
      acceptanceDecision: acceptance.decision,
      resolutionManifestState: resolutionManifest.state,
      exportableClaimIds: resolutionManifest.exportableClaimIds,
      blockedClaimIds: resolutionManifest.blockedClaimIds,
      packetsRequiringProof: resolutionManifest.packetsRequiringProof,
      resolutionExportManifestKey: resolutionManifest.exportManifestKey,
      validationErrorCodes: validationSummary.errorCodes,
      validationWarningCodes: validationSummary.warningCodes,
      previewPrimaryActionRoute: uiPreview.primaryAction.route,
      nextStepIds: explainableNextSteps.steps.map((step) => step.id),
      clientRouteContractVersion: clientRouteContracts.contractVersion,
      clientRouteActiveRoute: clientRouteContracts.activeRoute,
      clientRouteOrder: clientRouteContracts.routeOrder,
      clientRouteEnabledActionIds: clientRouteContracts.consumableActions
        .filter((action) => action.enabled)
        .map((action) => action.id),
      clientRouteDisabledActionIds: clientRouteContracts.consumableActions
        .filter((action) => !action.enabled)
        .map((action) => action.id),
      retryable: operationalHealth.retryable,
      proofRefs: contradictions.map((item) => item.proofRef).filter(Boolean),
      analyticsCounters: analytics.counters,
      exportType: exportSummary.exportType,
      readyForProofExport: exportSummary.readyForProofExport,
      timelineEventCount: timeline.length
    },
    handoff
  };
}

export default describeContradictionCheckSurface;
