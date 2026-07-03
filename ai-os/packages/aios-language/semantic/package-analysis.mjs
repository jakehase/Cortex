import { compilePackageManifest } from "../compiler/package-manifest-compiler.mjs";

const EXTERNAL_WRITE_CAPABILITIES = new Set([
  "external.write",
  "network.write",
  "mailchimp.send",
  "mailchimp.segment.write",
]);

const DEFAULT_READ_ROLES = ["service", "operator", "admin"];
const DEFAULT_WRITE_ROLES = ["operator", "admin"];

function compactString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function stableId(prefix, parts) {
  const input = parts.map((part) => compactString(part)).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeRoleList(value, fallback = []) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set([
    ...raw.map((role) => compactString(role)).filter(Boolean),
    ...fallback,
  ])].sort();
}

function normalizeWorkspaceScope(descriptor, operation = {}) {
  const packageBoundary = descriptor.truthBoundary?.tenantBoundary || descriptor.boundary || {};
  const operationBoundary = operation.truthBoundary?.tenantBoundary || operation.boundary || {};
  const tenant = compactString(
    operation.tenant || operationBoundary.tenant || packageBoundary.tenant,
    compactString(descriptor.name, "default"),
  );
  const workspace = compactString(
    operation.workspace || operationBoundary.workspace || packageBoundary.workspace,
    compactString(descriptor.version, "default"),
  );
  const environment = compactString(
    operation.environment || operationBoundary.environment || packageBoundary.environment,
    "production",
  );

  return { tenant, workspace, environment };
}

function buildTenantPermissionBoundary(descriptor, operation, writesExternalState) {
  const scope = normalizeWorkspaceScope(descriptor, operation);
  const packageBoundary = descriptor.truthBoundary?.tenantBoundary || descriptor.boundary || {};
  const operationBoundary = operation.truthBoundary?.tenantBoundary || operation.boundary || {};
  const configuredRoles = normalizeRoleList(
    operationBoundary.allowedRoles || operation.allowedRoles || packageBoundary.allowedRoles,
    writesExternalState ? DEFAULT_WRITE_ROLES : DEFAULT_READ_ROLES,
  );
  const deniedRoles = normalizeRoleList(operationBoundary.deniedRoles || packageBoundary.deniedRoles, []);
  const allowedRoles = configuredRoles.filter((role) => !deniedRoles.includes(role));
  const requiresAuditCorrelation = writesExternalState
    || operationBoundary.requiresAuditCorrelation === true
    || packageBoundary.requiresAuditCorrelation === true;
  const requiresLease = writesExternalState || operationBoundary.requiresLease === true;
  const boundaryKey = stableId("boundary", [
    descriptor.id,
    operation.id,
    scope.tenant,
    scope.workspace,
    allowedRoles.join(","),
  ]);
  const auditChannel = compactString(
    operationBoundary.auditChannel || packageBoundary.auditChannel,
    `mailchimp.audit.${scope.tenant}.${scope.workspace}`,
  );
  const handoffStatusPath = compactString(
    operationBoundary.handoffStatusPath || operation.statusPath,
    `mailchimp.operations.${operation.id}.boundary`,
  );
  const violations = [
    ...(allowedRoles.length === 0
      ? ["allowed_roles_empty"]
      : []),
    ...(requiresLease && !allowedRoles.some((role) => DEFAULT_WRITE_ROLES.includes(role))
      ? ["external_write_without_lease_role"]
      : []),
    ...(!scope.tenant ? ["tenant_missing"] : []),
    ...(!scope.workspace ? ["workspace_missing"] : []),
  ];

  return {
    boundaryKey,
    scope,
    allowedRoles,
    deniedRoles,
    requiresLease,
    requiresAuditCorrelation,
    auditChannel,
    handoffStatusPath,
    status: violations.length ? "invalid" : "ready",
    violations,
    runtimeEvidenceShape: {
      tenant: "string",
      workspace: "string",
      actorRole: allowedRoles.join("|") || "unconfigured",
      auditCorrelationId: requiresAuditCorrelation ? "required-string" : "optional-string",
      boundaryKey,
    },
    statusHandoff: {
      state: violations.length ? "boundary_invalid" : "boundary_ready",
      clientStatusPath: handoffStatusPath,
      nextAction: violations.length
        ? "repair_tenant_permission_boundary"
        : requiresAuditCorrelation
          ? "attach_audit_correlation_before_handoff"
          : "handoff_with_boundary_scope",
    },
  };
}

function normalizeIssue(issue, index, source = "package-manifest") {
  const severity = issue?.severity === "error" ? "error" : issue?.severity === "info" ? "info" : "warning";
  return {
    index,
    source,
    severity,
    code: compactString(issue?.code, "package.analysis.issue"),
    message: compactString(issue?.message, "Package analysis emitted an issue."),
    field: compactString(issue?.field || issue?.path),
  };
}

function normalizeRuntimeHealthForOperation(input = {}, operation = {}, writesExternalState = false) {
  const operationHealth = input.byOperation?.[operation.id]
    || input.operations?.[operation.id]
    || input[operation.id]
    || input;
  const retry = operationHealth.retry || {};
  const failure = operationHealth.failure || {};
  const attempt = Number.isFinite(Number(retry.attempt ?? operationHealth.attempt))
    ? Math.max(0, Number(retry.attempt ?? operationHealth.attempt))
    : 0;
  const maxAttempts = Number.isFinite(Number(retry.maxAttempts ?? operationHealth.maxAttempts))
    ? Math.max(1, Number(retry.maxAttempts ?? operationHealth.maxAttempts))
    : writesExternalState ? 5 : 2;
  const baseDelayMs = Number.isFinite(Number(retry.baseDelayMs ?? operationHealth.baseDelayMs))
    ? Math.max(250, Number(retry.baseDelayMs ?? operationHealth.baseDelayMs))
    : writesExternalState ? 1500 : 500;
  const state = compactString(
    operationHealth.state || operationHealth.status || failure.state,
    "healthy",
  );
  const lastError = compactString(failure.message || operationHealth.lastError || operationHealth.error);
  const degraded = operationHealth.degraded === true
    || state === "degraded"
    || failure.mode === "degraded";
  const unavailable = state === "unavailable" || state === "offline";
  const exhausted = attempt >= maxAttempts;
  const nextDelayMs = Math.min(baseDelayMs * (2 ** attempt), writesExternalState ? 120000 : 30000);
  const status = unavailable
    ? "unavailable"
    : exhausted
      ? "retry-exhausted"
      : degraded || lastError
        ? "degraded"
        : "healthy";

  return {
    status,
    state,
    degraded: degraded || Boolean(lastError),
    unavailable,
    lastError,
    failure: {
      code: compactString(failure.code || operationHealth.code),
      mode: compactString(failure.mode || operationHealth.mode),
      actionable: compactString(failure.actionable || operationHealth.actionable),
      providerStatus: compactString(failure.providerStatus || operationHealth.providerStatus),
    },
    retry: {
      attempt,
      maxAttempts,
      baseDelayMs,
      nextDelayMs: status === "healthy" ? 0 : nextDelayMs,
      exhausted,
      reason: compactString(retry.reason || failure.code || operationHealth.reason),
    },
  };
}

function buildAdapterRecoveryContract(operation, runtimeClientState, persistedState, tenantPermissionBoundary, operationalHealth, writesExternalState) {
  const request = runtimeClientState.request;
  const client = runtimeClientState.client;
  const retryable = operationalHealth.status !== "healthy"
    && operationalHealth.status !== "unavailable"
    && operationalHealth.retry.exhausted !== true
    && persistedState.idempotentCommand.safeToReplay;
  const failed = operationalHealth.status === "unavailable"
    || operationalHealth.retry.exhausted
    || Boolean(operationalHealth.failure.code && !retryable);
  const degradedMode = operationalHealth.degraded && !failed;
  const handoffState = failed
    ? "adapter-failed"
    : degradedMode
      ? "adapter-degraded"
      : retryable
        ? "adapter-retry-scheduled"
        : "adapter-ready";
  const recoveryAction = failed
    ? operationalHealth.status === "unavailable"
      ? "wait_for_provider_status_recovery"
      : "surface_adapter_failure_to_operator"
    : retryable
      ? "retry_adapter_handoff_with_same_idempotency_key"
      : degradedMode
        ? "handoff_in_degraded_mode_with_status_poll"
        : operation.statusHandoff?.nextAction || "queue_adapter_handoff";

  return {
    provider: "mailchimp",
    service: compactString(operation.adapter, "mailchimp"),
    operationId: operation.id,
    operation: operation.operation,
    status: handoffState,
    degradedMode,
    retryable,
    failed,
    request: {
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey || null,
      replayToken: request.replayToken,
      dedupeScope: request.dedupeScope,
    },
    clientStatus: {
      statusPath: client.statusPath,
      progressPath: client.progressPath,
      boundaryStatusPath: tenantPermissionBoundary.handoffStatusPath,
      visibleStates: client.visibleStates,
    },
    backoff: {
      attempt: operationalHealth.retry.attempt,
      maxAttempts: operationalHealth.retry.maxAttempts,
      nextDelayMs: retryable || degradedMode ? operationalHealth.retry.nextDelayMs : 0,
      reason: operationalHealth.retry.reason || operationalHealth.failure.code || handoffState,
    },
    failure: failed || degradedMode
      ? {
        code: operationalHealth.failure.code || `mailchimp.adapter.${operationalHealth.status}`,
        message: operationalHealth.lastError || "Mailchimp adapter health is not ready for normal handoff.",
        actionable: operationalHealth.failure.actionable || recoveryAction,
        providerStatus: operationalHealth.failure.providerStatus || null,
      }
      : null,
    recovery: {
      nextAction: recoveryAction,
      path: persistedState.recoveryPath,
      safeToReplay: persistedState.idempotentCommand.safeToReplay,
      requiresProviderStatusFetch: writesExternalState || failed || degradedMode,
      requiresOperator: failed || persistedState.recoveryDecision.requiresOperator,
      snapshotKey: persistedState.snapshotKey,
      ledgerKey: persistedState.ledgerKey,
    },
  };
}

function collectOperationDiagnostics(operation, index) {
  const diagnostics = [];
  const capabilityNames = new Set(operation.capabilityNames || []);
  const hasExternalWriteCapability = [...capabilityNames].some((name) => EXTERNAL_WRITE_CAPABILITIES.has(name));
  const writesExternalState = operation.truthBoundary?.externalState === true || hasExternalWriteCapability;
  const commandState = operation.stateContract?.commandState || {};
  const requestState = operation.stateContract?.requestState || operation.requestState || {};
  const clientState = operation.stateContract?.clientState || operation.clientState || {};

  if (writesExternalState && operation.idempotency?.mode === "none") {
    diagnostics.push({
      index,
      source: "operation",
      severity: "error",
      code: "package.operation.external_write_without_idempotency",
      message: `Operation ${operation.id} writes external Mailchimp state without an idempotency contract.`,
      field: `operations.${index}.idempotency`,
    });
  }

  if (operation.persistence?.restartSafe === false && operation.persistence?.replayPolicy !== "manual-review") {
    diagnostics.push({
      index,
      source: "operation",
      severity: "warning",
      code: "package.operation.restart_not_safe",
      message: `Operation ${operation.id} is not restart-safe and should hand off to manual review on recovery.`,
      field: `operations.${index}.persistence`,
    });
  }

  if (!Array.isArray(commandState.commands) || commandState.commands.length === 0) {
    diagnostics.push({
      index,
      source: "operation",
      severity: "error",
      code: "package.operation.command_state_missing",
      message: `Operation ${operation.id} did not compile deterministic command state.`,
      field: `operations.${index}.stateContract.commandState`,
    });
  }

  if (writesExternalState && !compactString(requestState.idempotencyKey || operation.idempotency?.key)) {
    diagnostics.push({
      index,
      source: "operation",
      severity: "error",
      code: "package.operation.request_idempotency_missing",
      message: `Operation ${operation.id} writes Mailchimp state without a runtime request idempotency key.`,
      field: `operations.${index}.stateContract.requestState.idempotencyKey`,
    });
  }

  if (writesExternalState && !compactString(clientState.statusPath || operation.statusPath)) {
    diagnostics.push({
      index,
      source: "operation",
      severity: "warning",
      code: "package.operation.client_status_path_missing",
      message: `Operation ${operation.id} should expose a client-visible status path before Mailchimp handoff.`,
      field: `operations.${index}.stateContract.clientState.statusPath`,
    });
  }

  return diagnostics;
}

function collectOperationalHealthDiagnostics(operation, index) {
  const adapter = operation.adapterRecovery || {};
  const health = operation.operationalHealth || {};
  if (adapter.failed) {
    return [{
      index,
      source: "adapter-health",
      severity: "error",
      code: health.retry?.exhausted
        ? "package.adapter.retry_exhausted"
        : "package.adapter.failed",
      message: `Operation ${operation.id} cannot hand off to Mailchimp adapter: ${adapter.failure?.message || adapter.status}.`,
      field: `operations.${index}.adapterRecovery`,
      action: adapter.recovery?.nextAction || "surface_adapter_failure_to_operator",
    }];
  }
  if (adapter.degradedMode) {
    return [{
      index,
      source: "adapter-health",
      severity: "warning",
      code: "package.adapter.degraded",
      message: `Operation ${operation.id} will hand off to Mailchimp adapter in degraded mode.`,
      field: `operations.${index}.operationalHealth`,
      action: adapter.recovery?.nextAction || "handoff_in_degraded_mode_with_status_poll",
    }];
  }
  return [];
}

function normalizeLifecycleControls(input = {}, operation = {}, writesExternalState = false) {
  const raw = input.lifecycle || input.controls || input;
  const mode = compactString(raw.mode || operation.lifecycle?.mode, writesExternalState ? "approval-required" : "observe");
  const enabled = raw.enabled !== false && operation.lifecycle?.enabled !== false;
  const allowDisable = raw.allowDisable !== false;
  const pauseOnDegraded = raw.pauseOnDegraded !== false;
  const requireOperatorAck = raw.requireOperatorAck === true || writesExternalState;
  const schedule = raw.schedule || operation.lifecycle?.schedule || {};
  const earliestAt = compactString(schedule.earliestAt || raw.earliestAt);
  const notAfter = compactString(schedule.notAfter || raw.notAfter);
  const intervalMs = Number.isFinite(Number(schedule.intervalMs ?? raw.intervalMs))
    ? Math.max(0, Number(schedule.intervalMs ?? raw.intervalMs))
    : 0;
  const cooldownMs = Number.isFinite(Number(schedule.cooldownMs ?? raw.cooldownMs))
    ? Math.max(0, Number(schedule.cooldownMs ?? raw.cooldownMs))
    : writesExternalState ? 1000 : 0;
  const validation = [];

  if (!["observe", "approval-required", "auto", "disabled"].includes(mode)) {
    validation.push({
      severity: "error",
      code: "package.lifecycle.mode_invalid",
      message: `Unsupported Mailchimp lifecycle mode "${mode}".`,
      field: "operations.lifecycle.mode",
    });
  }
  if (mode === "disabled" && !allowDisable) {
    validation.push({
      severity: "error",
      code: "package.lifecycle.disable_not_allowed",
      message: "Mailchimp lifecycle controls attempted to disable an operation that does not allow disabling.",
      field: "operations.lifecycle.allowDisable",
    });
  }
  if (earliestAt && notAfter && earliestAt > notAfter) {
    validation.push({
      severity: "error",
      code: "package.lifecycle.schedule_invalid",
      message: "Mailchimp lifecycle schedule has earliestAt after notAfter.",
      field: "operations.lifecycle.schedule",
    });
  }

  return {
    mode,
    enabled: enabled && mode !== "disabled",
    allowDisable,
    pauseOnDegraded,
    requireOperatorAck,
    schedule: { earliestAt, notAfter, intervalMs, cooldownMs },
    validation,
  };
}

function buildLifecycleVisibilityContract(operation, runtimeClientState, persistedState, tenantPermissionBoundary, operationalHealth, adapterRecovery, writesExternalState) {
  const controls = normalizeLifecycleControls(operation.lifecycle || operation.lifecycleControls || {}, operation, writesExternalState);
  const settingsBlocked = controls.validation.some((entry) => entry.severity === "error");
  const disabled = !controls.enabled;
  const healthBlocked = controls.pauseOnDegraded && (operationalHealth.degraded || operationalHealth.retry.exhausted);
  const boundaryBlocked = tenantPermissionBoundary.status !== "ready";
  const scheduleActive = Boolean(controls.schedule.earliestAt || controls.schedule.notAfter || controls.schedule.intervalMs || controls.schedule.cooldownMs);
  const status = settingsBlocked
    ? "settings-blocked"
    : disabled
      ? "disabled"
      : boundaryBlocked
        ? "boundary-blocked"
        : healthBlocked
          ? "health-paused"
          : adapterRecovery.failed
            ? "adapter-failed"
            : scheduleActive
              ? "scheduled"
              : writesExternalState && controls.requireOperatorAck
                ? "waiting-for-approval"
                : "ready";
  const nextAction = status === "settings-blocked"
    ? "repair_lifecycle_settings"
    : status === "disabled"
      ? "enable_mailchimp_lifecycle"
      : status === "boundary-blocked"
        ? tenantPermissionBoundary.statusHandoff.nextAction
        : status === "health-paused"
          ? "wait_for_runtime_health_or_disable_pause"
          : status === "adapter-failed"
            ? adapterRecovery.recovery.nextAction
            : status === "scheduled"
              ? "wait_for_lifecycle_schedule"
              : status === "waiting-for-approval"
                ? "request_operator_approval"
                : adapterRecovery.recovery.nextAction || "queue_adapter_handoff";

  return {
    format: "aios.mailchimp.package.lifecycleVisibility.v1",
    operationId: operation.id,
    status,
    enabled: controls.enabled,
    mode: controls.mode,
    metadataReady: Boolean(runtimeClientState.request.requestId && runtimeClientState.client.statusPath),
    operatorVisible: writesExternalState || controls.requireOperatorAck || status !== "ready",
    schedule: { ...controls.schedule, active: scheduleActive },
    validation: controls.validation,
    clientState: {
      requestId: runtimeClientState.request.requestId,
      statusPath: runtimeClientState.client.statusPath,
      progressPath: runtimeClientState.client.progressPath,
      boundaryStatusPath: tenantPermissionBoundary.handoffStatusPath,
      snapshotKey: persistedState.snapshotKey,
      ledgerKey: persistedState.ledgerKey,
      visibleStates: runtimeClientState.client.visibleStates,
    },
    controls: {
      canEnable: !controls.enabled && controls.allowDisable,
      canDisable: controls.enabled && controls.allowDisable,
      canSchedule: controls.enabled && !settingsBlocked,
      canDispatch: status === "ready" || status === "waiting-for-approval",
      canRetry: adapterRecovery.retryable === true,
    },
    nextAction,
  };
}

function buildClientRuntimeAdoptionEnvelope(operation, runtimeClientState, persistedState, tenantPermissionBoundary, operationalHealth, adapterRecovery, lifecycleVisibility, writesExternalState) {
  const request = runtimeClientState.request;
  const client = runtimeClientState.client;
  const boundary = tenantPermissionBoundary;
  const lifecycle = lifecycleVisibility;
  const metadataReady = Boolean(
    request.requestId
    && client.statusPath
    && persistedState.snapshotKey
    && persistedState.ledgerKey
    && (!writesExternalState || request.idempotencyKey),
  );
  const boundaryReady = boundary.status === "ready";
  const replayReady = persistedState.idempotentCommand?.safeToReplay === true;
  const healthReady = operationalHealth.status === "healthy"
    || (adapterRecovery.retryable === true && adapterRecovery.failed !== true);
  const lifecycleReady = ![
    "settings-blocked",
    "disabled",
    "health-paused",
    "adapter-failed",
    "boundary-blocked",
  ].includes(lifecycle.status);
  const providerStatusPath = compactString(
    operation.providerStatusPath || operation.statusContract?.providerStatusPath,
    `${client.statusPath}.provider.mailchimp`,
  );
  const adoptionKey = stableId("adopt", [
    operation.descriptorId,
    operation.id,
    request.requestId,
    client.statusKey,
    persistedState.snapshotKey,
    boundary.boundaryKey,
  ]);
  const blockedReason = !metadataReady
    ? "metadata-incomplete"
    : !boundaryReady
      ? "boundary-blocked"
      : !replayReady && writesExternalState
        ? "replay-not-safe"
        : !lifecycleReady
          ? `lifecycle-${lifecycle.status}`
          : adapterRecovery.failed
            ? "adapter-failed"
            : "";
  const status = blockedReason
    ? `blocked:${blockedReason}`
    : adapterRecovery.degradedMode
      ? "degraded-adoptable"
      : writesExternalState
        ? "approval-adoptable"
        : "adoptable";

  return {
    format: "aios.mailchimp.package.clientRuntimeAdoptionEnvelope.v1",
    adoptionKey,
    operationId: operation.id,
    descriptorId: operation.descriptorId,
    provider: "mailchimp",
    service: compactString(operation.adapter, "mailchimp"),
    status,
    acceptedForClient: !blockedReason && metadataReady && boundaryReady,
    blockedReason,
    externalWrite: writesExternalState,
    request: {
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey || null,
      idempotencyKeyRequired: writesExternalState,
      replayToken: request.replayToken,
      dedupeScope: request.dedupeScope,
      submittedAtPath: request.submittedAtPath,
    },
    client: {
      statusKey: client.statusKey,
      statusPath: client.statusPath,
      progressPath: client.progressPath,
      providerStatusPath,
      handoffLabel: client.handoffLabel,
      visibleStates: client.visibleStates,
      recoverable: client.recoverable,
    },
    persisted: {
      snapshotKey: persistedState.snapshotKey,
      ledgerKey: persistedState.ledgerKey,
      checkpointKey: persistedState.checkpointKey,
      restartStatus: persistedState.restartStatus,
      recoveryPath: persistedState.recoveryPath,
      replayPolicy: persistedState.replayPolicy,
      safeToReplay: persistedState.idempotentCommand?.safeToReplay === true,
      duplicatePolicy: persistedState.idempotentCommand?.duplicatePolicy || "unknown",
    },
    boundary: {
      boundaryKey: boundary.boundaryKey,
      tenant: boundary.scope.tenant,
      workspace: boundary.scope.workspace,
      environment: boundary.scope.environment,
      allowedRoles: boundary.allowedRoles,
      deniedRoles: boundary.deniedRoles,
      status: boundary.status,
      auditChannel: boundary.auditChannel,
      boundaryStatusPath: boundary.handoffStatusPath,
      requiresLease: boundary.requiresLease,
      requiresAuditCorrelation: boundary.requiresAuditCorrelation,
    },
    health: {
      status: operationalHealth.status,
      degraded: operationalHealth.degraded,
      retryable: adapterRecovery.retryable === true,
      failed: adapterRecovery.failed === true,
      nextDelayMs: adapterRecovery.backoff?.nextDelayMs || 0,
      providerStatus: operationalHealth.failure?.providerStatus || null,
    },
    workflow: {
      lifecycleStatus: lifecycle.status,
      lifecycleNextAction: lifecycle.nextAction,
      operatorVisible: lifecycle.operatorVisible === true || writesExternalState || Boolean(blockedReason),
      handoffAllowed: !blockedReason && adapterRecovery.failed !== true,
      nextAction: blockedReason === "metadata-incomplete"
        ? "repair_client_runtime_adoption_metadata"
        : blockedReason === "boundary-blocked"
          ? boundary.statusHandoff?.nextAction || "repair_tenant_permission_boundary"
          : blockedReason === "replay-not-safe"
            ? "route_client_handoff_to_operator_review"
            : blockedReason && blockedReason.startsWith("lifecycle-")
              ? lifecycle.nextAction || "repair_lifecycle_visibility"
              : adapterRecovery.degradedMode
                ? "adopt_with_provider_status_poll"
                : writesExternalState
                  ? "continue_to_truth_ownership_approval_adoption"
                  : "adopt_read_runtime_handoff",
    },
    evidenceShape: {
      adoptionKey: "string",
      requestId: "string",
      tenant: boundary.scope.tenant,
      workspace: boundary.scope.workspace,
      actorRole: boundary.allowedRoles.join("|") || "unconfigured",
      auditCorrelationId: boundary.requiresAuditCorrelation ? "required-string" : "optional-string",
      clientStatusPath: client.statusPath,
      providerStatusPath,
    },
  };
}

function buildRuntimeClientState(descriptor, operation, commandState, writesExternalState) {
  const requestState = operation.stateContract?.requestState || operation.requestState || {};
  const clientState = operation.stateContract?.clientState || operation.clientState || {};
  const statusKey = stableId("status", [descriptor.id, operation.id, operation.adapter]);
  const requestId = compactString(requestState.requestId || operation.requestId, stableId("request", [
    descriptor.id,
    operation.id,
    commandState.checkpointKey,
  ]));
  const idempotencyKey = compactString(
    requestState.idempotencyKey || operation.idempotency?.key,
    writesExternalState ? stableId("idem", [descriptor.id, operation.id, operation.operation]) : "",
  );
  const statusPath = compactString(
    clientState.statusPath || operation.statusPath,
    `mailchimp.operations.${operation.id}.status`,
  );
  const progressPath = compactString(
    clientState.progressPath || operation.progressPath,
    `mailchimp.operations.${operation.id}.progress`,
  );
  const handoffPayload = {
    requestId,
    operationId: operation.id,
    adapter: operation.adapter,
    operation: operation.operation,
    idempotencyKey: idempotencyKey || null,
    statusKey,
    statusPath,
    progressPath,
  };

  return {
    request: {
      requestId,
      idempotencyKey: idempotencyKey || null,
      dedupeScope: compactString(requestState.dedupeScope, writesExternalState ? "tenant-operation" : "request"),
      replayToken: compactString(requestState.replayToken, stableId("replay", [descriptor.id, operation.id, requestId])),
      submittedAtPath: compactString(requestState.submittedAtPath, `${statusPath}.submittedAt`),
    },
    client: {
      statusKey,
      statusPath,
      progressPath,
      visibleStates: [
        "planned",
        "waiting_for_evidence",
        "waiting_for_approval",
        "queued",
        "running",
        "completed",
        "failed",
      ],
      handoffLabel: compactString(clientState.handoffLabel || operation.displayName, `${operation.adapter}.${operation.operation}`),
      recoverable: operation.persistence?.replayPolicy !== "manual-review",
    },
    handoffPayload,
  };
}

function buildPersistedRuntimeState(descriptor, operation, commandState, runtimeClientState, writesExternalState, tenantPermissionBoundary) {
  const request = runtimeClientState.request;
  const client = runtimeClientState.client;
  const handoffPayload = runtimeClientState.handoffPayload;
  const checkpointKey = commandState.checkpointKey;
  const commandTypes = Array.isArray(commandState.commands)
    ? commandState.commands.map((command) => compactString(command.type, "unknown")).filter(Boolean)
    : [];
  const ledgerKey = stableId("ledger", [
    descriptor.id,
    operation.id,
    request.requestId,
    request.idempotencyKey || "read",
  ]);
  const snapshotKey = stableId("snapshot", [
    descriptor.id,
    operation.id,
    checkpointKey,
    client.statusKey,
  ]);
  const restartUnsafe = operation.stateContract?.restartSafe === false
    || commandState.restartSafe === false
    || operation.persistence?.restartSafe === false;
  const manualReview = operation.persistence?.replayPolicy === "manual-review"
    || operation.stateContract?.replayPolicy === "manual-review";
  const hasIdempotentWrite = !writesExternalState || Boolean(request.idempotencyKey);
  const canResume = !restartUnsafe && hasIdempotentWrite && !manualReview;
  const replayPolicy = operation.stateContract?.replayPolicy
    || operation.persistence?.replayPolicy
    || (writesExternalState ? "skip-completed" : "observe");
  const statusDocument = {
    key: client.statusKey,
    path: client.statusPath,
    progressPath: client.progressPath,
    requestId: request.requestId,
    operationId: operation.id,
    states: client.visibleStates,
    terminalStates: ["completed", "failed"],
    recoverableStates: canResume
      ? ["planned", "checkpointed", "admitted", "queued", "running"]
      : ["planned", "checkpointed"],
  };
  const commandEnvelope = {
    ledgerKey,
    checkpointKey,
    snapshotKey,
    operationId: operation.id,
    adapter: operation.adapter,
    operation: operation.operation,
    commandTypes: [...new Set(commandTypes)].sort(),
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey || null,
    dedupeScope: request.dedupeScope,
    replayToken: request.replayToken,
    handoffPayload,
    tenantBoundary: {
      boundaryKey: tenantPermissionBoundary.boundaryKey,
      tenant: tenantPermissionBoundary.scope.tenant,
      workspace: tenantPermissionBoundary.scope.workspace,
      allowedRoles: tenantPermissionBoundary.allowedRoles,
      requiresAuditCorrelation: tenantPermissionBoundary.requiresAuditCorrelation,
    },
  };

  return {
    snapshotKey,
    ledgerKey,
    checkpointKey,
    restartSafe: canResume,
    replayPolicy,
    writeMode: writesExternalState ? "external-idempotent-command" : "local-observation",
    recoveryPath: canResume
      ? "resume_from_checkpoint"
      : manualReview
        ? "manual_review_required"
        : restartUnsafe
          ? "restart_blocked"
          : "repair_idempotency_before_replay",
    restartStatus: canResume
      ? "resume-ready"
      : manualReview
        ? "operator-review-required"
        : "recovery-blocked",
    statusDocument,
    commandEnvelope,
    idempotentCommand: {
      key: request.idempotencyKey || ledgerKey,
      scope: request.dedupeScope,
      replayToken: request.replayToken,
      safeToReplay: canResume,
      duplicatePolicy: writesExternalState ? "reuse_provider_idempotency_key" : "ignore_duplicate_observation",
    },
    recoveryDecision: {
      nextAction: canResume
        ? "load_snapshot_and_resume_adapter_handoff"
        : manualReview
          ? "route_snapshot_to_operator_review"
          : "repair_persisted_state_contract",
      requiresOperator: !canResume,
      requiresProviderStatusFetch: writesExternalState,
      clientStatusPath: client.statusPath,
      boundaryStatusPath: tenantPermissionBoundary.handoffStatusPath,
    },
  };
}

function buildOperationRuntimeContract(descriptor, operation, index, runtimeHealthInput = {}) {
  const capabilityNames = [...new Set(operation.capabilityNames || [])].sort();
  const verifierNames = [...new Set(operation.verifierNames || [])].sort();
  const writesExternalState = operation.truthBoundary?.externalState === true
    || capabilityNames.some((name) => EXTERNAL_WRITE_CAPABILITIES.has(name));
  const commandState = operation.stateContract?.commandState || {};
  const checkpointKey = operation.stateContract?.checkpointKey || stableId("checkpoint", [descriptor.id, operation.id]);
  const admissionCommand = (commandState.commands || []).find((command) => command.type === "adapter-handoff");
  const runtimeClientState = buildRuntimeClientState(descriptor, operation, {
    ...commandState,
    checkpointKey,
  }, writesExternalState);
  const tenantPermissionBoundary = buildTenantPermissionBoundary(descriptor, operation, writesExternalState);
  const persistedState = buildPersistedRuntimeState(descriptor, operation, {
    ...commandState,
    checkpointKey,
  }, runtimeClientState, writesExternalState, tenantPermissionBoundary);
  const operationalHealth = normalizeRuntimeHealthForOperation(runtimeHealthInput, operation, writesExternalState);
  const adapterRecovery = buildAdapterRecoveryContract(
    operation,
    runtimeClientState,
    persistedState,
    tenantPermissionBoundary,
    operationalHealth,
    writesExternalState,
  );
  const lifecycleVisibility = buildLifecycleVisibilityContract(
    operation,
    runtimeClientState,
    persistedState,
    tenantPermissionBoundary,
    operationalHealth,
    adapterRecovery,
    writesExternalState,
  );
  const clientRuntimeAdoption = buildClientRuntimeAdoptionEnvelope(
    operation,
    runtimeClientState,
    persistedState,
    tenantPermissionBoundary,
    operationalHealth,
    adapterRecovery,
    lifecycleVisibility,
    writesExternalState,
  );

  return {
    id: operation.id,
    descriptorId: operation.descriptorId || stableId("op", [descriptor.id, operation.id, index]),
    adapter: operation.adapter,
    operation: operation.operation,
    capabilityNames,
    verifierNames,
    externalWrite: writesExternalState,
    checkpointKey,
    runtimeClientState,
    persistedState,
    tenantPermissionBoundary,
    operationalHealth,
    adapterRecovery,
    lifecycleVisibility,
    clientRuntimeAdoption,
    restartSafe: operation.stateContract?.restartSafe !== false && commandState.restartSafe !== false,
    replayPolicy: operation.stateContract?.replayPolicy || operation.persistence?.replayPolicy || "skip-completed",
    statusHandoff: {
      initial: "planned",
      checkpointed: "checkpointed",
      admitted: "admitted",
      blocked: writesExternalState && verifierNames.length === 0 ? "blocked" : "ready",
      completed: "completed",
      rollback: "rolled-back",
      clientStatusPath: runtimeClientState.client.statusPath,
      requestId: runtimeClientState.request.requestId,
      nextAction: writesExternalState && verifierNames.length === 0
        ? "attach_verifier_before_handoff"
        : tenantPermissionBoundary.status !== "ready"
          ? tenantPermissionBoundary.statusHandoff.nextAction
        : admissionCommand
          ? "queue_adapter_handoff"
          : "repair_command_state",
    },
    recoveryHandoff: {
      command: operation.persistence?.replayPolicy === "manual-review"
        ? "hold_for_operator"
        : writesExternalState
          ? "retry_same_idempotency_key"
          : "observe",
      requestId: runtimeClientState.request.requestId,
      idempotencyKey: runtimeClientState.request.idempotencyKey || admissionCommand?.idempotencyKey || null,
      replayToken: runtimeClientState.request.replayToken,
      clientStatusPath: runtimeClientState.client.statusPath,
      rollbackCommand: operation.rollback || "no-op",
      requiresVerifierEvidence: verifierNames.length > 0 || operation.truthBoundary?.evidenceRequired === true,
      persistedStateKey: persistedState.snapshotKey,
      recoveryPath: persistedState.recoveryPath,
      safeToReplay: persistedState.idempotentCommand.safeToReplay,
      boundaryKey: tenantPermissionBoundary.boundaryKey,
      boundaryStatusPath: tenantPermissionBoundary.handoffStatusPath,
      requiredTenant: tenantPermissionBoundary.scope.tenant,
      requiredWorkspace: tenantPermissionBoundary.scope.workspace,
      allowedRoles: tenantPermissionBoundary.allowedRoles,
      lifecycleStatus: lifecycleVisibility.status,
      lifecycleNextAction: lifecycleVisibility.nextAction,
      adoptionKey: clientRuntimeAdoption.adoptionKey,
      providerStatusPath: clientRuntimeAdoption.client.providerStatusPath,
      clientAdoptionStatus: clientRuntimeAdoption.status,
    },
  };
}

function summarizePackage(descriptor, operations, diagnostics) {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const externalWrites = operations.filter((operation) => operation.externalWrite);
  const restartUnsafe = operations.filter((operation) => operation.restartSafe === false);
  const clientVisible = operations.filter((operation) => operation.runtimeClientState?.client?.statusPath);
  const resumeReady = operations.filter((operation) => operation.persistedState?.restartStatus === "resume-ready");
  const operatorReview = operations.filter((operation) => operation.persistedState?.restartStatus === "operator-review-required");
  const boundaryInvalid = operations.filter((operation) => operation.tenantPermissionBoundary?.status !== "ready");
  const adapterFailed = operations.filter((operation) => operation.adapterRecovery?.failed);
  const adapterDegraded = operations.filter((operation) => operation.adapterRecovery?.degradedMode);
  const adapterRetryable = operations.filter((operation) => operation.adapterRecovery?.retryable);
  const lifecycleBlocked = operations.filter((operation) => (
    operation.lifecycleVisibility?.status === "settings-blocked"
    || operation.lifecycleVisibility?.status === "disabled"
    || operation.lifecycleVisibility?.status === "health-paused"
  ));

  return {
    packageId: descriptor.id,
    name: descriptor.name,
    version: descriptor.version,
    operationCount: operations.length,
    externalWriteOperationCount: externalWrites.length,
    restartUnsafeOperationCount: restartUnsafe.length,
    clientVisibleOperationCount: clientVisible.length,
    resumeReadyOperationCount: resumeReady.length,
    operatorReviewRecoveryCount: operatorReview.length,
    boundaryInvalidOperationCount: boundaryInvalid.length,
    adapterFailedOperationCount: adapterFailed.length,
    adapterDegradedOperationCount: adapterDegraded.length,
    adapterRetryableOperationCount: adapterRetryable.length,
    lifecycleBlockedOperationCount: lifecycleBlocked.length,
    valid: errors.length === 0 && boundaryInvalid.length === 0 && adapterFailed.length === 0,
    status: errors.length || boundaryInvalid.length || adapterFailed.length
      ? "blocked"
      : adapterDegraded.length
        ? "degraded"
        : warnings.length
          ? "needs-review"
          : "ready",
    nextAction: adapterFailed.length
      ? adapterFailed[0].adapterRecovery.recovery.nextAction
      : adapterRetryable.length
        ? "schedule_adapter_recovery_retry"
      : errors.length
      ? "repair_package_contract"
      : boundaryInvalid.length
        ? "repair_tenant_permission_boundary"
      : warnings.length
        ? "review_package_warnings"
        : externalWrites.length
          ? "evaluate_truth_and_approval_gates"
          : "handoff_to_runtime_adapter",
    diagnostics: {
      errors: errors.length,
      warnings: warnings.length,
      blockingCodes: errors.map((diagnostic) => diagnostic.code).sort(),
    },
    tenantPermissionBoundaries: operations.map((operation) => ({
      operationId: operation.id,
      boundaryKey: operation.tenantPermissionBoundary.boundaryKey,
      tenant: operation.tenantPermissionBoundary.scope.tenant,
      workspace: operation.tenantPermissionBoundary.scope.workspace,
      environment: operation.tenantPermissionBoundary.scope.environment,
      allowedRoles: operation.tenantPermissionBoundary.allowedRoles,
      requiresLease: operation.tenantPermissionBoundary.requiresLease,
      requiresAuditCorrelation: operation.tenantPermissionBoundary.requiresAuditCorrelation,
      status: operation.tenantPermissionBoundary.status,
      nextAction: operation.tenantPermissionBoundary.statusHandoff.nextAction,
    })),
    runtimeHandoff: {
      requestCount: operations.filter((operation) => operation.runtimeClientState?.request?.requestId).length,
      statusPaths: clientVisible.map((operation) => operation.runtimeClientState.client.statusPath).sort(),
      pendingClientStates: [...new Set(operations.flatMap((operation) => (
        operation.runtimeClientState?.client?.visibleStates || []
      )))].sort(),
      persistedSnapshots: operations.map((operation) => ({
        operationId: operation.id,
        snapshotKey: operation.persistedState?.snapshotKey || null,
        ledgerKey: operation.persistedState?.ledgerKey || null,
        restartStatus: operation.persistedState?.restartStatus || "unknown",
        recoveryPath: operation.persistedState?.recoveryPath || "unknown",
      })),
      adapterRecovery: operations.map((operation) => ({
        operationId: operation.id,
        status: operation.adapterRecovery?.status || "unknown",
        retryable: operation.adapterRecovery?.retryable === true,
        degradedMode: operation.adapterRecovery?.degradedMode === true,
        nextAction: operation.adapterRecovery?.recovery?.nextAction || "unknown",
        nextDelayMs: operation.adapterRecovery?.backoff?.nextDelayMs || 0,
        clientStatusPath: operation.adapterRecovery?.clientStatus?.statusPath || null,
      })),
      lifecycleVisibility: operations.map((operation) => ({
        operationId: operation.id,
        status: operation.lifecycleVisibility?.status || "unknown",
        mode: operation.lifecycleVisibility?.mode || "unknown",
        enabled: operation.lifecycleVisibility?.enabled === true,
        operatorVisible: operation.lifecycleVisibility?.operatorVisible === true,
        requestId: operation.lifecycleVisibility?.clientState?.requestId || null,
        clientStatusPath: operation.lifecycleVisibility?.clientState?.statusPath || null,
        nextAction: operation.lifecycleVisibility?.nextAction || "unknown",
      })),
      clientRuntimeAdoption: operations.map((operation) => ({
        operationId: operation.id,
        adoptionKey: operation.clientRuntimeAdoption?.adoptionKey || null,
        status: operation.clientRuntimeAdoption?.status || "unknown",
        acceptedForClient: operation.clientRuntimeAdoption?.acceptedForClient === true,
        blockedReason: operation.clientRuntimeAdoption?.blockedReason || "",
        requestId: operation.clientRuntimeAdoption?.request?.requestId || null,
        clientStatusPath: operation.clientRuntimeAdoption?.client?.statusPath || null,
        providerStatusPath: operation.clientRuntimeAdoption?.client?.providerStatusPath || null,
        boundaryKey: operation.clientRuntimeAdoption?.boundary?.boundaryKey || null,
        tenant: operation.clientRuntimeAdoption?.boundary?.tenant || null,
        workspace: operation.clientRuntimeAdoption?.boundary?.workspace || null,
        operatorVisible: operation.clientRuntimeAdoption?.workflow?.operatorVisible === true,
        handoffAllowed: operation.clientRuntimeAdoption?.workflow?.handoffAllowed === true,
        nextAction: operation.clientRuntimeAdoption?.workflow?.nextAction || "unknown",
      })),
    },
  };
}

function buildPackageAnalyticsState(descriptor, operations, diagnostics, summary) {
  const diagnosticsBySeverity = diagnostics.reduce((accumulator, diagnostic) => {
    const severity = compactString(diagnostic.severity, "warning");
    accumulator[severity] = (accumulator[severity] || 0) + 1;
    return accumulator;
  }, {});
  const operationsByStatus = operations.reduce((accumulator, operation) => {
    const status = operation.adapterRecovery?.status || operation.statusHandoff?.blocked || "unknown";
    accumulator[status] = (accumulator[status] || 0) + 1;
    return accumulator;
  }, {});
  const operationsByRecoveryPath = operations.reduce((accumulator, operation) => {
    const path = operation.persistedState?.recoveryPath || "unknown";
    accumulator[path] = (accumulator[path] || 0) + 1;
    return accumulator;
  }, {});
  const externalWrites = operations.filter((operation) => operation.externalWrite);
  const statusVisible = operations.filter((operation) => operation.runtimeClientState?.client?.statusPath);
  const retryable = operations.filter((operation) => operation.adapterRecovery?.retryable);
  const lifecycleBlocked = operations.filter((operation) => (
    operation.lifecycleVisibility?.status === "settings-blocked"
    || operation.lifecycleVisibility?.status === "disabled"
    || operation.lifecycleVisibility?.status === "health-paused"
  ));
  const blocked = operations.filter((operation) => (
    operation.tenantPermissionBoundary?.status !== "ready"
    || operation.adapterRecovery?.failed
    || operation.statusHandoff?.blocked === "blocked"
  ));
  const exportable = operations.filter((operation) => (
    operation.runtimeClientState?.request?.requestId
    && operation.runtimeClientState?.client?.statusPath
    && operation.persistedState?.snapshotKey
  ));

  return {
    format: "aios.mailchimp.package.analytics.v1",
    packageId: descriptor.id,
    provider: "mailchimp",
    status: summary.status,
    counters: {
      operationCount: operations.length,
      externalWriteOperationCount: externalWrites.length,
      readOnlyOperationCount: operations.length - externalWrites.length,
      statusVisibleOperationCount: statusVisible.length,
      exportableOperationCount: exportable.length,
      blockedOperationCount: blocked.length,
      retryableAdapterOperationCount: retryable.length,
      lifecycleBlockedOperationCount: lifecycleBlocked.length,
      degradedAdapterOperationCount: operations.filter((operation) => operation.adapterRecovery?.degradedMode).length,
      failedAdapterOperationCount: operations.filter((operation) => operation.adapterRecovery?.failed).length,
      resumeReadyOperationCount: operations.filter((operation) => operation.persistedState?.restartStatus === "resume-ready").length,
      operatorReviewOperationCount: operations.filter((operation) => operation.persistedState?.restartStatus === "operator-review-required").length,
      diagnostics: diagnostics.length,
      diagnosticErrors: diagnosticsBySeverity.error || 0,
      diagnosticWarnings: diagnosticsBySeverity.warning || 0,
    },
    byStatus: operationsByStatus,
    byRecoveryPath: operationsByRecoveryPath,
    diagnosticCodes: [...new Set(diagnostics.map((diagnostic) => compactString(diagnostic.code)).filter(Boolean))].sort(),
    blockedOperationIds: blocked.map((operation) => operation.id).sort(),
    retryableOperationIds: retryable.map((operation) => operation.id).sort(),
    lifecycleBlockedOperationIds: lifecycleBlocked.map((operation) => operation.id).sort(),
    exportableOperationIds: exportable.map((operation) => operation.id).sort(),
    clientStatusPaths: statusVisible
      .map((operation) => operation.runtimeClientState.client.statusPath)
      .sort(),
  };
}

function buildPackageHistorySnapshots(descriptor, operations, diagnostics, analytics) {
  return operations.map((operation, index) => {
    const operationDiagnostics = diagnostics.filter((diagnostic) => (
      diagnostic.index === index
      || diagnostic.operationId === operation.id
      || compactString(diagnostic.field).includes(`operations.${index}`)
      || compactString(diagnostic.field).includes(`operations.${operation.id}`)
    ));
    const adapter = operation.adapterRecovery || {};
    const persisted = operation.persistedState || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const status = adapter.failed
      ? "adapter-failed"
      : boundary.status !== "ready"
        ? "boundary-blocked"
        : adapter.degradedMode
          ? "adapter-degraded"
          : persisted.restartStatus === "operator-review-required"
            ? "operator-review-required"
            : "ready";

    return {
      index,
      snapshotId: stableId("history", [
        descriptor.id,
        operation.id,
        persisted.snapshotKey,
        adapter.status,
        operationDiagnostics.length,
      ]),
      operationId: operation.id,
      requestId: operation.runtimeClientState?.request?.requestId || null,
      status,
      statusPath: operation.runtimeClientState?.client?.statusPath || null,
      progressPath: operation.runtimeClientState?.client?.progressPath || null,
      boundaryKey: boundary.boundaryKey || null,
      recoveryPath: persisted.recoveryPath || "unknown",
      restartStatus: persisted.restartStatus || "unknown",
      adapterStatus: adapter.status || "unknown",
      retryable: adapter.retryable === true,
      degradedMode: adapter.degradedMode === true,
      diagnosticCount: operationDiagnostics.length,
      firstDiagnosticCode: operationDiagnostics[0]?.code || "",
      exportReady: analytics.exportableOperationIds.includes(operation.id),
      nextAction: adapter.recovery?.nextAction
        || boundary.statusHandoff?.nextAction
        || operation.lifecycleVisibility?.nextAction
        || operation.statusHandoff?.nextAction
        || "handoff_to_runtime_adapter",
    };
  });
}

function buildPackageTimelineReport(descriptor, historySnapshots, analytics, summary) {
  const rows = historySnapshots.map((snapshot) => ({
    operationId: snapshot.operationId,
    status: snapshot.status,
    requestId: snapshot.requestId,
    statusPath: snapshot.statusPath,
    boundaryKey: snapshot.boundaryKey,
    recoveryPath: snapshot.recoveryPath,
    retryable: snapshot.retryable,
    degradedMode: snapshot.degradedMode,
    diagnosticCount: snapshot.diagnosticCount,
    nextAction: snapshot.nextAction,
  }));
  const firstBlocked = rows.find((row) => (
    row.status === "adapter-failed"
    || row.status === "boundary-blocked"
    || row.status === "operator-review-required"
  ));

  return {
    format: "aios.mailchimp.package.timeline.v1",
    packageId: descriptor.id,
    provider: "mailchimp",
    status: firstBlocked
      ? "blocked"
      : analytics.counters.degradedAdapterOperationCount
        ? "degraded"
        : "ready",
    nextAction: firstBlocked?.nextAction || summary.nextAction,
    rows,
    state: {
      totalRows: rows.length,
      blockedRows: rows.filter((row) => row.status === "adapter-failed" || row.status === "boundary-blocked").length,
      degradedRows: rows.filter((row) => row.degradedMode).length,
      retryableRows: rows.filter((row) => row.retryable).length,
      exportReadyRows: historySnapshots.filter((snapshot) => snapshot.exportReady).length,
    },
  };
}

function buildPackageProviderServiceNegotiation(descriptor, operations, analytics, timelineReport) {
  const rows = operations.map((operation) => {
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const persisted = operation.persistedState || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const adapter = operation.adapterRecovery || {};
    const lifecycle = operation.lifecycleVisibility || {};
    const externalCapabilities = (operation.capabilityNames || [])
      .filter((name) => EXTERNAL_WRITE_CAPABILITIES.has(name) || name.endsWith(".write"))
      .sort();
    const delegatedCapabilities = (operation.capabilityNames || [])
      .filter((name) => !externalCapabilities.includes(name))
      .sort();
    const metadataMissing = !request.requestId
      || !client.statusPath
      || !persisted.snapshotKey
      || (operation.externalWrite && !request.idempotencyKey);
    const lifecycleBlocked = [
      "settings-blocked",
      "disabled",
      "health-paused",
      "adapter-failed",
    ].includes(lifecycle.status);
    const blockedReason = metadataMissing
      ? "metadata-incomplete"
      : boundary.status !== "ready"
        ? "boundary-blocked"
        : lifecycleBlocked
          ? `lifecycle-${lifecycle.status}`
          : adapter.failed
            ? "adapter-failed"
            : "";
    const status = blockedReason
      || (adapter.degradedMode
        ? "provider-degraded"
        : adapter.retryable
          ? "retry-scheduled"
          : operation.externalWrite
            ? "external-write-ready"
            : "read-delegation-ready");
    const negotiable = !blockedReason && !adapter.failed && adapter.degradedMode !== true;
    const providerStatusPath = compactString(
      operation.providerStatusPath || operation.statusContract?.providerStatusPath,
      `${client.statusPath || `mailchimp.operations.${operation.id}.status`}.provider.mailchimp`,
    );

    return {
      operationId: operation.id,
      descriptorId: operation.descriptorId,
      provider: "mailchimp",
      service: compactString(operation.adapter, "mailchimp"),
      status,
      negotiable,
      externalWrite: operation.externalWrite,
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      replayToken: request.replayToken || null,
      dedupeScope: request.dedupeScope || null,
      clientStatusPath: client.statusPath || null,
      providerStatusPath,
      progressPath: client.progressPath || null,
      snapshotKey: persisted.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || null,
      checkpointKey: persisted.checkpointKey || operation.checkpointKey || null,
      boundaryKey: boundary.boundaryKey || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      tenant: boundary.scope?.tenant || null,
      workspace: boundary.scope?.workspace || null,
      allowedRoles: boundary.allowedRoles || [],
      auditChannel: boundary.auditChannel || null,
      requiresAuditCorrelation: boundary.requiresAuditCorrelation === true,
      externalCapabilities,
      delegatedCapabilities,
      lifecycleStatus: lifecycle.status || "unknown",
      adapterStatus: adapter.status || "unknown",
      retryable: adapter.retryable === true,
      degradedMode: adapter.degradedMode === true,
      backoff: {
        attempt: adapter.backoff?.attempt || 0,
        maxAttempts: adapter.backoff?.maxAttempts || 0,
        nextDelayMs: adapter.backoff?.nextDelayMs || 0,
        reason: adapter.backoff?.reason || status,
      },
      handoffState: {
        state: negotiable
          ? operation.externalWrite
            ? "ready_for_external_write_lease"
            : "ready_for_read_delegation"
          : status,
        providerStatusPath,
        clientStatusPath: client.statusPath || null,
        nextAction: metadataMissing
          ? "repair_provider_sync_metadata"
          : boundary.status !== "ready"
            ? boundary.statusHandoff?.nextAction || "repair_tenant_permission_boundary"
            : lifecycleBlocked
              ? lifecycle.nextAction || "repair_lifecycle_visibility"
              : adapter.failed
                ? adapter.recovery?.nextAction || "surface_adapter_failure_to_operator"
                : adapter.retryable
                  ? "schedule_provider_status_poll"
                  : operation.externalWrite
                    ? "negotiate_mailchimp_external_write_contract"
                    : "delegate_mailchimp_read_contract",
      },
    };
  });
  const blockedRows = rows.filter((row) => !row.negotiable);
  const externalRows = rows.filter((row) => row.externalWrite);
  const leaseReadyRows = rows.filter((row) => row.status === "external-write-ready");
  const delegatedReadyRows = rows.filter((row) => row.status === "read-delegation-ready");
  const retryRows = rows.filter((row) => row.status === "retry-scheduled" || row.retryable);
  const degradedRows = rows.filter((row) => row.degradedMode);
  const syncKey = stableId("provider", [
    descriptor.id,
    rows.length,
    blockedRows.length,
    leaseReadyRows.length,
    timelineReport.status,
  ]);

  return {
    format: "aios.mailchimp.package.providerServiceNegotiation.v1",
    provider: "mailchimp",
    service: compactString(descriptor.runtimeAdapter, "mailchimp"),
    packageId: descriptor.id,
    syncKey,
    status: blockedRows.length
      ? "blocked"
      : degradedRows.length
        ? "degraded"
        : retryRows.length
          ? "retry-scheduled"
          : leaseReadyRows.length
            ? "external-write-negotiable"
            : "read-delegation-negotiable",
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      externalWrite: externalRows.length,
      leaseReady: leaseReadyRows.length,
      delegatedReady: delegatedReadyRows.length,
      retryable: retryRows.length,
      degraded: degradedRows.length,
      metadataIncomplete: rows.filter((row) => row.status === "metadata-incomplete").length,
      exportable: analytics.counters.exportableOperationCount,
    },
    externalHandoff: {
      allowed: blockedRows.length === 0 && degradedRows.length === 0,
      state: blockedRows.length
        ? "waiting_for_provider_contract_repair"
        : degradedRows.length
          ? "waiting_for_provider_health"
          : leaseReadyRows.length
            ? "ready_for_external_write_negotiation"
            : "ready_for_read_delegation",
      nextAction: blockedRows[0]?.handoffState?.nextAction
        || (degradedRows.length
          ? "poll_mailchimp_provider_status"
          : leaseReadyRows.length
            ? "negotiate_mailchimp_external_write_contracts"
            : "delegate_mailchimp_read_contracts"),
      operationIds: rows.filter((row) => row.negotiable).map((row) => row.operationId).sort(),
      blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
      providerStatusPaths: rows.map((row) => row.providerStatusPath).filter(Boolean).sort(),
      payloadShape: {
        syncKey: "string",
        operationId: "string",
        provider: "mailchimp",
        service: "string",
        requestId: "string",
        idempotencyKey: "string|null",
        clientStatusPath: "string",
        providerStatusPath: "string",
        boundaryKey: "string",
        snapshotKey: "string",
      },
    },
  };
}

function buildPackageAcceptancePreview(descriptor, operations, diagnostics, analytics, timelineReport, providerNegotiation) {
  const diagnosticsByOperation = new Map();
  for (const diagnostic of diagnostics) {
    const indexedOperation = Number.isFinite(Number(diagnostic.index))
      ? operations[Number(diagnostic.index)]
      : null;
    const fieldOperationToken = compactString(String(diagnostic.field || "").match(/operations\.([^.\]]+)/)?.[1]);
    const fieldOperation = Number.isFinite(Number(fieldOperationToken))
      ? operations[Number(fieldOperationToken)]
      : null;
    const key = compactString(diagnostic.operationId)
      || compactString(indexedOperation?.id)
      || compactString(fieldOperation?.id)
      || fieldOperationToken
      || "*";
    const existing = diagnosticsByOperation.get(key) || [];
    existing.push(diagnostic);
    diagnosticsByOperation.set(key, existing);
  }
  const providerByOperation = new Map((providerNegotiation.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation) => {
    const providerRow = providerByOperation.get(operation.id) || {};
    const scopedDiagnostics = [
      ...(diagnosticsByOperation.get(operation.id) || []),
      ...(diagnosticsByOperation.get(operation.descriptorId) || []),
    ];
    const errors = scopedDiagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const warnings = scopedDiagnostics.filter((diagnostic) => diagnostic.severity === "warning");
    const lifecycle = operation.lifecycleVisibility || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const adapter = operation.adapterRecovery || {};
    const persisted = operation.persistedState || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const metadataReady = Boolean(
      request.requestId
      && client.statusPath
      && persisted.snapshotKey
      && (!operation.externalWrite || request.idempotencyKey),
    );
    const validationStatus = errors.length
      ? "invalid"
      : warnings.length
        ? "needs-review"
        : "valid";
    const readiness = !metadataReady
      ? "metadata-incomplete"
      : boundary.status !== "ready"
        ? "boundary-blocked"
        : lifecycle.status === "settings-blocked" || lifecycle.status === "disabled"
          ? `lifecycle-${lifecycle.status}`
          : adapter.failed
            ? "adapter-failed"
            : adapter.degradedMode
              ? "adapter-degraded"
              : errors.length
                ? "validation-blocked"
                : warnings.length
                  ? "operator-review"
                  : operation.externalWrite
                    ? "awaiting-truth-approval"
                    : "accepted";
    const acceptedForPreview = readiness === "accepted"
      || readiness === "awaiting-truth-approval"
      || readiness === "operator-review";
    const routeVisible = operation.externalWrite
      || lifecycle.operatorVisible === true
      || readiness !== "accepted";

    return {
      operationId: operation.id,
      previewId: stableId("preview", [
        descriptor.id,
        operation.id,
        persisted.snapshotKey,
        providerRow.status,
        validationStatus,
      ]),
      title: client.handoffLabel || `${operation.adapter}.${operation.operation}`,
      accepted: acceptedForPreview,
      readiness,
      validationStatus,
      routeVisible,
      externalWrite: operation.externalWrite,
      request: {
        requestId: request.requestId || null,
        idempotencyKeyPresent: Boolean(request.idempotencyKey),
        replayToken: request.replayToken || null,
        dedupeScope: request.dedupeScope || null,
      },
      clientHandoff: {
        statusPath: client.statusPath || null,
        progressPath: client.progressPath || null,
        boundaryStatusPath: boundary.handoffStatusPath || null,
        providerStatusPath: providerRow.providerStatusPath || null,
        visibleStates: client.visibleStates || [],
      },
      persistedState: {
        snapshotKey: persisted.snapshotKey || null,
        ledgerKey: persisted.ledgerKey || null,
        checkpointKey: persisted.checkpointKey || operation.checkpointKey || null,
        restartStatus: persisted.restartStatus || "unknown",
        recoveryPath: persisted.recoveryPath || "unknown",
        safeToReplay: persisted.idempotentCommand?.safeToReplay === true,
      },
      boundary: {
        boundaryKey: boundary.boundaryKey || null,
        tenant: boundary.scope?.tenant || null,
        workspace: boundary.scope?.workspace || null,
        environment: boundary.scope?.environment || null,
        status: boundary.status || "unknown",
        allowedRoles: boundary.allowedRoles || [],
        requiresAuditCorrelation: boundary.requiresAuditCorrelation === true,
      },
      provider: {
        status: providerRow.status || "unknown",
        negotiable: providerRow.negotiable === true,
        syncKey: providerNegotiation.syncKey,
        nextAction: providerRow.handoffState?.nextAction || providerNegotiation.externalHandoff?.nextAction || "handoff_to_runtime_adapter",
      },
      validationSummary: {
        errorCount: errors.length,
        warningCount: warnings.length,
        firstErrorCode: errors[0]?.code || "",
        firstWarningCode: warnings[0]?.code || "",
        blockingCodes: errors.map((diagnostic) => diagnostic.code).sort(),
      },
      explain: [
        ...(!metadataReady ? ["runtime_metadata_incomplete"] : []),
        ...(boundary.status !== "ready" ? [`boundary_${boundary.status || "blocked"}`] : []),
        ...(lifecycle.status === "settings-blocked" || lifecycle.status === "disabled" ? [`lifecycle_${lifecycle.status}`] : []),
        ...(adapter.failed ? ["adapter_failed"] : []),
        ...(adapter.degradedMode ? ["adapter_degraded"] : []),
        ...(errors.length ? ["validation_errors_present"] : []),
        ...(warnings.length ? ["validation_warnings_present"] : []),
        ...(operation.externalWrite ? ["truth_and_approval_required"] : []),
      ],
      nextStep: {
        action: !metadataReady
          ? "repair_runtime_client_metadata"
          : boundary.status !== "ready"
            ? boundary.statusHandoff?.nextAction || "repair_tenant_permission_boundary"
            : lifecycle.status === "settings-blocked" || lifecycle.status === "disabled"
              ? lifecycle.nextAction || "repair_lifecycle_visibility"
              : adapter.failed
                ? adapter.recovery?.nextAction || "surface_adapter_failure_to_operator"
                : errors.length
                  ? "repair_package_validation_errors"
                  : warnings.length
                    ? "review_package_validation_warnings"
                    : operation.externalWrite
                      ? "continue_to_truth_and_approval_preview"
                      : providerRow.handoffState?.nextAction || "delegate_mailchimp_read_contract",
        clientStatusPath: client.statusPath || null,
        providerStatusPath: providerRow.providerStatusPath || null,
        operatorVisible: routeVisible,
      },
    };
  });
  const blockedRows = rows.filter((row) => (
    row.readiness === "metadata-incomplete"
    || row.readiness === "boundary-blocked"
    || row.readiness === "adapter-failed"
    || row.readiness === "validation-blocked"
    || row.readiness.startsWith("lifecycle-")
  ));
  const reviewRows = rows.filter((row) => row.readiness === "operator-review" || row.readiness === "adapter-degraded");
  const acceptanceKey = stableId("acceptance", [
    descriptor.id,
    rows.length,
    blockedRows.length,
    reviewRows.length,
    providerNegotiation.syncKey,
    timelineReport.status,
  ]);

  return {
    format: "aios.mailchimp.package.acceptancePreview.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    acceptanceKey,
    status: blockedRows.length
      ? "blocked"
      : reviewRows.length
        ? "needs-review"
        : "accepted",
    accepted: blockedRows.length === 0,
    routeContract: {
      previewPath: `mailchimp.packages.${descriptor.id}.preview`,
      acceptancePath: `mailchimp.packages.${descriptor.id}.acceptance`,
      readinessPath: `mailchimp.packages.${descriptor.id}.readiness`,
      payloadShape: {
        acceptanceKey: "string",
        operationId: "string",
        accepted: "boolean",
        readiness: "string",
        requestId: "string",
        clientStatusPath: "string",
        providerStatusPath: "string|null",
        validationSummary: "object",
        nextStep: "object",
      },
    },
    counters: {
      operations: rows.length,
      accepted: rows.filter((row) => row.accepted).length,
      blocked: blockedRows.length,
      needsReview: reviewRows.length,
      routeVisible: rows.filter((row) => row.routeVisible).length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      metadataIncomplete: rows.filter((row) => row.readiness === "metadata-incomplete").length,
      validationErrors: rows.reduce((total, row) => total + row.validationSummary.errorCount, 0),
      validationWarnings: rows.reduce((total, row) => total + row.validationSummary.warningCount, 0),
    },
    rows,
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    reviewOperationIds: reviewRows.map((row) => row.operationId).sort(),
    nextAction: blockedRows[0]?.nextStep?.action
      || reviewRows[0]?.nextStep?.action
      || (rows.some((row) => row.externalWrite)
        ? "continue_to_truth_and_approval_preview"
        : providerNegotiation.externalHandoff?.nextAction || timelineReport.nextAction),
  };
}

function transitionStateForOperation(operation, providerRow = {}, acceptanceRow = {}) {
  const lifecycle = operation.lifecycleVisibility || {};
  const adapter = operation.adapterRecovery || {};
  const boundary = operation.tenantPermissionBoundary || {};
  const persisted = operation.persistedState || {};
  const readiness = compactString(acceptanceRow.readiness, "unknown");
  const providerStatus = compactString(providerRow.status, "unknown");
  const blockedReason = !operation.runtimeClientState?.client?.statusPath
    ? "client-status-path-missing"
    : !operation.runtimeClientState?.request?.requestId
      ? "request-id-missing"
      : boundary.status !== "ready"
        ? "boundary-blocked"
        : ["metadata-incomplete", "boundary-blocked", "adapter-failed", "validation-blocked"].includes(readiness)
          ? readiness
          : readiness.startsWith("lifecycle-")
            ? readiness
            : providerStatus === "metadata-incomplete" || providerStatus === "boundary-blocked" || providerStatus === "adapter-failed"
              ? providerStatus
              : adapter.failed
                ? "adapter-failed"
                : "";
  const currentState = blockedReason
    ? "blocked"
    : adapter.degradedMode
      ? "degraded"
      : adapter.retryable
        ? "retry_scheduled"
        : readiness === "awaiting-truth-approval"
          ? "waiting_for_approval"
          : persisted.restartStatus === "resume-ready"
            ? "checkpointed"
            : "planned";
  const targetState = blockedReason
    ? "failed"
    : adapter.degradedMode
      ? "running"
      : adapter.retryable
        ? "queued"
        : operation.externalWrite && readiness === "awaiting-truth-approval"
          ? "waiting_for_approval"
          : "queued";
  const visibleState = blockedReason
    ? "failed"
    : operation.externalWrite && readiness === "awaiting-truth-approval"
      ? "waiting_for_approval"
      : adapter.retryable
        ? "queued"
        : adapter.degradedMode
          ? "running"
          : "queued";
  const nextAction = blockedReason
    ? acceptanceRow.nextStep?.action
      || providerRow.handoffState?.nextAction
      || adapter.recovery?.nextAction
      || "repair_client_status_transition"
    : adapter.retryable
      ? "schedule_client_status_retry"
      : operation.externalWrite && readiness === "awaiting-truth-approval"
        ? "publish_waiting_for_truth_approval"
        : "publish_runtime_handoff_queued";

  return {
    currentState,
    targetState,
    visibleState,
    blockedReason,
    transitionStatus: blockedReason
      ? "blocked"
      : adapter.retryable
        ? "retry-scheduled"
        : adapter.degradedMode
          ? "degraded-visible"
          : "ready",
    nextAction,
  };
}

function buildClientStatusTransitionPlan(descriptor, operations, timelineReport, providerNegotiation, acceptancePreview) {
  const providerByOperation = new Map((providerNegotiation.rows || []).map((row) => [row.operationId, row]));
  const acceptanceByOperation = new Map((acceptancePreview.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const providerRow = providerByOperation.get(operation.id) || {};
    const acceptanceRow = acceptanceByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const persisted = operation.persistedState || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const adapter = operation.adapterRecovery || {};
    const transition = transitionStateForOperation(operation, providerRow, acceptanceRow);
    const transitionToken = stableId("client-transition", [
      descriptor.id,
      operation.id,
      request.requestId,
      client.statusPath,
      providerRow.providerStatusPath,
      transition.currentState,
      transition.targetState,
      transition.blockedReason,
    ]);
    const statusPatch = {
      path: client.statusPath || null,
      operationId: operation.id,
      requestId: request.requestId || null,
      state: transition.visibleState,
      provider: "mailchimp",
      providerStatusPath: providerRow.providerStatusPath || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      checkpointKey: persisted.checkpointKey || operation.checkpointKey || null,
      snapshotKey: persisted.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || null,
      transitionToken,
    };
    const blocked = transition.transitionStatus === "blocked";
    const replaySafe = persisted.idempotentCommand?.safeToReplay === true
      && (!operation.externalWrite || Boolean(request.idempotencyKey));

    return {
      index,
      operationId: operation.id,
      transitionToken,
      status: transition.transitionStatus,
      currentState: transition.currentState,
      targetState: transition.targetState,
      visibleState: transition.visibleState,
      blockedReason: transition.blockedReason,
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      idempotencyKeyRequired: operation.externalWrite,
      clientStatusPath: client.statusPath || null,
      progressPath: client.progressPath || null,
      providerStatusPath: providerRow.providerStatusPath || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      retryable: adapter.retryable === true,
      degradedMode: adapter.degradedMode === true,
      replaySafe,
      statusPatch,
      commands: [
        {
          command: "persist-client-status-transition",
          enabled: Boolean(client.statusPath && request.requestId),
          idempotencyKey: `status-transition:${transitionToken}`,
          state: transition.visibleState,
        },
        {
          command: "publish-provider-status-link",
          enabled: Boolean(providerRow.providerStatusPath && !blocked),
          idempotencyKey: `provider-status:${transitionToken}`,
          providerStatusPath: providerRow.providerStatusPath || null,
        },
        {
          command: "resume-runtime-handoff-from-status",
          enabled: !blocked && replaySafe,
          idempotencyKey: request.idempotencyKey || transitionToken,
          replayToken: request.replayToken || null,
        },
      ],
      nextAction: transition.nextAction,
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const retryRows = rows.filter((row) => row.status === "retry-scheduled");
  const degradedRows = rows.filter((row) => row.status === "degraded-visible");
  const readyRows = rows.filter((row) => row.status === "ready");
  const planKey = stableId("client-status-plan", [
    descriptor.id,
    rows.length,
    blockedRows.length,
    retryRows.length,
    timelineReport.status,
    providerNegotiation.syncKey,
    acceptancePreview.acceptanceKey,
  ]);

  return {
    format: "aios.mailchimp.package.clientStatusTransitionPlan.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    planKey,
    status: blockedRows.length
      ? "blocked"
      : degradedRows.length
        ? "degraded"
        : retryRows.length
          ? "retry-scheduled"
          : "ready",
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      retryScheduled: retryRows.length,
      degraded: degradedRows.length,
      replaySafe: rows.filter((row) => row.replaySafe).length,
      missingStatusPath: rows.filter((row) => !row.clientStatusPath).length,
      missingProviderStatusPath: rows.filter((row) => !row.providerStatusPath).length,
    },
    statusPaths: [...new Set(rows.map((row) => row.clientStatusPath).filter(Boolean))].sort(),
    providerStatusPaths: [...new Set(rows.map((row) => row.providerStatusPath).filter(Boolean))].sort(),
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    retryableOperationIds: rows.filter((row) => row.retryable).map((row) => row.operationId).sort(),
    routeContract: {
      planPath: `mailchimp.packages.${descriptor.id}.clientStatusTransitions`,
      patchShape: {
        path: "string",
        operationId: "string",
        requestId: "string",
        state: "planned|waiting_for_approval|queued|running|failed",
        providerStatusPath: "string|null",
        transitionToken: "string",
      },
    },
    nextAction: blockedRows[0]?.nextAction
      || degradedRows[0]?.nextAction
      || retryRows[0]?.nextAction
      || "publish_client_status_transitions",
  };
}

function buildAdapterRecoveryCheckpointPlan(descriptor, operations, diagnostics, acceptancePreview, clientStatusTransitionPlan) {
  const diagnosticsByOperation = new Map();
  for (const diagnostic of diagnostics) {
    const key = compactString(diagnostic.operationId);
    if (!key) {
      continue;
    }
    const existing = diagnosticsByOperation.get(key) || [];
    existing.push(diagnostic);
    diagnosticsByOperation.set(key, existing);
  }

  const acceptanceByOperation = new Map((acceptancePreview.rows || []).map((row) => [row.operationId, row]));
  const transitionByOperation = new Map((clientStatusTransitionPlan.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const persisted = operation.persistedState || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const adapter = operation.adapterRecovery || {};
    const lifecycle = operation.lifecycleVisibility || {};
    const adoption = operation.clientRuntimeAdoption || {};
    const acceptanceRow = acceptanceByOperation.get(operation.id) || {};
    const transitionRow = transitionByOperation.get(operation.id) || {};
    const operationDiagnostics = diagnosticsByOperation.get(operation.id) || [];
    const blockingDiagnostics = operationDiagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.code)
      .sort();
    const blockedBy = [
      ...blockingDiagnostics.map((code) => `diagnostic:${code}`),
      ...(!request.requestId ? ["request:request-id-missing"] : []),
      ...(!client.statusPath ? ["client:status-path-missing"] : []),
      ...(!persisted.snapshotKey ? ["persisted:snapshot-key-missing"] : []),
      ...(!persisted.ledgerKey ? ["persisted:ledger-key-missing"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["request:idempotency-key-missing"] : []),
      ...(boundary.status !== "ready" ? [`boundary:${boundary.status || "blocked"}`] : []),
      ...(adapter.failed ? [`adapter:${adapter.status || "failed"}`] : []),
      ...(lifecycle.status === "settings-blocked" || lifecycle.status === "disabled" ? [`lifecycle:${lifecycle.status}`] : []),
      ...(acceptanceRow.accepted === false ? [`acceptance:${acceptanceRow.readiness || "blocked"}`] : []),
      ...(transitionRow.status === "blocked" ? [`client-transition:${transitionRow.blockedReason || "blocked"}`] : []),
      ...(operation.externalWrite && persisted.idempotentCommand?.safeToReplay !== true ? ["replay:not-safe"] : []),
      ...(adoption.acceptedForClient === false ? [`adoption:${adoption.blockedReason || "blocked"}`] : []),
    ].sort();
    const pendingBy = [
      ...(adapter.retryable ? ["adapter:retry-scheduled"] : []),
      ...(adapter.degradedMode ? ["adapter:degraded"] : []),
      ...(lifecycle.status === "scheduled" ? ["lifecycle:scheduled"] : []),
      ...(lifecycle.status === "waiting-for-approval" ? ["approval:operator-required"] : []),
      ...(transitionRow.status === "retry-scheduled" ? ["client-transition:retry-scheduled"] : []),
      ...(transitionRow.status === "degraded-visible" ? ["client-transition:degraded-visible"] : []),
    ].sort();
    const replaySafe = persisted.idempotentCommand?.safeToReplay === true
      && (!operation.externalWrite || Boolean(request.idempotencyKey))
      && transitionRow.replaySafe !== false;
    const status = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : replaySafe
          ? "checkpoint-ready"
          : "operator-review";
    const checkpointId = stableId("adapter-checkpoint", [
      descriptor.id,
      operation.id,
      persisted.snapshotKey,
      persisted.ledgerKey,
      transitionRow.transitionToken,
      status,
    ]);
    const command = status === "checkpoint-ready"
      ? operation.externalWrite
        ? "resume_external_write_adapter_handoff"
        : "resume_read_adapter_handoff"
      : status === "pending"
        ? "wait_for_recovery_prerequisites"
        : "repair_adapter_recovery_checkpoint";

    return {
      index,
      operationId: operation.id,
      checkpointId,
      status,
      command,
      replaySafe,
      externalWrite: operation.externalWrite,
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      replayToken: request.replayToken || null,
      clientStatusPath: client.statusPath || null,
      providerStatusPath: adoption.client?.providerStatusPath || transitionRow.providerStatusPath || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      snapshotKey: persisted.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || null,
      transitionToken: transitionRow.transitionToken || null,
      adoptionKey: adoption.adoptionKey || null,
      blockedBy,
      pendingBy,
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("diagnostic:")
          ? "repair_package_diagnostics"
          : blockedBy[0].startsWith("request:")
            ? "repair_runtime_request_state"
            : blockedBy[0].startsWith("client:")
              ? "repair_client_runtime_state"
              : blockedBy[0].startsWith("persisted:")
                ? "repair_persisted_runtime_state"
                : blockedBy[0].startsWith("boundary:")
                  ? boundary.statusHandoff?.nextAction || "repair_tenant_permission_boundary"
                  : blockedBy[0].startsWith("client-transition:")
                    ? transitionRow.nextAction || "repair_client_status_transition"
                    : blockedBy[0].startsWith("adoption:")
                      ? adoption.workflow?.nextAction || "repair_client_runtime_adoption_metadata"
                      : adapter.recovery?.nextAction || acceptanceRow.nextStep?.action || "repair_adapter_recovery_checkpoint"
        : pendingBy.length
          ? pendingBy[0].startsWith("adapter:")
            ? adapter.recovery?.nextAction || "schedule_adapter_recovery_retry"
            : pendingBy[0].startsWith("approval:")
              ? "request_operator_approval"
              : lifecycle.nextAction || transitionRow.nextAction || "wait_for_adapter_recovery_checkpoint"
          : command,
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.status === "checkpoint-ready");
  const planKey = stableId("adapter-checkpoint-plan", [
    descriptor.id,
    rows.length,
    blockedRows.length,
    pendingRows.length,
    clientStatusTransitionPlan.planKey,
    acceptancePreview.acceptanceKey,
  ]);

  return {
    format: "aios.mailchimp.package.adapterRecoveryCheckpointPlan.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    planKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : readyRows.length === rows.length
          ? "ready"
          : "operator-review",
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      operatorReview: rows.filter((row) => row.status === "operator-review").length,
      replaySafe: rows.filter((row) => row.replaySafe).length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    commands: rows.map((row) => ({
      command: row.command,
      enabled: row.status === "checkpoint-ready",
      operationId: row.operationId,
      idempotencyKey: row.idempotencyKey || `adapter-checkpoint:${row.checkpointId}`,
      statusPath: row.clientStatusPath,
      replayToken: row.replayToken,
    })),
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || "publish_adapter_recovery_checkpoints",
  };
}

function buildPackageRestartJournal(descriptor, operations, analytics, clientStatusTransitionPlan, adapterRecoveryCheckpointPlan) {
  const transitionByOperation = new Map((clientStatusTransitionPlan.rows || []).map((row) => [row.operationId, row]));
  const checkpointByOperation = new Map((adapterRecoveryCheckpointPlan.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const persisted = operation.persistedState || {};
    const adapter = operation.adapterRecovery || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const adoption = operation.clientRuntimeAdoption || {};
    const transition = transitionByOperation.get(operation.id) || {};
    const checkpoint = checkpointByOperation.get(operation.id) || {};
    const blockedBy = [
      ...(!request.requestId ? ["request:request-id-missing"] : []),
      ...(!client.statusPath ? ["client:status-path-missing"] : []),
      ...(!persisted.snapshotKey ? ["persisted:snapshot-key-missing"] : []),
      ...(!persisted.ledgerKey ? ["persisted:ledger-key-missing"] : []),
      ...(!persisted.checkpointKey ? ["persisted:checkpoint-key-missing"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["request:idempotency-key-missing"] : []),
      ...(boundary.status !== "ready" ? [`boundary:${boundary.status || "blocked"}`] : []),
      ...(adapter.failed ? [`adapter:${adapter.status || "failed"}`] : []),
      ...(transition.status === "blocked" ? [`client-transition:${transition.blockedReason || "blocked"}`] : []),
      ...(checkpoint.status === "blocked" ? checkpoint.blockedBy.map((blocker) => `checkpoint:${blocker}`) : []),
      ...(adoption.acceptedForClient === false ? [`adoption:${adoption.blockedReason || "blocked"}`] : []),
      ...(operation.externalWrite && persisted.idempotentCommand?.safeToReplay !== true ? ["replay:not-safe"] : []),
    ].sort();
    const pendingBy = [
      ...(adapter.retryable ? ["adapter:retry-scheduled"] : []),
      ...(adapter.degradedMode ? ["adapter:degraded"] : []),
      ...(transition.status === "retry-scheduled" ? ["client-transition:retry-scheduled"] : []),
      ...(transition.status === "degraded-visible" ? ["client-transition:degraded-visible"] : []),
      ...(checkpoint.status === "pending" ? checkpoint.pendingBy.map((pending) => `checkpoint:${pending}`) : []),
    ].sort();
    const restartSafe = blockedBy.length === 0
      && persisted.idempotentCommand?.safeToReplay === true
      && checkpoint.replaySafe !== false
      && transition.replaySafe !== false;
    const status = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : restartSafe
          ? "restart-safe"
          : "operator-review";
    const journalEntryId = stableId("restart-entry", [
      descriptor.id,
      operation.id,
      request.requestId,
      persisted.snapshotKey,
      transition.transitionToken,
      checkpoint.checkpointId,
      status,
    ]);
    const commandEnabled = status === "restart-safe" || status === "pending";
    const nextAction = blockedBy.length
      ? blockedBy[0].startsWith("request:")
        ? "repair_runtime_request_state"
        : blockedBy[0].startsWith("client:")
          ? "repair_client_runtime_state"
          : blockedBy[0].startsWith("persisted:")
            ? "repair_persisted_runtime_state"
            : blockedBy[0].startsWith("boundary:")
              ? boundary.statusHandoff?.nextAction || "repair_tenant_permission_boundary"
              : blockedBy[0].startsWith("client-transition:")
                ? transition.nextAction || "repair_client_status_transition"
                : blockedBy[0].startsWith("checkpoint:")
                  ? checkpoint.nextAction || adapterRecoveryCheckpointPlan.nextAction || "repair_adapter_recovery_checkpoint"
                  : blockedBy[0].startsWith("adoption:")
                    ? adoption.workflow?.nextAction || "repair_client_runtime_adoption_metadata"
                    : adapter.recovery?.nextAction || "repair_restart_journal_entry"
      : pendingBy.length
        ? pendingBy[0].startsWith("adapter:")
          ? adapter.recovery?.nextAction || "schedule_adapter_recovery_retry"
          : pendingBy[0].startsWith("client-transition:")
            ? transition.nextAction || "wait_for_client_status_transition"
            : checkpoint.nextAction || "wait_for_adapter_recovery_checkpoint"
        : restartSafe
          ? "persist_restart_journal_entry"
          : "route_restart_journal_entry_to_operator_review";

    return {
      index,
      operationId: operation.id,
      journalEntryId,
      status,
      restartSafe,
      externalWrite: operation.externalWrite,
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      replayToken: request.replayToken || null,
      dedupeScope: request.dedupeScope || null,
      statusPath: client.statusPath || null,
      progressPath: client.progressPath || null,
      providerStatusPath: adoption.client?.providerStatusPath || checkpoint.providerStatusPath || transition.providerStatusPath || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      snapshotKey: persisted.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || null,
      checkpointKey: persisted.checkpointKey || operation.checkpointKey || null,
      transitionToken: transition.transitionToken || null,
      adapterCheckpointId: checkpoint.checkpointId || null,
      adoptionKey: adoption.adoptionKey || null,
      blockedBy,
      pendingBy,
      command: {
        command: operation.externalWrite ? "persist-external-write-restart-journal" : "persist-read-restart-journal",
        enabled: commandEnabled,
        idempotencyKey: request.idempotencyKey || `restart-journal:${journalEntryId}`,
        replayToken: request.replayToken || null,
        statusPath: client.statusPath || null,
      },
      resumeEnvelope: {
        provider: "mailchimp",
        operationId: operation.id,
        requestId: request.requestId || null,
        statusPath: client.statusPath || null,
        providerStatusPath: adoption.client?.providerStatusPath || checkpoint.providerStatusPath || transition.providerStatusPath || null,
        snapshotKey: persisted.snapshotKey || null,
        ledgerKey: persisted.ledgerKey || null,
        boundaryKey: boundary.boundaryKey || null,
        restartStatus: status,
        safeToReplay: restartSafe,
      },
      nextAction,
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const restartSafeRows = rows.filter((row) => row.restartSafe);
  const operatorReviewRows = rows.filter((row) => row.status === "operator-review");
  const journalId = stableId("restart-journal", [
    descriptor.id,
    clientStatusTransitionPlan.planKey,
    adapterRecoveryCheckpointPlan.planKey,
    rows.length,
    blockedRows.length,
    pendingRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.restartJournal.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    journalId,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : restartSafeRows.length === rows.length
          ? "restart-safe"
          : "operator-review",
    acceptedForRuntime: blockedRows.length === 0 && operatorReviewRows.length === 0,
    rows,
    counters: {
      operations: rows.length,
      restartSafe: restartSafeRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      operatorReview: operatorReviewRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      commandEnabled: rows.filter((row) => row.command.enabled).length,
      exportable: analytics.counters.exportableOperationCount,
    },
    commands: rows.map((row) => row.command),
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    restartSafeOperationIds: restartSafeRows.map((row) => row.operationId).sort(),
    stateKeys: {
      journalPath: `mailchimp.packages.${descriptor.id}.restartJournal`,
      operationPathTemplate: `mailchimp.packages.${descriptor.id}.restartJournal.operations.{operationId}`,
      statusPathTemplate: "mailchimp.operations.{operationId}.status",
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || (operatorReviewRows.length
        ? "route_restart_journal_to_operator_review"
        : "publish_restart_journal"),
  };
}

function buildPackageExportSummary(descriptor, operations, diagnostics, analytics, timelineReport, providerNegotiation, acceptancePreview, clientStatusTransitionPlan, adapterRecoveryCheckpointPlan, restartJournal) {
  return {
    format: "aios.mailchimp.package.report.v1",
    packageId: descriptor.id,
    provider: "mailchimp",
    status: acceptancePreview.status === "blocked"
      ? "blocked"
      : timelineReport.status === "blocked"
      ? "blocked"
      : analytics.counters.exportableOperationCount === operations.length
        ? "export-ready"
        : "metadata-incomplete",
    counters: analytics.counters,
    package: {
      id: descriptor.id,
      name: descriptor.name,
      version: descriptor.version,
      runtimeAdapter: descriptor.runtimeAdapter || null,
    },
    operationRows: operations.map((operation) => ({
      operationId: operation.id,
      externalWrite: operation.externalWrite,
      requestId: operation.runtimeClientState?.request?.requestId || null,
      idempotencyKeyPresent: Boolean(operation.runtimeClientState?.request?.idempotencyKey),
      statusPath: operation.runtimeClientState?.client?.statusPath || null,
      progressPath: operation.runtimeClientState?.client?.progressPath || null,
      snapshotKey: operation.persistedState?.snapshotKey || null,
      ledgerKey: operation.persistedState?.ledgerKey || null,
      boundaryKey: operation.tenantPermissionBoundary?.boundaryKey || null,
      adapterStatus: operation.adapterRecovery?.status || "unknown",
      nextAction: operation.adapterRecovery?.recovery?.nextAction || operation.statusHandoff?.nextAction || "handoff_to_runtime_adapter",
      lifecycleStatus: operation.lifecycleVisibility?.status || "unknown",
      lifecycleNextAction: operation.lifecycleVisibility?.nextAction || "handoff_to_runtime_adapter",
    })),
    diagnosticRows: diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      field: diagnostic.field || "",
      action: diagnostic.action || "",
    })),
    blockedOperationIds: analytics.blockedOperationIds,
    retryableOperationIds: analytics.retryableOperationIds,
    timelineStatus: timelineReport.status,
    providerNegotiation: {
      syncKey: providerNegotiation.syncKey,
      status: providerNegotiation.status,
      nextAction: providerNegotiation.externalHandoff.nextAction,
      counters: providerNegotiation.counters,
    },
    acceptancePreview: {
      acceptanceKey: acceptancePreview.acceptanceKey,
      status: acceptancePreview.status,
      accepted: acceptancePreview.accepted,
      nextAction: acceptancePreview.nextAction,
      counters: acceptancePreview.counters,
    },
    clientStatusTransitionPlan: {
      planKey: clientStatusTransitionPlan.planKey,
      status: clientStatusTransitionPlan.status,
      nextAction: clientStatusTransitionPlan.nextAction,
      counters: clientStatusTransitionPlan.counters,
      blockedOperationIds: clientStatusTransitionPlan.blockedOperationIds,
    },
    adapterRecoveryCheckpointPlan: {
      planKey: adapterRecoveryCheckpointPlan.planKey,
      status: adapterRecoveryCheckpointPlan.status,
      nextAction: adapterRecoveryCheckpointPlan.nextAction,
      counters: adapterRecoveryCheckpointPlan.counters,
      blockedOperationIds: adapterRecoveryCheckpointPlan.blockedOperationIds,
      pendingOperationIds: adapterRecoveryCheckpointPlan.pendingOperationIds,
    },
    restartJournal: {
      journalId: restartJournal.journalId,
      status: restartJournal.status,
      acceptedForRuntime: restartJournal.acceptedForRuntime,
      nextAction: restartJournal.nextAction,
      counters: restartJournal.counters,
      blockedOperationIds: restartJournal.blockedOperationIds,
      pendingOperationIds: restartJournal.pendingOperationIds,
      restartSafeOperationIds: restartJournal.restartSafeOperationIds,
    },
    nextAction: acceptancePreview.nextAction || timelineReport.nextAction,
  };
}

export function analyzeMailchimpPackage(source = {}, options = {}) {
  const compiled = compilePackageManifest(source, options);
  const descriptor = compiled.descriptor;
  const operations = (descriptor.operations || []).map((operation, index) => (
    buildOperationRuntimeContract(descriptor, operation, index, options.runtimeHealth || options.health || {})
  ));
  const diagnostics = [
    ...(compiled.issues || []).map((issue, index) => normalizeIssue(issue, index)),
    ...(descriptor.operations || []).flatMap((operation, index) => collectOperationDiagnostics(operation, index)),
    ...operations.flatMap((operation, index) => collectOperationalHealthDiagnostics(operation, index)),
    ...operations.flatMap((operation, index) => (
      operation.tenantPermissionBoundary.violations.map((violation) => ({
        index,
        source: "tenant-permission-boundary",
        severity: "error",
        code: `package.boundary.${violation}`,
        message: `Operation ${operation.id} has an invalid Mailchimp tenant permission boundary: ${violation}.`,
        field: `operations.${index}.tenantPermissionBoundary`,
      }))
    )),
    ...operations.flatMap((operation, index) => (
      (operation.lifecycleVisibility?.validation || []).map((issue) => ({
        index,
        source: "lifecycle-controls",
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        field: `operations.${index}.lifecycle`,
      }))
    )),
  ];
  const summary = summarizePackage(descriptor, operations, diagnostics);
  const analytics = buildPackageAnalyticsState(descriptor, operations, diagnostics, summary);
  const historySnapshots = buildPackageHistorySnapshots(descriptor, operations, diagnostics, analytics);
  const timelineReport = buildPackageTimelineReport(descriptor, historySnapshots, analytics, summary);
  const providerServiceNegotiation = buildPackageProviderServiceNegotiation(descriptor, operations, analytics, timelineReport);
  const acceptancePreview = buildPackageAcceptancePreview(
    descriptor,
    operations,
    diagnostics,
    analytics,
    timelineReport,
    providerServiceNegotiation,
  );
  const clientStatusTransitionPlan = buildClientStatusTransitionPlan(
    descriptor,
    operations,
    timelineReport,
    providerServiceNegotiation,
    acceptancePreview,
  );
  const transitionDiagnostics = clientStatusTransitionPlan.rows
    .filter((row) => row.status === "blocked" || !row.providerStatusPath)
    .map((row) => ({
      index: row.index,
      source: "client-status-transition",
      severity: row.status === "blocked" ? "error" : "warning",
      code: row.status === "blocked"
        ? `package.client_status_transition.${row.blockedReason}`
        : "package.client_status_transition.provider_status_path_missing",
      message: row.status === "blocked"
        ? `Operation ${row.operationId} cannot publish a deterministic Mailchimp client status transition: ${row.blockedReason}.`
        : `Operation ${row.operationId} can publish client status but has no provider status path for Mailchimp recovery polling.`,
      field: `operations.${row.index}.clientStatusTransition`,
      operationId: row.operationId,
      action: row.nextAction,
    }));
  const allDiagnostics = diagnostics.concat(transitionDiagnostics);
  const adapterRecoveryCheckpointPlan = buildAdapterRecoveryCheckpointPlan(
    descriptor,
    operations,
    allDiagnostics,
    acceptancePreview,
    clientStatusTransitionPlan,
  );
  const restartJournal = buildPackageRestartJournal(
    descriptor,
    operations,
    analytics,
    clientStatusTransitionPlan,
    adapterRecoveryCheckpointPlan,
  );
  const exportSummary = buildPackageExportSummary(
    descriptor,
    operations,
    allDiagnostics,
    analytics,
    timelineReport,
    providerServiceNegotiation,
    acceptancePreview,
    clientStatusTransitionPlan,
    adapterRecoveryCheckpointPlan,
    restartJournal,
  );

  return {
    kind: "aios.semantic.packageAnalysis",
    provider: "mailchimp",
    package: {
      id: descriptor.id,
      name: descriptor.name,
      version: descriptor.version,
      runtimeAdapter: descriptor.runtimeAdapter,
      persistence: descriptor.persistence,
    },
    operations,
    runtimeContract: {
      statusStates: descriptor.recovery?.statusStates || [],
      commandLog: descriptor.persistence?.commandLog || null,
      recovery: descriptor.recovery || null,
      truthBoundary: descriptor.truthBoundary || null,
      clientStatusPaths: operations.map((operation) => ({
        operationId: operation.id,
        requestId: operation.runtimeClientState.request.requestId,
        statusPath: operation.runtimeClientState.client.statusPath,
        progressPath: operation.runtimeClientState.client.progressPath,
        idempotencyKey: operation.runtimeClientState.request.idempotencyKey,
      })),
      persistedState: operations.map((operation) => ({
        operationId: operation.id,
        snapshotKey: operation.persistedState.snapshotKey,
        ledgerKey: operation.persistedState.ledgerKey,
        checkpointKey: operation.persistedState.checkpointKey,
        restartStatus: operation.persistedState.restartStatus,
        replayPolicy: operation.persistedState.replayPolicy,
        statusPath: operation.persistedState.statusDocument.path,
        recoveryPath: operation.persistedState.recoveryPath,
      })),
      adapterRecovery: operations.map((operation) => ({
        operationId: operation.id,
        provider: operation.adapterRecovery.provider,
        service: operation.adapterRecovery.service,
        status: operation.adapterRecovery.status,
        retryable: operation.adapterRecovery.retryable,
        degradedMode: operation.adapterRecovery.degradedMode,
        failed: operation.adapterRecovery.failed,
        requestId: operation.adapterRecovery.request.requestId,
        idempotencyKey: operation.adapterRecovery.request.idempotencyKey,
        clientStatusPath: operation.adapterRecovery.clientStatus.statusPath,
        boundaryStatusPath: operation.adapterRecovery.clientStatus.boundaryStatusPath,
        nextAction: operation.adapterRecovery.recovery.nextAction,
        nextDelayMs: operation.adapterRecovery.backoff.nextDelayMs,
        failure: operation.adapterRecovery.failure,
      })),
      lifecycleVisibility: operations.map((operation) => ({
        operationId: operation.id,
        status: operation.lifecycleVisibility.status,
        mode: operation.lifecycleVisibility.mode,
        enabled: operation.lifecycleVisibility.enabled,
        operatorVisible: operation.lifecycleVisibility.operatorVisible,
        schedule: operation.lifecycleVisibility.schedule,
        controls: operation.lifecycleVisibility.controls,
        requestId: operation.lifecycleVisibility.clientState.requestId,
        clientStatusPath: operation.lifecycleVisibility.clientState.statusPath,
        progressPath: operation.lifecycleVisibility.clientState.progressPath,
        boundaryStatusPath: operation.lifecycleVisibility.clientState.boundaryStatusPath,
        nextAction: operation.lifecycleVisibility.nextAction,
      })),
      tenantPermissionBoundaries: operations.map((operation) => ({
        operationId: operation.id,
        boundaryKey: operation.tenantPermissionBoundary.boundaryKey,
        scope: operation.tenantPermissionBoundary.scope,
        allowedRoles: operation.tenantPermissionBoundary.allowedRoles,
        deniedRoles: operation.tenantPermissionBoundary.deniedRoles,
        requiresLease: operation.tenantPermissionBoundary.requiresLease,
        requiresAuditCorrelation: operation.tenantPermissionBoundary.requiresAuditCorrelation,
        auditChannel: operation.tenantPermissionBoundary.auditChannel,
        handoffStatusPath: operation.tenantPermissionBoundary.handoffStatusPath,
        runtimeEvidenceShape: operation.tenantPermissionBoundary.runtimeEvidenceShape,
      })),
      analytics,
      historySnapshots,
      timelineReport,
      acceptancePreview,
      exportSummary,
      providerServiceNegotiation,
      clientStatusTransitionPlan,
      adapterRecoveryCheckpointPlan,
      restartJournal,
    },
    diagnostics: allDiagnostics,
    summary,
    analytics,
    history: {
      snapshots: historySnapshots,
      latestStatus: historySnapshots.at(-1)?.status || "empty",
      retryableOperationIds: analytics.retryableOperationIds,
      blockedOperationIds: analytics.blockedOperationIds,
    },
    timeline: timelineReport,
    providerServiceNegotiation,
    acceptancePreview,
    clientStatusTransitionPlan,
    adapterRecoveryCheckpointPlan,
    restartJournal,
    exportSummary,
    valid: summary.valid
      && restartJournal.status !== "blocked"
      && !transitionDiagnostics.some((diagnostic) => diagnostic.severity === "error"),
  };
}

export function assertMailchimpPackageAnalysis(analysis) {
  const diagnostics = [];
  if (analysis?.kind !== "aios.semantic.packageAnalysis") {
    diagnostics.push({ severity: "error", code: "package.analysis.kind", message: "Unexpected package analysis kind." });
  }
  if (!analysis?.package?.id) {
    diagnostics.push({ severity: "error", code: "package.analysis.id_missing", message: "Package analysis requires a stable package id." });
  }
  if (!Array.isArray(analysis?.operations) || analysis.operations.length === 0) {
    diagnostics.push({ severity: "error", code: "package.analysis.operations_missing", message: "At least one operation contract is required." });
  }
  if (!analysis?.clientStatusTransitionPlan?.planKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.client_status_transition_plan_missing", message: "Package analysis should expose a client status transition plan." });
  }
  if (analysis?.clientStatusTransitionPlan?.status === "ready"
    && analysis.clientStatusTransitionPlan.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.client_status_transition_ready_with_blockers", message: "Client status transition plan cannot be ready while blocked operations are present." });
  }
  if (analysis?.adapterRecoveryCheckpointPlan?.status === "ready"
    && analysis.adapterRecoveryCheckpointPlan.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.adapter_checkpoint_ready_with_blockers", message: "Adapter recovery checkpoints cannot be ready while blocked operations are present." });
  }
  if (!analysis?.restartJournal?.journalId) {
    diagnostics.push({ severity: "warning", code: "package.analysis.restart_journal_missing", message: "Package analysis should expose a deterministic restart journal." });
  }
  if (analysis?.restartJournal?.status === "restart-safe"
    && analysis.restartJournal.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.restart_journal_ready_with_blockers", message: "Restart journal cannot be restart-safe while blocked operations are present." });
  }
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    nextAction: diagnostics.length ? "repair_package_analysis" : analysis.summary?.nextAction || "handoff_to_runtime_adapter",
  };
}

export default analyzeMailchimpPackage;
