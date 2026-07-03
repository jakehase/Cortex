export const surfaceId = "aios_kernel-lifecycle_job-thread-link_006";
export const surfaceGroup = "kernel-lifecycle";
export const surfaceName = "job-thread-link";

const COMMANDS = new Set(["inspect", "enable", "disable", "schedule", "pause", "resume"]);
const MUTATING_COMMANDS = new Set(["enable", "disable", "schedule", "pause", "resume"]);
const REQUIRED_CAPABILITIES = Object.freeze(["job-thread-link", "link-proof", "sync-cursor"]);
const PROVIDER_SYNC_MODES = Object.freeze(["cursor", "snapshot", "event-log"]);
const PROVIDER_HANDOFF_MODES = Object.freeze(["none", "ticket", "callback", "deep-link"]);
const PROVIDER_SERVICE_STATES = Object.freeze(["ready", "degraded", "unhealthy", "disabled"]);
const EXTERNAL_HANDOFF_STATES = Object.freeze(["not-required", "available", "pending", "blocked"]);
const LINK_PROOF_STATES = Object.freeze(["valid", "pending", "expired", "revoked", "failed"]);
const CLIENT_DISPATCH_MODES = Object.freeze(["auto", "manual", "preview", "external"]);
const CLIENT_WORKFLOW_STATES = Object.freeze(["ready", "preview", "handoff", "blocked", "waiting"]);
const CLIENT_REQUEST_ORIGINS = Object.freeze(["interactive", "api", "scheduler", "provider-callback"]);
const CLIENT_CONTINUATION_MODES = Object.freeze(["dispatch", "preview", "external-handoff", "wait", "blocked"]);
const WORKSPACE_BOUNDARY_MODES = Object.freeze(["strict", "quarantine"]);
const HEALTH_FAILURE_STATES = Object.freeze(["nominal", "degraded", "retrying", "blocked", "exhausted"]);
const COMMAND_PERMISSIONS = Object.freeze({
  inspect: "job-thread-link:read",
  enable: "job-thread-link:operate",
  disable: "job-thread-link:operate",
  schedule: "job-thread-link:schedule",
  pause: "job-thread-link:operate",
  resume: "job-thread-link:operate"
});
const ROLE_PERMISSIONS = Object.freeze({
  "kernel.viewer": ["job-thread-link:read"],
  "kernel.operator": ["job-thread-link:read", "job-thread-link:operate", "job-thread-link:schedule"],
  "tenant.admin": [
    "job-thread-link:read",
    "job-thread-link:operate",
    "job-thread-link:schedule",
    "job-thread-link:workspace:all"
  ],
  "system.admin": [
    "job-thread-link:read",
    "job-thread-link:operate",
    "job-thread-link:schedule",
    "job-thread-link:workspace:all",
    "job-thread-link:tenant:all"
  ]
});
const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  maxLinkedJobs: 8,
  staleAfterMs: 15 * 60 * 1000,
  scheduleEveryMs: 5 * 60 * 1000,
  retryBackoffBaseMs: 30 * 1000,
  retryBackoffMaxMs: 10 * 60 * 1000,
  degradedAfterFailures: 3,
  proofRequired: true
});
const DEFAULT_HEALTH_POLICY = Object.freeze({
  maxRetryAttempts: 6,
  retryJitterRatio: 0,
  degradedReadOnly: true,
  persistBackoff: true,
  failClosedOnRetryExhausted: true
});
const DEFAULT_PROVIDER_SERVICE_CONTRACT = Object.freeze({
  version: "hosted-kernel.job-thread-link.provider-service.v1",
  syncMode: "cursor",
  maxBatchSize: 128,
  requiresProofLedger: true,
  supportsExternalHandoff: false
});
const RESTART_SENSITIVE_SETTINGS = Object.freeze([
  "maxLinkedJobs",
  "staleAfterMs",
  "proofRequired"
]);
const SCHEDULE_CONTROL_BOUNDS = Object.freeze({
  minIntervalMs: 10_000,
  maxIntervalMs: 86_400_000,
  maxHoldMs: 7 * 86_400_000
});
const SCHEDULE_MISFIRE_POLICIES = Object.freeze(["run-now", "skip", "hold"]);
const SCHEDULE_WINDOW_POLICIES = Object.freeze(["always", "inside-window"]);
const PERSISTED_COMMAND_JOURNAL_LIMIT = 16;

function toIso(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.trunc(value);
  if (normalized < min || normalized > max) return fallback;
  return normalized;
}

function asRatio(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, Number(value)));
}

function normalizeSettings(input = {}) {
  const warnings = [];
  const settings = {
    enabled: asBoolean(input.enabled, DEFAULT_SETTINGS.enabled),
    maxLinkedJobs: asPositiveInteger(input.maxLinkedJobs, DEFAULT_SETTINGS.maxLinkedJobs, {
      min: 1,
      max: 128
    }),
    staleAfterMs: asPositiveInteger(input.staleAfterMs, DEFAULT_SETTINGS.staleAfterMs, {
      min: 30_000,
      max: 86_400_000
    }),
    scheduleEveryMs: asPositiveInteger(input.scheduleEveryMs, DEFAULT_SETTINGS.scheduleEveryMs, {
      min: 10_000,
      max: 86_400_000
    }),
    retryBackoffBaseMs: asPositiveInteger(input.retryBackoffBaseMs, DEFAULT_SETTINGS.retryBackoffBaseMs, {
      min: 1_000,
      max: 3_600_000
    }),
    retryBackoffMaxMs: asPositiveInteger(input.retryBackoffMaxMs, DEFAULT_SETTINGS.retryBackoffMaxMs, {
      min: 5_000,
      max: 86_400_000
    }),
    degradedAfterFailures: asPositiveInteger(input.degradedAfterFailures, DEFAULT_SETTINGS.degradedAfterFailures, {
      min: 1,
      max: 25
    }),
    proofRequired: asBoolean(input.proofRequired, DEFAULT_SETTINGS.proofRequired)
  };

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Object.hasOwn(input, key) && input[key] !== settings[key]) {
      warnings.push({
        code: `invalid_${key}`,
        message: `${key} was outside the hosted-kernel lifecycle contract and was normalized`
      });
    }
  }

  if (settings.retryBackoffMaxMs < settings.retryBackoffBaseMs) {
    settings.retryBackoffMaxMs = settings.retryBackoffBaseMs;
    warnings.push({
      code: "invalid_retry_backoff_range",
      message: "retryBackoffMaxMs was below retryBackoffBaseMs and was raised to the base retry interval"
    });
  }

  return { settings, warnings };
}

function normalizeHealthPolicy(input = {}) {
  const source = input.healthPolicy || input.health?.policy || input.operationalHealth || {};
  const warnings = [];
  const policy = {
    contract: "hosted-kernel.job-thread-link.health-policy.v1",
    maxRetryAttempts: asPositiveInteger(source.maxRetryAttempts, DEFAULT_HEALTH_POLICY.maxRetryAttempts, {
      min: 1,
      max: 50
    }),
    retryJitterRatio: asRatio(source.retryJitterRatio, DEFAULT_HEALTH_POLICY.retryJitterRatio),
    degradedReadOnly: asBoolean(source.degradedReadOnly, DEFAULT_HEALTH_POLICY.degradedReadOnly),
    persistBackoff: asBoolean(source.persistBackoff, DEFAULT_HEALTH_POLICY.persistBackoff),
    failClosedOnRetryExhausted: asBoolean(
      source.failClosedOnRetryExhausted,
      DEFAULT_HEALTH_POLICY.failClosedOnRetryExhausted
    )
  };

  for (const key of Object.keys(DEFAULT_HEALTH_POLICY)) {
    if (Object.hasOwn(source, key) && source[key] !== policy[key]) {
      warnings.push({
        code: `invalid_health_policy_${key}`,
        message: `${key} was outside the hosted-kernel job-thread-link health policy contract and was normalized`
      });
    }
  }

  return { policy, warnings };
}

function normalizeCommand(command, settings) {
  if (!command) return settings.enabled ? "inspect" : "pause";
  return COMMANDS.has(command) ? command : "inspect";
}

function normalizeCommandJournal(source = {}) {
  const entries = Array.isArray(source.commandJournal)
    ? source.commandJournal
    : Array.isArray(source.commands)
      ? source.commands
      : Array.isArray(source.idempotencyJournal)
        ? source.idempotencyJournal
        : [];

  return entries.slice(-PERSISTED_COMMAND_JOURNAL_LIMIT).map((entry, index) => {
    const commandId = entry.commandId || entry.idempotencyKey || entry.requestId
      ? String(entry.commandId || entry.idempotencyKey || entry.requestId)
      : null;
    const requestedCommand = COMMANDS.has(entry.command) ? entry.command : null;
    const effectiveCommand = COMMANDS.has(entry.effectiveCommand) ? entry.effectiveCommand : requestedCommand;
    const persistedAt = toIso(entry.persistedAt || entry.completedAt || entry.at, null);

    return {
      contract: "hosted-kernel.job-thread-link.command-journal-entry.v1",
      sequence: asPositiveInteger(entry.sequence, index + 1, { min: 1, max: 10_000 }),
      commandId,
      command: requestedCommand,
      effectiveCommand,
      accepted: entry.accepted !== false,
      status: entry.status ? String(entry.status) : "persisted",
      lifecycleMode: entry.lifecycleMode ? String(entry.lifecycleMode) : null,
      healthStatus: entry.healthStatus ? String(entry.healthStatus) : null,
      recoveryStatus: entry.recoveryStatus ? String(entry.recoveryStatus) : null,
      cursor: entry.cursor ? String(entry.cursor) : null,
      generation: asPositiveInteger(entry.generation, 0, { min: 0 }),
      persistedAt
    };
  }).filter((entry) => entry.commandId);
}

function normalizePersistedState(input = {}, now) {
  const source = input.persistedState || input.state || input.checkpoint || {};
  const warnings = [];
  const generation = asPositiveInteger(source.generation, 0, { min: 0 });
  const restartCount = asPositiveInteger(source.restartCount, 0, { min: 0 });
  const lastCommandId = source.lastCommandId ? String(source.lastCommandId) : null;
  const lastCommand = COMMANDS.has(source.lastCommand) ? source.lastCommand : null;
  const lastStatus = source.lastStatus ? String(source.lastStatus) : null;
  const lastLifecycleMode = source.lastLifecycleMode ? String(source.lastLifecycleMode) : null;
  const lastCursor = source.cursor || source.syncCursor ? String(source.cursor || source.syncCursor) : null;
  const resumedFrom = source.persistedAt ? toIso(source.persistedAt, null) : null;
  const consecutiveFailureCount = asPositiveInteger(source.consecutiveFailureCount, 0, { min: 0, max: 1_000 });
  const lastFailureCode = source.lastFailureCode ? String(source.lastFailureCode) : null;
  const retryAfterAt = toIso(source.retryAfterAt, null);
  const controlMode = source.controlMode ? String(source.controlMode) : null;
  const operatorHoldUntilAt = toIso(source.operatorHoldUntilAt, null);
  const checkpointFingerprint = source.checkpointFingerprint || source.lastCheckpointFingerprint
    ? String(source.checkpointFingerprint || source.lastCheckpointFingerprint)
    : null;
  const lastAcceptedCommandId = source.lastAcceptedCommandId ? String(source.lastAcceptedCommandId) : null;
  const scheduleIntervalMs = asPositiveInteger(source.scheduleIntervalMs, null, {
    min: SCHEDULE_CONTROL_BOUNDS.minIntervalMs,
    max: SCHEDULE_CONTROL_BOUNDS.maxIntervalMs
  });
  const commandJournal = normalizeCommandJournal(source);
  const linkFingerprints = Array.isArray(source.linkFingerprints)
    ? source.linkFingerprints.map((fingerprint) => String(fingerprint)).filter(Boolean)
    : [];
  const analyticsHistory = Array.isArray(source.analyticsHistory)
    ? source.analyticsHistory
    : Array.isArray(source.history?.analytics)
      ? source.history.analytics
      : [];

  if (source.version && source.version !== "hosted-kernel.job-thread-link.state.v1") {
    warnings.push({
      code: "persisted_state_version_mismatch",
      message: "persisted job-thread-link state was recovered through the v1 compatibility path"
    });
  }

  return {
    state: {
      version: "hosted-kernel.job-thread-link.state.v1",
      recovered: Boolean(Object.keys(source).length),
      generation,
      restartCount,
      lastCommandId,
      lastCommand,
      lastStatus,
      lastLifecycleMode,
      cursor: lastCursor,
      consecutiveFailureCount,
      lastFailureCode,
      retryAfterAt,
      controlMode,
      operatorHoldUntilAt,
      scheduleIntervalMs,
      checkpointFingerprint,
      lastAcceptedCommandId,
      commandJournal,
      resumedFrom,
      resumedAt: now,
      linkFingerprints,
      analyticsHistory
    },
    warnings
  };
}

function linkFingerprint(link) {
  return `${link.tenantId || "tenant:unknown"}:${link.workspaceId || "workspace:unknown"}:${link.jobId}:${link.threadId}:${link.proofId || "no-proof"}:${link.stale ? "stale" : "fresh"}`;
}

function deriveCommandReceipt(command, input = {}, persistedState) {
  const idempotencyKey =
    input.commandId || input.idempotencyKey || input.requestId
      ? String(input.commandId || input.idempotencyKey || input.requestId)
      : null;
  const mutating = MUTATING_COMMANDS.has(command);
  const journalReplay = idempotencyKey
    ? persistedState.commandJournal.find((entry) => entry.commandId === idempotencyKey && entry.accepted)
    : null;
  const lastCommandReplay = Boolean(mutating && idempotencyKey && idempotencyKey === persistedState.lastCommandId);
  const replayed = Boolean(mutating && idempotencyKey && (journalReplay || lastCommandReplay));
  const effectiveCommand = replayed ? "inspect" : command;
  const previousOutcome = journalReplay
    ? {
        contract: "hosted-kernel.job-thread-link.idempotency-outcome.v1",
        commandId: journalReplay.commandId,
        command: journalReplay.command,
        effectiveCommand: journalReplay.effectiveCommand,
        lifecycleMode: journalReplay.lifecycleMode,
        healthStatus: journalReplay.healthStatus,
        recoveryStatus: journalReplay.recoveryStatus,
        cursor: journalReplay.cursor,
        generation: journalReplay.generation,
        persistedAt: journalReplay.persistedAt
      }
    : lastCommandReplay
      ? {
          contract: "hosted-kernel.job-thread-link.idempotency-outcome.v1",
          commandId: persistedState.lastCommandId,
          command: persistedState.lastCommand,
          effectiveCommand: persistedState.lastCommand,
          lifecycleMode: persistedState.lastLifecycleMode,
          healthStatus: null,
          recoveryStatus: persistedState.lastStatus,
          cursor: persistedState.cursor,
          generation: persistedState.generation,
          persistedAt: persistedState.resumedFrom
        }
      : null;

  return {
    contract: "hosted-kernel.job-thread-link.command-receipt.v1",
    command,
    effectiveCommand,
    idempotencyKey,
    mutating,
    replayed,
    replaySource: journalReplay ? "command-journal" : lastCommandReplay ? "last-command" : null,
    previousOutcome,
    accepted: !replayed,
    status: replayed ? "replayed-without-side-effects" : "accepted"
  };
}

function deriveLifecycleControls(input = {}, settings, commandReceipt, persistedState, nowMs) {
  const source = input.lifecycleControls || input.controls || {};
  const scheduleSource = source.schedule || input.schedule || {};
  const requestedSettings = input.settings && typeof input.settings === "object" ? input.settings : {};
  const controlWarnings = [];
  const settingsPatch = Object.keys(requestedSettings)
    .filter((key) => Object.hasOwn(DEFAULT_SETTINGS, key))
    .map((key) => {
      const requested = requestedSettings[key];
      const effective = settings[key];
      return {
        key,
        requested,
        effective,
        applied: requested === effective,
        restartRequired: RESTART_SENSITIVE_SETTINGS.includes(key)
      };
    });
  const changedSettings = settingsPatch.filter((entry) => entry.applied && entry.effective !== DEFAULT_SETTINGS[entry.key]);
  const normalizedSettings = settingsPatch.filter((entry) => !entry.applied).map((entry) => entry.key);
  const restartRequired = persistedState.recovered && changedSettings.some((entry) => entry.restartRequired);
  const requestedMode = source.mode ? String(source.mode) : null;
  const commandMode =
    commandReceipt.effectiveCommand === "disable"
      ? "disabled"
      : commandReceipt.effectiveCommand === "pause"
        ? "paused"
        : commandReceipt.effectiveCommand === "enable" || commandReceipt.effectiveCommand === "resume"
          ? "active"
          : null;
  const allowedModes = new Set(["active", "paused", "disabled", "scheduled"]);
  const effectiveMode = commandMode || (allowedModes.has(requestedMode) ? requestedMode : persistedState.controlMode) || "active";
  const requestedInterval =
    scheduleSource.intervalMs ?? scheduleSource.scheduleEveryMs ?? source.scheduleEveryMs ?? settings.scheduleEveryMs;
  const intervalMs = asPositiveInteger(requestedInterval, settings.scheduleEveryMs, {
    min: SCHEDULE_CONTROL_BOUNDS.minIntervalMs,
    max: SCHEDULE_CONTROL_BOUNDS.maxIntervalMs
  });
  const requestedHoldUntilAt = toIso(scheduleSource.holdUntilAt || source.holdUntilAt, null);
  const holdUntilMs = requestedHoldUntilAt ? new Date(requestedHoldUntilAt).getTime() : null;
  const persistedHoldUntilMs = persistedState.operatorHoldUntilAt
    ? new Date(persistedState.operatorHoldUntilAt).getTime()
    : null;
  const operatorHoldUntilAt =
    holdUntilMs && holdUntilMs > nowMs && holdUntilMs - nowMs <= SCHEDULE_CONTROL_BOUNDS.maxHoldMs
      ? requestedHoldUntilAt
      : persistedHoldUntilMs && persistedHoldUntilMs > nowMs
        ? persistedState.operatorHoldUntilAt
        : null;
  const requestedNextRunAt = toIso(scheduleSource.nextRunAt || source.nextRunAt, null);
  const forceRunNow = Boolean(scheduleSource.runNow || source.runNow || commandReceipt.effectiveCommand === "schedule");
  const requestedMisfirePolicy = scheduleSource.misfirePolicy || source.misfirePolicy;
  const misfirePolicy = SCHEDULE_MISFIRE_POLICIES.includes(requestedMisfirePolicy)
    ? requestedMisfirePolicy
    : commandReceipt.effectiveCommand === "pause" || operatorHoldUntilAt
      ? "hold"
      : "run-now";
  const requestedWindowPolicy = scheduleSource.windowPolicy || source.windowPolicy;
  const windowPolicy = SCHEDULE_WINDOW_POLICIES.includes(requestedWindowPolicy)
    ? requestedWindowPolicy
    : "always";
  const runWindowStartAt = toIso(scheduleSource.windowStartAt || source.windowStartAt, null);
  const runWindowEndAt = toIso(scheduleSource.windowEndAt || source.windowEndAt, null);
  const runWindowStartMs = runWindowStartAt ? new Date(runWindowStartAt).getTime() : null;
  const runWindowEndMs = runWindowEndAt ? new Date(runWindowEndAt).getTime() : null;
  const runWindowValid =
    windowPolicy === "always" ||
    (Number.isFinite(runWindowStartMs) &&
      Number.isFinite(runWindowEndMs) &&
      runWindowStartMs < runWindowEndMs &&
      runWindowEndMs > nowMs);
  const maxCatchUpRuns = asPositiveInteger(
    scheduleSource.maxCatchUpRuns ?? source.maxCatchUpRuns,
    1,
    { min: 0, max: 24 }
  );

  if (requestedMode && !allowedModes.has(requestedMode)) {
    controlWarnings.push({
      code: "invalid_lifecycle_control_mode",
      message: "lifecycleControls.mode was outside the hosted-kernel control contract and was ignored"
    });
  }

  if (requestedInterval !== intervalMs) {
    controlWarnings.push({
      code: "invalid_schedule_interval_control",
      message: "schedule interval control was outside the hosted-kernel lifecycle contract and was normalized"
    });
  }

  if (requestedHoldUntilAt && !operatorHoldUntilAt) {
    controlWarnings.push({
      code: "invalid_operator_hold_until",
      message: "operator hold was expired or beyond the maximum hosted-kernel hold window and was ignored"
    });
  }

  if (requestedMisfirePolicy && !SCHEDULE_MISFIRE_POLICIES.includes(requestedMisfirePolicy)) {
    controlWarnings.push({
      code: "invalid_schedule_misfire_policy",
      message: "schedule misfire policy was outside the hosted-kernel lifecycle contract and was normalized"
    });
  }

  if (requestedWindowPolicy && !SCHEDULE_WINDOW_POLICIES.includes(requestedWindowPolicy)) {
    controlWarnings.push({
      code: "invalid_schedule_window_policy",
      message: "schedule window policy was outside the hosted-kernel lifecycle contract and was normalized"
    });
  }

  if (windowPolicy === "inside-window" && !runWindowValid) {
    controlWarnings.push({
      code: "invalid_schedule_run_window",
      message: "schedule run window must include a future start/end range for hosted-kernel lifecycle execution"
    });
  }

  return {
    contract: "hosted-kernel.job-thread-link.lifecycle-controls.v1",
    effectiveMode,
    requestedMode,
    commandMode,
    enabled: effectiveMode !== "disabled" && settings.enabled,
    paused: effectiveMode === "paused",
    forceRunNow,
    requestedNextRunAt,
    operatorHoldUntilAt,
    scheduleIntervalMs: intervalMs,
    schedulePolicy: {
      contract: "hosted-kernel.job-thread-link.schedule-policy.v1",
      misfirePolicy,
      allowedMisfirePolicies: [...SCHEDULE_MISFIRE_POLICIES],
      windowPolicy,
      allowedWindowPolicies: [...SCHEDULE_WINDOW_POLICIES],
      runWindowStartAt: runWindowValid ? runWindowStartAt : null,
      runWindowEndAt: runWindowValid ? runWindowEndAt : null,
      runWindowValid,
      maxCatchUpRuns
    },
    settingsPatch,
    changedSettings,
    normalizedSettings,
    restartRequired,
    warnings: controlWarnings
  };
}

function normalizeJobThreads(input = {}, nowMs, settings, workspaceScope) {
  const jobs = Array.isArray(input.jobs) ? input.jobs : [];
  return jobs.slice(0, settings.maxLinkedJobs).map((job, index) => {
    const threadId = String(job.threadId || job.thread || `thread-${index + 1}`);
    const jobId = String(job.jobId || job.id || `job-${index + 1}`);
    const tenantId = normalizeId(job.tenantId || job.tenant, workspaceScope.tenantId);
    const workspaceId = normalizeId(job.workspaceId || job.workspace, workspaceScope.workspaceId);
    const updatedAt = toIso(job.updatedAt || job.lastSeenAt, new Date(nowMs).toISOString());
    const ageMs = Math.max(0, nowMs - new Date(updatedAt).getTime());
    const state = job.state || (ageMs > settings.staleAfterMs ? "stale" : "linked");

    return {
      jobId,
      threadId,
      tenantId,
      workspaceId,
      state,
      updatedAt,
      ageMs,
      stale: ageMs > settings.staleAfterMs,
      proofId: job.proofId ? String(job.proofId) : null,
      proofValid: !settings.proofRequired || Boolean(job.proofId),
      proofStatus: job.proofId ? "valid" : "missing",
      proofBlockedBy: job.proofId ? null : "missing_proof",
      proofSource: job.proofId ? "link" : "none",
      proofObservedAt: null,
      proofFingerprint: null
    };
  });
}

function proofJoinKey({ tenantId, workspaceId, jobId, threadId }) {
  return `${tenantId}/${workspaceId}/${jobId}/${threadId}`;
}

function normalizeLinkProofLedger(input = {}, links, workspaceScope, nowMs) {
  const source = input.proofLedger || input.linkProofLedger || {};
  const proofEntries = Array.isArray(source.entries)
    ? source.entries
    : Array.isArray(input.linkProofs)
      ? input.linkProofs
      : Array.isArray(input.proofs)
        ? input.proofs
        : [];
  const warnings = [];
  const byProofId = new Map();
  const byJoinKey = new Map();

  for (const proof of proofEntries.slice(0, 256)) {
    const proofId = proof.proofId || proof.id || proof.receiptId ? String(proof.proofId || proof.id || proof.receiptId) : null;
    const tenantId = normalizeId(proof.tenantId || proof.tenant, workspaceScope.tenantId);
    const workspaceId = normalizeId(proof.workspaceId || proof.workspace, workspaceScope.workspaceId);
    const jobId = proof.jobId || proof.job ? String(proof.jobId || proof.job) : null;
    const threadId = proof.threadId || proof.thread ? String(proof.threadId || proof.thread) : null;
    const requestedStatus = proof.status || proof.state ? String(proof.status || proof.state) : "valid";
    const status = LINK_PROOF_STATES.includes(requestedStatus) ? requestedStatus : "failed";
    const observedAt = toIso(proof.observedAt || proof.issuedAt || proof.createdAt, new Date(nowMs).toISOString());
    const expiresAt = toIso(proof.expiresAt || proof.validUntilAt, null);
    const expiredByTime = expiresAt ? new Date(expiresAt).getTime() <= nowMs : false;
    const normalized = {
      contract: "hosted-kernel.job-thread-link.proof-entry.v1",
      proofId,
      tenantId,
      workspaceId,
      jobId,
      threadId,
      status: expiredByTime && status === "valid" ? "expired" : status,
      observedAt,
      expiresAt,
      issuer: proof.issuer || proof.issuedBy ? String(proof.issuer || proof.issuedBy) : null,
      fingerprint: proof.fingerprint || proof.digest || proof.hash ? String(proof.fingerprint || proof.digest || proof.hash) : null
    };

    if (proofId) byProofId.set(proofId, normalized);
    if (jobId && threadId) byJoinKey.set(proofJoinKey({ tenantId, workspaceId, jobId, threadId }), normalized);
  }

  const proofedLinks = links.map((link) => {
    const ledgerProof = (link.proofId && byProofId.get(link.proofId)) || byJoinKey.get(proofJoinKey(link)) || null;
    const proofId = link.proofId || ledgerProof?.proofId || null;
    const ledgerRequired = proofEntries.length > 0;
    const proofStatus = ledgerProof ? ledgerProof.status : proofId && !ledgerRequired ? "valid" : "missing";
    const scopeMatches = ledgerProof
      ? ledgerProof.tenantId === link.tenantId &&
        ledgerProof.workspaceId === link.workspaceId &&
        (!ledgerProof.jobId || ledgerProof.jobId === link.jobId) &&
        (!ledgerProof.threadId || ledgerProof.threadId === link.threadId)
      : true;
    const proofValid = proofStatus === "valid" && scopeMatches && Boolean(proofId);
    const proofBlockedBy = !proofId
      ? "missing_proof"
      : !ledgerProof && ledgerRequired
        ? "proof_not_in_ledger"
        : !scopeMatches
          ? "proof_scope_mismatch"
          : proofStatus !== "valid"
            ? `proof_${proofStatus}`
            : null;

    if (proofBlockedBy && proofBlockedBy !== "missing_proof") {
      warnings.push({
        code: proofBlockedBy,
        proofId,
        message: `link proof ${proofId} did not satisfy the hosted-kernel job-thread-link proof contract`
      });
    }

    return {
      ...link,
      proofId,
      proofValid,
      proofStatus,
      proofBlockedBy,
      proofSource: ledgerProof ? "proof-ledger" : proofId ? "link" : "none",
      proofObservedAt: ledgerProof ? ledgerProof.observedAt : null,
      proofExpiresAt: ledgerProof ? ledgerProof.expiresAt : null,
      proofIssuer: ledgerProof ? ledgerProof.issuer : null,
      proofFingerprint: ledgerProof ? ledgerProof.fingerprint : null
    };
  });
  const invalidLinks = proofedLinks.filter((link) => !link.proofValid);

  return {
    contract: "hosted-kernel.job-thread-link.proof-ledger.v1",
    source: proofEntries.length ? "request-ledger" : "embedded-link-proof",
    ledgerEntryCount: proofEntries.length,
    required: true,
    proofedLinkCount: proofedLinks.filter((link) => link.proofValid).length,
    invalidLinkCount: invalidLinks.length,
    invalidProofReasons: normalizeCapabilityList(invalidLinks.map((link) => link.proofBlockedBy)),
    warnings,
    links: proofedLinks
  };
}

function normalizeCapabilityList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((capability) => String(capability || "").trim()).filter(Boolean))].sort();
}

function normalizeCommandList(value, fallback = ["inspect"]) {
  const requested = Array.isArray(value) && value.length ? value : fallback;
  return [...new Set(requested.map((command) => String(command || "").trim()).filter((command) => COMMANDS.has(command)))].sort();
}

function normalizeId(value, fallback) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeWorkspaceScope(input = {}) {
  const source = input.workspaceScope || input.workspace || input.scope || {};
  const tenantId = normalizeId(source.tenantId || input.tenantId, "tenant:default");
  const workspaceId = normalizeId(source.workspaceId || input.workspaceId, "workspace:default");
  const allowedTenantIds = normalizeCapabilityList(
    source.allowedTenantIds || source.allowedTenants || input.allowedTenantIds || [tenantId]
  );
  const allowedWorkspaceIds = normalizeCapabilityList(
    source.allowedWorkspaceIds || source.allowedWorkspaces || input.allowedWorkspaceIds || [workspaceId]
  );
  const deniedWorkspaceIds = normalizeCapabilityList(
    source.deniedWorkspaceIds || source.deniedWorkspaces || input.deniedWorkspaceIds || []
  );
  const requestedBoundaryMode = source.boundaryMode || input.boundaryMode;
  const boundaryMode = WORKSPACE_BOUNDARY_MODES.includes(requestedBoundaryMode)
    ? requestedBoundaryMode
    : "quarantine";
  const auditSink = source.auditSink || input.auditSink ? String(source.auditSink || input.auditSink) : null;

  if (!allowedTenantIds.includes(tenantId)) allowedTenantIds.push(tenantId);
  if (!allowedWorkspaceIds.includes(workspaceId)) allowedWorkspaceIds.push(workspaceId);

  return {
    contract: "hosted-kernel.job-thread-link.workspace-scope.v1",
    tenantId,
    workspaceId,
    allowedTenantIds: allowedTenantIds.sort(),
    allowedWorkspaceIds: allowedWorkspaceIds.sort(),
    deniedWorkspaceIds,
    boundaryMode,
    auditSink
  };
}

function normalizePrincipal(input = {}, workspaceScope) {
  const source = input.principal || input.actor || input.subject || {};
  const roles = normalizeCapabilityList(source.roles || input.roles || ["kernel.viewer"]);
  const rolePermissions = roles.flatMap((role) => ROLE_PERMISSIONS[role] || []);
  const permissions = normalizeCapabilityList([
    ...rolePermissions,
    ...(Array.isArray(source.permissions) ? source.permissions : []),
    ...(Array.isArray(input.permissions) ? input.permissions : [])
  ]);

  return {
    contract: "hosted-kernel.job-thread-link.principal.v1",
    principalId: normalizeId(source.principalId || source.id || input.principalId, "anonymous"),
    tenantId: normalizeId(source.tenantId || input.principalTenantId || input.tenantId, workspaceScope.tenantId),
    roles,
    permissions
  };
}

function normalizeClientRuntime(input = {}, workspaceScope, principal, now) {
  const source = input.clientRuntime || input.client || input.request?.client || {};
  const requestSource = input.request || {};
  const workflow = source.workflow || input.workflow || {};
  const requestedDispatchMode = source.dispatchMode || workflow.dispatchMode || input.dispatchMode;
  const dispatchMode = CLIENT_DISPATCH_MODES.includes(requestedDispatchMode) ? requestedDispatchMode : "auto";
  const requestedWorkflowState = source.workflowState || workflow.state;
  const workflowState = CLIENT_WORKFLOW_STATES.includes(requestedWorkflowState) ? requestedWorkflowState : "preview";
  const requestedOrigin = source.requestOrigin || source.origin || requestSource.origin || input.requestOrigin;
  const requestOrigin = CLIENT_REQUEST_ORIGINS.includes(requestedOrigin) ? requestedOrigin : "interactive";
  const routeBase = source.routeBase || workflow.routeBase || `/kernel-lifecycle/${surfaceName}`;
  const surfaceRoute = source.surfaceRoute || workflow.surfaceRoute || `${routeBase}/${workspaceScope.workspaceId}`;
  const callbackRoute = source.callbackRoute || workflow.callbackRoute || requestSource.callbackRoute || null;
  const returnUrl = source.returnUrl || workflow.returnUrl || input.returnUrl || null;
  const requestId = source.requestId || input.requestId || input.commandId || input.idempotencyKey || null;
  const parentRequestId = source.parentRequestId || workflow.parentRequestId || requestSource.parentRequestId || null;
  const capabilities = normalizeCapabilityList(source.capabilities || workflow.capabilities || input.clientCapabilities || []);
  const handoffPreference = source.handoffPreference || workflow.handoffPreference || null;
  const requestedContinuationKey =
    source.continuationKey || workflow.continuationKey || requestSource.continuationKey || input.continuationKey || null;
  const canRenderPreview = source.canRenderPreview !== false && dispatchMode !== "external";
  const canDispatch = dispatchMode !== "preview" && capabilities.includes("kernel-lifecycle:dispatch");
  const canAcceptExternalHandoff =
    dispatchMode === "external" ||
    capabilities.includes("external-handoff") ||
    handoffPreference === "external";

  return {
    contract: "hosted-kernel.job-thread-link.client-runtime.v1",
    observedAt: now,
    requestId: requestId ? String(requestId) : null,
    sessionId: source.sessionId || source.tabId || input.sessionId ? String(source.sessionId || source.tabId || input.sessionId) : null,
    requestOrigin,
    parentRequestId: parentRequestId ? String(parentRequestId) : null,
    continuationKey: requestedContinuationKey ? String(requestedContinuationKey) : null,
    routeBase: String(routeBase),
    surfaceRoute: String(surfaceRoute),
    callbackRoute: callbackRoute ? String(callbackRoute) : null,
    returnUrl: returnUrl ? String(returnUrl) : null,
    workflowState,
    dispatchMode,
    principalId: principal.principalId,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    capabilities,
    canRenderPreview,
    canDispatch,
    canAcceptExternalHandoff,
    handoffPreference: handoffPreference ? String(handoffPreference) : null,
    requestState: {
      contract: "hosted-kernel.job-thread-link.client-request-state.v1",
      origin: requestOrigin,
      requestId: requestId ? String(requestId) : null,
      parentRequestId: parentRequestId ? String(parentRequestId) : null,
      continuationKey: requestedContinuationKey ? String(requestedContinuationKey) : null,
      callbackRoute: callbackRoute ? String(callbackRoute) : null,
      returnUrl: returnUrl ? String(returnUrl) : null,
      workflowState,
      dispatchMode
    }
  };
}

function deriveBoundary({ command, workspaceScope, principal, links }) {
  const requiredPermission = COMMAND_PERMISSIONS[command] || COMMAND_PERMISSIONS.inspect;
  const commandAllowed = principal.permissions.includes(requiredPermission);
  const tenantWideAllowed = principal.permissions.includes("job-thread-link:tenant:all");
  const workspaceWideAllowed = principal.permissions.includes("job-thread-link:workspace:all");
  const tenantAllowed = principal.tenantId === workspaceScope.tenantId || tenantWideAllowed;
  const canQuarantineWorkspaceViolations =
    command === "inspect" && workspaceScope.boundaryMode === "quarantine" && commandAllowed && tenantAllowed;
  const scopedLinks = [];
  const rejectedLinks = [];

  for (const link of links) {
    const inTenant = workspaceScope.allowedTenantIds.includes(link.tenantId);
    const explicitlyDeniedWorkspace = workspaceScope.deniedWorkspaceIds.includes(link.workspaceId);
    const inWorkspace =
      workspaceWideAllowed ||
      (workspaceScope.allowedWorkspaceIds.includes(link.workspaceId) && !explicitlyDeniedWorkspace);
    const rejectionReason = !inTenant
      ? "tenant_boundary_violation"
      : explicitlyDeniedWorkspace
        ? "workspace_explicitly_denied"
        : !inWorkspace
          ? "workspace_scope_violation"
          : null;

    if (rejectionReason) {
      const hardRejected = rejectionReason === "tenant_boundary_violation" || !canQuarantineWorkspaceViolations;
      rejectedLinks.push({
        ...link,
        rejectionReason,
        hardRejected,
        quarantineEligible: !hardRejected,
        auditDisposition: hardRejected ? "blocked" : "quarantined"
      });
    } else {
      scopedLinks.push({ ...link, scoped: true });
    }
  }

  const hasTenantLeak = rejectedLinks.some((link) => link.rejectionReason === "tenant_boundary_violation");
  const hardRejectedLinks = rejectedLinks.filter((link) => link.hardRejected);
  const quarantinedLinks = rejectedLinks.filter((link) => !link.hardRejected);
  const hasWorkspaceLeak = hardRejectedLinks.some(
    (link) =>
      link.rejectionReason === "workspace_scope_violation" ||
      link.rejectionReason === "workspace_explicitly_denied"
  );
  const blockedBy = !tenantAllowed
    ? "principal_tenant_mismatch"
    : !commandAllowed
      ? "command_permission_denied"
      : hasTenantLeak
        ? "tenant_boundary_violation"
        : hasWorkspaceLeak
          ? "workspace_scope_violation"
          : null;

  return {
    contract: "hosted-kernel.job-thread-link.boundary.v1",
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    boundaryMode: workspaceScope.boundaryMode,
    principalId: principal.principalId,
    requiredPermission,
    commandAllowed,
    tenantAllowed,
    tenantWideAllowed,
    workspaceWideAllowed,
    workspaceAllowed: !hasWorkspaceLeak,
    workspaceQuarantineAllowed: canQuarantineWorkspaceViolations,
    isolationSafe: !blockedBy,
    blockedBy,
    scopedLinkCount: scopedLinks.length,
    rejectedLinkCount: rejectedLinks.length,
    hardRejectedLinkCount: hardRejectedLinks.length,
    quarantinedLinkCount: quarantinedLinks.length,
    quarantinedLinks: quarantinedLinks.map((link) => ({
      jobId: link.jobId,
      threadId: link.threadId,
      tenantId: link.tenantId,
      workspaceId: link.workspaceId,
      reason: link.rejectionReason,
      disposition: link.auditDisposition
    })),
    accessDecision: {
      contract: "hosted-kernel.job-thread-link.access-decision.v1",
      command,
      allowed: !blockedBy,
      decision: blockedBy ? "deny" : quarantinedLinks.length ? "allow-with-quarantine" : "allow",
      requiredPermission,
      principalPermissions: principal.permissions,
      tenantMatched: principal.tenantId === workspaceScope.tenantId,
      tenantWideAllowed,
      workspaceWideAllowed,
      scopedTenantIds: workspaceScope.allowedTenantIds,
      scopedWorkspaceIds: workspaceScope.allowedWorkspaceIds,
      deniedWorkspaceIds: workspaceScope.deniedWorkspaceIds,
      quarantinedLinkCount: quarantinedLinks.length,
      hardRejectedLinkCount: hardRejectedLinks.length,
      blockedBy
    },
    scopedLinks,
    rejectedLinks
  };
}

function normalizeProviders(input = {}) {
  const providers = Array.isArray(input.providers) ? input.providers : [];
  const warnings = [];

  return {
    providers: providers.map((provider, index) => {
      const serviceContractSource = provider.serviceContract || provider.contract || {};
      const providerId = String(provider.providerId || provider.id || `provider-${index + 1}`);
      const capabilities = normalizeCapabilityList(provider.capabilities);
      const missingCapabilities = REQUIRED_CAPABILITIES.filter(
        (capability) => !capabilities.includes(capability)
      );
      const serviceEndpoint = provider.serviceEndpoint ? String(provider.serviceEndpoint) : null;
      const externalHandoffEndpoint = provider.externalHandoffEndpoint
        ? String(provider.externalHandoffEndpoint)
        : null;
      const syncCursor = provider.syncCursor ? String(provider.syncCursor) : null;
      const observedAt = toIso(provider.observedAt || provider.lastSeenAt || provider.updatedAt, null);
      const leaseUntilAt = toIso(provider.leaseUntilAt || provider.syncLeaseUntilAt, null);
      const serviceState = PROVIDER_SERVICE_STATES.includes(provider.serviceState)
        ? provider.serviceState
        : provider.enabled === false
          ? "disabled"
          : provider.healthy === false
            ? "unhealthy"
            : provider.degraded
              ? "degraded"
              : "ready";
      const handshakeVersion = provider.handshakeVersion
        ? String(provider.handshakeVersion)
        : "hosted-kernel.job-thread-link.provider.v1";
      const serviceContractVersion = serviceContractSource.version || provider.serviceContractVersion
        ? String(serviceContractSource.version || provider.serviceContractVersion)
        : DEFAULT_PROVIDER_SERVICE_CONTRACT.version;
      const supportedCommands = normalizeCommandList(
        serviceContractSource.commands || provider.supportedCommands || provider.commands
      );
      const missingServiceCommands = ["inspect"].filter((command) => !supportedCommands.includes(command));
      const requestedSyncMode = serviceContractSource.syncMode || provider.syncMode;
      const syncMode = PROVIDER_SYNC_MODES.includes(requestedSyncMode)
        ? requestedSyncMode
        : syncCursor
          ? "cursor"
          : DEFAULT_PROVIDER_SERVICE_CONTRACT.syncMode;
      const maxBatchSize = asPositiveInteger(
        serviceContractSource.maxBatchSize ?? provider.maxBatchSize,
        DEFAULT_PROVIDER_SERVICE_CONTRACT.maxBatchSize,
        { min: 1, max: 1_000 }
      );
      const requiresProofLedger = asBoolean(
        serviceContractSource.requiresProofLedger ?? provider.requiresProofLedger,
        DEFAULT_PROVIDER_SERVICE_CONTRACT.requiresProofLedger
      );
      const requestedHandoffMode = serviceContractSource.handoffMode || provider.handoffMode;
      const handoffMode = PROVIDER_HANDOFF_MODES.includes(requestedHandoffMode)
        ? requestedHandoffMode
        : externalHandoffEndpoint
          ? "deep-link"
          : "none";
      const acceptsHandoff = Boolean(
        externalHandoffEndpoint &&
          provider.acceptsHandoff !== false &&
          serviceContractSource.supportsExternalHandoff !== false &&
          handoffMode !== "none"
      );
      const requestedHandoffState = provider.handoffState ? String(provider.handoffState) : null;
      const handoffState = EXTERNAL_HANDOFF_STATES.includes(requestedHandoffState)
        ? requestedHandoffState
        : acceptsHandoff
          ? "available"
          : "not-required";
      const syncLagMs = asPositiveInteger(provider.syncLagMs, 0, { min: 0, max: 86_400_000 });
      const priority = asPositiveInteger(provider.priority, index + 1, { min: 1, max: 1_000 });
      const capabilityCoverage = REQUIRED_CAPABILITIES.length
        ? (REQUIRED_CAPABILITIES.length - missingCapabilities.length) / REQUIRED_CAPABILITIES.length
        : 1;
      const cursorContractSatisfied = syncMode !== "cursor" || Boolean(syncCursor);
      const serviceReady =
        serviceState === "ready" &&
        missingCapabilities.length === 0 &&
        missingServiceCommands.length === 0 &&
        cursorContractSatisfied;
      const healthy = serviceReady;

      if (missingCapabilities.length) {
        warnings.push({
          code: "provider_capability_gap",
          providerId,
          message: `${providerId} is missing required job-thread-link capabilities: ${missingCapabilities.join(", ")}`
        });
      }

      if (serviceState === "ready" && syncMode === "cursor" && !syncCursor) {
        warnings.push({
          code: "provider_sync_cursor_missing",
          providerId,
          message: `${providerId} is ready but did not publish a sync cursor for job-thread-link recovery`
        });
      }

      if (missingServiceCommands.length) {
        warnings.push({
          code: "provider_service_command_gap",
          providerId,
          message: `${providerId} cannot service required job-thread-link commands: ${missingServiceCommands.join(", ")}`
        });
      }

      return {
        providerId,
        service: String(provider.service || provider.kind || "hosted-kernel-link-provider"),
        healthy,
        serviceState,
        serviceReady,
        handshakeVersion,
        priority,
        capabilityCoverage,
        capabilities,
        missingCapabilities,
        serviceContract: {
          contract: DEFAULT_PROVIDER_SERVICE_CONTRACT.version,
          version: serviceContractVersion,
          supportedCommands,
          missingServiceCommands,
          syncMode,
          maxBatchSize,
          requiresProofLedger,
          cursorContractSatisfied,
          commandEndpoint: serviceContractSource.commandEndpoint || provider.commandEndpoint
            ? String(serviceContractSource.commandEndpoint || provider.commandEndpoint)
            : serviceEndpoint,
          syncEndpoint: serviceContractSource.syncEndpoint || provider.syncEndpoint
            ? String(serviceContractSource.syncEndpoint || provider.syncEndpoint)
            : serviceEndpoint,
          healthEndpoint: serviceContractSource.healthEndpoint || provider.healthEndpoint
            ? String(serviceContractSource.healthEndpoint || provider.healthEndpoint)
            : serviceEndpoint,
          handoffMode
        },
        serviceEndpoint,
        externalHandoffEndpoint,
        acceptsHandoff,
        handoffState,
        syncCursor,
        observedAt,
        leaseUntilAt,
        syncLagMs
      };
    }),
    warnings
  };
}

function deriveProviderContract(providerState) {
  const rankedProviders = [...providerState.providers].sort((left, right) => {
    if (left.serviceReady !== right.serviceReady) return left.serviceReady ? -1 : 1;
    if (left.capabilityCoverage !== right.capabilityCoverage) return right.capabilityCoverage - left.capabilityCoverage;
    if (left.serviceState !== right.serviceState) {
      return PROVIDER_SERVICE_STATES.indexOf(left.serviceState) - PROVIDER_SERVICE_STATES.indexOf(right.serviceState);
    }
    return left.priority - right.priority;
  });
  const primaryProvider = rankedProviders[0] || null;
  const allCapabilities = normalizeCapabilityList(
    providerState.providers.flatMap((provider) => provider.capabilities)
  );
  const selectedCapabilities = primaryProvider ? primaryProvider.capabilities : [];
  const selectedServiceContract = primaryProvider ? primaryProvider.serviceContract : null;
  const missingCapabilities = REQUIRED_CAPABILITIES.filter(
    (capability) => !selectedCapabilities.includes(capability)
  );
  const missingServiceCommands = selectedServiceContract ? selectedServiceContract.missingServiceCommands : ["inspect"];
  const aggregateMissingCapabilities = REQUIRED_CAPABILITIES.filter(
    (capability) => !allCapabilities.includes(capability)
  );
  const negotiated = Boolean(primaryProvider?.serviceReady) && missingCapabilities.length === 0;
  const blockedBy = !primaryProvider
    ? "provider_missing"
    : primaryProvider.serviceState === "disabled"
      ? "provider_disabled"
      : primaryProvider.serviceState === "unhealthy"
        ? "provider_unhealthy"
        : primaryProvider.serviceState === "degraded"
          ? "provider_degraded"
          : missingCapabilities.length
            ? "provider_capability_gap"
            : missingServiceCommands.length
              ? "provider_service_command_gap"
              : selectedServiceContract && !selectedServiceContract.cursorContractSatisfied
                ? "provider_sync_cursor_missing"
                : primaryProvider && !primaryProvider.serviceReady
                  ? "provider_service_contract_unready"
                  : null;
  const serviceContract = {
    contract: "hosted-kernel.job-thread-link.provider-service-contract.v1",
    selectedProviderId: primaryProvider ? primaryProvider.providerId : null,
    selected: selectedServiceContract,
    accepted: negotiated,
    blockedBy,
    requiredCommands: ["inspect"],
    missingServiceCommands,
    syncMode: selectedServiceContract ? selectedServiceContract.syncMode : null,
    cursorContractSatisfied: selectedServiceContract ? selectedServiceContract.cursorContractSatisfied : false,
    maxBatchSize: selectedServiceContract ? selectedServiceContract.maxBatchSize : null,
    requiresProofLedger: selectedServiceContract ? selectedServiceContract.requiresProofLedger : true,
    commandEndpoint: selectedServiceContract ? selectedServiceContract.commandEndpoint : null,
    syncEndpoint: selectedServiceContract ? selectedServiceContract.syncEndpoint : null,
    healthEndpoint: selectedServiceContract ? selectedServiceContract.healthEndpoint : null,
    handoffMode: selectedServiceContract ? selectedServiceContract.handoffMode : "none",
    providerMatrix: rankedProviders.map((provider) => ({
      providerId: provider.providerId,
      serviceState: provider.serviceState,
      serviceReady: provider.serviceReady,
      supportedCommands: provider.serviceContract.supportedCommands,
      missingServiceCommands: provider.serviceContract.missingServiceCommands,
      syncMode: provider.serviceContract.syncMode,
      cursorContractSatisfied: provider.serviceContract.cursorContractSatisfied,
      handoffMode: provider.serviceContract.handoffMode,
      maxBatchSize: provider.serviceContract.maxBatchSize
    }))
  };

  return {
    contractType: "hosted-kernel.job-thread-link.provider-contract.v1",
    serviceContract: "hosted-kernel.job-thread-link.provider-service.v1",
    serviceContractState: serviceContract,
    requiredCapabilities: [...REQUIRED_CAPABILITIES],
    negotiated,
    blockedBy,
    primaryProviderId: primaryProvider ? primaryProvider.providerId : null,
    primaryServiceEndpoint: primaryProvider ? primaryProvider.serviceEndpoint : null,
    primaryHandshakeVersion: primaryProvider ? primaryProvider.handshakeVersion : null,
    primaryServiceState: primaryProvider ? primaryProvider.serviceState : "missing",
    primarySyncCursor: primaryProvider ? primaryProvider.syncCursor : null,
    primaryObservedAt: primaryProvider ? primaryProvider.observedAt : null,
    primaryLeaseUntilAt: primaryProvider ? primaryProvider.leaseUntilAt : null,
    primaryExternalHandoffEndpoint: primaryProvider ? primaryProvider.externalHandoffEndpoint : null,
    primaryHandoffState: primaryProvider ? primaryProvider.handoffState : "blocked",
    capabilities: allCapabilities,
    selectedCapabilities,
    missingCapabilities,
    aggregateMissingCapabilities,
    providers: rankedProviders,
    negotiation: {
      contract: "hosted-kernel.job-thread-link.capability-negotiation.v1",
      providerId: primaryProvider ? primaryProvider.providerId : null,
      accepted: negotiated,
      blockedBy,
      requiredCapabilities: [...REQUIRED_CAPABILITIES],
      acceptedCapabilities: selectedCapabilities,
      missingCapabilities,
      serviceContract,
      fallbackProviderIds: rankedProviders
        .slice(1)
        .filter((provider) => provider.serviceState !== "disabled")
        .map((provider) => provider.providerId)
    }
  };
}

function deriveLifecycleState({ command, settings, links }) {
  const staleLinks = links.filter((link) => link.stale);
  const unprovedLinks = settings.proofRequired ? links.filter((link) => !link.proofValid) : [];
  const disabled = command === "disable" || !settings.enabled;
  const paused = command === "pause";

  if (disabled) return { mode: "disabled", ready: false, reason: "linking_disabled" };
  if (paused) return { mode: "paused", ready: false, reason: "operator_paused" };
  if (staleLinks.length) return { mode: "repair", ready: false, reason: "stale_links" };
  if (unprovedLinks.length) return { mode: "awaiting-proof", ready: false, reason: "missing_proof" };
  if (command === "schedule") return { mode: "scheduled", ready: true, reason: "operator_scheduled" };
  if (command === "enable" || command === "resume") return { mode: "active", ready: true, reason: "operator_enabled" };
  return { mode: "observing", ready: true, reason: "inspection_ready" };
}

function applyProviderReadiness(lifecycle, providerContract) {
  if (lifecycle.mode === "disabled" || lifecycle.mode === "paused" || lifecycle.mode === "restart-required") {
    return lifecycle;
  }
  if (providerContract.negotiated) return lifecycle;

  return {
    mode: "handoff-required",
    ready: false,
    reason: providerContract.blockedBy || (providerContract.primaryProviderId ? "provider_capability_gap" : "provider_missing")
  };
}

function applyLifecycleControlsReadiness(lifecycle, controls) {
  if (controls.effectiveMode === "disabled") {
    return {
      mode: "disabled",
      ready: false,
      reason: "operator_disabled"
    };
  }

  if (controls.effectiveMode === "paused") {
    return {
      mode: "paused",
      ready: false,
      reason: controls.operatorHoldUntilAt ? "operator_hold_until" : "operator_paused"
    };
  }

  if (controls.restartRequired && lifecycle.ready) {
    return {
      mode: "restart-required",
      ready: false,
      reason: "restart_sensitive_settings_changed"
    };
  }

  return lifecycle;
}

function applyBoundaryReadiness(lifecycle, boundary) {
  if (!boundary.blockedBy) return lifecycle;

  return {
    mode: "boundary-blocked",
    ready: false,
    reason: boundary.blockedBy
  };
}

function normalizeFailureSignals(input = {}, now) {
  const sources = [input.failure, input.error, input.lastError, input.health?.lastError].filter(Boolean);
  const rawFailures = Array.isArray(input.failures) ? input.failures : [];
  const failures = [...sources, ...rawFailures].slice(0, 10).map((failure, index) => {
    const code = String(failure.code || failure.reason || failure.name || `runtime_failure_${index + 1}`);
    const message = String(failure.message || failure.detail || "Hosted kernel job-thread-link reported a failure");
    const retryable = failure.retryable !== false;
    const observedAt = toIso(failure.observedAt || failure.at || failure.timestamp, now);

    return {
      contract: "hosted-kernel.job-thread-link.failure.v1",
      code,
      message,
      retryable,
      observedAt,
      severity: ["info", "warning", "error", "critical"].includes(failure.severity)
        ? failure.severity
        : "error",
      owner: failure.owner ? String(failure.owner) : "kernel-lifecycle",
      action: failure.action ? String(failure.action) : "inspect-job-thread-link-health"
    };
  });

  return failures;
}

function deriveActionableErrors({ lifecycle, boundary, providerContract, links, settings, failureSignals }) {
  const staleLinks = links.filter((link) => link.stale);
  const invalidProofLinks = settings.proofRequired ? links.filter((link) => !link.proofValid) : [];
  const errors = failureSignals.map((failure) => ({
    code: failure.code,
    severity: failure.severity,
    message: failure.message,
    retryable: failure.retryable,
    owner: failure.owner,
    action: failure.action
  }));

  if (boundary.blockedBy) {
    errors.push({
      code: boundary.blockedBy,
      severity: "critical",
      message: "The command or candidate links cross the authorized tenant/workspace boundary",
      retryable: false,
      owner: "kernel-access-control",
      action: "correct-principal-permissions-or-link-scope"
    });
  }

  if (!boundary.blockedBy && boundary.quarantinedLinkCount) {
    errors.push({
      code: "workspace_links_quarantined",
      severity: "warning",
      message: `${boundary.quarantinedLinkCount} out-of-scope workspace link${boundary.quarantinedLinkCount === 1 ? "" : "s"} were quarantined from this inspect result`,
      retryable: true,
      owner: "kernel-access-control",
      action: "review-workspace-scope-or-remove-quarantined-links"
    });
  }

  if (!providerContract.negotiated) {
    errors.push({
      code: providerContract.blockedBy || (providerContract.primaryProviderId ? "provider_capability_gap" : "provider_missing"),
      severity: "error",
      message: providerContract.primaryProviderId
        ? "The selected provider did not satisfy the hosted-kernel job-thread-link provider contract"
        : "No hosted-kernel job-thread-link provider is available",
      retryable: true,
      owner: "provider-registry",
      action: providerContract.primaryProviderId ? "upgrade-or-rotate-link-provider" : "register-link-provider"
    });
  }

  if (staleLinks.length) {
    errors.push({
      code: "stale_links",
      severity: "warning",
      message: `${staleLinks.length} linked job thread${staleLinks.length === 1 ? "" : "s"} exceeded staleAfterMs`,
      retryable: true,
      owner: "job-thread-link",
      action: "refresh-stale-job-thread-links"
    });
  }

  if (invalidProofLinks.length && lifecycle.mode === "awaiting-proof") {
    const proofReasons = normalizeCapabilityList(invalidProofLinks.map((link) => link.proofBlockedBy));
    errors.push({
      code: proofReasons.includes("missing_proof") ? "missing_proof" : "invalid_link_proof",
      severity: "warning",
      message: `${invalidProofLinks.length} linked job thread${invalidProofLinks.length === 1 ? "" : "s"} require valid link proof`,
      retryable: true,
      owner: "proof-ledger",
      action: proofReasons.includes("missing_proof") ? "collect-missing-link-proofs" : "repair-invalid-link-proofs"
    });
  }

  return errors;
}

function deriveHealth({
  lifecycle,
  boundary,
  providerContract,
  links,
  settings,
  controls,
  healthPolicy,
  failureSignals,
  persistedState,
  nowMs
}) {
  const baseActionableErrors = deriveActionableErrors({
    lifecycle,
    boundary,
    providerContract,
    links,
    settings,
    failureSignals
  });
  const persistedRetryAtMs = healthPolicy.persistBackoff && persistedState.retryAfterAt
    ? new Date(persistedState.retryAfterAt).getTime()
    : null;
  const backoffHeld = Boolean(
    Number.isFinite(persistedRetryAtMs) &&
      persistedRetryAtMs > nowMs &&
      !controls.forceRunNow
  );
  const currentFailureCount = baseActionableErrors.length
    ? persistedState.consecutiveFailureCount + 1
    : backoffHeld
      ? persistedState.consecutiveFailureCount
      : 0;
  const retryExhausted =
    currentFailureCount >= healthPolicy.maxRetryAttempts &&
    baseActionableErrors.some((error) => error.retryable);
  const actionableErrors = [...baseActionableErrors];

  if (backoffHeld) {
    actionableErrors.push({
      code: "retry_backoff_active",
      severity: "warning",
      message: "A persisted job-thread-link retry hold is still active",
      retryable: true,
      owner: "kernel-lifecycle",
      action: "wait-for-retry-backoff-or-force-schedule"
    });
  }

  if (retryExhausted) {
    actionableErrors.push({
      code: "retry_budget_exhausted",
      severity: healthPolicy.failClosedOnRetryExhausted ? "critical" : "error",
      message: "The job-thread-link retry budget is exhausted for the current failure sequence",
      retryable: false,
      owner: "kernel-lifecycle",
      action: "inspect-provider-proof-and-boundary-before-resume"
    });
  }

  const hardBlocked = actionableErrors.some((error) => error.severity === "critical" || error.retryable === false);
  const retryable = actionableErrors.some((error) => error.retryable) && !retryExhausted;
  const retryExponent = Math.max(0, Math.min(currentFailureCount - 1, 8));
  const computedRetryBackoffMs = retryable
    ? Math.min(settings.retryBackoffMaxMs, settings.retryBackoffBaseMs * 2 ** retryExponent)
    : null;
  const jitterMs = computedRetryBackoffMs
    ? Math.round(computedRetryBackoffMs * healthPolicy.retryJitterRatio * (currentFailureCount % 2 ? 0.5 : -0.5))
    : 0;
  const retryBackoffMs = backoffHeld
    ? Math.max(0, persistedRetryAtMs - nowMs)
    : computedRetryBackoffMs
      ? Math.max(1_000, Math.min(settings.retryBackoffMaxMs, computedRetryBackoffMs + jitterMs))
      : null;
  const retryAfterAt = backoffHeld
    ? new Date(persistedRetryAtMs).toISOString()
    : retryBackoffMs
      ? new Date(nowMs + retryBackoffMs).toISOString()
      : null;
  const degraded =
    currentFailureCount >= settings.degradedAfterFailures ||
    (lifecycle.ready && actionableErrors.some((error) => error.severity === "warning"));
  const failureState = hardBlocked
    ? retryExhausted
      ? "exhausted"
      : "blocked"
    : backoffHeld || retryBackoffMs
      ? "retrying"
      : degraded
        ? "degraded"
        : "nominal";
  const status = hardBlocked
    ? "blocked"
    : !lifecycle.ready
      ? "failing"
      : degraded
        ? "degraded"
        : "healthy";
  const acceptingOperations = lifecycle.ready && !hardBlocked && !backoffHeld;

  return {
    contract: "hosted-kernel.job-thread-link.health.v1",
    status,
    acceptingOperations,
    degraded,
    failureState,
    failureStates: [...HEALTH_FAILURE_STATES],
    retryable,
    retryBackoffMs,
    retryAfterAt,
    consecutiveFailureCount: currentFailureCount,
    lastFailureCode: actionableErrors[0] ? actionableErrors[0].code : null,
    blockedBy: hardBlocked ? actionableErrors[0]?.code || lifecycle.reason : null,
    retryPlan: {
      contract: "hosted-kernel.job-thread-link.retry-plan.v1",
      active: Boolean(retryAfterAt),
      persistedHold: backoffHeld,
      attempt: currentFailureCount,
      maxAttempts: healthPolicy.maxRetryAttempts,
      exhausted: retryExhausted,
      backoffBaseMs: settings.retryBackoffBaseMs,
      backoffMaxMs: settings.retryBackoffMaxMs,
      jitterRatio: healthPolicy.retryJitterRatio,
      nextRetryAt: retryAfterAt,
      forceRunAllowed: Boolean(controls.forceRunNow || controls.effectiveMode === "scheduled")
    },
    degradedMode: {
      contract: "hosted-kernel.job-thread-link.degraded-mode.v1",
      enabled: degraded || failureState === "retrying",
      readOnly: Boolean((degraded || failureState === "retrying") && healthPolicy.degradedReadOnly),
      reason: degraded ? actionableErrors[0]?.code || lifecycle.reason : null,
      clientDispatchAllowed: acceptingOperations && !(degraded && healthPolicy.degradedReadOnly),
      auditOnly: failureState === "retrying" || retryExhausted
    },
    actionableErrors
  };
}

function applyHealthSchedule(schedule, health) {
  if (!health.retryAfterAt) return schedule;

  return {
    ...schedule,
    nextRunAt: schedule.nextRunAt || health.retryAfterAt,
    due: false,
    retryAfterAt: health.retryAfterAt,
    retryBackoffMs: health.retryBackoffMs
  };
}

function deriveSchedule(input = {}, nowMs, command, lifecycle, settings, controls) {
  const lastRunAt = toIso(input.lastRunAt, null);
  const lastRunMs = lastRunAt ? new Date(lastRunAt).getTime() : null;
  const intervalMs = controls.scheduleIntervalMs || settings.scheduleEveryMs;
  const dueAtMs = lastRunMs === null ? nowMs : lastRunMs + intervalMs;
  const requestedNextRunMs = controls.requestedNextRunAt ? new Date(controls.requestedNextRunAt).getTime() : null;
  const holdUntilMs = controls.operatorHoldUntilAt ? new Date(controls.operatorHoldUntilAt).getTime() : null;
  const forced = controls.forceRunNow || command === "enable" || command === "resume";
  const runnable = lifecycle.ready && settings.enabled && controls.enabled && !controls.paused;
  const held = Boolean(holdUntilMs && holdUntilMs > nowMs);
  const schedulePolicy = controls.schedulePolicy || {};
  const windowStartMs = schedulePolicy.runWindowStartAt ? new Date(schedulePolicy.runWindowStartAt).getTime() : null;
  const windowEndMs = schedulePolicy.runWindowEndAt ? new Date(schedulePolicy.runWindowEndAt).getTime() : null;
  const windowActive =
    schedulePolicy.windowPolicy !== "inside-window" ||
    (Number.isFinite(windowStartMs) && Number.isFinite(windowEndMs) && nowMs >= windowStartMs && nowMs <= windowEndMs);
  const windowUpcoming =
    schedulePolicy.windowPolicy === "inside-window" && Number.isFinite(windowStartMs) && windowStartMs > nowMs;
  const missedRunCount =
    lastRunMs === null || dueAtMs > nowMs
      ? 0
      : Math.floor((nowMs - dueAtMs) / intervalMs) + 1;
  const catchUpRunCount =
    schedulePolicy.misfirePolicy === "run-now"
      ? Math.min(missedRunCount, schedulePolicy.maxCatchUpRuns ?? 1)
      : 0;
  const skipMissedRuns = missedRunCount > 0 && schedulePolicy.misfirePolicy === "skip";
  const holdMisfire = missedRunCount > 0 && schedulePolicy.misfirePolicy === "hold";
  const nextRunAtMs = held
    ? holdUntilMs
    : windowUpcoming
      ? windowStartMs
      : holdMisfire || skipMissedRuns
        ? nowMs + intervalMs
        : Number.isFinite(requestedNextRunMs) && requestedNextRunMs > nowMs
          ? requestedNextRunMs
          : forced
            ? nowMs
            : dueAtMs;

  return {
    enabled: settings.enabled && controls.enabled,
    intervalMs,
    lastRunAt,
    nextRunAt: runnable && schedulePolicy.runWindowValid !== false ? new Date(nextRunAtMs).toISOString() : null,
    due:
      runnable &&
      !held &&
      windowActive &&
      !holdMisfire &&
      (forced || catchUpRunCount > 0 || dueAtMs <= nowMs || nextRunAtMs <= nowMs),
    forced,
    missedRunCount,
    catchUpRunCount,
    skipMissedRuns,
    misfirePolicy: schedulePolicy.misfirePolicy || "run-now",
    windowPolicy: schedulePolicy.windowPolicy || "always",
    runWindowStartAt: schedulePolicy.runWindowStartAt || null,
    runWindowEndAt: schedulePolicy.runWindowEndAt || null,
    runWindowActive: windowActive,
    operatorHoldUntilAt: controls.operatorHoldUntilAt,
    requestedNextRunAt: controls.requestedNextRunAt,
    blockedBy: runnable
      ? held
        ? "operator_hold_until"
        : schedulePolicy.runWindowValid === false
          ? "invalid_schedule_run_window"
          : holdMisfire
            ? "schedule_misfire_held"
            : windowUpcoming
              ? "schedule_window_not_started"
              : windowActive
                ? null
                : "outside_schedule_window"
      : lifecycle.reason
  };
}

function deriveSyncMetadata(input = {}, now, links, providerContract) {
  const provider = providerContract.providers.find(
    (candidate) => candidate.providerId === providerContract.primaryProviderId
  );
  const serviceContract = providerContract.serviceContractState;
  const requestedCursor = input.syncCursor || input.cursor || (provider ? provider.syncCursor : null);
  const cursor = requestedCursor ? String(requestedCursor) : `job-thread-link:${now}:${links.length}`;
  const latestLinkUpdatedAt = links.reduce(
    (latest, link) => (link.updatedAt > latest ? link.updatedAt : latest),
    now
  );
  const proofedLinkCount = links.filter((link) => link.proofValid).length;
  const proofLedgerSatisfied = !serviceContract.requiresProofLedger || proofedLinkCount === links.length;
  const batchSize = serviceContract.maxBatchSize || DEFAULT_PROVIDER_SERVICE_CONTRACT.maxBatchSize;
  const batchCount = links.length ? Math.ceil(links.length / batchSize) : 0;
  const syncBlockedBy = !providerContract.negotiated
    ? providerContract.blockedBy
    : !proofLedgerSatisfied
      ? "provider_requires_valid_proof_ledger"
      : null;

  return {
    syncContract: "hosted-kernel.job-thread-link.sync.v1",
    cursor,
    cursorSource: requestedCursor
      ? input.syncCursor || input.cursor
        ? "request"
        : "provider"
      : "generated",
    latestLinkUpdatedAt,
    providerId: providerContract.primaryProviderId,
    providerCursor: provider ? provider.syncCursor : null,
    providerObservedAt: provider ? provider.observedAt : null,
    providerLeaseUntilAt: provider ? provider.leaseUntilAt : null,
    providerSyncLagMs: provider ? provider.syncLagMs : null,
    providerNegotiated: providerContract.negotiated,
    providerSyncMode: serviceContract.syncMode,
    providerMaxBatchSize: batchSize,
    providerRequiresProofLedger: serviceContract.requiresProofLedger,
    providerCommandEndpoint: serviceContract.commandEndpoint,
    providerSyncEndpoint: serviceContract.syncEndpoint,
    providerHealthEndpoint: serviceContract.healthEndpoint,
    externalHandoffState: providerContract.primaryHandoffState,
    linkCount: links.length,
    proofedLinkCount,
    proofLedgerSatisfied,
    syncBlockedBy,
    batchCount,
    syncBarrier: {
      contract: "hosted-kernel.job-thread-link.sync-barrier.v1",
      accepted: !syncBlockedBy,
      blockedBy: syncBlockedBy,
      mode: serviceContract.syncMode,
      cursorRequired: serviceContract.syncMode === "cursor",
      cursorAvailable: Boolean(cursor),
      proofLedgerRequired: serviceContract.requiresProofLedger,
      proofLedgerSatisfied,
      batchSize,
      batchCount
    },
    staleLinkCount: links.filter((link) => link.stale).length,
    proofCoverage: links.length
      ? links.filter((link) => link.proofValid).length / links.length
      : 1
  };
}

function deriveRecovery({ persistedState, commandReceipt, controls, lifecycle, schedule, sync, links }) {
  const currentFingerprints = links.map(linkFingerprint);
  const persistedFingerprints = new Set(persistedState.linkFingerprints);
  const missingPersistedLinks = persistedState.linkFingerprints.filter(
    (fingerprint) => !currentFingerprints.includes(fingerprint)
  );
  const recoveredLinks = currentFingerprints.filter((fingerprint) => persistedFingerprints.has(fingerprint)).length;
  const cursorAdvanced = Boolean(persistedState.cursor && persistedState.cursor !== sync.cursor);
  const commandPreviouslyPersisted = Boolean(commandReceipt.replayed && commandReceipt.previousOutcome);
  const checkpointFingerprint = [
    persistedState.generation + (commandReceipt.accepted && commandReceipt.mutating ? 1 : 0),
    controls.effectiveMode,
    lifecycle.mode,
    schedule.nextRunAt || "no-next-run",
    sync.cursor,
    currentFingerprints.length,
    missingPersistedLinks.length
  ].join("|");
  const checkpointChanged = persistedState.checkpointFingerprint
    ? persistedState.checkpointFingerprint !== checkpointFingerprint
    : true;
  const status =
    commandReceipt.replayed
      ? "idempotent-replay"
      : !persistedState.recovered
        ? "cold-start"
        : missingPersistedLinks.length
          ? "reconcile-persisted-links"
          : cursorAdvanced
            ? "cursor-advanced"
            : "restart-safe";

  return {
    contract: "hosted-kernel.job-thread-link.recovery.v1",
    status,
    restartSafe: lifecycle.ready || lifecycle.mode === "paused" || lifecycle.mode === "disabled",
    restartSemanticStatus: commandReceipt.replayed
      ? "read-only-replay"
      : checkpointChanged
        ? "checkpoint-advanced"
        : "checkpoint-stable",
    recovered: persistedState.recovered,
    generation: persistedState.generation,
    nextGeneration: persistedState.generation + (commandReceipt.accepted && commandReceipt.mutating ? 1 : 0),
    previousLifecycleMode: persistedState.lastLifecycleMode,
    previousStatus: persistedState.lastStatus,
    previousCheckpointFingerprint: persistedState.checkpointFingerprint,
    checkpointFingerprint,
    checkpointChanged,
    recoveredLinkCount: recoveredLinks,
    missingPersistedLinkCount: missingPersistedLinks.length,
    missingPersistedLinks,
    cursorAdvanced,
    commandPreviouslyPersisted,
    replayedCommandOutcome: commandReceipt.previousOutcome,
    resumeBlockedBy: schedule.blockedBy,
    resumePlan: {
      contract: "hosted-kernel.job-thread-link.resume-plan.v1",
      mode: schedule.blockedBy
        ? "blocked"
        : commandReceipt.replayed
          ? "return-persisted-outcome"
          : lifecycle.ready && schedule.due
            ? "run-now"
            : lifecycle.ready
              ? "wait-for-schedule"
              : "inspect-required",
      commandReplaySafe: !commandReceipt.replayed || commandPreviouslyPersisted,
      sideEffectsAllowed: commandReceipt.accepted && !schedule.blockedBy && lifecycle.ready,
      nextRunAt: schedule.nextRunAt,
      cursor: sync.cursor,
      blockedBy: schedule.blockedBy || null
    }
  };
}

function appendCommandJournalEntry({ persistedState, commandReceipt, commandState, lifecycle, recovery, health, sync, now }) {
  if (commandReceipt.replayed) {
    return persistedState.commandJournal.slice(-PERSISTED_COMMAND_JOURNAL_LIMIT);
  }

  const existing = persistedState.commandJournal.filter((entry) => entry.commandId !== commandReceipt.idempotencyKey);

  if (!commandReceipt.idempotencyKey || !commandReceipt.mutating) {
    return existing.slice(-PERSISTED_COMMAND_JOURNAL_LIMIT);
  }

  const nextEntry = {
    contract: "hosted-kernel.job-thread-link.command-journal-entry.v1",
    sequence: existing.length ? existing[existing.length - 1].sequence + 1 : 1,
    commandId: commandReceipt.idempotencyKey,
    command: commandReceipt.command,
    effectiveCommand: commandReceipt.effectiveCommand,
    accepted: commandReceipt.accepted,
    status: commandReceipt.replayed ? "replayed-without-side-effects" : commandState.allowed ? "applied" : "blocked",
    lifecycleMode: lifecycle.mode,
    healthStatus: health.status,
    recoveryStatus: recovery.status,
    cursor: sync.cursor,
    generation: recovery.nextGeneration,
    persistedAt: now
  };

  return [...existing, nextEntry].slice(-PERSISTED_COMMAND_JOURNAL_LIMIT);
}

function shapePersistedState({
  persistedState,
  commandReceipt,
  controls,
  commandState,
  lifecycle,
  schedule,
  sync,
  links,
  recovery,
  workspaceScope,
  boundary,
  health,
  providerContract,
  analytics,
  clientRuntime,
  validationSummary,
  previewAcceptance,
  nextStep,
  proofLedger,
  now
}) {
  const commandJournal = appendCommandJournalEntry({
    persistedState,
    commandReceipt,
    commandState,
    lifecycle,
    recovery,
    health,
    sync,
    now
  });

  return {
    version: "hosted-kernel.job-thread-link.state.v1",
    persistedAt: now,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    boundaryStatus: boundary.blockedBy || "accepted",
    boundaryMode: boundary.boundaryMode,
    quarantinedLinkCount: boundary.quarantinedLinkCount,
    hardRejectedLinkCount: boundary.hardRejectedLinkCount,
    generation: recovery.nextGeneration,
    restartCount: persistedState.recovered ? persistedState.restartCount + 1 : 0,
    lastCommandId: commandReceipt.idempotencyKey || persistedState.lastCommandId,
    lastAcceptedCommandId: commandReceipt.accepted && commandReceipt.mutating
      ? commandReceipt.idempotencyKey
      : persistedState.lastAcceptedCommandId,
    lastCommand: commandReceipt.command,
    lastEffectiveCommand: commandReceipt.effectiveCommand,
    lastCommandReplaySource: commandReceipt.replaySource,
    lastCommandPreviousOutcome: commandReceipt.previousOutcome,
    lastCommandIntent: commandState.commandIntent,
    lastCommandAllowed: commandState.allowed,
    lastCommandBlockedBy: commandState.blockedBy,
    commandJournal,
    recommendedCommand: commandState.nextActionState.recommendedCommand,
    controlMode: controls.effectiveMode,
    operatorHoldUntilAt: controls.operatorHoldUntilAt,
    scheduleIntervalMs: controls.scheduleIntervalMs,
    schedulePolicy: controls.schedulePolicy,
    scheduleMisfirePolicy: schedule.misfirePolicy,
    scheduleMissedRunCount: schedule.missedRunCount,
    scheduleCatchUpRunCount: schedule.catchUpRunCount,
    scheduleRunWindowActive: schedule.runWindowActive,
    settingsRestartRequired: controls.restartRequired,
    lastStatus: recovery.status,
    restartSemanticStatus: recovery.restartSemanticStatus,
    restartSafe: recovery.restartSafe,
    recoveryResumePlan: recovery.resumePlan,
    checkpointFingerprint: recovery.checkpointFingerprint,
    checkpointChanged: recovery.checkpointChanged,
    lastLifecycleMode: lifecycle.mode,
    cursor: sync.cursor,
    nextRunAt: schedule.nextRunAt,
    blockedBy: schedule.blockedBy,
    healthStatus: health.status,
    healthFailureState: health.failureState,
    healthRetryPlan: health.retryPlan,
    degradedMode: health.degradedMode,
    providerId: providerContract.primaryProviderId,
    providerServiceState: providerContract.primaryServiceState,
    providerNegotiated: providerContract.negotiated,
    providerBlockedBy: providerContract.blockedBy,
    providerHandshakeVersion: providerContract.primaryHandshakeVersion,
    providerCursor: providerContract.primarySyncCursor,
    providerObservedAt: providerContract.primaryObservedAt,
    providerLeaseUntilAt: providerContract.primaryLeaseUntilAt,
    providerServiceContract: providerContract.serviceContractState,
    externalHandoffState: providerContract.primaryHandoffState,
    clientRequestId: clientRuntime.requestId,
    clientParentRequestId: clientRuntime.parentRequestId,
    clientSessionId: clientRuntime.sessionId,
    clientRequestOrigin: clientRuntime.requestOrigin,
    clientContinuationKey: clientRuntime.continuationKey,
    clientWorkflowState: clientRuntime.workflowState,
    clientDispatchMode: clientRuntime.dispatchMode,
    clientSurfaceRoute: clientRuntime.surfaceRoute,
    clientCallbackRoute: clientRuntime.callbackRoute,
    clientRequestState: clientRuntime.requestState,
    validationStatus: validationSummary.status,
    validationReadinessScore: validationSummary.readinessScore,
    validationFailedCheckCount: validationSummary.failedCheckCount,
    validationWarningCheckCount: validationSummary.warningCheckCount,
    previewAcceptanceStatus: previewAcceptance.status,
    previewAccepted: previewAcceptance.accepted,
    previewBlockedBy: previewAcceptance.blockedBy,
    previewAcceptanceToken: previewAcceptance.acceptanceToken,
    previewReadinessLanes: previewAcceptance.readiness.lanes,
    previewRouteContract: previewAcceptance.routeContract,
    nextStepAction: nextStep.action,
    nextStepBlockedBy: nextStep.blockedBy,
    nextStepRouteHint: nextStep.routeHint,
    proofLedgerSource: proofLedger.source,
    proofedLinkCount: proofLedger.proofedLinkCount,
    invalidProofReasons: proofLedger.invalidProofReasons,
    syncMode: sync.providerSyncMode,
    syncBlockedBy: sync.syncBlockedBy,
    syncBarrier: sync.syncBarrier,
    syncBatchCount: sync.batchCount,
    consecutiveFailureCount: health.consecutiveFailureCount,
    lastFailureCode: health.lastFailureCode,
    retryAfterAt: health.retryAfterAt,
    analyticsCounters: analytics.counters,
    analyticsProofReasonCounts: analytics.proofReasonCounts,
    analyticsErrorSeverityCounts: analytics.errorSeverityCounts,
    analyticsProviderServiceStateCounts: analytics.providerServiceStateCounts,
    analyticsExportSummary: analytics.exportSummary,
    analyticsReportingState: analytics.reportingState,
    analyticsExportRows: analytics.exportRows,
    analyticsHistory: analytics.history,
    analyticsHistoryRollup: analytics.historyRollup,
    linkFingerprints: links.map(linkFingerprint),
    linkedJobs: links.map((link) => ({
      jobId: link.jobId,
      threadId: link.threadId,
      tenantId: link.tenantId,
      workspaceId: link.workspaceId,
      state: link.state,
      updatedAt: link.updatedAt,
      proofId: link.proofId,
      proofStatus: link.proofStatus,
      proofValid: link.proofValid,
      proofBlockedBy: link.proofBlockedBy
    }))
  };
}

function deriveExternalHandoff(providerContract, lifecycle, links, sync, workspaceScope, boundary, health) {
  const provider = providerContract.providers.find(
    (candidate) => candidate.providerId === providerContract.primaryProviderId
  );
  const providerCanAccept = Boolean(provider?.acceptsHandoff && provider.externalHandoffEndpoint);
  const handoffNeeded = lifecycle.mode === "handoff-required";
  const state = !handoffNeeded
    ? "not-required"
    : providerCanAccept && provider.handoffState !== "blocked"
      ? "pending"
      : "blocked";

  return {
    handoffContract: "hosted-kernel.job-thread-link.external-handoff.v1",
    required: handoffNeeded,
    state,
    providerId: provider ? provider.providerId : null,
    endpoint: provider ? provider.externalHandoffEndpoint : null,
    providerCanAccept,
    reason: handoffNeeded ? lifecycle.reason : null,
    payload: handoffNeeded
      ? {
          tenantId: workspaceScope.tenantId,
          workspaceId: workspaceScope.workspaceId,
          boundaryStatus: boundary.blockedBy || "accepted",
          boundaryMode: boundary.boundaryMode,
          quarantinedLinks: boundary.quarantinedLinks,
          healthStatus: health.status,
          actionableErrors: health.actionableErrors,
          cursor: sync.cursor,
          cursorSource: sync.cursorSource,
          providerServiceState: providerContract.primaryServiceState,
          providerHandshakeVersion: providerContract.primaryHandshakeVersion,
          providerServiceContract: providerContract.serviceContractState,
          providerObservedAt: providerContract.primaryObservedAt,
          providerLeaseUntilAt: providerContract.primaryLeaseUntilAt,
          syncMode: sync.providerSyncMode,
          syncBarrier: sync.syncBarrier,
          missingCapabilities: providerContract.missingCapabilities,
          jobIds: links.map((link) => link.jobId),
          invalidProofs: links
            .filter((link) => !link.proofValid)
            .map((link) => ({
              jobId: link.jobId,
              threadId: link.threadId,
              proofId: link.proofId,
              reason: link.proofBlockedBy
            }))
        }
      : null
  };
}

function normalizeAnalyticsHistory(input = {}, persistedState) {
  const requestedHistory =
    input.analytics?.history ||
    input.analyticsHistory ||
    input.reporting?.history ||
    input.history?.analytics ||
    persistedState.analyticsHistory ||
    [];

  if (!Array.isArray(requestedHistory)) return [];

  return requestedHistory.slice(-11).map((snapshot, index) => {
    const capturedAt = toIso(snapshot.capturedAt || snapshot.generatedAt || snapshot.at, null);
    const linkedJobCount = asPositiveInteger(snapshot.linkedJobCount, 0, { min: 0, max: 10_000 });
    const staleJobCount = asPositiveInteger(snapshot.staleJobCount, 0, { min: 0, max: 10_000 });
    const rejectedLinkCount = asPositiveInteger(snapshot.rejectedLinkCount, 0, { min: 0, max: 10_000 });
    const quarantinedLinkCount = asPositiveInteger(snapshot.quarantinedLinkCount, 0, { min: 0, max: 10_000 });
    const actionableErrorCount = asPositiveInteger(snapshot.actionableErrorCount, 0, { min: 0, max: 10_000 });

    return {
      contract: "hosted-kernel.job-thread-link.analytics-snapshot.v1",
      sequence: asPositiveInteger(snapshot.sequence, index + 1, { min: 1, max: 10_000 }),
      capturedAt,
      lifecycleMode: snapshot.lifecycleMode ? String(snapshot.lifecycleMode) : "unknown",
      healthStatus: snapshot.healthStatus ? String(snapshot.healthStatus) : "unknown",
      providerId: snapshot.providerId ? String(snapshot.providerId) : null,
      providerNegotiated: Boolean(snapshot.providerNegotiated),
      linkedJobCount,
      staleJobCount,
      rejectedLinkCount,
      quarantinedLinkCount,
      actionableErrorCount,
      scheduleDue: Boolean(snapshot.scheduleDue),
      cursor: snapshot.cursor ? String(snapshot.cursor) : null
    };
  });
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    if (!key) return counts;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function deriveAnalyticsHistoryRollup(history) {
  const first = history[0] || null;
  const last = history[history.length - 1] || null;
  const lifecycleModes = normalizeCapabilityList(history.map((snapshot) => snapshot.lifecycleMode));
  const healthStatuses = normalizeCapabilityList(history.map((snapshot) => snapshot.healthStatus));
  const cursorChanges = history.reduce((count, snapshot, index) => {
    if (index === 0) return count;
    return count + (snapshot.cursor !== history[index - 1].cursor ? 1 : 0);
  }, 0);
  const unhealthySnapshots = history.filter((snapshot) =>
    ["blocked", "failing", "degraded"].includes(snapshot.healthStatus)
  ).length;
  const scheduledRunsDue = history.filter((snapshot) => snapshot.scheduleDue).length;

  return {
    contract: "hosted-kernel.job-thread-link.analytics-history-rollup.v1",
    windowStartAt: first ? first.capturedAt : null,
    windowEndAt: last ? last.capturedAt : null,
    sampleCount: history.length,
    lifecycleModes,
    healthStatuses,
    cursorChangeCount: cursorChanges,
    unhealthySnapshotCount: unhealthySnapshots,
    scheduledRunsDue,
    latestLinkedJobCount: last ? last.linkedJobCount : 0,
    latestStaleJobCount: last ? last.staleJobCount : 0,
    latestActionableErrorCount: last ? last.actionableErrorCount : 0
  };
}

function deriveAnalyticsExportRows({
  now,
  workspaceScope,
  lifecycle,
  health,
  schedule,
  providerContract,
  sync,
  boundary,
  counters,
  proofReasonCounts,
  errorSeverityCounts
}) {
  const partitionKey = `${workspaceScope.tenantId}/${workspaceScope.workspaceId}`;
  const base = {
    contract: "hosted-kernel.job-thread-link.analytics-export-row.v1",
    exportedAt: now,
    partitionKey,
    cursor: sync.cursor,
    lifecycleMode: lifecycle.mode,
    healthStatus: health.status,
    providerId: providerContract.primaryProviderId,
    boundaryStatus: boundary.blockedBy || "accepted"
  };

  return [
    {
      ...base,
      rowKey: `${now}/counters`,
      rowType: "counter-summary",
      metrics: counters
    },
    {
      ...base,
      rowKey: `${now}/proof-reasons`,
      rowType: "proof-reason-summary",
      metrics: proofReasonCounts
    },
    {
      ...base,
      rowKey: `${now}/error-severity`,
      rowType: "error-severity-summary",
      metrics: errorSeverityCounts
    },
    {
      ...base,
      rowKey: `${now}/schedule`,
      rowType: "schedule-position",
      metrics: {
        due: schedule.due ? 1 : 0,
        forced: schedule.forced ? 1 : 0,
        retryHeld: schedule.retryAfterAt ? 1 : 0,
        blocked: schedule.blockedBy ? 1 : 0
      }
    }
  ];
}

function deriveAnalyticsReporting({
  input,
  command,
  commandReceipt,
  controls,
  lifecycle,
  schedule,
  links,
  providerContract,
  sync,
  recovery,
  externalHandoff,
  workspaceScope,
  boundary,
  health,
  persistedState,
  now
}) {
  const missingProofCount = links.filter((link) => !link.proofId).length;
  const invalidProofCount = links.filter((link) => !link.proofValid).length;
  const staleJobCount = links.filter((link) => link.stale).length;
  const previousHistory = normalizeAnalyticsHistory(input, persistedState);
  const previousSnapshot = previousHistory[previousHistory.length - 1] || null;
  const invalidProofLinks = links.filter((link) => !link.proofValid);
  const proofReasonCounts = countBy(invalidProofLinks, (link) => link.proofBlockedBy || "invalid_proof");
  const errorSeverityCounts = countBy(health.actionableErrors, (error) => error.severity || "error");
  const providerServiceStateCounts = countBy(providerContract.providers, (provider) => provider.serviceState);
  const timelineWarnings = [
    ...boundary.rejectedLinks.map((link) => link.rejectionReason),
    ...invalidProofLinks.map((link) => link.proofBlockedBy),
    ...health.actionableErrors.map((error) => error.code)
  ].filter(Boolean);
  const counters = {
    linkedJobCount: links.length,
    staleJobCount,
    freshJobCount: links.length - staleJobCount,
    proofedJobCount: links.length - missingProofCount,
    missingProofCount,
    invalidProofCount,
    rejectedLinkCount: boundary.rejectedLinkCount,
    quarantinedLinkCount: boundary.quarantinedLinkCount,
    actionableErrorCount: health.actionableErrors.length,
    providerCount: providerContract.providers.length,
    fallbackProviderCount: providerContract.negotiation.fallbackProviderIds.length,
    handoffPendingCount: externalHandoff.state === "pending" ? 1 : 0,
    replayedCommandCount: commandReceipt.replayed ? 1 : 0,
    scheduleDueCount: schedule.due ? 1 : 0,
    healthBlockedCount: health.status === "blocked" ? 1 : 0,
    healthDegradedCount: health.degraded ? 1 : 0,
    boundaryViolationCount: boundary.hardRejectedLinkCount,
    proofReasonVariantCount: Object.keys(proofReasonCounts).length,
    warningSignalCount: timelineWarnings.length
  };
  const currentSnapshot = {
    contract: "hosted-kernel.job-thread-link.analytics-snapshot.v1",
    sequence: previousSnapshot ? previousSnapshot.sequence + 1 : 1,
    capturedAt: now,
    lifecycleMode: lifecycle.mode,
    healthStatus: health.status,
    providerId: providerContract.primaryProviderId,
    providerNegotiated: providerContract.negotiated,
    linkedJobCount: counters.linkedJobCount,
    staleJobCount: counters.staleJobCount,
    rejectedLinkCount: counters.rejectedLinkCount,
    quarantinedLinkCount: counters.quarantinedLinkCount,
    actionableErrorCount: counters.actionableErrorCount,
    scheduleDue: schedule.due,
    cursor: sync.cursor
  };
  const history = [...previousHistory, currentSnapshot].slice(-12);
  const historyRollup = deriveAnalyticsHistoryRollup(history);
  const historyDelta = previousSnapshot
    ? {
        linkedJobCount: counters.linkedJobCount - previousSnapshot.linkedJobCount,
        staleJobCount: counters.staleJobCount - previousSnapshot.staleJobCount,
        rejectedLinkCount: counters.rejectedLinkCount - previousSnapshot.rejectedLinkCount,
        quarantinedLinkCount: counters.quarantinedLinkCount - previousSnapshot.quarantinedLinkCount,
        actionableErrorCount: counters.actionableErrorCount - previousSnapshot.actionableErrorCount,
        cursorChanged: previousSnapshot.cursor !== sync.cursor,
        lifecycleChanged: previousSnapshot.lifecycleMode !== lifecycle.mode,
        healthChanged: previousSnapshot.healthStatus !== health.status
      }
    : {
        linkedJobCount: counters.linkedJobCount,
        staleJobCount: counters.staleJobCount,
        rejectedLinkCount: counters.rejectedLinkCount,
        quarantinedLinkCount: counters.quarantinedLinkCount,
        actionableErrorCount: counters.actionableErrorCount,
        cursorChanged: false,
        lifecycleChanged: false,
        healthChanged: false
      };
  const timeline = [
    {
      at: now,
      event: "command-received",
      state: commandReceipt.status,
      subject: commandReceipt.idempotencyKey || command,
      exportKey: `${workspaceScope.workspaceId}:command:${commandReceipt.effectiveCommand}`
    },
    {
      at: now,
      event: "lifecycle-evaluated",
      state: lifecycle.mode,
      subject: lifecycle.reason,
      exportKey: `${workspaceScope.workspaceId}:lifecycle:${lifecycle.mode}`
    },
    {
      at: schedule.nextRunAt || now,
      event: "schedule-positioned",
      state: schedule.due ? "due" : schedule.blockedBy || "waiting",
      subject: schedule.nextRunAt,
      exportKey: `${workspaceScope.workspaceId}:schedule:${schedule.due ? "due" : "waiting"}`
    },
    {
      at: now,
      event: "provider-negotiated",
      state: providerContract.negotiated ? "accepted" : providerContract.blockedBy || "blocked",
      subject: providerContract.primaryProviderId,
      exportKey: `${workspaceScope.workspaceId}:provider:${providerContract.primaryProviderId || "missing"}`
    },
    {
      at: now,
      event: "recovery-shaped",
      state: recovery.status,
      subject: sync.cursor,
      exportKey: `${workspaceScope.workspaceId}:recovery:${recovery.status}`
    },
    {
      at: now,
      event: "proof-coverage-counted",
      state: invalidProofLinks.length ? "needs-proof-work" : "covered",
      subject: Object.keys(proofReasonCounts).join(",") || "valid",
      exportKey: `${workspaceScope.workspaceId}:proof:${invalidProofLinks.length ? "invalid" : "valid"}`
    },
    {
      at: now,
      event: "health-signals-counted",
      state: health.failureState,
      subject: Object.keys(errorSeverityCounts).join(",") || "none",
      exportKey: `${workspaceScope.workspaceId}:health:${health.failureState}`
    }
  ];
  const exportRows = deriveAnalyticsExportRows({
    now,
    workspaceScope,
    lifecycle,
    health,
    schedule,
    providerContract,
    sync,
    boundary,
    counters,
    proofReasonCounts,
    errorSeverityCounts
  });
  const reportingState = {
    contract: "hosted-kernel.job-thread-link.reporting-state.v1",
    generatedAt: now,
    exportCursor: `${sync.cursor}/${historyRollup.sampleCount}`,
    exportSchemaVersion: 1,
    historyWindowSize: history.length,
    historyRollup,
    proofReasonCounts,
    errorSeverityCounts,
    providerServiceStateCounts,
    timelineWarningCodes: normalizeCapabilityList(timelineWarnings),
    reportStatus: boundary.blockedBy || health.status === "blocked" ? "blocked" : health.degraded ? "degraded" : "ready",
    reportBlockedBy: boundary.blockedBy || health.blockedBy || null
  };

  return {
    contract: "hosted-kernel.job-thread-link.analytics-reporting.v1",
    generatedAt: now,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    command,
    effectiveCommand: commandReceipt.effectiveCommand,
    counters,
    proofReasonCounts,
    errorSeverityCounts,
    providerServiceStateCounts,
    historyDelta,
    historyRollup,
    history,
    timeline,
    reportingState,
    exportRows,
    exportSummary: {
      contract: "hosted-kernel.job-thread-link.analytics-export.v1",
      exportReady: !boundary.blockedBy && health.status !== "blocked",
      partitionKey: `${workspaceScope.tenantId}/${workspaceScope.workspaceId}`,
      rowKey: `${now}/${sync.cursor}`,
      cursor: sync.cursor,
      providerId: providerContract.primaryProviderId,
      lifecycleMode: lifecycle.mode,
      healthStatus: health.status,
      recoveryStatus: recovery.status,
      externalHandoffState: externalHandoff.state,
      nextRunAt: schedule.nextRunAt,
      blockedBy: boundary.blockedBy || health.blockedBy || schedule.blockedBy,
      metricNames: Object.keys(counters),
      rowCount: exportRows.length,
      rowTypes: exportRows.map((row) => row.rowType),
      reportingState: reportingState.reportStatus
    }
  };
}

function deriveNextAction(command, lifecycle, schedule, links, externalHandoff, health, controls) {
  if (lifecycle.mode === "disabled") return "keep-linking-disabled";
  if (lifecycle.mode === "paused") return "hold-job-thread-link";
  if (lifecycle.mode === "restart-required" || controls.restartRequired) return "restart-job-thread-link-worker";
  if (health.status === "blocked") return "resolve-blocking-job-thread-link-error";
  if (health.retryAfterAt && !schedule.due) return "retry-job-thread-link-after-backoff";
  if (schedule.blockedBy === "operator_hold_until") return "wait-for-operator-hold-to-expire";
  if (schedule.blockedBy === "schedule_misfire_held") return "review-held-schedule-misfire";
  if (schedule.blockedBy === "invalid_schedule_run_window") return "repair-schedule-run-window";
  if (schedule.blockedBy === "schedule_window_not_started" || schedule.blockedBy === "outside_schedule_window") {
    return "wait-for-schedule-window";
  }
  if (lifecycle.mode === "boundary-blocked") return "reject-job-thread-link-boundary-crossing";
  if (externalHandoff.required) return "handoff-job-thread-link-to-provider";
  if (lifecycle.mode === "repair") return "refresh-stale-job-thread-links";
  if (lifecycle.mode === "awaiting-proof") return "collect-missing-link-proofs";
  if (schedule.due) return command === "schedule" ? "run-scheduled-link-pass" : "run-link-maintenance";
  if (!links.length) return "wait-for-hosted-kernel-job-thread";
  return "monitor-linked-job-threads";
}

function deriveLifecycleCommandState({
  commandReceipt,
  settings,
  controls,
  lifecycle,
  schedule,
  health,
  validationSummary,
  clientRuntime
}) {
  const command = commandReceipt.effectiveCommand;
  const mutating = commandReceipt.mutating && commandReceipt.accepted;
  const commandIntent =
    command === "enable" || command === "resume"
      ? "activate-linking"
      : command === "disable"
        ? "disable-linking"
        : command === "pause"
          ? "hold-linking"
          : command === "schedule"
            ? "position-scheduled-pass"
            : "inspect-linking";
  const scheduleWritable = command === "schedule" || command === "enable" || command === "resume";
  const settingsWritable = command === "enable" || command === "disable" || command === "schedule";
  const controlBlockedBy =
    commandReceipt.replayed
      ? "idempotent_replay"
      : command === "enable" && settings.enabled === false
        ? "settings_enabled_false"
        : command === "schedule" && !controls.enabled
          ? "lifecycle_controls_disabled"
          : command === "pause" && !controls.operatorHoldUntilAt && controls.effectiveMode !== "paused"
            ? "pause_requires_hold_or_paused_mode"
            : validationSummary.failedCheckCount && mutating
              ? "validation_failed"
              : health.status === "blocked"
                ? health.blockedBy || "health_blocked"
                : null;
  const allowed = !controlBlockedBy && (command === "inspect" || mutating || commandReceipt.accepted);
  const nextCommand =
    controlBlockedBy === "settings_enabled_false"
      ? "enable"
      : controlBlockedBy === "pause_requires_hold_or_paused_mode"
        ? "pause"
        : schedule.due
          ? "schedule"
          : lifecycle.mode === "paused"
            ? "resume"
            : lifecycle.mode === "disabled"
              ? "enable"
              : "inspect";

  return {
    contract: "hosted-kernel.job-thread-link.lifecycle-command-state.v1",
    generatedForRequestId: clientRuntime.requestId,
    requestedCommand: commandReceipt.command,
    effectiveCommand: command,
    commandIntent,
    accepted: commandReceipt.accepted,
    allowed,
    blockedBy: controlBlockedBy,
    replayed: commandReceipt.replayed,
    mutating,
    settingsControl: {
      writable: settingsWritable,
      enabled: settings.enabled,
      proofRequired: settings.proofRequired,
      changedKeys: controls.changedSettings.map((entry) => entry.key),
      normalizedKeys: controls.normalizedSettings,
      restartRequired: controls.restartRequired
    },
    enablementControl: {
      mode: controls.effectiveMode,
      enabled: controls.enabled,
      paused: controls.paused,
      canEnable: settings.enabled !== false && lifecycle.mode !== "boundary-blocked" && health.status !== "blocked",
      canDisable: commandReceipt.accepted && lifecycle.mode !== "boundary-blocked",
      canResume: lifecycle.mode === "paused" && health.status !== "blocked",
      canPause: controls.effectiveMode !== "disabled" && health.status !== "blocked",
      operatorHoldUntilAt: controls.operatorHoldUntilAt
    },
    schedulingControl: {
      writable: scheduleWritable,
      intervalMs: controls.scheduleIntervalMs,
      nextRunAt: schedule.nextRunAt,
      due: schedule.due,
      forced: schedule.forced,
      policy: controls.schedulePolicy,
      missedRunCount: schedule.missedRunCount,
      catchUpRunCount: schedule.catchUpRunCount,
      skipMissedRuns: schedule.skipMissedRuns,
      runWindowActive: schedule.runWindowActive,
      retryAfterAt: schedule.retryAfterAt || null,
      blockedBy: schedule.blockedBy,
      runNowAllowed: controls.enabled && lifecycle.ready && health.acceptingOperations,
      requestedNextRunAt: controls.requestedNextRunAt
    },
    nextActionState: {
      lifecycleMode: lifecycle.mode,
      healthStatus: health.status,
      clientDispatchMode: clientRuntime.dispatchMode,
      recommendedCommand: nextCommand,
      requiresOperatorReview: Boolean(controlBlockedBy || controls.restartRequired || health.degraded),
      readyForAutomation: allowed && schedule.due && health.acceptingOperations && clientRuntime.canDispatch
    }
  };
}

function validationStatus(pass, degraded = false) {
  if (!pass) return "failed";
  return degraded ? "warning" : "passed";
}

function deriveValidationSummary({
  lifecycle,
  schedule,
  providerContract,
  sync,
  proofLedger,
  boundary,
  health,
  links,
  warnings
}) {
  const invalidProofLinks = links.filter((link) => !link.proofValid);
  const checks = [
    {
      code: "boundary_scope",
      label: "Tenant and workspace scope",
      status: validationStatus(!boundary.blockedBy, boundary.quarantinedLinkCount > 0),
      severity: boundary.blockedBy ? "critical" : boundary.quarantinedLinkCount ? "warning" : "info",
      message: boundary.blockedBy
        ? "One or more links or the caller principal failed hosted-kernel boundary validation"
        : boundary.quarantinedLinkCount
          ? "Out-of-scope workspace links were quarantined from the hosted-kernel result"
          : "All scoped links are inside the authorized hosted-kernel boundary",
      count: boundary.rejectedLinkCount
    },
    {
      code: "provider_contract",
      label: "Provider contract",
      status: validationStatus(providerContract.negotiated, providerContract.blockedBy === "provider_degraded"),
      severity: providerContract.negotiated ? "info" : "error",
      message: providerContract.negotiated
        ? "A provider satisfied the job-thread-link capability contract"
        : "No provider currently satisfies the job-thread-link capability contract",
      count: providerContract.missingCapabilities.length
    },
    {
      code: "provider_sync_contract",
      label: "Provider sync contract",
      status: validationStatus(!sync.syncBarrier.blockedBy, sync.syncBarrier.batchCount > 1),
      severity: sync.syncBarrier.blockedBy ? "error" : sync.syncBarrier.batchCount > 1 ? "warning" : "info",
      message: sync.syncBarrier.blockedBy
        ? "The selected provider sync barrier blocked job-thread-link handoff"
        : sync.syncBarrier.batchCount > 1
          ? "The selected provider will sync job-thread links in multiple batches"
          : "The selected provider sync barrier is satisfied",
      count: sync.syncBarrier.batchCount
    },
    {
      code: "link_proof",
      label: "Link proof coverage",
      status: validationStatus(invalidProofLinks.length === 0),
      severity: invalidProofLinks.length ? "warning" : "info",
      message: invalidProofLinks.length
        ? "Some scoped job/thread links do not have valid proof"
        : "Scoped job/thread links have valid hosted-kernel link proof",
      count: invalidProofLinks.length
    },
    {
      code: "schedule_readiness",
      label: "Schedule readiness",
      status: validationStatus(Boolean(schedule.nextRunAt || schedule.due), Boolean(schedule.retryAfterAt)),
      severity: schedule.blockedBy ? "warning" : "info",
      message: schedule.blockedBy
        ? "The next lifecycle pass is blocked or held"
        : "The next lifecycle pass is positioned for the hosted kernel",
      count: schedule.due ? 1 : 0
    },
    {
      code: "runtime_health",
      label: "Runtime health",
      status: validationStatus(health.status !== "blocked" && health.status !== "failing", health.degraded),
      severity: health.status === "blocked" ? "critical" : health.status === "failing" ? "error" : health.degraded ? "warning" : "info",
      message: health.actionableErrors.length
        ? "Runtime health has actionable hosted-kernel follow-up"
        : "Runtime health has no actionable job-thread-link errors",
      count: health.actionableErrors.length
    }
  ];
  const failedChecks = checks.filter((check) => check.status === "failed");
  const warningChecks = checks.filter((check) => check.status === "warning");
  const readinessScore = Math.round(
    (checks.reduce((score, check) => score + (check.status === "passed" ? 1 : check.status === "warning" ? 0.5 : 0), 0) /
      checks.length) *
      100
  );

  return {
    contract: "hosted-kernel.job-thread-link.validation-summary.v1",
    ready: lifecycle.ready && failedChecks.length === 0 && health.status !== "blocked",
    status: failedChecks.length ? "failed" : warningChecks.length || warnings.length ? "warning" : "passed",
    readinessScore,
    failedCheckCount: failedChecks.length,
    warningCheckCount: warningChecks.length + warnings.length,
    warningCount: warnings.length,
    scopedLinkCount: boundary.scopedLinkCount,
    rejectedLinkCount: boundary.rejectedLinkCount,
    quarantinedLinkCount: boundary.quarantinedLinkCount,
    hardRejectedLinkCount: boundary.hardRejectedLinkCount,
    proofedLinkCount: proofLedger.proofedLinkCount,
    invalidProofReasons: proofLedger.invalidProofReasons,
    checks
  };
}

function deriveNextStepContract({
  nextAction,
  commandState,
  lifecycle,
  schedule,
  health,
  externalHandoff,
  providerContract,
  sync,
  workspaceScope,
  validationSummary,
  clientRuntime
}) {
  const blockingError = health.actionableErrors[0] || null;
  const routeVerb =
    nextAction === "run-scheduled-link-pass" || nextAction === "run-link-maintenance"
      ? "POST"
      : nextAction.startsWith("wait-") || nextAction.startsWith("monitor-")
        ? "GET"
        : "PATCH";

  return {
    contract: "hosted-kernel.job-thread-link.next-step.v1",
    action: nextAction,
    label: nextAction.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    readyForClientDispatch:
      validationSummary.ready &&
      commandState.allowed &&
      !externalHandoff.required &&
      clientRuntime.canDispatch &&
      !health.degradedMode?.readOnly,
    blockedBy:
      commandState.blockedBy ||
      blockingError?.code ||
      externalHandoff.reason ||
      schedule.blockedBy ||
      providerContract.blockedBy ||
      null,
    reason: blockingError?.message || lifecycle.reason,
    retryAfterAt: health.retryAfterAt,
    routeHint: {
      method: routeVerb,
      surfaceId,
      command: commandState.nextActionState.recommendedCommand,
      tenantId: workspaceScope.tenantId,
      workspaceId: workspaceScope.workspaceId,
      cursor: sync.cursor,
      clientRoute: clientRuntime.surfaceRoute,
      clientRequestId: clientRuntime.requestId
    },
    handoff: externalHandoff.required
      ? {
          state: externalHandoff.state,
          providerId: externalHandoff.providerId,
          endpoint: externalHandoff.endpoint
        }
      : null
  };
}

function deriveClientContinuationContract({
  clientRuntime,
  nextStep,
  externalHandoff,
  previewAcceptance,
  validationSummary,
  health,
  schedule,
  sync,
  state,
  blockedBy,
  dispatchReady,
  externalReady,
  now
}) {
  const continuationKey =
    clientRuntime.continuationKey ||
    [
      clientRuntime.requestId || "request:anonymous",
      clientRuntime.sessionId || "session:anonymous",
      sync.cursor
    ].join("/");
  const mode = blockedBy
    ? "blocked"
    : externalReady
      ? "external-handoff"
      : dispatchReady
        ? "dispatch"
        : state === "waiting"
          ? "wait"
          : "preview";
  const nextClientState =
    mode === "external-handoff"
      ? "handoff"
      : mode === "dispatch"
        ? "ready"
        : mode === "wait"
          ? "waiting"
          : mode === "blocked"
            ? "blocked"
            : "preview";
  const action =
    mode === "external-handoff"
      ? "open-provider-handoff"
      : mode === "dispatch"
        ? nextStep.action
        : mode === "wait"
          ? "wait-for-next-kernel-pass"
          : mode === "blocked"
            ? "review-blocking-kernel-state"
            : "render-job-thread-link-preview";
  const dispatchEnvelope = {
    contract: "hosted-kernel.job-thread-link.client-dispatch-envelope.v1",
    mode,
    action,
    requestId: clientRuntime.requestId,
    continuationKey,
    idempotencyKey: previewAcceptance.acceptanceToken || `${continuationKey}/${nextStep.routeHint.command}`,
    method: nextStep.routeHint.method,
    route: clientRuntime.callbackRoute || nextStep.routeHint.clientRoute,
    command: nextStep.routeHint.command,
    cursor: sync.cursor,
    ready: mode === "dispatch" || mode === "external-handoff",
    blockedBy,
    retryAfterAt: health.retryAfterAt,
    nextRunAt: schedule.nextRunAt
  };

  return {
    contract: "hosted-kernel.job-thread-link.client-continuation.v1",
    generatedAt: now,
    mode,
    allowedModes: [...CLIENT_CONTINUATION_MODES],
    action,
    statePatch: {
      contract: "hosted-kernel.job-thread-link.client-state-patch.v1",
      requestId: clientRuntime.requestId,
      parentRequestId: clientRuntime.parentRequestId,
      sessionId: clientRuntime.sessionId,
      workflowState: nextClientState,
      dispatchMode: clientRuntime.dispatchMode,
      continuationKey,
      cursor: sync.cursor,
      validationStatus: validationSummary.status,
      healthStatus: health.status,
      retryAfterAt: health.retryAfterAt,
      nextRunAt: schedule.nextRunAt,
      blockedBy
    },
    dispatchEnvelope,
    handoffInstruction:
      mode === "external-handoff"
        ? {
            contract: "hosted-kernel.job-thread-link.client-handoff-instruction.v1",
            providerId: externalHandoff.providerId,
            endpoint: externalHandoff.endpoint,
            callbackRoute: clientRuntime.callbackRoute,
            returnUrl: clientRuntime.returnUrl,
            payloadCursor: externalHandoff.payload?.cursor || sync.cursor
          }
        : null,
    userVisibleStatus: {
      contract: "hosted-kernel.job-thread-link.user-visible-status.v1",
      label: action.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
      blockedBy,
      previewAccepted: previewAcceptance.accepted,
      readinessScore: validationSummary.readinessScore,
      retryAfterAt: health.retryAfterAt,
      nextRunAt: schedule.nextRunAt
    }
  };
}

function deriveClientWorkflowHandoff({
  clientRuntime,
  nextStep,
  externalHandoff,
  previewAcceptance,
  validationSummary,
  health,
  schedule,
  sync,
  now
}) {
  const externalReady = externalHandoff.required && externalHandoff.state === "pending" && clientRuntime.canAcceptExternalHandoff;
  const blockedBy =
    previewAcceptance.blockedBy ||
    (externalReady ? null : nextStep.blockedBy) ||
    health.blockedBy ||
    (clientRuntime.canRenderPreview ? null : "client_preview_unavailable");
  const dispatchReady = nextStep.readyForClientDispatch && clientRuntime.canDispatch;
  const state = blockedBy
    ? "blocked"
    : externalReady
      ? "handoff"
      : previewAcceptance.accepted || dispatchReady
        ? "ready"
        : schedule.nextRunAt
          ? "waiting"
          : "preview";
  const continuation = deriveClientContinuationContract({
    clientRuntime,
    nextStep,
    externalHandoff,
    previewAcceptance,
    validationSummary,
    health,
    schedule,
    sync,
    state,
    blockedBy,
    dispatchReady,
    externalReady,
    now
  });

  return {
    contract: "hosted-kernel.job-thread-link.client-workflow-handoff.v1",
    generatedAt: now,
    state,
    blockedBy,
    dispatchReady,
    externalReady,
    previewReady: clientRuntime.canRenderPreview && validationSummary.failedCheckCount === 0,
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    surfaceRoute: clientRuntime.surfaceRoute,
    returnUrl: clientRuntime.returnUrl,
    dispatchMode: clientRuntime.dispatchMode,
    workflowState: clientRuntime.workflowState,
    continuation,
    clientStatePatch: continuation.statePatch,
    dispatchEnvelope: continuation.dispatchEnvelope,
    routeHint: {
      ...nextStep.routeHint,
      clientRoute: clientRuntime.surfaceRoute,
      returnUrl: clientRuntime.returnUrl,
      requestId: clientRuntime.requestId
    },
    handoff: externalReady
      ? {
          providerId: externalHandoff.providerId,
          endpoint: externalHandoff.endpoint,
          payloadCursor: externalHandoff.payload?.cursor || sync.cursor
        }
      : null,
    ui: {
      primaryAction: externalReady ? "open-provider-handoff" : nextStep.action,
      statusLabel: state.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
      retryAfterAt: health.retryAfterAt,
      nextRunAt: schedule.nextRunAt,
      acceptanceToken: previewAcceptance.acceptanceToken,
      cursor: sync.cursor
    }
  };
}

function derivePreviewAcceptance({
  input,
  commandReceipt,
  lifecycle,
  schedule,
  health,
  boundary,
  validationSummary,
  nextStep,
  sync,
  links,
  workspaceScope,
  principal,
  now
}) {
  const source = input.preview || input.acceptance || {};
  const requested = Boolean(source.accept || input.acceptPreview || input.accept);
  const requestedToken = source.acceptanceToken || input.acceptanceToken ? String(source.acceptanceToken || input.acceptanceToken) : null;
  const operatorNote = source.note || source.operatorNote || input.operatorNote ? String(source.note || source.operatorNote || input.operatorNote) : null;
  const expectedToken = `${workspaceScope.tenantId}/${workspaceScope.workspaceId}/${sync.cursor}/${commandReceipt.effectiveCommand}`;
  const invalidPreviewLinks = links
    .filter((link) => link.stale || !link.proofValid)
    .slice(0, 12)
    .map((link) => ({
      jobId: link.jobId,
      threadId: link.threadId,
      state: link.stale ? "stale" : link.state,
      proofStatus: link.proofStatus,
      blockedBy: link.stale ? "stale_link" : link.proofBlockedBy,
      updatedAt: link.updatedAt
    }));
  const failedChecks = validationSummary.checks.filter((check) => check.status === "failed");
  const warningChecks = validationSummary.checks.filter((check) => check.status === "warning");
  const tokenSatisfied = !requested || !requestedToken || requestedToken === expectedToken;
  const accepted = requested && tokenSatisfied && validationSummary.ready && commandReceipt.accepted;
  const blockedBy = accepted
    ? null
    : requested && !tokenSatisfied
      ? "acceptance_token_mismatch"
      : !commandReceipt.accepted
        ? "idempotent_replay"
        : validationSummary.failedCheckCount
          ? "validation_failed"
          : health.status === "blocked"
            ? health.blockedBy || "health_blocked"
            : null;
  const acceptancePrerequisites = [
    {
      code: "command_receipt",
      label: "Command receipt",
      satisfied: commandReceipt.accepted,
      blockedBy: commandReceipt.accepted ? null : "idempotent_replay",
      detail: commandReceipt.status
    },
    {
      code: "validation_summary",
      label: "Validation summary",
      satisfied: validationSummary.failedCheckCount === 0,
      blockedBy: validationSummary.failedCheckCount ? "validation_failed" : null,
      detail: validationSummary.status
    },
    {
      code: "runtime_health",
      label: "Runtime health",
      satisfied: health.status !== "blocked",
      blockedBy: health.status === "blocked" ? health.blockedBy || "health_blocked" : null,
      detail: health.status
    },
    {
      code: "acceptance_token",
      label: "Acceptance token",
      satisfied: tokenSatisfied,
      blockedBy: tokenSatisfied ? null : "acceptance_token_mismatch",
      detail: requestedToken ? "provided" : "not-required-for-preview"
    }
  ];
  const readinessLanes = [
    {
      lane: "scope",
      status: boundary.blockedBy ? "blocked" : boundary.quarantinedLinkCount ? "warning" : "ready",
      score: boundary.blockedBy ? 0 : boundary.quarantinedLinkCount ? 50 : 100,
      blockedBy: boundary.blockedBy,
      count: boundary.scopedLinkCount
    },
    {
      lane: "proof",
      status: invalidPreviewLinks.some((link) => link.proofStatus !== "valid") ? "warning" : "ready",
      score: links.length ? Math.round((links.filter((link) => link.proofValid).length / links.length) * 100) : 100,
      blockedBy: validationSummary.invalidProofReasons[0] || null,
      count: links.filter((link) => link.proofValid).length
    },
    {
      lane: "schedule",
      status: schedule.blockedBy ? "blocked" : schedule.due ? "ready" : "waiting",
      score: schedule.blockedBy ? 0 : schedule.nextRunAt || schedule.due ? 100 : 50,
      blockedBy: schedule.blockedBy,
      count: schedule.due ? 1 : 0
    },
    {
      lane: "health",
      status: health.status === "blocked" ? "blocked" : health.degraded ? "warning" : "ready",
      score: health.status === "blocked" ? 0 : health.degraded ? 60 : 100,
      blockedBy: health.blockedBy,
      count: health.actionableErrors.length
    }
  ];

  return {
    contract: "hosted-kernel.job-thread-link.preview-acceptance.v1",
    generatedAt: now,
    previewMode: requested ? "acceptance-requested" : "preview-only",
    requested,
    requestedToken,
    tokenSatisfied,
    accepted,
    status: accepted ? "accepted" : requested ? "blocked" : validationSummary.ready ? "ready-for-acceptance" : "needs-attention",
    blockedBy,
    acceptedBy: accepted ? principal.principalId : null,
    acceptedAt: accepted ? now : null,
    acceptanceToken: validationSummary.ready ? expectedToken : null,
    operatorNote,
    acceptancePrerequisites,
    readiness: {
      ready: validationSummary.ready,
      score: validationSummary.readinessScore,
      status: validationSummary.status,
      lifecycleMode: lifecycle.mode,
      healthStatus: health.status,
      boundaryStatus: boundary.blockedBy || "accepted",
      nextRunAt: schedule.nextRunAt,
      lanes: readinessLanes,
      failedChecks: failedChecks.map((check) => ({
        code: check.code,
        label: check.label,
        severity: check.severity,
        message: check.message,
        count: check.count
      })),
      warnings: warningChecks.map((check) => ({
        code: check.code,
        label: check.label,
        severity: check.severity,
        message: check.message,
        count: check.count
      }))
    },
    routeContract: {
      contract: "hosted-kernel.job-thread-link.preview-route.v1",
      method: nextStep.routeHint.method,
      route: nextStep.routeHint.clientRoute,
      command: nextStep.routeHint.command,
      requestId: nextStep.routeHint.clientRequestId,
      cursor: sync.cursor,
      acceptanceToken: validationSummary.ready ? expectedToken : null,
      dispatchReady: nextStep.readyForClientDispatch,
      blockedBy: blockedBy || nextStep.blockedBy
    },
    preview: {
      title: `${links.length} job/thread link${links.length === 1 ? "" : "s"} ${lifecycle.ready ? "ready" : "not ready"}`,
      summary: {
        linkedJobCount: links.length,
        invalidLinkCount: invalidPreviewLinks.length,
        failedCheckCount: validationSummary.failedCheckCount,
        warningCheckCount: validationSummary.warningCheckCount,
        readinessScore: validationSummary.readinessScore
      },
      primaryAction: nextStep.action,
      primaryActionEnabled: !blockedBy && validationSummary.ready,
      secondaryAction: health.retryAfterAt ? "wait-for-retry-backoff" : "inspect-job-thread-link",
      nextRunAt: schedule.nextRunAt,
      retryAfterAt: health.retryAfterAt,
      cursor: sync.cursor,
      invalidLinkSummaries: invalidPreviewLinks,
      linkSummaries: links.slice(0, 12).map((link) => ({
        jobId: link.jobId,
        threadId: link.threadId,
        state: link.state,
        proofStatus: link.proofStatus,
        stale: link.stale,
        proofBlockedBy: link.proofBlockedBy,
        ageMs: link.ageMs
      }))
    }
  };
}

function buildAudit({
  command,
  commandReceipt,
  controls,
  commandState,
  lifecycle,
  schedule,
  links,
  providerContract,
  sync,
  recovery,
  persistedState,
  externalHandoff,
  proofLedger,
  workspaceScope,
  principal,
  boundary,
  health,
  analytics,
  clientRuntime,
  clientWorkflowHandoff,
  validationSummary,
  previewAcceptance,
  nextStep,
  warnings,
  now
}) {
  return {
    proofType: "hosted-kernel.job-thread-link.lifecycle.v1",
    generatedAt: now,
    command,
    effectiveCommand: commandReceipt.effectiveCommand,
    commandId: commandReceipt.idempotencyKey,
    idempotentReplay: commandReceipt.replayed,
    commandReplaySource: commandReceipt.replaySource,
    commandPreviousOutcome: commandReceipt.previousOutcome,
    commandIntent: commandState.commandIntent,
    commandAllowed: commandState.allowed,
    commandBlockedBy: commandState.blockedBy,
    recommendedCommand: commandState.nextActionState.recommendedCommand,
    readyForAutomation: commandState.nextActionState.readyForAutomation,
    controlMode: controls.effectiveMode,
    controlEnabled: controls.enabled,
    operatorHoldUntilAt: controls.operatorHoldUntilAt,
    scheduleIntervalMs: controls.scheduleIntervalMs,
    schedulePolicy: controls.schedulePolicy,
    scheduleMisfirePolicy: schedule.misfirePolicy,
    scheduleWindowPolicy: schedule.windowPolicy,
    scheduleMissedRunCount: schedule.missedRunCount,
    scheduleCatchUpRunCount: schedule.catchUpRunCount,
    scheduleRunWindowActive: schedule.runWindowActive,
    restartRequired: controls.restartRequired,
    changedSettings: controls.changedSettings.map((entry) => entry.key),
    normalizedSettings: controls.normalizedSettings,
    lifecycleMode: lifecycle.mode,
    healthStatus: health.status,
    healthFailureState: health.failureState,
    healthRetryPlan: health.retryPlan,
    degradedMode: health.degradedMode,
    degraded: health.degraded,
    retryAfterAt: health.retryAfterAt,
    actionableErrorCount: health.actionableErrors.length,
    ready: lifecycle.ready,
    recoveryStatus: recovery.status,
    restartSafe: recovery.restartSafe,
    restartSemanticStatus: recovery.restartSemanticStatus,
    recoveryResumePlan: recovery.resumePlan,
    checkpointFingerprint: recovery.checkpointFingerprint,
    checkpointChanged: recovery.checkpointChanged,
    linkedJobCount: links.length,
    staleJobCount: links.filter((link) => link.stale).length,
    proofedLinkCount: proofLedger.proofedLinkCount,
    invalidProofReasons: proofLedger.invalidProofReasons,
    scheduleDue: schedule.due,
    providerNegotiated: providerContract.negotiated,
    providerId: providerContract.primaryProviderId,
    providerServiceState: providerContract.primaryServiceState,
    providerBlockedBy: providerContract.blockedBy,
    providerHandshakeVersion: providerContract.primaryHandshakeVersion,
    providerServiceContract: providerContract.serviceContractState,
    syncCursor: sync.cursor,
    syncCursorSource: sync.cursorSource,
    syncMode: sync.providerSyncMode,
    syncBlockedBy: sync.syncBlockedBy,
    syncBarrier: sync.syncBarrier,
    syncBatchCount: sync.batchCount,
    providerSyncLagMs: sync.providerSyncLagMs,
    tenantId: workspaceScope.tenantId,
    workspaceId: workspaceScope.workspaceId,
    principalId: principal.principalId,
    boundaryStatus: boundary.blockedBy || "accepted",
    boundaryMode: boundary.boundaryMode,
    rejectedLinkCount: boundary.rejectedLinkCount,
    quarantinedLinkCount: boundary.quarantinedLinkCount,
    hardRejectedLinkCount: boundary.hardRejectedLinkCount,
    boundaryAccessDecision: boundary.accessDecision,
    persistedGeneration: persistedState.generation,
    externalHandoffRequired: externalHandoff.required,
    clientWorkflowState: clientWorkflowHandoff.state,
    clientContinuationMode: clientWorkflowHandoff.continuation.mode,
    clientContinuationAction: clientWorkflowHandoff.continuation.action,
    clientContinuationKey: clientWorkflowHandoff.continuation.statePatch.continuationKey,
    clientDispatchEnvelope: clientWorkflowHandoff.dispatchEnvelope,
    clientDispatchReady: clientWorkflowHandoff.dispatchReady,
    clientExternalReady: clientWorkflowHandoff.externalReady,
    clientRequestOrigin: clientRuntime.requestOrigin,
    clientParentRequestId: clientRuntime.parentRequestId,
    clientSurfaceRoute: clientRuntime.surfaceRoute,
    clientCallbackRoute: clientRuntime.callbackRoute,
    clientSessionId: clientRuntime.sessionId,
    analyticsCounters: analytics.counters,
    analyticsProofReasonCounts: analytics.proofReasonCounts,
    analyticsErrorSeverityCounts: analytics.errorSeverityCounts,
    analyticsProviderServiceStateCounts: analytics.providerServiceStateCounts,
    analyticsHistoryDelta: analytics.historyDelta,
    analyticsHistoryRollup: analytics.historyRollup,
    analyticsReportingState: analytics.reportingState,
    analyticsExportRows: analytics.exportRows,
    analyticsExportSummary: analytics.exportSummary,
    analyticsTimeline: analytics.timeline,
    validationStatus: validationSummary.status,
    validationReadinessScore: validationSummary.readinessScore,
    validationFailedCheckCount: validationSummary.failedCheckCount,
    previewAcceptanceStatus: previewAcceptance.status,
    previewAccepted: previewAcceptance.accepted,
    previewBlockedBy: previewAcceptance.blockedBy,
    nextStepAction: nextStep.action,
    nextStepReadyForClientDispatch: nextStep.readyForClientDispatch,
    actionableErrors: health.actionableErrors,
    warnings,
    evidence: links.map((link) => ({
      jobId: link.jobId,
      threadId: link.threadId,
      tenantId: link.tenantId,
      workspaceId: link.workspaceId,
      state: link.state,
      proofId: link.proofId,
      proofStatus: link.proofStatus,
      proofValid: link.proofValid,
      proofBlockedBy: link.proofBlockedBy,
      proofSource: link.proofSource,
      proofFingerprint: link.proofFingerprint
    })),
    rejectedEvidence: boundary.rejectedLinks.map((link) => ({
      jobId: link.jobId,
      threadId: link.threadId,
      tenantId: link.tenantId,
      workspaceId: link.workspaceId,
      reason: link.rejectionReason,
      disposition: link.auditDisposition,
      hardRejected: link.hardRejected
    }))
  };
}

export function describeJobThreadLinkSurface(input = {}) {
  const now = toIso(input.now, new Date().toISOString());
  const nowMs = new Date(now).getTime();
  const normalized = normalizeSettings(input.settings || {});
  const normalizedHealthPolicy = normalizeHealthPolicy(input);
  const workspaceScope = normalizeWorkspaceScope(input);
  const principal = normalizePrincipal(input, workspaceScope);
  const clientRuntime = normalizeClientRuntime(input, workspaceScope, principal, now);
  const persisted = normalizePersistedState(input, now);
  const providerState = normalizeProviders(input);
  const providerContract = deriveProviderContract(providerState);
  const command = normalizeCommand(input.command, normalized.settings);
  const commandReceipt = deriveCommandReceipt(command, input, persisted.state);
  const controls = deriveLifecycleControls(input, normalized.settings, commandReceipt, persisted.state, nowMs);
  const candidateLinks = normalizeJobThreads(input, nowMs, normalized.settings, workspaceScope);
  const boundary = deriveBoundary({
    command: commandReceipt.effectiveCommand,
    workspaceScope,
    principal,
    links: candidateLinks
  });
  const proofLedger = normalizeLinkProofLedger(input, boundary.scopedLinks, workspaceScope, nowMs);
  const links = proofLedger.links;
  const baseLifecycle = deriveLifecycleState({
    command: commandReceipt.effectiveCommand,
    settings: normalized.settings,
    links
  });
  const lifecycle = applyBoundaryReadiness(
    applyProviderReadiness(applyLifecycleControlsReadiness(baseLifecycle, controls), providerContract),
    boundary
  );
  const failureSignals = normalizeFailureSignals(input, now);
  const health = deriveHealth({
    lifecycle,
    boundary,
    providerContract,
    links,
    settings: normalized.settings,
    controls,
    healthPolicy: normalizedHealthPolicy.policy,
    failureSignals,
    persistedState: persisted.state,
    nowMs
  });
  const baseSchedule = deriveSchedule(
    input.schedule || {},
    nowMs,
    commandReceipt.effectiveCommand,
    lifecycle,
    normalized.settings,
    controls
  );
  const schedule = applyHealthSchedule(baseSchedule, health);
  const sync = deriveSyncMetadata(input.sync || {}, now, links, providerContract);
  const recovery = deriveRecovery({
    persistedState: persisted.state,
    commandReceipt,
    controls,
    lifecycle,
    schedule,
    sync,
    links
  });
  const externalHandoff = deriveExternalHandoff(providerContract, lifecycle, links, sync, workspaceScope, boundary, health);
  const analytics = deriveAnalyticsReporting({
    input,
    command,
    commandReceipt,
    controls,
    lifecycle,
    schedule,
    links,
    providerContract,
    sync,
    recovery,
    externalHandoff,
    workspaceScope,
    boundary,
    health,
    persistedState: persisted.state,
    now
  });
  const warnings = [
    ...normalized.warnings,
    ...normalizedHealthPolicy.warnings,
    ...controls.warnings,
    ...persisted.warnings,
    ...providerState.warnings,
    ...proofLedger.warnings
  ];
  const nextAction = deriveNextAction(command, lifecycle, schedule, links, externalHandoff, health, controls);
  const validationSummary = deriveValidationSummary({
    lifecycle,
    schedule,
    providerContract,
    sync,
    proofLedger,
    boundary,
    health,
    links,
    warnings
  });
  const commandState = deriveLifecycleCommandState({
    commandReceipt,
    settings: normalized.settings,
    controls,
    lifecycle,
    schedule,
    health,
    validationSummary,
    clientRuntime
  });
  const nextStep = deriveNextStepContract({
    nextAction,
    commandState,
    lifecycle,
    schedule,
    health,
    externalHandoff,
    providerContract,
    sync,
    workspaceScope,
    validationSummary,
    clientRuntime
  });
  const previewAcceptance = derivePreviewAcceptance({
    input,
    commandReceipt,
    lifecycle,
    schedule,
    health,
    boundary,
    validationSummary,
    nextStep,
    sync,
    links,
    workspaceScope,
    principal,
    now
  });
  const persistedState = shapePersistedState({
    persistedState: persisted.state,
    commandReceipt,
    controls,
    commandState,
    lifecycle,
    schedule,
    sync,
    links,
    recovery,
    workspaceScope,
    boundary,
    health,
    providerContract,
    analytics,
    clientRuntime,
    validationSummary,
    previewAcceptance,
    nextStep,
    proofLedger,
    now
  });
  const clientWorkflowHandoff = deriveClientWorkflowHandoff({
    clientRuntime,
    nextStep,
    externalHandoff,
    previewAcceptance,
    validationSummary,
    health,
    schedule,
    sync,
    now
  });
  const audit = buildAudit({
    command,
    commandReceipt,
    controls,
    commandState,
    lifecycle,
    schedule,
    links,
    providerContract,
    sync,
    recovery,
    persistedState,
    externalHandoff,
    proofLedger,
    workspaceScope,
    principal,
    boundary,
    health,
    analytics,
    clientRuntime,
    clientWorkflowHandoff,
    validationSummary,
    previewAcceptance,
    nextStep,
    warnings,
    now
  });

  return {
    ok: warnings.length === 0 && health.status === "healthy" && !externalHandoff.required && !boundary.blockedBy,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: "ai-os-wave1-hosted-kernel-boot-proof",
    contract: "hosted-kernel job-thread-link lifecycle control contract v1",
    command,
    commandReceipt,
    commandState,
    settings: normalized.settings,
    healthPolicy: normalizedHealthPolicy.policy,
    lifecycleControls: controls,
    workspaceScope,
    principal,
    clientRuntime,
    boundary,
    lifecycle,
    health,
    schedule,
    providerContract,
    proofLedger,
    sync,
    recovery,
    analytics,
    clientWorkflowHandoff,
    validationSummary,
    previewAcceptance,
    nextStep,
    persistedState,
    externalHandoff,
    nextAction,
    links,
    audit,
    evidence: Array.isArray(input.evidence) ? [...input.evidence, audit] : [audit]
  };
}

export default describeJobThreadLinkSurface;
