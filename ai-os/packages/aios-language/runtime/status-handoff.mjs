import {
  compileMailchimpAdapterHandoff,
  buildMailchimpAdapterHistorySnapshot,
  buildMailchimpAdapterClientCommand,
  buildMailchimpAdapterDecisionEnvelope,
  buildMailchimpAdapterNextStepHandoff,
  buildMailchimpAdapterPersistedResumeTicket,
  buildMailchimpAdapterPermissionHealth,
  buildMailchimpTenantBoundaryContinuityContract,
  buildMailchimpTenantBoundaryAuditEnvelope,
  buildMailchimpTenantPermissionDecisionBundle,
  summarizeMailchimpAdapterHistory,
} from './adapter-handoff.mjs';
import {
  buildMailchimpCompileCacheLifecycleDecision,
  buildMailchimpCompileCacheBoundaryCheckpoint,
  buildMailchimpCompileCacheOperationalHealthReport,
  buildMailchimpCompileCacheExportPackage,
  buildMailchimpCompileCachePersistedReplayState,
  buildMailchimpCompileCacheProviderSyncCheckpoint,
  buildMailchimpCompileCacheResumeGate,
  buildMailchimpCompileCacheReplayBarrier,
  buildMailchimpCompileCacheUiHandoff,
  buildMailchimpCompileCacheAcceptanceChecklist,
} from '../compiler/compile-cache.mjs';

const TERMINAL_STATES = new Set(['succeeded', 'failed', 'rolled_back', 'cancelled']);
const ACTIVE_STATES = new Set(['queued', 'running', 'waiting_for_verifier', 'recovering']);

function compactString(value) {
  return String(value ?? '').trim();
}

function normalizeState(value) {
  const state = compactString(value || 'queued').toLowerCase().replaceAll('-', '_');
  if (TERMINAL_STATES.has(state) || ACTIVE_STATES.has(state)) return state;
  return 'unknown';
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .map((event, index) => ({
      index,
      at: compactString(event?.at || event?.time || `event:${index}`),
      state: normalizeState(event?.state),
      code: compactString(event?.code || event?.type || 'mailchimp.status.event'),
      message: compactString(event?.message),
      truth: compactString(event?.truth || event?.truthBoundary),
    }))
    .filter((event) => event.code || event.message || event.state !== 'unknown');
}

function latestMeaningfulEvent(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].state !== 'unknown' || events[index].code || events[index].message) {
      return events[index];
    }
  }
  return null;
}

function normalizeAcceptance(runtime = {}) {
  const source = runtime.acceptance && typeof runtime.acceptance === 'object'
    ? runtime.acceptance
    : runtime.operatorAcceptance && typeof runtime.operatorAcceptance === 'object'
      ? runtime.operatorAcceptance
      : {};
  const acceptedBy = compactString(source.acceptedBy || source.operator || source.user);
  const acceptedAt = compactString(source.acceptedAt || source.time || source.timestamp);
  return {
    accepted: source.accepted === true || Boolean(acceptedBy && acceptedAt),
    acceptedBy,
    acceptedAt,
    reason: compactString(source.reason || source.message),
  };
}

function normalizeBooleanControl(...values) {
  for (const value of values) {
    if (value === true || value === false) return value;
    const normalized = compactString(value).toLowerCase();
    if (['true', 'enabled', 'enable', 'on', 'yes', 'allow', 'allowed'].includes(normalized)) return true;
    if (['false', 'disabled', 'disable', 'off', 'no', 'deny', 'blocked'].includes(normalized)) return false;
  }
  return null;
}

function normalizeTimestampMs(value) {
  const compacted = compactString(value);
  if (!compacted) return null;
  const numeric = Number(compacted);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(compacted);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLifecycleControlState(descriptor = {}, runtime = {}) {
  const lifecycle = descriptor.lifecycle && typeof descriptor.lifecycle === 'object'
    ? descriptor.lifecycle
    : {};
  const runtimeControls = runtime.lifecycleControls && typeof runtime.lifecycleControls === 'object'
    ? runtime.lifecycleControls
    : runtime.controls && typeof runtime.controls === 'object'
      ? runtime.controls
      : {};
  const lifecycleControls = lifecycle.controls && typeof lifecycle.controls === 'object'
    ? lifecycle.controls
    : {};
  const runtimeSettings = runtime.lifecycleSettings && typeof runtime.lifecycleSettings === 'object'
    ? runtime.lifecycleSettings
    : runtime.settings && typeof runtime.settings === 'object'
      ? runtime.settings
      : {};
  const lifecycleSettings = lifecycle.settings && typeof lifecycle.settings === 'object'
    ? lifecycle.settings
    : {};
  const source = {
    ...lifecycleSettings,
    ...lifecycleControls,
    ...runtimeSettings,
    ...runtimeControls,
  };
  const requestedCommand = compactString(
    runtime.lifecycleCommand
      || runtime.requestedCommand
      || source.requestedCommand
      || lifecycle.requestedCommand
      || 'queue',
  ).toLowerCase().replaceAll('-', '_');
  const schedule = source.schedule && typeof source.schedule === 'object'
    ? source.schedule
    : runtime.schedule && typeof runtime.schedule === 'object'
      ? runtime.schedule
      : lifecycle.schedule && typeof lifecycle.schedule === 'object'
        ? lifecycle.schedule
        : {};
  const enabledControl = normalizeBooleanControl(source.enabled, runtime.lifecycleEnabled, lifecycle.enabled);
  const disabledControl = normalizeBooleanControl(source.disabled, runtime.lifecycleDisabled, lifecycle.disabled);
  const dispatchControl = normalizeBooleanControl(
    source.dispatchEnabled,
    source.dispatch,
    runtime.dispatchEnabled,
    lifecycle.dispatchReady,
  );
  const writeControl = normalizeBooleanControl(
    source.writeEnabled,
    source.externalWritesEnabled,
    runtime.writeEnabled,
    runtime.externalWritesEnabled,
  );
  const scheduleControl = normalizeBooleanControl(
    source.scheduleEnabled,
    schedule.enabled,
    runtime.scheduleEnabled,
  );
  const pausedControl = normalizeBooleanControl(source.paused, schedule.paused, runtime.schedulePaused);
  const manualStartControl = normalizeBooleanControl(source.manualStartRequired, schedule.manualStartRequired);
  const forceRunControl = normalizeBooleanControl(source.forceRun, schedule.forceRun, runtime.forceRun);
  const operatorHold = normalizeBooleanControl(source.operatorHold, runtime.operatorHold, lifecycle.operatorHold) === true;
  const enabled = disabledControl === true ? false : enabledControl !== false;
  const dispatchEnabled = dispatchControl !== false && enabled;
  const writeEnabled = writeControl !== false;
  const mode = compactString(schedule.mode || source.scheduleMode || (scheduleControl === true ? 'scheduled' : 'immediate'))
    .toLowerCase()
    .replaceAll('-', '_');
  const startAt = compactString(schedule.startAt || source.startAt || runtime.startAt);
  const notBefore = compactString(schedule.notBefore || source.notBefore || runtime.notBefore);
  const endAt = compactString(schedule.endAt || source.endAt || runtime.endAt);
  const nextRunAt = compactString(schedule.nextRunAt || schedule.nextAt || source.nextRunAt || runtime.nextRunAt);
  const nowAt = compactString(runtime.now || runtime.observedAt || runtime.currentTime || source.now || lifecycle.now);
  const startMs = normalizeTimestampMs(startAt || notBefore);
  const endMs = normalizeTimestampMs(endAt);
  const nextRunMs = normalizeTimestampMs(nextRunAt);
  const nowMs = normalizeTimestampMs(nowAt);
  const scheduled = scheduleControl === true
    || ['scheduled', 'windowed', 'cron'].includes(mode)
    || Boolean(startAt || notBefore || endAt || nextRunAt);
  const paused = pausedControl === true || mode === 'paused';
  const manualStartRequired = manualStartControl === true || mode === 'manual';
  const forceRun = forceRunControl === true;
  const hasClock = nowMs !== null;
  const beforeWindow = scheduled && hasClock && startMs !== null && nowMs < startMs;
  const afterWindow = scheduled && hasClock && endMs !== null && nowMs > endMs;
  const notDue = scheduled && hasClock && nextRunMs !== null && nowMs < nextRunMs && !forceRun;
  const missingTarget = scheduled && !startAt && !notBefore && !nextRunAt && mode !== 'cron';
  const needsClock = scheduled && !hasClock && (startAt || notBefore || endAt || nextRunAt);
  const dispatchLikeCommand = ['dispatch', 'resume', 'retry', 'run', 'execute'].includes(requestedCommand);
  const blockedReasons = stableList([
    ...(!enabled ? ['lifecycle_controls_disabled'] : []),
    ...(dispatchLikeCommand && !dispatchEnabled ? ['lifecycle_dispatch_disabled'] : []),
    ...(descriptor.truthBoundary?.externalWritesAllowed === true && !writeEnabled ? ['external_write_control_disabled'] : []),
    ...(operatorHold ? ['operator_hold_enabled'] : []),
    ...(paused ? ['schedule_paused'] : []),
    ...(manualStartRequired && dispatchLikeCommand ? ['manual_start_required'] : []),
    ...(missingTarget ? ['schedule_target_missing'] : []),
    ...(needsClock ? ['schedule_clock_missing'] : []),
    ...(beforeWindow ? ['schedule_window_not_open'] : []),
    ...(afterWindow ? ['schedule_window_expired'] : []),
    ...(notDue ? ['schedule_not_due'] : []),
  ]);
  const nextAction = blockedReasons.includes('lifecycle_controls_disabled')
    ? 'enable_lifecycle_controls'
    : blockedReasons.includes('lifecycle_dispatch_disabled')
      ? 'enable_lifecycle_dispatch'
      : blockedReasons.includes('external_write_control_disabled')
        ? 'enable_external_write_control'
        : blockedReasons.includes('operator_hold_enabled')
          ? 'release_operator_hold'
          : blockedReasons.includes('schedule_paused')
            ? 'resume_schedule'
            : blockedReasons.includes('manual_start_required')
              ? 'confirm_manual_start'
              : blockedReasons.includes('schedule_target_missing')
                ? 'set_schedule_target'
                : blockedReasons.includes('schedule_clock_missing')
                  ? 'provide_schedule_clock'
                  : blockedReasons.includes('schedule_window_expired')
                    ? 'reschedule_lifecycle_command'
                    : blockedReasons.includes('schedule_window_not_open') || blockedReasons.includes('schedule_not_due')
                      ? 'wait_for_schedule_window'
                      : lifecycle.nextAction || (requestedCommand === 'dispatch' ? 'queue' : requestedCommand);

  return {
    protocol: 'aios.status-lifecycle-controls.mailchimp.v1',
    requestedCommand,
    ready: blockedReasons.length === 0,
    enabled,
    dispatchEnabled,
    writeEnabled,
    operatorHold,
    nextAction,
    blockedReasons,
    controls: {
      enabled,
      dispatchEnabled,
      writeEnabled,
      scheduleEnabled: scheduled,
      paused,
      manualStartRequired,
      forceRun,
    },
    schedule: {
      mode: mode || (scheduled ? 'scheduled' : 'immediate'),
      timezone: compactString(schedule.timezone || source.timezone || runtime.timezone || 'UTC'),
      nowAt,
      startAt,
      notBefore,
      endAt,
      nextRunAt,
      hasClock,
      beforeWindow,
      afterWindow,
      notDue,
      windowOpen: scheduled ? !beforeWindow && !afterWindow && !notDue && !missingTarget && !needsClock : true,
    },
    validationSummary: {
      ready: blockedReasons.length === 0,
      blocking: blockedReasons.length,
      blockedReasons,
    },
  };
}

function normalizeLifecycleCommand(value, fallback = 'queue') {
  const command = compactString(value || fallback).toLowerCase().replaceAll('-', '_');
  const aliases = new Map([
    ['start', 'run'],
    ['execute', 'run'],
    ['continue', 'resume'],
    ['unpause', 'resume_schedule'],
    ['pause', 'pause_schedule'],
    ['hold', 'set_operator_hold'],
    ['release_hold', 'release_operator_hold'],
    ['manual_start', 'confirm_manual_start'],
    ['set_schedule', 'set_schedule_target'],
    ['reschedule', 'reschedule_lifecycle_command'],
    ['enable', 'enable_lifecycle_controls'],
    ['disable', 'disable_lifecycle_controls'],
    ['enable_dispatch', 'enable_lifecycle_dispatch'],
    ['disable_dispatch', 'disable_lifecycle_dispatch'],
  ]);
  return aliases.get(command) || command || fallback;
}

function selectLifecycleCommandSource(descriptor = {}, runtime = {}) {
  const lifecycle = descriptor.lifecycle && typeof descriptor.lifecycle === 'object'
    ? descriptor.lifecycle
    : {};
  const runtimeControls = runtime.lifecycleControls && typeof runtime.lifecycleControls === 'object'
    ? runtime.lifecycleControls
    : runtime.controls && typeof runtime.controls === 'object'
      ? runtime.controls
      : {};
  const runtimeSettings = runtime.lifecycleSettings && typeof runtime.lifecycleSettings === 'object'
    ? runtime.lifecycleSettings
    : runtime.settings && typeof runtime.settings === 'object'
      ? runtime.settings
      : {};
  const lifecycleControls = lifecycle.controls && typeof lifecycle.controls === 'object'
    ? lifecycle.controls
    : {};
  const lifecycleSettings = lifecycle.settings && typeof lifecycle.settings === 'object'
    ? lifecycle.settings
    : {};

  return {
    ...lifecycleSettings,
    ...lifecycleControls,
    ...runtimeSettings,
    ...runtimeControls,
  };
}

export function buildMailchimpLifecycleCommandState(
  descriptor = {},
  runtime = {},
  lifecycleControlState = null,
) {
  const controls = lifecycleControlState?.protocol === 'aios.status-lifecycle-controls.mailchimp.v1'
    ? lifecycleControlState
    : normalizeLifecycleControlState(descriptor, runtime);
  const source = selectLifecycleCommandSource(descriptor, runtime);
  const requestedCommand = normalizeLifecycleCommand(
    runtime.lifecycleCommand
      || runtime.statusCommand
      || runtime.requestedCommand
      || source.requestedCommand
      || descriptor.lifecycle?.requestedCommand
      || controls.requestedCommand,
  );
  const commandSet = new Set([
    'observe',
    'queue',
    'run',
    'dispatch',
    'resume',
    'retry',
    'enable_lifecycle_controls',
    'disable_lifecycle_controls',
    'enable_lifecycle_dispatch',
    'disable_lifecycle_dispatch',
    'pause_schedule',
    'resume_schedule',
    'set_schedule_target',
    'reschedule_lifecycle_command',
    'confirm_manual_start',
    'set_operator_hold',
    'release_operator_hold',
  ]);
  const schedule = source.schedule && typeof source.schedule === 'object' ? source.schedule : {};
  const targetStartAt = compactString(runtime.targetStartAt || source.targetStartAt || schedule.targetStartAt);
  const targetNotBefore = compactString(runtime.targetNotBefore || source.targetNotBefore || schedule.targetNotBefore);
  const targetNextRunAt = compactString(runtime.targetNextRunAt || source.targetNextRunAt || schedule.targetNextRunAt);
  const targetEndAt = compactString(runtime.targetEndAt || source.targetEndAt || schedule.targetEndAt);
  const targetTimezone = compactString(
    runtime.targetTimezone
      || source.targetTimezone
      || schedule.targetTimezone
      || controls.schedule?.timezone
      || 'UTC',
  );
  const targetMode = compactString(runtime.targetScheduleMode || source.targetScheduleMode || schedule.targetMode)
    .toLowerCase()
    .replaceAll('-', '_');
  const scheduleCommand = ['set_schedule_target', 'reschedule_lifecycle_command'].includes(requestedCommand);
  const dispatchLikeCommand = ['dispatch', 'resume', 'retry', 'run'].includes(requestedCommand);
  const enableCommand = requestedCommand === 'enable_lifecycle_controls';
  const disableCommand = requestedCommand === 'disable_lifecycle_controls';
  const enableDispatchCommand = requestedCommand === 'enable_lifecycle_dispatch';
  const disableDispatchCommand = requestedCommand === 'disable_lifecycle_dispatch';
  const pauseCommand = requestedCommand === 'pause_schedule';
  const resumeScheduleCommand = requestedCommand === 'resume_schedule';
  const manualStartCommand = requestedCommand === 'confirm_manual_start';
  const holdCommand = requestedCommand === 'set_operator_hold';
  const releaseHoldCommand = requestedCommand === 'release_operator_hold';
  const hasScheduleTarget = Boolean(targetStartAt || targetNotBefore || targetNextRunAt || targetEndAt);
  const targetStartMs = normalizeTimestampMs(targetStartAt || targetNotBefore || targetNextRunAt);
  const targetEndMs = normalizeTimestampMs(targetEndAt);
  const targetWindowInvalid = targetStartMs !== null && targetEndMs !== null && targetEndMs < targetStartMs;
  const knownCommand = commandSet.has(requestedCommand);
  const alreadyApplied = (
    (enableCommand && controls.enabled === true)
    || (disableCommand && controls.enabled === false)
    || (enableDispatchCommand && controls.dispatchEnabled === true)
    || (disableDispatchCommand && controls.dispatchEnabled === false)
    || (pauseCommand && controls.controls?.paused === true)
    || (resumeScheduleCommand && controls.controls?.paused !== true)
    || (manualStartCommand && controls.controls?.manualStartRequired !== true)
    || (holdCommand && controls.operatorHold === true)
    || (releaseHoldCommand && controls.operatorHold !== true)
  );
  const commandBlockedReasons = stableList([
    ...(!knownCommand ? ['lifecycle_command_unknown'] : []),
    ...(dispatchLikeCommand && controls.ready === false ? controls.blockedReasons : []),
    ...(dispatchLikeCommand && controls.dispatchEnabled === false ? ['lifecycle_dispatch_disabled'] : []),
    ...(scheduleCommand && !hasScheduleTarget ? ['schedule_target_missing'] : []),
    ...(scheduleCommand && targetWindowInvalid ? ['schedule_target_window_invalid'] : []),
    ...(pauseCommand && controls.controls?.scheduleEnabled !== true ? ['schedule_not_enabled'] : []),
    ...(resumeScheduleCommand && controls.controls?.scheduleEnabled !== true ? ['schedule_not_enabled'] : []),
    ...(manualStartCommand && controls.enabled === false ? ['lifecycle_controls_disabled'] : []),
  ]);
  const executable = commandBlockedReasons.length === 0;
  const state = executable
    ? alreadyApplied ? 'noop' : 'ready'
    : 'blocked';
  const nextAction = executable
    ? alreadyApplied ? 'observe' : requestedCommand
    : commandBlockedReasons.includes('lifecycle_command_unknown')
      ? 'select_supported_lifecycle_command'
      : commandBlockedReasons.includes('schedule_target_missing')
        ? 'set_schedule_target'
        : commandBlockedReasons.includes('schedule_target_window_invalid')
          ? 'repair_schedule_window'
          : controls.nextAction || 'review_lifecycle_controls';
  const desiredControls = {
    enabled: enableCommand ? true : disableCommand ? false : controls.enabled !== false,
    dispatchEnabled: enableDispatchCommand
      ? true
      : disableDispatchCommand
        ? false
        : controls.dispatchEnabled !== false,
    paused: pauseCommand
      ? true
      : resumeScheduleCommand
        ? false
        : controls.controls?.paused === true,
    manualStartRequired: manualStartCommand ? false : controls.controls?.manualStartRequired === true,
    operatorHold: holdCommand ? true : releaseHoldCommand ? false : controls.operatorHold === true,
  };
  const desiredSchedule = {
    mode: targetMode || controls.schedule?.mode || 'immediate',
    timezone: targetTimezone,
    startAt: targetStartAt || controls.schedule?.startAt || '',
    notBefore: targetNotBefore || controls.schedule?.notBefore || '',
    endAt: targetEndAt || controls.schedule?.endAt || '',
    nextRunAt: targetNextRunAt || controls.schedule?.nextRunAt || '',
    windowOpenAfterApply: scheduleCommand
      ? !targetWindowInvalid
      : controls.schedule?.windowOpen === true,
  };
  const effectList = stableList([
    ...(enableCommand ? ['enable:lifecycle_controls'] : []),
    ...(disableCommand ? ['disable:lifecycle_controls'] : []),
    ...(enableDispatchCommand ? ['enable:lifecycle_dispatch'] : []),
    ...(disableDispatchCommand ? ['disable:lifecycle_dispatch'] : []),
    ...(pauseCommand ? ['pause:schedule'] : []),
    ...(resumeScheduleCommand ? ['resume:schedule'] : []),
    ...(scheduleCommand ? ['upsert:schedule_target'] : []),
    ...(manualStartCommand ? ['confirm:manual_start'] : []),
    ...(holdCommand ? ['set:operator_hold'] : []),
    ...(releaseHoldCommand ? ['release:operator_hold'] : []),
    ...(dispatchLikeCommand ? [`execute:${requestedCommand}`] : []),
  ]);

  return {
    protocol: 'aios.status-lifecycle-command.mailchimp.v1',
    command: requestedCommand,
    state,
    ready: executable,
    executable,
    alreadyApplied,
    nextAction,
    blockedReasons: commandBlockedReasons,
    effects: {
      count: effectList.length,
      list: effectList,
      desiredControls,
      desiredSchedule,
    },
    validationSummary: {
      ready: executable,
      blocking: commandBlockedReasons.length,
      blockedReasons: commandBlockedReasons,
      knownCommand,
      scheduleTargetPresent: hasScheduleTarget,
      scheduleWindowValid: !targetWindowInvalid,
    },
    audit: {
      channel: 'status-lifecycle-command',
      decision: executable ? alreadyApplied ? 'noop' : 'allow' : 'block',
      commandKey: [
        compactString(descriptor.requestId || runtime.requestId || 'mailchimp-status'),
        requestedCommand,
        targetNextRunAt || targetStartAt || targetNotBefore || controls.schedule?.nextRunAt || 'immediate',
      ].join(':'),
    },
  };
}

function pickLifecyclePatchValue(patch = {}, source = {}, schedule = {}, key = '') {
  const targetKey = `target${key[0]?.toUpperCase() || ''}${key.slice(1)}`;
  if (Object.hasOwn(patch, key)) return patch[key];
  if (Object.hasOwn(patch, targetKey)) return patch[targetKey];
  if (Object.hasOwn(source, targetKey)) return source[targetKey];
  if (Object.hasOwn(schedule, targetKey)) return schedule[targetKey];
  if (Object.hasOwn(source, key)) return source[key];
  if (Object.hasOwn(schedule, key)) return schedule[key];
  return undefined;
}

function lifecyclePatchBoolean(patch = {}, source = {}, schedule = {}, key = '', fallback = null) {
  const value = pickLifecyclePatchValue(patch, source, schedule, key);
  const normalized = normalizeBooleanControl(value);
  return normalized === null ? fallback : normalized;
}

function lifecyclePatchString(patch = {}, source = {}, schedule = {}, key = '', fallback = '') {
  const value = pickLifecyclePatchValue(patch, source, schedule, key);
  const compacted = compactString(value);
  return compacted || fallback;
}

function lifecyclePatchMode(patch = {}, source = {}, schedule = {}, fallback = 'immediate') {
  return lifecyclePatchString(patch, source, schedule, 'mode', fallback)
    .toLowerCase()
    .replaceAll('-', '_');
}

export function buildMailchimpLifecycleSettingsPatchContract(
  descriptor = {},
  runtime = {},
  lifecycleControlState = null,
  lifecycleCommandState = null,
) {
  const controls = lifecycleControlState?.protocol === 'aios.status-lifecycle-controls.mailchimp.v1'
    ? lifecycleControlState
    : normalizeLifecycleControlState(descriptor, runtime);
  const commandState = lifecycleCommandState?.protocol === 'aios.status-lifecycle-command.mailchimp.v1'
    ? lifecycleCommandState
    : buildMailchimpLifecycleCommandState(descriptor, runtime, controls);
  const source = selectLifecycleCommandSource(descriptor, runtime);
  const explicitPatch = runtime.lifecycleSettingsPatch && typeof runtime.lifecycleSettingsPatch === 'object'
    ? runtime.lifecycleSettingsPatch
    : runtime.settingsPatch && typeof runtime.settingsPatch === 'object'
      ? runtime.settingsPatch
      : runtime.lifecyclePatch && typeof runtime.lifecyclePatch === 'object'
        ? runtime.lifecyclePatch
        : source.patch && typeof source.patch === 'object'
          ? source.patch
          : {};
  const schedulePatch = explicitPatch.schedule && typeof explicitPatch.schedule === 'object'
    ? explicitPatch.schedule
    : source.schedule && typeof source.schedule === 'object'
      ? source.schedule
      : {};
  const command = normalizeLifecycleCommand(
    runtime.lifecycleCommand
      || runtime.statusCommand
      || runtime.requestedCommand
      || explicitPatch.command
      || source.requestedCommand
      || commandState.command,
  );
  const settingsCommands = new Set([
    'enable_lifecycle_controls',
    'disable_lifecycle_controls',
    'enable_lifecycle_dispatch',
    'disable_lifecycle_dispatch',
    'pause_schedule',
    'resume_schedule',
    'set_schedule_target',
    'reschedule_lifecycle_command',
    'confirm_manual_start',
    'set_operator_hold',
    'release_operator_hold',
  ]);
  const currentControls = controls.controls || {};
  const targetEnabled = command === 'enable_lifecycle_controls'
    ? true
    : command === 'disable_lifecycle_controls'
      ? false
      : lifecyclePatchBoolean(explicitPatch, source, schedulePatch, 'enabled', controls.enabled !== false);
  const targetDispatchEnabled = command === 'enable_lifecycle_dispatch'
    ? true
    : command === 'disable_lifecycle_dispatch'
      ? false
      : lifecyclePatchBoolean(explicitPatch, source, schedulePatch, 'dispatchEnabled', controls.dispatchEnabled !== false);
  const targetWriteEnabled = lifecyclePatchBoolean(explicitPatch, source, schedulePatch, 'writeEnabled', controls.writeEnabled !== false);
  const targetPaused = command === 'pause_schedule'
    ? true
    : command === 'resume_schedule'
      ? false
      : lifecyclePatchBoolean(explicitPatch, source, schedulePatch, 'paused', currentControls.paused === true);
  const targetManualStartRequired = command === 'confirm_manual_start'
    ? false
    : lifecyclePatchBoolean(explicitPatch, source, schedulePatch, 'manualStartRequired', currentControls.manualStartRequired === true);
  const targetOperatorHold = command === 'set_operator_hold'
    ? true
    : command === 'release_operator_hold'
      ? false
      : lifecyclePatchBoolean(explicitPatch, source, schedulePatch, 'operatorHold', controls.operatorHold === true);
  const targetForceRun = lifecyclePatchBoolean(explicitPatch, source, schedulePatch, 'forceRun', currentControls.forceRun === true);
  const targetMode = command === 'pause_schedule'
    ? 'paused'
    : command === 'resume_schedule' && controls.schedule?.mode === 'paused'
      ? 'scheduled'
      : lifecyclePatchMode(explicitPatch, source, schedulePatch, controls.schedule?.mode || 'immediate');
  const targetTimezone = lifecyclePatchString(explicitPatch, source, schedulePatch, 'timezone', controls.schedule?.timezone || 'UTC');
  const targetStartAt = lifecyclePatchString(explicitPatch, source, schedulePatch, 'startAt', controls.schedule?.startAt || '');
  const targetNotBefore = lifecyclePatchString(explicitPatch, source, schedulePatch, 'notBefore', controls.schedule?.notBefore || '');
  const targetEndAt = lifecyclePatchString(explicitPatch, source, schedulePatch, 'endAt', controls.schedule?.endAt || '');
  const targetNextRunAt = lifecyclePatchString(explicitPatch, source, schedulePatch, 'nextRunAt', controls.schedule?.nextRunAt || '');
  const scheduleMutatingCommand = ['set_schedule_target', 'reschedule_lifecycle_command'].includes(command);
  const targetScheduleEnabled = lifecyclePatchBoolean(
    explicitPatch,
    source,
    schedulePatch,
    'scheduleEnabled',
    currentControls.scheduleEnabled === true || scheduleMutatingCommand,
  );
  const startMs = normalizeTimestampMs(targetStartAt || targetNotBefore || targetNextRunAt);
  const endMs = normalizeTimestampMs(targetEndAt);
  const nowMs = normalizeTimestampMs(controls.schedule?.nowAt || runtime.now || runtime.observedAt);
  const targetBeforeWindow = targetScheduleEnabled && nowMs !== null && startMs !== null && nowMs < startMs;
  const targetAfterWindow = targetScheduleEnabled && nowMs !== null && endMs !== null && nowMs > endMs;
  const invalidWindow = startMs !== null && endMs !== null && endMs < startMs;
  const missingScheduleTarget = targetScheduleEnabled
    && !targetStartAt
    && !targetNotBefore
    && !targetNextRunAt
    && targetMode !== 'cron'
    && !targetPaused;
  const commandRequiresPatch = settingsCommands.has(command);
  const patchProvided = Object.keys(explicitPatch).length > 0 || commandRequiresPatch;
  const changedFields = stableList([
    ...(targetEnabled !== (controls.enabled !== false) ? ['controls.enabled'] : []),
    ...(targetDispatchEnabled !== (controls.dispatchEnabled !== false) ? ['controls.dispatchEnabled'] : []),
    ...(targetWriteEnabled !== (controls.writeEnabled !== false) ? ['controls.writeEnabled'] : []),
    ...(targetPaused !== (currentControls.paused === true) ? ['controls.paused'] : []),
    ...(targetManualStartRequired !== (currentControls.manualStartRequired === true) ? ['controls.manualStartRequired'] : []),
    ...(targetOperatorHold !== (controls.operatorHold === true) ? ['controls.operatorHold'] : []),
    ...(targetForceRun !== (currentControls.forceRun === true) ? ['controls.forceRun'] : []),
    ...(targetScheduleEnabled !== (currentControls.scheduleEnabled === true) ? ['schedule.enabled'] : []),
    ...(targetMode !== (controls.schedule?.mode || 'immediate') ? ['schedule.mode'] : []),
    ...(targetTimezone !== (controls.schedule?.timezone || 'UTC') ? ['schedule.timezone'] : []),
    ...(targetStartAt !== (controls.schedule?.startAt || '') ? ['schedule.startAt'] : []),
    ...(targetNotBefore !== (controls.schedule?.notBefore || '') ? ['schedule.notBefore'] : []),
    ...(targetEndAt !== (controls.schedule?.endAt || '') ? ['schedule.endAt'] : []),
    ...(targetNextRunAt !== (controls.schedule?.nextRunAt || '') ? ['schedule.nextRunAt'] : []),
  ]);
  const blockedReasons = stableList([
    ...(!patchProvided ? ['lifecycle_settings_patch_missing'] : []),
    ...(!settingsCommands.has(command) && commandState.ready === false ? ['lifecycle_command_not_settings_patch'] : []),
    ...(targetEnabled === false && ['enable_lifecycle_dispatch', 'set_schedule_target', 'reschedule_lifecycle_command'].includes(command)
      ? ['target_lifecycle_controls_disabled']
      : []),
    ...(targetEnabled === false && targetDispatchEnabled === true ? ['target_dispatch_requires_lifecycle_enabled'] : []),
    ...(descriptor.truthBoundary?.externalWritesAllowed === true && targetWriteEnabled !== true
      ? ['target_external_write_control_disabled']
      : []),
    ...(scheduleMutatingCommand && !targetScheduleEnabled ? ['target_schedule_not_enabled'] : []),
    ...(missingScheduleTarget ? ['target_schedule_target_missing'] : []),
    ...(invalidWindow ? ['target_schedule_window_invalid'] : []),
    ...(targetAfterWindow ? ['target_schedule_window_expired'] : []),
  ]);
  const appliesSettings = patchProvided && changedFields.length > 0;
  const ready = blockedReasons.length === 0;
  const nextAction = ready
    ? appliesSettings ? 'apply_lifecycle_settings_patch' : 'observe'
    : blockedReasons.includes('lifecycle_settings_patch_missing')
      ? 'provide_lifecycle_settings_patch'
      : blockedReasons.includes('target_schedule_target_missing')
        ? 'set_schedule_target'
        : blockedReasons.includes('target_schedule_window_invalid')
          ? 'repair_schedule_window'
          : blockedReasons.includes('target_external_write_control_disabled')
            ? 'enable_external_write_control'
            : blockedReasons.includes('target_dispatch_requires_lifecycle_enabled')
              ? 'enable_lifecycle_controls'
              : 'review_lifecycle_settings_patch';

  return {
    protocol: 'aios.status-lifecycle-settings-patch.mailchimp.v1',
    command,
    provided: patchProvided,
    ready,
    state: ready ? appliesSettings ? 'ready' : 'noop' : 'blocked',
    appliesSettings,
    nextAction,
    changedFields,
    blockedReasons,
    current: {
      controls: {
        enabled: controls.enabled !== false,
        dispatchEnabled: controls.dispatchEnabled !== false,
        writeEnabled: controls.writeEnabled !== false,
        scheduleEnabled: currentControls.scheduleEnabled === true,
        paused: currentControls.paused === true,
        manualStartRequired: currentControls.manualStartRequired === true,
        forceRun: currentControls.forceRun === true,
        operatorHold: controls.operatorHold === true,
      },
      schedule: controls.schedule || {},
    },
    desired: {
      controls: {
        enabled: targetEnabled,
        dispatchEnabled: targetDispatchEnabled,
        writeEnabled: targetWriteEnabled,
        scheduleEnabled: targetScheduleEnabled,
        paused: targetPaused,
        manualStartRequired: targetManualStartRequired,
        forceRun: targetForceRun,
        operatorHold: targetOperatorHold,
      },
      schedule: {
        mode: targetMode,
        timezone: targetTimezone,
        startAt: targetStartAt,
        notBefore: targetNotBefore,
        endAt: targetEndAt,
        nextRunAt: targetNextRunAt,
        beforeWindow: targetBeforeWindow,
        afterWindow: targetAfterWindow,
        windowOpenAfterApply: targetScheduleEnabled
          ? !targetBeforeWindow && !targetAfterWindow && !invalidWindow && !missingScheduleTarget
          : true,
      },
    },
    validationSummary: {
      ready,
      blocking: blockedReasons.length,
      blockedReasons,
      changedFields: changedFields.length,
      scheduleWindowValid: !invalidWindow,
      scheduleTargetPresent: !missingScheduleTarget,
    },
    audit: {
      channel: 'status-lifecycle-settings-patch',
      decision: ready ? appliesSettings ? 'allow' : 'noop' : 'block',
      patchKey: [
        compactString(descriptor.requestId || runtime.requestId || 'mailchimp-status'),
        command,
        changedFields.join('+') || 'noop',
      ].join(':'),
    },
  };
}

function normalizeCompileCacheAcceptanceChecklist(compileCache = {}, runtime = {}) {
  const source = compileCache.uiHandoff?.acceptanceChecklist?.protocol === 'aios.compile-cache-acceptance-checklist.mailchimp.v1'
    ? compileCache.uiHandoff.acceptanceChecklist
    : compileCache.acceptanceChecklist?.protocol === 'aios.compile-cache-acceptance-checklist.mailchimp.v1'
      ? compileCache.acceptanceChecklist
      : buildMailchimpCompileCacheAcceptanceChecklist({
        acceptancePreview: compileCache.uiHandoff?.acceptancePreview || compileCache.acceptancePreview,
        nextSteps: compileCache.uiHandoff?.nextSteps || [],
      }, runtime);
  const items = Array.isArray(source.items) ? source.items : [];
  const blockingItems = Array.isArray(source.blockingItems) ? source.blockingItems : [];
  const counts = source.counts && typeof source.counts === 'object' ? source.counts : {};

  return {
    protocol: 'aios.status-compile-cache-acceptance-checklist.mailchimp.v1',
    cacheKey: compactString(source.cacheKey || compileCache.cacheKey),
    state: compactString(source.state || 'review'),
    ready: source.ready === true,
    nextAction: compactString(source.nextAction || source.route?.primaryAction || compileCache.nextAction || 'observe'),
    acceptance: {
      required: source.acceptance?.required === true,
      accepted: source.acceptance?.accepted === true,
      acceptedBy: compactString(source.acceptance?.acceptedBy),
      acceptedAt: compactString(source.acceptance?.acceptedAt),
      canAccept: source.acceptance?.canAccept === true,
      token: compactString(source.acceptance?.token || source.route?.acceptanceToken),
      requiredBecause: stableList(source.acceptance?.requiredBecause),
      operatorItemCount: normalizeCounter(source.acceptance?.operatorItemCount),
    },
    counts: {
      total: normalizeCounter(counts.total || items.length),
      ready: normalizeCounter(counts.ready),
      blocking: normalizeCounter(counts.blocking || blockingItems.length),
      operator: normalizeCounter(counts.operator),
      provider: normalizeCounter(counts.provider),
      compiler: normalizeCounter(counts.compiler),
    },
    blockingItems: blockingItems.map((item, index) => ({
      index: index + 1,
      itemId: compactString(item.itemId),
      key: compactString(item.key),
      owner: compactString(item.owner || 'runtime'),
      nextAction: compactString(item.nextAction || 'review_compile_cache_status'),
      blockedReasons: stableList(item.blockedReasons),
    })),
    items: items.map((item, index) => ({
      index: index + 1,
      itemId: compactString(item.itemId),
      key: compactString(item.key),
      label: compactString(item.label),
      state: compactString(item.state || (item.ready ? 'ready' : 'blocked')),
      ready: item.ready === true,
      blocking: item.blocking === true,
      owner: compactString(item.owner || 'runtime'),
      nextAction: compactString(item.nextAction || 'observe'),
      blockedReasons: stableList(item.blockedReasons),
    })),
    route: {
      statusRouteState: compactString(source.route?.statusRouteState || (source.ready ? 'ready' : 'needs_attention')),
      primaryAction: compactString(source.route?.primaryAction || source.nextAction || 'observe'),
      recoveryCommand: compactString(source.route?.recoveryCommand || source.nextAction || 'observe'),
      acceptanceToken: compactString(source.route?.acceptanceToken || source.acceptance?.token),
      explainable: source.route?.explainable !== false,
    },
  };
}

function summarizeDiagnostics(diagnostics = []) {
  const normalized = Array.isArray(diagnostics) ? diagnostics : [];
  const errors = normalized.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = normalized.filter((diagnostic) => diagnostic.severity === 'warning');
  return {
    total: normalized.length,
    errors: errors.length,
    warnings: warnings.length,
    blockingCodes: errors.map((diagnostic) => compactString(diagnostic.code)).filter(Boolean).sort(),
    warningCodes: warnings.map((diagnostic) => compactString(diagnostic.code)).filter(Boolean).sort(),
  };
}

function normalizeCounter(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function stableList(values = []) {
  const source = Array.isArray(values) ? values : [values];
  return [...new Set(source.map(compactString).filter(Boolean))].sort();
}

function normalizeScopedList(...values) {
  return stableList(values.flatMap((value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return compactString(value)
      .split(',')
      .map((item) => item.trim());
  }));
}

function normalizeClientRequestMode(value, fallback = 'observe') {
  const mode = compactString(value || fallback).toLowerCase().replaceAll('-', '_');
  const aliases = new Map([
    ['view', 'observe'],
    ['preview', 'review'],
    ['accept', 'accept_preview_handoff'],
    ['submit', 'submit_client_command'],
    ['send', 'submit_client_command'],
    ['continue', 'resume_status_handoff'],
    ['retry', 'retry_status_handoff'],
    ['recover', 'recover_status_handoff'],
    ['export', 'export_status_report'],
  ]);
  return aliases.get(mode) || mode || fallback;
}

function normalizeClientRuntimeState(runtime = {}, descriptor = {}, readiness = {}, clientCommand = {}) {
  const provided = Boolean(
    runtime.clientState && typeof runtime.clientState === 'object'
      || runtime.clientRequest && typeof runtime.clientRequest === 'object'
      || runtime.requestState && typeof runtime.requestState === 'object'
      || runtime.clientCommand
      || runtime.clientSessionId
      || runtime.clientHydrated != null
      || runtime.clientStateStale != null
      || runtime.clientStateDirty != null,
  );
  const source = runtime.clientState && typeof runtime.clientState === 'object'
    ? runtime.clientState
    : runtime.clientRequest && typeof runtime.clientRequest === 'object'
      ? runtime.clientRequest
      : runtime.requestState && typeof runtime.requestState === 'object'
        ? runtime.requestState
        : {};
  const ui = runtime.ui && typeof runtime.ui === 'object' ? runtime.ui : {};
  const route = source.route && typeof source.route === 'object'
    ? source.route
    : ui.route && typeof ui.route === 'object'
      ? ui.route
      : {};
  const form = source.form && typeof source.form === 'object'
    ? source.form
    : source.inputs && typeof source.inputs === 'object'
      ? source.inputs
      : {};
  const command = normalizeClientRequestMode(
    source.command
      || source.requestedCommand
      || source.intent
      || runtime.clientCommand
      || runtime.statusCommand
      || clientCommand.command
      || clientCommand.submitAction
      || readiness.nextStep
      || descriptor.lifecycle?.requestedCommand,
  );
  const requestId = compactString(
    source.requestId
      || runtime.requestId
      || descriptor.requestId
      || clientCommand.requestId,
  );
  const sessionId = compactString(source.sessionId || source.clientSessionId || runtime.clientSessionId);
  const actorId = compactString(source.actorId || runtime.actorId || runtime.userId || runtime.actor?.id);
  const tenant = compactString(source.tenant || runtime.tenant || runtime.tenantId || descriptor.tenant);
  const workspace = compactString(source.workspace || source.workspaceId || runtime.workspace || runtime.workspaceId);
  const submittedAt = compactString(source.submittedAt || source.time || source.timestamp || runtime.submittedAt);
  const observedAt = compactString(source.observedAt || runtime.observedAt || runtime.now || runtime.currentTime);
  const resumeToken = compactString(
    source.resumeToken
      || source.idempotencyKey
      || runtime.resumeToken
      || runtime.idempotencyKey
      || clientCommand.resumeToken
      || clientCommand.idempotencyKey,
  );
  const acceptanceToken = compactString(source.acceptanceToken || runtime.acceptanceToken || clientCommand.acceptanceToken);
  const optimistic = normalizeBooleanControl(source.optimistic, runtime.optimisticClientUpdate) === true;
  const hydrated = normalizeBooleanControl(source.hydrated, source.hydratedFromServer, runtime.clientHydrated) === true;
  const stale = normalizeBooleanControl(source.stale, source.staleClientState, runtime.clientStateStale) === true;
  const dirty = normalizeBooleanControl(source.dirty, source.hasLocalChanges, runtime.clientStateDirty) === true;
  const offline = normalizeBooleanControl(source.offline, source.networkOffline, runtime.offline) === true;
  const readOnly = normalizeBooleanControl(source.readOnly, source.readonly, runtime.readOnly) === true;
  const replayRequested = normalizeBooleanControl(source.replayRequested, runtime.replayRequested) === true
    || ['resume_status_handoff', 'retry_status_handoff', 'recover_status_handoff'].includes(command);
  const clientRevision = normalizeCounter(source.revision || source.version || runtime.clientRevision);
  const serverRevision = normalizeCounter(source.serverRevision || runtime.serverRevision || clientCommand.revision);
  const revisionMismatch = clientRevision > 0 && serverRevision > 0 && clientRevision !== serverRevision;

  return {
    protocol: 'aios.client-runtime-state.mailchimp.v1',
    provided,
    requestId,
    sessionId,
    actorId,
    tenant,
    workspace,
    command,
    channel: compactString(source.channel || runtime.clientChannel || ui.channel || 'web'),
    route: {
      name: compactString(route.name || route.routeName || runtime.routeName || 'status_handoff'),
      path: compactString(route.path || route.url || runtime.routePath),
      referrer: compactString(route.referrer || runtime.referrer),
      surface: compactString(route.surface || source.surface || runtime.surface || 'status_handoff'),
    },
    form: {
      dirty,
      readOnly,
      optimistic,
      hydrated,
      stale,
      offline,
      submittedAt,
      observedAt,
      fieldCount: normalizeCounter(form.fieldCount || Object.keys(form).length),
      changedFields: stableList(form.changedFields || source.changedFields),
      validationErrors: stableList(form.validationErrors || source.validationErrors),
    },
    continuity: {
      resumeToken,
      acceptanceToken,
      replayRequested,
      clientRevision,
      serverRevision,
      revisionMismatch,
      idempotencyKey: resumeToken,
      requestKey: [tenant || 'unknown-tenant', workspace || 'all-workspaces', requestId || 'local-client'].join(':'),
    },
  };
}

function listAllowsValue(list = [], value = '') {
  const normalizedValue = compactString(value);
  if (!normalizedValue) return false;
  const normalizedList = normalizeScopedList(list);
  return normalizedList.includes('*') || normalizedList.includes(normalizedValue);
}

function normalizeBoundaryRuleEntries(...sources) {
  const entries = [];
  const pushEntry = (entry, inherited = {}) => {
    if (!entry) return;
    if (Array.isArray(entry)) {
      for (const item of entry) pushEntry(item, inherited);
      return;
    }
    if (typeof entry === 'string') {
      entries.push({ ...inherited, permissions: [entry] });
      return;
    }
    if (typeof entry !== 'object') return;
    entries.push({ ...inherited, ...entry });
  };
  const visitSource = (source, inherited = {}) => {
    if (!source) return;
    if (Array.isArray(source) || typeof source === 'string') {
      pushEntry(source, inherited);
      return;
    }
    if (typeof source !== 'object') return;
    if (
      source.permissions
      || source.deniedPermissions
      || source.roles
      || source.role
      || source.tenants
      || source.tenant
      || source.workspaces
      || source.workspace
      || source.deniedRoles
      || source.commands
      || source.command
      || source.effect
    ) {
      pushEntry(source, inherited);
      return;
    }
    for (const [key, value] of Object.entries(source)) {
      visitSource(value, { ...inherited, role: key });
    }
  };

  for (const source of sources) visitSource(source);
  return entries.map((entry, index) => {
    const effect = compactString(entry.effect || entry.decision || (entry.deny === true ? 'deny' : 'allow'))
      .toLowerCase()
      .replaceAll('-', '_');
    return {
      index,
      key: compactString(entry.key || entry.id || `boundary-rule-${index + 1}`),
      effect: effect === 'deny' || effect === 'block' ? 'deny' : 'allow',
      roles: normalizeScopedList(entry.roles, entry.role),
      tenants: normalizeScopedList(entry.tenants, entry.tenant),
      workspaces: normalizeScopedList(entry.workspaces, entry.workspace, entry.workspaceId),
      commands: normalizeScopedList(entry.commands, entry.command, entry.actions, entry.action),
      permissions: normalizeScopedList(entry.permissions, entry.scopes, entry.allow, entry.allowedPermissions),
      deniedPermissions: normalizeScopedList(entry.deniedPermissions, entry.denyPermissions, entry.blockedPermissions),
      deniedRoles: normalizeScopedList(entry.deniedRoles, entry.blockedRoles),
      reason: compactString(entry.reason || entry.message || entry.description),
      source: compactString(entry.source || 'boundary_contract'),
    };
  }).filter((entry) => (
    entry.permissions.length > 0
    || entry.deniedPermissions.length > 0
    || entry.deniedRoles.length > 0
    || entry.roles.length > 0
    || entry.tenants.length > 0
    || entry.workspaces.length > 0
  ));
}

function boundaryRuleMatches(rule = {}, { tenant = '', workspace = '', role = '', command = '' } = {}) {
  const commandAliases = stableList([
    command,
    command === 'run' ? 'dispatch' : '',
    command === 'execute' ? 'dispatch' : '',
  ]);
  const roleMatches = rule.roles.length === 0 || listAllowsValue(rule.roles, role);
  const tenantMatches = rule.tenants.length === 0 || listAllowsValue(rule.tenants, tenant);
  const workspaceMatches = rule.workspaces.length === 0
    || listAllowsValue(rule.workspaces, workspace)
    || (!workspace && listAllowsValue(rule.workspaces, 'all-workspaces'));
  const commandMatches = rule.commands.length === 0
    || commandAliases.some((alias) => listAllowsValue(rule.commands, alias));

  return roleMatches && tenantMatches && workspaceMatches && commandMatches;
}

function normalizeWorkspaceRoleBindings(...sources) {
  return normalizeBoundaryRuleEntries(...sources)
    .map((entry) => ({
      ...entry,
      allowedRoles: stableList(entry.roles),
      deniedRoles: stableList(entry.deniedRoles),
    }))
    .filter((entry) => entry.allowedRoles.length > 0 || entry.deniedRoles.length > 0);
}

function buildBoundaryPermissionPolicy({
  grants = [],
  workspaceBindings = [],
  tenant = '',
  workspace = '',
  role = '',
  command = '',
  basePermissions = [],
  requiredPermissions = [],
  enforceRoleGrants = false,
  enforceWorkspaceRoles = false,
} = {}) {
  const context = { tenant, workspace, role, command };
  const matchingGrants = grants.filter((grant) => boundaryRuleMatches(grant, context));
  const matchingBindings = workspaceBindings.filter((binding) => (
    boundaryRuleMatches(
      {
        ...binding,
        roles: [],
        permissions: [],
        deniedPermissions: [],
      },
      context,
    )
  ));
  const allowedByGrant = stableList(
    matchingGrants
      .filter((grant) => grant.effect === 'allow')
      .flatMap((grant) => grant.permissions),
  );
  const deniedByGrant = stableList(
    matchingGrants.flatMap((grant) => [
      ...(grant.effect === 'deny' ? grant.permissions : []),
      ...grant.deniedPermissions,
    ]),
  );
  const deniedByBinding = matchingBindings.some((binding) => listAllowsValue(binding.deniedRoles, role));
  const allowedByBinding = matchingBindings.length === 0
    ? !enforceWorkspaceRoles
    : matchingBindings.some((binding) => listAllowsValue(binding.allowedRoles, role))
      && !deniedByBinding;
  const effectivePermissions = stableList([...basePermissions, ...allowedByGrant])
    .filter((permission) => !listAllowsValue(deniedByGrant, permission));
  const missingGrantPermissions = enforceRoleGrants
    ? requiredPermissions.filter((permission) => !listAllowsValue(allowedByGrant, permission))
    : [];
  const deniedRequiredPermissions = requiredPermissions.filter((permission) => listAllowsValue(deniedByGrant, permission));
  const blockedReasons = stableList([
    ...(enforceRoleGrants && matchingGrants.length === 0 ? ['role_permission_grant_missing'] : []),
    ...missingGrantPermissions.map((permission) => `role_grant_missing_permission:${permission}`),
    ...deniedRequiredPermissions.map((permission) => `permission_explicitly_denied:${permission}`),
    ...(enforceWorkspaceRoles && matchingBindings.length === 0 ? ['workspace_role_binding_missing'] : []),
    ...(!allowedByBinding ? ['workspace_role_not_allowed'] : []),
    ...(deniedByBinding ? ['workspace_role_explicitly_denied'] : []),
  ]);

  return {
    protocol: 'aios.status-boundary-permission-policy.mailchimp.v1',
    ready: blockedReasons.length === 0,
    effectivePermissions,
    allowedByGrant,
    deniedByGrant,
    matchingGrantKeys: matchingGrants.map((grant) => grant.key).sort(),
    matchingWorkspaceBindingKeys: matchingBindings.map((binding) => binding.key).sort(),
    workspaceRoleAllowed: allowedByBinding,
    enforceRoleGrants,
    enforceWorkspaceRoles,
    blockedReasons,
  };
}

function buildBoundaryAuditKey({ tenant, workspace, role, requestId, externalRequestId }) {
  return [
    tenant || 'unknown-tenant',
    workspace || 'all-workspaces',
    role || 'unknown-role',
    requestId || externalRequestId || 'local-status',
  ].join(':');
}

export function buildMailchimpTenantBoundaryHandoff(
  descriptor = {},
  runtime = {},
  permissionHealth = null,
  providerContract = {},
  externalHandoffState = {},
) {
  const boundaryContract = descriptor.boundaryContract && typeof descriptor.boundaryContract === 'object'
    ? descriptor.boundaryContract
    : {};
  const runtimeBoundary = runtime.boundaryContract && typeof runtime.boundaryContract === 'object'
    ? runtime.boundaryContract
    : runtime.boundary && typeof runtime.boundary === 'object'
      ? runtime.boundary
      : {};
  const scope = runtime.scope && typeof runtime.scope === 'object' ? runtime.scope : {};
  const runtimeActor = runtime.actor && typeof runtime.actor === 'object' ? runtime.actor : {};
  const receipt = providerContract.receipt || {};
  const descriptorTenant = compactString(descriptor.tenant || boundaryContract.tenant || descriptor.truthBoundary?.tenant);
  const runtimeTenant = compactString(runtime.tenant || runtime.tenantId || scope.tenant || runtimeBoundary.tenant);
  const effectiveTenant = runtimeTenant || descriptorTenant || compactString(receipt.tenant);
  const descriptorWorkspace = compactString(
    descriptor.workspace
      || descriptor.workspaceId
      || boundaryContract.workspace
      || boundaryContract.workspaceId
      || descriptor.truthBoundary?.workspace,
  );
  const runtimeWorkspace = compactString(
    runtime.workspace
      || runtime.workspaceId
      || scope.workspace
      || scope.workspaceId
      || runtimeBoundary.workspace
      || runtimeBoundary.workspaceId,
  );
  const effectiveWorkspace = runtimeWorkspace || descriptorWorkspace || compactString(receipt.workspace);
  const role = compactString(
    runtime.role
      || runtimeActor.role
      || runtimeBoundary.role
      || boundaryContract.role
      || 'status_observer',
  );
  const actorId = compactString(runtime.actorId || runtime.userId || runtimeActor.id || runtimeActor.userId);
  const requestId = compactString(descriptor.requestId || runtime.requestId);
  const externalRequestId = compactString(
    externalHandoffState.requestId
      || providerContract.externalRequestId
      || runtime.externalRequestId,
  );
  const writesExternalSystem = descriptor.truthBoundary?.externalWritesAllowed === true
    || externalHandoffState.writesExternalSystem === true;
  const requestedCommand = compactString(
    runtime.statusCommand
      || runtime.requestedCommand
      || descriptor.lifecycle?.requestedCommand
      || 'queue',
  ).toLowerCase().replaceAll('-', '_');
  const dispatchLikeCommand = ['dispatch', 'resume', 'retry', 'run', 'execute', 'handoff_external_status']
    .includes(requestedCommand);
  const allowedTenants = normalizeScopedList(
    runtime.allowedTenants,
    runtimeBoundary.allowedTenants,
    boundaryContract.allowedTenants,
    boundaryContract.tenants,
  );
  const allowedWorkspaces = normalizeScopedList(
    runtime.allowedWorkspaces,
    runtimeBoundary.allowedWorkspaces,
    boundaryContract.allowedWorkspaces,
    boundaryContract.workspaces,
  );
  const deniedWorkspaces = normalizeScopedList(
    runtime.deniedWorkspaces,
    runtimeBoundary.deniedWorkspaces,
    boundaryContract.deniedWorkspaces,
  );
  const permissions = normalizeScopedList(
    runtime.permissions,
    runtime.scopes,
    runtimeActor.permissions,
    runtimeActor.scopes,
    runtimeBoundary.permissions,
    boundaryContract.permissions,
  );
  const rolePermissions = normalizeScopedList(
    runtime.rolePermissions?.[role],
    boundaryContract.rolePermissions?.[role],
  );
  const requiredPermissions = stableList([
    'mailchimp.status.read',
    ...(dispatchLikeCommand ? ['mailchimp.status.handoff'] : []),
    ...(writesExternalSystem ? ['mailchimp.external.write'] : []),
  ]);
  const grantRules = normalizeBoundaryRuleEntries(
    runtime.permissionGrants,
    runtimeActor.permissionGrants,
    runtimeActor.grants,
    runtimeBoundary.permissionGrants,
    runtimeBoundary.grants,
    boundaryContract.permissionGrants,
    boundaryContract.grants,
  );
  const workspaceRoleBindings = normalizeWorkspaceRoleBindings(
    runtime.workspaceRoleBindings,
    runtimeBoundary.workspaceRoleBindings,
    runtimeBoundary.roleBindings,
    boundaryContract.workspaceRoleBindings,
    boundaryContract.roleBindings,
  );
  const enforceRoleGrants = normalizeBooleanControl(
    runtime.enforceRoleGrants,
    runtimeBoundary.enforceRoleGrants,
    boundaryContract.enforceRoleGrants,
    runtimeBoundary.requireRoleGrant,
    boundaryContract.requireRoleGrant,
  ) === true;
  const enforceWorkspaceRoles = normalizeBooleanControl(
    runtime.enforceWorkspaceRoles,
    runtimeBoundary.enforceWorkspaceRoles,
    boundaryContract.enforceWorkspaceRoles,
    runtimeBoundary.requireWorkspaceRoleBinding,
    boundaryContract.requireWorkspaceRoleBinding,
  ) === true;
  const permissionPolicy = buildBoundaryPermissionPolicy({
    grants: grantRules,
    workspaceBindings: workspaceRoleBindings,
    tenant: effectiveTenant,
    workspace: effectiveWorkspace,
    role,
    command: requestedCommand,
    basePermissions: normalizeScopedList(permissions, rolePermissions),
    requiredPermissions,
    enforceRoleGrants,
    enforceWorkspaceRoles,
  });
  const effectivePermissions = permissionPolicy.effectivePermissions;
  const hasPermission = (permission) => listAllowsValue(effectivePermissions, permission);
  const permissionPolicyConfigured = effectivePermissions.length > 0
    || grantRules.length > 0
    || workspaceRoleBindings.length > 0
    || enforceRoleGrants
    || enforceWorkspaceRoles
    || runtimeBoundary.requirePermissions === true
    || boundaryContract.requirePermissions === true
    || runtimeBoundary.enforcePermissions === true
    || boundaryContract.enforcePermissions === true;
  const permissionRequired = (permission) => permission === 'mailchimp.external.write'
    || (permission === 'mailchimp.status.handoff' && (permissionPolicyConfigured || writesExternalSystem))
    || (permission === 'mailchimp.status.read' && permissionPolicyConfigured);
  const tenantRequired = runtimeBoundary.tenantRequired === true
    || boundaryContract.tenantRequired === true
    || writesExternalSystem;
  const workspaceRequired = runtimeBoundary.workspaceRequired === true
    || boundaryContract.workspaceRequired === true
    || writesExternalSystem;
  const tenantAllowed = allowedTenants.length === 0 || listAllowsValue(allowedTenants, effectiveTenant);
  const workspaceAllowed = allowedWorkspaces.length === 0 || listAllowsValue(allowedWorkspaces, effectiveWorkspace);
  const workspaceDenied = deniedWorkspaces.length > 0 && listAllowsValue(deniedWorkspaces, effectiveWorkspace);
  const tenantMismatch = Boolean(descriptorTenant && runtimeTenant && descriptorTenant !== runtimeTenant);
  const workspaceMismatch = Boolean(descriptorWorkspace && runtimeWorkspace && descriptorWorkspace !== runtimeWorkspace);
  const receiptTenantMismatch = Boolean(receipt.tenant && effectiveTenant && receipt.tenant !== effectiveTenant);
  const receiptWorkspaceMismatch = Boolean(receipt.workspace && effectiveWorkspace && receipt.workspace !== effectiveWorkspace);
  const missingPermissions = requiredPermissions.filter((permission) => (
    permissionRequired(permission) && !hasPermission(permission)
  ));
  const adapterBlockedReasons = permissionHealth?.allowed === false
    ? stableList([
      permissionHealth.state,
      ...(permissionHealth.actionableErrors || []).map((item) => item.reason || item.code),
    ])
    : [];
  const blockedReasons = stableList([
    ...(tenantRequired && !effectiveTenant ? ['tenant_scope_missing'] : []),
    ...(workspaceRequired && !effectiveWorkspace ? ['workspace_scope_missing'] : []),
    ...(tenantMismatch ? ['runtime_tenant_mismatch'] : []),
    ...(workspaceMismatch ? ['runtime_workspace_mismatch'] : []),
    ...(receiptTenantMismatch ? ['provider_receipt_tenant_mismatch'] : []),
    ...(receiptWorkspaceMismatch ? ['provider_receipt_workspace_mismatch'] : []),
    ...(!tenantAllowed ? ['tenant_not_allowed'] : []),
    ...(!workspaceAllowed ? ['workspace_not_allowed'] : []),
    ...(workspaceDenied ? ['workspace_explicitly_denied'] : []),
    ...permissionPolicy.blockedReasons,
    ...missingPermissions.map((permission) => `missing_permission:${permission}`),
    ...adapterBlockedReasons.map((reason) => `adapter_permission:${reason}`),
  ]);
  const ready = blockedReasons.length === 0;
  const nextAction = ready
    ? writesExternalSystem ? 'handoff_external_status' : 'export_status_report'
    : blockedReasons.some((reason) => reason.includes('mismatch'))
      ? 'repair_tenant_workspace_scope'
        : missingPermissions.length > 0
          || permissionPolicy.blockedReasons.some((reason) => reason.includes('permission') || reason.includes('grant'))
        ? 'request_boundary_permission'
        : blockedReasons.includes('tenant_scope_missing') || blockedReasons.includes('workspace_scope_missing')
          ? 'provide_boundary_scope'
          : permissionPolicy.blockedReasons.some((reason) => reason.includes('workspace_role'))
            ? 'repair_workspace_role_binding'
          : 'inspect_permission_boundary';

  return {
    protocol: 'aios.status-tenant-boundary-handoff.mailchimp.v1',
    ready,
    state: ready ? 'ready' : 'blocked',
    nextAction,
    blockedReasons,
    tenant: {
      descriptor: descriptorTenant,
      runtime: runtimeTenant,
      effective: effectiveTenant,
      required: tenantRequired,
      allowed: tenantAllowed,
      allowedTenants,
      mismatch: tenantMismatch || receiptTenantMismatch,
    },
    workspace: {
      descriptor: descriptorWorkspace,
      runtime: runtimeWorkspace,
      effective: effectiveWorkspace,
      required: workspaceRequired,
      allowed: workspaceAllowed && !workspaceDenied,
      allowedWorkspaces,
      deniedWorkspaces,
      mismatch: workspaceMismatch || receiptWorkspaceMismatch,
    },
    role: {
      name: role,
      actorId,
      permissions: effectivePermissions,
      requiredPermissions,
      missingPermissions,
      permissionPolicyConfigured,
      externalWriteAllowed: !writesExternalSystem || missingPermissions.includes('mailchimp.external.write') === false,
      grantPolicy: {
        ready: permissionPolicy.ready,
        enforceRoleGrants,
        enforceWorkspaceRoles,
        allowedByGrant: permissionPolicy.allowedByGrant,
        deniedByGrant: permissionPolicy.deniedByGrant,
        matchingGrantKeys: permissionPolicy.matchingGrantKeys,
        matchingWorkspaceBindingKeys: permissionPolicy.matchingWorkspaceBindingKeys,
        workspaceRoleAllowed: permissionPolicy.workspaceRoleAllowed,
        blockedReasons: permissionPolicy.blockedReasons,
      },
    },
    permissionPolicy,
    audit: {
      channel: 'status-tenant-boundary',
      decision: ready ? 'allow' : 'block',
      handoffKey: buildBoundaryAuditKey({
        tenant: effectiveTenant,
        workspace: effectiveWorkspace,
        role,
        requestId,
        externalRequestId,
      }),
      requestId,
      externalRequestId,
      externalWriteSuppressed: writesExternalSystem && !ready,
      evidence: stableList([
        ...(effectiveTenant ? [`tenant:${effectiveTenant}`] : []),
        ...(effectiveWorkspace ? [`workspace:${effectiveWorkspace}`] : []),
        ...(role ? [`role:${role}`] : []),
        ...requiredPermissions.map((permission) => `requires:${permission}`),
        ...permissionPolicy.matchingGrantKeys.map((key) => `grant:${key}`),
        ...permissionPolicy.matchingWorkspaceBindingKeys.map((key) => `workspaceRole:${key}`),
      ]),
    },
    exportSummary: {
      exportReady: ready,
      format: 'json',
      blockedReasons,
      counters: {
        requiredPermissions: requiredPermissions.length,
        missingPermissions: missingPermissions.length,
        allowedTenants: allowedTenants.length,
        allowedWorkspaces: allowedWorkspaces.length,
        deniedWorkspaces: deniedWorkspaces.length,
        matchingRoleGrants: permissionPolicy.matchingGrantKeys.length,
        matchingWorkspaceRoleBindings: permissionPolicy.matchingWorkspaceBindingKeys.length,
        deniedGrantPermissions: permissionPolicy.deniedByGrant.length,
        externalWriteSuppressed: writesExternalSystem && !ready ? 1 : 0,
      },
    },
  };
}

function countRuntimeStates(events = []) {
  const counters = {
    total: 0,
    terminal: 0,
    active: 0,
    unknown: 0,
    succeeded: 0,
    failed: 0,
    rolledBack: 0,
    cancelled: 0,
    queued: 0,
    running: 0,
    waitingForVerifier: 0,
    recovering: 0,
  };

  for (const event of Array.isArray(events) ? events : []) {
    const state = normalizeState(event?.state);
    counters.total += 1;
    if (TERMINAL_STATES.has(state)) counters.terminal += 1;
    if (ACTIVE_STATES.has(state)) counters.active += 1;
    if (state === 'unknown') counters.unknown += 1;
    if (state === 'succeeded') counters.succeeded += 1;
    if (state === 'failed') counters.failed += 1;
    if (state === 'rolled_back') counters.rolledBack += 1;
    if (state === 'cancelled') counters.cancelled += 1;
    if (state === 'queued') counters.queued += 1;
    if (state === 'running') counters.running += 1;
    if (state === 'waiting_for_verifier') counters.waitingForVerifier += 1;
    if (state === 'recovering') counters.recovering += 1;
  }

  return counters;
}

function selectTimelineValue(...values) {
  for (const value of values) {
    const compacted = compactString(value);
    if (compacted) return compacted;
  }
  return null;
}

function buildRuntimeTimeline(events = [], history = {}, compileCache = {}) {
  const normalizedEvents = Array.isArray(events) ? events : [];
  const first = normalizedEvents[0] || null;
  const latest = latestMeaningfulEvent(normalizedEvents);
  const historyTimeline = history?.timeline && typeof history.timeline === 'object'
    ? history.timeline
    : {};
  const compileTimeline = compileCache?.report?.timeline && typeof compileCache.report.timeline === 'object'
    ? compileCache.report.timeline
    : {};

  return {
    firstAt: selectTimelineValue(first?.at, historyTimeline.firstAt),
    latestAt: selectTimelineValue(latest?.at, historyTimeline.latestAt, compileTimeline.latestAt),
    latestState: compactString(latest?.state || historyTimeline.latestState || history?.latestState || 'unknown'),
    latestCode: compactString(latest?.code || compileTimeline.latestKind),
    latestMessage: compactString(latest?.message),
    runtimeEvents: normalizedEvents.length,
    historyEvents: normalizeCounter(historyTimeline.totalEvents),
    compileCacheEvents: normalizeCounter(compileTimeline.totalEvents),
    source: latest?.at
      ? 'runtime_events'
      : historyTimeline.latestAt
        ? 'adapter_history'
        : compileTimeline.latestAt
          ? 'compile_cache'
          : 'empty',
  };
}

function normalizeExportSectionState(name, source = {}) {
  const exportSummary = source?.exportSummary && typeof source.exportSummary === 'object'
    ? source.exportSummary
    : {};
  const blockedReasons = stableList([
    ...stableList(source?.blockedReasons),
    ...stableList(exportSummary.blockedReasons),
    ...stableList(source?.validationSummary?.blockedReasons),
  ]);
  const exportReady = source?.exportReady === true
    || exportSummary.exportReady === true
    || source?.ready === true
    || (blockedReasons.length === 0 && source?.ready !== false && exportSummary.exportReady !== false);

  return {
    name,
    exportReady,
    state: compactString(source?.state || source?.routeState || (exportReady ? 'ready' : 'blocked')),
    nextAction: compactString(source?.nextAction || exportSummary.nextAction || 'observe'),
    blockedReasons,
    counters: {
      blockedReasons: blockedReasons.length,
      ready: exportReady ? 1 : 0,
    },
  };
}

function buildStatusHistoryMilestones(status = {}, runtimeTimeline = {}) {
  const events = Array.isArray(status.events) ? status.events : [];
  const history = status.history || {};
  const providerServiceContract = status.providerServiceContract || {};
  const externalHandoff = status.externalHandoff || {};
  const persistedRecovery = status.persistedRecovery || status.ui?.persistedRecovery || {};
  const compileCache = status.compileCache || {};
  const lifecycleCommandState = status.lifecycleCommandState || status.readiness?.lifecycleCommandState || {};
  const lifecycleSettingsPatch = status.lifecycleSettingsPatch || status.readiness?.lifecycleSettingsPatch || {};
  const operationalHealth = status.operationalHealth || {};
  const candidates = [
    {
      key: 'runtime_first_event',
      at: events[0]?.at,
      state: events[0]?.state,
      code: events[0]?.code,
      source: 'runtime_events',
    },
    {
      key: 'runtime_latest_event',
      at: runtimeTimeline.latestAt,
      state: runtimeTimeline.latestState,
      code: runtimeTimeline.latestCode,
      source: runtimeTimeline.source || 'runtime_events',
    },
    {
      key: 'adapter_history_latest',
      at: history.timeline?.latestAt,
      state: history.timeline?.latestState || history.summary?.latestState,
      code: history.timeline?.latestKind || 'adapter_history',
      source: 'adapter_history',
    },
    {
      key: 'provider_sync_latest',
      at: providerServiceContract.sync?.lastSyncedAt || externalHandoff.syncMetadata?.lastSyncedAt,
      state: providerServiceContract.sync?.ready === false || externalHandoff.syncMetadata?.ready === false ? 'recovering' : 'running',
      code: providerServiceContract.sync?.replayPolicy || externalHandoff.syncMetadata?.replayPolicy || 'provider_sync',
      source: 'provider_sync',
    },
    {
      key: 'persisted_snapshot_latest',
      at: persistedRecovery.persistedSnapshot?.cursor?.latestAt || persistedRecovery.cursor?.latestPersistedAt,
      state: persistedRecovery.persistedSnapshot?.state || persistedRecovery.continuity?.state,
      code: persistedRecovery.persistedSnapshot?.write?.mode || persistedRecovery.replayMode || 'persisted_status',
      source: 'persisted_status',
    },
    {
      key: 'compile_cache_latest',
      at: compileCache.report?.timeline?.latestAt,
      state: compileCache.report?.timeline?.latestStatus || compileCache.status,
      code: compileCache.report?.timeline?.latestKind || 'compile_cache',
      source: 'compile_cache',
    },
    {
      key: 'lifecycle_command',
      at: lifecycleCommandState.effects?.desiredSchedule?.nextRunAt
        || lifecycleCommandState.effects?.desiredSchedule?.startAt,
      state: lifecycleCommandState.state,
      code: lifecycleCommandState.command,
      source: 'lifecycle_command',
    },
    {
      key: 'lifecycle_settings_patch',
      at: lifecycleSettingsPatch.desired?.schedule?.nextRunAt
        || lifecycleSettingsPatch.desired?.schedule?.startAt,
      state: lifecycleSettingsPatch.state,
      code: lifecycleSettingsPatch.command,
      source: 'lifecycle_settings_patch',
    },
    {
      key: 'operational_health_incident',
      at: operationalHealth.incident?.latestFailureAt || operationalHealth.incident?.observedAt,
      state: operationalHealth.state,
      code: operationalHealth.failureState || operationalHealth.incident?.failureState,
      source: 'operational_health',
    },
  ];
  const seen = new Set();

  return candidates
    .map((candidate) => ({
      key: compactString(candidate.key),
      at: compactString(candidate.at),
      state: normalizeState(candidate.state),
      code: compactString(candidate.code),
      source: compactString(candidate.source),
    }))
    .filter((candidate) => candidate.at || candidate.code || candidate.state !== 'unknown')
    .filter((candidate) => {
      const key = `${candidate.key}:${candidate.at}:${candidate.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildMailchimpStatusAnalyticsExportContract(status = {}) {
  const events = Array.isArray(status.events) ? status.events : [];
  const diagnosticSummary = summarizeDiagnostics(status.diagnostics);
  const stateCounters = countRuntimeStates(events);
  const compileCache = status.compileCache || {};
  const history = status.history || {};
  const tenantBoundaryContinuity = status.tenantBoundaryContinuity
    || status.readiness?.tenantBoundaryContinuity
    || status.ui?.tenantBoundaryContinuity
    || {};
  const runtimeTimeline = buildRuntimeTimeline(events, history, compileCache);
  const milestones = buildStatusHistoryMilestones(status, runtimeTimeline);
  const sections = [
    normalizeExportSectionState('runtime', {
      ready: status.state !== 'failed',
      state: status.state,
      blockedReasons: diagnosticSummary.errors > 0 ? ['diagnostic_errors'] : [],
      nextAction: status.readiness?.nextStep,
    }),
    normalizeExportSectionState('adapter_history', history.exportState || {}),
    normalizeExportSectionState('provider_service', status.providerServiceContract || {}),
    normalizeExportSectionState('external_handoff', status.externalHandoff || {}),
    normalizeExportSectionState('persisted_recovery', status.persistedRecovery || status.ui?.persistedRecovery || {}),
    normalizeExportSectionState('compile_cache', compileCache.exportPackage || compileCache),
    normalizeExportSectionState('client_workflow', status.clientWorkflowHandoff || status.ui?.clientWorkflowHandoff || {}),
    normalizeExportSectionState('client_runtime_adoption', status.clientRuntimeAdoption || status.ui?.clientRuntimeAdoption || {}),
    normalizeExportSectionState('lifecycle_settings_patch', status.lifecycleSettingsPatch || status.readiness?.lifecycleSettingsPatch || {}),
    normalizeExportSectionState('tenant_boundary_continuity', tenantBoundaryContinuity),
    normalizeExportSectionState('operational_health', status.operationalHealth || {}),
  ];
  const blockedReasons = stableList([
    ...(diagnosticSummary.errors > 0 ? ['diagnostic_errors'] : []),
    ...sections.flatMap((section) => section.blockedReasons.map((reason) => `${section.name}:${reason}`)),
    ...sections.filter((section) => section.exportReady !== true).map((section) => `${section.name}:export_not_ready`),
  ]);
  const exportReady = blockedReasons.length === 0;
  const packageId = compactString(
    status.exportSummary?.packageId
      || compileCache.exportPackage?.packageId
      || `${status.requestId || 'mailchimp'}:analytics-status-export`,
  );

  return {
    protocol: 'aios.status-analytics-export.mailchimp.v1',
    requestId: compactString(status.requestId),
    adapter: compactString(status.adapter || 'mailchimp'),
    packageId,
    exportReady,
    nextAction: exportReady
      ? 'export_status_analytics'
      : sections.find((section) => section.exportReady !== true)?.nextAction || 'inspect_status_analytics',
    blockedReasons,
    counters: {
      runtimeEvents: events.length,
      runtimeTerminalEvents: stateCounters.terminal,
      runtimeActiveEvents: stateCounters.active,
      runtimeUnknownEvents: stateCounters.unknown,
      runtimeFailedEvents: stateCounters.failed,
      runtimeRecoveringEvents: stateCounters.recovering,
      historyEvents: normalizeCounter(history.timeline?.totalEvents),
      historySnapshots: normalizeCounter(history.summary?.snapshots || history.summary?.totalSnapshots),
      milestones: milestones.length,
      exportSections: sections.length,
      exportSectionsReady: sections.filter((section) => section.exportReady).length,
      diagnostics: diagnosticSummary.total,
      diagnosticErrors: diagnosticSummary.errors,
      diagnosticWarnings: diagnosticSummary.warnings,
      blockedReasons: blockedReasons.length,
      compileCacheEntries: normalizeCounter(compileCache.report?.counters?.entries),
      persistedSnapshotTail: normalizeCounter(status.persistedRecovery?.persistedSnapshot?.eventTail?.length),
      tenantBoundaryContinuityReady: tenantBoundaryContinuity.ready === true ? 1 : 0,
      tenantBoundaryContinuityBlockedReasons: stableList(tenantBoundaryContinuity.blockedReasons).length,
      tenantBoundaryContinuityAuditRequired: tenantBoundaryContinuity.audit?.required === true ? 1 : 0,
      tenantBoundaryContinuityAuditReady: tenantBoundaryContinuity.audit?.ready === true ? 1 : 0,
      tenantBoundaryContinuityRuntimeDrift: normalizeCounter(tenantBoundaryContinuity.counters?.runtimeDrift),
    },
    ratios: {
      exportSectionReadyRate: sections.length === 0
        ? null
        : Number((sections.filter((section) => section.exportReady).length / sections.length).toFixed(4)),
      runtimeTerminalRate: events.length === 0 ? null : Number((stateCounters.terminal / events.length).toFixed(4)),
      runtimeFailureRate: events.length === 0 ? null : Number((stateCounters.failed / events.length).toFixed(4)),
    },
    timeline: {
      ...runtimeTimeline,
      firstMilestoneAt: milestones[0]?.at || runtimeTimeline.firstAt,
      latestMilestoneAt: milestones[milestones.length - 1]?.at || runtimeTimeline.latestAt,
      milestoneCount: milestones.length,
      sources: stableList(milestones.map((milestone) => milestone.source)),
      tenantBoundaryContinuityKey: compactString(tenantBoundaryContinuity.continuityKey),
      tenantBoundaryContinuityState: compactString(tenantBoundaryContinuity.state),
      tenantBoundaryContinuityNextAction: compactString(tenantBoundaryContinuity.nextAction),
    },
    historySnapshot: {
      protocol: 'aios.status-analytics-history-snapshot.mailchimp.v1',
      requestId: compactString(status.requestId),
      totalEvents: events.length,
      historyEvents: normalizeCounter(history.timeline?.totalEvents),
      milestones,
      eventTail: events.slice(-10).map((event) => ({
        index: normalizeCounter(event.index),
        at: compactString(event.at),
        state: normalizeState(event.state),
        code: compactString(event.code),
        message: compactString(event.message),
      })),
    },
    sections,
    exportSummary: {
      protocol: 'aios.status-analytics-export-summary.mailchimp.v1',
      packageId,
      format: 'json',
      exportReady,
      nextAction: exportReady ? 'export_status_analytics' : 'inspect_status_analytics',
      blockedReasons,
      includes: stableList([
        'analytics_counters',
        'history_snapshot',
        'timeline_milestones',
        'runtime_event_tail',
        'export_sections',
        'tenant_boundary_continuity',
      ]),
    },
  };
}

function selectPersistedStatusSource(descriptor = {}, runtime = {}) {
  const runtimePersistence = runtime.statusPersistence && typeof runtime.statusPersistence === 'object'
    ? runtime.statusPersistence
    : {};
  const runtimeRecovery = runtime.recovery && typeof runtime.recovery === 'object'
    ? runtime.recovery
    : {};
  const descriptorPersistence = descriptor.statusPersistence && typeof descriptor.statusPersistence === 'object'
    ? descriptor.statusPersistence
    : {};
  const candidates = [
    runtime.persistedStatus,
    runtime.persistedStatusSnapshot,
    runtimePersistence.snapshot,
    runtimePersistence.persistedStatus,
    runtimeRecovery.persistedStatus,
    runtimeRecovery.statusSnapshot,
    descriptor.persistedStatus,
    descriptorPersistence.snapshot,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === 'object') || null;
}

function normalizePersistenceCommand(value, fallback = 'observe') {
  const command = compactString(value || fallback).toLowerCase().replaceAll('-', '_');
  const aliases = new Map([
    ['continue', 'resume'],
    ['rerun', 'retry'],
    ['recover_status', 'recover'],
    ['sync_provider', 'refresh_provider_sync_before_replay'],
    ['refresh_sync', 'refresh_provider_sync_before_replay'],
    ['ack_receipt', 'refresh_provider_receipt'],
    ['acknowledge_receipt', 'refresh_provider_receipt'],
    ['renew_lease', 'refresh_provider_lease'],
  ]);
  return aliases.get(command) || command || fallback;
}

function normalizePersistenceSequence(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function selectPersistedEventTail(events = [], limit = 25) {
  const normalizedLimit = Math.max(1, normalizeCounter(limit || 25));
  return (Array.isArray(events) ? events : [])
    .slice(-normalizedLimit)
    .map((event, offset, tail) => ({
      index: normalizePersistenceSequence(event?.index ?? offset + Math.max(0, events.length - tail.length)),
      at: compactString(event?.at),
      state: normalizeState(event?.state),
      code: compactString(event?.code),
      message: compactString(event?.message),
      truth: compactString(event?.truth),
    }));
}

export function buildMailchimpPersistedStatusSnapshotContract(status = {}, runtime = {}, recovery = {}) {
  const descriptor = status.descriptor || {};
  const source = selectPersistedStatusSource(descriptor, runtime);
  const events = Array.isArray(status.events) ? status.events : [];
  const latest = latestMeaningfulEvent(events);
  const externalHandoff = status.externalHandoff || {};
  const compileCache = status.compileCache || {};
  const tenantBoundaryHandoff = status.tenantBoundaryHandoff || status.readiness?.tenantBoundaryHandoff || {};
  const clientCommand = status.clientCommand || status.ui?.clientCommand || {};
  const runtimeTenant = compactString(
    status.tenant
      || tenantBoundaryHandoff.tenant?.effective
      || runtime.tenant
      || runtime.tenantId,
  );
  const runtimeWorkspace = compactString(
    tenantBoundaryHandoff.workspace?.effective
      || runtime.workspace
      || runtime.workspaceId,
  );
  const persistedTenant = compactString(source?.tenant || source?.boundary?.tenant || source?.scope?.tenant);
  const persistedWorkspace = compactString(source?.workspace || source?.workspaceId || source?.boundary?.workspace || source?.scope?.workspace);
  const requestId = compactString(status.requestId || descriptor.requestId || runtime.requestId);
  const persistedRequestId = compactString(source?.requestId || source?.descriptor?.requestId);
  const externalRequestId = compactString(
    externalHandoff.requestId
      || status.providerContract?.externalRequestId
      || status.providerServiceContract?.externalHandoff?.requestId
      || runtime.externalRequestId,
  );
  const persistedExternalRequestId = compactString(source?.externalRequestId || source?.provider?.externalRequestId);
  const syncCursor = compactString(externalHandoff.syncMetadata?.cursor || status.providerContract?.sync?.cursor || runtime.syncCursor);
  const persistedSyncCursor = compactString(source?.syncCursor || source?.provider?.syncCursor || source?.provider?.cursor);
  const cacheKey = compactString(compileCache.cacheKey || runtime.compileCache?.cacheKey);
  const persistedCacheKey = compactString(source?.cacheKey || source?.compileCache?.cacheKey);
  const state = normalizeState(status.state || latest?.state || source?.state);
  const persistedState = normalizeState(source?.state || source?.status || source?.latestState);
  const eventCount = events.length;
  const persistedEventCount = normalizePersistenceSequence(source?.eventCount || source?.totalEvents);
  const latestEventIndex = latest ? normalizePersistenceSequence(latest.index) : Math.max(0, eventCount - 1);
  const persistedLatestIndex = normalizePersistenceSequence(
    source?.latestEventIndex
      ?? source?.eventCursor
      ?? source?.cursor
      ?? (persistedEventCount > 0 ? persistedEventCount - 1 : 0),
  );
  const runtimeSequence = normalizePersistenceSequence(runtime.sequence || runtime.revision || status.revision);
  const persistedSequence = normalizePersistenceSequence(source?.sequence || source?.revision || source?.version);
  const sequence = Math.max(runtimeSequence, persistedSequence + (eventCount > persistedEventCount ? 1 : 0), eventCount);
  const command = normalizePersistenceCommand(
    runtime.statusCommand
      || runtime.recoveryCommand
      || status.lifecycleCommandState?.command
      || clientCommand.command
      || clientCommand.submitAction
      || recovery.command?.requested
      || recovery.nextAction
      || 'observe',
  );
  const idempotencyKey = compactString(
    runtime.idempotencyKey
      || runtime.commandKey
      || runtime.resumeToken
      || clientCommand.idempotencyKey
      || clientCommand.resumeToken
      || compileCache.resumeGate?.resumeToken
      || compileCache.persistedReplaySummary?.idempotencyKey
      || source?.idempotencyKey,
  );
  const previousIdempotencyKey = compactString(source?.idempotencyKey || source?.commandKey || source?.resumeToken);
  const latestAt = compactString(latest?.at || status.history?.timeline?.latestAt || source?.latestAt || source?.updatedAt);
  const previousLatestAt = compactString(source?.latestAt || source?.updatedAt || source?.persistedAt);
  const stateChanged = Boolean(source) && persistedState !== 'unknown' && state !== persistedState;
  const cursorAdvanced = eventCount > persistedEventCount || latestEventIndex > persistedLatestIndex;
  const commandChanged = Boolean(source) && command !== normalizePersistenceCommand(source?.command || source?.requestedCommand || source?.lastCommand || command);
  const idempotencyChanged = Boolean(previousIdempotencyKey && idempotencyKey && previousIdempotencyKey !== idempotencyKey);
  const requestMatches = !persistedRequestId || !requestId || persistedRequestId === requestId;
  const externalRequestMatches = !persistedExternalRequestId || !externalRequestId || persistedExternalRequestId === externalRequestId;
  const syncCursorMatches = !persistedSyncCursor || !syncCursor || persistedSyncCursor === syncCursor;
  const cacheKeyMatches = !persistedCacheKey || !cacheKey || persistedCacheKey === cacheKey;
  const tenantMatches = !persistedTenant || !runtimeTenant || persistedTenant === runtimeTenant;
  const workspaceMatches = !persistedWorkspace || !runtimeWorkspace || persistedWorkspace === runtimeWorkspace;
  const mismatchReasons = stableList([
    ...(!requestMatches ? ['persisted_request_mismatch'] : []),
    ...(!externalRequestMatches ? ['persisted_external_request_mismatch'] : []),
    ...(!syncCursorMatches ? ['persisted_sync_cursor_mismatch'] : []),
    ...(!cacheKeyMatches ? ['persisted_compile_cache_mismatch'] : []),
    ...(!tenantMatches ? ['persisted_tenant_mismatch'] : []),
    ...(!workspaceMatches ? ['persisted_workspace_mismatch'] : []),
    ...(idempotencyChanged ? ['persisted_idempotency_key_mismatch'] : []),
  ]);
  const persistedAhead = persistedEventCount > eventCount;
  const writeRequired = !source || cursorAdvanced || stateChanged || commandChanged || idempotencyChanged;
  const writeAllowed = mismatchReasons.length === 0
    && tenantBoundaryHandoff.ready !== false
    && !persistedAhead
    && recovery.ready !== false;
  const writeMode = !source
    ? 'create_snapshot'
    : persistedAhead
      ? 'skip_persisted_snapshot_ahead'
      : cursorAdvanced
        ? 'append_runtime_event_delta'
        : stateChanged || commandChanged || idempotencyChanged
          ? 'replace_snapshot_metadata'
          : 'reuse_snapshot';
  const persistenceKey = [
    runtimeTenant || persistedTenant || 'unknown-tenant',
    runtimeWorkspace || persistedWorkspace || 'all-workspaces',
    requestId || persistedRequestId || 'local-status',
    cacheKey || persistedCacheKey || 'uncached',
  ].join(':');

  return {
    protocol: 'aios.status-persisted-snapshot.mailchimp.v1',
    persistenceKey,
    requestId,
    state,
    terminal: TERMINAL_STATES.has(state),
    active: ACTIVE_STATES.has(state),
    command,
    idempotencyKey,
    write: {
      required: writeRequired,
      allowed: writeAllowed,
      mode: writeMode,
      nextAction: writeRequired
        ? writeAllowed ? 'persist_status_snapshot' : 'repair_persisted_status_continuity'
        : 'observe',
      blockedReasons: writeAllowed ? [] : stableList([
        ...mismatchReasons,
        ...(persistedAhead ? ['persisted_events_ahead_without_hydration'] : []),
        ...(tenantBoundaryHandoff.ready === false ? ['tenant_boundary_handoff_not_ready'] : []),
        ...(recovery.ready === false ? stableList(recovery.blockedReasons) : []),
      ]),
    },
    cursor: {
      sequence,
      eventCount,
      latestEventIndex,
      latestAt,
      previousSequence: persistedSequence,
      previousEventCount: persistedEventCount,
      previousLatestEventIndex: persistedLatestIndex,
      previousLatestAt,
      cursorAdvanced,
      persistedAhead,
    },
    continuity: {
      tenant: runtimeTenant || persistedTenant,
      workspace: runtimeWorkspace || persistedWorkspace,
      externalRequestId,
      syncCursor,
      cacheKey,
      requestMatches,
      externalRequestMatches,
      syncCursorMatches,
      cacheKeyMatches,
      tenantMatches,
      workspaceMatches,
      idempotencyMatches: !idempotencyChanged,
    },
    provider: {
      provider: compactString(status.providerContract?.provider || externalHandoff.provider || 'mailchimp'),
      service: compactString(status.providerContract?.service || externalHandoff.service || 'mailchimp-marketing'),
      externalRequestId,
      syncCursor,
      receiptAcknowledged: externalHandoff.receipt?.acknowledged === true,
      leaseState: compactString(externalHandoff.lease?.state || status.providerContract?.lease?.state),
    },
    compileCache: {
      cacheKey,
      status: compactString(compileCache.status || 'uncached'),
      replaySafe: compileCache.persistedReplaySummary?.replaySafe === true,
      restartSafe: compileCache.persistedReplaySummary?.restartSafe !== false,
    },
    eventTail: selectPersistedEventTail(events, runtime.persistedEventTailLimit || runtime.statusPersistence?.eventTailLimit || 25),
    exportSummary: {
      exportReady: writeAllowed || !writeRequired,
      format: 'json',
      blockedReasons: writeAllowed ? [] : stableList([...mismatchReasons, ...stableList(recovery.blockedReasons)]),
      counters: {
        writeRequired: writeRequired ? 1 : 0,
        writeAllowed: writeAllowed ? 1 : 0,
        cursorAdvanced: cursorAdvanced ? 1 : 0,
        persistedAhead: persistedAhead ? 1 : 0,
        eventTail: Math.min(eventCount, normalizeCounter(runtime.persistedEventTailLimit || runtime.statusPersistence?.eventTailLimit || 25)),
      },
    },
  };
}

export function buildMailchimpPersistedStatusRecoveryState(status = {}, runtime = {}) {
  const descriptor = status.descriptor || {};
  const source = selectPersistedStatusSource(descriptor, runtime);
  const events = Array.isArray(status.events) ? status.events : [];
  const latest = latestMeaningfulEvent(events);
  const lifecycleControlState = status.lifecycleControlState || status.readiness?.lifecycleControls || {};
  const externalHandoff = status.externalHandoff || {};
  const compileCache = status.compileCache || {};
  const clientCommand = status.clientCommand || {};
  const requestedCommand = normalizePersistenceCommand(
    runtime.statusCommand
      || runtime.recoveryCommand
      || lifecycleControlState.requestedCommand
      || clientCommand.command
      || clientCommand.submitAction
      || status.readiness?.nextStep
      || status.state,
  );
  const idempotentCommands = new Set([
    'observe',
    'queue',
    'resume',
    'retry',
    'recover',
    'refresh_provider_contract',
    'refresh_provider_sync_before_replay',
    'refresh_provider_receipt',
    'refresh_provider_lease',
    'request_operator_acceptance',
    'inspect_status',
    'inspect_external_handoff',
    'handoff_external_status',
    'export_status_report',
  ]);
  const persistedCommand = normalizePersistenceCommand(
    source?.command
      || source?.requestedCommand
      || source?.recoveryCommand
      || source?.lastCommand
      || requestedCommand,
  );
  const idempotencyKey = compactString(
    source?.idempotencyKey
      || source?.commandKey
      || source?.resumeToken
      || clientCommand.idempotencyKey
      || clientCommand.resumeToken
      || compileCache.resumeGate?.resumeToken
      || compileCache.persistedReplaySummary?.idempotencyKey,
  );
  const runtimeIdempotencyKey = compactString(
    runtime.idempotencyKey
      || runtime.commandKey
      || runtime.resumeToken
      || clientCommand.idempotencyKey
      || clientCommand.resumeToken
      || compileCache.persistedReplaySummary?.idempotencyKey,
  );
  const persistedRequestId = compactString(source?.requestId || source?.descriptor?.requestId);
  const statusRequestId = compactString(status.requestId || descriptor.requestId);
  const persistedState = normalizeState(source?.state || source?.status || source?.latestState);
  const persistedEventCount = normalizePersistenceSequence(source?.eventCount || source?.totalEvents);
  const persistedSequence = normalizePersistenceSequence(source?.sequence || source?.revision || source?.version);
  const persistedLatestIndex = normalizePersistenceSequence(
    source?.latestEventIndex
      ?? source?.eventCursor
      ?? source?.cursor
      ?? (persistedEventCount > 0 ? persistedEventCount - 1 : 0),
  );
  const runtimeLatestIndex = latest ? normalizePersistenceSequence(latest.index) : 0;
  const persistedExternalRequestId = compactString(source?.externalRequestId || source?.provider?.externalRequestId);
  const runtimeExternalRequestId = compactString(
    externalHandoff.requestId
      || status.providerContract?.externalRequestId
      || status.providerServiceContract?.externalHandoff?.requestId,
  );
  const persistedSyncCursor = compactString(source?.syncCursor || source?.provider?.syncCursor || source?.provider?.cursor);
  const runtimeSyncCursor = compactString(externalHandoff.syncMetadata?.cursor || status.providerContract?.sync?.cursor);
  const persistedCacheKey = compactString(source?.cacheKey || source?.compileCache?.cacheKey);
  const runtimeCacheKey = compactString(compileCache.cacheKey);
  const persistedTenant = compactString(source?.tenant || source?.boundary?.tenant || source?.scope?.tenant);
  const runtimeTenant = compactString(
    status.tenant
      || status.tenantBoundaryHandoff?.tenant?.effective
      || status.readiness?.tenantBoundaryHandoff?.tenant?.effective,
  );
  const persistedWorkspace = compactString(source?.workspace || source?.workspaceId || source?.boundary?.workspace || source?.scope?.workspace);
  const runtimeWorkspace = compactString(
    status.tenantBoundaryHandoff?.workspace?.effective
      || status.readiness?.tenantBoundaryHandoff?.workspace?.effective
      || runtime.workspace
      || runtime.workspaceId,
  );
  const tenantBoundaryReady = status.tenantBoundaryHandoff?.ready !== false
    && status.readiness?.tenantBoundaryHandoff?.ready !== false;
  const tenantBoundaryBlockedReasons = stableList([
    ...stableList(status.tenantBoundaryHandoff?.blockedReasons),
    ...stableList(status.readiness?.tenantBoundaryHandoff?.blockedReasons),
  ]);
  const hasPersistedState = Boolean(source);
  const resumeRequested = normalizeBooleanControl(
    runtime.resumeRequested,
    runtime.recovery?.resumeRequested,
    runtime.statusPersistence?.resumeRequested,
  ) === true || ['resume', 'retry', 'recover'].includes(requestedCommand);
  const terminalPersisted = TERMINAL_STATES.has(persistedState);
  const currentTerminal = TERMINAL_STATES.has(normalizeState(status.state));
  const currentActive = ACTIVE_STATES.has(normalizeState(status.state));
  const persistedAhead = hasPersistedState
    && persistedEventCount > 0
    && persistedEventCount > events.length;
  const persistedBehind = hasPersistedState
    && events.length > 0
    && persistedEventCount > 0
    && persistedEventCount < events.length;
  const requestMismatch = Boolean(persistedRequestId && statusRequestId && persistedRequestId !== statusRequestId);
  const externalMismatch = Boolean(
    persistedExternalRequestId
      && runtimeExternalRequestId
      && persistedExternalRequestId !== runtimeExternalRequestId,
  );
  const cursorMismatch = Boolean(persistedSyncCursor && runtimeSyncCursor && persistedSyncCursor !== runtimeSyncCursor);
  const cacheMismatch = Boolean(persistedCacheKey && runtimeCacheKey && persistedCacheKey !== runtimeCacheKey);
  const tenantMismatch = Boolean(persistedTenant && runtimeTenant && persistedTenant !== runtimeTenant);
  const workspaceMismatch = Boolean(persistedWorkspace && runtimeWorkspace && persistedWorkspace !== runtimeWorkspace);
  const idempotencyMismatch = Boolean(
    runtimeIdempotencyKey
      && idempotencyKey
      && runtimeIdempotencyKey !== idempotencyKey,
  );
  const commandIdempotent = idempotentCommands.has(requestedCommand)
    || idempotentCommands.has(persistedCommand);
  const canHydrateFromPersisted = hasPersistedState
    && !requestMismatch
    && !externalMismatch
    && !cursorMismatch
    && !cacheMismatch
    && !tenantMismatch
    && !workspaceMismatch
    && tenantBoundaryReady
    && !idempotencyMismatch
    && commandIdempotent;
  const blockedReasons = stableList([
    ...(!hasPersistedState && resumeRequested ? ['persisted_status_missing'] : []),
    ...(requestMismatch ? ['persisted_request_mismatch'] : []),
    ...(externalMismatch ? ['persisted_external_request_mismatch'] : []),
    ...(cursorMismatch ? ['persisted_sync_cursor_mismatch'] : []),
    ...(cacheMismatch ? ['persisted_compile_cache_mismatch'] : []),
    ...(tenantMismatch ? ['persisted_tenant_mismatch'] : []),
    ...(workspaceMismatch ? ['persisted_workspace_mismatch'] : []),
    ...(!tenantBoundaryReady ? ['tenant_boundary_handoff_not_ready'] : []),
    ...tenantBoundaryBlockedReasons,
    ...(idempotencyMismatch ? ['persisted_idempotency_key_mismatch'] : []),
    ...(!commandIdempotent ? ['persisted_command_not_idempotent'] : []),
    ...(persistedAhead && !canHydrateFromPersisted ? ['persisted_events_ahead_without_hydration'] : []),
    ...(terminalPersisted && currentActive && !canHydrateFromPersisted ? ['terminal_persisted_state_conflicts_with_active_runtime'] : []),
  ]);
  const replayMode = !hasPersistedState
    ? resumeRequested ? 'require_snapshot' : 'live_only'
    : blockedReasons.length > 0
      ? 'manual_recovery'
      : persistedAhead
        ? 'hydrate_runtime_from_persisted_snapshot'
        : persistedBehind
          ? 'append_runtime_events_to_persisted_snapshot'
          : terminalPersisted && !currentTerminal
            ? 'adopt_terminal_persisted_state'
            : 'reuse_persisted_snapshot';
  const ready = blockedReasons.length === 0 && (!resumeRequested || hasPersistedState);
  const restartSafe = ready
    && externalHandoff.restartSafe !== false
    && compileCache.persistedReplaySummary?.restartSafe !== false;
  const nextAction = ready
    ? persistedAhead || (terminalPersisted && !currentTerminal)
      ? 'hydrate_status_from_persistence'
      : persistedBehind
        ? 'persist_status_event_delta'
        : 'resume_status_handoff'
    : blockedReasons.includes('persisted_status_missing')
      ? 'load_persisted_status_snapshot'
      : blockedReasons.includes('persisted_command_not_idempotent')
        ? 'replace_with_idempotent_status_command'
        : blockedReasons.some((reason) => reason.includes('mismatch'))
          ? 'repair_persisted_status_continuity'
          : 'inspect_status_persistence';
  const persistedSnapshot = buildMailchimpPersistedStatusSnapshotContract(status, runtime, {
    ready,
    restartSafe,
    replayMode,
    nextAction,
    blockedReasons,
    command: {
      requested: requestedCommand,
      persisted: persistedCommand,
      idempotencyKey,
      runtimeIdempotencyKey,
    },
  });

  return {
    protocol: 'aios.status-persisted-recovery.mailchimp.v1',
    persisted: hasPersistedState,
    ready,
    restartSafe,
    replaySafe: restartSafe && commandIdempotent,
    replayMode,
    nextAction,
    blockedReasons,
    request: {
      requestId: statusRequestId,
      persistedRequestId,
      requestMatches: !requestMismatch,
      adapter: compactString(status.adapter || 'mailchimp'),
    },
    command: {
      requested: requestedCommand,
      persisted: persistedCommand,
      idempotent: commandIdempotent,
      idempotencyKey,
      runtimeIdempotencyKey,
      idempotencyMatches: !idempotencyMismatch,
    },
    cursor: {
      persistedSequence,
      persistedEventCount,
      runtimeEventCount: events.length,
      persistedLatestIndex,
      runtimeLatestIndex,
      persistedAhead,
      persistedBehind,
      latestPersistedAt: compactString(source?.latestAt || source?.updatedAt || source?.persistedAt),
      latestRuntimeAt: compactString(latest?.at),
    },
    continuity: {
      state: persistedState,
      runtimeState: normalizeState(status.state),
      terminalPersisted,
      currentTerminal,
      currentActive,
      externalRequestId: runtimeExternalRequestId,
      persistedExternalRequestId,
      externalRequestMatches: !externalMismatch,
      syncCursor: runtimeSyncCursor,
      persistedSyncCursor,
      syncCursorMatches: !cursorMismatch,
      cacheKey: runtimeCacheKey,
      persistedCacheKey,
      cacheKeyMatches: !cacheMismatch,
      tenant: runtimeTenant,
      persistedTenant,
      tenantMatches: !tenantMismatch,
      workspace: runtimeWorkspace,
      persistedWorkspace,
      workspaceMatches: !workspaceMismatch,
      tenantBoundaryReady,
    },
    persistedSnapshot,
    snapshot: {
      key: persistedSnapshot.persistenceKey,
      state: persistedSnapshot.state,
      writeRequired: persistedSnapshot.write.required,
      writeAllowed: persistedSnapshot.write.allowed,
      writeMode: persistedSnapshot.write.mode,
      nextAction: persistedSnapshot.write.nextAction,
      blockedReasons: persistedSnapshot.write.blockedReasons,
      sequence: persistedSnapshot.cursor.sequence,
      eventCount: persistedSnapshot.cursor.eventCount,
      latestEventIndex: persistedSnapshot.cursor.latestEventIndex,
      latestAt: persistedSnapshot.cursor.latestAt,
    },
    recovery: {
      required: !ready || persistedAhead || (terminalPersisted && !currentTerminal),
      command: nextAction,
      resumeAfter: replayMode,
      routeState: ready ? 'ready' : 'blocked',
    },
    exportSummary: {
      exportReady: ready,
      format: 'json',
      blockedReasons,
      counters: {
        persisted: hasPersistedState ? 1 : 0,
        persistedAhead: persistedAhead ? 1 : 0,
        persistedBehind: persistedBehind ? 1 : 0,
        blockedReasons: blockedReasons.length,
        idempotencyKeyPresent: idempotencyKey ? 1 : 0,
        snapshotWriteRequired: persistedSnapshot.write.required ? 1 : 0,
        snapshotWriteAllowed: persistedSnapshot.write.allowed ? 1 : 0,
        snapshotEventTail: persistedSnapshot.eventTail.length,
      },
    },
  };
}

export function buildMailchimpStatusPersistedResumeTicket(status = {}, runtime = {}, persistedRecovery = null) {
  const descriptor = status.descriptor || status;
  const adapterTicket = runtime.persistedResumeTicket
    || runtime.adapterPersistedResumeTicket
    || status.persistedResumeTicket
    || status.adapterPersistedResumeTicket
    || status.clientCommand?.persistedResumeTicket
    || descriptor.persistedResumeTicket
    || buildMailchimpAdapterPersistedResumeTicket(descriptor, runtime);
  const recovery = persistedRecovery?.protocol === 'aios.status-persisted-recovery.mailchimp.v1'
    ? persistedRecovery
    : buildMailchimpPersistedStatusRecoveryState(status, runtime);
  const ticketKey = compactString(adapterTicket.ticketKey || adapterTicket.resumeTicketKey);
  const persistedTicketKey = compactString(
    runtime.persistedStatus?.resumeTicketKey
      || runtime.persistedStatus?.ticketKey
      || runtime.statusPersistence?.ticketKey
      || recovery.persistedSnapshot?.resumeTicket?.ticketKey
      || recovery.persistedSnapshot?.ticketKey,
  );
  const statusRevision = [
    recovery.request?.requestId || status.requestId || descriptor.requestId || 'mailchimp-status',
    recovery.cursor?.runtimeEventCount ?? 0,
    recovery.cursor?.runtimeLatestIndex ?? 0,
    recovery.continuity?.runtimeState || status.state || 'queued',
  ].map(compactString).filter(Boolean).join(':');
  const ticketMatchesPersistence = !persistedTicketKey || !ticketKey || persistedTicketKey === ticketKey;
  const ready = adapterTicket.ready === true
    && recovery.ready !== false
    && recovery.restartSafe !== false
    && ticketMatchesPersistence;
  const blockedReasons = stableList([
    ...stableList(adapterTicket.blockedReasons),
    ...stableList(recovery.blockedReasons).map((reason) => `persisted_recovery:${reason}`),
    ...(!ticketKey ? ['resume_ticket_key_missing'] : []),
    ...(adapterTicket.ready === false ? ['adapter_resume_ticket_not_ready'] : []),
    ...(recovery.ready === false ? ['persisted_status_recovery_not_ready'] : []),
    ...(recovery.restartSafe === false ? ['persisted_status_not_restart_safe'] : []),
    ...(ticketMatchesPersistence ? [] : ['persisted_resume_ticket_mismatch']),
  ]);
  const state = ready
    ? recovery.persisted === true ? 'adopted' : 'ready_to_persist'
    : blockedReasons.includes('persisted_resume_ticket_mismatch')
      ? 'stale_persisted_ticket'
      : blockedReasons.includes('persisted_status_recovery_not_ready')
        ? 'waiting_for_persisted_status'
        : 'blocked';
  const nextAction = ready
    ? recovery.persisted === true ? 'resume_status_handoff' : 'persist_runtime_resume_ticket'
    : blockedReasons.includes('persisted_resume_ticket_mismatch')
      ? 'refresh_runtime_resume_ticket'
      : blockedReasons.includes('persisted_status_recovery_not_ready')
        ? recovery.nextAction || 'load_persisted_status_snapshot'
        : adapterTicket.nextAction || 'repair_runtime_resume_ticket';

  return {
    protocol: 'aios.status-persisted-resume-ticket.mailchimp.v1',
    ticketKey,
    persistedTicketKey,
    statusRevision,
    state,
    ready,
    restartSafe: ready && recovery.restartSafe !== false,
    replaySafe: ready && recovery.replaySafe === true && adapterTicket.restartSemantics?.replaySafe !== false,
    nextAction,
    blockedReasons,
    request: {
      requestId: recovery.request?.requestId || status.requestId || descriptor.requestId || '',
      requestMatches: recovery.request?.requestMatches !== false,
      tenant: recovery.continuity?.tenant || status.tenant || descriptor.tenant || '',
      workspace: recovery.continuity?.workspace || status.tenantBoundaryHandoff?.workspace?.effective || '',
    },
    continuity: {
      externalRequestId: adapterTicket.continuity?.externalRequestId || recovery.continuity?.externalRequestId || '',
      syncCursor: adapterTicket.continuity?.syncCursor || recovery.continuity?.syncCursor || '',
      cacheKey: adapterTicket.continuity?.cacheKey || recovery.continuity?.cacheKey || '',
      receiptRequired: adapterTicket.continuity?.receiptRequired === true,
      receiptAcknowledged: adapterTicket.continuity?.receiptAcknowledged === true,
      persistedExternalRequestMatches: recovery.continuity?.externalRequestMatches !== false,
      persistedSyncCursorMatches: recovery.continuity?.syncCursorMatches !== false,
      persistedCacheKeyMatches: recovery.continuity?.cacheKeyMatches !== false,
    },
    route: {
      target: 'status-persisted-resume-ticket',
      idempotencyKey: ticketKey || `mailchimp-status-resume:${statusRevision}`.replace(/[^a-zA-Z0-9_.:-]/g, '_'),
      primaryAction: nextAction,
      requiredBodyKeys: ready
        ? ['ticketKey', 'statusRevision', 'continuity']
        : ['ticketKey', 'blockedReasons'],
    },
    clientPatch: {
      statusPersistedResumeTicketKey: ticketKey,
      statusPersistedResumeTicketState: state,
      statusPersistedResumeTicketReady: ready,
      statusPersistedResumeTicketNextAction: nextAction,
      statusPersistedResumeTicketBlockedReasons: blockedReasons,
    },
    restartSemantics: {
      replaySafe: ready,
      duplicateCommandPolicy: 'dedupe-by-status-persisted-resume-ticket-key',
      resumeFromTicketKey: ticketKey,
      externalWritesPerformed: false,
    },
  };
}

function buildStatusReportingState(status = {}) {
  const events = Array.isArray(status.events) ? status.events : [];
  const diagnostics = Array.isArray(status.diagnostics) ? status.diagnostics : [];
  const diagnosticSummary = summarizeDiagnostics(diagnostics);
  const stateCounters = countRuntimeStates(events);
  const compileCache = status.compileCache || {};
  const compileCounters = compileCache.report?.counters || {};
  const compileExportPackage = compileCache.exportPackage || {};
  const historySummary = status.history?.summary || {};
  const historyExportState = status.history?.exportState || {};
  const providerServiceContract = status.providerServiceContract || {};
  const readiness = status.readiness || {};
  const acceptance = readiness.acceptance || {};
  const previewAcceptance = status.previewAcceptance || status.ui?.previewAcceptance || {};
  const clientCommand = status.clientCommand || {};
  const operationalHealth = status.operationalHealth || {};
  const permissionHealth = status.permissionHealth || {};
  const tenantBoundaryHandoff = status.tenantBoundaryHandoff || status.readiness?.tenantBoundaryHandoff || {};
  const tenantBoundaryContinuity = status.tenantBoundaryContinuity
    || status.readiness?.tenantBoundaryContinuity
    || status.ui?.tenantBoundaryContinuity
    || {};
  const lifecycleControlState = status.lifecycleControlState || {};
  const lifecycleCommandState = status.lifecycleCommandState
    || status.readiness?.lifecycleCommandState
    || {};
  const lifecycleSettingsPatch = status.lifecycleSettingsPatch
    || status.readiness?.lifecycleSettingsPatch
    || {};
  const externalHandoff = status.externalHandoff || {};
  const clientWorkflowHandoff = status.clientWorkflowHandoff || status.ui?.clientWorkflowHandoff || {};
  const clientRuntimeState = status.clientRuntimeState || status.ui?.clientRuntimeState || {};
  const clientRuntimeAdoption = clientWorkflowHandoff.runtimeAdoption
    || status.clientRuntimeAdoption
    || status.ui?.clientRuntimeAdoption
    || {};
  const persistedRecovery = status.persistedRecovery || status.ui?.persistedRecovery || {};
  const analyticsExport = status.analyticsExport?.protocol === 'aios.status-analytics-export.mailchimp.v1'
    ? status.analyticsExport
    : buildMailchimpStatusAnalyticsExportContract(status);
  const providerBlockedReasons = stableList(providerServiceContract.blockedReasons);
  const compileBlockedReasons = stableList([
    ...(compileCache.validationSummary?.blockedReasons || []),
    ...(compileExportPackage.blockedReasons || []),
    ...(compileCache.report?.blockedReasons || []),
  ]);
  const readinessBlocked = readiness.ready !== true;
  const providerBlocked = providerServiceContract.state === 'blocked';
  const historyExportReady = historyExportState.ready === true;
  const compileExportReady = compileCache.exportReady === true
    && (compileExportPackage.exportReady !== false);
  const clientCommandReady = clientCommand.validationSummary?.ready !== false
    && !['blocked', 'acceptance_required'].includes(clientCommand.state);
  const operatorAcceptanceReady = acceptance.required !== true || acceptance.accepted === true;
  const previewAcceptanceReady = previewAcceptance.ready !== false
    && previewAcceptance.route?.state !== 'blocked'
    && normalizeCounter(previewAcceptance.validationSummary?.blocking) === 0;
  const lifecycleControlsReady = lifecycleControlState.ready !== false;
  const lifecycleCommandReady = lifecycleCommandState.ready !== false;
  const lifecycleSettingsPatchReady = lifecycleSettingsPatch.ready !== false;
  const tenantBoundaryReady = tenantBoundaryHandoff.ready !== false;
  const tenantBoundaryContinuityReady = tenantBoundaryContinuity.ready !== false;
  const externalHandoffReady = externalHandoff.ready !== false
    && externalHandoff.restartSafe !== false
    && externalHandoff.exportSummary?.exportReady !== false;
  const persistedRecoveryReady = persistedRecovery.ready !== false
    && persistedRecovery.restartSafe !== false
    && persistedRecovery.exportSummary?.exportReady !== false
    && persistedRecovery.persistedSnapshot?.exportSummary?.exportReady !== false;
  const clientWorkflowReady = clientWorkflowHandoff.ready !== false
    && clientWorkflowHandoff.exportSummary?.exportReady !== false
    && !['blocked', 'failed', 'acceptance_required'].includes(clientWorkflowHandoff.state);
  const clientRuntimeAdoptionReady = clientRuntimeAdoption.ready !== false
    && clientRuntimeAdoption.exportSummary?.exportReady !== false
    && !['blocked', 'hydrate_required'].includes(clientRuntimeAdoption.state);
  const exportBlockedReasons = stableList([
    ...(diagnosticSummary.errors > 0 ? ['diagnostic_errors'] : []),
    ...stableList(lifecycleControlState.blockedReasons),
    ...(!lifecycleControlsReady ? ['lifecycle_controls_not_ready'] : []),
    ...stableList(lifecycleCommandState.blockedReasons),
    ...(!lifecycleCommandReady ? ['lifecycle_command_not_ready'] : []),
    ...stableList(lifecycleSettingsPatch.blockedReasons),
    ...(!lifecycleSettingsPatchReady ? ['lifecycle_settings_patch_not_ready'] : []),
    ...(permissionHealth.allowed === false ? ['permission_boundary_blocked'] : []),
    ...stableList(tenantBoundaryHandoff.blockedReasons),
    ...(!tenantBoundaryReady ? ['tenant_boundary_handoff_not_ready'] : []),
    ...stableList(tenantBoundaryContinuity.blockedReasons).map((reason) => `tenant_boundary_continuity:${reason}`),
    ...(!tenantBoundaryContinuityReady ? ['tenant_boundary_continuity_not_ready'] : []),
    ...(readinessBlocked ? ['readiness_not_ready'] : []),
    ...(providerBlocked ? ['provider_service_blocked'] : []),
    ...providerBlockedReasons,
    ...stableList(externalHandoff.blockedReasons),
    ...(!externalHandoffReady ? ['external_handoff_not_ready'] : []),
    ...stableList(persistedRecovery.blockedReasons),
    ...(!persistedRecoveryReady ? ['persisted_status_recovery_not_ready'] : []),
    ...(!historyExportReady ? ['history_export_not_ready'] : []),
    ...(!compileExportReady ? ['compile_cache_export_not_ready'] : []),
    ...compileBlockedReasons,
    ...(!clientCommandReady ? ['client_command_not_ready'] : []),
    ...(!clientWorkflowReady ? ['client_workflow_handoff_not_ready'] : []),
    ...stableList(clientWorkflowHandoff.blockedReasons),
    ...(!clientRuntimeAdoptionReady ? ['client_runtime_adoption_not_ready'] : []),
    ...stableList(clientRuntimeAdoption.blockedReasons),
    ...(analyticsExport.exportReady === false ? ['analytics_export_not_ready'] : []),
    ...stableList(analyticsExport.blockedReasons).map((reason) => `analytics_export:${reason}`),
    ...(!operatorAcceptanceReady ? ['operator_acceptance_required'] : []),
    ...(!previewAcceptanceReady ? ['preview_acceptance_not_ready'] : []),
    ...stableList(previewAcceptance.blockedReasons),
    ...(operationalHealth.failed === true ? ['operational_health_failed'] : []),
    ...(operationalHealth.degraded === true && operationalHealth.degradedMode?.allowed !== true
      ? ['operational_health_degraded']
      : []),
    ...(operationalHealth.retry?.exhausted === true ? ['operational_health_retry_exhausted'] : []),
  ]);
  const exportReady = exportBlockedReasons.length === 0;
  const runtimeTimeline = buildRuntimeTimeline(events, status.history, compileCache);
  const nextAction = exportReady
    ? 'export_status_report'
    : lifecycleCommandReady === false && lifecycleCommandState.nextAction
    ? lifecycleCommandState.nextAction
    : lifecycleSettingsPatchReady === false && lifecycleSettingsPatch.nextAction
      ? lifecycleSettingsPatch.nextAction
    : lifecycleControlsReady === false && lifecycleControlState.nextAction
      ? lifecycleControlState.nextAction
      : compileCache.nextAction
      || providerServiceContract.nextAction
      || clientCommand.submitAction
      || readiness.nextStep
      || operationalHealth.nextAction
      || 'inspect_status';

  return {
    protocol: 'aios.status-reporting.mailchimp.v1',
    requestId: compactString(status.requestId),
    adapter: compactString(status.adapter || 'mailchimp'),
    state: normalizeState(status.state),
    exportReady,
    nextAction,
    blockedReasons: exportBlockedReasons,
    counters: {
      runtimeEvents: events.length,
      runtimeTerminalEvents: stateCounters.terminal,
      runtimeActiveEvents: stateCounters.active,
      runtimeUnknownEvents: stateCounters.unknown,
      runtimeSucceededEvents: stateCounters.succeeded,
      runtimeFailedEvents: stateCounters.failed,
      runtimeRolledBackEvents: stateCounters.rolledBack,
      runtimeCancelledEvents: stateCounters.cancelled,
      runtimeQueuedEvents: stateCounters.queued,
      runtimeRunningEvents: stateCounters.running,
      runtimeWaitingForVerifierEvents: stateCounters.waitingForVerifier,
      runtimeRecoveringEvents: stateCounters.recovering,
      historyEvents: normalizeCounter(status.history?.timeline?.totalEvents),
      historySnapshots: normalizeCounter(historySummary.snapshots || historySummary.totalSnapshots),
      historyExportsReady: historyExportReady ? 1 : 0,
      diagnostics: diagnosticSummary.total,
      diagnosticErrors: diagnosticSummary.errors,
      diagnosticWarnings: diagnosticSummary.warnings,
      compileCacheEntries: normalizeCounter(compileCounters.entries),
      compileCacheLookupEvents: normalizeCounter(compileCounters.lookupEvents),
      compileCacheHitEvents: normalizeCounter(compileCounters.hitEvents),
      compileCacheMissEvents: normalizeCounter(compileCounters.missEvents),
      compileCacheStoreEvents: normalizeCounter(compileCounters.storeEvents),
      compileCacheStaleEntries: normalizeCounter(compileCounters.staleEntries),
      compileCacheErrorEntries: normalizeCounter(compileCounters.errorEntries),
      providerBlockedReasons: providerBlockedReasons.length,
      providerServiceNegotiationReady: providerServiceContract.serviceNegotiation?.ready === true ? 1 : 0,
      providerServiceMissingScopes: normalizeCounter(providerServiceContract.resourceAccess?.missingScopes?.length),
      providerServiceMissingResources: normalizeCounter(providerServiceContract.resourceAccess?.missingResources?.length),
      providerServiceSyncReady: providerServiceContract.sync?.ready === true ? 1 : 0,
      providerServiceSyncStale: providerServiceContract.sync?.stale === true ? 1 : 0,
      providerServiceReceiptRequired: providerServiceContract.externalHandoff?.receiptRequired === true ? 1 : 0,
      providerServiceReceiptAcknowledged: providerServiceContract.externalHandoff?.receiptAcknowledged === true ? 1 : 0,
      externalHandoffReady: externalHandoffReady ? 1 : 0,
      externalHandoffBlockedReasons: stableList(externalHandoff.blockedReasons).length,
      externalHandoffLinked: externalHandoff.linked === true ? 1 : 0,
      externalHandoffReceiptRequired: externalHandoff.receipt?.required === true ? 1 : 0,
      externalHandoffReceiptAcknowledged: externalHandoff.receipt?.acknowledged === true ? 1 : 0,
      externalHandoffSyncCursorPresent: externalHandoff.syncMetadata?.cursorPresent === true ? 1 : 0,
      externalHandoffMissingCapabilities: normalizeCounter(externalHandoff.capabilityNegotiation?.missing?.length),
      persistedRecoveryReady: persistedRecoveryReady ? 1 : 0,
      persistedRecoveryRestartSafe: persistedRecovery.restartSafe === true ? 1 : 0,
      persistedStatusPresent: persistedRecovery.persisted === true ? 1 : 0,
      persistedRecoveryBlockedReasons: stableList(persistedRecovery.blockedReasons).length,
      persistedStatusAhead: persistedRecovery.cursor?.persistedAhead === true ? 1 : 0,
      persistedStatusBehind: persistedRecovery.cursor?.persistedBehind === true ? 1 : 0,
      persistedSnapshotWriteRequired: persistedRecovery.persistedSnapshot?.write?.required === true ? 1 : 0,
      persistedSnapshotWriteAllowed: persistedRecovery.persistedSnapshot?.write?.allowed === true ? 1 : 0,
      persistedSnapshotEventTail: normalizeCounter(persistedRecovery.persistedSnapshot?.eventTail?.length),
      persistedSnapshotBlockedReasons: stableList(persistedRecovery.persistedSnapshot?.write?.blockedReasons).length,
      analyticsExportReady: analyticsExport.exportReady === true ? 1 : 0,
      analyticsExportSections: normalizeCounter(analyticsExport.counters?.exportSections),
      analyticsExportSectionsReady: normalizeCounter(analyticsExport.counters?.exportSectionsReady),
      analyticsExportMilestones: normalizeCounter(analyticsExport.counters?.milestones),
      analyticsExportBlockedReasons: stableList(analyticsExport.blockedReasons).length,
      compileBlockedReasons: compileBlockedReasons.length,
      verifierRequired: normalizeCounter(status.progress?.requiredVerifierCount),
      verifierCompleted: normalizeCounter(status.progress?.completedVerifierCount),
      verifierMissing: Array.isArray(status.truthBoundary?.missingVerifierEvidence)
        ? status.truthBoundary.missingVerifierEvidence.length
        : 0,
      acceptanceRequired: acceptance.required === true ? 1 : 0,
      acceptanceAccepted: acceptance.accepted === true ? 1 : 0,
      previewAcceptanceReady: previewAcceptance.ready === true ? 1 : 0,
      previewAcceptanceBlockingItems: normalizeCounter(previewAcceptance.validationSummary?.blocking),
      previewAcceptanceWarningItems: normalizeCounter(previewAcceptance.validationSummary?.warnings),
      clientCommandReady: clientCommandReady ? 1 : 0,
      clientWorkflowReady: clientWorkflowReady ? 1 : 0,
      clientWorkflowBlockedReasons: stableList(clientWorkflowHandoff.blockedReasons).length,
      clientWorkflowResumeTokenPresent: clientWorkflowHandoff.resume?.tokenPresent === true ? 1 : 0,
      clientRuntimeStateProvided: clientRuntimeState.provided === true ? 1 : 0,
      clientRuntimeStateHydrated: clientRuntimeState.form?.hydrated === true ? 1 : 0,
      clientRuntimeStateStale: clientRuntimeState.form?.stale === true ? 1 : 0,
      clientRuntimeStateDirty: clientRuntimeState.form?.dirty === true ? 1 : 0,
      clientRuntimeAdoptionReady: clientRuntimeAdoptionReady ? 1 : 0,
      clientRuntimeAdoptionBlockedReasons: stableList(clientRuntimeAdoption.blockedReasons).length,
      clientRuntimeAdoptionCanHydrate: clientRuntimeAdoption.adoption?.canHydrate === true ? 1 : 0,
      clientRuntimeAdoptionCanAccept: clientRuntimeAdoption.adoption?.canAccept === true ? 1 : 0,
      clientRuntimeAdoptionCanResume: clientRuntimeAdoption.adoption?.canResume === true ? 1 : 0,
      clientRuntimeAdoptionCanSubmit: clientRuntimeAdoption.adoption?.canSubmit === true ? 1 : 0,
      lifecycleControlsReady: lifecycleControlsReady ? 1 : 0,
      lifecycleControlBlockedReasons: stableList(lifecycleControlState.blockedReasons).length,
      lifecycleScheduleEnabled: lifecycleControlState.controls?.scheduleEnabled === true ? 1 : 0,
      lifecycleSchedulePaused: lifecycleControlState.controls?.paused === true ? 1 : 0,
      lifecycleOperatorHold: lifecycleControlState.operatorHold === true ? 1 : 0,
      lifecycleCommandReady: lifecycleCommandReady ? 1 : 0,
      lifecycleCommandAlreadyApplied: lifecycleCommandState.alreadyApplied === true ? 1 : 0,
      lifecycleCommandBlockedReasons: stableList(lifecycleCommandState.blockedReasons).length,
      lifecycleCommandEffects: normalizeCounter(lifecycleCommandState.effects?.count),
      lifecycleSettingsPatchReady: lifecycleSettingsPatchReady ? 1 : 0,
      lifecycleSettingsPatchApplies: lifecycleSettingsPatch.appliesSettings === true ? 1 : 0,
      lifecycleSettingsPatchChangedFields: normalizeCounter(lifecycleSettingsPatch.changedFields?.length),
      lifecycleSettingsPatchBlockedReasons: stableList(lifecycleSettingsPatch.blockedReasons).length,
      tenantBoundaryReady: tenantBoundaryReady ? 1 : 0,
      tenantBoundaryBlockedReasons: stableList(tenantBoundaryHandoff.blockedReasons).length,
      tenantBoundaryMissingPermissions: normalizeCounter(tenantBoundaryHandoff.role?.missingPermissions?.length),
      tenantBoundaryExternalWriteSuppressed: tenantBoundaryHandoff.audit?.externalWriteSuppressed === true ? 1 : 0,
      tenantBoundaryContinuityReady: tenantBoundaryContinuity.ready === true ? 1 : 0,
      tenantBoundaryContinuityBlockedReasons: stableList(tenantBoundaryContinuity.blockedReasons).length,
      tenantBoundaryContinuityRuntimeDrift: normalizeCounter(tenantBoundaryContinuity.counters?.runtimeDrift),
      tenantBoundaryContinuityAuditReady: tenantBoundaryContinuity.audit?.ready === true ? 1 : 0,
      operationalHealthHealthy: operationalHealth.healthy === true ? 1 : 0,
      operationalHealthDegraded: operationalHealth.degraded === true ? 1 : 0,
      operationalHealthFailed: operationalHealth.failed === true ? 1 : 0,
      operationalHealthRetryable: operationalHealth.retry?.retryable === true ? 1 : 0,
      operationalHealthRetryExhausted: operationalHealth.retry?.exhausted === true ? 1 : 0,
      operationalHealthRetryAfterMs: normalizeCounter(operationalHealth.retry?.retryAfterMs),
      operationalHealthActionableErrors: normalizeCounter(operationalHealth.actionableErrors?.length),
      operationalHealthDegradedModeAllowed: operationalHealth.degradedMode?.allowed === true ? 1 : 0,
      operationalHealthIncidentActive: operationalHealth.incident?.active === true ? 1 : 0,
      operationalHealthIncidentRetryReady: operationalHealth.incident?.retry?.ready === true ? 1 : 0,
      operationalHealthIncidentRetryRestartSafe: operationalHealth.incident?.retry?.restartSafe === true ? 1 : 0,
      operationalHealthIncidentRetryReplaySafe: operationalHealth.incident?.retry?.replaySafe === true ? 1 : 0,
      operationalHealthIncidentBlockedReasons: stableList(operationalHealth.incident?.blockedReasons).length,
      operationalHealthIncidentDegradedModeAllowed: operationalHealth.incident?.degradedMode?.allowed === true ? 1 : 0,
    },
    ratios: {
      runtimeTerminalRate: events.length === 0 ? null : Number((stateCounters.terminal / events.length).toFixed(4)),
      runtimeFailureRate: events.length === 0 ? null : Number((stateCounters.failed / events.length).toFixed(4)),
      compileCacheHitRate: compileCache.report?.ratios?.hitRate ?? null,
      compileCacheMissRate: compileCache.report?.ratios?.missRate ?? null,
      verifierCompletionRate: normalizeCounter(status.progress?.requiredVerifierCount) === 0
        ? null
        : Number((normalizeCounter(status.progress?.completedVerifierCount)
          / normalizeCounter(status.progress?.requiredVerifierCount)).toFixed(4)),
    },
    timeline: {
      ...runtimeTimeline,
      providerLastSyncedAt: compactString(status.providerContract?.sync?.lastSyncedAt),
      providerHistoryLatestAt: compactString(status.providerContract?.sync?.historyLatestAt),
      providerServiceState: compactString(providerServiceContract.state),
      providerServiceNextAction: compactString(providerServiceContract.nextAction),
      providerServiceSyncReplayPolicy: compactString(providerServiceContract.sync?.replayPolicy),
      providerServiceSyncMinSyncedAt: compactString(providerServiceContract.sync?.minSyncedAt),
      externalHandoffLastSyncedAt: compactString(externalHandoff.syncMetadata?.lastSyncedAt),
      externalHandoffHistoryLatestAt: compactString(externalHandoff.syncMetadata?.historyLatestAt),
      persistedStatusLatestAt: compactString(persistedRecovery.cursor?.latestPersistedAt),
      persistedRecoveryMode: compactString(persistedRecovery.replayMode),
      persistedSnapshotKey: compactString(persistedRecovery.persistedSnapshot?.persistenceKey),
      persistedSnapshotMode: compactString(persistedRecovery.persistedSnapshot?.write?.mode),
      persistedSnapshotLatestAt: compactString(persistedRecovery.persistedSnapshot?.cursor?.latestAt),
      analyticsExportPackageId: compactString(analyticsExport.packageId),
      analyticsExportLatestAt: compactString(analyticsExport.timeline?.latestMilestoneAt || analyticsExport.timeline?.latestAt),
      analyticsExportSources: stableList(analyticsExport.timeline?.sources).join(','),
      clientWorkflowState: compactString(clientWorkflowHandoff.state),
      clientWorkflowVisibleStep: compactString(clientWorkflowHandoff.visibleStep),
      clientRuntimeCommand: compactString(clientRuntimeState.command),
      clientRuntimeRoute: compactString(clientRuntimeState.route?.name),
      clientRuntimeAdoptionState: compactString(clientRuntimeAdoption.state),
      clientRuntimeAdoptionVisibleAction: compactString(clientRuntimeAdoption.visibleAction),
      lifecycleCommand: compactString(lifecycleCommandState.command),
      lifecycleCommandState: compactString(lifecycleCommandState.state),
      lifecycleCommandNextAction: compactString(lifecycleCommandState.nextAction),
      lifecycleCommandKey: compactString(lifecycleCommandState.audit?.commandKey),
      lifecycleSettingsPatchState: compactString(lifecycleSettingsPatch.state),
      lifecycleSettingsPatchNextAction: compactString(lifecycleSettingsPatch.nextAction),
      lifecycleSettingsPatchKey: compactString(lifecycleSettingsPatch.audit?.patchKey),
      tenantBoundaryDecision: compactString(tenantBoundaryHandoff.audit?.decision),
      tenantBoundaryHandoffKey: compactString(tenantBoundaryHandoff.audit?.handoffKey),
      tenantBoundaryContinuityKey: compactString(tenantBoundaryContinuity.continuityKey),
      tenantBoundaryContinuityState: compactString(tenantBoundaryContinuity.state),
      tenantBoundaryContinuityNextAction: compactString(tenantBoundaryContinuity.nextAction),
      operationalHealthState: compactString(operationalHealth.state),
      operationalHealthFailureState: compactString(operationalHealth.failureState),
      operationalHealthNextAction: compactString(operationalHealth.nextAction),
      operationalHealthRetryMode: compactString(operationalHealth.retry?.mode),
      operationalHealthDegradedMode: compactString(operationalHealth.degradedMode?.mode),
      operationalHealthIncidentKey: compactString(operationalHealth.incident?.incidentKey),
      operationalHealthIncidentRouteState: compactString(operationalHealth.incident?.routeState),
      operationalHealthIncidentFirstFailureAt: compactString(operationalHealth.incident?.firstFailureAt),
      operationalHealthIncidentLatestFailureAt: compactString(operationalHealth.incident?.latestFailureAt),
      operationalHealthIncidentNextAction: compactString(operationalHealth.incident?.nextAction),
      operationalHealthIncidentRetryCommand: compactString(operationalHealth.incident?.retry?.command),
      operationalHealthIncidentRetryKey: compactString(operationalHealth.incident?.retry?.retryKey),
      compileCacheLatestAt: compileCache.report?.timeline?.latestAt ?? null,
      compileCacheLatestKind: compactString(compileCache.report?.timeline?.latestKind),
      compileCacheLatestStatus: compactString(compileCache.report?.timeline?.latestStatus),
    },
    historySnapshot: {
      protocol: 'aios.status-history-snapshot.mailchimp.v1',
      requestId: compactString(status.requestId),
      totalEvents: normalizeCounter(status.history?.timeline?.totalEvents),
      runtimeEvents: events.map((event) => ({
        index: normalizeCounter(event.index),
        at: compactString(event.at),
        state: normalizeState(event.state),
        code: compactString(event.code),
      })),
      latest: {
        at: runtimeTimeline.latestAt,
        state: runtimeTimeline.latestState,
        code: runtimeTimeline.latestCode,
        message: runtimeTimeline.latestMessage,
      },
      exportState: {
        ready: historyExportReady,
        blockedReasons: stableList(historyExportState.blockedReasons),
      },
      analytics: status.history?.analytics || null,
      analyticsExport: analyticsExport.historySnapshot,
    },
    analyticsExport,
    exportSummary: {
      protocol: 'aios.status-export-summary.mailchimp.v1',
      format: 'json',
      exportReady,
      nextAction,
      blockedReasons: exportBlockedReasons,
      packageId: compactString(compileExportPackage.packageId || `${status.requestId || 'mailchimp'}:status-report`),
      analyticsPackageId: analyticsExport.packageId,
      includes: stableList([
        'analytics_export_contract',
        'runtime_events',
        'adapter_history',
        'provider_service_contract',
        'provider_service_negotiation',
        'external_handoff_state',
        'persisted_status_recovery',
        'persisted_status_snapshot',
        'client_workflow_handoff',
        'client_runtime_state',
        'client_runtime_adoption',
        'compile_cache_report',
      'readiness_contract',
        'preview_acceptance_contract',
        'client_command',
        'operational_health',
        'operational_health_recovery_plan',
        'operational_health_incident',
        'lifecycle_controls',
        'lifecycle_command_state',
        'lifecycle_settings_patch',
        'tenant_boundary_handoff',
        'tenant_boundary_continuity',
      ]),
    },
  };
}

function normalizeCompileCacheReport(source = {}) {
  const analytics = source.analytics && typeof source.analytics === 'object' ? source.analytics : {};
  const exportSummary = source.exportSummary && typeof source.exportSummary === 'object' ? source.exportSummary : {};
  const counters = {
    ...(analytics.counters || {}),
    ...(exportSummary.counters || {}),
  };
  const timeline = {
    ...(analytics.timeline || {}),
    ...(exportSummary.timeline || {}),
  };
  const lookupEvents = normalizeCounter(counters.lookupEvents);
  const hitEvents = normalizeCounter(counters.hitEvents);
  const missEvents = normalizeCounter(counters.missEvents);
  const staleEntries = normalizeCounter(counters.staleEntries);
  const errorEntries = normalizeCounter(counters.errorEntries);
  const exportReady = exportSummary.exportReady !== false && staleEntries === 0 && errorEntries === 0;

  return {
    protocol: 'aios.compile-cache-report.mailchimp.v1',
    exportReady,
    blockedReasons: Array.isArray(exportSummary.blockedReasons)
      ? exportSummary.blockedReasons.map(compactString).filter(Boolean).sort()
      : [
        ...(staleEntries > 0 ? ['stale_entries'] : []),
        ...(errorEntries > 0 ? ['diagnostic_errors'] : []),
      ],
    counters: {
      entries: normalizeCounter(counters.entries),
      staleEntries,
      errorEntries,
      totalEntryHits: normalizeCounter(counters.totalEntryHits),
      lookupEvents,
      hitEvents,
      missEvents,
      storeEvents: normalizeCounter(counters.storeEvents),
      evictionEvents: normalizeCounter(counters.evictionEvents),
      invalidationEvents: normalizeCounter(counters.invalidationEvents),
      diagnosticErrors: normalizeCounter(counters.diagnosticErrors),
      diagnosticWarnings: normalizeCounter(counters.diagnosticWarnings),
    },
    ratios: {
      hitRate: lookupEvents === 0 ? null : Number((hitEvents / lookupEvents).toFixed(4)),
      missRate: lookupEvents === 0 ? null : Number((missEvents / lookupEvents).toFixed(4)),
    },
    timeline: {
      latestAt: timeline.latestAt ?? null,
      latestKind: compactString(timeline.latestKind),
      latestStatus: compactString(timeline.latestStatus),
      totalEvents: normalizeCounter(timeline.totalEvents),
    },
  };
}

function normalizeCompileCacheProviderCheckpoint(descriptor = {}, source = {}, runtime = {}) {
  const persisted = source.providerSyncCheckpoint && source.providerSyncCheckpoint.protocol === 'aios.compile-cache-provider-sync.mailchimp.v1'
    ? source.providerSyncCheckpoint
    : null;
  const checkpoint = persisted || buildMailchimpCompileCacheProviderSyncCheckpoint(descriptor, runtime);
  const state = compactString(checkpoint.state || 'stale').toLowerCase().replaceAll('-', '_');
  const blockedReasons = Array.isArray(checkpoint.blockedReasons)
    ? checkpoint.blockedReasons.map(compactString).filter(Boolean).sort()
    : [];
  const restartSafe = checkpoint.restartSafe === true
    && !['missing_cursor', 'stale', 'external_unlinked'].includes(state);

  return {
    protocol: 'aios.compile-cache-provider-sync.mailchimp.v1',
    provider: compactString(checkpoint.provider || 'mailchimp') || 'mailchimp',
    service: compactString(checkpoint.service || 'mailchimp-marketing') || 'mailchimp-marketing',
    resource: compactString(checkpoint.resource || 'mailchimp') || 'mailchimp',
    state: state || 'stale',
    restartSafe,
    externalHandoffState: compactString(checkpoint.externalHandoffState || 'local_only') || 'local_only',
    externalRequestId: compactString(checkpoint.externalRequestId),
    cursor: compactString(checkpoint.cursor),
    cursorRequired: checkpoint.cursorRequired === true,
    lastSyncedAt: compactString(checkpoint.lastSyncedAt),
    batchId: compactString(checkpoint.batchId),
    capabilitySatisfied: checkpoint.capabilitySatisfied !== false,
    requiredForExternalWrite: checkpoint.requiredForExternalWrite === true,
    replayPolicy: compactString(checkpoint.replayPolicy || (restartSafe ? 'reuse_checkpoint' : 'refresh_provider_sync_before_replay')),
    blockedReasons,
    persisted: Boolean(persisted),
  };
}

function summarizePersistedReplayState(persistedReplayState = {}) {
  const blockedReasons = Array.isArray(persistedReplayState.blockedReasons)
    ? persistedReplayState.blockedReasons.map(compactString).filter(Boolean).sort()
    : [];
  const command = persistedReplayState.command && typeof persistedReplayState.command === 'object'
    ? persistedReplayState.command
    : {};
  const retry = persistedReplayState.retry && typeof persistedReplayState.retry === 'object'
    ? persistedReplayState.retry
    : {};
  const providerSync = persistedReplayState.providerSync && typeof persistedReplayState.providerSync === 'object'
    ? persistedReplayState.providerSync
    : {};

  return {
    protocol: 'aios.compile-cache-persisted-replay-summary.mailchimp.v1',
    state: compactString(persistedReplayState.state || 'persisted_hold'),
    replaySafe: persistedReplayState.replaySafe === true,
    restartSafe: persistedReplayState.restartSafe === true,
    nextAction: compactString(command.nextAction || persistedReplayState.recovery?.command || 'refresh_compile_cache'),
    idempotencyKey: compactString(command.idempotencyKey),
    retryKey: compactString(command.retryKey),
    replayKey: compactString(command.replayKey),
    blockedReasons,
    retry: {
      attempts: normalizeCounter(retry.attempts),
      maxAttempts: Math.max(1, normalizeCounter(retry.maxAttempts) || 1),
      retryAfterMs: normalizeCounter(retry.retryAfterMs),
      exhausted: retry.exhausted === true,
      mode: compactString(retry.mode || 'immediate'),
    },
    providerSync: {
      state: compactString(providerSync.state || 'stale'),
      restartSafe: providerSync.restartSafe === true,
      replayPolicy: compactString(providerSync.replayPolicy || 'refresh_provider_sync_before_replay'),
      externalHandoffState: compactString(providerSync.externalHandoffState || 'local_only'),
      externalRequestId: compactString(providerSync.externalRequestId),
      cursorRequired: providerSync.cursorRequired === true,
      cursorPresent: providerSync.cursorPresent === true,
      capabilitySatisfied: providerSync.capabilitySatisfied !== false,
      blockedReasons: Array.isArray(providerSync.blockedReasons)
        ? providerSync.blockedReasons.map(compactString).filter(Boolean).sort()
        : [],
    },
    recovery: {
      required: persistedReplayState.recovery?.required !== false && persistedReplayState.replaySafe !== true,
      command: compactString(persistedReplayState.recovery?.command || command.nextAction),
      resumeAfter: compactString(persistedReplayState.recovery?.resumeAfter || persistedReplayState.state),
      routeState: compactString(persistedReplayState.recovery?.routeState || (persistedReplayState.replaySafe ? 'ready' : 'blocked')),
    },
  };
}

function normalizeCompileCacheState(descriptor = {}, runtime = {}) {
  const source = runtime.compileCache && typeof runtime.compileCache === 'object'
    ? runtime.compileCache
    : descriptor.compileCache && typeof descriptor.compileCache === 'object'
      ? descriptor.compileCache
      : descriptor.compileIdentity && typeof descriptor.compileIdentity === 'object'
        ? descriptor.compileIdentity
        : {};
  const status = compactString(source.status || (source.cacheKey ? 'compiled' : 'uncached'));
  const ageMs = Number.isFinite(Number(source.ageMs)) ? Math.max(0, Math.floor(Number(source.ageMs))) : null;
  const ttlRemainingMs = source.ttlRemainingMs == null || !Number.isFinite(Number(source.ttlRemainingMs))
    ? null
    : Math.max(0, Math.floor(Number(source.ttlRemainingMs)));
  const stale = source.stale === true || ttlRemainingMs === 0;
  const replayed = source.replayed === true || status === 'hit';
  const cacheKey = compactString(source.key || source.cacheKey);
  const report = normalizeCompileCacheReport(source);
  const exportReady = report.exportReady && !stale;
  const lifecycleSettings = runtime.compileCacheLifecycle && typeof runtime.compileCacheLifecycle === 'object'
    ? runtime.compileCacheLifecycle
    : source.lifecycleSettings && typeof source.lifecycleSettings === 'object'
      ? source.lifecycleSettings
      : source.lifecycle && typeof source.lifecycle === 'object'
        ? source.lifecycle
        : {};
  const lifecycleEntry = cacheKey
    ? {
      key: cacheKey,
      requestKey: compactString(source.requestKey),
      sourceHash: compactString(source.sourceHash),
      optionsHash: compactString(source.optionsHash),
      contractHash: compactString(source.contractHash),
      createdAt: source.createdAt ?? 0,
      updatedAt: source.updatedAt ?? 0,
      lastAccessedAt: source.lastAccessedAt ?? 0,
      expiresAt: source.expiresAt ?? null,
      ttlRemainingMs,
      stale,
      hits: normalizeCounter(source.hits),
      diagnostics: {
        total: normalizeCounter(source.diagnostics?.total),
        errors: normalizeCounter(source.diagnostics?.errors),
        warnings: normalizeCounter(source.diagnostics?.warnings),
      },
    }
    : null;
  const lifecycleDecision = source.lifecycleDecision && source.lifecycleDecision.protocol === 'aios.compile-cache-lifecycle.mailchimp.v1'
    ? source.lifecycleDecision
    : buildMailchimpCompileCacheLifecycleDecision({
      protocol: 'aios.compile-cache-snapshot.mailchimp.v1',
      namespace: source.namespace || 'mailchimp',
      entries: Array.isArray(source.entries)
        ? source.entries
        : lifecycleEntry
          ? [lifecycleEntry]
          : [],
      analytics: source.analytics || {},
      exportSummary: source.exportSummary || report,
    }, lifecycleSettings);
  const lifecycleBlockedReasons = Array.isArray(lifecycleDecision.validationSummary?.blockedReasons)
    ? lifecycleDecision.validationSummary.blockedReasons
    : [];
  const providerSyncCheckpoint = normalizeCompileCacheProviderCheckpoint(descriptor, source, runtime);
  const boundaryCheckpoint = source.boundaryCheckpoint?.protocol === 'aios.compile-cache-boundary-checkpoint.mailchimp.v1'
    ? source.boundaryCheckpoint
    : buildMailchimpCompileCacheBoundaryCheckpoint({
      descriptor,
      boundaryScope: source.boundaryScope || source.boundary || descriptor.truthBoundary?.tenantBoundary,
      compileCache: source,
    }, runtime);
  const providerSyncReady = providerSyncCheckpoint.restartSafe === true
    && providerSyncCheckpoint.capabilitySatisfied !== false;
  const boundaryReady = boundaryCheckpoint.ready === true
    && boundaryCheckpoint.replayAllowed !== false
    && boundaryCheckpoint.restartSafe !== false;
  const cacheReady = exportReady
    && lifecycleDecision.blocked !== true
    && lifecycleDecision.refreshRecommended !== true
    && providerSyncReady
    && boundaryReady;
  const uiHandoff = source.uiHandoff && source.uiHandoff.protocol === 'aios.compile-cache-ui-handoff.mailchimp.v1'
    ? source.uiHandoff
    : buildMailchimpCompileCacheUiHandoff({
      protocol: 'aios.compile-cache-status.mailchimp.v1',
      namespace: source.namespace || 'mailchimp',
      compileCache: {
        cacheKey,
        key: cacheKey,
        status: cacheKey ? status : 'uncached',
        replayed,
        stale,
        ttlRemainingMs,
        hits: normalizeCounter(source.hits),
        requestKey: compactString(source.requestKey),
        sourceHash: compactString(source.sourceHash),
        optionsHash: compactString(source.optionsHash),
        contractHash: compactString(source.contractHash),
        diagnostics: lifecycleEntry?.diagnostics || source.diagnostics || {},
        analytics: source.analytics || {},
        exportSummary: source.exportSummary || report,
        lifecycle: lifecycleDecision,
        providerSyncCheckpoint,
      },
      entries: lifecycleEntry ? [lifecycleEntry] : [],
      analytics: source.analytics || {},
      exportSummary: source.exportSummary || report,
      lifecycle: lifecycleDecision,
      providerSyncCheckpoint,
      boundaryCheckpoint,
    }, runtime);
  const exportPackage = source.exportPackage?.protocol === 'aios.compile-cache-export-package.mailchimp.v1'
    ? source.exportPackage
    : buildMailchimpCompileCacheExportPackage({
      namespace: source.namespace || 'mailchimp',
      cacheKey,
      status: cacheKey ? status : 'uncached',
      replayed,
      stale,
      entries: lifecycleEntry ? [lifecycleEntry] : [],
      analytics: source.analytics || {},
      exportSummary: source.exportSummary || report,
      lifecycle: lifecycleDecision,
      providerSyncCheckpoint,
      boundaryCheckpoint,
      uiHandoff,
      history: source.history || {},
    }, runtime);
  const replayBarrier = source.replayBarrier && source.replayBarrier.protocol === 'aios.compile-cache-replay-barrier.mailchimp.v1'
    ? source.replayBarrier
    : buildMailchimpCompileCacheReplayBarrier({
      cacheKey,
      status: cacheKey ? status : 'uncached',
      replayed,
      providerSyncCheckpoint,
      boundaryCheckpoint,
      uiHandoff,
    }, runtime);
  const persistedReplayState = source.persistedReplayState?.protocol === 'aios.compile-cache-persisted-replay-state.mailchimp.v1'
    ? source.persistedReplayState
    : buildMailchimpCompileCachePersistedReplayState({
      namespace: source.namespace || 'mailchimp',
      cacheKey,
      requestKey: compactString(source.requestKey),
      status: cacheKey ? status : 'uncached',
      replayed,
      stale,
      exportReady,
      sourceHash: compactString(source.sourceHash),
      optionsHash: compactString(source.optionsHash),
      contractHash: compactString(source.contractHash),
      providerSyncCheckpoint,
      boundaryCheckpoint,
      uiHandoff,
      replayBarrier,
      report,
    }, runtime);
  const persistedReplaySummary = summarizePersistedReplayState(persistedReplayState);
  const operationalHealth = buildMailchimpCompileCacheOperationalHealthReport({
    stale,
    report,
    lifecycleDecision,
    providerSyncCheckpoint,
    boundaryCheckpoint,
    replayBarrier,
    persistedReplaySummary,
  }, runtime);
  const resumeGate = source.resumeGate?.protocol === 'aios.compile-cache-resume-gate.mailchimp.v1'
    ? source.resumeGate
    : buildMailchimpCompileCacheResumeGate({
      namespace: source.namespace || 'mailchimp',
      cacheKey,
      requestKey: compactString(source.requestKey),
      status: cacheKey ? status : 'uncached',
      replayed,
      stale,
      ttlRemainingMs,
      sourceHash: compactString(source.sourceHash),
      optionsHash: compactString(source.optionsHash),
      contractHash: compactString(source.contractHash),
      uiHandoff,
      replayBarrier,
      persistedReplayState,
      persistedSnapshotState: source.persistedSnapshotState || {},
      operationalHealth,
      exportPackage,
      clientWorkflowHandoff: source.clientWorkflowHandoff || {},
      providerSyncCheckpoint,
      providerServiceContract: providerSyncCheckpoint.providerServiceContract || source.providerServiceContract || {},
      boundaryScope: source.boundaryScope || boundaryCheckpoint || {},
      lifecycle: lifecycleDecision,
      exportSummary: report,
    }, runtime);

  return {
    protocol: 'aios.compile-cache-status.mailchimp.v1',
    cacheKey,
    status: cacheKey ? status : 'uncached',
    replayed,
    stale,
    ageMs,
    ttlRemainingMs,
    sourceHash: compactString(source.sourceHash),
    optionsHash: compactString(source.optionsHash),
    contractHash: compactString(source.contractHash),
    requestKey: compactString(source.requestKey),
    report,
    lifecycle: lifecycleDecision,
    providerSyncCheckpoint,
    boundaryCheckpoint,
    uiHandoff,
    exportPackage,
    replayBarrier,
    persistedReplayState,
    persistedReplaySummary,
    operationalHealth,
    resumeGate,
    exportReady,
    validationSummary: {
      ready: cacheReady
        && uiHandoff.readiness.ready === true
        && replayBarrier.open === true
        && resumeGate.ready === true,
      blockedReasons: [
        ...(stale ? ['stale_entry'] : []),
        ...providerSyncCheckpoint.blockedReasons,
        ...(!providerSyncReady ? ['provider_sync_checkpoint_not_restart_safe'] : []),
        ...(!boundaryReady ? ['boundary_checkpoint_not_restart_safe'] : []),
        ...(Array.isArray(boundaryCheckpoint.blockedReasons) ? boundaryCheckpoint.blockedReasons : []),
        ...report.blockedReasons,
        ...lifecycleBlockedReasons,
        ...uiHandoff.validationSummary.blockedReasons,
        ...replayBarrier.blockedReasons,
        ...persistedReplaySummary.blockedReasons,
        ...resumeGate.blockedReasons,
      ].sort(),
      counters: report.counters,
      lifecycle: lifecycleDecision.validationSummary,
      persistedReplay: persistedReplaySummary,
      boundaryCheckpoint,
      exportPackage: {
        packageId: exportPackage.packageId,
        exportReady: exportPackage.exportReady,
        blockedReasons: exportPackage.blockedReasons,
        nextAction: exportPackage.nextAction,
      },
    },
    nextAction: persistedReplaySummary.replaySafe !== true && persistedReplaySummary.nextAction
      ? persistedReplaySummary.nextAction
      : resumeGate.ready !== true && resumeGate.nextAction
      ? resumeGate.nextAction
      : replayBarrier.open !== true
      ? replayBarrier.nextAction
      : uiHandoff.routeHints?.primaryAction && uiHandoff.routeHints.primaryAction !== 'reuse_compile_cache'
      ? uiHandoff.routeHints.primaryAction
      : lifecycleDecision.nextAction && lifecycleDecision.nextAction !== 'reuse_compile_cache'
      ? lifecycleDecision.nextAction
      : !cacheKey
      ? 'compile_without_cache'
      : stale
        ? 'refresh_compile_cache'
        : !providerSyncReady
          ? providerSyncCheckpoint.replayPolicy
        : !boundaryReady
          ? boundaryCheckpoint.nextAction || 'repair_tenant_permissions'
        : !report.exportReady
      ? 'review_compile_cache_export'
        : exportPackage.exportReady === false
          ? exportPackage.nextAction || 'review_compile_cache_export'
        : replayed
      ? 'verify_cached_descriptor'
      : 'reuse_compiled_descriptor',
  };
}

function selectRetryNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(0, Math.floor(number));
  }
  return 0;
}

function classifyHealthFailureState(reason = '') {
  const normalized = compactString(reason);
  if (!normalized) return 'unknown';
  if (normalized.includes('tenant') || normalized.includes('permission') || normalized.includes('boundary')) {
    return 'policy_blocked';
  }
  if (normalized.includes('provider_offline') || normalized.includes('provider_blocked')) {
    return 'provider_unavailable';
  }
  if (normalized.includes('provider_degraded') || normalized.includes('provider_sync') || normalized.includes('capability')) {
    return 'provider_degraded';
  }
  if (normalized.includes('lease')) return 'lease_not_ready';
  if (normalized.includes('receipt')) return 'receipt_not_acknowledged';
  if (normalized.includes('compile_cache')) return 'compile_cache_not_ready';
  if (normalized.includes('persisted')) return 'persistence_not_ready';
  if (normalized.includes('lifecycle') || normalized.includes('schedule') || normalized.includes('operator_hold')) {
    return 'lifecycle_blocked';
  }
  if (normalized.includes('verifier')) return 'verifier_evidence_missing';
  if (normalized.includes('diagnostic') || normalized.includes('status_failed')) return 'runtime_failed';
  return normalized.replaceAll('.', '_').replaceAll(':', '_') || 'unknown';
}

function selectHealthFailureState(failedReasons = [], degradedReasons = []) {
  const reasons = stableList([...failedReasons, ...degradedReasons]);
  const classified = reasons.map(classifyHealthFailureState).filter(Boolean);
  const priority = [
    'runtime_failed',
    'policy_blocked',
    'provider_unavailable',
    'verifier_evidence_missing',
    'compile_cache_not_ready',
    'persistence_not_ready',
    'lease_not_ready',
    'receipt_not_acknowledged',
    'provider_degraded',
    'lifecycle_blocked',
  ];
  return priority.find((state) => classified.includes(state)) || classified[0] || 'healthy';
}

function healthReasonRetryable(reason = '') {
  const normalized = compactString(reason);
  if (!normalized) return false;
  if (
    normalized.includes('permission')
    || normalized.includes('tenant_boundary')
    || normalized.includes('missing_permission')
    || normalized.includes('mismatch')
    || normalized.includes('verifier')
    || normalized.includes('operator_acceptance')
    || normalized.includes('diagnostic_errors')
    || normalized.includes('status_failed')
  ) {
    return false;
  }
  return [
    'provider_degraded',
    'provider_sync',
    'provider_lease',
    'provider_receipt',
    'external_handoff',
    'compile_cache',
    'persisted',
    'schedule_window_not_open',
    'schedule_not_due',
  ].some((token) => normalized.includes(token));
}

function buildDeterministicBackoff({ attempts = 0, baseMs = 1000, maxMs = 60000, floorMs = 0 } = {}) {
  const normalizedAttempts = Math.max(0, Math.floor(Number(attempts) || 0));
  const normalizedBase = Math.max(0, Math.floor(Number(baseMs) || 0));
  const normalizedMax = Math.max(normalizedBase, Math.floor(Number(maxMs) || normalizedBase || 0));
  const normalizedFloor = Math.max(0, Math.floor(Number(floorMs) || 0));
  const multiplier = Math.min(32, 2 ** Math.min(normalizedAttempts, 5));
  return Math.min(normalizedMax, Math.max(normalizedFloor, normalizedBase * multiplier));
}

function dedupeActionableErrors(errors = []) {
  const seen = new Set();
  return (Array.isArray(errors) ? errors : [])
    .map((item) => ({
      code: compactString(item?.code || item?.reason || 'mailchimp.status.health.action'),
      severity: compactString(item?.severity || 'warning'),
      action: compactString(item?.action || item?.nextAction || 'inspect_status'),
      reason: compactString(item?.reason || item?.code),
      retryable: item?.retryable === true,
    }))
    .filter((item) => {
      const key = `${item.code}:${item.action}:${item.severity}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(item.code || item.action);
    });
}

export function buildMailchimpStatusHealthRecoveryPlan(status = {}, signals = {}) {
  const compileHealth = status.compileCache?.operationalHealth || {};
  const lifecycleControlState = status.lifecycleControlState || status.readiness?.lifecycleControls || {};
  const externalHandoff = status.externalHandoff || {};
  const persistedRecovery = status.persistedRecovery || status.ui?.persistedRecovery || {};
  const failedReasons = stableList(signals.failedReasons);
  const degradedReasons = stableList(signals.degradedReasons);
  const allReasons = stableList([...failedReasons, ...degradedReasons]);
  const state = compactString(signals.state || (failedReasons.length > 0 ? 'failed' : degradedReasons.length > 0 ? 'degraded' : 'healthy'));
  const failureState = selectHealthFailureState(failedReasons, degradedReasons);
  const retryableReasons = allReasons.filter(healthReasonRetryable);
  const nonRetryableReasons = allReasons.filter((reason) => !healthReasonRetryable(reason));
  const retrySource = status.healthPolicy?.retry || status.operationalHealthPolicy?.retry || {};
  const attempts = selectRetryNumber(
    retrySource.attempts,
    retrySource.currentAttempts,
    compileHealth.retry?.attempts,
    status.retry?.attempts,
  );
  const maxAttempts = Math.max(1, selectRetryNumber(
    retrySource.maxAttempts,
    compileHealth.retry?.maxAttempts,
    status.retry?.maxAttempts,
    3,
  ));
  const retryFloorMs = selectRetryNumber(
    compileHealth.retry?.retryAfterMs,
    externalHandoff.retryAfterMs,
    persistedRecovery.retry?.retryAfterMs,
    retrySource.retryAfterMs,
  );
  const retryAfterMs = state === 'healthy'
    ? 0
    : buildDeterministicBackoff({
      attempts,
      baseMs: selectRetryNumber(retrySource.baseMs, 1000),
      maxMs: selectRetryNumber(retrySource.maxMs, 60000),
      floorMs: retryFloorMs,
    });
  const exhausted = attempts >= maxAttempts;
  const retryable = state !== 'healthy'
    && retryableReasons.length > 0
    && nonRetryableReasons.length === 0
    && !exhausted;
  const degradedModeAllowed = state === 'degraded'
    && failedReasons.length === 0
    && status.truthBoundary?.externalWritesAllowed !== true
    && externalHandoff.writesExternalSystem !== true
    && !allReasons.some((reason) => (
      reason.includes('permission')
      || reason.includes('tenant_boundary')
      || reason.includes('boundary_checkpoint')
      || reason.includes('external_write')
    ));
  const primaryAction = state === 'healthy'
    ? signals.nextAction || status.readiness?.nextStep || 'observe'
    : !retryable && nonRetryableReasons.length > 0
      ? signals.nextAction || lifecycleControlState.nextAction || compileHealth.nextAction || 'inspect_status'
      : retryable
        ? compileHealth.nextAction || externalHandoff.nextAction || persistedRecovery.nextAction || 'retry_status_handoff'
        : signals.nextAction || 'inspect_status';
  const actions = [
    {
      key: 'primary',
      owner: failureState.includes('provider') || failureState.includes('lease') || failureState.includes('receipt')
        ? 'provider'
        : failureState.includes('compile_cache')
          ? 'compiler'
          : failureState.includes('policy') || failureState.includes('boundary')
            ? 'runtime'
            : 'operator',
      action: compactString(primaryAction),
      reason: allReasons[0] || 'healthy',
      retryable,
    },
    ...(retryable ? [{
      key: 'retry',
      owner: 'runtime',
      action: 'retry_after_backoff',
      reason: retryableReasons[0] || failureState,
      retryable: true,
    }] : []),
    ...(degradedModeAllowed ? [{
      key: 'degraded_mode',
      owner: 'runtime',
      action: 'continue_in_degraded_read_only_mode',
      reason: failureState,
      retryable: false,
    }] : []),
  ];

  return {
    protocol: 'aios.status-health-recovery-plan.mailchimp.v1',
    state,
    failureState,
    healthy: state === 'healthy',
    degradedMode: {
      allowed: degradedModeAllowed,
      mode: degradedModeAllowed ? 'read_only_status_export' : 'normal',
      suppressedExternalWrites: degradedModeAllowed && status.truthBoundary?.externalWritesAllowed !== true,
      reason: degradedModeAllowed ? failureState : '',
    },
    retry: {
      retryable,
      attempts,
      maxAttempts,
      exhausted,
      retryAfterMs: retryable ? retryAfterMs : 0,
      mode: retryable ? 'deterministic_exponential_backoff' : 'manual',
      retryableReasons,
      nonRetryableReasons,
    },
    nextAction: compactString(actions[0]?.action || 'observe'),
    blockedReasons: allReasons,
    actions,
    actionableErrors: dedupeActionableErrors([
      ...(compileHealth.actionableErrors || []),
      ...(status.permissionHealth?.actionableErrors || []),
      ...allReasons.map((reason) => ({
        code: `mailchimp.status.health.${classifyHealthFailureState(reason)}`,
        severity: failedReasons.includes(reason) ? 'error' : 'warning',
        action: actions.find((item) => item.reason === reason)?.action || primaryAction,
        reason,
        retryable: healthReasonRetryable(reason),
      })),
    ]),
  };
}

function selectIncidentTimestamp(...values) {
  for (const value of values) {
    const compacted = compactString(value);
    if (compacted) return compacted;
  }
  return '';
}

function eventMatchesHealthReason(event = {}, reasons = []) {
  const haystack = stableList([
    event.state,
    event.code,
    event.message,
    event.truth,
  ]).join(' ');
  return reasons.some((reason) => haystack.includes(reason) || reason.includes(compactString(event.code)));
}

function selectHealthIncidentEvent(events = [], reasons = []) {
  const normalizedEvents = Array.isArray(events) ? events : [];
  const healthReasons = stableList(reasons);
  const matched = normalizedEvents.find((event) => eventMatchesHealthReason(event, healthReasons));
  if (matched) return matched;
  return normalizedEvents.find((event) => ['failed', 'recovering', 'waiting_for_verifier'].includes(normalizeState(event.state)))
    || latestMeaningfulEvent(normalizedEvents)
    || null;
}

function buildIncidentRetryCommand(status = {}, recoveryPlan = {}, incidentKey = '') {
  const compileCache = status.compileCache || {};
  const persistedRecovery = status.persistedRecovery || status.ui?.persistedRecovery || {};
  const clientCommand = status.clientCommand || status.ui?.clientCommand || {};
  const lifecycleCommandState = status.lifecycleCommandState || status.readiness?.lifecycleCommandState || {};
  const retry = recoveryPlan.retry || {};
  const idempotencyKey = compactString(
    clientCommand.idempotencyKey
      || clientCommand.resumeToken
      || persistedRecovery.command?.idempotencyKey
      || persistedRecovery.persistedSnapshot?.idempotencyKey
      || compileCache.persistedReplaySummary?.idempotencyKey
      || compileCache.resumeGate?.resumeToken
      || lifecycleCommandState.audit?.commandKey
      || incidentKey,
  );
  const command = retry.retryable === true
    ? recoveryPlan.nextAction || 'retry_status_handoff'
    : recoveryPlan.degradedMode?.allowed === true
      ? 'continue_in_degraded_read_only_mode'
      : recoveryPlan.nextAction || 'inspect_status';

  return {
    command,
    idempotencyKey,
    retryKey: [incidentKey || 'mailchimp-status-health', retry.attempts ?? 0, retry.retryAfterMs ?? 0].join(':'),
    replaySafe: persistedRecovery.replaySafe === true
      || compileCache.persistedReplaySummary?.replaySafe === true
      || compileCache.replayBarrier?.open === true,
    restartSafe: persistedRecovery.restartSafe !== false
      && compileCache.persistedReplaySummary?.restartSafe !== false
      && status.externalHandoff?.restartSafe !== false,
  };
}

function buildMailchimpStatusHealthIncidentEnvelope(status = {}, recoveryPlan = {}, signals = {}) {
  const events = Array.isArray(status.events) ? status.events : [];
  const failedReasons = stableList(signals.failedReasons || recoveryPlan.retry?.nonRetryableReasons);
  const degradedReasons = stableList(signals.degradedReasons || recoveryPlan.retry?.retryableReasons);
  const allReasons = stableList([
    ...failedReasons,
    ...degradedReasons,
    ...stableList(recoveryPlan.blockedReasons),
  ]);
  const incidentEvent = selectHealthIncidentEvent(events, allReasons);
  const latest = latestMeaningfulEvent(events);
  const observedAt = selectIncidentTimestamp(
    status.observedAt,
    status.clientRuntimeState?.form?.observedAt,
    status.ui?.clientRuntimeState?.form?.observedAt,
    latest?.at,
    status.history?.timeline?.latestAt,
  );
  const firstFailureAt = selectIncidentTimestamp(
    signals.firstFailureAt,
    status.operationalHealthPolicy?.firstFailureAt,
    status.healthPolicy?.firstFailureAt,
    incidentEvent?.at,
    latest?.at,
  );
  const latestFailureAt = selectIncidentTimestamp(
    signals.latestFailureAt,
    status.operationalHealthPolicy?.latestFailureAt,
    latest?.at,
    firstFailureAt,
  );
  const firstFailureMs = normalizeTimestampMs(firstFailureAt);
  const observedMs = normalizeTimestampMs(observedAt || latestFailureAt);
  const retryAfterMs = normalizeCounter(recoveryPlan.retry?.retryAfterMs);
  const retryReadyAtMs = recoveryPlan.retry?.retryable === true && firstFailureMs !== null
    ? firstFailureMs + retryAfterMs
    : null;
  const retryReady = recoveryPlan.retry?.retryable === true
    && (retryReadyAtMs === null || observedMs === null || observedMs >= retryReadyAtMs);
  const retryBlockedReasons = stableList([
    ...(recoveryPlan.retry?.retryable === true ? [] : ['incident_not_retryable']),
    ...(recoveryPlan.retry?.exhausted === true ? ['retry_attempts_exhausted'] : []),
    ...(retryReady ? [] : ['retry_backoff_active']),
  ]);
  const failureState = compactString(recoveryPlan.failureState || selectHealthFailureState(failedReasons, degradedReasons));
  const incidentKey = [
    compactString(status.requestId || 'mailchimp-status'),
    failureState || 'unknown',
    firstFailureAt || latestFailureAt || 'unobserved',
  ].join(':');
  const retryCommand = buildIncidentRetryCommand(status, recoveryPlan, incidentKey);
  const degradedMode = recoveryPlan.degradedMode || {};
  const degradedModeBlockedReasons = stableList([
    ...(degradedMode.allowed === true ? [] : ['degraded_mode_not_allowed']),
    ...(status.truthBoundary?.externalWritesAllowed === true ? ['external_write_truth_boundary'] : []),
    ...(status.externalHandoff?.writesExternalSystem === true ? ['external_handoff_writes_external_system'] : []),
    ...failedReasons,
  ]);
  const state = compactString(recoveryPlan.state || signals.state || 'healthy');
  const routeState = state === 'healthy'
    ? 'healthy'
    : retryReady
      ? 'retry_ready'
      : recoveryPlan.retry?.retryable === true
        ? 'cooldown'
        : degradedMode.allowed === true
          ? 'degraded_read_only'
          : 'manual_intervention';
  const nextAction = state === 'healthy'
    ? recoveryPlan.nextAction || 'observe'
    : routeState === 'retry_ready'
      ? retryCommand.command
      : routeState === 'cooldown'
        ? 'wait_for_retry_backoff'
        : routeState === 'degraded_read_only'
          ? 'continue_in_degraded_read_only_mode'
          : recoveryPlan.nextAction || 'inspect_status';

  return {
    protocol: 'aios.status-health-incident.mailchimp.v1',
    incidentKey,
    state,
    routeState,
    failureState,
    active: state !== 'healthy',
    firstFailureAt,
    latestFailureAt,
    observedAt,
    reason: allReasons[0] || 'healthy',
    reasons: allReasons,
    trigger: {
      eventIndex: incidentEvent ? normalizeCounter(incidentEvent.index) : null,
      eventState: compactString(incidentEvent?.state || state),
      eventCode: compactString(incidentEvent?.code),
      eventMessage: compactString(incidentEvent?.message),
    },
    retry: {
      ready: retryReady,
      retryable: recoveryPlan.retry?.retryable === true,
      attempts: normalizeCounter(recoveryPlan.retry?.attempts),
      maxAttempts: Math.max(1, normalizeCounter(recoveryPlan.retry?.maxAttempts) || 1),
      exhausted: recoveryPlan.retry?.exhausted === true,
      retryAfterMs,
      retryReadyAtMs,
      blockedReasons: retryBlockedReasons,
      command: retryCommand.command,
      idempotencyKey: retryCommand.idempotencyKey,
      retryKey: retryCommand.retryKey,
      replaySafe: retryCommand.replaySafe,
      restartSafe: retryCommand.restartSafe,
    },
    degradedMode: {
      allowed: degradedMode.allowed === true,
      mode: compactString(degradedMode.mode || 'normal'),
      suppressedExternalWrites: degradedMode.suppressedExternalWrites === true,
      blockedReasons: degradedMode.allowed === true ? [] : degradedModeBlockedReasons,
    },
    nextAction,
    blockedReasons: stableList([
      ...(routeState === 'manual_intervention' ? allReasons : []),
      ...(routeState === 'cooldown' ? retryBlockedReasons : []),
      ...(routeState === 'degraded_read_only' ? [] : degradedModeBlockedReasons.filter((reason) => reason !== 'degraded_mode_not_allowed')),
    ]),
    exportSummary: {
      exportReady: state === 'healthy' || retryReady || degradedMode.allowed === true,
      format: 'json',
      nextAction,
      blockedReasons: routeState === 'manual_intervention' ? allReasons : retryBlockedReasons,
      counters: {
        active: state !== 'healthy' ? 1 : 0,
        retryReady: retryReady ? 1 : 0,
        retryBlockedReasons: retryBlockedReasons.length,
        degradedModeAllowed: degradedMode.allowed === true ? 1 : 0,
        reasons: allReasons.length,
      },
    },
  };
}

function buildOperationalHealthContract(status) {
  const compileHealth = status.compileCache?.operationalHealth || {};
  const permissionHealth = status.permissionHealth || {};
  const tenantBoundaryHandoff = status.tenantBoundaryHandoff || status.readiness?.tenantBoundaryHandoff || {};
  const provider = status.providerContract || {};
  const providerServiceContract = status.providerServiceContract || {};
  const lifecycleControlState = status.lifecycleControlState || status.readiness?.lifecycleControls || {};
  const lifecycleSettingsPatch = status.lifecycleSettingsPatch || status.readiness?.lifecycleSettingsPatch || {};
  const diagnostics = Array.isArray(status.diagnostics) ? status.diagnostics : [];
  const warningCodes = diagnostics
    .filter((diagnostic) => diagnostic.severity === 'warning')
    .map((diagnostic) => compactString(diagnostic.code))
    .filter(Boolean)
    .sort();
  const errorCodes = diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => compactString(diagnostic.code))
    .filter(Boolean)
    .sort();
  const providerOffline = provider.serviceState === 'offline';
  const providerDegraded = provider.serviceState === 'degraded'
    || provider.sync?.ready === false
    || provider.sync?.stale === true
    || provider.capabilityNegotiation?.satisfied === false;
  const providerServiceBlocked = providerServiceContract.state === 'blocked';
  const providerServiceDegraded = providerServiceContract.state === 'degraded'
    || providerServiceContract.serviceNegotiation?.ready === false
    || providerServiceContract.sync?.ready === false
    || providerServiceContract.sync?.stale === true
    || providerServiceContract.capabilityNegotiation?.satisfied === false;
  const leaseBlocked = ['expired', 'missing_token'].includes(provider.lease?.state);
  const degradedReasons = [
    ...(permissionHealth.allowed === false ? ['tenant_boundary_blocked'] : []),
    ...(tenantBoundaryHandoff.ready === false ? ['tenant_boundary_handoff_blocked'] : []),
    ...stableList(tenantBoundaryHandoff.blockedReasons),
    ...(providerOffline ? ['provider_offline'] : []),
    ...(providerDegraded ? ['provider_degraded'] : []),
    ...(providerServiceBlocked ? ['provider_service_blocked'] : []),
    ...(providerServiceDegraded ? ['provider_service_degraded'] : []),
    ...stableList(providerServiceContract.blockedReasons),
    ...(leaseBlocked ? ['provider_lease_not_ready'] : []),
    ...(lifecycleControlState.ready === false ? ['lifecycle_controls_not_ready'] : []),
    ...stableList(lifecycleControlState.blockedReasons),
    ...(lifecycleSettingsPatch.ready === false ? ['lifecycle_settings_patch_not_ready'] : []),
    ...stableList(lifecycleSettingsPatch.blockedReasons),
    ...(compileHealth.degraded ? [`compile_cache_${compileHealth.failureState || 'degraded'}`] : []),
    ...warningCodes,
  ].sort();
  const failedReasons = [
    ...(status.state === 'failed' ? ['status_failed'] : []),
    ...(permissionHealth.actionableErrors || []).map((item) => compactString(item.code)),
    ...errorCodes,
    ...(compileHealth.actionableErrors || [])
      .filter((item) => item.severity === 'error')
      .map((item) => compactString(item.code)),
  ].sort();
  const state = failedReasons.length > 0
    ? 'failed'
    : providerOffline || leaseBlocked || degradedReasons.length > 0
      ? 'degraded'
      : 'healthy';
  const recoveryPlan = buildMailchimpStatusHealthRecoveryPlan(status, {
    state,
    failedReasons,
    degradedReasons,
    nextAction: compileHealth.nextAction
      || permissionHealth.nextAction
      || tenantBoundaryHandoff.nextAction
      || lifecycleControlState.nextAction
      || lifecycleSettingsPatch.nextAction
      || status.readiness?.nextStep
      || 'inspect_status',
  });
  const incident = buildMailchimpStatusHealthIncidentEnvelope(status, recoveryPlan, {
    state,
    failedReasons,
    degradedReasons,
  });

  return {
    protocol: 'aios.status-operational-health.mailchimp.v1',
    state,
    failureState: recoveryPlan.failureState,
    healthy: state === 'healthy',
    degraded: state === 'degraded',
    failed: state === 'failed',
    degradedMode: recoveryPlan.degradedMode,
    reasons: state === 'failed' ? failedReasons : degradedReasons,
    nextAction: state === 'healthy'
      ? status.readiness?.nextStep || 'observe'
      : recoveryPlan.nextAction
        || compileHealth.nextAction
        || permissionHealth.nextAction
        || tenantBoundaryHandoff.nextAction
        || (lifecycleSettingsPatch.ready === false ? lifecycleSettingsPatch.nextAction : null)
        || (lifecycleControlState.ready === false ? lifecycleControlState.nextAction : null)
        || (leaseBlocked ? 'refresh_provider_lease' : null)
        || (providerOffline ? 'wait_for_provider_online' : null)
        || status.readiness?.nextStep
        || 'inspect_status',
    retry: recoveryPlan.retry,
    incident,
    recoveryPlan,
    actionableErrors: dedupeActionableErrors([
      ...(compileHealth.actionableErrors || []),
      ...(permissionHealth.actionableErrors || []),
      ...failedReasons.map((code) => ({
        code,
        severity: 'error',
        action: status.readiness?.nextStep || 'inspect_status',
      })),
      ...degradedReasons.map((code) => ({
        code,
        severity: 'warning',
        action: lifecycleControlState.nextAction || compileHealth.nextAction || status.readiness?.nextStep || 'inspect_status',
      })),
      ...recoveryPlan.actionableErrors,
    ]),
  };
}

function normalizeProviderLease(descriptorContract = {}, runtime = {}) {
  const source = runtime.providerLease && typeof runtime.providerLease === 'object'
    ? runtime.providerLease
    : runtime.lease && typeof runtime.lease === 'object'
      ? runtime.lease
      : {};
  const compiledLease = descriptorContract.lease || {};
  const owner = compactString(source.owner || runtime.leaseOwner || compiledLease.owner);
  const token = compactString(source.token || runtime.leaseToken || compiledLease.token);
  const expiresAt = compactString(source.expiresAt || runtime.leaseExpiresAt || compiledLease.expiresAt);
  const observedState = compactString(source.state || runtime.leaseState || compiledLease.state || 'unknown')
    .toLowerCase()
    .replaceAll('-', '_');
  const state = token
    ? observedState === 'expired'
      ? 'expired'
      : 'held'
    : compiledLease.state === 'missing_token'
      ? 'missing_token'
      : 'not_required';

  return {
    owner,
    tokenPresent: Boolean(token),
    expiresAt,
    state,
    renewable: source.renewable !== false && compiledLease.renewable !== false,
    restartSafe: compiledLease.restartSafe !== false && (state === 'not_required' || Boolean(token)),
  };
}

function normalizeProviderReceipt(descriptor = {}, runtime = {}, providerContract = {}) {
  const descriptorReceipt = descriptor.providerReceipt && typeof descriptor.providerReceipt === 'object'
    ? descriptor.providerReceipt
    : descriptor.providerContract?.providerReceipt && typeof descriptor.providerContract.providerReceipt === 'object'
      ? descriptor.providerContract.providerReceipt
      : {};
  const runtimeReceipt = runtime.providerReceipt && typeof runtime.providerReceipt === 'object'
    ? runtime.providerReceipt
    : runtime.receipt && typeof runtime.receipt === 'object'
      ? runtime.receipt
      : {};
  const audit = runtimeReceipt.audit && typeof runtimeReceipt.audit === 'object'
    ? runtimeReceipt.audit
    : descriptorReceipt.audit && typeof descriptorReceipt.audit === 'object'
      ? descriptorReceipt.audit
      : {};
  const externalRequestId = compactString(
    runtimeReceipt.externalRequestId
      || runtime.providerRequestId
      || runtime.externalRequestId
      || descriptorReceipt.externalRequestId
      || providerContract.externalRequestId,
  );
  const state = compactString(
    runtimeReceipt.state
      || runtimeReceipt.status
      || descriptorReceipt.state
      || (runtimeReceipt.receiptId || descriptorReceipt.receiptId ? 'acknowledged' : 'missing'),
  ).toLowerCase().replaceAll('-', '_');
  const receiptId = compactString(runtimeReceipt.receiptId || runtimeReceipt.id || descriptorReceipt.receiptId);
  const acknowledgedAt = compactString(runtimeReceipt.acknowledgedAt || runtimeReceipt.ackAt || descriptorReceipt.acknowledgedAt);
  const acknowledged = (state === 'acknowledged' || descriptorReceipt.acknowledged === true)
    && Boolean(receiptId || acknowledgedAt);
  const tenant = compactString(runtimeReceipt.tenant || descriptorReceipt.tenant || descriptor.tenant);
  const workspace = compactString(
    runtimeReceipt.workspace
      || runtimeReceipt.workspaceId
      || descriptorReceipt.workspace
      || runtime.workspace
      || runtime.workspaceId,
  );
  const required = runtimeReceipt.required === true
    || descriptorReceipt.required === true
    || descriptor.providerContract?.externalHandoff?.receiptRequired === true;
  const failed = state === 'failed' || state === 'rejected';
  const blockedReasons = [
    ...(Array.isArray(descriptorReceipt.blockedReasons) ? descriptorReceipt.blockedReasons : []),
    ...(Array.isArray(runtimeReceipt.blockedReasons) ? runtimeReceipt.blockedReasons : []),
    ...(failed ? [`provider_receipt_${state}`] : []),
    ...(required && !acknowledged ? ['provider_receipt_ack_missing'] : []),
    ...(externalRequestId && runtimeReceipt.externalRequestId && descriptorReceipt.externalRequestId
      && runtimeReceipt.externalRequestId !== descriptorReceipt.externalRequestId
      ? ['provider_receipt_external_request_mismatch']
      : []),
  ].map(compactString).filter(Boolean).sort();

  return {
    protocol: 'aios.status-provider-receipt.mailchimp.v1',
    provider: compactString(runtimeReceipt.provider || descriptorReceipt.provider || providerContract.provider || 'mailchimp'),
    service: compactString(runtimeReceipt.service || descriptorReceipt.service || providerContract.service || 'mailchimp-marketing'),
    tenant,
    workspace,
    state: state || 'missing',
    receiptId,
    externalRequestId,
    idempotencyKey: compactString(runtimeReceipt.idempotencyKey || descriptorReceipt.idempotencyKey || descriptor.idempotencyKey),
    acknowledged,
    acknowledgedAt,
    required,
    restartSafe: acknowledged || (!required && !failed),
    syncCursor: compactString(runtimeReceipt.syncCursor || runtimeReceipt.cursor || descriptorReceipt.syncCursor || providerContract.sync?.cursor),
    artifactIds: stableList(runtimeReceipt.artifactIds || descriptorReceipt.artifactIds),
    blockedReasons,
    audit: {
      channel: compactString(audit.channel || 'status-provider-receipt'),
      decision: blockedReasons.length === 0 ? 'allow' : 'block',
      handoffKey: compactString(audit.handoffKey || `${tenant || 'unknown'}:${workspace || 'all'}:${externalRequestId || 'local'}`),
      externalWriteSuppressed: blockedReasons.length > 0,
    },
  };
}

function mergeProviderCapabilities(descriptorContract = {}, runtime = {}) {
  const compiledNegotiation = descriptorContract.capabilityNegotiation || {};
  const requested = new Set(Array.isArray(compiledNegotiation.requested) ? compiledNegotiation.requested : []);
  const advertised = new Set(Array.isArray(compiledNegotiation.advertised) ? compiledNegotiation.advertised : []);
  const runtimeAdvertised = Array.isArray(runtime.providerCapabilities)
    ? runtime.providerCapabilities.map(compactString).filter(Boolean)
    : [];

  for (const capability of runtimeAdvertised) advertised.add(capability);

  return {
    requested: [...requested].sort(),
    advertised: [...advertised].sort(),
  };
}

function buildReadinessContract(
  descriptor,
  providerContract,
  runtime = {},
  latest = null,
  externalHandoffState = null,
  providerServiceContract = null,
) {
  const lifecycle = descriptor.lifecycle || {};
  const permissionHealth = buildMailchimpAdapterPermissionHealth(descriptor, runtime);
  const tenantBoundaryHandoff = buildMailchimpTenantBoundaryHandoff(
    descriptor,
    runtime,
    permissionHealth,
    providerContract,
    externalHandoffState || {},
  );
  const tenantPermissionDecisionBundle = descriptor.tenantPermissionDecisionBundle
    || runtime.tenantPermissionDecisionBundle
    || buildMailchimpTenantPermissionDecisionBundle(descriptor, runtime);
  const diagnosticsSummary = summarizeDiagnostics(descriptor.diagnostics);
  const acceptance = normalizeAcceptance(runtime);
  const lifecycleControls = normalizeLifecycleControlState(descriptor, runtime);
  const lifecycleCommandState = buildMailchimpLifecycleCommandState(descriptor, runtime, lifecycleControls);
  const lifecycleSettingsPatch = buildMailchimpLifecycleSettingsPatchContract(
    descriptor,
    runtime,
    lifecycleControls,
    lifecycleCommandState,
  );
  const providerReady = providerContract.capabilityNegotiation.satisfied !== false
    && !providerContract.sync.stale
    && providerContract.serviceState !== 'offline'
    && !['expired', 'missing_token'].includes(providerContract.lease.state);
  const providerServiceReady = providerServiceContract
    ? providerServiceContract.state !== 'blocked'
      && providerServiceContract.serviceNegotiation?.ready !== false
      && providerServiceContract.sync?.ready !== false
      && providerServiceContract.externalHandoff?.restartSafe !== false
    : providerReady;
  const externalHandoffReady = externalHandoffState
    ? externalHandoffState.ready === true && externalHandoffState.restartSafe !== false
    : providerReady;
  const verifierNames = (descriptor.verifierContracts || []).map((contract) => contract.name).filter(Boolean);
  const missingVerifierEvidence = verifierNames.filter((name) => !runtime.verifierEvidence?.[name]);
  const acceptanceRequired = lifecycle.controls?.operatorHold === true
    || lifecycleControls.operatorHold === true
    || lifecycle.requestedCommand === 'dispatch'
    || lifecycleControls.requestedCommand === 'dispatch'
    || lifecycleCommandState.command === 'dispatch'
    || descriptor.truthBoundary?.externalWritesAllowed === true;
  const validation = [
    {
      code: 'mailchimp.readiness.tenant_boundary',
      ok: permissionHealth.allowed === true
        && tenantBoundaryHandoff.ready === true
        && tenantPermissionDecisionBundle.ready === true,
      severity: permissionHealth.allowed === true
        && tenantBoundaryHandoff.ready === true
        && tenantPermissionDecisionBundle.ready === true
        ? 'info'
        : 'error',
      message: permissionHealth.allowed === true
        && tenantBoundaryHandoff.ready === true
        && tenantPermissionDecisionBundle.ready === true
        ? 'Tenant and workspace boundary allows this Mailchimp handoff.'
        : 'Tenant or workspace boundary blocks this Mailchimp handoff.',
    },
    {
      code: 'mailchimp.readiness.descriptor_valid',
      ok: diagnosticsSummary.errors === 0,
      severity: diagnosticsSummary.errors === 0 ? 'info' : 'error',
      message: diagnosticsSummary.errors === 0
        ? 'Descriptor validation passed.'
        : 'Descriptor validation has blocking errors.',
    },
    {
      code: 'mailchimp.readiness.lifecycle_controls',
      ok: lifecycleControls.ready === true,
      severity: lifecycleControls.ready === true ? 'info' : 'warning',
      message: lifecycleControls.ready === true
        ? 'Lifecycle controls are enabled for the requested Mailchimp command.'
        : 'Lifecycle controls require operator, schedule, or enablement review.',
    },
    {
      code: 'mailchimp.readiness.lifecycle_dispatch',
      ok: lifecycleControls.dispatchEnabled === true || lifecycleControls.requestedCommand !== 'dispatch',
      severity: lifecycleControls.dispatchEnabled === true || lifecycleControls.requestedCommand !== 'dispatch' ? 'info' : 'warning',
      message: lifecycleControls.dispatchEnabled === true
        ? 'Lifecycle controls allow dispatch.'
        : 'Lifecycle controls are not ready to dispatch.',
    },
    {
      code: 'mailchimp.readiness.lifecycle_command',
      ok: lifecycleCommandState.ready === true,
      severity: lifecycleCommandState.ready === true ? 'info' : 'warning',
      message: lifecycleCommandState.ready === true
        ? 'Requested lifecycle command can be applied deterministically.'
        : 'Requested lifecycle command requires settings, schedule, or control repair.',
    },
    {
      code: 'mailchimp.readiness.lifecycle_settings_patch',
      ok: lifecycleSettingsPatch.ready === true,
      severity: lifecycleSettingsPatch.ready === true ? 'info' : 'warning',
      message: lifecycleSettingsPatch.ready === true
        ? 'Lifecycle settings patch is deterministic for the requested Mailchimp command.'
        : 'Lifecycle settings patch requires enablement, schedule, or write-control repair.',
    },
    {
      code: 'mailchimp.readiness.provider_contract',
      ok: providerReady && providerServiceReady,
      severity: providerReady && providerServiceReady ? 'info' : 'warning',
      message: providerReady && providerServiceReady
        ? 'Provider service contract is ready for the requested Mailchimp capability set.'
        : 'Provider service contract needs capability, resource, scope, sync, or service-state review.',
    },
    {
      code: 'mailchimp.readiness.provider_lease',
      ok: !['expired', 'missing_token'].includes(providerContract.lease.state),
      severity: !['expired', 'missing_token'].includes(providerContract.lease.state) ? 'info' : 'warning',
      message: !['expired', 'missing_token'].includes(providerContract.lease.state)
        ? 'Provider handoff lease is restart-safe for the current request.'
        : 'Provider handoff lease needs to be refreshed before dispatch or resume.',
    },
    {
      code: 'mailchimp.readiness.external_handoff',
      ok: externalHandoffReady,
      severity: externalHandoffReady ? 'info' : 'warning',
      message: externalHandoffReady
        ? 'External handoff state is synchronized and restart-safe.'
        : 'External handoff state needs sync, receipt, lease, or capability review.',
    },
    {
      code: 'mailchimp.readiness.verifier_evidence',
      ok: missingVerifierEvidence.length === 0,
      severity: missingVerifierEvidence.length === 0 ? 'info' : 'warning',
      message: missingVerifierEvidence.length === 0
        ? 'Required verifier evidence is present.'
        : 'Required verifier evidence is missing.',
    },
    {
      code: 'mailchimp.readiness.operator_acceptance',
      ok: !acceptanceRequired || acceptance.accepted,
      severity: !acceptanceRequired || acceptance.accepted ? 'info' : 'warning',
      message: !acceptanceRequired || acceptance.accepted
        ? 'Operator acceptance state is satisfied.'
        : 'Operator acceptance is required before handoff dispatch.',
    },
  ];
  const blocking = validation.filter((item) => item.severity === 'error' && item.ok === false);
  const warnings = validation.filter((item) => item.severity === 'warning' && item.ok === false);
  const ready = blocking.length === 0 && warnings.length === 0;
  const nextStep = ready
    ? lifecycle.nextAction || 'queue'
    : diagnosticsSummary.errors > 0
      ? 'repair_descriptor'
    : tenantBoundaryHandoff.ready === false
      ? tenantBoundaryHandoff.nextAction
    : tenantPermissionDecisionBundle.ready === false
      ? tenantPermissionDecisionBundle.nextAction
    : blocking.length > 0
      ? 'repair_descriptor'
    : missingVerifierEvidence.length > 0
      ? 'collect_verifier_evidence'
      : lifecycleCommandState.ready === false
        ? lifecycleCommandState.nextAction
      : lifecycleSettingsPatch.ready === false
        ? lifecycleSettingsPatch.nextAction
      : lifecycleControls.ready === false
        ? lifecycleControls.nextAction
      : externalHandoffState && externalHandoffReady === false
        ? externalHandoffState.nextAction || 'inspect_external_handoff'
      : providerServiceReady === false && providerServiceContract?.nextAction
        ? providerServiceContract.nextAction
      : !providerReady
        ? ['expired', 'missing_token'].includes(providerContract.lease.state)
            ? 'refresh_provider_lease'
            : 'refresh_provider_contract'
          : !acceptance.accepted && acceptanceRequired
            ? 'request_operator_acceptance'
            : lifecycle.nextAction || 'review_lifecycle_controls';

  return {
    ready,
    nextStep,
    validationSummary: {
      total: validation.length,
      blocking: blocking.length,
      warnings: warnings.length,
      diagnostics: diagnosticsSummary,
    },
    validation,
    acceptance: {
      required: acceptanceRequired,
      ready: !acceptanceRequired || acceptance.accepted,
      accepted: acceptance.accepted,
      acceptedBy: acceptance.acceptedBy,
      acceptedAt: acceptance.acceptedAt,
      reason: acceptance.reason,
    },
    permissionBoundary: permissionHealth,
    tenantBoundaryHandoff,
    tenantPermissionDecisionBundle,
    preview: {
      title: `Mailchimp ${descriptor.action || 'handoff'} for ${descriptor.tenant || 'unknown tenant'}`,
      requestId: descriptor.requestId,
      action: descriptor.action,
      tenant: descriptor.tenant,
      dryRun: descriptor.dryRun === true,
      lifecycleCommand: lifecycle.requestedCommand || 'queue',
      lifecycleCommandState: lifecycleCommandState.state,
      lifecycleCommandAuditKey: lifecycleCommandState.audit.commandKey,
      lifecycleCommandEffects: lifecycleCommandState.effects.list,
      lifecycleSettingsPatchState: lifecycleSettingsPatch.state,
      lifecycleSettingsPatchNextAction: lifecycleSettingsPatch.nextAction,
      lifecycleSettingsPatchChangedFields: lifecycleSettingsPatch.changedFields,
      lifecycleNextAction: lifecycleControls.nextAction || lifecycle.nextAction || nextStep,
      lifecycleControlsReady: lifecycleControls.ready,
      lifecycleControlBlockedReasons: lifecycleControls.blockedReasons,
      scheduleMode: lifecycleControls.schedule.mode,
      scheduleNextRunAt: lifecycleControls.schedule.nextRunAt,
      scheduleWindowOpen: lifecycleControls.schedule.windowOpen,
      externalWrite: descriptor.truthBoundary?.externalWritesAllowed === true,
      permissionState: permissionHealth.state,
      permissionDecisionStatus: tenantPermissionDecisionBundle.status,
      permissionDecisionKey: tenantPermissionDecisionBundle.decisionKey,
      permissionDecisionReady: tenantPermissionDecisionBundle.ready === true,
      permissionDecisionNextAction: tenantPermissionDecisionBundle.nextAction,
      permissionDecisionBlockedReasons: stableList(tenantPermissionDecisionBundle.blockedReasons),
      boundaryAuditDecision: tenantBoundaryHandoff.audit.decision,
      boundaryAuditKey: tenantBoundaryHandoff.audit.handoffKey,
      boundaryNextAction: tenantBoundaryHandoff.nextAction,
      providerState: providerContract.serviceState,
      providerHandoffState: providerContract.externalHandoffState,
      providerHandoffReady: externalHandoffReady,
      providerHandoffNextAction: externalHandoffState?.nextAction || null,
      providerServiceState: providerServiceContract?.state || null,
      providerServiceNextAction: providerServiceContract?.nextAction || null,
      providerServiceBlockedReasons: stableList(providerServiceContract?.blockedReasons),
      providerLeaseState: providerContract.lease.state,
      syncCursor: providerContract.sync.cursor,
      syncCursorRequired: externalHandoffState?.syncMetadata?.cursorRequired === true,
      receiptRequired: externalHandoffState?.receipt?.required === true,
      receiptAcknowledged: externalHandoffState?.receipt?.acknowledged === true,
      latestEventCode: latest?.code || null,
      latestEventMessage: latest?.message || null,
    },
    lifecycleControls,
    lifecycleCommandState,
    lifecycleSettingsPatch,
  };
}

function buildMailchimpPreviewRouteDecision({
  status = {},
  routeState = 'needs_attention',
  ready = false,
  nextAction = 'observe',
  normalizedItems = [],
  blockingItems = [],
  warningItems = [],
  blockedReasons = [],
  acceptanceRequired = false,
  acceptanceAccepted = false,
  acceptanceToken = '',
  readinessPreview = {},
  compileCache = {},
  lifecycleCommandState = {},
  lifecycleControls = {},
  lifecycleSettingsPatch = {},
  tenantBoundaryHandoff = {},
  externalHandoff = {},
  clientCommand = {},
} = {}) {
  const totalItems = normalizeCounter(normalizedItems.length);
  const readyItems = normalizedItems.filter((item) => item.ready === true);
  const visibleItems = normalizedItems.filter((item) => item.visibleToOperator === true || item.blocking === true);
  const ownerCounts = normalizedItems.reduce((accumulator, item) => {
    const owner = compactString(item.owner || 'runtime') || 'runtime';
    accumulator[owner] = normalizeCounter(accumulator[owner]) + 1;
    return accumulator;
  }, {});
  const blockedOwnerCounts = blockingItems.reduce((accumulator, item) => {
    const owner = compactString(item.owner || 'runtime') || 'runtime';
    accumulator[owner] = normalizeCounter(accumulator[owner]) + 1;
    return accumulator;
  }, {});
  const readinessPercent = totalItems === 0
    ? 100
    : Math.round((readyItems.length / totalItems) * 100);
  const routeBlocked = routeState === 'blocked';
  const routeComplete = ready === true && (acceptanceRequired !== true || acceptanceAccepted === true);
  const acceptanceOnlyBlocked = blockingItems.length > 0
    && blockingItems.every((item) => item.key === 'operator_acceptance');
  const canAccept = acceptanceRequired === true
    && acceptanceAccepted !== true
    && Boolean(acceptanceToken || clientCommand.acceptanceToken)
    && (acceptanceOnlyBlocked || blockedReasons.every((reason) => reason === 'operator_acceptance_required'));
  const primaryBlockingItem = blockingItems[0] || null;
  const primaryOwner = compactString(primaryBlockingItem?.owner || (canAccept ? 'operator' : 'runtime'));
  const primaryReason = compactString(
    primaryBlockingItem?.blockedReasons?.[0]
      || (canAccept ? 'operator_acceptance_required' : blockedReasons[0])
      || (ready ? 'preview_acceptance_ready' : 'preview_acceptance_not_ready'),
  );
  const primaryAction = compactString(
    canAccept
      ? 'accept_preview_handoff'
      : primaryBlockingItem?.nextAction
        || nextAction
        || 'observe',
  );
  const secondarySteps = blockingItems
    .slice(primaryBlockingItem ? 1 : 0)
    .map((item) => ({
      itemId: item.itemId,
      key: item.key,
      owner: item.owner,
      action: compactString(item.nextAction || 'inspect_status'),
      reason: compactString(item.blockedReasons[0] || `${item.key}_not_ready`),
      label: compactString(item.label),
      blocking: true,
    }));
  const nonBlockingVisibleSteps = visibleItems
    .filter((item) => item.blocking !== true)
    .map((item) => ({
      itemId: item.itemId,
      key: item.key,
      owner: item.owner,
      action: compactString(item.nextAction || 'observe'),
      reason: 'visible_for_review',
      label: compactString(item.label),
      blocking: false,
    }));
  const recommendedSteps = [
    {
      itemId: primaryBlockingItem?.itemId || (ready ? 'mailchimp.preview_acceptance.ready' : 'mailchimp.preview_acceptance.primary'),
      key: primaryBlockingItem?.key || (ready ? 'ready' : 'primary'),
      owner: primaryOwner,
      action: primaryAction,
      reason: primaryReason,
      label: compactString(primaryBlockingItem?.label || (ready ? 'Ready' : 'Primary action')),
      blocking: primaryBlockingItem?.blocking === true || canAccept,
    },
    ...secondarySteps,
    ...(!ready ? nonBlockingVisibleSteps.slice(0, Math.max(0, 5 - secondarySteps.length)) : []),
  ].filter((step, index, steps) => (
    step.action
      && steps.findIndex((candidate) => `${candidate.key}:${candidate.action}:${candidate.reason}` === `${step.key}:${step.action}:${step.reason}`) === index
  ));
  const explainers = stableList([
    ...blockedReasons,
    ...(routeBlocked ? ['route_blocked'] : []),
    ...(canAccept ? ['acceptance_can_be_submitted'] : []),
    ...(compileCache.stale === true ? ['compile_cache_stale'] : []),
    ...(lifecycleControls.ready === false ? ['lifecycle_controls_not_ready'] : []),
    ...(lifecycleCommandState.ready === false ? ['lifecycle_command_not_ready'] : []),
    ...(lifecycleSettingsPatch.ready === false ? ['lifecycle_settings_patch_not_ready'] : []),
    ...(tenantBoundaryHandoff.ready === false ? ['tenant_boundary_handoff_not_ready'] : []),
    ...(externalHandoff.restartSafe === false ? ['external_handoff_not_restart_safe'] : []),
  ]);

  return {
    protocol: 'aios.status-preview-route-decision.mailchimp.v1',
    requestId: compactString(status.requestId || readinessPreview.requestId),
    state: routeState,
    ready,
    readinessScore: {
      percent: readinessPercent,
      readyItems: readyItems.length,
      totalItems,
      blockingItems: blockingItems.length,
      warningItems: warningItems.length,
      visibleItems: visibleItems.length,
    },
    primary: {
      owner: primaryOwner,
      action: primaryAction,
      reason: primaryReason,
      itemId: compactString(primaryBlockingItem?.itemId),
      blocked: primaryBlockingItem?.blocking === true || routeBlocked || canAccept,
    },
    acceptanceGate: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      canAccept,
      token: compactString(acceptanceToken || clientCommand.acceptanceToken),
      submitAction: canAccept ? 'accept_preview_handoff' : acceptanceAccepted ? 'observe' : 'request_operator_acceptance',
      blockedByNonAcceptanceItems: blockingItems.some((item) => item.key !== 'operator_acceptance'),
    },
    routeHints: {
      statusRouteState: ready ? 'ready' : routeState,
      primaryAction,
      fallbackAction: compactString(nextAction || 'inspect_status'),
      recoveryCommand: primaryAction === 'accept_preview_handoff'
        ? compactString(nextAction || clientCommand.submitAction || 'queue')
        : primaryAction,
      explainable: true,
      complete: routeComplete,
    },
    explainability: {
      reasons: explainers,
      primaryReason,
      blockedOwners: blockedOwnerCounts,
      owners: ownerCounts,
    },
    nextSteps: recommendedSteps,
  };
}

export function buildMailchimpStatusPreviewAcceptanceContract(status = {}) {
  const readiness = status.readiness || {};
  const readinessPreview = readiness.preview || status.ui?.preview || {};
  const lifecycleControls = status.lifecycleControlState || readiness.lifecycleControls || {};
  const lifecycleCommandState = status.lifecycleCommandState
    || readiness.lifecycleCommandState
    || status.ui?.lifecycleCommandState
    || {};
  const lifecycleSettingsPatch = status.lifecycleSettingsPatch
    || readiness.lifecycleSettingsPatch
    || status.ui?.lifecycleSettingsPatch
    || {};
  const tenantBoundaryHandoff = status.tenantBoundaryHandoff || readiness.tenantBoundaryHandoff || {};
  const externalHandoff = status.externalHandoff || {};
  const providerServiceContract = status.providerServiceContract || {};
  const compileCache = status.compileCache || {};
  const compileChecklist = status.compileCacheAcceptanceChecklist
    || compileCache.uiHandoff?.acceptanceChecklist
    || {};
  const clientCommand = status.clientCommand || {};
  const acceptance = readiness.acceptance || status.ui?.acceptance || {};
  const compileAcceptance = compileChecklist.acceptance || compileCache.uiHandoff?.acceptance || {};
  const compilePreview = compileCache.uiHandoff?.preview || status.ui?.compileCache?.preview || {};
  const latestEventCode = compactString(status.progress?.latestCode || readinessPreview.latestEventCode);
  const latestEventMessage = compactString(status.progress?.latestMessage || readinessPreview.latestEventMessage);
  const acceptanceRequired = acceptance.required === true || compileAcceptance.required === true;
  const acceptanceAccepted = (acceptance.required !== true || acceptance.accepted === true)
    && (compileAcceptance.required !== true || compileAcceptance.accepted === true);
  const previewVisible = Boolean(readinessPreview.title || readinessPreview.requestId || compilePreview.title);
  const validationItems = [
    {
      key: 'runtime_readiness',
      label: 'Runtime readiness',
      ready: readiness.ready === true,
      owner: 'runtime',
      nextAction: compactString(readiness.nextStep || 'inspect_status'),
      blockedReasons: readiness.ready === true ? [] : ['runtime_readiness_not_ready'],
      visibleToOperator: true,
    },
    {
      key: 'preview_contract',
      label: 'Operator preview',
      ready: previewVisible,
      owner: 'ui',
      nextAction: previewVisible ? 'review_preview' : 'render_status_preview',
      blockedReasons: previewVisible ? [] : ['preview_missing'],
      visibleToOperator: true,
    },
    {
      key: 'operator_acceptance',
      label: 'Operator acceptance',
      ready: !acceptanceRequired || acceptanceAccepted,
      owner: 'operator',
      nextAction: !acceptanceRequired || acceptanceAccepted ? 'observe' : 'request_operator_acceptance',
      blockedReasons: !acceptanceRequired || acceptanceAccepted ? [] : ['operator_acceptance_required'],
      visibleToOperator: acceptanceRequired,
    },
    {
      key: 'lifecycle_controls',
      label: 'Lifecycle controls',
      ready: lifecycleControls.ready !== false,
      owner: 'runtime',
      nextAction: compactString(lifecycleControls.nextAction || readiness.nextStep || 'review_lifecycle_controls'),
      blockedReasons: stableList(lifecycleControls.blockedReasons),
      visibleToOperator: lifecycleControls.ready === false,
    },
    {
      key: 'lifecycle_command',
      label: 'Lifecycle command',
      ready: lifecycleCommandState.ready !== false,
      owner: 'runtime',
      nextAction: compactString(lifecycleCommandState.nextAction || readiness.nextStep || 'review_lifecycle_command'),
      blockedReasons: stableList(lifecycleCommandState.blockedReasons),
      visibleToOperator: lifecycleCommandState.ready === false,
    },
    {
      key: 'lifecycle_settings_patch',
      label: 'Lifecycle settings',
      ready: lifecycleSettingsPatch.ready !== false,
      owner: 'runtime',
      nextAction: compactString(lifecycleSettingsPatch.nextAction || readiness.nextStep || 'review_lifecycle_settings_patch'),
      blockedReasons: stableList(lifecycleSettingsPatch.blockedReasons),
      visibleToOperator: lifecycleSettingsPatch.ready === false || lifecycleSettingsPatch.appliesSettings === true,
    },
    {
      key: 'tenant_boundary_handoff',
      label: 'Tenant boundary',
      ready: tenantBoundaryHandoff.ready !== false,
      owner: 'runtime',
      nextAction: compactString(tenantBoundaryHandoff.nextAction || readiness.nextStep || 'inspect_permission_boundary'),
      blockedReasons: stableList(tenantBoundaryHandoff.blockedReasons),
      visibleToOperator: tenantBoundaryHandoff.ready === false,
    },
    {
      key: 'external_handoff',
      label: 'External handoff',
      ready: externalHandoff.ready !== false && externalHandoff.restartSafe !== false,
      owner: 'provider',
      nextAction: compactString(externalHandoff.nextAction || providerServiceContract.nextAction || 'inspect_external_handoff'),
      blockedReasons: stableList(externalHandoff.blockedReasons),
      visibleToOperator: externalHandoff.ready === false || externalHandoff.restartSafe === false,
    },
    {
      key: 'compile_cache_acceptance',
      label: 'Compile cache acceptance',
      ready: compileChecklist.ready !== false,
      owner: 'compiler',
      nextAction: compactString(compileChecklist.nextAction || compileCache.nextAction || 'review_compile_cache_status'),
      blockedReasons: stableList([
        ...(compileChecklist.blockedReasons || []),
        ...(compileChecklist.blockingItems || []).flatMap((item) => item.blockedReasons || []),
      ]),
      visibleToOperator: compileChecklist.ready === false
        || compileAcceptance.required === true,
    },
    {
      key: 'client_command',
      label: 'Client command',
      ready: clientCommand.validationSummary?.ready !== false
        && !['blocked', 'acceptance_required'].includes(clientCommand.state),
      owner: 'client',
      nextAction: compactString(clientCommand.submitAction || readiness.nextStep || 'inspect_status'),
      blockedReasons: stableList(clientCommand.validationSummary?.blockedReasons),
      visibleToOperator: ['blocked', 'acceptance_required'].includes(clientCommand.state),
    },
  ];
  const normalizedItems = validationItems.map((item, index) => ({
    index: index + 1,
    itemId: `mailchimp.preview_acceptance.${item.key}`,
    key: item.key,
    label: item.label,
    ready: item.ready === true,
    blocking: item.ready !== true,
    owner: item.owner,
    nextAction: item.nextAction,
    blockedReasons: stableList(item.blockedReasons),
    visibleToOperator: item.visibleToOperator === true,
  }));
  const blockingItems = normalizedItems.filter((item) => item.blocking);
  const warningItems = normalizedItems.filter((item) => item.visibleToOperator && !item.blocking);
  const blockedReasons = stableList(blockingItems.flatMap((item) => item.blockedReasons.length > 0
    ? item.blockedReasons
    : [`${item.key}_not_ready`]));
  const primaryBlockingItem = blockingItems[0] || null;
  const nextAction = primaryBlockingItem?.nextAction
    || clientCommand.submitAction
    || readiness.nextStep
    || compileCache.nextAction
    || 'observe';
  const ready = blockingItems.length === 0;
  const routeState = ready
    ? acceptanceRequired && !acceptanceAccepted
      ? 'acceptance_required'
      : 'ready'
    : blockedReasons.some((reason) => reason.includes('boundary') || reason.includes('provider_offline'))
      ? 'blocked'
      : 'needs_attention';
  const routeDecision = buildMailchimpPreviewRouteDecision({
    status,
    routeState,
    ready,
    nextAction,
    normalizedItems,
    blockingItems,
    warningItems,
    blockedReasons,
    acceptanceRequired,
    acceptanceAccepted,
    acceptanceToken: compactString(compileAcceptance.token || clientCommand.acceptanceToken),
    readinessPreview,
    compileCache,
    lifecycleCommandState,
    lifecycleControls,
    lifecycleSettingsPatch,
    tenantBoundaryHandoff,
    externalHandoff,
    clientCommand,
  });

  return {
    protocol: 'aios.status-preview-acceptance.mailchimp.v1',
    requestId: compactString(status.requestId || readinessPreview.requestId),
    adapter: compactString(status.adapter || 'mailchimp'),
    title: compactString(readinessPreview.title || compilePreview.title || `Mailchimp ${status.action || 'handoff'}`),
    ready,
    route: {
      state: routeState,
      primaryAction: routeDecision.routeHints.primaryAction,
      fallbackAction: routeDecision.routeHints.fallbackAction,
      recoveryCommand: routeDecision.routeHints.recoveryCommand,
      explainable: true,
      acceptanceToken: compactString(compileAcceptance.token || clientCommand.acceptanceToken),
      statusRouteState: ready ? 'ready' : routeState,
    },
    preview: {
      visible: previewVisible,
      action: compactString(readinessPreview.action || status.action),
      tenant: compactString(readinessPreview.tenant || status.tenant),
      dryRun: readinessPreview.dryRun === true || status.dryRun === true,
      externalWrite: readinessPreview.externalWrite === true
        || status.truthBoundary?.externalWritesAllowed === true,
      latestEventCode,
      latestEventMessage,
      lifecycleCommand: compactString(readinessPreview.lifecycleCommand || lifecycleControls.requestedCommand || 'queue'),
      lifecycleCommandState: compactString(readinessPreview.lifecycleCommandState || lifecycleCommandState.state),
      lifecycleCommandAuditKey: compactString(readinessPreview.lifecycleCommandAuditKey || lifecycleCommandState.audit?.commandKey),
      lifecycleNextAction: compactString(readinessPreview.lifecycleNextAction || lifecycleControls.nextAction || nextAction),
      providerState: compactString(readinessPreview.providerState || status.providerContract?.serviceState || 'unknown'),
      providerHandoffState: compactString(readinessPreview.providerHandoffState || externalHandoff.state || 'local_only'),
      boundaryAuditDecision: compactString(readinessPreview.boundaryAuditDecision || tenantBoundaryHandoff.audit?.decision),
      boundaryAuditKey: compactString(readinessPreview.boundaryAuditKey || tenantBoundaryHandoff.audit?.handoffKey),
      compileCacheStatus: compactString(compileCache.status || 'uncached'),
      compileCacheStale: compileCache.stale === true,
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      runtimeAccepted: acceptance.accepted === true,
      compileCacheAccepted: compileAcceptance.required !== true || compileAcceptance.accepted === true,
      acceptedBy: compactString(acceptance.acceptedBy || compileAcceptance.acceptedBy),
      acceptedAt: compactString(acceptance.acceptedAt || compileAcceptance.acceptedAt),
      reason: compactString(acceptance.reason),
      canAccept: routeDecision.acceptanceGate.canAccept,
      token: compactString(compileAcceptance.token || clientCommand.acceptanceToken),
      requiredBecause: stableList([
        ...(acceptance.required ? ['runtime_acceptance_required'] : []),
        ...(compileAcceptance.required ? ['compile_cache_acceptance_required'] : []),
        ...(status.truthBoundary?.externalWritesAllowed === true ? ['external_write_handoff'] : []),
        ...(tenantBoundaryHandoff.ready === false ? ['tenant_boundary_handoff_required'] : []),
      ]),
    },
    validationSummary: {
      ready,
      total: normalizedItems.length,
      blocking: blockingItems.length,
      warnings: warningItems.length,
      blockedReasons,
      nextAction: compactString(nextAction),
      readinessPercent: routeDecision.readinessScore.percent,
      primaryReason: routeDecision.primary.reason,
    },
    items: normalizedItems,
    blockingItems,
    routeDecision,
    readinessScore: routeDecision.readinessScore,
    nextSteps: routeDecision.nextSteps.map((step) => ({
        itemId: step.itemId,
        owner: step.owner,
        action: step.action,
        reason: step.reason,
        label: step.label,
        blocking: step.blocking,
      })),
    blockedReasons,
  };
}

export function buildMailchimpClientRuntimeAdoptionContract(status = {}, workflow = {}) {
  const clientRuntimeState = status.clientRuntimeState || status.ui?.clientRuntimeState || {};
  const previewAcceptance = status.previewAcceptance || status.ui?.previewAcceptance || {};
  const persistedRecovery = status.persistedRecovery || status.ui?.persistedRecovery || {};
  const clientCommand = status.clientCommand || status.ui?.clientCommand || {};
  const lifecycleCommandState = status.lifecycleCommandState || status.readiness?.lifecycleCommandState || {};
  const lifecycleSettingsPatch = status.lifecycleSettingsPatch || status.readiness?.lifecycleSettingsPatch || {};
  const tenantBoundaryHandoff = status.tenantBoundaryHandoff || status.readiness?.tenantBoundaryHandoff || {};
  const externalHandoff = status.externalHandoff || {};
  const compileCache = status.compileCache || {};
  const workflowItems = Array.isArray(workflow.items) ? workflow.items : [];
  const routeState = compactString(workflow.state || workflow.routeState || 'needs_attention');
  const requestedCommand = normalizeClientRequestMode(
    clientRuntimeState.command
      || clientCommand.command
      || clientCommand.submitAction
      || lifecycleCommandState.command
      || workflow.recoveryCommand,
  );
  const acceptanceRequired = previewAcceptance.acceptance?.required === true
    || workflow.acceptanceRequired === true;
  const acceptanceAccepted = acceptanceRequired !== true
    || previewAcceptance.acceptance?.accepted === true
    || workflow.acceptanceAccepted === true;
  const clientStateProvided = clientRuntimeState.provided === true;
  const hydrated = clientStateProvided ? clientRuntimeState.form?.hydrated === true : true;
  const stale = clientStateProvided && clientRuntimeState.form?.stale === true;
  const dirty = clientStateProvided && clientRuntimeState.form?.dirty === true;
  const offline = clientStateProvided && clientRuntimeState.form?.offline === true;
  const readOnly = clientStateProvided && clientRuntimeState.form?.readOnly === true;
  const revisionMismatch = clientStateProvided && clientRuntimeState.continuity?.revisionMismatch === true;
  const replayRequested = clientStateProvided && clientRuntimeState.continuity?.replayRequested === true;
  const persistedReady = persistedRecovery.ready !== false && persistedRecovery.restartSafe !== false;
  const replaySafe = persistedRecovery.replaySafe === true
    || compileCache.persistedReplaySummary?.replaySafe === true
    || compileCache.replayBarrier?.open === true;
  const boundaryReady = tenantBoundaryHandoff.ready !== false;
  const externalReady = externalHandoff.ready !== false && externalHandoff.restartSafe !== false;
  const commandReady = clientCommand.validationSummary?.ready !== false
    && !['blocked', 'acceptance_required'].includes(clientCommand.state);
  const blockedWorkflowItems = workflowItems.filter((item) => item.blocking === true);
  const blockedReasons = stableList([
    ...stableList(workflow.blockedReasons),
    ...blockedWorkflowItems.map((item) => item.reason),
    ...(offline ? ['client_offline'] : []),
    ...(readOnly && ['submit_client_command', 'accept_preview_handoff'].includes(requestedCommand)
      ? ['client_read_only']
      : []),
    ...(dirty && requestedCommand === 'resume_status_handoff' ? ['client_form_dirty_before_resume'] : []),
    ...(stale ? ['client_state_stale'] : []),
    ...(!hydrated ? ['client_state_not_hydrated'] : []),
    ...(revisionMismatch ? ['client_revision_mismatch'] : []),
    ...(acceptanceRequired && !acceptanceAccepted ? ['operator_acceptance_required'] : []),
    ...(!persistedReady && replayRequested ? ['persisted_recovery_not_ready'] : []),
    ...(replayRequested && !replaySafe ? ['client_replay_not_safe'] : []),
    ...(!boundaryReady ? ['tenant_boundary_handoff_not_ready'] : []),
    ...(!externalReady ? ['external_handoff_not_ready'] : []),
    ...(!commandReady ? ['client_command_not_ready'] : []),
    ...(lifecycleSettingsPatch.ready === false ? ['lifecycle_settings_patch_not_ready'] : []),
    ...stableList(lifecycleSettingsPatch.blockedReasons),
  ]);
  const canHydrate = !hydrated || stale || revisionMismatch;
  const canAccept = acceptanceRequired && !acceptanceAccepted
    && !offline
    && !readOnly
    && Boolean(previewAcceptance.acceptance?.token || clientRuntimeState.continuity?.acceptanceToken);
  const canResume = replayRequested
    && persistedReady
    && replaySafe
    && !offline
    && !dirty
    && boundaryReady
    && externalReady;
  const canSubmit = blockedReasons.length === 0
    && commandReady
    && boundaryReady
    && externalReady
    && !readOnly
    && !offline
    && acceptanceAccepted;
  const adoptionState = canSubmit
    ? 'adopted'
    : canAccept
      ? 'acceptance_required'
      : canResume
        ? 'resume_ready'
        : canHydrate
          ? 'hydrate_required'
          : blockedReasons.length > 0
            ? 'blocked'
            : 'review';
  const visibleAction = adoptionState === 'adopted'
    ? 'submit_client_command'
    : adoptionState === 'acceptance_required'
      ? 'accept_preview_handoff'
      : adoptionState === 'resume_ready'
        ? 'resume_status_handoff'
        : adoptionState === 'hydrate_required'
          ? 'hydrate_client_status_state'
          : workflow.primaryAction || workflow.recoveryCommand || 'inspect_status';
  const payloadBlockedReasons = stableList([
    ...blockedReasons,
    ...(canSubmit ? [] : ['client_payload_not_submittable']),
  ]);

  return {
    protocol: 'aios.client-runtime-adoption.mailchimp.v1',
    requestId: compactString(clientRuntimeState.requestId || status.requestId),
    state: adoptionState,
    ready: canSubmit,
    routeState,
    visibleAction,
    requestedCommand,
    blockedReasons,
    client: {
      provided: clientStateProvided,
      channel: compactString(clientRuntimeState.channel || 'web'),
      sessionId: compactString(clientRuntimeState.sessionId),
      actorId: compactString(clientRuntimeState.actorId),
      route: clientRuntimeState.route || {},
      form: clientRuntimeState.form || {},
    },
    adoption: {
      canHydrate,
      canAccept,
      canResume,
      canSubmit,
      hydrated,
      stale,
      dirty,
      offline,
      readOnly,
      revisionMismatch,
      replayRequested,
      acceptanceRequired,
      acceptanceAccepted,
    },
    payload: {
      ready: canSubmit,
      command: canSubmit ? requestedCommand : visibleAction,
      submitAction: visibleAction,
      idempotencyKey: compactString(
        clientRuntimeState.continuity?.idempotencyKey
          || clientCommand.idempotencyKey
          || compileCache.persistedReplaySummary?.idempotencyKey,
      ),
      resumeToken: compactString(
        clientRuntimeState.continuity?.resumeToken
          || clientCommand.resumeToken
          || compileCache.resumeGate?.resumeToken,
      ),
      acceptanceToken: compactString(
        clientRuntimeState.continuity?.acceptanceToken
          || previewAcceptance.acceptance?.token
          || previewAcceptance.route?.acceptanceToken,
      ),
      requestKey: compactString(clientRuntimeState.continuity?.requestKey),
      externalRequestId: compactString(externalHandoff.requestId),
      boundaryAuditKey: compactString(tenantBoundaryHandoff.audit?.handoffKey),
      blockedReasons: payloadBlockedReasons,
    },
    handoff: {
      persistedReady,
      replaySafe,
      boundaryReady,
      externalReady,
      commandReady,
      nextBlockingItem: blockedWorkflowItems[0] || null,
      workflowBlockingItems: blockedWorkflowItems.length,
      lifecycleCommandKey: compactString(lifecycleCommandState.audit?.commandKey),
      lifecycleSettingsPatchKey: compactString(lifecycleSettingsPatch.audit?.patchKey),
      recoveryCommand: compactString(workflow.recoveryCommand || visibleAction),
    },
    exportSummary: {
      exportReady: canSubmit,
      format: 'json',
      nextAction: visibleAction,
      blockedReasons,
      counters: {
        blockedReasons: blockedReasons.length,
        workflowBlockingItems: blockedWorkflowItems.length,
        canHydrate: canHydrate ? 1 : 0,
        canAccept: canAccept ? 1 : 0,
        canResume: canResume ? 1 : 0,
        canSubmit: canSubmit ? 1 : 0,
      },
    },
  };
}

export function buildMailchimpClientWorkflowHandoff(status = {}) {
  const readiness = status.readiness || {};
  const previewAcceptance = status.previewAcceptance || status.ui?.previewAcceptance || {};
  const clientCommand = status.clientCommand || status.ui?.clientCommand || {};
  const clientRuntimeState = status.clientRuntimeState || status.ui?.clientRuntimeState || {};
  const lifecycleControlState = status.lifecycleControlState || readiness.lifecycleControls || {};
  const lifecycleCommandState = status.lifecycleCommandState
    || readiness.lifecycleCommandState
    || status.ui?.lifecycleCommandState
    || {};
  const tenantBoundaryHandoff = status.tenantBoundaryHandoff || readiness.tenantBoundaryHandoff || {};
  const externalHandoff = status.externalHandoff || status.ui?.providerHandoff || {};
  const compileCache = status.compileCache || {};
  const compileChecklist = status.compileCacheAcceptanceChecklist
    || compileCache.uiHandoff?.acceptanceChecklist
    || status.ui?.compileCache?.acceptanceChecklist
    || {};
  const operationalHealth = status.operationalHealth || {};
  const runtimeBlockedReasons = stableList([
    ...(Array.isArray(status.diagnostics)
      ? status.diagnostics
        .filter((diagnostic) => ['error', 'warning'].includes(diagnostic.severity))
        .map((diagnostic) => diagnostic.code)
      : []),
    ...(readiness.ready === false ? ['runtime_readiness_not_ready'] : []),
    ...stableList(readiness.validationSummary?.blockedReasons),
    ...stableList(previewAcceptance.blockedReasons),
    ...stableList(previewAcceptance.validationSummary?.blockedReasons),
    ...stableList(clientCommand.validationSummary?.blockedReasons),
    ...stableList(lifecycleControlState.blockedReasons),
    ...stableList(lifecycleCommandState.blockedReasons),
    ...stableList(lifecycleSettingsPatch.blockedReasons),
    ...stableList(tenantBoundaryHandoff.blockedReasons),
    ...stableList(externalHandoff.blockedReasons),
    ...stableList(compileCache.validationSummary?.blockedReasons),
    ...stableList(compileChecklist.blockedReasons),
    ...(Array.isArray(compileChecklist.blockingItems)
      ? compileChecklist.blockingItems.flatMap((item) => item.blockedReasons || [])
      : []),
    ...(operationalHealth.failed === true ? ['operational_health_failed'] : []),
    ...(operationalHealth.degraded === true && operationalHealth.degradedMode?.allowed !== true
      ? ['operational_health_degraded']
      : []),
    ...(operationalHealth.retry?.exhausted === true ? ['operational_health_retry_exhausted'] : []),
  ]);
  const clientCommandReady = clientCommand.validationSummary?.ready !== false
    && !['blocked', 'acceptance_required'].includes(clientCommand.state);
  const previewReady = previewAcceptance.ready !== false
    && previewAcceptance.route?.state !== 'blocked'
    && normalizeCounter(previewAcceptance.validationSummary?.blocking) === 0;
  const lifecycleReady = lifecycleControlState.ready !== false;
  const lifecycleCommandReady = lifecycleCommandState.ready !== false;
  const lifecycleSettingsPatchReady = lifecycleSettingsPatch.ready !== false;
  const tenantBoundaryReady = tenantBoundaryHandoff.ready !== false;
  const externalReady = externalHandoff.ready !== false
    && externalHandoff.restartSafe !== false;
  const compileReady = compileCache.resumeGate?.ready !== false
    && compileCache.replayBarrier?.open !== false
    && compileChecklist.ready !== false;
  const acceptance = previewAcceptance.acceptance || readiness.acceptance || {};
  const acceptanceRequired = acceptance.required === true
    || readiness.acceptance?.required === true
    || compileChecklist.acceptance?.required === true;
  const acceptanceAccepted = acceptanceRequired !== true
    || acceptance.accepted === true
    || (readiness.acceptance?.accepted === true && compileChecklist.acceptance?.accepted !== false);
  const resumeGate = compileCache.resumeGate || {};
  const resumeToken = compactString(
    clientCommand.resumeToken
      || clientCommand.idempotencyKey
      || clientRuntimeState.continuity?.resumeToken
      || clientRuntimeState.continuity?.idempotencyKey
      || resumeGate.resumeToken
      || resumeGate.command?.idempotencyKey
      || compileCache.persistedReplaySummary?.idempotencyKey
      || compileCache.persistedReplayState?.command?.idempotencyKey
      || previewAcceptance.route?.acceptanceToken
      || compileChecklist.acceptance?.token,
  );
  const requestId = compactString(
    status.requestId
      || readiness.preview?.requestId
      || clientCommand.requestId
      || externalHandoff.requestId,
  );
  const externalRequestId = compactString(
    externalHandoff.requestId
      || status.providerContract?.externalRequestId
      || status.providerServiceContract?.externalHandoff?.requestId,
  );
  const primaryBlockedReason = runtimeBlockedReasons[0] || '';
  const recoveryCommand = compactString(
    clientCommand.recoveryCommand
      || clientCommand.submitAction
      || previewAcceptance.route?.recoveryCommand
      || previewAcceptance.route?.primaryAction
      || (lifecycleCommandReady === false ? lifecycleCommandState.nextAction : '')
      || (lifecycleSettingsPatchReady === false ? lifecycleSettingsPatch.nextAction : '')
      || (lifecycleReady === false ? lifecycleControlState.nextAction : '')
      || (tenantBoundaryReady === false ? tenantBoundaryHandoff.nextAction : '')
      || (externalReady === false ? externalHandoff.nextAction : '')
      || (compileCache.resumeGate?.ready === false ? compileCache.resumeGate.nextAction : '')
      || compileChecklist.nextAction
      || operationalHealth.nextAction
      || readiness.nextStep
      || 'inspect_status',
  );
  const routeState = operationalHealth.failed === true || status.state === 'failed'
    ? 'failed'
    : runtimeBlockedReasons.some((reason) => reason.includes('boundary') || reason.includes('provider_offline'))
      ? 'blocked'
        : acceptanceRequired && !acceptanceAccepted
        ? 'acceptance_required'
        : !clientCommandReady || !previewReady || !lifecycleReady || !lifecycleCommandReady
          || !lifecycleSettingsPatchReady || !externalReady || !compileReady || !tenantBoundaryReady
          ? 'needs_attention'
          : status.terminal === true
            ? 'complete'
            : 'ready';
  const handoffReady = ['ready', 'complete'].includes(routeState)
    && runtimeBlockedReasons.length === 0
    && clientCommandReady
    && previewReady
    && lifecycleReady
    && lifecycleCommandReady
    && lifecycleSettingsPatchReady
    && tenantBoundaryReady
    && externalReady
    && compileReady;
  const visibleStep = routeState === 'complete'
    ? 'show_completion'
    : routeState === 'failed'
      ? 'show_recovery'
      : routeState === 'blocked'
        ? 'show_blocked_handoff'
        : routeState === 'acceptance_required'
          ? 'request_operator_acceptance'
          : handoffReady
            ? 'submit_client_command'
            : recoveryCommand;
  const workflowItems = [
    {
      key: 'readiness',
      owner: 'runtime',
      ready: readiness.ready !== false,
      action: readiness.nextStep || 'inspect_status',
      reason: readiness.ready === false ? 'runtime_readiness_not_ready' : 'ready',
    },
    {
      key: 'preview_acceptance',
      owner: 'operator',
      ready: previewReady,
      action: previewAcceptance.route?.primaryAction || 'review_preview_acceptance',
      reason: previewReady ? 'ready' : 'preview_acceptance_not_ready',
    },
    {
      key: 'client_command',
      owner: 'client',
      ready: clientCommandReady,
      action: clientCommand.submitAction || 'prepare_client_command',
      reason: clientCommandReady ? 'ready' : 'client_command_not_ready',
    },
    {
      key: 'lifecycle_controls',
      owner: 'runtime',
      ready: lifecycleReady,
      action: lifecycleControlState.nextAction || 'review_lifecycle_controls',
      reason: lifecycleReady ? 'ready' : 'lifecycle_controls_not_ready',
    },
    {
      key: 'lifecycle_command',
      owner: 'runtime',
      ready: lifecycleCommandReady,
      action: lifecycleCommandState.nextAction || 'review_lifecycle_command',
      reason: lifecycleCommandReady ? 'ready' : 'lifecycle_command_not_ready',
    },
    {
      key: 'lifecycle_settings_patch',
      owner: 'runtime',
      ready: lifecycleSettingsPatchReady,
      action: lifecycleSettingsPatch.nextAction || 'review_lifecycle_settings_patch',
      reason: lifecycleSettingsPatchReady ? 'ready' : 'lifecycle_settings_patch_not_ready',
    },
    {
      key: 'tenant_boundary_handoff',
      owner: 'runtime',
      ready: tenantBoundaryReady,
      action: tenantBoundaryHandoff.nextAction || 'inspect_permission_boundary',
      reason: tenantBoundaryReady ? 'ready' : 'tenant_boundary_handoff_not_ready',
    },
    {
      key: 'external_handoff',
      owner: 'provider',
      ready: externalReady,
      action: externalHandoff.nextAction || 'inspect_external_handoff',
      reason: externalReady ? 'ready' : 'external_handoff_not_ready',
    },
    {
      key: 'compile_cache_resume',
      owner: 'compiler',
      ready: compileReady,
      action: compileCache.resumeGate?.nextAction || compileChecklist.nextAction || 'review_compile_cache_status',
      reason: compileReady ? 'ready' : 'compile_cache_resume_not_ready',
    },
  ].map((item, index) => ({
    index: index + 1,
    itemId: `mailchimp.client_workflow.${item.key}`,
    key: item.key,
    owner: item.owner,
    ready: item.ready === true,
    blocking: item.ready !== true,
    action: compactString(item.action),
    reason: compactString(item.reason),
  }));
  const nextBlockingItem = workflowItems.find((item) => item.blocking) || null;
  const runtimeAdoption = buildMailchimpClientRuntimeAdoptionContract(status, {
    state: routeState,
    routeState,
    items: workflowItems,
    blockedReasons: runtimeBlockedReasons,
    primaryAction: compactString(nextBlockingItem?.action || visibleStep),
    recoveryCommand,
    acceptanceRequired,
    acceptanceAccepted,
  });

  return {
    protocol: 'aios.client-workflow-handoff.mailchimp.v1',
    requestId,
    adapter: compactString(status.adapter || 'mailchimp'),
    state: routeState,
    ready: handoffReady,
    visibleStep,
    primaryAction: compactString(nextBlockingItem?.action || visibleStep),
    recoveryCommand,
    blockedReasons: runtimeBlockedReasons,
    primaryBlockedReason,
    resume: {
      token: resumeToken,
      tokenPresent: Boolean(resumeToken),
      restartSafe: externalReady && compileCache.persistedReplaySummary?.restartSafe !== false,
      replaySafe: compileCache.persistedReplaySummary?.replaySafe === true
        || compileCache.replayBarrier?.open === true,
      command: recoveryCommand,
      retryAfterMs: normalizeCounter(operationalHealth.retry?.retryAfterMs || compileCache.resumeGate?.retry?.retryAfterMs),
      retryable: operationalHealth.retry?.retryable === true,
      degradedModeAllowed: operationalHealth.degradedMode?.allowed === true,
      lifecycleCommandKey: compactString(lifecycleCommandState.audit?.commandKey),
    },
    requestContinuity: {
      requestId,
      externalRequestId,
      cacheKey: compactString(compileCache.cacheKey),
      boundaryAuditKey: compactString(tenantBoundaryHandoff.audit?.handoffKey),
      boundaryDecision: compactString(tenantBoundaryHandoff.audit?.decision),
      statusState: normalizeState(status.state),
      terminal: status.terminal === true,
      active: status.active === true,
      latestEventCode: compactString(status.progress?.latestCode),
      latestEventMessage: compactString(status.progress?.latestMessage),
      lifecycleCommand: compactString(lifecycleCommandState.command),
      lifecycleCommandState: compactString(lifecycleCommandState.state),
      lifecycleSettingsPatchState: compactString(lifecycleSettingsPatch.state),
      lifecycleSettingsPatchKey: compactString(lifecycleSettingsPatch.audit?.patchKey),
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      token: compactString(acceptance.token || previewAcceptance.route?.acceptanceToken || compileChecklist.acceptance?.token),
      canAccept: acceptanceRequired && !acceptanceAccepted && routeState === 'acceptance_required',
    },
    runtimeAdoption,
    route: {
      state: routeState,
      statusRouteState: routeState === 'complete' ? 'ready' : routeState,
      primaryAction: compactString(runtimeAdoption.visibleAction || nextBlockingItem?.action || visibleStep),
      recoveryCommand,
      explainable: true,
    },
    items: workflowItems,
    nextBlockingItem,
    exportSummary: {
      exportReady: handoffReady,
      format: 'json',
      blockedReasons: stableList([...runtimeBlockedReasons, ...runtimeAdoption.blockedReasons]),
      nextAction: compactString(runtimeAdoption.visibleAction || nextBlockingItem?.action || visibleStep),
      counters: {
        workflowItems: workflowItems.length,
        blockingItems: workflowItems.filter((item) => item.blocking).length,
        resumeTokenPresent: resumeToken ? 1 : 0,
        acceptanceRequired: acceptanceRequired ? 1 : 0,
        acceptanceAccepted: acceptanceAccepted ? 1 : 0,
        runtimeAdoptionReady: runtimeAdoption.ready === true ? 1 : 0,
        runtimeAdoptionBlockedReasons: stableList(runtimeAdoption.blockedReasons).length,
        lifecycleSettingsPatchReady: lifecycleSettingsPatchReady ? 1 : 0,
        lifecycleSettingsPatchChangedFields: normalizeCounter(lifecycleSettingsPatch.changedFields?.length),
        clientHydrateAvailable: runtimeAdoption.adoption.canHydrate ? 1 : 0,
        clientResumeAvailable: runtimeAdoption.adoption.canResume ? 1 : 0,
        clientSubmitAvailable: runtimeAdoption.adoption.canSubmit ? 1 : 0,
      },
    },
  };
}

function normalizeProviderContract(descriptor, runtime = {}, historySummary = {}) {
  const descriptorContract = descriptor.providerContract || {};
  const mergedCapabilities = mergeProviderCapabilities(descriptorContract, runtime);
  const requested = new Set([
    ...(Array.isArray(descriptor.capabilities) ? descriptor.capabilities : []),
    ...mergedCapabilities.requested,
  ]);
  const advertised = mergedCapabilities.advertised;
  const missingCapabilities = [...requested]
    .filter((capability) => capability.startsWith('mailchimp.') || capability === 'external.write')
    .filter((capability) => advertised.length > 0 && !advertised.includes(capability));
  const serviceState = compactString(
    runtime.providerState || runtime.serviceState || descriptorContract.serviceState || 'unknown',
  ).toLowerCase();
  const descriptorSync = descriptorContract.sync || {};
  const syncCursor = compactString(runtime.syncCursor || runtime.cursor || descriptorSync.cursor);
  const externalRequestId = compactString(
    runtime.externalRequestId
      || runtime.providerRequestId
      || descriptorContract.externalHandoff?.requestId
      || descriptor.externalHandoff?.requestId,
  );
  const lease = normalizeProviderLease(descriptorContract, runtime);
  const receipt = normalizeProviderReceipt(descriptor, runtime, {
    provider: compactString(runtime.provider || descriptorContract.provider || 'mailchimp'),
    service: compactString(runtime.service || descriptorContract.service || 'mailchimp-marketing'),
    externalRequestId,
    sync: { cursor: syncCursor },
  });
  const handoffState = externalRequestId
    ? 'linked'
    : compactString(
      runtime.externalHandoffState
        || descriptorContract.externalHandoff?.state
        || descriptor.externalHandoff?.state
        || 'local_only',
    );

  return {
    provider: compactString(runtime.provider || descriptorContract.provider || 'mailchimp'),
    service: compactString(runtime.service || descriptorContract.service || 'mailchimp-marketing'),
    serviceState,
    externalRequestId,
    externalHandoffState: handoffState,
    sync: {
      cursor: syncCursor,
      resource: compactString(runtime.syncResource || descriptorSync.resource || 'mailchimp'),
      batchId: compactString(runtime.syncBatchId || descriptorSync.batchId),
      lastSyncedAt: compactString(runtime.lastSyncedAt || runtime.syncedAt || descriptorSync.lastSyncedAt),
      historyLatestAt: compactString(historySummary?.timeline?.latestAt),
      historyLatestState: compactString(historySummary?.timeline?.latestState || historySummary?.latestState),
      stale: Boolean(syncCursor && historySummary?.timeline?.latestAt && runtime.lastSyncedAt && runtime.lastSyncedAt < historySummary.timeline.latestAt),
      ready: descriptorSync.ready !== false && (!descriptorSync.requiredForExternalWrite || Boolean(syncCursor)),
    },
    capabilityNegotiation: {
      requested: [...requested].sort(),
      advertised: advertised.sort(),
      missing: missingCapabilities.sort(),
      satisfied: missingCapabilities.length === 0,
      writeCapabilityRequested: requested.has('external.write'),
    },
    lease,
    receipt,
  };
}

function selectProviderServiceRequirements(descriptor = {}, runtime = {}) {
  const descriptorContract = descriptor.providerContract && typeof descriptor.providerContract === 'object'
    ? descriptor.providerContract
    : {};
  const serviceContract = descriptorContract.serviceContract && typeof descriptorContract.serviceContract === 'object'
    ? descriptorContract.serviceContract
    : descriptor.serviceContract && typeof descriptor.serviceContract === 'object'
      ? descriptor.serviceContract
      : {};
  const runtimeContract = runtime.providerServiceContract && typeof runtime.providerServiceContract === 'object'
    ? runtime.providerServiceContract
    : runtime.serviceContract && typeof runtime.serviceContract === 'object'
      ? runtime.serviceContract
      : {};
  const runtimeSync = runtimeContract.sync && typeof runtimeContract.sync === 'object'
    ? runtimeContract.sync
    : {};
  const descriptorSync = serviceContract.sync && typeof serviceContract.sync === 'object'
    ? serviceContract.sync
    : descriptorContract.sync && typeof descriptorContract.sync === 'object'
      ? descriptorContract.sync
      : {};
  const runtimeHandoff = runtimeContract.externalHandoff && typeof runtimeContract.externalHandoff === 'object'
    ? runtimeContract.externalHandoff
    : {};
  const descriptorHandoff = serviceContract.externalHandoff && typeof serviceContract.externalHandoff === 'object'
    ? serviceContract.externalHandoff
    : descriptorContract.externalHandoff && typeof descriptorContract.externalHandoff === 'object'
      ? descriptorContract.externalHandoff
      : {};
  const resource = compactString(
    runtimeContract.resource
      || runtime.syncResource
      || serviceContract.resource
      || descriptorSync.resource
      || 'mailchimp',
  );
  const requestedScopes = normalizeScopedList(
    serviceContract.requiredScopes,
    serviceContract.scopes,
    descriptorContract.requiredScopes,
    descriptorContract.scopes,
    descriptor.requiredScopes,
    runtimeContract.requiredScopes,
  );
  const advertisedScopes = normalizeScopedList(
    runtime.providerScopes,
    runtimeContract.advertisedScopes,
    runtimeContract.scopes,
    descriptorContract.advertisedScopes,
    serviceContract.advertisedScopes,
  );
  const requiredResources = normalizeScopedList(
    serviceContract.requiredResources,
    descriptorContract.requiredResources,
    descriptor.requiredResources,
    resource,
  );
  const advertisedResources = normalizeScopedList(
    runtime.providerResources,
    runtimeContract.advertisedResources,
    serviceContract.advertisedResources,
    descriptorContract.advertisedResources,
    resource,
  );

  return {
    provider: compactString(runtimeContract.provider || runtime.provider || descriptorContract.provider || 'mailchimp'),
    service: compactString(runtimeContract.service || runtime.service || descriptorContract.service || 'mailchimp-marketing'),
    resource,
    serviceVersion: compactString(runtimeContract.serviceVersion || runtime.serviceVersion || serviceContract.serviceVersion),
    requestedScopes,
    advertisedScopes,
    requiredResources,
    advertisedResources,
    sync: {
      cursorRequired: normalizeBooleanControl(
        runtimeSync.cursorRequired,
        runtime.cursorRequired,
        descriptorSync.cursorRequired,
        descriptorSync.requiredForExternalWrite,
      ) === true,
      cursor: compactString(runtimeSync.cursor || runtime.syncCursor || runtime.cursor || descriptorSync.cursor),
      batchId: compactString(runtimeSync.batchId || runtime.syncBatchId || descriptorSync.batchId),
      checkpointId: compactString(runtimeSync.checkpointId || runtime.syncCheckpointId || descriptorSync.checkpointId),
      lastSyncedAt: compactString(runtimeSync.lastSyncedAt || runtime.lastSyncedAt || runtime.syncedAt || descriptorSync.lastSyncedAt),
      minSyncedAt: compactString(runtimeSync.minSyncedAt || runtime.minSyncedAt || descriptorSync.minSyncedAt),
      mode: compactString(runtimeSync.mode || descriptorSync.mode || 'incremental').toLowerCase().replaceAll('-', '_'),
    },
    externalHandoff: {
      state: compactString(runtimeHandoff.state || runtime.externalHandoffState || descriptorHandoff.state || 'local_only'),
      requestId: compactString(runtimeHandoff.requestId || runtime.externalRequestId || runtime.providerRequestId || descriptorHandoff.requestId),
      receiptRequired: normalizeBooleanControl(
        runtimeHandoff.receiptRequired,
        runtime.receiptRequired,
        descriptorHandoff.receiptRequired,
      ) === true,
      writesExternalSystem: descriptor.truthBoundary?.externalWritesAllowed === true
        || normalizeBooleanControl(runtimeHandoff.writesExternalSystem, runtime.writesExternalSystem) === true,
      idempotencyKey: compactString(runtimeHandoff.idempotencyKey || runtime.idempotencyKey || descriptor.idempotencyKey),
    },
  };
}

function buildProviderServiceNegotiationContract(descriptor = {}, runtime = {}, providerContract = {}, history = {}) {
  const requirements = selectProviderServiceRequirements(descriptor, runtime);
  const expectedProvider = requirements.provider || 'mailchimp';
  const expectedService = requirements.service || 'mailchimp-marketing';
  const actualProvider = compactString(providerContract.provider || expectedProvider);
  const actualService = compactString(providerContract.service || expectedService);
  const providerMatches = !actualProvider || actualProvider === expectedProvider;
  const serviceMatches = !actualService || actualService === expectedService;
  const requestedScopes = requirements.requestedScopes;
  const advertisedScopes = requirements.advertisedScopes;
  const missingScopes = requestedScopes.filter((scope) => !listAllowsValue(advertisedScopes, scope));
  const requiredResources = requirements.requiredResources;
  const advertisedResources = requirements.advertisedResources;
  const missingResources = requiredResources.filter((resource) => !listAllowsValue(advertisedResources, resource));
  const requestedCapabilities = stableList(providerContract.capabilityNegotiation?.requested);
  const advertisedCapabilities = stableList(providerContract.capabilityNegotiation?.advertised);
  const missingCapabilities = stableList(providerContract.capabilityNegotiation?.missing);
  const sync = requirements.sync;
  const lastSyncedMs = normalizeTimestampMs(providerContract.sync?.lastSyncedAt || sync.lastSyncedAt);
  const historyLatestAt = compactString(providerContract.sync?.historyLatestAt || history.timeline?.latestAt);
  const historyLatestMs = normalizeTimestampMs(historyLatestAt);
  const minSyncedMs = normalizeTimestampMs(sync.minSyncedAt);
  const cursorPresent = Boolean(providerContract.sync?.cursor || sync.cursor);
  const cursorRequired = sync.cursorRequired
    || providerContract.sync?.ready === false
    || requirements.externalHandoff.writesExternalSystem === true;
  const behindHistory = lastSyncedMs !== null && historyLatestMs !== null && lastSyncedMs < historyLatestMs;
  const beforeMinimumSync = minSyncedMs !== null && lastSyncedMs !== null && lastSyncedMs < minSyncedMs;
  const syncReady = providerContract.sync?.ready !== false
    && (!cursorRequired || cursorPresent)
    && !providerContract.sync?.stale
    && !behindHistory
    && !beforeMinimumSync;
  const linked = Boolean(providerContract.externalRequestId || requirements.externalHandoff.requestId)
    || requirements.externalHandoff.state !== 'local_only'
    || providerContract.externalHandoffState !== 'local_only';
  const receipt = providerContract.receipt || {};
  const receiptRequired = requirements.externalHandoff.receiptRequired
    || (linked && requirements.externalHandoff.writesExternalSystem === true);
  const receiptReady = receiptRequired ? receipt.acknowledged === true : receipt.restartSafe !== false;
  const serviceState = compactString(providerContract.serviceState || 'unknown').toLowerCase();
  const serviceAvailable = !['offline', 'blocked'].includes(serviceState);
  const blockedReasons = stableList([
    ...(!providerMatches ? ['provider_service_provider_mismatch'] : []),
    ...(!serviceMatches ? ['provider_service_name_mismatch'] : []),
    ...(serviceState === 'offline' ? ['provider_offline'] : []),
    ...(serviceState === 'blocked' ? ['provider_blocked'] : []),
    ...(serviceState === 'degraded' ? ['provider_degraded'] : []),
    ...missingCapabilities.map((capability) => `missing_capability:${capability}`),
    ...missingScopes.map((scope) => `missing_scope:${scope}`),
    ...missingResources.map((resource) => `missing_resource:${resource}`),
    ...(cursorRequired && !cursorPresent ? ['provider_sync_cursor_missing'] : []),
    ...(providerContract.sync?.stale === true || behindHistory ? ['provider_sync_stale'] : []),
    ...(beforeMinimumSync ? ['provider_sync_before_required_minimum'] : []),
    ...(providerContract.sync?.ready === false ? ['provider_sync_not_ready'] : []),
    ...(linked && !providerContract.externalRequestId && !requirements.externalHandoff.requestId ? ['external_request_missing'] : []),
    ...(receiptRequired && !receiptReady ? ['provider_receipt_ack_missing'] : []),
    ...stableList(receipt.blockedReasons),
  ]);
  const ready = blockedReasons.length === 0;
  const nextAction = ready
    ? 'observe'
    : !providerMatches || !serviceMatches || missingCapabilities.length > 0 || missingScopes.length > 0 || missingResources.length > 0
      ? 'refresh_provider_contract'
      : !serviceAvailable
        ? serviceState === 'offline' ? 'wait_for_provider_online' : 'inspect_provider_contract'
        : cursorRequired && !cursorPresent
          ? 'refresh_provider_sync_before_replay'
          : !syncReady
            ? 'refresh_provider_sync_before_replay'
            : receiptRequired && !receiptReady
              ? 'refresh_provider_receipt'
              : 'inspect_provider_contract';

  return {
    protocol: 'aios.provider-service-negotiation.mailchimp.v1',
    ready,
    state: ready ? 'ready' : serviceAvailable ? 'degraded' : 'blocked',
    nextAction,
    blockedReasons,
    provider: {
      expected: expectedProvider,
      actual: actualProvider,
      matches: providerMatches,
    },
    service: {
      expected: expectedService,
      actual: actualService,
      version: requirements.serviceVersion,
      matches: serviceMatches,
      state: serviceState,
    },
    resourceAccess: {
      resource: requirements.resource,
      requiredResources,
      advertisedResources,
      missingResources,
      requestedScopes,
      advertisedScopes,
      missingScopes,
    },
    capabilityNegotiation: {
      requested: requestedCapabilities,
      advertised: advertisedCapabilities,
      missing: missingCapabilities,
      satisfied: missingCapabilities.length === 0 && missingScopes.length === 0 && missingResources.length === 0,
    },
    syncMetadata: {
      ready: syncReady,
      cursorRequired,
      cursorPresent,
      cursor: compactString(providerContract.sync?.cursor || sync.cursor),
      batchId: compactString(providerContract.sync?.batchId || sync.batchId),
      checkpointId: sync.checkpointId,
      mode: sync.mode,
      lastSyncedAt: compactString(providerContract.sync?.lastSyncedAt || sync.lastSyncedAt),
      minSyncedAt: sync.minSyncedAt,
      historyLatestAt,
      behindHistory,
      beforeMinimumSync,
      replayPolicy: syncReady ? 'reuse_provider_sync' : 'refresh_provider_sync_before_replay',
    },
    externalHandoff: {
      linked,
      state: compactString(providerContract.externalHandoffState || requirements.externalHandoff.state),
      requestId: compactString(providerContract.externalRequestId || requirements.externalHandoff.requestId),
      idempotencyKey: requirements.externalHandoff.idempotencyKey,
      writesExternalSystem: requirements.externalHandoff.writesExternalSystem,
      receiptRequired,
      receiptReady,
    },
    exportSummary: {
      exportReady: ready,
      format: 'json',
      blockedReasons,
      counters: {
        requestedCapabilities: requestedCapabilities.length,
        missingCapabilities: missingCapabilities.length,
        requestedScopes: requestedScopes.length,
        missingScopes: missingScopes.length,
        requiredResources: requiredResources.length,
        missingResources: missingResources.length,
        cursorPresent: cursorPresent ? 1 : 0,
        receiptRequired: receiptRequired ? 1 : 0,
      },
    },
  };
}

export function buildMailchimpProviderServiceNegotiationContract(input = {}, runtime = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const history = buildMailchimpAdapterHistorySnapshot(descriptor, runtime.history || runtime.events || []);
  const providerContract = normalizeProviderContract(descriptor, runtime, history);
  return buildProviderServiceNegotiationContract(descriptor, runtime, providerContract, history);
}

export function buildMailchimpExternalHandoffState(input = {}, runtime = {}, options = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const history = options.historySummary && typeof options.historySummary === 'object'
    ? options.historySummary
    : summarizeMailchimpAdapterHistory(buildMailchimpAdapterHistorySnapshot(descriptor, runtime.history || runtime.events || []));
  const providerContract = options.providerContract && typeof options.providerContract === 'object'
    ? options.providerContract
    : normalizeProviderContract(descriptor, runtime, history);
  const providerServiceContract = options.providerServiceContract && typeof options.providerServiceContract === 'object'
    ? options.providerServiceContract
    : null;
  const externalHandoff = descriptor.providerContract?.externalHandoff && typeof descriptor.providerContract.externalHandoff === 'object'
    ? descriptor.providerContract.externalHandoff
    : descriptor.externalHandoff && typeof descriptor.externalHandoff === 'object'
      ? descriptor.externalHandoff
      : {};
  const truthBoundary = descriptor.truthBoundary || {};
  const writesExternalSystem = truthBoundary.externalWritesAllowed === true;
  const requestedCapabilities = stableList(providerContract.capabilityNegotiation?.requested || []);
  const advertisedCapabilities = stableList(providerContract.capabilityNegotiation?.advertised || []);
  const missingCapabilities = stableList(providerContract.capabilityNegotiation?.missing || []);
  const writeCapabilityRequested = providerContract.capabilityNegotiation?.writeCapabilityRequested === true
    || requestedCapabilities.includes('external.write')
    || writesExternalSystem;
  const linked = Boolean(providerContract.externalRequestId)
    || (providerContract.externalHandoffState && providerContract.externalHandoffState !== 'local_only');
  const receipt = providerContract.receipt || {};
  const receiptRequired = providerServiceContract?.externalHandoff?.receiptRequired === true
    || externalHandoff.receiptRequired === true
    || (linked && writeCapabilityRequested);
  const receiptAcknowledged = receipt.acknowledged === true
    || providerServiceContract?.externalHandoff?.receiptAcknowledged === true;
  const cursorRequired = providerContract.sync?.ready === false
    || externalHandoff.cursorRequired === true
    || (writesExternalSystem && writeCapabilityRequested);
  const cursorPresent = Boolean(providerContract.sync?.cursor);
  const lastSyncedMs = normalizeTimestampMs(providerContract.sync?.lastSyncedAt);
  const historyLatestMs = normalizeTimestampMs(providerContract.sync?.historyLatestAt || history?.timeline?.latestAt);
  const staleByTimestamp = lastSyncedMs !== null && historyLatestMs !== null && lastSyncedMs < historyLatestMs;
  const syncStale = providerContract.sync?.stale === true || staleByTimestamp;
  const syncReady = providerContract.sync?.ready !== false
    && (!cursorRequired || cursorPresent)
    && !syncStale;
  const leaseState = compactString(providerContract.lease?.state || 'unknown');
  const leaseReady = !['expired', 'missing_token'].includes(leaseState)
    && providerContract.lease?.restartSafe !== false;
  const serviceState = compactString(providerContract.serviceState || 'unknown').toLowerCase();
  const serviceReady = !['offline', 'blocked'].includes(serviceState);
  const capabilitySatisfied = missingCapabilities.length === 0
    && providerContract.capabilityNegotiation?.satisfied !== false;
  const externalWriteAllowed = !writesExternalSystem
    || (writeCapabilityRequested && capabilitySatisfied && receiptRequired === false)
    || (writeCapabilityRequested && capabilitySatisfied && receiptAcknowledged);
  const blockedReasons = stableList([
    ...(serviceState === 'offline' ? ['provider_offline'] : []),
    ...(serviceState === 'blocked' ? ['provider_blocked'] : []),
    ...(serviceState === 'degraded' ? ['provider_degraded'] : []),
    ...missingCapabilities.map((capability) => `missing_capability:${capability}`),
    ...(!leaseReady ? [`provider_lease_${leaseState || 'not_ready'}`] : []),
    ...(cursorRequired && !cursorPresent ? ['provider_sync_cursor_missing'] : []),
    ...(syncStale ? ['provider_sync_stale'] : []),
    ...(providerContract.sync?.ready === false ? ['provider_sync_not_ready'] : []),
    ...(linked && !providerContract.externalRequestId ? ['external_request_missing'] : []),
    ...(receiptRequired && !receiptAcknowledged ? ['provider_receipt_ack_missing'] : []),
    ...stableList(receipt.blockedReasons),
    ...(writesExternalSystem && !writeCapabilityRequested ? ['external_write_capability_not_requested'] : []),
    ...(writesExternalSystem && !externalWriteAllowed ? ['external_write_handoff_not_ready'] : []),
  ]);
  const ready = blockedReasons.length === 0;
  const routeState = ready
    ? 'ready'
    : serviceState === 'offline' || missingCapabilities.length > 0 || leaseState === 'missing_token'
      ? 'blocked'
      : 'needs_attention';
  const nextAction = ready
    ? 'handoff_external_status'
    : serviceState === 'offline'
      ? 'wait_for_provider_online'
      : missingCapabilities.length > 0
        ? 'refresh_provider_contract'
        : !leaseReady
          ? 'refresh_provider_lease'
          : linked && !providerContract.externalRequestId
            ? 'relink_external_handoff'
            : receiptRequired && !receiptAcknowledged
              ? 'refresh_provider_receipt'
              : !syncReady
                ? 'refresh_provider_sync_before_replay'
                : 'inspect_external_handoff';

  return {
    protocol: 'aios.external-handoff-state.mailchimp.v1',
    provider: compactString(providerContract.provider || 'mailchimp'),
    service: compactString(providerContract.service || 'mailchimp-marketing'),
    state: providerContract.externalHandoffState || (providerContract.externalRequestId ? 'linked' : 'local_only'),
    ready,
    routeState,
    nextAction,
    blockedReasons,
    requestId: providerContract.externalRequestId,
    linked: linked && Boolean(providerContract.externalRequestId),
    relinkRequired: linked && !providerContract.externalRequestId,
    writesExternalSystem,
    externalWriteAllowed,
    restartSafe: ready
      && leaseReady
      && syncReady
      && (!linked || Boolean(providerContract.externalRequestId))
      && (!receiptRequired || receiptAcknowledged),
    capabilityNegotiation: {
      requested: requestedCapabilities,
      advertised: advertisedCapabilities,
      missing: missingCapabilities,
      satisfied: capabilitySatisfied,
      writeCapabilityRequested,
      negotiatedAt: compactString(runtime.capabilityNegotiatedAt || externalHandoff.negotiatedAt),
    },
    syncMetadata: {
      ready: syncReady,
      stale: syncStale,
      cursorRequired,
      cursorPresent,
      cursor: compactString(providerContract.sync?.cursor),
      resource: compactString(providerContract.sync?.resource || 'mailchimp'),
      batchId: compactString(providerContract.sync?.batchId),
      lastSyncedAt: compactString(providerContract.sync?.lastSyncedAt),
      historyLatestAt: compactString(providerContract.sync?.historyLatestAt || history?.timeline?.latestAt),
      historyLatestState: compactString(providerContract.sync?.historyLatestState || history?.timeline?.latestState || history?.latestState),
      driftMs: lastSyncedMs !== null && historyLatestMs !== null ? Math.max(0, historyLatestMs - lastSyncedMs) : null,
      replayPolicy: syncReady ? 'reuse_provider_sync' : 'refresh_provider_sync_before_replay',
    },
    lease: {
      state: leaseState,
      owner: compactString(providerContract.lease?.owner),
      tokenPresent: providerContract.lease?.tokenPresent === true,
      expiresAt: compactString(providerContract.lease?.expiresAt),
      restartSafe: leaseReady,
      renewable: providerContract.lease?.renewable !== false,
    },
    receipt: {
      required: receiptRequired,
      acknowledged: receiptAcknowledged,
      state: compactString(receipt.state || 'missing'),
      receiptId: compactString(receipt.receiptId),
      acknowledgedAt: compactString(receipt.acknowledgedAt),
      syncCursor: compactString(receipt.syncCursor),
      blockedReasons: stableList(receipt.blockedReasons),
    },
    exportSummary: {
      exportReady: ready,
      format: 'json',
      blockedReasons,
      counters: {
        requestedCapabilities: requestedCapabilities.length,
        advertisedCapabilities: advertisedCapabilities.length,
        missingCapabilities: missingCapabilities.length,
        cursorPresent: cursorPresent ? 1 : 0,
        receiptRequired: receiptRequired ? 1 : 0,
        receiptAcknowledged: receiptAcknowledged ? 1 : 0,
        linked: linked ? 1 : 0,
      },
    },
  };
}

export function buildMailchimpProviderServiceContract(input = {}, runtime = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const history = buildMailchimpAdapterHistorySnapshot(descriptor, runtime.history || runtime.events || []);
  const providerContract = normalizeProviderContract(descriptor, runtime, history);
  const serviceNegotiation = buildProviderServiceNegotiationContract(descriptor, runtime, providerContract, history);
  const externalLinked = providerContract.externalHandoffState !== 'local_only'
    || Boolean(providerContract.externalRequestId);
  const missingCapabilities = providerContract.capabilityNegotiation.missing;
  const leaseState = providerContract.lease.state;
  const syncReady = providerContract.sync.ready !== false && serviceNegotiation.syncMetadata.ready !== false;
  const syncStale = providerContract.sync.stale === true || serviceNegotiation.syncMetadata.behindHistory === true;
  const serviceOffline = providerContract.serviceState === 'offline';
  const serviceDegraded = providerContract.serviceState === 'degraded';
  const receipt = providerContract.receipt || {};
  const receiptRequired = serviceNegotiation.externalHandoff.receiptRequired === true
    || (externalLinked && providerContract.capabilityNegotiation.writeCapabilityRequested === true);
  const receiptReady = receiptRequired
    ? receipt.acknowledged === true && serviceNegotiation.externalHandoff.receiptReady === true
    : receipt.restartSafe !== false;
  const blockedReasons = stableList([
    ...(serviceOffline ? ['provider_offline'] : []),
    ...(serviceDegraded ? ['provider_degraded'] : []),
    ...(missingCapabilities.length > 0 ? ['provider_capability_missing'] : []),
    ...missingCapabilities.map((capability) => `missing_capability:${capability}`),
    ...stableList(serviceNegotiation.blockedReasons),
    ...(['expired', 'missing_token'].includes(leaseState) ? [`provider_lease_${leaseState}`] : []),
    ...(syncReady ? [] : ['provider_sync_not_ready']),
    ...(syncStale ? ['provider_sync_stale'] : []),
    ...(externalLinked && !providerContract.externalRequestId ? ['external_request_missing'] : []),
    ...(Array.isArray(receipt.blockedReasons) ? receipt.blockedReasons : []),
    ...(receiptRequired && !receiptReady ? ['provider_receipt_ack_missing'] : []),
  ]);
  const state = blockedReasons.length === 0
    ? 'ready'
    : serviceOffline || missingCapabilities.length > 0 || leaseState === 'missing_token'
      ? 'blocked'
      : 'degraded';
  const nextAction = state === 'ready'
    ? 'observe'
    : serviceNegotiation.nextAction && serviceNegotiation.nextAction !== 'observe'
      ? serviceNegotiation.nextAction
    : serviceOffline
      ? 'wait_for_provider_online'
      : missingCapabilities.length > 0
        ? 'refresh_provider_contract'
        : ['expired', 'missing_token'].includes(leaseState)
          ? 'refresh_provider_lease'
          : externalLinked && !providerContract.externalRequestId
            ? 'relink_external_handoff'
            : receiptRequired && !receiptReady
              ? 'refresh_provider_receipt'
            : syncReady === false || syncStale
              ? 'refresh_provider_sync_before_replay'
              : 'inspect_provider_contract';

  return {
    protocol: 'aios.provider-service-contract.mailchimp.v1',
    provider: providerContract.provider,
    service: providerContract.service,
    state,
    serviceState: providerContract.serviceState,
    restartSafe: state !== 'blocked'
      && providerContract.lease.restartSafe !== false
      && (!externalLinked || Boolean(providerContract.externalRequestId))
      && receiptReady,
    nextAction,
    blockedReasons,
    serviceNegotiation,
    externalHandoff: {
      state: providerContract.externalHandoffState,
      requestId: providerContract.externalRequestId,
      linked: externalLinked && Boolean(providerContract.externalRequestId),
      relinkRequired: externalLinked && !providerContract.externalRequestId,
      receiptRequired,
      receiptAcknowledged: receipt.acknowledged === true,
      receipt,
      restartSafe: serviceNegotiation.externalHandoff.receiptReady !== false
        && (!serviceNegotiation.externalHandoff.linked || Boolean(serviceNegotiation.externalHandoff.requestId)),
    },
    sync: {
      ready: syncReady,
      stale: syncStale,
      cursor: providerContract.sync.cursor,
      cursorPresent: Boolean(providerContract.sync.cursor),
      resource: providerContract.sync.resource,
      batchId: providerContract.sync.batchId,
      checkpointId: serviceNegotiation.syncMetadata.checkpointId,
      lastSyncedAt: providerContract.sync.lastSyncedAt,
      historyLatestAt: providerContract.sync.historyLatestAt,
      historyLatestState: providerContract.sync.historyLatestState,
      minSyncedAt: serviceNegotiation.syncMetadata.minSyncedAt,
      replayPolicy: serviceNegotiation.syncMetadata.replayPolicy,
    },
    capabilityNegotiation: {
      requested: providerContract.capabilityNegotiation.requested,
      advertised: providerContract.capabilityNegotiation.advertised,
      missing: missingCapabilities,
      satisfied: missingCapabilities.length === 0 && serviceNegotiation.capabilityNegotiation.satisfied === true,
      writeCapabilityRequested: providerContract.capabilityNegotiation.writeCapabilityRequested === true,
    },
    resourceAccess: serviceNegotiation.resourceAccess,
    lease: {
      state: leaseState,
      owner: providerContract.lease.owner,
      tokenPresent: providerContract.lease.tokenPresent === true,
      expiresAt: providerContract.lease.expiresAt,
      renewable: providerContract.lease.renewable !== false,
      restartSafe: providerContract.lease.restartSafe !== false,
    },
    exportSummary: {
      exportReady: state !== 'blocked',
      format: 'json',
      blockedReasons,
      counters: {
        requestedCapabilities: providerContract.capabilityNegotiation.requested.length,
        advertisedCapabilities: providerContract.capabilityNegotiation.advertised.length,
        missingCapabilities: missingCapabilities.length,
        requestedScopes: serviceNegotiation.resourceAccess.requestedScopes.length,
        missingScopes: serviceNegotiation.resourceAccess.missingScopes.length,
        requiredResources: serviceNegotiation.resourceAccess.requiredResources.length,
        missingResources: serviceNegotiation.resourceAccess.missingResources.length,
        syncCursorPresent: providerContract.sync.cursor ? 1 : 0,
        receiptAcknowledged: receipt.acknowledged === true ? 1 : 0,
      },
    },
  };
}

export function buildMailchimpStatusDecisionPersistenceEnvelope(status = {}, runtime = {}) {
  const adapterDecisionEnvelope = status.decisionEnvelope?.protocol === 'aios.adapter-decision-envelope.mailchimp.v1'
    ? status.decisionEnvelope
    : status.adapterDecisionEnvelope?.protocol === 'aios.adapter-decision-envelope.mailchimp.v1'
      ? status.adapterDecisionEnvelope
      : status.ui?.adapterDecisionEnvelope?.protocol === 'aios.adapter-decision-envelope.mailchimp.v1'
        ? status.ui.adapterDecisionEnvelope
        : status.adapterNextStepHandoff?.protocol === 'aios.adapter-next-step-handoff.mailchimp.v1'
          ? {
            protocol: 'aios.adapter-decision-envelope.mailchimp.v1',
            envelopeKey: compactString(status.adapterNextStepHandoff.handoffKey || `${status.requestId || 'mailchimp-status'}:decision`),
            requestId: compactString(status.requestId),
            tenant: compactString(status.tenant),
            action: compactString(status.action),
            state: compactString(status.adapterNextStepHandoff.state || 'unknown'),
            readyForPreview: status.adapterNextStepHandoff.readyForClient === true,
            readyForRuntime: status.adapterNextStepHandoff.readyForRuntime === true,
            nextAction: compactString(status.adapterNextStepHandoff.primaryAction || status.adapterNextStepHandoff.route?.primaryAction),
            blockedReasons: stableList(status.adapterNextStepHandoff.blockedReasons),
            acceptance: status.adapterNextStepHandoff.acceptance || {},
            route: status.adapterNextStepHandoff.route || null,
            restartSemantics: status.adapterNextStepHandoff.restartSemantics || { replaySafe: status.adapterNextStepHandoff.readyForRuntime === true },
          }
          : buildMailchimpAdapterDecisionEnvelope(status, {
          nextStepHandoff: status.adapterNextStepHandoff,
          clientCommand: status.clientCommand,
          dispatchReadiness: status.adapterDispatchReadiness,
          acceptance: status.readiness?.acceptance || status.previewAcceptance?.acceptance,
        });
  const persistedRecovery = status.persistedRecovery || status.ui?.persistedRecovery || {};
  const previewAcceptance = status.previewAcceptance || status.ui?.previewAcceptance || {};
  const clientWorkflowHandoff = status.clientWorkflowHandoff || status.ui?.clientWorkflowHandoff || {};
  const lifecycleCommand = status.lifecycleCommandState || {};
  const lifecyclePatch = status.lifecycleSettingsPatch || {};
  const explicitCommand = compactString(
    runtime.decisionCommand
      || runtime.statusCommand
      || runtime.requestedCommand
      || adapterDecisionEnvelope.nextAction,
  );
  const persistenceKey = `mailchimp-status-decision:${[
    status.requestId || adapterDecisionEnvelope.requestId || 'handoff',
    adapterDecisionEnvelope.envelopeKey || 'decision',
    explicitCommand || 'observe',
  ].map(compactString).filter(Boolean).join(':')}`.replace(/[^a-zA-Z0-9_.:-]/g, '_');
  const acceptanceRequired = adapterDecisionEnvelope.acceptance?.required === true
    || previewAcceptance.acceptance?.required === true;
  const acceptanceAccepted = adapterDecisionEnvelope.acceptance?.accepted === true
    || previewAcceptance.acceptance?.accepted === true;
  const persistedReady = persistedRecovery.ready !== false
    && persistedRecovery.restartSafe !== false
    && persistedRecovery.persistedSnapshot?.write?.allowed !== false;
  const workflowReady = clientWorkflowHandoff.ready !== false
    && clientWorkflowHandoff.state !== 'blocked'
    && clientWorkflowHandoff.state !== 'acceptance_required';
  const lifecycleReady = lifecycleCommand.ready !== false && lifecyclePatch.ready !== false;
  const blockedReasons = stableList([
    ...stableList(adapterDecisionEnvelope.blockedReasons).map((reason) => `adapter_decision:${reason}`),
    ...(adapterDecisionEnvelope.readyForRuntime === false ? ['adapter_decision_not_runtime_ready'] : []),
    ...(acceptanceRequired && !acceptanceAccepted ? ['operator_acceptance_required'] : []),
    ...(persistedReady ? [] : ['persisted_status_not_restart_safe']),
    ...stableList(persistedRecovery.blockedReasons).map((reason) => `persisted_status:${reason}`),
    ...(workflowReady ? [] : ['client_workflow_not_ready']),
    ...stableList(clientWorkflowHandoff.blockedReasons).map((reason) => `client_workflow:${reason}`),
    ...(lifecycleReady ? [] : ['lifecycle_command_not_ready']),
    ...stableList(lifecycleCommand.blockedReasons).map((reason) => `lifecycle_command:${reason}`),
    ...stableList(lifecyclePatch.blockedReasons).map((reason) => `lifecycle_patch:${reason}`),
  ]);
  const readyForPersistence = blockedReasons.length === 0;
  const state = readyForPersistence
    ? 'ready_to_persist'
    : acceptanceRequired && !acceptanceAccepted
      ? 'waiting_for_acceptance'
      : persistedReady === false
        ? 'waiting_for_persisted_status'
        : 'blocked';
  const nextAction = readyForPersistence
    ? explicitCommand || 'persist_status_decision'
    : state === 'waiting_for_acceptance'
      ? 'request_operator_acceptance'
      : state === 'waiting_for_persisted_status'
        ? persistedRecovery.nextAction || 'persist_status_snapshot'
        : adapterDecisionEnvelope.nextAction || clientWorkflowHandoff.nextAction || 'inspect_status_decision';

  return {
    protocol: 'aios.status-decision-persistence-envelope.mailchimp.v1',
    persistenceKey,
    requestId: compactString(status.requestId || adapterDecisionEnvelope.requestId),
    tenant: compactString(status.tenant || adapterDecisionEnvelope.tenant),
    action: compactString(status.action || adapterDecisionEnvelope.action),
    state,
    ready: readyForPersistence,
    readyForPersistence,
    nextAction,
    blockedReasons,
    adapterDecision: {
      envelopeKey: compactString(adapterDecisionEnvelope.envelopeKey),
      state: compactString(adapterDecisionEnvelope.state),
      readyForPreview: adapterDecisionEnvelope.readyForPreview === true,
      readyForRuntime: adapterDecisionEnvelope.readyForRuntime === true,
      route: adapterDecisionEnvelope.route || null,
      acceptance: adapterDecisionEnvelope.acceptance || null,
    },
    persistence: {
      persisted: persistedRecovery.persisted === true,
      restartSafe: persistedRecovery.restartSafe !== false,
      replaySafe: persistedRecovery.replaySafe === true,
      snapshotKey: compactString(persistedRecovery.persistedSnapshot?.persistenceKey),
      writeAllowed: persistedRecovery.persistedSnapshot?.write?.allowed !== false,
      nextCommandKey: compactString(persistedRecovery.command?.idempotencyKey || persistedRecovery.idempotency?.nextCommandKey),
    },
    command: {
      requested: explicitCommand || 'observe',
      idempotencyKey: persistenceKey,
      duplicateCommandPolicy: 'dedupe-by-status-decision-persistence-key',
      restartSafe: persistedReady && adapterDecisionEnvelope.restartSemantics?.replaySafe !== false,
      externalWritesPerformed: false,
    },
    route: {
      target: 'status-decision-persistence',
      method: 'POST',
      path: `/mailchimp/status/${encodeURIComponent(status.requestId || adapterDecisionEnvelope.requestId || 'preview')}/decision-persistence`,
      idempotencyKey: persistenceKey,
      primaryAction: nextAction,
      statusRouteState: readyForPersistence ? 'ready' : 'needs_attention',
      requiredBodyKeys: state === 'waiting_for_acceptance'
        ? ['persistenceKey', 'acceptanceToken', 'accepted']
        : ['persistenceKey', 'requestId'],
    },
    clientPatch: {
      statusDecisionPersistenceKey: persistenceKey,
      statusDecisionPersistenceState: state,
      statusDecisionReadyForPersistence: readyForPersistence,
      statusDecisionNextAction: nextAction,
      statusDecisionBlockedReasons: blockedReasons,
    },
    validationSummary: {
      ready: readyForPersistence,
      blocking: blockedReasons.length,
      blockedReasons,
      acceptanceRequired,
      acceptanceAccepted,
      persistedReady,
      workflowReady,
      lifecycleReady,
    },
  };
}

export function buildMailchimpStatusSnapshot(input = {}, runtime = {}) {
  const descriptor = input?.type === 'KernelJobDescriptor' ? input : compileMailchimpAdapterHandoff(input);
  const events = normalizeEvents(runtime.events);
  const history = buildMailchimpAdapterHistorySnapshot(descriptor, runtime.history || runtime.events || []);
  const historySummary = summarizeMailchimpAdapterHistory(history);
  const providerContract = normalizeProviderContract(descriptor, runtime, history);
  const providerServiceContract = buildMailchimpProviderServiceContract(descriptor, runtime);
  const externalHandoffState = buildMailchimpExternalHandoffState(descriptor, runtime, {
    historySummary,
    providerContract,
    providerServiceContract,
  });
  const compileCache = normalizeCompileCacheState(descriptor, runtime);
  const compileCacheAcceptanceChecklist = normalizeCompileCacheAcceptanceChecklist(compileCache, runtime);
  const permissionHealth = buildMailchimpAdapterPermissionHealth(descriptor, runtime);
  const latest = latestMeaningfulEvent(events);
  const readiness = buildReadinessContract(
    descriptor,
    providerContract,
    runtime,
    latest,
    externalHandoffState,
    providerServiceContract,
  );
  const tenantBoundaryHandoff = readiness.tenantBoundaryHandoff
    || buildMailchimpTenantBoundaryHandoff(descriptor, runtime, permissionHealth, providerContract, externalHandoffState);
  const tenantPermissionDecisionBundle = readiness.tenantPermissionDecisionBundle
    || descriptor.tenantPermissionDecisionBundle
    || buildMailchimpTenantPermissionDecisionBundle(descriptor, runtime);
  const tenantBoundaryAuditEnvelope = descriptor.tenantBoundaryAuditEnvelope?.protocol === 'aios.adapter-tenant-boundary-audit-envelope.mailchimp.v1'
    ? buildMailchimpTenantBoundaryAuditEnvelope(descriptor, runtime)
    : buildMailchimpTenantBoundaryAuditEnvelope({
      ...descriptor,
      tenantBoundaryHandoff,
      tenantPermissionDecisionBundle,
    }, runtime);
  const tenantBoundaryContinuity = descriptor.tenantBoundaryContinuity?.protocol === 'aios.adapter-tenant-boundary-continuity.mailchimp.v1'
    ? buildMailchimpTenantBoundaryContinuityContract(descriptor, runtime)
    : buildMailchimpTenantBoundaryContinuityContract({
      ...descriptor,
      boundaryHandoff: tenantBoundaryHandoff,
      tenantPermissionDecisionBundle,
      tenantBoundaryAuditEnvelope,
      permissionHealth,
    }, runtime);
  const lifecycleControlState = readiness.lifecycleControls || normalizeLifecycleControlState(descriptor, runtime);
  const lifecycleCommandState = readiness.lifecycleCommandState
    || buildMailchimpLifecycleCommandState(descriptor, runtime, lifecycleControlState);
  const lifecycleSettingsPatch = readiness.lifecycleSettingsPatch
    || buildMailchimpLifecycleSettingsPatchContract(descriptor, runtime, lifecycleControlState, lifecycleCommandState);
  const clientCommand = buildMailchimpAdapterClientCommand(descriptor, {
    readiness,
    providerContract,
    providerServiceContract,
    permissionBoundary: permissionHealth,
    tenantBoundaryHandoff,
    acceptance: readiness.acceptance,
    requestedAction: lifecycleCommandState.ready === false
      ? lifecycleCommandState.nextAction
      : lifecycleSettingsPatch.ready === false
        ? lifecycleSettingsPatch.nextAction
        : readiness.nextStep,
  });
  const adapterNextStepHandoff = descriptor.nextStepHandoff?.protocol === 'aios.adapter-next-step-handoff.mailchimp.v1'
    ? descriptor.nextStepHandoff
    : buildMailchimpAdapterNextStepHandoff(descriptor, {
      readiness,
      providerContract,
      providerServiceContract,
      permissionBoundary: permissionHealth,
      tenantBoundaryHandoff,
      dispatchReadiness: descriptor.adapterDispatchReadiness,
      clientCommand,
      acceptance: readiness.acceptance,
    });
  const adapterDecisionEnvelope = descriptor.decisionEnvelope?.protocol === 'aios.adapter-decision-envelope.mailchimp.v1'
    ? descriptor.decisionEnvelope
    : buildMailchimpAdapterDecisionEnvelope(descriptor, {
      readiness,
      providerContract,
      providerServiceContract,
      permissionBoundary: permissionHealth,
      tenantBoundaryHandoff,
      dispatchReadiness: descriptor.adapterDispatchReadiness,
      clientCommand,
      nextStepHandoff: adapterNextStepHandoff,
      acceptance: readiness.acceptance,
    });
  const clientRuntimeState = normalizeClientRuntimeState(runtime, descriptor, readiness, clientCommand);
  const runtimeState = normalizeState(runtime.state || latest?.state);
  const diagnosticErrors = (descriptor.diagnostics || []).filter((item) => item.severity === 'error');
  const verifierNames = (descriptor.verifierContracts || []).map((contract) => contract.name);
  const missingVerifierEvidence = verifierNames.filter((name) => !runtime.verifierEvidence?.[name]);
  const blockedByVerifier = missingVerifierEvidence.length > 0 && descriptor.truthBoundary?.externalWritesAllowed;
  const state = diagnosticErrors.length > 0
    ? 'failed'
    : blockedByVerifier
      ? 'waiting_for_verifier'
      : runtimeState;

  const status = {
    protocol: 'aios.status-handoff.mailchimp.v1',
    adapter: 'mailchimp',
    requestId: descriptor.requestId,
    action: descriptor.action,
    tenant: descriptor.tenant,
    state,
    terminal: TERMINAL_STATES.has(state),
    active: ACTIVE_STATES.has(state),
    dryRun: descriptor.dryRun === true,
    truthBoundary: {
      level: descriptor.truthBoundary?.level || 'unknown',
      externalWritesAllowed: descriptor.truthBoundary?.externalWritesAllowed === true,
      missingVerifierEvidence,
      lastObservedTruth: latest?.truth || descriptor.truthBoundary?.level || 'unknown',
    },
    boundaryContract: descriptor.boundaryContract || null,
    permissionHealth,
    tenantBoundaryHandoff,
    tenantPermissionDecisionBundle,
    tenantBoundaryAuditEnvelope,
    tenantBoundaryContinuity,
    progress: {
      totalEvents: events.length,
      latestCode: latest?.code || null,
      latestMessage: latest?.message || null,
      completedVerifierCount: verifierNames.length - missingVerifierEvidence.length,
      requiredVerifierCount: verifierNames.length,
      historyEvents: history.timeline.totalEvents,
      exportReady: history.exportState.ready,
    },
    providerContract,
    providerServiceContract,
    externalHandoff: externalHandoffState,
    compileCache,
    compileCacheAcceptanceChecklist,
    compileCacheLifecycle: compileCache.lifecycle,
    lifecycleControlState,
    lifecycleCommandState,
    lifecycleSettingsPatch,
    lifecycle: descriptor.lifecycle || null,
    readiness,
    clientCommand,
    adapterNextStepHandoff,
    adapterDecisionEnvelope,
    clientRuntimeState,
    ui: {
      preview: readiness.preview,
      acceptance: readiness.acceptance,
      validationSummary: readiness.validationSummary,
      permissionBoundary: permissionHealth,
      tenantBoundaryHandoff,
      tenantBoundaryAuditEnvelope,
      tenantBoundaryContinuity,
      nextStep: readiness.nextStep,
      lifecycleControls: lifecycleControlState,
      lifecycleCommandState,
      lifecycleSettingsPatch,
      clientCommand,
      adapterNextStepHandoff,
      adapterDecisionEnvelope,
      nextStepHandoff: {
        state: adapterNextStepHandoff.state,
        readyForRuntime: adapterNextStepHandoff.readyForRuntime,
        readyForClient: adapterNextStepHandoff.readyForClient,
        primaryAction: adapterNextStepHandoff.primaryAction,
        route: adapterNextStepHandoff.route,
        recoveryCommands: adapterNextStepHandoff.recoveryCommands,
        validationSummary: adapterNextStepHandoff.validationSummary,
      },
      clientRuntimeState,
      providerHandoff: {
        state: externalHandoffState.state,
        ready: externalHandoffState.ready,
        routeState: externalHandoffState.routeState,
        serviceState: providerContract.serviceState,
        leaseState: externalHandoffState.lease.state,
        syncCursor: externalHandoffState.syncMetadata.cursor,
        syncReady: externalHandoffState.syncMetadata.ready,
        syncStale: externalHandoffState.syncMetadata.stale,
        missingCapabilities: externalHandoffState.capabilityNegotiation.missing,
        contractState: providerServiceContract.state,
        nextAction: externalHandoffState.nextAction || providerServiceContract.nextAction,
        serviceNegotiationReady: providerServiceContract.serviceNegotiation?.ready === true,
        serviceBlockedReasons: providerServiceContract.blockedReasons,
        missingScopes: providerServiceContract.resourceAccess?.missingScopes || [],
        missingResources: providerServiceContract.resourceAccess?.missingResources || [],
        syncReplayPolicy: providerServiceContract.sync?.replayPolicy || externalHandoffState.syncMetadata.replayPolicy,
        syncMinSyncedAt: providerServiceContract.sync?.minSyncedAt || '',
        receiptState: externalHandoffState.receipt.state,
        receiptRequired: externalHandoffState.receipt.required,
        receiptAcknowledged: externalHandoffState.receipt.acknowledged,
        blockedReasons: externalHandoffState.blockedReasons,
      },
      compileCache: {
        status: compileCache.status,
        replayed: compileCache.replayed,
        stale: compileCache.stale,
        nextAction: compileCache.nextAction,
        boundaryCheckpoint: compileCache.boundaryCheckpoint,
        replayBarrier: compileCache.replayBarrier,
        persistedReplayState: compileCache.persistedReplayState,
        persistedReplaySummary: compileCache.persistedReplaySummary,
        operationalHealth: compileCache.operationalHealth,
        resumeGate: compileCache.resumeGate,
        exportPackage: compileCache.exportPackage,
        preview: compileCache.uiHandoff.preview,
        readiness: compileCache.uiHandoff.readiness,
        acceptance: compileCache.uiHandoff.acceptance,
        acceptanceChecklist: compileCacheAcceptanceChecklist,
        acceptanceToken: compileCacheAcceptanceChecklist.acceptance.token,
        nextSteps: compileCache.uiHandoff.nextSteps,
        routeHints: compileCache.uiHandoff.routeHints,
        providerSyncCheckpoint: compileCache.providerSyncCheckpoint,
        lifecycleNextAction: compileCache.lifecycle?.nextAction || compileCache.nextAction,
        lifecycleBlocked: compileCache.lifecycle?.blocked === true,
        statusLifecycleControls: lifecycleControlState,
        statusLifecycleCommand: lifecycleCommandState,
        statusLifecycleSettingsPatch: lifecycleSettingsPatch,
        tenantBoundaryHandoff,
        tenantBoundaryAuditEnvelope,
        exportReady: compileCache.exportReady,
        hitRate: compileCache.report.ratios.hitRate,
        timeline: compileCache.report.timeline,
        counters: compileCache.report.counters,
        exportPackageReady: compileCache.exportPackage?.exportReady === true,
        exportPackageId: compileCache.exportPackage?.packageId || '',
        controls: compileCache.lifecycle?.controls || null,
        checklistState: compileCacheAcceptanceChecklist.state,
        checklistBlockingItems: compileCacheAcceptanceChecklist.blockingItems,
        blockedReasons: compileCache.validationSummary.blockedReasons,
      },
    },
    history: {
      summary: historySummary,
      exportState: history.exportState,
      timeline: history.timeline,
      analytics: history.analytics,
    },
    diagnostics: [
      ...(descriptor.diagnostics || []),
      ...providerContract.capabilityNegotiation.missing.map((capability) => ({
        code: 'mailchimp.status.provider_missing_capability',
        severity: 'warning',
        field: 'providerCapabilities',
        message: `Mailchimp provider did not advertise required capability "${capability}".`,
      })),
      ...(['expired', 'missing_token'].includes(providerContract.lease.state) ? [{
        code: 'mailchimp.status.provider_lease_not_ready',
        severity: 'warning',
        field: 'providerLease',
        message: 'Mailchimp provider handoff lease is not ready for restart-safe dispatch.',
      }] : []),
      ...(providerServiceContract.state === 'blocked' ? [{
        code: 'mailchimp.status.provider_service_contract_blocked',
        severity: 'warning',
        field: 'providerServiceContract',
        message: `Mailchimp provider service contract is blocked; next action is "${providerServiceContract.nextAction}".`,
      }] : []),
      ...(providerServiceContract.serviceNegotiation?.ready === false ? [{
        code: 'mailchimp.status.provider_service_negotiation_not_ready',
        severity: providerServiceContract.state === 'blocked' ? 'warning' : 'info',
        field: 'providerServiceContract.serviceNegotiation',
        message: `Mailchimp provider service negotiation requires "${providerServiceContract.serviceNegotiation.nextAction}" before provider handoff.`,
      }] : []),
      ...stableList(providerServiceContract.resourceAccess?.missingScopes).map((scope) => ({
        code: 'mailchimp.status.provider_service_scope_missing',
        severity: 'warning',
        field: 'providerServiceContract.resourceAccess.missingScopes',
        message: `Mailchimp provider service did not advertise required scope "${scope}".`,
      })),
      ...stableList(providerServiceContract.resourceAccess?.missingResources).map((resource) => ({
        code: 'mailchimp.status.provider_service_resource_missing',
        severity: 'warning',
        field: 'providerServiceContract.resourceAccess.missingResources',
        message: `Mailchimp provider service did not advertise required resource "${resource}".`,
      })),
      ...(providerServiceContract.sync?.ready === false ? [{
        code: 'mailchimp.status.provider_service_sync_not_ready',
        severity: 'warning',
        field: 'providerServiceContract.sync',
        message: `Mailchimp provider service sync requires "${providerServiceContract.sync.replayPolicy || 'refresh_provider_sync_before_replay'}" before replay.`,
      }] : []),
      ...(providerServiceContract.externalHandoff?.receiptRequired === true
        && providerServiceContract.externalHandoff?.receiptAcknowledged !== true ? [{
          code: 'mailchimp.status.provider_receipt_not_acknowledged',
          severity: 'warning',
          field: 'providerReceipt',
          message: 'Mailchimp provider receipt has not acknowledged the linked external handoff.',
        }] : []),
      ...(externalHandoffState.ready === false ? [{
        code: 'mailchimp.status.external_handoff_not_ready',
        severity: externalHandoffState.routeState === 'blocked' ? 'warning' : 'info',
        field: 'externalHandoff',
        message: `Mailchimp external handoff requires "${externalHandoffState.nextAction}" before export or replay.`,
      }] : []),
      ...stableList(externalHandoffState.blockedReasons).map((reason) => ({
        code: 'mailchimp.status.external_handoff_blocked',
        severity: reason === 'external_write_handoff_not_ready' ? 'warning' : 'info',
        field: 'externalHandoff.blockedReasons',
        message: `Mailchimp external handoff is blocked by "${reason}".`,
      })),
      ...(compileCache.stale ? [{
        code: 'mailchimp.status.compile_cache_stale',
        severity: 'warning',
        field: 'compileCache',
        message: 'Mailchimp compiled descriptor cache entry is stale and should be refreshed before dispatch or resume.',
      }] : []),
      ...(compileCache.providerSyncCheckpoint?.restartSafe === false ? [{
        code: 'mailchimp.status.compile_cache_provider_sync_not_restart_safe',
        severity: 'warning',
        field: 'compileCache.providerSyncCheckpoint',
        message: `Mailchimp compile cache provider sync checkpoint requires "${compileCache.providerSyncCheckpoint.replayPolicy}" before replay.`,
      }] : []),
      ...(compileCache.boundaryCheckpoint?.restartSafe === false ? [{
        code: 'mailchimp.status.compile_cache_boundary_not_restart_safe',
        severity: 'error',
        field: 'compileCache.boundaryCheckpoint',
        message: `Mailchimp compile cache boundary checkpoint requires "${compileCache.boundaryCheckpoint.nextAction}" before replay.`,
      }] : []),
      ...(compileCache.replayBarrier?.open === false ? [{
        code: 'mailchimp.status.compile_cache_replay_barrier_closed',
        severity: compileCache.replayBarrier?.retry?.exhausted === true ? 'error' : 'warning',
        field: 'compileCache.replayBarrier',
        message: `Mailchimp compile cache replay is blocked until "${compileCache.replayBarrier.nextAction}" completes.`,
      }] : []),
      ...(compileCache.persistedReplaySummary?.restartSafe === false ? [{
        code: 'mailchimp.status.compile_cache_persisted_replay_not_restart_safe',
        severity: 'warning',
        field: 'compileCache.persistedReplayState',
        message: `Mailchimp persisted replay state is "${compileCache.persistedReplaySummary.state}" and requires "${compileCache.persistedReplaySummary.nextAction}" before restart replay.`,
      }] : []),
      ...(compileCache.operationalHealth?.degraded === true ? [{
        code: 'mailchimp.status.compile_cache_operational_health_degraded',
        severity: compileCache.operationalHealth?.retry?.maxAttempts <= compileCache.operationalHealth?.retry?.attempts
          ? 'error'
          : 'warning',
        field: 'compileCache.operationalHealth',
        message: `Mailchimp compile cache health is ${compileCache.operationalHealth.state}; next action is "${compileCache.operationalHealth.nextAction}".`,
      }] : []),
      ...(compileCache.resumeGate?.ready === false ? [{
        code: 'mailchimp.status.compile_cache_resume_gate_blocked',
        severity: compileCache.resumeGate.retry?.exhausted === true ? 'error' : 'warning',
        field: 'compileCache.resumeGate',
        message: `Mailchimp compile cache resume gate is ${compileCache.resumeGate.routeState}; next action is "${compileCache.resumeGate.nextAction}".`,
      }] : []),
      ...(compileCache.lifecycle?.blocked === true ? [{
        code: 'mailchimp.status.compile_cache_lifecycle_blocked',
        severity: compileCache.lifecycle.diagnostics?.some((diagnostic) => diagnostic.severity === 'error')
          ? 'warning'
          : 'info',
        field: 'compileCache.lifecycle',
        message: `Mailchimp compile cache lifecycle is blocked; next action is "${compileCache.lifecycle.nextAction}".`,
      }] : []),
      ...(lifecycleControlState.ready === false ? [{
        code: 'mailchimp.status.lifecycle_controls_not_ready',
        severity: 'warning',
        field: 'lifecycleControlState',
        message: `Mailchimp lifecycle controls require "${lifecycleControlState.nextAction}" before the requested command can continue.`,
      }] : []),
      ...(lifecycleCommandState.ready === false ? [{
        code: 'mailchimp.status.lifecycle_command_blocked',
        severity: 'warning',
        field: 'lifecycleCommandState',
        message: `Mailchimp lifecycle command "${lifecycleCommandState.command}" requires "${lifecycleCommandState.nextAction}" before it can be applied.`,
      }] : []),
      ...(lifecycleSettingsPatch.ready === false ? [{
        code: 'mailchimp.status.lifecycle_settings_patch_blocked',
        severity: 'warning',
        field: 'lifecycleSettingsPatch',
        message: `Mailchimp lifecycle settings patch requires "${lifecycleSettingsPatch.nextAction}" before lifecycle settings can be applied.`,
      }] : []),
      ...stableList(lifecycleSettingsPatch.blockedReasons).map((reason) => ({
        code: 'mailchimp.status.lifecycle_settings_patch_reason',
        severity: reason.includes('invalid') || reason.includes('disabled') ? 'warning' : 'info',
        field: 'lifecycleSettingsPatch.blockedReasons',
        message: `Mailchimp lifecycle settings patch is blocked by "${reason}".`,
      })),
      ...stableList(lifecycleCommandState.blockedReasons).map((reason) => ({
        code: 'mailchimp.status.lifecycle_command_reason',
        severity: reason.includes('unknown') || reason.includes('invalid') ? 'warning' : 'info',
        field: 'lifecycleCommandState.blockedReasons',
        message: `Mailchimp lifecycle command is blocked by "${reason}".`,
      })),
      ...stableList(lifecycleControlState.blockedReasons).map((reason) => ({
        code: 'mailchimp.status.lifecycle_control_blocked',
        severity: 'warning',
        field: 'lifecycleControlState.blockedReasons',
        message: `Mailchimp lifecycle control is blocked by "${reason}".`,
      })),
      ...(permissionHealth.allowed === false ? permissionHealth.actionableErrors.map((item) => ({
        code: item.code,
        severity: item.severity,
        field: 'permissionBoundary',
        message: `Mailchimp permission boundary requires "${item.action}" for ${item.reason}.`,
      })) : []),
      ...(tenantBoundaryHandoff.ready === false ? [{
        code: 'mailchimp.status.tenant_boundary_handoff_blocked',
        severity: 'error',
        field: 'tenantBoundaryHandoff',
        message: `Mailchimp tenant boundary handoff requires "${tenantBoundaryHandoff.nextAction}" before status export, resume, or external write.`,
      }] : []),
      ...stableList(tenantBoundaryHandoff.blockedReasons).map((reason) => ({
        code: 'mailchimp.status.tenant_boundary_handoff_reason',
        severity: reason.includes('missing_permission') || reason.includes('mismatch') ? 'error' : 'warning',
        field: 'tenantBoundaryHandoff.blockedReasons',
        message: `Mailchimp tenant boundary handoff is blocked by "${reason}".`,
      })),
      ...(tenantPermissionDecisionBundle.ready === false ? [{
        code: 'mailchimp.status.tenant_permission_decision_not_ready',
        severity: 'error',
        field: 'tenantPermissionDecisionBundle',
        message: `Mailchimp tenant permission decision requires "${tenantPermissionDecisionBundle.nextAction}" before status export, resume, or external write.`,
      }] : []),
      ...stableList(tenantPermissionDecisionBundle.blockedReasons).map((reason) => ({
        code: `mailchimp.status.tenant_permission.${reason.split(':')[0]}`,
        severity: reason.includes('missing_grant') || reason.includes('denied_grant') || reason.includes('mismatch') ? 'error' : 'warning',
        field: 'tenantPermissionDecisionBundle.blockedReasons',
        message: `Mailchimp tenant permission decision is blocked by "${reason}".`,
      })),
      ...(tenantBoundaryAuditEnvelope.ready === false ? [{
        code: 'mailchimp.status.tenant_boundary_audit_not_ready',
        severity: tenantBoundaryAuditEnvelope.auditRequired ? 'error' : 'warning',
        field: 'tenantBoundaryAuditEnvelope',
        message: `Mailchimp tenant boundary audit requires "${tenantBoundaryAuditEnvelope.nextAction}" before restart-safe resume or external write.`,
      }] : []),
      ...stableList(tenantBoundaryAuditEnvelope.blockedReasons).map((reason) => ({
        code: `mailchimp.status.tenant_boundary_audit.${reason.split(':')[0]}`,
        severity: reason.includes('mismatch') || reason.includes('not_persisted') ? 'error' : 'warning',
        field: 'tenantBoundaryAuditEnvelope.blockedReasons',
        message: `Mailchimp tenant boundary audit is blocked by "${reason}".`,
      })),
      ...(tenantBoundaryContinuity.ready === false ? [{
        code: 'mailchimp.status.tenant_boundary_continuity_not_ready',
        severity: tenantBoundaryContinuity.state === 'waiting_for_audit' ? 'warning' : 'error',
        field: 'tenantBoundaryContinuity',
        message: `Mailchimp tenant boundary continuity is ${tenantBoundaryContinuity.state}; next action is "${tenantBoundaryContinuity.nextAction}".`,
      }] : []),
      ...stableList(tenantBoundaryContinuity.blockedReasons).map((reason) => ({
        code: `mailchimp.status.tenant_boundary_continuity.${reason.split(':')[0]}`,
        severity: reason.includes('mismatch') || reason.includes('not_ready') ? 'error' : 'warning',
        field: 'tenantBoundaryContinuity.blockedReasons',
        message: `Mailchimp tenant boundary continuity is blocked by "${reason}".`,
      })),
      ...(!compileCache.exportReady ? [{
        code: 'mailchimp.status.compile_cache_export_not_ready',
        severity: compileCache.stale ? 'warning' : 'info',
        field: 'compileCache.exportSummary',
        message: 'Mailchimp compile cache export report is not ready for handoff reporting.',
      }] : []),
      ...(compileCache.exportPackage?.exportReady === false ? [{
        code: 'mailchimp.status.compile_cache_export_package_not_ready',
        severity: compileCache.exportPackage.acceptance?.required === true
          && compileCache.exportPackage.acceptance?.accepted !== true
          ? 'warning'
          : 'info',
        field: 'compileCache.exportPackage',
        message: `Mailchimp compile cache export package requires "${compileCache.exportPackage.nextAction}" before client handoff.`,
      }] : []),
      ...(compileCacheAcceptanceChecklist.ready === false ? [{
        code: 'mailchimp.status.compile_cache_acceptance_checklist_blocked',
        severity: compileCacheAcceptanceChecklist.acceptance.required
          && compileCacheAcceptanceChecklist.acceptance.accepted !== true
          ? 'warning'
          : compileCacheAcceptanceChecklist.counts.blocking > 0
            ? 'warning'
            : 'info',
        field: 'compileCache.acceptanceChecklist',
        message: `Mailchimp compile cache acceptance checklist is ${compileCacheAcceptanceChecklist.state}; next action is "${compileCacheAcceptanceChecklist.nextAction}".`,
      }] : []),
      ...(clientCommand.validationSummary.ready === false ? [{
        code: 'mailchimp.status.client_command_blocked',
        severity: ['blocked', 'acceptance_required'].includes(clientCommand.state) ? 'warning' : 'info',
        field: 'clientCommand',
        message: `Mailchimp client command is ${clientCommand.state}; next action is "${clientCommand.submitAction}".`,
      }] : []),
      ...(adapterNextStepHandoff.validationSummary.ready === false ? [{
        code: 'mailchimp.status.adapter_next_step_handoff_blocked',
        severity: adapterNextStepHandoff.state === 'client_acceptance_required' ? 'info' : 'warning',
        field: 'adapterNextStepHandoff',
        message: `Mailchimp adapter next-step handoff is ${adapterNextStepHandoff.state}; next action is "${adapterNextStepHandoff.primaryAction}".`,
      }] : []),
      ...stableList(adapterNextStepHandoff.blockedReasons).map((reason) => ({
        code: 'mailchimp.status.adapter_next_step_handoff_reason',
        severity: reason.includes('tenant_permission') || reason.includes('boundary') ? 'warning' : 'info',
        field: 'adapterNextStepHandoff.blockedReasons',
        message: `Mailchimp adapter next-step handoff is blocked by "${reason}".`,
      })),
      ...(adapterDecisionEnvelope.readyForRuntime === false ? [{
        code: 'mailchimp.status.adapter_decision_envelope_not_ready',
        severity: adapterDecisionEnvelope.state === 'waiting_for_client_acceptance' ? 'info' : 'warning',
        field: 'adapterDecisionEnvelope',
        message: `Mailchimp adapter decision envelope is ${adapterDecisionEnvelope.state}; next action is "${adapterDecisionEnvelope.nextAction}".`,
      }] : []),
      ...stableList(adapterDecisionEnvelope.blockedReasons).map((reason) => ({
        code: 'mailchimp.status.adapter_decision_envelope_reason',
        severity: reason.includes('acceptance') ? 'info' : 'warning',
        field: 'adapterDecisionEnvelope.blockedReasons',
        message: `Mailchimp adapter decision envelope is blocked by "${reason}".`,
      })),
      ...missingVerifierEvidence.map((name) => ({
        code: 'mailchimp.status.missing_verifier_evidence',
        severity: 'warning',
        field: 'verifierEvidence',
        message: `Missing verifier evidence for "${name}".`,
      })),
    ],
    events,
  };
  const persistedRecovery = buildMailchimpPersistedStatusRecoveryState(status, runtime);
  const persistedResumeTicket = buildMailchimpStatusPersistedResumeTicket(status, runtime, persistedRecovery);
  status.persistedRecovery = persistedRecovery;
  status.persistedResumeTicket = persistedResumeTicket;
  status.readiness = {
    ...status.readiness,
    ready: status.readiness?.ready === true && persistedResumeTicket.ready !== false,
    nextStep: persistedResumeTicket.ready === false
      ? persistedResumeTicket.nextAction
      : status.readiness?.nextStep,
  };
  status.ui = {
    ...status.ui,
    persistedRecovery,
    persistedResumeTicket,
  };
  status.diagnostics = [
    ...status.diagnostics,
    ...(persistedRecovery.ready === false ? [{
      code: 'mailchimp.status.persisted_recovery_not_ready',
      severity: persistedRecovery.persisted === true ? 'warning' : 'info',
      field: 'persistedRecovery',
      message: `Mailchimp persisted status recovery requires "${persistedRecovery.nextAction}" before restart-safe resume.`,
    }] : []),
    ...(persistedRecovery.restartSafe === false && persistedRecovery.ready === true ? [{
      code: 'mailchimp.status.persisted_recovery_not_restart_safe',
      severity: 'warning',
      field: 'persistedRecovery',
      message: `Mailchimp persisted status recovery mode "${persistedRecovery.replayMode}" is not restart-safe for this handoff.`,
    }] : []),
    ...(persistedRecovery.persistedSnapshot?.write?.required === true
      && persistedRecovery.persistedSnapshot?.write?.allowed !== true ? [{
        code: 'mailchimp.status.persisted_snapshot_write_blocked',
        severity: 'warning',
        field: 'persistedRecovery.persistedSnapshot.write',
        message: `Mailchimp persisted status snapshot write requires "${persistedRecovery.persistedSnapshot.write.nextAction}" before restart-safe persistence can advance.`,
      }] : []),
    ...stableList(persistedRecovery.persistedSnapshot?.write?.blockedReasons).map((reason) => ({
      code: 'mailchimp.status.persisted_snapshot_write_reason',
      severity: reason.includes('mismatch') ? 'warning' : 'info',
      field: 'persistedRecovery.persistedSnapshot.write.blockedReasons',
      message: `Mailchimp persisted status snapshot write is blocked by "${reason}".`,
    })),
    ...stableList(persistedRecovery.blockedReasons).map((reason) => ({
      code: 'mailchimp.status.persisted_recovery_blocked',
      severity: reason.includes('mismatch') || reason.includes('not_idempotent') ? 'warning' : 'info',
      field: 'persistedRecovery.blockedReasons',
      message: `Mailchimp persisted status recovery is blocked by "${reason}".`,
    })),
    ...(persistedResumeTicket.ready === false ? [{
      code: 'mailchimp.status.persisted_resume_ticket_not_ready',
      severity: persistedResumeTicket.state === 'stale_persisted_ticket' ? 'warning' : 'info',
      field: 'persistedResumeTicket',
      message: `Mailchimp persisted resume ticket requires "${persistedResumeTicket.nextAction}" before restart-safe resume.`,
    }] : []),
    ...stableList(persistedResumeTicket.blockedReasons).map((reason) => ({
      code: 'mailchimp.status.persisted_resume_ticket_blocked',
      severity: reason.includes('mismatch') || reason.includes('not_ready') ? 'warning' : 'info',
      field: 'persistedResumeTicket.blockedReasons',
      message: `Mailchimp persisted resume ticket is blocked by "${reason}".`,
    })),
  ];
  const previewAcceptance = buildMailchimpStatusPreviewAcceptanceContract(status);
  status.previewAcceptance = previewAcceptance;
  status.ui = {
    ...status.ui,
    previewAcceptance,
  };
  const operationalHealth = buildOperationalHealthContract(status);
  const clientWorkflowHandoff = buildMailchimpClientWorkflowHandoff({
    ...status,
    operationalHealth,
  });
  const clientRuntimeAdoption = clientWorkflowHandoff.runtimeAdoption;
  status.clientWorkflowHandoff = clientWorkflowHandoff;
  status.clientRuntimeAdoption = clientRuntimeAdoption;
  const decisionPersistenceEnvelope = buildMailchimpStatusDecisionPersistenceEnvelope({
    ...status,
    adapterDecisionEnvelope,
    previewAcceptance,
    persistedRecovery,
    persistedResumeTicket,
    clientWorkflowHandoff,
  }, runtime);
  status.decisionPersistenceEnvelope = decisionPersistenceEnvelope;
  const analyticsExport = buildMailchimpStatusAnalyticsExportContract({
    ...status,
    operationalHealth,
    clientWorkflowHandoff,
    clientRuntimeAdoption,
    persistedRecovery,
    persistedResumeTicket,
    decisionPersistenceEnvelope,
  });
  status.analyticsExport = analyticsExport;
  status.ui = {
    ...status.ui,
    clientWorkflowHandoff,
    clientRuntimeAdoption,
    decisionPersistenceEnvelope,
    analyticsExport,
  };
  const reporting = buildStatusReportingState({
    ...status,
    operationalHealth,
    clientWorkflowHandoff,
    clientRuntimeAdoption,
    persistedRecovery,
    persistedResumeTicket,
    decisionPersistenceEnvelope,
    analyticsExport,
  });
  return {
    ...status,
    operationalHealth,
    clientWorkflowHandoff,
    clientRuntimeAdoption,
    analyticsExport,
    decisionPersistenceEnvelope,
    reporting,
    analytics: reporting.counters,
    exportSummary: reporting.exportSummary,
    previewAcceptance,
    persistedRecovery,
    persistedResumeTicket,
    ui: {
      ...status.ui,
      previewAcceptance,
      clientWorkflowHandoff,
      clientRuntimeAdoption,
      operationalHealth,
      persistedRecovery,
      persistedResumeTicket,
      decisionPersistenceEnvelope,
      analyticsExport,
      reporting: {
        exportReady: reporting.exportReady,
        nextAction: reporting.nextAction,
        blockedReasons: reporting.blockedReasons,
        counters: reporting.counters,
        ratios: reporting.ratios,
        timeline: reporting.timeline,
        exportSummary: reporting.exportSummary,
      },
    },
  };
}

export function summarizeMailchimpStatus(snapshot) {
  const status = snapshot?.protocol === 'aios.status-handoff.mailchimp.v1'
    ? snapshot
    : buildMailchimpStatusSnapshot(snapshot);

  const blockers = status.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error' || diagnostic.severity === 'warning')
    .map((diagnostic) => diagnostic.code);
  const reporting = status.reporting || buildStatusReportingState(status);
  const lifecycleControlState = status.lifecycleControlState
    || status.readiness?.lifecycleControls
    || normalizeLifecycleControlState(status, {});
  const lifecycleCommandState = status.lifecycleCommandState
    || status.readiness?.lifecycleCommandState
    || buildMailchimpLifecycleCommandState(status, {}, lifecycleControlState);
  const lifecycleSettingsPatch = status.lifecycleSettingsPatch
    || status.readiness?.lifecycleSettingsPatch
    || status.ui?.lifecycleSettingsPatch
    || buildMailchimpLifecycleSettingsPatchContract(status, {}, lifecycleControlState, lifecycleCommandState);
  const previewAcceptance = status.previewAcceptance
    || status.ui?.previewAcceptance
    || buildMailchimpStatusPreviewAcceptanceContract(status);
  const clientWorkflowHandoff = status.clientWorkflowHandoff
    || status.ui?.clientWorkflowHandoff
    || buildMailchimpClientWorkflowHandoff({
      ...status,
      previewAcceptance,
    });
  const clientRuntimeAdoption = status.clientRuntimeAdoption
    || status.ui?.clientRuntimeAdoption
    || clientWorkflowHandoff.runtimeAdoption
    || buildMailchimpClientRuntimeAdoptionContract(status, clientWorkflowHandoff);
  const persistedRecovery = status.persistedRecovery
    || status.ui?.persistedRecovery
    || buildMailchimpPersistedStatusRecoveryState(status);
  const tenantBoundaryHandoff = status.tenantBoundaryHandoff
    || status.readiness?.tenantBoundaryHandoff
    || status.ui?.tenantBoundaryHandoff
    || null;
  const tenantPermissionDecisionBundle = status.tenantPermissionDecisionBundle
    || status.readiness?.tenantPermissionDecisionBundle
    || buildMailchimpTenantPermissionDecisionBundle(status);
  const tenantBoundaryAuditEnvelope = status.tenantBoundaryAuditEnvelope
    || status.ui?.tenantBoundaryAuditEnvelope
    || buildMailchimpTenantBoundaryAuditEnvelope({
      type: 'KernelJobDescriptor',
      adapter: 'mailchimp',
      action: status.action,
      tenant: status.tenant,
      requestId: status.requestId,
      boundaryContract: status.boundaryContract,
      boundaryHandoff: tenantBoundaryHandoff,
      tenantPermissionDecisionBundle,
    });
  const tenantBoundaryContinuity = status.tenantBoundaryContinuity
    || status.ui?.tenantBoundaryContinuity
    || buildMailchimpTenantBoundaryContinuityContract({
      type: 'KernelJobDescriptor',
      adapter: 'mailchimp',
      action: status.action,
      tenant: status.tenant,
      requestId: status.requestId,
      boundaryContract: status.boundaryContract,
      boundaryHandoff: tenantBoundaryHandoff,
      tenantPermissionDecisionBundle,
      tenantBoundaryAuditEnvelope,
    });
  const operationalHealth = status.operationalHealth || buildOperationalHealthContract(status);
  const analyticsExport = status.analyticsExport
    || status.ui?.analyticsExport
    || reporting.analyticsExport
    || buildMailchimpStatusAnalyticsExportContract({
      ...status,
      persistedRecovery,
      operationalHealth,
      clientWorkflowHandoff,
      clientRuntimeAdoption,
    });
  const adapterNextStepHandoff = status.adapterNextStepHandoff
    || status.ui?.adapterNextStepHandoff
    || status.ui?.nextStepHandoff
    || null;

  return {
    ok: blockers.length === 0 && status.state !== 'failed',
    requestId: status.requestId,
    state: status.state,
    terminal: status.terminal,
    canRecover: status.state === 'failed' || status.state === 'waiting_for_verifier',
    canRollback: status.truthBoundary.externalWritesAllowed && ['running', 'failed', 'succeeded'].includes(status.state),
    blockers,
    truthBoundary: status.truthBoundary,
    permissionBoundary: status.permissionHealth || buildMailchimpAdapterPermissionHealth(status),
    tenantBoundaryHandoff,
    tenantBoundaryAuditEnvelope: {
      protocol: tenantBoundaryAuditEnvelope.protocol || 'aios.adapter-tenant-boundary-audit-envelope.mailchimp.v1',
      envelopeKey: compactString(tenantBoundaryAuditEnvelope.envelopeKey),
      state: compactString(tenantBoundaryAuditEnvelope.state || 'unknown'),
      ready: tenantBoundaryAuditEnvelope.ready === true,
      auditRequired: tenantBoundaryAuditEnvelope.auditRequired === true,
      auditReady: tenantBoundaryAuditEnvelope.auditReady === true,
      nextAction: compactString(tenantBoundaryAuditEnvelope.nextAction || 'inspect_permission_boundary'),
      blockedReasons: stableList(tenantBoundaryAuditEnvelope.blockedReasons),
      audit: tenantBoundaryAuditEnvelope.audit || null,
      route: tenantBoundaryAuditEnvelope.route || null,
      clientPatch: tenantBoundaryAuditEnvelope.clientPatch || null,
      restartSemantics: tenantBoundaryAuditEnvelope.restartSemantics || null,
    },
    tenantBoundaryContinuity: {
      protocol: tenantBoundaryContinuity.protocol || 'aios.adapter-tenant-boundary-continuity.mailchimp.v1',
      continuityKey: compactString(tenantBoundaryContinuity.continuityKey),
      state: compactString(tenantBoundaryContinuity.state || 'unknown'),
      ready: tenantBoundaryContinuity.ready === true,
      restartSafe: tenantBoundaryContinuity.restartSafe !== false,
      nextAction: compactString(tenantBoundaryContinuity.nextAction || 'inspect_permission_boundary'),
      blockedReasons: stableList(tenantBoundaryContinuity.blockedReasons),
      counters: tenantBoundaryContinuity.counters || {},
      audit: tenantBoundaryContinuity.audit || null,
      scope: tenantBoundaryContinuity.scope || null,
    },
    tenantPermissionDecisionBundle: {
      protocol: tenantPermissionDecisionBundle.protocol || 'aios.adapter-tenant-permission-decision-bundle.mailchimp.v1',
      decisionKey: compactString(tenantPermissionDecisionBundle.decisionKey),
      status: compactString(tenantPermissionDecisionBundle.status || 'unknown'),
      ready: tenantPermissionDecisionBundle.ready === true,
      allowedForRuntime: tenantPermissionDecisionBundle.allowedForRuntime === true,
      nextAction: compactString(tenantPermissionDecisionBundle.nextAction || 'inspect_permission_boundary'),
      blockedReasons: stableList(tenantPermissionDecisionBundle.blockedReasons),
      audit: tenantPermissionDecisionBundle.audit || null,
      clientPatch: tenantPermissionDecisionBundle.clientPatch || null,
    },
    provider: {
      state: status.providerContract?.serviceState || 'unknown',
      capabilitySatisfied: status.providerContract?.capabilityNegotiation?.satisfied !== false,
      externalHandoffState: status.externalHandoff?.state || 'local_only',
      externalHandoffReady: status.externalHandoff?.ready !== false,
      externalHandoffNextAction: status.externalHandoff?.nextAction || 'observe',
      syncStale: status.providerContract?.sync?.stale === true,
      syncReady: status.providerContract?.sync?.ready !== false,
      externalSyncReady: status.externalHandoff?.syncMetadata?.ready !== false,
      externalSyncStale: status.externalHandoff?.syncMetadata?.stale === true,
      leaseState: status.providerContract?.lease?.state || 'unknown',
      restartSafe: status.externalHandoff?.restartSafe !== false,
      externalRequestId: status.externalHandoff?.requestId || '',
      receiptState: status.externalHandoff?.receipt?.state || 'missing',
      receiptAcknowledged: status.externalHandoff?.receipt?.acknowledged === true
        || status.externalHandoff?.receiptAcknowledged === true,
      receiptRequired: status.externalHandoff?.receipt?.required === true
        || status.externalHandoff?.receiptRequired === true,
      blockedReasons: stableList(status.externalHandoff?.blockedReasons),
    },
    providerServiceContract: status.providerServiceContract || {
      protocol: 'aios.provider-service-contract.mailchimp.v1',
      provider: status.providerContract?.provider || 'mailchimp',
      service: status.providerContract?.service || 'mailchimp-marketing',
      state: status.providerContract?.capabilityNegotiation?.satisfied === false
        || status.providerContract?.serviceState === 'offline'
        ? 'blocked'
        : status.providerContract?.sync?.stale === true
          ? 'degraded'
          : 'ready',
      serviceState: status.providerContract?.serviceState || 'unknown',
      restartSafe: status.externalHandoff?.restartSafe !== false,
      nextAction: status.providerContract?.capabilityNegotiation?.satisfied === false
        ? 'refresh_provider_contract'
        : status.providerContract?.sync?.stale === true
          ? 'refresh_provider_sync_before_replay'
          : 'observe',
      blockedReasons: stableList([
        ...(status.providerContract?.serviceState === 'offline' ? ['provider_offline'] : []),
        ...(status.providerContract?.capabilityNegotiation?.missing || []).map((capability) => `missing_capability:${capability}`),
        ...(status.providerContract?.sync?.stale === true ? ['provider_sync_stale'] : []),
      ]),
    },
    providerServiceNegotiation: status.providerServiceContract?.serviceNegotiation || null,
    compileCache: status.compileCache || normalizeCompileCacheState(status),
    compileCacheReport: status.compileCache?.report || normalizeCompileCacheReport(status.compileCache),
    compileCacheExportPackage: status.compileCache?.exportPackage || null,
    compileCacheUiHandoff: status.compileCache?.uiHandoff || null,
    compileCacheBoundaryCheckpoint: status.compileCache?.boundaryCheckpoint || null,
    compileCacheReplayBarrier: status.compileCache?.replayBarrier || null,
    compileCachePersistedReplayState: status.compileCache?.persistedReplayState || null,
    compileCachePersistedReplaySummary: status.compileCache?.persistedReplaySummary || null,
    compileCacheResumeGate: status.compileCache?.resumeGate || null,
    compileCacheAcceptanceChecklist: status.compileCacheAcceptanceChecklist
      || status.compileCache?.uiHandoff?.acceptanceChecklist
      || null,
    persistedRecovery,
    lifecycleControls: {
      protocol: lifecycleControlState.protocol || 'aios.status-lifecycle-controls.mailchimp.v1',
      ready: lifecycleControlState.ready !== false,
      requestedCommand: lifecycleControlState.requestedCommand || status.lifecycle?.requestedCommand || 'queue',
      nextAction: lifecycleControlState.nextAction || status.readiness?.nextStep || 'inspect_status',
      blockedReasons: stableList(lifecycleControlState.blockedReasons),
      controls: lifecycleControlState.controls || {},
      schedule: lifecycleControlState.schedule || {},
    },
    lifecycleCommandState: {
      protocol: lifecycleCommandState.protocol || 'aios.status-lifecycle-command.mailchimp.v1',
      ready: lifecycleCommandState.ready !== false,
      command: lifecycleCommandState.command || lifecycleControlState.requestedCommand || 'queue',
      state: lifecycleCommandState.state || 'ready',
      nextAction: lifecycleCommandState.nextAction || lifecycleControlState.nextAction || 'inspect_status',
      blockedReasons: stableList(lifecycleCommandState.blockedReasons),
      effects: lifecycleCommandState.effects || { count: 0, list: [] },
      audit: lifecycleCommandState.audit || null,
    },
    lifecycleSettingsPatch: {
      protocol: lifecycleSettingsPatch.protocol || 'aios.status-lifecycle-settings-patch.mailchimp.v1',
      ready: lifecycleSettingsPatch.ready !== false,
      state: lifecycleSettingsPatch.state || 'noop',
      command: lifecycleSettingsPatch.command || lifecycleCommandState.command || 'queue',
      nextAction: lifecycleSettingsPatch.nextAction || 'observe',
      appliesSettings: lifecycleSettingsPatch.appliesSettings === true,
      changedFields: stableList(lifecycleSettingsPatch.changedFields),
      blockedReasons: stableList(lifecycleSettingsPatch.blockedReasons),
      desired: lifecycleSettingsPatch.desired || {},
      audit: lifecycleSettingsPatch.audit || null,
    },
    clientCommand: status.clientCommand || status.ui?.clientCommand || null,
    adapterNextStepHandoff: adapterNextStepHandoff
      ? {
        protocol: adapterNextStepHandoff.protocol || 'aios.adapter-next-step-handoff.mailchimp.v1',
        handoffKey: compactString(adapterNextStepHandoff.handoffKey),
        state: compactString(adapterNextStepHandoff.state || adapterNextStepHandoff.route?.state || 'unknown'),
        readyForRuntime: adapterNextStepHandoff.readyForRuntime === true,
        readyForClient: adapterNextStepHandoff.readyForClient === true,
        primaryAction: compactString(adapterNextStepHandoff.primaryAction || adapterNextStepHandoff.route?.primaryAction || 'inspect_mailchimp_handoff'),
        recoveryCommands: stableList(adapterNextStepHandoff.recoveryCommands),
        blockedReasons: stableList(adapterNextStepHandoff.blockedReasons || adapterNextStepHandoff.validationSummary?.blockedReasons),
        acceptance: adapterNextStepHandoff.acceptance || null,
        provider: adapterNextStepHandoff.provider || null,
        tenantPermission: adapterNextStepHandoff.tenantPermission || null,
        lifecycle: adapterNextStepHandoff.lifecycle || null,
        route: adapterNextStepHandoff.route || null,
        validationSummary: adapterNextStepHandoff.validationSummary || null,
        clientPatch: adapterNextStepHandoff.clientPatch || null,
      }
      : null,
    clientRuntimeState: status.clientRuntimeState || status.ui?.clientRuntimeState || null,
    previewAcceptance,
    clientWorkflowHandoff,
    clientRuntimeAdoption,
    operationalHealth,
    operationalHealthRecoveryPlan: operationalHealth.recoveryPlan,
    operationalHealthIncident: operationalHealth.incident,
    analyticsExport,
    analyticsHistorySnapshot: analyticsExport.historySnapshot,
    readiness: {
      ready: status.readiness?.ready === true
        && status.externalHandoff?.ready !== false
        && tenantBoundaryHandoff?.ready !== false
        && persistedRecovery.ready !== false
        && lifecycleControlState.ready !== false
        && lifecycleCommandState.ready !== false
        && lifecycleSettingsPatch.ready !== false
        && adapterNextStepHandoff?.readyForRuntime !== false
        && status.compileCache?.resumeGate?.ready !== false
        && previewAcceptance.ready !== false
        && clientWorkflowHandoff.ready !== false
        && clientRuntimeAdoption.ready !== false
        && (status.compileCacheAcceptanceChecklist?.ready !== false),
      nextStep: status.externalHandoff?.ready === false && status.externalHandoff.nextAction
        ? status.externalHandoff.nextAction
        : tenantBoundaryHandoff?.ready === false
        ? tenantBoundaryHandoff.nextAction
        : persistedRecovery.ready === false
        ? persistedRecovery.nextAction
        : lifecycleCommandState.ready === false
        ? lifecycleCommandState.nextAction
        : lifecycleSettingsPatch.ready === false
        ? lifecycleSettingsPatch.nextAction
        : lifecycleControlState.ready === false
        ? lifecycleControlState.nextAction
        : adapterNextStepHandoff?.readyForRuntime === false
        ? adapterNextStepHandoff.primaryAction || adapterNextStepHandoff.route?.primaryAction
        : status.compileCache?.resumeGate?.ready === false
        ? status.compileCache.resumeGate.nextAction
        : previewAcceptance.ready === false
        ? previewAcceptance.route.primaryAction
        : clientWorkflowHandoff.ready === false
        ? clientWorkflowHandoff.primaryAction
        : clientRuntimeAdoption.ready === false
        ? clientRuntimeAdoption.visibleAction
        : status.compileCacheAcceptanceChecklist?.ready === false
          ? status.compileCacheAcceptanceChecklist.nextAction
        : status.clientCommand?.submitAction || status.readiness?.nextStep || 'inspect_status',
      validationSummary: status.readiness?.validationSummary || summarizeDiagnostics(status.diagnostics),
    },
    reporting,
    exportSummary: status.exportSummary || reporting.exportSummary,
    analyticsExportSummary: analyticsExport.exportSummary,
    exportReady: reporting.exportReady === true,
    previewAcceptanceReady: previewAcceptance.ready === true,
    compileCacheExportReady: status.compileCache?.exportPackage?.exportReady === true
      || status.compileCache?.exportReady === true,
  };
}

export function mergeMailchimpStatusEvents(snapshot, nextEvents = []) {
  const current = snapshot?.protocol === 'aios.status-handoff.mailchimp.v1'
    ? snapshot
    : buildMailchimpStatusSnapshot(snapshot);
  const events = [...current.events, ...normalizeEvents(nextEvents)];
  const latest = latestMeaningfulEvent(events);
  const merged = {
    ...current,
    state: normalizeState(latest?.state || current.state),
    terminal: TERMINAL_STATES.has(normalizeState(latest?.state || current.state)),
    active: ACTIVE_STATES.has(normalizeState(latest?.state || current.state)),
    progress: {
      ...current.progress,
      totalEvents: events.length,
      latestCode: latest?.code || current.progress.latestCode,
      latestMessage: latest?.message || current.progress.latestMessage,
    },
    history: current.history,
    providerContract: current.providerContract,
    externalHandoff: current.externalHandoff,
    tenantBoundaryHandoff: current.tenantBoundaryHandoff,
    lifecycleCommandState: current.lifecycleCommandState,
    lifecycleSettingsPatch: current.lifecycleSettingsPatch,
    persistedRecovery: current.persistedRecovery,
    clientCommand: current.clientCommand,
    clientRuntimeState: current.clientRuntimeState || current.ui?.clientRuntimeState,
    previewAcceptance: current.previewAcceptance,
    ui: current.ui,
    events,
  };
  const persistedSource = current.persistedRecovery?.protocol === 'aios.status-persisted-recovery.mailchimp.v1'
    ? {
      requestId: current.persistedRecovery.persistedSnapshot?.requestId
        || current.persistedRecovery.request?.persistedRequestId
        || current.persistedRecovery.request?.requestId
        || current.requestId,
      state: current.persistedRecovery.persistedSnapshot?.state
        || current.persistedRecovery.continuity?.state
        || current.state,
      command: current.persistedRecovery.persistedSnapshot?.command
        || current.persistedRecovery.command?.persisted
        || current.persistedRecovery.command?.requested,
      idempotencyKey: current.persistedRecovery.persistedSnapshot?.idempotencyKey
        || current.persistedRecovery.command?.idempotencyKey,
      eventCount: current.persistedRecovery.persistedSnapshot?.cursor?.eventCount
        || current.persistedRecovery.cursor?.persistedEventCount,
      latestEventIndex: current.persistedRecovery.persistedSnapshot?.cursor?.latestEventIndex
        || current.persistedRecovery.cursor?.persistedLatestIndex,
      latestAt: current.persistedRecovery.persistedSnapshot?.cursor?.latestAt
        || current.persistedRecovery.cursor?.latestPersistedAt,
      externalRequestId: current.persistedRecovery.persistedSnapshot?.continuity?.externalRequestId
        || current.persistedRecovery.continuity?.persistedExternalRequestId,
      syncCursor: current.persistedRecovery.persistedSnapshot?.continuity?.syncCursor
        || current.persistedRecovery.continuity?.persistedSyncCursor,
      cacheKey: current.persistedRecovery.persistedSnapshot?.continuity?.cacheKey
        || current.persistedRecovery.continuity?.persistedCacheKey,
      tenant: current.persistedRecovery.persistedSnapshot?.continuity?.tenant
        || current.persistedRecovery.continuity?.persistedTenant
        || current.tenantBoundaryHandoff?.tenant?.effective
        || current.tenant,
      workspace: current.persistedRecovery.persistedSnapshot?.continuity?.workspace
        || current.persistedRecovery.continuity?.persistedWorkspace
        || current.tenantBoundaryHandoff?.workspace?.effective,
      sequence: current.persistedRecovery.persistedSnapshot?.cursor?.sequence
        || current.persistedRecovery.cursor?.persistedSequence,
    }
    : null;
  const persistedRecovery = buildMailchimpPersistedStatusRecoveryState(merged, {
    persistedStatus: persistedSource,
    statusCommand: current.persistedRecovery?.command?.requested || current.lifecycleControlState?.requestedCommand,
  });
  merged.persistedRecovery = persistedRecovery;
  merged.ui = {
    ...merged.ui,
    persistedRecovery,
  };
  const previewAcceptance = buildMailchimpStatusPreviewAcceptanceContract(merged);
  merged.previewAcceptance = previewAcceptance;
  merged.ui = {
    ...merged.ui,
    previewAcceptance,
  };
  const operationalHealth = buildOperationalHealthContract(merged);
  const clientWorkflowHandoff = buildMailchimpClientWorkflowHandoff({
    ...merged,
    operationalHealth,
  });
  const clientRuntimeAdoption = clientWorkflowHandoff.runtimeAdoption;
  merged.clientWorkflowHandoff = clientWorkflowHandoff;
  merged.clientRuntimeAdoption = clientRuntimeAdoption;
  const analyticsExport = buildMailchimpStatusAnalyticsExportContract({
    ...merged,
    operationalHealth,
    clientWorkflowHandoff,
    clientRuntimeAdoption,
    persistedRecovery,
  });
  merged.analyticsExport = analyticsExport;
  merged.ui = {
    ...merged.ui,
    clientWorkflowHandoff,
    clientRuntimeAdoption,
    analyticsExport,
  };
  const reporting = buildStatusReportingState({
    ...merged,
    operationalHealth,
    clientWorkflowHandoff,
    clientRuntimeAdoption,
    persistedRecovery,
    analyticsExport,
  });
  return {
    ...merged,
    operationalHealth,
    clientWorkflowHandoff,
    clientRuntimeAdoption,
    analyticsExport,
    reporting,
    analytics: reporting.counters,
    exportSummary: reporting.exportSummary,
    previewAcceptance,
    persistedRecovery,
    ui: {
      ...merged.ui,
      previewAcceptance,
      clientWorkflowHandoff,
      clientRuntimeAdoption,
      operationalHealth,
      persistedRecovery,
      analyticsExport,
      reporting: {
        exportReady: reporting.exportReady,
        nextAction: reporting.nextAction,
        blockedReasons: reporting.blockedReasons,
        counters: reporting.counters,
        ratios: reporting.ratios,
        timeline: reporting.timeline,
        exportSummary: reporting.exportSummary,
      },
    },
  };
}

export { ACTIVE_STATES, TERMINAL_STATES };
