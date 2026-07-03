export const PROFILE_SCHEMA_VERSION = 'aios.profile.v1';
export const PROFILE_CONTINUATION_STATE_VERSION = 'aios.profile-continuation-state.v1';

const DEFAULT_MEMORY_TTL_SECONDS = 3600;
const DEFAULT_CLIENT_RUNTIME = Object.freeze({
  handoffTarget: 'mailchimp.client.workflow',
  continuationMode: 'resume_after_kernel_ack',
  statusChannel: 'kernel.status.mailchimp',
  idempotencyScope: 'tenant_operation_input'
});

export const MAILCHIMP_PROFILE_PRESETS = Object.freeze({
  'mailchimp.campaign.sync': Object.freeze({
    name: 'mailchimp.campaign.sync',
    runtimeAdapter: 'mailchimp',
    operation: 'campaign.sync',
    capabilities: Object.freeze(['mailchimp.read', 'mailchimp.campaign.plan']),
    memory: Object.freeze([
      Object.freeze({
        name: 'campaign_snapshot',
        scope: 'job',
        retention: 'ephemeral',
        ttlSeconds: DEFAULT_MEMORY_TTL_SECONDS
      })
    ]),
    verifier: Object.freeze({
      requiredClaims: Object.freeze(['audience_id', 'campaign_id', 'consent_basis']),
      truthBoundaries: Object.freeze(['mailchimp_api', 'local_cache'])
    }),
    recovery: Object.freeze({
      statusOnFailure: 'needs_operator_review',
      rollback: 'discard_local_plan'
    })
  }),
  'mailchimp.audience.segment': Object.freeze({
    name: 'mailchimp.audience.segment',
    runtimeAdapter: 'mailchimp',
    operation: 'audience.segment',
    capabilities: Object.freeze(['mailchimp.read', 'mailchimp.audience.segment']),
    memory: Object.freeze([
      Object.freeze({
        name: 'audience_snapshot',
        scope: 'job',
        retention: 'ephemeral',
        ttlSeconds: DEFAULT_MEMORY_TTL_SECONDS
      })
    ]),
    verifier: Object.freeze({
      requiredClaims: Object.freeze(['audience_id', 'segment_rule', 'consent_basis']),
      truthBoundaries: Object.freeze(['mailchimp_api', 'computed_segment'])
    }),
    recovery: Object.freeze({
      statusOnFailure: 'segment_rebuild_required',
      rollback: 'drop_computed_segment'
    })
  }),
  'mailchimp.webhook.audit': Object.freeze({
    name: 'mailchimp.webhook.audit',
    runtimeAdapter: 'mailchimp',
    operation: 'webhook.audit',
    capabilities: Object.freeze(['mailchimp.read', 'mailchimp.webhook.inspect']),
    memory: Object.freeze([
      Object.freeze({
        name: 'webhook_event_digest',
        scope: 'tenant',
        retention: 'bounded',
        ttlSeconds: 86400
      })
    ]),
    verifier: Object.freeze({
      requiredClaims: Object.freeze(['webhook_id', 'event_signature']),
      truthBoundaries: Object.freeze(['mailchimp_webhook', 'local_audit_log'])
    }),
    recovery: Object.freeze({
      statusOnFailure: 'audit_gap_reported',
      rollback: 'append_compensating_audit_event'
    })
  })
});

export function listMailchimpProfiles() {
  return Object.keys(MAILCHIMP_PROFILE_PRESETS).sort();
}

export function parseProfileSource(source = '') {
  const lines = String(source)
    .split(/\r?\n/)
    .map((line, index) => ({ index: index + 1, text: line.trim() }))
    .filter((line) => line.text && !line.text.startsWith('#'));

  const ast = {
    kind: 'ProfileSource',
    schemaVersion: PROFILE_SCHEMA_VERSION,
    declarations: []
  };

  for (const line of lines) {
    const separator = line.text.indexOf(':');
    if (separator === -1) {
      ast.declarations.push({
        kind: 'InvalidDeclaration',
        line: line.index,
        text: line.text,
        reason: 'missing_colon'
      });
      continue;
    }

    const key = line.text.slice(0, separator).trim();
    const value = line.text.slice(separator + 1).trim();
    ast.declarations.push({
      kind: 'ProfileDeclaration',
      line: line.index,
      key,
      value
    });
  }

  return ast;
}

export function normalizeProfile(input = {}) {
  const profileInput = typeof input === 'string' ? profileFromAst(parseProfileSource(input)) : input;
  const presetName = profileInput?.preset ?? profileInput?.name ?? 'mailchimp.campaign.sync';
  const preset = MAILCHIMP_PROFILE_PRESETS[presetName];
  if (!preset) {
    return profileError(`unknown_profile:${presetName}`, {
      requestedProfile: presetName,
      knownProfiles: listMailchimpProfiles()
    });
  }

  const capabilities = uniqueSorted([
    ...preset.capabilities,
    ...asArray(profileInput.capabilities)
  ]);
  const memory = mergeMemoryContracts(preset.memory, profileInput.memory);
  const requiredClaims = uniqueSorted([
    ...preset.verifier.requiredClaims,
    ...asArray(profileInput.requiredClaims)
  ]);
  const truthBoundaries = uniqueSorted([
    ...preset.verifier.truthBoundaries,
    ...asArray(profileInput.truthBoundaries)
  ]);
  const clientRuntime = normalizeClientRuntime(profileInput.clientRuntime ?? profileInput.client ?? {});

  return {
    ok: true,
    profile: {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      name: preset.name,
      runtimeAdapter: profileInput.runtimeAdapter ?? preset.runtimeAdapter,
      operation: profileInput.operation ?? preset.operation,
      capabilities,
      memory,
      verifier: {
        requiredClaims,
        truthBoundaries,
        strict: profileInput.strictVerifier !== false
      },
      recovery: {
        statusOnFailure: profileInput.statusOnFailure ?? preset.recovery.statusOnFailure,
        rollback: profileInput.rollback ?? preset.recovery.rollback
      },
      clientRuntime,
      metadata: stableObject(profileInput.metadata ?? {})
    },
    diagnostics: validateProfileContracts({ capabilities, memory, requiredClaims, truthBoundaries, clientRuntime })
  };
}

export function deriveCapabilityContract(profile) {
  const normalized = normalizeProfile(profile);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    contract: {
      runtimeAdapter: normalized.profile.runtimeAdapter,
      operation: normalized.profile.operation,
      required: normalized.profile.capabilities,
      verifierClaims: normalized.profile.verifier.requiredClaims,
      externalWriteDefault: false
    },
    diagnostics: normalized.diagnostics
  };
}

export function deriveMemoryContract(profile) {
  const normalized = normalizeProfile(profile);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    contract: normalized.profile.memory.map((entry) => ({
      name: entry.name,
      scope: entry.scope,
      retention: entry.retention,
      ttlSeconds: entry.ttlSeconds,
      writableBy: normalized.profile.runtimeAdapter
    })),
    diagnostics: normalized.diagnostics
  };
}

export function buildTruthBoundaryReport(profile, observedClaims = {}) {
  const normalized = normalizeProfile(profile);
  if (!normalized.ok) return normalized;

  const claimKeys = new Set(Object.keys(observedClaims ?? {}));
  const missingClaims = normalized.profile.verifier.requiredClaims.filter((claim) => !claimKeys.has(claim));
  const boundaries = normalized.profile.verifier.truthBoundaries.map((boundary) => ({
    boundary,
    status: claimKeys.has(boundary) ? 'observed' : 'declared',
    source: boundary.startsWith('mailchimp') ? 'remote_mailchimp_surface' : 'local_aios_surface'
  }));

  return {
    ok: missingClaims.length === 0,
    report: {
      profile: normalized.profile.name,
      operation: normalized.profile.operation,
      missingClaims,
      boundaries,
      verifierMode: normalized.profile.verifier.strict ? 'strict' : 'advisory'
    },
    diagnostics: normalized.diagnostics
  };
}

export function deriveClientRuntimeContract(profile, requestState = {}) {
  const normalized = normalizeProfile(profile);
  if (!normalized.ok) return normalized;

  const runtime = normalized.profile.clientRuntime;
  const request = stableObject({
    requestId: requestState.requestId ?? runtime.requestId ?? null,
    sessionId: requestState.sessionId ?? runtime.sessionId ?? null,
    tenantId: requestState.tenantId ?? runtime.tenantId ?? null,
    workspaceId: requestState.workspaceId ?? runtime.workspaceId ?? null
  });
  const idempotencyKey = runtime.idempotencyKey ?? deterministicRuntimeKey({
    profile: normalized.profile.name,
    operation: normalized.profile.operation,
    request,
    inputHash: requestState.inputHash ?? null
  });

  return {
    ok: true,
    contract: {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      adapter: normalized.profile.runtimeAdapter,
      operation: normalized.profile.operation,
      handoffTarget: runtime.handoffTarget,
      continuationMode: runtime.continuationMode,
      statusChannel: runtime.statusChannel,
      idempotencyScope: runtime.idempotencyScope,
      idempotencyKey,
      request,
      restartSafe: Boolean(idempotencyKey && runtime.statusChannel),
      userVisibleWorkflow: {
        pendingStatus: runtime.pendingStatus,
        successStatus: runtime.successStatus,
        failureStatus: normalized.profile.recovery.statusOnFailure
      }
    },
    diagnostics: [
      ...normalized.diagnostics,
      ...validateClientRuntimeContract(runtime, request)
    ]
  };
}

export function deriveProfilePermissionBoundary(profile, scope = {}, requestedEffects = []) {
  const normalized = normalizeProfile(profile);
  if (!normalized.ok) return normalized;

  const tenantId = optionalString(scope.tenantId) ?? 'tenant:local';
  const workspaceId = optionalString(scope.workspaceId) ?? 'workspace:local';
  const role = optionalString(scope.role) ?? 'automation_worker';
  const auditChannel = optionalString(scope.auditChannel) ?? 'audit.mailchimp.permission_boundary';
  const requested = uniqueSorted(requestedEffects);
  const rolePolicy = permissionPolicyForRole(role);
  const diagnostics = [
    ...normalized.diagnostics,
    ...validatePermissionScope({ tenantId, workspaceId, role, auditChannel }),
    ...validateRoleEffects(rolePolicy, requested),
    ...validateWorkspaceMemoryScope(normalized.profile.memory, { tenantId, workspaceId })
  ];
  const deniedEffects = requested
    .filter((effect) => !rolePolicy.allowedEffects.includes(effect))
    .map((effect) => ({
      effect,
      reason: 'role_permission_boundary_denied',
      role,
      requiredRole: minimumRoleForEffect(effect)
    }));
  const writeRequested = requested.includes('mailchimp.write');
  if (writeRequested && !normalized.profile.capabilities.includes('mailchimp.write')) {
    deniedEffects.push({
      effect: 'mailchimp.write',
      reason: 'profile_capability_missing',
      role,
      requiredCapability: 'mailchimp.write'
    });
  }

  const boundary = {
    schemaVersion: `${PROFILE_SCHEMA_VERSION}.permission-boundary`,
    profile: normalized.profile.name,
    operation: normalized.profile.operation,
    tenantId,
    workspaceId,
    role,
    isolationKey: deterministicRuntimeKey({
      kind: 'permission-boundary',
      profile: normalized.profile.name,
      operation: normalized.profile.operation,
      tenantId,
      workspaceId
    }),
    audit: {
      channel: auditChannel,
      handoffRequired: true,
      tenantId,
      workspaceId,
      role,
      capabilityDigest: stableHash(normalized.profile.capabilities),
      memoryDigest: stableHash(normalized.profile.memory)
    },
    permissions: {
      allowedEffects: rolePolicy.allowedEffects.filter((effect) => requested.includes(effect)),
      deniedEffects,
      requestedEffects: requested,
      roleCapabilities: rolePolicy.capabilities,
      externalWriteAllowed: writeRequested && deniedEffects.every((effect) => effect.effect !== 'mailchimp.write')
    },
    memoryBoundary: normalized.profile.memory.map((entry) => ({
      name: entry.name,
      scope: entry.scope,
      retention: entry.retention,
      tenantScoped: entry.scope !== 'global',
      workspaceScoped: ['job', 'workspace'].includes(entry.scope),
      ttlSeconds: entry.ttlSeconds
    })),
    nextAction: deniedEffects.length
      ? 'revise_effects_or_escalate_role'
      : diagnostics.some((diagnostic) => diagnostic.level === 'warning')
        ? 'handoff_with_boundary_warnings'
        : 'handoff_with_audit_boundary'
  };

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== 'error') && deniedEffects.length === 0,
    boundary,
    diagnostics: [
      ...diagnostics,
      ...deniedEffects.map((effect) => ({
        level: 'error',
        code: 'profile_permission_effect_denied',
        effect: effect.effect,
        role
      }))
    ]
  };
}

export function shapeProfileContinuationState(profile, state = {}) {
  const normalized = normalizeProfile(profile);
  if (!normalized.ok) return normalized;

  const runtime = deriveClientRuntimeContract(normalized.profile, state.request ?? state);
  const previousEvents = asArray(state.events).map(normalizeContinuationEvent).filter(Boolean);
  const commands = asArray(state.commands ?? state.command).map(normalizeContinuationCommand).filter(Boolean);
  const applied = commands.reduce(
    (current, command) => applyContinuationCommand(current, command),
    {
      generation: normalizedGeneration(state.generation),
      status: optionalString(state.status) ?? 'created',
      events: previousEvents,
      checkpoint: normalizeContinuationCheckpoint(normalized.profile, state.checkpoint),
      rollbackCheckpoint: normalizeRollbackCheckpoint(normalized.profile, state.rollbackCheckpoint)
    }
  );
  const recovery = deriveProfileContinuationRecovery(normalized.profile, applied, runtime.contract);
  const restartToken = deterministicRuntimeKey({
    version: PROFILE_CONTINUATION_STATE_VERSION,
    profile: normalized.profile.name,
    operation: normalized.profile.operation,
    generation: applied.generation,
    status: applied.status,
    checkpoint: applied.checkpoint,
    idempotencyKey: runtime.contract?.idempotencyKey ?? null
  });

  return {
    ok: recovery.status !== 'blocked',
    state: {
      schemaVersion: PROFILE_CONTINUATION_STATE_VERSION,
      profile: normalized.profile.name,
      operation: normalized.profile.operation,
      generation: applied.generation,
      status: recovery.status,
      restartToken,
      resumeAction: recovery.resumeAction,
      checkpoint: applied.checkpoint,
      rollbackCheckpoint: applied.rollbackCheckpoint,
      events: applied.events,
      idempotency: {
        key: runtime.contract?.idempotencyKey ?? null,
        scope: runtime.contract?.idempotencyScope ?? null,
        duplicateCommandIds: duplicateCommandIds(applied.events)
      }
    },
    diagnostics: [
      ...normalized.diagnostics,
      ...(runtime.diagnostics ?? []),
      ...recovery.diagnostics
    ]
  };
}

function profileFromAst(ast) {
  const result = {};
  const capabilities = [];
  const memory = [];
  const truthBoundaries = [];
  const requiredClaims = [];

  for (const declaration of ast.declarations ?? []) {
    if (declaration.kind !== 'ProfileDeclaration') continue;
    if (declaration.key === 'profile') result.name = declaration.value;
    if (declaration.key === 'adapter') result.runtimeAdapter = declaration.value;
    if (declaration.key === 'operation') result.operation = declaration.value;
    if (declaration.key === 'capability') capabilities.push(declaration.value);
    if (declaration.key === 'claim') requiredClaims.push(declaration.value);
    if (declaration.key === 'truth') truthBoundaries.push(declaration.value);
    if (declaration.key === 'rollback') result.rollback = declaration.value;
    if (declaration.key === 'statusOnFailure') result.statusOnFailure = declaration.value;
    if (declaration.key === 'memory') memory.push(parseMemoryDeclaration(declaration.value));
    if (declaration.key.startsWith('client.')) {
      result.clientRuntime = {
        ...(result.clientRuntime ?? {}),
        [declaration.key.slice(7)]: declaration.value
      };
    }
  }

  if (capabilities.length) result.capabilities = capabilities;
  if (memory.length) result.memory = memory;
  if (truthBoundaries.length) result.truthBoundaries = truthBoundaries;
  if (requiredClaims.length) result.requiredClaims = requiredClaims;
  return result;
}

function normalizeClientRuntime(input = {}) {
  const request = input.request ?? {};
  return {
    handoffTarget: stringOrDefault(input.handoffTarget, DEFAULT_CLIENT_RUNTIME.handoffTarget),
    continuationMode: stringOrDefault(input.continuationMode, DEFAULT_CLIENT_RUNTIME.continuationMode),
    statusChannel: stringOrDefault(input.statusChannel, DEFAULT_CLIENT_RUNTIME.statusChannel),
    idempotencyScope: stringOrDefault(input.idempotencyScope, DEFAULT_CLIENT_RUNTIME.idempotencyScope),
    idempotencyKey: optionalString(input.idempotencyKey),
    requestId: optionalString(input.requestId ?? request.requestId),
    sessionId: optionalString(input.sessionId ?? request.sessionId),
    tenantId: optionalString(input.tenantId ?? request.tenantId),
    workspaceId: optionalString(input.workspaceId ?? request.workspaceId),
    pendingStatus: stringOrDefault(input.pendingStatus, 'waiting_for_mailchimp_runtime'),
    successStatus: stringOrDefault(input.successStatus, 'mailchimp_runtime_handoff_complete')
  };
}

function validateClientRuntimeContract(runtime, request = {}) {
  const diagnostics = [];
  if (!runtime.handoffTarget.includes('.')) {
    diagnostics.push({ level: 'warning', code: 'client_handoff_target_not_namespaced' });
  }
  if (!runtime.statusChannel.startsWith('kernel.status.')) {
    diagnostics.push({ level: 'warning', code: 'client_status_channel_not_kernel_scoped' });
  }
  if (!runtime.idempotencyKey && !request.requestId && !runtime.requestId) {
    diagnostics.push({ level: 'warning', code: 'client_runtime_missing_request_id' });
  }
  return diagnostics;
}

function permissionPolicyForRole(role) {
  const policies = {
    viewer: {
      capabilities: ['mailchimp.read'],
      allowedEffects: ['kernel.job.enqueue', 'memory.ephemeral.write', 'verifier.claim.check']
    },
    automation_worker: {
      capabilities: ['mailchimp.read', 'mailchimp.campaign.plan', 'mailchimp.audience.segment', 'mailchimp.webhook.inspect'],
      allowedEffects: ['kernel.job.enqueue', 'memory.ephemeral.write', 'memory.bounded.write', 'verifier.claim.check']
    },
    operator: {
      capabilities: ['mailchimp.read', 'mailchimp.campaign.plan', 'mailchimp.audience.segment', 'mailchimp.webhook.inspect', 'mailchimp.write'],
      allowedEffects: ['kernel.job.enqueue', 'memory.ephemeral.write', 'memory.bounded.write', 'verifier.claim.check', 'mailchimp.write']
    }
  };
  return policies[role] ?? policies.viewer;
}

function validatePermissionScope({ tenantId, workspaceId, role, auditChannel }) {
  const diagnostics = [];
  if (!tenantId.startsWith('tenant:')) {
    diagnostics.push({ level: 'warning', code: 'profile_permission_tenant_not_namespaced', tenantId });
  }
  if (!workspaceId.startsWith('workspace:')) {
    diagnostics.push({ level: 'warning', code: 'profile_permission_workspace_not_namespaced', workspaceId });
  }
  if (!['viewer', 'automation_worker', 'operator'].includes(role)) {
    diagnostics.push({ level: 'error', code: 'profile_permission_unknown_role', role });
  }
  if (!auditChannel.startsWith('audit.')) {
    diagnostics.push({ level: 'error', code: 'profile_permission_audit_channel_not_scoped', auditChannel });
  }
  return diagnostics;
}

function validateRoleEffects(rolePolicy, requestedEffects) {
  return requestedEffects
    .filter((effect) => !rolePolicy.allowedEffects.includes(effect))
    .map((effect) => ({
      level: 'error',
      code: 'profile_permission_requested_effect_not_allowed',
      effect
    }));
}

function validateWorkspaceMemoryScope(memory, scope) {
  return memory
    .filter((entry) => entry.scope === 'global' || entry.scope === 'tenant')
    .map((entry) => ({
      level: entry.scope === 'global' ? 'error' : 'warning',
      code: entry.scope === 'global' ? 'profile_memory_global_scope_denied' : 'profile_memory_requires_tenant_audit',
      memory: entry.name,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId
    }));
}

function minimumRoleForEffect(effect) {
  if (effect === 'mailchimp.write') return 'operator';
  if (effect === 'memory.bounded.write') return 'automation_worker';
  return 'viewer';
}

function deriveProfileContinuationRecovery(profile, state, runtimeContract = {}) {
  const diagnostics = [];
  const missingMemoryCheckpoints = profile.memory
    .filter((entry) => entry.retention !== 'ephemeral')
    .filter((entry) => !state.checkpoint.memory.some((checkpoint) => checkpoint.name === entry.name))
    .map((entry) => entry.name);
  if (missingMemoryCheckpoints.length) {
    diagnostics.push({
      level: 'warning',
      code: 'bounded_memory_checkpoint_missing',
      memory: missingMemoryCheckpoints
    });
  }
  if (!runtimeContract.restartSafe) {
    diagnostics.push({ level: 'warning', code: 'continuation_runtime_not_restart_safe' });
  }
  if (state.events.some((event) => event.status === 'duplicate')) {
    diagnostics.push({ level: 'info', code: 'continuation_command_replayed' });
  }
  if (state.status === 'rollback_required' && !state.rollbackCheckpoint.action) {
    diagnostics.push({ level: 'error', code: 'rollback_checkpoint_missing_action' });
  }

  const hasErrors = diagnostics.some((diagnostic) => diagnostic.level === 'error');
  const hasWarnings = diagnostics.some((diagnostic) => diagnostic.level === 'warning');
  return {
    status: hasErrors ? 'blocked' : state.status === 'completed' ? 'completed' : hasWarnings ? 'recoverable' : state.status,
    resumeAction: hasErrors
      ? 'operator_review'
      : state.status === 'completed'
        ? 'no_op_already_completed'
        : hasWarnings
          ? 'resume_after_checkpoint_rebuild'
          : 'resume_from_checkpoint',
    diagnostics
  };
}

function normalizeContinuationCheckpoint(profile, checkpoint = {}) {
  const memoryInput = checkpoint.memory ?? checkpoint.memoryCheckpoints ?? [];
  const byName = new Map(
    asArray(memoryInput)
      .filter((entry) => entry?.name)
      .map((entry) => [
        String(entry.name),
        {
          name: String(entry.name),
          scope: entry.scope ?? 'job',
          retention: entry.retention ?? 'ephemeral',
          valueHash: entry.valueHash ?? stableHash(entry.value ?? entry.valueRef ?? null),
          status: entry.status ?? 'captured'
        }
      ])
  );
  for (const memory of profile.memory) {
    if (memory.retention === 'ephemeral' || byName.has(memory.name)) continue;
    byName.set(memory.name, {
      name: memory.name,
      scope: memory.scope,
      retention: memory.retention,
      valueHash: null,
      status: 'missing'
    });
  }
  return {
    capturedAtGeneration: normalizedGeneration(checkpoint.capturedAtGeneration),
    memory: [...byName.values()].sort((left, right) => left.name.localeCompare(right.name)),
    inputHash: checkpoint.inputHash ?? null,
    claimHash: checkpoint.claimHash ?? null
  };
}

function normalizeRollbackCheckpoint(profile, checkpoint = {}) {
  return {
    action: optionalString(checkpoint.action) ?? profile.recovery.rollback,
    failureStatus: optionalString(checkpoint.failureStatus) ?? profile.recovery.statusOnFailure,
    memoryToDiscard: uniqueSorted(checkpoint.memoryToDiscard ?? profile.memory
      .filter((entry) => entry.retention === 'ephemeral')
      .map((entry) => entry.name)),
    completed: Boolean(checkpoint.completed)
  };
}

function normalizeContinuationCommand(command = {}) {
  const op = command.op ?? command.action ?? 'checkpoint';
  if (!['checkpoint', 'status', 'rollback', 'complete'].includes(op)) return null;
  return {
    id: optionalString(command.id) ?? deterministicRuntimeKey({
      op,
      status: command.status ?? null,
      checkpoint: command.checkpoint ?? null
    }),
    op,
    status: optionalString(command.status),
    checkpoint: command.checkpoint ?? null,
    reason: optionalString(command.reason) ?? 'profile_continuation_update'
  };
}

function normalizeContinuationEvent(event = {}) {
  if (!event.id) return null;
  return {
    id: String(event.id),
    op: event.op ?? 'checkpoint',
    status: event.status ?? 'applied',
    stateStatus: event.stateStatus ?? event.nextStatus ?? null,
    generation: normalizedGeneration(event.generation),
    reason: event.reason ? String(event.reason) : 'profile_continuation_update'
  };
}

function applyContinuationCommand(state, command) {
  if (state.events.some((event) => event.id === command.id && event.status === 'applied')) {
    return {
      ...state,
      events: [
        ...state.events,
        {
          ...command,
          generation: state.generation,
          status: 'duplicate',
          stateStatus: state.status
        }
      ]
    };
  }
  const nextStatus = command.op === 'complete'
    ? 'completed'
    : command.op === 'rollback'
      ? 'rollback_required'
      : command.status ?? state.status;
  return {
    generation: state.generation + 1,
    status: nextStatus,
    checkpoint: command.checkpoint
      ? normalizeContinuationCheckpoint({ memory: state.checkpoint.memory }, command.checkpoint)
      : state.checkpoint,
    rollbackCheckpoint: state.rollbackCheckpoint,
    events: [
      ...state.events,
      {
        ...command,
        generation: state.generation + 1,
        status: 'applied',
        stateStatus: nextStatus
      }
    ]
  };
}

function duplicateCommandIds(events) {
  return uniqueSorted(events
    .filter((event) => event.status === 'duplicate')
    .map((event) => event.id));
}

function normalizedGeneration(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function parseMemoryDeclaration(value) {
  const [name, scope = 'job', retention = 'ephemeral', ttl = DEFAULT_MEMORY_TTL_SECONDS] = value
    .split(/\s+/)
    .filter(Boolean);
  return {
    name,
    scope,
    retention,
    ttlSeconds: Number(ttl)
  };
}

function mergeMemoryContracts(baseMemory, extraMemory = []) {
  const entries = [...asArray(baseMemory), ...asArray(extraMemory)];
  const byName = new Map();
  for (const entry of entries) {
    if (!entry?.name) continue;
    byName.set(entry.name, {
      name: String(entry.name),
      scope: entry.scope ?? 'job',
      retention: entry.retention ?? 'ephemeral',
      ttlSeconds: Number.isFinite(Number(entry.ttlSeconds))
        ? Math.max(60, Number(entry.ttlSeconds))
        : DEFAULT_MEMORY_TTL_SECONDS
    });
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function validateProfileContracts({ capabilities, memory, requiredClaims, truthBoundaries, clientRuntime }) {
  const diagnostics = [];
  if (!capabilities.some((capability) => capability.startsWith('mailchimp.'))) {
    diagnostics.push({ level: 'error', code: 'missing_mailchimp_capability' });
  }
  if (memory.some((entry) => entry.retention === 'permanent')) {
    diagnostics.push({ level: 'error', code: 'permanent_memory_not_allowed' });
  }
  if (requiredClaims.length === 0) {
    diagnostics.push({ level: 'warning', code: 'no_verifier_claims' });
  }
  if (truthBoundaries.length === 0) {
    diagnostics.push({ level: 'warning', code: 'no_truth_boundaries' });
  }
  diagnostics.push(...validateClientRuntimeContract(clientRuntime ?? DEFAULT_CLIENT_RUNTIME));
  return diagnostics;
}

function profileError(code, details) {
  return {
    ok: false,
    error: { code, details },
    diagnostics: [{ level: 'error', code }]
  };
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function stableObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function stringOrDefault(value, fallback) {
  const text = optionalString(value);
  return text || fallback;
}

function optionalString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function deterministicRuntimeKey(value) {
  const serialized = JSON.stringify(stableClone(value));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `client:${(hash >>> 0).toString(16).padStart(8, '0')}`;
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
