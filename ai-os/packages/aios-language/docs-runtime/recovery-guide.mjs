import {
  applyMailchimpRecoveryPatch,
  buildMailchimpRecoveryPlan,
  classifyMailchimpRecovery,
} from '../runtime/recovery-handoff.mjs';

function compactString(value) {
  return String(value ?? '').trim();
}

function stableList(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : String(value).split(',');
  return Array.from(new Set(list.map(compactString).filter(Boolean))).sort();
}

function normalizeRecoveryItems(plan) {
  const items = Array.isArray(plan.recoveryItems) ? plan.recoveryItems : [];
  return items.map((item, index) => ({
    index,
    code: compactString(item.code || item.id || 'mailchimp.recovery.item'),
    action: compactString(item.action || item.nextAction || plan.nextAction || 'observe'),
    requiresOperator: item.requiresOperator === true,
    recoverable: item.recoverable !== false,
    message: compactString(item.message),
  }));
}

function normalizeLifecycleControls(input = {}, runtime = {}) {
  const settings = runtime.settings && typeof runtime.settings === 'object'
    ? runtime.settings
    : input.recoverySettings && typeof input.recoverySettings === 'object'
      ? input.recoverySettings
      : {};
  const enabled = settings.enabled !== false && runtime.enabled !== false;
  const manualOnly = settings.manualOnly === true || runtime.manualOnly === true;
  const maxAttempts = Number.isFinite(Number(settings.maxAttempts))
    ? Number(settings.maxAttempts)
    : Number.isFinite(Number(runtime.maxAttempts))
      ? Number(runtime.maxAttempts)
      : 3;
  const attempt = Number.isFinite(Number(runtime.attempt))
    ? Number(runtime.attempt)
    : Number.isFinite(Number(settings.attempt))
      ? Number(settings.attempt)
      : 0;
  const minBackoffSeconds = Number.isFinite(Number(settings.minBackoffSeconds))
    ? Number(settings.minBackoffSeconds)
    : 30;
  const maxBackoffSeconds = Number.isFinite(Number(settings.maxBackoffSeconds))
    ? Number(settings.maxBackoffSeconds)
    : 900;
  const schedule = runtime.schedule && typeof runtime.schedule === 'object'
    ? runtime.schedule
    : settings.schedule && typeof settings.schedule === 'object'
      ? settings.schedule
      : {};
  const windowOpen = schedule.windowOpen !== false;
  const allowProviderWrites = settings.allowProviderWrites === true || runtime.allowProviderWrites === true;
  const requireAudit = settings.requireAudit !== false;
  const auditReady = runtime.auditHandoff?.accepted === true
    || runtime.statusSnapshot?.statusLedger?.health?.boundary?.auditHandoff?.accepted === true
    || requireAudit === false;
  const validationErrors = stableList([
    ...(maxAttempts < 1 ? ['max_attempts_below_one'] : []),
    ...(attempt < 0 ? ['attempt_below_zero'] : []),
    ...(minBackoffSeconds < 0 ? ['min_backoff_below_zero'] : []),
    ...(maxBackoffSeconds < minBackoffSeconds ? ['max_backoff_below_min'] : []),
    ...(allowProviderWrites && !auditReady ? ['provider_writes_require_audit'] : []),
  ]);
  const exhausted = attempt >= maxAttempts;
  const backoffSeconds = Math.min(
    maxBackoffSeconds,
    Math.max(minBackoffSeconds, minBackoffSeconds * (2 ** Math.min(Math.max(attempt, 0), 5))),
  );

  return {
    enabled,
    manualOnly,
    attempt,
    maxAttempts,
    exhausted,
    allowProviderWrites,
    requireAudit,
    auditReady,
    schedule: {
      windowOpen,
      notBefore: compactString(schedule.notBefore),
      backoffSeconds,
      queue: compactString(schedule.queue || 'mailchimp.recovery'),
    },
    validationErrors,
    accepted: enabled
      && validationErrors.length === 0
      && exhausted === false
      && windowOpen === true
      && (manualOnly === false || runtime.operatorApproved === true),
  };
}

function buildLifecycleCommand(plan, classification, controls, readiness) {
  const baseCommand = compactString(plan.persistedState?.resume?.command || plan.nextAction || classification.nextAction);
  if (!controls.enabled) {
    return {
      command: 'recovery_disabled',
      enabled: false,
      scheduleState: 'disabled',
      nextAction: 'enable_recovery_controls',
    };
  }
  if (controls.validationErrors.length > 0) {
    return {
      command: 'settings_invalid',
      enabled: false,
      scheduleState: 'blocked',
      nextAction: 'repair_recovery_settings',
    };
  }
  if (controls.exhausted) {
    return {
      command: 'attempts_exhausted',
      enabled: false,
      scheduleState: 'hold',
      nextAction: 'hold_for_operator',
    };
  }
  if (controls.manualOnly && readiness.acceptedForResume !== true) {
    return {
      command: 'operator_gate_required',
      enabled: false,
      scheduleState: 'waiting_for_operator',
      nextAction: 'request_operator_approval',
    };
  }
  if (!controls.schedule.windowOpen) {
    return {
      command: 'schedule_window_closed',
      enabled: true,
      scheduleState: 'scheduled',
      nextAction: 'wait_for_recovery_window',
    };
  }

  return {
    command: baseCommand || 'resume_runtime_adapter',
    enabled: readiness.acceptedForResume === true,
    scheduleState: readiness.acceptedForResume === true ? 'ready' : 'blocked',
    nextAction: readiness.acceptedForResume === true
      ? baseCommand || 'resume_runtime_adapter'
      : readiness.nextAction,
  };
}

function buildResumePatch(plan, classification, runtime) {
  const requestedPatch = runtime.patch && typeof runtime.patch === 'object' ? runtime.patch : {};
  const nextAction = compactString(plan.nextAction || classification.nextAction || 'observe');
  const forceDryRun = nextAction === 'downgrade_to_dry_run'
    || classification.requiresRollback === true
    || plan.lifecycle?.blocked === true;
  return {
    dryRun: requestedPatch.dryRun ?? forceDryRun,
    idempotencyKey: requestedPatch.idempotencyKey
      || plan.persistedState?.idempotency?.nextCommandKey
      || classification.requestId
      || runtime.idempotencyKey
      || '',
    truthBoundary: requestedPatch.truthBoundary
      || (forceDryRun ? 'local-dry-run' : runtime.truthBoundary)
      || '',
  };
}

function buildRecoveryReadiness(plan, classification, items, controls) {
  const operatorItems = items.filter((item) => item.requiresOperator);
  const unrecoverableItems = items.filter((item) => item.recoverable === false);
  const providerRefresh = plan.validationSummary?.providerRefreshRequired === true;
  const cacheRefresh = plan.validationSummary?.compileCacheRefreshRequired === true;
  const retryExhausted = plan.validationSummary?.compileCacheRetryExhausted === true;
  const accepted = operatorItems.length === 0
    && unrecoverableItems.length === 0
    && retryExhausted === false
    && controls.accepted === true
    && classification.requiresRollback !== true;
  const nextAction = retryExhausted
    ? 'hold_for_operator'
    : controls.enabled === false
      ? 'enable_recovery_controls'
      : controls.validationErrors.length > 0
        ? 'repair_recovery_settings'
        : controls.exhausted
          ? 'hold_for_operator'
          : controls.schedule.windowOpen === false
            ? 'wait_for_recovery_window'
            : operatorItems[0]?.action
              || unrecoverableItems[0]?.action
              || plan.lifecycle?.nextAction
              || plan.nextAction
              || classification.nextAction
              || 'observe';

  return {
    status: accepted
      ? 'ready'
      : retryExhausted || unrecoverableItems.length > 0
        ? 'hold'
        : 'needs_operator',
    acceptedForResume: accepted,
    requiresRollback: classification.requiresRollback === true,
    recoverable: classification.recoverable !== false && unrecoverableItems.length === 0,
    nextAction,
    validationSummary: {
      recoveryItems: items.length,
      operatorItems: operatorItems.length,
      unrecoverableItems: unrecoverableItems.length,
      providerRefresh,
      compileCacheRefresh: cacheRefresh,
      retryExhausted,
      controlsEnabled: controls.enabled,
      manualOnly: controls.manualOnly,
      scheduleWindowOpen: controls.schedule.windowOpen,
      settingsErrors: controls.validationErrors.length,
      attemptsRemaining: Math.max(0, controls.maxAttempts - controls.attempt),
    },
  };
}

export function buildMailchimpRecoveryGuidePlan(input = {}, runtime = {}) {
  const classification = classifyMailchimpRecovery(input, runtime);
  const plan = buildMailchimpRecoveryPlan(input, runtime);
  const items = normalizeRecoveryItems(plan);
  const controls = normalizeLifecycleControls(input, runtime);
  const readiness = buildRecoveryReadiness(plan, classification, items, controls);
  const lifecycleCommand = buildLifecycleCommand(plan, classification, controls, readiness);
  const resumePatch = buildResumePatch(plan, classification, runtime);
  const patchedDescriptor = applyMailchimpRecoveryPatch(input, resumePatch);

  return {
    kind: 'aios.docsRuntime.recoveryGuide.mailchimp.v1',
    provider: 'mailchimp',
    classification,
    recoveryPlan: plan,
    recoveryItems: items,
    controls,
    lifecycleCommand,
    readiness,
    resumePatch,
    patchedDescriptor,
    statusHandoff: {
      requestId: compactString(classification.requestId || plan.requestId),
      nextAction: lifecycleCommand.nextAction,
      acceptedForResume: readiness.acceptedForResume && lifecycleCommand.enabled === true,
      resumeCommand: lifecycleCommand.command,
      scheduleState: lifecycleCommand.scheduleState,
      controls,
      blockedReasons: stableList([
        ...(readiness.acceptedForResume ? [] : [readiness.status]),
        ...(controls.validationErrors || []),
        ...(controls.enabled ? [] : ['recovery_disabled']),
        ...(controls.exhausted ? ['attempts_exhausted'] : []),
        ...(plan.persistedState?.resume?.blockedReasons || []),
      ]),
    },
    exportSummary: {
      exportReady: readiness.acceptedForResume,
      blockedReasons: stableList([
        ...(readiness.requiresRollback ? ['requires_rollback'] : []),
        ...(readiness.validationSummary.retryExhausted ? ['retry_exhausted'] : []),
        ...(controls.validationErrors || []),
        ...(controls.enabled ? [] : ['recovery_disabled']),
        ...items.filter((item) => item.requiresOperator).map((item) => item.code),
      ]),
      validationSummary: readiness.validationSummary,
    },
  };
}

export function assertMailchimpRecoveryGuideReady(contract) {
  const target = contract?.kind === 'aios.docsRuntime.recoveryGuide.mailchimp.v1'
    ? contract
    : buildMailchimpRecoveryGuidePlan(contract || {});
  return {
    ok: target.readiness.acceptedForResume === true,
    status: target.readiness.status,
    nextAction: target.readiness.nextAction,
    blockedReasons: target.exportSummary.blockedReasons,
    validationSummary: target.readiness.validationSummary,
  };
}
