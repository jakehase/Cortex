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
  const packageReceipt = operation.clientHandoffReceipt || {};
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
  const receipt = adoption.receipt
    || adoption.clientHandoffReceipt
    || byOperation.receipt
    || runtimeAdoption.receipt
    || {};
  const expectedReceiptId = compactString(packageReceipt.receiptId);
  const observedReceiptId = compactString(receipt.receiptId || receipt.id);
  const expectedProviderStatusPath = compactString(packageReceipt.client?.providerStatusPath || packageAdoption.client?.providerStatusPath);
  const observedProviderStatusPath = compactString(receipt.providerStatusPath || adoption.client?.providerStatusPath || adoption.providerStatusPath);
  const receiptMatches = (!expectedReceiptId || !observedReceiptId || expectedReceiptId === observedReceiptId)
    && (!packageReceipt.client?.statusPath || !receipt.clientStatusPath || packageReceipt.client.statusPath === receipt.clientStatusPath)
    && (!expectedProviderStatusPath || !observedProviderStatusPath || expectedProviderStatusPath === observedProviderStatusPath);
  const receiptReady = packageReceipt.acceptedForHandoff === true
    && packageReceipt.state !== "receipt-incomplete"
    && (packageReceipt.missingFields || []).length === 0;

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
    expectedReceiptId,
    observedReceiptId,
    receiptReady,
    receiptMatches,
    expectedProviderStatusPath,
    observedProviderStatusPath,
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
    && adoptionEvidence.handoffAllowed
    && adoptionEvidence.receiptReady
    && adoptionEvidence.receiptMatches;
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
      expectedReceiptId: adoptionEvidence.expectedReceiptId || null,
      observedReceiptId: adoptionEvidence.observedReceiptId || null,
      receiptReady: adoptionEvidence.receiptReady,
      receiptMatches: adoptionEvidence.receiptMatches,
      expectedProviderStatusPath: adoptionEvidence.expectedProviderStatusPath || null,
      observedProviderStatusPath: adoptionEvidence.observedProviderStatusPath || null,
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
  const externalHandoffLedger = packageAnalysis.runtimeContract?.externalProviderHandoffLedger
    || packageAnalysis.externalProviderHandoffLedger
    || {};
  const transitionPlan = packageAnalysis.runtimeContract?.clientStatusTransitionPlan
    || packageAnalysis.clientStatusTransitionPlan
    || {};
  const checkpointPlan = packageAnalysis.runtimeContract?.adapterRecoveryCheckpointPlan
    || packageAnalysis.adapterRecoveryCheckpointPlan
    || {};
  const restartJournal = packageAnalysis.runtimeContract?.restartJournal
    || packageAnalysis.restartJournal
    || {};
  const providerDeliveryAcknowledgementLedger = packageAnalysis.runtimeContract?.providerDeliveryAcknowledgementLedger
    || packageAnalysis.providerDeliveryAcknowledgementLedger
    || {};
  const providerRow = (providerContract.rows || []).find((row) => row.operationId === operation.id) || {};
  const externalHandoffRow = (externalHandoffLedger.rows || []).find((row) => row.operationId === operation.id) || {};
  const transitionRow = (transitionPlan.rows || []).find((row) => row.operationId === operation.id) || {};
  const checkpointRow = (checkpointPlan.rows || []).find((row) => row.operationId === operation.id) || {};
  const restartRow = (restartJournal.rows || []).find((row) => row.operationId === operation.id) || {};
  const providerDeliveryAckRow = (providerDeliveryAcknowledgementLedger.rows || []).find((row) => row.operationId === operation.id) || {};
  const providerDeliveryAckEvidence = providerDeliveryAckRow.evidenceAdapter
    || providerDeliveryAckRow.acknowledgement?.evidenceAdapter
    || {};
  const providerCallbackReceipt = providerDeliveryAckRow.callbackReceipt
    || providerDeliveryAckRow.acknowledgement?.callbackReceipt
    || providerDeliveryAckEvidence.callbackReceipt
    || {};
  const restartResolution = restartRow.statusResolution || {};
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
  const restartResolutionBlocked = restartResolution.status === "blocked"
    || restartResolution.status === "operator-review";
  const restartResolutionPending = restartResolution.status === "pending";
  const externalHandoffBlocked = externalHandoffRow.status === "blocked";
  const externalHandoffPending = externalHandoffRow.status === "pending";
  const providerDeliveryAckEvidenceBlocked = providerDeliveryAckEvidence.status === "blocked";
  const providerCallbackBlocked = providerCallbackReceipt.status === "blocked";
  const providerDeliveryAckEvidencePending = providerDeliveryAckEvidence.status === "awaiting-provider"
    || providerDeliveryAckEvidence.status === "not-ready";
  const providerDeliveryAckBlocked = providerDeliveryAckRow.status === "blocked"
    || providerDeliveryAckEvidenceBlocked
    || providerCallbackBlocked;
  const providerDeliveryAckPending = providerDeliveryAckRow.status === "pending"
    || providerDeliveryAckEvidencePending;
  const providerDeliveryAckRequired = providerDeliveryAckRow.required === true
    || externalHandoffRow.externalWrite === true
    || operation.externalWrite === true;
  const providerDeliveryAckMissing = providerDeliveryAckRequired
    && providerDeliveryAcknowledgementLedger.ledgerKey
    && !providerDeliveryAckRow.ackId;
  const providerDeliveryAckAccepted = !providerDeliveryAckRequired
    || providerDeliveryAckRow.acceptedForTruthHandoff === true
    || providerDeliveryAckRow.acknowledgement?.accepted === true
    || providerDeliveryAckEvidence.acceptedForTruthHandoff === true;
  const providerDeliveryAckEvidenceReady = !providerDeliveryAckRequired
    || providerDeliveryAckEvidence.status === "accepted"
    || providerDeliveryAckEvidence.status === "not-required"
    || providerDeliveryAckEvidence.acceptedForTruthHandoff === true;
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
    : restartResolutionBlocked
      ? `restart-resolution-${restartResolution.status || "blocked"}`
    : restartResolutionPending
      ? "restart-resolution-pending"
    : checkpointBlocked
      ? `recovery-checkpoint-${checkpointRow.status || "blocked"}`
    : externalHandoffBlocked
      ? "external-handoff-blocked"
    : externalHandoffPending
      ? "external-handoff-pending"
    : providerDeliveryAckMissing
      ? "provider-delivery-ack-missing"
    : providerDeliveryAckBlocked
      ? "provider-delivery-ack-blocked"
    : providerDeliveryAckPending
      ? "provider-delivery-ack-pending"
    : !providerDeliveryAckAccepted
      ? "provider-delivery-ack-required"
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
    && !restartResolutionBlocked
    && !restartResolutionPending
    && !checkpointBlocked
    && !externalHandoffBlocked
    && !externalHandoffPending
    && !providerDeliveryAckMissing
    && !providerDeliveryAckBlocked
    && !providerDeliveryAckPending
    && providerDeliveryAckAccepted
    && providerDeliveryAckEvidenceReady
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
    restartStatusResolution: {
      journalId: restartJournal.journalId || null,
      journalEntryId: restartRow.journalEntryId || null,
      resolutionId: restartResolution.resolutionId || null,
      status: restartResolution.status || "unknown",
      restartSafe: restartResolution.restartSafe === true,
      terminalState: restartResolution.terminalState || null,
      observedState: restartResolution.observed?.state || null,
      observedPatchId: restartResolution.observed?.patchId || null,
      expectedPatchId: restartResolution.expected?.patchId || restartRow.statusPatch?.patchId || null,
      commandEnabled: restartResolution.command?.enabled === true,
      blockedBy: restartResolution.blockedBy || [],
      pendingBy: restartResolution.pendingBy || [],
      nextAction: restartResolution.nextAction || restartRow.nextAction || restartJournal.nextAction || null,
    },
    externalProviderHandoff: {
      ledgerKey: externalHandoffLedger.ledgerKey || null,
      ledgerEntryId: externalHandoffRow.ledgerEntryId || null,
      status: externalHandoffRow.status || "unknown",
      acceptedForProviderHandoff: externalHandoffRow.acceptedForProviderHandoff === true,
      commandEnabled: externalHandoffRow.command?.enabled === true,
      idempotencyKeyPresent: Boolean(externalHandoffRow.idempotencyKey || externalHandoffRow.command?.idempotencyKey),
      blockedBy: externalHandoffRow.blockedBy || [],
      pendingBy: externalHandoffRow.pendingBy || [],
      statusPatch: externalHandoffRow.statusPatch || null,
      nextAction: externalHandoffRow.nextAction || externalHandoffLedger.nextAction || null,
    },
    providerDeliveryAcknowledgement: {
      ledgerKey: providerDeliveryAcknowledgementLedger.ledgerKey || null,
      ackId: providerDeliveryAckRow.ackId || null,
      status: providerDeliveryAckRow.status || (providerDeliveryAckRequired ? "missing" : "not-required"),
      required: providerDeliveryAckRequired,
      acceptedForTruthHandoff: providerDeliveryAckAccepted,
      expectedAckPath: providerDeliveryAckRow.expectedAckPath || providerDeliveryAckRow.acknowledgement?.expectedAckPath || null,
      commandEnabled: providerDeliveryAckRow.command?.enabled === true,
      patchable: providerDeliveryAckRow.acknowledgement?.statusPatch?.patchable === true,
      blockedBy: [
        ...(providerDeliveryAckRow.blockedBy || []),
        ...(providerDeliveryAckEvidence.blockedBy || []).map((blocker) => `evidence:${blocker}`),
        ...(providerDeliveryAckEvidence.missingObservedFields || []).map((field) => `evidence:missing:${field}`),
      ].sort(),
      pendingBy: [
        ...(providerDeliveryAckRow.pendingBy || []),
        ...(providerDeliveryAckEvidence.pendingBy || []).map((pending) => `evidence:${pending}`),
      ].sort(),
      evidence: {
        evidenceId: providerDeliveryAckEvidence.evidenceId || null,
        status: providerDeliveryAckEvidence.status || "unknown",
        acceptedForTruthHandoff: providerDeliveryAckEvidence.acceptedForTruthHandoff === true,
        missingObservedFields: providerDeliveryAckEvidence.missingObservedFields || [],
        blockedBy: providerDeliveryAckEvidence.blockedBy || [],
        pendingBy: providerDeliveryAckEvidence.pendingBy || [],
        expected: providerDeliveryAckEvidence.expected || null,
        observed: providerDeliveryAckEvidence.observed || null,
        safeToPoll: providerDeliveryAckEvidence.replay?.safeToPoll === true,
        dedupeKey: providerDeliveryAckEvidence.replay?.dedupeKey || null,
        handoffState: providerDeliveryAckEvidence.handoffState || null,
      },
      callbackReceipt: {
        present: providerCallbackReceipt.present === true,
        status: providerCallbackReceipt.status || "unknown",
        accepted: providerCallbackReceipt.accepted === true,
        metadataMatches: providerCallbackReceipt.metadataMatches === true,
        event: providerCallbackReceipt.event || null,
        providerDeliveryId: providerCallbackReceipt.providerDeliveryId || null,
        requestId: providerCallbackReceipt.requestId || null,
        idempotencyKeyPresent: Boolean(providerCallbackReceipt.idempotencyKey),
        providerStatusPath: providerCallbackReceipt.providerStatusPath || null,
        externalProviderHandoffEntryId: providerCallbackReceipt.externalProviderHandoffEntryId || null,
        receivedAt: providerCallbackReceipt.receivedAt || null,
        statusPatchId: providerCallbackReceipt.statusPatchId || null,
        missingFields: providerCallbackReceipt.missingFields || [],
        blockedBy: providerCallbackReceipt.blockedBy || [],
        nextAction: providerCallbackReceipt.nextAction || null,
      },
      statusPatch: providerDeliveryAckRow.acknowledgement?.statusPatch || null,
      nextAction: providerDeliveryAckRow.nextAction || providerDeliveryAcknowledgementLedger.nextAction || null,
    },
    backoff: providerRow.backoff || recovery.backoff,
    nextAction: !metadataReady
      ? "repair_provider_sync_metadata"
      : transitionMissing
        ? "repair_client_status_transition_plan"
      : transitionBlocked
        ? transitionRow.nextAction || "repair_client_status_transition"
      : restartResolutionBlocked
        ? restartResolution.nextAction || "repair_restart_status_resolution"
      : restartResolutionPending
        ? restartResolution.nextAction || "wait_for_restart_status_resolution"
      : checkpointBlocked
        ? checkpointRow.nextAction || checkpointPlan.nextAction || "repair_adapter_recovery_checkpoint"
      : externalHandoffBlocked
        ? externalHandoffRow.nextAction || externalHandoffLedger.nextAction || "repair_external_provider_handoff"
      : externalHandoffPending
        ? externalHandoffRow.nextAction || externalHandoffLedger.nextAction || "wait_for_external_provider_handoff"
      : providerDeliveryAckMissing
        ? "compile_provider_delivery_acknowledgement"
      : providerDeliveryAckBlocked
        ? providerDeliveryAckEvidence.handoffState?.nextAction
          || providerDeliveryAckRow.nextAction
          || providerDeliveryAcknowledgementLedger.nextAction
          || "repair_provider_delivery_acknowledgement"
      : providerDeliveryAckPending || !providerDeliveryAckAccepted
        ? providerDeliveryAckEvidence.handoffState?.nextAction
          || providerDeliveryAckRow.nextAction
          || providerDeliveryAcknowledgementLedger.nextAction
          || "wait_for_provider_delivery_acknowledgement"
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

function tenantPermissionEnforcementForOperation(packageAnalysis = {}, operation = {}) {
  const matrix = packageAnalysis.tenantPermissionEnforcementMatrix
    || packageAnalysis.runtimeContract?.tenantPermissionEnforcementMatrix
    || {};
  const row = (matrix.rows || []).find((entry) => entry.operationId === operation.id) || {};
  const releaseLedger = matrix.releaseLedger || {};
  const releaseRow = row.release
    || (releaseLedger.rows || []).find((entry) => entry.operationId === operation.id)
    || {};
  const blocked = row.status === "blocked";
  const pending = row.status === "pending";
  const releaseBlocked = releaseRow.status === "blocked";
  const releasePending = releaseRow.status === "pending";
  return {
    matrixKey: matrix.matrixKey || null,
    enforcementId: row.enforcementId || null,
    releaseLedgerKey: releaseLedger.ledgerKey || null,
    status: releaseBlocked
      ? "blocked"
      : releasePending
        ? "pending"
        : row.status || (matrix.matrixKey ? "missing-row" : "not-provided"),
    acceptedForTruth: row.acceptedForHandoff === true
      && !blocked
      && !pending
      && releaseRow.ready !== false
      && !releaseBlocked
      && !releasePending,
    boundaryKey: row.boundaryKey || operation.tenantPermissionBoundary?.boundaryKey || null,
    tenant: row.scope?.tenant || operation.tenantPermissionBoundary?.scope?.tenant || null,
    workspace: row.scope?.workspace || operation.tenantPermissionBoundary?.scope?.workspace || null,
    requiredRoles: row.roles?.required || operation.tenantPermissionBoundary?.allowedRoles || [],
    blockedBy: [
      ...(row.blockedBy || []),
      ...(releaseBlocked ? (releaseRow.blockedBy || ["release-blocked"]).map((blocker) => `release:${blocker}`) : []),
    ].sort(),
    pendingBy: [
      ...(row.pendingBy || []),
      ...(releasePending ? (releaseRow.pendingBy || ["release-pending"]).map((pendingItem) => `release:${pendingItem}`) : []),
    ].sort(),
    statusPatch: {
      patchId: row.statusPatch?.patchId || null,
      patchable: row.statusPatch?.patchable === true,
      statusPath: row.statusPatch?.statusPath || operation.runtimeClientState?.client?.statusPath || null,
      providerStatusPath: row.statusPatch?.providerStatusPath || null,
      state: row.statusPatch?.state || row.status || "unknown",
      nextAction: row.statusPatch?.nextAction || null,
    },
    release: {
      releaseId: releaseRow.releaseId || null,
      status: releaseRow.status || (releaseLedger.ledgerKey ? "missing-row" : "not-provided"),
      ready: releaseRow.ready === true,
      mode: releaseRow.mode || (operation.externalWrite ? "external-write-lease" : "delegated-read"),
      requestId: releaseRow.requestId || null,
      clientStatusPath: releaseRow.clientStatusPath || null,
      providerStatusPath: releaseRow.providerStatusPath || null,
      nextAction: releaseRow.nextAction || null,
    },
    nextAction: blocked || releaseBlocked
      ? releaseBlocked
        ? releaseRow.nextAction || "repair_tenant_permission_release"
        : row.nextAction || "repair_tenant_permission_enforcement"
      : pending || releasePending
        ? releasePending
          ? releaseRow.nextAction || "publish_tenant_permission_release_status"
          : row.nextAction || "wait_for_tenant_permission_enforcement"
        : row.enforcementId
          ? "accept_tenant_permission_enforcement"
          : "compile_tenant_permission_enforcement_matrix",
  };
}

function tenantBoundaryActionForOperation(packageAnalysis = {}, operation = {}) {
  const queue = packageAnalysis.tenantBoundaryActionQueue
    || packageAnalysis.runtimeContract?.tenantBoundaryActionQueue
    || {};
  const row = (queue.rows || []).find((entry) => entry.operationId === operation.id) || {};
  const status = row.status || (queue.queueKey ? "missing-row" : "not-provided");
  const blocked = status === "blocked";
  const pending = status === "pending";

  return {
    queueKey: queue.queueKey || null,
    queueId: row.queueId || null,
    status,
    acceptedForTruth: row.acceptedForRuntime === true
      && !blocked
      && !pending
      && row.statusPatch?.patchable !== false,
    action: row.action || "observe",
    boundaryKey: row.boundaryKey || operation.tenantPermissionBoundary?.boundaryKey || null,
    requestId: row.requestId || operation.runtimeClientState?.request?.requestId || null,
    clientStatusPath: row.clientStatusPath || operation.runtimeClientState?.client?.statusPath || null,
    providerStatusPath: row.providerStatusPath || null,
    scope: row.scope || {
      tenant: operation.tenantPermissionBoundary?.scope?.tenant || null,
      workspace: operation.tenantPermissionBoundary?.scope?.workspace || null,
      environment: operation.tenantPermissionBoundary?.scope?.environment || "production",
    },
    blockedBy: row.blockedBy || [],
    pendingBy: row.pendingBy || [],
    evidence: row.evidence || null,
    enforcement: row.enforcement || null,
    release: row.release || null,
    commandEnabled: (row.commands || []).some((command) => command.enabled === true),
    statusPatch: {
      patchId: row.statusPatch?.patchId || null,
      patchable: row.statusPatch?.patchable === true,
      statusPath: row.statusPatch?.statusPath || row.clientStatusPath || null,
      providerStatusPath: row.statusPatch?.providerStatusPath || row.providerStatusPath || null,
      state: row.statusPatch?.state || status,
      nextAction: row.statusPatch?.nextAction || null,
    },
    nextAction: blocked
      ? row.statusPatch?.nextAction || "repair_tenant_boundary_action"
      : pending
        ? row.statusPatch?.nextAction || "publish_tenant_boundary_action_status"
        : row.queueId
          ? "accept_tenant_boundary_action"
          : "compile_tenant_boundary_action_queue",
  };
}

function evaluateOperationTruth(operation, evidence, options) {
  const packageAnalysis = options.packageAnalysis || {};
  const boundaryScope = normalizeBoundaryScope(packageAnalysis, operation, evidence, options);
  const tenantPermissionEnforcement = tenantPermissionEnforcementForOperation(packageAnalysis, operation);
  const tenantBoundaryAction = tenantBoundaryActionForOperation(packageAnalysis, operation);
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
  const boundaryBlocked = !boundaryScope.accepted
    || tenantPermissionEnforcement.acceptedForTruth === false
    || tenantBoundaryAction.acceptedForTruth === false;
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
    tenantPermissionEnforcement,
    tenantBoundaryAction,
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
        ? tenantBoundaryAction.acceptedForTruth === false
          ? tenantBoundaryAction.nextAction
          : tenantPermissionEnforcement.acceptedForTruth === false
          ? tenantPermissionEnforcement.nextAction
          : !boundaryScope.checks.tenantMatches || !boundaryScope.checks.workspaceMatches
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
      restartStatusResolutionStatus: operation.providerService?.restartStatusResolution?.status || "unknown",
      restartStatusResolutionId: operation.providerService?.restartStatusResolution?.resolutionId || null,
      restartStatusResolutionSafe: operation.providerService?.restartStatusResolution?.restartSafe === true,
      restartStatusResolutionTerminalState: operation.providerService?.restartStatusResolution?.terminalState || null,
      restartStatusResolutionCommandEnabled: operation.providerService?.restartStatusResolution?.commandEnabled === true,
      externalHandoffStatus: operation.providerService?.externalProviderHandoff?.status || "unknown",
      externalHandoffEntryId: operation.providerService?.externalProviderHandoff?.ledgerEntryId || null,
      externalHandoffCommandEnabled: operation.providerService?.externalProviderHandoff?.commandEnabled === true,
      providerDeliveryAckStatus: operation.providerService?.providerDeliveryAcknowledgement?.status || "unknown",
      providerDeliveryAckId: operation.providerService?.providerDeliveryAcknowledgement?.ackId || null,
      providerDeliveryAckRequired: operation.providerService?.providerDeliveryAcknowledgement?.required === true,
      providerDeliveryAckAccepted: operation.providerService?.providerDeliveryAcknowledgement?.acceptedForTruthHandoff === true,
      providerDeliveryAckPath: operation.providerService?.providerDeliveryAcknowledgement?.expectedAckPath || null,
      providerDeliveryAckCommandEnabled: operation.providerService?.providerDeliveryAcknowledgement?.commandEnabled === true,
      providerDeliveryAckPatchable: operation.providerService?.providerDeliveryAcknowledgement?.patchable === true,
      tenantPermissionEnforcementId: operation.tenantPermissionEnforcement?.enforcementId || null,
      tenantPermissionStatus: operation.tenantPermissionEnforcement?.status || "unknown",
      tenantPermissionAccepted: operation.tenantPermissionEnforcement?.acceptedForTruth === true,
      tenantPermissionBlockedBy: operation.tenantPermissionEnforcement?.blockedBy || [],
      tenantPermissionPendingBy: operation.tenantPermissionEnforcement?.pendingBy || [],
      tenantPermissionStatusPatchable: operation.tenantPermissionEnforcement?.statusPatch?.patchable === true,
      tenantPermissionReleaseId: operation.tenantPermissionEnforcement?.release?.releaseId || null,
      tenantPermissionReleaseStatus: operation.tenantPermissionEnforcement?.release?.status || "unknown",
      tenantPermissionReleaseReady: operation.tenantPermissionEnforcement?.release?.ready === true,
      tenantBoundaryActionQueueId: operation.tenantBoundaryAction?.queueId || null,
      tenantBoundaryActionStatus: operation.tenantBoundaryAction?.status || "unknown",
      tenantBoundaryActionAccepted: operation.tenantBoundaryAction?.acceptedForTruth === true,
      tenantBoundaryActionBlockedBy: operation.tenantBoundaryAction?.blockedBy || [],
      tenantBoundaryActionPendingBy: operation.tenantBoundaryAction?.pendingBy || [],
      tenantBoundaryActionCommandEnabled: operation.tenantBoundaryAction?.commandEnabled === true,
      tenantBoundaryActionPatchable: operation.tenantBoundaryAction?.statusPatch?.patchable === true,
      clientTransitionStatus: operation.providerService?.clientStatusTransition?.status || "unknown",
      clientTransitionToken: operation.providerService?.clientStatusTransition?.transitionToken || null,
      clientTransitionState: operation.providerService?.clientStatusTransition?.visibleState || null,
      clientTransitionBlockedReason: operation.providerService?.clientStatusTransition?.blockedReason || "",
      adoptionKey: boundaryScope.clientRuntimeAdoption?.adoptionKey || null,
      adoptionStatus: boundaryScope.clientRuntimeAdoption?.status || "unknown",
      adoptionAccepted: boundaryScope.clientRuntimeAdoption?.acceptedForClient === true,
      adoptionProviderStatusPath: boundaryScope.clientRuntimeAdoption?.providerStatusPath || null,
      clientHandoffReceiptId: boundaryScope.clientRuntimeAdoption?.expectedReceiptId || null,
      observedClientHandoffReceiptId: boundaryScope.clientRuntimeAdoption?.observedReceiptId || null,
      clientHandoffReceiptMatches: boundaryScope.clientRuntimeAdoption?.receiptMatches === true,
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
      tenantPermissionAccepted: operations.filter((operation) => operation.tenantPermissionEnforcement?.acceptedForTruth).length,
      tenantPermissionBlocked: operations.filter((operation) => operation.tenantPermissionEnforcement?.status === "blocked").length,
      tenantPermissionPending: operations.filter((operation) => operation.tenantPermissionEnforcement?.status === "pending").length,
      tenantPermissionStatusPatchable: operations.filter((operation) => operation.tenantPermissionEnforcement?.statusPatch?.patchable).length,
      tenantPermissionReleaseReady: operations.filter((operation) => operation.tenantPermissionEnforcement?.release?.ready).length,
      tenantPermissionReleaseBlocked: operations.filter((operation) => operation.tenantPermissionEnforcement?.release?.status === "blocked").length,
      tenantPermissionReleasePending: operations.filter((operation) => operation.tenantPermissionEnforcement?.release?.status === "pending").length,
      tenantBoundaryActionAccepted: operations.filter((operation) => operation.tenantBoundaryAction?.acceptedForTruth).length,
      tenantBoundaryActionBlocked: operations.filter((operation) => operation.tenantBoundaryAction?.status === "blocked").length,
      tenantBoundaryActionPending: operations.filter((operation) => operation.tenantBoundaryAction?.status === "pending").length,
      tenantBoundaryActionPatchable: operations.filter((operation) => operation.tenantBoundaryAction?.statusPatch?.patchable).length,
      providerDeliveryAckRequired: operations.filter((operation) => operation.providerService?.providerDeliveryAcknowledgement?.required).length,
      providerDeliveryAckAccepted: operations.filter((operation) => operation.providerService?.providerDeliveryAcknowledgement?.acceptedForTruthHandoff).length,
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
      restartStatusResolutionStatus: row.restartStatusResolutionStatus,
      restartStatusResolutionId: row.restartStatusResolutionId,
      restartStatusResolutionSafe: row.restartStatusResolutionSafe,
      restartStatusResolutionTerminalState: row.restartStatusResolutionTerminalState,
      externalHandoffStatus: row.externalHandoffStatus,
      externalHandoffEntryId: row.externalHandoffEntryId,
      externalHandoffCommandEnabled: row.externalHandoffCommandEnabled,
      providerDeliveryAckStatus: row.providerDeliveryAckStatus,
      providerDeliveryAckId: row.providerDeliveryAckId,
      providerDeliveryAckRequired: row.providerDeliveryAckRequired,
      providerDeliveryAckAccepted: row.providerDeliveryAckAccepted,
      providerDeliveryAckPath: row.providerDeliveryAckPath,
      tenantPermissionEnforcementId: row.tenantPermissionEnforcementId,
      tenantPermissionStatus: row.tenantPermissionStatus,
      tenantPermissionAccepted: row.tenantPermissionAccepted,
      tenantPermissionBlockedBy: row.tenantPermissionBlockedBy,
      tenantPermissionPendingBy: row.tenantPermissionPendingBy,
      tenantPermissionStatusPatchable: row.tenantPermissionStatusPatchable,
      tenantPermissionReleaseId: row.tenantPermissionReleaseId,
      tenantPermissionReleaseStatus: row.tenantPermissionReleaseStatus,
      tenantPermissionReleaseReady: row.tenantPermissionReleaseReady,
      tenantBoundaryActionQueueId: row.tenantBoundaryActionQueueId,
      tenantBoundaryActionStatus: row.tenantBoundaryActionStatus,
      tenantBoundaryActionAccepted: row.tenantBoundaryActionAccepted,
      tenantBoundaryActionBlockedBy: row.tenantBoundaryActionBlockedBy,
      tenantBoundaryActionPendingBy: row.tenantBoundaryActionPendingBy,
      tenantBoundaryActionCommandEnabled: row.tenantBoundaryActionCommandEnabled,
      tenantBoundaryActionPatchable: row.tenantBoundaryActionPatchable,
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
  const lifecycleControlPlane = packageAnalysis.runtimeContract?.lifecycleControlPlane
    || packageAnalysis.lifecycleControlPlane
    || {};
  const lifecycleControlByOperation = new Map((lifecycleControlPlane.rows || []).map((entry) => [entry.operationId, entry]));
  const clientHandoffPlan = packageAnalysis.runtimeContract?.clientHandoffReadiness
    || packageAnalysis.clientHandoffReadiness
    || {};
  const clientHandoffByOperation = new Map((clientHandoffPlan.rows || []).map((entry) => [entry.operationId, entry]));
  const operatorNextActionState = packageAnalysis.runtimeContract?.operatorNextActionState
    || packageAnalysis.operatorNextActionState
    || {};
  const operatorNextActionByOperation = new Map((operatorNextActionState.rows || []).map((entry) => [entry.operationId, entry]));
  const diagnosticsByOperation = new Map();
  for (const diagnostic of diagnostics) {
    const key = diagnostic.operationId || "*";
    const existing = diagnosticsByOperation.get(key) || [];
    existing.push(diagnostic);
    diagnosticsByOperation.set(key, existing);
  }

  const rows = operations.map((operation) => {
    const lifecycle = lifecycleByOperation.get(operation.operationId) || {};
    const lifecycleControl = lifecycleControlByOperation.get(operation.operationId) || {};
    const clientHandoff = clientHandoffByOperation.get(operation.operationId) || {};
    const operatorNextAction = operatorNextActionByOperation.get(operation.operationId) || {};
    const row = timeline.find((entry) => entry.operationId === operation.operationId) || {};
    const operationDiagnostics = diagnosticsByOperation.get(operation.operationId) || [];
    const errors = operationDiagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const warnings = operationDiagnostics.filter((diagnostic) => diagnostic.severity === "warning");
    const lifecycleBlocked = ["settings-blocked", "disabled", "health-paused", "adapter-failed"].includes(lifecycle.status)
      || lifecycleControl.status === "blocked";
    const lifecyclePending = lifecycleControl.status === "pending";
    const operatorNextActionBlocked = operatorNextAction.status === "blocked";
    const operatorNextActionPending = operatorNextAction.status === "pending";
    const providerBlocked = operation.providerService?.acceptedForClient === false
      && !["read-contract-ready", "external-write-contract-ready"].includes(operation.providerService?.status);
    const clientTransitionBlocked = String(operation.providerService?.status || "").startsWith("client-transition-")
      || operation.providerService?.clientStatusTransition?.status === "blocked";
    const restartResolutionBlocked = String(operation.providerService?.status || "").startsWith("restart-resolution-blocked")
      || operation.providerService?.restartStatusResolution?.status === "blocked"
      || operation.providerService?.restartStatusResolution?.status === "operator-review";
    const restartResolutionPending = operation.providerService?.status === "restart-resolution-pending"
      || operation.providerService?.restartStatusResolution?.status === "pending";
    const recoveryCheckpointBlocked = String(operation.providerService?.status || "").startsWith("recovery-checkpoint-");
    const externalHandoffBlocked = operation.providerService?.status === "external-handoff-blocked";
    const externalHandoffPending = operation.providerService?.status === "external-handoff-pending";
    const providerDeliveryAckBlocked = operation.providerService?.status === "provider-delivery-ack-blocked"
      || operation.providerService?.status === "provider-delivery-ack-missing"
      || operation.providerService?.providerDeliveryAcknowledgement?.status === "blocked";
    const providerDeliveryAckPending = operation.providerService?.status === "provider-delivery-ack-pending"
      || operation.providerService?.status === "provider-delivery-ack-required"
      || operation.providerService?.providerDeliveryAcknowledgement?.status === "pending";
    const clientHandoffBlocked = clientHandoff.status === "blocked";
    const clientHandoffPending = clientHandoff.status === "pending";
    const accepted = operation.gate.status === "ready"
      && errors.length === 0
      && !lifecycleBlocked
      && !lifecyclePending
      && !providerBlocked
      && !clientTransitionBlocked
      && !restartResolutionBlocked
      && !restartResolutionPending
      && !recoveryCheckpointBlocked
      && !externalHandoffBlocked
      && !externalHandoffPending
      && !providerDeliveryAckBlocked
      && !providerDeliveryAckPending
      && !clientHandoffBlocked
      && !clientHandoffPending
      && !operatorNextActionBlocked
      && !operatorNextActionPending
      && operation.boundaryScope.accepted === true;
    const readiness = accepted
      ? "accepted"
      : lifecycleBlocked
        ? "lifecycle-blocked"
        : lifecyclePending
          ? "lifecycle-pending"
        : clientHandoffBlocked
          ? "client-handoff-blocked"
        : clientHandoffPending
          ? "client-handoff-pending"
        : operatorNextActionBlocked
          ? "operator-next-action-blocked"
        : operatorNextActionPending
          ? "operator-next-action-pending"
        : clientTransitionBlocked
        ? "client-transition-blocked"
        : restartResolutionBlocked
        ? "restart-resolution-blocked"
        : restartResolutionPending
          ? "restart-resolution-pending"
        : recoveryCheckpointBlocked
          ? "recovery-checkpoint-blocked"
        : externalHandoffBlocked
          ? "external-handoff-blocked"
        : externalHandoffPending
          ? "external-handoff-pending"
        : providerDeliveryAckBlocked
          ? "provider-delivery-ack-blocked"
        : providerDeliveryAckPending
          ? "provider-delivery-ack-pending"
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
      lifecycleControl: {
        controlPlaneId: lifecycleControlPlane.controlPlaneId || null,
        controlId: lifecycleControl.controlId || null,
        status: lifecycleControl.status || "unknown",
        blockedBy: lifecycleControl.blockedBy || [],
        pendingBy: lifecycleControl.pendingBy || [],
        operatorVisible: lifecycleControl.operatorVisible === true,
        schedule: lifecycleControl.schedule || null,
        commands: (lifecycleControl.commands || []).map((command) => ({
          command: command.command,
          enabled: command.enabled === true,
          patchId: command.statusPatch?.patchId || null,
          state: command.statusPatch?.state || "unknown",
          nextAction: command.statusPatch?.nextAction || null,
        })),
        nextAction: lifecycleControl.nextAction || null,
      },
      clientHandoffReadiness: {
        planKey: clientHandoffPlan.planKey || null,
        status: clientHandoff.status || "unknown",
        acceptedForClient: clientHandoff.acceptedForClient === true,
        visibleState: clientHandoff.visibleState || null,
        blockedBy: clientHandoff.blockedBy || [],
        pendingBy: clientHandoff.pendingBy || [],
        commands: clientHandoff.commands || [],
        nextAction: clientHandoff.nextAction || null,
      },
      operatorNextAction: {
        actionKey: operatorNextActionState.actionKey || null,
        actionId: operatorNextAction.actionId || null,
        status: operatorNextAction.status || "not-provided",
        visibleState: operatorNextAction.visibleState || null,
        acceptedForDispatch: operatorNextAction.acceptedForDispatch === true,
        blockedBy: operatorNextAction.blockedBy || [],
        pendingBy: operatorNextAction.pendingBy || [],
        statusPatch: operatorNextAction.statusPatch || null,
        commands: operatorNextAction.commands || [],
        linkedContracts: operatorNextAction.linkedContracts || null,
        nextAction: operatorNextAction.nextAction || null,
      },
      providerStatus: operation.providerService?.status || "unknown",
      providerStatusPath: operation.providerService?.providerStatusPath || null,
      providerPackageSyncKey: operation.providerService?.packageSyncKey || null,
      recoveryCheckpointStatus: operation.providerService?.adapterRecoveryCheckpoint?.status || "unknown",
      recoveryCheckpointId: operation.providerService?.adapterRecoveryCheckpoint?.checkpointId || null,
      recoveryCheckpointReplaySafe: operation.providerService?.adapterRecoveryCheckpoint?.replaySafe === true,
      restartStatusResolution: {
        journalId: operation.providerService?.restartStatusResolution?.journalId || null,
        journalEntryId: operation.providerService?.restartStatusResolution?.journalEntryId || null,
        resolutionId: operation.providerService?.restartStatusResolution?.resolutionId || null,
        status: operation.providerService?.restartStatusResolution?.status || "unknown",
        restartSafe: operation.providerService?.restartStatusResolution?.restartSafe === true,
        terminalState: operation.providerService?.restartStatusResolution?.terminalState || null,
        observedState: operation.providerService?.restartStatusResolution?.observedState || null,
        commandEnabled: operation.providerService?.restartStatusResolution?.commandEnabled === true,
        blockedBy: operation.providerService?.restartStatusResolution?.blockedBy || [],
        pendingBy: operation.providerService?.restartStatusResolution?.pendingBy || [],
        nextAction: operation.providerService?.restartStatusResolution?.nextAction || null,
      },
      externalProviderHandoff: {
        ledgerKey: operation.providerService?.externalProviderHandoff?.ledgerKey || null,
        ledgerEntryId: operation.providerService?.externalProviderHandoff?.ledgerEntryId || null,
        status: operation.providerService?.externalProviderHandoff?.status || "unknown",
        acceptedForProviderHandoff: operation.providerService?.externalProviderHandoff?.acceptedForProviderHandoff === true,
        commandEnabled: operation.providerService?.externalProviderHandoff?.commandEnabled === true,
        blockedBy: operation.providerService?.externalProviderHandoff?.blockedBy || [],
        pendingBy: operation.providerService?.externalProviderHandoff?.pendingBy || [],
        nextAction: operation.providerService?.externalProviderHandoff?.nextAction || null,
      },
      providerDeliveryAcknowledgement: {
        ledgerKey: operation.providerService?.providerDeliveryAcknowledgement?.ledgerKey || null,
        ackId: operation.providerService?.providerDeliveryAcknowledgement?.ackId || null,
        status: operation.providerService?.providerDeliveryAcknowledgement?.status || "unknown",
        required: operation.providerService?.providerDeliveryAcknowledgement?.required === true,
        acceptedForTruthHandoff: operation.providerService?.providerDeliveryAcknowledgement?.acceptedForTruthHandoff === true,
        expectedAckPath: operation.providerService?.providerDeliveryAcknowledgement?.expectedAckPath || null,
        commandEnabled: operation.providerService?.providerDeliveryAcknowledgement?.commandEnabled === true,
        patchable: operation.providerService?.providerDeliveryAcknowledgement?.patchable === true,
        blockedBy: operation.providerService?.providerDeliveryAcknowledgement?.blockedBy || [],
        pendingBy: operation.providerService?.providerDeliveryAcknowledgement?.pendingBy || [],
        statusPatch: operation.providerService?.providerDeliveryAcknowledgement?.statusPatch || null,
        callbackReceipt: operation.providerService?.providerDeliveryAcknowledgement?.callbackReceipt || null,
        nextAction: operation.providerService?.providerDeliveryAcknowledgement?.nextAction || null,
      },
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
      clientHandoffReceiptId: operation.boundaryScope.clientRuntimeAdoption?.expectedReceiptId || null,
      observedClientHandoffReceiptId: operation.boundaryScope.clientRuntimeAdoption?.observedReceiptId || null,
      clientHandoffReceiptMatches: operation.boundaryScope.clientRuntimeAdoption?.receiptMatches === true,
      visibleToOperator: operation.externalWrite || lifecycle.operatorVisible === true || lifecycleControl.operatorVisible === true || readiness !== "accepted",
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
        clientHandoffReceiptId: operation.boundaryScope.clientRuntimeAdoption?.expectedReceiptId || null,
        observedClientHandoffReceiptId: operation.boundaryScope.clientRuntimeAdoption?.observedReceiptId || null,
        nextAction: accepted
          ? operation.gate.nextAction
          : lifecycleBlocked
            ? lifecycleControl.nextAction || lifecycle.nextAction || "repair_lifecycle_visibility"
            : lifecyclePending
              ? lifecycleControl.nextAction || lifecycle.nextAction || "wait_for_lifecycle_control_plane"
            : clientHandoffBlocked || clientHandoffPending
              ? clientHandoff.nextAction || clientHandoffPlan.nextAction || "repair_client_handoff_readiness"
            : operatorNextActionBlocked || operatorNextActionPending
              ? operatorNextAction.nextAction || operatorNextActionState.nextAction || "repair_operator_next_action"
            : clientTransitionBlocked
              ? operation.providerService?.clientStatusTransition?.nextAction || operation.providerService?.nextAction || "repair_client_status_transition"
            : restartResolutionBlocked || restartResolutionPending
              ? operation.providerService?.restartStatusResolution?.nextAction || operation.providerService?.nextAction || "repair_restart_status_resolution"
            : recoveryCheckpointBlocked
              ? operation.providerService?.adapterRecoveryCheckpoint?.nextAction || operation.providerService?.nextAction || "repair_adapter_recovery_checkpoint"
            : externalHandoffBlocked || externalHandoffPending
              ? operation.providerService?.externalProviderHandoff?.nextAction || operation.providerService?.nextAction || "repair_external_provider_handoff"
            : providerDeliveryAckBlocked || providerDeliveryAckPending
              ? operation.providerService?.providerDeliveryAcknowledgement?.nextAction || operation.providerService?.nextAction || "repair_provider_delivery_acknowledgement"
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
        ...(operation.boundaryScope.clientRuntimeAdoption?.receiptReady === false ? ["client_handoff_receipt_not_ready"] : []),
        ...(operation.boundaryScope.clientRuntimeAdoption?.receiptMatches === false ? ["client_handoff_receipt_mismatch"] : []),
        ...(lifecycleBlocked ? (lifecycleControl.blockedBy || [`lifecycle_${lifecycle.status}`]).map((blocker) => `lifecycle_${blocker}`) : []),
        ...(lifecyclePending ? (lifecycleControl.pendingBy || ["pending"]).map((pending) => `lifecycle_${pending}`) : []),
        ...(clientHandoffBlocked ? (clientHandoff.blockedBy || ["blocked"]).map((blocker) => `client_handoff_${blocker}`) : []),
        ...(clientHandoffPending ? (clientHandoff.pendingBy || ["pending"]).map((pending) => `client_handoff_${pending}`) : []),
        ...(operatorNextActionBlocked ? (operatorNextAction.blockedBy || ["blocked"]).map((blocker) => `operator_next_action_${blocker}`) : []),
        ...(operatorNextActionPending ? (operatorNextAction.pendingBy || ["pending"]).map((pending) => `operator_next_action_${pending}`) : []),
        ...(clientTransitionBlocked ? [`client_transition_${operation.providerService?.clientStatusTransition?.blockedReason || "blocked"}`] : []),
        ...(restartResolutionBlocked ? (operation.providerService?.restartStatusResolution?.blockedBy || ["blocked"]).map((blocker) => `restart_resolution_${blocker}`) : []),
        ...(restartResolutionPending ? (operation.providerService?.restartStatusResolution?.pendingBy || ["pending"]).map((pending) => `restart_resolution_${pending}`) : []),
        ...(recoveryCheckpointBlocked ? [`recovery_checkpoint_${operation.providerService?.adapterRecoveryCheckpoint?.status || "blocked"}`] : []),
        ...(externalHandoffBlocked ? (operation.providerService?.externalProviderHandoff?.blockedBy || ["blocked"]).map((blocker) => `external_handoff_${blocker}`) : []),
        ...(externalHandoffPending ? (operation.providerService?.externalProviderHandoff?.pendingBy || ["pending"]).map((pending) => `external_handoff_${pending}`) : []),
        ...(providerDeliveryAckBlocked ? (operation.providerService?.providerDeliveryAcknowledgement?.blockedBy || ["blocked"]).map((blocker) => `provider_delivery_ack_${blocker}`) : []),
        ...(providerDeliveryAckPending ? (operation.providerService?.providerDeliveryAcknowledgement?.pendingBy || ["pending"]).map((pending) => `provider_delivery_ack_${pending}`) : []),
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
      lifecyclePending: rows.filter((row) => row.readiness === "lifecycle-pending").length,
      providerBlocked: rows.filter((row) => row.readiness === "provider-contract-blocked").length,
      clientHandoffBlocked: rows.filter((row) => row.readiness === "client-handoff-blocked").length,
      clientHandoffPending: rows.filter((row) => row.readiness === "client-handoff-pending").length,
      operatorNextActionBlocked: rows.filter((row) => row.readiness === "operator-next-action-blocked").length,
      operatorNextActionPending: rows.filter((row) => row.readiness === "operator-next-action-pending").length,
      clientTransitionBlocked: rows.filter((row) => row.readiness === "client-transition-blocked").length,
      restartResolutionBlocked: rows.filter((row) => row.readiness === "restart-resolution-blocked").length,
      restartResolutionPending: rows.filter((row) => row.readiness === "restart-resolution-pending").length,
      recoveryCheckpointBlocked: rows.filter((row) => row.readiness === "recovery-checkpoint-blocked").length,
      externalHandoffBlocked: rows.filter((row) => row.readiness === "external-handoff-blocked").length,
      externalHandoffPending: rows.filter((row) => row.readiness === "external-handoff-pending").length,
      providerDeliveryAckBlocked: rows.filter((row) => row.readiness === "provider-delivery-ack-blocked").length,
      providerDeliveryAckPending: rows.filter((row) => row.readiness === "provider-delivery-ack-pending").length,
      operatorNextActionLinked: rows.filter((row) => row.operatorNextAction?.actionId).length,
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
    ...(operation.tenantPermissionEnforcement?.status === "blocked" ? [{
      severity: "error",
      code: "truth.tenant_permission_enforcement_blocked",
      message: `Operation ${operation.operationId} tenant permission enforcement is blocked before truth handoff.`,
      field: "package.tenantPermissionEnforcementMatrix",
      operationId: operation.operationId,
      action: operation.tenantPermissionEnforcement.nextAction,
      blockedBy: operation.tenantPermissionEnforcement.blockedBy,
    }] : []),
    ...(operation.tenantPermissionEnforcement?.status === "pending" ? [{
      severity: "warning",
      code: "truth.tenant_permission_enforcement_pending",
      message: `Operation ${operation.operationId} is waiting for tenant permission enforcement before truth handoff.`,
      field: "package.tenantPermissionEnforcementMatrix",
      operationId: operation.operationId,
      action: operation.tenantPermissionEnforcement.nextAction,
      pendingBy: operation.tenantPermissionEnforcement.pendingBy,
    }] : []),
    ...(operation.tenantBoundaryAction?.status === "blocked" ? [{
      severity: "error",
      code: "truth.tenant_boundary_action_blocked",
      message: `Operation ${operation.operationId} tenant boundary action queue is blocked before truth handoff.`,
      field: "package.tenantBoundaryActionQueue",
      operationId: operation.operationId,
      action: operation.tenantBoundaryAction.nextAction,
      blockedBy: operation.tenantBoundaryAction.blockedBy,
      queueId: operation.tenantBoundaryAction.queueId || null,
    }] : []),
    ...(operation.tenantBoundaryAction?.status === "pending" ? [{
      severity: "warning",
      code: "truth.tenant_boundary_action_pending",
      message: `Operation ${operation.operationId} is waiting for tenant boundary action status publication before truth handoff.`,
      field: "package.tenantBoundaryActionQueue",
      operationId: operation.operationId,
      action: operation.tenantBoundaryAction.nextAction,
      pendingBy: operation.tenantBoundaryAction.pendingBy,
      queueId: operation.tenantBoundaryAction.queueId || null,
    }] : []),
    ...(operation.boundaryScope.clientRuntimeAdoption?.receiptReady === false ? [{
      severity: "error",
      code: "truth.client_handoff_receipt_not_ready",
      message: `Operation ${operation.operationId} compiled Mailchimp client handoff receipt is not accepted for runtime handoff.`,
      field: "package.runtimeContract.clientHandoffReceipts",
      operationId: operation.operationId,
      action: "repair_client_handoff_receipt_metadata",
      receiptId: operation.boundaryScope.clientRuntimeAdoption?.expectedReceiptId || null,
    }] : []),
    ...(operation.boundaryScope.clientRuntimeAdoption?.receiptMatches === false ? [{
      severity: "error",
      code: "truth.client_handoff_receipt_mismatch",
      message: `Operation ${operation.operationId} runtime evidence echoed a stale Mailchimp client handoff receipt.`,
      field: "evidence.clientRuntimeAdoption.receipt",
      operationId: operation.operationId,
      action: "refresh_client_handoff_receipt_evidence",
      expectedReceiptId: operation.boundaryScope.clientRuntimeAdoption?.expectedReceiptId || null,
      observedReceiptId: operation.boundaryScope.clientRuntimeAdoption?.observedReceiptId || null,
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
    ...(String(operation.providerService?.status || "").startsWith("restart-resolution-") ? [{
      severity: operation.providerService?.status === "restart-resolution-pending" ? "warning" : "error",
      code: `truth.${operation.providerService.status.replace(/-/g, "_")}`,
      message: `Operation ${operation.operationId} cannot complete Mailchimp truth handoff until restart status resolution is accepted.`,
      field: "package.runtimeContract.restartJournal.statusResolutions",
      operationId: operation.operationId,
      action: operation.providerService?.restartStatusResolution?.nextAction
        || operation.providerService?.nextAction
        || "repair_restart_status_resolution",
      resolutionId: operation.providerService?.restartStatusResolution?.resolutionId || null,
      blockedBy: operation.providerService?.restartStatusResolution?.blockedBy || [],
      pendingBy: operation.providerService?.restartStatusResolution?.pendingBy || [],
    }] : []),
    ...(operation.providerService?.status === "external-handoff-blocked" ? [{
      severity: "error",
      code: "truth.external_provider_handoff_blocked",
      message: `Operation ${operation.operationId} cannot continue because the compiled Mailchimp external provider handoff ledger is blocked.`,
      field: "package.runtimeContract.externalProviderHandoffLedger.rows",
      operationId: operation.operationId,
      action: operation.providerService?.externalProviderHandoff?.nextAction
        || operation.providerService?.nextAction
        || "repair_external_provider_handoff",
      blockedBy: operation.providerService?.externalProviderHandoff?.blockedBy || [],
      ledgerEntryId: operation.providerService?.externalProviderHandoff?.ledgerEntryId || null,
    }] : []),
    ...(operation.providerService?.status === "external-handoff-pending" ? [{
      severity: "warning",
      code: "truth.external_provider_handoff_pending",
      message: `Operation ${operation.operationId} is waiting for Mailchimp external provider handoff prerequisites.`,
      field: "package.runtimeContract.externalProviderHandoffLedger.rows",
      operationId: operation.operationId,
      action: operation.providerService?.externalProviderHandoff?.nextAction
        || operation.providerService?.nextAction
        || "wait_for_external_provider_handoff",
      pendingBy: operation.providerService?.externalProviderHandoff?.pendingBy || [],
      ledgerEntryId: operation.providerService?.externalProviderHandoff?.ledgerEntryId || null,
    }] : []),
    ...(operation.providerService?.status === "provider-delivery-ack-missing" ? [{
      severity: "error",
      code: "truth.provider_delivery_ack_missing",
      message: `Operation ${operation.operationId} requires a compiled Mailchimp provider delivery acknowledgement before truth handoff.`,
      field: "package.runtimeContract.providerDeliveryAcknowledgementLedger.rows",
      operationId: operation.operationId,
      action: operation.providerService?.providerDeliveryAcknowledgement?.nextAction
        || operation.providerService?.nextAction
        || "compile_provider_delivery_acknowledgement",
    }] : []),
    ...(operation.providerService?.status === "provider-delivery-ack-blocked" ? [{
      severity: "error",
      code: "truth.provider_delivery_ack_blocked",
      message: `Operation ${operation.operationId} cannot continue because the Mailchimp provider delivery acknowledgement is blocked.`,
      field: "package.runtimeContract.providerDeliveryAcknowledgementLedger.rows",
      operationId: operation.operationId,
      action: operation.providerService?.providerDeliveryAcknowledgement?.nextAction
        || operation.providerService?.nextAction
        || "repair_provider_delivery_acknowledgement",
      blockedBy: operation.providerService?.providerDeliveryAcknowledgement?.blockedBy || [],
      ackId: operation.providerService?.providerDeliveryAcknowledgement?.ackId || null,
    }] : []),
    ...(operation.providerService?.providerDeliveryAcknowledgement?.callbackReceipt?.status === "blocked" ? [{
      severity: "error",
      code: "truth.provider_callback_receipt_blocked",
      message: `Operation ${operation.operationId} received a Mailchimp provider callback receipt that does not match the compiled handoff metadata.`,
      field: "package.runtimeContract.providerDeliveryAcknowledgementLedger.rows.callbackReceipt",
      operationId: operation.operationId,
      action: operation.providerService?.providerDeliveryAcknowledgement?.callbackReceipt?.nextAction
        || operation.providerService?.providerDeliveryAcknowledgement?.nextAction
        || "repair_provider_callback_receipt",
      blockedBy: operation.providerService?.providerDeliveryAcknowledgement?.callbackReceipt?.blockedBy || [],
      missingFields: operation.providerService?.providerDeliveryAcknowledgement?.callbackReceipt?.missingFields || [],
      ackId: operation.providerService?.providerDeliveryAcknowledgement?.ackId || null,
    }] : []),
    ...(operation.providerService?.status === "provider-delivery-ack-pending"
      || operation.providerService?.status === "provider-delivery-ack-required"
      ? [{
        severity: "warning",
        code: "truth.provider_delivery_ack_pending",
        message: `Operation ${operation.operationId} is waiting for Mailchimp provider delivery acknowledgement before client truth handoff.`,
        field: "package.runtimeContract.providerDeliveryAcknowledgementLedger.rows",
        operationId: operation.operationId,
        action: operation.providerService?.providerDeliveryAcknowledgement?.nextAction
          || operation.providerService?.nextAction
          || "wait_for_provider_delivery_acknowledgement",
        pendingBy: operation.providerService?.providerDeliveryAcknowledgement?.pendingBy || [],
        ackId: operation.providerService?.providerDeliveryAcknowledgement?.ackId || null,
        expectedAckPath: operation.providerService?.providerDeliveryAcknowledgement?.expectedAckPath || null,
      }]
      : []),
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
  const externalHandoffBlocked = operations.filter((operation) => operation.providerService?.status === "external-handoff-blocked");
  const externalHandoffPending = operations.filter((operation) => operation.providerService?.status === "external-handoff-pending");
  const providerDeliveryAckBlocked = operations.filter((operation) => (
    operation.providerService?.status === "provider-delivery-ack-blocked"
    || operation.providerService?.status === "provider-delivery-ack-missing"
  ));
  const providerDeliveryAckPending = operations.filter((operation) => (
    operation.providerService?.status === "provider-delivery-ack-pending"
    || operation.providerService?.status === "provider-delivery-ack-required"
  ));
  const tenantBoundaryActionBlocked = operations.filter((operation) => operation.tenantBoundaryAction?.status === "blocked");
  const tenantBoundaryActionPending = operations.filter((operation) => operation.tenantBoundaryAction?.status === "pending");
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
      externalHandoffBlockedOperationCount: externalHandoffBlocked.length,
      externalHandoffPendingOperationCount: externalHandoffPending.length,
      providerDeliveryAckBlockedOperationCount: providerDeliveryAckBlocked.length,
      providerDeliveryAckPendingOperationCount: providerDeliveryAckPending.length,
      tenantBoundaryActionBlockedOperationCount: tenantBoundaryActionBlocked.length,
      tenantBoundaryActionPendingOperationCount: tenantBoundaryActionPending.length,
      tenantBoundaryActionAcceptedCount: operations.filter((operation) => operation.tenantBoundaryAction?.acceptedForTruth).length,
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
