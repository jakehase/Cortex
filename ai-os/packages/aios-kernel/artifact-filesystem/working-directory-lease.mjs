export const surfaceId = "aios_artifact-filesystem_working-directory-lease_036";
export const surfaceGroup = "artifact-filesystem";
export const surfaceName = "working-directory-lease";

const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_RENEWAL_MARGIN_MS = 2 * 60 * 1000;
const DEFAULT_MAX_RETRY_ATTEMPTS = 5;
const DEFAULT_BASE_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 30 * 1000;
const DEFAULT_MIN_LEASE_TTL_MS = 60 * 1000;
const DEFAULT_MAX_LEASE_TTL_MS = 60 * 60 * 1000;
const ANALYTICS_EXPORT_FORMATS = new Set(["json", "jsonl", "csv"]);
const ANALYTICS_EXPORT_DESTINATION_SCHEMES = new Set(["memory", "file", "s3", "https", "webhook"]);

const TERMINAL_FAILURE_CODES = new Set([
  "LEASE_CONFLICT",
  "WORKDIR_OUTSIDE_ROOT",
  "LEASE_OWNER_MISMATCH",
  "ARTIFACT_ROOT_MISSING"
]);

const LIFECYCLE_CONTROL_COMMANDS = new Set([
  "acquire",
  "write",
  "renew",
  "release",
  "enable-lifecycle",
  "disable-lifecycle",
  "enable-writes",
  "disable-writes",
  "enable-renewals",
  "disable-renewals",
  "enable-release",
  "disable-release",
  "enable-scheduler",
  "disable-scheduler",
  "enable-auto-renew",
  "disable-auto-renew",
  "enable-auto-release-expired",
  "disable-auto-release-expired"
]);

const LIFECYCLE_COMMAND_ALIASES = new Map([
  ["enable", "enable-lifecycle"],
  ["disable", "disable-lifecycle"],
  ["pause", "disable-lifecycle"],
  ["resume", "enable-lifecycle"],
  ["pause-writes", "disable-writes"],
  ["resume-writes", "enable-writes"],
  ["enable-renewal", "enable-renewals"],
  ["disable-renewal", "disable-renewals"],
  ["enable-releases", "enable-release"],
  ["disable-releases", "disable-release"],
  ["schedule-renewal", "enable-auto-renew"],
  ["unschedule-renewal", "disable-auto-renew"]
]);

const TENANT_OPERATION_GRANTS = {
  inspect: "read",
  read: "read",
  mount: "write",
  "mount-artifact-filesystem": "write",
  write: "write",
  "lease-handoff": "handoff",
  handoff: "handoff",
  "publish-sync-checkpoint": "handoff",
  "register-sync-checkpoint": "handoff",
  renew: "renew",
  release: "release"
};

function asTimestamp(value, fallback) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function asNonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function asBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

function analyzeLeasePath(value) {
  const raw = asString(value);
  if (!raw) {
    return {
      raw: null,
      normalized: null,
      absolute: false,
      containsParentTraversal: false,
      escapedAboveRoot: false,
      segmentCount: 0
    };
  }

  const slashNormalized = raw.replace(/\\/g, "/").replace(/\/+/g, "/");
  const absolute = slashNormalized.startsWith("/");
  const segments = [];
  let containsParentTraversal = false;
  let escapedAboveRoot = false;

  for (const segment of slashNormalized.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      containsParentTraversal = true;
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else if (absolute) {
        escapedAboveRoot = true;
      } else {
        segments.push("..");
        escapedAboveRoot = true;
      }
      continue;
    }
    segments.push(segment);
  }

  const normalized = absolute
    ? `/${segments.join("/")}`.replace(/\/$/, "") || "/"
    : segments.join("/") || ".";

  return {
    raw,
    normalized,
    absolute,
    containsParentTraversal,
    escapedAboveRoot,
    segmentCount: segments.filter((segment) => segment !== "..").length
  };
}

function normalizeLifecycleCommand(value) {
  const command = asString(value)?.toLowerCase().replace(/_/g, "-");
  return command ? LIFECYCLE_COMMAND_ALIASES.get(command) || command : null;
}

function normalizeOperationName(value) {
  return asString(value)?.toLowerCase().replace(/_/g, "-") || null;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value)));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeLeasePath(value) {
  return analyzeLeasePath(value).normalized;
}

function isContainedPath(childPath, rootPath) {
  const child = normalizeLeasePath(childPath);
  const root = normalizeLeasePath(rootPath);
  if (!child || !root) {
    return false;
  }
  if (root === "/") {
    return child.startsWith("/");
  }
  return child === root || child.startsWith(`${root}/`);
}

function buildLeasePathSafety({ leaseInput, lease }) {
  const workdir = analyzeLeasePath(leaseInput.workdir);
  const artifactRoot = analyzeLeasePath(leaseInput.artifactRoot);
  const containmentProven = Boolean(lease.workdir && lease.artifactRoot)
    && isContainedPath(lease.workdir, lease.artifactRoot);
  const canonicalized = Boolean(
    (workdir.raw && workdir.normalized && workdir.raw !== workdir.normalized)
      || (artifactRoot.raw && artifactRoot.normalized && artifactRoot.raw !== artifactRoot.normalized)
  );

  return {
    format: "working-directory-lease.path-safety.v1",
    canonicalized,
    containmentProven,
    workdir: {
      raw: workdir.raw,
      normalized: workdir.normalized,
      absolute: workdir.absolute,
      containsParentTraversal: workdir.containsParentTraversal,
      escapedAboveRoot: workdir.escapedAboveRoot,
      segmentCount: workdir.segmentCount
    },
    artifactRoot: {
      raw: artifactRoot.raw,
      normalized: artifactRoot.normalized,
      absolute: artifactRoot.absolute,
      containsParentTraversal: artifactRoot.containsParentTraversal,
      escapedAboveRoot: artifactRoot.escapedAboveRoot,
      segmentCount: artifactRoot.segmentCount
    }
  };
}

function normalizeLifecycleSettings(rawSettings, input) {
  const settingsInput = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  const controlInput = input.controls && typeof input.controls === "object" ? input.controls : {};
  const schedulerInput = input.scheduler && typeof input.scheduler === "object" ? input.scheduler : {};

  return {
    enabled: asBoolean(settingsInput.enabled ?? controlInput.enabled, true),
    writesEnabled: asBoolean(settingsInput.writesEnabled ?? controlInput.writesEnabled, true),
    renewalsEnabled: asBoolean(settingsInput.renewalsEnabled ?? controlInput.renewalsEnabled, true),
    releaseEnabled: asBoolean(settingsInput.releaseEnabled ?? controlInput.releaseEnabled, true),
    schedulerEnabled: asBoolean(settingsInput.schedulerEnabled ?? schedulerInput.enabled, true),
    autoRenewEnabled: asBoolean(settingsInput.autoRenewEnabled ?? schedulerInput.autoRenewEnabled, true),
    autoReleaseExpiredEnabled: asBoolean(
      settingsInput.autoReleaseExpiredEnabled ?? schedulerInput.autoReleaseExpiredEnabled,
      false
    ),
    minLeaseTtlMs: asPositiveInteger(settingsInput.minLeaseTtlMs, DEFAULT_MIN_LEASE_TTL_MS),
    maxLeaseTtlMs: asPositiveInteger(settingsInput.maxLeaseTtlMs, DEFAULT_MAX_LEASE_TTL_MS),
    maxRenewalLeadMs: asPositiveInteger(settingsInput.maxRenewalLeadMs, DEFAULT_LEASE_TTL_MS),
    schedulerJitterMs: asNonNegativeInteger(settingsInput.schedulerJitterMs ?? schedulerInput.jitterMs, 0),
    requestedCommand: normalizeLifecycleCommand(input.command || input.lifecycleCommand || settingsInput.requestedCommand)
  };
}

function buildLifecycleSettingsValidation(settings, lease) {
  const errors = [];
  const warnings = [];

  if (settings.minLeaseTtlMs > settings.maxLeaseTtlMs) {
    errors.push({
      code: "LEASE_TTL_RANGE_INVALID",
      field: "lifecycleSettings.minLeaseTtlMs",
      message: "minLeaseTtlMs must be less than or equal to maxLeaseTtlMs."
    });
  }
  if (lease.ttlMs < settings.minLeaseTtlMs) {
    errors.push({
      code: "LEASE_TTL_BELOW_MINIMUM",
      field: "lease.ttlMs",
      message: "The lease ttlMs is below the hosted-kernel lifecycle minimum."
    });
  }
  if (lease.ttlMs > settings.maxLeaseTtlMs) {
    errors.push({
      code: "LEASE_TTL_ABOVE_MAXIMUM",
      field: "lease.ttlMs",
      message: "The lease ttlMs exceeds the hosted-kernel lifecycle maximum."
    });
  }
  if (!settings.enabled && settings.writesEnabled) {
    errors.push({
      code: "LEASE_DISABLED_WITH_WRITES_ENABLED",
      field: "lifecycleSettings.writesEnabled",
      message: "writesEnabled must be false when the working-directory lease lifecycle is disabled."
    });
  }
  if (settings.autoRenewEnabled && !settings.renewalsEnabled) {
    errors.push({
      code: "AUTO_RENEW_REQUIRES_RENEWALS",
      field: "lifecycleSettings.autoRenewEnabled",
      message: "autoRenewEnabled requires renewalsEnabled so scheduled renewal can execute."
    });
  }
  if (!settings.schedulerEnabled && settings.autoRenewEnabled) {
    warnings.push({
      code: "AUTO_RENEW_SCHEDULER_DISABLED",
      field: "lifecycleSettings.schedulerEnabled",
      message: "autoRenewEnabled is set, but schedulerEnabled is false; renewal must be invoked manually."
    });
  }
  if (settings.schedulerJitterMs > settings.maxRenewalLeadMs) {
    warnings.push({
      code: "SCHEDULER_JITTER_EXCEEDS_RENEWAL_LEAD",
      field: "lifecycleSettings.schedulerJitterMs",
      message: "schedulerJitterMs is greater than maxRenewalLeadMs and may schedule renewal too late."
    });
  }
  if (settings.requestedCommand && !LIFECYCLE_CONTROL_COMMANDS.has(settings.requestedCommand)) {
    errors.push({
      code: "LIFECYCLE_COMMAND_UNKNOWN",
      field: "lifecycleSettings.requestedCommand",
      message: "requestedCommand must be a supported working-directory lease lifecycle control command."
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function buildValidation(input, lease, pathSafety) {
  const errors = [];
  const warnings = [];

  if (!lease.leaseId) {
    errors.push({
      code: "LEASE_ID_REQUIRED",
      field: "lease.leaseId",
      message: "A hosted-kernel working-directory lease requires a stable leaseId."
    });
  }
  if (!lease.ownerId) {
    errors.push({
      code: "OWNER_ID_REQUIRED",
      field: "lease.ownerId",
      message: "A lease ownerId is required so renewals and releases can be attributed."
    });
  }
  if (!lease.workdir) {
    errors.push({
      code: "WORKDIR_REQUIRED",
      field: "lease.workdir",
      message: "The leased working directory path is required."
    });
  }
  if (!lease.artifactRoot) {
    warnings.push({
      code: "ARTIFACT_ROOT_UNSPECIFIED",
      field: "lease.artifactRoot",
      message: "artifactRoot is missing; path containment cannot be proven by this surface."
    });
  }
  if (lease.expiresAtMs <= lease.acquiredAtMs) {
    errors.push({
      code: "LEASE_EXPIRY_INVALID",
      field: "lease.expiresAt",
      message: "expiresAt must be later than acquiredAt for an active working-directory lease."
    });
  }
  if (input.expectedOwnerId && lease.ownerId && input.expectedOwnerId !== lease.ownerId) {
    errors.push({
      code: "LEASE_OWNER_MISMATCH",
      field: "lease.ownerId",
      message: "The lease owner does not match the expected hosted-kernel owner."
    });
  }
  if (lease.artifactRoot && lease.workdir && !isContainedPath(lease.workdir, lease.artifactRoot)) {
    errors.push({
      code: "WORKDIR_OUTSIDE_ROOT",
      field: "lease.workdir",
      message: "The leased working directory must be contained by artifactRoot."
    });
  }
  if (pathSafety?.workdir?.escapedAboveRoot) {
    errors.push({
      code: "WORKDIR_PATH_TRAVERSAL_ESCAPES_ROOT",
      field: "lease.workdir",
      message: "The leased working directory path must not traverse above its lexical root."
    });
  }
  if (pathSafety?.artifactRoot?.escapedAboveRoot) {
    errors.push({
      code: "ARTIFACT_ROOT_PATH_TRAVERSAL_ESCAPES_ROOT",
      field: "lease.artifactRoot",
      message: "The artifactRoot path must not traverse above its lexical root."
    });
  }
  if (pathSafety?.workdir?.containsParentTraversal || pathSafety?.artifactRoot?.containsParentTraversal) {
    warnings.push({
      code: "LEASE_PATH_PARENT_SEGMENTS_CANONICALIZED",
      field: "lease.workdir",
      message: "Lease paths containing parent traversal segments were canonicalized before containment decisions were evaluated."
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function buildRetryPolicy({ failureCode, attempt, nowMs, retryAfterMs }) {
  if (!failureCode) {
    return {
      retryable: false,
      attempt,
      nextAttemptAt: null,
      backoffMs: 0,
      reason: "No active failure was reported."
    };
  }

  if (TERMINAL_FAILURE_CODES.has(failureCode)) {
    return {
      retryable: false,
      attempt,
      nextAttemptAt: null,
      backoffMs: 0,
      reason: `${failureCode} requires operator or caller action before retry.`
    };
  }

  if (attempt >= DEFAULT_MAX_RETRY_ATTEMPTS) {
    return {
      retryable: false,
      attempt,
      nextAttemptAt: null,
      backoffMs: 0,
      reason: "Retry budget exhausted for working-directory lease recovery."
    };
  }

  const computedBackoffMs = Math.min(
    DEFAULT_MAX_BACKOFF_MS,
    DEFAULT_BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1)
  );
  const backoffMs = Math.max(computedBackoffMs, asPositiveInteger(retryAfterMs, 0));

  return {
    retryable: true,
    attempt,
    nextAttemptAt: new Date(nowMs + backoffMs).toISOString(),
    backoffMs,
    reason: "Transient lease failure can be retried with exponential backoff."
  };
}

function buildActionableErrors(validationErrors, failureCode, degradedMode) {
  const actions = validationErrors.map((error) => ({
    code: error.code,
    severity: TERMINAL_FAILURE_CODES.has(error.code) ? "critical" : "error",
    action: error.code === "WORKDIR_OUTSIDE_ROOT"
      ? "Allocate a new working directory under artifactRoot before mounting artifacts."
      : "Correct the lease input contract and request a fresh hosted-kernel lease."
  }));

  if (failureCode && !validationErrors.some((error) => error.code === failureCode)) {
    actions.push({
      code: failureCode,
      severity: TERMINAL_FAILURE_CODES.has(failureCode) ? "critical" : "warning",
      action: TERMINAL_FAILURE_CODES.has(failureCode)
        ? "Do not retry automatically; release conflicting state or request operator recovery."
        : "Retry using the emitted retryPolicy.nextAttemptAt schedule."
    });
  }

  if (degradedMode.enabled) {
    actions.push({
      code: degradedMode.reason,
      severity: "warning",
      action: degradedMode.action
    });
  }

  return actions;
}

function buildLifecycleCommands({ settings, validationOk, expired, renewalRequired, failureState }) {
  const disabledReason = !settings.enabled ? "LIFECYCLE_DISABLED" : null;
  const canWrite = settings.enabled && settings.writesEnabled && validationOk && !expired && !failureState.terminal;
  const canRenew = settings.enabled && settings.renewalsEnabled && validationOk && !failureState.terminal;
  const canRelease = settings.releaseEnabled && Boolean(failureState.code || expired || settings.enabled);

  return {
    acquire: {
      enabled: settings.enabled && validationOk && !failureState.terminal,
      reason: failureState.terminal ? "TERMINAL_FAILURE" : disabledReason
    },
    write: {
      enabled: canWrite,
      reason: canWrite ? null : expired ? "LEASE_EXPIRED" : disabledReason || failureState.code || "WRITES_DISABLED"
    },
    renew: {
      enabled: canRenew && (renewalRequired || expired),
      reason: !canRenew ? disabledReason || failureState.code || "RENEWALS_DISABLED" : renewalRequired || expired ? null : "RENEWAL_NOT_DUE"
    },
    release: {
      enabled: canRelease,
      reason: canRelease ? null : "RELEASE_DISABLED"
    },
    disableWrites: {
      enabled: settings.enabled && settings.writesEnabled,
      reason: settings.enabled && settings.writesEnabled ? null : "WRITES_ALREADY_DISABLED"
    },
    enableWrites: {
      enabled: settings.enabled && !settings.writesEnabled && validationOk && !expired && !failureState.terminal,
      reason: settings.enabled ? null : "LIFECYCLE_DISABLED"
    }
  };
}

function buildLifecycleState({ lease, settings, health, failureState, retryPolicy, nowMs, renewalMarginMs }) {
  const renewalWindowOpensAtMs = lease.expiresAtMs - renewalMarginMs;
  const leadMs = Math.min(settings.maxRenewalLeadMs, Math.max(0, lease.expiresAtMs - nowMs));
  const scheduledRenewalAtMs = Math.max(nowMs, lease.expiresAtMs - leadMs + settings.schedulerJitterMs);
  const scheduleEnabled = settings.enabled && settings.schedulerEnabled && settings.autoRenewEnabled;
  const nextCommand = !settings.enabled
    ? "enable-lifecycle"
    : failureState.terminal
      ? "operator-recovery"
      : !settings.writesEnabled
        ? "enable-writes"
        : health.renewalRequired && !settings.renewalsEnabled
          ? "enable-renewals"
          : health.writable
            ? health.renewalRequired ? "renew" : "write"
            : failureState.code === "LEASE_EXPIRED" ? "acquire" : retryPolicy.retryable ? "retry" : "inspect";

  return {
    settings,
    schedule: {
      enabled: scheduleEnabled,
      renewalWindowOpensAt: new Date(renewalWindowOpensAtMs).toISOString(),
      scheduledRenewalAt: scheduleEnabled ? new Date(scheduledRenewalAtMs).toISOString() : null,
      schedulerJitterMs: settings.schedulerJitterMs,
      autoReleaseExpiredEnabled: settings.autoReleaseExpiredEnabled
    },
    nextAction: {
      command: nextCommand,
      dueAt: nextCommand === "retry"
        ? retryPolicy.nextAttemptAt
        : nextCommand === "renew"
          ? new Date(Math.max(nowMs, renewalWindowOpensAtMs)).toISOString()
          : null,
      reason: failureState.code || (health.renewalRequired ? "LEASE_RENEWAL_DUE" : "LEASE_READY")
    }
  };
}

function buildLifecycleSettingsPatch(settings, command) {
  const patch = {};
  if (command === "enable-lifecycle") {
    patch.enabled = true;
    patch.writesEnabled = true;
  }
  if (command === "disable-lifecycle") {
    patch.enabled = false;
    patch.writesEnabled = false;
    patch.autoRenewEnabled = false;
  }
  if (command === "enable-writes") patch.writesEnabled = true;
  if (command === "disable-writes") patch.writesEnabled = false;
  if (command === "enable-renewals") patch.renewalsEnabled = true;
  if (command === "disable-renewals") {
    patch.renewalsEnabled = false;
    patch.autoRenewEnabled = false;
  }
  if (command === "enable-release") patch.releaseEnabled = true;
  if (command === "disable-release") patch.releaseEnabled = false;
  if (command === "enable-scheduler") patch.schedulerEnabled = true;
  if (command === "disable-scheduler") {
    patch.schedulerEnabled = false;
    patch.autoRenewEnabled = false;
  }
  if (command === "enable-auto-renew") {
    patch.schedulerEnabled = true;
    patch.renewalsEnabled = true;
    patch.autoRenewEnabled = true;
  }
  if (command === "disable-auto-renew") patch.autoRenewEnabled = false;
  if (command === "enable-auto-release-expired") patch.autoReleaseExpiredEnabled = true;
  if (command === "disable-auto-release-expired") patch.autoReleaseExpiredEnabled = false;

  return Object.keys(patch).length > 0 ? {
    before: {
      enabled: settings.enabled,
      writesEnabled: settings.writesEnabled,
      renewalsEnabled: settings.renewalsEnabled,
      releaseEnabled: settings.releaseEnabled,
      schedulerEnabled: settings.schedulerEnabled,
      autoRenewEnabled: settings.autoRenewEnabled,
      autoReleaseExpiredEnabled: settings.autoReleaseExpiredEnabled
    },
    apply: patch,
    after: { ...settings, ...patch }
  } : null;
}

function buildLifecycleSettingsTransitionPlan({
  settings,
  settingsPatch,
  lease,
  health,
  failureState,
  validation,
  nowMs,
  renewalMarginMs
}) {
  if (!settingsPatch) {
    return null;
  }

  const requestedCommand = settings.requestedCommand;
  const nextSettings = settingsPatch.after;
  const renewalWindowOpensAtMs = lease.expiresAtMs - renewalMarginMs;
  const nextLeadMs = Math.min(nextSettings.maxRenewalLeadMs, Math.max(0, lease.expiresAtMs - nowMs));
  const nextScheduledRenewalAtMs = Math.max(
    nowMs,
    lease.expiresAtMs - nextLeadMs + nextSettings.schedulerJitterMs
  );
  const nextScheduleEnabled = nextSettings.enabled
    && nextSettings.schedulerEnabled
    && nextSettings.autoRenewEnabled;
  const validationBlocked = validation.errors.length > 0;
  const wouldEnableWrites = settingsPatch.apply.writesEnabled === true;
  const wouldEnableRenewals = settingsPatch.apply.renewalsEnabled === true;
  const wouldEnableScheduler = settingsPatch.apply.schedulerEnabled === true;
  const wouldEnableAutoRenew = settingsPatch.apply.autoRenewEnabled === true;
  const wouldDisableRelease = settingsPatch.apply.releaseEnabled === false;
  const wouldDisableRenewals = settingsPatch.apply.renewalsEnabled === false;
  const wouldDisableScheduler = settingsPatch.apply.schedulerEnabled === false;
  const autoRenewInvalid = nextSettings.autoRenewEnabled
    && (!nextSettings.enabled || !nextSettings.renewalsEnabled || !nextSettings.schedulerEnabled);
  const autoRenewTooLate = nextScheduleEnabled && nextScheduledRenewalAtMs >= lease.expiresAtMs;
  const blockers = uniqueStrings([
    wouldEnableWrites && validationBlocked ? "VALIDATION_BLOCKED" : null,
    wouldEnableWrites && health.status === "unhealthy" ? "LEASE_UNHEALTHY" : null,
    wouldEnableWrites && health.msUntilExpiry <= 0 ? "LEASE_EXPIRED" : null,
    wouldEnableWrites && failureState.terminal ? "TERMINAL_FAILURE" : null,
    wouldEnableRenewals && failureState.terminal ? "TERMINAL_FAILURE" : null,
    wouldEnableScheduler && !nextSettings.enabled ? "LIFECYCLE_DISABLED" : null,
    wouldEnableAutoRenew && health.msUntilExpiry <= 0 ? "LEASE_EXPIRED" : null,
    wouldEnableAutoRenew && failureState.terminal ? "TERMINAL_FAILURE" : null,
    autoRenewInvalid ? "AUTO_RENEW_REQUIRES_ENABLED_SCHEDULER_AND_RENEWALS" : null,
    autoRenewTooLate ? "AUTO_RENEW_SCHEDULE_AFTER_EXPIRY" : null
  ]);
  const warnings = uniqueStrings([
    requestedCommand === "disable-lifecycle" && health.writable ? "DISABLING_LIFECYCLE_STOPS_WRITES" : null,
    wouldDisableRenewals && health.renewalRequired ? "DISABLING_RENEWALS_WHILE_RENEWAL_DUE" : null,
    wouldDisableScheduler && settings.autoRenewEnabled ? "DISABLING_SCHEDULER_CANCELS_AUTO_RENEW" : null,
    wouldDisableRelease && (failureState.active || health.msUntilExpiry <= 0) ? "DISABLING_RELEASE_WITH_ACTIVE_FAILURE" : null,
    nextSettings.autoReleaseExpiredEnabled && !nextSettings.releaseEnabled
      ? "AUTO_RELEASE_EXPIRED_WITH_RELEASE_DISABLED"
      : null
  ]);
  const resultingCommands = {
    write: nextSettings.enabled
      && nextSettings.writesEnabled
      && validation.errors.length === 0
      && health.msUntilExpiry > 0
      && !failureState.terminal,
    renew: nextSettings.enabled
      && nextSettings.renewalsEnabled
      && validation.errors.length === 0
      && !failureState.terminal,
    release: nextSettings.releaseEnabled && Boolean(failureState.active || nextSettings.enabled),
    scheduler: nextSettings.enabled && nextSettings.schedulerEnabled,
    autoRenew: nextScheduleEnabled
  };

  return {
    format: "working-directory-lease.lifecycle-settings-transition.v1",
    command: requestedCommand,
    state: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "ready-with-warnings" : "ready",
    ready: blockers.length === 0,
    blockers,
    warnings,
    resultingSettings: {
      enabled: nextSettings.enabled,
      writesEnabled: nextSettings.writesEnabled,
      renewalsEnabled: nextSettings.renewalsEnabled,
      releaseEnabled: nextSettings.releaseEnabled,
      schedulerEnabled: nextSettings.schedulerEnabled,
      autoRenewEnabled: nextSettings.autoRenewEnabled,
      autoReleaseExpiredEnabled: nextSettings.autoReleaseExpiredEnabled
    },
    resultingCommands,
    schedulePreview: {
      enabled: nextScheduleEnabled,
      renewalWindowOpensAt: new Date(renewalWindowOpensAtMs).toISOString(),
      scheduledRenewalAt: nextScheduleEnabled ? new Date(nextScheduledRenewalAtMs).toISOString() : null,
      scheduledBeforeExpiry: nextScheduleEnabled ? nextScheduledRenewalAtMs < lease.expiresAtMs : null,
      msUntilScheduledRenewal: nextScheduleEnabled ? Math.max(0, nextScheduledRenewalAtMs - nowMs) : null,
      msBeforeExpiryAtRenewal: nextScheduleEnabled ? lease.expiresAtMs - nextScheduledRenewalAtMs : null
    },
    proof: {
      validationErrorCount: validation.errors.length,
      failureCode: failureState.code,
      terminalFailure: failureState.terminal,
      msUntilExpiry: health.msUntilExpiry,
      renewalRequired: health.renewalRequired
    }
  };
}

function buildLifecycleCommandControl({
  settings,
  lifecycleCommands,
  health,
  failureState,
  validation,
  retryPolicy,
  lease,
  nowMs,
  renewalMarginMs
}) {
  const requestedCommand = settings.requestedCommand || null;
  const commandState = requestedCommand && lifecycleCommands[requestedCommand]
    ? lifecycleCommands[requestedCommand]
    : null;
  const settingsPatch = buildLifecycleSettingsPatch(settings, requestedCommand);
  const isSettingsCommand = Boolean(settingsPatch);
  const commandKnown = !requestedCommand || LIFECYCLE_CONTROL_COMMANDS.has(requestedCommand);
  const settingsTransition = buildLifecycleSettingsTransitionPlan({
    settings,
    settingsPatch,
    lease,
    health,
    failureState,
    validation,
    nowMs,
    renewalMarginMs
  });
  const blockers = uniqueStrings([
    commandKnown ? null : "LIFECYCLE_COMMAND_UNKNOWN",
    requestedCommand && !isSettingsCommand && !commandState ? "LIFECYCLE_COMMAND_NOT_EXPOSED" : null,
    requestedCommand && commandState && !commandState.enabled ? commandState.reason || "LIFECYCLE_COMMAND_DISABLED" : null,
    requestedCommand === "write" && !health.writable ? "LEASE_NOT_WRITABLE" : null,
    requestedCommand === "renew" && failureState.terminal ? "TERMINAL_FAILURE" : null,
    validation.errors.length > 0 && !isSettingsCommand ? validation.errors[0].code : null,
    ...(settingsTransition?.blockers || [])
  ]);
  const accepted = Boolean(requestedCommand) && blockers.length === 0;
  const nextCommand = accepted
    ? requestedCommand
    : requestedCommand && retryPolicy.retryable
      ? "retry"
      : blockers.includes("LIFECYCLE_COMMAND_UNKNOWN")
        ? "inspect-lifecycle-command"
        : settings.enabled ? "inspect" : "enable-lifecycle";

  return {
    format: "working-directory-lease.lifecycle-command-control.v1",
    requestedCommand,
    known: commandKnown,
    accepted,
    state: !requestedCommand ? "idle" : accepted ? "accepted" : "blocked",
    commandType: !requestedCommand
      ? null
      : isSettingsCommand
        ? "settings-control"
        : ["acquire", "write", "renew", "release"].includes(requestedCommand)
          ? "lease-operation"
          : "unknown",
    blockers,
    executable: {
      acquire: lifecycleCommands.acquire.enabled,
      write: lifecycleCommands.write.enabled,
      renew: lifecycleCommands.renew.enabled,
      release: lifecycleCommands.release.enabled
    },
    controls: {
      canEnableLifecycle: !settings.enabled,
      canDisableLifecycle: settings.enabled,
      canEnableWrites: settings.enabled && !settings.writesEnabled && validation.errors.length === 0,
      canDisableWrites: settings.enabled && settings.writesEnabled,
      canEnableRenewals: settings.enabled && !settings.renewalsEnabled,
      canDisableRenewals: settings.enabled && settings.renewalsEnabled,
      canEnableScheduler: settings.enabled && !settings.schedulerEnabled,
      canDisableScheduler: settings.schedulerEnabled,
      canEnableAutoRenew: settings.enabled && settings.schedulerEnabled && settings.renewalsEnabled && !settings.autoRenewEnabled,
      canDisableAutoRenew: settings.autoRenewEnabled,
      canEnableAutoReleaseExpired: !settings.autoReleaseExpiredEnabled,
      canDisableAutoReleaseExpired: settings.autoReleaseExpiredEnabled
    },
    settingsPatch,
    settingsTransition,
    nextAction: {
      command: nextCommand,
      dueAt: nextCommand === "retry" ? retryPolicy.nextAttemptAt : accepted ? new Date(nowMs).toISOString() : null,
      reason: blockers[0] || (requestedCommand ? "LIFECYCLE_COMMAND_ACCEPTED" : "NO_LIFECYCLE_COMMAND_REQUESTED")
    }
  };
}

function normalizeProviderContract(input, lease) {
  const providerInput = input.provider && typeof input.provider === "object" ? input.provider : {};
  const serviceInput = input.serviceContract && typeof input.serviceContract === "object" ? input.serviceContract : {};
  const syncInput = input.sync && typeof input.sync === "object" ? input.sync : {};

  return {
    providerId: asString(providerInput.providerId || providerInput.id || serviceInput.providerId) || "hosted-kernel",
    serviceId: asString(serviceInput.serviceId || providerInput.serviceId) || "artifact-filesystem",
    protocol: asString(serviceInput.protocol || providerInput.protocol) || "working-directory-lease.v1",
    mountId: asString(serviceInput.mountId || providerInput.mountId || syncInput.mountId),
    correlationId: asString(input.correlationId || serviceInput.correlationId || providerInput.correlationId || lease.leaseId),
    expectedCapabilities: uniqueStrings(asArray(serviceInput.expectedCapabilities || providerInput.expectedCapabilities)),
    offeredCapabilities: uniqueStrings(asArray(providerInput.capabilities || serviceInput.offeredCapabilities)),
    acceptsExternalHandoff: asBoolean(
      serviceInput.acceptsExternalHandoff ?? providerInput.acceptsExternalHandoff,
      true
    ),
    requiresWritableLease: asBoolean(serviceInput.requiresWritableLease, true),
    requiresRenewalAuthority: asBoolean(serviceInput.requiresRenewalAuthority, true),
    syncGeneration: asNonNegativeInteger(syncInput.generation ?? serviceInput.syncGeneration, 0),
    remoteCheckpoint: asString(syncInput.remoteCheckpoint || serviceInput.remoteCheckpoint),
    localCheckpoint: asString(syncInput.localCheckpoint || serviceInput.localCheckpoint)
  };
}

function buildCapabilityNegotiation({ contract, lifecycleCommands, health, failureState }) {
  const leaseCapabilities = uniqueStrings([
    health.writable ? "artifact-write" : null,
    lifecycleCommands.renew.enabled ? "lease-renew" : null,
    lifecycleCommands.release.enabled ? "lease-release" : null,
    failureState.terminal ? null : "lease-health-proof",
    "lease-sync-metadata",
    "external-handoff-state"
  ]);
  const offered = contract.offeredCapabilities.length > 0 ? contract.offeredCapabilities : leaseCapabilities;
  const required = contract.expectedCapabilities.length > 0
    ? contract.expectedCapabilities
    : uniqueStrings([
      contract.requiresWritableLease ? "artifact-write" : null,
      contract.requiresRenewalAuthority ? "lease-renew" : null,
      "lease-health-proof"
    ]);
  const missing = required.filter((capability) => !offered.includes(capability) || !leaseCapabilities.includes(capability));

  return {
    ok: missing.length === 0,
    protocol: contract.protocol,
    providerId: contract.providerId,
    serviceId: contract.serviceId,
    required,
    offered,
    granted: required.filter((capability) => !missing.includes(capability)),
    missing,
    deniedReason: missing.length > 0
      ? `Provider cannot use ${missing.join(", ")} for the current working-directory lease state.`
      : null
  };
}

function buildSyncMetadata({ contract, lease, health, proof, now }) {
  const checkpointParts = uniqueStrings([
    contract.providerId,
    contract.serviceId,
    contract.mountId,
    lease.leaseId,
    lease.ownerId,
    String(contract.syncGeneration)
  ]);
  const checkpoint = contract.localCheckpoint || checkpointParts.join(":");

  return {
    format: "working-directory-lease.sync.v1",
    generatedAt: now,
    mountId: contract.mountId,
    generation: contract.syncGeneration,
    localCheckpoint: checkpoint || null,
    remoteCheckpoint: contract.remoteCheckpoint,
    leaseIdentity: {
      leaseId: lease.leaseId,
      ownerId: lease.ownerId,
      workdir: lease.workdir
    },
    healthDigest: {
      status: health.status,
      writable: health.writable,
      renewalRequired: health.renewalRequired,
      proofTrailLength: proof.auditTrail.length
    },
    requiresUpload: Boolean(checkpoint && contract.remoteCheckpoint && checkpoint !== contract.remoteCheckpoint),
    requiresRemoteRegistration: Boolean(checkpoint && !contract.remoteCheckpoint)
  };
}

function buildExternalHandoffState({ contract, capabilityNegotiation, syncMetadata, lifecycle, health, failureState }) {
  const blockedReason = !contract.acceptsExternalHandoff
    ? "PROVIDER_HANDOFF_DISABLED"
    : !capabilityNegotiation.ok
      ? "CAPABILITY_NEGOTIATION_FAILED"
      : failureState.terminal
        ? "TERMINAL_LEASE_FAILURE"
        : !health.writable && contract.requiresWritableLease
          ? "WRITABLE_LEASE_REQUIRED"
          : null;

  return {
    enabled: !blockedReason,
    state: blockedReason ? "blocked" : syncMetadata.requiresUpload || syncMetadata.requiresRemoteRegistration ? "pending-sync" : "ready",
    blockedReason,
    destination: {
      providerId: contract.providerId,
      serviceId: contract.serviceId,
      protocol: contract.protocol,
      correlationId: contract.correlationId
    },
    requiredNextCommand: blockedReason
      ? lifecycle.nextAction.command
      : syncMetadata.requiresRemoteRegistration
        ? "register-sync-checkpoint"
        : syncMetadata.requiresUpload
          ? "publish-sync-checkpoint"
          : null,
    transferable: {
      leaseId: health.writable ? syncMetadata.leaseIdentity.leaseId : null,
      mountId: syncMetadata.mountId,
      localCheckpoint: syncMetadata.localCheckpoint,
      generation: syncMetadata.generation
    }
  };
}

function normalizeProviderOperationRequest(input, contract) {
  const operationInput = input.providerOperation && typeof input.providerOperation === "object"
    ? input.providerOperation
    : input.serviceOperation && typeof input.serviceOperation === "object"
      ? input.serviceOperation
      : {};
  const requestInput = input.request && typeof input.request === "object" ? input.request : {};
  const requestedOperation = asString(
    operationInput.operation || operationInput.command || requestInput.providerOperation || requestInput.operation
  ) || "mount";

  return {
    format: "working-directory-lease.provider-operation-request.v1",
    operation: normalizeOperationName(requestedOperation) || "mount",
    requestId: asString(operationInput.requestId || requestInput.id || input.requestId || contract.correlationId),
    idempotencyKey: asString(operationInput.idempotencyKey || operationInput.replayKey || input.idempotencyKey),
    requiresSync: asBoolean(operationInput.requiresSync, true),
    requiresReadyHandoff: asBoolean(operationInput.requiresReadyHandoff, requestedOperation !== "inspect"),
    allowReadOnlyMount: asBoolean(operationInput.allowReadOnlyMount, false),
    requestedMountMode: asString(operationInput.mountMode || operationInput.mode) || "writable",
    requestedCapabilities: uniqueStrings(asArray(operationInput.capabilities || operationInput.requestedCapabilities))
  };
}

function buildProviderServiceAdmission({
  providerOperation,
  contract,
  capabilityNegotiation,
  syncMetadata,
  externalHandoff,
  lifecycle,
  lifecycleCommandControl,
  health,
  failureState,
  tenantAccess,
  operationalIncident
}) {
  const operationCapabilityMap = {
    inspect: "lease-health-proof",
    mount: "artifact-write",
    write: "artifact-write",
    renew: "lease-renew",
    release: "lease-release",
    handoff: "external-handoff-state",
    "publish-sync-checkpoint": "lease-sync-metadata",
    "register-sync-checkpoint": "lease-sync-metadata"
  };
  const operation = providerOperation.operation;
  const tenantOperation = operation === "mount" ? "mount-artifact-filesystem" : operation;
  const tenantDecision = tenantAccess?.permissionMatrix?.decisions?.find((decision) => decision.operation === tenantOperation)
    || tenantAccess?.permissionMatrix?.decisions?.find((decision) => decision.grant === (TENANT_OPERATION_GRANTS[tenantOperation] || "read"))
    || null;
  const requiredForOperation = uniqueStrings([
    operationCapabilityMap[operation] || null,
    ...providerOperation.requestedCapabilities
  ]);
  const missingOperationCapabilities = requiredForOperation.filter(
    (capability) => !capabilityNegotiation.granted.includes(capability)
  );
  const syncBlocked = providerOperation.requiresSync
    && (syncMetadata.requiresRemoteRegistration || syncMetadata.requiresUpload);
  const readOnlyAllowed = providerOperation.allowReadOnlyMount && operation === "mount";
  const incidentBlocksAdmission = operationalIncident?.circuitBreaker?.blockProviderAdmission
    && operation !== "inspect";
  const incidentBlocksWrites = operationalIncident?.circuitBreaker?.blockWrites
    && ["mount", "write"].includes(operation)
    && !readOnlyAllowed;
  const writeBlocked = ["mount", "write"].includes(operation) && !health.writable && !readOnlyAllowed;
  const handoffBlocked = providerOperation.requiresReadyHandoff
    && !(externalHandoff.enabled && externalHandoff.state === "ready");
  const blockers = uniqueStrings([
    failureState.terminal ? "TERMINAL_LEASE_FAILURE" : null,
    incidentBlocksAdmission ? "OPERATIONAL_INCIDENT_BLOCKS_PROVIDER_ADMISSION" : null,
    incidentBlocksWrites ? "OPERATIONAL_INCIDENT_BLOCKS_WRITES" : null,
    capabilityNegotiation.ok ? null : "CAPABILITY_NEGOTIATION_FAILED",
    missingOperationCapabilities.length > 0 ? "PROVIDER_OPERATION_CAPABILITY_MISSING" : null,
    syncBlocked ? "SYNC_CHECKPOINT_NOT_CURRENT" : null,
    handoffBlocked ? "EXTERNAL_HANDOFF_NOT_READY" : null,
    writeBlocked ? "WRITABLE_LEASE_REQUIRED" : null,
    tenantAccess && tenantAccess.state === "blocked" ? "TENANT_BOUNDARY_INVALID" : null,
    tenantDecision && !tenantDecision.allowed ? "TENANT_OPERATION_PERMISSION_DENIED" : null,
    operation === "renew" && !lifecycle.commands.renew.enabled ? lifecycle.commands.renew.reason || "RENEW_DISABLED" : null,
    operation === "release" && !lifecycle.commands.release.enabled ? lifecycle.commands.release.reason || "RELEASE_DISABLED" : null,
    lifecycleCommandControl.requestedCommand && !lifecycleCommandControl.accepted
      ? "REQUESTED_LIFECYCLE_COMMAND_BLOCKED"
      : null
  ]);
  const state = blockers.length > 0
    ? "blocked"
    : syncMetadata.requiresRemoteRegistration || syncMetadata.requiresUpload
      ? "awaiting-sync"
      : health.writable || readOnlyAllowed || operation === "inspect"
        ? "admitted"
        : "read-only";
  const nextCommand = blockers.includes("SYNC_CHECKPOINT_NOT_CURRENT")
    ? syncMetadata.requiresRemoteRegistration ? "register-sync-checkpoint" : "publish-sync-checkpoint"
    : blockers.includes("EXTERNAL_HANDOFF_NOT_READY")
      ? externalHandoff.requiredNextCommand || lifecycle.nextAction.command
      : blockers.includes("WRITABLE_LEASE_REQUIRED") && lifecycle.commands.renew.enabled
        ? "renew"
        : blockers.length > 0
          ? lifecycle.nextAction.command
          : operation === "mount"
            ? "mount-artifact-filesystem"
            : operation;

  return {
    format: "working-directory-lease.provider-service-admission.v1",
    state,
    admitted: state === "admitted" || state === "read-only",
    providerId: contract.providerId,
    serviceId: contract.serviceId,
    protocol: contract.protocol,
    request: providerOperation,
    mount: {
      mountId: contract.mountId,
      mode: health.writable ? "writable" : readOnlyAllowed ? "read-only" : "blocked",
      leaseId: state === "admitted" || state === "read-only" ? syncMetadata.leaseIdentity.leaseId : null,
      checkpoint: syncMetadata.localCheckpoint,
      generation: syncMetadata.generation
    },
    blockers,
    capabilityProof: {
      requiredForOperation,
      missingForOperation: missingOperationCapabilities,
      granted: capabilityNegotiation.granted,
      negotiationOk: capabilityNegotiation.ok
    },
    tenantProof: tenantAccess ? {
      state: tenantAccess.state,
      operation: tenantOperation,
      decision: tenantDecision?.state || "not-requested",
      blockers: tenantDecision?.blockers || [],
      missingRoles: tenantDecision?.missingRoles || [],
      deniedOperations: tenantAccess.deniedOperations
    } : null,
    syncProof: {
      current: !syncMetadata.requiresRemoteRegistration && !syncMetadata.requiresUpload,
      requiresRemoteRegistration: syncMetadata.requiresRemoteRegistration,
      requiresUpload: syncMetadata.requiresUpload,
      localCheckpoint: syncMetadata.localCheckpoint,
      remoteCheckpoint: syncMetadata.remoteCheckpoint
    },
    operationalIncidentProof: operationalIncident ? {
      state: operationalIncident.state,
      severity: operationalIncident.severity,
      incidentId: operationalIncident.incidentId,
      active: operationalIncident.active,
      blockedCommands: operationalIncident.circuitBreaker.blockedCommands,
      runbook: operationalIncident.runbook
    } : null,
    nextCommand,
    handoffState: externalHandoff.state
  };
}

function normalizeProviderHandoffAcknowledgement(input, providerOperation, syncMetadata) {
  const acknowledgementInput = input.providerAcknowledgement && typeof input.providerAcknowledgement === "object"
    ? input.providerAcknowledgement
    : input.handoffAcknowledgement && typeof input.handoffAcknowledgement === "object"
      ? input.handoffAcknowledgement
      : input.providerAck && typeof input.providerAck === "object"
        ? input.providerAck
        : {};
  const acceptedAtMs = asTimestamp(
    acknowledgementInput.acceptedAt || acknowledgementInput.acknowledgedAt || acknowledgementInput.committedAt,
    null
  );
  const acknowledgedCheckpoint = asString(
    acknowledgementInput.localCheckpoint || acknowledgementInput.checkpoint || acknowledgementInput.acknowledgedCheckpoint
  );
  const acknowledgedGeneration = asNonNegativeInteger(
    acknowledgementInput.generation ?? acknowledgementInput.syncGeneration,
    null
  );

  return {
    format: "working-directory-lease.provider-handoff-acknowledgement-request.v1",
    state: asString(acknowledgementInput.state || acknowledgementInput.status) || "pending",
    accepted: asBoolean(acknowledgementInput.accepted ?? acknowledgementInput.acknowledged, false),
    acceptedBy: asString(acknowledgementInput.acceptedBy || acknowledgementInput.acknowledgedBy),
    acceptedAtMs,
    acceptedAt: acceptedAtMs ? new Date(acceptedAtMs).toISOString() : null,
    requestId: asString(acknowledgementInput.requestId || providerOperation.requestId),
    idempotencyKey: asString(acknowledgementInput.idempotencyKey || providerOperation.idempotencyKey),
    mountId: asString(acknowledgementInput.mountId || syncMetadata.mountId),
    localCheckpoint: acknowledgedCheckpoint,
    generation: acknowledgedGeneration,
    requireSyncCurrent: asBoolean(acknowledgementInput.requireSyncCurrent, true),
    requireProviderAdmission: asBoolean(acknowledgementInput.requireProviderAdmission, true),
    commitMode: asString(acknowledgementInput.commitMode || acknowledgementInput.mode) || "claim-external-handoff",
    resultRef: asString(acknowledgementInput.resultRef || acknowledgementInput.receiptRef)
  };
}

function buildProviderHandoffCommitContract({
  acknowledgement,
  contract,
  providerOperation,
  providerServiceAdmission,
  externalHandoff,
  syncMetadata,
  recovery,
  health,
  nowMs,
  now
}) {
  const syncCurrent = !syncMetadata.requiresRemoteRegistration && !syncMetadata.requiresUpload;
  const checkpointMatches = !acknowledgement.localCheckpoint
    || acknowledgement.localCheckpoint === syncMetadata.localCheckpoint;
  const generationMatches = acknowledgement.generation === null
    || acknowledgement.generation === syncMetadata.generation;
  const replayed = Boolean(
    acknowledgement.idempotencyKey
      && recovery.idempotency.replayKey
      && acknowledgement.idempotencyKey === recovery.idempotency.replayKey
      && recovery.idempotency.alreadyApplied
  );
  const blockers = uniqueStrings([
    acknowledgement.requireProviderAdmission && !providerServiceAdmission.admitted
      ? "PROVIDER_SERVICE_NOT_ADMITTED"
      : null,
    externalHandoff.enabled ? null : externalHandoff.blockedReason || "EXTERNAL_HANDOFF_BLOCKED",
    externalHandoff.state === "ready" ? null : "EXTERNAL_HANDOFF_NOT_READY",
    acknowledgement.requireSyncCurrent && !syncCurrent ? "SYNC_CHECKPOINT_NOT_CURRENT" : null,
    checkpointMatches ? null : "HANDOFF_CHECKPOINT_MISMATCH",
    generationMatches ? null : "HANDOFF_GENERATION_MISMATCH",
    acknowledgement.accepted && !acknowledgement.acceptedBy ? "HANDOFF_ACK_ACTOR_REQUIRED" : null,
    acknowledgement.acceptedAtMs && acknowledgement.acceptedAtMs > nowMs ? "HANDOFF_ACK_IN_FUTURE" : null,
    health.writable ? null : "LEASE_NOT_WRITABLE_FOR_HANDOFF_COMMIT"
  ]);
  const ready = blockers.length === 0 && acknowledgement.accepted;
  const command = ready
    ? "commit-provider-handoff"
    : blockers.includes("SYNC_CHECKPOINT_NOT_CURRENT")
      ? syncMetadata.requiresRemoteRegistration ? "register-sync-checkpoint" : "publish-sync-checkpoint"
      : providerServiceAdmission.nextCommand || externalHandoff.requiredNextCommand || "await-provider-handoff-ack";
  const commitKey = uniqueStrings([
    contract.providerId,
    providerOperation.requestId,
    acknowledgement.mountId,
    syncMetadata.localCheckpoint,
    String(syncMetadata.generation)
  ]).join(":") || null;

  return {
    format: "working-directory-lease.provider-handoff-commit.v1",
    state: ready ? "committed" : replayed ? "idempotent-replay" : blockers.length > 0 ? "blocked" : "awaiting-acknowledgement",
    ready,
    replayed,
    providerId: contract.providerId,
    serviceId: contract.serviceId,
    protocol: contract.protocol,
    request: acknowledgement,
    commit: {
      command,
      mode: acknowledgement.commitMode,
      idempotencyKey: acknowledgement.idempotencyKey || commitKey,
      resultRef: ready ? acknowledgement.resultRef : null,
      committedAt: ready ? acknowledgement.acceptedAt || now : null,
      committedBy: ready ? acknowledgement.acceptedBy : null
    },
    externalStatePatch: ready ? {
      format: "working-directory-lease.external-handoff-state.v1",
      providerId: contract.providerId,
      serviceId: contract.serviceId,
      mountId: acknowledgement.mountId,
      leaseId: syncMetadata.leaseIdentity.leaseId,
      checkpoint: syncMetadata.localCheckpoint,
      generation: syncMetadata.generation,
      state: "claimed",
      claimedAt: acknowledgement.acceptedAt || now,
      claimedBy: acknowledgement.acceptedBy
    } : null,
    blockers,
    syncProof: {
      current: syncCurrent,
      checkpointMatches,
      generationMatches,
      expectedCheckpoint: syncMetadata.localCheckpoint,
      acknowledgedCheckpoint: acknowledgement.localCheckpoint,
      expectedGeneration: syncMetadata.generation,
      acknowledgedGeneration: acknowledgement.generation
    },
    admissionProof: {
      providerAdmissionState: providerServiceAdmission.state,
      providerAdmitted: providerServiceAdmission.admitted,
      externalHandoffState: externalHandoff.state,
      providerOperation: providerOperation.operation,
      healthStatus: health.status
    }
  };
}

function normalizeHistorySnapshots(input, currentSnapshot, nowMs) {
  const snapshots = asArray(input.history || input.snapshots)
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const observedAtMs = asTimestamp(entry.observedAt || entry.generatedAt || entry.checkedAt, null);
      const status = asString(entry.status || entry.health?.status);
      const failureCode = asString(entry.failureCode || entry.failureState?.code);

      return {
        sequence: Number.isInteger(entry.sequence) ? entry.sequence : index + 1,
        observedAt: new Date(observedAtMs || nowMs).toISOString(),
        observedAtMs: observedAtMs || nowMs,
        status: status || "unknown",
        writable: Boolean(entry.writable ?? entry.health?.writable),
        failureCode,
        renewalRequired: Boolean(entry.renewalRequired ?? entry.health?.renewalRequired),
        degraded: Boolean(entry.degraded ?? entry.degradedMode?.enabled),
        leaseId: asString(entry.leaseId || entry.lease?.leaseId),
        ownerId: asString(entry.ownerId || entry.lease?.ownerId)
      };
    })
    .filter(Boolean);

  snapshots.push({
    ...currentSnapshot,
    sequence: snapshots.length + 1
  });

  return snapshots.sort((left, right) => left.observedAtMs - right.observedAtMs);
}

function buildAnalyticsCounters(snapshots, validation, retryPolicy, degradedMode) {
  const counters = {
    observations: snapshots.length,
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    unknown: 0,
    writable: 0,
    readOnly: 0,
    renewalRequired: 0,
    failures: 0,
    terminalFailures: 0,
    validationErrors: validation.errors.length,
    validationWarnings: validation.warnings.length,
    retryScheduled: retryPolicy.retryable ? 1 : 0,
    degradedModeEntries: degradedMode.enabled ? 1 : 0,
    leaseIdentityChanges: 0,
    ownerIdentityChanges: 0
  };

  let previous = null;
  for (const snapshot of snapshots) {
    if (snapshot.status === "healthy") counters.healthy += 1;
    else if (snapshot.status === "degraded") counters.degraded += 1;
    else if (snapshot.status === "unhealthy") counters.unhealthy += 1;
    else counters.unknown += 1;

    if (snapshot.writable) counters.writable += 1;
    else counters.readOnly += 1;
    if (snapshot.renewalRequired) counters.renewalRequired += 1;
    if (snapshot.failureCode) {
      counters.failures += 1;
      if (TERMINAL_FAILURE_CODES.has(snapshot.failureCode)) {
        counters.terminalFailures += 1;
      }
    }
    if (previous?.leaseId && snapshot.leaseId && previous.leaseId !== snapshot.leaseId) {
      counters.leaseIdentityChanges += 1;
    }
    if (previous?.ownerId && snapshot.ownerId && previous.ownerId !== snapshot.ownerId) {
      counters.ownerIdentityChanges += 1;
    }
    previous = snapshot;
  }

  return counters;
}

function buildTimeline(snapshots) {
  return snapshots.map((snapshot, index) => {
    const previous = index > 0 ? snapshots[index - 1] : null;
    const changed = previous
      ? uniqueStrings([
        previous.status !== snapshot.status ? "status" : null,
        previous.writable !== snapshot.writable ? "writable" : null,
        previous.failureCode !== snapshot.failureCode ? "failureCode" : null,
        previous.renewalRequired !== snapshot.renewalRequired ? "renewalRequired" : null,
        previous.degraded !== snapshot.degraded ? "degraded" : null,
        previous.leaseId !== snapshot.leaseId ? "leaseId" : null,
        previous.ownerId !== snapshot.ownerId ? "ownerId" : null
      ])
      : ["initial"];

    return {
      sequence: snapshot.sequence,
      observedAt: snapshot.observedAt,
      status: snapshot.status,
      writable: snapshot.writable,
      failureCode: snapshot.failureCode,
      renewalRequired: snapshot.renewalRequired,
      degraded: snapshot.degraded,
      changed
    };
  });
}

function buildExportSummary({ lease, health, failureState, analyticsCounters, timeline, now }) {
  const lastTransition = timeline[timeline.length - 1] || null;
  const statusCounts = {
    healthy: analyticsCounters.healthy,
    degraded: analyticsCounters.degraded,
    unhealthy: analyticsCounters.unhealthy,
    unknown: analyticsCounters.unknown
  };

  return {
    exportedAt: now,
    format: "working-directory-lease.analytics.v1",
    subject: {
      leaseId: lease.leaseId,
      ownerId: lease.ownerId,
      workdir: lease.workdir,
      artifactRoot: lease.artifactRoot
    },
    current: {
      status: health.status,
      writable: health.writable,
      renewalRequired: health.renewalRequired,
      failureCode: failureState.code
    },
    counters: {
      observations: analyticsCounters.observations,
      statusCounts,
      writableObservations: analyticsCounters.writable,
      readOnlyObservations: analyticsCounters.readOnly,
      failures: analyticsCounters.failures,
      terminalFailures: analyticsCounters.terminalFailures,
      validationErrors: analyticsCounters.validationErrors,
      validationWarnings: analyticsCounters.validationWarnings,
      leaseIdentityChanges: analyticsCounters.leaseIdentityChanges,
      ownerIdentityChanges: analyticsCounters.ownerIdentityChanges
    },
    latestTimelineEntry: lastTransition
  };
}

function normalizeAnalyticsExportFormat(value) {
  const format = asString(value)?.toLowerCase();
  if (format === "ndjson") {
    return "jsonl";
  }
  return ANALYTICS_EXPORT_FORMATS.has(format) ? format : "json";
}

function parseAnalyticsExportDestination(value) {
  const destination = asString(value);
  if (!destination) {
    return {
      destination: null,
      scheme: "memory",
      valid: true,
      reason: null
    };
  }

  const schemeMatch = destination.match(/^([a-z][a-z0-9+.-]*):/i);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : "file";
  const normalizedScheme = scheme === "http" ? "https" : scheme;
  const valid = ANALYTICS_EXPORT_DESTINATION_SCHEMES.has(normalizedScheme)
    && !(scheme === "http")
    && (normalizedScheme !== "webhook" || destination.startsWith("webhook:"));

  return {
    destination,
    scheme: normalizedScheme,
    valid,
    reason: valid
      ? null
      : scheme === "http"
        ? "ANALYTICS_EXPORT_REQUIRES_TLS"
        : "ANALYTICS_EXPORT_DESTINATION_UNSUPPORTED"
  };
}

function buildAnalyticsExportSchema(format) {
  const baseFields = [
    "type",
    "sequence",
    "observedAt",
    "status",
    "writable",
    "failureCode",
    "renewalRequired",
    "degraded"
  ];
  const historyOnlyFields = ["leaseId", "ownerId"];
  const transitionOnlyFields = ["changed"];

  return {
    format: "working-directory-lease.analytics-export-schema.v1",
    rowFormat: format,
    primaryKey: ["type", "sequence", "observedAt"],
    fields: format === "csv"
      ? baseFields.concat(historyOnlyFields, transitionOnlyFields)
      : baseFields.concat(["leaseId", "ownerId", "changed"]),
    requiredFields: baseFields,
    nullableFields: ["failureCode", "leaseId", "ownerId", "changed"]
  };
}

function buildAnalyticsExportFingerprint({ exportSummary, reporting, proof }) {
  return uniqueStrings([
    exportSummary.subject.leaseId,
    exportSummary.subject.ownerId,
    exportSummary.current.status,
    exportSummary.current.failureCode,
    String(exportSummary.counters.observations),
    String(reporting.export.rowCount),
    String(reporting.export.rowCountBeforeLimit),
    String(proof.auditTrail.length)
  ]).join("|") || "working-directory-lease.analytics.empty";
}

function buildAnalyticsExportContract({
  reportingInput,
  reporting,
  exportSummary,
  analyticsCounters,
  history,
  timeline,
  proof,
  now
}) {
  const format = normalizeAnalyticsExportFormat(reportingInput.requestedFormat);
  const destination = parseAnalyticsExportDestination(reportingInput.destination);
  const rowCount = reporting.export.rowCount;
  const blockers = uniqueStrings([
    destination.valid ? null : destination.reason,
    reportingInput.maxRows < 1 ? "ANALYTICS_EXPORT_MAX_ROWS_INVALID" : null,
    rowCount === 0 ? "ANALYTICS_EXPORT_EMPTY" : null,
    reporting.attention.severity === "critical" && !reportingInput.includeProofDigest
      ? "ANALYTICS_EXPORT_CRITICAL_PROOF_DIGEST_REQUIRED"
      : null
  ]);
  const warnings = uniqueStrings([
    reporting.export.truncated ? "ANALYTICS_EXPORT_TRUNCATED" : null,
    analyticsCounters.ownerIdentityChanges > 0 ? "ANALYTICS_EXPORT_OWNER_CHANGED" : null,
    analyticsCounters.leaseIdentityChanges > 0 ? "ANALYTICS_EXPORT_LEASE_CHANGED" : null,
    destination.scheme === "memory" ? "ANALYTICS_EXPORT_DESTINATION_IN_MEMORY" : null
  ]);
  const schema = buildAnalyticsExportSchema(format);
  const fingerprint = buildAnalyticsExportFingerprint({ exportSummary, reporting, proof });

  return {
    format: "working-directory-lease.analytics-export.v1",
    generatedAt: now,
    state: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "ready-with-warnings" : "ready",
    ready: blockers.length === 0,
    requestedFormat: reportingInput.requestedFormat,
    normalizedFormat: format,
    destination,
    manifest: {
      subject: exportSummary.subject,
      fingerprint,
      window: reporting.window,
      rowCount,
      totalHistorySnapshots: history.length,
      totalTimelineEntries: timeline.length,
      truncated: reporting.export.truncated,
      schema,
      contentType: format === "csv"
        ? "text/csv"
        : format === "jsonl"
          ? "application/x-ndjson"
          : "application/json"
    },
    delivery: {
      mode: destination.scheme === "memory" ? "return-payload" : "external-sink",
      command: blockers.length > 0
        ? "resolve-analytics-export-blockers"
        : destination.scheme === "memory"
          ? "return-analytics-export"
          : "publish-analytics-export",
      idempotencyKey: uniqueStrings([
        exportSummary.subject.leaseId,
        reporting.reportId,
        fingerprint
      ]).join(":") || null,
      subscriberId: reportingInput.subscriberId,
      destination: destination.destination,
      scheme: destination.scheme
    },
    validation: {
      blockers,
      warnings,
      proofDigestIncluded: Boolean(reporting.proofDigest),
      attentionSeverity: reporting.attention.severity
    }
  };
}

function normalizeAnalyticsReportingInput(input) {
  const analyticsInput = input.analytics && typeof input.analytics === "object" ? input.analytics : {};
  const reportingInput = analyticsInput.reporting && typeof analyticsInput.reporting === "object"
    ? analyticsInput.reporting
    : input.reporting && typeof input.reporting === "object"
      ? input.reporting
      : {};
  const exportInput = analyticsInput.export && typeof analyticsInput.export === "object"
    ? analyticsInput.export
    : input.export && typeof input.export === "object"
      ? input.export
      : {};

  return {
    format: "working-directory-lease.analytics-reporting-request.v1",
    windowMs: asPositiveInteger(reportingInput.windowMs ?? analyticsInput.windowMs, DEFAULT_LEASE_TTL_MS),
    includeHistoryRows: asBoolean(reportingInput.includeHistoryRows ?? exportInput.includeHistoryRows, true),
    includeTransitionRows: asBoolean(reportingInput.includeTransitionRows ?? exportInput.includeTransitionRows, true),
    maxRows: asPositiveInteger(reportingInput.maxRows ?? exportInput.maxRows, 50),
    destination: asString(exportInput.destination || reportingInput.destination),
    requestedFormat: normalizeAnalyticsExportFormat(exportInput.format || reportingInput.format),
    reportId: asString(reportingInput.reportId || exportInput.reportId || input.reportId),
    subscriberId: asString(reportingInput.subscriberId || exportInput.subscriberId),
    includeProofDigest: asBoolean(reportingInput.includeProofDigest ?? exportInput.includeProofDigest, true)
  };
}

function buildAnalyticsReportingState({ reportingInput, history, timeline, analyticsCounters, exportSummary, proof, nowMs, now }) {
  const windowStartMs = nowMs - reportingInput.windowMs;
  const windowHistory = history.filter((snapshot) => snapshot.observedAtMs >= windowStartMs);
  const transitionRows = timeline.filter((entry) => entry.changed.some((field) => field !== "initial"));
  const latestSnapshot = windowHistory[windowHistory.length - 1] || history[history.length - 1] || null;
  const attentionCodes = uniqueStrings([
    analyticsCounters.terminalFailures > 0 ? "TERMINAL_FAILURE_OBSERVED" : null,
    analyticsCounters.failures > 0 ? "LEASE_FAILURES_OBSERVED" : null,
    analyticsCounters.validationErrors > 0 ? "VALIDATION_ERRORS_PRESENT" : null,
    analyticsCounters.leaseIdentityChanges > 0 ? "LEASE_IDENTITY_CHANGED" : null,
    analyticsCounters.ownerIdentityChanges > 0 ? "OWNER_IDENTITY_CHANGED" : null,
    analyticsCounters.renewalRequired > 0 ? "RENEWAL_REQUIRED_OBSERVED" : null
  ]);
  const severity = analyticsCounters.terminalFailures > 0 || analyticsCounters.validationErrors > 0
    ? "critical"
    : analyticsCounters.failures > 0 || analyticsCounters.leaseIdentityChanges > 0 || analyticsCounters.ownerIdentityChanges > 0
      ? "warning"
      : analyticsCounters.renewalRequired > 0 || analyticsCounters.degraded > 0
        ? "notice"
        : "normal";
  const historyRows = reportingInput.includeHistoryRows
    ? windowHistory.map((snapshot) => ({
      type: "snapshot",
      sequence: snapshot.sequence,
      observedAt: snapshot.observedAt,
      status: snapshot.status,
      writable: snapshot.writable,
      failureCode: snapshot.failureCode,
      renewalRequired: snapshot.renewalRequired,
      degraded: snapshot.degraded,
      leaseId: snapshot.leaseId,
      ownerId: snapshot.ownerId
    }))
    : [];
  const rows = historyRows.concat(reportingInput.includeTransitionRows
    ? transitionRows.map((entry) => ({
      type: "transition",
      sequence: entry.sequence,
      observedAt: entry.observedAt,
      status: entry.status,
      writable: entry.writable,
      failureCode: entry.failureCode,
      renewalRequired: entry.renewalRequired,
      degraded: entry.degraded,
      changed: entry.changed
    }))
    : []);
  const rowCountBeforeLimit = rows.length;
  const exportRows = rows.slice(Math.max(0, rowCountBeforeLimit - reportingInput.maxRows));

  return {
    format: "working-directory-lease.analytics-reporting.v1",
    reportId: reportingInput.reportId || uniqueStrings([
      exportSummary.subject.leaseId,
      exportSummary.subject.ownerId,
      String(nowMs)
    ]).join(":"),
    generatedAt: now,
    window: {
      startedAt: new Date(windowStartMs).toISOString(),
      endedAt: now,
      windowMs: reportingInput.windowMs,
      observedSnapshots: windowHistory.length,
      totalSnapshots: history.length
    },
    attention: {
      required: attentionCodes.length > 0,
      severity,
      codes: attentionCodes,
      latestStatus: latestSnapshot?.status || exportSummary.current.status,
      latestFailureCode: latestSnapshot?.failureCode || exportSummary.current.failureCode
    },
    export: {
      ready: true,
      requestedFormat: reportingInput.requestedFormat,
      destination: reportingInput.destination,
      subscriberId: reportingInput.subscriberId,
      rowCount: exportRows.length,
      rowCountBeforeLimit,
      truncated: rowCountBeforeLimit > exportRows.length,
      rows: exportRows
    },
    proofDigest: reportingInput.includeProofDigest ? {
      auditTrailLength: proof.auditTrail.length,
      invariantCount: Object.keys(proof.invariants || {}).length,
      latestAuditEvent: proof.auditTrail[proof.auditTrail.length - 1] || null
    } : null
  };
}

function normalizeAcceptanceInput(input) {
  const acceptanceInput = input.acceptance && typeof input.acceptance === "object" ? input.acceptance : {};
  const previewInput = input.preview && typeof input.preview === "object" ? input.preview : {};

  return {
    requestedBy: asString(acceptanceInput.requestedBy || input.requestedBy),
    acceptedBy: asString(acceptanceInput.acceptedBy || input.acceptedBy),
    acceptedAt: acceptanceInput.acceptedAt || input.acceptedAt || null,
    requirePreviewAcknowledgement: asBoolean(
      acceptanceInput.requirePreviewAcknowledgement ?? previewInput.requireAcknowledgement,
      true
    ),
    previewAcknowledged: asBoolean(
      acceptanceInput.previewAcknowledged ?? previewInput.acknowledged,
      false
    ),
    allowDegradedAcceptance: asBoolean(acceptanceInput.allowDegradedAcceptance, false),
    requireExternalHandoffReady: asBoolean(acceptanceInput.requireExternalHandoffReady, true),
    requireWritableLease: asBoolean(acceptanceInput.requireWritableLease, true),
    clientRoute: asString(acceptanceInput.clientRoute || previewInput.clientRoute || input.route),
    clientRequestId: asString(acceptanceInput.clientRequestId || previewInput.clientRequestId || input.requestId)
  };
}

function normalizeClientRuntimeContract(input, lease) {
  const clientInput = input.client && typeof input.client === "object" ? input.client : {};
  const runtimeInput = input.runtime && typeof input.runtime === "object" ? input.runtime : {};
  const requestInput = input.request && typeof input.request === "object" ? input.request : {};
  const workspaceInput = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const handoffInput = input.workflowHandoff && typeof input.workflowHandoff === "object" ? input.workflowHandoff : {};
  const pendingWrites = asArray(
    clientInput.pendingWrites || runtimeInput.pendingWrites || workspaceInput.pendingWrites
  ).map(asString).filter(Boolean);

  return {
    format: "working-directory-lease.client-runtime.v1",
    requestId: asString(requestInput.id || clientInput.requestId || input.requestId),
    sessionId: asString(clientInput.sessionId || runtimeInput.sessionId || input.sessionId),
    actorId: asString(clientInput.actorId || runtimeInput.actorId || lease.ownerId),
    route: asString(requestInput.route || clientInput.route || input.route),
    activeView: asString(clientInput.activeView || runtimeInput.activeView || "artifact-filesystem"),
    intent: asString(requestInput.intent || clientInput.intent || input.intent) || "mount-working-directory",
    operation: asString(requestInput.operation || clientInput.operation || input.operation) || "lease-handoff",
    workspacePath: normalizeLeasePath(
      asString(workspaceInput.path || runtimeInput.workspacePath || clientInput.workspacePath || lease.workdir)
    ),
    clientRevision: asNonNegativeInteger(clientInput.revision ?? runtimeInput.revision, 0),
    optimisticLock: asString(clientInput.optimisticLock || runtimeInput.optimisticLock),
    pendingWrites,
    dirtyArtifactIds: uniqueStrings(asArray(clientInput.dirtyArtifactIds || workspaceInput.dirtyArtifactIds)),
    selectedArtifactIds: uniqueStrings(asArray(clientInput.selectedArtifactIds || runtimeInput.selectedArtifactIds)),
    handoffToken: asString(handoffInput.token || clientInput.handoffToken),
    returnRoute: asString(handoffInput.returnRoute || clientInput.returnRoute),
    requiresUserVisibleHandoff: asBoolean(handoffInput.requiresUserVisibleHandoff, true)
  };
}

function buildClientRuntimeValidation(clientRuntime, lease) {
  const errors = [];
  const warnings = [];

  if (!clientRuntime.requestId) {
    warnings.push({
      code: "CLIENT_REQUEST_ID_MISSING",
      field: "clientRuntime.requestId",
      message: "A requestId improves lease handoff traceability across hosted-kernel client state."
    });
  }
  if (!clientRuntime.sessionId) {
    warnings.push({
      code: "CLIENT_SESSION_ID_MISSING",
      field: "clientRuntime.sessionId",
      message: "A sessionId should be supplied so UI handoff state can be reconciled after refresh."
    });
  }
  if (clientRuntime.workspacePath && lease.workdir && clientRuntime.workspacePath !== normalizeLeasePath(lease.workdir)) {
    errors.push({
      code: "CLIENT_WORKSPACE_LEASE_MISMATCH",
      field: "clientRuntime.workspacePath",
      message: "The client runtime workspacePath must match the leased working directory."
    });
  }
  if (clientRuntime.workspacePath && lease.artifactRoot && !isContainedPath(clientRuntime.workspacePath, lease.artifactRoot)) {
    errors.push({
      code: "CLIENT_WORKSPACE_OUTSIDE_ROOT",
      field: "clientRuntime.workspacePath",
      message: "The client runtime workspacePath must remain contained by artifactRoot."
    });
  }
  if (clientRuntime.pendingWrites.length > 0 && !clientRuntime.handoffToken) {
    warnings.push({
      code: "PENDING_WRITES_WITHOUT_HANDOFF_TOKEN",
      field: "clientRuntime.handoffToken",
      message: "Pending artifact writes should include a handoffToken for resumable hosted-kernel workflow state."
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function normalizeTenantBoundaryContract(input, lease, clientRuntime) {
  const tenantInput = input.tenant && typeof input.tenant === "object" ? input.tenant : {};
  const workspaceInput = input.workspace && typeof input.workspace === "object" ? input.workspace : {};
  const permissionInput = input.permissions && typeof input.permissions === "object" ? input.permissions : {};
  const actorInput = input.actor && typeof input.actor === "object" ? input.actor : {};
  const requestedOperations = uniqueStrings(
    asArray(permissionInput.requestedOperations || input.requestedOperations).concat(clientRuntime.operation)
      .map(normalizeOperationName)
      .filter(Boolean)
  );
  const actorRoles = uniqueStrings(asArray(
    actorInput.roles || permissionInput.actorRoles || clientRuntime.roles
  ));
  const requiredRoles = uniqueStrings(asArray(
    permissionInput.requiredRoles || workspaceInput.requiredRoles || tenantInput.requiredRoles
  ));
  const grants = permissionInput.grants && typeof permissionInput.grants === "object" ? permissionInput.grants : {};
  const operationRolesInput = permissionInput.operationRoles && typeof permissionInput.operationRoles === "object"
    ? permissionInput.operationRoles
    : permissionInput.roleBindings && typeof permissionInput.roleBindings === "object"
      ? permissionInput.roleBindings
      : {};
  const operationRoles = Object.fromEntries(Object.entries(operationRolesInput)
    .map(([operation, roles]) => [normalizeOperationName(operation), uniqueStrings(asArray(roles))])
    .filter(([operation, roles]) => operation && roles.length > 0));

  return {
    format: "working-directory-lease.tenant-boundary.v1",
    tenantId: asString(tenantInput.tenantId || tenantInput.id || input.tenantId),
    expectedTenantId: asString(tenantInput.expectedTenantId || input.expectedTenantId),
    workspaceId: asString(workspaceInput.workspaceId || workspaceInput.id || input.workspaceId),
    workspacePath: normalizeLeasePath(clientRuntime.workspacePath || lease.workdir),
    scopeRoot: normalizeLeasePath(asString(workspaceInput.scopeRoot || tenantInput.scopeRoot || lease.artifactRoot)),
    allowedWorkdirs: uniqueStrings(asArray(workspaceInput.allowedWorkdirs || tenantInput.allowedWorkdirs))
      .map(normalizeLeasePath)
      .filter(Boolean),
    deniedWorkdirs: uniqueStrings(asArray(workspaceInput.deniedWorkdirs || tenantInput.deniedWorkdirs))
      .map(normalizeLeasePath)
      .filter(Boolean),
    actor: {
      actorId: asString(actorInput.actorId || clientRuntime.actorId || lease.ownerId),
      ownerId: lease.ownerId,
      roles: actorRoles
    },
    requiredRoles,
    operationRoles,
    requestedOperations,
    grants: {
      read: asBoolean(grants.read ?? permissionInput.read, true),
      write: asBoolean(grants.write ?? permissionInput.write, true),
      renew: asBoolean(grants.renew ?? permissionInput.renew, true),
      release: asBoolean(grants.release ?? permissionInput.release, true),
      handoff: asBoolean(grants.handoff ?? permissionInput.handoff, true)
    },
    isolationMode: asString(tenantInput.isolationMode || workspaceInput.isolationMode) || "tenant-workspace",
    auditSink: asString(tenantInput.auditSink || workspaceInput.auditSink || permissionInput.auditSink)
  };
}

function buildTenantBoundaryValidation(boundary, lease) {
  const errors = [];
  const warnings = [];
  const roleMissing = boundary.requiredRoles.filter((role) => !boundary.actor.roles.includes(role));
  const allowedMatched = boundary.allowedWorkdirs.length === 0
    || boundary.allowedWorkdirs.some((workdir) => isContainedPath(boundary.workspacePath, workdir));
  const deniedMatched = boundary.deniedWorkdirs.some((workdir) => isContainedPath(boundary.workspacePath, workdir));

  if (!boundary.tenantId) {
    errors.push({
      code: "TENANT_ID_REQUIRED",
      field: "tenantBoundary.tenantId",
      message: "A tenantId is required before a hosted-kernel working-directory lease can cross runtime boundaries."
    });
  }
  if (boundary.expectedTenantId && boundary.tenantId && boundary.expectedTenantId !== boundary.tenantId) {
    errors.push({
      code: "TENANT_ID_MISMATCH",
      field: "tenantBoundary.tenantId",
      message: "The lease tenant does not match the expected tenant for this workspace handoff."
    });
  }
  if (!boundary.workspaceId) {
    warnings.push({
      code: "WORKSPACE_ID_MISSING",
      field: "tenantBoundary.workspaceId",
      message: "workspaceId is missing; audit handoff will rely on path and lease identity only."
    });
  }
  if (boundary.scopeRoot && boundary.workspacePath && !isContainedPath(boundary.workspacePath, boundary.scopeRoot)) {
    errors.push({
      code: "WORKSPACE_OUTSIDE_TENANT_SCOPE",
      field: "tenantBoundary.workspacePath",
      message: "The workspace path must remain inside the tenant workspace scopeRoot."
    });
  }
  if (lease.artifactRoot && boundary.scopeRoot && !isContainedPath(boundary.scopeRoot, lease.artifactRoot)) {
    errors.push({
      code: "TENANT_SCOPE_OUTSIDE_ARTIFACT_ROOT",
      field: "tenantBoundary.scopeRoot",
      message: "The tenant workspace scopeRoot must be contained by artifactRoot."
    });
  }
  if (!allowedMatched) {
    errors.push({
      code: "WORKDIR_NOT_IN_ALLOWED_SCOPE",
      field: "tenantBoundary.allowedWorkdirs",
      message: "The leased workspace path is not included in the tenant allowedWorkdirs boundary."
    });
  }
  if (deniedMatched) {
    errors.push({
      code: "WORKDIR_DENIED_BY_TENANT_BOUNDARY",
      field: "tenantBoundary.deniedWorkdirs",
      message: "The leased workspace path is explicitly denied by the tenant boundary contract."
    });
  }
  if (roleMissing.length > 0) {
    errors.push({
      code: "ACTOR_ROLE_PERMISSION_DENIED",
      field: "tenantBoundary.actor.roles",
      message: "The actor is missing a required role for this working-directory lease operation."
    });
  }
  if (!boundary.auditSink) {
    warnings.push({
      code: "TENANT_AUDIT_SINK_MISSING",
      field: "tenantBoundary.auditSink",
      message: "No tenant auditSink was supplied for downstream lease handoff evidence."
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    roleMissing,
    allowedMatched,
    deniedMatched
  };
}

function resolveTenantPermissionDecision({ boundary, boundaryValidation, operation, lifecycleCommands, health, externalHandoff }) {
  const normalizedOperation = normalizeOperationName(operation) || "inspect";
  const grantName = TENANT_OPERATION_GRANTS[normalizedOperation] || "read";
  const requiredRoles = uniqueStrings([
    ...boundary.requiredRoles,
    ...asArray(boundary.operationRoles[normalizedOperation]),
    ...asArray(boundary.operationRoles[grantName])
  ]);
  const missingRoles = requiredRoles.filter((role) => !boundary.actor.roles.includes(role));
  const lifecycleAllowed = grantName === "write"
    ? health.writable && lifecycleCommands.write.enabled
    : grantName === "renew"
      ? lifecycleCommands.renew.enabled
      : grantName === "release"
        ? lifecycleCommands.release.enabled
        : grantName === "handoff"
          ? externalHandoff.enabled
          : true;
  const grantAllowed = Boolean(boundary.grants[grantName]);
  const blockers = uniqueStrings([
    boundaryValidation.ok ? null : "TENANT_BOUNDARY_INVALID",
    grantAllowed ? null : `TENANT_${grantName.toUpperCase()}_GRANT_MISSING`,
    missingRoles.length > 0 ? "TENANT_OPERATION_ROLE_MISSING" : null,
    lifecycleAllowed ? null : `TENANT_${grantName.toUpperCase()}_LIFECYCLE_BLOCKED`
  ]);

  return {
    operation: normalizedOperation,
    grant: grantName,
    allowed: blockers.length === 0,
    state: blockers.length === 0 ? "granted" : "denied",
    blockers,
    requiredRoles,
    missingRoles,
    lifecycleAllowed,
    scope: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      workspacePath: boundary.workspacePath,
      scopeRoot: boundary.scopeRoot
    }
  };
}

function buildTenantAccessContract({ boundary, boundaryValidation, health, lifecycleCommands, externalHandoff }) {
  const operationNames = uniqueStrings(boundary.requestedOperations.concat([
    "read",
    "write",
    "renew",
    "release",
    "handoff",
    "mount-artifact-filesystem"
  ]));
  const operationDecisions = operationNames.map((operation) => resolveTenantPermissionDecision({
    boundary,
    boundaryValidation,
    operation,
    lifecycleCommands,
    health,
    externalHandoff
  }));
  const requestedDecisionSet = operationDecisions.filter((decision) => boundary.requestedOperations.includes(decision.operation));
  const deniedOperations = requestedDecisionSet
    .filter((decision) => !decision.allowed)
    .map((decision) => decision.operation);
  const decisionForGrant = (grantName) => operationDecisions.find((decision) => decision.grant === grantName)
    || resolveTenantPermissionDecision({
      boundary,
      boundaryValidation,
      operation: grantName,
      lifecycleCommands,
      health,
      externalHandoff
    });
  const writeDecision = decisionForGrant("write");
  const renewDecision = decisionForGrant("renew");
  const releaseDecision = decisionForGrant("release");
  const handoffDecision = decisionForGrant("handoff");
  const writeAllowed = boundaryValidation.ok && boundary.grants.write && health.writable && lifecycleCommands.write.enabled && writeDecision.allowed;
  const handoffAllowed = boundaryValidation.ok && boundary.grants.handoff && externalHandoff.enabled && handoffDecision.allowed;

  return {
    format: "working-directory-lease.tenant-access.v1",
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    actorId: boundary.actor.actorId,
    isolationMode: boundary.isolationMode,
    state: !boundaryValidation.ok
      ? "blocked"
      : deniedOperations.length > 0
        ? "permission-denied"
        : writeAllowed || handoffAllowed
          ? "granted"
          : "read-only",
    allowedOperations: requestedDecisionSet
      .filter((decision) => decision.allowed)
      .map((decision) => decision.operation),
    deniedOperations,
    permissionMatrix: {
      decisions: operationDecisions,
      deniedReasons: uniqueStrings(operationDecisions.flatMap((decision) => decision.blockers)),
      requiredRoles: uniqueStrings(operationDecisions.flatMap((decision) => decision.requiredRoles)),
      missingRoles: uniqueStrings(operationDecisions.flatMap((decision) => decision.missingRoles))
    },
    permissions: {
      canRead: boundaryValidation.ok && boundary.grants.read,
      canWrite: writeAllowed,
      canRenew: boundaryValidation.ok && boundary.grants.renew && lifecycleCommands.renew.enabled && renewDecision.allowed,
      canRelease: boundaryValidation.ok && boundary.grants.release && lifecycleCommands.release.enabled && releaseDecision.allowed,
      canHandoff: handoffAllowed
    },
    proof: {
      scopeRoot: boundary.scopeRoot,
      workspacePath: boundary.workspacePath,
      allowedMatched: boundaryValidation.allowedMatched,
      deniedMatched: boundaryValidation.deniedMatched,
      missingRoles: boundaryValidation.roleMissing,
      operationMissingRoles: uniqueStrings(operationDecisions.flatMap((decision) => decision.missingRoles)),
      auditSink: boundary.auditSink
    }
  };
}

function buildTenantAuditHandoff({ boundary, tenantAccess, providerOperation, providerServiceAdmission, clientRuntime, now }) {
  const deniedDecision = tenantAccess.permissionMatrix.decisions.find((decision) => !decision.allowed) || null;
  const eventCodes = uniqueStrings([
    tenantAccess.state === "granted" ? "tenant-access.granted" : `tenant-access.${tenantAccess.state}`,
    providerServiceAdmission.admitted ? "provider-admission.admitted" : "provider-admission.blocked",
    deniedDecision ? `tenant-operation.denied.${deniedDecision.operation}` : null,
    tenantAccess.permissionMatrix.missingRoles.length > 0 ? "tenant-role.missing" : null
  ]);

  return {
    format: "working-directory-lease.tenant-audit-handoff.v1",
    generatedAt: now,
    required: tenantAccess.state !== "granted"
      || tenantAccess.permissionMatrix.deniedReasons.length > 0
      || providerServiceAdmission.tenantProof?.decision === "denied",
    sink: boundary.auditSink,
    routingKey: uniqueStrings([
      boundary.tenantId,
      boundary.workspaceId,
      clientRuntime.sessionId,
      providerOperation.requestId
    ]).join(":") || null,
    events: eventCodes.map((code) => ({
      code,
      severity: code.includes(".denied") || code.includes(".blocked") || code.includes(".missing")
        ? "warning"
        : "info",
      subject: {
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId,
        actorId: tenantAccess.actorId,
        operation: providerOperation.operation
      }
    })),
    permissionDigest: {
      state: tenantAccess.state,
      allowedOperations: tenantAccess.allowedOperations,
      deniedOperations: tenantAccess.deniedOperations,
      deniedReasons: tenantAccess.permissionMatrix.deniedReasons,
      missingRoles: tenantAccess.permissionMatrix.missingRoles,
      providerDecision: providerServiceAdmission.tenantProof
    },
    boundaryDigest: {
      isolationMode: boundary.isolationMode,
      scopeRoot: boundary.scopeRoot,
      workspacePath: boundary.workspacePath,
      allowedMatched: tenantAccess.proof.allowedMatched,
      deniedMatched: tenantAccess.proof.deniedMatched
    }
  };
}

function normalizeWriteIntentContract(input, clientRuntime, lease) {
  const writeInput = input.writeIntent && typeof input.writeIntent === "object" ? input.writeIntent : {};
  const queueInput = input.writeQueue && typeof input.writeQueue === "object" ? input.writeQueue : {};
  const requestedWrites = asArray(writeInput.artifactIds || writeInput.pendingWrites || queueInput.items)
    .concat(clientRuntime.pendingWrites)
    .map((entry, index) => {
      if (typeof entry === "string") {
        return {
          artifactId: entry,
          path: null,
          operation: "write",
          sequence: index + 1
        };
      }
      if (!entry || typeof entry !== "object") {
        return null;
      }

      return {
        artifactId: asString(entry.artifactId || entry.id || entry.path) || `write-${index + 1}`,
        path: normalizeLeasePath(asString(entry.path || entry.relativePath)),
        operation: asString(entry.operation || entry.mode) || "write",
        sequence: Number.isInteger(entry.sequence) ? entry.sequence : index + 1
      };
    })
    .filter(Boolean);

  return {
    format: "working-directory-lease.write-intent.v1",
    requestId: asString(writeInput.requestId || queueInput.requestId || clientRuntime.requestId),
    mode: asString(writeInput.mode || queueInput.mode) || "atomic",
    requestedBy: asString(writeInput.requestedBy || clientRuntime.actorId || lease.ownerId),
    queueName: asString(queueInput.name || writeInput.queueName) || "artifact-writes",
    maxBatchSize: asPositiveInteger(writeInput.maxBatchSize ?? queueInput.maxBatchSize, 25),
    requireAtomicCommit: asBoolean(writeInput.requireAtomicCommit ?? queueInput.requireAtomicCommit, true),
    requireLeaseRenewalBeforeCommit: asBoolean(writeInput.requireLeaseRenewalBeforeCommit, true),
    writes: requestedWrites,
    dirtyArtifactIds: clientRuntime.dirtyArtifactIds,
    optimisticLock: clientRuntime.optimisticLock
  };
}

function buildWriteAdmissionContract({
  writeIntent,
  lease,
  health,
  lifecycle,
  tenantAccess,
  recovery,
  externalHandoff,
  operationalIncident
}) {
  const cappedWrites = writeIntent.writes.slice(0, writeIntent.maxBatchSize);
  const overflowCount = Math.max(0, writeIntent.writes.length - cappedWrites.length);
  const blockers = uniqueStrings([
    operationalIncident?.circuitBreaker?.blockWrites ? "OPERATIONAL_INCIDENT_BLOCKS_WRITES" : null,
    health.writable ? null : "LEASE_NOT_WRITABLE",
    lifecycle.commands.write.enabled ? null : lifecycle.commands.write.reason || "WRITE_COMMAND_DISABLED",
    tenantAccess.permissions.canWrite ? null : "TENANT_WRITE_PERMISSION_DENIED",
    recovery.restartSafeStatus === "stable" || recovery.restartSafeStatus === "idempotent-replay"
      ? null
      : "RECOVERY_REQUIRED_BEFORE_WRITE",
    externalHandoff.state === "blocked" ? "EXTERNAL_HANDOFF_BLOCKED" : null,
    writeIntent.requireLeaseRenewalBeforeCommit && health.renewalRequired ? "LEASE_RENEWAL_REQUIRED_BEFORE_COMMIT" : null
  ]);
  const state = blockers.length > 0
    ? "blocked"
    : writeIntent.writes.length === 0
      ? "idle"
      : overflowCount > 0
        ? "partial-batch"
        : "admitted";

  return {
    format: "working-directory-lease.write-admission.v1",
    state,
    admitted: state === "admitted" || state === "partial-batch",
    leaseId: lease.leaseId,
    ownerId: lease.ownerId,
    queueName: writeIntent.queueName,
    requestId: writeIntent.requestId,
    mode: writeIntent.mode,
    blockers,
    commitPolicy: {
      atomic: writeIntent.requireAtomicCommit,
      requireLeaseRenewalBeforeCommit: writeIntent.requireLeaseRenewalBeforeCommit,
      optimisticLock: writeIntent.optimisticLock,
      maxBatchSize: writeIntent.maxBatchSize
    },
    batch: {
      requestedCount: writeIntent.writes.length,
      admittedCount: blockers.length > 0 ? 0 : cappedWrites.length,
      overflowCount,
      dirtyArtifactIds: writeIntent.dirtyArtifactIds
    },
    admittedWrites: blockers.length > 0 ? [] : cappedWrites,
    nextCommand: blockers.length > 0
      ? blockers.includes("OPERATIONAL_INCIDENT_BLOCKS_WRITES")
        ? operationalIncident.nextCommand
        : blockers.includes("LEASE_RENEWAL_REQUIRED_BEFORE_COMMIT")
        ? "renew"
        : recovery.requiredRecoveryCommands[0] || lifecycle.nextAction.command
      : overflowCount > 0
        ? "flush-admitted-write-batch"
        : writeIntent.writes.length > 0
          ? "commit-artifact-writes"
          : null
  };
}

function normalizePersistedLeaseState(input, lease, clientRuntime, nowMs, now) {
  const recoveryInput = input.recovery && typeof input.recovery === "object" ? input.recovery : {};
  const persistedInput = input.persistedState && typeof input.persistedState === "object"
    ? input.persistedState
    : input.state && typeof input.state === "object"
      ? input.state
      : recoveryInput.persistedState && typeof recoveryInput.persistedState === "object"
        ? recoveryInput.persistedState
        : {};
  const commandInput = input.commandState && typeof input.commandState === "object"
    ? input.commandState
    : input.idempotency && typeof input.idempotency === "object"
      ? input.idempotency
      : {};
  const persistedLeaseInput = persistedInput.lease && typeof persistedInput.lease === "object" ? persistedInput.lease : persistedInput;
  const persistedCheckpoint = asString(
    persistedInput.checkpoint || persistedInput.localCheckpoint || recoveryInput.checkpoint
  );
  const observedAtMs = asTimestamp(
    persistedInput.observedAt || persistedInput.generatedAt || persistedInput.persistedAt,
    null
  );
  const commandId = asString(
    commandInput.commandId || input.commandId || clientRuntime.requestId || clientRuntime.handoffToken
  );
  const replayKey = asString(commandInput.replayKey)
    || uniqueStrings([
      lease.leaseId || "missing-lease",
      clientRuntime.operation,
      String(clientRuntime.clientRevision),
      commandId
    ]).join(":");
  const appliedCommandIds = uniqueStrings(asArray(
    commandInput.appliedCommandIds || persistedInput.appliedCommandIds || persistedInput.commands?.applied
  ));
  const restartEpoch = asString(
    recoveryInput.restartEpoch || persistedInput.restartEpoch || persistedInput.bootId || input.restartEpoch
  );
  const currentRestartEpoch = asString(
    recoveryInput.currentRestartEpoch || recoveryInput.bootId || input.currentRestartEpoch || restartEpoch
  );
  const persistedGeneration = asNonNegativeInteger(
    persistedInput.generation ?? persistedInput.revision ?? persistedInput.version,
    0
  );
  const status = asString(persistedInput.status || persistedInput.health?.status) || "unknown";
  const commandResults = persistedInput.commandResults && typeof persistedInput.commandResults === "object"
    ? persistedInput.commandResults
    : commandInput.results && typeof commandInput.results === "object"
      ? commandInput.results
      : {};
  const persistedFingerprint = asString(
    persistedInput.fingerprint || persistedInput.liveLeaseFingerprint || persistedInput.currentFingerprint
  );

  return {
    format: "working-directory-lease.persisted-state.v1",
    stateId: asString(persistedInput.stateId || persistedInput.id || recoveryInput.stateId)
      || `working-directory-lease-state:${lease.leaseId || "unassigned"}`,
    present: Object.keys(persistedInput).length > 0,
    absenceReason: Object.keys(persistedInput).length > 0 ? null : "PERSISTED_STATE_NOT_SUPPLIED",
    observedAt: observedAtMs ? new Date(observedAtMs).toISOString() : null,
    observedAtMs,
    ageMs: observedAtMs ? Math.max(0, nowMs - observedAtMs) : null,
    generation: persistedGeneration,
    restartEpoch,
    currentRestartEpoch,
    restartEpochChanged: Boolean(restartEpoch && currentRestartEpoch && restartEpoch !== currentRestartEpoch),
    checkpoint: persistedCheckpoint,
    status,
    dirty: asBoolean(persistedInput.dirty || persistedInput.hasUnflushedWrites, false),
    restartDetected: asBoolean(recoveryInput.restartDetected ?? persistedInput.restartDetected, false),
    leaseIdentity: {
      leaseId: asString(persistedLeaseInput.leaseId),
      ownerId: asString(persistedLeaseInput.ownerId),
      workdir: normalizeLeasePath(asString(persistedLeaseInput.workdir))
    },
    command: {
      commandId,
      replayKey,
      lastCommandId: asString(commandInput.lastCommandId || persistedInput.lastCommandId),
      appliedCommandIds,
      alreadyApplied: Boolean(commandId && appliedCommandIds.includes(commandId))
        || Boolean(replayKey && appliedCommandIds.includes(replayKey)),
      resultRef: asString(commandResults[commandId]?.resultRef || commandResults[replayKey]?.resultRef),
      resultStatus: asString(commandResults[commandId]?.status || commandResults[replayKey]?.status),
      resultFingerprint: asString(commandResults[commandId]?.fingerprint || commandResults[replayKey]?.fingerprint)
    },
    currentFingerprint: uniqueStrings([
      lease.leaseId,
      lease.ownerId,
      normalizeLeasePath(lease.workdir),
      String(clientRuntime.clientRevision)
    ]).join("|") || null,
    persistedFingerprint,
    fingerprintChanged: Boolean(persistedFingerprint && persistedFingerprint !== uniqueStrings([
      lease.leaseId,
      lease.ownerId,
      normalizeLeasePath(lease.workdir),
      String(clientRuntime.clientRevision)
    ]).join("|")),
    evaluatedAt: now
  };
}

function buildPersistedStateValidation(persistedState, lease, clientRuntime) {
  const errors = [];
  const warnings = [];

  if (!persistedState.present) {
    return { ok: true, errors, warnings };
  }
  if (persistedState.leaseIdentity.leaseId && lease.leaseId && persistedState.leaseIdentity.leaseId !== lease.leaseId) {
    errors.push({
      code: "PERSISTED_LEASE_ID_MISMATCH",
      field: "persistedState.lease.leaseId",
      message: "Persisted lease state belongs to a different leaseId and must not be replayed."
    });
  }
  if (persistedState.leaseIdentity.ownerId && lease.ownerId && persistedState.leaseIdentity.ownerId !== lease.ownerId) {
    errors.push({
      code: "PERSISTED_OWNER_ID_MISMATCH",
      field: "persistedState.lease.ownerId",
      message: "Persisted lease state belongs to a different ownerId and cannot authorize recovery commands."
    });
  }
  if (persistedState.leaseIdentity.workdir && lease.workdir && persistedState.leaseIdentity.workdir !== normalizeLeasePath(lease.workdir)) {
    errors.push({
      code: "PERSISTED_WORKDIR_MISMATCH",
      field: "persistedState.lease.workdir",
      message: "Persisted state references a different working directory than the active lease."
    });
  }
  if (clientRuntime.pendingWrites.length > 0 && !persistedState.checkpoint) {
    warnings.push({
      code: "PENDING_WRITES_WITHOUT_PERSISTED_CHECKPOINT",
      field: "persistedState.checkpoint",
      message: "Pending writes should have a persisted checkpoint for deterministic restart recovery."
    });
  }
  if (persistedState.ageMs !== null && persistedState.ageMs > DEFAULT_MAX_LEASE_TTL_MS) {
    warnings.push({
      code: "PERSISTED_STATE_STALE",
      field: "persistedState.observedAt",
      message: "Persisted lease state is older than the maximum lease ttl and should be refreshed before replay."
    });
  }
  if (persistedState.restartEpochChanged && persistedState.dirty && !persistedState.checkpoint) {
    warnings.push({
      code: "RESTART_EPOCH_CHANGED_WITH_DIRTY_STATE",
      field: "persistedState.restartEpoch",
      message: "Restart crossed epochs while dirty state lacked a checkpoint; recovery must reconcile writes before admission."
    });
  }
  if (persistedState.fingerprintChanged && !persistedState.command.alreadyApplied) {
    warnings.push({
      code: "PERSISTED_FINGERPRINT_CHANGED",
      field: "persistedState.fingerprint",
      message: "Persisted live lease fingerprint differs from the current runtime fingerprint; rewrite persisted state after recovery."
    });
  }
  if (persistedState.command.alreadyApplied && !persistedState.command.resultRef) {
    warnings.push({
      code: "IDEMPOTENT_COMMAND_RESULT_MISSING",
      field: "persistedState.commandResults",
      message: "The command was already applied but no persisted result reference was supplied for replay."
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function buildRestartCommandReceipt({ persistedState, persistedStateValidation, health, failureState, lifecycle, retryPolicy, now }) {
  const commandId = persistedState.command.commandId;
  const replayKey = persistedState.command.replayKey;
  const alreadyApplied = persistedState.command.alreadyApplied;
  const mismatchBlocked = persistedStateValidation.errors.length > 0;
  const replayFingerprint = uniqueStrings([
    persistedState.stateId,
    persistedState.leaseIdentity.leaseId,
    persistedState.currentFingerprint,
    replayKey,
    commandId,
    String(persistedState.generation)
  ]).join("|") || null;
  const commandResultFingerprint = persistedState.command.resultFingerprint || (alreadyApplied
    ? replayFingerprint
    : null);
  const expiresAt = retryPolicy.nextAttemptAt
    || lifecycle.nextAction.dueAt
    || (health.msUntilExpiry > 0 ? new Date(Date.parse(now) + health.msUntilExpiry).toISOString() : null);
  const replayDisposition = mismatchBlocked
    ? "blocked"
    : alreadyApplied
      ? persistedState.command.resultRef ? "return-stored-result" : "acknowledge-applied"
      : failureState.code === "LEASE_EXPIRED"
        ? "requires-reacquire"
        : health.status === "unhealthy"
          ? "defer-until-healthy"
          : "execute-once";
  const persistedCommandPatch = commandId || replayKey
    ? {
      lastCommandId: commandId,
      appliedCommandIds: alreadyApplied
        ? persistedState.command.appliedCommandIds
        : uniqueStrings(persistedState.command.appliedCommandIds.concat(commandId, replayKey)),
      commandResults: {
        [commandId || replayKey]: {
          status: alreadyApplied ? persistedState.command.resultStatus || "applied" : "pending",
          resultRef: alreadyApplied ? persistedState.command.resultRef : null,
          fingerprint: commandResultFingerprint || replayFingerprint,
          observedAt: now
        }
      }
    }
    : null;

  return {
    format: "working-directory-lease.restart-command-receipt.v1",
    receiptId: replayFingerprint ? `lease-command-receipt:${replayFingerprint}` : null,
    commandId,
    replayKey,
    replayFingerprint,
    alreadyApplied,
    replayDisposition,
    replaySafe: !mismatchBlocked && replayDisposition !== "defer-until-healthy",
    blockedReasons: uniqueStrings([
      mismatchBlocked ? "PERSISTED_STATE_VALIDATION_FAILED" : null,
      health.status === "unhealthy" ? "LEASE_UNHEALTHY" : null,
      failureState.terminal ? failureState.code : null
    ]),
    result: {
      state: alreadyApplied
        ? persistedState.command.resultRef ? "stored-result" : "stored-ack"
        : replayDisposition === "execute-once" ? "pending-execution" : replayDisposition,
      resultRef: alreadyApplied ? persistedState.command.resultRef : null,
      status: alreadyApplied ? persistedState.command.resultStatus || "applied" : null,
      fingerprint: commandResultFingerprint
    },
    expiresAt,
    persistedCommandPatch
  };
}

function buildRecoveryContract({ persistedState, persistedStateValidation, health, failureState, lifecycle, retryPolicy, syncMetadata, now }) {
  const replaySuppressed = persistedState.command.alreadyApplied;
  const mismatchBlocked = persistedStateValidation.errors.length > 0;
  const restartCommandReceipt = buildRestartCommandReceipt({
    persistedState,
    persistedStateValidation,
    health,
    failureState,
    lifecycle,
    retryPolicy,
    now
  });
  const restartRecoveryRequired = persistedState.restartDetected
    || persistedState.restartEpochChanged
    || persistedState.fingerprintChanged
    || persistedState.dirty
    || syncMetadata.requiresUpload
    || syncMetadata.requiresRemoteRegistration;
  const status = mismatchBlocked
    ? "blocked"
    : replaySuppressed
      ? "idempotent-replay"
      : failureState.code === "LEASE_EXPIRED"
        ? "requires-reacquire"
        : restartRecoveryRequired
          ? "recovering"
        : health.status === "healthy"
          ? "stable"
          : "observe";
  const recoveryCommands = uniqueStrings([
    mismatchBlocked ? "discard-persisted-state" : null,
    replaySuppressed ? "return-persisted-result" : null,
    failureState.code === "LEASE_EXPIRED" ? "acquire-replacement-lease" : null,
    persistedState.dirty ? "reconcile-dirty-artifact-writes" : null,
    persistedState.restartEpochChanged ? "rewrite-restart-epoch" : null,
    persistedState.fingerprintChanged ? "rewrite-lease-fingerprint" : null,
    syncMetadata.requiresRemoteRegistration ? "register-sync-checkpoint" : null,
    syncMetadata.requiresUpload ? "publish-sync-checkpoint" : null,
    health.renewalRequired && lifecycle.commands.renew.enabled ? "renew" : null,
    retryPolicy.retryable ? "retry" : null
  ]);
  const persistenceReasons = uniqueStrings([
    !persistedState.present ? "capture-initial-state" : null,
    persistedState.restartEpochChanged ? "restart-epoch-advanced" : null,
    persistedState.fingerprintChanged ? "lease-fingerprint-changed" : null,
    persistedState.dirty ? "dirty-state-reconciled" : null,
    syncMetadata.requiresUpload || syncMetadata.requiresRemoteRegistration ? "sync-checkpoint-pending" : null,
    replaySuppressed && !persistedState.command.resultRef ? "idempotent-result-reference-missing" : null,
    status === "stable" && persistedState.status !== health.status ? "health-status-changed" : null
  ]);
  const persistenceRequired = !mismatchBlocked && persistenceReasons.length > 0;
  const nextGeneration = persistedState.generation + (persistenceRequired ? 1 : 0);

  return {
    format: "working-directory-lease.recovery.v1",
    restartSafeStatus: status,
    canReplayCommand: !mismatchBlocked && !replaySuppressed && health.status !== "unhealthy",
    idempotency: {
      commandId: persistedState.command.commandId,
      replayKey: persistedState.command.replayKey,
      receiptId: restartCommandReceipt.receiptId,
      replayFingerprint: restartCommandReceipt.replayFingerprint,
      alreadyApplied: replaySuppressed,
      effect: replaySuppressed ? "no-op" : "execute-once",
      disposition: restartCommandReceipt.replayDisposition,
      result: {
        state: replaySuppressed
          ? persistedState.command.resultRef ? "return-stored-result" : "return-idempotent-ack"
          : mismatchBlocked ? "blocked" : "not-applied",
        resultRef: replaySuppressed ? persistedState.command.resultRef : null,
        status: replaySuppressed ? persistedState.command.resultStatus || "applied" : null,
        fingerprint: replaySuppressed ? persistedState.command.resultFingerprint : null
      }
    },
    restartCommandReceipt,
    requiredRecoveryCommands: recoveryCommands,
    persistence: {
      required: persistenceRequired,
      reasons: persistenceReasons,
      key: uniqueStrings([
        persistedState.leaseIdentity.leaseId || persistedState.currentFingerprint,
        persistedState.command.replayKey,
        String(nextGeneration)
      ]).join(":") || null,
      compareAndSet: {
        expectedGeneration: persistedState.generation,
        nextGeneration,
        expectedRestartEpoch: persistedState.restartEpoch,
        nextRestartEpoch: persistedState.currentRestartEpoch,
        expectedFingerprint: persistedState.persistedFingerprint,
        nextFingerprint: persistedState.currentFingerprint
      },
      statePatch: persistenceRequired ? {
        format: "working-directory-lease.persisted-state.v1",
        generation: nextGeneration,
        restartEpoch: persistedState.currentRestartEpoch,
        fingerprint: persistedState.currentFingerprint,
        status: health.status,
        checkpoint: syncMetadata.localCheckpoint || persistedState.checkpoint,
        dirty: false,
        lastCommandId: persistedState.command.commandId,
        appliedCommandIds: uniqueStrings(
          persistedState.command.appliedCommandIds.concat(persistedState.command.commandId, persistedState.command.replayKey)
        ),
        commandResults: restartCommandReceipt.persistedCommandPatch?.commandResults || null,
        persistedAt: now
      } : null
    },
    persistedCheckpoint: persistedState.checkpoint,
    recoveredGeneration: persistedState.generation,
    restartEpoch: persistedState.restartEpoch,
    currentRestartEpoch: persistedState.currentRestartEpoch,
    resumeAfter: replaySuppressed ? null : retryPolicy.nextAttemptAt || lifecycle.nextAction.dueAt,
    proof: {
      stateAccepted: persistedStateValidation.ok,
      liveLeaseFingerprint: persistedState.currentFingerprint,
      persistedFingerprint: persistedState.persistedFingerprint,
      fingerprintChanged: persistedState.fingerprintChanged,
      restartEpochChanged: persistedState.restartEpochChanged,
      persistedLeaseId: persistedState.leaseIdentity.leaseId,
      persistedOwnerId: persistedState.leaseIdentity.ownerId,
      persistedWorkdir: persistedState.leaseIdentity.workdir
    }
  };
}

function buildValidationSummary(validation, lifecycleSettingsValidation, capabilityNegotiation) {
  const blockingCodes = uniqueStrings(validation.errors.map((error) => error.code));
  const warningCodes = uniqueStrings(validation.warnings.map((warning) => warning.code));
  const capabilityMissing = capabilityNegotiation.missing || [];

  return {
    status: validation.ok && capabilityNegotiation.ok ? "pass" : "blocked",
    blockingCount: blockingCodes.length + capabilityMissing.length,
    warningCount: warningCodes.length,
    blockingCodes,
    warningCodes,
    lifecycleSettings: {
      ok: lifecycleSettingsValidation.ok,
      errorCount: lifecycleSettingsValidation.errors.length,
      warningCount: lifecycleSettingsValidation.warnings.length
    },
    capabilityNegotiation: {
      ok: capabilityNegotiation.ok,
      missing: capabilityMissing,
      granted: capabilityNegotiation.granted
    }
  };
}

function buildWorkflowHandoffContract({
  clientRuntime,
  preview,
  acceptance,
  externalHandoff,
  tenantAccess,
  writeAdmission,
  lifecycle,
  health,
  validationSummary,
  retryPolicy,
  operationalIncident
}) {
  const blockers = uniqueStrings([
    validationSummary.status !== "pass" ? "VALIDATION_BLOCKED" : null,
    operationalIncident.active && operationalIncident.circuitBreaker.blockProviderAdmission
      ? "OPERATIONAL_INCIDENT_ACTIVE"
      : null,
    acceptance.state !== "acceptable" ? acceptance.blockers[0] || "ACCEPTANCE_BLOCKED" : null,
    externalHandoff.state === "blocked" ? externalHandoff.blockedReason : null,
    tenantAccess.state === "blocked" || tenantAccess.state === "permission-denied"
      ? "TENANT_PERMISSION_DENIED"
      : null,
    writeAdmission.state === "blocked" ? writeAdmission.blockers[0] || "WRITE_ADMISSION_BLOCKED" : null,
    health.writable ? null : "LEASE_NOT_WRITABLE"
  ]);
  const state = blockers.length > 0
    ? retryPolicy.retryable ? "retry-scheduled" : "blocked"
    : acceptance.accepted
      ? "mount-ready"
      : externalHandoff.state === "pending-sync"
        ? "sync-required"
        : "awaiting-user-acceptance";
  const command = state === "mount-ready"
    ? "mount-artifact-filesystem"
    : state === "sync-required"
      ? externalHandoff.requiredNextCommand
      : state === "retry-scheduled"
        ? "retry"
        : acceptance.state === "acceptable"
          ? "accept-preview"
          : lifecycle.nextAction.command;

  return {
    format: "working-directory-lease.workflow-handoff.v1",
    state,
    route: clientRuntime.route || preview.route,
    returnRoute: clientRuntime.returnRoute,
    request: {
      requestId: clientRuntime.requestId || preview.requestId,
      sessionId: clientRuntime.sessionId,
      actorId: clientRuntime.actorId,
      intent: clientRuntime.intent,
      operation: clientRuntime.operation,
      activeView: clientRuntime.activeView,
      clientRevision: clientRuntime.clientRevision
    },
    command,
    dueAt: retryPolicy.nextAttemptAt || lifecycle.nextAction.dueAt,
    visibleSummary: preview.summary,
    blockers,
    pendingClientState: {
      pendingWriteCount: clientRuntime.pendingWrites.length,
      dirtyArtifactIds: clientRuntime.dirtyArtifactIds,
      selectedArtifactIds: clientRuntime.selectedArtifactIds,
      optimisticLock: clientRuntime.optimisticLock,
      writeAdmissionState: writeAdmission.state,
      admittedWriteCount: writeAdmission.batch.admittedCount
    },
    tenantBoundary: {
      tenantId: tenantAccess.tenantId,
      workspaceId: tenantAccess.workspaceId,
      actorId: tenantAccess.actorId,
      state: tenantAccess.state,
      allowedOperations: tenantAccess.allowedOperations,
      deniedOperations: tenantAccess.deniedOperations,
      deniedReasons: tenantAccess.permissionMatrix.deniedReasons
    },
    handoffPayload: {
      token: clientRuntime.handoffToken,
      leaseId: health.writable ? externalHandoff.transferable.leaseId : null,
      mountId: externalHandoff.transferable.mountId,
      localCheckpoint: externalHandoff.transferable.localCheckpoint,
      generation: externalHandoff.transferable.generation
    },
    writeAdmission: {
      state: writeAdmission.state,
      admitted: writeAdmission.admitted,
      blockers: writeAdmission.blockers,
      nextCommand: writeAdmission.nextCommand
    },
    operationalIncident: {
      state: operationalIncident.state,
      severity: operationalIncident.severity,
      nextCommand: operationalIncident.nextCommand,
      retryAt: operationalIncident.retryAt
    },
    userVisible: clientRuntime.requiresUserVisibleHandoff
  };
}

function buildPreviewContract({ lease, health, lifecycle, degradedMode, validationSummary, externalHandoff, acceptanceInput, now }) {
  const writeMode = health.writable ? "writable" : "read-only";
  const readinessLabel = health.status === "healthy"
    ? "Ready"
    : health.status === "degraded"
      ? "Needs attention"
      : "Blocked";

  return {
    format: "working-directory-lease.preview.v1",
    generatedAt: now,
    route: acceptanceInput.clientRoute,
    requestId: acceptanceInput.clientRequestId,
    title: "Working directory lease",
    readinessLabel,
    summary: `${readinessLabel}: ${writeMode} lease for ${lease.workdir || "unassigned working directory"}.`,
    leaseIdentity: {
      leaseId: lease.leaseId,
      ownerId: lease.ownerId,
      workdir: lease.workdir,
      artifactRoot: lease.artifactRoot
    },
    visibleState: {
      healthStatus: health.status,
      writeMode,
      expiresAt: lease.expiresAt,
      msUntilExpiry: health.msUntilExpiry,
      renewalRequired: health.renewalRequired,
      degradedReason: degradedMode.enabled ? degradedMode.reason : null,
      handoffState: externalHandoff.state
    },
    badges: uniqueStrings([
      health.writable ? "writes-enabled" : "writes-blocked",
      health.renewalRequired ? "renewal-due" : null,
      degradedMode.enabled ? "degraded" : null,
      externalHandoff.enabled ? `handoff-${externalHandoff.state}` : "handoff-blocked",
      validationSummary.status === "pass" ? "validated" : "validation-blocked"
    ]),
    primaryCommand: lifecycle.nextAction.command,
    primaryCommandDueAt: lifecycle.nextAction.dueAt
  };
}

function buildAcceptanceContract({ acceptanceInput, health, validationSummary, externalHandoff, nowMs, now }) {
  const acceptedAtMs = asTimestamp(acceptanceInput.acceptedAt, null);
  const blockers = uniqueStrings([
    validationSummary.status !== "pass" ? "VALIDATION_BLOCKED" : null,
    acceptanceInput.requirePreviewAcknowledgement && !acceptanceInput.previewAcknowledged
      ? "PREVIEW_ACKNOWLEDGEMENT_REQUIRED"
      : null,
    acceptanceInput.requireWritableLease && !health.writable ? "WRITABLE_LEASE_REQUIRED" : null,
    acceptanceInput.requireExternalHandoffReady && !(externalHandoff.enabled && externalHandoff.state === "ready")
      ? "EXTERNAL_HANDOFF_NOT_READY"
      : null,
    health.status === "degraded" && !acceptanceInput.allowDegradedAcceptance ? "DEGRADED_ACCEPTANCE_DISABLED" : null,
    health.status === "unhealthy" ? "UNHEALTHY_LEASE" : null,
    acceptedAtMs && acceptedAtMs > nowMs ? "ACCEPTED_AT_IN_FUTURE" : null
  ]);

  return {
    format: "working-directory-lease.acceptance.v1",
    state: blockers.length === 0 ? "acceptable" : "blocked",
    accepted: blockers.length === 0 && Boolean(acceptanceInput.acceptedBy),
    acceptedBy: blockers.length === 0 ? acceptanceInput.acceptedBy : null,
    acceptedAt: blockers.length === 0 && acceptedAtMs ? new Date(acceptedAtMs).toISOString() : null,
    requestedBy: acceptanceInput.requestedBy,
    evaluatedAt: now,
    policy: {
      requirePreviewAcknowledgement: acceptanceInput.requirePreviewAcknowledgement,
      allowDegradedAcceptance: acceptanceInput.allowDegradedAcceptance,
      requireExternalHandoffReady: acceptanceInput.requireExternalHandoffReady,
      requireWritableLease: acceptanceInput.requireWritableLease
    },
    blockers
  };
}

function buildReadinessContract({
  preview,
  acceptance,
  lifecycle,
  retryPolicy,
  validationSummary,
  externalHandoff,
  recovery,
  tenantAccess,
  writeAdmission
}) {
  const recoveryCommand = recovery.requiredRecoveryCommands[0] || null;
  const writeCommand = writeAdmission.state === "blocked" ? writeAdmission.nextCommand : null;
  const stage = acceptance.accepted
    ? tenantAccess.state === "blocked" || tenantAccess.state === "permission-denied"
      ? "tenant-permission-blocked"
      : writeAdmission.state === "blocked"
      ? "write-admission-blocked"
      : recovery.restartSafeStatus === "idempotent-replay"
      ? "return-persisted-result"
      : recovery.restartSafeStatus === "stable"
      ? "accepted"
      : "recover-before-mount"
    : acceptance.state === "acceptable"
      ? "awaiting-acceptance"
      : validationSummary.status !== "pass"
        ? "fix-validation"
        : recovery.restartSafeStatus === "blocked"
          ? "recover-persisted-state"
          : recoveryCommand
            ? "recover-before-acceptance"
        : externalHandoff.requiredNextCommand
          ? "sync-handoff"
          : lifecycle.nextAction.command === "retry"
            ? "retry-scheduled"
            : "operator-action";

  return {
    format: "working-directory-lease.readiness.v1",
    ready: acceptance.accepted
      && preview.visibleState.healthStatus !== "unhealthy"
      && recovery.restartSafeStatus === "stable"
      && tenantAccess.permissions.canHandoff
      && writeAdmission.state !== "blocked",
    stage,
    userVisibleStatus: preview.readinessLabel,
    routeCommand: writeCommand || recoveryCommand || (acceptance.accepted ? "mount-artifact-filesystem" : lifecycle.nextAction.command),
    dueAt: recovery.resumeAfter || lifecycle.nextAction.dueAt || retryPolicy.nextAttemptAt,
    validationStatus: validationSummary.status,
    handoffState: externalHandoff.state,
    tenantAccessState: tenantAccess.state,
    restartSafeStatus: recovery.restartSafeStatus,
    canProceed: acceptance.accepted
      && recovery.restartSafeStatus === "stable"
      && tenantAccess.permissions.canHandoff
      && writeAdmission.state !== "blocked",
    nextStep: {
      command: acceptance.accepted
        ? tenantAccess.permissions.canHandoff
          ? writeCommand || recoveryCommand || "mount-artifact-filesystem"
          : "resolve-tenant-permissions"
        : externalHandoff.requiredNextCommand || lifecycle.nextAction.command,
      reason: tenantAccess.state === "blocked" || tenantAccess.state === "permission-denied"
        ? "TENANT_PERMISSION_DENIED"
        : writeAdmission.state === "blocked"
          ? writeAdmission.blockers[0] || "WRITE_ADMISSION_BLOCKED"
          : recoveryCommand || acceptance.blockers[0] || externalHandoff.blockedReason || lifecycle.nextAction.reason,
      retryable: retryPolicy.retryable
    }
  };
}

function buildRoutePreviewDecisionContract({
  preview,
  acceptance,
  readiness,
  validation,
  validationSummary,
  lifecycle,
  workflowHandoff,
  providerServiceAdmission,
  writeAdmission,
  tenantAccess,
  recovery,
  retryPolicy,
  externalHandoff,
  operationalIncident,
  now
}) {
  const blockingIssues = validation.errors.map((error) => ({
    code: error.code,
    field: error.field,
    message: error.message,
    routeAction: error.code === "LEASE_EXPIRED"
      ? "request-replacement-lease"
      : error.code === "WORKDIR_OUTSIDE_ROOT" || error.code === "CLIENT_WORKSPACE_OUTSIDE_ROOT"
        ? "select-contained-workdir"
        : "correct-lease-input"
  }));
  const warningIssues = validation.warnings.map((warning) => ({
    code: warning.code,
    field: warning.field,
    message: warning.message,
    routeAction: warning.code.includes("MISSING") || warning.code.includes("UNSPECIFIED")
      ? "collect-missing-metadata"
      : "continue-with-attention"
  }));
  const acceptanceCta = acceptance.accepted
    ? "accepted"
    : acceptance.state === "acceptable"
      ? "accept-preview"
      : acceptance.blockers.includes("PREVIEW_ACKNOWLEDGEMENT_REQUIRED")
        ? "acknowledge-preview"
        : acceptance.blockers.includes("EXTERNAL_HANDOFF_NOT_READY")
          ? externalHandoff.requiredNextCommand || "prepare-handoff"
          : readiness.nextStep.command;
  const routeState = readiness.ready
    ? "ready"
    : retryPolicy.retryable
      ? "retry"
      : blockingIssues.length > 0 || acceptance.state === "blocked"
        ? "blocked"
        : "needs-user-action";

  return {
    format: "working-directory-lease.route-preview-decision.v1",
    generatedAt: now,
    route: preview.route || workflowHandoff.route,
    requestId: preview.requestId || workflowHandoff.request.requestId,
    state: routeState,
    title: preview.title,
    summary: preview.summary,
    statusLine: readiness.ready
      ? "Lease accepted and ready to mount."
      : acceptance.state === "acceptable"
        ? "Lease preview is ready for user acceptance."
        : validationSummary.status !== "pass"
          ? "Lease preview is blocked by validation."
          : "Lease preview needs a follow-up action.",
    display: {
      readinessLabel: preview.readinessLabel,
      badges: preview.badges,
      healthStatus: preview.visibleState.healthStatus,
      handoffState: preview.visibleState.handoffState,
      expiresAt: preview.visibleState.expiresAt,
      renewalRequired: preview.visibleState.renewalRequired
    },
    acceptance: {
      state: acceptance.state,
      accepted: acceptance.accepted,
      cta: acceptanceCta,
      blockers: acceptance.blockers,
      policy: acceptance.policy
    },
    validation: {
      status: validationSummary.status,
      blockingCount: validationSummary.blockingCount,
      warningCount: validationSummary.warningCount,
      blockingIssues,
      warningIssues,
      capabilityMissing: validationSummary.capabilityNegotiation.missing
    },
    readiness: {
      ready: readiness.ready,
      stage: readiness.stage,
      routeCommand: readiness.routeCommand,
      dueAt: readiness.dueAt,
      nextStep: readiness.nextStep
    },
    integrations: {
      workflowState: workflowHandoff.state,
      providerAdmissionState: providerServiceAdmission.state,
      providerNextCommand: providerServiceAdmission.nextCommand,
      writeAdmissionState: writeAdmission.state,
      writeNextCommand: writeAdmission.nextCommand,
      operationalIncidentState: operationalIncident.state,
      operationalIncidentSeverity: operationalIncident.severity,
      operationalIncidentCommand: operationalIncident.nextCommand,
      tenantAccessState: tenantAccess.state,
      restartSafeStatus: recovery.restartSafeStatus,
      lifecycleNextCommand: lifecycle.nextAction.command
    },
    routePayload: {
      command: readiness.ready ? "mount-artifact-filesystem" : acceptanceCta,
      leaseId: workflowHandoff.handoffPayload.leaseId,
      mountId: workflowHandoff.handoffPayload.mountId,
      localCheckpoint: workflowHandoff.handoffPayload.localCheckpoint,
      generation: workflowHandoff.handoffPayload.generation,
      retryAt: retryPolicy.nextAttemptAt
    }
  };
}

function buildClientWorkflowRuntimeHandoff({
  clientRuntime,
  providerOperation,
  providerServiceAdmission,
  routePreviewDecision,
  readiness,
  workflowHandoff,
  recovery,
  writeAdmission,
  tenantAccess,
  lifecycle,
  retryPolicy,
  now
}) {
  const blocked = routePreviewDecision.state === "blocked" || workflowHandoff.state === "blocked";
  const retryScheduled = routePreviewDecision.state === "retry" || workflowHandoff.state === "retry-scheduled";
  const resumable = Boolean(clientRuntime.handoffToken)
    && recovery.restartSafeStatus !== "blocked"
    && tenantAccess.state !== "blocked"
    && tenantAccess.state !== "permission-denied";
  const dispatchCommand = blocked
    ? routePreviewDecision.acceptance.cta || readiness.nextStep.command
    : retryScheduled
      ? "schedule-client-runtime-retry"
      : readiness.ready
        ? "mount-artifact-filesystem"
        : routePreviewDecision.routePayload.command || workflowHandoff.command;
  const routeState = blocked
    ? "show-blocked-handoff"
    : retryScheduled
      ? "show-retry-pending"
      : readiness.ready
        ? "handoff-ready"
        : workflowHandoff.state === "sync-required"
          ? "show-sync-required"
          : "show-preview";
  const statePatch = {
    requestId: clientRuntime.requestId || providerOperation.requestId || routePreviewDecision.requestId,
    sessionId: clientRuntime.sessionId,
    actorId: clientRuntime.actorId,
    route: routePreviewDecision.route || workflowHandoff.route,
    returnRoute: workflowHandoff.returnRoute,
    activeView: clientRuntime.activeView,
    intent: clientRuntime.intent,
    operation: clientRuntime.operation,
    revision: clientRuntime.clientRevision + 1,
    optimisticLock: clientRuntime.optimisticLock,
    handoffToken: clientRuntime.handoffToken,
    handoffState: workflowHandoff.state,
    readinessStage: readiness.stage,
    providerAdmissionState: providerServiceAdmission.state,
    writeAdmissionState: writeAdmission.state,
    tenantAccessState: tenantAccess.state,
    restartSafeStatus: recovery.restartSafeStatus,
    nextCommand: dispatchCommand,
    retryAt: retryPolicy.nextAttemptAt,
    updatedAt: now
  };

  return {
    format: "working-directory-lease.client-workflow-runtime-handoff.v1",
    state: routeState,
    ready: readiness.ready && workflowHandoff.state === "mount-ready",
    resumable,
    dispatch: {
      command: dispatchCommand,
      dueAt: retryPolicy.nextAttemptAt || readiness.dueAt || lifecycle.nextAction.dueAt,
      idempotencyKey: recovery.idempotency.replayKey || providerOperation.idempotencyKey,
      requiresUserVisibleHandoff: workflowHandoff.userVisible,
      reason: blocked
        ? routePreviewDecision.readiness.nextStep.reason
        : retryScheduled
          ? "RETRY_SCHEDULED"
          : readiness.nextStep.reason || "CLIENT_HANDOFF_READY"
    },
    navigation: {
      route: statePatch.route,
      returnRoute: statePatch.returnRoute,
      activeView: statePatch.activeView,
      routeState,
      routePayload: routePreviewDecision.routePayload
    },
    persist: {
      required: resumable || workflowHandoff.pendingClientState.pendingWriteCount > 0 || retryScheduled,
      key: uniqueStrings([
        statePatch.sessionId,
        statePatch.requestId,
        clientRuntime.handoffToken,
        providerOperation.requestId
      ]).join(":") || null,
      statePatch
    },
    handoffPayload: workflowHandoff.handoffPayload,
    blockers: uniqueStrings([
      ...workflowHandoff.blockers,
      ...routePreviewDecision.validation.blockingIssues.map((issue) => issue.code),
      providerServiceAdmission.admitted ? null : providerServiceAdmission.blockers[0],
      writeAdmission.state === "blocked" ? writeAdmission.blockers[0] : null
    ]),
    proof: {
      requestId: statePatch.requestId,
      sessionId: statePatch.sessionId,
      clientRevisionFrom: clientRuntime.clientRevision,
      clientRevisionTo: statePatch.revision,
      providerOperation: providerOperation.operation,
      providerAdmissionState: providerServiceAdmission.state,
      workflowState: workflowHandoff.state,
      readinessStage: readiness.stage,
      routeDecisionState: routePreviewDecision.state
    }
  };
}

function buildRouteAcceptanceReceiptContract({
  routePreviewDecision,
  clientWorkflowRuntimeHandoff,
  acceptance,
  readiness,
  workflowHandoff,
  providerHandoffCommit,
  tenantAuditHandoff,
  validationSummary,
  recovery,
  writeAdmission,
  operationalIncident,
  now
}) {
  const accepted = acceptance.accepted && readiness.ready && clientWorkflowRuntimeHandoff.ready;
  const checklist = [
    {
      id: "preview-acknowledged",
      label: "Preview acknowledged",
      ready: !acceptance.policy.requirePreviewAcknowledgement
        || !acceptance.blockers.includes("PREVIEW_ACKNOWLEDGEMENT_REQUIRED"),
      blocker: acceptance.blockers.includes("PREVIEW_ACKNOWLEDGEMENT_REQUIRED")
        ? "PREVIEW_ACKNOWLEDGEMENT_REQUIRED"
        : null
    },
    {
      id: "validation-passed",
      label: "Validation passed",
      ready: validationSummary.status === "pass",
      blocker: validationSummary.status === "pass" ? null : validationSummary.blockingCodes[0] || "VALIDATION_BLOCKED"
    },
    {
      id: "provider-handoff-claimed",
      label: "Provider handoff claimed",
      ready: providerHandoffCommit.ready || providerHandoffCommit.replayed || workflowHandoff.handoffPayload.leaseId !== null,
      blocker: providerHandoffCommit.blockers[0] || null
    },
    {
      id: "tenant-audit-routable",
      label: "Tenant audit routable",
      ready: !tenantAuditHandoff.required || Boolean(tenantAuditHandoff.sink || tenantAuditHandoff.routingKey),
      blocker: tenantAuditHandoff.required && !tenantAuditHandoff.sink && !tenantAuditHandoff.routingKey
        ? "TENANT_AUDIT_HANDOFF_TARGET_MISSING"
        : null
    },
    {
      id: "restart-safe",
      label: "Restart safe",
      ready: recovery.restartSafeStatus === "stable" || recovery.restartSafeStatus === "idempotent-replay",
      blocker: recovery.restartSafeStatus === "blocked" ? "RECOVERY_BLOCKED" : null
    },
    {
      id: "writes-admitted",
      label: "Writes admitted",
      ready: writeAdmission.state !== "blocked",
      blocker: writeAdmission.blockers[0] || null
    },
    {
      id: "incident-clear",
      label: "Operational incident clear",
      ready: !operationalIncident.circuitBreaker.blockProviderAdmission && !operationalIncident.circuitBreaker.blockWrites,
      blocker: operationalIncident.circuitBreaker.blockedCommands[0]
        ? `OPERATIONAL_INCIDENT_BLOCKS_${operationalIncident.circuitBreaker.blockedCommands[0].toUpperCase()}`
        : null
    }
  ];
  const blockers = uniqueStrings(checklist.filter((item) => !item.ready).map((item) => item.blocker));
  const receiptState = accepted
    ? "accepted"
    : blockers.length
      ? "blocked"
      : acceptance.state === "acceptable"
        ? "awaiting-acceptance"
        : "preview";

  return {
    format: "working-directory-lease.route-acceptance-receipt.v1",
    generatedAt: now,
    state: receiptState,
    accepted,
    receiptId: uniqueStrings([
      routePreviewDecision.requestId,
      routePreviewDecision.routePayload.leaseId,
      workflowHandoff.handoffPayload.localCheckpoint,
      clientWorkflowRuntimeHandoff.dispatch.idempotencyKey
    ]).join(":") || null,
    route: {
      href: routePreviewDecision.route,
      command: routePreviewDecision.routePayload.command,
      state: routePreviewDecision.state,
      dispatchCommand: clientWorkflowRuntimeHandoff.dispatch.command,
      dueAt: clientWorkflowRuntimeHandoff.dispatch.dueAt
    },
    acceptance: {
      acceptedBy: acceptance.acceptedBy,
      acceptedAt: acceptance.acceptedAt,
      requestedBy: acceptance.requestedBy,
      policy: acceptance.policy,
      blockers: acceptance.blockers
    },
    checklist,
    blockers,
    handoffClaim: {
      state: providerHandoffCommit.state,
      ready: providerHandoffCommit.ready,
      replayed: providerHandoffCommit.replayed,
      idempotencyKey: providerHandoffCommit.commit.idempotencyKey,
      resultRef: providerHandoffCommit.commit.resultRef,
      externalStatePatchReady: Boolean(providerHandoffCommit.externalStatePatch)
    },
    clientStatePatch: clientWorkflowRuntimeHandoff.persist.statePatch,
    nextStep: {
      command: accepted
        ? "mount-artifact-filesystem"
        : blockers.includes("RECOVERY_BLOCKED")
          ? recovery.requiredRecoveryCommands[0] || "recover-persisted-state"
          : routePreviewDecision.acceptance.cta || readiness.nextStep.command,
      reason: blockers[0] || readiness.nextStep.reason || "ACCEPTANCE_READY",
      routePayload: routePreviewDecision.routePayload
    }
  };
}

function normalizeOperationalHealthInput(input, nowMs) {
  const healthInput = input.operationalHealth && typeof input.operationalHealth === "object"
    ? input.operationalHealth
    : input.runtimeHealth && typeof input.runtimeHealth === "object"
      ? input.runtimeHealth
      : {};
  const probesInput = healthInput.probes && typeof healthInput.probes === "object" ? healthInput.probes : {};
  const heartbeatAtMs = asTimestamp(
    healthInput.lastHeartbeatAt || healthInput.heartbeatAt || probesInput.kernelHeartbeat?.observedAt,
    null
  );
  const writeAtMs = asTimestamp(healthInput.lastSuccessfulWriteAt || probesInput.lastWrite?.observedAt, null);
  const renewalAtMs = asTimestamp(healthInput.lastSuccessfulRenewalAt || probesInput.lastRenewal?.observedAt, null);

  return {
    format: "working-directory-lease.operational-health-input.v1",
    mode: asString(healthInput.mode) || "hosted-kernel",
    observedAtMs: asTimestamp(healthInput.observedAt || input.healthObservedAt, nowMs),
    artifactRootReachable: asBoolean(
      healthInput.artifactRootReachable ?? probesInput.artifactRoot?.ok,
      null
    ),
    workdirReachable: asBoolean(healthInput.workdirReachable ?? probesInput.workdir?.ok, null),
    lockStoreReachable: asBoolean(healthInput.lockStoreReachable ?? probesInput.lockStore?.ok, null),
    kernelHeartbeatFresh: asBoolean(healthInput.kernelHeartbeatFresh ?? probesInput.kernelHeartbeat?.fresh, null),
    lastHeartbeatAtMs: heartbeatAtMs,
    lastSuccessfulWriteAtMs: writeAtMs,
    lastSuccessfulRenewalAtMs: renewalAtMs,
    consecutiveFailures: asNonNegativeInteger(healthInput.consecutiveFailures, 0),
    maxHeartbeatAgeMs: asPositiveInteger(healthInput.maxHeartbeatAgeMs, 45 * 1000),
    maxWriteSilenceMs: asPositiveInteger(healthInput.maxWriteSilenceMs, DEFAULT_LEASE_TTL_MS),
    readonlyFallbackAllowed: asBoolean(healthInput.readonlyFallbackAllowed, true),
    recoveryHint: asString(healthInput.recoveryHint),
    operatorRunbook: asString(healthInput.operatorRunbook)
  };
}

function buildOperationalHealthContract({ input, lease, telemetry, nowMs, now }) {
  const validation = { errors: [], warnings: [] };
  const probe = ({ name, ok, missingCode, failedCode, failedMessage, degradedMessage, observedAtMs }) => {
    const ageMs = observedAtMs ? Math.max(0, nowMs - observedAtMs) : null;
    if (ok === false) {
      validation.errors.push({
        code: failedCode,
        field: `operationalHealth.${name}`,
        message: failedMessage
      });
      return { name, status: "failed", observedAt: observedAtMs ? new Date(observedAtMs).toISOString() : now, ageMs };
    }
    if (ok === null) {
      validation.warnings.push({
        code: missingCode,
        field: `operationalHealth.${name}`,
        message: degradedMessage
      });
      return { name, status: "unknown", observedAt: observedAtMs ? new Date(observedAtMs).toISOString() : null, ageMs };
    }
    return { name, status: "ok", observedAt: observedAtMs ? new Date(observedAtMs).toISOString() : now, ageMs };
  };

  const probes = [
    probe({
      name: "artifactRootReachable",
      ok: telemetry.artifactRootReachable,
      missingCode: "ARTIFACT_ROOT_HEALTH_UNKNOWN",
      failedCode: "ARTIFACT_ROOT_UNREACHABLE",
      failedMessage: "The hosted-kernel artifact root cannot be reached for this lease.",
      degradedMessage: "Artifact root reachability was not supplied, so filesystem health proof is incomplete.",
      observedAtMs: telemetry.observedAtMs
    }),
    probe({
      name: "workdirReachable",
      ok: telemetry.workdirReachable,
      missingCode: "WORKDIR_HEALTH_UNKNOWN",
      failedCode: "WORKDIR_UNREACHABLE",
      failedMessage: "The leased working directory cannot be reached by the hosted kernel.",
      degradedMessage: "Working-directory reachability was not supplied, so write readiness is degraded.",
      observedAtMs: telemetry.observedAtMs
    }),
    probe({
      name: "lockStoreReachable",
      ok: telemetry.lockStoreReachable,
      missingCode: "LOCK_STORE_HEALTH_UNKNOWN",
      failedCode: "LEASE_LOCK_STORE_UNREACHABLE",
      failedMessage: "The lease lock store is unreachable; renewal and release commands cannot be proven.",
      degradedMessage: "Lock store reachability was not supplied, so renewal authority is degraded.",
      observedAtMs: telemetry.observedAtMs
    })
  ];

  const heartbeatAgeMs = telemetry.lastHeartbeatAtMs ? Math.max(0, nowMs - telemetry.lastHeartbeatAtMs) : null;
  const heartbeatFresh = telemetry.kernelHeartbeatFresh === false
    || (heartbeatAgeMs !== null && heartbeatAgeMs > telemetry.maxHeartbeatAgeMs)
    ? false
    : telemetry.kernelHeartbeatFresh;
  probes.push(probe({
    name: "kernelHeartbeat",
    ok: heartbeatFresh,
    missingCode: "KERNEL_HEARTBEAT_UNKNOWN",
    failedCode: "KERNEL_HEARTBEAT_STALE",
    failedMessage: "The hosted-kernel heartbeat is stale for this working-directory lease.",
    degradedMessage: "No hosted-kernel heartbeat timestamp was supplied for lease health proof.",
    observedAtMs: telemetry.lastHeartbeatAtMs
  }));

  const writeSilenceMs = telemetry.lastSuccessfulWriteAtMs ? Math.max(0, nowMs - telemetry.lastSuccessfulWriteAtMs) : null;
  if (writeSilenceMs !== null && writeSilenceMs > telemetry.maxWriteSilenceMs) {
    validation.warnings.push({
      code: "LEASE_WRITE_SILENCE_EXCEEDED",
      field: "operationalHealth.lastSuccessfulWriteAt",
      message: "No successful artifact write has been observed within the configured write silence window."
    });
  }
  if (telemetry.consecutiveFailures > 0) {
    validation.warnings.push({
      code: "LEASE_OPERATION_FAILURES_RECORDED",
      field: "operationalHealth.consecutiveFailures",
      message: "Recent working-directory lease operations have failed and should be considered in retry planning."
    });
  }

  const hardFailureCodes = validation.errors.map((error) => error.code);
  const state = hardFailureCodes.length > 0
    ? telemetry.readonlyFallbackAllowed ? "degraded-readonly" : "unhealthy"
    : validation.warnings.length > 0
      ? "degraded"
      : "healthy";
  const recoveryCommands = uniqueStrings([
    hardFailureCodes.includes("ARTIFACT_ROOT_UNREACHABLE") ? "remount-artifact-root" : null,
    hardFailureCodes.includes("WORKDIR_UNREACHABLE") ? "recreate-working-directory" : null,
    hardFailureCodes.includes("LEASE_LOCK_STORE_UNREACHABLE") ? "reconnect-lease-lock-store" : null,
    hardFailureCodes.includes("KERNEL_HEARTBEAT_STALE") ? "restart-hosted-kernel-heartbeat" : null,
    telemetry.consecutiveFailures > 0 ? "drain-and-retry-lease-operations" : null,
    telemetry.recoveryHint
  ]);

  return {
    format: "working-directory-lease.operational-health.v1",
    mode: telemetry.mode,
    state,
    observedAt: new Date(telemetry.observedAtMs).toISOString(),
    leaseIdentity: {
      leaseId: lease.leaseId,
      ownerId: lease.ownerId,
      workdir: lease.workdir,
      artifactRoot: lease.artifactRoot
    },
    probes,
    heartbeat: {
      lastHeartbeatAt: telemetry.lastHeartbeatAtMs ? new Date(telemetry.lastHeartbeatAtMs).toISOString() : null,
      ageMs: heartbeatAgeMs,
      maxAgeMs: telemetry.maxHeartbeatAgeMs,
      fresh: heartbeatFresh !== false
    },
    recentActivity: {
      lastSuccessfulWriteAt: telemetry.lastSuccessfulWriteAtMs
        ? new Date(telemetry.lastSuccessfulWriteAtMs).toISOString()
        : null,
      writeSilenceMs,
      lastSuccessfulRenewalAt: telemetry.lastSuccessfulRenewalAtMs
        ? new Date(telemetry.lastSuccessfulRenewalAtMs).toISOString()
        : null,
      consecutiveFailures: telemetry.consecutiveFailures
    },
    readonlyFallback: {
      allowed: telemetry.readonlyFallbackAllowed,
      active: state === "degraded-readonly"
    },
    failureCode: hardFailureCodes[0] || null,
    retryAfterMs: telemetry.consecutiveFailures > 0
      ? Math.min(DEFAULT_MAX_BACKOFF_MS, DEFAULT_BASE_BACKOFF_MS * 2 ** Math.min(6, telemetry.consecutiveFailures))
      : null,
    recoveryCommands,
    operatorRunbook: telemetry.operatorRunbook,
    validation
  };
}

function buildOperationalIncidentContract({ operationalHealth, retryPolicy, lease, nowMs, now }) {
  const failedProbes = operationalHealth.probes.filter((probe) => probe.status === "failed");
  const unknownProbes = operationalHealth.probes.filter((probe) => probe.status === "unknown");
  const active = failedProbes.length > 0
    || operationalHealth.recentActivity.consecutiveFailures > 0
    || operationalHealth.state !== "healthy";
  const severity = failedProbes.length > 0 && !operationalHealth.readonlyFallback.allowed
    ? "critical"
    : failedProbes.length > 0 || operationalHealth.recentActivity.consecutiveFailures >= 3
      ? "warning"
      : unknownProbes.length > 0
        ? "notice"
        : "normal";
  const blockedCommands = uniqueStrings([
    operationalHealth.readonlyFallback.active ? "write" : null,
    operationalHealth.readonlyFallback.active ? "mount-artifact-filesystem:writable" : null,
    failedProbes.some((probe) => probe.name === "lockStoreReachable") ? "renew" : null,
    failedProbes.some((probe) => probe.name === "lockStoreReachable") ? "release" : null,
    failedProbes.some((probe) => probe.name === "kernelHeartbeat") && !operationalHealth.readonlyFallback.allowed
      ? "provider-admission"
      : null
  ]);
  const remediation = uniqueStrings([
    ...operationalHealth.recoveryCommands,
    failedProbes.length > 0 && operationalHealth.readonlyFallback.active ? "serve-readonly-fallback" : null,
    retryPolicy.retryable ? "retry-after-backoff" : null,
    !retryPolicy.retryable && active ? "operator-review-required" : null
  ]);
  const incidentId = active
    ? uniqueStrings([
      lease.leaseId || "missing-lease",
      operationalHealth.failureCode || operationalHealth.state,
      String(nowMs)
    ]).join(":")
    : null;

  return {
    format: "working-directory-lease.operational-incident.v1",
    active,
    incidentId,
    state: !active
      ? "clear"
      : operationalHealth.readonlyFallback.active
        ? "read-only-fallback"
        : retryPolicy.retryable
          ? "retry-scheduled"
          : severity === "critical"
            ? "operator-required"
            : "degraded",
    severity,
    openedAt: active ? now : null,
    failureCode: operationalHealth.failureCode,
    failedProbes: failedProbes.map((probe) => probe.name),
    unknownProbes: unknownProbes.map((probe) => probe.name),
    impact: {
      writes: operationalHealth.readonlyFallback.active || severity === "critical" ? "blocked" : "allowed",
      renewals: blockedCommands.includes("renew") ? "blocked" : "allowed",
      releases: blockedCommands.includes("release") ? "blocked" : "allowed",
      providerAdmission: blockedCommands.includes("provider-admission") ? "blocked" : "allowed"
    },
    circuitBreaker: {
      active: blockedCommands.length > 0,
      blockedCommands,
      blockWrites: blockedCommands.includes("write"),
      blockProviderAdmission: blockedCommands.includes("provider-admission"),
      allowReadOnlyMount: operationalHealth.readonlyFallback.active
    },
    remediation,
    nextCommand: remediation[0] || (retryPolicy.retryable ? "retry" : null),
    retryAt: retryPolicy.retryable ? retryPolicy.nextAttemptAt : null,
    runbook: operationalHealth.operatorRunbook,
    proof: {
      leaseId: lease.leaseId,
      ownerId: lease.ownerId,
      workdir: lease.workdir,
      observedHealthState: operationalHealth.state,
      consecutiveFailures: operationalHealth.recentActivity.consecutiveFailures,
      retryable: retryPolicy.retryable
    }
  };
}

export function describeWorkingDirectoryLeaseSurface(input = {}) {
  const nowMs = asTimestamp(input.now, Date.now());
  const now = new Date(nowMs).toISOString();
  const leaseInput = input.lease && typeof input.lease === "object" ? input.lease : input;
  const rawLifecycleSettings = input.lifecycleSettings || input.settings || leaseInput.lifecycleSettings || leaseInput.settings;
  const acquiredAtMs = asTimestamp(leaseInput.acquiredAt, nowMs);
  const ttlMs = asPositiveInteger(leaseInput.ttlMs, DEFAULT_LEASE_TTL_MS);
  const expiresAtMs = asTimestamp(leaseInput.expiresAt, acquiredAtMs + ttlMs);
  const renewalMarginMs = asPositiveInteger(rawLifecycleSettings?.renewalMarginMs ?? input.renewalMarginMs, DEFAULT_RENEWAL_MARGIN_MS);
  const failureCode = asString(input.failureCode || leaseInput.failureCode);
  const retryAttempt = Number.isInteger(input.retryAttempt) && input.retryAttempt >= 0 ? input.retryAttempt : 0;
  const lease = {
    leaseId: asString(leaseInput.leaseId),
    ownerId: asString(leaseInput.ownerId),
    workdir: normalizeLeasePath(leaseInput.workdir),
    artifactRoot: normalizeLeasePath(leaseInput.artifactRoot),
    acquiredAt: new Date(acquiredAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    acquiredAtMs,
    expiresAtMs,
    ttlMs
  };
  const pathSafety = buildLeasePathSafety({ leaseInput, lease });
  const clientRuntime = normalizeClientRuntimeContract(input, lease);
  const tenantBoundary = normalizeTenantBoundaryContract(input, lease, clientRuntime);
  const lifecycleSettings = normalizeLifecycleSettings(rawLifecycleSettings, input);
  const lifecycleSettingsValidation = buildLifecycleSettingsValidation(lifecycleSettings, lease);
  const clientRuntimeValidation = buildClientRuntimeValidation(clientRuntime, lease);
  const tenantBoundaryValidation = buildTenantBoundaryValidation(tenantBoundary, lease);
  const persistedState = normalizePersistedLeaseState(input, lease, clientRuntime, nowMs, now);
  const persistedStateValidation = buildPersistedStateValidation(persistedState, lease, clientRuntime);
  const operationalTelemetry = normalizeOperationalHealthInput(input, nowMs);
  const operationalHealth = buildOperationalHealthContract({
    input,
    lease,
    telemetry: operationalTelemetry,
    nowMs,
    now
  });
  const validation = buildValidation(input, lease, pathSafety);
  validation.errors = validation.errors.concat(lifecycleSettingsValidation.errors);
  validation.warnings = validation.warnings.concat(lifecycleSettingsValidation.warnings);
  validation.errors = validation.errors.concat(clientRuntimeValidation.errors);
  validation.warnings = validation.warnings.concat(clientRuntimeValidation.warnings);
  validation.errors = validation.errors.concat(tenantBoundaryValidation.errors);
  validation.warnings = validation.warnings.concat(tenantBoundaryValidation.warnings);
  validation.errors = validation.errors.concat(persistedStateValidation.errors);
  validation.warnings = validation.warnings.concat(persistedStateValidation.warnings);
  validation.errors = validation.errors.concat(operationalHealth.validation.errors);
  validation.warnings = validation.warnings.concat(operationalHealth.validation.warnings);
  validation.ok = validation.errors.length === 0;
  const operationalErrorCodes = new Set(operationalHealth.validation.errors.map((error) => error.code));
  const onlyReadonlyOperationalFailures = operationalHealth.readonlyFallback.active
    && validation.errors.length > 0
    && validation.errors.every((error) => operationalErrorCodes.has(error.code));
  const msUntilExpiry = expiresAtMs - nowMs;
  const expired = msUntilExpiry <= 0;
  const renewalRequired = !expired && msUntilExpiry <= renewalMarginMs;
  const effectiveFailureCode = failureCode || operationalHealth.failureCode;
  const failureState = {
    active: Boolean(failureCode) || !validation.ok || expired,
    code: expired ? "LEASE_EXPIRED" : effectiveFailureCode || (validation.ok ? null : validation.errors[0].code),
    terminal: validation.errors.some((error) => TERMINAL_FAILURE_CODES.has(error.code))
      || TERMINAL_FAILURE_CODES.has(effectiveFailureCode),
    observedAt: now
  };
  const lifecyclePauseReason = !lifecycleSettings.enabled
    ? "LIFECYCLE_DISABLED"
    : !lifecycleSettings.writesEnabled
      ? "WRITES_DISABLED"
      : renewalRequired && !lifecycleSettings.renewalsEnabled
        ? "RENEWALS_DISABLED"
        : null;
  const degradedMode = {
    enabled: expired
      || renewalRequired
      || validation.warnings.length > 0
      || Boolean(lifecyclePauseReason)
      || operationalHealth.state !== "healthy"
      || onlyReadonlyOperationalFailures,
    reason: expired
      ? "LEASE_EXPIRED"
      : lifecyclePauseReason
        || (onlyReadonlyOperationalFailures ? "OPERATIONAL_READONLY_FALLBACK" : null)
        || (operationalHealth.state !== "healthy" ? operationalHealth.failureCode || "OPERATIONAL_HEALTH_DEGRADED" : null)
        || (renewalRequired ? "LEASE_RENEWAL_DUE" : validation.warnings[0]?.code || null),
    writable: validation.ok
      && !expired
      && lifecycleSettings.enabled
      && lifecycleSettings.writesEnabled
      && !operationalHealth.readonlyFallback.active,
    action: expired
      ? "Stop artifact writes and acquire a replacement working-directory lease."
      : lifecyclePauseReason === "LIFECYCLE_DISABLED"
        ? "Enable the working-directory lease lifecycle before accepting artifact filesystem work."
        : lifecyclePauseReason === "WRITES_DISABLED"
          ? "Enable writes before mounting writable artifact filesystem state."
          : lifecyclePauseReason === "RENEWALS_DISABLED"
            ? "Enable renewals or acquire a replacement lease before the renewal deadline."
      : onlyReadonlyOperationalFailures
        ? "Serve read-only artifact filesystem state while running operational recovery commands."
      : operationalHealth.state !== "healthy"
        ? "Run operational recovery commands and wait for hosted-kernel health probes to pass."
      : renewalRequired
        ? "Renew the lease before accepting additional artifact filesystem writes."
        : "Continue with restricted proof strength until missing lease metadata is supplied."
  };
  const retryPolicy = buildRetryPolicy({
    failureCode: failureState.code,
    attempt: retryAttempt,
    nowMs,
    retryAfterMs: input.retryAfterMs ?? operationalHealth.retryAfterMs
  });
  const operationalIncident = buildOperationalIncidentContract({
    operationalHealth,
    retryPolicy,
    lease,
    nowMs,
    now
  });
  const health = {
    status: (!validation.ok && !onlyReadonlyOperationalFailures) || expired || failureState.terminal
      ? "unhealthy"
      : degradedMode.enabled
        ? "degraded"
        : "healthy",
    writable: validation.ok
      && !expired
      && !failureState.terminal
      && lifecycleSettings.enabled
      && lifecycleSettings.writesEnabled
      && !operationalHealth.readonlyFallback.active,
    msUntilExpiry,
    renewalRequired,
    renewalDeadline: new Date(Math.max(acquiredAtMs, expiresAtMs - renewalMarginMs)).toISOString()
  };
  const lifecycleCommands = buildLifecycleCommands({
    settings: lifecycleSettings,
    validationOk: validation.ok,
    expired,
    renewalRequired,
    failureState
  });
  const lifecycle = {
    ...buildLifecycleState({
      lease,
      settings: lifecycleSettings,
      health,
      failureState,
      retryPolicy,
      nowMs,
      renewalMarginMs
    }),
    commands: lifecycleCommands,
    validation: lifecycleSettingsValidation
  };
  const lifecycleCommandControl = buildLifecycleCommandControl({
    settings: lifecycleSettings,
    lifecycleCommands,
    health,
    failureState,
    validation,
    retryPolicy,
    lease,
    nowMs,
    renewalMarginMs
  });
  lifecycle.commandControl = lifecycleCommandControl;
  const actionableErrors = buildActionableErrors(validation.errors, effectiveFailureCode, degradedMode);
  const proof = {
    surfaceId,
    checkedAt: now,
    leaseId: lease.leaseId,
    ownerId: lease.ownerId,
    workdir: lease.workdir,
    invariants: {
      hasIdentity: Boolean(lease.leaseId && lease.ownerId),
      pathContainedByArtifactRoot: pathSafety.containmentProven,
      leasePathsCanonicalized: pathSafety.canonicalized,
      leasePathTraversalRejected: !pathSafety.workdir.escapedAboveRoot && !pathSafety.artifactRoot.escapedAboveRoot,
      notExpired: !expired,
      validationOk: validation.ok,
      lifecycleEnabled: lifecycleSettings.enabled,
      writeCommandAllowed: lifecycleCommands.write.enabled,
      renewalCommandAllowed: lifecycleCommands.renew.enabled,
      requestedLifecycleCommandAccepted: lifecycleCommandControl.accepted || !lifecycleCommandControl.requestedCommand,
      schedulerConsistent: !lifecycleSettings.autoRenewEnabled
        || (lifecycleSettings.renewalsEnabled && lifecycleSettings.schedulerEnabled)
    },
    auditTrail: uniqueStrings([
      "working-directory-lease.health.evaluated",
      validation.ok ? "working-directory-lease.validation.passed" : "working-directory-lease.validation.failed",
      lifecycleSettingsValidation.ok
        ? "working-directory-lease.lifecycle-settings.validated"
        : "working-directory-lease.lifecycle-settings.rejected",
      lifecycleSettings.enabled
        ? "working-directory-lease.lifecycle.enabled"
        : "working-directory-lease.lifecycle.disabled",
      pathSafety.canonicalized ? "working-directory-lease.path-safety.canonicalized" : null,
      pathSafety.containmentProven
        ? "working-directory-lease.path-safety.contained"
        : "working-directory-lease.path-safety.not-contained",
      pathSafety.workdir.escapedAboveRoot || pathSafety.artifactRoot.escapedAboveRoot
        ? "working-directory-lease.path-safety.traversal-rejected"
        : null,
      `working-directory-lease.operational-health.${operationalHealth.state}`,
      lifecycle.schedule.enabled ? "working-directory-lease.scheduler.enabled" : null,
      lifecycle.nextAction.command ? `working-directory-lease.next-action.${lifecycle.nextAction.command}` : null,
      lifecycleCommandControl.requestedCommand
        ? `working-directory-lease.lifecycle-command.requested.${lifecycleCommandControl.requestedCommand}`
        : null,
      lifecycleCommandControl.accepted
        ? "working-directory-lease.lifecycle-command.accepted"
        : lifecycleCommandControl.requestedCommand
          ? "working-directory-lease.lifecycle-command.blocked"
          : null,
      health.status === "degraded" ? "working-directory-lease.degraded-mode.entered" : null,
      operationalIncident.active ? `working-directory-lease.operational-incident.${operationalIncident.state}` : null,
      operationalIncident.circuitBreaker.active ? "working-directory-lease.operational-incident.circuit-breaker-active" : null,
      retryPolicy.retryable ? "working-directory-lease.retry.scheduled" : null
    ])
  };
  const providerContract = normalizeProviderContract(input, lease);
  const capabilityNegotiation = buildCapabilityNegotiation({
    contract: providerContract,
    lifecycleCommands,
    health,
    failureState
  });
  const syncMetadata = buildSyncMetadata({
    contract: providerContract,
    lease,
    health,
    proof,
    now
  });
  const externalHandoff = buildExternalHandoffState({
    contract: providerContract,
    capabilityNegotiation,
    syncMetadata,
    lifecycle,
    health,
    failureState
  });
  const tenantAccess = buildTenantAccessContract({
    boundary: tenantBoundary,
    boundaryValidation: tenantBoundaryValidation,
    health,
    lifecycleCommands,
    externalHandoff
  });
  const providerOperation = normalizeProviderOperationRequest(input, providerContract);
  const providerServiceAdmission = buildProviderServiceAdmission({
    providerOperation,
    contract: providerContract,
    capabilityNegotiation,
    syncMetadata,
    externalHandoff,
    lifecycle,
    lifecycleCommandControl,
    health,
    failureState,
    tenantAccess,
    operationalIncident
  });
  const tenantAuditHandoff = buildTenantAuditHandoff({
    boundary: tenantBoundary,
    tenantAccess,
    providerOperation,
    providerServiceAdmission,
    clientRuntime,
    now
  });
  const recovery = buildRecoveryContract({
    persistedState,
    persistedStateValidation,
    health,
    failureState,
    lifecycle,
    retryPolicy,
    syncMetadata,
    now
  });
  const providerHandoffAcknowledgement = normalizeProviderHandoffAcknowledgement(
    input,
    providerOperation,
    syncMetadata
  );
  const providerHandoffCommit = buildProviderHandoffCommitContract({
    acknowledgement: providerHandoffAcknowledgement,
    contract: providerContract,
    providerOperation,
    providerServiceAdmission,
    externalHandoff,
    syncMetadata,
    recovery,
    health,
    nowMs,
    now
  });
  const writeIntent = normalizeWriteIntentContract(input, clientRuntime, lease);
  const writeAdmission = buildWriteAdmissionContract({
    writeIntent,
    lease,
    health,
    lifecycle,
    tenantAccess,
    recovery,
    externalHandoff,
    operationalIncident
  });
  const acceptanceInput = normalizeAcceptanceInput(input);
  const validationSummary = buildValidationSummary(validation, lifecycleSettingsValidation, capabilityNegotiation);
  const preview = buildPreviewContract({
    lease,
    health,
    lifecycle,
    degradedMode,
    validationSummary,
    externalHandoff,
    acceptanceInput,
    now
  });
  const acceptance = buildAcceptanceContract({
    acceptanceInput,
    health,
    validationSummary,
    externalHandoff,
    nowMs,
    now
  });
  const readiness = buildReadinessContract({
    preview,
    acceptance,
    lifecycle,
    retryPolicy,
    validationSummary,
    externalHandoff,
    recovery,
    tenantAccess,
    writeAdmission
  });
  const workflowHandoff = buildWorkflowHandoffContract({
    clientRuntime,
    preview,
    acceptance,
    externalHandoff,
    tenantAccess,
    writeAdmission,
    lifecycle,
    health,
    validationSummary,
    retryPolicy,
    operationalIncident
  });
  const routePreviewDecision = buildRoutePreviewDecisionContract({
    preview,
    acceptance,
    readiness,
    validation,
    validationSummary,
    lifecycle,
    workflowHandoff,
    providerServiceAdmission,
    writeAdmission,
    tenantAccess,
    recovery,
    retryPolicy,
    externalHandoff,
    operationalIncident,
    now
  });
  const clientWorkflowRuntimeHandoff = buildClientWorkflowRuntimeHandoff({
    clientRuntime,
    providerOperation,
    providerServiceAdmission,
    routePreviewDecision,
    readiness,
    workflowHandoff,
    recovery,
    writeAdmission,
    tenantAccess,
    lifecycle,
    retryPolicy,
    now
  });
  const routeAcceptanceReceipt = buildRouteAcceptanceReceiptContract({
    routePreviewDecision,
    clientWorkflowRuntimeHandoff,
    acceptance,
    readiness,
    workflowHandoff,
    providerHandoffCommit,
    tenantAuditHandoff,
    validationSummary,
    recovery,
    writeAdmission,
    operationalIncident,
    now
  });
  proof.provider = {
    providerId: providerContract.providerId,
    serviceId: providerContract.serviceId,
    protocol: providerContract.protocol,
    correlationId: providerContract.correlationId,
    capabilityNegotiationOk: capabilityNegotiation.ok,
    handoffState: externalHandoff.state,
    serviceAdmissionState: providerServiceAdmission.state,
    serviceAdmissionCommand: providerServiceAdmission.nextCommand,
    handoffCommitState: providerHandoffCommit.state,
    handoffCommitCommand: providerHandoffCommit.commit.command,
    handoffCommitReady: providerHandoffCommit.ready,
    handoffCommitBlockers: providerHandoffCommit.blockers,
    tenantAdmissionDecision: providerServiceAdmission.tenantProof?.decision || null,
    tenantAdmissionBlockers: providerServiceAdmission.tenantProof?.blockers || [],
    serviceOperation: providerOperation.operation,
    syncGeneration: syncMetadata.generation,
    localCheckpoint: syncMetadata.localCheckpoint,
    remoteCheckpoint: syncMetadata.remoteCheckpoint
  };
  proof.tenantBoundary = {
    tenantId: tenantBoundary.tenantId,
    expectedTenantId: tenantBoundary.expectedTenantId,
    workspaceId: tenantBoundary.workspaceId,
    workspacePath: tenantBoundary.workspacePath,
    scopeRoot: tenantBoundary.scopeRoot,
    isolationMode: tenantBoundary.isolationMode,
    accessState: tenantAccess.state,
    deniedOperations: tenantAccess.deniedOperations,
    deniedReasons: tenantAccess.permissionMatrix.deniedReasons,
    missingRoles: tenantAccess.permissionMatrix.missingRoles,
    auditHandoffRequired: tenantAuditHandoff.required,
    auditRoutingKey: tenantAuditHandoff.routingKey,
    auditSink: tenantBoundary.auditSink
  };
  proof.invariants.providerContractAccepted = capabilityNegotiation.ok;
  proof.invariants.providerServiceAdmitted = providerServiceAdmission.admitted;
  proof.invariants.externalHandoffReady = externalHandoff.enabled && externalHandoff.state === "ready";
  proof.invariants.providerHandoffCommitted = providerHandoffCommit.ready;
  proof.invariants.providerHandoffCommitReplaySafe = providerHandoffCommit.replayed
    || Boolean(providerHandoffCommit.commit.idempotencyKey);
  proof.invariants.previewGenerated = preview.format === "working-directory-lease.preview.v1";
  proof.invariants.acceptancePolicySatisfied = acceptance.state === "acceptable";
  proof.invariants.routeReady = readiness.ready;
  proof.invariants.routePreviewDecisionReady = routePreviewDecision.state === "ready";
  proof.invariants.clientRuntimeAccepted = clientRuntimeValidation.ok;
  proof.invariants.tenantBoundaryAccepted = tenantBoundaryValidation.ok;
  proof.invariants.tenantWriteAllowed = tenantAccess.permissions.canWrite;
  proof.invariants.tenantHandoffAllowed = tenantAccess.permissions.canHandoff;
  proof.invariants.tenantProviderOperationAllowed = providerServiceAdmission.tenantProof
    ? providerServiceAdmission.tenantProof.decision !== "denied"
    : true;
  proof.invariants.tenantAuditHandoffReady = tenantAuditHandoff.required
    ? Boolean(tenantAuditHandoff.sink || tenantAuditHandoff.routingKey)
    : true;
  proof.invariants.writeAdmissionAccepted = writeAdmission.state !== "blocked";
  proof.invariants.workflowHandoffReady = workflowHandoff.state === "mount-ready";
  proof.invariants.clientWorkflowRuntimeReady = clientWorkflowRuntimeHandoff.ready;
  proof.invariants.clientWorkflowRuntimeResumable = clientWorkflowRuntimeHandoff.resumable;
  proof.invariants.routeAcceptanceReceiptAccepted = routeAcceptanceReceipt.accepted;
  proof.invariants.routeAcceptanceReceiptReplayable = Boolean(routeAcceptanceReceipt.receiptId);
  proof.lifecycleCommandControl = {
    requestedCommand: lifecycleCommandControl.requestedCommand,
    accepted: lifecycleCommandControl.accepted,
    state: lifecycleCommandControl.state,
    commandType: lifecycleCommandControl.commandType,
    blockers: lifecycleCommandControl.blockers,
    nextCommand: lifecycleCommandControl.nextAction.command,
    settingsPatch: lifecycleCommandControl.settingsPatch?.apply || null,
    transitionState: lifecycleCommandControl.settingsTransition?.state || null,
    transitionBlockers: lifecycleCommandControl.settingsTransition?.blockers || [],
    resultingCommands: lifecycleCommandControl.settingsTransition?.resultingCommands || null,
    scheduledRenewalAt: lifecycleCommandControl.settingsTransition?.schedulePreview.scheduledRenewalAt || null
  };
  proof.invariants.persistedStateAccepted = persistedStateValidation.ok;
  proof.invariants.operationalHealthAccepted = operationalHealth.state === "healthy"
    || operationalHealth.state === "degraded"
    || operationalHealth.readonlyFallback.active;
  proof.invariants.readonlyFallbackActive = operationalHealth.readonlyFallback.active;
  proof.invariants.operationalIncidentClear = !operationalIncident.active;
  proof.invariants.operationalIncidentCircuitBreakerOpen = operationalIncident.circuitBreaker.active;
  proof.invariants.restartSafe = recovery.restartSafeStatus === "stable"
    || recovery.restartSafeStatus === "idempotent-replay";
  proof.operationalHealth = {
    state: operationalHealth.state,
    failureCode: operationalHealth.failureCode,
    readonlyFallbackActive: operationalHealth.readonlyFallback.active,
    failedProbes: operationalHealth.probes
      .filter((probe) => probe.status === "failed")
      .map((probe) => probe.name),
    recoveryCommands: operationalHealth.recoveryCommands,
    operatorRunbook: operationalHealth.operatorRunbook
  };
  proof.operationalIncident = {
    state: operationalIncident.state,
    severity: operationalIncident.severity,
    active: operationalIncident.active,
    incidentId: operationalIncident.incidentId,
    failureCode: operationalIncident.failureCode,
    failedProbes: operationalIncident.failedProbes,
    blockedCommands: operationalIncident.circuitBreaker.blockedCommands,
    remediation: operationalIncident.remediation,
    nextCommand: operationalIncident.nextCommand,
    retryAt: operationalIncident.retryAt
  };
  proof.recovery = {
    restartSafeStatus: recovery.restartSafeStatus,
    idempotencyEffect: recovery.idempotency.effect,
    idempotencyResultState: recovery.idempotency.result.state,
    idempotencyResultRef: recovery.idempotency.result.resultRef,
    requiredRecoveryCommands: recovery.requiredRecoveryCommands,
    persistedCheckpoint: recovery.persistedCheckpoint,
    recoveredGeneration: recovery.recoveredGeneration,
    currentRestartEpoch: recovery.currentRestartEpoch,
    persistenceRequired: recovery.persistence.required,
    persistenceReasons: recovery.persistence.reasons,
    persistenceKey: recovery.persistence.key,
    nextPersistedGeneration: recovery.persistence.compareAndSet.nextGeneration
  };
  proof.writeAdmission = {
    state: writeAdmission.state,
    admitted: writeAdmission.admitted,
    requestedCount: writeAdmission.batch.requestedCount,
    admittedCount: writeAdmission.batch.admittedCount,
    overflowCount: writeAdmission.batch.overflowCount,
    blockers: writeAdmission.blockers,
    nextCommand: writeAdmission.nextCommand
  };
  proof.routePreviewDecision = {
    state: routePreviewDecision.state,
    route: routePreviewDecision.route,
    requestId: routePreviewDecision.requestId,
    command: routePreviewDecision.routePayload.command,
    validationStatus: routePreviewDecision.validation.status,
    acceptanceState: routePreviewDecision.acceptance.state,
    readinessStage: routePreviewDecision.readiness.stage,
    providerAdmissionState: routePreviewDecision.integrations.providerAdmissionState,
    writeAdmissionState: routePreviewDecision.integrations.writeAdmissionState
  };
  proof.clientWorkflowRuntimeHandoff = {
    state: clientWorkflowRuntimeHandoff.state,
    ready: clientWorkflowRuntimeHandoff.ready,
    resumable: clientWorkflowRuntimeHandoff.resumable,
    command: clientWorkflowRuntimeHandoff.dispatch.command,
    dueAt: clientWorkflowRuntimeHandoff.dispatch.dueAt,
    persistRequired: clientWorkflowRuntimeHandoff.persist.required,
    persistKey: clientWorkflowRuntimeHandoff.persist.key,
    route: clientWorkflowRuntimeHandoff.navigation.route,
    routeState: clientWorkflowRuntimeHandoff.navigation.routeState,
    blockers: clientWorkflowRuntimeHandoff.blockers
  };
  proof.routeAcceptanceReceipt = {
    state: routeAcceptanceReceipt.state,
    accepted: routeAcceptanceReceipt.accepted,
    receiptId: routeAcceptanceReceipt.receiptId,
    blockerCount: routeAcceptanceReceipt.blockers.length,
    nextCommand: routeAcceptanceReceipt.nextStep.command,
    handoffClaimState: routeAcceptanceReceipt.handoffClaim.state,
    externalStatePatchReady: routeAcceptanceReceipt.handoffClaim.externalStatePatchReady
  };
  proof.auditTrail = uniqueStrings(proof.auditTrail.concat([
    "working-directory-lease.provider-contract.normalized",
    capabilityNegotiation.ok
      ? "working-directory-lease.capabilities.granted"
      : "working-directory-lease.capabilities.denied",
    syncMetadata.requiresRemoteRegistration
      ? "working-directory-lease.sync.registration-required"
      : null,
    syncMetadata.requiresUpload ? "working-directory-lease.sync.upload-required" : null,
    externalHandoff.enabled
      ? `working-directory-lease.external-handoff.${externalHandoff.state}`
      : `working-directory-lease.external-handoff.blocked.${externalHandoff.blockedReason}`,
    `working-directory-lease.provider-service-admission.${providerServiceAdmission.state}`,
    `working-directory-lease.provider-handoff-commit.${providerHandoffCommit.state}`,
    providerHandoffCommit.ready ? "working-directory-lease.provider-handoff-commit.ready" : null,
    providerHandoffCommit.replayed ? "working-directory-lease.provider-handoff-commit.replayed" : null,
    providerHandoffCommit.blockers.length > 0 ? "working-directory-lease.provider-handoff-commit.blocked" : null,
    providerHandoffCommit.externalStatePatch
      ? "working-directory-lease.provider-handoff-commit.external-state-patch-ready"
      : null,
    providerServiceAdmission.blockers.length > 0
      ? "working-directory-lease.provider-service-admission.blocked"
      : null,
    providerServiceAdmission.syncProof.current
      ? "working-directory-lease.provider-service-admission.sync-current"
      : "working-directory-lease.provider-service-admission.sync-required",
    "working-directory-lease.preview.generated",
    validationSummary.status === "pass"
      ? "working-directory-lease.validation-summary.pass"
      : "working-directory-lease.validation-summary.blocked",
    acceptance.state === "acceptable"
      ? "working-directory-lease.acceptance.acceptable"
      : "working-directory-lease.acceptance.blocked",
    readiness.ready
      ? "working-directory-lease.readiness.ready"
      : `working-directory-lease.readiness.${readiness.stage}`,
    clientRuntimeValidation.ok
      ? "working-directory-lease.client-runtime.accepted"
      : "working-directory-lease.client-runtime.rejected",
    persistedStateValidation.ok
      ? "working-directory-lease.persisted-state.accepted"
      : "working-directory-lease.persisted-state.rejected",
    persistedState.restartEpochChanged ? "working-directory-lease.persisted-state.restart-epoch-changed" : null,
    persistedState.fingerprintChanged ? "working-directory-lease.persisted-state.fingerprint-changed" : null,
    operationalHealth.readonlyFallback.active ? "working-directory-lease.operational-health.readonly-fallback" : null,
    operationalHealth.failureCode ? `working-directory-lease.operational-health.failure.${operationalHealth.failureCode}` : null,
    operationalHealth.recoveryCommands.length > 0 ? "working-directory-lease.operational-health.recovery-required" : null,
    operationalIncident.active ? "working-directory-lease.operational-incident.opened" : null,
    operationalIncident.severity !== "normal"
      ? `working-directory-lease.operational-incident.severity.${operationalIncident.severity}`
      : null,
    operationalIncident.circuitBreaker.blockWrites ? "working-directory-lease.operational-incident.blocks-writes" : null,
    operationalIncident.circuitBreaker.blockProviderAdmission
      ? "working-directory-lease.operational-incident.blocks-provider-admission"
      : null,
    operationalIncident.retryAt ? "working-directory-lease.operational-incident.retry-scheduled" : null,
    tenantBoundaryValidation.ok
      ? "working-directory-lease.tenant-boundary.accepted"
      : "working-directory-lease.tenant-boundary.rejected",
    `working-directory-lease.tenant-access.${tenantAccess.state}`,
    tenantAccess.deniedOperations.length > 0 ? "working-directory-lease.tenant-access.operations-denied" : null,
    `working-directory-lease.write-admission.${writeAdmission.state}`,
    lifecycleCommandControl.settingsPatch ? "working-directory-lease.lifecycle-settings.patch-planned" : null,
    lifecycleCommandControl.settingsTransition
      ? `working-directory-lease.lifecycle-settings.transition.${lifecycleCommandControl.settingsTransition.state}`
      : null,
    lifecycleCommandControl.settingsTransition?.schedulePreview.enabled
      ? "working-directory-lease.lifecycle-settings.transition.scheduler-previewed"
      : null,
    lifecycleCommandControl.settingsTransition?.blockers.length > 0
      ? "working-directory-lease.lifecycle-settings.transition.blocked"
      : null,
    lifecycleCommandControl.commandType === "settings-control"
      ? `working-directory-lease.lifecycle-control.${lifecycleCommandControl.requestedCommand}`
      : null,
    lifecycleCommandControl.nextAction.command
      ? `working-directory-lease.lifecycle-control.next.${lifecycleCommandControl.nextAction.command}`
      : null,
    writeAdmission.batch.requestedCount > 0 ? "working-directory-lease.write-intent.present" : null,
    writeAdmission.batch.overflowCount > 0 ? "working-directory-lease.write-admission.batch-overflow" : null,
    writeAdmission.blockers.length > 0 ? "working-directory-lease.write-admission.blocked" : null,
    tenantBoundary.auditSink ? "working-directory-lease.tenant-audit.sink-attached" : null,
    tenantAuditHandoff.required ? "working-directory-lease.tenant-audit.handoff-required" : null,
    tenantAuditHandoff.events.length > 0 ? "working-directory-lease.tenant-audit.events-prepared" : null,
    providerServiceAdmission.tenantProof?.decision === "denied"
      ? "working-directory-lease.provider-service-admission.tenant-denied"
      : null,
    tenantAccess.permissionMatrix.missingRoles.length > 0
      ? "working-directory-lease.tenant-access.operation-role-missing"
      : null,
    `working-directory-lease.recovery.${recovery.restartSafeStatus}`,
    recovery.idempotency.alreadyApplied ? "working-directory-lease.command.idempotent-replay" : null,
    recovery.idempotency.result.state
      ? `working-directory-lease.command-result.${recovery.idempotency.result.state}`
      : null,
    recovery.requiredRecoveryCommands.length > 0 ? "working-directory-lease.recovery.commands-required" : null,
    recovery.persistence.required ? "working-directory-lease.recovery.persistence-write-required" : null,
    recovery.persistence.reasons.length > 0
      ? `working-directory-lease.recovery.persistence-reason.${recovery.persistence.reasons[0]}`
      : null,
    `working-directory-lease.workflow-handoff.${workflowHandoff.state}`,
    `working-directory-lease.route-preview-decision.${routePreviewDecision.state}`,
    `working-directory-lease.client-workflow-runtime-handoff.${clientWorkflowRuntimeHandoff.state}`,
    clientWorkflowRuntimeHandoff.ready ? "working-directory-lease.client-workflow-runtime-handoff.ready" : null,
    clientWorkflowRuntimeHandoff.resumable
      ? "working-directory-lease.client-workflow-runtime-handoff.resumable"
      : null,
    clientWorkflowRuntimeHandoff.persist.required
      ? "working-directory-lease.client-workflow-runtime-handoff.persist-required"
      : null,
    clientWorkflowRuntimeHandoff.dispatch.command
      ? `working-directory-lease.client-workflow-runtime-handoff.dispatch.${clientWorkflowRuntimeHandoff.dispatch.command}`
      : null,
    `working-directory-lease.route-acceptance-receipt.${routeAcceptanceReceipt.state}`,
    routeAcceptanceReceipt.accepted ? "working-directory-lease.route-acceptance-receipt.accepted" : null,
    routeAcceptanceReceipt.blockers.length > 0 ? "working-directory-lease.route-acceptance-receipt.blocked" : null,
    routeAcceptanceReceipt.handoffClaim.externalStatePatchReady
      ? "working-directory-lease.route-acceptance-receipt.external-state-patch-ready"
      : null,
    routePreviewDecision.routePayload.command
      ? `working-directory-lease.route-preview-decision.command.${routePreviewDecision.routePayload.command}`
      : null
  ]));
  const history = normalizeHistorySnapshots(input, {
    observedAt: now,
    observedAtMs: nowMs,
    status: health.status,
    writable: health.writable,
    failureCode: failureState.code,
    renewalRequired: health.renewalRequired,
    degraded: degradedMode.enabled,
    leaseId: lease.leaseId,
    ownerId: lease.ownerId
  }, nowMs);
  const analyticsCounters = buildAnalyticsCounters(history, validation, retryPolicy, degradedMode);
  const timeline = buildTimeline(history);
  const exportSummary = buildExportSummary({
    lease,
    health,
    failureState,
    analyticsCounters,
    timeline,
    now
  });
  const analyticsReportingInput = normalizeAnalyticsReportingInput(input);
  const analyticsReporting = buildAnalyticsReportingState({
    reportingInput: analyticsReportingInput,
    history,
    timeline,
    analyticsCounters,
    exportSummary,
    proof,
    nowMs,
    now
  });
  const analyticsExport = buildAnalyticsExportContract({
    reportingInput: analyticsReportingInput,
    reporting: analyticsReporting,
    exportSummary,
    analyticsCounters,
    history,
    timeline,
    proof,
    now
  });
  proof.analytics = {
    exportFormat: exportSummary.format,
    reportingFormat: analyticsReporting.format,
    deliveryFormat: analyticsExport.normalizedFormat,
    deliveryState: analyticsExport.state,
    observations: analyticsCounters.observations,
    latestStatus: health.status,
    failureCount: analyticsCounters.failures,
    renewalRequiredCount: analyticsCounters.renewalRequired,
    identityChangeCount: analyticsCounters.leaseIdentityChanges + analyticsCounters.ownerIdentityChanges,
    attentionSeverity: analyticsReporting.attention.severity,
    attentionCodes: analyticsReporting.attention.codes,
    exportRowCount: analyticsReporting.export.rowCount,
    exportDestination: analyticsReporting.export.destination,
    exportReady: analyticsExport.ready,
    exportBlockers: analyticsExport.validation.blockers,
    exportFingerprint: analyticsExport.manifest.fingerprint
  };
  proof.auditTrail = uniqueStrings(proof.auditTrail.concat([
    "working-directory-lease.analytics.counted",
    history.length > 1 ? "working-directory-lease.history.snapshot-recorded" : null,
    timeline.some((entry) => entry.changed.length > 0 && !entry.changed.includes("initial"))
      ? "working-directory-lease.timeline.transition-detected"
      : null,
    analyticsReporting.attention.required
      ? `working-directory-lease.analytics.attention.${analyticsReporting.attention.severity}`
      : "working-directory-lease.analytics.attention.normal",
    analyticsReporting.export.truncated ? "working-directory-lease.analytics.export-truncated" : null,
    analyticsReporting.export.destination ? "working-directory-lease.analytics.export-destination-attached" : null,
    analyticsExport.ready
      ? `working-directory-lease.analytics-export.ready.${analyticsExport.normalizedFormat}`
      : "working-directory-lease.analytics-export.blocked",
    analyticsExport.validation.warnings.length > 0 ? "working-directory-lease.analytics-export.warnings" : null,
    analyticsExport.destination.scheme !== "memory"
      ? `working-directory-lease.analytics-export.destination.${analyticsExport.destination.scheme}`
      : null,
    "working-directory-lease.export.summary-ready",
    "working-directory-lease.analytics.reporting-ready"
  ]));

  return {
    ok: health.status !== "unhealthy",
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: "hosted-kernel working-directory lease health and recovery contract",
    lease,
    health,
    validation,
    pathSafety,
    failureState,
    degradedMode,
    retryPolicy,
    operationalHealth,
    operationalIncident,
    lifecycle,
    providerContract,
    capabilityNegotiation,
    syncMetadata,
    externalHandoff,
    providerOperation,
    providerServiceAdmission,
    providerHandoffAcknowledgement,
    providerHandoffCommit,
    clientRuntime,
    tenantBoundary,
    tenantAccess,
    tenantAuditHandoff,
    writeIntent,
    writeAdmission,
    persistedState,
    recovery,
    preview,
    acceptance,
    readiness,
    routePreviewDecision,
    workflowHandoff,
    clientWorkflowRuntimeHandoff,
    routeAcceptanceReceipt,
    validationSummary,
    analytics: {
      counters: analyticsCounters,
      history,
      timeline,
      exportSummary,
      reportingRequest: analyticsReportingInput,
      reporting: analyticsReporting,
      export: analyticsExport
    },
    actionableErrors,
    proof,
    evidence: Array.isArray(input.evidence) ? input.evidence.concat(proof.auditTrail) : proof.auditTrail
  };
}

export default describeWorkingDirectoryLeaseSurface;
