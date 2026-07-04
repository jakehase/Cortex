export const RECOVERY_CONTRACT_VERSION = "aios.language.recovery.v1";

export const RECOVERY_STATUS = Object.freeze({
  READY: "ready",
  DEGRADED: "degraded",
  RECOVERING: "recovering",
  BLOCKED: "blocked",
  FAILED: "failed"
});

const STATUS_RANK = Object.freeze({
  ready: 0,
  recovering: 1,
  degraded: 2,
  blocked: 3,
  failed: 4
});

const ACTION_BY_STATUS = Object.freeze({
  ready: "continue",
  recovering: "retry",
  degraded: "handoff",
  blocked: "request-capability",
  failed: "stop"
});

const SCHEDULE_BY_STATUS = Object.freeze({
  ready: "immediate",
  recovering: "backoff",
  degraded: "manual-review",
  blocked: "manual-approval",
  failed: "disabled"
});

export function normalizeRecoveryStatus(value = RECOVERY_STATUS.READY) {
  const status = String(value || RECOVERY_STATUS.READY).trim().toLowerCase();
  if (status === "ok" || status === "healthy") return RECOVERY_STATUS.READY;
  if (status === "retrying" || status === "pending") return RECOVERY_STATUS.RECOVERING;
  if (status === "partial" || status === "warning") return RECOVERY_STATUS.DEGRADED;
  if (status === "denied" || status === "missing-capability") return RECOVERY_STATUS.BLOCKED;
  if (status === "error" || status === "fatal") return RECOVERY_STATUS.FAILED;
  return Object.hasOwn(STATUS_RANK, status) ? status : RECOVERY_STATUS.DEGRADED;
}

export function rankRecoveryStatus(status) {
  return STATUS_RANK[normalizeRecoveryStatus(status)];
}

export function createRecoveryStatus(input = {}) {
  const status = normalizeRecoveryStatus(input.status);
  const reason = normalizeRecoveryReason(input.reason);
  const recoverable = input.recoverable ?? (status !== RECOVERY_STATUS.FAILED);
  const retryAfterMs = normalizeRetryAfter(input.retryAfterMs);
  const issues = normalizeIssues(input.issues);
  const controls = createRecoveryControls(input.controls || input);
  return Object.freeze({
    version: RECOVERY_CONTRACT_VERSION,
    status,
    reason,
    recoverable: Boolean(recoverable) && status !== RECOVERY_STATUS.FAILED,
    enabled: controls.enabled && status !== RECOVERY_STATUS.FAILED,
    nextAction: normalizeNextAction(input.nextAction || controls.nextAction || ACTION_BY_STATUS[status]),
    retryAfterMs,
    issues,
    controls
  });
}

export function mergeRecoveryStatuses(statuses = []) {
  const normalized = statuses.map((status) => createRecoveryStatus(status));
  if (normalized.length === 0) return createRecoveryStatus();
  const worst = normalized.reduce((selected, current) => {
    return rankRecoveryStatus(current.status) > rankRecoveryStatus(selected.status) ? current : selected;
  }, normalized[0]);
  const issues = normalized.flatMap((status) => status.issues);
  const retryAfterMs = normalized.reduce((max, status) => Math.max(max, status.retryAfterMs), 0);
  return createRecoveryStatus({
    status: worst.status,
    reason: worst.reason,
    recoverable: normalized.every((status) => status.recoverable),
    retryAfterMs,
    issues,
    nextAction: worst.nextAction,
    controls: mergeRecoveryControls(normalized.map((status) => status.controls))
  });
}

export function createRecoveryControls(input = {}) {
  const rawStatus = input.status ? normalizeRecoveryStatus(input.status) : null;
  const enabled = input.enabled ?? input.recoveryEnabled ?? rawStatus !== RECOVERY_STATUS.FAILED;
  const schedule = createRecoverySchedule({
    schedule: input.schedule,
    mode: input.scheduleMode,
    retryAfterMs: input.retryAfterMs,
    status: rawStatus || RECOVERY_STATUS.READY
  });
  const maxAttempts = normalizePositiveInteger(input.maxAttempts, schedule.mode === "backoff" ? 3 : 1);
  const nextAction = normalizeNextAction(input.nextAction || ACTION_BY_STATUS[rawStatus || RECOVERY_STATUS.READY]);
  return Object.freeze({
    enabled: Boolean(enabled),
    schedule,
    maxAttempts,
    nextAction,
    canRetry: Boolean(enabled) && schedule.mode !== "disabled" && maxAttempts > 0
  });
}

export function createRecoverySchedule(input = {}) {
  const status = normalizeRecoveryStatus(input.status);
  const requested = String(input.schedule || input.mode || SCHEDULE_BY_STATUS[status]).trim().toLowerCase();
  const mode = normalizeScheduleMode(requested, status);
  const retryAfterMs = normalizeRetryAfter(input.retryAfterMs ?? defaultRetryAfterForMode(mode));
  return Object.freeze({
    mode,
    retryAfterMs,
    nextRunPolicy: mode === "immediate" ? "now" : mode === "disabled" ? "none" : "after-delay"
  });
}

export function createRecoveryLifecycleState(input = {}) {
  const status = createRecoveryStatus(input.status || input);
  const controls = createRecoveryControls(input.controls || status.controls);
  const command = normalizeLifecycleCommand(input.command || controls.nextAction, status.status);
  const settingsValidation = validateRecoverySettings({ status, controls, command });
  return Object.freeze({
    version: RECOVERY_CONTRACT_VERSION,
    kind: "aios.language.recovery-lifecycle",
    status,
    controls,
    command,
    settingsValidation,
    nextActionState: Object.freeze({
      action: settingsValidation.ok ? command : "fix-settings",
      enabled: controls.enabled && settingsValidation.ok,
      schedule: controls.schedule.mode,
      retryAfterMs: controls.schedule.retryAfterMs,
      reason: status.reason
    })
  });
}

export function validateRecoverySettings(input = {}) {
  const errors = [];
  const status = input.status?.status ? input.status : createRecoveryStatus(input.status || {});
  const controls = input.controls?.schedule ? input.controls : createRecoveryControls(input.controls || {});
  const command = normalizeLifecycleCommand(input.command || controls.nextAction, status.status);
  if (status.status === RECOVERY_STATUS.FAILED && controls.enabled) errors.push("failed recovery must be disabled");
  if (controls.schedule.mode === "disabled" && controls.enabled) errors.push("disabled schedule cannot be enabled");
  if (controls.schedule.mode === "backoff" && controls.schedule.retryAfterMs <= 0) errors.push("backoff schedule requires retryAfterMs");
  if (command === "retry" && !controls.canRetry) errors.push("retry command requires retry-capable controls");
  if (command === "continue" && status.status !== RECOVERY_STATUS.READY) errors.push("continue command requires ready status");
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function classifyRecoverySignal(signal = {}) {
  if (signal instanceof Error) {
    return createRecoveryStatus({
      status: RECOVERY_STATUS.FAILED,
      reason: signal.name || "error",
      issues: [signal.message || "runtime error"],
      recoverable: false
    });
  }
  if (typeof signal === "string") {
    return createRecoveryStatus({ status: signal, reason: signal });
  }
  if (signal.ok === false || signal.error) {
    return createRecoveryStatus({
      status: signal.recoverable === false ? RECOVERY_STATUS.FAILED : RECOVERY_STATUS.DEGRADED,
      reason: signal.reason || signal.error?.code || "adapter-error",
      recoverable: signal.recoverable !== false,
      retryAfterMs: signal.retryAfterMs,
      issues: [signal.error?.message || signal.message || signal.reason || "adapter reported an error"]
    });
  }
  return createRecoveryStatus(signal);
}

export function createRecoveryHandoff(input = {}) {
  const recovery = createRecoveryStatus(input.recovery || input.status || input);
  const adapter = normalizeAdapter(input.adapter);
  const stage = normalizeName(input.stage, "runtime");
  const source = normalizeName(input.source, "aios-language");
  const lifecycle = createRecoveryLifecycleState({
    status: recovery,
    controls: input.controls || recovery.controls,
    command: input.command || recovery.nextAction
  });
  const preview = createRecoveryPreview({
    stage,
    source,
    adapter,
    recovery,
    lifecycle,
    validation: input.validation,
    context: input.context
  });
  const acceptance = createRecoveryAcceptance({
    recovery,
    lifecycle,
    preview,
    validation: input.validation,
    accepted: input.accepted
  });
  const persistence = createRecoveryPersistenceState({
    stage,
    source,
    adapter,
    recovery,
    lifecycle,
    preview,
    acceptance,
    persistedState: input.persistedState,
    commandId: input.commandId
  });
  return Object.freeze({
    version: RECOVERY_CONTRACT_VERSION,
    kind: "aios.language.recovery-handoff",
    stage,
    source,
    adapter,
    recovery,
    lifecycle,
    preview,
    acceptance,
    persistence,
    readiness: createRecoveryReadinessReport({ recovery, lifecycle, preview, acceptance }),
    handoffRequired: recovery.status !== RECOVERY_STATUS.READY,
    deterministicKey: [source, stage, adapter.name, recovery.status, recovery.reason].join(":")
  });
}

export function createRecoveryPreview(input = {}) {
  const recovery = createRecoveryStatus(input.recovery || input.status || input);
  const lifecycle = input.lifecycle?.nextActionState ? input.lifecycle : createRecoveryLifecycleState({
    status: recovery,
    controls: input.controls || recovery.controls,
    command: input.command || recovery.nextAction
  });
  const adapter = normalizeAdapter(input.adapter || "default");
  const stage = normalizeName(input.stage, "runtime");
  const source = normalizeName(input.source, "aios-language");
  const validation = normalizeValidationSummary(input.validation);
  const context = normalizePreviewContext(input.context);
  const issuePreview = recovery.issues.slice(0, 3);
  const userVisibleSummary = selectRecoveryPreviewSummary({ recovery, lifecycle, validation });
  return Object.freeze({
    version: RECOVERY_CONTRACT_VERSION,
    kind: "aios.language.recovery-preview",
    stage,
    source,
    adapterName: adapter.name,
    status: recovery.status,
    reason: recovery.reason,
    userVisibleSummary,
    issuePreview,
    validation,
    nextStep: Object.freeze({
      action: lifecycle.nextActionState.action,
      enabled: lifecycle.nextActionState.enabled,
      schedule: lifecycle.nextActionState.schedule,
      retryAfterMs: lifecycle.nextActionState.retryAfterMs,
      label: createNextStepLabel(lifecycle.nextActionState.action, recovery.status)
    }),
    context,
    deterministicKey: [source, stage, adapter.name, recovery.status, lifecycle.nextActionState.action, validation.errorCount].join(":")
  });
}

export function createRecoveryAcceptance(input = {}) {
  const recovery = createRecoveryStatus(input.recovery || input.status || input);
  const lifecycle = input.lifecycle?.nextActionState ? input.lifecycle : createRecoveryLifecycleState({
    status: recovery,
    controls: input.controls || recovery.controls,
    command: input.command || recovery.nextAction
  });
  const preview = input.preview?.kind === "aios.language.recovery-preview"
    ? input.preview
    : createRecoveryPreview({ recovery, lifecycle, validation: input.validation });
  const validation = normalizeValidationSummary(input.validation || preview.validation);
  const accepted = input.accepted ?? (recovery.status === RECOVERY_STATUS.READY && validation.ok);
  const blockers = [];
  if (!validation.ok) blockers.push(...validation.errors);
  if (!lifecycle.nextActionState.enabled) blockers.push("next action is disabled");
  if (recovery.status === RECOVERY_STATUS.FAILED) blockers.push("failed recovery cannot be accepted");
  if (recovery.status === RECOVERY_STATUS.BLOCKED && lifecycle.nextActionState.action !== "request-capability") {
    blockers.push("blocked recovery requires capability request before acceptance");
  }
  const acceptanceState = blockers.length === 0 && accepted
    ? "accepted"
    : blockers.length === 0
      ? "ready-for-acceptance"
      : "needs-attention";
  return Object.freeze({
    version: RECOVERY_CONTRACT_VERSION,
    kind: "aios.language.recovery-acceptance",
    accepted: acceptanceState === "accepted",
    state: acceptanceState,
    canAccept: blockers.length === 0,
    blockers: Object.freeze([...new Set(blockers)]),
    validation,
    nextStep: preview.nextStep,
    status: recovery.status,
    deterministicKey: [recovery.status, recovery.reason, acceptanceState, blockers.length].join(":")
  });
}

export function createRecoveryReadinessReport(input = {}) {
  const recovery = createRecoveryStatus(input.recovery || input.status || input);
  const lifecycle = input.lifecycle?.nextActionState ? input.lifecycle : createRecoveryLifecycleState({
    status: recovery,
    controls: input.controls || recovery.controls,
    command: input.command || recovery.nextAction
  });
  const preview = input.preview?.kind === "aios.language.recovery-preview" ? input.preview : createRecoveryPreview({ recovery, lifecycle });
  const acceptance = input.acceptance?.kind === "aios.language.recovery-acceptance"
    ? input.acceptance
    : createRecoveryAcceptance({ recovery, lifecycle, preview });
  const score = calculateReadinessScore({ recovery, lifecycle, preview, acceptance });
  return Object.freeze({
    version: RECOVERY_CONTRACT_VERSION,
    kind: "aios.language.recovery-readiness",
    status: recovery.status,
    score,
    ready: score >= 80 && acceptance.canAccept,
    validationSummary: preview.validation,
    nextStep: preview.nextStep,
    acceptanceState: acceptance.state,
    explain: Object.freeze(createReadinessExplanation({ recovery, lifecycle, preview, acceptance, score }))
  });
}

export function createRecoveryPersistenceState(input = {}) {
  const recovery = createRecoveryStatus(input.recovery || input.status || input);
  const lifecycle = input.lifecycle?.nextActionState ? input.lifecycle : createRecoveryLifecycleState({
    status: recovery,
    controls: input.controls || recovery.controls,
    command: input.command || recovery.nextAction
  });
  const adapter = normalizeAdapter(input.adapter || "default");
  const stage = normalizeName(input.stage, "runtime");
  const source = normalizeName(input.source, "aios-language");
  const preview = input.preview?.kind === "aios.language.recovery-preview"
    ? input.preview
    : createRecoveryPreview({ stage, source, adapter, recovery, lifecycle, validation: input.validation });
  const acceptance = input.acceptance?.kind === "aios.language.recovery-acceptance"
    ? input.acceptance
    : createRecoveryAcceptance({ recovery, lifecycle, preview, validation: preview.validation });
  const persisted = normalizePersistedRecoverySnapshot(input.persistedState || input.snapshot);
  const command = createIdempotentRecoveryCommand({
    commandId: input.commandId,
    stage,
    source,
    adapter,
    recovery,
    lifecycle,
    acceptance,
    persisted
  });
  const changed = persisted.status !== recovery.status
    || persisted.nextAction !== lifecycle.nextActionState.action
    || persisted.commandKey !== command.commandKey;
  return Object.freeze({
    version: RECOVERY_CONTRACT_VERSION,
    kind: "aios.language.recovery-persistence",
    stage,
    source,
    adapterName: adapter.name,
    status: recovery.status,
    command,
    snapshot: Object.freeze({
      status: recovery.status,
      reason: recovery.reason,
      nextAction: lifecycle.nextActionState.action,
      commandKey: command.commandKey,
      acceptanceState: acceptance.state,
      retryAfterMs: lifecycle.nextActionState.retryAfterMs,
      validationErrors: preview.validation.errorCount,
      persistedAt: "deterministic-compile"
    }),
    restart: Object.freeze({
      safeToResume: command.idempotent && recovery.status !== RECOVERY_STATUS.FAILED,
      changed,
      resumeAction: changed ? command.action : "continue",
      previousStatus: persisted.status,
      previousCommandKey: persisted.commandKey
    }),
    deterministicKey: [source, stage, adapter.name, recovery.status, command.commandKey].join(":")
  });
}

export function createIdempotentRecoveryCommand(input = {}) {
  const recovery = createRecoveryStatus(input.recovery || input.status || input);
  const lifecycle = input.lifecycle?.nextActionState ? input.lifecycle : createRecoveryLifecycleState({
    status: recovery,
    controls: input.controls || recovery.controls,
    command: input.command || recovery.nextAction
  });
  const adapter = normalizeAdapter(input.adapter || "default");
  const stage = normalizeName(input.stage, "runtime");
  const source = normalizeName(input.source, "aios-language");
  const action = normalizeLifecycleCommand(input.action || lifecycle.nextActionState.action, recovery.status);
  const persisted = normalizePersistedRecoverySnapshot(input.persisted);
  const commandKey = [
    source,
    stage,
    adapter.name,
    action,
    recovery.status,
    recovery.reason,
    lifecycle.nextActionState.schedule
  ].join(":");
  const duplicateOfPersisted = persisted.commandKey === commandKey && persisted.status === recovery.status;
  return Object.freeze({
    version: RECOVERY_CONTRACT_VERSION,
    kind: "aios.language.recovery-command",
    commandId: normalizeName(input.commandId || commandKey, "recovery-command"),
    commandKey,
    action,
    idempotent: true,
    duplicateOfPersisted,
    enabled: lifecycle.nextActionState.enabled && action !== "stop",
    schedule: lifecycle.nextActionState.schedule,
    retryAfterMs: lifecycle.nextActionState.retryAfterMs,
    target: Object.freeze({
      source,
      stage,
      adapterName: adapter.name,
      statusEndpoint: adapter.statusEndpoint
    })
  });
}

export function validateRecoveryPersistenceState(contract) {
  const errors = [];
  if (!contract || contract.version !== RECOVERY_CONTRACT_VERSION) errors.push("recovery persistence version mismatch");
  if (contract?.kind !== "aios.language.recovery-persistence") errors.push("recovery persistence kind mismatch");
  if (!contract?.command?.commandKey) errors.push("recovery persistence command key is required");
  if (!contract?.snapshot?.status) errors.push("recovery persistence snapshot status is required");
  if (!contract?.restart) errors.push("recovery restart state is required");
  if (contract?.command?.enabled && contract?.status === RECOVERY_STATUS.FAILED) {
    errors.push("failed recovery command cannot be enabled");
  }
  if (contract?.restart?.safeToResume && !contract?.command?.idempotent) {
    errors.push("restart-safe recovery command must be idempotent");
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function negotiateRecoveryCapabilities(requested = [], offered = [], options = {}) {
  const required = normalizeCapabilitySet(requested);
  const available = normalizeCapabilitySet(offered);
  const optional = new Set(normalizeCapabilitySet(options.optionalCapabilities || options.optional || []));
  const aliases = normalizeCapabilityAliases(options.aliases || {});
  const granted = [];
  const missing = [];
  const degraded = [];
  for (const capability of required) {
    const candidates = [capability, ...(aliases[capability] || [])];
    const match = candidates.find((candidate) => available.includes(candidate));
    if (match) {
      granted.push(Object.freeze({
        requested: capability,
        provided: match,
        exact: match === capability
      }));
    } else if (optional.has(capability)) {
      degraded.push(capability);
    } else {
      missing.push(capability);
    }
  }
  const status = missing.length > 0
    ? RECOVERY_STATUS.BLOCKED
    : degraded.length > 0
      ? RECOVERY_STATUS.DEGRADED
      : RECOVERY_STATUS.READY;
  return Object.freeze({
    requested: Object.freeze(required),
    offered: Object.freeze(available),
    granted: Object.freeze(granted),
    missing: Object.freeze(missing),
    degraded: Object.freeze(degraded),
    status,
    complete: missing.length === 0,
    summary: Object.freeze({
      requested: required.length,
      granted: granted.length,
      missing: missing.length,
      degraded: degraded.length
    })
  });
}

export function createProviderServiceContract(input = {}) {
  const provider = normalizeName(input.provider || input.name, "mailchimp");
  const service = normalizeName(input.service, "marketing");
  const endpoints = createProviderEndpoints(input.endpoints || input.endpoint || {});
  const sync = createProviderSyncMetadata(input.sync || input);
  const negotiation = negotiateRecoveryCapabilities(input.requiredCapabilities || input.capabilities || [], input.offeredCapabilities || input.providerCapabilities || [], {
    optionalCapabilities: input.optionalCapabilities,
    aliases: input.capabilityAliases
  });
  const signal = input.signal ? classifyRecoverySignal(input.signal) : createRecoveryStatus({
    status: negotiation.status,
    reason: negotiation.complete ? `${provider}-provider-ready` : `${provider}-capability-negotiation`,
    issues: negotiation.missing.map((capability) => `provider missing capability ${capability}`),
    recoverable: negotiation.missing.length === 0,
    retryAfterMs: sync.retryAfterMs,
    controls: {
      enabled: input.enabled ?? negotiation.missing.length === 0,
      schedule: negotiation.status === RECOVERY_STATUS.DEGRADED ? "manual-review" : sync.schedule,
      retryAfterMs: sync.retryAfterMs,
      maxAttempts: negotiation.missing.length > 0 ? 0 : sync.maxAttempts,
      nextAction: negotiation.missing.length > 0 ? "request-capability" : undefined
    }
  });
  const lifecycle = createRecoveryLifecycleState({
    status: signal,
    controls: signal.controls,
    command: input.command || signal.nextAction
  });
  return Object.freeze({
    version: RECOVERY_CONTRACT_VERSION,
    kind: "aios.language.provider-service-contract",
    provider,
    service,
    endpoints,
    sync,
    negotiation,
    status: signal.status,
    recovery: signal,
    lifecycle,
    externalHandoff: Object.freeze({
      required: signal.status !== RECOVERY_STATUS.READY || negotiation.missing.length > 0,
      target: `${provider}.${service}`,
      endpoint: endpoints.statusEndpoint || endpoints.syncEndpoint,
      action: lifecycle.nextActionState.action,
      deterministicKey: [provider, service, signal.status, negotiation.summary.missing, sync.cursor].join(":")
    })
  });
}

export function createExternalRecoveryHandoff(input = {}) {
  const providerContract = createProviderServiceContract(input);
  const handoff = createRecoveryHandoff({
    stage: input.stage || "provider",
    source: input.source || providerContract.service,
    adapter: {
      name: providerContract.provider,
      statusEndpoint: providerContract.endpoints.statusEndpoint
    },
    status: providerContract.recovery,
    controls: providerContract.lifecycle.controls,
    command: providerContract.lifecycle.command
  });
  return Object.freeze({
    version: RECOVERY_CONTRACT_VERSION,
    kind: "aios.language.external-recovery-handoff",
    provider: providerContract,
    handoff,
    sync: providerContract.sync,
    negotiation: providerContract.negotiation,
    handoffRequired: providerContract.externalHandoff.required || handoff.handoffRequired
  });
}

export function createClientRuntimeAdoptionPlan(input = {}) {
  const provider = input.providerContract?.kind === "aios.language.provider-service-contract"
    ? input.providerContract
    : createProviderServiceContract(input.provider || {});
  const recoveryInput = input.recovery?.kind === "aios.language.recovery-handoff" ? input.recovery.recovery : input.recovery;
  const recovery = recoveryInput?.version === RECOVERY_CONTRACT_VERSION
    ? recoveryInput
    : createRecoveryStatus(recoveryInput || provider.recovery);
  const lifecycle = input.lifecycle?.nextActionState
    ? input.lifecycle
    : createRecoveryLifecycleState({
      status: recovery,
      controls: input.controls || recovery.controls,
      command: input.command || recovery.nextAction
    });
  const validation = normalizeValidationSummary(input.validation);
  const packageName = normalizeName(input.packageName || input.source, provider.service);
  const runtimeBindings = createClientRuntimeBindings(input.runtimeContracts || input.runtimes || [], lifecycle);
  const clients = normalizeAdoptionClients(input.clients || input.client || input.channels, provider);
  const handoff = createRecoveryHandoff({
    stage: input.stage || "client-adoption",
    source: packageName,
    adapter: {
      name: provider.provider,
      statusEndpoint: provider.endpoints.statusEndpoint
    },
    status: recovery,
    controls: lifecycle.controls,
    command: lifecycle.nextActionState.action,
    validation,
    context: {
      subject: packageName,
      exportName: packageName,
      auditId: input.auditId || `${provider.provider}.${provider.service}.client-adoption`
    }
  });
  const clientStates = clients.map((client) => createClientAdoptionState({
    client,
    provider,
    lifecycle,
    validation,
    runtimeBindings,
    handoff
  }));
  const summary = createClientAdoptionSummary({ provider, recovery, lifecycle, validation, clients: clientStates, runtimeBindings });
  return Object.freeze({
    version: RECOVERY_CONTRACT_VERSION,
    kind: "aios.language.client-runtime-adoption",
    packageName,
    provider: Object.freeze({
      name: provider.provider,
      service: provider.service,
      status: provider.status,
      endpoint: provider.externalHandoff.endpoint
    }),
    summary,
    clients: Object.freeze(clientStates),
    runtimeBindings,
    handoff,
    nextActionState: Object.freeze({
      action: summary.nextAction,
      enabled: summary.enabled,
      schedule: lifecycle.nextActionState.schedule,
      retryAfterMs: lifecycle.nextActionState.retryAfterMs,
      reason: summary.reason,
      targetClientIds: Object.freeze(clientStates.filter((client) => client.enabled).map((client) => client.id))
    }),
    deterministicKey: [
      packageName,
      provider.provider,
      provider.service,
      summary.status,
      summary.clientCount,
      summary.runtimeBindingCount,
      summary.nextAction
    ].join(":")
  });
}

export function validateClientRuntimeAdoptionPlan(contract) {
  const errors = [];
  if (!contract || contract.version !== RECOVERY_CONTRACT_VERSION) errors.push("client adoption version mismatch");
  if (contract?.kind !== "aios.language.client-runtime-adoption") errors.push("client adoption kind mismatch");
  if (!contract?.packageName) errors.push("client adoption package name is required");
  if (!contract?.provider?.name) errors.push("client adoption provider name is required");
  if (!Array.isArray(contract?.clients) || contract.clients.length === 0) errors.push("client adoption clients are required");
  if (!Array.isArray(contract?.runtimeBindings)) errors.push("client adoption runtime bindings must be an array");
  if (!contract?.summary?.status) errors.push("client adoption summary status is required");
  if (!contract?.nextActionState?.action) errors.push("client adoption next action is required");
  if (contract?.summary?.enabled && contract?.summary?.blockedClientCount > 0) {
    errors.push("client adoption cannot be enabled with blocked clients");
  }
  if (contract?.summary?.runtimeBindingCount !== contract?.runtimeBindings?.length) {
    errors.push("client adoption runtime binding counter mismatch");
  }
  for (const client of contract?.clients || []) {
    if (!client.id) errors.push("client adoption client id is required");
    if (!client.channel) errors.push(`client adoption channel is required for ${client.id || "client"}`);
    if (client.enabled && client.status === RECOVERY_STATUS.BLOCKED) {
      errors.push(`blocked client cannot be enabled: ${client.id}`);
    }
    if (!Array.isArray(client.runtimeJobIds)) {
      errors.push(`client runtime bindings are required for ${client.id || "client"}`);
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function validateProviderServiceContract(contract) {
  const errors = [];
  if (!contract || contract.version !== RECOVERY_CONTRACT_VERSION) errors.push("provider contract version mismatch");
  if (contract?.kind !== "aios.language.provider-service-contract") errors.push("provider contract kind mismatch");
  if (!contract?.provider) errors.push("provider name is required");
  if (!contract?.service) errors.push("provider service is required");
  if (!contract?.sync?.cursor) errors.push("provider sync cursor is required");
  if (!Array.isArray(contract?.negotiation?.requested)) errors.push("provider requested capabilities must be an array");
  if (!Array.isArray(contract?.negotiation?.missing)) errors.push("provider missing capabilities must be an array");
  const recovery = assertRecoveryContract(contract?.recovery);
  if (!recovery.ok) errors.push(...recovery.errors.map((error) => `provider:${error}`));
  if (contract?.negotiation?.missing?.length > 0 && contract?.lifecycle?.nextActionState?.action !== "request-capability") {
    errors.push("missing provider capabilities require request-capability action");
  }
  if (contract?.externalHandoff?.required && !contract?.externalHandoff?.target) {
    errors.push("provider external handoff target is required");
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function validateRecoveryPreview(contract) {
  const errors = [];
  if (!contract || contract.version !== RECOVERY_CONTRACT_VERSION) errors.push("recovery preview version mismatch");
  if (contract?.kind !== "aios.language.recovery-preview") errors.push("recovery preview kind mismatch");
  if (!contract?.stage) errors.push("recovery preview stage is required");
  if (!contract?.source) errors.push("recovery preview source is required");
  if (!contract?.nextStep?.action) errors.push("recovery preview next step is required");
  if (!contract?.validation || typeof contract.validation.ok !== "boolean") errors.push("recovery preview validation summary is required");
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function assertRecoveryContract(contract) {
  const errors = [];
  if (!contract || contract.version !== RECOVERY_CONTRACT_VERSION) {
    errors.push("recovery contract version mismatch");
  }
  if (!contract?.status || !Object.hasOwn(STATUS_RANK, contract.status)) {
    errors.push("recovery status is invalid");
  }
  if (contract?.retryAfterMs < 0 || !Number.isInteger(contract?.retryAfterMs)) {
    errors.push("recovery retryAfterMs must be a non-negative integer");
  }
  if (contract?.controls) {
    const settings = validateRecoverySettings({ status: contract, controls: contract.controls, command: contract.nextAction });
    if (!settings.ok) errors.push(...settings.errors);
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function selfCheckRecoveryApi() {
  const merged = mergeRecoveryStatuses([
    { status: "ready" },
    { status: "missing-capability", reason: "capability:mailchimp.write", issues: ["capability missing"] }
  ]);
  const handoff = createRecoveryHandoff({ stage: "adapter", adapter: "mailchimp", status: merged });
  const provider = createProviderServiceContract({
    provider: "mailchimp",
    service: "audience-sync",
    requiredCapabilities: ["mailchimp.audience:read", "mailchimp.campaign:write"],
    offeredCapabilities: ["mailchimp.audience:read"],
    sync: { cursor: "audience:001", schedule: "manual-approval" }
  });
  const providerValidation = validateProviderServiceContract(provider);
  const preview = createRecoveryPreview({ stage: "adapter", source: "audience-sync", adapter: "mailchimp", recovery: merged });
  const acceptance = createRecoveryAcceptance({ recovery: merged, preview });
  const persistenceValidation = validateRecoveryPersistenceState(handoff.persistence);
  return Object.freeze({
    ok: merged.status === RECOVERY_STATUS.BLOCKED
      && handoff.handoffRequired === true
      && handoff.lifecycle.nextActionState.action === "request-capability"
      && persistenceValidation.ok
      && handoff.persistence.restart.safeToResume === true
      && validateRecoveryPreview(preview).ok
      && acceptance.canAccept === true
      && providerValidation.ok
      && provider.negotiation.missing.length === 1,
    sample: handoff,
    provider,
    preview,
    acceptance
  });
}

function createProviderEndpoints(input = {}) {
  if (typeof input === "string") {
    return Object.freeze({
      statusEndpoint: input,
      syncEndpoint: input,
      recoveryEndpoint: null
    });
  }
  return Object.freeze({
    statusEndpoint: input.statusEndpoint ? String(input.statusEndpoint) : null,
    syncEndpoint: input.syncEndpoint ? String(input.syncEndpoint) : input.endpoint ? String(input.endpoint) : null,
    recoveryEndpoint: input.recoveryEndpoint ? String(input.recoveryEndpoint) : null
  });
}

function createProviderSyncMetadata(input = {}) {
  const cursor = normalizeName(input.cursor || input.syncCursor || input.lastSyncCursor, "initial");
  const watermark = normalizeName(input.watermark || input.syncWatermark || input.updatedAt, "deterministic-compile");
  const schedule = normalizeScheduleMode(input.schedule || input.syncSchedule || "backoff", RECOVERY_STATUS.RECOVERING);
  const retryAfterMs = normalizeRetryAfter(input.retryAfterMs ?? (schedule === "backoff" ? 2000 : 0));
  const maxAttempts = normalizePositiveInteger(input.maxAttempts, schedule === "disabled" ? 0 : 3);
  return Object.freeze({
    cursor,
    watermark,
    schedule,
    retryAfterMs,
    maxAttempts,
    mode: input.mode ? normalizeName(input.mode, "incremental") : "incremental",
    deterministicKey: [cursor, watermark, schedule, retryAfterMs].join(":")
  });
}

function createClientRuntimeBindings(runtimeContracts, lifecycle) {
  const bindings = Array.isArray(runtimeContracts) ? runtimeContracts : [];
  return Object.freeze(bindings.map((runtime, index) => {
    const runtimeStatus = normalizeRecoveryStatus(runtime?.status || runtime?.analytics?.summary?.status);
    const blocked = runtimeStatus === RECOVERY_STATUS.BLOCKED || runtimeStatus === RECOVERY_STATUS.FAILED;
    return Object.freeze({
      order: index + 1,
      jobId: runtime?.job?.id || `runtime-${index + 1}`,
      exportName: normalizeName(runtime?.analytics?.summary?.exportName || runtime?.job?.name, `runtime-${index + 1}`),
      status: runtimeStatus,
      enabled: lifecycle.nextActionState.enabled && !blocked,
      nextAction: blocked ? "request-boundary-approval" : lifecycle.nextActionState.action,
      auditId: runtime?.audit?.auditId || null,
      verifierDigest: runtime?.verifier?.digest || null,
      capabilityCount: Array.isArray(runtime?.capabilities) ? runtime.capabilities.length : 0
    });
  }));
}

function normalizeAdoptionClients(input, provider) {
  const list = Array.isArray(input) ? input : [input].filter(Boolean);
  const source = list.length > 0 ? list : [
    Object.freeze({
      id: `${provider.provider}-primary-client`,
      name: `${provider.provider} primary client`,
      channel: "web",
      enabled: true
    })
  ];
  return Object.freeze(source.map((client, index) => {
    if (typeof client === "string") {
      return Object.freeze({
        id: normalizeName(client, `client-${index + 1}`),
        name: normalizeName(client, `client-${index + 1}`),
        channel: inferClientChannel(client),
        requestedEnabled: true
      });
    }
    const label = client.name || client.id || client.channel || `client-${index + 1}`;
    return Object.freeze({
      id: normalizeName(client.id || label, `client-${index + 1}`),
      name: String(client.name || label).trim() || `client-${index + 1}`,
      channel: inferClientChannel(client.channel || label),
      requestedEnabled: client.enabled ?? client.clientEnabled ?? true
    });
  }));
}

function createClientAdoptionState({ client, provider, lifecycle, validation, runtimeBindings, handoff }) {
  const blockedBindings = runtimeBindings.filter((binding) => binding.status === RECOVERY_STATUS.BLOCKED || binding.status === RECOVERY_STATUS.FAILED);
  const missingProviderCapabilities = provider.negotiation.missing.length;
  const blocked = validation.errorCount > 0 || missingProviderCapabilities > 0 || blockedBindings.length > 0;
  const status = blocked
    ? RECOVERY_STATUS.BLOCKED
    : lifecycle.status.status === RECOVERY_STATUS.DEGRADED || provider.status === RECOVERY_STATUS.DEGRADED
      ? RECOVERY_STATUS.DEGRADED
      : RECOVERY_STATUS.READY;
  const enabled = Boolean(client.requestedEnabled) && lifecycle.nextActionState.enabled && status !== RECOVERY_STATUS.BLOCKED;
  const action = blocked
    ? missingProviderCapabilities > 0 ? "request-capability" : "request-boundary-approval"
    : lifecycle.nextActionState.action;
  return Object.freeze({
    id: client.id,
    name: client.name,
    channel: client.channel,
    status,
    enabled,
    requestedEnabled: Boolean(client.requestedEnabled),
    nextAction: action,
    handoffRequired: handoff.handoffRequired || status !== RECOVERY_STATUS.READY,
    handoffTarget: provider.externalHandoff.target,
    handoffEndpoint: provider.externalHandoff.endpoint,
    runtimeJobIds: Object.freeze(runtimeBindings.map((binding) => binding.jobId)),
    blockedRuntimeJobIds: Object.freeze(blockedBindings.map((binding) => binding.jobId)),
    issueCount: validation.errorCount + missingProviderCapabilities + blockedBindings.length
  });
}

function createClientAdoptionSummary({ provider, recovery, lifecycle, validation, clients, runtimeBindings }) {
  const blockedClientCount = clients.filter((client) => client.status === RECOVERY_STATUS.BLOCKED).length;
  const degradedClientCount = clients.filter((client) => client.status === RECOVERY_STATUS.DEGRADED).length;
  const enabledClientCount = clients.filter((client) => client.enabled).length;
  const status = blockedClientCount > 0
    ? RECOVERY_STATUS.BLOCKED
    : degradedClientCount > 0 || recovery.status === RECOVERY_STATUS.DEGRADED || provider.status === RECOVERY_STATUS.DEGRADED
      ? RECOVERY_STATUS.DEGRADED
      : RECOVERY_STATUS.READY;
  const nextAction = status === RECOVERY_STATUS.BLOCKED
    ? provider.negotiation.missing.length > 0 ? "request-capability" : "request-boundary-approval"
    : lifecycle.nextActionState.action;
  return Object.freeze({
    status,
    enabled: enabledClientCount > 0 && blockedClientCount === 0 && validation.ok,
    reason: status === RECOVERY_STATUS.READY ? "client-adoption-ready" : status === RECOVERY_STATUS.DEGRADED ? "client-adoption-review" : "client-adoption-blocked",
    nextAction,
    clientCount: clients.length,
    enabledClientCount,
    blockedClientCount,
    degradedClientCount,
    runtimeBindingCount: runtimeBindings.length,
    missingProviderCapabilities: provider.negotiation.missing.length,
    validation
  });
}

function inferClientChannel(value) {
  const normalized = normalizeName(value, "web").replaceAll(" ", "-");
  if (normalized.includes("api")) return "api";
  if (normalized.includes("webhook")) return "webhook";
  if (normalized.includes("worker") || normalized.includes("job")) return "worker";
  if (normalized.includes("mobile")) return "mobile";
  return "web";
}

function normalizeCapabilitySet(values = []) {
  const list = Array.isArray(values) ? values : [values];
  return Object.freeze([...new Set(list.flatMap((value) => String(value || "").split(",")).map(normalizeCapabilityToken).filter(Boolean))]);
}

function normalizeCapabilityToken(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  const [name, mode = "use"] = text.split(":");
  const normalizedName = name.replace(/[^a-z0-9.]+/g, ".").replace(/^\.+|\.+$/g, "");
  const normalizedMode = ["read", "write", "execute", "use", "*"].includes(mode) ? mode : "use";
  return normalizedName ? `${normalizedName}:${normalizedMode}` : "";
}

function normalizeCapabilityAliases(input = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(input).map(([key, value]) => {
    return [normalizeCapabilityToken(key), normalizeCapabilitySet(value)];
  }).filter(([key]) => Boolean(key))));
}

function mergeRecoveryControls(controls = []) {
  const normalized = controls.map((control) => createRecoveryControls(control));
  if (normalized.length === 0) return createRecoveryControls();
  const enabled = normalized.every((control) => control.enabled);
  const maxAttempts = Math.min(...normalized.map((control) => control.maxAttempts));
  const selected = normalized.reduce((current, control) => {
    return scheduleRank(control.schedule.mode) > scheduleRank(current.schedule.mode) ? control : current;
  }, normalized[0]);
  return createRecoveryControls({
    enabled,
    schedule: selected.schedule.mode,
    retryAfterMs: Math.max(...normalized.map((control) => control.schedule.retryAfterMs)),
    maxAttempts,
    nextAction: selected.nextAction
  });
}

function normalizeAdapter(adapter = "default") {
  if (typeof adapter === "string") {
    return Object.freeze({ name: normalizeName(adapter, "default"), statusEndpoint: null });
  }
  return Object.freeze({
    name: normalizeName(adapter.name, "default"),
    statusEndpoint: adapter.statusEndpoint ? String(adapter.statusEndpoint) : null
  });
}

function normalizeIssues(issues = []) {
  const list = Array.isArray(issues) ? issues : [issues];
  return Object.freeze([...new Set(list.map((issue) => String(issue || "").trim()).filter(Boolean))]);
}

function normalizeValidationSummary(input = {}) {
  const rawErrors = input?.errors || [];
  const errors = normalizeIssues(rawErrors);
  const rawWarnings = input?.warnings || input?.warning || [];
  const warnings = normalizeIssues(rawWarnings);
  const ok = input?.ok ?? errors.length === 0;
  return Object.freeze({
    ok: Boolean(ok) && errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings
  });
}

function normalizePersistedRecoverySnapshot(input = {}) {
  const hasInput = input && typeof input === "object";
  return Object.freeze({
    status: hasInput && input.status ? normalizeRecoveryStatus(input.status) : "none",
    reason: hasInput && input.reason ? normalizeRecoveryReason(input.reason) : "none",
    nextAction: hasInput && input.nextAction ? normalizeNextAction(input.nextAction) : "none",
    commandKey: hasInput && input.commandKey ? String(input.commandKey) : "none",
    acceptanceState: hasInput && input.acceptanceState ? normalizeName(input.acceptanceState, "unknown") : "unknown"
  });
}

function normalizePreviewContext(input = {}) {
  return Object.freeze({
    subject: input.subject ? normalizeName(input.subject, "runtime") : null,
    exportName: input.exportName ? normalizeName(input.exportName, "export") : null,
    tenantId: input.tenantId ? normalizeName(input.tenantId, "tenant") : null,
    workspaceId: input.workspaceId ? normalizeName(input.workspaceId, "workspace") : null,
    auditId: input.auditId ? String(input.auditId) : null
  });
}

function selectRecoveryPreviewSummary({ recovery, lifecycle, validation }) {
  if (!validation.ok) return `Validation requires attention before ${lifecycle.nextActionState.action}`;
  if (recovery.status === RECOVERY_STATUS.READY) return "Ready to continue";
  if (recovery.status === RECOVERY_STATUS.RECOVERING) return "Recovery is scheduled for retry";
  if (recovery.status === RECOVERY_STATUS.DEGRADED) return "Manual review is required before continuing";
  if (recovery.status === RECOVERY_STATUS.BLOCKED) return "Capability or boundary approval is required";
  return "Recovery is stopped";
}

function createNextStepLabel(action, status) {
  const normalizedAction = normalizeNextAction(action);
  if (normalizedAction === "request-capability") return "Request missing capability";
  if (normalizedAction === "request-boundary-approval") return "Request boundary approval";
  if (normalizedAction === "fix-settings") return "Fix recovery settings";
  if (normalizedAction === "handoff") return "Send to manual review";
  if (normalizedAction === "retry") return "Retry recovery";
  if (normalizedAction === "stop" || normalizeRecoveryStatus(status) === RECOVERY_STATUS.FAILED) return "Stop workflow";
  return "Continue workflow";
}

function calculateReadinessScore({ recovery, lifecycle, preview, acceptance }) {
  let score = 100;
  score -= rankRecoveryStatus(recovery.status) * 18;
  score -= preview.validation.errorCount * 12;
  score -= preview.validation.warningCount * 4;
  if (!lifecycle.nextActionState.enabled) score -= 20;
  if (!acceptance.canAccept) score -= 20;
  return Math.max(0, Math.min(100, score));
}

function createReadinessExplanation({ recovery, lifecycle, preview, acceptance, score }) {
  const notes = [];
  notes.push(`status:${recovery.status}`);
  notes.push(`action:${lifecycle.nextActionState.action}`);
  if (preview.validation.errorCount > 0) notes.push(`validation-errors:${preview.validation.errorCount}`);
  if (!acceptance.canAccept) notes.push(`blockers:${acceptance.blockers.length}`);
  notes.push(score >= 80 ? "readiness:high" : score >= 50 ? "readiness:medium" : "readiness:low");
  return notes;
}

function normalizeRecoveryReason(reason = "none") {
  return normalizeName(reason, "none").replaceAll(" ", "-");
}

function normalizeRetryAfter(value = 0) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function normalizeNextAction(value = "continue") {
  const normalized = normalizeName(value, "continue").replaceAll(" ", "-");
  return normalized || "continue";
}

function normalizeLifecycleCommand(value, status) {
  const command = normalizeNextAction(value || ACTION_BY_STATUS[normalizeRecoveryStatus(status)]);
  const allowed = ["continue", "retry", "handoff", "request-capability", "request-boundary-approval", "stop", "fix-settings"];
  return allowed.includes(command) ? command : ACTION_BY_STATUS[normalizeRecoveryStatus(status)];
}

function normalizeScheduleMode(value, status) {
  const mode = normalizeName(value, SCHEDULE_BY_STATUS[status]).replaceAll(" ", "-");
  if (["immediate", "backoff", "manual-review", "manual-approval", "disabled"].includes(mode)) return mode;
  return SCHEDULE_BY_STATUS[status];
}

function scheduleRank(mode) {
  return { immediate: 0, backoff: 1, "manual-review": 2, "manual-approval": 3, disabled: 4 }[mode] ?? 2;
}

function defaultRetryAfterForMode(mode) {
  if (mode === "backoff") return 1000;
  if (mode === "manual-review" || mode === "manual-approval") return 0;
  return 0;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function normalizeName(value, fallback) {
  const normalized = String(value || fallback).trim().toLowerCase();
  return normalized || fallback;
}
