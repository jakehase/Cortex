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

function buildBoundaryEvidenceReview(operation, owner, boundary) {
  const packet = operation.boundaryEvidencePacket || {};
  const packetScope = packet.scope || {};
  const packetRoles = packet.roles || {};
  const statusPatch = packet.statusPatch || {};
  const missingFields = Array.isArray(packet.missingFields) ? packet.missingFields : [];
  const requiredFields = Array.isArray(packet.requiredFields) ? packet.requiredFields : [];
  const tenantMatches = !packetScope.tenant || packetScope.tenant === boundary.requiredTenant;
  const workspaceMatches = !packetScope.workspace || packetScope.workspace === boundary.requiredWorkspace;
  const boundaryKeyMatches = !packet.boundaryKey || packet.boundaryKey === boundary.boundaryKey;
  const ownerRoleAccepted = owner.roles.some((role) => (packetRoles.allowed || boundary.allowedRoles).includes(role))
    && !owner.roles.some((role) => (packetRoles.denied || boundary.deniedRoles).includes(role));
  const patchReady = statusPatch.fields
    && statusPatch.state === "boundary-evidence-ready"
    && missingFields.length === 0;
  const drift = [
    ...(!packet.packetId ? ["boundary_evidence_packet_missing"] : []),
    ...(!packet.acceptedForBoundary ? ["boundary_evidence_not_accepted"] : []),
    ...(!tenantMatches ? ["boundary_evidence_tenant_drift"] : []),
    ...(!workspaceMatches ? ["boundary_evidence_workspace_drift"] : []),
    ...(!boundaryKeyMatches ? ["boundary_evidence_key_drift"] : []),
    ...(!ownerRoleAccepted ? ["boundary_evidence_owner_role_not_allowed"] : []),
    ...(!patchReady ? ["boundary_evidence_status_patch_not_ready"] : []),
    ...missingFields.map((field) => `boundary_evidence_missing_${field}`),
  ];

  return {
    packetId: packet.packetId || null,
    operationId: operation.id,
    status: drift.length ? "review-required" : "accepted",
    acceptedForOwnership: drift.length === 0,
    requiredFields,
    missingFields,
    drift,
    scope: {
      tenant: packetScope.tenant || null,
      workspace: packetScope.workspace || null,
      environment: packetScope.environment || boundary.environment,
    },
    boundaryKey: packet.boundaryKey || null,
    owner: {
      ownerId: owner.id,
      roles: owner.roles,
      roleAccepted: ownerRoleAccepted,
    },
    statusPatch: {
      patchId: statusPatch.patchId || null,
      statusPath: statusPatch.statusPath || null,
      patchable: patchReady,
      state: statusPatch.state || "unknown",
      blockedBy: statusPatch.blockedBy || missingFields,
      nextAction: statusPatch.nextAction || null,
    },
    nextAction: drift.length
      ? drift.includes("boundary_evidence_packet_missing")
        ? "compile_boundary_evidence_packet"
        : drift.includes("boundary_evidence_owner_role_not_allowed")
          ? "assign_owner_with_boundary_evidence_role"
          : drift.some((item) => item.includes("_drift"))
            ? "refresh_boundary_evidence_packet"
            : statusPatch.nextAction || "publish_boundary_evidence_status"
      : "attach_boundary_evidence_to_ownership_handoff",
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

function clientHandoffReadinessForOperation(packageAnalysis = {}, operation = {}) {
  const plan = packageAnalysis.clientHandoffReadiness
    || packageAnalysis.runtimeContract?.clientHandoffReadiness
    || {};
  const row = (plan.rows || []).find((entry) => entry.operationId === operation.id) || {};
  const statusPatch = row.statusPatch || {};
  const runtimeCommand = row.runtimeCommand || {};
  const commandEnabled = runtimeCommand.enabled === true
    || (row.commands || []).some((command) => (
      ["publish-handoff", "present-approval"].includes(command.command)
      && command.enabled !== false
    ));
  const statusPathMatches = !row.clientStatusPath
    || !operation.runtimeClientState?.client?.statusPath
    || row.clientStatusPath === operation.runtimeClientState.client.statusPath;
  const providerStatusPathMatches = !row.providerStatusPath
    || !operation.clientRuntimeAdoption?.client?.providerStatusPath
    || row.providerStatusPath === operation.clientRuntimeAdoption.client.providerStatusPath;
  const requestMatches = !row.requestId
    || !operation.runtimeClientState?.request?.requestId
    || row.requestId === operation.runtimeClientState.request.requestId;
  const patchable = statusPatch.patchable === true
    || (statusPatch.statusPath && (row.blockedBy || []).length === 0);
  const accepted = row.acceptedForClient === true
    && ["approval-ready", "handoff-ready"].includes(row.status)
    && requestMatches
    && statusPathMatches
    && providerStatusPathMatches
    && patchable
    && commandEnabled;
  const drift = [
    ...(!plan.planKey ? ["client_handoff_plan_missing"] : []),
    ...(!row.handoffId ? ["client_handoff_row_missing"] : []),
    ...(row.status === "blocked" ? (row.blockedBy || ["blocked"]).map((item) => `client_handoff_blocked_${item}`) : []),
    ...(row.status === "pending" ? (row.pendingBy || ["pending"]).map((item) => `client_handoff_pending_${item}`) : []),
    ...(!requestMatches ? ["client_handoff_request_changed"] : []),
    ...(!statusPathMatches ? ["client_handoff_status_path_changed"] : []),
    ...(!providerStatusPathMatches ? ["client_handoff_provider_status_path_changed"] : []),
    ...(!patchable ? ["client_handoff_status_patch_not_patchable"] : []),
    ...(!commandEnabled ? ["client_handoff_command_not_enabled"] : []),
  ];

  return {
    planKey: plan.planKey || null,
    handoffId: row.handoffId || null,
    status: row.status || (plan.planKey ? "missing-row" : "not-provided"),
    acceptedForOwnershipResume: accepted,
    commandEnabled,
    drift,
    requestId: row.requestId || null,
    clientStatusPath: row.clientStatusPath || null,
    providerStatusPath: row.providerStatusPath || null,
    boundaryStatusPath: row.boundaryStatusPath || null,
    blockedBy: row.blockedBy || [],
    pendingBy: row.pendingBy || [],
    statusPatch: {
      patchId: statusPatch.patchId || null,
      patchable,
      statusPath: statusPatch.statusPath || row.clientStatusPath || null,
      providerStatusPath: statusPatch.providerStatusPath || row.providerStatusPath || null,
      state: statusPatch.state || row.status || "unknown",
      visibleState: statusPatch.visibleState || row.visibleState || null,
      blockedBy: statusPatch.blockedBy || row.blockedBy || [],
      pendingBy: statusPatch.pendingBy || row.pendingBy || [],
      nextAction: statusPatch.nextAction || null,
    },
    runtimeCommand: {
      commandId: runtimeCommand.commandId || null,
      command: runtimeCommand.command || (row.commands || []).find((command) => command.enabled !== false)?.command || null,
      enabled: commandEnabled,
      idempotent: runtimeCommand.idempotent === true || Boolean(runtimeCommand.dedupeKey),
      dedupeKey: runtimeCommand.dedupeKey || null,
      statusPatchId: runtimeCommand.statusPatchId || statusPatch.patchId || null,
      nextAction: runtimeCommand.nextAction || row.nextAction || plan.nextAction || null,
    },
    nextAction: row.nextAction || plan.nextAction || "compile_client_handoff_readiness",
  };
}

function normalizePersistedCommandState(packageAnalysis, operation, owner, capabilityOwnership, memoryOwnership, handoffReadiness = null) {
  const request = operation.runtimeClientState?.request || {};
  const client = operation.runtimeClientState?.client || {};
  const handoffPayload = operation.runtimeClientState?.handoffPayload || {};
  const packagePersistedState = operation.persistedState || {};
  const adoption = operation.clientRuntimeAdoption || {};
  const receipt = operation.clientHandoffReceipt || {};
  const observedReceipt = adoption.receipt || adoption.clientHandoffReceipt || {};
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
  const receiptExpectedId = compactString(receipt.receiptId);
  const receiptObservedId = compactString(observedReceipt.receiptId || observedReceipt.id);
  const receiptAccepted = receipt.acceptedForHandoff === true
    && receipt.state !== "receipt-incomplete"
    && (receipt.missingFields || []).length === 0;
  const receiptMatches = !receiptExpectedId || !receiptObservedId || receiptExpectedId === receiptObservedId;
  const receiptStatusPathMatches = !observedReceipt.clientStatusPath
    || !receipt.client?.statusPath
    || observedReceipt.clientStatusPath === receipt.client.statusPath;
  const receiptProviderPathMatches = !observedReceipt.providerStatusPath
    || !receipt.client?.providerStatusPath
    || observedReceipt.providerStatusPath === receipt.client.providerStatusPath;
  const receiptReplaySafe = receipt.persisted?.replaySafe !== false;
  const clientHandoffReadiness = handoffReadiness || clientHandoffReadinessForOperation(packageAnalysis, operation);
  const clientHandoffResumeReady = clientHandoffReadiness.acceptedForOwnershipResume === true;
  const resumeAllowed = operation.restartSafe
    && memoryOwnership.every((item) => item.restartSafe !== false)
    && adoptionReplaySafe
    && adoptionBoundaryMatches
    && receiptAccepted
    && receiptMatches
    && receiptStatusPathMatches
    && receiptProviderPathMatches
    && receiptReplaySafe
    && clientHandoffResumeReady
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
    ...(!receiptAccepted ? ["client_handoff_receipt_not_accepted"] : []),
    ...(!receiptMatches ? ["client_handoff_receipt_id_changed"] : []),
    ...(!receiptStatusPathMatches ? ["client_handoff_receipt_status_path_changed"] : []),
    ...(!receiptProviderPathMatches ? ["client_handoff_receipt_provider_status_path_changed"] : []),
    ...(!receiptReplaySafe ? ["client_handoff_receipt_replay_not_safe"] : []),
    ...(clientHandoffReadiness.drift || []),
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
      receiptId: receiptExpectedId || null,
      receiptState: receipt.state || "unknown",
      receiptObservedId: receiptObservedId || null,
      receiptAccepted,
      receiptMatches,
      handoffPlanKey: clientHandoffReadiness.planKey,
      handoffId: clientHandoffReadiness.handoffId,
      handoffStatus: clientHandoffReadiness.status,
      handoffAcceptedForResume: clientHandoffResumeReady,
      handoffStatusPatchId: clientHandoffReadiness.statusPatch.patchId,
      handoffStatusPatchable: clientHandoffReadiness.statusPatch.patchable,
      handoffCommandId: clientHandoffReadiness.runtimeCommand.commandId,
      handoffCommandEnabled: clientHandoffReadiness.runtimeCommand.enabled,
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
      receiptId: receiptExpectedId || null,
      receiptState: receipt.state || "unknown",
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
      clientHandoffReadiness: {
        planKey: clientHandoffReadiness.planKey,
        handoffId: clientHandoffReadiness.handoffId,
        status: clientHandoffReadiness.status,
        acceptedForOwnershipResume: clientHandoffResumeReady,
        statusPatch: clientHandoffReadiness.statusPatch,
        runtimeCommand: clientHandoffReadiness.runtimeCommand,
        nextAction: clientHandoffReadiness.nextAction,
      },
    },
  };
}

function buildOwnershipGate(packageAnalysis, operation, owner, capabilityOwnership, memoryOwnership, boundary, auditHandoff) {
  const missingLease = capabilityOwnership.filter((item) => item.leaseRequired && !item.ownerId);
  const unsafeMemory = memoryOwnership.filter((item) => item.restartSafe === false && item.access === "read-write");
  const missingRuntimeRequest = operation.externalWrite && !operation.runtimeClientState?.request?.idempotencyKey;
  const boundaryBlocked = boundary.status !== "isolated";
  const roleBlocked = operation.externalWrite && !owner.permissions.canLeaseExternalWrite;
  const receiptBlocked = operation.clientHandoffReceipt?.acceptedForHandoff !== true
    || (operation.clientHandoffReceipt?.missingFields || []).length > 0;
  const blocked = missingLease.length > 0 || unsafeMemory.length > 0 || missingRuntimeRequest || boundaryBlocked || roleBlocked || receiptBlocked;

  return {
    operationId: operation.id,
    ownerId: owner.id,
    status: blocked ? "blocked" : operation.externalWrite ? "lease-required" : "ready",
    nextAction: blocked
      ? missingRuntimeRequest
        ? "repair_runtime_request_state"
        : receiptBlocked
          ? operation.clientHandoffReceipt?.nextAction || "repair_client_handoff_receipt_metadata"
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
      receiptId: operation.clientHandoffReceipt?.receiptId || null,
      receiptState: operation.clientHandoffReceipt?.state || "unknown",
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

function buildTenantPermissionOwnershipHealth(packageAnalysis, operation, owner, boundary, gate) {
  const matrix = packageAnalysis.tenantPermissionEnforcementMatrix
    || packageAnalysis.runtimeContract?.tenantPermissionEnforcementMatrix
    || {};
  const row = (matrix.rows || []).find((entry) => entry.operationId === operation.id) || {};
  const releaseLedger = matrix.releaseLedger || {};
  const releaseRow = row.release
    || (releaseLedger.rows || []).find((entry) => entry.operationId === operation.id)
    || {};
  const ownerMissingRoles = (row.roles?.required || boundary.allowedRoles || [])
    .filter((role) => !owner.roles.includes(role))
    .sort();
  const scopeMismatch = [
    ...(row.scope?.tenant && owner.tenant !== row.scope.tenant ? ["tenant"] : []),
    ...(row.scope?.workspace && owner.workspace !== row.scope.workspace ? ["workspace"] : []),
  ];
  const blockedBy = [
    ...(row.status === "blocked" ? (row.blockedBy || ["matrix:blocked"]).map((blocker) => `matrix:${blocker}`) : []),
    ...ownerMissingRoles.map((role) => `owner-role:${role}`),
    ...scopeMismatch.map((scope) => `owner-scope:${scope}`),
    ...(gate.status === "blocked" ? ["ownership-gate:blocked"] : []),
    ...(releaseRow.status === "blocked"
      ? (releaseRow.blockedBy || ["blocked"]).map((blocker) => `release:${blocker}`)
      : []),
    ...(row.statusPatch?.patchable === false ? (row.statusPatch.blockedBy || ["patch"]).map((blocker) => `matrix-status:${blocker}`) : []),
  ].sort();
  const pendingBy = [
    ...(row.status === "pending" ? (row.pendingBy || ["matrix:pending"]).map((pending) => `matrix:${pending}`) : []),
    ...(releaseRow.status === "pending"
      ? (releaseRow.pendingBy || ["pending"]).map((pending) => `release:${pending}`)
      : []),
    ...(row.acceptedForHandoff === true && row.statusPatch?.patchable === true && !(row.commands || []).some((command) => (
      command.command === "publish-tenant-permission-enforcement" && command.enabled === true
    )) ? ["matrix-status:publish-pending"] : []),
  ].sort();
  const failureState = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : row.status === "external-write-enforced" || row.status === "delegated-read-enforced"
        ? "clear"
        : row.enforcementId
          ? "degraded"
          : "not-provided";

  return {
    format: "aios.mailchimp.ownership.tenantPermissionHealth.v1",
    operationId: operation.id,
    matrixKey: matrix.matrixKey || null,
    enforcementId: row.enforcementId || null,
    status: failureState,
    acceptedForOwnership: failureState === "clear" && row.acceptedForHandoff !== false,
    ownerId: owner.id,
    boundaryKey: row.boundaryKey || boundary.boundaryKey || null,
    releaseLedgerKey: releaseLedger.ledgerKey || null,
    requiredTenant: row.scope?.tenant || boundary.requiredTenant || null,
    requiredWorkspace: row.scope?.workspace || boundary.requiredWorkspace || null,
    observedTenant: owner.tenant,
    observedWorkspace: owner.workspace,
    requiredRoles: row.roles?.required || boundary.allowedRoles || [],
    observedRoles: owner.roles,
    ownerMissingRoles,
    blockedBy,
    pendingBy,
    statusPatch: {
      patchId: row.statusPatch?.patchId || null,
      patchable: row.statusPatch?.patchable === true && blockedBy.length === 0,
      statusPath: row.statusPatch?.statusPath || operation.runtimeClientState?.client?.statusPath || null,
      providerStatusPath: row.statusPatch?.providerStatusPath || null,
      state: row.statusPatch?.state || row.status || "unknown",
      nextAction: row.statusPatch?.nextAction || null,
    },
    release: {
      releaseId: releaseRow.releaseId || null,
      status: releaseRow.status || (releaseLedger.ledgerKey ? "missing-row" : "not-provided"),
      ready: releaseRow.ready === true && blockedBy.every((blocker) => !blocker.startsWith("release:")),
      mode: releaseRow.mode || (operation.externalWrite ? "external-write-lease" : "delegated-read"),
      requestId: releaseRow.requestId || operation.runtimeClientState?.request?.requestId || null,
      clientStatusPath: releaseRow.clientStatusPath || operation.runtimeClientState?.client?.statusPath || null,
      providerStatusPath: releaseRow.providerStatusPath || null,
      blockedBy: releaseRow.blockedBy || [],
      pendingBy: releaseRow.pendingBy || [],
      nextAction: releaseRow.nextAction || null,
    },
    nextAction: blockedBy.length
      ? blockedBy[0].startsWith("owner-role:")
        ? "assign_owner_with_required_permission_role"
        : blockedBy[0].startsWith("owner-scope:")
          ? "repair_owner_tenant_workspace_scope"
          : blockedBy[0].startsWith("release:")
            ? releaseRow.nextAction || "repair_tenant_permission_release"
          : row.nextAction || gate.nextAction || "repair_tenant_permission_enforcement"
      : pendingBy.length
        ? pendingBy[0].startsWith("matrix-status:")
          ? "publish_tenant_permission_enforcement_status"
          : pendingBy[0].startsWith("release:")
            ? releaseRow.nextAction || "publish_tenant_permission_release_status"
          : row.nextAction || "wait_for_tenant_permission_enforcement"
        : failureState === "not-provided"
          ? "compile_tenant_permission_enforcement_matrix"
          : gate.nextAction,
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

function buildTenantBoundaryActionOwnershipState(packageAnalysis, operation, owner, boundary, tenantPermissionHealth) {
  const queue = packageAnalysis.tenantBoundaryActionQueue
    || packageAnalysis.runtimeContract?.tenantBoundaryActionQueue
    || {};
  const row = (queue.rows || []).find((entry) => entry.operationId === operation.id) || {};
  const ownerMissingRoles = (row.roles?.allowed || boundary.allowedRoles || [])
    .filter((role) => !owner.roles.includes(role))
    .sort();
  const scopeMismatch = [
    ...(row.scope?.tenant && owner.tenant !== row.scope.tenant ? ["tenant"] : []),
    ...(row.scope?.workspace && owner.workspace !== row.scope.workspace ? ["workspace"] : []),
  ];
  const blockedBy = [
    ...(row.blockedBy || []).map((blocker) => `queue:${blocker}`),
    ...ownerMissingRoles.map((role) => `owner-role:${role}`),
    ...scopeMismatch.map((scope) => `owner-scope:${scope}`),
    ...(tenantPermissionHealth.status === "blocked" ? (tenantPermissionHealth.blockedBy || ["tenant-permission"]).map((blocker) => `health:${blocker}`) : []),
    ...(row.statusPatch?.patchable === false ? (row.statusPatch.blockedBy || ["status-patch"]).map((blocker) => `status:${blocker}`) : []),
  ].sort();
  const pendingBy = [
    ...(row.pendingBy || []).map((pending) => `queue:${pending}`),
    ...(tenantPermissionHealth.status === "pending" ? (tenantPermissionHealth.pendingBy || ["tenant-permission"]).map((pending) => `health:${pending}`) : []),
  ].sort();
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : row.acceptedForRuntime === true && tenantPermissionHealth.acceptedForOwnership === true
        ? "ready"
        : row.queueId
          ? "degraded"
          : "not-provided";
  const retryable = status === "pending"
    || (status === "degraded" && row.statusPatch?.patchable === true)
    || blockedBy.every((blocker) => (
      blocker.startsWith("queue:evidence-status:")
      || blocker.startsWith("queue:enforcement-status:")
      || blocker.startsWith("status:")
    ));

  return {
    format: "aios.mailchimp.ownership.tenantBoundaryActionHealth.v1",
    queueKey: queue.queueKey || null,
    queueId: row.queueId || null,
    operationId: operation.id,
    ownerId: owner.id,
    boundaryKey: row.boundaryKey || boundary.boundaryKey || null,
    status,
    acceptedForOwnership: status === "ready",
    retryable,
    action: row.action || "observe",
    requestId: row.requestId || operation.runtimeClientState?.request?.requestId || null,
    clientStatusPath: row.clientStatusPath || operation.runtimeClientState?.client?.statusPath || null,
    providerStatusPath: row.providerStatusPath || null,
    scope: {
      requiredTenant: row.scope?.tenant || boundary.requiredTenant || null,
      requiredWorkspace: row.scope?.workspace || boundary.requiredWorkspace || null,
      observedTenant: owner.tenant,
      observedWorkspace: owner.workspace,
      mismatch: scopeMismatch,
    },
    roles: {
      required: row.roles?.allowed || boundary.allowedRoles || [],
      observed: owner.roles,
      missing: ownerMissingRoles,
      denied: row.roles?.denied || boundary.deniedRoles || [],
    },
    audit: {
      required: row.audit?.required === true || boundary.requiresAuditCorrelation === true,
      channel: row.audit?.channel || boundary.auditChannel || null,
      correlationIdPresent: row.audit?.correlationIdPresent === true,
    },
    blockedBy,
    pendingBy,
    evidence: row.evidence || null,
    enforcement: row.enforcement || null,
    release: row.release || null,
    command: (row.commands || []).find((command) => command.enabled === true) || null,
    statusPatch: {
      patchId: row.statusPatch?.patchId || null,
      patchable: row.statusPatch?.patchable === true && blockedBy.length === 0,
      statusPath: row.statusPatch?.statusPath || row.clientStatusPath || null,
      providerStatusPath: row.statusPatch?.providerStatusPath || row.providerStatusPath || null,
      state: row.statusPatch?.state || row.status || "unknown",
      nextAction: row.statusPatch?.nextAction || null,
    },
    actionableError: status === "ready"
      ? null
      : {
        code: status === "not-provided"
          ? "ownership.tenant_boundary_action_queue_missing"
          : blockedBy[0] || pendingBy[0] || "tenant-boundary-action",
        severity: status === "blocked" || status === "not-provided" ? "error" : "warning",
        message: status === "not-provided"
          ? "Mailchimp package analysis did not provide a tenant boundary action queue for ownership handoff."
          : `Mailchimp tenant boundary action is ${status} for operation ${operation.id}.`,
        action: status === "not-provided"
          ? "compile_tenant_boundary_action_queue"
          : row.statusPatch?.nextAction || tenantPermissionHealth.nextAction || "repair_tenant_boundary_action",
      },
    nextAction: status === "ready"
      ? "accept_tenant_boundary_action_for_ownership"
      : status === "pending"
        ? row.statusPatch?.nextAction || tenantPermissionHealth.nextAction || "publish_tenant_boundary_action_status"
        : status === "not-provided"
          ? "compile_tenant_boundary_action_queue"
          : row.statusPatch?.nextAction || tenantPermissionHealth.nextAction || "repair_tenant_boundary_action",
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
  const lifecycleControlPlane = packageAnalysis.runtimeContract?.lifecycleControlPlane
    || packageAnalysis.lifecycleControlPlane
    || {};
  const lifecycleControlByOperation = new Map((lifecycleControlPlane.rows || []).map((entry) => [entry.operationId, entry]));
  const lifecycleSettingsAcceptance = packageAnalysis.runtimeContract?.lifecycleSettingsAcceptance
    || packageAnalysis.lifecycleSettingsAcceptance
    || {};
  const lifecycleSettingsByOperation = new Map((lifecycleSettingsAcceptance.rows || []).map((entry) => [entry.operationId, entry]));
  const acceptanceByOperation = new Map((packageAnalysis.acceptancePreview?.rows || []).map((row) => [row.operationId, row]));
  const operatorPacket = packageAnalysis.operatorHandoffPacket
    || packageAnalysis.runtimeContract?.operatorHandoffPacket
    || {};
  const operatorPacketByOperation = new Map((operatorPacket.rows || []).map((row) => [row.operationId, row]));
  const checkpointPlan = packageAnalysis.runtimeContract?.adapterRecoveryCheckpointPlan
    || packageAnalysis.adapterRecoveryCheckpointPlan
    || {};
  const checkpointByOperation = new Map((checkpointPlan.rows || []).map((row) => [row.operationId, row]));
  const providerReadiness = packageAnalysis.runtimeContract?.providerReadinessHandoff
    || packageAnalysis.providerReadinessHandoff
    || {};
  const providerReadinessByOperation = new Map((providerReadiness.rows || []).map((row) => [row.operationId, row]));
  const routeReadinessSurface = packageAnalysis.runtimeContract?.routeReadinessSurface
    || packageAnalysis.routeReadinessSurface
    || {};
  const routeReadinessByOperation = new Map((routeReadinessSurface.rows || []).map((row) => [row.operationId, row]));
  const previewAcceptanceSummary = packageAnalysis.runtimeContract?.previewAcceptanceSummary
    || packageAnalysis.previewAcceptanceSummary
    || {};
  const previewAcceptanceByOperation = new Map((previewAcceptanceSummary.rows || []).map((row) => [row.operationId, row]));
  const operatorAcceptanceCheckpoint = packageAnalysis.runtimeContract?.operatorAcceptanceCheckpoint
    || packageAnalysis.operatorAcceptanceCheckpoint
    || {};
  const operatorAcceptanceByOperation = new Map((operatorAcceptanceCheckpoint.rows || []).map((row) => [row.operationId, row]));
  const operationalIncidentLedger = packageAnalysis.runtimeContract?.operationalIncidentLedger
    || packageAnalysis.operationalIncidentLedger
    || {};
  const incidentByOperation = new Map((operationalIncidentLedger.rows || []).map((row) => [row.operationId, row]));
  const operationalAcceptanceMatrix = packageAnalysis.runtimeContract?.operationalAcceptanceMatrix
    || packageAnalysis.operationalAcceptanceMatrix
    || {};
  const operationalAcceptanceByOperation = new Map((operationalAcceptanceMatrix.rows || []).map((row) => [row.operationId, row]));
  const rows = operationOwnership.map((entry) => {
    const visibility = lifecycleByOperation.get(entry.operationId) || entry.packageLifecycle || {};
    const lifecycleControl = lifecycleControlByOperation.get(entry.operationId) || {};
    const lifecycleSettings = lifecycleSettingsByOperation.get(entry.operationId) || {};
    const packageAcceptance = acceptanceByOperation.get(entry.operationId) || {};
    const operatorPacketRow = operatorPacketByOperation.get(entry.operationId) || {};
    const checkpoint = checkpointByOperation.get(entry.operationId) || {};
    const readiness = providerReadinessByOperation.get(entry.operationId) || {};
    const routeReadiness = routeReadinessByOperation.get(entry.operationId) || {};
    const previewAcceptance = previewAcceptanceByOperation.get(entry.operationId) || {};
    const operatorAcceptance = operatorAcceptanceByOperation.get(entry.operationId) || {};
    const incident = incidentByOperation.get(entry.operationId) || {};
    const operationalAcceptance = operationalAcceptanceByOperation.get(entry.operationId) || {};
    const leaseCapabilities = entry.capabilities
      .filter((capability) => capability.leaseRequired)
      .map((capability) => capability.capability)
      .sort();
    const lifecycleBlocked = ["settings-blocked", "disabled", "health-paused", "adapter-failed"].includes(visibility.status)
      || lifecycleControl.status === "blocked"
      || lifecycleSettings.status === "blocked"
      || lifecycleSettings.acceptedForProvider === false && lifecycleSettings.status === "blocked";
    const lifecyclePending = lifecycleControl.status === "pending"
      || lifecycleSettings.status === "pending";
    const lifecycleSettingsRequired = lifecycleSettings.acceptanceId
      && (lifecycleSettings.commandStatus?.dispatch?.enabled === true || lifecycleSettings.operatorVisible === true);
    const lifecycleSettingsAccepted = !lifecycleSettings.acceptanceId
      || lifecycleSettings.acceptedForProvider === true
      || (!entry.capabilities.some((capability) => capability.leaseRequired) && lifecycleSettings.acceptedForOperator === true);
    const lifecycleSettingsBlocked = lifecycleSettingsRequired && lifecycleSettingsAccepted === false && lifecycleSettings.status !== "pending";
    const lifecycleSettingsPending = lifecycleSettingsRequired && lifecycleSettings.status === "pending";
    const packageAcceptanceBlocked = packageAcceptance.accepted === false
      || [
        "metadata-incomplete",
        "boundary-blocked",
        "adapter-failed",
        "validation-blocked",
      ].includes(packageAcceptance.readiness)
      || String(packageAcceptance.readiness || "").startsWith("lifecycle-");
    const operatorPacketBlocked = operatorPacketRow.status === "blocked"
      || operatorPacketRow.acceptedForOperator === false;
    const operatorPacketPending = operatorPacketRow.status === "pending";
    const recoveryCheckpointBlocked = checkpoint.status === "blocked"
      || checkpoint.status === "operator-review"
      || (checkpoint.status === "pending" && entry.gate.status === "blocked");
    const providerReadinessBlocked = readiness.status === "blocked"
      || readiness.acceptedForProvider === false;
    const providerReadinessPending = readiness.status === "pending";
    const routeReadinessBlocked = routeReadiness.routeState === "blocked"
      || routeReadiness.acceptedForRoute === false
      || routeReadiness.statusPatch?.patchable === false;
    const routeReadinessPending = routeReadiness.routeState === "pending";
    const previewAcceptanceBlocked = previewAcceptance.readiness === "blocked"
      || previewAcceptance.acceptedForRoute === false
      || previewAcceptance.statusPatch?.patchable === false;
    const previewAcceptancePending = previewAcceptance.readiness === "pending";
    const operatorAcceptanceBlocked = operatorAcceptance.status === "blocked"
      || operatorAcceptance.acceptedForOwnership === false
      || operatorAcceptance.statusPatch?.patchable === false;
    const operatorAcceptancePending = operatorAcceptance.status === "pending";
    const operationalBlocked = incident.status === "blocked"
      || incident.acceptedForDispatch === false;
    const operationalPending = incident.status === "pending" || incident.status === "degraded";
    const operationalAcceptanceBlocked = operationalAcceptance.status === "blocked"
      || operationalAcceptance.acceptedForOwnership === false;
    const operationalAcceptancePending = ["pending", "degraded", "retry-scheduled"].includes(operationalAcceptance.status);
    const readinessStatusPatch = readiness.statusPatch || {};
    const readinessConfirmation = readiness.providerConfirmation || {};
    const readinessChecks = readiness.readinessChecks || {};
    const readinessPatchBlocked = readinessStatusPatch.patchable === false;
    const readinessConfirmationMissingFields = Array.isArray(readinessConfirmation.missingFields)
      ? readinessConfirmation.missingFields
      : [];
    const readinessConfirmationBlockedBy = Array.isArray(readinessConfirmation.blockedBy)
      ? readinessConfirmation.blockedBy
      : [];
    const readinessConfirmationPendingBy = Array.isArray(readinessConfirmation.pendingBy)
      ? readinessConfirmation.pendingBy
      : [];
    const readinessProviderObservation = readinessConfirmation.observedProvider || {};
    const readinessProviderFailed = readinessConfirmation.status === "provider-failed"
      || readinessProviderObservation.unavailable === true;
    const readinessProviderDegraded = readinessConfirmation.status === "provider-degraded"
      || readinessProviderObservation.degraded === true;
    const readinessProviderPollable = readinessConfirmation.checks?.providerPollable === true
      || Number(readinessProviderObservation.retryAfterMs || 0) > 0;
    const readinessConfirmationBlocked = readinessConfirmation.status === "metadata-incomplete"
      || readinessProviderFailed
      || readinessConfirmation.statusPatch?.patchable === false
      || readinessConfirmationMissingFields.some((field) => (
        ["requestId", "clientStatusPath", "providerStatusPath", "idempotencyKey"].includes(field)
      ));
    const readinessConfirmationPending = readinessConfirmation.required === true
      && readinessConfirmation.accepted !== true
      && !readinessConfirmationBlocked;
    const metadataReady = Boolean(
      entry.persistedState.resumeCommand.requestId
      && entry.persistedState.resumeCommand.statusPath
      && visibility.clientStatusPath,
    );
    const receiptReady = entry.persistedState.clientRuntimeAdoption?.receiptAccepted === true
      && entry.persistedState.clientRuntimeAdoption?.receiptMatches !== false;
    const negotiable = entry.boundary.status === "isolated"
      && entry.gate.status !== "blocked"
      && !lifecycleBlocked
      && !lifecyclePending
      && !lifecycleSettingsBlocked
      && !lifecycleSettingsPending
      && !packageAcceptanceBlocked
      && !operatorPacketBlocked
      && !operatorPacketPending
      && !recoveryCheckpointBlocked
      && !providerReadinessBlocked
      && !providerReadinessPending
      && !readinessPatchBlocked
      && !readinessConfirmationBlocked
      && !readinessConfirmationPending
      && !routeReadinessBlocked
      && !routeReadinessPending
      && !previewAcceptanceBlocked
      && !previewAcceptancePending
      && !operatorAcceptanceBlocked
      && !operatorAcceptancePending
      && !operationalBlocked
      && !operationalPending
      && !operationalAcceptanceBlocked
      && !operationalAcceptancePending
      && receiptReady
      && metadataReady;
    const status = !metadataReady
      ? "metadata-incomplete"
      : !receiptReady
        ? "client-handoff-receipt-blocked"
      : packageAcceptanceBlocked
        ? `package-${packageAcceptance.readiness || "acceptance-blocked"}`
      : operatorPacketBlocked
        ? "operator-handoff-blocked"
      : operatorPacketPending
        ? "operator-handoff-pending"
      : recoveryCheckpointBlocked
        ? `recovery-checkpoint-${checkpoint.status || "blocked"}`
      : readinessPatchBlocked
        ? "provider-readiness-status-patch-blocked"
      : readinessConfirmationBlocked
        ? "provider-readiness-confirmation-blocked"
      : routeReadinessBlocked
        ? "route-readiness-blocked"
      : routeReadinessPending
        ? "route-readiness-pending"
      : previewAcceptanceBlocked
        ? "preview-acceptance-blocked"
      : previewAcceptancePending
        ? "preview-acceptance-pending"
      : operatorAcceptanceBlocked
        ? "operator-acceptance-blocked"
      : operatorAcceptancePending
        ? "operator-acceptance-pending"
      : operationalBlocked
        ? "operational-incident-blocked"
      : operationalPending
        ? `operational-incident-${incident.status || "pending"}`
      : operationalAcceptanceBlocked
        ? "operational-acceptance-blocked"
      : operationalAcceptancePending
        ? `operational-acceptance-${operationalAcceptance.status || "pending"}`
      : providerReadinessBlocked
        ? `provider-readiness-${readiness.status || "blocked"}`
      : providerReadinessPending || readinessConfirmationPending
        ? "provider-readiness-pending"
      : lifecycleSettingsBlocked
        ? `lifecycle-settings-${lifecycleSettings.status || "blocked"}`
      : lifecycleSettingsPending
        ? "lifecycle-settings-pending"
      : lifecycleBlocked
        ? `lifecycle-${lifecycleControl.status === "blocked" ? "control-blocked" : visibility.status}`
      : lifecyclePending
        ? "lifecycle-control-pending"
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
      clientHandoffReceiptId: entry.persistedState.clientRuntimeAdoption.receiptId,
      clientHandoffReceiptState: entry.persistedState.clientRuntimeAdoption.receiptState,
      clientHandoffReceiptAccepted: entry.persistedState.clientRuntimeAdoption.receiptAccepted === true,
      clientHandoffReceiptMatches: entry.persistedState.clientRuntimeAdoption.receiptMatches !== false,
      lifecycleStatus: visibility.status || "unknown",
      lifecycleNextAction: visibility.nextAction || entry.gate.nextAction,
      lifecycleSchedule: visibility.schedule || null,
      lifecycleControlPlaneId: lifecycleControlPlane.controlPlaneId || null,
      lifecycleControlId: lifecycleControl.controlId || null,
      lifecycleControlStatus: lifecycleControl.status || "unknown",
      lifecycleControlBlockedBy: lifecycleControl.blockedBy || [],
      lifecycleControlPendingBy: lifecycleControl.pendingBy || [],
      lifecycleControlCommands: (lifecycleControl.commands || []).map((command) => ({
        command: command.command,
        enabled: command.enabled === true,
        patchId: command.statusPatch?.patchId || null,
        state: command.statusPatch?.state || "unknown",
        nextAction: command.statusPatch?.nextAction || null,
      })),
      lifecycleSettingsAcceptanceKey: lifecycleSettingsAcceptance.acceptanceKey || null,
      lifecycleSettingsAcceptanceId: lifecycleSettings.acceptanceId || null,
      lifecycleSettingsStatus: lifecycleSettings.status || "unknown",
      lifecycleSettingsAcceptedForProvider: lifecycleSettings.acceptedForProvider === true,
      lifecycleSettingsAcceptedForOperator: lifecycleSettings.acceptedForOperator === true,
      lifecycleSettingsEnabledCommands: lifecycleSettings.enabledCommands || [],
      lifecycleSettingsBlockedBy: lifecycleSettings.blockedBy || [],
      lifecycleSettingsPendingBy: lifecycleSettings.pendingBy || [],
      lifecycleSettingsSchedule: lifecycleSettings.schedule || null,
      lifecycleSettingsCommandStatus: lifecycleSettings.commandStatus || {
        dispatch: { enabled: false, patchId: null, state: "unknown", nextAction: null },
        retry: { enabled: false, patchId: null, state: "unknown", nextAction: null },
        schedule: { enabled: false, patchId: null, state: "unknown", nextAction: null },
      },
      packageAcceptanceKey: packageAnalysis.acceptancePreview?.acceptanceKey || null,
      packageAcceptanceStatus: packageAcceptance.readiness || packageAnalysis.acceptancePreview?.status || "unknown",
      packageAcceptanceAccepted: packageAcceptance.accepted !== false,
      packageAcceptanceNextAction: packageAcceptance.nextStep?.action || packageAnalysis.acceptancePreview?.nextAction || null,
      routeReadinessSurfaceId: routeReadinessSurface.surfaceId || null,
      routeReadinessStatus: routeReadiness.routeState || routeReadinessSurface.status || "unknown",
      routeReadinessAccepted: routeReadiness.acceptedForRoute === true,
      routePreviewDigest: routeReadiness.previewDigest || null,
      routeReadinessBlockedBy: routeReadiness.blockedBy || [],
      routeReadinessPendingBy: routeReadiness.pendingBy || [],
      routeReadinessStatusPatch: {
        patchId: routeReadiness.statusPatch?.patchId || null,
        patchable: routeReadiness.statusPatch?.patchable === true && !routeReadinessBlocked,
        statusPath: routeReadiness.statusPatch?.statusPath || entry.persistedState.resumeCommand.statusPath || null,
        providerStatusPath: routeReadiness.statusPatch?.providerStatusPath || entry.persistedState.resumeCommand.providerStatusPath || null,
        state: routeReadiness.statusPatch?.state || "unknown",
        visibleState: routeReadiness.statusPatch?.visibleState || null,
        blockedBy: routeReadiness.statusPatch?.blockedBy || [],
        pendingBy: routeReadiness.statusPatch?.pendingBy || [],
      },
      previewAcceptanceSummaryKey: previewAcceptanceSummary.summaryKey || null,
      previewAcceptanceSummaryId: previewAcceptance.summaryId || null,
      previewAcceptanceReadiness: previewAcceptance.readiness || "unknown",
      previewAcceptanceAcceptedForRoute: previewAcceptance.acceptedForRoute === true,
      previewAcceptanceAcceptedForApproval: previewAcceptance.acceptedForApproval === true,
      previewAcceptanceBlockedBy: previewAcceptance.blockedBy || [],
      previewAcceptancePendingBy: previewAcceptance.pendingBy || [],
      previewAcceptanceStatusPatch: {
        patchId: previewAcceptance.statusPatch?.patchId || null,
        patchable: previewAcceptance.statusPatch?.patchable === true && !previewAcceptanceBlocked,
        statusPath: previewAcceptance.statusPatch?.statusPath || entry.persistedState.resumeCommand.statusPath || null,
        providerStatusPath: previewAcceptance.statusPatch?.providerStatusPath || entry.persistedState.resumeCommand.providerStatusPath || null,
        state: previewAcceptance.statusPatch?.state || "unknown",
        visibleState: previewAcceptance.statusPatch?.visibleState || null,
        blockedBy: previewAcceptance.statusPatch?.blockedBy || [],
        pendingBy: previewAcceptance.statusPatch?.pendingBy || [],
      },
      previewAcceptanceCommandEnabled: (previewAcceptance.commands || []).some((command) => command.enabled === true),
      operatorAcceptanceCheckpointKey: operatorAcceptanceCheckpoint.checkpointKey || null,
      operatorAcceptanceCheckpointId: operatorAcceptance.checkpointId || null,
      operatorAcceptanceStatus: operatorAcceptance.status || "unknown",
      operatorAcceptanceAcceptedForOwnership: operatorAcceptance.acceptedForOwnership === true,
      operatorAcceptanceCommand: operatorAcceptance.command || "unknown",
      operatorAcceptanceVisibleState: operatorAcceptance.visibleState || null,
      operatorAcceptanceBlockedBy: operatorAcceptance.blockedBy || [],
      operatorAcceptancePendingBy: operatorAcceptance.pendingBy || [],
      operatorAcceptanceLinkedContracts: operatorAcceptance.linkedContracts || null,
      operatorAcceptanceStatusPatch: {
        patchId: operatorAcceptance.statusPatch?.patchId || null,
        patchable: operatorAcceptance.statusPatch?.patchable === true && !operatorAcceptanceBlocked,
        statusPath: operatorAcceptance.statusPatch?.statusPath || entry.persistedState.resumeCommand.statusPath || null,
        providerStatusPath: operatorAcceptance.statusPatch?.providerStatusPath || entry.persistedState.resumeCommand.providerStatusPath || null,
        state: operatorAcceptance.statusPatch?.state || "unknown",
        visibleState: operatorAcceptance.statusPatch?.visibleState || null,
        blockedBy: operatorAcceptance.statusPatch?.blockedBy || [],
        pendingBy: operatorAcceptance.statusPatch?.pendingBy || [],
        nextAction: operatorAcceptance.statusPatch?.nextAction || null,
      },
      operatorAcceptanceCommands: (operatorAcceptance.commands || []).map((command) => ({
        command: command.command,
        enabled: command.enabled === true && !operatorAcceptanceBlocked,
        idempotencyKey: command.idempotencyKey || null,
        statusPath: command.statusPath || null,
      })),
      operationalIncidentLedgerKey: operationalIncidentLedger.ledgerKey || null,
      operationalIncidentId: incident.incidentId || null,
      operationalIncidentStatus: incident.status || "not-provided",
      operationalIncidentSeverity: incident.severity || "info",
      operationalIncidentRetryable: incident.retryable === true,
      operationalIncidentBlockedBy: incident.blockedBy || [],
      operationalIncidentPendingBy: incident.pendingBy || [],
      operationalIncidentStatusPatch: {
        patchId: incident.statusPatch?.patchId || null,
        patchable: incident.statusPatch?.patchable === true && !operationalBlocked,
        statusPath: incident.statusPatch?.statusPath || entry.persistedState.resumeCommand.statusPath || null,
        providerStatusPath: incident.statusPatch?.providerStatusPath || entry.persistedState.resumeCommand.providerStatusPath || null,
        state: incident.statusPatch?.state || "unknown",
        visibleState: incident.statusPatch?.visibleState || null,
        blockedBy: incident.statusPatch?.blockedBy || [],
        nextAction: incident.statusPatch?.nextAction || null,
      },
      operationalAcceptanceMatrixKey: operationalAcceptanceMatrix.matrixKey || null,
      operationalAcceptanceId: operationalAcceptance.acceptanceId || null,
      operationalAcceptanceStatus: operationalAcceptance.status || "not-provided",
      operationalAcceptanceAcceptedForProvider: operationalAcceptance.acceptedForProvider === true,
      operationalAcceptanceAcceptedForOwnership: operationalAcceptance.acceptedForOwnership === true,
      operationalAcceptanceRetryable: operationalAcceptance.retryable === true,
      operationalAcceptanceRetry: operationalAcceptance.retry || {
        attempt: 0,
        maxAttempts: 0,
        nextDelayMs: 0,
        reason: "",
      },
      operationalAcceptanceActionableError: operationalAcceptance.actionableError || null,
      operationalAcceptanceBlockedBy: operationalAcceptance.blockedBy || [],
      operationalAcceptancePendingBy: operationalAcceptance.pendingBy || [],
      operationalAcceptanceStatusPatch: {
        patchId: operationalAcceptance.statusPatch?.patchId || null,
        patchable: operationalAcceptance.statusPatch?.patchable === true && !operationalAcceptanceBlocked,
        statusPath: operationalAcceptance.statusPatch?.statusPath || entry.persistedState.resumeCommand.statusPath || null,
        providerStatusPath: operationalAcceptance.statusPatch?.providerStatusPath || entry.persistedState.resumeCommand.providerStatusPath || null,
        state: operationalAcceptance.statusPatch?.state || "unknown",
        visibleState: operationalAcceptance.statusPatch?.visibleState || null,
        blockedBy: operationalAcceptance.statusPatch?.blockedBy || [],
        nextAction: operationalAcceptance.statusPatch?.nextAction || null,
      },
      routeReadinessCommands: (routeReadiness.commands || []).map((command) => ({
        command: command.command,
        enabled: command.enabled === true && !routeReadinessBlocked,
        idempotencyKey: command.idempotencyKey || null,
        statusPath: command.statusPath || null,
      })),
      operatorHandoffPacketId: operatorPacket.packetId || null,
      operatorHandoffPacketRowId: operatorPacketRow.packetRowId || null,
      operatorHandoffStatus: operatorPacketRow.status || operatorPacket.status || "unknown",
      operatorHandoffAccepted: operatorPacketRow.acceptedForOperator === true,
      operatorHandoffVisibleState: operatorPacketRow.visibleState || null,
      operatorHandoffCommand: operatorPacketRow.command || null,
      operatorHandoffBlockedBy: operatorPacketRow.blockedBy || [],
      operatorHandoffPendingBy: operatorPacketRow.pendingBy || [],
      recoveryCheckpointPlanKey: checkpointPlan.planKey || null,
      recoveryCheckpointId: checkpoint.checkpointId || null,
      recoveryCheckpointStatus: checkpoint.status || "unknown",
      recoveryCheckpointReplaySafe: checkpoint.replaySafe === true,
      recoveryCheckpointBlockedBy: checkpoint.blockedBy || [],
      recoveryCheckpointPendingBy: checkpoint.pendingBy || [],
      providerReadinessHandoffKey: providerReadiness.handoffKey || null,
      providerReadinessId: readiness.readinessId || null,
      providerReadinessStatus: readiness.status || "unknown",
      providerReadinessAccepted: readiness.acceptedForProvider === true,
      providerReadinessBlockedBy: readiness.blockedBy || [],
      providerReadinessPendingBy: readiness.pendingBy || [],
      providerReadinessChecks: readinessChecks,
      providerReadinessConfirmation: {
        confirmationId: readinessConfirmation.confirmationId || null,
        status: readinessConfirmation.status || "unknown",
        required: readinessConfirmation.required === true,
        accepted: readinessConfirmation.accepted === true,
        observedState: readinessConfirmation.observedState || null,
        observedAtPath: readinessConfirmation.observedAtPath || null,
        ackTokenPresent: readinessConfirmation.ackTokenPresent === true || Boolean(readinessConfirmation.ackToken),
        ackActor: readinessConfirmation.ackActor || null,
        ackAt: readinessConfirmation.ackAt || null,
        requiredFields: readinessConfirmation.requiredFields || [],
        missingFields: readinessConfirmationMissingFields,
        blockedBy: readinessConfirmationBlockedBy,
        pendingBy: readinessConfirmationPendingBy,
        observedProvider: {
          status: readinessProviderObservation.status || "unknown",
          degraded: readinessProviderDegraded,
          unavailable: readinessProviderFailed,
          retryAttempt: readinessProviderObservation.retryAttempt || 0,
          retryAfterMs: readinessProviderObservation.retryAfterMs || 0,
          failureCode: readinessProviderObservation.failureCode || null,
          failureMessage: readinessProviderObservation.failureMessage || null,
          actionable: readinessProviderObservation.actionable || null,
          pollable: readinessProviderPollable,
        },
        checks: readinessConfirmation.checks || {},
        actionableError: readinessConfirmation.actionableError || null,
        statusPatch: readinessConfirmation.statusPatch || null,
        nextAction: readinessConfirmation.nextAction || null,
      },
      providerReadinessStatusPatch: {
        patchId: readinessStatusPatch.patchId || null,
        patchable: readinessStatusPatch.patchable === true && !readinessPatchBlocked,
        statusPath: readinessStatusPatch.statusPath || entry.persistedState.resumeCommand.statusPath || null,
        providerStatusPath: readinessStatusPatch.providerStatusPath || entry.persistedState.resumeCommand.providerStatusPath || null,
        state: readinessStatusPatch.state || "unknown",
        visibleState: readinessStatusPatch.visibleState || null,
        blockedBy: readinessStatusPatch.blockedBy || [],
        nextAction: readinessStatusPatch.nextAction || null,
      },
      providerReadinessConfirmationBlocked: readinessConfirmationBlocked,
      providerReadinessConfirmationPending: readinessConfirmationPending,
      providerReadinessConfirmationFailureState: readinessProviderFailed
        ? "failed"
        : readinessProviderDegraded
          ? "degraded"
          : readinessConfirmationPending
            ? "pending"
            : readinessConfirmation.accepted === true
              ? "accepted"
              : "not-required",
      providerReadinessConfirmationRetryAfterMs: readinessProviderObservation.retryAfterMs || 0,
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
        : status === "client-handoff-receipt-blocked"
          ? "repair_client_handoff_receipt_metadata"
        : packageAcceptanceBlocked
          ? packageAcceptance.nextStep?.action || packageAnalysis.acceptancePreview?.nextAction || "repair_package_acceptance_preview"
        : operatorPacketBlocked || operatorPacketPending
          ? operatorPacketRow.nextAction || operatorPacket.nextAction || "repair_operator_handoff_packet"
        : recoveryCheckpointBlocked
          ? checkpoint.nextAction || checkpointPlan.nextAction || "repair_adapter_recovery_checkpoint"
        : readinessPatchBlocked
          ? readinessStatusPatch.nextAction || "repair_provider_readiness_status_patch"
        : readinessConfirmationBlocked
          ? readinessProviderFailed
            ? readinessConfirmation.nextAction || "surface_provider_confirmation_failure"
            : readinessConfirmation.nextAction || "repair_provider_readiness_confirmation"
        : routeReadinessBlocked
          ? routeReadiness.nextAction || routeReadinessSurface.nextAction || "repair_route_readiness_surface"
        : routeReadinessPending
          ? routeReadiness.nextAction || routeReadinessSurface.nextAction || "wait_for_route_readiness_surface"
        : previewAcceptanceBlocked
          ? previewAcceptance.nextAction || previewAcceptanceSummary.nextAction || "repair_preview_acceptance_summary"
        : previewAcceptancePending
          ? previewAcceptance.nextAction || previewAcceptanceSummary.nextAction || "wait_for_preview_acceptance_summary"
        : operatorAcceptanceBlocked
          ? operatorAcceptance.nextAction || operatorAcceptanceCheckpoint.nextAction || "repair_operator_acceptance_checkpoint"
        : operatorAcceptancePending
          ? operatorAcceptance.nextAction || operatorAcceptanceCheckpoint.nextAction || "wait_for_operator_acceptance_checkpoint"
        : operationalBlocked
          ? incident.nextAction || operationalIncidentLedger.nextAction || "repair_operational_incident_ledger"
        : operationalPending
          ? incident.nextAction || operationalIncidentLedger.nextAction || "wait_for_operational_incident_ledger"
        : operationalAcceptanceBlocked
          ? operationalAcceptance.nextAction || operationalAcceptanceMatrix.nextAction || "repair_operational_acceptance_matrix"
        : operationalAcceptancePending
          ? operationalAcceptance.nextAction || operationalAcceptanceMatrix.nextAction || "wait_for_operational_acceptance_matrix"
        : providerReadinessBlocked || providerReadinessPending
          ? readiness.nextAction || providerReadiness.nextAction || "repair_provider_readiness_handoff"
        : readinessConfirmationPending
          ? readinessProviderDegraded
            ? readinessConfirmation.nextAction || "poll_provider_confirmation_after_backoff"
            : readinessConfirmation.nextAction || readiness.nextAction || "wait_for_provider_readiness_confirmation"
        : lifecycleSettingsBlocked
          ? lifecycleSettings.nextAction || "repair_lifecycle_settings_acceptance"
        : lifecycleSettingsPending
          ? lifecycleSettings.nextAction || "wait_for_lifecycle_settings_acceptance"
        : lifecycleBlocked
          ? lifecycleControl.nextAction || visibility.nextAction || "repair_lifecycle_visibility"
        : lifecyclePending
          ? lifecycleControl.nextAction || visibility.nextAction || "wait_for_lifecycle_control_plane"
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
      clientHandoffReceiptBlocked: rows.filter((row) => row.status === "client-handoff-receipt-blocked").length,
      lifecycleBlocked: rows.filter((row) => row.status.startsWith("lifecycle-")).length,
      lifecycleControlPending: rows.filter((row) => row.status === "lifecycle-control-pending").length,
      lifecycleSettingsBlocked: rows.filter((row) => row.status.startsWith("lifecycle-settings-") && row.status !== "lifecycle-settings-pending").length,
      lifecycleSettingsPending: rows.filter((row) => row.status === "lifecycle-settings-pending").length,
      lifecycleSettingsProviderAccepted: rows.filter((row) => row.lifecycleSettingsAcceptedForProvider).length,
      packageAcceptanceBlocked: rows.filter((row) => row.status.startsWith("package-")).length,
      operatorHandoffBlocked: rows.filter((row) => row.status === "operator-handoff-blocked").length,
      operatorHandoffPending: rows.filter((row) => row.status === "operator-handoff-pending").length,
      operatorHandoffReady: rows.filter((row) => row.operatorHandoffAccepted).length,
      recoveryCheckpointBlocked: rows.filter((row) => row.status.startsWith("recovery-checkpoint-")).length,
      recoveryCheckpointReady: rows.filter((row) => row.recoveryCheckpointStatus === "checkpoint-ready").length,
      providerReadinessBlocked: rows.filter((row) => row.status.startsWith("provider-readiness-blocked")).length,
      providerReadinessPending: rows.filter((row) => row.status === "provider-readiness-pending").length,
      providerReadinessReady: rows.filter((row) => row.providerReadinessAccepted).length,
      providerReadinessStatusPatchBlocked: rows.filter((row) => row.status === "provider-readiness-status-patch-blocked").length,
      providerReadinessStatusPatchable: rows.filter((row) => row.providerReadinessStatusPatch.patchable).length,
      providerReadinessConfirmationBlocked: rows.filter((row) => row.providerReadinessConfirmationBlocked).length,
      providerReadinessConfirmationPending: rows.filter((row) => row.providerReadinessConfirmation.required && !row.providerReadinessConfirmation.accepted).length,
      providerReadinessConfirmationFailed: rows.filter((row) => row.providerReadinessConfirmationFailureState === "failed").length,
      providerReadinessConfirmationDegraded: rows.filter((row) => row.providerReadinessConfirmationFailureState === "degraded").length,
      providerReadinessConfirmationPollable: rows.filter((row) => row.providerReadinessConfirmation.observedProvider?.pollable).length,
      routeReadinessBlocked: rows.filter((row) => row.status === "route-readiness-blocked").length,
      routeReadinessPending: rows.filter((row) => row.status === "route-readiness-pending").length,
      routeReadinessAccepted: rows.filter((row) => row.routeReadinessAccepted).length,
      routeReadinessPatchable: rows.filter((row) => row.routeReadinessStatusPatch.patchable).length,
      previewAcceptanceBlocked: rows.filter((row) => row.status === "preview-acceptance-blocked").length,
      previewAcceptancePending: rows.filter((row) => row.status === "preview-acceptance-pending").length,
      previewAcceptanceRouteAccepted: rows.filter((row) => row.previewAcceptanceAcceptedForRoute).length,
      previewAcceptanceApprovalAccepted: rows.filter((row) => row.previewAcceptanceAcceptedForApproval).length,
      previewAcceptancePatchable: rows.filter((row) => row.previewAcceptanceStatusPatch.patchable).length,
      operatorAcceptanceBlocked: rows.filter((row) => row.status === "operator-acceptance-blocked").length,
      operatorAcceptancePending: rows.filter((row) => row.status === "operator-acceptance-pending").length,
      operatorAcceptanceAccepted: rows.filter((row) => row.operatorAcceptanceAcceptedForOwnership).length,
      operatorAcceptancePatchable: rows.filter((row) => row.operatorAcceptanceStatusPatch.patchable).length,
      operationalIncidentBlocked: rows.filter((row) => row.status === "operational-incident-blocked").length,
      operationalIncidentPending: rows.filter((row) => row.status === "operational-incident-pending" || row.status === "operational-incident-degraded").length,
      operationalIncidentRetryable: rows.filter((row) => row.operationalIncidentRetryable).length,
      operationalAcceptanceBlocked: rows.filter((row) => row.status === "operational-acceptance-blocked").length,
      operationalAcceptancePending: rows.filter((row) => row.status === "operational-acceptance-pending" || row.status === "operational-acceptance-degraded").length,
      operationalAcceptanceRetryScheduled: rows.filter((row) => row.status === "operational-acceptance-retry-scheduled").length,
      operationalAcceptanceAccepted: rows.filter((row) => row.operationalAcceptanceAcceptedForOwnership).length,
      operationalAcceptancePatchable: rows.filter((row) => row.operationalAcceptanceStatusPatch.patchable).length,
    },
    externalHandoff: {
      allowed: blockedRows.length === 0,
      operationIds: rows.filter((row) => row.negotiable).map((row) => row.operationId).sort(),
      blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
      lifecycleSettingsAcceptanceKey: lifecycleSettingsAcceptance.acceptanceKey || null,
      operatorAcceptanceCheckpointKey: operatorAcceptanceCheckpoint.checkpointKey || null,
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
  const restartSafeStatusEnvelope = packageAnalysis.restartSafeStatusEnvelope
    || packageAnalysis.runtimeContract?.restartSafeStatusEnvelope
    || {};
  const restartStatusEnvelopeByOperation = new Map((restartSafeStatusEnvelope.rows || []).map((row) => [row.operationId, row]));
  const rows = operationOwnership.map((entry) => {
    const providerRow = providerRowsByOperation.get(entry.operationId) || {};
    const journalRow = restartJournalByOperation.get(entry.operationId) || {};
    const envelopeRow = restartStatusEnvelopeByOperation.get(entry.operationId) || {};
    const restartResolution = journalRow.statusResolution || {};
    const restartStatusPatch = envelopeRow.statusPatch || journalRow.statusPatch || {};
    const restartStatusCommand = envelopeRow.command || journalRow.statusCommand || {};
    const resume = entry.persistedState.resumeCommand || {};
    const restartSafe = entry.persistedState.restartSafe === true
      && (present ? persisted.restartSafe === true : true)
      && (journalRow.restartSafe !== false)
      && (envelopeRow.restartSafe !== false)
      && (restartResolution.restartSafe !== false)
      && !["blocked", "operator-review"].includes(journalRow.status)
      && !["blocked", "operator-review"].includes(envelopeRow.status)
      && !["blocked", "operator-review"].includes(restartResolution.status)
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
      ...(restartResolution.status === "blocked" ? ["restart-resolution:blocked"] : []),
      ...(restartResolution.status === "operator-review" ? ["restart-resolution:operator-review"] : []),
      ...((restartResolution.blockedBy || []).map((blocker) => `restart-resolution:${blocker}`)),
      ...(restartStatusPatch.patchable === false
        ? (restartStatusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `restart-status:${blocker}`)
        : []),
      ...(restartSafeStatusEnvelope.envelopeId && !envelopeRow.operationId ? ["restart-status-envelope:row-missing"] : []),
      ...(envelopeRow.status === "blocked" ? [`restart-status-envelope:${envelopeRow.nextAction || "blocked"}`] : []),
      ...(envelopeRow.status === "operator-review" ? ["restart-status-envelope:operator-review"] : []),
      ...((envelopeRow.blockedBy || []).map((blocker) => `restart-status-envelope:${blocker}`)),
      ...(envelopeRow.command?.enabled === false && envelopeRow.status !== "blocked" ? ["restart-status-envelope:command-disabled"] : []),
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
      restartStatusEnvelopeId: restartSafeStatusEnvelope.envelopeId || null,
      restartStatusEnvelopeStatus: envelopeRow.status || "unknown",
      restartStatusEnvelopeSafe: envelopeRow.restartSafe === true,
      restartStatusResolution: {
        resolutionId: restartResolution.resolutionId || null,
        status: restartResolution.status || "unknown",
        restartSafe: restartResolution.restartSafe === true,
        terminalState: restartResolution.terminalState || null,
        observedState: restartResolution.observed?.state || null,
        observedPatchId: restartResolution.observed?.patchId || null,
        expectedPatchId: restartResolution.expected?.patchId || restartStatusPatch.patchId || null,
        blockedBy: restartResolution.blockedBy || [],
        pendingBy: restartResolution.pendingBy || [],
        commandEnabled: restartResolution.command?.enabled === true,
        nextAction: restartResolution.nextAction || null,
      },
      restartStatusPatch: {
        patchId: restartStatusPatch.patchId || null,
        patchable: restartStatusPatch.patchable === true && blockedBy.length === 0,
        state: restartStatusPatch.state || envelopeRow.status || journalRow.status || "unknown",
        visibleState: restartStatusPatch.visibleState || null,
        statusPath: restartStatusPatch.statusPath || envelopeRow.statusPath || resume.statusPath || null,
        providerStatusPath: restartStatusPatch.providerStatusPath || envelopeRow.providerStatusPath || resume.providerStatusPath || null,
        blockedBy: restartStatusPatch.blockedBy || [],
        nextAction: restartStatusPatch.nextAction || null,
      },
      restartStatusCommand: {
        commandId: restartStatusCommand.commandId || null,
        command: restartStatusCommand.command || "publish-restart-status-patch",
        enabled: restartStatusCommand.enabled === true && blockedBy.length === 0,
        idempotencyKey: restartStatusCommand.idempotencyKey || null,
        statusPath: restartStatusCommand.statusPath || restartStatusPatch.statusPath || envelopeRow.statusPath || resume.statusPath || null,
        providerStatusPath: restartStatusCommand.providerStatusPath || restartStatusPatch.providerStatusPath || envelopeRow.providerStatusPath || resume.providerStatusPath || null,
      },
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
              : blockedBy[0].startsWith("restart-resolution:")
                ? restartResolution.nextAction || "repair_restart_status_resolution"
              : blockedBy[0].startsWith("restart-status:")
                ? restartStatusPatch.nextAction || "repair_restart_status_patch"
              : blockedBy[0].startsWith("restart-status-envelope:")
                ? envelopeRow.nextAction || restartSafeStatusEnvelope.nextAction || "repair_restart_safe_status_envelope"
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
      statusPatchBlockedOperationIds: restartJournal.statusPatchBlockedOperationIds || [],
      statusCommandCount: (restartJournal.statusCommands || []).length,
      statusEnvelopeId: restartSafeStatusEnvelope.envelopeId || null,
      statusEnvelopeStatus: restartSafeStatusEnvelope.status || "unknown",
      statusEnvelopeAcceptedForRuntime: restartSafeStatusEnvelope.acceptedForRuntime === true,
      statusEnvelopeCounters: restartSafeStatusEnvelope.counters || null,
      statusEnvelopeBlockedOperationIds: restartSafeStatusEnvelope.blockedOperationIds || [],
      statusEnvelopePendingOperationIds: restartSafeStatusEnvelope.pendingOperationIds || [],
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
      restartStatusEnvelopeLinked: rows.filter((row) => row.restartStatusEnvelopeId).length,
      restartStatusEnvelopeBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("restart-status-envelope:"))).length,
      restartStatusEnvelopeSafe: rows.filter((row) => row.restartStatusEnvelopeSafe).length,
      restartJournalBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("restart-journal:"))).length,
      restartResolutionBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("restart-resolution:"))).length,
      restartResolutionReady: rows.filter((row) => row.restartStatusResolution.status === "resume-ready").length,
      restartResolutionTerminal: rows.filter((row) => row.restartStatusResolution.status === "terminal-observed").length,
      restartResolutionCommandEnabled: rows.filter((row) => row.restartStatusResolution.commandEnabled).length,
      restartStatusPatchable: rows.filter((row) => row.restartStatusPatch.patchable).length,
      restartStatusBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("restart-status:"))).length,
      restartStatusCommandEnabled: rows.filter((row) => row.restartStatusCommand.enabled).length,
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

function buildOwnershipExportSummary(packageAnalysis, operationOwnership, lifecycle, settings, providerSync, controlPersistence) {
  const restartJournal = packageAnalysis.restartJournal
    || packageAnalysis.runtimeContract?.restartJournal
    || {};
  const restartJournalByOperation = new Map((restartJournal.rows || []).map((row) => [row.operationId, row]));
  const controlPersistenceByOperation = new Map((controlPersistence?.rows || []).map((row) => [row.operationId, row]));
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
      statusPatchBlockedOperationIds: restartJournal.statusPatchBlockedOperationIds || [],
      statusCommandCount: (restartJournal.statusCommands || []).length,
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
      restartStatusPatchId: restartJournalByOperation.get(entry.operationId)?.statusPatch?.patchId || null,
      restartStatusPatchable: restartJournalByOperation.get(entry.operationId)?.statusPatch?.patchable === true,
      restartStatusPatchState: restartJournalByOperation.get(entry.operationId)?.statusPatch?.state || "unknown",
      restartStatusCommandEnabled: restartJournalByOperation.get(entry.operationId)?.statusCommand?.enabled === true,
      restartStatusResolutionId: restartJournalByOperation.get(entry.operationId)?.statusResolution?.resolutionId || null,
      restartStatusResolutionStatus: restartJournalByOperation.get(entry.operationId)?.statusResolution?.status || "unknown",
      restartStatusResolutionSafe: restartJournalByOperation.get(entry.operationId)?.statusResolution?.restartSafe === true,
      restartStatusResolutionTerminalState: restartJournalByOperation.get(entry.operationId)?.statusResolution?.terminalState || null,
      restartStatusResolutionCommandEnabled: restartJournalByOperation.get(entry.operationId)?.statusResolution?.command?.enabled === true,
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
      restartStatusPatchId: controlPersistenceByOperation.get(row.operationId)?.restartStatusPatch?.patchId || null,
      restartStatusPatchable: controlPersistenceByOperation.get(row.operationId)?.restartStatusPatch?.patchable === true,
      restartStatusCommandEnabled: controlPersistenceByOperation.get(row.operationId)?.restartStatusCommand?.enabled === true,
      nextAction: row.nextAction,
    })),
    providerRows: providerSync.rows.map((row) => ({
      operationId: row.operationId,
      status: row.status,
      lifecycleStatus: row.lifecycleStatus,
      lifecycleSettingsStatus: row.lifecycleSettingsStatus,
      lifecycleSettingsAcceptedForProvider: row.lifecycleSettingsAcceptedForProvider,
      lifecycleSettingsAcceptedForOperator: row.lifecycleSettingsAcceptedForOperator,
      lifecycleSettingsEnabledCommands: row.lifecycleSettingsEnabledCommands,
      packageAcceptanceStatus: row.packageAcceptanceStatus,
      providerReadinessStatus: row.providerReadinessStatus,
      providerReadinessAccepted: row.providerReadinessAccepted,
      operationalAcceptanceId: row.operationalAcceptanceId,
      operationalAcceptanceStatus: row.operationalAcceptanceStatus,
      operationalAcceptanceAcceptedForOwnership: row.operationalAcceptanceAcceptedForOwnership,
      operationalAcceptanceRetryDelayMs: row.operationalAcceptanceRetry?.nextDelayMs || 0,
      operationalAcceptancePatchable: row.operationalAcceptanceStatusPatch?.patchable === true,
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
  const restartJournal = packageAnalysis.restartJournal
    || packageAnalysis.runtimeContract?.restartJournal
    || {};
  const restartByOperation = new Map((restartJournal.rows || []).map((row) => [row.operationId, row]));
  const rows = providerSync.rows.map((row) => {
    const entry = ownershipByOperation.get(row.operationId) || {};
    const resumeCommand = entry.persistedState?.resumeCommand || {};
    const recoverySnapshot = entry.persistedState?.recoverySnapshot || {};
    const restartResolution = restartByOperation.get(row.operationId)?.statusResolution || {};
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
      ...(row.providerReadinessAccepted === false ? [`provider-readiness:${row.providerReadinessStatus || "blocked"}`] : []),
      ...((row.providerReadinessBlockedBy || []).map((blocker) => `provider-readiness:${blocker}`)),
      ...(row.clientHandoffReceiptAccepted === false ? ["receipt:not-accepted"] : []),
      ...(row.clientHandoffReceiptMatches === false ? ["receipt:id-mismatch"] : []),
      ...(row.operatorHandoffStatus === "blocked" ? ["operator-handoff:blocked"] : []),
      ...((row.operatorHandoffBlockedBy || []).map((blocker) => `operator-handoff:${blocker}`)),
      ...(row.lifecycleSettingsStatus === "blocked" ? ["lifecycle-settings:blocked"] : []),
      ...(row.lifecycleSettingsStatus === "pending" ? ["lifecycle-settings:pending"] : []),
      ...(row.lifecycleSettingsAcceptedForProvider === false && row.leaseCapabilities?.length ? ["lifecycle-settings:provider-not-accepted"] : []),
      ...((row.lifecycleSettingsBlockedBy || []).map((blocker) => `lifecycle-settings:${blocker}`)),
      ...(row.routeReadinessAccepted === false ? [`route-readiness:${row.routeReadinessStatus || "blocked"}`] : []),
      ...((row.routeReadinessBlockedBy || []).map((blocker) => `route-readiness:${blocker}`)),
      ...(row.routeReadinessStatusPatch?.patchable === false
        ? (row.routeReadinessStatusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `route-readiness-status:${blocker}`)
        : []),
      ...(row.previewAcceptanceAcceptedForRoute === false ? [`preview-acceptance:${row.previewAcceptanceReadiness || "blocked"}`] : []),
      ...((row.previewAcceptanceBlockedBy || []).map((blocker) => `preview-acceptance:${blocker}`)),
      ...(row.previewAcceptanceStatusPatch?.patchable === false
        ? (row.previewAcceptanceStatusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `preview-acceptance-status:${blocker}`)
        : []),
      ...(row.operatorAcceptanceAcceptedForOwnership === false ? [`operator-acceptance:${row.operatorAcceptanceStatus || "blocked"}`] : []),
      ...((row.operatorAcceptanceBlockedBy || []).map((blocker) => `operator-acceptance:${blocker}`)),
      ...(row.operatorAcceptanceStatusPatch?.patchable === false
        ? (row.operatorAcceptanceStatusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `operator-acceptance-status:${blocker}`)
        : []),
      ...missingPayloadFields.map((field) => `payload:${field}`),
      ...((entry.persistedState?.clientRuntimeAdoption?.drift || []).map((drift) => `adoption:${drift}`)),
      ...permissionBoundary.blockedBy.map((blocker) => `permission:${blocker}`),
      ...(permissionBoundary.statusPatch?.patchable === false
        ? permissionBoundary.statusPatch.blockedBy.map((blocker) => `permission-status:${blocker}`)
        : []),
      ...(restartResolution.status === "blocked" ? ["restart-resolution:blocked"] : []),
      ...(restartResolution.status === "operator-review" ? ["restart-resolution:operator-review"] : []),
      ...((restartResolution.blockedBy || []).map((blocker) => `restart-resolution:${blocker}`)),
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
      clientHandoffReceiptId: row.clientHandoffReceiptId || null,
      clientHandoffReceiptState: row.clientHandoffReceiptState || "unknown",
      clientHandoffReceiptAccepted: row.clientHandoffReceiptAccepted === true,
      clientHandoffReceiptMatches: row.clientHandoffReceiptMatches !== false,
      providerReadinessHandoffKey: row.providerReadinessHandoffKey || null,
      providerReadinessId: row.providerReadinessId || null,
      providerReadinessStatus: row.providerReadinessStatus || "unknown",
      providerReadinessAccepted: row.providerReadinessAccepted === true,
      operatorHandoffPacketId: row.operatorHandoffPacketId || null,
      operatorHandoffPacketRowId: row.operatorHandoffPacketRowId || null,
      operatorHandoffStatus: row.operatorHandoffStatus || "unknown",
      operatorHandoffAccepted: row.operatorHandoffAccepted === true,
      operatorHandoffCommand: row.operatorHandoffCommand || null,
      lifecycleSettingsAcceptanceId: row.lifecycleSettingsAcceptanceId || null,
      lifecycleSettingsStatus: row.lifecycleSettingsStatus || "unknown",
      lifecycleSettingsAcceptedForProvider: row.lifecycleSettingsAcceptedForProvider === true,
      lifecycleSettingsAcceptedForOperator: row.lifecycleSettingsAcceptedForOperator === true,
      lifecycleSettingsEnabledCommands: row.lifecycleSettingsEnabledCommands || [],
      lifecycleSettingsBlockedBy: row.lifecycleSettingsBlockedBy || [],
      lifecycleSettingsPendingBy: row.lifecycleSettingsPendingBy || [],
      lifecycleSettingsSchedule: row.lifecycleSettingsSchedule || null,
      lifecycleSettingsCommandStatus: row.lifecycleSettingsCommandStatus || {},
      routeReadinessSurfaceId: row.routeReadinessSurfaceId || null,
      routePreviewDigest: row.routePreviewDigest || null,
      routeReadinessStatus: row.routeReadinessStatus || "unknown",
      routeReadinessAccepted: row.routeReadinessAccepted === true,
      routeReadinessBlockedBy: row.routeReadinessBlockedBy || [],
      routeReadinessPendingBy: row.routeReadinessPendingBy || [],
      routeReadinessStatusPatch: row.routeReadinessStatusPatch || {
        patchId: null,
        patchable: false,
        statusPath: null,
        providerStatusPath: null,
        state: "unknown",
        visibleState: null,
        blockedBy: [],
        pendingBy: [],
      },
      routeReadinessCommands: row.routeReadinessCommands || [],
      previewAcceptanceSummaryKey: row.previewAcceptanceSummaryKey || null,
      previewAcceptanceSummaryId: row.previewAcceptanceSummaryId || null,
      previewAcceptanceReadiness: row.previewAcceptanceReadiness || "unknown",
      previewAcceptanceAcceptedForRoute: row.previewAcceptanceAcceptedForRoute === true,
      previewAcceptanceAcceptedForApproval: row.previewAcceptanceAcceptedForApproval === true,
      previewAcceptanceBlockedBy: row.previewAcceptanceBlockedBy || [],
      previewAcceptancePendingBy: row.previewAcceptancePendingBy || [],
      previewAcceptanceStatusPatch: row.previewAcceptanceStatusPatch || {
        patchId: null,
        patchable: false,
        statusPath: null,
        providerStatusPath: null,
        state: "unknown",
        visibleState: null,
        blockedBy: [],
        pendingBy: [],
      },
      previewAcceptanceCommandEnabled: row.previewAcceptanceCommandEnabled === true,
      operatorAcceptanceCheckpointKey: row.operatorAcceptanceCheckpointKey || null,
      operatorAcceptanceCheckpointId: row.operatorAcceptanceCheckpointId || null,
      operatorAcceptanceStatus: row.operatorAcceptanceStatus || "unknown",
      operatorAcceptanceAcceptedForOwnership: row.operatorAcceptanceAcceptedForOwnership === true,
      operatorAcceptanceCommand: row.operatorAcceptanceCommand || "unknown",
      operatorAcceptanceVisibleState: row.operatorAcceptanceVisibleState || null,
      operatorAcceptanceBlockedBy: row.operatorAcceptanceBlockedBy || [],
      operatorAcceptancePendingBy: row.operatorAcceptancePendingBy || [],
      operatorAcceptanceLinkedContracts: row.operatorAcceptanceLinkedContracts || null,
      operatorAcceptanceStatusPatch: row.operatorAcceptanceStatusPatch || {
        patchId: null,
        patchable: false,
        statusPath: null,
        providerStatusPath: null,
        state: "unknown",
        visibleState: null,
        blockedBy: [],
        pendingBy: [],
      },
      operatorAcceptanceCommands: row.operatorAcceptanceCommands || [],
      restartStatusResolution: {
        resolutionId: restartResolution.resolutionId || null,
        status: restartResolution.status || "unknown",
        restartSafe: restartResolution.restartSafe === true,
        terminalState: restartResolution.terminalState || null,
        observedState: restartResolution.observedState || restartResolution.observed?.state || null,
        commandEnabled: restartResolution.commandEnabled === true || restartResolution.command?.enabled === true,
        nextAction: restartResolution.nextAction || null,
      },
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
        providerReadinessId: row.providerReadinessId || null,
        clientHandoffReceiptId: row.clientHandoffReceiptId || null,
        clientHandoffReceiptState: row.clientHandoffReceiptState || "unknown",
        requestId: row.requestId || null,
        clientStatusPath: row.clientStatusPath || null,
        providerStatusPath: row.providerStatusPath || null,
        auditId: row.auditId || null,
        auditChannel: row.auditChannel || null,
        boundaryKey: row.boundaryKey || entry.boundary?.boundaryKey || null,
        permissionBoundary,
        permissionStatusPatch: permissionBoundary.statusPatch,
        permissionCommands: permissionBoundary.commands,
        operatorHandoff: row.operatorHandoffCommand
          ? {
            packetId: row.operatorHandoffPacketId || null,
            packetRowId: row.operatorHandoffPacketRowId || null,
            status: row.operatorHandoffStatus || "unknown",
            visibleState: row.operatorHandoffVisibleState || null,
            command: row.operatorHandoffCommand,
            blockedBy: row.operatorHandoffBlockedBy || [],
            pendingBy: row.operatorHandoffPendingBy || [],
          }
          : null,
        lifecycleSettings: row.lifecycleSettingsAcceptanceId
          ? {
            acceptanceId: row.lifecycleSettingsAcceptanceId,
            status: row.lifecycleSettingsStatus || "unknown",
            acceptedForProvider: row.lifecycleSettingsAcceptedForProvider === true,
            acceptedForOperator: row.lifecycleSettingsAcceptedForOperator === true,
            enabledCommands: row.lifecycleSettingsEnabledCommands || [],
            schedule: row.lifecycleSettingsSchedule || null,
            commandStatus: row.lifecycleSettingsCommandStatus || {},
            blockedBy: row.lifecycleSettingsBlockedBy || [],
            pendingBy: row.lifecycleSettingsPendingBy || [],
          }
          : null,
        routeReadiness: row.routePreviewDigest
          ? {
            surfaceId: row.routeReadinessSurfaceId || null,
            previewDigest: row.routePreviewDigest,
            status: row.routeReadinessStatus || "unknown",
            acceptedForRoute: row.routeReadinessAccepted === true,
            statusPatch: row.routeReadinessStatusPatch || null,
            commands: row.routeReadinessCommands || [],
            blockedBy: row.routeReadinessBlockedBy || [],
            pendingBy: row.routeReadinessPendingBy || [],
          }
          : null,
        previewAcceptance: row.previewAcceptanceSummaryId
          ? {
            summaryKey: row.previewAcceptanceSummaryKey || null,
            summaryId: row.previewAcceptanceSummaryId,
            readiness: row.previewAcceptanceReadiness || "unknown",
            acceptedForRoute: row.previewAcceptanceAcceptedForRoute === true,
            acceptedForApproval: row.previewAcceptanceAcceptedForApproval === true,
            statusPatch: row.previewAcceptanceStatusPatch || null,
            commandEnabled: row.previewAcceptanceCommandEnabled === true,
            blockedBy: row.previewAcceptanceBlockedBy || [],
            pendingBy: row.previewAcceptancePendingBy || [],
          }
          : null,
        operatorAcceptance: row.operatorAcceptanceCheckpointId
          ? {
            checkpointKey: row.operatorAcceptanceCheckpointKey || null,
            checkpointId: row.operatorAcceptanceCheckpointId,
            status: row.operatorAcceptanceStatus || "unknown",
            acceptedForOwnership: row.operatorAcceptanceAcceptedForOwnership === true,
            command: row.operatorAcceptanceCommand || "unknown",
            visibleState: row.operatorAcceptanceVisibleState || null,
            linkedContracts: row.operatorAcceptanceLinkedContracts || null,
            statusPatch: row.operatorAcceptanceStatusPatch || null,
            commands: row.operatorAcceptanceCommands || [],
            blockedBy: row.operatorAcceptanceBlockedBy || [],
            pendingBy: row.operatorAcceptancePendingBy || [],
          }
          : null,
        restartStatusResolution: {
          resolutionId: restartResolution.resolutionId || null,
          status: restartResolution.status || "unknown",
          terminalState: restartResolution.terminalState || null,
          observedState: restartResolution.observedState || restartResolution.observed?.state || null,
        },
        leaseCapabilities,
        delegatedCapabilities,
        memoryKeys: recoverySnapshot.memoryKeys || [],
        replayToken: resumeCommand.replayToken || null,
      },
      nextAction: payloadReady
        ? leaseCapabilities.length
          ? "handoff_external_write_lease_to_provider"
          : "handoff_delegated_read_to_provider"
        : row.providerReadinessAccepted === false
          ? row.nextAction || "repair_provider_readiness_handoff"
        : row.operatorHandoffStatus === "blocked"
          ? row.nextAction || "repair_operator_handoff_packet"
        : row.lifecycleSettingsStatus === "blocked"
          ? row.nextAction || "repair_lifecycle_settings_acceptance"
        : row.lifecycleSettingsStatus === "pending"
          ? row.nextAction || "wait_for_lifecycle_settings_acceptance"
        : row.previewAcceptanceAcceptedForRoute === false
          ? row.nextAction || "repair_preview_acceptance_summary"
        : row.operatorAcceptanceAcceptedForOwnership === false
          ? row.nextAction || "repair_operator_acceptance_checkpoint"
        : row.routeReadinessAccepted === false
          ? row.nextAction || "repair_route_readiness_surface"
        : restartResolution.status === "blocked" || restartResolution.status === "operator-review"
          ? restartResolution.nextAction || "repair_restart_status_resolution"
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
      providerReadinessAccepted: rows.filter((row) => row.providerReadinessAccepted).length,
      providerReadinessBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("provider-readiness:"))).length,
      operatorHandoffLinked: rows.filter((row) => row.operatorHandoffPacketRowId).length,
      operatorHandoffBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("operator-handoff:"))).length,
      lifecycleSettingsLinked: rows.filter((row) => row.lifecycleSettingsAcceptanceId).length,
      lifecycleSettingsBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("lifecycle-settings:"))).length,
      lifecycleSettingsProviderAccepted: rows.filter((row) => row.lifecycleSettingsAcceptedForProvider).length,
      routeReadinessLinked: rows.filter((row) => row.routePreviewDigest).length,
      routeReadinessBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("route-readiness:"))).length,
      routeReadinessStatusPatchable: rows.filter((row) => row.routeReadinessStatusPatch?.patchable === true).length,
      previewAcceptanceLinked: rows.filter((row) => row.previewAcceptanceSummaryId).length,
      previewAcceptanceBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("preview-acceptance:"))).length,
      previewAcceptanceStatusPatchable: rows.filter((row) => row.previewAcceptanceStatusPatch?.patchable === true).length,
      operatorAcceptanceLinked: rows.filter((row) => row.operatorAcceptanceCheckpointId).length,
      operatorAcceptanceBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("operator-acceptance:"))).length,
      operatorAcceptanceStatusPatchable: rows.filter((row) => row.operatorAcceptanceStatusPatch?.patchable === true).length,
      restartResolutionReady: rows.filter((row) => row.restartStatusResolution.status === "resume-ready").length,
      restartResolutionBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("restart-resolution:"))).length,
      restartResolutionTerminal: rows.filter((row) => row.restartStatusResolution.status === "terminal-observed").length,
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
    const boundaryEvidence = buildBoundaryEvidenceReview(operation, owner, boundary);
    const auditHandoff = buildAuditHandoff(packageAnalysis, operation, owner, capabilities, memory, boundary);
    const clientHandoffReadiness = clientHandoffReadinessForOperation(packageAnalysis, operation);
    const persistedState = normalizePersistedCommandState(packageAnalysis, operation, owner, capabilities, memory, clientHandoffReadiness);
    const gate = buildOwnershipGate(packageAnalysis, operation, owner, capabilities, memory, boundary, auditHandoff);
    const tenantPermissionHealth = buildTenantPermissionOwnershipHealth(packageAnalysis, operation, owner, boundary, gate);
    const tenantBoundaryActionHealth = buildTenantBoundaryActionOwnershipState(
      packageAnalysis,
      operation,
      owner,
      boundary,
      tenantPermissionHealth,
    );
    return {
      operationId: operation.id,
      descriptorId: operation.descriptorId,
      owner,
      boundary,
      boundaryEvidence,
      tenantPermissionHealth,
      tenantBoundaryActionHealth,
      auditHandoff,
      capabilities,
      memory,
      clientHandoffReadiness,
      persistedState,
      packageLifecycle: operation.lifecycleVisibility || null,
      gate,
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
  const exportSummary = buildOwnershipExportSummary(
    packageAnalysis,
    operationOwnership,
    lifecycle,
    lifecycleSettings,
    providerSync,
    controlPersistence,
  );
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
      ...(entry.clientHandoffReadiness?.acceptedForOwnershipResume !== true
        ? [{
          severity: entry.clientHandoffReadiness?.status === "pending" ? "warning" : "error",
          code: "ownership.operation.client_handoff_readiness_not_resume_safe",
          message: `Operation ${entry.operationId} cannot resume ownership handoff until Mailchimp client handoff readiness is restart-safe.`,
          field: `operations.${entry.operationId}.clientHandoffReadiness`,
          operationId: entry.operationId,
          action: entry.clientHandoffReadiness?.nextAction || "repair_client_handoff_readiness",
          blockedBy: entry.clientHandoffReadiness?.blockedBy || [],
          pendingBy: entry.clientHandoffReadiness?.pendingBy || [],
          drift: entry.clientHandoffReadiness?.drift || [],
          handoffId: entry.clientHandoffReadiness?.handoffId || null,
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
      ...(entry.boundaryEvidence?.acceptedForOwnership === false
        ? [{
          severity: "error",
          code: "ownership.operation.boundary_evidence_drift",
          message: `Operation ${entry.operationId} boundary evidence packet does not match the Mailchimp ownership boundary.`,
          field: `operations.${entry.operationId}.boundaryEvidencePacket`,
          operationId: entry.operationId,
          action: entry.boundaryEvidence.nextAction,
          drift: entry.boundaryEvidence.drift,
        }]
        : []),
      ...(entry.tenantPermissionHealth?.status === "blocked"
        ? [{
          severity: "error",
          code: "ownership.operation.tenant_permission_enforcement_blocked",
          message: `Operation ${entry.operationId} cannot accept ownership until tenant permission enforcement is repaired.`,
          field: `operations.${entry.operationId}.tenantPermissionEnforcement`,
          operationId: entry.operationId,
          action: entry.tenantPermissionHealth.nextAction,
          blockedBy: entry.tenantPermissionHealth.blockedBy,
        }]
        : []),
      ...(entry.tenantPermissionHealth?.status === "pending"
        ? [{
          severity: "warning",
          code: "ownership.operation.tenant_permission_enforcement_pending",
          message: `Operation ${entry.operationId} is waiting for tenant permission enforcement handoff.`,
          field: `operations.${entry.operationId}.tenantPermissionEnforcement`,
          operationId: entry.operationId,
          action: entry.tenantPermissionHealth.nextAction,
          pendingBy: entry.tenantPermissionHealth.pendingBy,
        }]
        : []),
      ...(entry.tenantBoundaryActionHealth?.actionableError
        ? [{
          severity: entry.tenantBoundaryActionHealth.actionableError.severity,
          code: entry.tenantBoundaryActionHealth.actionableError.code,
          message: entry.tenantBoundaryActionHealth.actionableError.message,
          field: `operations.${entry.operationId}.tenantBoundaryActionHealth`,
          operationId: entry.operationId,
          action: entry.tenantBoundaryActionHealth.actionableError.action,
          blockedBy: entry.tenantBoundaryActionHealth.blockedBy,
          pendingBy: entry.tenantBoundaryActionHealth.pendingBy,
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
    providerSync.rows
      .filter((row) => row.lifecycleSettingsStatus === "blocked" || row.lifecycleSettingsStatus === "pending")
      .map((row) => ({
        severity: row.lifecycleSettingsStatus === "blocked" ? "error" : "warning",
        code: `ownership.provider.lifecycle_settings_${row.lifecycleSettingsStatus}`,
        message: `Operation ${row.operationId} provider sync is waiting on Mailchimp lifecycle settings acceptance.`,
        field: `operations.${row.operationId}.providerSync.lifecycleSettings`,
        operationId: row.operationId,
        action: row.nextAction,
        blockedBy: row.lifecycleSettingsBlockedBy || [],
        pendingBy: row.lifecycleSettingsPendingBy || [],
      })),
    providerSync.rows
      .filter((row) => row.status === "client-handoff-receipt-blocked")
      .map((row) => ({
        severity: "error",
        code: "ownership.provider.client_handoff_receipt_blocked",
        message: `Operation ${row.operationId} provider sync is blocked by a stale or incomplete Mailchimp client handoff receipt.`,
        field: `operations.${row.operationId}.clientHandoffReceipt`,
        operationId: row.operationId,
        action: row.nextAction,
        receiptId: row.clientHandoffReceiptId || null,
      })),
    providerSync.rows
      .filter((row) => row.status === "operational-acceptance-blocked")
      .map((row) => ({
        severity: "error",
        code: "ownership.provider.operational_acceptance_blocked",
        message: `Operation ${row.operationId} provider sync is blocked by Mailchimp operational acceptance state.`,
        field: `operations.${row.operationId}.operationalAcceptance`,
        operationId: row.operationId,
        action: row.nextAction,
        acceptanceId: row.operationalAcceptanceId || null,
        blockedBy: row.operationalAcceptanceBlockedBy || [],
        actionableError: row.operationalAcceptanceActionableError || null,
      })),
    providerSync.rows
      .filter((row) => row.status === "operational-acceptance-pending" || row.status === "operational-acceptance-degraded" || row.status === "operational-acceptance-retry-scheduled")
      .map((row) => ({
        severity: "warning",
        code: `ownership.provider.${row.status.replaceAll("-", "_")}`,
        message: `Operation ${row.operationId} provider sync is waiting on Mailchimp operational acceptance.`,
        field: `operations.${row.operationId}.operationalAcceptance`,
        operationId: row.operationId,
        action: row.nextAction,
        acceptanceId: row.operationalAcceptanceId || null,
        retry: row.operationalAcceptanceRetry,
        pendingBy: row.operationalAcceptancePendingBy || [],
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
      .filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("provider-readiness:")))
      .map((row) => ({
        severity: "error",
        code: "ownership.provider_handoff.provider_readiness_blocked",
        message: `Operation ${row.operationId} provider handoff is blocked by package provider readiness state.`,
        field: `operations.${row.operationId}.providerHandoffEnvelope.providerReadiness`,
        operationId: row.operationId,
        action: row.nextAction,
        blockedBy: row.blockedBy.filter((blocker) => blocker.startsWith("provider-readiness:")),
      })),
    providerHandoffEnvelope.rows
      .filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("operator-handoff:")))
      .map((row) => ({
        severity: "error",
        code: "ownership.provider_handoff.operator_handoff_blocked",
        message: `Operation ${row.operationId} provider handoff is blocked by the package operator handoff packet.`,
        field: `operations.${row.operationId}.providerHandoffEnvelope.operatorHandoff`,
        operationId: row.operationId,
        action: row.nextAction,
        blockedBy: row.blockedBy.filter((blocker) => blocker.startsWith("operator-handoff:")),
      })),
    providerHandoffEnvelope.rows
      .filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("lifecycle-settings:")))
      .map((row) => ({
        severity: row.lifecycleSettingsStatus === "pending" ? "warning" : "error",
        code: "ownership.provider_handoff.lifecycle_settings_blocked",
        message: `Operation ${row.operationId} provider handoff is blocked by lifecycle settings acceptance.`,
        field: `operations.${row.operationId}.providerHandoffEnvelope.lifecycleSettings`,
        operationId: row.operationId,
        action: row.nextAction,
        blockedBy: row.blockedBy.filter((blocker) => blocker.startsWith("lifecycle-settings:")),
      })),
    providerHandoffEnvelope.rows
      .filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("route-readiness:") || blocker.startsWith("route-readiness-status:")))
      .map((row) => ({
        severity: "error",
        code: "ownership.provider_handoff.route_readiness_blocked",
        message: `Operation ${row.operationId} provider handoff is blocked by the package route readiness preview.`,
        field: `operations.${row.operationId}.providerHandoffEnvelope.routeReadiness`,
        operationId: row.operationId,
        action: row.nextAction,
        blockedBy: row.blockedBy.filter((blocker) => blocker.startsWith("route-readiness:") || blocker.startsWith("route-readiness-status:")),
        routePreviewDigest: row.routePreviewDigest || null,
      })),
    providerHandoffEnvelope.rows
      .filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("preview-acceptance:") || blocker.startsWith("preview-acceptance-status:")))
      .map((row) => ({
        severity: "error",
        code: "ownership.provider_handoff.preview_acceptance_blocked",
        message: `Operation ${row.operationId} provider handoff is blocked by the package preview acceptance summary.`,
        field: `operations.${row.operationId}.providerHandoffEnvelope.previewAcceptanceSummary`,
        operationId: row.operationId,
        action: row.nextAction,
        blockedBy: row.blockedBy.filter((blocker) => blocker.startsWith("preview-acceptance:") || blocker.startsWith("preview-acceptance-status:")),
        previewAcceptanceSummaryId: row.previewAcceptanceSummaryId || null,
      })),
    providerHandoffEnvelope.rows
      .filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("operator-acceptance:") || blocker.startsWith("operator-acceptance-status:")))
      .map((row) => ({
        severity: "error",
        code: "ownership.provider_handoff.operator_acceptance_blocked",
        message: `Operation ${row.operationId} provider handoff is blocked by the package operator acceptance checkpoint.`,
        field: `operations.${row.operationId}.providerHandoffEnvelope.operatorAcceptanceCheckpoint`,
        operationId: row.operationId,
        action: row.nextAction,
        blockedBy: row.blockedBy.filter((blocker) => blocker.startsWith("operator-acceptance:") || blocker.startsWith("operator-acceptance-status:")),
        operatorAcceptanceCheckpointId: row.operatorAcceptanceCheckpointId || null,
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
      boundaryEvidenceAcceptedCount: operationOwnership.filter((entry) => entry.boundaryEvidence?.acceptedForOwnership).length,
      boundaryEvidenceDriftCount: operationOwnership.filter((entry) => entry.boundaryEvidence?.drift?.length).length,
      clientHandoffResumeReadyCount: operationOwnership.filter((entry) => entry.clientHandoffReadiness?.acceptedForOwnershipResume).length,
      clientHandoffResumeBlockedCount: operationOwnership.filter((entry) => entry.clientHandoffReadiness?.acceptedForOwnershipResume !== true).length,
      clientHandoffStatusPatchableCount: operationOwnership.filter((entry) => entry.clientHandoffReadiness?.statusPatch?.patchable).length,
      clientHandoffCommandEnabledCount: operationOwnership.filter((entry) => entry.clientHandoffReadiness?.runtimeCommand?.enabled).length,
      tenantPermissionEnforcementStatus: packageAnalysis.tenantPermissionEnforcementMatrix?.status
        || packageAnalysis.runtimeContract?.tenantPermissionEnforcementMatrix?.status
        || "not-provided",
      tenantPermissionAcceptedCount: operationOwnership.filter((entry) => entry.tenantPermissionHealth?.acceptedForOwnership).length,
      tenantPermissionBlockedCount: operationOwnership.filter((entry) => entry.tenantPermissionHealth?.status === "blocked").length,
      tenantPermissionPendingCount: operationOwnership.filter((entry) => entry.tenantPermissionHealth?.status === "pending").length,
      tenantBoundaryActionQueueStatus: packageAnalysis.tenantBoundaryActionQueue?.status
        || packageAnalysis.runtimeContract?.tenantBoundaryActionQueue?.status
        || "not-provided",
      tenantBoundaryActionReadyCount: operationOwnership.filter((entry) => entry.tenantBoundaryActionHealth?.status === "ready").length,
      tenantBoundaryActionBlockedCount: operationOwnership.filter((entry) => entry.tenantBoundaryActionHealth?.status === "blocked").length,
      tenantBoundaryActionPendingCount: operationOwnership.filter((entry) => entry.tenantBoundaryActionHealth?.status === "pending").length,
      tenantBoundaryActionRetryableCount: operationOwnership.filter((entry) => entry.tenantBoundaryActionHealth?.retryable).length,
      lifecycleStatus: lifecycle.status,
      lifecycleCommand: lifecycle.command,
      providerSyncStatus: providerSync.status,
      controlPersistenceStatus: controlPersistence.status,
      restartJournalStatus: controlPersistence.restartJournal.status,
      providerHandoffStatus: providerHandoffEnvelope.status,
      providerReadinessReadyCount: providerHandoffEnvelope.counters.providerReadinessAccepted,
      providerReadinessBlockedCount: providerHandoffEnvelope.counters.providerReadinessBlocked,
      lifecycleSettingsLinkedCount: providerHandoffEnvelope.counters.lifecycleSettingsLinked,
      lifecycleSettingsBlockedCount: providerHandoffEnvelope.counters.lifecycleSettingsBlocked,
      lifecycleSettingsProviderAcceptedCount: providerHandoffEnvelope.counters.lifecycleSettingsProviderAccepted,
      routeReadinessLinkedCount: providerHandoffEnvelope.counters.routeReadinessLinked,
      routeReadinessBlockedCount: providerHandoffEnvelope.counters.routeReadinessBlocked,
      routeReadinessStatusPatchableCount: providerHandoffEnvelope.counters.routeReadinessStatusPatchable,
      previewAcceptanceBlockedCount: providerSync.counters.previewAcceptanceBlocked,
      previewAcceptancePendingCount: providerSync.counters.previewAcceptancePending,
      previewAcceptanceRouteAcceptedCount: providerSync.counters.previewAcceptanceRouteAccepted,
      previewAcceptanceApprovalAcceptedCount: providerSync.counters.previewAcceptanceApprovalAccepted,
      previewAcceptancePatchableCount: providerSync.counters.previewAcceptancePatchable,
      operatorAcceptanceCheckpointStatus: packageAnalysis.operatorAcceptanceCheckpoint?.status
        || packageAnalysis.runtimeContract?.operatorAcceptanceCheckpoint?.status
        || "not-provided",
      operatorAcceptanceAcceptedCount: providerSync.counters.operatorAcceptanceAccepted,
      operatorAcceptanceBlockedCount: providerSync.counters.operatorAcceptanceBlocked,
      operatorAcceptancePendingCount: providerSync.counters.operatorAcceptancePending,
      operatorAcceptancePatchableCount: providerSync.counters.operatorAcceptancePatchable,
      clientHandoffReceiptBlockedCount: providerSync.counters.clientHandoffReceiptBlocked,
      operationalAcceptanceStatus: packageAnalysis.operationalAcceptanceMatrix?.status
        || packageAnalysis.runtimeContract?.operationalAcceptanceMatrix?.status
        || "not-provided",
      operationalAcceptanceAcceptedCount: providerSync.counters.operationalAcceptanceAccepted,
      operationalAcceptanceBlockedCount: providerSync.counters.operationalAcceptanceBlocked,
      operationalAcceptancePendingCount: providerSync.counters.operationalAcceptancePending,
      operationalAcceptanceRetryScheduledCount: providerSync.counters.operationalAcceptanceRetryScheduled,
      operationalAcceptancePatchableCount: providerSync.counters.operationalAcceptancePatchable,
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
      restartStatusEnvelopeId: controlPersistence.restartJournal.statusEnvelopeId,
      restartStatusEnvelopeStatus: controlPersistence.restartJournal.statusEnvelopeStatus,
      restartStatusEnvelopeBlockedCount: controlPersistence.counters.restartStatusEnvelopeBlocked,
      restartStatusEnvelopeSafeCount: controlPersistence.counters.restartStatusEnvelopeSafe,
    },
    lifecycle,
    providerSync,
    controlPersistence,
    providerHandoffEnvelope,
    packageAcceptance: packageAnalysis.acceptancePreview || null,
    packagePreviewAcceptanceSummary: packageAnalysis.previewAcceptanceSummary
      || packageAnalysis.runtimeContract?.previewAcceptanceSummary
      || null,
    routeReadinessSurface: packageAnalysis.routeReadinessSurface
      || packageAnalysis.runtimeContract?.routeReadinessSurface
      || null,
    operatorAcceptanceCheckpoint: packageAnalysis.operatorAcceptanceCheckpoint
      || packageAnalysis.runtimeContract?.operatorAcceptanceCheckpoint
      || null,
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
