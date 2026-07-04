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

function summarizeRolePermissions(capabilities, tenantBoundary) {
  const scopes = Array.from(new Set(
    capabilities.flatMap((capability) => capability.scopes || [])
  )).sort();
  const writeActions = capabilities
    .filter((capability) => capability.providerOperation?.externalWrite)
    .map((capability) => capability.action);
  const approvalActions = capabilities
    .filter((capability) => capability.providerOperation?.settingsControls?.approvalRequired)
    .map((capability) => capability.action);
  const mayWrite = writeActions.length > 0;
  const maySchedule = capabilities.some((capability) => capability.action === "campaign.schedule");
  const role = tenantBoundary?.actorRole || "runtime-operator";

  return {
    role,
    scopeCount: scopes.length,
    scopes,
    permittedActions: capabilities.map((capability) => capability.action),
    writeActions,
    approvalActions,
    grants: {
      canReadProviderState: scopes.some((scope) => scope.endsWith(":read")),
      canStageProviderWrite: mayWrite,
      canScheduleCampaign: maySchedule && role === "workspace-admin",
      canBypassApproval: false,
      canCrossTenant: false
    },
    restrictions: {
      externalWriteRequiresApproval: mayWrite,
      scheduleRequiresWorkspaceAdmin: maySchedule,
      providerPayloadsRedactedFromAudit: true
    }
  };
}

export function compileCapabilityBoundaryAuditManifest(contract = {}, persistedState = {}) {
  const capabilities = contract.capabilities || [];
  const providerService = contract.providerServiceContract
    || summarizeProviderServiceContract(capabilities);
  const tenantBoundary = providerService.tenantBoundary || compileTenantBoundary();
  const ledger = contract.commandLedger || compileCapabilityCommandLedger({ capabilities });
  const recoveryEnvelope = contract.stateRecoveryEnvelope
    || compileCapabilityStateRecoveryEnvelope({
      capabilities,
      providerServiceContract: providerService,
      commandLedger: ledger
    }, persistedState);
  const rolePermissions = summarizeRolePermissions(capabilities, tenantBoundary);
  const commandStates = recoveryEnvelope.commands || [];
  const writeCommands = commandStates.filter((command) => command.idempotencyKey);
  const tenantScopedKeys = commandStates.map((command) => ({
    commandId: command.commandId,
    stateKey: command.persistedStateKey,
    tenantIsolationKey: tenantBoundary.isolationKey,
    auditEvent: command.auditEvent,
    restartAction: command.restartAction
  }));
  const violations = [
    ...(!tenantBoundary.tenantId || tenantBoundary.tenantId === "unbound-tenant"
      ? [{
        code: "capability.boundary.tenant.unbound",
        severity: "warning",
        message: "Capability commands are compiled without a tenant id.",
        nextAction: "bind-tenant-before-provider-handoff"
      }]
      : []),
    ...(!tenantBoundary.workspaceId || tenantBoundary.workspaceId === "local-workspace"
      ? [{
        code: "capability.boundary.workspace.default",
        severity: "info",
        message: "Capability commands use the default local workspace boundary.",
        nextAction: "confirm-workspace-scope"
      }]
      : []),
    ...(rolePermissions.grants.canScheduleCampaign
      ? []
      : capabilities.some((capability) => capability.action === "campaign.schedule")
        ? [{
          code: "capability.boundary.schedule.role",
          severity: "warning",
          message: "Campaign scheduling remains disabled unless a workspace admin enables it.",
          nextAction: "collect-workspace-admin-schedule-approval"
        }]
        : [])
  ];

  return {
    kind: "aios.capabilityBoundaryAuditManifest",
    provider: "mailchimp",
    tenantBoundary,
    status: violations.some((violation) => violation.severity === "error")
      ? "blocked"
      : recoveryEnvelope.status === "operator-review-required" || violations.length
        ? "review-required"
        : "ready",
    rolePermissions,
    commandAdoption: {
      namespace: ledger.persistenceNamespace || "capability.commands",
      requiredStateKeys: ledger.clientStateContract?.requiredStateKeys || [],
      tenantScopedKeys,
      missingStatePolicy: recoveryEnvelope.adoption?.missingStatePolicy,
      adoptionEvent: recoveryEnvelope.adoption?.event,
      statusEvent: recoveryEnvelope.adoption?.statusEvent
    },
    auditHandoff: {
      stream: tenantBoundary.auditHandoff?.stream,
      requiredEvents: tenantBoundary.auditHandoff?.requiredEvents || [],
      emittedEvents: recoveryEnvelope.auditHandoff?.emittedEvents || [],
      redactProviderPayloads: true,
      includeTenantIsolationKey: true
    },
    idempotency: {
      writeCommandIds: writeCommands.map((command) => command.commandId),
      missingIdempotencyCommandIds: writeCommands
        .filter((command) => !command.idempotencyKey)
        .map((command) => command.commandId),
      duplicatePolicy: ledger.recovery?.onDuplicateCommand || "return-persisted-provider-result-when-available"
    },
    violations,
    counters: {
      capabilities: capabilities.length,
      scopes: rolePermissions.scopeCount,
      writeActions: rolePermissions.writeActions.length,
      approvalActions: rolePermissions.approvalActions.length,
      commands: commandStates.length,
      violations: violations.length
    },
    truthBoundary: {
      source: "capability-compiler",
      externalProviderStateVerified: false,
      deterministic: true
    }
  };
}

export function compileCapabilityRuntimeBoundaryGate(contract = {}, options = {}) {
  const capabilities = contract.capabilities || [];
  const providerService = contract.providerServiceContract
    || summarizeProviderServiceContract(capabilities);
  const tenantBoundary = providerService.tenantBoundary || compileTenantBoundary(options);
  const auditManifest = contract.boundaryAuditManifest
    || compileCapabilityBoundaryAuditManifest({
      capabilities,
      providerServiceContract: providerService,
      commandLedger: contract.commandLedger
    }, options.persistedCommandState || {});
  const rolePermissions = auditManifest.rolePermissions || summarizeRolePermissions(capabilities, tenantBoundary);
  const writeActions = rolePermissions.writeActions || [];
  const approvalActions = rolePermissions.approvalActions || [];
  const scheduleActions = capabilities
    .filter((capability) => capability.action === "campaign.schedule")
    .map((capability) => capability.action);
  const unapprovedWriteActions = writeActions.filter((action) => !approvalActions.includes(action));
  const roleDeniedActions = [
    ...(!rolePermissions.grants?.canScheduleCampaign
      ? scheduleActions.map((action) => ({
        action,
        permission: "mailchimp:campaigns:schedule",
        reason: "campaign scheduling requires workspace-admin role"
      }))
      : []),
    ...(!rolePermissions.grants?.canStageProviderWrite
      ? writeActions.map((action) => ({
        action,
        permission: "mailchimp:campaigns:write",
        reason: "provider writes are not granted to this role"
      }))
      : [])
  ];
  const boundaryViolations = [
    ...(tenantBoundary.tenantId === "unbound-tenant"
      ? [{
        code: "capability.boundary.tenant.unbound",
        severity: "warning",
        nextAction: "bind-tenant-before-provider-handoff"
      }]
      : []),
    ...(tenantBoundary.workspaceId === "local-workspace"
      ? [{
        code: "capability.boundary.workspace.default",
        severity: "info",
        nextAction: "confirm-workspace-scope"
      }]
      : []),
    ...unapprovedWriteActions.map((action) => ({
      code: "capability.boundary.write.approval_missing",
      severity: "error",
      action,
      nextAction: "compile-approval-gate-for-provider-write"
    })),
    ...roleDeniedActions.map((item) => ({
      code: "capability.boundary.role.denied",
      severity: item.action === "campaign.schedule" ? "warning" : "error",
      action: item.action,
      permission: item.permission,
      message: item.reason,
      nextAction: item.action === "campaign.schedule"
        ? "collect-workspace-admin-schedule-approval"
        : "adjust-role-or-remove-provider-write"
    }))
  ];
  const enforcedActionGates = capabilities.map((capability) => {
    const operation = capability.providerOperation || {};
    const commandState = operation.commandState || {};
    const isWrite = operation.externalWrite === true;
    const roleDenied = roleDeniedActions.find((item) => item.action === capability.action);
    const approvalRequired = operation.settingsControls?.approvalRequired === true || isWrite;
    const disabled = operation.runtimeEnablement === "disabled-until-runtime-control";
    const canExecute = !roleDenied && !disabled && (!approvalRequired || approvalActions.includes(capability.action));

    return {
      action: capability.action,
      commandId: commandState.commandId || null,
      serviceScopes: operation.serviceScopes || capability.scopes || [],
      requestedRisk: capability.risk,
      enforcementStatus: canExecute
        ? "allowed"
        : roleDenied
          ? "role-denied"
          : disabled
            ? "disabled"
            : "approval-required",
      canExecute,
      requiresAuditEvent: true,
      requiresApproval: approvalRequired,
      nextAction: canExecute
        ? "queue-runtime-command"
        : roleDenied
          ? roleDenied.action === "campaign.schedule"
            ? "collect-workspace-admin-schedule-approval"
            : "adjust-role-or-remove-provider-write"
          : disabled
            ? "enable-runtime-command"
            : operation.settingsControls?.nextAction || "collect-provider-write-approval",
      tenantIsolationKey: tenantBoundary.isolationKey,
      workspaceScopedStateKey: commandState.persistedStateKey
        ? `${tenantBoundary.isolationKey}:${commandState.persistedStateKey}`
        : null
    };
  });
  const blockedActions = enforcedActionGates.filter((gate) => gate.enforcementStatus === "role-denied");
  const approvalRequiredGates = enforcedActionGates.filter((gate) => gate.enforcementStatus === "approval-required");
  const disabledGates = enforcedActionGates.filter((gate) => gate.enforcementStatus === "disabled");
  const errorViolations = boundaryViolations.filter((violation) => violation.severity === "error");

  return {
    kind: "aios.capabilityRuntimeBoundaryGate",
    provider: "mailchimp",
    tenantBoundary,
    status: errorViolations.length || blockedActions.some((gate) => gate.enforcementStatus === "role-denied" && gate.action !== "campaign.schedule")
      ? "blocked"
      : approvalRequiredGates.length || disabledGates.length || boundaryViolations.length
        ? "needs-operator-action"
        : "ready",
    enforcementMode: "deny-by-default-provider-boundary",
    actionGates: enforcedActionGates,
    boundaryViolations,
    auditHandoff: {
      stream: tenantBoundary.auditHandoff?.stream,
      requiredEvents: tenantBoundary.auditHandoff?.requiredEvents || [],
      gateEvent: "mailchimp.capability.boundary.gate.evaluated",
      includeTenantIsolationKey: true,
      redactProviderPayloads: true
    },
    clientControls: {
      canStartRuntime: blockedActions.length === 0 && errorViolations.length === 0,
      canQueueProviderReads: enforcedActionGates
        .filter((gate) => gate.canExecute && !gate.requiresApproval)
        .map((gate) => gate.commandId)
        .filter(Boolean),
      approvalRequiredActions: approvalRequiredGates.map((gate) => gate.action),
      disabledActions: disabledGates.map((gate) => gate.action),
      blockedActions: blockedActions.map((gate) => gate.action),
      nextActions: enforcedActionGates
        .filter((gate) => !gate.canExecute)
        .map((gate) => ({
          action: gate.action,
          commandId: gate.commandId,
          nextAction: gate.nextAction,
          enforcementStatus: gate.enforcementStatus
        }))
    },
    counters: {
      actions: enforcedActionGates.length,
      allowedActions: enforcedActionGates.filter((gate) => gate.canExecute).length,
      approvalRequiredActions: approvalRequiredGates.length,
      disabledActions: disabledGates.length,
      blockedActions: blockedActions.length,
      boundaryViolations: boundaryViolations.length
    },
    truthBoundary: {
      source: "capability-runtime-boundary-gate",
      externalProviderStateVerified: false,
      deterministic: true
    }
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

export function compileCapabilityOperationalAnalytics(contract = {}, options = {}) {
  const capabilities = contract.capabilities || [];
  const providerService = contract.providerServiceContract
    || summarizeProviderServiceContract(capabilities);
  const commandLedger = contract.commandLedger || compileCapabilityCommandLedger({ capabilities });
  const boundaryGate = contract.runtimeBoundaryGate || compileCapabilityRuntimeBoundaryGate({
    capabilities,
    providerServiceContract: providerService,
    commandLedger
  }, options);
  const lifecycleSummary = contract.lifecycleSummary || summarizeCapabilityLifecycle(capabilities);
  const riskSummary = summarizeCapabilityRisk({ capabilities });
  const commandStatusCounts = (commandLedger.commands || []).reduce((counts, command) => {
    counts[command.commandStatus] = (counts[command.commandStatus] || 0) + 1;
    return counts;
  }, {});
  const providerOperationCounts = capabilities.reduce((counts, capability) => {
    const operation = capability.providerOperation || {};
    const category = operation.externalWrite ? "write" : "read";
    counts[category] = (counts[category] || 0) + 1;
    counts[operation.runtimeEnablement || "unknown"] = (counts[operation.runtimeEnablement || "unknown"] || 0) + 1;
    return counts;
  }, { read: 0, write: 0 });
  const actionHistory = capabilities.map((capability, index) => {
    const operation = capability.providerOperation || {};
    const command = operation.commandState || {};
    const boundary = (boundaryGate.actionGates || []).find((gate) => gate.action === capability.action);

    return {
      order: index + 1,
      action: capability.action,
      risk: capability.risk,
      commandId: command.commandId || null,
      commandStatus: command.commandStatus || "not-compiled",
      runtimeEnablement: operation.runtimeEnablement || "not-compiled",
      serviceOperation: operation.serviceOperation || null,
      scheduleWindow: capability.lifecycle?.scheduleWindow || "runtime",
      nextAction: boundary?.nextAction || capability.lifecycle?.nextAction || "ready",
      exportReady: boundary?.canExecute === true || command.commandStatus === "ready",
      externalWrite: operation.externalWrite === true
    };
  });
  const blockingActions = actionHistory.filter((item) => !item.exportReady);
  const snapshotId = `capability_snapshot_${stableCapabilityId({
    actions: actionHistory.map((item) => item.action),
    ledgerStatus: commandLedger.status,
    boundaryStatus: boundaryGate.status,
    blocked: blockingActions.map((item) => item.action)
  })}`;

  return {
    kind: "aios.capabilityOperationalAnalytics",
    provider: "mailchimp",
    snapshotId,
    exportFormat: "aios.mailchimp.capability.analytics.v1",
    status: boundaryGate.status === "blocked"
      ? "blocked"
      : commandLedger.status !== "ready" || blockingActions.length
        ? "operator-action-required"
        : "ready",
    counters: {
      capabilities: capabilities.length,
      readOperations: providerOperationCounts.read || 0,
      writeOperations: providerOperationCounts.write || 0,
      disabledCapabilities: lifecycleSummary.disabledCount,
      approvalGates: lifecycleSummary.approvalGateCount,
      queuedCommands: commandLedger.queuedCommandIds?.length || 0,
      approvalCommands: commandLedger.approvalCommandIds?.length || 0,
      disabledCommands: commandLedger.disabledCommandIds?.length || 0,
      blockedBoundaryActions: boundaryGate.counters?.blockedActions || 0,
      boundaryViolations: boundaryGate.counters?.boundaryViolations || 0,
      exportReadyActions: actionHistory.filter((item) => item.exportReady).length,
      blockedActions: blockingActions.length
    },
    dimensions: {
      highestRisk: riskSummary.highestRisk,
      requiresApproval: providerService.requiresApproval === true,
      requiresIdempotencyKeys: providerService.requiresIdempotencyKeys === true,
      commandLedgerStatus: commandLedger.status,
      boundaryGateStatus: boundaryGate.status,
      tenantIsolationKey: providerService.tenantBoundary?.isolationKey || null,
      rateLimitBudgetKey: providerService.syncMetadata?.rateLimitBudgetKey || PROVIDER_RATE_LIMIT_PROFILE.budgetKey
    },
    history: {
      snapshots: [
        {
          id: snapshotId,
          label: "capability-compile",
          status: commandLedger.status,
          counters: {
            actions: capabilities.length,
            commands: commandLedger.commandCount || 0,
            writes: providerOperationCounts.write || 0
          }
        },
        {
          id: `capability_boundary_${stableCapabilityId({
            snapshotId,
            status: boundaryGate.status,
            violations: boundaryGate.counters?.boundaryViolations || 0
          })}`,
          label: "runtime-boundary",
          status: boundaryGate.status,
          counters: {
            allowedActions: boundaryGate.counters?.allowedActions || 0,
            blockedActions: boundaryGate.counters?.blockedActions || 0,
            approvalRequiredActions: boundaryGate.counters?.approvalRequiredActions || 0
          }
        }
      ],
      timeline: actionHistory.map((item) => ({
        order: item.order,
        action: item.action,
        status: item.exportReady ? "export-ready" : item.commandStatus,
        nextAction: item.nextAction
      }))
    },
    exportSummary: {
      acceptedForRuntime: boundaryGate.status !== "blocked" && blockingActions.length === 0,
      acceptedForProviderWrite: providerService.externalWriteOperationCount > 0
        && boundaryGate.status !== "blocked"
        && (commandLedger.approvalCommandIds || []).length === 0,
      blockedActionIds: blockingActions.map((item) => item.action),
      queuedCommandIds: commandLedger.queuedCommandIds || [],
      approvalCommandIds: commandLedger.approvalCommandIds || [],
      disabledCommandIds: commandLedger.disabledCommandIds || [],
      requiredScopes: providerService.syncMetadata?.serviceScopes || [],
      nextActions: actionHistory
        .filter((item) => !item.exportReady || item.nextAction !== "ready")
        .map((item) => ({
          action: item.action,
          commandId: item.commandId,
          nextAction: item.nextAction,
          required: !item.exportReady,
          scheduleWindow: item.scheduleWindow
        }))
    },
    actionHistory,
    commandStatusCounts,
    persistedStateContract: {
      namespace: "capability.analytics",
      snapshotKey: `capability.analytics.${snapshotId}`,
      statusKey: "capability.analytics.currentStatus",
      adoptionEvent: "mailchimp.capability.analytics.adopted",
      missingStatePolicy: "rebuild-capability-analytics-from-compiled-contract"
    },
    truthBoundary: {
      source: "capability-compiler",
      externalProviderStateVerified: false,
      deterministic: true
    }
  };
}

export function compileCapabilityProviderHandoffManifest(contract = {}, options = {}) {
  const capabilities = contract.capabilities || [];
  const providerService = contract.providerServiceContract
    || summarizeProviderServiceContract(capabilities);
  const commandLedger = contract.commandLedger || compileCapabilityCommandLedger({ capabilities });
  const boundaryGate = contract.runtimeBoundaryGate || compileCapabilityRuntimeBoundaryGate({
    capabilities,
    providerServiceContract: providerService,
    commandLedger
  }, options);
  const operations = capabilities.map((capability) => capability.providerOperation).filter(Boolean);
  const operationManifests = operations.map((operation, index) => {
    const command = operation.commandState || {};
    const boundary = (boundaryGate.actionGates || []).find((gate) => gate.action === operation.action);
    const providerWrite = operation.externalWrite === true;
    const queueable = command.clientControl?.canQueue === true && boundary?.canExecute !== false;
    const handoffStatus = boundary?.enforcementStatus === "role-denied"
      ? "blocked-by-boundary"
      : operation.runtimeEnablement === "disabled-until-runtime-control"
        ? "disabled-until-runtime-control"
        : operation.settingsControls?.approvalRequired
          ? "awaiting-operator-approval"
          : queueable
            ? "ready-for-provider-adapter"
            : "compiled";

    return {
      order: index + 1,
      action: operation.action,
      providerService: operation.providerService,
      serviceOperation: operation.serviceOperation,
      handoffState: operation.handoffState,
      handoffStatus,
      commandId: command.commandId || null,
      commandStatus: command.commandStatus || "not-compiled",
      externalWrite: providerWrite,
      requiresApproval: operation.settingsControls?.approvalRequired === true || providerWrite,
      requiredMemory: operation.requiredMemory || [],
      serviceScopes: operation.serviceScopes || [],
      idempotency: {
        required: operation.idempotency?.required === true,
        keySource: operation.idempotency?.keySource || null,
        duplicatePolicy: command.idempotency?.duplicatePolicy || (providerWrite ? "dedupe-before-provider-write" : "allow-read-refresh")
      },
      adapterRequest: {
        rateLimitBudgetKey: operation.rateLimit?.budgetKey || PROVIDER_RATE_LIMIT_PROFILE.budgetKey,
        retryAfterHeader: operation.rateLimit?.retryAfterHeader || PROVIDER_RATE_LIMIT_PROFILE.retryAfterHeader,
        tenantIsolationKey: boundary?.tenantIsolationKey || providerService.tenantBoundary?.isolationKey || null,
        workspaceScopedStateKey: boundary?.workspaceScopedStateKey || null,
        payloadPolicy: providerWrite ? "redact-and-stage-local-draft" : "read-through-provider-cache"
      },
      nextAction: boundary?.nextAction || operation.settingsControls?.nextAction || "queue-runtime-command"
    };
  });
  const readOperations = operationManifests.filter((operation) => !operation.externalWrite);
  const writeOperations = operationManifests.filter((operation) => operation.externalWrite);
  const blockedOperations = operationManifests.filter((operation) => operation.handoffStatus === "blocked-by-boundary");
  const approvalOperations = operationManifests.filter((operation) => operation.handoffStatus === "awaiting-operator-approval");
  const disabledOperations = operationManifests.filter((operation) => operation.handoffStatus === "disabled-until-runtime-control");
  const requiredMemory = Array.from(new Set(operationManifests.flatMap((operation) => operation.requiredMemory))).sort();
  const requiredScopes = Array.from(new Set(operationManifests.flatMap((operation) => operation.serviceScopes))).sort();
  const handoffStates = operationManifests.reduce((states, operation) => {
    states[operation.handoffState] = (states[operation.handoffState] || 0) + 1;
    return states;
  }, {});
  const snapshotId = `capability_provider_handoff_${stableCapabilityId({
    actions: operationManifests.map((operation) => operation.action),
    statuses: operationManifests.map((operation) => operation.handoffStatus),
    boundaryStatus: boundaryGate.status,
    ledgerStatus: commandLedger.status
  })}`;

  return {
    kind: "aios.capabilityProviderHandoffManifest",
    provider: "mailchimp",
    snapshotId,
    providerService: providerService.providerService || "mailchimp-marketing-api",
    status: blockedOperations.length
      ? "blocked"
      : disabledOperations.length || approvalOperations.length || commandLedger.status !== "ready"
        ? "operator-action-required"
        : "ready-for-provider-adapter",
    tenantBoundary: providerService.tenantBoundary || boundaryGate.tenantBoundary || null,
    requiredMemory,
    requiredScopes,
    handoffStates,
    operations: operationManifests,
    adapterHandoff: {
      runtimeQueue: {
        namespace: commandLedger.persistenceNamespace || "capability.commands",
        queueableCommandIds: operationManifests
          .filter((operation) => operation.handoffStatus === "ready-for-provider-adapter")
          .map((operation) => operation.commandId)
          .filter(Boolean),
        heldCommandIds: operationManifests
          .filter((operation) => operation.handoffStatus !== "ready-for-provider-adapter")
          .map((operation) => operation.commandId)
          .filter(Boolean),
        missingStatePolicy: commandLedger.clientStateContract?.missingStatePolicy || "rebuild-empty-command-state-from-compiled-contract"
      },
      externalWritePolicy: {
        writeActions: writeOperations.map((operation) => operation.action),
        approvalRequiredActions: approvalOperations.map((operation) => operation.action),
        idempotencyRequired: writeOperations.length > 0,
        duplicatePolicy: commandLedger.recovery?.onDuplicateCommand || "return-persisted-provider-result-when-available"
      },
      syncMetadata: {
        serviceScopes: requiredScopes,
        rateLimitBudgetKey: providerService.syncMetadata?.rateLimitBudgetKey || PROVIDER_RATE_LIMIT_PROFILE.budgetKey,
        requiredMemory,
        handoffStates
      }
    },
    nextActions: operationManifests
      .filter((operation) => operation.handoffStatus !== "ready-for-provider-adapter")
      .map((operation) => ({
        action: operation.action,
        commandId: operation.commandId,
        nextAction: operation.nextAction,
        required: operation.handoffStatus === "blocked-by-boundary" || operation.requiresApproval,
        handoffStatus: operation.handoffStatus
      })),
    counters: {
      operations: operationManifests.length,
      readOperations: readOperations.length,
      writeOperations: writeOperations.length,
      blockedOperations: blockedOperations.length,
      approvalOperations: approvalOperations.length,
      disabledOperations: disabledOperations.length,
      requiredMemory: requiredMemory.length,
      requiredScopes: requiredScopes.length
    },
    truthBoundary: {
      source: "capability-compiler",
      externalProviderStateVerified: false,
      deterministic: true
    }
  };
}

export function compileCapabilityClientWorkflowAdoption(contract = {}, options = {}) {
  const capabilities = contract.capabilities || [];
  const providerService = contract.providerServiceContract
    || summarizeProviderServiceContract(capabilities);
  const commandLedger = contract.commandLedger || compileCapabilityCommandLedger({ capabilities });
  const boundaryGate = contract.runtimeBoundaryGate || compileCapabilityRuntimeBoundaryGate({
    capabilities,
    providerServiceContract: providerService,
    commandLedger
  }, options);
  const providerHandoff = contract.providerHandoffManifest || compileCapabilityProviderHandoffManifest({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: boundaryGate
  }, options);
  const analytics = contract.operationalAnalytics || compileCapabilityOperationalAnalytics({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: boundaryGate,
    lifecycleSummary: summarizeCapabilityLifecycle(capabilities)
  }, options);
  const auditManifest = contract.boundaryAuditManifest || compileCapabilityBoundaryAuditManifest({
    capabilities,
    providerServiceContract: providerService,
    commandLedger
  }, options.persistedCommandState || {});
  const tenantBoundary = providerService.tenantBoundary || boundaryGate.tenantBoundary || auditManifest.tenantBoundary || null;
  const actionGates = boundaryGate.actionGates || [];
  const handoffOperations = providerHandoff.operations || [];
  const commandsByAction = new Map(
    (commandLedger.commands || []).map((command) => [command.action, command])
  );
  const gatesByAction = new Map(actionGates.map((gate) => [gate.action, gate]));
  const handoffByAction = new Map(handoffOperations.map((operation) => [operation.action, operation]));
  const workflowActions = capabilities.map((capability, index) => {
    const command = commandsByAction.get(capability.action) || capability.providerOperation?.commandState || {};
    const gate = gatesByAction.get(capability.action) || {};
    const handoff = handoffByAction.get(capability.action) || {};
    const operation = capability.providerOperation || {};
    const providerWrite = operation.externalWrite === true;
    const blocked = gate.enforcementStatus === "role-denied"
      || handoff.handoffStatus === "blocked-by-boundary";
    const needsOperator = blocked
      || gate.enforcementStatus === "approval-required"
      || gate.enforcementStatus === "disabled"
      || handoff.handoffStatus === "awaiting-operator-approval"
      || handoff.handoffStatus === "disabled-until-runtime-control";
    const canQueue = !blocked
      && command.clientControl?.canQueue === true
      && gate.canExecute !== false
      && handoff.handoffStatus !== "awaiting-operator-approval";

    return {
      order: index + 1,
      action: capability.action,
      label: capability.action.replace(".", " "),
      risk: capability.risk,
      commandId: command.commandId || handoff.commandId || null,
      persistedStateKey: command.persistedStateKey || null,
      providerOperation: operation.serviceOperation || handoff.serviceOperation || null,
      providerWrite,
      scheduleWindow: capability.lifecycle?.scheduleWindow || operation.settingsControls?.scheduleWindow || "runtime",
      status: blocked
        ? "blocked"
        : canQueue
          ? "ready"
          : needsOperator
            ? "needs-operator-action"
            : command.commandStatus || "compiled",
      visibleControl: blocked
        ? "blocked-boundary"
        : gate.enforcementStatus === "disabled" || handoff.handoffStatus === "disabled-until-runtime-control"
          ? "enable-command"
          : gate.enforcementStatus === "approval-required" || handoff.handoffStatus === "awaiting-operator-approval"
            ? "collect-approval"
            : providerWrite
              ? "review-provider-write"
              : "queue-provider-read",
      canQueue,
      requiresOperatorAction: needsOperator,
      nextAction: blocked
        ? gate.nextAction || handoff.nextAction || "resolve-capability-boundary"
        : canQueue
          ? "queue-runtime-command"
          : gate.nextAction || handoff.nextAction || command.clientControl?.nextAction || "review-runtime-command",
      acceptance: {
        acceptedForClientPreview: true,
        acceptedForRuntimeQueue: canQueue,
        acceptedForProviderWrite: providerWrite
          ? canQueue && gate.requiresApproval !== true && command.idempotency?.required === true
          : false,
        idempotencyReady: !providerWrite || Boolean(command.idempotency?.key),
        boundaryReady: gate.canExecute !== false,
        auditReady: Boolean(tenantBoundary?.auditHandoff?.stream || boundaryGate.auditHandoff?.stream)
      }
    };
  });
  const blockedActions = workflowActions.filter((action) => action.status === "blocked");
  const operatorActions = workflowActions.filter((action) => action.requiresOperatorAction);
  const queueableActions = workflowActions.filter((action) => action.canQueue);
  const writeActions = workflowActions.filter((action) => action.providerWrite);
  const persistedStatusKey = `capability.workflow.${providerHandoff.snapshotId || analytics.snapshotId || "current"}`;

  return {
    kind: "aios.capabilityClientWorkflowAdoption",
    provider: "mailchimp",
    workflowId: `capability_workflow_${stableCapabilityId({
      actions: workflowActions.map((action) => action.action),
      status: providerHandoff.status,
      boundary: boundaryGate.status,
      ledger: commandLedger.status
    })}`,
    status: blockedActions.length
      ? "blocked"
      : operatorActions.length
        ? "operator-action-required"
        : "ready-for-client-runtime",
    tenantBoundary: tenantBoundary
      ? {
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        actorRole: tenantBoundary.actorRole,
        isolationKey: tenantBoundary.isolationKey
      }
      : null,
    previewModel: {
      title: "Mailchimp capability workflow",
      tabs: [
        {
          id: "ready",
          label: "Ready",
          actionIds: queueableActions.map((action) => action.action),
          emptyState: "No Mailchimp capability commands are queueable yet."
        },
        {
          id: "needs-action",
          label: "Needs action",
          actionIds: operatorActions.map((action) => action.action),
          emptyState: "No operator capability actions are pending."
        },
        {
          id: "writes",
          label: "Provider writes",
          actionIds: writeActions.map((action) => action.action),
          emptyState: "No provider write actions were compiled."
        }
      ],
      actions: workflowActions
    },
    readiness: {
      acceptedForClientPreview: true,
      acceptedForRuntimeQueue: blockedActions.length === 0 && queueableActions.length > 0,
      acceptedForProviderWrite: writeActions.length > 0
        && writeActions.every((action) => action.acceptance.acceptedForProviderWrite),
      nextStep: blockedActions.length
        ? "resolve-capability-boundary"
        : operatorActions.length
          ? operatorActions[0].nextAction
          : queueableActions.length
            ? "adopt-capability-command-ledger"
            : "declare-mailchimp-capabilities"
    },
    requestStateContract: {
      namespace: commandLedger.persistenceNamespace || "capability.commands",
      workflowStatusKey: persistedStatusKey,
      requiredStateKeys: Array.from(new Set([
        ...(commandLedger.clientStateContract?.requiredStateKeys || []),
        persistedStatusKey
      ])).sort(),
      adoptionEvent: "mailchimp.capability.workflow.adopted",
      statusEvent: "mailchimp.capability.workflow.status",
      missingStatePolicy: blockedActions.length
        ? "block-runtime-queue-until-capability-workflow-ready"
        : "rebuild-workflow-state-from-compiled-capability-contract"
    },
    auditHandoff: {
      stream: boundaryGate.auditHandoff?.stream || tenantBoundary?.auditHandoff?.stream || null,
      requiredEvents: Array.from(new Set([
        ...(boundaryGate.auditHandoff?.requiredEvents || []),
        "mailchimp.capability.workflow.rendered",
        "mailchimp.capability.workflow.adopted"
      ])).sort(),
      redactProviderPayloads: true,
      includeTenantIsolationKey: true
    },
    nextActions: workflowActions
      .filter((action) => action.nextAction !== "queue-runtime-command")
      .map((action) => ({
        action: action.action,
        commandId: action.commandId,
        nextAction: action.nextAction,
        required: action.status === "blocked" || action.requiresOperatorAction,
        visibleControl: action.visibleControl
      })),
    validationSummary: {
      actions: workflowActions.length,
      queueableActions: queueableActions.length,
      blockedActions: blockedActions.length,
      operatorActionRequired: operatorActions.length,
      writeActions: writeActions.length,
      requiredScopes: providerHandoff.requiredScopes || [],
      commandLedgerStatus: commandLedger.status,
      providerHandoffStatus: providerHandoff.status,
      boundaryGateStatus: boundaryGate.status,
      analyticsStatus: analytics.status
    },
    truthBoundary: {
      source: "capability-compiler",
      externalProviderStateVerified: false,
      clientStatePersisted: false,
      deterministic: true
    }
  };
}

export function compileCapabilityClientRuntimeAdoptionQueue(contract = {}, options = {}) {
  const capabilities = contract.capabilities || [];
  const providerService = contract.providerServiceContract
    || summarizeProviderServiceContract(capabilities);
  const commandLedger = contract.commandLedger || compileCapabilityCommandLedger({ capabilities });
  const boundaryGate = contract.runtimeBoundaryGate || compileCapabilityRuntimeBoundaryGate({
    capabilities,
    providerServiceContract: providerService,
    commandLedger
  }, options);
  const providerHandoff = contract.providerHandoffManifest || compileCapabilityProviderHandoffManifest({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: boundaryGate
  }, options);
  const workflow = contract.clientWorkflowAdoption || compileCapabilityClientWorkflowAdoption({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: boundaryGate,
    providerHandoffManifest: providerHandoff
  }, options);
  const stateRecovery = contract.stateRecoveryEnvelope || compileCapabilityStateRecoveryEnvelope({
    capabilities,
    providerServiceContract: providerService,
    commandLedger
  }, options.persistedCommandState || {});
  const tenantBoundary = providerService.tenantBoundary || boundaryGate.tenantBoundary || workflow.tenantBoundary || null;
  const commandsById = new Map((commandLedger.commands || []).map((command) => [command.commandId, command]));
  const commandRecoveryById = new Map((stateRecovery.commands || []).map((command) => [command.commandId, command]));
  const gatesByCommandId = new Map(
    (boundaryGate.actionGates || [])
      .filter((gate) => gate.commandId)
      .map((gate) => [gate.commandId, gate])
  );
  const workflowByCommandId = new Map(
    (workflow.previewModel?.actions || [])
      .filter((action) => action.commandId)
      .map((action) => [action.commandId, action])
  );
  const providerByCommandId = new Map(
    (providerHandoff.operations || [])
      .filter((operation) => operation.commandId)
      .map((operation) => [operation.commandId, operation])
  );
  const adoptionCommands = (commandLedger.commands || []).map((command, index) => {
    const recovered = commandRecoveryById.get(command.commandId) || {};
    const gate = gatesByCommandId.get(command.commandId) || {};
    const workflowAction = workflowByCommandId.get(command.commandId) || {};
    const providerOperation = providerByCommandId.get(command.commandId) || {};
    const providerWrite = command.idempotency?.required === true || providerOperation.externalWrite === true;
    const canQueue = command.clientControl?.canQueue === true
      && gate.canExecute !== false
      && providerOperation.handoffStatus !== "awaiting-operator-approval"
      && providerOperation.handoffStatus !== "disabled-until-runtime-control"
      && recovered.requiresOperatorReview !== true;
    const blockingReasons = [
      ...(gate.enforcementStatus === "role-denied"
        ? [{
          source: "boundary",
          code: "capability.boundary.role.denied",
          nextAction: gate.nextAction || "resolve-capability-boundary"
        }]
        : []),
      ...(command.commandStatus === "awaiting-approval" || providerOperation.handoffStatus === "awaiting-operator-approval"
        ? [{
          source: "approval",
          code: "capability.command.approval_required",
          nextAction: command.clientControl?.nextAction || providerOperation.nextAction || "collect-operator-approval"
        }]
        : []),
      ...(command.commandStatus === "disabled" || providerOperation.handoffStatus === "disabled-until-runtime-control"
        ? [{
          source: "runtime-control",
          code: "capability.command.disabled",
          nextAction: command.clientControl?.nextAction || "enable-runtime-command"
        }]
        : []),
      ...(recovered.requiresOperatorReview
        ? [{
          source: "restart-state",
          code: "capability.command.operator_review_required",
          nextAction: recovered.restartAction || "review-command-state-before-runtime"
        }]
        : [])
    ];
    const visibleStatus = blockingReasons.length
      ? "needs-action"
      : canQueue
        ? "ready-to-queue"
        : "compiled";

    return {
      order: index + 1,
      commandId: command.commandId,
      action: command.action,
      visibleStatus,
      persistedStateKey: command.persistedStateKey,
      workspaceScopedStateKey: gate.workspaceScopedStateKey || (
        tenantBoundary?.isolationKey ? `${tenantBoundary.isolationKey}:${command.persistedStateKey}` : command.persistedStateKey
      ),
      providerOperation: providerOperation.serviceOperation || null,
      providerWrite,
      handoffStatus: providerOperation.handoffStatus || "compiled",
      canQueue,
      canReplayAfterRestart: recovered.canQueueAfterRestart === true || canQueue,
      requiresOperatorReview: recovered.requiresOperatorReview === true || blockingReasons.length > 0,
      idempotency: {
        required: command.idempotency?.required === true,
        key: command.idempotency?.key || null,
        duplicatePolicy: command.idempotency?.duplicatePolicy || (providerWrite ? "dedupe-before-provider-write" : "allow-read-refresh")
      },
      clientControl: {
        visibleControl: workflowAction.visibleControl || command.clientControl?.nextAction || "queue-runtime-command",
        nextAction: blockingReasons[0]?.nextAction || workflowAction.nextAction || command.clientControl?.nextAction || "queue-runtime-command",
        scheduleWindow: command.clientControl?.scheduleWindow || workflowAction.scheduleWindow || "runtime",
        userVisible: true
      },
      audit: {
        event: recovered.auditEvent || (canQueue ? "capability.command.queued" : "capability.command.operator_review"),
        stream: tenantBoundary?.auditHandoff?.stream || boundaryGate.auditHandoff?.stream || null,
        includeTenantIsolationKey: true,
        redactProviderPayloads: true
      },
      blockingReasons
    };
  });
  const queueable = adoptionCommands.filter((command) => command.canQueue);
  const needsAction = adoptionCommands.filter((command) => command.requiresOperatorReview || command.blockingReasons.length);
  const writeCommands = adoptionCommands.filter((command) => command.providerWrite);
  const snapshotId = `capability_client_runtime_adoption_${stableCapabilityId({
    commands: adoptionCommands.map((command) => command.commandId),
    statuses: adoptionCommands.map((command) => command.visibleStatus),
    workflowStatus: workflow.status,
    providerHandoffStatus: providerHandoff.status,
    recoveryStatus: stateRecovery.status
  })}`;

  return {
    kind: "aios.capabilityClientRuntimeAdoptionQueue",
    provider: "mailchimp",
    snapshotId,
    status: needsAction.some((command) => command.blockingReasons.some((reason) => reason.source === "boundary"))
      ? "blocked"
      : needsAction.length
        ? "operator-action-required"
        : queueable.length
          ? "ready-for-runtime-queue"
          : "empty",
    tenantBoundary: tenantBoundary
      ? {
        tenantId: tenantBoundary.tenantId,
        workspaceId: tenantBoundary.workspaceId,
        actorRole: tenantBoundary.actorRole,
        isolationKey: tenantBoundary.isolationKey
      }
      : null,
    queue: adoptionCommands,
    runtimeQueue: {
      queueableCommandIds: queueable.map((command) => command.commandId),
      heldCommandIds: needsAction.map((command) => command.commandId),
      writeCommandIds: writeCommands.map((command) => command.commandId),
      namespace: commandLedger.persistenceNamespace || "capability.commands",
      queuePolicy: writeCommands.length
        ? "queue-reads-and-hold-writes-until-approval-and-idempotency"
        : "queue-ready-commands-with-rate-limit-budget",
      missingStatePolicy: workflow.requestStateContract?.missingStatePolicy
        || commandLedger.clientStateContract?.missingStatePolicy
        || "rebuild-empty-command-state-from-compiled-contract"
    },
    requestStateContract: {
      namespace: commandLedger.persistenceNamespace || "capability.commands",
      snapshotKey: `capability.clientRuntimeAdoption.${snapshotId}`,
      statusKey: "capability.clientRuntimeAdoption.currentStatus",
      requiredStateKeys: Array.from(new Set([
        ...(commandLedger.clientStateContract?.requiredStateKeys || []),
        ...(workflow.requestStateContract?.requiredStateKeys || []),
        ...adoptionCommands.map((command) => command.workspaceScopedStateKey)
      ].filter(Boolean))).sort(),
      adoptionEvent: "mailchimp.capability.client_runtime_adoption.adopted",
      statusEvent: "mailchimp.capability.client_runtime_adoption.status",
      missingStatePolicy: needsAction.length
        ? "surface-runtime-adoption-actions-before-queue"
        : "rebuild-runtime-adoption-queue-from-compiled-contract"
    },
    clientHandoff: {
      workflowId: workflow.workflowId,
      providerHandoffSnapshotId: providerHandoff.snapshotId,
      acceptedForClientPreview: workflow.readiness?.acceptedForClientPreview !== false,
      acceptedForRuntimeQueue: needsAction.length === 0 && queueable.length > 0,
      acceptedForProviderWrite: writeCommands.length > 0
        && writeCommands.every((command) => command.canQueue && command.idempotency.required),
      nextAction: needsAction[0]?.clientControl?.nextAction
        || (queueable.length ? "adopt-runtime-command-queue" : "declare-mailchimp-capabilities"),
      visibleStatuses: Array.from(new Set(adoptionCommands.map((command) => command.visibleStatus))).sort()
    },
    auditHandoff: {
      stream: tenantBoundary?.auditHandoff?.stream || boundaryGate.auditHandoff?.stream || null,
      requiredEvents: Array.from(new Set([
        ...(boundaryGate.auditHandoff?.requiredEvents || []),
        workflow.requestStateContract?.adoptionEvent,
        "mailchimp.capability.client_runtime_adoption.rendered",
        "mailchimp.capability.client_runtime_adoption.adopted"
      ].filter(Boolean))).sort(),
      emittedEvents: Array.from(new Set(adoptionCommands.map((command) => command.audit.event))).sort(),
      includeTenantIsolationKey: true,
      redactProviderPayloads: true
    },
    nextActions: needsAction.map((command) => ({
      action: command.action,
      commandId: command.commandId,
      nextAction: command.clientControl.nextAction,
      required: true,
      visibleStatus: command.visibleStatus,
      blockingReasons: command.blockingReasons
    })),
    counters: {
      commands: adoptionCommands.length,
      queueableCommands: queueable.length,
      heldCommands: needsAction.length,
      writeCommands: writeCommands.length,
      blockingReasons: needsAction.reduce((count, command) => count + command.blockingReasons.length, 0),
      requiredStateKeys: Array.from(new Set(adoptionCommands.map((command) => command.workspaceScopedStateKey).filter(Boolean))).length
    },
    truthBoundary: {
      source: "capability-compiler",
      externalProviderStateVerified: false,
      persistedStateTrustedAsCallerSupplied: true,
      deterministic: true
    }
  };
}

export function compileCapabilityAdapterHandoffReadiness(contract = {}, options = {}) {
  const capabilities = contract.capabilities || [];
  const providerService = contract.providerServiceContract
    || summarizeProviderServiceContract(capabilities);
  const commandLedger = contract.commandLedger || compileCapabilityCommandLedger({ capabilities });
  const boundaryGate = contract.runtimeBoundaryGate || compileCapabilityRuntimeBoundaryGate({
    capabilities,
    providerServiceContract: providerService,
    commandLedger
  }, options);
  const providerHandoff = contract.providerHandoffManifest || compileCapabilityProviderHandoffManifest({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: boundaryGate
  }, options);
  const runtimeAdoption = contract.clientRuntimeAdoptionQueue || compileCapabilityClientRuntimeAdoptionQueue({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: boundaryGate,
    providerHandoffManifest: providerHandoff
  }, options);
  const operations = providerHandoff.operations || [];
  const queueableCommandIds = runtimeAdoption.runtimeQueue?.queueableCommandIds || [];
  const heldCommandIds = runtimeAdoption.runtimeQueue?.heldCommandIds || [];
  const blockedOperations = operations.filter((operation) => (
    operation.handoffStatus === "blocked-by-boundary"
  ));
  const approvalOperations = operations.filter((operation) => (
    operation.handoffStatus === "awaiting-operator-approval"
  ));
  const disabledOperations = operations.filter((operation) => (
    operation.handoffStatus === "disabled-until-runtime-control"
  ));
  const providerWriteOperations = operations.filter((operation) => operation.externalWrite);
  const missingIdempotency = providerWriteOperations
    .filter((operation) => operation.idempotency?.required && !operation.idempotency.keySource)
    .map((operation) => operation.action);
  const handoffStatus = blockedOperations.length || boundaryGate.status === "blocked" || missingIdempotency.length
    ? "blocked"
    : approvalOperations.length || disabledOperations.length || heldCommandIds.length
      ? "operator-action-required"
      : queueableCommandIds.length
        ? "ready-for-adapter-queue"
        : "empty";

  return {
    kind: "aios.capabilityAdapterHandoffReadiness",
    provider: "mailchimp",
    snapshotId: `capability_adapter_handoff_${stableCapabilityId({
      providerHandoff: providerHandoff.snapshotId,
      runtimeAdoption: runtimeAdoption.snapshotId,
      handoffStatus,
      heldCommandIds,
      queueableCommandIds
    })}`,
    status: handoffStatus,
    acceptedForRuntimeAdapter: handoffStatus === "ready-for-adapter-queue",
    providerService: providerService.providerService || "mailchimp-marketing-api",
    tenantBoundary: providerService.tenantBoundary || boundaryGate.tenantBoundary || null,
    adapterQueue: {
      namespace: runtimeAdoption.runtimeQueue?.namespace || commandLedger.persistenceNamespace || "capability.commands",
      queueableCommandIds,
      heldCommandIds,
      writeCommandIds: runtimeAdoption.runtimeQueue?.writeCommandIds || [],
      queuePolicy: runtimeAdoption.runtimeQueue?.queuePolicy || "queue-ready-commands-with-rate-limit-budget",
      missingStatePolicy: runtimeAdoption.runtimeQueue?.missingStatePolicy
        || commandLedger.clientStateContract?.missingStatePolicy
        || "rebuild-empty-command-state-from-compiled-contract"
    },
    providerContract: {
      requiredScopes: providerHandoff.requiredScopes || providerService.syncMetadata?.serviceScopes || [],
      requiredMemory: providerHandoff.requiredMemory || providerService.requiredMemory || [],
      handoffStates: providerHandoff.handoffStates || providerService.handoffStates || {},
      rateLimitBudgetKey: providerHandoff.adapterHandoff?.syncMetadata?.rateLimitBudgetKey
        || providerService.syncMetadata?.rateLimitBudgetKey
        || PROVIDER_RATE_LIMIT_PROFILE.budgetKey,
      duplicatePolicy: providerHandoff.adapterHandoff?.externalWritePolicy?.duplicatePolicy
        || commandLedger.recovery?.onDuplicateCommand
        || "return-persisted-provider-result-when-available"
    },
    blockers: [
      ...blockedOperations.map((operation) => ({
        source: "capability-boundary",
        action: operation.action,
        commandId: operation.commandId,
        status: operation.handoffStatus,
        nextAction: operation.nextAction,
        required: true
      })),
      ...missingIdempotency.map((action) => ({
        source: "capability-idempotency",
        action,
        commandId: null,
        status: "missing-idempotency-key-source",
        nextAction: "compile-idempotency-key-source",
        required: true
      }))
    ],
    operatorActions: [
      ...approvalOperations.map((operation) => ({
        source: "capability-approval",
        action: operation.action,
        commandId: operation.commandId,
        nextAction: operation.nextAction,
        required: true
      })),
      ...disabledOperations.map((operation) => ({
        source: "capability-runtime-control",
        action: operation.action,
        commandId: operation.commandId,
        nextAction: operation.nextAction,
        required: false
      })),
      ...(runtimeAdoption.nextActions || []).map((item) => ({
        source: "capability-runtime-adoption",
        action: item.action,
        commandId: item.commandId,
        nextAction: item.nextAction,
        required: item.required === true
      }))
    ],
    counters: {
      operations: operations.length,
      queueableCommands: queueableCommandIds.length,
      heldCommands: heldCommandIds.length,
      providerWrites: providerWriteOperations.length,
      blockedOperations: blockedOperations.length,
      approvalOperations: approvalOperations.length,
      disabledOperations: disabledOperations.length,
      missingIdempotency: missingIdempotency.length
    },
    truthBoundary: {
      source: "capability-compiler",
      externalProviderStateVerified: false,
      deterministic: true
    }
  };
}

export function compileCapabilityProviderExecutionBatch(contract = {}, options = {}) {
  const capabilities = contract.capabilities || [];
  const providerService = contract.providerServiceContract
    || summarizeProviderServiceContract(capabilities);
  const commandLedger = contract.commandLedger || compileCapabilityCommandLedger({ capabilities });
  const providerHandoff = contract.providerHandoffManifest || compileCapabilityProviderHandoffManifest({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: contract.runtimeBoundaryGate
  }, options);
  const runtimeSettings = contract.runtimeSettingsAdoption || compileCapabilityRuntimeSettingsAdoption({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: contract.runtimeBoundaryGate,
    providerHandoffManifest: providerHandoff,
    clientWorkflowAdoption: contract.clientWorkflowAdoption,
    clientRuntimeAdoptionQueue: contract.clientRuntimeAdoptionQueue,
    adapterHandoffReadiness: contract.adapterHandoffReadiness,
    controlReviewPacket: contract.controlReviewPacket
  }, options);
  const adapterReadiness = contract.adapterHandoffReadiness || compileCapabilityAdapterHandoffReadiness({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: contract.runtimeBoundaryGate,
    providerHandoffManifest: providerHandoff,
    clientRuntimeAdoptionQueue: contract.clientRuntimeAdoptionQueue
  }, options);
  const settingsByAction = new Map((runtimeSettings.settings || []).map((setting) => [setting.action, setting]));
  const commandsById = new Map((commandLedger.commands || []).map((command) => [command.commandId, command]));
  const queueableCommandIds = new Set(adapterReadiness.adapterQueue?.queueableCommandIds || []);
  const heldCommandIds = new Set(adapterReadiness.adapterQueue?.heldCommandIds || []);
  const batchOperations = (providerHandoff.operations || []).map((operation, index) => {
    const command = commandsById.get(operation.commandId) || {};
    const setting = settingsByAction.get(operation.action) || {};
    const providerWrite = operation.externalWrite === true;
    const queueable = queueableCommandIds.has(operation.commandId);
    const held = heldCommandIds.has(operation.commandId)
      || setting.adoptionStatus === "runtime-control-required"
      || operation.handoffStatus !== "ready-for-provider-adapter";

    return {
      order: index + 1,
      action: operation.action,
      commandId: operation.commandId,
      providerService: operation.providerService || providerService.providerService || "mailchimp-marketing-api",
      serviceOperation: operation.serviceOperation,
      providerWrite,
      batchStatus: queueable && !held ? "queued" : held ? "held" : "not-queueable",
      handoffStatus: operation.handoffStatus,
      persistedStateKey: command.persistedStateKey || null,
      workspaceScopedStateKey: operation.adapterRequest?.workspaceScopedStateKey || null,
      preconditions: {
        commandStateAdopted: Boolean(command.persistedStateKey),
        runtimeSettingsAccepted: setting.adoptionStatus !== "runtime-control-required",
        approvalSatisfied: !operation.requiresApproval || setting.validation?.approvalSatisfied === true,
        tenantBoundaryReady: Boolean(operation.adapterRequest?.tenantIsolationKey),
        idempotencyReady: !providerWrite || operation.idempotency?.required === true
      },
      idempotency: {
        required: providerWrite,
        keySource: operation.idempotency?.keySource || null,
        duplicatePolicy: operation.idempotency?.duplicatePolicy || "allow-read-refresh"
      },
      rateLimit: {
        budgetKey: operation.adapterRequest?.rateLimitBudgetKey || PROVIDER_RATE_LIMIT_PROFILE.budgetKey,
        retryAfterHeader: operation.adapterRequest?.retryAfterHeader || PROVIDER_RATE_LIMIT_PROFILE.retryAfterHeader,
        maxInvocations: command.clientControl?.maxInvocations || null
      },
      payloadPolicy: operation.adapterRequest?.payloadPolicy || (providerWrite ? "redact-and-stage-local-draft" : "read-through-provider-cache"),
      nextAction: queueable && !held
        ? "dispatch-provider-operation"
        : setting.nextAction || operation.nextAction || command.clientControl?.nextAction || "review-provider-operation"
    };
  });
  const queuedOperations = batchOperations.filter((operation) => operation.batchStatus === "queued");
  const heldOperations = batchOperations.filter((operation) => operation.batchStatus === "held");
  const writeOperations = batchOperations.filter((operation) => operation.providerWrite);
  const snapshotId = `capability_provider_execution_batch_${stableCapabilityId({
    operations: batchOperations.map((operation) => `${operation.action}:${operation.batchStatus}`),
    adapterStatus: adapterReadiness.status,
    runtimeSettingsStatus: runtimeSettings.status
  })}`;

  return {
    kind: "aios.capabilityProviderExecutionBatch",
    provider: "mailchimp",
    snapshotId,
    status: adapterReadiness.status === "blocked" || heldOperations.some((operation) => operation.handoffStatus === "blocked-by-boundary")
      ? "blocked"
      : heldOperations.length
        ? "held-for-operator-action"
        : queuedOperations.length
          ? "ready-to-dispatch"
          : "empty",
    providerService: providerService.providerService || "mailchimp-marketing-api",
    tenantBoundary: providerService.tenantBoundary || adapterReadiness.tenantBoundary || null,
    operations: batchOperations,
    dispatchPlan: {
      queueNamespace: adapterReadiness.adapterQueue?.namespace || commandLedger.persistenceNamespace || "capability.commands",
      queuedCommandIds: queuedOperations.map((operation) => operation.commandId).filter(Boolean),
      heldCommandIds: heldOperations.map((operation) => operation.commandId).filter(Boolean),
      writeCommandIds: writeOperations.map((operation) => operation.commandId).filter(Boolean),
      readBeforeWrite: writeOperations.length > 0,
      externalWritePolicy: writeOperations.length
        ? "dedupe-idempotency-and-stage-local-draft-before-provider-write"
        : "read-through-provider-cache"
    },
    persistedStateContract: {
      namespace: "capability.provider_execution_batch",
      snapshotKey: `capability.provider_execution_batch.${snapshotId}`,
      statusKey: "capability.provider_execution_batch.currentStatus",
      requiredStateKeys: Array.from(new Set([
        ...(commandLedger.clientStateContract?.requiredStateKeys || []),
        ...(runtimeSettings.persistedStateContract?.requiredStateKeys || []),
        ...batchOperations.map((operation) => operation.workspaceScopedStateKey)
      ].filter(Boolean))).sort(),
      adoptionEvent: "mailchimp.capability.provider_execution_batch.adopted",
      statusEvent: "mailchimp.capability.provider_execution_batch.status",
      missingStatePolicy: heldOperations.length
        ? "hold-provider-dispatch-until-batch-state-restored"
        : "rebuild-execution-batch-from-provider-handoff"
    },
    nextActions: heldOperations.map((operation) => ({
      action: operation.action,
      commandId: operation.commandId,
      nextAction: operation.nextAction,
      required: true,
      handoffStatus: operation.handoffStatus
    })),
    counters: {
      operations: batchOperations.length,
      queuedOperations: queuedOperations.length,
      heldOperations: heldOperations.length,
      writeOperations: writeOperations.length,
      requiredStateKeys: Array.from(new Set(batchOperations.map((operation) => operation.workspaceScopedStateKey).filter(Boolean))).length
    },
    truthBoundary: {
      source: "capability-compiler",
      externalProviderStateVerified: false,
      deterministic: true
    }
  };
}

export function compileCapabilityControlReviewPacket(contract = {}, options = {}) {
  const capabilities = contract.capabilities || [];
  const providerService = contract.providerServiceContract
    || summarizeProviderServiceContract(capabilities);
  const commandLedger = contract.commandLedger || compileCapabilityCommandLedger({ capabilities });
  const lifecycleSummary = contract.lifecycleSummary || summarizeCapabilityLifecycle(capabilities);
  const workflow = contract.clientWorkflowAdoption || compileCapabilityClientWorkflowAdoption({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: contract.runtimeBoundaryGate,
    providerHandoffManifest: contract.providerHandoffManifest
  }, options);
  const runtimeAdoption = contract.clientRuntimeAdoptionQueue || compileCapabilityClientRuntimeAdoptionQueue({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: contract.runtimeBoundaryGate,
    providerHandoffManifest: contract.providerHandoffManifest,
    clientWorkflowAdoption: workflow
  }, options);
  const adapterReadiness = contract.adapterHandoffReadiness || compileCapabilityAdapterHandoffReadiness({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: contract.runtimeBoundaryGate,
    providerHandoffManifest: contract.providerHandoffManifest,
    clientWorkflowAdoption: workflow,
    clientRuntimeAdoptionQueue: runtimeAdoption
  }, options);
  const commandByAction = new Map((commandLedger.commands || []).map((command) => [command.action, command]));
  const workflowByAction = new Map((workflow.previewModel?.actions || []).map((action) => [action.action, action]));
  const controls = capabilities.map((capability, index) => {
    const command = commandByAction.get(capability.action) || {};
    const workflowAction = workflowByAction.get(capability.action) || {};
    const lifecycle = capability.lifecycle || {};
    const operation = capability.providerOperation || {};
    const providerWrite = operation.externalWrite === true;
    const disabled = lifecycle.enabled === false || command.commandStatus === "disabled";
    const approvalRequired = operation.settingsControls?.approvalRequired === true
      || lifecycle.controls?.requiresApprovalBeforeEnable === true
      || providerWrite;
    const queueable = workflowAction.canQueue === true && command.clientControl?.canQueue === true;

    return {
      order: index + 1,
      action: capability.action,
      commandId: command.commandId || workflowAction.commandId || null,
      visibleStatus: disabled
        ? "disabled"
        : queueable
          ? "ready"
          : approvalRequired
            ? "approval-required"
            : workflowAction.status || command.commandStatus || "compiled",
      enabled: !disabled,
      scheduleWindow: lifecycle.scheduleWindow || operation.settingsControls?.scheduleWindow || "runtime",
      maxInvocations: lifecycle.maxInvocations || operation.rateLimit?.maxInvocations || 1,
      providerWrite,
      approvalRequired,
      canQueue: queueable,
      canEnableAtRuntime: lifecycle.controls?.canEnableAtRuntime === true,
      nextAction: disabled
        ? "enable-runtime-command"
        : queueable
          ? "queue-runtime-command"
          : workflowAction.nextAction || command.clientControl?.nextAction || lifecycle.nextAction || "review-capability-control",
      settingsValidation: {
        scheduleSupported: ["preflight", "runtime", "operator-approved", "manual-approval", "post-run"]
          .includes(lifecycle.scheduleWindow || operation.settingsControls?.scheduleWindow || "runtime"),
        maxInvocationsPositive: Number.isInteger(Number(lifecycle.maxInvocations || operation.rateLimit?.maxInvocations || 1)),
        localOnly: operation.settingsControls?.localOnly !== false,
        idempotencyReady: !providerWrite || command.idempotency?.required === true
      }
    };
  });
  const blockingControls = controls.filter((control) => (
    control.visibleStatus === "disabled" || control.visibleStatus === "approval-required"
  ));
  const exportReadyControls = controls.filter((control) => control.canQueue);

  return {
    kind: "aios.capabilityControlReviewPacket",
    provider: "mailchimp",
    snapshotId: `capability_control_review_${stableCapabilityId({
      actions: controls.map((control) => control.action),
      statuses: controls.map((control) => control.visibleStatus),
      adapterStatus: adapterReadiness.status,
      workflowStatus: workflow.status
    })}`,
    status: adapterReadiness.status === "blocked"
      ? "blocked"
      : blockingControls.length
        ? "operator-action-required"
        : exportReadyControls.length
          ? "ready"
          : "empty",
    controls,
    lifecycle: lifecycleSummary,
    exportSummary: {
      acceptedForClientPreview: workflow.readiness?.acceptedForClientPreview !== false,
      acceptedForRuntimeQueue: runtimeAdoption.clientHandoff?.acceptedForRuntimeQueue === true,
      acceptedForAdapterHandoff: adapterReadiness.acceptedForRuntimeAdapter === true,
      queueableCommandIds: runtimeAdoption.runtimeQueue?.queueableCommandIds || [],
      heldCommandIds: runtimeAdoption.runtimeQueue?.heldCommandIds || [],
      disabledActions: controls.filter((control) => !control.enabled).map((control) => control.action),
      approvalRequiredActions: controls.filter((control) => control.approvalRequired).map((control) => control.action),
      nextActions: controls
        .filter((control) => !control.canQueue || control.nextAction !== "queue-runtime-command")
        .map((control) => ({
          action: control.action,
          commandId: control.commandId,
          nextAction: control.nextAction,
          required: control.visibleStatus === "disabled" || control.visibleStatus === "approval-required"
        }))
    },
    counters: {
      controls: controls.length,
      enabledControls: controls.filter((control) => control.enabled).length,
      disabledControls: controls.filter((control) => !control.enabled).length,
      approvalRequiredControls: controls.filter((control) => control.approvalRequired).length,
      queueableControls: exportReadyControls.length,
      providerWriteControls: controls.filter((control) => control.providerWrite).length,
      heldCommands: runtimeAdoption.counters?.heldCommands || 0
    },
    requestStateContract: {
      namespace: "capability.control_review",
      snapshotKey: "capability.control_review.currentSnapshot",
      statusKey: "capability.control_review.currentStatus",
      requiredStateKeys: Array.from(new Set([
        ...(workflow.requestStateContract?.requiredStateKeys || []),
        ...(runtimeAdoption.requestStateContract?.requiredStateKeys || [])
      ])).sort(),
      adoptionEvent: "mailchimp.capability.control_review.adopted",
      statusEvent: "mailchimp.capability.control_review.status",
      missingStatePolicy: blockingControls.length
        ? "surface-capability-controls-before-runtime"
        : "rebuild-control-review-from-capability-contract"
    },
    truthBoundary: {
      source: "capability-compiler",
      externalProviderStateVerified: false,
      deterministic: true
    }
  };
}

export function compileCapabilityRuntimeSettingsAdoption(contract = {}, options = {}) {
  const capabilities = contract.capabilities || [];
  const providerService = contract.providerServiceContract
    || summarizeProviderServiceContract(capabilities);
  const commandLedger = contract.commandLedger || compileCapabilityCommandLedger({ capabilities });
  const providerHandoff = contract.providerHandoffManifest || compileCapabilityProviderHandoffManifest({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: contract.runtimeBoundaryGate
  }, options);
  const controlReview = contract.controlReviewPacket || compileCapabilityControlReviewPacket({
    capabilities,
    providerServiceContract: providerService,
    commandLedger,
    runtimeBoundaryGate: contract.runtimeBoundaryGate,
    providerHandoffManifest: providerHandoff,
    clientWorkflowAdoption: contract.clientWorkflowAdoption,
    clientRuntimeAdoptionQueue: contract.clientRuntimeAdoptionQueue,
    adapterHandoffReadiness: contract.adapterHandoffReadiness,
    lifecycleSummary: contract.lifecycleSummary || summarizeCapabilityLifecycle(capabilities)
  }, options);
  const requestedSettings = options.runtimeSettings || options.capabilitySettings || {};
  const requestedActions = requestedSettings.actions || {};
  const controlByAction = new Map((controlReview.controls || []).map((control) => [control.action, control]));
  const commandByAction = new Map((commandLedger.commands || []).map((command) => [command.action, command]));
  const providerByAction = new Map((providerHandoff.operations || []).map((operation) => [operation.action, operation]));
  const settings = capabilities.map((capability, index) => {
    const control = controlByAction.get(capability.action) || {};
    const command = commandByAction.get(capability.action) || {};
    const providerOperation = providerByAction.get(capability.action) || {};
    const requested = requestedActions[capability.action] || {};
    const lifecycle = capability.lifecycle || {};
    const requestedEnabled = requested.enabled;
    const requestedScheduleWindow = requested.scheduleWindow || requested.schedule;
    const requestedMaxInvocations = requested.maxInvocations;
    const requestedApprovalToken = requested.approvalToken || requested.approval;
    const effectiveEnabled = normalizeBoolean(requestedEnabled, control.enabled !== false);
    const effectiveScheduleWindow = requestedScheduleWindow || control.scheduleWindow || lifecycle.scheduleWindow || "runtime";
    const effectiveMaxInvocations = normalizePositiveInteger(
      requestedMaxInvocations ?? control.maxInvocations,
      control.maxInvocations || lifecycle.maxInvocations || 1
    );
    const supportedSchedule = ["preflight", "runtime", "operator-approved", "manual-approval", "post-run"]
      .includes(effectiveScheduleWindow);
    const providerWrite = control.providerWrite === true || providerOperation.externalWrite === true;
    const approvalRequired = control.approvalRequired === true || providerWrite;
    const approvalSatisfied = !approvalRequired || Boolean(requestedApprovalToken);
    const enablementChanged = requestedEnabled != null && effectiveEnabled !== (control.enabled !== false);
    const scheduleChanged = requestedScheduleWindow != null && requestedScheduleWindow !== control.scheduleWindow;
    const invocationChanged = requestedMaxInvocations != null
      && effectiveMaxInvocations !== (control.maxInvocations || lifecycle.maxInvocations || 1);
    const blocksRuntime = !effectiveEnabled
      || !supportedSchedule
      || (approvalRequired && !approvalSatisfied)
      || providerOperation.handoffStatus === "blocked-by-boundary";

    return {
      order: index + 1,
      action: capability.action,
      commandId: command.commandId || control.commandId || providerOperation.commandId || null,
      providerOperation: providerOperation.serviceOperation || capability.providerOperation?.serviceOperation || null,
      providerWrite,
      previousState: {
        enabled: control.enabled !== false,
        scheduleWindow: control.scheduleWindow || lifecycle.scheduleWindow || "runtime",
        maxInvocations: control.maxInvocations || lifecycle.maxInvocations || 1,
        visibleStatus: control.visibleStatus || command.commandStatus || "compiled"
      },
      requestedState: {
        enabled: requestedEnabled ?? null,
        scheduleWindow: requestedScheduleWindow || null,
        maxInvocations: requestedMaxInvocations ?? null,
        approvalTokenProvided: Boolean(requestedApprovalToken)
      },
      effectiveState: {
        enabled: effectiveEnabled,
        scheduleWindow: effectiveScheduleWindow,
        maxInvocations: effectiveMaxInvocations,
        approvalSatisfied,
        localOnly: capability.providerOperation?.settingsControls?.localOnly !== false
      },
      validation: {
        supportedSchedule,
        maxInvocationsPositive: effectiveMaxInvocations > 0,
        approvalRequired,
        approvalSatisfied,
        canApplyWithoutProviderRead: true,
        canApplyBeforeRuntimeQueue: supportedSchedule && effectiveEnabled && approvalSatisfied
      },
      changeSet: {
        enablementChanged,
        scheduleChanged,
        invocationChanged,
        hasRuntimeSettingChange: enablementChanged || scheduleChanged || invocationChanged || Boolean(requestedApprovalToken)
      },
      adoptionStatus: blocksRuntime
        ? "runtime-control-required"
        : providerOperation.handoffStatus === "ready-for-provider-adapter" || command.clientControl?.canQueue === true
          ? "adopted-for-runtime"
          : "compiled",
      nextAction: !supportedSchedule
        ? "select-supported-capability-schedule"
        : !effectiveEnabled
          ? "enable-runtime-command"
          : approvalRequired && !approvalSatisfied
            ? capability.lifecycle?.nextAction || control.nextAction || "collect-provider-write-approval"
            : command.clientControl?.canQueue
              ? "queue-runtime-command"
              : control.nextAction || providerOperation.nextAction || "review-runtime-command"
    };
  });
  const blockedSettings = settings.filter((setting) => setting.adoptionStatus === "runtime-control-required");
  const changedSettings = settings.filter((setting) => setting.changeSet.hasRuntimeSettingChange);
  const adoptedSettings = settings.filter((setting) => setting.adoptionStatus === "adopted-for-runtime");
  const requiredStateKeys = Array.from(new Set([
    ...(controlReview.requestStateContract?.requiredStateKeys || []),
    ...(commandLedger.clientStateContract?.requiredStateKeys || []),
    ...settings.map((setting) => `capability.runtime_settings.${setting.action}`)
  ].filter(Boolean))).sort();
  const snapshotId = `capability_runtime_settings_${stableCapabilityId({
    actions: settings.map((setting) => setting.action),
    adopted: adoptedSettings.map((setting) => setting.action),
    blocked: blockedSettings.map((setting) => setting.action),
    changed: changedSettings.map((setting) => setting.action),
    providerHandoffStatus: providerHandoff.status
  })}`;

  return {
    kind: "aios.capabilityRuntimeSettingsAdoption",
    provider: "mailchimp",
    snapshotId,
    status: blockedSettings.length
      ? "operator-action-required"
      : changedSettings.length
        ? "settings-adopted"
        : adoptedSettings.length
          ? "runtime-ready"
          : "compiled",
    acceptedForRuntimeQueue: blockedSettings.length === 0 && adoptedSettings.length > 0,
    acceptedForProviderWrite: blockedSettings.length === 0
      && settings.some((setting) => setting.providerWrite)
      && settings.filter((setting) => setting.providerWrite).every((setting) => setting.validation.approvalSatisfied),
    settings,
    runtimeSettingsPatch: {
      namespace: "capability.runtime_settings",
      changedActions: changedSettings.map((setting) => setting.action),
      adoptedCommandIds: adoptedSettings.map((setting) => setting.commandId).filter(Boolean),
      heldCommandIds: blockedSettings.map((setting) => setting.commandId).filter(Boolean),
      applyPolicy: blockedSettings.length
        ? "hold-runtime-queue-until-settings-accepted"
        : changedSettings.length
          ? "persist-settings-before-runtime-queue"
          : "reuse-compiled-capability-settings"
    },
    nextActions: blockedSettings.map((setting) => ({
      action: setting.action,
      commandId: setting.commandId,
      nextAction: setting.nextAction,
      required: true,
      scheduleWindow: setting.effectiveState.scheduleWindow
    })),
    persistedStateContract: {
      namespace: "capability.runtime_settings",
      snapshotKey: `capability.runtime_settings.${snapshotId}`,
      statusKey: "capability.runtime_settings.currentStatus",
      requiredStateKeys,
      adoptionEvent: "mailchimp.capability.runtime_settings.adopted",
      statusEvent: "mailchimp.capability.runtime_settings.status",
      missingStatePolicy: blockedSettings.length
        ? "surface-runtime-settings-before-command-queue"
        : "rebuild-runtime-settings-from-compiled-controls"
    },
    counters: {
      settings: settings.length,
      changedSettings: changedSettings.length,
      adoptedSettings: adoptedSettings.length,
      blockedSettings: blockedSettings.length,
      providerWriteSettings: settings.filter((setting) => setting.providerWrite).length,
      approvalRequiredSettings: settings.filter((setting) => setting.validation.approvalRequired).length,
      requiredStateKeys: requiredStateKeys.length
    },
    truthBoundary: {
      source: "capability-compiler",
      runtimeSettingsCallerSupplied: Boolean(options.runtimeSettings || options.capabilitySettings),
      externalProviderStateVerified: false,
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

  const providerServiceContract = summarizeProviderServiceContract(capabilities, tenantBoundary);
  const commandLedger = compileCapabilityCommandLedger({ capabilities });
  const recoveryPlan = compileCapabilityRecoveryPlan({ capabilities });
  const stateRecoveryEnvelope = compileCapabilityStateRecoveryEnvelope({
    capabilities,
    providerServiceContract
  }, options.persistedCommandState || {});
  const boundaryAuditManifest = compileCapabilityBoundaryAuditManifest({
    capabilities,
    providerServiceContract,
    commandLedger
  }, options.persistedCommandState || {});
  const runtimeBoundaryGate = compileCapabilityRuntimeBoundaryGate({
    capabilities,
    providerServiceContract,
    commandLedger,
    boundaryAuditManifest
  }, {
    ...options,
    persistedCommandState: options.persistedCommandState || {}
  });
  const operationalAnalytics = compileCapabilityOperationalAnalytics({
    capabilities,
    providerServiceContract,
    commandLedger,
    runtimeBoundaryGate,
    lifecycleSummary: summarizeCapabilityLifecycle(capabilities)
  }, options);
  const providerHandoffManifest = compileCapabilityProviderHandoffManifest({
    capabilities,
    providerServiceContract,
    commandLedger,
    runtimeBoundaryGate
  }, options);
  const clientWorkflowAdoption = compileCapabilityClientWorkflowAdoption({
    capabilities,
    providerServiceContract,
    commandLedger,
    recoveryPlan,
    stateRecoveryEnvelope,
    boundaryAuditManifest,
    runtimeBoundaryGate,
    operationalAnalytics,
    providerHandoffManifest
  }, options);
  const clientRuntimeAdoptionQueue = compileCapabilityClientRuntimeAdoptionQueue({
    capabilities,
    providerServiceContract,
    commandLedger,
    recoveryPlan,
    stateRecoveryEnvelope,
    boundaryAuditManifest,
    runtimeBoundaryGate,
    operationalAnalytics,
    providerHandoffManifest,
    clientWorkflowAdoption
  }, options);
  const adapterHandoffReadiness = compileCapabilityAdapterHandoffReadiness({
    capabilities,
    providerServiceContract,
    commandLedger,
    recoveryPlan,
    stateRecoveryEnvelope,
    boundaryAuditManifest,
    runtimeBoundaryGate,
    operationalAnalytics,
    providerHandoffManifest,
    clientWorkflowAdoption,
    clientRuntimeAdoptionQueue
  }, options);
  const controlReviewPacket = compileCapabilityControlReviewPacket({
    capabilities,
    providerServiceContract,
    commandLedger,
    recoveryPlan,
    stateRecoveryEnvelope,
    boundaryAuditManifest,
    runtimeBoundaryGate,
    operationalAnalytics,
    providerHandoffManifest,
    clientWorkflowAdoption,
    clientRuntimeAdoptionQueue,
    adapterHandoffReadiness,
    lifecycleSummary: summarizeCapabilityLifecycle(capabilities)
  }, options);
  const runtimeSettingsAdoption = compileCapabilityRuntimeSettingsAdoption({
    capabilities,
    providerServiceContract,
    commandLedger,
    recoveryPlan,
    stateRecoveryEnvelope,
    boundaryAuditManifest,
    runtimeBoundaryGate,
    operationalAnalytics,
    providerHandoffManifest,
    clientWorkflowAdoption,
    clientRuntimeAdoptionQueue,
    adapterHandoffReadiness,
    controlReviewPacket,
    lifecycleSummary: summarizeCapabilityLifecycle(capabilities)
  }, options);
  const providerExecutionBatch = compileCapabilityProviderExecutionBatch({
    capabilities,
    providerServiceContract,
    commandLedger,
    recoveryPlan,
    stateRecoveryEnvelope,
    boundaryAuditManifest,
    runtimeBoundaryGate,
    operationalAnalytics,
    providerHandoffManifest,
    clientWorkflowAdoption,
    clientRuntimeAdoptionQueue,
    adapterHandoffReadiness,
    controlReviewPacket,
    runtimeSettingsAdoption
  }, options);

  return {
    kind: "aios.capabilityContract",
    provider: "mailchimp",
    capabilities,
    providerServiceContract,
    commandLedger,
    recoveryPlan,
    stateRecoveryEnvelope,
    boundaryAuditManifest,
    runtimeBoundaryGate,
    operationalAnalytics,
    providerHandoffManifest,
    clientWorkflowAdoption,
    clientRuntimeAdoptionQueue,
    adapterHandoffReadiness,
    controlReviewPacket,
    runtimeSettingsAdoption,
    providerExecutionBatch,
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
