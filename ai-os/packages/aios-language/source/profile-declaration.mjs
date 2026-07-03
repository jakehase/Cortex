export const PROFILE_DECLARATION_SCHEMA_VERSION = 'aios.profile-declaration.v1';

const DEFAULT_MAILCHIMP_PROFILE = Object.freeze({
  adapter: 'mailchimp',
  operation: 'campaign.sync',
  statusChannel: 'kernel.status.mailchimp',
  handoffTarget: 'mailchimp.client.workflow',
  rollback: 'discard_local_plan',
  statusOnFailure: 'needs_operator_review'
});

const DEFAULT_CLIENT_RUNTIME = Object.freeze({
  requestKey: 'mailchimp.request',
  workflowState: 'awaiting_kernel_ack',
  statusVisibility: 'client_visible',
  resumeTokenStrategy: 'stable_profile_request'
});

const DEFAULT_PROVIDER_SERVICE = Object.freeze({
  provider: 'mailchimp',
  service: 'marketing-api',
  region: 'us',
  syncMode: 'incremental',
  syncCursorKey: 'mailchimp.sync.cursor',
  statusTarget: 'kernel.provider.mailchimp',
  externalStateKey: 'mailchimp.provider.state',
  requiredProviderCapabilities: Object.freeze(['mailchimp.read'])
});

const PROFILE_LIFECYCLE_COMMANDS = Object.freeze({
  enable: 'enabled',
  disable: 'disabled',
  pause: 'paused',
  resume: 'enabled',
  retry: 'retry_scheduled',
  ack_status: 'status_acknowledged',
  operator_review: 'operator_review'
});

const PROFILE_LIFECYCLE_DEFAULTS = Object.freeze({
  enabled: true,
  scheduleMode: 'immediate',
  retryWindowMs: 45000,
  maxScheduledRetries: 2,
  requireKernelStatus: true,
  allowDegradedResume: false
});

const OPERATION_DEFAULTS = Object.freeze({
  'campaign.sync': Object.freeze({
    capabilities: Object.freeze(['mailchimp.read', 'mailchimp.campaign.plan']),
    requiredClaims: Object.freeze(['audience_id', 'campaign_id', 'consent_basis']),
    memory: Object.freeze(['campaign_snapshot'])
  }),
  'audience.segment': Object.freeze({
    capabilities: Object.freeze(['mailchimp.read', 'mailchimp.audience.segment']),
    requiredClaims: Object.freeze(['audience_id', 'segment_rule', 'consent_basis']),
    memory: Object.freeze(['audience_snapshot'])
  }),
  'webhook.audit': Object.freeze({
    capabilities: Object.freeze(['mailchimp.read', 'mailchimp.webhook.inspect']),
    requiredClaims: Object.freeze(['webhook_id', 'event_signature']),
    memory: Object.freeze(['webhook_event_digest'])
  })
});

const DEFAULT_PROFILE_BOUNDARY = Object.freeze({
  tenantId: 'mailchimp.default',
  workspaceId: 'mailchimp.workspace.default',
  role: 'campaign_operator',
  permissionMode: 'least_privilege'
});

const PROFILE_ROLE_PERMISSIONS = Object.freeze({
  campaign_operator: Object.freeze({
    capabilities: Object.freeze(['mailchimp.read', 'mailchimp.campaign.plan']),
    permissions: Object.freeze(['campaign:read', 'campaign:plan', 'status:write'])
  }),
  audience_operator: Object.freeze({
    capabilities: Object.freeze(['mailchimp.read', 'mailchimp.audience.segment']),
    permissions: Object.freeze(['audience:read', 'audience:segment', 'status:write'])
  }),
  auditor: Object.freeze({
    capabilities: Object.freeze(['mailchimp.read', 'mailchimp.webhook.inspect']),
    permissions: Object.freeze(['webhook:read', 'audit:read'])
  }),
  workflow_owner: Object.freeze({
    capabilities: Object.freeze([
      'mailchimp.read',
      'mailchimp.campaign.plan',
      'mailchimp.audience.segment',
      'mailchimp.webhook.inspect'
    ]),
    permissions: Object.freeze(['campaign:read', 'campaign:plan', 'audience:segment', 'webhook:read', 'audit:write', 'status:write'])
  })
});

export function parseProfileDeclarationSource(source = '', options = {}) {
  const diagnostics = [];
  const declarations = [];
  String(source ?? '').split(/\r?\n/).forEach((rawLine, offset) => {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) return;
    const match = line.match(/^profile\s+([a-z][a-z0-9.-]*)(?:\s+(.*))?$/i);
    if (!match) {
      diagnostics.push(diagnostic('error', 'invalid_profile_declaration', `line:${offset + 1}`));
      return;
    }
    declarations.push({
      kind: 'ProfileDeclaration',
      name: match[1],
      fields: parseKeyValues(match[2] ?? ''),
      line: offset + 1
    });
  });

  return {
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    sourceName: clean(options.sourceName) || 'inline.profile.aios',
    declarations,
    diagnostics
  };
}

export function compileProfileDeclaration(input = {}, options = {}) {
  const parsed = typeof input === 'string' ? parseProfileDeclarationSource(input, options) : normalizeDeclarationInput(input);
  const declaration = parsed.declarations[0] ?? { name: options.name ?? 'mailchimp.default', fields: {} };
  const fields = declaration.fields ?? {};
  const operation = fields.operation ?? fields.op ?? options.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation;
  const defaults = OPERATION_DEFAULTS[operation] ?? OPERATION_DEFAULTS[DEFAULT_MAILCHIMP_PROFILE.operation];
  const adapter = fields.adapter ?? options.adapter ?? DEFAULT_MAILCHIMP_PROFILE.adapter;
  const capabilities = unique([...defaults.capabilities, ...parseList(fields.capabilities), ...parseList(options.capabilities)]);
  const requiredClaims = unique([...defaults.requiredClaims, ...parseList(fields.claims), ...parseList(fields.requiredClaims)]);
  const memoryKeys = unique([...defaults.memory, ...parseList(fields.memory), ...parseList(options.memory)]);
  const boundary = deriveProfileBoundaryContract({
    fields,
    options,
    operation,
    capabilities,
    requiredClaims
  });
  const providerService = deriveProfileProviderServiceContract({
    fields,
    options,
    operation,
    capabilities
  });
  const diagnostics = [
    ...(parsed.diagnostics ?? []),
    ...boundary.diagnostics,
    ...providerService.diagnostics,
    ...(adapter !== 'mailchimp' ? [diagnostic('warning', 'profile_adapter_not_mailchimp', adapter)] : []),
    ...(OPERATION_DEFAULTS[operation] ? [] : [diagnostic('warning', 'unknown_mailchimp_operation_defaulted', operation)])
  ];

  return {
    ok: !diagnostics.some((item) => item.level === 'error'),
    profile: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      name: declaration.name,
      adapter,
      operation,
      capabilities,
      memory: memoryKeys.map((name) => ({
        name,
        scope: fields.memoryScope ?? 'job',
        retention: fields.retention ?? 'ephemeral',
        ttlSeconds: toPositiveInteger(fields.ttlSeconds, 3600)
      })),
      verifier: {
        requiredClaims,
        truthBoundaries: unique(['mailchimp_api', ...parseList(fields.truthBoundaries)])
      },
      providerService: providerService.contract,
      boundary: boundary.contract,
      recovery: {
        statusOnFailure: fields.statusOnFailure ?? DEFAULT_MAILCHIMP_PROFILE.statusOnFailure,
        rollback: fields.rollback ?? DEFAULT_MAILCHIMP_PROFILE.rollback
      },
      handoff: {
        target: fields.handoff ?? DEFAULT_MAILCHIMP_PROFILE.handoffTarget,
        statusChannel: fields.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
        resumeMode: fields.resumeMode ?? 'resume_after_kernel_ack'
      }
    },
    diagnostics
  };
}

export function deriveProfileRuntimeContract(input = {}, options = {}) {
  const compiled = compileProfileDeclaration(input, options);
  if (!compiled.ok) return { ok: false, diagnostics: compiled.diagnostics };
  const { profile } = compiled;
  return {
    ok: true,
    contract: {
      adapter: profile.adapter,
      operation: profile.operation,
      kernelJob: {
        name: profile.name,
        capabilityRefs: profile.capabilities,
        memoryRefs: profile.memory.map((item) => item.name),
        verifierClaims: profile.verifier.requiredClaims,
        boundaryScope: {
          tenantId: profile.boundary.tenantId,
          workspaceId: profile.boundary.workspaceId,
          role: profile.boundary.role,
          permissionMode: profile.boundary.permissionMode
        },
        auditRefs: [profile.boundary.auditHandoff.subject]
      },
      boundary: profile.boundary,
      providerService: profile.providerService,
      recovery: profile.recovery,
      statusHandoff: profile.handoff
    },
    diagnostics: compiled.diagnostics
  };
}

export function buildProfileClientRuntimeState(input = {}, options = {}) {
  const compiled = compileProfileDeclaration(input, options);
  if (!compiled.ok) {
    return {
      ok: false,
      state: null,
      diagnostics: compiled.diagnostics
    };
  }
  const runtime = deriveProfileRuntimeContract(input, options);
  const profile = compiled.profile;
  const request = normalizeRequestState(options.request ?? input.request);
  const suppliedClaims = normalizeClaimValues(options.claims ?? input.claims ?? request.claims);
  const suppliedMemory = normalizeMemoryValues(options.memoryState ?? input.memoryState ?? request.memory);
  const claimChecklist = profile.verifier.requiredClaims.map((claim) => ({
    claim,
    present: suppliedClaims.has(claim),
    source: suppliedClaims.has(claim) ? 'client_request' : 'missing'
  }));
  const memoryBindings = profile.memory.map((item) => ({
    name: item.name,
    scope: item.scope,
    retention: item.retention,
    ttlSeconds: item.ttlSeconds,
    present: suppliedMemory.has(item.name),
    requiredBeforeResume: item.retention !== 'ephemeral'
  }));
  const missingClaims = claimChecklist.filter((item) => item.present !== true).map((item) => item.claim);
  const missingDurableMemory = memoryBindings
    .filter((item) => item.requiredBeforeResume && item.present !== true)
    .map((item) => item.name);
  const requestKey = clean(request.requestKey) || clean(options.requestKey) || DEFAULT_CLIENT_RUNTIME.requestKey;
  const workflowState = missingClaims.length > 0
    ? 'waiting_for_claims'
    : missingDurableMemory.length > 0
      ? 'waiting_for_memory'
      : DEFAULT_CLIENT_RUNTIME.workflowState;
  const diagnostics = [
    ...compiled.diagnostics,
    ...missingClaims.map((claim) => diagnostic('error', 'client_runtime_missing_required_claim', claim)),
    ...missingDurableMemory.map((name) => diagnostic('warning', 'client_runtime_missing_durable_memory', name)),
    ...(runtime.contract.statusHandoff.statusChannel
      ? []
      : [diagnostic('error', 'client_runtime_missing_status_channel', profile.name)])
  ];

  return {
    ok: !diagnostics.some((item) => item.level === 'error'),
    state: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      profileName: profile.name,
      adapter: profile.adapter,
      operation: profile.operation,
      requestKey,
      workflow: {
        target: profile.handoff.target,
        state: workflowState,
        statusVisibility: DEFAULT_CLIENT_RUNTIME.statusVisibility,
        statusChannel: profile.handoff.statusChannel,
        resumeMode: profile.handoff.resumeMode,
        resumeToken: buildResumeToken({
          strategy: options.resumeTokenStrategy ?? DEFAULT_CLIENT_RUNTIME.resumeTokenStrategy,
          profileName: profile.name,
          operation: profile.operation,
          requestKey
        })
      },
      verifier: {
        mode: missingClaims.length > 0 ? 'blocked_until_claims_arrive' : 'ready',
        claimChecklist,
        missingClaims,
        truthBoundaries: profile.verifier.truthBoundaries
      },
      memory: {
        bindings: memoryBindings,
        missingDurableMemory
      },
      boundary: {
        ...profile.boundary,
        clientVisible: profile.boundary.status !== 'blocked',
        resumeGuard: profile.boundary.status === 'blocked'
          ? 'tenant_boundary_review_required'
          : profile.boundary.status === 'degraded'
            ? 'permission_advisory_review'
            : 'boundary_clear'
      },
      providerService: {
        ...profile.providerService,
        clientVisible: profile.providerService.status !== 'blocked',
        resumeGuard: profile.providerService.status === 'blocked'
          ? 'provider_service_review_required'
          : profile.providerService.status === 'degraded'
            ? 'provider_capability_advisory_review'
            : 'provider_service_ready'
      },
      kernelJob: runtime.contract.kernelJob,
      recovery: {
        ...profile.recovery,
        clientAction: missingClaims.length > 0
          ? 'collect_required_claims'
          : missingDurableMemory.length > 0
            ? 'restore_memory_before_resume'
            : 'wait_for_kernel_ack'
      }
    },
    diagnostics
  };
}

export function buildProfilePersistenceEnvelope(input = {}, options = {}) {
  const runtime = buildProfileClientRuntimeState(input, options);
  if (!runtime.ok) {
    return {
      ok: false,
      envelope: null,
      diagnostics: runtime.diagnostics
    };
  }

  const state = runtime.state;
  const previous = normalizePersistedProfileState(options.previousState ?? input.previousState);
  const command = normalizeProfileCommand(options.command ?? input.command);
  const commandKey = clean(command.commandKey ?? options.commandKey);
  const seenCommands = new Set([
    ...(previous.appliedCommandKeys ?? []),
    ...(options.appliedCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const persistedMemory = normalizeMemoryPayload(options.persistedMemory ?? input.persistedMemory ?? previous.memory?.persisted);
  const durableMemoryNames = state.memory.bindings
    .filter((item) => item.retention !== 'ephemeral')
    .map((item) => item.name);
  const restoredMemory = durableMemoryNames.filter((name) => Object.prototype.hasOwnProperty.call(persistedMemory, name));
  const missingRestorableMemory = durableMemoryNames.filter((name) => !restoredMemory.includes(name));
  const restartKey = buildProfileRestartKey({
    profileName: state.profileName,
    operation: state.operation,
    requestKey: state.requestKey,
    resumeToken: state.workflow.resumeToken
  });
  const snapshotFingerprint = profileStateFingerprint({
    restartKey,
    workflowState: state.workflow.state,
    missingClaims: state.verifier.missingClaims,
    missingRestorableMemory,
    restoredMemory
  });
  const repeatedCommand = commandKey && seenCommands.has(commandKey);
  const commandDiagnostics = validateProfileCommand(command, state);
  const nextStatus = derivePersistedProfileStatus({
    state,
    missingRestorableMemory,
    previous,
    command,
    repeatedCommand,
    commandDiagnostics
  });
  const diagnostics = [
    ...runtime.diagnostics,
    ...commandDiagnostics,
    ...(previous.schemaVersion && previous.schemaVersion !== PROFILE_DECLARATION_SCHEMA_VERSION
      ? [diagnostic('warning', 'profile_persisted_state_schema_mismatch', previous.schemaVersion)]
      : []),
    ...(repeatedCommand ? [diagnostic('info', 'profile_command_already_applied', commandKey)] : [])
  ];
  const generation = previous.fingerprint === snapshotFingerprint
    ? toNonNegativeInteger(previous.generation, 0)
    : toNonNegativeInteger(previous.generation, 0) + 1;
  const restartSafe = diagnostics.every((item) => item.level !== 'error')
    && state.workflow.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
    && missingRestorableMemory.length === 0;

  return {
    ok: diagnostics.every((item) => item.level !== 'error'),
    envelope: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      profileName: state.profileName,
      adapter: state.adapter,
      operation: state.operation,
      requestKey: state.requestKey,
      restartKey,
      fingerprint: snapshotFingerprint,
      generation,
      status: nextStatus.status,
      restartSafe,
      idempotency: {
        commandKey: commandKey || null,
        applied: Boolean(commandKey) && !repeatedCommand && commandDiagnostics.every((item) => item.level !== 'error'),
        repeated: Boolean(repeatedCommand),
        appliedCommandKeys: commandKey && !repeatedCommand
          ? [...seenCommands, commandKey].sort()
          : [...seenCommands].sort()
      },
      workflow: {
        ...state.workflow,
        persistedState: nextStatus.workflowState,
        lastStableStatus: nextStatus.lastStableStatus,
        statusSequence: toNonNegativeInteger(previous.workflow?.statusSequence, 0) + (previous.status === nextStatus.status ? 0 : 1)
      },
      memory: {
        expectedDurable: durableMemoryNames,
        restored: restoredMemory,
        missingRestorable: missingRestorableMemory,
        persisted: pickKnownMemory(persistedMemory, durableMemoryNames)
      },
      recovery: {
        ...state.recovery,
        path: nextStatus.recoveryPath,
        resumeAllowed: restartSafe && nextStatus.status !== 'blocked',
        resumeToken: state.workflow.resumeToken,
        statusChannel: state.workflow.statusChannel
      },
      verifier: state.verifier,
      boundary: state.boundary,
      kernelJob: state.kernelJob
    },
    diagnostics
  };
}

export function buildProfileOperationalFailureState(input = {}, options = {}) {
  const compiled = compileProfileDeclaration(input, options);
  const clientRuntime = buildProfileClientRuntimeState(input, options);
  const persistence = buildProfilePersistenceEnvelope(input, options);
  const profile = compiled.profile ?? {};
  const state = clientRuntime.state;
  const envelope = persistence.envelope;
  const attempt = toNonNegativeInteger(options.attempt ?? input.attempt, 0);
  const maxAttempts = toPositiveInteger(options.maxAttempts ?? input.maxAttempts, 3);
  const baseBackoffMs = toPositiveInteger(options.baseBackoffMs ?? input.baseBackoffMs, 750);
  const maxBackoffMs = toPositiveInteger(options.maxBackoffMs ?? input.maxBackoffMs, 12000);
  const diagnostics = [
    ...compiled.diagnostics,
    ...clientRuntime.diagnostics,
    ...persistence.diagnostics
  ];
  const missingClaims = state?.verifier?.missingClaims ?? [];
  const missingMemory = envelope?.memory?.missingRestorable ?? [];
  const boundaryStatus = state?.boundary?.status ?? profile.boundary?.status ?? 'ready';
  const statusChannel = state?.workflow?.statusChannel ?? profile.handoff?.statusChannel ?? null;
  const statusChannelReady = statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel;
  const retryable = diagnostics.some((item) => item.level === 'error') === false
    && (missingMemory.length > 0 || boundaryStatus === 'degraded' || statusChannelReady === false);
  const exhausted = retryable && attempt >= maxAttempts;
  const blockingReasons = unique([
    ...missingClaims.map((claim) => `missing_claim:${claim}`),
    ...(boundaryStatus === 'blocked' ? ['profile_boundary_blocked'] : []),
    ...diagnostics.filter((item) => item.level === 'error').map((item) => item.code),
    ...(exhausted ? ['profile_retry_budget_exhausted'] : [])
  ]);
  const degradedReasons = unique([
    ...missingMemory.map((name) => `missing_durable_memory:${name}`),
    ...(boundaryStatus === 'degraded' ? ['profile_boundary_degraded'] : []),
    ...(statusChannelReady ? [] : ['profile_status_channel_not_kernel']),
    ...diagnostics.filter((item) => item.level === 'warning').map((item) => item.code)
  ]);
  const status = blockingReasons.length > 0
    ? 'blocked'
    : degradedReasons.length > 0
      ? 'degraded'
      : 'ready';
  const nextRetry = retryable && !exhausted ? {
    attempt: attempt + 1,
    maxAttempts,
    delayMs: Math.min(maxBackoffMs, baseBackoffMs * (2 ** attempt)),
    reason: missingMemory.length > 0
      ? 'restore_profile_memory'
      : statusChannelReady === false
        ? 'wait_for_kernel_status_channel'
        : 'profile_boundary_degraded'
  } : null;

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: profile.name ?? state?.profileName ?? 'mailchimp.default',
    operation: profile.operation ?? state?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    degradedMode: status === 'degraded' ? 'client_visible_status_with_resume_guard' : null,
    restartSafe: status === 'ready' && envelope?.restartSafe === true && statusChannelReady,
    retryable,
    nextRetry,
    failureState: {
      blockingReasons,
      degradedReasons,
      missingClaims,
      missingRestorableMemory: missingMemory,
      statusChannel,
      boundaryStatus,
      persistenceStatus: envelope?.status ?? 'unavailable'
    },
    handoff: {
      target: profile.handoff?.target ?? DEFAULT_MAILCHIMP_PROFILE.handoffTarget,
      statusChannel: statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      publish: status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      resumeAction: status === 'blocked'
        ? 'operator_profile_failure_review'
        : status === 'degraded'
          ? 'resume_with_profile_degraded_guard'
          : 'resume'
    },
    actionableErrors: buildProfileActionableErrors({
      missingClaims,
      missingMemory,
      boundaryStatus,
      statusChannelReady,
      exhausted
    }),
    diagnostics
  };
}

export function buildProfileLifecycleControlState(input = {}, options = {}) {
  const persistenceOptions = {
    ...options,
    command: options.persistenceCommand ?? options.profileCommand ?? input.profileCommand ?? {}
  };
  const runtime = buildProfileClientRuntimeState(input, options);
  const persistence = buildProfilePersistenceEnvelope(input, persistenceOptions);
  const failure = buildProfileOperationalFailureState(input, persistenceOptions);
  const state = runtime.state;
  const envelope = persistence.envelope;
  const previous = normalizeProfileLifecycleState(options.previousLifecycle ?? options.previousState ?? input.previousLifecycle);
  const settings = normalizeProfileLifecycleSettings(options.settings ?? input.settings ?? options);
  const command = normalizeProfileLifecycleCommand(options.lifecycleCommand ?? options.command ?? input.lifecycleCommand ?? input.command);
  const commandKey = clean(command.commandKey ?? options.commandKey);
  const seenCommands = new Set([
    ...(previous.appliedCommandKeys ?? []),
    ...(options.appliedCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const repeatedCommand = commandKey && seenCommands.has(commandKey);
  const settingDiagnostics = validateProfileLifecycleSettings(settings);
  const commandDiagnostics = validateProfileLifecycleCommand(command, {
    runtime,
    persistence,
    failure,
    settings,
    previous,
    repeatedCommand
  });
  const retryBudgetExhausted = previous.scheduledRetryCount >= settings.maxScheduledRetries
    && clean(command.action).toLowerCase() === 'retry';
  const diagnostics = [
    ...runtime.diagnostics,
    ...persistence.diagnostics.filter((item) => item.level === 'error'),
    ...failure.diagnostics.filter((item) => item.level === 'error'),
    ...settingDiagnostics,
    ...commandDiagnostics,
    ...(retryBudgetExhausted
      ? [diagnostic('error', 'profile_lifecycle_retry_budget_exhausted', String(settings.maxScheduledRetries))]
      : []),
    ...(repeatedCommand ? [diagnostic('info', 'profile_lifecycle_command_already_applied', commandKey)] : [])
  ];
  const hasErrors = diagnostics.some((item) => item.level === 'error');
  const transition = deriveProfileLifecycleTransition({
    command,
    runtime,
    persistence,
    failure,
    previous,
    settings,
    repeatedCommand,
    hasErrors
  });
  const generation = previous.fingerprint === transition.fingerprint
    ? toNonNegativeInteger(previous.generation, 0)
    : toNonNegativeInteger(previous.generation, 0) + 1;
  const missingClaims = state?.verifier?.missingClaims ?? [];
  const missingMemory = envelope?.memory?.missingRestorable ?? [];

  return {
    ok: !hasErrors,
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: state?.profileName ?? envelope?.profileName ?? 'mailchimp.default',
    operation: state?.operation ?? envelope?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status: transition.status,
    enabled: transition.enabled,
    generation,
    fingerprint: transition.fingerprint,
    settings,
    nextAction: transition.nextAction,
    controls: {
      canEnable: transition.status === 'disabled' || transition.status === 'paused',
      canDisable: transition.status !== 'disabled',
      canPause: transition.status === 'enabled' || transition.status === 'enabled_degraded' || transition.status === 'retry_scheduled',
      canResume: transition.status === 'paused' || transition.status === 'status_acknowledged',
      canRetry: failure.retryable === true && failure.nextRetry !== null && transition.enabled === true,
      canAcknowledgeStatus: failure.handoff?.publish === true || persistence.envelope?.status === 'recovering',
      requiresOperatorReview: transition.status === 'blocked' || transition.status === 'operator_review',
      automaticRetriesRemaining: Math.max(0, settings.maxScheduledRetries - transition.scheduledRetryCount)
    },
    schedule: transition.schedule,
    blockers: {
      missingClaims,
      missingDurableMemory: missingMemory,
      boundaryStatus: state?.boundary?.status ?? failure.failureState?.boundaryStatus ?? 'unknown',
      statusChannelReady: state?.workflow?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      persistenceStatus: envelope?.status ?? 'unavailable',
      failureStatus: failure.status
    },
    idempotency: {
      commandKey: commandKey || null,
      repeated: Boolean(repeatedCommand),
      applied: Boolean(commandKey) && !repeatedCommand && !hasErrors,
      appliedCommandKeys: commandKey && !repeatedCommand && !hasErrors
        ? [...seenCommands, commandKey].sort()
        : [...seenCommands].sort()
    },
    handoff: {
      target: state?.workflow?.target ?? DEFAULT_MAILCHIMP_PROFILE.handoffTarget,
      statusChannel: state?.workflow?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      publish: transition.status !== 'disabled',
      includeFailureState: failure.status !== 'ready',
      includeRetry: Boolean(transition.schedule.nextRetry),
      severity: transition.status === 'blocked' || transition.status === 'operator_review'
        ? 'error'
        : transition.status === 'enabled_degraded' || transition.status === 'retry_scheduled'
          ? 'warning'
          : 'info'
    },
    diagnostics
  };
}

export function buildProfileExportSummary(input = {}, options = {}) {
  const compiled = compileProfileDeclaration(input, options);
  const runtime = buildProfileClientRuntimeState(input, options);
  const persistence = buildProfilePersistenceEnvelope(input, options);
  const failure = buildProfileOperationalFailureState(input, options);
  const previous = normalizeProfileExportHistory(options.previousExport ?? options.previousAnalytics ?? input.previousExport);
  const profile = compiled.profile ?? {};
  const state = runtime.state;
  const envelope = persistence.envelope;
  const now = clean(options.now ?? options.timestamp) || null;
  const diagnostics = [
    ...compiled.diagnostics,
    ...runtime.diagnostics,
    ...persistence.diagnostics,
    ...failure.diagnostics
  ];
  const counters = {
    capabilities: profile.capabilities?.length ?? 0,
    memoryBindings: profile.memory?.length ?? 0,
    durableMemoryBindings: profile.memory?.filter((item) => item.retention !== 'ephemeral').length ?? 0,
    requiredClaims: profile.verifier?.requiredClaims?.length ?? 0,
    missingClaims: state?.verifier?.missingClaims?.length ?? 0,
    missingDurableMemory: envelope?.memory?.missingRestorable?.length ?? 0,
    deniedBoundaryCapabilities: state?.boundary?.deniedCapabilities?.length ?? 0,
    deniedBoundaryPermissions: state?.boundary?.deniedPermissions?.length ?? 0,
    diagnostics: {
      errors: diagnostics.filter((item) => item.level === 'error').length,
      warnings: diagnostics.filter((item) => item.level === 'warning').length,
      info: diagnostics.filter((item) => item.level === 'info').length
    }
  };
  const readiness = deriveProfileExportReadiness({
    runtime,
    persistence,
    failure,
    counters
  });
  const event = {
    sequence: previous.sequence + 1,
    timestamp: now,
    profileName: profile.name ?? state?.profileName ?? 'mailchimp.default',
    operation: profile.operation ?? state?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status: readiness.status,
    restartSafe: readiness.restartSafe,
    missingClaims: counters.missingClaims,
    missingDurableMemory: counters.missingDurableMemory,
    diagnosticErrors: counters.diagnostics.errors
  };
  const timeline = [...previous.timeline, event].slice(-toPositiveInteger(options.historyLimit, 12));
  const statusCounts = timeline.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    ok: readiness.status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: event.profileName,
    operation: event.operation,
    counters,
    readiness,
    history: {
      sequence: event.sequence,
      timeline,
      statusCounts
    },
    report: {
      title: 'mailchimp_profile_export',
      status: readiness.status,
      rows: [
        { key: 'capabilities', value: counters.capabilities, status: counters.capabilities > 0 ? 'ready' : 'blocked' },
        { key: 'requiredClaims', value: counters.requiredClaims, status: counters.missingClaims > 0 ? 'blocked' : 'ready' },
        { key: 'durableMemory', value: counters.durableMemoryBindings, status: counters.missingDurableMemory > 0 ? 'recovering' : 'ready' },
        { key: 'boundary', value: state?.boundary?.status ?? 'unknown', status: state?.boundary?.status ?? 'blocked' },
        { key: 'statusChannel', value: state?.workflow?.statusChannel ?? null, status: readiness.statusChannelReady ? 'ready' : 'blocked' }
      ],
      nextAction: readiness.nextAction,
      actionableErrors: failure.actionableErrors ?? []
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      profileName: event.profileName,
      operation: event.operation,
      status: readiness.status,
      restartSafe: readiness.restartSafe,
      requestKey: state?.requestKey ?? null,
      restartKey: envelope?.restartKey ?? null,
      generation: envelope?.generation ?? 0,
      resumeToken: state?.workflow?.resumeToken ?? null,
      statusChannel: state?.workflow?.statusChannel ?? profile.handoff?.statusChannel ?? null,
      missingClaims: state?.verifier?.missingClaims ?? [],
      missingDurableMemory: envelope?.memory?.missingRestorable ?? [],
      auditSubject: state?.boundary?.auditHandoff?.subject ?? profile.boundary?.auditHandoff?.subject ?? null,
      nextAction: readiness.nextAction
    },
    diagnostics
  };
}

export function buildProfileRestartRecoveryPacket(input = {}, options = {}) {
  const runtime = buildProfileClientRuntimeState(input, options);
  const persistence = buildProfilePersistenceEnvelope(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command
  });
  const failure = buildProfileOperationalFailureState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command,
    attempt: options.attempt ?? options.profileAttempt,
    maxAttempts: options.maxAttempts ?? options.maxProfileAttempts
  });
  const lifecycle = buildProfileLifecycleControlState(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand,
    profileCommand: options.profileCommand ?? options.command,
    settings: options.settings ?? options.profileLifecycleSettings
  });
  const previous = normalizeProfileRestartPacket(options.previousRestartPacket ?? input.previousRestartPacket);
  const state = runtime.state;
  const envelope = persistence.envelope;
  const missingClaims = state?.verifier?.missingClaims ?? [];
  const missingMemory = envelope?.memory?.missingRestorable ?? [];
  const statusChannel = state?.workflow?.statusChannel ?? envelope?.recovery?.statusChannel ?? null;
  const statusChannelReady = statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel;
  const lifecycleBlocked = ['disabled', 'paused', 'operator_review', 'blocked'].includes(lifecycle.status);
  const restartBlocked = runtime.ok !== true
    || persistence.ok !== true
    || failure.status === 'blocked'
    || missingClaims.length > 0
    || lifecycleBlocked;
  const restartDegraded = restartBlocked !== true && (
    failure.status === 'degraded'
    || lifecycle.status === 'retry_scheduled'
    || lifecycle.status === 'enabled_degraded'
    || statusChannelReady !== true
    || missingMemory.length > 0
  );
  const status = restartBlocked ? 'blocked' : restartDegraded ? 'degraded' : 'ready';
  const resumeSteps = deriveProfileRestartResumeSteps({
    status,
    missingClaims,
    missingMemory,
    lifecycle,
    failure,
    statusChannelReady
  });
  const checkpoint = {
    profileName: state?.profileName ?? envelope?.profileName ?? 'mailchimp.default',
    operation: state?.operation ?? envelope?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    requestKey: state?.requestKey ?? envelope?.requestKey ?? DEFAULT_CLIENT_RUNTIME.requestKey,
    restartKey: envelope?.restartKey ?? null,
    resumeToken: state?.workflow?.resumeToken ?? envelope?.recovery?.resumeToken ?? null,
    generation: envelope?.generation ?? 0,
    workflowState: state?.workflow?.state ?? envelope?.workflow?.persistedState ?? 'unavailable',
    persistenceStatus: envelope?.status ?? 'unavailable',
    lifecycleStatus: lifecycle.status ?? 'unavailable',
    failureStatus: failure.status ?? 'unavailable',
    statusChannel
  };
  const fingerprint = profileRestartPacketFingerprint({
    checkpoint,
    status,
    missingClaims,
    missingMemory,
    resumeSteps,
    lifecycleStatus: lifecycle.status,
    failureStatus: failure.status
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...runtime.diagnostics,
    ...persistence.diagnostics.filter((item) => item.level === 'error'),
    ...failure.diagnostics.filter((item) => item.level === 'error'),
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...(statusChannelReady ? [] : [diagnostic('warning', 'profile_restart_status_channel_not_kernel', statusChannel ?? 'missing_status_channel')]),
    ...(lifecycleBlocked ? [diagnostic('error', 'profile_restart_lifecycle_blocks_resume', lifecycle.status)] : [])
  ];
  const restartSafe = status === 'ready'
    && statusChannelReady
    && envelope?.restartSafe === true
    && lifecycle.ok === true
    && failure.restartSafe !== false;
  const nextAction = status === 'blocked'
    ? resumeSteps[0]?.action ?? 'operator_profile_restart_review'
    : status === 'degraded'
      ? 'publish_profile_restart_degraded_status'
      : changed
        ? 'publish_profile_restart_checkpoint'
        : 'reuse_profile_restart_checkpoint';

  return {
    ok: status !== 'blocked' && !diagnostics.some((item) => item.level === 'error'),
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: checkpoint.profileName,
    operation: checkpoint.operation,
    status: diagnostics.some((item) => item.level === 'error') ? 'blocked' : status,
    restartSafe,
    sequence,
    fingerprint,
    changed,
    checkpoint,
    resumePlan: {
      mode: restartSafe ? 'resume_from_persisted_checkpoint' : status === 'degraded' ? 'guarded_resume' : 'manual_recovery',
      steps: resumeSteps,
      blockedBy: unique([
        ...missingClaims.map((claim) => `missing_claim:${claim}`),
        ...(['disabled', 'paused', 'operator_review', 'blocked'].includes(lifecycle.status) ? [`lifecycle:${lifecycle.status}`] : []),
        ...(failure.status === 'blocked' ? failure.failureState?.blockingReasons ?? ['profile_failure_state'] : [])
      ]),
      degradedBy: unique([
        ...missingMemory.map((name) => `missing_memory:${name}`),
        ...(statusChannelReady ? [] : ['status_channel_not_kernel']),
        ...(failure.status === 'degraded' ? failure.failureState?.degradedReasons ?? ['profile_failure_state'] : []),
        ...(['retry_scheduled', 'enabled_degraded'].includes(lifecycle.status) ? [`lifecycle:${lifecycle.status}`] : [])
      ])
    },
    handoff: {
      target: state?.workflow?.target ?? DEFAULT_MAILCHIMP_PROFILE.handoffTarget,
      statusChannel: statusChannelReady ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-restart',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeCheckpoint: true,
      includeResumePlan: status !== 'ready' || restartSafe !== true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_restart_recovery',
      profileName: checkpoint.profileName,
      operation: checkpoint.operation,
      status: diagnostics.some((item) => item.level === 'error') ? 'blocked' : status,
      restartSafe,
      sequence,
      fingerprint,
      changed,
      restartKey: checkpoint.restartKey,
      resumeToken: checkpoint.resumeToken,
      missingClaims,
      missingDurableMemory: missingMemory,
      lifecycleStatus: lifecycle.status,
      failureStatus: failure.status,
      nextAction
    },
    diagnostics
  };
}

export function buildProfilePreviewAcceptanceState(input = {}, options = {}) {
  const runtime = buildProfileClientRuntimeState(input, options);
  const persistence = buildProfilePersistenceEnvelope(input, options);
  const failure = buildProfileOperationalFailureState(input, options);
  const providerService = buildProfileProviderServiceContract(input, {
    ...options,
    previousProviderState: options.previousProviderState ?? input.previousProviderState,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? input.requestedProviderCapabilities
  });
  const acceptance = normalizeProfilePreviewAcceptance(options.acceptance ?? input.acceptance);
  const state = runtime.state;
  const envelope = persistence.envelope;
  const requiredItems = unique([
    'profile_contract',
    'required_claims',
    'status_handoff',
    'provider_service',
    'tenant_boundary',
    ...parseList(options.requiredPreviewItems ?? input.requiredPreviewItems)
  ]);
  const rows = [
    {
      key: 'profile_contract',
      label: 'Mailchimp profile contract',
      status: runtime.ok ? 'ready' : 'blocked',
      required: requiredItems.includes('profile_contract'),
      accepted: acceptance.acceptedItems.includes('profile_contract'),
      evidence: {
        profileName: state?.profileName ?? envelope?.profileName ?? 'mailchimp.default',
        operation: state?.operation ?? envelope?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
        capabilityCount: state?.kernelJob?.capabilityRefs?.length ?? 0,
        memoryCount: state?.memory?.bindings?.length ?? 0
      },
      nextStep: runtime.ok ? 'include_profile_contract' : 'repair_profile_contract'
    },
    {
      key: 'required_claims',
      label: 'Required claims',
      status: (state?.verifier?.missingClaims ?? []).length > 0 ? 'blocked' : 'ready',
      required: requiredItems.includes('required_claims'),
      accepted: acceptance.acceptedItems.includes('required_claims'),
      evidence: {
        requiredClaims: state?.verifier?.claimChecklist?.map((item) => item.claim) ?? [],
        missingClaims: state?.verifier?.missingClaims ?? []
      },
      nextStep: (state?.verifier?.missingClaims ?? []).length > 0
        ? 'collect_required_profile_claims'
        : 'include_claim_verifier'
    },
    {
      key: 'durable_memory',
      label: 'Durable memory',
      status: (envelope?.memory?.missingRestorable ?? []).length > 0 ? 'degraded' : 'ready',
      required: requiredItems.includes('durable_memory'),
      accepted: acceptance.acceptedItems.includes('durable_memory'),
      evidence: {
        expectedDurable: envelope?.memory?.expectedDurable ?? [],
        restored: envelope?.memory?.restored ?? [],
        missingRestorable: envelope?.memory?.missingRestorable ?? []
      },
      nextStep: (envelope?.memory?.missingRestorable ?? []).length > 0
        ? 'restore_durable_profile_memory'
        : 'include_memory_bindings'
    },
    {
      key: 'status_handoff',
      label: 'Kernel status handoff',
      status: state?.workflow?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel ? 'ready' : 'blocked',
      required: requiredItems.includes('status_handoff'),
      accepted: acceptance.acceptedItems.includes('status_handoff'),
      evidence: {
        target: state?.workflow?.target ?? DEFAULT_MAILCHIMP_PROFILE.handoffTarget,
        statusChannel: state?.workflow?.statusChannel ?? null,
        resumeToken: state?.workflow?.resumeToken ?? null
      },
      nextStep: state?.workflow?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
        ? 'publish_profile_status_handoff'
        : 'route_profile_status_to_kernel'
    },
    {
      key: 'provider_service',
      label: 'Provider service',
      status: providerService.status ?? 'blocked',
      required: requiredItems.includes('provider_service'),
      accepted: acceptance.acceptedItems.includes('provider_service'),
      evidence: {
        service: providerService.contract?.service ?? null,
        missingCapabilities: providerService.negotiation?.missingCapabilities ?? [],
        externalState: providerService.externalState ?? null
      },
      nextStep: providerService.status === 'blocked'
        ? 'repair_profile_provider_contract'
        : providerService.status === 'degraded'
          ? 'publish_profile_provider_degraded_status'
          : 'include_provider_service'
    },
    {
      key: 'tenant_boundary',
      label: 'Tenant boundary',
      status: state?.boundary?.status ?? 'blocked',
      required: requiredItems.includes('tenant_boundary'),
      accepted: acceptance.acceptedItems.includes('tenant_boundary'),
      evidence: {
        tenantId: state?.boundary?.tenantId ?? null,
        workspaceId: state?.boundary?.workspaceId ?? null,
        role: state?.boundary?.role ?? null,
        deniedCapabilities: state?.boundary?.deniedCapabilities ?? [],
        deniedPermissions: state?.boundary?.deniedPermissions ?? []
      },
      nextStep: state?.boundary?.status === 'blocked'
        ? 'review_profile_tenant_boundary'
        : state?.boundary?.status === 'degraded'
          ? 'publish_profile_boundary_advisory'
          : 'include_profile_boundary'
    }
  ];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const degradedRows = requiredRows.filter((row) => row.status === 'degraded');
  const awaitingAcceptance = requiredRows.filter((row) => row.accepted !== true);
  const diagnostics = [
    ...runtime.diagnostics,
    ...persistence.diagnostics.filter((item) => item.level === 'error'),
    ...failure.diagnostics.filter((item) => item.level === 'error'),
    ...providerService.diagnostics.filter((item) => item.level === 'error'),
    ...(acceptance.requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => diagnostic('error', 'profile_preview_acceptance_missing', row.key))
      : awaitingAcceptance.map((row) => diagnostic('warning', 'profile_preview_acceptance_pending', row.key)))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: state?.profileName ?? envelope?.profileName ?? 'mailchimp.default',
    operation: state?.operation ?? envelope?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    restartSafe: status === 'ready'
      && runtime.ok
      && persistence.envelope?.restartSafe === true
      && providerService.restartSafe === true,
    preview: {
      rows,
      acceptedItems: acceptance.acceptedItems,
      acceptedAt: acceptance.acceptedAt,
      acceptedBy: acceptance.acceptedBy,
      requireExplicitAcceptance: acceptance.requireExplicitAcceptance
    },
    validationSummary: {
      totalRows: rows.length,
      requiredRows: requiredRows.length,
      blockedRows: blockedRows.length,
      degradedRows: degradedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      missingClaims: state?.verifier?.missingClaims?.length ?? 0,
      missingDurableMemory: envelope?.memory?.missingRestorable?.length ?? 0,
      providerMissingCapabilities: providerService.negotiation?.missingCapabilities?.length ?? 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status,
      blockingReasons: unique([
        ...blockedRows.map((row) => row.key),
        ...(state?.verifier?.missingClaims ?? []).map((claim) => `missing_claim:${claim}`),
        ...(providerService.negotiation?.missingCapabilities ?? []).map((capability) => `missing_provider:${capability}`)
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.key),
        ...(!acceptance.requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction: status === 'blocked'
        ? 'resolve_profile_preview_blockers'
        : status === 'degraded'
          ? 'publish_profile_preview_degraded_status'
          : 'publish_profile_preview_ready'
    },
    explanation: {
      headline: status === 'ready'
        ? 'mailchimp_profile_preview_ready'
        : status === 'degraded'
          ? 'mailchimp_profile_preview_needs_attention'
          : 'mailchimp_profile_preview_blocked',
      nextSteps: unique(rows
        .filter((row) => row.status !== 'ready' || row.accepted !== true)
        .map((row) => row.nextStep))
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      status,
      restartSafe: status === 'ready' && providerService.restartSafe === true,
      profileName: state?.profileName ?? envelope?.profileName ?? 'mailchimp.default',
      operation: state?.operation ?? envelope?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key),
      missingClaims: state?.verifier?.missingClaims ?? [],
      missingDurableMemory: envelope?.memory?.missingRestorable ?? [],
      providerMissingCapabilities: providerService.negotiation?.missingCapabilities ?? [],
      statusChannel: state?.workflow?.statusChannel ?? null,
      nextAction: status === 'ready' ? 'publish_profile_preview_ready' : 'review_profile_preview'
    },
    diagnostics
  };
}

export function buildProfileProviderServiceContract(input = {}, options = {}) {
  const compiled = compileProfileDeclaration(input, options);
  if (!compiled.ok && !compiled.profile) return { ok: false, contract: null, diagnostics: compiled.diagnostics };
  const profile = compiled.profile ?? {};
  const service = profile.providerService ?? deriveProfileProviderServiceContract({
    fields: {},
    options,
    operation: profile.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    capabilities: profile.capabilities ?? []
  }).contract;
  const previous = normalizeProviderServiceState(options.previousProviderState ?? input.previousProviderState);
  const commandKey = clean(options.providerCommandKey ?? options.commandKey ?? input.providerCommandKey);
  const seenCommands = new Set([
    ...(previous.appliedCommandKeys ?? []),
    ...(options.appliedProviderCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const repeatedCommand = commandKey && seenCommands.has(commandKey);
  const requestedCapabilities = unique([
    ...(profile.capabilities ?? []),
    ...parseList(options.requestedProviderCapabilities ?? input.requestedProviderCapabilities)
  ]);
  const missingCapabilities = requestedCapabilities.filter((capability) => (
    capability.startsWith('mailchimp.') && !service.capabilities.offered.includes(capability)
  ));
  const syncCursor = clean(options.syncCursor ?? input.syncCursor ?? previous.sync?.cursor);
  const status = missingCapabilities.length > 0 || service.externalState.ready !== true
    ? 'blocked'
    : service.status === 'degraded'
      ? 'degraded'
      : 'ready';
  const fingerprint = [
    service.provider,
    service.service,
    service.sync.mode,
    service.externalState.statusChannel,
    syncCursor || 'no_cursor',
    ...missingCapabilities
  ].join('|');
  const generation = previous.fingerprint === fingerprint
    ? toNonNegativeInteger(previous.generation, 0)
    : toNonNegativeInteger(previous.generation, 0) + 1;
  const diagnostics = [
    ...compiled.diagnostics,
    ...missingCapabilities.map((capability) => diagnostic('error', 'profile_provider_capability_missing', capability)),
    ...(service.externalState.ready ? [] : [diagnostic('error', 'profile_provider_external_state_not_ready', service.externalState.statusChannel)]),
    ...(repeatedCommand ? [diagnostic('info', 'profile_provider_command_already_applied', commandKey)] : [])
  ];

  return {
    ok: status !== 'blocked' && !diagnostics.some((item) => item.level === 'error'),
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: profile.name ?? 'mailchimp.default',
    operation: profile.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status: diagnostics.some((item) => item.level === 'error') ? 'blocked' : status,
    restartSafe: status === 'ready' && service.externalState.restartSafe === true,
    generation,
    fingerprint,
    contract: service,
    negotiation: {
      requestedCapabilities,
      offeredCapabilities: service.capabilities.offered,
      missingCapabilities,
      status: missingCapabilities.length > 0 ? 'capability_gap' : 'satisfied'
    },
    sync: {
      ...service.sync,
      cursor: syncCursor || null,
      nextSyncAfterMs: service.sync.mode === 'manual' ? null : service.sync.windowMs
    },
    externalState: service.externalState,
    idempotency: {
      commandKey: commandKey || null,
      repeated: Boolean(repeatedCommand),
      applied: Boolean(commandKey) && !repeatedCommand && diagnostics.every((item) => item.level !== 'error'),
      appliedCommandKeys: commandKey && !repeatedCommand && diagnostics.every((item) => item.level !== 'error')
        ? [...seenCommands, commandKey].sort()
        : [...seenCommands].sort()
    },
    handoff: {
      target: service.externalState.target,
      statusChannel: service.externalState.statusChannel,
      publish: status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      nextAction: status === 'blocked'
        ? 'repair_profile_provider_contract'
        : status === 'degraded'
          ? 'publish_provider_degraded_status'
          : 'publish_provider_ready_status'
    },
    diagnostics
  };
}

export function buildProfileProviderAdoptionContract(input = {}, options = {}) {
  const provider = buildProfileProviderServiceContract(input, {
    ...options,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities
  });
  const runtime = buildProfileClientRuntimeState(input, options);
  const previous = normalizeProviderAdoptionState(options.previousAdoption ?? options.previousProviderAdoption ?? input.previousAdoption);
  const acceptance = normalizeProviderAdoptionAcceptance(options.acceptance ?? options.providerAdoptionAcceptance ?? input.providerAdoptionAcceptance);
  const requiredCapabilities = unique([
    ...(provider.negotiation?.requestedCapabilities ?? []),
    ...parseList(options.requiredProviderCapabilities ?? input.requiredProviderCapabilities)
  ]);
  const offeredCapabilities = unique(provider.negotiation?.offeredCapabilities ?? []);
  const missingCapabilities = requiredCapabilities.filter((capability) => (
    capability.startsWith('mailchimp.') && !offeredCapabilities.includes(capability)
  ));
  const syncCursor = clean(provider.sync?.cursor);
  const previousCursor = clean(previous.syncCursor);
  const cursorChanged = previousCursor && syncCursor && previousCursor !== syncCursor;
  const externalReady = provider.externalState?.ready === true
    && provider.externalState?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel;
  const rows = [
    {
      key: 'provider_service',
      label: 'Mailchimp provider service',
      status: provider.status ?? 'blocked',
      accepted: acceptance.acceptedItems.includes('provider_service'),
      required: true,
      evidence: {
        provider: provider.contract?.provider ?? 'mailchimp',
        service: provider.contract?.service ?? 'marketing-api',
        syncMode: provider.sync?.mode ?? null
      },
      nextStep: provider.status === 'blocked'
        ? 'repair_profile_provider_contract'
        : acceptance.requireExplicitAcceptance && !acceptance.acceptedItems.includes('provider_service')
          ? 'accept_profile_provider_service'
          : 'adopt_profile_provider_service'
    },
    {
      key: 'provider_capabilities',
      label: 'Mailchimp provider capabilities',
      status: missingCapabilities.length > 0 ? 'blocked' : provider.negotiation?.status === 'satisfied' ? 'ready' : 'degraded',
      accepted: acceptance.acceptedItems.includes('provider_capabilities'),
      required: true,
      evidence: {
        requestedCapabilities: requiredCapabilities,
        offeredCapabilities,
        missingCapabilities
      },
      nextStep: missingCapabilities.length > 0
        ? 'repair_profile_provider_capabilities'
        : acceptance.requireExplicitAcceptance && !acceptance.acceptedItems.includes('provider_capabilities')
          ? 'accept_profile_provider_capabilities'
          : 'adopt_profile_provider_capabilities'
    },
    {
      key: 'provider_sync',
      label: 'Mailchimp provider sync',
      status: cursorChanged ? 'degraded' : 'ready',
      accepted: acceptance.acceptedItems.includes('provider_sync'),
      required: acceptance.requiredItems.length === 0 || acceptance.requiredItems.includes('provider_sync'),
      evidence: {
        mode: provider.sync?.mode ?? null,
        cursor: syncCursor || null,
        previousCursor: previousCursor || null,
        nextSyncAfterMs: provider.sync?.nextSyncAfterMs ?? null
      },
      nextStep: cursorChanged
        ? 'publish_profile_provider_sync_delta'
        : acceptance.requireExplicitAcceptance && !acceptance.acceptedItems.includes('provider_sync')
          ? 'accept_profile_provider_sync'
          : 'adopt_profile_provider_sync'
    },
    {
      key: 'external_handoff',
      label: 'Mailchimp provider handoff',
      status: externalReady ? 'ready' : 'blocked',
      accepted: acceptance.acceptedItems.includes('external_handoff'),
      required: true,
      evidence: provider.externalState ?? null,
      nextStep: externalReady
        ? acceptance.requireExplicitAcceptance && !acceptance.acceptedItems.includes('external_handoff')
          ? 'accept_profile_provider_handoff'
          : 'adopt_profile_provider_handoff'
        : 'route_profile_provider_handoff_to_kernel'
    },
    {
      key: 'client_runtime',
      label: 'Profile client runtime',
      status: runtime.ok ? runtime.state?.workflow?.state ?? 'ready' : 'blocked',
      accepted: acceptance.acceptedItems.includes('client_runtime'),
      required: acceptance.requiredItems.includes('client_runtime'),
      evidence: {
        requestKey: runtime.state?.requestKey ?? null,
        statusChannel: runtime.state?.workflow?.statusChannel ?? null,
        resumeToken: runtime.state?.workflow?.resumeToken ?? null
      },
      nextStep: runtime.ok ? 'attach_provider_to_client_runtime' : 'repair_profile_client_runtime'
    }
  ];
  const requiredRows = rows.filter((row) => row.required);
  const awaitingAcceptance = requiredRows.filter((row) => row.accepted !== true);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const degradedRows = requiredRows.filter((row) => row.status === 'degraded');
  const fingerprint = profileProviderAdoptionFingerprint({
    provider,
    runtime,
    rows,
    missingCapabilities,
    syncCursor
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = toNonNegativeInteger(previous.sequence, 0) + (changed ? 1 : 0);
  const diagnostics = [
    ...provider.diagnostics,
    ...runtime.diagnostics.filter((item) => item.level === 'error'),
    ...missingCapabilities.map((capability) => diagnostic('error', 'profile_provider_adoption_capability_missing', capability)),
    ...(externalReady ? [] : [diagnostic('error', 'profile_provider_adoption_handoff_not_ready', provider.externalState?.statusChannel)]),
    ...(cursorChanged ? [diagnostic('warning', 'profile_provider_adoption_sync_cursor_changed', `${previousCursor}->${syncCursor}`)] : []),
    ...(acceptance.requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => diagnostic('error', 'profile_provider_adoption_acceptance_missing', row.key))
      : awaitingAcceptance.map((row) => diagnostic('warning', 'profile_provider_adoption_acceptance_pending', row.key)))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_profile_provider_adoption_blockers'
    : status === 'degraded'
      ? 'publish_profile_provider_adoption_degraded_status'
      : changed
        ? 'publish_profile_provider_adoption_delta'
        : 'reuse_profile_provider_adoption';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: provider.profileName,
    operation: provider.operation,
    status,
    restartSafe: status === 'ready' && provider.restartSafe === true && runtime.ok === true,
    sequence,
    fingerprint,
    changed,
    rows,
    negotiation: {
      requiredCapabilities,
      offeredCapabilities,
      missingCapabilities,
      status: missingCapabilities.length > 0 ? 'capability_gap' : 'satisfied'
    },
    sync: {
      cursor: syncCursor || null,
      previousCursor: previousCursor || null,
      changed: Boolean(cursorChanged),
      mode: provider.sync?.mode ?? null,
      nextSyncAfterMs: provider.sync?.nextSyncAfterMs ?? null
    },
    externalState: provider.externalState,
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.key),
        ...missingCapabilities.map((capability) => `missing:${capability}`)
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.key),
        ...(cursorChanged ? ['sync_cursor_changed'] : []),
        ...(!acceptance.requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: provider.externalState?.target ?? DEFAULT_PROVIDER_SERVICE.statusTarget,
      statusChannel: externalReady ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-provider',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      status,
      restartSafe: status === 'ready' && provider.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      provider: provider.contract?.provider ?? 'mailchimp',
      service: provider.contract?.service ?? 'marketing-api',
      missingCapabilities,
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key),
      syncCursor: syncCursor || null,
      nextAction
    },
    diagnostics
  };
}

export function buildProfileProviderSyncIntent(input = {}, options = {}) {
  const provider = buildProfileProviderServiceContract(input, {
    ...options,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities
  });
  const adoption = buildProfileProviderAdoptionContract(input, {
    ...options,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    previousAdoption: options.previousAdoption ?? options.previousProfileProviderAdoption,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? options.profileProviderCapabilities,
    acceptance: options.acceptance ?? options.profileProviderAdoptionAcceptance
  });
  const previous = normalizeProfileProviderSyncIntent(options.previousSyncIntent ?? options.previousProfileProviderSyncIntent ?? input.previousSyncIntent);
  const commandKey = clean(options.syncCommandKey ?? options.providerSyncCommandKey ?? options.commandKey ?? input.syncCommandKey);
  const seenCommands = new Set([
    ...(previous.appliedCommandKeys ?? []),
    ...(options.appliedSyncCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const repeatedCommand = commandKey && seenCommands.has(commandKey);
  const requestedCapabilities = unique([
    ...(provider.negotiation?.requestedCapabilities ?? []),
    ...(adoption.negotiation?.requiredCapabilities ?? []),
    ...parseList(options.requiredProviderCapabilities ?? input.requiredProviderCapabilities)
  ]);
  const missingCapabilities = requestedCapabilities.filter((capability) => (
    capability.startsWith('mailchimp.') && !(provider.negotiation?.offeredCapabilities ?? []).includes(capability)
  ));
  const cursor = clean(options.syncCursor ?? input.syncCursor ?? provider.sync?.cursor ?? adoption.sync?.cursor);
  const previousCursor = clean(previous.cursor ?? adoption.sync?.previousCursor);
  const cursorChanged = Boolean(previousCursor && cursor && previousCursor !== cursor);
  const externalStateReady = provider.externalState?.ready === true
    && provider.externalState?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel;
  const blocked = provider.status === 'blocked'
    || adoption.status === 'blocked'
    || missingCapabilities.length > 0
    || externalStateReady !== true;
  const degraded = blocked !== true && (
    provider.status === 'degraded'
    || adoption.status === 'degraded'
    || cursorChanged
    || repeatedCommand
  );
  const status = blocked ? 'blocked' : degraded ? 'degraded' : 'ready';
  const fingerprint = profileProviderSyncIntentFingerprint({
    provider,
    adoption,
    status,
    cursor,
    requestedCapabilities,
    missingCapabilities,
    externalStateReady
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...provider.diagnostics,
    ...adoption.diagnostics.filter((item) => item.level === 'error'),
    ...missingCapabilities.map((capability) => diagnostic('error', 'profile_provider_sync_capability_missing', capability)),
    ...(externalStateReady ? [] : [diagnostic('error', 'profile_provider_sync_handoff_not_ready', provider.externalState?.statusChannel)]),
    ...(cursorChanged ? [diagnostic('warning', 'profile_provider_sync_cursor_changed', `${previousCursor}->${cursor}`)] : []),
    ...(repeatedCommand ? [diagnostic('info', 'profile_provider_sync_command_already_applied', commandKey)] : [])
  ];
  const nextAction = status === 'blocked'
    ? 'resolve_profile_provider_sync_blockers'
    : status === 'degraded'
      ? 'publish_profile_provider_sync_degraded'
      : changed
        ? 'publish_profile_provider_sync_intent'
        : 'reuse_profile_provider_sync_intent';

  return {
    ok: status !== 'blocked' && !diagnostics.some((item) => item.level === 'error'),
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: provider.profileName,
    operation: provider.operation,
    status: diagnostics.some((item) => item.level === 'error') ? 'blocked' : status,
    restartSafe: status === 'ready' && provider.restartSafe === true && adoption.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    provider: {
      provider: provider.contract?.provider ?? DEFAULT_PROVIDER_SERVICE.provider,
      service: provider.contract?.service ?? DEFAULT_PROVIDER_SERVICE.service,
      status: provider.status,
      adoptionStatus: adoption.status
    },
    sync: {
      mode: provider.sync?.mode ?? DEFAULT_PROVIDER_SERVICE.syncMode,
      cursor: cursor || null,
      previousCursor: previousCursor || null,
      changed: cursorChanged,
      windowMs: provider.sync?.windowMs ?? null,
      nextSyncAfterMs: provider.sync?.nextSyncAfterMs ?? null,
      cursorKey: provider.contract?.sync?.cursorKey ?? DEFAULT_PROVIDER_SERVICE.syncCursorKey
    },
    capabilityNegotiation: {
      requestedCapabilities,
      offeredCapabilities: provider.negotiation?.offeredCapabilities ?? [],
      missingCapabilities,
      status: missingCapabilities.length > 0 ? 'capability_gap' : 'satisfied'
    },
    externalState: {
      ...(provider.externalState ?? {}),
      ready: externalStateReady,
      statusChannel: provider.externalState?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel
    },
    idempotency: {
      commandKey: commandKey || null,
      repeated: Boolean(repeatedCommand),
      applied: Boolean(commandKey) && !repeatedCommand && diagnostics.every((item) => item.level !== 'error'),
      appliedCommandKeys: commandKey && !repeatedCommand && diagnostics.every((item) => item.level !== 'error')
        ? [...seenCommands, commandKey].sort()
        : [...seenCommands].sort()
    },
    readiness: {
      blockingReasons: unique([
        ...(provider.status === 'blocked' ? ['profile_provider_service'] : []),
        ...(adoption.status === 'blocked' ? ['profile_provider_adoption'] : []),
        ...missingCapabilities.map((capability) => `missing:${capability}`),
        ...(externalStateReady ? [] : ['external_handoff'])
      ]),
      degradedReasons: unique([
        ...(provider.status === 'degraded' ? ['profile_provider_service'] : []),
        ...(adoption.status === 'degraded' ? ['profile_provider_adoption'] : []),
        ...(cursorChanged ? ['sync_cursor_changed'] : []),
        ...(repeatedCommand ? ['idempotent_command'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: provider.externalState?.target ?? DEFAULT_PROVIDER_SERVICE.statusTarget,
      statusChannel: externalStateReady ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-provider-sync',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeSyncIntent: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_provider_sync_intent',
      profileName: provider.profileName,
      operation: provider.operation,
      status: diagnostics.some((item) => item.level === 'error') ? 'blocked' : status,
      restartSafe: status === 'ready' && provider.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      syncCursor: cursor || null,
      missingCapabilities,
      nextAction
    },
    diagnostics
  };
}

export function buildProfileActivationControlPanel(input = {}, options = {}) {
  const lifecycle = buildProfileLifecycleControlState(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand ?? options.command,
    settings: options.settings ?? options.profileLifecycleSettings
  });
  const provider = buildProfileProviderServiceContract(input, {
    ...options,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities
  });
  const preview = buildProfilePreviewAcceptanceState(input, {
    ...options,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance,
    requiredPreviewItems: options.requiredPreviewItems ?? options.requiredProfilePreviewItems
  });
  const runtime = buildProfileClientRuntimeState(input, options);
  const requestedSettings = normalizeProfileActivationSettings(options.activationSettings ?? options.settings ?? input.activationSettings);
  const desiredState = requestedSettings.enabled === false
    ? 'disabled'
    : requestedSettings.pause === true
      ? 'paused'
      : 'enabled';
  const rows = [
    {
      key: 'profile_lifecycle',
      label: 'Profile lifecycle',
      status: lifecycle.status,
      ready: lifecycle.ok === true && lifecycle.enabled === true && lifecycle.status === 'enabled',
      control: lifecycle.enabled === true ? 'enabled' : 'disabled',
      nextAction: lifecycle.nextAction,
      evidence: {
        controls: lifecycle.controls,
        schedule: lifecycle.schedule,
        blockers: lifecycle.blockers
      }
    },
    {
      key: 'provider_service',
      label: 'Provider service',
      status: provider.status,
      ready: provider.status === 'ready' && provider.restartSafe === true,
      control: provider.status === 'blocked' ? 'review' : 'available',
      nextAction: provider.handoff?.nextAction ?? 'publish_provider_ready_status',
      evidence: {
        missingCapabilities: provider.negotiation?.missingCapabilities ?? [],
        sync: provider.sync,
        externalState: provider.externalState
      }
    },
    {
      key: 'profile_preview',
      label: 'Preview acceptance',
      status: preview.status,
      ready: preview.status === 'ready' && preview.restartSafe === true,
      control: preview.validationSummary?.awaitingAcceptance > 0 ? 'awaiting_acceptance' : 'accepted',
      nextAction: preview.readiness?.nextAction ?? preview.exportSummary?.nextAction,
      evidence: {
        awaitingAcceptance: preview.exportSummary?.awaitingAcceptance ?? [],
        missingClaims: preview.exportSummary?.missingClaims ?? [],
        missingDurableMemory: preview.exportSummary?.missingDurableMemory ?? []
      }
    },
    {
      key: 'client_runtime',
      label: 'Client runtime',
      status: runtime.ok ? runtime.state?.workflow?.state ?? 'ready' : 'blocked',
      ready: runtime.ok === true && runtime.state?.verifier?.missingClaims?.length === 0,
      control: runtime.state?.workflow?.resumeMode ?? 'resume_after_kernel_ack',
      nextAction: runtime.state?.recovery?.clientAction ?? 'repair_profile_runtime',
      evidence: {
        requestKey: runtime.state?.requestKey ?? null,
        resumeToken: runtime.state?.workflow?.resumeToken ?? null,
        statusChannel: runtime.state?.workflow?.statusChannel ?? null
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked' || row.ready !== true && row.key !== 'profile_preview');
  const degradedRows = rows.filter((row) => (
    row.status === 'degraded'
    || row.status === 'enabled_degraded'
    || row.status === 'retry_scheduled'
    || row.status === 'paused'
    || row.status === 'disabled'
    || (row.key === 'profile_preview' && row.ready !== true)
  ));
  const diagnostics = [
    ...lifecycle.diagnostics,
    ...provider.diagnostics.filter((item) => item.level === 'error'),
    ...preview.diagnostics.filter((item) => options.enforceProfileActivationPreview === true ? item.level === 'error' : item.level === 'fatal'),
    ...runtime.diagnostics.filter((item) => item.level === 'error'),
    ...(requestedSettings.enabled === false && lifecycle.status !== 'disabled'
      ? [diagnostic('warning', 'profile_activation_requested_disable_pending', lifecycle.status)]
      : []),
    ...(requestedSettings.pause === true && lifecycle.status !== 'paused'
      ? [diagnostic('warning', 'profile_activation_requested_pause_pending', lifecycle.status)]
      : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.some((row) => row.status === 'blocked')
    ? 'blocked'
    : degradedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'degraded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_profile_activation_blockers'
    : desiredState === 'disabled'
      ? 'disable_profile_runtime'
      : desiredState === 'paused'
        ? 'pause_profile_runtime'
        : status === 'degraded'
          ? 'publish_profile_activation_degraded_status'
          : 'activate_profile_runtime';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: lifecycle.profileName,
    operation: lifecycle.operation,
    status,
    desiredState,
    restartSafe: status === 'ready' && lifecycle.ok === true && provider.restartSafe === true && preview.restartSafe === true,
    rows,
    controls: {
      enable: lifecycle.controls?.canEnable === true || lifecycle.status === 'disabled',
      disable: lifecycle.controls?.canDisable === true,
      pause: lifecycle.controls?.canPause === true,
      resume: lifecycle.controls?.canResume === true,
      retry: lifecycle.controls?.canRetry === true,
      acknowledgeStatus: lifecycle.controls?.canAcknowledgeStatus === true
    },
    readiness: {
      blockingReasons: unique(blockedRows.map((row) => row.key)),
      degradedReasons: unique(degradedRows.map((row) => `${row.key}:${row.status}`)),
      nextAction
    },
    handoff: {
      target: runtime.state?.workflow?.target ?? DEFAULT_MAILCHIMP_PROFILE.handoffTarget,
      statusChannel: runtime.state?.workflow?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      publish: status !== 'ready' || desiredState !== 'enabled',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeControls: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      profileName: lifecycle.profileName,
      operation: lifecycle.operation,
      status,
      desiredState,
      restartSafe: status === 'ready' && provider.restartSafe === true,
      blockedRows: blockedRows.map((row) => row.key),
      degradedRows: degradedRows.map((row) => row.key),
      nextAction
    },
    diagnostics
  };
}

export function buildProfileClientWorkflowHandoff(input = {}, options = {}) {
  const runtime = buildProfileClientRuntimeState(input, options);
  const persistence = buildProfilePersistenceEnvelope(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command
  });
  const failure = buildProfileOperationalFailureState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command,
    attempt: options.attempt ?? options.profileAttempt,
    maxAttempts: options.maxAttempts ?? options.maxProfileAttempts
  });
  const lifecycle = buildProfileLifecycleControlState(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand,
    profileCommand: options.profileCommand ?? options.command,
    settings: options.settings ?? options.profileLifecycleSettings
  });
  const exportSummary = buildProfileExportSummary(input, {
    ...options,
    previousExport: options.previousExport ?? options.previousProfileExport,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory
  });
  const preview = buildProfilePreviewAcceptanceState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance,
    requireProfilePreviewAcceptance: options.requireExplicitAcceptance ?? options.requireProfilePreviewAcceptance,
    requiredPreviewItems: options.requiredPreviewItems ?? options.requiredProfilePreviewItems
  });
  const state = runtime.state;
  const envelope = persistence.envelope;
  const diagnostics = [
    ...runtime.diagnostics,
    ...persistence.diagnostics.filter((item) => item.level === 'error'),
    ...failure.diagnostics.filter((item) => item.level === 'error'),
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...preview.diagnostics.filter((item) => item.level === 'error')
  ];
  const rows = [
    {
      id: 'profile_runtime',
      label: 'Profile runtime',
      status: runtime.ok ? state?.workflow?.state ?? 'ready' : 'blocked',
      visibleToClient: true,
      nextAction: state?.recovery?.clientAction ?? 'repair_profile_runtime',
      evidence: {
        requestKey: state?.requestKey ?? null,
        resumeToken: state?.workflow?.resumeToken ?? null,
        statusChannel: state?.workflow?.statusChannel ?? null
      }
    },
    {
      id: 'profile_claims',
      label: 'Required claims',
      status: (state?.verifier?.missingClaims ?? []).length > 0 ? 'blocked' : 'ready',
      visibleToClient: true,
      nextAction: (state?.verifier?.missingClaims ?? []).length > 0
        ? 'collect_required_profile_claims'
        : 'claims_ready_for_verifier',
      evidence: {
        required: state?.verifier?.claimChecklist?.map((item) => item.claim) ?? [],
        missing: state?.verifier?.missingClaims ?? []
      }
    },
    {
      id: 'profile_memory',
      label: 'Durable memory',
      status: (envelope?.memory?.missingRestorable ?? []).length > 0 ? 'recovering' : 'ready',
      visibleToClient: (envelope?.memory?.missingRestorable ?? []).length > 0,
      nextAction: (envelope?.memory?.missingRestorable ?? []).length > 0
        ? 'restore_profile_memory_before_resume'
        : 'memory_ready_for_resume',
      evidence: {
        expectedDurable: envelope?.memory?.expectedDurable ?? [],
        missingRestorable: envelope?.memory?.missingRestorable ?? []
      }
    },
    {
      id: 'profile_lifecycle',
      label: 'Profile lifecycle',
      status: lifecycle.status ?? 'enabled',
      visibleToClient: lifecycle.handoff?.publish !== false,
      nextAction: lifecycle.nextAction ?? 'publish_profile_ready',
      evidence: {
        controls: lifecycle.controls ?? {},
        schedule: lifecycle.schedule ?? null
      }
    },
    {
      id: 'profile_preview',
      label: 'Profile preview',
      status: preview.status ?? 'ready',
      visibleToClient: true,
      nextAction: preview.readiness?.nextAction ?? preview.exportSummary?.nextAction ?? 'publish_profile_preview_ready',
      evidence: {
        awaitingAcceptance: preview.exportSummary?.awaitingAcceptance ?? [],
        providerMissingCapabilities: preview.exportSummary?.providerMissingCapabilities ?? []
      }
    }
  ];
  const blockingRows = rows.filter((row) => row.status === 'blocked' || row.status === 'operator_review');
  const degradedRows = rows.filter((row) => (
    row.status === 'degraded'
    || row.status === 'recovering'
    || row.status === 'enabled_degraded'
    || row.status === 'retry_scheduled'
    || row.status === 'paused'
    || row.status === 'disabled'
  ));
  const status = diagnostics.some((item) => item.level === 'error') || blockingRows.length > 0
    ? 'blocked'
    : degradedRows.length > 0
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: state?.profileName ?? envelope?.profileName ?? 'mailchimp.default',
    operation: state?.operation ?? envelope?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    restartSafe: status === 'ready'
      && persistence.envelope?.restartSafe === true
      && lifecycle.ok
      && preview.restartSafe
      && failure.restartSafe !== false,
    request: {
      requestKey: state?.requestKey ?? envelope?.requestKey ?? null,
      resumeToken: state?.workflow?.resumeToken ?? envelope?.recovery?.resumeToken ?? null,
      workflowState: state?.workflow?.state ?? envelope?.workflow?.persistedState ?? 'unavailable',
      statusVisibility: state?.workflow?.statusVisibility ?? DEFAULT_CLIENT_RUNTIME.statusVisibility
    },
    rows,
    handoff: {
      target: state?.workflow?.target ?? DEFAULT_MAILCHIMP_PROFILE.handoffTarget,
      statusChannel: state?.workflow?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      publish: status !== 'ready' || lifecycle.handoff?.publish !== false,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      nextAction: status === 'blocked'
        ? 'resolve_profile_client_handoff_blockers'
        : status === 'degraded'
          ? 'publish_profile_client_degraded_status'
          : 'publish_profile_client_ready'
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      status,
      restartSafe: status === 'ready' && persistence.envelope?.restartSafe === true,
      profileName: state?.profileName ?? envelope?.profileName ?? 'mailchimp.default',
      operation: state?.operation ?? envelope?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
      requestKey: state?.requestKey ?? envelope?.requestKey ?? null,
      blockingRows: blockingRows.map((row) => row.id),
      degradedRows: degradedRows.map((row) => row.id),
      nextAction: status === 'ready' ? 'publish_profile_client_ready' : 'review_profile_client_handoff'
    },
    diagnostics
  };
}

export function buildProfileOperationalHealthExport(input = {}, options = {}) {
  const exportState = buildProfileExportSummary(input, {
    ...options,
    previousExport: options.previousExport ?? options.previousProfileExport,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory
  });
  const failure = buildProfileOperationalFailureState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    attempt: options.attempt ?? options.profileAttempt,
    maxAttempts: options.maxAttempts ?? options.maxProfileAttempts
  });
  const lifecycle = buildProfileLifecycleControlState(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand,
    profileCommand: options.profileCommand ?? options.command,
    settings: options.settings ?? options.profileLifecycleSettings
  });
  const provider = buildProfileProviderServiceContract(input, {
    ...options,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities
  });
  const preview = buildProfilePreviewAcceptanceState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance,
    requireProfilePreviewAcceptance: options.requireExplicitAcceptance ?? options.requireProfilePreviewAcceptance,
    requiredPreviewItems: options.requiredPreviewItems ?? options.requiredProfilePreviewItems
  });
  const boundaryEvidence = buildProfileBoundaryEvidencePacket(input, {
    ...options,
    previousEvidence: options.previousEvidence ?? options.previousProfileBoundaryEvidence,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    acceptance: options.boundaryAcceptance ?? options.profileBoundaryEvidenceAcceptance
  });
  const clientWorkflow = buildProfileClientWorkflowHandoff(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousExport: options.previousExport ?? options.previousProfileExport,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance
  });
  const previous = normalizeProfileHealthExportHistory(options.previousHealthExport ?? input.previousHealthExport);
  const rows = [
    {
      component: 'profile_export',
      status: exportState.readiness.status,
      restartSafe: exportState.readiness.restartSafe,
      nextAction: exportState.readiness.nextAction,
      evidence: exportState.exportSummary
    },
    {
      component: 'failure_state',
      status: failure.status,
      restartSafe: failure.restartSafe,
      nextAction: failure.handoff?.resumeAction ?? null,
      evidence: {
        blockingReasons: failure.failureState.blockingReasons,
        degradedReasons: failure.failureState.degradedReasons,
        nextRetry: failure.nextRetry,
        actionableErrorCount: failure.actionableErrors.length
      }
    },
    {
      component: 'profile_lifecycle',
      status: lifecycle.status,
      restartSafe: lifecycle.ok && lifecycle.status === 'enabled',
      nextAction: lifecycle.nextAction,
      evidence: {
        controls: lifecycle.controls,
        schedule: lifecycle.schedule,
        blockers: lifecycle.blockers
      }
    },
    {
      component: 'provider_service',
      status: provider.status,
      restartSafe: provider.restartSafe,
      nextAction: provider.handoff?.nextAction ?? null,
      evidence: {
        negotiation: provider.negotiation,
        sync: provider.sync,
        externalState: provider.externalState
      }
    },
    {
      component: 'profile_preview',
      status: preview.status,
      restartSafe: preview.restartSafe,
      nextAction: preview.readiness.nextAction,
      evidence: preview.exportSummary
    },
    {
      component: 'boundary_evidence',
      status: boundaryEvidence.status,
      restartSafe: boundaryEvidence.restartSafe,
      nextAction: boundaryEvidence.readiness.nextAction,
      evidence: boundaryEvidence.exportSummary
    },
    {
      component: 'client_workflow',
      status: clientWorkflow.status,
      restartSafe: clientWorkflow.restartSafe,
      nextAction: clientWorkflow.handoff.nextAction,
      evidence: clientWorkflow.exportSummary
    }
  ];
  const blockedComponents = rows
    .filter((row) => row.status === 'blocked' || row.status === 'operator_review')
    .map((row) => row.component);
  const degradedComponents = rows
    .filter((row) => (
      row.status === 'degraded'
      || row.status === 'recovering'
      || row.status === 'enabled_degraded'
      || row.status === 'retry_scheduled'
      || row.status === 'paused'
      || row.status === 'disabled'
      || row.status === 'status_acknowledged'
    ))
    .map((row) => row.component);
  const diagnostics = [
    ...exportState.diagnostics,
    ...failure.diagnostics,
    ...lifecycle.diagnostics,
    ...provider.diagnostics,
    ...preview.diagnostics,
    ...boundaryEvidence.diagnostics,
    ...clientWorkflow.diagnostics
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedComponents.length > 0
    ? 'blocked'
    : degradedComponents.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'degraded'
      : 'ready';
  const actionQueue = buildProfileHealthActionQueue({
    exportState,
    failure,
    lifecycle,
    provider,
    preview,
    boundaryEvidence,
    clientWorkflow,
    status
  });
  const fingerprint = profileHealthFingerprint({
    profileName: exportState.profileName,
    operation: exportState.operation,
    status,
    rows,
    actionQueue,
    diagnostics
  });
  const sequence = previous.fingerprint === fingerprint
    ? previous.sequence
    : previous.sequence + 1;
  const event = {
    sequence,
    timestamp: clean(options.now ?? options.timestamp) || null,
    profileName: exportState.profileName,
    operation: exportState.operation,
    status,
    fingerprint,
    blockedComponents: blockedComponents.length,
    degradedComponents: degradedComponents.length,
    actionCount: actionQueue.length,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false)
  };
  const timeline = [
    ...previous.timeline,
    ...(previous.fingerprint === fingerprint && previous.timeline.length > 0 ? [] : [event])
  ].slice(-toPositiveInteger(options.healthHistoryLimit ?? options.historyLimit, 12));

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: exportState.profileName,
    operation: exportState.operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
    fingerprint,
    sequence,
    rows,
    blockedComponents,
    degradedComponents,
    counters: {
      components: rows.length,
      blocked: blockedComponents.length,
      degraded: degradedComponents.length,
      actions: actionQueue.length,
      retryableFailures: failure.retryable ? 1 : 0,
      providerMissingCapabilities: provider.negotiation.missingCapabilities.length,
      awaitingPreviewAcceptance: preview.validationSummary.awaitingAcceptance,
      boundaryEvidenceWarnings: boundaryEvidence.validationSummary.diagnosticWarnings,
      diagnostics: {
        errors: diagnostics.filter((item) => item.level === 'error').length,
        warnings: diagnostics.filter((item) => item.level === 'warning').length,
        info: diagnostics.filter((item) => item.level === 'info').length
      }
    },
    actionQueue,
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-health',
      statusChannel: exportState.exportSummary.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
        ? DEFAULT_MAILCHIMP_PROFILE.statusChannel
        : 'local.status.profile-health',
      publish: status !== 'ready' || actionQueue.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeTimeline: true,
      includeActionQueue: actionQueue.length > 0,
      nextAction: actionQueue[0]?.action ?? (status === 'ready' ? 'publish_profile_health_ready' : 'review_profile_health')
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_operational_health',
      profileName: exportState.profileName,
      operation: exportState.operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
      fingerprint,
      sequence,
      blockedComponents,
      degradedComponents,
      actionCount: actionQueue.length,
      nextRetry: failure.nextRetry ?? lifecycle.schedule?.nextRetry ?? null,
      providerSync: provider.sync,
      statusChannel: exportState.exportSummary.statusChannel,
      nextAction: actionQueue[0]?.action ?? (status === 'ready' ? 'publish_profile_health_ready' : 'review_profile_health')
    },
    diagnostics
  };
}

export function buildProfilePrimaryExportPack(input = {}, options = {}) {
  const exportState = buildProfileExportSummary(input, {
    ...options,
    previousExport: options.previousExport ?? options.previousProfileExport,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory
  });
  const operationalHealth = buildProfileOperationalHealthExport(input, {
    ...options,
    previousHealthExport: options.previousHealthExport ?? options.previousProfileHealthExport,
    previousExport: options.previousExport ?? options.previousProfileExport,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    previousEvidence: options.previousEvidence ?? options.previousProfileBoundaryEvidence,
    persistedMemory: options.persistedMemory
  });
  const lifecycle = buildProfileLifecycleControlState(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand,
    profileCommand: options.profileCommand ?? options.command,
    settings: options.settings ?? options.profileLifecycleSettings
  });
  const provider = buildProfileProviderServiceContract(input, {
    ...options,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities
  });
  const preview = buildProfilePreviewAcceptanceState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance,
    requiredPreviewItems: options.requiredPreviewItems ?? options.requiredProfilePreviewItems
  });
  const boundaryEvidence = buildProfileBoundaryEvidencePacket(input, {
    ...options,
    previousEvidence: options.previousEvidence ?? options.previousProfileBoundaryEvidence,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    acceptance: options.boundaryAcceptance ?? options.profileBoundaryEvidenceAcceptance
  });
  const previous = normalizeProfilePrimaryPackHistory(options.previousPrimaryPack ?? options.previousProfilePrimaryPack ?? input.previousPrimaryPack);
  const rows = [
    {
      component: 'profile_export',
      status: exportState.exportSummary.status,
      restartSafe: exportState.exportSummary.restartSafe,
      sequence: exportState.history.sequence,
      nextAction: exportState.exportSummary.nextAction,
      summary: exportState.exportSummary
    },
    {
      component: 'profile_health',
      status: operationalHealth.status,
      restartSafe: operationalHealth.restartSafe,
      sequence: operationalHealth.sequence,
      nextAction: operationalHealth.exportSummary.nextAction,
      summary: operationalHealth.exportSummary
    },
    {
      component: 'profile_lifecycle',
      status: lifecycle.status,
      restartSafe: lifecycle.ok && lifecycle.status === 'enabled',
      sequence: lifecycle.generation,
      nextAction: lifecycle.nextAction,
      summary: {
        controls: lifecycle.controls,
        schedule: lifecycle.schedule,
        blockers: lifecycle.blockers
      }
    },
    {
      component: 'profile_provider',
      status: provider.status,
      restartSafe: provider.restartSafe,
      sequence: provider.generation,
      nextAction: provider.handoff?.nextAction ?? null,
      summary: {
        negotiation: provider.negotiation,
        sync: provider.sync,
        externalState: provider.externalState
      }
    },
    {
      component: 'profile_preview',
      status: preview.status,
      restartSafe: preview.restartSafe,
      sequence: preview.validationSummary.totalRows,
      nextAction: preview.readiness.nextAction,
      summary: preview.exportSummary
    },
    {
      component: 'profile_boundary_evidence',
      status: boundaryEvidence.status,
      restartSafe: boundaryEvidence.restartSafe,
      sequence: boundaryEvidence.sequence,
      nextAction: boundaryEvidence.readiness.nextAction,
      summary: boundaryEvidence.exportSummary
    }
  ];
  const diagnostics = [
    ...exportState.diagnostics,
    ...operationalHealth.diagnostics,
    ...lifecycle.diagnostics,
    ...provider.diagnostics,
    ...preview.diagnostics,
    ...boundaryEvidence.diagnostics
  ];
  const blockedComponents = rows
    .filter((row) => row.status === 'blocked' || row.status === 'operator_review')
    .map((row) => row.component);
  const degradedComponents = rows
    .filter((row) => (
      row.status === 'degraded'
      || row.status === 'recovering'
      || row.status === 'enabled_degraded'
      || row.status === 'retry_scheduled'
      || row.status === 'paused'
      || row.status === 'disabled'
      || row.status === 'status_acknowledged'
    ))
    .map((row) => row.component);
  const diagnosticErrors = diagnostics.filter((item) => item.level === 'error').length;
  const diagnosticWarnings = diagnostics.filter((item) => item.level === 'warning').length;
  const status = diagnosticErrors > 0 || blockedComponents.length > 0
    ? 'blocked'
    : diagnosticWarnings > 0 || degradedComponents.length > 0
      ? 'degraded'
      : 'ready';
  const restartSafe = status === 'ready' && rows.every((row) => row.restartSafe !== false);
  const counters = {
    components: rows.length,
    blocked: blockedComponents.length,
    degraded: degradedComponents.length,
    restartGuarded: rows.filter((row) => row.restartSafe === false).length,
    profileActions: operationalHealth.actionQueue?.length ?? 0,
    missingClaims: exportState.counters.missingClaims,
    missingDurableMemory: exportState.counters.missingDurableMemory,
    providerMissingCapabilities: provider.negotiation.missingCapabilities.length,
    awaitingPreviewAcceptance: preview.validationSummary.awaitingAcceptance,
    awaitingBoundaryAcceptance: boundaryEvidence.validationSummary.awaitingAcceptance,
    diagnostics: {
      errors: diagnosticErrors,
      warnings: diagnosticWarnings,
      info: diagnostics.filter((item) => item.level === 'info').length
    }
  };
  const fingerprint = profilePrimaryPackFingerprint({
    profileName: exportState.profileName,
    operation: exportState.operation,
    status,
    rows,
    counters
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: clean(options.now ?? options.timestamp) || null,
    profileName: exportState.profileName,
    operation: exportState.operation,
    status,
    fingerprint,
    blockedComponents: blockedComponents.length,
    degradedComponents: degradedComponents.length,
    restartSafe,
    changed
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(options.primaryPackHistoryLimit ?? options.historyLimit, 12));
  const nextAction = status === 'blocked'
    ? 'operator_profile_primary_pack_review'
    : operationalHealth.actionQueue?.find((item) => item.severity === 'warning')?.action
      ?? (status === 'degraded' ? 'publish_profile_primary_pack_degraded' : 'publish_profile_primary_pack_ready');

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_primary_export_pack',
    profileName: exportState.profileName,
    operation: exportState.operation,
    status,
    restartSafe,
    sequence,
    fingerprint,
    changed,
    rows,
    blockedComponents,
    degradedComponents,
    counters,
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    report: {
      title: 'mailchimp_profile_primary_export_pack',
      status,
      rows: rows.map((row) => ({
        component: row.component,
        status: row.status,
        restartSafe: row.restartSafe,
        sequence: row.sequence,
        nextAction: row.nextAction
      })),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-primary-pack',
      statusChannel: exportState.exportSummary.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
        ? DEFAULT_MAILCHIMP_PROFILE.statusChannel
        : 'local.status.profile-primary-pack',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeTimeline: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_primary_export_pack',
      profileName: exportState.profileName,
      operation: exportState.operation,
      status,
      restartSafe,
      sequence,
      fingerprint,
      changed,
      blockedComponents,
      degradedComponents,
      counters,
      nextAction
    },
    diagnostics
  };
}

export function buildProfileClientRuntimeAdoptionPack(input = {}, options = {}) {
  const clientWorkflow = buildProfileClientWorkflowHandoff(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousExport: options.previousExport ?? options.previousProfileExport,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance
  });
  const primaryPack = buildProfilePrimaryExportPack(input, {
    ...options,
    previousPrimaryPack: options.previousPrimaryPack ?? options.previousProfilePrimaryPack,
    previousHealthExport: options.previousHealthExport ?? options.previousProfileHealthExport,
    previousExport: options.previousExport ?? options.previousProfileExport,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    previousEvidence: options.previousEvidence ?? options.previousProfileBoundaryEvidence,
    persistedMemory: options.persistedMemory
  });
  const activation = buildProfileActivationControlPanel(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    persistedMemory: options.persistedMemory,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance,
    activationSettings: options.activationSettings ?? options.profileActivationSettings
  });
  const provider = buildProfileProviderAdoptionContract(input, {
    ...options,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    previousAdoption: options.previousAdoption ?? options.previousProfileProviderAdoption,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities,
    acceptance: options.providerAcceptance ?? options.profileProviderAdoptionAcceptance,
    syncCursor: options.syncCursor ?? options.profileSyncCursor
  });
  const previous = normalizeProfileRuntimeAdoptionHistory(options.previousRuntimeAdoption ?? options.previousProfileRuntimeAdoption ?? input.previousRuntimeAdoption);
  const requestKey = clientWorkflow.request?.requestKey ?? null;
  const resumeToken = clientWorkflow.request?.resumeToken ?? null;
  const statusChannel = clientWorkflow.handoff?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel;
  const rows = [
    {
      component: 'client_workflow',
      status: clientWorkflow.status,
      restartSafe: clientWorkflow.restartSafe,
      adopted: clientWorkflow.status === 'ready' && clientWorkflow.restartSafe === true,
      nextAction: clientWorkflow.handoff?.nextAction ?? clientWorkflow.exportSummary?.nextAction ?? null,
      evidence: {
        requestKey,
        resumeToken,
        blockingRows: clientWorkflow.exportSummary?.blockingRows ?? [],
        degradedRows: clientWorkflow.exportSummary?.degradedRows ?? []
      }
    },
    {
      component: 'primary_pack',
      status: primaryPack.status,
      restartSafe: primaryPack.restartSafe,
      adopted: primaryPack.status === 'ready' && primaryPack.restartSafe === true && primaryPack.changed !== true,
      nextAction: primaryPack.handoff?.nextAction ?? primaryPack.exportSummary?.nextAction ?? null,
      evidence: {
        sequence: primaryPack.sequence,
        fingerprint: primaryPack.fingerprint,
        changed: primaryPack.changed,
        restartGuarded: primaryPack.counters?.restartGuarded ?? 0
      }
    },
    {
      component: 'profile_activation',
      status: activation.status,
      restartSafe: activation.restartSafe,
      adopted: activation.status === 'ready' && activation.desiredState === 'enabled',
      nextAction: activation.handoff?.nextAction ?? activation.readiness?.nextAction ?? null,
      evidence: {
        desiredState: activation.desiredState,
        controls: activation.controls,
        blockedRows: activation.exportSummary?.blockedRows ?? []
      }
    },
    {
      component: 'provider_adoption',
      status: provider.status,
      restartSafe: provider.restartSafe,
      adopted: provider.status === 'ready' && provider.restartSafe === true && provider.changed !== true,
      nextAction: provider.handoff?.nextAction ?? provider.readiness?.nextAction ?? null,
      evidence: {
        sequence: provider.sequence,
        changed: provider.changed,
        missingCapabilities: provider.negotiation?.missingCapabilities ?? [],
        statusChannel: provider.externalState?.statusChannel ?? null
      }
    }
  ];
  const blockedComponents = rows
    .filter((row) => row.status === 'blocked' || row.status === 'operator_review')
    .map((row) => row.component);
  const degradedComponents = rows
    .filter((row) => (
      row.status === 'degraded'
      || row.status === 'recovering'
      || row.status === 'retry_scheduled'
      || row.status === 'paused'
      || row.status === 'disabled'
      || row.adopted !== true
      || row.restartSafe === false
    ))
    .map((row) => row.component);
  const diagnostics = [
    ...clientWorkflow.diagnostics,
    ...primaryPack.diagnostics.filter((item) => item.level === 'error'),
    ...activation.diagnostics.filter((item) => item.level === 'error'),
    ...provider.diagnostics.filter((item) => item.level === 'error'),
    ...(statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
      ? []
      : [diagnostic('error', 'profile_runtime_adoption_status_channel_not_kernel', statusChannel)])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedComponents.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedComponents.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = profileRuntimeAdoptionFingerprint({
    profileName: clientWorkflow.profileName,
    operation: clientWorkflow.operation,
    requestKey,
    resumeToken,
    status,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'operator_profile_runtime_adoption_review'
    : provider.changed === true
      ? 'publish_profile_provider_adoption_delta'
      : primaryPack.changed === true
        ? 'publish_profile_primary_pack_delta'
        : status === 'degraded'
          ? 'publish_profile_runtime_adoption_degraded'
          : 'publish_profile_runtime_adoption_ready';
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [{
      sequence,
      timestamp: clean(options.now ?? options.timestamp) || null,
      profileName: clientWorkflow.profileName,
      operation: clientWorkflow.operation,
      status,
      fingerprint,
      requestKey,
      changed,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false)
    }] : [])
  ].slice(-toPositiveInteger(options.runtimeAdoptionHistoryLimit ?? options.historyLimit, 12));

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_client_runtime_adoption',
    profileName: clientWorkflow.profileName,
    operation: clientWorkflow.operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    request: {
      requestKey,
      resumeToken,
      workflowState: clientWorkflow.request?.workflowState ?? null,
      statusVisibility: clientWorkflow.request?.statusVisibility ?? DEFAULT_CLIENT_RUNTIME.statusVisibility
    },
    rows,
    blockedComponents,
    degradedComponents,
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    readiness: {
      blockingReasons: unique([
        ...blockedComponents,
        ...rows.flatMap((row) => row.evidence?.blockingRows ?? []),
        ...(provider.negotiation?.missingCapabilities ?? []).map((capability) => `missing_provider:${capability}`)
      ]),
      degradedReasons: unique([
        ...degradedComponents,
        ...rows.flatMap((row) => row.evidence?.degradedRows ?? [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-runtime-adoption',
      statusChannel: statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
        ? DEFAULT_MAILCHIMP_PROFILE.statusChannel
        : 'local.status.profile-runtime-adoption',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeRequestState: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_client_runtime_adoption',
      profileName: clientWorkflow.profileName,
      operation: clientWorkflow.operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
      sequence,
      fingerprint,
      changed,
      requestKey,
      resumeToken,
      blockedComponents,
      degradedComponents,
      nextAction
    },
    diagnostics
  };
}

export function buildProfileRequestKernelBinding(input = {}, options = {}) {
  const runtime = buildProfileClientRuntimeState(input, options);
  const persistence = buildProfilePersistenceEnvelope(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    command: options.profileCommand ?? options.command,
    persistedMemory: options.persistedMemory
  });
  const lifecycle = buildProfileLifecycleControlState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand,
    profileCommand: options.profileCommand,
    settings: options.settings ?? options.profileLifecycleSettings,
    persistedMemory: options.persistedMemory
  });
  const adoption = buildProfileClientRuntimeAdoptionPack(input, {
    ...options,
    previousRuntimeAdoption: options.previousRuntimeAdoption ?? options.previousProfileRuntimeAdoption,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousExport: options.previousExport ?? options.previousProfileExport,
    previousPrimaryPack: options.previousPrimaryPack ?? options.previousProfilePrimaryPack,
    previousHealthExport: options.previousHealthExport ?? options.previousProfileHealthExport,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    previousAdoption: options.previousAdoption ?? options.previousProfileProviderAdoption,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance,
    providerAcceptance: options.providerAcceptance ?? options.profileProviderAdoptionAcceptance,
    persistedMemory: options.persistedMemory
  });
  const previous = normalizeProfileRequestKernelBinding(options.previousRequestKernelBinding ?? options.previousProfileRequestKernelBinding ?? input.previousRequestKernelBinding);
  const state = runtime.state;
  const envelope = persistence.envelope;
  const requestKey = state?.requestKey ?? adoption.request?.requestKey ?? DEFAULT_CLIENT_RUNTIME.requestKey;
  const resumeToken = state?.workflow?.resumeToken ?? adoption.request?.resumeToken ?? null;
  const kernelJob = state?.kernelJob ?? envelope?.kernelJob ?? {};
  const statusChannel = state?.workflow?.statusChannel ?? adoption.handoff?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel;
  const claimBlockers = state?.verifier?.missingClaims ?? [];
  const memoryBlockers = envelope?.memory?.missingRestorable ?? state?.memory?.missingDurableMemory ?? [];
  const bindingRows = [
    {
      key: 'request_state',
      status: runtime.ok ? 'ready' : 'blocked',
      restartSafe: runtime.ok === true && statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      required: true,
      nextAction: runtime.ok ? 'bind_request_state_to_kernel_job' : 'repair_profile_client_runtime_state',
      evidence: {
        requestKey,
        resumeToken,
        workflowState: state?.workflow?.state ?? null,
        statusChannel
      }
    },
    {
      key: 'kernel_job',
      status: kernelJob.name && (kernelJob.capabilityRefs ?? []).length > 0 ? 'ready' : 'blocked',
      restartSafe: Boolean(kernelJob.name) && (kernelJob.boundaryScope?.tenantId ?? null) !== null,
      required: true,
      nextAction: kernelJob.name ? 'attach_kernel_job_contract' : 'compile_profile_kernel_job',
      evidence: {
        jobName: kernelJob.name ?? null,
        capabilities: kernelJob.capabilityRefs ?? [],
        memoryRefs: kernelJob.memoryRefs ?? [],
        verifierClaims: kernelJob.verifierClaims ?? []
      }
    },
    {
      key: 'persistence_resume',
      status: persistence.ok && memoryBlockers.length === 0 ? 'ready' : persistence.ok ? 'degraded' : 'blocked',
      restartSafe: persistence.envelope?.restartSafe === true,
      required: memoryBlockers.length > 0,
      nextAction: memoryBlockers.length > 0
        ? 'restore_profile_memory_before_kernel_resume'
        : persistence.ok
          ? 'persist_profile_resume_checkpoint'
          : 'repair_profile_persistence_envelope',
      evidence: {
        restartKey: envelope?.restartKey ?? null,
        persistenceStatus: envelope?.status ?? null,
        missingRestorableMemory: memoryBlockers,
        generation: envelope?.generation ?? 0
      }
    },
    {
      key: 'lifecycle_resume',
      status: ['blocked', 'operator_review'].includes(lifecycle.status) ? 'blocked' : lifecycle.status === 'enabled' ? 'ready' : 'degraded',
      restartSafe: lifecycle.restartSafe !== false && lifecycle.controls?.requiresOperatorReview !== true,
      required: true,
      nextAction: lifecycle.nextAction ?? 'publish_profile_lifecycle_status',
      evidence: {
        lifecycleStatus: lifecycle.status,
        enabled: lifecycle.enabled === true,
        canRetry: lifecycle.controls?.canRetry === true,
        requiresOperatorReview: lifecycle.controls?.requiresOperatorReview === true
      }
    },
    {
      key: 'runtime_adoption',
      status: adoption.status,
      restartSafe: adoption.restartSafe === true,
      required: true,
      nextAction: adoption.readiness?.nextAction ?? adoption.handoff?.nextAction ?? null,
      evidence: {
        sequence: adoption.sequence,
        fingerprint: adoption.fingerprint,
        changed: adoption.changed,
        blockedComponents: adoption.blockedComponents,
        degradedComponents: adoption.degradedComponents
      }
    }
  ];
  const blockedRows = bindingRows.filter((row) => row.status === 'blocked').map((row) => row.key);
  const degradedRows = bindingRows
    .filter((row) => row.status === 'degraded' || row.restartSafe === false)
    .map((row) => row.key);
  const diagnostics = [
    ...runtime.diagnostics,
    ...persistence.diagnostics.filter((item) => item.level === 'error'),
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...adoption.diagnostics.filter((item) => item.level === 'error'),
    ...claimBlockers.map((claim) => diagnostic('error', 'profile_request_kernel_claim_missing', claim)),
    ...memoryBlockers.map((name) => diagnostic('warning', 'profile_request_kernel_memory_restore_pending', name)),
    ...(statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
      ? []
      : [diagnostic('error', 'profile_request_kernel_status_channel_not_kernel', statusChannel)]),
    ...(previous.schemaVersion && previous.schemaVersion !== PROFILE_DECLARATION_SCHEMA_VERSION
      ? [diagnostic('warning', 'profile_request_kernel_binding_schema_mismatch', previous.schemaVersion)]
      : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = profileRequestKernelBindingFingerprint({
    profileName: state?.profileName ?? adoption.profileName,
    operation: state?.operation ?? adoption.operation,
    requestKey,
    resumeToken,
    status,
    bindingRows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_profile_request_kernel_binding'
    : status === 'degraded'
      ? 'publish_profile_request_kernel_binding_degraded'
      : changed
        ? 'publish_profile_request_kernel_binding'
        : 'reuse_profile_request_kernel_binding';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_request_kernel_binding',
    profileName: state?.profileName ?? adoption.profileName,
    operation: state?.operation ?? adoption.operation,
    status,
    restartSafe: status === 'ready' && bindingRows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    request: {
      requestKey,
      resumeToken,
      workflowState: state?.workflow?.state ?? null,
      statusChannel,
      handoffTarget: state?.workflow?.target ?? null
    },
    kernelJob,
    rows: bindingRows,
    blockedRows,
    degradedRows,
    readiness: {
      blockingReasons: unique([
        ...blockedRows,
        ...claimBlockers.map((claim) => `missing_claim:${claim}`)
      ]),
      degradedReasons: unique([
        ...degradedRows,
        ...memoryBlockers.map((name) => `missing_memory:${name}`)
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-request-binding',
      statusChannel: statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
        ? DEFAULT_MAILCHIMP_PROFILE.statusChannel
        : 'local.status.profile-request-binding',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRequest: true,
      includeKernelJob: status !== 'ready' || changed,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_request_kernel_binding',
      profileName: state?.profileName ?? adoption.profileName,
      operation: state?.operation ?? adoption.operation,
      status,
      restartSafe: status === 'ready' && bindingRows.every((row) => row.restartSafe !== false),
      sequence,
      fingerprint,
      changed,
      requestKey,
      resumeToken,
      blockedRows,
      degradedRows,
      nextAction
    },
    diagnostics
  };
}

export function buildProfileAudienceExportLedger(input = {}, options = {}) {
  const pack = buildProfilePrimaryExportPack(input, {
    ...options,
    previousPrimaryPack: options.previousPrimaryPack ?? options.previousProfilePrimaryPack,
    previousExport: options.previousExport ?? options.previousProfileExport,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    previousEvidence: options.previousEvidence ?? options.previousProfileBoundaryEvidence,
    persistedMemory: options.persistedMemory
  });
  const previous = normalizeProfileAudienceLedger(options.previousLedger ?? options.previousProfileAudienceLedger ?? input.previousLedger);
  const exportableRows = pack.rows.map((row) => ({
    key: row.component,
    status: row.status,
    restartSafe: row.restartSafe !== false,
    sequence: toNonNegativeInteger(row.sequence, 0),
    exportable: row.status !== 'blocked' && row.status !== 'operator_review',
    nextAction: row.nextAction ?? null
  }));
  const blockedRows = exportableRows.filter((row) => row.exportable !== true);
  const guardedRows = exportableRows.filter((row) => row.restartSafe !== true);
  const counters = {
    rows: exportableRows.length,
    exportable: exportableRows.filter((row) => row.exportable).length,
    blocked: blockedRows.length,
    restartGuarded: guardedRows.length,
    diagnostics: pack.counters.diagnostics,
    profileActions: pack.counters.profileActions,
    missingClaims: pack.counters.missingClaims,
    missingDurableMemory: pack.counters.missingDurableMemory
  };
  const status = pack.status === 'blocked' || blockedRows.length > 0
    ? 'blocked'
    : pack.status === 'degraded' || guardedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = profileAudienceLedgerFingerprint({
    profileName: pack.profileName,
    operation: pack.operation,
    status,
    exportableRows,
    counters
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: clean(options.now ?? options.timestamp) || null,
    profileName: pack.profileName,
    operation: pack.operation,
    status,
    fingerprint,
    exportableRows: counters.exportable,
    blockedRows: counters.blocked,
    restartGuarded: counters.restartGuarded,
    changed
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(options.ledgerHistoryLimit ?? options.historyLimit, 12));
  const nextAction = status === 'blocked'
    ? 'operator_profile_audience_export_review'
    : status === 'degraded'
      ? 'publish_profile_audience_export_degraded'
      : changed
        ? 'publish_profile_audience_export_delta'
        : 'reuse_profile_audience_export_ledger';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_audience_export_ledger',
    profileName: pack.profileName,
    operation: pack.operation,
    status,
    restartSafe: status === 'ready' && pack.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    rows: exportableRows,
    counters,
    blockedRows: blockedRows.map((row) => row.key),
    guardedRows: guardedRows.map((row) => row.key),
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-audience-export-ledger',
      statusChannel: 'kernel.status.mailchimp',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeTimeline: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_audience_export_ledger',
      profileName: pack.profileName,
      operation: pack.operation,
      status,
      restartSafe: status === 'ready' && pack.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      counters,
      blockedRows: blockedRows.map((row) => row.key),
      guardedRows: guardedRows.map((row) => row.key),
      nextAction
    },
    diagnostics: pack.diagnostics
  };
}

export function buildProfileBoundaryEvidencePacket(input = {}, options = {}) {
  const compiled = compileProfileDeclaration(input, options);
  const runtime = buildProfileClientRuntimeState(input, options);
  const lifecycle = buildProfileLifecycleControlState(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand,
    profileCommand: options.profileCommand ?? options.command,
    settings: options.settings ?? options.profileLifecycleSettings
  });
  const acceptance = normalizeProfileBoundaryEvidenceAcceptance(options.acceptance ?? options.boundaryAcceptance ?? input.boundaryAcceptance);
  const previous = normalizeProfileBoundaryEvidenceHistory(options.previousEvidence ?? options.previousProfileBoundaryEvidence ?? input.previousEvidence);
  const profile = compiled.profile ?? {};
  const state = runtime.state;
  const boundary = state?.boundary ?? profile.boundary ?? {};
  const requestedCapabilities = boundary.requestedCapabilities ?? profile.capabilities ?? [];
  const deniedCapabilities = boundary.deniedCapabilities ?? [];
  const declaredPermissions = boundary.declaredPermissions ?? [];
  const deniedPermissions = boundary.deniedPermissions ?? [];
  const rows = [
    {
      key: 'tenant_scope',
      label: 'Tenant scope',
      status: boundary.tenantIsolation === 'blocked' ? 'blocked' : boundary.tenantId ? 'ready' : 'blocked',
      required: true,
      accepted: acceptance.acceptedItems.includes('tenant_scope'),
      evidence: {
        tenantId: boundary.tenantId ?? null,
        requestedTenantId: boundary.requestedTenantId ?? null,
        isolation: boundary.tenantIsolation ?? 'unknown'
      },
      nextStep: boundary.tenantIsolation === 'blocked'
        ? 'block_profile_cross_tenant_request'
        : boundary.tenantId
          ? 'include_profile_tenant_scope'
          : 'declare_profile_tenant_scope'
    },
    {
      key: 'workspace_scope',
      label: 'Workspace scope',
      status: boundary.workspaceIsolation === 'advisory' ? 'degraded' : boundary.workspaceId ? 'ready' : 'blocked',
      required: true,
      accepted: acceptance.acceptedItems.includes('workspace_scope'),
      evidence: {
        workspaceId: boundary.workspaceId ?? null,
        requestedWorkspaceId: boundary.requestedWorkspaceId ?? null,
        isolation: boundary.workspaceIsolation ?? 'unknown'
      },
      nextStep: boundary.workspaceIsolation === 'advisory'
        ? 'publish_profile_workspace_advisory'
        : boundary.workspaceId
          ? 'include_profile_workspace_scope'
          : 'declare_profile_workspace_scope'
    },
    {
      key: 'role_permissions',
      label: 'Role permissions',
      status: deniedPermissions.length > 0 ? 'degraded' : boundary.role ? 'ready' : 'blocked',
      required: true,
      accepted: acceptance.acceptedItems.includes('role_permissions'),
      evidence: {
        role: boundary.role ?? null,
        permissionMode: boundary.permissionMode ?? DEFAULT_PROFILE_BOUNDARY.permissionMode,
        declaredPermissions,
        allowedPermissions: boundary.allowedPermissions ?? [],
        deniedPermissions
      },
      nextStep: deniedPermissions.length > 0
        ? 'ack_profile_permission_advisory'
        : boundary.role
          ? 'include_profile_role_permissions'
          : 'declare_profile_role'
    },
    {
      key: 'capability_boundary',
      label: 'Capability boundary',
      status: deniedCapabilities.length > 0 ? 'degraded' : requestedCapabilities.length > 0 ? 'ready' : 'blocked',
      required: true,
      accepted: acceptance.acceptedItems.includes('capability_boundary'),
      evidence: {
        requestedCapabilities,
        allowedCapabilities: boundary.allowedCapabilities ?? [],
        deniedCapabilities
      },
      nextStep: deniedCapabilities.length > 0
        ? 'ack_profile_capability_advisory'
        : requestedCapabilities.length > 0
          ? 'include_profile_capability_boundary'
          : 'declare_profile_capabilities'
    },
    {
      key: 'audit_handoff',
      label: 'Audit handoff',
      status: boundary.auditHandoff?.target ? 'ready' : 'blocked',
      required: true,
      accepted: acceptance.acceptedItems.includes('audit_handoff'),
      evidence: {
        target: boundary.auditHandoff?.target ?? null,
        subject: boundary.auditHandoff?.subject ?? null,
        decision: boundary.auditHandoff?.decision ?? boundary.status ?? 'unknown'
      },
      nextStep: boundary.auditHandoff?.target
        ? 'publish_profile_boundary_audit_handoff'
        : 'route_profile_boundary_to_kernel_audit'
    }
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded');
  const awaitingAcceptance = rows.filter((row) => row.required && row.accepted !== true);
  const diagnostics = [
    ...compiled.diagnostics,
    ...runtime.diagnostics.filter((item) => item.level === 'error'),
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...(acceptance.requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => diagnostic('error', 'profile_boundary_evidence_acceptance_missing', row.key))
      : awaitingAcceptance.map((row) => diagnostic('warning', 'profile_boundary_evidence_acceptance_pending', row.key)))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = [
    boundary.tenantId,
    boundary.workspaceId,
    boundary.requestedTenantId ?? 'no_requested_tenant',
    boundary.requestedWorkspaceId ?? 'no_requested_workspace',
    boundary.role,
    boundary.permissionMode,
    boundary.status,
    ...deniedCapabilities.map((item) => `cap:${item}`),
    ...deniedPermissions.map((item) => `perm:${item}`)
  ].map(clean).filter(Boolean).join('|');
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: clean(options.now ?? options.timestamp) || null,
    status,
    fingerprint,
    tenantId: boundary.tenantId ?? null,
    workspaceId: boundary.workspaceId ?? null,
    blockedRows: blockedRows.length,
    degradedRows: degradedRows.length,
    deniedCapabilities: deniedCapabilities.length,
    deniedPermissions: deniedPermissions.length,
    changed
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(options.historyLimit ?? options.boundaryHistoryLimit, 12));
  const statusCounts = timeline.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: state?.profileName ?? profile.name ?? 'mailchimp.default',
    operation: state?.operation ?? profile.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    restartSafe: status === 'ready'
      && runtime.ok
      && lifecycle.ok
      && boundary.status === 'ready'
      && boundary.auditHandoff?.target === 'kernel.audit.mailchimp.profile',
    fingerprint,
    sequence,
    scope: {
      tenantId: boundary.tenantId ?? null,
      workspaceId: boundary.workspaceId ?? null,
      requestedTenantId: boundary.requestedTenantId ?? null,
      requestedWorkspaceId: boundary.requestedWorkspaceId ?? null,
      role: boundary.role ?? null,
      permissionMode: boundary.permissionMode ?? DEFAULT_PROFILE_BOUNDARY.permissionMode
    },
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      degradedRows: degradedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      deniedCapabilities: deniedCapabilities.length,
      deniedPermissions: deniedPermissions.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      status,
      blockingReasons: unique([
        ...blockedRows.map((row) => row.key),
        ...(boundary.tenantIsolation === 'blocked' ? ['cross_tenant_request'] : [])
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.key),
        ...(!acceptance.requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction: status === 'blocked'
        ? 'resolve_profile_boundary_evidence_blockers'
        : status === 'degraded'
          ? 'publish_profile_boundary_evidence_advisory'
          : 'publish_profile_boundary_evidence_ready'
    },
    preview: {
      rows,
      acceptedItems: acceptance.acceptedItems,
      acceptedAt: acceptance.acceptedAt,
      acceptedBy: acceptance.acceptedBy,
      requireExplicitAcceptance: acceptance.requireExplicitAcceptance
    },
    history: {
      sequence,
      timeline,
      statusCounts
    },
    auditHandoff: {
      target: boundary.auditHandoff?.target ?? 'kernel.audit.mailchimp.profile',
      subject: boundary.auditHandoff?.subject ?? `${boundary.tenantId ?? 'unknown'}/${boundary.workspaceId ?? 'unknown'}/${state?.operation ?? profile.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation}`,
      decision: status,
      includeRows: true,
      includeDeniedCapabilities: deniedCapabilities.length > 0,
      includeDeniedPermissions: deniedPermissions.length > 0,
      includeAcceptance: awaitingAcceptance.length > 0
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_boundary_evidence',
      status,
      restartSafe: status === 'ready' && boundary.status === 'ready',
      profileName: state?.profileName ?? profile.name ?? 'mailchimp.default',
      operation: state?.operation ?? profile.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
      tenantId: boundary.tenantId ?? null,
      workspaceId: boundary.workspaceId ?? null,
      role: boundary.role ?? null,
      fingerprint,
      sequence,
      blockedRows: blockedRows.map((row) => row.key),
      degradedRows: degradedRows.map((row) => row.key),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key),
      deniedCapabilities,
      deniedPermissions,
      auditSubject: boundary.auditHandoff?.subject ?? null,
      nextAction: status === 'ready' ? 'publish_profile_boundary_evidence_ready' : 'review_profile_boundary_evidence'
    },
    diagnostics
  };
}

export function deriveProfileBoundaryContract({
  fields = {},
  options = {},
  operation = DEFAULT_MAILCHIMP_PROFILE.operation,
  capabilities = [],
  requiredClaims = []
} = {}) {
  const tenantId = clean(fields.tenantId ?? fields.tenant ?? options.tenantId ?? DEFAULT_PROFILE_BOUNDARY.tenantId);
  const workspaceId = clean(fields.workspaceId ?? fields.workspace ?? options.workspaceId ?? DEFAULT_PROFILE_BOUNDARY.workspaceId);
  const requestedTenantId = clean(fields.requestedTenantId ?? options.requestedTenantId ?? options.requestTenantId);
  const requestedWorkspaceId = clean(fields.requestedWorkspaceId ?? options.requestedWorkspaceId ?? options.requestWorkspaceId);
  const role = clean(fields.role ?? options.role ?? DEFAULT_PROFILE_BOUNDARY.role);
  const permissionMode = clean(fields.permissionMode ?? options.permissionMode) || DEFAULT_PROFILE_BOUNDARY.permissionMode;
  const declaredPermissions = unique([
    ...parseList(fields.permissions),
    ...parseList(fields.permission),
    ...parseList(options.permissions)
  ]);
  const rolePolicy = PROFILE_ROLE_PERMISSIONS[role];
  const allowedCapabilities = rolePolicy ? [...rolePolicy.capabilities] : [];
  const allowedPermissions = rolePolicy ? [...rolePolicy.permissions] : [];
  const requestedCapabilities = unique(capabilities);
  const deniedCapabilities = requestedCapabilities.filter((capability) => !allowedCapabilities.includes(capability));
  const deniedPermissions = declaredPermissions.filter((permission) => !allowedPermissions.includes(permission));
  const tenantMismatch = Boolean(requestedTenantId && requestedTenantId !== tenantId);
  const workspaceMismatch = Boolean(requestedWorkspaceId && requestedWorkspaceId !== workspaceId);
  const missingTenantScopedClaims = requiredClaims.includes('audience_id') && !tenantId
    ? ['audience_id']
    : [];
  const diagnostics = [
    ...(tenantId ? [] : [diagnostic('error', 'profile_tenant_missing', operation)]),
    ...(workspaceId ? [] : [diagnostic('error', 'profile_workspace_missing', operation)]),
    ...(rolePolicy ? [] : [diagnostic('error', 'profile_role_unknown', role || 'missing_role')]),
    ...(tenantMismatch ? [diagnostic('error', 'profile_cross_tenant_request_blocked', `${requestedTenantId}->${tenantId}`)] : []),
    ...(workspaceMismatch ? [diagnostic('warning', 'profile_workspace_scope_mismatch', `${requestedWorkspaceId}->${workspaceId}`)] : []),
    ...deniedCapabilities.map((capability) => diagnostic('warning', 'profile_role_capability_outside_boundary', capability)),
    ...deniedPermissions.map((permission) => diagnostic('warning', 'profile_permission_outside_role_boundary', permission)),
    ...missingTenantScopedClaims.map((claim) => diagnostic('error', 'profile_tenant_claim_unscoped', claim)),
    ...(permissionMode === 'permissive' && deniedCapabilities.length > 0
      ? [diagnostic('warning', 'profile_permissive_boundary_requires_audit', role)]
      : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning')
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'blocked',
    contract: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      tenantId,
      workspaceId,
      requestedTenantId: requestedTenantId || null,
      requestedWorkspaceId: requestedWorkspaceId || null,
      role,
      permissionMode,
      status,
      tenantIsolation: tenantMismatch ? 'blocked' : 'enforced',
      workspaceIsolation: workspaceMismatch ? 'advisory' : 'enforced',
      allowedCapabilities: unique(allowedCapabilities),
      requestedCapabilities,
      deniedCapabilities,
      declaredPermissions,
      allowedPermissions: unique(allowedPermissions),
      deniedPermissions,
      auditHandoff: {
        target: 'kernel.audit.mailchimp.profile',
        subject: `${tenantId}/${workspaceId}/${operation}`,
        decision: status,
        includeDeniedCapabilities: deniedCapabilities.length > 0,
        includeDeniedPermissions: deniedPermissions.length > 0,
        includeRequestedScope: Boolean(requestedTenantId || requestedWorkspaceId)
      }
    },
    diagnostics
  };
}

export function deriveProfileProviderServiceContract({
  fields = {},
  options = {},
  operation = DEFAULT_MAILCHIMP_PROFILE.operation,
  capabilities = []
} = {}) {
  const provider = clean(fields.provider ?? options.provider ?? DEFAULT_PROVIDER_SERVICE.provider);
  const service = clean(fields.service ?? fields.providerService ?? options.providerService ?? DEFAULT_PROVIDER_SERVICE.service);
  const region = clean(fields.region ?? options.region ?? DEFAULT_PROVIDER_SERVICE.region);
  const syncMode = clean(fields.syncMode ?? options.syncMode ?? DEFAULT_PROVIDER_SERVICE.syncMode);
  const syncWindowMs = toPositiveInteger(fields.syncWindowMs ?? options.syncWindowMs, 60000);
  const syncCursorKey = clean(fields.syncCursorKey ?? options.syncCursorKey ?? DEFAULT_PROVIDER_SERVICE.syncCursorKey);
  const offeredCapabilities = unique([
    ...DEFAULT_PROVIDER_SERVICE.requiredProviderCapabilities,
    ...capabilities,
    ...parseList(fields.providerCapabilities),
    ...parseList(options.providerCapabilities)
  ]);
  const operationRequired = OPERATION_DEFAULTS[operation]?.capabilities ?? OPERATION_DEFAULTS[DEFAULT_MAILCHIMP_PROFILE.operation].capabilities;
  const requiredCapabilities = unique([
    ...operationRequired,
    ...parseList(fields.requiredProviderCapabilities),
    ...parseList(options.requiredProviderCapabilities)
  ]);
  const missingCapabilities = requiredCapabilities.filter((capability) => !offeredCapabilities.includes(capability));
  const statusChannel = clean(fields.providerStatusChannel ?? options.providerStatusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel);
  const target = clean(fields.providerTarget ?? options.providerTarget ?? DEFAULT_PROVIDER_SERVICE.statusTarget);
  const externalStateKey = clean(fields.externalStateKey ?? options.externalStateKey ?? DEFAULT_PROVIDER_SERVICE.externalStateKey);
  const allowedSyncModes = ['incremental', 'snapshot', 'event', 'manual'];
  const diagnostics = [
    ...(provider === 'mailchimp' ? [] : [diagnostic('warning', 'profile_provider_not_mailchimp', provider || 'missing_provider')]),
    ...(service ? [] : [diagnostic('error', 'profile_provider_service_missing', operation)]),
    ...(region ? [] : [diagnostic('warning', 'profile_provider_region_missing', service || operation)]),
    ...(allowedSyncModes.includes(syncMode) ? [] : [diagnostic('error', 'profile_provider_sync_mode_invalid', syncMode || 'missing_sync_mode')]),
    ...missingCapabilities.map((capability) => diagnostic('error', 'profile_provider_required_capability_missing', capability)),
    ...(statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
      ? []
      : [diagnostic('warning', 'profile_provider_status_channel_not_kernel', statusChannel || 'missing_status_channel')])
  ];
  const status = diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning')
      ? 'degraded'
      : 'ready';

  return {
    ok: status !== 'blocked',
    contract: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      provider,
      service,
      region,
      operation,
      status,
      capabilities: {
        required: requiredCapabilities,
        offered: offeredCapabilities,
        missing: missingCapabilities,
        negotiation: missingCapabilities.length > 0 ? 'capability_gap' : 'satisfied'
      },
      sync: {
        mode: syncMode,
        windowMs: syncWindowMs,
        cursorKey: syncCursorKey,
        metadata: {
          source: `${provider}.${service}`,
          operation,
          region
        }
      },
      externalState: {
        key: externalStateKey,
        target,
        statusChannel,
        ready: Boolean(target) && statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel,
        restartSafe: status === 'ready' && Boolean(externalStateKey) && statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel,
        handoffState: status === 'blocked' ? 'operator_review' : status === 'degraded' ? 'degraded_status_handoff' : 'ready'
      }
    },
    diagnostics
  };
}

export function selfCheckProfileDeclaration() {
  return deriveProfileRuntimeContract('profile mailchimp.campaign operation=campaign.sync claims=audience_id,campaign_id');
}

function normalizeDeclarationInput(input) {
  if (input?.declarations) return input;
  return {
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    sourceName: input.sourceName ?? 'object.profile.aios',
    declarations: [{
      kind: 'ProfileDeclaration',
      name: input.name ?? 'mailchimp.default',
      fields: input.fields ?? input
    }],
    diagnostics: []
  };
}

function parseKeyValues(value) {
  return String(value ?? '').split(/\s+/).filter(Boolean).reduce((fields, token) => {
    const [key, ...rest] = token.split('=');
    if (key && rest.length) fields[key] = rest.join('=');
    return fields;
  }, {});
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value ?? '').split(',').map(clean).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))].sort();
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function toNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normalizeRequestState(input) {
  return input && typeof input === 'object' ? input : {};
}

function normalizeClaimValues(input) {
  if (input instanceof Set) return new Set([...input].map(clean).filter(Boolean));
  if (Array.isArray(input)) return new Set(input.map(clean).filter(Boolean));
  if (input && typeof input === 'object') {
    return new Set(Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null && value !== false && value !== '')
      .map(([key]) => clean(key))
      .filter(Boolean));
  }
  return new Set(String(input ?? '').split(',').map(clean).filter(Boolean));
}

function normalizeMemoryValues(input) {
  if (input instanceof Set) return new Set([...input].map(clean).filter(Boolean));
  if (Array.isArray(input)) return new Set(input.map((item) => clean(item?.name ?? item)).filter(Boolean));
  if (input && typeof input === 'object') {
    return new Set(Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null && value !== false)
      .map(([key]) => clean(key))
      .filter(Boolean));
  }
  return new Set(String(input ?? '').split(',').map(clean).filter(Boolean));
}

function buildResumeToken({ strategy, profileName, operation, requestKey }) {
  if (clean(strategy) === 'none') return null;
  return [profileName, operation, requestKey].map(clean).filter(Boolean).join('::');
}

function normalizePersistedProfileState(input) {
  return input && typeof input === 'object' ? input : {};
}

function normalizeProfileCommand(input) {
  return input && typeof input === 'object' ? input : {};
}

function normalizeProviderServiceState(input) {
  const state = input && typeof input === 'object' ? input : {};
  return {
    generation: toNonNegativeInteger(state.generation, 0),
    fingerprint: clean(state.fingerprint),
    sync: state.sync && typeof state.sync === 'object' ? state.sync : {},
    appliedCommandKeys: Array.isArray(state.appliedCommandKeys)
      ? state.appliedCommandKeys
      : Array.isArray(state.idempotency?.appliedCommandKeys)
        ? state.idempotency.appliedCommandKeys
        : []
  };
}

function normalizeProviderAdoptionState(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    syncCursor: clean(value.sync?.cursor ?? value.syncCursor ?? value.exportSummary?.syncCursor)
  };
}

function normalizeProviderAdoptionAcceptance(input) {
  const acceptance = input && typeof input === 'object' ? input : {};
  return {
    acceptedItems: parseList(acceptance.acceptedItems ?? acceptance.accepted),
    requiredItems: parseList(acceptance.requiredItems ?? acceptance.required),
    requireExplicitAcceptance: acceptance.requireExplicitAcceptance === true
  };
}

function profileProviderAdoptionFingerprint({ provider, runtime, rows, missingCapabilities, syncCursor }) {
  return [
    provider.status,
    provider.contract?.provider,
    provider.contract?.service,
    provider.sync?.mode,
    syncCursor || 'no_cursor',
    runtime.state?.workflow?.statusChannel,
    ...(missingCapabilities ?? []).map((capability) => `missing:${capability}`),
    ...rows.map((row) => [
      row.key,
      row.status,
      row.accepted ? 'accepted' : 'pending',
      row.required ? 'required' : 'optional'
    ].map(clean).filter(Boolean).join(':'))
  ].map(clean).filter(Boolean).join('|');
}

function normalizeProfileLifecycleState(input) {
  const state = input && typeof input === 'object' ? input : {};
  return {
    status: clean(state.status) || (state.enabled === false ? 'disabled' : 'enabled'),
    enabled: state.enabled !== false,
    generation: toNonNegativeInteger(state.generation, 0),
    fingerprint: clean(state.fingerprint),
    scheduledRetryCount: toNonNegativeInteger(state.schedule?.scheduledRetryCount ?? state.scheduledRetryCount, 0),
    appliedCommandKeys: Array.isArray(state.appliedCommandKeys)
      ? state.appliedCommandKeys
      : Array.isArray(state.idempotency?.appliedCommandKeys)
        ? state.idempotency.appliedCommandKeys
        : []
  };
}

function normalizeProfileLifecycleSettings(input) {
  const settings = input && typeof input === 'object' ? input : {};
  return {
    enabled: settings.enabled !== false,
    scheduleMode: clean(settings.scheduleMode) || PROFILE_LIFECYCLE_DEFAULTS.scheduleMode,
    retryWindowMs: toPositiveInteger(settings.retryWindowMs, PROFILE_LIFECYCLE_DEFAULTS.retryWindowMs),
    maxScheduledRetries: toPositiveInteger(settings.maxScheduledRetries, PROFILE_LIFECYCLE_DEFAULTS.maxScheduledRetries),
    requireKernelStatus: settings.requireKernelStatus !== false,
    allowDegradedResume: settings.allowDegradedResume === true
  };
}

function normalizeProfileLifecycleCommand(input) {
  return input && typeof input === 'object' ? input : {};
}

function validateProfileLifecycleSettings(settings) {
  const allowedScheduleModes = ['immediate', 'manual', 'backoff'];
  return [
    ...(allowedScheduleModes.includes(settings.scheduleMode)
      ? []
      : [diagnostic('error', 'invalid_profile_schedule_mode', settings.scheduleMode)]),
    ...(settings.maxScheduledRetries < 1
      ? [diagnostic('error', 'invalid_profile_retry_limit', String(settings.maxScheduledRetries))]
      : []),
    ...(settings.retryWindowMs < 250
      ? [diagnostic('warning', 'profile_retry_window_too_short', String(settings.retryWindowMs))]
      : [])
  ];
}

function validateProfileLifecycleCommand(command, {
  runtime,
  persistence,
  failure,
  settings,
  repeatedCommand
}) {
  const action = clean(command.action).toLowerCase();
  if (!action || repeatedCommand) return [];
  const missingClaims = runtime.state?.verifier?.missingClaims ?? [];
  const missingMemory = persistence.envelope?.memory?.missingRestorable ?? [];
  const statusChannelReady = runtime.state?.workflow?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel;
  return [
    ...(Object.prototype.hasOwnProperty.call(PROFILE_LIFECYCLE_COMMANDS, action)
      ? []
      : [diagnostic('error', 'unsupported_profile_lifecycle_command', action)]),
    ...(action === 'retry' && failure.retryable !== true
      ? [diagnostic('warning', 'profile_retry_requested_without_retryable_failure', failure.status)]
      : []),
    ...(action === 'retry' && settings.enabled !== true
      ? [diagnostic('error', 'profile_retry_blocked_while_disabled', 'disabled')]
      : []),
    ...(['resume', 'retry'].includes(action) && missingClaims.length > 0
      ? [diagnostic('error', 'profile_lifecycle_blocked_missing_claims', missingClaims.join(','))]
      : []),
    ...(action === 'resume' && missingMemory.length > 0 && settings.allowDegradedResume !== true
      ? [diagnostic('error', 'profile_lifecycle_blocked_missing_memory', missingMemory.join(','))]
      : []),
    ...(settings.requireKernelStatus && !statusChannelReady
      ? [diagnostic(action === 'disable' ? 'warning' : 'error', 'profile_lifecycle_requires_kernel_status', DEFAULT_MAILCHIMP_PROFILE.statusChannel)]
      : [])
  ];
}

function deriveProfileLifecycleTransition({
  command,
  runtime,
  persistence,
  failure,
  previous,
  settings,
  repeatedCommand,
  hasErrors
}) {
  const action = repeatedCommand ? '' : clean(command.action).toLowerCase();
  const commandedStatus = PROFILE_LIFECYCLE_COMMANDS[action];
  const baseEnabled = settings.enabled && previous.enabled !== false;
  const enabled = commandedStatus === 'disabled'
    ? false
    : commandedStatus === 'enabled' || commandedStatus === 'status_acknowledged'
      ? true
      : baseEnabled;
  const scheduledRetryCount = action === 'retry'
    ? previous.scheduledRetryCount + 1
    : failure.status === 'ready'
      ? 0
      : previous.scheduledRetryCount;
  const retryBudgetExceeded = scheduledRetryCount > settings.maxScheduledRetries;
  const recoverablePersistence = persistence.envelope?.status === 'recovering';
  const degradedFailure = failure.status === 'degraded' || recoverablePersistence;
  const status = hasErrors || retryBudgetExceeded
    ? 'blocked'
    : commandedStatus === 'operator_review'
      ? 'operator_review'
      : !enabled
        ? 'disabled'
        : commandedStatus === 'paused'
          ? 'paused'
          : commandedStatus === 'retry_scheduled'
            ? 'retry_scheduled'
            : commandedStatus === 'status_acknowledged'
              ? 'status_acknowledged'
              : failure.status === 'blocked'
                ? 'blocked'
                : degradedFailure
                  ? 'enabled_degraded'
                  : 'enabled';
  const nextRetryAt = status === 'retry_scheduled' && failure.nextRetry
    ? failure.nextRetry.delayMs + settings.retryWindowMs
    : null;
  const nextAction = status === 'blocked'
    ? 'operator_profile_lifecycle_review'
    : status === 'operator_review'
      ? 'wait_for_operator_profile_review'
      : status === 'disabled'
        ? 'wait_for_profile_enable_command'
        : status === 'paused'
          ? 'wait_for_profile_resume_command'
          : status === 'retry_scheduled'
            ? 'dispatch_profile_retry'
            : status === 'status_acknowledged'
              ? 'resume_after_profile_status_ack'
              : status === 'enabled_degraded'
                ? 'publish_degraded_profile_status'
                : 'publish_profile_ready';
  const fingerprint = [
    status,
    enabled ? 'enabled' : 'disabled',
    settings.scheduleMode,
    String(scheduledRetryCount),
    runtime.state?.workflow?.state ?? 'no_runtime',
    persistence.envelope?.status ?? 'no_persistence',
    failure.status ?? 'no_failure',
    failure.nextRetry?.reason ?? 'no_retry'
  ].join('|');

  return {
    status,
    enabled,
    fingerprint,
    scheduledRetryCount,
    nextAction,
    schedule: {
      mode: settings.scheduleMode,
      scheduledRetryCount,
      retryBudgetExceeded,
      nextRetry: failure.nextRetry,
      nextRetryAt
    }
  };
}

function normalizeMemoryPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.entries(input).reduce((memory, [key, value]) => {
    const name = clean(key);
    if (name && value !== undefined && value !== null && value !== false) memory[name] = value;
    return memory;
  }, {});
}

function normalizeProfileExportHistory(input) {
  const history = input?.history ?? input;
  return {
    sequence: toNonNegativeInteger(history?.sequence, 0),
    timeline: Array.isArray(history?.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function normalizeProfileRestartPacket(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function deriveProfileRestartResumeSteps({
  status,
  missingClaims,
  missingMemory,
  lifecycle,
  failure,
  statusChannelReady
}) {
  if (status === 'ready') {
    return [{
      order: 1,
      action: 'resume_from_profile_checkpoint',
      status: 'ready',
      required: true
    }];
  }

  const steps = [
    ...missingClaims.map((claim) => ({
      action: 'collect_required_claim',
      subject: claim,
      status: 'blocked',
      required: true
    })),
    ...missingMemory.map((name) => ({
      action: 'restore_durable_memory',
      subject: name,
      status: status === 'blocked' ? 'blocked' : 'degraded',
      required: status === 'blocked'
    })),
    ...(['disabled', 'paused', 'operator_review', 'blocked'].includes(lifecycle.status) ? [{
      action: lifecycle.status === 'paused'
        ? 'resume_profile_lifecycle'
        : lifecycle.status === 'disabled'
          ? 'enable_profile_lifecycle'
          : 'operator_profile_lifecycle_review',
      subject: lifecycle.status,
      status: 'blocked',
      required: true
    }] : []),
    ...(failure.status === 'blocked' ? (failure.actionableErrors ?? []).map((item) => ({
      action: clean(item.code) || 'repair_profile_failure',
      subject: clean(item.subject) || 'profile_failure_state',
      status: 'blocked',
      required: true
    })) : []),
    ...(failure.status === 'degraded' ? [{
      action: failure.nextRetry ? 'schedule_profile_retry' : 'publish_profile_failure_advisory',
      subject: failure.nextRetry?.reason ?? 'profile_failure_state',
      status: 'degraded',
      required: false
    }] : []),
    ...(statusChannelReady ? [] : [{
      action: 'route_profile_status_to_kernel',
      subject: DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      status: status === 'blocked' ? 'blocked' : 'degraded',
      required: status === 'blocked'
    }])
  ];

  return steps.map((step, index) => ({
    order: index + 1,
    action: step.action,
    subject: clean(step.subject) || null,
    status: step.status,
    required: step.required === true
  }));
}

function profileRestartPacketFingerprint({
  checkpoint,
  status,
  missingClaims,
  missingMemory,
  resumeSteps,
  lifecycleStatus,
  failureStatus
}) {
  return [
    checkpoint.restartKey,
    checkpoint.resumeToken,
    checkpoint.workflowState,
    checkpoint.persistenceStatus,
    checkpoint.statusChannel,
    status,
    lifecycleStatus,
    failureStatus,
    ...missingClaims.map((claim) => `claim:${claim}`),
    ...missingMemory.map((name) => `memory:${name}`),
    ...resumeSteps.map((step) => `${step.order}:${step.action}:${step.subject ?? ''}:${step.status}:${step.required ? 'required' : 'optional'}`)
  ].map(clean).filter(Boolean).join('|');
}

function normalizeProfilePreviewAcceptance(input) {
  const acceptance = input && typeof input === 'object' ? input : {};
  return {
    acceptedItems: parseList(acceptance.acceptedItems ?? acceptance.accepted),
    acceptedAt: clean(acceptance.acceptedAt ?? acceptance.timestamp) || null,
    acceptedBy: clean(acceptance.acceptedBy ?? acceptance.operator) || null,
    requireExplicitAcceptance: acceptance.requireExplicitAcceptance === true
  };
}

function normalizeProfileBoundaryEvidenceAcceptance(input) {
  const acceptance = input && typeof input === 'object' ? input : {};
  return {
    acceptedItems: parseList(acceptance.acceptedItems ?? acceptance.accepted ?? acceptance.acceptedRows),
    acceptedAt: clean(acceptance.acceptedAt ?? acceptance.timestamp) || null,
    acceptedBy: clean(acceptance.acceptedBy ?? acceptance.operator) || null,
    requireExplicitAcceptance: acceptance.requireExplicitAcceptance === true
  };
}

function normalizeProfileBoundaryEvidenceHistory(input) {
  const history = input?.history ?? input;
  return {
    sequence: toNonNegativeInteger(history?.sequence, 0),
    fingerprint: clean(history?.fingerprint ?? input?.fingerprint),
    timeline: Array.isArray(history?.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function deriveProfileExportReadiness({
  runtime,
  persistence,
  failure,
  counters
}) {
  const state = runtime.state;
  const statusChannelReady = state?.workflow?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel;
  const blockingReasons = unique([
    ...(runtime.ok === false ? ['profile_runtime'] : []),
    ...(persistence.ok === false ? ['profile_persistence'] : []),
    ...(failure.status === 'blocked' ? ['profile_failure_state'] : []),
    ...(counters.missingClaims > 0 ? ['missing_claims'] : []),
    ...(statusChannelReady ? [] : ['status_channel_not_kernel']),
    ...(state?.boundary?.status === 'blocked' ? ['profile_boundary'] : [])
  ]);
  const degradedReasons = unique([
    ...(failure.status === 'degraded' ? ['profile_failure_state'] : []),
    ...(persistence.envelope?.status === 'recovering' ? ['profile_memory_recovery'] : []),
    ...(counters.missingDurableMemory > 0 ? ['missing_durable_memory'] : []),
    ...(state?.boundary?.status === 'degraded' ? ['profile_boundary'] : []),
    ...(counters.deniedBoundaryCapabilities > 0 ? ['boundary_capability_advisory'] : []),
    ...(counters.deniedBoundaryPermissions > 0 ? ['boundary_permission_advisory'] : [])
  ]);
  const status = blockingReasons.length > 0
    ? 'blocked'
    : degradedReasons.length > 0
      ? 'degraded'
      : 'ready';

  return {
    status,
    restartSafe: status === 'ready' && persistence.envelope?.restartSafe === true && failure.restartSafe !== false,
    statusChannelReady,
    blockingReasons,
    degradedReasons,
    nextAction: status === 'blocked'
      ? 'operator_profile_export_review'
      : status === 'degraded'
        ? 'publish_profile_export_degraded_status'
        : 'publish_profile_export_ready'
  };
}

function validateProfileCommand(command, state) {
  const action = clean(command.action);
  if (!action) return [];
  const allowed = ['ack_status', 'resume_after_restart', 'mark_operator_review'];
  return [
    ...(allowed.includes(action) ? [] : [diagnostic('error', 'unsupported_profile_runtime_command', action)]),
    ...(action === 'resume_after_restart' && state.verifier.missingClaims.length > 0
      ? [diagnostic('error', 'profile_resume_blocked_missing_claims', state.verifier.missingClaims.join(','))]
      : [])
  ];
}

function derivePersistedProfileStatus({
  state,
  missingRestorableMemory,
  previous,
  command,
  repeatedCommand,
  commandDiagnostics
}) {
  if (commandDiagnostics.some((item) => item.level === 'error')) {
    return {
      status: 'blocked',
      workflowState: 'command_rejected',
      lastStableStatus: previous.workflow?.lastStableStatus ?? null,
      recoveryPath: 'operator_review_invalid_command'
    };
  }
  if (state.verifier.missingClaims.length > 0) {
    return {
      status: 'blocked',
      workflowState: 'waiting_for_claims',
      lastStableStatus: previous.workflow?.lastStableStatus ?? null,
      recoveryPath: 'collect_required_claims'
    };
  }
  if (missingRestorableMemory.length > 0) {
    return {
      status: 'recovering',
      workflowState: 'restoring_durable_memory',
      lastStableStatus: previous.workflow?.lastStableStatus ?? null,
      recoveryPath: 'restore_memory_before_resume'
    };
  }
  if (clean(command.action) === 'mark_operator_review' && !repeatedCommand) {
    return {
      status: 'blocked',
      workflowState: 'operator_review_requested',
      lastStableStatus: previous.workflow?.lastStableStatus ?? null,
      recoveryPath: 'operator_review_requested'
    };
  }
  return {
    status: 'ready',
    workflowState: clean(command.action) === 'resume_after_restart' ? 'resume_dispatched' : state.workflow.state,
    lastStableStatus: 'ready',
    recoveryPath: 'resume_from_persisted_state'
  };
}

function pickKnownMemory(memory, names) {
  return names.reduce((picked, name) => {
    if (Object.prototype.hasOwnProperty.call(memory, name)) picked[name] = memory[name];
    return picked;
  }, {});
}

function buildProfileRestartKey({ profileName, operation, requestKey, resumeToken }) {
  return [profileName, operation, requestKey, resumeToken].map(clean).filter(Boolean).join('::');
}

function profileStateFingerprint(parts) {
  return [
    parts.restartKey,
    parts.workflowState,
    ...parts.missingClaims.map((item) => `claim:${item}`),
    ...parts.missingRestorableMemory.map((item) => `memory:${item}`),
    ...parts.restoredMemory.map((item) => `restored:${item}`)
  ].map(clean).filter(Boolean).join('|');
}

function buildProfileActionableErrors({
  missingClaims,
  missingMemory,
  boundaryStatus,
  statusChannelReady,
  exhausted
}) {
  return [
    ...missingClaims.map((claim) => ({
      code: 'collect_profile_claim',
      subject: claim,
      action: `Attach ${claim} before dispatching the Mailchimp profile job.`
    })),
    ...missingMemory.map((name) => ({
      code: 'restore_profile_memory',
      subject: name,
      action: `Restore ${name} from persisted profile memory before resume.`
    })),
    ...(boundaryStatus === 'blocked' ? [{
      code: 'review_profile_boundary',
      subject: 'profile.boundary',
      action: 'Review tenant, workspace, role, and requested scope before retrying the profile job.'
    }] : []),
    ...(boundaryStatus === 'degraded' ? [{
      code: 'ack_profile_boundary_degraded',
      subject: 'profile.boundary',
      action: 'Publish a degraded profile boundary status before guarded resume.'
    }] : []),
    ...(statusChannelReady ? [] : [{
      code: 'route_profile_status_to_kernel',
      subject: DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      action: 'Route profile status handoff through kernel.status.mailchimp for restart-safe recovery.'
    }]),
    ...(exhausted ? [{
      code: 'operator_profile_retry_review',
      subject: 'retry_budget',
      action: 'Stop automatic profile retries and request operator review.'
    }] : [])
  ];
}

function normalizeProfileHealthExportHistory(input) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  return {
    sequence: toNonNegativeInteger(value.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function normalizeProfilePrimaryPackHistory(input) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  return {
    sequence: toNonNegativeInteger(value.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function normalizeProfileRuntimeAdoptionHistory(input) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  return {
    sequence: toNonNegativeInteger(value.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function normalizeProfileProviderSyncIntent(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    cursor: clean(value.sync?.cursor ?? value.exportSummary?.syncCursor),
    appliedCommandKeys: Array.isArray(value.idempotency?.appliedCommandKeys)
      ? value.idempotency.appliedCommandKeys
      : []
  };
}

function profileProviderSyncIntentFingerprint({
  provider,
  adoption,
  status,
  cursor,
  requestedCapabilities,
  missingCapabilities,
  externalStateReady
}) {
  return [
    provider.profileName,
    provider.operation,
    status,
    provider.status,
    adoption.status,
    provider.contract?.provider,
    provider.contract?.service,
    provider.sync?.mode,
    cursor || 'no_cursor',
    externalStateReady ? 'handoff_ready' : 'handoff_guarded',
    ...requestedCapabilities.map((capability) => `requested:${capability}`),
    ...missingCapabilities.map((capability) => `missing:${capability}`)
  ].map(clean).filter(Boolean).join('|');
}

function normalizeProfileActivationSettings(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    enabled: value.enabled !== false,
    pause: value.pause === true,
    publishControls: value.publishControls !== false
  };
}

function normalizeProfileAudienceLedger(input) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : value;
  return {
    sequence: toNonNegativeInteger(value.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(history.timeline) ? history.timeline.filter((item) => item && typeof item === 'object') : []
  };
}

function profileAudienceLedgerFingerprint({
  profileName,
  operation,
  status,
  exportableRows,
  counters
}) {
  return [
    profileName,
    operation,
    status,
    `exportable:${toNonNegativeInteger(counters.exportable, 0)}`,
    `blocked:${toNonNegativeInteger(counters.blocked, 0)}`,
    `guarded:${toNonNegativeInteger(counters.restartGuarded, 0)}`,
    ...exportableRows.map((row) => [
      row.key,
      row.status,
      row.exportable ? 'exportable' : 'blocked',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.sequence,
      row.nextAction ?? 'no_action'
    ].map(clean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function profilePrimaryPackFingerprint({
  profileName,
  operation,
  status,
  rows,
  counters
}) {
  return [
    profileName,
    operation,
    status,
    `errors:${toNonNegativeInteger(counters.diagnostics?.errors, 0)}`,
    `warnings:${toNonNegativeInteger(counters.diagnostics?.warnings, 0)}`,
    ...rows.map((row) => [
      row.component,
      row.status,
      row.restartSafe === false ? 'guarded' : 'safe',
      row.sequence ?? 0,
      row.nextAction ?? 'no_action'
    ].map(clean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function profileRuntimeAdoptionFingerprint({
  profileName,
  operation,
  requestKey,
  resumeToken,
  status,
  rows
}) {
  return [
    profileName,
    operation,
    requestKey,
    resumeToken,
    status,
    ...rows.map((row) => [
      row.component,
      row.status,
      row.restartSafe === false ? 'guarded' : 'safe',
      row.adopted === true ? 'adopted' : 'pending',
      row.evidence?.sequence ?? 0,
      row.evidence?.fingerprint ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeProfileRequestKernelBinding(input = {}) {
  return {
    schemaVersion: clean(input.schemaVersion),
    sequence: toNonNegativeInteger(input.sequence ?? input.exportSummary?.sequence, 0),
    fingerprint: clean(input.fingerprint ?? input.exportSummary?.fingerprint),
    lastStableFingerprint: clean(input.lastStableFingerprint ?? input.exportSummary?.lastStableFingerprint) || null
  };
}

function profileRequestKernelBindingFingerprint({
  profileName,
  operation,
  requestKey,
  resumeToken,
  status,
  bindingRows
}) {
  return [
    profileName,
    operation,
    requestKey,
    resumeToken,
    status,
    ...bindingRows.map((row) => [
      row.key,
      row.status,
      row.restartSafe === false ? 'guarded' : 'safe',
      row.required === true ? 'required' : 'optional',
      row.evidence?.restartKey ?? '',
      row.evidence?.generation ?? 0,
      row.evidence?.fingerprint ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function buildProfileHealthActionQueue({
  exportState,
  failure,
  lifecycle,
  provider,
  preview,
  boundaryEvidence,
  clientWorkflow,
  status
}) {
  const actions = [
    ...failure.actionableErrors.map((item) => ({
      source: 'failure_state',
      code: clean(item.code) || 'profile_failure_action',
      subject: clean(item.subject) || failure.profileName,
      action: clean(item.action) || 'Review Mailchimp profile failure state.',
      severity: failure.status === 'blocked' ? 'error' : 'warning'
    })),
    ...(exportState.readiness.blockingReasons ?? []).map((reason) => ({
      source: 'profile_export',
      code: 'profile_export_blocker',
      subject: reason,
      action: 'Resolve Mailchimp profile export blockers before runtime handoff.',
      severity: 'error'
    })),
    ...(exportState.readiness.degradedReasons ?? []).map((reason) => ({
      source: 'profile_export',
      code: 'profile_export_degraded',
      subject: reason,
      action: 'Publish degraded Mailchimp profile export status before guarded resume.',
      severity: 'warning'
    })),
    ...(lifecycle.nextAction ? [{
      source: 'profile_lifecycle',
      code: 'profile_lifecycle_next_action',
      subject: lifecycle.status,
      action: lifecycle.nextAction,
      severity: ['blocked', 'operator_review'].includes(lifecycle.status) ? 'error' : 'warning'
    }] : []),
    ...(provider.negotiation.missingCapabilities ?? []).map((capability) => ({
      source: 'provider_service',
      code: 'profile_provider_capability_missing',
      subject: capability,
      action: `Expose ${capability} from the Mailchimp provider service before profile handoff.`,
      severity: 'error'
    })),
    ...(provider.externalState?.ready === false ? [{
      source: 'provider_service',
      code: 'profile_provider_handoff_not_ready',
      subject: provider.externalState.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      action: 'Route Mailchimp profile provider external state through kernel.status.mailchimp.',
      severity: provider.status === 'blocked' ? 'error' : 'warning'
    }] : []),
    ...(preview.readiness.blockingReasons ?? []).map((reason) => ({
      source: 'profile_preview',
      code: 'profile_preview_blocker',
      subject: reason,
      action: 'Resolve Mailchimp profile preview blockers before health export.',
      severity: 'error'
    })),
    ...(preview.readiness.degradedReasons ?? []).map((reason) => ({
      source: 'profile_preview',
      code: 'profile_preview_degraded',
      subject: reason,
      action: 'Publish degraded Mailchimp profile preview status before guarded handoff.',
      severity: 'warning'
    })),
    ...(boundaryEvidence.readiness.blockingReasons ?? []).map((reason) => ({
      source: 'boundary_evidence',
      code: 'profile_boundary_evidence_blocker',
      subject: reason,
      action: 'Resolve Mailchimp profile boundary evidence blockers before health export.',
      severity: 'error'
    })),
    ...(boundaryEvidence.readiness.degradedReasons ?? []).map((reason) => ({
      source: 'boundary_evidence',
      code: 'profile_boundary_evidence_degraded',
      subject: reason,
      action: 'Publish degraded Mailchimp profile boundary evidence before guarded handoff.',
      severity: 'warning'
    })),
    ...(clientWorkflow.exportSummary.blockingRows ?? []).map((row) => ({
      source: 'client_workflow',
      code: 'profile_client_workflow_blocker',
      subject: row,
      action: 'Resolve Mailchimp client workflow blockers before publishing profile health.',
      severity: 'error'
    })),
    ...(clientWorkflow.exportSummary.degradedRows ?? []).map((row) => ({
      source: 'client_workflow',
      code: 'profile_client_workflow_degraded',
      subject: row,
      action: 'Publish degraded Mailchimp client workflow status before guarded resume.',
      severity: 'warning'
    }))
  ];
  return dedupeProfileHealthActions(actions)
    .filter((item) => status !== 'ready' || item.severity !== 'warning')
    .sort((left, right) => (
      profileHealthSeverityRank(right.severity) - profileHealthSeverityRank(left.severity)
      || left.source.localeCompare(right.source)
      || left.code.localeCompare(right.code)
      || left.subject.localeCompare(right.subject)
    ));
}

function dedupeProfileHealthActions(actions) {
  const seen = new Set();
  return actions.filter((item) => {
    const normalized = {
      source: clean(item.source),
      code: clean(item.code),
      subject: clean(item.subject),
      action: clean(item.action),
      severity: clean(item.severity) || 'warning'
    };
    const key = [normalized.source, normalized.code, normalized.subject, normalized.action].join('|');
    if (!normalized.source || !normalized.code || seen.has(key)) return false;
    seen.add(key);
    Object.assign(item, normalized);
    return true;
  });
}

function profileHealthFingerprint({ profileName, operation, status, rows, actionQueue, diagnostics }) {
  return [
    profileName,
    operation,
    status,
    ...rows.map((row) => `${row.component}:${row.status}:${row.restartSafe === false ? 'guarded' : 'safe'}`).sort(),
    ...actionQueue.map((item) => `${item.severity}:${item.source}:${item.code}:${item.subject}`).sort(),
    `errors:${diagnostics.filter((item) => item.level === 'error').length}`,
    `warnings:${diagnostics.filter((item) => item.level === 'warning').length}`
  ].map(clean).filter(Boolean).join('||');
}

function profileHealthSeverityRank(severity) {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  return 1;
}

function clean(value) {
  return String(value ?? '').trim();
}

function diagnostic(level, code, subject) {
  return { level, code, subject };
}
