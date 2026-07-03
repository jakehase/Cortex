export const surfaceId = "aios_kernel-lifecycle_state-transition_002";
export const surfaceGroup = "kernel-lifecycle";
export const surfaceName = "state-transition";

const HOSTED_KERNEL_STATES = new Set([
  "cold",
  "booting",
  "ready",
  "pausing",
  "paused",
  "resuming",
  "stopping",
  "stopped",
  "failed"
]);

const TERMINAL_STATES = new Set(["ready", "paused", "stopped", "failed"]);

const RESTART_SAFE_STATES = new Set(["cold", ...TERMINAL_STATES]);

const TRANSITIONS = new Map([
  ["boot", { from: ["cold", "stopped", "failed"], to: "booting", terminal: "ready" }],
  ["pause", { from: ["ready"], to: "pausing", terminal: "paused" }],
  ["resume", { from: ["paused"], to: "resuming", terminal: "ready" }],
  ["stop", { from: ["booting", "ready", "pausing", "paused", "resuming", "failed"], to: "stopping", terminal: "stopped" }],
  ["fail", { from: ["booting", "pausing", "resuming", "stopping", "ready", "paused"], to: "failed", terminal: "failed" }]
]);

const RESTART_RECOVERY = new Map([
  ["booting", "cold"],
  ["pausing", "ready"],
  ["resuming", "paused"],
  ["stopping", "stopped"]
]);

const RESTART_RECOVERY_REASONS = new Map([
  ["booting", "Hosted-kernel boot did not reach a provider-confirmed ready state before restart."],
  ["pausing", "Hosted-kernel pause was interrupted; recover to the last stable ready state."],
  ["resuming", "Hosted-kernel resume was interrupted; recover to the last stable paused state."],
  ["stopping", "Hosted-kernel stop was interrupted; preserve stopped state after restart."]
]);

const ROLE_PERMISSIONS = new Map([
  ["kernel-admin", ["kernel:boot", "kernel:pause", "kernel:resume", "kernel:stop", "kernel:fail", "kernel:status"]],
  ["workspace-owner", ["kernel:boot", "kernel:pause", "kernel:resume", "kernel:stop", "kernel:status"]],
  ["operator", ["kernel:boot", "kernel:pause", "kernel:resume", "kernel:stop", "kernel:status"]],
  ["observer", ["kernel:status"]]
]);

const COMMAND_PERMISSIONS = new Map([
  ["boot", "kernel:boot"],
  ["pause", "kernel:pause"],
  ["resume", "kernel:resume"],
  ["stop", "kernel:stop"],
  ["fail", "kernel:fail"],
  ["status", "kernel:status"]
]);

const DEGRADED_STATES = new Set(["booting", "pausing", "resuming", "stopping"]);

const ANALYTICS_COMMANDS = ["boot", "pause", "resume", "stop", "fail", "status"];

const ANALYTICS_STATES = [...HOSTED_KERNEL_STATES].sort();

const TRANSITION_DURATION_BUCKETS = [
  { bucket: "under-1s", maxMs: 1_000 },
  { bucket: "1s-10s", maxMs: 10_000 },
  { bucket: "10s-60s", maxMs: 60_000 },
  { bucket: "1m-5m", maxMs: 300_000 },
  { bucket: "over-5m", maxMs: Number.POSITIVE_INFINITY }
];

const ACTIONABLE_ERRORS = new Map([
  ["command-rejected-disabled", {
    code: "KERNEL_LIFECYCLE_DISABLED",
    severity: "blocked",
    retryable: false,
    action: "Enable hosted-kernel lifecycle controls before issuing state-changing commands."
  }],
  ["command-rejected-maintenance", {
    code: "KERNEL_MAINTENANCE_MODE",
    severity: "blocked",
    retryable: false,
    action: "Exit hosted-kernel maintenance mode or use an emergency stop/fail command."
  }],
  ["command-rejected-settings", {
    code: "KERNEL_SETTINGS_COMMAND_BLOCKED",
    severity: "blocked",
    retryable: false,
    action: "Update lifecycle settings so this command is allowed for the hosted-kernel scope."
  }],
  ["command-rejected-schedule", {
    code: "KERNEL_SCHEDULE_WINDOW_CLOSED",
    severity: "degraded",
    retryable: true,
    action: "Retry the lifecycle command during an active hosted-kernel schedule window."
  }],
  ["command-rejected-reason", {
    code: "KERNEL_COMMAND_REASON_REQUIRED",
    severity: "blocked",
    retryable: false,
    action: "Provide a command reason required by hosted-kernel lifecycle settings."
  }],
  ["command-rejected-scope", {
    code: "KERNEL_SCOPE_MISMATCH",
    severity: "blocked",
    retryable: false,
    action: "Retry against the tenantId/workspaceId owned by the persisted hosted-kernel state."
  }],
  ["command-rejected-permission", {
    code: "KERNEL_PERMISSION_DENIED",
    severity: "blocked",
    retryable: false,
    action: "Grant the actor the required kernel permission before retrying the lifecycle command."
  }],
  ["command-rejected-actor-scope", {
    code: "KERNEL_ACTOR_SCOPE_DENIED",
    severity: "blocked",
    retryable: false,
    action: "Bind the actor to the requested tenant/workspace scope before retrying the lifecycle command."
  }],
  ["command-rejected-unscoped-actor", {
    code: "KERNEL_ACTOR_SCOPE_REQUIRED",
    severity: "blocked",
    retryable: false,
    action: "Bind state-changing hosted-kernel commands to an actor tenant and workspace scope before retrying."
  }],
  ["command-rejected-explicit-scope-required", {
    code: "KERNEL_EXPLICIT_SCOPE_REQUIRED",
    severity: "blocked",
    retryable: false,
    action: "Provide an explicit tenantId and workspaceId for state-changing hosted-kernel commands."
  }],
  ["command-rejected-unknown", {
    code: "KERNEL_UNKNOWN_COMMAND",
    severity: "blocked",
    retryable: false,
    action: "Use one of the supported hosted-kernel lifecycle commands: boot, pause, resume, stop, fail, status."
  }],
  ["command-rejected-state", {
    code: "KERNEL_INVALID_STATE_TRANSITION",
    severity: "degraded",
    retryable: true,
    action: "Refresh hosted-kernel state and retry once the lifecycle state allows this command."
  }],
  ["command-rejected-provider-capability", {
    code: "KERNEL_PROVIDER_CAPABILITY_MISSING",
    severity: "blocked",
    retryable: false,
    action: "Register a hosted-kernel provider contract with the lifecycle and state-sync capabilities required by this command."
  }],
  ["command-rejected-health-gate", {
    code: "KERNEL_OPERATIONAL_HEALTH_GATE",
    severity: "blocked",
    retryable: true,
    action: "Clear blocking hosted-kernel health errors or issue an emergency status, stop, or fail command."
  }],
  ["command-rejected-recovery-pending", {
    code: "KERNEL_RESTART_RECOVERY_CHECKPOINT_PENDING",
    severity: "blocked",
    retryable: true,
    action: "Persist the hosted-kernel restart recovery checkpoint before issuing another state-changing lifecycle command."
  }],
  ["command-rejected-retry-backoff", {
    code: "KERNEL_RETRY_BACKOFF_ACTIVE",
    severity: "degraded",
    retryable: true,
    action: "Wait until the hosted-kernel retry backoff window opens, or issue status, stop, or fail for emergency handling."
  }],
  ["command-rejected-retry-exhausted", {
    code: "KERNEL_RETRY_BUDGET_EXHAUSTED",
    severity: "blocked",
    retryable: false,
    action: "Review the last hosted-kernel lifecycle error before issuing another non-emergency state-changing command."
  }]
]);

const STATE_CHANGING_COMMANDS = ["boot", "pause", "resume", "stop", "fail"];

const EMERGENCY_COMMANDS = new Set(["status", "stop", "fail"]);

const COMMAND_LEDGER_OUTCOMES = new Set(["accepted", "rejected", "idempotent", "observed"]);

const TRANSITION_RECORD_OUTCOMES = new Set(["accepted", "rejected", "idempotent", "observed", "recovered"]);

const PROVIDER_CAPABILITIES = [
  "kernel.lifecycle.transition",
  "kernel.lifecycle.emergency-handoff",
  "kernel.state.sync.read",
  "kernel.state.sync.write",
  "kernel.compute.hosted-runtime"
];

const COMMAND_PROVIDER_CAPABILITIES = new Map([
  ["boot", ["kernel.lifecycle.transition", "kernel.state.sync.write", "kernel.compute.hosted-runtime"]],
  ["pause", ["kernel.lifecycle.transition", "kernel.state.sync.write"]],
  ["resume", ["kernel.lifecycle.transition", "kernel.state.sync.write", "kernel.compute.hosted-runtime"]],
  ["stop", ["kernel.lifecycle.transition", "kernel.lifecycle.emergency-handoff", "kernel.state.sync.write"]],
  ["fail", ["kernel.lifecycle.transition", "kernel.lifecycle.emergency-handoff", "kernel.state.sync.write"]],
  ["status", ["kernel.state.sync.read"]]
]);

const PROVIDER_HANDOFF_METHODS = new Set(["POST", "PUT"]);

const PROVIDER_DELIVERY_MODES = new Set(["control-plane", "webhook", "queue", "event-stream"]);

const PROVIDER_AUTH_SCHEMES = new Set(["none", "shared-secret", "signed-jwt", "mtls"]);

const CLIENT_ROUTE_HANDOFF_MODES = new Set(["inline", "navigate", "emit-event"]);

const LIFECYCLE_CONTROL_ACTIONS = new Set([
  "enable-lifecycle",
  "disable-lifecycle",
  "enter-maintenance",
  "exit-maintenance",
  "enable-command",
  "disable-command",
  "require-reason",
  "clear-reason",
  "open-schedule-window",
  "close-schedule-window"
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeIdentifier(value, fallback) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function normalizeState(rawState) {
  const state = typeof rawState === "string" ? rawState.trim().toLowerCase() : "";
  return HOSTED_KERNEL_STATES.has(state) ? state : "cold";
}

function normalizeKnownState(rawState) {
  const state = typeof rawState === "string" ? rawState.trim().toLowerCase() : "";
  return HOSTED_KERNEL_STATES.has(state) ? state : null;
}

function normalizeGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizePositiveInteger(value, fallback, max) {
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(value, max);
}

function normalizeHeaderMap(value) {
  const headers = asObject(value);
  const normalized = {};

  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = normalizeIdentifier(rawKey, null);
    const value = normalizeIdentifier(rawValue, null);
    if (key && value) normalized[key.toLowerCase()] = value;
  }

  return normalized;
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .slice(-12)
    .map((entry) => normalizeTransitionRecord(entry));
}

function transitionContractFor(commandName) {
  const command = normalizeCommandSet([commandName], [])[0] || null;
  const transition = command ? TRANSITIONS.get(command) : null;

  return {
    command,
    stateChanging: Boolean(command && STATE_CHANGING_COMMANDS.includes(command)),
    allowedFrom: transition ? [...transition.from] : [],
    targetState: transition?.to || null,
    terminalState: transition?.terminal || null
  };
}

function uniqueNormalizedStates(value) {
  const states = new Set();
  if (!Array.isArray(value)) return [];

  for (const entry of value) {
    const state = normalizeKnownState(entry);
    if (state) states.add(state);
  }

  return [...states].sort();
}

function transitionPhaseForState(state) {
  if (DEGRADED_STATES.has(state)) return "transitioning";
  if (TERMINAL_STATES.has(state)) return "terminal";
  return "initial";
}

function shapeTransitionValidity({ command, from, to, outcome, allowedFrom, targetState, terminalState, completed, replayable }) {
  const baseCommand = typeof command === "string" ? command.split(":")[0] : command;
  const contract = transitionContractFor(baseCommand);
  const stateChanging = contract.stateChanging;
  const terminalReached = terminalState === to;
  const targetReached = targetState === to;
  const fromAllowed = !stateChanging || allowedFrom.includes(from);
  const rejected = outcome === "rejected";
  const recovered = outcome === "recovered";
  const observed = outcome === "observed";
  const reasons = [];

  if (stateChanging && !fromAllowed && !rejected && !observed) reasons.push("from-state-not-allowed");
  if (stateChanging && !targetReached && !terminalReached && !rejected && !observed) reasons.push("target-state-not-in-contract");
  if (completed && !TERMINAL_STATES.has(to) && !rejected) reasons.push("completed-state-not-terminal");
  if (replayable && rejected) reasons.push("rejected-record-not-replayable");
  if (replayable && !completed && !DEGRADED_STATES.has(to)) reasons.push("replayable-record-has-no-terminal-or-in-flight-state");

  return {
    schemaVersion: 1,
    stateChanging,
    fromAllowed,
    targetReached,
    terminalReached,
    completed,
    replayable: replayable && reasons.length === 0 && !rejected,
    phase: transitionPhaseForState(to),
    valid: reasons.length === 0 || rejected || recovered || observed,
    reasons,
    contract: {
      command: contract.command,
      allowedFrom,
      targetState,
      terminalState
    }
  };
}

function normalizeTransitionOutcome(value, fallback = "observed") {
  const outcome = normalizeIdentifier(value, fallback);
  return TRANSITION_RECORD_OUTCOMES.has(outcome) ? outcome : fallback;
}

function normalizeFailureReason(value, audit) {
  if (!value && !audit) return null;

  const reason = asObject(value);
  const catalog = ACTIONABLE_ERRORS.get(audit) || ACTIONABLE_ERRORS.get(reason.audit) || {};
  const code = normalizeIdentifier(reason.code, catalog.code || null);
  const normalizedAudit = normalizeIdentifier(reason.audit, audit || null);
  const message = normalizeIdentifier(reason.message, null);
  const action = normalizeIdentifier(reason.action, catalog.action || null);

  if (!code && !normalizedAudit && !message && !action) return null;

  return {
    code,
    audit: normalizedAudit,
    retryable: typeof reason.retryable === "boolean" ? reason.retryable : catalog.retryable === true,
    message,
    action
  };
}

function normalizeBoundaryAudit(value) {
  const boundary = asObject(value);
  const scope = asObject(boundary.scope);
  const policy = asObject(boundary.policy);
  const isolation = asObject(boundary.isolation);
  const audit = normalizeIdentifier(boundary.audit, null);
  const resolvedTenantId = normalizeIdentifier(scope.resolvedTenantId, null);
  const resolvedWorkspaceId = normalizeIdentifier(scope.resolvedWorkspaceId, null);

  if (!audit && !resolvedTenantId && !resolvedWorkspaceId) return null;

  return {
    schemaVersion: 1,
    accepted: boundary.accepted === true,
    audit: audit || "boundary-observed",
    requiredPermission: normalizeIdentifier(boundary.requiredPermission, null),
    scope: {
      resolvedTenantId,
      resolvedWorkspaceId,
      requestedTenantId: normalizeIdentifier(scope.requestedTenantId, resolvedTenantId),
      requestedWorkspaceId: normalizeIdentifier(scope.requestedWorkspaceId, resolvedWorkspaceId),
      tenantMatched: scope.tenantMatched !== false,
      workspaceMatched: scope.workspaceMatched !== false,
      actorTenantMatched: scope.actorTenantMatched !== false,
      actorWorkspaceMatched: scope.actorWorkspaceMatched !== false,
      actorTenantBound: scope.actorTenantBound === true,
      actorWorkspaceBound: scope.actorWorkspaceBound === true,
      matchedActorScopedTenant: normalizeIdentifier(scope.matchedActorScopedTenant, null)
    },
    policy: {
      accepted: policy.accepted !== false,
      audit: normalizeIdentifier(policy.audit, audit || "boundary-policy-observed"),
      stateChanging: policy.stateChanging === true,
      requiresActorScope: policy.requiresActorScope === true,
      requiresExplicitScope: policy.requiresExplicitScope === true,
      actorTenantScoped: policy.actorTenantScoped !== false,
      actorWorkspaceScoped: policy.actorWorkspaceScoped !== false,
      explicitTenantScoped: policy.explicitTenantScoped !== false,
      explicitWorkspaceScoped: policy.explicitWorkspaceScoped !== false,
      tenantScopeSource: normalizeIdentifier(policy.tenantScopeSource, "unknown"),
      workspaceScopeSource: normalizeIdentifier(policy.workspaceScopeSource, "unknown")
    },
    isolation: {
      tenantIsolated: isolation.tenantIsolated !== false,
      workspaceIsolated: isolation.workspaceIsolated !== false,
      crossTenantBlocked: isolation.crossTenantBlocked === true,
      crossWorkspaceBlocked: isolation.crossWorkspaceBlocked === true
    }
  };
}

function shapeBoundaryAudit(boundary) {
  const normalizedBoundary = asObject(boundary);
  const scope = asObject(normalizedBoundary.scope);
  const policy = asObject(normalizedBoundary.policy);

  return normalizeBoundaryAudit({
    accepted: normalizedBoundary.accepted === true,
    audit: normalizedBoundary.audit,
    requiredPermission: normalizedBoundary.requiredPermission || null,
    scope,
    policy,
    isolation: {
      tenantIsolated: scope.tenantMatched === true && scope.actorTenantMatched === true,
      workspaceIsolated: scope.workspaceMatched === true && scope.actorWorkspaceMatched === true,
      crossTenantBlocked: scope.tenantMatched === false || scope.actorTenantMatched === false,
      crossWorkspaceBlocked: scope.workspaceMatched === false || scope.actorWorkspaceMatched === false
    }
  });
}

function normalizeTransitionRecord(entry) {
  const command = typeof entry.command === "string" ? entry.command : "unknown";
  const baseCommand = command.split(":")[0];
  const contract = transitionContractFor(baseCommand);
  const from = normalizeState(entry.from);
  const to = normalizeState(entry.to);
  const auditHint = typeof entry.audit === "string" && entry.audit.startsWith("command-rejected") ? "rejected" : "observed";
  const outcome = normalizeTransitionOutcome(entry.outcome, auditHint);
  const audit = normalizeIdentifier(entry.audit, outcome === "rejected" ? "command-rejected-unknown" : "history-observed");
  const completed = typeof entry.completed === "boolean" ? entry.completed : TERMINAL_STATES.has(to);
  const restartSafe = typeof entry.restartSafe === "boolean" ? entry.restartSafe : RESTART_SAFE_STATES.has(to);
  const allowedFrom = Array.isArray(entry.allowedFrom)
    ? uniqueNormalizedStates(entry.allowedFrom)
    : contract.allowedFrom;
  const targetState = normalizeState(entry.targetState || contract.targetState || to);
  const terminalState = normalizeState(entry.terminalState || contract.terminalState || to);
  const replayable = typeof entry.replayable === "boolean" ? entry.replayable : outcome !== "rejected";
  const validity = shapeTransitionValidity({
    command,
    from,
    to,
    outcome,
    allowedFrom,
    targetState,
    terminalState,
    completed,
    replayable
  });

  return {
    recordType: normalizeIdentifier(entry.recordType, "kernel.lifecycle.transition-record"),
    commandId: normalizeIdentifier(entry.commandId, "unknown"),
    command,
    from,
    to,
    outcome,
    audit,
    failureReason: normalizeFailureReason(entry.failureReason, outcome === "rejected" ? audit : null),
    boundaryAudit: normalizeBoundaryAudit(entry.boundaryAudit),
    allowedFrom,
    targetState,
    terminalState,
    transition: validity,
    phase: validity.phase,
    generation: normalizeGeneration(entry.generation),
    restartSafe,
    replayable: validity.replayable,
    completed,
    at: typeof entry.at === "string" ? entry.at : null
  };
}

function shapeTransitionRecord({ command, from, to, generation, outcome, audit, at, failureReason = null, replayable = true, boundary = null }) {
  const contract = transitionContractFor(command.name);
  const targetState = contract.targetState || to;
  const terminalState = contract.terminalState || to;
  const completed = TERMINAL_STATES.has(to) || outcome === "rejected";

  return normalizeTransitionRecord({
    recordType: "kernel.lifecycle.transition-record",
    commandId: command.commandId,
    command: command.name,
    from,
    to,
    outcome,
    audit,
    failureReason,
    boundaryAudit: shapeBoundaryAudit(boundary),
    allowedFrom: contract.allowedFrom,
    targetState,
    terminalState,
    generation,
    restartSafe: RESTART_SAFE_STATES.has(to),
    replayable,
    completed,
    at
  });
}

function mergeTransitionHistory(history, record) {
  return normalizeHistory(history).concat(record).slice(-12);
}

function normalizeHealthErrors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .slice(-8)
    .map((entry) => {
      const catalog = ACTIONABLE_ERRORS.get(entry.audit) || {};
      return {
        code: normalizeIdentifier(entry.code, catalog.code || "KERNEL_OPERATIONAL_HEALTH_ERROR"),
        audit: normalizeIdentifier(entry.audit, "external-health-signal"),
        severity: normalizeIdentifier(entry.severity, catalog.severity || "degraded"),
        retryable: typeof entry.retryable === "boolean" ? entry.retryable : catalog.retryable !== false,
        message: normalizeIdentifier(entry.message, "Hosted-kernel lifecycle health signal requires operator attention."),
        action: normalizeIdentifier(entry.action, catalog.action || "Inspect the hosted-kernel lifecycle state before issuing another command."),
        at: typeof entry.at === "string" ? entry.at : null
      };
    });
}

function healthSeverityRank(severity) {
  if (severity === "blocked") return 3;
  if (severity === "failed") return 3;
  if (severity === "degraded") return 2;
  if (severity === "warning") return 1;
  return 0;
}

function summarizeHealthGate(stateContract, command) {
  const persistedErrors = normalizeHealthErrors(stateContract.healthErrors);
  const blockingErrors = persistedErrors.filter((error) => healthSeverityRank(error.severity) >= 3);
  const degradedErrors = persistedErrors.filter((error) => error.severity === "degraded");
  const emergencyAllowed = EMERGENCY_COMMANDS.has(command.name);
  const stateFailed = stateContract.state === "failed";
  const inFlight = DEGRADED_STATES.has(stateContract.state);
  const latestError = [...blockingErrors, ...degradedErrors].sort(
    (left, right) => healthSeverityRank(right.severity) - healthSeverityRank(left.severity)
  )[0] || null;
  const allowedCommands = blockingErrors.length > 0
    ? ["status", "stop", "fail"]
    : inFlight || degradedErrors.length > 0
      ? ["status", "stop", "fail", command.name].filter((entry, index, all) => all.indexOf(entry) === index)
      : ["boot", "pause", "resume", "stop", "fail", "status"];
  const accepted =
    command.name === "status" ||
    emergencyAllowed ||
    blockingErrors.length === 0;

  return {
    accepted,
    audit: accepted ? "health-gate-accepted" : "command-rejected-health-gate",
    emergencyAllowed,
    stateFailed,
    inFlight,
    blockingErrorCount: blockingErrors.length,
    degradedErrorCount: degradedErrors.length,
    latestErrorCode: latestError?.code || null,
    latestErrorAudit: latestError?.audit || null,
    latestErrorAction: latestError?.action || null,
    allowedCommands
  };
}

function normalizeCommandLedger(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry) => entry && typeof entry === "object")
    .slice(-20)
    .map((entry) => {
      const command = normalizeCommandSet([entry.command], ["status"])[0] || "status";
      const outcome = COMMAND_LEDGER_OUTCOMES.has(entry.outcome) ? entry.outcome : "observed";
      const state = normalizeState(entry.state);
      const generation = normalizeGeneration(entry.generation);
      const audit = normalizeIdentifier(entry.audit, outcome === "rejected" ? "command-rejected-unknown" : "command-observed");
      const restartSafe =
        typeof entry.restartSafe === "boolean" ? entry.restartSafe : TERMINAL_STATES.has(state);

      return {
        commandId: normalizeIdentifier(entry.commandId, `${command}:unknown`),
        command,
        outcome,
        audit,
        state,
        generation,
        failureReason: normalizeFailureReason(entry.failureReason, outcome === "rejected" ? audit : null),
        boundaryAudit: normalizeBoundaryAudit(entry.boundaryAudit),
        restartSafe,
        replayable: typeof entry.replayable === "boolean" ? entry.replayable : outcome !== "rejected",
        completed: typeof entry.completed === "boolean" ? entry.completed : TERMINAL_STATES.has(state),
        at: typeof entry.at === "string" ? entry.at : null
      };
    });
}

function findPersistedCommandReplay(commandLedger, command) {
  if (!command.commandId || command.name === "status") return null;
  const matches = commandLedger.filter(
    (entry) => entry.commandId === command.commandId && entry.command === command.name
  );
  return matches[matches.length - 1] || null;
}

function shapeReplayDecision(stateContract, replay) {
  const outcome = normalizeTransitionOutcome(replay.outcome, "observed");
  const state = normalizeState(replay.state);
  const completed = replay.completed === true;
  const boundaryAudit = normalizeBoundaryAudit(replay.boundaryAudit);
  const replayScope = boundaryAudit?.scope || null;
  const inFlightMatch = !completed && state === stateContract.state && DEGRADED_STATES.has(state);
  const terminalMatch = completed && TERMINAL_STATES.has(state);
  const restartSafeMatch = replay.restartSafe === true && RESTART_SAFE_STATES.has(state);
  const stateChanging = STATE_CHANGING_COMMANDS.includes(replay.command);
  const replayTenantMatched = !replayScope || replayScope.resolvedTenantId === stateContract.tenantId;
  const replayWorkspaceMatched = !replayScope || replayScope.resolvedWorkspaceId === stateContract.workspaceId;
  const replayBoundaryAccepted = !boundaryAudit || boundaryAudit.accepted === true;
  const blockers = [];

  if (outcome === "rejected") blockers.push("rejected-ledger-entry");
  if (replay.replayable !== true) blockers.push("ledger-entry-not-replayable");
  if (!terminalMatch && !inFlightMatch && !restartSafeMatch) blockers.push("ledger-state-not-replayable");
  if (state !== stateContract.state) blockers.push("ledger-state-differs-from-current-state");
  if (normalizeGeneration(replay.generation) > stateContract.generation) blockers.push("ledger-generation-ahead-of-current-state");
  if (stateChanging && !boundaryAudit) blockers.push("ledger-boundary-proof-missing");
  if (!replayBoundaryAccepted) blockers.push("ledger-boundary-not-accepted");
  if (!replayTenantMatched) blockers.push("ledger-tenant-scope-differs-from-current-state");
  if (!replayWorkspaceMatched) blockers.push("ledger-workspace-scope-differs-from-current-state");

  return {
    schemaVersion: 1,
    accepted: blockers.length === 0,
    audit: blockers.length === 0 ? "ledger-replay-accepted" : "ledger-replay-rejected",
    blockers,
    outcome,
    state,
    currentState: stateContract.state,
    generation: normalizeGeneration(replay.generation),
    currentGeneration: stateContract.generation,
    completed,
    terminalMatch,
    inFlightMatch,
    restartSafeMatch,
    boundary: {
      present: Boolean(boundaryAudit),
      accepted: replayBoundaryAccepted,
      audit: boundaryAudit?.audit || null,
      tenantMatched: replayTenantMatched,
      workspaceMatched: replayWorkspaceMatched,
      resolvedTenantId: replayScope?.resolvedTenantId || null,
      resolvedWorkspaceId: replayScope?.resolvedWorkspaceId || null,
      currentTenantId: stateContract.tenantId,
      currentWorkspaceId: stateContract.workspaceId
    }
  };
}

function normalizeRetryPolicy(value) {
  const retryPolicy = asObject(value);
  const maxAttempts = Number.isSafeInteger(retryPolicy.maxAttempts) && retryPolicy.maxAttempts >= 0
    ? Math.min(retryPolicy.maxAttempts, 10)
    : 3;
  const baseDelayMs = Number.isSafeInteger(retryPolicy.baseDelayMs) && retryPolicy.baseDelayMs > 0
    ? Math.min(retryPolicy.baseDelayMs, 60_000)
    : 1_000;
  const maxDelayMs = Number.isSafeInteger(retryPolicy.maxDelayMs) && retryPolicy.maxDelayMs > 0
    ? Math.min(retryPolicy.maxDelayMs, 300_000)
    : 30_000;

  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs: Math.max(baseDelayMs, maxDelayMs)
  };
}

function normalizeRetryState(value) {
  const retry = asObject(value);
  return {
    attempts: Number.isSafeInteger(retry.attempts) && retry.attempts >= 0 ? Math.min(retry.attempts, 10) : 0,
    lastAttemptAt: typeof retry.lastAttemptAt === "string" ? retry.lastAttemptAt : null,
    nextRetryAt: typeof retry.nextRetryAt === "string" ? retry.nextRetryAt : null,
    lastErrorCode: typeof retry.lastErrorCode === "string" ? retry.lastErrorCode : null
  };
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeCommandSet(value, fallback = []) {
  if (!Array.isArray(value)) return [...fallback];
  const commands = new Set();
  for (const entry of value) {
    const command = typeof entry === "string" ? entry.trim().toLowerCase() : "";
    if (command === "status" || TRANSITIONS.has(command)) commands.add(command);
  }
  return [...commands].sort();
}

function normalizeCapabilitySet(value, fallback = []) {
  const capabilities = new Set();
  const source = Array.isArray(value) ? value : fallback;

  for (const entry of source) {
    const capability = normalizeIdentifier(entry, null);
    if (capability) capabilities.add(capability);
  }

  return [...capabilities].sort();
}

function normalizeIdentifierSet(value) {
  if (!Array.isArray(value)) return [];
  const identifiers = new Set();

  for (const entry of value) {
    const normalized = normalizeIdentifier(entry, null);
    if (normalized) identifiers.add(normalized);
  }

  return [...identifiers].sort();
}

function normalizeActorScopePolicy(actor) {
  const explicitScopes = Array.isArray(actor.scopes) ? actor.scopes : [];
  const tenantIds = new Set(normalizeIdentifierSet(actor.tenantIds));
  const workspaceIds = new Set(normalizeIdentifierSet(actor.workspaceIds));
  const scopedWorkspaces = new Map();

  for (const scope of explicitScopes) {
    const normalizedScope = asObject(scope);
    const tenantId = normalizeIdentifier(normalizedScope.tenantId, null);
    const workspaceId = normalizeIdentifier(normalizedScope.workspaceId, null);

    if (tenantId) tenantIds.add(tenantId);
    if (workspaceId) workspaceIds.add(workspaceId);
    if (tenantId && workspaceId) {
      if (!scopedWorkspaces.has(tenantId)) scopedWorkspaces.set(tenantId, new Set());
      scopedWorkspaces.get(tenantId).add(workspaceId);
    }
  }

  return {
    tenantIds: [...tenantIds].sort(),
    workspaceIds: [...workspaceIds].sort(),
    scopedWorkspaces: [...scopedWorkspaces.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tenantId, workspaces]) => ({
        tenantId,
        workspaceIds: [...workspaces].sort()
      })),
    tenantBound: tenantIds.size > 0,
    workspaceBound: workspaceIds.size > 0 || scopedWorkspaces.size > 0
  };
}

function actorScopeDecision(actor, tenantId, workspaceId) {
  const policy = actor.scopePolicy;
  const scopedTenant = policy.scopedWorkspaces.find((scope) => scope.tenantId === tenantId) || null;
  const tenantMatched = !policy.tenantBound || policy.tenantIds.includes(tenantId);
  const workspaceMatched =
    !policy.workspaceBound ||
    policy.workspaceIds.includes(workspaceId) ||
    Boolean(scopedTenant?.workspaceIds.includes(workspaceId));

  return {
    accepted: tenantMatched && workspaceMatched,
    tenantMatched,
    workspaceMatched,
    tenantBound: policy.tenantBound,
    workspaceBound: policy.workspaceBound,
    matchedScopedTenant: scopedTenant?.tenantId || null
  };
}

function parseEpoch(value) {
  const epoch = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(epoch) ? epoch : null;
}

function normalizeScheduleWindows(value, now) {
  if (!Array.isArray(value)) return [];
  const nowEpoch = parseEpoch(now);

  return value
    .filter((entry) => entry && typeof entry === "object")
    .slice(-8)
    .map((entry, index) => {
      const startsAtEpoch = parseEpoch(entry.startsAt);
      const endsAtEpoch = parseEpoch(entry.endsAt);
      const validRange = startsAtEpoch !== null && endsAtEpoch !== null && startsAtEpoch < endsAtEpoch;
      const commands = normalizeCommandSet(entry.commands, STATE_CHANGING_COMMANDS);
      const active = Boolean(
        normalizeBoolean(entry.enabled, true) &&
          validRange &&
          nowEpoch !== null &&
          startsAtEpoch <= nowEpoch &&
          nowEpoch <= endsAtEpoch
      );

      return {
        windowId: normalizeIdentifier(entry.windowId, `window:${index + 1}`),
        label: normalizeIdentifier(entry.label, "hosted-kernel schedule window"),
        enabled: normalizeBoolean(entry.enabled, true),
        commands,
        startsAt: typeof entry.startsAt === "string" ? entry.startsAt : null,
        endsAt: typeof entry.endsAt === "string" ? entry.endsAt : null,
        validRange,
        active
      };
    });
}

function normalizeLifecycleControlIntent(value, now) {
  const intent = asObject(value);
  const action = normalizeIdentifier(intent.action, null);
  const command = normalizeCommandSet([intent.command], [])[0] || null;
  const window = asObject(intent.window);
  const windowCommands = normalizeCommandSet(window.commands ?? intent.commands, command ? [command] : STATE_CHANGING_COMMANDS);
  const windowStartsAt = typeof window.startsAt === "string" ? window.startsAt : now;
  const windowEndsAt = typeof window.endsAt === "string" ? window.endsAt : null;
  const startsAtEpoch = parseEpoch(windowStartsAt);
  const endsAtEpoch = parseEpoch(windowEndsAt);
  const scheduleWindow =
    action === "open-schedule-window" || action === "close-schedule-window"
      ? {
          windowId: normalizeIdentifier(window.windowId ?? intent.windowId, `control-window:${windowCommands.join("+") || "all"}`),
          label: normalizeIdentifier(window.label ?? intent.label, "hosted-kernel operator schedule window"),
          enabled: action === "close-schedule-window" ? false : normalizeBoolean(window.enabled, true),
          commands: windowCommands,
          startsAt: windowStartsAt,
          endsAt: windowEndsAt,
          validRange: startsAtEpoch !== null && endsAtEpoch !== null && startsAtEpoch < endsAtEpoch
        }
      : null;
  const validationErrors = [];

  if (!action && Object.keys(intent).length === 0) {
    return {
      present: false,
      action: null,
      command: null,
      scheduleWindow: null,
      reason: null,
      requestedBy: null,
      valid: true,
      validationErrors
    };
  }

  if (!LIFECYCLE_CONTROL_ACTIONS.has(action)) validationErrors.push("unsupported-control-action");
  if (["enable-command", "disable-command", "require-reason", "clear-reason"].includes(action) && !command) {
    validationErrors.push("command-required");
  }
  if (action === "open-schedule-window" && (!scheduleWindow || !scheduleWindow.validRange)) {
    validationErrors.push("valid-schedule-window-required");
  }
  if (action === "close-schedule-window" && !scheduleWindow?.windowId) {
    validationErrors.push("schedule-window-id-required");
  }

  return {
    present: true,
    action,
    command,
    scheduleWindow,
    reason: normalizeIdentifier(intent.reason, null),
    requestedBy: normalizeIdentifier(intent.requestedBy, null),
    valid: validationErrors.length === 0,
    validationErrors
  };
}

function toggleCommand(collection, command, enabled) {
  const commands = new Set(normalizeCommandSet(collection));
  if (!command) return [...commands].sort();
  if (enabled) commands.add(command);
  else commands.delete(command);
  return [...commands].sort();
}

function applyLifecycleControlIntent(baseSettings, controlIntent, now) {
  const projected = { ...baseSettings };
  const changes = [];

  if (!controlIntent.present) {
    return {
      projected,
      plan: {
        present: false,
        applied: false,
        audit: "control-intent-not-present",
        action: null,
        command: null,
        changes,
        validationErrors: []
      }
    };
  }

  if (!controlIntent.valid) {
    return {
      projected,
      plan: {
        present: true,
        applied: false,
        audit: "control-intent-rejected-validation",
        action: controlIntent.action,
        command: controlIntent.command,
        changes,
        validationErrors: controlIntent.validationErrors
      }
    };
  }

  if (controlIntent.action === "enable-lifecycle") {
    projected.lifecycleEnabled = true;
    changes.push("lifecycleEnabled:true");
  } else if (controlIntent.action === "disable-lifecycle") {
    projected.lifecycleEnabled = false;
    changes.push("lifecycleEnabled:false");
  } else if (controlIntent.action === "enter-maintenance") {
    projected.maintenanceMode = true;
    changes.push("maintenanceMode:true");
  } else if (controlIntent.action === "exit-maintenance") {
    projected.maintenanceMode = false;
    changes.push("maintenanceMode:false");
  } else if (controlIntent.action === "enable-command") {
    projected.allowedCommands = toggleCommand(projected.allowedCommands, controlIntent.command, true);
    projected.disabledCommands = toggleCommand(projected.disabledCommands, controlIntent.command, false);
    changes.push(`command:${controlIntent.command}:enabled`);
  } else if (controlIntent.action === "disable-command") {
    projected.disabledCommands = toggleCommand(projected.disabledCommands, controlIntent.command, true);
    changes.push(`command:${controlIntent.command}:disabled`);
  } else if (controlIntent.action === "require-reason") {
    projected.requireReasonFor = toggleCommand(projected.requireReasonFor, controlIntent.command, true);
    changes.push(`command:${controlIntent.command}:reason-required`);
  } else if (controlIntent.action === "clear-reason") {
    projected.requireReasonFor = toggleCommand(projected.requireReasonFor, controlIntent.command, false);
    changes.push(`command:${controlIntent.command}:reason-cleared`);
  } else if (controlIntent.action === "open-schedule-window") {
    const existingWindows = Array.isArray(projected.scheduleWindows) ? projected.scheduleWindows : [];
    projected.scheduleWindows = existingWindows
      .filter((window) => normalizeIdentifier(window.windowId, null) !== controlIntent.scheduleWindow.windowId)
      .concat(controlIntent.scheduleWindow);
    changes.push(`schedule:${controlIntent.scheduleWindow.windowId}:opened`);
  } else if (controlIntent.action === "close-schedule-window") {
    const existingWindows = Array.isArray(projected.scheduleWindows) ? projected.scheduleWindows : [];
    projected.scheduleWindows = existingWindows.map((window) =>
      normalizeIdentifier(window.windowId, null) === controlIntent.scheduleWindow.windowId
        ? { ...window, enabled: false, closedAt: now }
        : window
    );
    changes.push(`schedule:${controlIntent.scheduleWindow.windowId}:closed`);
  }

  return {
    projected,
    plan: {
      present: true,
      applied: changes.length > 0,
      audit: changes.length > 0 ? "control-intent-applied" : "control-intent-noop",
      action: controlIntent.action,
      command: controlIntent.command,
      scheduleWindowId: controlIntent.scheduleWindow?.windowId || null,
      requestedBy: controlIntent.requestedBy,
      reason: controlIntent.reason,
      changes,
      validationErrors: [],
      effectiveAt: now
    }
  };
}

function normalizeLifecycleSettings(inputSettings, persistedSettings, now) {
  const persisted = asObject(persistedSettings);
  const input = asObject(inputSettings);
  const merged = { ...persisted, ...input };
  const controlIntent = normalizeLifecycleControlIntent(merged.controlIntent, now);
  const controlApplication = applyLifecycleControlIntent(merged, controlIntent, now);
  const projected = controlApplication.projected;
  const allowedCommands = normalizeCommandSet(projected.allowedCommands, ["boot", "pause", "resume", "stop", "fail", "status"]);
  const disabledCommands = normalizeCommandSet(projected.disabledCommands);
  const requireReasonFor = normalizeCommandSet(projected.requireReasonFor);
  const scheduleWindows = normalizeScheduleWindows(projected.scheduleWindows, now);
  const invalidWindows = scheduleWindows.filter((window) => !window.validRange);
  const commandConflicts = disabledCommands.filter((command) => allowedCommands.includes(command));

  return {
    schemaVersion: 1,
    lifecycleEnabled: normalizeBoolean(projected.lifecycleEnabled, true),
    maintenanceMode: normalizeBoolean(projected.maintenanceMode, false),
    requireScopedActorForStateChanges: normalizeBoolean(projected.requireScopedActorForStateChanges, true),
    requireExplicitScopeForStateChanges: normalizeBoolean(projected.requireExplicitScopeForStateChanges, false),
    allowedCommands,
    disabledCommands,
    requireReasonFor,
    scheduleWindows,
    controlIntent: controlApplication.plan,
    validation: {
      valid: invalidWindows.length === 0 && commandConflicts.length === 0 && controlApplication.plan.validationErrors.length === 0,
      invalidWindowIds: invalidWindows.map((window) => window.windowId),
      conflictingCommands: commandConflicts,
      hasActiveWindow: scheduleWindows.some((window) => window.active),
      controlIntentValid: controlApplication.plan.validationErrors.length === 0,
      controlIntentAudit: controlApplication.plan.audit
    }
  };
}

function normalizeScope(input = {}, persisted = {}) {
  const requestedTenantId = normalizeIdentifier(input.tenantId, null);
  const requestedWorkspaceId = normalizeIdentifier(input.workspaceId, null);
  const persistedTenantId = normalizeIdentifier(persisted.tenantId, requestedTenantId || "tenant:default");
  const persistedWorkspaceId = normalizeIdentifier(persisted.workspaceId, requestedWorkspaceId || "workspace:default");

  return {
    tenantId: persistedTenantId,
    workspaceId: persistedWorkspaceId,
    requestedTenantId: requestedTenantId || persistedTenantId,
    requestedWorkspaceId: requestedWorkspaceId || persistedWorkspaceId,
    requestedTenantExplicit: Boolean(requestedTenantId),
    requestedWorkspaceExplicit: Boolean(requestedWorkspaceId),
    tenantMatched: !requestedTenantId || requestedTenantId === persistedTenantId,
    workspaceMatched: !requestedWorkspaceId || requestedWorkspaceId === persistedWorkspaceId
  };
}

function normalizeActor(value) {
  const actor = asObject(value);
  const roles = Array.isArray(actor.roles)
    ? actor.roles.map((role) => normalizeIdentifier(role, null)).filter(Boolean)
    : [];
  const grants = new Set();

  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS.get(role) || []) {
      grants.add(permission);
    }
  }

  if (Array.isArray(actor.permissions)) {
    for (const permission of actor.permissions) {
      const normalized = normalizeIdentifier(permission, null);
      if (normalized) grants.add(normalized);
    }
  }

  if (roles.length === 0 && grants.size === 0) {
    grants.add("kernel:status");
  }

  return {
    actorId: normalizeIdentifier(actor.actorId, "actor:anonymous"),
    roles,
    permissions: [...grants].sort(),
    scopePolicy: normalizeActorScopePolicy(actor)
  };
}

function normalizeProviderContract(inputProvider = {}, persistedProvider = {}) {
  const persisted = asObject(persistedProvider);
  const input = asObject(inputProvider);
  const merged = { ...persisted, ...input };
  const sync = asObject(merged.sync);
  const handoff = asObject(merged.handoff);
  const dispatch = asObject(merged.dispatch);
  const delivery = asObject(merged.delivery ?? dispatch.delivery);
  const auth = asObject(merged.auth ?? dispatch.auth);
  const capabilities = normalizeCapabilitySet(merged.capabilities, PROVIDER_CAPABILITIES);
  const method = normalizeIdentifier(dispatch.method, "POST").toUpperCase();
  const deliveryMode = normalizeIdentifier(delivery.mode, dispatch.endpoint ? "webhook" : "control-plane").toLowerCase();
  const authScheme = normalizeIdentifier(auth.scheme, "none").toLowerCase();

  return {
    schemaVersion: 1,
    providerId: normalizeIdentifier(merged.providerId, "provider:hosted-kernel-local"),
    serviceName: normalizeIdentifier(merged.serviceName, "hosted-kernel-orchestrator"),
    contractVersion: normalizeIdentifier(merged.contractVersion, "hosted-kernel-provider/v1"),
    enabled: normalizeBoolean(merged.enabled, true),
    capabilities,
    sync: {
      mode: normalizeIdentifier(sync.mode, "generation-cursor"),
      cursor: normalizeIdentifier(sync.cursor, null),
      observedGeneration: normalizeGeneration(sync.observedGeneration),
      observedState: normalizeState(sync.observedState),
      lastSyncedAt: typeof sync.lastSyncedAt === "string" ? sync.lastSyncedAt : null,
      maxLagGenerations: normalizePositiveInteger(sync.maxLagGenerations, 1, 50),
      requireWriteBarrier: normalizeBoolean(sync.requireWriteBarrier, true)
    },
    handoff: {
      channel: normalizeIdentifier(handoff.channel, "kernel-lifecycle-control-plane"),
      target: normalizeIdentifier(handoff.target, "hosted-kernel-provider"),
      correlationId: normalizeIdentifier(handoff.correlationId, null),
      expiresAt: typeof handoff.expiresAt === "string" ? handoff.expiresAt : null
    },
    dispatch: {
      endpoint: normalizeIdentifier(dispatch.endpoint, "provider://hosted-kernel/lifecycle/transition"),
      method: PROVIDER_HANDOFF_METHODS.has(method) ? method : "POST",
      contentType: normalizeIdentifier(dispatch.contentType, "application/vnd.aios.kernel-lifecycle.transition+json"),
      acknowledgementMode: normalizeIdentifier(dispatch.acknowledgementMode, "provider-terminal-state"),
      timeoutMs: normalizePositiveInteger(dispatch.timeoutMs, 30_000, 300_000),
      requiredHeaders: normalizeHeaderMap(dispatch.requiredHeaders)
    },
    delivery: {
      mode: PROVIDER_DELIVERY_MODES.has(deliveryMode) ? deliveryMode : "control-plane",
      topic: normalizeIdentifier(delivery.topic, "kernel.lifecycle.transition"),
      queueName: normalizeIdentifier(delivery.queueName, null),
      eventName: normalizeIdentifier(delivery.eventName, "kernel.lifecycle.transition.dispatch"),
      maxAttempts: normalizePositiveInteger(delivery.maxAttempts, 3, 10),
      dedupeWindowMs: normalizePositiveInteger(delivery.dedupeWindowMs, 300_000, 86_400_000)
    },
    auth: {
      scheme: PROVIDER_AUTH_SCHEMES.has(authScheme) ? authScheme : "none",
      audience: normalizeIdentifier(auth.audience, providerIdForAuth(merged.providerId)),
      issuer: normalizeIdentifier(auth.issuer, "aios-kernel-lifecycle"),
      keyId: normalizeIdentifier(auth.keyId, null),
      headerName: normalizeIdentifier(auth.headerName, "authorization")
    }
  };
}

function providerIdForAuth(providerId) {
  return normalizeIdentifier(providerId, "provider:hosted-kernel-local");
}

function normalizeProviderAcknowledgement(inputAck = {}, persistedAck = {}, providerContract = {}, now) {
  const persisted = asObject(persistedAck);
  const input = asObject(inputAck);
  const merged = { ...persisted, ...input };
  const terminalState = normalizeState(merged.terminalState ?? merged.state);
  const commandName = normalizeCommandSet([merged.commandName ?? merged.command], [])[0] || "status";

  return {
    schemaVersion: 1,
    ackId: normalizeIdentifier(merged.ackId, null),
    providerId: normalizeIdentifier(merged.providerId, providerContract.providerId || "provider:hosted-kernel-local"),
    correlationId: normalizeIdentifier(merged.correlationId, null),
    commandId: normalizeIdentifier(merged.commandId, null),
    commandName,
    terminalState,
    providerGeneration: normalizeGeneration(merged.providerGeneration ?? merged.generation),
    accepted: merged.accepted === true,
    message: normalizeIdentifier(merged.message, null),
    completedAt: typeof merged.completedAt === "string" ? merged.completedAt : null,
    observedAt: typeof merged.observedAt === "string" ? merged.observedAt : now
  };
}

function providerAckGenerationDecision(stateContract, providerAck, providerContract) {
  const observedGeneration = providerContract.sync.observedGeneration;
  const providerGeneration = providerAck.providerGeneration;
  const stateGeneration = stateContract.generation;
  const maxLagGenerations = providerContract.sync.maxLagGenerations;
  const lagFromState = stateGeneration - observedGeneration;
  const minAcceptedGeneration = stateGeneration + 1;
  const maxAcceptedGeneration = stateGeneration + maxLagGenerations + 1;

  if (providerGeneration < minAcceptedGeneration) {
    return {
      accepted: false,
      audit: "provider-ack-rejected-stale-generation",
      reason: "Provider acknowledgement generation does not advance the active hosted-kernel transition.",
      observedGeneration,
      providerGeneration,
      stateGeneration,
      expectedMinimumGeneration: minAcceptedGeneration,
      expectedMaximumGeneration: maxAcceptedGeneration,
      lagFromState,
      maxLagGenerations
    };
  }

  if (providerGeneration > maxAcceptedGeneration) {
    return {
      accepted: false,
      audit: "provider-ack-rejected-generation-gap",
      reason: "Provider acknowledgement generation is beyond the hosted-kernel write-barrier window.",
      observedGeneration,
      providerGeneration,
      stateGeneration,
      expectedMinimumGeneration: minAcceptedGeneration,
      expectedMaximumGeneration: maxAcceptedGeneration,
      lagFromState,
      maxLagGenerations
    };
  }

  return {
    accepted: true,
    audit: "provider-ack-generation-accepted",
    reason: "Provider acknowledgement generation advances the active hosted-kernel transition within the write-barrier window.",
    observedGeneration,
    providerGeneration,
    stateGeneration,
    expectedMinimumGeneration: minAcceptedGeneration,
    expectedMaximumGeneration: maxAcceptedGeneration,
    lagFromState,
    maxLagGenerations
  };
}

function providerAckHandoffDecision(stateContract, providerAck, providerContract) {
  const expectedCorrelationId = normalizeIdentifier(providerContract.handoff.correlationId, null);
  const activeCommandId = normalizeIdentifier(stateContract.activeCommandId, null);
  const ackCorrelationId = normalizeIdentifier(providerAck.correlationId, null);
  const ackCommandId = normalizeIdentifier(providerAck.commandId, null);
  const commandMatched = Boolean(activeCommandId && ackCommandId === activeCommandId);
  const correlationRequired = Boolean(expectedCorrelationId);
  const correlationMatched = !correlationRequired || ackCorrelationId === expectedCorrelationId;

  if (!commandMatched) {
    return {
      accepted: false,
      audit: "provider-ack-rejected-command",
      reason: "Provider acknowledgement does not match the active hosted-kernel command.",
      expectedCommandId: activeCommandId,
      actualCommandId: ackCommandId,
      correlationRequired,
      expectedCorrelationId,
      actualCorrelationId: ackCorrelationId,
      correlationMatched
    };
  }

  if (!correlationMatched) {
    return {
      accepted: false,
      audit: "provider-ack-rejected-correlation",
      reason: "Provider acknowledgement correlation id does not match the active hosted-kernel handoff.",
      expectedCommandId: activeCommandId,
      actualCommandId: ackCommandId,
      correlationRequired,
      expectedCorrelationId,
      actualCorrelationId: ackCorrelationId,
      correlationMatched
    };
  }

  return {
    accepted: true,
    audit: "provider-ack-handoff-accepted",
    reason: "Provider acknowledgement matches the active hosted-kernel command and handoff correlation.",
    expectedCommandId: activeCommandId,
    actualCommandId: ackCommandId,
    correlationRequired,
    expectedCorrelationId,
    actualCorrelationId: ackCorrelationId,
    correlationMatched
  };
}

function shapeProviderAcknowledgementValidation(stateContract, providerAck, providerContract) {
  const handoff = providerAckHandoffDecision(stateContract, providerAck, providerContract);
  const generation = providerAckGenerationDecision(stateContract, providerAck, providerContract);
  const checks = [
    {
      checkId: "handoff-command",
      accepted: handoff.accepted,
      audit: handoff.audit,
      reason: handoff.reason,
      expectedCommandId: handoff.expectedCommandId,
      actualCommandId: handoff.actualCommandId
    },
    {
      checkId: "handoff-correlation",
      accepted: handoff.correlationMatched,
      audit: handoff.correlationMatched ? "provider-ack-correlation-accepted" : handoff.audit,
      reason: handoff.correlationRequired
        ? handoff.reason
        : "No persisted provider handoff correlation id was required for this acknowledgement.",
      required: handoff.correlationRequired,
      expectedCorrelationId: handoff.expectedCorrelationId,
      actualCorrelationId: handoff.actualCorrelationId
    },
    {
      checkId: "generation-write-barrier",
      accepted: generation.accepted,
      audit: generation.audit,
      reason: generation.reason,
      observedGeneration: generation.observedGeneration,
      providerGeneration: generation.providerGeneration,
      stateGeneration: generation.stateGeneration,
      expectedMinimumGeneration: generation.expectedMinimumGeneration,
      expectedMaximumGeneration: generation.expectedMaximumGeneration,
      maxLagGenerations: generation.maxLagGenerations
    }
  ];
  const firstRejected = checks.find((check) => !check.accepted) || null;

  return {
    schemaVersion: 1,
    accepted: !firstRejected,
    audit: firstRejected?.audit || "provider-ack-validation-accepted",
    reason: firstRejected?.reason || "Provider acknowledgement passed handoff and generation validation.",
    checks,
    handoff,
    generation
  };
}

function evaluateProviderAcknowledgement(stateContract, providerAck, providerContract) {
  if (!providerAck.ackId && !providerAck.commandId && !providerAck.correlationId) {
    return {
      accepted: false,
      audit: "provider-ack-not-present",
      applied: false,
      reason: "No provider acknowledgement envelope was supplied."
    };
  }

  if (providerAck.providerId !== providerContract.providerId) {
    return {
      accepted: false,
      audit: "provider-ack-rejected-provider",
      applied: false,
      reason: "Provider acknowledgement was emitted by a different hosted-kernel provider."
    };
  }

  if (!providerAck.accepted) {
    return {
      accepted: false,
      audit: "provider-ack-rejected-negative",
      applied: false,
      reason: "Provider acknowledgement did not confirm successful terminal orchestration."
    };
  }

  const transition = TRANSITIONS.get(providerAck.commandName);
  if (!transition) {
    return {
      accepted: false,
      audit: "provider-ack-rejected-command-name",
      applied: false,
      reason: "Provider acknowledgement references an unsupported lifecycle command."
    };
  }

  if (providerAck.terminalState !== transition.terminal) {
    return {
      accepted: false,
      audit: "provider-ack-rejected-terminal",
      applied: false,
      reason: "Provider acknowledgement terminal state does not match the hosted-kernel transition contract."
    };
  }

  if (!DEGRADED_STATES.has(stateContract.state)) {
    return {
      accepted: false,
      audit: "provider-ack-rejected-state",
      applied: false,
      reason: "Provider acknowledgement arrived when no lifecycle transition was in flight."
    };
  }

  const validation = shapeProviderAcknowledgementValidation(stateContract, providerAck, providerContract);
  if (!validation.accepted) {
    return {
      accepted: false,
      audit: validation.audit,
      applied: false,
      reason: validation.reason,
      validation
    };
  }

  return {
    accepted: true,
    audit: "provider-ack-applied",
    applied: true,
    reason: "Provider acknowledgement completed the hosted-kernel lifecycle transition.",
    validation
  };
}

function applyProviderAcknowledgement(stateContract, providerAck, ackDecision, now) {
  if (!ackDecision.applied) {
    return {
      ...stateContract,
    providerAcknowledgement: {
      ...providerAck,
      audit: ackDecision.audit,
      applied: false,
      reason: ackDecision.reason,
      validation: ackDecision.validation || null
    }
  };
  }

  const nextGeneration = Math.max(stateContract.generation + 1, providerAck.providerGeneration);
  const nextHistory = mergeTransitionHistory(
    stateContract.history,
    {
      ...shapeTransitionRecord({
        command: {
          commandId: providerAck.commandId,
          name: providerAck.commandName
        },
        from: stateContract.state,
        to: providerAck.terminalState,
        generation: nextGeneration,
        outcome: "accepted",
        audit: ackDecision.audit,
        at: providerAck.completedAt || providerAck.observedAt || now,
        replayable: true
      }),
      command: `${providerAck.commandName}:provider-ack`
    }
  );

  return {
    ...stateContract,
    state: providerAck.terminalState,
    restartSafe: true,
    generation: nextGeneration,
    activeCommandId: null,
    lastStableAt: providerAck.completedAt || now,
    updatedAt: providerAck.observedAt || now,
    history: nextHistory,
    providerAcknowledgement: {
      ...providerAck,
      audit: ackDecision.audit,
      applied: true,
      reason: ackDecision.reason,
      validation: ackDecision.validation || null
    }
  };
}

function negotiateProviderCapabilities(providerContract, command) {
  const requiredCapabilities = COMMAND_PROVIDER_CAPABILITIES.get(command.name) || [];
  const provided = new Set(providerContract.enabled ? providerContract.capabilities : []);
  const missingCapabilities = requiredCapabilities.filter((capability) => !provided.has(capability));
  const supportedCommands = ANALYTICS_COMMANDS.filter((candidate) => {
    const candidateRequired = COMMAND_PROVIDER_CAPABILITIES.get(candidate) || [];
    return candidateRequired.every((capability) => provided.has(capability));
  });

  return {
    accepted: providerContract.enabled && missingCapabilities.length === 0,
    audit: providerContract.enabled && missingCapabilities.length === 0
      ? "provider-capabilities-accepted"
      : "command-rejected-provider-capability",
    providerId: providerContract.providerId,
    serviceName: providerContract.serviceName,
    contractVersion: providerContract.contractVersion,
    requiredCapabilities,
    providedCapabilities: providerContract.capabilities,
    missingCapabilities,
    supportedCommands
  };
}

function shapeProviderServiceContract(providerContract, providerNegotiation, result, command, correlationId) {
  const commandContract = transitionContractFor(command.name);
  const requiresTerminalAck =
    result.accepted &&
    STATE_CHANGING_COMMANDS.includes(command.name) &&
    providerContract.dispatch.acknowledgementMode === "provider-terminal-state";
  const authRequired = providerContract.auth.scheme !== "none";
  const authHeaderName = authRequired ? providerContract.auth.headerName.toLowerCase() : null;
  const requiredHeaderNames = [
    ...new Set(Object.keys(providerContract.dispatch.requiredHeaders).concat(authHeaderName || []))
  ].sort();
  const capabilityState = providerNegotiation.accepted
    ? "satisfied"
    : providerContract.enabled
      ? "missing-capabilities"
      : "provider-disabled";

  return {
    schemaVersion: 1,
    providerId: providerContract.providerId,
    serviceName: providerContract.serviceName,
    contractVersion: providerContract.contractVersion,
    capabilityState,
    dispatch: {
      endpoint: providerContract.dispatch.endpoint,
      method: providerContract.dispatch.method,
      contentType: providerContract.dispatch.contentType,
      acknowledgementMode: providerContract.dispatch.acknowledgementMode,
      timeoutMs: providerContract.dispatch.timeoutMs,
      requiredHeaderNames
    },
    delivery: {
      mode: providerContract.delivery.mode,
      channel: providerContract.handoff.channel,
      target: providerContract.handoff.target,
      topic: providerContract.delivery.topic,
      queueName: providerContract.delivery.queueName,
      eventName: providerContract.delivery.eventName,
      maxAttempts: providerContract.delivery.maxAttempts,
      dedupeWindowMs: providerContract.delivery.dedupeWindowMs,
      dedupeKey: `${providerContract.providerId}:${command.commandId}:${correlationId}`
    },
    auth: {
      scheme: providerContract.auth.scheme,
      required: authRequired,
      audience: providerContract.auth.audience,
      issuer: providerContract.auth.issuer,
      keyId: providerContract.auth.keyId,
      headerName: authHeaderName
    },
    capabilities: {
      required: providerNegotiation.requiredCapabilities,
      provided: providerNegotiation.providedCapabilities,
      missing: providerNegotiation.missingCapabilities,
      supportedCommands: providerNegotiation.supportedCommands
    },
    acknowledgement: {
      required: requiresTerminalAck,
      mode: providerContract.dispatch.acknowledgementMode,
      expectedProviderId: providerContract.providerId,
      expectedCorrelationId: correlationId,
      expectedCommandId: command.commandId,
      expectedCommandName: command.name,
      expectedTerminalState: commandContract.terminalState || result.state.state,
      expectedFields: requiresTerminalAck
        ? ["ackId", "providerId", "correlationId", "commandId", "commandName", "terminalState", "providerGeneration", "accepted"]
        : []
    },
    replay: {
      commandId: command.commandId,
      generation: result.state.generation,
      replaySafe: result.accepted || result.idempotent,
      idempotencyKey: `${providerContract.providerId}:${command.commandId}:${result.state.generation}`
    }
  };
}

function shapeProviderSyncMetadata(providerContract, result, command, now) {
  const cursorGeneration = result.accepted ? result.state.generation : providerContract.sync.observedGeneration;
  const cursorState = result.accepted ? result.state.state : providerContract.sync.observedState;
  const lagGenerations = Math.max(0, result.state.generation - providerContract.sync.observedGeneration);
  const stateDiverged =
    providerContract.sync.observedGeneration > 0 &&
    providerContract.sync.observedGeneration === result.state.generation &&
    providerContract.sync.observedState !== result.state.state;
  const freshness = stateDiverged
    ? "conflicted"
    : lagGenerations > providerContract.sync.maxLagGenerations
      ? "stale"
      : lagGenerations > 0
        ? "behind"
        : "current";
  const writeBarrier = {
    required: providerContract.sync.requireWriteBarrier && result.accepted && command.name !== "status",
    expectedGeneration: result.state.generation,
    previousProviderGeneration: providerContract.sync.observedGeneration,
    satisfied: !stateDiverged && lagGenerations <= providerContract.sync.maxLagGenerations
  };

  return {
    mode: providerContract.sync.mode,
    cursor: `${providerContract.providerId}:${cursorGeneration}:${cursorState}`,
    previousCursor: providerContract.sync.cursor,
    observedGeneration: cursorGeneration,
    observedState: cursorState,
    lastSyncedAt: result.accepted ? now : providerContract.sync.lastSyncedAt,
    needsWriteback: result.accepted && command.name !== "status",
    stale: freshness === "stale" || freshness === "conflicted",
    freshness,
    lagGenerations,
    stateDiverged,
    writeBarrier
  };
}

function shapeExternalHandoff(providerContract, providerNegotiation, result, command, now) {
  const terminal = TRANSITIONS.get(command.name)?.terminal || result.state.state;
  const required = result.accepted && command.name !== "status" && !result.idempotent;
  const boundaryPolicy = result.boundary.policy || {};
  const correlationId = providerContract.handoff.correlationId || `${command.commandId}:${result.state.generation}`;
  const serviceContract = shapeProviderServiceContract(
    providerContract,
    providerNegotiation,
    result,
    command,
    correlationId
  );

  return {
    required,
    state: !providerNegotiation.accepted
      ? "blocked"
      : required
        ? "pending-provider-ack"
        : "not-required",
    channel: providerContract.handoff.channel,
    target: providerContract.handoff.target,
    correlationId,
    commandId: command.commandId,
    commandName: command.name,
    scope: {
      tenantId: result.state.tenantId,
      workspaceId: result.state.workspaceId,
      requestedTenantId: result.boundary.scope.requestedTenantId,
      requestedWorkspaceId: result.boundary.scope.requestedWorkspaceId,
      tenantMatched: result.boundary.scope.tenantMatched,
      workspaceMatched: result.boundary.scope.workspaceMatched,
      actorTenantMatched: result.boundary.scope.actorTenantMatched,
      actorWorkspaceMatched: result.boundary.scope.actorWorkspaceMatched,
      policyAccepted: boundaryPolicy.accepted === true,
      policyAudit: boundaryPolicy.audit || result.boundary.audit,
      tenantScopeSource: boundaryPolicy.tenantScopeSource || command.scopeSource.tenant,
      workspaceScopeSource: boundaryPolicy.workspaceScopeSource || command.scopeSource.workspace
    },
    expectedTerminalState: terminal,
    providerAudit: providerNegotiation.audit,
    serviceContract,
    createdAt: required ? now : null,
    expiresAt: providerContract.handoff.expiresAt
  };
}

function shapeProviderServiceDispatch(providerContract, providerNegotiation, providerSync, externalHandoff, result, command, now) {
  const dispatchable =
    externalHandoff.required &&
    externalHandoff.state === "pending-provider-ack" &&
    providerNegotiation.accepted &&
    providerSync.writeBarrier.satisfied;
  const headers = {
    "content-type": providerContract.dispatch.contentType,
    "x-aios-provider-id": providerContract.providerId,
    "x-aios-command-id": command.commandId,
    "x-aios-correlation-id": externalHandoff.correlationId,
    ...providerContract.dispatch.requiredHeaders
  };
  const blockedBy = [];

  if (!externalHandoff.required) blockedBy.push("handoff-not-required");
  if (!providerNegotiation.accepted) blockedBy.push(providerNegotiation.audit);
  if (!providerSync.writeBarrier.satisfied) {
    blockedBy.push(providerSync.stateDiverged ? "provider-sync-conflict" : "provider-sync-stale");
  }

  return {
    schemaVersion: 1,
    dispatchId: `${externalHandoff.correlationId}:dispatch`,
    dispatchable,
    state: dispatchable ? "ready" : externalHandoff.state === "blocked" ? "blocked" : "not-ready",
    blockedBy,
    transport: {
      endpoint: providerContract.dispatch.endpoint,
      method: providerContract.dispatch.method,
      deliveryMode: providerContract.delivery.mode,
      topic: providerContract.delivery.topic,
      queueName: providerContract.delivery.queueName,
      eventName: providerContract.delivery.eventName,
      timeoutMs: providerContract.dispatch.timeoutMs,
      headers
    },
    serviceContract: externalHandoff.serviceContract,
    idempotency: {
      key: externalHandoff.serviceContract.replay.idempotencyKey,
      dedupeKey: externalHandoff.serviceContract.delivery.dedupeKey,
      replaySafe: externalHandoff.serviceContract.replay.replaySafe,
      commandLedgerGeneration: result.state.generation
    },
    payload: {
      type: "kernel.lifecycle.transition.dispatch",
      emittedAt: now,
      providerId: providerContract.providerId,
      serviceName: providerContract.serviceName,
      contractVersion: providerContract.contractVersion,
      correlationId: externalHandoff.correlationId,
      command: {
        commandId: command.commandId,
        name: command.name,
        reason: command.reason,
        acceptedAudit: result.audit
      },
      scope: externalHandoff.scope,
      boundary: {
        accepted: result.boundary.accepted,
        audit: result.boundary.audit,
        policy: result.boundary.policy,
        requiredPermission: result.boundary.requiredPermission || null
      },
      transition: {
        from: result.state.history[result.state.history.length - 1]?.from || result.state.state,
        current: result.state.state,
        expectedTerminalState: externalHandoff.expectedTerminalState,
        activeCommandId: result.state.activeCommandId
      },
      serviceContract: externalHandoff.serviceContract,
      sync: {
        cursor: providerSync.cursor,
        previousCursor: providerSync.previousCursor,
        writeBarrier: providerSync.writeBarrier,
        freshness: providerSync.freshness,
        lagGenerations: providerSync.lagGenerations,
        stateDiverged: providerSync.stateDiverged
      },
      acknowledgement: externalHandoff.serviceContract.acknowledgement
    }
  };
}

function normalizeClientRuntime(inputClient = {}, inputRequest = {}, now) {
  const client = asObject(inputClient);
  const request = asObject(inputRequest);
  const workflow = asObject(client.workflowHandoff ?? request.workflowHandoff);
  const requestedMode = normalizeIdentifier(workflow.mode ?? client.handoffMode ?? request.handoffMode, "inline");
  const acceptedHandoffChannels = normalizeCapabilitySet(
    client.acceptedHandoffChannels,
    ["kernel-lifecycle-control-plane"]
  );
  const observedGeneration = normalizeGeneration(client.observedGeneration ?? request.observedGeneration);
  const visibleState = normalizeState(client.visibleState ?? request.visibleState);
  const handoffMode = CLIENT_ROUTE_HANDOFF_MODES.has(requestedMode) ? requestedMode : "inline";
  const requestedRouteId = normalizeIdentifier(workflow.routeId ?? workflow.targetRouteId, null);
  const requestedEventName = normalizeIdentifier(workflow.eventName ?? workflow.targetEventName, null);
  const fallbackRouteId = normalizeIdentifier(
    request.returnRouteId ?? client.returnRouteId,
    `${surfaceGroup}/${surfaceName}`
  );
  const fallbackEventName = normalizeIdentifier(
    request.returnEventName ?? client.returnEventName,
    "kernel.lifecycle.workflow.handoff"
  );
  const routeHandoffValidation = [];

  if (handoffMode === "navigate" && !requestedRouteId) {
    routeHandoffValidation.push("target-route-required");
  }
  if (handoffMode === "emit-event" && !requestedEventName) {
    routeHandoffValidation.push("target-event-required");
  }

  return {
    schemaVersion: 1,
    clientId: normalizeIdentifier(client.clientId ?? request.clientId, "client:anonymous"),
    sessionId: normalizeIdentifier(client.sessionId ?? request.sessionId, "session:anonymous"),
    requestId: normalizeIdentifier(request.requestId ?? client.requestId, "request:state-transition"),
    routeId: normalizeIdentifier(request.routeId ?? client.routeId, `${surfaceGroup}/${surfaceName}`),
    view: normalizeIdentifier(client.view ?? request.view, "kernel-lifecycle"),
    requestedAt: typeof request.requestedAt === "string" ? request.requestedAt : now,
    supportsOptimisticState: normalizeBoolean(client.supportsOptimisticState, true),
    supportsWorkflowHandoff: normalizeBoolean(client.supportsWorkflowHandoff, true),
    acceptedHandoffChannels,
    observedGeneration,
    visibleState,
    routeHandoff: {
      schemaVersion: 1,
      mode: handoffMode,
      requestedMode,
      targetRouteId: requestedRouteId || fallbackRouteId,
      eventName: requestedEventName || fallbackEventName,
      returnRouteId: fallbackRouteId,
      replaceHistory: normalizeBoolean(workflow.replaceHistory, false),
      preserveQuery: normalizeBoolean(workflow.preserveQuery, true),
      requireStableGeneration: normalizeBoolean(workflow.requireStableGeneration, false),
      valid: routeHandoffValidation.length === 0,
      validationErrors: routeHandoffValidation
    },
    stale: false
  };
}

function shapeClientWorkflowStep(stepId, label, status, metadata = {}) {
  return {
    stepId,
    label,
    status,
    ...metadata
  };
}

function shapeClientRouteHandoffPlan(clientRuntime, shapedState, result, providerSync, externalHandoff, routeHandoffReady, routeHandoffState, routeHandoffPayload) {
  const blockers = [];
  const terminal = TERMINAL_STATES.has(shapedState.state);
  const mode = clientRuntime.routeHandoff.mode;
  const actionType =
    mode === "navigate"
      ? "navigate"
      : mode === "emit-event"
        ? "emit-event"
        : "inline-refresh";

  if (!result.accepted) blockers.push(result.audit);
  if (mode !== "inline" && !clientRuntime.supportsWorkflowHandoff) blockers.push("client-workflow-handoff-disabled");
  if (externalHandoff.required && !clientRuntime.acceptedHandoffChannels.includes(externalHandoff.channel)) {
    blockers.push("provider-handoff-channel-unsupported");
  }
  if (!clientRuntime.routeHandoff.valid) blockers.push(...clientRuntime.routeHandoff.validationErrors);
  if (clientRuntime.routeHandoff.requireStableGeneration && !terminal) blockers.push("stable-generation-required");
  if (externalHandoff.required && externalHandoff.state !== "pending-provider-ack") blockers.push(externalHandoff.state);
  if (providerSync.stale) blockers.push(providerSync.freshness === "conflicted" ? "provider-sync-conflict" : "provider-sync-stale");

  const ready = routeHandoffReady && blockers.length === 0;
  const requiredPayloadFields = [
    "type",
    "schemaVersion",
    "requestId",
    "clientId",
    "sessionId",
    "commandId",
    "commandName",
    "state",
    "generation",
    "expectedTerminalState",
    "correlationId",
    "syncCursor",
    "generatedAt"
  ];

  return {
    schemaVersion: 1,
    planId: `${clientRuntime.requestId}:${routeHandoffPayload.commandId}:${mode}:route-handoff`,
    mode,
    actionType,
    state: ready ? "ready" : routeHandoffState,
    ready,
    blockers,
    terminalGeneration: terminal,
    requiresStableGeneration: clientRuntime.routeHandoff.requireStableGeneration,
    requiresProviderAcknowledgement: externalHandoff.required,
    providerHandoffState: externalHandoff.state,
    target: {
      routeId: clientRuntime.routeHandoff.targetRouteId,
      eventName: clientRuntime.routeHandoff.eventName,
      replaceHistory: clientRuntime.routeHandoff.replaceHistory,
      preserveQuery: clientRuntime.routeHandoff.preserveQuery
    },
    replay: {
      replayable: ready || result.idempotent,
      key: [
        clientRuntime.requestId,
        routeHandoffPayload.commandId,
        shapedState.generation,
        externalHandoff.correlationId || "inline"
      ].join(":"),
      generation: shapedState.generation,
      syncCursor: providerSync.cursor
    },
    payloadContract: {
      contentType: "application/vnd.aios.kernel-lifecycle.route-handoff+json",
      requiredFields: requiredPayloadFields,
      optionalFields: ["routeId", "eventName"],
      payload: routeHandoffPayload
    }
  };
}

function shapeClientRuntimeState(clientRuntime, shapedState, result, command, providerSync, externalHandoff, nextAction, now) {
  const stale = clientRuntime.observedGeneration < shapedState.generation;
  const optimisticState =
    result.accepted && !result.idempotent && DEGRADED_STATES.has(shapedState.state)
      ? {
          enabled: clientRuntime.supportsOptimisticState,
          state: shapedState.state,
          generation: shapedState.generation,
          reconcileWithCursor: providerSync.cursor
        }
      : {
          enabled: false,
          state: shapedState.state,
          generation: shapedState.generation,
          reconcileWithCursor: providerSync.cursor
        };
  const cacheInvalidation = {
    required: result.accepted || stale,
    reason: result.accepted ? "state-transition-applied" : stale ? "client-generation-stale" : "no-change",
    keys: [
      `${surfaceId}:${shapedState.tenantId}:${shapedState.workspaceId}:state`,
      `${surfaceId}:${shapedState.tenantId}:${shapedState.workspaceId}:timeline`,
      `${surfaceId}:${shapedState.tenantId}:${shapedState.workspaceId}:controls`
    ],
    generation: shapedState.generation
  };
  const handoffSupported =
    clientRuntime.supportsWorkflowHandoff && clientRuntime.acceptedHandoffChannels.includes(externalHandoff.channel);
  const routeHandoffReady =
    clientRuntime.routeHandoff.valid &&
    (!clientRuntime.routeHandoff.requireStableGeneration || TERMINAL_STATES.has(shapedState.state));
  const routeHandoffState = !clientRuntime.routeHandoff.valid
    ? "invalid"
    : clientRuntime.routeHandoff.requireStableGeneration && !TERMINAL_STATES.has(shapedState.state)
      ? "awaiting-stable-generation"
      : clientRuntime.routeHandoff.mode === "inline"
        ? "inline"
        : "ready";
  const workflowState = !result.accepted
    ? "blocked"
    : externalHandoff.required
      ? handoffSupported
        ? "handoff-ready"
        : "client-handoff-unsupported"
      : stale
        ? "refresh-required"
        : "settled";
  const routeHandoffPayload = {
    type: "kernel.lifecycle.route.handoff",
    schemaVersion: 1,
    mode: clientRuntime.routeHandoff.mode,
    routeId: clientRuntime.routeHandoff.targetRouteId,
    eventName: clientRuntime.routeHandoff.eventName,
    requestId: clientRuntime.requestId,
    clientId: clientRuntime.clientId,
    sessionId: clientRuntime.sessionId,
    commandId: command.commandId,
    commandName: command.name,
    state: shapedState.state,
    generation: shapedState.generation,
    expectedTerminalState: externalHandoff.expectedTerminalState,
    correlationId: externalHandoff.correlationId,
    syncCursor: providerSync.cursor,
    generatedAt: now
  };
  const routeHandoffPlan = shapeClientRouteHandoffPlan(
    clientRuntime,
    shapedState,
    result,
    providerSync,
    externalHandoff,
    routeHandoffReady,
    routeHandoffState,
    routeHandoffPayload
  );
  const workflowSteps = [
    shapeClientWorkflowStep("authorize-command", "Authorize hosted-kernel command", result.boundary.accepted ? "complete" : "blocked", {
      audit: result.boundary.audit,
      requiredPermission: result.boundary.requiredPermission || null
    }),
    shapeClientWorkflowStep("apply-transition", "Apply lifecycle transition", result.accepted ? "complete" : "blocked", {
      audit: result.audit,
      commandId: command.commandId,
      commandName: command.name
    }),
    shapeClientWorkflowStep(
      "sync-client-state",
      "Sync request state with hosted-kernel generation",
      cacheInvalidation.required ? "pending" : "complete",
      {
        cursor: providerSync.cursor,
        observedGeneration: clientRuntime.observedGeneration,
        targetGeneration: shapedState.generation
      }
    ),
    shapeClientWorkflowStep(
      "provider-handoff",
      "Hand off workflow to hosted-kernel provider",
      externalHandoff.required ? (handoffSupported ? "pending" : "blocked") : "skipped",
      {
        channel: externalHandoff.channel,
        target: externalHandoff.target,
        correlationId: externalHandoff.correlationId,
        expectedTerminalState: externalHandoff.expectedTerminalState
      }
    ),
    shapeClientWorkflowStep(
      "route-handoff",
      "Return workflow to requesting route",
      result.accepted && routeHandoffReady ? (clientRuntime.routeHandoff.mode === "inline" ? "skipped" : "pending") : "blocked",
      {
        mode: clientRuntime.routeHandoff.mode,
        state: routeHandoffPlan.state,
        blockers: routeHandoffPlan.blockers,
        planId: routeHandoffPlan.planId,
        targetRouteId: clientRuntime.routeHandoff.targetRouteId,
        eventName: clientRuntime.routeHandoff.eventName,
        validationErrors: clientRuntime.routeHandoff.validationErrors
      }
    )
  ];

  return {
    runtime: {
      ...clientRuntime,
      visibleState: shapedState.state,
      observedGeneration: shapedState.generation,
      stale
    },
    workflow: {
      schemaVersion: 1,
      state: workflowState,
      generatedAt: now,
      commandId: command.commandId,
      commandName: command.name,
      nextActionType: nextAction.type,
      banner: {
        tone: result.accepted ? (externalHandoff.required ? "progress" : "success") : "error",
        message: result.accepted
          ? nextAction.label
          : `Hosted-kernel command ${command.name} was rejected: ${result.audit}.`
      },
      optimisticState,
      cacheInvalidation,
      handoff: {
        supported: handoffSupported,
        required: externalHandoff.required,
        state: externalHandoff.state,
        channel: externalHandoff.channel,
        target: externalHandoff.target,
        correlationId: externalHandoff.correlationId,
        expectedTerminalState: externalHandoff.expectedTerminalState,
        expiresAt: externalHandoff.expiresAt
      },
      routeHandoff: {
        ...clientRuntime.routeHandoff,
        ready: routeHandoffPlan.ready,
        state: routeHandoffPlan.state,
        blockers: routeHandoffPlan.blockers,
        plan: routeHandoffPlan,
        payload: routeHandoffPayload
      },
      steps: workflowSteps
    }
  };
}

function shapeReadinessCheck(checkId, label, ready, audit, details = {}) {
  return {
    checkId,
    label,
    status: ready ? "ready" : "blocked",
    ready,
    audit,
    ...details
  };
}

function shapeBoundaryProof(result, actor) {
  const scope = result.boundary.scope;
  const policy = result.boundary.policy || {};

  return {
    schemaVersion: 1,
    accepted: result.boundary.accepted,
    audit: result.boundary.audit,
    requiredPermission: result.boundary.requiredPermission || null,
    permissionSatisfied: !result.boundary.requiredPermission || actor.permissions.includes(result.boundary.requiredPermission),
    actor: {
      actorId: actor.actorId,
      roles: actor.roles,
      tenantIds: actor.scopePolicy.tenantIds,
      workspaceIds: actor.scopePolicy.workspaceIds,
      scopedWorkspaces: actor.scopePolicy.scopedWorkspaces
    },
    scope: {
      resolvedTenantId: scope.resolvedTenantId,
      resolvedWorkspaceId: scope.resolvedWorkspaceId,
      requestedTenantId: scope.requestedTenantId,
      requestedWorkspaceId: scope.requestedWorkspaceId,
      tenantMatched: scope.tenantMatched,
      workspaceMatched: scope.workspaceMatched,
      actorTenantMatched: scope.actorTenantMatched,
      actorWorkspaceMatched: scope.actorWorkspaceMatched,
      actorTenantBound: scope.actorTenantBound,
      actorWorkspaceBound: scope.actorWorkspaceBound,
      matchedActorScopedTenant: scope.matchedActorScopedTenant
    },
    isolation: {
      tenantIsolated: scope.tenantMatched && scope.actorTenantMatched,
      workspaceIsolated: scope.workspaceMatched && scope.actorWorkspaceMatched,
      crossTenantBlocked: scope.tenantMatched === false || scope.actorTenantMatched === false,
      crossWorkspaceBlocked: scope.workspaceMatched === false || scope.actorWorkspaceMatched === false
    },
    policy: {
      accepted: policy.accepted === true,
      audit: policy.audit || result.boundary.audit,
      stateChanging: policy.stateChanging === true,
      requiresActorScope: policy.requiresActorScope === true,
      requiresExplicitScope: policy.requiresExplicitScope === true,
      actorTenantScoped: policy.actorTenantScoped !== false,
      actorWorkspaceScoped: policy.actorWorkspaceScoped !== false,
      explicitTenantScoped: policy.explicitTenantScoped !== false,
      explicitWorkspaceScoped: policy.explicitWorkspaceScoped !== false,
      tenantScopeSource: policy.tenantScopeSource || "unknown",
      workspaceScopeSource: policy.workspaceScopeSource || "unknown",
      resolvedTenantId: policy.resolvedTenantId || scope.resolvedTenantId,
      resolvedWorkspaceId: policy.resolvedWorkspaceId || scope.resolvedWorkspaceId
    }
  };
}

function shapePreviewAcceptanceContract(
  clientRuntime,
  priorState,
  shapedState,
  result,
  command,
  operationalHealth,
  settings,
  providerNegotiation,
  externalHandoff,
  nextAction,
  now
) {
  const transition = TRANSITIONS.get(command.name) || null;
  const commandKnown = command.name === "status" || Boolean(transition);
  const beforeState = priorState.state;
  const afterState = shapedState.state;
  const terminalState = transition?.terminal || afterState;
  const stateChanged = beforeState !== afterState || priorState.generation !== shapedState.generation;
  const activeWindow = result.controls.activeWindow || null;
  const handoffRequired = externalHandoff.required === true;
  const handoffReady = !handoffRequired || externalHandoff.state === "pending-provider-ack";
  const routeStale = clientRuntime.observedGeneration < shapedState.generation;
  const providerReady = command.name === "status" || providerNegotiation.accepted;
  const transitionReady = result.accepted || result.audit !== "command-rejected-state";
  const controlsReady = command.name === "status" || result.controls.accepted;
  const scopeReady =
    result.boundary.scope.tenantMatched &&
    result.boundary.scope.workspaceMatched &&
    result.boundary.scope.actorTenantMatched &&
    result.boundary.scope.actorWorkspaceMatched;
  const boundaryPolicy = result.boundary.policy || {};
  const boundaryPolicyReady = boundaryPolicy.accepted !== false;
  const readinessChecks = [
    shapeReadinessCheck("command-known", "Recognized lifecycle command", commandKnown, commandKnown ? "command-known" : "command-rejected-unknown", {
      commandName: command.name
    }),
    shapeReadinessCheck("authorization", "Actor may issue command", result.boundary.accepted, result.boundary.audit, {
      requiredPermission: result.boundary.requiredPermission || null
    }),
    shapeReadinessCheck("scope-isolation", "Tenant and workspace scope are isolated", scopeReady, scopeReady ? "scope-isolated" : result.boundary.audit, {
      tenantMatched: result.boundary.scope.tenantMatched,
      workspaceMatched: result.boundary.scope.workspaceMatched,
      actorTenantMatched: result.boundary.scope.actorTenantMatched,
      actorWorkspaceMatched: result.boundary.scope.actorWorkspaceMatched,
      requestedTenantId: result.boundary.scope.requestedTenantId,
      requestedWorkspaceId: result.boundary.scope.requestedWorkspaceId
    }),
    shapeReadinessCheck(
      "boundary-policy",
      "State-changing commands are bound to safe tenant and workspace policy",
      boundaryPolicyReady,
      boundaryPolicy.audit || result.boundary.audit,
      {
        stateChanging: boundaryPolicy.stateChanging === true,
        requiresActorScope: boundaryPolicy.requiresActorScope === true,
        requiresExplicitScope: boundaryPolicy.requiresExplicitScope === true,
        actorTenantScoped: boundaryPolicy.actorTenantScoped !== false,
        actorWorkspaceScoped: boundaryPolicy.actorWorkspaceScoped !== false,
        explicitTenantScoped: boundaryPolicy.explicitTenantScoped !== false,
        explicitWorkspaceScoped: boundaryPolicy.explicitWorkspaceScoped !== false,
        tenantScopeSource: boundaryPolicy.tenantScopeSource || command.scopeSource.tenant,
        workspaceScopeSource: boundaryPolicy.workspaceScopeSource || command.scopeSource.workspace
      }
    ),
    shapeReadinessCheck("controls", "Lifecycle controls allow command", controlsReady, result.controls.audit, {
      lifecycleEnabled: settings.lifecycleEnabled,
      maintenanceMode: settings.maintenanceMode,
      activeWindowId: activeWindow?.windowId || null
    }),
    shapeReadinessCheck("transition-state", "Current state supports transition", transitionReady, result.audit, {
      from: beforeState,
      requested: command.name,
      allowedFrom: transition?.from || []
    }),
    shapeReadinessCheck("provider-contract", "Hosted provider can execute command", providerReady, providerNegotiation.audit, {
      providerId: providerNegotiation.providerId,
      missingCapabilities: providerNegotiation.missingCapabilities
    }),
    shapeReadinessCheck(
      "operational-health-gate",
      "Operational health allows command",
      result.healthGate.accepted,
      result.healthGate.audit,
      {
        allowedCommands: result.healthGate.allowedCommands,
        blockingErrorCount: result.healthGate.blockingErrorCount,
        degradedErrorCount: result.healthGate.degradedErrorCount,
        latestErrorCode: result.healthGate.latestErrorCode,
        emergencyAllowed: result.healthGate.emergencyAllowed
      }
    ),
    shapeReadinessCheck(
      "retry-gate",
      "Retry policy allows command",
      result.retryGate.accepted,
      result.retryGate.audit,
      {
        attempts: result.retryGate.attempts,
        maxAttempts: result.retryGate.maxAttempts,
        retryAfterMs: result.retryGate.retryAfterMs,
        nextRetryAt: result.retryGate.nextRetryAt,
        allowedCommands: result.retryGate.allowedCommands
      }
    ),
    shapeReadinessCheck("route-sync", "Client can reconcile generation", !routeStale || result.accepted, routeStale ? "client-generation-stale" : "client-generation-current", {
      observedGeneration: clientRuntime.observedGeneration,
      targetGeneration: shapedState.generation
    }),
    shapeReadinessCheck("handoff", "Provider handoff is explainable", handoffReady, externalHandoff.state, {
      required: handoffRequired,
      correlationId: externalHandoff.correlationId,
      expectedTerminalState: externalHandoff.expectedTerminalState
    })
  ];
  const blockedChecks = readinessChecks.filter((check) => !check.ready);
  const warnings = [];

  if (settings.validation.invalidWindowIds.length > 0) {
    warnings.push({
      code: "KERNEL_SCHEDULE_WINDOWS_INVALID",
      message: "One or more hosted-kernel schedule windows have invalid date ranges.",
      windowIds: settings.validation.invalidWindowIds
    });
  }

  if (settings.validation.conflictingCommands.length > 0) {
    warnings.push({
      code: "KERNEL_LIFECYCLE_COMMAND_CONFLICT",
      message: "One or more hosted-kernel commands are both allowed and disabled.",
      commands: settings.validation.conflictingCommands
    });
  }

  if (!settings.validation.controlIntentValid) {
    warnings.push({
      code: "KERNEL_LIFECYCLE_CONTROL_INTENT_INVALID",
      message: "The requested lifecycle control intent could not be applied.",
      audit: settings.validation.controlIntentAudit,
      validationErrors: settings.controlIntent.validationErrors
    });
  }

  if (routeStale) {
    warnings.push({
      code: "KERNEL_CLIENT_GENERATION_STALE",
      message: "The requesting client observed an older hosted-kernel generation.",
      observedGeneration: clientRuntime.observedGeneration,
      targetGeneration: shapedState.generation
    });
  }

  const nextSteps = [];
  if (!result.accepted) {
    nextSteps.push({
      stepId: "resolve-blocker",
      type: nextAction.type,
      label: nextAction.label,
      audit: result.audit,
      retryAt: nextAction.retryAt
    });
  } else if (handoffRequired) {
    nextSteps.push({
      stepId: "await-provider-terminal-state",
      type: "provider-handoff",
      label: `Wait for provider acknowledgement of ${terminalState}.`,
      correlationId: externalHandoff.correlationId,
      expectedTerminalState: terminalState
    });
  } else if (routeStale) {
    nextSteps.push({
      stepId: "refresh-route-state",
      type: "client-refresh",
      label: "Refresh the lifecycle route data to reconcile the latest hosted-kernel generation.",
      targetGeneration: shapedState.generation
    });
  } else {
    nextSteps.push({
      stepId: "continue-lifecycle",
      type: nextAction.type,
      label: nextAction.label,
      command: nextAction.command
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: now,
    routeId: clientRuntime.routeId,
    requestId: clientRuntime.requestId,
    clientId: clientRuntime.clientId,
    command: {
      name: command.name,
      commandId: command.commandId,
      reasonRequired: settings.requireReasonFor.includes(command.name),
      reasonProvided: Boolean(command.reason),
      explicitTenantScope: command.explicitTenantScope,
      explicitWorkspaceScope: command.explicitWorkspaceScope,
      scopeSource: command.scopeSource
    },
    preview: {
      before: {
        state: beforeState,
        generation: priorState.generation,
        restartSafe: priorState.restartSafe
      },
      after: {
        state: afterState,
        generation: shapedState.generation,
        restartSafe: shapedState.restartSafe,
        activeCommandId: shapedState.activeCommandId
      },
      terminalState,
      stateChanged,
      generationDelta: shapedState.generation - priorState.generation,
      stableAfterCommand: TERMINAL_STATES.has(afterState),
      requiresProviderAcknowledgement: handoffRequired
    },
    acceptance: {
      accepted: result.accepted,
      idempotent: result.idempotent,
      replayed: result.replayed === true,
      audit: result.audit,
      headline: result.accepted
        ? `Hosted-kernel command ${command.name} accepted.`
        : `Hosted-kernel command ${command.name} blocked by ${result.audit}.`
    },
    readiness: {
      state: blockedChecks.length === 0 ? "ready" : "blocked",
      readyCount: readinessChecks.length - blockedChecks.length,
      blockedCount: blockedChecks.length,
      checks: readinessChecks
    },
    validationSummary: {
      valid: blockedChecks.length === 0 && operationalHealth.validation.stateKnown,
      healthStatus: operationalHealth.status,
      blockingAudits: blockedChecks.map((check) => check.audit),
      warnings,
      actionableErrorCodes: operationalHealth.errors.map((error) => error.code)
    },
    nextSteps
  };
}

function shapeRouteValidationChip(kind, code, label, metadata = {}) {
  return {
    kind,
    code,
    label,
    ...metadata
  };
}

function shapeRouteAction(actionId, label, enabled, reason, metadata = {}) {
  return {
    actionId,
    label,
    enabled,
    disabledReason: enabled ? null : reason,
    ...metadata
  };
}

function shapeAcceptanceGuard(guardId, label, satisfied, audit, details = {}) {
  return {
    guardId,
    label,
    status: satisfied ? "satisfied" : "blocked",
    satisfied,
    audit,
    ...details
  };
}

function shapeClientContractRequirement(requirementId, label, satisfied, details = {}) {
  return {
    requirementId,
    label,
    satisfied,
    state: satisfied ? "satisfied" : "blocked",
    ...details
  };
}

function shapeClientNextStepContract(step, index, previewAcceptance, routePreview, externalHandoff) {
  const routeAction =
    step.type === "provider-handoff"
      ? routePreview.actions.primary
      : routePreview.actions.secondary.find((action) => action.actionId === "refresh-state") || routePreview.actions.primary;

  return {
    sequence: index + 1,
    stepId: step.stepId,
    type: step.type,
    label: step.label,
    command: step.command || previewAcceptance.command.name,
    audit: step.audit || previewAcceptance.acceptance.audit,
    retryAt: step.retryAt || null,
    expectedTerminalState: step.expectedTerminalState || externalHandoff.expectedTerminalState || null,
    correlationId: step.correlationId || externalHandoff.correlationId || null,
    routeActionId: routeAction.actionId,
    routeEventName: routeAction.eventName,
    routeMethod: routeAction.method,
    enabled: routeAction.enabled !== false
  };
}

function shapeClientAcceptanceDataContracts(
  clientRuntime,
  previewAcceptance,
  routePreview,
  clientState,
  result,
  command,
  providerDispatch,
  externalHandoff,
  submitMode,
  readyToSubmit,
  blockedGuards,
  submitPayload,
  now
) {
  const blockedChecks = previewAcceptance.readiness.checks.filter((check) => !check.ready);
  const validationChips = routePreview.validationSummary.chips;
  const requirements = [
    shapeClientContractRequirement("preview-accepted", "Kernel command accepted preview", result.accepted, {
      audit: result.audit,
      commandId: command.commandId
    }),
    shapeClientContractRequirement("readiness-clear", "Readiness checks are clear", blockedChecks.length === 0, {
      blockedCheckIds: blockedChecks.map((check) => check.checkId),
      blockedAudits: blockedChecks.map((check) => check.audit)
    }),
    shapeClientContractRequirement("validation-valid", "Validation summary can be accepted", previewAcceptance.validationSummary.valid, {
      warningCount: previewAcceptance.validationSummary.warnings.length,
      chipCount: validationChips.length
    }),
    shapeClientContractRequirement("route-preconditions", "Route preconditions match preview", routePreview.acceptance.preconditions.every((entry) => entry.satisfied), {
      preconditions: routePreview.acceptance.preconditions
    }),
    shapeClientContractRequirement("provider-dispatch", "Provider dispatch is ready when required", !externalHandoff.required || providerDispatch.dispatchable, {
      required: externalHandoff.required,
      dispatchId: externalHandoff.required ? providerDispatch.dispatchId : null,
      dispatchState: providerDispatch.state,
      blockedBy: providerDispatch.blockedBy
    }),
    shapeClientContractRequirement("route-handoff-plan", "Route handoff plan is executable", clientState.workflow.routeHandoff.plan.ready || clientState.workflow.routeHandoff.mode === "inline", {
      planId: clientState.workflow.routeHandoff.plan.planId,
      mode: clientState.workflow.routeHandoff.plan.mode,
      actionType: clientState.workflow.routeHandoff.plan.actionType,
      blockers: clientState.workflow.routeHandoff.plan.blockers
    })
  ];

  return {
    schemaVersion: 1,
    generatedAt: now,
    contractId: `${clientRuntime.requestId}:${command.commandId}:acceptance-data-contract`,
    state: readyToSubmit ? "ready" : result.accepted ? "needs-attention" : "blocked",
    previewContract: {
      token: routePreview.acceptance.token,
      commandId: command.commandId,
      commandName: command.name,
      beforeState: previewAcceptance.preview.before.state,
      afterState: previewAcceptance.preview.after.state,
      targetGeneration: previewAcceptance.preview.after.generation,
      generationDelta: previewAcceptance.preview.generationDelta,
      terminalState: previewAcceptance.preview.terminalState,
      stableAfterCommand: previewAcceptance.preview.stableAfterCommand
    },
    acceptanceContract: {
      mode: submitMode,
      readyToSubmit,
      accepted: result.accepted,
      audit: result.audit,
      blockedGuardIds: blockedGuards.map((guard) => guard.guardId),
      requiredPayloadFields: Object.keys(submitPayload).sort(),
      idempotencyScope: [routePreview.acceptance.token, submitMode, previewAcceptance.preview.after.generation].join(":")
    },
    readinessContract: {
      state: previewAcceptance.readiness.state,
      readyCount: previewAcceptance.readiness.readyCount,
      blockedCount: previewAcceptance.readiness.blockedCount,
      requirements
    },
    validationContract: {
      valid: previewAcceptance.validationSummary.valid,
      healthStatus: previewAcceptance.validationSummary.healthStatus,
      chipCount: validationChips.length,
      blockerCount: validationChips.filter((chip) => chip.kind === "blocker").length,
      warningCount: validationChips.filter((chip) => chip.kind === "warning").length,
      healthSignalCount: validationChips.filter((chip) => chip.kind !== "blocker" && chip.kind !== "warning").length,
      firstBlockingAudit: blockedChecks[0]?.audit || null
    },
    routeContract: {
      routeId: clientRuntime.routeId,
      requestId: clientRuntime.requestId,
      workflowState: clientState.workflow.state,
      routeHandoffReady: clientState.workflow.routeHandoff.ready,
      routeHandoffMode: clientState.workflow.routeHandoff.mode,
      routeHandoffPlanId: clientState.workflow.routeHandoff.plan.planId,
      routeHandoffActionType: clientState.workflow.routeHandoff.plan.actionType,
      routeHandoffReplayKey: clientState.workflow.routeHandoff.plan.replay.key,
      routeHandoffBlockers: clientState.workflow.routeHandoff.plan.blockers,
      cacheInvalidationRequired: clientState.workflow.cacheInvalidation.required,
      cacheKeys: clientState.workflow.cacheInvalidation.keys
    },
    nextStepContract: previewAcceptance.nextSteps.map((step, index) =>
      shapeClientNextStepContract(step, index, previewAcceptance, routePreview, externalHandoff)
    )
  };
}

function shapeClientAcceptanceEnvelope(
  clientRuntime,
  previewAcceptance,
  routePreview,
  clientState,
  result,
  command,
  providerDispatch,
  externalHandoff,
  now
) {
  const primaryAction = routePreview.actions.primary;
  const blockedChecks = previewAcceptance.readiness.checks.filter((check) => !check.ready);
  const guards = [
    shapeAcceptanceGuard(
      "preview-accepted",
      "Lifecycle command was accepted by the kernel control plane",
      result.accepted,
      result.audit,
      {
        commandId: command.commandId,
        commandName: command.name
      }
    ),
    shapeAcceptanceGuard(
      "readiness-clear",
      "Preview readiness checks are clear",
      previewAcceptance.readiness.blockedCount === 0,
      previewAcceptance.readiness.state,
      {
        readyCount: previewAcceptance.readiness.readyCount,
        blockedCount: previewAcceptance.readiness.blockedCount,
        firstBlockedCheckId: blockedChecks[0]?.checkId || null
      }
    ),
    shapeAcceptanceGuard(
      "validation-valid",
      "Validation summary is valid",
      previewAcceptance.validationSummary.valid,
      previewAcceptance.validationSummary.valid ? "validation-valid" : "validation-blocked",
      {
        healthStatus: previewAcceptance.validationSummary.healthStatus,
        blockingAudits: previewAcceptance.validationSummary.blockingAudits,
        warningCount: previewAcceptance.validationSummary.warnings.length
      }
    ),
    shapeAcceptanceGuard(
      "route-generation-current",
      "Route is reconciled to the preview generation",
      routePreview.acceptance.preconditions.every((precondition) => precondition.satisfied),
      "route-acceptance-preconditions",
      {
        preconditions: routePreview.acceptance.preconditions
      }
    ),
    shapeAcceptanceGuard(
      "route-handoff-plan-ready",
      "Route handoff plan can be replayed by the client",
      clientState.workflow.routeHandoff.plan.ready || clientState.workflow.routeHandoff.mode === "inline",
      clientState.workflow.routeHandoff.plan.state,
      {
        planId: clientState.workflow.routeHandoff.plan.planId,
        actionType: clientState.workflow.routeHandoff.plan.actionType,
        replayKey: clientState.workflow.routeHandoff.plan.replay.key,
        blockers: clientState.workflow.routeHandoff.plan.blockers
      }
    ),
    shapeAcceptanceGuard(
      "handoff-dispatchable",
      "Provider handoff is dispatchable when required",
      !externalHandoff.required || (clientState.workflow.handoff.supported && providerDispatch.dispatchable),
      externalHandoff.required ? providerDispatch.state : "handoff-not-required",
      {
        required: externalHandoff.required,
        supported: clientState.workflow.handoff.supported,
        dispatchable: providerDispatch.dispatchable,
        blockedBy: providerDispatch.blockedBy
      }
    )
  ];
  const blockedGuards = guards.filter((guard) => !guard.satisfied);
  const readyToSubmit = primaryAction.enabled && blockedGuards.length === 0;
  const submitMode = externalHandoff.required ? "provider-handoff" : result.accepted ? "acknowledge-preview" : "blocked-preview";
  const submitPayload = {
    type: "kernel.lifecycle.preview.acceptance",
    schemaVersion: 1,
    acceptanceToken: routePreview.acceptance.token,
    commandId: command.commandId,
    commandName: command.name,
    routeId: clientRuntime.routeId,
    requestId: clientRuntime.requestId,
    clientId: clientRuntime.clientId,
    sessionId: clientRuntime.sessionId,
    tenantId: externalHandoff.scope.tenantId,
    workspaceId: externalHandoff.scope.workspaceId,
    targetGeneration: previewAcceptance.preview.after.generation,
    targetState: previewAcceptance.preview.after.state,
    expectedTerminalState: externalHandoff.expectedTerminalState,
    correlationId: externalHandoff.correlationId,
    dispatchId: externalHandoff.required ? providerDispatch.dispatchId : null,
    routeHandoffPlanId: clientState.workflow.routeHandoff.plan.planId,
    routeHandoffReplayKey: clientState.workflow.routeHandoff.plan.replay.key,
    routeHandoffActionType: clientState.workflow.routeHandoff.plan.actionType,
    generatedAt: now
  };
  const dataContracts = shapeClientAcceptanceDataContracts(
    clientRuntime,
    previewAcceptance,
    routePreview,
    clientState,
    result,
    command,
    providerDispatch,
    externalHandoff,
    submitMode,
    readyToSubmit,
    blockedGuards,
    submitPayload,
    now
  );

  return {
    schemaVersion: 1,
    generatedAt: now,
    state: readyToSubmit ? "ready" : result.accepted ? "needs-attention" : "blocked",
    submitMode,
    readyToSubmit,
    disabledReason: readyToSubmit
      ? null
      : blockedGuards[0]?.label || primaryAction.disabledReason || "Resolve lifecycle preview blockers before accepting.",
    primaryAction: {
      actionId: primaryAction.actionId,
      label: primaryAction.label,
      method: primaryAction.method,
      eventName: primaryAction.eventName,
      enabled: readyToSubmit,
      acceptanceToken: routePreview.acceptance.token
    },
    guards,
    nextRequest: {
      method: primaryAction.method,
      eventName: primaryAction.eventName,
      payload: submitPayload,
      idempotencyKey: `${routePreview.acceptance.token}:${submitMode}`,
      routeHandoff: routePreview.routeIntegration.routeHandoff,
      routeHandoffPlan: clientState.workflow.routeHandoff.plan
    },
    dataContracts,
    proofRefs: ["client.previewAcceptance", "client.routePreview", "client.acceptanceEnvelope", "auditHandoff"],
    summary: {
      previewStateLine: routePreview.presentation.stateLine,
      generationLine: routePreview.presentation.generationLine,
      validationChipCount: routePreview.validationSummary.chipCount,
      nextStepCount: routePreview.nextStepCards.length,
      firstNextStepType: routePreview.nextStepCards[0]?.type || null
    }
  };
}

function shapeClientRoutePreviewContract(
  clientRuntime,
  previewAcceptance,
  clientState,
  result,
  command,
  providerSync,
  externalHandoff,
  providerDispatch,
  operationalHealth,
  now
) {
  const blockedChecks = previewAcceptance.readiness.checks.filter((check) => !check.ready);
  const warningChips = previewAcceptance.validationSummary.warnings.map((warning) =>
    shapeRouteValidationChip("warning", warning.code, warning.message, warning)
  );
  const blockerChips = blockedChecks.map((check) =>
    shapeRouteValidationChip("blocker", check.audit, check.label, {
      checkId: check.checkId,
      status: check.status
    })
  );
  const healthChips = operationalHealth.errors.map((error) =>
    shapeRouteValidationChip(error.severity, error.code, error.message, {
      audit: error.audit,
      retryable: error.retryable,
      action: error.action
    })
  );
  const acceptanceTokenParts = [
    clientRuntime.routeId,
    clientRuntime.requestId,
    command.commandId,
    previewAcceptance.preview.before.generation,
    previewAcceptance.preview.after.generation,
    previewAcceptance.preview.after.state,
    externalHandoff.correlationId || "no-handoff"
  ];
  const acceptanceToken = acceptanceTokenParts.map((part) => String(part).replaceAll(":", "_")).join(":");
  const canAcceptPreview =
    result.accepted &&
    previewAcceptance.readiness.blockedCount === 0 &&
    previewAcceptance.validationSummary.valid;
  const primaryAction = externalHandoff.required
    ? shapeRouteAction(
        "accept-provider-handoff",
        `Accept handoff for ${externalHandoff.expectedTerminalState}`,
        canAcceptPreview && clientState.workflow.handoff.supported,
        clientState.workflow.handoff.supported
          ? "Resolve preview blockers before accepting provider handoff."
          : "This client session does not support the provider handoff channel.",
        {
          method: "POST",
          eventName: "kernel.lifecycle.preview.accept",
          acceptanceToken,
          correlationId: externalHandoff.correlationId,
          expectedTerminalState: externalHandoff.expectedTerminalState,
          dispatchId: providerDispatch.dispatchId,
          dispatchable: providerDispatch.dispatchable,
          dispatchEndpoint: providerDispatch.transport.endpoint
        }
      )
    : shapeRouteAction(
        "accept-preview",
        result.accepted ? "Acknowledge lifecycle preview" : "Resolve lifecycle blocker",
        canAcceptPreview,
        blockedChecks[0]?.label || "Resolve validation blockers before acknowledging this preview.",
        {
          method: result.accepted ? "POST" : "GET",
          eventName: result.accepted ? "kernel.lifecycle.preview.acknowledge" : "kernel.lifecycle.preview.blocked",
          acceptanceToken
        }
      );
  const secondaryActions = [
    shapeRouteAction("refresh-state", "Refresh state", true, null, {
      method: "GET",
      eventName: "kernel.lifecycle.state.refresh",
      targetGeneration: previewAcceptance.preview.after.generation,
      cacheKeys: clientState.workflow.cacheInvalidation.keys
    }),
    shapeRouteAction("copy-proof", "Copy proof", true, null, {
      method: "CLIENT",
      eventName: "kernel.lifecycle.proof.copy",
      proofRefs: ["auditHandoff", "proof", "client.previewAcceptance"]
    })
  ];

  if (clientState.workflow.routeHandoff.mode !== "inline") {
    secondaryActions.push(
      shapeRouteAction("complete-route-handoff", "Continue workflow", clientState.workflow.routeHandoff.ready, "Route handoff is not ready.", {
        method: clientState.workflow.routeHandoff.mode === "navigate" ? "NAVIGATE" : "CLIENT",
        eventName: clientState.workflow.routeHandoff.eventName,
        targetRouteId: clientState.workflow.routeHandoff.targetRouteId,
        replaceHistory: clientState.workflow.routeHandoff.replaceHistory,
        preserveQuery: clientState.workflow.routeHandoff.preserveQuery,
        planId: clientState.workflow.routeHandoff.plan.planId,
        replayKey: clientState.workflow.routeHandoff.plan.replay.key,
        blockers: clientState.workflow.routeHandoff.plan.blockers,
        payload: clientState.workflow.routeHandoff.payload
      })
    );
  }

  if (operationalHealth.retry.state.nextRetryAt) {
    secondaryActions.push(
      shapeRouteAction("schedule-retry", "Schedule retry", true, null, {
        method: "POST",
        eventName: "kernel.lifecycle.retry.schedule",
        retryAt: operationalHealth.retry.state.nextRetryAt,
        retryAdvice: operationalHealth.retry.advice
      })
    );
  }

  return {
    schemaVersion: 1,
    generatedAt: now,
    routeId: clientRuntime.routeId,
    requestId: clientRuntime.requestId,
    presentation: {
      tone: result.accepted ? (externalHandoff.required ? "progress" : "success") : "error",
      title: result.accepted
        ? `Preview ${command.name} transition`
        : `Cannot ${command.name} hosted kernel`,
      subtitle: previewAcceptance.acceptance.headline,
      stateLine: `${previewAcceptance.preview.before.state} -> ${previewAcceptance.preview.after.state}`,
      generationLine: `generation ${previewAcceptance.preview.before.generation} -> ${previewAcceptance.preview.after.generation}`
    },
    acceptance: {
      token: acceptanceToken,
      canAccept: canAcceptPreview,
      accepted: result.accepted,
      audit: result.audit,
      preconditions: [
        {
          key: "commandId",
          expected: command.commandId,
          actual: previewAcceptance.command.commandId,
          satisfied: command.commandId === previewAcceptance.command.commandId
        },
        {
          key: "targetGeneration",
          expected: previewAcceptance.preview.after.generation,
          actual: clientState.runtime.observedGeneration,
          satisfied: clientState.runtime.observedGeneration === previewAcceptance.preview.after.generation
        },
        {
          key: "handoffCorrelationId",
          expected: externalHandoff.required ? externalHandoff.correlationId : null,
          actual: externalHandoff.correlationId,
          satisfied: !externalHandoff.required || Boolean(externalHandoff.correlationId)
        }
      ]
    },
    readinessSummary: {
      state: previewAcceptance.readiness.state,
      readyCount: previewAcceptance.readiness.readyCount,
      blockedCount: previewAcceptance.readiness.blockedCount,
      firstBlockedCheckId: blockedChecks[0]?.checkId || null,
      firstBlockedAudit: blockedChecks[0]?.audit || null
    },
    validationSummary: {
      valid: previewAcceptance.validationSummary.valid,
      healthStatus: previewAcceptance.validationSummary.healthStatus,
      chipCount: blockerChips.length + warningChips.length + healthChips.length,
      chips: [...blockerChips, ...warningChips, ...healthChips]
    },
    actions: {
      primary: primaryAction,
      secondary: secondaryActions
    },
    nextStepCards: previewAcceptance.nextSteps.map((step, index) => ({
      cardId: `${index + 1}:${step.stepId}`,
      title: step.label,
      type: step.type,
      audit: step.audit || result.audit,
      enabled: result.accepted || step.type === "operator-remediation",
      retryAt: step.retryAt || null,
      command: step.command || command.name,
      correlationId: step.correlationId || externalHandoff.correlationId || null,
      expectedTerminalState: step.expectedTerminalState || externalHandoff.expectedTerminalState || null
    })),
    routeIntegration: {
      cacheInvalidation: clientState.workflow.cacheInvalidation,
      workflowState: clientState.workflow.state,
      routeHandoff: {
        mode: clientState.workflow.routeHandoff.mode,
        ready: clientState.workflow.routeHandoff.ready,
        state: clientState.workflow.routeHandoff.state,
        targetRouteId: clientState.workflow.routeHandoff.targetRouteId,
        eventName: clientState.workflow.routeHandoff.eventName,
        replaceHistory: clientState.workflow.routeHandoff.replaceHistory,
        preserveQuery: clientState.workflow.routeHandoff.preserveQuery,
        plan: clientState.workflow.routeHandoff.plan,
        payload: clientState.workflow.routeHandoff.payload,
        validationErrors: clientState.workflow.routeHandoff.validationErrors
      },
      syncCursor: providerSync.cursor,
      syncFreshness: providerSync.freshness,
      stale: clientState.runtime.stale,
      eventNamespace: "kernel.lifecycle",
      proofRefs: ["client.routePreview", "client.previewAcceptance", "auditHandoff"]
    }
  };
}

function shapePersistenceRecoveryPlan(persisted, rawState, recoveredState, now) {
  const persistedActiveCommandId = normalizeIdentifier(persisted.activeCommandId, null);
  const persistedGeneration = normalizeGeneration(persisted.generation);
  const recoveredFrom = RESTART_RECOVERY.has(rawState) ? rawState : null;
  const stableAfterRecovery = RESTART_SAFE_STATES.has(recoveredState);
  const orphanedActiveCommand =
    Boolean(persistedActiveCommandId) &&
    (stableAfterRecovery || recoveredFrom !== null);
  const applied = recoveredFrom !== null || orphanedActiveCommand;
  const recoveredGeneration = applied ? persistedGeneration + 1 : persistedGeneration;
  const recoveryCommandId = applied
    ? [
        "restart",
        "recovery",
        recoveredFrom || recoveredState,
        recoveredGeneration,
        orphanedActiveCommand ? "orphaned-command" : "interrupted-transition"
      ].join(":")
    : null;
  const recoveryAudit = recoveredFrom
    ? "restart-recovered-interrupted-transition"
    : orphanedActiveCommand
      ? "restart-cleared-orphaned-active-command"
      : stableAfterRecovery
        ? "restart-state-stable"
        : "restart-state-observed";

  return {
    schemaVersion: 1,
    audit: recoveryAudit,
    required: applied,
    applied,
    persistedState: rawState,
    recoveredState,
    recoveredFrom,
    persistedGeneration,
    recoveredGeneration,
    generationAdvanced: recoveredGeneration !== persistedGeneration,
    reason: recoveredFrom
      ? RESTART_RECOVERY_REASONS.get(recoveredFrom)
      : orphanedActiveCommand
        ? "Persisted state was stable but still referenced an active command; command ownership was cleared for restart safety."
        : "Persisted state can be resumed without lifecycle recovery.",
    restartSafe: stableAfterRecovery,
    status: stableAfterRecovery ? "stable" : "requires-operator-review",
    activeCommandId: orphanedActiveCommand ? null : persistedActiveCommandId,
    orphanedActiveCommandId: orphanedActiveCommand ? persistedActiveCommandId : null,
    recoveryCommandId,
    checkpoint: {
      type: "kernel.lifecycle.persistence.checkpoint",
      schemaVersion: 1,
      surfaceId,
      state: recoveredState,
      persistedState: rawState,
      recoveredFrom,
      restartSafe: stableAfterRecovery,
      generation: recoveredGeneration,
      previousGeneration: persistedGeneration,
      activeCommandId: orphanedActiveCommand ? null : persistedActiveCommandId,
      orphanedActiveCommandId: orphanedActiveCommand ? persistedActiveCommandId : null,
      recoveryCommandId,
      recoveredAt: applied ? now : null
    }
  };
}

function appendRecoveryHistory(history, recoveryPlan, now) {
  const normalizedHistory = normalizeHistory(history);
  if (!recoveryPlan.applied) return normalizedHistory;

  return normalizedHistory.concat(normalizeTransitionRecord({
    commandId: recoveryPlan.recoveryCommandId,
    command: "restart:recovery",
    from: recoveryPlan.persistedState,
    to: recoveryPlan.recoveredState,
    outcome: "recovered",
    audit: recoveryPlan.audit,
    terminalState: recoveryPlan.recoveredState,
    generation: recoveryPlan.recoveredGeneration,
    restartSafe: recoveryPlan.restartSafe,
    replayable: true,
    completed: true,
    at: now
  })).slice(-12);
}

function appendRecoveryCommandLedger(commandLedger, recoveryPlan, now) {
  const ledger = normalizeCommandLedger(commandLedger);
  if (!recoveryPlan.applied) return ledger;

  const withoutRecovery = ledger.filter(
    (entry) => !(entry.commandId === recoveryPlan.recoveryCommandId && entry.command === "status")
  );

  return withoutRecovery.concat({
    commandId: recoveryPlan.recoveryCommandId,
    command: "status",
    outcome: "observed",
    audit: recoveryPlan.audit,
    state: recoveryPlan.recoveredState,
    generation: recoveryPlan.recoveredGeneration,
    failureReason: null,
    boundaryAudit: null,
    restartSafe: recoveryPlan.restartSafe,
    replayable: true,
    completed: true,
    at: now
  }).slice(-20);
}

function shapeRestartStatusSemantics(recoveryPlan, state, generation, now) {
  const recoveryPendingWrite = recoveryPlan.applied && recoveryPlan.generationAdvanced;
  const transitionInFlight = DEGRADED_STATES.has(state);
  const safeForStatus = recoveryPlan.restartSafe && !transitionInFlight;
  const stateChangeGate = recoveryPendingWrite
    ? "recovery-checkpoint-pending"
    : transitionInFlight
      ? "transition-in-flight"
      : safeForStatus
        ? "open"
        : "operator-review-required";

  return {
    schemaVersion: 1,
    generatedAt: now,
    state,
    generation,
    visibleState: recoveryPlan.recoveredState,
    persistedState: recoveryPlan.persistedState,
    safeForStatus,
    safeForStateChange: stateChangeGate === "open",
    restartSafe: recoveryPlan.restartSafe,
    checkpointRequired: recoveryPendingWrite,
    stateChangeGate,
    audit: recoveryPlan.audit,
    recoveryCommandId: recoveryPlan.recoveryCommandId,
    recoveredFrom: recoveryPlan.recoveredFrom,
    orphanedActiveCommandId: recoveryPlan.orphanedActiveCommandId,
    operatorAction: recoveryPendingWrite
      ? "Persist the restart recovery checkpoint before accepting another state-changing hosted-kernel command."
      : transitionInFlight
        ? "Wait for the active transition to reach a terminal state or fail it explicitly."
        : safeForStatus
          ? "Status can be served from the recovered hosted-kernel lifecycle state."
          : "Review the persisted hosted-kernel lifecycle state before accepting commands."
  };
}

function shapePersistedState(persistedState = {}, now) {
  const persisted = asObject(persistedState);
  const rawState = normalizeState(persisted.state);
  const recoveredFrom = RESTART_RECOVERY.has(rawState) ? rawState : null;
  const state = recoveredFrom ? RESTART_RECOVERY.get(rawState) : rawState;
  const scope = normalizeScope({}, persisted);
  const recovery = shapePersistenceRecoveryPlan(persisted, rawState, state, now);

  return {
    schemaVersion: 1,
    surfaceId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    state,
    persistedState: rawState,
    recoveredFrom,
    restartSafe: recovery.restartSafe,
    generation: recovery.recoveredGeneration,
    activeCommandId: recovery.activeCommandId,
    lastStableAt: typeof persisted.lastStableAt === "string" ? persisted.lastStableAt : now,
    updatedAt: recovery.applied ? now : typeof persisted.updatedAt === "string" ? persisted.updatedAt : now,
    history: appendRecoveryHistory(persisted.history, recovery, now),
    healthErrors: normalizeHealthErrors(persisted.healthErrors),
    commandLedger: appendRecoveryCommandLedger(persisted.commandLedger, recovery, now),
    retry: normalizeRetryState(persisted.retry),
    recovery,
    restartStatus: shapeRestartStatusSemantics(recovery, state, recovery.recoveredGeneration, now)
  };
}

function shapeProviderAcknowledgementCandidateState(persistedState, recoveredState, providerAck, now) {
  const persisted = asObject(persistedState);
  const rawState = normalizeState(persisted.state);
  const persistedActiveCommandId = normalizeIdentifier(persisted.activeCommandId, null);
  const ackCommandId = normalizeIdentifier(providerAck.commandId, null);
  const canEvaluateInterruptedTransition =
    DEGRADED_STATES.has(rawState) &&
    Boolean(persistedActiveCommandId) &&
    persistedActiveCommandId === ackCommandId;

  if (!canEvaluateInterruptedTransition) return recoveredState;

  return {
    ...recoveredState,
    state: rawState,
    persistedState: rawState,
    recoveredFrom: null,
    generation: normalizeGeneration(persisted.generation),
    restartSafe: false,
    activeCommandId: persistedActiveCommandId,
    updatedAt: typeof persisted.updatedAt === "string" ? persisted.updatedAt : now,
    lastStableAt: typeof persisted.lastStableAt === "string" ? persisted.lastStableAt : recoveredState.lastStableAt,
    history: normalizeHistory(persisted.history),
    commandLedger: normalizeCommandLedger(persisted.commandLedger),
    recovery: {
      ...recoveredState.recovery,
      audit: "provider-ack-recovery-deferred",
      required: false,
      applied: false,
      reason: "Persisted hosted-kernel transition has a matching provider acknowledgement candidate; defer restart recovery until acknowledgement validation completes.",
      restartSafe: false,
      status: "awaiting-provider-ack-validation",
      activeCommandId: persistedActiveCommandId,
      orphanedActiveCommandId: null,
      checkpoint: {
        ...recoveredState.recovery?.checkpoint,
        state: rawState,
        activeCommandId: persistedActiveCommandId,
        orphanedActiveCommandId: null,
        recoveredAt: null
      }
    },
    restartStatus: {
      schemaVersion: 1,
      generatedAt: now,
      state: rawState,
      generation: normalizeGeneration(persisted.generation),
      visibleState: rawState,
      persistedState: rawState,
      safeForStatus: true,
      safeForStateChange: false,
      restartSafe: false,
      checkpointRequired: false,
      stateChangeGate: "awaiting-provider-ack-validation",
      audit: "provider-ack-recovery-deferred",
      recoveryCommandId: null,
      recoveredFrom: null,
      orphanedActiveCommandId: null,
      operatorAction: "Validate the matching provider acknowledgement before applying restart recovery or accepting another state-changing command."
    }
  };
}

function normalizeCommand(input) {
  const command = asObject(input.command);
  const name = typeof command.name === "string" ? command.name.trim().toLowerCase() : "status";
  const commandTenantId = normalizeIdentifier(command.tenantId, null);
  const commandWorkspaceId = normalizeIdentifier(command.workspaceId, null);
  const inputTenantId = normalizeIdentifier(input.tenantId, null);
  const inputWorkspaceId = normalizeIdentifier(input.workspaceId, null);
  const commandId =
    typeof command.commandId === "string" && command.commandId.trim()
      ? command.commandId.trim()
      : `${name}:anonymous`;

  return {
    name,
    commandId,
    complete: command.complete === true,
    reason: typeof command.reason === "string" ? command.reason : null,
    tenantId: normalizeIdentifier(commandTenantId, inputTenantId),
    workspaceId: normalizeIdentifier(commandWorkspaceId, inputWorkspaceId),
    scopeSource: {
      tenant: commandTenantId ? "command" : inputTenantId ? "request" : "persisted",
      workspace: commandWorkspaceId ? "command" : inputWorkspaceId ? "request" : "persisted"
    },
    explicitTenantScope: Boolean(commandTenantId || inputTenantId),
    explicitWorkspaceScope: Boolean(commandWorkspaceId || inputWorkspaceId)
  };
}

function shapeBoundaryPolicy(command, actorScope, scope, settings) {
  const stateChanging = STATE_CHANGING_COMMANDS.includes(command.name);
  const requiresActorScope = stateChanging && settings.requireScopedActorForStateChanges;
  const requiresExplicitScope = stateChanging && settings.requireExplicitScopeForStateChanges;
  const actorTenantScoped = !requiresActorScope || actorScope.tenantBound;
  const actorWorkspaceScoped = !requiresActorScope || actorScope.workspaceBound;
  const explicitTenantScoped = !requiresExplicitScope || command.explicitTenantScope;
  const explicitWorkspaceScoped = !requiresExplicitScope || command.explicitWorkspaceScope;
  const accepted = actorTenantScoped && actorWorkspaceScoped && explicitTenantScoped && explicitWorkspaceScoped;
  const audit = !actorTenantScoped || !actorWorkspaceScoped
    ? "command-rejected-unscoped-actor"
    : !explicitTenantScoped || !explicitWorkspaceScoped
      ? "command-rejected-explicit-scope-required"
      : "boundary-policy-accepted";

  return {
    accepted,
    audit,
    stateChanging,
    requiresActorScope,
    requiresExplicitScope,
    actorTenantScoped,
    actorWorkspaceScoped,
    explicitTenantScoped,
    explicitWorkspaceScoped,
    tenantScopeSource: command.scopeSource.tenant,
    workspaceScopeSource: command.scopeSource.workspace,
    resolvedTenantId: scope.resolvedTenantId,
    resolvedWorkspaceId: scope.resolvedWorkspaceId
  };
}

function commandBoundary(stateContract, command, actor, requestedScope, settings) {
  const requiredPermission = COMMAND_PERMISSIONS.get(command.name);
  const tenantMatched = requestedScope.tenantMatched && (!command.tenantId || command.tenantId === stateContract.tenantId);
  const workspaceMatched =
    requestedScope.workspaceMatched && (!command.workspaceId || command.workspaceId === stateContract.workspaceId);
  const actorScope = actorScopeDecision(actor, stateContract.tenantId, stateContract.workspaceId);
  const requested = {
    tenantId: command.tenantId || requestedScope.requestedTenantId,
    workspaceId: command.workspaceId || requestedScope.requestedWorkspaceId
  };
  const scope = {
    tenantMatched,
    workspaceMatched,
    actorTenantMatched: actorScope.tenantMatched,
    actorWorkspaceMatched: actorScope.workspaceMatched,
    requestedTenantId: requested.tenantId,
    requestedWorkspaceId: requested.workspaceId,
    resolvedTenantId: stateContract.tenantId,
    resolvedWorkspaceId: stateContract.workspaceId,
    actorTenantBound: actorScope.tenantBound,
    actorWorkspaceBound: actorScope.workspaceBound,
    matchedActorScopedTenant: actorScope.matchedScopedTenant
  };
  const policy = shapeBoundaryPolicy(command, actorScope, scope, settings);

  if (!tenantMatched || !workspaceMatched) {
    return {
      accepted: false,
      audit: "command-rejected-scope",
      requiredPermission,
      scope,
      policy
    };
  }

  if (!actorScope.accepted) {
    return {
      accepted: false,
      audit: "command-rejected-actor-scope",
      requiredPermission,
      scope,
      policy
    };
  }

  if (!policy.accepted) {
    return {
      accepted: false,
      audit: policy.audit,
      requiredPermission,
      scope,
      policy
    };
  }

  if (requiredPermission && !actor.permissions.includes(requiredPermission)) {
    return {
      accepted: false,
      audit: "command-rejected-permission",
      requiredPermission,
      scope,
      policy
    };
  }

  return {
    accepted: true,
    audit: "boundary-accepted",
    requiredPermission,
    scope,
    policy
  };
}

function commandControlDecision(settings, command) {
  if (command.name === "status") {
    return { accepted: true, audit: "controls-accepted", activeWindow: null };
  }

  const commandAllowed = settings.allowedCommands.includes(command.name) && !settings.disabledCommands.includes(command.name);
  const commandRequiresReason = settings.requireReasonFor.includes(command.name);
  const scheduleWindows = settings.scheduleWindows.filter((window) => window.commands.includes(command.name));
  const activeWindow = scheduleWindows.find((window) => window.active) || null;

  if (!settings.lifecycleEnabled) {
    return { accepted: false, audit: "command-rejected-disabled", activeWindow };
  }

  if (settings.maintenanceMode && !EMERGENCY_COMMANDS.has(command.name)) {
    return { accepted: false, audit: "command-rejected-maintenance", activeWindow };
  }

  if (!settings.validation.valid) {
    return { accepted: false, audit: "command-rejected-settings", activeWindow };
  }

  if (!commandAllowed) {
    return { accepted: false, audit: "command-rejected-settings", activeWindow };
  }

  if (commandRequiresReason && !command.reason) {
    return { accepted: false, audit: "command-rejected-reason", activeWindow };
  }

  if (scheduleWindows.length > 0 && !activeWindow) {
    return { accepted: false, audit: "command-rejected-schedule", activeWindow };
  }

  return { accepted: true, audit: "controls-accepted", activeWindow };
}

function shapeLifecycleControlMatrix(settings, stateContract, command, now) {
  const rows = ANALYTICS_COMMANDS.map((candidate) => {
    const transition = TRANSITIONS.get(candidate) || null;
    const stateChanging = STATE_CHANGING_COMMANDS.includes(candidate);
    const restartStateChangeAllowed = !stateChanging || stateContract.restartStatus?.safeForStateChange !== false;
    const retryNextEpoch = parseEpoch(stateContract.retry?.nextRetryAt);
    const nowEpoch = parseEpoch(now);
    const retryBackoffActive =
      stateChanging &&
      !EMERGENCY_COMMANDS.has(candidate) &&
      retryNextEpoch !== null &&
      nowEpoch !== null &&
      retryNextEpoch > nowEpoch;
    const commandAllowed = candidate === "status" || settings.allowedCommands.includes(candidate);
    const disabled = settings.disabledCommands.includes(candidate);
    const reasonRequired = settings.requireReasonFor.includes(candidate);
    const scheduleWindows = settings.scheduleWindows.filter((window) => window.commands.includes(candidate));
    const activeWindow = scheduleWindows.find((window) => window.active) || null;
    const transitionAllowed = candidate === "status" || Boolean(transition?.from.includes(stateContract.state));
    const lifecycleEnabled = candidate === "status" || settings.lifecycleEnabled;
    const maintenanceAllowed = !settings.maintenanceMode || EMERGENCY_COMMANDS.has(candidate);
    const settingsValid = candidate === "status" || settings.validation.valid;
    const enabled =
      lifecycleEnabled &&
      maintenanceAllowed &&
      settingsValid &&
      commandAllowed &&
      !disabled &&
      (scheduleWindows.length === 0 || Boolean(activeWindow)) &&
      transitionAllowed &&
      restartStateChangeAllowed &&
      !retryBackoffActive;
    const blockers = [];

    if (!lifecycleEnabled) blockers.push("lifecycle-disabled");
    if (!maintenanceAllowed) blockers.push("maintenance-mode");
    if (!settingsValid) blockers.push("settings-invalid");
    if (!commandAllowed) blockers.push("command-not-allowed");
    if (disabled) blockers.push("command-disabled");
    if (scheduleWindows.length > 0 && !activeWindow) blockers.push("schedule-window-closed");
    if (!transitionAllowed) blockers.push("state-transition-unavailable");
    if (!restartStateChangeAllowed) blockers.push(stateContract.restartStatus.stateChangeGate);
    if (retryBackoffActive) blockers.push("retry-backoff-active");
    if (reasonRequired && candidate === command.name && !command.reason) blockers.push("reason-required");

    return {
      command: candidate,
      stateChanging,
      enabled,
      blockers,
      reasonRequired,
      transitionAllowed,
      restartStateChangeAllowed,
      restartGate: stateContract.restartStatus?.stateChangeGate || "open",
      retryGate: retryBackoffActive ? "backoff-active" : "open",
      retryNextAt: retryBackoffActive ? stateContract.retry.nextRetryAt : null,
      nextState: transition?.to || stateContract.state,
      terminalState: transition?.terminal || stateContract.state,
      activeWindowId: activeWindow?.windowId || null,
      scheduleWindowCount: scheduleWindows.length
    };
  });
  const enabledCommands = rows.filter((row) => row.enabled).map((row) => row.command);
  const requested = rows.find((row) => row.command === command.name) || null;

  return {
    schemaVersion: 1,
    generatedForState: stateContract.state,
    requestedCommand: command.name,
    requestedCommandEnabled: requested?.enabled === true,
    enabledCommands,
    blockedCommands: rows.filter((row) => !row.enabled).map((row) => row.command),
    nextStateChangingCommand: rows.find((row) => row.enabled && row.stateChanging)?.command || null,
    rows
  };
}

function shapeLedgerReplayResult(stateContract, command, boundary, controls, retryGate, replay) {
  const replayDecision = shapeReplayDecision(stateContract, replay);
  const accepted = replayDecision.accepted;

  return {
    accepted,
    idempotent: true,
    replayed: true,
    replay,
    replayDecision,
    state: stateContract,
    audit: accepted ? "command-replayed-from-ledger" : replayDecision.audit,
    boundary,
    controls,
    retryGate,
    healthGate: summarizeHealthGate(stateContract, command)
  };
}

function shapeCommandLedgerEntry(result, command, now) {
  const outcome = result.idempotent
    ? command.name === "status"
      ? "observed"
      : "idempotent"
    : result.accepted
      ? "accepted"
      : "rejected";

  return {
    commandId: command.commandId,
    command: command.name,
    outcome,
    audit: result.audit,
    state: result.state.state,
    generation: result.state.generation,
    failureReason: result.accepted ? null : normalizeFailureReason(null, result.audit),
    boundaryAudit: shapeBoundaryAudit(result.boundary),
    restartSafe: result.state.restartSafe,
    replayable: result.accepted || result.idempotent,
    completed: TERMINAL_STATES.has(result.state.state),
    at: now
  };
}

function mergeCommandLedger(commandLedger, result, command, now) {
  const entry = shapeCommandLedgerEntry(result, command, now);
  const withoutCurrent = normalizeCommandLedger(commandLedger).filter(
    (item) => !(item.commandId === command.commandId && item.command === command.name)
  );

  return withoutCurrent.concat(entry).slice(-20);
}

function applyCommand(stateContract, command, now, actor, requestedScope, settings, providerNegotiation, retryPolicy) {
  const boundary = commandBoundary(stateContract, command, actor, requestedScope, settings);
  const healthGate = summarizeHealthGate(stateContract, command);
  const retryGate = shapeRetryGate(stateContract, command, now, retryPolicy);
  if (!boundary.accepted) {
    return {
      accepted: false,
      idempotent: false,
      replayed: false,
      replay: null,
      state: stateContract,
      audit: boundary.audit,
      boundary,
      controls: { accepted: true, audit: "not-evaluated", activeWindow: null },
      retryGate,
      healthGate
    };
  }

  if (command.name === "status") {
    return {
      accepted: true,
      idempotent: true,
      replayed: false,
      replay: null,
      state: stateContract,
      audit: "status-observed",
      boundary,
      controls: commandControlDecision(settings, command),
      retryGate,
      healthGate
    };
  }

  const transition = TRANSITIONS.get(command.name);
  if (!transition) {
    return {
      accepted: false,
      idempotent: false,
      replayed: false,
      replay: null,
      state: stateContract,
      audit: "command-rejected-unknown",
      boundary,
      controls: { accepted: true, audit: "not-evaluated", activeWindow: null },
      retryGate,
      healthGate
    };
  }

  if (stateContract.restartStatus?.safeForStateChange === false) {
    return {
      accepted: false,
      idempotent: false,
      replayed: false,
      replay: null,
      state: stateContract,
      audit: "command-rejected-recovery-pending",
      boundary,
      controls: {
        accepted: false,
        audit: "command-rejected-recovery-pending",
        activeWindow: null,
        restartGate: stateContract.restartStatus.stateChangeGate
      },
      retryGate,
      healthGate
    };
  }

  const controls = commandControlDecision(settings, command);
  if (!controls.accepted) {
    return {
      accepted: false,
      idempotent: false,
      replayed: false,
      replay: null,
      state: stateContract,
      audit: controls.audit,
      boundary,
      controls,
      retryGate,
      healthGate
    };
  }

  if (!retryGate.accepted) {
    return {
      accepted: false,
      idempotent: false,
      replayed: false,
      replay: null,
      state: stateContract,
      audit: retryGate.audit,
      boundary,
      controls,
      retryGate,
      healthGate
    };
  }

  if (!healthGate.accepted) {
    return {
      accepted: false,
      idempotent: false,
      replayed: false,
      replay: null,
      state: stateContract,
      audit: healthGate.audit,
      boundary,
      controls,
      retryGate,
      healthGate
    };
  }

  if (!providerNegotiation.accepted) {
    return {
      accepted: false,
      idempotent: false,
      replayed: false,
      replay: null,
      state: stateContract,
      audit: providerNegotiation.audit,
      boundary,
      controls,
      retryGate,
      healthGate
    };
  }

  if (stateContract.activeCommandId === command.commandId) {
    return {
      accepted: true,
      idempotent: true,
      replayed: true,
      replay: {
        commandId: command.commandId,
        command: command.name,
        outcome: "idempotent",
        audit: "command-replayed",
        state: stateContract.state,
        generation: stateContract.generation,
        boundaryAudit: shapeBoundaryAudit(boundary),
        restartSafe: stateContract.restartSafe,
        replayable: true,
        completed: TERMINAL_STATES.has(stateContract.state),
        at: stateContract.updatedAt
      },
      state: stateContract,
      audit: "command-replayed",
      boundary,
      controls,
      retryGate,
      healthGate
    };
  }

  const persistedReplay = findPersistedCommandReplay(stateContract.commandLedger, command);
  if (persistedReplay) {
    return shapeLedgerReplayResult(stateContract, command, boundary, controls, retryGate, persistedReplay);
  }

  if (!transition.from.includes(stateContract.state)) {
    return {
      accepted: false,
      idempotent: false,
      replayed: false,
      replay: null,
      state: stateContract,
      audit: "command-rejected-state",
      boundary,
      controls,
      retryGate,
      healthGate
    };
  }

  const to = command.complete ? transition.terminal : transition.to;
  const nextGeneration = stateContract.generation + 1;
  const transitionAudit = command.complete ? "transition-completed" : "transition-started";
  const nextHistory = mergeTransitionHistory(
    stateContract.history,
    shapeTransitionRecord({
      command,
      from: stateContract.state,
      to,
      generation: nextGeneration,
      outcome: "accepted",
      audit: transitionAudit,
      at: now,
      replayable: true,
      boundary
    })
  );

  return {
    accepted: true,
    idempotent: false,
    replayed: false,
    replay: null,
    state: {
      ...stateContract,
      state: to,
      restartSafe: TERMINAL_STATES.has(to),
      generation: nextGeneration,
      activeCommandId: command.complete ? null : command.commandId,
      lastStableAt: TERMINAL_STATES.has(to) ? now : stateContract.lastStableAt,
      updatedAt: now,
      history: nextHistory
    },
    audit: transitionAudit,
    boundary,
    controls,
    retryGate,
    healthGate
  };
}

function transitionRecordAlreadyCaptured(history, command, audit) {
  const matches = normalizeHistory(history)
    .filter((entry) => entry.commandId === command.commandId && entry.command === command.name);
  const latest = matches[matches.length - 1] || null;

  return latest?.audit === audit;
}

function appendCommandDecisionRecord(stateContract, result, command, now) {
  if (command.name === "status" || transitionRecordAlreadyCaptured(result.state.history, command, result.audit)) {
    return result;
  }

  const failureReason = result.accepted ? null : normalizeFailureReason(null, result.audit);
  const decisionRecord = shapeTransitionRecord({
    command,
    from: stateContract.state,
    to: result.state.state,
    generation: result.state.generation,
    outcome: result.idempotent ? "idempotent" : result.accepted ? "accepted" : "rejected",
    audit: result.audit,
    at: now,
    failureReason,
    replayable: result.accepted || result.idempotent,
    boundary: result.boundary
  });

  return {
    ...result,
    state: {
      ...result.state,
      updatedAt: result.accepted ? result.state.updatedAt : now,
      history: mergeTransitionHistory(result.state.history, decisionRecord)
    }
  };
}

function actionableErrorFor(result, command, now) {
  const template = ACTIONABLE_ERRORS.get(result.audit);
  if (!template) return null;

  return {
    ...template,
    command: command.name,
    commandId: command.commandId,
    at: now
  };
}

function addDelay(now, delayMs) {
  const epochMs = Date.parse(now);
  if (!Number.isFinite(epochMs)) return null;
  return new Date(epochMs + delayMs).toISOString();
}

function shapeRetryGate(stateContract, command, now, retryPolicy) {
  const retryState = normalizeRetryState(stateContract.retry);
  const stateChanging = STATE_CHANGING_COMMANDS.includes(command.name);
  const emergencyAllowed = EMERGENCY_COMMANDS.has(command.name);
  const nextRetryEpoch = parseEpoch(retryState.nextRetryAt);
  const nowEpoch = parseEpoch(now);
  const backoffActive =
    stateChanging &&
    !emergencyAllowed &&
    nextRetryEpoch !== null &&
    nowEpoch !== null &&
    nextRetryEpoch > nowEpoch;
  const retryBudgetExhausted =
    stateChanging &&
    !emergencyAllowed &&
    retryState.attempts >= retryPolicy.maxAttempts &&
    Boolean(retryState.lastErrorCode) &&
    !backoffActive;
  const audit = backoffActive
    ? "command-rejected-retry-backoff"
    : retryBudgetExhausted
      ? "command-rejected-retry-exhausted"
      : "retry-gate-accepted";

  return {
    schemaVersion: 1,
    accepted: audit === "retry-gate-accepted",
    audit,
    stateChanging,
    emergencyAllowed,
    attempts: retryState.attempts,
    maxAttempts: retryPolicy.maxAttempts,
    lastErrorCode: retryState.lastErrorCode,
    lastAttemptAt: retryState.lastAttemptAt,
    nextRetryAt: retryState.nextRetryAt,
    backoffActive,
    retryBudgetExhausted,
    retryAfterMs: backoffActive && nextRetryEpoch !== null && nowEpoch !== null ? nextRetryEpoch - nowEpoch : null,
    allowedCommands: backoffActive || retryBudgetExhausted
      ? ["status", "stop", "fail"]
      : ["boot", "pause", "resume", "stop", "fail", "status"]
  };
}

function shapeRetryContract(stateContract, result, command, now, retryPolicy, actionableError) {
  const retryGate = result.retryGate || shapeRetryGate(stateContract, command, now, retryPolicy);
  if (result.audit === "command-rejected-retry-backoff") {
    return {
      state: {
        attempts: retryGate.attempts,
        lastAttemptAt: retryGate.lastAttemptAt,
        nextRetryAt: retryGate.nextRetryAt,
        lastErrorCode: retryGate.lastErrorCode || actionableError?.code || null
      },
      advice: "retry-backoff-active",
      retryAfterMs: retryGate.retryAfterMs,
      exhausted: false
    };
  }

  if (result.audit === "command-rejected-retry-exhausted") {
    return {
      state: {
        attempts: retryGate.attempts,
        lastAttemptAt: retryGate.lastAttemptAt,
        nextRetryAt: null,
        lastErrorCode: retryGate.lastErrorCode || actionableError?.code || null
      },
      advice: "retry-budget-exhausted",
      retryAfterMs: null,
      exhausted: true
    };
  }

  if (!actionableError || !actionableError.retryable) {
    return {
      state: {
        attempts: 0,
        lastAttemptAt: null,
        nextRetryAt: null,
        lastErrorCode: actionableError ? actionableError.code : null
      },
      advice: actionableError ? "manual-intervention-required" : "not-needed",
      retryAfterMs: null,
      exhausted: false
    };
  }

  const prior = stateContract.retry.lastErrorCode === actionableError.code ? stateContract.retry.attempts : 0;
  const attempts = Math.min(prior + 1, retryPolicy.maxAttempts);
  const retryAfterMs = Math.min(retryPolicy.baseDelayMs * 2 ** Math.max(0, attempts - 1), retryPolicy.maxDelayMs);
  const exhausted = attempts >= retryPolicy.maxAttempts;

  return {
    state: {
      attempts,
      lastAttemptAt: now,
      nextRetryAt: exhausted ? null : addDelay(now, retryAfterMs),
      lastErrorCode: actionableError.code
    },
    advice: exhausted ? "retry-budget-exhausted" : "retry-with-backoff",
    retryAfterMs: exhausted ? null : retryAfterMs,
    exhausted
  };
}

function shapeOperationalHealth(stateContract, result, command, now, retryPolicy) {
  const actionableError = actionableErrorFor(result, command, now);
  const persistedErrors = normalizeHealthErrors(stateContract.healthErrors);
  const activeErrors = actionableError ? persistedErrors.concat(actionableError).slice(-8) : persistedErrors;
  const retry = shapeRetryContract(stateContract, result, command, now, retryPolicy, actionableError);
  const retryGate = result.retryGate || shapeRetryGate(stateContract, command, now, retryPolicy);
  const degraded = DEGRADED_STATES.has(result.state.state) || activeErrors.some((error) => error.severity === "degraded");
  const failed = result.state.state === "failed" || activeErrors.some((error) => error.severity === "blocked");
  const status = failed ? "failed" : degraded ? "degraded" : "healthy";

  return {
    status,
    degradedMode: {
      active: status === "degraded",
      reason: DEGRADED_STATES.has(result.state.state) ? "transition-in-flight" : activeErrors[activeErrors.length - 1]?.code || null,
      allowedCommands: status === "degraded" ? ["status", "stop", "fail"] : ["boot", "pause", "resume", "stop", "fail", "status"]
    },
    validation: {
      commandKnown: command.name === "status" || TRANSITIONS.has(command.name),
      stateKnown: HOSTED_KERNEL_STATES.has(result.state.state),
      transitionAllowed: result.accepted || result.audit !== "command-rejected-state",
      scopeMatched:
        result.boundary.scope.tenantMatched &&
        result.boundary.scope.workspaceMatched &&
        result.boundary.scope.actorTenantMatched &&
        result.boundary.scope.actorWorkspaceMatched,
      requestScopeMatched: result.boundary.scope.tenantMatched && result.boundary.scope.workspaceMatched,
      actorScopeMatched: result.boundary.scope.actorTenantMatched && result.boundary.scope.actorWorkspaceMatched,
      boundaryPolicyMatched: result.boundary.policy?.accepted !== false,
      actorTenantScopedForStateChange: result.boundary.policy?.actorTenantScoped !== false,
      actorWorkspaceScopedForStateChange: result.boundary.policy?.actorWorkspaceScoped !== false,
      explicitScopeSatisfied: result.boundary.policy
        ? result.boundary.policy.explicitTenantScoped !== false && result.boundary.policy.explicitWorkspaceScoped !== false
        : true,
      permissionSatisfied: result.audit !== "command-rejected-permission",
      settingsAllowed: result.controls.accepted,
      scheduleSatisfied: result.audit !== "command-rejected-schedule",
      healthGateAccepted: result.healthGate.accepted,
      emergencyCommandAllowed: result.healthGate.emergencyAllowed,
      allowedByHealthGate: result.healthGate.allowedCommands.includes(command.name),
      retryGateAccepted: retryGate.accepted,
      retryBackoffActive: retryGate.backoffActive,
      retryBudgetAvailable: !retryGate.retryBudgetExhausted,
      allowedByRetryGate: retryGate.allowedCommands.includes(command.name)
    },
    failureState: {
      active: status === "failed",
      errorCount: activeErrors.length,
      latestError: activeErrors[activeErrors.length - 1] || null,
      gateAudit: result.healthGate.audit,
      retryGateAudit: retryGate.audit,
      blockedCommand: result.healthGate.accepted ? null : command.name,
      allowedCommands: [...new Set([...result.healthGate.allowedCommands, ...retryGate.allowedCommands])]
    },
    retry,
    errors: activeErrors,
    gate: result.healthGate,
    retryGate
  };
}

function shapeNextAction(stateContract, result, command, operationalHealth, settings, controlMatrix) {
  if (!result.accepted) {
    const latestError = operationalHealth.errors[operationalHealth.errors.length - 1] || null;
    return {
      type: "operator-remediation",
      command: command.name,
      blockedBy: result.audit,
      label: latestError?.action || "Review hosted-kernel lifecycle command prerequisites.",
      retryAt: operationalHealth.retry.state.nextRetryAt,
      requiredPermission: result.boundary.requiredPermission || null
    };
  }

  if (!settings.validation.valid) {
    return {
      type: "fix-controls",
      command: "status",
      label: "Repair lifecycle settings before issuing the next hosted-kernel state change.",
      retryAt: null,
      requiredPermission: COMMAND_PERMISSIONS.get("status"),
      invalidWindowIds: settings.validation.invalidWindowIds,
      conflictingCommands: settings.validation.conflictingCommands,
      controlIntentAudit: settings.validation.controlIntentAudit
    };
  }

  if (DEGRADED_STATES.has(result.state.state)) {
    return {
      type: "complete-transition",
      command: command.name,
      commandId: command.commandId,
      label: `Complete ${command.name} when hosted-kernel orchestration reports terminal state.`,
      expectedStableState: TRANSITIONS.get(command.name)?.terminal || result.state.state,
      retryAt: null,
      requiredPermission: result.boundary.requiredPermission || null
    };
  }

  if (!settings.lifecycleEnabled) {
    return {
      type: "enable-controls",
      command: "status",
      label: "Hosted-kernel lifecycle controls are disabled; enable controls before the next state change.",
      retryAt: null,
      requiredPermission: null
    };
  }

  if (settings.maintenanceMode && controlMatrix.nextStateChangingCommand !== "stop" && controlMatrix.nextStateChangingCommand !== "fail") {
    return {
      type: "exit-maintenance",
      command: "status",
      label: "Exit maintenance mode before issuing normal hosted-kernel lifecycle commands.",
      retryAt: null,
      requiredPermission: COMMAND_PERMISSIONS.get("status")
    };
  }

  if (controlMatrix.nextStateChangingCommand) {
    return {
      type: "suggest-command",
      command: controlMatrix.nextStateChangingCommand,
      label: `Next available hosted-kernel control is ${controlMatrix.nextStateChangingCommand}.`,
      retryAt: null,
      requiredPermission: COMMAND_PERMISSIONS.get(controlMatrix.nextStateChangingCommand)
    };
  }

  if (stateContract.state === "cold" || stateContract.state === "stopped" || stateContract.state === "failed") {
    return {
      type: "suggest-command",
      command: "boot",
      label: "Boot the hosted kernel when capacity and schedule controls allow it.",
      retryAt: null,
      requiredPermission: COMMAND_PERMISSIONS.get("boot")
    };
  }

  if (stateContract.state === "paused") {
    return {
      type: "suggest-command",
      command: "resume",
      label: "Resume the hosted kernel when work should continue.",
      retryAt: null,
      requiredPermission: COMMAND_PERMISSIONS.get("resume")
    };
  }

  return {
    type: "observe",
    command: "status",
    label: "Observe hosted-kernel lifecycle status or issue pause/stop controls as needed.",
    retryAt: null,
    requiredPermission: COMMAND_PERMISSIONS.get("status")
  };
}

function emptyCounter(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function countBy(entries, keys, readKey) {
  const counts = emptyCounter(keys);
  for (const entry of entries) {
    const key = readKey(entry);
    if (Object.hasOwn(counts, key)) counts[key] += 1;
  }
  return counts;
}

function countByDynamic(entries, readKey) {
  const counts = {};
  for (const entry of entries) {
    const key = normalizeIdentifier(readKey(entry), null);
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function elapsedMsBetween(start, end) {
  const startEpoch = parseEpoch(start);
  const endEpoch = parseEpoch(end);
  return startEpoch !== null && endEpoch !== null && endEpoch >= startEpoch ? endEpoch - startEpoch : null;
}

function durationBucket(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "unknown";
  return TRANSITION_DURATION_BUCKETS.find((bucket) => durationMs <= bucket.maxMs)?.bucket || "unknown";
}

function averageDurationMs(values) {
  const usable = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (usable.length === 0) return null;
  return Math.round(usable.reduce((total, value) => total + value, 0) / usable.length);
}

function shapeHistorySnapshots(history, commandLedger, currentState, generation, now) {
  const normalizedHistory = normalizeHistory(history);
  const ledger = normalizeCommandLedger(commandLedger);
  const ledgerByCommandId = new Map(ledger.map((entry) => [`${entry.commandId}:${entry.command}`, entry]));

  return normalizedHistory.map((entry, index) => {
    const nextEntry = normalizedHistory[index + 1] || null;
    const ledgerEntry =
      ledgerByCommandId.get(`${entry.commandId}:${entry.command}`) ||
      ledger.find((item) => item.commandId === entry.commandId) ||
      null;
    const stable = RESTART_SAFE_STATES.has(entry.to);
    const inFlight = DEGRADED_STATES.has(entry.to);
    const stateDurationMs = elapsedMsBetween(entry.at, nextEntry?.at || now);
    const terminalAgeMs = stable ? elapsedMsBetween(entry.at, now) : null;

    return {
      snapshotId: `${generation}:${index + 1}:${entry.commandId}`,
      sequence: index + 1,
      commandId: entry.commandId,
      command: entry.command,
      from: entry.from,
      to: entry.to,
      current: index === normalizedHistory.length - 1 && entry.to === currentState,
      stable,
      inFlight,
      phase: inFlight ? "transitioning" : stable ? "stable" : "non-terminal",
      restartSafe: RESTART_SAFE_STATES.has(entry.to),
      completed: ledgerEntry?.completed ?? stable,
      outcome: ledgerEntry?.outcome || (stable ? "accepted" : "observed"),
      audit: ledgerEntry?.audit || "history-observed",
      boundaryAudit: entry.boundaryAudit || ledgerEntry?.boundaryAudit || null,
      at: entry.at,
      nextTransitionAt: nextEntry?.at || null,
      stateDurationMs,
      durationBucket: durationBucket(stateDurationMs),
      terminalAgeMs,
      ageMs: elapsedMsBetween(entry.at, now)
    };
  });
}

function shapeTransitionDurationAnalytics(historySnapshots) {
  const timedSnapshots = historySnapshots.filter((entry) => Number.isFinite(entry.stateDurationMs));
  const completedSnapshots = timedSnapshots.filter((entry) => entry.completed || entry.stable);
  const activeSnapshots = timedSnapshots.filter((entry) => entry.inFlight || entry.current);
  const byBucket = emptyCounter(TRANSITION_DURATION_BUCKETS.map((bucket) => bucket.bucket).concat("unknown"));
  const byCommand = {};

  for (const snapshot of timedSnapshots) {
    byBucket[snapshot.durationBucket] = (byBucket[snapshot.durationBucket] || 0) + 1;
    if (!byCommand[snapshot.command]) {
      byCommand[snapshot.command] = {
        samples: 0,
        completedSamples: 0,
        averageMs: null,
        maxMs: null,
        latestMs: null
      };
    }

    const commandStats = byCommand[snapshot.command];
    commandStats.samples += 1;
    commandStats.completedSamples += snapshot.completed ? 1 : 0;
    commandStats.latestMs = snapshot.stateDurationMs;
    commandStats.maxMs = Math.max(commandStats.maxMs ?? 0, snapshot.stateDurationMs);
    commandStats.averageMs = averageDurationMs(
      timedSnapshots
        .filter((entry) => entry.command === snapshot.command)
        .map((entry) => entry.stateDurationMs)
    );
  }

  const completedDurations = completedSnapshots.map((entry) => entry.stateDurationMs);
  const activeDurations = activeSnapshots.map((entry) => entry.stateDurationMs);

  return {
    schemaVersion: 1,
    samples: timedSnapshots.length,
    completedSamples: completedSnapshots.length,
    activeSamples: activeSnapshots.length,
    averageCompletedMs: averageDurationMs(completedDurations),
    maxCompletedMs: completedDurations.length > 0 ? Math.max(...completedDurations) : null,
    averageActiveMs: averageDurationMs(activeDurations),
    maxActiveMs: activeDurations.length > 0 ? Math.max(...activeDurations) : null,
    byBucket,
    byCommand
  };
}

function shapeStateResidencyAnalytics(historySnapshots, currentState, now) {
  const byStateMs = emptyCounter(ANALYTICS_STATES);
  const byPhaseMs = {
    stable: 0,
    transitioning: 0,
    "non-terminal": 0
  };
  const observedSnapshots = historySnapshots.filter((entry) => Number.isFinite(entry.stateDurationMs));
  let longestSegment = null;

  for (const snapshot of observedSnapshots) {
    byStateMs[snapshot.to] = (byStateMs[snapshot.to] || 0) + snapshot.stateDurationMs;
    byPhaseMs[snapshot.phase] = (byPhaseMs[snapshot.phase] || 0) + snapshot.stateDurationMs;

    if (!longestSegment || snapshot.stateDurationMs > longestSegment.durationMs) {
      longestSegment = {
        commandId: snapshot.commandId,
        command: snapshot.command,
        state: snapshot.to,
        phase: snapshot.phase,
        startedAt: snapshot.at,
        endedAt: snapshot.nextTransitionAt || now,
        durationMs: snapshot.stateDurationMs,
        durationBucket: snapshot.durationBucket
      };
    }
  }

  const totalObservedMs = Object.values(byStateMs).reduce((total, value) => total + value, 0);
  const currentSegment = historySnapshots.find((entry) => entry.current) || historySnapshots[historySnapshots.length - 1] || null;
  const unstableMs = ANALYTICS_STATES
    .filter((state) => DEGRADED_STATES.has(state))
    .reduce((total, state) => total + (byStateMs[state] || 0), 0);

  return {
    schemaVersion: 1,
    generatedAt: now,
    samples: observedSnapshots.length,
    currentState,
    currentStateAgeMs: elapsedMsBetween(currentSegment?.at, now),
    totalObservedMs,
    unstableMs,
    stableMs: Math.max(0, totalObservedMs - unstableMs),
    unstableRatio: totalObservedMs > 0 ? unstableMs / totalObservedMs : null,
    byStateMs,
    byPhaseMs,
    longestSegment,
    currentSegment: currentSegment
      ? {
          commandId: currentSegment.commandId,
          command: currentSegment.command,
          state: currentSegment.to,
          phase: currentSegment.phase,
          startedAt: currentSegment.at,
          durationMs: currentSegment.stateDurationMs,
          durationBucket: currentSegment.durationBucket
        }
      : null
  };
}

function shapeHistoryAnalytics(history, currentState) {
  const normalizedHistory = normalizeHistory(history);
  const terminalTransitions = normalizedHistory.filter((entry) => TERMINAL_STATES.has(entry.to));
  const transitionTargets = countBy(normalizedHistory, ANALYTICS_STATES, (entry) => entry.to);
  transitionTargets[currentState] = (transitionTargets[currentState] || 0) + 1;

  return {
    windowSize: normalizedHistory.length,
    byCommand: countBy(normalizedHistory, ANALYTICS_COMMANDS, (entry) => entry.command),
    byTargetState: transitionTargets,
    terminalTransitionCount: terminalTransitions.length,
    inFlightTransitionCount: normalizedHistory.length - terminalTransitions.length,
    firstTransitionAt: normalizedHistory[0]?.at || null,
    lastTransitionAt: normalizedHistory[normalizedHistory.length - 1]?.at || null,
    lastTerminalTransitionAt: terminalTransitions[terminalTransitions.length - 1]?.at || null
  };
}

function shapeCommandAnalytics(result, command, operationalHealth) {
  return {
    commandName: command.name,
    commandId: command.commandId,
    accepted: result.accepted,
    rejected: !result.accepted,
    idempotent: result.idempotent,
    replayed: result.replayed === true,
    audit: result.audit,
    retryScheduled: Boolean(operationalHealth.retry.state.nextRetryAt),
    retryAdvice: operationalHealth.retry.advice,
    healthStatus: operationalHealth.status
  };
}

function shapeLedgerAnalytics(commandLedger) {
  const ledger = normalizeCommandLedger(commandLedger);
  const stateChangingLedger = ledger.filter((entry) => entry.command !== "status");

  return {
    retainedEntries: ledger.length,
    stateChangingEntries: stateChangingLedger.length,
    byCommand: countBy(ledger, ANALYTICS_COMMANDS, (entry) => entry.command),
    byOutcome: countBy(ledger, [...COMMAND_LEDGER_OUTCOMES].sort(), (entry) => entry.outcome),
    byAudit: countByDynamic(ledger, (entry) => entry.audit),
    completed: ledger.filter((entry) => entry.completed).length,
    replayable: ledger.filter((entry) => entry.replayable).length,
    restartSafe: ledger.filter((entry) => entry.restartSafe).length,
    firstRecordedAt: ledger[0]?.at || null,
    lastRecordedAt: ledger[ledger.length - 1]?.at || null
  };
}

function shapeCommandFunnelAnalytics(commandLedger, command, result) {
  const ledger = normalizeCommandLedger(commandLedger);
  const stateChanging = ledger.filter((entry) => entry.command !== "status");
  const rejected = ledger.filter((entry) => entry.outcome === "rejected");
  const accepted = ledger.filter((entry) => entry.outcome === "accepted");
  const idempotent = ledger.filter((entry) => entry.outcome === "idempotent");
  const latestForCommand = [...ledger].reverse().find((entry) => entry.command === command.name) || null;
  const rejectionAudits = countByDynamic(rejected, (entry) => entry.audit);
  const dominantRejectionAudit = Object.entries(rejectionAudits)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] || null;
  const submitted = accepted.length + rejected.length + idempotent.length;

  return {
    schemaVersion: 1,
    submitted,
    accepted: accepted.length,
    rejected: rejected.length,
    idempotent: idempotent.length,
    observedStatus: ledger.length - stateChanging.length,
    stateChanging: stateChanging.length,
    acceptanceRatio: submitted > 0 ? accepted.length / submitted : null,
    replayRatio: submitted > 0 ? idempotent.length / submitted : null,
    latestDecision: {
      commandId: command.commandId,
      command: command.name,
      accepted: result.accepted,
      audit: result.audit,
      outcome: result.idempotent ? "idempotent" : result.accepted ? "accepted" : "rejected"
    },
    latestForCommand,
    dominantRejectionAudit: dominantRejectionAudit
      ? {
          audit: dominantRejectionAudit[0],
          count: dominantRejectionAudit[1]
        }
      : null,
    rejectionAudits
  };
}

function shapeReplayAndFailureAnalytics(commandLedger, historySnapshots, result) {
  const ledger = normalizeCommandLedger(commandLedger);
  const replayable = ledger.filter((entry) => entry.replayable);
  const nonReplayable = ledger.filter((entry) => !entry.replayable);
  const rejected = ledger.filter((entry) => entry.outcome === "rejected");
  const failedSnapshots = historySnapshots.filter((entry) => entry.outcome === "rejected" || entry.to === "failed");
  const failureReasons = rejected
    .map((entry) => entry.failureReason)
    .filter(Boolean);
  const byFailureCode = countByDynamic(failureReasons, (entry) => entry.code);
  const byFailureAudit = countByDynamic(rejected, (entry) => entry.failureReason?.audit || entry.audit);
  const byFailureAction = countByDynamic(failureReasons, (entry) => entry.action);
  const replayBlockers = countByDynamic(
    result.replayDecision?.blockers || [],
    (entry) => entry
  );
  const latestFailure = rejected[rejected.length - 1] || null;
  const latestReplayable = replayable[replayable.length - 1] || null;
  const terminalReplayable = replayable.filter((entry) => entry.completed && RESTART_SAFE_STATES.has(entry.state));
  const replayCoverageBase = ledger.filter((entry) => entry.outcome !== "observed").length;

  return {
    schemaVersion: 1,
    ledgerEntries: ledger.length,
    replayable: replayable.length,
    nonReplayable: nonReplayable.length,
    terminalReplayable: terminalReplayable.length,
    rejected: rejected.length,
    failedSnapshots: failedSnapshots.length,
    replayCoverageRatio: replayCoverageBase > 0 ? replayable.length / replayCoverageBase : null,
    failureCodeCount: Object.keys(byFailureCode).length,
    replayDecision: result.replayDecision
      ? {
          accepted: result.replayDecision.accepted,
          audit: result.replayDecision.audit,
          blockers: result.replayDecision.blockers,
          blockerCount: result.replayDecision.blockers.length
        }
      : null,
    latestFailure: latestFailure
      ? {
          commandId: latestFailure.commandId,
          command: latestFailure.command,
          audit: latestFailure.audit,
          code: latestFailure.failureReason?.code || null,
          retryable: latestFailure.failureReason?.retryable ?? null,
          action: latestFailure.failureReason?.action || null,
          at: latestFailure.at
        }
      : null,
    latestReplayable: latestReplayable
      ? {
          commandId: latestReplayable.commandId,
          command: latestReplayable.command,
          state: latestReplayable.state,
          generation: latestReplayable.generation,
          completed: latestReplayable.completed,
          restartSafe: latestReplayable.restartSafe,
          at: latestReplayable.at
        }
      : null,
    byFailureCode,
    byFailureAudit,
    byFailureAction,
    replayBlockers,
    nonReplayableCommandIds: nonReplayable.map((entry) => entry.commandId)
  };
}

function shapeLifecycleTimeline(history, currentState, now) {
  const entries = normalizeHistory(history).map((entry, index) => ({
    sequence: index + 1,
    at: entry.at,
    commandId: entry.commandId,
    command: entry.command,
    from: entry.from,
    to: entry.to,
    stable: RESTART_SAFE_STATES.has(entry.to),
    restartSafe: RESTART_SAFE_STATES.has(entry.to)
  }));

  entries.push({
    sequence: entries.length + 1,
    at: now,
    commandId: "state:snapshot",
    command: "snapshot",
    from: currentState,
    to: currentState,
    stable: RESTART_SAFE_STATES.has(currentState),
    restartSafe: RESTART_SAFE_STATES.has(currentState)
  });

  return entries;
}

function shapeTimelineReportState(timeline, historySnapshots, currentState, generation, now) {
  const orderedTimeline = Array.isArray(timeline) ? timeline : [];
  const firstEntry = orderedTimeline[0] || null;
  const lastEntry = orderedTimeline[orderedTimeline.length - 1] || null;
  const currentSnapshot = historySnapshots.find((entry) => entry.current) || historySnapshots[historySnapshots.length - 1] || null;
  const missingTimestamps = orderedTimeline.filter((entry) => !entry.at).length;
  const nonMonotonicSequences = orderedTimeline.filter((entry, index) => entry.sequence !== index + 1).length;
  const lastTransitionAgeMs = elapsedMsBetween(currentSnapshot?.at, now);
  const coverageStartAt = firstEntry?.at || null;
  const coverageEndAt = lastEntry?.at || now;

  return {
    schemaVersion: 1,
    generatedAt: now,
    generation,
    currentState,
    timelineRows: orderedTimeline.length,
    snapshotRows: historySnapshots.length,
    coverageStartAt,
    coverageEndAt,
    coverageDurationMs: elapsedMsBetween(coverageStartAt, coverageEndAt),
    lastTransitionAgeMs,
    currentSegment: currentSnapshot
      ? {
          commandId: currentSnapshot.commandId,
          command: currentSnapshot.command,
          from: currentSnapshot.from,
          to: currentSnapshot.to,
          phase: currentSnapshot.phase,
          durationMs: currentSnapshot.stateDurationMs,
          durationBucket: currentSnapshot.durationBucket
        }
      : null,
    integrity: {
      complete: missingTimestamps === 0 && nonMonotonicSequences === 0,
      missingTimestamps,
      nonMonotonicSequences,
      includesCurrentSnapshot: orderedTimeline.some((entry) => entry.commandId === "state:snapshot"),
      retainedHistoryRows: Math.max(0, orderedTimeline.length - 1)
    }
  };
}

function shapeLifecycleReportState(
  shapedState,
  result,
  command,
  historyAnalytics,
  durationAnalytics,
  residencyAnalytics,
  ledgerAnalytics,
  commandFunnelAnalytics,
  replayFailureAnalytics,
  timelineState,
  historySnapshots,
  operationalHealth,
  providerNegotiation,
  externalHandoff,
  providerDispatch,
  now
) {
  const latestSnapshot = historySnapshots[historySnapshots.length - 1] || null;
  const inFlight = DEGRADED_STATES.has(shapedState.state);
  const acceptedCommands = ledgerAnalytics.byOutcome.accepted || 0;
  const rejectedCommands = ledgerAnalytics.byOutcome.rejected || 0;
  const totalDecisions = acceptedCommands + rejectedCommands;

  return {
    schemaVersion: 1,
    generatedAt: now,
    reportId: `${surfaceId}:${shapedState.tenantId}:${shapedState.workspaceId}:${shapedState.generation}`,
    lifecyclePhase: inFlight ? "transitioning" : shapedState.restartSafe ? "stable" : "unsafe",
    exportReady: shapedState.restartSafe && operationalHealth.status !== "failed",
    current: {
      state: shapedState.state,
      generation: shapedState.generation,
      activeCommandId: shapedState.activeCommandId,
      commandName: command.name,
      commandAccepted: result.accepted,
      audit: result.audit
    },
    counters: {
      transitionWindowSize: historyAnalytics.windowSize,
      terminalTransitions: historyAnalytics.terminalTransitionCount,
      inFlightTransitions: historyAnalytics.inFlightTransitionCount,
      acceptedCommands,
      rejectedCommands,
      acceptanceRate: totalDecisions > 0 ? acceptedCommands / totalDecisions : null,
      actionableErrors: operationalHealth.errors.length,
      healthGateBlocked: operationalHealth.gate.accepted ? 0 : 1,
      providerMissingCapabilities: providerNegotiation.missingCapabilities.length,
      durationSamples: durationAnalytics.samples,
      averageCompletedTransitionMs: durationAnalytics.averageCompletedMs,
      maxCompletedTransitionMs: durationAnalytics.maxCompletedMs,
      stateResidencySamples: residencyAnalytics.samples,
      unstableResidencyMs: residencyAnalytics.unstableMs,
      unstableResidencyRatio: residencyAnalytics.unstableRatio,
      commandFunnelSubmitted: commandFunnelAnalytics.submitted,
      commandFunnelRejected: commandFunnelAnalytics.rejected,
      commandFunnelAcceptanceRatio: commandFunnelAnalytics.acceptanceRatio,
      replayableCommands: replayFailureAnalytics.replayable,
      nonReplayableCommands: replayFailureAnalytics.nonReplayable,
      failureReasonCodes: replayFailureAnalytics.failureCodeCount,
      timelineRows: timelineState.timelineRows,
      timelineIntegrityComplete: timelineState.integrity.complete
    },
    latestSnapshot,
    durations: {
      samples: durationAnalytics.samples,
      completedSamples: durationAnalytics.completedSamples,
      activeSamples: durationAnalytics.activeSamples,
      averageCompletedMs: durationAnalytics.averageCompletedMs,
      maxCompletedMs: durationAnalytics.maxCompletedMs,
      averageActiveMs: durationAnalytics.averageActiveMs,
      maxActiveMs: durationAnalytics.maxActiveMs,
      byBucket: durationAnalytics.byBucket
    },
    residency: {
      samples: residencyAnalytics.samples,
      currentState: residencyAnalytics.currentState,
      currentStateAgeMs: residencyAnalytics.currentStateAgeMs,
      totalObservedMs: residencyAnalytics.totalObservedMs,
      stableMs: residencyAnalytics.stableMs,
      unstableMs: residencyAnalytics.unstableMs,
      unstableRatio: residencyAnalytics.unstableRatio,
      byStateMs: residencyAnalytics.byStateMs,
      byPhaseMs: residencyAnalytics.byPhaseMs,
      longestSegment: residencyAnalytics.longestSegment,
      currentSegment: residencyAnalytics.currentSegment
    },
    commandFunnel: {
      submitted: commandFunnelAnalytics.submitted,
      accepted: commandFunnelAnalytics.accepted,
      rejected: commandFunnelAnalytics.rejected,
      idempotent: commandFunnelAnalytics.idempotent,
      observedStatus: commandFunnelAnalytics.observedStatus,
      stateChanging: commandFunnelAnalytics.stateChanging,
      acceptanceRatio: commandFunnelAnalytics.acceptanceRatio,
      replayRatio: commandFunnelAnalytics.replayRatio,
      dominantRejectionAudit: commandFunnelAnalytics.dominantRejectionAudit,
      latestForCommand: commandFunnelAnalytics.latestForCommand
    },
    replayAndFailures: replayFailureAnalytics,
    timeline: {
      currentSegment: timelineState.currentSegment,
      coverageStartAt: timelineState.coverageStartAt,
      coverageEndAt: timelineState.coverageEndAt,
      coverageDurationMs: timelineState.coverageDurationMs,
      lastTransitionAgeMs: timelineState.lastTransitionAgeMs,
      integrity: timelineState.integrity
    },
    provider: {
      accepted: providerNegotiation.accepted,
      audit: providerNegotiation.audit,
      handoffState: externalHandoff.state,
      handoffRequired: externalHandoff.required,
      dispatchState: providerDispatch.state,
      dispatchable: providerDispatch.dispatchable,
      dispatchBlockedBy: providerDispatch.blockedBy,
      supportedCommands: providerNegotiation.supportedCommands
    },
    retention: {
      historyLimit: 12,
      ledgerLimit: 20,
      healthErrorLimit: 8,
      retainedHistory: shapedState.history.length,
      retainedLedger: shapedState.commandLedger.length,
      retainedHealthErrors: shapedState.healthErrors.length
    }
  };
}

function shapeReportingSnapshot(stateContract, shapedState, result, command, actor, operationalHealth, now) {
  const latestHistory = shapedState.history[shapedState.history.length - 1] || null;
  const boundaryProof = shapeBoundaryProof(result, actor);

  return {
    schemaVersion: 1,
    surfaceId,
    generatedAt: now,
    tenantId: shapedState.tenantId,
    workspaceId: shapedState.workspaceId,
    generation: shapedState.generation,
    state: shapedState.state,
    previousState: stateContract.state,
    persistedState: shapedState.persistedState,
    commandName: command.name,
    commandId: command.commandId,
    actorId: actor.actorId,
    accepted: result.accepted,
    idempotent: result.idempotent,
    audit: result.audit,
    healthStatus: operationalHealth.status,
    restartSafe: shapedState.restartSafe,
    recoveredFrom: shapedState.recoveredFrom,
    replayed: result.replayed === true,
    replayAudit: result.replay?.audit || null,
    latestTransitionAt: latestHistory?.at || null,
    actionableErrorCount: operationalHealth.errors.length,
    boundaryAccepted: boundaryProof.accepted,
    requestScopeMatched: boundaryProof.scope.tenantMatched && boundaryProof.scope.workspaceMatched,
    actorScopeMatched: boundaryProof.scope.actorTenantMatched && boundaryProof.scope.actorWorkspaceMatched,
    boundaryPolicyAudit: boundaryProof.policy.audit,
    boundaryPolicyAccepted: boundaryProof.policy.accepted,
    actorScopeRequired: boundaryProof.policy.requiresActorScope,
    explicitScopeRequired: boundaryProof.policy.requiresExplicitScope,
    crossTenantBlocked: boundaryProof.isolation.crossTenantBlocked,
    crossWorkspaceBlocked: boundaryProof.isolation.crossWorkspaceBlocked
  };
}

function shapePersistenceWriteContract(shapedState, result, command, providerSync, now) {
  const latestLedgerEntry = shapedState.commandLedger[shapedState.commandLedger.length - 1] || null;
  const latestHistoryEntry = shapedState.history[shapedState.history.length - 1] || null;
  const stateChanging = STATE_CHANGING_COMMANDS.includes(command.name);
  const writeRequired =
    result.accepted ||
    result.idempotent ||
    shapedState.recovery?.applied === true ||
    shapedState.healthErrors.length > 0 ||
    stateChanging;
  const idempotencyParts = [
    surfaceId,
    shapedState.tenantId,
    shapedState.workspaceId,
    shapedState.generation,
    command.commandId,
    result.audit
  ];

  return {
    schemaVersion: 1,
    required: writeRequired,
    mode: shapedState.restartSafe ? "stable-checkpoint" : "transition-checkpoint",
    status: writeRequired
      ? providerSync.writeBarrier.satisfied
        ? "ready-to-persist"
        : "blocked-by-provider-sync"
      : "not-required",
    stateDocument: {
      schemaVersion: shapedState.schemaVersion,
      surfaceId,
      tenantId: shapedState.tenantId,
      workspaceId: shapedState.workspaceId,
      state: shapedState.state,
      generation: shapedState.generation,
      restartSafe: shapedState.restartSafe,
      activeCommandId: shapedState.activeCommandId,
      updatedAt: shapedState.updatedAt,
      lastStableAt: shapedState.lastStableAt,
      recoveredFrom: shapedState.recoveredFrom,
      recoveryAudit: shapedState.recovery?.audit || null,
      restartStatus: shapedState.restartStatus
    },
    writeBarrier: {
      required: providerSync.writeBarrier.required,
      satisfied: providerSync.writeBarrier.satisfied,
      expectedGeneration: providerSync.writeBarrier.expectedGeneration,
      previousProviderGeneration: providerSync.writeBarrier.previousProviderGeneration,
      freshness: providerSync.freshness
    },
    idempotency: {
      key: idempotencyParts.map((part) => String(part).replaceAll(":", "_")).join(":"),
      commandId: command.commandId,
      commandName: command.name,
      replaySafe: result.accepted || result.idempotent,
      ledgerOutcome: latestLedgerEntry?.outcome || null,
      ledgerAudit: latestLedgerEntry?.audit || null
    },
    checkpoint: {
      generatedAt: now,
      historyCommandId: latestHistoryEntry?.commandId || null,
      historyCommand: latestHistoryEntry?.command || null,
      providerCursor: providerSync.cursor,
      recovery: shapedState.recovery?.checkpoint || null
    }
  };
}

function shapeExportReadiness(snapshot, timeline, historySnapshots, counterRows, reportState, timelineState) {
  const blockers = [];
  const partitionKey = `${snapshot.tenantId}/${snapshot.workspaceId}/${snapshot.generation}`;

  if (!reportState.exportReady) blockers.push("report-not-export-ready");
  if (!timelineState.integrity.complete) blockers.push("timeline-integrity-incomplete");
  if (!timelineState.integrity.includesCurrentSnapshot) blockers.push("timeline-current-snapshot-missing");
  if (snapshot.healthStatus === "failed") blockers.push("health-status-failed");
  if (!snapshot.restartSafe) blockers.push("restart-unsafe");

  return {
    schemaVersion: 1,
    ready: blockers.length === 0,
    blockers,
    partitionKey,
    objectPrefix: `kernel-lifecycle/${snapshot.tenantId}/${snapshot.workspaceId}/generation-${snapshot.generation}`,
    generatedAt: snapshot.generatedAt,
    checks: {
      reportExportReady: reportState.exportReady,
      timelineIntegrityComplete: timelineState.integrity.complete,
      includesCurrentSnapshot: timelineState.integrity.includesCurrentSnapshot,
      restartSafe: snapshot.restartSafe,
      healthStatus: snapshot.healthStatus
    },
    rowCounts: {
      timeline: timeline.length,
      historySnapshots: historySnapshots.length,
      counters: counterRows.length,
      reportState: 1
    }
  };
}

function shapeExportRows(
  snapshot,
  timeline,
  historySnapshots,
  historyAnalytics,
  durationAnalytics,
  residencyAnalytics,
  commandAnalytics,
  ledgerAnalytics,
  commandFunnelAnalytics,
  replayFailureAnalytics,
  reportState,
  timelineState
) {
  const snapshotRows = historySnapshots.map((entry) => ({
    exportType: "lifecycle-history-snapshot",
    tenantId: snapshot.tenantId,
    workspaceId: snapshot.workspaceId,
    generation: snapshot.generation,
    ...entry
  }));
  const counterRows = [
    ...Object.entries(historyAnalytics.byCommand).map(([key, value]) => ({
      exportType: "lifecycle-counter",
      counterGroup: "history.byCommand",
      key,
      value
    })),
    ...Object.entries(historyAnalytics.byTargetState).map(([key, value]) => ({
      exportType: "lifecycle-counter",
      counterGroup: "history.byTargetState",
      key,
      value
    })),
    ...Object.entries(ledgerAnalytics.byOutcome).map(([key, value]) => ({
      exportType: "lifecycle-counter",
      counterGroup: "ledger.byOutcome",
      key,
      value
    })),
    ...Object.entries(ledgerAnalytics.byAudit).map(([key, value]) => ({
      exportType: "lifecycle-counter",
      counterGroup: "ledger.byAudit",
      key,
      value
    })),
    ...Object.entries(durationAnalytics.byBucket).map(([key, value]) => ({
      exportType: "lifecycle-counter",
      counterGroup: "duration.byBucket",
      key,
      value
    })),
    ...Object.entries(residencyAnalytics.byStateMs).map(([key, value]) => ({
      exportType: "lifecycle-counter",
      counterGroup: "residency.byStateMs",
      key,
      value
    })),
    ...Object.entries(residencyAnalytics.byPhaseMs).map(([key, value]) => ({
      exportType: "lifecycle-counter",
      counterGroup: "residency.byPhaseMs",
      key,
      value
    })),
    ...Object.entries(commandFunnelAnalytics.rejectionAudits).map(([key, value]) => ({
      exportType: "lifecycle-counter",
      counterGroup: "commandFunnel.rejectionAudits",
      key,
      value
    })),
    ...Object.entries(replayFailureAnalytics.byFailureCode).map(([key, value]) => ({
      exportType: "lifecycle-counter",
      counterGroup: "failure.byCode",
      key,
      value
    })),
    ...Object.entries(replayFailureAnalytics.byFailureAudit).map(([key, value]) => ({
      exportType: "lifecycle-counter",
      counterGroup: "failure.byAudit",
      key,
      value
    })),
    ...Object.entries(replayFailureAnalytics.replayBlockers).map(([key, value]) => ({
      exportType: "lifecycle-counter",
      counterGroup: "replay.blockers",
      key,
      value
    })),
    ...[
      ["submitted", commandFunnelAnalytics.submitted],
      ["accepted", commandFunnelAnalytics.accepted],
      ["rejected", commandFunnelAnalytics.rejected],
      ["idempotent", commandFunnelAnalytics.idempotent],
      ["observedStatus", commandFunnelAnalytics.observedStatus],
      ["stateChanging", commandFunnelAnalytics.stateChanging],
      ["replayable", replayFailureAnalytics.replayable],
      ["nonReplayable", replayFailureAnalytics.nonReplayable],
      ["terminalReplayable", replayFailureAnalytics.terminalReplayable],
      ["failedSnapshots", replayFailureAnalytics.failedSnapshots]
    ].map(([key, value]) => ({
      exportType: "lifecycle-counter",
      counterGroup: key.startsWith("replay") || key === "terminalReplayable" || key === "failedSnapshots"
        ? "replayFailure.totals"
        : "commandFunnel.totals",
      key,
      value
    }))
  ];
  const readiness = shapeExportReadiness(snapshot, timeline, historySnapshots, counterRows, reportState, timelineState);

  return {
    summary: {
      exportVersion: "hosted-kernel-lifecycle-analytics/v1",
      generatedAt: snapshot.generatedAt,
      tenantId: snapshot.tenantId,
      workspaceId: snapshot.workspaceId,
      surfaceId: snapshot.surfaceId,
      rows: timeline.length + snapshotRows.length + counterRows.length + 1,
      timelineRows: timeline.length,
      snapshotRows: snapshotRows.length,
      counterRows: counterRows.length,
      windowSize: historyAnalytics.windowSize,
      accepted: commandAnalytics.accepted,
      rejected: commandAnalytics.rejected,
      healthStatus: snapshot.healthStatus,
      exportReady: readiness.ready,
      blockers: readiness.blockers,
      partitionKey: readiness.partitionKey,
      averageCompletedTransitionMs: durationAnalytics.averageCompletedMs,
      currentStateAgeMs: residencyAnalytics.currentStateAgeMs,
      unstableResidencyMs: residencyAnalytics.unstableMs,
      commandFunnelAcceptanceRatio: commandFunnelAnalytics.acceptanceRatio,
      replayCoverageRatio: replayFailureAnalytics.replayCoverageRatio,
      latestFailureCode: replayFailureAnalytics.latestFailure?.code || null,
      timelineIntegrityComplete: timelineState.integrity.complete
    },
    manifest: {
      reportId: reportState.reportId,
      parts: [
        { name: "timeline", format: "jsonl", rows: timeline.length },
        { name: "historySnapshots", format: "jsonl", rows: snapshotRows.length },
        { name: "counters", format: "jsonl", rows: counterRows.length },
        { name: "reportState", format: "json", rows: 1 }
      ],
      primaryKeys: ["tenantId", "workspaceId", "generation", "sequence"],
      generatedAt: snapshot.generatedAt,
      readiness
    },
    jsonl: [
      ...timeline.map((entry) => ({
        exportType: "lifecycle-timeline",
        tenantId: snapshot.tenantId,
        workspaceId: snapshot.workspaceId,
        generation: snapshot.generation,
        ...entry
      })),
      ...snapshotRows,
      ...counterRows.map((entry) => ({
        tenantId: snapshot.tenantId,
        workspaceId: snapshot.workspaceId,
        generation: snapshot.generation,
        ...entry
      })),
      {
        exportType: "lifecycle-report-state",
        tenantId: snapshot.tenantId,
        workspaceId: snapshot.workspaceId,
        generation: snapshot.generation,
        reportState
      }
    ],
    csvColumns: ["sequence", "at", "commandId", "command", "from", "to", "stable", "restartSafe"],
    csvRows: timeline.map((entry) => [
      entry.sequence,
      entry.at,
      entry.commandId,
      entry.command,
      entry.from,
      entry.to,
      entry.stable,
      entry.restartSafe
    ])
  };
}

export function describeStateTransitionSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const stateContract = shapePersistedState(input.persistedState, now);
  const requestedScope = normalizeScope(input, stateContract);
  const providerContract = normalizeProviderContract(input.provider, asObject(input.persistedState).provider);
  const providerAck = normalizeProviderAcknowledgement(
    input.providerAcknowledgement ?? input.providerAck,
    asObject(input.persistedState).providerAcknowledgement ?? asObject(input.persistedState).providerAck,
    providerContract,
    now
  );
  const providerAckStateContract = shapeProviderAcknowledgementCandidateState(
    input.persistedState,
    stateContract,
    providerAck,
    now
  );
  const providerAckDecision = evaluateProviderAcknowledgement(providerAckStateContract, providerAck, providerContract);
  const reconciledStateContract = providerAckDecision.applied
    ? applyProviderAcknowledgement(providerAckStateContract, providerAck, providerAckDecision, now)
    : applyProviderAcknowledgement(stateContract, providerAck, providerAckDecision, now);
  const scopedStateContract = {
    ...reconciledStateContract,
    tenantId: requestedScope.tenantId,
    workspaceId: requestedScope.workspaceId
  };
  const command = normalizeCommand(input);
  const actor = normalizeActor(input.actor);
  const settings = normalizeLifecycleSettings(input.settings, asObject(input.persistedState).settings, now);
  const providerNegotiation = negotiateProviderCapabilities(providerContract, command);
  const retryPolicy = normalizeRetryPolicy(input.retryPolicy);
  const commandResult = applyCommand(scopedStateContract, command, now, actor, requestedScope, settings, providerNegotiation, retryPolicy);
  const result = appendCommandDecisionRecord(scopedStateContract, commandResult, command, now);
  const boundaryProof = shapeBoundaryProof(result, actor);
  const operationalHealth = shapeOperationalHealth(
    scopedStateContract,
    result,
    command,
    now,
    retryPolicy
  );
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const commandLedger = mergeCommandLedger(result.state.commandLedger, result, command, now);
  const shapedState = {
    ...result.state,
    commandLedger,
    health: {
      status: operationalHealth.status,
      degradedMode: operationalHealth.degradedMode,
      validation: operationalHealth.validation,
      retryGate: operationalHealth.retryGate
    },
    failureState: operationalHealth.failureState,
    healthErrors: operationalHealth.errors,
    retry: operationalHealth.retry.state,
    settings
  };
  const controlMatrix = shapeLifecycleControlMatrix(settings, shapedState, command, now);
  const nextAction = shapeNextAction(shapedState, result, command, operationalHealth, settings, controlMatrix);
  const historyAnalytics = shapeHistoryAnalytics(shapedState.history, shapedState.state);
  const commandAnalytics = shapeCommandAnalytics(result, command, operationalHealth);
  const ledgerAnalytics = shapeLedgerAnalytics(shapedState.commandLedger);
  const historySnapshots = shapeHistorySnapshots(
    shapedState.history,
    shapedState.commandLedger,
    shapedState.state,
    shapedState.generation,
    now
  );
  const durationAnalytics = shapeTransitionDurationAnalytics(historySnapshots);
  const residencyAnalytics = shapeStateResidencyAnalytics(historySnapshots, shapedState.state, now);
  const commandFunnelAnalytics = shapeCommandFunnelAnalytics(shapedState.commandLedger, command, result);
  const replayFailureAnalytics = shapeReplayAndFailureAnalytics(shapedState.commandLedger, historySnapshots, result);
  const timeline = shapeLifecycleTimeline(shapedState.history, shapedState.state, now);
  const timelineState = shapeTimelineReportState(timeline, historySnapshots, shapedState.state, shapedState.generation, now);
  const providerSync = shapeProviderSyncMetadata(providerContract, result, command, now);
  const persistence = shapePersistenceWriteContract(shapedState, result, command, providerSync, now);
  const externalHandoff = shapeExternalHandoff(providerContract, providerNegotiation, result, command, now);
  const providerDispatch = shapeProviderServiceDispatch(
    providerContract,
    providerNegotiation,
    providerSync,
    externalHandoff,
    result,
    command,
    now
  );
  const reportState = shapeLifecycleReportState(
    shapedState,
    result,
    command,
    historyAnalytics,
    durationAnalytics,
    residencyAnalytics,
    ledgerAnalytics,
    commandFunnelAnalytics,
    replayFailureAnalytics,
    timelineState,
    historySnapshots,
    operationalHealth,
    providerNegotiation,
    externalHandoff,
    providerDispatch,
    now
  );
  const reportingSnapshot = shapeReportingSnapshot(
    scopedStateContract,
    shapedState,
    result,
    command,
    actor,
    operationalHealth,
    now
  );
  const analyticsExports = shapeExportRows(
    reportingSnapshot,
    timeline,
    historySnapshots,
    historyAnalytics,
    durationAnalytics,
    residencyAnalytics,
    commandAnalytics,
    ledgerAnalytics,
    commandFunnelAnalytics,
    replayFailureAnalytics,
    reportState,
    timelineState
  );
  const clientRuntime = normalizeClientRuntime(input.client, input.request, now);
  const clientState = shapeClientRuntimeState(
    clientRuntime,
    shapedState,
    result,
    command,
    providerSync,
    externalHandoff,
    nextAction,
    now
  );
  const previewAcceptance = shapePreviewAcceptanceContract(
    clientRuntime,
    scopedStateContract,
    shapedState,
    result,
    command,
    operationalHealth,
    settings,
    providerNegotiation,
    externalHandoff,
    nextAction,
    now
  );
  const routePreview = shapeClientRoutePreviewContract(
    clientRuntime,
    previewAcceptance,
    clientState,
    result,
    command,
    providerSync,
    externalHandoff,
    providerDispatch,
    operationalHealth,
    now
  );
  const acceptanceEnvelope = shapeClientAcceptanceEnvelope(
    clientRuntime,
    previewAcceptance,
    routePreview,
    clientState,
    result,
    command,
    providerDispatch,
    externalHandoff,
    now
  );

  return {
    ok: true,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel lifecycle transition persistence contract/v1",
    state: {
      ...shapedState,
      persistence
    },
    analytics: {
      counters: {
        history: historyAnalytics,
        command: commandAnalytics,
        ledger: ledgerAnalytics,
        durations: durationAnalytics,
        residency: residencyAnalytics,
        commandFunnel: commandFunnelAnalytics,
        replayAndFailures: replayFailureAnalytics,
        errors: {
          actionable: operationalHealth.errors.length,
          retryable: operationalHealth.errors.filter((error) => error.retryable).length,
          blocked: operationalHealth.errors.filter((error) => error.severity === "blocked").length,
          degraded: operationalHealth.errors.filter((error) => error.severity === "degraded").length
        }
      },
      snapshot: reportingSnapshot,
      historySnapshots,
      timeline,
      timelineState,
      reportState,
      exports: analyticsExports
    },
    controls: {
      lifecycleEnabled: settings.lifecycleEnabled,
      maintenanceMode: settings.maintenanceMode,
      requireScopedActorForStateChanges: settings.requireScopedActorForStateChanges,
      requireExplicitScopeForStateChanges: settings.requireExplicitScopeForStateChanges,
      allowedCommands: settings.allowedCommands,
      disabledCommands: settings.disabledCommands,
      requireReasonFor: settings.requireReasonFor,
      controlIntent: settings.controlIntent,
      matrix: controlMatrix,
      activeScheduleWindows: settings.scheduleWindows.filter((window) => window.active),
      scheduleWindows: settings.scheduleWindows,
      validation: settings.validation,
      decision: {
        accepted: result.controls.accepted,
        audit: result.controls.audit,
        activeWindow: result.controls.activeWindow
      },
      nextAction
    },
    provider: {
      contract: providerContract,
      negotiation: providerNegotiation,
      acknowledgement: {
        envelope: providerAck,
        decision: providerAckDecision,
        candidateState: {
          state: providerAckStateContract.state,
          generation: providerAckStateContract.generation,
          activeCommandId: providerAckStateContract.activeCommandId,
          restartSafe: providerAckStateContract.restartSafe,
          recoveryAudit: providerAckStateContract.recovery?.audit || null
        },
        appliedState: {
          state: reconciledStateContract.state,
          generation: reconciledStateContract.generation,
          activeCommandId: reconciledStateContract.activeCommandId,
          restartSafe: reconciledStateContract.restartSafe
        }
      },
      sync: providerSync,
      externalHandoff,
      dispatch: providerDispatch
    },
    client: {
      ...clientState,
      previewAcceptance,
      routePreview,
      acceptanceEnvelope
    },
    scope: {
      tenantId: shapedState.tenantId,
      workspaceId: shapedState.workspaceId,
      requestedTenantId: result.boundary.scope.requestedTenantId,
      requestedWorkspaceId: result.boundary.scope.requestedWorkspaceId,
      tenantMatched: result.boundary.scope.tenantMatched,
      workspaceMatched: result.boundary.scope.workspaceMatched,
      actorTenantMatched: result.boundary.scope.actorTenantMatched,
      actorWorkspaceMatched: result.boundary.scope.actorWorkspaceMatched,
      actorTenantBound: result.boundary.scope.actorTenantBound,
      actorWorkspaceBound: result.boundary.scope.actorWorkspaceBound,
      matchedActorScopedTenant: result.boundary.scope.matchedActorScopedTenant,
      isolation: boundaryProof.isolation,
      policy: boundaryProof.policy,
      proof: boundaryProof.scope
    },
    actor: {
      actorId: actor.actorId,
      roles: actor.roles,
      permissions: actor.permissions,
      scopePolicy: actor.scopePolicy
    },
    command: {
      name: command.name,
      commandId: command.commandId,
      accepted: result.accepted,
      idempotent: result.idempotent,
      replayed: result.replayed === true,
      audit: result.audit,
      reason: command.reason,
      requiredPermission: result.boundary.requiredPermission || null,
      controlsAudit: result.controls.audit,
      boundary: {
        accepted: boundaryProof.accepted,
        audit: boundaryProof.audit,
        requiredPermission: boundaryProof.requiredPermission,
        permissionSatisfied: boundaryProof.permissionSatisfied,
        policy: boundaryProof.policy,
        isolation: boundaryProof.isolation
      },
      ledger: {
        retainedEntries: shapedState.commandLedger.length,
        persistedReplay: result.replayed === true && result.replay
          ? {
              commandId: result.replay.commandId,
              command: result.replay.command,
              outcome: result.replay.outcome,
              audit: result.replay.audit,
              state: result.replay.state,
              generation: result.replay.generation,
              restartSafe: result.replay.restartSafe,
              boundaryAudit: result.replay.boundaryAudit || null,
              completed: result.replay.completed,
              at: result.replay.at,
              decision: result.replayDecision || null
            }
          : null,
        latestEntry: shapedState.commandLedger[shapedState.commandLedger.length - 1] || null
      }
    },
    health: {
      status: operationalHealth.status,
      degradedMode: operationalHealth.degradedMode,
      validation: operationalHealth.validation,
      failureState: operationalHealth.failureState,
      retry: {
        advice: operationalHealth.retry.advice,
        retryAfterMs: operationalHealth.retry.retryAfterMs,
        exhausted: operationalHealth.retry.exhausted,
        nextRetryAt: operationalHealth.retry.state.nextRetryAt
      },
      gate: operationalHealth.gate,
      retryGate: operationalHealth.retryGate,
      actionableErrors: operationalHealth.errors
    },
    nextAction,
    restart: {
      restartSafe: shapedState.restartSafe,
      recoveredFrom: shapedState.recoveredFrom,
      status: shapedState.recovery?.status || (shapedState.restartSafe ? "stable" : "in-flight"),
      statusSemantics: shapedState.restartStatus,
      recovery: shapedState.recovery,
      persistence,
      commandRecovery: {
        activeCommandId: shapedState.activeCommandId,
        ledgerEntries: shapedState.commandLedger.length,
        replayedCommand: result.replayed === true,
        replaySource: result.replay
          ? {
              commandId: result.replay.commandId,
              command: result.replay.command,
              audit: result.replay.audit,
              state: result.replay.state,
              generation: result.replay.generation
            }
          : null
      }
    },
    auditHandoff: {
      surfaceId,
      tenantId: shapedState.tenantId,
      workspaceId: shapedState.workspaceId,
      actorId: actor.actorId,
      providerId: providerContract.providerId,
      commandId: command.commandId,
      decision: result.accepted ? "accepted" : "rejected",
      audit: result.audit,
      healthStatus: operationalHealth.status,
      healthGateAudit: operationalHealth.gate.audit,
      healthGateAccepted: operationalHealth.gate.accepted,
      healthGateAllowedCommands: operationalHealth.gate.allowedCommands,
      retryGateAudit: operationalHealth.retryGate.audit,
      retryGateAccepted: operationalHealth.retryGate.accepted,
      retryGateBackoffActive: operationalHealth.retryGate.backoffActive,
      retryGateNextRetryAt: operationalHealth.retryGate.nextRetryAt,
      retryGateRetryAfterMs: operationalHealth.retryGate.retryAfterMs,
      retryAdvice: operationalHealth.retry.advice,
      nextActionType: nextAction.type,
      handoffState: externalHandoff.state,
      providerDispatchState: providerDispatch.state,
      providerDispatchable: providerDispatch.dispatchable,
      providerDispatchBlockedBy: providerDispatch.blockedBy,
      controlsEnabledCommands: controlMatrix.enabledCommands,
      controlsRequestedCommandEnabled: controlMatrix.requestedCommandEnabled,
      controlsNextStateChangingCommand: controlMatrix.nextStateChangingCommand,
      controlsIntentAudit: settings.controlIntent.audit,
      controlsIntentApplied: settings.controlIntent.applied,
      controlsIntentAction: settings.controlIntent.action,
      controlsIntentChanges: settings.controlIntent.changes,
      boundaryAudit: boundaryProof.audit,
      boundaryPolicyAudit: boundaryProof.policy.audit,
      boundaryPolicyAccepted: boundaryProof.policy.accepted,
      boundaryActorScopeRequired: boundaryProof.policy.requiresActorScope,
      boundaryExplicitScopeRequired: boundaryProof.policy.requiresExplicitScope,
      boundaryTenantScopeSource: boundaryProof.policy.tenantScopeSource,
      boundaryWorkspaceScopeSource: boundaryProof.policy.workspaceScopeSource,
      requestScopeMatched: boundaryProof.scope.tenantMatched && boundaryProof.scope.workspaceMatched,
      actorScopeMatched: boundaryProof.scope.actorTenantMatched && boundaryProof.scope.actorWorkspaceMatched,
      tenantIsolated: boundaryProof.isolation.tenantIsolated,
      workspaceIsolated: boundaryProof.isolation.workspaceIsolated,
      crossTenantBlocked: boundaryProof.isolation.crossTenantBlocked,
      crossWorkspaceBlocked: boundaryProof.isolation.crossWorkspaceBlocked,
      providerAcknowledgementAudit: providerAckDecision.audit,
      providerAcknowledgementApplied: providerAckDecision.applied,
      providerAcknowledgementValidationAudit: providerAckDecision.validation?.audit || null,
      providerAcknowledgementGenerationAccepted: providerAckDecision.validation?.generation?.accepted ?? null,
      providerAcknowledgementHandoffAccepted: providerAckDecision.validation?.handoff?.accepted ?? null,
      providerAcknowledgementExpectedCorrelationId: providerAckDecision.validation?.handoff?.expectedCorrelationId || null,
      providerAcknowledgementActualCorrelationId: providerAckDecision.validation?.handoff?.actualCorrelationId || null,
      persistenceStatus: persistence.status,
      persistenceMode: persistence.mode,
      persistenceRequired: persistence.required,
      persistenceIdempotencyKey: persistence.idempotency.key,
      persistenceWriteBarrierSatisfied: persistence.writeBarrier.satisfied,
      restartRecoveryAudit: shapedState.recovery?.audit || null,
      restartRecoveryApplied: shapedState.recovery?.applied === true,
      restartOrphanedActiveCommandId: shapedState.recovery?.orphanedActiveCommandId || null,
      restartStatusGate: shapedState.restartStatus?.stateChangeGate || null,
      restartStatusSafeForStateChange: shapedState.restartStatus?.safeForStateChange ?? null,
      restartStatusCheckpointRequired: shapedState.restartStatus?.checkpointRequired ?? null,
      clientId: clientState.runtime.clientId,
      clientSessionId: clientState.runtime.sessionId,
      clientWorkflowState: clientState.workflow.state,
      clientPreviewReadiness: previewAcceptance.readiness.state,
      clientPreviewBlockedCount: previewAcceptance.readiness.blockedCount,
      clientPreviewNextStepType: previewAcceptance.nextSteps[0]?.type || null,
      clientRoutePreviewCanAccept: routePreview.acceptance.canAccept,
      clientRoutePreviewPrimaryAction: routePreview.actions.primary.actionId,
      clientRoutePreviewValidationChipCount: routePreview.validationSummary.chipCount,
      clientRouteHandoffPlanId: clientState.workflow.routeHandoff.plan.planId,
      clientRouteHandoffPlanReady: clientState.workflow.routeHandoff.plan.ready,
      clientRouteHandoffActionType: clientState.workflow.routeHandoff.plan.actionType,
      clientRouteHandoffReplayKey: clientState.workflow.routeHandoff.plan.replay.key,
      clientRouteHandoffBlockers: clientState.workflow.routeHandoff.plan.blockers,
      clientAcceptanceEnvelopeState: acceptanceEnvelope.state,
      clientAcceptanceEnvelopeReady: acceptanceEnvelope.readyToSubmit,
      clientAcceptanceEnvelopeMode: acceptanceEnvelope.submitMode,
      clientAcceptanceEnvelopeDisabledReason: acceptanceEnvelope.disabledReason,
      clientCacheInvalidationRequired: clientState.workflow.cacheInvalidation.required,
      analyticsCurrentStateAgeMs: residencyAnalytics.currentStateAgeMs,
      analyticsUnstableResidencyMs: residencyAnalytics.unstableMs,
      analyticsCommandFunnelSubmitted: commandFunnelAnalytics.submitted,
      analyticsCommandFunnelRejected: commandFunnelAnalytics.rejected,
      analyticsDominantRejectionAudit: commandFunnelAnalytics.dominantRejectionAudit?.audit || null,
      analyticsReplayCoverageRatio: replayFailureAnalytics.replayCoverageRatio,
      analyticsReplayableCommands: replayFailureAnalytics.replayable,
      analyticsNonReplayableCommands: replayFailureAnalytics.nonReplayable,
      analyticsLatestFailureCode: replayFailureAnalytics.latestFailure?.code || null,
      analyticsLatestFailureRetryable: replayFailureAnalytics.latestFailure?.retryable ?? null,
      commandReplayDecisionAudit: result.replayDecision?.audit || null,
      commandReplayDecisionAccepted: result.replayDecision?.accepted ?? null,
      commandReplayDecisionBlockers: result.replayDecision?.blockers || [],
      commandReplayBoundaryAudit: result.replayDecision?.boundary?.audit || null,
      commandReplayBoundaryTenantMatched: result.replayDecision?.boundary?.tenantMatched ?? null,
      commandReplayBoundaryWorkspaceMatched: result.replayDecision?.boundary?.workspaceMatched ?? null,
      syncCursor: providerSync.cursor,
      syncFreshness: providerSync.freshness,
      generatedAt: now
    },
    proof: {
      schemaVersion: shapedState.schemaVersion,
      generation: shapedState.generation,
      transitionCount: shapedState.history.length,
      lastTransition: shapedState.history[shapedState.history.length - 1] || null,
      healthStatus: operationalHealth.status,
      healthGateAudit: operationalHealth.gate.audit,
      healthGateAccepted: operationalHealth.gate.accepted,
      healthGateLatestErrorCode: operationalHealth.gate.latestErrorCode,
      retryGateAudit: operationalHealth.retryGate.audit,
      retryGateAccepted: operationalHealth.retryGate.accepted,
      retryGateBackoffActive: operationalHealth.retryGate.backoffActive,
      retryGateRetryAfterMs: operationalHealth.retryGate.retryAfterMs,
      actionableErrorCount: operationalHealth.errors.length,
      analyticsWindowSize: historyAnalytics.windowSize,
      exportRowCount: analyticsExports.summary.rows,
      exportReady: analyticsExports.summary.exportReady,
      historySnapshotCount: historySnapshots.length,
      stateResidencySamples: residencyAnalytics.samples,
      currentStateAgeMs: residencyAnalytics.currentStateAgeMs,
      unstableResidencyMs: residencyAnalytics.unstableMs,
      unstableResidencyRatio: residencyAnalytics.unstableRatio,
      commandFunnelSubmitted: commandFunnelAnalytics.submitted,
      commandFunnelRejected: commandFunnelAnalytics.rejected,
      commandFunnelAcceptanceRatio: commandFunnelAnalytics.acceptanceRatio,
      commandFunnelDominantRejectionAudit: commandFunnelAnalytics.dominantRejectionAudit?.audit || null,
      replayCoverageRatio: replayFailureAnalytics.replayCoverageRatio,
      replayableCommandCount: replayFailureAnalytics.replayable,
      nonReplayableCommandCount: replayFailureAnalytics.nonReplayable,
      latestFailureCode: replayFailureAnalytics.latestFailure?.code || null,
      latestFailureAction: replayFailureAnalytics.latestFailure?.action || null,
      ledgerAcceptedCount: ledgerAnalytics.byOutcome.accepted || 0,
      ledgerRejectedCount: ledgerAnalytics.byOutcome.rejected || 0,
      lifecycleReportPhase: reportState.lifecyclePhase,
      lifecycleReportId: reportState.reportId,
      commandLedgerSize: shapedState.commandLedger.length,
      commandReplayed: result.replayed === true,
      commandReplayAudit: result.replay?.audit || null,
      commandReplayDecision: result.replayDecision || null,
      settingsValid: settings.validation.valid,
      settingsControlIntentAudit: settings.controlIntent.audit,
      settingsControlIntentApplied: settings.controlIntent.applied,
      enabledControlCommands: controlMatrix.enabledCommands,
      requestedControlEnabled: controlMatrix.requestedCommandEnabled,
      controlsDecision: result.controls.audit,
      boundaryAccepted: boundaryProof.accepted,
      boundaryAudit: boundaryProof.audit,
      boundaryPolicyAudit: boundaryProof.policy.audit,
      boundaryPolicyAccepted: boundaryProof.policy.accepted,
      boundaryActorScopeRequired: boundaryProof.policy.requiresActorScope,
      boundaryExplicitScopeRequired: boundaryProof.policy.requiresExplicitScope,
      boundaryProof,
      providerContractVersion: providerContract.contractVersion,
      providerCapabilitiesAccepted: providerNegotiation.accepted,
      providerMissingCapabilityCount: providerNegotiation.missingCapabilities.length,
      providerAcknowledgementAudit: providerAckDecision.audit,
      providerAcknowledgementApplied: providerAckDecision.applied,
      providerAcknowledgementCommandId: providerAck.commandId,
      providerAcknowledgementTerminalState: providerAck.terminalState,
      providerAcknowledgementValidationAudit: providerAckDecision.validation?.audit || null,
      providerAcknowledgementValidationChecks: providerAckDecision.validation?.checks || [],
      providerAcknowledgementExpectedGeneration: providerAckDecision.validation?.generation?.expectedMinimumGeneration ?? null,
      providerAcknowledgementMaximumGeneration: providerAckDecision.validation?.generation?.expectedMaximumGeneration ?? null,
      providerAcknowledgementProviderGeneration: providerAckDecision.validation?.generation?.providerGeneration ?? null,
      persistenceStatus: persistence.status,
      persistenceRequired: persistence.required,
      persistenceIdempotencyKey: persistence.idempotency.key,
      persistenceWriteBarrierSatisfied: persistence.writeBarrier.satisfied,
      restartRecoveryAudit: shapedState.recovery?.audit || null,
      restartRecoveryApplied: shapedState.recovery?.applied === true,
      restartRecoveryCheckpoint: shapedState.recovery?.checkpoint || null,
      syncCursor: providerSync.cursor,
      syncFreshness: providerSync.freshness,
      providerDispatchState: providerDispatch.state,
      providerDispatchable: providerDispatch.dispatchable,
      providerDispatchBlockedBy: providerDispatch.blockedBy,
      providerDispatchId: providerDispatch.dispatchId,
      externalHandoffState: externalHandoff.state,
      clientWorkflowState: clientState.workflow.state,
      clientPreviewReadiness: previewAcceptance.readiness.state,
      clientPreviewValid: previewAcceptance.validationSummary.valid,
      clientPreviewNextStepCount: previewAcceptance.nextSteps.length,
      clientRoutePreviewCanAccept: routePreview.acceptance.canAccept,
      clientRoutePreviewPrimaryAction: routePreview.actions.primary.actionId,
      clientRoutePreviewToken: routePreview.acceptance.token,
      clientRoutePreviewValidationChipCount: routePreview.validationSummary.chipCount,
      clientRouteHandoffPlanId: clientState.workflow.routeHandoff.plan.planId,
      clientRouteHandoffPlanReady: clientState.workflow.routeHandoff.plan.ready,
      clientRouteHandoffActionType: clientState.workflow.routeHandoff.plan.actionType,
      clientRouteHandoffReplayKey: clientState.workflow.routeHandoff.plan.replay.key,
      clientRouteHandoffPayloadFields: clientState.workflow.routeHandoff.plan.payloadContract.requiredFields,
      clientAcceptanceEnvelopeReady: acceptanceEnvelope.readyToSubmit,
      clientAcceptanceEnvelopeState: acceptanceEnvelope.state,
      clientAcceptanceEnvelopeMode: acceptanceEnvelope.submitMode,
      clientAcceptanceEnvelopeGuardCount: acceptanceEnvelope.guards.length,
      clientAcceptanceEnvelopeBlockedGuardCount: acceptanceEnvelope.guards.filter((guard) => !guard.satisfied).length,
      clientAcceptanceEnvelopeIdempotencyKey: acceptanceEnvelope.nextRequest.idempotencyKey,
      clientHandoffSupported: clientState.workflow.handoff.supported,
      clientCacheInvalidationRequired: clientState.workflow.cacheInvalidation.required,
      clientObservedGeneration: clientRuntime.observedGeneration,
      nextAction,
      reportingSnapshot
    },
    evidence
  };
}

export default describeStateTransitionSurface;
