export const FEATURE_FLAG_SCHEMA_VERSION = 'aios.feature-flags.v1';

export const DEFAULT_MAILCHIMP_FEATURE_FLAGS = Object.freeze({
  mailchimpRead: true,
  mailchimpPlanCampaigns: true,
  mailchimpAudienceSegmentation: true,
  mailchimpWebhookAudit: true,
  mailchimpExternalWrite: false,
  strictVerifierClaims: true,
  rollbackRequired: true,
  truthBoundaryReport: true
});

export const MAILCHIMP_FLAG_REQUIREMENTS = Object.freeze({
  'campaign.sync': Object.freeze(['mailchimpRead', 'mailchimpPlanCampaigns']),
  'audience.segment': Object.freeze(['mailchimpRead', 'mailchimpAudienceSegmentation']),
  'webhook.audit': Object.freeze(['mailchimpRead', 'mailchimpWebhookAudit'])
});

export const FEATURE_FLAG_STATE_VERSION = 'aios.feature-flag-state.v1';

export function normalizeFeatureFlags(input = {}) {
  const source = typeof input === 'string' ? flagsFromSource(input) : input;
  const flags = {
    ...DEFAULT_MAILCHIMP_FEATURE_FLAGS,
    ...coerceKnownFlags(source)
  };

  return {
    schemaVersion: FEATURE_FLAG_SCHEMA_VERSION,
    flags,
    disabled: Object.keys(flags)
      .filter((key) => flags[key] === false)
      .sort(),
    enabled: Object.keys(flags)
      .filter((key) => flags[key] === true)
      .sort(),
    diagnostics: validateFeatureFlags(flags)
  };
}

export function shapeFeatureFlagState(input = {}) {
  const normalized = normalizeFeatureFlags(input.flags ?? input.featureFlags ?? input);
  const generation = Number.isInteger(input.generation) && input.generation >= 0 ? input.generation : 0;
  const commands = asArray(input.commands).map(normalizeFlagCommand).filter(Boolean);
  const applied = commands.reduce(
    (state, command) => applyFlagCommandToState(state, command),
    {
      flags: normalized.flags,
      generation,
      history: asArray(input.history).map(normalizeHistoryEntry).filter(Boolean)
    }
  );
  const status = deriveFeatureFlagRecoveryStatus(applied.flags, {
    lastCommand: applied.history.at(-1) ?? null,
    previousStatus: input.status
  });

  return {
    schemaVersion: FEATURE_FLAG_STATE_VERSION,
    flags: applied.flags,
    generation: applied.generation,
    status: status.status,
    restartToken: buildRestartToken(applied.flags, applied.generation),
    enabled: Object.keys(applied.flags).filter((key) => applied.flags[key] === true).sort(),
    disabled: Object.keys(applied.flags).filter((key) => applied.flags[key] === false).sort(),
    history: applied.history,
    recovery: status,
    diagnostics: [
      ...validateFeatureFlags(applied.flags),
      ...status.diagnostics
    ]
  };
}

export function applyFeatureFlagCommand(state = {}, command = {}) {
  const shaped = shapeFeatureFlagState(state);
  const normalizedCommand = normalizeFlagCommand(command);
  if (!normalizedCommand) {
    return {
      ...shaped,
      diagnostics: [
        ...shaped.diagnostics,
        { level: 'error', code: 'invalid_feature_flag_command' }
      ]
    };
  }
  return shapeFeatureFlagState({
    flags: shaped.flags,
    generation: shaped.generation,
    history: shaped.history,
    commands: [normalizedCommand]
  });
}

export function deriveFeatureFlagRecoveryStatus(flagsOrState = {}, context = {}) {
  const flags = flagsOrState.flags ?? normalizeFeatureFlags(flagsOrState).flags;
  const diagnostics = [];
  const disabledRequired = Object.entries(MAILCHIMP_FLAG_REQUIREMENTS)
    .flatMap(([operation, requirements]) => requirements.map((flag) => ({ operation, flag })))
    .filter(({ flag }) => flags[flag] !== true);
  if (disabledRequired.length) {
    diagnostics.push({
      level: 'warning',
      code: 'required_operation_flags_disabled',
      flags: uniqueSorted(disabledRequired.map(({ flag }) => flag))
    });
  }
  if (flags.mailchimpExternalWrite && !flags.rollbackRequired) {
    diagnostics.push({ level: 'error', code: 'persisted_state_external_write_without_rollback' });
  }
  if (context.lastCommand?.status === 'duplicate') {
    diagnostics.push({ level: 'info', code: 'idempotent_feature_flag_command_replayed' });
  }

  const hasErrors = diagnostics.some((diagnostic) => diagnostic.level === 'error');
  const hasWarnings = diagnostics.some((diagnostic) => diagnostic.level === 'warning');
  return {
    status: hasErrors ? 'blocked' : hasWarnings ? 'degraded' : context.previousStatus ?? 'ready',
    restartSafe: !hasErrors,
    resumeAction: hasErrors ? 'operator_review' : hasWarnings ? 'resume_with_gate_checks' : 'resume',
    diagnostics
  };
}

export function evaluateFeatureGate(operation, input = {}) {
  const normalized = normalizeFeatureFlags(input);
  const requirements = MAILCHIMP_FLAG_REQUIREMENTS[operation] ?? [];
  const missing = requirements.filter((flag) => normalized.flags[flag] !== true);
  const externalWriteRequested = Boolean(input?.externalWrite ?? input?.mailchimpExternalWriteRequest);
  const writeBlocked = externalWriteRequested && normalized.flags.mailchimpExternalWrite !== true;
  const rollbackBlocked = normalized.flags.rollbackRequired !== true && externalWriteRequested;
  const verifierBlocked = normalized.flags.strictVerifierClaims !== true;

  return {
    ok: missing.length === 0 && !writeBlocked && !rollbackBlocked,
    operation,
    requiredFlags: requirements,
    missingFlags: missing,
    policy: {
      externalWrite: externalWriteRequested && !writeBlocked,
      externalWriteRequested,
      writeBlocked,
      rollbackRequired: normalized.flags.rollbackRequired,
      verifierMode: normalized.flags.strictVerifierClaims ? 'strict' : 'advisory',
      truthBoundaryReport: normalized.flags.truthBoundaryReport
    },
    diagnostics: [
      ...normalized.diagnostics,
      ...missing.map((flag) => ({ level: 'error', code: 'feature_disabled', flag })),
      ...(writeBlocked ? [{ level: 'error', code: 'external_write_flag_required' }] : []),
      ...(rollbackBlocked ? [{ level: 'error', code: 'rollback_required_for_external_write' }] : []),
      ...(verifierBlocked ? [{ level: 'warning', code: 'strict_verifier_disabled' }] : [])
    ]
  };
}

export function resolveMailchimpRuntimePolicy({ operation, featureFlags, requestedEffects = [], scope = {} } = {}) {
  const externalWriteRequested = requestedEffects.includes('mailchimp.write');
  const persistedState = shapeFeatureFlagState(featureFlags ?? {});
  const boundary = deriveFeatureFlagBoundaryContext(scope, persistedState);
  const gate = evaluateFeatureGate(operation, {
    ...persistedState.flags,
    externalWrite: externalWriteRequested
  });
  const health = deriveFeatureFlagOperationalHealth({
    operation,
    state: persistedState,
    gate,
    boundary,
    requestedEffects
  });

  return {
    ok: gate.ok && boundary.ok && persistedState.recovery.status !== 'blocked' && health.status !== 'blocked',
    runtimePolicy: {
      adapter: 'mailchimp',
      operation,
      allowedEffects: buildAllowedEffects(gate, requestedEffects),
      deniedEffects: buildDeniedEffects(gate, requestedEffects),
      verifierMode: gate.policy.verifierMode,
      rollbackRequired: gate.policy.rollbackRequired,
      truthBoundaryReport: gate.policy.truthBoundaryReport,
      featureState: {
        schemaVersion: persistedState.schemaVersion,
        generation: persistedState.generation,
        status: persistedState.status,
        restartToken: persistedState.restartToken,
        resumeAction: persistedState.recovery.resumeAction
      },
      boundary: boundary.context,
      health,
      retry: health.retry,
      degradedMode: health.status === 'degraded',
      nextAction: health.nextAction
    },
    diagnostics: [
      ...persistedState.diagnostics,
      ...gate.diagnostics,
      ...boundary.diagnostics,
      ...health.diagnostics
    ]
  };
}

export function deriveFeatureFlagOperationalHealth(input = {}) {
  const state = input.state?.schemaVersion === FEATURE_FLAG_STATE_VERSION
    ? input.state
    : shapeFeatureFlagState(input.state ?? input.featureFlags ?? {});
  const operation = input.operation ?? 'unknown';
  const gate = input.gate ?? evaluateFeatureGate(operation, {
    ...state.flags,
    externalWrite: asArray(input.requestedEffects).includes('mailchimp.write')
  });
  const boundary = input.boundary ?? deriveFeatureFlagBoundaryContext(input.scope ?? {}, state);
  const diagnostics = [
    ...state.diagnostics,
    ...gate.diagnostics,
    ...boundary.diagnostics
  ];
  const errors = diagnostics.filter((diagnostic) => diagnostic.level === 'error');
  const warnings = diagnostics.filter((diagnostic) => diagnostic.level === 'warning');
  const disabledCriticalFlags = gate.missingFlags.filter((flag) => {
    if (operation === 'campaign.sync') return ['mailchimpRead', 'mailchimpPlanCampaigns'].includes(flag);
    if (operation === 'audience.segment') return ['mailchimpRead', 'mailchimpAudienceSegmentation'].includes(flag);
    if (operation === 'webhook.audit') return ['mailchimpRead', 'mailchimpWebhookAudit'].includes(flag);
    return flag === 'mailchimpRead';
  });
  const retry = buildOperationalRetryPolicy({
    errors,
    warnings,
    disabledCriticalFlags,
    generation: state.generation,
    duplicateReplay: state.history.some((entry) => entry.status === 'duplicate')
  });
  const status = errors.length || disabledCriticalFlags.length
    ? 'blocked'
    : warnings.length || state.status === 'degraded'
      ? 'degraded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? nextActionForBlockedFeatureHealth({ errors, disabledCriticalFlags })
    : status === 'degraded'
      ? 'resume_with_flag_health_audit'
      : 'resume_runtime_handoff';

  return {
    schemaVersion: `${FEATURE_FLAG_STATE_VERSION}.operational-health`,
    operation,
    status,
    degradedMode: status === 'degraded',
    nextAction,
    retry,
    actionableErrors: errors.map((diagnostic) => ({
      code: diagnostic.code,
      retryable: retry.retryable,
      action: actionForFeatureDiagnostic(diagnostic.code),
      details: stableClone(diagnostic)
    })),
    disabledCriticalFlags: uniqueSorted(disabledCriticalFlags),
    generation: state.generation,
    restartToken: state.restartToken,
    diagnostics: [
      ...diagnostics,
      ...(disabledCriticalFlags.length
        ? [{
            level: 'error',
            code: 'critical_operation_flags_disabled',
            flags: uniqueSorted(disabledCriticalFlags),
            operation
          }]
        : [])
    ]
  };
}

export function deriveFeatureFlagBoundaryContext(scope = {}, state = {}) {
  const tenantId = optionalString(scope.tenantId) ?? 'tenant:local';
  const workspaceId = optionalString(scope.workspaceId) ?? 'workspace:local';
  const role = optionalString(scope.role) ?? 'automation_worker';
  const auditChannel = optionalString(scope.auditChannel) ?? 'audit.mailchimp.feature_flags';
  const diagnostics = [];
  if (!tenantId.startsWith('tenant:')) {
    diagnostics.push({ level: 'warning', code: 'feature_flag_tenant_not_namespaced', tenantId });
  }
  if (!workspaceId.startsWith('workspace:')) {
    diagnostics.push({ level: 'warning', code: 'feature_flag_workspace_not_namespaced', workspaceId });
  }
  if (!auditChannel.startsWith('audit.')) {
    diagnostics.push({ level: 'error', code: 'feature_flag_audit_channel_not_audit_scoped', auditChannel });
  }
  if (state.status === 'blocked') {
    diagnostics.push({ level: 'error', code: 'feature_flag_boundary_state_blocked' });
  }
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== 'error'),
    context: {
      tenantId,
      workspaceId,
      role,
      isolationKey: deterministicBoundaryKey({ tenantId, workspaceId }),
      auditChannel,
      stateGeneration: Number(state.generation ?? 0),
      restartToken: state.restartToken ?? null
    },
    diagnostics
  };
}

export function parseFeatureFlagSource(source = '') {
  return String(source)
    .split(/\r?\n/)
    .map((line, index) => ({ index: index + 1, text: line.trim() }))
    .filter((line) => line.text && !line.text.startsWith('#'))
    .map((line) => {
      const [key, rawValue = 'true'] = line.text.split(/[:=]/).map((part) => part.trim());
      return {
        kind: 'FeatureFlagDeclaration',
        line: line.index,
        key,
        value: parseBoolean(rawValue)
      };
    });
}

function flagsFromSource(source) {
  return Object.fromEntries(
    parseFeatureFlagSource(source)
      .filter((declaration) => declaration.key)
      .map((declaration) => [declaration.key, declaration.value])
  );
}

function coerceKnownFlags(source = {}) {
  const result = {};
  for (const key of Object.keys(DEFAULT_MAILCHIMP_FEATURE_FLAGS)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = parseBoolean(source[key]);
    }
  }
  return result;
}

function validateFeatureFlags(flags) {
  const diagnostics = [];
  if (flags.mailchimpExternalWrite && !flags.rollbackRequired) {
    diagnostics.push({ level: 'error', code: 'external_write_without_rollback' });
  }
  if (flags.mailchimpExternalWrite && !flags.strictVerifierClaims) {
    diagnostics.push({ level: 'error', code: 'external_write_without_strict_verifier' });
  }
  if (!flags.truthBoundaryReport) {
    diagnostics.push({ level: 'warning', code: 'truth_boundary_report_disabled' });
  }
  return diagnostics;
}

function buildAllowedEffects(gate, requestedEffects) {
  const effects = new Set(['kernel.job.enqueue', 'memory.ephemeral.write', 'verifier.claim.check']);
  for (const effect of requestedEffects) {
    if (effect === 'mailchimp.write' && gate.policy.externalWrite) effects.add(effect);
    if (effect !== 'mailchimp.write') effects.add(effect);
  }
  return [...effects].sort();
}

function buildDeniedEffects(gate, requestedEffects) {
  const denied = [];
  if (gate.policy.writeBlocked && requestedEffects.includes('mailchimp.write')) {
    denied.push({
      effect: 'mailchimp.write',
      reason: 'mailchimpExternalWrite flag is disabled'
    });
  }
  for (const flag of gate.missingFlags) {
    denied.push({
      effect: `feature:${flag}`,
      reason: 'required feature flag is disabled'
    });
  }
  return denied;
}

function buildOperationalRetryPolicy({ errors, warnings, disabledCriticalFlags, generation, duplicateReplay }) {
  const retryable = errors.every((diagnostic) => ![
    'external_write_without_rollback',
    'persisted_state_external_write_without_rollback',
    'external_write_without_strict_verifier',
    'feature_flag_audit_channel_not_audit_scoped'
  ].includes(diagnostic.code)) && disabledCriticalFlags.length === 0;
  const baseDelay = duplicateReplay ? 250 : warnings.length ? 1000 : 500;
  const attemptBudget = retryable ? Math.max(1, 3 - Math.min(Number(generation ?? 0), 2)) : 0;
  return {
    strategy: retryable ? 'bounded_exponential_backoff' : 'operator_gated',
    retryable,
    maxAttempts: attemptBudget,
    initialDelayMs: baseDelay,
    maxDelayMs: retryable ? baseDelay * 8 : 0,
    reason: disabledCriticalFlags.length
      ? 'critical_flags_disabled'
      : errors.length
        ? 'feature_policy_errors'
        : warnings.length
          ? 'feature_policy_degraded'
          : 'feature_policy_ready'
  };
}

function nextActionForBlockedFeatureHealth({ errors, disabledCriticalFlags }) {
  if (disabledCriticalFlags.length) return 'enable_required_operation_flags';
  if (errors.some((diagnostic) => diagnostic.code.includes('rollback'))) return 'restore_rollback_before_write';
  if (errors.some((diagnostic) => diagnostic.code.includes('strict_verifier'))) return 'enable_strict_verifier';
  if (errors.some((diagnostic) => diagnostic.code.includes('audit_channel'))) return 'repair_audit_channel_scope';
  return 'operator_review_feature_policy';
}

function actionForFeatureDiagnostic(code) {
  return {
    external_write_without_rollback: 'enable_rollback_or_disable_external_write',
    persisted_state_external_write_without_rollback: 'enable_rollback_or_disable_external_write',
    external_write_without_strict_verifier: 'enable_strict_verifier_claims',
    feature_disabled: 'enable_required_feature_flag',
    external_write_flag_required: 'enable_external_write_flag',
    rollback_required_for_external_write: 'enable_rollback_required',
    feature_flag_audit_channel_not_audit_scoped: 'use_audit_scoped_channel',
    feature_flag_boundary_state_blocked: 'recover_feature_flag_state'
  }[code] ?? 'operator_review_feature_policy';
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return !['false', '0', 'off', 'disabled', 'no'].includes(String(value).trim().toLowerCase());
}

function normalizeFlagCommand(command = {}) {
  const flag = command.flag ?? command.key;
  if (!flag || !Object.prototype.hasOwnProperty.call(DEFAULT_MAILCHIMP_FEATURE_FLAGS, flag)) return null;
  const op = command.op ?? command.action ?? 'set';
  if (!['set', 'enable', 'disable'].includes(op)) return null;
  return {
    id: command.id ?? deterministicCommandId({ flag, op, value: command.value }),
    op,
    flag,
    value: op === 'enable' ? true : op === 'disable' ? false : parseBoolean(command.value),
    reason: command.reason ? String(command.reason) : 'runtime_policy_update'
  };
}

function applyFlagCommandToState(state, command) {
  if (state.history.some((entry) => entry.id === command.id)) {
    return {
      ...state,
      history: [
        ...state.history,
        {
          ...command,
          generation: state.generation,
          status: 'duplicate'
        }
      ]
    };
  }
  return {
    flags: {
      ...state.flags,
      [command.flag]: command.value
    },
    generation: state.generation + 1,
    history: [
      ...state.history,
      {
        ...command,
        generation: state.generation + 1,
        status: 'applied'
      }
    ]
  };
}

function normalizeHistoryEntry(entry = {}) {
  if (!entry.id || !entry.flag) return null;
  return {
    id: String(entry.id),
    op: entry.op ?? 'set',
    flag: String(entry.flag),
    value: parseBoolean(entry.value),
    reason: entry.reason ? String(entry.reason) : 'runtime_policy_update',
    generation: Number(entry.generation ?? 0),
    status: entry.status ?? 'applied'
  };
}

function buildRestartToken(flags, generation) {
  return `ff:${generation}:${stableHash(flags)}`;
}

function deterministicBoundaryKey(value) {
  return `ff-boundary:${stableHash(value)}`;
}

function deterministicCommandId(value) {
  return `flag-command:${stableHash(value)}`;
}

function optionalString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableHash(value) {
  const serialized = JSON.stringify(stableClone(value));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableClone(nested)])
    );
  }
  return value;
}
