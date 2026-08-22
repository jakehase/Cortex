export const surfaceId = "aios_operator-userland_cli-run_082";
export const surfaceGroup = "operator-userland";
export const surfaceName = "cli-run";

const STATE_SCHEMA_VERSION = 1;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30 * 1000
};
const DEFAULT_LIFECYCLE_SETTINGS = {
  enabled: true,
  mode: 'immediate',
  paused: false,
  notBefore: null,
  maxActiveCommands: 5,
  allowWriteCommands: true,
  disabledReason: null
};
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE_STATUSES = new Set(['queued', 'running', 'recovering']);
const LIFECYCLE_ACTIONS = new Set(['enable', 'disable', 'pause', 'resume', 'schedule']);
const LIFECYCLE_COMMANDS = new Set(['lifecycle:enable', 'lifecycle:disable', 'lifecycle:pause', 'lifecycle:resume', 'lifecycle:schedule']);
const PROVIDER_CAPABILITIES = new Set(['executeCommand', 'streamLogs', 'writeWorkspace', 'auditProof', 'syncState', 'cancelCommand']);
const CLIENT_TRANSPORTS = new Set(['cli', 'web-terminal', 'api', 'automation']);
const CLIENT_CONTINUATION_CONTRACT = 'aios.cli-run.client-continuation.v1';
const HOSTED_KERNEL_EXECUTION_CONTRACT = 'aios.cli-run.hosted-kernel-execution.v1';
const JOB_RUN_ADMISSION_CONTRACT = 'aios.cli-run.job-run-admission.v1';
const AIOS_PROCESS_CREATION_CONTRACT = 'aios.process-creation.request.v1';
const JOB_RUN_ACCEPTANCE_PREVIEW_CONTRACT = 'aios.cli-run.job-run-acceptance-preview.v1';
const JOB_RUN_CLIENT_HANDOFF_CONTRACT = 'aios.cli-run.job-run-client-handoff.v1';
const JOB_RUN_MAILCHIMP_HANDOFF_CONTRACT = 'aios.cli-run.mailchimp-campaign-handoff.v1';
const JOB_RUN_PROCESS_COMMAND = 'aios:job-run';
const JOB_RUN_DESCRIPTOR_CONTRACT = 'aios.job-run.descriptor.v1';
const JOB_DESCRIPTOR_BOUNDARY_CONTRACT = 'aios.cli-run.job-descriptor-boundary.v1';
const PERSISTED_STATE_CONTRACT = 'aios.cli-run.persisted-state.v2';
const COMMAND_LEASE_CONTRACT = 'aios.cli-run.command-lease.v1';
const RESTART_RECOVERY_PLAN_CONTRACT = 'aios.cli-run.restart-recovery-plan.v1';
const CLIENT_STATUS_BRIDGE_CONTRACT = 'aios.cli-run.client-status-bridge.v1';
const WORKSPACE_PATH_ENV_CONTRACT = 'aios.cli-run.workspace-path-environment.v1';
const DEFAULT_EXECUTION_POLICY = {
  timeoutMs: 10 * 60 * 1000,
  maxOutputBytes: 1024 * 1024,
  stdinBytesLimit: 64 * 1024,
  envVarLimit: 64
};
const SENSITIVE_ENV_NAME = /(token|secret|password|passwd|credential|private[_-]?key|api[_-]?key)/i;
const WORKSPACE_PATH_ENV_NAME = /^(AIOS_|CLI_RUN_|WORKSPACE_).*(PATH|PATHS|DIR|DIRECTORY|FILE|FILES|ROOT)$/i;
const HOST_ENV_PATH_NAMES = new Set(['PATH', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'NODE_PATH', 'PYTHONPATH', 'GOPATH']);
const DEFAULT_PROVIDER_CONTRACT = {
  providerId: 'hosted-kernel.local-cli-run',
  service: 'cli-run-executor',
  version: '1.0.0',
  enabled: true,
  capabilities: ['auditProof', 'cancelCommand', 'executeCommand', 'streamLogs', 'syncState', 'writeWorkspace'],
  handoffMode: 'hosted-kernel',
  endpoint: null,
  syncCursor: null
};
const ROLE_PERMISSIONS = {
  viewer: ['cli:read'],
  operator: ['cli:read', 'cli:run'],
  maintainer: ['cli:read', 'cli:run', 'cli:write'],
  owner: ['cli:read', 'cli:run', 'cli:write', 'cli:admin']
};
const ADMIN_COMMANDS = new Set(['tenant:grant', 'tenant:revoke', 'workspace:mount', 'workspace:unmount']);
const UNBOUNDED_SCOPE_MARKERS = new Set(['*', 'all']);
const MAILCHIMP_PROVIDER_STATES = new Set(['connected', 'degraded', 'rate-limited', 'offline', 'unauthorized', 'unknown']);
const MAILCHIMP_CAMPAIGN_STATUSES = new Set(['draft', 'scheduled', 'sending', 'sent', 'paused', 'failed', 'cancelled']);
const MAILCHIMP_PROOF_ELIGIBLE_STATUSES = new Set(['draft', 'scheduled', 'paused']);

function normalizeIdentifier(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stableJson(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestPayload(value) {
  const text = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeScopeList(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean))).sort()
    : [];
}

function isUnboundedScope(scope) {
  return scope.some((item) => UNBOUNDED_SCOPE_MARKERS.has(item.toLowerCase()));
}

function normalizeTenantBoundary(envelope, input) {
  const actorInput = envelope.actor && typeof envelope.actor === 'object'
    ? envelope.actor
    : input.actor && typeof input.actor === 'object'
      ? input.actor
      : {};
  const role = normalizeIdentifier(envelope.role || actorInput.role || input.role, 'viewer');
  const explicitPermissions = Array.isArray(envelope.permissions)
    ? envelope.permissions
    : Array.isArray(actorInput.permissions)
      ? actorInput.permissions
      : Array.isArray(input.permissions)
        ? input.permissions
        : [];
  const permissions = new Set((ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer).concat(explicitPermissions).map(String));

  return {
    tenantId: normalizeIdentifier(envelope.tenantId || input.tenantId, null),
    workspaceId: normalizeIdentifier(envelope.workspaceId || input.workspaceId, null),
    actor: {
      actorId: normalizeIdentifier(envelope.actorId || actorInput.actorId || actorInput.id || input.actorId, 'anonymous'),
      role,
      permissions: Array.from(permissions).sort(),
      tenantId: normalizeIdentifier(actorInput.tenantId || input.actorTenantId, null),
      workspaceIds: normalizeScopeList(actorInput.workspaceIds || actorInput.workspaces || input.actorWorkspaceIds),
      delegatedTenantIds: normalizeScopeList(actorInput.delegatedTenantIds || input.delegatedTenantIds),
      delegatedWorkspaceIds: normalizeScopeList(actorInput.delegatedWorkspaceIds || input.delegatedWorkspaceIds)
    }
  };
}

function projectTenantIsolationContract(envelope) {
  const actor = envelope.actor;
  const tenantScope = actor.delegatedTenantIds.length
    ? actor.delegatedTenantIds
    : actor.tenantId
      ? [actor.tenantId]
      : [];
  const workspaceScope = actor.delegatedWorkspaceIds.length
    ? actor.delegatedWorkspaceIds
    : actor.workspaceIds;
  const tenantUnbounded = isUnboundedScope(tenantScope);
  const workspaceUnbounded = isUnboundedScope(workspaceScope);

  return {
    contract: 'aios.cli-run.tenant-isolation.v1',
    actorId: actor.actorId,
    role: actor.role,
    commandTenantId: envelope.tenantId,
    commandWorkspaceId: envelope.workspaceId,
    tenantScope,
    workspaceScope,
    tenantScoped: tenantUnbounded || tenantScope.length === 0 ? 'unbounded-or-unspecified' : 'bounded',
    workspaceScoped: workspaceUnbounded || workspaceScope.length === 0 ? 'unbounded-or-unspecified' : 'bounded',
    tenantAuthorized: tenantUnbounded || tenantScope.length === 0 || tenantScope.includes(envelope.tenantId),
    workspaceAuthorized: workspaceUnbounded || workspaceScope.length === 0 || workspaceScope.includes(envelope.workspaceId),
    requiresAdminForUnboundedScope: (tenantUnbounded || workspaceUnbounded) && !actor.permissions.includes('cli:admin')
  };
}

function splitPath(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean);
}

function normalizeWorkspacePath(workspaceRoot, candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return { raw: candidate ?? null, normalized: null, inScope: true };
  }

  const raw = candidate.trim().replaceAll('\\', '/');
  const rootParts = splitPath(workspaceRoot || '/workspace');
  const candidateParts = raw.startsWith('/') ? splitPath(raw) : rootParts.concat(splitPath(raw));
  const resolved = [];
  for (const part of candidateParts) {
    if (part === '.') continue;
    if (part === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  const inScope = rootParts.every((part, index) => resolved[index] === part);
  return {
    raw,
    normalized: `/${resolved.join('/')}`,
    inScope,
    workspaceRoot: `/${rootParts.join('/') || 'workspace'}`
  };
}

function requiredPermissionsForCommand(envelope) {
  const required = new Set(['cli:run']);
  if (envelope.writePaths.length > 0 || envelope.mutatesWorkspace) {
    required.add('cli:write');
  }
  if (ADMIN_COMMANDS.has(envelope.command) || LIFECYCLE_COMMANDS.has(envelope.command)) {
    required.add('cli:admin');
  }
  return Array.from(required).sort();
}

function parseTime(value, fallback) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeRetryPolicy(input) {
  const candidate = input.retryPolicy && typeof input.retryPolicy === 'object'
    ? input.retryPolicy
    : {};
  return {
    maxAttempts: normalizePositiveInteger(candidate.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts, { min: 1, max: 20 }),
    baseDelayMs: normalizePositiveInteger(candidate.baseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs, { min: 100, max: 60 * 1000 }),
    maxDelayMs: normalizePositiveInteger(candidate.maxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs, { min: 100, max: 10 * 60 * 1000 })
  };
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function normalizeScheduleTime(value) {
  if (value === null || value === undefined || value === '') return { value: null, valid: true };
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return { value: null, valid: false, raw: value };
  return { value: new Date(parsed).toISOString(), valid: true };
}

function lifecycleSettingsInput(input, persistedState) {
  if (input.lifecycleSettings && typeof input.lifecycleSettings === 'object') return input.lifecycleSettings;
  if (input.settings && typeof input.settings === 'object') return input.settings;
  if (persistedState.lifecycleSettings && typeof persistedState.lifecycleSettings === 'object') return persistedState.lifecycleSettings;
  return {};
}

function normalizeLifecycleSettings(input, persistedState, nowMs) {
  const candidate = lifecycleSettingsInput(input, persistedState);
  const schedule = candidate.schedule && typeof candidate.schedule === 'object' ? candidate.schedule : candidate;
  const requestedMode = normalizeIdentifier(schedule.mode || candidate.mode, DEFAULT_LIFECYCLE_SETTINGS.mode);
  const mode = ['immediate', 'manual', 'scheduled'].includes(requestedMode) ? requestedMode : DEFAULT_LIFECYCLE_SETTINGS.mode;
  const notBefore = normalizeScheduleTime(schedule.notBefore || candidate.notBefore);
  const settings = {
    enabled: normalizeBoolean(candidate.enabled, DEFAULT_LIFECYCLE_SETTINGS.enabled),
    mode,
    paused: normalizeBoolean(schedule.paused ?? candidate.paused, DEFAULT_LIFECYCLE_SETTINGS.paused),
    notBefore: notBefore.value,
    maxActiveCommands: normalizePositiveInteger(schedule.maxActiveCommands ?? candidate.maxActiveCommands, DEFAULT_LIFECYCLE_SETTINGS.maxActiveCommands, { min: 1, max: 100 }),
    allowWriteCommands: normalizeBoolean(candidate.allowWriteCommands, DEFAULT_LIFECYCLE_SETTINGS.allowWriteCommands),
    disabledReason: normalizeIdentifier(candidate.disabledReason, null)
  };
  const violations = [];

  if (!notBefore.valid) {
    violations.push({
      code: 'invalid-lifecycle-schedule-time',
      message: 'cli-run lifecycle schedule notBefore must be an ISO-compatible timestamp',
      value: notBefore.raw
    });
  }
  if (requestedMode !== mode) {
    violations.push({
      code: 'invalid-lifecycle-mode',
      message: 'cli-run lifecycle mode must be immediate, manual, or scheduled',
      value: requestedMode
    });
  }
  if (settings.mode === 'scheduled' && !settings.notBefore) {
    violations.push({
      code: 'missing-lifecycle-schedule-time',
      message: 'cli-run scheduled lifecycle mode requires notBefore'
    });
  }
  if (settings.notBefore && Date.parse(settings.notBefore) < nowMs) {
    violations.push({
      code: 'expired-lifecycle-schedule-time',
      message: 'cli-run lifecycle notBefore must not be in the past',
      notBefore: settings.notBefore
    });
  }

  return { settings, violations };
}

function normalizeLifecycleControl(input) {
  const candidate = input.lifecycleControl && typeof input.lifecycleControl === 'object'
    ? input.lifecycleControl
    : input.control && typeof input.control === 'object'
      ? input.control
      : {};
  const action = normalizeIdentifier(candidate.action, null);
  return {
    action: LIFECYCLE_ACTIONS.has(action) ? action : null,
    rawAction: action,
    reason: normalizeIdentifier(candidate.reason, null),
    notBefore: candidate.notBefore,
    maxActiveCommands: candidate.maxActiveCommands,
    allowWriteCommands: candidate.allowWriteCommands
  };
}

function applyLifecycleControl(settings, control, actor, now) {
  if (!control.rawAction) return { settings, violations: [], audit: null };
  if (!control.action) {
    return {
      settings,
      violations: [{
        code: 'invalid-lifecycle-action',
        message: 'cli-run lifecycle action must be enable, disable, pause, resume, or schedule',
        action: control.rawAction
      }],
      audit: null
    };
  }
  if (!actor.permissions.includes('cli:admin')) {
    return {
      settings,
      violations: [{
        code: 'lifecycle-control-permission-denied',
        message: 'cli-run lifecycle controls require cli:admin permission',
        missingPermissions: ['cli:admin']
      }],
      audit: null
    };
  }

  const next = { ...settings };
  if (control.action === 'enable') {
    next.enabled = true;
    next.disabledReason = null;
  } else if (control.action === 'disable') {
    next.enabled = false;
    next.disabledReason = control.reason || 'operator-disabled';
  } else if (control.action === 'pause') {
    next.paused = true;
  } else if (control.action === 'resume') {
    next.paused = false;
    if (next.mode === 'manual') next.mode = 'immediate';
  } else if (control.action === 'schedule') {
    const notBefore = normalizeScheduleTime(control.notBefore);
    next.mode = 'scheduled';
    next.notBefore = notBefore.value;
    if (control.maxActiveCommands !== undefined) {
      next.maxActiveCommands = normalizePositiveInteger(control.maxActiveCommands, next.maxActiveCommands, { min: 1, max: 100 });
    }
    if (control.allowWriteCommands !== undefined) {
      next.allowWriteCommands = normalizeBoolean(control.allowWriteCommands, next.allowWriteCommands);
    }
    if (!notBefore.valid || !next.notBefore) {
      return {
        settings,
        violations: [{
          code: 'invalid-lifecycle-control-schedule',
          message: 'cli-run schedule control requires an ISO-compatible notBefore timestamp',
          value: control.notBefore
        }],
        audit: null
      };
    }
    if (Date.parse(next.notBefore) < parseTime(now, Date.now())) {
      return {
        settings,
        violations: [{
          code: 'expired-lifecycle-control-schedule',
          message: 'cli-run schedule control notBefore must not be in the past',
          notBefore: next.notBefore
        }],
        audit: null
      };
    }
  }

  return {
    settings: next,
    violations: [],
    audit: {
      type: 'lifecycle-control-applied',
      at: now,
      action: control.action,
      actorId: actor.actorId,
      settings: next
    }
  };
}

function projectLifecycleOperatorAction(settings, restartSafe, actor, control, blockedBy, nowMs) {
  const scheduleMs = settings.notBefore ? parseTime(settings.notBefore, nowMs) : null;
  const scheduleOpen = !scheduleMs || scheduleMs <= nowMs;
  const remainingCapacity = Math.max(0, settings.maxActiveCommands - restartSafe.activeCommandIds.length);
  const admin = actor.permissions.includes('cli:admin');
  const controlRequested = Boolean(control.rawAction);
  const controlInvalid = blockedBy.includes('invalid-lifecycle-action')
    || blockedBy.includes('invalid-lifecycle-control-schedule')
    || blockedBy.includes('expired-lifecycle-control-schedule');
  const controlDenied = blockedBy.includes('lifecycle-control-permission-denied');

  if (controlInvalid) {
    return {
      state: 'control-rejected',
      action: 'repair-lifecycle-control-request',
      reason: blockedBy.find((code) => code.includes('lifecycle-control') || code === 'invalid-lifecycle-action'),
      dueAt: null,
      commandAdmissionEffect: 'unchanged'
    };
  }
  if (controlDenied) {
    return {
      state: 'control-rejected',
      action: 'run-lifecycle-control-as-cli-admin',
      reason: 'lifecycle-control-permission-denied',
      dueAt: null,
      commandAdmissionEffect: 'unchanged'
    };
  }
  if (controlRequested && admin) {
    return {
      state: 'control-applied',
      action: settings.enabled && !settings.paused && scheduleOpen
        ? 'admit-command-or-observe-lifecycle'
        : 'observe-lifecycle-after-control',
      reason: control.action,
      dueAt: settings.notBefore || new Date(nowMs).toISOString(),
      commandAdmissionEffect: settings.enabled && !settings.paused && scheduleOpen ? 'may-open-admission' : 'may-keep-admission-closed'
    };
  }
  if (!settings.enabled) {
    return {
      state: 'admission-closed',
      action: admin ? 'enable-cli-run-lifecycle' : 'request-cli-run-enable-from-admin',
      reason: 'cli-run-disabled',
      dueAt: null,
      commandAdmissionEffect: 'blocks-new-commands'
    };
  }
  if (settings.paused || settings.mode === 'manual') {
    return {
      state: 'admission-closed',
      action: admin ? 'resume-cli-run-lifecycle' : 'request-cli-run-resume-from-admin',
      reason: 'cli-run-paused',
      dueAt: null,
      commandAdmissionEffect: 'blocks-new-commands'
    };
  }
  if (!scheduleOpen) {
    return {
      state: 'admission-delayed',
      action: 'wait-for-lifecycle-schedule-window',
      reason: 'cli-run-scheduled',
      dueAt: settings.notBefore,
      commandAdmissionEffect: 'delays-new-commands'
    };
  }
  if (restartSafe.staleCommandIds.length > 0) {
    return {
      state: 'recovery-required',
      action: 'recover-stale-command-before-admission',
      reason: 'stale-command-lease',
      dueAt: new Date(nowMs).toISOString(),
      commandAdmissionEffect: 'blocks-new-commands'
    };
  }
  if (remainingCapacity === 0) {
    return {
      state: 'capacity-full',
      action: 'wait-for-active-command-slot',
      reason: 'cli-run-concurrency-limit',
      dueAt: null,
      commandAdmissionEffect: 'blocks-new-commands'
    };
  }
  return {
    state: 'admission-open',
    action: settings.allowWriteCommands ? 'admit-next-command' : 'admit-read-only-command',
    reason: settings.allowWriteCommands ? null : 'cli-run-write-disabled',
    dueAt: settings.notBefore || new Date(nowMs).toISOString(),
    commandAdmissionEffect: settings.allowWriteCommands ? 'admits-all-authorized-commands' : 'admits-read-only-authorized-commands'
  };
}

function projectLifecycleControlAffordances(settings, actor, nowMs) {
  const admin = actor.permissions.includes('cli:admin');
  if (!admin) {
    return {
      canEnable: false,
      canDisable: false,
      canPause: false,
      canResume: false,
      canSchedule: false,
      blockedReason: 'lifecycle-control-permission-denied'
    };
  }
  const scheduleMs = settings.notBefore ? parseTime(settings.notBefore, nowMs) : null;
  return {
    canEnable: !settings.enabled,
    canDisable: settings.enabled,
    canPause: !settings.paused,
    canResume: settings.paused || settings.mode === 'manual',
    canSchedule: true,
    blockedReason: null,
    scheduleCanBeClearedByResume: Boolean(scheduleMs && scheduleMs > nowMs && settings.mode === 'scheduled'),
    disableWillRequireEnable: settings.enabled,
    writeToggleRecommended: !settings.allowWriteCommands
  };
}

function projectLifecycleControlState(settings, restartSafe, actor, control, violations, nowMs) {
  const lifecycleViolationCodes = new Set(violations
    .filter((violation) => violation.code.startsWith('cli-run-') || violation.code.includes('lifecycle'))
    .map((violation) => violation.code));
  const scheduleMs = settings.notBefore ? parseTime(settings.notBefore, nowMs) : null;
  const scheduleOpen = !scheduleMs || scheduleMs <= nowMs;
  const remainingCapacity = Math.max(0, settings.maxActiveCommands - restartSafe.activeCommandIds.length);
  const admin = actor.permissions.includes('cli:admin');
  const allowedControlActions = admin
    ? Array.from(LIFECYCLE_ACTIONS)
        .filter((action) => {
          if (action === 'enable') return !settings.enabled;
          if (action === 'disable') return settings.enabled;
          if (action === 'pause') return !settings.paused;
          if (action === 'resume') return settings.paused || settings.mode === 'manual';
          return true;
        })
        .sort()
    : [];
  const blockedBy = [];

  if (!settings.enabled) blockedBy.push('cli-run-disabled');
  if (settings.paused || settings.mode === 'manual') blockedBy.push('cli-run-paused');
  if (!scheduleOpen) blockedBy.push('cli-run-scheduled');
  if (remainingCapacity === 0) blockedBy.push('cli-run-concurrency-limit');
  for (const code of lifecycleViolationCodes) {
    if (!blockedBy.includes(code)) blockedBy.push(code);
  }

  const readiness = blockedBy.length
    ? 'blocked'
    : restartSafe.status === 'needs-recovery'
      ? 'recovering'
      : remainingCapacity > 0
        ? 'admitting'
        : 'idle';
  const operatorNextAction = projectLifecycleOperatorAction(settings, restartSafe, actor, control, blockedBy, nowMs);
  const affordances = projectLifecycleControlAffordances(settings, actor, nowMs);

  return {
    contract: 'aios.cli-run.lifecycle-state.v1',
    evaluatedAt: new Date(nowMs).toISOString(),
    readiness,
    enabled: settings.enabled,
    mode: settings.mode,
    paused: settings.paused,
    schedule: {
      notBefore: settings.notBefore,
      open: scheduleOpen,
      opensInMs: scheduleMs && scheduleMs > nowMs ? scheduleMs - nowMs : 0
    },
    capacity: {
      maxActiveCommands: settings.maxActiveCommands,
      activeCommandIds: restartSafe.activeCommandIds,
      remainingSlots: remainingCapacity
    },
    writeAdmission: {
      allowed: settings.allowWriteCommands,
      blockedReason: settings.allowWriteCommands ? null : 'cli-run-write-disabled'
    },
    controls: {
      requestedAction: control.rawAction,
      actorCanControl: admin,
      allowedActions: allowedControlActions,
      blockedReason: admin ? null : 'lifecycle-control-permission-denied',
      affordances
    },
    operatorNextAction,
    commandAdmission: {
      open: readiness === 'admitting',
      state: operatorNextAction.state,
      effect: operatorNextAction.commandAdmissionEffect,
      nextAction: operatorNextAction.action,
      reason: operatorNextAction.reason,
      dueAt: operatorNextAction.dueAt,
      activeCommandRecoveryIds: restartSafe.staleCommandIds
    },
    disabledReason: settings.disabledReason,
    blockedBy
  };
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean))).sort()
    : [];
}

function firstObject(...candidates) {
  return candidates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate)) || {};
}

function normalizeJobPath(value) {
  const path = normalizeIdentifier(value, null);
  return path && path.endsWith('.job.json') ? path.replaceAll('\\', '/') : path;
}

function relativeWorkspacePath(workspacePath) {
  if (!workspacePath?.normalized || !workspacePath?.workspaceRoot || !workspacePath.inScope) return null;
  const rootPrefix = workspacePath.workspaceRoot.endsWith('/')
    ? workspacePath.workspaceRoot
    : `${workspacePath.workspaceRoot}/`;
  if (workspacePath.normalized === workspacePath.workspaceRoot) return '';
  return workspacePath.normalized.startsWith(rootPrefix)
    ? workspacePath.normalized.slice(rootPrefix.length)
    : null;
}

function projectJobDescriptorBoundary(jobAdmission, envelope) {
  const descriptorPath = jobAdmission.present && jobAdmission.sourcePath
    ? normalizeWorkspacePath(envelope.workspaceRoot, jobAdmission.sourcePath)
    : null;
  const relativePath = relativeWorkspacePath(descriptorPath);
  const descriptorSegments = relativePath ? splitPath(relativePath) : [];
  const fileBackedJobRun = jobAdmission.present && jobAdmission.sourceKind === 'job-json-file';
  const tenantMatchesEnvelope = !jobAdmission.tenantId || jobAdmission.tenantId === envelope.tenantId;
  const workspaceMatchesEnvelope = !jobAdmission.workspaceId || jobAdmission.workspaceId === envelope.workspaceId;
  const descriptorArgMatches = !fileBackedJobRun || envelope.args[0] === jobAdmission.sourcePath;

  return {
    contract: JOB_DESCRIPTOR_BOUNDARY_CONTRACT,
    present: jobAdmission.present,
    fileBackedJobRun,
    sourcePath: jobAdmission.sourcePath,
    workspaceRoot: descriptorPath?.workspaceRoot || normalizeWorkspacePath(envelope.workspaceRoot, envelope.workspaceRoot).workspaceRoot,
    descriptorPath,
    relativePath,
    descriptorSegments,
    depth: descriptorSegments.length,
    descriptorFilename: descriptorSegments[descriptorSegments.length - 1] || null,
    examplesHelloJob: relativePath === 'examples/hello.job.json',
    tenant: {
      descriptorTenantId: jobAdmission.tenantId,
      envelopeTenantId: envelope.tenantId,
      matchesEnvelope: tenantMatchesEnvelope
    },
    workspace: {
      descriptorWorkspaceId: jobAdmission.workspaceId,
      envelopeWorkspaceId: envelope.workspaceId,
      matchesEnvelope: workspaceMatchesEnvelope
    },
    admission: {
      route: jobAdmission.commandAdmission.route,
      canonicalCommand: jobAdmission.commandAdmission.canonicalCommand,
      descriptorArgMatches,
      createProcessRequested: jobAdmission.process?.create ?? false
    },
    safeForProcessCreation: !fileBackedJobRun || (
      Boolean(descriptorPath?.inScope)
      && Boolean(relativePath)
      && tenantMatchesEnvelope
      && workspaceMatchesEnvelope
      && descriptorArgMatches
      && jobAdmission.process?.create !== false
    )
  };
}

function validateJobDescriptorBoundary(jobBoundary) {
  if (!jobBoundary.present || !jobBoundary.fileBackedJobRun) return [];
  const violations = [];
  if (!jobBoundary.descriptorPath?.inScope || !jobBoundary.relativePath) {
    violations.push({
      code: 'job-run-descriptor-path-out-of-scope',
      message: 'cli-run .job.json descriptor paths must resolve inside the admitted workspace root',
      sourcePath: jobBoundary.sourcePath,
      descriptorPath: jobBoundary.descriptorPath
    });
  }
  if (jobBoundary.sourcePath?.includes('\u0000')) {
    violations.push({
      code: 'job-run-descriptor-path-invalid',
      message: 'cli-run .job.json descriptor paths must not contain null bytes',
      sourcePath: jobBoundary.sourcePath
    });
  }
  if (!jobBoundary.tenant.matchesEnvelope) {
    violations.push({
      code: 'job-run-descriptor-tenant-mismatch',
      message: 'cli-run .job.json tenant boundary must match the admitted command tenant',
      descriptorTenantId: jobBoundary.tenant.descriptorTenantId,
      envelopeTenantId: jobBoundary.tenant.envelopeTenantId
    });
  }
  if (!jobBoundary.workspace.matchesEnvelope) {
    violations.push({
      code: 'job-run-descriptor-workspace-mismatch',
      message: 'cli-run .job.json workspace boundary must match the admitted command workspace',
      descriptorWorkspaceId: jobBoundary.workspace.descriptorWorkspaceId,
      envelopeWorkspaceId: jobBoundary.workspace.envelopeWorkspaceId
    });
  }
  if (!jobBoundary.admission.descriptorArgMatches) {
    violations.push({
      code: 'job-run-descriptor-argument-mismatch',
      message: 'cli-run .job.json process creation must use the admitted descriptor path as argv[1]',
      sourcePath: jobBoundary.sourcePath
    });
  }
  return violations;
}

function normalizeProcessToken(value, fallback) {
  const token = normalizeIdentifier(value, fallback);
  return token ? token.replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 128) || fallback : fallback;
}

function jobDescriptorInput(input) {
  return firstObject(
    input.jobRun,
    input.jobDescriptor,
    input.job,
    input.process?.job,
    input.command && typeof input.command === 'object' ? input.command.job : null
  );
}

function jobSourcePathInput(input, job) {
  return normalizeJobPath(
    job.sourcePath
      || job.path
      || job.file
      || input.jobPath
      || input.jobFile
      || input.path
      || input.sourcePath
  );
}

function normalizeJobCommand(job) {
  const run = firstObject(job.run, job.process, job.execution);
  const commandObject = firstObject(job.command);
  const argv = Array.isArray(job.argv)
    ? job.argv.map(String)
    : Array.isArray(run.argv)
      ? run.argv.map(String)
      : Array.isArray(commandObject.argv)
        ? commandObject.argv.map(String)
        : [];
  const command = normalizeIdentifier(
    job.command && typeof job.command === 'string'
      ? job.command
      : run.command || run.entrypoint || commandObject.command || commandObject.entrypoint || argv[0],
    ''
  );
  const args = Array.isArray(job.args)
    ? job.args.map(String)
    : Array.isArray(run.args)
      ? run.args.map(String)
      : Array.isArray(commandObject.args)
        ? commandObject.args.map(String)
        : argv.slice(command ? 1 : 0);

  return { command, args };
}

function normalizeMailchimpStatus(value, knownStatuses, fallback) {
  const normalized = normalizeIdentifier(value, fallback).toLowerCase();
  return knownStatuses.has(normalized) ? normalized : fallback;
}

function mailchimpDescriptorInput(input, job) {
  const integrations = job.integrations && typeof job.integrations === 'object' ? job.integrations : {};
  return firstObject(
    input.mailchimpCampaign,
    input.mailchimp,
    job.mailchimpCampaign,
    job.mailchimp,
    integrations.mailchimpCampaign,
    integrations.mailchimp
  );
}

function normalizeMailchimpCampaignDescriptor(input, job, now) {
  const source = mailchimpDescriptorInput(input, job);
  const present = source.enabled === true
    || source.present === true
    || normalizeIdentifier(source.provider, '').toLowerCase() === 'mailchimp'
    || Boolean(source.campaignId || source.audienceId || source.listId);
  const providerState = normalizeMailchimpStatus(source.providerState || source.state, MAILCHIMP_PROVIDER_STATES, present ? 'unknown' : 'offline');
  const campaignStatus = normalizeMailchimpStatus(source.campaignStatus || source.status, MAILCHIMP_CAMPAIGN_STATUSES, 'draft');
  const scheduledAt = normalizeScheduleTime(source.scheduledAt || source.sendAt || source.notBefore);
  const retryAfterMs = source.retryAfterMs === null || source.retryAfterMs === undefined
    ? null
    : normalizePositiveInteger(source.retryAfterMs, 0, { min: 0, max: 300000 });
  const generatedAt = normalizeIdentifier(source.generatedAt || source.lastSyncAt, now);
  const validation = [
    present && !source.campaignId ? 'mailchimp-campaign-id-required' : null,
    present && !(source.audienceId || source.listId) ? 'mailchimp-audience-id-required' : null,
    present && providerState === 'unauthorized' ? 'mailchimp-provider-unauthorized' : null,
    present && providerState === 'offline' ? 'mailchimp-provider-offline' : null,
    present && campaignStatus === 'failed' ? 'mailchimp-campaign-failed' : null,
    present && campaignStatus === 'cancelled' ? 'mailchimp-campaign-cancelled' : null,
    present && !scheduledAt.valid ? 'mailchimp-scheduled-at-invalid' : null
  ].filter(Boolean);
  const proofEligible = present
    && validation.length === 0
    && providerState === 'connected'
    && MAILCHIMP_PROOF_ELIGIBLE_STATUSES.has(campaignStatus);
  const state = !present
    ? 'not-present'
    : validation.length > 0
      ? 'blocked'
      : providerState === 'rate-limited'
        ? 'rate-limited'
        : providerState === 'degraded'
          ? 'degraded'
          : proofEligible
            ? 'ready'
            : 'review-required';

  return {
    contract: JOB_RUN_MAILCHIMP_HANDOFF_CONTRACT,
    present,
    state,
    provider: 'mailchimp',
    campaignId: normalizeIdentifier(source.campaignId, null),
    audienceId: normalizeIdentifier(source.audienceId || source.listId, null),
    providerState,
    campaignStatus,
    generatedAt,
    scheduledAt: scheduledAt.value,
    syncCursor: normalizeIdentifier(source.syncCursor || source.cursor, null),
    retry: {
      retryable: providerState === 'rate-limited' || providerState === 'degraded',
      retryAfterMs,
      nextRetryAt: retryAfterMs !== null ? new Date(parseTime(now, Date.now()) + retryAfterMs).toISOString() : null
    },
    validation,
    deliveryReadiness: {
      canAttachLogProof: proofEligible,
      canContinueInDegradedMode: providerState === 'rate-limited' || providerState === 'degraded',
      reason: !present
        ? 'No Mailchimp campaign was declared for this job run.'
        : validation[0] || (proofEligible ? 'Mailchimp campaign is ready for log proof handoff.' : `Mailchimp campaign is ${campaignStatus} with provider ${providerState}.`)
    }
  };
}

function normalizeJobRunAdmission(input, now) {
  const job = jobDescriptorInput(input);
  const sourcePath = jobSourcePathInput(input, job);
  const commandSpec = normalizeJobCommand(job);
  const hasJobDescriptor = Object.keys(job).length > 0 || Boolean(sourcePath);
  const jobId = normalizeIdentifier(job.id || job.jobId || job.name, sourcePath || null);
  const requestedRunId = normalizeIdentifier(input.jobRunId || job.runId || job.requestId, null);
  const labels = normalizeStringList(job.labels || job.tags || input.jobLabels);
  const writePaths = Array.isArray(job.writePaths)
    ? job.writePaths
    : Array.isArray(job.outputs)
      ? job.outputs
      : [];

  return {
    contract: JOB_RUN_ADMISSION_CONTRACT,
    present: hasJobDescriptor,
    admittedAt: now,
    sourcePath,
    sourceKind: sourcePath?.endsWith('.job.json') ? 'job-json-file' : hasJobDescriptor ? 'inline-job-descriptor' : 'direct-command',
    descriptorContract: hasJobDescriptor ? normalizeIdentifier(job.contract || job.schema || job.kind, JOB_RUN_DESCRIPTOR_CONTRACT) : null,
    jobId,
    jobName: normalizeIdentifier(job.name || job.title, jobId),
    requestedRunId,
    labels,
    commandSpec,
    cwd: normalizeIdentifier(job.cwd || job.workingDirectory || job.workdir, null),
    workspaceRoot: normalizeIdentifier(job.workspaceRoot, null),
    tenantId: normalizeIdentifier(job.tenantId, null),
    workspaceId: normalizeIdentifier(job.workspaceId, null),
    actor: firstObject(job.actor),
    environment: firstObject(job.env, job.environment),
    stdin: typeof job.stdin === 'string' ? job.stdin : null,
    mailchimpCampaign: normalizeMailchimpCampaignDescriptor(input, job, now),
    writePaths,
    mutatesWorkspace: normalizeBoolean(job.mutatesWorkspace, writePaths.length > 0),
    process: {
      requestedProcessId: normalizeIdentifier(job.processId || job.process?.id || job.process?.processId, null),
      name: normalizeProcessToken(job.processName || job.process?.name || job.name || jobId, jobId || 'job-run'),
      create: normalizeBoolean(job.createProcess ?? job.process?.create, hasJobDescriptor),
      restartPolicy: normalizeIdentifier(job.restartPolicy || job.process?.restartPolicy, 'never')
    },
    commandAdmission: {
      route: sourcePath?.endsWith('.job.json') ? 'aios-process-creation' : hasJobDescriptor ? 'inline-execution-plan' : 'direct-command',
      canonicalCommand: sourcePath?.endsWith('.job.json') ? JOB_RUN_PROCESS_COMMAND : commandSpec.command,
      descriptorPathArgument: sourcePath?.endsWith('.job.json') ? sourcePath : null,
      innerCommand: commandSpec.command || null,
      innerArgs: commandSpec.args
    },
    idempotencyKey: normalizeIdempotencyKey(
      input.idempotencyKey
        || requestedRunId
        || (jobId && sourcePath ? `job:${sourcePath}:${jobId}` : null)
    )
  };
}

function validateMailchimpJobCampaign(jobAdmission) {
  if (!jobAdmission.mailchimpCampaign?.present) return [];
  return jobAdmission.mailchimpCampaign.validation.map((code) => ({
    code,
    message: `cli-run Mailchimp job handoff is blocked: ${code}`,
    campaignId: jobAdmission.mailchimpCampaign.campaignId,
    audienceId: jobAdmission.mailchimpCampaign.audienceId,
    providerState: jobAdmission.mailchimpCampaign.providerState,
    campaignStatus: jobAdmission.mailchimpCampaign.campaignStatus
  }));
}

function validateJobRunAdmission(jobAdmission) {
  if (!jobAdmission.present) return [];
  const violations = [];
  if (jobAdmission.sourceKind === 'inline-job-descriptor' && !jobAdmission.jobId) {
    violations.push({
      code: 'job-run-missing-identity',
      message: 'cli-run job admission requires a job id, name, or .job.json source path'
    });
  }
  if (jobAdmission.sourcePath && !jobAdmission.sourcePath.endsWith('.job.json')) {
    violations.push({
      code: 'job-run-invalid-source-path',
      message: 'cli-run job admission source path must end with .job.json',
      sourcePath: jobAdmission.sourcePath
    });
  }
  if (!jobAdmission.commandSpec.command && !jobAdmission.sourcePath) {
    violations.push({
      code: 'job-run-missing-command',
      message: 'cli-run inline job admission requires a command, entrypoint, argv, or .job.json source path',
      sourcePath: jobAdmission.sourcePath,
      jobId: jobAdmission.jobId
    });
  }
  if (jobAdmission.sourceKind === 'job-json-file' && jobAdmission.commandAdmission.canonicalCommand !== JOB_RUN_PROCESS_COMMAND) {
    violations.push({
      code: 'job-run-invalid-admission-route',
      message: 'cli-run .job.json admission must route through the AI OS job-run process command',
      sourcePath: jobAdmission.sourcePath,
      canonicalCommand: jobAdmission.commandAdmission.canonicalCommand
    });
  }
  return violations;
}

function validateJobProcessAdmission(jobAdmission, envelope) {
  if (!jobAdmission.present || jobAdmission.sourceKind !== 'job-json-file') return [];
  const violations = [];
  if (envelope.command !== JOB_RUN_PROCESS_COMMAND) {
    violations.push({
      code: 'job-run-process-command-required',
      message: 'cli-run .job.json admission must create an AI OS process with the aios:job-run command',
      expectedCommand: JOB_RUN_PROCESS_COMMAND,
      actualCommand: envelope.command
    });
  }
  if (envelope.args[0] !== jobAdmission.sourcePath) {
    violations.push({
      code: 'job-run-source-argument-required',
      message: 'cli-run .job.json admission must pass the descriptor path as argv[1]',
      expectedSourcePath: jobAdmission.sourcePath,
      actualArgs: envelope.args
    });
  }
  if (!jobAdmission.process.create) {
    violations.push({
      code: 'job-run-process-create-disabled',
      message: 'cli-run .job.json admission requires AI OS process creation to remain enabled',
      sourcePath: jobAdmission.sourcePath
    });
  }
  return violations;
}

function providerContractInput(input, persistedState) {
  if (input.providerContract && typeof input.providerContract === 'object') return input.providerContract;
  if (input.provider && typeof input.provider === 'object') return input.provider;
  if (input.serviceProvider && typeof input.serviceProvider === 'object') return input.serviceProvider;
  if (persistedState.providerContract && typeof persistedState.providerContract === 'object') return persistedState.providerContract;
  return {};
}

function normalizeProviderContract(input, persistedState) {
  const candidate = providerContractInput(input, persistedState || {});
  const rawCapabilities = normalizeStringList(candidate.capabilities || candidate.negotiatedCapabilities);
  const capabilities = rawCapabilities.length
    ? rawCapabilities.filter((capability) => PROVIDER_CAPABILITIES.has(capability))
    : DEFAULT_PROVIDER_CONTRACT.capabilities;
  const rejectedCapabilities = rawCapabilities.filter((capability) => !PROVIDER_CAPABILITIES.has(capability));
  const requestedMode = normalizeIdentifier(candidate.handoffMode || candidate.mode, DEFAULT_PROVIDER_CONTRACT.handoffMode);
  const handoffMode = ['hosted-kernel', 'external-provider', 'audit-only'].includes(requestedMode)
    ? requestedMode
    : DEFAULT_PROVIDER_CONTRACT.handoffMode;

  return {
    contract: {
      providerId: normalizeIdentifier(candidate.providerId || candidate.id, DEFAULT_PROVIDER_CONTRACT.providerId),
      service: normalizeIdentifier(candidate.service || candidate.serviceName, DEFAULT_PROVIDER_CONTRACT.service),
      version: normalizeIdentifier(candidate.version || candidate.contractVersion, DEFAULT_PROVIDER_CONTRACT.version),
      enabled: normalizeBoolean(candidate.enabled, DEFAULT_PROVIDER_CONTRACT.enabled),
      capabilities,
      handoffMode,
      endpoint: normalizeIdentifier(candidate.endpoint || candidate.url, DEFAULT_PROVIDER_CONTRACT.endpoint),
      syncCursor: normalizeIdentifier(candidate.syncCursor || candidate.cursor, DEFAULT_PROVIDER_CONTRACT.syncCursor)
    },
    rejectedCapabilities,
    requestedMode
  };
}

function executionInput(input, jobAdmission = null) {
  if (input.execution && typeof input.execution === 'object') return input.execution;
  if (input.exec && typeof input.exec === 'object') return input.exec;
  if (input.command && typeof input.command === 'object' && input.command.execution && typeof input.command.execution === 'object') {
    return input.command.execution;
  }
  if (jobAdmission?.present) {
    return {
      env: jobAdmission.environment,
      stdin: jobAdmission.stdin,
      cwd: jobAdmission.cwd
    };
  }
  return {};
}

function normalizeEnvName(value) {
  const name = normalizeIdentifier(value, null);
  return name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : null;
}

function normalizeEnvironment(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const env = {};
  const rejected = [];

  for (const [key, rawValue] of Object.entries(raw)) {
    const name = normalizeEnvName(key);
    if (!name) {
      rejected.push({ name: key, reason: 'invalid-env-name' });
      continue;
    }
    if (rawValue === undefined || rawValue === null) continue;
    env[name] = String(rawValue);
  }

  return {
    env: Object.fromEntries(Object.entries(env).sort(([left], [right]) => left.localeCompare(right))),
    rejected
  };
}

function workspacePathEnvironmentInput(input, executionCandidate) {
  const candidate = executionCandidate.pathEnvironment && typeof executionCandidate.pathEnvironment === 'object'
    ? executionCandidate.pathEnvironment
    : input.pathEnvironment && typeof input.pathEnvironment === 'object'
      ? input.pathEnvironment
      : {};
  return {
    names: normalizeStringList(candidate.names || candidate.envNames || input.workspacePathEnvNames),
    allowHostPathNames: normalizeBoolean(candidate.allowHostPathNames, false),
    enabled: normalizeBoolean(candidate.enabled, true)
  };
}

function shouldTreatEnvironmentValueAsWorkspacePath(name, policy) {
  if (!policy.enabled) return false;
  if (policy.names.includes(name)) return true;
  if (HOST_ENV_PATH_NAMES.has(name) && !policy.allowHostPathNames) return false;
  return WORKSPACE_PATH_ENV_NAME.test(name);
}

function splitEnvironmentPathValue(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const separator = text.includes(';') && !text.includes(':') ? ';' : ':';
  return text
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeWorkspaceEnvironmentValue(name, value, workspaceRoot) {
  const upperName = name.toUpperCase();
  const parts = upperName.endsWith('PATHS') || upperName.endsWith('FILES')
    ? splitEnvironmentPathValue(value)
    : [String(value || '').trim()].filter(Boolean);
  return parts.map((part) => normalizeWorkspacePath(workspaceRoot, part));
}

function projectWorkspacePathEnvironment(env, workspaceRoot, policy) {
  const entries = [];
  const rejected = [];

  for (const [name, value] of Object.entries(env)) {
    if (!shouldTreatEnvironmentValueAsWorkspacePath(name, policy)) continue;
    const paths = normalizeWorkspaceEnvironmentValue(name, value, workspaceRoot);
    if (paths.length === 0) {
      rejected.push({ name, reason: 'empty-workspace-path-env-value' });
      continue;
    }
    entries.push({
      name,
      values: paths,
      inScope: paths.every((path) => path.inScope)
    });
  }

  return {
    contract: WORKSPACE_PATH_ENV_CONTRACT,
    workspaceRoot: normalizeWorkspacePath(workspaceRoot, workspaceRoot).workspaceRoot,
    policy: {
      enabled: policy.enabled,
      explicitNames: policy.names,
      allowHostPathNames: policy.allowHostPathNames,
      convention: 'AIOS_/CLI_RUN_/WORKSPACE_ names ending PATH, PATHS, DIR, DIRECTORY, FILE, FILES, or ROOT'
    },
    entries: entries.sort((left, right) => left.name.localeCompare(right.name)),
    rejected
  };
}

function redactEnvironment(env) {
  return Object.fromEntries(Object.entries(env).map(([name, value]) => [
    name,
    SENSITIVE_ENV_NAME.test(name) ? '[redacted]' : value
  ]));
}

function estimateByteLength(value) {
  return typeof value === 'string' ? new TextEncoder().encode(value).length : 0;
}

function normalizeExecutionPlan(input, envelope, now, jobAdmission = null) {
  const candidate = executionInput(input, jobAdmission);
  const policyInput = candidate.policy && typeof candidate.policy === 'object' ? candidate.policy : candidate;
  const environment = normalizeEnvironment(candidate.env || candidate.environment || input.env);
  const workspacePathEnvironment = projectWorkspacePathEnvironment(
    environment.env,
    envelope.workspaceRoot,
    workspacePathEnvironmentInput(input, candidate)
  );
  const stdin = typeof candidate.stdin === 'string'
    ? candidate.stdin
    : typeof input.stdin === 'string'
      ? input.stdin
      : null;
  const timeoutMs = normalizePositiveInteger(policyInput.timeoutMs, DEFAULT_EXECUTION_POLICY.timeoutMs, { min: 1000, max: 60 * 60 * 1000 });
  const maxOutputBytes = normalizePositiveInteger(policyInput.maxOutputBytes, DEFAULT_EXECUTION_POLICY.maxOutputBytes, { min: 1024, max: 100 * 1024 * 1024 });
  const stdinBytesLimit = normalizePositiveInteger(policyInput.stdinBytesLimit, DEFAULT_EXECUTION_POLICY.stdinBytesLimit, { min: 0, max: 10 * 1024 * 1024 });

  return {
    contract: HOSTED_KERNEL_EXECUTION_CONTRACT,
    planId: `${envelope.commandId}:execution`,
    projectedAt: now,
    commandId: envelope.commandId,
    argv: [envelope.command].concat(envelope.args),
    cwd: envelope.cwd.normalized,
    workspaceRoot: envelope.cwd.workspaceRoot,
    environment: redactEnvironment(environment.env),
    environmentKeys: Object.keys(environment.env),
    rejectedEnvironment: environment.rejected,
    workspacePathEnvironment,
    stdin: {
      present: stdin !== null,
      byteLength: estimateByteLength(stdin),
      storage: stdin === null ? null : 'ephemeral-hosted-kernel-input'
    },
    policy: {
      timeoutMs,
      maxOutputBytes,
      stdinBytesLimit,
      envVarLimit: normalizePositiveInteger(policyInput.envVarLimit, DEFAULT_EXECUTION_POLICY.envVarLimit, { min: 0, max: 256 }),
      captureStdout: normalizeBoolean(policyInput.captureStdout, true),
      captureStderr: normalizeBoolean(policyInput.captureStderr, true)
    },
    providerRequirements: requiredProviderCapabilities(envelope),
    outputContract: {
      stdout: 'bounded-buffer',
      stderr: 'bounded-buffer',
      exitCode: 'integer-or-null',
      terminalStatus: Array.from(TERMINAL_STATUSES).sort()
    },
    source: {
      type: jobAdmission?.present ? 'job-run' : 'direct-command',
      jobId: jobAdmission?.jobId || null,
      jobRunId: jobAdmission?.requestedRunId || null,
      sourcePath: jobAdmission?.sourcePath || null
    }
  };
}

function validateExecutionPlan(executionPlan) {
  const violations = [];
  if (executionPlan.argv.length === 0 || !executionPlan.argv[0]) {
    violations.push({
      code: 'execution-plan-missing-command',
      message: 'cli-run hosted-kernel execution plan requires argv[0]'
    });
  }
  if (executionPlan.rejectedEnvironment.length > 0) {
    violations.push({
      code: 'execution-plan-invalid-environment',
      message: 'cli-run environment variables must use POSIX-compatible names',
      rejectedEnvironment: executionPlan.rejectedEnvironment
    });
  }
  if (executionPlan.environmentKeys.length > executionPlan.policy.envVarLimit) {
    violations.push({
      code: 'execution-plan-env-limit-exceeded',
      message: 'cli-run hosted-kernel execution plan exceeds the configured environment variable limit',
      envVarLimit: executionPlan.policy.envVarLimit,
      environmentVariableCount: executionPlan.environmentKeys.length
    });
  }
  if (executionPlan.stdin.byteLength > executionPlan.policy.stdinBytesLimit) {
    violations.push({
      code: 'execution-plan-stdin-limit-exceeded',
      message: 'cli-run hosted-kernel execution plan exceeds the configured stdin byte limit',
      stdinBytesLimit: executionPlan.policy.stdinBytesLimit,
      stdinByteLength: executionPlan.stdin.byteLength
    });
  }
  if (executionPlan.workspacePathEnvironment.rejected.length > 0) {
    violations.push({
      code: 'execution-plan-invalid-workspace-path-environment',
      message: 'cli-run workspace path environment values must contain at least one path segment',
      rejectedEnvironment: executionPlan.workspacePathEnvironment.rejected
    });
  }
  const outOfScopeEnvironmentPaths = executionPlan.workspacePathEnvironment.entries
    .flatMap((entry) => entry.values
      .filter((path) => !path.inScope)
      .map((path) => ({
        name: entry.name,
        raw: path.raw,
        normalized: path.normalized,
        workspaceRoot: path.workspaceRoot
      })));
  if (outOfScopeEnvironmentPaths.length > 0) {
    violations.push({
      code: 'execution-plan-workspace-path-env-out-of-scope',
      message: 'cli-run hosted-kernel path environment values must resolve inside the declared workspace root',
      environmentPaths: outOfScopeEnvironmentPaths
    });
  }
  return violations;
}

function clientRequestInput(input) {
  if (input.clientRequest && typeof input.clientRequest === 'object') return input.clientRequest;
  if (input.clientState && typeof input.clientState === 'object') return input.clientState;
  if (input.requestState && typeof input.requestState === 'object') return input.requestState;
  return {};
}

function normalizeClientTransport(value) {
  const transport = normalizeIdentifier(value, 'cli');
  return CLIENT_TRANSPORTS.has(transport) ? transport : 'cli';
}

function normalizeClientRequest(input, envelope, now) {
  const candidate = clientRequestInput(input);
  const requestId = normalizeIdentifier(candidate.requestId || input.requestId, `request:${envelope.commandId}`);
  const sessionId = normalizeIdentifier(candidate.sessionId || candidate.clientSessionId || input.sessionId, `session:${envelope.actor.actorId}`);
  const traceId = normalizeIdentifier(candidate.traceId || input.traceId, `${requestId}:${now}`);
  const transport = normalizeClientTransport(candidate.transport || input.transport);
  const desiredAck = normalizeIdentifier(candidate.expectedAck || candidate.ackToken, null);
  const workflowIntent = normalizeIdentifier(candidate.workflowIntent || candidate.intent || input.workflowIntent, null);

  return {
    contract: CLIENT_CONTINUATION_CONTRACT,
    requestId,
    sessionId,
    traceId,
    transport,
    workflowIntent,
    interactive: normalizeBoolean(candidate.interactive, transport === 'cli' || transport === 'web-terminal'),
    resumeToken: normalizeIdentifier(candidate.resumeToken, null),
    desiredAck,
    returnChannel: {
      type: normalizeIdentifier(candidate.returnChannel?.type || candidate.channelType, transport),
      target: normalizeIdentifier(candidate.returnChannel?.target || candidate.callbackUrl || candidate.streamId, null)
    },
    submittedAt: normalizeIdentifier(candidate.submittedAt, now)
  };
}

function projectJobRunClientHandoff(clientRequest, jobAdmission, processCreation, externalHandoff, accepted, idempotentReplay, blockedBy, now) {
  if (!jobAdmission?.present || !processCreation) return null;

  const fileBackedJobRun = jobAdmission.sourceKind === 'job-json-file';
  const processReady = processCreation.state === 'ready-for-create' || processCreation.state === 'ready-with-degraded-provider';
  const blocked = blockedBy.length > 0 || processCreation.state === 'blocked';
  const degraded = processCreation.state === 'ready-with-degraded-provider' || processCreation.state === 'degraded-audit-only';
  const expectedProviderAck = externalHandoff.sync.expectedAck;
  const processAck = processReady || idempotentReplay
    ? `aios-process:${processCreation.processId}:${processCreation.epoch}`
    : null;
  const visibleState = blocked
    ? 'blocked'
    : idempotentReplay
      ? 'resume-existing-process'
      : processReady
        ? 'process-create-ready'
        : degraded
          ? 'process-create-degraded'
          : accepted
            ? 'process-admitted'
            : 'awaiting-admission';
  const handoffAction = blocked
    ? processCreation.admissionHealth.nextAction
    : fileBackedJobRun
      ? 'create-aios-process-from-job-descriptor'
      : 'handoff-inline-job-command';

  return {
    contract: JOB_RUN_CLIENT_HANDOFF_CONTRACT,
    generatedAt: now,
    requestId: clientRequest.requestId,
    traceId: clientRequest.traceId,
    state: visibleState,
    route: processCreation.admission.route,
    action: handoffAction,
    processId: processCreation.processId,
    processName: processCreation.process.name,
    createRequested: processCreation.process.createRequested,
    descriptor: {
      sourceKind: jobAdmission.sourceKind,
      sourcePath: jobAdmission.sourcePath,
      examplesHelloJob: Boolean(processCreation.source.descriptorBoundary?.examplesHelloJob),
      safeForProcessCreation: processCreation.admission.descriptorScopedForCreation
    },
    runtime: {
      admissionCommand: processCreation.runtime.admissionCommand,
      launchCommand: processCreation.runtime.launchCommand,
      cwd: processCreation.runtime.cwd,
      providerId: processCreation.runtime.providerId,
      handoffMode: processCreation.runtime.handoffMode
    },
    ack: {
      processExpected: processAck,
      providerExpected: expectedProviderAck,
      clientDesired: clientRequest.desiredAck,
      resumeToken: clientRequest.resumeToken || processAck || expectedProviderAck
    },
    resume: {
      scope: fileBackedJobRun ? 'aios-process' : 'cli-command',
      pollTarget: processReady || idempotentReplay ? processCreation.processId : normalizeIdentifier(processCreation.commandId, null),
      interactiveStatusAction: clientRequest.interactive ? 'show-aios-process-status' : 'poll-aios-process-status'
    },
    acceptance: {
      required: processCreation.acceptancePreview.acceptanceRequired,
      state: processCreation.acceptancePreview.state,
      nextStep: processCreation.acceptancePreview.nextStep
    },
    blockedBy
  };
}

function projectClientContinuation(clientRequest, envelope, externalHandoff, nextAction, violations, accepted, idempotentReplay, now, leaseMs, jobAdmission = null, processCreation = null, mailchimpCampaignHandoff = null) {
  const leaseExpiresAt = new Date(parseTime(now, Date.now()) + leaseMs).toISOString();
  const providerAck = externalHandoff.sync.expectedAck;
  const continuationAck = providerAck || `cli-run:rejected:${envelope.commandId}:${clientRequest.requestId}`;
  const blockedBy = violations.map((violation) => violation.code);
  const jobRunHandoff = projectJobRunClientHandoff(clientRequest, jobAdmission, processCreation, externalHandoff, accepted, idempotentReplay, blockedBy, now);
  const terminal = TERMINAL_STATUSES.has(envelope.requestedStatus) || envelope.result !== null || envelope.error;
  const state = blockedBy.length
    ? 'blocked'
    : idempotentReplay
      ? 'already-recorded'
      : terminal
        ? 'terminal-state-recorded'
        : accepted && externalHandoff.state === 'ready-for-handoff'
          ? 'handoff-ready'
          : accepted
            ? externalHandoff.state
            : 'observing';

  const workflowSteps = [];
  if (blockedBy.length) {
    workflowSteps.push({
      type: 'repair-request',
      status: 'required',
      reason: blockedBy[0],
      action: nextAction.action || 'correct-command-envelope-and-resubmit'
    });
  } else if (jobRunHandoff && jobRunHandoff.state === 'process-create-ready') {
    workflowSteps.push({
      type: 'aios-process-creation',
      status: 'ready',
      contract: jobRunHandoff.contract,
      processId: jobRunHandoff.processId,
      sourcePath: jobRunHandoff.descriptor.sourcePath,
      expectedAck: jobRunHandoff.ack.processExpected,
      action: jobRunHandoff.action
    });
  } else if (jobRunHandoff && jobRunHandoff.state === 'resume-existing-process') {
    workflowSteps.push({
      type: 'aios-process-resume',
      status: 'ready',
      contract: jobRunHandoff.contract,
      processId: jobRunHandoff.processId,
      expectedAck: jobRunHandoff.ack.processExpected,
      action: 'resume-aios-process-status'
    });
  } else if (mailchimpCampaignHandoff?.accepted) {
    workflowSteps.push({
      type: 'mailchimp-campaign-proof-handoff',
      status: 'ready',
      contract: mailchimpCampaignHandoff.contract,
      campaignId: mailchimpCampaignHandoff.campaignId,
      audienceId: mailchimpCampaignHandoff.audienceId,
      payloadRef: mailchimpCampaignHandoff.handoff.payloadRef,
      action: 'attach-mailchimp-log-proof'
    });
  } else if (externalHandoff.state === 'ready-for-handoff') {
    workflowSteps.push({
      type: 'provider-handoff',
      status: 'ready',
      providerId: externalHandoff.providerId,
      expectedAck: providerAck,
      action: 'send-command-to-hosted-kernel-provider'
    });
  } else if (externalHandoff.state === 'audit-only') {
    workflowSteps.push({
      type: 'audit-handoff',
      status: 'ready',
      providerId: externalHandoff.providerId,
      action: 'record-proof-without-provider-execution'
    });
  }

  if (mailchimpCampaignHandoff?.accepted && !workflowSteps.some((step) => step.type === 'mailchimp-campaign-proof-handoff')) {
    workflowSteps.push({
      type: 'mailchimp-campaign-proof-handoff',
      status: 'ready',
      contract: mailchimpCampaignHandoff.contract,
      campaignId: mailchimpCampaignHandoff.campaignId,
      audienceId: mailchimpCampaignHandoff.audienceId,
      payloadRef: mailchimpCampaignHandoff.handoff.payloadRef,
      action: 'attach-mailchimp-log-proof'
    });
  }

  if (!terminal && !blockedBy.length) {
    workflowSteps.push({
      type: 'client-resume',
      status: 'pending',
      resumeToken: clientRequest.resumeToken || jobRunHandoff?.ack.resumeToken || continuationAck,
      action: jobRunHandoff?.resume.interactiveStatusAction || (clientRequest.interactive ? 'show-live-command-status' : 'poll-continuation-status')
    });
  }

  return {
    contract: CLIENT_CONTINUATION_CONTRACT,
    state,
    at: now,
    commandId: envelope.commandId,
    requestId: clientRequest.requestId,
    sessionId: clientRequest.sessionId,
    traceId: clientRequest.traceId,
    transport: clientRequest.transport,
    interactive: clientRequest.interactive,
    ack: {
      expected: continuationAck,
      desired: clientRequest.desiredAck,
      providerExpected: providerAck,
      processExpected: jobRunHandoff?.ack.processExpected || null,
      matchesClientExpectation: clientRequest.desiredAck
        ? [
          continuationAck,
          providerAck,
          jobRunHandoff?.ack.processExpected,
          jobRunHandoff?.ack.resumeToken
        ].filter(Boolean).includes(clientRequest.desiredAck)
        : null
    },
    lease: {
      acquiredAt: accepted || idempotentReplay ? now : null,
      expiresAt: accepted || idempotentReplay ? leaseExpiresAt : null,
      leaseMs
    },
    returnChannel: clientRequest.returnChannel,
    nextAction,
    jobRunHandoff,
    mailchimpCampaignHandoff,
    workflowSteps,
    blockedBy
  };
}

function requiredProviderCapabilities(envelope) {
  const required = new Set(['executeCommand', 'auditProof', 'syncState']);
  if (envelope.mutatesWorkspace || envelope.writePaths.length > 0) required.add('writeWorkspace');
  if (envelope.requestedStatus === 'running') required.add('streamLogs');
  if (envelope.requestedStatus === 'cancelled') required.add('cancelCommand');
  return Array.from(required).sort();
}

function validateProviderContract(provider, envelope) {
  const violations = [];
  if (!provider.contract.enabled) {
    violations.push({
      code: 'provider-contract-disabled',
      message: 'cli-run provider contract is disabled and cannot accept command handoff',
      providerId: provider.contract.providerId
    });
  }
  if (provider.rejectedCapabilities.length > 0) {
    violations.push({
      code: 'provider-capability-unsupported',
      message: 'cli-run provider contract declared unsupported capabilities',
      rejectedCapabilities: provider.rejectedCapabilities
    });
  }
  if (provider.requestedMode !== provider.contract.handoffMode) {
    violations.push({
      code: 'provider-handoff-mode-unsupported',
      message: 'cli-run provider handoff mode must be hosted-kernel, external-provider, or audit-only',
      requestedMode: provider.requestedMode
    });
  }
  if (provider.contract.handoffMode === 'external-provider' && !provider.contract.endpoint) {
    violations.push({
      code: 'provider-endpoint-required',
      message: 'cli-run external provider handoff requires an endpoint'
    });
  }

  const missingCapabilities = requiredProviderCapabilities(envelope)
    .filter((capability) => !provider.contract.capabilities.includes(capability));
  if (missingCapabilities.length > 0) {
    violations.push({
      code: 'provider-capability-missing',
      message: 'cli-run provider contract is missing capabilities required for this command',
      providerId: provider.contract.providerId,
      missingCapabilities
    });
  }
  return violations;
}

function projectProviderHandoff(provider, envelope, accepted, violations, now, epoch) {
  const requiredCapabilities = requiredProviderCapabilities(envelope);
  const acceptedForHandoff = accepted && violations.length === 0 && provider.contract.handoffMode !== 'audit-only';
  return {
    state: acceptedForHandoff ? 'ready-for-handoff' : violations.length ? 'blocked' : 'audit-only',
    at: now,
    providerId: provider.contract.providerId,
    service: provider.contract.service,
    version: provider.contract.version,
    handoffMode: provider.contract.handoffMode,
    endpoint: provider.contract.endpoint,
    commandId: envelope.commandId,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    requiredCapabilities,
    negotiatedCapabilities: provider.contract.capabilities,
    sync: {
      contract: 'aios.cli-run.provider-sync.v1',
      cursor: provider.contract.syncCursor,
      epoch,
      expectedAck: acceptedForHandoff ? `cli-run:${envelope.commandId}:${epoch}` : null
    },
    blockedBy: violations
      .filter((violation) => violation.code.startsWith('provider-'))
      .map((violation) => violation.code)
  };
}

function classifyProcessAdmissionViolation(code) {
  if (code.startsWith('mailchimp-')) return 'mailchimp-campaign';
  if (code.startsWith('job-run-descriptor-') || code === 'job-run-source-argument-required') return 'descriptor-boundary';
  if (code.startsWith('job-run-')) return 'job-run-admission';
  if (code.startsWith('provider-')) return 'provider-health';
  if (code.startsWith('execution-plan-')) return 'execution-plan';
  if (code.startsWith('cli-run-') || code.includes('lifecycle')) return 'lifecycle';
  if (code.includes('permission') || code.includes('isolation') || code.includes('tenant') || code.includes('workspace')) return 'security-boundary';
  return 'command-envelope';
}

function actionForProcessAdmissionViolation(code) {
  if (code === 'job-run-descriptor-path-out-of-scope') return 'move-descriptor-under-workspace-root';
  if (code === 'job-run-descriptor-argument-mismatch' || code === 'job-run-source-argument-required') return 'resubmit-with-descriptor-path-as-first-argument';
  if (code === 'job-run-descriptor-tenant-mismatch') return 'align-job-descriptor-tenant-with-command-envelope';
  if (code === 'job-run-descriptor-workspace-mismatch') return 'align-job-descriptor-workspace-with-command-envelope';
  if (code === 'job-run-process-command-required') return 'route-job-json-through-aios-job-run-command';
  if (code === 'job-run-process-create-disabled') return 'enable-aios-process-creation-for-job-run';
  if (code === 'provider-contract-disabled') return 'enable-provider-contract-or-switch-provider';
  if (code === 'provider-capability-missing') return 'select-provider-with-required-capabilities';
  if (code === 'provider-endpoint-required') return 'configure-external-provider-endpoint';
  if (code === 'cli-run-paused') return 'resume-cli-run-lifecycle';
  if (code === 'cli-run-disabled') return 'enable-cli-run-lifecycle';
  if (code === 'cli-run-scheduled') return 'wait-for-lifecycle-schedule-window';
  if (code === 'cli-run-concurrency-limit') return 'wait-for-active-command-slot';
  if (code === 'insufficient-permissions') return 'grant-required-cli-permissions-or-use-authorized-actor';
  if (code.includes('isolation')) return 'adjust-actor-tenant-workspace-scope';
  if (code.startsWith('execution-plan-')) return 'repair-hosted-kernel-execution-plan';
  if (code === 'mailchimp-campaign-id-required') return 'select-mailchimp-campaign';
  if (code === 'mailchimp-audience-id-required') return 'select-mailchimp-audience';
  if (code === 'mailchimp-provider-unauthorized') return 'reconnect-mailchimp-provider';
  if (code === 'mailchimp-provider-offline') return 'restore-mailchimp-provider';
  if (code.startsWith('mailchimp-campaign-')) return 'repair-mailchimp-campaign-state';
  if (code === 'mailchimp-scheduled-at-invalid') return 'repair-mailchimp-schedule';
  return 'correct-command-envelope-and-resubmit';
}

function summarizeValidationForJobRun(violations) {
  const groups = {};
  for (const violation of violations) {
    const category = classifyProcessAdmissionViolation(violation.code);
    const group = groups[category] || {
      category,
      status: 'passed',
      violationCodes: [],
      nextActions: []
    };
    group.status = 'blocked';
    group.violationCodes.push(violation.code);
    const action = actionForProcessAdmissionViolation(violation.code);
    if (!group.nextActions.includes(action)) group.nextActions.push(action);
    groups[category] = group;
  }

  return [
    'command-envelope',
    'security-boundary',
    'job-run-admission',
    'descriptor-boundary',
    'execution-plan',
    'mailchimp-campaign',
    'provider-health',
    'lifecycle'
  ].map((category) => groups[category] || {
    category,
    status: 'passed',
    violationCodes: [],
    nextActions: []
  });
}

function projectJobRunAcceptancePreview(jobAdmission, jobDescriptorBoundary, executionPlan, provider, accepted, violations, now) {
  const fileBackedJobRun = jobAdmission.present && jobAdmission.sourceKind === 'job-json-file';
  const validationSummary = summarizeValidationForJobRun(violations);
  const blockedBy = violations.map((violation) => violation.code);
  const descriptorReady = !fileBackedJobRun || Boolean(jobDescriptorBoundary?.safeForProcessCreation);
  const providerReady = provider.contract.enabled && provider.contract.handoffMode !== 'audit-only';
  const executionReady = !blockedBy.some((code) => code.startsWith('execution-plan-'));
  const mailchimpReady = !jobAdmission.mailchimpCampaign.present || jobAdmission.mailchimpCampaign.deliveryReadiness.canAttachLogProof;
  const acceptanceRequired = jobAdmission.present && Boolean(jobAdmission.process?.create);
  const acceptanceState = blockedBy.length
    ? 'blocked'
    : accepted
      ? 'accepted'
      : acceptanceRequired
        ? 'preview-ready'
        : 'not-required';
  const readiness = {
    descriptor: descriptorReady ? 'ready' : 'blocked',
    executionPlan: executionReady ? 'ready' : 'blocked',
    mailchimpCampaign: !jobAdmission.mailchimpCampaign.present
      ? 'not-present'
      : mailchimpReady
        ? 'ready'
        : jobAdmission.mailchimpCampaign.state,
    provider: providerReady ? 'ready' : provider.contract.handoffMode === 'audit-only' ? 'audit-only' : 'blocked',
    acceptance: acceptanceState
  };
  const nextStep = blockedBy.length
    ? {
      action: actionForProcessAdmissionViolation(blockedBy[0]),
      reason: blockedBy[0],
      required: true
    }
    : accepted
      ? {
        action: fileBackedJobRun ? 'create-aios-process' : 'handoff-command-to-provider',
        reason: null,
        required: true
      }
      : acceptanceRequired
        ? {
          action: 'present-job-run-preview-for-acceptance',
          reason: 'awaiting-user-acceptance',
          required: true
        }
        : {
          action: 'observe-direct-command-admission',
          reason: null,
          required: false
        };

  return {
    contract: JOB_RUN_ACCEPTANCE_PREVIEW_CONTRACT,
    generatedAt: now,
    present: jobAdmission.present,
    acceptanceRequired,
    accepted,
    state: acceptanceState,
    readiness,
    preview: {
      title: jobAdmission.jobName || jobAdmission.jobId || jobAdmission.sourcePath || executionPlan.argv[0] || 'cli-run command',
      sourceKind: jobAdmission.sourceKind,
      sourcePath: jobAdmission.sourcePath,
      examplesHelloJob: Boolean(jobDescriptorBoundary?.examplesHelloJob),
      command: {
        admissionArgv: executionPlan.argv,
        launchArgv: fileBackedJobRun && jobAdmission.commandSpec.command
          ? [jobAdmission.commandSpec.command].concat(jobAdmission.commandSpec.args)
          : executionPlan.argv,
        cwd: executionPlan.cwd,
        timeoutMs: executionPlan.policy.timeoutMs,
        stdinPresent: executionPlan.stdin.present
      },
      process: {
        createRequested: jobAdmission.process?.create ?? false,
        requestedProcessId: jobAdmission.process?.requestedProcessId || null,
        name: jobAdmission.process?.name || null,
        restartPolicy: jobAdmission.process?.restartPolicy || 'never'
      },
      provider: {
        providerId: provider.contract.providerId,
        handoffMode: provider.contract.handoffMode,
        requiredCapabilities: executionPlan.providerRequirements,
        negotiatedCapabilities: provider.contract.capabilities
      },
      mailchimpCampaign: {
        present: jobAdmission.mailchimpCampaign.present,
        state: jobAdmission.mailchimpCampaign.state,
        campaignId: jobAdmission.mailchimpCampaign.campaignId,
        audienceId: jobAdmission.mailchimpCampaign.audienceId,
        canAttachLogProof: jobAdmission.mailchimpCampaign.deliveryReadiness.canAttachLogProof,
        reason: jobAdmission.mailchimpCampaign.deliveryReadiness.reason
      }
    },
    validationSummary,
    nextStep,
    blockedBy
  };
}

function projectProcessAdmissionHealth(jobAdmission, jobDescriptorBoundary, provider, accepted, violations, now, retryPolicy) {
  const blockers = violations.map((violation) => ({
    code: violation.code,
    category: classifyProcessAdmissionViolation(violation.code),
    action: actionForProcessAdmissionViolation(violation.code),
    retryableAfterRepair: !violation.code.startsWith('provider-contract-disabled')
  }));
  const categories = Array.from(new Set(blockers.map((blocker) => blocker.category))).sort();
  const providerDegraded = !provider.contract.enabled || provider.contract.handoffMode === 'audit-only';
  const descriptorReady = !jobDescriptorBoundary?.fileBackedJobRun || Boolean(jobDescriptorBoundary.safeForProcessCreation);
  const examplesHelloJobReady = jobDescriptorBoundary?.examplesHelloJob
    ? descriptorReady && jobAdmission.commandAdmission.canonicalCommand === JOB_RUN_PROCESS_COMMAND
    : null;
  const canDegradeToAuditOnly = provider.contract.handoffMode === 'audit-only' && blockers.every((blocker) => blocker.category === 'provider-health');
  const retryable = blockers.length === 0
    ? false
    : blockers.every((blocker) => blocker.retryableAfterRepair);

  return {
    contract: 'aios.process-creation.admission-health.v1',
    evaluatedAt: now,
    status: blockers.length
      ? canDegradeToAuditOnly
        ? 'degraded-audit-only'
        : 'blocked'
      : providerDegraded
        ? 'degraded'
        : accepted
          ? 'healthy'
          : 'observing',
    route: jobAdmission.commandAdmission.route,
    examplesHelloJobReady,
    descriptorReady,
    providerReady: provider.contract.enabled && provider.contract.handoffMode !== 'audit-only',
    retry: {
      retryable,
      mode: retryable ? 'repair-and-resubmit' : blockers.length ? 'operator-intervention-required' : 'not-needed',
      nextDelayMs: retryable ? retryDelayMs(1, retryPolicy) : 0,
      retryAfter: retryable ? new Date(parseTime(now, Date.now()) + retryDelayMs(1, retryPolicy)).toISOString() : null,
      maxAttempts: retryPolicy.maxAttempts,
      backoffHint: retryable ? 'apply-cli-run-retry-policy-after-request-repair' : null
    },
    degradedMode: {
      active: providerDegraded || canDegradeToAuditOnly,
      mode: canDegradeToAuditOnly ? 'audit-only' : providerDegraded ? provider.contract.handoffMode : null,
      preservesAuditProof: provider.contract.capabilities.includes('auditProof')
    },
    blockers,
    blockerCategories: categories,
    nextAction: blockers[0]?.action || (accepted ? 'create-aios-process' : 'observe-process-admission')
  };
}

function projectAiosProcessCreation(jobAdmission, envelope, executionPlan, provider, accepted, violations, now, epoch, jobDescriptorBoundary = null, retryPolicy = DEFAULT_RETRY_POLICY) {
  const blockedBy = violations.map((violation) => violation.code);
  const requestedProcessKey = jobAdmission.process?.requestedProcessId
    || jobAdmission.requestedRunId
    || jobAdmission.jobId
    || envelope.commandId;
  const processId = jobAdmission.present
    ? `process:${envelope.tenantId}:${envelope.workspaceId}:${normalizeProcessToken(requestedProcessKey, envelope.commandId)}`
    : `process:${envelope.commandId}`;
  const fileBackedJobRun = jobAdmission.present && jobAdmission.sourceKind === 'job-json-file';
  const launchCommand = fileBackedJobRun && jobAdmission.commandSpec.command
    ? [jobAdmission.commandSpec.command].concat(jobAdmission.commandSpec.args)
    : executionPlan.argv;
  const admissionHealth = projectProcessAdmissionHealth(jobAdmission, jobDescriptorBoundary, provider, accepted, violations, now, retryPolicy);
  const acceptancePreview = projectJobRunAcceptancePreview(jobAdmission, jobDescriptorBoundary, executionPlan, provider, accepted, violations, now);

  return {
    contract: AIOS_PROCESS_CREATION_CONTRACT,
    state: accepted && blockedBy.length === 0
      ? admissionHealth.degradedMode.active
        ? 'ready-with-degraded-provider'
        : 'ready-for-create'
      : admissionHealth.status === 'degraded-audit-only'
        ? 'degraded-audit-only'
        : blockedBy.length
          ? 'blocked'
          : 'observing',
    requestedAt: now,
    epoch,
    processId,
    commandId: envelope.commandId,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    actorId: envelope.actor.actorId,
    process: {
      name: jobAdmission.process?.name || normalizeProcessToken(jobAdmission.jobName || envelope.command, 'job-run'),
      createRequested: jobAdmission.process?.create ?? false,
      restartPolicy: jobAdmission.process?.restartPolicy || 'never'
    },
    source: {
      kind: jobAdmission.sourceKind,
      descriptorContract: jobAdmission.descriptorContract,
      jobId: jobAdmission.jobId,
      jobName: jobAdmission.jobName,
      jobRunId: jobAdmission.requestedRunId,
      sourcePath: jobAdmission.sourcePath,
      descriptorBoundary: jobDescriptorBoundary,
      mailchimpCampaign: jobAdmission.mailchimpCampaign,
      labels: jobAdmission.labels
    },
    runtime: {
      providerId: provider.contract.providerId,
      handoffMode: provider.contract.handoffMode,
      requiredCapabilities: requiredProviderCapabilities(envelope),
      admissionCommand: executionPlan.argv,
      launchCommand,
      cwd: executionPlan.cwd,
      workspaceRoot: executionPlan.workspaceRoot,
      environmentKeys: executionPlan.environmentKeys,
      stdinPresent: executionPlan.stdin.present,
      timeoutMs: executionPlan.policy.timeoutMs
    },
    admission: {
      route: jobAdmission.commandAdmission.route,
      canonicalCommand: jobAdmission.commandAdmission.canonicalCommand,
      descriptorPathArgument: jobAdmission.commandAdmission.descriptorPathArgument,
      innerCommand: jobAdmission.commandAdmission.innerCommand,
      processCreateRequested: jobAdmission.process?.create ?? false,
      descriptorScopedForCreation: jobDescriptorBoundary?.safeForProcessCreation ?? !fileBackedJobRun,
      previewState: acceptancePreview.state,
      nextStepAction: acceptancePreview.nextStep.action
    },
    acceptancePreview,
    admissionHealth,
    restartSafe: {
      leaseOwner: executionPlan.commandId,
      idempotencyKey: jobAdmission.idempotencyKey,
      expectedInitialStatus: envelope.requestedStatus || 'queued'
    },
    blockedBy
  };
}

function projectMailchimpJobRunHandoff(jobAdmission, envelope, processCreation, clientRequest, accepted, violations, now) {
  const campaign = jobAdmission.mailchimpCampaign;
  if (!campaign?.present) {
    return {
      contract: JOB_RUN_MAILCHIMP_HANDOFF_CONTRACT,
      present: false,
      accepted: false,
      state: 'not-present',
      generatedAt: now,
      reason: 'No Mailchimp campaign was declared for this job run.'
    };
  }

  const blockedBy = violations
    .filter((violation) => violation.code.startsWith('mailchimp-'))
    .map((violation) => violation.code);
  const processReady = processCreation.state === 'ready-for-create' || processCreation.state === 'ready-with-degraded-provider';
  const acceptedForProof = accepted
    && blockedBy.length === 0
    && processReady
    && campaign.deliveryReadiness.canAttachLogProof;
  const state = blockedBy.length
    ? 'blocked'
    : acceptedForProof
      ? 'ready'
      : campaign.state === 'rate-limited' || campaign.state === 'degraded'
        ? campaign.state
        : processReady
          ? 'awaiting-log-proof'
          : 'awaiting-process-admission';

  return {
    contract: JOB_RUN_MAILCHIMP_HANDOFF_CONTRACT,
    present: true,
    accepted: acceptedForProof,
    state,
    generatedAt: now,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    commandId: envelope.commandId,
    requestId: clientRequest.requestId,
    processId: processCreation.processId,
    provider: 'mailchimp',
    campaignId: campaign.campaignId,
    audienceId: campaign.audienceId,
    providerState: campaign.providerState,
    campaignStatus: campaign.campaignStatus,
    validation: blockedBy,
    freshness: {
      syncCursor: campaign.syncCursor,
      lastSyncAt: campaign.generatedAt,
      stale: false
    },
    retry: campaign.retry,
    deliveryReadiness: {
      canAttachLogProof: acceptedForProof,
      canContinueInDegradedMode: campaign.deliveryReadiness.canContinueInDegradedMode,
      disabledCommands: acceptedForProof ? [] : ['mailchimp-proof-attach'],
      reason: acceptedForProof
        ? 'Mailchimp campaign log proof handoff is ready.'
        : blockedBy[0] || campaign.deliveryReadiness.reason
    },
    handoff: {
      route: `/operator-userland/cli-run/mailchimp/${encodeURIComponent(envelope.commandId)}/proof`,
      payloadRef: `cli-run:mailchimp:${envelope.commandId}:${campaign.campaignId}`,
      proofDigest: digestPayload({
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
        commandId: envelope.commandId,
        requestId: clientRequest.requestId,
        processId: processCreation.processId,
        campaignId: campaign.campaignId,
        audienceId: campaign.audienceId,
        state
      })
    },
    actionableErrors: blockedBy.map((code) => ({
      id: `mailchimp:${code}`,
      code,
      severity: code === 'mailchimp-provider-unauthorized' ? 'error' : 'warning',
      message: `Mailchimp campaign handoff requires repair: ${code}`,
      retryable: campaign.retry.retryable
    }))
  };
}

function retryDelayMs(attempts, retryPolicy) {
  const retryAttempt = Math.max(0, attempts - 1);
  const exponentialDelay = retryPolicy.baseDelayMs * (2 ** retryAttempt);
  return Math.min(retryPolicy.maxDelayMs, exponentialDelay);
}

function stableCommandId(envelope) {
  if (typeof envelope.commandId === 'string' && envelope.commandId.trim()) {
    return envelope.commandId.trim();
  }

  const tenantId = normalizeIdentifier(envelope.tenantId, 'unscoped-tenant');
  const workspaceId = normalizeIdentifier(envelope.workspaceId, 'unscoped-workspace');
  const command = typeof envelope.command === 'string' ? envelope.command.trim() : 'unknown';
  const args = Array.isArray(envelope.args) ? envelope.args.map(String).join('\u001f') : '';
  return `cli:${tenantId}:${workspaceId}:${command}:${args}`;
}

function normalizeStatus(value) {
  if (TERMINAL_STATUSES.has(value) || ACTIVE_STATUSES.has(value)) {
    return value;
  }
  return 'queued';
}

function normalizePersistedLease(value) {
  const lease = value && typeof value === 'object' ? value : {};
  return {
    contract: COMMAND_LEASE_CONTRACT,
    ownerRequestId: normalizeIdentifier(lease.ownerRequestId || lease.requestId, null),
    resumeToken: normalizeIdentifier(lease.resumeToken, null),
    acquiredAt: normalizeIdentifier(lease.acquiredAt, null),
    expiresAt: normalizeIdentifier(lease.expiresAt, null),
    generation: Number.isInteger(lease.generation) && lease.generation >= 0 ? lease.generation : 0,
    recoveryState: normalizeIdentifier(lease.recoveryState, 'unknown')
  };
}

function normalizeIdempotencyKey(value) {
  const key = normalizeIdentifier(value, null);
  return key ? key.slice(0, 512) : null;
}

function commandIdempotencyKey(envelope, clientRequest) {
  return normalizeIdempotencyKey(clientRequest.desiredAck)
    || normalizeIdempotencyKey(clientRequest.resumeToken)
    || normalizeIdempotencyKey(clientRequest.requestId)
    || `command:${envelope.commandId}`;
}

function buildPersistenceIndexes(commandsById, persistedIndex = {}) {
  const idempotencyIndex = {};
  for (const [key, commandId] of Object.entries(persistedIndex || {})) {
    const normalizedKey = normalizeIdempotencyKey(key);
    const normalizedCommandId = normalizeIdentifier(commandId, null);
    if (normalizedKey && normalizedCommandId && commandsById[normalizedCommandId]) {
      idempotencyIndex[normalizedKey] = normalizedCommandId;
    }
  }

  for (const record of Object.values(commandsById)) {
    const keys = [
      record.idempotencyKey,
      record.clientRequest?.desiredAck,
      record.clientRequest?.resumeToken,
      record.clientRequest?.requestId
    ].map(normalizeIdempotencyKey).filter(Boolean);

    for (const key of keys) {
      if (!idempotencyIndex[key]) idempotencyIndex[key] = record.commandId;
    }
  }

  return {
    idempotencyIndex,
    commandCount: Object.keys(commandsById).length,
    idempotencyKeyCount: Object.keys(idempotencyIndex).length
  };
}

function normalizePersistedState(candidate = {}, now) {
  const state = candidate && typeof candidate === 'object' ? candidate : {};
  const rawCommands = state.commandsById && typeof state.commandsById === 'object'
    ? state.commandsById
    : {};
  const commandsById = {};
  const recoveredCommandIds = [];

  for (const [commandId, record] of Object.entries(rawCommands)) {
    if (!record || typeof record !== 'object') continue;

    const lastTransitionAt = record.lastTransitionAt || record.updatedAt || record.createdAt || now;
    const normalized = {
      commandId,
      command: typeof record.command === 'string' && record.command.trim() ? record.command.trim() : 'unknown',
      args: Array.isArray(record.args) ? record.args.map(String) : [],
      tenantId: normalizeIdentifier(record.tenantId, 'legacy-tenant'),
      workspaceId: normalizeIdentifier(record.workspaceId, 'legacy-workspace'),
      actorId: normalizeIdentifier(record.actorId, 'unknown'),
      role: normalizeIdentifier(record.role, 'viewer'),
      permissions: Array.isArray(record.permissions) ? record.permissions.map(String).sort() : [],
      workspaceRoot: normalizeIdentifier(record.workspaceRoot, '/workspace'),
      cwd: record.cwd ?? null,
      writePaths: Array.isArray(record.writePaths) ? record.writePaths : [],
      status: normalizeStatus(record.status),
      attempts: Number.isInteger(record.attempts) && record.attempts >= 0 ? record.attempts : 0,
      createdAt: record.createdAt || now,
      lastTransitionAt,
      result: record.result ?? null,
      error: record.error ?? null,
      proof: Array.isArray(record.proof) ? record.proof : [],
      providerContract: record.providerContract && typeof record.providerContract === 'object' ? record.providerContract : null,
      executionPlan: record.executionPlan && typeof record.executionPlan === 'object' ? record.executionPlan : null,
      jobAdmission: record.jobAdmission && typeof record.jobAdmission === 'object' ? record.jobAdmission : null,
      jobDescriptorBoundary: record.jobDescriptorBoundary && typeof record.jobDescriptorBoundary === 'object' ? record.jobDescriptorBoundary : null,
      processCreation: record.processCreation && typeof record.processCreation === 'object' ? record.processCreation : null,
      clientRequest: record.clientRequest && typeof record.clientRequest === 'object' ? record.clientRequest : null,
      clientContinuation: record.clientContinuation && typeof record.clientContinuation === 'object' ? record.clientContinuation : null,
      idempotencyKey: normalizeIdempotencyKey(record.idempotencyKey || record.clientRequest?.desiredAck || record.clientRequest?.resumeToken || record.clientRequest?.requestId),
      lease: normalizePersistedLease(record.lease || record.clientContinuation?.lease)
    };

    if (ACTIVE_STATUSES.has(normalized.status)) {
      normalized.status = 'recovering';
      normalized.lastTransitionAt = now;
      normalized.proof = normalized.proof.concat({
        type: 'restart-recovery',
        at: now,
        previousTransitionAt: lastTransitionAt
      });
      recoveredCommandIds.push(commandId);
    }

    commandsById[commandId] = normalized;
  }

  const indexes = buildPersistenceIndexes(commandsById, state.idempotencyIndex);

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    contract: PERSISTED_STATE_CONTRACT,
    runId: typeof state.runId === 'string' && state.runId.trim() ? state.runId.trim() : `cli-run:${now}`,
    epoch: Number.isInteger(state.epoch) && state.epoch >= 0 ? state.epoch : 0,
    commandsById,
    idempotencyIndex: indexes.idempotencyIndex,
    persistenceIndex: {
      contract: 'aios.cli-run.persistence-index.v1',
      commandCount: indexes.commandCount,
      idempotencyKeyCount: indexes.idempotencyKeyCount
    },
    historySnapshots: Array.isArray(state.historySnapshots)
      ? state.historySnapshots.filter((snapshot) => snapshot && typeof snapshot === 'object').slice(-20)
      : [],
    recoveredCommandIds
  };
}

function buildCommandEnvelope(input, jobAdmission = null) {
  const envelope = input.command && typeof input.command === 'object'
    ? input.command
    : input;
  const control = normalizeLifecycleControl(input);
  const fileBackedJobRun = jobAdmission?.present && jobAdmission.sourceKind === 'job-json-file';
  const jobCommand = jobAdmission?.present && !fileBackedJobRun ? jobAdmission.commandSpec.command : '';
  const fallbackJobCommand = fileBackedJobRun ? JOB_RUN_PROCESS_COMMAND : '';
  const fallbackLifecycleCommand = control.rawAction && !envelope.command && !jobCommand && !fallbackJobCommand ? `lifecycle:${control.rawAction}` : '';
  const commandText = typeof envelope.command === 'string' && envelope.command.trim()
    ? fileBackedJobRun ? JOB_RUN_PROCESS_COMMAND : envelope.command.trim()
    : jobCommand || fallbackJobCommand || fallbackLifecycleCommand;
  const args = fileBackedJobRun
    ? [jobAdmission.sourcePath].concat(Array.isArray(envelope.args)
        ? envelope.args.map(String).filter((arg) => arg !== jobAdmission.sourcePath)
        : [])
    : Array.isArray(envelope.args)
      ? envelope.args.map(String)
      : jobAdmission?.present && jobAdmission.commandSpec.args.length
        ? jobAdmission.commandSpec.args
        : [];
  const boundary = normalizeTenantBoundary(envelope, input);
  const workspaceRoot = normalizeIdentifier(envelope.workspaceRoot || jobAdmission?.workspaceRoot || input.workspaceRoot, '/workspace');
  const cwd = normalizeWorkspacePath(workspaceRoot, envelope.cwd || jobAdmission?.cwd || input.cwd || workspaceRoot);
  const writePaths = (Array.isArray(envelope.writePaths)
    ? envelope.writePaths
    : Array.isArray(input.writePaths)
      ? input.writePaths
      : jobAdmission?.writePaths || [])
    .map((candidate) => normalizeWorkspacePath(workspaceRoot, candidate));
  const mutatesWorkspace = Boolean(envelope.mutatesWorkspace || input.mutatesWorkspace || jobAdmission?.mutatesWorkspace || writePaths.length);
  const tenantId = boundary.tenantId || jobAdmission?.tenantId;
  const workspaceId = boundary.workspaceId || jobAdmission?.workspaceId;
  const actor = jobAdmission?.actor && Object.keys(jobAdmission.actor).length
    ? normalizeTenantBoundary({ ...envelope, tenantId, workspaceId, actor: jobAdmission.actor }, input).actor
    : boundary.actor;

  return {
    commandId: stableCommandId({
      ...envelope,
      commandId: envelope.commandId || input.commandId || jobAdmission?.requestedRunId || jobAdmission?.idempotencyKey,
      command: commandText,
      tenantId,
      workspaceId,
      args
    }),
    command: commandText,
    args,
    tenantId,
    workspaceId,
    actor,
    workspaceRoot,
    cwd,
    writePaths,
    mutatesWorkspace,
    requiredPermissions: requiredPermissionsForCommand({ command: commandText, writePaths, mutatesWorkspace }),
    requestedStatus: envelope.status,
    result: envelope.result ?? null,
    error: envelope.error ?? null
  };
}

function validateEnvelope(envelope) {
  const violations = [];
  const isolation = projectTenantIsolationContract(envelope);
  if (!envelope.command) {
    violations.push({
      code: 'missing-command',
      message: 'cli-run requires a non-empty command string before it can persist command state'
    });
  }
  if (envelope.args.some((arg) => arg.includes('\u0000'))) {
    violations.push({
      code: 'invalid-argument',
      message: 'cli-run arguments must not contain null bytes'
    });
  }
  if (!envelope.tenantId) {
    violations.push({
      code: 'missing-tenant',
      message: 'cli-run requires a tenantId before accepting hosted-kernel command state'
    });
  }
  if (!envelope.workspaceId) {
    violations.push({
      code: 'missing-workspace',
      message: 'cli-run requires a workspaceId before accepting hosted-kernel command state'
    });
  }
  const missingPermissions = envelope.requiredPermissions.filter((permission) => !envelope.actor.permissions.includes(permission));
  if (missingPermissions.length > 0) {
    violations.push({
      code: 'insufficient-permissions',
      message: 'cli-run actor does not hold the permissions required for this command boundary',
      missingPermissions
    });
  }
  if (isolation.requiresAdminForUnboundedScope) {
    violations.push({
      code: 'tenant-isolation-unbounded-scope-requires-admin',
      message: 'cli-run actors declaring unbounded tenant or workspace scope must hold cli:admin',
      tenantScope: isolation.tenantScope,
      workspaceScope: isolation.workspaceScope
    });
  }
  if (!isolation.tenantAuthorized) {
    violations.push({
      code: 'tenant-isolation-scope-denied',
      message: 'cli-run actor scope does not include the requested tenant boundary',
      actorId: envelope.actor.actorId,
      requestedTenantId: envelope.tenantId,
      tenantScope: isolation.tenantScope
    });
  }
  if (!isolation.workspaceAuthorized) {
    violations.push({
      code: 'workspace-isolation-scope-denied',
      message: 'cli-run actor scope does not include the requested workspace boundary',
      actorId: envelope.actor.actorId,
      requestedWorkspaceId: envelope.workspaceId,
      workspaceScope: isolation.workspaceScope
    });
  }
  if (!envelope.cwd.inScope) {
    violations.push({
      code: 'workspace-cwd-out-of-scope',
      message: 'cli-run cwd must resolve inside the declared workspace root',
      cwd: envelope.cwd
    });
  }
  const outOfScopeWrites = envelope.writePaths.filter((candidate) => !candidate.inScope);
  if (outOfScopeWrites.length > 0) {
    violations.push({
      code: 'workspace-write-out-of-scope',
      message: 'cli-run write paths must resolve inside the declared workspace root',
      writePaths: outOfScopeWrites
    });
  }
  return violations;
}

function validateLifecycleAdmission(envelope, lifecycle, restartSafe, nowMs) {
  const violations = [];
  if (LIFECYCLE_COMMANDS.has(envelope.command)) return violations;

  if (!lifecycle.enabled) {
    violations.push({
      code: 'cli-run-disabled',
      message: 'cli-run lifecycle is disabled and will not accept new commands',
      disabledReason: lifecycle.disabledReason
    });
  }
  if (lifecycle.paused || lifecycle.mode === 'manual') {
    violations.push({
      code: 'cli-run-paused',
      message: 'cli-run lifecycle is paused or in manual mode and requires resume before command admission',
      mode: lifecycle.mode,
      paused: lifecycle.paused
    });
  }
  if (lifecycle.notBefore && Date.parse(lifecycle.notBefore) > nowMs) {
    violations.push({
      code: 'cli-run-scheduled',
      message: 'cli-run lifecycle schedule has not opened yet',
      notBefore: lifecycle.notBefore
    });
  }
  if (envelope.mutatesWorkspace && lifecycle.allowWriteCommands === false) {
    violations.push({
      code: 'cli-run-write-disabled',
      message: 'cli-run lifecycle settings currently block workspace-mutating commands'
    });
  }
  if (restartSafe.activeCommandIds.length >= lifecycle.maxActiveCommands) {
    violations.push({
      code: 'cli-run-concurrency-limit',
      message: 'cli-run lifecycle active command limit has been reached',
      maxActiveCommands: lifecycle.maxActiveCommands,
      activeCommandIds: restartSafe.activeCommandIds
    });
  }
  return violations;
}

function deriveNextStatus(envelope, existing) {
  if (TERMINAL_STATUSES.has(existing?.status)) return existing.status;
  if (existing && (existing.tenantId !== envelope.tenantId || existing.workspaceId !== envelope.workspaceId)) {
    return 'failed';
  }
  if (envelope.error) return 'failed';
  if (envelope.result !== null || envelope.requestedStatus === 'completed') return 'completed';
  if (envelope.requestedStatus === 'running') return 'running';
  return existing?.status === 'recovering' ? 'recovering' : 'queued';
}

function validateExistingBoundary(envelope, existing) {
  if (!existing) return [];
  const violations = [];
  if (existing.tenantId !== envelope.tenantId) {
    violations.push({
      code: 'tenant-command-replay-mismatch',
      message: 'cli-run commandId already belongs to a different tenant boundary',
      existingTenantId: existing.tenantId,
      requestedTenantId: envelope.tenantId
    });
  }
  if (existing.workspaceId !== envelope.workspaceId) {
    violations.push({
      code: 'workspace-command-replay-mismatch',
      message: 'cli-run commandId already belongs to a different workspace boundary',
      existingWorkspaceId: existing.workspaceId,
      requestedWorkspaceId: envelope.workspaceId
    });
  }
  return violations;
}

function sameCommandBoundary(envelope, record) {
  return record
    && record.tenantId === envelope.tenantId
    && record.workspaceId === envelope.workspaceId
    && record.command === envelope.command
    && JSON.stringify(record.args || []) === JSON.stringify(envelope.args || []);
}

function findIdempotentRecord(state, envelope, idempotencyKey) {
  const commandRecord = state.commandsById[envelope.commandId];
  if (commandRecord) return { record: commandRecord, reason: 'command-id-match', key: idempotencyKey };

  const indexedCommandId = idempotencyKey ? state.idempotencyIndex[idempotencyKey] : null;
  const indexedRecord = indexedCommandId ? state.commandsById[indexedCommandId] : null;
  if (indexedRecord && sameCommandBoundary(envelope, indexedRecord)) {
    return { record: indexedRecord, reason: 'idempotency-key-match', key: idempotencyKey };
  }
  return { record: null, reason: null, key: idempotencyKey };
}

function validateIdempotencyBoundary(envelope, state, idempotencyKey) {
  const indexedCommandId = idempotencyKey ? state.idempotencyIndex[idempotencyKey] : null;
  const indexedRecord = indexedCommandId ? state.commandsById[indexedCommandId] : null;
  if (!indexedRecord || sameCommandBoundary(envelope, indexedRecord)) return [];

  return [{
    code: 'idempotency-key-replay-mismatch',
    message: 'cli-run idempotency key already belongs to a different command boundary',
    idempotencyKey,
    existingCommandId: indexedRecord.commandId,
    requestedCommandId: envelope.commandId,
    existingTenantId: indexedRecord.tenantId,
    requestedTenantId: envelope.tenantId,
    existingWorkspaceId: indexedRecord.workspaceId,
    requestedWorkspaceId: envelope.workspaceId
  }];
}

function projectCommandLease(commandId, clientRequest, existingLease, now, nowMs, leaseMs, status, accepted, idempotentReplay) {
  const previousGeneration = Number.isInteger(existingLease?.generation) ? existingLease.generation : 0;
  const shouldAcquire = accepted || idempotentReplay;
  const expiresAt = shouldAcquire
    ? new Date(nowMs + leaseMs).toISOString()
    : normalizeIdentifier(existingLease?.expiresAt, null);
  const expired = expiresAt ? parseTime(expiresAt, nowMs) <= nowMs : false;

  return {
    contract: COMMAND_LEASE_CONTRACT,
    commandId,
    ownerRequestId: shouldAcquire ? clientRequest.requestId : normalizeIdentifier(existingLease?.ownerRequestId, clientRequest.requestId),
    resumeToken: shouldAcquire ? clientRequest.resumeToken || `cli-run:resume:${commandId}` : normalizeIdentifier(existingLease?.resumeToken, null),
    acquiredAt: shouldAcquire ? now : normalizeIdentifier(existingLease?.acquiredAt, null),
    expiresAt,
    leaseMs,
    generation: shouldAcquire ? previousGeneration + 1 : previousGeneration,
    restartSafeStatus: TERMINAL_STATUSES.has(status)
      ? 'terminal'
      : expired
        ? 'expired-needs-recovery'
        : status === 'recovering'
          ? 'recovering'
          : 'held',
    expired
  };
}

function projectRestartSafeStatus(state, nowMs, leaseMs) {
  const active = [];
  const terminal = [];
  const stale = [];
  const leaseExpired = [];
  const leases = [];

  for (const record of Object.values(state.commandsById)) {
    const leaseExpiresAt = normalizeIdentifier(record.lease?.expiresAt, null);
    const leaseExpiredNow = leaseExpiresAt ? parseTime(leaseExpiresAt, nowMs) <= nowMs : false;
    leases.push({
      commandId: record.commandId,
      status: record.status,
      ownerRequestId: record.lease?.ownerRequestId || record.clientRequest?.requestId || null,
      expiresAt: leaseExpiresAt,
      expired: leaseExpiredNow,
      generation: record.lease?.generation || 0,
      recoveryState: TERMINAL_STATUSES.has(record.status)
        ? 'terminal'
        : leaseExpiredNow
          ? 'expired-needs-recovery'
          : record.status === 'recovering'
            ? 'recovering'
            : 'active'
    });
    if (TERMINAL_STATUSES.has(record.status)) {
      terminal.push(record.commandId);
      continue;
    }

    active.push(record.commandId);
    const lastTransitionMs = parseTime(record.lastTransitionAt, nowMs);
    if (leaseExpiredNow || nowMs - lastTransitionMs > leaseMs) {
      stale.push(record.commandId);
    }
    if (leaseExpiredNow) leaseExpired.push(record.commandId);
  }

  return {
    status: stale.length ? 'needs-recovery' : active.length ? 'active' : 'idle',
    activeCommandIds: active,
    terminalCommandIds: terminal,
    staleCommandIds: stale,
    leaseExpiredCommandIds: leaseExpired,
    leases
  };
}

function recordIdempotencyKeys(record) {
  return [
    record.idempotencyKey,
    record.clientRequest?.desiredAck,
    record.clientRequest?.resumeToken,
    record.clientRequest?.requestId,
    record.jobAdmission?.idempotencyKey,
    record.jobAdmission?.requestedRunId
  ].map(normalizeIdempotencyKey).filter(Boolean);
}

function processExpectedAck(record) {
  const processCreation = record.processCreation;
  if (!processCreation?.processId) return null;
  const epoch = Number.isInteger(processCreation.epoch) ? processCreation.epoch : null;
  return epoch === null ? null : `aios-process:${processCreation.processId}:${epoch}`;
}

function classifyRestartRecoveryAction(record, leaseRow, nowMs, leaseMs) {
  if (TERMINAL_STATUSES.has(record.status)) return 'observe-terminal-command';
  if (leaseRow?.expired) return 'recover-expired-command-lease';
  if (record.status === 'recovering' && record.jobAdmission?.present && record.processCreation?.process?.createRequested) {
    if (record.processCreation.state === 'ready-for-create' || record.processCreation.state === 'ready-with-degraded-provider') {
      return 'resume-aios-process-status';
    }
    return 'rebuild-aios-process-creation-from-job-descriptor';
  }
  if (record.status === 'recovering') return 'sync-hosted-kernel-command-state';
  const lastTransitionMs = parseTime(record.lastTransitionAt, nowMs);
  return nowMs - lastTransitionMs > leaseMs
    ? 'refresh-command-lease-before-admission'
    : 'observe-active-command-lease';
}

function projectRestartRecoveryPlan(state, restartSafe, now, nowMs, leaseMs) {
  const leaseByCommandId = Object.fromEntries(restartSafe.leases.map((lease) => [lease.commandId, lease]));
  const records = Object.values(state.commandsById)
    .filter((record) => !TERMINAL_STATUSES.has(record.status) || state.recoveredCommandIds.includes(record.commandId))
    .map((record) => {
      const lease = leaseByCommandId[record.commandId] || null;
      const action = classifyRestartRecoveryAction(record, lease, nowMs, leaseMs);
      const descriptorPath = record.jobAdmission?.sourcePath || record.processCreation?.source?.sourcePath || null;
      const processId = record.processCreation?.processId || null;
      const expectedAck = processExpectedAck(record) || record.clientContinuation?.ack?.processExpected || null;
      const restartSafeStatus = lease?.recoveryState || (record.status === 'recovering' ? 'recovering' : 'active');

      return {
        commandId: record.commandId,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        status: record.status,
        restartSafeStatus,
        action,
        lease: {
          ownerRequestId: lease?.ownerRequestId || record.lease?.ownerRequestId || null,
          expiresAt: lease?.expiresAt || record.lease?.expiresAt || null,
          expired: Boolean(lease?.expired),
          generation: lease?.generation || record.lease?.generation || 0
        },
        idempotency: {
          keys: Array.from(new Set(recordIdempotencyKeys(record))).sort(),
          replayCommandId: record.commandId,
          replaySafe: restartSafeStatus !== 'expired-needs-recovery' || action === 'recover-expired-command-lease'
        },
        jobRun: {
          present: Boolean(record.jobAdmission?.present),
          sourceKind: record.jobAdmission?.sourceKind || null,
          sourcePath: descriptorPath,
          examplesHelloJob: descriptorPath === 'examples/hello.job.json' || Boolean(record.jobDescriptorBoundary?.examplesHelloJob),
          route: record.jobAdmission?.commandAdmission?.route || record.processCreation?.admission?.route || null
        },
        process: {
          processId,
          state: record.processCreation?.state || null,
          expectedAck,
          resumeToken: record.clientContinuation?.jobRunHandoff?.ack?.resumeToken || record.lease?.resumeToken || expectedAck,
          createRequested: Boolean(record.processCreation?.process?.createRequested || record.jobAdmission?.process?.create)
        },
        nextPollAfter: action === 'observe-active-command-lease'
          ? new Date(Math.min(parseTime(record.lease?.expiresAt, nowMs), nowMs + leaseMs)).toISOString()
          : now
      };
    })
    .sort((left, right) => left.tenantId.localeCompare(right.tenantId)
      || left.workspaceId.localeCompare(right.workspaceId)
      || left.commandId.localeCompare(right.commandId));

  const actionCounts = {};
  for (const record of records) {
    addCounter(actionCounts, record.action);
  }

  return {
    contract: RESTART_RECOVERY_PLAN_CONTRACT,
    generatedAt: now,
    status: restartSafe.staleCommandIds.length
      ? 'operator-recovery-required'
      : records.some((record) => record.status === 'recovering')
        ? 'provider-sync-required'
        : records.length
          ? 'observing-active-commands'
          : 'clear',
    recoveredCommandIds: state.recoveredCommandIds,
    staleCommandIds: restartSafe.staleCommandIds,
    leaseExpiredCommandIds: restartSafe.leaseExpiredCommandIds,
    actionCounts: sortCounterObject(actionCounts),
    records,
    idempotentReplay: {
      acceptedKeys: Array.from(new Set(records.flatMap((record) => record.idempotency.keys))).sort(),
      semantics: 'same tenant/workspace/command/argv replays resume the persisted command instead of creating another AI OS process'
    }
  };
}

function projectClientStatusBridge({
  state,
  envelope,
  clientRequest,
  lifecycleState,
  restartSafe,
  restartRecoveryPlan,
  operationalHealth,
  nextAction,
  accepted,
  idempotentReplay,
  replayedCommandId,
  requestIdempotencyKey,
  violations,
  now
}) {
  const persistedCommandId = replayedCommandId || envelope.commandId;
  const commandRecord = state.commandsById[persistedCommandId] || null;
  const recoveryRecord = restartRecoveryPlan.records.find((record) => record.commandId === persistedCommandId) || null;
  const leaseRow = restartSafe.leases.find((lease) => lease.commandId === persistedCommandId) || null;
  const validationState = violations.length ? 'blocked' : accepted || idempotentReplay ? 'accepted' : 'pending';
  const recoveryState = restartRecoveryPlan.status === 'clear'
    ? 'clear'
    : restartRecoveryPlan.status === 'operator-recovery-required'
      ? 'operator-action-required'
      : 'sync-required';
  const readinessState = violations.length
    ? 'blocked'
    : restartSafe.staleCommandIds.includes(persistedCommandId)
      ? 'recovery-required'
      : lifecycleState.readiness === 'blocked'
        ? 'blocked'
        : operationalHealth.status === 'degraded'
          ? 'degraded'
          : 'ready';
  const terminal = commandRecord ? TERMINAL_STATUSES.has(commandRecord.status) : false;
  const active = commandRecord ? ACTIVE_STATUSES.has(commandRecord.status) : false;
  const safeResume = Boolean(
    commandRecord
      && !violations.length
      && (active || terminal || idempotentReplay)
      && lifecycleState.readiness !== 'blocked'
      && !restartSafe.leaseExpiredCommandIds.includes(persistedCommandId)
  );
  const safeRetry = Boolean(
    !violations.length
      && commandRecord
      && !terminal
      && (
        restartSafe.staleCommandIds.includes(persistedCommandId)
        || recoveryRecord?.action === 'recover-expired-command-lease'
        || operationalHealth.retryQueue.some((item) => item.commandId === persistedCommandId)
      )
  );
  const safeHandoff = Boolean(
    !violations.length
      && commandRecord
      && (restartRecoveryPlan.status !== 'clear' || operationalHealth.status !== 'healthy')
  );
  const bridgeProof = {
    contract: CLIENT_STATUS_BRIDGE_CONTRACT,
    commandId: envelope.commandId,
    persistedCommandId,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    requestId: clientRequest.requestId,
    idempotencyKey: requestIdempotencyKey,
    validationState,
    readinessState,
    recoveryState,
    commandStatus: commandRecord?.status || 'not-persisted',
    restartSafeStatus: leaseRow?.recoveryState || recoveryRecord?.restartSafeStatus || 'unknown',
    recoveryAction: recoveryRecord?.action || null,
    accepted,
    idempotentReplay,
    generatedAt: now
  };
  const routeBase = `/operator-userland/cli-run/tenants/${encodeURIComponent(envelope.tenantId || 'unknown')}/workspaces/${encodeURIComponent(envelope.workspaceId || 'unknown')}`;
  const recoveryRoutes = restartRecoveryPlan.records
    .filter((record) => record.tenantId === envelope.tenantId && record.workspaceId === envelope.workspaceId)
    .slice(0, 8)
    .map((record) => ({
      rel: record.commandId === persistedCommandId ? 'current-command-recovery' : 'workspace-command-recovery',
      commandId: record.commandId,
      action: record.action,
      enabled: record.idempotency.replaySafe,
      route: `${routeBase}/commands/${encodeURIComponent(record.commandId)}/recovery`,
      expectedAck: record.process.expectedAck,
      resumeToken: record.process.resumeToken,
      nextPollAfter: record.nextPollAfter
    }));

  return {
    contract: CLIENT_STATUS_BRIDGE_CONTRACT,
    generatedAt: now,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    commandId: envelope.commandId,
    persistedCommandId,
    requestId: clientRequest.requestId,
    sessionId: clientRequest.sessionId,
    idempotencyKey: requestIdempotencyKey,
    accepted,
    idempotentReplay,
    validation: {
      state: validationState,
      ok: violations.length === 0,
      violationCodes: violations.map((violation) => violation.code),
      firstViolation: violations[0]?.message || null
    },
    readiness: {
      state: readinessState,
      lifecycle: lifecycleState.readiness,
      operationalHealth: operationalHealth.status,
      restartRecovery: restartRecoveryPlan.status,
      ready: readinessState === 'ready',
      safeResume,
      safeRetry,
      safeHandoff
    },
    persistedCommand: commandRecord
      ? {
        status: commandRecord.status,
        attempts: commandRecord.attempts,
        createdAt: commandRecord.createdAt,
        lastTransitionAt: commandRecord.lastTransitionAt,
        resultPresent: commandRecord.result !== null,
        errorPresent: commandRecord.error !== null,
        processId: commandRecord.processCreation?.processId || null,
        clientContinuationState: commandRecord.clientContinuation?.state || null
      }
      : null,
    lease: leaseRow
      ? {
        ownerRequestId: leaseRow.ownerRequestId,
        expiresAt: leaseRow.expiresAt,
        expired: leaseRow.expired,
        generation: leaseRow.generation,
        restartSafeStatus: leaseRow.recoveryState
      }
      : null,
    recovery: {
      state: recoveryState,
      action: recoveryRecord?.action || null,
      staleCommandIds: restartRecoveryPlan.staleCommandIds,
      leaseExpiredCommandIds: restartRecoveryPlan.leaseExpiredCommandIds,
      actionCounts: restartRecoveryPlan.actionCounts,
      idempotentReplayKeys: restartRecoveryPlan.idempotentReplay.acceptedKeys,
      routes: recoveryRoutes
    },
    nextStep: {
      action: safeRetry
        ? 'recover-command'
        : safeResume
          ? 'resume-command'
          : safeHandoff
            ? 'prepare-dashboard-handoff'
            : nextAction.action,
      reason: violations[0]?.message || recoveryRecord?.action || nextAction.reason,
      route: safeRetry || recoveryRecord
        ? `${routeBase}/commands/${encodeURIComponent(persistedCommandId)}/recovery`
        : `${routeBase}/commands/${encodeURIComponent(persistedCommandId)}`,
      pollAfter: recoveryRecord?.nextPollAfter || null
    },
    clientStatePatch: {
      cliRunStatusContract: CLIENT_STATUS_BRIDGE_CONTRACT,
      commandId: persistedCommandId,
      commandStatus: commandRecord?.status || 'not-persisted',
      readinessState,
      recoveryState,
      restartSafeStatus: leaseRow?.recoveryState || recoveryRecord?.restartSafeStatus || 'unknown',
      idempotentReplay,
      idempotencyKey: requestIdempotencyKey,
      nextAction: safeRetry ? 'recover-command' : safeResume ? 'resume-command' : nextAction.action
    },
    proof: bridgeProof
  };
}

function classifyFailure(record, staleCommandIds) {
  if (staleCommandIds.has(record.commandId)) {
    return {
      code: 'command-lease-expired',
      severity: 'warning',
      message: 'Command lease expired before a terminal state was recorded',
      action: 'recover-or-retry-command'
    };
  }
  if (record.status === 'recovering') {
    return {
      code: 'command-recovery-pending',
      severity: 'warning',
      message: 'Command was active during restart and needs hosted-kernel recovery',
      action: 'resume-command-or-mark-failed'
    };
  }
  if (record.status === 'failed') {
    return {
      code: 'command-failed',
      severity: 'error',
      message: record.error?.message || 'Command failed before completion',
      action: 'inspect-error-and-retry-if-safe'
    };
  }
  return null;
}

function projectRetryState(record, nowMs, retryPolicy) {
  if (record.status !== 'failed') return null;

  const attempts = Number.isInteger(record.attempts) && record.attempts > 0 ? record.attempts : 1;
  const retryable = attempts < retryPolicy.maxAttempts && record.error?.retryable !== false;
  const delayMs = retryDelayMs(attempts, retryPolicy);
  const lastTransitionMs = parseTime(record.lastTransitionAt, nowMs);
  const retryAfterMs = lastTransitionMs + delayMs;

  return {
    retryable,
    attempts,
    maxAttempts: retryPolicy.maxAttempts,
    delayMs,
    retryAfter: new Date(retryAfterMs).toISOString(),
    blockedReason: retryable ? null : attempts >= retryPolicy.maxAttempts ? 'max-attempts-exhausted' : 'error-marked-non-retryable'
  };
}

function projectOperationalHealth(state, restartSafe, nowMs, retryPolicy, validationViolations) {
  const staleCommandIds = new Set(restartSafe.staleCommandIds);
  const failures = [];
  const retryQueue = [];
  const actionableErrors = [];

  for (const record of Object.values(state.commandsById)) {
    const failure = classifyFailure(record, staleCommandIds);
    if (!failure) continue;

    const retry = projectRetryState(record, nowMs, retryPolicy);
    const item = {
      commandId: record.commandId,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      status: record.status,
      attempts: record.attempts,
      failure,
      retry
    };
    failures.push(item);
    if (retry?.retryable) retryQueue.push(item);
    actionableErrors.push({
      code: failure.code,
      severity: failure.severity,
      commandId: record.commandId,
      action: failure.action,
      retryAfter: retry?.retryable ? retry.retryAfter : null
    });
  }

  for (const violation of validationViolations) {
    actionableErrors.push({
      code: violation.code,
      severity: 'error',
      commandId: null,
      action: violation.code === 'insufficient-permissions'
        ? 'grant-required-permissions-or-run-as-authorized-actor'
        : violation.code.includes('isolation')
          ? 'adjust-actor-tenant-workspace-scope-or-use-admin-boundary'
        : 'correct-command-envelope-and-resubmit',
      details: violation
    });
  }

  const degradedReasons = [];
  if (restartSafe.staleCommandIds.length > 0) degradedReasons.push('stale-command-lease');
  if (state.recoveredCommandIds.length > 0) degradedReasons.push('restart-recovery-required');
  if (failures.some((item) => item.failure.severity === 'error')) degradedReasons.push('failed-command-present');
  if (validationViolations.length > 0) degradedReasons.push('invalid-command-envelope');

  return {
    status: degradedReasons.length ? 'degraded' : 'healthy',
    degraded: degradedReasons.length > 0,
    degradedReasons,
    retryPolicy,
    retryQueue,
    failures,
    actionableErrors
  };
}

function projectRecoveryHealthHandoff({ state, restartSafe, restartRecoveryPlan, operationalHealth, lifecycleState, retryPolicy, now }) {
  const retryableCommandIds = new Set(operationalHealth.retryQueue.map((item) => item.commandId));
  const staleCommandIds = new Set(restartSafe.staleCommandIds);
  const expiredLeaseCommandIds = new Set(restartSafe.leaseExpiredCommandIds);
  const activeRecoveryRows = restartRecoveryPlan.records
    .filter((record) => record.status === 'recovering' || staleCommandIds.has(record.commandId) || expiredLeaseCommandIds.has(record.commandId))
    .map((record) => {
      const retry = operationalHealth.retryQueue.find((item) => item.commandId === record.commandId)?.retry || null;
      const commandRecord = state.commandsById[record.commandId] || null;
      const routeBase = `/operator-userland/cli-run/tenants/${encodeURIComponent(record.tenantId)}/workspaces/${encodeURIComponent(record.workspaceId)}/commands/${encodeURIComponent(record.commandId)}`;
      const retryReady = Boolean(retryableCommandIds.has(record.commandId) && retry?.retryAfter && Date.parse(retry.retryAfter) <= Date.parse(now));
      const action =
        expiredLeaseCommandIds.has(record.commandId)
          ? 'renew-command-lease'
          : retryReady
            ? 'retry-command-now'
            : record.action;

      return {
        commandId: record.commandId,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        status: record.status,
        restartSafeStatus: record.restartSafeStatus,
        action,
        route: `${routeBase}/recovery`,
        retryRoute: retryableCommandIds.has(record.commandId) ? `${routeBase}/retry` : null,
        resumeRoute: record.process.resumeToken ? `${routeBase}/resume?token=${encodeURIComponent(record.process.resumeToken)}` : `${routeBase}/resume`,
        leaseExpired: expiredLeaseCommandIds.has(record.commandId),
        stale: staleCommandIds.has(record.commandId),
        retryable: retryableCommandIds.has(record.commandId),
        retryAfter: retry?.retryAfter || null,
        attempts: commandRecord?.attempts || 0,
        maxAttempts: retryPolicy.maxAttempts,
        idempotencyKeyCount: record.idempotency.keys.length,
        expectedAck: record.process.expectedAck,
        processId: record.process.processId
      };
    });
  const retryRows = operationalHealth.retryQueue.map((item) => ({
    commandId: item.commandId,
    tenantId: item.tenantId,
    workspaceId: item.workspaceId,
    attempts: item.retry.attempts,
    maxAttempts: item.retry.maxAttempts,
    retryAfter: item.retry.retryAfter,
    delayMs: item.retry.delayMs,
    reason: item.failure.code,
    route: `/operator-userland/cli-run/tenants/${encodeURIComponent(item.tenantId)}/workspaces/${encodeURIComponent(item.workspaceId)}/commands/${encodeURIComponent(item.commandId)}/retry`
  }));
  const blockedBy = [
    ...(lifecycleState.commandAdmission.open ? [] : [lifecycleState.commandAdmission.reason || lifecycleState.commandAdmission.state]),
    ...(restartSafe.status === 'needs-recovery' ? ['restart-safe-recovery-required'] : []),
    ...(operationalHealth.actionableErrors.some((error) => error.severity === 'error') ? ['actionable-errors-present'] : []),
  ].filter(Boolean);
  const stateValue =
    blockedBy.length
      ? 'blocked'
      : activeRecoveryRows.length
        ? 'recovering'
        : retryRows.length
          ? 'retry-wait'
          : operationalHealth.status === 'degraded'
            ? 'degraded'
            : 'healthy';
  const nextAttemptAt = retryRows
    .map((row) => row.retryAfter)
    .filter(Boolean)
    .sort()[0] || null;
  const handoffSubject = {
    surfaceId,
    generatedAt: now,
    state: stateValue,
    restartSafeStatus: restartSafe.status,
    lifecycleReadiness: lifecycleState.readiness,
    recoveryCommandIds: activeRecoveryRows.map((row) => row.commandId),
    retryCommandIds: retryRows.map((row) => row.commandId),
    blockedBy,
  };

  return {
    contract: 'aios.cli-run.recovery-health-handoff.v1',
    generatedAt: now,
    state: stateValue,
    restartSafeStatus: restartSafe.status,
    lifecycleReadiness: lifecycleState.readiness,
    commandAdmissionOpen: lifecycleState.commandAdmission.open,
    degradedModeActive: operationalHealth.degraded,
    blockedBy,
    counters: {
      activeCommands: restartSafe.activeCommandIds.length,
      staleCommands: restartSafe.staleCommandIds.length,
      expiredLeases: restartSafe.leaseExpiredCommandIds.length,
      recoveredCommands: state.recoveredCommandIds.length,
      recoveryRows: activeRecoveryRows.length,
      retryRows: retryRows.length,
      actionableErrors: operationalHealth.actionableErrors.length
    },
    retryWindow: {
      policy: retryPolicy,
      nextAttemptAt,
      readyNow: retryRows.filter((row) => Date.parse(row.retryAfter) <= Date.parse(now)).map((row) => row.commandId)
    },
    recoveryRows: activeRecoveryRows,
    retryRows,
    operatorActions: [
      activeRecoveryRows.length ? {
        id: 'recover-cli-run-commands',
        action: activeRecoveryRows.some((row) => row.leaseExpired) ? 'renew-expired-leases' : 'sync-recovered-commands',
        route: '/operator-userland/cli-run/recovery',
        commandIds: activeRecoveryRows.map((row) => row.commandId)
      } : null,
      retryRows.length ? {
        id: 'retry-cli-run-failures',
        action: 'retry-ready-commands-after-backoff',
        route: '/operator-userland/cli-run/retry',
        nextAttemptAt,
        commandIds: retryRows.map((row) => row.commandId)
      } : null
    ].filter(Boolean),
    exportableSummary: {
      rowKey: `${state.runId}:${state.epoch}:recovery-health`,
      state: stateValue,
      restartSafeStatus: restartSafe.status,
      lifecycleReadiness: lifecycleState.readiness,
      staleCommands: restartSafe.staleCommandIds.length,
      expiredLeases: restartSafe.leaseExpiredCommandIds.length,
      retryableCommands: retryRows.length,
      actionableErrors: operationalHealth.actionableErrors.length,
      nextAttemptAt
    },
    proof: {
      digest: stableCommandId({
        command: stateValue,
        tenantId: 'system',
        workspaceId: restartSafe.status,
        args: [JSON.stringify(handoffSubject)]
      }),
      subject: handoffSubject
    }
  };
}

function projectNextAction(lifecycle, restartSafe, operationalHealth, violations, now) {
  const blockingViolation = violations.find((violation) => [
    'cli-run-disabled',
    'cli-run-paused',
    'cli-run-scheduled',
    'cli-run-concurrency-limit',
    'cli-run-write-disabled'
  ].includes(violation.code));

  if (blockingViolation) {
    const actionByCode = {
      'cli-run-disabled': 'enable-cli-run',
      'cli-run-paused': 'resume-cli-run',
      'cli-run-scheduled': 'wait-for-schedule-window',
      'cli-run-concurrency-limit': 'wait-for-active-command-slot',
      'cli-run-write-disabled': 'enable-write-commands-or-submit-read-only-command'
    };
    return {
      state: 'blocked',
      action: actionByCode[blockingViolation.code],
      reason: blockingViolation.code,
      commandId: null,
      dueAt: blockingViolation.notBefore || null
    };
  }

  if (restartSafe.staleCommandIds.length > 0) {
    return {
      state: 'recovery-required',
      action: 'recover-stale-command',
      reason: 'stale-command-lease',
      commandId: restartSafe.staleCommandIds[0],
      dueAt: now
    };
  }

  const retryable = operationalHealth.retryQueue[0];
  if (retryable) {
    return {
      state: 'retry-ready',
      action: 'retry-command-after-backoff',
      reason: retryable.failure.code,
      commandId: retryable.commandId,
      dueAt: retryable.retry?.retryAfter || now
    };
  }

  if (!lifecycle.enabled) {
    return {
      state: 'blocked',
      action: 'enable-cli-run',
      reason: 'cli-run-disabled',
      commandId: null,
      dueAt: null
    };
  }
  if (lifecycle.paused || lifecycle.mode === 'manual') {
    return {
      state: 'blocked',
      action: 'resume-cli-run',
      reason: 'cli-run-paused',
      commandId: null,
      dueAt: null
    };
  }
  if (lifecycle.notBefore && Date.parse(lifecycle.notBefore) > Date.parse(now)) {
    return {
      state: 'blocked',
      action: 'wait-for-schedule-window',
      reason: 'cli-run-scheduled',
      commandId: null,
      dueAt: lifecycle.notBefore
    };
  }

  if (lifecycle.enabled && !lifecycle.paused && restartSafe.activeCommandIds.length < lifecycle.maxActiveCommands) {
    return {
      state: 'ready',
      action: 'admit-next-command',
      reason: null,
      commandId: null,
      dueAt: lifecycle.notBefore || now
    };
  }

  return {
    state: 'idle',
    action: 'observe',
    reason: operationalHealth.degradedReasons[0] || null,
    commandId: null,
    dueAt: now
  };
}

function commandDurationMs(record, nowMs) {
  const startMs = parseTime(record.createdAt, nowMs);
  const endMs = TERMINAL_STATUSES.has(record.status)
    ? parseTime(record.lastTransitionAt, nowMs)
    : nowMs;
  return Math.max(0, endMs - startMs);
}

function createEmptyStatusCounts() {
  return {
    queued: 0,
    running: 0,
    recovering: 0,
    completed: 0,
    failed: 0,
    cancelled: 0
  };
}

function createEmptyJobRunAnalytics() {
  return {
    totalJobRuns: 0,
    fileBackedJobRuns: 0,
    inlineJobRuns: 0,
    examplesHelloJobRuns: 0,
    processCreateRequested: 0,
    processCreateReady: 0,
    processCreateBlocked: 0,
    processCreateDegraded: 0,
    processCreateObserved: 0,
    descriptorBoundaryFailures: 0,
    byRoute: {},
    bySourceKind: {},
    byProcessState: {},
    byAdmissionHealthStatus: {},
    topJobDescriptors: {}
  };
}

function addCounter(target, key, increment = 1) {
  const normalizedKey = normalizeIdentifier(key, 'unknown');
  target[normalizedKey] = (target[normalizedKey] || 0) + increment;
}

function classifyProcessCreationReadiness(processCreation) {
  const state = normalizeIdentifier(processCreation?.state, 'not-projected');
  if (state === 'ready-for-create' || state === 'ready-with-degraded-provider') return 'ready';
  if (state === 'degraded-audit-only') return 'degraded';
  if (state === 'blocked') return 'blocked';
  return 'observed';
}

function accumulateJobRunAnalytics(analytics, record) {
  if (!record.jobAdmission?.present) return;

  const jobAdmission = record.jobAdmission;
  const descriptorBoundary = record.jobDescriptorBoundary;
  const processCreation = record.processCreation;
  const route = jobAdmission.commandAdmission?.route || processCreation?.admission?.route || 'unknown-route';
  const sourceKind = jobAdmission.sourceKind || processCreation?.source?.kind || 'unknown-source';
  const processState = normalizeIdentifier(processCreation?.state, 'not-projected');
  const admissionHealthStatus = normalizeIdentifier(processCreation?.admissionHealth?.status, 'not-projected');
  const readiness = classifyProcessCreationReadiness(processCreation);

  analytics.totalJobRuns += 1;
  if (sourceKind === 'job-json-file') analytics.fileBackedJobRuns += 1;
  if (sourceKind === 'inline-job-descriptor') analytics.inlineJobRuns += 1;
  if (descriptorBoundary?.examplesHelloJob || jobAdmission.sourcePath === 'examples/hello.job.json') analytics.examplesHelloJobRuns += 1;
  if (jobAdmission.process?.create || processCreation?.process?.createRequested) analytics.processCreateRequested += 1;
  if (readiness === 'ready') analytics.processCreateReady += 1;
  else if (readiness === 'blocked') analytics.processCreateBlocked += 1;
  else if (readiness === 'degraded') analytics.processCreateDegraded += 1;
  else analytics.processCreateObserved += 1;
  if (descriptorBoundary?.fileBackedJobRun && descriptorBoundary.safeForProcessCreation === false) {
    analytics.descriptorBoundaryFailures += 1;
  }

  addCounter(analytics.byRoute, route);
  addCounter(analytics.bySourceKind, sourceKind);
  addCounter(analytics.byProcessState, processState);
  addCounter(analytics.byAdmissionHealthStatus, admissionHealthStatus);
  if (jobAdmission.sourcePath) addCounter(analytics.topJobDescriptors, jobAdmission.sourcePath);
}

function sortCounterObject(counter) {
  return Object.fromEntries(Object.entries(counter)
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey)));
}

function projectAnalyticsCounters(state, restartSafe, nowMs) {
  const byStatus = createEmptyStatusCounts();
  const byTenantWorkspace = {};
  const byProvider = {};
  const byTransport = {};
  const commandHistogram = {};
  const jobRunAnalytics = createEmptyJobRunAnalytics();
  const durationBands = {
    underMinute: 0,
    oneToFiveMinutes: 0,
    fiveToThirtyMinutes: 0,
    overThirtyMinutes: 0
  };
  let totalAttempts = 0;
  let completedDurationTotalMs = 0;
  let completedCount = 0;
  let writeScopedCount = 0;
  let terminalDurationTotalMs = 0;
  let terminalDurationCount = 0;
  let maxObservedDurationMs = 0;
  let commandsWithContinuation = 0;

  for (const record of Object.values(state.commandsById)) {
    byStatus[record.status] = (byStatus[record.status] || 0) + 1;
    totalAttempts += record.attempts;
    if (record.writePaths.length > 0 || record.permissions.includes('cli:write')) writeScopedCount += 1;
    commandHistogram[record.command] = (commandHistogram[record.command] || 0) + 1;
    if (record.clientContinuation) commandsWithContinuation += 1;
    accumulateJobRunAnalytics(jobRunAnalytics, record);

    const durationMs = commandDurationMs(record, nowMs);
    maxObservedDurationMs = Math.max(maxObservedDurationMs, durationMs);
    if (durationMs < 60 * 1000) durationBands.underMinute += 1;
    else if (durationMs < 5 * 60 * 1000) durationBands.oneToFiveMinutes += 1;
    else if (durationMs < 30 * 60 * 1000) durationBands.fiveToThirtyMinutes += 1;
    else durationBands.overThirtyMinutes += 1;

    const boundaryKey = `${record.tenantId}/${record.workspaceId}`;
    const boundary = byTenantWorkspace[boundaryKey] || {
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      total: 0,
      active: 0,
      terminal: 0,
      failed: 0,
      writeScoped: 0
    };
    boundary.total += 1;
    boundary.active += ACTIVE_STATUSES.has(record.status) ? 1 : 0;
    boundary.terminal += TERMINAL_STATUSES.has(record.status) ? 1 : 0;
    boundary.failed += record.status === 'failed' ? 1 : 0;
    boundary.writeScoped += record.writePaths.length > 0 || record.permissions.includes('cli:write') ? 1 : 0;
    byTenantWorkspace[boundaryKey] = boundary;

    const providerId = normalizeIdentifier(record.providerContract?.providerId, 'unknown-provider');
    const provider = byProvider[providerId] || {
      providerId,
      total: 0,
      active: 0,
      terminal: 0,
      failed: 0,
      handoffModes: {}
    };
    provider.total += 1;
    provider.active += ACTIVE_STATUSES.has(record.status) ? 1 : 0;
    provider.terminal += TERMINAL_STATUSES.has(record.status) ? 1 : 0;
    provider.failed += record.status === 'failed' ? 1 : 0;
    const handoffMode = normalizeIdentifier(record.providerContract?.handoffMode, 'unknown');
    provider.handoffModes[handoffMode] = (provider.handoffModes[handoffMode] || 0) + 1;
    byProvider[providerId] = provider;

    const transport = normalizeClientTransport(record.clientRequest?.transport);
    const transportRow = byTransport[transport] || { transport, total: 0, active: 0, terminal: 0, failed: 0 };
    transportRow.total += 1;
    transportRow.active += ACTIVE_STATUSES.has(record.status) ? 1 : 0;
    transportRow.terminal += TERMINAL_STATUSES.has(record.status) ? 1 : 0;
    transportRow.failed += record.status === 'failed' ? 1 : 0;
    byTransport[transport] = transportRow;

    if (record.status === 'completed') {
      completedCount += 1;
      completedDurationTotalMs += durationMs;
    }
    if (TERMINAL_STATUSES.has(record.status)) {
      terminalDurationCount += 1;
      terminalDurationTotalMs += durationMs;
    }
  }

  const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
  const failed = byStatus.failed;
  const completed = byStatus.completed;
  const stale = restartSafe.staleCommandIds.length;

  return {
    totalCommands: total,
    activeCommands: restartSafe.activeCommandIds.length,
    terminalCommands: restartSafe.terminalCommandIds.length,
    staleCommands: stale,
    writeScopedCommands: writeScopedCount,
    averageAttempts: total ? Number((totalAttempts / total).toFixed(2)) : 0,
    completionRate: total ? Number((completed / total).toFixed(4)) : 0,
    failureRate: total ? Number((failed / total).toFixed(4)) : 0,
    staleRate: total ? Number((stale / total).toFixed(4)) : 0,
    continuationCoverageRate: total ? Number((commandsWithContinuation / total).toFixed(4)) : 0,
    averageCompletedDurationMs: completedCount ? Math.round(completedDurationTotalMs / completedCount) : 0,
    averageTerminalDurationMs: terminalDurationCount ? Math.round(terminalDurationTotalMs / terminalDurationCount) : 0,
    maxObservedDurationMs,
    durationBands,
    byStatus,
    byTenantWorkspace: Object.values(byTenantWorkspace).sort((left, right) => left.tenantId.localeCompare(right.tenantId) || left.workspaceId.localeCompare(right.workspaceId)),
    byProvider: Object.values(byProvider).sort((left, right) => left.providerId.localeCompare(right.providerId)),
    byTransport: Object.values(byTransport).sort((left, right) => left.transport.localeCompare(right.transport)),
    commandHistogram: Object.fromEntries(Object.entries(commandHistogram).sort(([left], [right]) => left.localeCompare(right))),
    jobRunAnalytics: {
      contract: 'aios.cli-run.job-run-analytics.v1',
      totalJobRuns: jobRunAnalytics.totalJobRuns,
      fileBackedJobRuns: jobRunAnalytics.fileBackedJobRuns,
      inlineJobRuns: jobRunAnalytics.inlineJobRuns,
      examplesHelloJobRuns: jobRunAnalytics.examplesHelloJobRuns,
      processCreateRequested: jobRunAnalytics.processCreateRequested,
      processCreateReady: jobRunAnalytics.processCreateReady,
      processCreateBlocked: jobRunAnalytics.processCreateBlocked,
      processCreateDegraded: jobRunAnalytics.processCreateDegraded,
      processCreateObserved: jobRunAnalytics.processCreateObserved,
      descriptorBoundaryFailures: jobRunAnalytics.descriptorBoundaryFailures,
      processReadyRate: jobRunAnalytics.processCreateRequested
        ? Number((jobRunAnalytics.processCreateReady / jobRunAnalytics.processCreateRequested).toFixed(4))
        : 0,
      examplesHelloJobShare: jobRunAnalytics.totalJobRuns
        ? Number((jobRunAnalytics.examplesHelloJobRuns / jobRunAnalytics.totalJobRuns).toFixed(4))
        : 0,
      byRoute: sortCounterObject(jobRunAnalytics.byRoute),
      bySourceKind: sortCounterObject(jobRunAnalytics.bySourceKind),
      byProcessState: sortCounterObject(jobRunAnalytics.byProcessState),
      byAdmissionHealthStatus: sortCounterObject(jobRunAnalytics.byAdmissionHealthStatus),
      topJobDescriptors: sortCounterObject(jobRunAnalytics.topJobDescriptors)
    }
  };
}

function projectAnalyticsTrend(historySnapshots, analytics) {
  const previous = historySnapshots.length > 1 ? historySnapshots[historySnapshots.length - 2] : null;
  const current = historySnapshots[historySnapshots.length - 1] || null;
  return {
    contract: 'aios.cli-run.analytics-trend.v1',
    previousAt: previous?.at || null,
    currentAt: current?.at || null,
    sampleCount: historySnapshots.length,
    totalCommandsDelta: previous ? current.totalCommands - previous.totalCommands : analytics.totalCommands,
    activeCommandsDelta: previous ? current.activeCommands - previous.activeCommands : analytics.activeCommands,
    terminalCommandsDelta: previous ? current.terminalCommands - previous.terminalCommands : analytics.terminalCommands,
    staleCommandsDelta: previous ? current.staleCommands - previous.staleCommands : analytics.staleCommands,
    jobRunsDelta: previous ? current.totalJobRuns - previous.totalJobRuns : analytics.jobRunAnalytics.totalJobRuns,
    examplesHelloJobRunsDelta: previous ? current.examplesHelloJobRuns - previous.examplesHelloJobRuns : analytics.jobRunAnalytics.examplesHelloJobRuns,
    processCreateReadyDelta: previous ? current.processCreateReady - previous.processCreateReady : analytics.jobRunAnalytics.processCreateReady,
    failureRateDelta: previous ? Number((current.failureRate - previous.failureRate).toFixed(4)) : analytics.failureRate,
    completionRateDelta: previous ? Number((current.completionRate - previous.completionRate).toFixed(4)) : analytics.completionRate,
    processReadyRateDelta: previous ? Number((current.processReadyRate - previous.processReadyRate).toFixed(4)) : analytics.jobRunAnalytics.processReadyRate
  };
}

function projectHistorySnapshots(state, analytics, now) {
  const previous = Array.isArray(state.historySnapshots) ? state.historySnapshots : [];
  const snapshot = {
    at: now,
    epoch: state.epoch,
    totalCommands: analytics.totalCommands,
    activeCommands: analytics.activeCommands,
    terminalCommands: analytics.terminalCommands,
    staleCommands: analytics.staleCommands,
    failureRate: analytics.failureRate,
    completionRate: analytics.completionRate,
    continuationCoverageRate: analytics.continuationCoverageRate,
    averageTerminalDurationMs: analytics.averageTerminalDurationMs,
    totalJobRuns: analytics.jobRunAnalytics.totalJobRuns,
    examplesHelloJobRuns: analytics.jobRunAnalytics.examplesHelloJobRuns,
    processCreateRequested: analytics.jobRunAnalytics.processCreateRequested,
    processCreateReady: analytics.jobRunAnalytics.processCreateReady,
    processReadyRate: analytics.jobRunAnalytics.processReadyRate
  };
  return previous.concat(snapshot).slice(-20);
}

function projectTimeline(records) {
  const entries = [];
  for (const record of records) {
    entries.push({
      at: record.createdAt,
      type: 'command-created',
      commandId: record.commandId,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      status: record.status
    });
    entries.push({
      at: record.lastTransitionAt,
      type: 'command-last-transition',
      commandId: record.commandId,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      status: record.status,
      attempts: record.attempts
    });
    if (record.jobAdmission?.present) {
      entries.push({
        at: record.jobAdmission.admittedAt || record.createdAt,
        type: 'job-run-admitted',
        commandId: record.commandId,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        route: record.jobAdmission.commandAdmission?.route || 'unknown-route',
        sourceKind: record.jobAdmission.sourceKind,
        sourcePath: record.jobAdmission.sourcePath,
        examplesHelloJob: record.jobDescriptorBoundary?.examplesHelloJob || record.jobAdmission.sourcePath === 'examples/hello.job.json'
      });
    }
    if (record.processCreation) {
      entries.push({
        at: record.processCreation.requestedAt || record.lastTransitionAt,
        type: 'aios-process-creation-state',
        commandId: record.commandId,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        processId: record.processCreation.processId,
        state: record.processCreation.state,
        admissionHealthStatus: record.processCreation.admissionHealth?.status || null,
        nextAction: record.processCreation.admissionHealth?.nextAction || null
      });
    }
  }
  return entries.sort((left, right) => parseTime(left.at, 0) - parseTime(right.at, 0)).slice(-50);
}

function projectReportingState(analytics, historySnapshots, operationalHealth, nextAction, now) {
  const trend = projectAnalyticsTrend(historySnapshots, analytics);
  const statusRows = Object.entries(analytics.byStatus)
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status));
  const warningCodes = new Set();
  if (analytics.staleCommands > 0) warningCodes.add('stale-command-present');
  if (analytics.failureRate >= 0.25 && analytics.totalCommands >= 4) warningCodes.add('elevated-failure-rate');
  if (analytics.continuationCoverageRate < 1 && analytics.totalCommands > 0) warningCodes.add('missing-continuation-records');
  if (analytics.jobRunAnalytics.descriptorBoundaryFailures > 0) warningCodes.add('job-descriptor-boundary-failures');
  if (analytics.jobRunAnalytics.processCreateBlocked > 0) warningCodes.add('job-process-creation-blocked');
  for (const reason of operationalHealth.degradedReasons) warningCodes.add(reason);

  return {
    contract: 'aios.cli-run.reporting-state.v1',
    generatedAt: now,
    status: operationalHealth.degraded ? 'attention-required' : 'ready',
    warningCodes: Array.from(warningCodes).sort(),
    trend,
    statusRows,
    providerRows: analytics.byProvider,
    transportRows: analytics.byTransport,
    jobRunRows: {
      byRoute: analytics.jobRunAnalytics.byRoute,
      bySourceKind: analytics.jobRunAnalytics.bySourceKind,
      byProcessState: analytics.jobRunAnalytics.byProcessState,
      byAdmissionHealthStatus: analytics.jobRunAnalytics.byAdmissionHealthStatus
    },
    durationBands: analytics.durationBands,
    nextRefreshAction: nextAction.action,
    nextRefreshDueAt: nextAction.dueAt,
    exportManifest: {
      format: 'json',
      version: 1,
      datasets: ['counters', 'statusRows', 'tenantWorkspaceRows', 'providerRows', 'transportRows', 'jobRunRows', 'timeline', 'trend'],
      primaryKey: 'runId+epoch',
      containsSensitiveEnvironmentValues: false
    }
  };
}

function projectExportSummary(state, analytics, operationalHealth, timeline, reportingState, now) {
  return {
    format: 'aios.cli-run.analytics-export.v1',
    generatedAt: now,
    runId: state.runId,
    epoch: state.epoch,
    healthStatus: operationalHealth.status,
    degradedReasons: operationalHealth.degradedReasons,
    counters: {
      totalCommands: analytics.totalCommands,
      activeCommands: analytics.activeCommands,
      terminalCommands: analytics.terminalCommands,
      staleCommands: analytics.staleCommands,
      writeScopedCommands: analytics.writeScopedCommands,
      completionRate: analytics.completionRate,
      failureRate: analytics.failureRate,
      jobRuns: analytics.jobRunAnalytics.totalJobRuns,
      examplesHelloJobRuns: analytics.jobRunAnalytics.examplesHelloJobRuns,
      processCreateRequested: analytics.jobRunAnalytics.processCreateRequested,
      processCreateReady: analytics.jobRunAnalytics.processCreateReady,
      processReadyRate: analytics.jobRunAnalytics.processReadyRate
    },
    jobRunAnalytics: analytics.jobRunAnalytics,
    trend: reportingState.trend,
    statusRows: reportingState.statusRows,
    tenantWorkspaceRows: analytics.byTenantWorkspace,
    providerRows: reportingState.providerRows,
    transportRows: reportingState.transportRows,
    jobRunRows: reportingState.jobRunRows,
    durationBands: reportingState.durationBands,
    topCommands: Object.entries(analytics.commandHistogram)
      .map(([command, count]) => ({ command, count }))
      .sort((left, right) => right.count - left.count || left.command.localeCompare(right.command))
      .slice(0, 10),
    latestTimeline: timeline.slice(-10),
    manifest: reportingState.exportManifest
  };
}

function projectDashboardExportHandoff(exportSummary, reportingState, historySnapshots, timeline, lifecycleState, envelope, now) {
  const exportRows = [
    ...exportSummary.statusRows.map((row) => ({ dataset: 'statusRows', key: row.status, count: row.count })),
    ...exportSummary.tenantWorkspaceRows.map((row) => ({ dataset: 'tenantWorkspaceRows', key: `${row.tenantId}:${row.workspaceId}`, count: row.total })),
    ...exportSummary.providerRows.map((row) => ({ dataset: 'providerRows', key: row.providerId, count: row.total })),
    ...exportSummary.transportRows.map((row) => ({ dataset: 'transportRows', key: row.transport, count: row.total }))
  ];
  const latestSnapshot = historySnapshots[historySnapshots.length - 1] || null;
  const previousSnapshot = historySnapshots.length > 1 ? historySnapshots[historySnapshots.length - 2] : null;
  const latestTimelineAt = timeline.reduce((latest, entry) => {
    const entryMs = parseTime(entry.at, 0);
    return entryMs > latest ? entryMs : latest;
  }, 0);
  const generatedMs = parseTime(now, Date.now());
  const latestTimelineAgeMs = latestTimelineAt ? Math.max(0, generatedMs - latestTimelineAt) : null;
  const blockedReasons = [
    lifecycleState.commandAdmission.open ? null : lifecycleState.commandAdmission.reason || lifecycleState.readiness,
    reportingState.status === 'attention-required' ? reportingState.warningCodes[0] || 'reporting-attention-required' : null,
    exportSummary.healthStatus === 'blocked' ? 'operational-health-blocked' : null
  ].filter(Boolean);
  const rowSetChecksums = {
    statusRows: digestPayload(exportSummary.statusRows).slice(0, 16),
    tenantWorkspaceRows: digestPayload(exportSummary.tenantWorkspaceRows).slice(0, 16),
    providerRows: digestPayload(exportSummary.providerRows).slice(0, 16),
    transportRows: digestPayload(exportSummary.transportRows).slice(0, 16),
    timeline: digestPayload(exportSummary.latestTimeline).slice(0, 16)
  };
  const exportToken = digestPayload({
    contract: 'aios.cli-run.dashboard-export-handoff.v1',
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    actorId: envelope.actor.actorId,
    runId: exportSummary.runId,
    epoch: exportSummary.epoch,
    generatedAt: now,
    rowSetChecksums
  }).slice(0, 32);

  return {
    contract: 'aios.cli-run.dashboard-export-handoff.v1',
    generatedAt: now,
    state: blockedReasons.length ? 'blocked' : 'ready',
    ready: blockedReasons.length === 0,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    actorId: envelope.actor.actorId,
    actorRole: envelope.actor.role,
    runId: exportSummary.runId,
    epoch: exportSummary.epoch,
    format: exportSummary.format,
    exportToken: `cli_run_export_${exportToken}`,
    route: `/operator-userland/cli-run/tenants/${encodeURIComponent(envelope.tenantId)}/workspaces/${encodeURIComponent(envelope.workspaceId)}/exports/${encodeURIComponent(exportSummary.runId)}`,
    blockedReasons,
    counters: {
      totalCommands: exportSummary.counters.totalCommands,
      activeCommands: exportSummary.counters.activeCommands,
      terminalCommands: exportSummary.counters.terminalCommands,
      staleCommands: exportSummary.counters.staleCommands,
      exportRows: exportRows.length,
      historySnapshots: historySnapshots.length,
      timelineEvents: timeline.length,
      warningCodes: reportingState.warningCodes.length
    },
    freshness: {
      latestSnapshotAt: latestSnapshot?.at || null,
      previousSnapshotAt: previousSnapshot?.at || null,
      latestTimelineAt: latestTimelineAt ? new Date(latestTimelineAt).toISOString() : null,
      latestTimelineAgeMs,
      trendSampleCount: reportingState.trend.sampleCount,
      boundedByHistoryLimit: historySnapshots.length >= 20
    },
    datasets: reportingState.exportManifest.datasets.map((dataset) => ({
      dataset,
      included: true,
      checksum: rowSetChecksums[dataset] || digestPayload(exportSummary[dataset] || null).slice(0, 16)
    })),
    lifecycleGate: {
      readiness: lifecycleState.readiness,
      commandAdmissionOpen: lifecycleState.commandAdmission.open,
      nextAction: lifecycleState.commandAdmission.nextAction,
      dueAt: lifecycleState.commandAdmission.dueAt
    },
    rowSetChecksums,
    dashboardSummary: {
      healthStatus: exportSummary.healthStatus,
      reportingStatus: reportingState.status,
      warningCodes: reportingState.warningCodes,
      completionRate: exportSummary.counters.completionRate,
      failureRate: exportSummary.counters.failureRate,
      processReadyRate: exportSummary.counters.processReadyRate
    }
  };
}

export function describeCliRunSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const nowMs = parseTime(now, Date.now());
  const leaseMs = Number.isInteger(input.leaseMs) && input.leaseMs > 0 ? input.leaseMs : DEFAULT_LEASE_MS;
  const retryPolicy = normalizeRetryPolicy(input);
  const state = normalizePersistedState(input.persistedState, now);
  const jobAdmission = normalizeJobRunAdmission(input, now);
  const envelope = buildCommandEnvelope(input, jobAdmission);
  const jobDescriptorBoundary = projectJobDescriptorBoundary(jobAdmission, envelope);
  const clientRequest = normalizeClientRequest(input, envelope, now);
  const normalizedLifecycle = normalizeLifecycleSettings(input, input.persistedState || {}, nowMs);
  const lifecycleControl = normalizeLifecycleControl(input);
  const appliedLifecycle = applyLifecycleControl(normalizedLifecycle.settings, lifecycleControl, envelope.actor, now);
  const lifecycleSettings = appliedLifecycle.settings;
  const provider = normalizeProviderContract(input, input.persistedState || {});
  const executionPlan = normalizeExecutionPlan(input, envelope, now, jobAdmission);
  const requestIdempotencyKey = normalizeIdempotencyKey(jobAdmission.idempotencyKey) || commandIdempotencyKey(envelope, clientRequest);
  let violations = validateEnvelope(envelope)
    .concat(validateJobRunAdmission(jobAdmission))
    .concat(validateMailchimpJobCampaign(jobAdmission))
    .concat(validateJobProcessAdmission(jobAdmission, envelope))
    .concat(validateJobDescriptorBoundary(jobDescriptorBoundary))
    .concat(normalizedLifecycle.violations)
    .concat(appliedLifecycle.violations)
    .concat(validateExecutionPlan(executionPlan))
    .concat(validateProviderContract(provider, envelope));
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const audit = [];
  if (appliedLifecycle.audit) audit.push(appliedLifecycle.audit);
  const admissionRestartSafe = projectRestartSafeStatus(state, nowMs, leaseMs);
  if (violations.length === 0) {
    violations = violations.concat(validateLifecycleAdmission(envelope, lifecycleSettings, admissionRestartSafe, nowMs));
  }
  const isolationContract = projectTenantIsolationContract(envelope);
  const boundaryProof = {
    type: 'tenant-workspace-boundary-evaluated',
    at: now,
    commandId: envelope.commandId,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    actorId: envelope.actor.actorId,
    role: envelope.actor.role,
    requiredPermissions: envelope.requiredPermissions,
    grantedPermissions: envelope.actor.permissions,
    isolationContract,
    cwd: envelope.cwd,
    writePaths: envelope.writePaths,
    workspacePathEnvironment: executionPlan.workspacePathEnvironment
  };
  const isolationProof = {
    type: 'cli-run-tenant-isolation-evaluated',
    at: now,
    commandId: envelope.commandId,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    actorId: envelope.actor.actorId,
    contract: isolationContract.contract,
    tenantScoped: isolationContract.tenantScoped,
    workspaceScoped: isolationContract.workspaceScoped,
    tenantAuthorized: isolationContract.tenantAuthorized,
    workspaceAuthorized: isolationContract.workspaceAuthorized,
    violationCodes: violations
      .filter((violation) => violation.code.includes('isolation') || violation.code.includes('tenant'))
      .map((violation) => violation.code)
  };
  const lifecycleProof = {
    type: 'cli-run-lifecycle-settings-evaluated',
    at: now,
    commandId: envelope.commandId,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    settings: lifecycleSettings,
    controlAction: lifecycleControl.action,
    violationCodes: violations.map((violation) => violation.code)
  };
  const providerProof = {
    type: 'cli-run-provider-contract-negotiated',
    at: now,
    commandId: envelope.commandId,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    providerId: provider.contract.providerId,
    service: provider.contract.service,
    version: provider.contract.version,
    handoffMode: provider.contract.handoffMode,
    requiredCapabilities: requiredProviderCapabilities(envelope),
    negotiatedCapabilities: provider.contract.capabilities,
    rejectedCapabilities: provider.rejectedCapabilities,
    syncCursor: provider.contract.syncCursor
  };
  const executionProof = {
    type: 'cli-run-hosted-kernel-execution-plan-projected',
    at: now,
    commandId: envelope.commandId,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    contract: executionPlan.contract,
    argvLength: executionPlan.argv.length,
    cwd: executionPlan.cwd,
    environmentKeys: executionPlan.environmentKeys,
    workspacePathEnvironmentContract: executionPlan.workspacePathEnvironment.contract,
    workspacePathEnvironmentEntries: executionPlan.workspacePathEnvironment.entries.length,
    workspacePathEnvironmentRejected: executionPlan.workspacePathEnvironment.rejected.length,
    stdinPresent: executionPlan.stdin.present,
    stdinByteLength: executionPlan.stdin.byteLength,
    timeoutMs: executionPlan.policy.timeoutMs,
    maxOutputBytes: executionPlan.policy.maxOutputBytes,
    violationCodes: violations
      .filter((violation) => violation.code.startsWith('execution-plan-'))
      .map((violation) => violation.code)
  };
  const jobAdmissionProof = {
    type: 'cli-run-job-run-admission-evaluated',
    at: now,
    commandId: envelope.commandId,
    contract: jobAdmission.contract,
    present: jobAdmission.present,
    sourceKind: jobAdmission.sourceKind,
    sourcePath: jobAdmission.sourcePath,
    descriptorContract: jobAdmission.descriptorContract,
    jobId: jobAdmission.jobId,
    jobRunId: jobAdmission.requestedRunId,
    route: jobAdmission.commandAdmission.route,
    canonicalCommand: jobAdmission.commandAdmission.canonicalCommand,
    descriptorPathArgument: jobAdmission.commandAdmission.descriptorPathArgument,
    innerCommand: jobAdmission.commandAdmission.innerCommand,
    command: jobAdmission.commandSpec.command,
    argsLength: jobAdmission.commandSpec.args.length,
    violationCodes: violations
      .filter((violation) => violation.code.startsWith('job-run-'))
      .map((violation) => violation.code)
  };
  const jobDescriptorBoundaryProof = {
    type: 'cli-run-job-descriptor-boundary-evaluated',
    at: now,
    commandId: envelope.commandId,
    contract: jobDescriptorBoundary.contract,
    present: jobDescriptorBoundary.present,
    fileBackedJobRun: jobDescriptorBoundary.fileBackedJobRun,
    sourcePath: jobDescriptorBoundary.sourcePath,
    workspaceRoot: jobDescriptorBoundary.workspaceRoot,
    normalizedPath: jobDescriptorBoundary.descriptorPath?.normalized || null,
    relativePath: jobDescriptorBoundary.relativePath,
    examplesHelloJob: jobDescriptorBoundary.examplesHelloJob,
    tenantMatchesEnvelope: jobDescriptorBoundary.tenant.matchesEnvelope,
    workspaceMatchesEnvelope: jobDescriptorBoundary.workspace.matchesEnvelope,
    descriptorArgMatches: jobDescriptorBoundary.admission.descriptorArgMatches,
    safeForProcessCreation: jobDescriptorBoundary.safeForProcessCreation,
    violationCodes: violations
      .filter((violation) => violation.code.startsWith('job-run-descriptor-'))
      .map((violation) => violation.code)
  };
  let accepted = false;
  let idempotentReplay = false;
  let replayedCommandId = null;
  let replayReason = null;

  if (violations.length === 0) {
    const idempotentMatch = findIdempotentRecord(state, envelope, requestIdempotencyKey);
    const existing = idempotentMatch.record || state.commandsById[envelope.commandId];
    violations = validateExistingBoundary(envelope, existing)
      .concat(validateIdempotencyBoundary(envelope, state, requestIdempotencyKey));
    replayedCommandId = idempotentMatch.record?.commandId || null;
    replayReason = idempotentMatch.reason;
  }

  if (violations.length === 0) {
    const idempotentMatch = findIdempotentRecord(state, envelope, requestIdempotencyKey);
    const existing = idempotentMatch.record || state.commandsById[envelope.commandId];
    const nextStatus = deriveNextStatus(envelope, existing);
    const replayedByClientKey = Boolean(existing && idempotentMatch.reason === 'idempotency-key-match');
    const replayedTerminalCommand = Boolean(existing && TERMINAL_STATUSES.has(existing.status) && envelope.result === null && !envelope.error);
    const replayedActiveCommand = Boolean(
      existing
        && existing.idempotencyKey === requestIdempotencyKey
        && !envelope.requestedStatus
        && envelope.result === null
        && !envelope.error
    );
    idempotentReplay = replayedByClientKey || replayedTerminalCommand || replayedActiveCommand;
    replayedCommandId = idempotentReplay ? existing.commandId : replayedCommandId;
    replayReason = idempotentReplay
      ? idempotentMatch.reason || (replayedActiveCommand ? 'active-command-replay' : 'terminal-command-replay')
      : replayReason;

    if (!idempotentReplay) {
      const lease = projectCommandLease(
        envelope.commandId,
        clientRequest,
        existing?.lease,
        now,
        nowMs,
        leaseMs,
        nextStatus,
        true,
        false
      );
      state.commandsById[envelope.commandId] = {
        commandId: envelope.commandId,
        command: envelope.command,
        args: envelope.args,
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
        actorId: envelope.actor.actorId,
        role: envelope.actor.role,
        permissions: envelope.actor.permissions,
        workspaceRoot: envelope.workspaceRoot,
        cwd: envelope.cwd,
        writePaths: envelope.writePaths,
        providerContract: {
          providerId: provider.contract.providerId,
          service: provider.contract.service,
          version: provider.contract.version,
          handoffMode: provider.contract.handoffMode,
          capabilities: provider.contract.capabilities,
          syncCursor: provider.contract.syncCursor
        },
        executionPlan,
        jobAdmission: jobAdmission.present ? jobAdmission : null,
        jobDescriptorBoundary: jobAdmission.present ? jobDescriptorBoundary : null,
        clientRequest,
        clientContinuation: null,
        processCreation: null,
        idempotencyKey: requestIdempotencyKey,
        lease,
        status: nextStatus,
        attempts: existing ? existing.attempts + 1 : 1,
        createdAt: existing?.createdAt || now,
        lastTransitionAt: now,
        result: envelope.result,
        error: envelope.error,
        proof: (existing?.proof || []).concat(boundaryProof, isolationProof, lifecycleProof, providerProof, executionProof, jobAdmissionProof, jobDescriptorBoundaryProof, {
          type: 'cli-command-transition',
          at: now,
          from: existing?.status || 'new',
          to: nextStatus,
          surfaceId,
          tenantId: envelope.tenantId,
          workspaceId: envelope.workspaceId,
          actorId: envelope.actor.actorId
        }, {
          type: 'cli-run-command-lease-projected',
          at: now,
          commandId: envelope.commandId,
          contract: lease.contract,
          ownerRequestId: lease.ownerRequestId,
          expiresAt: lease.expiresAt,
          generation: lease.generation,
          restartSafeStatus: lease.restartSafeStatus
        })
      };
      state.idempotencyIndex[requestIdempotencyKey] = envelope.commandId;
      state.persistenceIndex = {
        contract: 'aios.cli-run.persistence-index.v1',
        commandCount: Object.keys(state.commandsById).length,
        idempotencyKeyCount: Object.keys(state.idempotencyIndex).length
      };
      state.epoch += 1;
      accepted = true;
    } else if (existing) {
      const replayLease = projectCommandLease(
        existing.commandId,
        clientRequest,
        existing.lease,
        now,
        nowMs,
        leaseMs,
        existing.status,
        false,
        true
      );
      existing.lease = replayLease;
      existing.clientRequest = existing.clientRequest || clientRequest;
      existing.idempotencyKey = existing.idempotencyKey || requestIdempotencyKey;
      state.idempotencyIndex[requestIdempotencyKey] = existing.commandId;
    }
    if (appliedLifecycle.audit) {
      state.epoch += 1;
    }

    audit.push({
      type: idempotentReplay ? 'idempotent-command-replay' : 'command-state-persisted',
      at: now,
      commandId: envelope.commandId,
      persistedCommandId: replayedCommandId || envelope.commandId,
      idempotencyKey: requestIdempotencyKey,
      replayReason,
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      actorId: envelope.actor.actorId,
      status: state.commandsById[replayedCommandId || envelope.commandId].status,
      epoch: state.epoch,
      auditHandoff: {
        destination: 'hosted-kernel.audit',
        contract: 'tenant-workspace-cli-run-boundary-v1',
        proofTypes: ['tenant-workspace-boundary-evaluated', 'cli-run-tenant-isolation-evaluated', 'cli-run-provider-contract-negotiated', 'cli-run-hosted-kernel-execution-plan-projected', 'cli-run-job-run-admission-evaluated', 'cli-run-job-descriptor-boundary-evaluated', 'aios-process-creation-projected', 'cli-command-transition', 'cli-run-client-continuation-projected'],
        providerId: provider.contract.providerId,
        service: provider.contract.service,
        clientRequestId: clientRequest.requestId,
        clientSessionId: clientRequest.sessionId,
        executionPlanId: executionPlan.planId,
        isolationContract
      }
    });
  } else {
    audit.push({
      type: 'command-rejected',
      at: now,
      commandId: envelope.commandId,
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      actorId: envelope.actor.actorId,
      providerId: provider.contract.providerId,
      auditHandoff: {
        destination: 'hosted-kernel.audit',
        contract: 'tenant-workspace-cli-run-boundary-v1',
        proofTypes: ['tenant-workspace-boundary-evaluated', 'cli-run-tenant-isolation-evaluated', 'cli-run-hosted-kernel-execution-plan-projected', 'cli-run-job-run-admission-evaluated', 'cli-run-job-descriptor-boundary-evaluated'],
        executionPlanId: executionPlan.planId,
        isolationContract
      },
      violations
    });
  }

  const externalHandoff = projectProviderHandoff(provider, envelope, accepted || idempotentReplay, violations, now, state.epoch);
  externalHandoff.executionPlan = executionPlan;
  const processCreation = projectAiosProcessCreation(jobAdmission, envelope, executionPlan, provider, accepted || idempotentReplay, violations, now, state.epoch, jobDescriptorBoundary, retryPolicy);
  const mailchimpCampaignHandoff = projectMailchimpJobRunHandoff(jobAdmission, envelope, processCreation, clientRequest, accepted || idempotentReplay, violations, now);
  if (accepted && state.commandsById[envelope.commandId]) {
    state.commandsById[envelope.commandId].processCreation = processCreation;
    state.commandsById[envelope.commandId].mailchimpCampaignHandoff = mailchimpCampaignHandoff;
  } else if (idempotentReplay && replayedCommandId && state.commandsById[replayedCommandId]) {
    state.commandsById[replayedCommandId].processCreation = processCreation;
    state.commandsById[replayedCommandId].mailchimpCampaignHandoff = mailchimpCampaignHandoff;
    state.commandsById[replayedCommandId].jobDescriptorBoundary = jobAdmission.present ? jobDescriptorBoundary : state.commandsById[replayedCommandId].jobDescriptorBoundary;
  }

  const restartSafe = projectRestartSafeStatus(state, nowMs, leaseMs);
  const restartRecoveryPlan = projectRestartRecoveryPlan(state, restartSafe, now, nowMs, leaseMs);
  const operationalHealth = projectOperationalHealth(state, restartSafe, nowMs, retryPolicy, violations);
  const analytics = projectAnalyticsCounters(state, restartSafe, nowMs);
  const historySnapshots = projectHistorySnapshots(state, analytics, now);
  const timeline = projectTimeline(Object.values(state.commandsById));
  const lifecycleState = projectLifecycleControlState(lifecycleSettings, restartSafe, envelope.actor, lifecycleControl, violations, nowMs);
  const recoveryHealthHandoff = projectRecoveryHealthHandoff({
    state,
    restartSafe,
    restartRecoveryPlan,
    operationalHealth,
    lifecycleState,
    retryPolicy,
    now
  });
  const nextAction = projectNextAction(lifecycleSettings, restartSafe, operationalHealth, violations, now);
  const reportingState = projectReportingState(analytics, historySnapshots, operationalHealth, nextAction, now);
  const exportSummary = projectExportSummary(state, analytics, operationalHealth, timeline, reportingState, now);
  const dashboardExportHandoff = projectDashboardExportHandoff(exportSummary, reportingState, historySnapshots, timeline, lifecycleState, envelope, now);
  const clientContinuation = projectClientContinuation(
    clientRequest,
    envelope,
    externalHandoff,
    nextAction,
    violations,
    accepted,
    idempotentReplay,
    now,
    leaseMs,
    jobAdmission,
    processCreation,
    mailchimpCampaignHandoff
  );
  const clientStatusBridge = projectClientStatusBridge({
    state,
    envelope,
    clientRequest,
    lifecycleState,
    restartSafe,
    restartRecoveryPlan,
    operationalHealth,
    nextAction,
    accepted,
    idempotentReplay,
    replayedCommandId,
    requestIdempotencyKey,
    violations,
    now
  });
  if (accepted && state.commandsById[envelope.commandId]) {
    state.commandsById[envelope.commandId].clientContinuation = clientContinuation;
    state.commandsById[envelope.commandId].processCreation = processCreation;
    state.commandsById[envelope.commandId].mailchimpCampaignHandoff = mailchimpCampaignHandoff;
    state.commandsById[envelope.commandId].proof = state.commandsById[envelope.commandId].proof.concat({
      type: 'cli-run-client-continuation-projected',
      at: now,
      commandId: envelope.commandId,
      requestId: clientRequest.requestId,
      sessionId: clientRequest.sessionId,
      state: clientContinuation.state,
      expectedAck: clientContinuation.ack.expected,
    workflowStepTypes: clientContinuation.workflowSteps.map((step) => step.type)
    }, {
      type: 'aios-process-creation-projected',
      at: now,
      commandId: envelope.commandId,
      processId: processCreation.processId,
      contract: processCreation.contract,
      state: processCreation.state,
      sourceKind: processCreation.source.kind,
      sourcePath: processCreation.source.sourcePath,
      blockedBy: processCreation.blockedBy
    }, {
      type: 'cli-run-mailchimp-campaign-handoff-projected',
      at: now,
      commandId: envelope.commandId,
      contract: mailchimpCampaignHandoff.contract,
      state: mailchimpCampaignHandoff.state,
      accepted: mailchimpCampaignHandoff.accepted,
      campaignId: mailchimpCampaignHandoff.campaignId || null,
      audienceId: mailchimpCampaignHandoff.audienceId || null,
      proofDigest: mailchimpCampaignHandoff.handoff?.proofDigest || null
    });
  } else if (idempotentReplay && replayedCommandId && state.commandsById[replayedCommandId]) {
    state.commandsById[replayedCommandId].clientContinuation = clientContinuation;
    state.commandsById[replayedCommandId].processCreation = processCreation;
    state.commandsById[replayedCommandId].mailchimpCampaignHandoff = mailchimpCampaignHandoff;
    state.commandsById[replayedCommandId].jobDescriptorBoundary = jobAdmission.present ? jobDescriptorBoundary : state.commandsById[replayedCommandId].jobDescriptorBoundary;
  }
  const persistedStateProof = {
    type: 'cli-run-persisted-state-shaped',
    at: now,
    contract: state.contract,
    commandId: envelope.commandId,
    persistedCommandId: replayedCommandId || envelope.commandId,
    idempotencyKey: requestIdempotencyKey,
    replayed: idempotentReplay,
    replayReason,
    commandCount: Object.keys(state.commandsById).length,
    idempotencyKeyCount: Object.keys(state.idempotencyIndex).length,
    leaseExpiredCommandIds: restartSafe.leaseExpiredCommandIds,
    staleCommandIds: restartSafe.staleCommandIds,
    recoveryPlanStatus: restartRecoveryPlan.status,
    recoveryActionCounts: restartRecoveryPlan.actionCounts
  };
  const healthProof = {
    type: 'cli-run-operational-health-evaluated',
    at: now,
    status: operationalHealth.status,
    degradedReasons: operationalHealth.degradedReasons,
    retryableCommandIds: operationalHealth.retryQueue.map((item) => item.commandId),
    actionableErrorCodes: operationalHealth.actionableErrors.map((item) => item.code)
  };
  const analyticsProof = {
    type: 'cli-run-analytics-report-projected',
    at: now,
    format: exportSummary.format,
    totalCommands: analytics.totalCommands,
    activeCommands: analytics.activeCommands,
    terminalCommands: analytics.terminalCommands,
    historySnapshots: historySnapshots.length,
    timelineEvents: timeline.length,
    exportRows: exportSummary.tenantWorkspaceRows.length,
    providerRows: exportSummary.providerRows.length,
    transportRows: exportSummary.transportRows.length,
    trendSampleCount: reportingState.trend.sampleCount,
    reportingStatus: reportingState.status
  };
  const dashboardExportHandoffProof = {
    type: 'cli-run-dashboard-export-handoff-projected',
    at: now,
    contract: dashboardExportHandoff.contract,
    state: dashboardExportHandoff.state,
    tenantId: dashboardExportHandoff.tenantId,
    workspaceId: dashboardExportHandoff.workspaceId,
    runId: dashboardExportHandoff.runId,
    epoch: dashboardExportHandoff.epoch,
    exportRows: dashboardExportHandoff.counters.exportRows,
    historySnapshots: dashboardExportHandoff.counters.historySnapshots,
    timelineEvents: dashboardExportHandoff.counters.timelineEvents,
    blockedReasons: dashboardExportHandoff.blockedReasons,
    exportToken: dashboardExportHandoff.exportToken
  };
  const nextActionProof = {
    type: 'cli-run-next-action-projected',
    at: now,
    state: nextAction.state,
    action: nextAction.action,
    commandId: nextAction.commandId,
    reason: nextAction.reason,
    lifecycleReadiness: lifecycleState.readiness,
    lifecycleBlockedBy: lifecycleState.blockedBy
  };
  const restartRecoveryPlanProof = {
    type: 'cli-run-restart-recovery-plan-projected',
    at: now,
    contract: restartRecoveryPlan.contract,
    status: restartRecoveryPlan.status,
    recoveredCommandIds: restartRecoveryPlan.recoveredCommandIds,
    staleCommandIds: restartRecoveryPlan.staleCommandIds,
    leaseExpiredCommandIds: restartRecoveryPlan.leaseExpiredCommandIds,
    actionCounts: restartRecoveryPlan.actionCounts,
    replayKeyCount: restartRecoveryPlan.idempotentReplay.acceptedKeys.length
  };
  const lifecycleStateProof = {
    type: 'cli-run-lifecycle-state-projected',
    at: now,
    commandId: envelope.commandId,
    contract: lifecycleState.contract,
    readiness: lifecycleState.readiness,
    enabled: lifecycleState.enabled,
    mode: lifecycleState.mode,
    paused: lifecycleState.paused,
    scheduleOpen: lifecycleState.schedule.open,
    remainingSlots: lifecycleState.capacity.remainingSlots,
    writeAdmissionAllowed: lifecycleState.writeAdmission.allowed,
    actorCanControl: lifecycleState.controls.actorCanControl,
    allowedControlActions: lifecycleState.controls.allowedActions,
    blockedBy: lifecycleState.blockedBy
  };
  const handoffProof = {
    type: 'cli-run-external-handoff-projected',
    at: now,
    commandId: envelope.commandId,
    providerId: externalHandoff.providerId,
    state: externalHandoff.state,
    handoffMode: externalHandoff.handoffMode,
    expectedAck: externalHandoff.sync.expectedAck,
    blockedBy: externalHandoff.blockedBy
  };
  const processCreationProof = {
    type: 'aios-process-creation-projected',
    at: now,
    commandId: envelope.commandId,
    processId: processCreation.processId,
    contract: processCreation.contract,
    state: processCreation.state,
    sourceKind: processCreation.source.kind,
    sourcePath: processCreation.source.sourcePath,
    descriptorScopedForCreation: processCreation.admission.descriptorScopedForCreation,
    jobId: processCreation.source.jobId,
    jobRunId: processCreation.source.jobRunId,
    processName: processCreation.process.name,
    admissionRoute: processCreation.admission.route,
    canonicalCommand: processCreation.admission.canonicalCommand,
    acceptancePreviewContract: processCreation.acceptancePreview.contract,
    acceptancePreviewState: processCreation.acceptancePreview.state,
    acceptanceRequired: processCreation.acceptancePreview.acceptanceRequired,
    acceptanceNextStep: processCreation.acceptancePreview.nextStep.action,
    admissionHealthStatus: processCreation.admissionHealth.status,
    admissionHealthNextAction: processCreation.admissionHealth.nextAction,
    examplesHelloJobReady: processCreation.admissionHealth.examplesHelloJobReady,
    degradedModeActive: processCreation.admissionHealth.degradedMode.active,
    retryMode: processCreation.admissionHealth.retry.mode,
    providerId: processCreation.runtime.providerId,
    mailchimpCampaignPresent: processCreation.source.mailchimpCampaign.present,
    mailchimpCampaignState: processCreation.source.mailchimpCampaign.state,
    mailchimpCampaignCanAttachLogProof: processCreation.source.mailchimpCampaign.deliveryReadiness.canAttachLogProof,
    argvLength: processCreation.runtime.admissionCommand.length,
    launchArgvLength: processCreation.runtime.launchCommand.length,
    blockedBy: processCreation.blockedBy
  };
  const mailchimpCampaignHandoffProof = {
    type: 'cli-run-mailchimp-campaign-handoff-projected',
    at: now,
    commandId: envelope.commandId,
    contract: mailchimpCampaignHandoff.contract,
    present: mailchimpCampaignHandoff.present,
    state: mailchimpCampaignHandoff.state,
    accepted: mailchimpCampaignHandoff.accepted,
    campaignId: mailchimpCampaignHandoff.campaignId || null,
    audienceId: mailchimpCampaignHandoff.audienceId || null,
    providerState: mailchimpCampaignHandoff.providerState || null,
    campaignStatus: mailchimpCampaignHandoff.campaignStatus || null,
    validation: mailchimpCampaignHandoff.validation || [],
    proofDigest: mailchimpCampaignHandoff.handoff?.proofDigest || null
  };
  const clientContinuationProof = {
    type: 'cli-run-client-continuation-projected',
    at: now,
    commandId: envelope.commandId,
    requestId: clientRequest.requestId,
    sessionId: clientRequest.sessionId,
    traceId: clientRequest.traceId,
    transport: clientRequest.transport,
    state: clientContinuation.state,
    expectedAck: clientContinuation.ack.expected,
    providerExpectedAck: clientContinuation.ack.providerExpected,
    processExpectedAck: clientContinuation.ack.processExpected,
    jobRunHandoffState: clientContinuation.jobRunHandoff?.state || null,
    jobRunHandoffAction: clientContinuation.jobRunHandoff?.action || null,
    jobRunProcessId: clientContinuation.jobRunHandoff?.processId || null,
    mailchimpCampaignHandoffState: clientContinuation.mailchimpCampaignHandoff?.state || null,
    mailchimpCampaignHandoffAccepted: clientContinuation.mailchimpCampaignHandoff?.accepted === true,
    workflowStepTypes: clientContinuation.workflowSteps.map((step) => step.type),
    blockedBy: clientContinuation.blockedBy
  };
  const clientStatusBridgeProof = {
    type: 'cli-run-client-status-bridge-projected',
    at: now,
    contract: clientStatusBridge.contract,
    commandId: clientStatusBridge.commandId,
    persistedCommandId: clientStatusBridge.persistedCommandId,
    requestId: clientStatusBridge.requestId,
    readinessState: clientStatusBridge.readiness.state,
    recoveryState: clientStatusBridge.recovery.state,
    safeResume: clientStatusBridge.readiness.safeResume,
    safeRetry: clientStatusBridge.readiness.safeRetry,
    safeHandoff: clientStatusBridge.readiness.safeHandoff,
    nextAction: clientStatusBridge.nextStep.action
  };
  const recoveryHealthProof = {
    type: 'cli-run-recovery-health-handoff-projected',
    at: now,
    contract: recoveryHealthHandoff.contract,
    state: recoveryHealthHandoff.state,
    restartSafeStatus: recoveryHealthHandoff.restartSafeStatus,
    lifecycleReadiness: recoveryHealthHandoff.lifecycleReadiness,
    staleCommands: recoveryHealthHandoff.counters.staleCommands,
    expiredLeases: recoveryHealthHandoff.counters.expiredLeases,
    retryRows: recoveryHealthHandoff.counters.retryRows,
    actionableErrors: recoveryHealthHandoff.counters.actionableErrors,
    nextAttemptAt: recoveryHealthHandoff.retryWindow.nextAttemptAt,
    blockedBy: recoveryHealthHandoff.blockedBy
  };

  return {
    ok: violations.length === 0,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel cli-run persisted command state v1',
    accepted,
    idempotentReplay,
    replay: {
      idempotencyKey: requestIdempotencyKey,
      replayedCommandId,
      replayReason
    },
    violations,
    boundary: {
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      actor: envelope.actor,
      requiredPermissions: envelope.requiredPermissions,
      workspaceRoot: envelope.workspaceRoot,
      cwd: envelope.cwd,
      writePaths: envelope.writePaths,
      workspacePathEnvironment: executionPlan.workspacePathEnvironment,
      jobDescriptorBoundary,
      isolationContract
    },
    clientRequest,
    clientContinuation,
    clientStatusBridge,
    jobAdmission,
    jobDescriptorBoundary,
    processCreation,
    mailchimpCampaignHandoff,
    providerContract: {
      contract: provider.contract,
      requiredCapabilities: requiredProviderCapabilities(envelope),
      rejectedCapabilities: provider.rejectedCapabilities,
      negotiationStatus: violations.some((violation) => violation.code.startsWith('provider-')) ? 'rejected' : 'accepted'
    },
    executionPlan,
    lifecycle: {
      settings: lifecycleSettings,
      state: lifecycleState,
      control: {
        requestedAction: lifecycleControl.rawAction,
        appliedAction: appliedLifecycle.audit ? lifecycleControl.action : null,
        actorCanControl: lifecycleState.controls.actorCanControl,
        allowedActions: lifecycleState.controls.allowedActions,
        blockedReason: lifecycleState.controls.blockedReason
      },
      admission: {
        accepted,
        activeCommandLimit: lifecycleSettings.maxActiveCommands,
        activeCommandIds: restartSafe.activeCommandIds,
        remainingSlots: lifecycleState.capacity.remainingSlots,
        readiness: lifecycleState.readiness,
        blockedBy: violations
          .filter((violation) => violation.code.startsWith('cli-run-') || violation.code.startsWith('invalid-lifecycle') || violation.code.startsWith('missing-lifecycle') || violation.code.startsWith('expired-lifecycle') || violation.code === 'lifecycle-control-permission-denied')
          .map((violation) => violation.code)
      },
      nextAction
    },
    restartSafe,
    restartRecoveryPlan,
    persistence: {
      contract: state.contract,
      idempotencyKey: requestIdempotencyKey,
      replayedCommandId,
      replayReason,
      index: state.persistenceIndex,
      idempotencyIndex: state.idempotencyIndex,
      leases: restartSafe.leases,
      recoveryPlan: restartRecoveryPlan
    },
    operationalHealth,
    recoveryHealthHandoff,
    analytics,
    historySnapshots,
    timeline,
    reportingState,
    exportSummary,
    dashboardExportHandoff,
    externalHandoff,
    state: {
      schemaVersion: state.schemaVersion,
      runId: state.runId,
      epoch: state.epoch,
      commandsById: state.commandsById,
      idempotencyIndex: state.idempotencyIndex,
      persistenceIndex: state.persistenceIndex,
      lifecycleSettings,
      lifecycleState,
      providerContract: provider.contract,
      executionPlan,
      jobAdmission: jobAdmission.present ? jobAdmission : null,
      jobDescriptorBoundary: jobAdmission.present ? jobDescriptorBoundary : null,
      processCreation,
      mailchimpCampaignHandoff,
      externalHandoff,
      clientRequest,
      clientContinuation,
      clientStatusBridge,
      restartRecoveryPlan,
      recoveryHealthHandoff,
      historySnapshots,
      reportingState,
      dashboardExportHandoff
    },
    audit,
    evidence: evidence.concat(boundaryProof, isolationProof, lifecycleProof, providerProof, executionProof, jobAdmissionProof, jobDescriptorBoundaryProof, processCreationProof, mailchimpCampaignHandoffProof, persistedStateProof, restartRecoveryPlanProof, healthProof, recoveryHealthProof, analyticsProof, dashboardExportHandoffProof, nextActionProof, handoffProof, clientContinuationProof, clientStatusBridgeProof).concat(audit).concat(
      state.recoveredCommandIds.map((commandId) => ({
        type: 'restart-safe-command-recovered',
        at: now,
        commandId
      }))
    )
      .concat(lifecycleStateProof)
  };
}

export default describeCliRunSurface;
