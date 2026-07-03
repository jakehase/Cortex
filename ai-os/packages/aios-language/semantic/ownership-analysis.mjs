import { analyzeMailchimpPackage } from "./package-analysis.mjs";

function compactString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function ownerKey(parts) {
  return parts.map((part) => compactString(part, "unknown").toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-")).join(":");
}

function normalizeRoleSet(value, fallback = []) {
  const roles = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set([
    ...roles.map((role) => compactString(role)).filter(Boolean),
    ...fallback,
  ])].sort();
}

function boundaryContractForOperation(operation = {}, options = {}) {
  const contract = operation.tenantPermissionBoundary || {};
  const scope = contract.scope || {};
  return {
    boundaryKey: compactString(contract.boundaryKey, ownerKey(["boundary", operation.id || "operation"])),
    requiredTenant: compactString(scope.tenant || operation.tenant || options.tenant, "default"),
    requiredWorkspace: compactString(scope.workspace || operation.workspace || options.workspace, "default"),
    environment: compactString(scope.environment || operation.environment, "production"),
    allowedRoles: normalizeRoleSet(contract.allowedRoles, operation.externalWrite ? ["operator", "admin"] : ["service", "operator", "admin"]),
    deniedRoles: normalizeRoleSet(contract.deniedRoles, []),
    requiresLease: contract.requiresLease === true || operation.externalWrite === true,
    requiresAuditCorrelation: contract.requiresAuditCorrelation === true || operation.externalWrite === true,
    auditChannel: compactString(contract.auditChannel, `mailchimp.audit.${scope.tenant || "default"}.${scope.workspace || "default"}`),
    handoffStatusPath: compactString(contract.handoffStatusPath || contract.statusHandoff?.clientStatusPath),
    status: compactString(contract.status, "ready"),
    nextAction: compactString(contract.statusHandoff?.nextAction, "handoff_with_boundary_scope"),
  };
}

function normalizeOwner(source = {}, fallback = {}) {
  const raw = source.owner || source.principal || source.service || fallback.owner || "mailchimp-runtime";
  const kind = source.kind || source.type || fallback.kind || (String(raw).includes("@") ? "user" : "service");
  const roles = normalizeRoleSet(source.roles || source.role || fallback.roles, kind === "operator" ? ["operator"] : ["service"]);
  return {
    id: ownerKey([kind, raw]),
    kind,
    displayName: compactString(raw, "mailchimp-runtime"),
    tenant: compactString(source.tenant || fallback.tenant, "default"),
    workspace: compactString(source.workspace || fallback.workspace, "default"),
    roles,
    permissions: {
      canLeaseExternalWrite: roles.includes("operator") || roles.includes("admin"),
      canReadCheckpoint: true,
      canTransferOwnership: roles.includes("admin"),
      canReleaseLease: roles.includes("operator") || roles.includes("admin") || kind === "service",
    },
  };
}

function defaultOwnerForOperation(packageAnalysis, operation) {
  return normalizeOwner({}, {
    owner: operation.externalWrite ? "mailchimp-operator" : "mailchimp-runtime",
    kind: operation.externalWrite ? "operator" : "service",
    tenant: packageAnalysis.package?.name,
    workspace: packageAnalysis.package?.version,
  });
}

function buildCapabilityOwnership(packageAnalysis, operation, owner) {
  return operation.capabilityNames.map((capability) => {
    const externalWrite = operation.externalWrite || capability.includes(".write") || capability === "external.write";
    return {
      capability,
      ownerId: owner.id,
      grantMode: externalWrite ? "leased" : "delegated",
      scope: externalWrite ? "operation" : "package",
      leaseRequired: externalWrite,
      auditKey: ownerKey(["audit", packageAnalysis.package?.id, operation.id, capability]),
      releaseStatus: externalWrite ? "release-after-provider-ack" : "release-not-required",
    };
  });
}

function buildMemoryOwnership(packageAnalysis, operation, owner) {
  const state = packageAnalysis.runtimeContract?.commandLog || {};
  const persistedState = operation.persistedState || {};
  const persisted = [
    operation.checkpointKey,
    persistedState.snapshotKey,
    persistedState.ledgerKey,
    operation.runtimeClientState?.client?.statusKey,
    operation.runtimeClientState?.request?.replayToken,
    ...(Array.isArray(state.ledgerKeys) ? state.ledgerKeys : []),
  ].filter(Boolean);

  return [...new Set(persisted)].sort().map((key) => ({
    key,
    ownerId: owner.id,
    access: operation.externalWrite ? "read-write" : "read",
    restartSafe: operation.restartSafe,
    retention: packageAnalysis.package?.persistence?.retention || "checkpoint",
    recoveryRole: operation.restartSafe ? "resume-anchor" : "operator-review-anchor",
  }));
}

function buildTenantBoundary(packageAnalysis, operation, owner, options = {}) {
  const runtimeScope = options.runtimeScope || {};
  const contract = boundaryContractForOperation(operation, {
    tenant: runtimeScope.tenant || options.tenant || packageAnalysis.package?.name,
    workspace: runtimeScope.workspace || options.workspace || packageAnalysis.package?.version,
  });
  const requiredTenant = compactString(contract.requiredTenant, compactString(packageAnalysis.package?.name, "default"));
  const requiredWorkspace = compactString(contract.requiredWorkspace, compactString(packageAnalysis.package?.version, "default"));
  const leaseRoles = contract.allowedRoles;
  const roleAllowed = owner.roles.some((role) => leaseRoles.includes(role))
    && !owner.roles.some((role) => contract.deniedRoles.includes(role));
  const tenantMatches = owner.tenant === requiredTenant;
  const workspaceMatches = owner.workspace === requiredWorkspace;
  const contractReady = contract.status === "ready";
  const isolated = tenantMatches && workspaceMatches && roleAllowed && contractReady;
  const transferRestricted = operation.externalWrite
    ? owner.permissions.canTransferOwnership || owner.permissions.canLeaseExternalWrite
    : true;

  return {
    boundaryKey: contract.boundaryKey,
    requiredTenant,
    requiredWorkspace,
    environment: contract.environment,
    observedTenant: owner.tenant,
    observedWorkspace: owner.workspace,
    allowedRoles: leaseRoles,
    deniedRoles: contract.deniedRoles,
    observedRoles: owner.roles,
    requiresLease: contract.requiresLease,
    requiresAuditCorrelation: contract.requiresAuditCorrelation,
    auditChannel: contract.auditChannel,
    handoffStatusPath: contract.handoffStatusPath,
    checks: {
      tenantMatches,
      workspaceMatches,
      roleAllowed,
      transferRestricted,
      contractReady,
    },
    status: isolated ? "isolated" : "blocked",
    nextAction: isolated
      ? "handoff_with_tenant_boundary"
      : !contractReady
        ? contract.nextAction || "repair_tenant_permission_boundary"
      : !tenantMatches
        ? "repair_owner_tenant_scope"
        : !workspaceMatches
          ? "repair_owner_workspace_scope"
          : "assign_owner_with_required_role",
  };
}

function buildAuditHandoff(packageAnalysis, operation, owner, capabilityOwnership, memoryOwnership, boundary) {
  const persistedState = operation.persistedState || {};
  const externalCapabilityNames = capabilityOwnership
    .filter((capability) => capability.leaseRequired)
    .map((capability) => capability.capability)
    .sort();
  const auditId = ownerKey([
    "audit",
    packageAnalysis.package?.id,
    operation.id,
    owner.id,
    persistedState.snapshotKey || operation.checkpointKey,
  ]);

  return {
    auditId,
    boundaryKey: boundary.boundaryKey,
    operationId: operation.id,
    ownerId: owner.id,
    tenant: boundary.requiredTenant,
    workspace: boundary.requiredWorkspace,
    environment: boundary.environment,
    auditChannel: boundary.auditChannel,
    required: boundary.requiresAuditCorrelation || operation.externalWrite || externalCapabilityNames.length > 0,
    status: boundary.status === "isolated"
      ? operation.externalWrite
        ? "lease-audit-required"
        : "audit-ready"
      : "boundary-blocked",
    correlation: {
      requestId: operation.runtimeClientState?.request?.requestId || null,
      idempotencyKey: operation.runtimeClientState?.request?.idempotencyKey || null,
      snapshotKey: persistedState.snapshotKey || null,
      ledgerKey: persistedState.ledgerKey || null,
      statusPath: operation.runtimeClientState?.client?.statusPath || null,
      boundaryStatusPath: boundary.handoffStatusPath || null,
    },
    evidence: {
      capabilityNames: externalCapabilityNames,
      memoryKeys: memoryOwnership.map((item) => item.key).sort(),
      ownerRoles: owner.roles,
      allowedRoles: boundary.allowedRoles,
      deniedRoles: boundary.deniedRoles,
    },
    nextAction: boundary.status !== "isolated"
      ? boundary.nextAction
      : operation.externalWrite
        ? "append_lease_audit_before_handoff"
        : "append_runtime_audit_record",
  };
}

function normalizePersistedCommandState(packageAnalysis, operation, owner, capabilityOwnership, memoryOwnership) {
  const request = operation.runtimeClientState?.request || {};
  const client = operation.runtimeClientState?.client || {};
  const handoffPayload = operation.runtimeClientState?.handoffPayload || {};
  const packagePersistedState = operation.persistedState || {};
  const adoption = operation.clientRuntimeAdoption || {};
  const leaseCapabilities = capabilityOwnership
    .filter((capability) => capability.leaseRequired)
    .map((capability) => capability.capability)
    .sort();
  const adoptionMetadataReady = Boolean(
    adoption.adoptionKey
    && (adoption.request?.requestId || request.requestId)
    && (adoption.client?.statusPath || client.statusPath)
    && (adoption.persisted?.snapshotKey || packagePersistedState.snapshotKey),
  );
  const adoptionBoundaryMatches = !adoption.boundary?.boundaryKey
    || adoption.boundary.boundaryKey === operation.tenantPermissionBoundary?.boundaryKey;
  const adoptionReplaySafe = adoption.persisted?.safeToReplay !== false;
  const resumeAllowed = operation.restartSafe
    && memoryOwnership.every((item) => item.restartSafe !== false)
    && adoptionReplaySafe
    && adoptionBoundaryMatches
    && (operation.externalWrite ? Boolean(request.idempotencyKey) : true);
  const commandId = ownerKey([
    "cmd",
    packageAnalysis.package?.id,
    operation.id,
    request.requestId,
    owner.id,
  ]);
  const persistedKeys = memoryOwnership.map((item) => item.key).sort();
  const resumeCommand = {
    commandId,
    operationId: operation.id,
    ownerId: owner.id,
    requestId: request.requestId || null,
    idempotencyKey: request.idempotencyKey || null,
    replayToken: request.replayToken || null,
    statusPath: client.statusPath || operation.statusHandoff?.clientStatusPath || null,
    progressPath: client.progressPath || null,
    adoptionKey: adoption.adoptionKey || null,
    providerStatusPath: adoption.client?.providerStatusPath || null,
    leaseCapabilities,
    persistedKeys,
    handoffPayload,
  };
  const adoptionDrift = [
    ...(!adoptionMetadataReady ? ["adoption_metadata_missing"] : []),
    ...(!adoptionBoundaryMatches ? ["boundary_key_changed"] : []),
    ...(!adoptionReplaySafe ? ["adoption_replay_not_safe"] : []),
    ...(adoption.status && String(adoption.status).startsWith("blocked:")
      ? [String(adoption.status).slice("blocked:".length)]
      : []),
  ];

  return {
    commandId,
    restartSafe: resumeAllowed,
    status: resumeAllowed
      ? adoptionDrift.length
        ? "resume-ready-with-adoption-review"
        : "resume-ready"
      : "operator-review-required",
    nextAction: resumeAllowed
      ? adoptionDrift.length
        ? "review_client_runtime_adoption_before_resume"
        : "resume_from_persisted_command"
      : operation.replayPolicy === "manual-review"
        ? "hold_for_operator_review"
        : adoptionDrift.length
          ? "repair_client_runtime_adoption_state"
          : "repair_persisted_runtime_state",
    dedupe: {
      key: request.idempotencyKey || commandId,
      scope: request.dedupeScope || "operation",
      replayToken: request.replayToken || null,
    },
    clientRuntimeAdoption: {
      adoptionKey: adoption.adoptionKey || null,
      status: adoption.status || "unknown",
      acceptedForClient: adoption.acceptedForClient === true,
      metadataReady: adoptionMetadataReady,
      boundaryMatches: adoptionBoundaryMatches,
      safeToReplay: adoptionReplaySafe,
      drift: adoptionDrift,
      requestId: adoption.request?.requestId || request.requestId || null,
      clientStatusPath: adoption.client?.statusPath || client.statusPath || null,
      providerStatusPath: adoption.client?.providerStatusPath || null,
      boundaryStatusPath: adoption.boundary?.boundaryStatusPath || operation.tenantPermissionBoundary?.handoffStatusPath || null,
      nextAction: adoption.workflow?.nextAction || null,
    },
    resumeCommand,
    recoverySnapshot: {
      packageId: packageAnalysis.package?.id,
      operationId: operation.id,
      descriptorId: operation.descriptorId,
      ownerId: owner.id,
      adoptionKey: adoption.adoptionKey || null,
      statusPath: resumeCommand.statusPath,
      providerStatusPath: resumeCommand.providerStatusPath,
      snapshotKey: packagePersistedState.snapshotKey || null,
      ledgerKey: packagePersistedState.ledgerKey || null,
      recoveryPath: packagePersistedState.recoveryPath || null,
      memoryKeys: persistedKeys,
      canReplayWithoutOperator: resumeAllowed,
      adoptionDrift,
      requiredLeaseCapabilities: leaseCapabilities,
      boundaryKey: operation.tenantPermissionBoundary?.boundaryKey || null,
      requiredTenant: operation.tenantPermissionBoundary?.scope?.tenant || null,
      requiredWorkspace: operation.tenantPermissionBoundary?.scope?.workspace || null,
      boundaryStatusPath: operation.tenantPermissionBoundary?.handoffStatusPath || null,
    },
  };
}

function buildOwnershipGate(packageAnalysis, operation, owner, capabilityOwnership, memoryOwnership, boundary, auditHandoff) {
  const missingLease = capabilityOwnership.filter((item) => item.leaseRequired && !item.ownerId);
  const unsafeMemory = memoryOwnership.filter((item) => item.restartSafe === false && item.access === "read-write");
  const missingRuntimeRequest = operation.externalWrite && !operation.runtimeClientState?.request?.idempotencyKey;
  const boundaryBlocked = boundary.status !== "isolated";
  const roleBlocked = operation.externalWrite && !owner.permissions.canLeaseExternalWrite;
  const blocked = missingLease.length > 0 || unsafeMemory.length > 0 || missingRuntimeRequest || boundaryBlocked || roleBlocked;

  return {
    operationId: operation.id,
    ownerId: owner.id,
    status: blocked ? "blocked" : operation.externalWrite ? "lease-required" : "ready",
    nextAction: blocked
      ? missingRuntimeRequest
        ? "repair_runtime_request_state"
        : boundaryBlocked
          ? boundary.nextAction
          : roleBlocked
            ? "assign_operator_or_admin_owner"
            : "repair_ownership_contract"
      : operation.externalWrite
        ? auditHandoff.nextAction
        : operation.statusHandoff?.nextAction || "queue_adapter_handoff",
    controls: {
      canTransfer: operation.externalWrite,
      canRelease: capabilityOwnership.some((item) => item.leaseRequired),
      canResumeAfterRestart: operation.restartSafe && memoryOwnership.every((item) => item.restartSafe !== false),
      requiresAuditTrail: operation.externalWrite || capabilityOwnership.length > 0,
      tenantIsolated: boundary.status === "isolated",
      ownerCanLeaseExternalWrite: owner.permissions.canLeaseExternalWrite,
    },
    runtimeState: {
      requestId: operation.runtimeClientState?.request?.requestId || null,
      idempotencyKeyPresent: Boolean(operation.runtimeClientState?.request?.idempotencyKey),
      clientStatusPath: operation.runtimeClientState?.client?.statusPath || null,
      replayToken: operation.runtimeClientState?.request?.replayToken || null,
    },
    boundary: {
      boundaryKey: boundary.boundaryKey,
      tenant: boundary.requiredTenant,
      workspace: boundary.requiredWorkspace,
      environment: boundary.environment,
      status: boundary.status,
      auditId: auditHandoff.auditId,
      auditStatus: auditHandoff.status,
      auditChannel: boundary.auditChannel,
      handoffStatusPath: boundary.handoffStatusPath,
      allowedRoles: boundary.allowedRoles,
    },
  };
}

function normalizeOwnershipLifecycleSettings(settings = {}, options = {}) {
  const raw = settings.ownership || settings.controls || settings;
  const mode = compactString(raw.mode || options.ownershipMode, "supervised");
  const enabled = raw.enabled !== false && options.enabled !== false;
  const autoAcquireLeases = raw.autoAcquireLeases === true || options.autoAcquireLeases === true;
  const allowServiceRelease = raw.allowServiceRelease !== false;
  const requireAuditBeforeRelease = raw.requireAuditBeforeRelease !== false;
  const allowedTransferRoles = normalizeRoleSet(raw.allowedTransferRoles || options.allowedTransferRoles, ["admin"]);
  const disabledOperations = new Set(Array.isArray(raw.disabledOperations)
    ? raw.disabledOperations.map((id) => compactString(id)).filter(Boolean)
    : []);
  const enabledOperations = new Set(Array.isArray(raw.enabledOperations)
    ? raw.enabledOperations.map((id) => compactString(id)).filter(Boolean)
    : []);
  const schedule = raw.schedule || {};
  const earliestAt = compactString(schedule.earliestAt || raw.earliestAt);
  const notAfter = compactString(schedule.notAfter || raw.notAfter);
  const cooldownMs = Number.isFinite(Number(schedule.cooldownMs ?? raw.cooldownMs))
    ? Math.max(0, Number(schedule.cooldownMs ?? raw.cooldownMs))
    : 0;
  const maxLeaseActions = Number.isFinite(Number(schedule.maxLeaseActions ?? raw.maxLeaseActions))
    ? Math.max(0, Number(schedule.maxLeaseActions ?? raw.maxLeaseActions))
    : Infinity;
  const validation = [];

  if (!["supervised", "automatic", "disabled"].includes(mode)) {
    validation.push({
      severity: "error",
      code: "ownership.settings.mode_invalid",
      message: `Unsupported Mailchimp ownership lifecycle mode "${mode}".`,
      field: "runtime.ownership.mode",
    });
  }
  if (allowedTransferRoles.length === 0 && enabled) {
    validation.push({
      severity: "error",
      code: "ownership.settings.transfer_roles_missing",
      message: "Mailchimp ownership transfer controls require at least one allowed transfer role.",
      field: "runtime.ownership.allowedTransferRoles",
    });
  }
  if (earliestAt && notAfter && earliestAt > notAfter) {
    validation.push({
      severity: "error",
      code: "ownership.settings.schedule_invalid",
      message: "Mailchimp ownership lifecycle schedule has earliestAt after notAfter.",
      field: "runtime.ownership.schedule",
    });
  }

  return {
    mode,
    enabled: enabled && mode !== "disabled",
    autoAcquireLeases: autoAcquireLeases || mode === "automatic",
    allowServiceRelease,
    requireAuditBeforeRelease,
    allowedTransferRoles,
    disabledOperations: [...disabledOperations].sort(),
    enabledOperations: [...enabledOperations].sort(),
    schedule: {
      earliestAt,
      notAfter,
      cooldownMs,
      maxLeaseActions: Number.isFinite(maxLeaseActions) ? maxLeaseActions : null,
    },
    validation,
    isOperationEnabled(operationId) {
      if (!enabled || mode === "disabled" || disabledOperations.has(operationId)) {
        return false;
      }
      return enabledOperations.size === 0 || enabledOperations.has(operationId);
    },
  };
}

function lifecycleScheduleForOwnership(entry, settings, leaseActionCount = 0) {
  const operationEnabled = settings.isOperationEnabled(entry.operationId);
  const leaseLimitReached = settings.schedule.maxLeaseActions !== null
    && leaseActionCount >= settings.schedule.maxLeaseActions;
  const scheduled = Boolean(settings.schedule.earliestAt || settings.schedule.notAfter || settings.schedule.cooldownMs);
  const blockedReason = !settings.enabled
    ? "ownership-disabled"
    : !operationEnabled
      ? "operation-disabled"
      : leaseLimitReached
        ? "lease-action-limit"
        : "";

  return {
    enabled: settings.enabled,
    operationEnabled,
    scheduled,
    earliestAt: settings.schedule.earliestAt,
    notAfter: settings.schedule.notAfter,
    cooldownMs: settings.schedule.cooldownMs,
    leaseLimitReached,
    blockedReason,
    nextAction: blockedReason
      ? "update_ownership_settings"
      : scheduled
        ? "schedule_ownership_lifecycle_action"
        : entry.gate.nextAction,
  };
}

function buildOwnershipLifecycleState(packageAnalysis, operationOwnership, settings) {
  const packageSnapshots = new Map((packageAnalysis.history?.snapshots || []).map((snapshot) => [snapshot.operationId, snapshot]));
  const leaseActionCount = operationOwnership
    .filter((entry) => entry.capabilities.some((capability) => capability.leaseRequired))
    .length;
  const rows = operationOwnership.map((entry, index) => {
    const snapshot = packageSnapshots.get(entry.operationId) || {};
    const schedule = lifecycleScheduleForOwnership(entry, settings, leaseActionCount);
    const releaseBlocked = settings.requireAuditBeforeRelease
      && entry.auditHandoff.required
      && entry.auditHandoff.status === "boundary-blocked";
    const serviceReleaseBlocked = entry.owner.kind === "service"
      && settings.allowServiceRelease === false
      && entry.capabilities.some((capability) => capability.leaseRequired);
    const blockedReason = schedule.blockedReason
      || (releaseBlocked ? "audit-required" : "")
      || (serviceReleaseBlocked ? "service-release-disabled" : "")
      || (entry.gate.status === "blocked" ? "gate-blocked" : "");
    const command = blockedReason
      ? "hold"
      : entry.gate.status === "lease-required"
        ? settings.autoAcquireLeases ? "acquire-lease" : "request-lease"
        : entry.persistedState.status === "resume-ready"
          ? "resume"
          : "observe";

    return {
      index,
      operationId: entry.operationId,
      ownerId: entry.owner.id,
      command,
      status: blockedReason
        ? `blocked:${blockedReason}`
        : command === "acquire-lease"
          ? "lease-acquire-ready"
          : command === "request-lease"
            ? "operator-lease-ready"
            : entry.persistedState.status,
      blockedReason,
      boundaryStatus: entry.boundary.status,
      auditStatus: entry.auditHandoff.status,
      restartStatus: entry.persistedState.status,
      adoptionStatus: entry.persistedState.clientRuntimeAdoption.status,
      adoptionKey: entry.persistedState.clientRuntimeAdoption.adoptionKey,
      adoptionDrift: entry.persistedState.clientRuntimeAdoption.drift,
      packageSnapshotStatus: snapshot.status || "unknown",
      requestId: entry.persistedState.resumeCommand.requestId,
      clientStatusPath: entry.persistedState.resumeCommand.statusPath,
      providerStatusPath: entry.persistedState.resumeCommand.providerStatusPath,
      leaseCapabilities: entry.persistedState.resumeCommand.leaseCapabilities,
      schedule,
      nextAction: blockedReason
        ? schedule.nextAction === "update_ownership_settings"
          ? "update_ownership_settings"
          : releaseBlocked
            ? "append_audit_before_release"
            : serviceReleaseBlocked
              ? "assign_operator_owner_before_release"
              : entry.gate.nextAction
        : command === "acquire-lease"
          ? "auto_acquire_mailchimp_lease"
          : command === "request-lease"
            ? "present_lease_action_to_operator"
            : entry.persistedState.nextAction,
    };
  });
  const blockedRows = rows.filter((row) => row.blockedReason);
  const acquireRows = rows.filter((row) => row.command === "acquire-lease");
  const requestRows = rows.filter((row) => row.command === "request-lease");
  const resumeRows = rows.filter((row) => row.command === "resume");
  const settingsErrors = settings.validation.filter((entry) => entry.severity === "error");

  return {
    format: "aios.mailchimp.ownership.lifecycle.v1",
    provider: "mailchimp",
    packageId: packageAnalysis.package?.id || null,
    status: settingsErrors.length
      ? "settings-blocked"
      : blockedRows.length
        ? "blocked"
        : acquireRows.length
          ? "auto-lease-ready"
          : requestRows.length
            ? "operator-lease-ready"
            : "ready",
    command: settingsErrors.length || blockedRows.length
      ? "hold"
      : acquireRows.length
        ? "acquire-leases"
        : requestRows.length
          ? "request-operator-leases"
          : resumeRows.length
            ? "resume-commands"
            : "observe",
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      autoAcquireReady: acquireRows.length,
      operatorLeaseReady: requestRows.length,
      resumeReady: resumeRows.length,
      settingsErrors: settingsErrors.length,
      packageBlocked: packageAnalysis.analytics?.counters?.blockedOperationCount || 0,
      packageRetryable: packageAnalysis.analytics?.counters?.retryableAdapterOperationCount || 0,
    },
    nextAction: settingsErrors.length
      ? "repair_ownership_settings"
      : blockedRows.length
        ? blockedRows[0].nextAction
        : acquireRows.length
          ? "auto_acquire_mailchimp_leases"
          : requestRows.length
            ? "present_lease_actions_to_operator"
            : resumeRows.length
              ? "resume_owned_mailchimp_commands"
              : packageAnalysis.summary?.nextAction || "handoff_to_runtime_adapter",
  };
}

function buildOwnershipProviderSync(packageAnalysis, operationOwnership, lifecycle) {
  const lifecycleByOperation = new Map((packageAnalysis.runtimeContract?.lifecycleVisibility || []).map((entry) => [entry.operationId, entry]));
  const acceptanceByOperation = new Map((packageAnalysis.acceptancePreview?.rows || []).map((row) => [row.operationId, row]));
  const checkpointPlan = packageAnalysis.runtimeContract?.adapterRecoveryCheckpointPlan
    || packageAnalysis.adapterRecoveryCheckpointPlan
    || {};
  const checkpointByOperation = new Map((checkpointPlan.rows || []).map((row) => [row.operationId, row]));
  const rows = operationOwnership.map((entry) => {
    const visibility = lifecycleByOperation.get(entry.operationId) || entry.packageLifecycle || {};
    const packageAcceptance = acceptanceByOperation.get(entry.operationId) || {};
    const checkpoint = checkpointByOperation.get(entry.operationId) || {};
    const leaseCapabilities = entry.capabilities
      .filter((capability) => capability.leaseRequired)
      .map((capability) => capability.capability)
      .sort();
    const lifecycleBlocked = ["settings-blocked", "disabled", "health-paused", "adapter-failed"].includes(visibility.status);
    const packageAcceptanceBlocked = packageAcceptance.accepted === false
      || [
        "metadata-incomplete",
        "boundary-blocked",
        "adapter-failed",
        "validation-blocked",
      ].includes(packageAcceptance.readiness)
      || String(packageAcceptance.readiness || "").startsWith("lifecycle-");
    const recoveryCheckpointBlocked = checkpoint.status === "blocked"
      || checkpoint.status === "operator-review"
      || (checkpoint.status === "pending" && entry.gate.status === "blocked");
    const metadataReady = Boolean(
      entry.persistedState.resumeCommand.requestId
      && entry.persistedState.resumeCommand.statusPath
      && visibility.clientStatusPath,
    );
    const negotiable = entry.boundary.status === "isolated"
      && entry.gate.status !== "blocked"
      && !lifecycleBlocked
      && !packageAcceptanceBlocked
      && !recoveryCheckpointBlocked
      && metadataReady;
    const status = !metadataReady
      ? "metadata-incomplete"
      : packageAcceptanceBlocked
        ? `package-${packageAcceptance.readiness || "acceptance-blocked"}`
      : recoveryCheckpointBlocked
        ? `recovery-checkpoint-${checkpoint.status || "blocked"}`
      : lifecycleBlocked
        ? `lifecycle-${visibility.status}`
        : entry.boundary.status !== "isolated"
          ? "boundary-blocked"
          : entry.gate.status === "blocked"
            ? "ownership-blocked"
            : leaseCapabilities.length
              ? "lease-negotiable"
              : "delegation-negotiable";

    return {
      operationId: entry.operationId,
      ownerId: entry.owner.id,
      status,
      negotiable,
      provider: "mailchimp",
      service: "mailchimp-marketing",
      requestId: entry.persistedState.resumeCommand.requestId,
      clientStatusPath: entry.persistedState.resumeCommand.statusPath,
      providerStatusPath: entry.persistedState.resumeCommand.providerStatusPath,
      adoptionKey: entry.persistedState.clientRuntimeAdoption.adoptionKey,
      adoptionStatus: entry.persistedState.clientRuntimeAdoption.status,
      adoptionDrift: entry.persistedState.clientRuntimeAdoption.drift,
      lifecycleStatus: visibility.status || "unknown",
      lifecycleNextAction: visibility.nextAction || entry.gate.nextAction,
      lifecycleSchedule: visibility.schedule || null,
      packageAcceptanceKey: packageAnalysis.acceptancePreview?.acceptanceKey || null,
      packageAcceptanceStatus: packageAcceptance.readiness || packageAnalysis.acceptancePreview?.status || "unknown",
      packageAcceptanceAccepted: packageAcceptance.accepted !== false,
      packageAcceptanceNextAction: packageAcceptance.nextStep?.action || packageAnalysis.acceptancePreview?.nextAction || null,
      recoveryCheckpointPlanKey: checkpointPlan.planKey || null,
      recoveryCheckpointId: checkpoint.checkpointId || null,
      recoveryCheckpointStatus: checkpoint.status || "unknown",
      recoveryCheckpointReplaySafe: checkpoint.replaySafe === true,
      recoveryCheckpointBlockedBy: checkpoint.blockedBy || [],
      recoveryCheckpointPendingBy: checkpoint.pendingBy || [],
      boundaryKey: entry.boundary.boundaryKey,
      auditId: entry.auditHandoff.auditId,
      auditChannel: entry.auditHandoff.auditChannel,
      leaseCapabilities,
      delegatedCapabilities: entry.capabilities
        .filter((capability) => !capability.leaseRequired)
        .map((capability) => capability.capability)
        .sort(),
      requiredRoles: entry.boundary.allowedRoles,
      observedRoles: entry.owner.roles,
      nextAction: status === "metadata-incomplete"
          ? "repair_provider_sync_metadata"
        : packageAcceptanceBlocked
          ? packageAcceptance.nextStep?.action || packageAnalysis.acceptancePreview?.nextAction || "repair_package_acceptance_preview"
        : recoveryCheckpointBlocked
          ? checkpoint.nextAction || checkpointPlan.nextAction || "repair_adapter_recovery_checkpoint"
        : lifecycleBlocked
          ? visibility.nextAction || "repair_lifecycle_visibility"
          : entry.boundary.status !== "isolated"
            ? entry.boundary.nextAction
            : entry.gate.status === "blocked"
              ? entry.gate.nextAction
              : leaseCapabilities.length
                ? "negotiate_mailchimp_external_write_lease"
                : "delegate_mailchimp_read_capability",
    };
  });
  const blockedRows = rows.filter((row) => !row.negotiable);
  const leaseRows = rows.filter((row) => row.status === "lease-negotiable");
  const syncKey = ownerKey([
    "provider-sync",
    packageAnalysis.package?.id,
    rows.length,
    blockedRows.length,
    lifecycle.status,
  ]);

  return {
    format: "aios.mailchimp.ownership.providerSync.v1",
    provider: "mailchimp",
    service: "mailchimp-marketing",
    syncKey,
    status: blockedRows.length
      ? "blocked"
      : leaseRows.length
        ? "lease-negotiation-ready"
        : "delegation-ready",
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      leaseNegotiable: leaseRows.length,
      delegationNegotiable: rows.filter((row) => row.status === "delegation-negotiable").length,
      metadataIncomplete: rows.filter((row) => row.status === "metadata-incomplete").length,
      lifecycleBlocked: rows.filter((row) => row.status.startsWith("lifecycle-")).length,
      packageAcceptanceBlocked: rows.filter((row) => row.status.startsWith("package-")).length,
      recoveryCheckpointBlocked: rows.filter((row) => row.status.startsWith("recovery-checkpoint-")).length,
      recoveryCheckpointReady: rows.filter((row) => row.recoveryCheckpointStatus === "checkpoint-ready").length,
    },
    externalHandoff: {
      allowed: blockedRows.length === 0,
      operationIds: rows.filter((row) => row.negotiable).map((row) => row.operationId).sort(),
      blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
      nextAction: blockedRows[0]?.nextAction
        || (leaseRows.length ? "negotiate_mailchimp_external_write_leases" : "delegate_mailchimp_capabilities"),
    },
  };
}

function buildOwnershipControlPersistence(packageAnalysis, operationOwnership, lifecycle, providerSync, options = {}) {
  const packet = options.syscallControlPlane
    || options.controlPlaneState
    || packageAnalysis.syscallControlPlane
    || packageAnalysis.controlPlaneState
    || {};
  const present = packet.format === "aios.mailchimp.syscall.controlPlane.v1"
    || Boolean(packet.controlPlaneId || packet.persistedState?.batchId);
  const persisted = packet.persistedState || {};
  const providerRowsByOperation = new Map(providerSync.rows.map((row) => [row.operationId, row]));
  const restartJournal = packageAnalysis.restartJournal
    || packageAnalysis.runtimeContract?.restartJournal
    || {};
  const restartJournalByOperation = new Map((restartJournal.rows || []).map((row) => [row.operationId, row]));
  const rows = operationOwnership.map((entry) => {
    const providerRow = providerRowsByOperation.get(entry.operationId) || {};
    const journalRow = restartJournalByOperation.get(entry.operationId) || {};
    const resume = entry.persistedState.resumeCommand || {};
    const restartSafe = entry.persistedState.restartSafe === true
      && (present ? persisted.restartSafe === true : true)
      && (journalRow.restartSafe !== false)
      && !["blocked", "operator-review"].includes(journalRow.status)
      && providerRow.status !== "metadata-incomplete";
    const blockedBy = [
      ...(providerRow.negotiable ? [] : [`provider-sync:${providerRow.status || "unknown"}`]),
      ...(entry.persistedState.clientRuntimeAdoption?.drift || []).map((drift) => `adoption:${drift}`),
      ...(!resume.requestId ? ["resume:requestId"] : []),
      ...(!resume.statusPath ? ["resume:statusPath"] : []),
      ...(present && persisted.restartSafe !== true ? ["control-plane:not-restart-safe"] : []),
      ...(journalRow.status === "blocked" ? [`restart-journal:${journalRow.nextAction || "blocked"}`] : []),
      ...(journalRow.status === "operator-review" ? ["restart-journal:operator-review"] : []),
      ...((journalRow.blockedBy || []).map((blocker) => `restart-journal:${blocker}`)),
    ].sort();
    const command = blockedBy.length
      ? "repair"
      : entry.capabilities.some((capability) => capability.leaseRequired)
        ? "persist-external-write-owner"
        : "persist-delegated-owner";

    return {
      operationId: entry.operationId,
      ownerId: entry.owner.id,
      command,
      status: blockedBy.length
        ? "blocked"
        : restartSafe
          ? "restart-safe"
          : "operator-review",
      requestId: resume.requestId || null,
      clientStatusPath: resume.statusPath || null,
      providerStatusPath: resume.providerStatusPath || null,
      controlPlaneId: packet.controlPlaneId || null,
      restartJournalId: restartJournal.journalId || persisted.restartJournalId || entry.persistedState.recoverySnapshot?.recoveryPath || null,
      restartJournalEntryId: journalRow.journalEntryId || null,
      restartJournalStatus: journalRow.status || "unknown",
      restartJournalSafe: journalRow.restartSafe === true,
      leaseCapabilities: resume.leaseCapabilities || [],
      blockedBy,
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("provider-sync:")
          ? providerRow.nextAction || "repair_provider_sync_metadata"
          : blockedBy[0].startsWith("adoption:")
            ? "repair_client_runtime_adoption_state"
            : blockedBy[0].startsWith("control-plane:")
              ? "repair_syscall_control_plane"
              : blockedBy[0].startsWith("restart-journal:")
                ? journalRow.nextAction || restartJournal.nextAction || "repair_restart_journal"
              : "repair_persisted_runtime_state"
        : command === "persist-external-write-owner"
          ? "persist_external_write_owner_checkpoint"
          : "persist_delegated_owner_checkpoint",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const restartSafeRows = rows.filter((row) => row.status === "restart-safe");
  const persistenceId = ownerKey([
    "ownership-control-persistence",
    packageAnalysis.package?.id,
    packet.controlPlaneId || "local",
    providerSync.syncKey,
    blockedRows.length,
  ]);

  return {
    format: "aios.mailchimp.ownership.controlPersistence.v1",
    persistenceId,
    provider: "mailchimp",
    packageId: packageAnalysis.package?.id || null,
    controlPlane: {
      present,
      controlPlaneId: packet.controlPlaneId || null,
      status: packet.status || "unknown",
      statusChannel: packet.statusChannel || "syscall.control.mailchimp",
      acceptedForRuntime: persisted.acceptedForRuntime === true,
      restartSafe: persisted.restartSafe === true,
    },
    restartJournal: {
      present: Boolean(restartJournal.journalId),
      journalId: restartJournal.journalId || null,
      status: restartJournal.status || "unknown",
      acceptedForRuntime: restartJournal.acceptedForRuntime === true,
      counters: restartJournal.counters || null,
      blockedOperationIds: restartJournal.blockedOperationIds || [],
      pendingOperationIds: restartJournal.pendingOperationIds || [],
      nextAction: restartJournal.nextAction || null,
    },
    status: blockedRows.length
      ? "blocked"
      : restartSafeRows.length === rows.length
        ? "restart-safe"
        : "operator-review",
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      restartSafe: restartSafeRows.length,
      externalWriteOwners: rows.filter((row) => row.command === "persist-external-write-owner").length,
      delegatedOwners: rows.filter((row) => row.command === "persist-delegated-owner").length,
      controlPlaneLinked: rows.filter((row) => row.controlPlaneId).length,
      restartJournalLinked: rows.filter((row) => row.restartJournalEntryId).length,
      restartJournalBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("restart-journal:"))).length,
    },
    commands: [
      {
        command: "persist-ownership-control-state",
        enabled: true,
        idempotencyKey: `ownership-control:${persistenceId}`,
      },
      {
        command: "repair-ownership-control-state",
        enabled: blockedRows.length > 0,
        idempotencyKey: `ownership-control-repair:${persistenceId}`,
      },
      {
        command: "publish-ownership-control-handoff",
        enabled: blockedRows.length === 0 && providerSync.externalHandoff.allowed === true,
        idempotencyKey: `ownership-control-handoff:${persistenceId}`,
      },
    ],
    nextAction: blockedRows[0]?.nextAction
      || (providerSync.externalHandoff.allowed
        ? "publish_ownership_control_handoff"
        : providerSync.externalHandoff.nextAction),
  };
}

function buildOwnershipExportSummary(packageAnalysis, operationOwnership, lifecycle, settings, providerSync) {
  const restartJournal = packageAnalysis.restartJournal
    || packageAnalysis.runtimeContract?.restartJournal
    || {};
  const restartJournalByOperation = new Map((restartJournal.rows || []).map((row) => [row.operationId, row]));
  return {
    format: "aios.mailchimp.ownership.report.v1",
    provider: "mailchimp",
    packageId: packageAnalysis.package?.id || null,
    status: lifecycle.status === "settings-blocked" || lifecycle.status === "blocked"
      ? "blocked"
      : "export-ready",
    lifecycle: {
      status: lifecycle.status,
      command: lifecycle.command,
      nextAction: lifecycle.nextAction,
      counters: lifecycle.counters,
    },
    providerSync: {
      syncKey: providerSync.syncKey,
      status: providerSync.status,
      nextAction: providerSync.externalHandoff.nextAction,
      counters: providerSync.counters,
    },
    restartJournal: {
      journalId: restartJournal.journalId || null,
      status: restartJournal.status || "unknown",
      acceptedForRuntime: restartJournal.acceptedForRuntime === true,
      counters: restartJournal.counters || null,
      nextAction: restartJournal.nextAction || null,
    },
    settings: {
      mode: settings.mode,
      enabled: settings.enabled,
      autoAcquireLeases: settings.autoAcquireLeases,
      allowServiceRelease: settings.allowServiceRelease,
      requireAuditBeforeRelease: settings.requireAuditBeforeRelease,
      allowedTransferRoles: settings.allowedTransferRoles,
      schedule: settings.schedule,
    },
    ownerRows: operationOwnership.map((entry) => ({
      operationId: entry.operationId,
      ownerId: entry.owner.id,
      ownerKind: entry.owner.kind,
      roles: entry.owner.roles,
      boundaryStatus: entry.boundary.status,
      auditStatus: entry.auditHandoff.status,
      gateStatus: entry.gate.status,
      persistedCommandId: entry.persistedState.commandId,
      restartStatus: entry.persistedState.status,
      restartJournalEntryId: restartJournalByOperation.get(entry.operationId)?.journalEntryId || null,
      restartJournalStatus: restartJournalByOperation.get(entry.operationId)?.status || "unknown",
      restartJournalSafe: restartJournalByOperation.get(entry.operationId)?.restartSafe === true,
      adoptionKey: entry.persistedState.clientRuntimeAdoption.adoptionKey,
      adoptionStatus: entry.persistedState.clientRuntimeAdoption.status,
      adoptionDrift: entry.persistedState.clientRuntimeAdoption.drift,
      leaseCapabilities: entry.persistedState.resumeCommand.leaseCapabilities,
      nextAction: entry.gate.nextAction,
    })),
    lifecycleRows: lifecycle.rows.map((row) => ({
      operationId: row.operationId,
      command: row.command,
      status: row.status,
      blockedReason: row.blockedReason,
      requestId: row.requestId,
      clientStatusPath: row.clientStatusPath,
      providerStatusPath: row.providerStatusPath,
      adoptionKey: row.adoptionKey,
      adoptionStatus: row.adoptionStatus,
      nextAction: row.nextAction,
    })),
    providerRows: providerSync.rows.map((row) => ({
      operationId: row.operationId,
      status: row.status,
      lifecycleStatus: row.lifecycleStatus,
      packageAcceptanceStatus: row.packageAcceptanceStatus,
      requestId: row.requestId,
      clientStatusPath: row.clientStatusPath,
      nextAction: row.nextAction,
    })),
  };
}

function buildPermissionBoundaryPacket(packageAnalysis, entry, providerRow) {
  const boundary = entry.boundary || {};
  const audit = entry.auditHandoff || {};
  const persisted = entry.persistedState || {};
  const adoption = persisted.clientRuntimeAdoption || {};
  const recoverySnapshot = persisted.recoverySnapshot || {};
  const resumeCommand = persisted.resumeCommand || {};
  const leaseCapabilities = providerRow.leaseCapabilities || [];
  const externalWrite = leaseCapabilities.length > 0;
  const requiredRoles = [...new Set([
    ...(boundary.allowedRoles || []),
    ...(externalWrite ? ["operator"] : []),
  ])].sort();
  const observedRoles = [...new Set(entry.owner?.roles || [])].sort();
  const missingRoles = requiredRoles
    .filter((role) => !observedRoles.includes(role))
    .sort();
  const scopeBlockedBy = [
    ...(boundary.checks?.tenantMatches === false ? ["tenant:scope-mismatch"] : []),
    ...(boundary.checks?.workspaceMatches === false ? ["workspace:scope-mismatch"] : []),
    ...(boundary.checks?.roleAllowed === false ? ["role:not-allowed"] : []),
    ...(boundary.checks?.contractReady === false ? ["boundary:contract-not-ready"] : []),
    ...(boundary.checks?.transferRestricted === false ? ["lease:transfer-restricted"] : []),
    ...(externalWrite && !resumeCommand.idempotencyKey ? ["request:idempotency-key-missing"] : []),
    ...(audit.required && audit.status === "boundary-blocked" ? ["audit:boundary-blocked"] : []),
    ...missingRoles.map((role) => `role:${role}:missing`),
    ...((adoption.drift || []).map((drift) => `adoption:${drift}`)),
  ].sort();
  const status = scopeBlockedBy.length
    ? "blocked"
    : externalWrite && audit.status === "lease-audit-required"
      ? "lease-audit-ready"
      : "accepted";
  const packetId = ownerKey([
    "permission-boundary",
    packageAnalysis.package?.id,
    entry.operationId,
    boundary.boundaryKey,
    audit.auditId,
    status,
  ]);
  const statusPatchPath = providerRow.clientStatusPath || resumeCommand.statusPath || recoverySnapshot.statusPath || null;
  const providerStatusPath = providerRow.providerStatusPath || resumeCommand.providerStatusPath || null;
  const statusPatchBlockedBy = [
    ...(!statusPatchPath ? ["status-path-missing"] : []),
    ...(externalWrite && !providerStatusPath ? ["provider-status-path-missing"] : []),
    ...(externalWrite && !resumeCommand.idempotencyKey ? ["idempotency-key-missing"] : []),
    ...(scopeBlockedBy.length ? ["permission-boundary-blocked"] : []),
    ...(persisted.restartSafe === false ? ["restart-not-safe"] : []),
  ].sort();
  const patchState = statusPatchBlockedBy.length
    ? "blocked"
    : externalWrite
      ? "lease_ready"
      : "delegated_ready";
  const statusPatch = {
    format: "aios.mailchimp.permissionBoundary.statusPatch.v1",
    patchId: ownerKey([
      "permission-status-patch",
      packageAnalysis.package?.id,
      entry.operationId,
      packetId,
      patchState,
    ]),
    patchable: statusPatchBlockedBy.length === 0,
    statusPath: statusPatchPath,
    providerStatusPath,
    state: patchState,
    visibleState: statusPatchBlockedBy.length
      ? "blocked"
      : externalWrite
        ? "waiting_for_provider_handoff"
        : "ready",
    blockedBy: statusPatchBlockedBy,
    fields: {
      provider: "mailchimp",
      operationId: entry.operationId,
      ownerId: entry.owner?.id || null,
      boundaryKey: boundary.boundaryKey || null,
      permissionPacketId: packetId,
      auditId: audit.auditId || null,
      requestId: resumeCommand.requestId || providerRow.requestId || null,
      idempotencyKeyPresent: Boolean(resumeCommand.idempotencyKey),
      restartSafe: persisted.restartSafe !== false && statusPatchBlockedBy.length === 0,
    },
    nextAction: statusPatchBlockedBy.length
      ? statusPatchBlockedBy[0] === "status-path-missing"
        ? "repair_client_status_path"
        : statusPatchBlockedBy[0] === "provider-status-path-missing"
          ? "repair_provider_status_path"
          : statusPatchBlockedBy[0] === "idempotency-key-missing"
            ? "repair_runtime_request_state"
            : statusPatchBlockedBy[0] === "restart-not-safe"
              ? "route_handoff_to_operator_review"
              : "repair_permission_boundary"
      : externalWrite
        ? "publish_external_write_permission_status"
        : "publish_delegated_permission_status",
  };
  const commands = [
    {
      command: "persist-permission-boundary-packet",
      enabled: true,
      idempotencyKey: `permission-boundary:${packetId}`,
      statusPath: statusPatch.statusPath,
    },
    {
      command: "publish-permission-boundary-status",
      enabled: statusPatch.patchable,
      idempotencyKey: `permission-boundary-status:${statusPatch.patchId}`,
      statusPath: statusPatch.statusPath,
      patch: statusPatch.patchable ? statusPatch.fields : null,
    },
    {
      command: externalWrite ? "release-permission-boundary-to-provider" : "delegate-permission-boundary-to-runtime",
      enabled: statusPatch.patchable && status !== "blocked",
      idempotencyKey: resumeCommand.idempotencyKey || `permission-boundary-release:${packetId}`,
      statusPath: statusPatch.statusPath,
    },
  ];

  return {
    format: "aios.mailchimp.permissionBoundaryPacket.v1",
    packetId,
    provider: "mailchimp",
    packageId: packageAnalysis.package?.id || null,
    operationId: entry.operationId,
    ownerId: entry.owner?.id || null,
    status,
    accepted: status !== "blocked",
    restartSafe: status !== "blocked" && persisted.restartSafe !== false,
    externalWrite,
    boundary: {
      boundaryKey: boundary.boundaryKey || null,
      tenant: boundary.requiredTenant || null,
      workspace: boundary.requiredWorkspace || null,
      environment: boundary.environment || null,
      status: boundary.status || "unknown",
      statusPath: boundary.handoffStatusPath || recoverySnapshot.boundaryStatusPath || null,
      observedTenant: boundary.observedTenant || null,
      observedWorkspace: boundary.observedWorkspace || null,
      requiredRoles,
      observedRoles,
      deniedRoles: boundary.deniedRoles || [],
      checks: boundary.checks || {},
    },
    audit: {
      auditId: audit.auditId || null,
      auditChannel: audit.auditChannel || boundary.auditChannel || null,
      status: audit.status || "unknown",
      required: audit.required === true,
      correlation: audit.correlation || {},
    },
    lease: {
      capabilities: leaseCapabilities,
      requiresLease: boundary.requiresLease === true || externalWrite,
      releaseStatus: entry.capabilities
        ?.filter((capability) => capability.leaseRequired)
        .map((capability) => capability.releaseStatus)
        .sort() || [],
    },
    statusPatch,
    commands,
    blockedBy: scopeBlockedBy,
    nextAction: scopeBlockedBy.length
      ? scopeBlockedBy[0].startsWith("tenant:")
        ? "repair_owner_tenant_scope"
        : scopeBlockedBy[0].startsWith("workspace:")
          ? "repair_owner_workspace_scope"
          : scopeBlockedBy[0].startsWith("role:")
            ? "assign_owner_with_required_role"
            : scopeBlockedBy[0].startsWith("audit:")
              ? "append_lease_audit_before_handoff"
              : entry.gate?.nextAction || "repair_permission_boundary"
      : externalWrite
        ? "handoff_external_write_with_permission_boundary"
        : "handoff_delegated_read_with_permission_boundary",
  };
}

function buildOwnershipProviderHandoffEnvelope(packageAnalysis, operationOwnership, lifecycle, providerSync, exportSummary) {
  const ownershipByOperation = new Map(operationOwnership.map((entry) => [entry.operationId, entry]));
  const rows = providerSync.rows.map((row) => {
    const entry = ownershipByOperation.get(row.operationId) || {};
    const resumeCommand = entry.persistedState?.resumeCommand || {};
    const recoverySnapshot = entry.persistedState?.recoverySnapshot || {};
    const leaseCapabilities = row.leaseCapabilities || [];
    const delegatedCapabilities = row.delegatedCapabilities || [];
    const permissionBoundary = buildPermissionBoundaryPacket(packageAnalysis, entry, row);
    const missingPayloadFields = [
      ...(!row.requestId ? ["requestId"] : []),
      ...(!row.clientStatusPath ? ["clientStatusPath"] : []),
      ...(leaseCapabilities.length && !row.auditId ? ["auditId"] : []),
      ...(leaseCapabilities.length && !resumeCommand.idempotencyKey ? ["idempotencyKey"] : []),
    ].sort();
    const blockedBy = [
      ...(!row.negotiable ? [`provider-sync:${row.status}`] : []),
      ...missingPayloadFields.map((field) => `payload:${field}`),
      ...((entry.persistedState?.clientRuntimeAdoption?.drift || []).map((drift) => `adoption:${drift}`)),
      ...permissionBoundary.blockedBy.map((blocker) => `permission:${blocker}`),
      ...(permissionBoundary.statusPatch?.patchable === false
        ? permissionBoundary.statusPatch.blockedBy.map((blocker) => `permission-status:${blocker}`)
        : []),
    ].sort();
    const payloadReady = blockedBy.length === 0;

    return {
      operationId: row.operationId,
      ownerId: row.ownerId,
      status: payloadReady
        ? leaseCapabilities.length
          ? "external-write-ready"
          : "delegated-read-ready"
        : "blocked",
      payloadReady,
      blockedBy,
      provider: row.provider,
      service: row.service,
      requestId: row.requestId || null,
      clientStatusPath: row.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || null,
      adoptionKey: row.adoptionKey || null,
      adoptionStatus: row.adoptionStatus || "unknown",
      boundaryKey: row.boundaryKey || entry.boundary?.boundaryKey || null,
      auditId: row.auditId || null,
      auditChannel: row.auditChannel || null,
      idempotencyKey: resumeCommand.idempotencyKey || null,
      replayToken: resumeCommand.replayToken || null,
      leaseCapabilities,
      delegatedCapabilities,
      memoryKeys: recoverySnapshot.memoryKeys || [],
      requiredRoles: row.requiredRoles || [],
      observedRoles: row.observedRoles || [],
      permissionBoundary,
      command: {
        command: leaseCapabilities.length
          ? "handoff_mailchimp_external_write_lease"
          : "handoff_mailchimp_delegated_read",
        enabled: payloadReady,
        idempotencyKey: resumeCommand.idempotencyKey
          || ownerKey(["handoff", packageAnalysis.package?.id, row.operationId, row.requestId]),
        statusPath: row.clientStatusPath || null,
      },
      payload: {
        provider: "mailchimp",
        service: "mailchimp-marketing",
        packageId: packageAnalysis.package?.id || null,
        operationId: row.operationId,
        ownerId: row.ownerId,
        requestId: row.requestId || null,
        clientStatusPath: row.clientStatusPath || null,
        providerStatusPath: row.providerStatusPath || null,
        auditId: row.auditId || null,
        auditChannel: row.auditChannel || null,
        boundaryKey: row.boundaryKey || entry.boundary?.boundaryKey || null,
        permissionBoundary,
        permissionStatusPatch: permissionBoundary.statusPatch,
        permissionCommands: permissionBoundary.commands,
        leaseCapabilities,
        delegatedCapabilities,
        memoryKeys: recoverySnapshot.memoryKeys || [],
        replayToken: resumeCommand.replayToken || null,
      },
      nextAction: payloadReady
        ? leaseCapabilities.length
          ? "handoff_external_write_lease_to_provider"
          : "handoff_delegated_read_to_provider"
        : missingPayloadFields.length
          ? "repair_provider_handoff_payload"
          : row.nextAction,
    };
  });
  const readyRows = rows.filter((row) => row.payloadReady);
  const blockedRows = rows.filter((row) => !row.payloadReady);
  const externalWriteRows = readyRows.filter((row) => row.leaseCapabilities.length > 0);
  const envelopeId = ownerKey([
    "provider-handoff-envelope",
    packageAnalysis.package?.id,
    providerSync.syncKey,
    lifecycle.status,
    readyRows.length,
    blockedRows.length,
  ]);

  return {
    format: "aios.mailchimp.ownership.providerHandoffEnvelope.v1",
    provider: "mailchimp",
    service: "mailchimp-marketing",
    envelopeId,
    packageId: packageAnalysis.package?.id || null,
    syncKey: providerSync.syncKey,
    status: blockedRows.length
      ? "blocked"
      : externalWriteRows.length
        ? "external-write-ready"
        : readyRows.length
          ? "delegated-read-ready"
          : "waiting",
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      externalWriteReady: externalWriteRows.length,
      delegatedReadReady: readyRows.filter((row) => row.delegatedCapabilities.length > 0).length,
      missingPayloadFields: rows.reduce((count, row) => count + row.blockedBy.filter((item) => item.startsWith("payload:")).length, 0),
      permissionStatusPatchable: rows.filter((row) => row.permissionBoundary.statusPatch?.patchable === true).length,
      permissionStatusBlocked: rows.filter((row) => row.permissionBoundary.statusPatch?.patchable === false).length,
    },
    commands: rows.map((row) => row.command),
    exportReady: blockedRows.length === 0 && exportSummary.status === "export-ready",
    nextAction: blockedRows[0]?.nextAction
      || (externalWriteRows.length
        ? "handoff_external_write_leases_to_provider"
        : readyRows.length
          ? "handoff_delegated_reads_to_provider"
          : lifecycle.nextAction),
  };
}

export function analyzeMailchimpOwnership(source = {}, options = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : analyzeMailchimpPackage(source, options);
  const lifecycleSettings = normalizeOwnershipLifecycleSettings(options.ownershipSettings || options.settings || {}, options);
  const ownerOverrides = options.owners || {};
  const operationOwnership = packageAnalysis.operations.map((operation) => {
    const owner = normalizeOwner(ownerOverrides[operation.id] || operation.owner, {
      ...defaultOwnerForOperation(packageAnalysis, operation),
      tenant: options.tenant,
      workspace: options.workspace,
    });
    const capabilities = buildCapabilityOwnership(packageAnalysis, operation, owner);
    const memory = buildMemoryOwnership(packageAnalysis, operation, owner);
    const boundary = buildTenantBoundary(packageAnalysis, operation, owner, options);
    const auditHandoff = buildAuditHandoff(packageAnalysis, operation, owner, capabilities, memory, boundary);
    const persistedState = normalizePersistedCommandState(packageAnalysis, operation, owner, capabilities, memory);
    return {
      operationId: operation.id,
      descriptorId: operation.descriptorId,
      owner,
      boundary,
      auditHandoff,
      capabilities,
      memory,
      persistedState,
      packageLifecycle: operation.lifecycleVisibility || null,
      gate: buildOwnershipGate(packageAnalysis, operation, owner, capabilities, memory, boundary, auditHandoff),
    };
  });
  const lifecycle = buildOwnershipLifecycleState(packageAnalysis, operationOwnership, lifecycleSettings);
  const providerSync = buildOwnershipProviderSync(packageAnalysis, operationOwnership, lifecycle);
  const controlPersistence = buildOwnershipControlPersistence(
    packageAnalysis,
    operationOwnership,
    lifecycle,
    providerSync,
    options,
  );
  const exportSummary = buildOwnershipExportSummary(packageAnalysis, operationOwnership, lifecycle, lifecycleSettings, providerSync);
  const providerHandoffEnvelope = buildOwnershipProviderHandoffEnvelope(
    packageAnalysis,
    operationOwnership,
    lifecycle,
    providerSync,
    exportSummary,
  );
  const diagnostics = operationOwnership.flatMap((entry) => (
    [
      ...(entry.gate.status === "blocked"
        ? [{
        severity: "error",
        code: "ownership.operation.blocked",
        message: `Operation ${entry.operationId} has an invalid ownership gate.`,
        field: `operations.${entry.operationId}.ownership`,
      }]
        : []),
      ...(entry.persistedState.status === "operator-review-required"
        ? [{
          severity: "warning",
          code: "ownership.operation.recovery_review_required",
          message: `Operation ${entry.operationId} cannot be resumed automatically from persisted Mailchimp state.`,
          field: `operations.${entry.operationId}.persistedState`,
        }]
        : []),
      ...(entry.persistedState.clientRuntimeAdoption?.drift?.length
        ? [{
          severity: entry.persistedState.status === "operator-review-required" ? "error" : "warning",
          code: "ownership.operation.client_adoption_drift",
          message: `Operation ${entry.operationId} persisted ownership state does not match the client runtime adoption envelope.`,
          field: `operations.${entry.operationId}.clientRuntimeAdoption`,
          operationId: entry.operationId,
          action: entry.persistedState.nextAction,
          drift: entry.persistedState.clientRuntimeAdoption.drift,
        }]
        : []),
      ...(entry.boundary.status !== "isolated"
        ? [{
          severity: "error",
          code: "ownership.operation.boundary_blocked",
          message: `Operation ${entry.operationId} owner is outside the Mailchimp tenant/workspace boundary.`,
          field: `operations.${entry.operationId}.owner`,
        }]
        : []),
      ...(entry.gate.controls.ownerCanLeaseExternalWrite === false && entry.capabilities.some((capability) => capability.leaseRequired)
        ? [{
          severity: "error",
          code: "ownership.operation.owner_role_missing",
          message: `Operation ${entry.operationId} requires an operator or admin owner for Mailchimp external write lease.`,
          field: `operations.${entry.operationId}.owner.roles`,
        }]
        : []),
    ]
  )).concat(
    lifecycleSettings.validation,
    lifecycle.rows
      .filter((row) => row.blockedReason && row.blockedReason !== "gate-blocked")
      .map((row) => ({
        severity: row.blockedReason === "audit-required" ? "warning" : "error",
        code: `ownership.lifecycle.${row.blockedReason}`,
        message: `Operation ${row.operationId} ownership lifecycle is blocked by ${row.blockedReason}.`,
        field: `operations.${row.operationId}.ownership.lifecycle`,
        operationId: row.operationId,
        action: row.nextAction,
      })),
    providerSync.rows
      .filter((row) => row.status === "metadata-incomplete" || row.status.startsWith("lifecycle-"))
      .map((row) => ({
        severity: row.status === "metadata-incomplete" ? "error" : "warning",
        code: `ownership.provider.${row.status}`,
        message: `Operation ${row.operationId} provider sync is blocked by ${row.status}.`,
        field: `operations.${row.operationId}.providerSync`,
        operationId: row.operationId,
        action: row.nextAction,
      })),
    providerHandoffEnvelope.rows
      .filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("payload:")))
      .map((row) => ({
        severity: "error",
        code: "ownership.provider_handoff.payload_incomplete",
        message: `Operation ${row.operationId} provider handoff payload is missing required runtime metadata.`,
        field: `operations.${row.operationId}.providerHandoffEnvelope`,
        operationId: row.operationId,
        action: row.nextAction,
        blockedBy: row.blockedBy,
      })),
    providerHandoffEnvelope.rows
      .filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("permission-status:")))
      .map((row) => ({
        severity: "error",
        code: "ownership.provider_handoff.permission_status_patch_blocked",
        message: `Operation ${row.operationId} cannot publish a restart-safe Mailchimp permission status patch.`,
        field: `operations.${row.operationId}.providerHandoffEnvelope.permissionBoundary.statusPatch`,
        operationId: row.operationId,
        action: row.permissionBoundary.statusPatch?.nextAction || row.nextAction,
        blockedBy: row.blockedBy.filter((blocker) => blocker.startsWith("permission-status:")),
      })),
    controlPersistence.rows
      .filter((row) => row.status === "blocked")
      .map((row) => ({
        severity: "error",
        code: "ownership.control_persistence.blocked",
        message: `Operation ${row.operationId} ownership control persistence is blocked before restart-safe Mailchimp handoff.`,
        field: `operations.${row.operationId}.ownership.controlPersistence`,
        operationId: row.operationId,
        action: row.nextAction,
        blockedBy: row.blockedBy,
      })),
  );
  const leaseCount = operationOwnership
    .flatMap((entry) => entry.capabilities)
    .filter((capability) => capability.leaseRequired).length;
  const resumeReadyCount = operationOwnership.filter((entry) => entry.persistedState.status === "resume-ready").length;
  const isolatedCount = operationOwnership.filter((entry) => entry.boundary.status === "isolated").length;

  return {
    kind: "aios.semantic.ownershipAnalysis",
    provider: "mailchimp",
    package: packageAnalysis.package,
    owners: operationOwnership,
    summary: {
      ownerCount: new Set(operationOwnership.map((entry) => entry.owner.id)).size,
      operationCount: operationOwnership.length,
      leaseCount,
      resumeReadyCount,
      operatorReviewRecoveryCount: operationOwnership.length - resumeReadyCount,
      adoptionReadyCount: operationOwnership.filter((entry) => entry.persistedState.clientRuntimeAdoption?.acceptedForClient).length,
      adoptionDriftCount: operationOwnership.filter((entry) => entry.persistedState.clientRuntimeAdoption?.drift?.length).length,
      tenantIsolatedOperationCount: isolatedCount,
      auditRequiredCount: operationOwnership.filter((entry) => entry.auditHandoff.required).length,
      auditBlockedCount: operationOwnership.filter((entry) => entry.auditHandoff.status === "boundary-blocked").length,
      lifecycleStatus: lifecycle.status,
      lifecycleCommand: lifecycle.command,
      providerSyncStatus: providerSync.status,
      controlPersistenceStatus: controlPersistence.status,
      restartJournalStatus: controlPersistence.restartJournal.status,
      providerHandoffStatus: providerHandoffEnvelope.status,
      exportStatus: exportSummary.status,
      status: diagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? "blocked"
        : providerSync.status === "blocked"
          ? "blocked"
        : leaseCount > 0
          ? "lease-required"
          : "ready",
      nextAction: diagnostics.some((diagnostic) => diagnostic.code === "ownership.settings.mode_invalid")
        ? "repair_ownership_settings"
        : lifecycle.nextAction || (leaseCount > 0 ? "acquire_required_leases" : packageAnalysis.summary?.nextAction || "handoff_to_runtime_adapter"),
      persistedCommandIds: operationOwnership.map((entry) => entry.persistedState.commandId).sort(),
      clientRuntimeAdoptionKeys: operationOwnership
        .map((entry) => entry.persistedState.clientRuntimeAdoption?.adoptionKey)
        .filter(Boolean)
        .sort(),
      providerHandoffEnvelopeId: providerHandoffEnvelope.envelopeId,
      permissionStatusPatchableCount: providerHandoffEnvelope.counters.permissionStatusPatchable,
      permissionStatusBlockedCount: providerHandoffEnvelope.counters.permissionStatusBlocked,
      ownershipControlPersistenceId: controlPersistence.persistenceId,
      restartJournalId: controlPersistence.restartJournal.journalId,
    },
    lifecycle,
    providerSync,
    controlPersistence,
    providerHandoffEnvelope,
    packageAcceptance: packageAnalysis.acceptancePreview || null,
    settings: {
      mode: lifecycleSettings.mode,
      enabled: lifecycleSettings.enabled,
      autoAcquireLeases: lifecycleSettings.autoAcquireLeases,
      allowServiceRelease: lifecycleSettings.allowServiceRelease,
      requireAuditBeforeRelease: lifecycleSettings.requireAuditBeforeRelease,
      allowedTransferRoles: lifecycleSettings.allowedTransferRoles,
      disabledOperations: lifecycleSettings.disabledOperations,
      enabledOperations: lifecycleSettings.enabledOperations,
      schedule: lifecycleSettings.schedule,
      validation: lifecycleSettings.validation,
    },
    exportSummary,
    diagnostics,
  };
}

export function findMailchimpOwnershipForOperation(ownershipAnalysis, operationId) {
  return (ownershipAnalysis?.owners || []).find((entry) => entry.operationId === operationId) || null;
}

export default analyzeMailchimpOwnership;
