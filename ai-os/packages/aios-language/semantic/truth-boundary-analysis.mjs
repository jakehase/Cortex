import { compileMailchimpVerifier, evaluateMailchimpVerifier } from "../compiler/verifier-compiler.mjs";
import { analyzeMailchimpPackage } from "./package-analysis.mjs";

function compactString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeEvidence(evidence = {}) {
  return {
    verifierEvidence: evidence.verifierEvidence || evidence.verifiers || {},
    approval: evidence.approval || {},
    candidate: evidence.candidate || evidence.payload || {},
    clientRuntimeAdoption: evidence.clientRuntimeAdoption || evidence.adoption || evidence.runtimeAdoption || {},
    tenant: compactString(evidence.tenant || evidence.workspaceTenant || evidence.candidate?.tenant),
    workspace: compactString(evidence.workspace || evidence.workspaceId || evidence.candidate?.workspace),
    actorRole: compactString(evidence.actorRole || evidence.role || evidence.approval?.actorRole),
    auditCorrelationId: compactString(evidence.auditCorrelationId || evidence.auditId || evidence.candidate?.auditCorrelationId),
    externalFactsChecked: evidence.externalFactsChecked === true,
    runtimeHealth: evidence.runtimeHealth || evidence.health || {},
  };
}

function adoptionEvidenceForOperation(evidence, operation) {
  const packageAdoption = operation.clientRuntimeAdoption || {};
  const runtimeAdoption = evidence.clientRuntimeAdoption || {};
  const byOperation = runtimeAdoption.byOperation?.[operation.id]
    || runtimeAdoption.operations?.[operation.id]
    || (Array.isArray(runtimeAdoption.rows)
      ? runtimeAdoption.rows.find((row) => row.operationId === operation.id)
      : null)
    || (runtimeAdoption.operationId === operation.id ? runtimeAdoption : {});
  const adoption = {
    ...packageAdoption,
    ...byOperation,
    request: {
      ...(packageAdoption.request || {}),
      ...(byOperation.request || {}),
    },
    client: {
      ...(packageAdoption.client || {}),
      ...(byOperation.client || {}),
    },
    boundary: {
      ...(packageAdoption.boundary || {}),
      ...(byOperation.boundary || {}),
    },
    workflow: {
      ...(packageAdoption.workflow || {}),
      ...(byOperation.workflow || {}),
    },
  };
  const expectedRequestId = compactString(packageAdoption.request?.requestId || operation.runtimeClientState?.request?.requestId);
  const expectedStatusPath = compactString(packageAdoption.client?.statusPath || operation.runtimeClientState?.client?.statusPath);
  const expectedBoundaryKey = compactString(packageAdoption.boundary?.boundaryKey || operation.tenantPermissionBoundary?.boundaryKey);
  const observedRequestId = compactString(adoption.request?.requestId || adoption.requestId);
  const observedStatusPath = compactString(adoption.client?.statusPath || adoption.clientStatusPath);
  const observedBoundaryKey = compactString(adoption.boundary?.boundaryKey || adoption.boundaryKey);
  const adoptionKey = compactString(adoption.adoptionKey || packageAdoption.adoptionKey);

  return {
    adoptionKey,
    status: compactString(adoption.status || packageAdoption.status, "unknown"),
    acceptedForClient: adoption.acceptedForClient === true || packageAdoption.acceptedForClient === true,
    expectedRequestId,
    observedRequestId,
    expectedStatusPath,
    observedStatusPath,
    expectedBoundaryKey,
    observedBoundaryKey,
    providerStatusPath: compactString(adoption.client?.providerStatusPath || adoption.providerStatusPath || packageAdoption.client?.providerStatusPath),
    tenant: compactString(adoption.boundary?.tenant || packageAdoption.boundary?.tenant),
    workspace: compactString(adoption.boundary?.workspace || packageAdoption.boundary?.workspace),
    allowedRoles: Array.isArray(adoption.boundary?.allowedRoles)
      ? adoption.boundary.allowedRoles.map((role) => compactString(role)).filter(Boolean).sort()
      : [],
    requiresAuditCorrelation: adoption.boundary?.requiresAuditCorrelation === true
      || packageAdoption.boundary?.requiresAuditCorrelation === true,
    metadataMatches: (!expectedRequestId || !observedRequestId || expectedRequestId === observedRequestId)
      && (!expectedStatusPath || !observedStatusPath || expectedStatusPath === observedStatusPath),
    boundaryMatches: !expectedBoundaryKey || !observedBoundaryKey || expectedBoundaryKey === observedBoundaryKey,
    handoffAllowed: adoption.workflow?.handoffAllowed !== false,
    nextAction: compactString(adoption.workflow?.nextAction || packageAdoption.workflow?.nextAction),
  };
}

function normalizeOperationalHealth(input = {}, operation = {}) {
  const retry = input.retry || {};
  const failure = input.failure || {};
  const attempt = Number.isFinite(Number(retry.attempt ?? input.attempt))
    ? Math.max(0, Number(retry.attempt ?? input.attempt))
    : 0;
  const maxAttempts = Number.isFinite(Number(retry.maxAttempts ?? input.maxAttempts))
    ? Math.max(1, Number(retry.maxAttempts ?? input.maxAttempts))
    : operation.externalWrite ? 5 : 2;
  const baseDelayMs = Number.isFinite(Number(retry.baseDelayMs ?? input.baseDelayMs))
    ? Math.max(250, Number(retry.baseDelayMs ?? input.baseDelayMs))
    : operation.externalWrite ? 1500 : 500;
  const lastError = compactString(failure.message || input.lastError || input.error);
  const degraded = input.degraded === true
    || failure.mode === "degraded"
    || input.state === "degraded";
  const retryAfterMs = Math.min(baseDelayMs * (2 ** attempt), operation.externalWrite ? 120000 : 30000);
  const exhausted = attempt >= maxAttempts;

  return {
    state: compactString(input.state || failure.state, degraded ? "degraded" : "healthy"),
    degraded,
    lastError,
    failure: {
      code: compactString(failure.code || input.code),
      mode: compactString(failure.mode || input.mode, degraded ? "degraded" : ""),
      operationId: compactString(failure.operationId || input.operationId),
      actionable: compactString(failure.actionable || input.actionable),
    },
    retry: {
      attempt,
      maxAttempts,
      retryAfterMs,
      exhausted,
      reason: compactString(retry.reason || failure.code || input.reason),
    },
  };
}

function healthForOperation(runtimeHealth, operation) {
  const byOperation = runtimeHealth.byOperation || runtimeHealth.operations || {};
  return normalizeOperationalHealth(
    byOperation[operation.id] || runtimeHealth[operation.id] || runtimeHealth,
    operation,
  );
}

function normalizeBoundaryScope(packageAnalysis, operation, evidence, options = {}) {
  const configured = options.boundary || options.scope || {};
  const contract = operation.tenantPermissionBoundary || {};
  const contractScope = contract.scope || {};
  const request = operation.runtimeClientState?.request || {};
  const adoptionEvidence = adoptionEvidenceForOperation(evidence, operation);
  const ownerScope = options.ownerScope || {};
  const requiredTenant = compactString(
    configured.tenant || contractScope.tenant || adoptionEvidence.tenant || operation.tenant || ownerScope.tenant || options.tenant,
    compactString(packageAnalysis.package?.name, "default"),
  );
  const requiredWorkspace = compactString(
    configured.workspace || contractScope.workspace || adoptionEvidence.workspace || operation.workspace || ownerScope.workspace || options.workspace,
    compactString(packageAnalysis.package?.version, "default"),
  );
  const allowedRoles = [...new Set([
    ...(Array.isArray(configured.allowedRoles) ? configured.allowedRoles : []),
    ...(Array.isArray(contract.allowedRoles) ? contract.allowedRoles : []),
    ...adoptionEvidence.allowedRoles,
    ...(operation.externalWrite ? ["operator", "admin"] : ["service", "operator", "admin"]),
  ].map((role) => compactString(role)).filter(Boolean))].sort();
  const deniedRoles = Array.isArray(contract.deniedRoles)
    ? contract.deniedRoles.map((role) => compactString(role)).filter(Boolean)
    : [];
  const tenantMatches = !requiredTenant || !evidence.tenant || evidence.tenant === requiredTenant;
  const workspaceMatches = !requiredWorkspace || !evidence.workspace || evidence.workspace === requiredWorkspace;
  const roleMatches = !evidence.actorRole || (allowedRoles.includes(evidence.actorRole) && !deniedRoles.includes(evidence.actorRole));
  const adoptionReady = adoptionEvidence.acceptedForClient
    && adoptionEvidence.metadataMatches
    && adoptionEvidence.boundaryMatches
    && adoptionEvidence.handoffAllowed;
  const auditReady = !(contract.requiresAuditCorrelation === true || adoptionEvidence.requiresAuditCorrelation || operation.externalWrite)
    || Boolean(evidence.auditCorrelationId);
  const contractReady = compactString(contract.status, "ready") === "ready";

  return {
    boundaryKey: compactString(contract.boundaryKey),
    requiredTenant,
    requiredWorkspace,
    environment: compactString(contractScope.environment, "production"),
    allowedRoles,
    deniedRoles,
    observedTenant: evidence.tenant || null,
    observedWorkspace: evidence.workspace || null,
    observedActorRole: evidence.actorRole || null,
    auditCorrelationId: evidence.auditCorrelationId || null,
    requestId: request.requestId || operation.statusHandoff?.requestId || null,
    statusPath: operation.runtimeClientState?.client?.statusPath || operation.statusHandoff?.clientStatusPath || null,
    boundaryStatusPath: contract.handoffStatusPath || operation.recoveryHandoff?.boundaryStatusPath || null,
    auditChannel: compactString(contract.auditChannel),
    clientRuntimeAdoption: {
      adoptionKey: adoptionEvidence.adoptionKey || null,
      status: adoptionEvidence.status,
      acceptedForClient: adoptionEvidence.acceptedForClient,
      metadataMatches: adoptionEvidence.metadataMatches,
      boundaryMatches: adoptionEvidence.boundaryMatches,
      handoffAllowed: adoptionEvidence.handoffAllowed,
      expectedRequestId: adoptionEvidence.expectedRequestId || null,
      observedRequestId: adoptionEvidence.observedRequestId || null,
      expectedStatusPath: adoptionEvidence.expectedStatusPath || null,
      observedStatusPath: adoptionEvidence.observedStatusPath || null,
      providerStatusPath: adoptionEvidence.providerStatusPath || null,
      nextAction: adoptionEvidence.nextAction || null,
    },
    checks: {
      tenantMatches,
      workspaceMatches,
      roleMatches,
      auditReady,
      contractReady,
      adoptionReady,
    },
    accepted: tenantMatches && workspaceMatches && roleMatches && auditReady && contractReady && adoptionReady,
  };
}

function buildOperationalRecovery(operation, boundaryScope, evaluation, health) {
  const verifierBlocked = evaluation.status !== "pass";
  const boundaryBlocked = !boundaryScope.accepted;
  const runtimeBlocked = health.degraded || health.retry.exhausted || Boolean(health.lastError);
  const failureState = boundaryBlocked
    ? "boundary-blocked"
    : verifierBlocked
      ? "evidence-blocked"
      : health.retry.exhausted
        ? "retry-exhausted"
        : health.degraded
          ? "degraded"
          : health.lastError
            ? "runtime-error"
            : "clear";
  const retryable = !health.retry.exhausted
    && !boundaryBlocked
    && (runtimeBlocked || (operation.externalWrite && verifierBlocked === false));
  const degradedMode = health.degraded || (operation.externalWrite && health.lastError && !health.retry.exhausted);

  return {
    failureState,
    degradedMode,
    retryable,
    backoff: {
      attempt: health.retry.attempt,
      maxAttempts: health.retry.maxAttempts,
      nextDelayMs: retryable ? health.retry.retryAfterMs : 0,
      reason: health.retry.reason || failureState,
    },
    actionableError: failureState === "clear"
      ? null
      : {
        code: health.failure.code || `truth.${failureState}`,
        severity: boundaryBlocked || health.retry.exhausted ? "error" : "warning",
        message: health.lastError || (
          boundaryBlocked
            ? "Mailchimp truth boundary evidence is outside the allowed tenant/workspace/role scope."
            : verifierBlocked
              ? "Mailchimp verifier evidence is incomplete."
              : "Mailchimp runtime health is degraded before truth handoff."
        ),
        action: boundaryBlocked
          ? "repair_boundary_evidence"
          : verifierBlocked
            ? "collect_verifier_evidence"
            : health.failure.actionable || "retry_truth_handoff_after_backoff",
      },
    statusHandoff: {
      state: failureState === "clear"
        ? "truth-ready"
        : degradedMode
          ? "truth-degraded"
          : "truth-blocked",
      clientStatusPath: boundaryScope.statusPath,
      requestId: boundaryScope.requestId,
      nextAction: failureState === "clear"
        ? evaluation.runtimeHandoff.nextAction
        : retryable
          ? "schedule_truth_retry"
          : "surface_truth_error_to_operator",
    },
  };
}

function normalizeProviderServiceState(packageAnalysis, operation, boundaryScope, recovery) {
  const providerContract = packageAnalysis.runtimeContract?.providerServiceNegotiation
    || packageAnalysis.providerServiceNegotiation
    || {};
  const transitionPlan = packageAnalysis.runtimeContract?.clientStatusTransitionPlan
    || packageAnalysis.clientStatusTransitionPlan
    || {};
  const checkpointPlan = packageAnalysis.runtimeContract?.adapterRecoveryCheckpointPlan
    || packageAnalysis.adapterRecoveryCheckpointPlan
    || {};
  const providerRow = (providerContract.rows || []).find((row) => row.operationId === operation.id) || {};
  const transitionRow = (transitionPlan.rows || []).find((row) => row.operationId === operation.id) || {};
  const checkpointRow = (checkpointPlan.rows || []).find((row) => row.operationId === operation.id) || {};
  const providerStatusPath = compactString(
    providerRow.providerStatusPath || transitionRow.providerStatusPath,
    `${boundaryScope.statusPath || `mailchimp.operations.${operation.id}.status`}.provider.mailchimp`,
  );
  const metadataReady = Boolean(
    providerRow.requestId || boundaryScope.requestId,
  ) && Boolean(
    providerRow.clientStatusPath || boundaryScope.statusPath,
  ) && Boolean(providerStatusPath);
  const boundaryReady = boundaryScope.accepted === true;
  const providerBlocked = [
    "metadata-incomplete",
    "boundary-blocked",
    "adapter-failed",
  ].includes(providerRow.status) || String(providerRow.status || "").startsWith("lifecycle-");
  const checkpointBlocked = checkpointRow.status === "blocked"
    || checkpointRow.status === "operator-review";
  const transitionBlocked = transitionRow.status === "blocked";
  const transitionMissing = transitionPlan.planKey && !transitionRow.transitionToken;
  const retryable = recovery.retryable === true || providerRow.retryable === true;
  const degraded = recovery.degradedMode === true || providerRow.degradedMode === true;
  const status = !metadataReady
    ? "metadata-incomplete"
    : transitionMissing
      ? "client-transition-missing"
      : transitionBlocked
        ? `client-transition-${transitionRow.blockedReason || "blocked"}`
    : checkpointBlocked
      ? `recovery-checkpoint-${checkpointRow.status || "blocked"}`
    : !boundaryReady
      ? "boundary-blocked"
      : providerBlocked
        ? providerRow.status
        : degraded
          ? "provider-degraded"
          : retryable
            ? "provider-retry-scheduled"
            : operation.externalWrite
              ? "external-write-contract-ready"
              : "read-contract-ready";
  const acceptedForClient = metadataReady
    && boundaryReady
    && !transitionMissing
    && !transitionBlocked
    && !checkpointBlocked
    && !providerBlocked
    && !degraded
    && recovery.failureState === "clear";

  return {
    format: "aios.mailchimp.truth.providerServiceState.v1",
    provider: "mailchimp",
    service: compactString(providerRow.service || operation.adapter, "mailchimp"),
    operationId: operation.id,
    packageSyncKey: providerContract.syncKey || null,
    status,
    acceptedForClient,
    metadataReady,
    negotiable: providerRow.negotiable === true && acceptedForClient,
    requestId: providerRow.requestId || boundaryScope.requestId || null,
    clientStatusPath: providerRow.clientStatusPath || boundaryScope.statusPath || null,
    providerStatusPath,
    boundaryStatusPath: providerRow.boundaryStatusPath || boundaryScope.boundaryStatusPath || null,
    snapshotKey: providerRow.snapshotKey || null,
    ledgerKey: providerRow.ledgerKey || null,
    idempotencyKeyPresent: Boolean(providerRow.idempotencyKey),
    externalCapabilities: providerRow.externalCapabilities || [],
    delegatedCapabilities: providerRow.delegatedCapabilities || [],
    packageStatus: providerContract.status || "unknown",
    packageHandoffState: providerContract.externalHandoff?.state || "unknown",
    clientStatusTransition: {
      planKey: transitionPlan.planKey || null,
      transitionToken: transitionRow.transitionToken || null,
      status: transitionRow.status || (transitionMissing ? "missing" : "unknown"),
      currentState: transitionRow.currentState || null,
      targetState: transitionRow.targetState || null,
      visibleState: transitionRow.visibleState || null,
      blockedReason: transitionRow.blockedReason || "",
      statusPatch: transitionRow.statusPatch || null,
      commands: transitionRow.commands || [],
      replaySafe: transitionRow.replaySafe === true,
      nextAction: transitionRow.nextAction || transitionPlan.nextAction || null,
    },
    adapterRecoveryCheckpoint: {
      planKey: checkpointPlan.planKey || null,
      checkpointId: checkpointRow.checkpointId || null,
      status: checkpointRow.status || "unknown",
      replaySafe: checkpointRow.replaySafe === true,
      blockedBy: checkpointRow.blockedBy || [],
      pendingBy: checkpointRow.pendingBy || [],
      nextAction: checkpointRow.nextAction || checkpointPlan.nextAction || null,
    },
    backoff: providerRow.backoff || recovery.backoff,
    nextAction: !metadataReady
      ? "repair_provider_sync_metadata"
      : transitionMissing
        ? "repair_client_status_transition_plan"
        : transitionBlocked
          ? transitionRow.nextAction || "repair_client_status_transition"
      : checkpointBlocked
        ? checkpointRow.nextAction || checkpointPlan.nextAction || "repair_adapter_recovery_checkpoint"
      : !boundaryReady
        ? "repair_truth_boundary_evidence"
        : providerBlocked
          ? providerRow.handoffState?.nextAction || providerContract.externalHandoff?.nextAction || "repair_provider_contract"
          : degraded
            ? "poll_mailchimp_provider_status"
            : retryable
              ? "schedule_provider_status_poll"
              : operation.externalWrite
                ? "accept_external_write_provider_contract"
                : "accept_read_provider_contract",
  };
}

function verifierSourceForOperation(operation) {
  const rules = operation.verifierNames.length
    ? operation.verifierNames.map((name) => ({
      id: `mailchimp.${name}.present`,
      path: `verifierEvidence.${name}`,
      predicate: "truthy",
      severity: "error",
      message: `Verifier evidence "${name}" is required before Mailchimp handoff.`,
    }))
    : [];

  if (operation.externalWrite) {
    rules.push({
      id: "mailchimp.external-write.approved",
      path: "approval.externalWrite",
      predicate: "isTrueWhenWrite",
      severity: "error",
      message: "External Mailchimp writes require approval evidence.",
    });
  }

  return { rules };
}

function evaluateOperationTruth(operation, evidence, options) {
  const packageAnalysis = options.packageAnalysis || {};
  const boundaryScope = normalizeBoundaryScope(packageAnalysis, operation, evidence, options);
  const verifier = compileMailchimpVerifier(verifierSourceForOperation(operation), {
    requireApprovalToken: operation.externalWrite,
    runtimeAdapter: options.runtimeAdapter,
  });
  const candidate = {
    ...evidence.candidate,
    verifierEvidence: evidence.verifierEvidence,
    approval: evidence.approval,
  };
  const evaluation = evaluateMailchimpVerifier(verifier, candidate, {
    hasExternalWrite: operation.externalWrite,
    approvalTokenAccepted: evidence.approval?.externalWrite === true,
  });
  const health = healthForOperation(evidence.runtimeHealth || {}, operation);
  const claims = [
    {
      id: `claim:${operation.id}:source`,
      status: "declared",
      boundary: operation.externalWrite ? "external-write" : "local-read",
      externalFactsChecked: false,
    },
    {
      id: `claim:${operation.id}:evidence`,
      status: evaluation.status === "pass" ? "verified" : "needs-evidence",
      boundary: "local-verifier",
      externalFactsChecked: evidence.externalFactsChecked,
    },
    {
      id: `claim:${operation.id}:tenant-boundary`,
      status: boundaryScope.checks.tenantMatches && boundaryScope.checks.workspaceMatches ? "verified" : "needs-evidence",
      boundary: "tenant-workspace",
      externalFactsChecked: evidence.externalFactsChecked,
    },
    {
      id: `claim:${operation.id}:permission-boundary`,
      status: boundaryScope.checks.roleMatches && boundaryScope.checks.auditReady ? "verified" : "needs-evidence",
      boundary: "role-permission",
      externalFactsChecked: evidence.externalFactsChecked,
    },
  ];
  const boundaryBlocked = !boundaryScope.accepted;
  const recovery = buildOperationalRecovery(operation, boundaryScope, evaluation, health);
  const providerService = normalizeProviderServiceState(packageAnalysis, operation, boundaryScope, recovery);

  return {
    operationId: operation.id,
    externalWrite: operation.externalWrite,
    boundaryScope,
    verifier,
    evaluation,
    health,
    recovery,
    providerService,
    claims,
    gate: {
      status: providerService.acceptedForClient
        && !boundaryBlocked
        && !recovery.degradedMode
        && !health.retry.exhausted
        && (evaluation.readiness.acceptedForExternalWrite || (!operation.externalWrite && evaluation.readiness.acceptedForRuntime))
        ? "ready"
        : "blocked",
      nextAction: boundaryBlocked
        ? !boundaryScope.checks.tenantMatches || !boundaryScope.checks.workspaceMatches
          ? "collect_tenant_workspace_evidence"
          : !boundaryScope.checks.roleMatches
            ? "collect_actor_permission_evidence"
            : !boundaryScope.checks.auditReady
              ? "attach_audit_correlation"
              : boundaryScope.clientRuntimeAdoption?.nextAction || "repair_client_runtime_adoption_evidence"
        : providerService.status === "metadata-incomplete"
          ? "repair_provider_sync_metadata"
          : providerService.acceptedForClient === false && providerService.status !== "read-contract-ready" && providerService.status !== "external-write-contract-ready"
            ? providerService.nextAction
            : recovery.statusHandoff.nextAction,
      missingClientState: evaluation.runtimeHandoff.missingClientState,
      requiresExternalFactCheck: operation.externalWrite && evidence.externalFactsChecked !== true,
      handoffStatus: providerService.acceptedForClient
        ? recovery.statusHandoff.state || evaluation.runtimeHandoff.handoffStatus
        : providerService.status,
      degradedMode: recovery.degradedMode,
      retryable: recovery.retryable,
      backoff: recovery.backoff,
      actionableError: recovery.actionableError,
      auditHandoff: {
        required: operation.externalWrite,
        correlationId: boundaryScope.auditCorrelationId,
        status: boundaryScope.checks.auditReady ? "audit-ready" : "audit-missing",
        auditChannel: boundaryScope.auditChannel || null,
        boundaryKey: boundaryScope.boundaryKey || null,
      },
    },
  };
}

function buildTruthBoundaryTimeline(operations, diagnostics) {
  const diagnosticsByOperation = new Map();
  for (const diagnostic of diagnostics) {
    if (!diagnostic.operationId) {
      continue;
    }
    const existing = diagnosticsByOperation.get(diagnostic.operationId) || [];
    existing.push(diagnostic);
    diagnosticsByOperation.set(diagnostic.operationId, existing);
  }

  return operations.map((operation, index) => {
    const operationDiagnostics = diagnosticsByOperation.get(operation.operationId) || [];
    const boundaryScope = operation.boundaryScope || {};
    const firstError = operationDiagnostics.find((diagnostic) => diagnostic.severity === "error") || null;
    return {
      index,
      operationId: operation.operationId,
      boundaryKey: boundaryScope.boundaryKey || null,
      status: operation.gate.status,
      handoffStatus: operation.gate.handoffStatus,
      failureState: operation.recovery.failureState,
      nextAction: operation.gate.nextAction,
      requiredTenant: boundaryScope.requiredTenant || null,
      requiredWorkspace: boundaryScope.requiredWorkspace || null,
      observedTenant: boundaryScope.observedTenant,
      observedWorkspace: boundaryScope.observedWorkspace,
      observedActorRole: boundaryScope.observedActorRole,
      allowedRoles: boundaryScope.allowedRoles || [],
      auditCorrelationId: boundaryScope.auditCorrelationId,
      auditChannel: boundaryScope.auditChannel || null,
      statusPath: boundaryScope.statusPath || null,
      boundaryStatusPath: boundaryScope.boundaryStatusPath || null,
      degradedMode: operation.recovery.degradedMode,
      retryable: operation.recovery.retryable,
      retryDelayMs: operation.recovery.backoff.nextDelayMs,
      diagnosticCount: operationDiagnostics.length,
      firstErrorCode: firstError?.code || "",
      providerStatus: operation.providerService?.status || "unknown",
      providerStatusPath: operation.providerService?.providerStatusPath || null,
      recoveryCheckpointStatus: operation.providerService?.adapterRecoveryCheckpoint?.status || "unknown",
      recoveryCheckpointId: operation.providerService?.adapterRecoveryCheckpoint?.checkpointId || null,
      recoveryCheckpointReplaySafe: operation.providerService?.adapterRecoveryCheckpoint?.replaySafe === true,
      clientTransitionStatus: operation.providerService?.clientStatusTransition?.status || "unknown",
      clientTransitionToken: operation.providerService?.clientStatusTransition?.transitionToken || null,
      clientTransitionState: operation.providerService?.clientStatusTransition?.visibleState || null,
      clientTransitionBlockedReason: operation.providerService?.clientStatusTransition?.blockedReason || "",
      adoptionKey: boundaryScope.clientRuntimeAdoption?.adoptionKey || null,
      adoptionStatus: boundaryScope.clientRuntimeAdoption?.status || "unknown",
      adoptionAccepted: boundaryScope.clientRuntimeAdoption?.acceptedForClient === true,
      adoptionProviderStatusPath: boundaryScope.clientRuntimeAdoption?.providerStatusPath || null,
    };
  });
}

function buildTruthBoundaryExportSummary(packageInfo, operations, diagnostics, timeline) {
  const blockedRows = timeline.filter((row) => row.status === "blocked");
  const degradedRows = timeline.filter((row) => row.degradedMode);
  const retryableRows = timeline.filter((row) => row.retryable);
  const readyRows = timeline.filter((row) => row.status === "ready");

  return {
    format: "aios.mailchimp.truthBoundary.report.v1",
    packageId: packageInfo?.id || null,
    provider: "mailchimp",
    status: blockedRows.length
      ? "blocked"
      : degradedRows.length
        ? "degraded"
        : "export-ready",
    counters: {
      operationCount: operations.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      degraded: degradedRows.length,
      retryable: retryableRows.length,
      diagnostics: diagnostics.length,
      auditRequired: operations.filter((operation) => operation.gate.auditHandoff.required).length,
      auditReady: operations.filter((operation) => operation.gate.auditHandoff.status === "audit-ready").length,
      tenantMismatches: operations.filter((operation) => !operation.boundaryScope.checks.tenantMatches).length,
      workspaceMismatches: operations.filter((operation) => !operation.boundaryScope.checks.workspaceMatches).length,
      roleMismatches: operations.filter((operation) => !operation.boundaryScope.checks.roleMatches).length,
    },
    rows: timeline.map((row) => ({
      operationId: row.operationId,
      boundaryKey: row.boundaryKey,
      status: row.status,
      failureState: row.failureState,
      nextAction: row.nextAction,
      requiredTenant: row.requiredTenant,
      requiredWorkspace: row.requiredWorkspace,
      observedActorRole: row.observedActorRole,
      auditCorrelationId: row.auditCorrelationId,
      boundaryStatusPath: row.boundaryStatusPath,
      retryDelayMs: row.retryDelayMs,
      providerStatus: row.providerStatus,
      providerStatusPath: row.providerStatusPath,
      recoveryCheckpointStatus: row.recoveryCheckpointStatus,
      recoveryCheckpointId: row.recoveryCheckpointId,
      clientTransitionStatus: row.clientTransitionStatus,
      clientTransitionState: row.clientTransitionState,
      clientTransitionBlockedReason: row.clientTransitionBlockedReason,
    })),
    blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    retryableOperationIds: retryableRows.map((row) => row.operationId).sort(),
  };
}

function buildTruthBoundaryPreview(packageAnalysis, operations, diagnostics, timeline) {
  const lifecycleByOperation = new Map((packageAnalysis.runtimeContract?.lifecycleVisibility || []).map((entry) => [entry.operationId, entry]));
  const diagnosticsByOperation = new Map();
  for (const diagnostic of diagnostics) {
    const key = diagnostic.operationId || "*";
    const existing = diagnosticsByOperation.get(key) || [];
    existing.push(diagnostic);
    diagnosticsByOperation.set(key, existing);
  }

  const rows = operations.map((operation) => {
    const lifecycle = lifecycleByOperation.get(operation.operationId) || {};
    const row = timeline.find((entry) => entry.operationId === operation.operationId) || {};
    const operationDiagnostics = diagnosticsByOperation.get(operation.operationId) || [];
    const errors = operationDiagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const warnings = operationDiagnostics.filter((diagnostic) => diagnostic.severity === "warning");
    const lifecycleBlocked = ["settings-blocked", "disabled", "health-paused", "adapter-failed"].includes(lifecycle.status);
    const providerBlocked = operation.providerService?.acceptedForClient === false
      && !["read-contract-ready", "external-write-contract-ready"].includes(operation.providerService?.status);
    const clientTransitionBlocked = String(operation.providerService?.status || "").startsWith("client-transition-")
      || operation.providerService?.clientStatusTransition?.status === "blocked";
    const recoveryCheckpointBlocked = String(operation.providerService?.status || "").startsWith("recovery-checkpoint-");
    const accepted = operation.gate.status === "ready"
      && errors.length === 0
      && !lifecycleBlocked
      && !providerBlocked
      && !clientTransitionBlocked
      && !recoveryCheckpointBlocked
      && operation.boundaryScope.accepted === true;
    const readiness = accepted
      ? "accepted"
      : lifecycleBlocked
        ? "lifecycle-blocked"
        : clientTransitionBlocked
        ? "client-transition-blocked"
        : recoveryCheckpointBlocked
          ? "recovery-checkpoint-blocked"
        : providerBlocked
          ? "provider-contract-blocked"
        : errors.length
          ? "needs-repair"
          : warnings.length
            ? "needs-review"
            : "waiting-for-evidence";

    return {
      operationId: operation.operationId,
      previewId: `truth-preview:${operation.operationId}:${row.boundaryKey || "boundary"}`,
      title: compactString(operation.verifier?.id, `Mailchimp ${operation.operationId}`),
      accepted,
      readiness,
      status: operation.gate.status,
      handoffStatus: operation.gate.handoffStatus,
      lifecycleStatus: lifecycle.status || "unknown",
      lifecycleNextAction: lifecycle.nextAction || null,
      providerStatus: operation.providerService?.status || "unknown",
      providerStatusPath: operation.providerService?.providerStatusPath || null,
      providerPackageSyncKey: operation.providerService?.packageSyncKey || null,
      recoveryCheckpointStatus: operation.providerService?.adapterRecoveryCheckpoint?.status || "unknown",
      recoveryCheckpointId: operation.providerService?.adapterRecoveryCheckpoint?.checkpointId || null,
      recoveryCheckpointReplaySafe: operation.providerService?.adapterRecoveryCheckpoint?.replaySafe === true,
      clientTransition: {
        planKey: operation.providerService?.clientStatusTransition?.planKey || null,
        transitionToken: operation.providerService?.clientStatusTransition?.transitionToken || null,
        status: operation.providerService?.clientStatusTransition?.status || "unknown",
        currentState: operation.providerService?.clientStatusTransition?.currentState || null,
        targetState: operation.providerService?.clientStatusTransition?.targetState || null,
        visibleState: operation.providerService?.clientStatusTransition?.visibleState || null,
        blockedReason: operation.providerService?.clientStatusTransition?.blockedReason || "",
        replaySafe: operation.providerService?.clientStatusTransition?.replaySafe === true,
        nextAction: operation.providerService?.clientStatusTransition?.nextAction || null,
      },
      adoptionKey: operation.boundaryScope.clientRuntimeAdoption?.adoptionKey || null,
      adoptionStatus: operation.boundaryScope.clientRuntimeAdoption?.status || "unknown",
      adoptionAccepted: operation.boundaryScope.clientRuntimeAdoption?.acceptedForClient === true,
      visibleToOperator: operation.externalWrite || lifecycle.operatorVisible === true || readiness !== "accepted",
      validationSummary: {
        errorCount: errors.length,
        warningCount: warnings.length,
        firstErrorCode: errors[0]?.code || "",
        firstWarningCode: warnings[0]?.code || "",
      },
      boundary: {
        requiredTenant: operation.boundaryScope.requiredTenant,
        requiredWorkspace: operation.boundaryScope.requiredWorkspace,
        observedTenant: operation.boundaryScope.observedTenant,
        observedWorkspace: operation.boundaryScope.observedWorkspace,
        observedActorRole: operation.boundaryScope.observedActorRole,
        auditCorrelationId: operation.boundaryScope.auditCorrelationId,
      },
      clientHandoff: {
        requestId: operation.boundaryScope.requestId,
        statusPath: operation.boundaryScope.statusPath || lifecycle.clientStatusPath || null,
        boundaryStatusPath: operation.boundaryScope.boundaryStatusPath || lifecycle.boundaryStatusPath || null,
        providerStatusPath: operation.providerService?.providerStatusPath || operation.boundaryScope.clientRuntimeAdoption?.providerStatusPath || null,
        statusPatch: operation.providerService?.clientStatusTransition?.statusPatch || null,
        transitionToken: operation.providerService?.clientStatusTransition?.transitionToken || null,
        adoptionKey: operation.boundaryScope.clientRuntimeAdoption?.adoptionKey || null,
        nextAction: accepted
          ? operation.gate.nextAction
          : lifecycleBlocked
            ? lifecycle.nextAction || "repair_lifecycle_visibility"
            : clientTransitionBlocked
              ? operation.providerService?.clientStatusTransition?.nextAction || operation.providerService?.nextAction || "repair_client_status_transition"
            : recoveryCheckpointBlocked
              ? operation.providerService?.adapterRecoveryCheckpoint?.nextAction || operation.providerService?.nextAction || "repair_adapter_recovery_checkpoint"
            : providerBlocked
              ? operation.providerService?.nextAction || "repair_provider_contract"
              : !operation.boundaryScope.checks.adoptionReady
                ? operation.boundaryScope.clientRuntimeAdoption?.nextAction || "repair_client_runtime_adoption_evidence"
            : operation.gate.nextAction || "collect_truth_evidence",
      },
      explain: [
        ...(!operation.boundaryScope.checks.tenantMatches ? ["tenant_scope_mismatch"] : []),
        ...(!operation.boundaryScope.checks.workspaceMatches ? ["workspace_scope_mismatch"] : []),
        ...(!operation.boundaryScope.checks.roleMatches ? ["actor_role_not_allowed"] : []),
        ...(!operation.boundaryScope.checks.auditReady ? ["audit_correlation_missing"] : []),
        ...(!operation.boundaryScope.checks.adoptionReady ? ["client_runtime_adoption_not_ready"] : []),
        ...(lifecycleBlocked ? [`lifecycle_${lifecycle.status}`] : []),
        ...(clientTransitionBlocked ? [`client_transition_${operation.providerService?.clientStatusTransition?.blockedReason || "blocked"}`] : []),
        ...(recoveryCheckpointBlocked ? [`recovery_checkpoint_${operation.providerService?.adapterRecoveryCheckpoint?.status || "blocked"}`] : []),
        ...(providerBlocked ? [`provider_${operation.providerService?.status || "blocked"}`] : []),
      ],
    };
  });
  const acceptedRows = rows.filter((row) => row.accepted);
  const blockedRows = rows.filter((row) => !row.accepted);

  return {
    format: "aios.mailchimp.truthBoundary.preview.v1",
    provider: "mailchimp",
    packageId: packageAnalysis.package?.id || null,
    status: blockedRows.length ? "needs-attention" : "accepted",
    accepted: blockedRows.length === 0,
    rows,
    counters: {
      operations: rows.length,
      accepted: acceptedRows.length,
      blocked: blockedRows.length,
      visibleToOperator: rows.filter((row) => row.visibleToOperator).length,
      lifecycleBlocked: rows.filter((row) => row.readiness === "lifecycle-blocked").length,
      providerBlocked: rows.filter((row) => row.readiness === "provider-contract-blocked").length,
      clientTransitionBlocked: rows.filter((row) => row.readiness === "client-transition-blocked").length,
      recoveryCheckpointBlocked: rows.filter((row) => row.readiness === "recovery-checkpoint-blocked").length,
      needsReview: rows.filter((row) => row.readiness === "needs-review").length,
    },
    nextAction: blockedRows[0]?.clientHandoff?.nextAction || "accept_truth_boundary_preview",
  };
}

export function analyzeMailchimpTruthBoundary(source = {}, evidenceInput = {}, options = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : analyzeMailchimpPackage(source, options);
  const evidence = normalizeEvidence(evidenceInput);
  const operations = packageAnalysis.operations.map((operation) => evaluateOperationTruth(operation, evidence, {
    ...options,
    packageAnalysis,
  }));
  const diagnostics = operations.flatMap((operation) => [
    ...operation.evaluation.findings.map((finding) => ({
      severity: finding.severity,
      code: `truth.${finding.ruleId}`,
      message: finding.message,
      field: finding.path,
      operationId: operation.operationId,
    })),
    ...(operation.gate.requiresExternalFactCheck ? [{
      severity: "warning",
      code: "truth.external_fact_check_missing",
      message: `Operation ${operation.operationId} writes Mailchimp state without recorded external fact verification.`,
      field: "evidence.externalFactsChecked",
      operationId: operation.operationId,
    }] : []),
    ...(!operation.boundaryScope.checks.tenantMatches ? [{
      severity: "error",
      code: "truth.tenant_scope_mismatch",
      message: `Operation ${operation.operationId} evidence does not match the Mailchimp tenant boundary.`,
      field: "evidence.tenant",
      operationId: operation.operationId,
    }] : []),
    ...(!operation.boundaryScope.checks.workspaceMatches ? [{
      severity: "error",
      code: "truth.workspace_scope_mismatch",
      message: `Operation ${operation.operationId} evidence does not match the Mailchimp workspace boundary.`,
      field: "evidence.workspace",
      operationId: operation.operationId,
    }] : []),
    ...(!operation.boundaryScope.checks.roleMatches ? [{
      severity: "error",
      code: "truth.actor_role_not_allowed",
      message: `Operation ${operation.operationId} actor role is outside the allowed Mailchimp handoff roles.`,
      field: "evidence.actorRole",
      operationId: operation.operationId,
    }] : []),
    ...(!operation.boundaryScope.checks.auditReady ? [{
      severity: "warning",
      code: "truth.audit_correlation_missing",
      message: `Operation ${operation.operationId} requires an audit correlation id before external Mailchimp handoff.`,
      field: "evidence.auditCorrelationId",
      operationId: operation.operationId,
    }] : []),
    ...(!operation.boundaryScope.checks.adoptionReady ? [{
      severity: "error",
      code: "truth.client_runtime_adoption_not_ready",
      message: `Operation ${operation.operationId} client runtime adoption evidence does not match the compiled Mailchimp handoff envelope.`,
      field: "evidence.clientRuntimeAdoption",
      operationId: operation.operationId,
      action: operation.boundaryScope.clientRuntimeAdoption?.nextAction || "repair_client_runtime_adoption_evidence",
    }] : []),
    ...(String(operation.providerService?.status || "").startsWith("client-transition-")
      || operation.providerService?.clientStatusTransition?.status === "blocked"
      ? [{
        severity: "error",
        code: "truth.client_status_transition_blocked",
        message: `Operation ${operation.operationId} cannot publish the Mailchimp client status transition required for truth handoff.`,
        field: "package.runtimeContract.clientStatusTransitionPlan",
        operationId: operation.operationId,
        action: operation.providerService?.clientStatusTransition?.nextAction
          || operation.providerService?.nextAction
          || "repair_client_status_transition",
        transitionToken: operation.providerService?.clientStatusTransition?.transitionToken || null,
        blockedReason: operation.providerService?.clientStatusTransition?.blockedReason || "",
      }]
      : []),
    ...(operation.providerService?.status === "client-transition-missing" ? [{
      severity: "error",
      code: "truth.client_status_transition_missing",
      message: `Operation ${operation.operationId} has provider negotiation metadata but no matching client status transition row.`,
      field: "package.runtimeContract.clientStatusTransitionPlan.rows",
      operationId: operation.operationId,
      action: "repair_client_status_transition_plan",
    }] : []),
    ...(operation.recovery.actionableError ? [{
      severity: operation.recovery.actionableError.severity,
      code: operation.recovery.actionableError.code,
      message: operation.recovery.actionableError.message,
      field: "runtime.health",
      operationId: operation.operationId,
      action: operation.recovery.actionableError.action,
    }] : []),
  ]);
  const blocked = operations.filter((operation) => operation.gate.status === "blocked");
  const boundaryBlocked = operations.filter((operation) => !operation.boundaryScope.accepted);
  const degraded = operations.filter((operation) => operation.recovery.degradedMode);
  const retryable = operations.filter((operation) => operation.recovery.retryable);
  const clientTransitionBlocked = operations.filter((operation) => (
    String(operation.providerService?.status || "").startsWith("client-transition-")
    || operation.providerService?.clientStatusTransition?.status === "blocked"
  ));
  const timeline = buildTruthBoundaryTimeline(operations, diagnostics);
  const exportSummary = buildTruthBoundaryExportSummary(packageAnalysis.package, operations, diagnostics, timeline);
  const preview = buildTruthBoundaryPreview(packageAnalysis, operations, diagnostics, timeline);

  return {
    kind: "aios.semantic.truthBoundaryAnalysis",
    provider: "mailchimp",
    package: packageAnalysis.package,
    operations,
    diagnostics,
    summary: {
      operationCount: operations.length,
      blockedOperationCount: blocked.length,
      boundaryBlockedOperationCount: boundaryBlocked.length,
      degradedOperationCount: degraded.length,
      retryableOperationCount: retryable.length,
      clientTransitionBlockedOperationCount: clientTransitionBlocked.length,
      warningCount: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
      status: blocked.length ? "blocked" : "ready",
      nextAction: blocked.length
        ? compactString(blocked[0].gate.nextAction, "collect_truth_evidence")
        : packageAnalysis.summary?.nextAction || "handoff_to_runtime_adapter",
      auditHandoffRequiredCount: operations.filter((operation) => operation.gate.auditHandoff.required).length,
      auditReadyCount: operations.filter((operation) => operation.gate.auditHandoff.status === "audit-ready").length,
      adoptionReadyCount: operations.filter((operation) => operation.boundaryScope.checks.adoptionReady).length,
      adoptionBlockedCount: operations.filter((operation) => !operation.boundaryScope.checks.adoptionReady).length,
      retryBackoffMs: retryable.length
        ? Math.min(...retryable.map((operation) => operation.recovery.backoff.nextDelayMs).filter((delay) => delay > 0))
        : 0,
      failureStates: [...new Set(operations.map((operation) => operation.recovery.failureState))].sort(),
      exportStatus: exportSummary.status,
      previewStatus: preview.status,
      previewAccepted: preview.accepted,
    },
    timeline,
    preview,
    exportSummary,
  };
}

export function summarizeMailchimpTruthClaims(truthAnalysis) {
  const claims = (truthAnalysis?.operations || []).flatMap((operation) => operation.claims || []);
  return {
    provider: "mailchimp",
    total: claims.length,
    verified: claims.filter((claim) => claim.status === "verified").length,
    externalWriteClaims: claims.filter((claim) => claim.boundary === "external-write").length,
    tenantBoundaryClaims: claims.filter((claim) => claim.boundary === "tenant-workspace").length,
    permissionBoundaryClaims: claims.filter((claim) => claim.boundary === "role-permission").length,
    needsEvidence: claims.filter((claim) => claim.status === "needs-evidence").map((claim) => claim.id),
    degradedOperations: (truthAnalysis?.operations || [])
      .filter((operation) => operation.recovery?.degradedMode)
      .map((operation) => operation.operationId)
      .sort(),
    retryableOperations: (truthAnalysis?.operations || [])
      .filter((operation) => operation.recovery?.retryable)
      .map((operation) => operation.operationId)
      .sort(),
  };
}

export default analyzeMailchimpTruthBoundary;
