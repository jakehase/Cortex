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

export function buildProfilePersistedStateRecoveryManifest(input = {}, options = {}) {
  const persistence = buildProfilePersistenceEnvelope(input, {
    ...options,
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
  const previous = normalizeProfilePersistedRecoveryManifest(
    options.previousManifest ?? options.previousProfileRecoveryManifest ?? input.previousManifest
  );
  const envelope = persistence.envelope ?? {};
  const command = normalizeProfileCommand(options.command ?? options.profileCommand ?? input.command);
  const commandKey = clean(command.commandKey ?? options.commandKey ?? options.profileCommandKey);
  const statusJournal = normalizeProfileRecoveryStatusJournal(options.statusJournal ?? options.profileStatusJournal);
  const blocked = persistence.ok === false || failure.status === 'blocked';
  const guarded = !blocked && (
    failure.status === 'degraded'
    || envelope.restartSafe !== true
    || envelope.recovery?.resumeAllowed !== true
    || statusJournal.status === 'stale'
  );
  const rows = [
    {
      id: 'persistence_envelope',
      status: persistence.ok === false ? 'blocked' : envelope.status === 'restoring' ? 'guarded' : 'ready',
      restartSafe: envelope.restartSafe === true,
      fingerprint: clean(envelope.fingerprint),
      nextAction: persistence.ok === false
        ? 'repair_profile_persistence_envelope'
        : envelope.status === 'restoring'
          ? 'restore_profile_durable_memory'
          : 'reuse_profile_persistence_envelope',
      evidence: {
        generation: envelope.generation ?? 0,
        restartKey: envelope.restartKey ?? null,
        missingRestorable: envelope.memory?.missingRestorable ?? []
      }
    },
    {
      id: 'failure_state',
      status: failure.status === 'blocked' ? 'blocked' : failure.status === 'degraded' ? 'guarded' : 'ready',
      restartSafe: failure.restartSafe !== false && failure.status !== 'blocked',
      fingerprint: profileStateFingerprint({
        restartKey: [failure.profileName, failure.operation, failure.status].map(clean).filter(Boolean).join(':'),
        workflowState: failure.failureState?.persistenceStatus ?? failure.status,
        missingClaims: failure.failureState?.missingClaims ?? [],
        missingRestorableMemory: failure.failureState?.missingRestorableMemory ?? [],
        restoredMemory: failure.failureState?.degradedReasons ?? []
      }),
      nextAction: failure.handoff?.resumeAction ?? failure.handoff?.nextAction ?? 'resume',
      evidence: {
        blockingReasons: failure.failureState?.blockingReasons ?? [],
        degradedReasons: failure.failureState?.degradedReasons ?? [],
        nextRetry: failure.nextRetry
      }
    },
    {
      id: 'status_journal',
      status: statusJournal.status === 'stale' ? 'guarded' : 'ready',
      restartSafe: statusJournal.status !== 'stale',
      fingerprint: statusJournal.fingerprint,
      nextAction: statusJournal.status === 'stale'
        ? 'publish_profile_status_after_restart'
        : 'reuse_profile_status_journal',
      evidence: {
        sequence: statusJournal.sequence,
        lastStatus: statusJournal.lastStatus,
        lastPublishedAt: statusJournal.lastPublishedAt
      }
    }
  ];
  const fingerprint = profilePersistedRecoveryManifestFingerprint({
    profileName: envelope.profileName ?? failure.profileName,
    operation: envelope.operation ?? failure.operation,
    requestKey: envelope.requestKey,
    rows,
    commandKey
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const repeatedCommand = Boolean(commandKey && previous.appliedCommandKeys.includes(commandKey));
  const diagnostics = [
    ...persistence.diagnostics,
    ...failure.diagnostics.filter((item) => item.level === 'error'),
    ...(statusJournal.status === 'stale'
      ? [diagnostic('warning', 'profile_recovery_status_journal_stale', statusJournal.lastStatus)]
      : []),
    ...(repeatedCommand ? [diagnostic('info', 'profile_recovery_manifest_command_replayed', commandKey)] : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blocked
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guarded
      ? 'guarded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_profile_recovery_manifest_blockers'
    : status === 'guarded'
      ? 'publish_profile_recovery_manifest_guarded'
      : changed
        ? 'publish_profile_recovery_manifest_ready'
        : 'reuse_profile_recovery_manifest';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_persisted_state_recovery_manifest',
    profileName: envelope.profileName ?? failure.profileName ?? 'mailchimp.default',
    operation: envelope.operation ?? failure.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    requestKey: envelope.requestKey ?? null,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    rows,
    idempotency: {
      commandKey: commandKey || null,
      repeated: repeatedCommand,
      applied: Boolean(commandKey) && repeatedCommand !== true && status !== 'blocked',
      appliedCommandKeys: commandKey && repeatedCommand !== true && status !== 'blocked'
        ? unique([...previous.appliedCommandKeys, commandKey])
        : previous.appliedCommandKeys
    },
    recovery: {
      restartKey: envelope.restartKey ?? null,
      resumeToken: envelope.recovery?.resumeToken ?? null,
      resumeAllowed: status === 'ready' && envelope.recovery?.resumeAllowed === true,
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint,
      nextRetry: failure.nextRetry,
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-recovery-manifest',
      statusChannel: envelope.recovery?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: status !== 'ready' || changed,
      includePersistenceEnvelope: status !== 'ready',
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_persisted_state_recovery_manifest',
      profileName: envelope.profileName ?? failure.profileName ?? 'mailchimp.default',
      operation: envelope.operation ?? failure.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: rows.filter((row) => row.status === 'blocked').map((row) => row.id).sort(),
      guardedRows: rows.filter((row) => row.status === 'guarded' || row.restartSafe !== true).map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildProfileTenantPermissionMatrix(input = {}, options = {}) {
  const compiled = compileProfileDeclaration(input, options);
  if (!compiled.profile) {
    return {
      ok: false,
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      status: 'blocked',
      rows: [],
      validationSummary: emptyProfilePermissionValidation(),
      auditHandoff: {
        target: 'kernel.audit.mailchimp.profile-permissions',
        statusChannel: DEFAULT_MAILCHIMP_PROFILE.statusChannel,
        publish: true,
        severity: 'error',
        nextAction: 'repair_profile_permission_matrix'
      },
      exportSummary: {
        schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
        title: 'mailchimp_profile_tenant_permission_matrix',
        status: 'blocked',
        restartSafe: false,
        blockedRows: [],
        guardedRows: [],
        nextAction: 'repair_profile_permission_matrix'
      },
      diagnostics: compiled.diagnostics
    };
  }

  const profile = compiled.profile;
  const boundary = profile.boundary ?? {};
  const rolePolicy = PROFILE_ROLE_PERMISSIONS[boundary.role] ?? { capabilities: [], permissions: [] };
  const requestedPermissions = unique([
    ...parseList(options.requestedPermissions ?? options.permissions),
    ...(boundary.declaredPermissions ?? [])
  ]);
  const requestedCapabilities = unique([
    ...(profile.capabilities ?? []),
    ...parseList(options.requestedCapabilities ?? options.capabilities)
  ]);
  const operationPermissions = permissionsForProfileOperation(profile.operation);
  const requiredPermissions = unique([
    ...operationPermissions,
    ...requestedPermissions
  ]);
  const allowedCapabilities = unique(boundary.allowedCapabilities ?? rolePolicy.capabilities);
  const allowedPermissions = unique(boundary.allowedPermissions ?? rolePolicy.permissions);
  const deniedCapabilities = requestedCapabilities.filter((capability) => !allowedCapabilities.includes(capability));
  const deniedPermissions = requiredPermissions.filter((permission) => !allowedPermissions.includes(permission));
  const advisoryPermissions = requiredPermissions.filter((permission) => (
    permission.endsWith(':write') && permission !== 'status:write' && boundary.permissionMode !== 'explicit_write'
  ));
  const tenantMismatch = boundary.tenantIsolation === 'blocked';
  const workspaceGuarded = boundary.workspaceIsolation === 'advisory';
  const requireStatusWrite = options.requireStatusWrite !== false;
  const missingStatusWrite = requireStatusWrite && !allowedPermissions.includes('status:write');
  const rows = [
    profilePermissionMatrixRow({
      id: 'tenant_scope',
      label: 'Tenant scope',
      status: tenantMismatch ? 'blocked' : 'ready',
      required: true,
      requested: boundary.requestedTenantId || boundary.tenantId,
      allowed: boundary.tenantId,
      denied: tenantMismatch ? [boundary.requestedTenantId].filter(Boolean) : [],
      nextAction: tenantMismatch ? 'review_profile_cross_tenant_request' : 'include_profile_tenant_scope',
      evidence: {
        tenantId: boundary.tenantId,
        requestedTenantId: boundary.requestedTenantId,
        tenantIsolation: boundary.tenantIsolation
      }
    }),
    profilePermissionMatrixRow({
      id: 'workspace_scope',
      label: 'Workspace scope',
      status: workspaceGuarded ? 'guarded' : 'ready',
      required: true,
      requested: boundary.requestedWorkspaceId || boundary.workspaceId,
      allowed: boundary.workspaceId,
      denied: workspaceGuarded ? [boundary.requestedWorkspaceId].filter(Boolean) : [],
      nextAction: workspaceGuarded ? 'publish_profile_workspace_scope_advisory' : 'include_profile_workspace_scope',
      evidence: {
        workspaceId: boundary.workspaceId,
        requestedWorkspaceId: boundary.requestedWorkspaceId,
        workspaceIsolation: boundary.workspaceIsolation
      }
    }),
    profilePermissionMatrixRow({
      id: 'role_capabilities',
      label: 'Role capabilities',
      status: deniedCapabilities.length > 0 ? 'guarded' : 'ready',
      required: true,
      requested: requestedCapabilities,
      allowed: allowedCapabilities,
      denied: deniedCapabilities,
      nextAction: deniedCapabilities.length > 0
        ? 'ack_profile_capability_boundary'
        : 'include_profile_capability_boundary',
      evidence: {
        role: boundary.role,
        permissionMode: boundary.permissionMode,
        requestedCount: requestedCapabilities.length,
        allowedCount: allowedCapabilities.length
      }
    }),
    profilePermissionMatrixRow({
      id: 'role_permissions',
      label: 'Role permissions',
      status: deniedPermissions.length > 0 || advisoryPermissions.length > 0 ? 'guarded' : 'ready',
      required: true,
      requested: requiredPermissions,
      allowed: allowedPermissions,
      denied: deniedPermissions,
      nextAction: deniedPermissions.length > 0
        ? 'ack_profile_permission_boundary'
        : advisoryPermissions.length > 0
          ? 'publish_profile_write_permission_advisory'
          : 'include_profile_permission_boundary',
      evidence: {
        role: boundary.role,
        advisoryPermissions,
        requiredOperationPermissions: operationPermissions
      }
    }),
    profilePermissionMatrixRow({
      id: 'status_audit_handoff',
      label: 'Status audit handoff',
      status: missingStatusWrite || !profile.handoff?.statusChannel ? 'blocked' : 'ready',
      required: true,
      requested: [DEFAULT_MAILCHIMP_PROFILE.statusChannel, 'status:write'],
      allowed: [profile.handoff?.statusChannel, ...allowedPermissions].filter(Boolean),
      denied: missingStatusWrite ? ['status:write'] : [],
      nextAction: missingStatusWrite
        ? 'grant_profile_status_write_or_change_role'
        : !profile.handoff?.statusChannel
          ? 'route_profile_status_to_kernel'
          : 'include_profile_status_audit_handoff',
      evidence: {
        statusChannel: profile.handoff?.statusChannel ?? null,
        auditTarget: boundary.auditHandoff?.target ?? null,
        auditSubject: boundary.auditHandoff?.subject ?? null
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const diagnostics = [
    ...compiled.diagnostics,
    ...blockedRows.map((row) => diagnostic('error', 'profile_permission_matrix_blocked', row.id)),
    ...guardedRows.map((row) => diagnostic('warning', 'profile_permission_matrix_guarded', row.id))
  ];
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = profilePermissionMatrixFingerprint({
    profileName: profile.name,
    operation: profile.operation,
    status,
    rows
  });

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_tenant_permission_matrix',
    profileName: profile.name,
    operation: profile.operation,
    status,
    restartSafe: status === 'ready'
      && boundary.status === 'ready'
      && profile.handoff?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel,
    fingerprint,
    scope: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      requestedTenantId: boundary.requestedTenantId,
      requestedWorkspaceId: boundary.requestedWorkspaceId,
      role: boundary.role,
      permissionMode: boundary.permissionMode
    },
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      deniedCapabilities: deniedCapabilities.length,
      deniedPermissions: deniedPermissions.length,
      advisoryPermissions: advisoryPermissions.length,
      missingStatusWrite: missingStatusWrite ? 1 : 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    auditHandoff: {
      target: 'kernel.audit.mailchimp.profile-permissions',
      statusChannel: profile.handoff?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      publish: status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      subject: `${boundary.tenantId}/${boundary.workspaceId}/${profile.operation}`,
      includeRows: status !== 'ready',
      nextAction: status === 'blocked'
        ? 'resolve_profile_permission_matrix_blockers'
        : status === 'degraded'
          ? 'publish_profile_permission_matrix_advisory'
          : 'publish_profile_permission_matrix'
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_tenant_permission_matrix',
      profileName: profile.name,
      operation: profile.operation,
      status,
      restartSafe: status === 'ready'
        && boundary.status === 'ready'
        && profile.handoff?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      fingerprint,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      role: boundary.role,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      deniedCapabilities,
      deniedPermissions,
      nextAction: status === 'ready' ? 'publish_profile_permission_matrix' : 'review_profile_permission_matrix'
    },
    diagnostics
  };
}

export function buildProfileLaunchControlContract(input = {}, options = {}) {
  const lifecycle = buildProfileLifecycleControlState(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand,
    profileCommand: options.profileCommand,
    settings: options.settings ?? options.profileLifecycleSettings
  });
  const activation = buildProfileActivationControlPanel(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand,
    profileCommand: options.profileCommand,
    settings: options.settings ?? options.profileLifecycleSettings,
    activationSettings: options.activationSettings ?? options.profileActivationSettings,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance
  });
  const runtime = buildProfileClientRuntimeState(input, options);
  const provider = buildProfileProviderServiceContract(input, {
    ...options,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities
  });
  const previous = normalizeProfileLaunchControlState(options.previousLaunchControl ?? options.previousProfileLaunchControl ?? input.previousLaunchControl);
  const requiredControls = unique([
    ...parseList(options.requiredControls ?? input.requiredControls),
    ...(options.requireActivation !== false ? ['activation'] : []),
    ...(options.requireProvider !== false ? ['provider'] : []),
    ...(options.requireRuntime !== false ? ['runtime'] : [])
  ]);
  const rows = [
    {
      key: 'lifecycle',
      label: 'Profile lifecycle controls',
      status: lifecycle.status,
      required: true,
      enabled: lifecycle.enabled === true,
      restartSafe: lifecycle.ok === true && lifecycle.status !== 'disabled' && lifecycle.status !== 'paused',
      controls: lifecycle.controls,
      schedule: lifecycle.schedule,
      nextAction: lifecycle.nextAction,
      evidence: {
        generation: lifecycle.generation,
        fingerprint: lifecycle.fingerprint,
        automaticRetriesRemaining: lifecycle.controls?.automaticRetriesRemaining ?? 0,
        blockers: lifecycle.blockers
      }
    },
    {
      key: 'activation',
      label: 'Profile activation controls',
      status: activation.status,
      required: requiredControls.includes('activation'),
      enabled: activation.status !== 'disabled',
      restartSafe: activation.restartSafe === true,
      controls: activation.controls ?? {},
      schedule: activation.schedule ?? {},
      nextAction: activation.readiness?.nextAction ?? activation.exportSummary?.nextAction ?? 'publish_profile_activation',
      evidence: {
        validationSummary: activation.validationSummary ?? {},
        blockingReasons: activation.readiness?.blockingReasons ?? [],
        degradedReasons: activation.readiness?.degradedReasons ?? []
      }
    },
    {
      key: 'provider',
      label: 'Mailchimp provider service',
      status: provider.status,
      required: requiredControls.includes('provider'),
      enabled: provider.status !== 'blocked',
      restartSafe: provider.restartSafe === true,
      controls: {
        canEnable: provider.status !== 'ready',
        canDisable: false,
        requiresOperatorReview: provider.status === 'blocked'
      },
      schedule: {
        mode: provider.sync?.mode ?? DEFAULT_PROVIDER_SERVICE.syncMode,
        nextSyncAfterMs: provider.sync?.nextSyncAfterMs ?? null
      },
      nextAction: provider.status === 'blocked'
        ? 'repair_profile_provider_service'
        : provider.status === 'degraded'
          ? 'publish_profile_provider_degraded'
          : 'include_profile_provider_service',
      evidence: {
        requestedCapabilities: provider.negotiation?.requestedCapabilities ?? [],
        missingCapabilities: provider.negotiation?.missingCapabilities ?? [],
        externalState: provider.externalState ?? null
      }
    },
    {
      key: 'runtime',
      label: 'Profile client runtime',
      status: runtime.ok ? runtime.state?.workflow?.state ?? 'ready' : 'blocked',
      required: requiredControls.includes('runtime'),
      enabled: runtime.ok === true,
      restartSafe: runtime.ok === true && runtime.state?.workflow?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      controls: {
        canEnable: runtime.ok !== true,
        canDisable: false,
        requiresOperatorReview: runtime.ok !== true
      },
      schedule: {},
      nextAction: runtime.ok
        ? runtime.state?.recovery?.clientAction ?? 'wait_for_kernel_ack'
        : 'repair_profile_client_runtime',
      evidence: {
        requestKey: runtime.state?.requestKey ?? null,
        resumeToken: runtime.state?.workflow?.resumeToken ?? null,
        missingClaims: runtime.state?.verifier?.missingClaims ?? [],
        missingDurableMemory: runtime.state?.memory?.missingDurableMemory ?? []
      }
    }
  ];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => (
    row.status === 'blocked'
    || row.status === 'operator_review'
    || row.restartSafe === false && row.key !== 'activation'
  ));
  const degradedRows = requiredRows.filter((row) => (
    !blockedRows.includes(row)
    && (row.status === 'degraded'
      || row.status === 'enabled_degraded'
      || row.status === 'retry_scheduled'
      || row.status === 'paused'
      || row.status === 'disabled'
      || row.restartSafe === false)
  ));
  const disabledControls = requiredRows.filter((row) => row.enabled !== true);
  const diagnostics = [
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...activation.diagnostics.filter((item) => item.level === 'error'),
    ...runtime.diagnostics.filter((item) => item.level === 'error'),
    ...provider.diagnostics.filter((item) => item.level === 'error'),
    ...disabledControls.map((row) => diagnostic(row.key === 'lifecycle' ? 'error' : 'warning', 'profile_launch_control_disabled', row.key))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = profileLaunchControlFingerprint({
    profileName: lifecycle.profileName,
    operation: lifecycle.operation,
    status,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_profile_launch_control_blockers'
    : status === 'degraded'
      ? 'publish_profile_launch_control_degraded'
      : changed
        ? 'publish_profile_launch_control_ready'
        : 'reuse_profile_launch_control';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: lifecycle.profileName,
    operation: lifecycle.operation,
    status,
    restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalControls: rows.length,
      requiredControls: requiredRows.length,
      blockedControls: blockedRows.length,
      degradedControls: degradedRows.length,
      disabledControls: disabledControls.length,
      pendingSchedules: requiredRows.filter((row) => row.schedule?.nextRetry || row.schedule?.nextSyncAfterMs).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.key),
        ...(lifecycle.blockers?.missingClaims ?? []).map((claim) => `missing_claim:${claim}`),
        ...(provider.negotiation?.missingCapabilities ?? []).map((capability) => `missing:${capability}`)
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.key),
        ...disabledControls.filter((row) => row.key !== 'lifecycle').map((row) => `disabled:${row.key}`)
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-launch-controls',
      statusChannel: provider.externalState?.ready === true ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-launch-controls',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: status !== 'ready' || changed,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_launch_controls',
      profileName: lifecycle.profileName,
      operation: lifecycle.operation,
      status,
      restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedControls: blockedRows.map((row) => row.key).sort(),
      degradedControls: degradedRows.map((row) => row.key).sort(),
      disabledControls: disabledControls.map((row) => row.key).sort(),
      nextAction
    },
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

export function buildProfileLifecycleSettingsControlContract(input = {}, options = {}) {
  const lifecycle = buildProfileLifecycleControlState(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand ?? options.command,
    profileCommand: options.profileCommand,
    settings: options.settings ?? options.profileLifecycleSettings
  });
  const runtime = buildProfileClientRuntimeState(input, options);
  const failure = buildProfileOperationalFailureState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command,
    attempt: options.attempt ?? options.profileAttempt,
    maxAttempts: options.maxAttempts ?? options.maxProfileAttempts
  });
  const previous = normalizeProfileLifecycleSettingsControlState(
    options.previousControlContract ?? options.previousProfileLifecycleSettingsControls ?? input.previousControlContract
  );
  const settings = normalizeProfileLifecycleSettings(options.settings ?? options.profileLifecycleSettings ?? input.settings ?? {});
  const settingDiagnostics = validateProfileLifecycleSettings(settings);
  const command = normalizeProfileLifecycleCommand(options.lifecycleCommand ?? options.profileLifecycleCommand ?? options.command ?? input.command);
  const acceptedControls = normalizeProfileLifecycleControlAcceptance(
    options.clientControlAcceptance ?? options.acceptance ?? input.clientControlAcceptance
  );
  acceptedControls.requireExplicitAcceptance = acceptedControls.requireExplicitAcceptance
    || options.requireExplicitControlAcceptance === true
    || options.requireProfileLifecycleControlAcceptance === true;
  const requiredRows = unique([
    'enable_disable',
    'pause_resume',
    'retry_schedule',
    'status_acknowledgement',
    ...(settings.requireKernelStatus ? ['kernel_status'] : []),
    ...parseList(options.requiredControlRows ?? input.requiredControlRows)
  ]);
  const controls = lifecycle.controls ?? {};
  const schedule = lifecycle.schedule ?? {};
  const blockers = lifecycle.blockers ?? {};
  const statusChannelReady = blockers.statusChannelReady === true
    || runtime.state?.workflow?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel;
  const rows = [
    lifecycleSettingsControlRow({
      key: 'enable_disable',
      label: 'Enable or disable',
      requiredRows,
      acceptedControls,
      status: lifecycle.status === 'blocked' ? 'blocked' : controls.canEnable || controls.canDisable ? 'ready' : 'guarded',
      enabled: lifecycle.enabled === true,
      commands: ['enable', 'disable'].filter((action) => (
        action === 'enable' ? controls.canEnable === true : controls.canDisable === true
      )),
      disabledReasons: unique([
        ...(controls.canEnable === true || controls.canDisable === true ? [] : ['no_enable_disable_transition_available']),
        ...(lifecycle.status === 'blocked' ? ['lifecycle_blocked'] : [])
      ]),
      nextAction: lifecycle.status === 'disabled'
        ? 'show_profile_enable_control'
        : lifecycle.status === 'blocked'
          ? 'resolve_profile_lifecycle_before_control_change'
          : 'show_profile_disable_control',
      evidence: {
        lifecycleStatus: lifecycle.status,
        enabled: lifecycle.enabled === true,
        currentCommand: clean(command.action) || null
      }
    }),
    lifecycleSettingsControlRow({
      key: 'pause_resume',
      label: 'Pause or resume',
      requiredRows,
      acceptedControls,
      status: ['paused', 'enabled', 'enabled_degraded', 'retry_scheduled', 'status_acknowledged'].includes(lifecycle.status)
        ? 'ready'
        : lifecycle.status === 'blocked'
          ? 'blocked'
          : 'guarded',
      enabled: lifecycle.enabled === true,
      commands: ['pause', 'resume'].filter((action) => (
        action === 'pause' ? controls.canPause === true : controls.canResume === true
      )),
      disabledReasons: unique([
        ...(lifecycle.enabled === true ? [] : ['profile_disabled']),
        ...(controls.canPause === true || controls.canResume === true ? [] : ['pause_resume_not_available'])
      ]),
      nextAction: lifecycle.status === 'paused'
        ? 'show_profile_resume_control'
        : lifecycle.status === 'blocked'
          ? 'resolve_profile_lifecycle_before_pause_resume'
          : 'show_profile_pause_control',
      evidence: {
        lifecycleStatus: lifecycle.status,
        publishStatus: lifecycle.handoff?.publish === true
      }
    }),
    lifecycleSettingsControlRow({
      key: 'retry_schedule',
      label: 'Retry schedule',
      requiredRows,
      acceptedControls,
      status: settingDiagnostics.some((item) => item.level === 'error')
        ? 'blocked'
        : controls.canRetry === true || schedule.nextRetry
          ? 'ready'
          : failure.retryable === true
            ? 'guarded'
            : 'ready',
      enabled: lifecycle.enabled === true && settings.enabled === true,
      commands: controls.canRetry === true ? ['retry'] : [],
      disabledReasons: unique([
        ...(settings.enabled === true ? [] : ['profile_disabled']),
        ...(controls.canRetry === true ? [] : failure.retryable === true ? ['retry_waiting_for_window'] : ['no_retryable_failure']),
        ...settingDiagnostics.filter((item) => item.level === 'error').map((item) => item.code)
      ]),
      nextAction: controls.canRetry === true
        ? 'show_profile_retry_control'
        : schedule.nextRetry
          ? 'show_profile_retry_schedule'
          : failure.retryable === true
            ? 'wait_for_profile_retry_window'
            : 'hide_profile_retry_control',
      evidence: {
        scheduleMode: settings.scheduleMode,
        retryWindowMs: settings.retryWindowMs,
        maxScheduledRetries: settings.maxScheduledRetries,
        scheduledRetryCount: schedule.scheduledRetryCount ?? 0,
        automaticRetriesRemaining: controls.automaticRetriesRemaining ?? 0,
        nextRetry: schedule.nextRetry ?? failure.nextRetry ?? null
      }
    }),
    lifecycleSettingsControlRow({
      key: 'status_acknowledgement',
      label: 'Status acknowledgement',
      requiredRows,
      acceptedControls,
      status: controls.canAcknowledgeStatus === true || lifecycle.status === 'status_acknowledged' ? 'ready' : 'guarded',
      enabled: lifecycle.enabled === true,
      commands: controls.canAcknowledgeStatus === true ? ['ack_status'] : [],
      disabledReasons: controls.canAcknowledgeStatus === true ? [] : ['no_status_ack_required'],
      nextAction: controls.canAcknowledgeStatus === true
        ? 'show_profile_status_acknowledgement'
        : 'hide_profile_status_acknowledgement',
      evidence: {
        failureStatus: failure.status,
        publishFailure: failure.handoff?.publish === true,
        persistenceStatus: blockers.persistenceStatus ?? null
      }
    }),
    lifecycleSettingsControlRow({
      key: 'kernel_status',
      label: 'Kernel status channel',
      requiredRows,
      acceptedControls,
      status: statusChannelReady ? 'ready' : settings.requireKernelStatus ? 'blocked' : 'guarded',
      enabled: settings.requireKernelStatus === true,
      commands: [],
      disabledReasons: statusChannelReady ? [] : ['kernel_status_channel_unavailable'],
      nextAction: statusChannelReady
        ? 'include_profile_kernel_status_control'
        : settings.requireKernelStatus
          ? 'route_profile_lifecycle_to_kernel_status'
          : 'publish_profile_local_status_advisory',
      evidence: {
        required: settings.requireKernelStatus === true,
        statusChannel: runtime.state?.workflow?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
        expectedStatusChannel: DEFAULT_MAILCHIMP_PROFILE.statusChannel
      }
    })
  ].filter((row) => row.required || options.includeOptionalControlRows === true);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.restartSafe === false);
  const awaitingAcceptance = rows.filter((row) => row.required && row.accepted !== true);
  const diagnostics = [
    ...lifecycle.diagnostics.filter((item) => item.level === 'error' || item.level === 'warning'),
    ...settingDiagnostics,
    ...(acceptedControls.requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => diagnostic('error', 'profile_lifecycle_control_acceptance_missing', row.key))
      : awaitingAcceptance.map((row) => diagnostic('warning', 'profile_lifecycle_control_acceptance_pending', row.key))),
    ...(settings.requireKernelStatus && !statusChannelReady
      ? [diagnostic('error', 'profile_lifecycle_control_kernel_status_unavailable', DEFAULT_MAILCHIMP_PROFILE.statusChannel)]
      : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'degraded'
      : 'ready';
  const fingerprint = profileLifecycleSettingsControlFingerprint({
    profileName: lifecycle.profileName,
    operation: lifecycle.operation,
    status,
    settings,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_profile_lifecycle_control_blockers'
    : status === 'degraded'
      ? 'publish_profile_lifecycle_control_degraded'
      : changed
        ? 'publish_profile_lifecycle_control_contract'
        : 'reuse_profile_lifecycle_control_contract';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_lifecycle_settings_controls',
    profileName: lifecycle.profileName,
    operation: lifecycle.operation,
    status,
    restartSafe: status === 'ready' && lifecycle.ok === true && rows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    settings,
    activeCommand: clean(command.action) || null,
    rows,
    validationSummary: {
      totalRows: rows.length,
      requiredRows: rows.filter((row) => row.required).length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      visibleControls: rows.filter((row) => row.visibleToClient).length,
      enabledControls: rows.filter((row) => row.enabled).length,
      availableCommands: unique(rows.flatMap((row) => row.commands)).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.key),
        ...(blockers.missingClaims ?? []).map((claim) => `missing_claim:${claim}`),
        ...(settings.requireKernelStatus && !statusChannelReady ? ['kernel_status_channel'] : [])
      ]),
      guardedReasons: unique([
        ...guardedRows.map((row) => row.key),
        ...(!acceptedControls.requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['control_acceptance_pending'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-lifecycle-controls',
      statusChannel: status === 'ready' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-lifecycle-controls',
      publish: changed || status !== 'ready' || awaitingAcceptance.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeSettings: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_lifecycle_settings_controls',
      profileName: lifecycle.profileName,
      operation: lifecycle.operation,
      status,
      restartSafe: status === 'ready' && lifecycle.ok === true,
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.key).sort(),
      guardedRows: guardedRows.map((row) => row.key).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key).sort(),
      availableCommands: unique(rows.flatMap((row) => row.commands)).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildProfileLifecycleScheduleCheckpoint(input = {}, options = {}) {
  const lifecycle = buildProfileLifecycleControlState(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand ?? options.command,
    profileCommand: options.profileCommand,
    settings: options.settings ?? options.profileLifecycleSettings
  });
  const controls = buildProfileLifecycleSettingsControlContract(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    previousControlContract: options.previousControlContract ?? options.previousProfileLifecycleSettingsControls,
    persistedMemory: options.persistedMemory,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand ?? options.command,
    profileCommand: options.profileCommand,
    settings: options.settings ?? options.profileLifecycleSettings,
    clientControlAcceptance: options.clientControlAcceptance ?? options.profileLifecycleControlAcceptance
  });
  const previous = normalizeProfileLifecycleScheduleCheckpoint(
    options.previousCheckpoint ?? options.previousProfileLifecycleScheduleCheckpoint ?? input.previousCheckpoint
  );
  const settings = normalizeProfileLifecycleSettings(options.settings ?? options.profileLifecycleSettings ?? input.settings ?? {});
  const now = clean(options.now ?? options.timestamp) || null;
  const command = normalizeProfileLifecycleCommand(options.lifecycleCommand ?? options.profileLifecycleCommand ?? options.command ?? input.command);
  const commandKey = clean(command.commandKey ?? options.commandKey ?? options.profileLifecycleScheduleCommandKey);
  const seenCommands = new Set([
    ...(previous.appliedCommandKeys ?? []),
    ...(lifecycle.idempotency?.appliedCommandKeys ?? []),
    ...(options.appliedCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const repeatedCommand = Boolean(commandKey && seenCommands.has(commandKey));
  const retry = lifecycle.schedule?.nextRetry ?? null;
  const scheduleRows = [
    {
      id: 'enablement',
      status: lifecycle.enabled === true && lifecycle.status !== 'disabled' ? 'ready' : 'blocked',
      scheduled: lifecycle.enabled === true,
      dueAfterMs: lifecycle.enabled === true ? 0 : null,
      command: lifecycle.enabled === true ? 'resume' : 'enable',
      restartSafe: lifecycle.enabled === true && lifecycle.status !== 'blocked',
      nextAction: lifecycle.enabled === true ? 'keep_profile_lifecycle_enabled' : 'show_profile_enable_control',
      evidence: {
        lifecycleStatus: lifecycle.status,
        settingsEnabled: settings.enabled
      }
    },
    {
      id: 'retry_window',
      status: retry ? 'scheduled' : lifecycle.controls?.canRetry ? 'ready' : 'guarded',
      scheduled: Boolean(retry),
      dueAfterMs: retry?.delayMs ?? (lifecycle.controls?.canRetry ? 0 : null),
      command: 'retry',
      restartSafe: lifecycle.controls?.automaticRetriesRemaining > 0 || retry === null,
      nextAction: retry
        ? 'wait_for_profile_retry_window'
        : lifecycle.controls?.canRetry
          ? 'show_profile_retry_control'
          : 'suppress_profile_retry_control',
      evidence: {
        scheduleMode: settings.scheduleMode,
        retryWindowMs: settings.retryWindowMs,
        maxScheduledRetries: settings.maxScheduledRetries,
        scheduledRetryCount: lifecycle.schedule?.scheduledRetryCount ?? 0,
        automaticRetriesRemaining: lifecycle.controls?.automaticRetriesRemaining ?? 0,
        nextRetry: retry
      }
    },
    {
      id: 'kernel_status_ack',
      status: lifecycle.controls?.canAcknowledgeStatus ? 'ready' : 'guarded',
      scheduled: lifecycle.controls?.canAcknowledgeStatus === true,
      dueAfterMs: lifecycle.controls?.canAcknowledgeStatus ? 0 : null,
      command: 'ack_status',
      restartSafe: lifecycle.blockers?.statusChannelReady === true,
      nextAction: lifecycle.controls?.canAcknowledgeStatus
        ? 'show_profile_status_acknowledgement'
        : 'wait_for_profile_kernel_status_event',
      evidence: {
        requireKernelStatus: settings.requireKernelStatus,
        statusChannelReady: lifecycle.blockers?.statusChannelReady === true,
        statusChannel: lifecycle.handoff?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel
      }
    },
    {
      id: 'control_acceptance',
      status: controls.status === 'blocked' ? 'blocked' : controls.status === 'degraded' ? 'guarded' : 'ready',
      scheduled: controls.handoff?.publish === true,
      dueAfterMs: controls.handoff?.publish === true ? 0 : null,
      command: controls.exportSummary?.awaitingAcceptance?.length > 0 ? 'operator_review' : null,
      restartSafe: controls.restartSafe === true,
      nextAction: controls.readiness?.nextAction ?? controls.handoff?.nextAction ?? 'reuse_profile_lifecycle_controls',
      evidence: {
        awaitingAcceptance: controls.exportSummary?.awaitingAcceptance ?? [],
        availableCommands: controls.exportSummary?.availableCommands ?? [],
        controlFingerprint: controls.fingerprint
      }
    }
  ];
  const blockedRows = scheduleRows.filter((row) => row.status === 'blocked');
  const guardedRows = scheduleRows.filter((row) => row.status === 'guarded' || row.restartSafe === false);
  const scheduledRows = scheduleRows.filter((row) => row.scheduled === true);
  const diagnostics = [
    ...lifecycle.diagnostics.filter((item) => item.level === 'error' || item.level === 'warning'),
    ...controls.diagnostics.filter((item) => item.level === 'error' || item.level === 'warning'),
    ...(settings.scheduleMode === 'manual' && scheduledRows.some((row) => row.id === 'retry_window')
      ? [diagnostic('warning', 'profile_lifecycle_schedule_manual_retry_requires_operator', lifecycle.profileName)]
      : []),
    ...(repeatedCommand ? [diagnostic('info', 'profile_lifecycle_schedule_command_replayed', commandKey)] : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = profileLifecycleScheduleCheckpointFingerprint({
    profileName: lifecycle.profileName,
    operation: lifecycle.operation,
    status,
    rows: scheduleRows,
    commandKey
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? blockedRows[0]?.nextAction ?? 'resolve_profile_lifecycle_schedule_blockers'
    : status === 'guarded'
      ? 'publish_profile_lifecycle_schedule_guarded'
      : changed
        ? 'publish_profile_lifecycle_schedule_checkpoint'
        : 'reuse_profile_lifecycle_schedule_checkpoint';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_lifecycle_schedule_checkpoint',
    profileName: lifecycle.profileName,
    operation: lifecycle.operation,
    status,
    restartSafe: status === 'ready' && scheduleRows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    activeCommand: clean(command.action) || null,
    rows: scheduleRows,
    schedule: {
      mode: settings.scheduleMode,
      retryWindowMs: settings.retryWindowMs,
      maxScheduledRetries: settings.maxScheduledRetries,
      nextDueAfterMs: scheduledRows
        .map((row) => row.dueAfterMs)
        .filter((value) => Number.isInteger(value) && value >= 0)
        .sort((left, right) => left - right)[0] ?? null,
      scheduledCommands: unique(scheduledRows.map((row) => row.command)),
      automaticRetriesRemaining: lifecycle.controls?.automaticRetriesRemaining ?? 0
    },
    readiness: {
      blockingReasons: unique(blockedRows.map((row) => row.id)),
      guardedReasons: unique(guardedRows.map((row) => row.id)),
      nextAction
    },
    idempotency: {
      commandKey: commandKey || null,
      repeated: repeatedCommand,
      applied: Boolean(commandKey) && !repeatedCommand && status !== 'blocked',
      appliedCommandKeys: commandKey && !repeatedCommand && status !== 'blocked'
        ? unique([...seenCommands, commandKey])
        : unique([...seenCommands])
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-lifecycle-schedule',
      statusChannel: status === 'ready' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-lifecycle-schedule',
      publish: changed || status !== 'ready' || scheduledRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeSchedule: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_lifecycle_schedule_checkpoint',
      profileName: lifecycle.profileName,
      operation: lifecycle.operation,
      status,
      restartSafe: status === 'ready' && scheduleRows.every((row) => row.restartSafe !== false),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      scheduledCommands: unique(scheduledRows.map((row) => row.command)),
      nextAction
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

export function buildProfileAnalyticsExportLedger(input = {}, options = {}) {
  const exportState = buildProfileExportSummary(input, {
    ...options,
    previousExport: options.previousExport ?? options.previousProfileExport,
    now: options.now ?? options.timestamp
  });
  const health = options.healthExport ?? options.profileOperationalHealth ?? buildProfileOperationalHealthExport(input, {
    ...options,
    previousExport: options.previousExport ?? options.previousProfileExport,
    previousHealthExport: options.previousHealthExport ?? options.previousProfileHealthExport,
    now: options.now ?? options.timestamp
  });
  const primaryPack = options.primaryPack ?? options.profilePrimaryPack ?? buildProfilePrimaryExportPack(input, {
    ...options,
    previousExport: options.previousExport ?? options.previousProfileExport,
    previousHealthExport: options.previousHealthExport ?? options.previousProfileHealthExport,
    previousPrimaryPack: options.previousPrimaryPack ?? options.previousProfilePrimaryPack,
    now: options.now ?? options.timestamp
  });
  const previous = normalizeProfileAnalyticsExportLedger(
    options.previousLedger ?? options.previousProfileAnalyticsExportLedger ?? input.previousLedger
  );
  const now = clean(options.now ?? options.timestamp) || null;
  const rows = [
    profileAnalyticsExportLedgerRow('profile_export', exportState, true, {
      counters: exportState.counters,
      statusChannel: exportState.exportSummary?.statusChannel ?? null,
      nextAction: exportState.exportSummary?.nextAction
    }),
    profileAnalyticsExportLedgerRow('operational_health', health, true, {
      counters: health.counters,
      statusChannel: health.handoff?.statusChannel ?? null,
      nextAction: health.exportSummary?.nextAction ?? health.handoff?.nextAction
    }),
    profileAnalyticsExportLedgerRow('primary_export_pack', primaryPack, options.includePrimaryPack !== false, {
      counters: primaryPack.counters,
      statusChannel: primaryPack.handoff?.statusChannel ?? null,
      nextAction: primaryPack.exportSummary?.nextAction ?? primaryPack.handoff?.nextAction
    })
  ];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.status === 'blocked');
  const guardedRows = requiredRows.filter((row) => row.status === 'guarded' || row.restartSafe !== true);
  const diagnostics = [
    ...(exportState.diagnostics ?? []),
    ...(health.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeHealthWarnings === true),
    ...(primaryPack.diagnostics ?? []).filter((item) => item.level === 'error' || options.includePrimaryPackWarnings === true),
    ...blockedRows.map((row) => diagnostic('error', 'profile_analytics_export_row_blocked', row.id)),
    ...guardedRows.map((row) => diagnostic('warning', 'profile_analytics_export_row_guarded', row.id))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = profileAnalyticsExportLedgerFingerprint({
    profileName: exportState.profileName,
    operation: exportState.operation,
    status,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: now,
    profileName: exportState.profileName,
    operation: exportState.operation,
    status,
    fingerprint,
    blockedRows: blockedRows.length,
    guardedRows: guardedRows.length,
    diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
    diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(options.ledgerHistoryLimit ?? options.historyLimit, 12));
  const nextAction = status === 'blocked'
    ? 'resolve_profile_analytics_export_blockers'
    : status === 'guarded'
      ? 'publish_profile_analytics_export_guarded'
      : changed
        ? 'publish_profile_analytics_export_ledger'
        : 'reuse_profile_analytics_export_ledger';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_analytics_export_ledger',
    profileName: exportState.profileName,
    operation: exportState.operation,
    status,
    restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    rows,
    counters: {
      totalRows: rows.length,
      requiredRows: requiredRows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      restartSafeRows: rows.filter((row) => row.restartSafe).length,
      publishRows: rows.filter((row) => row.publish).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-analytics-export',
      statusChannel: status === 'ready' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-analytics-export',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeHistory: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_analytics_export_ledger',
      profileName: exportState.profileName,
      operation: exportState.operation,
      status,
      restartSafe: status === 'ready' && requiredRows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      publishRows: rows.filter((row) => row.publish).map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildProfileLaunchAcceptanceExport(input = {}, options = {}) {
  const exportState = buildProfileExportSummary(input, {
    ...options,
    previousExport: options.previousExport ?? options.previousProfileExport,
    now: options.now ?? options.timestamp
  });
  const preview = buildProfilePreviewAcceptanceState(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand,
    lifecycleSettings: options.lifecycleSettings ?? options.profileLifecycleSettings,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance,
    requiredItems: options.requiredItems ?? options.requiredProfilePreviewItems
  });
  const route = buildProfileClientPreviewRouteContract(input, {
    ...options,
    previousRoute: options.previousRoute ?? options.previousProfileClientPreviewRoute,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance,
    requiredPreviewItems: options.requiredItems ?? options.requiredProfilePreviewItems
  });
  const ledger = buildProfileAnalyticsExportLedger(input, {
    ...options,
    previousLedger: options.previousLedger ?? options.previousProfileAnalyticsExportLedger,
    previousExport: options.previousExport ?? options.previousProfileExport,
    previousHealthExport: options.previousHealthExport ?? options.previousProfileHealthExport,
    previousPrimaryPack: options.previousPrimaryPack ?? options.previousProfilePrimaryPack,
    now: options.now ?? options.timestamp
  });
  const previous = normalizeProfileLaunchAcceptanceExport(
    options.previousLaunchAcceptanceExport ?? options.previousProfileLaunchAcceptanceExport ?? input.previousLaunchAcceptanceExport
  );
  const now = clean(options.now ?? options.timestamp) || null;
  const requiredRows = [
    profileLaunchAcceptanceExportRow('profile_export', exportState, true, {
      awaitingAcceptance: [],
      nextAction: exportState.exportSummary?.nextAction
    }),
    profileLaunchAcceptanceExportRow('profile_preview_acceptance', preview, true, {
      awaitingAcceptance: preview.exportSummary?.awaitingAcceptance,
      nextAction: preview.readiness?.nextAction ?? preview.exportSummary?.nextAction
    }),
    profileLaunchAcceptanceExportRow('profile_preview_route', route, true, {
      awaitingAcceptance: route.exportSummary?.awaitingAcceptance,
      nextAction: route.handoff?.nextAction ?? route.exportSummary?.nextAction
    }),
    profileLaunchAcceptanceExportRow('profile_analytics_ledger', ledger, options.includeAnalyticsLedger !== false, {
      awaitingAcceptance: [],
      nextAction: ledger.handoff?.nextAction ?? ledger.exportSummary?.nextAction
    })
  ];
  const rows = dedupeProfileLaunchAcceptanceExportRows(requiredRows);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const awaitingAcceptance = unique(rows.flatMap((row) => row.awaitingAcceptance));
  const diagnostics = [
    ...(exportState.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeExportWarnings === true),
    ...(preview.diagnostics ?? []).filter((item) => item.level === 'error' || options.includePreviewWarnings === true),
    ...(route.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeRouteWarnings === true),
    ...(ledger.diagnostics ?? []).filter((item) => item.level === 'error' || options.includeLedgerWarnings === true),
    ...blockedRows.map((row) => diagnostic('error', 'profile_launch_acceptance_export_blocked', row.id)),
    ...guardedRows.map((row) => diagnostic('warning', 'profile_launch_acceptance_export_guarded', row.id)),
    ...(awaitingAcceptance.length > 0 && options.requireProfileLaunchAcceptance === true
      ? awaitingAcceptance.map((item) => diagnostic('error', 'profile_launch_acceptance_required', item))
      : awaitingAcceptance.map((item) => diagnostic('warning', 'profile_launch_acceptance_pending', item)))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0 || awaitingAcceptance.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = profileLaunchAcceptanceExportFingerprint({
    profileName: exportState.profileName,
    operation: exportState.operation,
    status,
    rows,
    awaitingAcceptance
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: now,
    profileName: exportState.profileName,
    operation: exportState.operation,
    status,
    fingerprint,
    blockedRows: blockedRows.length,
    guardedRows: guardedRows.length,
    awaitingAcceptance: awaitingAcceptance.length
  };
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [event] : [])
  ].slice(-toPositiveInteger(options.launchAcceptanceHistoryLimit ?? options.historyLimit, 12));
  const nextAction = blockedRows[0]?.nextAction
    ?? (awaitingAcceptance.length > 0 ? 'collect_profile_launch_acceptance' : null)
    ?? guardedRows[0]?.nextAction
    ?? (changed ? 'publish_profile_launch_acceptance_export' : 'reuse_profile_launch_acceptance_export');

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_launch_acceptance_export',
    profileName: exportState.profileName,
    operation: exportState.operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    rows,
    counters: {
      totalRows: rows.length,
      requiredRows: rows.filter((row) => row.required).length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      publishRows: rows.filter((row) => row.publish).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    readiness: {
      blockingReasons: blockedRows.map((row) => row.id).sort(),
      guardedReasons: guardedRows.map((row) => row.id).sort(),
      awaitingAcceptance,
      nextAction
    },
    handoff: {
      target: 'client.route.mailchimp.profile-launch-acceptance',
      statusChannel: status === 'ready' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-launch-acceptance',
      publish: changed || status !== 'ready' || awaitingAcceptance.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeHistory: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_launch_acceptance_export',
      profileName: exportState.profileName,
      operation: exportState.operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      awaitingAcceptance,
      publishRows: rows.filter((row) => row.publish).map((row) => row.id).sort(),
      nextAction
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

export function buildProfileRestartStatusLedger(input = {}, options = {}) {
  const runtime = buildProfileClientRuntimeState(input, options);
  const persistence = buildProfilePersistenceEnvelope(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command
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
  const failure = buildProfileOperationalFailureState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command,
    attempt: options.attempt ?? options.profileAttempt,
    maxAttempts: options.maxAttempts ?? options.maxProfileAttempts
  });
  const restart = buildProfileRestartRecoveryPacket(input, {
    ...options,
    previousRestartPacket: options.previousRestartPacket ?? options.previousProfileRestartRecovery,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand ?? options.command,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand,
    settings: options.settings ?? options.profileLifecycleSettings,
    attempt: options.attempt ?? options.profileAttempt,
    maxAttempts: options.maxAttempts ?? options.maxProfileAttempts
  });
  const previous = normalizeProfileRestartStatusLedger(options.previousLedger ?? options.previousProfileRestartStatusLedger ?? input.previousLedger);
  const state = runtime.state;
  const envelope = persistence.envelope;
  const rows = [
    {
      key: 'client_runtime',
      status: runtime.ok === true ? 'ready' : 'blocked',
      restartSafe: runtime.ok === true && state?.workflow?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      sequence: envelope?.generation ?? 0,
      evidence: {
        requestKey: state?.requestKey ?? envelope?.requestKey ?? null,
        resumeToken: state?.workflow?.resumeToken ?? envelope?.recovery?.resumeToken ?? null,
        missingClaims: state?.verifier?.missingClaims ?? []
      },
      nextAction: runtime.ok === true ? 'reuse_client_runtime_state' : 'repair_profile_client_runtime'
    },
    {
      key: 'persistence_envelope',
      status: envelope?.status ?? (persistence.ok === false ? 'blocked' : 'unavailable'),
      restartSafe: envelope?.restartSafe === true,
      sequence: envelope?.generation ?? 0,
      evidence: {
        restartKey: envelope?.restartKey ?? null,
        fingerprint: envelope?.fingerprint ?? null,
        missingRestorable: envelope?.memory?.missingRestorable ?? []
      },
      nextAction: envelope?.restartSafe === true ? 'reuse_profile_persistence_envelope' : 'repair_profile_persistence'
    },
    {
      key: 'lifecycle_control',
      status: ['blocked', 'operator_review'].includes(lifecycle.status) ? 'blocked' : lifecycle.status === 'enabled' ? 'ready' : 'degraded',
      restartSafe: lifecycle.ok === true && ['enabled', 'status_acknowledged'].includes(lifecycle.status),
      sequence: lifecycle.generation ?? 0,
      evidence: {
        lifecycleStatus: lifecycle.status,
        scheduledRetryCount: lifecycle.schedule?.scheduledRetryCount ?? 0,
        automaticRetriesRemaining: lifecycle.controls?.automaticRetriesRemaining ?? 0
      },
      nextAction: lifecycle.nextAction ?? 'reuse_profile_lifecycle'
    },
    {
      key: 'failure_state',
      status: failure.status ?? 'ready',
      restartSafe: failure.restartSafe !== false,
      sequence: restart.sequence ?? 0,
      evidence: {
        blockingReasons: failure.failureState?.blockingReasons ?? [],
        degradedReasons: failure.failureState?.degradedReasons ?? [],
        nextRetry: failure.nextRetry
      },
      nextAction: failure.handoff?.resumeAction ?? 'reuse_profile_failure_state'
    },
    {
      key: 'restart_checkpoint',
      status: restart.status ?? 'ready',
      restartSafe: restart.restartSafe === true,
      sequence: restart.sequence ?? 0,
      evidence: {
        restartKey: restart.checkpoint?.restartKey ?? null,
        fingerprint: restart.fingerprint ?? null,
        changed: restart.changed === true,
        resumeMode: restart.resumePlan?.mode ?? null
      },
      nextAction: restart.handoff?.nextAction ?? restart.exportSummary?.nextAction ?? 'reuse_profile_restart_checkpoint'
    }
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const degradedRows = rows.filter((row) => row.status === 'degraded' || row.restartSafe === false);
  const diagnostics = [
    ...runtime.diagnostics,
    ...persistence.diagnostics.filter((item) => item.level === 'error'),
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...failure.diagnostics.filter((item) => item.level === 'error'),
    ...restart.diagnostics.filter((item) => item.level === 'error'),
    ...(previous.schemaVersion && previous.schemaVersion !== PROFILE_DECLARATION_SCHEMA_VERSION
      ? [diagnostic('warning', 'profile_restart_status_ledger_schema_mismatch', previous.schemaVersion)]
      : []),
    ...blockedRows.map((row) => diagnostic('error', 'profile_restart_status_row_blocked', row.key)),
    ...degradedRows
      .filter((row) => row.status !== 'blocked')
      .map((row) => diagnostic('warning', 'profile_restart_status_row_guarded', row.key))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : degradedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'degraded'
      : 'ready';
  const fingerprint = profileRestartStatusLedgerFingerprint({
    profileName: state?.profileName ?? envelope?.profileName ?? restart.profileName ?? 'mailchimp.default',
    operation: state?.operation ?? envelope?.operation ?? restart.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const event = {
    sequence,
    timestamp: clean(options.now ?? options.timestamp) || null,
    status,
    fingerprint,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    blockedRows: blockedRows.map((row) => row.key).sort(),
    degradedRows: degradedRows.map((row) => row.key).sort()
  };
  const timeline = [...previous.timeline, event].slice(-toPositiveInteger(options.historyLimit ?? options.restartStatusHistoryLimit, 10));
  const nextAction = status === 'blocked'
    ? rows.find((row) => row.status === 'blocked')?.nextAction ?? 'operator_profile_restart_status_review'
    : status === 'degraded'
      ? 'publish_profile_restart_status_degraded'
      : changed
        ? 'publish_profile_restart_status_delta'
        : 'reuse_profile_restart_status';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: state?.profileName ?? envelope?.profileName ?? restart.profileName ?? 'mailchimp.default',
    operation: state?.operation ?? envelope?.operation ?? restart.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    restartSafe: event.restartSafe,
    sequence,
    fingerprint,
    changed,
    rows,
    timeline,
    handoff: {
      target: 'kernel.status.mailchimp.profile-restart-ledger',
      statusChannel: event.restartSafe ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-restart-ledger',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeTimeline: status !== 'ready' || changed,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_restart_status_ledger',
      status,
      restartSafe: event.restartSafe,
      sequence,
      fingerprint,
      changed,
      restartKey: restart.checkpoint?.restartKey ?? envelope?.restartKey ?? null,
      blockedRows: event.blockedRows,
      degradedRows: event.degradedRows,
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint ?? null,
      nextAction
    },
    diagnostics
  };
}

export function buildProfileProviderLaunchHandoffContract(input = {}, options = {}) {
  const providerService = buildProfileProviderServiceContract(input, {
    ...options,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState ?? input.previousProviderState,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities ?? input.requestedProviderCapabilities
  });
  const syncIntent = buildProfileProviderSyncIntent(input, {
    ...options,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState ?? input.previousProviderState,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities ?? input.requestedProviderCapabilities,
    syncCursor: options.syncCursor ?? options.profileSyncCursor ?? input.syncCursor
  });
  const syncHandoff = buildProfileProviderSyncHandoffContract(input, {
    ...options,
    providerSyncIntent: syncIntent,
    previousHandoff: options.previousHandoff ?? options.previousProfileProviderLaunchHandoff ?? input.previousHandoff,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState ?? input.previousProviderState,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities ?? input.requestedProviderCapabilities
  });
  const previous = normalizeProfileProviderLaunchHandoff(options.previousLaunchHandoff ?? options.previousProfileProviderLaunchHandoff ?? input.previousLaunchHandoff);
  const commandKey = clean(options.launchCommandKey ?? options.providerLaunchCommandKey ?? options.commandKey ?? input.launchCommandKey);
  const seenCommands = new Set([
    ...(previous.appliedCommandKeys ?? []),
    ...parseList(options.appliedLaunchCommandKeys)
  ].map(clean).filter(Boolean));
  const repeatedCommand = Boolean(commandKey && seenCommands.has(commandKey));
  const rows = [
    profileProviderLaunchRow('provider_service', providerService, true, {
      status: providerService.status,
      restartSafe: providerService.restartSafe,
      fingerprint: providerService.fingerprint ?? providerService.exportSummary?.fingerprint,
      nextAction: providerService.readiness?.nextAction ?? providerService.handoff?.nextAction ?? providerService.exportSummary?.nextAction,
      evidence: {
        provider: providerService.contract?.provider ?? providerService.provider ?? DEFAULT_PROVIDER_SERVICE.provider,
        service: providerService.contract?.service ?? providerService.service ?? DEFAULT_PROVIDER_SERVICE.service,
        missingCapabilities: providerService.negotiation?.missingCapabilities ?? providerService.capabilities?.missing ?? [],
        syncMode: providerService.contract?.syncMode ?? providerService.sync?.mode ?? DEFAULT_PROVIDER_SERVICE.syncMode
      }
    }),
    profileProviderLaunchRow('provider_sync_intent', syncIntent, true, {
      status: syncIntent.status,
      restartSafe: syncIntent.restartSafe,
      fingerprint: syncIntent.fingerprint ?? syncIntent.exportSummary?.fingerprint,
      nextAction: syncIntent.handoff?.nextAction ?? syncIntent.exportSummary?.nextAction,
      evidence: {
        cursor: syncIntent.sync?.cursor ?? syncIntent.cursor ?? null,
        requestedCapabilities: syncIntent.capabilityNegotiation?.requestedCapabilities ?? syncIntent.requestedCapabilities ?? [],
        missingCapabilities: syncIntent.capabilityNegotiation?.missingCapabilities ?? []
      }
    }),
    profileProviderLaunchRow('provider_sync_handoff', syncHandoff, true, {
      status: syncHandoff.status,
      restartSafe: syncHandoff.restartSafe,
      fingerprint: syncHandoff.fingerprint ?? syncHandoff.exportSummary?.fingerprint,
      nextAction: syncHandoff.handoff?.nextAction ?? syncHandoff.exportSummary?.nextAction,
      evidence: {
        statusChannel: syncHandoff.handoff?.statusChannel ?? syncHandoff.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
        target: syncHandoff.handoff?.target ?? DEFAULT_MAILCHIMP_PROFILE.handoffTarget,
        publish: syncHandoff.handoff?.publish === true
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.restartSafe === false);
  const diagnostics = [
    ...(providerService.diagnostics ?? []),
    ...(syncIntent.diagnostics ?? []),
    ...(syncHandoff.diagnostics ?? []),
    ...(repeatedCommand ? [diagnostic('info', 'profile_provider_launch_command_already_applied', commandKey)] : []),
    ...blockedRows.map((row) => diagnostic('error', 'profile_provider_launch_handoff_blocked', row.id)),
    ...guardedRows
      .filter((row) => row.status !== 'blocked')
      .map((row) => diagnostic('warning', 'profile_provider_launch_handoff_guarded', row.id))
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const fingerprint = profileProviderLaunchHandoffFingerprint({
    profileName: syncIntent.profileName ?? providerService.profileName ?? 'mailchimp.default',
    operation: syncIntent.operation ?? providerService.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    rows,
    commandKey
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const appliedCommandKeys = commandKey && !repeatedCommand && status !== 'blocked'
    ? [...seenCommands, commandKey].sort()
    : [...seenCommands].sort();
  const nextAction = status === 'blocked'
    ? blockedRows[0]?.nextAction ?? 'resolve_profile_provider_launch_handoff'
    : status === 'guarded'
      ? 'publish_profile_provider_launch_guarded'
      : changed
        ? 'publish_profile_provider_launch_ready'
        : 'reuse_profile_provider_launch_handoff';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_provider_launch_handoff',
    profileName: syncIntent.profileName ?? providerService.profileName ?? 'mailchimp.default',
    operation: syncIntent.operation ?? providerService.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    rows,
    idempotency: {
      commandKey: commandKey || null,
      repeated: repeatedCommand,
      applied: Boolean(commandKey) && !repeatedCommand && status !== 'blocked',
      appliedCommandKeys
    },
    launchHandoff: {
      provider: providerService.contract?.provider ?? DEFAULT_PROVIDER_SERVICE.provider,
      service: providerService.contract?.service ?? DEFAULT_PROVIDER_SERVICE.service,
      syncMode: providerService.contract?.syncMode ?? DEFAULT_PROVIDER_SERVICE.syncMode,
      cursor: syncIntent.sync?.cursor ?? syncIntent.cursor ?? null,
      statusChannel: rows.every((row) => row.evidence?.statusChannel !== 'local.status.profile-provider')
        ? DEFAULT_MAILCHIMP_PROFILE.statusChannel
        : 'local.status.profile-provider',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      nextAction
    },
    validationSummary: {
      rows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      missingCapabilities: unique(rows.flatMap((row) => row.evidence?.missingCapabilities ?? [])).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_provider_launch_handoff',
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
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

export function buildProfilePreviewNextStepDigest(input = {}, options = {}) {
  const preview = buildProfilePreviewAcceptanceState(input, {
    ...options,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance ?? input.acceptance,
    requiredPreviewItems: options.requiredPreviewItems ?? input.requiredPreviewItems
  });
  const workflow = buildProfileClientWorkflowHandoff(input, {
    ...options,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance ?? input.acceptance,
    requiredPreviewItems: options.requiredPreviewItems ?? input.requiredPreviewItems
  });
  const rows = (preview.preview?.rows ?? []).map((row) => {
    const blocked = row.status === 'blocked';
    const guarded = !blocked && (row.status === 'degraded' || row.accepted !== true);
    return {
      key: row.key,
      source: 'profile_preview',
      status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
      clientVisible: blocked || guarded || row.required === true,
      accepted: row.accepted === true,
      required: row.required === true,
      nextAction: row.nextStep,
      evidence: row.evidence ?? {}
    };
  });
  const workflowRows = (workflow.rows ?? [])
    .filter((row) => row.visibleToClient === true || row.status !== 'ready')
    .map((row) => ({
      key: `workflow:${row.id}`,
      source: 'profile_workflow',
      status: row.status === 'blocked' ? 'blocked' : row.status === 'degraded' ? 'guarded' : 'ready',
      clientVisible: true,
      accepted: true,
      required: true,
      nextAction: row.nextAction,
      evidence: row.evidence ?? {}
    }));
  const digestRows = dedupeProfilePreviewDigestRows([...rows, ...workflowRows]);
  const blockingRows = digestRows.filter((row) => row.status === 'blocked');
  const guardedRows = digestRows.filter((row) => row.status === 'guarded');
  const awaitingAcceptance = digestRows.filter((row) => row.required && row.accepted !== true);
  const status = blockingRows.length > 0 || preview.status === 'blocked' || workflow.status === 'blocked'
    ? 'blocked'
    : guardedRows.length > 0 || preview.status === 'degraded' || workflow.status === 'degraded'
      ? 'guarded'
      : 'ready';
  const nextActions = unique([
    ...blockingRows.map((row) => row.nextAction),
    ...guardedRows.map((row) => row.nextAction),
    ...(status === 'ready' ? [preview.readiness?.nextAction ?? workflow.handoff?.nextAction] : [])
  ]);
  const fingerprint = [
    preview.profileName,
    preview.operation,
    status,
    ...digestRows.map((row) => [
      row.key,
      row.source,
      row.status,
      row.accepted ? 'accepted' : 'pending',
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_preview_next_step_digest',
    profileName: preview.profileName,
    operation: preview.operation,
    status,
    restartSafe: status === 'ready' && preview.restartSafe === true && workflow.restartSafe === true,
    fingerprint,
    rows: digestRows,
    validationSummary: {
      totalRows: digestRows.length,
      visibleRows: digestRows.filter((row) => row.clientVisible).length,
      blockingRows: blockingRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      missingClaims: preview.validationSummary?.missingClaims ?? 0,
      missingDurableMemory: preview.validationSummary?.missingDurableMemory ?? 0,
      providerMissingCapabilities: preview.validationSummary?.providerMissingCapabilities ?? 0
    },
    readiness: {
      status,
      blockingReasons: blockingRows.map((row) => row.key).sort(),
      guardedReasons: guardedRows.map((row) => row.key).sort(),
      nextAction: status === 'blocked'
        ? 'resolve_profile_preview_next_steps'
        : status === 'guarded'
          ? 'publish_profile_preview_next_steps_guarded'
          : 'publish_profile_preview_next_steps_ready',
      nextActions
    },
    handoff: {
      target: 'mailchimp.client.workflow.profile-preview',
      statusChannel: preview.exportSummary?.statusChannel ?? workflow.handoff?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      publish: status !== 'ready' || digestRows.some((row) => row.clientVisible),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: digestRows.some((row) => row.clientVisible),
      nextAction: status === 'ready' ? 'publish_profile_preview_next_steps_ready' : 'review_profile_preview_next_steps'
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_preview_next_step_digest',
      status,
      restartSafe: status === 'ready' && preview.restartSafe === true && workflow.restartSafe === true,
      fingerprint,
      visibleRows: digestRows.filter((row) => row.clientVisible).map((row) => row.key).sort(),
      blockingRows: blockingRows.map((row) => row.key).sort(),
      guardedRows: guardedRows.map((row) => row.key).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key).sort(),
      nextActions,
      nextAction: status === 'ready' ? 'publish_profile_preview_next_steps_ready' : 'review_profile_preview_next_steps'
    },
    diagnostics: [...preview.diagnostics, ...(workflow.diagnostics ?? []).filter((item) => item.level === 'error')]
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

export function buildProfileLifecycleNextActionState(input = {}, options = {}) {
  const lifecycle = buildProfileLifecycleControlState(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    settings: options.settings ?? options.profileLifecycleSettings,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand,
    profileCommand: options.profileCommand ?? options.command
  });
  const launch = buildProfileLaunchControlContract(input, {
    ...options,
    lifecycle,
    previousLaunchControl: options.previousLaunchControl ?? options.previousProfileLaunchControl
  });
  const providerAdoption = buildProfileProviderAdoptionContract(input, {
    ...options,
    previousAdoption: options.previousProviderAdoption ?? options.previousProfileProviderAdoption,
    acceptance: options.providerAdoptionAcceptance ?? options.profileProviderAdoptionAcceptance
  });
  const failure = buildProfileOperationalFailureState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    attempt: options.attempt ?? options.profileAttempt,
    maxAttempts: options.maxAttempts ?? options.maxProfileAttempts
  });
  const rows = [
    profileLifecycleNextActionRow('lifecycle', lifecycle, true, {
      status: lifecycle.status,
      restartSafe: lifecycle.restartSafe,
      nextAction: lifecycle.nextAction,
      evidence: {
        enabled: lifecycle.controls?.enabled,
        scheduleMode: lifecycle.schedule?.mode,
        nextRetry: lifecycle.schedule?.nextRetry ?? null,
        pendingCommand: lifecycle.command?.action ?? null
      }
    }),
    profileLifecycleNextActionRow('launch_controls', launch, true, {
      status: launch.status,
      restartSafe: launch.restartSafe,
      nextAction: launch.exportSummary?.nextAction ?? launch.handoff?.nextAction,
      evidence: {
        enabledRows: launch.exportSummary?.enabledRows ?? [],
        disabledRows: launch.exportSummary?.disabledRows ?? [],
        blockedRows: launch.exportSummary?.blockedRows ?? [],
        fingerprint: launch.fingerprint ?? launch.exportSummary?.fingerprint
      }
    }),
    profileLifecycleNextActionRow('provider_adoption', providerAdoption, true, {
      status: providerAdoption.status,
      restartSafe: providerAdoption.restartSafe,
      nextAction: providerAdoption.exportSummary?.nextAction ?? providerAdoption.handoff?.nextAction,
      evidence: {
        blockedRows: providerAdoption.exportSummary?.blockedRows ?? [],
        degradedRows: providerAdoption.exportSummary?.degradedRows ?? [],
        missingCapabilities: providerAdoption.exportSummary?.missingCapabilities ?? [],
        syncCursor: providerAdoption.exportSummary?.syncCursor ?? null
      }
    }),
    profileLifecycleNextActionRow('failure_recovery', failure, false, {
      status: failure.status,
      restartSafe: failure.restartSafe,
      nextAction: failure.handoff?.resumeAction,
      evidence: {
        retryable: failure.retryable,
        nextRetry: failure.nextRetry,
        blockingReasons: failure.failureState?.blockingReasons ?? [],
        degradedReasons: failure.failureState?.degradedReasons ?? []
      }
    })
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.status === 'degraded');
  const diagnostics = [
    ...(lifecycle.diagnostics ?? []),
    ...(launch.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(providerAdoption.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(failure.diagnostics ?? []).filter((item) => item.level === 'error')
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_profile_lifecycle_next_action_blockers'
    : status === 'guarded'
      ? 'publish_profile_lifecycle_guarded_next_action'
      : rows.some((row) => row.nextAction && row.nextAction !== 'publish_profile_ready')
        ? 'publish_profile_lifecycle_next_action'
        : 'reuse_profile_lifecycle_ready_state';
  const fingerprint = profileLifecycleNextActionFingerprint({
    profileName: lifecycle.profileName ?? failure.profileName,
    operation: lifecycle.operation ?? failure.operation,
    status,
    rows
  });

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_lifecycle_next_action',
    profileName: lifecycle.profileName ?? failure.profileName,
    operation: lifecycle.operation ?? failure.operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
    fingerprint,
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      scheduledRows: rows.filter((row) => row.evidence?.nextRetry).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-next-action',
      statusChannel: status === 'ready' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-next-action',
      publish: status !== 'ready' || rows.some((row) => row.nextAction),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_lifecycle_next_action',
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe !== false),
      fingerprint,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildProfileLifecycleClientControlPacket(input = {}, options = {}) {
  const controls = buildProfileLifecycleSettingsControlContract(input, {
    ...options,
    previousControlContract: options.previousControlContract ?? options.previousProfileLifecycleSettingsControls,
    clientControlAcceptance: options.clientControlAcceptance ?? options.profileLifecycleControlAcceptance,
    requireExplicitControlAcceptance: options.requireExplicitControlAcceptance ?? options.requireProfileLifecycleControlAcceptance,
    requiredControlRows: options.requiredControlRows ?? options.requiredProfileLifecycleControlRows
  });
  const nextAction = buildProfileLifecycleNextActionState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousLaunchControl: options.previousLaunchControl ?? options.previousProfileLaunchControl,
    previousProviderAdoption: options.previousProviderAdoption ?? options.previousProfileProviderAdoption,
    settings: options.settings ?? options.profileLifecycleSettings,
    lifecycleCommand: options.lifecycleCommand ?? options.profileLifecycleCommand,
    providerAdoptionAcceptance: options.providerAdoptionAcceptance ?? options.profileProviderAdoptionAcceptance
  });
  const previous = normalizeProfileLifecycleClientControlPacket(
    options.previousPacket ?? options.previousProfileLifecycleClientControlPacket ?? input.previousPacket
  );
  const commandKey = clean(options.controlCommandKey ?? options.commandKey ?? input.controlCommandKey);
  const settingsRows = (controls.rows ?? []).map((row) => profileLifecycleClientControlRow('settings', row.key, row, {
    label: row.label,
    clientVisible: row.visibleToClient === true,
    accepted: row.accepted,
    commands: row.commands,
    nextAction: row.nextStep ?? row.nextAction,
    evidence: row.evidence
  }));
  const actionRows = (nextAction.rows ?? []).map((row) => profileLifecycleClientControlRow('next_action', row.id, row, {
    label: row.id,
    clientVisible: row.status !== 'ready' || row.required === true,
    accepted: row.status === 'ready',
    commands: [],
    nextAction: row.nextAction,
    evidence: row.evidence
  }));
  const rows = dedupeProfileLifecycleClientControlRows([...settingsRows, ...actionRows]);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const visibleRows = rows.filter((row) => row.clientVisible);
  const diagnostics = [
    ...(controls.diagnostics ?? []),
    ...(nextAction.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(commandKey && previous.appliedCommandKeys.includes(commandKey)
      ? [diagnostic('info', 'profile_lifecycle_client_control_command_already_applied', commandKey)]
      : [])
  ];
  const status = blockedRows.length > 0 || diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const fingerprint = profileLifecycleClientControlPacketFingerprint({
    profileName: controls.profileName ?? nextAction.profileName,
    operation: controls.operation ?? nextAction.operation,
    status,
    rows,
    controls,
    nextAction
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const packetNextAction = status === 'blocked'
    ? 'resolve_profile_lifecycle_client_control_blockers'
    : status === 'guarded'
      ? 'publish_profile_lifecycle_client_controls_guarded'
      : changed
        ? 'publish_profile_lifecycle_client_controls'
        : 'reuse_profile_lifecycle_client_controls';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_lifecycle_client_controls',
    profileName: controls.profileName ?? nextAction.profileName,
    operation: controls.operation ?? nextAction.operation,
    status,
    restartSafe: status === 'ready' && controls.restartSafe === true && nextAction.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalRows: rows.length,
      visibleRows: visibleRows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      awaitingAcceptance: rows.filter((row) => row.required && row.accepted !== true).length,
      availableCommands: unique(rows.flatMap((row) => row.commands)).length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    handoff: {
      target: 'mailchimp.client.workflow.profile-lifecycle-controls',
      statusChannel: controls.handoff?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      publish: status !== 'ready' || changed || visibleRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: visibleRows.length > 0,
      includeSettings: controls.handoff?.includeSettings === true,
      nextAction: packetNextAction
    },
    idempotency: {
      commandKey: commandKey || null,
      repeated: Boolean(commandKey && previous.appliedCommandKeys.includes(commandKey)),
      applied: Boolean(commandKey) && !previous.appliedCommandKeys.includes(commandKey) && status !== 'blocked',
      appliedCommandKeys: commandKey && !previous.appliedCommandKeys.includes(commandKey)
        ? [...previous.appliedCommandKeys, commandKey].sort()
        : previous.appliedCommandKeys
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_lifecycle_client_controls',
      profileName: controls.profileName ?? nextAction.profileName,
      operation: controls.operation ?? nextAction.operation,
      status,
      restartSafe: status === 'ready' && controls.restartSafe === true && nextAction.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      visibleRows: visibleRows.map((row) => row.id).sort(),
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      availableCommands: unique(rows.flatMap((row) => row.commands)).sort(),
      nextAction: packetNextAction
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

export function buildProfileProviderSyncHandoffContract(input = {}, options = {}) {
  const syncIntent = buildProfileProviderSyncIntent(input, {
    ...options,
    previousSyncIntent: options.previousSyncIntent ?? options.previousProfileProviderSyncIntent,
    acceptance: options.acceptance ?? options.profileProviderAdoptionAcceptance,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities,
    requiredProviderCapabilities: options.requiredProviderCapabilities ?? options.profileProviderCapabilities
  });
  const previous = normalizeProfileProviderSyncHandoff(options.previousHandoff ?? options.previousProfileProviderSyncHandoff ?? input.previousHandoff);
  const acceptance = normalizeProviderSyncHandoffAcceptance(options.handoffAcceptance ?? options.acceptance ?? input.handoffAcceptance);
  const importCheckpoint = normalizeProviderSyncCheckpoint(options.importProviderSyncCheckpoint ?? options.syncCheckpoint ?? input.importProviderSyncCheckpoint);
  const now = clean(options.now ?? options.timestamp) || null;
  const requiredRows = unique([
    'sync_intent',
    'capability_negotiation',
    'external_handoff',
    ...(importCheckpoint.present ? ['import_checkpoint'] : []),
    ...parseList(options.requiredHandoffRows ?? input.requiredHandoffRows)
  ]);
  const checkpointCursor = clean(importCheckpoint.profileCursor);
  const intentCursor = clean(syncIntent.sync?.cursor);
  const cursorMismatch = Boolean(checkpointCursor && intentCursor && checkpointCursor !== intentCursor);
  const rows = [
    {
      key: 'sync_intent',
      status: syncIntent.status ?? 'blocked',
      required: requiredRows.includes('sync_intent'),
      accepted: acceptance.acceptedItems.includes('sync_intent'),
      restartSafe: syncIntent.restartSafe === true,
      nextAction: syncIntent.readiness?.nextAction ?? syncIntent.handoff?.nextAction ?? 'publish_profile_provider_sync_intent',
      evidence: {
        cursor: intentCursor || null,
        changed: syncIntent.changed === true,
        sequence: syncIntent.sequence ?? 0,
        fingerprint: syncIntent.fingerprint ?? null
      }
    },
    {
      key: 'capability_negotiation',
      status: (syncIntent.capabilityNegotiation?.missingCapabilities ?? []).length > 0 ? 'blocked' : 'ready',
      required: requiredRows.includes('capability_negotiation'),
      accepted: acceptance.acceptedItems.includes('capability_negotiation'),
      restartSafe: (syncIntent.capabilityNegotiation?.missingCapabilities ?? []).length === 0,
      nextAction: (syncIntent.capabilityNegotiation?.missingCapabilities ?? []).length > 0
        ? 'repair_profile_provider_sync_capabilities'
        : 'publish_profile_provider_capabilities_ready',
      evidence: {
        requestedCapabilities: syncIntent.capabilityNegotiation?.requestedCapabilities ?? [],
        offeredCapabilities: syncIntent.capabilityNegotiation?.offeredCapabilities ?? [],
        missingCapabilities: syncIntent.capabilityNegotiation?.missingCapabilities ?? []
      }
    },
    {
      key: 'external_handoff',
      status: syncIntent.externalState?.ready === true ? 'ready' : 'blocked',
      required: requiredRows.includes('external_handoff'),
      accepted: acceptance.acceptedItems.includes('external_handoff'),
      restartSafe: syncIntent.externalState?.ready === true && syncIntent.handoff?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      nextAction: syncIntent.externalState?.ready === true
        ? 'publish_profile_provider_external_handoff'
        : 'route_profile_provider_sync_to_kernel_status',
      evidence: {
        target: syncIntent.handoff?.target ?? syncIntent.externalState?.target ?? null,
        statusChannel: syncIntent.handoff?.statusChannel ?? syncIntent.externalState?.statusChannel ?? null,
        publish: syncIntent.handoff?.publish === true
      }
    },
    ...(importCheckpoint.present ? [{
      key: 'import_checkpoint',
      status: importCheckpoint.status === 'blocked' || cursorMismatch ? 'blocked' : importCheckpoint.status === 'degraded' ? 'degraded' : 'ready',
      required: requiredRows.includes('import_checkpoint'),
      accepted: acceptance.acceptedItems.includes('import_checkpoint'),
      restartSafe: importCheckpoint.restartSafe === true && cursorMismatch !== true,
      nextAction: cursorMismatch
        ? 'align_profile_and_import_sync_cursors'
        : importCheckpoint.nextAction ?? 'publish_import_provider_sync_checkpoint',
      evidence: {
        checkpointKey: importCheckpoint.checkpointKey,
        profileCursor: checkpointCursor || null,
        intentCursor: intentCursor || null,
        cursorMismatch
      }
    }] : [])
  ];
  const scopedRows = rows.filter((row) => row.required || options.includeOptionalHandoffRows === true);
  const blockedRows = scopedRows.filter((row) => row.status === 'blocked');
  const degradedRows = scopedRows.filter((row) => row.status === 'degraded' || row.restartSafe === false);
  const awaitingAcceptance = scopedRows.filter((row) => row.required && row.accepted !== true);
  const fingerprint = profileProviderSyncHandoffFingerprint({
    syncIntent,
    importCheckpoint,
    rows: scopedRows,
    acceptedItems: acceptance.acceptedItems
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(syncIntent.diagnostics ?? []),
    ...(cursorMismatch ? [diagnostic('error', 'profile_provider_sync_handoff_cursor_mismatch', `${checkpointCursor}->${intentCursor}`)] : []),
    ...(acceptance.requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => diagnostic('error', 'profile_provider_sync_handoff_acceptance_missing', row.key))
      : awaitingAcceptance.map((row) => diagnostic('warning', 'profile_provider_sync_handoff_acceptance_pending', row.key)))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || degradedRows.length > 0
      ? 'degraded'
      : 'ready';
  const nextAction = status === 'blocked'
    ? 'resolve_profile_provider_sync_handoff_blockers'
    : status === 'degraded'
      ? 'publish_profile_provider_sync_handoff_degraded'
      : changed
        ? 'publish_profile_provider_sync_handoff'
        : 'reuse_profile_provider_sync_handoff';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_provider_sync_handoff',
    profileName: syncIntent.profileName,
    operation: syncIntent.operation,
    status,
    restartSafe: status === 'ready' && scopedRows.every((row) => row.restartSafe !== false),
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    rows: scopedRows,
    validationSummary: {
      totalRows: scopedRows.length,
      blockedRows: blockedRows.length,
      degradedRows: degradedRows.length,
      awaitingAcceptance: awaitingAcceptance.length,
      missingCapabilities: syncIntent.capabilityNegotiation?.missingCapabilities?.length ?? 0,
      cursorMismatches: cursorMismatch ? 1 : 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique([
        ...blockedRows.map((row) => row.key),
        ...((syncIntent.capabilityNegotiation?.missingCapabilities ?? []).map((capability) => `missing:${capability}`)),
        ...(cursorMismatch ? ['sync_cursor_mismatch'] : [])
      ]),
      degradedReasons: unique([
        ...degradedRows.map((row) => row.key),
        ...(!acceptance.requireExplicitAcceptance && awaitingAcceptance.length > 0 ? ['acceptance_pending'] : [])
      ]),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-provider-sync',
      statusChannel: status === 'ready' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-provider-sync',
      publish: changed || status !== 'ready' || awaitingAcceptance.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: true,
      includeSyncIntent: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_provider_sync_handoff',
      profileName: syncIntent.profileName,
      operation: syncIntent.operation,
      status,
      restartSafe: status === 'ready' && scopedRows.every((row) => row.restartSafe !== false),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.key).sort(),
      degradedRows: degradedRows.map((row) => row.key).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.key).sort(),
      syncCursor: intentCursor || null,
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

export function buildProfileOperationalReadinessBrief(input = {}, options = {}) {
  const health = buildProfileOperationalHealthExport(input, {
    ...options,
    previousHealthExport: options.previousHealthExport ?? options.previousProfileHealthExport,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousExport: options.previousExport ?? options.previousProfileExport,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    persistedMemory: options.persistedMemory,
    now: options.now ?? options.timestamp
  });
  const previous = normalizeProfileReadinessBrief(options.previousBrief ?? options.previousProfileReadinessBrief ?? input.previousBrief);
  const requiredComponents = unique(parseList(options.requiredComponents ?? input.requiredComponents));
  const rows = health.rows.map((row) => {
    const status = profileReadinessBriefStatus(row);
    const required = requiredComponents.length === 0 || requiredComponents.includes(row.component);
    return {
      id: row.component,
      status,
      required,
      restartSafe: status === 'ready' && row.restartSafe !== false,
      clientVisible: status !== 'ready' || required,
      nextAction: clean(row.nextAction) || (
        status === 'blocked' ? `resolve_${row.component}` : status === 'guarded' ? `review_${row.component}` : `publish_${row.component}`
      ),
      evidence: {
        fingerprint: clean(row.evidence?.fingerprint ?? row.evidence?.exportSummary?.fingerprint),
        actionableErrorCount: toNonNegativeInteger(row.evidence?.actionableErrorCount, 0),
        blockingReasons: unique(parseList(row.evidence?.blockingReasons)),
        degradedReasons: unique(parseList(row.evidence?.degradedReasons))
      }
    };
  });
  const blockedRows = rows.filter((row) => row.required && row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.required && row.status === 'guarded');
  const status = blockedRows.length > 0 || health.status === 'blocked'
    ? 'blocked'
    : guardedRows.length > 0 || health.status === 'degraded'
      ? 'guarded'
      : 'ready';
  const fingerprint = profileReadinessBriefFingerprint({
    profileName: health.profileName,
    operation: health.operation,
    status,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? blockedRows[0]?.nextAction ?? 'resolve_profile_readiness_blockers'
    : status === 'guarded'
      ? guardedRows[0]?.nextAction ?? 'publish_profile_readiness_guarded'
      : changed
        ? 'publish_profile_readiness_ready'
        : 'reuse_profile_readiness_brief';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_operational_readiness_brief',
    profileName: health.profileName,
    operation: health.operation,
    status,
    restartSafe: status === 'ready' && health.restartSafe === true && rows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalRows: rows.length,
      requiredRows: rows.filter((row) => row.required).length,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      clientVisibleRows: rows.filter((row) => row.clientVisible).map((row) => row.id).sort(),
      diagnosticErrors: health.diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: health.diagnostics.filter((item) => item.level === 'warning').length
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-readiness',
      statusChannel: status === 'ready' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-readiness',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_operational_readiness_brief',
      profileName: health.profileName,
      operation: health.operation,
      status,
      restartSafe: status === 'ready' && health.restartSafe === true && rows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics: health.diagnostics
  };
}

export function buildProfileStatusPublicationPacket(input = {}, options = {}) {
  const health = input?.schemaVersion === PROFILE_DECLARATION_SCHEMA_VERSION && input.title === 'mailchimp_profile_operational_health'
    ? input
    : buildProfileOperationalHealthExport(input, options);
  const previous = normalizeProfileStatusPublication(options.previousPublication ?? options.previousProfileStatusPublication ?? input.previousPublication);
  const maxAgeMs = toPositiveInteger(options.maxPublicationAgeMs ?? input.maxPublicationAgeMs, 120000);
  const now = clean(options.now ?? options.timestamp) || null;
  const unchanged = previous.healthFingerprint && previous.healthFingerprint === health.fingerprint;
  const stale = unchanged && previous.ageMs > maxAgeMs;
  const rows = (health.rows ?? []).map((row) => ({
    component: row.component,
    status: row.status,
    restartSafe: row.restartSafe !== false,
    publish: row.status !== 'ready' || row.restartSafe === false || unchanged !== true,
    nextAction: row.nextAction ?? null
  }));
  const status = health.status === 'blocked'
    ? 'blocked'
    : health.status === 'degraded' || stale
      ? 'degraded'
      : 'ready';
  const fingerprint = profileStatusPublicationFingerprint({
    profileName: health.profileName,
    operation: health.operation,
    status,
    healthFingerprint: health.fingerprint,
    rows,
    stale
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = changed ? previous.sequence + 1 : previous.sequence;
  const diagnostics = [
    ...(health.diagnostics ?? []),
    ...(stale ? [diagnostic('warning', 'profile_status_publication_stale', String(previous.ageMs))] : [])
  ];
  const nextAction = status === 'blocked'
    ? 'publish_profile_status_blocked'
    : status === 'degraded'
      ? 'publish_profile_status_degraded'
      : changed
        ? 'publish_profile_status_ready'
        : 'reuse_profile_status_publication';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_status_publication',
    profileName: health.profileName,
    operation: health.operation,
    status,
    restartSafe: status === 'ready' && health.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    stale,
    rows,
    publication: {
      target: 'kernel.status.mailchimp.profile-publication',
      statusChannel: health.handoff?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      publish: changed || status !== 'ready' || stale,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      generatedAt: now,
      includeHealthExport: true,
      includeActionQueue: (health.actionQueue ?? []).length > 0,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_status_publication',
      profileName: health.profileName,
      operation: health.operation,
      status,
      restartSafe: status === 'ready' && health.restartSafe === true,
      sequence,
      fingerprint,
      healthFingerprint: health.fingerprint,
      changed,
      stale,
      actionCount: health.actionQueue?.length ?? 0,
      nextAction
    },
    diagnostics
  };
}

export function buildProfileOperationalEscalationEnvelope(input = {}, options = {}) {
  const health = input?.schemaVersion === PROFILE_DECLARATION_SCHEMA_VERSION && input.title === 'mailchimp_profile_operational_health'
    ? input
    : buildProfileOperationalHealthExport(input, {
      ...options,
      previousHealthExport: options.previousHealthExport ?? options.previousProfileHealthExport
    });
  const publication = options.publication ?? buildProfileStatusPublicationPacket(health, {
    ...options,
    previousPublication: options.previousPublication ?? options.previousProfileStatusPublication
  });
  const previous = normalizeProfileOperationalEscalation(options.previousEscalation ?? options.previousProfileEscalation ?? input.previousEscalation);
  const now = clean(options.now ?? options.timestamp) || null;
  const owners = normalizeProfileEscalationOwners(options.owners ?? options.profileEscalationOwners);
  const thresholds = normalizeProfileEscalationThresholds(options.thresholds ?? options.profileEscalationThresholds);
  const rows = [
    ...profileEscalationRowsFromComponents(health.rows ?? [], owners),
    ...profileEscalationRowsFromDiagnostics(health.diagnostics ?? [], owners),
    ...profileEscalationRowsFromActions(health.actionQueue ?? [], owners)
  ];
  const dedupedRows = dedupeProfileEscalationRows(rows).map((row) => ({
    ...row,
    deadlineMs: row.severity === 'error' ? thresholds.errorMs : row.severity === 'warning' ? thresholds.warningMs : thresholds.infoMs,
    publish: row.severity !== 'info' || publication.publication?.publish === true
  }));
  const errorRows = dedupedRows.filter((row) => row.severity === 'error');
  const warningRows = dedupedRows.filter((row) => row.severity === 'warning');
  const retry = health.exportSummary?.nextRetry ?? null;
  const status = errorRows.length > 0 || health.status === 'blocked'
    ? 'blocked'
    : warningRows.length > 0 || health.status === 'degraded'
      ? 'degraded'
      : 'ready';
  const fingerprint = profileOperationalEscalationFingerprint({
    profileName: health.profileName,
    operation: health.operation,
    status,
    rows: dedupedRows,
    retry,
    publication
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'page_profile_operational_owner'
    : status === 'degraded'
      ? retry
        ? 'schedule_profile_retry_and_publish_warning'
        : 'publish_profile_degraded_escalation'
      : changed
        ? 'publish_profile_escalation_clear'
        : 'reuse_profile_escalation';
  const diagnostics = [
    ...(health.diagnostics ?? []),
    ...(publication.diagnostics ?? []),
    ...(status === 'blocked' && errorRows.length === 0
      ? [diagnostic('error', 'profile_escalation_health_blocked_without_row', health.profileName)]
      : [])
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_operational_escalation',
    profileName: health.profileName,
    operation: health.operation,
    status,
    restartSafe: status === 'ready' && health.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    rows: dedupedRows,
    counters: {
      rows: dedupedRows.length,
      errors: errorRows.length,
      warnings: warningRows.length,
      publishRows: dedupedRows.filter((row) => row.publish).length,
      retryScheduled: retry ? 1 : 0,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    retry,
    escalation: {
      owner: errorRows[0]?.owner ?? warningRows[0]?.owner ?? owners.defaultOwner,
      deadlineMs: errorRows[0]?.deadlineMs ?? warningRows[0]?.deadlineMs ?? thresholds.infoMs,
      nextAction,
      lastStableFingerprint: status === 'ready' ? fingerprint : previous.lastStableFingerprint
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-escalation',
      statusChannel: publication.publication?.statusChannel ?? health.handoff?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      publish: changed || status !== 'ready' || dedupedRows.some((row) => row.publish),
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: dedupedRows.length > 0,
      includeRetry: Boolean(retry),
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_operational_escalation',
      profileName: health.profileName,
      operation: health.operation,
      status,
      restartSafe: status === 'ready' && health.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      owner: errorRows[0]?.owner ?? warningRows[0]?.owner ?? owners.defaultOwner,
      publishRows: dedupedRows.filter((row) => row.publish).map((row) => row.id).sort(),
      nextRetry: retry,
      nextAction
    },
    diagnostics
  };
}

export function buildProfileRestartCommandReplayPlan(input = {}, options = {}) {
  const persistence = buildProfilePersistenceEnvelope(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command
  });
  const lifecycle = buildProfileLifecycleControlState(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    lifecycleCommand: options.lifecycleCommand ?? options.command,
    profileCommand: options.profileCommand,
    settings: options.settings ?? options.profileLifecycleSettings
  });
  const restartLedger = buildProfileRestartStatusLedger(input, {
    ...options,
    previousLedger: options.previousRestartStatusLedger ?? options.previousProfileRestartStatusLedger,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    persistedMemory: options.persistedMemory,
    profileCommand: options.profileCommand,
    lifecycleCommand: options.lifecycleCommand,
    settings: options.settings ?? options.profileLifecycleSettings
  });
  const previous = normalizeProfileRestartCommandReplay(options.previousReplayPlan ?? options.previousProfileRestartCommandReplay ?? input.previousReplayPlan);
  const requestedCommands = normalizeProfileReplayCommands(options.commands ?? input.commands, options);
  const seenCommandKeys = new Set([
    ...previous.appliedCommandKeys,
    ...previous.suppressedCommandKeys,
    ...(persistence.envelope?.idempotency?.appliedCommandKeys ?? []),
    ...(lifecycle.idempotency?.appliedCommandKeys ?? []),
    ...(options.appliedCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const restartBlocked = restartLedger.status === 'blocked' || persistence.ok !== true || lifecycle.ok !== true;
  const restartGuarded = restartBlocked !== true && (
    restartLedger.status === 'degraded'
    || persistence.envelope?.restartSafe !== true
    || lifecycle.status !== 'enabled'
  );
  const rows = requestedCommands.map((command, index) => {
    const commandKey = clean(command.commandKey) || `replay:${index + 1}:${clean(command.action) || 'noop'}`;
    const repeated = seenCommandKeys.has(commandKey);
    const lifecycleAction = clean(command.lifecycleAction ?? command.action);
    const persistenceAction = clean(command.persistenceAction ?? command.action);
    const targetsLifecycle = ['enable', 'disable', 'pause', 'resume', 'retry', 'ack_status', 'operator_review'].includes(lifecycleAction);
    const targetsPersistence = Boolean(persistenceAction) && targetsLifecycle !== true;
    const invalid = !lifecycleAction && !persistenceAction;
    const blocked = invalid || restartBlocked || (command.requireRestartSafe !== false && restartLedger.restartSafe !== true);
    const status = blocked
      ? 'blocked'
      : repeated
        ? 'replayed'
        : restartGuarded
          ? 'guarded'
          : 'ready';
    return {
      commandKey,
      action: lifecycleAction || persistenceAction || 'noop',
      target: targetsLifecycle ? 'profile_lifecycle' : targetsPersistence ? 'profile_persistence' : 'profile_recovery',
      status,
      repeated,
      restartSafeRequired: command.requireRestartSafe !== false,
      apply: status === 'ready' || status === 'guarded',
      suppress: repeated || status === 'blocked',
      evidence: {
        persistenceStatus: persistence.envelope?.status ?? 'unavailable',
        lifecycleStatus: lifecycle.status ?? 'unavailable',
        restartLedgerStatus: restartLedger.status,
        restartKey: persistence.envelope?.restartKey ?? restartLedger.exportSummary?.restartKey ?? null,
        previousFingerprint: previous.fingerprint || null
      },
      nextAction: status === 'blocked'
        ? invalid
          ? 'discard_empty_profile_replay_command'
          : 'repair_profile_restart_before_command_replay'
        : repeated
          ? 'suppress_duplicate_profile_replay_command'
          : status === 'guarded'
            ? 'publish_guarded_profile_replay_command'
            : 'apply_profile_replay_command'
    };
  });
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const replayedRows = rows.filter((row) => row.repeated);
  const diagnostics = [
    ...persistence.diagnostics.filter((item) => item.level === 'error'),
    ...lifecycle.diagnostics.filter((item) => item.level === 'error'),
    ...restartLedger.diagnostics.filter((item) => item.level === 'error'),
    ...(previous.schemaVersion && previous.schemaVersion !== PROFILE_DECLARATION_SCHEMA_VERSION
      ? [diagnostic('warning', 'profile_restart_command_replay_schema_mismatch', previous.schemaVersion)]
      : []),
    ...blockedRows.map((row) => diagnostic('error', 'profile_restart_command_replay_blocked', row.commandKey)),
    ...guardedRows.map((row) => diagnostic('warning', 'profile_restart_command_replay_guarded', row.commandKey)),
    ...replayedRows.map((row) => diagnostic('info', 'profile_restart_command_replay_duplicate_suppressed', row.commandKey))
  ];
  const status = diagnostics.some((item) => item.level === 'error')
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'degraded'
      : 'ready';
  const fingerprint = profileRestartCommandReplayFingerprint({
    profileName: restartLedger.profileName,
    operation: restartLedger.operation,
    status,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const appliedCommandKeys = unique([
    ...previous.appliedCommandKeys,
    ...rows.filter((row) => row.apply && row.status !== 'blocked').map((row) => row.commandKey)
  ]);
  const suppressedCommandKeys = unique([
    ...previous.suppressedCommandKeys,
    ...rows.filter((row) => row.suppress).map((row) => row.commandKey)
  ]);
  const nextAction = status === 'blocked'
    ? blockedRows[0]?.nextAction ?? 'operator_profile_replay_review'
    : status === 'degraded'
      ? 'publish_profile_replay_guarded_status'
      : changed
        ? 'publish_profile_replay_ready'
        : 'reuse_profile_replay_plan';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_restart_command_replay',
    profileName: restartLedger.profileName,
    operation: restartLedger.operation,
    status,
    restartSafe: status === 'ready' && restartLedger.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    rows,
    idempotency: {
      requestedCommands: rows.length,
      appliedCommandKeys,
      suppressedCommandKeys,
      replayedCommandKeys: replayedRows.map((row) => row.commandKey).sort()
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-command-replay',
      statusChannel: status === 'ready' && restartLedger.restartSafe === true
        ? DEFAULT_MAILCHIMP_PROFILE.statusChannel
        : 'local.status.profile-command-replay',
      publish: changed || status !== 'ready' || replayedRows.length > 0,
      severity: status === 'blocked' ? 'error' : status === 'degraded' ? 'warning' : 'info',
      includeRows: rows.length > 0,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_restart_command_replay',
      status,
      restartSafe: status === 'ready' && restartLedger.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      readyCommands: rows.filter((row) => row.status === 'ready').map((row) => row.commandKey).sort(),
      guardedCommands: guardedRows.map((row) => row.commandKey).sort(),
      blockedCommands: blockedRows.map((row) => row.commandKey).sort(),
      suppressedCommands: suppressedCommandKeys,
      nextAction
    },
    diagnostics
  };
}

export function buildProfileRestartReplayDecisionEnvelope(input = {}, options = {}) {
  const replayPlan = buildProfileRestartCommandReplayPlan(input, {
    ...options,
    previousReplayPlan: options.previousReplayPlan ?? options.previousProfileRestartCommandReplay,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousRestartStatusLedger: options.previousRestartStatusLedger ?? options.previousProfileRestartStatusLedger,
    persistedMemory: options.persistedMemory,
    commands: options.commands ?? options.profileReplayCommands
  });
  const checkpoint = buildProfileClientRuntimeCheckpoint(input, {
    ...options,
    previousCheckpoint: options.previousCheckpoint ?? options.previousProfileRuntimeCheckpoint,
    previousState: options.previousState ?? options.previousProfileState,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousRuntimeAdoption: options.previousRuntimeAdoption ?? options.previousProfileRuntimeAdoption,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    previousAdoption: options.previousAdoption ?? options.previousProfileProviderAdoption,
    persistedMemory: options.persistedMemory
  });
  const manifest = buildProfilePersistedStateRecoveryManifest(input, {
    ...options,
    previousManifest: options.previousManifest ?? options.previousProfileRecoveryManifest,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command
  });
  const previous = normalizeProfileRestartReplayDecisionEnvelope(
    options.previousReplayDecision ?? options.previousProfileRestartReplayDecision ?? input.previousReplayDecision
  );
  const commandKey = clean(options.replayDecisionCommandKey ?? options.commandKey);
  const seenCommands = new Set([
    ...previous.appliedCommandKeys,
    ...previous.suppressedCommandKeys,
    ...(replayPlan.idempotency?.appliedCommandKeys ?? []),
    ...(replayPlan.idempotency?.suppressedCommandKeys ?? [])
  ].map(clean).filter(Boolean));
  const repeatedCommand = Boolean(commandKey && seenCommands.has(commandKey));
  const rows = dedupeProfileRuntimeCheckpointRows([
    profileRuntimeCheckpointRow('checkpoint_resume', {
      status: checkpoint.status === 'guarded' ? 'guarded' : checkpoint.status,
      restartSafe: checkpoint.restartSafe === true,
      clientVisible: checkpoint.status !== 'ready' || checkpoint.changed === true,
      nextAction: checkpoint.readiness?.nextAction ?? checkpoint.handoff?.nextAction,
      evidence: {
        sequence: checkpoint.sequence,
        fingerprint: checkpoint.fingerprint,
        requestKey: checkpoint.request?.requestKey ?? null,
        resumeToken: checkpoint.request?.resumeToken ?? null,
        blockedComponents: checkpoint.exportSummary?.blockedRows ?? [],
        degradedComponents: checkpoint.exportSummary?.guardedRows ?? []
      }
    }),
    profileRuntimeCheckpointRow('replay_commands', {
      status: replayPlan.status === 'degraded' ? 'guarded' : replayPlan.status,
      restartSafe: replayPlan.restartSafe === true || replayPlan.status === 'ready',
      clientVisible: replayPlan.status !== 'ready' || (replayPlan.idempotency?.replayedCommandKeys ?? []).length > 0,
      nextAction: replayPlan.handoff?.nextAction ?? replayPlan.exportSummary?.nextAction,
      evidence: {
        sequence: replayPlan.sequence,
        fingerprint: replayPlan.fingerprint,
        appliedCommands: replayPlan.idempotency?.appliedCommandKeys ?? [],
        suppressedCommands: replayPlan.idempotency?.suppressedCommandKeys ?? [],
        replayedCommands: replayPlan.idempotency?.replayedCommandKeys ?? []
      }
    }),
    profileRuntimeCheckpointRow('persisted_recovery_manifest', {
      status: manifest.status === 'degraded' ? 'guarded' : manifest.status,
      restartSafe: manifest.restartSafe === true,
      clientVisible: manifest.status !== 'ready' || manifest.changed === true,
      nextAction: manifest.handoff?.nextAction ?? manifest.exportSummary?.nextAction,
      evidence: {
        sequence: manifest.sequence,
        fingerprint: manifest.fingerprint,
        blockedComponents: manifest.exportSummary?.blockedRows ?? [],
        degradedComponents: manifest.exportSummary?.guardedRows ?? []
      }
    }),
    profileRuntimeCheckpointRow('decision_command', {
      status: repeatedCommand ? 'guarded' : 'ready',
      restartSafe: repeatedCommand !== true,
      clientVisible: repeatedCommand,
      nextAction: repeatedCommand
        ? 'suppress_duplicate_profile_restart_decision'
        : 'apply_profile_restart_decision',
      evidence: {
        commandKey: commandKey || null,
        repeated: repeatedCommand,
        previousFingerprint: previous.fingerprint || null
      }
    })
  ]);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.restartSafe === false);
  const diagnostics = [
    ...checkpoint.diagnostics.filter((item) => item.level === 'error'),
    ...replayPlan.diagnostics.filter((item) => item.level === 'error' || item.code === 'profile_restart_command_replay_duplicate_suppressed'),
    ...manifest.diagnostics.filter((item) => item.level === 'error'),
    ...(repeatedCommand ? [diagnostic('info', 'profile_restart_replay_decision_duplicate_suppressed', commandKey)] : [])
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0 || diagnostics.some((item) => item.level === 'warning')
      ? 'guarded'
      : 'ready';
  const fingerprint = profileRestartReplayDecisionFingerprint({
    profileName: checkpoint.profileName ?? replayPlan.profileName ?? manifest.profileName,
    operation: checkpoint.operation ?? replayPlan.operation ?? manifest.operation,
    status,
    rows,
    commandKey
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const appliedCommandKeys = unique([
    ...previous.appliedCommandKeys,
    ...(repeatedCommand || !commandKey || status === 'blocked' ? [] : [commandKey]),
    ...(replayPlan.idempotency?.appliedCommandKeys ?? [])
  ]);
  const suppressedCommandKeys = unique([
    ...previous.suppressedCommandKeys,
    ...(repeatedCommand && commandKey ? [commandKey] : []),
    ...(replayPlan.idempotency?.suppressedCommandKeys ?? [])
  ]);
  const nextAction = status === 'blocked'
    ? blockedRows[0]?.nextAction ?? 'resolve_profile_restart_replay_decision'
    : status === 'guarded'
      ? 'publish_profile_restart_replay_decision_guarded'
      : changed
        ? 'publish_profile_restart_replay_decision_ready'
        : 'reuse_profile_restart_replay_decision';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_restart_replay_decision',
    profileName: checkpoint.profileName ?? replayPlan.profileName ?? manifest.profileName,
    operation: checkpoint.operation ?? replayPlan.operation ?? manifest.operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    rows,
    idempotency: {
      commandKey: commandKey || null,
      repeated: repeatedCommand,
      appliedCommandKeys,
      suppressedCommandKeys
    },
    readiness: {
      blockingReasons: unique(blockedRows.map((row) => row.id)),
      guardedReasons: unique(guardedRows.map((row) => row.id)),
      nextAction
    },
    handoff: {
      target: 'kernel.status.mailchimp.profile-restart-replay-decision',
      statusChannel: status === 'ready' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-restart-replay',
      publish: changed || status !== 'ready' || repeatedCommand,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeIdempotency: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_restart_replay_decision',
      profileName: checkpoint.profileName ?? replayPlan.profileName ?? manifest.profileName,
      operation: checkpoint.operation ?? replayPlan.operation ?? manifest.operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      appliedCommandKeys,
      suppressedCommandKeys,
      nextAction
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

export function buildProfileClientRuntimeCheckpoint(input = {}, options = {}) {
  const runtime = buildProfileClientRuntimeState(input, options);
  const persistence = buildProfilePersistenceEnvelope(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command
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
  const failure = buildProfileOperationalFailureState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command,
    attempt: options.attempt ?? options.profileAttempt,
    maxAttempts: options.maxAttempts ?? options.maxProfileAttempts
  });
  const previous = normalizeProfileRuntimeCheckpoint(
    options.previousCheckpoint ?? options.previousProfileRuntimeCheckpoint ?? input.previousCheckpoint
  );
  const state = runtime.state ?? {};
  const envelope = persistence.envelope ?? {};
  const requestKey = state.requestKey ?? envelope.requestKey ?? adoption.request?.requestKey ?? null;
  const resumeToken = state.workflow?.resumeToken ?? envelope.recovery?.resumeToken ?? adoption.request?.resumeToken ?? null;
  const statusChannel = state.workflow?.statusChannel ?? adoption.handoff?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel;
  const requestAccepted = normalizeProfileRuntimeCheckpointAcceptance(
    options.checkpointAcceptance ?? options.profileRuntimeCheckpointAcceptance ?? options.acceptance
  );
  const rows = dedupeProfileRuntimeCheckpointRows([
    profileRuntimeCheckpointRow('request_binding', {
      status: requestKey && resumeToken ? 'ready' : 'blocked',
      restartSafe: Boolean(requestKey && resumeToken),
      clientVisible: requestKey === null || resumeToken === null,
      nextAction: requestKey && resumeToken ? 'reuse_profile_request_binding' : 'rebuild_profile_request_binding',
      evidence: {
        requestKey,
        resumeToken,
        workflowState: state.workflow?.state ?? null,
        kernelJobName: state.kernelJob?.name ?? envelope.kernelJob?.name ?? null
      }
    }),
    profileRuntimeCheckpointRow('verifier_claims', {
      status: (state.verifier?.missingClaims ?? []).length > 0 ? 'blocked' : 'ready',
      restartSafe: (state.verifier?.missingClaims ?? []).length === 0,
      clientVisible: (state.verifier?.missingClaims ?? []).length > 0,
      nextAction: (state.verifier?.missingClaims ?? []).length > 0
        ? 'collect_profile_checkpoint_claims'
        : 'reuse_profile_verifier_claims',
      evidence: {
        missingClaims: state.verifier?.missingClaims ?? [],
        truthBoundaries: state.verifier?.truthBoundaries ?? []
      }
    }),
    profileRuntimeCheckpointRow('durable_memory', {
      status: (envelope.memory?.missingRestorable ?? []).length > 0 ? 'guarded' : 'ready',
      restartSafe: (envelope.memory?.missingRestorable ?? []).length === 0,
      clientVisible: (envelope.memory?.missingRestorable ?? []).length > 0,
      nextAction: (envelope.memory?.missingRestorable ?? []).length > 0
        ? 'restore_profile_checkpoint_memory'
        : 'reuse_profile_checkpoint_memory',
      evidence: {
        expectedDurable: envelope.memory?.expectedDurable ?? [],
        restored: envelope.memory?.restored ?? [],
        missingRestorable: envelope.memory?.missingRestorable ?? []
      }
    }),
    profileRuntimeCheckpointRow('runtime_adoption', {
      status: adoption.status === 'degraded' ? 'guarded' : adoption.status,
      restartSafe: adoption.restartSafe === true,
      clientVisible: adoption.status !== 'ready' || adoption.changed === true,
      nextAction: adoption.readiness?.nextAction ?? adoption.handoff?.nextAction,
      evidence: {
        sequence: adoption.sequence ?? 0,
        fingerprint: adoption.fingerprint ?? null,
        changed: adoption.changed === true,
        blockedComponents: adoption.blockedComponents ?? [],
        degradedComponents: adoption.degradedComponents ?? []
      }
    }),
    profileRuntimeCheckpointRow('failure_handoff', {
      status: failure.status === 'degraded' ? 'guarded' : failure.status,
      restartSafe: failure.restartSafe === true || failure.status === 'ready',
      clientVisible: failure.status !== 'ready' || failure.handoff?.publish === true,
      nextAction: failure.handoff?.resumeAction ?? failure.handoff?.nextAction,
      evidence: {
        retryable: failure.retryable === true,
        nextRetry: failure.nextRetry,
        blockingReasons: failure.failureState?.blockingReasons ?? [],
        degradedReasons: failure.failureState?.degradedReasons ?? []
      }
    }),
    profileRuntimeCheckpointRow('status_channel', {
      status: statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel ? 'ready' : 'blocked',
      restartSafe: statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      clientVisible: statusChannel !== DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      nextAction: statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
        ? 'publish_profile_checkpoint_to_kernel_status'
        : 'route_profile_checkpoint_to_kernel_status',
      evidence: {
        statusChannel,
        expectedStatusChannel: DEFAULT_MAILCHIMP_PROFILE.statusChannel,
        target: state.workflow?.target ?? DEFAULT_MAILCHIMP_PROFILE.handoffTarget
      }
    })
  ]);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded' || row.restartSafe === false);
  const awaitingAcceptance = rows.filter((row) => row.clientVisible && !requestAccepted.acceptedRows.includes(row.id));
  const diagnostics = [
    ...runtime.diagnostics,
    ...persistence.diagnostics.filter((item) => item.level === 'error' || options.includeProfileCheckpointWarnings === true),
    ...adoption.diagnostics.filter((item) => item.level === 'error'),
    ...failure.diagnostics.filter((item) => item.level === 'error'),
    ...(requestAccepted.requireExplicitAcceptance
      ? awaitingAcceptance.map((row) => diagnostic('error', 'profile_runtime_checkpoint_acceptance_missing', row.id))
      : awaitingAcceptance.map((row) => diagnostic('warning', 'profile_runtime_checkpoint_acceptance_pending', row.id)))
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockedRows.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = profileRuntimeCheckpointFingerprint({
    profileName: state.profileName ?? adoption.profileName ?? 'mailchimp.default',
    operation: state.operation ?? adoption.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    requestKey,
    resumeToken,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const nextAction = status === 'blocked'
    ? 'resolve_profile_runtime_checkpoint_blockers'
    : status === 'guarded'
      ? 'publish_profile_runtime_checkpoint_guarded'
      : changed
        ? 'publish_profile_runtime_checkpoint_ready'
        : 'reuse_profile_runtime_checkpoint';

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_client_runtime_checkpoint',
    profileName: state.profileName ?? adoption.profileName ?? 'mailchimp.default',
    operation: state.operation ?? adoption.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
    sequence,
    fingerprint,
    changed,
    request: {
      requestKey,
      resumeToken,
      workflowState: state.workflow?.state ?? null,
      statusChannel
    },
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      visibleRows: rows.filter((row) => row.clientVisible).length,
      awaitingAcceptance: awaitingAcceptance.length,
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: unique(blockedRows.map((row) => row.id)),
      guardedReasons: unique(guardedRows.map((row) => row.id)),
      nextAction
    },
    handoff: {
      target: 'mailchimp.client.workflow.profile-runtime-checkpoint',
      statusChannel: status === 'ready' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-runtime-checkpoint',
      publish: changed || status !== 'ready' || rows.some((row) => row.clientVisible),
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: true,
      includeRequestState: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_client_runtime_checkpoint',
      profileName: state.profileName ?? adoption.profileName ?? 'mailchimp.default',
      operation: state.operation ?? adoption.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe === true),
      sequence,
      fingerprint,
      changed,
      requestKey,
      resumeToken,
      blockedRows: blockedRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
      awaitingAcceptance: awaitingAcceptance.map((row) => row.id).sort(),
      nextAction
    },
    diagnostics
  };
}

export function buildProfileClientResumeHandoffContract(input = {}, options = {}) {
  const runtime = buildProfileClientRuntimeState(input, options);
  const persistence = buildProfilePersistenceEnvelope(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command
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
  const resolution = buildProfileClientResolutionBrief(input, {
    ...options,
    previousResolutionBrief: options.previousResolutionBrief ?? options.previousProfileClientResolutionBrief,
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
  const state = runtime.state ?? {};
  const envelope = persistence.envelope ?? {};
  const requestKey = state.requestKey ?? adoption.request?.requestKey ?? DEFAULT_CLIENT_RUNTIME.requestKey;
  const resumeToken = state.workflow?.resumeToken ?? adoption.request?.resumeToken ?? null;
  const blockers = unique([
    ...(state.verifier?.missingClaims ?? []).map((claim) => `claim:${claim}`),
    ...(envelope.memory?.missingRestorable ?? []).map((name) => `memory:${name}`),
    ...(adoption.readiness?.blockingReasons ?? []),
    ...(resolution.readiness?.blockingReasons ?? [])
  ]);
  const guards = unique([
    ...(state.memory?.missingDurableMemory ?? []).map((name) => `durable_memory:${name}`),
    ...(adoption.readiness?.degradedReasons ?? []),
    ...(resolution.readiness?.guardedReasons ?? [])
  ]);
  const diagnostics = [
    ...runtime.diagnostics,
    ...persistence.diagnostics.filter((item) => item.level === 'error' || options.includeProfileResumeWarnings === true),
    ...adoption.diagnostics.filter((item) => item.level === 'error'),
    ...resolution.diagnostics.filter((item) => item.level === 'error')
  ];
  const status = diagnostics.some((item) => item.level === 'error') || blockers.length > 0
    ? 'blocked'
    : diagnostics.some((item) => item.level === 'warning') || guards.length > 0 || adoption.status !== 'ready'
      ? 'guarded'
      : 'ready';
  const restartSafe = status === 'ready'
    && persistence.envelope?.restartSafe === true
    && adoption.restartSafe === true
    && resolution.restartSafe === true;
  const fingerprint = profileStateFingerprint({
    kind: 'client_resume_handoff',
    profileName: state.profileName ?? adoption.profileName,
    operation: state.operation ?? adoption.operation,
    requestKey,
    resumeToken,
    status,
    blockers,
    guards
  });

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_client_resume_handoff',
    profileName: state.profileName ?? adoption.profileName ?? 'mailchimp.default',
    operation: state.operation ?? adoption.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    restartSafe,
    fingerprint,
    request: {
      requestKey,
      resumeToken,
      workflowState: state.workflow?.state ?? adoption.request?.workflowState ?? null,
      persistedState: envelope.workflow?.persistedState ?? null,
      statusVisibility: state.workflow?.statusVisibility ?? DEFAULT_CLIENT_RUNTIME.statusVisibility
    },
    gates: {
      resumeAllowed: restartSafe && blockers.length === 0,
      clientVisible: status !== 'ready' || adoption.changed === true,
      statusChannel: state.workflow?.statusChannel ?? adoption.handoff?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel
    },
    readiness: {
      blockingReasons: blockers,
      guardedReasons: guards,
      nextAction: status === 'blocked'
        ? 'resolve_profile_resume_handoff_blockers'
        : status === 'guarded'
          ? 'publish_profile_resume_handoff_guarded'
          : 'publish_profile_resume_handoff_ready'
    },
    handoff: {
      target: 'mailchimp.client.workflow.resume',
      statusChannel: state.workflow?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
        ? DEFAULT_MAILCHIMP_PROFILE.statusChannel
        : 'local.status.profile-resume',
      publish: status !== 'ready' || adoption.changed === true || persistence.envelope?.idempotency?.applied === true,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRequestState: true,
      includeResolution: status !== 'ready',
      nextAction: status === 'ready' ? 'publish_profile_resume_handoff_ready' : 'review_profile_resume_handoff'
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_client_resume_handoff',
      profileName: state.profileName ?? adoption.profileName ?? 'mailchimp.default',
      operation: state.operation ?? adoption.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
      status,
      restartSafe,
      fingerprint,
      requestKey,
      resumeToken,
      blockingReasons: blockers,
      guardedReasons: guards,
      nextAction: status === 'ready' ? 'publish_profile_resume_handoff_ready' : 'review_profile_resume_handoff'
    },
    diagnostics
  };
}

export function buildProfileClientResolutionBrief(input = {}, options = {}) {
  const runtime = buildProfileClientRuntimeState(input, options);
  const failure = buildProfileOperationalFailureState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    command: options.profileCommand ?? options.command,
    attempt: options.attempt ?? options.profileAttempt,
    maxAttempts: options.maxAttempts ?? options.maxProfileAttempts
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
  const requestKey = runtime.state?.requestKey ?? adoption.request?.requestKey ?? DEFAULT_CLIENT_RUNTIME.requestKey;
  const resumeToken = runtime.state?.workflow?.resumeToken ?? adoption.request?.resumeToken ?? null;
  const previous = normalizeProfileResolutionBrief(options.previousResolutionBrief ?? options.previousProfileResolutionBrief ?? input.previousResolutionBrief);
  const issueRows = [
    ...((runtime.state?.verifier?.missingClaims ?? []).map((claim) => ({
      id: `claim:${claim}`,
      source: 'profile_verifier',
      subject: claim,
      status: 'blocked',
      severity: 'error',
      clientVisible: true,
      nextAction: 'collect_required_claim',
      evidence: {
        requestKey,
        truthBoundaries: runtime.state?.verifier?.truthBoundaries ?? []
      }
    }))),
    ...((runtime.state?.memory?.missingDurableMemory ?? []).map((name) => ({
      id: `memory:${name}`,
      source: 'profile_memory',
      subject: name,
      status: failure.status === 'blocked' ? 'blocked' : 'degraded',
      severity: failure.status === 'blocked' ? 'error' : 'warning',
      clientVisible: true,
      nextAction: 'restore_profile_memory_before_resume',
      evidence: {
        requestKey,
        resumeToken,
        retention: runtime.state?.memory?.bindings?.find((item) => item.name === name)?.retention ?? null
      }
    }))),
    ...((failure.actionableErrors ?? []).map((item) => ({
      id: `failure:${item.code}:${item.subject}`,
      source: 'profile_failure',
      subject: item.subject,
      status: failure.status,
      severity: failure.status === 'blocked' ? 'error' : 'warning',
      clientVisible: true,
      nextAction: item.code,
      evidence: {
        action: item.action,
        retryable: failure.retryable,
        nextRetry: failure.nextRetry
      }
    }))),
    ...((adoption.rows ?? [])
      .filter((row) => row.status !== 'ready' || row.restartSafe === false || row.adopted !== true)
      .map((row) => ({
        id: `adoption:${row.component}`,
        source: 'profile_runtime_adoption',
        subject: row.component,
        status: row.status === 'ready' && row.restartSafe === false ? 'degraded' : row.status,
        severity: row.status === 'blocked' ? 'error' : 'warning',
        clientVisible: true,
        nextAction: row.nextAction ?? adoption.readiness?.nextAction ?? 'review_profile_runtime_adoption',
        evidence: {
          restartSafe: row.restartSafe,
          adopted: row.adopted,
          componentEvidence: row.evidence ?? {}
        }
      })))
  ];
  const rows = dedupeProfileResolutionRows(issueRows).sort((left, right) => (
    profileHealthSeverityRank(right.severity) - profileHealthSeverityRank(left.severity)
    || left.source.localeCompare(right.source)
    || left.subject.localeCompare(right.subject)
  ));
  const blockingRows = rows.filter((row) => row.status === 'blocked' || row.severity === 'error');
  const guardedRows = rows.filter((row) => row.status !== 'blocked' && row.severity !== 'error');
  const status = blockingRows.length > 0 || failure.status === 'blocked' || adoption.status === 'blocked'
    ? 'blocked'
    : guardedRows.length > 0 || failure.status === 'degraded' || adoption.status === 'degraded'
      ? 'guarded'
      : 'ready';
  const fingerprint = profileClientResolutionFingerprint({
    profileName: adoption.profileName ?? runtime.state?.profileName,
    operation: adoption.operation ?? runtime.state?.operation,
    requestKey,
    resumeToken,
    status,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const timeline = [
    ...previous.timeline,
    ...(changed || previous.timeline.length === 0 ? [{
      sequence,
      timestamp: clean(options.now ?? options.timestamp) || null,
      status,
      fingerprint,
      requestKey,
      blocked: blockingRows.length,
      guarded: guardedRows.length
    }] : [])
  ].slice(-toPositiveInteger(options.resolutionBriefHistoryLimit ?? options.historyLimit, 12));
  const nextAction = status === 'blocked'
    ? 'resolve_profile_client_runtime_blockers'
    : status === 'guarded'
      ? 'publish_profile_client_runtime_guarded'
      : changed
        ? 'publish_profile_client_runtime_ready'
        : 'reuse_profile_client_runtime_resolution';
  const diagnostics = [
    ...(runtime.diagnostics ?? []),
    ...(failure.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(adoption.diagnostics ?? []).filter((item) => item.level === 'error')
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_client_resolution_brief',
    profileName: adoption.profileName ?? runtime.state?.profileName ?? 'mailchimp.default',
    operation: adoption.operation ?? runtime.state?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    restartSafe: status === 'ready' && runtime.ok === true && adoption.restartSafe === true && failure.restartSafe !== false,
    sequence,
    fingerprint,
    changed,
    request: {
      requestKey,
      resumeToken,
      workflowState: runtime.state?.workflow?.state ?? adoption.request?.workflowState ?? null,
      statusChannel: runtime.state?.workflow?.statusChannel ?? adoption.handoff?.statusChannel ?? DEFAULT_MAILCHIMP_PROFILE.statusChannel
    },
    rows,
    readiness: {
      blockingReasons: unique(blockingRows.map((row) => row.subject)),
      guardedReasons: unique(guardedRows.map((row) => row.subject)),
      nextAction
    },
    history: {
      sequence,
      timeline,
      statusCounts: timeline.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] ?? 0) + 1;
        return counts;
      }, {})
    },
    handoff: {
      target: 'mailchimp.client.workflow.profile-resolution',
      statusChannel: runtime.state?.workflow?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
        ? DEFAULT_MAILCHIMP_PROFILE.statusChannel
        : 'local.status.profile-resolution',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: rows.length > 0,
      includeRequestState: true,
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_client_resolution_brief',
      profileName: adoption.profileName ?? runtime.state?.profileName ?? 'mailchimp.default',
      operation: adoption.operation ?? runtime.state?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
      status,
      restartSafe: status === 'ready' && adoption.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      blockedRows: blockingRows.map((row) => row.id).sort(),
      guardedRows: guardedRows.map((row) => row.id).sort(),
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

export function buildProfileBoundaryReleaseDecision(input = {}, options = {}) {
  const runtime = deriveProfileRuntimeContract(input, options);
  const evidence = buildProfileBoundaryEvidencePacket(input, {
    ...options,
    acceptance: options.acceptance ?? options.boundaryAcceptance ?? options.profileBoundaryAcceptance
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
  const boundary = runtime.contract?.boundary ?? evidence.scope ?? {};
  const releasePolicy = normalizeProfileBoundaryReleasePolicy(options.releasePolicy ?? input.releasePolicy);
  const hardBlockers = unique([
    ...evidence.readiness.blockingReasons,
    ...(runtime.ok === false ? ['profile_runtime_contract'] : []),
    ...(boundary.tenantIsolation === 'blocked' ? ['tenant_boundary'] : []),
    ...(releasePolicy.requireReadyLifecycle && lifecycle.status !== 'enabled' ? [`profile_lifecycle:${lifecycle.status}`] : []),
    ...(releasePolicy.requireKernelAudit && boundary.auditHandoff?.target !== 'kernel.audit.mailchimp.profile'
      ? ['profile_audit_handoff']
      : [])
  ]);
  const guardedReasons = unique([
    ...evidence.readiness.degradedReasons,
    ...(boundary.workspaceIsolation === 'advisory' ? ['workspace_boundary_advisory'] : []),
    ...((boundary.deniedCapabilities ?? []).map((capability) => `capability:${capability}`)),
    ...((boundary.deniedPermissions ?? []).map((permission) => `permission:${permission}`)),
    ...(['paused', 'retry_scheduled', 'enabled_degraded'].includes(lifecycle.status) ? [`profile_lifecycle:${lifecycle.status}`] : []),
    ...(releasePolicy.allowPermissionAdvisories ? [] : (boundary.deniedPermissions ?? []).map((permission) => `permission_block:${permission}`))
  ]);
  const blockedByPolicy = hardBlockers.length > 0
    || (!releasePolicy.allowPermissionAdvisories && (boundary.deniedPermissions ?? []).length > 0)
    || (!releasePolicy.allowCapabilityAdvisories && (boundary.deniedCapabilities ?? []).length > 0);
  const status = blockedByPolicy
    ? 'blocked'
    : guardedReasons.length > 0
      ? 'guarded'
      : 'released';
  const rows = [
    {
      id: 'runtime_contract',
      status: runtime.ok ? 'released' : 'blocked',
      required: true,
      evidence: {
        operation: runtime.contract?.operation ?? evidence.operation,
        capabilityRefs: runtime.contract?.kernelJob?.capabilityRefs ?? [],
        memoryRefs: runtime.contract?.kernelJob?.memoryRefs ?? []
      },
      nextAction: runtime.ok ? 'include_profile_runtime_contract' : 'repair_profile_runtime_contract'
    },
    {
      id: 'tenant_boundary',
      status: boundary.tenantIsolation === 'blocked' ? 'blocked' : 'released',
      required: true,
      evidence: {
        tenantId: boundary.tenantId ?? evidence.scope.tenantId,
        requestedTenantId: boundary.requestedTenantId ?? evidence.scope.requestedTenantId,
        isolation: boundary.tenantIsolation ?? 'unknown'
      },
      nextAction: boundary.tenantIsolation === 'blocked'
        ? 'block_profile_cross_tenant_release'
        : 'release_profile_tenant_scope'
    },
    {
      id: 'workspace_boundary',
      status: boundary.workspaceIsolation === 'advisory' ? 'guarded' : 'released',
      required: false,
      evidence: {
        workspaceId: boundary.workspaceId ?? evidence.scope.workspaceId,
        requestedWorkspaceId: boundary.requestedWorkspaceId ?? evidence.scope.requestedWorkspaceId,
        isolation: boundary.workspaceIsolation ?? 'unknown'
      },
      nextAction: boundary.workspaceIsolation === 'advisory'
        ? 'publish_profile_workspace_release_advisory'
        : 'release_profile_workspace_scope'
    },
    {
      id: 'role_permissions',
      status: (boundary.deniedPermissions ?? []).length > 0
        ? releasePolicy.allowPermissionAdvisories ? 'guarded' : 'blocked'
        : 'released',
      required: true,
      evidence: {
        role: boundary.role ?? evidence.scope.role,
        permissionMode: boundary.permissionMode ?? evidence.scope.permissionMode,
        deniedPermissions: boundary.deniedPermissions ?? []
      },
      nextAction: (boundary.deniedPermissions ?? []).length > 0
        ? releasePolicy.allowPermissionAdvisories
          ? 'publish_profile_permission_release_advisory'
          : 'remove_profile_denied_permissions'
        : 'release_profile_role_permissions'
    },
    {
      id: 'capability_boundary',
      status: (boundary.deniedCapabilities ?? []).length > 0
        ? releasePolicy.allowCapabilityAdvisories ? 'guarded' : 'blocked'
        : 'released',
      required: true,
      evidence: {
        requestedCapabilities: boundary.requestedCapabilities ?? [],
        allowedCapabilities: boundary.allowedCapabilities ?? [],
        deniedCapabilities: boundary.deniedCapabilities ?? []
      },
      nextAction: (boundary.deniedCapabilities ?? []).length > 0
        ? releasePolicy.allowCapabilityAdvisories
          ? 'publish_profile_capability_release_advisory'
          : 'remove_profile_denied_capabilities'
        : 'release_profile_capability_boundary'
    },
    {
      id: 'audit_handoff',
      status: boundary.auditHandoff?.target === 'kernel.audit.mailchimp.profile' ? 'released' : 'blocked',
      required: releasePolicy.requireKernelAudit,
      evidence: boundary.auditHandoff ?? evidence.auditHandoff,
      nextAction: boundary.auditHandoff?.target === 'kernel.audit.mailchimp.profile'
        ? 'publish_profile_boundary_release_audit'
        : 'route_profile_boundary_release_to_kernel_audit'
    }
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked' && row.required !== false);
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const diagnostics = [
    ...evidence.diagnostics,
    ...blockedRows.map((row) => diagnostic('error', 'profile_boundary_release_blocked', row.id)),
    ...guardedRows.map((row) => diagnostic('warning', 'profile_boundary_release_guarded', row.id))
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    profileName: evidence.profileName,
    operation: evidence.operation,
    status,
    restartSafe: status === 'released' && evidence.restartSafe === true && runtime.ok === true,
    releasePolicy,
    scope: evidence.scope,
    rows,
    readiness: {
      blockingReasons: unique([...hardBlockers, ...blockedRows.map((row) => row.id)]),
      guardedReasons: unique([...guardedReasons, ...guardedRows.map((row) => row.id)]),
      nextAction: status === 'blocked'
        ? firstProfileBoundaryReleaseAction(blockedRows, 'resolve_profile_boundary_release_blockers')
        : status === 'guarded'
          ? firstProfileBoundaryReleaseAction(guardedRows, 'publish_profile_boundary_release_advisory')
          : 'publish_profile_boundary_release'
    },
    auditHandoff: {
      target: 'kernel.audit.mailchimp.profile-release',
      subject: `${evidence.scope.tenantId ?? 'unknown'}/${evidence.scope.workspaceId ?? 'unknown'}/${evidence.operation}`,
      decision: status,
      includeRows: status !== 'released',
      includeEvidenceFingerprint: evidence.fingerprint
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_boundary_release_decision',
      status,
      restartSafe: status === 'released' && evidence.restartSafe === true,
      profileName: evidence.profileName,
      operation: evidence.operation,
      tenantId: evidence.scope.tenantId,
      workspaceId: evidence.scope.workspaceId,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      evidenceFingerprint: evidence.fingerprint,
      nextAction: status === 'released' ? 'publish_profile_boundary_release' : 'review_profile_boundary_release'
    },
    diagnostics
  };
}

export function buildProfileTenantHandoffBoundaryPacket(input = {}, options = {}) {
  const release = buildProfileBoundaryReleaseDecision(input, {
    ...options,
    previousLifecycle: options.previousLifecycle ?? options.previousProfileLifecycle,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    acceptance: options.acceptance ?? options.profileBoundaryHandoffAcceptance ?? options.profileBoundaryReleaseAcceptance,
    releasePolicy: options.releasePolicy ?? options.profileBoundaryReleasePolicy
  });
  const runtime = deriveProfileRuntimeContract(input, options);
  const previous = normalizeProfileTenantHandoffBoundary(options.previousPacket ?? options.previousProfileTenantHandoffBoundary);
  const now = clean(options.now ?? options.timestamp) || null;
  const requireKernelStatus = options.requireKernelStatus !== false;
  const statusChannel = clean(runtime.contract?.statusHandoff?.statusChannel ?? release.rows
    .find((row) => row.id === 'audit_handoff')?.evidence?.statusChannel);
  const rows = [
    {
      id: 'profile_release',
      source: 'profile_boundary_release',
      status: release.status === 'released' ? 'released' : release.status === 'guarded' ? 'guarded' : 'blocked',
      required: true,
      nextAction: release.readiness?.nextAction ?? release.exportSummary?.nextAction ?? 'review_profile_boundary_release',
      evidence: {
        restartSafe: release.restartSafe === true,
        blockedRows: release.exportSummary?.blockedRows ?? [],
        guardedRows: release.exportSummary?.guardedRows ?? []
      }
    },
    {
      id: 'profile_runtime_boundary',
      source: 'profile_runtime_contract',
      status: runtime.ok ? 'released' : 'blocked',
      required: true,
      nextAction: runtime.ok ? 'publish_profile_runtime_boundary' : 'repair_profile_runtime_contract',
      evidence: {
        tenantId: runtime.contract?.boundary?.tenantId ?? release.scope?.tenantId ?? null,
        workspaceId: runtime.contract?.boundary?.workspaceId ?? release.scope?.workspaceId ?? null,
        role: runtime.contract?.boundary?.role ?? release.scope?.role ?? null,
        permissionMode: runtime.contract?.boundary?.permissionMode ?? release.scope?.permissionMode ?? null
      }
    },
    {
      id: 'profile_status_channel',
      source: 'profile_status_handoff',
      status: requireKernelStatus && statusChannel !== DEFAULT_MAILCHIMP_PROFILE.statusChannel ? 'blocked' : 'released',
      required: requireKernelStatus,
      nextAction: statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel
        ? 'publish_profile_kernel_status_handoff'
        : 'route_profile_status_handoff_to_kernel',
      evidence: {
        statusChannel: statusChannel || null,
        expectedStatusChannel: DEFAULT_MAILCHIMP_PROFILE.statusChannel
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.status === 'blocked' && row.required !== false);
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'released';
  const fingerprint = profileTenantHandoffBoundaryFingerprint({
    profileName: release.profileName,
    operation: release.operation,
    status,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...release.diagnostics,
    ...(runtime.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => diagnostic('error', 'profile_tenant_handoff_boundary_blocked', row.id)),
    ...guardedRows.map((row) => diagnostic('warning', 'profile_tenant_handoff_boundary_guarded', row.id))
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_tenant_handoff_boundary',
    profileName: release.profileName,
    operation: release.operation,
    status,
    restartSafe: status === 'released' && release.restartSafe === true,
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    scope: {
      tenantId: release.scope?.tenantId ?? runtime.contract?.boundary?.tenantId ?? null,
      workspaceId: release.scope?.workspaceId ?? runtime.contract?.boundary?.workspaceId ?? null,
      role: release.scope?.role ?? runtime.contract?.boundary?.role ?? null,
      permissionMode: release.scope?.permissionMode ?? runtime.contract?.boundary?.permissionMode ?? null
    },
    rows,
    handoff: {
      target: 'kernel.status.mailchimp.profile-boundary',
      statusChannel: status === 'released' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-boundary',
      publish: changed || status !== 'released',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      nextAction: status === 'blocked'
        ? 'resolve_profile_tenant_handoff_boundary'
        : status === 'guarded'
          ? 'publish_profile_tenant_handoff_guarded'
          : 'publish_profile_tenant_handoff_boundary'
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_tenant_handoff_boundary',
      status,
      restartSafe: status === 'released' && release.restartSafe === true,
      sequence,
      fingerprint,
      changed,
      tenantId: release.scope?.tenantId ?? null,
      workspaceId: release.scope?.workspaceId ?? null,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      nextAction: status === 'released' ? 'publish_profile_tenant_handoff_boundary' : 'review_profile_tenant_handoff_boundary'
    },
    diagnostics
  };
}

export function buildProfileTenantBoundaryIntentPacket(input = {}, options = {}) {
  const compiled = compileProfileDeclaration(input, options);
  const boundary = compiled.profile?.boundary ?? {};
  const permissionMatrix = buildProfileTenantPermissionMatrix(input, options);
  const tenantHandoff = buildProfileTenantHandoffBoundaryPacket(input, {
    ...options,
    previousPacket: options.previousPacket ?? options.previousProfileTenantHandoffBoundary,
    acceptance: options.acceptance ?? options.profileBoundaryIntentAcceptance
  });
  const requestedCapabilities = unique([
    ...(compiled.profile?.capabilities ?? []),
    ...parseList(options.requestedCapabilities ?? input.requestedCapabilities)
  ]);
  const requestedPermissions = unique([
    ...(boundary.declaredPermissions ?? []),
    ...parseList(options.requestedPermissions ?? input.requestedPermissions)
  ]);
  const tenantId = clean(options.tenantId ?? boundary.tenantId);
  const workspaceId = clean(options.workspaceId ?? boundary.workspaceId);
  const requestedTenantId = clean(options.requestedTenantId ?? boundary.requestedTenantId);
  const requestedWorkspaceId = clean(options.requestedWorkspaceId ?? boundary.requestedWorkspaceId);
  const crossTenant = Boolean(requestedTenantId && tenantId && requestedTenantId !== tenantId);
  const crossWorkspace = Boolean(requestedWorkspaceId && workspaceId && requestedWorkspaceId !== workspaceId);
  const allowedCapabilities = permissionMatrix.capabilityGrant?.allowed ?? boundary.allowedCapabilities ?? [];
  const allowedPermissions = permissionMatrix.permissionGrant?.allowed ?? boundary.allowedPermissions ?? [];
  const deniedCapabilities = requestedCapabilities.filter((capability) => !allowedCapabilities.includes(capability));
  const deniedPermissions = requestedPermissions.filter((permission) => !allowedPermissions.includes(permission));
  const rows = [
    {
      id: 'tenant_intent',
      status: crossTenant || !tenantId ? 'blocked' : 'ready',
      required: true,
      nextAction: crossTenant ? 'reject_profile_cross_tenant_intent' : !tenantId ? 'declare_profile_tenant_scope' : 'retain_profile_tenant_intent',
      evidence: { tenantId: tenantId || null, requestedTenantId: requestedTenantId || null }
    },
    {
      id: 'workspace_intent',
      status: crossWorkspace ? 'guarded' : !workspaceId ? 'blocked' : 'ready',
      required: true,
      nextAction: crossWorkspace ? 'confirm_profile_workspace_intent' : !workspaceId ? 'declare_profile_workspace_scope' : 'retain_profile_workspace_intent',
      evidence: { workspaceId: workspaceId || null, requestedWorkspaceId: requestedWorkspaceId || null }
    },
    {
      id: 'role_capability_intent',
      status: deniedCapabilities.length > 0 ? (boundary.permissionMode === 'permissive' ? 'guarded' : 'blocked') : 'ready',
      required: true,
      nextAction: deniedCapabilities.length > 0 ? 'reduce_profile_capability_request' : 'retain_profile_role_capabilities',
      evidence: { role: boundary.role ?? null, deniedCapabilities, allowedCapabilities }
    },
    {
      id: 'permission_intent',
      status: deniedPermissions.length > 0 ? (boundary.permissionMode === 'permissive' ? 'guarded' : 'blocked') : 'ready',
      required: true,
      nextAction: deniedPermissions.length > 0 ? 'reduce_profile_permission_request' : 'retain_profile_permissions',
      evidence: { permissionMode: boundary.permissionMode ?? null, deniedPermissions, allowedPermissions }
    },
    {
      id: 'audit_handoff_intent',
      status: tenantHandoff.status === 'blocked' ? 'blocked' : tenantHandoff.status === 'guarded' ? 'guarded' : 'ready',
      required: true,
      nextAction: tenantHandoff.handoff?.nextAction ?? 'publish_profile_tenant_handoff_boundary',
      evidence: {
        target: tenantHandoff.handoff?.target ?? null,
        statusChannel: tenantHandoff.handoff?.statusChannel ?? null,
        fingerprint: tenantHandoff.fingerprint ?? null
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.required && row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0 ? 'blocked' : guardedRows.length > 0 ? 'guarded' : 'ready';
  const diagnostics = [
    ...compiled.diagnostics,
    ...permissionMatrix.diagnostics.filter((item) => item.level === 'error' || options.includeProfileBoundaryIntentWarnings === true),
    ...tenantHandoff.diagnostics.filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => diagnostic('error', 'profile_boundary_intent_blocked', row.id)),
    ...guardedRows.map((row) => diagnostic('warning', 'profile_boundary_intent_guarded', row.id))
  ];
  const fingerprint = [
    'profile_boundary_intent',
    compiled.profile?.name,
    compiled.profile?.operation,
    status,
    tenantId,
    workspaceId,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.nextAction,
      ...(row.evidence.deniedCapabilities ?? []),
      ...(row.evidence.deniedPermissions ?? [])
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_tenant_boundary_intent',
    profileName: compiled.profile?.name ?? 'mailchimp.default',
    operation: compiled.profile?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    restartSafe: status === 'ready' && tenantHandoff.restartSafe === true,
    fingerprint,
    scope: { tenantId: tenantId || null, workspaceId: workspaceId || null, role: boundary.role ?? null, permissionMode: boundary.permissionMode ?? null },
    rows,
    validationSummary: {
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      deniedCapabilities: deniedCapabilities.length,
      deniedPermissions: deniedPermissions.length,
      crossTenant: crossTenant ? 1 : 0,
      crossWorkspace: crossWorkspace ? 1 : 0
    },
    handoff: {
      target: 'kernel.audit.mailchimp.profile-boundary-intent',
      statusChannel: status === 'ready' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-boundary-intent',
      publish: status !== 'ready' || tenantHandoff.changed === true,
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      nextAction: status === 'blocked' ? 'resolve_profile_boundary_intent' : status === 'guarded' ? 'publish_profile_boundary_intent_guarded' : 'publish_profile_boundary_intent'
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_tenant_boundary_intent',
      status,
      restartSafe: status === 'ready' && tenantHandoff.restartSafe === true,
      fingerprint,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      nextAction: status === 'ready' ? 'publish_profile_boundary_intent' : 'review_profile_boundary_intent'
    },
    diagnostics
  };
}

export function buildProfileTenantLaunchGuardContract(input = {}, options = {}) {
  const compiled = compileProfileDeclaration(input, options);
  const runtime = deriveProfileRuntimeContract(input, options);
  const clientRuntime = buildProfileClientRuntimeState(input, options);
  const permissionMatrix = buildProfileTenantPermissionMatrix(input, options);
  const boundaryEvidence = buildProfileBoundaryEvidencePacket(input, {
    ...options,
    previousEvidence: options.previousEvidence ?? options.previousProfileBoundaryEvidence,
    acceptance: options.acceptance ?? options.profileBoundaryAcceptance ?? options.profileBoundaryEvidenceAcceptance
  });
  const boundaryRelease = buildProfileBoundaryReleaseDecision(input, {
    ...options,
    previousEvidence: options.previousEvidence ?? options.previousProfileBoundaryEvidence,
    acceptance: options.releaseAcceptance
      ?? options.profileBoundaryReleaseAcceptance
      ?? options.profileBoundaryAcceptance
      ?? options.profileBoundaryEvidenceAcceptance,
    releasePolicy: options.releasePolicy ?? options.profileBoundaryReleasePolicy
  });
  const tenantHandoff = buildProfileTenantHandoffBoundaryPacket(input, {
    ...options,
    previousPacket: options.previousPacket ?? options.previousProfileTenantHandoffBoundary,
    acceptance: options.handoffAcceptance
      ?? options.profileBoundaryHandoffAcceptance
      ?? options.profileBoundaryReleaseAcceptance,
    releasePolicy: options.releasePolicy ?? options.profileBoundaryReleasePolicy
  });
  const previous = normalizeProfileTenantLaunchGuard(options.previousGuard ?? options.previousProfileTenantLaunchGuard);
  const now = clean(options.now ?? options.timestamp) || null;
  const profile = compiled.profile ?? {};
  const boundary = profile.boundary ?? runtime.contract?.boundary ?? {};
  const clientBoundary = clientRuntime.state?.boundary ?? {};
  const requestedTenantId = boundary.requestedTenantId ?? null;
  const requestedWorkspaceId = boundary.requestedWorkspaceId ?? null;
  const tenantMismatch = Boolean(requestedTenantId && requestedTenantId !== boundary.tenantId);
  const workspaceMismatch = Boolean(requestedWorkspaceId && requestedWorkspaceId !== boundary.workspaceId);
  const statusChannel = clean(profile.handoff?.statusChannel ?? runtime.contract?.statusHandoff?.statusChannel);
  const kernelStatusReady = statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel;
  const requireExplicitBoundaryRelease = options.requireExplicitBoundaryRelease === true
    || options.requireProfileBoundaryRelease === true;
  const requireKernelStatus = options.requireKernelStatus !== false;
  const rows = [
    {
      id: 'tenant_scope',
      label: 'Tenant scope',
      status: tenantMismatch || !boundary.tenantId ? 'blocked' : 'ready',
      required: true,
      nextAction: tenantMismatch
        ? 'reject_profile_cross_tenant_launch'
        : !boundary.tenantId
          ? 'declare_profile_tenant'
          : 'retain_profile_tenant_scope',
      evidence: {
        tenantId: boundary.tenantId ?? null,
        requestedTenantId,
        tenantIsolation: boundary.tenantIsolation ?? 'unknown'
      }
    },
    {
      id: 'workspace_scope',
      label: 'Workspace scope',
      status: workspaceMismatch ? 'guarded' : !boundary.workspaceId ? 'blocked' : 'ready',
      required: true,
      nextAction: workspaceMismatch
        ? 'confirm_profile_workspace_scope'
        : !boundary.workspaceId
          ? 'declare_profile_workspace'
          : 'retain_profile_workspace_scope',
      evidence: {
        workspaceId: boundary.workspaceId ?? null,
        requestedWorkspaceId,
        workspaceIsolation: boundary.workspaceIsolation ?? 'unknown'
      }
    },
    {
      id: 'role_permissions',
      label: 'Role permissions',
      status: (boundary.deniedCapabilities?.length ?? 0) > 0 || (boundary.deniedPermissions?.length ?? 0) > 0
        ? boundary.permissionMode === 'permissive' ? 'guarded' : 'blocked'
        : permissionMatrix.status === 'blocked' ? 'blocked' : permissionMatrix.status === 'degraded' ? 'guarded' : 'ready',
      required: true,
      nextAction: (boundary.deniedCapabilities?.length ?? 0) > 0 || (boundary.deniedPermissions?.length ?? 0) > 0
        ? 'resolve_profile_role_permission_boundary'
        : 'publish_profile_role_permission_boundary',
      evidence: {
        role: boundary.role ?? null,
        permissionMode: boundary.permissionMode ?? null,
        deniedCapabilities: boundary.deniedCapabilities ?? [],
        deniedPermissions: boundary.deniedPermissions ?? [],
        matrixStatus: permissionMatrix.status ?? 'unknown'
      }
    },
    {
      id: 'status_channel',
      label: 'Kernel status channel',
      status: requireKernelStatus && !kernelStatusReady ? 'blocked' : 'ready',
      required: requireKernelStatus,
      nextAction: kernelStatusReady ? 'publish_profile_status_channel' : 'route_profile_status_to_kernel',
      evidence: {
        statusChannel: statusChannel || null,
        expectedStatusChannel: DEFAULT_MAILCHIMP_PROFILE.statusChannel,
        clientResumeGuard: clientBoundary.resumeGuard ?? null
      }
    },
    {
      id: 'boundary_evidence',
      label: 'Boundary evidence',
      status: boundaryEvidence.status === 'blocked'
        ? 'blocked'
        : boundaryEvidence.status === 'degraded'
          ? 'guarded'
          : 'ready',
      required: true,
      nextAction: boundaryEvidence.readiness?.nextAction ?? boundaryEvidence.exportSummary?.nextAction ?? 'publish_profile_boundary_evidence',
      evidence: {
        sequence: boundaryEvidence.sequence ?? 0,
        fingerprint: boundaryEvidence.fingerprint ?? null,
        awaitingAcceptance: boundaryEvidence.validationSummary?.awaitingAcceptance ?? 0,
        blockedRows: boundaryEvidence.exportSummary?.blockedRows ?? []
      }
    },
    {
      id: 'boundary_release',
      label: 'Boundary release',
      status: boundaryRelease.status === 'blocked'
        ? 'blocked'
        : boundaryRelease.status === 'guarded' || (requireExplicitBoundaryRelease && boundaryRelease.status !== 'released')
          ? 'guarded'
          : 'ready',
      required: true,
      nextAction: boundaryRelease.readiness?.nextAction ?? boundaryRelease.exportSummary?.nextAction ?? 'release_profile_boundary',
      evidence: {
        releaseStatus: boundaryRelease.status ?? 'unknown',
        blockedRows: boundaryRelease.exportSummary?.blockedRows ?? [],
        guardedRows: boundaryRelease.exportSummary?.guardedRows ?? [],
        explicitReleaseRequired: requireExplicitBoundaryRelease
      }
    },
    {
      id: 'tenant_handoff',
      label: 'Tenant handoff',
      status: tenantHandoff.status === 'blocked'
        ? 'blocked'
        : tenantHandoff.status === 'guarded'
          ? 'guarded'
          : 'ready',
      required: true,
      nextAction: tenantHandoff.handoff?.nextAction ?? tenantHandoff.exportSummary?.nextAction ?? 'publish_profile_tenant_handoff',
      evidence: {
        sequence: tenantHandoff.sequence ?? 0,
        fingerprint: tenantHandoff.fingerprint ?? null,
        statusChannel: tenantHandoff.handoff?.statusChannel ?? null,
        publish: tenantHandoff.handoff?.publish === true
      }
    }
  ];
  const blockedRows = rows.filter((row) => row.required !== false && row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0
    ? 'blocked'
    : guardedRows.length > 0
      ? 'guarded'
      : 'ready';
  const fingerprint = profileTenantLaunchGuardFingerprint({
    profileName: profile.name,
    operation: profile.operation,
    status,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const counters = {
    total: rows.length,
    ready: rows.filter((row) => row.status === 'ready').length,
    guarded: guardedRows.length,
    blocked: blockedRows.length,
    required: rows.filter((row) => row.required !== false).length,
    deniedCapabilities: boundary.deniedCapabilities?.length ?? 0,
    deniedPermissions: boundary.deniedPermissions?.length ?? 0,
    crossTenantBlocked: tenantMismatch ? 1 : 0,
    workspaceAdvisories: workspaceMismatch ? 1 : 0
  };
  const diagnostics = [
    ...compiled.diagnostics,
    ...(runtime.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(clientRuntime.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(permissionMatrix.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(boundaryEvidence.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(boundaryRelease.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...(tenantHandoff.diagnostics ?? []).filter((item) => item.level === 'error'),
    ...blockedRows.map((row) => diagnostic('error', 'profile_tenant_launch_guard_blocked', row.id)),
    ...guardedRows.map((row) => diagnostic('warning', 'profile_tenant_launch_guard_guarded', row.id))
  ];

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_tenant_launch_guard',
    profileName: profile.name ?? 'mailchimp.default',
    operation: profile.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    restartSafe: status === 'ready'
      && runtime.ok === true
      && clientRuntime.ok === true
      && permissionMatrix.restartSafe !== false
      && boundaryEvidence.restartSafe !== false
      && boundaryRelease.restartSafe !== false
      && tenantHandoff.restartSafe !== false,
    sequence,
    fingerprint,
    changed,
    generatedAt: now,
    scope: {
      tenantId: boundary.tenantId ?? null,
      workspaceId: boundary.workspaceId ?? null,
      requestedTenantId,
      requestedWorkspaceId,
      role: boundary.role ?? null,
      permissionMode: boundary.permissionMode ?? null
    },
    counters,
    rows,
    readiness: {
      status,
      blockingReasons: blockedRows.map((row) => row.id),
      guardedReasons: guardedRows.map((row) => row.id),
      nextAction: status === 'blocked'
        ? firstProfileTenantLaunchGuardAction(blockedRows, 'resolve_profile_tenant_launch_guard')
        : status === 'guarded'
          ? firstProfileTenantLaunchGuardAction(guardedRows, 'confirm_profile_tenant_launch_guard')
          : 'publish_profile_tenant_launch_guard',
      canLaunch: status === 'ready'
    },
    auditHandoff: {
      target: 'kernel.audit.mailchimp.profile-launch',
      statusChannel: status === 'ready' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-launch',
      subject: `${boundary.tenantId ?? 'unknown_tenant'}/${boundary.workspaceId ?? 'unknown_workspace'}/${profile.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation}`,
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: status !== 'ready',
      nextAction: status === 'ready' ? 'publish_profile_tenant_launch_guard' : 'review_profile_tenant_launch_guard'
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_tenant_launch_guard',
      status,
      restartSafe: status === 'ready',
      sequence,
      fingerprint,
      changed,
      tenantId: boundary.tenantId ?? null,
      workspaceId: boundary.workspaceId ?? null,
      counters,
      blockedRows: blockedRows.map((row) => row.id),
      guardedRows: guardedRows.map((row) => row.id),
      nextAction: status === 'ready' ? 'publish_profile_tenant_launch_guard' : 'review_profile_tenant_launch_guard'
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

export function buildProfileClientPreviewRouteContract(input = {}, options = {}) {
  const preview = buildProfilePreviewAcceptanceState(input, {
    ...options,
    previousState: options.previousState ?? options.previousProfileState,
    persistedMemory: options.persistedMemory,
    previousProviderState: options.previousProviderState ?? options.previousProfileProviderState,
    requestedProviderCapabilities: options.requestedProviderCapabilities ?? options.profileProviderCapabilities,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance,
    requiredPreviewItems: options.requiredPreviewItems ?? options.requiredProfilePreviewItems
  });
  const runtime = buildProfileClientRuntimeState(input, options);
  const resolution = buildProfileClientResolutionBrief(input, {
    ...options,
    previousBrief: options.previousResolutionBrief ?? options.previousProfileResolutionBrief,
    acceptance: options.acceptance ?? options.profilePreviewAcceptance,
    requiredPreviewItems: options.requiredPreviewItems ?? options.requiredProfilePreviewItems
  });
  const previous = normalizeProfileClientPreviewRoute(options.previousRoute ?? options.previousProfileClientPreviewRoute);
  const acceptedItems = parseList(preview.preview?.acceptedItems ?? preview.acceptance?.acceptedItems);
  const awaitingAcceptance = parseList(preview.exportSummary?.awaitingAcceptance ?? preview.validationSummary?.awaitingAcceptanceItems);
  const rows = dedupeProfileClientPreviewRouteRows([
    profileClientPreviewRouteRow('profile_preview', preview, true, {
      accepted: awaitingAcceptance.length === 0 && (acceptedItems.length > 0 || preview.preview?.requireExplicitAcceptance !== true),
      visible: true,
      nextAction: preview.readiness?.nextAction ?? preview.exportSummary?.nextAction,
      evidence: {
        awaitingAcceptance,
        validationSummary: preview.validationSummary ?? {},
        previewItems: (preview.preview?.rows ?? []).map((row) => row.key ?? row.id).filter(Boolean)
      }
    }),
    profileClientPreviewRouteRow('profile_runtime', runtime.state ?? {}, true, {
      status: runtime.ok ? runtime.state?.workflow?.state === 'awaiting_kernel_ack' ? 'ready' : 'guarded' : 'blocked',
      restartSafe: runtime.ok && runtime.state?.workflow?.statusChannel === DEFAULT_MAILCHIMP_PROFILE.statusChannel,
      visible: runtime.ok !== true || (runtime.state?.verifier?.missingClaims ?? []).length > 0,
      nextAction: runtime.state?.recovery?.clientAction,
      fingerprint: runtime.state?.workflow?.resumeToken,
      evidence: {
        requestKey: runtime.state?.requestKey ?? null,
        missingClaims: runtime.state?.verifier?.missingClaims ?? [],
        missingDurableMemory: runtime.state?.memory?.missingDurableMemory ?? [],
        statusChannel: runtime.state?.workflow?.statusChannel ?? null
      }
    }),
    profileClientPreviewRouteRow('profile_resolution', resolution, true, {
      visible: resolution.status !== 'ready',
      nextAction: resolution.readiness?.nextAction ?? resolution.exportSummary?.nextAction,
      evidence: {
        blockingReasons: resolution.readiness?.blockingReasons ?? [],
        degradedReasons: resolution.readiness?.degradedReasons ?? []
      }
    })
  ]);
  const blockedRows = rows.filter((row) => row.status === 'blocked');
  const guardedRows = rows.filter((row) => row.status === 'guarded');
  const status = blockedRows.length > 0 ? 'blocked' : guardedRows.length > 0 ? 'guarded' : 'ready';
  const fingerprint = profileClientPreviewRouteFingerprint({
    profileName: preview.profileName ?? runtime.state?.profileName,
    operation: preview.operation ?? runtime.state?.operation,
    status,
    rows
  });
  const changed = previous.fingerprint ? previous.fingerprint !== fingerprint : true;
  const sequence = previous.sequence + (changed ? 1 : 0);
  const diagnostics = [
    ...(preview.diagnostics ?? []),
    ...(runtime.diagnostics ?? []),
    ...(resolution.diagnostics ?? []),
    ...blockedRows.map((row) => diagnostic('error', 'profile_client_preview_route_blocked', row.id)),
    ...guardedRows.map((row) => diagnostic('warning', 'profile_client_preview_route_guarded', row.id))
  ];
  const nextAction = blockedRows[0]?.nextAction
    ?? guardedRows[0]?.nextAction
    ?? (changed ? 'publish_profile_client_preview_route' : 'reuse_profile_client_preview_route');

  return {
    ok: status !== 'blocked',
    schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
    title: 'mailchimp_profile_client_preview_route',
    profileName: preview.profileName ?? runtime.state?.profileName ?? 'mailchimp.default',
    operation: preview.operation ?? runtime.state?.operation ?? DEFAULT_MAILCHIMP_PROFILE.operation,
    status,
    restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
    sequence,
    fingerprint,
    changed,
    rows,
    validationSummary: {
      totalRows: rows.length,
      blockedRows: blockedRows.length,
      guardedRows: guardedRows.length,
      visibleRows: rows.filter((row) => row.visibleToClient).length,
      awaitingAcceptance: rows.reduce((count, row) => count + row.awaitingAcceptance.length, 0),
      diagnosticErrors: diagnostics.filter((item) => item.level === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.level === 'warning').length
    },
    readiness: {
      blockingReasons: blockedRows.map((row) => row.id),
      guardedReasons: guardedRows.map((row) => row.id),
      nextAction
    },
    handoff: {
      target: 'client.preview.mailchimp.profile',
      statusChannel: status === 'ready' ? DEFAULT_MAILCHIMP_PROFILE.statusChannel : 'local.status.profile-preview',
      publish: changed || status !== 'ready',
      severity: status === 'blocked' ? 'error' : status === 'guarded' ? 'warning' : 'info',
      includeRows: rows.some((row) => row.visibleToClient),
      nextAction
    },
    exportSummary: {
      schemaVersion: PROFILE_DECLARATION_SCHEMA_VERSION,
      title: 'mailchimp_profile_client_preview_route',
      status,
      restartSafe: status === 'ready' && rows.every((row) => row.restartSafe),
      sequence,
      fingerprint,
      changed,
      visibleRows: rows.filter((row) => row.visibleToClient).map((row) => row.id),
      awaitingAcceptance: unique(rows.flatMap((row) => row.awaitingAcceptance)),
      nextAction
    },
    diagnostics
  };
}

function normalizeProfileClientPreviewRoute(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function profileClientPreviewRouteRow(id, source = {}, required, fallback = {}) {
  const rawStatus = clean(fallback.status ?? source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' || rawStatus === 'waiting_for_claims' || rawStatus === 'waiting_for_memory'
    ? 'guarded'
    : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && status !== 'ready';
  const awaitingAcceptance = parseList(fallback.awaitingAcceptance ?? source.exportSummary?.awaitingAcceptance);
  return {
    id,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required: required === true,
    accepted: fallback.accepted === true,
    restartSafe: fallback.restartSafe === true || (blocked !== true && guarded !== true && source.restartSafe !== false),
    visibleToClient: fallback.visible === true || blocked || guarded || awaitingAcceptance.length > 0,
    fingerprint: clean(fallback.fingerprint ?? source.fingerprint ?? source.exportSummary?.fingerprint),
    awaitingAcceptance,
    nextAction: clean(fallback.nextAction ?? source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (blocked ? `resolve_${id}` : guarded ? `review_${id}` : `publish_${id}`),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function dedupeProfileClientPreviewRouteRows(rows = []) {
  const seen = new Set();
  return rows
    .filter((row) => row && typeof row === 'object' && clean(row.id))
    .filter((row) => {
      const key = [row.id, row.status, row.nextAction].map(clean).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (
      profileLifecycleClientControlRank(right.status) - profileLifecycleClientControlRank(left.status)
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function profileClientPreviewRouteFingerprint({
  profileName,
  operation,
  status,
  rows
}) {
  return [
    'profile_client_preview_route',
    profileName,
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.accepted ? 'accepted' : 'pending',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.visibleToClient ? 'visible' : 'hidden',
      row.fingerprint,
      row.nextAction,
      ...row.awaitingAcceptance
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeProfileBoundaryReleasePolicy(input) {
  const policy = input && typeof input === 'object' ? input : {};
  return {
    requireKernelAudit: policy.requireKernelAudit !== false,
    requireReadyLifecycle: policy.requireReadyLifecycle === true,
    allowPermissionAdvisories: policy.allowPermissionAdvisories !== false,
    allowCapabilityAdvisories: policy.allowCapabilityAdvisories !== false
  };
}

function normalizeProfileTenantHandoffBoundary(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function profileTenantHandoffBoundaryFingerprint({
  profileName,
  operation,
  status,
  rows
}) {
  return [
    profileName,
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.evidence?.tenantId ?? '',
      row.evidence?.workspaceId ?? '',
      row.evidence?.statusChannel ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeProfileTenantLaunchGuard(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function firstProfileTenantLaunchGuardAction(rows, fallback) {
  return rows
    .map((row) => clean(row.nextAction))
    .filter(Boolean)[0] || fallback;
}

function profileTenantLaunchGuardFingerprint({
  profileName,
  operation,
  status,
  rows
}) {
  return [
    profileName,
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required === false ? 'optional' : 'required',
      row.nextAction,
      row.evidence?.tenantId,
      row.evidence?.requestedTenantId,
      row.evidence?.workspaceId,
      row.evidence?.requestedWorkspaceId,
      ...(row.evidence?.deniedCapabilities ?? []).map((item) => `capability:${item}`),
      ...(row.evidence?.deniedPermissions ?? []).map((item) => `permission:${item}`),
      ...(row.evidence?.blockedRows ?? []).map((item) => `blocked:${item}`),
      ...(row.evidence?.guardedRows ?? []).map((item) => `guarded:${item}`)
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function firstProfileBoundaryReleaseAction(rows, fallback) {
  return clean(rows[0]?.nextAction) || fallback;
}

function permissionsForProfileOperation(operation) {
  if (operation === 'audience.segment') return ['audience:read', 'audience:segment', 'status:write'];
  if (operation === 'webhook.audit') return ['webhook:read', 'audit:read'];
  return ['campaign:read', 'campaign:plan', 'status:write'];
}

function profilePermissionMatrixRow({
  id,
  label,
  status,
  required,
  requested,
  allowed,
  denied,
  nextAction,
  evidence
}) {
  return {
    id: clean(id),
    label: clean(label),
    status: status === 'blocked' ? 'blocked' : status === 'guarded' ? 'guarded' : 'ready',
    required: required === true,
    requested: unique(Array.isArray(requested) ? requested : [requested]),
    allowed: unique(Array.isArray(allowed) ? allowed : [allowed]),
    denied: unique(Array.isArray(denied) ? denied : [denied]),
    nextAction: clean(nextAction) || 'review_profile_permission_matrix',
    evidence: evidence && typeof evidence === 'object' ? evidence : {}
  };
}

function emptyProfilePermissionValidation() {
  return {
    totalRows: 0,
    blockedRows: 0,
    guardedRows: 0,
    deniedCapabilities: 0,
    deniedPermissions: 0,
    advisoryPermissions: 0,
    missingStatusWrite: 0,
    diagnosticErrors: 0,
    diagnosticWarnings: 0
  };
}

function profilePermissionMatrixFingerprint({
  profileName,
  operation,
  status,
  rows
}) {
  return [
    profileName,
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.requested.join(','),
      row.allowed.join(','),
      row.denied.join(','),
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
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

function normalizeProfileRestartStatusLedger(input) {
  const value = input && typeof input === 'object' ? input : {};
  const history = value.history && typeof value.history === 'object' ? value.history : {};
  return {
    schemaVersion: clean(value.schemaVersion),
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence ?? history.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    lastStableFingerprint: clean(value.lastStableFingerprint ?? value.exportSummary?.lastStableFingerprint) || null,
    timeline: Array.isArray(value.timeline)
      ? value.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(history.timeline)
        ? history.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function normalizeProfileRestartCommandReplay(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    schemaVersion: clean(value.schemaVersion),
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    appliedCommandKeys: unique([
      ...(Array.isArray(value.appliedCommandKeys) ? value.appliedCommandKeys : []),
      ...(Array.isArray(value.idempotency?.appliedCommandKeys) ? value.idempotency.appliedCommandKeys : [])
    ]),
    suppressedCommandKeys: unique([
      ...(Array.isArray(value.suppressedCommandKeys) ? value.suppressedCommandKeys : []),
      ...(Array.isArray(value.idempotency?.suppressedCommandKeys) ? value.idempotency.suppressedCommandKeys : [])
    ])
  };
}

function normalizeProfileReplayCommands(input, options = {}) {
  const source = Array.isArray(input)
    ? input
    : input && typeof input === 'object'
      ? [input]
      : [
        options.profileCommand,
        options.lifecycleCommand,
        options.command
      ];
  return source
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      commandKey: clean(item.commandKey ?? item.key ?? item.id) || null,
      action: clean(item.action ?? item.lifecycleAction ?? item.persistenceAction),
      lifecycleAction: clean(item.lifecycleAction),
      persistenceAction: clean(item.persistenceAction),
      requireRestartSafe: item.requireRestartSafe !== false,
      ordinal: index + 1
    }))
    .filter((item) => item.action || item.lifecycleAction || item.persistenceAction || item.commandKey);
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

function profileRestartStatusLedgerFingerprint({
  profileName,
  operation,
  status,
  rows
}) {
  return [
    profileName,
    operation,
    status,
    ...rows.map((row) => [
      row.key,
      row.status,
      row.restartSafe === false ? 'guarded' : 'safe',
      row.sequence ?? 0,
      row.evidence?.restartKey ?? '',
      row.evidence?.fingerprint ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('|');
}

function profileRestartCommandReplayFingerprint({
  profileName,
  operation,
  status,
  rows
}) {
  return [
    profileName,
    operation,
    status,
    ...rows.map((row) => [
      row.commandKey,
      row.action,
      row.target,
      row.status,
      row.repeated ? 'repeated' : 'new',
      row.restartSafeRequired ? 'restart_safe_required' : 'restart_safe_optional',
      row.apply ? 'apply' : 'do_not_apply',
      row.suppress ? 'suppress' : 'do_not_suppress',
      row.evidence?.restartKey ?? 'no_restart_key'
    ].map(clean).filter(Boolean).join(':')).sort()
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
  const missingClaims = Array.isArray(parts.missingClaims) ? parts.missingClaims : [];
  const missingRestorableMemory = Array.isArray(parts.missingRestorableMemory) ? parts.missingRestorableMemory : [];
  const restoredMemory = Array.isArray(parts.restoredMemory) ? parts.restoredMemory : [];
  return [
    parts.restartKey,
    parts.workflowState,
    ...missingClaims.map((item) => `claim:${item}`),
    ...missingRestorableMemory.map((item) => `memory:${item}`),
    ...restoredMemory.map((item) => `restored:${item}`)
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

function normalizeProfileProviderSyncHandoff(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function normalizeProviderSyncHandoffAcceptance(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    acceptedItems: parseList(value.acceptedItems ?? value.accepted ?? value.items),
    acceptedAt: clean(value.acceptedAt ?? value.timestamp) || null,
    acceptedBy: clean(value.acceptedBy ?? value.actor) || null,
    requireExplicitAcceptance: value.requireExplicitAcceptance === true
  };
}

function normalizeProviderSyncCheckpoint(input) {
  const value = input && typeof input === 'object' ? input : {};
  const summary = value.exportSummary ?? {};
  const profileSyncIntent = value.profileSyncIntent ?? {};
  const checkpoint = value.checkpoint ?? {};
  return {
    present: Boolean(value.schemaVersion || value.status || summary.status || checkpoint.key),
    status: clean(value.status ?? summary.status) || 'ready',
    restartSafe: value.restartSafe === true || summary.restartSafe === true,
    profileCursor: clean(profileSyncIntent.cursor ?? summary.profileCursor ?? value.profileCursor),
    checkpointKey: clean(checkpoint.key ?? summary.fingerprint ?? value.fingerprint) || null,
    nextAction: clean(value.readiness?.nextAction ?? value.handoff?.nextAction ?? summary.nextAction) || null
  };
}

function profileProviderSyncHandoffFingerprint({
  syncIntent,
  importCheckpoint,
  rows,
  acceptedItems
}) {
  return [
    syncIntent.profileName,
    syncIntent.operation,
    syncIntent.fingerprint,
    syncIntent.sync?.cursor ?? '',
    importCheckpoint.checkpointKey ?? '',
    importCheckpoint.profileCursor ?? '',
    ...acceptedItems.map((item) => `accepted:${item}`).sort(),
    ...rows.map((row) => [
      row.key,
      row.status,
      row.required ? 'required' : 'optional',
      row.accepted ? 'accepted' : 'pending',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.evidence?.fingerprint ?? row.evidence?.checkpointKey ?? '',
      row.nextAction ?? ''
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
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

function normalizeProfileStatusPublication(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    healthFingerprint: clean(value.healthFingerprint ?? value.exportSummary?.healthFingerprint),
    lastPublishedAt: clean(value.publication?.generatedAt ?? value.lastPublishedAt ?? value.timestamp),
    ageMs: toNonNegativeInteger(value.ageMs ?? value.publicationAgeMs, 0)
  };
}

function normalizeProfileResolutionBrief(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function dedupeProfileResolutionRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const normalized = {
      ...row,
      id: clean(row.id),
      source: clean(row.source),
      subject: clean(row.subject),
      status: clean(row.status) || 'ready',
      severity: clean(row.severity) || 'info',
      nextAction: clean(row.nextAction) || null,
      clientVisible: row.clientVisible === true,
      evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}
    };
    const key = [normalized.id, normalized.source, normalized.subject, normalized.nextAction].map(clean).join('|');
    if (!normalized.id || !normalized.source || seen.has(key)) return false;
    seen.add(key);
    Object.assign(row, normalized);
    return true;
  });
}

function dedupeProfilePreviewDigestRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const normalized = {
      ...row,
      key: clean(row.key),
      source: clean(row.source),
      status: clean(row.status) || 'ready',
      clientVisible: row.clientVisible === true,
      accepted: row.accepted === true,
      required: row.required === true,
      nextAction: clean(row.nextAction) || null,
      evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}
    };
    const key = [normalized.key, normalized.source, normalized.nextAction].map(clean).join('|');
    if (!normalized.key || seen.has(key)) return false;
    seen.add(key);
    Object.assign(row, normalized);
    return true;
  }).sort((left, right) => (
    profilePreviewDigestStatusRank(right.status) - profilePreviewDigestStatusRank(left.status)
    || left.source.localeCompare(right.source)
    || left.key.localeCompare(right.key)
  ));
}

function profilePreviewDigestStatusRank(status) {
  if (status === 'blocked') return 3;
  if (status === 'guarded' || status === 'degraded') return 2;
  return 1;
}

function profileClientResolutionFingerprint({
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
      row.id,
      row.source,
      row.status,
      row.severity,
      row.clientVisible ? 'visible' : 'hidden',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function profileStatusPublicationFingerprint({
  profileName,
  operation,
  status,
  healthFingerprint,
  rows,
  stale
}) {
  return [
    profileName,
    operation,
    status,
    healthFingerprint,
    stale ? 'stale' : 'fresh',
    ...rows.map((row) => [
      row.component,
      row.status,
      row.restartSafe === false ? 'guarded' : 'safe',
      row.publish === true ? 'publish' : 'silent',
      row.nextAction ?? 'no_action'
    ].map(clean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeProfileLaunchControlState(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function normalizeProfileLifecycleSettingsControlState(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function normalizeProfileLifecycleControlAcceptance(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    requireExplicitAcceptance: value.requireExplicitAcceptance === true,
    acceptedControls: unique(parseList(value.acceptedControls ?? value.acceptedItems)),
    acceptedAt: clean(value.acceptedAt ?? value.timestamp) || null,
    acceptedBy: clean(value.acceptedBy ?? value.user) || null
  };
}

function lifecycleSettingsControlRow({
  key,
  label,
  requiredRows,
  acceptedControls,
  status,
  enabled,
  commands,
  disabledReasons,
  nextAction,
  evidence
}) {
  const required = requiredRows.includes(key);
  const accepted = acceptedControls.acceptedControls.includes(key);
  const normalizedStatus = clean(status) || 'ready';
  return {
    key,
    label,
    status: normalizedStatus,
    required,
    accepted,
    enabled: enabled === true,
    visibleToClient: required || normalizedStatus !== 'ready' || enabled === true || commands.length > 0,
    restartSafe: normalizedStatus !== 'blocked',
    commands: unique(commands).sort(),
    disabledReasons: unique(disabledReasons).sort(),
    nextAction,
    evidence: evidence && typeof evidence === 'object' ? evidence : {}
  };
}

function profileLifecycleSettingsControlFingerprint({
  profileName,
  operation,
  status,
  settings,
  rows
}) {
  return [
    profileName,
    operation,
    status,
    settings.enabled ? 'enabled' : 'disabled',
    settings.scheduleMode,
    settings.retryWindowMs,
    settings.maxScheduledRetries,
    settings.requireKernelStatus ? 'kernel_status_required' : 'kernel_status_optional',
    settings.allowDegradedResume ? 'allow_degraded_resume' : 'strict_resume',
    ...rows.map((row) => [
      row.key,
      row.status,
      row.required ? 'required' : 'optional',
      row.accepted ? 'accepted' : 'pending',
      row.enabled ? 'enabled' : 'disabled',
      row.commands.join(','),
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function profileLaunchControlFingerprint({
  profileName,
  operation,
  status,
  rows
}) {
  return [
    profileName,
    operation,
    status,
    ...rows.map((row) => [
      row.key,
      row.status,
      row.required ? 'required' : 'optional',
      row.enabled ? 'enabled' : 'disabled',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.schedule?.nextRetry?.attempt ?? '',
      row.schedule?.nextSyncAfterMs ?? '',
      row.evidence?.fingerprint ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function profileLifecycleNextActionRow(id, source, required, fallback) {
  const rawStatus = clean(fallback.status ?? source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' ? 'guarded' : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && (status === 'guarded' || status === 'paused' || status === 'disabled' || status === 'retry_scheduled');
  return {
    id,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required,
    restartSafe: fallback.restartSafe !== false && blocked !== true,
    nextAction: clean(fallback.nextAction) || (
      blocked ? `resolve_profile_${id}` : guarded ? `publish_profile_${id}_guarded` : 'publish_profile_ready'
    ),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function profileLifecycleNextActionFingerprint({
  profileName,
  operation,
  status,
  rows
}) {
  return [
    profileName,
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.evidence?.fingerprint ?? '',
      row.nextAction ?? 'no_action'
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeProfilePersistedRecoveryManifest(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    lastStableFingerprint: clean(value.recovery?.lastStableFingerprint ?? value.lastStableFingerprint) || null,
    appliedCommandKeys: unique(parseList(value.idempotency?.appliedCommandKeys ?? value.appliedCommandKeys))
  };
}

function normalizeProfileRecoveryStatusJournal(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const maxAgeMs = toPositiveInteger(value.maxAgeMs, 120000);
  const ageMs = toNonNegativeInteger(value.ageMs, 0);
  const status = clean(value.status) || (ageMs > maxAgeMs ? 'stale' : 'ready');
  return {
    status,
    sequence: toNonNegativeInteger(value.sequence, 0),
    fingerprint: clean(value.fingerprint) || profileStateFingerprint({
      restartKey: `status:${status}:${toNonNegativeInteger(value.sequence, 0)}`,
      workflowState: clean(value.lastStatus ?? value.status) || 'unknown',
      missingClaims: [],
      missingRestorableMemory: [],
      restoredMemory: ageMs > maxAgeMs ? ['stale'] : ['fresh']
    }),
    lastStatus: clean(value.lastStatus ?? value.status) || null,
    lastPublishedAt: clean(value.lastPublishedAt ?? value.timestamp) || null
  };
}

function profilePersistedRecoveryManifestFingerprint({
  profileName,
  operation,
  requestKey,
  rows,
  commandKey
}) {
  return [
    profileName,
    operation,
    requestKey,
    commandKey || 'no_command',
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function profileHealthSeverityRank(severity) {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  return 1;
}

function normalizeProfileOperationalEscalation(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    lastStableFingerprint: clean(value.escalation?.lastStableFingerprint ?? value.lastStableFingerprint) || null
  };
}

function normalizeProfileEscalationOwners(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    defaultOwner: clean(value.defaultOwner) || 'mailchimp.operations',
    profile: clean(value.profile) || clean(value.profileOwner) || 'mailchimp.profile',
    provider: clean(value.provider) || clean(value.providerOwner) || 'mailchimp.provider',
    boundary: clean(value.boundary) || clean(value.boundaryOwner) || 'mailchimp.boundary',
    client: clean(value.client) || clean(value.clientOwner) || 'mailchimp.client'
  };
}

function normalizeProfileEscalationThresholds(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    errorMs: toPositiveInteger(value.errorMs, 300000),
    warningMs: toPositiveInteger(value.warningMs, 900000),
    infoMs: toPositiveInteger(value.infoMs, 3600000)
  };
}

function profileEscalationRowsFromComponents(rows = [], owners = {}) {
  return rows
    .filter((row) => row && typeof row === 'object')
    .filter((row) => row.status === 'blocked' || row.status === 'degraded' || row.restartSafe === false)
    .map((row) => {
      const component = clean(row.component) || 'profile_component';
      const severity = row.status === 'blocked' ? 'error' : 'warning';
      return {
        id: `component:${component}`,
        source: 'profile_health',
        component,
        subject: component,
        severity,
        owner: profileEscalationOwnerForComponent(component, owners),
        reason: row.status === 'blocked' ? 'component_blocked' : row.restartSafe === false ? 'restart_guarded' : 'component_degraded',
        action: clean(row.nextAction) || (severity === 'error' ? `resolve_${component}` : `review_${component}`),
        evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}
      };
    });
}

function profileEscalationRowsFromDiagnostics(diagnostics = [], owners = {}) {
  return diagnostics
    .filter((item) => item && typeof item === 'object')
    .filter((item) => item.level === 'error' || item.level === 'warning')
    .map((item) => ({
      id: `diagnostic:${clean(item.code)}:${clean(item.subject)}`,
      source: 'profile_diagnostic',
      component: 'diagnostics',
      subject: clean(item.subject) || clean(item.code),
      severity: item.level === 'error' ? 'error' : 'warning',
      owner: owners.defaultOwner,
      reason: clean(item.code) || 'profile_diagnostic',
      action: item.level === 'error' ? 'repair_profile_diagnostic_error' : 'review_profile_diagnostic_warning',
      evidence: { code: clean(item.code), level: clean(item.level) }
    }));
}

function profileEscalationRowsFromActions(actions = [], owners = {}) {
  return actions
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: `action:${clean(item.source)}:${clean(item.code)}:${clean(item.subject)}`,
      source: clean(item.source) || 'profile_action',
      component: clean(item.source) || 'action_queue',
      subject: clean(item.subject) || clean(item.code),
      severity: clean(item.severity) === 'error' ? 'error' : clean(item.severity) === 'warning' ? 'warning' : 'info',
      owner: profileEscalationOwnerForComponent(clean(item.source), owners),
      reason: clean(item.code) || 'profile_action_required',
      action: clean(item.action) || 'review_profile_action',
      evidence: item.evidence && typeof item.evidence === 'object' ? item.evidence : {}
    }));
}

function dedupeProfileEscalationRows(rows = []) {
  const seen = new Set();
  return rows
    .filter((row) => row && typeof row === 'object')
    .filter((row) => {
      const key = [row.id, row.severity, row.action].map(clean).join('|');
      if (!clean(row.id) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (
      profileHealthSeverityRank(right.severity) - profileHealthSeverityRank(left.severity)
      || clean(left.owner).localeCompare(clean(right.owner))
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function profileEscalationOwnerForComponent(component, owners = {}) {
  const value = clean(component);
  if (value.includes('provider')) return owners.provider ?? owners.defaultOwner;
  if (value.includes('boundary')) return owners.boundary ?? owners.defaultOwner;
  if (value.includes('client')) return owners.client ?? owners.defaultOwner;
  if (value.includes('profile')) return owners.profile ?? owners.defaultOwner;
  return owners.defaultOwner;
}

function profileOperationalEscalationFingerprint({
  profileName,
  operation,
  status,
  rows,
  retry,
  publication
}) {
  return [
    profileName,
    operation,
    status,
    retry?.attempt ?? 'no_retry',
    publication.fingerprint ?? publication.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.severity,
      row.owner,
      row.deadlineMs,
      row.publish ? 'publish' : 'silent',
      row.action
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeProfileAnalyticsExportLedger(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline
      : Array.isArray(value.timeline)
        ? value.timeline
        : []
  };
}

function normalizeProfileLifecycleClientControlPacket(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    appliedCommandKeys: parseList(value.idempotency?.appliedCommandKeys ?? value.appliedCommandKeys)
  };
}

function profileLifecycleClientControlRow(source, key, row = {}, fallback = {}) {
  const rawStatus = clean(row.status ?? fallback.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || row.restartSafe === false
      ? 'guarded'
      : 'ready';
  const commands = unique(fallback.commands ?? row.commands ?? []);
  return {
    id: `${source}:${clean(key)}`,
    source,
    key: clean(key),
    label: clean(fallback.label) || clean(key),
    status,
    required: row.required !== false,
    accepted: fallback.accepted === true,
    enabled: row.enabled !== false,
    restartSafe: status === 'ready' && row.restartSafe !== false,
    clientVisible: fallback.clientVisible === true || status !== 'ready',
    commands,
    nextAction: clean(fallback.nextAction ?? row.nextAction ?? row.nextStep)
      || (status === 'blocked' ? `resolve_${source}_${clean(key)}` : status === 'guarded' ? `review_${source}_${clean(key)}` : `publish_${source}_${clean(key)}`),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function dedupeProfileLifecycleClientControlRows(rows = []) {
  const seen = new Set();
  return rows
    .filter((row) => row && typeof row === 'object' && clean(row.id))
    .filter((row) => {
      const key = [row.id, row.status, row.nextAction].map(clean).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (
      profileLifecycleClientControlRank(right.status) - profileLifecycleClientControlRank(left.status)
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function profileLifecycleClientControlRank(status) {
  if (status === 'blocked') return 3;
  if (status === 'guarded') return 2;
  return 1;
}

function profileLifecycleClientControlPacketFingerprint({
  profileName,
  operation,
  status,
  rows,
  controls,
  nextAction
}) {
  return [
    'profile_lifecycle_client_controls',
    profileName,
    operation,
    status,
    controls.fingerprint ?? controls.exportSummary?.fingerprint ?? '',
    nextAction.fingerprint ?? nextAction.exportSummary?.fingerprint ?? '',
    ...rows.map((row) => [
      row.id,
      row.status,
      row.accepted ? 'accepted' : 'pending',
      row.enabled ? 'enabled' : 'disabled',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.nextAction,
      ...row.commands
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function profileAnalyticsExportLedgerRow(id, source = {}, required, fallback = {}) {
  const rawStatus = clean(source.status ?? source.readiness?.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'degraded' || rawStatus === 'recovering' ? 'guarded' : rawStatus;
  const blocked = status === 'blocked';
  const guarded = !blocked && (status === 'guarded' || source.restartSafe === false || source.exportSummary?.restartSafe === false);
  const fingerprint = clean(source.fingerprint ?? source.exportSummary?.fingerprint ?? fallback.fingerprint);
  return {
    id,
    status: blocked ? 'blocked' : guarded ? 'guarded' : 'ready',
    required: required === true,
    restartSafe: blocked !== true && guarded !== true,
    fingerprint,
    publish: blocked || guarded || source.handoff?.publish === true || source.changed === true,
    counters: fallback.counters && typeof fallback.counters === 'object' ? fallback.counters : {},
    statusChannel: clean(fallback.statusChannel ?? source.handoff?.statusChannel ?? source.exportSummary?.statusChannel) || null,
    nextAction: clean(fallback.nextAction ?? source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (blocked ? `resolve_${id}` : guarded ? `publish_${id}_guarded` : `publish_${id}`)
  };
}

function profileAnalyticsExportLedgerFingerprint({
  profileName,
  operation,
  status,
  rows
}) {
  return [
    'profile_analytics_export_ledger',
    profileName,
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.fingerprint,
      row.nextAction
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeProfileLaunchAcceptanceExport(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    timeline: Array.isArray(value.history?.timeline)
      ? value.history.timeline.filter((item) => item && typeof item === 'object')
      : Array.isArray(value.timeline)
        ? value.timeline.filter((item) => item && typeof item === 'object')
        : []
  };
}

function profileLaunchAcceptanceExportRow(id, source = {}, required, fallback = {}) {
  const rawStatus = clean(source.status ?? source.readiness?.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || rawStatus === 'recovering' || source.restartSafe === false
      ? 'guarded'
      : 'ready';
  const awaitingAcceptance = unique(parseList(fallback.awaitingAcceptance ?? source.exportSummary?.awaitingAcceptance));
  return {
    id,
    status,
    required: required === true,
    restartSafe: status === 'ready' && source.restartSafe !== false && source.exportSummary?.restartSafe !== false,
    clientVisible: status !== 'ready' || awaitingAcceptance.length > 0 || source.handoff?.publish === true,
    publish: status !== 'ready' || awaitingAcceptance.length > 0 || source.handoff?.publish === true || source.changed === true,
    awaitingAcceptance,
    sequence: toNonNegativeInteger(source.sequence ?? source.exportSummary?.sequence, 0),
    fingerprint: clean(source.fingerprint ?? source.exportSummary?.fingerprint),
    statusChannel: clean(source.handoff?.statusChannel ?? source.exportSummary?.statusChannel) || null,
    nextAction: clean(fallback.nextAction ?? source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (status === 'blocked' ? `resolve_${id}` : status === 'guarded' ? `review_${id}` : `publish_${id}`),
    counters: source.counters && typeof source.counters === 'object' ? source.counters : {}
  };
}

function dedupeProfileLaunchAcceptanceExportRows(rows = []) {
  const seen = new Set();
  return rows
    .filter((row) => row && typeof row === 'object' && clean(row.id))
    .filter((row) => {
      const key = [row.id, row.status, row.nextAction].map(clean).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (
      profileLaunchAcceptanceStatusRank(right.status) - profileLaunchAcceptanceStatusRank(left.status)
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function profileLaunchAcceptanceStatusRank(status) {
  if (status === 'blocked') return 3;
  if (status === 'guarded' || status === 'degraded') return 2;
  return 1;
}

function profileLaunchAcceptanceExportFingerprint({
  profileName,
  operation,
  status,
  rows,
  awaitingAcceptance
}) {
  return [
    'profile_launch_acceptance_export',
    profileName,
    operation,
    status,
    `awaiting:${awaitingAcceptance.join(',')}`,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.clientVisible ? 'client_visible' : 'client_hidden',
      row.publish ? 'publish' : 'silent',
      row.fingerprint,
      row.nextAction,
      ...row.awaitingAcceptance
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeProfileRuntimeCheckpoint(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function normalizeProfileLifecycleScheduleCheckpoint(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    appliedCommandKeys: unique(parseList(value.idempotency?.appliedCommandKeys ?? value.appliedCommandKeys))
  };
}

function profileLifecycleScheduleCheckpointFingerprint({
  profileName,
  operation,
  status,
  rows,
  commandKey
}) {
  return [
    'profile_lifecycle_schedule_checkpoint',
    profileName,
    operation,
    status,
    commandKey,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.scheduled ? 'scheduled' : 'unscheduled',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.dueAfterMs ?? '',
      row.command ?? '',
      row.nextAction,
      row.evidence?.controlFingerprint,
      ...(row.evidence?.awaitingAcceptance ?? []),
      ...(row.evidence?.availableCommands ?? [])
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeProfileReadinessBrief(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint)
  };
}

function profileReadinessBriefStatus(row = {}) {
  const rawStatus = clean(row.status) || 'ready';
  if (rawStatus === 'blocked' || rawStatus === 'operator_review') return 'blocked';
  if (
    rawStatus === 'degraded'
    || rawStatus === 'recovering'
    || rawStatus === 'retry_scheduled'
    || rawStatus === 'paused'
    || rawStatus === 'disabled'
    || rawStatus === 'enabled_degraded'
    || row.restartSafe === false
  ) return 'guarded';
  return 'ready';
}

function profileReadinessBriefFingerprint({
  profileName,
  operation,
  status,
  rows
}) {
  return [
    'profile_operational_readiness_brief',
    profileName,
    operation,
    status,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.clientVisible ? 'client_visible' : 'client_hidden',
      row.evidence?.fingerprint,
      row.nextAction,
      ...(row.evidence?.blockingReasons ?? []),
      ...(row.evidence?.degradedReasons ?? [])
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeProfileRuntimeCheckpointAcceptance(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    requireExplicitAcceptance: value.requireExplicitAcceptance === true,
    acceptedRows: unique(parseList(value.acceptedRows ?? value.acceptedItems ?? value.rows))
  };
}

function profileRuntimeCheckpointRow(id, row = {}) {
  const rawStatus = clean(row.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || rawStatus === 'recovering' || row.restartSafe === false
      ? 'guarded'
      : 'ready';
  return {
    id,
    status,
    restartSafe: status === 'ready' && row.restartSafe !== false,
    clientVisible: row.clientVisible === true || status !== 'ready',
    nextAction: clean(row.nextAction) || (
      status === 'blocked' ? `resolve_${id}` : status === 'guarded' ? `review_${id}` : `publish_${id}`
    ),
    evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : {}
  };
}

function dedupeProfileRuntimeCheckpointRows(rows = []) {
  const seen = new Set();
  return rows
    .filter((row) => row && typeof row === 'object' && clean(row.id))
    .filter((row) => {
      const key = [row.id, row.status, row.nextAction].map(clean).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (
      profileLifecycleClientControlRank(right.status) - profileLifecycleClientControlRank(left.status)
      || clean(left.id).localeCompare(clean(right.id))
    ));
}

function profileRuntimeCheckpointFingerprint({
  profileName,
  operation,
  status,
  requestKey,
  resumeToken,
  rows
}) {
  return [
    'profile_client_runtime_checkpoint',
    profileName,
    operation,
    status,
    requestKey,
    resumeToken,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.clientVisible ? 'client_visible' : 'client_hidden',
      row.nextAction,
      row.evidence?.fingerprint,
      ...(row.evidence?.missingClaims ?? []),
      ...(row.evidence?.missingRestorable ?? []),
      ...(row.evidence?.blockedComponents ?? []),
      ...(row.evidence?.degradedComponents ?? [])
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeProfileRestartReplayDecisionEnvelope(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.history?.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    appliedCommandKeys: unique(parseList(value.idempotency?.appliedCommandKeys ?? value.appliedCommandKeys)),
    suppressedCommandKeys: unique(parseList(value.idempotency?.suppressedCommandKeys ?? value.suppressedCommandKeys))
  };
}

function profileRestartReplayDecisionFingerprint({
  profileName,
  operation,
  status,
  rows,
  commandKey
}) {
  return [
    'profile_restart_replay_decision',
    profileName,
    operation,
    status,
    commandKey,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.clientVisible ? 'client_visible' : 'client_hidden',
      row.nextAction,
      row.evidence?.fingerprint,
      row.evidence?.commandKey,
      ...(row.evidence?.appliedCommands ?? []),
      ...(row.evidence?.suppressedCommands ?? []),
      ...(row.evidence?.replayedCommands ?? []),
      ...(row.evidence?.blockedComponents ?? []),
      ...(row.evidence?.degradedComponents ?? [])
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function normalizeProfileProviderLaunchHandoff(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    sequence: toNonNegativeInteger(value.sequence ?? value.exportSummary?.sequence, 0),
    fingerprint: clean(value.fingerprint ?? value.exportSummary?.fingerprint),
    appliedCommandKeys: unique(parseList(value.idempotency?.appliedCommandKeys ?? value.appliedCommandKeys))
  };
}

function profileProviderLaunchRow(id, source = {}, required, fallback = {}) {
  const rawStatus = clean(fallback.status ?? source.status ?? source.exportSummary?.status) || 'ready';
  const status = rawStatus === 'blocked'
    ? 'blocked'
    : rawStatus === 'guarded' || rawStatus === 'degraded' || rawStatus === 'recovering' || source.restartSafe === false
      ? 'guarded'
      : 'ready';
  return {
    id,
    required: required === true,
    status,
    restartSafe: status === 'ready' && fallback.restartSafe !== false && source.restartSafe !== false && source.exportSummary?.restartSafe !== false,
    fingerprint: clean(fallback.fingerprint ?? source.fingerprint ?? source.exportSummary?.fingerprint),
    nextAction: clean(fallback.nextAction ?? source.readiness?.nextAction ?? source.handoff?.nextAction ?? source.exportSummary?.nextAction)
      || (status === 'blocked' ? `resolve_${id}` : status === 'guarded' ? `review_${id}` : `publish_${id}`),
    evidence: fallback.evidence && typeof fallback.evidence === 'object' ? fallback.evidence : {}
  };
}

function profileProviderLaunchHandoffFingerprint({
  profileName,
  operation,
  status,
  rows,
  commandKey
}) {
  return [
    'profile_provider_launch_handoff',
    profileName,
    operation,
    status,
    commandKey,
    ...rows.map((row) => [
      row.id,
      row.status,
      row.required ? 'required' : 'optional',
      row.restartSafe ? 'restart_safe' : 'restart_guarded',
      row.fingerprint,
      row.nextAction,
      row.evidence?.provider,
      row.evidence?.service,
      row.evidence?.syncMode,
      row.evidence?.cursor,
      row.evidence?.statusChannel,
      ...(row.evidence?.missingCapabilities ?? []),
      ...(row.evidence?.requestedCapabilities ?? [])
    ].map(clean).filter(Boolean).join(':')).sort()
  ].map(clean).filter(Boolean).join('||');
}

function clean(value) {
  return String(value ?? '').trim();
}

function diagnostic(level, code, subject) {
  return { level, code, subject };
}
