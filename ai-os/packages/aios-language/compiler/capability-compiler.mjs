const MAILCHIMP_ALLOWED_ACTIONS = new Set([
  "campaign.read",
  "campaign.create",
  "campaign.update",
  "campaign.schedule",
  "audience.read",
  "audience.segment.read",
  "template.read",
  "report.read"
]);

const MAILCHIMP_ACTION_SCOPES = {
  "campaign.read": ["mailchimp:campaigns:read"],
  "campaign.create": ["mailchimp:campaigns:write"],
  "campaign.update": ["mailchimp:campaigns:write"],
  "campaign.schedule": ["mailchimp:campaigns:schedule"],
  "audience.read": ["mailchimp:lists:read"],
  "audience.segment.read": ["mailchimp:segments:read"],
  "template.read": ["mailchimp:templates:read"],
  "report.read": ["mailchimp:reports:read"]
};

const RISK_BY_ACTION = {
  "campaign.create": "medium",
  "campaign.update": "medium",
  "campaign.schedule": "high"
};

const DEFAULT_ACTION_LIFECYCLE = {
  enabled: true,
  scheduleWindow: "runtime",
  maxInvocations: 1,
  nextAction: "ready"
};

const ACTION_LIFECYCLE_OVERRIDES = {
  "campaign.read": {
    scheduleWindow: "preflight",
    maxInvocations: 3,
    nextAction: "hydrate-campaign"
  },
  "campaign.create": {
    scheduleWindow: "operator-approved",
    nextAction: "await-create-approval"
  },
  "campaign.update": {
    scheduleWindow: "operator-approved",
    nextAction: "await-update-approval"
  },
  "campaign.schedule": {
    enabled: false,
    scheduleWindow: "manual-approval",
    nextAction: "collect-schedule-approval"
  },
  "audience.read": {
    scheduleWindow: "preflight",
    maxInvocations: 2,
    nextAction: "hydrate-audience"
  },
  "audience.segment.read": {
    scheduleWindow: "preflight",
    maxInvocations: 2,
    nextAction: "hydrate-segment"
  },
  "template.read": {
    scheduleWindow: "preflight",
    maxInvocations: 2,
    nextAction: "hydrate-template"
  },
  "report.read": {
    scheduleWindow: "post-run",
    maxInvocations: 1,
    nextAction: "collect-report"
  }
};

const ACTION_PROVIDER_OPERATIONS = {
  "campaign.read": {
    serviceOperation: "GET /campaigns/{campaign_id}",
    handoffState: "provider-read-ready",
    requiredMemory: ["campaignDraft"],
    externalWrite: false
  },
  "campaign.create": {
    serviceOperation: "POST /campaigns",
    handoffState: "approval-required-before-provider-create",
    requiredMemory: ["campaignDraft", "rollbackJournal"],
    externalWrite: true
  },
  "campaign.update": {
    serviceOperation: "PATCH /campaigns/{campaign_id}",
    handoffState: "approval-required-before-provider-update",
    requiredMemory: ["campaignDraft", "rollbackJournal"],
    externalWrite: true
  },
  "campaign.schedule": {
    serviceOperation: "POST /campaigns/{campaign_id}/actions/schedule",
    handoffState: "manual-schedule-approval-required",
    requiredMemory: ["campaignDraft", "verifierEvidence", "rollbackJournal"],
    externalWrite: true
  },
  "audience.read": {
    serviceOperation: "GET /lists/{list_id}",
    handoffState: "provider-read-ready",
    requiredMemory: ["audienceSnapshot"],
    externalWrite: false
  },
  "audience.segment.read": {
    serviceOperation: "GET /lists/{list_id}/segments",
    handoffState: "provider-read-ready",
    requiredMemory: ["audienceSnapshot"],
    externalWrite: false
  },
  "template.read": {
    serviceOperation: "GET /templates/{template_id}",
    handoffState: "provider-read-ready",
    requiredMemory: ["campaignDraft"],
    externalWrite: false
  },
  "report.read": {
    serviceOperation: "GET /reports/{campaign_id}",
    handoffState: "post-run-report-read",
    requiredMemory: ["verifierEvidence"],
    externalWrite: false
  }
};

const PROVIDER_RATE_LIMIT_PROFILE = {
  budgetKey: "mailchimp-marketing-api.default",
  maxBurst: 10,
  windowSeconds: 60,
  retryAfterHeader: "Retry-After"
};

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeBoolean(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return numeric;
}

function stableCapabilityId(seed) {
  const text = JSON.stringify(seed, Object.keys(seed).sort());
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function compileTenantBoundary(options = {}, diagnostics = []) {
  const tenantId = options.tenantId || options.accountId || "unbound-tenant";
  const workspaceId = options.workspaceId || "local-workspace";
  const actorRole = options.actorRole || "runtime-operator";
  const allowedRoles = new Set(["runtime-operator", "workspace-admin", "automation-service"]);

  if (!allowedRoles.has(actorRole)) {
    diagnostics.push({
      level: "error",
      code: "capability.boundary.role.unsupported",
      message: `Unsupported Mailchimp capability actor role: ${actorRole}`,
      role: actorRole
    });
  }

  return {
    tenantId,
    workspaceId,
    actorRole,
    isolationKey: `mailchimp:${tenantId}:${workspaceId}`,
    allowedRoles: Array.from(allowedRoles),
    permissionBoundary: {
      crossTenantAccess: false,
      workspaceScoped: true,
      externalProviderWriteRequiresApproval: options.requireHumanApproval !== false,
      auditRequired: true
    },
    auditHandoff: {
      stream: `audit.mailchimp.${tenantId}.${workspaceId}`,
      requiredEvents: [
        "capability.command.adopted",
        "capability.command.queued",
        "capability.command.provider_acknowledged",
        "capability.command.operator_review"
      ],
      redactProviderPayloads: true
    }
  };
}

function compileRuntimeCommandState(operation) {
  const isWrite = operation.externalWrite === true;
  const approvalRequired = operation.settingsControls.approvalRequired === true;
  const commandId = `mailchimp_${operation.action.replace(/\W+/g, "_")}_${stableCapabilityId({
    action: operation.action,
    serviceOperation: operation.serviceOperation,
    scopes: operation.serviceScopes
  })}`;
  const commandStatus = operation.runtimeEnablement === "disabled-until-runtime-control"
    ? "disabled"
    : approvalRequired
      ? "awaiting-approval"
      : "ready";
  const persistedStateKey = `capability.commands.${commandId}`;
  const idempotencyKey = operation.idempotency.required
    ? `${operation.idempotency.keySource}:${commandId}`
    : null;

  return {
    commandId,
    action: operation.action,
    providerService: operation.providerService,
    serviceOperation: operation.serviceOperation,
    tenantBoundary: operation.tenantBoundary,
    commandStatus,
    persistedStateKey,
    restartSemantics: {
      stateShape: {
        commandId: "string",
        action: "string",
        status: "pending|inFlight|acknowledged|failed|requiresOperatorReview",
        idempotencyKey: idempotencyKey ? "string" : "null",
        providerRequestId: "optional-string",
        lastAttemptAt: "optional-iso8601",
        attemptCount: "integer",
        lastErrorCode: "optional-string"
      },
      recoverOnRestart: isWrite ? "pause-until-provider-ack-or-operator-review" : "retry-read-with-rate-limit-budget",
      terminalStates: isWrite
        ? ["acknowledged", "requiresOperatorReview"]
        : ["acknowledged", "failed"],
      staleInFlightAfterSeconds: isWrite ? 900 : 120
    },
    idempotency: {
      required: operation.idempotency.required,
      key: idempotencyKey,
      keySource: operation.idempotency.keySource,
      duplicatePolicy: isWrite ? "dedupe-before-provider-write" : "allow-read-refresh",
      safeReplay: operation.idempotency.safeRetry
    },
    clientControl: {
      visibleStatus: commandStatus === "ready" ? "ready" : "needs-action",
      nextAction: commandStatus === "disabled"
        ? "enable-runtime-command"
        : commandStatus === "awaiting-approval"
          ? operation.settingsControls.nextAction
          : "queue-runtime-command",
      canQueue: commandStatus === "ready",
      approvalRequired,
      scheduleWindow: operation.settingsControls.scheduleWindow
    }
  };
}

function compileLifecycleSettings(entry, action, options, diagnostics) {
  const override = ACTION_LIFECYCLE_OVERRIDES[action] || {};
  const lifecycle = {
    ...DEFAULT_ACTION_LIFECYCLE,
    ...override,
    ...(options.lifecycleDefaults || {}),
    ...(entry.lifecycle || {})
  };
  const enabled = normalizeBoolean(entry.enabled, normalizeBoolean(lifecycle.enabled, true));
  const maxInvocations = normalizePositiveInteger(
    entry.maxInvocations ?? lifecycle.maxInvocations,
    DEFAULT_ACTION_LIFECYCLE.maxInvocations
  );
  const scheduleWindow = entry.scheduleWindow || lifecycle.scheduleWindow || DEFAULT_ACTION_LIFECYCLE.scheduleWindow;
  const nextAction = entry.nextAction || lifecycle.nextAction || DEFAULT_ACTION_LIFECYCLE.nextAction;
  const allowedScheduleWindows = new Set(["preflight", "runtime", "operator-approved", "manual-approval", "post-run"]);

  if (!allowedScheduleWindows.has(scheduleWindow)) {
    diagnostics.push({
      level: "error",
      code: "capability.lifecycle.scheduleWindow.unsupported",
      message: `Unsupported capability schedule window: ${scheduleWindow}`,
      action
    });
  }

  if (entry.enabled === false && action === "campaign.schedule") {
    diagnostics.push({
      level: "info",
      code: "capability.lifecycle.schedule.disabled",
      message: "Campaign scheduling capability is compiled disabled until a runtime approval enables it.",
      action
    });
  }

  return {
    enabled,
    scheduleWindow,
    maxInvocations,
    nextAction,
    controls: {
      canDisable: true,
      canEnableAtRuntime: action === "campaign.schedule" || scheduleWindow.includes("approval"),
      requiresApprovalBeforeEnable: action === "campaign.schedule" || RISK_BY_ACTION[action] === "high"
    }
  };
}

function compileProviderOperationContract(entry, action, lifecycle, options) {
  const operation = ACTION_PROVIDER_OPERATIONS[action];
  const externalWrite = operation.externalWrite === true;
  const approvalRequired = lifecycle.controls.requiresApprovalBeforeEnable || externalWrite;
  const runtimeEnablement = lifecycle.enabled === false
    ? "disabled-until-runtime-control"
    : approvalRequired
      ? "enabled-after-approval"
      : "enabled";

  const contract = {
    providerService: "mailchimp-marketing-api",
    action,
    serviceOperation: operation.serviceOperation,
    serviceScopes: MAILCHIMP_ACTION_SCOPES[action] || [],
    handoffState: operation.handoffState,
    tenantBoundary: options.tenantBoundary || compileTenantBoundary(options),
    runtimeEnablement,
    requiredMemory: operation.requiredMemory,
    externalWrite,
    idempotency: {
      required: externalWrite,
      keySource: externalWrite ? `job.id:${action}` : null,
      safeRetry: externalWrite ? "until-provider-acknowledgement" : "always"
    },
    rateLimit: {
      ...PROVIDER_RATE_LIMIT_PROFILE,
      maxInvocations: lifecycle.maxInvocations
    },
    settingsControls: {
      canToggleEnabled: lifecycle.controls.canDisable || lifecycle.controls.canEnableAtRuntime,
      approvalRequired,
      scheduleWindow: lifecycle.scheduleWindow,
      nextAction: lifecycle.nextAction,
      localOnly: options.localOnly !== false,
      requestedOverride: {
        enabled: entry.enabled,
        scheduleWindow: entry.scheduleWindow,
        maxInvocations: entry.maxInvocations
      }
    }
  };
  return {
    ...contract,
    commandState: compileRuntimeCommandState(contract)
  };
}

function summarizeProviderServiceContract(capabilities, tenantBoundary = compileTenantBoundary()) {
  const operations = capabilities.map((capability) => capability.providerOperation);
  const requiredMemory = Array.from(new Set(operations.flatMap((operation) => operation.requiredMemory)));
  const externalWriteOperations = operations.filter((operation) => operation.externalWrite);
  const disabledOperations = operations.filter((operation) => operation.runtimeEnablement === "disabled-until-runtime-control");
  const approvalOperations = operations.filter((operation) => operation.settingsControls.approvalRequired);

  return {
    providerService: "mailchimp-marketing-api",
    operationCount: operations.length,
    externalWriteOperationCount: externalWriteOperations.length,
    requiresApproval: approvalOperations.length > 0,
    requiresIdempotencyKeys: externalWriteOperations.length > 0,
    requiredMemory,
    tenantBoundary,
    handoffStates: operations.reduce((states, operation) => {
      states[operation.handoffState] = (states[operation.handoffState] || 0) + 1;
      return states;
    }, {}),
    runtimeControls: {
      disabledActions: disabledOperations.map((operation) => operation.action),
      approvalActions: approvalOperations.map((operation) => operation.action),
      nextActions: operations.map((operation) => ({
        action: operation.action,
        nextAction: operation.settingsControls.nextAction,
        enabled: operation.runtimeEnablement !== "disabled-until-runtime-control",
        scheduleWindow: operation.settingsControls.scheduleWindow
      }))
    },
    runtimeCommandState: {
      persistenceNamespace: "capability.commands",
      commands: operations.map((operation) => operation.commandState),
      queuedCommandIds: operations
        .filter((operation) => operation.commandState.clientControl.canQueue)
        .map((operation) => operation.commandState.commandId),
      blockedCommandIds: operations
        .filter((operation) => !operation.commandState.clientControl.canQueue)
        .map((operation) => operation.commandState.commandId),
      idempotencyRequiredCommandIds: operations
        .filter((operation) => operation.commandState.idempotency.required)
        .map((operation) => operation.commandState.commandId),
      restartPolicy: {
        readCommands: "retry-incomplete-reads-with-budget",
        writeCommands: "resume-only-after-idempotency-dedupe-and-operator-review",
        missingState: "rebuild-from-compiled-contract"
      }
    },
    syncMetadata: {
      serviceScopes: Array.from(new Set(operations.flatMap((operation) => operation.serviceScopes))).sort(),
      rateLimitBudgetKey: PROVIDER_RATE_LIMIT_PROFILE.budgetKey,
      externalFactsVerified: false
    }
  };
}

function normalizePersistedCommandStatus(command, persistedState) {
  const persisted = persistedState?.[command.persistedStateKey] || persistedState?.[command.commandId] || null;
  const status = persisted?.status || "missing";
  const isWrite = command.idempotency.required === true;
  const inFlight = status === "inFlight" || status === "pending";
  const terminal = command.restartSemantics.terminalStates.includes(status);
  const staleAfterSeconds = command.restartSemantics.staleInFlightAfterSeconds;

  return {
    commandId: command.commandId,
    action: command.action,
    persistedStateKey: command.persistedStateKey,
    storedStatus: status,
    expectedStatus: command.commandStatus,
    terminal,
    restartAction: status === "missing"
      ? "rebuild-empty-command-state"
      : terminal
        ? "adopt-terminal-command-state"
        : isWrite && inFlight
          ? "hold-write-for-provider-ack-or-operator-review"
          : "retry-read-with-rate-limit-budget",
    canQueueAfterRestart: !isWrite && (status === "missing" || status === "failed" || inFlight),
    requiresOperatorReview: isWrite && (status === "missing" || inFlight || status === "failed"),
    idempotencyKey: command.idempotency.key,
    duplicatePolicy: command.idempotency.duplicatePolicy,
    staleInFlightAfterSeconds: staleAfterSeconds,
    auditEvent: terminal
      ? "capability.command.provider_acknowledged"
      : isWrite
        ? "capability.command.operator_review"
        : "capability.command.queued"
  };
}

export function compileCapabilityStateRecoveryEnvelope(contract = {}, persistedState = {}) {
  const ledger = contract.commandLedger || compileCapabilityCommandLedger(contract);
  const providerService = contract.providerServiceContract || summarizeProviderServiceContract(contract.capabilities || []);
  const commands = (ledger.commands || []).map((command) => normalizePersistedCommandStatus(command, persistedState));
  const operatorReview = commands.filter((command) => command.requiresOperatorReview);
  const queueable = commands.filter((command) => command.canQueueAfterRestart);
  const missing = commands.filter((command) => command.storedStatus === "missing");

  return {
    kind: "aios.capabilityStateRecoveryEnvelope",
    provider: "mailchimp",
    persistenceNamespace: ledger.persistenceNamespace,
    status: operatorReview.length
      ? "operator-review-required"
      : missing.length
        ? "state-reconstructed"
        : "state-adopted",
    restartSafe: ledger.restartSafe !== false && operatorReview.length === 0,
    tenantBoundary: providerService.tenantBoundary,
    adoption: {
      event: ledger.clientStateContract?.adoptionEvent || "mailchimp.capability.commands.adopted",
      statusEvent: ledger.clientStateContract?.statusEvent || "mailchimp.capability.command.status",
      missingStatePolicy: ledger.clientStateContract?.missingStatePolicy || "rebuild-empty-command-state-from-compiled-contract",
      requiredStateKeys: ledger.clientStateContract?.requiredStateKeys || []
    },
    counters: {
      commands: commands.length,
      missingState: missing.length,
      queueableAfterRestart: queueable.length,
      operatorReview: operatorReview.length,
      terminal: commands.filter((command) => command.terminal).length
    },
    commands,
    auditHandoff: {
      ...providerService.tenantBoundary?.auditHandoff,
      emittedEvents: Array.from(new Set(commands.map((command) => command.auditEvent))).sort()
    },
    truthBoundary: {
      source: "capability-command-ledger",
      persistedStateTrustedAsCallerSupplied: true,
      externalProviderStateVerified: false,
      deterministic: true
    }
  };
}

export function compileCapabilityCommandLedger(contract = {}) {
  const capabilities = contract.capabilities || [];
  const commands = capabilities
    .map((capability) => capability.providerOperation?.commandState)
    .filter(Boolean);
  const queued = commands.filter((command) => command.clientControl.canQueue);
  const awaitingApproval = commands.filter((command) => command.commandStatus === "awaiting-approval");
  const disabled = commands.filter((command) => command.commandStatus === "disabled");
  const writeCommands = commands.filter((command) => command.idempotency.required);

  return {
    kind: "aios.capabilityCommandLedger",
    provider: "mailchimp",
    persistenceNamespace: "capability.commands",
    status: disabled.length
      ? "runtime-controls-required"
      : awaitingApproval.length
        ? "approval-required"
        : "ready",
    restartSafe: writeCommands.every((command) => Boolean(command.idempotency.key)),
    commandCount: commands.length,
    queuedCommandIds: queued.map((command) => command.commandId),
    approvalCommandIds: awaitingApproval.map((command) => command.commandId),
    disabledCommandIds: disabled.map((command) => command.commandId),
    writeCommandIds: writeCommands.map((command) => command.commandId),
    commands,
    clientStateContract: {
      requiredStateKeys: commands.map((command) => command.persistedStateKey),
      missingStatePolicy: "rebuild-empty-command-state-from-compiled-contract",
      adoptionEvent: "mailchimp.capability.commands.adopted",
      statusEvent: "mailchimp.capability.command.status"
    },
    recovery: {
      onRestart: writeCommands.length
        ? "rehydrate-command-ledger-and-hold-writes-for-dedupe"
        : "rehydrate-command-ledger-and-retry-reads",
      onDuplicateCommand: "return-persisted-provider-result-when-available",
      onMissingIdempotencyKey: writeCommands.length ? "block-provider-write" : "not-applicable"
    },
    truthBoundary: {
      source: "compiled-provider-operations",
      persistedExternally: false,
      deterministic: true
    }
  };
}

function compileOperationRecoveryStep(operation) {
  const isWrite = operation.externalWrite === true;
  const needsApproval = operation.settingsControls.approvalRequired === true;
  const failureStatus = isWrite
    ? "provider-write-needs-operator-review"
    : "provider-read-retryable";

  return {
    action: operation.action,
    providerService: operation.providerService,
    serviceOperation: operation.serviceOperation,
    handoffState: operation.handoffState,
    failureStatus,
    recoveryState: isWrite ? "external-effect-unknown" : "local-cache-not-hydrated",
    retryPolicy: {
      canRetryAutomatically: !isWrite,
      requiresIdempotencyKey: operation.idempotency.required,
      idempotencyKeySource: operation.idempotency.keySource,
      commandId: operation.commandState?.commandId || null,
      persistedStateKey: operation.commandState?.persistedStateKey || null,
      retryUntil: operation.idempotency.safeRetry,
      rateLimitBudgetKey: operation.rateLimit.budgetKey,
      retryAfterHeader: operation.rateLimit.retryAfterHeader
    },
    rollbackPolicy: {
      canRollbackProviderState: false,
      localRollbackRequired: isWrite,
      requiredMemory: operation.requiredMemory,
      nextAction: isWrite
        ? "restore-local-memory-and-review-provider-state"
        : "retry-provider-read-or-use-stale-cache"
    },
    operatorControl: {
      approvalRequiredBeforeRetry: needsApproval || isWrite,
      enablement: operation.runtimeEnablement,
      nextAction: operation.settingsControls.nextAction,
      scheduleWindow: operation.settingsControls.scheduleWindow
    },
    restartRecovery: {
      recoverOnRestart: operation.commandState?.restartSemantics.recoverOnRestart || "rebuild-from-contract",
      staleInFlightAfterSeconds: operation.commandState?.restartSemantics.staleInFlightAfterSeconds || 120,
      duplicatePolicy: operation.commandState?.idempotency.duplicatePolicy || "allow-read-refresh"
    }
  };
}

export function compileCapabilityRecoveryPlan(contract = {}) {
  const capabilities = contract.capabilities || [];
  const commandLedger = compileCapabilityCommandLedger(contract);
  const recoverySteps = capabilities
    .map((capability) => capability.providerOperation)
    .filter(Boolean)
    .map(compileOperationRecoveryStep);
  const writeSteps = recoverySteps.filter((step) => step.retryPolicy.requiresIdempotencyKey);
  const disabledSteps = recoverySteps.filter((step) => step.operatorControl.enablement === "disabled-until-runtime-control");
  const manualSteps = recoverySteps.filter((step) => step.operatorControl.approvalRequiredBeforeRetry);

  return {
    kind: "aios.capabilityRecoveryPlan",
    provider: "mailchimp",
    statusAfterFailure: writeSteps.length
      ? "needs-operator-review"
      : recoverySteps.length
        ? "retry-provider-read"
        : "no-provider-operations",
    adapterRecoveryStatus: {
      onProviderTimeout: writeSteps.length ? "pause-before-unknown-write-retry" : "retry-with-rate-limit-budget",
      onProviderValidationError: "surface-provider-error-to-client-preview",
      onApprovalMissing: manualSteps.length ? "collect-operator-approval" : "not-required",
      onCapabilityDisabled: disabledSteps.length ? "await-runtime-enable-control" : "not-required"
    },
    retryBudget: {
      budgetKey: PROVIDER_RATE_LIMIT_PROFILE.budgetKey,
      maxBurst: PROVIDER_RATE_LIMIT_PROFILE.maxBurst,
      windowSeconds: PROVIDER_RATE_LIMIT_PROFILE.windowSeconds,
      autoRetryableActions: recoverySteps
        .filter((step) => step.retryPolicy.canRetryAutomatically)
        .map((step) => step.action),
      manualRetryActions: manualSteps.map((step) => step.action)
    },
    commandLedger,
    operations: recoverySteps,
    clientVisibleRecovery: recoverySteps.map((step) => ({
      action: step.action,
      commandId: step.retryPolicy.commandId,
      failureStatus: step.failureStatus,
      nextAction: step.rollbackPolicy.nextAction,
      approvalRequiredBeforeRetry: step.operatorControl.approvalRequiredBeforeRetry
    })),
    truthBoundary: {
      source: "compiled-provider-operations",
      externalEffectKnown: false,
      deterministic: true
    }
  };
}

export function parseCapabilitySource(source = {}) {
  if (typeof source === "string") {
    return source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [action, rawReason = "declared in source"] = line.split(/\s*:\s*/, 2);
        return { action, reason: rawReason };
      });
  }

  if (Array.isArray(source)) {
    return source.map((entry) => {
      if (typeof entry === "string") return { action: entry, reason: "declared in array" };
      return {
        action: entry.action,
        reason: entry.reason || "declared in array",
        expiresAfterMinutes: entry.expiresAfterMinutes,
        enabled: entry.enabled,
        lifecycle: entry.lifecycle,
        scheduleWindow: entry.scheduleWindow,
        maxInvocations: entry.maxInvocations,
        nextAction: entry.nextAction
      };
    });
  }

  return toArray(source.actions || source.capabilities).map((entry) => {
    if (typeof entry === "string") return { action: entry, reason: "declared in object" };
    return {
      action: entry.action,
      reason: entry.reason || entry.justification || "declared in object",
      expiresAfterMinutes: entry.expiresAfterMinutes,
      enabled: entry.enabled,
      lifecycle: entry.lifecycle,
      scheduleWindow: entry.scheduleWindow,
      maxInvocations: entry.maxInvocations,
      nextAction: entry.nextAction
    };
  });
}

export function compileMailchimpCapabilities(source = {}, options = {}) {
  const requested = parseCapabilitySource(source);
  const diagnostics = [];
  const seen = new Set();
  const capabilities = [];
  const tenantBoundary = compileTenantBoundary(options, diagnostics);
  const scopedOptions = { ...options, tenantBoundary };

  for (const entry of requested) {
    if (!entry.action || typeof entry.action !== "string") {
      diagnostics.push({ level: "error", code: "capability.action.missing", message: "Capability action is required." });
      continue;
    }

    if (!MAILCHIMP_ALLOWED_ACTIONS.has(entry.action)) {
      diagnostics.push({
        level: "error",
        code: "capability.action.unsupported",
        message: `Unsupported Mailchimp action: ${entry.action}`,
        action: entry.action
      });
      continue;
    }

    if (seen.has(entry.action)) continue;
    seen.add(entry.action);

    const scopes = MAILCHIMP_ACTION_SCOPES[entry.action];
    const lifecycle = compileLifecycleSettings(entry, entry.action, scopedOptions, diagnostics);
    capabilities.push({
      id: `mailchimp.${entry.action}`,
      provider: "mailchimp",
      action: entry.action,
      scopes,
      risk: RISK_BY_ACTION[entry.action] || "low",
      reason: entry.reason,
      lifecycle,
      constraints: {
        localOnly: scopedOptions.localOnly !== false,
        noExternalWrite: !entry.action.endsWith(".read"),
        expiresAfterMinutes: entry.expiresAfterMinutes || options.expiresAfterMinutes || 30
      },
      tenantBoundary,
      providerOperation: compileProviderOperationContract(entry, entry.action, lifecycle, scopedOptions)
    });
  }

  if (capabilities.some((capability) => capability.risk === "high") && options.requireHumanApproval !== false) {
    diagnostics.push({
      level: "info",
      code: "capability.approval.required",
      message: "Scheduling campaigns requires a human approval gate before runtime handoff."
    });
  }

  return {
    kind: "aios.capabilityContract",
    provider: "mailchimp",
    capabilities,
    providerServiceContract: summarizeProviderServiceContract(capabilities, tenantBoundary),
    commandLedger: compileCapabilityCommandLedger({ capabilities }),
    recoveryPlan: compileCapabilityRecoveryPlan({ capabilities }),
    stateRecoveryEnvelope: compileCapabilityStateRecoveryEnvelope({
      capabilities,
      providerServiceContract: summarizeProviderServiceContract(capabilities, tenantBoundary)
    }, options.persistedCommandState || {}),
    lifecycleSummary: summarizeCapabilityLifecycle(capabilities),
    diagnostics,
    truthBoundary: {
      source: "declared-request",
      verifiedBy: "capability-compiler",
      unsupportedActions: diagnostics.filter((item) => item.code === "capability.action.unsupported").map((item) => item.action)
    }
  };
}

export function summarizeCapabilityRisk(contract) {
  const capabilities = contract?.capabilities || [];
  const writeCount = capabilities.filter((capability) => capability.constraints?.noExternalWrite).length;
  const highestRisk = capabilities.some((capability) => capability.risk === "high")
    ? "high"
    : capabilities.some((capability) => capability.risk === "medium")
      ? "medium"
      : "low";

  return {
    provider: "mailchimp",
    count: capabilities.length,
    writeCount,
    highestRisk,
    requiresApproval: highestRisk === "high"
  };
}

export function summarizeCapabilityLifecycle(contractOrCapabilities) {
  const capabilities = Array.isArray(contractOrCapabilities)
    ? contractOrCapabilities
    : contractOrCapabilities?.capabilities || [];
  const disabled = capabilities.filter((capability) => capability.lifecycle?.enabled === false);
  const awaitingApproval = capabilities.filter((capability) => (
    capability.lifecycle?.controls?.requiresApprovalBeforeEnable
    || capability.lifecycle?.scheduleWindow?.includes("approval")
  ));
  const nextActions = capabilities.map((capability) => ({
    action: capability.action,
    nextAction: capability.lifecycle?.nextAction || "ready",
    enabled: capability.lifecycle?.enabled !== false,
    scheduleWindow: capability.lifecycle?.scheduleWindow || "runtime"
  }));

  return {
    provider: "mailchimp",
    enabledCount: capabilities.length - disabled.length,
    disabledCount: disabled.length,
    approvalGateCount: awaitingApproval.length,
    disabledActions: disabled.map((capability) => capability.action),
    nextActions
  };
}
