export const surfaceId = "aios_scheduler_lease-manager_054";
export const surfaceGroup = "scheduler";
export const surfaceName = "lease-manager";

const lifecycleCommands = new Set([
  "inspect",
  "enable",
  "disable",
  "renew",
  "release",
  "quarantine"
]);

const leaseStatuses = new Set([
  "active",
  "disabled",
  "expired",
  "released",
  "quarantined",
  "unknown"
]);

const knownProviderCapabilities = new Set([
  "lease.read",
  "lease.acquire",
  "lease.renew",
  "lease.release",
  "lease.quarantine",
  "lease.observe",
  "sync.cursor",
  "handoff.external",
  "handoff.ack"
]);

const supportedServiceProtocols = new Set([
  "hosted-kernel.v1",
  "local-kernel.v1"
]);

const providerServiceModes = new Set([
  "active",
  "passive",
  "mirror"
]);

const clientHandoffIntents = new Set([
  "apply",
  "preview",
  "resync",
  "inspect-health",
  "handoff"
]);

const clientChannels = new Set([
  "api",
  "console",
  "worker",
  "automation",
  "unknown"
]);

const handoffAcknowledgementStates = new Set([
  "acknowledged",
  "pending",
  "rejected",
  "expired"
]);

const mutatingLifecycleCommands = new Set([
  "enable",
  "disable",
  "renew",
  "release",
  "quarantine"
]);

const tenantPermissionRoles = Object.freeze({
  "lease.viewer": ["inspect"],
  "lease.operator": ["inspect", "renew", "release"],
  "lease.admin": [...lifecycleCommands],
  "scheduler.service": [...lifecycleCommands]
});

const boundaryScopedActions = new Set([
  "quarantine-lease",
  "reacquire-lease",
  "release-lease",
  "renew-lease"
]);

const actionPermissionCommand = Object.freeze({
  "disable-manager": "disable",
  "enable-manager": "enable",
  "quarantine-lease": "quarantine",
  "reacquire-lease": "renew",
  "release-lease": "release",
  "renew-lease": "renew"
});

const localKernelCapabilities = Object.freeze([
  "lease.read",
  "lease.acquire",
  "lease.renew",
  "lease.release",
  "lease.quarantine",
  "sync.cursor"
]);

const requiredCapabilitiesByAction = Object.freeze({
  "disable-manager": [],
  "enable-manager": [],
  "quarantine-lease": ["lease.quarantine"],
  "reacquire-lease": ["lease.acquire"],
  "release-lease": ["lease.release"],
  "renew-lease": ["lease.renew"],
  reject: [],
  sleep: ["lease.read"]
});

const defaultSettings = Object.freeze({
  enabled: true,
  renewBeforeMs: 60_000,
  maxLeaseMs: 15 * 60_000,
  minLeaseMs: 5_000,
  schedulerIntervalMs: 10_000,
  healthStaleAfterMs: 30_000,
  retryBaseMs: 2_000,
  retryMaxMs: 60_000,
  schedulerPausedUntil: null,
  quarantineOnClockSkew: true
});

const ownerFencedActions = new Set([
  "renew-lease",
  "release-lease"
]);

export const leaseManagerContract = Object.freeze({
  command: [...lifecycleCommands],
  status: [...leaseStatuses],
  settings: {
    enabled: "boolean",
    renewBeforeMs: "integer >= 1000",
    maxLeaseMs: "integer >= minLeaseMs",
    minLeaseMs: "integer >= 1000",
    schedulerIntervalMs: "integer >= 1000",
    healthStaleAfterMs: "integer >= schedulerIntervalMs",
    retryBaseMs: "integer >= 100",
    retryMaxMs: "integer >= retryBaseMs",
    schedulerPausedUntil: "optional timestamp; future values pause lifecycle mutations until that time",
    quarantineOnClockSkew: "boolean"
  },
  proof: {
    actionId: "stable lifecycle action identifier",
    accepted: "whether command can be applied",
    reasons: "validation and state transition evidence"
  },
  provider: {
    id: "stable integration provider identifier",
    endpoint: "optional external scheduler/lease service endpoint",
    capabilities: [...knownProviderCapabilities],
    requiredCapabilitiesByAction,
    serviceContract: {
      protocol: "hosted-kernel.v1 | local-kernel.v1",
      apiVersion: "provider API version used for external lifecycle handoff",
      namespace: "lease namespace used to scope provider-side idempotency",
      mode: "active | passive | mirror",
      requiresAck: "whether external handoff must be acknowledged before local mutation is accepted",
      handoffTtlMs: "maximum time the provider may hold an external handoff request"
    }
  },
  sync: {
    cursor: "provider cursor or lease generation used for idempotent sync",
    sequence: "monotonic provider-observed sequence number",
    staleAfterMs: "maximum tolerated cursor age before resync is requested",
    scope: "provider/lease/namespace binding observed with the cursor when supplied",
    consistency: "scope, sequence, and age checks that decide whether provider resync is required"
  },
  handoff: {
    target: "external handoff target when hosted-kernel work leaves local scheduler",
    state: "pending | ready | blocked | not-required",
    payload: "minimal action payload for downstream provider",
    acknowledgement: "provider ack contract required before local hosted-kernel mutation is accepted"
  },
  clientRequest: {
    requestId: "stable request identifier used for user-visible workflow tracing",
    actor: "client or automation identity requesting the lifecycle action",
    channel: "api | console | worker | automation | unknown",
    intent: "apply | preview | resync | inspect-health | handoff",
    route: "originating client route metadata",
    capabilities: "client capabilities used to decide workflow handoff affordances",
    runtime: "worker/runtime lease claim supplied by the client for fenced renew/release handoff",
    workflow: "client-visible handoff decision and warnings"
  },
  persistedState: {
    key: "stable persistence key for restart recovery",
    generation: "monotonic lease/sync generation",
    phase: "bootstrapped | restored | command-applied | command-replayed | recovery-required",
    idempotencyKey: "stable key used to dedupe lifecycle commands after restart",
    recovery: "restart-safe recovery classification and reasons",
    commandJournal: "bounded normalized idempotency journal used to replay or suppress commands after restart",
    replay: "typed replay/resync/skip decision for the current lifecycle command"
  },
  ownership: {
    holder: "worker or provider identity currently holding the lease",
    expectedHolder: "worker identity that must own fenced renew/release mutations",
    fencingToken: "opaque owner token used to reject stale or split-brain writes",
    ownerClaim: "provider claim, alias, generation, and fencing-token checks for the current owner",
    stale: "whether the owner heartbeat or expiry indicates the holder is stale",
    recoverySafe: "whether the current action can safely mutate or recover the lease"
  },
  preview: {
    headline: "short user-visible lifecycle outcome",
    severity: "info | success | warning | danger",
    primaryAction: "button/action label clients can render",
    blockingReasons: "human-readable reasons preventing acceptance"
  },
  readiness: {
    state: "ready | blocked | degraded | needs-resync | preview-only | paused",
    canMutate: "whether a route/client may apply the lifecycle action",
    checks: "named readiness checks with pass/fail state"
  },
  acceptance: {
    accepted: "whether the current lifecycle action is accepted",
    mode: "mutating | preview-only | degraded-mode | resync-required | scheduler-paused | blocked",
    blockedBy: "failed readiness check identifiers"
  },
  transition: {
    mode: "noop | local-state | hosted-call | hosted-handoff | blocked",
    commit: "typed scheduler/provider mutation envelope for the selected lifecycle action",
    resultingLease: "projected lease state after the lifecycle action commits",
    auditEvents: "append-only audit events clients and hosted providers can persist"
  },
  health: {
    state: "healthy | degraded | failed | unknown",
    failureState: "normal | retrying | circuit-open | terminal",
    degradedMode: "whether hosted-kernel mutations should be paused but inspected",
    observedAt: "last operational heartbeat timestamp",
    inputContract: "validation result for supplied health telemetry shape and accepted/rejected failure entries",
    failures: "normalized provider/scheduler failures with retryability and action hints",
    retry: "deterministic exponential backoff contract for retryable failures",
    failurePolicy: "typed failure classification, circuit breaker state, and mutation safety decision",
    actionableErrors: "operator-facing errors with route intent and remediation"
  },
  nextStep: {
    routeIntent: "stable client route/action intent",
    method: "suggested route method",
    href: "relative route path for clients",
    body: "minimal request body for route consumers"
  },
  workflowSummary: {
    viewModelVersion: "versioned user-visible lease lifecycle workflow contract",
    banner: "preview banner clients can render without interpreting proof internals",
    validation: "compact pass/fail validation counts and blocking checks",
    acceptance: "accepted/mode/proof identity for route confirmation",
    actions: "ordered route actions with enablement and explanation metadata",
    handoffReceipt: "client-facing hosted handoff receipt, confirmation route, deadline, and ack requirements",
    reviewGate: "user-visible preview review gate with required decisions, selected route, and submission contract",
    audit: "proof, transition, and idempotency pointers for client-side audit panels",
    analytics: "export-ready counters, reporting timeline, and history summary for scheduler operations"
  },
  reviewGate: {
    schemaVersion: "lease-manager.review-gate.v1",
    state: "approved | preview | blocked | needs-resync | needs-health-review | needs-handoff-confirmation",
    title: "short route/client title for the current review step",
    decisionRequired: "whether the client must capture an explicit user/operator decision",
    requiredDecisions: "ordered operator/client acknowledgements required before submitting a lifecycle route",
    selectedRoute: "route contract clients should submit when the gate is resolved",
    submission: "submit-ready selected route body with explicit acknowledgements, disabled reasons, and proof binding",
    availableRoutes: "route alternatives for apply, resync, diagnostics, retry, override, and handoff confirmation",
    reviewItems: "compact explainable facts shown before accepting or blocking the action",
    proof: "proof and audit pointers used to tie the submitted decision back to validation output"
  },
  analytics: {
    schemaVersion: "lease-manager.analytics.v1",
    counters: "current-window counts grouped by action, readiness, acceptance, health, and handoff state",
    history: "bounded normalized lifecycle snapshots safe for UI history and export pipelines",
    timeline: "ordered reporting events with severity, route intent, and audit pointers",
    exportSummary: "stable CSV/JSON export contract with report identity, scope, columns, and row count"
  },
  schedulerControls: {
    state: "ready | idle | paused | backoff | needs-resync | preview-only | blocked",
    canApply: "whether the selected lifecycle action may mutate scheduler/provider state now",
    canSchedule: "whether the manager may enqueue the selected action for a later scheduler tick",
    nextRunAt: "next scheduler tick or lifecycle action time",
    pausedUntil: "retry/backoff timestamp when scheduler mutation is paused",
    controls: "enable/disable/resync/retry controls clients may render",
    policyReasons: "normalized scheduling policy decisions used by audit proof"
  },
  errorRoutes: {
    diagnostics: "route body for inspecting operational-health failures",
    retry: "route body for retrying after backoff when failure policy allows it",
    override: "route body for operator override when a terminal failure blocks mutation"
  },
  tenantBoundary: {
    tenantId: "tenant identifier that must match lease/provider/client claims before mutation",
    workspaceId: "workspace identifier used to scope idempotency, handoff, and audit output",
    roles: Object.keys(tenantPermissionRoles),
    allowedCommands: "commands permitted by the supplied actor roles",
    auditSubject: "stable tenant/workspace/actor tuple for audit handoff",
    blockers: "boundary or permission failures that prevent lifecycle mutation"
  }
});

function parseTimestamp(value, fallback) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : fallback;
  }
  return fallback;
}

function asPositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function asNonNegativeInteger(value, fallback = null) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function normalizeOptionalTimestamp(value) {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  const ms = parseTimestamp(value, null);
  return Number.isFinite(ms)
    ? { ok: true, value: new Date(ms).toISOString(), ms }
    : { ok: false, value: null };
}

export function validateLeaseManagerSettings(settings = {}) {
  const requested = settings && typeof settings === "object" ? settings : {};
  const schedulerPausedUntil = normalizeOptionalTimestamp(
    requested.schedulerPausedUntil ?? requested.pausedUntil ?? requested.pauseUntil
  );
  const normalized = {
    enabled: typeof requested.enabled === "boolean" ? requested.enabled : defaultSettings.enabled,
    renewBeforeMs: asPositiveInteger(requested.renewBeforeMs, defaultSettings.renewBeforeMs),
    maxLeaseMs: asPositiveInteger(requested.maxLeaseMs, defaultSettings.maxLeaseMs),
    minLeaseMs: asPositiveInteger(requested.minLeaseMs, defaultSettings.minLeaseMs),
    schedulerIntervalMs: asPositiveInteger(
      requested.schedulerIntervalMs,
      defaultSettings.schedulerIntervalMs
    ),
    healthStaleAfterMs: asPositiveInteger(requested.healthStaleAfterMs, defaultSettings.healthStaleAfterMs),
    retryBaseMs: asPositiveInteger(requested.retryBaseMs, defaultSettings.retryBaseMs),
    retryMaxMs: asPositiveInteger(requested.retryMaxMs, defaultSettings.retryMaxMs),
    schedulerPausedUntil: schedulerPausedUntil.value,
    quarantineOnClockSkew:
      typeof requested.quarantineOnClockSkew === "boolean"
        ? requested.quarantineOnClockSkew
        : defaultSettings.quarantineOnClockSkew
  };
  const errors = [];
  if (normalized.minLeaseMs < 1_000) {
    errors.push("minLeaseMs must be at least 1000ms");
  }
  if (normalized.renewBeforeMs < 1_000) {
    errors.push("renewBeforeMs must be at least 1000ms");
  }
  if (normalized.schedulerIntervalMs < 1_000) {
    errors.push("schedulerIntervalMs must be at least 1000ms");
  }
  if (normalized.healthStaleAfterMs < normalized.schedulerIntervalMs) {
    errors.push("healthStaleAfterMs must be greater than or equal to schedulerIntervalMs");
  }
  if (normalized.retryBaseMs < 100) {
    errors.push("retryBaseMs must be at least 100ms");
  }
  if (normalized.retryMaxMs < normalized.retryBaseMs) {
    errors.push("retryMaxMs must be greater than or equal to retryBaseMs");
  }
  if (normalized.maxLeaseMs < normalized.minLeaseMs) {
    errors.push("maxLeaseMs must be greater than or equal to minLeaseMs");
  }
  if (normalized.renewBeforeMs >= normalized.maxLeaseMs) {
    errors.push("renewBeforeMs must be lower than maxLeaseMs");
  }
  if (!schedulerPausedUntil.ok) {
    errors.push("schedulerPausedUntil must be a valid timestamp when supplied");
  }
  return {
    ok: errors.length === 0,
    settings: normalized,
    errors
  };
}

function normalizeLeaseState(input, nowMs, settings) {
  const lease = input && typeof input === "object" ? input : {};
  const issuedAtMs = parseTimestamp(lease.issuedAt, nowMs);
  const expiresAtMs = parseTimestamp(lease.expiresAt, issuedAtMs + settings.maxLeaseMs);
  const observedStatus = leaseStatuses.has(lease.status) ? lease.status : "unknown";
  const remainingMs = Math.max(0, expiresAtMs - nowMs);
  const ageMs = Math.max(0, nowMs - issuedAtMs);
  const clockSkewMs = issuedAtMs > nowMs ? issuedAtMs - nowMs : 0;
  const status =
    observedStatus === "active" && remainingMs === 0
      ? "expired"
      : observedStatus === "unknown" && remainingMs > 0
        ? "active"
        : observedStatus;

  return {
    leaseId: typeof lease.leaseId === "string" && lease.leaseId ? lease.leaseId : "unassigned",
    holder: typeof lease.holder === "string" && lease.holder ? lease.holder : "kernel",
    tenantId: firstString(lease.tenantId, lease.tenant, lease.accountId),
    workspaceId: firstString(lease.workspaceId, lease.workspace, lease.namespace),
    status,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    ageMs,
    remainingMs,
    clockSkewMs,
    renewable: status === "active" && remainingMs <= settings.renewBeforeMs,
    expired: status === "expired" || remainingMs === 0,
    owner: normalizeLeaseOwnerMetadata(lease, {
      fallbackHolder: typeof lease.holder === "string" && lease.holder ? lease.holder : "kernel",
      issuedAtMs,
      expiresAtMs,
      nowMs,
      settings
    })
  };
}

function normalizeLeaseOwnerMetadata(lease, { fallbackHolder, issuedAtMs, expiresAtMs, nowMs, settings }) {
  const owner = lease.owner && typeof lease.owner === "object" ? lease.owner : {};
  const worker = lease.worker && typeof lease.worker === "object" ? lease.worker : {};
  const observedHolder =
    firstString(lease.observedHolder, lease.currentHolder, owner.holder, owner.id, worker.id, fallbackHolder) ??
    "kernel";
  const expectedHolder = firstString(
    lease.expectedHolder,
    lease.ownerId,
    lease.workerId,
    owner.expectedHolder,
    owner.expectedId,
    worker.expectedId,
    observedHolder
  );
  const fencingToken = firstString(
    lease.fencingToken,
    lease.fenceToken,
    lease.ownerToken,
    owner.fencingToken,
    owner.token,
    worker.fencingToken
  );
  const ownerGeneration =
    asNonNegativeInteger(lease.ownerGeneration) ??
    asNonNegativeInteger(owner.generation) ??
    asNonNegativeInteger(lease.generation) ??
    0;
  const heartbeatAtMs = parseTimestamp(
    lease.heartbeatAt ?? lease.renewedAt ?? owner.heartbeatAt ?? owner.observedAt ?? worker.heartbeatAt,
    issuedAtMs
  );
  const staleAfterMs = asPositiveInteger(
    lease.ownerStaleAfterMs ?? lease.heartbeatStaleAfterMs ?? owner.staleAfterMs,
    Math.max(settings.schedulerIntervalMs * 2, Math.min(settings.healthStaleAfterMs, settings.maxLeaseMs))
  );
  const heartbeatAgeMs = Math.max(0, nowMs - heartbeatAtMs);
  const expiredByClock = expiresAtMs <= nowMs;
  const heartbeatStale = heartbeatAgeMs > staleAfterMs;
  return {
    holder: observedHolder,
    expectedHolder,
    fencingToken,
    generation: ownerGeneration,
    heartbeatAt: new Date(heartbeatAtMs).toISOString(),
    heartbeatAgeMs,
    staleAfterMs,
    stale: expiredByClock || heartbeatStale,
    staleReasons: [
      expiredByClock ? "lease expiry has passed" : null,
      heartbeatStale ? `owner heartbeat is stale after ${heartbeatAgeMs}ms` : null
    ].filter(Boolean),
    matchesExpectedHolder: expectedHolder === null || observedHolder === expectedHolder,
    recoveryHint: expiredByClock || heartbeatStale ? "reacquire-or-resync" : "owner-current"
  };
}

function providerOwnerAliases(provider) {
  const aliases = new Set([provider.id, provider.service].filter((value) => typeof value === "string" && value));
  if (provider.serviceContract.protocol === "local-kernel.v1") {
    aliases.add("kernel");
    aliases.add("local-kernel");
    aliases.add("scheduler");
  }
  return aliases;
}

function buildProviderOwnerClaim({ lease, provider, sync }) {
  const aliases = providerOwnerAliases(provider);
  const holderClaimed = aliases.has(lease.owner.holder);
  const expectedClaimed = lease.owner.expectedHolder === null || aliases.has(lease.owner.expectedHolder);
  const generationFresh = sync.sequence >= lease.owner.generation;
  const successorGeneration = Math.max(sync.sequence + 1, lease.owner.generation + 1);
  const canFenceCurrentOwner =
    holderClaimed &&
    expectedClaimed &&
    generationFresh &&
    lease.owner.fencingToken !== null &&
    !lease.owner.stale;
  return {
    schemaVersion: "lease-owner-claim.v1",
    providerId: provider.id,
    providerAliases: [...aliases],
    holderClaimed,
    expectedClaimed,
    generationFresh,
    canFenceCurrentOwner,
    successorGeneration,
    observed: {
      holder: lease.owner.holder,
      expectedHolder: lease.owner.expectedHolder,
      generation: lease.owner.generation,
      fencingTokenPresent: lease.owner.fencingToken !== null,
      stale: lease.owner.stale
    },
    sync: {
      cursor: sync.cursor,
      sequence: sync.sequence,
      source: sync.source,
      stale: sync.stale
    },
    blockers: [
      holderClaimed ? null : `provider ${provider.id} does not claim observed holder ${lease.owner.holder}`,
      expectedClaimed
        ? null
        : `provider ${provider.id} does not claim expected holder ${lease.owner.expectedHolder}`,
      generationFresh
        ? null
        : `sync sequence ${sync.sequence} is behind owner generation ${lease.owner.generation}`,
      lease.owner.fencingToken !== null ? null : "owner claim is missing a fencing token",
      lease.owner.stale ? "owner claim is stale and must be recovered before fenced mutation" : null
    ].filter(Boolean)
  };
}

function buildOwnerRecoveryContract({ lease, provider, nextAction, sync, ownerClaim }) {
  const reacquireAction = nextAction.type === "reacquire-lease";
  const staleByExpiry = lease.expired || lease.status === "expired";
  const staleByHeartbeat = lease.owner.staleReasons.some((reason) => reason.includes("heartbeat"));
  const splitBrainObserved = lease.owner.expectedHolder !== null && !lease.owner.matchesExpectedHolder;
  const successorHolder = provider.id;
  const recoveryToken = [
    provider.id,
    lease.leaseId,
    lease.owner.generation,
    lease.owner.fencingToken ?? "unfenced",
    staleByExpiry ? "expired" : staleByHeartbeat ? "heartbeat-stale" : "not-stale"
  ].join(":");
  const required = reacquireAction || lease.owner.stale;
  const allowedByState = reacquireAction && (staleByExpiry || staleByHeartbeat);
  const generationFreshForRecovery = sync.sequence >= lease.owner.generation;
  const allowedByOwnership =
    staleByExpiry ||
    !splitBrainObserved ||
    lease.owner.expectedHolder === successorHolder ||
    lease.owner.holder === successorHolder ||
    ownerClaim.expectedClaimed ||
    ownerClaim.holderClaimed;
  const blockers = [
    reacquireAction && !allowedByState
      ? "recovery reacquire requires an expired lease or stale owner heartbeat"
      : null,
    reacquireAction && !generationFreshForRecovery
      ? `cannot recover from sync sequence ${sync.sequence} behind owner generation ${lease.owner.generation}`
      : null,
    reacquireAction && !allowedByOwnership
      ? `stale heartbeat recovery is unsafe while observed holder ${lease.owner.holder} differs from expected holder ${lease.owner.expectedHolder}`
      : null,
    !reacquireAction && lease.owner.stale
      ? "stale owner must be recovered with reacquire before fenced mutation"
      : null
  ].filter(Boolean);
  const allowed = !required || blockers.length === 0;
  return {
    schemaVersion: "lease-owner-recovery.v1",
    required,
    allowed,
    mode: !required
      ? "not-required"
      : allowed && reacquireAction
        ? staleByExpiry
          ? "expired-lease-reacquire"
          : "stale-heartbeat-reacquire"
        : "blocked",
    recoveryToken,
    successorHolder,
    staleByExpiry,
    staleByHeartbeat,
    splitBrainObserved,
    previousOwner: {
      holder: lease.owner.holder,
      expectedHolder: lease.owner.expectedHolder,
      fencingToken: lease.owner.fencingToken,
      generation: lease.owner.generation,
      heartbeatAt: lease.owner.heartbeatAt,
      staleReasons: lease.owner.staleReasons
    },
    preconditions: {
      leaseId: lease.leaseId,
      status: lease.status,
      expired: lease.expired,
      observedHolder: lease.owner.holder,
      expectedHolder: lease.owner.expectedHolder,
      ownerGeneration: lease.owner.generation,
      fencingToken: lease.owner.fencingToken,
      staleReasons: lease.owner.staleReasons,
      successorHolder,
      successorGeneration: ownerClaim.successorGeneration,
      syncCursor: sync.cursor,
      syncSequence: sync.sequence
    },
    ownerClaim,
    blockers
  };
}

function buildOwnershipGuard({ lease, provider, nextAction, sync }) {
  const mutationAction = !["reject", "sleep", "disable-manager", "enable-manager"].includes(nextAction.type);
  const fencedAction = ownerFencedActions.has(nextAction.type);
  const reacquireAction = nextAction.type === "reacquire-lease";
  const holderMismatch = !lease.owner.matchesExpectedHolder;
  const ownerClaim = buildProviderOwnerClaim({ lease, provider, sync });
  const recovery = buildOwnerRecoveryContract({ lease, provider, nextAction, sync, ownerClaim });
  const blockers = [
    fencedAction && holderMismatch
      ? `lease holder ${lease.owner.holder} does not match expected owner ${lease.owner.expectedHolder}`
      : null,
    fencedAction && !ownerClaim.holderClaimed
      ? `provider ${provider.id} cannot ${nextAction.type} lease held by ${lease.owner.holder}`
      : null,
    fencedAction && !ownerClaim.expectedClaimed
      ? `provider ${provider.id} cannot satisfy expected owner ${lease.owner.expectedHolder}`
      : null,
    fencedAction && !ownerClaim.generationFresh
      ? `fenced mutation requires sync sequence at or beyond owner generation ${lease.owner.generation}`
      : null,
    fencedAction && lease.owner.stale
      ? `lease owner is stale: ${lease.owner.staleReasons.join("; ")}`
      : null,
    fencedAction && lease.owner.fencingToken === null
      ? "fenced lease mutation requires an owner fencing token"
      : null,
    reacquireAction && !recovery.allowed
      ? recovery.blockers[0]
      : null
  ].filter(Boolean);
  return {
    holder: lease.owner.holder,
    expectedHolder: lease.owner.expectedHolder,
    providerId: provider.id,
    fencingToken: lease.owner.fencingToken,
    generation: lease.owner.generation,
    heartbeatAt: lease.owner.heartbeatAt,
    heartbeatAgeMs: lease.owner.heartbeatAgeMs,
    staleAfterMs: lease.owner.staleAfterMs,
    stale: lease.owner.stale,
    staleReasons: lease.owner.staleReasons,
    ownerClaim,
    holderMismatch,
    fencedAction,
    mutationAction,
    recoverySafe: blockers.length === 0,
    recoveryHint: recovery.allowed && reacquireAction ? "provider-may-reacquire-stale-lease" : lease.owner.recoveryHint,
    recovery,
    blockers
  };
}

function resolveLifecycleCommand(inputCommand, enabled) {
  const command = typeof inputCommand === "string" ? inputCommand : "inspect";
  if (!lifecycleCommands.has(command)) {
    return {
      command: "inspect",
      requestedCommand: command,
      accepted: false,
      reasons: [`unsupported lifecycle command: ${command}`]
    };
  }
  if (!enabled && !["inspect", "enable"].includes(command)) {
    return {
      command,
      requestedCommand: command,
      accepted: false,
      reasons: ["lease manager is disabled; only inspect or enable can be accepted"]
    };
  }
  return {
    command,
    requestedCommand: command,
    accepted: true,
    reasons: []
  };
}

function resolveNextAction(commandState, lease, settings, settingsValidation, nowMs) {
  if (!settingsValidation.ok) {
    return {
      type: "reject",
      dueAt: null,
      reason: "settings validation failed"
    };
  }
  if (!commandState.accepted) {
    return {
      type: "reject",
      dueAt: null,
      reason: commandState.reasons[0]
    };
  }
  if (commandState.command === "disable") {
    return { type: "disable-manager", dueAt: null, reason: "operator requested disable" };
  }
  if (commandState.command === "enable") {
    return { type: "enable-manager", dueAt: null, reason: "operator requested enable" };
  }
  if (commandState.command === "release") {
    return { type: "release-lease", dueAt: null, reason: "operator requested release" };
  }
  if (commandState.command === "quarantine" || lease.clockSkewMs > 0 && settings.quarantineOnClockSkew) {
    return { type: "quarantine-lease", dueAt: null, reason: "clock skew or operator quarantine" };
  }
  if (lease.owner.stale && ["inspect", "renew"].includes(commandState.command)) {
    return {
      type: "reacquire-lease",
      dueAt: null,
      reason: lease.expired
        ? "lease is expired and must be reacquired"
        : "lease owner heartbeat is stale and must be recovered before renewal"
    };
  }
  if (commandState.command === "renew" || lease.renewable) {
    return { type: "renew-lease", dueAt: null, reason: "lease is inside renewal window" };
  }
  if (lease.expired) {
    return { type: "reacquire-lease", dueAt: null, reason: "lease is expired" };
  }
  const renewAtMs = Date.parse(lease.expiresAt) - settings.renewBeforeMs;
  return {
    type: "sleep",
    dueAt: new Date(Math.max(nowMs, renewAtMs)).toISOString(),
    reason: "lease remains valid"
  };
}

function normalizeCapabilities(value) {
  const requested = Array.isArray(value) ? value : [];
  return [...new Set(requested.filter((item) => typeof item === "string" && item.length > 0))];
}

function normalizeRoles(...values) {
  return [
    ...new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : typeof value === "string" ? [value] : []))
        .filter((role) => Object.prototype.hasOwnProperty.call(tenantPermissionRoles, role))
    )
  ];
}

function buildBoundaryClaim(source, tenantId, workspaceId, extras = {}) {
  return {
    source,
    tenantId: typeof tenantId === "string" && tenantId ? tenantId : null,
    workspaceId: typeof workspaceId === "string" && workspaceId ? workspaceId : null,
    ...extras
  };
}

function summarizeBoundaryClaims(claims, field) {
  const values = new Map();
  claims.forEach((claim) => {
    const value = claim[field];
    if (typeof value !== "string" || value.length === 0) {
      return;
    }
    const sources = values.get(value) ?? [];
    sources.push(claim.source);
    values.set(value, sources);
  });
  return [...values.entries()].map(([value, sources]) => ({ value, sources }));
}

function resolveBoundaryField(claims, field, fallback) {
  const summarized = summarizeBoundaryClaims(claims, field);
  return {
    value: summarized[0]?.value ?? fallback ?? null,
    observed: summarized,
    conflict: summarized.length > 1,
    conflictReason:
      summarized.length > 1
        ? `${field} has conflicting scoped claims: ${summarized
            .map((entry) => `${entry.value} from ${entry.sources.join("+")}`)
            .join(", ")}`
        : null
  };
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? null;
}

function normalizeRoutePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  return value.startsWith("/") ? value : `/${value}`;
}

function normalizeClientRuntimeLeaseClaim(input, { lease, provider, sync }) {
  const runtime =
    input.runtime && typeof input.runtime === "object"
      ? input.runtime
      : input.request?.runtime && typeof input.request.runtime === "object"
        ? input.request.runtime
        : input.client?.runtime && typeof input.client.runtime === "object"
          ? input.client.runtime
          : {};
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const client = input.client && typeof input.client === "object" ? input.client : {};
  const workerId = firstString(
    runtime.workerId,
    runtime.id,
    runtime.holder,
    runtime.ownerId,
    request.workerId,
    request.ownerId,
    client.workerId,
    client.ownerId
  );
  const expectedHolder = firstString(
    runtime.expectedHolder,
    runtime.expectedOwner,
    request.expectedHolder,
    client.expectedHolder,
    workerId
  );
  const fencingToken = firstString(
    runtime.fencingToken,
    runtime.fenceToken,
    runtime.ownerToken,
    request.fencingToken,
    client.fencingToken
  );
  const generation =
    asNonNegativeInteger(runtime.generation) ??
    asNonNegativeInteger(runtime.ownerGeneration) ??
    asNonNegativeInteger(request.generation) ??
    asNonNegativeInteger(client.generation);
  const sequence =
    asNonNegativeInteger(runtime.sequence) ??
    asNonNegativeInteger(runtime.syncSequence) ??
    asNonNegativeInteger(request.sequence) ??
    asNonNegativeInteger(client.sequence);
  const leaseId = firstString(runtime.leaseId, runtime.lease, request.leaseId, client.leaseId);
  const providerId = firstString(runtime.providerId, runtime.provider, request.providerId, client.providerId);
  const cursor = firstString(runtime.cursor, runtime.syncCursor, request.cursor, client.cursor);
  const supplied =
    workerId !== null ||
    expectedHolder !== null ||
    fencingToken !== null ||
    generation !== null ||
    sequence !== null ||
    leaseId !== null ||
    providerId !== null ||
    cursor !== null;
  const blockers = [
    leaseId !== null && leaseId !== lease.leaseId
      ? `client runtime lease ${leaseId} does not match ${lease.leaseId}`
      : null,
    providerId !== null && providerId !== provider.id
      ? `client runtime provider ${providerId} does not match ${provider.id}`
      : null,
    cursor !== null && cursor !== sync.cursor
      ? `client runtime cursor ${cursor} does not match ${sync.cursor}`
      : null,
    sequence !== null && sequence < sync.sequence
      ? `client runtime sequence ${sequence} is behind sync sequence ${sync.sequence}`
      : null,
    generation !== null && generation < lease.owner.generation
      ? `client runtime generation ${generation} is behind owner generation ${lease.owner.generation}`
      : null
  ].filter(Boolean);
  return {
    schemaVersion: "lease-manager.client-runtime.v1",
    supplied,
    workerId,
    expectedHolder,
    fencingToken,
    generation,
    leaseId,
    providerId,
    cursor,
    sequence,
    fresh: blockers.length === 0,
    observedLease: {
      leaseId: lease.leaseId,
      providerId: provider.id,
      cursor: sync.cursor,
      sequence: sync.sequence,
      ownerGeneration: lease.owner.generation
    },
    blockers
  };
}

function evaluateClientRuntimeOwnership({ clientRequest, ownershipGuard, nextAction }) {
  const fencedAction = ownerFencedActions.has(nextAction.type);
  const runtime = clientRequest.runtime;
  const workerRuntimeRequired = fencedAction && (clientRequest.channel === "worker" || runtime.supplied);
  const holderMatches =
    runtime.workerId !== null &&
    [ownershipGuard.holder, ownershipGuard.expectedHolder, ownershipGuard.providerId].includes(runtime.workerId);
  const expectedHolderMatches =
    runtime.expectedHolder === null ||
    [ownershipGuard.expectedHolder, ownershipGuard.holder, runtime.workerId].includes(runtime.expectedHolder);
  const fencingTokenMatches =
    runtime.fencingToken === null ||
    ownershipGuard.fencingToken === null ||
    runtime.fencingToken === ownershipGuard.fencingToken;
  const generationFresh =
    runtime.generation === null || runtime.generation >= ownershipGuard.generation;
  const blockers = [
    workerRuntimeRequired && runtime.workerId === null
      ? `worker runtime identity is required for ${nextAction.type}`
      : null,
    workerRuntimeRequired && runtime.workerId !== null && !holderMatches
      ? `worker runtime ${runtime.workerId} cannot fence lease held by ${ownershipGuard.holder}`
      : null,
    workerRuntimeRequired && !expectedHolderMatches
      ? `worker runtime expected holder ${runtime.expectedHolder} does not match lease owner ${ownershipGuard.expectedHolder}`
      : null,
    workerRuntimeRequired && !fencingTokenMatches
      ? "worker runtime fencing token does not match the current lease fence"
      : null,
    workerRuntimeRequired && !generationFresh
      ? `worker runtime generation ${runtime.generation} is behind owner generation ${ownershipGuard.generation}`
      : null,
    workerRuntimeRequired && !runtime.fresh
      ? runtime.blockers[0]
      : null
  ].filter(Boolean);
  return {
    schemaVersion: "lease-manager.client-runtime-ownership.v1",
    required: workerRuntimeRequired,
    accepted: !workerRuntimeRequired || blockers.length === 0,
    action: nextAction.type,
    channel: clientRequest.channel,
    workerId: runtime.workerId,
    expectedHolder: runtime.expectedHolder,
    holderMatches,
    expectedHolderMatches,
    fencingTokenMatches,
    generationFresh,
    supplied: runtime.supplied,
    fresh: runtime.fresh,
    blockers,
    handoffHint:
      !workerRuntimeRequired
        ? "runtime-fence-not-required"
        : blockers.length === 0
          ? "worker-runtime-may-submit-fenced-mutation"
          : "refresh-worker-runtime-before-fenced-mutation"
  };
}

function normalizeClientRequestContext(input = {}, { commandState, lease, provider, sync, now }) {
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const client = input.client && typeof input.client === "object" ? input.client : {};
  const route = request.route && typeof request.route === "object" ? request.route : {};
  const requestedIntent = firstString(request.intent, client.intent, route.intent, commandState.command);
  const intent = clientHandoffIntents.has(requestedIntent) ? requestedIntent : "apply";
  const requestedChannel = firstString(request.channel, client.channel, route.channel);
  const channel = clientChannels.has(requestedChannel) ? requestedChannel : "unknown";
  const requestId =
    firstString(request.requestId, request.id, client.requestId, client.traceId) ??
    `${surfaceId}:${provider.id}:${lease.leaseId}:${sync.sequence}:${commandState.command}`;
  const actor =
    firstString(request.actor, request.actorId, client.actor, client.id, client.name) ?? "anonymous-client";
  const sessionId = firstString(request.sessionId, client.sessionId, client.connectionId);
  const href = normalizeRoutePath(firstString(route.href, route.path, request.href, request.path));
  const method = firstString(route.method, request.method);
  const capabilities = normalizeCapabilities([
    ...(Array.isArray(client.capabilities) ? client.capabilities : []),
    ...(Array.isArray(request.capabilities) ? request.capabilities : [])
  ]);
  const acceptsExternalHandoff =
    capabilities.includes("workflow.handoff.accept") ||
    capabilities.includes("handoff.external") ||
    intent === "handoff";
  const acceptsProof =
    capabilities.includes("proof.render") ||
    capabilities.includes("audit.proof") ||
    channel === "console";
  const previewOnlyRequested =
    request.preview === true ||
    client.preview === true ||
    intent === "preview";
  const runtime = normalizeClientRuntimeLeaseClaim(input, { lease, provider, sync });
  return {
    requestId,
    actor,
    sessionId,
    channel,
    intent,
    receivedAt: now,
    route: {
      method: typeof method === "string" && method ? method.toUpperCase() : null,
      href,
      source: firstString(route.source, request.source) ?? "lease-manager-client"
    },
    capabilities,
    runtime,
    workflow: {
      previewOnlyRequested,
      acceptsExternalHandoff,
      acceptsProof,
      shouldAttachProof: acceptsProof || previewOnlyRequested,
      correlationKey: `${provider.id}:${lease.leaseId}:${sync.cursor}:${requestId}`,
      warnings: [
        acceptsExternalHandoff ? null : "client cannot acknowledge external handoff",
        acceptsProof ? null : "client did not advertise proof rendering support",
        ...runtime.blockers
      ].filter(Boolean)
    }
  };
}

function normalizeProviderServiceContract(provider) {
  const requested =
    provider.serviceContract && typeof provider.serviceContract === "object"
      ? provider.serviceContract
      : provider.contract && typeof provider.contract === "object"
        ? provider.contract
        : {};
  const protocol =
    typeof requested.protocol === "string" && requested.protocol
      ? requested.protocol
      : provider.hosted === true || typeof provider.endpoint === "string"
        ? "hosted-kernel.v1"
        : "local-kernel.v1";
  const mode =
    typeof requested.mode === "string" && providerServiceModes.has(requested.mode)
      ? requested.mode
      : protocol === "local-kernel.v1"
        ? "active"
        : "passive";
  const namespace =
    typeof requested.namespace === "string" && requested.namespace
      ? requested.namespace
      : typeof provider.namespace === "string" && provider.namespace
        ? provider.namespace
        : "scheduler-leases";
  const handoffTtlMs = asPositiveInteger(requested.handoffTtlMs, 30_000);
  return {
    protocol,
    apiVersion:
      typeof requested.apiVersion === "string" && requested.apiVersion ? requested.apiVersion : "2026-07-01",
    namespace,
    mode,
    requiresAck: requested.requiresAck === true || mode !== "active",
    handoffTtlMs: Math.max(1_000, Math.min(handoffTtlMs, 5 * 60_000)),
    supported: supportedServiceProtocols.has(protocol),
    unsupportedReason: supportedServiceProtocols.has(protocol)
      ? null
      : `unsupported provider service protocol: ${protocol}`
  };
}

function normalizeProvider(input = {}) {
  const provider = input && typeof input === "object" ? input : {};
  const capabilities =
    Array.isArray(provider.capabilities) && provider.capabilities.length > 0
      ? normalizeCapabilities(provider.capabilities)
      : [...localKernelCapabilities];
  const serviceContract = normalizeProviderServiceContract(provider);
  const unknownCapabilities = capabilities.filter((capability) => !knownProviderCapabilities.has(capability));
  return {
    id: typeof provider.id === "string" && provider.id ? provider.id : "local-kernel",
    tenantId: firstString(provider.tenantId, provider.tenant, provider.accountId),
    workspaceId: firstString(provider.workspaceId, provider.workspace, provider.namespace),
    service:
      typeof provider.service === "string" && provider.service
        ? provider.service
        : "hosted-kernel-lease-service",
    endpoint: typeof provider.endpoint === "string" && provider.endpoint ? provider.endpoint : null,
    capabilities,
    unknownCapabilities,
    serviceContract,
    hosted: provider.hosted === true || typeof provider.endpoint === "string"
  };
}

function normalizeTenantBoundary(input = {}, { lease, provider, clientRequest, commandState, nextAction, sync }) {
  const scope = input.scope && typeof input.scope === "object" ? input.scope : {};
  const tenant = input.tenant && typeof input.tenant === "object" ? input.tenant : {};
  const workspace = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const security = input.security && typeof input.security === "object" ? input.security : {};
  const request = input.request && typeof input.request === "object" ? input.request : {};
  const client = input.client && typeof input.client === "object" ? input.client : {};
  const boundaryClaims = [
    buildBoundaryClaim("scope", firstString(scope.tenantId, scope.tenant), firstString(scope.workspaceId, scope.workspace)),
    buildBoundaryClaim("tenant", firstString(tenant.id, tenant.tenantId), firstString(tenant.workspaceId, tenant.workspace)),
    buildBoundaryClaim(
      "workspace",
      firstString(workspace.tenantId, workspace.tenant),
      firstString(workspace.id, workspace.workspaceId)
    ),
    buildBoundaryClaim("request", request.tenantId, request.workspaceId, {
      requestId: clientRequest.requestId
    }),
    buildBoundaryClaim("client", client.tenantId, client.workspaceId, {
      actor: clientRequest.actor
    }),
    buildBoundaryClaim("lease", lease.tenantId, lease.workspaceId, {
      leaseId: lease.leaseId
    }),
    buildBoundaryClaim("provider", provider.tenantId, provider.workspaceId, {
      providerId: provider.id
    }),
    buildBoundaryClaim("sync", sync.scope?.tenantId, sync.scope?.workspaceId, {
      cursor: sync.cursor,
      sequence: sync.sequence
    })
  ];
  const tenantResolution = resolveBoundaryField(boundaryClaims, "tenantId");
  const workspaceResolution = resolveBoundaryField(boundaryClaims, "workspaceId");
  const tenantId = tenantResolution.value;
  const workspaceId = workspaceResolution.value;
  const leaseTenantId = firstString(lease.tenantId, tenantId);
  const leaseWorkspaceId = firstString(lease.workspaceId, workspaceId);
  const providerTenantId = firstString(provider.tenantId, tenantId);
  const providerWorkspaceId = firstString(provider.workspaceId, workspaceId);
  const roles = normalizeRoles(
    security.roles,
    request.roles,
    client.roles,
    clientRequest.capabilities.includes("lease.admin") ? "lease.admin" : null,
    clientRequest.capabilities.includes("scheduler.service") ? "scheduler.service" : null,
    commandState.command === "inspect" ? "lease.viewer" : null
  );
  const allowedCommands = [
    ...new Set(roles.flatMap((role) => tenantPermissionRoles[role] ?? []))
  ].filter((command) => lifecycleCommands.has(command));
  const mutationRequested =
    mutatingLifecycleCommands.has(commandState.command) || boundaryScopedActions.has(nextAction.type);
  const permissionCommand =
    mutationRequested && actionPermissionCommand[nextAction.type]
      ? actionPermissionCommand[nextAction.type]
      : commandState.command;
  const permissionRequired = mutationRequested || provider.hosted;
  const hostedMutation =
    provider.serviceContract.protocol === "hosted-kernel.v1" &&
    mutationRequested &&
    !["disable-manager", "enable-manager"].includes(nextAction.type);
  const workspaceScopedMutation =
    hostedMutation ||
    sync.scope?.workspaceId !== null ||
    providerWorkspaceId !== null ||
    leaseWorkspaceId !== null;
  const crossWorkspaceHandoffRisk =
    hostedMutation &&
    (
      tenantResolution.conflict ||
      workspaceResolution.conflict ||
      sync.scope?.consistent === false ||
      !sync.scope?.bound
    );
  const boundaryMode =
    crossWorkspaceHandoffRisk
      ? "handoff-blocked"
      : hostedMutation
        ? "hosted-workspace"
        : mutationRequested
          ? "local-workspace"
          : permissionRequired
            ? "hosted-inspect"
            : "inspection";
  const blockers = [
    tenantResolution.conflict ? tenantResolution.conflictReason : null,
    workspaceResolution.conflict ? workspaceResolution.conflictReason : null,
    permissionRequired && tenantId === null ? "tenant boundary requires tenantId" : null,
    (permissionRequired || workspaceScopedMutation) && workspaceId === null
      ? "tenant boundary requires workspaceId"
      : null,
    leaseTenantId !== null && tenantId !== null && leaseTenantId !== tenantId
      ? `lease tenant ${leaseTenantId} does not match request tenant ${tenantId}`
      : null,
    leaseWorkspaceId !== null && workspaceId !== null && leaseWorkspaceId !== workspaceId
      ? `lease workspace ${leaseWorkspaceId} does not match request workspace ${workspaceId}`
      : null,
    providerTenantId !== null && tenantId !== null && providerTenantId !== tenantId
      ? `provider tenant ${providerTenantId} does not match request tenant ${tenantId}`
      : null,
    providerWorkspaceId !== null && workspaceId !== null && providerWorkspaceId !== workspaceId
      ? `provider workspace ${providerWorkspaceId} does not match request workspace ${workspaceId}`
      : null,
    hostedMutation && !sync.scope?.bound
      ? "hosted lease mutation requires sync cursor scoped to the lease/provider namespace"
      : null,
    hostedMutation && sync.scope?.consistent === false
      ? sync.scope.blockers[0]
      : null,
    permissionRequired && roles.length === 0 ? "actor has no lease permission role" : null,
    permissionRequired && !allowedCommands.includes(permissionCommand)
      ? `actor roles do not permit ${permissionCommand}`
      : null
  ].filter(Boolean);
  const isolationKey = [
    tenantId ?? "unscoped-tenant",
    workspaceId ?? "unscoped-workspace",
    provider.serviceContract.namespace,
    provider.id,
    lease.leaseId
  ].join(":");
  return {
    schemaVersion: "lease-manager.tenant-boundary.v2",
    tenantId,
    workspaceId,
    leaseTenantId,
    leaseWorkspaceId,
    providerTenantId,
    providerWorkspaceId,
    boundaryMode,
    isolationKey,
    sourceClaims: boundaryClaims.filter((claim) => claim.tenantId !== null || claim.workspaceId !== null),
    resolvedClaims: {
      tenant: tenantResolution,
      workspace: workspaceResolution
    },
    roles,
    allowedCommands,
    permissionCommand,
    mutationRequested,
    permissionRequired,
    hostedMutation,
    workspaceScopedMutation,
    crossWorkspaceHandoffRisk,
    accepted: blockers.length === 0,
    blockers,
    auditSubject: {
      tenantId: tenantId ?? "unscoped-tenant",
      workspaceId: workspaceId ?? "unscoped-workspace",
      actor: clientRequest.actor,
      requestId: clientRequest.requestId,
      isolationKey,
      boundaryMode,
      syncCursor: sync.cursor,
      syncSequence: sync.sequence
    }
  };
}

function negotiateProviderCapabilities(provider, nextAction, sync = null) {
  const required = requiredCapabilitiesByAction[nextAction.type] ?? [];
  const mutationAction = !["reject", "sleep", "disable-manager", "enable-manager"].includes(nextAction.type);
  const serviceRequired = mutationAction && provider.serviceContract.protocol === "hosted-kernel.v1";
  const externalHandoffRequired =
    serviceRequired && provider.serviceContract.mode !== "active";
  const directProviderCall =
    serviceRequired && provider.serviceContract.mode === "active";
  const ackRequired = externalHandoffRequired && provider.serviceContract.requiresAck;
  const syncBlockers =
    serviceRequired && sync?.requiresResync === true
      ? sync.consistency.blockers.map((blocker) => `provider sync contract: ${blocker}`)
      : [];
  const requiredWithService = [
    ...required,
    serviceRequired ? "sync.cursor" : null,
    externalHandoffRequired ? "handoff.external" : null,
    ackRequired ? "handoff.ack" : null
  ].filter(Boolean);
  const missing = [...new Set(requiredWithService)].filter(
    (capability) => !provider.capabilities.includes(capability)
  );
  const serviceBlockers = [
    provider.serviceContract.supported ? null : provider.serviceContract.unsupportedReason,
    serviceRequired && provider.endpoint === null
      ? "hosted provider lifecycle mutations require an endpoint"
      : null,
    externalHandoffRequired && !provider.capabilities.includes("handoff.external")
      ? `${provider.serviceContract.mode} provider mode requires external handoff capability for mutations`
      : null,
    ...syncBlockers
  ].filter(Boolean);
  const canHandoff =
    externalHandoffRequired &&
    provider.capabilities.includes("handoff.external") &&
    provider.endpoint !== null;
  const accepted = missing.length === 0 && serviceBlockers.length === 0;
  const executionMode = !mutationAction
    ? "no-op"
    : !serviceRequired
      ? "local-state"
      : directProviderCall
        ? "provider-call"
        : "external-handoff";
  return {
    action: nextAction.type,
    required: [...new Set(requiredWithService)],
    granted: [...new Set(requiredWithService)].filter((capability) => provider.capabilities.includes(capability)),
    missing,
    service: {
      protocol: provider.serviceContract.protocol,
      apiVersion: provider.serviceContract.apiVersion,
      namespace: provider.serviceContract.namespace,
      mode: provider.serviceContract.mode,
      requiresAck: provider.serviceContract.requiresAck,
      handoffTtlMs: provider.serviceContract.handoffTtlMs,
      supported: provider.serviceContract.supported,
      blockers: serviceBlockers
    },
    syncMetadata: {
      cursorRequired: serviceRequired,
      cursorCapabilityGranted: !serviceRequired || provider.capabilities.includes("sync.cursor"),
      sequenceGuard: serviceRequired ? "provider-sequence-must-not-regress" : "local-sequence-authoritative",
      idempotencyScope: `${provider.serviceContract.namespace}:${provider.id}:${nextAction.type}`,
      handoffRequiresFreshCursor: externalHandoffRequired,
      directCallRequiresFreshCursor: directProviderCall,
      scopeRequired: serviceRequired,
      requiredScopeFields: serviceRequired
        ? ["leaseId", "providerId", "namespace", "sequence"]
        : ["sequence"],
      consistency: sync?.consistency ?? null,
      scope: sync?.scope ?? null
    },
    execution: {
      mode: accepted ? executionMode : "blocked",
      intendedMode: executionMode,
      hosted: serviceRequired,
      directProviderCall,
      externalHandoffRequired,
      ackRequired,
      target:
        executionMode === "provider-call" || executionMode === "external-handoff"
          ? provider.endpoint
          : "local-scheduler",
      state: accepted
        ? executionMode === "external-handoff"
          ? "requires-client-handoff"
          : "ready"
        : "blocked",
      blockers: [...missing.map((capability) => `missing provider capability: ${capability}`), ...serviceBlockers]
    },
    accepted,
    canHandoff,
    warnings: [
      ...provider.unknownCapabilities.map(
        (capability) => `provider advertised unknown capability: ${capability}`
      ),
      provider.serviceContract.mode === "mirror"
        ? "provider is in mirror mode; local state remains authoritative after handoff"
        : null
    ].filter(Boolean)
  };
}

function normalizeSyncScope(sync, { lease, provider }) {
  const scope = sync.scope && typeof sync.scope === "object" ? sync.scope : {};
  const observedLeaseId = firstString(sync.leaseId, sync.lease, scope.leaseId, scope.lease);
  const observedProviderId = firstString(sync.providerId, sync.provider, scope.providerId, scope.provider);
  const observedNamespace = firstString(sync.namespace, scope.namespace);
  const observedTenantId = firstString(sync.tenantId, scope.tenantId);
  const observedWorkspaceId = firstString(sync.workspaceId, scope.workspaceId);
  const expectedNamespace = provider?.serviceContract?.namespace ?? null;
  const expectedTenantId = lease?.tenantId ?? provider?.tenantId ?? null;
  const expectedWorkspaceId = lease?.workspaceId ?? provider?.workspaceId ?? null;
  const blockers = [
    observedLeaseId !== null && lease?.leaseId && observedLeaseId !== lease.leaseId
      ? `sync cursor lease ${observedLeaseId} does not match active lease ${lease.leaseId}`
      : null,
    observedProviderId !== null && provider?.id && observedProviderId !== provider.id
      ? `sync cursor provider ${observedProviderId} does not match provider ${provider.id}`
      : null,
    observedNamespace !== null && expectedNamespace !== null && observedNamespace !== expectedNamespace
      ? `sync cursor namespace ${observedNamespace} does not match provider namespace ${expectedNamespace}`
      : null,
    observedTenantId !== null && expectedTenantId !== null && observedTenantId !== expectedTenantId
      ? `sync cursor tenant ${observedTenantId} does not match lease/provider tenant ${expectedTenantId}`
      : null,
    observedWorkspaceId !== null && expectedWorkspaceId !== null && observedWorkspaceId !== expectedWorkspaceId
      ? `sync cursor workspace ${observedWorkspaceId} does not match lease/provider workspace ${expectedWorkspaceId}`
      : null
  ].filter(Boolean);
  return {
    leaseId: observedLeaseId,
    providerId: observedProviderId,
    namespace: observedNamespace,
    tenantId: observedTenantId,
    workspaceId: observedWorkspaceId,
    expected: {
      leaseId: lease?.leaseId ?? null,
      providerId: provider?.id ?? null,
      namespace: expectedNamespace,
      tenantId: expectedTenantId,
      workspaceId: expectedWorkspaceId
    },
    bound: observedLeaseId !== null || observedProviderId !== null || observedNamespace !== null,
    consistent: blockers.length === 0,
    blockers
  };
}

function normalizeSyncState(input = {}, nowMs, context = {}) {
  const sync = input && typeof input === "object" ? input : {};
  const observedAtMs = parseTimestamp(sync.observedAt, nowMs);
  const sequence =
    Number.isInteger(sync.sequence) && sync.sequence >= 0
      ? sync.sequence
      : Number.isInteger(sync.version) && sync.version >= 0
        ? sync.version
        : 0;
  const staleAfterMs = asPositiveInteger(sync.staleAfterMs, 2 * defaultSettings.schedulerIntervalMs);
  const ageMs = Math.max(0, nowMs - observedAtMs);
  const scope = normalizeSyncScope(sync, context);
  const minOwnerSequence = context.lease?.owner?.generation ?? 0;
  const minPersistedSequence =
    Number.isInteger(sync.minSequence) && sync.minSequence >= 0
      ? sync.minSequence
      : Number.isInteger(sync.watermark) && sync.watermark >= 0
        ? sync.watermark
        : minOwnerSequence;
  const sequenceBehindOwner = sequence < minOwnerSequence;
  const sequenceBehindWatermark = sequence < minPersistedSequence;
  const stale = ageMs > staleAfterMs;
  const consistencyBlockers = [
    ...scope.blockers,
    sequenceBehindOwner
      ? `sync sequence ${sequence} is behind owner generation ${minOwnerSequence}`
      : null,
    sequenceBehindWatermark
      ? `sync sequence ${sequence} is behind required watermark ${minPersistedSequence}`
      : null,
    stale ? `sync cursor ${sync.cursor ?? `bootstrap:${sequence}`} is stale after ${ageMs}ms` : null
  ].filter(Boolean);
  const requiresResync = consistencyBlockers.length > 0;
  return {
    cursor: typeof sync.cursor === "string" && sync.cursor ? sync.cursor : `bootstrap:${sequence}`,
    sequence,
    observedAt: new Date(observedAtMs).toISOString(),
    ageMs,
    staleAfterMs,
    stale,
    source: typeof sync.source === "string" && sync.source ? sync.source : "lease-manager",
    minOwnerSequence,
    minSequence: minPersistedSequence,
    scope,
    sequenceBehindOwner,
    sequenceBehindWatermark,
    consistent: scope.consistent && !sequenceBehindOwner && !sequenceBehindWatermark && !stale,
    requiresResync,
    consistency: {
      state: requiresResync
        ? !scope.consistent
          ? "scope-mismatch"
          : sequenceBehindOwner || sequenceBehindWatermark
            ? "sequence-behind"
            : "stale"
        : "fresh",
      cursorBound: scope.bound,
      cursorFresh: !stale,
      sequenceAtLeastOwner: !sequenceBehindOwner,
      sequenceAtLeastWatermark: !sequenceBehindWatermark,
      blockers: consistencyBlockers,
      resyncAction: requiresResync ? "resync-provider-cursor" : null
    }
  };
}

function classifyFailureCode(code, status) {
  const normalizedCode = String(code ?? "").toLowerCase();
  if (status === 401 || status === 403 || normalizedCode.includes("auth") || normalizedCode.includes("permission")) {
    return "authorization";
  }
  if (status === 404 || normalizedCode.includes("not_found") || normalizedCode.includes("missing")) {
    return "configuration";
  }
  if (status === 409 || normalizedCode.includes("conflict") || normalizedCode.includes("fence")) {
    return "state-conflict";
  }
  if (status === 429 || normalizedCode.includes("rate") || normalizedCode.includes("throttle")) {
    return "rate-limit";
  }
  if (status >= 500 || normalizedCode.includes("timeout") || normalizedCode.includes("network")) {
    return "transient-provider";
  }
  return "scheduler";
}

function resolveFailureGuidance({ category, retryable, provider }) {
  if (category === "authorization") {
    return {
      action: "rotate-provider-credentials",
      routeIntent: "inspect-lease-health",
      remediation: `verify credentials and lease roles for ${provider.id}`
    };
  }
  if (category === "configuration") {
    return {
      action: "repair-provider-configuration",
      routeIntent: "inspect-lease-health",
      remediation: `confirm ${provider.service} endpoint, namespace, and lease scope`
    };
  }
  if (category === "state-conflict") {
    return {
      action: "resync-provider-cursor",
      routeIntent: "resync-provider-cursor",
      remediation: "resync the provider cursor before accepting another lifecycle mutation"
    };
  }
  if (category === "rate-limit") {
    return {
      action: "retry-after-provider-window",
      routeIntent: "retry-lease-action",
      remediation: `wait for ${provider.id} rate-limit recovery before retrying`
    };
  }
  return {
    action: retryable ? "retry-with-backoff" : "operator-intervention",
    routeIntent: retryable ? "retry-lease-action" : "inspect-lease-health",
    remediation: retryable
      ? `retry after the computed backoff for ${provider.id}`
      : `resolve ${provider.service} failure before mutating hosted lease state`
  };
}

function normalizeFailureEntry(entry, index, nowMs) {
  const failure = entry && typeof entry === "object" ? entry : {};
  const severity = ["warning", "error", "critical"].includes(failure.severity)
    ? failure.severity
    : index === 0
      ? "error"
      : "warning";
  const code =
    typeof failure.code === "string" && failure.code
      ? failure.code
      : typeof failure.type === "string" && failure.type
        ? failure.type
        : "scheduler_health_failure";
  const observedAtMs = parseTimestamp(failure.at ?? failure.observedAt, nowMs);
  const status =
    Number.isInteger(failure.status) && failure.status >= 100 && failure.status <= 599
      ? failure.status
      : Number.isInteger(failure.statusCode) && failure.statusCode >= 100 && failure.statusCode <= 599
        ? failure.statusCode
        : null;
  const category = classifyFailureCode(code, status);
  const retryAfterMs = asPositiveInteger(failure.retryAfterMs, 0);
  const retryable =
    failure.retryable !== false &&
    severity !== "critical" &&
    !["authorization", "configuration"].includes(category);
  return {
    code,
    category,
    message:
      typeof failure.message === "string" && failure.message
        ? failure.message
        : `lease manager reported ${code}`,
    severity,
    retryable,
    transient: retryable && ["rate-limit", "transient-provider", "scheduler"].includes(category),
    status,
    retryAfterMs,
    source: typeof failure.source === "string" && failure.source ? failure.source : "lease-manager",
    diagnosticKey:
      typeof failure.diagnosticKey === "string" && failure.diagnosticKey
        ? failure.diagnosticKey
        : `${category}:${code}`,
    observedAt: new Date(observedAtMs).toISOString()
  };
}

function normalizeHealthValidationFailure({ code, message, severity = "error", nowMs, detail }) {
  return normalizeFailureEntry(
    {
      code,
      category: "scheduler",
      message,
      severity,
      retryable: false,
      source: "lease-manager-health-validation",
      diagnosticKey: `health-input:${code}`,
      detail,
      observedAt: nowMs
    },
    0,
    nowMs
  );
}

function validateOperationalHealthInput(health, nowMs) {
  if (health === null || health === undefined) {
    return {
      supplied: false,
      valid: true,
      errors: [],
      warnings: [],
      failures: []
    };
  }
  if (typeof health !== "object" || Array.isArray(health)) {
    const failure = normalizeHealthValidationFailure({
      code: "invalid_health_payload",
      message: "health telemetry must be an object when supplied",
      nowMs,
      detail: typeof health
    });
    return {
      supplied: true,
      valid: false,
      errors: [failure.message],
      warnings: [],
      failures: [failure]
    };
  }
  const failures = [];
  const errors = [];
  const warnings = [];
  const timestampCandidate = health.observedAt ?? health.checkedAt;
  if (timestampCandidate !== undefined && parseTimestamp(timestampCandidate, null) === null) {
    const failure = normalizeHealthValidationFailure({
      code: "invalid_health_timestamp",
      message: "health observedAt must be a valid timestamp",
      nowMs,
      detail: timestampCandidate
    });
    failures.push(failure);
    errors.push(failure.message);
  }
  if (health.state !== undefined && !["healthy", "degraded", "failed", "unknown"].includes(health.state)) {
    const failure = normalizeHealthValidationFailure({
      code: "invalid_health_state",
      message: `health state ${String(health.state)} is not supported`,
      nowMs,
      detail: health.state
    });
    failures.push(failure);
    errors.push(failure.message);
  }
  if (health.failures !== undefined && !Array.isArray(health.failures)) {
    const failure = normalizeHealthValidationFailure({
      code: "invalid_health_failures",
      message: "health failures must be an array",
      nowMs,
      detail: typeof health.failures
    });
    failures.push(failure);
    errors.push(failure.message);
  }
  if (
    health.consecutiveFailures !== undefined &&
    (!Number.isInteger(health.consecutiveFailures) || health.consecutiveFailures < 0)
  ) {
    const failure = normalizeHealthValidationFailure({
      code: "invalid_consecutive_failures",
      message: "health consecutiveFailures must be a non-negative integer",
      nowMs,
      detail: health.consecutiveFailures
    });
    failures.push(failure);
    errors.push(failure.message);
  }
  const rawFailures = Array.isArray(health.failures) ? health.failures : [];
  rawFailures.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      const failure = normalizeHealthValidationFailure({
        code: "invalid_failure_entry",
        message: `health failure at index ${index} must be an object`,
        severity: "warning",
        nowMs,
        detail: entry === null ? "null" : typeof entry
      });
      failures.push(failure);
      warnings.push(failure.message);
      return;
    }
    if (
      entry.status !== undefined &&
      (!Number.isInteger(entry.status) || entry.status < 100 || entry.status > 599)
    ) {
      const failure = normalizeHealthValidationFailure({
        code: "invalid_failure_status",
        message: `health failure at index ${index} has an invalid HTTP status`,
        severity: "warning",
        nowMs,
        detail: entry.status
      });
      failures.push(failure);
      warnings.push(failure.message);
    }
    if (entry.retryAfterMs !== undefined && (!Number.isInteger(entry.retryAfterMs) || entry.retryAfterMs < 0)) {
      const failure = normalizeHealthValidationFailure({
        code: "invalid_retry_after",
        message: `health failure at index ${index} has an invalid retryAfterMs`,
        severity: "warning",
        nowMs,
        detail: entry.retryAfterMs
      });
      failures.push(failure);
      warnings.push(failure.message);
    }
  });
  return {
    supplied: true,
    valid: errors.length === 0 && warnings.length === 0,
    errors,
    warnings,
    failures: failures.slice(0, 8)
  };
}

function buildRetryPlan({ failures, consecutiveFailures, nowMs, settings }) {
  const retryable = failures.some((failure) => failure.retryable);
  const attempt = Math.max(0, consecutiveFailures);
  if (!retryable || attempt === 0) {
    return {
      retryable,
      attempt,
      backoffMs: 0,
      nextRetryAt: null,
      maxBackoffMs: settings.retryMaxMs
    };
  }
  const backoffMs = Math.min(settings.retryMaxMs, settings.retryBaseMs * 2 ** Math.min(8, attempt - 1));
  const providerRetryAfterMs = Math.max(0, ...failures.map((failure) => failure.retryAfterMs));
  const effectiveBackoffMs = Math.max(backoffMs, Math.min(providerRetryAfterMs, settings.retryMaxMs));
  return {
    retryable,
    attempt,
    backoffMs: effectiveBackoffMs,
    providerRetryAfterMs,
    nextRetryAt: new Date(nowMs + effectiveBackoffMs).toISOString(),
    maxBackoffMs: settings.retryMaxMs
  };
}

function buildFailurePolicy({ failures, stale, consecutiveFailures, retry, provider }) {
  const terminalFailures = failures.filter((failure) => !failure.retryable);
  const circuitOpen = consecutiveFailures >= 3 && (retry.retryable || terminalFailures.length > 0);
  const primaryFailure = terminalFailures[0] ?? failures[0] ?? null;
  const failureState =
    primaryFailure === null && !stale
      ? "normal"
      : terminalFailures.length > 0
        ? "terminal"
        : circuitOpen
          ? "circuit-open"
          : "retrying";
  return {
    state: failureState,
    mutationSafe: failureState === "normal",
    circuitOpen,
    terminal: terminalFailures.length > 0,
    primaryDiagnosticKey: primaryFailure?.diagnosticKey ?? (stale ? "health:stale-heartbeat" : null),
    categories: [...new Set(failures.map((failure) => failure.category))],
    providerId: provider.id,
    retryWindow: {
      retryable: retry.retryable,
      attempt: retry.attempt,
      nextRetryAt: retry.nextRetryAt
    }
  };
}

function buildActionableErrors({ failures, stale, ageMs, settings, provider, failurePolicy }) {
  const staleError = stale
    ? [
        {
          code: "health_heartbeat_stale",
          category: "scheduler",
          severity: "warning",
          message: `no lease manager health heartbeat for ${ageMs}ms`,
          action: "refresh-health",
          routeIntent: "inspect-lease-health",
          diagnosticKey: "health:stale-heartbeat",
          remediation: `confirm ${provider.service} heartbeat within ${settings.healthStaleAfterMs}ms`
        }
      ]
    : [];
  return [
    ...staleError,
    ...failures.map((failure) => {
      const guidance = resolveFailureGuidance({ category: failure.category, retryable: failure.retryable, provider });
      return {
        code: failure.code,
        category: failure.category,
        severity: failure.severity,
        message: failure.message,
        action: failurePolicy.circuitOpen && failure.retryable ? "wait-for-circuit-reset" : guidance.action,
        routeIntent: guidance.routeIntent,
        diagnosticKey: failure.diagnosticKey,
        retryAfterMs: failure.retryAfterMs,
        remediation: failurePolicy.circuitOpen && failure.retryable
          ? `circuit is open for ${provider.id}; retry after ${failurePolicy.retryWindow.nextRetryAt}`
          : guidance.remediation
      };
    })
  ];
}

function normalizeOperationalHealth(input = {}, { nowMs, settings, provider }) {
  const validation = validateOperationalHealthInput(input, nowMs);
  const health = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const observedAtMs = parseTimestamp(health.observedAt ?? health.checkedAt, nowMs);
  const ageMs = Math.max(0, nowMs - observedAtMs);
  const reportedFailures = (Array.isArray(health.failures) ? health.failures : [])
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry, index) => normalizeFailureEntry(entry, index, nowMs));
  const failures = [...validation.failures, ...reportedFailures].slice(0, 8);
  const consecutiveFailures =
    Number.isInteger(health.consecutiveFailures) && health.consecutiveFailures >= 0
      ? health.consecutiveFailures
      : validation.failures.length > 0
        ? Math.max(1, failures.length)
        : failures.length;
  const stale = ageMs > settings.healthStaleAfterMs;
  const hasCriticalFailure = failures.some((failure) => failure.severity === "critical");
  const hasFailures = failures.length > 0;
  const reportedState =
    typeof health.state === "string" && ["healthy", "degraded", "failed", "unknown"].includes(health.state)
      ? health.state
      : null;
  const state = hasCriticalFailure
    ? "failed"
    : stale || hasFailures || reportedState === "degraded"
      ? "degraded"
      : reportedState ?? "healthy";
  const retry = buildRetryPlan({ failures, consecutiveFailures, nowMs, settings });
  const failurePolicy = buildFailurePolicy({
    failures,
    stale,
    consecutiveFailures,
    retry,
    provider
  });
  const actionableErrors = buildActionableErrors({
    failures,
    stale,
    ageMs,
    settings,
    provider,
    failurePolicy
  });
  return {
    state,
    failureState: failurePolicy.state,
    ok: state === "healthy",
    degradedMode: state === "degraded" || state === "failed" || failurePolicy.circuitOpen,
    observedAt: new Date(observedAtMs).toISOString(),
    ageMs,
    stale,
    staleAfterMs: settings.healthStaleAfterMs,
    consecutiveFailures,
    inputContract: {
      supplied: validation.supplied,
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      acceptedFailureCount: reportedFailures.length,
      rejectedFailureCount: validation.failures.length,
      expectedShape: {
        observedAt: "ISO timestamp, epoch milliseconds, or Date",
        state: "healthy | degraded | failed | unknown",
        consecutiveFailures: "non-negative integer",
        failures: "array of failure objects with optional code, message, status, retryable, retryAfterMs"
      }
    },
    failures,
    retry,
    failurePolicy,
    actionableErrors
  };
}

function buildSchedulerControls({
  now,
  nowMs,
  settings,
  settingsValidation,
  commandState,
  nextAction,
  ownershipGuard,
  operationalHealth,
  sync,
  persistedState,
  clientRequest
}) {
  const mutationAction = !["reject", "sleep"].includes(nextAction.type);
  const managerDisabled = !settings.enabled && commandState.command !== "enable";
  const retryAtMs = parseTimestamp(operationalHealth.retry.nextRetryAt, null);
  const dueAtMs = parseTimestamp(nextAction.dueAt, null);
  const schedulerPausedUntilMs = parseTimestamp(settings.schedulerPausedUntil, null);
  const schedulerPauseActive =
    schedulerPausedUntilMs !== null &&
    schedulerPausedUntilMs > nowMs &&
    commandState.command !== "enable";
  const needsResync = sync.requiresResync || persistedState.recovery.required;
  const resumePending = persistedState.replay.action === "resume-pending-command";
  const pausedForHealth = operationalHealth.degradedMode && mutationAction;
  const pausedByLifecycle =
    schedulerPauseActive &&
    mutationAction &&
    !["disable-manager", "enable-manager"].includes(nextAction.type);
  const clientRuntimeOwnership = evaluateClientRuntimeOwnership({
    clientRequest,
    ownershipGuard,
    nextAction
  });
  const terminalHealthBlock =
    mutationAction &&
    (operationalHealth.failurePolicy.terminal || operationalHealth.failurePolicy.state === "terminal");
  const blockedByPolicy = [
    settingsValidation.ok ? null : "settings validation failed",
    commandState.accepted ? null : commandState.reasons[0],
    nextAction.type === "reject" ? nextAction.reason : null,
    ownershipGuard.recoverySafe ? null : ownershipGuard.blockers[0],
    clientRuntimeOwnership.accepted ? null : clientRuntimeOwnership.blockers[0],
    managerDisabled ? "scheduler is disabled for lifecycle mutations" : null,
    persistedState.duplicateCommand ? "lifecycle command was already applied" : null,
    resumePending ? "lifecycle command is already pending from persisted state" : null,
    terminalHealthBlock
      ? `terminal health failure ${operationalHealth.failurePolicy.primaryDiagnosticKey} blocks mutation`
      : null
  ].filter(Boolean);
  const policyReasons = [
    ...blockedByPolicy,
    ...ownershipGuard.blockers,
    ...clientRuntimeOwnership.blockers,
    needsResync
      ? sync.requiresResync
        ? sync.consistency.blockers[0]
        : "provider cursor or persisted state requires resync before scheduling"
      : null,
    resumePending ? `resume pending command from ${persistedState.replay.resumeFrom}` : null,
    pausedByLifecycle ? `scheduler lifecycle mutations are paused until ${settings.schedulerPausedUntil}` : null,
    pausedForHealth
      ? operationalHealth.retry.nextRetryAt
        ? `health ${operationalHealth.failureState}; retry after ${operationalHealth.retry.nextRetryAt}`
        : `health ${operationalHealth.failureState}; wait for operator intervention`
      : null,
    clientRequest.workflow.previewOnlyRequested ? "client requested preview-only scheduling" : null,
    !mutationAction && nextAction.type === "sleep" ? `next renewal check at ${nextAction.dueAt}` : null
  ].filter(Boolean);
  const state =
    blockedByPolicy.length > 0
      ? "blocked"
      : clientRequest.workflow.previewOnlyRequested
        ? "preview-only"
        : needsResync
          ? "needs-resync"
          : pausedByLifecycle
            ? "paused"
          : pausedForHealth
            ? "backoff"
            : !mutationAction
              ? "idle"
              : "ready";
  const nextRunAt =
    state === "backoff"
      ? operationalHealth.retry.nextRetryAt
      : state === "paused"
        ? settings.schedulerPausedUntil
      : state === "needs-resync" || state === "ready"
        ? now
        : state === "idle" && dueAtMs !== null
          ? new Date(Math.max(nowMs, dueAtMs)).toISOString()
          : null;
  const controls = {
    enable:
      !settings.enabled || commandState.command === "enable"
        ? {
            enabled: commandState.command === "enable" || !settings.enabled,
            command: "enable",
            reason: settings.enabled ? "enable command requested" : "manager is disabled"
          }
        : null,
    disable: settings.enabled
      ? {
          enabled: commandState.command !== "disable",
          command: "disable",
          reason: "pause future lease lifecycle scheduling"
        }
      : null,
    resume: schedulerPauseActive
      ? {
          enabled: true,
          command: "enable",
          clears: "schedulerPausedUntil",
          reason: `resume lifecycle scheduling before ${settings.schedulerPausedUntil}`
        }
      : null,
    pause: settings.enabled && !schedulerPauseActive
      ? {
          enabled: true,
          setting: "schedulerPausedUntil",
          suggestedUntil: new Date(nowMs + Math.max(settings.schedulerIntervalMs, settings.renewBeforeMs)).toISOString(),
          reason: "temporarily pause lifecycle mutations without disabling inspect routes"
        }
      : null,
    resync: needsResync
      ? {
          enabled: true,
          command: "inspect",
          reason: persistedState.recovery.required
            ? "persisted lease snapshot requires recovery"
            : "provider cursor is stale"
        }
      : null,
    retry: pausedForHealth
      ? {
          enabled: operationalHealth.retry.retryable,
          command: commandState.command,
          after: operationalHealth.retry.nextRetryAt,
          reason: operationalHealth.retry.retryable
            ? "retryable health failure is under backoff"
            : "health failure requires operator intervention"
        }
      : null
  };
  return {
    state,
    enabled: settings.enabled,
    intervalMs: settings.schedulerIntervalMs,
    action: nextAction.type,
    command: commandState.command,
    mutationAction,
    pause: {
      active: schedulerPauseActive,
      pausedUntil: settings.schedulerPausedUntil,
      remainingMs: schedulerPauseActive ? schedulerPausedUntilMs - nowMs : 0,
      source: schedulerPauseActive ? "settings.schedulerPausedUntil" : null
    },
    ownership: ownershipGuard,
    clientRuntimeOwnership,
    canApply: state === "ready",
    canSchedule: !terminalHealthBlock && ["ready", "idle", "backoff", "needs-resync", "paused"].includes(state),
    nextRunAt,
    dueAt: nextAction.dueAt,
    pausedUntil:
      state === "paused"
        ? settings.schedulerPausedUntil
        : state === "backoff" && retryAtMs !== null
          ? operationalHealth.retry.nextRetryAt
          : null,
    retryAfter: operationalHealth.retry.nextRetryAt,
    controls: Object.fromEntries(Object.entries(controls).filter(([, value]) => value !== null)),
    policyReasons: policyReasons.length > 0 ? policyReasons : ["scheduler lifecycle policy permits action"]
  };
}

function normalizePersistedCommandJournalEntry(entry, index, nowMs) {
  const command = entry && typeof entry === "object" ? entry : {};
  const idempotencyKey = firstString(command.idempotencyKey, command.commandId, command.id);
  const observedAtMs = parseTimestamp(
    command.observedAt ?? command.updatedAt ?? command.createdAt ?? command.at,
    nowMs
  );
  const state = firstString(command.state, command.status, command.result) ?? "unknown";
  const normalizedState = [
    "prepared",
    "pending",
    "in-flight",
    "handoff-pending",
    "applied",
    "committed",
    "acknowledged",
    "succeeded",
    "failed",
    "rejected",
    "expired",
    "recovery-required",
    "unknown"
  ].includes(state)
    ? state
    : "unknown";
  return {
    index,
    idempotencyKey,
    action: firstString(command.action, command.nextAction, command.type),
    command: firstString(command.command, command.lifecycleCommand),
    leaseId: firstString(command.leaseId, command.lease),
    providerId: firstString(command.providerId, command.provider),
    cursor: firstString(command.cursor, command.syncCursor),
    sequence:
      Number.isInteger(command.sequence) && command.sequence >= 0
        ? command.sequence
        : Number.isInteger(command.syncSequence) && command.syncSequence >= 0
          ? command.syncSequence
          : null,
    generation:
      Number.isInteger(command.generation) && command.generation >= 0
        ? command.generation
        : null,
    state: normalizedState,
    observedAt: new Date(observedAtMs).toISOString(),
    ageMs: Math.max(0, nowMs - observedAtMs),
    handoffId: firstString(command.handoffId, command.externalHandoffId),
    proofId: firstString(command.proofId, command.actionId),
    error: firstString(command.error, command.reason)
  };
}

function commandJournalState(entry) {
  if (!entry) {
    return "missing";
  }
  if (["applied", "committed", "acknowledged", "succeeded"].includes(entry.state)) {
    return "terminal-success";
  }
  if (["failed", "rejected", "expired"].includes(entry.state)) {
    return "terminal-failure";
  }
  if (["prepared", "pending", "in-flight", "handoff-pending"].includes(entry.state)) {
    return "pending";
  }
  return "unknown";
}

function buildPersistedRecoverySnapshot({
  lease,
  provider,
  sync,
  commandState,
  nextAction,
  tenantBoundary,
  idempotencyKey,
  now,
  persistedSequence,
  persistedGeneration,
  replayAction,
  recoveryRequired,
  pendingCommand,
  duplicateCommand
}) {
  const terminalState =
    recoveryRequired
      ? "recovery-required"
      : duplicateCommand
        ? "acknowledged"
        : pendingCommand !== null
          ? pendingCommand.state
          : "prepared";
  const ownerFence = {
    holder: lease.owner.holder,
    expectedHolder: lease.owner.expectedHolder,
    fencingToken: lease.owner.fencingToken,
    generation: lease.owner.generation,
    heartbeatAt: lease.owner.heartbeatAt,
    stale: lease.owner.stale,
    staleReasons: lease.owner.staleReasons,
    recoveryHint: lease.owner.recoveryHint
  };
  return {
    schemaVersion: "lease-manager.persisted-state.v2",
    checkpointAt: now,
    leaseId: lease.leaseId,
    providerId: provider.id,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    cursor: sync.cursor,
    sequence: Math.max(persistedSequence, sync.sequence),
    generation: Math.max(persistedGeneration, sync.sequence, lease.owner.generation),
    minSequence: Math.max(sync.sequence, lease.owner.generation),
    watermark: Math.max(persistedGeneration, sync.sequence, lease.owner.generation),
    commandId: `${commandState.command}:${nextAction.type}:${lease.leaseId}:${sync.cursor}:${sync.sequence}`,
    idempotencyKey,
    pendingCommand: pendingCommand === null
      ? null
      : {
          idempotencyKey: pendingCommand.idempotencyKey,
          command: pendingCommand.command,
          action: pendingCommand.action,
          state: pendingCommand.state,
          leaseId: pendingCommand.leaseId,
          providerId: pendingCommand.providerId,
          cursor: pendingCommand.cursor,
          sequence: pendingCommand.sequence,
          generation: pendingCommand.generation,
          observedAt: pendingCommand.observedAt,
          handoffId: pendingCommand.handoffId,
          proofId: pendingCommand.proofId
        },
    commandJournalEntry: {
      idempotencyKey,
      command: commandState.command,
      action: nextAction.type,
      state: terminalState,
      leaseId: lease.leaseId,
      providerId: provider.id,
      cursor: sync.cursor,
      sequence: sync.sequence,
      generation: Math.max(persistedGeneration, sync.sequence, lease.owner.generation),
      proofId: `${surfaceId}:${commandState.command}:${lease.leaseId}:${nextAction.type}`,
      observedAt: now,
      owner: ownerFence,
      replayAction
    },
    ownerFence,
    replayAction,
    restartSafe: !recoveryRequired && pendingCommand === null,
    recoveryRequired
  };
}

function buildCommandReplayDecision({
  lease,
  provider,
  sync,
  commandState,
  nextAction,
  idempotencyKey,
  currentJournalEntry,
  currentJournalState,
  duplicateCommand,
  pendingCommand,
  stalePendingCommand,
  leaseMismatch,
  cursorMismatch,
  generationBehind
}) {
  const entryActionMatches = currentJournalEntry === null || currentJournalEntry.action === null || currentJournalEntry.action === nextAction.type;
  const entryCommandMatches = currentJournalEntry === null || currentJournalEntry.command === null || currentJournalEntry.command === commandState.command;
  const entryLeaseMatches = currentJournalEntry === null || currentJournalEntry.leaseId === null || currentJournalEntry.leaseId === lease.leaseId;
  const entryProviderMatches =
    currentJournalEntry === null || currentJournalEntry.providerId === null || currentJournalEntry.providerId === provider.id;
  const entryCursorMatches = currentJournalEntry === null || currentJournalEntry.cursor === null || currentJournalEntry.cursor === sync.cursor;
  const entrySequenceFresh =
    currentJournalEntry === null || currentJournalEntry.sequence === null || currentJournalEntry.sequence <= sync.sequence;
  const entryScopeMatches =
    entryActionMatches &&
    entryCommandMatches &&
    entryLeaseMatches &&
    entryProviderMatches &&
    entryCursorMatches &&
    entrySequenceFresh;
  const entryMismatchReasons = [
    entryActionMatches ? null : `journal action ${currentJournalEntry.action} does not match ${nextAction.type}`,
    entryCommandMatches ? null : `journal command ${currentJournalEntry.command} does not match ${commandState.command}`,
    entryLeaseMatches ? null : `journal lease ${currentJournalEntry.leaseId} does not match ${lease.leaseId}`,
    entryProviderMatches ? null : `journal provider ${currentJournalEntry.providerId} does not match ${provider.id}`,
    entryCursorMatches ? null : `journal cursor ${currentJournalEntry.cursor} does not match ${sync.cursor}`,
    entrySequenceFresh ? null : `journal sequence ${currentJournalEntry.sequence} is ahead of sync sequence ${sync.sequence}`
  ].filter(Boolean);
  const snapshotRequiresResync = leaseMismatch || cursorMismatch || generationBehind;
  const requiresResync =
    snapshotRequiresResync ||
    stalePendingCommand ||
    currentJournalState === "unknown" ||
    (currentJournalEntry !== null && !entryScopeMatches);
  const action = requiresResync
    ? "resync-before-replay"
    : duplicateCommand
      ? "skip-duplicate"
      : pendingCommand !== null
        ? "resume-pending-command"
        : currentJournalState === "terminal-failure"
          ? "retry-after-failed-command"
          : "apply-new-command";
  const mutationDisposition =
    action === "apply-new-command"
      ? "new-mutation"
      : action === "retry-after-failed-command"
        ? "retry-mutation"
        : action === "resume-pending-command"
          ? "resume-only"
          : action === "skip-duplicate"
            ? "suppress-duplicate"
            : "resync-required";
  const reasons = [
    leaseMismatch ? `persisted lease is not ${lease.leaseId}` : null,
    cursorMismatch ? "persisted cursor is ahead of observed provider cursor" : null,
    generationBehind ? "persisted generation is behind provider sequence" : null,
    stalePendingCommand ? "pending command is older than retry window" : null,
    currentJournalState === "unknown" ? "journal entry has an unknown replay state" : null,
    ...entryMismatchReasons,
    duplicateCommand ? "idempotency journal already contains a successful command" : null,
    pendingCommand !== null && !stalePendingCommand ? `journal entry is ${pendingCommand.state} and can be resumed` : null,
    currentJournalState === "terminal-failure" ? "previous command reached a terminal failure and may be retried" : null,
    currentJournalState === "missing" ? "no journal entry exists for this idempotency key" : null
  ].filter(Boolean);
  return {
    action,
    mutationDisposition,
    idempotencyKey,
    journalState: currentJournalState,
    entryScopeMatches,
    requiresResync,
    blocksApply: requiresResync || duplicateCommand || pendingCommand !== null,
    canApplyMutation: action === "apply-new-command" || action === "retry-after-failed-command",
    canResumeHandoff: action === "resume-pending-command" && pendingCommand?.handoffId !== null,
    canRetryMutation: action === "retry-after-failed-command",
    terminal: ["skip-duplicate", "resync-before-replay"].includes(action),
    resumeFrom: pendingCommand?.observedAt ?? null,
    observedEntry: currentJournalEntry === null
      ? null
      : {
          action: currentJournalEntry.action,
          command: currentJournalEntry.command,
          leaseId: currentJournalEntry.leaseId,
          providerId: currentJournalEntry.providerId,
          cursor: currentJournalEntry.cursor,
          sequence: currentJournalEntry.sequence,
          state: currentJournalEntry.state,
          observedAt: currentJournalEntry.observedAt,
          ageMs: currentJournalEntry.ageMs
        },
    mismatchReasons: entryMismatchReasons,
    reasons: reasons.length > 0 ? reasons : ["idempotency replay permits a new lifecycle mutation"]
  };
}

function normalizePersistedSnapshot(
  input = {},
  { lease, sync, provider, commandState, nextAction, tenantBoundary, nowMs }
) {
  const persisted = input && typeof input === "object" ? input : {};
  const now = new Date(nowMs).toISOString();
  const appliedCommands = Array.isArray(persisted.appliedCommands) ? persisted.appliedCommands : [];
  const cleanedAppliedCommands = appliedCommands
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      idempotencyKey:
        typeof entry.idempotencyKey === "string" && entry.idempotencyKey
          ? entry.idempotencyKey
          : typeof entry.commandId === "string" && entry.commandId
            ? entry.commandId
            : null,
      action: typeof entry.action === "string" && entry.action ? entry.action : null,
      leaseId: typeof entry.leaseId === "string" && entry.leaseId ? entry.leaseId : null,
      sequence: Number.isInteger(entry.sequence) && entry.sequence >= 0 ? entry.sequence : null,
      result: typeof entry.result === "string" && entry.result ? entry.result : "unknown"
    }))
    .filter((entry) => entry.idempotencyKey !== null);
  const persistedLeaseId =
    typeof persisted.leaseId === "string" && persisted.leaseId ? persisted.leaseId : lease.leaseId;
  const persistedCursor =
    typeof persisted.cursor === "string" && persisted.cursor ? persisted.cursor : sync.cursor;
  const persistedSequence =
    Number.isInteger(persisted.sequence) && persisted.sequence >= 0 ? persisted.sequence : sync.sequence;
  const persistedGeneration =
    Number.isInteger(persisted.generation) && persisted.generation >= 0
      ? persisted.generation
      : Math.max(persistedSequence, sync.sequence);
  const commandId =
    typeof persisted.commandId === "string" && persisted.commandId
      ? persisted.commandId
      : `${commandState.command}:${nextAction.type}:${lease.leaseId}:${sync.cursor}:${sync.sequence}`;
  const scopeKey = `${tenantBoundary.auditSubject.tenantId}:${tenantBoundary.auditSubject.workspaceId}`;
  const idempotencyKey = `${surfaceId}:${scopeKey}:${provider.id}:${commandId}`;
  const rawJournal = [
    ...(Array.isArray(persisted.commandJournal) ? persisted.commandJournal : []),
    ...(Array.isArray(persisted.commands) ? persisted.commands : []),
    ...(persisted.pendingCommand && typeof persisted.pendingCommand === "object" ? [persisted.pendingCommand] : [])
  ];
  const commandJournal = rawJournal
    .map((entry, index) => normalizePersistedCommandJournalEntry(entry, index, nowMs))
    .filter((entry) => entry.idempotencyKey !== null)
    .slice(-24);
  const currentJournalEntry =
    [...commandJournal]
      .reverse()
      .find((entry) => entry.idempotencyKey === idempotencyKey) ?? null;
  const currentJournalState = commandJournalState(currentJournalEntry);
  const duplicateCommand =
    cleanedAppliedCommands.some((entry) => entry.idempotencyKey === idempotencyKey) ||
    currentJournalState === "terminal-success";
  const pendingCommand = currentJournalState === "pending" ? currentJournalEntry : null;
  const stalePendingCommand =
    pendingCommand !== null &&
    pendingCommand.ageMs > Math.max(sync.staleAfterMs, 2 * defaultSettings.schedulerIntervalMs);
  const leaseMismatch = persistedLeaseId !== lease.leaseId;
  const cursorMismatch = persistedCursor !== sync.cursor || persistedSequence > sync.sequence;
  const generationBehind = persistedGeneration < sync.sequence;
  const replayDecision = buildCommandReplayDecision({
    lease,
    provider,
    sync,
    commandState,
    nextAction,
    idempotencyKey,
    currentJournalEntry,
    currentJournalState,
    duplicateCommand,
    pendingCommand,
    stalePendingCommand,
    leaseMismatch,
    cursorMismatch,
    generationBehind
  });
  const checkpointAtMs = parseTimestamp(persisted.checkpointAt, null);
  const checkpointAgeMs = checkpointAtMs === null ? null : Math.max(0, nowMs - checkpointAtMs);
  const restored = checkpointAtMs !== null || cleanedAppliedCommands.length > 0;
  const recoveryReasons = [
    leaseMismatch ? `persisted lease ${persistedLeaseId} does not match active lease ${lease.leaseId}` : null,
    cursorMismatch ? "persisted cursor is ahead of observed provider cursor" : null,
    generationBehind ? "persisted generation is behind provider sequence" : null,
    duplicateCommand ? "command idempotency key was already applied" : null,
    pendingCommand !== null ? `command idempotency key is ${pendingCommand.state} after restart` : null,
    stalePendingCommand ? "pending command is older than retry window and requires provider resync" : null,
    ...replayDecision.mismatchReasons,
    currentJournalState === "unknown" ? "command journal state is unknown and requires provider resync" : null
  ].filter(Boolean);
  const recoveryRequired = replayDecision.requiresResync;
  const replayAction = replayDecision.action;
  const recoverySnapshot = buildPersistedRecoverySnapshot({
    lease,
    provider,
    sync,
    commandState,
    nextAction,
    tenantBoundary,
    idempotencyKey,
    now,
    persistedSequence,
    persistedGeneration,
    replayAction,
    recoveryRequired,
    pendingCommand,
    duplicateCommand
  });
  const persistWarnings = [
    lease.owner.fencingToken === null && ["renew-lease", "release-lease"].includes(nextAction.type)
      ? "next persisted checkpoint cannot fence owner without fencingToken"
      : null,
    lease.owner.stale && nextAction.type !== "reacquire-lease"
      ? "next persisted checkpoint observes a stale owner outside recovery action"
      : null,
    pendingCommand !== null && pendingCommand.handoffId === null && nextAction.type !== "reacquire-lease"
      ? "pending command has no handoff id; replay must use compare-and-swap preconditions"
      : null
  ].filter(Boolean);
  const phase = recoveryRequired
    ? "recovery-required"
    : duplicateCommand
      ? "command-replayed"
      : pendingCommand !== null
        ? "restored"
      : commandState.command === "inspect"
        ? restored
          ? "restored"
          : "bootstrapped"
        : "command-applied";
  return {
    key:
      typeof persisted.key === "string" && persisted.key
        ? persisted.key
        : `lease-manager:${scopeKey}:${provider.id}:${lease.leaseId}`,
    scopeKey,
    leaseId: persistedLeaseId,
    cursor: persistedCursor,
    sequence: persistedSequence,
    generation: Math.max(persistedGeneration, sync.sequence),
    checkpointAt: checkpointAtMs === null ? null : new Date(checkpointAtMs).toISOString(),
    checkpointAgeMs,
    idempotencyKey,
    duplicateCommand,
    pendingCommand: pendingCommand === null
      ? null
      : {
          idempotencyKey: pendingCommand.idempotencyKey,
          state: pendingCommand.state,
          action: pendingCommand.action,
          command: pendingCommand.command,
          observedAt: pendingCommand.observedAt,
          ageMs: pendingCommand.ageMs,
          handoffId: pendingCommand.handoffId,
          proofId: pendingCommand.proofId
        },
    phase,
    recovery: {
      required: recoveryRequired,
      restartSafe: !recoveryRequired && !stalePendingCommand && persistWarnings.length === 0,
      classification: replayAction,
      reasons: recoveryReasons.length > 0 ? recoveryReasons : replayDecision.reasons,
      resumeCursor: recoveryRequired ? sync.cursor : persistedCursor,
      resumeSequence: Math.max(persistedSequence, sync.sequence),
      persistWarnings
    },
    expectedPersistedState: recoverySnapshot,
    nextCheckpoint: {
      key:
        typeof persisted.key === "string" && persisted.key
          ? persisted.key
          : `lease-manager:${scopeKey}:${provider.id}:${lease.leaseId}`,
      appendCommand: recoverySnapshot.commandJournalEntry,
      snapshot: recoverySnapshot
    },
    replay: {
      ...replayDecision,
      reason:
        replayAction === "resync-before-replay"
          ? "provider and persisted command state must be reconciled before replay"
          : replayAction === "skip-duplicate"
            ? "idempotency journal shows the command already reached a success state"
            : replayAction === "resume-pending-command"
              ? "idempotency journal contains an unfinished command that should be resumed"
              : replayAction === "retry-after-failed-command"
                ? "previous command failed and may be retried with the same idempotency key"
                : "no persisted command blocks a new mutation"
    },
    commandJournal,
    appliedCommands: cleanedAppliedCommands.slice(-10)
  };
}

function buildExternalHandoff({
  provider,
  negotiation,
  sync,
  lease,
  nextAction,
  clientRequest,
  tenantBoundary,
  now,
  handoffInput
}) {
  const requiresExternalWork = negotiation.execution.externalHandoffRequired;
  const requestedAtMs = Date.parse(now);
  const expiresAt = new Date(requestedAtMs + provider.serviceContract.handoffTtlMs).toISOString();
  const handoffId = `${provider.serviceContract.namespace}:${provider.id}:${lease.leaseId}:${sync.sequence}:${nextAction.type}`;
  const clientCanReceiveHandoff = clientRequest.workflow.acceptsExternalHandoff;
  const acknowledgement = normalizeHandoffAcknowledgement(handoffInput, {
    provider,
    handoffId,
    lease,
    nextAction,
    sync,
    requestedAtMs,
    expiresAt,
    required: negotiation.execution.ackRequired
  });
  if (!requiresExternalWork) {
    return {
      state: "not-required",
      target: null,
      reason: negotiation.execution.directProviderCall
        ? "hosted provider will execute the lifecycle action through its service contract"
        : "next action is local scheduler state only",
      handoffId: null,
      expiresAt: null,
      ackRequired: false,
      acknowledgement,
      payload: null,
      execution: negotiation.execution,
      syncMetadata: negotiation.syncMetadata
    };
  }
  if (!negotiation.accepted) {
    return {
      state: "blocked",
      target: provider.endpoint,
      reason:
        negotiation.missing.length > 0
          ? `provider is missing capabilities: ${negotiation.missing.join(", ")}`
          : negotiation.service.blockers[0],
      handoffId,
      expiresAt,
      ackRequired: negotiation.execution.ackRequired,
      acknowledgement,
      payload: null,
      execution: negotiation.execution,
      syncMetadata: negotiation.syncMetadata
    };
  }
  if (!tenantBoundary.accepted) {
    return {
      state: "blocked",
      target: provider.endpoint,
      reason: tenantBoundary.blockers[0],
      handoffId,
      expiresAt,
      ackRequired: negotiation.execution.ackRequired,
      acknowledgement,
      payload: null,
      execution: negotiation.execution,
      syncMetadata: negotiation.syncMetadata
    };
  }
  if (negotiation.canHandoff && !clientCanReceiveHandoff) {
    return {
      state: "blocked",
      target: provider.endpoint,
      reason: "client must advertise workflow.handoff.accept before hosted handoff can be accepted",
      handoffId,
      expiresAt,
      ackRequired: negotiation.execution.ackRequired,
      acknowledgement,
      payload: null,
      execution: negotiation.execution,
      syncMetadata: negotiation.syncMetadata
    };
  }
  if (acknowledgement.required && acknowledgement.state === "rejected") {
    return {
      state: "blocked",
      target: provider.endpoint,
      reason: acknowledgement.blockers[0],
      handoffId,
      expiresAt,
      ackRequired: true,
      acknowledgement,
      payload: null,
      execution: negotiation.execution,
      syncMetadata: negotiation.syncMetadata
    };
  }
  return {
    state: acknowledgement.required && !acknowledgement.accepted
      ? "pending"
      : negotiation.canHandoff
        ? "ready"
        : "pending",
    target: provider.endpoint,
    reason: acknowledgement.required && !acknowledgement.accepted
      ? acknowledgement.blockers[0]
      : negotiation.canHandoff
        ? "provider endpoint can accept external handoff"
        : "provider can perform action but no external handoff endpoint is configured",
    handoffId,
    expiresAt,
    ackRequired: negotiation.execution.ackRequired,
    acknowledgement,
    execution: negotiation.execution,
    syncMetadata: negotiation.syncMetadata,
    payload: {
      handoffId,
      action: nextAction.type,
      leaseId: lease.leaseId,
      holder: lease.holder,
      providerId: provider.id,
      tenant: {
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        roles: tenantBoundary.roles,
        auditSubject: tenantBoundary.auditSubject
      },
      service: {
        protocol: provider.serviceContract.protocol,
        apiVersion: provider.serviceContract.apiVersion,
        namespace: provider.serviceContract.namespace,
        mode: provider.serviceContract.mode
      },
      execution: negotiation.execution,
      cursor: sync.cursor,
      sequence: sync.sequence,
      request: {
        requestId: clientRequest.requestId,
        actor: clientRequest.actor,
        channel: clientRequest.channel,
        route: clientRequest.route,
        correlationKey: clientRequest.workflow.correlationKey
      },
      requestedAt: now,
      expiresAt,
      ackRequired: negotiation.execution.ackRequired,
      preconditions: {
        leaseStatus: lease.status,
        owner: {
          holder: lease.owner.holder,
          expectedHolder: lease.owner.expectedHolder,
          generation: lease.owner.generation,
          fencingToken: lease.owner.fencingToken,
          stale: lease.owner.stale,
          staleReasons: lease.owner.staleReasons
        },
        syncSource: sync.source,
        cursorFresh: !sync.stale,
        cursorConsistent: sync.consistent,
        cursorBound: sync.scope.bound,
        sequenceAtLeastOwner: !sync.sequenceBehindOwner,
        consistency: sync.consistency
      }
    }
  };
}

function normalizeHandoffAcknowledgement(
  input,
  { provider, handoffId, lease, nextAction, sync, requestedAtMs, expiresAt, required: requiredOverride }
) {
  const source = input && typeof input === "object" ? input : {};
  const ack =
    source.acknowledgement && typeof source.acknowledgement === "object"
      ? source.acknowledgement
      : source.ack && typeof source.ack === "object"
        ? source.ack
        : source;
  const required =
    typeof requiredOverride === "boolean" ? requiredOverride : provider.serviceContract.requiresAck;
  const reportedState =
    typeof ack.state === "string" && handoffAcknowledgementStates.has(ack.state)
      ? ack.state
      : typeof ack.status === "string" && handoffAcknowledgementStates.has(ack.status)
        ? ack.status
        : null;
  const acknowledgedAtMs = parseTimestamp(ack.acknowledgedAt ?? ack.receivedAt ?? ack.at, null);
  const expiresAtMs = Date.parse(expiresAt);
  const sequence =
    Number.isInteger(ack.sequence) && ack.sequence >= 0
      ? ack.sequence
      : Number.isInteger(ack.syncSequence) && ack.syncSequence >= 0
        ? ack.syncSequence
        : null;
  const ackHandoffId = firstString(ack.handoffId, ack.id);
  const ackLeaseId = firstString(ack.leaseId, ack.lease);
  const ackAction = firstString(ack.action, ack.nextAction);
  const ackCursor = firstString(ack.cursor, ack.syncCursor);
  const ackProviderId = firstString(ack.providerId, ack.provider);
  const rejected =
    reportedState === "rejected" ||
    typeof ack.error === "string" ||
    (Array.isArray(ack.errors) && ack.errors.length > 0);
  const expired =
    reportedState === "expired" ||
    (acknowledgedAtMs !== null && Number.isFinite(expiresAtMs) && acknowledgedAtMs > expiresAtMs);
  const blockers = [
    required && ackHandoffId === null ? "provider acknowledgement is required for hosted handoff" : null,
    ackHandoffId !== null && ackHandoffId !== handoffId
      ? `provider acknowledged handoff ${ackHandoffId} instead of ${handoffId}`
      : null,
    ackProviderId !== null && ackProviderId !== provider.id
      ? `provider acknowledgement came from ${ackProviderId} instead of ${provider.id}`
      : null,
    ackLeaseId !== null && ackLeaseId !== lease.leaseId
      ? `provider acknowledged lease ${ackLeaseId} instead of ${lease.leaseId}`
      : null,
    ackAction !== null && ackAction !== nextAction.type
      ? `provider acknowledged action ${ackAction} instead of ${nextAction.type}`
      : null,
    ackCursor !== null && ackCursor !== sync.cursor
      ? `provider acknowledged cursor ${ackCursor} instead of ${sync.cursor}`
      : null,
    sequence !== null && sequence < sync.sequence
      ? `provider acknowledgement sequence ${sequence} is behind sync sequence ${sync.sequence}`
      : null,
    expired ? "provider acknowledgement expired before local mutation acceptance" : null,
    rejected
      ? firstString(ack.error, ...(Array.isArray(ack.errors) ? ack.errors : [])) ??
        "provider rejected hosted handoff"
      : null
  ].filter(Boolean);
  const identityMatches =
    ackHandoffId === handoffId &&
    (ackProviderId === null || ackProviderId === provider.id) &&
    (ackLeaseId === null || ackLeaseId === lease.leaseId) &&
    (ackAction === null || ackAction === nextAction.type) &&
    (ackCursor === null || ackCursor === sync.cursor) &&
    (sequence === null || sequence >= sync.sequence);
  const accepted =
    !required ||
    (
      identityMatches &&
      acknowledgedAtMs !== null &&
      !expired &&
      !rejected &&
      blockers.length === 0 &&
      (reportedState === null || reportedState === "acknowledged")
    );
  const state = !required
    ? "not-required"
    : rejected || expired
      ? "rejected"
      : accepted
        ? "acknowledged"
        : "pending";
  return {
    required,
    accepted,
    state,
    handoffId,
    providerId: provider.id,
    acknowledgedAt: acknowledgedAtMs === null ? null : new Date(acknowledgedAtMs).toISOString(),
    ackAgeMs: acknowledgedAtMs === null ? null : Math.max(0, acknowledgedAtMs - requestedAtMs),
    cursor: ackCursor,
    sequence,
    blockers: blockers.length > 0
      ? blockers
      : accepted
        ? ["provider acknowledgement satisfies hosted handoff preconditions"]
        : ["waiting for provider acknowledgement"]
  };
}

function buildLifecycleProof({
  now,
  commandState,
  lease,
  settingsValidation,
  nextAction,
  ownershipGuard,
  providerNegotiation,
  tenantBoundary,
  sync,
  persistedState,
  handoff,
  operationalHealth,
  schedulerControls,
  clientRequest,
  evidence
}) {
  return {
    actionId: `${surfaceId}:${commandState.command}:${lease.leaseId}:${nextAction.type}`,
    accepted:
      commandState.accepted &&
      settingsValidation.ok &&
      ownershipGuard.recoverySafe &&
      providerNegotiation.accepted &&
      tenantBoundary.accepted &&
      operationalHealth.ok &&
      (schedulerControls.canApply || !schedulerControls.mutationAction) &&
      !persistedState.recovery.required &&
      !persistedState.duplicateCommand &&
      !sync.requiresResync &&
      (!handoff.ackRequired || handoff.acknowledgement.accepted) &&
      handoff.state !== "blocked",
    generatedAt: now,
    reasons: [
      ...settingsValidation.errors,
      ...commandState.reasons,
      ...ownershipGuard.blockers,
      ...providerNegotiation.warnings,
      ...providerNegotiation.missing.map((capability) => `missing provider capability: ${capability}`),
      ...tenantBoundary.blockers,
      ...operationalHealth.actionableErrors.map((error) => `${error.code}: ${error.message}`),
      ...schedulerControls.policyReasons.filter(
        (reason) => reason !== "scheduler lifecycle policy permits action"
      ),
      ...persistedState.recovery.reasons.filter((reason) => reason !== "persisted lease snapshot matches provider state"),
      sync.requiresResync
        ? `provider sync cursor requires resync: ${sync.consistency.blockers[0]}`
        : null,
      handoff.state === "blocked" ? handoff.reason : null,
      handoff.ackRequired && !handoff.acknowledgement.accepted
        ? handoff.acknowledgement.blockers[0]
        : null,
      clientRequest.workflow.previewOnlyRequested ? "client requested preview-only lifecycle evaluation" : null,
      ...clientRequest.workflow.warnings,
      nextAction.reason
    ].filter(Boolean),
    evidence: [
      {
        type: "client-request",
        requestId: clientRequest.requestId,
        actor: clientRequest.actor,
        channel: clientRequest.channel,
        intent: clientRequest.intent,
        correlationKey: clientRequest.workflow.correlationKey,
        runtime: clientRequest.runtime
      },
      {
        type: "tenant-boundary",
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        roles: tenantBoundary.roles,
        allowedCommands: tenantBoundary.allowedCommands,
        auditSubject: tenantBoundary.auditSubject,
        accepted: tenantBoundary.accepted
      },
      {
        type: "lease-ownership",
        holder: ownershipGuard.holder,
        expectedHolder: ownershipGuard.expectedHolder,
        providerId: ownershipGuard.providerId,
        generation: ownershipGuard.generation,
        ownerClaim: ownershipGuard.ownerClaim,
        fencedAction: ownershipGuard.fencedAction,
        stale: ownershipGuard.stale,
        holderMismatch: ownershipGuard.holderMismatch,
        recoverySafe: ownershipGuard.recoverySafe,
        recovery: ownershipGuard.recovery,
        blockers: ownershipGuard.blockers
      },
      {
        type: "client-runtime-ownership",
        requestId: clientRequest.requestId,
        workerId: schedulerControls.clientRuntimeOwnership.workerId,
        required: schedulerControls.clientRuntimeOwnership.required,
        accepted: schedulerControls.clientRuntimeOwnership.accepted,
        handoffHint: schedulerControls.clientRuntimeOwnership.handoffHint,
        blockers: schedulerControls.clientRuntimeOwnership.blockers
      },
      ...(Array.isArray(evidence) ? evidence : [])
    ]
  };
}

function summarizeValidation({
  settingsValidation,
  commandState,
  ownershipGuard,
  providerNegotiation,
  tenantBoundary,
  operationalHealth,
  schedulerControls,
  sync,
  persistedState,
  handoff
}) {
  const checks = [
    {
      id: "settings",
      label: "Settings",
      ok: settingsValidation.ok,
      details:
        settingsValidation.errors.length > 0
          ? settingsValidation.errors
          : ["lease manager settings satisfy lifecycle constraints"]
    },
    {
      id: "command",
      label: "Command",
      ok: commandState.accepted,
      details:
        commandState.reasons.length > 0
          ? commandState.reasons
          : [`${commandState.command} command is allowed in the current manager state`]
    },
    {
      id: "provider-capabilities",
      label: "Provider capabilities",
      ok: providerNegotiation.accepted,
      details:
        providerNegotiation.missing.length > 0
          ? providerNegotiation.missing.map((capability) => `missing ${capability}`)
          : providerNegotiation.service.blockers.length > 0
            ? providerNegotiation.service.blockers
            : [
                `provider grants ${providerNegotiation.service.protocol} ${providerNegotiation.service.mode} contract for the selected lifecycle action`
              ]
    },
    {
      id: "lease-ownership",
      label: "Lease ownership",
      ok: ownershipGuard.recoverySafe,
      details:
        ownershipGuard.blockers.length > 0
          ? ownershipGuard.blockers
          : [
              ownershipGuard.stale
                ? ownershipGuard.recovery.allowed
                  ? `${ownershipGuard.holder} may be recovered by ${ownershipGuard.recovery.successorHolder} using ${ownershipGuard.recovery.mode}`
                  : ownershipGuard.recovery.blockers[0]
                : `${ownershipGuard.holder} holds fenced generation ${ownershipGuard.generation}`
            ]
    },
    {
      id: "client-runtime-ownership",
      label: "Client runtime ownership",
      ok: schedulerControls.clientRuntimeOwnership.accepted,
      details:
        schedulerControls.clientRuntimeOwnership.blockers.length > 0
          ? schedulerControls.clientRuntimeOwnership.blockers
          : [
              schedulerControls.clientRuntimeOwnership.required
                ? `${schedulerControls.clientRuntimeOwnership.workerId} may submit ${schedulerControls.clientRuntimeOwnership.action} with the current lease fence`
                : "client runtime ownership fence is not required for this lifecycle action"
            ]
    },
    {
      id: "tenant-boundary",
      label: "Tenant boundary",
      ok: tenantBoundary.accepted,
      details:
        tenantBoundary.blockers.length > 0
          ? tenantBoundary.blockers
          : [
              `tenant ${tenantBoundary.auditSubject.tenantId} workspace ${tenantBoundary.auditSubject.workspaceId} permits ${commandState.command}`
            ]
    },
    {
      id: "operational-health",
      label: "Operational health",
      ok: operationalHealth.ok,
      details:
        operationalHealth.actionableErrors.length > 0
          ? operationalHealth.actionableErrors.map((error) => `${error.code}: ${error.remediation}`)
          : [`lease manager health is ${operationalHealth.state}`]
    },
    {
      id: "scheduler-controls",
      label: "Scheduler controls",
      ok: schedulerControls.canApply || ["idle", "preview-only"].includes(schedulerControls.state),
      details: schedulerControls.policyReasons
    },
    {
      id: "sync-cursor",
      label: "Sync cursor",
      ok: !sync.requiresResync,
      details: sync.requiresResync
        ? sync.consistency.blockers
        : [`cursor ${sync.cursor} is fresh and scoped at sequence ${sync.sequence}`]
    },
    {
      id: "persisted-state",
      label: "Persisted state",
      ok: !persistedState.recovery.required && !persistedState.duplicateCommand,
      details: persistedState.duplicateCommand
        ? [`idempotency key ${persistedState.idempotencyKey} was already applied`]
        : persistedState.recovery.reasons
    },
    {
      id: "handoff",
      label: "Hosted handoff",
      ok: handoff.state !== "blocked" && (!handoff.ackRequired || handoff.acknowledgement.accepted),
      details: handoff.ackRequired && !handoff.acknowledgement.accepted
        ? handoff.acknowledgement.blockers
        : [handoff.reason]
    }
  ];
  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    failedCount: failed.length,
    passedCount: checks.length - failed.length,
    checks,
    blockingReasons: failed.flatMap((check) => check.details)
  };
}

function buildActionLabel(nextAction) {
  const labels = {
    "disable-manager": "Disable manager",
    "enable-manager": "Enable manager",
    "quarantine-lease": "Quarantine lease",
    "reacquire-lease": "Reacquire lease",
    "release-lease": "Release lease",
    "renew-lease": "Renew lease",
    reject: "Review issues",
    sleep: "Keep lease active"
  };
  return labels[nextAction.type] ?? "Inspect lease";
}

function resolvePreviewSeverity(nextAction, readinessState) {
  if (readinessState === "blocked" || nextAction.type === "reject") {
    return "danger";
  }
  if (["degraded", "needs-resync", "paused"].includes(readinessState) || nextAction.type === "quarantine-lease") {
    return "warning";
  }
  if (["renew-lease", "reacquire-lease", "release-lease"].includes(nextAction.type)) {
    return "success";
  }
  return "info";
}

function buildReadiness({
  proof,
  sync,
  persistedState,
  handoff,
  validationSummary,
  nextAction,
  ownershipGuard,
  operationalHealth,
  schedulerControls,
  clientRequest,
  tenantBoundary
}) {
  const mutationAction = !["reject", "sleep"].includes(nextAction.type);
  const state =
    schedulerControls.state === "backoff"
      ? "degraded"
      : schedulerControls.state === "paused"
        ? "paused"
      : schedulerControls.state === "needs-resync"
        ? "needs-resync"
        : schedulerControls.state === "preview-only"
          ? "preview-only"
          : proof.accepted
            ? clientRequest.workflow.previewOnlyRequested
              ? "preview-only"
              : mutationAction
                ? "ready"
                : "preview-only"
            : operationalHealth.degradedMode
              ? "degraded"
              : persistedState.duplicateCommand
                ? "preview-only"
                : persistedState.recovery.required
                  ? "needs-resync"
                  : sync.requiresResync
                    ? "needs-resync"
                    : "blocked";
  return {
    state,
    canMutate: state === "ready",
    canPreview: true,
    requiresResync: sync.requiresResync || persistedState.recovery.required,
    syncConsistency: sync.consistency,
    requiresHandoff: handoff.state === "ready" || handoff.state === "pending",
    degradedMode: operationalHealth.degradedMode,
    retryAfter: schedulerControls.retryAfter,
    restartSafe: persistedState.recovery.restartSafe,
    ownershipSafe: ownershipGuard.recoverySafe,
    ownerStale: ownershipGuard.stale,
    ownerHolder: ownershipGuard.holder,
    ownerExpectedHolder: ownershipGuard.expectedHolder,
    ownerFencingTokenPresent: ownershipGuard.fencingToken !== null,
    ownerRecoveryHint: ownershipGuard.recoveryHint,
    ownerRecovery: ownershipGuard.recovery,
    ownerClaim: ownershipGuard.ownerClaim,
    persistedPhase: persistedState.phase,
    schedulerState: schedulerControls.state,
    schedulerNextRunAt: schedulerControls.nextRunAt,
    schedulerCanSchedule: schedulerControls.canSchedule,
    schedulerPausedUntil: schedulerControls.pause.pausedUntil,
    schedulerPauseRemainingMs: schedulerControls.pause.remainingMs,
    schedulerPolicyReasons: schedulerControls.policyReasons,
    clientRuntimeOwnership: schedulerControls.clientRuntimeOwnership,
    clientIntent: clientRequest.intent,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    actorRoles: tenantBoundary.roles,
    auditSubject: tenantBoundary.auditSubject,
    requestId: clientRequest.requestId,
    previewOnlyRequested: clientRequest.workflow.previewOnlyRequested,
    clientCanReceiveHandoff: clientRequest.workflow.acceptsExternalHandoff,
    passedChecks: validationSummary.passedCount,
    failedChecks: validationSummary.failedCount,
    checks: validationSummary.checks.map((check) => ({
      id: check.id,
      label: check.label,
      ok: check.ok
    }))
  };
}

function buildActionPreview({
  lease,
  nextAction,
  schedulerControls,
  persistedState,
  handoff,
  validationSummary,
  readiness,
  clientRequest,
  tenantBoundary
}) {
  const primaryAction = readiness.state === "paused" ? "Resume scheduler" : buildActionLabel(nextAction);
  let headline = `${primaryAction} is blocked for ${lease.leaseId}`;
  if (readiness.state === "ready") {
    headline = `${primaryAction} is ready for ${lease.leaseId}`;
  } else if (readiness.state === "preview-only") {
    headline = persistedState.duplicateCommand
      ? `${lease.leaseId} already applied ${buildActionLabel(nextAction).toLowerCase()}`
      : `${lease.leaseId} can remain active without mutation`;
  } else if (readiness.state === "degraded") {
    headline = `${lease.leaseId} is in degraded mode; retry is paused`;
  } else if (readiness.state === "paused") {
    headline = `${lease.leaseId} lifecycle scheduling is paused until ${schedulerControls.pausedUntil}`;
  } else if (readiness.state === "needs-resync") {
    headline = `${lease.leaseId} needs provider resync before mutation`;
  }
  return {
    headline,
    severity: resolvePreviewSeverity(nextAction, readiness.state),
    primaryAction,
    statusText: nextAction.reason,
    leaseId: lease.leaseId,
    remainingMs: lease.remainingMs,
    dueAt: nextAction.dueAt,
    schedulerState: schedulerControls.state,
    schedulerNextRunAt: schedulerControls.nextRunAt,
    schedulerControls: schedulerControls.controls,
    handoffState: handoff.state,
    persistedPhase: persistedState.phase,
    restartSafe: persistedState.recovery.restartSafe,
    ownershipSafe: readiness.ownershipSafe,
    ownerStale: readiness.ownerStale,
    ownerHolder: readiness.ownerHolder,
    ownerRecoveryHint: readiness.ownerRecoveryHint,
    retryAfter: readiness.retryAfter,
    pausedUntil: schedulerControls.pausedUntil,
    requestId: clientRequest.requestId,
    routeSource: clientRequest.route.source,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    auditSubject: tenantBoundary.auditSubject,
    workflowHint:
      handoff.state === "ready"
        ? "render hosted handoff confirmation"
        : readiness.state === "preview-only"
          ? "render proof preview without mutating lease state"
          : "render blocking reasons before allowing mutation",
    blockingReasons: validationSummary.blockingReasons
  };
}

function buildAcceptance({ proof, readiness, validationSummary, persistedState }) {
  const blockedBy = validationSummary.checks
    .filter((check) => !check.ok)
    .map((check) => check.id);
  const mode =
    readiness.state === "ready"
      ? "mutating"
      : readiness.state === "preview-only"
        ? "preview-only"
        : readiness.state === "paused"
          ? "scheduler-paused"
        : readiness.state === "degraded"
          ? "degraded-mode"
        : readiness.state === "needs-resync"
          ? "resync-required"
          : "blocked";
  return {
    accepted: proof.accepted,
    mode,
    proofId: proof.actionId,
    generatedAt: proof.generatedAt,
    blockedBy,
    blockingReasons: validationSummary.blockingReasons,
    idempotencyKey: persistedState.idempotencyKey,
    duplicateCommand: persistedState.duplicateCommand,
    retryAfter: readiness.retryAfter,
    pausedUntil: readiness.schedulerPausedUntil,
    ownershipSafe: readiness.ownershipSafe,
    ownerRecoveryHint: readiness.ownerRecoveryHint,
    clientRuntimeOwnership: readiness.clientRuntimeOwnership,
    schedulerState: readiness.schedulerState,
    schedulerNextRunAt: readiness.schedulerNextRunAt,
    restartSafe: persistedState.recovery.restartSafe
  };
}

function buildNextStepContract({
  commandState,
  lease,
  provider,
  sync,
  persistedState,
  handoff,
  nextAction,
  readiness,
  acceptance,
  validationSummary,
  schedulerControls,
  operationalHealth,
  clientRequest,
  tenantBoundary
}) {
  const routeIntent =
    persistedState.replay.action === "resume-pending-command"
      ? "resume-pending-command"
      : schedulerControls.state === "paused"
        ? "resume-scheduler"
        : readiness.state === "degraded"
          ? "inspect-lease-health"
          : readiness.state === "needs-resync"
            ? "resync-provider-cursor"
            : readiness.canMutate
              ? nextAction.type
              : "inspect-lease";
  return {
    routeIntent,
    method: routeIntent.startsWith("inspect-lease") ? "GET" : "POST",
    href: `/api/aios/scheduler/leases/${encodeURIComponent(lease.leaseId)}/${routeIntent}`,
    enabled:
      readiness.canMutate ||
      ["resync-provider-cursor", "inspect-lease-health", "resume-pending-command", "resume-scheduler"].includes(routeIntent),
    explainable: true,
    body: {
      command: commandState.command,
      action: nextAction.type,
      leaseId: lease.leaseId,
      providerId: provider.id,
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      cursor: sync.cursor,
      sequence: sync.sequence,
      syncConsistency: sync.consistency,
      syncScope: sync.scope,
      idempotencyKey: persistedState.idempotencyKey,
      requestId: clientRequest.requestId,
      actor: clientRequest.actor,
      clientIntent: clientRequest.intent,
      clientRoute: clientRequest.route,
      clientRuntime: clientRequest.runtime,
      correlationKey: clientRequest.workflow.correlationKey,
      auditSubject: tenantBoundary.auditSubject,
      actorRoles: tenantBoundary.roles,
      validation: {
        ok: validationSummary.ok,
        passedCount: validationSummary.passedCount,
        failedCount: validationSummary.failedCount,
        blockedBy: acceptance.blockedBy,
        blockingReasons: validationSummary.blockingReasons.slice(0, 5),
        checks: validationSummary.checks.map((check) => ({
          id: check.id,
          ok: check.ok,
          details: check.details.slice(0, 3)
        }))
      },
      acceptance: {
        accepted: acceptance.accepted,
        mode: acceptance.mode,
        proofId: acceptance.proofId,
        duplicateCommand: acceptance.duplicateCommand,
        restartSafe: acceptance.restartSafe,
        ownershipSafe: acceptance.ownershipSafe,
        ownerRecoveryHint: acceptance.ownerRecoveryHint
      },
      ownership: {
        holder: lease.owner.holder,
        expectedHolder: lease.owner.expectedHolder,
        fencingToken: lease.owner.fencingToken,
        generation: lease.owner.generation,
        heartbeatAt: lease.owner.heartbeatAt,
        heartbeatAgeMs: lease.owner.heartbeatAgeMs,
        staleAfterMs: lease.owner.staleAfterMs,
        stale: lease.owner.stale,
        staleReasons: lease.owner.staleReasons,
        recoverySafe: readiness.ownershipSafe,
        recoveryHint: readiness.ownerRecoveryHint,
        recovery: readiness.ownerRecovery,
        claim: readiness.ownerClaim,
        clientRuntime: readiness.clientRuntimeOwnership
      },
      persistedGeneration: persistedState.generation,
      persistedPhase: persistedState.phase,
      expectedPersistedState: persistedState.expectedPersistedState,
      nextCheckpoint: persistedState.nextCheckpoint,
      idempotencyReplay: persistedState.replay,
      pendingCommand: persistedState.pendingCommand,
      scheduler: {
        state: schedulerControls.state,
        canApply: schedulerControls.canApply,
        canSchedule: schedulerControls.canSchedule,
        nextRunAt: schedulerControls.nextRunAt,
        pausedUntil: schedulerControls.pausedUntil,
        pause: schedulerControls.pause,
        controls: schedulerControls.controls,
        policyReasons: schedulerControls.policyReasons
      },
      health: {
        state: operationalHealth.state,
        failureState: operationalHealth.failureState,
        degradedMode: operationalHealth.degradedMode,
        retry: operationalHealth.retry,
        failurePolicy: operationalHealth.failurePolicy,
        actionableErrors: operationalHealth.actionableErrors.slice(0, 5)
      },
      recovery: persistedState.recovery,
      retryAfter: readiness.retryAfter,
      providerExecution: {
        mode: handoff.execution?.mode ?? "unknown",
        intendedMode: handoff.execution?.intendedMode ?? "unknown",
        hosted: handoff.execution?.hosted === true,
        directProviderCall: handoff.execution?.directProviderCall === true,
        externalHandoffRequired: handoff.execution?.externalHandoffRequired === true,
        ackRequired: handoff.execution?.ackRequired === true,
        target: handoff.execution?.target ?? provider.endpoint,
        syncMetadata: handoff.syncMetadata ?? null,
        syncConsistency: sync.consistency,
        blockers: handoff.execution?.blockers ?? []
      },
      handoff: handoff.payload
    }
  };
}

function buildErrorRouteContracts({
  lease,
  provider,
  sync,
  commandState,
  nextAction,
  operationalHealth,
  schedulerControls,
  clientRequest,
  tenantBoundary,
  persistedState
}) {
  const baseBody = {
    leaseId: lease.leaseId,
    providerId: provider.id,
    command: commandState.command,
    action: nextAction.type,
    cursor: sync.cursor,
    sequence: sync.sequence,
    syncConsistency: sync.consistency,
    syncScope: sync.scope,
    requestId: clientRequest.requestId,
    actor: clientRequest.actor,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    auditSubject: tenantBoundary.auditSubject,
    idempotencyKey: persistedState.idempotencyKey,
    replay: persistedState.replay,
    pendingCommand: persistedState.pendingCommand,
    ownership: {
      holder: lease.owner.holder,
      expectedHolder: lease.owner.expectedHolder,
      generation: lease.owner.generation,
      claim: schedulerControls.ownership.ownerClaim,
      stale: lease.owner.stale,
      staleReasons: lease.owner.staleReasons,
      recovery: schedulerControls.ownership.recovery,
      clientRuntime: schedulerControls.clientRuntimeOwnership
    }
  };
  const healthBody = {
    ...baseBody,
    health: {
      state: operationalHealth.state,
      failureState: operationalHealth.failureState,
      observedAt: operationalHealth.observedAt,
      stale: operationalHealth.stale,
      failurePolicy: operationalHealth.failurePolicy,
      failures: operationalHealth.failures,
      actionableErrors: operationalHealth.actionableErrors
    }
  };
  return {
    diagnostics: {
      method: "POST",
      href: `/api/aios/scheduler/leases/${encodeURIComponent(lease.leaseId)}/inspect-lease-health`,
      enabled: operationalHealth.actionableErrors.length > 0 || operationalHealth.degradedMode,
      body: healthBody
    },
    retry: {
      method: "POST",
      href: `/api/aios/scheduler/leases/${encodeURIComponent(lease.leaseId)}/retry-lease-action`,
      enabled:
        operationalHealth.retry.retryable &&
        !operationalHealth.failurePolicy.terminal &&
        schedulerControls.pausedUntil !== null,
      after: schedulerControls.pausedUntil,
      body: {
        ...baseBody,
        retry: operationalHealth.retry,
        failurePolicy: operationalHealth.failurePolicy
      }
    },
    override: {
      method: "POST",
      href: `/api/aios/scheduler/leases/${encodeURIComponent(lease.leaseId)}/operator-health-override`,
      enabled: operationalHealth.failurePolicy.terminal || operationalHealth.failurePolicy.circuitOpen,
      body: {
        ...baseBody,
        requiredRole: "lease.admin",
        diagnosticKey: operationalHealth.failurePolicy.primaryDiagnosticKey,
        terminal: operationalHealth.failurePolicy.terminal,
        circuitOpen: operationalHealth.failurePolicy.circuitOpen,
        reason:
          operationalHealth.actionableErrors[0]?.remediation ??
          "operator review is required before accepting hosted lease mutation"
      }
    }
  };
}

function buildClientWorkflowHandoff({
  handoff,
  nextStep,
  readiness,
  acceptance,
  validationSummary,
  clientRequest,
  tenantBoundary
}) {
  const requiresHandoff = handoff.state === "ready" || handoff.state === "pending" || handoff.state === "blocked";
  const leaseId = nextStep.body.leaseId;
  const confirmationHref = handoff.handoffId === null
    ? null
    : `/api/aios/scheduler/leases/${encodeURIComponent(leaseId)}/handoff/${encodeURIComponent(handoff.handoffId)}/confirm`;
  const returnHref =
    clientRequest.route.href ??
    `/scheduler/leases/${encodeURIComponent(leaseId)}?requestId=${encodeURIComponent(clientRequest.requestId)}`;
  const blockedReason =
    handoff.state === "blocked"
      ? handoff.reason
      : validationSummary.blockingReasons.find((reason) => typeof reason === "string") ?? null;
  const providerAckPending = handoff.ackRequired && !handoff.acknowledgement.accepted;
  const clientAckRequired = requiresHandoff && handoff.state !== "blocked" && handoff.ackRequired;
  const confirmationEnabled =
    requiresHandoff &&
    handoff.state !== "blocked" &&
    clientRequest.workflow.acceptsExternalHandoff &&
    !acceptance.duplicateCommand &&
    !readiness.requiresResync;
  const state = !requiresHandoff
    ? "not-required"
    : handoff.state === "blocked"
      ? "blocked"
      : providerAckPending
        ? "awaiting-provider-ack"
        : confirmationEnabled
          ? "ready-to-confirm"
          : "awaiting-client-capability";
  const handoffSummary = handoff.payload === null
    ? null
    : {
        handoffId: handoff.payload.handoffId,
        action: handoff.payload.action,
        leaseId: handoff.payload.leaseId,
        providerId: handoff.payload.providerId,
        cursor: handoff.payload.cursor,
        sequence: handoff.payload.sequence,
        expiresAt: handoff.payload.expiresAt,
        ackRequired: handoff.payload.ackRequired
      };
  const confirmationBody = confirmationHref === null
    ? null
    : {
        handoffId: handoff.handoffId,
        leaseId,
        providerId: nextStep.body.providerId,
        action: nextStep.body.action,
        cursor: nextStep.body.cursor,
        sequence: nextStep.body.sequence,
        requestId: clientRequest.requestId,
        actor: clientRequest.actor,
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        correlationKey: clientRequest.workflow.correlationKey,
        clientRuntime: nextStep.body.clientRuntime,
        clientRuntimeOwnership: nextStep.body.ownership.clientRuntime,
        auditSubject: tenantBoundary.auditSubject,
        idempotencyKey: nextStep.body.idempotencyKey,
        returnTo: returnHref
      };
  return {
    state,
    visible: requiresHandoff,
    handoffId: handoff.handoffId,
    target: handoff.target,
    expiresAt: handoff.expiresAt,
    deadlineMs: handoff.expiresAt === null
      ? null
      : Math.max(0, Date.parse(handoff.expiresAt) - Date.parse(clientRequest.receivedAt)),
    requiresClientAck: clientAckRequired,
    requiresProviderAck: handoff.ackRequired,
    providerAckState: handoff.acknowledgement.state,
    confirmation: {
      method: "POST",
      href: confirmationHref,
      enabled: confirmationEnabled,
      reason: confirmationEnabled
        ? "client may confirm hosted handoff and continue the lifecycle workflow"
        : blockedReason ?? handoff.acknowledgement.blockers[0] ?? "client cannot confirm hosted handoff yet",
      body: confirmationBody
    },
    returnRoute: {
      method: clientRequest.route.method ?? "GET",
      href: returnHref,
      source: clientRequest.route.source,
      intent: clientRequest.intent
    },
    receipt: {
      requestId: clientRequest.requestId,
      actor: clientRequest.actor,
      channel: clientRequest.channel,
      correlationKey: clientRequest.workflow.correlationKey,
      auditSubject: tenantBoundary.auditSubject,
      blockedBy: validationSummary.checks.filter((check) => !check.ok).map((check) => check.id),
      handoff: handoffSummary
    }
  };
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function normalizeAnalyticsHistoryEntry(entry, index, nowMs) {
  const snapshot = entry && typeof entry === "object" ? entry : {};
  const atMs = parseTimestamp(snapshot.at ?? snapshot.generatedAt ?? snapshot.observedAt, nowMs);
  const action = firstString(snapshot.action, snapshot.nextAction, snapshot.type) ?? "unknown";
  const readinessState = firstString(
    snapshot.readinessState,
    snapshot.readiness?.state,
    snapshot.decision
  ) ?? "unknown";
  const acceptanceMode = firstString(snapshot.acceptanceMode, snapshot.acceptance?.mode) ?? "unknown";
  const healthState = firstString(snapshot.healthState, snapshot.health?.state) ?? "unknown";
  const handoffState = firstString(snapshot.handoffState, snapshot.handoff?.state) ?? "not-required";
  const schedulerState = firstString(snapshot.schedulerState, snapshot.scheduler?.state) ?? "unknown";
  const recoveryMode = firstString(
    snapshot.recoveryMode,
    snapshot.ownerRecovery?.mode,
    snapshot.ownership?.recovery?.mode,
    snapshot.recovery?.classification
  ) ?? "not-required";
  const replayAction = firstString(
    snapshot.replayAction,
    snapshot.replay?.action,
    snapshot.persistedState?.replay?.action
  ) ?? "unknown";
  const blockedReasons = Array.isArray(snapshot.blockingReasons)
    ? snapshot.blockingReasons
    : Array.isArray(snapshot.acceptance?.blockingReasons)
      ? snapshot.acceptance.blockingReasons
      : Array.isArray(snapshot.blockedReasons)
        ? snapshot.blockedReasons
        : [];
  const failureCount =
    Number.isInteger(snapshot.failureCount) && snapshot.failureCount >= 0
      ? snapshot.failureCount
      : Array.isArray(snapshot.failures)
        ? snapshot.failures.length
        : Array.isArray(snapshot.health?.failures)
          ? snapshot.health.failures.length
          : 0;
  return {
    index,
    at: new Date(atMs).toISOString(),
    leaseId: firstString(snapshot.leaseId, snapshot.lease?.leaseId) ?? "unassigned",
    providerId: firstString(snapshot.providerId, snapshot.provider?.id) ?? "unknown-provider",
    tenantId: firstString(snapshot.tenantId, snapshot.tenant?.tenantId, snapshot.auditSubject?.tenantId),
    workspaceId: firstString(
      snapshot.workspaceId,
      snapshot.workspace?.workspaceId,
      snapshot.auditSubject?.workspaceId
    ),
    action,
    command: firstString(snapshot.command, snapshot.requestedCommand) ?? action,
    leaseStatus: firstString(snapshot.leaseStatus, snapshot.lease?.status) ?? "unknown",
    readinessState,
    acceptanceMode,
    accepted: snapshot.accepted === true || snapshot.acceptance?.accepted === true,
    healthState,
    failureCount,
    handoffState,
    schedulerState,
    ownerStale: snapshot.ownerStale === true || snapshot.ownership?.stale === true,
    ownershipSafe:
      snapshot.ownershipSafe === true ||
      snapshot.ownership?.recoverySafe === true ||
      snapshot.readiness?.ownershipSafe === true,
    recoveryRequired:
      snapshot.recoveryRequired === true ||
      snapshot.ownerRecovery?.required === true ||
      snapshot.ownership?.recovery?.required === true ||
      snapshot.persistedState?.recovery?.required === true,
    recoveryMode,
    restartSafe:
      snapshot.restartSafe === false ||
      snapshot.recovery?.restartSafe === false ||
      snapshot.persistedState?.recovery?.restartSafe === false
        ? false
        : true,
    replayAction,
    duplicateCommand:
      snapshot.duplicateCommand === true ||
      snapshot.acceptance?.duplicateCommand === true ||
      snapshot.persistedState?.duplicateCommand === true,
    blockedReasonCount: blockedReasons.length,
    transitionMode: firstString(snapshot.transitionMode, snapshot.transition?.mode) ?? "unknown",
    routeIntent: firstString(snapshot.routeIntent, snapshot.nextStep?.routeIntent) ?? "inspect-lease",
    cursor: firstString(snapshot.cursor, snapshot.sync?.cursor),
    sequence:
      Number.isInteger(snapshot.sequence) && snapshot.sequence >= 0
        ? snapshot.sequence
        : Number.isInteger(snapshot.sync?.sequence) && snapshot.sync.sequence >= 0
          ? snapshot.sync.sequence
          : null,
    remainingMs:
      Number.isInteger(snapshot.remainingMs) && snapshot.remainingMs >= 0
        ? snapshot.remainingMs
        : Number.isInteger(snapshot.lease?.remainingMs) && snapshot.lease.remainingMs >= 0
          ? snapshot.lease.remainingMs
          : null,
    durationMs:
      Number.isInteger(snapshot.durationMs) && snapshot.durationMs >= 0
        ? snapshot.durationMs
        : Number.isInteger(snapshot.latencyMs) && snapshot.latencyMs >= 0
          ? snapshot.latencyMs
          : null,
    proofId: firstString(snapshot.proofId, snapshot.proof?.actionId),
    idempotencyKey: firstString(snapshot.idempotencyKey, snapshot.persistedState?.idempotencyKey)
  };
}

function buildCurrentAnalyticsSnapshot({
  now,
  lease,
  provider,
  sync,
  nextAction,
  readiness,
  acceptance,
  transition,
  handoff,
  operationalHealth,
  nextStep,
  tenantBoundary,
  persistedState,
  proof,
  schedulerControls
}) {
  return {
    index: 0,
    at: now,
    leaseId: lease.leaseId,
    providerId: provider.id,
    tenantId: tenantBoundary.tenantId,
    workspaceId: tenantBoundary.workspaceId,
    action: nextAction.type,
    command: nextStep.body.command,
    leaseStatus: lease.status,
    readinessState: readiness.state,
    acceptanceMode: acceptance.mode,
    accepted: acceptance.accepted,
    healthState: operationalHealth.state,
    failureCount: operationalHealth.failures.length,
    handoffState: handoff.state,
    schedulerState: schedulerControls.state,
    ownerStale: readiness.ownerStale,
    ownershipSafe: readiness.ownershipSafe,
    recoveryRequired: readiness.ownerRecovery?.required === true || persistedState.recovery.required,
    recoveryMode: readiness.ownerRecovery?.mode ?? persistedState.recovery.classification,
    restartSafe: persistedState.recovery.restartSafe,
    replayAction: persistedState.replay.action,
    duplicateCommand: persistedState.duplicateCommand,
    blockedReasonCount: acceptance.blockingReasons.length,
    transitionMode: transition.mode,
    routeIntent: nextStep.routeIntent,
    cursor: sync.cursor,
    sequence: sync.sequence,
    remainingMs: lease.remainingMs,
    durationMs: 0,
    proofId: proof.actionId,
    idempotencyKey: persistedState.idempotencyKey
  };
}

function buildAnalyticsExportRows(snapshots, timeline) {
  const eventsByIndex = new Map(timeline.map((event, index) => [index, event]));
  return snapshots.map((snapshot, index) => {
    const event = eventsByIndex.get(index);
    return {
      at: snapshot.at,
      eventId: event?.eventId ?? `${surfaceId}:${snapshot.leaseId}:unknown:${index}`,
      leaseId: snapshot.leaseId,
      providerId: snapshot.providerId,
      tenantId: snapshot.tenantId,
      workspaceId: snapshot.workspaceId,
      action: snapshot.action,
      command: snapshot.command,
      routeIntent: snapshot.routeIntent,
      leaseStatus: snapshot.leaseStatus,
      readinessState: snapshot.readinessState,
      acceptanceMode: snapshot.acceptanceMode,
      schedulerState: snapshot.schedulerState,
      healthState: snapshot.healthState,
      handoffState: snapshot.handoffState,
      transitionMode: snapshot.transitionMode,
      severity: event?.severity ?? "info",
      accepted: snapshot.accepted,
      ownerStale: snapshot.ownerStale,
      ownershipSafe: snapshot.ownershipSafe,
      recoveryRequired: snapshot.recoveryRequired,
      recoveryMode: snapshot.recoveryMode,
      restartSafe: snapshot.restartSafe,
      replayAction: snapshot.replayAction,
      duplicateCommand: snapshot.duplicateCommand,
      failureCount: snapshot.failureCount,
      blockedReasonCount: snapshot.blockedReasonCount,
      remainingMs: snapshot.remainingMs,
      durationMs: snapshot.durationMs,
      cursor: snapshot.cursor,
      sequence: snapshot.sequence,
      proofId: snapshot.proofId,
      idempotencyKey: snapshot.idempotencyKey
    };
  });
}

function summarizeAnalyticsWindow(snapshots) {
  const sortedDurations = snapshots
    .map((snapshot) => snapshot.durationMs)
    .filter((duration) => Number.isInteger(duration) && duration >= 0)
    .sort((left, right) => left - right);
  const percentile = (ratio) => {
    if (sortedDurations.length === 0) {
      return null;
    }
    return sortedDurations[Math.min(sortedDurations.length - 1, Math.floor((sortedDurations.length - 1) * ratio))];
  };
  const blocked = snapshots.filter((snapshot) => !snapshot.accepted);
  const recoveryRequired = snapshots.filter((snapshot) => snapshot.recoveryRequired);
  const ownerStale = snapshots.filter((snapshot) => snapshot.ownerStale);
  return {
    acceptedRate: snapshots.length === 0 ? 0 : (snapshots.length - blocked.length) / snapshots.length,
    blockedRate: snapshots.length === 0 ? 0 : blocked.length / snapshots.length,
    recoveryRequiredCount: recoveryRequired.length,
    ownerStaleCount: ownerStale.length,
    duplicateCommandCount: snapshots.filter((snapshot) => snapshot.duplicateCommand).length,
    restartUnsafeCount: snapshots.filter((snapshot) => !snapshot.restartSafe).length,
    maxFailureCount: Math.max(0, ...snapshots.map((snapshot) => snapshot.failureCount)),
    maxBlockedReasonCount: Math.max(0, ...snapshots.map((snapshot) => snapshot.blockedReasonCount)),
    durationMs: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      max: sortedDurations.at(-1) ?? null
    },
    latestBlockedReasonCount: snapshots.at(-1)?.blockedReasonCount ?? 0,
    latestRecoveryMode: snapshots.at(-1)?.recoveryMode ?? "not-required"
  };
}

function buildAnalyticsReport({
  input,
  now,
  nowMs,
  lease,
  provider,
  sync,
  nextAction,
  readiness,
  acceptance,
  transition,
  handoff,
  operationalHealth,
  nextStep,
  tenantBoundary,
  persistedState,
  proof,
  schedulerControls
}) {
  const analyticsInput = input.analytics && typeof input.analytics === "object" ? input.analytics : {};
  const historyInput = Array.isArray(analyticsInput.history)
    ? analyticsInput.history
    : Array.isArray(input.history)
      ? input.history
      : [];
  const history = historyInput
    .map((entry, index) => normalizeAnalyticsHistoryEntry(entry, index + 1, nowMs))
    .filter((entry) => entry.leaseId === lease.leaseId || entry.leaseId === "unassigned")
    .slice(-24);
  const current = buildCurrentAnalyticsSnapshot({
    now,
    lease,
    provider,
    sync,
    nextAction,
    readiness,
    acceptance,
    transition,
    handoff,
    operationalHealth,
    nextStep,
    tenantBoundary,
    persistedState,
    proof,
    schedulerControls
  });
  const snapshots = [...history, current].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const failed = snapshots.filter((snapshot) => !snapshot.accepted);
  const timeline = snapshots.map((snapshot) => ({
    at: snapshot.at,
    eventId: `${surfaceId}:${snapshot.leaseId}:${snapshot.sequence ?? "n"}:${snapshot.action}:${snapshot.index}`,
    leaseId: snapshot.leaseId,
    providerId: snapshot.providerId,
    action: snapshot.action,
    routeIntent: snapshot.routeIntent,
    readinessState: snapshot.readinessState,
    acceptanceMode: snapshot.acceptanceMode,
    severity:
      snapshot.accepted
        ? "info"
        : snapshot.healthState === "failed" || snapshot.acceptanceMode === "blocked"
          ? "danger"
          : "warning",
    accepted: snapshot.accepted,
    proofId: snapshot.proofId,
    idempotencyKey: snapshot.idempotencyKey,
    ownerStale: snapshot.ownerStale,
    recoveryRequired: snapshot.recoveryRequired,
    recoveryMode: snapshot.recoveryMode,
    restartSafe: snapshot.restartSafe,
    blockedReasonCount: snapshot.blockedReasonCount
  }));
  const firstAt = snapshots[0]?.at ?? now;
  const lastAt = snapshots[snapshots.length - 1]?.at ?? now;
  const exportRows = buildAnalyticsExportRows(snapshots, timeline);
  const windowSummary = summarizeAnalyticsWindow(snapshots);
  return {
    schemaVersion: "lease-manager.analytics.v1",
    generatedAt: now,
    reportId: `${surfaceId}:${tenantBoundary.auditSubject.tenantId}:${tenantBoundary.auditSubject.workspaceId}:${lease.leaseId}:${sync.sequence}`,
    scope: {
      tenantId: tenantBoundary.tenantId,
      workspaceId: tenantBoundary.workspaceId,
      leaseId: lease.leaseId,
      providerId: provider.id,
      cursor: sync.cursor,
      sequence: sync.sequence
    },
    window: {
      startedAt: firstAt,
      endedAt: lastAt,
      snapshotCount: snapshots.length,
      historyLimit: 24,
      summary: windowSummary
    },
    counters: {
      total: snapshots.length,
      accepted: snapshots.length - failed.length,
      blocked: failed.length,
      failures: snapshots.reduce((total, snapshot) => total + snapshot.failureCount, 0),
      byAction: countBy(snapshots, (snapshot) => snapshot.action),
      byReadiness: countBy(snapshots, (snapshot) => snapshot.readinessState),
      byAcceptanceMode: countBy(snapshots, (snapshot) => snapshot.acceptanceMode),
      byLeaseStatus: countBy(snapshots, (snapshot) => snapshot.leaseStatus),
      byHealthState: countBy(snapshots, (snapshot) => snapshot.healthState),
      byHandoffState: countBy(snapshots, (snapshot) => snapshot.handoffState),
      bySchedulerState: countBy(snapshots, (snapshot) => snapshot.schedulerState),
      byRecoveryMode: countBy(snapshots, (snapshot) => snapshot.recoveryMode),
      ownerStale: windowSummary.ownerStaleCount,
      recoveryRequired: windowSummary.recoveryRequiredCount,
      duplicateCommands: windowSummary.duplicateCommandCount,
      restartUnsafe: windowSummary.restartUnsafeCount
    },
    current,
    history,
    timeline,
    exportRows,
    exportSummary: {
      format: "jsonl-or-csv",
      formats: ["jsonl", "csv"],
      rowCount: exportRows.length,
      primaryKey: "eventId",
      columns: [
        "at",
        "eventId",
        "leaseId",
        "providerId",
        "tenantId",
        "workspaceId",
        "action",
        "command",
        "routeIntent",
        "leaseStatus",
        "readinessState",
        "acceptanceMode",
        "schedulerState",
        "healthState",
        "handoffState",
        "transitionMode",
        "severity",
        "accepted",
        "ownerStale",
        "ownershipSafe",
        "recoveryRequired",
        "recoveryMode",
        "restartSafe",
        "replayAction",
        "duplicateCommand",
        "failureCount",
        "blockedReasonCount",
        "remainingMs",
        "durationMs",
        "cursor",
        "sequence",
        "proofId",
        "idempotencyKey"
      ],
      partitionKeys: ["tenantId", "workspaceId", "leaseId", "providerId"],
      sampleRows: exportRows.slice(-3),
      suggestedFilename: `lease-manager-${lease.leaseId}-${sync.sequence}.jsonl`
    }
  };
}

function buildWorkflowAction({ id, label, routeIntent, method, href, enabled, reason, body }) {
  return {
    id,
    label,
    routeIntent,
    method,
    href,
    enabled,
    reason,
    body
  };
}

function buildReviewRouteOption({ id, label, route, enabled, reason, category }) {
  return {
    id,
    label,
    category,
    routeIntent: route.routeIntent ?? route.body?.routeIntent ?? id,
    method: route.method,
    href: route.href,
    enabled,
    reason,
    body: route.body
  };
}

function buildReviewSubmissionContract({
  state,
  selectedRoute,
  requiredDecisions,
  readiness,
  acceptance,
  validationSummary,
  nextStep,
  clientRequest,
  tenantBoundary,
  proof,
  transition
}) {
  const unresolvedRequiredDecisions = requiredDecisions.filter(
    (decision) => decision.required && !decision.satisfied
  );
  const lifecycleApplyRoute =
    selectedRoute?.category === "apply" ||
    (selectedRoute?.routeIntent === nextStep.routeIntent && acceptance.mode === "mutating");
  const explicitAcceptanceRequired =
    lifecycleApplyRoute &&
    !clientRequest.workflow.previewOnlyRequested &&
    acceptance.accepted;
  const acknowledgementChecklist = [
    {
      id: "proof-reviewed",
      label: "Proof reviewed",
      required: explicitAcceptanceRequired,
      satisfied: acceptance.accepted && transition.accepted,
      reason: transition.accepted
        ? `proof ${proof.actionId} matches the selected ${nextStep.body.action} transition`
        : "transition is not ready for commit"
    },
    {
      id: "validation-reviewed",
      label: "Validation reviewed",
      required: explicitAcceptanceRequired || validationSummary.failedCount > 0,
      satisfied: validationSummary.failedCount === 0,
      reason:
        validationSummary.failedCount === 0
          ? `${validationSummary.passedCount} validation checks passed`
          : `${validationSummary.failedCount} validation checks still require review`
    },
    {
      id: "restart-safety-reviewed",
      label: "Restart safety reviewed",
      required: explicitAcceptanceRequired,
      satisfied: acceptance.restartSafe,
      reason: acceptance.restartSafe
        ? "idempotency and persisted state are restart-safe"
        : "persisted state requires resync before mutation"
    },
    {
      id: "ownership-reviewed",
      label: "Ownership reviewed",
      required: explicitAcceptanceRequired || readiness.ownerStale,
      satisfied: readiness.ownershipSafe,
      reason: readiness.ownershipSafe
        ? `${readiness.ownerHolder} ownership is safe for ${nextStep.body.action}`
        : readiness.ownerRecovery?.blockers?.[0] ?? "lease ownership is not safe for mutation"
    },
    {
      id: "client-runtime-reviewed",
      label: "Client runtime reviewed",
      required: explicitAcceptanceRequired && readiness.clientRuntimeOwnership.required,
      satisfied: readiness.clientRuntimeOwnership.accepted,
      reason: readiness.clientRuntimeOwnership.accepted
        ? readiness.clientRuntimeOwnership.handoffHint
        : readiness.clientRuntimeOwnership.blockers[0] ?? "client runtime ownership must be refreshed"
    }
  ];
  const unresolvedAcknowledgements = acknowledgementChecklist.filter(
    (item) => item.required && !item.satisfied
  );
  const unresolvedRouteDecisions = lifecycleApplyRoute ? unresolvedRequiredDecisions : [];
  const unresolvedRouteAcknowledgements = lifecycleApplyRoute ? unresolvedAcknowledgements : [];
  const disabledReasons = [
    selectedRoute?.enabled ? null : selectedRoute?.reason ?? "selected route is disabled",
    ...unresolvedRouteDecisions.map((decision) => decision.reason),
    ...unresolvedRouteAcknowledgements.map((item) => item.reason),
    state === "blocked" ? validationSummary.blockingReasons[0] ?? "review gate is blocked" : null
  ].filter(Boolean);
  const enabled =
    selectedRoute?.enabled === true &&
    state !== "blocked" &&
    (!lifecycleApplyRoute || (unresolvedRouteDecisions.length === 0 && unresolvedRouteAcknowledgements.length === 0));
  const submitBody = selectedRoute?.body
    ? {
        ...selectedRoute.body,
        reviewDecision: {
          schemaVersion: "lease-manager.review-submission.v1",
          decision:
            enabled && lifecycleApplyRoute
              ? "accept"
              : enabled
                ? "continue"
                : state === "preview"
                  ? "preview-only"
                  : "blocked",
          gateState: state,
          selectedRouteId: selectedRoute.id,
          selectedCategory: selectedRoute.category,
          proofId: proof.actionId,
          transitionMode: transition.mode,
          transitionAccepted: transition.accepted,
          acceptanceMode: acceptance.mode,
          accepted: acceptance.accepted,
          requestId: clientRequest.requestId,
          actor: clientRequest.actor,
          tenantId: tenantBoundary.tenantId,
          workspaceId: tenantBoundary.workspaceId,
          auditSubject: tenantBoundary.auditSubject,
          requiredAcknowledgementIds: acknowledgementChecklist
            .filter((item) => item.required)
            .map((item) => item.id),
          unresolvedAcknowledgementIds: unresolvedAcknowledgements.map((item) => item.id),
          unresolvedDecisionIds: unresolvedRequiredDecisions.map((decision) => decision.id)
        }
      }
    : null;
  return {
    schemaVersion: "lease-manager.review-submission.v1",
    state: enabled ? "ready" : state === "preview" ? "preview-only" : "blocked",
    enabled,
    explicitAcceptanceRequired,
    selectedRouteId: selectedRoute?.id ?? null,
    selectedCategory: selectedRoute?.category ?? null,
    method: selectedRoute?.method ?? null,
    href: selectedRoute?.href ?? null,
    routeIntent: selectedRoute?.routeIntent ?? null,
    disabledReasons,
    requiredDecisionIds: requiredDecisions.filter((decision) => decision.required).map((decision) => decision.id),
    unresolvedDecisionIds: unresolvedRequiredDecisions.map((decision) => decision.id),
    unresolvedRouteDecisionIds: unresolvedRouteDecisions.map((decision) => decision.id),
    acknowledgementChecklist,
    unresolvedAcknowledgementIds: unresolvedAcknowledgements.map((item) => item.id),
    unresolvedRouteAcknowledgementIds: unresolvedRouteAcknowledgements.map((item) => item.id),
    submitBody
  };
}

function buildReviewGate({
  preview,
  readiness,
  acceptance,
  validationSummary,
  nextStep,
  errorRoutes,
  clientWorkflowHandoff,
  transition,
  clientRequest,
  tenantBoundary,
  proof
}) {
  const failedChecks = validationSummary.checks.filter((check) => !check.ok);
  const requiresHandoffConfirmation =
    clientWorkflowHandoff.visible && clientWorkflowHandoff.confirmation.enabled;
  const state =
    readiness.requiresResync
      ? "needs-resync"
      : nextStep.body.health.degradedMode
        ? "needs-health-review"
        : requiresHandoffConfirmation
          ? "needs-handoff-confirmation"
          : acceptance.accepted
            ? "approved"
            : readiness.state === "preview-only"
              ? "preview"
              : "blocked";
  const availableRoutes = [
    buildReviewRouteOption({
      id: "selected-next-step",
      label: preview.primaryAction,
      category: acceptance.accepted ? "apply" : "inspect",
      route: nextStep,
      enabled: nextStep.enabled,
      reason: nextStep.enabled
        ? `submit ${nextStep.routeIntent} after reviewing proof ${acceptance.proofId}`
        : validationSummary.blockingReasons[0] ?? "selected route is not enabled"
    }),
    readiness.requiresResync
      ? buildReviewRouteOption({
          id: "resync-provider-cursor",
          label: "Resync provider cursor",
          category: "recovery",
          route: {
            method: "POST",
            href: nextStep.href.replace(/\/[^/]+$/, "/resync-provider-cursor"),
            body: {
              leaseId: nextStep.body.leaseId,
              providerId: nextStep.body.providerId,
              cursor: nextStep.body.cursor,
              sequence: nextStep.body.sequence,
              syncConsistency: nextStep.body.syncConsistency,
              syncScope: nextStep.body.syncScope,
              requestId: nextStep.body.requestId,
              idempotencyKey: nextStep.body.idempotencyKey,
              replay: nextStep.body.idempotencyReplay,
              auditSubject: tenantBoundary.auditSubject
            }
          },
          enabled: true,
          reason: "provider cursor or persisted snapshot must be reconciled first"
        })
      : null,
    errorRoutes.diagnostics.enabled
      ? buildReviewRouteOption({
          id: "inspect-health",
          label: "Inspect health",
          category: "diagnostics",
          route: errorRoutes.diagnostics,
          enabled: true,
          reason: "health diagnostics are available for the current lifecycle decision"
        })
      : null,
    errorRoutes.retry.enabled
      ? buildReviewRouteOption({
          id: "retry-after-backoff",
          label: "Retry after backoff",
          category: "recovery",
          route: errorRoutes.retry,
          enabled: errorRoutes.retry.enabled,
          reason: `retry is available after ${errorRoutes.retry.after}`
        })
      : null,
    errorRoutes.override.enabled
      ? buildReviewRouteOption({
          id: "operator-health-override",
          label: "Operator override",
          category: "override",
          route: errorRoutes.override,
          enabled: errorRoutes.override.enabled,
          reason: "terminal or circuit-open health state requires operator review"
        })
      : null,
    clientWorkflowHandoff.confirmation.href !== null
      ? buildReviewRouteOption({
          id: "confirm-hosted-handoff",
          label: "Confirm hosted handoff",
          category: "handoff",
          route: clientWorkflowHandoff.confirmation,
          enabled: clientWorkflowHandoff.confirmation.enabled,
          reason: clientWorkflowHandoff.confirmation.reason
        })
      : null
  ].filter(Boolean);
  const selectedRoute =
    state === "needs-handoff-confirmation" && clientWorkflowHandoff.confirmation.href !== null
      ? availableRoutes.find((route) => route.id === "confirm-hosted-handoff")
      : state === "needs-resync"
        ? availableRoutes.find((route) => route.id === "resync-provider-cursor")
        : state === "needs-health-review"
          ? availableRoutes.find((route) => route.id === "inspect-health")
          : availableRoutes[0];
  const requiredDecisions = [
    acceptance.accepted
      ? {
          id: "accept-proof",
          label: "Accept lifecycle proof",
          required: true,
          satisfied: transition.accepted,
          reason: transition.accepted
            ? "proof, readiness, and transition are aligned"
            : "transition is not commit-ready"
        }
      : null,
    clientWorkflowHandoff.visible
      ? {
          id: "hosted-handoff",
          label: "Confirm hosted handoff",
          required: clientWorkflowHandoff.requiresClientAck,
          satisfied: clientWorkflowHandoff.confirmation.enabled || clientWorkflowHandoff.state === "not-required",
          reason: clientWorkflowHandoff.confirmation.reason
        }
      : null,
    readiness.requiresResync
      ? {
          id: "resync-before-mutation",
          label: "Resync before mutation",
          required: true,
          satisfied: false,
          reason: "cursor or persisted state is not restart-safe for mutation"
        }
      : null,
    nextStep.body.health.degradedMode
      ? {
          id: "health-review",
          label: "Review operational health",
          required: true,
          satisfied: false,
          reason:
            nextStep.body.health.actionableErrors[0]?.remediation ??
            "health state must be reviewed before lifecycle mutation"
        }
      : null
  ].filter(Boolean);
  const submission = buildReviewSubmissionContract({
    state,
    selectedRoute,
    requiredDecisions,
    readiness,
    acceptance,
    validationSummary,
    nextStep,
    clientRequest,
    tenantBoundary,
    proof,
    transition
  });
  return {
    schemaVersion: "lease-manager.review-gate.v1",
    state,
    title:
      state === "approved"
        ? `${preview.primaryAction} can be submitted`
        : state === "preview"
          ? "Preview does not mutate lease state"
          : state === "needs-resync"
            ? "Resync is required before continuing"
            : state === "needs-health-review"
              ? "Health review is required before continuing"
              : state === "needs-handoff-confirmation"
                ? "Hosted handoff confirmation is required"
                : `${preview.primaryAction} cannot be submitted`,
    decisionRequired: requiredDecisions.some((decision) => decision.required && !decision.satisfied),
    requiredDecisions,
    selectedRoute,
    submission,
    availableRoutes,
    reviewItems: [
      {
        id: "lease",
        label: "Lease",
        severity: preview.severity,
        text: `${preview.leaseId} is ${readiness.state} with ${preview.remainingMs}ms remaining`
      },
      {
        id: "validation",
        label: "Validation",
        severity: validationSummary.ok ? "info" : "danger",
        text: `${validationSummary.passedCount} checks passed, ${validationSummary.failedCount} failed`,
        failedChecks: failedChecks.map((check) => check.id)
      },
      {
        id: "acceptance",
        label: "Acceptance",
        severity: acceptance.accepted ? "info" : "warning",
        text: `${acceptance.mode} using proof ${acceptance.proofId}`
      },
      {
        id: "tenant-boundary",
        label: "Tenant boundary",
        severity: tenantBoundary.blockers?.length > 0 ? "danger" : "info",
        text: `${tenantBoundary.auditSubject.tenantId}/${tenantBoundary.auditSubject.workspaceId} requested by ${clientRequest.actor}`
      },
      {
        id: "client-runtime",
        label: "Client runtime",
        severity: readiness.clientRuntimeOwnership.accepted ? "info" : "danger",
        text: readiness.clientRuntimeOwnership.required
          ? readiness.clientRuntimeOwnership.handoffHint
          : "runtime fence is not required for this action",
        workerId: readiness.clientRuntimeOwnership.workerId,
        blockers: readiness.clientRuntimeOwnership.blockers
      }
    ],
    proof: {
      proofId: proof.actionId,
      generatedAt: proof.generatedAt,
      idempotencyKey: acceptance.idempotencyKey,
      auditSubject: tenantBoundary.auditSubject,
      transitionMode: transition.mode,
      transitionAccepted: transition.accepted,
      restartSafe: acceptance.restartSafe,
      replay: nextStep.body.idempotencyReplay,
      blockers: validationSummary.blockingReasons.slice(0, 6)
    }
  };
}

function buildClientWorkflowSummary({
  preview,
  readiness,
  acceptance,
  validationSummary,
  nextStep,
  transition,
  handoff,
  clientWorkflowHandoff,
  schedulerControls,
  errorRoutes,
  clientRequest,
  proof,
  analyticsReport,
  reviewGate
}) {
  const failedChecks = validationSummary.checks
    .filter((check) => !check.ok)
    .map((check) => ({
      id: check.id,
      label: check.label,
      details: check.details.slice(0, 3)
    }));
  const primaryBlockers = validationSummary.blockingReasons.slice(0, 4);
  const primaryAction = buildWorkflowAction({
    id: "primary-next-step",
    label: preview.primaryAction,
    routeIntent: nextStep.routeIntent,
    method: nextStep.method,
    href: nextStep.href,
    enabled: nextStep.enabled,
    reason:
      nextStep.enabled
        ? `route ${nextStep.routeIntent} is available for ${readiness.state}`
        : primaryBlockers[0] ?? "route is disabled until readiness blockers are resolved",
    body: nextStep.body
  });
  const resyncAction = readiness.requiresResync
    ? buildWorkflowAction({
        id: "resync-provider-cursor",
        label: "Resync provider",
        routeIntent: "resync-provider-cursor",
        method: "POST",
        href: nextStep.href.replace(/\/[^/]+$/, "/resync-provider-cursor"),
        enabled: true,
        reason: "provider cursor or persisted state must be reconciled before mutation",
        body: {
          leaseId: nextStep.body.leaseId,
          providerId: nextStep.body.providerId,
          cursor: nextStep.body.cursor,
          sequence: nextStep.body.sequence,
          syncConsistency: nextStep.body.syncConsistency,
          syncScope: nextStep.body.syncScope,
          requestId: nextStep.body.requestId,
          idempotencyKey: nextStep.body.idempotencyKey,
          replay: nextStep.body.idempotencyReplay
        }
      })
    : null;
  const retryAction = schedulerControls.state === "backoff" && schedulerControls.pausedUntil
    ? buildWorkflowAction({
        id: "retry-after-backoff",
        label: "Retry after backoff",
        routeIntent: "retry-lease-action",
        method: "POST",
        href: nextStep.href.replace(/\/[^/]+$/, "/retry-lease-action"),
        enabled: false,
        reason: `retry is paused until ${schedulerControls.pausedUntil}`,
        body: {
          leaseId: nextStep.body.leaseId,
          action: nextStep.body.action,
          requestId: nextStep.body.requestId,
          retryAfter: schedulerControls.pausedUntil
        }
      })
    : null;
  const handoffAction = handoff.state === "pending"
    ? buildWorkflowAction({
        id: "acknowledge-hosted-handoff",
        label: "Acknowledge handoff",
        routeIntent: "acknowledge-hosted-handoff",
        method: "POST",
        href: `/api/aios/scheduler/leases/${encodeURIComponent(nextStep.body.leaseId)}/handoff/${encodeURIComponent(handoff.handoffId)}/ack`,
        enabled: clientRequest.workflow.acceptsExternalHandoff,
        reason: handoff.acknowledgement.blockers[0],
        body: {
          handoffId: handoff.handoffId,
          providerId: nextStep.body.providerId,
          leaseId: nextStep.body.leaseId,
          action: nextStep.body.action,
          cursor: nextStep.body.cursor,
          sequence: nextStep.body.sequence,
          requestId: nextStep.body.requestId
        }
      })
    : null;
  const confirmationAction = clientWorkflowHandoff.visible
    ? buildWorkflowAction({
        id: "confirm-hosted-handoff",
        label: "Confirm handoff",
        routeIntent: "confirm-hosted-handoff",
        method: clientWorkflowHandoff.confirmation.method,
        href: clientWorkflowHandoff.confirmation.href,
        enabled: clientWorkflowHandoff.confirmation.enabled,
        reason: clientWorkflowHandoff.confirmation.reason,
        body: clientWorkflowHandoff.confirmation.body
      })
    : null;
  return {
    viewModelVersion: "lease-manager.workflow.v1",
    requestId: clientRequest.requestId,
    generatedAt: proof.generatedAt,
    banner: {
      headline: preview.headline,
      severity: preview.severity,
      statusText: preview.statusText,
      workflowHint: preview.workflowHint,
      primaryAction: preview.primaryAction
    },
    validation: {
      ok: validationSummary.ok,
      passedCount: validationSummary.passedCount,
      failedCount: validationSummary.failedCount,
      primaryBlockers,
      failedChecks
    },
    acceptance: {
      accepted: acceptance.accepted,
      mode: acceptance.mode,
      proofId: acceptance.proofId,
      blockedBy: acceptance.blockedBy,
      restartSafe: acceptance.restartSafe,
      duplicateCommand: acceptance.duplicateCommand,
      ownershipSafe: acceptance.ownershipSafe,
      ownerRecoveryHint: acceptance.ownerRecoveryHint
    },
    persistence: {
      phase: nextStep.body.persistedPhase,
      generation: nextStep.body.persistedGeneration,
      restartSafe: acceptance.restartSafe,
      replay: nextStep.body.idempotencyReplay,
      pendingCommand: nextStep.body.pendingCommand,
      nextCheckpoint: nextStep.body.nextCheckpoint
    },
    readiness: {
      state: readiness.state,
      canMutate: readiness.canMutate,
      canPreview: readiness.canPreview,
      requiresResync: readiness.requiresResync,
      requiresHandoff: readiness.requiresHandoff,
      retryAfter: readiness.retryAfter,
      schedulerState: readiness.schedulerState,
      schedulerNextRunAt: readiness.schedulerNextRunAt,
      ownershipSafe: readiness.ownershipSafe,
      ownerStale: readiness.ownerStale,
      ownerRecoveryHint: readiness.ownerRecoveryHint,
      clientRuntimeOwnership: readiness.clientRuntimeOwnership
    },
    actions: [primaryAction, resyncAction, retryAction, handoffAction, confirmationAction].filter(Boolean),
    reviewGate,
    reviewSubmission: reviewGate.submission,
    operationalErrors: {
      state: nextStep.body.health.state,
      failureState: nextStep.body.health.failureState,
      diagnosticsEnabled: errorRoutes.diagnostics.enabled,
      retryEnabled: errorRoutes.retry.enabled,
      overrideEnabled: errorRoutes.override.enabled,
      primaryDiagnosticKey: nextStep.body.health.failurePolicy.primaryDiagnosticKey,
      actionableErrors: nextStep.body.health.actionableErrors
    },
    handoffReceipt: clientWorkflowHandoff,
    audit: {
      proofId: proof.actionId,
      transitionMode: transition.mode,
      transitionAccepted: transition.accepted,
      idempotencyKey: acceptance.idempotencyKey,
      restartSafe: acceptance.restartSafe,
      replay: nextStep.body.idempotencyReplay,
      auditEventTypes: transition.auditEvents.map((event) => event.type)
    },
    analytics: {
      schemaVersion: analyticsReport.schemaVersion,
      reportId: analyticsReport.reportId,
      generatedAt: analyticsReport.generatedAt,
      window: analyticsReport.window,
      counters: analyticsReport.counters,
      latestSeverity: analyticsReport.timeline.at(-1)?.severity ?? "info",
      latestEvent: analyticsReport.timeline.at(-1) ?? null,
      timelineTail: analyticsReport.timeline.slice(-5),
      reportingState: {
        exportReady: analyticsReport.exportSummary.rowCount > 0,
        rowCount: analyticsReport.exportSummary.rowCount,
        formats: analyticsReport.exportSummary.formats,
        partitionKeys: analyticsReport.exportSummary.partitionKeys,
        latestRecoveryMode: analyticsReport.window.summary.latestRecoveryMode,
        latestBlockedReasonCount: analyticsReport.window.summary.latestBlockedReasonCount
      },
      exportSummary: analyticsReport.exportSummary
    }
  };
}

function buildProjectedLeaseState({ lease, nextAction, settings, nowMs, provider, sync, tenantBoundary }) {
  const issuedAt = new Date(nowMs).toISOString();
  const renewedExpiresAt = new Date(nowMs + settings.maxLeaseMs).toISOString();
  const base = {
    leaseId: lease.leaseId,
    holder: lease.holder,
    tenantId: tenantBoundary.tenantId ?? lease.tenantId,
    workspaceId: tenantBoundary.workspaceId ?? lease.workspaceId,
    providerId: provider.id,
    cursor: sync.cursor,
    sequence: sync.sequence,
    owner: {
      holder: lease.owner.holder,
      expectedHolder: lease.owner.expectedHolder,
      fencingToken: lease.owner.fencingToken,
      generation: lease.owner.generation,
      heartbeatAt: lease.owner.heartbeatAt,
      stale: lease.owner.stale
    }
  };
  if (nextAction.type === "renew-lease" || nextAction.type === "reacquire-lease") {
    const nextHolder = nextAction.type === "reacquire-lease" ? provider.id : lease.owner.holder;
    const nextGeneration = sync.sequence + 1;
    return {
      ...base,
      status: "active",
      holder: nextHolder,
      issuedAt,
      expiresAt: renewedExpiresAt,
      remainingMs: settings.maxLeaseMs,
      generation: nextGeneration,
      owner: {
        holder: nextHolder,
        expectedHolder: nextHolder,
        fencingToken: lease.owner.fencingToken ?? `${provider.id}:${lease.leaseId}:${nextGeneration}`,
        generation: nextGeneration,
        heartbeatAt: issuedAt,
        stale: false
      }
    };
  }
  if (nextAction.type === "release-lease") {
    return {
      ...base,
      status: "released",
      issuedAt: lease.issuedAt,
      expiresAt: issuedAt,
      remainingMs: 0,
      generation: sync.sequence + 1
    };
  }
  if (nextAction.type === "quarantine-lease") {
    return {
      ...base,
      status: "quarantined",
      issuedAt: lease.issuedAt,
      expiresAt: lease.expiresAt,
      remainingMs: lease.remainingMs,
      generation: sync.sequence + 1,
      quarantineReason: nextAction.reason
    };
  }
  if (nextAction.type === "disable-manager") {
    return { ...base, status: "disabled", issuedAt: lease.issuedAt, expiresAt: lease.expiresAt, remainingMs: lease.remainingMs, generation: sync.sequence };
  }
  return { ...base, status: lease.status, issuedAt: lease.issuedAt, expiresAt: lease.expiresAt, remainingMs: lease.remainingMs, generation: sync.sequence };
}

function buildLeaseOperationPlan({
  now,
  lease,
  provider,
  sync,
  nextAction,
  resultingLease,
  readiness,
  persistedState
}) {
  const leaseMutation = ["renew-lease", "reacquire-lease", "release-lease", "quarantine-lease"].includes(nextAction.type);
  const operationId = `${persistedState.idempotencyKey}:lease-op`;
  const currentOwner = {
    leaseId: lease.leaseId,
    holder: lease.owner.holder,
    expectedHolder: lease.owner.expectedHolder,
    fencingToken: lease.owner.fencingToken,
    generation: lease.owner.generation,
    heartbeatAt: lease.owner.heartbeatAt,
    stale: lease.owner.stale,
    staleReasons: lease.owner.staleReasons
  };
  const nextOwner = resultingLease.owner
    ? {
        holder: resultingLease.owner.holder,
        expectedHolder: resultingLease.owner.expectedHolder,
        fencingToken: resultingLease.owner.fencingToken,
        generation: resultingLease.owner.generation,
        heartbeatAt: resultingLease.owner.heartbeatAt,
        stale: resultingLease.owner.stale === true
      }
    : null;
  const compareAndSwap = {
    leaseId: lease.leaseId,
    cursor: sync.cursor,
    expectedSequence: sync.sequence,
    expectedStatus: lease.status,
    expectedHolder: lease.owner.holder,
    expectedOwnerGeneration: lease.owner.generation,
    expectedFencingToken: lease.owner.fencingToken,
    rejectIfOwnerStale: nextAction.type !== "reacquire-lease",
    allowStaleRecovery: nextAction.type === "reacquire-lease" && readiness.ownerRecovery?.allowed === true,
    recoveryToken: readiness.ownerRecovery?.recoveryToken ?? null
  };
  const renewal = ["renew-lease", "reacquire-lease"].includes(nextAction.type)
    ? {
        renewedAt: now,
        previousExpiresAt: lease.expiresAt,
        nextExpiresAt: resultingLease.expiresAt,
        previousRemainingMs: lease.remainingMs,
        nextRemainingMs: resultingLease.remainingMs,
        successorHolder: resultingLease.owner?.holder ?? provider.id,
        successorGeneration: resultingLease.generation,
        heartbeatAt: resultingLease.owner?.heartbeatAt ?? now,
        reason:
          nextAction.type === "reacquire-lease"
            ? readiness.ownerRecovery?.mode ?? "stale-owner-recovery"
            : "scheduled-renewal"
      }
    : null;
  const release = nextAction.type === "release-lease"
    ? {
        releasedAt: now,
        releasedBy: provider.id,
        finalStatus: resultingLease.status,
        previousExpiresAt: lease.expiresAt,
        expectedFence: lease.owner.fencingToken
      }
    : null;
  const recovery = readiness.ownerRecovery?.required
    ? {
        required: readiness.ownerRecovery.required,
        allowed: readiness.ownerRecovery.allowed,
        mode: readiness.ownerRecovery.mode,
        token: readiness.ownerRecovery.recoveryToken,
        previousOwner: readiness.ownerRecovery.previousOwner,
        successorHolder: readiness.ownerRecovery.successorHolder,
        successorGeneration: readiness.ownerRecovery.preconditions?.successorGeneration ?? resultingLease.generation,
        blockers: readiness.ownerRecovery.blockers
      }
    : {
        required: false,
        allowed: true,
        mode: "not-required",
        token: readiness.ownerRecovery?.recoveryToken ?? null,
        blockers: []
      };
  return {
    schemaVersion: "lease-operation-plan.v1",
    operationId,
    action: nextAction.type,
    mutation: leaseMutation,
    providerId: provider.id,
    currentOwner,
    nextOwner,
    compareAndSwap,
    renewal,
    release,
    recovery,
    journal: {
      idempotencyKey: persistedState.idempotencyKey,
      cursor: sync.cursor,
      sequence: sync.sequence,
      resultingGeneration: resultingLease.generation,
      replayAction: persistedState.replay.action,
      restartSafe: persistedState.recovery.restartSafe
    }
  };
}

function buildLifecycleTransition({
  now,
  nowMs,
  settings,
  commandState,
  lease,
  provider,
  sync,
  nextAction,
  readiness,
  acceptance,
  handoff,
  clientWorkflowHandoff,
  persistedState,
  tenantBoundary,
  clientRequest
}) {
  const mutationAction = !["reject", "sleep"].includes(nextAction.type);
  const hostedMutation =
    mutationAction &&
    provider.serviceContract.protocol === "hosted-kernel.v1" &&
    !["disable-manager", "enable-manager"].includes(nextAction.type);
  const executionMode = handoff.execution?.mode ?? (hostedMutation ? "external-handoff" : "local-state");
  const hostedDirectCall = hostedMutation && executionMode === "provider-call";
  const hostedExternalHandoff = hostedMutation && executionMode === "external-handoff";
  const mode = !mutationAction
    ? "noop"
    : !readiness.canMutate
      ? "blocked"
      : hostedDirectCall
        ? "hosted-call"
        : hostedExternalHandoff
        ? "hosted-handoff"
        : "local-state";
  const resultingLease = buildProjectedLeaseState({
    lease,
    nextAction,
    settings,
    nowMs,
    provider,
    sync,
    tenantBoundary
  });
  const operationPlan = buildLeaseOperationPlan({
    now,
    lease,
    provider,
    sync,
    nextAction,
    resultingLease,
    readiness,
    persistedState
  });
  const commitAllowed =
    mode === "local-state" ||
    mode === "hosted-call" ||
    (mode === "hosted-handoff" && handoff.state === "ready");
  const commit = commitAllowed
    ? {
        idempotencyKey: persistedState.idempotencyKey,
        action: nextAction.type,
        command: commandState.command,
        target: mode === "hosted-handoff" || mode === "hosted-call" ? "provider" : "scheduler",
        providerId: provider.id,
        providerExecution: {
          mode: executionMode,
          target: handoff.execution?.target ?? provider.endpoint,
          syncMetadata: handoff.syncMetadata ?? null,
          service: {
            protocol: provider.serviceContract.protocol,
            apiVersion: provider.serviceContract.apiVersion,
            namespace: provider.serviceContract.namespace,
            mode: provider.serviceContract.mode
          }
        },
        leaseId: lease.leaseId,
        cursor: sync.cursor,
        expectedSequence: sync.sequence,
        nextSequence: resultingLease.generation,
        operationPlan,
        preconditions: {
          operationId: operationPlan.operationId,
          expectedHolder: lease.owner.expectedHolder,
          observedHolder: lease.owner.holder,
          fencingToken: lease.owner.fencingToken,
          ownerGeneration: lease.owner.generation,
          ownerHeartbeatAt: lease.owner.heartbeatAt,
          ownerStale: lease.owner.stale,
          allowStaleRecovery: nextAction.type === "reacquire-lease" && lease.owner.stale,
          compareAndSwap: operationPlan.compareAndSwap,
          recovery: readiness.ownerRecovery,
          ownerClaim: readiness.ownerClaim
        },
        requiresAck: handoff.ackRequired,
        handoffId: handoff.handoffId,
        clientHandoffState: clientWorkflowHandoff.state,
        clientConfirmationHref: clientWorkflowHandoff.confirmation.href,
        persistence: {
          key: persistedState.key,
          phase: persistedState.phase,
          checkpointAt: now,
          generation: resultingLease.generation,
          idempotencyKey: persistedState.idempotencyKey,
          replay: persistedState.replay,
          appendCommand: {
            idempotencyKey: persistedState.idempotencyKey,
            command: commandState.command,
            action: nextAction.type,
            state:
              mode === "hosted-handoff"
                ? "handoff-pending"
                : mode === "hosted-call"
                  ? "in-flight"
                  : "committed",
            leaseId: lease.leaseId,
            providerId: provider.id,
            cursor: sync.cursor,
            sequence: sync.sequence,
            generation: resultingLease.generation,
            handoffId: handoff.handoffId,
            proofId: acceptance.proofId,
            owner: {
              holder: lease.owner.holder,
              expectedHolder: lease.owner.expectedHolder,
              fencingToken: lease.owner.fencingToken,
              generation: lease.owner.generation,
              stale: lease.owner.stale,
              recoveryToken: readiness.ownerRecovery.recoveryToken,
              recoveryMode: readiness.ownerRecovery.mode
            },
            operation: {
              operationId: operationPlan.operationId,
              schemaVersion: operationPlan.schemaVersion,
              currentOwner: operationPlan.currentOwner,
              nextOwner: operationPlan.nextOwner,
              compareAndSwap: operationPlan.compareAndSwap,
              recovery: operationPlan.recovery
            },
            observedAt: now
          }
        },
        writeSet: {
          lease: resultingLease,
          manager: {
            enabled:
              nextAction.type === "disable-manager"
                ? false
                : nextAction.type === "enable-manager"
                  ? true
                  : settings.enabled
          }
        }
      }
    : null;
  const auditBase = {
    surfaceId,
    requestId: clientRequest.requestId,
    actor: clientRequest.actor,
    tenantId: tenantBoundary.auditSubject.tenantId,
    workspaceId: tenantBoundary.auditSubject.workspaceId,
    leaseId: lease.leaseId,
    providerId: provider.id,
    cursor: sync.cursor,
    sequence: sync.sequence,
    at: now
  };
  return {
    mode,
    accepted: acceptance.accepted && commitAllowed,
    commit,
    operationPlan,
    resultingLease,
    auditEvents: [
      {
        ...auditBase,
        type: "lease.lifecycle.evaluated",
        action: nextAction.type,
        decision: readiness.state,
        idempotencyKey: persistedState.idempotencyKey
      },
      commitAllowed
        ? {
            ...auditBase,
            type:
              mode === "hosted-handoff"
                ? "lease.lifecycle.handoff-queued"
                : mode === "hosted-call"
                  ? "lease.lifecycle.provider-call-ready"
                  : "lease.lifecycle.commit-ready",
            action: nextAction.type,
            handoffId: handoff.handoffId,
            providerExecutionMode: executionMode,
            clientHandoffState: clientWorkflowHandoff.state,
            confirmationHref: clientWorkflowHandoff.confirmation.href,
            nextSequence: resultingLease.generation,
            replayAction: persistedState.replay.action,
            restartSafe: persistedState.recovery.restartSafe,
            ownershipRecovery: readiness.ownerRecovery
          }
        : {
            ...auditBase,
            type: "lease.lifecycle.blocked",
            action: nextAction.type,
            reasons: acceptance.blockingReasons
          }
    ],
    blockedReasons: commitAllowed ? [] : acceptance.blockingReasons
  };
}

export function describeLeaseManagerSurface(input = {}) {
  const nowMs = parseTimestamp(input.now, Date.now());
  const now = new Date(nowMs).toISOString();
  const settingsValidation = validateLeaseManagerSettings(input.settings);
  const settings = settingsValidation.settings;
  const lease = normalizeLeaseState(input.lease, nowMs, settings);
  const commandState = resolveLifecycleCommand(input.command, settings.enabled);
  const nextAction = resolveNextAction(commandState, lease, settings, settingsValidation, nowMs);
  const provider = normalizeProvider(input.provider);
  const sync = normalizeSyncState(input.sync, nowMs, { lease, provider });
  const ownershipGuard = buildOwnershipGuard({ lease, provider, nextAction, sync });
  const providerNegotiation = negotiateProviderCapabilities(provider, nextAction, sync);
  const clientRequest = normalizeClientRequestContext(input, {
    commandState,
    lease,
    provider,
    sync,
    now
  });
  const tenantBoundary = normalizeTenantBoundary(input, {
    lease,
    provider,
    clientRequest,
    commandState,
    nextAction,
    sync
  });
  const operationalHealth = normalizeOperationalHealth(input.health, {
    nowMs,
    settings,
    provider
  });
  const persistedState = normalizePersistedSnapshot(input.persistedState, {
    lease,
    sync,
    provider,
    commandState,
    nextAction,
    tenantBoundary,
    nowMs
  });
  const schedulerControls = buildSchedulerControls({
    now,
    nowMs,
    settings,
    settingsValidation,
    commandState,
    nextAction,
    ownershipGuard,
    operationalHealth,
    sync,
    persistedState,
    clientRequest
  });
  const handoff = buildExternalHandoff({
    provider,
    negotiation: providerNegotiation,
    sync,
    lease,
    nextAction,
    clientRequest,
    tenantBoundary,
    now,
    handoffInput: input.handoff ?? input.handoffAck
  });
  const proof = buildLifecycleProof({
    now,
    commandState,
    lease,
    settingsValidation,
    nextAction,
    ownershipGuard,
    providerNegotiation,
    tenantBoundary,
    operationalHealth,
    schedulerControls,
    sync,
    persistedState,
    handoff,
    clientRequest,
    evidence: input.evidence
  });
  const validationSummary = summarizeValidation({
    settingsValidation,
    commandState,
    ownershipGuard,
    providerNegotiation,
    tenantBoundary,
    operationalHealth,
    schedulerControls,
    sync,
    persistedState,
    handoff
  });
  const readiness = buildReadiness({
    proof,
    sync,
    persistedState,
    handoff,
    validationSummary,
    nextAction,
    ownershipGuard,
    operationalHealth,
    schedulerControls,
    clientRequest,
    tenantBoundary
  });
  const preview = buildActionPreview({
    lease,
    nextAction,
    schedulerControls,
    persistedState,
    handoff,
    validationSummary,
    readiness,
    clientRequest,
    tenantBoundary
  });
  const acceptance = buildAcceptance({
    proof,
    readiness,
    validationSummary,
    persistedState
  });
  const nextStep = buildNextStepContract({
    commandState,
    lease,
    provider,
    sync,
    persistedState,
    handoff,
    nextAction,
    readiness,
    acceptance,
    validationSummary,
    schedulerControls,
    operationalHealth,
    clientRequest,
    tenantBoundary
  });
  const errorRoutes = buildErrorRouteContracts({
    lease,
    provider,
    sync,
    commandState,
    nextAction,
    operationalHealth,
    schedulerControls,
    clientRequest,
    tenantBoundary,
    persistedState
  });
  const clientWorkflowHandoff = buildClientWorkflowHandoff({
    handoff,
    nextStep,
    readiness,
    acceptance,
    validationSummary,
    clientRequest,
    tenantBoundary
  });
  const transition = buildLifecycleTransition({
    now,
    nowMs,
    settings,
    commandState,
    lease,
    provider,
    sync,
    nextAction,
    readiness,
    acceptance,
    handoff,
    clientWorkflowHandoff,
    persistedState,
    tenantBoundary,
    clientRequest
  });
  const reviewGate = buildReviewGate({
    preview,
    readiness,
    acceptance,
    validationSummary,
    nextStep,
    errorRoutes,
    clientWorkflowHandoff,
    transition,
    clientRequest,
    tenantBoundary,
    proof
  });
  const analyticsReport = buildAnalyticsReport({
    input,
    now,
    nowMs,
    lease,
    provider,
    sync,
    nextAction,
    readiness,
    acceptance,
    transition,
    handoff,
    operationalHealth,
    nextStep,
    tenantBoundary,
    persistedState,
    proof,
    schedulerControls
  });
  const workflowSummary = buildClientWorkflowSummary({
    preview,
    readiness,
    acceptance,
    validationSummary,
    nextStep,
    transition,
    handoff,
    clientWorkflowHandoff,
    schedulerControls,
    errorRoutes,
    clientRequest,
    proof,
    analyticsReport,
    reviewGate
  });

  return {
    ok: proof.accepted,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: "ai-os-wave1-hosted-kernel-boot-proof",
    contract: leaseManagerContract,
    settings,
    settingsErrors: settingsValidation.errors,
    validationSummary,
    command: commandState,
    lease,
    ownership: ownershipGuard,
    provider: {
      ...provider,
      negotiation: providerNegotiation
    },
    health: operationalHealth,
    errorRoutes,
    sync,
    clientRequest,
    tenantBoundary,
    persistedState,
    handoff,
    clientWorkflowHandoff,
    scheduler: {
      enabled: settings.enabled,
      intervalMs: settings.schedulerIntervalMs,
      nextAction,
      controls: schedulerControls
    },
    readiness,
    acceptance,
    transition,
    preview,
    nextStep,
    reviewGate,
    analytics: analyticsReport,
    workflowSummary,
    proof
  };
}

export default describeLeaseManagerSurface;
