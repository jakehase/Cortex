import { compileMailchimpArtifactBinding } from './artifact-binding.mjs';
import {
  buildMailchimpSyscallDescriptor,
  MAILCHIMP_SYSCALLS,
} from '../stdlib/syscalls.mjs';

const PANIC_SEVERITIES = new Set(['warning', 'error', 'critical']);
const PANIC_LIFECYCLE_COMMANDS = Object.freeze([
  'panic.hold',
  'panic.retry',
  'panic.release-hold',
  'artifact.client-preview.dispatch',
  'client.collect_acceptance',
  'resume_after_panic_review',
]);
const PANIC_SCHEDULE_MODES = new Set(['immediate', 'manual', 'delayed', 'maintenance_window', 'disabled']);
const PANIC_PROVIDER_CAPABILITIES = Object.freeze([
  'panic.hold_external_writes',
  'panic.recover_artifact_writes',
  'panic.degraded_client_preview',
  'panic.retry_with_backoff',
  'panic.audit_handoff',
]);

function compactString(value) {
  return String(value ?? '').trim();
}

function stableList(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(list.map(compactString).filter(Boolean))].sort();
}

function stableObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.keys(value).sort().reduce((next, key) => {
    const normalizedKey = compactString(key);
    if (!normalizedKey || value[key] === undefined) return next;
    const raw = value[key];
    next[normalizedKey] = Array.isArray(raw)
      ? raw.map((item) => (item && typeof item === 'object' ? stableObject(item) : item))
      : raw && typeof raw === 'object'
        ? stableObject(raw)
        : raw;
    return next;
  }, {});
}

function stableHash(value) {
  const source = JSON.stringify(stableObject(value));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function positiveInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function normalizePanicLifecycleSettings(raw = {}) {
  const source = raw.lifecycleControls && typeof raw.lifecycleControls === 'object'
    ? raw.lifecycleControls
    : raw.controls && typeof raw.controls === 'object'
      ? raw.controls
      : raw.settings && typeof raw.settings === 'object'
        ? raw.settings
        : {};
  const scheduleSource = source.schedule && typeof source.schedule === 'object'
    ? source.schedule
    : raw.schedule && typeof raw.schedule === 'object'
      ? raw.schedule
      : {};
  const rawMode = compactString(scheduleSource.mode || source.scheduleMode || 'immediate')
    .toLowerCase()
    .replaceAll('-', '_');
  const disabledCommands = stableList(source.disabledCommands || raw.disabledCommands);
  const explicitEnabled = stableList(source.enabledCommands || raw.enabledCommands);
  const knownEnabled = explicitEnabled.length
    ? explicitEnabled.filter((command) => PANIC_LIFECYCLE_COMMANDS.includes(command))
    : PANIC_LIFECYCLE_COMMANDS.filter((command) => !disabledCommands.includes(command));

  return {
    protocol: 'aios.panic-lifecycle-settings.mailchimp.v1',
    enabled: source.enabled !== false && raw.enabled !== false,
    mode: compactString(source.mode || raw.mode || 'guarded-recovery') || 'guarded-recovery',
    operatorRequired: source.operatorRequired !== false && raw.requireOperator !== false,
    holdExternalWrites: source.holdExternalWrites !== false && raw.holdExternalWrites !== false,
    allowDegradedPreview: source.allowDegradedPreview === true || raw.allowDegradedClientPreview === true,
    disabledCommands,
    enabledCommands: knownEnabled,
    schedule: {
      mode: PANIC_SCHEDULE_MODES.has(rawMode) ? rawMode : 'immediate',
      notBefore: compactString(scheduleSource.notBefore || scheduleSource.startsAt || source.notBefore),
      notAfter: compactString(scheduleSource.notAfter || scheduleSource.expiresAt || source.notAfter),
      retryAfterSeconds: positiveInteger(
        scheduleSource.retryAfterSeconds
          ?? scheduleSource.delaySeconds
          ?? source.retryAfterSeconds,
        0,
      ),
      maintenanceWindow: compactString(scheduleSource.maintenanceWindow || source.maintenanceWindow),
    },
    audit: {
      actor: compactString(source.actor || source.actorId || raw.actor || raw.actorId),
      reasonCode: compactString(source.reasonCode || raw.reasonCode || raw.code),
      sink: compactString(source.auditSink || raw.auditSink || 'local-runtime-audit'),
    },
  };
}

function normalizePanicProviderService(raw = {}, runtime = {}) {
  const source = raw.providerService && typeof raw.providerService === 'object'
    ? raw.providerService
    : raw.serviceContract && typeof raw.serviceContract === 'object'
      ? raw.serviceContract
      : runtime.providerService && typeof runtime.providerService === 'object'
        ? runtime.providerService
        : runtime.serviceContract && typeof runtime.serviceContract === 'object'
          ? runtime.serviceContract
          : {};
  const sync = source.sync && typeof source.sync === 'object'
    ? source.sync
    : source.syncMetadata && typeof source.syncMetadata === 'object'
      ? source.syncMetadata
      : {};
  const endpoint = source.endpoint && typeof source.endpoint === 'object' ? source.endpoint : {};
  const capabilities = stableList(source.capabilities || source.enabledCapabilities);
  const disabledCapabilities = stableList(source.disabledCapabilities || source.deniedCapabilities);

  return {
    protocol: 'aios.panic-provider-service-input.mailchimp.v1',
    provider: compactString(source.provider || raw.provider || runtime.provider || 'mailchimp') || 'mailchimp',
    service: compactString(source.service || source.name || 'mailchimp-panic-runtime') || 'mailchimp-panic-runtime',
    version: compactString(source.version || source.contractVersion || '1') || '1',
    endpoint: {
      region: compactString(endpoint.region || source.region || runtime.region || 'local'),
      route: compactString(endpoint.route || source.route || '/runtime/mailchimp/panic'),
      external: endpoint.external === true || source.external === true,
    },
    sync: {
      cursor: compactString(sync.cursor || sync.syncCursor || source.cursor),
      observedAt: compactString(sync.observedAt || sync.checkedAt || source.observedAt),
      status: compactString(sync.status || sync.state || 'observed').toLowerCase().replaceAll('-', '_'),
      lastProviderRequestId: compactString(sync.lastProviderRequestId || sync.requestId || source.lastProviderRequestId),
      consecutiveFailures: positiveInteger(sync.consecutiveFailures ?? source.consecutiveFailures, 0),
    },
    capabilities,
    disabledCapabilities,
    externalHandoff: {
      target: compactString(source.externalHandoff?.target || source.handoffTarget || 'operator-console'),
      queue: compactString(source.externalHandoff?.queue || source.queue || 'panic-review'),
      status: compactString(source.externalHandoff?.status || source.handoffStatus || 'not_started'),
      correlationId: compactString(source.externalHandoff?.correlationId || source.correlationId),
    },
  };
}

function validatePanicLifecycleSettings(settings) {
  const diagnostics = [];
  const unknownDisabled = settings.disabledCommands.filter((command) => !PANIC_LIFECYCLE_COMMANDS.includes(command));
  const allResumeDisabled = ['panic.retry', 'artifact.client-preview.dispatch', 'resume_after_panic_review']
    .every((command) => !settings.enabledCommands.includes(command));

  if (unknownDisabled.length > 0) {
    diagnostics.push({
      code: 'mailchimp.panic_binding.lifecycle_unknown_command',
      severity: 'warning',
      field: 'lifecycleControls.disabledCommands',
      message: `Mailchimp panic lifecycle controls include unknown commands: ${unknownDisabled.join(', ')}.`,
    });
  }
  if (settings.enabled === false) {
    diagnostics.push({
      code: 'mailchimp.panic_binding.lifecycle_disabled',
      severity: 'error',
      field: 'lifecycleControls.enabled',
      message: 'Mailchimp panic lifecycle controls are disabled, so recovery commands cannot be scheduled.',
    });
  }
  if (settings.schedule.mode === 'disabled') {
    diagnostics.push({
      code: 'mailchimp.panic_binding.schedule_disabled',
      severity: 'error',
      field: 'lifecycleControls.schedule.mode',
      message: 'Mailchimp panic lifecycle schedule is disabled.',
    });
  }
  if (settings.schedule.mode === 'maintenance_window' && !settings.schedule.maintenanceWindow) {
    diagnostics.push({
      code: 'mailchimp.panic_binding.maintenance_window_missing',
      severity: 'warning',
      field: 'lifecycleControls.schedule.maintenanceWindow',
      message: 'Mailchimp panic lifecycle maintenance-window scheduling requires a stable maintenanceWindow value.',
    });
  }
  if (settings.schedule.notBefore && settings.schedule.notAfter && settings.schedule.notBefore > settings.schedule.notAfter) {
    diagnostics.push({
      code: 'mailchimp.panic_binding.schedule_window_inverted',
      severity: 'error',
      field: 'lifecycleControls.schedule',
      message: 'Mailchimp panic lifecycle schedule notBefore is after notAfter.',
    });
  }
  if (allResumeDisabled) {
    diagnostics.push({
      code: 'mailchimp.panic_binding.resume_commands_disabled',
      severity: 'error',
      field: 'lifecycleControls.enabledCommands',
      message: 'Mailchimp panic lifecycle controls disable every resume path.',
    });
  }

  return diagnostics;
}

function normalizePanicInput(input = {}, runtime = {}) {
  const raw = input && typeof input === 'object' ? input : { reason: String(input ?? '') };
  const severity = compactString(raw.severity || raw.level || 'error').toLowerCase();
  const retryPolicy = raw.retryPolicy && typeof raw.retryPolicy === 'object' ? raw.retryPolicy : {};
  const history = Array.isArray(raw.history)
    ? raw.history
    : Array.isArray(raw.timeline)
      ? raw.timeline
      : [];
  const lifecycleSettings = normalizePanicLifecycleSettings(raw);
  return {
    reason: compactString(raw.reason || raw.message || 'Mailchimp runtime panic requested.'),
    severity: PANIC_SEVERITIES.has(severity) ? severity : 'error',
    source: compactString(raw.source || 'runtime'),
    issueCodes: stableList(raw.issueCodes || raw.codes || raw.code),
    holdExternalWrites: raw.holdExternalWrites !== false,
    requireOperator: raw.requireOperator !== false,
    allowResumeWithPendingAcceptance: raw.allowResumeWithPendingAcceptance === true,
    allowDegradedClientPreview: raw.allowDegradedClientPreview !== false,
    artifactInput: raw.artifactInput && typeof raw.artifactInput === 'object' ? raw.artifactInput : {},
    retryPolicy: {
      retryable: retryPolicy.retryable !== false,
      maxAttempts: Number.isFinite(Number(retryPolicy.maxAttempts ?? retryPolicy.limit))
        ? Math.max(0, Math.floor(Number(retryPolicy.maxAttempts ?? retryPolicy.limit)))
        : 3,
      retryAfterSeconds: Number.isFinite(Number(retryPolicy.retryAfterSeconds ?? retryPolicy.nextRetryDelaySeconds))
        ? Math.max(0, Math.floor(Number(retryPolicy.retryAfterSeconds ?? retryPolicy.nextRetryDelaySeconds)))
        : 0,
      backoff: compactString(retryPolicy.backoff || 'exponential-with-jitter'),
    },
    lifecycleSettings,
    providerService: normalizePanicProviderService(raw, runtime),
    lifecycleDiagnostics: validatePanicLifecycleSettings(lifecycleSettings),
    history: history.map((entry, index) => ({
      index,
      phase: compactString(entry?.phase || entry?.type || 'observed'),
      state: compactString(entry?.state || entry?.status || 'unknown'),
      issueCode: compactString(entry?.issueCode || entry?.code),
      at: compactString(entry?.at || entry?.timestamp),
      digest: compactString(entry?.digest) || `fnv1a32:${stableHash({
        index,
        phase: entry?.phase || entry?.type,
        state: entry?.state || entry?.status,
        issueCode: entry?.issueCode || entry?.code,
        at: entry?.at || entry?.timestamp,
      })}`,
    })),
    metadata: stableObject(raw.metadata),
  };
}

function collectArtifactGateIssues(input, artifactBinding) {
  const gates = artifactBinding.exportContract?.gates || artifactBinding.gateHandoff || {};
  const blockedReasons = stableList(gates.blockedReasons);
  const issues = [];

  if (gates.ready === false) {
    issues.push({
      code: 'mailchimp.panic_binding.artifact_gate_not_ready',
      severity: gates.state === 'waiting_for_acceptance' && input.allowResumeWithPendingAcceptance ? 'warning' : 'error',
      field: 'artifactBinding.exportContract.gates',
      message: 'Mailchimp panic recovery cannot resume until artifact gates are ready or explicitly allowed for pending acceptance.',
    });
  }
  if (gates.acceptance?.missingKeys?.length > 0 && input.allowResumeWithPendingAcceptance !== true) {
    issues.push({
      code: 'mailchimp.panic_binding.artifact_acceptance_missing',
      severity: 'error',
      field: 'artifactBinding.exportContract.gates.acceptance',
      message: 'Mailchimp panic recovery requires artifact acceptance keys before resuming writes.',
    });
  }
  if (gates.recovery?.restartSafe === false) {
    issues.push({
      code: 'mailchimp.panic_binding.artifact_recovery_not_restart_safe',
      severity: 'error',
      field: 'artifactBinding.exportContract.gates.recovery',
      message: 'Mailchimp panic recovery requires a restart-safe artifact recovery gate.',
    });
  }

  return {
    issues,
    blockedReasons,
    gates,
  };
}

function collectArtifactClientHandoffIssues(input, artifactBinding) {
  const handoff = artifactBinding.exportContract?.clientHandoff || artifactBinding.clientHandoff || {};
  const blockedReasons = stableList(handoff.blockedReasons);
  const missingFields = stableList(handoff.requestState?.missingFields);
  const commands = Array.isArray(handoff.commands) ? handoff.commands : [];
  const unsafeCommands = commands.filter((command) => (
    command?.state === 'ready'
      && (!compactString(command.idempotencyKey) || command.restartSafe !== true)
  ));
  const issues = [];

  if (!handoff.protocol) {
    issues.push({
      code: 'mailchimp.panic_binding.artifact_client_handoff_missing',
      severity: 'error',
      field: 'artifactBinding.exportContract.clientHandoff',
      message: 'Mailchimp panic recovery requires an artifact client handoff contract for resume and audit routing.',
    });
  }
  if (handoff.ready === false && input.allowDegradedClientPreview !== true) {
    issues.push({
      code: 'mailchimp.panic_binding.artifact_client_handoff_not_ready',
      severity: 'error',
      field: 'artifactBinding.exportContract.clientHandoff.ready',
      message: 'Mailchimp panic recovery requires ready artifact client handoff or an explicit degraded preview mode.',
    });
  }
  if (handoff.restartSafe === false) {
    issues.push({
      code: 'mailchimp.panic_binding.artifact_client_handoff_not_restart_safe',
      severity: 'error',
      field: 'artifactBinding.exportContract.clientHandoff.restartSafe',
      message: 'Mailchimp panic recovery requires restart-safe artifact client handoff commands.',
    });
  }
  if (handoff.canResume === false) {
    issues.push({
      code: 'mailchimp.panic_binding.artifact_client_resume_unavailable',
      severity: input.allowDegradedClientPreview ? 'warning' : 'error',
      field: 'artifactBinding.exportContract.clientHandoff.canResume',
      message: 'Mailchimp panic recovery cannot fully resume without a client resume token, write set, or resumable artifact recovery state.',
    });
  }
  if (missingFields.length > 0) {
    issues.push({
      code: 'mailchimp.panic_binding.artifact_client_state_missing',
      severity: input.allowDegradedClientPreview ? 'warning' : 'error',
      field: 'artifactBinding.exportContract.clientHandoff.requestState',
      message: `Mailchimp panic recovery is missing client state fields: ${missingFields.join(', ')}.`,
    });
  }
  for (const command of unsafeCommands) {
    issues.push({
      code: 'mailchimp.panic_binding.artifact_client_command_not_restart_safe',
      severity: 'error',
      field: 'artifactBinding.exportContract.clientHandoff.commands',
      message: `Mailchimp panic recovery command is not restart-safe: ${compactString(command.command || 'unknown')}.`,
    });
  }

  return {
    issues,
    handoff,
    blockedReasons,
    missingFields,
    unsafeCommands,
    commands,
  };
}

function collectPanicIssues(input, artifactBinding, boundary) {
  const artifactDiagnostics = Array.isArray(artifactBinding.diagnostics) ? artifactBinding.diagnostics : [];
  const artifactGateIssues = collectArtifactGateIssues(input, artifactBinding);
  const artifactClientIssues = collectArtifactClientHandoffIssues(input, artifactBinding);
  const issueCodes = new Set([
    ...input.issueCodes,
    ...artifactDiagnostics.map((diagnostic) => diagnostic.code).filter(Boolean),
    ...artifactGateIssues.issues.map((issue) => issue.code),
    ...artifactClientIssues.issues.map((issue) => issue.code),
    ...artifactGateIssues.blockedReasons.map((reason) => `artifact_gate.${reason}`),
    ...artifactClientIssues.blockedReasons.map((reason) => `artifact_client_handoff.${reason}`),
  ]);
  const issues = [
    ...artifactDiagnostics,
    ...artifactGateIssues.issues,
    ...artifactClientIssues.issues,
    ...input.lifecycleDiagnostics,
  ];
  for (const diagnostic of input.lifecycleDiagnostics) {
    issueCodes.add(diagnostic.code);
  }

  if (!boundary || boundary.kind !== 'aios.workspace.boundary_binding') {
    issues.push({
      code: 'mailchimp.panic_binding.boundary_required',
      severity: 'error',
      field: 'boundary.kind',
      message: 'Mailchimp panic binding requires a workspace boundary to build a recovery route.',
    });
    issueCodes.add('mailchimp.panic_binding.boundary_required');
  }
  if (input.severity === 'critical' && input.holdExternalWrites !== true) {
    issues.push({
      code: 'mailchimp.panic_binding.external_hold_required',
      severity: 'error',
      field: 'holdExternalWrites',
      message: 'Critical Mailchimp panic bindings must hold external writes.',
    });
    issueCodes.add('mailchimp.panic_binding.external_hold_required');
  }

  return {
    issues,
    issueCodes: [...issueCodes].sort(),
    artifactGate: {
      ready: artifactGateIssues.gates.ready !== false,
      state: compactString(artifactGateIssues.gates.state || 'unknown'),
      nextAction: compactString(artifactGateIssues.gates.nextAction),
      blockedReasons: artifactGateIssues.blockedReasons,
      acceptanceMissingKeys: stableList(artifactGateIssues.gates.acceptance?.missingKeys),
      restartSafe: artifactGateIssues.gates.recovery?.restartSafe !== false,
    },
    artifactClientHandoff: {
      present: Boolean(artifactClientIssues.handoff.protocol),
      ready: artifactClientIssues.handoff.ready === true,
      restartSafe: artifactClientIssues.handoff.restartSafe === true,
      canResume: artifactClientIssues.handoff.canResume === true,
      handoffKey: compactString(artifactClientIssues.handoff.handoffKey),
      nextAction: compactString(artifactClientIssues.handoff.nextAction),
      blockedReasons: artifactClientIssues.blockedReasons,
      missingClientState: artifactClientIssues.missingFields,
      commandCount: artifactClientIssues.commands.length,
      unsafeCommands: artifactClientIssues.unsafeCommands.map((command) => compactString(command.command || 'unknown')),
      auditEvent: artifactClientIssues.handoff.auditEvent && typeof artifactClientIssues.handoff.auditEvent === 'object'
        ? stableObject(artifactClientIssues.handoff.auditEvent)
        : {},
    },
  };
}

function buildPanicLifecycleControls(input, boundary, status, recovery, issueSummary) {
  const settings = input.lifecycleSettings;
  const schedule = settings.schedule;
  const scheduled = ['delayed', 'maintenance_window'].includes(schedule.mode) || schedule.retryAfterSeconds > 0;
  const baseBlockedReasons = stableList([
    settings.enabled ? '' : 'lifecycle.disabled',
    schedule.mode === 'disabled' ? 'schedule.disabled' : '',
    status.state === 'panic_hold' && input.requireOperator ? 'operator.review_required' : '',
    issueSummary.artifactGate.restartSafe ? '' : 'artifact_gate.not_restart_safe',
    recovery.clientHandoff.restartSafe ? '' : 'client_handoff.not_restart_safe',
    ...input.lifecycleDiagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.code),
  ]);
  const commandSpecs = [
    {
      command: 'panic.hold',
      reason: 'hold external writes while panic state is reviewed',
      allowed: input.holdExternalWrites === true,
      readyWhen: true,
    },
    {
      command: 'client.collect_acceptance',
      reason: 'collect acceptance keys required by artifact gates',
      allowed: issueSummary.artifactGate.acceptanceMissingKeys.length > 0,
      readyWhen: status.state === 'waiting_for_artifact_acceptance',
    },
    {
      command: 'artifact.client-preview.dispatch',
      reason: 'dispatch restart-safe degraded client preview without external writes',
      allowed: input.allowDegradedClientPreview === true,
      readyWhen: recovery.degradedResumeAllowed === true,
    },
    {
      command: 'resume_after_panic_review',
      reason: 'resume artifact write flow after operator review',
      allowed: recovery.resumeAllowed === true,
      readyWhen: status.state === 'recoverable',
    },
    {
      command: 'panic.retry',
      reason: 'retry panic recovery after backoff',
      allowed: recovery.retryPlan.retryable === true,
      readyWhen: recovery.retryPlan.retryable === true,
    },
    {
      command: 'panic.release-hold',
      reason: 'release local panic hold after recovery is ready',
      allowed: status.ready === true && recovery.resumeAllowed === true,
      readyWhen: status.ready === true,
    },
  ];
  const commands = commandSpecs.map((spec, index) => {
    const disabled = !settings.enabledCommands.includes(spec.command);
    const blockedReasons = stableList([
      ...baseBlockedReasons,
      disabled ? 'command.disabled' : '',
      spec.allowed ? '' : 'command.condition_unmet',
      scheduled && spec.command !== 'panic.hold' ? `schedule.${schedule.mode}` : '',
    ]);
    const state = blockedReasons.length
      ? scheduled && blockedReasons.every((reason) => reason.startsWith('schedule.'))
        ? 'scheduled'
        : 'blocked'
      : spec.readyWhen
        ? 'ready'
        : 'pending';

    return {
      index: index + 1,
      command: spec.command,
      state,
      reason: spec.reason,
      blockedReasons,
      idempotencyKey: `mailchimp:panic-lifecycle:${stableHash({
        command: spec.command,
        state,
        reason: spec.reason,
        panicState: status.state,
        boundaryId: boundary?.boundaryId,
        retryMode: recovery.retryPlan.mode,
      })}`,
      restartSafe: state !== 'blocked' && issueSummary.artifactGate.restartSafe && recovery.clientHandoff.restartSafe,
    };
  });
  const readyCommands = commands.filter((command) => command.state === 'ready');
  const scheduledCommands = commands.filter((command) => command.state === 'scheduled');
  const blockedCommands = commands.filter((command) => command.state === 'blocked');
  const next = readyCommands[0] || scheduledCommands[0] || blockedCommands[0] || commands[0];

  return {
    protocol: 'aios.panic-lifecycle-controls.mailchimp.v1',
    enabled: settings.enabled,
    status: readyCommands.length
      ? 'ready'
      : scheduledCommands.length
        ? 'scheduled'
        : blockedCommands.length
          ? 'blocked'
          : 'pending',
    ready: readyCommands.length > 0 && baseBlockedReasons.length === 0,
    nextAction: next?.command || status.nextAction,
    schedule: {
      ...schedule,
      scheduled,
    },
    permissions: {
      operatorRequired: settings.operatorRequired,
      holdExternalWrites: settings.holdExternalWrites,
      allowDegradedPreview: settings.allowDegradedPreview,
      enabledCommands: settings.enabledCommands,
      disabledCommands: settings.disabledCommands,
    },
    commands,
    summary: {
      readyCommands: readyCommands.length,
      scheduledCommands: scheduledCommands.length,
      blockedCommands: blockedCommands.length,
      restartSafeCommands: commands.filter((command) => command.restartSafe).length,
    },
    auditEvent: {
      type: 'mailchimp.panic.lifecycle_controls.checked',
      tenant: boundary?.tenant || boundary?.providerJob?.tenant || '',
      workspace: boundary?.workspace || boundary?.providerJob?.workspace || '',
      boundaryId: boundary?.boundaryId ?? null,
      actor: settings.audit.actor,
      auditSink: settings.audit.sink,
      reasonCode: settings.audit.reasonCode,
      status: readyCommands.length ? 'ready' : blockedCommands.length ? 'blocked' : 'pending',
      nextAction: next?.command || status.nextAction,
      restartSafe: blockedCommands.length === 0,
    },
  };
}

function buildPanicStatus(input, artifactBinding, issueSummary) {
  const errors = issueSummary.issues.filter((issue) => issue.severity === 'error');
  const warnings = issueSummary.issues.filter((issue) => issue.severity === 'warning');
  const critical = input.severity === 'critical';
  const waitingForAcceptance = issueSummary.artifactGate.state === 'waiting_for_acceptance';
  const clientPreviewAvailable = input.allowDegradedClientPreview
    && issueSummary.artifactClientHandoff.present
    && issueSummary.artifactClientHandoff.restartSafe
    && issueSummary.artifactClientHandoff.missingClientState.length === 0;
  const state = critical || errors.length > 0
    ? 'panic_hold'
    : waitingForAcceptance
      ? 'waiting_for_artifact_acceptance'
      : artifactBinding.status?.ready && issueSummary.artifactClientHandoff.canResume
        ? 'recoverable'
        : clientPreviewAvailable
          ? 'degraded_client_preview'
          : 'degraded';

  return {
    protocol: 'aios.panic-binding-status.mailchimp.v1',
    state,
    ready: state === 'recoverable',
    terminal: false,
    nextAction: state === 'recoverable'
      ? 'resume_after_panic_review'
      : state === 'degraded_client_preview'
        ? 'artifact.client-preview.dispatch'
      : waitingForAcceptance
        ? 'client.collect_acceptance'
      : critical
        ? 'hold_external_writes_and_collect_operator_review'
        : artifactBinding.status?.nextAction || 'repair_panic_binding',
    diagnostics: {
      errors: errors.length,
      warnings: warnings.length,
      issueCodes: issueSummary.issueCodes,
      artifactGate: issueSummary.artifactGate,
      artifactClientHandoff: issueSummary.artifactClientHandoff,
    },
  };
}

function buildPanicRecoveryPlan(input, boundary, artifactBinding, status, issueSummary) {
  const continuation = buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.readContinuationPacket, boundary, {
    source: input.source,
    panicReason: input.reason,
    artifactHash: artifactBinding.exportContract?.artifactHash ?? null,
  });
  const resume = buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.planRecoveryResume, boundary, {
    source: input.source,
    panicReason: input.reason,
    holdExternalWrites: input.holdExternalWrites,
    operatorRequired: input.requireOperator,
    artifactWriteSetId: artifactBinding.summary?.writeSetId ?? null,
  });
  const clientHandoff = issueSummary.artifactClientHandoff;
  const retryable = input.retryPolicy.retryable
    && status.state !== 'panic_hold'
    && clientHandoff.restartSafe === true
    && issueSummary.artifactGate.restartSafe === true;
  const handoffCommands = [
    ...(artifactBinding.exportContract?.clientHandoff?.commands || []),
  ].map((command, index) => ({
    index: index + 1,
    command: compactString(command.command || 'artifact.client-handoff.resume'),
    state: compactString(command.state || 'unknown'),
    idempotencyKey: compactString(command.idempotencyKey),
    restartSafe: command.restartSafe === true,
  }));

  return {
    protocol: 'aios.panic-binding-recovery.mailchimp.v1',
    state: status.state,
    restartSafe: true,
    localOnly: true,
    externalWritesHeld: input.holdExternalWrites,
    operatorRequired: input.requireOperator || status.state === 'panic_hold',
    resumeAllowed: status.state === 'recoverable'
      && resume.status === 'ready'
      && issueSummary.artifactGate.ready === true
      && issueSummary.artifactGate.restartSafe === true,
    degradedResumeAllowed: status.state === 'degraded_client_preview'
      && clientHandoff.restartSafe === true
      && input.allowDegradedClientPreview === true,
    nextAction: status.nextAction,
    gateHandoff: {
      artifactReady: issueSummary.artifactGate.ready,
      artifactState: issueSummary.artifactGate.state,
      blockedReasons: issueSummary.artifactGate.blockedReasons,
      acceptanceMissingKeys: issueSummary.artifactGate.acceptanceMissingKeys,
      nextAction: issueSummary.artifactGate.nextAction || status.nextAction,
    },
    clientHandoff: {
      present: clientHandoff.present,
      handoffKey: clientHandoff.handoffKey,
      ready: clientHandoff.ready,
      restartSafe: clientHandoff.restartSafe,
      canResume: clientHandoff.canResume,
      missingClientState: clientHandoff.missingClientState,
      blockedReasons: clientHandoff.blockedReasons,
      nextAction: clientHandoff.nextAction || status.nextAction,
      auditEvent: clientHandoff.auditEvent,
    },
    retryPlan: {
      retryable,
      mode: retryable ? 'bounded-panic-recovery-retry' : 'operator-repair-required',
      maxAttempts: input.retryPolicy.maxAttempts,
      retryAfterSeconds: retryable ? input.retryPolicy.retryAfterSeconds : 0,
      backoff: retryable ? input.retryPolicy.backoff : 'none',
      issueCodes: retryable ? issueSummary.issueCodes : [],
    },
    commands: handoffCommands,
    artifactRecovery: artifactBinding.recovery,
    syscalls: [continuation, resume],
    rollback: {
      mode: 'local-artifact-replay',
      writeSetId: artifactBinding.summary?.writeSetId ?? null,
      paths: artifactBinding.summary?.paths ?? [],
    },
  };
}

function buildPanicProviderServiceContract(input, boundary, artifactBinding, status, recovery, lifecycleControls, issueSummary) {
  const service = input.providerService;
  const requiredCapabilities = stableList([
    input.holdExternalWrites ? 'panic.hold_external_writes' : '',
    recovery.resumeAllowed ? 'panic.recover_artifact_writes' : '',
    recovery.degradedResumeAllowed ? 'panic.degraded_client_preview' : '',
    recovery.retryPlan.retryable ? 'panic.retry_with_backoff' : '',
    'panic.audit_handoff',
  ]);
  const grantedCapabilities = stableList(
    (service.capabilities.length ? service.capabilities : PANIC_PROVIDER_CAPABILITIES)
      .filter((capability) => !service.disabledCapabilities.includes(capability)),
  );
  const missingCapabilities = requiredCapabilities.filter((capability) => !grantedCapabilities.includes(capability));
  const providerMatches = service.provider === 'mailchimp';
  const externalWritesSafe = input.holdExternalWrites !== true
    || grantedCapabilities.includes('panic.hold_external_writes');
  const syncBlocked = ['failed', 'blocked', 'revoked'].includes(service.sync.status);
  const retryable = recovery.retryPlan.retryable
    && missingCapabilities.length === 0
    && syncBlocked === false
    && service.sync.consecutiveFailures < recovery.retryPlan.maxAttempts;
  const blockedReasons = stableList([
    providerMatches ? '' : `provider_mismatch:${service.provider}`,
    externalWritesSafe ? '' : 'provider_capability.missing:panic.hold_external_writes',
    ...missingCapabilities.map((capability) => `provider_capability.missing:${capability}`),
    syncBlocked ? `provider_sync.${service.sync.status}` : '',
    service.endpoint.external && input.holdExternalWrites ? 'provider_endpoint.external_while_held' : '',
    lifecycleControls.ready || lifecycleControls.status === 'scheduled' ? '' : 'lifecycle_controls_not_ready',
    ...issueSummary.issueCodes
      .filter((code) => code.includes('provider') || code.includes('handoff'))
      .map((code) => `issue.${code}`),
  ]);
  const statusName = blockedReasons.length
    ? retryable
      ? 'retry_scheduled'
      : 'blocked'
    : recovery.degradedResumeAllowed
      ? 'degraded_ready'
      : recovery.resumeAllowed
        ? 'resume_ready'
        : 'observing';

  return {
    protocol: 'aios.panic-provider-service-contract.mailchimp.v1',
    contractKey: `mailchimp:panic-provider-service:${stableHash({
      provider: service.provider,
      service: service.service,
      version: service.version,
      status: statusName,
      issueCodes: issueSummary.issueCodes,
      boundaryId: boundary?.boundaryId,
    })}`,
    provider: service.provider,
    service: service.service,
    version: service.version,
    ready: blockedReasons.length === 0 && providerMatches,
    status: statusName,
    nextAction: blockedReasons.length
      ? retryable
        ? 'panic.provider-service.retry'
        : 'panic.provider-service.repair'
      : recovery.resumeAllowed
        ? 'resume_after_panic_review'
        : recovery.degradedResumeAllowed
          ? 'artifact.client-preview.dispatch'
          : lifecycleControls.nextAction,
    capabilities: {
      required: requiredCapabilities,
      granted: grantedCapabilities,
      missing: missingCapabilities,
      disabled: service.disabledCapabilities,
    },
    syncMetadata: {
      cursor: service.sync.cursor,
      observedAt: service.sync.observedAt,
      status: service.sync.status,
      lastProviderRequestId: service.sync.lastProviderRequestId,
      consecutiveFailures: service.sync.consecutiveFailures,
      retryable,
      retryAfterSeconds: retryable ? recovery.retryPlan.retryAfterSeconds : 0,
    },
    externalHandoff: {
      ...service.externalHandoff,
      state: blockedReasons.length
        ? 'repair_required'
        : recovery.resumeAllowed
          ? 'ready_to_resume'
          : recovery.degradedResumeAllowed
            ? 'degraded_preview'
            : 'observing',
      restartSafe: recovery.restartSafe && service.endpoint.external !== true,
      correlationId: service.externalHandoff.correlationId || `panic:${stableHash({
        panicState: status.state,
        artifactHash: artifactBinding.exportContract?.artifactHash,
        lifecycleStatus: lifecycleControls.status,
      })}`,
    },
    endpoint: service.endpoint,
    blockedReasons,
    auditEvent: {
      type: 'mailchimp.panic.provider_service.checked',
      tenant: boundary?.tenant || boundary?.providerJob?.tenant || '',
      workspace: boundary?.workspace || boundary?.providerJob?.workspace || '',
      boundaryId: boundary?.boundaryId ?? null,
      provider: service.provider,
      status: statusName,
      ready: blockedReasons.length === 0,
      retryAfterSeconds: retryable ? recovery.retryPlan.retryAfterSeconds : 0,
      restartSafe: recovery.restartSafe,
    },
  };
}

function countPanicIssuesBySeverity(issues = []) {
  return issues.reduce((counts, issue) => {
    const severity = compactString(issue.severity || 'unknown') || 'unknown';
    counts[severity] = (counts[severity] || 0) + 1;
    return counts;
  }, {});
}

function buildPanicTimelineEvent(index, phase, state, detail = {}) {
  return {
    index,
    phase,
    state,
    issueCode: compactString(detail.issueCode || detail.code),
    action: compactString(detail.action),
    message: compactString(detail.message),
    restartSafe: detail.restartSafe !== false,
    digest: `fnv1a32:${stableHash({
      index,
      phase,
      state,
      issueCode: detail.issueCode || detail.code,
      action: detail.action,
      message: detail.message,
    })}`,
  };
}

function buildPanicTimeline(input, artifactBinding, status, recovery, issueSummary) {
  const artifactLedger = artifactBinding.exportContract?.commandLedger || {};
  const baseEvents = [
    buildPanicTimelineEvent(0, 'panic-detected', status.state, {
      action: status.nextAction,
      message: input.reason,
      restartSafe: recovery.restartSafe,
    }),
    buildPanicTimelineEvent(1, 'artifact-gate', recovery.gateHandoff.artifactState, {
      action: recovery.gateHandoff.nextAction,
      message: recovery.gateHandoff.blockedReasons.length
        ? `Artifact gate blockers: ${recovery.gateHandoff.blockedReasons.join(', ')}.`
        : 'Artifact gates are ready for panic recovery.',
      restartSafe: recovery.gateHandoff.artifactReady && issueSummary.artifactGate.restartSafe,
    }),
    buildPanicTimelineEvent(2, 'client-handoff', recovery.clientHandoff.ready ? 'ready' : 'blocked', {
      action: recovery.clientHandoff.nextAction,
      message: recovery.clientHandoff.blockedReasons.length
        ? `Client handoff blockers: ${recovery.clientHandoff.blockedReasons.join(', ')}.`
        : 'Client handoff can resume or report degraded preview state.',
      restartSafe: recovery.clientHandoff.restartSafe,
    }),
    buildPanicTimelineEvent(3, 'artifact-ledger', artifactLedger.status || 'missing', {
      action: artifactLedger.ready ? 'artifact.ledger.replay' : 'artifact.ledger.repair',
      message: artifactLedger.ledgerKey
        ? `Artifact ledger ${artifactLedger.ledgerKey} is ${artifactLedger.status}.`
        : 'Artifact ledger is missing from panic recovery input.',
      restartSafe: artifactLedger.ready === true,
    }),
    buildPanicTimelineEvent(4, 'recovery-plan', recovery.retryPlan.retryable ? 'retryable' : 'operator-review', {
      action: recovery.nextAction,
      message: recovery.resumeAllowed
        ? 'Panic recovery can resume after review.'
        : 'Panic recovery remains held until blockers are repaired.',
      restartSafe: recovery.restartSafe && recovery.retryPlan.mode !== 'operator-repair-required',
    }),
  ];
  const issueEvents = issueSummary.issues
    .filter((issue) => issue.severity === 'error' || issue.severity === 'warning')
    .slice(0, 20)
    .map((issue, offset) => buildPanicTimelineEvent(5 + offset, 'diagnostic', issue.severity, {
      issueCode: issue.code,
      action: issue.severity === 'error' ? 'repair_panic_binding' : 'review_panic_binding',
      message: issue.message,
      restartSafe: issue.severity !== 'error',
    }));

  return [
    ...input.history.map((entry, index) => ({
      index,
      phase: entry.phase,
      state: entry.state,
      issueCode: entry.issueCode,
      action: '',
      message: '',
      restartSafe: true,
      digest: entry.digest,
    })),
    ...baseEvents.map((event, offset) => ({ ...event, index: input.history.length + offset })),
    ...issueEvents.map((event, offset) => ({ ...event, index: input.history.length + baseEvents.length + offset })),
  ];
}

function buildPanicAnalytics(input, artifactBinding, status, recovery, issueSummary, lifecycleControls = null) {
  const timeline = buildPanicTimeline(input, artifactBinding, status, recovery, issueSummary);
  const artifactLedger = artifactBinding.exportContract?.commandLedger || {};
  const issueCounts = countPanicIssuesBySeverity(issueSummary.issues);
  const blockedReasons = stableList([
    ...issueSummary.issueCodes,
    ...(artifactLedger.summary?.blockedReasons || []),
    ...recovery.gateHandoff.blockedReasons,
    ...recovery.clientHandoff.blockedReasons,
  ]);
  const restartSafe = recovery.restartSafe
    && artifactLedger.ready === true
    && recovery.clientHandoff.restartSafe === true
    && issueSummary.artifactGate.restartSafe === true
    && timeline.every((event) => event.restartSafe !== false);
  const analyticsDigest = `fnv1a32:${stableHash({
    panicState: status.state,
    artifactHash: artifactBinding.exportContract?.artifactHash,
    artifactLedgerKey: artifactLedger.ledgerKey,
    blockedReasons,
    issueCounts,
    timeline: timeline.map((event) => event.digest),
  })}`;

  return {
    protocol: 'aios.panic-binding-analytics.mailchimp.v1',
    status: status.state,
    restartSafe,
    counters: {
      totalIssues: issueSummary.issues.length,
      warningIssues: issueCounts.warning || 0,
      errorIssues: issueCounts.error || 0,
      criticalRequested: input.severity === 'critical' ? 1 : 0,
      blockedReasons: blockedReasons.length,
      artifactCommands: artifactLedger.summary?.totalCommands || 0,
      artifactBlockedCommands: artifactLedger.summary?.blockedCommands || 0,
      artifactReplayableCommands: artifactLedger.summary?.replayableCommands || 0,
      lifecycleCommands: lifecycleControls?.commands?.length || 0,
      lifecycleBlockedCommands: lifecycleControls?.summary?.blockedCommands || 0,
      lifecycleScheduledCommands: lifecycleControls?.summary?.scheduledCommands || 0,
      priorHistoryEvents: input.history.length,
      timelineEvents: timeline.length,
    },
    issueCounts,
    blockedReasons,
    historySnapshot: {
      analyticsDigest,
      panicState: status.state,
      panicReady: status.ready,
      artifactHash: artifactBinding.exportContract?.artifactHash || null,
      artifactLedgerKey: artifactLedger.ledgerKey || '',
      artifactLedgerStatus: artifactLedger.status || 'missing',
      artifactReplayToken: artifactLedger.replayToken || null,
      clientHandoffKey: recovery.clientHandoff.handoffKey,
      retryMode: recovery.retryPlan.mode,
      lifecycleStatus: lifecycleControls?.status || 'unbound',
      lifecycleNextAction: lifecycleControls?.nextAction || status.nextAction,
      resumeAllowed: recovery.resumeAllowed,
      degradedResumeAllowed: recovery.degradedResumeAllowed,
    },
    timeline,
    report: {
      title: 'Mailchimp panic recovery report',
      nextAction: status.nextAction,
      externalWritesHeld: recovery.externalWritesHeld,
      operatorRequired: recovery.operatorRequired,
      resumeAllowed: recovery.resumeAllowed,
      degradedResumeAllowed: recovery.degradedResumeAllowed,
      lifecycleStatus: lifecycleControls?.status || 'unbound',
      artifactGateState: recovery.gateHandoff.artifactState,
      artifactLedgerStatus: artifactLedger.status || 'missing',
      blockedReasons,
    },
  };
}

function buildPanicPreviewAcceptanceContract(input, artifactBinding, status, recovery, lifecycleControls, providerService, analytics) {
  const artifactExportSummary = artifactBinding.exportContract?.exportReadySummary || {};
  const artifactExportHistory = artifactBinding.exportContract?.exportHistory || {};
  const acceptance = artifactExportSummary.acceptance && typeof artifactExportSummary.acceptance === 'object'
    ? artifactExportSummary.acceptance
    : {};
  const clientHandoff = artifactExportSummary.clientHandoff && typeof artifactExportSummary.clientHandoff === 'object'
    ? artifactExportSummary.clientHandoff
    : {};
  const missingAcceptanceKeys = stableList(acceptance.missingKeys || recovery.gateHandoff.acceptanceMissingKeys);
  const missingClientState = stableList(clientHandoff.missingFields || recovery.clientHandoff.missingClientState);
  const previewAllowed = input.allowDegradedClientPreview === true
    && recovery.clientHandoff.restartSafe === true
    && providerService.externalHandoff.restartSafe === true
    && lifecycleControls.enabled === true;
  const acceptanceReady = missingAcceptanceKeys.length === 0
    || input.allowResumeWithPendingAcceptance === true;
  const blockedReasons = stableList([
    previewAllowed ? '' : 'preview.not_allowed',
    acceptanceReady ? '' : 'acceptance.keys_missing',
    missingClientState.length ? 'client_state.missing' : '',
    lifecycleControls.ready || lifecycleControls.status === 'scheduled' ? '' : 'lifecycle.not_ready',
    providerService.ready || providerService.syncMetadata.retryable ? '' : 'provider_service.not_ready',
    analytics.restartSafe ? '' : 'analytics.not_restart_safe',
    ...missingAcceptanceKeys.map((key) => `acceptance.missing:${key}`),
    ...missingClientState.map((field) => `client_state.missing:${field}`),
  ]);
  const state = blockedReasons.length
    ? missingAcceptanceKeys.length
      ? 'waiting_for_acceptance'
      : previewAllowed
        ? 'preview_blocked'
        : 'preview_unavailable'
    : recovery.resumeAllowed
      ? 'resume_ready'
      : recovery.degradedResumeAllowed
        ? 'preview_ready'
        : 'review_required';
  const previewDigest = `fnv1a32:${stableHash({
    state,
    panicState: status.state,
    artifactHash: artifactExportSummary.artifactHash,
    missingAcceptanceKeys,
    missingClientState,
    lifecycleStatus: lifecycleControls.status,
    providerStatus: providerService.status,
    analyticsDigest: analytics.historySnapshot.analyticsDigest,
  })}`;
  const cards = [
    {
      key: 'panic-preview-status',
      label: 'Preview status',
      state,
      command: state === 'preview_ready'
        ? 'artifact.client-preview.dispatch'
        : state === 'resume_ready'
          ? 'resume_after_panic_review'
          : status.nextAction,
      blockedReasons: blockedReasons.filter((reason) => !reason.startsWith('acceptance.') && !reason.startsWith('client_state.')),
    },
    {
      key: 'panic-preview-acceptance',
      label: 'Acceptance',
      state: missingAcceptanceKeys.length ? 'missing_keys' : 'satisfied',
      command: missingAcceptanceKeys.length ? 'client.collect_acceptance' : 'acceptance.noop',
      missingKeys: missingAcceptanceKeys,
      requiredKeys: stableList(acceptance.requiredKeys),
    },
    {
      key: 'panic-preview-client-state',
      label: 'Client state',
      state: missingClientState.length ? 'missing_fields' : 'bound',
      command: missingClientState.length ? 'artifact.client-state.bind' : 'client_state.noop',
      missingFields: missingClientState,
      handoffKey: recovery.clientHandoff.handoffKey,
    },
  ];

  return {
    protocol: 'aios.panic-preview-acceptance.mailchimp.v1',
    previewDigest,
    state,
    ready: ['preview_ready', 'resume_ready'].includes(state) && blockedReasons.length === 0,
    restartSafe: analytics.restartSafe
      && recovery.clientHandoff.restartSafe
      && providerService.externalHandoff.restartSafe === true,
    nextAction: blockedReasons.length
      ? missingAcceptanceKeys.length
        ? 'client.collect_acceptance'
        : missingClientState.length
          ? 'artifact.client-state.bind'
          : providerService.nextAction || lifecycleControls.nextAction
      : state === 'resume_ready'
        ? 'resume_after_panic_review'
        : 'artifact.client-preview.dispatch',
    blockedReasons,
    acceptance: {
      state: missingAcceptanceKeys.length ? 'missing_keys' : 'satisfied',
      requiredKeys: stableList(acceptance.requiredKeys),
      missingKeys: missingAcceptanceKeys,
      allowPendingAcceptance: input.allowResumeWithPendingAcceptance === true,
    },
    preview: {
      allowed: previewAllowed,
      degraded: recovery.degradedResumeAllowed,
      externalWritesHeld: recovery.externalWritesHeld,
      artifactHash: artifactExportSummary.artifactHash || artifactBinding.exportContract?.artifactHash || null,
      artifactExportState: artifactExportSummary.state || 'unknown',
      artifactExportDigest: artifactExportHistory.reportDigest || '',
      clientHandoffKey: recovery.clientHandoff.handoffKey,
      timelineDigest: analytics.historySnapshot.analyticsDigest,
    },
    readiness: {
      panicState: status.state,
      lifecycleStatus: lifecycleControls.status,
      providerServiceStatus: providerService.status,
      artifactLedgerStatus: artifactExportSummary.persistedState?.status || 'unknown',
      missingClientState,
      cards,
    },
  };
}

export function compileMailchimpPanicBinding(input = {}, runtime = {}) {
  const normalized = normalizePanicInput(input, runtime);
  const boundary = runtime.boundary || runtime.workspaceBoundary || input.boundary || null;
  const artifactBinding = compileMailchimpArtifactBinding(normalized.artifactInput, {
    ...runtime,
    boundary,
  });
  const issueSummary = collectPanicIssues(normalized, artifactBinding, boundary);
  const status = buildPanicStatus(normalized, artifactBinding, issueSummary);
  const recovery = buildPanicRecoveryPlan(normalized, boundary, artifactBinding, status, issueSummary);
  const lifecycleControls = buildPanicLifecycleControls(normalized, boundary, status, recovery, issueSummary);
  const providerService = buildPanicProviderServiceContract(
    normalized,
    boundary,
    artifactBinding,
    status,
    recovery,
    lifecycleControls,
    issueSummary,
  );
  const analytics = buildPanicAnalytics(normalized, artifactBinding, status, recovery, issueSummary, lifecycleControls);
  const previewAcceptance = buildPanicPreviewAcceptanceContract(
    normalized,
    artifactBinding,
    status,
    recovery,
    lifecycleControls,
    providerService,
    analytics,
  );
  const panicHash = stableHash({
    reason: normalized.reason,
    severity: normalized.severity,
    status,
    recovery,
    lifecycleControls,
    providerService,
    analytics,
    previewAcceptance,
    artifactHash: artifactBinding.exportContract.artifactHash,
    artifactGates: artifactBinding.exportContract.gates,
    artifactClientHandoff: artifactBinding.exportContract.clientHandoff,
    artifactCommandLedger: artifactBinding.exportContract.commandLedger,
  });

  return {
    protocol: 'aios.panic-binding-compile.mailchimp.v1',
    provider: 'mailchimp',
    boundaryId: boundary?.boundaryId ?? null,
    reason: normalized.reason,
    severity: normalized.severity,
    artifactBinding,
    status,
    recovery,
    lifecycleControls,
    providerService,
    analytics,
    previewAcceptance,
    exportContract: {
      protocol: 'aios.panic-binding-export.mailchimp.v1',
      panicHash,
      ready: status.ready && lifecycleControls.ready && providerService.ready,
      nextAction: providerService.ready === false
        ? providerService.nextAction
        : lifecycleControls.nextAction || status.nextAction,
      externalWritesHeld: recovery.externalWritesHeld,
      resumeAllowed: recovery.resumeAllowed,
      artifactGateState: recovery.gateHandoff.artifactState,
      artifactClientHandoff: recovery.clientHandoff,
      lifecycleControls: {
        protocol: lifecycleControls.protocol,
        enabled: lifecycleControls.enabled,
        status: lifecycleControls.status,
        ready: lifecycleControls.ready,
        nextAction: lifecycleControls.nextAction,
        schedule: lifecycleControls.schedule,
        permissions: lifecycleControls.permissions,
        summary: lifecycleControls.summary,
        commands: lifecycleControls.commands.map((command) => ({
          command: command.command,
          state: command.state,
          idempotencyKey: command.idempotencyKey,
          restartSafe: command.restartSafe,
          blockedReasons: command.blockedReasons,
        })),
        auditEvent: lifecycleControls.auditEvent,
      },
      providerService: {
        protocol: providerService.protocol,
        contractKey: providerService.contractKey,
        ready: providerService.ready,
        status: providerService.status,
        nextAction: providerService.nextAction,
        capabilities: providerService.capabilities,
        syncMetadata: providerService.syncMetadata,
        externalHandoff: providerService.externalHandoff,
        endpoint: providerService.endpoint,
        blockedReasons: providerService.blockedReasons,
        auditEvent: providerService.auditEvent,
      },
      retryPlan: recovery.retryPlan,
      degradedResumeAllowed: recovery.degradedResumeAllowed,
      previewAcceptance: {
        protocol: previewAcceptance.protocol,
        previewDigest: previewAcceptance.previewDigest,
        state: previewAcceptance.state,
        ready: previewAcceptance.ready,
        restartSafe: previewAcceptance.restartSafe,
        nextAction: previewAcceptance.nextAction,
        blockedReasons: previewAcceptance.blockedReasons,
        acceptance: previewAcceptance.acceptance,
        preview: previewAcceptance.preview,
        readiness: previewAcceptance.readiness,
      },
      analytics: {
        protocol: analytics.protocol,
        status: analytics.status,
        restartSafe: analytics.restartSafe,
        counters: analytics.counters,
        issueCounts: analytics.issueCounts,
        historySnapshot: analytics.historySnapshot,
        report: analytics.report,
        timeline: analytics.timeline,
      },
      contracts: {
        artifactBinding: artifactBinding.protocol,
        recovery: recovery.protocol,
        status: status.protocol,
        analytics: analytics.protocol,
        lifecycleControls: lifecycleControls.protocol,
        providerService: providerService.protocol,
        previewAcceptance: previewAcceptance.protocol,
      },
    },
    metadata: normalized.metadata,
    diagnostics: [
      ...issueSummary.issues,
      ...providerService.blockedReasons.map((reason) => ({
        code: `mailchimp.panic_binding.provider_service.${reason.split(':')[0]}`,
        severity: providerService.syncMetadata.retryable ? 'warning' : 'error',
        field: 'providerService',
        message: `Mailchimp panic provider service contract is not ready: ${reason}.`,
      })),
    ],
  };
}

export function validateMailchimpPanicBinding(input = {}, runtime = {}) {
  const binding = input?.protocol === 'aios.panic-binding-compile.mailchimp.v1'
    ? input
    : compileMailchimpPanicBinding(input, runtime);
  const errors = binding.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  return {
    protocol: 'aios.panic-binding-validation.mailchimp.v1',
    ok: errors.length === 0,
    ready: binding.exportContract.ready,
    nextAction: binding.exportContract.nextAction,
    diagnostics: binding.diagnostics,
    panicHash: binding.exportContract.panicHash,
    retryPlan: binding.recovery.retryPlan,
    artifactClientHandoff: binding.recovery.clientHandoff,
    lifecycleControls: binding.lifecycleControls,
    providerService: binding.providerService,
    analytics: binding.analytics,
    previewAcceptance: binding.previewAcceptance,
  };
}

export function buildMailchimpPanicBindingSelfCheck(input = {}, runtime = {}) {
  const first = compileMailchimpPanicBinding(input, runtime);
  const second = compileMailchimpPanicBinding(input, runtime);
  return {
    protocol: 'aios.panic-binding-self-check.mailchimp.v1',
    deterministic: first.exportContract.panicHash === second.exportContract.panicHash,
    panicHash: first.exportContract.panicHash,
    ready: first.exportContract.ready,
    nextAction: first.exportContract.nextAction,
    retryable: first.recovery.retryPlan.retryable,
    degradedResumeAllowed: first.recovery.degradedResumeAllowed,
    artifactClientHandoffReady: first.recovery.clientHandoff.ready,
    artifactClientHandoffRestartSafe: first.recovery.clientHandoff.restartSafe,
    lifecycleStatus: first.lifecycleControls.status,
    lifecycleReady: first.lifecycleControls.ready,
    lifecycleNextAction: first.lifecycleControls.nextAction,
    providerServiceStatus: first.providerService.status,
    providerServiceReady: first.providerService.ready,
    providerServiceContractKey: first.providerService.contractKey,
    previewAcceptanceState: first.previewAcceptance.state,
    previewAcceptanceReady: first.previewAcceptance.ready,
    previewAcceptanceDigest: first.previewAcceptance.previewDigest,
    analyticsDigest: first.analytics.historySnapshot.analyticsDigest,
    analyticsRestartSafe: first.analytics.restartSafe,
    timelineLength: first.analytics.timeline.length,
    diagnostics: first.diagnostics,
  };
}

export {
  buildPanicAnalytics,
  buildPanicLifecycleControls,
  buildPanicProviderServiceContract,
  buildPanicPreviewAcceptanceContract,
  normalizePanicInput,
};
