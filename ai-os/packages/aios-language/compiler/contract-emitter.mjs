import { compileMailchimpJobDescriptor } from "./job-descriptor-compiler.mjs";
import { emitMailchimpArtifacts, assertMailchimpArtifactsReady } from "./artifact-emitter.mjs";
import { emitMailchimpDiagnostics, assertMailchimpDiagnosticsReady } from "./diagnostic-emitter.mjs";
import { emitMailchimpMetadata, assertMailchimpMetadataReady } from "./metadata-emitter.mjs";

function compileIfNeeded(source, options) {
  if (source?.kind === "aios.kernelJobDescriptor") return source;
  return compileMailchimpJobDescriptor(source, options);
}

function buildContractReadiness(job, diagnostics, metadata, artifacts) {
  const diagnosticCheck = assertMailchimpDiagnosticsReady(diagnostics);
  const metadataCheck = assertMailchimpMetadataReady(metadata);
  const artifactCheck = assertMailchimpArtifactsReady(artifacts);
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const checks = [
    {
      id: "mailchimp.contract.diagnostics",
      passed: diagnosticCheck.ok,
      required: true,
      nextAction: diagnosticCheck.nextAction
    },
    {
      id: "mailchimp.contract.metadata",
      passed: metadataCheck.ok,
      required: true,
      nextAction: metadataCheck.nextAction
    },
    {
      id: "mailchimp.contract.artifacts",
      passed: artifactCheck.ok,
      required: true,
      nextAction: artifactCheck.nextAction
    },
    {
      id: "mailchimp.contract.runtime-handoff",
      passed: runtimeHandoff.acceptedForClientPreview !== false,
      required: true,
      nextAction: runtimeHandoff.acceptedForClientPreview === false
        ? "repair-runtime-handoff"
        : runtimeHandoff.readinessStatus || "ready"
    }
  ];
  const failedRequired = checks.filter((check) => check.required && !check.passed);
  const blockingDiagnostics = diagnostics.counts.bySeverity.error || 0;
  const operatorActions = diagnostics.nextActions.filter((action) => action.required);

  return {
    status: failedRequired.length || blockingDiagnostics
      ? "blocked"
      : operatorActions.length || runtimeHandoff.readinessStatus === "needs-operator-action"
        ? "needs-operator-action"
        : "ready",
    acceptedForRuntime: failedRequired.length === 0
      && blockingDiagnostics === 0
      && runtimeHandoff.acceptedForRuntime === true,
    acceptedForClientPreview: failedRequired.length === 0 && runtimeHandoff.acceptedForClientPreview !== false,
    checks,
    validationSummary: {
      total: checks.length,
      passed: checks.filter((check) => check.passed).length,
      failedRequired: failedRequired.length,
      blockingDiagnostics,
      requiredOperatorActions: operatorActions.length
    },
    nextAction: failedRequired[0]?.nextAction
      || operatorActions[0]?.nextAction
      || diagnostics.recovery.nextAction
      || "handoff-to-runtime-adapter"
  };
}

function buildRuntimeDataContract(job, metadata) {
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const serviceHandoff = runtimeHandoff.serviceHandoff || {};
  const previewAcceptance = metadata.preview?.acceptance || {};
  const providerService = metadata.providerService || {};
  return {
    provider: "mailchimp",
    runtimeAdapter: metadata.runtimeAdapter,
    inputContract: job.runtimeAdapter?.inputContract || {
      campaignId: "optional-string",
      audienceId: "required-string",
      draftPayload: "object"
    },
    requiredClientState: runtimeHandoff.clientContract?.requiredClientState || [],
    requiredMemory: serviceHandoff.requiredMemory || [],
    requiredCapabilities: metadata.capabilities.actions,
    requiredScopes: metadata.capabilities.requiredScopes,
    providerServiceContract: {
      schemaVersion: "aios.mailchimp.runtime-provider-service-contract.v1",
      providerService: providerService.providerService || serviceHandoff.providerService || "mailchimp-marketing-api",
      status: providerService.status || "unknown",
      requiredScopes: providerService.syncMetadata?.serviceScopes || metadata.capabilities.requiredScopes,
      syncRequired: providerService.syncMetadata?.syncRequired === true,
      providerSyncMounts: providerService.syncMetadata?.providerSyncMounts || [],
      negotiatedCapabilities: providerService.capabilityNegotiation?.negotiated || [],
      unnegotiatedCapabilities: providerService.capabilityNegotiation?.unnegotiated || [],
      externalHandoffRequired: providerService.externalHandoff?.required === true,
      externalHandoffReady: providerService.externalHandoff?.ready === true,
      idempotencyKey: providerService.externalHandoff?.idempotencyKey || null
    },
    statusPayloadShape: {
      readinessStatus: "string",
      acceptedForRuntime: "boolean",
      acceptedForClientPreview: "boolean",
      nextAction: "string",
      diagnostics: "object"
    },
    recoveryPayloadShape: {
      recoverable: "boolean",
      strategy: "string",
      nextAction: "string",
      requiredActionCount: "number"
    },
    failureStatePayloadShape: {
      mode: "string",
      queue: "array",
      nextRetry: "object-or-null",
      adapterHandoff: "object"
    },
    previewAcceptancePayloadShape: {
      status: "string",
      acceptanceToken: "string",
      validationSummary: "object",
      checklist: "array",
      clientPatch: "object"
    },
    clientWorkflowPayloadShape: {
      status: "string",
      phase: "string",
      primaryAction: "string",
      validationSummary: "object",
      validationItems: "array",
      explainNextStep: "object",
      tenant: "object",
      clientPatch: "object"
    },
    clientCommandLeasesPayloadShape: {
      leaseStatus: "string",
      primaryLeaseId: "string-or-null",
      primaryAction: "string",
      resumeToken: "string",
      ack: "object",
      leases: "array",
      clientPatch: "object"
    },
    clientRuntimeAdoptionPayloadShape: {
      status: "string",
      adoptionId: "string",
      readyForClientRuntime: "boolean",
      missingStateKeys: "array",
      commandAck: "object",
      resume: "object",
      clientPatch: "object"
    },
    statusHandoffPayloadShape: {
      handoffState: "string",
      visibleStatus: "string",
      statusLedger: "object",
      clientCommandAck: "object",
      adapterRecovery: "object",
      restartContract: "object",
      clientPatch: "object"
    },
    lifecycleControlsPayloadShape: {
      status: "string",
      nextAction: "string",
      previewEnabled: "boolean",
      runtimeStartEnabled: "boolean",
      controls: "array",
      schedule: "object",
      disabledActions: "object"
    },
    providerServicePayloadShape: {
      providerService: "string",
      status: "string",
      syncMetadata: "object",
      capabilityNegotiation: "object",
      externalHandoff: "object",
      clientPatch: "object"
    },
    clientAcceptanceContract: {
      required: true,
      token: previewAcceptance.acceptanceToken || null,
      status: previewAcceptance.status || "unknown",
      previewEnabled: previewAcceptance.previewEnabled === true,
      runtimeStartEnabledAfterAcceptance: previewAcceptance.runtimeStartEnabledAfterAcceptance === true,
      nextStep: previewAcceptance.nextStep || metadata.preview?.explainNextStep?.action || "accept-preview"
    }
  };
}

function buildProviderServiceRuntimeHandoff(metadata, artifacts, readiness) {
  const providerService = metadata.providerService || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const providerArtifact = manifest.find((artifact) => artifact.name === "provider-service-handoff.json");
  const unnegotiated = providerService.capabilityNegotiation?.unnegotiated || [];
  const status = providerService.status || "unknown";
  const ready = providerService.externalHandoff?.ready === true
    && Boolean(providerArtifact?.id)
    && unnegotiated.length === 0;

  return {
    schemaVersion: "aios.mailchimp.provider-service-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    providerService: providerService.providerService || "mailchimp-marketing-api",
    artifactName: persistedState.providerServiceHandoffArtifact || "provider-service-handoff.json",
    artifactId: providerArtifact?.id || null,
    readyForRuntime: ready && readiness.status !== "blocked",
    externalHandoff: {
      target: providerService.externalHandoff?.target || providerService.providerService || "mailchimp-marketing-api",
      required: providerService.externalHandoff?.required === true,
      ready,
      idempotencyKey: providerService.externalHandoff?.idempotencyKey || persistedState.providerServiceHandoffKey || null
    },
    syncMetadata: providerService.syncMetadata || {},
    capabilityNegotiation: providerService.capabilityNegotiation || {},
    clientPatch: {
      ...(providerService.clientState || {}),
      artifactName: persistedState.providerServiceHandoffArtifact || "provider-service-handoff.json",
      artifactReady: Boolean(providerArtifact?.id),
      nextAction: providerService.clientState?.nextAction || readiness.nextAction
    },
    nextAction: ready
      ? readiness.nextAction
      : providerService.clientState?.nextAction || "repair-provider-service-handoff"
  };
}

function buildClientCommandLeaseRuntimeHandoff(metadata, artifacts, readiness, permissionHandoff) {
  const commandLeases = metadata.clientCommandLeases || metadata.health?.clientCommandLeases || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const leaseArtifact = manifest.find((artifact) => artifact.name === "client-command-leases.json");
  const leases = Array.isArray(commandLeases.leases) ? commandLeases.leases : [];
  const primaryLease = leases.find((lease) => lease.id === commandLeases.primaryLeaseId)
    || leases[0]
    || null;
  const permissionBlocked = permissionHandoff.status === "blocked";
  const ackRequired = commandLeases.ackRequired === true
    || primaryLease?.ackRequired === true
    || persistedState.clientCommandAckRequired === true;
  const readyForClient = permissionBlocked === false
    && Boolean(leaseArtifact?.id)
    && readiness.acceptedForClientPreview === true;

  return {
    schemaVersion: "aios.mailchimp.client-command-lease-handoff.v1",
    provider: "mailchimp",
    status: permissionBlocked
      ? "blocked"
      : commandLeases.leaseStatus || "unknown",
    artifactName: persistedState.clientCommandLeasesArtifact || "client-command-leases.json",
    artifactId: leaseArtifact?.id || null,
    readyForClient,
    primaryLeaseId: primaryLease?.id || null,
    primaryAction: permissionBlocked
      ? permissionHandoff.nextAction
      : commandLeases.primaryAction || primaryLease?.nextAction || readiness.nextAction,
    resumeToken: commandLeases.resumeToken
      || persistedState.commandLeaseResumeToken
      || null,
    ack: {
      required: permissionBlocked ? true : ackRequired,
      keys: permissionBlocked
        ? []
        : commandLeases.ackKeys || [],
      nextAckKey: permissionBlocked
        ? null
        : primaryLease?.ackKey || commandLeases.ackKeys?.[0] || null,
      requiredCount: permissionBlocked
        ? 1
        : commandLeases.ackRequiredCount || 0
    },
    counts: {
      leases: leases.length,
      visible: commandLeases.visibleCount || 0,
      blocking: permissionBlocked
        ? (commandLeases.blockingCount || 0) + 1
        : commandLeases.blockingCount || 0
    },
    clientPatch: {
      ...(commandLeases.clientPatch || {}),
      artifactName: persistedState.clientCommandLeasesArtifact || "client-command-leases.json",
      artifactReady: Boolean(leaseArtifact?.id),
      commandLeaseStatus: permissionBlocked ? "blocked" : commandLeases.leaseStatus || "unknown",
      commandLeaseId: primaryLease?.id || null,
      commandAckRequired: permissionBlocked || ackRequired,
      commandAckKey: permissionBlocked ? null : primaryLease?.ackKey || commandLeases.ackKeys?.[0] || null,
      nextAction: permissionBlocked
        ? permissionHandoff.nextAction
        : commandLeases.primaryAction || readiness.nextAction
    },
    restartSemantics: commandLeases.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-command-lease-key",
      externalWritesPerformed: false,
      resumeFromLeaseId: primaryLease?.id || null
    },
    nextAction: permissionBlocked
      ? permissionHandoff.nextAction
      : commandLeases.primaryAction || primaryLease?.nextAction || readiness.nextAction
  };
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(Boolean).map(String))).sort();
}

function deriveWorkspaceBoundary(job, metadata, diagnostics, options) {
  const diagnosticBoundary = diagnostics.permissionBoundary || {};
  const runtimeHandoff = job.contracts?.runtimeHandoffPlan || {};
  const sourceBoundary = job.contracts?.tenantBoundary || job.contracts?.workspaceBoundary || {};
  const optionBoundary = options.workspaceBoundary || {};
  const workspaceId = optionBoundary.workspaceId
    || sourceBoundary.workspaceId
    || runtimeHandoff.clientContract?.workspaceId
    || diagnosticBoundary.workspaceId
    || "workspace.local";
  const tenantId = optionBoundary.tenantId
    || sourceBoundary.tenantId
    || runtimeHandoff.clientContract?.tenantId
    || diagnosticBoundary.tenantId
    || "tenant.local";
  const allowedRoles = normalizeList(
    optionBoundary.allowedRoles
      || sourceBoundary.allowedRoles
      || diagnosticBoundary.allowedRoles
      || ["owner", "operator"]
  );
  const requiredRoles = normalizeList(
    optionBoundary.requiredRoles
      || sourceBoundary.requiredRoles
      || diagnosticBoundary.requiredRoles
      || ["operator"]
  );
  const requiredScopes = normalizeList(diagnosticBoundary.requiredScopes || metadata.capabilities?.requiredScopes || []);
  const requestedScopes = normalizeList(
    optionBoundary.requestedScopes
      || sourceBoundary.requestedScopes
      || diagnosticBoundary.requestedScopes
      || requiredScopes
  );
  const deniedScopes = diagnosticBoundary.deniedScopes
    ? normalizeList(diagnosticBoundary.deniedScopes)
    : requestedScopes.filter((scope) => requiredScopes.length > 0 && !requiredScopes.includes(scope));
  const missingRoles = diagnosticBoundary.missingRoles
    ? normalizeList(diagnosticBoundary.missingRoles)
    : requiredRoles.filter((role) => !allowedRoles.includes(role));
  const wildcardBoundary = diagnosticBoundary.wildcardBoundary === true || workspaceId === "*" || tenantId === "*";
  const crossTenantAccess = diagnosticBoundary.crossTenantAccess === true;

  return {
    schemaVersion: "aios.mailchimp.workspace-boundary.v1",
    workspaceId,
    tenantId,
    isolationKey: diagnosticBoundary.isolationKey || `${tenantId}:${workspaceId}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    explicitTenant: diagnosticBoundary.explicitTenant !== false,
    explicitWorkspace: diagnosticBoundary.explicitWorkspace !== false,
    allowedRoles,
    requiredRoles,
    missingRoles,
    requiredScopes,
    requestedScopes,
    deniedScopes,
    crossTenantAccess,
    wildcardBoundary,
    diagnosticIds: diagnosticBoundary.diagnosticIds || [],
    diagnosticStatus: diagnosticBoundary.status || "unknown",
    externalWritePolicy: metadata.runtime?.statusControls?.requiresApprovalBeforeExternalWrite
      ? "approval-required"
      : "runtime-controlled",
    safeBoundary: diagnosticBoundary.safeBoundary === true
      && deniedScopes.length === 0
      && missingRoles.length === 0
      && wildcardBoundary === false
      && crossTenantAccess === false
  };
}

function buildPermissionHandoff(boundary, metadata, diagnostics) {
  const missingRoles = boundary.missingRoles || boundary.requiredRoles.filter((role) => !boundary.allowedRoles.includes(role));
  const approvalRequired = metadata.capabilities?.requiresApproval === true
    || metadata.runtime?.statusControls?.requiresApprovalBeforeExternalWrite === true;
  const blockingDiagnostics = diagnostics.counts?.bySeverity?.error || 0;
  const permissionStatus = !boundary.safeBoundary || missingRoles.length > 0 || boundary.deniedScopes.length > 0
    ? "blocked"
    : approvalRequired || blockingDiagnostics > 0
      ? "needs-operator-action"
      : "ready";

  return {
    status: permissionStatus,
    allowed: permissionStatus !== "blocked",
    approvalRequired,
    missingRoles,
    deniedScopes: boundary.deniedScopes,
    boundaryDiagnosticIds: boundary.diagnosticIds,
    tenantIsolationKey: boundary.isolationKey,
    rolePolicy: {
      requiredRoles: boundary.requiredRoles,
      allowedRoles: boundary.allowedRoles,
      missingRoles,
      enforcement: "compile-contract"
    },
    scopePolicy: {
      requiredScopes: boundary.requiredScopes,
      requestedScopes: boundary.requestedScopes,
      deniedScopes: boundary.deniedScopes,
      enforcement: "adapter-handoff"
    },
    nextAction: missingRoles.length
      ? "grant-required-workspace-role"
      : boundary.deniedScopes.length
        ? "remove-denied-mailchimp-scope"
        : approvalRequired
          ? "collect-human-approval"
          : diagnostics.recovery?.nextAction || "handoff-to-runtime-adapter"
  };
}

function buildAuditHandoff(job, boundary, permissionHandoff, artifacts) {
  const manifest = artifacts.handoffManifest || [];
  const persistedState = artifacts.persistedState || {};
  const boundaryArtifact = manifest.find((artifact) => artifact.name === "permission-boundary.json");
  const previewArtifact = manifest.find((artifact) => artifact.name === "preview-acceptance.json");
  return {
    provider: "mailchimp",
    jobId: job.id,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    isolationKey: boundary.isolationKey,
    permissionStatus: permissionHandoff.status,
    externalWrites: false,
    auditEventType: "mailchimp.contract.handoff",
    idempotencyKey: persistedState.idempotencyKey || `${job.id}:${boundary.isolationKey}`,
    evidence: {
      artifactIds: manifest.map((artifact) => artifact.id),
      requiredArtifactNames: manifest
        .filter((artifact) => artifact.required)
        .map((artifact) => artifact.name),
      persistedStateArtifact: persistedState.artifactName || null,
      permissionBoundaryArtifact: boundaryArtifact?.id || null,
      previewAcceptanceArtifact: previewArtifact?.id || null,
      previewAcceptanceToken: persistedState.previewAcceptanceToken || null,
      boundaryDiagnosticIds: boundary.diagnosticIds
    },
    safeToRecord: boundary.safeBoundary
      && permissionHandoff.allowed
      && Boolean(boundaryArtifact?.id)
      && Boolean(previewArtifact?.id),
    nextAction: permissionHandoff.nextAction
  };
}

function buildPreviewAcceptanceHandoff(metadata, artifacts, readiness, permissionHandoff) {
  const preview = metadata.preview || {};
  const acceptance = preview.acceptance || metadata.exports?.previewAcceptance || {};
  const manifest = artifacts.handoffManifest || [];
  const previewArtifact = manifest.find((artifact) => artifact.name === "preview-acceptance.json");
  const exportArtifact = manifest.find((artifact) => artifact.name === "export-summary.json");
  const validation = acceptance.validationSummary || {};
  const blocked = validation.blocked || 0;
  const pending = validation.pending || 0;
  const permissionBlocked = permissionHandoff.status === "blocked";
  const status = permissionBlocked || blocked > 0
    ? "blocked"
    : pending > 0 || readiness.status === "needs-operator-action"
      ? "needs-operator-action"
      : "accepted";

  return {
    schemaVersion: "aios.mailchimp.preview-acceptance-handoff.v1",
    provider: "mailchimp",
    status,
    accepted: status === "accepted" && acceptance.accepted === true,
    tokenRequired: true,
    acceptanceToken: acceptance.acceptanceToken || artifacts.persistedState?.previewAcceptanceToken || null,
    artifactName: artifacts.persistedState?.previewAcceptanceArtifact || "preview-acceptance.json",
    artifactId: previewArtifact?.id || null,
    exportSummaryArtifactId: exportArtifact?.id || null,
    previewEnabled: acceptance.previewEnabled === true && permissionBlocked === false,
    runtimeStartEnabledAfterAcceptance: acceptance.runtimeStartEnabledAfterAcceptance === true
      && readiness.acceptedForRuntime === true
      && permissionHandoff.allowed === true,
    validationSummary: {
      total: validation.total || 0,
      required: validation.required || 0,
      accepted: validation.accepted || 0,
      blocked,
      pending,
      blockingDiagnostics: validation.blockingDiagnostics || 0,
      warningDiagnostics: validation.warningDiagnostics || 0
    },
    clientPatch: acceptance.clientPatch || {},
    explainNextStep: preview.explainNextStep || {
      action: acceptance.nextStep || readiness.nextAction,
      reason: status === "blocked"
        ? "preview-acceptance-blocked"
        : status === "needs-operator-action"
          ? "preview-acceptance-pending"
          : "preview-accepted",
      resumeToken: metadata.exports?.summary?.resumeToken || null,
      statusRevision: metadata.exports?.summary?.statusRevision || null
    },
    nextAction: permissionBlocked
      ? permissionHandoff.nextAction
      : preview.explainNextStep?.action || acceptance.nextStep || readiness.nextAction
  };
}

function buildLifecycleControlsHandoff(metadata, artifacts, readiness, permissionHandoff) {
  const lifecycle = metadata.lifecycle || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const lifecycleArtifact = manifest.find((artifact) => artifact.name === "lifecycle-controls.json");
  const blockedControls = Array.isArray(lifecycle.controls)
    ? lifecycle.controls.filter((control) => control.status === "blocked")
    : [];
  const disabledControls = Array.isArray(lifecycle.controls)
    ? lifecycle.controls.filter((control) => control.enabled !== true)
    : [];
  const permissionBlocked = permissionHandoff.status === "blocked";
  const status = permissionBlocked || blockedControls.length > 0
    ? "blocked"
    : disabledControls.length > 0 || readiness.status === "needs-operator-action"
      ? "needs-operator-action"
      : "ready";

  return {
    schemaVersion: "aios.mailchimp.lifecycle-controls-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.lifecycleControlsArtifact || "lifecycle-controls.json",
    artifactId: lifecycleArtifact?.id || null,
    readyForClient: permissionBlocked === false
      && Boolean(lifecycleArtifact?.id)
      && lifecycle.previewEnabled === true,
    runtimeStartEnabled: lifecycle.runtimeStartEnabled === true
      && permissionHandoff.allowed === true
      && readiness.acceptedForRuntime === true
      && status === "ready",
    nextAction: permissionBlocked
      ? permissionHandoff.nextAction
      : lifecycle.nextAction || readiness.nextAction,
    controls: Array.isArray(lifecycle.controls) ? lifecycle.controls : [],
    blockedControlIds: blockedControls.map((control) => control.id),
    disabledControlIds: disabledControls.map((control) => control.id),
    schedule: lifecycle.schedule || {},
    disabledActions: lifecycle.disabledActions || {},
    clientPatch: lifecycle.statePatch || {},
    statusResume: {
      resumeToken: metadata.exports?.summary?.resumeToken || null,
      statusRevision: metadata.exports?.summary?.statusRevision || null,
      lifecycleStatus: lifecycle.status || "unknown",
      runtimeStartDisableReason: lifecycle.statePatch?.runtimeStartDisableReason || null
    }
  };
}

function buildClientWorkflowContractHandoff(metadata, artifacts, readiness, permissionHandoff) {
  const workflow = metadata.clientWorkflow || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const workflowArtifact = manifest.find((artifact) => artifact.name === "client-workflow.json");
  const validation = workflow.validationSummary || {};
  const permissionBlocked = permissionHandoff.status === "blocked";
  const blocked = permissionBlocked ? (validation.blocked || 0) + 1 : validation.blocked || 0;
  const status = blocked > 0
    ? "blocked"
    : validation.pending > 0 || readiness.status === "needs-operator-action"
      ? "needs-operator-action"
      : workflow.status || "ready";
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : workflow.explainNextStep?.action || workflow.primaryAction || readiness.nextAction;

  return {
    schemaVersion: "aios.mailchimp.client-workflow-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.clientWorkflowArtifact || "client-workflow.json",
    artifactId: workflowArtifact?.id || null,
    readyForClient: permissionBlocked === false
      && Boolean(workflowArtifact?.id)
      && workflow.preview?.readyForPreview === true,
    primaryAction: nextAction,
    phase: permissionBlocked ? "repair" : workflow.phase || "preflight",
    severity: permissionBlocked ? "error" : workflow.severity || "info",
    tenant: {
      tenantId: workflow.tenant?.tenantId || permissionHandoff.tenantIsolationKey?.split(":")[0] || null,
      workspaceId: workflow.tenant?.workspaceId || null,
      isolationKey: workflow.tenant?.isolationKey || permissionHandoff.tenantIsolationKey || null,
      safeBoundary: permissionBlocked === false && workflow.tenant?.safeBoundary === true
    },
    validationSummary: {
      total: validation.total || 0,
      accepted: validation.accepted || 0,
      blocked,
      pending: validation.pending || 0,
      required: validation.required || 0,
      blockingDiagnostics: validation.blockingDiagnostics || 0,
      warningDiagnostics: validation.warningDiagnostics || 0
    },
    explainNextStep: {
      action: nextAction,
      reason: permissionBlocked
        ? "permission-boundary-blocked"
        : workflow.explainNextStep?.reason || "workflow-ready",
      resumeToken: workflow.explainNextStep?.resumeToken || metadata.exports?.summary?.resumeToken || null,
      statusRevision: workflow.explainNextStep?.statusRevision || metadata.exports?.summary?.statusRevision || null,
      isolationKey: workflow.explainNextStep?.isolationKey || workflow.tenant?.isolationKey || null
    },
    clientPatch: {
      ...(workflow.statePatch || {}),
      artifactName: persistedState.clientWorkflowArtifact || "client-workflow.json",
      artifactReady: Boolean(workflowArtifact?.id),
      primaryAction: nextAction,
      workflowStatus: status
    }
  };
}

function buildClientRuntimeAdoptionHandoff(metadata, artifacts, readiness, permissionHandoff) {
  const adoption = metadata.clientRuntimeAdoption || metadata.health?.clientRuntimeAdoption || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const adoptionArtifact = manifest.find((artifact) => artifact.name === "client-runtime-adoption.json");
  const missingStateKeys = normalizeList(adoption.missingStateKeys || []);
  const pendingAckKeys = normalizeList(adoption.commandAck?.pendingKeys || []);
  const permissionBlocked = permissionHandoff.status === "blocked";
  const readyForClientRuntime = permissionBlocked === false
    && Boolean(adoptionArtifact?.id)
    && adoption.readyForClientRuntime === true
    && missingStateKeys.length === 0
    && pendingAckKeys.length === 0
    && readiness.acceptedForClientPreview === true;
  const status = permissionBlocked
    ? "blocked"
    : readyForClientRuntime
      ? "ready"
      : adoption.status || "waiting-for-client";
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : adoption.nextAction || readiness.nextAction || "refresh-client-runtime-adoption";

  return {
    schemaVersion: "aios.mailchimp.client-runtime-adoption-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.clientRuntimeAdoptionArtifact || "client-runtime-adoption.json",
    artifactId: adoptionArtifact?.id || null,
    adoptionId: adoption.adoptionId || persistedState.clientRuntimeAdoptionId || null,
    readyForClientRuntime,
    missingStateKeys,
    commandAck: {
      required: permissionBlocked || adoption.commandAck?.required === true,
      pendingKeys: permissionBlocked ? [] : pendingAckKeys,
      ready: permissionBlocked === false && adoption.commandAck?.ready === true,
      requiredKeys: permissionBlocked ? [] : adoption.commandAck?.requiredKeys || []
    },
    resume: {
      resumeToken: adoption.resume?.resumeToken || persistedState.resumeToken || null,
      statusRevision: adoption.resume?.statusRevision || persistedState.statusRevision || null,
      ready: permissionBlocked === false && adoption.resume?.ready === true
    },
    validationSummary: {
      ...(adoption.validationSummary || {}),
      missingStateKeys: missingStateKeys.length,
      pendingAckKeys: pendingAckKeys.length,
      artifactReady: Boolean(adoptionArtifact?.id)
    },
    clientPatch: {
      ...(adoption.clientPatch || {}),
      artifactName: persistedState.clientRuntimeAdoptionArtifact || "client-runtime-adoption.json",
      artifactReady: Boolean(adoptionArtifact?.id),
      clientRuntimeAdoptionStatus: status,
      clientRuntimeReady: readyForClientRuntime,
      clientRuntimeAdoptionNextAction: nextAction
    },
    restartSemantics: adoption.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-runtime-adoption-id",
      resumeFromAdoptionId: adoption.adoptionId || null,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function buildStatusRuntimeHandoff(diagnostics, metadata, artifacts, readiness, permissionHandoff, clientCommandLeases) {
  const statusHandoff = diagnostics.statusHandoff || {};
  const persistedState = artifacts.persistedState || {};
  const exportSummary = metadata.exports?.summary || {};
  const permissionBlocked = permissionHandoff.status === "blocked";
  const ack = statusHandoff.clientCommandAck || {};
  const adapterRecovery = statusHandoff.adapterRecovery || {};
  const restartContract = statusHandoff.restartContract || {};
  const statusLedger = statusHandoff.statusLedger || {};
  const artifactManifest = artifacts.handoffManifest || [];
  const statusSnapshotArtifact = artifactManifest.find((artifact) => artifact.name === "status-snapshot.json");
  const commandJournalArtifact = artifactManifest.find((artifact) => artifact.name === "command-journal.json");
  const clientLeaseArtifact = artifactManifest.find((artifact) => artifact.name === "client-command-leases.json");
  const baseState = permissionBlocked
    ? "blocked"
    : statusHandoff.handoffState || (readiness.status === "ready" ? "ready" : readiness.status);
  const blocksRuntime = permissionBlocked
    || ack.blocksRuntimeStart === true
    || adapterRecovery.mode === "blocked"
    || readiness.status === "blocked";
  const readyForRuntime = blocksRuntime === false
    && readiness.acceptedForRuntime === true
    && restartContract.replaySafe === true
    && Boolean(statusLedger.resumeToken)
    && Boolean(statusSnapshotArtifact?.id)
    && clientCommandLeases.ack?.required !== true;
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : statusHandoff.nextAction
      || clientCommandLeases.nextAction
      || readiness.nextAction
      || "handoff-to-runtime-adapter";

  return {
    schemaVersion: "aios.mailchimp.status-runtime-handoff.v1",
    provider: "mailchimp",
    status: blocksRuntime
      ? "blocked"
      : readyForRuntime
        ? "ready"
        : baseState === "waiting-for-client" || ack.required === true
          ? "waiting-for-client"
          : "degraded",
    handoffState: baseState,
    visibleStatus: permissionBlocked
      ? "permission-boundary-blocked"
      : statusHandoff.visibleStatus || "status-handoff-unavailable",
    readyForRuntime,
    readyForClient: permissionBlocked === false
      && Boolean(statusLedger.resumeToken)
      && Boolean(clientLeaseArtifact?.id),
    runtimeAdapter: statusHandoff.runtimeAdapter || metadata.runtimeAdapter,
    artifacts: {
      statusSnapshotArtifact: persistedState.statusSnapshotArtifact || "status-snapshot.json",
      statusSnapshotArtifactId: statusSnapshotArtifact?.id || null,
      commandJournalArtifact: persistedState.commandJournalArtifact || "command-journal.json",
      commandJournalArtifactId: commandJournalArtifact?.id || null,
      clientCommandLeasesArtifact: persistedState.clientCommandLeasesArtifact || "client-command-leases.json",
      clientCommandLeasesArtifactId: clientLeaseArtifact?.id || null
    },
    statusLedger: {
      statusRevision: statusLedger.statusRevision || exportSummary.statusRevision || persistedState.statusRevision || null,
      resumeToken: statusLedger.resumeToken || exportSummary.resumeToken || persistedState.resumeToken || null,
      readinessStatus: statusLedger.readinessStatus || readiness.status,
      persistedAtPhase: statusLedger.persistedAtPhase || "contract-handoff",
      commandIds: statusLedger.commandIds || [],
      blockingDiagnosticCount: statusLedger.blockingDiagnosticCount || 0,
      warningDiagnosticCount: statusLedger.warningDiagnosticCount || 0
    },
    clientCommandAck: {
      required: permissionBlocked || ack.required === true || clientCommandLeases.ack?.required === true,
      ackKeys: permissionBlocked ? [] : ack.ackKeys || clientCommandLeases.ack?.keys || [],
      nextAckKey: permissionBlocked ? null : ack.nextAckKey || clientCommandLeases.ack?.nextAckKey || null,
      resumeFromLeaseId: permissionBlocked ? null : ack.resumeFromLeaseId || clientCommandLeases.primaryLeaseId || null,
      resumeToken: ack.resumeToken
        || clientCommandLeases.resumeToken
        || statusLedger.resumeToken
        || persistedState.commandLeaseResumeToken
        || null,
      blocksRuntimeStart: permissionBlocked || ack.blocksRuntimeStart === true || clientCommandLeases.status === "blocked"
    },
    adapterRecovery: {
      mode: permissionBlocked ? "blocked" : adapterRecovery.mode || "unknown",
      queueLength: adapterRecovery.queueLength || 0,
      blocking: permissionBlocked ? (adapterRecovery.blocking || 0) + 1 : adapterRecovery.blocking || 0,
      retryable: adapterRecovery.retryable || 0,
      nextRetry: permissionBlocked ? null : adapterRecovery.nextRetry || null,
      acceptedForRuntime: readyForRuntime,
      degradedMode: permissionBlocked || adapterRecovery.degradedMode === true,
      resumeFromFailureId: permissionBlocked ? null : adapterRecovery.resumeFromFailureId || null,
      nextAction
    },
    restartContract: {
      replaySafe: permissionBlocked === false && restartContract.replaySafe === true,
      duplicateCommandPolicy: restartContract.duplicateCommandPolicy || "dedupe-by-idempotency-key",
      resumeFromCommandId: restartContract.resumeFromCommandId || null,
      resumeAction: permissionBlocked ? permissionHandoff.nextAction : restartContract.resumeAction || nextAction,
      externalWritesPerformed: false,
      statusOnResume: restartContract.statusOnResume || readiness.status,
      staleStatusPolicy: restartContract.staleStatusPolicy || {
        onRevisionMismatch: "reload-status-ledger",
        onMissingCommandJournal: "regenerate-command-journal",
        onMissingClientAck: "refresh-client-command-leases",
        onAdapterCursorExpired: "refresh-adapter-status-before-release"
      }
    },
    clientPatch: {
      ...(statusHandoff.clientPatch || {}),
      statusHandoffArtifactReady: Boolean(statusSnapshotArtifact?.id),
      handoffState: baseState,
      visibleStatus: permissionBlocked
        ? "permission-boundary-blocked"
        : statusHandoff.visibleStatus || "status-handoff-unavailable",
      readyForRuntime,
      nextAction,
      statusRevision: statusLedger.statusRevision || persistedState.statusRevision || null,
      resumeToken: statusLedger.resumeToken || persistedState.resumeToken || null,
      commandAckRequired: permissionBlocked || ack.required === true || clientCommandLeases.ack?.required === true
    },
    nextAction
  };
}

function buildStatusRecoveryRuntimeHandoff(diagnostics, metadata, artifacts, readiness, statusHandoff) {
  const recovery = metadata.statusRecovery || diagnostics.statusRecoveryBundle || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const recoveryArtifact = manifest.find((artifact) => artifact.name === "status-recovery-bundle.json");
  const resume = recovery.resume || {};
  const blocking = recovery.blocking || {};
  const missingRequired = Array.isArray(blocking.missingRequiredCheckpoints)
    ? blocking.missingRequiredCheckpoints
    : [];
  const readyForRuntimeResume = recovery.readyForRuntimeResume === true
    && Boolean(recoveryArtifact?.id)
    && missingRequired.length === 0
    && statusHandoff.clientCommandAck?.required !== true
    && readiness.status !== "blocked";
  const status = missingRequired.length > 0 || statusHandoff.status === "blocked"
    ? "blocked"
    : readyForRuntimeResume
      ? "ready"
      : recovery.state === "waiting-for-client"
        ? "waiting-for-client"
        : recovery.state || "degraded";
  const nextAction = readyForRuntimeResume
    ? "handoff-to-runtime-adapter"
    : recovery.nextAction
      || statusHandoff.nextAction
      || readiness.nextAction
      || "repair-status-recovery";

  return {
    schemaVersion: "aios.mailchimp.status-recovery-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.statusRecoveryBundleArtifact || "status-recovery-bundle.json",
    artifactId: recoveryArtifact?.id || null,
    readyForRuntimeResume,
    resume: {
      resumeToken: resume.resumeToken || persistedState.statusRecoveryResumeToken || persistedState.resumeToken || null,
      statusRevision: resume.statusRevision || persistedState.statusRevision || null,
      statusOnResume: resume.statusOnResume || diagnostics.status || readiness.status,
      resumeFromCommandId: resume.resumeFromCommandId || statusHandoff.restartContract?.resumeFromCommandId || null,
      resumeFromLeaseId: resume.resumeFromLeaseId || statusHandoff.clientCommandAck?.resumeFromLeaseId || null,
      resumeFromFailureId: resume.resumeFromFailureId || statusHandoff.adapterRecovery?.resumeFromFailureId || null
    },
    checkpoints: Array.isArray(recovery.checkpoints)
      ? recovery.checkpoints.map((checkpoint) => ({
        phase: checkpoint.phase,
        required: checkpoint.required === true,
        ready: checkpoint.ready === true,
        cursor: checkpoint.cursor || null,
        nextAction: checkpoint.nextAction || nextAction
      }))
      : [],
    counters: recovery.counters || {},
    blocking: {
      commandIds: blocking.commandIds || [],
      leaseIds: blocking.leaseIds || [],
      missingRequiredCheckpoints: missingRequired,
      adapterMode: blocking.adapterMode || statusHandoff.adapterRecovery?.mode || "unknown"
    },
    restartSemantics: {
      replaySafe: recovery.restartSemantics?.replaySafe === true
        || statusHandoff.restartContract?.replaySafe === true,
      duplicateCommandPolicy: recovery.restartSemantics?.duplicateCommandPolicy
        || statusHandoff.restartContract?.duplicateCommandPolicy
        || "dedupe-by-idempotency-key",
      staleStatusPolicy: recovery.restartSemantics?.staleStatusPolicy
        || statusHandoff.restartContract?.staleStatusPolicy
        || {},
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(recovery.clientPatch || {}),
      artifactName: persistedState.statusRecoveryBundleArtifact || "status-recovery-bundle.json",
      artifactReady: Boolean(recoveryArtifact?.id),
      statusRecoveryState: status,
      statusRecoveryReady: readyForRuntimeResume,
      statusRecoveryNextAction: nextAction,
      statusRecoveryResumeToken: resume.resumeToken || persistedState.statusRecoveryResumeToken || null,
      statusRecoveryRevision: resume.statusRevision || persistedState.statusRevision || null
    },
    nextAction
  };
}

function buildOperationalContractState(readiness, permissionHandoff, diagnostics, metadata, artifacts) {
  const health = metadata.health || {};
  const retry = health.retry || {};
  const adapterFailureState = health.adapterFailureState || {};
  const exportSummary = metadata.exports?.summary || {};
  const artifactCheck = assertMailchimpArtifactsReady(artifacts);
  const previewAcceptance = buildPreviewAcceptanceHandoff(metadata, artifacts, readiness, permissionHandoff);
  const lifecycleControls = buildLifecycleControlsHandoff(metadata, artifacts, readiness, permissionHandoff);
  const clientWorkflow = buildClientWorkflowContractHandoff(metadata, artifacts, readiness, permissionHandoff);
  const clientRuntimeAdoption = buildClientRuntimeAdoptionHandoff(metadata, artifacts, readiness, permissionHandoff);
  const providerServiceHandoff = buildProviderServiceRuntimeHandoff(metadata, artifacts, readiness);
  const clientCommandLeases = buildClientCommandLeaseRuntimeHandoff(metadata, artifacts, readiness, permissionHandoff);
  const statusHandoff = buildStatusRuntimeHandoff(
    diagnostics,
    metadata,
    artifacts,
    readiness,
    permissionHandoff,
    clientCommandLeases
  );
  const statusRecoveryHandoff = buildStatusRecoveryRuntimeHandoff(
    diagnostics,
    metadata,
    artifacts,
    readiness,
    statusHandoff
  );
  const readinessFailures = (readiness.checks || [])
    .filter((check) => check.required && !check.passed)
    .map((check) => ({
      id: check.id,
      nextAction: check.nextAction || "repair-contract-check",
      category: "contract-readiness"
    }));
  const permissionFailures = permissionHandoff.status === "blocked"
    ? [{
      id: "mailchimp.contract.permissions",
      nextAction: permissionHandoff.nextAction,
      category: "permission-boundary"
    }]
    : [];
  const artifactFailures = artifactCheck.requiredMissingPayload.map((name) => ({
    id: `mailchimp.contract.artifact.${name}`,
    nextAction: "regenerate-required-artifacts",
    category: "artifact-payload"
  }));
  const previewFailures = previewAcceptance.status === "blocked"
    ? [{
      id: "mailchimp.contract.preview-acceptance",
      nextAction: previewAcceptance.nextAction,
      category: "preview-acceptance"
    }]
    : [];
  const lifecycleFailures = lifecycleControls.status === "blocked"
    ? [{
      id: "mailchimp.contract.lifecycle-controls",
      nextAction: lifecycleControls.nextAction,
      category: "lifecycle-controls"
    }]
    : [];
  const providerServiceFailures = providerServiceHandoff.readyForRuntime === false
    ? [{
      id: "mailchimp.contract.provider-service",
      nextAction: providerServiceHandoff.nextAction,
      category: "provider-service-handoff"
    }]
    : [];
  const clientWorkflowFailures = clientWorkflow.status === "blocked"
    ? [{
      id: "mailchimp.contract.client-workflow",
      nextAction: clientWorkflow.explainNextStep.action,
      category: "client-workflow"
    }]
    : [];
  const clientCommandLeaseFailures = clientCommandLeases.readyForClient === false || clientCommandLeases.status === "blocked"
    ? [{
      id: "mailchimp.contract.client-command-leases",
      nextAction: clientCommandLeases.nextAction,
      category: "client-command-leases"
    }]
    : [];
  const clientRuntimeAdoptionFailures = clientRuntimeAdoption.status === "blocked"
    || clientRuntimeAdoption.readyForClientRuntime === false && clientRuntimeAdoption.commandAck.required !== true
    ? [{
      id: "mailchimp.contract.client-runtime-adoption",
      nextAction: clientRuntimeAdoption.nextAction,
      category: "client-runtime-adoption"
    }]
    : [];
  const statusHandoffFailures = statusHandoff.readyForClient === false || statusHandoff.status === "blocked"
    ? [{
      id: "mailchimp.contract.status-handoff",
      nextAction: statusHandoff.nextAction,
      category: "status-handoff"
    }]
    : [];
  const statusRecoveryFailures = statusRecoveryHandoff.status === "blocked"
    ? [{
      id: "mailchimp.contract.status-recovery",
      nextAction: statusRecoveryHandoff.nextAction,
      category: "status-recovery"
    }]
    : [];
  const failures = [
    ...readinessFailures,
    ...permissionFailures,
    ...artifactFailures,
    ...previewFailures,
    ...lifecycleFailures,
    ...providerServiceFailures,
    ...clientWorkflowFailures,
    ...clientCommandLeaseFailures,
    ...clientRuntimeAdoptionFailures,
    ...statusHandoffFailures,
    ...statusRecoveryFailures
  ];
  const degradedReasons = [
    ...(health.degradedReasons || []),
    ...(permissionHandoff.approvalRequired ? ["permission-approval-required"] : []),
    ...(permissionHandoff.status === "blocked" ? ["permission-boundary-blocked"] : []),
    ...(permissionHandoff.boundaryDiagnosticIds?.length ? ["permission-boundary-diagnostics"] : []),
    ...(artifactCheck.statusSnapshotReady === false ? ["status-snapshot-missing"] : []),
    ...(artifactCheck.commandJournalReady === false ? ["command-journal-missing"] : []),
    ...(artifactCheck.failureStateReady === false ? ["failure-state-missing"] : []),
    ...(artifactCheck.previewAcceptanceReady === false ? ["preview-acceptance-missing"] : []),
    ...(artifactCheck.lifecycleControlsReady === false ? ["lifecycle-controls-missing"] : []),
    ...(artifactCheck.exportSummaryReady === false ? ["export-summary-missing"] : []),
    ...(artifactCheck.providerServiceReady === false ? ["provider-service-handoff-missing"] : []),
    ...(artifactCheck.clientWorkflowReady === false ? ["client-workflow-missing"] : []),
    ...(artifactCheck.clientRuntimeAdoptionReady === false ? ["client-runtime-adoption-missing"] : []),
    ...(artifactCheck.clientCommandLeasesReady === false ? ["client-command-leases-missing"] : []),
    ...(clientCommandLeases.ack.required === true ? ["client-command-ack-required"] : []),
    ...(clientCommandLeases.status === "blocked" ? ["client-command-leases-blocked"] : []),
    ...(clientRuntimeAdoption.status === "blocked" ? ["client-runtime-adoption-blocked"] : []),
    ...(clientRuntimeAdoption.status === "waiting-for-client" ? ["client-runtime-adoption-waiting"] : []),
    ...(statusHandoff.readyForClient === false ? ["status-handoff-not-client-ready"] : []),
    ...(statusHandoff.readyForRuntime === false ? ["status-handoff-not-runtime-ready"] : []),
    ...(statusHandoff.clientCommandAck.required === true ? ["status-handoff-ack-required"] : []),
    ...(statusRecoveryHandoff.readyForRuntimeResume === false ? ["status-recovery-not-ready"] : []),
    ...(statusRecoveryHandoff.status === "blocked" ? ["status-recovery-blocked"] : []),
    ...(providerServiceHandoff.readyForRuntime === false ? ["provider-service-handoff-not-ready"] : []),
    ...(clientWorkflow.status === "needs-operator-action" ? ["client-workflow-pending"] : []),
    ...(clientWorkflow.status === "blocked" ? ["client-workflow-blocked"] : []),
    ...(previewAcceptance.status === "needs-operator-action" ? ["preview-acceptance-pending"] : []),
    ...(previewAcceptance.status === "blocked" ? ["preview-acceptance-blocked"] : []),
    ...(lifecycleControls.status === "needs-operator-action" ? ["lifecycle-controls-pending"] : []),
    ...(lifecycleControls.status === "blocked" ? ["lifecycle-controls-blocked"] : []),
    ...(adapterFailureState.mode === "blocked" ? ["adapter-failure-state-blocked"] : []),
    ...(adapterFailureState.mode === "degraded" ? ["adapter-failure-state-degraded"] : [])
  ].filter(Boolean);
  const status = failures.length > 0
    ? "failed"
    : readiness.status === "needs-operator-action" || health.degradedMode === true
      ? "degraded"
      : "ready";

  return {
    schemaVersion: "aios.mailchimp.operational-contract.v1",
    status,
    healthLevel: health.level || (status === "ready" ? "healthy" : "degraded"),
    degradedMode: status !== "ready" || health.degradedMode === true,
    degradedReasons: Array.from(new Set(degradedReasons)).sort(),
    failures,
    retry: {
      retryable: failures.length === 0
        && retry.retryable !== false
        && adapterFailureState.mode !== "blocked",
      backoffMs: failures.length > 0
        ? 0
        : adapterFailureState.nextRetry?.backoffMs ?? retry.backoffMs ?? 0,
      maxAttempts: failures.length > 0
        ? 0
        : adapterFailureState.nextRetry?.maxAttempts ?? retry.maxAttempts ?? 1,
      nextAction: failures[0]?.nextAction
        || adapterFailureState.adapterHandoff?.nextAction
        || retry.nextAction
        || readiness.nextAction,
      reason: failures.length > 0
        ? failures[0].category
        : adapterFailureState.mode && adapterFailureState.mode !== "ready"
          ? "adapter-failure-state"
          : retry.reason || "contract-ready"
    },
    lifecycleControls: {
      runtimeStartEnabled: readiness.acceptedForRuntime === true
        && permissionHandoff.allowed === true
        && providerServiceHandoff.readyForRuntime === true
        && clientRuntimeAdoption.readyForClientRuntime === true
        && statusHandoff.readyForRuntime === true
        && statusRecoveryHandoff.readyForRuntimeResume === true
        && previewAcceptance.runtimeStartEnabledAfterAcceptance === true
        && lifecycleControls.runtimeStartEnabled === true
        && status === "ready"
        && adapterFailureState.mode !== "blocked",
      previewEnabled: readiness.acceptedForClientPreview === true
        && permissionHandoff.status !== "blocked"
        && providerServiceHandoff.status !== "blocked"
        && previewAcceptance.previewEnabled === true
        && lifecycleControls.readyForClient === true,
      retryEnabled: adapterFailureState.retryable > 0 && adapterFailureState.mode !== "blocked",
      disableReason: failures[0]?.category
        || (permissionHandoff.status === "blocked" ? "permission-boundary" : null)
        || (adapterFailureState.mode === "blocked" ? "adapter-failure-state" : null),
      nextAction: failures[0]?.nextAction
        || adapterFailureState.adapterHandoff?.nextAction
        || readiness.nextAction
    },
    adapterFailureState: {
      mode: adapterFailureState.mode || "unknown",
      queueLength: adapterFailureState.queueLength || 0,
      blocking: adapterFailureState.blocking || 0,
      retryable: adapterFailureState.retryable || 0,
      nextRetry: adapterFailureState.nextRetry || null,
      artifact: artifacts.persistedState?.failureStateArtifact || null
    },
    previewAcceptance,
    clientWorkflow,
    clientRuntimeAdoption,
    clientCommandLeases,
    statusHandoff,
    statusRecoveryHandoff,
    providerServiceHandoff,
    lifecycleControlHandoff: lifecycleControls,
    statusResume: {
      resumeToken: exportSummary.resumeToken || health.statusHandoff?.resumeToken || null,
      statusRevision: exportSummary.statusRevision || health.statusHandoff?.statusRevision || null,
      latestSnapshotId: metadata.history?.latestSnapshotId || null,
      persistedStateArtifact: artifacts.persistedState?.artifactName || null,
      permissionBoundaryArtifact: artifacts.persistedState?.permissionBoundaryArtifact || null,
      tenantIsolationKey: artifacts.persistedState?.tenantIsolationKey || null,
      commandJournalArtifact: artifacts.persistedState?.commandJournalArtifact || null,
      clientCommandLeasesArtifact: artifacts.persistedState?.clientCommandLeasesArtifact || null,
      clientRuntimeAdoptionArtifact: artifacts.persistedState?.clientRuntimeAdoptionArtifact || null,
      clientRuntimeAdoptionId: artifacts.persistedState?.clientRuntimeAdoptionId || clientRuntimeAdoption.adoptionId,
      clientRuntimeAdoptionStatus: artifacts.persistedState?.clientRuntimeAdoptionStatus || clientRuntimeAdoption.status,
      clientRuntimeReady: clientRuntimeAdoption.readyForClientRuntime === true,
      commandLeaseResumeToken: artifacts.persistedState?.commandLeaseResumeToken || null,
      clientCommandLeaseStatus: artifacts.persistedState?.clientCommandLeaseStatus || clientCommandLeases.status,
      clientCommandAckRequired: artifacts.persistedState?.clientCommandAckRequired === true
        || clientCommandLeases.ack.required === true,
      statusHandoffState: statusHandoff.handoffState,
      statusHandoffVisibleStatus: statusHandoff.visibleStatus,
      statusHandoffReadyForClient: statusHandoff.readyForClient,
      statusHandoffReadyForRuntime: statusHandoff.readyForRuntime,
      statusHandoffNextAction: statusHandoff.nextAction,
      statusRecoveryArtifact: artifacts.persistedState?.statusRecoveryBundleArtifact || null,
      statusRecoveryReady: statusRecoveryHandoff.readyForRuntimeResume === true,
      statusRecoveryState: statusRecoveryHandoff.status,
      statusRecoveryNextAction: statusRecoveryHandoff.nextAction,
      statusRecoveryResumeToken: statusRecoveryHandoff.resume.resumeToken || null,
      statusSnapshotArtifact: artifacts.persistedState?.statusSnapshotArtifact || null,
      failureStateArtifact: artifacts.persistedState?.failureStateArtifact || null,
      providerServiceHandoffArtifact: artifacts.persistedState?.providerServiceHandoffArtifact || null,
      providerServiceHandoffReady: artifacts.persistedState?.providerServiceHandoffReady === true,
      providerServiceHandoffKey: artifacts.persistedState?.providerServiceHandoffKey || null,
      previewAcceptanceArtifact: artifacts.persistedState?.previewAcceptanceArtifact || null,
      clientWorkflowArtifact: artifacts.persistedState?.clientWorkflowArtifact || null,
      clientWorkflowStatus: artifacts.persistedState?.clientWorkflowStatus || clientWorkflow.status,
      clientWorkflowAction: artifacts.persistedState?.clientWorkflowAction || clientWorkflow.primaryAction,
      previewAcceptanceToken: artifacts.persistedState?.previewAcceptanceToken || null,
      lifecycleControlsArtifact: artifacts.persistedState?.lifecycleControlsArtifact || null,
      lifecycleStatus: artifacts.persistedState?.lifecycleStatus || lifecycleControls.status,
      lifecycleRuntimeStartEnabled: artifacts.persistedState?.lifecycleRuntimeStartEnabled === true
    },
    actionableErrors: health.actionableErrors || []
  };
}

export function emitMailchimpContract(source = {}, options = {}) {
  const job = compileIfNeeded(source, options);
  const diagnostics = emitMailchimpDiagnostics(job, options);
  const metadata = emitMailchimpMetadata(job, options);
  const artifacts = emitMailchimpArtifacts(job, options);
  const readiness = buildContractReadiness(job, diagnostics, metadata, artifacts);
  const workspaceBoundary = deriveWorkspaceBoundary(job, metadata, diagnostics, options);
  const permissionHandoff = buildPermissionHandoff(workspaceBoundary, metadata, diagnostics);
  const auditHandoff = buildAuditHandoff(job, workspaceBoundary, permissionHandoff, artifacts);
  const operationalState = buildOperationalContractState(readiness, permissionHandoff, diagnostics, metadata, artifacts);
  const status = permissionHandoff.status === "blocked" ? "blocked" : readiness.status;

  return {
    kind: "aios.mailchimp.contractEmission",
    schemaVersion: "aios.mailchimp.contract.v1",
    provider: "mailchimp",
    jobId: job.id,
    task: job.task,
    status,
    readiness,
    dataContract: buildRuntimeDataContract(job, metadata),
    providerServiceHandoff: operationalState.providerServiceHandoff,
    clientWorkflowHandoff: operationalState.clientWorkflow,
    clientRuntimeAdoptionHandoff: operationalState.clientRuntimeAdoption,
    clientCommandLeaseHandoff: operationalState.clientCommandLeases,
    statusRuntimeHandoff: operationalState.statusHandoff,
    statusRecoveryHandoff: operationalState.statusRecoveryHandoff,
    workspaceBoundary,
    permissions: permissionHandoff,
    auditHandoff,
    operationalState,
    contracts: {
      jobDescriptor: job,
      diagnostics,
      metadata,
      artifacts
    },
    handoff: {
      runtimeAdapter: metadata.runtimeAdapter,
      readinessStatus: metadata.runtime.readinessStatus,
      acceptedForRuntime: readiness.acceptedForRuntime,
      acceptedForClientPreview: readiness.acceptedForClientPreview,
      nextAction: permissionHandoff.status === "blocked" ? permissionHandoff.nextAction : readiness.nextAction,
      artifactManifest: artifacts.handoffManifest,
      persistedState: artifacts.persistedState,
      statusResume: operationalState.statusResume,
      lifecycleControls: operationalState.lifecycleControls,
      lifecycleControlHandoff: operationalState.lifecycleControlHandoff,
      providerServiceHandoff: operationalState.providerServiceHandoff,
      clientWorkflow: operationalState.clientWorkflow,
      clientRuntimeAdoption: operationalState.clientRuntimeAdoption,
      clientCommandLeases: operationalState.clientCommandLeases,
      statusHandoff: operationalState.statusHandoff,
      statusRecovery: operationalState.statusRecoveryHandoff,
      adapterFailureState: operationalState.adapterFailureState,
      previewAcceptance: operationalState.previewAcceptance,
      audit: auditHandoff
    },
    recovery: {
      strategy: operationalState.status === "failed" ? "repair-operational-contract" : diagnostics.recovery.strategy,
      nextAction: operationalState.retry.nextAction
        || (permissionHandoff.status === "blocked" ? permissionHandoff.nextAction : readiness.nextAction),
      requiredActionCount: diagnostics.recovery.requiredActionCount,
      requiredArtifactNames: artifacts.recovery.requiredArtifactNames,
      retry: operationalState.retry,
      statusResume: operationalState.statusResume,
      statusRecovery: operationalState.statusRecoveryHandoff,
      failures: operationalState.failures
    },
    truthBoundary: {
      source: "contract-emitter",
      deterministic: true,
      externalWrites: false,
      externalMailchimpStateVerified: false,
      dynamicImportSafe: true,
      tenantIsolated: workspaceBoundary.safeBoundary,
      auditHandoffIncluded: true,
      operationalStateIncluded: true,
      lifecycleControlsIncluded: true,
      lifecycleControlHandoffIncluded: true,
      clientWorkflowHandoffIncluded: true,
      clientRuntimeAdoptionHandoffIncluded: true,
      adapterFailureStateIncluded: true,
      previewAcceptanceIncluded: true
      ,
      providerServiceHandoffIncluded: true,
      clientCommandLeaseHandoffIncluded: true,
      statusRuntimeHandoffIncluded: true
      ,
      statusRecoveryHandoffIncluded: true
    }
  };
}

export function assertMailchimpContractReady(contract) {
  const readiness = contract?.readiness || {};
  const permissions = contract?.permissions || {};
  return {
    ok: contract?.provider === "mailchimp"
      && contract?.schemaVersion === "aios.mailchimp.contract.v1"
      && readiness.acceptedForClientPreview === true
      && permissions.status !== "blocked"
      && contract?.workspaceBoundary?.safeBoundary === true
      && contract?.operationalState?.status !== "failed"
      && Boolean(contract?.operationalState?.statusResume?.resumeToken)
      && Boolean(contract?.operationalState?.lifecycleControls?.nextAction)
      && contract?.operationalState?.providerServiceHandoff?.schemaVersion === "aios.mailchimp.provider-service-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.providerServiceHandoff?.externalHandoff?.idempotencyKey)
      && contract?.operationalState?.clientWorkflow?.schemaVersion === "aios.mailchimp.client-workflow-handoff.v1"
      && Boolean(contract?.operationalState?.clientWorkflow?.explainNextStep?.action)
      && contract?.operationalState?.clientRuntimeAdoption?.schemaVersion === "aios.mailchimp.client-runtime-adoption-handoff.v1"
      && Boolean(contract?.operationalState?.clientRuntimeAdoption?.adoptionId)
      && contract?.operationalState?.clientCommandLeases?.schemaVersion === "aios.mailchimp.client-command-lease-handoff.v1"
      && Boolean(contract?.operationalState?.clientCommandLeases?.resumeToken)
      && contract?.operationalState?.statusHandoff?.schemaVersion === "aios.mailchimp.status-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.statusHandoff?.statusLedger?.resumeToken)
      && contract?.operationalState?.statusRecoveryHandoff?.schemaVersion === "aios.mailchimp.status-recovery-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.statusRecoveryHandoff?.resume?.resumeToken)
      && contract?.operationalState?.lifecycleControlHandoff?.schemaVersion === "aios.mailchimp.lifecycle-controls-handoff.v1"
      && Boolean(contract?.operationalState?.previewAcceptance?.acceptanceToken)
      && Array.isArray(contract?.handoff?.artifactManifest),
    status: contract?.status || "unknown",
    acceptedForRuntime: readiness.acceptedForRuntime === true,
    permissionStatus: permissions.status || "unknown",
    operationalStatus: contract?.operationalState?.status || "unknown",
    runtimeStartEnabled: contract?.operationalState?.lifecycleControls?.runtimeStartEnabled === true,
    lifecycleStatus: contract?.operationalState?.lifecycleControlHandoff?.status || "unknown",
    lifecycleArtifact: contract?.operationalState?.lifecycleControlHandoff?.artifactName || null,
    providerServiceStatus: contract?.operationalState?.providerServiceHandoff?.status || "unknown",
    providerServiceHandoffReady: contract?.operationalState?.providerServiceHandoff?.readyForRuntime === true,
    clientWorkflowStatus: contract?.operationalState?.clientWorkflow?.status || "unknown",
    clientWorkflowReady: contract?.operationalState?.clientWorkflow?.readyForClient === true,
    clientRuntimeAdoptionStatus: contract?.operationalState?.clientRuntimeAdoption?.status || "unknown",
    clientRuntimeReady: contract?.operationalState?.clientRuntimeAdoption?.readyForClientRuntime === true,
    clientRuntimeAdoptionNextAction: contract?.operationalState?.clientRuntimeAdoption?.nextAction || null,
    clientCommandLeaseStatus: contract?.operationalState?.clientCommandLeases?.status || "unknown",
    clientCommandLeaseReady: contract?.operationalState?.clientCommandLeases?.readyForClient === true,
    clientCommandAckRequired: contract?.operationalState?.clientCommandLeases?.ack?.required === true,
    statusHandoffStatus: contract?.operationalState?.statusHandoff?.status || "unknown",
    statusHandoffReady: contract?.operationalState?.statusHandoff?.readyForClient === true,
    statusHandoffRuntimeReady: contract?.operationalState?.statusHandoff?.readyForRuntime === true,
    statusHandoffVisibleStatus: contract?.operationalState?.statusHandoff?.visibleStatus || "unknown",
    statusRecoveryState: contract?.operationalState?.statusRecoveryHandoff?.status || "unknown",
    statusRecoveryReady: contract?.operationalState?.statusRecoveryHandoff?.readyForRuntimeResume === true,
    statusRecoveryNextAction: contract?.operationalState?.statusRecoveryHandoff?.nextAction || null,
    retryEnabled: contract?.operationalState?.lifecycleControls?.retryEnabled === true,
    previewAcceptanceStatus: contract?.operationalState?.previewAcceptance?.status || "unknown",
    previewAcceptanceToken: contract?.operationalState?.previewAcceptance?.acceptanceToken || null,
    failureMode: contract?.operationalState?.adapterFailureState?.mode || "unknown",
    auditReady: contract?.auditHandoff?.safeToRecord === true,
    nextAction: permissions.status === "blocked"
      ? permissions.nextAction
      : contract?.operationalState?.retry?.nextAction || readiness.nextAction || "emit-mailchimp-contract"
  };
}

export {
  emitMailchimpArtifacts,
  emitMailchimpDiagnostics,
  emitMailchimpMetadata
};
