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
    previewAcceptancePacketPayloadShape: {
      status: "string",
      routeId: "string",
      acceptanceToken: "string",
      readyForAcceptance: "boolean",
      readyForRuntimeStart: "boolean",
      statusLedger: "object",
      routePayload: "object",
      checkpoints: "array",
      validationSummary: "object",
      clientPatch: "object",
      restartSemantics: "object"
    },
    previewReleaseTicketPayloadShape: {
      status: "string",
      ticketKey: "string",
      releaseKey: "string",
      readyForRuntimeRelease: "boolean",
      nextAction: "string",
      routePayload: "object",
      rows: "array",
      validationSummary: "object",
      clientPatch: "object",
      restartSemantics: "object"
    },
    previewHandoffPayloadShape: {
      status: "string",
      routeId: "string",
      routePayload: "object",
      acceptance: "object",
      validationSummary: "object",
      gates: "array",
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
    clientRuntimeSettingsPayloadShape: {
      status: "string",
      settingsRevision: "string",
      readyForClientRuntime: "boolean",
      missingRequiredSettings: "array",
      controls: "object",
      adoption: "object",
      clientPatch: "object"
    },
    settingsRolloutGatePayloadShape: {
      status: "string",
      readyForRuntimeStart: "boolean",
      rolloutKey: "string",
      settingsRevision: "string",
      checkpoints: "array",
      blocking: "object",
      clientPatch: "object"
    },
    clientStatusHandoffPayloadShape: {
      status: "string",
      visibleStatus: "string",
      route: "object",
      statusLedger: "object",
      commandAck: "object",
      blocking: "object",
      clientPatch: "object"
    },
    persistedStatusEnvelopePayloadShape: {
      status: "string",
      readyForRuntimeResume: "boolean",
      readyForClientStatus: "boolean",
      resumeToken: "string",
      statusRevision: "string",
      rows: "array",
      blocking: "object",
      routePayload: "object",
      restartSemantics: "object"
    },
    runtimeStatusReplayCursorPayloadShape: {
      status: "string",
      readyForRestart: "boolean",
      readyForRuntimeRelease: "boolean",
      replayCursor: "string",
      resumeToken: "string",
      statusRevision: "string",
      rows: "array",
      blocking: "object",
      routePayload: "object",
      restartSemantics: "object"
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
    providerSyncCheckpointPayloadShape: {
      status: "string",
      ready: "boolean",
      resumeToken: "string",
      rows: "array",
      missingAckMounts: "array",
      missingWatermarkMounts: "array",
      restartSemantics: "object",
      clientPatch: "object"
    },
    providerExportReadinessPayloadShape: {
      status: "string",
      exportReady: "boolean",
      readyForRuntime: "boolean",
      exportKey: "string",
      resumeToken: "string",
      rows: "array",
      validationSummary: "object",
      routePayload: "object",
      externalHandoff: "object",
      clientPatch: "object",
      restartSemantics: "object"
    },
    providerCallbackHandoffPayloadShape: {
      status: "string",
      ready: "boolean",
      callbackKey: "string",
      resumeToken: "string",
      endpoint: "object",
      events: "object",
      rows: "array",
      routePayload: "object",
      clientPatch: "object",
      restartSemantics: "object"
    },
    providerIntegrationHandoffPayloadShape: {
      status: "string",
      readyForRuntime: "boolean",
      integrationKey: "string",
      nextAction: "string",
      nextGateId: "string-or-null",
      gates: "array",
      validationSummary: "object",
      capabilityNegotiation: "object",
      sync: "object",
      externalHandoff: "object",
      restartSemantics: "object",
      clientPatch: "object"
    },
    providerIntegrationExecutionTicketPayloadShape: {
      status: "string",
      readyForRuntimeRelease: "boolean",
      ticketKey: "string",
      resumeCursor: "string",
      routePayload: "object",
      gates: "array",
      operations: "array",
      validationSummary: "object",
      clientPatch: "object",
      restartSemantics: "object"
    },
    previewExportReadinessPayloadShape: {
      status: "string",
      ready: "boolean",
      readyForClientPreview: "boolean",
      readyForRuntimeStart: "boolean",
      resumeToken: "string",
      validationSummary: "object",
      rows: "array",
      clientPatch: "object",
      restartSemantics: "object"
    },
    previewReadinessManifestPayloadShape: {
      status: "string",
      visibleStatus: "string",
      readyForClientPreview: "boolean",
      readyForRuntimeStart: "boolean",
      nextAction: "string",
      nextSectionId: "string-or-null",
      route: "object",
      validationSummary: "object",
      sections: "array",
      clientPatch: "object",
      restartSemantics: "object"
    },
    runtimeReleaseControlsPayloadShape: {
      status: "string",
      readyForRuntimeStart: "boolean",
      releaseKey: "string",
      nextAction: "string",
      nextGateId: "string-or-null",
      gates: "array",
      clientPatch: "object",
      restartSemantics: "object"
    },
    serviceLevelObjectivePayloadShape: {
      status: "string",
      healthLevel: "string",
      readyForRuntimeRelease: "boolean",
      objectives: "array",
      breaches: "array",
      counters: "object",
      retry: "object",
      clientPatch: "object"
    },
    operationalHealthReportPayloadShape: {
      status: "string",
      healthLevel: "string",
      reportId: "string",
      exportReady: "boolean",
      readyForRuntimeStart: "boolean",
      resumeToken: "string",
      counters: "object",
      rows: "array",
      clientPatch: "object",
      restartSemantics: "object"
    },
    operationalIncidentExportPayloadShape: {
      status: "string",
      exportReady: "boolean",
      resumeToken: "string",
      statusRevision: "string",
      nextAction: "string",
      rows: "array",
      counters: "object",
      exportSummary: "object",
      clientPatch: "object",
      restartSemantics: "object"
    },
    runtimeExportWatermarkPayloadShape: {
      status: "string",
      exportReady: "boolean",
      cursor: "string",
      dedupeKey: "string",
      highWatermarks: "object",
      partitions: "array",
      counters: "object",
      exportSummary: "object",
      clientPatch: "object",
      restartSemantics: "object"
    },
    clientReadinessBriefPayloadShape: {
      status: "string",
      visibleStatus: "string",
      readyForClientPreview: "boolean",
      readyForRuntimeStart: "boolean",
      nextAction: "string",
      nextSectionId: "string-or-null",
      route: "object",
      validationSummary: "object",
      sections: "array",
      clientPatch: "object",
      restartSemantics: "object"
    },
    tenantPermissionEnforcementPayloadShape: {
      status: "string",
      enforcementKey: "string",
      isolationKey: "string",
      decisions: "array",
      audit: "object",
      counters: "object",
      clientPatch: "object",
      restartSemantics: "object"
    },
    tenantBoundaryPosturePayloadShape: {
      status: "string",
      postureKey: "string",
      isolationKey: "string",
      safeForRuntime: "boolean",
      safeForAuditAppend: "boolean",
      drift: "object",
      runtimeGate: "object",
      auditHandoff: "object",
      clientPatch: "object",
      restartSemantics: "object"
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

function buildProviderSyncCheckpointRuntimeHandoff(metadata, diagnostics, artifacts, readiness) {
  const checkpoint = metadata.providerSyncCheckpoint || diagnostics.providerSyncCheckpoint || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const checkpointArtifact = manifest.find((artifact) => artifact.name === "provider-sync-checkpoint.json");
  const rows = Array.isArray(checkpoint.rows)
    ? checkpoint.rows
    : Array.isArray(checkpoint.checkpointRows)
      ? checkpoint.checkpointRows
      : [];
  const missingAckMounts = normalizeList(checkpoint.missingAckMounts || []);
  const missingWatermarkMounts = normalizeList(checkpoint.missingWatermarkMounts || []);
  const missingHandoffMounts = normalizeList(checkpoint.missingHandoffMounts || []);
  const permissionBlocked = readiness.status === "blocked";
  const readyForRuntime = permissionBlocked === false
    && Boolean(checkpointArtifact?.id)
    && checkpoint.ready === true
    && missingAckMounts.length === 0
    && missingWatermarkMounts.length === 0
    && missingHandoffMounts.length === 0;
  const status = permissionBlocked
    ? "blocked"
    : readyForRuntime
      ? "ready"
      : checkpoint.status || "needs-operator-action";
  const nextAction = permissionBlocked
    ? readiness.nextAction
    : checkpoint.nextAction
      || (missingHandoffMounts.length > 0
        ? "declare-provider-sync-handoff"
        : missingAckMounts.length > 0
          ? "acknowledge-mailchimp-provider-sync"
          : missingWatermarkMounts.length > 0
            ? "restore-mailchimp-sync-watermark"
            : "refresh-provider-sync-checkpoint");

  return {
    schemaVersion: "aios.mailchimp.provider-sync-checkpoint-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    providerService: checkpoint.providerService || metadata.providerService?.providerService || "mailchimp-marketing-api",
    artifactName: persistedState.providerSyncCheckpointArtifact || "provider-sync-checkpoint.json",
    artifactId: checkpointArtifact?.id || null,
    readyForRuntime,
    syncRequired: checkpoint.syncRequired === true,
    resumeToken: checkpoint.resumeToken || persistedState.providerSyncCheckpointResumeToken || null,
    idempotencyKey: checkpoint.idempotencyKey || null,
    rows: rows.map((row) => ({
      name: row.name,
      syncDirection: row.syncDirection,
      ackKey: row.ackKey || null,
      acknowledged: row.acknowledged === true,
      watermark: row.watermark || null,
      ready: row.ready === true,
      nextAction: row.nextAction || nextAction
    })),
    blocking: {
      missingAckMounts,
      missingWatermarkMounts,
      missingHandoffMounts
    },
    clientPatch: {
      ...(checkpoint.clientPatch || {}),
      artifactName: persistedState.providerSyncCheckpointArtifact || "provider-sync-checkpoint.json",
      artifactReady: Boolean(checkpointArtifact?.id),
      providerSyncCheckpointStatus: status,
      providerSyncCheckpointReady: readyForRuntime,
      providerSyncCheckpointNextAction: nextAction
    },
    restartSemantics: checkpoint.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-sync-ack-key",
      resumeFromAckKey: rows.find((row) => row.ready !== true)?.ackKey || null,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function buildProviderExportReadinessRuntimeHandoff(metadata, diagnostics, artifacts, readiness, providerSyncCheckpoint) {
  const source = metadata.providerExportReadiness || diagnostics.providerExportReadiness || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const artifact = manifest.find((item) => item.name === "provider-export-readiness.json");
  const payload = artifacts.artifacts?.find((item) => item.name === "provider-export-readiness.json")?.payload
    || source;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.ready === false && row.id !== "status-ledger");
  const waitingRows = rows.filter((row) => row.ready === false && !blockedRows.includes(row));
  const permissionBlocked = readiness.status === "blocked";
  const syncBlocked = providerSyncCheckpoint.readyForRuntime === false
    && providerSyncCheckpoint.status !== "needs-operator-action";
  const readyForRuntime = permissionBlocked === false
    && syncBlocked === false
    && Boolean(artifact?.id)
    && payload.exportReady === true
    && blockedRows.length === 0
    && waitingRows.length === 0;
  const status = permissionBlocked || syncBlocked || blockedRows.length > 0
    ? "blocked"
    : readyForRuntime
      ? "ready"
      : waitingRows.length > 0
        ? "needs-operator-action"
        : payload.status || "needs-operator-action";
  const nextRow = blockedRows[0] || waitingRows[0] || null;
  const nextAction = permissionBlocked
    ? readiness.nextAction
    : syncBlocked
      ? providerSyncCheckpoint.nextAction || "repair-provider-sync-checkpoint"
      : nextRow?.nextAction
        || payload.nextAction
        || (readyForRuntime ? "publish-provider-export-readiness" : "refresh-provider-export-status");

  return {
    schemaVersion: "aios.mailchimp.provider-export-readiness-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    providerService: payload.providerService || metadata.providerService?.providerService || "mailchimp-marketing-api",
    artifactName: persistedState.providerExportReadinessArtifact || "provider-export-readiness.json",
    artifactId: artifact?.id || null,
    exportKey: payload.exportKey || persistedState.providerExportReadinessKey || null,
    resumeToken: payload.resumeToken || persistedState.providerExportReadinessResumeToken || null,
    readyForRuntime,
    exportReady: payload.exportReady === true,
    nextAction,
    rows: rows.map((row) => ({
      id: row.id,
      order: row.order,
      label: row.label,
      status: permissionBlocked || syncBlocked ? "blocked" : row.status,
      ready: permissionBlocked || syncBlocked ? false : row.ready === true,
      nextAction: permissionBlocked
        ? readiness.nextAction
        : syncBlocked
          ? providerSyncCheckpoint.nextAction
          : row.nextAction || nextAction,
      evidence: row.evidence || {}
    })),
    validationSummary: {
      ...(payload.validationSummary || {}),
      blockedRowIds: permissionBlocked
        ? ["contract-readiness"]
        : syncBlocked
          ? ["provider-sync-checkpoint"]
          : payload.validationSummary?.blockedRowIds || blockedRows.map((row) => row.id),
      waitingRowIds: permissionBlocked || syncBlocked
        ? []
        : payload.validationSummary?.waitingRowIds || waitingRows.map((row) => row.id)
    },
    routePayload: {
      ...(payload.routePayload || {}),
      artifactReady: Boolean(artifact?.id),
      dryRunOnly: true
    },
    externalHandoff: {
      ...(payload.externalHandoff || {}),
      ready: readyForRuntime,
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(payload.clientPatch || {}),
      artifactName: persistedState.providerExportReadinessArtifact || "provider-export-readiness.json",
      artifactReady: Boolean(artifact?.id),
      providerExportReadinessStatus: status,
      providerExportReady: readyForRuntime,
      providerExportNextAction: nextAction,
      providerExportResumeToken: payload.resumeToken || null
    },
    restartSemantics: payload.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-export-key",
      resumeToken: payload.resumeToken || null,
      externalWritesPerformed: false
    }
  };
}

function buildProviderCallbackRuntimeHandoff(metadata, diagnostics, artifacts, readiness, providerServiceHandoff) {
  const source = metadata.providerCallbackHandoff || diagnostics.providerCallbackHandoff || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const artifact = manifest.find((item) => item.name === "provider-callback-handoff.json");
  const payload = artifacts.artifacts?.find((item) => item.name === "provider-callback-handoff.json")?.payload
    || source;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const waitingRows = rows.filter((row) => row.ready === false && row.status !== "blocked");
  const permissionBlocked = readiness.status === "blocked";
  const serviceBlocked = providerServiceHandoff.readyForRuntime === false
    && providerServiceHandoff.status === "blocked";
  const readyForRuntime = permissionBlocked === false
    && serviceBlocked === false
    && Boolean(artifact?.id)
    && payload.ready === true
    && blockedRows.length === 0
    && waitingRows.length === 0;
  const status = permissionBlocked || serviceBlocked || blockedRows.length > 0
    ? "blocked"
    : readyForRuntime
      ? "ready"
      : waitingRows.length > 0
        ? "needs-operator-action"
        : payload.status || "needs-operator-action";
  const nextRow = blockedRows[0] || waitingRows[0] || null;
  const nextAction = permissionBlocked
    ? readiness.nextAction
    : serviceBlocked
      ? providerServiceHandoff.nextAction || "repair-provider-service-handoff"
      : nextRow?.nextAction
        || payload.nextAction
        || (readyForRuntime ? "handoff-to-runtime-adapter" : "repair-mailchimp-callback-handoff");

  return {
    schemaVersion: "aios.mailchimp.provider-callback-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    providerService: payload.providerService || metadata.providerService?.providerService || "mailchimp-marketing-api",
    artifactName: persistedState.providerCallbackHandoffArtifact || "provider-callback-handoff.json",
    artifactId: artifact?.id || null,
    callbackKey: payload.callbackKey || persistedState.providerCallbackKey || null,
    resumeToken: payload.resumeToken || persistedState.providerCallbackResumeToken || null,
    readyForRuntime,
    nextAction,
    endpoint: payload.endpoint || {},
    events: payload.events || {},
    rows: rows.map((row) => ({
      id: row.id,
      order: row.order,
      label: row.label,
      status: permissionBlocked || serviceBlocked ? "blocked" : row.status,
      ready: permissionBlocked || serviceBlocked ? false : row.ready === true,
      nextAction: permissionBlocked
        ? readiness.nextAction
        : serviceBlocked
          ? providerServiceHandoff.nextAction
          : row.nextAction || nextAction,
      evidence: row.evidence || {}
    })),
    validationSummary: {
      ...(payload.validationSummary || {}),
      blockedRowIds: permissionBlocked
        ? ["contract-readiness"]
        : serviceBlocked
          ? ["provider-service"]
          : payload.validationSummary?.blockedRowIds || blockedRows.map((row) => row.id),
      waitingRowIds: permissionBlocked || serviceBlocked
        ? []
        : payload.validationSummary?.waitingRowIds || waitingRows.map((row) => row.id)
    },
    routePayload: {
      ...(payload.routePayload || {}),
      artifactReady: Boolean(artifact?.id),
      dryRunOnly: true
    },
    clientPatch: {
      ...(payload.clientPatch || {}),
      artifactName: persistedState.providerCallbackHandoffArtifact || "provider-callback-handoff.json",
      artifactReady: Boolean(artifact?.id),
      providerCallbackStatus: status,
      providerCallbackReady: readyForRuntime,
      providerCallbackNextAction: nextAction,
      providerCallbackResumeToken: payload.resumeToken || null
    },
    restartSemantics: payload.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-callback-key",
      resumeToken: payload.resumeToken || null,
      externalWritesPerformed: false
    }
  };
}

function buildProviderIntegrationRuntimeHandoff(metadata, diagnostics, artifacts, readiness) {
  const source = metadata.providerIntegrationHandoff || diagnostics.providerIntegrationHandoff || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const artifact = manifest.find((item) => item.name === "provider-integration-handoff.json");
  const payload = artifacts.artifacts?.find((item) => item.name === "provider-integration-handoff.json")?.payload || source;
  const gates = Array.isArray(payload.gates) ? payload.gates : [];
  const blockedGates = gates.filter((gate) => gate.required !== false && gate.state === "blocked");
  const waitingGates = gates.filter((gate) => gate.required !== false && gate.state === "waiting");
  const permissionBlocked = readiness.status === "blocked";
  const readyForRuntime = permissionBlocked === false
    && Boolean(artifact?.id)
    && payload.readyForRuntime === true
    && blockedGates.length === 0
    && waitingGates.length === 0;
  const status = permissionBlocked
    ? "blocked"
    : readyForRuntime
      ? "ready"
      : blockedGates.length > 0
        ? "blocked"
        : waitingGates.length > 0
          ? "needs-operator-action"
          : payload.status || "unknown";
  const nextGate = gates.find((gate) => gate.gateId === payload.nextGateId)
    || blockedGates[0]
    || waitingGates[0]
    || null;
  const nextAction = permissionBlocked
    ? readiness.nextAction
    : readyForRuntime
      ? readiness.nextAction || "handoff-to-runtime-adapter"
      : payload.nextAction || nextGate?.nextAction || "repair-provider-integration-handoff";

  return {
    schemaVersion: "aios.mailchimp.provider-integration-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    providerService: payload.providerService || metadata.providerService?.providerService || "mailchimp-marketing-api",
    artifactName: persistedState.providerIntegrationHandoffArtifact || "provider-integration-handoff.json",
    artifactId: artifact?.id || null,
    integrationKey: payload.integrationKey || persistedState.providerIntegrationKey || null,
    readyForRuntime,
    nextAction,
    nextGateId: permissionBlocked ? "contract-readiness" : payload.nextGateId || nextGate?.gateId || null,
    resumeToken: payload.resumeToken || persistedState.providerIntegrationResumeToken || null,
    gates: gates.map((gate) => ({
      gateId: gate.gateId,
      state: permissionBlocked ? "blocked" : gate.state,
      required: gate.required !== false,
      nextAction: permissionBlocked ? readiness.nextAction : gate.nextAction || nextAction,
      evidence: gate.evidence || {}
    })),
    validationSummary: {
      ...(payload.validationSummary || {}),
      blockedGateIds: permissionBlocked
        ? ["contract-readiness"]
        : payload.validationSummary?.blockedGateIds || blockedGates.map((gate) => gate.gateId),
      waitingGateIds: permissionBlocked
        ? []
        : payload.validationSummary?.waitingGateIds || waitingGates.map((gate) => gate.gateId)
    },
    capabilityNegotiation: payload.capabilityNegotiation || {},
    sync: payload.sync || {},
    externalHandoff: {
      ...(payload.externalHandoff || {}),
      ready: readyForRuntime,
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(payload.clientPatch || {}),
      artifactName: persistedState.providerIntegrationHandoffArtifact || "provider-integration-handoff.json",
      artifactReady: Boolean(artifact?.id),
      providerIntegrationStatus: status,
      providerIntegrationReady: readyForRuntime,
      providerIntegrationNextAction: nextAction,
      providerIntegrationNextGateId: permissionBlocked ? "contract-readiness" : payload.nextGateId || nextGate?.gateId || null
    },
    restartSemantics: payload.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-integration-key",
      resumeToken: payload.resumeToken || null,
      externalWritesPerformed: false
    }
  };
}

function buildProviderIntegrationExecutionTicketRuntimeHandoff(
  metadata,
  diagnostics,
  artifacts,
  readiness,
  providerIntegrationHandoff
) {
  const source = metadata.providerIntegrationExecutionTicket
    || diagnostics.providerIntegrationExecutionTicket
    || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const artifact = manifest.find((item) => item.name === "provider-integration-execution-ticket.json");
  const payload = artifacts.artifacts?.find((item) => item.name === "provider-integration-execution-ticket.json")?.payload
    || source;
  const gates = Array.isArray(payload.gates) ? payload.gates : [];
  const operations = Array.isArray(payload.operations) ? payload.operations : [];
  const blockedGates = gates.filter((gate) => gate.required !== false && gate.state === "blocked");
  const waitingGates = gates.filter((gate) => gate.required !== false && ["waiting", "needs-operator-action"].includes(gate.state));
  const blockedOperations = operations.filter((operation) => operation.ticketState === "blocked");
  const waitingOperations = operations.filter((operation) => ["waiting", "needs-operator-action"].includes(operation.ticketState));
  const providerBlocked = providerIntegrationHandoff.status === "blocked"
    || providerIntegrationHandoff.readyForRuntime === false && providerIntegrationHandoff.status !== "needs-operator-action";
  const permissionBlocked = readiness.status === "blocked";
  const readyForRuntimeRelease = permissionBlocked === false
    && providerBlocked === false
    && Boolean(artifact?.id)
    && payload.readyForRuntimeRelease === true
    && blockedGates.length === 0
    && blockedOperations.length === 0
    && waitingGates.length === 0
    && waitingOperations.length === 0;
  const status = permissionBlocked || providerBlocked || blockedGates.length > 0 || blockedOperations.length > 0
    ? "blocked"
    : readyForRuntimeRelease
      ? "ready"
      : waitingGates.length > 0 || waitingOperations.length > 0
        ? "needs-operator-action"
        : payload.status || "unknown";
  const nextGate = blockedGates[0] || waitingGates[0] || null;
  const nextOperation = blockedOperations[0] || waitingOperations[0] || null;
  const nextAction = permissionBlocked
    ? readiness.nextAction
    : providerBlocked
      ? providerIntegrationHandoff.nextAction || "repair-provider-integration-handoff"
      : nextGate?.nextAction
        || nextOperation?.nextAction
        || payload.nextAction
        || (readyForRuntimeRelease ? "release-provider-execution-ticket" : "repair-provider-integration-execution-ticket");

  return {
    schemaVersion: "aios.mailchimp.provider-integration-execution-ticket-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    providerService: payload.providerService || providerIntegrationHandoff.providerService || "mailchimp-marketing-api",
    artifactName: persistedState.providerIntegrationExecutionTicketArtifact || "provider-integration-execution-ticket.json",
    artifactId: artifact?.id || null,
    ticketKey: payload.ticketKey || persistedState.providerIntegrationExecutionTicketKey || null,
    sourceIntegrationKey: payload.sourceIntegrationKey || providerIntegrationHandoff.integrationKey || null,
    readyForRuntimeRelease,
    nextAction,
    resumeCursor: payload.resumeCursor || persistedState.providerIntegrationExecutionTicketResumeCursor || null,
    routePayload: {
      ...(payload.routePayload || {}),
      artifactReady: Boolean(artifact?.id),
      dryRunOnly: true
    },
    gates: gates.map((gate) => ({
      gateId: gate.gateId,
      state: permissionBlocked || providerBlocked ? "blocked" : gate.state,
      required: gate.required !== false,
      owner: gate.owner || "runtime-adapter",
      nextAction: permissionBlocked
        ? readiness.nextAction
        : providerBlocked
          ? providerIntegrationHandoff.nextAction
          : gate.nextAction || nextAction,
      evidence: gate.evidence || {}
    })),
    operations: operations.map((operation) => ({
      jobId: operation.jobId,
      operation: operation.operation,
      ticketState: permissionBlocked || providerBlocked ? "blocked" : operation.ticketState,
      adapterStatusResumeCursor: operation.adapterStatusResumeCursor || null,
      idempotencyKey: operation.idempotencyKey || null,
      checkpointKey: operation.checkpointKey || null,
      nextAction: permissionBlocked
        ? readiness.nextAction
        : providerBlocked
          ? providerIntegrationHandoff.nextAction
          : operation.nextAction || nextAction
    })),
    validationSummary: {
      ...(payload.validationSummary || {}),
      blockedGateIds: permissionBlocked
        ? ["contract-readiness"]
        : providerBlocked
          ? ["provider-integration-handoff"]
          : payload.validationSummary?.blockedGateIds || blockedGates.map((gate) => gate.gateId),
      waitingGateIds: permissionBlocked || providerBlocked
        ? []
        : payload.validationSummary?.waitingGateIds || waitingGates.map((gate) => gate.gateId),
      blockedJobIds: permissionBlocked || providerBlocked
        ? operations.map((operation) => operation.jobId).filter(Boolean)
        : payload.validationSummary?.blockedJobIds || blockedOperations.map((operation) => operation.jobId),
      waitingJobIds: permissionBlocked || providerBlocked
        ? []
        : payload.validationSummary?.waitingJobIds || waitingOperations.map((operation) => operation.jobId)
    },
    clientPatch: {
      ...(payload.clientPatch || {}),
      artifactName: persistedState.providerIntegrationExecutionTicketArtifact || "provider-integration-execution-ticket.json",
      artifactReady: Boolean(artifact?.id),
      providerIntegrationExecutionTicketStatus: status,
      providerIntegrationExecutionTicketReady: readyForRuntimeRelease,
      providerIntegrationExecutionTicketNextAction: nextAction,
      providerIntegrationExecutionTicketResumeCursor: payload.resumeCursor || null
    },
    restartSemantics: payload.restartSemantics || {
      replaySafe: status !== "blocked",
      duplicateCommandPolicy: "dedupe-by-provider-integration-execution-ticket",
      resumeCursor: payload.resumeCursor || null,
      externalWritesPerformed: false
    }
  };
}

function buildPreviewExportReadinessRuntimeHandoff(metadata, diagnostics, artifacts, readiness) {
  const source = metadata.previewExportReadiness || diagnostics.previewExportReadiness || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const readinessArtifact = manifest.find((artifact) => artifact.name === "preview-export-readiness.json");
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const waitingRows = rows.filter((row) => row.status === "waiting" || row.status === "needs-operator-action");
  const permissionBlocked = readiness.status === "blocked";
  const readyForClientPreview = permissionBlocked === false
    && Boolean(readinessArtifact?.id)
    && source.readyForClientPreview === true
    && blockedRows.length === 0;
  const readyForRuntimeStart = readyForClientPreview
    && source.readyForRuntimeStart === true
    && readiness.acceptedForRuntime === true;
  const status = permissionBlocked
    ? "blocked"
    : blockedRows.length > 0
      ? "blocked"
      : waitingRows.length > 0 || readyForRuntimeStart === false
        ? "needs-operator-action"
        : source.status || "ready";
  const nextRow = blockedRows[0] || waitingRows[0] || rows.find((row) => row.status !== "ready") || null;
  const nextAction = permissionBlocked
    ? readiness.nextAction
    : nextRow?.nextAction
      || source.nextAction
      || (readyForRuntimeStart ? "publish-preview-export-readiness" : "accept-preview");

  return {
    schemaVersion: "aios.mailchimp.preview-export-readiness-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.previewExportReadinessArtifact || "preview-export-readiness.json",
    artifactId: readinessArtifact?.id || null,
    readyForClientPreview,
    readyForRuntimeStart,
    exportReady: source.exportReady === true || source.ready === true,
    acceptanceToken: source.acceptanceToken || metadata.preview?.acceptance?.acceptanceToken || null,
    routeId: source.routeId || metadata.previewHandoff?.routeId || null,
    resumeToken: source.resumeToken || metadata.exports?.summary?.resumeToken || null,
    statusRevision: source.statusRevision || metadata.exports?.summary?.statusRevision || null,
    validationSummary: source.validationSummary || {},
    rows: rows.map((row) => ({
      id: row.id,
      order: row.order,
      phase: row.phase,
      status: row.status,
      nextAction: row.nextAction,
      counters: row.counters || {}
    })),
    blocking: {
      blockedRowIds: source.exportSummary?.blockedRowIds || blockedRows.map((row) => row.id),
      waitingRowIds: source.exportSummary?.waitingRowIds || waitingRows.map((row) => row.id)
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.previewExportReadinessArtifact || "preview-export-readiness.json",
      artifactReady: Boolean(readinessArtifact?.id),
      previewExportReadinessStatus: status,
      previewExportReady: source.exportReady === true || source.ready === true,
      previewExportRuntimeStartReady: readyForRuntimeStart,
      previewExportNextAction: nextAction
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-preview-export-readiness-revision",
      resumeToken: source.resumeToken || metadata.exports?.summary?.resumeToken || null,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function buildPreviewReadinessManifestRuntimeHandoff(metadata, diagnostics, artifacts, readiness, permissionHandoff) {
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const manifestArtifact = manifest.find((artifact) => artifact.name === "preview-readiness-manifest.json");
  const payload = artifacts.artifacts
    ?.find((artifact) => artifact.name === "preview-readiness-manifest.json")
    ?.payload
    || metadata.previewReadinessManifest
    || diagnostics.previewReadinessManifest
    || {};
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const permissionBlocked = permissionHandoff.status === "blocked" || readiness.status === "blocked";
  const blockedSections = permissionBlocked
    ? [{
      id: "permission-boundary",
      nextAction: permissionHandoff.nextAction || readiness.nextAction,
      status: "blocked"
    }]
    : sections.filter((section) => section.status === "blocked");
  const pendingSections = permissionBlocked
    ? []
    : sections.filter((section) => section.status === "needs-operator-action" || section.status === "waiting");
  const nextSection = blockedSections[0]
    || pendingSections[0]
    || sections.find((section) => section.readyForRuntimeStart === false)
    || null;
  const status = permissionBlocked
    ? "blocked"
    : blockedSections.length > 0
      ? "blocked"
      : pendingSections.length > 0
        ? "needs-operator-action"
        : payload.status || "ready";
  const readyForClientPreview = permissionBlocked === false
    && Boolean(manifestArtifact?.id)
    && payload.readyForClientPreview === true
    && blockedSections.length === 0;
  const readyForRuntimeStart = readyForClientPreview
    && payload.readyForRuntimeStart === true
    && readiness.acceptedForRuntime === true
    && pendingSections.length === 0;
  const route = payload.route || {};
  const routeId = route.routeId
    || `${metadata.jobId}:preview-readiness-manifest`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const resumeToken = route.resumeToken
    || metadata.exports?.summary?.resumeToken
    || diagnostics.statusLedger?.resumeToken
    || null;
  const statusRevision = route.statusRevision
    || metadata.exports?.summary?.statusRevision
    || diagnostics.statusLedger?.statusRevision
    || null;
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction || readiness.nextAction
    : nextSection?.nextAction
      || payload.nextAction
      || (readyForRuntimeStart ? "handoff-to-runtime-adapter" : "refresh-preview-readiness-manifest");

  return {
    schemaVersion: "aios.mailchimp.preview-readiness-manifest-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    visibleStatus: permissionBlocked ? "mailchimp-preview-blocked" : payload.visibleStatus || status,
    artifactName: persistedState.previewReadinessManifestArtifact || "preview-readiness-manifest.json",
    artifactId: manifestArtifact?.id || null,
    artifactReady: Boolean(manifestArtifact?.id),
    readyForClientPreview,
    readyForRuntimeStart,
    nextAction,
    nextSectionId: permissionBlocked ? "permission-boundary" : nextSection?.id || payload.nextSectionId || null,
    route: {
      routeId,
      target: route.target || "client-preview",
      resumeToken,
      statusRevision,
      idempotencyKey: route.idempotencyKey
        || `${routeId}:${statusRevision || "revision"}:${resumeToken || "resume"}`.replace(/[^a-zA-Z0-9_.:-]/g, "_")
    },
    validationSummary: {
      ...(payload.validationSummary || {}),
      total: payload.validationSummary?.total || sections.length,
      blocked: permissionBlocked ? 1 : payload.validationSummary?.blocked || blockedSections.length,
      pending: payload.validationSummary?.pending || pendingSections.length,
      blockedSectionIds: permissionBlocked
        ? ["permission-boundary"]
        : payload.validationSummary?.blockedSectionIds || blockedSections.map((section) => section.id),
      pendingSectionIds: permissionBlocked
        ? []
        : payload.validationSummary?.pendingSectionIds || pendingSections.map((section) => section.id)
    },
    sections: permissionBlocked
      ? [{
        id: "permission-boundary",
        order: 0,
        label: "Permission boundary",
        status: "blocked",
        readyForClientPreview: false,
        readyForRuntimeStart: false,
        nextAction,
        artifactNames: ["permission-boundary.json"],
        evidence: {
          reason: permissionHandoff.deniedReason || "permission boundary blocks preview handoff"
        }
      }, ...sections]
      : sections,
    clientPatch: {
      ...(payload.clientPatch || {}),
      artifactName: persistedState.previewReadinessManifestArtifact || "preview-readiness-manifest.json",
      artifactReady: Boolean(manifestArtifact?.id),
      previewReadinessManifestStatus: status,
      previewReadinessManifestVisibleStatus: permissionBlocked ? "mailchimp-preview-blocked" : payload.visibleStatus || status,
      previewReadinessManifestRouteId: routeId,
      previewReadinessManifestNextAction: nextAction,
      previewReadinessManifestReadyForPreview: readyForClientPreview,
      previewReadinessManifestReadyForRuntimeStart: readyForRuntimeStart
    },
    restartSemantics: payload.restartSemantics || {
      replaySafe: readyForClientPreview,
      duplicateCommandPolicy: "dedupe-by-preview-readiness-route",
      resumeToken,
      statusRevision,
      resumeFromSectionId: permissionBlocked ? "permission-boundary" : nextSection?.id || null,
      externalWritesPerformed: false
    }
  };
}

function buildRuntimeReleaseControlsHandoff(metadata, diagnostics, artifacts, readiness, permissionHandoff) {
  const source = metadata.runtimeReleaseControls || diagnostics.runtimeReleaseControls || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const artifact = manifest.find((item) => item.name === "runtime-release-controls.json");
  const gates = Array.isArray(source.gates) ? source.gates : [];
  const blockedGates = gates.filter((gate) => gate.state === "blocked");
  const waitingGates = gates.filter((gate) => gate.state === "waiting" || gate.state === "held");
  const permissionBlocked = permissionHandoff.status === "blocked";
  const readyForRuntimeStart = permissionBlocked === false
    && Boolean(artifact?.id)
    && source.readyForRuntimeStart === true
    && readiness.acceptedForRuntime === true
    && blockedGates.length === 0
    && waitingGates.length === 0;
  const status = permissionBlocked
    ? "blocked"
    : readyForRuntimeStart
      ? "ready"
      : blockedGates.length > 0
        ? "blocked"
        : waitingGates.length > 0
          ? "needs-operator-action"
          : source.status || "review";
  const nextGate = gates.find((gate) => gate.gateId === source.nextGateId)
    || blockedGates[0]
    || waitingGates[0]
    || null;
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : readyForRuntimeStart
      ? readiness.nextAction || "handoff-to-runtime-adapter"
      : source.nextAction || nextGate?.nextAction || "review-runtime-release-controls";

  return {
    schemaVersion: "aios.mailchimp.runtime-release-controls-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.runtimeReleaseControlsArtifact || "runtime-release-controls.json",
    artifactId: artifact?.id || null,
    readyForRuntimeStart,
    releaseKey: source.releaseKey || persistedState.runtimeReleaseControls?.releaseKey || null,
    releaseToken: source.releaseToken || persistedState.runtimeReleaseControls?.releaseToken || null,
    nextAction,
    nextGateId: source.nextGateId || nextGate?.gateId || null,
    gates: gates.map((gate) => ({
      id: gate.id,
      gateId: gate.gateId,
      order: gate.order,
      label: gate.label,
      owner: gate.owner,
      state: permissionBlocked ? "blocked" : gate.state,
      ready: permissionBlocked ? false : gate.ready === true,
      required: gate.required === true,
      held: gate.held === true,
      acknowledged: gate.acknowledged === true,
      nextAction: permissionBlocked ? permissionHandoff.nextAction : gate.nextAction || nextAction
    })),
    blocking: {
      blockedGateIds: permissionBlocked
        ? ["permission-boundary"]
        : source.clientPatch?.runtimeReleaseBlockedGateIds || blockedGates.map((gate) => gate.gateId),
      waitingGateIds: permissionBlocked
        ? []
        : source.clientPatch?.runtimeReleaseWaitingGateIds || waitingGates.map((gate) => gate.gateId)
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.runtimeReleaseControlsArtifact || "runtime-release-controls.json",
      artifactReady: Boolean(artifact?.id),
      runtimeReleaseControlsStatus: status,
      runtimeReleaseControlsReady: readyForRuntimeStart,
      runtimeReleaseControlsNextAction: nextAction,
      runtimeReleaseControlsNextGateId: source.nextGateId || nextGate?.gateId || null
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-runtime-release-control-key",
      resumeFromReleaseKey: source.releaseKey || null,
      externalWritesPerformed: false
    }
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

function buildClientCommandLeaseReplayRuntimeHandoff(metadata, diagnostics, artifacts, readiness, permissionHandoff, clientCommandLeases) {
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const artifact = manifest.find((item) => item.name === "client-command-lease-replay-handoff.json");
  const payload = artifacts.artifacts?.find((item) => item.name === "client-command-lease-replay-handoff.json")?.payload
    || metadata.clientCommandLeaseReplayHandoff
    || metadata.dryRun?.clientCommandLeaseReplayHandoff
    || diagnostics.clientCommandLeaseReplayHandoff
    || {};
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const permissionBlocked = permissionHandoff.status === "blocked";
  const blockedRows = rows.filter((row) => row.blocksRuntimeStart === true || row.status === "blocked");
  const ackRows = rows.filter((row) => row.ackRequired === true);
  const unsafeRows = rows.filter((row) => row.restartSafe === false || (!row.replayCursor && rows.length > 0));
  const readyForRuntime = permissionBlocked === false
    && Boolean(artifact?.id)
    && payload.readyForRuntime === true
    && blockedRows.length === 0
    && unsafeRows.length === 0
    && readiness.status !== "blocked";
  const status = permissionBlocked
    ? "blocked"
    : readyForRuntime
      ? "ready"
      : blockedRows.length > 0
        ? "blocked"
        : ackRows.length > 0 || payload.status === "waiting-for-client-ack"
          ? "waiting-for-client-ack"
          : payload.status || "review";
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : readyForRuntime
      ? "resume-command-lease-replay"
      : payload.nextAction
        || blockedRows[0]?.nextAction
        || ackRows[0]?.nextAction
        || clientCommandLeases.nextAction
        || "refresh-command-lease-replay-handoff";
  const routePayload = payload.routePayload || {};
  const resumeToken = payload.resumeToken
    || routePayload.resumeToken
    || persistedState.commandLeaseReplayResumeToken
    || clientCommandLeases.resumeToken
    || null;

  return {
    schemaVersion: "aios.mailchimp.client-command-lease-replay-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.clientCommandLeaseReplayHandoffArtifact || "client-command-lease-replay-handoff.json",
    artifactId: artifact?.id || null,
    readyForClient: permissionBlocked === false && status !== "blocked",
    readyForRuntime,
    routeId: payload.routeId || routePayload.routeId || null,
    resumeToken,
    primaryLeaseId: payload.primaryLeaseId || clientCommandLeases.primaryLeaseId || null,
    nextAction,
    ack: {
      required: permissionBlocked || payload.ack?.required === true || ackRows.length > 0,
      keys: permissionBlocked ? [] : payload.ack?.keys || ackRows.map((row) => row.ackKey).filter(Boolean),
      nextAckKey: permissionBlocked ? null : payload.ack?.nextAckKey || ackRows[0]?.ackKey || null,
      requiredCount: permissionBlocked ? 1 : payload.ack?.requiredCount || ackRows.length
    },
    routePayload: {
      ...routePayload,
      resumeToken,
      idempotencyKey: routePayload.idempotencyKey || null,
      externalWritesPerformed: false
    },
    validationSummary: {
      ...(payload.validationSummary || {}),
      blocked: permissionBlocked ? blockedRows.length + 1 : blockedRows.length,
      waitingForAck: permissionBlocked ? 0 : ackRows.length,
      restartUnsafe: unsafeRows.length,
      blockedLeaseIds: permissionBlocked
        ? ["permission-boundary", ...(payload.validationSummary?.blockedLeaseIds || [])]
        : payload.validationSummary?.blockedLeaseIds || blockedRows.map((row) => row.leaseId).filter(Boolean),
      ackLeaseIds: permissionBlocked
        ? []
        : payload.validationSummary?.ackLeaseIds || ackRows.map((row) => row.leaseId).filter(Boolean),
      unsafeLeaseIds: payload.validationSummary?.unsafeLeaseIds || unsafeRows.map((row) => row.leaseId).filter(Boolean)
    },
    rows: rows.map((row) => ({
      leaseId: row.leaseId,
      jobId: row.jobId,
      commandId: row.commandId,
      status: permissionBlocked ? "blocked" : row.status,
      visibleStatus: row.visibleStatus,
      nextAction: permissionBlocked ? permissionHandoff.nextAction : row.nextAction || nextAction,
      ackRequired: permissionBlocked ? true : row.ackRequired === true,
      blocksRuntimeStart: permissionBlocked || row.blocksRuntimeStart === true,
      replayCursor: permissionBlocked ? null : row.replayCursor || null,
      replayDecision: row.replayDecision || "return-existing-status",
      restartSafe: permissionBlocked ? false : row.restartSafe === true
    })),
    clientPatch: {
      ...(payload.clientPatch || {}),
      artifactName: persistedState.clientCommandLeaseReplayHandoffArtifact || "client-command-lease-replay-handoff.json",
      artifactReady: Boolean(artifact?.id),
      commandLeaseReplayHandoffStatus: status,
      commandLeaseReplayHandoffReady: readyForRuntime,
      commandLeaseReplayHandoffRouteId: payload.routeId || routePayload.routeId || null,
      commandLeaseReplayHandoffNextAction: nextAction
    },
    restartSemantics: payload.restartSemantics || {
      replaySafe: readyForRuntime,
      duplicateCommandPolicy: "dedupe-by-command-lease-replay-handoff-route",
      resumeToken,
      externalWritesPerformed: false
    }
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
  const grantPlan = metadata.permissionGrantPlan || diagnostics.permissionGrantPlan || {};
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
    grantPlan: {
      status: grantPlan.status || "unknown",
      readyForAudit: grantPlan.readyForAudit === true,
      nextAction: grantPlan.nextAction || null,
      blockingCommandIds: grantPlan.blockingCommandIds || grantPlan.blockedCommandIds || [],
      commandIds: grantPlan.commandIds || []
    },
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

function buildPermissionGrantRuntimeHandoff(metadata, diagnostics, artifacts, permissionHandoff) {
  const source = metadata.permissionGrantPlan
    || metadata.exports?.permissionGrantPlan
    || diagnostics.permissionGrantPlan
    || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const grantArtifact = manifest.find((artifact) => artifact.name === "permission-grant-plan.json");
  const commands = Array.isArray(source.commands) ? source.commands : [];
  const blockingCommandIds = source.blockingCommandIds
    || source.blockedCommandIds
    || commands.filter((command) => command.blocksRuntimeStart).map((command) => command.id).filter(Boolean);
  const readyForAudit = source.readyForAudit === true
    && permissionHandoff.status !== "blocked"
    && blockingCommandIds.length === 0
    && Boolean(grantArtifact?.id);
  const status = permissionHandoff.status === "blocked" || blockingCommandIds.length > 0
    ? "blocked"
    : readyForAudit
      ? "ready"
      : source.status || "waiting";
  const nextAction = permissionHandoff.status === "blocked"
    ? permissionHandoff.nextAction
    : source.nextAction
      || (readyForAudit ? "append-tenant-permission-audit" : "repair-permission-grant-plan");

  return {
    schemaVersion: "aios.mailchimp.permission-grant-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.permissionGrantPlanArtifact || "permission-grant-plan.json",
    artifactId: grantArtifact?.id || null,
    readyForAudit,
    readyForRuntime: readyForAudit && permissionHandoff.allowed === true,
    isolationKey: source.isolationKey || permissionHandoff.tenantIsolationKey || persistedState.tenantIsolationKey || null,
    planId: source.planId || null,
    commandIds: source.commandIds || commands.map((command) => command.id).filter(Boolean),
    blockingCommandIds,
    retryableCommandIds: source.retryableCommandIds || [],
    auditHandoff: {
      commandId: commands.find((command) => command.kind === "audit-append")?.id || null,
      ready: readyForAudit,
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.permissionGrantPlanArtifact || "permission-grant-plan.json",
      artifactReady: Boolean(grantArtifact?.id),
      permissionGrantPlanStatus: status,
      permissionGrantPlanReady: readyForAudit,
      permissionGrantPlanNextAction: nextAction,
      permissionGrantBlockingCount: blockingCommandIds.length
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-permission-grant-command-id",
      resumeFromCommandId: blockingCommandIds[0] || null,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function buildTenantPermissionEnforcementRuntimeHandoff(metadata, diagnostics, artifacts, permissionHandoff, permissionGrantHandoff) {
  const source = metadata.tenantPermissionEnforcement
    || diagnostics.tenantPermissionEnforcement
    || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const enforcementArtifact = manifest.find((artifact) => artifact.name === "tenant-permission-enforcement.json");
  const decisions = Array.isArray(source.decisions) ? source.decisions : [];
  const blockedDecisions = decisions.filter((decision) => (
    decision.blocksRuntimeStart === true
    || decision.status === "blocked"
  ));
  const auditReady = source.audit?.ready === true
    && permissionGrantHandoff.readyForAudit === true
    && permissionHandoff.status !== "blocked";
  const artifactReady = Boolean(enforcementArtifact?.id);
  const status = permissionHandoff.status === "blocked" || blockedDecisions.length > 0
    ? "blocked"
    : auditReady && artifactReady
      ? "ready"
      : source.status || "needs-operator-action";
  const nextAction = permissionHandoff.status === "blocked"
    ? permissionHandoff.nextAction
    : blockedDecisions[0]?.action
      || source.nextAction
      || permissionGrantHandoff.nextAction
      || "repair-tenant-permission-enforcement";

  return {
    schemaVersion: "aios.mailchimp.tenant-permission-enforcement-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.tenantPermissionEnforcementArtifact || "tenant-permission-enforcement.json",
    artifactId: enforcementArtifact?.id || null,
    enforcementKey: source.enforcementKey || persistedState.tenantPermissionEnforcementKey || null,
    isolationKey: source.isolationKey || permissionHandoff.tenantIsolationKey || persistedState.tenantIsolationKey || null,
    readyForAudit: auditReady,
    readyForRuntime: status === "ready"
      && artifactReady
      && permissionHandoff.allowed === true
      && permissionGrantHandoff.readyForRuntime === true,
    blockedDecisionIds: blockedDecisions.map((decision) => decision.commandId).filter(Boolean),
    retryableDecisionIds: decisions
      .filter((decision) => decision.retryable === true)
      .map((decision) => decision.commandId)
      .filter(Boolean),
    audit: {
      required: source.audit?.required === true,
      ready: auditReady,
      commandIds: source.audit?.commandIds || [],
      diagnosticIds: source.audit?.diagnosticIds || [],
      externalWritesPerformed: false
    },
    counters: source.counters || {
      decisions: decisions.length,
      blocked: blockedDecisions.length,
      retryable: decisions.filter((decision) => decision.retryable === true).length
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.tenantPermissionEnforcementArtifact || "tenant-permission-enforcement.json",
      artifactReady,
      tenantPermissionEnforcementStatus: status,
      tenantPermissionEnforcementKey: source.enforcementKey || null,
      tenantPermissionNextAction: nextAction,
      tenantPermissionAuditReady: auditReady
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-tenant-permission-enforcement-key",
      resumeFromEnforcementKey: source.enforcementKey || null,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function buildTenantBoundaryPostureRuntimeHandoff(metadata, diagnostics, artifacts, permissionHandoff, tenantPermissionHandoff) {
  const source = metadata.tenantBoundaryPosture || diagnostics.tenantBoundaryPosture || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const postureArtifact = manifest.find((artifact) => artifact.name === "tenant-boundary-posture.json");
  const runtimeGate = source.runtimeGate || {};
  const drift = source.drift || {};
  const permissionBlocked = permissionHandoff.status === "blocked";
  const artifactReady = Boolean(postureArtifact?.id);
  const blockedDecisionIds = normalizeList(
    runtimeGate.blockedDecisionIds
      || tenantPermissionHandoff.blockedDecisionIds
      || []
  );
  const status = permissionBlocked || blockedDecisionIds.length > 0
    ? "blocked"
    : source.safeForRuntime === true && artifactReady
      ? "ready"
      : source.status || "needs-operator-action";
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : blockedDecisionIds.length > 0
      ? tenantPermissionHandoff.nextAction
      : source.nextAction || tenantPermissionHandoff.nextAction || "repair-tenant-boundary-posture";

  return {
    schemaVersion: "aios.mailchimp.tenant-boundary-posture-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.tenantBoundaryPostureArtifact || "tenant-boundary-posture.json",
    artifactId: postureArtifact?.id || null,
    postureKey: source.postureKey || persistedState.tenantBoundaryPostureKey || null,
    isolationKey: source.isolationKey || permissionHandoff.tenantIsolationKey || persistedState.tenantIsolationKey || null,
    readyForRuntime: status === "ready"
      && artifactReady
      && permissionHandoff.allowed === true
      && tenantPermissionHandoff.readyForRuntime === true,
    safeForAuditAppend: source.safeForAuditAppend === true
      || tenantPermissionHandoff.audit?.ready === true,
    drift: {
      explicitBoundary: drift.explicitBoundary === true,
      isolationDrift: drift.isolationDrift === true,
      roleDrift: drift.roleDrift === true,
      scopeDrift: drift.scopeDrift === true,
      auditDrift: drift.auditDrift === true,
      missingRoles: normalizeList(drift.missingRoles || []),
      deniedScopes: normalizeList(drift.deniedScopes || [])
    },
    blocking: {
      blockedDecisionIds,
      waitingDecisionIds: normalizeList(runtimeGate.waitingDecisionIds || []),
      retryableDecisionIds: normalizeList(runtimeGate.retryableDecisionIds || []),
      blocksRuntimeStart: status === "blocked"
    },
    auditHandoff: {
      commandId: source.auditHandoff?.commandId || tenantPermissionHandoff.audit?.commandIds?.[0] || null,
      ready: source.auditHandoff?.ready === true || tenantPermissionHandoff.audit?.ready === true,
      appendAction: source.auditHandoff?.appendAction || "append-tenant-permission-audit",
      idempotencyKey: source.auditHandoff?.idempotencyKey || null,
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.tenantBoundaryPostureArtifact || "tenant-boundary-posture.json",
      artifactReady,
      tenantBoundaryPostureStatus: status,
      tenantBoundaryPostureKey: source.postureKey || null,
      tenantBoundaryPostureNextAction: nextAction,
      tenantBoundarySafeForRuntime: status === "ready",
      tenantBoundarySafeForAudit: source.safeForAuditAppend === true || tenantPermissionHandoff.audit?.ready === true
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-tenant-boundary-posture-key",
      resumeFromPostureKey: source.postureKey || null,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function buildRuntimeBoundaryExecutionTicketRuntimeHandoff(
  metadata,
  diagnostics,
  artifacts,
  readiness,
  permissionHandoff,
  tenantBoundaryPosture
) {
  const source = metadata.runtimeBoundaryExecutionTicket
    || metadata.dryRun?.runtimeBoundaryExecutionTickets
    || diagnostics.runtimeBoundaryExecutionTicket
    || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const ticketArtifact = manifest.find((artifact) => artifact.name === "runtime-boundary-execution-ticket.json");
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.safeForAdapterRelease === false);
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const unsafeRows = rows.filter((row) => row.restart?.restartSafe === false);
  const releaseGate = source.releaseGate || {};
  const artifactReady = Boolean(ticketArtifact?.id);
  const permissionBlocked = permissionHandoff.status === "blocked";
  const postureBlocked = tenantBoundaryPosture.status === "blocked" || tenantBoundaryPosture.readyForRuntime === false;
  const releaseBlocked = releaseGate.ready === false && (releaseGate.blockedGateIds || []).length > 0;
  const status = permissionBlocked || postureBlocked || releaseBlocked || blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0 || readiness.status === "needs-operator-action"
      ? "waiting"
      : source.status || source.state || "ready";
  const ticketKey = source.ticketKey
    || source.id
    || persistedState.runtimeBoundaryExecutionTicketKey
    || null;
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : postureBlocked
      ? tenantBoundaryPosture.nextAction
      : blockedRows[0]?.nextAction
        || waitingRows[0]?.nextAction
        || source.nextAction
        || "release-runtime-boundary-ticket";
  const readyForRuntimeRelease = status === "ready"
    && artifactReady
    && permissionHandoff.allowed === true
    && tenantBoundaryPosture.readyForRuntime === true
    && source.readyForRuntimeRelease !== false
    && unsafeRows.length === 0;
  const auditRefs = normalizeList(
    source.auditHandoff?.auditRefs
      || rows.map((row) => row.auditRef || row.audit?.auditRef).filter(Boolean)
  );
  const commandIds = normalizeList(
    source.clientPatch?.runtimeBoundaryTicketCommandIds
      || source.clientPatch?.runtimeBoundaryExecutionTicketCommandIds
      || rows.map((row) => row.ticketCommand?.commandId || row.command?.commandId).filter(Boolean)
  );

  return {
    schemaVersion: "aios.mailchimp.runtime-boundary-execution-ticket-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.runtimeBoundaryExecutionTicketArtifact || "runtime-boundary-execution-ticket.json",
    artifactId: ticketArtifact?.id || null,
    ticketKey,
    readyForRuntimeRelease,
    readyForAuditAppend: source.readyForAuditAppend === true
      || (auditRefs.length > 0 && status !== "blocked"),
    isolationKey: source.isolationKey
      || tenantBoundaryPosture.isolationKey
      || permissionHandoff.tenantIsolationKey
      || persistedState.tenantIsolationKey
      || null,
    sourceMatrixId: source.sourceMatrixId || null,
    sourceAuditHandoffId: source.sourceAuditHandoffId || null,
    releaseGate: {
      ready: releaseGate.ready === true && releaseBlocked === false,
      status: releaseGate.status || "unknown",
      releaseKey: releaseGate.releaseKey || null,
      blockedGateIds: normalizeList(releaseGate.blockedGateIds || []),
      waitingGateIds: normalizeList(releaseGate.waitingGateIds || [])
    },
    validationSummary: {
      rows: rows.length,
      ready: rows.filter((row) => row.state === "ready").length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      restartUnsafe: unsafeRows.length,
      blockedJobIds: blockedRows.map((row) => row.jobId).filter(Boolean),
      waitingJobIds: waitingRows.map((row) => row.jobId).filter(Boolean)
    },
    rows: rows.map((row, index) => ({
      sequence: row.sequence || index + 1,
      ticketId: row.ticketId || null,
      jobId: row.jobId || null,
      operation: row.operation || null,
      state: row.state || "unknown",
      permissionDecision: row.permissionDecision || "unknown",
      safeForAdapterRelease: row.safeForAdapterRelease === true,
      auditRef: row.auditRef || row.audit?.auditRef || null,
      commandId: row.ticketCommand?.commandId || row.command?.commandId || null,
      idempotencyKey: row.ticketCommand?.idempotencyKey || row.command?.idempotencyKey || null,
      restartSafe: row.restart?.restartSafe !== false,
      nextAction: row.nextAction || nextAction
    })),
    auditHandoff: {
      mode: source.auditHandoff?.mode || source.auditHandoff?.appendMode || "local-before-adapter-release",
      ready: auditRefs.length > 0 && status !== "blocked",
      auditRefs,
      externalWritesPerformed: false
    },
    commandHandoff: {
      commandIds,
      idempotencyKeys: normalizeList(rows.map((row) => (
        row.ticketCommand?.idempotencyKey || row.command?.idempotencyKey
      )).filter(Boolean)),
      externalWritesPerformed: false
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.runtimeBoundaryExecutionTicketArtifact || "runtime-boundary-execution-ticket.json",
      artifactReady,
      runtimeBoundaryExecutionTicketStatus: status,
      runtimeBoundaryExecutionTicketReady: readyForRuntimeRelease,
      runtimeBoundaryExecutionTicketNextAction: nextAction,
      runtimeBoundaryExecutionTicketBlockedJobIds: blockedRows.map((row) => row.jobId).filter(Boolean),
      runtimeBoundaryExecutionTicketWaitingJobIds: waitingRows.map((row) => row.jobId).filter(Boolean)
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: readyForRuntimeRelease,
      duplicateCommandPolicy: "dedupe-by-runtime-boundary-ticket-key",
      resumeToken: ticketKey,
      externalWritesPerformed: false
    },
    nextAction
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

function buildPreviewAcceptancePacketHandoff(diagnostics, artifacts, readiness, permissionHandoff, previewAcceptance) {
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const packetArtifact = manifest.find((artifact) => artifact.name === "preview-acceptance-packet.json");
  const source = diagnostics.previewAcceptancePacket || {};
  const checkpoints = Array.isArray(source.checkpoints) ? source.checkpoints : [];
  const blockedCheckpoints = checkpoints.filter((checkpoint) => (checkpoint.blockedIds || []).length > 0);
  const pendingCheckpoints = checkpoints.filter((checkpoint) => (checkpoint.pendingIds || []).length > 0);
  const permissionBlocked = permissionHandoff.status === "blocked";
  const artifactReady = Boolean(packetArtifact?.id);
  const status = permissionBlocked || blockedCheckpoints.length > 0
    ? "blocked"
    : pendingCheckpoints.length > 0 || source.status === "needs-operator-action"
      ? "needs-operator-action"
      : source.status || "ready";
  const acceptanceToken = source.acceptanceToken
    || previewAcceptance.acceptanceToken
    || persistedState.previewAcceptanceToken
    || null;
  const readyForClient = permissionBlocked === false
    && artifactReady
    && source.readyForAcceptance === true
    && blockedCheckpoints.length === 0;
  const readyForRuntimeStart = readyForClient
    && source.readyForRuntimeStart === true
    && previewAcceptance.runtimeStartEnabledAfterAcceptance === true
    && readiness.acceptedForRuntime === true
    && pendingCheckpoints.length === 0;
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : blockedCheckpoints[0]?.nextAction
      || pendingCheckpoints[0]?.nextAction
      || source.nextAction
      || previewAcceptance.nextAction
      || readiness.nextAction;

  return {
    schemaVersion: "aios.mailchimp.preview-acceptance-packet-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.previewAcceptancePacketArtifact || "preview-acceptance-packet.json",
    artifactId: packetArtifact?.id || null,
    artifactReady,
    routeId: source.routeId || null,
    acceptanceToken,
    readyForClient,
    readyForRuntimeStart,
    nextAction,
    statusLedger: {
      resumeToken: source.statusLedger?.resumeToken || persistedState.resumeToken || null,
      statusRevision: source.statusLedger?.statusRevision || persistedState.statusRevision || null,
      visibleStatus: source.statusLedger?.visibleStatus || status,
      restartSafe: source.statusLedger?.restartSafe === true
    },
    routePayload: source.routePayload || {
      method: "POST",
      path: "/mailchimp/jobs/:jobId/preview/acceptance",
      idempotencyKey: acceptanceToken,
      bodyShape: {
        acceptanceToken: "string",
        statusRevision: "string",
        resumeToken: "string",
        accepted: "boolean"
      }
    },
    validationSummary: {
      ...(source.validationSummary || {}),
      blocked: permissionBlocked
        ? (source.validationSummary?.blocked || blockedCheckpoints.length) + 1
        : source.validationSummary?.blocked || blockedCheckpoints.length,
      pending: source.validationSummary?.pending || pendingCheckpoints.length,
      artifactReady,
      permissionAllowed: permissionHandoff.allowed === true
    },
    checkpoints: checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      status: checkpoint.status || "unknown",
      ready: checkpoint.ready === true,
      blockedIds: permissionBlocked && checkpoint.id === "preview-handoff"
        ? Array.from(new Set(["mailchimp.preview.route.boundary", ...(checkpoint.blockedIds || [])])).sort()
        : checkpoint.blockedIds || [],
      pendingIds: checkpoint.pendingIds || [],
      nextAction: checkpoint.nextAction || nextAction
    })),
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.previewAcceptancePacketArtifact || "preview-acceptance-packet.json",
      artifactReady,
      previewAcceptancePacketStatus: status,
      previewAcceptancePacketReady: readyForClient,
      previewAcceptanceRuntimeReady: readyForRuntimeStart,
      previewAcceptancePacketNextAction: nextAction,
      previewAcceptanceToken: acceptanceToken
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-preview-acceptance-packet-token",
      resumeFromAcceptanceToken: acceptanceToken,
      externalWritesPerformed: false
    }
  };
}

function buildPreviewReleaseTicketHandoff(diagnostics, artifacts, readiness, permissionHandoff, previewAcceptancePacket, runtimeReleaseControls) {
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const artifact = manifest.find((item) => item.name === "preview-release-ticket.json");
  const payload = artifacts.artifacts?.find((item) => item.name === "preview-release-ticket.json")?.payload
    || diagnostics.previewReleaseTicket
    || {};
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const blockedRows = rows.filter((row) => row.required !== false && row.status === "blocked");
  const waitingRows = rows.filter((row) => row.required !== false && row.ready === false && row.status !== "blocked");
  const permissionBlocked = permissionHandoff.status === "blocked";
  const releaseBlocked = runtimeReleaseControls.status === "blocked"
    || runtimeReleaseControls.readyForRuntimeStart === false && runtimeReleaseControls.status !== "waiting";
  const packetBlocked = previewAcceptancePacket.status === "blocked";
  const artifactReady = Boolean(artifact?.id);
  const readyForRuntimeRelease = permissionBlocked === false
    && packetBlocked === false
    && releaseBlocked === false
    && artifactReady
    && payload.readyForRuntimeRelease === true
    && blockedRows.length === 0
    && waitingRows.length === 0
    && readiness.acceptedForRuntime === true;
  const status = permissionBlocked || packetBlocked || releaseBlocked || blockedRows.length > 0
    ? "blocked"
    : readyForRuntimeRelease
      ? "ready"
      : waitingRows.length > 0
        ? "needs-operator-action"
        : payload.status || "waiting";
  const nextRow = blockedRows[0] || waitingRows[0] || null;
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : packetBlocked
      ? previewAcceptancePacket.nextAction
      : releaseBlocked
        ? runtimeReleaseControls.nextAction
        : nextRow?.nextAction
          || payload.nextAction
          || (readyForRuntimeRelease ? "release-mailchimp-preview-to-runtime" : "refresh-preview-release-ticket");

  return {
    schemaVersion: "aios.mailchimp.preview-release-ticket-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.previewReleaseTicketArtifact || "preview-release-ticket.json",
    artifactId: artifact?.id || null,
    artifactReady,
    ticketKey: payload.ticketKey || persistedState.previewReleaseTicketKey || null,
    releaseKey: payload.releaseKey || runtimeReleaseControls.releaseKey || null,
    acceptanceToken: payload.acceptanceToken || previewAcceptancePacket.acceptanceToken || null,
    readyForRuntimeRelease,
    nextAction,
    resumeToken: payload.resumeToken || persistedState.previewReleaseTicketResumeToken || null,
    statusRevision: payload.statusRevision || persistedState.statusRevision || null,
    routePayload: {
      ...(payload.routePayload || {}),
      artifactReady,
      idempotencyKey: payload.routePayload?.idempotencyKey || payload.ticketKey || null
    },
    rows: rows.map((row) => ({
      id: row.id,
      order: row.order,
      label: row.label,
      status: permissionBlocked || packetBlocked || releaseBlocked ? "blocked" : row.status,
      ready: permissionBlocked || packetBlocked || releaseBlocked ? false : row.ready === true,
      required: row.required !== false,
      nextAction: permissionBlocked
        ? permissionHandoff.nextAction
        : packetBlocked
          ? previewAcceptancePacket.nextAction
          : releaseBlocked
            ? runtimeReleaseControls.nextAction
            : row.nextAction || nextAction,
      code: row.code || null,
      evidence: row.evidence || {}
    })),
    validationSummary: {
      ...(payload.validationSummary || {}),
      blockedRowIds: permissionBlocked
        ? ["permission-boundary"]
        : packetBlocked
          ? ["preview-acceptance-packet"]
          : releaseBlocked
            ? ["runtime-release-controls"]
            : payload.validationSummary?.blockedRowIds || blockedRows.map((row) => row.id),
      waitingRowIds: permissionBlocked || packetBlocked || releaseBlocked
        ? []
        : payload.validationSummary?.waitingRowIds || waitingRows.map((row) => row.id),
      artifactReady,
      acceptedForRuntime: readiness.acceptedForRuntime === true
    },
    clientPatch: {
      ...(payload.clientPatch || {}),
      artifactName: persistedState.previewReleaseTicketArtifact || "preview-release-ticket.json",
      artifactReady,
      previewReleaseTicketStatus: status,
      previewReleaseTicketReady: readyForRuntimeRelease,
      previewReleaseTicketNextAction: nextAction,
      previewReleaseTicketKey: payload.ticketKey || null,
      previewReleaseTicketResumeToken: payload.resumeToken || null
    },
    restartSemantics: payload.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-preview-release-ticket-key",
      resumeToken: payload.resumeToken || null,
      externalWritesPerformed: false
    }
  };
}

function buildPreviewHandoffContract(metadata, artifacts, readiness, permissionHandoff, previewAcceptance, clientWorkflow) {
  const source = metadata.previewHandoff || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const previewHandoffArtifact = manifest.find((artifact) => artifact.name === "preview-handoff.json");
  const gates = Array.isArray(source.gates) ? source.gates : [];
  const blockedGateIds = source.acceptance?.blockedGateIds
    || gates.filter((gate) => gate.status === "blocked").map((gate) => gate.id);
  const pendingGateIds = source.acceptance?.pendingGateIds
    || gates.filter((gate) => gate.status === "needs-operator-action").map((gate) => gate.id);
  const permissionBlocked = permissionHandoff.status === "blocked";
  const artifactReady = Boolean(previewHandoffArtifact?.id);
  const status = permissionBlocked || blockedGateIds.length > 0
    ? "blocked"
    : pendingGateIds.length > 0 || readiness.status === "needs-operator-action"
      ? "needs-operator-action"
      : source.status || "ready";
  const routeId = source.routeId
    || persistedState.previewHandoffRouteId
    || `${metadata.jobId}:preview-route:${permissionHandoff.tenantIsolationKey || "tenant.local_workspace.local"}:${status}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const acceptanceToken = source.acceptance?.token
    || persistedState.previewHandoffAcceptanceToken
    || previewAcceptance.acceptanceToken
    || `${routeId}:acceptance`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : source.primaryAction
      || source.explainNextStep?.action
      || previewAcceptance.nextAction
      || clientWorkflow.primaryAction
      || readiness.nextAction;
  const readyForClient = permissionBlocked === false
    && artifactReady
    && source.visible === true
    && blockedGateIds.length === 0;
  const readyForRuntimeStart = readyForClient
    && pendingGateIds.length === 0
    && source.readyForRuntimeStart === true
    && previewAcceptance.runtimeStartEnabledAfterAcceptance === true
    && readiness.acceptedForRuntime === true;

  return {
    schemaVersion: "aios.mailchimp.preview-handoff-contract.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.previewHandoffArtifact || "preview-handoff.json",
    artifactId: previewHandoffArtifact?.id || null,
    routeId,
    readyForClient,
    readyForRuntimeStart,
    visible: source.visible === true && permissionBlocked === false,
    nextAction,
    acceptance: {
      required: source.acceptance?.required !== false,
      token: acceptanceToken,
      status: permissionBlocked ? "blocked" : source.acceptance?.status || previewAcceptance.status || "unknown",
      nextAction,
      requiredGateIds: source.acceptance?.requiredGateIds || gates.filter((gate) => gate.required).map((gate) => gate.id),
      blockedGateIds: permissionBlocked
        ? Array.from(new Set(["mailchimp.preview.route.boundary", ...blockedGateIds])).sort()
        : blockedGateIds,
      pendingGateIds,
      receiptId: previewAcceptance.acceptanceReceipt?.id || null
    },
    routePayload: source.routePayload || {
      method: "POST",
      path: `/mailchimp/jobs/${metadata.jobId}/preview/acceptance`,
      idempotencyKey: acceptanceToken,
      bodyShape: {
        acceptanceToken: "string",
        statusRevision: "string",
        isolationKey: "string",
        accepted: "boolean"
      }
    },
    validationSummary: {
      ...(source.validationSummary || {}),
      blocked: permissionBlocked
        ? (source.validationSummary?.blocked || blockedGateIds.length) + 1
        : source.validationSummary?.blocked || blockedGateIds.length,
      pending: source.validationSummary?.pending || pendingGateIds.length,
      artifactReady,
      permissionAllowed: permissionHandoff.allowed === true
    },
    gates: gates.map((gate) => ({
      id: gate.id,
      label: gate.label,
      status: permissionBlocked && gate.id === "mailchimp.preview.route.boundary" ? "blocked" : gate.status,
      required: gate.required === true,
      nextAction: permissionBlocked && gate.id === "mailchimp.preview.route.boundary"
        ? permissionHandoff.nextAction
        : gate.nextAction,
      evidence: gate.evidence || {}
    })),
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.previewHandoffArtifact || "preview-handoff.json",
      artifactReady,
      previewHandoffStatus: status,
      previewHandoffReadyForClient: readyForClient,
      previewHandoffReadyForRuntimeStart: readyForRuntimeStart,
      previewHandoffRouteId: routeId,
      previewHandoffAcceptanceToken: acceptanceToken,
      previewHandoffNextAction: nextAction
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-preview-handoff-token",
      resumeFromRouteId: routeId,
      externalWritesPerformed: false
    }
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

function buildClientRuntimeSettingsHandoff(metadata, artifacts, readiness, permissionHandoff, adoptionHandoff) {
  const settings = metadata.clientRuntimeSettings || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const settingsArtifact = manifest.find((artifact) => artifact.name === "client-runtime-settings.json");
  const missingRequiredSettings = normalizeList(settings.missingRequiredSettings || []);
  const permissionBlocked = permissionHandoff.status === "blocked";
  const readyForClientRuntime = permissionBlocked === false
    && Boolean(settingsArtifact?.id)
    && settings.readyForClientRuntime === true
    && adoptionHandoff.readyForClientRuntime === true
    && missingRequiredSettings.length === 0
    && settings.revisionAccepted !== false
    && readiness.acceptedForClientPreview === true;
  const status = permissionBlocked
    ? "blocked"
    : readyForClientRuntime
      ? "ready"
      : settings.status || "waiting-for-client";
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : settings.nextAction || adoptionHandoff.nextAction || readiness.nextAction || "refresh-client-runtime-settings";

  return {
    schemaVersion: "aios.mailchimp.client-runtime-settings-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.clientRuntimeSettingsArtifact || "client-runtime-settings.json",
    artifactId: settingsArtifact?.id || null,
    settingsRevision: settings.settingsRevision || null,
    acceptedSettingsRevision: settings.acceptedSettingsRevision || null,
    revisionAccepted: settings.revisionAccepted !== false,
    readyForClientRuntime,
    missingRequiredSettings,
    controls: {
      previewEnabled: settings.controls?.previewEnabled === true,
      runtimeStartEnabled: settings.controls?.runtimeStartEnabled === true,
      schedulePaused: settings.controls?.schedulePaused === true,
      scheduleWindow: settings.controls?.scheduleWindow || "runtime",
      scheduleSupported: settings.controls?.scheduleSupported !== false,
      runtimeStartBlocked: settings.controls?.runtimeStartBlocked === true
    },
    adoption: {
      adoptionId: adoptionHandoff.adoptionId || settings.adoption?.adoptionId || null,
      status: adoptionHandoff.status || settings.adoption?.status || "unknown",
      readyForClientRuntime: adoptionHandoff.readyForClientRuntime === true,
      missingStateKeys: adoptionHandoff.missingStateKeys || [],
      pendingAckKeys: adoptionHandoff.commandAck?.pendingKeys || []
    },
    validationSummary: {
      ...(settings.validationSummary || {}),
      missingRequiredSettings: missingRequiredSettings.length,
      artifactReady: Boolean(settingsArtifact?.id),
      adoptionReady: adoptionHandoff.readyForClientRuntime === true,
      revisionAccepted: settings.revisionAccepted !== false
    },
    clientPatch: {
      ...(settings.clientPatch || {}),
      artifactName: persistedState.clientRuntimeSettingsArtifact || "client-runtime-settings.json",
      artifactReady: Boolean(settingsArtifact?.id),
      mailchimpClientSettingsStatus: status,
      mailchimpClientSettingsNextAction: nextAction,
      clientRuntimeReadyWithSettings: readyForClientRuntime
    },
    restartSemantics: settings.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-settings-revision",
      resumeFromSettingsRevision: settings.settingsRevision || null,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function buildSettingsRolloutGateHandoff(metadata, diagnostics, artifacts, readiness, permissionHandoff, settingsHandoff) {
  const source = metadata.settingsRolloutGate || diagnostics.settingsRolloutGate || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const rolloutArtifact = manifest.find((artifact) => artifact.name === "settings-rollout-gate.json");
  const checkpoints = Array.isArray(source.checkpoints) ? source.checkpoints : [];
  const blockedCheckpoints = checkpoints.filter((checkpoint) => checkpoint.ready !== true);
  const permissionBlocked = permissionHandoff.status === "blocked";
  const artifactReady = Boolean(rolloutArtifact?.id);
  const readyForRuntimeStart = permissionBlocked === false
    && artifactReady
    && source.readyForRuntimeStart === true
    && settingsHandoff.readyForClientRuntime === true
    && blockedCheckpoints.length === 0
    && readiness.acceptedForRuntime === true;
  const status = permissionBlocked
    ? "blocked"
    : readyForRuntimeStart
      ? "ready"
      : source.status || (blockedCheckpoints.length > 0 ? "blocked" : "waiting");
  const nextCheckpoint = blockedCheckpoints[0] || checkpoints.find((checkpoint) => checkpoint.ready !== true) || null;
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : source.nextAction
      || nextCheckpoint?.nextAction
      || settingsHandoff.nextAction
      || readiness.nextAction
      || "accept-mailchimp-client-settings";

  return {
    schemaVersion: "aios.mailchimp.settings-rollout-gate-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.settingsRolloutGateArtifact || "settings-rollout-gate.json",
    artifactId: rolloutArtifact?.id || null,
    artifactReady,
    readyForRuntimeStart,
    rolloutKey: source.rolloutKey || persistedState.settingsRolloutGate?.rolloutKey || null,
    settingsRevision: source.settingsRevision || settingsHandoff.settingsRevision || null,
    acknowledgedRevision: source.acknowledgedRevision || settingsHandoff.acceptedSettingsRevision || null,
    revisionAcknowledged: permissionBlocked === false && source.revisionAcknowledged !== false,
    rolloutWindow: source.rolloutWindow || settingsHandoff.controls?.scheduleWindow || "runtime",
    enabled: permissionBlocked === false && source.enabled !== false,
    held: permissionBlocked || source.held === true,
    nextAction,
    nextGateId: permissionBlocked ? "permission-boundary" : source.nextGateId || nextCheckpoint?.gateId || null,
    checkpoints: checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      gateId: checkpoint.gateId,
      order: checkpoint.order,
      label: checkpoint.label,
      state: permissionBlocked ? "blocked" : checkpoint.state || (checkpoint.ready ? "ready" : "blocked"),
      ready: permissionBlocked ? false : checkpoint.ready === true,
      required: checkpoint.required !== false,
      nextAction: permissionBlocked ? permissionHandoff.nextAction : checkpoint.nextAction || nextAction,
      diagnosticCode: checkpoint.diagnosticCode || "client.settings.rollout.held"
    })),
    blocking: {
      blockedGateIds: permissionBlocked
        ? ["permission-boundary"]
        : source.clientPatch?.mailchimpSettingsRolloutBlockedGateIds
          || blockedCheckpoints.map((checkpoint) => checkpoint.gateId).filter(Boolean),
      missingRequiredSettings: settingsHandoff.missingRequiredSettings || [],
      runtimeStartBlocked: settingsHandoff.controls?.runtimeStartBlocked === true,
      held: permissionBlocked || source.held === true
    },
    counters: source.counters || {
      total: checkpoints.length,
      ready: checkpoints.filter((checkpoint) => checkpoint.ready).length,
      blocked: blockedCheckpoints.length
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.settingsRolloutGateArtifact || "settings-rollout-gate.json",
      artifactReady,
      mailchimpSettingsRolloutStatus: status,
      mailchimpSettingsRolloutReady: readyForRuntimeStart,
      mailchimpSettingsRolloutNextAction: nextAction,
      mailchimpSettingsRolloutNextGateId: permissionBlocked ? "permission-boundary" : source.nextGateId || nextCheckpoint?.gateId || null
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-settings-rollout-key",
      resumeFromRolloutKey: source.rolloutKey || null,
      externalWritesPerformed: false
    }
  };
}

function buildClientStatusHandoffContract(metadata, diagnostics, artifacts, readiness, permissionHandoff, settingsHandoff, settingsRolloutHandoff) {
  const source = metadata.clientStatusHandoff || diagnostics.clientStatusHandoff || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const statusArtifact = manifest.find((artifact) => artifact.name === "client-status-handoff.json");
  const route = source.route || {};
  const ledger = source.statusLedger || {};
  const commandAck = source.commandAck || {};
  const blocking = source.blocking || {};
  const pendingAckKeys = normalizeList(commandAck.pendingKeys || []);
  const permissionBlocked = permissionHandoff.status === "blocked";
  const artifactReady = Boolean(statusArtifact?.id);
  const readyForClient = permissionBlocked === false
    && artifactReady
    && source.readyForClient === true
    && settingsHandoff.readyForClientRuntime === true
    && settingsRolloutHandoff.status !== "blocked";
  const readyForRuntime = readyForClient
    && source.readyForRuntime === true
    && settingsRolloutHandoff.readyForRuntimeStart === true
    && pendingAckKeys.length === 0
    && commandAck.ready !== false
    && readiness.acceptedForRuntime === true;
  const status = permissionBlocked
    ? "blocked"
    : readyForRuntime
      ? "ready"
      : source.status || (pendingAckKeys.length > 0 ? "waiting-for-client" : "degraded");
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : source.nextAction
      || (blocking.resumeMissing
        ? "restore-mailchimp-runtime-resume-token"
        : blocking.staleRevision
          ? "refresh-mailchimp-client-status"
          : pendingAckKeys.length > 0
            ? "acknowledge-mailchimp-client-command"
            : settingsRolloutHandoff.nextAction || settingsHandoff.nextAction || readiness.nextAction);
  const statusId = source.statusId
    || persistedState.clientStatusHandoffStatusId
    || `${metadata.jobId}:client-status:${status}:${ledger.statusRevision || "missing"}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.client-status-handoff-contract.v1",
    provider: "mailchimp",
    statusId,
    status,
    visibleStatus: permissionBlocked
      ? "permission-boundary-blocked"
      : source.visibleStatus || status,
    artifactName: persistedState.clientStatusHandoffArtifact || "client-status-handoff.json",
    artifactId: statusArtifact?.id || null,
    readyForClient,
    readyForRuntime,
    nextAction,
    route: {
      routeId: route.routeId || persistedState.clientStatusHandoffRouteId || null,
      method: route.method || "PATCH",
      path: route.path || `/mailchimp/jobs/${metadata.jobId}/client-status`,
      idempotencyKey: route.idempotencyKey || persistedState.clientStatusHandoffRouteKey || null
    },
    statusLedger: {
      resumeToken: ledger.resumeToken || persistedState.resumeToken || null,
      statusRevision: ledger.statusRevision || persistedState.statusRevision || null,
      acceptedStatusRevision: ledger.acceptedStatusRevision || null,
      revisionAccepted: permissionBlocked === false && ledger.revisionAccepted !== false,
      readinessStatus: ledger.readinessStatus || readiness.status,
      visibleStatus: ledger.visibleStatus || source.visibleStatus || status
    },
    commandAck: {
      required: permissionBlocked || commandAck.required === true || pendingAckKeys.length > 0,
      requiredKeys: permissionBlocked ? [] : normalizeList(commandAck.requiredKeys || []),
      pendingKeys: permissionBlocked ? [] : pendingAckKeys,
      acknowledgedKeys: permissionBlocked ? [] : normalizeList(commandAck.acknowledgedKeys || []),
      ready: permissionBlocked === false && pendingAckKeys.length === 0
    },
    blocking: {
      runtimeBlocked: permissionBlocked || blocking.runtimeBlocked === true,
      resumeMissing: permissionBlocked ? false : blocking.resumeMissing === true,
      staleRevision: permissionBlocked ? false : blocking.staleRevision === true,
      pendingAckKeys: permissionBlocked ? [] : pendingAckKeys,
      missingStateKeys: permissionBlocked ? [] : normalizeList(blocking.missingStateKeys || []),
      missingRequiredSettings: permissionBlocked ? [] : normalizeList(blocking.missingRequiredSettings || []),
      settingsRolloutGate: {
        status: settingsRolloutHandoff.status || "unknown",
        readyForRuntimeStart: settingsRolloutHandoff.readyForRuntimeStart === true,
        blockedGateIds: settingsRolloutHandoff.blocking?.blockedGateIds || []
      }
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.clientStatusHandoffArtifact || "client-status-handoff.json",
      artifactReady,
      mailchimpClientStatusId: statusId,
      mailchimpClientVisibleStatus: permissionBlocked ? "permission-boundary-blocked" : source.visibleStatus || status,
      mailchimpClientStatusReady: readyForClient,
      mailchimpClientRuntimeReady: readyForRuntime,
      mailchimpClientStatusNextAction: nextAction
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-status-route-id",
      resumeFromStatusId: statusId,
      externalWritesPerformed: false
    }
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

function buildPersistedStatusEnvelopeRuntimeHandoff(metadata, diagnostics, artifacts, readiness, permissionHandoff) {
  const manifest = artifacts.artifacts || [];
  const envelopeArtifact = manifest.find((artifact) => artifact.name === "persisted-status-envelope.json");
  const persistedState = artifacts.persistedState || {};
  const source = envelopeArtifact?.payload
    || diagnostics.persistedStatusEnvelope
    || persistedState.persistedStatusEnvelope
    || {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const permissionBlocked = permissionHandoff.status === "blocked";
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.blocksRuntimeStart === true);
  const waitingRows = rows.filter((row) => row.status === "waiting");
  const unsafeRows = rows.filter((row) => row.restartSafe === false);
  const status = permissionBlocked || blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0 || unsafeRows.length > 0
      ? "waiting"
      : source.status || "ready";
  const readyForRuntimeResume = permissionBlocked === false
    && status === "ready"
    && source.readyForRuntimeResume === true
    && unsafeRows.length === 0
    && readiness.status !== "blocked";
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : blockedRows[0]?.nextAction
      || waitingRows[0]?.nextAction
      || source.nextAction
      || persistedState.persistedStatusEnvelopeNextAction
      || diagnostics.recovery?.nextAction
      || "refresh-persisted-status-envelope";
  const routePayload = source.routePayload || {
    method: "PUT",
    path: `/mailchimp/jobs/${metadata.jobId}/status-envelope`,
    idempotencyKey: `${metadata.jobId}:${source.statusRevision || persistedState.statusRevision || "status-envelope"}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    bodyShape: {
      statusRevision: "string",
      resumeToken: "string",
      rows: "array",
      restartSemantics: "object"
    }
  };

  return {
    schemaVersion: "aios.mailchimp.persisted-status-envelope-runtime-handoff.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    artifactName: persistedState.persistedStatusEnvelopeArtifact || "persisted-status-envelope.json",
    artifactId: envelopeArtifact?.id || null,
    status,
    visibleStatus: permissionBlocked ? "permission-boundary-blocked" : source.visibleStatus || status,
    readyForRuntimeResume,
    readyForClientStatus: permissionBlocked === false && source.readyForClientStatus !== false,
    resumeToken: source.resumeToken
      || persistedState.persistedStatusEnvelopeResumeToken
      || persistedState.resumeToken
      || diagnostics.statusLedger?.resumeToken
      || null,
    statusRevision: source.statusRevision
      || persistedState.persistedStatusEnvelopeRevision
      || persistedState.statusRevision
      || diagnostics.statusLedger?.statusRevision
      || null,
    nextAction: readyForRuntimeResume ? "handoff-to-runtime-adapter" : nextAction,
    routePayload,
    blocking: {
      commandIds: permissionBlocked
        ? ["permission-boundary", ...(source.blocking?.commandIds || blockedRows.map((row) => row.commandId).filter(Boolean))]
        : source.blocking?.commandIds || blockedRows.map((row) => row.commandId).filter(Boolean),
      waitingCommandIds: permissionBlocked
        ? []
        : source.blocking?.waitingCommandIds || waitingRows.map((row) => row.commandId).filter(Boolean),
      unsafeCommandIds: source.blocking?.unsafeCommandIds || unsafeRows.map((row) => row.commandId).filter(Boolean),
      failureMode: source.blocking?.failureMode || diagnostics.failureState?.mode || "unknown",
      permissionBlocked
    },
    rows: rows.map((row, index) => ({
      order: row.order || index + 1,
      commandId: row.commandId || null,
      status: permissionBlocked ? "blocked" : row.status || "unknown",
      commandStatus: row.commandStatus || "unknown",
      required: row.required === true,
      blocksRuntimeStart: permissionBlocked || row.blocksRuntimeStart === true,
      ackRequired: permissionBlocked ? true : row.ackRequired === true,
      idempotencyKey: permissionBlocked ? null : row.idempotencyKey || null,
      resumeCursor: permissionBlocked ? null : row.resumeCursor || null,
      restartSafe: permissionBlocked ? false : row.restartSafe === true,
      nextAction: permissionBlocked ? permissionHandoff.nextAction : row.nextAction || nextAction
    })),
    counters: {
      rows: rows.length,
      ready: permissionBlocked ? 0 : source.counters?.ready || rows.filter((row) => row.status === "ready").length,
      waiting: permissionBlocked ? 0 : source.counters?.waiting || waitingRows.length,
      blocked: permissionBlocked ? (source.counters?.blocked || blockedRows.length) + 1 : source.counters?.blocked || blockedRows.length,
      restartUnsafe: permissionBlocked ? unsafeRows.length + 1 : source.counters?.restartUnsafe || unsafeRows.length,
      ackRequired: permissionBlocked ? (source.counters?.ackRequired || 0) + 1 : source.counters?.ackRequired || rows.filter((row) => row.ackRequired).length
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      persistedStatusEnvelopeArtifact: persistedState.persistedStatusEnvelopeArtifact || "persisted-status-envelope.json",
      persistedStatusEnvelopeStatus: status,
      persistedStatusEnvelopeReady: readyForRuntimeResume,
      persistedStatusEnvelopeNextAction: readyForRuntimeResume ? "handoff-to-runtime-adapter" : nextAction,
      persistedStatusEnvelopePermissionBlocked: permissionBlocked,
      persistedStatusEnvelopeRevision: source.statusRevision || persistedState.persistedStatusEnvelopeRevision || null
    },
    restartSemantics: {
      replaySafe: readyForRuntimeResume,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy || "dedupe-by-status-envelope-revision",
      resumeFromCommandId: permissionBlocked ? null : source.restartSemantics?.resumeFromCommandId || null,
      staleStatusPolicy: source.restartSemantics?.staleStatusPolicy || {},
      externalWritesPerformed: false
    }
  };
}

function buildRuntimeStatusReplayCursorRuntimeHandoff(metadata, diagnostics, artifacts, readiness, permissionHandoff) {
  const manifest = artifacts.artifacts || [];
  const cursorArtifact = manifest.find((artifact) => artifact.name === "runtime-status-replay-cursor.json");
  const persistedState = artifacts.persistedState || {};
  const source = cursorArtifact?.payload
    || diagnostics.runtimeStatusReplayCursor
    || persistedState.runtimeStatusReplayCursor
    || {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const permissionBlocked = permissionHandoff.status === "blocked";
  const blockedRows = rows.filter((row) => row.blocked === true || row.status === "blocked");
  const waitingRows = rows.filter((row) => row.waiting === true || row.status === "waiting");
  const unsafeRows = rows.filter((row) => row.replaySafe === false);
  const status = permissionBlocked || blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0 || unsafeRows.length > 0
      ? "waiting"
      : source.status || "ready";
  const readyForRestart = permissionBlocked === false
    && status !== "blocked"
    && unsafeRows.length === 0
    && Boolean(source.replayCursor || persistedState.runtimeStatusReplayCursorResumeToken);
  const readyForRuntimeRelease = readyForRestart
    && status === "ready"
    && readiness.status !== "blocked"
    && source.readyForRuntimeRelease !== false;
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : blockedRows[0]?.nextAction
      || waitingRows[0]?.nextAction
      || source.nextAction
      || persistedState.runtimeStatusReplayCursorNextAction
      || "refresh-runtime-status-replay-cursor";

  return {
    schemaVersion: "aios.mailchimp.runtime-status-replay-cursor-runtime-handoff.v1",
    provider: "mailchimp",
    jobId: metadata.jobId,
    artifactName: persistedState.runtimeStatusReplayCursorArtifact || "runtime-status-replay-cursor.json",
    artifactId: cursorArtifact?.id || null,
    status,
    readyForRestart,
    readyForRuntimeRelease,
    replayCursor: source.replayCursor
      || persistedState.runtimeStatusReplayCursorResumeToken
      || persistedState.resumeToken
      || null,
    resumeToken: source.resumeToken
      || persistedState.runtimeStatusReplayCursorResumeToken
      || persistedState.resumeToken
      || null,
    statusRevision: source.statusRevision
      || persistedState.runtimeStatusReplayCursorRevision
      || persistedState.statusRevision
      || null,
    nextAction: readyForRuntimeRelease ? "handoff-to-runtime-adapter" : nextAction,
    routePayload: source.routePayload || {
      method: "PUT",
      path: `/mailchimp/jobs/${metadata.jobId}/runtime-status-replay-cursor`,
      idempotencyKey: `${metadata.jobId}:${source.statusRevision || persistedState.statusRevision || "runtime-status-replay"}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      bodyShape: {
        replayCursor: "string",
        resumeToken: "string",
        statusRevision: "string",
        rows: "array",
        restartSemantics: "object"
      }
    },
    rows: rows.map((row, index) => ({
      order: row.order || index + 1,
      jobId: row.jobId || metadata.jobId,
      operation: row.operation || "mailchimp-runtime-status",
      status: permissionBlocked ? "blocked" : row.status || "unknown",
      replayCursor: permissionBlocked ? null : row.replayCursor || null,
      checkpointKey: permissionBlocked ? null : row.checkpointKey || null,
      ledgerKey: permissionBlocked ? null : row.ledgerKey || null,
      adapterStatusResumeCursor: permissionBlocked ? null : row.adapterStatusResumeCursor || null,
      idempotencyKey: permissionBlocked ? null : row.idempotencyKey || null,
      nextCommandId: permissionBlocked ? null : row.nextCommandId || null,
      replayDecision: permissionBlocked ? "hold-until-healthy" : row.replayDecision || "return-existing-status",
      replaySafe: permissionBlocked ? false : row.replaySafe !== false,
      nextAction: permissionBlocked ? permissionHandoff.nextAction : row.nextAction || nextAction
    })),
    counters: {
      rows: rows.length,
      blocked: permissionBlocked ? blockedRows.length + 1 : blockedRows.length,
      waiting: permissionBlocked ? 0 : waitingRows.length,
      unsafe: permissionBlocked ? unsafeRows.length + 1 : unsafeRows.length,
      replayable: permissionBlocked ? 0 : rows.filter((row) => row.replaySafe !== false).length
    },
    blocking: {
      blockedJobIds: permissionBlocked
        ? [metadata.jobId, ...(source.blocking?.blockedJobIds || blockedRows.map((row) => row.jobId).filter(Boolean))]
        : source.blocking?.blockedJobIds || blockedRows.map((row) => row.jobId).filter(Boolean),
      waitingJobIds: permissionBlocked
        ? []
        : source.blocking?.waitingJobIds || waitingRows.map((row) => row.jobId).filter(Boolean),
      unsafeJobIds: source.blocking?.unsafeJobIds || unsafeRows.map((row) => row.jobId).filter(Boolean),
      permissionBlocked
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      runtimeStatusReplayCursorArtifact: persistedState.runtimeStatusReplayCursorArtifact
        || "runtime-status-replay-cursor.json",
      runtimeStatusReplayCursorStatus: status,
      runtimeStatusReplayCursorReady: readyForRestart,
      runtimeStatusReplayCursorNextAction: readyForRuntimeRelease ? "handoff-to-runtime-adapter" : nextAction,
      runtimeStatusReplayCursorPermissionBlocked: permissionBlocked
    },
    restartSemantics: {
      replaySafe: readyForRestart,
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-runtime-status-replay-cursor",
      onColdRestart: source.restartSemantics?.onColdRestart || "load-runtime-status-replay-cursor",
      onDuplicateCommand: source.restartSemantics?.onDuplicateCommand || "return-existing-runtime-status",
      externalWritesPerformed: false
    }
  };
}

function buildRestartCheckpointRuntimeHandoff(diagnostics, metadata, artifacts, readiness, statusRecoveryHandoff) {
  const checkpointSummary = metadata.restartCheckpoints || diagnostics.restartCheckpointManifest || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const checkpointArtifact = manifest.find((artifact) => artifact.name === "restart-checkpoint-manifest.json");
  const missingRequired = checkpointSummary.blocking?.missingRequiredCheckpoints || [];
  const artifactReady = Boolean(checkpointArtifact?.id);
  const readyForColdRestart = checkpointSummary.readyForColdRestart === true
    && artifactReady
    && missingRequired.length === 0
    && statusRecoveryHandoff.readyForRuntimeResume === true
    && readiness.status !== "blocked";
  const status = missingRequired.length > 0 || statusRecoveryHandoff.status === "blocked"
    ? "blocked"
    : readyForColdRestart
      ? "ready"
      : checkpointSummary.status || "waiting";
  const nextAction = readyForColdRestart
    ? "handoff-to-runtime-adapter"
    : checkpointSummary.nextAction
      || statusRecoveryHandoff.nextAction
      || readiness.nextAction
      || "repair-restart-checkpoints";

  return {
    schemaVersion: "aios.mailchimp.restart-checkpoint-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.restartCheckpointManifestArtifact || "restart-checkpoint-manifest.json",
    artifactId: checkpointArtifact?.id || null,
    readyForColdRestart,
    resumeToken: checkpointSummary.resumeToken
      || persistedState.restartCheckpointResumeToken
      || statusRecoveryHandoff.resume?.resumeToken
      || persistedState.resumeToken
      || null,
    statusRevision: checkpointSummary.statusRevision
      || persistedState.statusRevision
      || statusRecoveryHandoff.resume?.statusRevision
      || null,
    counters: checkpointSummary.counters || {},
    blocking: {
      missingRequiredCheckpoints: missingRequired,
      commandIds: checkpointSummary.blocking?.commandIds || [],
      leaseIds: checkpointSummary.blocking?.leaseIds || [],
      failureIds: checkpointSummary.blocking?.failureIds || []
    },
    checkpoints: Array.isArray(checkpointSummary.checkpoints)
      ? checkpointSummary.checkpoints.map((checkpoint) => ({
        phase: checkpoint.phase,
        required: checkpoint.required === true,
        ready: checkpoint.ready === true,
        restartSafe: checkpoint.restartSafe === true,
        cursor: checkpoint.cursor || null,
        replayPolicy: checkpoint.replayPolicy || "dedupe-by-idempotency-key",
        nextAction: checkpoint.nextAction || nextAction
      }))
      : [],
    restartSemantics: {
      replaySafe: readyForColdRestart,
      duplicateCommandPolicy: checkpointSummary.restartSemantics?.duplicateCommandPolicy
        || statusRecoveryHandoff.restartSemantics?.duplicateCommandPolicy
        || "dedupe-by-idempotency-key",
      resumeFromCommandId: checkpointSummary.restartSemantics?.resumeFromCommandId
        || statusRecoveryHandoff.resume?.resumeFromCommandId
        || null,
      resumeFromLeaseId: checkpointSummary.restartSemantics?.resumeFromLeaseId
        || statusRecoveryHandoff.resume?.resumeFromLeaseId
        || null,
      resumeFromFailureId: checkpointSummary.restartSemantics?.resumeFromFailureId
        || statusRecoveryHandoff.resume?.resumeFromFailureId
        || null,
      externalWritesPerformed: false,
      staleStatusPolicy: checkpointSummary.restartSemantics?.staleStatusPolicy
        || statusRecoveryHandoff.restartSemantics?.staleStatusPolicy
        || {}
    },
    clientPatch: {
      ...(checkpointSummary.clientPatch || {}),
      artifactName: persistedState.restartCheckpointManifestArtifact || "restart-checkpoint-manifest.json",
      artifactReady,
      restartCheckpointStatus: status,
      restartCheckpointReady: readyForColdRestart,
      restartCheckpointNextAction: nextAction,
      restartCheckpointResumeToken: checkpointSummary.resumeToken || persistedState.restartCheckpointResumeToken || null,
      restartCheckpointRevision: checkpointSummary.statusRevision || persistedState.statusRevision || null
    },
    nextAction
  };
}

function buildServiceLevelObjectiveRuntimeHandoff(metadata, diagnostics, artifacts, readiness) {
  const summary = metadata.serviceLevelObjectives || diagnostics.serviceLevelObjectives || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const artifact = manifest.find((item) => item.name === "service-level-objectives.json");
  const breaches = Array.isArray(summary.breaches) ? summary.breaches : [];
  const blocking = breaches.filter((breach) => breach.blocksRuntimeRelease === true);
  const status = readiness.status === "blocked" || blocking.length > 0
    ? "blocked"
    : summary.status || (breaches.length > 0 ? "degraded" : "ready");
  const readyForRuntimeRelease = status === "ready"
    && summary.readyForRuntimeRelease === true
    && Boolean(artifact?.id)
    && readiness.acceptedForRuntime === true;
  const nextAction = readyForRuntimeRelease
    ? readiness.nextAction || "handoff-to-runtime-adapter"
    : blocking[0]?.nextAction
      || summary.nextAction
      || "review-mailchimp-service-level-objective";

  return {
    schemaVersion: "aios.mailchimp.service-level-objective-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    healthLevel: summary.healthLevel || (status === "ready" ? "healthy" : status === "blocked" ? "unhealthy" : "degraded"),
    artifactName: persistedState.serviceLevelObjectiveArtifact || "service-level-objectives.json",
    artifactId: artifact?.id || null,
    readyForRuntimeRelease,
    nextAction,
    nextBreachId: blocking[0]?.id || summary.nextBreachId || null,
    counters: summary.counters || {
      breached: breaches.length,
      blocking: blocking.length
    },
    blockingBreachIds: blocking.map((breach) => breach.id).filter(Boolean),
    retry: {
      retryable: summary.retry?.retryable === true && blocking.length === 0,
      backoffMs: blocking.length > 0 ? 0 : summary.retry?.backoffMs || 0,
      maxAttempts: blocking.length > 0 ? 0 : summary.retry?.maxAttempts || 0,
      nextAction: summary.retry?.nextAction || nextAction
    },
    clientPatch: {
      ...(summary.clientPatch || {}),
      artifactName: persistedState.serviceLevelObjectiveArtifact || "service-level-objectives.json",
      artifactReady: Boolean(artifact?.id),
      serviceLevelObjectiveRuntimeStatus: status,
      serviceLevelObjectiveRuntimeReady: readyForRuntimeRelease,
      serviceLevelObjectiveRuntimeNextAction: nextAction
    },
    restartSemantics: summary.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-service-level-objective-job-id",
      resumeFromBreachId: blocking[0]?.id || null,
      externalWritesPerformed: false
    }
  };
}

function buildClientRemediationRuntimeHandoff(metadata, diagnostics, artifacts, readiness, permissionHandoff) {
  const source = metadata.clientRemediation || diagnostics.clientRemediationPacket || {};
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const artifact = manifest.find((item) => item.name === "client-remediation-packet.json");
  const steps = Array.isArray(source.steps) ? source.steps : [];
  const blockingSteps = steps.filter((step) => step.status === "blocked");
  const waitingSteps = steps.filter((step) => step.status === "waiting");
  const permissionBlocked = permissionHandoff.status === "blocked";
  const status = permissionBlocked
    ? "blocked"
    : source.status
      || (blockingSteps.length > 0
        ? "blocked"
        : waitingSteps.length > 0
          ? "needs-operator-action"
          : "ready");
  const readyForClient = permissionBlocked === false
    && Boolean(artifact?.id)
    && source.readyForClient === true
    && readiness.acceptedForClientPreview === true;
  const readyForRuntime = readyForClient
    && source.readyForRuntime === true
    && readiness.acceptedForRuntime === true
    && blockingSteps.length === 0;
  const nextStep = blockingSteps[0] || waitingSteps[0] || steps[0] || null;
  const route = source.route || {};
  const routeId = route.routeId
    || persistedState.clientRemediationPacketRouteId
    || `${artifacts.jobId || metadata.jobId || "mailchimp"}:client-remediation:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : source.nextAction || nextStep?.nextAction || readiness.nextAction || "handoff-to-runtime-adapter";

  return {
    schemaVersion: "aios.mailchimp.client-remediation-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    visibleStatus: permissionBlocked ? "blocked-before-runtime" : source.visibleStatus || status,
    artifactName: persistedState.clientRemediationPacketArtifact || "client-remediation-packet.json",
    artifactId: artifact?.id || null,
    readyForClient,
    readyForRuntime,
    nextAction,
    route: {
      routeId,
      idempotencyKey: route.idempotencyKey || `${routeId}:${route.statusRevision || persistedState.statusRevision || status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      target: route.target || "client-runtime",
      resumeToken: route.resumeToken || persistedState.clientRemediationPacketResumeToken || persistedState.resumeToken || null,
      statusRevision: route.statusRevision || persistedState.statusRevision || null
    },
    counters: {
      steps: source.counters?.steps || steps.length,
      blocking: permissionBlocked ? (source.counters?.blocking || blockingSteps.length) + 1 : source.counters?.blocking || blockingSteps.length,
      waiting: source.counters?.waiting || waitingSteps.length,
      clientVisibleIncidents: source.counters?.clientVisibleIncidents || 0,
      runtimeBlockingIncidents: source.counters?.runtimeBlockingIncidents || 0
    },
    steps: steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      status: permissionBlocked ? "blocked" : step.status,
      owner: permissionBlocked ? "workspace-admin" : step.owner,
      nextAction: permissionBlocked ? permissionHandoff.nextAction : step.nextAction
    })),
    blocking: {
      stepIds: permissionBlocked ? ["permission-boundary"] : blockingSteps.map((step) => step.id),
      permissionBlocked,
      waitingStepIds: permissionBlocked ? [] : waitingSteps.map((step) => step.id)
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.clientRemediationPacketArtifact || "client-remediation-packet.json",
      artifactReady: Boolean(artifact?.id),
      clientRemediationRuntimeStatus: status,
      clientRemediationRuntimeReady: readyForRuntime,
      clientRemediationRuntimeNextAction: nextAction,
      clientRemediationRouteId: routeId
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-remediation-route",
      resumeToken: route.resumeToken || persistedState.resumeToken || null,
      statusRevision: route.statusRevision || persistedState.statusRevision || null,
      externalWritesPerformed: false
    }
  };
}

function buildOperationalHealthReportRuntimeHandoff(metadata, diagnostics, artifacts, readiness, permissionHandoff) {
  const manifest = artifacts.handoffManifest || [];
  const artifact = manifest.find((item) => item.name === "operational-health-report.json");
  const persistedState = artifacts.persistedState || {};
  const exportSummary = artifacts.summary || {};
  const artifactSummary = metadata.exports?.summary || {};
  const report = artifacts.artifacts?.find((item) => item.name === "operational-health-report.json")?.payload
    || metadata.operationalHealthReport
    || diagnostics.operationalHealthReport
    || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const blockingRows = rows.filter((row) => row.blocksRuntimeStart === true || row.status === "blocked");
  const retryableRows = rows.filter((row) => row.retryable === true);
  const degradedRows = rows.filter((row) => row.status === "degraded" || row.status === "needs-operator-action");
  const permissionBlocked = permissionHandoff.status === "blocked";
  const status = permissionBlocked
    ? "blocked"
    : report.status || (blockingRows.length > 0 ? "blocked" : degradedRows.length > 0 ? "degraded" : "ready");
  const nextRow = permissionBlocked
    ? null
    : blockingRows[0] || retryableRows[0] || degradedRows[0] || rows[0] || null;
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : report.nextAction || nextRow?.nextAction || readiness.nextAction || "handoff-to-runtime-adapter";
  const resumeToken = report.resumeToken
    || persistedState.operationalHealthReportResumeToken
    || artifactSummary.operationalHealthReportResumeToken
    || persistedState.resumeToken
    || null;
  const statusRevision = report.statusRevision
    || persistedState.statusRevision
    || artifactSummary.statusRevision
    || null;
  const readyForRuntime = permissionBlocked === false
    && Boolean(artifact?.id)
    && status !== "blocked"
    && blockingRows.length === 0
    && readiness.status !== "blocked";

  return {
    schemaVersion: "aios.mailchimp.operational-health-report-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    healthLevel: permissionBlocked ? "unhealthy" : report.healthLevel || (status === "ready" ? "healthy" : "degraded"),
    artifactName: persistedState.operationalHealthReportArtifact || "operational-health-report.json",
    artifactId: artifact?.id || null,
    reportId: report.reportId || null,
    readyForRuntime,
    exportReady: permissionBlocked === false && report.exportReady === true,
    resumeToken,
    statusRevision,
    nextAction,
    counters: {
      rows: report.counters?.rows || rows.length,
      blocking: permissionBlocked ? blockingRows.length + 1 : report.counters?.blocking || blockingRows.length,
      degraded: report.counters?.degraded || degradedRows.length,
      retryable: report.counters?.retryable || retryableRows.length,
      clientVisibleIncidents: report.counters?.clientVisibleIncidents || 0,
      providerVisibleIncidents: report.counters?.providerVisibleIncidents || 0
    },
    blocking: {
      rowIds: permissionBlocked
        ? ["permission-boundary", ...blockingRows.map((row) => row.id)]
        : report.exportSummary?.blockingRowIds || blockingRows.map((row) => row.id),
      degradedRowIds: permissionBlocked ? [] : report.exportSummary?.degradedRowIds || degradedRows.map((row) => row.id),
      retryableRowIds: permissionBlocked ? [] : report.exportSummary?.retryableRowIds || retryableRows.map((row) => row.id),
      permissionBlocked
    },
    rows: rows.map((row) => ({
      id: row.id,
      order: row.order,
      phase: row.phase,
      status: permissionBlocked ? "blocked" : row.status,
      healthLevel: permissionBlocked ? "unhealthy" : row.healthLevel,
      owner: permissionBlocked ? "workspace-admin" : row.owner,
      nextAction: permissionBlocked ? permissionHandoff.nextAction : row.nextAction || nextAction,
      retryable: permissionBlocked ? false : row.retryable === true,
      blocksRuntimeStart: permissionBlocked || row.blocksRuntimeStart === true
    })),
    clientPatch: {
      ...(report.clientPatch || {}),
      artifactName: persistedState.operationalHealthReportArtifact || "operational-health-report.json",
      artifactReady: Boolean(artifact?.id),
      operationalHealthReportRuntimeStatus: status,
      operationalHealthReportRuntimeReady: readyForRuntime,
      operationalHealthReportNextAction: nextAction,
      operationalHealthReportResumeToken: resumeToken,
      operationalHealthReportBlocking: permissionBlocked ? blockingRows.length + 1 : report.counters?.blocking || blockingRows.length
    },
    restartSemantics: report.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-operational-health-report-revision",
      resumeToken,
      statusRevision,
      externalWritesPerformed: false
    }
  };
}

function buildOperationalIncidentExportRuntimeHandoff(metadata, diagnostics, artifacts, readiness, permissionHandoff) {
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const artifact = manifest.find((item) => item.name === "operational-incident-export.json");
  const source = artifacts.artifacts?.find((item) => item.name === "operational-incident-export.json")?.payload
    || metadata.operationalIncidentExport
    || diagnostics.operationalIncidentExport
    || {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const permissionBlocked = permissionHandoff.status === "blocked";
  const blockingRows = rows.filter((row) => row.blocksRuntimeStart === true || row.status === "blocked");
  const retryableRows = rows.filter((row) => row.retryable === true);
  const visibleRows = rows.filter((row) => row.clientVisible === true || row.providerVisible === true);
  const artifactReady = Boolean(artifact?.id);
  const status = permissionBlocked
    ? "blocked"
    : source.status || (blockingRows.length > 0 ? "blocked" : rows.length > 0 ? "degraded" : "ready");
  const nextRow = permissionBlocked
    ? null
    : blockingRows[0] || retryableRows[0] || rows[0] || null;
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : source.nextAction || nextRow?.nextAction || readiness.nextAction || "handoff-to-runtime-adapter";
  const resumeToken = source.resumeToken
    || persistedState.operationalIncidentExportResumeToken
    || persistedState.resumeToken
    || diagnostics.statusLedger?.resumeToken
    || null;
  const statusRevision = source.statusRevision
    || persistedState.statusRevision
    || diagnostics.statusLedger?.statusRevision
    || null;
  const readyForRuntime = permissionBlocked === false
    && artifactReady
    && status !== "blocked"
    && blockingRows.length === 0
    && readiness.status !== "blocked";

  return {
    schemaVersion: "aios.mailchimp.operational-incident-export-runtime-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.operationalIncidentExportArtifact || "operational-incident-export.json",
    artifactId: artifact?.id || null,
    artifactReady,
    readyForRuntime,
    exportReady: permissionBlocked === false && source.exportReady === true && blockingRows.length === 0,
    resumeToken,
    statusRevision,
    nextAction,
    rows: rows.map((row) => ({
      id: row.id,
      order: row.order,
      source: row.source,
      jobId: row.jobId,
      code: row.code,
      status: permissionBlocked ? "blocked" : row.status,
      severity: permissionBlocked ? "error" : row.severity,
      owner: permissionBlocked ? "workspace-admin" : row.owner,
      nextAction: permissionBlocked ? permissionHandoff.nextAction : row.nextAction || nextAction,
      retryable: permissionBlocked ? false : row.retryable === true,
      blocksRuntimeStart: permissionBlocked || row.blocksRuntimeStart === true,
      clientVisible: row.clientVisible === true,
      providerVisible: row.providerVisible === true,
      resumeCursor: row.resumeCursor || resumeToken
    })),
    counters: {
      rows: source.counters?.rows || rows.length,
      blocking: permissionBlocked ? blockingRows.length + 1 : source.counters?.blocking || blockingRows.length,
      retryable: permissionBlocked ? 0 : source.counters?.retryable || retryableRows.length,
      clientVisible: source.counters?.clientVisible || rows.filter((row) => row.clientVisible === true).length,
      providerVisible: source.counters?.providerVisible || rows.filter((row) => row.providerVisible === true).length,
      visible: visibleRows.length
    },
    blocking: {
      rowIds: permissionBlocked
        ? Array.from(new Set(["permission-boundary", ...blockingRows.map((row) => row.id)])).sort()
        : source.exportSummary?.blockingRowIds || blockingRows.map((row) => row.id),
      retryableRowIds: permissionBlocked ? [] : source.exportSummary?.retryableRowIds || retryableRows.map((row) => row.id),
      permissionBlocked
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.operationalIncidentExportArtifact || "operational-incident-export.json",
      artifactReady,
      operationalIncidentExportRuntimeStatus: status,
      operationalIncidentExportRuntimeReady: readyForRuntime,
      operationalIncidentExportNextAction: nextAction,
      operationalIncidentExportBlockingRows: permissionBlocked
        ? ["permission-boundary", ...blockingRows.map((row) => row.id)]
        : source.exportSummary?.blockingRowIds || blockingRows.map((row) => row.id),
      operationalIncidentExportResumeToken: resumeToken
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-operational-incident-row-id",
      resumeToken,
      statusRevision,
      externalWritesPerformed: false
    }
  };
}

function buildRuntimeExportWatermarkRuntimeHandoff(metadata, diagnostics, artifacts, readiness, permissionHandoff) {
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const analyticsArtifact = manifest.find((item) => item.name === "dry-run-analytics-export.json");
  const analyticsPayload = artifacts.artifacts?.find((item) => item.name === "dry-run-analytics-export.json")?.payload
    || metadata.dryRun?.dryRunAnalyticsExport
    || diagnostics.dryRunAnalyticsExport
    || {};
  const source = analyticsPayload.runtimeExportWatermark
    || metadata.dryRun?.runtimeExportWatermark
    || metadata.analytics?.runtimeExportWatermark
    || diagnostics.runtimeExportWatermark
    || {};
  const partitions = Array.isArray(source.partitions) ? source.partitions : [];
  const blockedPartitions = partitions.filter((partition) => partition.status === "blocked");
  const waitingPartitions = partitions.filter((partition) => partition.status === "waiting");
  const permissionBlocked = permissionHandoff.status === "blocked";
  const artifactReady = Boolean(analyticsArtifact?.id);
  const status = permissionBlocked
    ? "blocked"
    : source.status || (blockedPartitions.length > 0 ? "blocked" : waitingPartitions.length > 0 ? "waiting" : "ready");
  const nextPartition = permissionBlocked ? null : blockedPartitions[0] || waitingPartitions[0] || partitions[0] || null;
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : source.nextAction
      || nextPartition?.nextAction
      || analyticsPayload.nextAction
      || readiness.nextAction
      || "handoff-to-runtime-adapter";
  const cursor = source.cursor
    || analyticsPayload.exportSummary?.runtimeExportCursor
    || analyticsPayload.reportingState?.reportingCursor
    || persistedState.dryRunReportingCursor
    || persistedState.resumeToken
    || null;
  const dedupeKey = source.dedupeKey
    || `${metadata.jobId || "mailchimp"}:${cursor || "runtime-export-watermark"}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const readyForRuntime = permissionBlocked === false
    && artifactReady
    && Boolean(cursor)
    && status !== "blocked"
    && readiness.status !== "blocked";

  return {
    schemaVersion: "aios.mailchimp.runtime-export-watermark-handoff.v1",
    provider: "mailchimp",
    status,
    artifactName: persistedState.dryRunAnalyticsExportArtifact || "dry-run-analytics-export.json",
    artifactId: analyticsArtifact?.id || null,
    artifactReady,
    readyForRuntime,
    exportReady: permissionBlocked === false && source.exportReady === true && blockedPartitions.length === 0,
    cursor,
    dedupeKey,
    nextAction,
    highWatermarks: source.highWatermarks || {},
    partitions: partitions.map((partition) => ({
      name: partition.name,
      status: permissionBlocked ? "blocked" : partition.status || status,
      cursor: partition.cursor || null,
      rows: partition.rows || 0,
      blockedRefs: permissionBlocked
        ? Array.from(new Set(["permission-boundary", ...(partition.blockedRefs || [])])).sort()
        : partition.blockedRefs || [],
      waitingRefs: permissionBlocked ? [] : partition.waitingRefs || [],
      nextAction: permissionBlocked ? permissionHandoff.nextAction : partition.nextAction || nextAction,
    })),
    counters: {
      partitions: source.counters?.partitions || partitions.length,
      blockedPartitions: permissionBlocked ? blockedPartitions.length + 1 : source.counters?.blockedPartitions || blockedPartitions.length,
      waitingPartitions: permissionBlocked ? 0 : source.counters?.waitingPartitions || waitingPartitions.length,
      historySnapshots: source.counters?.historySnapshots || analyticsPayload.counters?.historySnapshots || 0,
      timelineEvents: source.counters?.timelineEvents || analyticsPayload.counters?.timelineEvents || 0,
      blockedJobs: source.counters?.blockedJobs || source.exportSummary?.blockedJobIds?.length || 0,
      waitingJobs: source.counters?.waitingJobs || source.exportSummary?.waitingJobIds?.length || 0,
    },
    blocking: {
      partitionNames: permissionBlocked
        ? Array.from(new Set(["permission-boundary", ...blockedPartitions.map((partition) => partition.name)])).sort()
        : blockedPartitions.map((partition) => partition.name),
      blockedJobIds: permissionBlocked ? [] : source.exportSummary?.blockedJobIds || [],
      waitingJobIds: permissionBlocked ? [] : source.exportSummary?.waitingJobIds || [],
      permissionBlocked,
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      runtimeExportWatermarkArtifact: "dry-run-analytics-export.json",
      runtimeExportWatermarkStatus: status,
      runtimeExportWatermarkReady: readyForRuntime,
      runtimeExportWatermarkNextAction: nextAction,
      runtimeExportWatermarkCursor: cursor,
      runtimeExportWatermarkDedupeKey: dedupeKey,
    },
    restartSemantics: {
      ...(source.restartSemantics || {}),
      replaySafe: permissionBlocked === false && source.restartSemantics?.replaySafe !== false && status !== "blocked",
      duplicateCommandPolicy: source.restartSemantics?.duplicateCommandPolicy || "dedupe-by-runtime-export-watermark",
      cursor,
      externalWritesPerformed: false,
    },
  };
}

function buildClientReadinessBriefRuntimeHandoff(metadata, diagnostics, artifacts, readiness, permissionHandoff) {
  const persistedState = artifacts.persistedState || {};
  const manifest = artifacts.handoffManifest || [];
  const artifact = manifest.find((item) => item.name === "client-readiness-brief.json");
  const source = artifacts.artifacts?.find((item) => item.name === "client-readiness-brief.json")?.payload
    || metadata.clientReadinessBrief
    || diagnostics.clientReadinessBrief
    || {};
  const sections = Array.isArray(source.sections) ? source.sections : [];
  const permissionBlocked = permissionHandoff.status === "blocked";
  const blockedSections = sections.filter((section) => section.status === "blocked" || section.counters?.blocked > 0);
  const pendingSections = sections.filter((section) => (
    section.status === "needs-operator-action"
    || section.status === "waiting-for-client"
    || section.counters?.pending > 0
  ));
  const artifactReady = Boolean(artifact?.id);
  const readyForClientPreview = permissionBlocked === false
    && artifactReady
    && source.readyForClientPreview === true
    && blockedSections.length === 0;
  const readyForRuntimeStart = readyForClientPreview
    && source.readyForRuntimeStart === true
    && readiness.acceptedForRuntime === true
    && pendingSections.length === 0;
  const status = permissionBlocked
    ? "blocked"
    : blockedSections.length > 0
      ? "blocked"
      : pendingSections.length > 0 || readyForRuntimeStart === false
        ? "needs-operator-action"
        : source.status || "ready";
  const nextSection = permissionBlocked
    ? {
      id: "permission-boundary",
      nextAction: permissionHandoff.nextAction
    }
    : sections.find((section) => section.id === source.nextSectionId)
      || blockedSections[0]
      || pendingSections[0]
      || sections.find((section) => section.readyForRuntimeStart !== true)
      || null;
  const route = source.route || {};
  const resumeToken = route.resumeToken
    || persistedState.resumeToken
    || metadata.exports?.summary?.resumeToken
    || diagnostics.statusLedger?.resumeToken
    || null;
  const statusRevision = route.statusRevision
    || persistedState.statusRevision
    || metadata.exports?.summary?.statusRevision
    || diagnostics.statusLedger?.statusRevision
    || null;
  const routeId = route.routeId
    || persistedState.clientReadinessBriefRouteId
    || `${metadata.jobId}:client-readiness-brief`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = permissionBlocked
    ? permissionHandoff.nextAction
    : nextSection?.nextAction || source.nextAction || readiness.nextAction || "handoff-to-runtime-adapter";

  return {
    schemaVersion: "aios.mailchimp.client-readiness-brief-handoff.v1",
    provider: "mailchimp",
    status,
    visibleStatus: permissionBlocked ? "mailchimp-preview-blocked" : source.visibleStatus || status,
    artifactName: persistedState.clientReadinessBriefArtifact || "client-readiness-brief.json",
    artifactId: artifact?.id || null,
    artifactReady,
    readyForClientPreview,
    readyForRuntimeStart,
    nextAction,
    nextSectionId: permissionBlocked ? "permission-boundary" : nextSection?.id || source.nextSectionId || null,
    route: {
      routeId,
      method: route.method || "GET",
      path: route.path || `/mailchimp/jobs/${metadata.jobId}/client-readiness`,
      idempotencyKey: route.idempotencyKey
        || `${routeId}:${statusRevision || "missing"}:${resumeToken || "missing"}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      resumeToken,
      statusRevision
    },
    validationSummary: {
      ...(source.validationSummary || {}),
      blocked: permissionBlocked
        ? (source.validationSummary?.blocked || blockedSections.length) + 1
        : source.validationSummary?.blocked || blockedSections.length,
      pending: source.validationSummary?.pending || pendingSections.length,
      blockingSectionIds: permissionBlocked
        ? Array.from(new Set(["permission-boundary", ...blockedSections.map((section) => section.id)])).sort()
        : source.validationSummary?.blockingSectionIds || blockedSections.map((section) => section.id),
      pendingSectionIds: permissionBlocked
        ? []
        : source.validationSummary?.pendingSectionIds || pendingSections.map((section) => section.id)
    },
    sections: sections.map((section) => ({
      order: section.order,
      id: section.id,
      label: section.label,
      status: permissionBlocked && section.id === "permission-boundary" ? "blocked" : section.status,
      readyForClientPreview: permissionBlocked ? false : section.readyForClientPreview === true,
      readyForRuntimeStart: permissionBlocked ? false : section.readyForRuntimeStart === true,
      nextAction: permissionBlocked && section.id === "permission-boundary"
        ? permissionHandoff.nextAction
        : section.nextAction || nextAction,
      routeId: section.routeId || null,
      counters: section.counters || {}
    })),
    clientPatch: {
      ...(source.clientPatch || {}),
      artifactName: persistedState.clientReadinessBriefArtifact || "client-readiness-brief.json",
      artifactReady,
      clientReadinessBriefStatus: status,
      clientReadinessBriefVisibleStatus: permissionBlocked ? "mailchimp-preview-blocked" : source.visibleStatus || status,
      clientReadinessBriefRouteId: routeId,
      clientReadinessBriefNextAction: nextAction,
      clientReadinessBriefNextSectionId: permissionBlocked ? "permission-boundary" : nextSection?.id || source.nextSectionId || null,
      clientReadinessReadyForPreview: readyForClientPreview,
      clientReadinessReadyForRuntimeStart: readyForRuntimeStart
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-readiness-brief-route",
      resumeToken,
      statusRevision,
      resumeFromSectionId: permissionBlocked ? "permission-boundary" : nextSection?.id || null,
      externalWritesPerformed: false
    }
  };
}

function buildOperationalContractState(readiness, permissionHandoff, diagnostics, metadata, artifacts) {
  const health = metadata.health || {};
  const retry = health.retry || {};
  const adapterFailureState = health.adapterFailureState || {};
  const exportSummary = metadata.exports?.summary || {};
  const artifactCheck = assertMailchimpArtifactsReady(artifacts);
  const previewAcceptance = buildPreviewAcceptanceHandoff(metadata, artifacts, readiness, permissionHandoff);
  const previewAcceptancePacket = buildPreviewAcceptancePacketHandoff(
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff,
    previewAcceptance
  );
  const lifecycleControls = buildLifecycleControlsHandoff(metadata, artifacts, readiness, permissionHandoff);
  const clientWorkflow = buildClientWorkflowContractHandoff(metadata, artifacts, readiness, permissionHandoff);
  const previewHandoff = buildPreviewHandoffContract(
    metadata,
    artifacts,
    readiness,
    permissionHandoff,
    previewAcceptance,
    clientWorkflow
  );
  const previewExportReadiness = buildPreviewExportReadinessRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness
  );
  const previewReadinessManifest = buildPreviewReadinessManifestRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff
  );
  const runtimeReleaseControls = buildRuntimeReleaseControlsHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff
  );
  const previewReleaseTicket = buildPreviewReleaseTicketHandoff(
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff,
    previewAcceptancePacket,
    runtimeReleaseControls
  );
  const clientRuntimeAdoption = buildClientRuntimeAdoptionHandoff(metadata, artifacts, readiness, permissionHandoff);
  const clientRuntimeSettings = buildClientRuntimeSettingsHandoff(
    metadata,
    artifacts,
    readiness,
    permissionHandoff,
    clientRuntimeAdoption
  );
  const settingsRolloutGate = buildSettingsRolloutGateHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff,
    clientRuntimeSettings
  );
  const clientStatusHandoff = buildClientStatusHandoffContract(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff,
    clientRuntimeSettings,
    settingsRolloutGate
  );
  const providerServiceHandoff = buildProviderServiceRuntimeHandoff(metadata, artifacts, readiness);
  const providerSyncCheckpoint = buildProviderSyncCheckpointRuntimeHandoff(metadata, diagnostics, artifacts, readiness);
  const providerExportReadiness = buildProviderExportReadinessRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    providerSyncCheckpoint
  );
  const providerCallbackHandoff = buildProviderCallbackRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    providerServiceHandoff
  );
  const providerIntegrationHandoff = buildProviderIntegrationRuntimeHandoff(metadata, diagnostics, artifacts, readiness);
  const providerIntegrationExecutionTicket = buildProviderIntegrationExecutionTicketRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    providerIntegrationHandoff
  );
  const permissionGrantHandoff = buildPermissionGrantRuntimeHandoff(metadata, diagnostics, artifacts, permissionHandoff);
  const tenantPermissionEnforcement = buildTenantPermissionEnforcementRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    permissionHandoff,
    permissionGrantHandoff
  );
  const tenantBoundaryPosture = buildTenantBoundaryPostureRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    permissionHandoff,
    tenantPermissionEnforcement
  );
  const runtimeBoundaryExecutionTicket = buildRuntimeBoundaryExecutionTicketRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff,
    tenantBoundaryPosture
  );
  const clientCommandLeases = buildClientCommandLeaseRuntimeHandoff(metadata, artifacts, readiness, permissionHandoff);
  const clientCommandLeaseReplayHandoff = buildClientCommandLeaseReplayRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff,
    clientCommandLeases
  );
  const statusHandoff = buildStatusRuntimeHandoff(
    diagnostics,
    metadata,
    artifacts,
    readiness,
    permissionHandoff,
    clientCommandLeases
  );
  const persistedStatusEnvelope = buildPersistedStatusEnvelopeRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff
  );
  const runtimeStatusReplayCursor = buildRuntimeStatusReplayCursorRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff
  );
  const statusRecoveryHandoff = buildStatusRecoveryRuntimeHandoff(
    diagnostics,
    metadata,
    artifacts,
    readiness,
    statusHandoff
  );
  const restartCheckpointHandoff = buildRestartCheckpointRuntimeHandoff(
    diagnostics,
    metadata,
    artifacts,
    readiness,
    statusRecoveryHandoff
  );
  const serviceLevelObjectiveHandoff = buildServiceLevelObjectiveRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness
  );
  const clientRemediationHandoff = buildClientRemediationRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff
  );
  const operationalHealthReportHandoff = buildOperationalHealthReportRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff
  );
  const operationalIncidentExportHandoff = buildOperationalIncidentExportRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff
  );
  const runtimeExportWatermarkHandoff = buildRuntimeExportWatermarkRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff
  );
  const clientReadinessBrief = buildClientReadinessBriefRuntimeHandoff(
    metadata,
    diagnostics,
    artifacts,
    readiness,
    permissionHandoff
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
  const previewAcceptancePacketFailures = previewAcceptancePacket.status === "blocked"
    || previewAcceptancePacket.readyForClient === false
    ? [{
      id: "mailchimp.contract.preview-acceptance-packet",
      nextAction: previewAcceptancePacket.nextAction,
      category: "preview-acceptance-packet"
    }]
    : [];
  const previewHandoffFailures = previewHandoff.status === "blocked" || previewHandoff.readyForClient === false
    ? [{
      id: "mailchimp.contract.preview-handoff",
      nextAction: previewHandoff.nextAction,
      category: "preview-handoff"
    }]
    : [];
  const previewExportReadinessFailures = previewExportReadiness.status === "blocked"
    || previewExportReadiness.readyForClientPreview === false
    ? [{
      id: "mailchimp.contract.preview-export-readiness",
      nextAction: previewExportReadiness.nextAction,
      category: "preview-export-readiness"
    }]
    : [];
  const previewReadinessManifestFailures = previewReadinessManifest.status === "blocked"
    || previewReadinessManifest.readyForClientPreview === false
    ? [{
      id: "mailchimp.contract.preview-readiness-manifest",
      nextAction: previewReadinessManifest.nextAction,
      category: "preview-readiness-manifest"
    }]
    : [];
  const runtimeReleaseControlFailures = runtimeReleaseControls.status === "blocked"
    || runtimeReleaseControls.readyForRuntimeStart === false && runtimeReleaseControls.status !== "needs-operator-action"
    ? [{
      id: "mailchimp.contract.runtime-release-controls",
      nextAction: runtimeReleaseControls.nextAction,
      category: "runtime-release-controls"
    }]
    : [];
  const previewReleaseTicketFailures = previewReleaseTicket.status === "blocked"
    || previewReleaseTicket.readyForRuntimeRelease === false && previewReleaseTicket.status !== "needs-operator-action"
    ? [{
      id: "mailchimp.contract.preview-release-ticket",
      nextAction: previewReleaseTicket.nextAction,
      category: "preview-release-ticket"
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
  const providerSyncFailures = providerSyncCheckpoint.readyForRuntime === false
    ? [{
      id: "mailchimp.contract.provider-sync-checkpoint",
      nextAction: providerSyncCheckpoint.nextAction,
      category: "provider-sync-checkpoint"
    }]
    : [];
  const providerExportFailures = providerExportReadiness.readyForRuntime === false
    ? [{
      id: "mailchimp.contract.provider-export-readiness",
      nextAction: providerExportReadiness.nextAction,
      category: "provider-export-readiness"
    }]
    : [];
  const providerCallbackFailures = providerCallbackHandoff.readyForRuntime === false
    ? [{
      id: "mailchimp.contract.provider-callback-handoff",
      nextAction: providerCallbackHandoff.nextAction,
      category: "provider-callback-handoff"
    }]
    : [];
  const providerIntegrationFailures = providerIntegrationHandoff.readyForRuntime === false
    ? [{
      id: "mailchimp.contract.provider-integration",
      nextAction: providerIntegrationHandoff.nextAction,
      category: "provider-integration-handoff"
    }]
    : [];
  const providerIntegrationExecutionTicketFailures = providerIntegrationExecutionTicket.readyForRuntimeRelease === false
    ? [{
      id: "mailchimp.contract.provider-integration-execution-ticket",
      nextAction: providerIntegrationExecutionTicket.nextAction,
      category: "provider-integration-execution-ticket"
    }]
    : [];
  const permissionGrantFailures = permissionGrantHandoff.status === "blocked"
    || permissionGrantHandoff.readyForAudit === false && permissionHandoff.status !== "blocked"
    ? [{
      id: "mailchimp.contract.permission-grant-plan",
      nextAction: permissionGrantHandoff.nextAction,
      category: "permission-grant-plan"
    }]
    : [];
  const tenantPermissionEnforcementFailures = tenantPermissionEnforcement.status === "blocked"
    || tenantPermissionEnforcement.readyForRuntime === false && permissionHandoff.status !== "blocked"
    ? [{
      id: "mailchimp.contract.tenant-permission-enforcement",
      nextAction: tenantPermissionEnforcement.nextAction,
      category: "tenant-permission-enforcement"
    }]
    : [];
  const runtimeBoundaryExecutionTicketFailures = runtimeBoundaryExecutionTicket.status === "blocked"
    || runtimeBoundaryExecutionTicket.readyForRuntimeRelease === false && runtimeBoundaryExecutionTicket.status !== "waiting"
    ? [{
      id: "mailchimp.contract.runtime-boundary-execution-ticket",
      nextAction: runtimeBoundaryExecutionTicket.nextAction,
      category: "runtime-boundary-execution-ticket"
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
  const clientCommandLeaseReplayFailures = clientCommandLeaseReplayHandoff.status === "blocked"
    || clientCommandLeaseReplayHandoff.readyForRuntime === false && clientCommandLeaseReplayHandoff.ack.required !== true
    ? [{
      id: "mailchimp.contract.client-command-lease-replay",
      nextAction: clientCommandLeaseReplayHandoff.nextAction,
      category: "client-command-lease-replay"
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
  const clientRuntimeSettingsFailures = clientRuntimeSettings.status === "blocked"
    || clientRuntimeSettings.readyForClientRuntime === false && clientRuntimeSettings.revisionAccepted === false
    ? [{
      id: "mailchimp.contract.client-runtime-settings",
      nextAction: clientRuntimeSettings.nextAction,
      category: "client-runtime-settings"
    }]
    : [];
  const settingsRolloutGateFailures = settingsRolloutGate.status === "blocked"
    || settingsRolloutGate.readyForRuntimeStart === false && settingsRolloutGate.status !== "waiting"
    ? [{
      id: "mailchimp.contract.settings-rollout-gate",
      nextAction: settingsRolloutGate.nextAction,
      category: "settings-rollout-gate"
    }]
    : [];
  const clientStatusHandoffFailures = clientStatusHandoff.status === "blocked"
    || clientStatusHandoff.readyForClient === false && clientStatusHandoff.commandAck.required !== true
    ? [{
      id: "mailchimp.contract.client-status-handoff",
      nextAction: clientStatusHandoff.nextAction,
      category: "client-status-handoff"
    }]
    : [];
  const statusHandoffFailures = statusHandoff.readyForClient === false || statusHandoff.status === "blocked"
    ? [{
      id: "mailchimp.contract.status-handoff",
      nextAction: statusHandoff.nextAction,
      category: "status-handoff"
    }]
    : [];
  const persistedStatusEnvelopeFailures = persistedStatusEnvelope.status === "blocked"
    || persistedStatusEnvelope.readyForRuntimeResume === false && persistedStatusEnvelope.status !== "waiting"
    ? [{
      id: "mailchimp.contract.persisted-status-envelope",
      nextAction: persistedStatusEnvelope.nextAction,
      category: "persisted-status-envelope"
    }]
    : [];
  const runtimeStatusReplayCursorFailures = runtimeStatusReplayCursor.status === "blocked"
    || runtimeStatusReplayCursor.readyForRestart === false && runtimeStatusReplayCursor.status !== "waiting"
    ? [{
      id: "mailchimp.contract.runtime-status-replay-cursor",
      nextAction: runtimeStatusReplayCursor.nextAction,
      category: "runtime-status-replay-cursor"
    }]
    : [];
  const statusRecoveryFailures = statusRecoveryHandoff.status === "blocked"
    ? [{
      id: "mailchimp.contract.status-recovery",
      nextAction: statusRecoveryHandoff.nextAction,
      category: "status-recovery"
    }]
    : [];
  const restartCheckpointFailures = restartCheckpointHandoff.status === "blocked"
    ? [{
      id: "mailchimp.contract.restart-checkpoints",
      nextAction: restartCheckpointHandoff.nextAction,
      category: "restart-checkpoints"
    }]
    : [];
  const serviceLevelObjectiveFailures = serviceLevelObjectiveHandoff.status === "blocked"
    || serviceLevelObjectiveHandoff.readyForRuntimeRelease === false && serviceLevelObjectiveHandoff.status !== "degraded"
    ? [{
      id: "mailchimp.contract.service-level-objectives",
      nextAction: serviceLevelObjectiveHandoff.nextAction,
      category: "service-level-objectives"
    }]
    : [];
  const clientRemediationFailures = clientRemediationHandoff.status === "blocked"
    || clientRemediationHandoff.readyForClient === false && clientRemediationHandoff.counters.blocking > 0
    ? [{
      id: "mailchimp.contract.client-remediation",
      nextAction: clientRemediationHandoff.nextAction,
      category: "client-remediation"
    }]
    : [];
  const operationalHealthReportFailures = operationalHealthReportHandoff.status === "blocked"
    || operationalHealthReportHandoff.readyForRuntime === false && operationalHealthReportHandoff.counters.blocking > 0
    ? [{
      id: "mailchimp.contract.operational-health-report",
      nextAction: operationalHealthReportHandoff.nextAction,
      category: "operational-health-report"
    }]
    : [];
  const operationalIncidentExportFailures = operationalIncidentExportHandoff.status === "blocked"
    || operationalIncidentExportHandoff.readyForRuntime === false && operationalIncidentExportHandoff.counters.blocking > 0
    ? [{
      id: "mailchimp.contract.operational-incident-export",
      nextAction: operationalIncidentExportHandoff.nextAction,
      category: "operational-incident-export"
    }]
    : [];
  const runtimeExportWatermarkFailures = runtimeExportWatermarkHandoff.status === "blocked"
    || runtimeExportWatermarkHandoff.readyForRuntime === false && runtimeExportWatermarkHandoff.counters.blockedPartitions > 0
    ? [{
      id: "mailchimp.contract.runtime-export-watermark",
      nextAction: runtimeExportWatermarkHandoff.nextAction,
      category: "runtime-export-watermark"
    }]
    : [];
  const clientReadinessBriefFailures = clientReadinessBrief.status === "blocked"
    || clientReadinessBrief.readyForClientPreview === false && clientReadinessBrief.validationSummary.blocked > 0
    ? [{
      id: "mailchimp.contract.client-readiness-brief",
      nextAction: clientReadinessBrief.nextAction,
      category: "client-readiness-brief"
    }]
    : [];
  const failures = [
    ...readinessFailures,
    ...permissionFailures,
    ...artifactFailures,
    ...previewFailures,
    ...previewAcceptancePacketFailures,
    ...previewHandoffFailures,
    ...previewExportReadinessFailures,
    ...previewReadinessManifestFailures,
    ...runtimeReleaseControlFailures,
    ...previewReleaseTicketFailures,
    ...lifecycleFailures,
    ...providerServiceFailures,
    ...providerSyncFailures,
    ...providerExportFailures,
    ...providerCallbackFailures,
    ...providerIntegrationFailures,
    ...providerIntegrationExecutionTicketFailures,
    ...permissionGrantFailures,
    ...tenantPermissionEnforcementFailures,
    ...runtimeBoundaryExecutionTicketFailures,
    ...clientWorkflowFailures,
    ...clientCommandLeaseFailures,
    ...clientCommandLeaseReplayFailures,
    ...clientRuntimeAdoptionFailures,
    ...clientRuntimeSettingsFailures,
    ...settingsRolloutGateFailures,
    ...clientStatusHandoffFailures,
    ...statusHandoffFailures,
    ...persistedStatusEnvelopeFailures,
    ...runtimeStatusReplayCursorFailures,
    ...statusRecoveryFailures,
    ...restartCheckpointFailures,
    ...serviceLevelObjectiveFailures,
    ...clientRemediationFailures,
    ...operationalHealthReportFailures,
    ...operationalIncidentExportFailures,
    ...runtimeExportWatermarkFailures,
    ...clientReadinessBriefFailures
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
    ...(artifactCheck.previewAcceptancePacketReady === false ? ["preview-acceptance-packet-missing"] : []),
    ...(artifactCheck.previewHandoffReady === false ? ["preview-handoff-missing"] : []),
    ...(artifactCheck.previewExportReadinessReady === false ? ["preview-export-readiness-missing"] : []),
    ...(artifactCheck.previewReadinessManifestReady === false ? ["preview-readiness-manifest-missing"] : []),
    ...(artifactCheck.runtimeReleaseControlsReady === false ? ["runtime-release-controls-missing"] : []),
    ...(artifactCheck.lifecycleControlsReady === false ? ["lifecycle-controls-missing"] : []),
    ...(artifactCheck.exportSummaryReady === false ? ["export-summary-missing"] : []),
    ...(artifactCheck.providerServiceReady === false ? ["provider-service-handoff-missing"] : []),
    ...(artifactCheck.providerSyncCheckpointReady === false ? ["provider-sync-checkpoint-missing"] : []),
    ...(artifactCheck.providerExportReadinessReady === false ? ["provider-export-readiness-missing"] : []),
    ...(artifactCheck.providerCallbackHandoffReady === false ? ["provider-callback-handoff-missing"] : []),
    ...(artifactCheck.providerIntegrationHandoffReady === false ? ["provider-integration-handoff-missing"] : []),
    ...(artifactCheck.providerIntegrationExecutionTicketReady === false ? ["provider-integration-execution-ticket-missing"] : []),
    ...(artifactCheck.serviceLevelObjectiveReady === false ? ["service-level-objectives-missing"] : []),
    ...(artifactCheck.permissionGrantPlanReady === false ? ["permission-grant-plan-missing"] : []),
    ...(artifactCheck.clientWorkflowReady === false ? ["client-workflow-missing"] : []),
    ...(artifactCheck.clientRuntimeAdoptionReady === false ? ["client-runtime-adoption-missing"] : []),
    ...(artifactCheck.clientRuntimeSettingsReady === false ? ["client-runtime-settings-missing"] : []),
    ...(artifactCheck.settingsRolloutGateReady === false ? ["settings-rollout-gate-missing"] : []),
    ...(artifactCheck.clientStatusHandoffReady === false ? ["client-status-handoff-missing"] : []),
    ...(artifactCheck.clientCommandLeasesReady === false ? ["client-command-leases-missing"] : []),
    ...(artifactCheck.clientCommandLeaseReplayHandoffReady === false ? ["client-command-lease-replay-handoff-missing"] : []),
    ...(clientCommandLeases.ack.required === true ? ["client-command-ack-required"] : []),
    ...(clientCommandLeases.status === "blocked" ? ["client-command-leases-blocked"] : []),
    ...(clientCommandLeaseReplayHandoff.status === "blocked" ? ["client-command-lease-replay-blocked"] : []),
    ...(clientCommandLeaseReplayHandoff.ack.required === true ? ["client-command-lease-replay-ack-required"] : []),
    ...(clientCommandLeaseReplayHandoff.readyForRuntime === false ? ["client-command-lease-replay-not-runtime-ready"] : []),
    ...(clientRuntimeAdoption.status === "blocked" ? ["client-runtime-adoption-blocked"] : []),
    ...(clientRuntimeAdoption.status === "waiting-for-client" ? ["client-runtime-adoption-waiting"] : []),
    ...(clientRuntimeSettings.status === "blocked" ? ["client-runtime-settings-blocked"] : []),
    ...(clientRuntimeSettings.status === "needs-operator-action" ? ["client-runtime-settings-pending"] : []),
    ...(settingsRolloutGate.status === "blocked" ? ["settings-rollout-gate-blocked"] : []),
    ...(settingsRolloutGate.readyForRuntimeStart === false ? ["settings-rollout-runtime-start-not-ready"] : []),
    ...(clientStatusHandoff.status === "blocked" ? ["client-status-handoff-blocked"] : []),
    ...(clientStatusHandoff.status === "waiting-for-client" ? ["client-status-handoff-waiting"] : []),
    ...(clientStatusHandoff.commandAck.required === true ? ["client-status-ack-required"] : []),
    ...(statusHandoff.readyForClient === false ? ["status-handoff-not-client-ready"] : []),
    ...(statusHandoff.readyForRuntime === false ? ["status-handoff-not-runtime-ready"] : []),
    ...(statusHandoff.clientCommandAck.required === true ? ["status-handoff-ack-required"] : []),
    ...(artifactCheck.persistedStatusEnvelopeReady === false ? ["persisted-status-envelope-missing"] : []),
    ...(persistedStatusEnvelope.readyForRuntimeResume === false ? ["persisted-status-envelope-not-ready"] : []),
    ...(persistedStatusEnvelope.status === "blocked" ? ["persisted-status-envelope-blocked"] : []),
    ...(artifactCheck.runtimeStatusReplayCursorReady === false ? ["runtime-status-replay-cursor-missing"] : []),
    ...(runtimeStatusReplayCursor.readyForRestart === false ? ["runtime-status-replay-cursor-not-ready"] : []),
    ...(runtimeStatusReplayCursor.status === "blocked" ? ["runtime-status-replay-cursor-blocked"] : []),
    ...(statusRecoveryHandoff.readyForRuntimeResume === false ? ["status-recovery-not-ready"] : []),
    ...(statusRecoveryHandoff.status === "blocked" ? ["status-recovery-blocked"] : []),
    ...(restartCheckpointHandoff.readyForColdRestart === false ? ["restart-checkpoints-not-ready"] : []),
    ...(restartCheckpointHandoff.status === "blocked" ? ["restart-checkpoints-blocked"] : []),
    ...(serviceLevelObjectiveHandoff.readyForRuntimeRelease === false ? ["service-level-objective-release-not-ready"] : []),
    ...(serviceLevelObjectiveHandoff.status === "blocked" ? ["service-level-objective-blocked"] : []),
    ...(clientRemediationHandoff.readyForClient === false ? ["client-remediation-not-client-ready"] : []),
    ...(clientRemediationHandoff.status === "blocked" ? ["client-remediation-blocked"] : []),
    ...(operationalHealthReportHandoff.exportReady === false ? ["operational-health-report-not-export-ready"] : []),
    ...(operationalHealthReportHandoff.status === "blocked" ? ["operational-health-report-blocked"] : []),
    ...(operationalIncidentExportHandoff.exportReady === false ? ["operational-incident-export-not-ready"] : []),
    ...(operationalIncidentExportHandoff.status === "blocked" ? ["operational-incident-export-blocked"] : []),
    ...(runtimeExportWatermarkHandoff.exportReady === false ? ["runtime-export-watermark-not-ready"] : []),
    ...(runtimeExportWatermarkHandoff.status === "blocked" ? ["runtime-export-watermark-blocked"] : []),
    ...(runtimeExportWatermarkHandoff.status === "waiting" ? ["runtime-export-watermark-waiting"] : []),
    ...(clientReadinessBrief.readyForClientPreview === false ? ["client-readiness-brief-not-preview-ready"] : []),
    ...(clientReadinessBrief.readyForRuntimeStart === false ? ["client-readiness-brief-not-runtime-ready"] : []),
    ...(clientReadinessBrief.status === "blocked" ? ["client-readiness-brief-blocked"] : []),
    ...(providerServiceHandoff.readyForRuntime === false ? ["provider-service-handoff-not-ready"] : []),
    ...(providerSyncCheckpoint.readyForRuntime === false ? ["provider-sync-checkpoint-not-ready"] : []),
    ...(providerExportReadiness.readyForRuntime === false ? ["provider-export-readiness-not-ready"] : []),
    ...(providerIntegrationHandoff.readyForRuntime === false ? ["provider-integration-handoff-not-ready"] : []),
    ...(providerIntegrationExecutionTicket.readyForRuntimeRelease === false ? ["provider-integration-execution-ticket-not-ready"] : []),
    ...(permissionGrantHandoff.readyForAudit === false ? ["permission-grant-audit-not-ready"] : []),
    ...(permissionGrantHandoff.status === "blocked" ? ["permission-grant-plan-blocked"] : []),
    ...(tenantPermissionEnforcement.readyForRuntime === false ? ["tenant-permission-enforcement-not-ready"] : []),
    ...(tenantPermissionEnforcement.status === "blocked" ? ["tenant-permission-enforcement-blocked"] : []),
    ...(runtimeBoundaryExecutionTicket.readyForRuntimeRelease === false ? ["runtime-boundary-ticket-not-ready"] : []),
    ...(runtimeBoundaryExecutionTicket.status === "blocked" ? ["runtime-boundary-ticket-blocked"] : []),
    ...(runtimeBoundaryExecutionTicket.status === "waiting" ? ["runtime-boundary-ticket-waiting"] : []),
    ...(clientWorkflow.status === "needs-operator-action" ? ["client-workflow-pending"] : []),
    ...(clientWorkflow.status === "blocked" ? ["client-workflow-blocked"] : []),
    ...(previewAcceptance.status === "needs-operator-action" ? ["preview-acceptance-pending"] : []),
    ...(previewAcceptance.status === "blocked" ? ["preview-acceptance-blocked"] : []),
    ...(previewAcceptancePacket.readyForClient === false ? ["preview-acceptance-packet-not-client-ready"] : []),
    ...(previewAcceptancePacket.status === "blocked" ? ["preview-acceptance-packet-blocked"] : []),
    ...(previewHandoff.status === "needs-operator-action" ? ["preview-handoff-pending"] : []),
    ...(previewHandoff.status === "blocked" ? ["preview-handoff-blocked"] : []),
    ...(previewExportReadiness.readyForRuntimeStart === false ? ["preview-export-runtime-start-not-ready"] : []),
    ...(previewExportReadiness.status === "blocked" ? ["preview-export-readiness-blocked"] : []),
    ...(previewReadinessManifest.readyForClientPreview === false ? ["preview-readiness-manifest-not-preview-ready"] : []),
    ...(previewReadinessManifest.readyForRuntimeStart === false ? ["preview-readiness-manifest-not-runtime-ready"] : []),
    ...(previewReadinessManifest.status === "blocked" ? ["preview-readiness-manifest-blocked"] : []),
    ...(runtimeReleaseControls.readyForRuntimeStart === false ? ["runtime-release-controls-not-ready"] : []),
    ...(runtimeReleaseControls.status === "blocked" ? ["runtime-release-controls-blocked"] : []),
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
        && permissionGrantHandoff.readyForRuntime === true
        && providerServiceHandoff.readyForRuntime === true
        && providerSyncCheckpoint.readyForRuntime === true
        && providerExportReadiness.readyForRuntime === true
        && providerCallbackHandoff.readyForRuntime === true
        && providerIntegrationHandoff.readyForRuntime === true
        && providerIntegrationExecutionTicket.readyForRuntimeRelease === true
        && tenantPermissionEnforcement.readyForRuntime === true
        && tenantBoundaryPosture.readyForRuntime === true
        && runtimeBoundaryExecutionTicket.readyForRuntimeRelease === true
        && clientRuntimeAdoption.readyForClientRuntime === true
        && clientRuntimeSettings.readyForClientRuntime === true
        && settingsRolloutGate.readyForRuntimeStart === true
        && clientStatusHandoff.readyForRuntime === true
        && statusHandoff.readyForRuntime === true
        && persistedStatusEnvelope.readyForRuntimeResume === true
        && runtimeStatusReplayCursor.readyForRuntimeRelease === true
        && statusRecoveryHandoff.readyForRuntimeResume === true
        && restartCheckpointHandoff.readyForColdRestart === true
        && serviceLevelObjectiveHandoff.readyForRuntimeRelease === true
        && clientRemediationHandoff.readyForRuntime === true
        && operationalHealthReportHandoff.readyForRuntime === true
        && operationalIncidentExportHandoff.readyForRuntime === true
        && runtimeExportWatermarkHandoff.readyForRuntime === true
        && clientReadinessBrief.readyForRuntimeStart === true
        && clientCommandLeaseReplayHandoff.readyForRuntime === true
        && previewAcceptance.runtimeStartEnabledAfterAcceptance === true
        && previewAcceptancePacket.readyForRuntimeStart === true
        && previewHandoff.readyForRuntimeStart === true
        && previewExportReadiness.readyForRuntimeStart === true
        && previewReadinessManifest.readyForRuntimeStart === true
        && runtimeReleaseControls.readyForRuntimeStart === true
        && previewReleaseTicket.readyForRuntimeRelease === true
        && lifecycleControls.runtimeStartEnabled === true
        && status === "ready"
        && adapterFailureState.mode !== "blocked",
      previewEnabled: readiness.acceptedForClientPreview === true
        && permissionHandoff.status !== "blocked"
        && providerServiceHandoff.status !== "blocked"
        && providerExportReadiness.status !== "blocked"
        && previewAcceptance.previewEnabled === true
        && previewAcceptancePacket.readyForClient === true
        && previewHandoff.readyForClient === true
        && previewExportReadiness.readyForClientPreview === true
        && previewReadinessManifest.readyForClientPreview === true
        && clientRemediationHandoff.readyForClient === true
        && clientReadinessBrief.readyForClientPreview === true
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
    previewAcceptancePacket,
    previewHandoff,
    previewExportReadiness,
    previewReadinessManifest,
    runtimeReleaseControls,
    previewReleaseTicket,
    clientWorkflow,
    clientRuntimeAdoption,
    clientRuntimeSettings,
    settingsRolloutGate,
    clientStatusHandoff,
    clientCommandLeases,
    clientCommandLeaseReplayHandoff,
    statusHandoff,
    persistedStatusEnvelope,
    runtimeStatusReplayCursor,
    statusRecoveryHandoff,
    restartCheckpointHandoff,
    serviceLevelObjectiveHandoff,
    clientRemediationHandoff,
    operationalHealthReportHandoff,
    operationalIncidentExportHandoff,
    runtimeExportWatermarkHandoff,
    clientReadinessBrief,
    providerServiceHandoff,
    providerSyncCheckpoint,
    providerExportReadiness,
    providerCallbackHandoff,
    providerIntegrationHandoff,
    providerIntegrationExecutionTicket,
    permissionGrantHandoff,
    tenantPermissionEnforcement,
    tenantBoundaryPosture,
    runtimeBoundaryExecutionTicket,
    lifecycleControlHandoff: lifecycleControls,
    statusResume: {
      resumeToken: exportSummary.resumeToken || health.statusHandoff?.resumeToken || null,
      statusRevision: exportSummary.statusRevision || health.statusHandoff?.statusRevision || null,
      latestSnapshotId: metadata.history?.latestSnapshotId || null,
      persistedStateArtifact: artifacts.persistedState?.artifactName || null,
      permissionBoundaryArtifact: artifacts.persistedState?.permissionBoundaryArtifact || null,
      permissionGrantPlanArtifact: artifacts.persistedState?.permissionGrantPlanArtifact || null,
      permissionGrantPlanStatus: artifacts.persistedState?.permissionGrantPlanStatus || permissionGrantHandoff.status,
      permissionGrantPlanReady: permissionGrantHandoff.readyForAudit === true,
      permissionGrantPlanNextAction: permissionGrantHandoff.nextAction,
      tenantPermissionEnforcementArtifact: artifacts.persistedState?.tenantPermissionEnforcementArtifact || null,
      tenantPermissionEnforcementStatus: artifacts.persistedState?.tenantPermissionEnforcementStatus || tenantPermissionEnforcement.status,
      tenantPermissionEnforcementReady: tenantPermissionEnforcement.readyForRuntime === true,
      tenantPermissionEnforcementKey: artifacts.persistedState?.tenantPermissionEnforcementKey || tenantPermissionEnforcement.enforcementKey,
      tenantPermissionEnforcementNextAction: tenantPermissionEnforcement.nextAction,
      tenantBoundaryPostureArtifact: artifacts.persistedState?.tenantBoundaryPostureArtifact || "tenant-boundary-posture.json",
      tenantBoundaryPostureStatus: tenantBoundaryPosture.status,
      tenantBoundaryPostureReady: tenantBoundaryPosture.readyForRuntime === true,
      tenantBoundaryPostureKey: artifacts.persistedState?.tenantBoundaryPostureKey || tenantBoundaryPosture.postureKey,
      tenantBoundaryPostureNextAction: tenantBoundaryPosture.nextAction,
      runtimeBoundaryExecutionTicketArtifact: runtimeBoundaryExecutionTicket.artifactName,
      runtimeBoundaryExecutionTicketStatus: runtimeBoundaryExecutionTicket.status,
      runtimeBoundaryExecutionTicketReady: runtimeBoundaryExecutionTicket.readyForRuntimeRelease === true,
      runtimeBoundaryExecutionTicketKey: runtimeBoundaryExecutionTicket.ticketKey,
      runtimeBoundaryExecutionTicketNextAction: runtimeBoundaryExecutionTicket.nextAction,
      runtimeBoundaryExecutionTicketBlockedJobIds: runtimeBoundaryExecutionTicket.validationSummary.blockedJobIds,
      runtimeBoundaryExecutionTicketWaitingJobIds: runtimeBoundaryExecutionTicket.validationSummary.waitingJobIds,
      persistedStatusEnvelopeArtifact: artifacts.persistedState?.persistedStatusEnvelopeArtifact || "persisted-status-envelope.json",
      persistedStatusEnvelopeStatus: persistedStatusEnvelope.status,
      persistedStatusEnvelopeReady: persistedStatusEnvelope.readyForRuntimeResume === true,
      persistedStatusEnvelopeNextAction: persistedStatusEnvelope.nextAction,
      persistedStatusEnvelopeResumeToken: persistedStatusEnvelope.resumeToken,
      tenantBoundarySafeForAuditAppend: tenantBoundaryPosture.safeForAuditAppend === true,
      tenantIsolationKey: artifacts.persistedState?.tenantIsolationKey || null,
      commandJournalArtifact: artifacts.persistedState?.commandJournalArtifact || null,
      clientCommandLeasesArtifact: artifacts.persistedState?.clientCommandLeasesArtifact || null,
      clientRuntimeAdoptionArtifact: artifacts.persistedState?.clientRuntimeAdoptionArtifact || null,
      clientRuntimeAdoptionId: artifacts.persistedState?.clientRuntimeAdoptionId || clientRuntimeAdoption.adoptionId,
      clientRuntimeAdoptionStatus: artifacts.persistedState?.clientRuntimeAdoptionStatus || clientRuntimeAdoption.status,
      clientRuntimeReady: clientRuntimeAdoption.readyForClientRuntime === true,
      clientRuntimeSettingsArtifact: artifacts.persistedState?.clientRuntimeSettingsArtifact || null,
      clientRuntimeSettingsStatus: clientRuntimeSettings.status,
      clientRuntimeSettingsRevision: clientRuntimeSettings.settingsRevision,
      clientRuntimeSettingsReady: clientRuntimeSettings.readyForClientRuntime === true,
      settingsRolloutGateArtifact: artifacts.persistedState?.settingsRolloutGateArtifact || "settings-rollout-gate.json",
      settingsRolloutGateStatus: settingsRolloutGate.status,
      settingsRolloutGateReady: settingsRolloutGate.readyForRuntimeStart === true,
      settingsRolloutGateNextAction: settingsRolloutGate.nextAction,
      settingsRolloutGateNextGateId: settingsRolloutGate.nextGateId,
      clientStatusHandoffArtifact: artifacts.persistedState?.clientStatusHandoffArtifact || null,
      clientStatusHandoffStatus: clientStatusHandoff.status,
      clientStatusHandoffVisibleStatus: clientStatusHandoff.visibleStatus,
      clientStatusHandoffReadyForClient: clientStatusHandoff.readyForClient === true,
      clientStatusHandoffReadyForRuntime: clientStatusHandoff.readyForRuntime === true,
      clientStatusHandoffRouteId: clientStatusHandoff.route.routeId || null,
      clientStatusHandoffNextAction: clientStatusHandoff.nextAction,
      commandLeaseResumeToken: artifacts.persistedState?.commandLeaseResumeToken || null,
      clientCommandLeaseStatus: artifacts.persistedState?.clientCommandLeaseStatus || clientCommandLeases.status,
      clientCommandAckRequired: artifacts.persistedState?.clientCommandAckRequired === true
        || clientCommandLeases.ack.required === true,
      clientCommandLeaseReplayHandoffArtifact: artifacts.persistedState?.clientCommandLeaseReplayHandoffArtifact
        || "client-command-lease-replay-handoff.json",
      clientCommandLeaseReplayHandoffStatus: clientCommandLeaseReplayHandoff.status,
      clientCommandLeaseReplayHandoffReady: clientCommandLeaseReplayHandoff.readyForRuntime === true,
      clientCommandLeaseReplayHandoffRouteId: clientCommandLeaseReplayHandoff.routeId || null,
      clientCommandLeaseReplayHandoffNextAction: clientCommandLeaseReplayHandoff.nextAction,
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
      restartCheckpointArtifact: artifacts.persistedState?.restartCheckpointManifestArtifact || null,
      restartCheckpointReady: restartCheckpointHandoff.readyForColdRestart === true,
      restartCheckpointStatus: restartCheckpointHandoff.status,
      restartCheckpointNextAction: restartCheckpointHandoff.nextAction,
      restartCheckpointResumeToken: restartCheckpointHandoff.resumeToken || null,
      clientRemediationPacketArtifact: artifacts.persistedState?.clientRemediationPacketArtifact || null,
      clientRemediationStatus: clientRemediationHandoff.status,
      clientRemediationReadyForClient: clientRemediationHandoff.readyForClient === true,
      clientRemediationReadyForRuntime: clientRemediationHandoff.readyForRuntime === true,
      clientRemediationRouteId: clientRemediationHandoff.route.routeId || null,
      clientRemediationNextAction: clientRemediationHandoff.nextAction,
      runtimeExportWatermarkArtifact: runtimeExportWatermarkHandoff.artifactName,
      runtimeExportWatermarkStatus: runtimeExportWatermarkHandoff.status,
      runtimeExportWatermarkReady: runtimeExportWatermarkHandoff.readyForRuntime === true,
      runtimeExportWatermarkExportReady: runtimeExportWatermarkHandoff.exportReady === true,
      runtimeExportWatermarkNextAction: runtimeExportWatermarkHandoff.nextAction,
      runtimeExportWatermarkCursor: runtimeExportWatermarkHandoff.cursor || null,
      runtimeExportWatermarkDedupeKey: runtimeExportWatermarkHandoff.dedupeKey || null,
      clientReadinessBriefArtifact: artifacts.persistedState?.clientReadinessBriefArtifact || "client-readiness-brief.json",
      clientReadinessBriefStatus: clientReadinessBrief.status,
      clientReadinessBriefVisibleStatus: clientReadinessBrief.visibleStatus,
      clientReadinessBriefReadyForPreview: clientReadinessBrief.readyForClientPreview === true,
      clientReadinessBriefReadyForRuntimeStart: clientReadinessBrief.readyForRuntimeStart === true,
      clientReadinessBriefRouteId: clientReadinessBrief.route.routeId || null,
      clientReadinessBriefNextAction: clientReadinessBrief.nextAction,
      statusSnapshotArtifact: artifacts.persistedState?.statusSnapshotArtifact || null,
      failureStateArtifact: artifacts.persistedState?.failureStateArtifact || null,
      providerServiceHandoffArtifact: artifacts.persistedState?.providerServiceHandoffArtifact || null,
      providerServiceHandoffReady: artifacts.persistedState?.providerServiceHandoffReady === true,
      providerServiceHandoffKey: artifacts.persistedState?.providerServiceHandoffKey || null,
      providerSyncCheckpointArtifact: artifacts.persistedState?.providerSyncCheckpointArtifact || null,
      providerSyncCheckpointReady: providerSyncCheckpoint.readyForRuntime === true,
      providerSyncCheckpointStatus: providerSyncCheckpoint.status,
      providerSyncCheckpointNextAction: providerSyncCheckpoint.nextAction,
      providerSyncCheckpointResumeToken: providerSyncCheckpoint.resumeToken || null,
      providerExportReadinessArtifact: artifacts.persistedState?.providerExportReadinessArtifact || "provider-export-readiness.json",
      providerExportReadinessReady: providerExportReadiness.readyForRuntime === true,
      providerExportReadinessStatus: providerExportReadiness.status,
      providerExportReadinessNextAction: providerExportReadiness.nextAction,
      providerExportReadinessResumeToken: providerExportReadiness.resumeToken || null,
      providerExportReadinessBlockedRows: providerExportReadiness.validationSummary.blockedRowIds || [],
      providerCallbackHandoffArtifact: artifacts.persistedState?.providerCallbackHandoffArtifact || "provider-callback-handoff.json",
      providerCallbackHandoffReady: providerCallbackHandoff.readyForRuntime === true,
      providerCallbackHandoffStatus: providerCallbackHandoff.status,
      providerCallbackHandoffNextAction: providerCallbackHandoff.nextAction,
      providerCallbackHandoffResumeToken: providerCallbackHandoff.resumeToken || null,
      providerCallbackMissingEvents: providerCallbackHandoff.events?.missing || [],
      providerIntegrationHandoffArtifact: artifacts.persistedState?.providerIntegrationHandoffArtifact || "provider-integration-handoff.json",
      providerIntegrationHandoffReady: providerIntegrationHandoff.readyForRuntime === true,
      providerIntegrationHandoffStatus: providerIntegrationHandoff.status,
      providerIntegrationHandoffNextAction: providerIntegrationHandoff.nextAction,
      providerIntegrationHandoffNextGateId: providerIntegrationHandoff.nextGateId,
      providerIntegrationHandoffResumeToken: providerIntegrationHandoff.resumeToken || null,
      providerIntegrationExecutionTicketArtifact: artifacts.persistedState?.providerIntegrationExecutionTicketArtifact
        || "provider-integration-execution-ticket.json",
      providerIntegrationExecutionTicketReady: providerIntegrationExecutionTicket.readyForRuntimeRelease === true,
      providerIntegrationExecutionTicketStatus: providerIntegrationExecutionTicket.status,
      providerIntegrationExecutionTicketNextAction: providerIntegrationExecutionTicket.nextAction,
      providerIntegrationExecutionTicketResumeCursor: providerIntegrationExecutionTicket.resumeCursor || null,
      previewAcceptanceArtifact: artifacts.persistedState?.previewAcceptanceArtifact || null,
      previewHandoffArtifact: artifacts.persistedState?.previewHandoffArtifact || null,
      previewHandoffRouteId: artifacts.persistedState?.previewHandoffRouteId || previewHandoff.routeId,
      previewHandoffStatus: artifacts.persistedState?.previewHandoffStatus || previewHandoff.status,
      previewHandoffNextAction: artifacts.persistedState?.previewHandoffNextAction || previewHandoff.nextAction,
      previewHandoffReadyForClient: previewHandoff.readyForClient === true,
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
    providerSyncCheckpointHandoff: operationalState.providerSyncCheckpoint,
    providerExportReadinessHandoff: operationalState.providerExportReadiness,
    providerCallbackHandoff: operationalState.providerCallbackHandoff,
    providerIntegrationHandoff: operationalState.providerIntegrationHandoff,
    providerIntegrationExecutionTicketHandoff: operationalState.providerIntegrationExecutionTicket,
    permissionGrantHandoff: operationalState.permissionGrantHandoff,
    tenantPermissionEnforcementHandoff: operationalState.tenantPermissionEnforcement,
    runtimeBoundaryExecutionTicketHandoff: operationalState.runtimeBoundaryExecutionTicket,
    clientWorkflowHandoff: operationalState.clientWorkflow,
    previewAcceptancePacketHandoff: operationalState.previewAcceptancePacket,
    previewReleaseTicketHandoff: operationalState.previewReleaseTicket,
    previewHandoff: operationalState.previewHandoff,
    previewExportReadinessHandoff: operationalState.previewExportReadiness,
    previewReadinessManifestHandoff: operationalState.previewReadinessManifest,
    runtimeReleaseControlsHandoff: operationalState.runtimeReleaseControls,
    clientRuntimeAdoptionHandoff: operationalState.clientRuntimeAdoption,
    clientRuntimeSettingsHandoff: operationalState.clientRuntimeSettings,
    settingsRolloutGateHandoff: operationalState.settingsRolloutGate,
    clientStatusHandoff: operationalState.clientStatusHandoff,
    clientCommandLeaseHandoff: operationalState.clientCommandLeases,
    clientCommandLeaseReplayHandoff: operationalState.clientCommandLeaseReplayHandoff,
    statusRuntimeHandoff: operationalState.statusHandoff,
    persistedStatusEnvelopeHandoff: operationalState.persistedStatusEnvelope,
    runtimeStatusReplayCursorHandoff: operationalState.runtimeStatusReplayCursor,
    statusRecoveryHandoff: operationalState.statusRecoveryHandoff,
    restartCheckpointHandoff: operationalState.restartCheckpointHandoff,
    serviceLevelObjectiveHandoff: operationalState.serviceLevelObjectiveHandoff,
    clientRemediationHandoff: operationalState.clientRemediationHandoff,
    operationalHealthReportHandoff: operationalState.operationalHealthReportHandoff,
    operationalIncidentExportHandoff: operationalState.operationalIncidentExportHandoff,
    runtimeExportWatermarkHandoff: operationalState.runtimeExportWatermarkHandoff,
    clientReadinessBriefHandoff: operationalState.clientReadinessBrief,
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
      providerSyncCheckpoint: operationalState.providerSyncCheckpoint,
      providerExportReadiness: operationalState.providerExportReadiness,
      providerCallbackHandoff: operationalState.providerCallbackHandoff,
      providerIntegrationHandoff: operationalState.providerIntegrationHandoff,
      providerIntegrationExecutionTicket: operationalState.providerIntegrationExecutionTicket,
      permissionGrantHandoff: operationalState.permissionGrantHandoff,
      tenantPermissionEnforcement: operationalState.tenantPermissionEnforcement,
      runtimeBoundaryExecutionTicket: operationalState.runtimeBoundaryExecutionTicket,
      clientWorkflow: operationalState.clientWorkflow,
      previewAcceptancePacket: operationalState.previewAcceptancePacket,
      previewReleaseTicket: operationalState.previewReleaseTicket,
      previewHandoff: operationalState.previewHandoff,
      previewExportReadiness: operationalState.previewExportReadiness,
      previewReadinessManifest: operationalState.previewReadinessManifest,
      runtimeReleaseControls: operationalState.runtimeReleaseControls,
      clientRuntimeAdoption: operationalState.clientRuntimeAdoption,
      clientRuntimeSettings: operationalState.clientRuntimeSettings,
      settingsRolloutGate: operationalState.settingsRolloutGate,
      clientStatusHandoff: operationalState.clientStatusHandoff,
      clientCommandLeases: operationalState.clientCommandLeases,
      clientCommandLeaseReplayHandoff: operationalState.clientCommandLeaseReplayHandoff,
      statusHandoff: operationalState.statusHandoff,
      persistedStatusEnvelope: operationalState.persistedStatusEnvelope,
      runtimeStatusReplayCursor: operationalState.runtimeStatusReplayCursor,
      statusRecovery: operationalState.statusRecoveryHandoff,
      restartCheckpoints: operationalState.restartCheckpointHandoff,
      serviceLevelObjectives: operationalState.serviceLevelObjectiveHandoff,
      clientRemediation: operationalState.clientRemediationHandoff,
      operationalHealthReport: operationalState.operationalHealthReportHandoff,
      operationalIncidentExport: operationalState.operationalIncidentExportHandoff,
      runtimeExportWatermark: operationalState.runtimeExportWatermarkHandoff,
      clientReadinessBrief: operationalState.clientReadinessBrief,
      adapterFailureState: operationalState.adapterFailureState,
      previewAcceptance: operationalState.previewAcceptance,
      previewAcceptancePacket: operationalState.previewAcceptancePacket,
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
      persistedStatusEnvelope: operationalState.persistedStatusEnvelope,
      statusRecovery: operationalState.statusRecoveryHandoff,
      restartCheckpoints: operationalState.restartCheckpointHandoff,
      operationalHealthReport: operationalState.operationalHealthReportHandoff,
      operationalIncidentExport: operationalState.operationalIncidentExportHandoff,
      runtimeExportWatermark: operationalState.runtimeExportWatermarkHandoff,
      clientReadinessBrief: operationalState.clientReadinessBrief,
      clientCommandLeaseReplayHandoff: operationalState.clientCommandLeaseReplayHandoff,
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
      previewHandoffIncluded: true,
      previewAcceptancePacketIncluded: true,
      previewReleaseTicketIncluded: true,
      previewExportReadinessIncluded: true,
      previewReadinessManifestIncluded: true,
      runtimeReleaseControlsIncluded: true,
      clientRuntimeAdoptionHandoffIncluded: true,
      clientRuntimeSettingsHandoffIncluded: true,
      settingsRolloutGateHandoffIncluded: true,
      clientStatusHandoffIncluded: true,
      adapterFailureStateIncluded: true,
      previewAcceptanceIncluded: true
      ,
      providerServiceHandoffIncluded: true,
      providerSyncCheckpointIncluded: true,
      providerExportReadinessIncluded: true,
      providerIntegrationHandoffIncluded: true,
      permissionGrantHandoffIncluded: true,
      tenantPermissionEnforcementIncluded: true,
      tenantBoundaryPostureIncluded: true,
      clientCommandLeaseHandoffIncluded: true,
      clientCommandLeaseReplayHandoffIncluded: true,
      statusRuntimeHandoffIncluded: true
      ,
      persistedStatusEnvelopeHandoffIncluded: true
      ,
      statusRecoveryHandoffIncluded: true
      ,
      restartCheckpointHandoffIncluded: true
      ,
      serviceLevelObjectiveHandoffIncluded: true,
      clientRemediationHandoffIncluded: true,
      operationalHealthReportHandoffIncluded: true,
      operationalIncidentExportHandoffIncluded: true,
      clientReadinessBriefHandoffIncluded: true
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
      && contract?.operationalState?.providerSyncCheckpoint?.schemaVersion === "aios.mailchimp.provider-sync-checkpoint-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.providerSyncCheckpoint?.resumeToken)
      && contract?.operationalState?.providerSyncCheckpoint?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.providerExportReadiness?.schemaVersion === "aios.mailchimp.provider-export-readiness-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.providerExportReadiness?.exportKey)
      && Boolean(contract?.operationalState?.providerExportReadiness?.routePayload?.idempotencyKey)
      && contract?.operationalState?.providerExportReadiness?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.providerCallbackHandoff?.schemaVersion === "aios.mailchimp.provider-callback-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.providerCallbackHandoff?.callbackKey)
      && Boolean(contract?.operationalState?.providerCallbackHandoff?.routePayload?.idempotencyKey)
      && contract?.operationalState?.providerCallbackHandoff?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.providerIntegrationHandoff?.schemaVersion === "aios.mailchimp.provider-integration-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.providerIntegrationHandoff?.integrationKey)
      && Array.isArray(contract?.operationalState?.providerIntegrationHandoff?.gates)
      && contract?.operationalState?.providerIntegrationHandoff?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.providerIntegrationExecutionTicket?.schemaVersion === "aios.mailchimp.provider-integration-execution-ticket-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.providerIntegrationExecutionTicket?.ticketKey)
      && Boolean(contract?.operationalState?.providerIntegrationExecutionTicket?.routePayload?.idempotencyKey)
      && Array.isArray(contract?.operationalState?.providerIntegrationExecutionTicket?.gates)
      && contract?.operationalState?.providerIntegrationExecutionTicket?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.permissionGrantHandoff?.schemaVersion === "aios.mailchimp.permission-grant-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.permissionGrantHandoff?.artifactName)
      && contract?.operationalState?.permissionGrantHandoff?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.tenantPermissionEnforcement?.schemaVersion === "aios.mailchimp.tenant-permission-enforcement-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.tenantPermissionEnforcement?.artifactName)
      && Boolean(contract?.operationalState?.tenantPermissionEnforcement?.enforcementKey)
      && contract?.operationalState?.tenantPermissionEnforcement?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.tenantBoundaryPosture?.schemaVersion === "aios.mailchimp.tenant-boundary-posture-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.tenantBoundaryPosture?.artifactName)
      && Boolean(contract?.operationalState?.tenantBoundaryPosture?.postureKey)
      && contract?.operationalState?.tenantBoundaryPosture?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.runtimeBoundaryExecutionTicket?.schemaVersion === "aios.mailchimp.runtime-boundary-execution-ticket-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.runtimeBoundaryExecutionTicket?.artifactName)
      && Array.isArray(contract?.operationalState?.runtimeBoundaryExecutionTicket?.rows)
      && contract?.operationalState?.runtimeBoundaryExecutionTicket?.auditHandoff?.externalWritesPerformed === false
      && contract?.operationalState?.runtimeBoundaryExecutionTicket?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.clientWorkflow?.schemaVersion === "aios.mailchimp.client-workflow-handoff.v1"
      && Boolean(contract?.operationalState?.clientWorkflow?.explainNextStep?.action)
      && contract?.operationalState?.previewHandoff?.schemaVersion === "aios.mailchimp.preview-handoff-contract.v1"
      && Boolean(contract?.operationalState?.previewHandoff?.routePayload?.idempotencyKey)
      && contract?.operationalState?.previewHandoff?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.previewExportReadiness?.schemaVersion === "aios.mailchimp.preview-export-readiness-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.previewExportReadiness?.resumeToken)
      && contract?.operationalState?.previewExportReadiness?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.runtimeReleaseControls?.schemaVersion === "aios.mailchimp.runtime-release-controls-handoff.v1"
      && Boolean(contract?.operationalState?.runtimeReleaseControls?.releaseKey)
      && contract?.operationalState?.runtimeReleaseControls?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.clientRuntimeAdoption?.schemaVersion === "aios.mailchimp.client-runtime-adoption-handoff.v1"
      && Boolean(contract?.operationalState?.clientRuntimeAdoption?.adoptionId)
      && contract?.operationalState?.clientRuntimeSettings?.schemaVersion === "aios.mailchimp.client-runtime-settings-handoff.v1"
      && Boolean(contract?.operationalState?.clientRuntimeSettings?.settingsRevision)
      && contract?.operationalState?.clientRuntimeSettings?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.settingsRolloutGate?.schemaVersion === "aios.mailchimp.settings-rollout-gate-handoff.v1"
      && Boolean(contract?.operationalState?.settingsRolloutGate?.rolloutKey)
      && Array.isArray(contract?.operationalState?.settingsRolloutGate?.checkpoints)
      && contract?.operationalState?.settingsRolloutGate?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.clientStatusHandoff?.schemaVersion === "aios.mailchimp.client-status-handoff-contract.v1"
      && Boolean(contract?.operationalState?.clientStatusHandoff?.statusId)
      && Boolean(contract?.operationalState?.clientStatusHandoff?.route?.idempotencyKey)
      && contract?.operationalState?.clientStatusHandoff?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.clientCommandLeases?.schemaVersion === "aios.mailchimp.client-command-lease-handoff.v1"
      && Boolean(contract?.operationalState?.clientCommandLeases?.resumeToken)
      && contract?.operationalState?.clientCommandLeaseReplayHandoff?.schemaVersion === "aios.mailchimp.client-command-lease-replay-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.clientCommandLeaseReplayHandoff?.routePayload?.idempotencyKey)
      && Boolean(contract?.operationalState?.clientCommandLeaseReplayHandoff?.resumeToken)
      && contract?.operationalState?.clientCommandLeaseReplayHandoff?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.statusHandoff?.schemaVersion === "aios.mailchimp.status-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.statusHandoff?.statusLedger?.resumeToken)
      && contract?.operationalState?.persistedStatusEnvelope?.schemaVersion === "aios.mailchimp.persisted-status-envelope-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.persistedStatusEnvelope?.resumeToken)
      && Boolean(contract?.operationalState?.persistedStatusEnvelope?.statusRevision)
      && Boolean(contract?.operationalState?.persistedStatusEnvelope?.routePayload?.idempotencyKey)
      && Array.isArray(contract?.operationalState?.persistedStatusEnvelope?.rows)
      && contract?.operationalState?.persistedStatusEnvelope?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.runtimeStatusReplayCursor?.schemaVersion === "aios.mailchimp.runtime-status-replay-cursor-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.runtimeStatusReplayCursor?.replayCursor)
      && Boolean(contract?.operationalState?.runtimeStatusReplayCursor?.routePayload?.idempotencyKey)
      && Array.isArray(contract?.operationalState?.runtimeStatusReplayCursor?.rows)
      && contract?.operationalState?.runtimeStatusReplayCursor?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.statusRecoveryHandoff?.schemaVersion === "aios.mailchimp.status-recovery-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.statusRecoveryHandoff?.resume?.resumeToken)
      && contract?.operationalState?.restartCheckpointHandoff?.schemaVersion === "aios.mailchimp.restart-checkpoint-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.restartCheckpointHandoff?.resumeToken)
      && contract?.operationalState?.serviceLevelObjectiveHandoff?.schemaVersion === "aios.mailchimp.service-level-objective-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.serviceLevelObjectiveHandoff?.nextAction)
      && contract?.operationalState?.serviceLevelObjectiveHandoff?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.clientRemediationHandoff?.schemaVersion === "aios.mailchimp.client-remediation-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.clientRemediationHandoff?.route?.idempotencyKey)
      && contract?.operationalState?.clientRemediationHandoff?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.operationalHealthReportHandoff?.schemaVersion === "aios.mailchimp.operational-health-report-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.operationalHealthReportHandoff?.artifactName)
      && Boolean(contract?.operationalState?.operationalHealthReportHandoff?.nextAction)
      && contract?.operationalState?.operationalHealthReportHandoff?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.operationalIncidentExportHandoff?.schemaVersion === "aios.mailchimp.operational-incident-export-runtime-handoff.v1"
      && Boolean(contract?.operationalState?.operationalIncidentExportHandoff?.artifactName)
      && Boolean(contract?.operationalState?.operationalIncidentExportHandoff?.nextAction)
      && contract?.operationalState?.operationalIncidentExportHandoff?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.runtimeExportWatermarkHandoff?.schemaVersion === "aios.mailchimp.runtime-export-watermark-handoff.v1"
      && Boolean(contract?.operationalState?.runtimeExportWatermarkHandoff?.artifactName)
      && Boolean(contract?.operationalState?.runtimeExportWatermarkHandoff?.cursor)
      && Boolean(contract?.operationalState?.runtimeExportWatermarkHandoff?.dedupeKey)
      && contract?.operationalState?.runtimeExportWatermarkHandoff?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.clientReadinessBrief?.schemaVersion === "aios.mailchimp.client-readiness-brief-handoff.v1"
      && Boolean(contract?.operationalState?.clientReadinessBrief?.route?.idempotencyKey)
      && Array.isArray(contract?.operationalState?.clientReadinessBrief?.sections)
      && contract?.operationalState?.clientReadinessBrief?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.lifecycleControlHandoff?.schemaVersion === "aios.mailchimp.lifecycle-controls-handoff.v1"
      && Boolean(contract?.operationalState?.previewAcceptance?.acceptanceToken)
      && contract?.operationalState?.previewAcceptancePacket?.schemaVersion === "aios.mailchimp.preview-acceptance-packet-handoff.v1"
      && Boolean(contract?.operationalState?.previewAcceptancePacket?.acceptanceToken)
      && Boolean(contract?.operationalState?.previewAcceptancePacket?.routePayload?.idempotencyKey)
      && contract?.operationalState?.previewAcceptancePacket?.restartSemantics?.externalWritesPerformed === false
      && contract?.operationalState?.previewReleaseTicket?.schemaVersion === "aios.mailchimp.preview-release-ticket-handoff.v1"
      && Boolean(contract?.operationalState?.previewReleaseTicket?.ticketKey)
      && Boolean(contract?.operationalState?.previewReleaseTicket?.routePayload?.idempotencyKey)
      && Array.isArray(contract?.operationalState?.previewReleaseTicket?.rows)
      && contract?.operationalState?.previewReleaseTicket?.restartSemantics?.externalWritesPerformed === false
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
    providerSyncCheckpointStatus: contract?.operationalState?.providerSyncCheckpoint?.status || "unknown",
    providerSyncCheckpointReady: contract?.operationalState?.providerSyncCheckpoint?.readyForRuntime === true,
    providerSyncCheckpointNextAction: contract?.operationalState?.providerSyncCheckpoint?.nextAction || null,
    providerSyncCheckpointMissingAckMounts: contract?.operationalState?.providerSyncCheckpoint?.blocking?.missingAckMounts || [],
    providerSyncCheckpointMissingWatermarkMounts: contract?.operationalState?.providerSyncCheckpoint?.blocking?.missingWatermarkMounts || [],
    providerExportReadinessStatus: contract?.operationalState?.providerExportReadiness?.status || "unknown",
    providerExportReadinessReady: contract?.operationalState?.providerExportReadiness?.readyForRuntime === true,
    providerExportReadinessExportReady: contract?.operationalState?.providerExportReadiness?.exportReady === true,
    providerExportReadinessNextAction: contract?.operationalState?.providerExportReadiness?.nextAction || null,
    providerExportReadinessResumeToken: contract?.operationalState?.providerExportReadiness?.resumeToken || null,
    providerExportReadinessBlockedRows: contract?.operationalState?.providerExportReadiness?.validationSummary?.blockedRowIds || [],
    providerExportReadinessWaitingRows: contract?.operationalState?.providerExportReadiness?.validationSummary?.waitingRowIds || [],
    providerCallbackHandoffStatus: contract?.operationalState?.providerCallbackHandoff?.status || "unknown",
    providerCallbackHandoffReady: contract?.operationalState?.providerCallbackHandoff?.readyForRuntime === true,
    providerCallbackHandoffNextAction: contract?.operationalState?.providerCallbackHandoff?.nextAction || null,
    providerCallbackHandoffResumeToken: contract?.operationalState?.providerCallbackHandoff?.resumeToken || null,
    providerCallbackMissingEvents: contract?.operationalState?.providerCallbackHandoff?.events?.missing || [],
    providerIntegrationHandoffStatus: contract?.operationalState?.providerIntegrationHandoff?.status || "unknown",
    providerIntegrationHandoffReady: contract?.operationalState?.providerIntegrationHandoff?.readyForRuntime === true,
    providerIntegrationHandoffNextAction: contract?.operationalState?.providerIntegrationHandoff?.nextAction || null,
    providerIntegrationHandoffNextGateId: contract?.operationalState?.providerIntegrationHandoff?.nextGateId || null,
    providerIntegrationBlockedGateIds: contract?.operationalState?.providerIntegrationHandoff?.validationSummary?.blockedGateIds || [],
    providerIntegrationWaitingGateIds: contract?.operationalState?.providerIntegrationHandoff?.validationSummary?.waitingGateIds || [],
    providerIntegrationExecutionTicketStatus: contract?.operationalState?.providerIntegrationExecutionTicket?.status || "unknown",
    providerIntegrationExecutionTicketReady: contract?.operationalState?.providerIntegrationExecutionTicket?.readyForRuntimeRelease === true,
    providerIntegrationExecutionTicketNextAction: contract?.operationalState?.providerIntegrationExecutionTicket?.nextAction || null,
    providerIntegrationExecutionTicketResumeCursor: contract?.operationalState?.providerIntegrationExecutionTicket?.resumeCursor || null,
    providerIntegrationExecutionTicketBlockedGateIds: contract?.operationalState?.providerIntegrationExecutionTicket?.validationSummary?.blockedGateIds || [],
    providerIntegrationExecutionTicketWaitingGateIds: contract?.operationalState?.providerIntegrationExecutionTicket?.validationSummary?.waitingGateIds || [],
    previewReleaseTicketStatus: contract?.operationalState?.previewReleaseTicket?.status || "unknown",
    previewReleaseTicketReady: contract?.operationalState?.previewReleaseTicket?.readyForRuntimeRelease === true,
    previewReleaseTicketNextAction: contract?.operationalState?.previewReleaseTicket?.nextAction || null,
    previewReleaseTicketKey: contract?.operationalState?.previewReleaseTicket?.ticketKey || null,
    previewReleaseTicketBlockedRows: contract?.operationalState?.previewReleaseTicket?.validationSummary?.blockedRowIds || [],
    previewReleaseTicketWaitingRows: contract?.operationalState?.previewReleaseTicket?.validationSummary?.waitingRowIds || [],
    permissionGrantStatus: contract?.operationalState?.permissionGrantHandoff?.status || "unknown",
    permissionGrantReadyForAudit: contract?.operationalState?.permissionGrantHandoff?.readyForAudit === true,
    permissionGrantNextAction: contract?.operationalState?.permissionGrantHandoff?.nextAction || null,
    permissionGrantBlockingCommandIds: contract?.operationalState?.permissionGrantHandoff?.blockingCommandIds || [],
    tenantPermissionEnforcementStatus: contract?.operationalState?.tenantPermissionEnforcement?.status || "unknown",
    tenantPermissionEnforcementReady: contract?.operationalState?.tenantPermissionEnforcement?.readyForRuntime === true,
    tenantPermissionEnforcementKey: contract?.operationalState?.tenantPermissionEnforcement?.enforcementKey || null,
    tenantPermissionAuditReady: contract?.operationalState?.tenantPermissionEnforcement?.audit?.ready === true,
    tenantPermissionBlockedDecisionIds: contract?.operationalState?.tenantPermissionEnforcement?.blockedDecisionIds || [],
    tenantBoundaryPostureStatus: contract?.operationalState?.tenantBoundaryPosture?.status || "unknown",
    tenantBoundaryPostureReady: contract?.operationalState?.tenantBoundaryPosture?.readyForRuntime === true,
    tenantBoundaryPostureKey: contract?.operationalState?.tenantBoundaryPosture?.postureKey || null,
    tenantBoundarySafeForAuditAppend: contract?.operationalState?.tenantBoundaryPosture?.safeForAuditAppend === true,
    tenantBoundaryPostureNextAction: contract?.operationalState?.tenantBoundaryPosture?.nextAction || null,
    tenantBoundaryBlockedDecisionIds: contract?.operationalState?.tenantBoundaryPosture?.blocking?.blockedDecisionIds || [],
    runtimeBoundaryExecutionTicketStatus: contract?.operationalState?.runtimeBoundaryExecutionTicket?.status || "unknown",
    runtimeBoundaryExecutionTicketReady: contract?.operationalState?.runtimeBoundaryExecutionTicket?.readyForRuntimeRelease === true,
    runtimeBoundaryExecutionTicketKey: contract?.operationalState?.runtimeBoundaryExecutionTicket?.ticketKey || null,
    runtimeBoundaryExecutionTicketNextAction: contract?.operationalState?.runtimeBoundaryExecutionTicket?.nextAction || null,
    runtimeBoundaryExecutionTicketBlockedJobs: contract?.operationalState?.runtimeBoundaryExecutionTicket?.validationSummary?.blockedJobIds || [],
    runtimeBoundaryExecutionTicketWaitingJobs: contract?.operationalState?.runtimeBoundaryExecutionTicket?.validationSummary?.waitingJobIds || [],
    runtimeBoundaryExecutionTicketAuditReady: contract?.operationalState?.runtimeBoundaryExecutionTicket?.auditHandoff?.ready === true,
    clientWorkflowStatus: contract?.operationalState?.clientWorkflow?.status || "unknown",
    clientWorkflowReady: contract?.operationalState?.clientWorkflow?.readyForClient === true,
    previewHandoffStatus: contract?.operationalState?.previewHandoff?.status || "unknown",
    previewHandoffReady: contract?.operationalState?.previewHandoff?.readyForClient === true,
    previewHandoffReadyForRuntimeStart: contract?.operationalState?.previewHandoff?.readyForRuntimeStart === true,
    previewHandoffRouteId: contract?.operationalState?.previewHandoff?.routeId || null,
    previewHandoffNextAction: contract?.operationalState?.previewHandoff?.nextAction || null,
    previewExportReadinessStatus: contract?.operationalState?.previewExportReadiness?.status || "unknown",
    previewExportReady: contract?.operationalState?.previewExportReadiness?.exportReady === true,
    previewExportRuntimeStartReady: contract?.operationalState?.previewExportReadiness?.readyForRuntimeStart === true,
    previewExportNextAction: contract?.operationalState?.previewExportReadiness?.nextAction || null,
    previewExportBlockedRows: contract?.operationalState?.previewExportReadiness?.blocking?.blockedRowIds || [],
    previewReadinessManifestStatus: contract?.operationalState?.previewReadinessManifest?.status || "unknown",
    previewReadinessManifestVisibleStatus: contract?.operationalState?.previewReadinessManifest?.visibleStatus || "unknown",
    previewReadinessManifestReadyForPreview: contract?.operationalState?.previewReadinessManifest?.readyForClientPreview === true,
    previewReadinessManifestReadyForRuntime: contract?.operationalState?.previewReadinessManifest?.readyForRuntimeStart === true,
    previewReadinessManifestRouteId: contract?.operationalState?.previewReadinessManifest?.route?.routeId || null,
    previewReadinessManifestNextAction: contract?.operationalState?.previewReadinessManifest?.nextAction || null,
    previewReadinessManifestNextSectionId: contract?.operationalState?.previewReadinessManifest?.nextSectionId || null,
    previewReadinessManifestBlockedSections: contract?.operationalState?.previewReadinessManifest?.validationSummary?.blockedSectionIds || [],
    previewReadinessManifestPendingSections: contract?.operationalState?.previewReadinessManifest?.validationSummary?.pendingSectionIds || [],
    runtimeReleaseControlsStatus: contract?.operationalState?.runtimeReleaseControls?.status || "unknown",
    runtimeReleaseControlsReady: contract?.operationalState?.runtimeReleaseControls?.readyForRuntimeStart === true,
    runtimeReleaseControlsNextAction: contract?.operationalState?.runtimeReleaseControls?.nextAction || null,
    runtimeReleaseControlsNextGateId: contract?.operationalState?.runtimeReleaseControls?.nextGateId || null,
    runtimeReleaseControlsBlockedGateIds: contract?.operationalState?.runtimeReleaseControls?.blocking?.blockedGateIds || [],
    runtimeReleaseControlsWaitingGateIds: contract?.operationalState?.runtimeReleaseControls?.blocking?.waitingGateIds || [],
    clientRuntimeAdoptionStatus: contract?.operationalState?.clientRuntimeAdoption?.status || "unknown",
    clientRuntimeReady: contract?.operationalState?.clientRuntimeAdoption?.readyForClientRuntime === true,
    clientRuntimeAdoptionNextAction: contract?.operationalState?.clientRuntimeAdoption?.nextAction || null,
    clientRuntimeSettingsStatus: contract?.operationalState?.clientRuntimeSettings?.status || "unknown",
    clientRuntimeSettingsReady: contract?.operationalState?.clientRuntimeSettings?.readyForClientRuntime === true,
    clientRuntimeSettingsRevision: contract?.operationalState?.clientRuntimeSettings?.settingsRevision || null,
    clientRuntimeSettingsNextAction: contract?.operationalState?.clientRuntimeSettings?.nextAction || null,
    settingsRolloutGateStatus: contract?.operationalState?.settingsRolloutGate?.status || "unknown",
    settingsRolloutGateReady: contract?.operationalState?.settingsRolloutGate?.readyForRuntimeStart === true,
    settingsRolloutGateNextAction: contract?.operationalState?.settingsRolloutGate?.nextAction || null,
    settingsRolloutGateNextGateId: contract?.operationalState?.settingsRolloutGate?.nextGateId || null,
    settingsRolloutGateBlockedGateIds: contract?.operationalState?.settingsRolloutGate?.blocking?.blockedGateIds || [],
    clientStatusHandoffStatus: contract?.operationalState?.clientStatusHandoff?.status || "unknown",
    clientStatusHandoffVisibleStatus: contract?.operationalState?.clientStatusHandoff?.visibleStatus || "unknown",
    clientStatusHandoffReady: contract?.operationalState?.clientStatusHandoff?.readyForClient === true,
    clientStatusHandoffRuntimeReady: contract?.operationalState?.clientStatusHandoff?.readyForRuntime === true,
    clientStatusHandoffRouteId: contract?.operationalState?.clientStatusHandoff?.route?.routeId || null,
    clientStatusHandoffNextAction: contract?.operationalState?.clientStatusHandoff?.nextAction || null,
    clientCommandLeaseStatus: contract?.operationalState?.clientCommandLeases?.status || "unknown",
    clientCommandLeaseReady: contract?.operationalState?.clientCommandLeases?.readyForClient === true,
    clientCommandAckRequired: contract?.operationalState?.clientCommandLeases?.ack?.required === true,
    clientCommandLeaseReplayHandoffStatus: contract?.operationalState?.clientCommandLeaseReplayHandoff?.status || "unknown",
    clientCommandLeaseReplayHandoffReady: contract?.operationalState?.clientCommandLeaseReplayHandoff?.readyForRuntime === true,
    clientCommandLeaseReplayHandoffRouteId: contract?.operationalState?.clientCommandLeaseReplayHandoff?.routeId || null,
    clientCommandLeaseReplayHandoffNextAction: contract?.operationalState?.clientCommandLeaseReplayHandoff?.nextAction || null,
    clientCommandLeaseReplayHandoffAckRequired: contract?.operationalState?.clientCommandLeaseReplayHandoff?.ack?.required === true,
    clientCommandLeaseReplayBlockedLeaseIds: contract?.operationalState?.clientCommandLeaseReplayHandoff?.validationSummary?.blockedLeaseIds || [],
    statusHandoffStatus: contract?.operationalState?.statusHandoff?.status || "unknown",
    statusHandoffReady: contract?.operationalState?.statusHandoff?.readyForClient === true,
    statusHandoffRuntimeReady: contract?.operationalState?.statusHandoff?.readyForRuntime === true,
    statusHandoffVisibleStatus: contract?.operationalState?.statusHandoff?.visibleStatus || "unknown",
    persistedStatusEnvelopeStatus: contract?.operationalState?.persistedStatusEnvelope?.status || "unknown",
    persistedStatusEnvelopeReady: contract?.operationalState?.persistedStatusEnvelope?.readyForRuntimeResume === true,
    persistedStatusEnvelopeNextAction: contract?.operationalState?.persistedStatusEnvelope?.nextAction || null,
    persistedStatusEnvelopeBlockedCommands: contract?.operationalState?.persistedStatusEnvelope?.blocking?.commandIds || [],
    persistedStatusEnvelopeUnsafeCommands: contract?.operationalState?.persistedStatusEnvelope?.blocking?.unsafeCommandIds || [],
    runtimeStatusReplayCursorStatus: contract?.operationalState?.runtimeStatusReplayCursor?.status || "unknown",
    runtimeStatusReplayCursorReady: contract?.operationalState?.runtimeStatusReplayCursor?.readyForRestart === true,
    runtimeStatusReplayCursorRuntimeReady: contract?.operationalState?.runtimeStatusReplayCursor?.readyForRuntimeRelease === true,
    runtimeStatusReplayCursorNextAction: contract?.operationalState?.runtimeStatusReplayCursor?.nextAction || null,
    runtimeStatusReplayCursorResumeToken: contract?.operationalState?.runtimeStatusReplayCursor?.resumeToken || null,
    runtimeStatusReplayCursorBlockedJobs: contract?.operationalState?.runtimeStatusReplayCursor?.blocking?.blockedJobIds || [],
    runtimeStatusReplayCursorWaitingJobs: contract?.operationalState?.runtimeStatusReplayCursor?.blocking?.waitingJobIds || [],
    runtimeStatusReplayCursorUnsafeJobs: contract?.operationalState?.runtimeStatusReplayCursor?.blocking?.unsafeJobIds || [],
    statusRecoveryState: contract?.operationalState?.statusRecoveryHandoff?.status || "unknown",
    statusRecoveryReady: contract?.operationalState?.statusRecoveryHandoff?.readyForRuntimeResume === true,
    statusRecoveryNextAction: contract?.operationalState?.statusRecoveryHandoff?.nextAction || null,
    restartCheckpointStatus: contract?.operationalState?.restartCheckpointHandoff?.status || "unknown",
    restartCheckpointReady: contract?.operationalState?.restartCheckpointHandoff?.readyForColdRestart === true,
    restartCheckpointNextAction: contract?.operationalState?.restartCheckpointHandoff?.nextAction || null,
    serviceLevelObjectiveStatus: contract?.operationalState?.serviceLevelObjectiveHandoff?.status || "unknown",
    serviceLevelObjectiveHealth: contract?.operationalState?.serviceLevelObjectiveHandoff?.healthLevel || "unknown",
    serviceLevelObjectiveReadyForRuntimeRelease: contract?.operationalState?.serviceLevelObjectiveHandoff?.readyForRuntimeRelease === true,
    serviceLevelObjectiveNextAction: contract?.operationalState?.serviceLevelObjectiveHandoff?.nextAction || null,
    serviceLevelObjectiveBlockingBreaches: contract?.operationalState?.serviceLevelObjectiveHandoff?.blockingBreachIds || [],
    clientRemediationStatus: contract?.operationalState?.clientRemediationHandoff?.status || "unknown",
    clientRemediationReadyForClient: contract?.operationalState?.clientRemediationHandoff?.readyForClient === true,
    clientRemediationReadyForRuntime: contract?.operationalState?.clientRemediationHandoff?.readyForRuntime === true,
    clientRemediationRouteId: contract?.operationalState?.clientRemediationHandoff?.route?.routeId || null,
    clientRemediationNextAction: contract?.operationalState?.clientRemediationHandoff?.nextAction || null,
    clientRemediationBlocking: contract?.operationalState?.clientRemediationHandoff?.counters?.blocking || 0,
    operationalHealthReportStatus: contract?.operationalState?.operationalHealthReportHandoff?.status || "unknown",
    operationalHealthReportLevel: contract?.operationalState?.operationalHealthReportHandoff?.healthLevel || "unknown",
    operationalHealthReportReady: contract?.operationalState?.operationalHealthReportHandoff?.readyForRuntime === true,
    operationalHealthReportExportReady: contract?.operationalState?.operationalHealthReportHandoff?.exportReady === true,
    operationalHealthReportNextAction: contract?.operationalState?.operationalHealthReportHandoff?.nextAction || null,
    operationalHealthReportBlocking: contract?.operationalState?.operationalHealthReportHandoff?.counters?.blocking || 0,
    operationalHealthReportRetryable: contract?.operationalState?.operationalHealthReportHandoff?.counters?.retryable || 0,
    operationalHealthReportResumeToken: contract?.operationalState?.operationalHealthReportHandoff?.resumeToken || null,
    operationalIncidentExportStatus: contract?.operationalState?.operationalIncidentExportHandoff?.status || "unknown",
    operationalIncidentExportReady: contract?.operationalState?.operationalIncidentExportHandoff?.readyForRuntime === true,
    operationalIncidentExportReadyForExport: contract?.operationalState?.operationalIncidentExportHandoff?.exportReady === true,
    operationalIncidentExportNextAction: contract?.operationalState?.operationalIncidentExportHandoff?.nextAction || null,
    operationalIncidentExportRows: contract?.operationalState?.operationalIncidentExportHandoff?.counters?.rows || 0,
    operationalIncidentExportBlocking: contract?.operationalState?.operationalIncidentExportHandoff?.counters?.blocking || 0,
    operationalIncidentExportRetryable: contract?.operationalState?.operationalIncidentExportHandoff?.counters?.retryable || 0,
    operationalIncidentExportResumeToken: contract?.operationalState?.operationalIncidentExportHandoff?.resumeToken || null,
    runtimeExportWatermarkStatus: contract?.operationalState?.runtimeExportWatermarkHandoff?.status || "unknown",
    runtimeExportWatermarkReady: contract?.operationalState?.runtimeExportWatermarkHandoff?.readyForRuntime === true,
    runtimeExportWatermarkReadyForExport: contract?.operationalState?.runtimeExportWatermarkHandoff?.exportReady === true,
    runtimeExportWatermarkNextAction: contract?.operationalState?.runtimeExportWatermarkHandoff?.nextAction || null,
    runtimeExportWatermarkCursor: contract?.operationalState?.runtimeExportWatermarkHandoff?.cursor || null,
    runtimeExportWatermarkDedupeKey: contract?.operationalState?.runtimeExportWatermarkHandoff?.dedupeKey || null,
    runtimeExportWatermarkBlockedPartitions: contract?.operationalState?.runtimeExportWatermarkHandoff?.blocking?.partitionNames || [],
    runtimeExportWatermarkBlockedJobs: contract?.operationalState?.runtimeExportWatermarkHandoff?.blocking?.blockedJobIds || [],
    runtimeExportWatermarkWaitingJobs: contract?.operationalState?.runtimeExportWatermarkHandoff?.blocking?.waitingJobIds || [],
    clientReadinessBriefStatus: contract?.operationalState?.clientReadinessBrief?.status || "unknown",
    clientReadinessBriefVisibleStatus: contract?.operationalState?.clientReadinessBrief?.visibleStatus || "unknown",
    clientReadinessBriefReadyForPreview: contract?.operationalState?.clientReadinessBrief?.readyForClientPreview === true,
    clientReadinessBriefReadyForRuntime: contract?.operationalState?.clientReadinessBrief?.readyForRuntimeStart === true,
    clientReadinessBriefRouteId: contract?.operationalState?.clientReadinessBrief?.route?.routeId || null,
    clientReadinessBriefNextAction: contract?.operationalState?.clientReadinessBrief?.nextAction || null,
    clientReadinessBriefBlockingSections: contract?.operationalState?.clientReadinessBrief?.validationSummary?.blockingSectionIds || [],
    clientReadinessBriefPendingSections: contract?.operationalState?.clientReadinessBrief?.validationSummary?.pendingSectionIds || [],
    retryEnabled: contract?.operationalState?.lifecycleControls?.retryEnabled === true,
    previewAcceptanceStatus: contract?.operationalState?.previewAcceptance?.status || "unknown",
    previewAcceptanceToken: contract?.operationalState?.previewAcceptance?.acceptanceToken || null,
    previewAcceptancePacketStatus: contract?.operationalState?.previewAcceptancePacket?.status || "unknown",
    previewAcceptancePacketReady: contract?.operationalState?.previewAcceptancePacket?.readyForClient === true,
    previewAcceptancePacketRuntimeReady: contract?.operationalState?.previewAcceptancePacket?.readyForRuntimeStart === true,
    previewAcceptancePacketNextAction: contract?.operationalState?.previewAcceptancePacket?.nextAction || null,
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
