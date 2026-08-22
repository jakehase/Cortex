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

function buildBoundaryEvidencePacket(descriptor, operation, tenantPermissionBoundary, runtimeClientState, persistedState, writesExternalState) {
  const boundary = tenantPermissionBoundary || {};
  const scope = boundary.scope || {};
  const request = runtimeClientState.request || {};
  const client = runtimeClientState.client || {};
  const packetId = stableId("boundary-evidence", [
    descriptor.id,
    operation.id,
    boundary.boundaryKey,
    scope.tenant,
    scope.workspace,
    request.requestId,
    persistedState.snapshotKey,
  ]);
  const requiredFields = [
    "boundaryKey",
    "tenant",
    "workspace",
    "actorRole",
    "requestId",
    "clientStatusPath",
    "snapshotKey",
    ...(boundary.requiresAuditCorrelation || writesExternalState ? ["auditCorrelationId"] : []),
    ...(boundary.requiresLease || writesExternalState ? ["leaseId"] : []),
  ];
  const missingFields = [
    ...(!boundary.boundaryKey ? ["boundaryKey"] : []),
    ...(!scope.tenant ? ["tenant"] : []),
    ...(!scope.workspace ? ["workspace"] : []),
    ...(!request.requestId ? ["requestId"] : []),
    ...(!client.statusPath ? ["clientStatusPath"] : []),
    ...(!persistedState.snapshotKey ? ["snapshotKey"] : []),
    ...(!boundary.allowedRoles?.length ? ["actorRole"] : []),
  ];
  const acceptedForBoundary = missingFields.length === 0
    && boundary.status === "ready"
    && (!writesExternalState || Boolean(request.idempotencyKey));
  const statusPatch = {
    patchId: stableId("boundary-patch", [packetId, client.statusPath, boundary.status]),
    statusPath: boundary.handoffStatusPath || client.statusPath || null,
    clientStatusPath: client.statusPath || null,
    state: acceptedForBoundary ? "boundary-evidence-ready" : "boundary-evidence-blocked",
    visibleState: acceptedForBoundary ? "permission-boundary-ready" : "permission-boundary-blocked",
    fields: acceptedForBoundary
      ? {
        boundaryKey: boundary.boundaryKey,
        tenant: scope.tenant,
        workspace: scope.workspace,
        environment: scope.environment,
        requestId: request.requestId,
        snapshotKey: persistedState.snapshotKey,
        ledgerKey: persistedState.ledgerKey,
        allowedRoles: boundary.allowedRoles || [],
        deniedRoles: boundary.deniedRoles || [],
        requiresLease: boundary.requiresLease === true,
        requiresAuditCorrelation: boundary.requiresAuditCorrelation === true,
      }
      : null,
    blockedBy: missingFields,
    nextAction: missingFields.length
      ? "collect_boundary_evidence_fields"
      : boundary.status !== "ready"
        ? boundary.statusHandoff?.nextAction || "repair_tenant_permission_boundary"
        : "publish_boundary_evidence_status",
  };

  return {
    format: "aios.mailchimp.package.boundaryEvidencePacket.v1",
    packetId,
    operationId: operation.id,
    boundaryKey: boundary.boundaryKey || null,
    status: acceptedForBoundary ? "ready" : "blocked",
    acceptedForBoundary,
    requiredFields,
    missingFields,
    scope: {
      tenant: scope.tenant || null,
      workspace: scope.workspace || null,
      environment: scope.environment || "production",
    },
    roles: {
      allowed: boundary.allowedRoles || [],
      denied: boundary.deniedRoles || [],
      evidenceField: "actorRole",
    },
    audit: {
      required: boundary.requiresAuditCorrelation === true || writesExternalState,
      auditChannel: boundary.auditChannel || null,
      evidenceField: "auditCorrelationId",
    },
    lease: {
      required: boundary.requiresLease === true || writesExternalState,
      evidenceField: "leaseId",
      idempotencyKeyRequired: writesExternalState,
    },
    request: {
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      replayToken: request.replayToken || null,
    },
    client: {
      statusPath: client.statusPath || null,
      progressPath: client.progressPath || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
    },
    persisted: {
      snapshotKey: persistedState.snapshotKey || null,
      ledgerKey: persistedState.ledgerKey || null,
      checkpointKey: persistedState.checkpointKey || null,
      recoveryPath: persistedState.recoveryPath || null,
    },
    statusPatch,
    nextAction: acceptedForBoundary
      ? "attach_boundary_evidence_to_handoff"
      : statusPatch.nextAction,
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

function lifecycleControlCommand(operation, lifecycle, command, enabled, blockedBy = [], pendingBy = []) {
  const statusPatch = {
    patchId: stableId("lifecycle-control-patch", [operation.id, command, lifecycle.clientState.statusPath]),
    statusPath: lifecycle.clientState.statusPath || null,
    progressPath: lifecycle.clientState.progressPath || null,
    boundaryStatusPath: lifecycle.clientState.boundaryStatusPath || null,
    state: enabled
      ? command === "dispatch"
        ? "handoff-dispatch-ready"
        : `lifecycle-${command}-ready`
      : `lifecycle-${command}-blocked`,
    visibleState: enabled
      ? command === "dispatch"
        ? "Ready to hand off to Mailchimp"
        : `Lifecycle ${command} available`
      : `Lifecycle ${command} unavailable`,
    blockedBy,
    pendingBy,
    nextAction: enabled
      ? command === "dispatch"
        ? lifecycle.nextAction
        : `apply_lifecycle_${command}`
      : blockedBy.length
        ? "repair_lifecycle_control_state"
        : "wait_for_lifecycle_control_prerequisites",
  };

  return {
    command,
    enabled,
    requestId: lifecycle.clientState.requestId || null,
    idempotencyKey: operation.runtimeClientState?.request?.idempotencyKey || null,
    replayToken: operation.runtimeClientState?.request?.replayToken || null,
    statusPatch,
  };
}

function buildLifecycleSettingsAcceptance(descriptor, operations, lifecycleControlPlane) {
  const controlByOperation = new Map((lifecycleControlPlane.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation) => {
    const lifecycle = operation.lifecycleVisibility || {};
    const control = controlByOperation.get(operation.id) || {};
    const commands = Array.isArray(control.commands) ? control.commands : [];
    const enabledCommands = commands.filter((command) => command.enabled === true).map((command) => command.command).sort();
    const dispatchCommand = commands.find((command) => command.command === "dispatch") || {};
    const retryCommand = commands.find((command) => command.command === "retry") || {};
    const scheduleCommand = commands.find((command) => command.command === "schedule") || {};
    const settingsErrors = Array.isArray(lifecycle.validation)
      ? lifecycle.validation.filter((entry) => entry.severity === "error")
      : [];
    const scheduleActive = lifecycle.schedule?.active === true || control.schedule?.active === true;
    const blockedBy = [
      ...settingsErrors.map((entry) => `settings:${entry.code || "invalid"}`),
      ...((control.blockedBy || []).map((blocker) => `control:${blocker}`)),
      ...(lifecycle.enabled === false ? ["settings:disabled"] : []),
      ...(lifecycle.status === "settings-blocked" ? ["settings:blocked"] : []),
      ...(lifecycle.status === "health-paused" ? ["runtime:health-paused"] : []),
      ...(lifecycle.status === "adapter-failed" ? ["adapter:failed"] : []),
      ...(operation.tenantPermissionBoundary?.status !== "ready" ? [`boundary:${operation.tenantPermissionBoundary?.status || "blocked"}`] : []),
    ].sort();
    const pendingBy = [
      ...((control.pendingBy || []).map((pending) => `control:${pending}`)),
      ...(scheduleActive ? ["schedule:active"] : []),
      ...(lifecycle.status === "waiting-for-approval" ? ["approval:operator-required"] : []),
      ...(operation.adapterRecovery?.retryable === true ? ["adapter:retry-scheduled"] : []),
      ...(operation.adapterRecovery?.degradedMode === true ? ["adapter:degraded"] : []),
    ].sort();
    const acceptedForProvider = blockedBy.length === 0
      && dispatchCommand.enabled === true
      && !pendingBy.includes("schedule:active");
    const acceptedForOperator = blockedBy.length === 0
      && (dispatchCommand.enabled === true || lifecycle.operatorVisible === true);
    const status = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : acceptedForProvider
          ? "dispatch-accepted"
          : retryCommand.enabled === true
            ? "retry-accepted"
            : scheduleCommand.enabled === true
              ? "schedule-accepted"
              : "observe";
    const acceptanceId = stableId("lifecycle-settings", [
      descriptor.id,
      operation.id,
      lifecycle.status,
      control.status,
      enabledCommands.join(","),
    ]);

    return {
      format: "aios.mailchimp.package.lifecycleSettingsAcceptance.row.v1",
      acceptanceId,
      operationId: operation.id,
      controlId: control.controlId || null,
      status,
      acceptedForProvider,
      acceptedForOperator,
      mode: lifecycle.mode || "observe",
      enabled: lifecycle.enabled === true,
      operatorVisible: lifecycle.operatorVisible === true,
      lifecycleStatus: lifecycle.status || "unknown",
      controlStatus: control.status || "unknown",
      enabledCommands,
      blockedBy,
      pendingBy,
      schedule: {
        active: scheduleActive,
        earliestAt: lifecycle.schedule?.earliestAt || control.schedule?.earliestAt || "",
        notAfter: lifecycle.schedule?.notAfter || control.schedule?.notAfter || "",
        cooldownMs: lifecycle.schedule?.cooldownMs ?? control.schedule?.cooldownMs ?? 0,
        intervalMs: lifecycle.schedule?.intervalMs ?? control.schedule?.intervalMs ?? 0,
      },
      commandStatus: {
        dispatch: {
          enabled: dispatchCommand.enabled === true,
          patchId: dispatchCommand.statusPatch?.patchId || null,
          state: dispatchCommand.statusPatch?.state || "unknown",
          nextAction: dispatchCommand.statusPatch?.nextAction || null,
        },
        retry: {
          enabled: retryCommand.enabled === true,
          patchId: retryCommand.statusPatch?.patchId || null,
          state: retryCommand.statusPatch?.state || "unknown",
          nextAction: retryCommand.statusPatch?.nextAction || null,
        },
        schedule: {
          enabled: scheduleCommand.enabled === true,
          patchId: scheduleCommand.statusPatch?.patchId || null,
          state: scheduleCommand.statusPatch?.state || "unknown",
          nextAction: scheduleCommand.statusPatch?.nextAction || null,
        },
      },
      request: {
        requestId: control.request?.requestId || operation.runtimeClientState?.request?.requestId || null,
        idempotencyKeyPresent: Boolean(control.request?.idempotencyKey || operation.runtimeClientState?.request?.idempotencyKey),
        replayToken: control.request?.replayToken || operation.runtimeClientState?.request?.replayToken || null,
      },
      client: {
        statusPath: control.client?.statusPath || lifecycle.clientState?.statusPath || null,
        progressPath: control.client?.progressPath || lifecycle.clientState?.progressPath || null,
        providerStatusPath: control.client?.providerStatusPath || operation.clientRuntimeAdoption?.client?.providerStatusPath || null,
        boundaryStatusPath: control.client?.boundaryStatusPath || lifecycle.clientState?.boundaryStatusPath || null,
      },
      nextAction: blockedBy.length
        ? lifecycle.nextAction || control.nextAction || "repair_lifecycle_settings"
        : pendingBy.includes("schedule:active")
          ? "wait_for_lifecycle_schedule"
          : pendingBy.length
            ? control.nextAction || lifecycle.nextAction || "wait_for_lifecycle_control_plane"
            : acceptedForProvider
              ? "accept_lifecycle_dispatch_settings"
              : retryCommand.enabled === true
                ? "accept_lifecycle_retry_settings"
                : scheduleCommand.enabled === true
                  ? "accept_lifecycle_schedule_settings"
                  : lifecycle.nextAction || control.nextAction || "observe_lifecycle_settings",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const providerRows = rows.filter((row) => row.acceptedForProvider);
  const operatorRows = rows.filter((row) => row.acceptedForOperator);
  const acceptanceKey = stableId("lifecycle-settings-acceptance", [
    descriptor.id,
    lifecycleControlPlane.controlPlaneId,
    rows.length,
    blockedRows.length,
    pendingRows.length,
    providerRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.lifecycleSettingsAcceptance.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    acceptanceKey,
    controlPlaneId: lifecycleControlPlane.controlPlaneId || null,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : providerRows.length
          ? "provider-accepted"
          : operatorRows.length
            ? "operator-accepted"
            : "observing",
    acceptedForProvider: rows.length > 0 && blockedRows.length === 0 && pendingRows.length === 0 && providerRows.length === rows.length,
    acceptedForOperator: rows.length > 0 && blockedRows.length === 0 && operatorRows.length > 0,
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      providerAccepted: providerRows.length,
      operatorAccepted: operatorRows.length,
      dispatchCommands: rows.filter((row) => row.commandStatus.dispatch.enabled).length,
      retryCommands: rows.filter((row) => row.commandStatus.retry.enabled).length,
      scheduleCommands: rows.filter((row) => row.commandStatus.schedule.enabled).length,
      disabled: rows.filter((row) => row.enabled === false).length,
      operatorVisible: rows.filter((row) => row.operatorVisible).length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    providerAcceptedOperationIds: providerRows.map((row) => row.operationId).sort(),
    operatorAcceptedOperationIds: operatorRows.map((row) => row.operationId).sort(),
    routeContract: {
      settingsPath: `mailchimp.packages.${descriptor.id}.lifecycleSettings`,
      acceptancePath: `mailchimp.packages.${descriptor.id}.lifecycleSettings.acceptance`,
      commandShape: {
        operationId: "string",
        controlId: "string",
        enabledCommands: "string[]",
        statusPath: "string",
        providerStatusPath: "string|null",
        nextAction: "string",
      },
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || (providerRows.length ? "publish_lifecycle_settings_acceptance" : "observe_lifecycle_settings"),
  };
}

function buildOperatorNextActionState(
  descriptor,
  operations,
  lifecycleControlPlane,
  previewAcceptanceSummary,
  routeReadinessSurface,
  operatorHandoffPacket,
  operationalAcceptanceMatrix,
  operatorReleaseDossier,
) {
  const lifecycleByOperation = new Map((lifecycleControlPlane.rows || []).map((row) => [row.operationId, row]));
  const previewByOperation = new Map((previewAcceptanceSummary.rows || []).map((row) => [row.operationId, row]));
  const routeByOperation = new Map((routeReadinessSurface.rows || []).map((row) => [row.operationId, row]));
  const operatorByOperation = new Map((operatorHandoffPacket.rows || []).map((row) => [row.operationId, row]));
  const operationalByOperation = new Map((operationalAcceptanceMatrix.rows || []).map((row) => [row.operationId, row]));
  const dossierByOperation = new Map((operatorReleaseDossier.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const lifecycle = lifecycleByOperation.get(operation.id) || {};
    const preview = previewByOperation.get(operation.id) || {};
    const route = routeByOperation.get(operation.id) || {};
    const operator = operatorByOperation.get(operation.id) || {};
    const operational = operationalByOperation.get(operation.id) || {};
    const dossier = dossierByOperation.get(operation.id) || {};
    const dispatchCommand = (lifecycle.commands || []).find((command) => command.command === "dispatch") || {};
    const retryCommand = (lifecycle.commands || []).find((command) => command.command === "retry") || {};
    const scheduleCommand = (lifecycle.commands || []).find((command) => command.command === "schedule") || {};
    const blockedBy = [
      ...(lifecycle.status === "blocked" ? (lifecycle.blockedBy || ["lifecycle"]).map((item) => `lifecycle:${item}`) : []),
      ...(preview.status === "blocked" ? (preview.blockedBy || ["preview"]).map((item) => `preview:${item}`) : []),
      ...(route.status === "blocked" ? (route.blockedBy || ["route"]).map((item) => `route:${item}`) : []),
      ...(operator.status === "blocked" ? (operator.blockedBy || ["operator"]).map((item) => `operator:${item}`) : []),
      ...(operational.status === "blocked" ? (operational.blockedBy || ["operational"]).map((item) => `operational:${item}`) : []),
      ...(dossier.status === "blocked" ? (dossier.blockedBy || ["release-dossier"]).map((item) => `release:${item}`) : []),
    ].sort();
    const pendingBy = [
      ...(lifecycle.status === "pending" ? (lifecycle.pendingBy || ["lifecycle"]).map((item) => `lifecycle:${item}`) : []),
      ...(preview.status === "pending" ? (preview.pendingBy || ["preview"]).map((item) => `preview:${item}`) : []),
      ...(route.status === "pending" ? (route.pendingBy || ["route"]).map((item) => `route:${item}`) : []),
      ...(operator.status === "pending" ? (operator.pendingBy || ["operator"]).map((item) => `operator:${item}`) : []),
      ...(operational.status === "pending" || operational.status === "retry-scheduled" ? (operational.pendingBy || ["operational"]).map((item) => `operational:${item}`) : []),
      ...(dossier.status === "pending" ? (dossier.pendingBy || ["release-dossier"]).map((item) => `release:${item}`) : []),
    ].sort();
    const acceptedForDispatch = blockedBy.length === 0
      && pendingBy.length === 0
      && dispatchCommand.enabled === true
      && preview.acceptedForApproval !== false
      && route.acceptedForRoute !== false
      && operational.acceptedForProvider !== false
      && dossier.acceptedForApproval !== false;
    const visibleState = blockedBy.length
      ? "Needs repair"
      : pendingBy.length
        ? "Waiting on prerequisites"
        : acceptedForDispatch
          ? "Ready to dispatch"
          : retryCommand.enabled === true
            ? "Ready to retry"
            : scheduleCommand.enabled === true
              ? "Ready to schedule"
              : "Waiting for operator";
    const nextAction = blockedBy.length
      ? route.nextAction || preview.nextAction || operator.nextAction || operational.nextAction || dossier.nextAction || lifecycle.nextAction || "repair_operator_next_action"
      : pendingBy.length
        ? lifecycle.nextAction || preview.nextAction || route.nextAction || operator.nextAction || operational.nextAction || dossier.nextAction || "wait_for_operator_next_action"
        : acceptedForDispatch
          ? dispatchCommand.statusPatch?.nextAction || lifecycle.nextAction || "dispatch_mailchimp_lifecycle_handoff"
          : retryCommand.enabled === true
            ? retryCommand.statusPatch?.nextAction || "retry_mailchimp_lifecycle_handoff"
            : scheduleCommand.enabled === true
              ? scheduleCommand.statusPatch?.nextAction || "schedule_mailchimp_lifecycle_handoff"
              : operator.nextAction || lifecycle.nextAction || "present_operator_next_action";

    return {
      format: "aios.mailchimp.package.operatorNextAction.row.v1",
      index,
      operationId: operation.id,
      actionId: stableId("operator-next-action", [
        descriptor.id,
        operation.id,
        lifecycle.controlId,
        preview.summaryId,
        route.previewDigest,
        operator.packetRowId,
        operational.acceptanceId,
      ]),
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : acceptedForDispatch
            ? "dispatch-ready"
            : retryCommand.enabled === true
              ? "retry-ready"
              : scheduleCommand.enabled === true
                ? "schedule-ready"
                : "operator-review",
      visibleState,
      acceptedForDispatch,
      blockedBy,
      pendingBy,
      requestId: lifecycle.request?.requestId || operator.requestId || route.requestId || null,
      clientStatusPath: lifecycle.client?.statusPath || route.clientStatusPath || operator.clientStatusPath || null,
      providerStatusPath: lifecycle.client?.providerStatusPath || route.providerStatusPath || operator.providerStatusPath || null,
      statusPatch: {
        patchId: dispatchCommand.statusPatch?.patchId || route.statusPatch?.patchId || operator.statusPatch?.patchId || null,
        patchable: dispatchCommand.enabled === true || route.statusPatch?.patchable === true || operator.statusPatch?.patchable === true,
        state: dispatchCommand.statusPatch?.state || route.statusPatch?.state || operator.statusPatch?.state || "unknown",
        visibleState,
        nextAction,
      },
      commands: [
        ...(dispatchCommand.command ? [dispatchCommand] : []),
        ...(retryCommand.command ? [retryCommand] : []),
        ...(scheduleCommand.command ? [scheduleCommand] : []),
      ].map((command) => ({
        command: command.command,
        enabled: command.enabled === true && blockedBy.length === 0,
        patchId: command.statusPatch?.patchId || null,
        nextAction: command.statusPatch?.nextAction || null,
      })),
      linkedContracts: {
        lifecycleControlId: lifecycle.controlId || null,
        previewSummaryId: preview.summaryId || null,
        routePreviewDigest: route.previewDigest || null,
        operatorPacketId: operatorHandoffPacket.packetId || null,
        operationalAcceptanceId: operational.acceptanceId || null,
        releaseDossierId: dossier.dossierId || null,
      },
      nextAction,
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const dispatchRows = rows.filter((row) => row.status === "dispatch-ready");

  return {
    format: "aios.mailchimp.package.operatorNextAction.v1",
    actionKey: stableId("operator-next-action-state", [
      descriptor.id,
      rows.length,
      blockedRows.length,
      pendingRows.length,
      dispatchRows.length,
    ]),
    provider: "mailchimp",
    packageId: descriptor.id,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : dispatchRows.length
          ? "dispatch-ready"
          : "operator-review",
    acceptedForDispatch: rows.length > 0 && blockedRows.length === 0 && pendingRows.length === 0 && dispatchRows.length === rows.length,
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      dispatchReady: dispatchRows.length,
      retryReady: rows.filter((row) => row.status === "retry-ready").length,
      scheduleReady: rows.filter((row) => row.status === "schedule-ready").length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    dispatchOperationIds: dispatchRows.map((row) => row.operationId).sort(),
    routeContract: {
      actionPath: `mailchimp.packages.${descriptor.id}.operatorNextAction`,
      rowShape: {
        operationId: "string",
        status: "blocked|pending|dispatch-ready|retry-ready|schedule-ready|operator-review",
        visibleState: "string",
        nextAction: "string",
        statusPatch: "object",
      },
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || dispatchRows[0]?.nextAction
      || rows[0]?.nextAction
      || "observe_operator_next_action",
  };
}

function buildOperatorAcceptanceCheckpoint(
  descriptor,
  operations,
  previewAcceptanceSummary,
  routeReadinessSurface,
  lifecycleSettingsAcceptance,
  operatorHandoffPacket,
  operationalAcceptanceMatrix,
  operatorNextActionState,
) {
  const previewByOperation = new Map((previewAcceptanceSummary.rows || []).map((row) => [row.operationId, row]));
  const routeByOperation = new Map((routeReadinessSurface.rows || []).map((row) => [row.operationId, row]));
  const lifecycleByOperation = new Map((lifecycleSettingsAcceptance.rows || []).map((row) => [row.operationId, row]));
  const operatorByOperation = new Map((operatorHandoffPacket.rows || []).map((row) => [row.operationId, row]));
  const operationalByOperation = new Map((operationalAcceptanceMatrix.rows || []).map((row) => [row.operationId, row]));
  const actionByOperation = new Map((operatorNextActionState.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const preview = previewByOperation.get(operation.id) || {};
    const route = routeByOperation.get(operation.id) || {};
    const lifecycle = lifecycleByOperation.get(operation.id) || {};
    const operator = operatorByOperation.get(operation.id) || {};
    const operational = operationalByOperation.get(operation.id) || {};
    const action = actionByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const statusPatch = action.statusPatch || route.statusPatch || preview.statusPatch || {};
    const blockedBy = [
      ...(preview.status === "blocked" || preview.acceptedForApproval === false ? ["preview:blocked"] : []),
      ...((preview.blockedBy || []).map((blocker) => `preview:${blocker}`)),
      ...(route.routeState === "blocked" || route.acceptedForRoute === false ? ["route:blocked"] : []),
      ...((route.blockedBy || []).map((blocker) => `route:${blocker}`)),
      ...(lifecycle.status === "blocked" || lifecycle.acceptedForOperator === false ? ["lifecycle-settings:blocked"] : []),
      ...((lifecycle.blockedBy || []).map((blocker) => `lifecycle-settings:${blocker}`)),
      ...(operator.status === "blocked" || operator.acceptedForOperator === false ? ["operator-handoff:blocked"] : []),
      ...((operator.blockedBy || []).map((blocker) => `operator-handoff:${blocker}`)),
      ...(operational.status === "blocked" || operational.acceptedForOwnership === false ? ["operational-acceptance:blocked"] : []),
      ...((operational.blockedBy || []).map((blocker) => `operational-acceptance:${blocker}`)),
      ...(action.status === "blocked" || action.acceptedForDispatch === false && action.status !== "operator-review"
        ? ["next-action:blocked"]
        : []),
      ...((action.blockedBy || []).map((blocker) => `next-action:${blocker}`)),
      ...(!request.requestId ? ["request:requestId"] : []),
      ...(!client.statusPath ? ["client:statusPath"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["request:idempotencyKey"] : []),
    ].sort();
    const pendingBy = [
      ...(preview.status === "pending" ? ["preview:pending"] : []),
      ...((preview.pendingBy || []).map((pending) => `preview:${pending}`)),
      ...(route.routeState === "pending" ? ["route:pending"] : []),
      ...((route.pendingBy || []).map((pending) => `route:${pending}`)),
      ...(lifecycle.status === "pending" ? ["lifecycle-settings:pending"] : []),
      ...((lifecycle.pendingBy || []).map((pending) => `lifecycle-settings:${pending}`)),
      ...(operator.status === "pending" ? ["operator-handoff:pending"] : []),
      ...((operator.pendingBy || []).map((pending) => `operator-handoff:${pending}`)),
      ...(operational.status === "pending" || operational.status === "retry-scheduled" ? [`operational-acceptance:${operational.status}`] : []),
      ...((operational.pendingBy || []).map((pending) => `operational-acceptance:${pending}`)),
      ...(action.status === "pending" ? ["next-action:pending"] : []),
      ...((action.pendingBy || []).map((pending) => `next-action:${pending}`)),
    ].sort();
    const acceptedForOwnership = blockedBy.length === 0
      && pendingBy.length === 0
      && preview.acceptedForApproval !== false
      && route.acceptedForRoute !== false
      && lifecycle.acceptedForOperator !== false
      && operator.acceptedForOperator !== false
      && operational.acceptedForOwnership !== false
      && Boolean(client.statusPath);
    const command = action.status === "dispatch-ready"
      ? "dispatch"
      : action.status === "retry-ready"
        ? "retry"
        : action.status === "schedule-ready"
          ? "schedule"
          : operation.externalWrite
            ? "approve"
            : "handoff";
    const checkpointId = stableId("operator-acceptance-checkpoint", [
      descriptor.id,
      operation.id,
      preview.summaryId,
      route.previewDigest,
      operator.packetRowId,
      operational.acceptanceId,
      action.actionId,
      command,
    ]);

    return {
      format: "aios.mailchimp.package.operatorAcceptanceCheckpoint.row.v1",
      index,
      operationId: operation.id,
      checkpointId,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : acceptedForOwnership
            ? "accepted"
            : "operator-review",
      acceptedForOwnership,
      acceptedForApproval: acceptedForOwnership && operation.externalWrite,
      command,
      visibleState: blockedBy.length
        ? "Acceptance checkpoint needs repair"
        : pendingBy.length
          ? "Acceptance checkpoint is waiting"
          : acceptedForOwnership
            ? "Accepted for ownership handoff"
            : "Waiting for operator review",
      blockedBy,
      pendingBy,
      requestId: request.requestId || null,
      idempotencyKeyPresent: Boolean(request.idempotencyKey),
      clientStatusPath: client.statusPath || null,
      providerStatusPath: route.client?.providerStatusPath || preview.statusPatch?.providerStatusPath || null,
      linkedContracts: {
        previewSummaryId: preview.summaryId || null,
        routePreviewDigest: route.previewDigest || null,
        lifecycleSettingsAcceptanceId: lifecycle.acceptanceId || null,
        operatorPacketRowId: operator.packetRowId || null,
        operationalAcceptanceId: operational.acceptanceId || null,
        operatorNextActionId: action.actionId || null,
      },
      statusPatch: {
        patchId: stableId("operator-acceptance-checkpoint-patch", [
          checkpointId,
          client.statusPath,
          statusPatch.patchId,
        ]),
        patchable: acceptedForOwnership && Boolean(client.statusPath),
        statusPath: client.statusPath || statusPatch.statusPath || null,
        providerStatusPath: route.client?.providerStatusPath || statusPatch.providerStatusPath || null,
        state: acceptedForOwnership ? "operator-acceptance-accepted" : "operator-acceptance-blocked",
        visibleState: acceptedForOwnership ? "accepted_for_ownership_handoff" : "operator_acceptance_needs_attention",
        blockedBy,
        pendingBy,
        fields: acceptedForOwnership
          ? {
            checkpointId,
            operationId: operation.id,
            command,
            requestId: request.requestId || null,
            clientStatusPath: client.statusPath || null,
            providerStatusPath: route.client?.providerStatusPath || null,
          }
          : null,
        nextAction: blockedBy.length
          ? action.nextAction || route.nextAction || preview.nextAction || "repair_operator_acceptance_checkpoint"
          : pendingBy.length
            ? action.nextAction || route.nextAction || preview.nextAction || "wait_for_operator_acceptance_checkpoint"
            : acceptedForOwnership
              ? "publish_operator_acceptance_checkpoint"
              : "present_operator_acceptance_review",
      },
      commands: [
        {
          command: "publish-operator-acceptance-checkpoint",
          enabled: acceptedForOwnership && Boolean(client.statusPath),
          idempotencyKey: `operator-acceptance:${checkpointId}`,
          statusPath: client.statusPath || null,
        },
        {
          command: `${command}-mailchimp-operation`,
          enabled: acceptedForOwnership,
          idempotencyKey: request.idempotencyKey || `operator-command:${checkpointId}`,
          statusPath: client.statusPath || null,
        },
      ],
      nextAction: blockedBy.length
        ? action.nextAction || route.nextAction || preview.nextAction || "repair_operator_acceptance_checkpoint"
        : pendingBy.length
          ? action.nextAction || route.nextAction || preview.nextAction || "wait_for_operator_acceptance_checkpoint"
          : acceptedForOwnership
            ? "publish_operator_acceptance_checkpoint"
            : "present_operator_acceptance_review",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const acceptedRows = rows.filter((row) => row.acceptedForOwnership);
  const checkpointKey = stableId("operator-acceptance-checkpoint", [
    descriptor.id,
    rows.length,
    blockedRows.length,
    pendingRows.length,
    acceptedRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.operatorAcceptanceCheckpoint.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    checkpointKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : acceptedRows.length === rows.length
          ? "accepted"
          : "operator-review",
    acceptedForOwnership: rows.length > 0 && acceptedRows.length === rows.length,
    rows,
    counters: {
      operations: rows.length,
      accepted: acceptedRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      approvalCommands: rows.filter((row) => row.command === "approve").length,
      dispatchCommands: rows.filter((row) => row.command === "dispatch").length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    routeContract: {
      checkpointPath: `mailchimp.packages.${descriptor.id}.operatorAcceptanceCheckpoint`,
      rowShape: {
        operationId: "string",
        checkpointId: "string",
        status: "blocked|pending|accepted|operator-review",
        command: "approve|dispatch|retry|schedule|handoff",
        statusPatch: "object",
        commands: "array",
      },
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || acceptedRows[0]?.nextAction
      || "present_operator_acceptance_review",
  };
}

function buildLifecycleControlPlane(descriptor, operations, acceptancePreview, providerReadinessHandoff, clientHandoffReadiness, externalProviderHandoffLedger) {
  const acceptanceByOperation = new Map((acceptancePreview.rows || []).map((row) => [row.operationId, row]));
  const providerReadinessByOperation = new Map((providerReadinessHandoff.rows || []).map((row) => [row.operationId, row]));
  const clientHandoffByOperation = new Map((clientHandoffReadiness.rows || []).map((row) => [row.operationId, row]));
  const externalHandoffByOperation = new Map((externalProviderHandoffLedger.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const lifecycle = operation.lifecycleVisibility || {};
    const controls = lifecycle.controls || {};
    const acceptance = acceptanceByOperation.get(operation.id) || {};
    const providerReadiness = providerReadinessByOperation.get(operation.id) || {};
    const clientHandoff = clientHandoffByOperation.get(operation.id) || {};
    const externalHandoff = externalHandoffByOperation.get(operation.id) || {};
    const scheduleActive = lifecycle.schedule?.active === true;
    const blockedBy = [
      ...(lifecycle.status === "settings-blocked" ? ["lifecycle:settings-invalid"] : []),
      ...(lifecycle.status === "disabled" ? ["lifecycle:disabled"] : []),
      ...(lifecycle.status === "health-paused" ? ["lifecycle:health-paused"] : []),
      ...(lifecycle.status === "adapter-failed" ? ["adapter:failed"] : []),
      ...(operation.tenantPermissionBoundary?.status !== "ready" ? ["boundary:not-ready"] : []),
      ...(operation.clientHandoffReceipt?.acceptedForHandoff !== true ? ["client-receipt:not-accepted"] : []),
      ...(acceptance.accepted === false ? [`acceptance:${acceptance.readiness || "blocked"}`] : []),
      ...(providerReadiness.status === "blocked" || providerReadiness.acceptedForProvider === false ? ["provider-readiness:blocked"] : []),
      ...(clientHandoff.status === "blocked" || clientHandoff.acceptedForClient === false ? ["client-handoff:blocked"] : []),
      ...(externalHandoff.status === "blocked" || externalHandoff.acceptedForProviderHandoff === false ? ["external-handoff:blocked"] : []),
    ];
    const pendingBy = [
      ...(scheduleActive ? ["lifecycle:schedule-active"] : []),
      ...(providerReadiness.status === "pending" ? ["provider-readiness:pending"] : []),
      ...(clientHandoff.status === "pending" ? ["client-handoff:pending"] : []),
      ...(externalHandoff.status === "pending" ? ["external-handoff:pending"] : []),
      ...(lifecycle.status === "waiting-for-approval" ? ["approval:operator-required"] : []),
    ];
    const blocked = blockedBy.length > 0;
    const pending = !blocked && pendingBy.length > 0;
    const dispatchEnabled = controls.canDispatch === true && !blocked && !pending;
    const status = blocked
      ? "blocked"
      : pending
        ? "pending"
        : dispatchEnabled
          ? "dispatch-ready"
          : controls.canRetry
            ? "retry-ready"
            : lifecycle.enabled === false
              ? "disabled"
              : "observing";

    return {
      index,
      operationId: operation.id,
      controlId: stableId("lifecycle-control", [descriptor.id, operation.id, lifecycle.status, operation.clientHandoffReceipt?.receiptId]),
      status,
      lifecycleStatus: lifecycle.status || "unknown",
      mode: lifecycle.mode || "observe",
      enabled: lifecycle.enabled === true,
      operatorVisible: lifecycle.operatorVisible === true || status !== "dispatch-ready",
      blockedBy,
      pendingBy,
      schedule: lifecycle.schedule || { active: false },
      request: {
        requestId: lifecycle.clientState?.requestId || operation.runtimeClientState?.request?.requestId || null,
        idempotencyKey: operation.runtimeClientState?.request?.idempotencyKey || null,
        replayToken: operation.runtimeClientState?.request?.replayToken || null,
      },
      client: {
        statusPath: lifecycle.clientState?.statusPath || operation.runtimeClientState?.client?.statusPath || null,
        progressPath: lifecycle.clientState?.progressPath || operation.runtimeClientState?.client?.progressPath || null,
        boundaryStatusPath: lifecycle.clientState?.boundaryStatusPath || operation.tenantPermissionBoundary?.handoffStatusPath || null,
        providerStatusPath: operation.clientRuntimeAdoption?.client?.providerStatusPath || null,
        visibleStates: lifecycle.clientState?.visibleStates || operation.runtimeClientState?.client?.visibleStates || [],
      },
      commands: [
        lifecycleControlCommand(operation, lifecycle, "enable", controls.canEnable === true, blockedBy, pendingBy),
        lifecycleControlCommand(operation, lifecycle, "disable", controls.canDisable === true && !blocked, blockedBy, pendingBy),
        lifecycleControlCommand(operation, lifecycle, "schedule", controls.canSchedule === true && !blocked, blockedBy, pendingBy),
        lifecycleControlCommand(operation, lifecycle, "retry", controls.canRetry === true && !blocked, blockedBy, pendingBy),
        lifecycleControlCommand(operation, lifecycle, "dispatch", dispatchEnabled, blockedBy, pendingBy),
      ],
      nextAction: blocked
        ? blockedBy.includes("lifecycle:disabled")
          ? "enable_mailchimp_lifecycle"
          : lifecycle.nextAction || "repair_lifecycle_control_state"
        : pending
          ? lifecycle.nextAction || "wait_for_lifecycle_prerequisites"
          : dispatchEnabled
            ? "dispatch_mailchimp_lifecycle_handoff"
            : lifecycle.nextAction || "observe_lifecycle_control_state",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const dispatchRows = rows.filter((row) => row.status === "dispatch-ready");
  const controlPlaneId = stableId("lifecycle-control-plane", [
    descriptor.id,
    rows.length,
    blockedRows.length,
    pendingRows.length,
    dispatchRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.lifecycleControlPlane.v1",
    controlPlaneId,
    provider: "mailchimp",
    packageId: descriptor.id,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : dispatchRows.length
          ? "dispatch-ready"
          : "observing",
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      dispatchReady: dispatchRows.length,
      retryReady: rows.filter((row) => row.status === "retry-ready").length,
      operatorVisible: rows.filter((row) => row.operatorVisible).length,
      commandCount: rows.flatMap((row) => row.commands).length,
      enabledCommandCount: rows.flatMap((row) => row.commands).filter((command) => command.enabled).length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    dispatchOperationIds: dispatchRows.map((row) => row.operationId).sort(),
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || dispatchRows[0]?.nextAction
      || "observe_lifecycle_control_state",
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

function buildClientHandoffReceipt(operation, runtimeClientState, persistedState, tenantPermissionBoundary, clientRuntimeAdoption, lifecycleVisibility, writesExternalState) {
  const request = runtimeClientState.request;
  const client = runtimeClientState.client;
  const adoption = clientRuntimeAdoption || {};
  const boundary = tenantPermissionBoundary || {};
  const replaySafe = persistedState.idempotentCommand?.safeToReplay === true;
  const requiredFields = {
    requestId: request.requestId,
    statusPath: client.statusPath,
    snapshotKey: persistedState.snapshotKey,
    ledgerKey: persistedState.ledgerKey,
    boundaryKey: boundary.boundaryKey,
    adoptionKey: adoption.adoptionKey,
    providerStatusPath: adoption.client?.providerStatusPath,
    idempotencyKey: writesExternalState ? request.idempotencyKey : "not-required",
  };
  const missingFields = Object.entries(requiredFields)
    .filter(([, value]) => !compactString(value))
    .map(([field]) => field)
    .sort();
  const receiptDigest = stableId("handoff-receipt", [
    operation.descriptorId,
    operation.id,
    request.requestId,
    request.idempotencyKey || "read",
    client.statusPath,
    adoption.client?.providerStatusPath,
    persistedState.snapshotKey,
    persistedState.ledgerKey,
    boundary.boundaryKey,
    adoption.adoptionKey,
    lifecycleVisibility.status,
  ]);
  const state = missingFields.length
    ? "receipt-incomplete"
    : adoption.acceptedForClient !== true
      ? "adoption-blocked"
      : writesExternalState && !replaySafe
        ? "replay-blocked"
        : lifecycleVisibility.status === "waiting-for-approval"
          ? "operator-ack-required"
          : lifecycleVisibility.status === "scheduled"
            ? "scheduled"
            : "receipt-ready";

  return {
    format: "aios.mailchimp.package.clientHandoffReceipt.v1",
    receiptId: receiptDigest,
    operationId: operation.id,
    descriptorId: operation.descriptorId,
    provider: "mailchimp",
    state,
    acceptedForHandoff: state === "receipt-ready" || state === "operator-ack-required" || state === "scheduled",
    externalWrite: writesExternalState,
    missingFields,
    request: {
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      replayToken: request.replayToken || null,
      dedupeScope: request.dedupeScope || null,
    },
    client: {
      statusKey: client.statusKey || null,
      statusPath: client.statusPath || null,
      progressPath: client.progressPath || null,
      providerStatusPath: adoption.client?.providerStatusPath || null,
      visibleState: state === "receipt-ready"
        ? "queued"
        : state === "operator-ack-required"
          ? "waiting_for_approval"
          : state === "scheduled"
            ? "planned"
            : "failed",
    },
    persisted: {
      snapshotKey: persistedState.snapshotKey || null,
      ledgerKey: persistedState.ledgerKey || null,
      checkpointKey: persistedState.checkpointKey || null,
      replaySafe,
      recoveryPath: persistedState.recoveryPath || null,
    },
    boundary: {
      boundaryKey: boundary.boundaryKey || null,
      tenant: boundary.scope?.tenant || null,
      workspace: boundary.scope?.workspace || null,
      statusPath: boundary.handoffStatusPath || null,
      requiresAuditCorrelation: boundary.requiresAuditCorrelation === true,
    },
    adoption: {
      adoptionKey: adoption.adoptionKey || null,
      status: adoption.status || "unknown",
      acceptedForClient: adoption.acceptedForClient === true,
      blockedReason: adoption.blockedReason || "",
      nextAction: adoption.workflow?.nextAction || null,
    },
    validation: {
      digestInputShape: [
        "descriptorId",
        "operationId",
        "requestId",
        "idempotencyKey",
        "statusPath",
        "providerStatusPath",
        "snapshotKey",
        "ledgerKey",
        "boundaryKey",
        "adoptionKey",
        "lifecycleStatus",
      ],
      expectedReceiptId: receiptDigest,
      clientMustEchoReceipt: writesExternalState || lifecycleVisibility.operatorVisible === true,
    },
    nextAction: missingFields.length
      ? "repair_client_handoff_receipt_metadata"
      : state === "adoption-blocked"
        ? adoption.workflow?.nextAction || "repair_client_runtime_adoption_metadata"
        : state === "replay-blocked"
          ? "route_client_handoff_to_operator_review"
          : state === "operator-ack-required"
            ? "present_receipt_for_operator_approval"
            : state === "scheduled"
              ? "wait_for_lifecycle_schedule"
              : "publish_client_handoff_receipt",
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
  const clientHandoffReceipt = buildClientHandoffReceipt(
    operation,
    runtimeClientState,
    persistedState,
    tenantPermissionBoundary,
    clientRuntimeAdoption,
    lifecycleVisibility,
    writesExternalState,
  );
  const boundaryEvidencePacket = buildBoundaryEvidencePacket(
    descriptor,
    operation,
    tenantPermissionBoundary,
    runtimeClientState,
    persistedState,
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
    boundaryEvidencePacket,
    operationalHealth,
    adapterRecovery,
    lifecycleVisibility,
    clientRuntimeAdoption,
    clientHandoffReceipt,
    providerDeliveryAcknowledgement: operation.providerDeliveryAcknowledgement || operation.providerDeliveryAck || {},
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
      clientHandoffReceiptId: clientHandoffReceipt.receiptId,
      clientHandoffReceiptState: clientHandoffReceipt.state,
      boundaryEvidencePacketId: boundaryEvidencePacket.packetId,
      boundaryEvidenceStatus: boundaryEvidencePacket.status,
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
  const receiptBlocked = operations.filter((operation) => (
    operation.clientHandoffReceipt?.acceptedForHandoff !== true
    || operation.clientHandoffReceipt?.missingFields?.length
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
    clientHandoffReceiptBlockedCount: receiptBlocked.length,
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
      : receiptBlocked.length
        ? receiptBlocked[0].clientHandoffReceipt.nextAction
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
      clientHandoffReceipts: operations.map((operation) => ({
        operationId: operation.id,
        receiptId: operation.clientHandoffReceipt?.receiptId || null,
        state: operation.clientHandoffReceipt?.state || "unknown",
        acceptedForHandoff: operation.clientHandoffReceipt?.acceptedForHandoff === true,
        requestId: operation.clientHandoffReceipt?.request?.requestId || null,
        idempotencyKeyPresent: Boolean(operation.clientHandoffReceipt?.request?.idempotencyKey),
        clientStatusPath: operation.clientHandoffReceipt?.client?.statusPath || null,
        providerStatusPath: operation.clientHandoffReceipt?.client?.providerStatusPath || null,
        boundaryKey: operation.clientHandoffReceipt?.boundary?.boundaryKey || null,
        adoptionKey: operation.clientHandoffReceipt?.adoption?.adoptionKey || null,
        missingFields: operation.clientHandoffReceipt?.missingFields || [],
        nextAction: operation.clientHandoffReceipt?.nextAction || "unknown",
      })),
    },
  };
}

function buildTenantBoundaryActionQueue(descriptor, operations, permissionBoundaryHandoff, tenantPermissionEnforcementMatrix, lifecycleControlPlane) {
  const handoffByOperation = new Map((permissionBoundaryHandoff.rows || []).map((row) => [row.operationId, row]));
  const enforcementByOperation = new Map((tenantPermissionEnforcementMatrix.rows || []).map((row) => [row.operationId, row]));
  const releaseByOperation = new Map((tenantPermissionEnforcementMatrix.releaseLedger?.rows || []).map((row) => [row.operationId, row]));
  const lifecycleByOperation = new Map((lifecycleControlPlane.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const boundary = operation.tenantPermissionBoundary || {};
    const evidence = operation.boundaryEvidencePacket || {};
    const handoff = handoffByOperation.get(operation.id) || {};
    const enforcement = enforcementByOperation.get(operation.id) || {};
    const release = enforcement.release || releaseByOperation.get(operation.id) || {};
    const lifecycle = lifecycleByOperation.get(operation.id) || {};
    const statusPatch = handoff.statusPatch || {};
    const evidencePatch = evidence.statusPatch || {};
    const enforcementPatch = enforcement.statusPatch || {};
    const blockedBy = [
      ...(boundary.status !== "ready" ? (boundary.violations || ["boundary-not-ready"]).map((item) => `boundary:${item}`) : []),
      ...(evidence.acceptedForBoundary !== true ? (evidence.missingFields || ["evidence-not-accepted"]).map((item) => `evidence:${item}`) : []),
      ...(evidencePatch.state === "boundary-evidence-blocked" ? (evidencePatch.blockedBy || ["patch"]).map((item) => `evidence-status:${item}`) : []),
      ...(handoff.status === "blocked" ? (handoff.blockedBy || ["handoff"]).map((item) => `handoff:${item}`) : []),
      ...(statusPatch.patchable === false ? (statusPatch.blockedBy || ["patch"]).map((item) => `handoff-status:${item}`) : []),
      ...(enforcement.status === "blocked" ? (enforcement.blockedBy || ["enforcement"]).map((item) => `enforcement:${item}`) : []),
      ...(enforcementPatch.patchable === false ? (enforcementPatch.blockedBy || ["patch"]).map((item) => `enforcement-status:${item}`) : []),
      ...(release.status === "blocked" ? (release.blockedBy || ["release"]).map((item) => `release:${item}`) : []),
      ...(lifecycle.status === "blocked" ? (lifecycle.blockedBy || ["lifecycle"]).map((item) => `lifecycle:${item}`) : []),
    ].sort();
    const pendingBy = [
      ...(handoff.status === "pending" ? (handoff.pendingBy || ["handoff"]).map((item) => `handoff:${item}`) : []),
      ...(evidence.acceptedForBoundary === true && evidencePatch.fields && !(handoff.commands || []).some((command) => (
        command.command === "publish-boundary-evidence-status" && command.enabled === true
      )) ? ["evidence-status:publish-pending"] : []),
      ...(enforcement.status === "pending" ? (enforcement.pendingBy || ["enforcement"]).map((item) => `enforcement:${item}`) : []),
      ...(enforcement.acceptedForHandoff === true && enforcementPatch.patchable === true && !(enforcement.commands || []).some((command) => (
        command.command === "publish-tenant-permission-enforcement" && command.enabled === true
      )) ? ["enforcement-status:publish-pending"] : []),
      ...(release.status === "pending" ? (release.pendingBy || ["release"]).map((item) => `release:${item}`) : []),
      ...(lifecycle.status === "pending" ? (lifecycle.pendingBy || ["lifecycle"]).map((item) => `lifecycle:${item}`) : []),
    ].sort();
    const ready = blockedBy.length === 0
      && pendingBy.length === 0
      && boundary.status === "ready"
      && evidence.acceptedForBoundary === true
      && handoff.acceptedForDispatch !== false
      && enforcement.acceptedForHandoff === true
      && release.ready !== false;
    const queueId = stableId("tenant-boundary-action", [
      descriptor.id,
      operation.id,
      boundary.boundaryKey,
      evidence.packetId,
      blockedBy.join(","),
      pendingBy.join(","),
    ]);
    const action = blockedBy.length
      ? "repair"
      : pendingBy.length
        ? "publish"
        : operation.externalWrite
          ? "lease"
          : "delegate";

    return {
      queueId,
      index,
      operationId: operation.id,
      boundaryKey: boundary.boundaryKey || null,
      status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : "ready",
      action,
      acceptedForRuntime: ready,
      externalWrite: operation.externalWrite === true,
      requestId: operation.runtimeClientState?.request?.requestId || null,
      idempotencyKeyPresent: Boolean(operation.runtimeClientState?.request?.idempotencyKey),
      clientStatusPath: operation.runtimeClientState?.client?.statusPath || null,
      providerStatusPath: handoff.providerStatusPath || enforcement.statusPatch?.providerStatusPath || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      scope: {
        tenant: boundary.scope?.tenant || null,
        workspace: boundary.scope?.workspace || null,
        environment: boundary.scope?.environment || "production",
      },
      roles: {
        allowed: boundary.allowedRoles || [],
        denied: boundary.deniedRoles || [],
        missingRequired: enforcement.roles?.missingRequired || [],
      },
      audit: {
        required: boundary.requiresAuditCorrelation === true,
        channel: boundary.auditChannel || null,
        correlationIdPresent: Boolean(operation.runtimeClientState?.request?.auditCorrelationId || evidence.request?.auditCorrelationId),
      },
      evidence: {
        packetId: evidence.packetId || null,
        status: evidence.status || "unknown",
        acceptedForBoundary: evidence.acceptedForBoundary === true,
        missingFields: evidence.missingFields || [],
        statusPatchId: evidencePatch.patchId || null,
        statusPatchable: Boolean(evidencePatch.fields) && blockedBy.every((item) => !item.startsWith("evidence")),
      },
      enforcement: {
        matrixKey: tenantPermissionEnforcementMatrix.matrixKey || null,
        enforcementId: enforcement.enforcementId || null,
        status: enforcement.status || "unknown",
        acceptedForHandoff: enforcement.acceptedForHandoff === true,
        statusPatchId: enforcementPatch.patchId || null,
        statusPatchable: enforcementPatch.patchable === true && blockedBy.every((item) => !item.startsWith("enforcement")),
      },
      release: {
        ledgerKey: tenantPermissionEnforcementMatrix.releaseLedger?.ledgerKey || null,
        releaseId: release.releaseId || null,
        status: release.status || "unknown",
        ready: release.ready === true,
        mode: release.mode || (operation.externalWrite ? "external-write-lease" : "delegated-read"),
      },
      lifecycle: {
        controlId: lifecycle.controlId || null,
        status: lifecycle.status || "unknown",
        commandEnabled: (lifecycle.commands || []).some((command) => command.enabled === true),
      },
      blockedBy,
      pendingBy,
      commands: [
        {
          command: action === "repair" ? "repair-tenant-boundary" : action === "publish" ? "publish-tenant-boundary-status" : `${action}-tenant-boundary`,
          enabled: blockedBy.length === 0 && Boolean(operation.runtimeClientState?.client?.statusPath),
          idempotencyKey: operation.runtimeClientState?.request?.idempotencyKey || queueId,
          statusPath: operation.runtimeClientState?.client?.statusPath || null,
          boundaryStatusPath: boundary.handoffStatusPath || null,
        },
      ],
      statusPatch: {
        patchId: stableId("tenant-boundary-action-patch", [queueId, action, operation.runtimeClientState?.client?.statusPath]),
        patchable: blockedBy.length === 0 && Boolean(operation.runtimeClientState?.client?.statusPath),
        statusPath: operation.runtimeClientState?.client?.statusPath || null,
        providerStatusPath: handoff.providerStatusPath || enforcement.statusPatch?.providerStatusPath || null,
        state: blockedBy.length ? "tenant-boundary-blocked" : pendingBy.length ? "tenant-boundary-pending" : "tenant-boundary-ready",
        visibleState: blockedBy.length
          ? "Tenant permission boundary needs repair"
          : pendingBy.length
            ? "Tenant permission boundary status pending"
            : "Tenant permission boundary ready",
        blockedBy,
        pendingBy,
        nextAction: blockedBy.length
          ? blockedBy[0].startsWith("evidence:")
            ? evidence.nextAction || "collect_boundary_evidence_fields"
            : blockedBy[0].startsWith("enforcement:")
              ? enforcement.nextAction || "repair_tenant_permission_enforcement"
              : blockedBy[0].startsWith("release:")
                ? release.nextAction || "repair_tenant_permission_release"
                : boundary.statusHandoff?.nextAction || handoff.nextAction || "repair_tenant_permission_boundary"
          : pendingBy.length
            ? pendingBy[0].startsWith("evidence-status:")
              ? "publish_boundary_evidence_status"
              : pendingBy[0].startsWith("enforcement-status:")
                ? "publish_tenant_permission_enforcement_status"
                : release.nextAction || enforcement.nextAction || handoff.nextAction || "publish_tenant_boundary_status"
            : operation.externalWrite
              ? "lease_tenant_boundary_for_external_write"
              : "delegate_tenant_boundary_for_read",
      },
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.acceptedForRuntime);

  return {
    format: "aios.mailchimp.package.tenantBoundaryActionQueue.v1",
    packageId: descriptor.id,
    provider: "mailchimp",
    queueKey: stableId("tenant-boundary-action-queue", [
      descriptor.id,
      rows.length,
      blockedRows.length,
      pendingRows.length,
      readyRows.length,
    ]),
    status: blockedRows.length ? "blocked" : pendingRows.length ? "pending" : "ready",
    acceptedForRuntime: blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.acceptedForRuntime),
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      repairActions: rows.filter((row) => row.action === "repair").length,
      publishActions: rows.filter((row) => row.action === "publish").length,
      leaseActions: rows.filter((row) => row.action === "lease").length,
      delegateActions: rows.filter((row) => row.action === "delegate").length,
      evidenceBlocked: rows.filter((row) => row.blockedBy.some((item) => item.startsWith("evidence:"))).length,
      enforcementBlocked: rows.filter((row) => row.blockedBy.some((item) => item.startsWith("enforcement:"))).length,
      releaseBlocked: rows.filter((row) => row.blockedBy.some((item) => item.startsWith("release:"))).length,
      statusPatchable: rows.filter((row) => row.statusPatch.patchable).length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    commands: rows.flatMap((row) => row.commands),
    nextAction: blockedRows[0]?.statusPatch.nextAction
      || pendingRows[0]?.statusPatch.nextAction
      || "accept_tenant_boundary_action_queue",
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

function buildPreviewAcceptanceSummary(descriptor, operations, acceptancePreview, clientHandoffReadiness, providerReadinessHandoff, routeReadinessSurface, lifecycleSettingsAcceptance, operationalIncidentLedger) {
  const acceptanceByOperation = new Map((acceptancePreview.rows || []).map((row) => [row.operationId, row]));
  const clientHandoffByOperation = new Map((clientHandoffReadiness.rows || []).map((row) => [row.operationId, row]));
  const providerReadinessByOperation = new Map((providerReadinessHandoff.rows || []).map((row) => [row.operationId, row]));
  const routeReadinessByOperation = new Map((routeReadinessSurface.rows || []).map((row) => [row.operationId, row]));
  const lifecycleSettingsByOperation = new Map((lifecycleSettingsAcceptance.rows || []).map((row) => [row.operationId, row]));
  const incidentByOperation = new Map((operationalIncidentLedger.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation) => {
    const acceptance = acceptanceByOperation.get(operation.id) || {};
    const clientHandoff = clientHandoffByOperation.get(operation.id) || {};
    const providerReadiness = providerReadinessByOperation.get(operation.id) || {};
    const routeReadiness = routeReadinessByOperation.get(operation.id) || {};
    const lifecycleSettings = lifecycleSettingsByOperation.get(operation.id) || {};
    const incident = incidentByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const blockedBy = [
      ...(acceptance.accepted === false ? [`acceptance:${acceptance.readiness || "blocked"}`] : []),
      ...((acceptance.validationSummary?.blockingCodes || []).map((code) => `validation:${code}`)),
      ...(clientHandoff.status === "blocked" || clientHandoff.acceptedForClient === false ? ["client-handoff:blocked"] : []),
      ...((clientHandoff.blockedBy || []).map((blocker) => `client-handoff:${blocker}`)),
      ...(providerReadiness.status === "blocked" || providerReadiness.acceptedForProvider === false ? ["provider-readiness:blocked"] : []),
      ...((providerReadiness.blockedBy || []).map((blocker) => `provider-readiness:${blocker}`)),
      ...(routeReadiness.routeState === "blocked" || routeReadiness.acceptedForRoute === false ? ["route-readiness:blocked"] : []),
      ...((routeReadiness.blockedBy || []).map((blocker) => `route-readiness:${blocker}`)),
      ...(lifecycleSettings.status === "blocked" || lifecycleSettings.acceptedForProvider === false && lifecycleSettings.status !== "pending"
        ? ["lifecycle-settings:blocked"]
        : []),
      ...((lifecycleSettings.blockedBy || []).map((blocker) => `lifecycle-settings:${blocker}`)),
      ...(incident.status === "blocked" || incident.acceptedForDispatch === false ? ["operational-incident:blocked"] : []),
      ...((incident.blockedBy || []).map((blocker) => `operational-incident:${blocker}`)),
      ...(!request.requestId ? ["request:request-id-missing"] : []),
      ...(!client.statusPath ? ["client:status-path-missing"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["request:idempotency-key-missing"] : []),
    ].sort();
    const pendingBy = [
      ...(acceptance.readiness === "awaiting-truth-approval" ? ["acceptance:truth-approval"] : []),
      ...(acceptance.readiness === "operator-review" ? ["acceptance:operator-review"] : []),
      ...(clientHandoff.status === "pending" ? ["client-handoff:pending"] : []),
      ...((clientHandoff.pendingBy || []).map((pending) => `client-handoff:${pending}`)),
      ...(providerReadiness.status === "pending" ? ["provider-readiness:pending"] : []),
      ...((providerReadiness.pendingBy || []).map((pending) => `provider-readiness:${pending}`)),
      ...(routeReadiness.routeState === "pending" ? ["route-readiness:pending"] : []),
      ...((routeReadiness.pendingBy || []).map((pending) => `route-readiness:${pending}`)),
      ...(lifecycleSettings.status === "pending" ? ["lifecycle-settings:pending"] : []),
      ...((lifecycleSettings.pendingBy || []).map((pending) => `lifecycle-settings:${pending}`)),
      ...(incident.status === "pending" || incident.status === "degraded" ? [`operational-incident:${incident.status}`] : []),
      ...((incident.pendingBy || []).map((pending) => `operational-incident:${pending}`)),
    ].sort();
    const acceptedForRoute = blockedBy.length === 0
      && routeReadiness.acceptedForRoute !== false
      && acceptance.accepted !== false;
    const acceptedForApproval = acceptedForRoute
      && clientHandoff.acceptedForClient !== false
      && providerReadiness.acceptedForProvider !== false
      && lifecycleSettings.status !== "blocked";
    const readiness = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : operation.externalWrite
          ? "approval-ready"
          : "handoff-ready";
    const statusPatch = {
      patchId: stableId("preview-acceptance-summary-patch", [
        descriptor.id,
        operation.id,
        acceptancePreview.acceptanceKey,
        routeReadiness.previewDigest,
        readiness,
      ]),
      patchable: blockedBy.length === 0 && Boolean(client.statusPath),
      statusPath: client.statusPath || routeReadiness.statusPatch?.statusPath || null,
      progressPath: client.progressPath || null,
      providerStatusPath: providerReadiness.providerStatusPath || clientHandoff.providerStatusPath || routeReadiness.providerStatusPath || null,
      state: blockedBy.length
        ? "preview-acceptance-blocked"
        : pendingBy.length
          ? "preview-acceptance-pending"
          : "preview-acceptance-ready",
      visibleState: blockedBy.length
        ? "Preview acceptance needs repair"
        : pendingBy.length
          ? "Preview acceptance is waiting"
          : operation.externalWrite
            ? "Preview accepted for approval"
            : "Preview accepted for handoff",
      blockedBy,
      pendingBy,
      fields: blockedBy.length
        ? null
        : {
          operationId: operation.id,
          acceptanceKey: acceptancePreview.acceptanceKey,
          previewDigest: routeReadiness.previewDigest || null,
          requestId: request.requestId || null,
          clientStatusPath: client.statusPath || null,
          providerStatusPath: providerReadiness.providerStatusPath || clientHandoff.providerStatusPath || null,
          acceptedForRoute,
          acceptedForApproval,
          readiness,
        },
      nextAction: blockedBy.length
        ? acceptance.nextStep?.action
          || routeReadiness.nextAction
          || clientHandoff.nextAction
          || "repair_preview_acceptance_summary"
        : pendingBy.length
          ? routeReadiness.nextAction
            || clientHandoff.nextAction
            || providerReadiness.nextAction
            || "wait_for_preview_acceptance_prerequisites"
          : operation.externalWrite
            ? "continue_to_approval_preview"
            : "publish_preview_acceptance_status",
    };

    return {
      format: "aios.mailchimp.package.previewAcceptanceSummary.row.v1",
      operationId: operation.id,
      summaryId: stableId("preview-acceptance-summary", [
        descriptor.id,
        operation.id,
        acceptancePreview.acceptanceKey,
        readiness,
        blockedBy.join(","),
        pendingBy.join(","),
      ]),
      readiness,
      acceptedForRoute,
      acceptedForApproval,
      routeVisible: acceptance.routeVisible === true || routeReadiness.routeVisible === true || operation.externalWrite,
      operatorVisible: acceptance.routeVisible === true || operation.externalWrite || readiness !== "handoff-ready",
      externalWrite: operation.externalWrite === true,
      acceptance: {
        acceptanceKey: acceptancePreview.acceptanceKey || null,
        previewId: acceptance.previewId || null,
        readiness: acceptance.readiness || "unknown",
        accepted: acceptance.accepted !== false,
        validationSummary: acceptance.validationSummary || null,
        nextAction: acceptance.nextStep?.action || acceptancePreview.nextAction || null,
      },
      clientHandoff: {
        planKey: clientHandoffReadiness.planKey || null,
        handoffId: clientHandoff.handoffId || null,
        status: clientHandoff.status || "unknown",
        acceptedForClient: clientHandoff.acceptedForClient === true,
        statusPatchId: clientHandoff.statusPatch?.patchId || null,
        commandEnabled: (clientHandoff.commands || []).some((command) => command.enabled === true),
        nextAction: clientHandoff.nextAction || null,
      },
      providerReadiness: {
        handoffKey: providerReadinessHandoff.handoffKey || null,
        readinessId: providerReadiness.readinessId || null,
        status: providerReadiness.status || "unknown",
        acceptedForProvider: providerReadiness.acceptedForProvider === true,
        confirmationRequired: providerReadiness.providerConfirmation?.required === true,
        confirmationAccepted: providerReadiness.providerConfirmation?.accepted === true,
        nextAction: providerReadiness.nextAction || null,
      },
      route: {
        surfaceId: routeReadinessSurface.surfaceId || null,
        previewDigest: routeReadiness.previewDigest || null,
        routeState: routeReadiness.routeState || routeReadiness.status || "unknown",
        acceptedForRoute: routeReadiness.acceptedForRoute === true,
        statusPatchId: routeReadiness.statusPatch?.patchId || null,
        commandCount: (routeReadiness.commands || []).length,
        nextAction: routeReadiness.nextAction || null,
      },
      lifecycleSettings: {
        acceptanceKey: lifecycleSettingsAcceptance.acceptanceKey || null,
        acceptanceId: lifecycleSettings.acceptanceId || null,
        status: lifecycleSettings.status || "unknown",
        acceptedForProvider: lifecycleSettings.acceptedForProvider === true,
        acceptedForOperator: lifecycleSettings.acceptedForOperator === true,
        enabledCommands: lifecycleSettings.enabledCommands || [],
        nextAction: lifecycleSettings.nextAction || null,
      },
      operationalIncident: {
        ledgerKey: operationalIncidentLedger.ledgerKey || null,
        incidentId: incident.incidentId || null,
        status: incident.status || "not-provided",
        severity: incident.severity || "info",
        retryable: incident.retryable === true,
        nextAction: incident.nextAction || null,
      },
      request: {
        requestId: request.requestId || null,
        idempotencyKeyPresent: Boolean(request.idempotencyKey),
        replayToken: request.replayToken || null,
      },
      client: {
        statusPath: client.statusPath || null,
        progressPath: client.progressPath || null,
        providerStatusPath: statusPatch.providerStatusPath,
      },
      blockedBy,
      pendingBy,
      statusPatch,
      commands: [{
        command: "publish-preview-acceptance-summary",
        enabled: statusPatch.patchable && readiness !== "blocked",
        idempotencyKey: request.idempotencyKey || statusPatch.patchId,
        statusPath: statusPatch.statusPath,
        providerStatusPath: statusPatch.providerStatusPath,
        patch: statusPatch.patchable ? statusPatch.fields : null,
      }],
      nextAction: statusPatch.nextAction,
    };
  });
  const blockedRows = rows.filter((row) => row.readiness === "blocked");
  const pendingRows = rows.filter((row) => row.readiness === "pending");
  const approvalRows = rows.filter((row) => row.readiness === "approval-ready");
  const handoffRows = rows.filter((row) => row.readiness === "handoff-ready");
  const summaryKey = stableId("preview-acceptance-summary", [
    descriptor.id,
    acceptancePreview.acceptanceKey,
    routeReadinessSurface.surfaceId,
    rows.length,
    blockedRows.length,
    pendingRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.previewAcceptanceSummary.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    summaryKey,
    acceptanceKey: acceptancePreview.acceptanceKey || null,
    routeSurfaceId: routeReadinessSurface.surfaceId || null,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : approvalRows.length
          ? "approval-ready"
          : "handoff-ready",
    acceptedForRoute: rows.length > 0 && blockedRows.length === 0 && rows.every((row) => row.acceptedForRoute),
    acceptedForApproval: rows.length > 0 && blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.acceptedForApproval),
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      approvalReady: approvalRows.length,
      handoffReady: handoffRows.length,
      routeVisible: rows.filter((row) => row.routeVisible).length,
      operatorVisible: rows.filter((row) => row.operatorVisible).length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      commandEnabled: rows.flatMap((row) => row.commands).filter((command) => command.enabled).length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    readyOperationIds: [...approvalRows, ...handoffRows].map((row) => row.operationId).sort(),
    routeContract: {
      summaryPath: `mailchimp.packages.${descriptor.id}.preview.acceptanceSummary`,
      statusPatchShape: {
        operationId: "string",
        acceptanceKey: "string",
        previewDigest: "string|null",
        readiness: "blocked|pending|approval-ready|handoff-ready",
        acceptedForRoute: "boolean",
        acceptedForApproval: "boolean",
      },
      commandShape: {
        command: "publish-preview-acceptance-summary",
        idempotencyKey: "string",
        statusPath: "string",
        providerStatusPath: "string|null",
      },
    },
    userVisibleSummary: blockedRows.length
      ? `${blockedRows.length} Mailchimp preview operation(s) need repair before route acceptance.`
      : pendingRows.length
        ? `${pendingRows.length} Mailchimp preview operation(s) are waiting on handoff prerequisites.`
        : approvalRows.length
          ? "Mailchimp preview is accepted and ready for approval handoff."
          : "Mailchimp preview is accepted and ready for runtime handoff.",
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || (approvalRows.length ? "continue_to_approval_preview" : "publish_preview_acceptance_summary"),
  };
}

function buildOperatorReleaseDossier(
  descriptor,
  operations,
  previewAcceptanceSummary,
  acceptanceAcknowledgementControl,
  operatorHandoffPacket,
  routeReadinessSurface,
  exportReportingCheckpoint,
  operationalAcceptanceMatrix,
) {
  const previewByOperation = new Map((previewAcceptanceSummary.rows || []).map((row) => [row.operationId, row]));
  const acknowledgementByOperation = new Map((acceptanceAcknowledgementControl.rows || []).map((row) => [row.operationId, row]));
  const operatorPacketByOperation = new Map((operatorHandoffPacket.rows || []).map((row) => [row.operationId, row]));
  const routeByOperation = new Map((routeReadinessSurface.rows || []).map((row) => [row.operationId, row]));
  const reportingByOperation = new Map((exportReportingCheckpoint.rows || []).map((row) => [row.operationId, row]));
  const operationalByOperation = new Map((operationalAcceptanceMatrix.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation) => {
    const preview = previewByOperation.get(operation.id) || {};
    const acknowledgement = acknowledgementByOperation.get(operation.id) || {};
    const operatorPacket = operatorPacketByOperation.get(operation.id) || {};
    const route = routeByOperation.get(operation.id) || {};
    const report = reportingByOperation.get(operation.id) || {};
    const operational = operationalByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const blockedBy = [
      ...(preview.readiness === "blocked" ? (preview.blockedBy || ["preview"]).map((blocker) => `preview:${blocker}`) : []),
      ...(acknowledgement.status === "blocked" ? (acknowledgement.blockedBy || ["acknowledgement"]).map((blocker) => `ack:${blocker}`) : []),
      ...(acknowledgement.required === false && acknowledgement.acceptedForApproval === false ? ["ack:not-accepted"] : []),
      ...(operatorPacket.status === "blocked" ? (operatorPacket.blockedBy || ["operator-packet"]).map((blocker) => `operator:${blocker}`) : []),
      ...(route.routeState === "blocked" || route.acceptedForRoute === false ? (route.blockedBy || ["route"]).map((blocker) => `route:${blocker}`) : []),
      ...(report.status === "blocked" ? (report.blockedBy || ["report"]).map((blocker) => `report:${blocker}`) : []),
      ...(operational.status === "blocked" || operational.acceptedForRuntime === false ? (operational.blockedBy || ["operational"]).map((blocker) => `operational:${blocker}`) : []),
      ...(!request.requestId ? ["request:request-id-missing"] : []),
      ...(!client.statusPath ? ["client:status-path-missing"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["request:idempotency-key-missing"] : []),
    ].sort();
    const pendingBy = [
      ...(preview.readiness === "pending" ? (preview.pendingBy || ["preview"]).map((pending) => `preview:${pending}`) : []),
      ...(acknowledgement.status === "pending" ? (acknowledgement.pendingBy || ["acknowledgement"]).map((pending) => `ack:${pending}`) : []),
      ...(acknowledgement.status === "acknowledgement-required" || acknowledgement.required === true
        ? (acknowledgement.pendingBy || ["operator-acknowledgement"]).map((pending) => `ack:${pending}`)
        : []),
      ...(operatorPacket.status === "pending" ? (operatorPacket.pendingBy || ["operator-packet"]).map((pending) => `operator:${pending}`) : []),
      ...(route.routeState === "pending" ? (route.pendingBy || ["route"]).map((pending) => `route:${pending}`) : []),
      ...(report.status === "pending" ? (report.pendingBy || ["report"]).map((pending) => `report:${pending}`) : []),
      ...(operational.status === "pending" || operational.status === "degraded" ? (operational.pendingBy || [operational.status]).map((pending) => `operational:${pending}`) : []),
    ].sort();
    const readiness = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : operation.externalWrite
          ? "approval-release-ready"
          : "runtime-release-ready";
    const releaseId = stableId("operator-release", [
      descriptor.id,
      operation.id,
      preview.summaryId,
      acknowledgement.acknowledgementId,
      operatorPacket.packetId,
      readiness,
    ]);
    const statusPatch = {
      patchId: stableId("operator-release-patch", [releaseId, client.statusPath, readiness]),
      patchable: blockedBy.length === 0 && Boolean(client.statusPath),
      statusPath: client.statusPath || route.statusPatch?.statusPath || null,
      progressPath: client.progressPath || null,
      providerStatusPath: operatorPacket.providerStatusPath || route.providerStatusPath || report.providerStatusPath || null,
      state: blockedBy.length
        ? "operator-release-blocked"
        : pendingBy.length
          ? "operator-release-pending"
          : "operator-release-ready",
      visibleState: blockedBy.length
        ? "Release needs repair"
        : pendingBy.length
          ? "Release is waiting"
          : operation.externalWrite
            ? "Ready for approval release"
            : "Ready for runtime release",
      blockedBy,
      pendingBy,
      fields: blockedBy.length
        ? null
        : {
          releaseId,
          operationId: operation.id,
          readiness,
          requestId: request.requestId || null,
          clientStatusPath: client.statusPath || null,
          providerStatusPath: operatorPacket.providerStatusPath || route.providerStatusPath || null,
          acceptanceKey: previewAcceptanceSummary.acceptanceKey || null,
          acknowledgementId: acknowledgement.acknowledgementId || null,
          operatorPacketId: operatorPacket.packetId || null,
          exportReportId: report.reportId || null,
        },
      nextAction: blockedBy.length
        ? preview.nextAction
          || acknowledgement.nextAction
          || operatorPacket.nextAction
          || route.nextAction
          || report.nextAction
          || "repair_operator_release_dossier"
        : pendingBy.length
          ? preview.nextAction
            || acknowledgement.nextAction
            || operatorPacket.nextAction
            || report.nextAction
            || "wait_for_operator_release_prerequisites"
          : operation.externalWrite
            ? "present_operator_release_for_approval"
            : "publish_operator_release_for_runtime",
    };

    return {
      format: "aios.mailchimp.package.operatorReleaseDossier.row.v1",
      releaseId,
      operationId: operation.id,
      readiness,
      acceptedForApproval: readiness === "approval-release-ready",
      acceptedForRuntime: readiness === "runtime-release-ready",
      externalWrite: operation.externalWrite === true,
      requestId: request.requestId || null,
      clientStatusPath: client.statusPath || null,
      providerStatusPath: statusPatch.providerStatusPath,
      previewAcceptance: {
        summaryKey: previewAcceptanceSummary.summaryKey || null,
        summaryId: preview.summaryId || null,
        readiness: preview.readiness || "unknown",
        acceptedForApproval: preview.acceptedForApproval === true,
        nextAction: preview.nextAction || null,
      },
      acknowledgement: {
        acknowledgementKey: acceptanceAcknowledgementControl.acknowledgementKey || null,
        acknowledgementId: acknowledgement.acknowledgementId || null,
        status: acknowledgement.status || "unknown",
        acceptedForDispatch: acknowledgement.acceptedForApproval === true,
        commandEnabled: (acknowledgement.commands || []).some((command) => command.enabled === true),
        nextAction: acknowledgement.nextAction || null,
      },
      operatorPacket: {
        packetKey: operatorHandoffPacket.packetKey || null,
        packetId: operatorPacket.packetId || null,
        status: operatorPacket.status || "unknown",
        acceptedForOperator: operatorPacket.acceptedForOperator === true,
        commandEnabled: (operatorPacket.commands || []).some((command) => command.enabled === true),
        nextAction: operatorPacket.nextAction || null,
      },
      route: {
        surfaceId: routeReadinessSurface.surfaceId || null,
        routeId: route.routeId || null,
        status: route.routeState || route.status || "unknown",
        acceptedForRoute: route.acceptedForRoute === true,
        nextAction: route.nextAction || null,
      },
      exportReport: {
        checkpointKey: exportReportingCheckpoint.checkpointKey || null,
        reportId: report.reportId || null,
        status: report.status || "unknown",
        acceptedForDispatch: report.acceptedForDispatch === true || report.acceptedForRoute === true,
        nextAction: report.nextAction || null,
      },
      operationalAcceptance: {
        matrixKey: operationalAcceptanceMatrix.matrixKey || null,
        acceptanceId: operational.acceptanceId || null,
        status: operational.status || "unknown",
        acceptedForRuntime: operational.acceptedForRuntime === true,
        nextAction: operational.nextAction || null,
      },
      blockedBy,
      pendingBy,
      statusPatch,
      commands: [{
        command: operation.externalWrite ? "present-operator-release-approval" : "publish-runtime-release",
        enabled: statusPatch.patchable && pendingBy.length === 0,
        idempotencyKey: request.idempotencyKey || statusPatch.patchId,
        statusPath: statusPatch.statusPath,
        providerStatusPath: statusPatch.providerStatusPath,
        patch: statusPatch.patchable ? statusPatch.fields : null,
      }],
      nextAction: statusPatch.nextAction,
    };
  });
  const blockedRows = rows.filter((row) => row.readiness === "blocked");
  const pendingRows = rows.filter((row) => row.readiness === "pending");
  const approvalRows = rows.filter((row) => row.readiness === "approval-release-ready");
  const runtimeRows = rows.filter((row) => row.readiness === "runtime-release-ready");
  const dossierKey = stableId("operator-release-dossier", [
    descriptor.id,
    previewAcceptanceSummary.summaryKey,
    acceptanceAcknowledgementControl.acknowledgementKey,
    operatorHandoffPacket.packetKey,
    rows.length,
    blockedRows.length,
    pendingRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.operatorReleaseDossier.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    dossierKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : approvalRows.length
          ? "approval-release-ready"
          : "runtime-release-ready",
    acceptedForApproval: rows.length > 0 && blockedRows.length === 0 && pendingRows.length === 0 && approvalRows.length > 0,
    acceptedForRuntime: rows.length > 0 && blockedRows.length === 0 && pendingRows.length === 0 && runtimeRows.length === rows.length,
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      approvalReleaseReady: approvalRows.length,
      runtimeReleaseReady: runtimeRows.length,
      statusPatchable: rows.filter((row) => row.statusPatch.patchable).length,
      commandEnabled: rows.flatMap((row) => row.commands).filter((command) => command.enabled).length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    releaseOperationIds: [...approvalRows, ...runtimeRows].map((row) => row.operationId).sort(),
    exportSummary: {
      releaseReadyCount: approvalRows.length + runtimeRows.length,
      statusPatchableCount: rows.filter((row) => row.statusPatch.patchable).length,
      commandEnabledCount: rows.flatMap((row) => row.commands).filter((command) => command.enabled).length,
      nextExportPath: `mailchimp.packages.${descriptor.id}.operatorRelease`,
    },
    routeContract: {
      dossierPath: `mailchimp.packages.${descriptor.id}.operatorReleaseDossier`,
      rowShape: {
        releaseId: "string",
        operationId: "string",
        readiness: "blocked|pending|approval-release-ready|runtime-release-ready",
        requestId: "string|null",
        clientStatusPath: "string|null",
        providerStatusPath: "string|null",
        statusPatch: "object",
        commands: "array",
      },
    },
    userVisibleSummary: blockedRows.length
      ? `${blockedRows.length} Mailchimp release operation(s) need repair before approval.`
      : pendingRows.length
        ? `${pendingRows.length} Mailchimp release operation(s) are waiting on package prerequisites.`
        : approvalRows.length
          ? "Mailchimp release dossier is ready for operator approval."
          : "Mailchimp release dossier is ready for runtime handoff.",
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || (approvalRows.length ? "present_operator_release_for_approval" : "publish_operator_release_for_runtime"),
  };
}

function buildAcceptanceAcknowledgementControl(descriptor, operations, acceptancePreview) {
  const acceptanceByOperation = new Map((acceptancePreview.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation) => {
    const acceptance = acceptanceByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const operatorVisible = acceptance.routeVisible === true
      || acceptance.nextStep?.operatorVisible === true
      || operation.externalWrite === true;
    const acknowledgementRequired = operatorVisible
      || acceptance.readiness === "operator-review"
      || acceptance.readiness === "adapter-degraded"
      || operation.externalWrite === true;
    const blockedBy = [
      ...(!acceptance.operationId ? ["acceptance-row-missing"] : []),
      ...(acceptance.accepted === false ? [`acceptance:${acceptance.readiness || "blocked"}`] : []),
      ...(!request.requestId ? ["request-id-missing"] : []),
      ...(!client.statusPath ? ["client-status-path-missing"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["idempotency-key-missing"] : []),
      ...(boundary.status !== "ready" ? [`boundary:${boundary.status || "blocked"}`] : []),
    ].sort();
    const pendingBy = [
      ...(acceptance.readiness === "operator-review" ? ["operator-review"] : []),
      ...(acceptance.readiness === "adapter-degraded" ? ["adapter-degraded"] : []),
      ...(acknowledgementRequired ? ["operator-acknowledgement"] : []),
    ].sort();
    const acknowledgementId = stableId("acceptance-ack", [
      descriptor.id,
      operation.id,
      acceptancePreview.acceptanceKey,
      acceptance.readiness,
      request.requestId,
      client.statusPath,
    ]);
    const commandEnabled = blockedBy.length === 0
      && acknowledgementRequired
      && Boolean(client.statusPath)
      && Boolean(request.requestId);
    const statusPatch = {
      patchId: stableId("acceptance-ack-patch", [acknowledgementId, client.statusPath, acceptance.readiness]),
      statusPath: client.statusPath || null,
      progressPath: client.progressPath || null,
      providerStatusPath: acceptance.nextStep?.providerStatusPath || operation.providerStatusPath || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      state: blockedBy.length
        ? "acceptance-ack-blocked"
        : acknowledgementRequired
          ? "acceptance-ack-required"
          : "acceptance-ack-not-required",
      visibleState: blockedBy.length
        ? "Package preview needs repair"
        : acknowledgementRequired
          ? "Package preview ready for operator acknowledgement"
          : "Package preview accepted",
      patchable: blockedBy.length === 0 && Boolean(client.statusPath),
      blockedBy,
      pendingBy,
      fields: blockedBy.length
        ? null
        : {
          acknowledgementId,
          acceptanceKey: acceptancePreview.acceptanceKey,
          operationId: operation.id,
          requestId: request.requestId || null,
          idempotencyKey: request.idempotencyKey || null,
          readiness: acceptance.readiness || "unknown",
          boundaryKey: boundary.boundaryKey || null,
          accepted: acceptance.accepted !== false,
        },
      nextAction: blockedBy.length
        ? acceptance.nextStep?.action || "repair_package_acceptance_preview"
        : acknowledgementRequired
          ? "collect_operator_acceptance_acknowledgement"
          : "publish_acceptance_acknowledgement_status",
    };

    return {
      format: "aios.mailchimp.package.acceptanceAcknowledgement.row.v1",
      acknowledgementId,
      operationId: operation.id,
      acceptanceKey: acceptancePreview.acceptanceKey || null,
      required: acknowledgementRequired,
      acceptedForApproval: blockedBy.length === 0 && (!acknowledgementRequired || commandEnabled),
      status: blockedBy.length
        ? "blocked"
        : acknowledgementRequired
          ? "acknowledgement-required"
          : "accepted",
      readiness: acceptance.readiness || "unknown",
      operatorVisible,
      routeVisible: acceptance.routeVisible === true,
      externalWrite: operation.externalWrite === true,
      blockedBy,
      pendingBy,
      request: {
        requestId: request.requestId || null,
        idempotencyKey: request.idempotencyKey || null,
        replayToken: request.replayToken || null,
      },
      client: {
        statusPath: client.statusPath || null,
        progressPath: client.progressPath || null,
        providerStatusPath: statusPatch.providerStatusPath,
        boundaryStatusPath: statusPatch.boundaryStatusPath,
      },
      statusPatch,
      commands: [{
        command: "acknowledge-package-acceptance-preview",
        enabled: commandEnabled,
        idempotencyKey: request.idempotencyKey || acknowledgementId,
        statusPath: client.statusPath || null,
        providerStatusPath: statusPatch.providerStatusPath,
        patch: statusPatch.patchable ? statusPatch : null,
      }],
      nextAction: statusPatch.nextAction,
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const requiredRows = rows.filter((row) => row.required);
  const acceptedRows = rows.filter((row) => row.acceptedForApproval);
  const acknowledgementKey = stableId("acceptance-acknowledgements", [
    descriptor.id,
    acceptancePreview.acceptanceKey,
    rows.length,
    blockedRows.length,
    requiredRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.acceptanceAcknowledgementControl.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    acknowledgementKey,
    acceptanceKey: acceptancePreview.acceptanceKey || null,
    status: blockedRows.length
      ? "blocked"
      : requiredRows.length
        ? "acknowledgement-required"
        : "accepted",
    acceptedForApproval: rows.length > 0 && blockedRows.length === 0 && acceptedRows.length === rows.length,
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      required: requiredRows.length,
      acceptedForApproval: acceptedRows.length,
      commandEnabled: rows.flatMap((row) => row.commands).filter((command) => command.enabled).length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      operatorVisible: rows.filter((row) => row.operatorVisible).length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    requiredOperationIds: requiredRows.map((row) => row.operationId).sort(),
    routeContract: {
      acknowledgementPath: `mailchimp.packages.${descriptor.id}.acceptance.acknowledgements`,
      statusPatchShape: {
        acknowledgementId: "string",
        acceptanceKey: "string",
        operationId: "string",
        requestId: "string|null",
        readiness: "string",
        statusPath: "string",
        state: "string",
      },
      commandShape: {
        command: "acknowledge-package-acceptance-preview",
        idempotencyKey: "string",
        statusPath: "string",
        providerStatusPath: "string|null",
      },
    },
    nextAction: blockedRows[0]?.nextAction
      || (requiredRows.length
        ? "present_package_acceptance_acknowledgements"
        : "publish_acceptance_acknowledgement_status"),
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
    const providerStatusPath = adoption.client?.providerStatusPath
      || checkpoint.providerStatusPath
      || transition.providerStatusPath
      || null;
    const statusPatchBlockedBy = [
      ...(!client.statusPath ? ["client:status-path-missing"] : []),
      ...(!request.requestId ? ["request:request-id-missing"] : []),
      ...(operation.externalWrite && !providerStatusPath ? ["provider:status-path-missing"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["request:idempotency-key-missing"] : []),
      ...(blockedBy.length ? ["restart-journal:blocked"] : []),
      ...(status === "operator-review" ? ["restart-journal:operator-review"] : []),
      ...(transition.replaySafe === false ? ["client-transition:not-replay-safe"] : []),
      ...(checkpoint.replaySafe === false ? ["checkpoint:not-replay-safe"] : []),
    ].sort();
    const statusPatchId = stableId("restart-status-patch", [
      descriptor.id,
      operation.id,
      journalEntryId,
      client.statusPath,
      providerStatusPath,
      status,
    ]);
    const statusPatch = {
      format: "aios.mailchimp.package.restartStatusPatch.v1",
      patchId: statusPatchId,
      patchable: statusPatchBlockedBy.length === 0,
      statusPath: client.statusPath || null,
      providerStatusPath,
      state: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "recovery_pending"
          : restartSafe
            ? "restart_safe"
            : "operator_review",
      visibleState: blockedBy.length
        ? "failed"
        : pendingBy.length
          ? "running"
          : restartSafe
            ? "queued"
            : "waiting_for_approval",
      blockedBy: statusPatchBlockedBy,
      fields: statusPatchBlockedBy.length
        ? null
        : {
          provider: "mailchimp",
          packageId: descriptor.id,
          operationId: operation.id,
          requestId: request.requestId || null,
          restartJournalEntryId: journalEntryId,
          restartSafe,
          restartStatus: status,
          recoveryPath: persisted.recoveryPath || "unknown",
          snapshotKey: persisted.snapshotKey || null,
          ledgerKey: persisted.ledgerKey || null,
          boundaryKey: boundary.boundaryKey || null,
          providerStatusPath,
          retryable: adapter.retryable === true,
          degradedMode: adapter.degradedMode === true,
        },
      nextAction: statusPatchBlockedBy.length
        ? statusPatchBlockedBy[0].startsWith("client:")
          ? "repair_client_runtime_state"
          : statusPatchBlockedBy[0].startsWith("request:")
            ? "repair_runtime_request_state"
            : statusPatchBlockedBy[0].startsWith("provider:")
              ? "repair_provider_status_path"
              : statusPatchBlockedBy[0].startsWith("client-transition:")
                ? transition.nextAction || "repair_client_status_transition"
                : statusPatchBlockedBy[0].startsWith("checkpoint:")
                  ? checkpoint.nextAction || "repair_adapter_recovery_checkpoint"
                  : "repair_restart_status_patch"
        : "publish_restart_status_patch",
    };
    const observedRestartStatus = operation.restartStatusObservation
      || operation.recoveryStatusObservation
      || persisted.observedRestartStatus
      || persisted.statusObservation
      || {};
    const observedState = compactString(
      observedRestartStatus.state
        || observedRestartStatus.status
        || observedRestartStatus.visibleState,
    );
    const observedTerminal = ["completed", "failed", "canceled", "cancelled"].includes(observedState);
    const observedPatchId = compactString(observedRestartStatus.patchId || observedRestartStatus.restartStatusPatchId);
    const observedJournalEntryId = compactString(observedRestartStatus.journalEntryId || observedRestartStatus.restartJournalEntryId);
    const observedRequestId = compactString(observedRestartStatus.requestId);
    const observedStatusPath = compactString(observedRestartStatus.statusPath || observedRestartStatus.clientStatusPath);
    const observedProviderStatusPath = compactString(observedRestartStatus.providerStatusPath);
    const observedSnapshotKey = compactString(observedRestartStatus.snapshotKey);
    const observedLedgerKey = compactString(observedRestartStatus.ledgerKey);
    const statusResolutionBlockedBy = [
      ...(observedPatchId && observedPatchId !== statusPatch.patchId ? ["observed-status:patch-id-mismatch"] : []),
      ...(observedJournalEntryId && observedJournalEntryId !== journalEntryId ? ["observed-status:journal-entry-mismatch"] : []),
      ...(observedRequestId && observedRequestId !== request.requestId ? ["observed-status:request-id-mismatch"] : []),
      ...(observedStatusPath && observedStatusPath !== client.statusPath ? ["observed-status:status-path-mismatch"] : []),
      ...(observedProviderStatusPath && providerStatusPath && observedProviderStatusPath !== providerStatusPath
        ? ["observed-status:provider-status-path-mismatch"]
        : []),
      ...(observedSnapshotKey && observedSnapshotKey !== persisted.snapshotKey ? ["observed-status:snapshot-key-mismatch"] : []),
      ...(observedLedgerKey && observedLedgerKey !== persisted.ledgerKey ? ["observed-status:ledger-key-mismatch"] : []),
      ...(observedTerminal && observedState !== "completed" ? [`observed-status:terminal-${observedState}`] : []),
      ...(observedTerminal && operation.externalWrite && !observedProviderStatusPath ? ["observed-status:provider-terminal-missing"] : []),
      ...(statusPatch.patchable === false ? ["restart-status:patch-not-ready"] : []),
    ].sort();
    const statusResolutionPendingBy = [
      ...(!observedState ? ["observed-status:missing"] : []),
      ...(observedState === "running" || observedState === "queued" ? ["observed-status:in-flight"] : []),
      ...(observedState === "recovery_pending" ? ["observed-status:recovery-pending"] : []),
      ...(pendingBy.length ? pendingBy.map((pending) => `restart-journal:${pending}`) : []),
    ].sort();
    const resumeAllowed = restartSafe
      && statusResolutionBlockedBy.length === 0
      && !observedTerminal
      && status !== "blocked"
      && status !== "operator-review";
    const statusResolution = {
      format: "aios.mailchimp.package.restartStatusResolution.v1",
      resolutionId: stableId("restart-resolution", [
        descriptor.id,
        operation.id,
        journalEntryId,
        statusPatch.patchId,
        observedState || "unobserved",
        statusResolutionBlockedBy.join(","),
      ]),
      operationId: operation.id,
      journalEntryId,
      patchId: statusPatch.patchId,
      observed: {
        present: Boolean(observedState || observedPatchId || observedJournalEntryId),
        state: observedState || null,
        visibleState: observedRestartStatus.visibleState || null,
        patchId: observedPatchId || null,
        journalEntryId: observedJournalEntryId || null,
        requestId: observedRequestId || null,
        statusPath: observedStatusPath || null,
        providerStatusPath: observedProviderStatusPath || null,
        snapshotKey: observedSnapshotKey || null,
        ledgerKey: observedLedgerKey || null,
        appliedAt: compactString(observedRestartStatus.appliedAt || observedRestartStatus.updatedAt) || null,
      },
      expected: {
        state: statusPatch.state,
        visibleState: statusPatch.visibleState,
        patchId: statusPatch.patchId,
        journalEntryId,
        requestId: request.requestId || null,
        statusPath: client.statusPath || null,
        providerStatusPath,
        snapshotKey: persisted.snapshotKey || null,
        ledgerKey: persisted.ledgerKey || null,
      },
      status: statusResolutionBlockedBy.length
        ? "blocked"
        : observedTerminal
          ? "terminal-observed"
          : statusResolutionPendingBy.length
            ? "pending"
            : resumeAllowed
              ? "resume-ready"
              : "operator-review",
      restartSafe: resumeAllowed,
      terminalState: observedTerminal ? observedState : null,
      blockedBy: statusResolutionBlockedBy,
      pendingBy: statusResolutionPendingBy,
      command: {
        command: observedTerminal ? "record-terminal-restart-status" : "resolve-restart-status",
        enabled: statusResolutionBlockedBy.length === 0 && statusPatch.patchable === true,
        idempotencyKey: `restart-resolution:${statusPatch.patchId}:${observedState || "unobserved"}`,
        statusPath: client.statusPath || null,
        providerStatusPath,
      },
      nextAction: statusResolutionBlockedBy.length
        ? statusResolutionBlockedBy[0].startsWith("observed-status:")
          ? "refresh_observed_restart_status"
          : statusPatch.nextAction || "repair_restart_status_patch"
        : observedTerminal
          ? "persist_terminal_restart_resolution"
          : statusResolutionPendingBy.length
            ? "wait_for_restart_status_resolution"
            : resumeAllowed
              ? "resume_after_restart_status_resolution"
              : "route_restart_resolution_to_operator_review",
    };
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
      providerStatusPath,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      snapshotKey: persisted.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || null,
      checkpointKey: persisted.checkpointKey || operation.checkpointKey || null,
      transitionToken: transition.transitionToken || null,
      adapterCheckpointId: checkpoint.checkpointId || null,
      adoptionKey: adoption.adoptionKey || null,
      blockedBy,
      pendingBy,
      statusPatch,
      statusResolution,
      command: {
        command: operation.externalWrite ? "persist-external-write-restart-journal" : "persist-read-restart-journal",
        enabled: commandEnabled,
        idempotencyKey: request.idempotencyKey || `restart-journal:${journalEntryId}`,
        replayToken: request.replayToken || null,
        statusPath: client.statusPath || null,
      },
      statusCommand: {
        command: "publish-restart-status-patch",
        enabled: statusPatch.patchable,
        idempotencyKey: `restart-status:${statusPatch.patchId}`,
        statusPath: client.statusPath || null,
        providerStatusPath,
        patch: statusPatch.patchable ? statusPatch.fields : null,
      },
      resumeEnvelope: {
        provider: "mailchimp",
        operationId: operation.id,
        requestId: request.requestId || null,
        statusPath: client.statusPath || null,
        providerStatusPath,
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
  const patchableRows = rows.filter((row) => row.statusPatch.patchable);
  const statusPatchBlockedRows = rows.filter((row) => !row.statusPatch.patchable);
  const resolutionRows = rows.map((row) => row.statusResolution);
  const resolutionBlockedRows = rows.filter((row) => row.statusResolution.status === "blocked");
  const resolutionPendingRows = rows.filter((row) => row.statusResolution.status === "pending");
  const terminalResolutionRows = rows.filter((row) => row.statusResolution.status === "terminal-observed");
  const resumeResolutionRows = rows.filter((row) => row.statusResolution.status === "resume-ready");
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
      statusPatchable: patchableRows.length,
      statusPatchBlocked: statusPatchBlockedRows.length,
      resolutionReady: resumeResolutionRows.length,
      resolutionBlocked: resolutionBlockedRows.length,
      resolutionPending: resolutionPendingRows.length,
      terminalObserved: terminalResolutionRows.length,
      observedStatus: rows.filter((row) => row.statusResolution.observed.present).length,
      resolutionCommandEnabled: rows.filter((row) => row.statusResolution.command.enabled).length,
      exportable: analytics.counters.exportableOperationCount,
    },
    commands: rows.map((row) => row.command),
    statusCommands: rows.map((row) => row.statusCommand),
    statusPatches: rows.map((row) => row.statusPatch),
    statusResolutions: resolutionRows,
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    restartSafeOperationIds: restartSafeRows.map((row) => row.operationId).sort(),
    statusPatchBlockedOperationIds: statusPatchBlockedRows.map((row) => row.operationId).sort(),
    statusResolutionBlockedOperationIds: resolutionBlockedRows.map((row) => row.operationId).sort(),
    statusResolutionPendingOperationIds: resolutionPendingRows.map((row) => row.operationId).sort(),
    terminalObservedOperationIds: terminalResolutionRows.map((row) => row.operationId).sort(),
    stateKeys: {
      journalPath: `mailchimp.packages.${descriptor.id}.restartJournal`,
      operationPathTemplate: `mailchimp.packages.${descriptor.id}.restartJournal.operations.{operationId}`,
      statusPathTemplate: "mailchimp.operations.{operationId}.status",
    },
    nextAction: blockedRows[0]?.nextAction
      || resolutionBlockedRows[0]?.statusResolution?.nextAction
      || pendingRows[0]?.nextAction
      || resolutionPendingRows[0]?.statusResolution?.nextAction
      || (operatorReviewRows.length
        ? "route_restart_journal_to_operator_review"
        : "publish_restart_journal"),
  };
}

function buildPackagePermissionBoundaryHandoffPlan(descriptor, operations, providerNegotiation, acceptancePreview, clientStatusTransitionPlan, adapterRecoveryCheckpointPlan, restartJournal) {
  const providerByOperation = new Map((providerNegotiation.rows || []).map((row) => [row.operationId, row]));
  const acceptanceByOperation = new Map((acceptancePreview.rows || []).map((row) => [row.operationId, row]));
  const transitionByOperation = new Map((clientStatusTransitionPlan.rows || []).map((row) => [row.operationId, row]));
  const checkpointByOperation = new Map((adapterRecoveryCheckpointPlan.rows || []).map((row) => [row.operationId, row]));
  const journalByOperation = new Map((restartJournal.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const providerRow = providerByOperation.get(operation.id) || {};
    const acceptanceRow = acceptanceByOperation.get(operation.id) || {};
    const transitionRow = transitionByOperation.get(operation.id) || {};
    const checkpointRow = checkpointByOperation.get(operation.id) || {};
    const journalRow = journalByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const persisted = operation.persistedState || {};
    const externalCapabilities = providerRow.externalCapabilities || [];
    const delegatedCapabilities = providerRow.delegatedCapabilities || [];
    const requiredRoles = [...new Set([
      ...(boundary.allowedRoles || []),
      ...(operation.externalWrite ? ["operator"] : []),
    ])].sort();
    const blockedBy = [
      ...(!request.requestId ? ["request:request-id-missing"] : []),
      ...(!client.statusPath ? ["client:status-path-missing"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["request:idempotency-key-missing"] : []),
      ...(boundary.status !== "ready" ? [`boundary:${boundary.status || "blocked"}`] : []),
      ...(acceptanceRow.accepted === false ? [`acceptance:${acceptanceRow.readiness || "blocked"}`] : []),
      ...(transitionRow.status === "blocked" ? [`client-transition:${transitionRow.blockedReason || "blocked"}`] : []),
      ...(checkpointRow.status === "blocked" ? checkpointRow.blockedBy.map((blocker) => `checkpoint:${blocker}`) : []),
      ...(journalRow.status === "blocked" ? journalRow.blockedBy.map((blocker) => `restart-journal:${blocker}`) : []),
      ...(operation.externalWrite && !providerRow.providerStatusPath ? ["provider:status-path-missing"] : []),
      ...(operation.externalWrite && boundary.requiresAuditCorrelation && !boundary.auditChannel ? ["audit:channel-missing"] : []),
    ].sort();
    const pendingBy = [
      ...(transitionRow.status === "retry-scheduled" ? ["client-transition:retry-scheduled"] : []),
      ...(checkpointRow.status === "pending" ? checkpointRow.pendingBy.map((pending) => `checkpoint:${pending}`) : []),
      ...(journalRow.status === "pending" ? journalRow.pendingBy.map((pending) => `restart-journal:${pending}`) : []),
      ...(operation.lifecycleVisibility?.status === "scheduled" ? ["lifecycle:scheduled"] : []),
      ...(operation.lifecycleVisibility?.status === "waiting-for-approval" ? ["approval:operator-required"] : []),
    ].sort();
    const packetId = stableId("permission-handoff", [
      descriptor.id,
      operation.id,
      boundary.boundaryKey,
      request.requestId,
      providerRow.providerStatusPath,
      blockedBy.join(","),
      pendingBy.join(","),
    ]);
    const statusPatchBlockedBy = [
      ...(!client.statusPath ? ["client:status-path-missing"] : []),
      ...(operation.externalWrite && !providerRow.providerStatusPath ? ["provider:status-path-missing"] : []),
      ...(blockedBy.length ? ["permission-handoff:blocked"] : []),
      ...(journalRow.status === "operator-review" ? ["restart-journal:operator-review"] : []),
    ].sort();
    const statusPatch = {
      format: "aios.mailchimp.package.permissionBoundaryStatusPatch.v1",
      patchId: stableId("permission-handoff-status", [
        descriptor.id,
        operation.id,
        packetId,
        client.statusPath,
        providerRow.providerStatusPath,
      ]),
      patchable: statusPatchBlockedBy.length === 0,
      statusPath: client.statusPath || null,
      providerStatusPath: providerRow.providerStatusPath || null,
      state: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "permission_pending"
          : operation.externalWrite
            ? "external_write_permission_ready"
            : "delegated_permission_ready",
      visibleState: blockedBy.length
        ? "failed"
        : pendingBy.length
          ? "running"
          : operation.externalWrite
            ? "waiting_for_approval"
            : "queued",
      blockedBy: statusPatchBlockedBy,
      fields: statusPatchBlockedBy.length
        ? null
        : {
          provider: "mailchimp",
          packageId: descriptor.id,
          operationId: operation.id,
          requestId: request.requestId || null,
          permissionPacketId: packetId,
          boundaryKey: boundary.boundaryKey || null,
          tenant: boundary.scope?.tenant || null,
          workspace: boundary.scope?.workspace || null,
          requiredRoles,
          providerStatusPath: providerRow.providerStatusPath || null,
          restartJournalEntryId: journalRow.journalEntryId || null,
        },
      nextAction: statusPatchBlockedBy.length
        ? statusPatchBlockedBy[0].startsWith("client:")
          ? "repair_client_runtime_state"
          : statusPatchBlockedBy[0].startsWith("provider:")
            ? "repair_provider_status_path"
            : statusPatchBlockedBy[0].startsWith("restart-journal:")
              ? journalRow.nextAction || restartJournal.nextAction || "repair_restart_journal"
              : "repair_permission_boundary_handoff"
        : "publish_permission_boundary_status",
    };
    const status = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : operation.externalWrite
          ? "external-write-ready"
          : "delegated-read-ready";

    return {
      index,
      operationId: operation.id,
      packetId,
      status,
      acceptedForDispatch: status !== "blocked" && statusPatch.patchable,
      externalWrite: operation.externalWrite,
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      replayToken: request.replayToken || null,
      clientStatusPath: client.statusPath || null,
      providerStatusPath: providerRow.providerStatusPath || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      boundary: {
        boundaryKey: boundary.boundaryKey || null,
        tenant: boundary.scope?.tenant || null,
        workspace: boundary.scope?.workspace || null,
        environment: boundary.scope?.environment || null,
        status: boundary.status || "unknown",
        requiredRoles,
        deniedRoles: boundary.deniedRoles || [],
        requiresLease: boundary.requiresLease === true,
        requiresAuditCorrelation: boundary.requiresAuditCorrelation === true,
        auditChannel: boundary.auditChannel || null,
      },
      boundaryEvidence: operation.boundaryEvidencePacket || null,
      capabilities: {
        external: externalCapabilities,
        delegated: delegatedCapabilities,
      },
      restartJournalEntryId: journalRow.journalEntryId || null,
      transitionToken: transitionRow.transitionToken || null,
      adapterCheckpointId: checkpointRow.checkpointId || null,
      snapshotKey: persisted.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || null,
      statusPatch,
      blockedBy,
      pendingBy,
      commands: [
        {
          command: "persist-package-permission-boundary",
          enabled: true,
          idempotencyKey: `package-permission:${packetId}`,
          statusPath: client.statusPath || null,
        },
        {
          command: "publish-boundary-evidence-status",
          enabled: operation.boundaryEvidencePacket?.acceptedForBoundary === true,
          idempotencyKey: `boundary-evidence:${operation.boundaryEvidencePacket?.packetId || packetId}`,
          statusPath: operation.boundaryEvidencePacket?.statusPatch?.statusPath || boundary.handoffStatusPath || null,
          patch: operation.boundaryEvidencePacket?.statusPatch?.fields || null,
        },
        {
          command: "publish-package-permission-status",
          enabled: statusPatch.patchable,
          idempotencyKey: `package-permission-status:${statusPatch.patchId}`,
          statusPath: statusPatch.statusPath,
          patch: statusPatch.patchable ? statusPatch.fields : null,
        },
        {
          command: operation.externalWrite ? "release-package-permission-to-approval" : "release-package-permission-to-runtime",
          enabled: status !== "blocked" && statusPatch.patchable,
          idempotencyKey: request.idempotencyKey || `package-permission-release:${packetId}`,
          statusPath: client.statusPath || null,
        },
      ],
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("request:")
          ? "repair_runtime_request_state"
          : blockedBy[0].startsWith("client:")
            ? "repair_client_runtime_state"
            : blockedBy[0].startsWith("boundary:")
              ? boundary.statusHandoff?.nextAction || "repair_tenant_permission_boundary"
              : blockedBy[0].startsWith("acceptance:")
                ? acceptanceRow.nextStep?.action || acceptancePreview.nextAction || "repair_package_acceptance_preview"
                : blockedBy[0].startsWith("client-transition:")
                  ? transitionRow.nextAction || "repair_client_status_transition"
                  : blockedBy[0].startsWith("checkpoint:")
                    ? checkpointRow.nextAction || adapterRecoveryCheckpointPlan.nextAction || "repair_adapter_recovery_checkpoint"
                    : blockedBy[0].startsWith("restart-journal:")
                      ? journalRow.nextAction || restartJournal.nextAction || "repair_restart_journal"
                      : "repair_permission_boundary_handoff"
        : pendingBy.length
          ? pendingBy[0].startsWith("approval:")
            ? "request_operator_approval"
            : statusPatch.nextAction
        : operation.externalWrite
          ? "release_permission_boundary_to_approval"
          : "release_permission_boundary_to_runtime",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.acceptedForDispatch);
  const handoffKey = stableId("permission-handoff-plan", [
    descriptor.id,
    rows.length,
    blockedRows.length,
    pendingRows.length,
    restartJournal.journalId,
  ]);

  return {
    format: "aios.mailchimp.package.permissionBoundaryHandoff.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    handoffKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "ready",
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      statusPatchable: rows.filter((row) => row.statusPatch.patchable).length,
      statusPatchBlocked: rows.filter((row) => !row.statusPatch.patchable).length,
    },
    commands: rows.flatMap((row) => row.commands),
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || "publish_permission_boundary_handoff",
  };
}

function buildTenantPermissionEnforcementMatrix(descriptor, operations, permissionBoundaryHandoff, providerReadinessHandoff = {}) {
  const permissionByOperation = new Map((permissionBoundaryHandoff.rows || []).map((row) => [row.operationId, row]));
  const providerReadinessByOperation = new Map((providerReadinessHandoff.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const permission = permissionByOperation.get(operation.id) || {};
    const providerReadiness = providerReadinessByOperation.get(operation.id) || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const evidence = operation.boundaryEvidencePacket || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const statusPatch = permission.statusPatch || {};
    const boundaryRoleSet = new Set(boundary.allowedRoles || []);
    const requiredRoles = [...new Set([
      ...(permission.boundary?.requiredRoles || []),
      ...(boundary.allowedRoles || []),
      ...(operation.externalWrite ? ["operator"] : ["service"]),
    ])].sort();
    const missingRequiredRoles = requiredRoles.filter((role) => !boundaryRoleSet.has(role)).sort();
    const auditRequired = boundary.requiresAuditCorrelation === true || operation.externalWrite === true;
    const leaseRequired = boundary.requiresLease === true || operation.externalWrite === true;
    const blockedBy = [
      ...(boundary.status !== "ready" ? [`boundary:${boundary.status || "invalid"}`] : []),
      ...(missingRequiredRoles.length ? missingRequiredRoles.map((role) => `role:${role}:not-allowed`) : []),
      ...(!evidence.packetId ? ["evidence:packet-missing"] : []),
      ...(evidence.acceptedForBoundary === false
        ? (evidence.missingFields || ["not-accepted"]).map((field) => `evidence:${field}`)
        : []),
      ...(auditRequired && !boundary.auditChannel ? ["audit:channel-missing"] : []),
      ...(leaseRequired && !request.idempotencyKey ? ["lease:idempotency-key-missing"] : []),
      ...(!client.statusPath ? ["client:status-path-missing"] : []),
      ...(permission.status === "blocked" ? (permission.blockedBy || ["permission:blocked"]).map((blocker) => `permission:${blocker}`) : []),
      ...(statusPatch.patchable === false ? (statusPatch.blockedBy || ["status-patch"]).map((blocker) => `status:${blocker}`) : []),
      ...(providerReadiness.status === "blocked" ? (providerReadiness.blockedBy || ["provider-readiness:blocked"]).map((blocker) => `provider:${blocker}`) : []),
    ].sort();
    const pendingBy = [
      ...(permission.status === "pending" ? (permission.pendingBy || ["permission:pending"]).map((pending) => `permission:${pending}`) : []),
      ...(providerReadiness.status === "pending" ? (providerReadiness.pendingBy || ["provider-readiness:pending"]).map((pending) => `provider:${pending}`) : []),
      ...(operation.lifecycleVisibility?.status === "scheduled" ? ["lifecycle:scheduled"] : []),
      ...(operation.lifecycleVisibility?.status === "waiting-for-approval" ? ["approval:operator-required"] : []),
      ...(evidence.acceptedForBoundary === true
        && evidence.statusPatch?.fields
        && permission.commands?.some((command) => command.command === "publish-boundary-evidence-status" && command.enabled === true) !== true
        ? ["evidence:status-publish-pending"]
        : []),
    ].sort();
    const enforcementId = stableId("tenant-permission-enforcement", [
      descriptor.id,
      operation.id,
      boundary.boundaryKey,
      permission.packetId,
      blockedBy.join(","),
      pendingBy.join(","),
    ]);
    const status = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : operation.externalWrite
          ? "external-write-enforced"
          : "delegated-read-enforced";
    const releaseStatus = blockedBy.length
      ? "hold"
      : pendingBy.length
        ? "awaiting-boundary-publication"
        : operation.externalWrite
          ? "lease-release-ready"
          : "delegation-release-ready";
    const releaseBlockedBy = [
      ...blockedBy,
      ...(operation.externalWrite && !request.idempotencyKey ? ["release:idempotency-key-missing"] : []),
      ...(auditRequired && !boundary.auditChannel ? ["release:audit-channel-missing"] : []),
      ...(!client.statusPath ? ["release:client-status-path-missing"] : []),
      ...(statusPatch.patchable === false
        ? (statusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `release-status:${blocker}`)
        : []),
    ].sort();
    const releasePendingBy = [
      ...pendingBy,
      ...(statusPatch.patchable === true && permission.acceptedForDispatch !== false
        ? ["release-status:publish-pending"]
        : []),
      ...(operation.lifecycleVisibility?.status === "scheduled" ? ["release:lifecycle-window"] : []),
    ].sort();
    const nextAction = blockedBy.length
      ? blockedBy[0].startsWith("boundary:")
        ? boundary.statusHandoff?.nextAction || "repair_tenant_permission_boundary"
        : blockedBy[0].startsWith("evidence:")
          ? evidence.nextAction || "repair_boundary_evidence_packet"
          : blockedBy[0].startsWith("role:")
            ? "repair_permission_boundary_roles"
            : blockedBy[0].startsWith("lease:")
              ? "attach_idempotency_key_for_permission_lease"
              : blockedBy[0].startsWith("status:")
                ? statusPatch.nextAction || "repair_permission_status_patch"
                : permission.nextAction || "repair_permission_boundary_handoff"
      : pendingBy.length
        ? pendingBy[0].startsWith("approval:")
          ? "request_operator_approval"
          : pendingBy[0].startsWith("evidence:")
            ? "publish_boundary_evidence_status"
            : permission.nextAction || "wait_for_permission_boundary_enforcement"
        : operation.externalWrite
          ? "release_enforced_permission_to_approval"
          : "release_enforced_permission_to_runtime";

    return {
      index,
      operationId: operation.id,
      enforcementId,
      status,
      acceptedForHandoff: blockedBy.length === 0 && permission.acceptedForDispatch !== false && statusPatch.patchable !== false,
      externalWrite: operation.externalWrite,
      boundaryKey: boundary.boundaryKey || null,
      packetId: permission.packetId || null,
      evidencePacketId: evidence.packetId || null,
      scope: {
        tenant: boundary.scope?.tenant || null,
        workspace: boundary.scope?.workspace || null,
        environment: boundary.scope?.environment || "production",
      },
      roles: {
        required: requiredRoles,
        allowed: boundary.allowedRoles || [],
        denied: boundary.deniedRoles || [],
        missingRequired: missingRequiredRoles,
      },
      safeguards: {
        leaseRequired,
        auditRequired,
        auditChannel: boundary.auditChannel || null,
        idempotencyKeyPresent: Boolean(request.idempotencyKey),
        clientStatusPath: client.statusPath || null,
        boundaryStatusPath: boundary.handoffStatusPath || null,
        providerStatusPath: permission.providerStatusPath || providerReadiness.providerStatusPath || null,
      },
      statusPatch: {
        patchId: statusPatch.patchId || null,
        patchable: statusPatch.patchable === true && blockedBy.length === 0,
        statusPath: statusPatch.statusPath || client.statusPath || null,
        providerStatusPath: statusPatch.providerStatusPath || permission.providerStatusPath || null,
        state: statusPatch.state || status,
        blockedBy: statusPatch.blockedBy || [],
        nextAction: statusPatch.nextAction || null,
      },
      release: {
        releaseId: stableId("tenant-permission-release", [
          descriptor.id,
          operation.id,
          enforcementId,
          releaseStatus,
          client.statusPath,
        ]),
        status: releaseBlockedBy.length
          ? "blocked"
          : releasePendingBy.length
            ? "pending"
            : releaseStatus,
        ready: releaseBlockedBy.length === 0 && releasePendingBy.length === 0,
        mode: operation.externalWrite ? "external-write-lease" : "delegated-read",
        boundaryKey: boundary.boundaryKey || null,
        requestId: request.requestId || null,
        idempotencyKey: request.idempotencyKey || null,
        auditChannel: boundary.auditChannel || null,
        clientStatusPath: client.statusPath || null,
        providerStatusPath: permission.providerStatusPath || providerReadiness.providerStatusPath || null,
        blockedBy: releaseBlockedBy,
        pendingBy: releasePendingBy,
        statusPatchId: statusPatch.patchId || null,
        nextAction: releaseBlockedBy.length
          ? releaseBlockedBy[0].startsWith("release-status:")
            ? statusPatch.nextAction || "repair_tenant_permission_release_status"
            : nextAction
          : releasePendingBy.length
            ? "publish_tenant_permission_release_status"
            : operation.externalWrite
              ? "release_external_write_lease_to_approval"
              : "release_delegated_read_to_runtime",
      },
      blockedBy,
      pendingBy,
      commands: [
        {
          command: "enforce-tenant-permission-boundary",
          enabled: blockedBy.length === 0,
          idempotencyKey: `tenant-permission:${enforcementId}`,
          statusPath: client.statusPath || null,
        },
        {
          command: "publish-tenant-permission-enforcement",
          enabled: blockedBy.length === 0 && statusPatch.patchable === true,
          idempotencyKey: `tenant-permission-status:${statusPatch.patchId || enforcementId}`,
          statusPath: statusPatch.statusPath || client.statusPath || null,
          patch: statusPatch.fields
            ? {
              ...statusPatch.fields,
              tenantPermissionEnforcementId: enforcementId,
              tenantPermissionStatus: status,
            }
            : null,
        },
      ],
      nextAction,
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const acceptedRows = rows.filter((row) => row.acceptedForHandoff);
  const releaseRows = rows.map((row) => row.release).filter(Boolean);
  const releaseBlockedRows = rows.filter((row) => row.release?.status === "blocked");
  const releasePendingRows = rows.filter((row) => row.release?.status === "pending");
  const releaseReadyRows = rows.filter((row) => row.release?.ready);
  const matrixKey = stableId("tenant-permission-matrix", [
    descriptor.id,
    permissionBoundaryHandoff.handoffKey,
    rows.length,
    blockedRows.length,
    pendingRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.tenantPermissionEnforcementMatrix.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    matrixKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "enforced",
    acceptedForHandoff: blockedRows.length === 0 && rows.every((row) => row.acceptedForHandoff),
    rows,
    counters: {
      operations: rows.length,
      accepted: acceptedRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      auditRequired: rows.filter((row) => row.safeguards.auditRequired).length,
      leaseRequired: rows.filter((row) => row.safeguards.leaseRequired).length,
      statusPatchable: rows.filter((row) => row.statusPatch.patchable).length,
      roleRepairRequired: rows.filter((row) => row.roles.missingRequired.length).length,
      releaseReady: releaseReadyRows.length,
      releaseBlocked: releaseBlockedRows.length,
      releasePending: releasePendingRows.length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    releaseLedger: {
      ledgerKey: stableId("tenant-permission-release-ledger", [
        descriptor.id,
        matrixKey,
        releaseReadyRows.length,
        releaseBlockedRows.length,
        releasePendingRows.length,
      ]),
      status: releaseBlockedRows.length
        ? "blocked"
        : releasePendingRows.length
          ? "pending"
          : "release-ready",
      acceptedForAdapterHandoff: releaseBlockedRows.length === 0
        && releasePendingRows.length === 0
        && releaseRows.every((row) => row.ready),
      rows: rows.map((row) => ({
        operationId: row.operationId,
        enforcementId: row.enforcementId,
        releaseId: row.release.releaseId,
        status: row.release.status,
        ready: row.release.ready,
        mode: row.release.mode,
        boundaryKey: row.release.boundaryKey,
        requestId: row.release.requestId,
        clientStatusPath: row.release.clientStatusPath,
        providerStatusPath: row.release.providerStatusPath,
        blockedBy: row.release.blockedBy,
        pendingBy: row.release.pendingBy,
        statusPatchId: row.release.statusPatchId,
        nextAction: row.release.nextAction,
      })),
      blockedOperationIds: releaseBlockedRows.map((row) => row.operationId).sort(),
      pendingOperationIds: releasePendingRows.map((row) => row.operationId).sort(),
      readyOperationIds: releaseReadyRows.map((row) => row.operationId).sort(),
      nextAction: releaseBlockedRows[0]?.release?.nextAction
        || releasePendingRows[0]?.release?.nextAction
        || "accept_tenant_permission_release_ledger",
    },
    commands: rows.flatMap((row) => row.commands),
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || "publish_tenant_permission_enforcement_matrix",
  };
}

function buildRestartSafeStatusEnvelope(descriptor, operations, restartJournal, adapterRecoveryCheckpointPlan, clientStatusTransitionPlan) {
  const journalByOperation = new Map((restartJournal.rows || []).map((row) => [row.operationId, row]));
  const checkpointByOperation = new Map((adapterRecoveryCheckpointPlan.rows || []).map((row) => [row.operationId, row]));
  const transitionByOperation = new Map((clientStatusTransitionPlan.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const journal = journalByOperation.get(operation.id) || {};
    const checkpoint = checkpointByOperation.get(operation.id) || {};
    const transition = transitionByOperation.get(operation.id) || {};
    const statusPatch = journal.statusPatch || {};
    const statusResolution = journal.statusResolution || {};
    const client = operation.runtimeClientState?.client || {};
    const request = operation.runtimeClientState?.request || {};
    const persisted = operation.persistedState || {};
    const providerStatusPath = compactString(
      statusPatch.providerStatusPath || journal.providerStatusPath || transition.providerStatusPath,
      `${client.statusPath || `mailchimp.operations.${operation.id}.status`}.provider.mailchimp`,
    );
    const blockedBy = [
      ...(!journal.journalEntryId ? ["restart-journal:entry-missing"] : []),
      ...(!client.statusPath ? ["client-status:path-missing"] : []),
      ...(!request.requestId ? ["request:id-missing"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["request:idempotency-key-missing"] : []),
      ...(checkpoint.status === "blocked" ? [`checkpoint:${checkpoint.nextAction || "blocked"}`] : []),
      ...(transition.status === "blocked" ? [`client-transition:${transition.blockedReason || "blocked"}`] : []),
      ...(journal.status === "blocked" ? [`restart-journal:${journal.nextAction || "blocked"}`] : []),
      ...(statusPatch.patchable === false
        ? (statusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `status-patch:${blocker}`)
        : []),
      ...(statusResolution.status === "blocked"
        ? (statusResolution.blockedBy || ["blocked"]).map((blocker) => `status-resolution:${blocker}`)
        : []),
    ].sort();
    const pendingBy = [
      ...(checkpoint.status === "pending" ? ["checkpoint:pending"] : []),
      ...(journal.status === "pending" ? ["restart-journal:pending"] : []),
      ...(statusResolution.status === "pending"
        ? (statusResolution.pendingBy || ["pending"]).map((pending) => `status-resolution:${pending}`)
        : []),
      ...(statusPatch.patchable === true && journal.statusCommand?.enabled !== true ? ["status-patch:publish-pending"] : []),
    ].sort();
    const restartSafe = blockedBy.length === 0
      && journal.restartSafe === true
      && checkpoint.replaySafe !== false
      && statusResolution.restartSafe !== false
      && !["operator-review", "blocked"].includes(statusResolution.status);
    const commandId = stableId("restart-status-command", [
      descriptor.id,
      operation.id,
      request.requestId,
      statusPatch.patchId,
      providerStatusPath,
    ]);
    const status = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : restartSafe
          ? "restart-safe"
          : "operator-review";

    return {
      index,
      operationId: operation.id,
      journalEntryId: journal.journalEntryId || null,
      checkpointId: checkpoint.checkpointId || null,
      transitionToken: transition.transitionToken || null,
      status,
      restartSafe,
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      replayToken: request.replayToken || null,
      statusPath: client.statusPath || null,
      progressPath: client.progressPath || null,
      providerStatusPath,
      snapshotKey: persisted.snapshotKey || journal.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || journal.ledgerKey || null,
      recoveryPath: persisted.recoveryPath || null,
      blockedBy,
      pendingBy,
      statusPatch: {
        patchId: statusPatch.patchId || null,
        patchable: statusPatch.patchable === true && blockedBy.length === 0,
        statusPath: statusPatch.statusPath || client.statusPath || null,
        providerStatusPath,
        state: statusPatch.state || status,
        visibleState: statusPatch.visibleState || null,
        fields: statusPatch.fields || null,
        blockedBy: statusPatch.blockedBy || [],
        nextAction: statusPatch.nextAction || null,
      },
      statusResolution: {
        resolutionId: statusResolution.resolutionId || null,
        status: statusResolution.status || "unknown",
        restartSafe: statusResolution.restartSafe === true,
        observedState: statusResolution.observed?.state || null,
        observedPatchId: statusResolution.observed?.patchId || null,
        expectedPatchId: statusResolution.expected?.patchId || statusPatch.patchId || null,
        nextAction: statusResolution.nextAction || null,
      },
      command: {
        commandId,
        command: status === "blocked" ? "repair-restart-status-envelope" : "publish-restart-safe-status",
        enabled: status !== "blocked" && Boolean(client.statusPath),
        idempotencyKey: request.idempotencyKey || `restart-status-envelope:${commandId}`,
        statusPath: client.statusPath || null,
        providerStatusPath,
        patchId: statusPatch.patchId || null,
      },
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("checkpoint:")
          ? checkpoint.nextAction || "repair_adapter_recovery_checkpoint"
          : blockedBy[0].startsWith("client-transition:")
            ? transition.nextAction || "repair_client_status_transition"
            : blockedBy[0].startsWith("status-patch:")
              ? statusPatch.nextAction || "repair_restart_status_patch"
              : blockedBy[0].startsWith("status-resolution:")
                ? statusResolution.nextAction || "repair_restart_status_resolution"
                : journal.nextAction || "repair_restart_journal"
        : pendingBy.length
          ? pendingBy[0].startsWith("status-patch:")
            ? "publish_restart_status_patch"
            : "wait_for_restart_safe_status"
          : "publish_restart_safe_status",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const restartSafeRows = rows.filter((row) => row.restartSafe);
  const envelopeId = stableId("restart-status-envelope", [
    descriptor.id,
    restartJournal.journalId,
    adapterRecoveryCheckpointPlan.planKey,
    clientStatusTransitionPlan.planKey,
    blockedRows.length,
    pendingRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.restartSafeStatusEnvelope.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    envelopeId,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : restartSafeRows.length === rows.length
          ? "restart-safe"
          : "operator-review",
    acceptedForRuntime: blockedRows.length === 0 && pendingRows.length === 0,
    rows,
    counters: {
      operations: rows.length,
      restartSafe: restartSafeRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      commandEnabled: rows.filter((row) => row.command.enabled).length,
      providerStatusLinked: rows.filter((row) => row.providerStatusPath).length,
      idempotentCommands: rows.filter((row) => row.command.idempotencyKey).length,
    },
    commands: rows.map((row) => row.command),
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    restartSafeOperationIds: restartSafeRows.map((row) => row.operationId).sort(),
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || "publish_restart_safe_status_envelope",
  };
}

function buildPersistedStatusRecoveryLedger(descriptor, operations, restartSafeStatusEnvelope, restartJournal, clientStatusTransitionPlan) {
  const envelopeByOperation = new Map((restartSafeStatusEnvelope.rows || []).map((row) => [row.operationId, row]));
  const journalByOperation = new Map((restartJournal.rows || []).map((row) => [row.operationId, row]));
  const transitionByOperation = new Map((clientStatusTransitionPlan.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const envelope = envelopeByOperation.get(operation.id) || {};
    const journal = journalByOperation.get(operation.id) || {};
    const transition = transitionByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const persisted = operation.persistedState || {};
    const adapter = operation.adapterRecovery || {};
    const providerStatusPath = compactString(
      envelope.providerStatusPath || transition.providerStatusPath || operation.clientRuntimeAdoption?.client?.providerStatusPath,
      `${client.statusPath || `mailchimp.operations.${operation.id}.status`}.provider.mailchimp`,
    );
    const statusPatch = envelope.statusPatch || {};
    const statusResolution = envelope.statusResolution || journal.statusResolution || {};
    const persistedReady = Boolean(persisted.snapshotKey && persisted.ledgerKey && persisted.checkpointKey);
    const idempotencyReady = !operation.externalWrite || Boolean(request.idempotencyKey);
    const statusPathsReady = Boolean(client.statusPath && providerStatusPath);
    const replaySafe = persisted.idempotentCommand?.safeToReplay === true
      && envelope.restartSafe === true
      && idempotencyReady;
    const blockedBy = [
      ...(!persistedReady ? ["persisted:keys-missing"] : []),
      ...(!request.requestId ? ["request:id-missing"] : []),
      ...(!idempotencyReady ? ["request:idempotency-key-missing"] : []),
      ...(!statusPathsReady ? ["status:path-missing"] : []),
      ...(statusPatch.patchable === false
        ? (statusPatch.blockedBy || ["patch-not-ready"]).map((blocker) => `status-patch:${blocker}`)
        : []),
      ...(envelope.status === "blocked" ? (envelope.blockedBy || ["blocked"]).map((blocker) => `restart-envelope:${blocker}`) : []),
      ...(journal.status === "blocked" || journal.status === "operator-review"
        ? [`restart-journal:${journal.status}`]
        : []),
      ...(adapter.failed === true ? ["adapter:failed"] : []),
      ...(statusResolution.status === "blocked" || statusResolution.status === "operator-review"
        ? (statusResolution.blockedBy || [statusResolution.status]).map((blocker) => `status-resolution:${blocker}`)
        : []),
    ].sort();
    const pendingBy = [
      ...(envelope.status === "pending" ? (envelope.pendingBy || ["pending"]).map((pending) => `restart-envelope:${pending}`) : []),
      ...(journal.status === "pending" ? ["restart-journal:pending"] : []),
      ...(transition.status === "retry-scheduled" ? ["client-transition:retry-scheduled"] : []),
      ...(adapter.retryable === true ? ["adapter:retry-scheduled"] : []),
      ...(adapter.degradedMode === true ? ["adapter:degraded"] : []),
      ...(statusPatch.patchable === true && envelope.command?.enabled !== true ? ["status-patch:publish-pending"] : []),
      ...(statusResolution.status === "pending"
        ? (statusResolution.pendingBy || ["pending"]).map((pending) => `status-resolution:${pending}`)
        : []),
    ].sort();
    const recoveryMode = blockedBy.length
      ? "operator-review"
      : pendingBy.length
        ? "status-pending"
        : replaySafe
          ? "resume"
          : "observe";
    const ledgerEntryId = stableId("persisted-status-recovery", [
      descriptor.id,
      operation.id,
      persisted.snapshotKey,
      persisted.ledgerKey,
      envelope.envelopeId || restartSafeStatusEnvelope.envelopeId,
      recoveryMode,
    ]);
    const commandId = stableId("persisted-status-command", [
      ledgerEntryId,
      request.requestId,
      client.statusPath,
      providerStatusPath,
    ]);

    return {
      index,
      operationId: operation.id,
      ledgerEntryId,
      envelopeId: restartSafeStatusEnvelope.envelopeId || null,
      journalEntryId: journal.journalEntryId || null,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : replaySafe
            ? "resume-ready"
            : "observe-only",
      acceptedForAdapter: blockedBy.length === 0 && pendingBy.length === 0,
      restartSafe: replaySafe,
      recoveryMode,
      externalWrite: operation.externalWrite === true,
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      replayToken: request.replayToken || null,
      snapshotKey: persisted.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || null,
      checkpointKey: persisted.checkpointKey || null,
      recoveryPath: persisted.recoveryPath || null,
      statusPath: client.statusPath || null,
      progressPath: client.progressPath || null,
      providerStatusPath,
      blockedBy,
      pendingBy,
      restartEnvelopeStatus: envelope.status || "unknown",
      restartJournalStatus: journal.status || "unknown",
      transitionStatus: transition.status || "unknown",
      statusPatch: {
        patchId: statusPatch.patchId || null,
        patchable: statusPatch.patchable === true && blockedBy.length === 0,
        statusPath: statusPatch.statusPath || client.statusPath || null,
        providerStatusPath,
        state: recoveryMode === "resume" ? "restart_resume_ready" : recoveryMode,
        visibleState: recoveryMode === "resume" ? "Ready to resume" : recoveryMode.replace("-", " "),
        blockedBy: statusPatch.blockedBy || [],
        pendingBy,
        fields: {
          operationId: operation.id,
          ledgerEntryId,
          snapshotKey: persisted.snapshotKey || null,
          ledgerKey: persisted.ledgerKey || null,
          checkpointKey: persisted.checkpointKey || null,
          restartSafe: replaySafe,
          recoveryMode,
          providerStatusPath,
        },
        nextAction: blockedBy.length
          ? "repair_persisted_status_recovery_state"
          : pendingBy.length
            ? "publish_persisted_status_recovery_patch"
            : "publish_resume_ready_status",
      },
      command: {
        commandId,
        command: blockedBy.length ? "repair-persisted-status-recovery" : "publish-persisted-status-recovery",
        enabled: blockedBy.length === 0 && Boolean(client.statusPath && request.requestId),
        idempotent: true,
        idempotencyKey: request.idempotencyKey || `persisted-status:${commandId}`,
        replayToken: request.replayToken || null,
        statusPath: client.statusPath || null,
        providerStatusPath,
        patchId: statusPatch.patchId || null,
      },
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("status-patch:")
          ? statusPatch.nextAction || "repair_persisted_status_patch"
          : blockedBy[0].startsWith("restart-envelope:")
            ? envelope.nextAction || restartSafeStatusEnvelope.nextAction || "repair_restart_safe_status_envelope"
            : blockedBy[0].startsWith("status-resolution:")
              ? statusResolution.nextAction || "repair_restart_status_resolution"
              : "repair_persisted_status_recovery_state"
        : pendingBy.length
          ? pendingBy[0].startsWith("status-patch:")
            ? "publish_persisted_status_recovery_patch"
            : "wait_for_persisted_status_recovery"
          : "publish_persisted_status_recovery",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const resumeRows = rows.filter((row) => row.status === "resume-ready");
  const ledgerKey = stableId("persisted-status-recovery-ledger", [
    descriptor.id,
    restartSafeStatusEnvelope.envelopeId,
    restartJournal.journalId,
    blockedRows.length,
    pendingRows.length,
    resumeRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.persistedStatusRecoveryLedger.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    ledgerKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : resumeRows.length === rows.length
          ? "resume-ready"
          : "observe-only",
    acceptedForAdapter: blockedRows.length === 0 && pendingRows.length === 0,
    rows,
    counters: {
      operations: rows.length,
      resumeReady: resumeRows.length,
      observeOnly: rows.filter((row) => row.status === "observe-only").length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      commandEnabled: rows.filter((row) => row.command.enabled).length,
      idempotentCommands: rows.filter((row) => row.command.idempotent).length,
      providerStatusLinked: rows.filter((row) => row.providerStatusPath).length,
    },
    commands: rows.map((row) => row.command),
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    resumeOperationIds: resumeRows.map((row) => row.operationId).sort(),
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || "publish_persisted_status_recovery_ledger",
  };
}

function buildProviderReadinessConfirmationContract(descriptor, operation, providerRow, request, client, providerStatusPath, readinessChecks) {
  const handoffState = providerRow.handoffState || providerRow.externalHandoff || {};
  const providerHealth = providerRow.providerHealth || handoffState.health || providerRow.health || {};
  const providerFailure = providerHealth.failure || handoffState.failure || providerRow.failure || {};
  const providerRetry = providerHealth.retry || handoffState.retry || {};
  const externalCapabilities = providerRow.externalCapabilities || [];
  const requiresConfirmation = operation.externalWrite || externalCapabilities.length > 0;
  const observedState = compactString(handoffState.state || providerRow.status);
  const observedAtPath = compactString(handoffState.observedAtPath || providerRow.observedAtPath);
  const ackToken = compactString(handoffState.ackToken || providerRow.ackToken);
  const ackActor = compactString(handoffState.actor || handoffState.ackActor || providerRow.ackActor);
  const ackAt = compactString(handoffState.ackAt || handoffState.timestamp || providerRow.ackAt);
  const observedProviderStatus = compactString(
    providerHealth.status || providerHealth.state || handoffState.providerStatus || providerRow.providerStatus,
    providerRow.status || "unknown",
  );
  const providerUnavailable = ["unavailable", "offline", "failed", "adapter-failed"].includes(observedProviderStatus)
    || providerFailure.terminal === true;
  const providerDegraded = providerHealth.degraded === true
    || ["degraded", "provider-degraded", "retry-scheduled"].includes(observedProviderStatus);
  const retryAttempt = Number.isFinite(Number(providerRetry.attempt))
    ? Math.max(0, Number(providerRetry.attempt))
    : 0;
  const retryAfterMs = Number.isFinite(Number(providerRetry.retryAfterMs ?? providerRetry.nextDelayMs))
    ? Math.max(0, Number(providerRetry.retryAfterMs ?? providerRetry.nextDelayMs))
    : providerDegraded ? 30000 : 0;
  const providerFailureCode = compactString(providerFailure.code || providerHealth.code);
  const providerFailureMessage = compactString(providerFailure.message || providerHealth.lastError || providerRow.lastError);
  const acceptedState = [
    "external-write-contract-ready",
    "read-contract-ready",
    "lease-negotiable",
    "delegation-negotiable",
    "provider_readiness_confirmed",
    "confirmed",
  ].includes(observedState || providerRow.status);
  const requiredFields = [
    "requestId",
    "clientStatusPath",
    "providerStatusPath",
    ...(requiresConfirmation ? ["observedState", "observedAtPath", "ackToken"] : []),
    ...(operation.externalWrite ? ["idempotencyKey"] : []),
  ];
  const missingFields = [
    ...(!request.requestId ? ["requestId"] : []),
    ...(!client.statusPath ? ["clientStatusPath"] : []),
    ...(!providerStatusPath ? ["providerStatusPath"] : []),
    ...(requiresConfirmation && !observedState ? ["observedState"] : []),
    ...(requiresConfirmation && !observedAtPath ? ["observedAtPath"] : []),
    ...(requiresConfirmation && !ackToken && !acceptedState && handoffState.accepted !== true ? ["ackToken"] : []),
    ...(operation.externalWrite && !request.idempotencyKey ? ["idempotencyKey"] : []),
  ];
  const accepted = !requiresConfirmation
    || (!providerUnavailable && handoffState.accepted === true)
    || (!providerUnavailable && acceptedState && missingFields.every((field) => field !== "requestId" && field !== "clientStatusPath" && field !== "providerStatusPath"));
  const confirmationId = stableId("provider-confirmation", [
    descriptor.id,
    operation.id,
    request.requestId,
    providerStatusPath,
    observedState,
    ackToken,
  ]);
  const status = missingFields.some((field) => ["requestId", "clientStatusPath", "providerStatusPath", "idempotencyKey"].includes(field))
    ? "metadata-incomplete"
    : providerUnavailable
      ? "provider-failed"
      : accepted
      ? "accepted"
      : providerDegraded
        ? "provider-degraded"
      : requiresConfirmation
        ? "awaiting-provider-ack"
        : "not-required";
  const confirmationBlockedBy = [
    ...missingFields.filter((field) => ["requestId", "clientStatusPath", "providerStatusPath", "idempotencyKey"].includes(field)),
    ...(providerUnavailable ? [providerFailureCode || observedProviderStatus || "provider-unavailable"] : []),
  ];
  const confirmationPendingBy = [
    ...missingFields.filter((field) => !["requestId", "clientStatusPath", "providerStatusPath", "idempotencyKey"].includes(field)),
    ...(providerDegraded && !providerUnavailable ? [providerFailureCode || observedProviderStatus || "provider-degraded"] : []),
  ];

  return {
    confirmationId,
    required: requiresConfirmation,
    status,
    accepted,
    observedState: observedState || null,
    observedAtPath: observedAtPath || null,
    ackToken: ackToken || null,
    ackTokenPresent: Boolean(ackToken),
    ackActor: ackActor || null,
    ackAt: ackAt || null,
    requiredFields,
    missingFields,
    observedProvider: {
      status: observedProviderStatus,
      degraded: providerDegraded,
      unavailable: providerUnavailable,
      retryAttempt,
      retryAfterMs,
      failureCode: providerFailureCode || null,
      failureMessage: providerFailureMessage || null,
      actionable: compactString(providerFailure.actionable || providerHealth.actionable) || null,
    },
    checks: {
      requestReady: readinessChecks.requestReady === true,
      clientStatusReady: readinessChecks.clientStatusReady === true,
      providerStatusReady: readinessChecks.providerStatusReady === true,
      idempotencyReady: readinessChecks.idempotencyReady === true,
      stateAccepted: !providerUnavailable && (acceptedState || handoffState.accepted === true),
      acknowledgementPresent: !requiresConfirmation || Boolean(ackToken) || acceptedState || handoffState.accepted === true,
      providerHealthy: !providerUnavailable && !providerDegraded,
      providerPollable: providerDegraded && retryAfterMs > 0,
    },
    blockedBy: confirmationBlockedBy,
    pendingBy: confirmationPendingBy,
    actionableError: status === "provider-failed"
      ? {
        code: providerFailureCode || "provider.readiness.failed",
        severity: "error",
        message: providerFailureMessage || "Mailchimp provider readiness confirmation observed a failed provider state.",
        action: compactString(providerFailure.actionable || providerHealth.actionable, "surface_provider_failure_to_operator"),
      }
      : status === "provider-degraded"
        ? {
          code: providerFailureCode || "provider.readiness.degraded",
          severity: "warning",
          message: providerFailureMessage || "Mailchimp provider readiness confirmation observed a degraded provider state.",
          action: retryAfterMs > 0 ? "poll_provider_confirmation_after_backoff" : "wait_for_provider_confirmation_ack",
        }
        : null,
    statusPatch: {
      patchId: stableId("provider-confirmation-patch", [confirmationId, client.statusPath, providerStatusPath]),
      patchable: Boolean(client.statusPath && providerStatusPath && request.requestId && !providerUnavailable),
      statusPath: client.statusPath || null,
      providerStatusPath: providerStatusPath || null,
      state: accepted ? "provider-confirmation-accepted" : status,
      visibleState: accepted
        ? "Mailchimp provider confirmed readiness"
        : providerUnavailable
          ? "Mailchimp provider readiness failed"
          : providerDegraded
            ? "Mailchimp provider readiness degraded"
        : requiresConfirmation
          ? "Waiting for Mailchimp provider confirmation"
          : "Mailchimp provider confirmation not required",
      fields: client.statusPath && providerStatusPath && request.requestId
        ? {
          confirmationId,
          operationId: operation.id,
          requestId: request.requestId,
          providerStatusPath,
          observedState: observedState || null,
          observedAtPath: observedAtPath || null,
          observedProviderStatus,
          providerRetryAfterMs: retryAfterMs,
          ackTokenPresent: Boolean(ackToken),
          accepted,
        }
        : null,
      blockedBy: confirmationBlockedBy,
      pendingBy: confirmationPendingBy,
      nextAction: accepted
        ? "publish_provider_confirmation_acceptance"
        : status === "metadata-incomplete"
          ? "repair_provider_confirmation_metadata"
          : status === "provider-failed"
            ? "surface_provider_confirmation_failure"
            : status === "provider-degraded"
              ? "poll_provider_confirmation_after_backoff"
          : "wait_for_provider_confirmation_ack",
    },
    nextAction: accepted
      ? "release_provider_readiness_confirmation"
      : status === "metadata-incomplete"
        ? "repair_provider_confirmation_metadata"
        : status === "provider-failed"
          ? "surface_provider_confirmation_failure"
          : status === "provider-degraded"
            ? "poll_provider_confirmation_after_backoff"
        : "wait_for_provider_confirmation_ack",
  };
}

function buildProviderReadinessHandoff(descriptor, operations, providerNegotiation, acceptancePreview, clientStatusTransitionPlan, adapterRecoveryCheckpointPlan, restartJournal, permissionBoundaryHandoff) {
  const providerByOperation = new Map((providerNegotiation.rows || []).map((row) => [row.operationId, row]));
  const acceptanceByOperation = new Map((acceptancePreview.rows || []).map((row) => [row.operationId, row]));
  const transitionByOperation = new Map((clientStatusTransitionPlan.rows || []).map((row) => [row.operationId, row]));
  const checkpointByOperation = new Map((adapterRecoveryCheckpointPlan.rows || []).map((row) => [row.operationId, row]));
  const journalByOperation = new Map((restartJournal.rows || []).map((row) => [row.operationId, row]));
  const permissionByOperation = new Map((permissionBoundaryHandoff.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const providerRow = providerByOperation.get(operation.id) || {};
    const acceptanceRow = acceptanceByOperation.get(operation.id) || {};
    const transitionRow = transitionByOperation.get(operation.id) || {};
    const checkpointRow = checkpointByOperation.get(operation.id) || {};
    const journalRow = journalByOperation.get(operation.id) || {};
    const permissionRow = permissionByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const persisted = operation.persistedState || {};
    const adapter = operation.adapterRecovery || {};
    const lifecycle = operation.lifecycleVisibility || {};
    const externalCapabilities = providerRow.externalCapabilities || [];
    const delegatedCapabilities = providerRow.delegatedCapabilities || [];
    const providerConfirmationRequired = operation.externalWrite || externalCapabilities.length > 0;
    const providerStatusPath = compactString(providerRow.providerStatusPath || operation.clientRuntimeAdoption?.client?.providerStatusPath);
    const readinessChecks = {
      requestReady: Boolean(request.requestId),
      clientStatusReady: Boolean(client.statusPath),
      providerStatusReady: Boolean(providerStatusPath),
      persistedStateReady: Boolean(persisted.snapshotKey && persisted.ledgerKey),
      idempotencyReady: !operation.externalWrite || Boolean(request.idempotencyKey),
      boundaryReady: boundary.status === "ready",
      acceptanceReady: acceptanceRow.accepted !== false,
      transitionReady: !["blocked", "missing"].includes(transitionRow.status),
      checkpointReady: !["blocked", "operator-review"].includes(checkpointRow.status),
      restartJournalReady: !["blocked", "operator-review"].includes(journalRow.status),
      permissionReady: permissionRow.acceptedForDispatch !== false && permissionRow.status !== "blocked",
      adapterReady: adapter.failed !== true,
      providerNegotiable: providerRow.negotiable !== false
        || providerRow.status === "provider-degraded"
        || providerRow.status === "retry-scheduled",
    };
    const providerConfirmation = buildProviderReadinessConfirmationContract(
      descriptor,
      operation,
      providerRow,
      request,
      client,
      providerStatusPath,
      readinessChecks,
    );
    const readinessStatusPatch = {
      patchId: stableId("provider-readiness-patch", [
        descriptor.id,
        operation.id,
        providerStatusPath,
        permissionRow.packetId,
        transitionRow.transitionToken,
      ]),
      patchable: Boolean(client.statusPath && providerStatusPath && request.requestId),
      statusPath: client.statusPath || null,
      providerStatusPath: providerStatusPath || null,
      state: providerConfirmation.accepted ? "provider_readiness_confirmed" : "provider_readiness_waiting",
      visibleState: providerConfirmation.accepted
        ? "provider_ready"
        : adapter.degradedMode
          ? "provider_degraded"
          : "provider_waiting",
      fields: client.statusPath && providerStatusPath && request.requestId
        ? {
          operationId: operation.id,
          requestId: request.requestId,
          provider: "mailchimp",
          service: compactString(providerRow.service || operation.adapter, "mailchimp"),
          readinessState: providerConfirmation.accepted ? "confirmed" : "waiting",
          externalWrite: operation.externalWrite,
          externalCapabilities,
          delegatedCapabilities,
          boundaryKey: boundary.boundaryKey || null,
          permissionPacketId: permissionRow.packetId || null,
          transitionToken: transitionRow.transitionToken || null,
          checkpointId: checkpointRow.checkpointId || null,
          restartJournalEntryId: journalRow.journalEntryId || null,
        }
        : null,
      blockedBy: [
        ...(!client.statusPath ? ["client-status-path-missing"] : []),
        ...(!providerStatusPath ? ["provider-status-path-missing"] : []),
        ...(!request.requestId ? ["request-id-missing"] : []),
      ],
      nextAction: client.statusPath && providerStatusPath && request.requestId
        ? "publish_provider_readiness_status_patch"
        : "repair_provider_readiness_status_metadata",
    };
    const blockedBy = [
      ...(!request.requestId ? ["request:request-id-missing"] : []),
      ...(!client.statusPath ? ["client:status-path-missing"] : []),
      ...(!providerStatusPath ? ["provider:status-path-missing"] : []),
      ...(!persisted.snapshotKey ? ["persisted:snapshot-key-missing"] : []),
      ...(!persisted.ledgerKey ? ["persisted:ledger-key-missing"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["request:idempotency-key-missing"] : []),
      ...(boundary.status !== "ready" ? [`boundary:${boundary.status || "blocked"}`] : []),
      ...(acceptanceRow.accepted === false ? [`acceptance:${acceptanceRow.readiness || "blocked"}`] : []),
      ...(transitionRow.status === "blocked" ? [`client-transition:${transitionRow.blockedReason || "blocked"}`] : []),
      ...(checkpointRow.status === "blocked" ? checkpointRow.blockedBy.map((blocker) => `checkpoint:${blocker}`) : []),
      ...(journalRow.status === "blocked" ? journalRow.blockedBy.map((blocker) => `restart-journal:${blocker}`) : []),
      ...(permissionRow.status === "blocked" ? permissionRow.blockedBy.map((blocker) => `permission:${blocker}`) : []),
      ...(operation.externalWrite && permissionRow.acceptedForDispatch === false ? ["permission:not-accepted-for-dispatch"] : []),
      ...(adapter.failed ? [`adapter:${adapter.status || "failed"}`] : []),
      ...(!readinessStatusPatch.patchable ? readinessStatusPatch.blockedBy.map((blocker) => `status-patch:${blocker}`) : []),
      ...(providerConfirmation.status === "metadata-incomplete"
        ? providerConfirmation.missingFields.map((field) => `provider-confirmation:${field}`)
        : []),
      ...(providerConfirmation.status === "provider-failed"
        ? (providerConfirmation.blockedBy || ["provider-failed"]).map((blocker) => `provider-confirmation:${blocker}`)
        : []),
      ...(providerConfirmation.statusPatch.patchable === false
        ? providerConfirmation.statusPatch.blockedBy.map((blocker) => `provider-confirmation-status:${blocker}`)
        : []),
      ...(providerRow.negotiable === false && providerRow.status !== "provider-degraded" && providerRow.status !== "retry-scheduled"
        ? [`provider:${providerRow.status || "not-negotiable"}`]
        : []),
    ].sort();
    const pendingBy = [
      ...(adapter.retryable ? ["adapter:retry-scheduled"] : []),
      ...(adapter.degradedMode ? ["adapter:degraded"] : []),
      ...(lifecycle.status === "scheduled" ? ["lifecycle:scheduled"] : []),
      ...(lifecycle.status === "waiting-for-approval" ? ["approval:operator-required"] : []),
      ...(transitionRow.status === "retry-scheduled" ? ["client-transition:retry-scheduled"] : []),
      ...(transitionRow.status === "degraded-visible" ? ["client-transition:degraded-visible"] : []),
      ...(checkpointRow.status === "pending" ? checkpointRow.pendingBy.map((pending) => `checkpoint:${pending}`) : []),
      ...(journalRow.status === "pending" ? journalRow.pendingBy.map((pending) => `restart-journal:${pending}`) : []),
      ...(permissionRow.status === "pending" ? permissionRow.pendingBy.map((pending) => `permission:${pending}`) : []),
      ...(providerRow.status === "retry-scheduled" ? ["provider:retry-scheduled"] : []),
      ...(providerRow.status === "provider-degraded" ? ["provider:degraded"] : []),
      ...(providerConfirmationRequired && !providerConfirmation.accepted ? ["provider:confirmation-pending"] : []),
      ...(providerConfirmation.status === "awaiting-provider-ack"
        ? providerConfirmation.missingFields.map((field) => `provider-confirmation:${field}`)
        : []),
      ...(providerConfirmation.status === "provider-degraded"
        ? (providerConfirmation.pendingBy || ["provider-degraded"]).map((pending) => `provider-confirmation:${pending}`)
        : []),
    ].sort();
    const acceptedForProvider = blockedBy.length === 0
      && permissionRow.acceptedForDispatch !== false
      && transitionRow.status !== "blocked"
      && checkpointRow.status !== "blocked"
      && journalRow.status !== "blocked"
      && readinessStatusPatch.patchable
      && (providerConfirmation.accepted || pendingBy.includes("provider:confirmation-pending"));
    const status = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : operation.externalWrite || externalCapabilities.length
          ? "external-write-ready"
          : "delegated-read-ready";
    const readinessId = stableId("provider-ready", [
      descriptor.id,
      operation.id,
      providerNegotiation.syncKey,
      acceptancePreview.acceptanceKey,
      permissionBoundaryHandoff.handoffKey,
      status,
    ]);
    const releaseCommand = operation.externalWrite || externalCapabilities.length
      ? "release-provider-readiness-to-approval"
      : "release-provider-readiness-to-runtime";

    return {
      index,
      operationId: operation.id,
      readinessId,
      status,
      acceptedForProvider,
      externalWrite: operation.externalWrite,
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      replayToken: request.replayToken || null,
      clientStatusPath: client.statusPath || null,
      providerStatusPath: providerStatusPath || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      boundaryKey: boundary.boundaryKey || null,
      readinessChecks,
      providerConfirmation,
      statusPatch: readinessStatusPatch,
      acceptanceKey: acceptancePreview.acceptanceKey || null,
      acceptanceStatus: acceptanceRow.readiness || acceptancePreview.status || "unknown",
      transitionToken: transitionRow.transitionToken || null,
      transitionStatus: transitionRow.status || "unknown",
      checkpointId: checkpointRow.checkpointId || null,
      checkpointStatus: checkpointRow.status || "unknown",
      restartJournalEntryId: journalRow.journalEntryId || null,
      restartJournalStatus: journalRow.status || "unknown",
      permissionPacketId: permissionRow.packetId || null,
      permissionStatus: permissionRow.status || "unknown",
      permissionAcceptedForDispatch: permissionRow.acceptedForDispatch !== false,
      externalCapabilities,
      delegatedCapabilities,
      blockedBy,
      pendingBy,
      commands: [
        {
          command: "persist-provider-readiness-handoff",
          enabled: true,
          idempotencyKey: `provider-readiness:${readinessId}`,
          statusPath: client.statusPath || null,
        },
        {
          command: "publish-provider-confirmation-status",
          enabled: providerConfirmation.statusPatch.patchable === true && blockedBy.length === 0,
          idempotencyKey: `provider-confirmation:${providerConfirmation.confirmationId}`,
          statusPath: client.statusPath || null,
          providerStatusPath: providerStatusPath || null,
          statusPatch: providerConfirmation.statusPatch.fields,
        },
        {
          command: releaseCommand,
          enabled: acceptedForProvider && pendingBy.length === 0,
          idempotencyKey: request.idempotencyKey || `provider-readiness-release:${readinessId}`,
          statusPath: client.statusPath || null,
          providerStatusPath: providerStatusPath || null,
          statusPatch: readinessStatusPatch.patchable ? readinessStatusPatch.fields : null,
        },
      ],
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("request:")
          ? "repair_runtime_request_state"
          : blockedBy[0].startsWith("client:")
            ? "repair_client_runtime_state"
            : blockedBy[0].startsWith("provider:")
              ? providerRow.handoffState?.nextAction || "repair_provider_contract"
              : blockedBy[0].startsWith("provider-confirmation")
                ? providerConfirmation.nextAction
              : blockedBy[0].startsWith("boundary:")
                ? boundary.statusHandoff?.nextAction || "repair_tenant_permission_boundary"
                : blockedBy[0].startsWith("acceptance:")
                  ? acceptanceRow.nextStep?.action || acceptancePreview.nextAction || "repair_package_acceptance_preview"
                  : blockedBy[0].startsWith("client-transition:")
                    ? transitionRow.nextAction || clientStatusTransitionPlan.nextAction || "repair_client_status_transition"
                    : blockedBy[0].startsWith("checkpoint:")
                      ? checkpointRow.nextAction || adapterRecoveryCheckpointPlan.nextAction || "repair_adapter_recovery_checkpoint"
                      : blockedBy[0].startsWith("restart-journal:")
                        ? journalRow.nextAction || restartJournal.nextAction || "repair_restart_journal"
                        : blockedBy[0].startsWith("permission:")
                          ? permissionRow.nextAction || permissionBoundaryHandoff.nextAction || "repair_permission_boundary_handoff"
                          : blockedBy[0].startsWith("status-patch:")
                            ? readinessStatusPatch.nextAction
                          : adapter.recovery?.nextAction || "repair_provider_readiness_handoff"
        : pendingBy.length
          ? pendingBy[0].startsWith("approval:")
            ? "request_operator_approval"
            : pendingBy[0].startsWith("provider:")
              ? providerConfirmation.nextAction || "poll_mailchimp_provider_status"
              : pendingBy[0].startsWith("provider-confirmation:")
                ? providerConfirmation.nextAction
              : permissionRow.nextAction || checkpointRow.nextAction || journalRow.nextAction || "wait_for_provider_readiness"
        : releaseCommand,
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.acceptedForProvider && row.status !== "pending");
  const handoffKey = stableId("provider-readiness-handoff", [
    descriptor.id,
    providerNegotiation.syncKey,
    permissionBoundaryHandoff.handoffKey,
    rows.length,
    blockedRows.length,
    pendingRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.providerReadinessHandoff.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    handoffKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "ready",
    acceptedForProvider: blockedRows.length === 0 && pendingRows.length === 0,
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      releaseCommandsEnabled: rows.flatMap((row) => row.commands).filter((command) => command.command.startsWith("release-provider-readiness") && command.enabled).length,
      confirmationRequired: rows.filter((row) => row.providerConfirmation.required).length,
      confirmationAccepted: rows.filter((row) => row.providerConfirmation.accepted).length,
      confirmationPending: rows.filter((row) => row.providerConfirmation.required && !row.providerConfirmation.accepted).length,
      confirmationStatusPatchable: rows.filter((row) => row.providerConfirmation.statusPatch?.patchable).length,
      confirmationFailed: rows.filter((row) => row.providerConfirmation.status === "provider-failed").length,
      confirmationDegraded: rows.filter((row) => row.providerConfirmation.status === "provider-degraded").length,
      confirmationPollable: rows.filter((row) => row.providerConfirmation.checks?.providerPollable).length,
      permissionLinked: rows.filter((row) => row.permissionPacketId).length,
      restartJournalLinked: rows.filter((row) => row.restartJournalEntryId).length,
    },
    commands: rows.flatMap((row) => row.commands),
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || "publish_provider_readiness_handoff",
  };
}

function buildPackageExportSummary(descriptor, operations, diagnostics, analytics, timelineReport, providerNegotiation, acceptancePreview, clientStatusTransitionPlan, adapterRecoveryCheckpointPlan, restartJournal, permissionBoundaryHandoff, providerReadinessHandoff) {
  return {
    format: "aios.mailchimp.package.report.v1",
    packageId: descriptor.id,
    provider: "mailchimp",
    status: acceptancePreview.status === "blocked"
      ? "blocked"
      : permissionBoundaryHandoff.status === "blocked"
        ? "blocked"
      : providerReadinessHandoff.status === "blocked"
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
      statusPatchBlockedOperationIds: restartJournal.statusPatchBlockedOperationIds,
      statusCommandCount: (restartJournal.statusCommands || []).length,
      statusPatchableCount: restartJournal.counters?.statusPatchable || 0,
      statusPatchBlockedCount: restartJournal.counters?.statusPatchBlocked || 0,
    },
    permissionBoundaryHandoff: {
      handoffKey: permissionBoundaryHandoff.handoffKey,
      status: permissionBoundaryHandoff.status,
      nextAction: permissionBoundaryHandoff.nextAction,
      counters: permissionBoundaryHandoff.counters,
      blockedOperationIds: permissionBoundaryHandoff.blockedOperationIds,
      pendingOperationIds: permissionBoundaryHandoff.pendingOperationIds,
    },
    providerReadinessHandoff: {
      handoffKey: providerReadinessHandoff.handoffKey,
      status: providerReadinessHandoff.status,
      acceptedForProvider: providerReadinessHandoff.acceptedForProvider,
      nextAction: providerReadinessHandoff.nextAction,
      counters: providerReadinessHandoff.counters,
      blockedOperationIds: providerReadinessHandoff.blockedOperationIds,
      pendingOperationIds: providerReadinessHandoff.pendingOperationIds,
    },
    nextAction: providerReadinessHandoff.status === "blocked" || providerReadinessHandoff.status === "pending"
      ? providerReadinessHandoff.nextAction
      : permissionBoundaryHandoff.status === "blocked" || permissionBoundaryHandoff.status === "pending"
      ? permissionBoundaryHandoff.nextAction
      : acceptancePreview.nextAction || timelineReport.nextAction,
  };
}

function buildPackageExportReadinessLedger(descriptor, operations, diagnostics, analytics, exportSummary, providerReadinessHandoff, permissionBoundaryHandoff, restartJournal) {
  const diagnosticsByOperation = new Map();
  for (const diagnostic of diagnostics) {
    const key = compactString(diagnostic.operationId);
    if (!key) continue;
    const existing = diagnosticsByOperation.get(key) || [];
    existing.push(diagnostic);
    diagnosticsByOperation.set(key, existing);
  }

  const providerByOperation = new Map((providerReadinessHandoff.rows || []).map((row) => [row.operationId, row]));
  const permissionByOperation = new Map((permissionBoundaryHandoff.rows || []).map((row) => [row.operationId, row]));
  const journalByOperation = new Map((restartJournal.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation) => {
    const provider = providerByOperation.get(operation.id) || {};
    const permission = permissionByOperation.get(operation.id) || {};
    const journal = journalByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const persisted = operation.persistedState || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const scopedDiagnostics = diagnosticsByOperation.get(operation.id) || [];
    const blockers = [
      ...(!request.requestId ? ["request:request-id-missing"] : []),
      ...(!client.statusPath ? ["client:status-path-missing"] : []),
      ...(!persisted.snapshotKey ? ["persisted:snapshot-key-missing"] : []),
      ...(!persisted.ledgerKey ? ["persisted:ledger-key-missing"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["request:idempotency-key-missing"] : []),
      ...(boundary.status !== "ready" ? [`boundary:${boundary.status || "blocked"}`] : []),
      ...(provider.status === "blocked" ? provider.blockedBy.map((blocker) => `provider:${blocker}`) : []),
      ...(permission.status === "blocked" ? permission.blockedBy.map((blocker) => `permission:${blocker}`) : []),
      ...(journal.status === "blocked" ? journal.blockedBy.map((blocker) => `restart:${blocker}`) : []),
      ...scopedDiagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => `diagnostic:${diagnostic.code}`),
    ].sort();
    const pending = [
      ...(provider.status === "pending" ? provider.pendingBy.map((item) => `provider:${item}`) : []),
      ...(permission.status === "pending" ? permission.pendingBy.map((item) => `permission:${item}`) : []),
      ...(journal.status === "pending" ? journal.pendingBy.map((item) => `restart:${item}`) : []),
      ...(operation.adapterRecovery?.retryable ? ["adapter:retry-scheduled"] : []),
      ...(operation.adapterRecovery?.degradedMode ? ["adapter:degraded"] : []),
      ...(operation.lifecycleVisibility?.status === "waiting-for-approval" ? ["approval:operator-required"] : []),
    ].sort();
    const exportable = blockers.length === 0
      && Boolean(request.requestId && client.statusPath && persisted.snapshotKey && persisted.ledgerKey)
      && (!operation.externalWrite || Boolean(request.idempotencyKey));
    const status = blockers.length
      ? "blocked"
      : pending.length
        ? "pending"
        : exportable
          ? operation.externalWrite
            ? "external-write-export-ready"
            : "read-export-ready"
          : "metadata-incomplete";

    return {
      operationId: operation.id,
      status,
      exportable,
      externalWrite: operation.externalWrite,
      requestId: request.requestId || null,
      idempotencyKeyPresent: Boolean(request.idempotencyKey),
      clientStatusPath: client.statusPath || null,
      providerStatusPath: provider.providerStatusPath || permission.providerStatusPath || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      snapshotKey: persisted.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || null,
      restartJournalEntryId: journal.journalEntryId || null,
      permissionPacketId: permission.packetId || null,
      providerReadinessId: provider.readinessId || null,
      blockedBy: blockers,
      pendingBy: pending,
      analyticsTags: [
        operation.externalWrite ? "external-write" : "read",
        operation.adapterRecovery?.degradedMode ? "degraded" : "normal",
        operation.lifecycleVisibility?.operatorVisible ? "operator-visible" : "runtime-visible",
      ].sort(),
      nextAction: blockers.length
        ? blockers[0].startsWith("provider:")
          ? provider.nextAction || providerReadinessHandoff.nextAction
          : blockers[0].startsWith("permission:")
            ? permission.nextAction || permissionBoundaryHandoff.nextAction
            : blockers[0].startsWith("restart:")
              ? journal.nextAction || restartJournal.nextAction
              : blockers[0].startsWith("diagnostic:")
                ? "repair_package_diagnostics"
                : "repair_export_readiness_metadata"
        : pending.length
          ? provider.nextAction || permission.nextAction || journal.nextAction || "wait_for_export_readiness"
          : operation.externalWrite
            ? "release_export_ready_external_write_to_approval"
            : "release_export_ready_read_to_runtime",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.status === "metadata-incomplete");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.exportable && !row.pendingBy.length);
  const ledgerKey = stableId("export-ledger", [
    descriptor.id,
    exportSummary.status,
    rows.length,
    blockedRows.length,
    pendingRows.length,
    providerReadinessHandoff.handoffKey,
  ]);

  return {
    format: "aios.mailchimp.package.exportReadinessLedger.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    ledgerKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : readyRows.length === rows.length
          ? "export-ready"
          : "metadata-incomplete",
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      exportable: rows.filter((row) => row.exportable).length,
      statusPathLinked: rows.filter((row) => row.clientStatusPath).length,
      providerStatusLinked: rows.filter((row) => row.providerStatusPath).length,
      restartJournalLinked: rows.filter((row) => row.restartJournalEntryId).length,
      permissionPacketLinked: rows.filter((row) => row.permissionPacketId).length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    readyOperationIds: readyRows.map((row) => row.operationId).sort(),
    exportContract: {
      path: `mailchimp.packages.${descriptor.id}.exportReadiness`,
      rowShape: {
        operationId: "string",
        status: "string",
        requestId: "string",
        clientStatusPath: "string",
        providerStatusPath: "string|null",
        blockedBy: "array",
        pendingBy: "array",
        nextAction: "string",
      },
    },
    analyticsRollup: {
      packageStatus: exportSummary.status,
      packageExportableCount: analytics.counters.exportableOperationCount,
      diagnosticErrors: analytics.counters.diagnosticErrors,
      diagnosticWarnings: analytics.counters.diagnosticWarnings,
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || "publish_package_export_readiness_ledger",
  };
}

function buildClientHandoffReadinessPlan(descriptor, operations, acceptancePreview, providerReadinessHandoff, exportReadinessLedger) {
  const acceptanceByOperation = new Map((acceptancePreview.rows || []).map((row) => [row.operationId, row]));
  const providerByOperation = new Map((providerReadinessHandoff.rows || []).map((row) => [row.operationId, row]));
  const exportByOperation = new Map((exportReadinessLedger.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const acceptance = acceptanceByOperation.get(operation.id) || {};
    const provider = providerByOperation.get(operation.id) || {};
    const exportRow = exportByOperation.get(operation.id) || {};
    const lifecycle = operation.lifecycleVisibility || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const adapter = operation.adapterRecovery || {};
    const missing = [
      ...(!request.requestId ? ["request-id"] : []),
      ...(!client.statusPath ? ["client-status-path"] : []),
      ...(!client.progressPath ? ["client-progress-path"] : []),
      ...(!boundary.boundaryKey ? ["boundary-key"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["idempotency-key"] : []),
      ...(operation.externalWrite && !boundary.auditChannel ? ["audit-channel"] : []),
    ];
    const blockedBy = [
      ...(missing.map((item) => `metadata:${item}`)),
      ...(acceptance.accepted === false || acceptance.status === "blocked"
        ? [`package-acceptance:${acceptance.readiness || acceptance.status || "blocked"}`]
        : []),
      ...(provider.acceptedForProvider === false || provider.status === "blocked"
        ? [`provider-readiness:${provider.status || "blocked"}`]
        : []),
      ...(exportRow.acceptedForExport === false || exportRow.status === "blocked"
        ? [`export-readiness:${exportRow.status || "blocked"}`]
        : []),
      ...(lifecycle.status === "settings-blocked" || lifecycle.status === "disabled"
        ? [`lifecycle:${lifecycle.status}`]
        : []),
      ...(adapter.failed ? ["adapter:failed"] : []),
    ].sort();
    const pendingBy = [
      ...(provider.status === "pending" ? ["provider-readiness:pending"] : []),
      ...(exportRow.status === "pending" ? ["export-readiness:pending"] : []),
      ...(lifecycle.status === "scheduled" ? ["lifecycle:scheduled"] : []),
      ...(adapter.retryable ? ["adapter:retry-scheduled"] : []),
      ...(adapter.degradedMode ? ["adapter:degraded"] : []),
      ...(acceptance.status === "needs-review" ? ["package-acceptance:review"] : []),
    ].sort();
    const ready = blockedBy.length === 0 && pendingBy.length === 0;
    const status = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : operation.externalWrite
          ? "approval-ready"
          : "handoff-ready";
    const providerStatusPath = provider.providerStatusPath
      || exportRow.providerStatusPath
      || operation.clientRuntimeAdoption?.client?.providerStatusPath
      || null;
    const handoffId = stableId("client-handoff-row", [
      descriptor.id,
      operation.id,
      request.requestId,
      client.statusPath,
      providerStatusPath,
    ]);
    const statusPatch = {
      patchId: stableId("client-handoff-patch", [handoffId, status, client.statusPath]),
      statusPath: client.statusPath || null,
      progressPath: client.progressPath || null,
      providerStatusPath,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      state: ready
        ? operation.externalWrite
          ? "approval-ready"
          : "handoff-ready"
        : blockedBy.length
          ? "handoff-blocked"
          : "handoff-pending",
      visibleState: blockedBy.length
        ? "repair_required"
        : pendingBy.length
          ? "waiting"
          : operation.externalWrite
            ? "ready_for_approval"
            : "ready_for_handoff",
      patchable: Boolean(client.statusPath) && blockedBy.length === 0,
      blockedBy,
      pendingBy,
      nextAction: blockedBy.length
        ? "repair_client_handoff_before_status_patch"
        : pendingBy.length
          ? "wait_for_client_handoff_before_status_patch"
          : "publish_client_handoff_status_patch",
    };
    const runtimeCommand = {
      commandId: stableId("client-handoff-command", [
        handoffId,
        operation.externalWrite ? "present-approval" : "publish-handoff",
        request.idempotencyKey || request.replayToken,
      ]),
      operationId: operation.id,
      command: blockedBy.length
        ? "repair-client-handoff"
        : pendingBy.length
          ? "wait-client-handoff"
          : operation.externalWrite
            ? "present-approval"
            : "publish-handoff",
      enabled: ready,
      idempotent: Boolean(!operation.externalWrite || request.idempotencyKey),
      dedupeKey: request.idempotencyKey || request.replayToken || handoffId,
      replayToken: request.replayToken || null,
      requestId: request.requestId || null,
      statusPatchId: statusPatch.patchId,
      statusPath: client.statusPath || null,
      providerStatusPath,
      blockedBy,
      pendingBy,
      nextAction: ready
        ? operation.externalWrite
          ? "present_mailchimp_approval_handoff"
          : "publish_mailchimp_client_handoff"
        : statusPatch.nextAction,
    };

    return {
      index,
      handoffId,
      operationId: operation.id,
      status,
      acceptedForClient: ready,
      externalWrite: operation.externalWrite,
      blockedBy,
      pendingBy,
      requestId: request.requestId || null,
      idempotencyKeyPresent: Boolean(request.idempotencyKey),
      replayToken: request.replayToken || null,
      clientStatusPath: client.statusPath || null,
      clientProgressPath: client.progressPath || null,
      providerStatusPath,
      boundaryKey: boundary.boundaryKey || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      auditChannel: boundary.auditChannel || null,
      acceptanceKey: acceptancePreview.acceptanceKey || null,
      acceptanceStatus: acceptance.readiness || acceptancePreview.status || "unknown",
      providerReadinessId: provider.readinessId || provider.providerReadinessId || null,
      providerReadinessStatus: provider.status || providerReadinessHandoff.status || "unknown",
      exportLedgerKey: exportReadinessLedger.ledgerKey || null,
      exportReadinessStatus: exportRow.status || exportReadinessLedger.status || "unknown",
      visibleState: blockedBy.length
        ? "repair_required"
        : pendingBy.length
          ? "waiting"
          : operation.externalWrite
          ? "ready_for_approval"
            : "ready_for_handoff",
      statusPatch,
      runtimeCommand,
      commands: [
        ...(blockedBy.length ? [{
          command: "repair-client-handoff",
          statusPath: client.statusPath || null,
          providerStatusPath,
          statusPatchId: statusPatch.patchId,
          enabled: false,
          blockedBy,
        }] : []),
        ...(pendingBy.length ? [{
          command: "wait-client-handoff",
          statusPath: client.statusPath || null,
          statusPatchId: statusPatch.patchId,
          enabled: false,
          pendingBy,
        }] : []),
        ...(ready ? [{
          command: operation.externalWrite ? "present-approval" : "publish-handoff",
          commandId: runtimeCommand.commandId,
          enabled: true,
          requestId: request.requestId,
          statusPath: client.statusPath,
          providerStatusPath,
          replayToken: request.replayToken || null,
          idempotencyKey: request.idempotencyKey || null,
        }] : []),
      ],
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("metadata:")
          ? "repair_client_handoff_metadata"
          : blockedBy[0].startsWith("package-acceptance:")
            ? acceptance.nextStep?.action || acceptancePreview.nextAction || "repair_package_acceptance_preview"
            : blockedBy[0].startsWith("provider-readiness:")
              ? provider.nextAction || providerReadinessHandoff.nextAction || "repair_provider_readiness_handoff"
              : blockedBy[0].startsWith("export-readiness:")
                ? exportRow.nextAction || exportReadinessLedger.nextAction || "repair_package_export_readiness"
                : lifecycle.nextAction || adapter.recovery?.nextAction || "repair_client_handoff"
        : pendingBy.length
          ? provider.nextAction || exportRow.nextAction || lifecycle.nextAction || "wait_for_client_handoff_readiness"
          : operation.externalWrite
            ? "present_mailchimp_approval_handoff"
            : "publish_mailchimp_client_handoff",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.acceptedForClient);
  const planKey = stableId("client_handoff", [
    descriptor.id,
    acceptancePreview.acceptanceKey,
    providerReadinessHandoff.handoffKey,
    exportReadinessLedger.ledgerKey,
    blockedRows.length,
    pendingRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.clientHandoffReadiness.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    planKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "ready",
    acceptedForClient: blockedRows.length === 0 && pendingRows.length === 0,
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      repairCommands: rows.reduce((total, row) => total + row.commands.filter((command) => command.command === "repair-client-handoff").length, 0),
      publishCommands: rows.reduce((total, row) => total + row.commands.filter((command) => command.command === "publish-handoff").length, 0),
      approvalCommands: rows.reduce((total, row) => total + row.commands.filter((command) => command.command === "present-approval").length, 0),
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    routeContract: {
      readinessPath: `mailchimp.packages.${descriptor.id}.clientHandoff`,
      payloadShape: {
        planKey: "string",
        operationId: "string",
        status: "blocked|pending|approval-ready|handoff-ready",
        requestId: "string|null",
        clientStatusPath: "string|null",
        providerStatusPath: "string|null",
        statusPatch: "object",
        runtimeCommand: "object",
        blockedBy: "array",
        pendingBy: "array",
        commands: "array",
      },
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || (rows.some((row) => row.externalWrite)
        ? "present_mailchimp_approval_handoffs"
        : "publish_mailchimp_client_handoffs"),
  };
}

function buildExternalProviderHandoffLedger(descriptor, operations, providerServiceNegotiation, providerReadinessHandoff, exportReadinessLedger, clientHandoffReadiness) {
  const providerNegotiationByOperation = new Map((providerServiceNegotiation.rows || []).map((row) => [row.operationId, row]));
  const providerReadinessByOperation = new Map((providerReadinessHandoff.rows || []).map((row) => [row.operationId, row]));
  const exportByOperation = new Map((exportReadinessLedger.rows || []).map((row) => [row.operationId, row]));
  const clientHandoffByOperation = new Map((clientHandoffReadiness.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const negotiation = providerNegotiationByOperation.get(operation.id) || {};
    const readiness = providerReadinessByOperation.get(operation.id) || {};
    const exportRow = exportByOperation.get(operation.id) || {};
    const clientHandoff = clientHandoffByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const persisted = operation.persistedState || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const adapter = operation.adapterRecovery || {};
    const externalCapabilities = negotiation.externalCapabilities || readiness.externalCapabilities || [];
    const delegatedCapabilities = negotiation.delegatedCapabilities || readiness.delegatedCapabilities || [];
    const requiresProviderDispatch = operation.externalWrite || externalCapabilities.length > 0;
    const providerStatusPath = negotiation.providerStatusPath
      || readiness.providerStatusPath
      || exportRow.providerStatusPath
      || clientHandoff.providerStatusPath
      || operation.clientRuntimeAdoption?.client?.providerStatusPath
      || null;
    const blockedBy = [
      ...(!request.requestId ? ["request:request-id-missing"] : []),
      ...(!client.statusPath ? ["client:status-path-missing"] : []),
      ...(!persisted.snapshotKey ? ["persisted:snapshot-key-missing"] : []),
      ...(!persisted.ledgerKey ? ["persisted:ledger-key-missing"] : []),
      ...(requiresProviderDispatch && !request.idempotencyKey ? ["request:idempotency-key-missing"] : []),
      ...(boundary.status !== "ready" ? [`boundary:${boundary.status || "blocked"}`] : []),
      ...(!providerStatusPath ? ["provider:status-path-missing"] : []),
      ...(negotiation.negotiable === false && !["provider-degraded", "retry-scheduled"].includes(negotiation.status)
        ? [`provider-negotiation:${negotiation.status || "blocked"}`]
        : []),
      ...(readiness.status === "blocked" ? readiness.blockedBy.map((blocker) => `provider-readiness:${blocker}`) : []),
      ...(exportRow.status === "blocked" || exportRow.status === "metadata-incomplete"
        ? [`export-readiness:${exportRow.status}`]
        : []),
      ...((exportRow.blockedBy || []).map((blocker) => `export-readiness:${blocker}`)),
      ...(clientHandoff.status === "blocked" ? clientHandoff.blockedBy.map((blocker) => `client-handoff:${blocker}`) : []),
      ...(adapter.failed ? [`adapter:${adapter.status || "failed"}`] : []),
    ].sort();
    const pendingBy = [
      ...(readiness.status === "pending" ? readiness.pendingBy.map((pending) => `provider-readiness:${pending}`) : []),
      ...(exportRow.status === "pending" ? exportRow.pendingBy.map((pending) => `export-readiness:${pending}`) : []),
      ...(clientHandoff.status === "pending" ? clientHandoff.pendingBy.map((pending) => `client-handoff:${pending}`) : []),
      ...(adapter.retryable ? ["adapter:retry-scheduled"] : []),
      ...(adapter.degradedMode ? ["adapter:degraded"] : []),
      ...(operation.lifecycleVisibility?.status === "scheduled" ? ["lifecycle:scheduled"] : []),
      ...(operation.lifecycleVisibility?.status === "waiting-for-approval" ? ["approval:operator-required"] : []),
    ].sort();
    const commandEnabled = blockedBy.length === 0
      && pendingBy.length === 0
      && exportRow.exportable !== false
      && clientHandoff.acceptedForClient !== false;
    const status = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : commandEnabled
          ? requiresProviderDispatch
            ? "provider-dispatch-ready"
            : "runtime-delegation-ready"
          : "waiting";
    const ledgerEntryId = stableId("external-handoff-entry", [
      descriptor.id,
      operation.id,
      request.requestId,
      providerStatusPath,
      exportReadinessLedger.ledgerKey,
      clientHandoffReadiness.planKey,
      status,
    ]);
    const statusPatch = {
      format: "aios.mailchimp.package.externalProviderStatusPatch.v1",
      patchId: stableId("external-handoff-status", [
        descriptor.id,
        operation.id,
        ledgerEntryId,
        client.statusPath,
        providerStatusPath,
      ]),
      patchable: Boolean(client.statusPath && providerStatusPath && blockedBy.length === 0),
      statusPath: client.statusPath || null,
      providerStatusPath,
      state: blockedBy.length
        ? "provider_handoff_blocked"
        : pendingBy.length
          ? "provider_handoff_pending"
          : requiresProviderDispatch
            ? "provider_dispatch_ready"
            : "runtime_delegation_ready",
      visibleState: blockedBy.length
        ? "failed"
        : pendingBy.length
          ? "running"
          : requiresProviderDispatch
            ? "waiting_for_provider_handoff"
            : "queued",
      blockedBy: [
        ...(!client.statusPath ? ["client:status-path-missing"] : []),
        ...(!providerStatusPath ? ["provider:status-path-missing"] : []),
        ...(blockedBy.length ? ["external-handoff:blocked"] : []),
      ].sort(),
      fields: client.statusPath && providerStatusPath && blockedBy.length === 0
        ? {
          provider: "mailchimp",
          packageId: descriptor.id,
          operationId: operation.id,
          requestId: request.requestId || null,
          externalHandoffEntryId: ledgerEntryId,
          providerStatusPath,
          externalWrite: requiresProviderDispatch,
          exportLedgerKey: exportReadinessLedger.ledgerKey,
          clientHandoffPlanKey: clientHandoffReadiness.planKey,
          status,
        }
        : null,
      nextAction: !client.statusPath
        ? "repair_client_runtime_state"
        : !providerStatusPath
          ? "repair_provider_status_path"
          : blockedBy.length
            ? "repair_external_provider_handoff"
            : "publish_external_provider_handoff_status",
    };

    return {
      index,
      operationId: operation.id,
      ledgerEntryId,
      status,
      acceptedForProviderHandoff: commandEnabled,
      externalWrite: requiresProviderDispatch,
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      replayToken: request.replayToken || null,
      dedupeScope: request.dedupeScope || null,
      clientStatusPath: client.statusPath || null,
      providerStatusPath,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      boundaryKey: boundary.boundaryKey || null,
      snapshotKey: persisted.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || null,
      exportLedgerKey: exportReadinessLedger.ledgerKey || null,
      clientHandoffPlanKey: clientHandoffReadiness.planKey || null,
      providerReadinessId: readiness.readinessId || null,
      exportReadinessStatus: exportRow.status || "unknown",
      clientHandoffStatus: clientHandoff.status || "unknown",
      providerNegotiationStatus: negotiation.status || "unknown",
      externalCapabilities,
      delegatedCapabilities,
      blockedBy,
      pendingBy,
      statusPatch,
      command: {
        command: requiresProviderDispatch ? "dispatch-mailchimp-provider-handoff" : "delegate-mailchimp-runtime-handoff",
        enabled: commandEnabled,
        idempotencyKey: request.idempotencyKey || `external-provider-handoff:${ledgerEntryId}`,
        statusPath: client.statusPath || null,
        providerStatusPath,
        replayToken: request.replayToken || null,
        payload: commandEnabled
          ? {
            provider: "mailchimp",
            service: compactString(operation.adapter, "mailchimp"),
            packageId: descriptor.id,
            operationId: operation.id,
            requestId: request.requestId || null,
            idempotencyKey: request.idempotencyKey || null,
            clientStatusPath: client.statusPath || null,
            providerStatusPath,
            boundaryKey: boundary.boundaryKey || null,
            snapshotKey: persisted.snapshotKey || null,
            ledgerKey: persisted.ledgerKey || null,
            externalCapabilities,
            delegatedCapabilities,
          }
          : null,
      },
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("provider-readiness:")
          ? readiness.nextAction || providerReadinessHandoff.nextAction || "repair_provider_readiness_handoff"
          : blockedBy[0].startsWith("export-readiness:")
            ? exportRow.nextAction || exportReadinessLedger.nextAction || "repair_package_export_readiness"
            : blockedBy[0].startsWith("client-handoff:")
              ? clientHandoff.nextAction || clientHandoffReadiness.nextAction || "repair_client_handoff_readiness"
              : blockedBy[0].startsWith("provider-negotiation:")
                ? negotiation.handoffState?.nextAction || providerServiceNegotiation.externalHandoff?.nextAction || "repair_provider_negotiation"
                : blockedBy[0].startsWith("adapter:")
                  ? adapter.recovery?.nextAction || "surface_adapter_failure_to_operator"
                  : "repair_external_provider_handoff"
        : pendingBy.length
          ? readiness.nextAction || exportRow.nextAction || clientHandoff.nextAction || "wait_for_external_provider_handoff"
          : requiresProviderDispatch
            ? "dispatch_mailchimp_provider_handoff"
            : "delegate_mailchimp_runtime_handoff",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.acceptedForProviderHandoff);
  const ledgerKey = stableId("external-handoff-ledger", [
    descriptor.id,
    providerServiceNegotiation.syncKey,
    providerReadinessHandoff.handoffKey,
    exportReadinessLedger.ledgerKey,
    clientHandoffReadiness.planKey,
    blockedRows.length,
    pendingRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.externalProviderHandoffLedger.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    ledgerKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : readyRows.length === rows.length
          ? "handoff-ready"
          : "waiting",
    acceptedForProviderHandoff: blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.acceptedForProviderHandoff),
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      commandEnabled: rows.filter((row) => row.command.enabled).length,
      statusPatchable: rows.filter((row) => row.statusPatch.patchable).length,
      providerStatusLinked: rows.filter((row) => row.providerStatusPath).length,
    },
    commands: rows.map((row) => row.command),
    statusPatches: rows.map((row) => row.statusPatch),
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    readyOperationIds: readyRows.map((row) => row.operationId).sort(),
    handoffContract: {
      ledgerPath: `mailchimp.packages.${descriptor.id}.externalProviderHandoff`,
      commandShape: {
        command: "dispatch-mailchimp-provider-handoff|delegate-mailchimp-runtime-handoff",
        idempotencyKey: "string",
        statusPath: "string|null",
        providerStatusPath: "string|null",
        payload: "object|null",
      },
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || (rows.some((row) => row.externalWrite)
        ? "dispatch_mailchimp_provider_handoffs"
        : "delegate_mailchimp_runtime_handoffs"),
  };
}

function normalizeProviderCallbackReceipt(operation, observed = {}, expected = {}) {
  const callback = observed.callbackReceipt
    || observed.providerCallback
    || observed.webhookReceipt
    || operation.providerCallbackReceipt
    || operation.providerDeliveryCallback
    || {};
  const payload = callback.payload || callback.body || {};
  const headers = callback.headers || {};
  const requestId = compactString(
    callback.requestId
      || payload.requestId
      || payload.request_id
      || headers["x-aios-request-id"]
      || observed.requestId,
  );
  const idempotencyKey = compactString(
    callback.idempotencyKey
      || payload.idempotencyKey
      || payload.idempotency_key
      || headers["idempotency-key"]
      || headers["x-idempotency-key"]
      || observed.idempotencyKey,
  );
  const providerStatusPath = compactString(
    callback.providerStatusPath
      || payload.providerStatusPath
      || payload.provider_status_path
      || observed.providerStatusPath,
  );
  const externalProviderHandoffEntryId = compactString(
    callback.externalProviderHandoffEntryId
      || payload.externalProviderHandoffEntryId
      || payload.external_provider_handoff_entry_id
      || observed.externalProviderHandoffEntryId,
  );
  const providerDeliveryId = compactString(
    callback.providerDeliveryId
      || payload.providerDeliveryId
      || payload.provider_delivery_id
      || payload.deliveryId
      || observed.providerDeliveryId
      || observed.deliveryId,
  );
  const receivedAt = compactString(
    callback.receivedAt
      || callback.at
      || payload.receivedAt
      || payload.received_at
      || observed.receivedAt
      || observed.at,
  );
  const statusPatchId = compactString(
    callback.statusPatchId
      || callback.patchId
      || callback.statusPatch?.patchId
      || payload.statusPatchId
      || payload.status_patch_id
      || observed.statusPatchId
      || observed.patchId
      || observed.statusPatch?.patchId,
  );
  const status = compactString(callback.status || payload.status || observed.status);
  const event = compactString(callback.event || payload.event || observed.event);
  const accepted = callback.accepted === true
    || callback.acknowledged === true
    || observed.accepted === true
    || ["accepted", "delivered", "acknowledged", "sent"].includes(status)
    || ["mailchimp.delivery.accepted", "mailchimp.delivery.acknowledged"].includes(event);
  const metadataMatches = accepted
    && (!requestId || !expected.requestId || requestId === expected.requestId)
    && (!idempotencyKey || !expected.idempotencyKey || idempotencyKey === expected.idempotencyKey)
    && (!providerStatusPath || !expected.providerStatusPath || providerStatusPath === expected.providerStatusPath)
    && (!externalProviderHandoffEntryId
      || !expected.externalProviderHandoffEntryId
      || externalProviderHandoffEntryId === expected.externalProviderHandoffEntryId);
  const missingFields = [
    ...(accepted && !providerDeliveryId ? ["providerDeliveryId"] : []),
    ...(accepted && !receivedAt ? ["receivedAt"] : []),
    ...(accepted && !requestId ? ["requestId"] : []),
    ...(accepted && !providerStatusPath ? ["providerStatusPath"] : []),
    ...(accepted && expected.requiresProviderAck && !idempotencyKey ? ["idempotencyKey"] : []),
    ...(accepted && !statusPatchId ? ["statusPatchId"] : []),
  ];
  const blockedBy = [
    ...(accepted && !metadataMatches ? ["callback:metadata-mismatch"] : []),
    ...missingFields.map((field) => `callback:${field}-missing`),
  ].sort();

  return {
    present: Boolean(callback && Object.keys(callback).length),
    accepted,
    metadataMatches,
    status: blockedBy.length
      ? "blocked"
      : accepted
        ? "accepted"
        : "not-observed",
    event: event || null,
    providerDeliveryId: providerDeliveryId || null,
    requestId: requestId || null,
    idempotencyKey: idempotencyKey || null,
    providerStatusPath: providerStatusPath || null,
    externalProviderHandoffEntryId: externalProviderHandoffEntryId || null,
    receivedAt: receivedAt || null,
    statusPatchId: statusPatchId || null,
    missingFields,
    blockedBy,
    nextAction: blockedBy.length
      ? "repair_provider_callback_receipt"
      : accepted
        ? "attach_provider_callback_receipt_to_acknowledgement"
        : "wait_for_provider_callback_receipt",
  };
}

function buildProviderDeliveryAcknowledgementLedger(descriptor, operations, externalProviderHandoffLedger) {
  const handoffByOperation = new Map((externalProviderHandoffLedger.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const handoff = handoffByOperation.get(operation.id) || {};
    const command = handoff.command || {};
    const payload = command.payload || {};
    const statusPatch = handoff.statusPatch || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const persisted = operation.persistedState || {};
    const providerStatusPath = handoff.providerStatusPath
      || payload.providerStatusPath
      || operation.clientRuntimeAdoption?.client?.providerStatusPath
      || null;
    const observed = operation.providerDeliveryAcknowledgement?.observed
      || operation.providerDeliveryAcknowledgement?.acknowledgement
      || operation.providerDeliveryAcknowledgement
      || {};
    const ackId = stableId("provider-delivery-ack", [
      descriptor.id,
      operation.id,
      handoff.ledgerEntryId,
      request.requestId,
      providerStatusPath,
      persisted.snapshotKey,
    ]);
    const expectedAckPath = `${providerStatusPath || `mailchimp.operations.${operation.id}.provider`}.ack`;
    const requiresProviderAck = handoff.externalWrite === true || operation.externalWrite === true;
    const commandEnabled = command.enabled === true;
    const patchable = statusPatch.patchable === true;
    const callbackReceipt = normalizeProviderCallbackReceipt(operation, observed, {
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      providerStatusPath,
      externalProviderHandoffEntryId: handoff.ledgerEntryId || null,
      requiresProviderAck,
    });
    const observedAccepted = callbackReceipt.accepted
      || observed.accepted === true
      || observed.status === "accepted"
      || observed.status === "delivered";
    const observedProviderDeliveryId = compactString(callbackReceipt.providerDeliveryId || observed.providerDeliveryId || observed.deliveryId);
    const observedReceivedAt = compactString(callbackReceipt.receivedAt || observed.receivedAt || observed.at);
    const observedStatusPatchId = compactString(
      callbackReceipt.statusPatchId || observed.statusPatchId || observed.patchId || observed.statusPatch?.patchId,
    );
    const observedMatches = observedAccepted
      && (callbackReceipt.metadataMatches || (
        (!observed.requestId || observed.requestId === request.requestId)
        && (!observed.providerStatusPath || observed.providerStatusPath === providerStatusPath)
        && (!observed.idempotencyKey || observed.idempotencyKey === request.idempotencyKey)
        && (!observed.externalProviderHandoffEntryId || observed.externalProviderHandoffEntryId === handoff.ledgerEntryId)
      ));
    const acknowledgementEvidenceId = stableId("provider-ack-evidence", [
      descriptor.id,
      operation.id,
      ackId,
      observedProviderDeliveryId,
      observedReceivedAt,
      observedStatusPatchId,
    ]);
    const missingObservedFields = [
      ...(observedAccepted && !observedProviderDeliveryId ? ["providerDeliveryId"] : []),
      ...(observedAccepted && !observedReceivedAt ? ["receivedAt"] : []),
      ...(observedAccepted && !observed.requestId ? ["requestId"] : []),
      ...(observedAccepted && !observed.providerStatusPath ? ["providerStatusPath"] : []),
      ...(observedAccepted && requiresProviderAck && !observed.idempotencyKey ? ["idempotencyKey"] : []),
      ...(observedAccepted && !observedStatusPatchId ? ["statusPatchId"] : []),
    ];
    const blockedBy = [
      ...(!handoff.ledgerEntryId ? ["handoff:ledger-entry-missing"] : []),
      ...(handoff.status === "blocked" ? ["handoff:blocked"] : []),
      ...(requiresProviderAck && !commandEnabled ? ["command:not-enabled"] : []),
      ...(!request.requestId ? ["request:request-id-missing"] : []),
      ...(requiresProviderAck && !request.idempotencyKey ? ["request:idempotency-key-missing"] : []),
      ...(observedAccepted && !observedMatches ? ["provider:ack-metadata-mismatch"] : []),
      ...callbackReceipt.blockedBy.map((blocker) => `provider:${blocker}`),
      ...missingObservedFields.map((field) => `provider:ack-${field}-missing`),
      ...(!client.statusPath ? ["client:status-path-missing"] : []),
      ...(!providerStatusPath ? ["provider:status-path-missing"] : []),
      ...(!persisted.snapshotKey ? ["persisted:snapshot-key-missing"] : []),
      ...(!persisted.ledgerKey ? ["persisted:ledger-key-missing"] : []),
      ...(requiresProviderAck && !patchable ? ["status-patch:not-patchable"] : []),
    ].sort();
    const pendingBy = [
      ...(handoff.status === "pending" ? (handoff.pendingBy || ["handoff:pending"]).map((pending) => `handoff:${pending}`) : []),
      ...(requiresProviderAck && commandEnabled && patchable && !observedMatches ? ["provider:ack-not-observed"] : []),
      ...(operation.adapterRecovery?.retryable ? ["adapter:retry-scheduled"] : []),
      ...(operation.adapterRecovery?.degradedMode ? ["adapter:degraded"] : []),
    ].sort();
    const ackStatus = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : requiresProviderAck && observedMatches
          ? "accepted"
          : requiresProviderAck
          ? "ack-required"
          : "not-required";
    const evidenceStatus = !requiresProviderAck
      ? "not-required"
      : blockedBy.length
        ? "blocked"
        : observedMatches
          ? "accepted"
          : commandEnabled && patchable
            ? "awaiting-provider"
            : "not-ready";
    const evidenceAdapter = {
      format: "aios.mailchimp.package.providerDeliveryAckEvidence.v1",
      evidenceId: acknowledgementEvidenceId,
      operationId: operation.id,
      ackId,
      status: evidenceStatus,
      required: requiresProviderAck,
      acceptedForTruthHandoff: evidenceStatus === "accepted" || evidenceStatus === "not-required",
      expected: {
        provider: "mailchimp",
        requestId: request.requestId || null,
        idempotencyKey: request.idempotencyKey || null,
        providerStatusPath,
        expectedAckPath,
        externalProviderHandoffEntryId: handoff.ledgerEntryId || null,
        statusPatchId: statusPatch.patchId || null,
        callbackReceiptRequired: requiresProviderAck,
      },
      observed: {
        accepted: observedMatches,
        providerDeliveryId: observedProviderDeliveryId || null,
        requestId: callbackReceipt.requestId || observed.requestId || null,
        idempotencyKey: callbackReceipt.idempotencyKey || observed.idempotencyKey || null,
        providerStatusPath: callbackReceipt.providerStatusPath || observed.providerStatusPath || null,
        externalProviderHandoffEntryId: callbackReceipt.externalProviderHandoffEntryId || observed.externalProviderHandoffEntryId || null,
        receivedAt: observedReceivedAt || null,
        statusPatchId: observedStatusPatchId || null,
      },
      callbackReceipt,
      requiredFields: [
        "providerDeliveryId",
        "requestId",
        "providerStatusPath",
        "receivedAt",
        "statusPatchId",
        ...(requiresProviderAck ? ["idempotencyKey"] : []),
      ],
      missingObservedFields,
      blockedBy: blockedBy.filter((blocker) => (
        blocker.startsWith("provider:ack-")
        || blocker === "provider:ack-metadata-mismatch"
        || blocker.startsWith("provider:callback:")
      )),
      pendingBy: pendingBy.filter((pending) => pending.startsWith("provider:ack-")),
      replay: {
        safeToPoll: Boolean(providerStatusPath && request.requestId && !blockedBy.includes("provider:ack-metadata-mismatch")),
        dedupeKey: request.idempotencyKey || `provider-delivery-ack:${ackId}`,
        providerStatusPath,
        expectedAckPath,
      },
      handoffState: {
        state: evidenceStatus === "accepted"
          ? "provider_ack_observed"
          : evidenceStatus === "awaiting-provider"
            ? "provider_ack_waiting"
            : evidenceStatus === "blocked"
              ? "provider_ack_blocked"
              : "provider_ack_not_required",
        clientStatusPath: client.statusPath || null,
        providerStatusPath,
        nextAction: evidenceStatus === "accepted"
          ? "attach_provider_ack_evidence_to_truth_boundary"
          : evidenceStatus === "awaiting-provider"
            ? "poll_provider_acknowledgement"
            : evidenceStatus === "blocked"
              ? "repair_provider_ack_evidence"
              : "continue_without_provider_ack_evidence",
      },
    };
    const acknowledgement = {
      ackId,
      required: requiresProviderAck,
      accepted: !requiresProviderAck || (blockedBy.length === 0 && pendingBy.length === 0),
      observed: {
        accepted: observedMatches,
        providerDeliveryId: observedProviderDeliveryId || null,
        requestId: callbackReceipt.requestId || observed.requestId || null,
        providerStatusPath: callbackReceipt.providerStatusPath || observed.providerStatusPath || null,
        receivedAt: observedReceivedAt || null,
        statusPatchId: observedStatusPatchId || null,
      },
      callbackReceipt,
      expectedAckPath,
      requiredFields: [
        "provider",
        "operationId",
        "requestId",
        "providerStatusPath",
        "receivedAt",
        ...(requiresProviderAck ? ["idempotencyKey", "providerDeliveryId"] : []),
      ],
      blockedBy,
      pendingBy,
      evidenceAdapter,
      statusPatch: {
        patchId: stableId("provider-delivery-ack-status", [
          descriptor.id,
          operation.id,
          ackId,
          client.statusPath,
          providerStatusPath,
        ]),
        patchable: Boolean(client.statusPath && providerStatusPath && blockedBy.length === 0),
        statusPath: client.statusPath || null,
        providerStatusPath,
        ackPath: expectedAckPath,
        state: blockedBy.length
          ? "provider_delivery_ack_blocked"
          : pendingBy.length
            ? "provider_delivery_ack_pending"
            : requiresProviderAck
              ? "provider_delivery_ack_ready"
              : "provider_delivery_ack_not_required",
        visibleState: blockedBy.length
          ? "failed"
          : pendingBy.length
            ? "running"
            : requiresProviderAck
              ? "waiting_for_provider_ack"
              : "queued",
        fields: client.statusPath && providerStatusPath && blockedBy.length === 0
          ? {
            provider: "mailchimp",
            packageId: descriptor.id,
            operationId: operation.id,
            requestId: request.requestId || null,
            idempotencyKey: request.idempotencyKey || null,
            externalProviderHandoffEntryId: handoff.ledgerEntryId || null,
            providerDeliveryAckId: ackId,
            providerDeliveryAckEvidenceId: acknowledgementEvidenceId,
            providerCallbackReceiptStatus: callbackReceipt.status,
            providerStatusPath,
            expectedAckPath,
            snapshotKey: persisted.snapshotKey || null,
            ledgerKey: persisted.ledgerKey || null,
            required: requiresProviderAck,
          }
          : null,
        blockedBy: [
          ...(!client.statusPath ? ["client:status-path-missing"] : []),
          ...(!providerStatusPath ? ["provider:status-path-missing"] : []),
          ...(blockedBy.length ? ["provider-delivery-ack:blocked"] : []),
        ].sort(),
        nextAction: !client.statusPath
          ? "repair_client_runtime_state"
          : !providerStatusPath
            ? "repair_provider_status_path"
            : blockedBy.length
              ? "repair_provider_delivery_acknowledgement"
              : "publish_provider_delivery_ack_status",
      },
    };

    return {
      index,
      operationId: operation.id,
      ackId,
      status: ackStatus,
      required: requiresProviderAck,
      acceptedForTruthHandoff: acknowledgement.accepted,
      externalProviderHandoffEntryId: handoff.ledgerEntryId || null,
      requestId: request.requestId || null,
      idempotencyKey: request.idempotencyKey || null,
      clientStatusPath: client.statusPath || null,
      providerStatusPath,
      expectedAckPath,
      snapshotKey: persisted.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || null,
      blockedBy,
      pendingBy,
      evidenceAdapter,
      callbackReceipt,
      acknowledgement,
      command: {
        command: requiresProviderAck ? "observe-mailchimp-provider-delivery-ack" : "mark-mailchimp-delegation-ack-not-required",
        enabled: blockedBy.length === 0,
        idempotencyKey: request.idempotencyKey || `provider-delivery-ack:${ackId}`,
        statusPath: client.statusPath || null,
        providerStatusPath,
        ackPath: expectedAckPath,
        patch: acknowledgement.statusPatch,
        evidenceId: acknowledgementEvidenceId,
      },
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("handoff:")
          ? handoff.nextAction || externalProviderHandoffLedger.nextAction || "repair_external_provider_handoff"
          : "repair_provider_delivery_acknowledgement"
        : pendingBy.length
          ? "wait_for_provider_delivery_acknowledgement"
          : observedMatches
            ? "attach_provider_delivery_acknowledgement_to_truth_handoff"
          : requiresProviderAck
            ? "publish_provider_delivery_acknowledgement"
            : "continue_without_provider_delivery_ack",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const requiredRows = rows.filter((row) => row.required);
  const acceptedRows = rows.filter((row) => row.acceptedForTruthHandoff);
  const ledgerKey = stableId("provider-delivery-ack-ledger", [
    descriptor.id,
    externalProviderHandoffLedger.ledgerKey,
    blockedRows.length,
    pendingRows.length,
    requiredRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.providerDeliveryAcknowledgementLedger.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    ledgerKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : requiredRows.length
          ? "ack-ready"
          : "not-required",
    acceptedForTruthHandoff: blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.acceptedForTruthHandoff),
    rows,
    counters: {
      operations: rows.length,
      required: requiredRows.length,
      accepted: acceptedRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      patchable: rows.filter((row) => row.acknowledgement.statusPatch.patchable).length,
      providerStatusLinked: rows.filter((row) => row.providerStatusPath).length,
      callbackReceiptObserved: rows.filter((row) => row.callbackReceipt.present).length,
      callbackReceiptAccepted: rows.filter((row) => row.callbackReceipt.status === "accepted").length,
      callbackReceiptBlocked: rows.filter((row) => row.callbackReceipt.status === "blocked").length,
      evidenceAccepted: rows.filter((row) => row.evidenceAdapter.acceptedForTruthHandoff).length,
      evidenceBlocked: rows.filter((row) => row.evidenceAdapter.status === "blocked").length,
      evidenceAwaitingProvider: rows.filter((row) => row.evidenceAdapter.status === "awaiting-provider").length,
    },
    commands: rows.map((row) => row.command),
    statusPatches: rows.map((row) => row.acknowledgement.statusPatch),
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    readyOperationIds: acceptedRows.map((row) => row.operationId).sort(),
    handoffContract: {
      ledgerPath: `mailchimp.packages.${descriptor.id}.providerDeliveryAcknowledgements`,
      evidencePath: `mailchimp.packages.${descriptor.id}.providerDeliveryAckEvidence`,
      acknowledgementShape: {
        provider: "mailchimp",
        operationId: "string",
        requestId: "string",
        providerDeliveryId: "string",
        providerStatusPath: "string",
        receivedAt: "iso8601-string",
        statusPatchId: "string",
      },
      callbackReceiptShape: {
        event: "mailchimp.delivery.accepted",
        requestId: "string",
        idempotencyKey: "string",
        providerDeliveryId: "string",
        providerStatusPath: "string",
        externalProviderHandoffEntryId: "string",
        receivedAt: "iso8601-string",
        statusPatchId: "string",
      },
      truthEvidenceShape: {
        evidenceId: "string",
        ackId: "string",
        observed: "object",
        expected: "object",
        replay: "object",
        handoffState: "object",
      },
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || (requiredRows.length ? "publish_provider_delivery_acknowledgements" : externalProviderHandoffLedger.nextAction),
  };
}

function buildProviderDeliveryAckWorkflowHandoff(descriptor, providerDeliveryAcknowledgementLedger) {
  const rows = (providerDeliveryAcknowledgementLedger.rows || []).map((acknowledgement, index) => {
    const evidence = acknowledgement.evidenceAdapter || {};
    const statusPatch = acknowledgement.acknowledgement?.statusPatch || {};
    const replay = evidence.replay || {};
    const command = acknowledgement.command || {};
    const blockedBy = [
      ...(acknowledgement.blockedBy || []).map((blocker) => `ack:${blocker}`),
      ...(statusPatch.patchable === false ? (statusPatch.blockedBy || ["status-patch"]).map((blocker) => `status:${blocker}`) : []),
      ...(evidence.status === "blocked" ? (evidence.blockedBy || ["evidence"]).map((blocker) => `evidence:${blocker}`) : []),
      ...(acknowledgement.required && replay.safeToPoll !== true && evidence.status !== "accepted" ? ["replay:poll-not-safe"] : []),
      ...(acknowledgement.required && !command.enabled ? ["command:not-enabled"] : []),
    ].sort();
    const pendingBy = [
      ...(acknowledgement.pendingBy || []).map((pending) => `ack:${pending}`),
      ...(evidence.status === "awaiting-provider" ? ["evidence:awaiting-provider"] : []),
      ...(acknowledgement.status === "ack-required" ? ["provider:ack-required"] : []),
    ].sort();
    const accepted = acknowledgement.acceptedForTruthHandoff === true
      && evidence.acceptedForTruthHandoff === true
      && blockedBy.length === 0
      && pendingBy.length === 0;
    const workflowId = stableId("provider-ack-workflow", [
      descriptor.id,
      acknowledgement.operationId,
      acknowledgement.ackId,
      evidence.evidenceId,
      statusPatch.patchId,
    ]);
    const state = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : accepted
          ? "acknowledged"
          : acknowledgement.required
            ? "waiting"
            : "not-required";

    return {
      index,
      workflowId,
      operationId: acknowledgement.operationId,
      ackId: acknowledgement.ackId,
      evidenceId: evidence.evidenceId || null,
      required: acknowledgement.required === true,
      state,
      acceptedForApproval: accepted || acknowledgement.required !== true,
      acceptedForTruthHandoff: acknowledgement.acceptedForTruthHandoff === true,
      requestId: acknowledgement.requestId || null,
      idempotencyKey: acknowledgement.idempotencyKey || null,
      clientStatusPath: acknowledgement.clientStatusPath || statusPatch.statusPath || null,
      providerStatusPath: acknowledgement.providerStatusPath || statusPatch.providerStatusPath || null,
      expectedAckPath: acknowledgement.expectedAckPath || statusPatch.ackPath || null,
      statusPatch: {
        patchId: statusPatch.patchId || null,
        patchable: statusPatch.patchable === true,
        statusPath: statusPatch.statusPath || null,
        providerStatusPath: statusPatch.providerStatusPath || null,
        state: statusPatch.state || state,
        visibleState: statusPatch.visibleState || null,
        blockedBy: statusPatch.blockedBy || [],
        nextAction: statusPatch.nextAction || null,
      },
      replay: {
        safeToPoll: replay.safeToPoll === true,
        dedupeKey: replay.dedupeKey || command.idempotencyKey || null,
        providerStatusPath: replay.providerStatusPath || acknowledgement.providerStatusPath || null,
        expectedAckPath: replay.expectedAckPath || acknowledgement.expectedAckPath || null,
      },
      observed: evidence.observed || acknowledgement.acknowledgement?.observed || null,
      callbackReceipt: acknowledgement.callbackReceipt || evidence.callbackReceipt || null,
      blockedBy,
      pendingBy,
      command: {
        command: state === "blocked"
          ? "repair-mailchimp-provider-ack-workflow"
          : state === "pending" || state === "waiting"
            ? "poll-mailchimp-provider-ack-workflow"
            : "publish-mailchimp-provider-ack-workflow",
        enabled: blockedBy.length === 0 && (command.enabled === true || acknowledgement.required !== true),
        idempotencyKey: command.idempotencyKey || replay.dedupeKey || `provider-ack-workflow:${workflowId}`,
        statusPath: acknowledgement.clientStatusPath || statusPatch.statusPath || null,
        providerStatusPath: acknowledgement.providerStatusPath || statusPatch.providerStatusPath || null,
        ackPath: acknowledgement.expectedAckPath || statusPatch.ackPath || null,
        statusPatchId: statusPatch.patchId || null,
      },
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("ack:handoff:")
          ? "repair_external_provider_handoff"
          : blockedBy[0].startsWith("replay:")
            ? "repair_provider_ack_polling_contract"
            : "repair_provider_ack_workflow"
        : pendingBy.length
          ? "poll_provider_ack_workflow"
          : accepted
            ? "release_provider_ack_to_approval_export"
            : acknowledgement.required
              ? "publish_provider_ack_workflow_status"
              : "continue_without_provider_ack_workflow",
    };
  });
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const pendingRows = rows.filter((row) => row.state === "pending" || row.state === "waiting");
  const acceptedRows = rows.filter((row) => row.acceptedForApproval);
  const handoffKey = stableId("provider-ack-workflow-handoff", [
    descriptor.id,
    providerDeliveryAcknowledgementLedger.ledgerKey,
    blockedRows.length,
    pendingRows.length,
    acceptedRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.providerDeliveryAckWorkflowHandoff.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    handoffKey,
    ledgerKey: providerDeliveryAcknowledgementLedger.ledgerKey || null,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "ready",
    acceptedForApproval: blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.acceptedForApproval),
    rows,
    counters: {
      operations: rows.length,
      required: rows.filter((row) => row.required).length,
      acknowledged: rows.filter((row) => row.state === "acknowledged").length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      pollable: rows.filter((row) => row.replay.safeToPoll).length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      commandEnabled: rows.filter((row) => row.command.enabled).length,
      callbackReceiptObserved: rows.filter((row) => row.callbackReceipt?.present).length,
      callbackReceiptAccepted: rows.filter((row) => row.callbackReceipt?.status === "accepted").length,
      callbackReceiptBlocked: rows.filter((row) => row.callbackReceipt?.status === "blocked").length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    readyOperationIds: acceptedRows.map((row) => row.operationId).sort(),
    commands: rows.map((row) => row.command),
    userVisibleSummary: blockedRows.length
      ? `${blockedRows.length} Mailchimp provider acknowledgement workflow${blockedRows.length === 1 ? "" : "s"} need repair.`
      : pendingRows.length
        ? `${pendingRows.length} Mailchimp provider acknowledgement workflow${pendingRows.length === 1 ? "" : "s"} are waiting on provider confirmation.`
        : "Mailchimp provider acknowledgements are ready for approval export.",
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || "attach_provider_ack_workflow_to_approval_export",
  };
}

function buildOperationalIncidentLedger(
  descriptor,
  operations,
  analytics,
  lifecycleControlPlane,
  externalProviderHandoffLedger,
  providerDeliveryAcknowledgementLedger,
) {
  const lifecycleByOperation = new Map((lifecycleControlPlane.rows || []).map((row) => [row.operationId, row]));
  const handoffByOperation = new Map((externalProviderHandoffLedger.rows || []).map((row) => [row.operationId, row]));
  const acknowledgementByOperation = new Map((providerDeliveryAcknowledgementLedger.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const lifecycle = lifecycleByOperation.get(operation.id) || {};
    const handoff = handoffByOperation.get(operation.id) || {};
    const acknowledgement = acknowledgementByOperation.get(operation.id) || {};
    const adapter = operation.adapterRecovery || {};
    const health = operation.operationalHealth || {};
    const client = operation.runtimeClientState?.client || {};
    const request = operation.runtimeClientState?.request || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const receipt = operation.clientHandoffReceipt || {};
    const blockedBy = [
      ...(adapter.failed ? [`adapter:${adapter.status || "failed"}`] : []),
      ...(health.unavailable ? ["runtime:unavailable"] : []),
      ...(health.retry?.exhausted ? ["runtime:retry-exhausted"] : []),
      ...(boundary.status !== "ready" ? [`boundary:${boundary.status || "blocked"}`] : []),
      ...(receipt.acceptedForHandoff !== true ? [`receipt:${receipt.state || "not-accepted"}`] : []),
      ...(lifecycle.status === "blocked" ? (lifecycle.blockedBy || ["lifecycle:blocked"]).map((blocker) => `lifecycle:${blocker}`) : []),
      ...(handoff.status === "blocked" ? (handoff.blockedBy || ["handoff:blocked"]).map((blocker) => `handoff:${blocker}`) : []),
      ...(acknowledgement.status === "blocked" ? (acknowledgement.blockedBy || ["ack:blocked"]).map((blocker) => `ack:${blocker}`) : []),
    ].sort();
    const pendingBy = [
      ...(adapter.retryable ? ["adapter:retry-scheduled"] : []),
      ...(adapter.degradedMode ? ["adapter:degraded"] : []),
      ...(lifecycle.status === "pending" ? (lifecycle.pendingBy || ["lifecycle:pending"]).map((pending) => `lifecycle:${pending}`) : []),
      ...(handoff.status === "pending" ? (handoff.pendingBy || ["handoff:pending"]).map((pending) => `handoff:${pending}`) : []),
      ...(acknowledgement.status === "pending" ? (acknowledgement.pendingBy || ["ack:pending"]).map((pending) => `ack:${pending}`) : []),
      ...(operation.lifecycleVisibility?.status === "scheduled" ? ["lifecycle:scheduled"] : []),
      ...(operation.lifecycleVisibility?.status === "waiting-for-approval" ? ["approval:operator-required"] : []),
    ].sort();
    const severity = blockedBy.length
      ? "error"
      : pendingBy.length || adapter.degradedMode || health.degraded
        ? "warning"
        : "info";
    const incidentId = stableId("operational-incident", [
      descriptor.id,
      operation.id,
      client.statusPath,
      adapter.status,
      blockedBy.join(","),
      pendingBy.join(","),
    ]);
    const retryable = blockedBy.length === 0
      && (adapter.retryable === true || health.degraded === true)
      && health.retry?.exhausted !== true;
    const statusPatch = {
      patchId: stableId("operational-incident-status", [
        descriptor.id,
        operation.id,
        incidentId,
        client.statusPath,
      ]),
      patchable: Boolean(client.statusPath && request.requestId),
      statusPath: client.statusPath || null,
      providerStatusPath: handoff.providerStatusPath || acknowledgement.providerStatusPath || operation.clientRuntimeAdoption?.client?.providerStatusPath || null,
      state: blockedBy.length
        ? "operational_handoff_blocked"
        : pendingBy.length
          ? "operational_handoff_pending"
          : adapter.degradedMode
            ? "operational_handoff_degraded"
            : "operational_handoff_clear",
      visibleState: blockedBy.length
        ? "failed"
        : pendingBy.length || adapter.degradedMode
          ? "running"
          : "queued",
      fields: client.statusPath && request.requestId
        ? {
          provider: "mailchimp",
          packageId: descriptor.id,
          operationId: operation.id,
          incidentId,
          requestId: request.requestId,
          adapterStatus: adapter.status || "unknown",
          retryable,
          retryAfterMs: adapter.backoff?.nextDelayMs || health.retry?.nextDelayMs || 0,
          blockedBy,
          pendingBy,
        }
        : null,
      blockedBy: [
        ...(!client.statusPath ? ["client-status-path-missing"] : []),
        ...(!request.requestId ? ["request-id-missing"] : []),
      ],
      nextAction: !client.statusPath
        ? "repair_client_runtime_state"
        : !request.requestId
          ? "repair_runtime_request_state"
          : blockedBy.length
            ? "publish_operational_blocker_status"
            : pendingBy.length || adapter.degradedMode
              ? "publish_operational_pending_status"
              : "publish_operational_clear_status",
    };

    return {
      index,
      operationId: operation.id,
      incidentId,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : adapter.degradedMode || health.degraded
            ? "degraded"
            : "clear",
      severity,
      retryable,
      externalWrite: operation.externalWrite,
      requestId: request.requestId || null,
      clientStatusPath: client.statusPath || null,
      providerStatusPath: statusPatch.providerStatusPath,
      boundaryKey: boundary.boundaryKey || null,
      adapterStatus: adapter.status || "unknown",
      retryAfterMs: retryable ? adapter.backoff?.nextDelayMs || health.retry?.nextDelayMs || 0 : 0,
      blockedBy,
      pendingBy,
      statusPatch,
      command: {
        command: blockedBy.length ? "repair-operational-handoff" : "publish-operational-handoff-status",
        enabled: statusPatch.patchable,
        idempotencyKey: `operational-incident:${incidentId}`,
        statusPath: client.statusPath || null,
        providerStatusPath: statusPatch.providerStatusPath,
        patch: statusPatch.fields,
      },
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("adapter:")
          ? adapter.recovery?.nextAction || "surface_adapter_failure_to_operator"
          : blockedBy[0].startsWith("receipt:")
            ? receipt.nextAction || "refresh_client_handoff_receipt"
            : blockedBy[0].startsWith("handoff:")
              ? handoff.nextAction || externalProviderHandoffLedger.nextAction
              : blockedBy[0].startsWith("ack:")
                ? acknowledgement.nextAction || providerDeliveryAcknowledgementLedger.nextAction
                : "repair_operational_handoff_blocker"
        : pendingBy.length
          ? pendingBy[0].startsWith("approval:")
            ? "request_operator_approval"
            : adapter.recovery?.nextAction || handoff.nextAction || "wait_for_operational_handoff"
          : adapter.degradedMode
            ? "poll_mailchimp_provider_status"
            : "accept_operational_handoff_health",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const degradedRows = rows.filter((row) => row.status === "degraded");
  const ledgerKey = stableId("operational-incident-ledger", [
    descriptor.id,
    externalProviderHandoffLedger.ledgerKey,
    providerDeliveryAcknowledgementLedger.ledgerKey,
    blockedRows.length,
    pendingRows.length,
    degradedRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.operationalIncidentLedger.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    ledgerKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : degradedRows.length
          ? "degraded"
          : "clear",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0,
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      degraded: degradedRows.length,
      retryable: rows.filter((row) => row.retryable).length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      statusPatchable: rows.filter((row) => row.statusPatch.patchable).length,
      analyticsBlocked: analytics.blockedOperationIds.length,
      analyticsRetryable: analytics.retryableOperationIds.length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    degradedOperationIds: degradedRows.map((row) => row.operationId).sort(),
    commands: rows.map((row) => row.command),
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || degradedRows[0]?.nextAction
      || "publish_operational_incident_ledger",
  };
}

function buildOperationalAcceptanceMatrix(
  descriptor,
  operations,
  operationalIncidentLedger,
  lifecycleControlPlane,
  externalProviderHandoffLedger,
  providerDeliveryAcknowledgementLedger,
) {
  const incidentByOperation = new Map((operationalIncidentLedger.rows || []).map((row) => [row.operationId, row]));
  const lifecycleByOperation = new Map((lifecycleControlPlane.rows || []).map((row) => [row.operationId, row]));
  const handoffByOperation = new Map((externalProviderHandoffLedger.rows || []).map((row) => [row.operationId, row]));
  const acknowledgementByOperation = new Map((providerDeliveryAcknowledgementLedger.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const incident = incidentByOperation.get(operation.id) || {};
    const lifecycle = lifecycleByOperation.get(operation.id) || {};
    const handoff = handoffByOperation.get(operation.id) || {};
    const acknowledgement = acknowledgementByOperation.get(operation.id) || {};
    const adapter = operation.adapterRecovery || {};
    const health = operation.operationalHealth || {};
    const client = operation.runtimeClientState?.client || {};
    const request = operation.runtimeClientState?.request || {};
    const receipt = operation.clientHandoffReceipt || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const incidentPatch = incident.statusPatch || {};
    const lifecyclePatch = lifecycle.statusPatch || lifecycle.commands?.find((command) => command.statusPatch)?.statusPatch || {};
    const handoffPatch = handoff.statusPatch || {};
    const acknowledgementPatch = acknowledgement.acknowledgement?.statusPatch || acknowledgement.statusPatch || {};
    const retryAfterMs = adapter.backoff?.nextDelayMs || health.retry?.nextDelayMs || incident.retryAfterMs || 0;
    const canRetry = adapter.retryable === true
      || incident.retryable === true
      || (health.degraded === true && health.retry?.exhausted !== true);
    const blockedBy = [
      ...(incident.status === "blocked" ? (incident.blockedBy || ["incident-blocked"]).map((blocker) => `incident:${blocker}`) : []),
      ...(lifecycle.status === "blocked" ? (lifecycle.blockedBy || ["lifecycle-blocked"]).map((blocker) => `lifecycle:${blocker}`) : []),
      ...(handoff.status === "blocked" ? (handoff.blockedBy || ["handoff-blocked"]).map((blocker) => `handoff:${blocker}`) : []),
      ...(acknowledgement.status === "blocked" ? (acknowledgement.blockedBy || ["ack-blocked"]).map((blocker) => `ack:${blocker}`) : []),
      ...(adapter.failed ? [`adapter:${adapter.status || "failed"}`] : []),
      ...(health.retry?.exhausted ? ["runtime:retry-exhausted"] : []),
      ...(boundary.status !== "ready" ? [`boundary:${boundary.status || "blocked"}`] : []),
      ...(receipt.acceptedForHandoff !== true ? [`receipt:${receipt.state || "not-accepted"}`] : []),
      ...(!client.statusPath ? ["metadata:client-status-path"] : []),
      ...(!request.requestId ? ["metadata:request-id"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["metadata:idempotency-key"] : []),
    ].sort();
    const pendingBy = [
      ...(incident.status === "pending" || incident.status === "degraded" ? (incident.pendingBy || [incident.status]).map((pending) => `incident:${pending}`) : []),
      ...(lifecycle.status === "pending" ? (lifecycle.pendingBy || ["lifecycle-pending"]).map((pending) => `lifecycle:${pending}`) : []),
      ...(handoff.status === "pending" ? (handoff.pendingBy || ["handoff-pending"]).map((pending) => `handoff:${pending}`) : []),
      ...(acknowledgement.status === "pending" ? (acknowledgement.pendingBy || ["ack-pending"]).map((pending) => `ack:${pending}`) : []),
      ...(adapter.degradedMode ? ["adapter:degraded"] : []),
      ...(canRetry && retryAfterMs > 0 ? ["runtime:retry-backoff"] : []),
    ].sort();
    const patchable = Boolean(client.statusPath && request.requestId);
    const status = blockedBy.length
      ? "blocked"
      : canRetry && retryAfterMs > 0
        ? "retry-scheduled"
        : pendingBy.length
          ? "pending"
          : adapter.degradedMode || health.degraded
            ? "degraded"
            : "accepted";
    const acceptanceId = stableId("operational-acceptance", [
      descriptor.id,
      operation.id,
      status,
      incident.incidentId,
      client.statusPath,
    ]);
    const statusPatch = {
      patchId: stableId("operational-acceptance-status", [
        descriptor.id,
        operation.id,
        acceptanceId,
        client.statusPath,
      ]),
      patchable,
      statusPath: client.statusPath || null,
      progressPath: client.progressPath || null,
      providerStatusPath: handoff.providerStatusPath
        || acknowledgement.providerStatusPath
        || incident.providerStatusPath
        || operation.clientRuntimeAdoption?.client?.providerStatusPath
        || null,
      sourcePatchIds: [
        incidentPatch.patchId,
        lifecyclePatch.patchId,
        handoffPatch.patchId,
        acknowledgementPatch.patchId,
      ].filter(Boolean).sort(),
      state: status === "accepted"
        ? "operational_acceptance_ready"
        : status === "retry-scheduled"
          ? "operational_acceptance_retry_scheduled"
          : status === "degraded"
            ? "operational_acceptance_degraded"
            : status === "pending"
              ? "operational_acceptance_pending"
              : "operational_acceptance_blocked",
      visibleState: status === "accepted"
        ? "ready"
        : status === "blocked"
          ? "failed"
          : "running",
      fields: patchable
        ? {
          provider: "mailchimp",
          packageId: descriptor.id,
          operationId: operation.id,
          acceptanceId,
          requestId: request.requestId,
          status,
          retryAfterMs: status === "retry-scheduled" ? retryAfterMs : 0,
          blockedBy,
          pendingBy,
        }
        : null,
      blockedBy: [
        ...(!client.statusPath ? ["client-status-path-missing"] : []),
        ...(!request.requestId ? ["request-id-missing"] : []),
      ],
      nextAction: !patchable
        ? "repair_operational_acceptance_metadata"
        : status === "blocked"
          ? "publish_operational_acceptance_blocker"
          : status === "retry-scheduled"
            ? "publish_operational_retry_schedule"
            : status === "pending" || status === "degraded"
              ? "publish_operational_acceptance_pending"
              : "publish_operational_acceptance_ready",
    };

    return {
      index,
      operationId: operation.id,
      acceptanceId,
      status,
      acceptedForProvider: status === "accepted",
      acceptedForOwnership: status === "accepted" || status === "retry-scheduled",
      retryable: canRetry && blockedBy.length === 0,
      degradedMode: adapter.degradedMode === true || health.degraded === true,
      externalWrite: operation.externalWrite,
      requestId: request.requestId || null,
      idempotencyKeyPresent: Boolean(request.idempotencyKey),
      clientStatusPath: client.statusPath || null,
      providerStatusPath: statusPatch.providerStatusPath,
      incidentId: incident.incidentId || null,
      incidentStatus: incident.status || "not-provided",
      lifecycleStatus: lifecycle.status || "not-provided",
      handoffStatus: handoff.status || "not-provided",
      acknowledgementStatus: acknowledgement.status || "not-provided",
      retry: {
        attempt: health.retry?.attempt ?? adapter.backoff?.attempt ?? 0,
        maxAttempts: health.retry?.maxAttempts ?? adapter.backoff?.maxAttempts ?? 0,
        nextDelayMs: status === "retry-scheduled" ? retryAfterMs : 0,
        reason: health.retry?.reason || adapter.backoff?.reason || incident.status || status,
      },
      actionableError: status === "accepted"
        ? null
        : {
          code: blockedBy[0] || pendingBy[0] || `operational-acceptance:${status}`,
          severity: status === "blocked" ? "error" : "warning",
          message: adapter.failure?.message
            || health.lastError
            || "Mailchimp operational acceptance is not ready for provider handoff.",
          action: statusPatch.nextAction,
        },
      blockedBy,
      pendingBy,
      statusPatch,
      command: {
        command: status === "blocked"
          ? "repair-operational-acceptance"
          : status === "retry-scheduled"
            ? "schedule-operational-retry"
            : "publish-operational-acceptance",
        enabled: patchable && (status !== "blocked" || blockedBy.every((blocker) => blocker.startsWith("incident:"))),
        idempotencyKey: `operational-acceptance:${acceptanceId}`,
        statusPath: client.statusPath || null,
        providerStatusPath: statusPatch.providerStatusPath,
        patch: statusPatch.fields,
      },
      nextAction: status === "blocked"
        ? blockedBy[0]?.startsWith("adapter:")
          ? adapter.recovery?.nextAction || "surface_adapter_failure_to_operator"
          : blockedBy[0]?.startsWith("receipt:")
            ? receipt.nextAction || "refresh_client_handoff_receipt"
            : "repair_operational_acceptance_blocker"
        : status === "retry-scheduled"
          ? adapter.recovery?.nextAction || "retry_adapter_handoff_after_backoff"
          : status === "pending" || status === "degraded"
            ? incident.nextAction || "wait_for_operational_acceptance"
            : "accept_operational_provider_handoff",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const retryRows = rows.filter((row) => row.status === "retry-scheduled");
  const degradedRows = rows.filter((row) => row.status === "degraded");
  const matrixKey = stableId("operational-acceptance-matrix", [
    descriptor.id,
    operationalIncidentLedger.ledgerKey,
    lifecycleControlPlane.controlPlaneId,
    blockedRows.length,
    retryRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.operationalAcceptanceMatrix.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    matrixKey,
    status: blockedRows.length
      ? "blocked"
      : retryRows.length
        ? "retry-scheduled"
        : pendingRows.length
          ? "pending"
          : degradedRows.length
            ? "degraded"
            : "accepted",
    acceptedForProvider: blockedRows.length === 0 && pendingRows.length === 0 && retryRows.length === 0,
    rows,
    counters: {
      operations: rows.length,
      accepted: rows.filter((row) => row.status === "accepted").length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      retryScheduled: retryRows.length,
      degraded: degradedRows.length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      actionableErrors: rows.filter((row) => row.actionableError).length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    retryOperationIds: retryRows.map((row) => row.operationId).sort(),
    degradedOperationIds: degradedRows.map((row) => row.operationId).sort(),
    commands: rows.map((row) => row.command),
    nextAction: blockedRows[0]?.nextAction
      || retryRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || degradedRows[0]?.nextAction
      || "publish_operational_acceptance_matrix",
  };
}

function buildOperatorHandoffPacket(descriptor, operations, acceptancePreview, clientHandoffReadiness, providerReadinessHandoff, permissionBoundaryHandoff, exportReadinessLedger, externalProviderHandoffLedger, restartJournal) {
  const acceptanceByOperation = new Map((acceptancePreview.rows || []).map((row) => [row.operationId, row]));
  const clientByOperation = new Map((clientHandoffReadiness.rows || []).map((row) => [row.operationId, row]));
  const providerByOperation = new Map((providerReadinessHandoff.rows || []).map((row) => [row.operationId, row]));
  const permissionByOperation = new Map((permissionBoundaryHandoff.rows || []).map((row) => [row.operationId, row]));
  const exportByOperation = new Map((exportReadinessLedger.rows || []).map((row) => [row.operationId, row]));
  const externalByOperation = new Map((externalProviderHandoffLedger.rows || []).map((row) => [row.operationId, row]));
  const restartByOperation = new Map((restartJournal.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const acceptance = acceptanceByOperation.get(operation.id) || {};
    const client = clientByOperation.get(operation.id) || {};
    const provider = providerByOperation.get(operation.id) || {};
    const permission = permissionByOperation.get(operation.id) || {};
    const exportRow = exportByOperation.get(operation.id) || {};
    const external = externalByOperation.get(operation.id) || {};
    const restart = restartByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const runtimeClient = operation.runtimeClientState?.client || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const adapter = operation.adapterRecovery || {};
    const lifecycle = operation.lifecycleVisibility || {};
    const blockedBy = [
      ...(acceptance.accepted === false ? [`acceptance:${acceptance.readiness || "blocked"}`] : []),
      ...(client.status === "blocked" ? (client.blockedBy || ["client-handoff:blocked"]).map((blocker) => `client:${blocker}`) : []),
      ...(provider.status === "blocked" ? (provider.blockedBy || ["provider-readiness:blocked"]).map((blocker) => `provider:${blocker}`) : []),
      ...(permission.status === "blocked" ? (permission.blockedBy || ["permission:blocked"]).map((blocker) => `permission:${blocker}`) : []),
      ...(exportRow.status === "blocked" || exportRow.status === "metadata-incomplete"
        ? (exportRow.blockedBy?.length ? exportRow.blockedBy : [`export:${exportRow.status}`]).map((blocker) => `export:${blocker}`)
        : []),
      ...(external.status === "blocked" ? (external.blockedBy || ["external-handoff:blocked"]).map((blocker) => `external:${blocker}`) : []),
      ...(restart.status === "blocked" ? (restart.blockedBy || ["restart:blocked"]).map((blocker) => `restart:${blocker}`) : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["request:idempotency-key-missing"] : []),
      ...(!request.requestId ? ["request:request-id-missing"] : []),
      ...(!runtimeClient.statusPath ? ["client:status-path-missing"] : []),
      ...(boundary.status !== "ready" ? [`boundary:${boundary.status || "blocked"}`] : []),
    ].sort();
    const pendingBy = [
      ...(client.status === "pending" ? (client.pendingBy || ["client-handoff:pending"]).map((pending) => `client:${pending}`) : []),
      ...(provider.status === "pending" ? (provider.pendingBy || ["provider-readiness:pending"]).map((pending) => `provider:${pending}`) : []),
      ...(permission.status === "pending" ? (permission.pendingBy || ["permission:pending"]).map((pending) => `permission:${pending}`) : []),
      ...(exportRow.status === "pending" ? (exportRow.pendingBy || ["export:pending"]).map((pending) => `export:${pending}`) : []),
      ...(external.status === "pending" ? (external.pendingBy || ["external-handoff:pending"]).map((pending) => `external:${pending}`) : []),
      ...(restart.status === "pending" ? (restart.pendingBy || ["restart:pending"]).map((pending) => `restart:${pending}`) : []),
      ...(adapter.retryable ? ["adapter:retry-scheduled"] : []),
      ...(adapter.degradedMode ? ["adapter:degraded"] : []),
      ...(lifecycle.status === "scheduled" ? ["lifecycle:scheduled"] : []),
      ...(lifecycle.status === "waiting-for-approval" ? ["approval:operator-required"] : []),
    ].sort();
    const acceptedForOperator = blockedBy.length === 0;
    const status = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : operation.externalWrite
          ? "approval-ready"
          : "handoff-ready";
    const packetRowId = stableId("operator-row", [
      descriptor.id,
      operation.id,
      acceptance.previewId,
      clientHandoffReadiness.planKey,
      external.ledgerEntryId,
      status,
    ]);
    const command = operation.externalWrite ? "present-mailchimp-operator-approval" : "publish-mailchimp-runtime-handoff";

    return {
      index,
      operationId: operation.id,
      packetRowId,
      status,
      acceptedForOperator,
      externalWrite: operation.externalWrite,
      title: acceptance.title || runtimeClient.handoffLabel || `${operation.adapter}.${operation.operation}`,
      visibleState: blockedBy.length
        ? "repair_required"
        : pendingBy.length
          ? "waiting"
          : operation.externalWrite
            ? "ready_for_approval"
            : "ready_for_handoff",
      requestId: request.requestId || client.requestId || provider.requestId || external.requestId || null,
      idempotencyKeyPresent: Boolean(request.idempotencyKey || external.idempotencyKey),
      replayToken: request.replayToken || external.replayToken || null,
      clientStatusPath: runtimeClient.statusPath || client.clientStatusPath || external.clientStatusPath || null,
      providerStatusPath: client.providerStatusPath || provider.providerStatusPath || exportRow.providerStatusPath || external.providerStatusPath || null,
      boundaryStatusPath: boundary.handoffStatusPath || client.boundaryStatusPath || external.boundaryStatusPath || null,
      boundaryKey: boundary.boundaryKey || provider.boundaryKey || permission.boundary?.boundaryKey || external.boundaryKey || null,
      tenant: boundary.scope?.tenant || permission.boundary?.tenant || null,
      workspace: boundary.scope?.workspace || permission.boundary?.workspace || null,
      requiredRoles: permission.boundary?.requiredRoles || boundary.allowedRoles || [],
      acceptanceKey: acceptancePreview.acceptanceKey || null,
      acceptanceStatus: acceptance.readiness || acceptancePreview.status || "unknown",
      clientHandoffPlanKey: clientHandoffReadiness.planKey || null,
      providerReadinessId: provider.readinessId || null,
      permissionPacketId: permission.packetId || null,
      exportLedgerKey: exportReadinessLedger.ledgerKey || null,
      externalHandoffEntryId: external.ledgerEntryId || null,
      restartJournalEntryId: restart.journalEntryId || null,
      blockedBy,
      pendingBy,
      validationSummary: {
        errorCount: acceptance.validationSummary?.errorCount || 0,
        warningCount: acceptance.validationSummary?.warningCount || 0,
        blockingCodes: acceptance.validationSummary?.blockingCodes || [],
      },
      statusPatch: external.statusPatch || permission.statusPatch || restart.statusPatch || null,
      command: {
        command,
        enabled: acceptedForOperator && pendingBy.length === 0,
        idempotencyKey: request.idempotencyKey || `operator-handoff:${packetRowId}`,
        statusPath: runtimeClient.statusPath || client.clientStatusPath || null,
        providerStatusPath: external.providerStatusPath || provider.providerStatusPath || null,
        payload: acceptedForOperator
          ? {
            provider: "mailchimp",
            packageId: descriptor.id,
            operationId: operation.id,
            requestId: request.requestId || null,
            externalWrite: operation.externalWrite,
            clientStatusPath: runtimeClient.statusPath || null,
            providerStatusPath: external.providerStatusPath || provider.providerStatusPath || null,
            boundaryKey: boundary.boundaryKey || null,
            acceptanceKey: acceptancePreview.acceptanceKey || null,
            providerReadinessId: provider.readinessId || null,
            permissionPacketId: permission.packetId || null,
            exportLedgerKey: exportReadinessLedger.ledgerKey || null,
            externalHandoffEntryId: external.ledgerEntryId || null,
          }
          : null,
      },
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("acceptance:")
          ? acceptance.nextStep?.action || acceptancePreview.nextAction || "repair_package_acceptance_preview"
          : blockedBy[0].startsWith("client:")
            ? client.nextAction || clientHandoffReadiness.nextAction || "repair_client_handoff_readiness"
            : blockedBy[0].startsWith("provider:")
              ? provider.nextAction || providerReadinessHandoff.nextAction || "repair_provider_readiness_handoff"
              : blockedBy[0].startsWith("permission:")
                ? permission.nextAction || permissionBoundaryHandoff.nextAction || "repair_permission_boundary_handoff"
                : blockedBy[0].startsWith("export:")
                  ? exportRow.nextAction || exportReadinessLedger.nextAction || "repair_package_export_readiness"
                  : blockedBy[0].startsWith("external:")
                    ? external.nextAction || externalProviderHandoffLedger.nextAction || "repair_external_provider_handoff"
                    : blockedBy[0].startsWith("restart:")
                      ? restart.nextAction || restartJournal.nextAction || "repair_restart_journal"
                      : "repair_operator_handoff_packet"
        : pendingBy.length
          ? provider.nextAction || client.nextAction || exportRow.nextAction || external.nextAction || "wait_for_operator_handoff_readiness"
          : operation.externalWrite
            ? "present_mailchimp_operator_approval"
            : "publish_mailchimp_runtime_handoff",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.command.enabled);
  const packetId = stableId("operator-handoff", [
    descriptor.id,
    acceptancePreview.acceptanceKey,
    clientHandoffReadiness.planKey,
    externalProviderHandoffLedger.ledgerKey,
    blockedRows.length,
    pendingRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.operatorHandoffPacket.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    packetId,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "ready",
    acceptedForOperator: blockedRows.length === 0,
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      commandsEnabled: readyRows.length,
      statusPatchLinked: rows.filter((row) => row.statusPatch).length,
      validationErrors: rows.reduce((total, row) => total + row.validationSummary.errorCount, 0),
      validationWarnings: rows.reduce((total, row) => total + row.validationSummary.warningCount, 0),
    },
    routeContract: {
      packetPath: `mailchimp.packages.${descriptor.id}.operatorHandoff`,
      rowShape: {
        packetRowId: "string",
        operationId: "string",
        status: "blocked|pending|approval-ready|handoff-ready",
        visibleState: "string",
        requestId: "string|null",
        clientStatusPath: "string|null",
        providerStatusPath: "string|null",
        blockedBy: "array",
        pendingBy: "array",
        command: "object",
      },
    },
    commands: rows.map((row) => row.command),
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || (rows.some((row) => row.externalWrite)
        ? "present_mailchimp_operator_approvals"
        : "publish_mailchimp_runtime_handoffs"),
  };
}

function stablePackageClone(value) {
  if (Array.isArray(value)) return value.map(stablePackageClone);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stablePackageClone(nested)]),
    );
  }
  return value;
}

function packageAuditDigest(value) {
  const serialized = JSON.stringify(stablePackageClone(value));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildPackageExportAuditTrail(
  descriptor,
  operations,
  historySnapshots,
  exportReadinessLedger,
  clientHandoffReadiness,
  externalProviderHandoffLedger,
  operatorHandoffPacket,
) {
  const historyByOperation = new Map(historySnapshots.map((snapshot) => [snapshot.operationId, snapshot]));
  const exportByOperation = new Map((exportReadinessLedger.rows || []).map((row) => [row.operationId, row]));
  const clientByOperation = new Map((clientHandoffReadiness.rows || []).map((row) => [row.operationId, row]));
  const externalByOperation = new Map((externalProviderHandoffLedger.rows || []).map((row) => [row.operationId, row]));
  const operatorByOperation = new Map((operatorHandoffPacket.rows || []).map((row) => [row.operationId, row]));

  const rows = operations.map((operation, index) => {
    const history = historyByOperation.get(operation.id) || {};
    const exportRow = exportByOperation.get(operation.id) || {};
    const client = clientByOperation.get(operation.id) || {};
    const external = externalByOperation.get(operation.id) || {};
    const operator = operatorByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const runtimeClient = operation.runtimeClientState?.client || {};
    const persisted = operation.persistedState || {};
    const boundary = operation.tenantPermissionBoundary || {};
    const blockedBy = [
      ...(exportRow.status === "blocked" || exportRow.status === "metadata-incomplete"
        ? (exportRow.blockedBy?.length ? exportRow.blockedBy : [`export:${exportRow.status}`]).map((blocker) => `export-readiness:${blocker}`)
        : []),
      ...(client.status === "blocked" ? (client.blockedBy || ["client-handoff:blocked"]).map((blocker) => `client-handoff:${blocker}`) : []),
      ...(external.status === "blocked" ? (external.blockedBy || ["external-handoff:blocked"]).map((blocker) => `external-handoff:${blocker}`) : []),
      ...(operator.status === "blocked" ? (operator.blockedBy || ["operator-handoff:blocked"]).map((blocker) => `operator-handoff:${blocker}`) : []),
      ...(!request.requestId ? ["metadata:request-id-missing"] : []),
      ...(!runtimeClient.statusPath ? ["metadata:client-status-path-missing"] : []),
      ...(!persisted.snapshotKey ? ["metadata:snapshot-key-missing"] : []),
      ...(!persisted.ledgerKey ? ["metadata:ledger-key-missing"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["metadata:idempotency-key-missing"] : []),
    ].sort();
    const pendingBy = [
      ...(exportRow.status === "pending" ? (exportRow.pendingBy || ["export-readiness:pending"]).map((pending) => `export-readiness:${pending}`) : []),
      ...(client.status === "pending" ? (client.pendingBy || ["client-handoff:pending"]).map((pending) => `client-handoff:${pending}`) : []),
      ...(external.status === "pending" ? (external.pendingBy || ["external-handoff:pending"]).map((pending) => `external-handoff:${pending}`) : []),
      ...(operator.status === "pending" ? (operator.pendingBy || ["operator-handoff:pending"]).map((pending) => `operator-handoff:${pending}`) : []),
      ...(operation.adapterRecovery?.retryable ? ["adapter:retry-scheduled"] : []),
      ...(operation.adapterRecovery?.degradedMode ? ["adapter:degraded"] : []),
      ...(operation.lifecycleVisibility?.status === "scheduled" ? ["lifecycle:scheduled"] : []),
    ].sort();
    const auditInput = {
      packageId: descriptor.id,
      operationId: operation.id,
      requestId: request.requestId || null,
      idempotencyKeyPresent: Boolean(request.idempotencyKey),
      clientStatusPath: runtimeClient.statusPath || null,
      providerStatusPath: external.providerStatusPath || client.providerStatusPath || exportRow.providerStatusPath || null,
      boundaryKey: boundary.boundaryKey || null,
      snapshotKey: persisted.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || null,
      exportLedgerKey: exportReadinessLedger.ledgerKey || null,
      clientHandoffPlanKey: clientHandoffReadiness.planKey || null,
      externalHandoffEntryId: external.ledgerEntryId || null,
      operatorPacketRowId: operator.packetRowId || null,
      historySnapshotId: history.snapshotId || null,
      status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : "accepted",
    };
    const auditDigest = packageAuditDigest(auditInput);
    const eventId = stableId("export-audit", [
      descriptor.id,
      operation.id,
      auditDigest,
      exportReadinessLedger.ledgerKey,
      external.ledgerEntryId,
    ]);

    return {
      index,
      eventId,
      auditDigest,
      operationId: operation.id,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : "accepted",
      acceptedForExport: blockedBy.length === 0 && pendingBy.length === 0,
      externalWrite: operation.externalWrite,
      requestId: request.requestId || null,
      idempotencyKeyPresent: Boolean(request.idempotencyKey),
      clientStatusPath: runtimeClient.statusPath || null,
      providerStatusPath: auditInput.providerStatusPath,
      boundaryKey: boundary.boundaryKey || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
      snapshotKey: persisted.snapshotKey || null,
      ledgerKey: persisted.ledgerKey || null,
      exportLedgerKey: exportReadinessLedger.ledgerKey || null,
      clientHandoffPlanKey: clientHandoffReadiness.planKey || null,
      externalHandoffEntryId: external.ledgerEntryId || null,
      operatorPacketRowId: operator.packetRowId || null,
      historySnapshotId: history.snapshotId || null,
      historyStatus: history.status || "unknown",
      exportReadinessStatus: exportRow.status || "unknown",
      clientHandoffStatus: client.status || "unknown",
      externalHandoffStatus: external.status || "unknown",
      operatorHandoffStatus: operator.status || "unknown",
      blockedBy,
      pendingBy,
      auditInput,
      command: {
        command: "persist-package-export-audit-event",
        enabled: blockedBy.length === 0,
        idempotencyKey: `package-export-audit:${eventId}`,
        statusPath: runtimeClient.statusPath || null,
        providerStatusPath: auditInput.providerStatusPath,
        payload: blockedBy.length
          ? null
          : {
            eventId,
            auditDigest,
            packageId: descriptor.id,
            operationId: operation.id,
            status: pendingBy.length ? "pending" : "accepted",
            exportLedgerKey: exportReadinessLedger.ledgerKey || null,
            externalHandoffEntryId: external.ledgerEntryId || null,
          },
      },
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("export-readiness:")
          ? exportRow.nextAction || exportReadinessLedger.nextAction || "repair_package_export_readiness"
          : blockedBy[0].startsWith("client-handoff:")
            ? client.nextAction || clientHandoffReadiness.nextAction || "repair_client_handoff_readiness"
            : blockedBy[0].startsWith("external-handoff:")
              ? external.nextAction || externalProviderHandoffLedger.nextAction || "repair_external_provider_handoff"
              : blockedBy[0].startsWith("operator-handoff:")
                ? operator.nextAction || operatorHandoffPacket.nextAction || "repair_operator_handoff_packet"
                : "repair_package_export_audit_metadata"
        : pendingBy.length
          ? exportRow.nextAction || client.nextAction || external.nextAction || operator.nextAction || "wait_for_package_export_audit"
          : "persist_package_export_audit_event",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const acceptedRows = rows.filter((row) => row.acceptedForExport);
  const auditTrailId = stableId("export-audit-trail", [
    descriptor.id,
    exportReadinessLedger.ledgerKey,
    clientHandoffReadiness.planKey,
    externalProviderHandoffLedger.ledgerKey,
    operatorHandoffPacket.packetId,
    blockedRows.length,
    pendingRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.exportAuditTrail.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    auditTrailId,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "accepted",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0,
    rows,
    counters: {
      operations: rows.length,
      accepted: acceptedRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      commandsEnabled: rows.filter((row) => row.command.enabled).length,
      providerStatusLinked: rows.filter((row) => row.providerStatusPath).length,
      historyLinked: rows.filter((row) => row.historySnapshotId).length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    acceptedOperationIds: acceptedRows.map((row) => row.operationId).sort(),
    commands: rows.map((row) => row.command),
    routeContract: {
      auditPath: `mailchimp.packages.${descriptor.id}.exportAuditTrail`,
      rowShape: {
        eventId: "string",
        auditDigest: "string",
        operationId: "string",
        status: "blocked|pending|accepted",
        requestId: "string|null",
        clientStatusPath: "string|null",
        providerStatusPath: "string|null",
        blockedBy: "array",
        pendingBy: "array",
        command: "object",
      },
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || "persist_package_export_audit_trail",
  };
}

function buildPackageExportHistoryBundle(descriptor, historySnapshots, timelineReport, exportReadinessLedger, exportAuditTrail) {
  const exportByOperation = new Map((exportReadinessLedger.rows || []).map((row) => [row.operationId, row]));
  const auditByOperation = new Map((exportAuditTrail.rows || []).map((row) => [row.operationId, row]));
  const timelineByOperation = new Map((timelineReport.rows || []).map((row) => [row.operationId, row]));
  const rows = historySnapshots.map((snapshot) => {
    const exportRow = exportByOperation.get(snapshot.operationId) || {};
    const auditRow = auditByOperation.get(snapshot.operationId) || {};
    const timelineRow = timelineByOperation.get(snapshot.operationId) || {};
    const blockedBy = [
      ...(snapshot.status === "adapter-failed" ? ["history:adapter-failed"] : []),
      ...(snapshot.status === "boundary-blocked" ? ["history:boundary-blocked"] : []),
      ...(snapshot.status === "operator-review-required" ? ["history:operator-review-required"] : []),
      ...(exportRow.status === "blocked" || exportRow.status === "metadata-incomplete"
        ? (exportRow.blockedBy?.length ? exportRow.blockedBy : [`export:${exportRow.status}`]).map((blocker) => `export:${blocker}`)
        : []),
      ...(auditRow.status === "blocked" || auditRow.status === "metadata-incomplete"
        ? (auditRow.blockedBy?.length ? auditRow.blockedBy : [`audit:${auditRow.status}`]).map((blocker) => `audit:${blocker}`)
        : []),
      ...(!snapshot.requestId ? ["history:request-id-missing"] : []),
      ...(!snapshot.statusPath ? ["history:status-path-missing"] : []),
      ...(!snapshot.snapshotId ? ["history:snapshot-id-missing"] : []),
    ].sort();
    const pendingBy = [
      ...(snapshot.retryable ? ["history:adapter-retryable"] : []),
      ...(snapshot.degradedMode ? ["history:adapter-degraded"] : []),
      ...(exportRow.status === "pending" ? (exportRow.pendingBy || ["export:pending"]).map((pending) => `export:${pending}`) : []),
      ...(auditRow.status === "pending" ? (auditRow.pendingBy || ["audit:pending"]).map((pending) => `audit:${pending}`) : []),
    ].sort();
    const exportReady = exportRow.exportable === true
      && auditRow.acceptedForExport === true
      && blockedBy.length === 0
      && Boolean(snapshot.requestId && snapshot.statusPath);
    const digestInput = {
      packageId: descriptor.id,
      operationId: snapshot.operationId,
      snapshotId: snapshot.snapshotId,
      historyStatus: snapshot.status,
      timelineStatus: timelineRow.status || "unknown",
      exportStatus: exportRow.status || "unknown",
      auditStatus: auditRow.status || "unknown",
      requestId: snapshot.requestId || null,
      statusPath: snapshot.statusPath || null,
      exportLedgerKey: exportReadinessLedger.ledgerKey || null,
      auditTrailId: exportAuditTrail.auditTrailId || null,
    };

    return {
      operationId: snapshot.operationId,
      snapshotId: snapshot.snapshotId,
      digest: packageAuditDigest(digestInput),
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : exportReady
            ? "export-history-ready"
            : "metadata-incomplete",
      exportReady,
      requestId: snapshot.requestId || null,
      clientStatusPath: snapshot.statusPath || null,
      providerStatusPath: exportRow.providerStatusPath || auditRow.providerStatusPath || null,
      boundaryKey: snapshot.boundaryKey || exportRow.boundaryStatusPath || null,
      exportLedgerKey: exportReadinessLedger.ledgerKey || null,
      auditTrailId: exportAuditTrail.auditTrailId || null,
      auditEventId: auditRow.eventId || null,
      auditDigest: auditRow.auditDigest || null,
      historyStatus: snapshot.status,
      timelineStatus: timelineRow.status || "unknown",
      exportReadinessStatus: exportRow.status || "unknown",
      exportAuditStatus: auditRow.status || "unknown",
      retryable: snapshot.retryable === true,
      degradedMode: snapshot.degradedMode === true,
      diagnosticCount: snapshot.diagnosticCount || 0,
      blockedBy,
      pendingBy,
      digestInput,
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("export:")
          ? exportRow.nextAction || exportReadinessLedger.nextAction || "repair_package_export_history_readiness"
          : blockedBy[0].startsWith("audit:")
            ? auditRow.nextAction || exportAuditTrail.nextAction || "repair_package_export_history_audit"
            : "repair_package_export_history_metadata"
        : pendingBy.length
          ? exportRow.nextAction || auditRow.nextAction || "wait_for_package_export_history"
          : "publish_package_export_history_snapshot",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.status === "metadata-incomplete");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.exportReady);
  const bundleId = stableId("export-history", [
    descriptor.id,
    exportReadinessLedger.ledgerKey,
    exportAuditTrail.auditTrailId,
    rows.length,
    blockedRows.length,
    pendingRows.length,
  ]);
  const latestReady = [...readyRows].reverse()[0] || null;

  return {
    format: "aios.mailchimp.package.exportHistoryBundle.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    bundleId,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : readyRows.length === rows.length
          ? "export-history-ready"
          : "metadata-incomplete",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.exportReady),
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      retryable: rows.filter((row) => row.retryable).length,
      degraded: rows.filter((row) => row.degradedMode).length,
      auditLinked: rows.filter((row) => row.auditEventId).length,
      providerStatusLinked: rows.filter((row) => row.providerStatusPath).length,
      digestCount: rows.filter((row) => row.digest).length,
    },
    latestSnapshot: latestReady
      ? {
        operationId: latestReady.operationId,
        snapshotId: latestReady.snapshotId,
        digest: latestReady.digest,
        status: latestReady.status,
        auditEventId: latestReady.auditEventId,
      }
      : null,
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    readyOperationIds: readyRows.map((row) => row.operationId).sort(),
    exportContract: {
      path: `mailchimp.packages.${descriptor.id}.exportHistory`,
      rowShape: {
        operationId: "string",
        snapshotId: "string",
        digest: "string",
        status: "blocked|pending|export-history-ready|metadata-incomplete",
        auditEventId: "string|null",
        blockedBy: "array",
        pendingBy: "array",
        nextAction: "string",
      },
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || "publish_package_export_history_bundle",
  };
}

function buildPackageExportReportingCheckpoint(descriptor, exportReadinessLedger, exportAuditTrail, exportHistoryBundle, routeReadinessSurface) {
  const exportByOperation = new Map((exportReadinessLedger.rows || []).map((row) => [row.operationId, row]));
  const auditByOperation = new Map((exportAuditTrail.rows || []).map((row) => [row.operationId, row]));
  const historyByOperation = new Map((exportHistoryBundle.rows || []).map((row) => [row.operationId, row]));
  const routeByOperation = new Map((routeReadinessSurface.rows || []).map((row) => [row.operationId, row]));
  const operationIds = [...new Set([
    ...(exportReadinessLedger.rows || []).map((row) => row.operationId),
    ...(exportAuditTrail.rows || []).map((row) => row.operationId),
    ...(exportHistoryBundle.rows || []).map((row) => row.operationId),
    ...(routeReadinessSurface.rows || []).map((row) => row.operationId),
  ].filter(Boolean))].sort();
  const rows = operationIds.map((operationId, index) => {
    const exportRow = exportByOperation.get(operationId) || {};
    const auditRow = auditByOperation.get(operationId) || {};
    const historyRow = historyByOperation.get(operationId) || {};
    const routeRow = routeByOperation.get(operationId) || {};
    const blockedBy = [
      ...(exportRow.status === "blocked" || exportRow.status === "metadata-incomplete"
        ? (exportRow.blockedBy?.length ? exportRow.blockedBy : [exportRow.status]).map((blocker) => `export-readiness:${blocker}`)
        : []),
      ...(auditRow.status === "blocked" || auditRow.status === "metadata-incomplete"
        ? (auditRow.blockedBy?.length ? auditRow.blockedBy : [auditRow.status]).map((blocker) => `export-audit:${blocker}`)
        : []),
      ...(historyRow.status === "blocked" || historyRow.status === "metadata-incomplete"
        ? (historyRow.blockedBy?.length ? historyRow.blockedBy : [historyRow.status]).map((blocker) => `export-history:${blocker}`)
        : []),
      ...(routeRow.status === "blocked"
        ? (routeRow.blockedBy?.length ? routeRow.blockedBy : ["route-blocked"]).map((blocker) => `route-readiness:${blocker}`)
        : []),
      ...(!exportRow.requestId && !historyRow.requestId && !routeRow.requestId ? ["reporting:request-id-missing"] : []),
      ...(!exportRow.clientStatusPath && !historyRow.clientStatusPath && !routeRow.clientStatusPath ? ["reporting:client-status-path-missing"] : []),
      ...(!historyRow.digest ? ["reporting:history-digest-missing"] : []),
      ...(!auditRow.auditDigest ? ["reporting:audit-digest-missing"] : []),
      ...(!routeRow.previewDigest ? ["reporting:preview-digest-missing"] : []),
    ].sort();
    const pendingBy = [
      ...(exportRow.status === "pending" ? (exportRow.pendingBy || ["pending"]).map((pending) => `export-readiness:${pending}`) : []),
      ...(auditRow.status === "pending" ? (auditRow.pendingBy || ["pending"]).map((pending) => `export-audit:${pending}`) : []),
      ...(historyRow.status === "pending" ? (historyRow.pendingBy || ["pending"]).map((pending) => `export-history:${pending}`) : []),
      ...(routeRow.status === "pending" ? (routeRow.pendingBy || ["pending"]).map((pending) => `route-readiness:${pending}`) : []),
    ].sort();
    const accepted = blockedBy.length === 0
      && pendingBy.length === 0
      && exportRow.exportable === true
      && auditRow.acceptedForExport === true
      && historyRow.exportReady === true
      && routeRow.acceptedForRoute === true;
    const requestId = exportRow.requestId || historyRow.requestId || routeRow.requestId || null;
    const clientStatusPath = exportRow.clientStatusPath || historyRow.clientStatusPath || routeRow.clientStatusPath || null;
    const providerStatusPath = exportRow.providerStatusPath || historyRow.providerStatusPath || routeRow.providerStatusPath || null;
    const reportDigest = packageAuditDigest({
      packageId: descriptor.id,
      operationId,
      exportLedgerKey: exportReadinessLedger.ledgerKey || null,
      auditTrailId: exportAuditTrail.auditTrailId || null,
      historyBundleId: exportHistoryBundle.bundleId || null,
      routeSurfaceId: routeReadinessSurface.surfaceId || null,
      exportStatus: exportRow.status || "unknown",
      auditDigest: auditRow.auditDigest || null,
      historyDigest: historyRow.digest || null,
      previewDigest: routeRow.previewDigest || null,
      requestId,
      clientStatusPath,
    });
    const checkpointId = stableId("export-report", [
      descriptor.id,
      operationId,
      reportDigest,
      exportHistoryBundle.bundleId,
      routeReadinessSurface.surfaceId,
    ]);
    const snapshotId = stableId("export-report-snapshot", [
      descriptor.id,
      operationId,
      checkpointId,
      historyRow.snapshotId,
      auditRow.eventId,
      routeRow.previewDigest,
    ]);
    const resumeToken = stableId("export-report-resume", [
      descriptor.id,
      operationId,
      reportDigest,
      requestId,
      clientStatusPath,
    ]);
    const snapshotBlockedBy = [
      ...(!requestId ? ["snapshot:request-id-missing"] : []),
      ...(!clientStatusPath ? ["snapshot:client-status-path-missing"] : []),
      ...(!historyRow.snapshotId ? ["snapshot:history-snapshot-missing"] : []),
      ...(!auditRow.eventId ? ["snapshot:audit-event-missing"] : []),
      ...(!routeRow.previewDigest ? ["snapshot:route-preview-missing"] : []),
      ...(accepted ? [] : ["snapshot:report-not-accepted"]),
    ].sort();
    const restartSafe = snapshotBlockedBy.length === 0
      && Boolean(reportDigest && checkpointId)
      && routeRow.statusPatch?.patchable !== false;
    const statusPatchId = stableId("export-report-patch", [checkpointId, routeRow.statusPatch?.patchId, reportDigest]);
    const resumeCommandId = stableId("export-report-resume-command", [
      descriptor.id,
      operationId,
      checkpointId,
      resumeToken,
    ]);

    return {
      index,
      checkpointId,
      operationId,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : accepted
            ? "report-ready"
            : "metadata-incomplete",
      acceptedForRoute: accepted,
      reportDigest,
      requestId,
      clientStatusPath,
      providerStatusPath,
      exportLedgerKey: exportReadinessLedger.ledgerKey || null,
      auditTrailId: exportAuditTrail.auditTrailId || null,
      historyBundleId: exportHistoryBundle.bundleId || null,
      routeSurfaceId: routeReadinessSurface.surfaceId || null,
      auditEventId: auditRow.eventId || null,
      historySnapshotId: historyRow.snapshotId || null,
      routePreviewDigest: routeRow.previewDigest || null,
      statuses: {
        exportReadiness: exportRow.status || "unknown",
        exportAudit: auditRow.status || "unknown",
        exportHistory: historyRow.status || "unknown",
        routeReadiness: routeRow.status || "unknown",
      },
      blockedBy,
      pendingBy,
      restartSnapshot: {
        snapshotId,
        resumeToken,
        restartSafe,
        status: restartSafe
          ? "resume-ready"
          : blockedBy.length || snapshotBlockedBy.length
            ? "resume-blocked"
            : pendingBy.length
              ? "resume-pending"
              : "resume-review",
        blockedBy: snapshotBlockedBy,
        persistedKeys: [
          exportReadinessLedger.ledgerKey,
          exportAuditTrail.auditTrailId,
          exportHistoryBundle.bundleId,
          routeReadinessSurface.surfaceId,
          historyRow.snapshotId,
          auditRow.eventId,
          routeRow.previewDigest,
        ].filter(Boolean).sort(),
        statusPath: clientStatusPath,
        providerStatusPath,
        expectedPatchId: statusPatchId,
        nextAction: restartSafe
          ? "resume_export_reporting_checkpoint"
          : snapshotBlockedBy.length
            ? "repair_export_reporting_restart_snapshot"
            : pendingBy.length
              ? "wait_for_export_reporting_snapshot_inputs"
              : "review_export_reporting_snapshot",
      },
      statusPatch: {
        patchId: statusPatchId,
        patchable: accepted && Boolean(routeRow.statusPatch?.statusPath || exportRow.clientStatusPath || historyRow.clientStatusPath),
        statusPath: routeRow.statusPatch?.statusPath || exportRow.clientStatusPath || historyRow.clientStatusPath || null,
        providerStatusPath: routeRow.statusPatch?.providerStatusPath || exportRow.providerStatusPath || historyRow.providerStatusPath || null,
        state: accepted ? "export-report-ready" : blockedBy.length ? "export-report-blocked" : "export-report-pending",
        visibleState: accepted ? "Mailchimp export report ready" : blockedBy.length ? "Mailchimp export report blocked" : "Mailchimp export report pending",
        blockedBy,
        pendingBy,
        nextAction: blockedBy.length ? "repair_package_export_reporting" : pendingBy.length ? "wait_for_package_export_reporting" : "publish_package_export_reporting_checkpoint",
      },
      command: {
        command: "publish-package-export-report",
        enabled: accepted,
        idempotencyKey: `package-export-report:${checkpointId}:${reportDigest}`,
        statusPatchId: null,
        payload: accepted
          ? {
            checkpointId,
            operationId,
            reportDigest,
            exportLedgerKey: exportReadinessLedger.ledgerKey || null,
            auditTrailId: exportAuditTrail.auditTrailId || null,
            historyBundleId: exportHistoryBundle.bundleId || null,
            routeSurfaceId: routeReadinessSurface.surfaceId || null,
          }
          : null,
      },
      resumeCommand: {
        commandId: resumeCommandId,
        command: "resume-package-export-report",
        enabled: restartSafe,
        idempotencyKey: `package-export-report-resume:${resumeToken}`,
        statusPatchId,
        snapshotId,
        checkpointId,
        replaySafe: restartSafe,
        payload: restartSafe
          ? {
            checkpointId,
            operationId,
            reportDigest,
            resumeToken,
            snapshotId,
            clientStatusPath,
            providerStatusPath,
          }
          : null,
        nextAction: restartSafe
          ? "replay_package_export_reporting_status_patch"
          : "repair_export_reporting_restart_snapshot",
      },
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("export-readiness:")
          ? exportRow.nextAction || exportReadinessLedger.nextAction || "repair_package_export_readiness"
          : blockedBy[0].startsWith("export-audit:")
            ? auditRow.nextAction || exportAuditTrail.nextAction || "repair_package_export_audit"
            : blockedBy[0].startsWith("export-history:")
              ? historyRow.nextAction || exportHistoryBundle.nextAction || "repair_package_export_history"
              : blockedBy[0].startsWith("route-readiness:")
                ? routeRow.nextAction || routeReadinessSurface.nextAction || "repair_route_readiness"
                : "repair_package_export_reporting"
        : pendingBy.length
          ? exportRow.nextAction || auditRow.nextAction || historyRow.nextAction || routeRow.nextAction || "wait_for_package_export_reporting"
          : "publish_package_export_reporting_checkpoint",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.status === "metadata-incomplete");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.acceptedForRoute);
  const restartReadyRows = rows.filter((row) => row.restartSnapshot.restartSafe);
  const checkpointKey = stableId("export-reporting", [
    descriptor.id,
    exportReadinessLedger.ledgerKey,
    exportAuditTrail.auditTrailId,
    exportHistoryBundle.bundleId,
    routeReadinessSurface.surfaceId,
    blockedRows.length,
    pendingRows.length,
  ]);

  return {
    format: "aios.mailchimp.package.exportReportingCheckpoint.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    checkpointKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : rows.every((row) => row.acceptedForRoute)
          ? "report-ready"
          : "metadata-incomplete",
    acceptedForRoute: blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.acceptedForRoute),
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      digestCount: rows.filter((row) => row.reportDigest).length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      commandsEnabled: rows.filter((row) => row.command.enabled).length,
      providerStatusLinked: rows.filter((row) => row.providerStatusPath).length,
      routePreviewLinked: rows.filter((row) => row.routePreviewDigest).length,
      restartSafe: restartReadyRows.length,
      resumeCommandsEnabled: rows.filter((row) => row.resumeCommand.enabled).length,
      snapshotBlocked: rows.filter((row) => row.restartSnapshot.status === "resume-blocked").length,
    },
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    readyOperationIds: readyRows.map((row) => row.operationId).sort(),
    latestReadyReport: readyRows.at(-1)
      ? {
        operationId: readyRows.at(-1).operationId,
        checkpointId: readyRows.at(-1).checkpointId,
        reportDigest: readyRows.at(-1).reportDigest,
        routePreviewDigest: readyRows.at(-1).routePreviewDigest,
      }
      : null,
    reportContract: {
      path: `mailchimp.packages.${descriptor.id}.exportReporting`,
      rowShape: {
        checkpointId: "string",
        operationId: "string",
        status: "blocked|pending|report-ready|metadata-incomplete",
        reportDigest: "string",
        statusPatch: "object",
        command: "object",
      },
    },
    commands: rows.map((row) => ({
      ...row.command,
      statusPatchId: row.statusPatch.patchId,
    })),
    restartSnapshots: rows.map((row) => ({
      operationId: row.operationId,
      checkpointId: row.checkpointId,
      ...row.restartSnapshot,
    })),
    resumeCommands: rows.map((row) => row.resumeCommand),
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || rows.find((row) => !row.restartSnapshot.restartSafe)?.restartSnapshot.nextAction
      || "publish_package_export_reporting_checkpoint",
  };
}

function buildRouteReadinessSurface(descriptor, operations, acceptancePreview, exportSummary, clientHandoffReadiness, operatorHandoffPacket, exportAuditTrail, lifecycleControlPlane) {
  const acceptanceByOperation = new Map((acceptancePreview.rows || []).map((row) => [row.operationId, row]));
  const handoffByOperation = new Map((clientHandoffReadiness.rows || []).map((row) => [row.operationId, row]));
  const operatorByOperation = new Map((operatorHandoffPacket.rows || []).map((row) => [row.operationId, row]));
  const auditByOperation = new Map((exportAuditTrail.rows || []).map((row) => [row.operationId, row]));
  const controlByOperation = new Map((lifecycleControlPlane.rows || []).map((row) => [row.operationId, row]));
  const rows = operations.map((operation, index) => {
    const acceptance = acceptanceByOperation.get(operation.id) || {};
    const handoff = handoffByOperation.get(operation.id) || {};
    const operator = operatorByOperation.get(operation.id) || {};
    const audit = auditByOperation.get(operation.id) || {};
    const control = controlByOperation.get(operation.id) || {};
    const request = operation.runtimeClientState?.request || {};
    const client = operation.runtimeClientState?.client || {};
    const providerStatusPath = handoff.providerStatusPath
      || acceptance.clientHandoff?.providerStatusPath
      || operation.clientRuntimeAdoption?.client?.providerStatusPath
      || null;
    const blockedBy = [
      ...(acceptance.accepted === false ? [`acceptance:${acceptance.readiness || "blocked"}`] : []),
      ...(handoff.status === "blocked" || handoff.acceptedForClient === false ? ["client-handoff:blocked"] : []),
      ...((handoff.blockedBy || []).map((blocker) => `client-handoff:${blocker}`)),
      ...(operator.status === "blocked" || operator.acceptedForOperator === false ? ["operator-handoff:blocked"] : []),
      ...((operator.blockedBy || []).map((blocker) => `operator-handoff:${blocker}`)),
      ...(audit.status === "blocked" || audit.acceptedForDispatch === false ? ["export-audit:blocked"] : []),
      ...((audit.blockedBy || []).map((blocker) => `export-audit:${blocker}`)),
      ...(control.status === "blocked" ? ["lifecycle-control:blocked"] : []),
      ...((control.blockedBy || []).map((blocker) => `lifecycle-control:${blocker}`)),
      ...(!request.requestId ? ["request:requestId"] : []),
      ...(!client.statusPath ? ["client:statusPath"] : []),
      ...(operation.externalWrite && !request.idempotencyKey ? ["request:idempotencyKey"] : []),
      ...(operation.externalWrite && !providerStatusPath ? ["provider:statusPath"] : []),
    ].sort();
    const pendingBy = [
      ...(acceptance.readiness === "awaiting-truth-approval" ? ["truth-approval:pending"] : []),
      ...(handoff.status === "pending" ? ["client-handoff:pending"] : []),
      ...((handoff.pendingBy || []).map((pending) => `client-handoff:${pending}`)),
      ...(operator.status === "pending" ? ["operator-handoff:pending"] : []),
      ...((operator.pendingBy || []).map((pending) => `operator-handoff:${pending}`)),
      ...(audit.status === "pending" ? ["export-audit:pending"] : []),
      ...((audit.pendingBy || []).map((pending) => `export-audit:${pending}`)),
      ...(control.status === "pending" ? ["lifecycle-control:pending"] : []),
      ...((control.pendingBy || []).map((pending) => `lifecycle-control:${pending}`)),
    ].sort();
    const routeState = blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : operation.externalWrite
          ? "acceptance-ready"
          : "preview-ready";
    const commandEnabled = routeState === "preview-ready" || routeState === "acceptance-ready";
    const previewDigest = stableId("route-preview", [
      descriptor.id,
      operation.id,
      acceptance.previewId,
      handoff.readinessId,
      operator.packetRowId,
      audit.eventId,
      routeState,
    ]);

    return {
      index,
      operationId: operation.id,
      previewDigest,
      routeState,
      acceptedForRoute: commandEnabled,
      externalWrite: operation.externalWrite,
      title: acceptance.title || client.handoffLabel || `${operation.adapter}.${operation.operation}`,
      visibleState: routeState === "blocked"
        ? "blocked"
        : routeState === "pending"
          ? "waiting"
          : operation.externalWrite
            ? "ready_for_approval"
            : "ready",
      blockedBy,
      pendingBy,
      request: {
        requestId: request.requestId || null,
        idempotencyKeyPresent: Boolean(request.idempotencyKey),
        replayToken: request.replayToken || null,
        dedupeScope: request.dedupeScope || null,
      },
      client: {
        statusPath: client.statusPath || null,
        progressPath: client.progressPath || null,
        providerStatusPath,
        visibleStates: client.visibleStates || [],
      },
      acceptance: {
        acceptanceKey: acceptancePreview.acceptanceKey || null,
        previewId: acceptance.previewId || null,
        readiness: acceptance.readiness || "unknown",
        validationStatus: acceptance.validationStatus || "unknown",
        validationSummary: acceptance.validationSummary || null,
        nextStep: acceptance.nextStep || null,
      },
      workflow: {
        handoffStatus: handoff.status || "unknown",
        handoffPlanKey: clientHandoffReadiness.planKey || null,
        operatorPacketId: operatorHandoffPacket.packetId || null,
        operatorPacketRowId: operator.packetRowId || null,
        operatorStatus: operator.status || "unknown",
        exportAuditTrailId: exportAuditTrail.auditTrailId || null,
        exportAuditStatus: audit.status || "unknown",
        lifecycleControlPlaneId: lifecycleControlPlane.controlPlaneId || null,
        lifecycleControlId: control.controlId || null,
        lifecycleControlStatus: control.status || "unknown",
      },
      statusPatch: {
        patchId: stableId("route-status-patch", [
          descriptor.id,
          operation.id,
          client.statusPath,
          providerStatusPath,
          routeState,
        ]),
        patchable: commandEnabled && Boolean(client.statusPath),
        statusPath: client.statusPath || null,
        providerStatusPath,
        state: routeState,
        visibleState: routeState === "acceptance-ready" ? "ready_for_approval" : routeState,
        fields: commandEnabled
          ? {
            provider: "mailchimp",
            operationId: operation.id,
            previewDigest,
            acceptanceKey: acceptancePreview.acceptanceKey,
            requestId: request.requestId || null,
            routeState,
          }
          : null,
        blockedBy,
        pendingBy,
      },
      commands: [
        {
          command: "publish-route-readiness",
          enabled: commandEnabled && Boolean(client.statusPath),
          idempotencyKey: `route-readiness:${previewDigest}`,
          statusPath: client.statusPath || null,
        },
        {
          command: operation.externalWrite ? "open-approval-preview" : "open-read-preview",
          enabled: commandEnabled,
          idempotencyKey: `route-preview:${previewDigest}`,
          statusPath: client.statusPath || null,
        },
      ],
      nextAction: blockedBy.length
        ? acceptance.nextStep?.action || handoff.nextAction || operator.nextAction || audit.nextAction || "repair_route_readiness"
        : pendingBy.length
          ? handoff.nextAction || operator.nextAction || audit.nextAction || "wait_for_route_readiness"
          : operation.externalWrite
            ? "present_mailchimp_approval_preview"
            : "present_mailchimp_read_preview",
    };
  });
  const blockedRows = rows.filter((row) => row.routeState === "blocked");
  const pendingRows = rows.filter((row) => row.routeState === "pending");
  const acceptedRows = rows.filter((row) => row.acceptedForRoute);

  return {
    format: "aios.mailchimp.package.routeReadinessSurface.v1",
    provider: "mailchimp",
    packageId: descriptor.id,
    surfaceId: stableId("route-readiness", [
      descriptor.id,
      acceptancePreview.acceptanceKey,
      exportSummary.reportId || exportSummary.status,
      blockedRows.length,
      pendingRows.length,
      acceptedRows.length,
    ]),
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "ready",
    acceptedForRoute: blockedRows.length === 0 && pendingRows.length === 0,
    routeContract: {
      previewPath: `mailchimp.packages.${descriptor.id}.routePreview`,
      statusPath: `mailchimp.packages.${descriptor.id}.routeReadiness`,
      commandPath: `mailchimp.packages.${descriptor.id}.routeCommands`,
      payloadShape: {
        surfaceId: "string",
        operationId: "string",
        routeState: "blocked|pending|preview-ready|acceptance-ready",
        previewDigest: "string",
        statusPatch: "object",
        commands: "array",
        nextAction: "string",
      },
    },
    counters: {
      operations: rows.length,
      accepted: acceptedRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      commandCount: rows.reduce((count, row) => count + row.commands.length, 0),
      enabledCommandCount: rows.flatMap((row) => row.commands).filter((command) => command.enabled).length,
    },
    rows,
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    pendingOperationIds: pendingRows.map((row) => row.operationId).sort(),
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || (rows.some((row) => row.externalWrite)
        ? "present_mailchimp_approval_preview"
        : "present_mailchimp_read_preview"),
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
    ...operations.flatMap((operation, index) => (
      (operation.clientHandoffReceipt?.missingFields || []).map((field) => ({
        index,
        source: "client-handoff-receipt",
        severity: "error",
        code: `package.client_handoff_receipt.${field}_missing`,
        message: `Operation ${operation.id} cannot publish a deterministic Mailchimp handoff receipt without ${field}.`,
        field: `operations.${index}.clientHandoffReceipt.${field}`,
        operationId: operation.id,
        action: operation.clientHandoffReceipt?.nextAction || "repair_client_handoff_receipt_metadata",
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
  const acceptanceAcknowledgementControl = buildAcceptanceAcknowledgementControl(
    descriptor,
    operations,
    acceptancePreview,
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
  const restartSafeStatusEnvelope = buildRestartSafeStatusEnvelope(
    descriptor,
    operations,
    restartJournal,
    adapterRecoveryCheckpointPlan,
    clientStatusTransitionPlan,
  );
  const persistedStatusRecoveryLedger = buildPersistedStatusRecoveryLedger(
    descriptor,
    operations,
    restartSafeStatusEnvelope,
    restartJournal,
    clientStatusTransitionPlan,
  );
  const permissionBoundaryHandoff = buildPackagePermissionBoundaryHandoffPlan(
    descriptor,
    operations,
    providerServiceNegotiation,
    acceptancePreview,
    clientStatusTransitionPlan,
    adapterRecoveryCheckpointPlan,
    restartJournal,
  );
  const providerReadinessHandoff = buildProviderReadinessHandoff(
    descriptor,
    operations,
    providerServiceNegotiation,
    acceptancePreview,
    clientStatusTransitionPlan,
    adapterRecoveryCheckpointPlan,
    restartJournal,
    permissionBoundaryHandoff,
  );
  const tenantPermissionEnforcementMatrix = buildTenantPermissionEnforcementMatrix(
    descriptor,
    operations,
    permissionBoundaryHandoff,
    providerReadinessHandoff,
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
    permissionBoundaryHandoff,
    providerReadinessHandoff,
  );
  const exportReadinessLedger = buildPackageExportReadinessLedger(
    descriptor,
    operations,
    allDiagnostics,
    analytics,
    exportSummary,
    providerReadinessHandoff,
    permissionBoundaryHandoff,
    restartJournal,
  );
  const clientHandoffReadiness = buildClientHandoffReadinessPlan(
    descriptor,
    operations,
    acceptancePreview,
    providerReadinessHandoff,
    exportReadinessLedger,
  );
  const externalProviderHandoffLedger = buildExternalProviderHandoffLedger(
    descriptor,
    operations,
    providerServiceNegotiation,
    providerReadinessHandoff,
    exportReadinessLedger,
    clientHandoffReadiness,
  );
  const providerDeliveryAcknowledgementLedger = buildProviderDeliveryAcknowledgementLedger(
    descriptor,
    operations,
    externalProviderHandoffLedger,
  );
  const providerDeliveryAckWorkflowHandoff = buildProviderDeliveryAckWorkflowHandoff(
    descriptor,
    providerDeliveryAcknowledgementLedger,
  );
  const lifecycleControlPlane = buildLifecycleControlPlane(
    descriptor,
    operations,
    acceptancePreview,
    providerReadinessHandoff,
    clientHandoffReadiness,
    externalProviderHandoffLedger,
  );
  const lifecycleSettingsAcceptance = buildLifecycleSettingsAcceptance(
    descriptor,
    operations,
    lifecycleControlPlane,
  );
  const operationalIncidentLedger = buildOperationalIncidentLedger(
    descriptor,
    operations,
    analytics,
    lifecycleControlPlane,
    externalProviderHandoffLedger,
    providerDeliveryAcknowledgementLedger,
  );
  const operationalAcceptanceMatrix = buildOperationalAcceptanceMatrix(
    descriptor,
    operations,
    operationalIncidentLedger,
    lifecycleControlPlane,
    externalProviderHandoffLedger,
    providerDeliveryAcknowledgementLedger,
  );
  const operatorHandoffPacket = buildOperatorHandoffPacket(
    descriptor,
    operations,
    acceptancePreview,
    clientHandoffReadiness,
    providerReadinessHandoff,
    permissionBoundaryHandoff,
    exportReadinessLedger,
    externalProviderHandoffLedger,
    restartJournal,
  );
  const exportAuditTrail = buildPackageExportAuditTrail(
    descriptor,
    operations,
    historySnapshots,
    exportReadinessLedger,
    clientHandoffReadiness,
    externalProviderHandoffLedger,
    operatorHandoffPacket,
  );
  const exportHistoryBundle = buildPackageExportHistoryBundle(
    descriptor,
    historySnapshots,
    timelineReport,
    exportReadinessLedger,
    exportAuditTrail,
  );
  const routeReadinessSurface = buildRouteReadinessSurface(
    descriptor,
    operations,
    acceptancePreview,
    exportSummary,
    clientHandoffReadiness,
    operatorHandoffPacket,
    exportAuditTrail,
    lifecycleControlPlane,
  );
  const exportReportingCheckpoint = buildPackageExportReportingCheckpoint(
    descriptor,
    exportReadinessLedger,
    exportAuditTrail,
    exportHistoryBundle,
    routeReadinessSurface,
  );
  const previewAcceptanceSummary = buildPreviewAcceptanceSummary(
    descriptor,
    operations,
    acceptancePreview,
    clientHandoffReadiness,
    providerReadinessHandoff,
    routeReadinessSurface,
    lifecycleSettingsAcceptance,
    operationalIncidentLedger,
  );
  const operatorReleaseDossier = buildOperatorReleaseDossier(
    descriptor,
    operations,
    previewAcceptanceSummary,
    acceptanceAcknowledgementControl,
    operatorHandoffPacket,
    routeReadinessSurface,
    exportReportingCheckpoint,
    operationalAcceptanceMatrix,
  );
  const tenantBoundaryActionQueue = buildTenantBoundaryActionQueue(
    descriptor,
    operations,
    permissionBoundaryHandoff,
    tenantPermissionEnforcementMatrix,
    lifecycleControlPlane,
  );
  const operatorNextActionState = buildOperatorNextActionState(
    descriptor,
    operations,
    lifecycleControlPlane,
    previewAcceptanceSummary,
    routeReadinessSurface,
    operatorHandoffPacket,
    operationalAcceptanceMatrix,
    operatorReleaseDossier,
  );
  const operatorAcceptanceCheckpoint = buildOperatorAcceptanceCheckpoint(
    descriptor,
    operations,
    previewAcceptanceSummary,
    routeReadinessSurface,
    lifecycleSettingsAcceptance,
    operatorHandoffPacket,
    operationalAcceptanceMatrix,
    operatorNextActionState,
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
      clientHandoffReceipts: operations.map((operation) => ({
        operationId: operation.id,
        receiptId: operation.clientHandoffReceipt.receiptId,
        state: operation.clientHandoffReceipt.state,
        acceptedForHandoff: operation.clientHandoffReceipt.acceptedForHandoff,
        requestId: operation.clientHandoffReceipt.request.requestId,
        idempotencyKey: operation.clientHandoffReceipt.request.idempotencyKey,
        replayToken: operation.clientHandoffReceipt.request.replayToken,
        clientStatusPath: operation.clientHandoffReceipt.client.statusPath,
        progressPath: operation.clientHandoffReceipt.client.progressPath,
        providerStatusPath: operation.clientHandoffReceipt.client.providerStatusPath,
        visibleState: operation.clientHandoffReceipt.client.visibleState,
        snapshotKey: operation.clientHandoffReceipt.persisted.snapshotKey,
        ledgerKey: operation.clientHandoffReceipt.persisted.ledgerKey,
        boundaryKey: operation.clientHandoffReceipt.boundary.boundaryKey,
        boundaryStatusPath: operation.clientHandoffReceipt.boundary.statusPath,
        adoptionKey: operation.clientHandoffReceipt.adoption.adoptionKey,
        missingFields: operation.clientHandoffReceipt.missingFields,
        nextAction: operation.clientHandoffReceipt.nextAction,
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
        boundaryEvidencePacketId: operation.boundaryEvidencePacket.packetId,
        boundaryEvidenceStatus: operation.boundaryEvidencePacket.status,
        boundaryEvidenceRequiredFields: operation.boundaryEvidencePacket.requiredFields,
        boundaryEvidenceMissingFields: operation.boundaryEvidencePacket.missingFields,
      })),
      boundaryEvidencePackets: operations.map((operation) => operation.boundaryEvidencePacket),
      analytics,
      historySnapshots,
      timelineReport,
      acceptancePreview,
      acceptanceAcknowledgementControl,
      exportSummary,
      providerServiceNegotiation,
      clientStatusTransitionPlan,
      adapterRecoveryCheckpointPlan,
      restartJournal,
      restartSafeStatusEnvelope,
      persistedStatusRecoveryLedger,
      permissionBoundaryHandoff,
      tenantBoundaryActionQueue,
      tenantPermissionEnforcementMatrix,
      providerReadinessHandoff,
      exportReadinessLedger,
      clientHandoffReadiness,
      externalProviderHandoffLedger,
      providerDeliveryAcknowledgementLedger,
      providerDeliveryAckWorkflowHandoff,
      providerDeliveryAckEvidence: providerDeliveryAcknowledgementLedger.rows.map((row) => ({
        operationId: row.operationId,
        evidenceId: row.evidenceAdapter.evidenceId,
        ackId: row.ackId,
        status: row.evidenceAdapter.status,
        acceptedForTruthHandoff: row.evidenceAdapter.acceptedForTruthHandoff,
        expected: row.evidenceAdapter.expected,
        observed: row.evidenceAdapter.observed,
        missingObservedFields: row.evidenceAdapter.missingObservedFields,
        safeToPoll: row.evidenceAdapter.replay.safeToPoll,
        dedupeKey: row.evidenceAdapter.replay.dedupeKey,
        handoffState: row.evidenceAdapter.handoffState,
      })),
      operationalIncidentLedger,
      operationalAcceptanceMatrix,
      lifecycleControlPlane,
      lifecycleSettingsAcceptance,
      operatorHandoffPacket,
      exportAuditTrail,
      exportHistoryBundle,
      routeReadinessSurface,
      exportReportingCheckpoint,
      previewAcceptanceSummary,
      operatorReleaseDossier,
      operatorNextActionState,
      operatorAcceptanceCheckpoint,
    },
    diagnostics: allDiagnostics,
    summary,
    analytics,
    history: {
      snapshots: historySnapshots,
      latestStatus: historySnapshots.at(-1)?.status || "empty",
      retryableOperationIds: analytics.retryableOperationIds,
      blockedOperationIds: analytics.blockedOperationIds,
      exportHistoryBundleId: exportHistoryBundle.bundleId,
      exportReadyOperationIds: exportHistoryBundle.readyOperationIds,
      exportBlockedOperationIds: exportHistoryBundle.blockedOperationIds,
      exportReportingCheckpointKey: exportReportingCheckpoint.checkpointKey,
      exportReportReadyOperationIds: exportReportingCheckpoint.readyOperationIds,
      exportReportBlockedOperationIds: exportReportingCheckpoint.blockedOperationIds,
    },
    timeline: timelineReport,
    providerServiceNegotiation,
    acceptancePreview,
    acceptanceAcknowledgementControl,
    clientStatusTransitionPlan,
    adapterRecoveryCheckpointPlan,
    restartJournal,
    restartSafeStatusEnvelope,
    persistedStatusRecoveryLedger,
    permissionBoundaryHandoff,
    tenantBoundaryActionQueue,
    tenantPermissionEnforcementMatrix,
    providerReadinessHandoff,
    exportReadinessLedger,
    clientHandoffReadiness,
    externalProviderHandoffLedger,
    providerDeliveryAcknowledgementLedger,
    providerDeliveryAckWorkflowHandoff,
    operationalIncidentLedger,
    operationalAcceptanceMatrix,
    lifecycleControlPlane,
    lifecycleSettingsAcceptance,
    operatorHandoffPacket,
    exportAuditTrail,
    exportHistoryBundle,
    routeReadinessSurface,
    exportReportingCheckpoint,
    previewAcceptanceSummary,
    operatorReleaseDossier,
    operatorNextActionState,
    operatorAcceptanceCheckpoint,
    exportSummary,
    valid: summary.valid
      && tenantBoundaryActionQueue.status !== "blocked"
      && restartJournal.status !== "blocked"
      && restartSafeStatusEnvelope.status !== "blocked"
      && persistedStatusRecoveryLedger.status !== "blocked"
      && permissionBoundaryHandoff.status !== "blocked"
      && tenantPermissionEnforcementMatrix.status !== "blocked"
      && providerReadinessHandoff.status !== "blocked"
      && exportReadinessLedger.status !== "blocked"
      && clientHandoffReadiness.status !== "blocked"
      && externalProviderHandoffLedger.status !== "blocked"
      && providerDeliveryAcknowledgementLedger.status !== "blocked"
      && providerDeliveryAckWorkflowHandoff.status !== "blocked"
      && operationalIncidentLedger.status !== "blocked"
      && operationalAcceptanceMatrix.status !== "blocked"
      && lifecycleControlPlane.status !== "blocked"
      && acceptanceAcknowledgementControl.status !== "blocked"
      && operatorHandoffPacket.status !== "blocked"
      && exportAuditTrail.status !== "blocked"
      && exportHistoryBundle.status !== "blocked"
      && routeReadinessSurface.status !== "blocked"
      && exportReportingCheckpoint.status !== "blocked"
      && previewAcceptanceSummary.status !== "blocked"
      && operatorReleaseDossier.status !== "blocked"
      && operatorNextActionState.status !== "blocked"
      && operatorAcceptanceCheckpoint.status !== "blocked"
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
  if (!analysis?.restartSafeStatusEnvelope?.envelopeId) {
    diagnostics.push({ severity: "warning", code: "package.analysis.restart_status_envelope_missing", message: "Package analysis should expose a restart-safe status envelope for adapter recovery handoff." });
  }
  if (analysis?.restartSafeStatusEnvelope?.status === "restart-safe"
    && analysis.restartSafeStatusEnvelope.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.restart_status_envelope_ready_with_blockers", message: "Restart-safe status envelope cannot be ready while blocked operations are present." });
  }
  if ((analysis?.restartSafeStatusEnvelope?.rows || []).some((row) => !row.command?.commandId || !row.statusPath || !row.providerStatusPath)) {
    diagnostics.push({ severity: "error", code: "package.analysis.restart_status_envelope_metadata_missing", message: "Restart-safe status envelope rows require command id, client status path, and provider status path." });
  }
  if (!analysis?.persistedStatusRecoveryLedger?.ledgerKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.persisted_status_recovery_missing", message: "Package analysis should expose a persisted status recovery ledger for restart-safe adapter handoff." });
  }
  if (analysis?.persistedStatusRecoveryLedger?.status === "resume-ready"
    && analysis.persistedStatusRecoveryLedger.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.persisted_status_recovery_ready_with_blockers", message: "Persisted status recovery ledger cannot be resume-ready while blocked operations are present." });
  }
  if ((analysis?.persistedStatusRecoveryLedger?.rows || []).some((row) => !row.ledgerEntryId || !row.statusPath || !row.providerStatusPath || !row.command?.commandId)) {
    diagnostics.push({ severity: "error", code: "package.analysis.persisted_status_recovery_metadata_missing", message: "Persisted status recovery rows require ledger entry id, client status path, provider status path, and command id." });
  }
  if ((analysis?.persistedStatusRecoveryLedger?.rows || []).some((row) => row.acceptedForAdapter && row.statusPatch?.patchable !== true)) {
    diagnostics.push({ severity: "error", code: "package.analysis.persisted_status_recovery_accepted_not_patchable", message: "Accepted persisted status recovery rows must expose a patchable recovery status patch." });
  }
  if (!analysis?.permissionBoundaryHandoff?.handoffKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.permission_boundary_handoff_missing", message: "Package analysis should expose a deterministic permission boundary handoff plan." });
  }
  if (analysis?.permissionBoundaryHandoff?.status === "ready"
    && analysis.permissionBoundaryHandoff.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.permission_boundary_ready_with_blockers", message: "Permission boundary handoff cannot be ready while blocked operations are present." });
  }
  if (!analysis?.tenantPermissionEnforcementMatrix?.matrixKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.tenant_permission_matrix_missing", message: "Package analysis should expose a deterministic tenant permission enforcement matrix." });
  }
  if (analysis?.tenantPermissionEnforcementMatrix?.status === "enforced"
    && analysis.tenantPermissionEnforcementMatrix.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.tenant_permission_enforced_with_blockers", message: "Tenant permission enforcement cannot be enforced while blocked operations are present." });
  }
  if ((analysis?.tenantPermissionEnforcementMatrix?.rows || []).some((row) => !row.enforcementId || !row.boundaryKey || !row.statusPatch?.statusPath)) {
    diagnostics.push({ severity: "error", code: "package.analysis.tenant_permission_matrix_metadata_missing", message: "Tenant permission enforcement rows require enforcement id, boundary key, and status patch path." });
  }
  if (!analysis?.tenantBoundaryActionQueue?.queueKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.tenant_boundary_action_queue_missing", message: "Package analysis should expose a deterministic tenant boundary action queue." });
  }
  if (analysis?.tenantBoundaryActionQueue?.acceptedForRuntime
    && (analysis.tenantBoundaryActionQueue.blockedOperationIds?.length || analysis.tenantBoundaryActionQueue.pendingOperationIds?.length)) {
    diagnostics.push({ severity: "error", code: "package.analysis.tenant_boundary_action_queue_accepted_with_blockers", message: "Tenant boundary action queue cannot be runtime-accepted while blocked or pending operations are present." });
  }
  if ((analysis?.tenantBoundaryActionQueue?.rows || []).some((row) => !row.queueId || !row.statusPatch?.patchId || !Array.isArray(row.commands))) {
    diagnostics.push({ severity: "error", code: "package.analysis.tenant_boundary_action_queue_metadata_missing", message: "Tenant boundary action queue rows require queue id, status patch, and command descriptors." });
  }
  if ((analysis?.tenantBoundaryActionQueue?.rows || []).some((row) => row.status === "ready" && row.statusPatch?.patchable !== true)) {
    diagnostics.push({ severity: "error", code: "package.analysis.tenant_boundary_action_queue_ready_not_patchable", message: "Ready tenant boundary action rows must expose a patchable client status patch." });
  }
  if (!analysis?.providerReadinessHandoff?.handoffKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.provider_readiness_handoff_missing", message: "Package analysis should expose provider readiness handoff state." });
  }
  if (analysis?.providerReadinessHandoff?.status === "ready"
    && analysis.providerReadinessHandoff.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.provider_readiness_ready_with_blockers", message: "Provider readiness handoff cannot be ready while blocked operations are present." });
  }
  if (!analysis?.exportReadinessLedger?.ledgerKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.export_readiness_ledger_missing", message: "Package analysis should expose a deterministic export readiness ledger." });
  }
  if (analysis?.exportReadinessLedger?.status === "export-ready"
    && analysis.exportReadinessLedger.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.export_readiness_ready_with_blockers", message: "Export readiness ledger cannot be ready while blocked operations are present." });
  }
  if (!analysis?.clientHandoffReadiness?.planKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.client_handoff_readiness_missing", message: "Package analysis should expose client handoff readiness state." });
  }
  if (analysis?.clientHandoffReadiness?.status === "ready"
    && analysis.clientHandoffReadiness.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.client_handoff_ready_with_blockers", message: "Client handoff readiness cannot be ready while blocked operations are present." });
  }
  if ((analysis?.clientHandoffReadiness?.rows || []).some((row) => !row.handoffId || !row.statusPatch?.patchId || !row.runtimeCommand?.commandId)) {
    diagnostics.push({ severity: "error", code: "package.analysis.client_handoff_runtime_contract_missing", message: "Client handoff readiness rows require handoff id, status patch id, and runtime command id." });
  }
  if ((analysis?.clientHandoffReadiness?.rows || []).some((row) => row.acceptedForClient && row.statusPatch?.patchable !== true)) {
    diagnostics.push({ severity: "error", code: "package.analysis.client_handoff_accepted_not_patchable", message: "Accepted client handoff readiness rows must expose a patchable client status patch." });
  }
  if (!analysis?.externalProviderHandoffLedger?.ledgerKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.external_provider_handoff_missing", message: "Package analysis should expose an external provider handoff ledger." });
  }
  if (analysis?.externalProviderHandoffLedger?.status === "handoff-ready"
    && analysis.externalProviderHandoffLedger.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.external_provider_handoff_ready_with_blockers", message: "External provider handoff ledger cannot be ready while blocked operations are present." });
  }
  if (!analysis?.providerDeliveryAcknowledgementLedger?.ledgerKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.provider_delivery_ack_missing", message: "Package analysis should expose a provider delivery acknowledgement ledger." });
  }
  if (analysis?.providerDeliveryAcknowledgementLedger?.status === "ack-ready"
    && analysis.providerDeliveryAcknowledgementLedger.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.provider_delivery_ack_ready_with_blockers", message: "Provider delivery acknowledgement ledger cannot be ready while blocked operations are present." });
  }
  if ((analysis?.providerDeliveryAcknowledgementLedger?.rows || []).some((row) => row.required && (!row.ackId || !row.providerStatusPath || !row.expectedAckPath))) {
    diagnostics.push({ severity: "error", code: "package.analysis.provider_delivery_ack_metadata_missing", message: "Provider delivery acknowledgement rows require ack id, provider status path, and expected ack path." });
  }
  const providerAckEvidenceRows = analysis?.runtimeContract?.providerDeliveryAckEvidence || [];
  if (providerAckEvidenceRows.some((row) => !row.evidenceId || !row.ackId || !row.handoffState?.state)) {
    diagnostics.push({ severity: "error", code: "package.analysis.provider_delivery_ack_evidence_missing", message: "Provider delivery acknowledgement evidence rows require evidence id, ack id, and handoff state." });
  }
  if (providerAckEvidenceRows.some((row) => row.status === "accepted" && row.acceptedForTruthHandoff !== true)) {
    diagnostics.push({ severity: "error", code: "package.analysis.provider_delivery_ack_evidence_not_accepted", message: "Accepted provider delivery acknowledgement evidence must be accepted for truth handoff." });
  }
  if ((analysis?.providerDeliveryAcknowledgementLedger?.rows || []).some((row) => row.callbackReceipt?.status === "blocked" && row.status !== "blocked")) {
    diagnostics.push({ severity: "error", code: "package.analysis.provider_callback_receipt_not_blocking", message: "Blocked provider callback receipts must block the provider delivery acknowledgement row." });
  }
  if ((analysis?.providerDeliveryAcknowledgementLedger?.rows || []).some((row) => row.callbackReceipt?.status === "accepted" && !row.callbackReceipt?.statusPatchId)) {
    diagnostics.push({ severity: "error", code: "package.analysis.provider_callback_receipt_patch_missing", message: "Accepted provider callback receipts require a statusPatchId for restart-safe acknowledgement handoff." });
  }
  if (!analysis?.providerDeliveryAckWorkflowHandoff?.handoffKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.provider_ack_workflow_missing", message: "Package analysis should expose provider acknowledgement workflow handoff state for approval export." });
  }
  if (analysis?.providerDeliveryAckWorkflowHandoff?.status === "ready"
    && analysis.providerDeliveryAckWorkflowHandoff.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.provider_ack_workflow_ready_with_blockers", message: "Provider acknowledgement workflow handoff cannot be ready while blocked operations are present." });
  }
  if ((analysis?.providerDeliveryAckWorkflowHandoff?.rows || []).some((row) => !row.workflowId || !row.ackId || !row.statusPatch?.patchId || !row.command?.command)) {
    diagnostics.push({ severity: "error", code: "package.analysis.provider_ack_workflow_metadata_missing", message: "Provider acknowledgement workflow rows require workflow id, acknowledgement id, status patch id, and command descriptor." });
  }
  if ((analysis?.providerDeliveryAckWorkflowHandoff?.rows || []).some((row) => row.acceptedForApproval && row.statusPatch?.patchable !== true && row.required)) {
    diagnostics.push({ severity: "error", code: "package.analysis.provider_ack_workflow_accepted_not_patchable", message: "Required provider acknowledgement workflow rows accepted for approval must expose a patchable status update." });
  }
  if (!analysis?.operationalIncidentLedger?.ledgerKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.operational_incident_ledger_missing", message: "Package analysis should expose an operational incident ledger for adapter and handoff health." });
  }
  if (analysis?.operationalIncidentLedger?.status === "clear"
    && analysis.operationalIncidentLedger.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.operational_incident_clear_with_blockers", message: "Operational incident ledger cannot be clear while blocked operations are present." });
  }
  if ((analysis?.operationalIncidentLedger?.rows || []).some((row) => !row.incidentId || !row.clientStatusPath || !row.statusPatch?.patchId)) {
    diagnostics.push({ severity: "error", code: "package.analysis.operational_incident_metadata_missing", message: "Operational incident rows require incident id, client status path, and status patch id." });
  }
  if (!analysis?.operationalAcceptanceMatrix?.matrixKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.operational_acceptance_missing", message: "Package analysis should expose an operational acceptance matrix for provider handoff." });
  }
  if (analysis?.operationalAcceptanceMatrix?.status === "accepted"
    && analysis.operationalAcceptanceMatrix.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.operational_acceptance_accepted_with_blockers", message: "Operational acceptance cannot be accepted while blocked operations are present." });
  }
  if ((analysis?.operationalAcceptanceMatrix?.rows || []).some((row) => !row.acceptanceId || !row.clientStatusPath || !row.statusPatch?.patchId)) {
    diagnostics.push({ severity: "error", code: "package.analysis.operational_acceptance_metadata_missing", message: "Operational acceptance rows require acceptance id, client status path, and status patch id." });
  }
  if ((analysis?.operationalAcceptanceMatrix?.rows || []).some((row) => row.status === "accepted" && row.acceptedForProvider !== true)) {
    diagnostics.push({ severity: "error", code: "package.analysis.operational_acceptance_not_provider_ready", message: "Accepted operational acceptance rows must be marked accepted for provider handoff." });
  }
  if ((analysis?.operationalAcceptanceMatrix?.rows || []).some((row) => row.status === "retry-scheduled" && row.retry?.nextDelayMs <= 0)) {
    diagnostics.push({ severity: "error", code: "package.analysis.operational_acceptance_retry_without_backoff", message: "Retry-scheduled operational acceptance rows require a positive retry delay." });
  }
  if (!analysis?.lifecycleControlPlane?.controlPlaneId) {
    diagnostics.push({ severity: "warning", code: "package.analysis.lifecycle_control_plane_missing", message: "Package analysis should expose a deterministic lifecycle control plane." });
  }
  if (analysis?.lifecycleControlPlane?.status === "dispatch-ready"
    && analysis.lifecycleControlPlane.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.lifecycle_control_dispatch_with_blockers", message: "Lifecycle control plane cannot dispatch while blocked operations are present." });
  }
  if ((analysis?.lifecycleControlPlane?.rows || []).some((row) => !row.controlId || !row.client?.statusPath || !Array.isArray(row.commands))) {
    diagnostics.push({ severity: "error", code: "package.analysis.lifecycle_control_metadata_missing", message: "Lifecycle control rows require control id, client status path, and command descriptors." });
  }
  if (!analysis?.acceptanceAcknowledgementControl?.acknowledgementKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.acceptance_acknowledgement_missing", message: "Package analysis should expose deterministic acceptance acknowledgement controls." });
  }
  if (analysis?.acceptanceAcknowledgementControl?.status === "accepted"
    && analysis.acceptanceAcknowledgementControl.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.acceptance_acknowledgement_accepted_with_blockers", message: "Acceptance acknowledgement controls cannot be accepted while blocked operations are present." });
  }
  if ((analysis?.acceptanceAcknowledgementControl?.rows || []).some((row) => !row.acknowledgementId || !row.statusPatch?.patchId || !Array.isArray(row.commands))) {
    diagnostics.push({ severity: "error", code: "package.analysis.acceptance_acknowledgement_metadata_missing", message: "Acceptance acknowledgement rows require acknowledgement id, status patch, and command descriptors." });
  }
  if ((analysis?.acceptanceAcknowledgementControl?.rows || []).some((row) => row.required && row.acceptedForApproval !== true && row.status !== "blocked")) {
    diagnostics.push({ severity: "error", code: "package.analysis.acceptance_acknowledgement_required_not_approval_ready", message: "Required acceptance acknowledgement rows must either be approval-ready or explicitly blocked." });
  }
  if (!analysis?.lifecycleSettingsAcceptance?.acceptanceKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.lifecycle_settings_acceptance_missing", message: "Package analysis should expose lifecycle settings acceptance for provider handoff." });
  }
  if (analysis?.lifecycleSettingsAcceptance?.acceptedForProvider
    && (analysis.lifecycleSettingsAcceptance.blockedOperationIds?.length || analysis.lifecycleSettingsAcceptance.pendingOperationIds?.length)) {
    diagnostics.push({ severity: "error", code: "package.analysis.lifecycle_settings_accepted_with_blockers", message: "Lifecycle settings acceptance cannot be provider-accepted while blocked or pending operations are present." });
  }
  if ((analysis?.lifecycleSettingsAcceptance?.rows || []).some((row) => !row.acceptanceId || !row.client?.statusPath || !Array.isArray(row.enabledCommands))) {
    diagnostics.push({ severity: "error", code: "package.analysis.lifecycle_settings_acceptance_metadata_missing", message: "Lifecycle settings acceptance rows require acceptance id, client status path, and enabled command list." });
  }
  if (!analysis?.operatorHandoffPacket?.packetId) {
    diagnostics.push({ severity: "warning", code: "package.analysis.operator_handoff_packet_missing", message: "Package analysis should expose a user-visible operator handoff packet." });
  }
  if (analysis?.operatorHandoffPacket?.status === "ready"
    && analysis.operatorHandoffPacket.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.operator_handoff_ready_with_blockers", message: "Operator handoff packet cannot be ready while blocked operations are present." });
  }
  if (!analysis?.exportAuditTrail?.auditTrailId) {
    diagnostics.push({ severity: "warning", code: "package.analysis.export_audit_trail_missing", message: "Package analysis should expose a deterministic export audit trail." });
  }
  if (analysis?.exportAuditTrail?.status === "accepted"
    && analysis.exportAuditTrail.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.export_audit_accepted_with_blockers", message: "Export audit trail cannot be accepted while blocked operations are present." });
  }
  if ((analysis?.exportAuditTrail?.rows || []).some((row) => !row.eventId || !row.auditDigest || !row.clientStatusPath)) {
    diagnostics.push({ severity: "error", code: "package.analysis.export_audit_metadata_missing", message: "Export audit rows require event id, audit digest, and client status path." });
  }
  if (!analysis?.exportHistoryBundle?.bundleId) {
    diagnostics.push({ severity: "warning", code: "package.analysis.export_history_bundle_missing", message: "Package analysis should expose deterministic export history snapshots for approval and route previews." });
  }
  if (analysis?.exportHistoryBundle?.status === "export-history-ready"
    && analysis.exportHistoryBundle.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.export_history_ready_with_blockers", message: "Export history bundle cannot be ready while blocked operations are present." });
  }
  if ((analysis?.exportHistoryBundle?.rows || []).some((row) => !row.snapshotId || !row.digest || !row.clientStatusPath)) {
    diagnostics.push({ severity: "error", code: "package.analysis.export_history_metadata_missing", message: "Export history rows require snapshot id, digest, and client status path." });
  }
  if (!analysis?.routeReadinessSurface?.surfaceId) {
    diagnostics.push({ severity: "warning", code: "package.analysis.route_readiness_missing", message: "Package analysis should expose a deterministic route readiness surface." });
  }
  if (analysis?.routeReadinessSurface?.status === "ready"
    && analysis.routeReadinessSurface.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.route_readiness_ready_with_blockers", message: "Route readiness surface cannot be ready while blocked operations are present." });
  }
  if ((analysis?.routeReadinessSurface?.rows || []).some((row) => !row.previewDigest || !row.statusPatch?.patchId || !Array.isArray(row.commands))) {
    diagnostics.push({ severity: "error", code: "package.analysis.route_readiness_metadata_missing", message: "Route readiness rows require preview digest, status patch, and command descriptors." });
  }
  if (!analysis?.previewAcceptanceSummary?.summaryKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.preview_acceptance_summary_missing", message: "Package analysis should expose a preview acceptance summary for route and approval clients." });
  }
  if (analysis?.previewAcceptanceSummary?.status === "handoff-ready"
    && analysis.previewAcceptanceSummary.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.preview_acceptance_ready_with_blockers", message: "Preview acceptance summary cannot be handoff-ready while blocked operations are present." });
  }
  if ((analysis?.previewAcceptanceSummary?.rows || []).some((row) => !row.summaryId || !row.statusPatch?.patchId || !Array.isArray(row.commands))) {
    diagnostics.push({ severity: "error", code: "package.analysis.preview_acceptance_row_shape", message: "Preview acceptance summary rows require summary id, status patch, and command descriptors." });
  }
  if (!analysis?.exportReportingCheckpoint?.checkpointKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.export_reporting_missing", message: "Package analysis should expose a deterministic export reporting checkpoint." });
  }
  if (analysis?.exportReportingCheckpoint?.status === "report-ready"
    && analysis.exportReportingCheckpoint.blockedOperationIds?.length) {
    diagnostics.push({ severity: "error", code: "package.analysis.export_reporting_ready_with_blockers", message: "Export reporting checkpoint cannot be ready while blocked operations are present." });
  }
  if ((analysis?.exportReportingCheckpoint?.rows || []).some((row) => !row.checkpointId || !row.reportDigest || !row.statusPatch?.patchId || !row.command?.command)) {
    diagnostics.push({ severity: "error", code: "package.analysis.export_reporting_metadata_missing", message: "Export reporting rows require checkpoint id, report digest, status patch, and command descriptor." });
  }
  if ((analysis?.exportReportingCheckpoint?.rows || []).some((row) => row.acceptedForRoute && row.statusPatch?.patchable !== true)) {
    diagnostics.push({ severity: "error", code: "package.analysis.export_reporting_accepted_not_patchable", message: "Accepted export reporting rows must expose a patchable route status patch." });
  }
  if (!analysis?.operatorNextActionState?.actionKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.operator_next_action_missing", message: "Package analysis should expose a deterministic operator next-action state for route and approval clients." });
  }
  if (analysis?.operatorNextActionState?.acceptedForDispatch
    && (analysis.operatorNextActionState.blockedOperationIds?.length || analysis.operatorNextActionState.pendingOperationIds?.length)) {
    diagnostics.push({ severity: "error", code: "package.analysis.operator_next_action_ready_with_blockers", message: "Operator next-action state cannot be dispatch-accepted while blocked or pending operations are present." });
  }
  if ((analysis?.operatorNextActionState?.rows || []).some((row) => !row.actionId || !row.clientStatusPath || !row.statusPatch?.patchId || !row.nextAction)) {
    diagnostics.push({ severity: "error", code: "package.analysis.operator_next_action_metadata_missing", message: "Operator next-action rows require action id, client status path, status patch, and next action." });
  }
  if (!analysis?.operatorAcceptanceCheckpoint?.checkpointKey) {
    diagnostics.push({ severity: "warning", code: "package.analysis.operator_acceptance_checkpoint_missing", message: "Package analysis should expose a deterministic operator acceptance checkpoint for ownership handoff." });
  }
  if (analysis?.operatorAcceptanceCheckpoint?.acceptedForOwnership
    && (analysis.operatorAcceptanceCheckpoint.blockedOperationIds?.length || analysis.operatorAcceptanceCheckpoint.pendingOperationIds?.length)) {
    diagnostics.push({ severity: "error", code: "package.analysis.operator_acceptance_ready_with_blockers", message: "Operator acceptance checkpoints cannot be ownership-accepted while blocked or pending operations are present." });
  }
  if ((analysis?.operatorAcceptanceCheckpoint?.rows || []).some((row) => !row.checkpointId || !row.clientStatusPath || !row.statusPatch?.patchId || !Array.isArray(row.commands))) {
    diagnostics.push({ severity: "error", code: "package.analysis.operator_acceptance_checkpoint_metadata_missing", message: "Operator acceptance checkpoint rows require checkpoint id, client status path, status patch, and command descriptors." });
  }
  if ((analysis?.operatorAcceptanceCheckpoint?.rows || []).some((row) => row.acceptedForOwnership && row.statusPatch?.patchable !== true)) {
    diagnostics.push({ severity: "error", code: "package.analysis.operator_acceptance_checkpoint_not_patchable", message: "Ownership-accepted operator acceptance checkpoints must expose a patchable status update." });
  }
  const receiptRows = analysis?.runtimeContract?.clientHandoffReceipts || [];
  if (receiptRows.length && receiptRows.some((row) => !row.receiptId || !row.clientStatusPath || !row.providerStatusPath)) {
    diagnostics.push({ severity: "error", code: "package.analysis.client_handoff_receipt_metadata_missing", message: "Client handoff receipts require receipt id, client status path, and provider status path." });
  }
  if (receiptRows.some((row) => row.state === "receipt-ready" && row.acceptedForHandoff !== true)) {
    diagnostics.push({ severity: "error", code: "package.analysis.client_handoff_receipt_ready_not_accepted", message: "Receipt-ready Mailchimp handoff rows must be accepted for handoff." });
  }
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    nextAction: diagnostics.length ? "repair_package_analysis" : analysis.summary?.nextAction || "handoff_to_runtime_adapter",
  };
}

export default analyzeMailchimpPackage;
