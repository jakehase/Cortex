import { compileMailchimpJobDescriptor } from "./job-descriptor-compiler.mjs";
import { emitMailchimpDiagnostics } from "./diagnostic-emitter.mjs";

function compileIfNeeded(source, options) {
  if (source?.kind === "aios.kernelJobDescriptor") return source;
  return compileMailchimpJobDescriptor(source, options);
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function summarizeCapabilities(job) {
  const capabilities = job.contracts?.capabilities?.capabilities || [];
  const service = job.contracts?.capabilities?.providerServiceContract || {};
  return {
    count: capabilities.length,
    actions: capabilities.map((capability) => capability.action).sort(),
    writeActions: capabilities
      .filter((capability) => capability.providerOperation?.externalWrite)
      .map((capability) => capability.action)
      .sort(),
    disabledActions: service.runtimeControls?.disabledActions || [],
    approvalActions: service.runtimeControls?.approvalActions || [],
    requiredScopes: service.syncMetadata?.serviceScopes || [],
    highestRisk: job.truthBoundary?.capabilityRisk?.highestRisk || "low",
    requiresApproval: service.requiresApproval === true
  };
}

function summarizeMemory(job) {
  const memory = job.contracts?.memory || {};
  const mounts = memory.mounts || [];
  return {
    count: mounts.length,
    mounts: mounts.map((mount) => ({
      name: mount.name,
      mode: mount.mode,
      path: mount.path,
      syncDirection: mount.providerContract?.syncDirection || "local-only",
      externalHandoff: mount.providerContract?.externalHandoff || "not-required"
    })),
    syncRequired: memory.providerServiceContract?.syncRequired === true,
    providerSyncMounts: mounts
      .filter((mount) => mount.providerContract?.syncDirection !== "local-only")
      .map((mount) => mount.name)
      .sort(),
    requiredCapabilities: uniqueSorted(memory.providerServiceContract?.capabilityNegotiation || [])
  };
}

function summarizeVerifier(job) {
  const verifier = job.contracts?.verifier || {};
  const rules = verifier.rules || [];
  return {
    count: rules.length,
    blockingRuleIds: rules
      .filter((rule) => rule.severity === "error")
      .map((rule) => rule.id)
      .sort(),
    warningRuleIds: rules
      .filter((rule) => rule.severity === "warning")
      .map((rule) => rule.id)
      .sort(),
    requiredClientState: verifier.runtimeHandoff?.requiredClientState || [],
    requiresApprovalToken: verifier.truthBoundary?.requireApprovalToken !== false,
    previewTitle: verifier.preview?.title || "Mailchimp campaign readiness"
  };
}

function summarizeRuntime(job, diagnosticEmission) {
  const handoff = job.contracts?.runtimeHandoffPlan || {};
  const lifecycleControls = diagnosticEmission.lifecycleControls || {};
  return {
    adapter: job.runtimeAdapter?.id || handoff.runtimeAdapter || "mailchimp.campaignRuntimeAdapter",
    readinessStatus: handoff.readinessStatus || job.status,
    acceptedForRuntime: handoff.acceptedForRuntime === true,
    acceptedForClientPreview: handoff.acceptedForClientPreview !== false,
    nextAction: diagnosticEmission.recovery.nextAction,
    statusControls: {
      canStartRuntime: handoff.controls?.canStartRuntime === true,
      canPreview: handoff.controls?.canPreview !== false,
      canEnableDisabledCapabilities: handoff.controls?.canEnableDisabledCapabilities === true,
      requiresApprovalBeforeExternalWrite: handoff.controls?.requiresApprovalBeforeExternalWrite === true,
      lifecycleStatus: lifecycleControls.status || "unknown",
      runtimeStartEnabled: lifecycleControls.runtimeStart?.enabled === true,
      runtimeStartDisableReason: lifecycleControls.runtimeStart?.disableReason || null,
      schedulePaused: lifecycleControls.schedule?.paused === true,
      scheduleWindow: lifecycleControls.schedule?.requestedWindow || handoff.scheduleWindow || "runtime",
      nextLifecycleAction: lifecycleControls.nextAction || diagnosticEmission.recovery?.nextAction
    },
    providerService: handoff.serviceHandoff?.providerService || "mailchimp-marketing-api",
    requiredMemory: handoff.serviceHandoff?.requiredMemory || []
  };
}

function summarizeProviderService(job, diagnosticEmission) {
  const providerContract = diagnosticEmission.providerServiceContract || {};
  const continuitySource = providerContract.serviceContinuity
    || job.providerContinuity
    || job.adapterDispatchReadiness?.providerContinuity
    || {};
  const syncMetadata = providerContract.syncMetadata || {};
  const capabilityNegotiation = providerContract.capabilityNegotiation || {};
  const externalHandoff = providerContract.externalHandoff || {};
  const diagnosticIds = providerContract.diagnosticIds || [];
  const providerSyncMounts = Array.isArray(syncMetadata.providerSyncMounts)
    ? syncMetadata.providerSyncMounts
    : [];
  const unnegotiated = Array.isArray(capabilityNegotiation.unnegotiated)
    ? capabilityNegotiation.unnegotiated
    : [];

  return {
    schemaVersion: "aios.mailchimp.provider-service-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    providerService: providerContract.providerService || "mailchimp-marketing-api",
    status: providerContract.status || "unknown",
    supported: providerContract.serviceSupported === true,
    diagnosticIds,
    syncMetadata: {
      syncRequired: syncMetadata.syncRequired === true,
      serviceScopes: uniqueSorted(syncMetadata.serviceScopes || []),
      declaredScopes: uniqueSorted(syncMetadata.declaredScopes || []),
      defaultScopesApplied: syncMetadata.defaultScopesApplied === true,
      providerSyncMounts,
      syncHandoffReady: syncMetadata.syncHandoffReady === true
    },
    capabilityNegotiation: {
      required: uniqueSorted(capabilityNegotiation.required || []),
      negotiated: uniqueSorted(capabilityNegotiation.negotiated || []),
      unnegotiated,
      writeActions: uniqueSorted(capabilityNegotiation.writeActions || []),
      approvalActions: uniqueSorted(capabilityNegotiation.approvalActions || []),
      complete: unnegotiated.length === 0
    },
    externalHandoff: {
      target: externalHandoff.target || providerContract.providerService || "mailchimp-marketing-api",
      required: externalHandoff.required === true,
      ready: externalHandoff.ready === true,
      idempotencyKey: externalHandoff.idempotencyKey || `${job.id}:mailchimp-provider-service`
    },
    serviceContinuity: {
      schemaVersion: "aios.mailchimp.provider-continuity-summary.v1",
      continuityKey: continuitySource.continuityKey || `${job.id}:provider-continuity`,
      mode: continuitySource.mode || (providerContract.status === "blocked" ? "blocked" : "unknown"),
      healthy: continuitySource.healthy === true,
      degraded: continuitySource.degraded === true || providerContract.status === "needs-operator-action",
      holdExternalWrite: continuitySource.holdExternalWrite === true,
      queueOnly: continuitySource.queueOnly === true,
      retryable: continuitySource.retry?.retryable === true,
      retryAfterMs: continuitySource.retry?.retryAfterMs || 0,
      nextAction: continuitySource.nextAction || providerContract.nextAction || "handoff-to-runtime-adapter",
      degradedReasons: uniqueSorted(continuitySource.degradedReasons || []),
      restartSemantics: continuitySource.restartSemantics || {
        replaySafe: continuitySource.holdExternalWrite !== true,
        duplicateCommandPolicy: "dedupe-by-provider-continuity-key",
        resumeFromContinuityKey: continuitySource.continuityKey || `${job.id}:provider-continuity`,
        externalWritesPerformed: false
      }
    },
    clientState: {
      providerServiceReady: externalHandoff.ready === true,
      providerSyncReady: syncMetadata.syncHandoffReady === true,
      capabilityNegotiationReady: unnegotiated.length === 0,
      providerContinuityMode: continuitySource.mode || "unknown",
      providerContinuityNextAction: continuitySource.nextAction || null,
      nextAction: continuitySource.holdExternalWrite === true
        ? continuitySource.nextAction || "hold-for-provider-recovery"
        : providerContract.nextAction || "handoff-to-runtime-adapter",
      badge: providerContract.status === "ready"
        ? "provider-ready"
        : providerContract.status === "blocked"
          ? "provider-blocked"
          : "provider-action-needed"
    }
  };
}

function summarizeProviderSyncCheckpoint(job, diagnosticEmission, providerServiceSummary) {
  const checkpoint = diagnosticEmission.providerSyncCheckpoint || {};
  const rows = Array.isArray(checkpoint.checkpointRows) ? checkpoint.checkpointRows : [];
  const readyRows = rows.filter((row) => row.ready === true);
  const missingAckMounts = uniqueSorted(checkpoint.missingAckMounts || []);
  const missingWatermarkMounts = uniqueSorted(checkpoint.missingWatermarkMounts || []);
  const missingHandoffMounts = uniqueSorted(checkpoint.missingHandoffMounts || []);
  const status = checkpoint.status
    || (missingHandoffMounts.length > 0
      ? "blocked"
      : missingAckMounts.length > 0 || missingWatermarkMounts.length > 0
        ? "needs-operator-action"
        : "ready");
  const nextAction = checkpoint.nextAction
    || (missingHandoffMounts.length > 0
      ? "declare-provider-sync-handoff"
      : missingAckMounts.length > 0
        ? "acknowledge-mailchimp-provider-sync"
        : missingWatermarkMounts.length > 0
          ? "restore-mailchimp-sync-watermark"
          : providerServiceSummary.clientState?.nextAction || "handoff-to-runtime-adapter");

  return {
    schemaVersion: "aios.mailchimp.provider-sync-checkpoint-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    providerService: checkpoint.providerService || providerServiceSummary.providerService,
    status,
    ready: checkpoint.ready === true || (status === "ready" && rows.every((row) => row.ready === true)),
    syncRequired: checkpoint.syncRequired === true || providerServiceSummary.syncMetadata?.syncRequired === true,
    nextAction,
    resumeToken: checkpoint.resumeToken || `${job.id}:provider-sync:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    idempotencyKey: checkpoint.idempotencyKey
      || `${providerServiceSummary.externalHandoff?.idempotencyKey || job.id}:sync-checkpoint`,
    rows: rows.map((row) => ({
      name: row.name,
      syncDirection: row.syncDirection,
      capability: row.capability || null,
      externalHandoff: row.externalHandoff || "not-required",
      ackKey: row.ackKey || null,
      acknowledged: row.acknowledged === true,
      watermark: row.watermark || null,
      ready: row.ready === true,
      nextAction: row.nextAction || nextAction
    })),
    counters: {
      total: rows.length,
      ready: readyRows.length,
      missingAck: missingAckMounts.length,
      missingWatermark: missingWatermarkMounts.length,
      missingHandoff: missingHandoffMounts.length
    },
    missingAckMounts,
    missingWatermarkMounts,
    missingHandoffMounts,
    diagnosticIds: checkpoint.diagnosticIds || [],
    clientPatch: {
      ...(checkpoint.clientPatch || {}),
      providerSyncCheckpointStatus: status,
      providerSyncCheckpointReady: checkpoint.ready === true,
      providerSyncCheckpointNextAction: nextAction
    },
    restartSemantics: checkpoint.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-provider-sync-ack-key",
      resumeFromAckKey: rows.find((row) => row.ready !== true)?.ackKey || null,
      externalWritesPerformed: false
    }
  };
}

function summarizeRuntimeReleaseControls(job, diagnosticEmission, runtimeSummary, providerServiceSummary, providerSyncCheckpoint) {
  const source = diagnosticEmission.runtimeReleaseControls || {};
  const gates = Array.isArray(source.gates) ? source.gates : [];
  const blocked = gates.filter((gate) => gate.state === "blocked");
  const waiting = gates.filter((gate) => gate.state === "waiting" || gate.state === "held");
  const ready = source.readyForRuntimeStart === true
    && blocked.length === 0
    && waiting.length === 0
    && runtimeSummary.acceptedForRuntime === true;
  const status = source.status
    || (blocked.length > 0
      ? "blocked"
      : waiting.length > 0 || ready === false
        ? "needs-operator-action"
        : "ready");
  const nextGate = gates.find((gate) => gate.gateId === source.nextGateId)
    || blocked[0]
    || waiting[0]
    || null;
  const nextAction = ready
    ? "handoff-to-runtime-adapter"
    : source.nextAction
      || nextGate?.nextAction
      || diagnosticEmission.recovery?.nextAction
      || "review-runtime-release-controls";

  return {
    schemaVersion: "aios.mailchimp.runtime-release-controls-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    readyForRuntimeStart: ready,
    acceptedForRuntime: runtimeSummary.acceptedForRuntime === true,
    releaseKey: source.releaseKey || `${job.id}:release-controls:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    nextAction,
    nextGateId: source.nextGateId || nextGate?.gateId || null,
    providerState: {
      service: providerServiceSummary.providerService,
      status: providerServiceSummary.status,
      serviceHandoffReady: providerServiceSummary.externalHandoff?.ready === true,
      syncCheckpointReady: providerSyncCheckpoint.ready === true,
      syncCheckpointStatus: providerSyncCheckpoint.status
    },
    lifecycle: {
      status: runtimeSummary.statusControls.lifecycleStatus,
      runtimeStartEnabled: runtimeSummary.statusControls.runtimeStartEnabled === true,
      schedulePaused: runtimeSummary.statusControls.schedulePaused === true,
      scheduleWindow: runtimeSummary.statusControls.scheduleWindow,
      nextAction: runtimeSummary.statusControls.nextLifecycleAction
    },
    gates: gates.map((gate) => ({
      id: gate.id,
      gateId: gate.gateId,
      order: gate.order,
      label: gate.label,
      owner: gate.owner,
      state: gate.state,
      ready: gate.ready === true,
      required: gate.required === true,
      held: gate.held === true,
      acknowledged: gate.acknowledged === true,
      nextAction: gate.nextAction,
      evidence: gate.evidence || {}
    })),
    counters: {
      total: source.counters?.total || gates.length,
      ready: source.counters?.ready || gates.filter((gate) => gate.ready).length,
      blocked: source.counters?.blocked || blocked.length,
      waiting: source.counters?.waiting || waiting.length,
      held: source.counters?.held || gates.filter((gate) => gate.held).length
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      runtimeReleaseControlsStatus: status,
      runtimeReleaseControlsReady: ready,
      runtimeReleaseControlsNextAction: nextAction,
      runtimeReleaseControlsNextGateId: source.nextGateId || nextGate?.gateId || null,
      runtimeReleaseBlockedGateIds: uniqueSorted(source.clientPatch?.runtimeReleaseBlockedGateIds || blocked.map((gate) => gate.gateId)),
      runtimeReleaseWaitingGateIds: uniqueSorted(source.clientPatch?.runtimeReleaseWaitingGateIds || waiting.map((gate) => gate.gateId))
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-runtime-release-control-key",
      resumeFromReleaseKey: source.releaseKey || `${job.id}:release-controls:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      externalWritesPerformed: false
    }
  };
}

function retryProfileFor(status, diagnostics) {
  const blockingCount = diagnostics.counts?.bySeverity?.error || 0;
  const warningCount = diagnostics.counts?.bySeverity?.warning || 0;
  if (blockingCount > 0 || status === "blocked") {
    return {
      retryable: false,
      backoffMs: 0,
      maxAttempts: 0,
      nextAction: diagnostics.recovery?.nextAction || "repair-compile-contract",
      reason: "blocking-diagnostics"
    };
  }
  if (warningCount > 0 || status === "needs-operator-action") {
    return {
      retryable: true,
      backoffMs: 30000,
      maxAttempts: 3,
      nextAction: diagnostics.recovery?.nextAction || "review-runtime-handoff-action",
      reason: "operator-action-pending"
    };
  }
  return {
    retryable: true,
    backoffMs: 5000,
    maxAttempts: 1,
    nextAction: "handoff-to-runtime-adapter",
    reason: "ready-preflight"
  };
}

function healthLevel(status, runtimeSummary, diagnostics) {
  if (status === "blocked") return "unhealthy";
  if (diagnostics.recovery?.requiredActionCount > 0) return "degraded";
  if (runtimeSummary.statusControls.requiresApprovalBeforeExternalWrite) return "degraded";
  if (runtimeSummary.acceptedForRuntime) return "healthy";
  return "degraded";
}

function actionableErrorsFrom(diagnosticEmission) {
  return diagnosticEmission.diagnostics
    .filter((diagnostic) => diagnostic.userVisible && diagnostic.severity !== "info")
    .map((diagnostic) => ({
      id: diagnostic.id,
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      scope: diagnostic.scope,
      recoveryAction: diagnostic.recoveryAction,
      blocksRuntimeHandoff: diagnostic.blocksRuntimeHandoff
    }));
}

function summarizeOperationalIncidents(job, diagnosticEmission) {
  const queue = diagnosticEmission.operationalIncidents || {};
  const incidents = Array.isArray(queue.incidents) ? queue.incidents : [];
  const blocking = incidents.filter((incident) => incident.handoff?.blocksRuntimeStart === true);
  const retryable = incidents.filter((incident) => incident.retry?.retryable === true);
  const providerVisible = incidents.filter((incident) => incident.handoff?.providerVisible === true);
  const clientVisible = incidents.filter((incident) => incident.handoff?.clientVisible === true);
  const nextIncident = incidents.find((incident) => incident.id === queue.nextIncidentId)
    || blocking[0]
    || retryable[0]
    || incidents[0]
    || null;

  return {
    schemaVersion: "aios.mailchimp.operational-incident-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: queue.status || (blocking.length > 0 ? "blocked" : incidents.length > 0 ? "degraded" : "ready"),
    nextAction: queue.nextAction || nextIncident?.nextAction || diagnosticEmission.recovery?.nextAction || "handoff-to-runtime-adapter",
    nextIncidentId: nextIncident?.id || null,
    nextOwner: nextIncident?.owner || null,
    counts: {
      total: queue.incidentCount || incidents.length,
      blocking: queue.summary?.blocking || blocking.length,
      retryable: queue.summary?.retryable || retryable.length,
      providerVisible: queue.summary?.providerVisible || providerVisible.length,
      clientVisible: queue.summary?.clientVisible || clientVisible.length,
      recoveryBlocked: queue.summary?.recoveryBlocked === true ? 1 : 0
    },
    owners: queue.summary?.byOwner || incidents.reduce((owners, incident) => {
      owners[incident.owner] = (owners[incident.owner] || 0) + 1;
      return owners;
    }, {}),
    nextRetryAtMs: queue.adapterHandoff?.nextRetryAtMs || retryable[0]?.retry?.deadlineMs || 0,
    adapterHandoff: {
      queueRequired: queue.adapterHandoff?.queueRequired === true,
      resumeFromIncidentId: queue.adapterHandoff?.resumeFromIncidentId || nextIncident?.id || null,
      staleStatusPolicy: queue.adapterHandoff?.staleStatusPolicy || "continue-runtime-handoff"
    },
    incidents: incidents.slice(0, 10).map((incident) => ({
      id: incident.id,
      order: incident.order,
      code: incident.code,
      severity: incident.severity,
      status: incident.status,
      owner: incident.owner,
      scope: incident.scope,
      nextAction: incident.nextAction,
      escalationBucket: incident.escalationBucket,
      retryable: incident.retry?.retryable === true,
      deadlineMs: incident.retry?.deadlineMs || 0,
      blocksRuntimeStart: incident.handoff?.blocksRuntimeStart === true
    })),
    clientPatch: {
      ...(queue.clientPatch || {}),
      operationalIncidentSummaryStatus: queue.status || "ready",
      operationalIncidentSummaryNextAction: queue.nextAction || nextIncident?.nextAction || "handoff-to-runtime-adapter",
      operationalIncidentSummaryCount: queue.incidentCount || incidents.length,
      operationalIncidentSummaryOwner: nextIncident?.owner || null
    }
  };
}

function summarizeClientRemediation(job, diagnosticEmission, runtimeSummary) {
  const packet = diagnosticEmission.clientRemediationPacket || {};
  const steps = Array.isArray(packet.steps) ? packet.steps : [];
  const blocking = steps.filter((step) => step.status === "blocked");
  const waiting = steps.filter((step) => step.status === "waiting");
  const nextStep = steps.find((step) => step.nextAction === packet.nextAction)
    || blocking[0]
    || waiting[0]
    || steps[0]
    || null;
  const status = packet.status
    || (blocking.length > 0
      ? "blocked"
      : waiting.length > 0
        ? "needs-operator-action"
        : "ready");
  const route = packet.route || {};

  return {
    schemaVersion: "aios.mailchimp.client-remediation-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    visibleStatus: packet.visibleStatus || status,
    readyForClient: packet.readyForClient === true,
    readyForRuntime: packet.readyForRuntime === true && runtimeSummary.acceptedForRuntime === true,
    nextAction: packet.nextAction || nextStep?.nextAction || "handoff-to-runtime-adapter",
    nextStepId: nextStep?.id || null,
    route: {
      routeId: route.routeId || `${job.id}:client-remediation:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      idempotencyKey: route.idempotencyKey || null,
      target: route.target || "client-runtime",
      resumeToken: route.resumeToken || diagnosticEmission.statusLedger?.resumeToken || null,
      statusRevision: route.statusRevision || diagnosticEmission.statusLedger?.statusRevision || null
    },
    counters: {
      steps: packet.counters?.steps || steps.length,
      blocking: packet.counters?.blocking || blocking.length,
      waiting: packet.counters?.waiting || waiting.length,
      clientVisibleIncidents: packet.counters?.clientVisibleIncidents || 0,
      runtimeBlockingIncidents: packet.counters?.runtimeBlockingIncidents || 0
    },
    groups: {
      missingStateKeys: uniqueSorted(
        steps
          .filter((step) => step.kind === "hydrate-client-state")
          .map((step) => step.evidence?.missingStateKey)
      ),
      pendingAckKeys: uniqueSorted(
        steps
          .filter((step) => step.kind === "acknowledge-command")
          .map((step) => step.evidence?.ackKey)
      ),
      missingSettings: uniqueSorted(
        steps
          .filter((step) => step.kind === "hydrate-client-setting")
          .map((step) => step.evidence?.missingSetting)
      ),
      blockedGateIds: uniqueSorted(
        steps
          .filter((step) => step.kind === "preview-gate" || step.kind === "runtime-release-gate")
          .map((step) => step.evidence?.gateId)
      )
    },
    steps: steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      status: step.status,
      owner: step.owner,
      nextAction: step.nextAction
    })),
    clientPatch: {
      ...(packet.clientPatch || {}),
      clientRemediationSummaryStatus: status,
      clientRemediationSummaryNextAction: packet.nextAction || nextStep?.nextAction || "handoff-to-runtime-adapter",
      clientRemediationSummaryRouteId: route.routeId || null,
      clientRemediationSummaryBlocking: packet.counters?.blocking || blocking.length,
      clientRemediationSummaryWaiting: packet.counters?.waiting || waiting.length
    },
    restartSemantics: packet.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-remediation-route",
      resumeToken: route.resumeToken || null,
      statusRevision: route.statusRevision || null,
      externalWritesPerformed: false
    }
  };
}

function buildAnalyticsCounters(job, capabilitySummary, memorySummary, verifierSummary, runtimeSummary, diagnosticEmission) {
  const diagnostics = diagnosticEmission.counts || { bySeverity: {}, byScope: {} };
  const commandPlan = diagnosticEmission.recoveryCommands || {};
  const commands = Array.isArray(commandPlan.commands) ? commandPlan.commands : [];
  const commandLeasePlan = diagnosticEmission.clientCommandLeases || {};
  const permissionGrantPlan = diagnosticEmission.permissionGrantPlan || {};
  const tenantPermissionEnforcement = diagnosticEmission.tenantPermissionEnforcement || {};
  const tenantBoundaryPosture = diagnosticEmission.tenantBoundaryPosture || {};
  const operationalIncidents = diagnosticEmission.operationalIncidents || {};
  const clientRemediationPacket = diagnosticEmission.clientRemediationPacket || {};
  const exportLedger = diagnosticEmission.exportLedger || {};
  const incidentRows = Array.isArray(operationalIncidents.incidents) ? operationalIncidents.incidents : [];
  const exportLedgerRows = Array.isArray(exportLedger.rows) ? exportLedger.rows : [];
  const leases = Array.isArray(commandLeasePlan.leases) ? commandLeasePlan.leases : [];
  const permissionCommands = Array.isArray(permissionGrantPlan.commands) ? permissionGrantPlan.commands : [];
  const failureState = diagnosticEmission.failureState || {};
  const externalWriteActions = capabilitySummary.writeActions.length;
  const providerSyncMounts = memorySummary.providerSyncMounts.length;
  const approvalCommands = commands.filter((command) => command.command === "await-operator-approval").length;
  const blockingCommands = commands.filter((command) => command.blocksRuntimeStart).length;
  const retryableCommands = commands.filter((command) => command.retryPolicy?.retryable).length;
  const ackRequiredLeases = leases.filter((lease) => lease.ackRequired);
  const clientVisibleLeases = leases.filter((lease) => lease.clientVisible);

  return {
    schemaVersion: "aios.mailchimp.analytics-counters.v1",
    provider: "mailchimp",
    jobId: job.id,
    totals: {
      capabilities: capabilitySummary.count,
      memoryMounts: memorySummary.count,
      verifierRules: verifierSummary.count,
      diagnostics: diagnostics.total || 0,
      recoveryCommands: commands.length,
      permissionGrantCommands: permissionCommands.length,
      tenantPermissionDecisions: tenantPermissionEnforcement.counters?.commands
        || tenantPermissionEnforcement.decisions?.length
        || 0,
      tenantBoundaryPostureDrifts: tenantBoundaryPosture.clientPatch?.tenantBoundaryDriftCount || 0,
      clientCommandLeases: leases.length,
      nextActions: diagnosticEmission.nextActions?.length || 0,
      failureStates: failureState.summary?.total || 0,
      operationalIncidents: operationalIncidents.incidentCount || incidentRows.length,
      clientRemediationSteps: clientRemediationPacket.counters?.steps || clientRemediationPacket.steps?.length || 0,
      restartCheckpoints: diagnosticEmission.restartCheckpointManifest?.counters?.checkpoints || 0,
      diagnosticExportLedgerRows: exportLedgerRows.length
    },
    diagnostics: {
      errors: diagnostics.bySeverity?.error || 0,
      warnings: diagnostics.bySeverity?.warning || 0,
      info: diagnostics.bySeverity?.info || 0,
      scopeCounts: diagnostics.byScope || {}
    },
    runtimeRisk: {
      externalWriteActions,
      providerSyncMounts,
      approvalCommands,
      blockingCommands,
      retryableCommands,
      ackRequiredLeases: ackRequiredLeases.length,
      permissionGrantBlockingCommands: permissionCommands.filter((command) => command.blocksRuntimeStart).length,
      permissionGrantRetryableCommands: permissionCommands.filter((command) => command.retryPolicy?.retryable).length,
      permissionGrantStatus: permissionGrantPlan.status || "unknown",
      tenantPermissionEnforcementStatus: tenantPermissionEnforcement.status || "unknown",
      tenantPermissionBlockedDecisions: tenantPermissionEnforcement.counters?.blocked || 0,
      tenantPermissionAuditReady: tenantPermissionEnforcement.audit?.ready === true,
      tenantBoundaryPostureStatus: tenantBoundaryPosture.status || "unknown",
      tenantBoundarySafeForRuntime: tenantBoundaryPosture.safeForRuntime === true,
      tenantBoundarySafeForAuditAppend: tenantBoundaryPosture.safeForAuditAppend === true,
      tenantBoundaryPostureDrifts: tenantBoundaryPosture.clientPatch?.tenantBoundaryDriftCount || 0,
      clientVisibleLeases: clientVisibleLeases.length,
      commandLeaseStatus: commandLeasePlan.leaseStatus || "unknown",
      failureStateMode: failureState.mode || "unknown",
      restartCheckpointStatus: diagnosticEmission.restartCheckpointManifest?.status || "unknown",
      restartCheckpointReady: diagnosticEmission.restartCheckpointManifest?.readyForColdRestart === true,
      restartCheckpointMissingRequired: diagnosticEmission.restartCheckpointManifest?.blocking?.missingRequiredCheckpoints?.length || 0,
      operationalIncidentBlocking: operationalIncidents.summary?.blocking || incidentRows.filter((incident) => incident.handoff?.blocksRuntimeStart).length,
      operationalIncidentRetryable: operationalIncidents.summary?.retryable || incidentRows.filter((incident) => incident.retry?.retryable).length,
      operationalIncidentProviderVisible: operationalIncidents.summary?.providerVisible || incidentRows.filter((incident) => incident.handoff?.providerVisible).length,
      operationalIncidentClientVisible: operationalIncidents.summary?.clientVisible || incidentRows.filter((incident) => incident.handoff?.clientVisible).length,
      operationalIncidentStatus: operationalIncidents.status || "unknown",
      clientRemediationStatus: clientRemediationPacket.status || "unknown",
      clientRemediationBlocking: clientRemediationPacket.counters?.blocking || 0,
      clientRemediationWaiting: clientRemediationPacket.counters?.waiting || 0,
      diagnosticExportLedgerReady: exportLedger.exportReady === true,
      diagnosticExportLedgerBlockedRows: exportLedger.counters?.blockedRows || exportLedgerRows.filter((row) => row.status === "blocked").length,
      diagnosticExportLedgerWaitingRows: exportLedger.counters?.waitingRows || exportLedgerRows.filter((row) => row.status === "waiting").length,
      nextRetryBackoffMs: failureState.nextRetry?.backoffMs || 0,
      requiresApprovalBeforeExternalWrite: runtimeSummary.statusControls.requiresApprovalBeforeExternalWrite,
      acceptedForRuntime: runtimeSummary.acceptedForRuntime
    },
    status: {
      current: diagnosticEmission.status,
      readinessStatus: runtimeSummary.readinessStatus,
      healthCandidate: diagnosticEmission.status === "ready" && runtimeSummary.acceptedForRuntime
        ? "healthy"
        : diagnosticEmission.status === "blocked"
          ? "unhealthy"
          : "degraded"
    }
  };
}

function summarizePermissionGrantPlan(job, diagnosticEmission) {
  const plan = diagnosticEmission.permissionGrantPlan || {};
  const commands = Array.isArray(plan.commands) ? plan.commands : [];
  const blockingCommands = commands.filter((command) => command.blocksRuntimeStart === true || command.status === "blocked");
  const retryableCommands = commands.filter((command) => command.retryPolicy?.retryable === true);
  const auditCommand = commands.find((command) => command.kind === "audit-append") || null;
  const readyForAudit = plan.safeBoundary === true && blockingCommands.length === 0 && Boolean(auditCommand?.id);
  const nextAction = plan.nextAction
    || blockingCommands[0]?.action
    || (readyForAudit ? "append-tenant-permission-audit" : diagnosticEmission.permissionBoundary?.nextAction)
    || diagnosticEmission.recovery?.nextAction
    || "repair-permission-grant-plan";

  return {
    schemaVersion: "aios.mailchimp.permission-grant-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: plan.status || (blockingCommands.length > 0 ? "blocked" : readyForAudit ? "ready" : "waiting"),
    readyForAudit,
    safeBoundary: plan.safeBoundary === true,
    isolationKey: plan.isolationKey || diagnosticEmission.permissionBoundary?.isolationKey || null,
    nextAction,
    commandIds: commands.map((command) => command.id).filter(Boolean),
    blockingCommandIds: blockingCommands.map((command) => command.id).filter(Boolean),
    retryableCommandIds: retryableCommands.map((command) => command.id).filter(Boolean),
    summary: {
      total: plan.summary?.total || commands.length,
      blocking: plan.summary?.blocking || blockingCommands.length,
      roleGrants: plan.summary?.roleGrants || commands.filter((command) => command.kind === "role-grant").length,
      scopePrunes: plan.summary?.scopePrunes || commands.filter((command) => command.kind === "scope-prune").length,
      auditAppends: plan.summary?.auditAppends || commands.filter((command) => command.kind === "audit-append").length,
      retryable: plan.summary?.retryable || retryableCommands.length
    },
    commands: commands.map((command) => ({
      id: command.id,
      order: command.order,
      kind: command.kind,
      target: command.target,
      owner: command.owner,
      action: command.action,
      status: command.status,
      required: command.required === true,
      blocksRuntimeStart: command.blocksRuntimeStart === true,
      retryable: command.retryPolicy?.retryable === true,
      backoffMs: command.retryPolicy?.backoffMs || 0
    })),
    clientPatch: {
      ...(plan.clientPatch || {}),
      permissionGrantPlanStatus: plan.status || "unknown",
      permissionGrantPlanReady: readyForAudit,
      permissionGrantPlanNextAction: nextAction,
      permissionGrantBlockingCount: blockingCommands.length,
      permissionGrantCommandIds: commands.map((command) => command.id).filter(Boolean)
    },
    restartSemantics: plan.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-permission-grant-command-id",
      resumeFromCommandId: blockingCommands[0]?.id || auditCommand?.id || null,
      externalWritesPerformed: false
    }
  };
}

function summarizeTenantPermissionEnforcement(job, diagnosticEmission, permissionGrantSummary) {
  const source = diagnosticEmission.tenantPermissionEnforcement || {};
  const decisions = Array.isArray(source.decisions) ? source.decisions : [];
  const blocked = decisions.filter((decision) => decision.blocksRuntimeStart === true || decision.status === "blocked");
  const retryable = decisions.filter((decision) => decision.retryable === true);
  const audit = source.audit || {};
  const status = source.status
    || (blocked.length > 0
      ? "blocked"
      : audit.ready === true
        ? "ready"
        : permissionGrantSummary.status || "needs-operator-action");
  const enforcementKey = source.enforcementKey
    || `${job.id}:${source.isolationKey || diagnosticEmission.permissionBoundary?.isolationKey || "tenant.local_workspace.local"}:${status}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = source.nextAction
    || blocked[0]?.action
    || permissionGrantSummary.nextAction
    || (audit.ready === true ? "append-tenant-permission-audit" : "resolve-tenant-permission-boundary");

  return {
    schemaVersion: "aios.mailchimp.tenant-permission-enforcement-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    enforcementKey,
    safeBoundary: source.safeBoundary === true,
    isolationKey: source.isolationKey || diagnosticEmission.permissionBoundary?.isolationKey || null,
    tenantId: source.tenantId || diagnosticEmission.permissionBoundary?.tenantId || null,
    workspaceId: source.workspaceId || diagnosticEmission.permissionBoundary?.workspaceId || null,
    nextAction,
    audit: {
      required: audit.required === true,
      ready: audit.ready === true,
      commandIds: uniqueSorted(audit.commandIds || []),
      diagnosticIds: uniqueSorted(audit.diagnosticIds || source.diagnosticIds || []),
      appendAction: audit.appendAction || "append-tenant-permission-audit"
    },
    counters: {
      decisions: source.counters?.commands || decisions.length,
      blocked: source.counters?.blocked || blocked.length,
      retryable: source.counters?.retryable || retryable.length,
      missingRoles: source.counters?.missingRoles || source.boundary?.missingRoles?.length || 0,
      deniedScopes: source.counters?.deniedScopes || source.boundary?.deniedScopes?.length || 0,
      waivers: source.counters?.waivers || source.waivers?.length || 0,
      diagnostics: source.counters?.diagnostics || audit.diagnosticIds?.length || 0
    },
    decisions: decisions.map((decision) => ({
      commandId: decision.commandId,
      kind: decision.kind,
      target: decision.target,
      owner: decision.owner,
      action: decision.action,
      status: decision.status,
      required: decision.required === true,
      blocksRuntimeStart: decision.blocksRuntimeStart === true,
      retryable: decision.retryable === true,
      backoffMs: decision.backoffMs || 0
    })),
    clientPatch: {
      ...(source.clientPatch || {}),
      tenantPermissionEnforcementStatus: status,
      tenantPermissionEnforcementKey: enforcementKey,
      tenantPermissionNextAction: nextAction,
      tenantPermissionAuditReady: audit.ready === true,
      tenantPermissionBlocked: source.counters?.blocked || blocked.length
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-tenant-permission-enforcement-key",
      resumeFromEnforcementKey: enforcementKey,
      externalWritesPerformed: false
    }
  };
}

function summarizeTenantBoundaryPosture(job, diagnosticEmission, tenantPermissionEnforcement) {
  const source = diagnosticEmission.tenantBoundaryPosture || {};
  const drift = source.drift || {};
  const runtimeGate = source.runtimeGate || {};
  const auditHandoff = source.auditHandoff || {};
  const status = source.status
    || (runtimeGate.blocksRuntimeStart === true
      ? "blocked"
      : auditHandoff.ready === true
        ? "ready"
        : tenantPermissionEnforcement.status || "needs-operator-action");
  const postureKey = source.postureKey
    || `${job.id}:${source.isolationKey || tenantPermissionEnforcement.isolationKey || "tenant.local_workspace.local"}:${status}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const driftFlags = [
    drift.isolationDrift === true,
    drift.roleDrift === true,
    drift.scopeDrift === true,
    drift.auditDrift === true
  ];

  return {
    schemaVersion: "aios.mailchimp.tenant-boundary-posture-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    postureKey,
    isolationKey: source.isolationKey || tenantPermissionEnforcement.isolationKey || null,
    tenantId: source.tenantId || tenantPermissionEnforcement.tenantId || null,
    workspaceId: source.workspaceId || tenantPermissionEnforcement.workspaceId || null,
    safeForRuntime: source.safeForRuntime === true && status === "ready",
    safeForAuditAppend: source.safeForAuditAppend === true || tenantPermissionEnforcement.audit?.ready === true,
    nextAction: source.nextAction
      || tenantPermissionEnforcement.nextAction
      || (status === "ready" ? "handoff-to-runtime-adapter" : "resolve-tenant-boundary-posture"),
    drift: {
      explicitBoundary: drift.explicitBoundary === true,
      isolationDrift: drift.isolationDrift === true,
      roleDrift: drift.roleDrift === true,
      scopeDrift: drift.scopeDrift === true,
      auditDrift: drift.auditDrift === true,
      missingRoles: uniqueSorted(drift.missingRoles || []),
      deniedScopes: uniqueSorted(drift.deniedScopes || []),
      diagnosticIds: uniqueSorted(source.diagnosticIds || drift.diagnosticIds || [])
    },
    runtimeGate: {
      blocksRuntimeStart: runtimeGate.blocksRuntimeStart === true || status === "blocked",
      blockedDecisionIds: uniqueSorted(runtimeGate.blockedDecisionIds || []),
      waitingDecisionIds: uniqueSorted(runtimeGate.waitingDecisionIds || []),
      retryableDecisionIds: uniqueSorted(runtimeGate.retryableDecisionIds || []),
      requiredRoleCount: runtimeGate.requiredRoleCount || 0,
      requiredScopeCount: runtimeGate.requiredScopeCount || 0
    },
    auditHandoff: {
      commandId: auditHandoff.commandId || tenantPermissionEnforcement.audit?.commandIds?.[0] || null,
      ready: auditHandoff.ready === true || tenantPermissionEnforcement.audit?.ready === true,
      appendAction: auditHandoff.appendAction || "append-tenant-permission-audit",
      idempotencyKey: auditHandoff.idempotencyKey || null,
      externalWritesPerformed: false
    },
    counters: {
      driftFlags: driftFlags.filter(Boolean).length,
      blockedDecisions: runtimeGate.blockedDecisionIds?.length || 0,
      waitingDecisions: runtimeGate.waitingDecisionIds?.length || 0,
      retryableDecisions: runtimeGate.retryableDecisionIds?.length || 0,
      diagnostics: drift.diagnosticIds?.length || source.diagnosticIds?.length || 0
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      tenantBoundaryPostureStatus: status,
      tenantBoundaryPostureKey: postureKey,
      tenantBoundaryPostureNextAction: source.nextAction || tenantPermissionEnforcement.nextAction || "resolve-tenant-boundary-posture",
      tenantBoundarySafeForRuntime: source.safeForRuntime === true && status === "ready",
      tenantBoundarySafeForAudit: source.safeForAuditAppend === true || tenantPermissionEnforcement.audit?.ready === true
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-tenant-boundary-posture-key",
      resumeFromPostureKey: postureKey,
      externalWritesPerformed: false
    }
  };
}

function summarizeTenantBoundaryHandoff(job, diagnosticEmission, tenantPermissionEnforcement, tenantBoundaryPosture) {
  const source = diagnosticEmission.tenantBoundaryHandoff || job.boundaryHandoff || {};
  const boundary = diagnosticEmission.permissionBoundary || {};
  const postureDrift = tenantBoundaryPosture.drift || {};
  const blockedReasons = uniqueSorted([
    ...(Array.isArray(source.blockedReasons) ? source.blockedReasons : []),
    ...(Array.isArray(boundary.boundary?.missingOrDenied) ? boundary.boundary.missingOrDenied : []),
    ...(tenantPermissionEnforcement.status === "blocked" ? ["tenant_permission_enforcement_blocked"] : []),
    ...(tenantBoundaryPosture.safeForRuntime === true ? [] : ["tenant_boundary_posture_not_runtime_safe"]),
    ...(postureDrift.isolationDrift === true ? ["tenant_boundary_isolation_drift"] : []),
    ...(postureDrift.scopeDrift === true ? ["tenant_boundary_scope_drift"] : []),
    ...(postureDrift.roleDrift === true ? ["tenant_boundary_role_drift"] : [])
  ]);
  const audit = source.audit || tenantPermissionEnforcement.audit || {};
  const requiresAuditAppend = source.requiresAuditAppend === true
    || tenantPermissionEnforcement.audit?.required === true
    || tenantPermissionEnforcement.audit?.ready !== true;
  const auditAppendReady = source.auditAppendReady === true
    || tenantPermissionEnforcement.audit?.ready === true;
  const readyForRuntime = blockedReasons.length === 0
    && tenantBoundaryPosture.safeForRuntime === true
    && tenantPermissionEnforcement.status !== "blocked";
  const nextAction = readyForRuntime
    ? requiresAuditAppend && !auditAppendReady
      ? "append_tenant_boundary_audit"
      : "handoff-to-runtime-adapter"
    : tenantBoundaryPosture.nextAction
      || tenantPermissionEnforcement.nextAction
      || "repair_tenant_permissions";
  const boundaryKey = source.boundaryKey
    || `${job.id}:${tenantBoundaryPosture.isolationKey || tenantPermissionEnforcement.isolationKey || "tenant.local_workspace.local"}:${readyForRuntime ? "ready" : "blocked"}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.tenant-boundary-handoff.v1",
    provider: "mailchimp",
    jobId: job.id,
    boundaryKey,
    tenantId: source.tenant || tenantBoundaryPosture.tenantId || tenantPermissionEnforcement.tenantId || null,
    workspaceId: source.workspace || tenantBoundaryPosture.workspaceId || tenantPermissionEnforcement.workspaceId || null,
    action: source.action || job.task || null,
    scope: source.scope || "tenant",
    readyForRuntime,
    allowed: source.allowed !== false && blockedReasons.length === 0,
    requiresAuditAppend,
    auditAppendReady,
    externalWriteSuppressed: source.externalWriteSuppressed === true
      || source.audit?.externalWriteSuppressed === true
      || blockedReasons.length > 0,
    blockedReasons,
    requiredGrants: uniqueSorted(source.requiredGrants || tenantPermissionEnforcement.requiredGrants || []),
    granted: uniqueSorted(source.granted || source.grants || []),
    denied: uniqueSorted(source.denied || []),
    drift: {
      isolationDrift: postureDrift.isolationDrift === true,
      roleDrift: postureDrift.roleDrift === true,
      scopeDrift: postureDrift.scopeDrift === true,
      auditDrift: postureDrift.auditDrift === true,
      missingRoles: uniqueSorted(postureDrift.missingRoles || []),
      deniedScopes: uniqueSorted(postureDrift.deniedScopes || [])
    },
    route: {
      target: "runtime-boundary-gate",
      idempotencyKey: source.route?.idempotencyKey || boundaryKey,
      nextAction
    },
    audit: {
      channel: audit.channel || "metadata-emitter",
      handoffKey: audit.handoffKey || boundaryKey,
      decision: readyForRuntime ? "allow" : "block",
      commandIds: tenantPermissionEnforcement.audit?.commandIds || [],
      externalWriteSuppressed: blockedReasons.length > 0
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      tenantBoundaryHandoffKey: boundaryKey,
      tenantBoundaryHandoffReady: readyForRuntime,
      tenantBoundaryHandoffNextAction: nextAction,
      tenantBoundaryHandoffBlockedReasons: blockedReasons
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-tenant-boundary-handoff-key",
      resumeFromBoundaryKey: boundaryKey,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function summarizeTenantPermissionDecisionBundle(job, tenantPermissionEnforcement, tenantBoundaryPosture, tenantBoundaryHandoff) {
  const source = job.tenantPermissionDecisionBundle || job.adapterDispatchReadiness?.tenantPermissionDecisionBundle || {};
  const blockedReasons = uniqueSorted([
    ...(Array.isArray(source.blockedReasons) ? source.blockedReasons : []),
    ...(tenantPermissionEnforcement.status === "blocked" ? ["tenant_permission_enforcement_blocked"] : []),
    ...(tenantBoundaryHandoff.readyForRuntime === false ? ["tenant_boundary_handoff_not_ready"] : []),
    ...(tenantBoundaryPosture.safeForRuntime === true ? [] : ["tenant_boundary_posture_not_runtime_safe"])
  ]);
  const audit = source.audit || tenantBoundaryHandoff.audit || tenantPermissionEnforcement.audit || {};
  const auditRequired = audit.required === true
    || tenantBoundaryHandoff.requiresAuditAppend === true
    || tenantPermissionEnforcement.audit?.required === true;
  const auditReady = audit.ready === true
    || tenantBoundaryHandoff.auditAppendReady === true
    || tenantPermissionEnforcement.audit?.ready === true;
  const ready = source.ready === true
    || (blockedReasons.length === 0
      && tenantBoundaryHandoff.readyForRuntime === true
      && (!auditRequired || auditReady));
  const status = source.status
    || (ready
      ? "ready"
      : blockedReasons.length > 0
        ? "blocked"
        : auditRequired && !auditReady
          ? "audit_append_required"
          : "needs-review");
  const nextAction = ready
    ? source.nextAction || "handoff-to-runtime-adapter"
    : auditRequired && !auditReady
      ? "append_tenant_boundary_audit"
      : source.nextAction || tenantBoundaryHandoff.nextAction || tenantPermissionEnforcement.nextAction || "repair_tenant_permissions";
  const decisionKey = source.decisionKey
    || `${job.id}:${tenantBoundaryHandoff.boundaryKey || tenantBoundaryPosture.postureKey || "tenant-permission"}:${status}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.tenant-permission-decision-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    decisionKey,
    status,
    ready,
    allowedForRuntime: source.allowedForRuntime === true || (ready && tenantBoundaryHandoff.externalWriteSuppressed !== true),
    externalWriteSuppressed: source.externalWriteSuppressed === true || tenantBoundaryHandoff.externalWriteSuppressed === true,
    nextAction,
    tenantId: source.tenant || tenantBoundaryHandoff.tenantId || tenantBoundaryPosture.tenantId || null,
    workspaceId: source.workspace || tenantBoundaryHandoff.workspaceId || tenantBoundaryPosture.workspaceId || null,
    action: source.action || tenantBoundaryHandoff.action || job.task || null,
    requiredGrants: uniqueSorted(source.requiredGrants || tenantBoundaryHandoff.requiredGrants || []),
    granted: uniqueSorted(source.granted || tenantBoundaryHandoff.granted || []),
    denied: uniqueSorted(source.denied || tenantBoundaryHandoff.denied || []),
    blockedReasons,
    audit: {
      channel: audit.channel || tenantBoundaryHandoff.audit?.channel || "metadata-emitter",
      required: auditRequired,
      ready: auditReady,
      decision: ready ? "allow" : "block",
      handoffKey: audit.handoffKey || tenantBoundaryHandoff.audit?.handoffKey || decisionKey,
      command: auditRequired && !auditReady ? "append_tenant_boundary_audit" : "observe"
    },
    route: {
      target: source.route?.target || "runtime-permission-boundary",
      idempotencyKey: source.route?.idempotencyKey || decisionKey,
      primaryAction: nextAction
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      tenantPermissionDecisionStatus: status,
      tenantPermissionDecisionReady: ready,
      tenantPermissionDecisionKey: decisionKey,
      tenantPermissionDecisionNextAction: nextAction,
      tenantPermissionBlockedReasons: blockedReasons,
      tenantPermissionAuditRequired: auditRequired,
      tenantPermissionAuditReady: auditReady
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-tenant-permission-decision-key",
      resumeFromPermissionDecisionKey: decisionKey,
      externalWritesPerformed: false
    }
  };
}

function summarizeClientCommandLeases(job, diagnosticEmission) {
  const commandLeasePlan = diagnosticEmission.clientCommandLeases || {};
  const leases = Array.isArray(commandLeasePlan.leases) ? commandLeasePlan.leases : [];
  const primaryLease = leases.find((lease) => lease.id === commandLeasePlan.primaryLeaseId) || leases[0] || null;
  const ackRequired = leases.filter((lease) => lease.ackRequired);
  const visible = leases.filter((lease) => lease.clientVisible);
  const blocking = leases.filter((lease) => lease.blocksRuntimeStart);

  return {
    schemaVersion: "aios.mailchimp.client-command-lease-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: commandLeasePlan.status || diagnosticEmission.status,
    leaseStatus: commandLeasePlan.leaseStatus || "unknown",
    primaryLeaseId: primaryLease?.id || null,
    primaryAction: primaryLease?.nextAction
      || commandLeasePlan.primaryAction
      || diagnosticEmission.recovery?.nextAction
      || "handoff-to-runtime-adapter",
    ackRequired: ackRequired.length > 0,
    ackRequiredCount: ackRequired.length,
    visibleCount: visible.length,
    blockingCount: blocking.length,
    resumeToken: commandLeasePlan.clientAck?.resumeToken || `${job.id}:client-command-leases`,
    ackKeys: commandLeasePlan.clientAck?.ackKeys || ackRequired.map((lease) => lease.ackKey).filter(Boolean),
    leases: leases.map((lease) => ({
      id: lease.id,
      commandId: lease.commandId,
      status: lease.status,
      reason: lease.reason,
      nextAction: lease.nextAction,
      ackRequired: lease.ackRequired === true,
      ackKey: lease.ackKey || null,
      clientVisible: lease.clientVisible === true,
      blocksRuntimeStart: lease.blocksRuntimeStart === true,
      scheduleWindow: lease.scheduleWindow,
      scope: lease.scope,
      retryable: lease.retryPolicy?.retryable === true,
      backoffMs: lease.retryPolicy?.backoffMs || 0
    })),
    clientPatch: {
      commandLeaseStatus: commandLeasePlan.leaseStatus || "unknown",
      commandLeaseId: primaryLease?.id || null,
      commandAckRequired: ackRequired.length > 0,
      commandAckKey: primaryLease?.ackKey || null,
      commandLeaseResumeToken: commandLeasePlan.clientAck?.resumeToken || `${job.id}:client-command-leases`
    },
    restartSemantics: commandLeasePlan.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-command-lease-key",
      externalWritesPerformed: false,
      resumeFromLeaseId: primaryLease?.id || null
    }
  };
}

function summarizeStatusRecovery(job, diagnosticEmission, runtimeSummary) {
  const bundle = diagnosticEmission.statusRecoveryBundle || {};
  const resume = bundle.resume || {};
  const counters = bundle.counters || {};
  const blocking = bundle.blocking || {};
  const checkpoints = Array.isArray(bundle.checkpoints) ? bundle.checkpoints : [];
  const missingRequired = Array.isArray(blocking.missingRequiredCheckpoints)
    ? blocking.missingRequiredCheckpoints
    : checkpoints
      .filter((checkpoint) => checkpoint.required && checkpoint.ready !== true)
      .map((checkpoint) => checkpoint.phase);
  const readyForRuntimeResume = bundle.readyForRuntimeResume === true
    && runtimeSummary.acceptedForRuntime === true
    && missingRequired.length === 0;
  const state = missingRequired.length > 0
    ? "blocked"
    : bundle.state || "unknown";

  return {
    schemaVersion: "aios.mailchimp.status-recovery-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    state,
    readyForRuntimeResume,
    nextAction: readyForRuntimeResume
      ? runtimeSummary.nextAction || "handoff-to-runtime-adapter"
      : bundle.nextAction || diagnosticEmission.recovery?.nextAction || "repair-status-recovery",
    resume: {
      resumeToken: resume.resumeToken || diagnosticEmission.statusLedger?.resumeToken || `${job.id}:${diagnosticEmission.status}`,
      statusRevision: resume.statusRevision || diagnosticEmission.statusLedger?.statusRevision || `${job.id}:${diagnosticEmission.status}`,
      statusOnResume: resume.statusOnResume || diagnosticEmission.status,
      resumeFromCommandId: resume.resumeFromCommandId || diagnosticEmission.recoveryCommands?.restartCursor?.commandId || null,
      resumeFromLeaseId: resume.resumeFromLeaseId || diagnosticEmission.clientCommandLeases?.clientAck?.resumeFromLeaseId || null,
      resumeFromFailureId: resume.resumeFromFailureId || diagnosticEmission.failureState?.adapterHandoff?.resumeFromFailureId || null
    },
    counters: {
      commands: counters.commands || diagnosticEmission.recoveryCommands?.commandCount || 0,
      leases: counters.leases || diagnosticEmission.clientCommandLeases?.leases?.length || 0,
      failureQueue: counters.failureQueue || diagnosticEmission.failureState?.summary?.total || 0,
      blockingCommands: counters.blockingCommands || 0,
      blockingLeases: counters.blockingLeases || diagnosticEmission.clientCommandLeases?.blockingCount || 0,
      retryableFailures: counters.retryableFailures || diagnosticEmission.failureState?.summary?.retryable || 0,
      missingRequiredCheckpoints: missingRequired.length
    },
    checkpoints: checkpoints.map((checkpoint) => ({
      phase: checkpoint.phase,
      required: checkpoint.required === true,
      ready: checkpoint.ready === true,
      cursor: checkpoint.cursor || null,
      nextAction: checkpoint.nextAction || bundle.nextAction || "repair-status-recovery"
    })),
    blocking: {
      commandIds: blocking.commandIds || [],
      leaseIds: blocking.leaseIds || [],
      missingRequiredCheckpoints: missingRequired,
      adapterMode: blocking.adapterMode || diagnosticEmission.failureState?.mode || "unknown"
    },
    clientPatch: {
      ...(bundle.clientPatch || {}),
      statusRecoveryState: state,
      statusRecoveryReady: readyForRuntimeResume,
      statusRecoveryNextAction: readyForRuntimeResume
        ? runtimeSummary.nextAction || "handoff-to-runtime-adapter"
        : bundle.nextAction || "repair-status-recovery",
      statusRecoveryResumeToken: resume.resumeToken || diagnosticEmission.statusLedger?.resumeToken || null,
      statusRecoveryRevision: resume.statusRevision || diagnosticEmission.statusLedger?.statusRevision || null
    },
    restartSemantics: {
      replaySafe: bundle.restartSemantics?.replaySafe === true,
      duplicateCommandPolicy: bundle.restartSemantics?.duplicateCommandPolicy || "dedupe-by-idempotency-key",
      externalWritesPerformed: false,
      staleStatusPolicy: bundle.restartSemantics?.staleStatusPolicy || {}
    }
  };
}

function summarizeRestartCheckpointManifest(job, diagnosticEmission, statusRecoverySummary) {
  const manifest = diagnosticEmission.restartCheckpointManifest || {};
  const checkpoints = Array.isArray(manifest.checkpoints) ? manifest.checkpoints : [];
  const missingRequired = manifest.blocking?.missingRequiredCheckpoints
    || checkpoints
      .filter((checkpoint) => checkpoint.required && checkpoint.ready !== true)
      .map((checkpoint) => checkpoint.phase);
  const readyForColdRestart = manifest.readyForColdRestart === true
    && missingRequired.length === 0
    && statusRecoverySummary.readyForRuntimeResume === true;
  const status = readyForColdRestart
    ? "ready"
    : missingRequired.length > 0
      ? "blocked"
      : manifest.status || "waiting";
  const nextAction = readyForColdRestart
    ? "handoff-to-runtime-adapter"
    : manifest.nextAction
      || statusRecoverySummary.nextAction
      || diagnosticEmission.recovery?.nextAction
      || "repair-restart-checkpoints";

  return {
    schemaVersion: "aios.mailchimp.restart-checkpoint-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    readyForColdRestart,
    nextAction,
    resumeToken: manifest.resumeToken
      || statusRecoverySummary.resume?.resumeToken
      || diagnosticEmission.statusLedger?.resumeToken
      || `${job.id}:${diagnosticEmission.status}`,
    statusRevision: manifest.statusRevision
      || statusRecoverySummary.resume?.statusRevision
      || diagnosticEmission.statusLedger?.statusRevision
      || `${job.id}:${diagnosticEmission.status}`,
    counters: {
      checkpoints: manifest.counters?.checkpoints || checkpoints.length,
      required: manifest.counters?.required || checkpoints.filter((checkpoint) => checkpoint.required).length,
      ready: manifest.counters?.ready || checkpoints.filter((checkpoint) => checkpoint.ready).length,
      restartSafe: checkpoints.filter((checkpoint) => checkpoint.restartSafe).length,
      missingRequired: missingRequired.length,
      commands: manifest.counters?.commands || diagnosticEmission.recoveryCommands?.commands?.length || 0,
      leases: manifest.counters?.leases || diagnosticEmission.clientCommandLeases?.leases?.length || 0,
      failures: manifest.counters?.failures || diagnosticEmission.failureState?.summary?.total || 0
    },
    checkpoints: checkpoints.map((checkpoint) => ({
      order: checkpoint.order,
      phase: checkpoint.phase,
      source: checkpoint.source,
      required: checkpoint.required === true,
      ready: checkpoint.ready === true,
      restartSafe: checkpoint.restartSafe === true,
      cursor: checkpoint.cursor || null,
      replayPolicy: checkpoint.replayPolicy || "dedupe-by-idempotency-key",
      nextAction: checkpoint.nextAction || nextAction
    })),
    blocking: {
      missingRequiredCheckpoints: missingRequired,
      commandIds: manifest.blocking?.commandIds || [],
      leaseIds: manifest.blocking?.leaseIds || [],
      failureIds: manifest.blocking?.failureIds || []
    },
    clientPatch: {
      ...(manifest.clientPatch || {}),
      restartCheckpointStatus: status,
      restartCheckpointReady: readyForColdRestart,
      restartCheckpointNextAction: nextAction,
      restartCheckpointResumeToken: manifest.resumeToken || statusRecoverySummary.resume?.resumeToken || null,
      restartCheckpointRevision: manifest.statusRevision || statusRecoverySummary.resume?.statusRevision || null
    },
    restartSemantics: {
      replaySafe: readyForColdRestart,
      duplicateCommandPolicy: manifest.restartSemantics?.duplicateCommandPolicy || "dedupe-by-idempotency-key",
      resumeFromCommandId: manifest.restartSemantics?.resumeFromCommandId || statusRecoverySummary.resume?.resumeFromCommandId || null,
      resumeFromLeaseId: manifest.restartSemantics?.resumeFromLeaseId || statusRecoverySummary.resume?.resumeFromLeaseId || null,
      resumeFromFailureId: manifest.restartSemantics?.resumeFromFailureId || statusRecoverySummary.resume?.resumeFromFailureId || null,
      externalWritesPerformed: false,
      staleStatusPolicy: manifest.restartSemantics?.staleStatusPolicy || {}
    }
  };
}

function summarizeRestartReplayLedger(job, diagnosticEmission, restartCheckpoints) {
  const ledger = diagnosticEmission.restartReplayLedger || {};
  const rows = Array.isArray(ledger.rows) ? ledger.rows : [];
  const unsafeRows = rows.filter((row) => row.replaySafe !== true);
  const ackRows = rows.filter((row) => row.requiresAck === true);
  const blockedRows = rows.filter((row) => row.blocksRuntimeStart === true || row.status === "blocked");
  const replayReady = ledger.replayReady === true
    && unsafeRows.length === 0
    && restartCheckpoints.readyForColdRestart === true;
  const status = replayReady
    ? "ready"
    : unsafeRows.length > 0 || restartCheckpoints.status === "blocked"
      ? "blocked"
      : ackRows.length > 0
        ? "waiting-for-client"
        : ledger.status || "degraded";
  const nextRow = unsafeRows[0] || ackRows[0] || blockedRows[0] || rows[0] || null;
  const nextAction = replayReady
    ? "handoff-to-runtime-adapter"
    : ledger.nextAction
      || nextRow?.nextAction
      || restartCheckpoints.nextAction
      || diagnosticEmission.recovery?.nextAction
      || "repair-restart-replay-ledger";

  return {
    schemaVersion: "aios.mailchimp.restart-replay-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    replayReady,
    nextAction,
    resumeToken: ledger.resumeToken
      || restartCheckpoints.resumeToken
      || diagnosticEmission.statusLedger?.resumeToken
      || `${job.id}:${diagnosticEmission.status}`,
    statusRevision: ledger.statusRevision
      || restartCheckpoints.statusRevision
      || diagnosticEmission.statusLedger?.statusRevision
      || `${job.id}:${diagnosticEmission.status}`,
    counters: {
      rows: ledger.counters?.rows || rows.length,
      commands: ledger.counters?.commands || rows.filter((row) => row.kind === "recovery-command").length,
      leases: ledger.counters?.leases || rows.filter((row) => row.kind === "client-command-lease").length,
      failures: ledger.counters?.failures || rows.filter((row) => row.kind === "adapter-failure").length,
      unsafe: ledger.counters?.unsafe || unsafeRows.length,
      ackRequired: ledger.counters?.ackRequired || ackRows.length,
      blocked: ledger.counters?.blocked || blockedRows.length,
      retryable: ledger.counters?.retryable || rows.filter((row) => row.retryable).length
    },
    rows: rows.map((row) => ({
      id: row.id,
      order: row.order,
      kind: row.kind,
      sourceId: row.sourceId,
      status: row.status || "unknown",
      replaySafe: row.replaySafe === true,
      replayPolicy: row.replayPolicy || ledger.duplicatePolicy?.defaultPolicy || "dedupe-by-idempotency-key",
      cursor: row.cursor || null,
      nextAction: row.nextAction || nextAction,
      requiresAck: row.requiresAck === true,
      blocksRuntimeStart: row.blocksRuntimeStart === true,
      retryable: row.retryable === true
    })),
    duplicatePolicy: {
      defaultPolicy: ledger.duplicatePolicy?.defaultPolicy || "dedupe-by-idempotency-key",
      dedupeKeyCount: ledger.duplicatePolicy?.dedupeKeys?.length || rows.filter((row) => row.dedupeKey).length,
      onDuplicate: ledger.duplicatePolicy?.onDuplicate || "return-existing-result",
      onMissingDedupeKey: ledger.duplicatePolicy?.onMissingDedupeKey || "block-replay-and-rebuild-command"
    },
    resume: {
      ...(ledger.resume || {}),
      resumeToken: ledger.resumeToken || restartCheckpoints.resumeToken || null,
      statusRevision: ledger.statusRevision || restartCheckpoints.statusRevision || null
    },
    clientPatch: {
      ...(ledger.clientPatch || {}),
      restartReplayStatus: status,
      restartReplayReady: replayReady,
      restartReplayNextAction: nextAction,
      restartReplayResumeToken: ledger.resumeToken || restartCheckpoints.resumeToken || null,
      restartReplayRevision: ledger.statusRevision || restartCheckpoints.statusRevision || null
    },
    restartSemantics: {
      replaySafe: replayReady,
      duplicateCommandPolicy: ledger.restartSemantics?.duplicateCommandPolicy || "dedupe-by-idempotency-key",
      externalWritesPerformed: false,
      staleStatusPolicy: ledger.restartSemantics?.staleStatusPolicy || {}
    }
  };
}

function summarizeClientRuntimeAdoption(job, diagnosticEmission, runtimeSummary) {
  const adoption = diagnosticEmission.clientRuntimeAdoption || {};
  const missingStateKeys = Array.isArray(adoption.missingStateKeys) ? adoption.missingStateKeys : [];
  const pendingAckKeys = Array.isArray(adoption.commandAck?.pendingKeys)
    ? adoption.commandAck.pendingKeys
    : [];
  const requiredClientState = Array.isArray(adoption.requiredClientState)
    ? adoption.requiredClientState
    : runtimeSummary.requiredClientState || [];
  const status = adoption.status
    || (missingStateKeys.length > 0
      ? "blocked"
      : pendingAckKeys.length > 0
        ? "waiting-for-client"
        : "ready");
  const readyForClientRuntime = adoption.readyForClientRuntime === true
    && runtimeSummary.acceptedForClientPreview !== false
    && missingStateKeys.length === 0
    && pendingAckKeys.length === 0;
  const adoptionId = adoption.adoptionId
    || `${job.id}:client-runtime-adoption:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = adoption.nextAction
    || (missingStateKeys.length > 0
      ? "hydrate-mailchimp-client-runtime-state"
      : pendingAckKeys.length > 0
        ? "acknowledge-mailchimp-client-command"
        : "handoff-to-runtime-adapter");

  return {
    schemaVersion: "aios.mailchimp.client-runtime-adoption-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    adoptionId,
    status,
    readyForClientRuntime,
    previewAvailable: adoption.previewAvailable !== false,
    runtimeStartRequested: adoption.runtimeStartRequested === true,
    requiredClientState,
    providedStateKeys: adoption.providedStateKeys || [],
    missingStateKeys,
    commandAck: {
      required: adoption.commandAck?.required === true,
      requiredKeys: adoption.commandAck?.requiredKeys || [],
      acknowledgedKeys: adoption.commandAck?.acknowledgedKeys || [],
      pendingKeys: pendingAckKeys,
      ready: adoption.commandAck?.ready === true
    },
    resume: {
      resumeToken: adoption.resume?.resumeToken || diagnosticEmission.statusLedger?.resumeToken || null,
      statusRevision: adoption.resume?.statusRevision || diagnosticEmission.statusLedger?.statusRevision || null,
      ready: adoption.resume?.ready === true
    },
    clientPatch: {
      ...(adoption.clientPatch || {}),
      clientRuntimeAdoptionStatus: status,
      clientRuntimeReady: readyForClientRuntime,
      clientRuntimeAdoptionNextAction: nextAction,
      clientRuntimeMissingStateKeys: missingStateKeys,
      clientRuntimePendingAckKeys: pendingAckKeys
    },
    validationSummary: {
      requiredStateKeys: requiredClientState.length,
      missingStateKeys: missingStateKeys.length,
      pendingAckKeys: pendingAckKeys.length,
      diagnosticIds: adoption.diagnosticIds || [],
      readyChecks: [
        adoption.previewAvailable !== false,
        missingStateKeys.length === 0,
        pendingAckKeys.length === 0,
        adoption.resume?.ready === true
      ].filter(Boolean).length
    },
    restartSemantics: adoption.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-runtime-adoption-id",
      resumeFromAdoptionId: adoptionId,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function summarizeClientRuntimeSettings(job, diagnosticEmission, clientRuntimeAdoption) {
  const settings = diagnosticEmission.clientRuntimeSettings || {};
  const controls = settings.controls || {};
  const missingRequiredSettings = Array.isArray(settings.missingRequiredSettings)
    ? settings.missingRequiredSettings
    : [];
  const status = settings.status
    || (missingRequiredSettings.length > 0
      ? "needs-operator-action"
      : settings.readyForClientRuntime === true
        ? "ready"
        : clientRuntimeAdoption.status || "waiting-for-client");
  const nextAction = settings.nextAction
    || (missingRequiredSettings.length > 0
      ? "hydrate-mailchimp-client-runtime-settings"
      : settings.revisionAccepted === false
        ? "accept-mailchimp-client-settings"
        : clientRuntimeAdoption.nextAction || "handoff-to-runtime-adapter");
  const settingsRevision = settings.settingsRevision
    || `${job.id}:client-runtime-settings:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const readyForClientRuntime = settings.readyForClientRuntime === true
    && clientRuntimeAdoption.readyForClientRuntime === true
    && missingRequiredSettings.length === 0
    && settings.revisionAccepted !== false;

  return {
    schemaVersion: "aios.mailchimp.client-runtime-settings-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    settingsRevision,
    acceptedSettingsRevision: settings.acceptedSettingsRevision || null,
    revisionAccepted: settings.revisionAccepted !== false,
    readyForClientRuntime,
    requiredSettingKeys: settings.requiredSettingKeys || [],
    providedSettingKeys: settings.providedSettingKeys || [],
    missingRequiredSettings,
    controls: {
      previewEnabled: controls.previewEnabled === true,
      runtimeStartEnabled: controls.runtimeStartEnabled === true,
      schedulePaused: controls.schedulePaused === true,
      scheduleWindow: controls.scheduleWindow || "runtime",
      scheduleSupported: controls.scheduleSupported !== false,
      runtimeStartBlocked: controls.runtimeStartBlocked === true
    },
    adoption: {
      adoptionId: clientRuntimeAdoption.adoptionId || settings.adoption?.adoptionId || null,
      status: clientRuntimeAdoption.status || settings.adoption?.status || "unknown",
      readyForClientRuntime: clientRuntimeAdoption.readyForClientRuntime === true,
      missingStateKeys: clientRuntimeAdoption.missingStateKeys || settings.adoption?.missingStateKeys || [],
      pendingAckKeys: clientRuntimeAdoption.commandAck?.pendingKeys || settings.adoption?.pendingAckKeys || []
    },
    validationSummary: {
      ...(settings.validationSummary || {}),
      missingRequiredSettings: missingRequiredSettings.length,
      revisionAccepted: settings.revisionAccepted !== false,
      adoptionReady: clientRuntimeAdoption.readyForClientRuntime === true,
      diagnosticIds: settings.diagnosticIds || []
    },
    clientPatch: {
      ...(settings.clientPatch || {}),
      mailchimpClientSettingsStatus: status,
      mailchimpClientSettingsRevision: settingsRevision,
      mailchimpClientSettingsNextAction: nextAction,
      clientRuntimeReadyWithSettings: readyForClientRuntime
    },
    restartSemantics: settings.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-settings-revision",
      resumeFromSettingsRevision: settingsRevision,
      externalWritesPerformed: false
    },
    nextAction
  };
}

function summarizeClientStatusHandoff(job, diagnosticEmission, clientRuntimeAdoption, clientRuntimeSettings) {
  const handoff = diagnosticEmission.clientStatusHandoff || {};
  const route = handoff.route || {};
  const ledger = handoff.statusLedger || {};
  const commandAck = handoff.commandAck || {};
  const blocking = handoff.blocking || {};
  const pendingAckKeys = uniqueSorted(commandAck.pendingKeys || []);
  const status = handoff.status
    || (blocking.runtimeBlocked
      ? "blocked"
      : pendingAckKeys.length > 0 || ledger.revisionAccepted === false
        ? "waiting-for-client"
        : "ready");
  const nextAction = handoff.nextAction
    || (blocking.resumeMissing
      ? "restore-mailchimp-runtime-resume-token"
      : blocking.staleRevision
        ? "refresh-mailchimp-client-status"
        : pendingAckKeys.length > 0
          ? "acknowledge-mailchimp-client-command"
          : clientRuntimeSettings.nextAction || clientRuntimeAdoption.nextAction || "handoff-to-runtime-adapter");
  const statusId = handoff.statusId
    || `${job.id}:client-status:${status}:${ledger.statusRevision || "missing"}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.client-status-handoff-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    statusId,
    status,
    visibleStatus: handoff.visibleStatus || status,
    readyForClient: handoff.readyForClient === true,
    readyForRuntime: handoff.readyForRuntime === true,
    nextAction,
    route: {
      routeId: route.routeId || `${job.id}:client-status-route`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      method: route.method || "PATCH",
      path: route.path || `/mailchimp/jobs/${job.id}/client-status`,
      idempotencyKey: route.idempotencyKey || `${statusId}:route`.replace(/[^a-zA-Z0-9_.:-]/g, "_")
    },
    statusLedger: {
      resumeToken: ledger.resumeToken || diagnosticEmission.statusLedger?.resumeToken || null,
      statusRevision: ledger.statusRevision || diagnosticEmission.statusLedger?.statusRevision || null,
      acceptedStatusRevision: ledger.acceptedStatusRevision || null,
      revisionAccepted: ledger.revisionAccepted !== false,
      readinessStatus: ledger.readinessStatus || diagnosticEmission.status,
      visibleStatus: ledger.visibleStatus || handoff.visibleStatus || status
    },
    commandAck: {
      required: commandAck.required === true || pendingAckKeys.length > 0,
      requiredKeys: uniqueSorted(commandAck.requiredKeys || []),
      pendingKeys: pendingAckKeys,
      acknowledgedKeys: uniqueSorted(commandAck.acknowledgedKeys || []),
      ready: pendingAckKeys.length === 0
    },
    adoption: {
      adoptionId: clientRuntimeAdoption.adoptionId || handoff.adoption?.adoptionId || null,
      status: clientRuntimeAdoption.status || handoff.adoption?.status || "unknown",
      readyForClientRuntime: clientRuntimeAdoption.readyForClientRuntime === true,
      missingStateKeys: uniqueSorted(clientRuntimeAdoption.missingStateKeys || handoff.adoption?.missingStateKeys || [])
    },
    settings: {
      settingsRevision: clientRuntimeSettings.settingsRevision || handoff.settings?.settingsRevision || null,
      status: clientRuntimeSettings.status || handoff.settings?.status || "unknown",
      readyForClientRuntime: clientRuntimeSettings.readyForClientRuntime === true,
      revisionAccepted: clientRuntimeSettings.revisionAccepted !== false,
      missingRequiredSettings: uniqueSorted(clientRuntimeSettings.missingRequiredSettings || handoff.settings?.missingRequiredSettings || [])
    },
    blocking: {
      runtimeBlocked: blocking.runtimeBlocked === true,
      resumeMissing: blocking.resumeMissing === true,
      staleRevision: blocking.staleRevision === true,
      pendingAckKeys,
      missingStateKeys: uniqueSorted(blocking.missingStateKeys || []),
      missingRequiredSettings: uniqueSorted(blocking.missingRequiredSettings || [])
    },
    clientPatch: {
      ...(handoff.clientPatch || {}),
      mailchimpClientStatusId: statusId,
      mailchimpClientVisibleStatus: handoff.visibleStatus || status,
      mailchimpClientStatusNextAction: nextAction,
      mailchimpClientStatusReady: handoff.readyForClient === true,
      mailchimpClientRuntimeReady: handoff.readyForRuntime === true
    },
    restartSemantics: handoff.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-status-route-id",
      resumeFromStatusId: statusId,
      externalWritesPerformed: false
    }
  };
}

function buildHistorySnapshots(job, runtimeSummary, diagnosticEmission, analyticsCounters) {
  const ledger = diagnosticEmission.statusLedger || {};
  const commandCursor = diagnosticEmission.recoveryCommands?.restartCursor || {};
  const failureState = diagnosticEmission.failureState || {};
  const restartReplay = diagnosticEmission.restartReplayLedger || {};
  const exportLedger = diagnosticEmission.exportLedger || {};
  const exportLedgerSnapshots = Array.isArray(exportLedger.historySnapshots)
    ? exportLedger.historySnapshots
    : [];
  const previewExportReadiness = diagnosticEmission.previewExportReadiness || {};
  const previewExportSnapshots = Array.isArray(previewExportReadiness.historySnapshots)
    ? previewExportReadiness.historySnapshots
    : [];
  const baseId = `${job.id}:${ledger.statusRevision || diagnosticEmission.status}`;
  const snapshots = [
    {
      id: `${baseId}:compile-status`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: 1,
      phase: "compile-status",
      status: diagnosticEmission.status,
      healthLevel: analyticsCounters.status.healthCandidate,
      nextAction: diagnosticEmission.recovery?.nextAction || "handoff-to-runtime-adapter",
      resumeToken: ledger.resumeToken || `${job.id}:${diagnosticEmission.status}`,
      statusRevision: ledger.statusRevision || baseId,
      counters: {
        diagnostics: analyticsCounters.totals.diagnostics,
        errors: analyticsCounters.diagnostics.errors,
        warnings: analyticsCounters.diagnostics.warnings
      }
    },
    {
      id: `${baseId}:runtime-handoff`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: 2,
      phase: "runtime-handoff",
      status: runtimeSummary.acceptedForRuntime ? "accepted" : "pending",
      healthLevel: runtimeSummary.acceptedForRuntime ? "healthy" : analyticsCounters.status.healthCandidate,
      nextAction: commandCursor.nextAction || runtimeSummary.nextAction,
      resumeToken: ledger.resumeToken || `${job.id}:${diagnosticEmission.status}`,
      statusRevision: ledger.statusRevision || baseId,
      counters: {
        recoveryCommands: analyticsCounters.totals.recoveryCommands,
        blockingCommands: analyticsCounters.runtimeRisk.blockingCommands,
        approvalCommands: analyticsCounters.runtimeRisk.approvalCommands
      }
    },
    {
      id: `${baseId}:failure-state`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: 3,
      phase: "failure-state",
      status: failureState.mode || "ready",
      healthLevel: failureState.mode === "blocked"
        ? "unhealthy"
        : failureState.mode === "degraded"
          ? "degraded"
          : analyticsCounters.status.healthCandidate,
      nextAction: failureState.adapterHandoff?.nextAction || runtimeSummary.nextAction,
      resumeToken: ledger.resumeToken || `${job.id}:${diagnosticEmission.status}`,
      statusRevision: ledger.statusRevision || baseId,
      counters: {
        failureStates: failureState.summary?.total || 0,
        retryableFailures: failureState.summary?.retryable || 0,
        blockingFailures: failureState.summary?.blocking || 0,
        nextRetryBackoffMs: failureState.nextRetry?.backoffMs || 0
      }
    },
    {
      id: `${baseId}:restart-replay`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: 4,
      phase: "restart-replay",
      status: restartReplay.status || "unknown",
      healthLevel: restartReplay.status === "blocked"
        ? "unhealthy"
        : restartReplay.status === "waiting-for-client" || restartReplay.status === "degraded"
          ? "degraded"
          : analyticsCounters.status.healthCandidate,
      nextAction: restartReplay.nextAction || runtimeSummary.nextAction,
      resumeToken: restartReplay.resumeToken || ledger.resumeToken || `${job.id}:${diagnosticEmission.status}`,
      statusRevision: restartReplay.statusRevision || ledger.statusRevision || baseId,
      counters: {
        replayRows: restartReplay.counters?.rows || 0,
        unsafeRows: restartReplay.counters?.unsafe || 0,
        ackRequiredRows: restartReplay.counters?.ackRequired || 0,
        blockedRows: restartReplay.counters?.blocked || 0
      }
    }
  ];
  const normalizedExportSnapshots = exportLedgerSnapshots.map((snapshot, index) => ({
    id: snapshot.id,
    order: snapshots.length + index + 1,
    phase: `diagnostic-export-${snapshot.phase || "ledger"}`,
    status: snapshot.status || exportLedger.status || "unknown",
    healthLevel: snapshot.status === "blocked"
      ? "unhealthy"
      : snapshot.status === "waiting" || snapshot.status === "retryable" || snapshot.status === "needs-operator-action"
        ? "degraded"
        : analyticsCounters.status.healthCandidate,
    nextAction: snapshot.nextAction || exportLedger.nextAction || runtimeSummary.nextAction,
    resumeToken: snapshot.resumeToken || exportLedger.resumeToken || ledger.resumeToken || `${job.id}:${diagnosticEmission.status}`,
    statusRevision: snapshot.statusRevision || exportLedger.statusRevision || ledger.statusRevision || baseId,
    counters: snapshot.counters || {}
  }));
  const normalizedPreviewExportSnapshots = previewExportSnapshots.map((snapshot, index) => ({
    id: snapshot.id,
    order: snapshots.length + normalizedExportSnapshots.length + index + 1,
    phase: `preview-export-${snapshot.phase || "readiness"}`,
    status: snapshot.status || previewExportReadiness.status || "unknown",
    healthLevel: snapshot.status === "blocked"
      ? "unhealthy"
      : snapshot.status === "waiting" || snapshot.status === "needs-operator-action"
        ? "degraded"
        : analyticsCounters.status.healthCandidate,
    nextAction: snapshot.nextAction || previewExportReadiness.nextAction || runtimeSummary.nextAction,
    resumeToken: snapshot.resumeToken || previewExportReadiness.resumeToken || ledger.resumeToken || `${job.id}:${diagnosticEmission.status}`,
    statusRevision: snapshot.statusRevision || previewExportReadiness.statusRevision || ledger.statusRevision || baseId,
    counters: snapshot.counters || {}
  }));

  return [
    ...snapshots,
    ...normalizedExportSnapshots,
    ...normalizedPreviewExportSnapshots
  ];
}

function buildExportReadySummary(job, runtimeSummary, diagnosticEmission, analyticsCounters, historySnapshots) {
  const ledger = diagnosticEmission.statusLedger || {};
  const latestSnapshot = historySnapshots.at(-1) || {};
  const providerService = diagnosticEmission.providerServiceContract || {};
  const exportLedger = diagnosticEmission.exportLedger || {};
  return {
    schemaVersion: "aios.mailchimp.export-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    task: job.task,
    status: diagnosticEmission.status,
    runtimeAdapter: runtimeSummary.adapter,
    readyForExport: diagnosticEmission.status !== "blocked",
    readyForRuntimeStart: runtimeSummary.acceptedForRuntime === true
      && diagnosticEmission.status === "ready"
      && runtimeSummary.statusControls.canStartRuntime === true,
    resumeToken: ledger.resumeToken || `${job.id}:${diagnosticEmission.status}`,
    statusRevision: ledger.statusRevision || `${job.id}:${diagnosticEmission.status}`,
    latestSnapshotId: latestSnapshot.id || null,
    recommendedArtifacts: [
      "job-descriptor.json",
      "runtime-handoff.json",
      "diagnostics.json",
      "metadata.json",
      "provider-service-handoff.json",
      "client-command-leases.json",
      "persisted-state.json",
      "command-journal.json",
      "status-snapshot.json",
      "diagnostic-export-ledger.json",
      "restart-checkpoint-manifest.json"
      ,
      "restart-replay-ledger.json"
    ],
    providerService: {
      status: providerService.status || "unknown",
      providerService: providerService.providerService || null,
      handoffReady: providerService.externalHandoff?.ready === true,
      syncHandoffReady: providerService.syncMetadata?.syncHandoffReady === true,
      unnegotiatedCapabilities: providerService.capabilityNegotiation?.unnegotiated || []
    },
    headlineCounters: {
      diagnostics: analyticsCounters.totals.diagnostics,
      errors: analyticsCounters.diagnostics.errors,
      warnings: analyticsCounters.diagnostics.warnings,
      recoveryCommands: analyticsCounters.totals.recoveryCommands,
      clientCommandLeases: analyticsCounters.totals.clientCommandLeases,
      failureStates: analyticsCounters.totals.failureStates,
      restartCheckpoints: analyticsCounters.totals.restartCheckpoints,
      restartReplayRows: diagnosticEmission.restartReplayLedger?.counters?.rows || 0,
      diagnosticExportLedgerRows: analyticsCounters.totals.diagnosticExportLedgerRows || 0,
      retryableCommands: analyticsCounters.runtimeRisk.retryableCommands
    },
    diagnosticExportLedger: {
      artifactName: "diagnostic-export-ledger.json",
      ready: exportLedger.exportReady === true,
      status: exportLedger.status || "unknown",
      resumeToken: exportLedger.resumeToken || null,
      statusRevision: exportLedger.statusRevision || null,
      rowCount: exportLedger.rows?.length || 0,
      nextAction: exportLedger.nextAction || null
    },
    previewExportReadiness: {
      artifactName: "preview-export-readiness.json",
      ready: diagnosticEmission.previewExportReadiness?.exportReady === true,
      status: diagnosticEmission.previewExportReadiness?.status || "unknown",
      resumeToken: diagnosticEmission.previewExportReadiness?.resumeToken || null,
      statusRevision: diagnosticEmission.previewExportReadiness?.statusRevision || null,
      rowCount: diagnosticEmission.previewExportReadiness?.rows?.length || 0,
      nextAction: diagnosticEmission.previewExportReadiness?.nextAction || null
    },
    nextAction: diagnosticEmission.recovery?.nextAction || "handoff-to-runtime-adapter"
  };
}

function buildExportArtifactState(job, diagnosticEmission, runtimeSummary, providerServiceSummary, clientCommandLeases, exportSummary) {
  const commandLeaseBlocked = clientCommandLeases.blockingCount > 0 || clientCommandLeases.leaseStatus === "blocked";
  const providerBlocked = providerServiceSummary.status === "blocked"
    || providerServiceSummary.capabilityNegotiation.complete !== true
    || providerServiceSummary.externalHandoff.ready !== true && providerServiceSummary.externalHandoff.required === true;
  const runtimeBlocked = exportSummary.readyForRuntimeStart !== true;
  const diagnosticBlocked = diagnosticEmission.status === "blocked"
    || (diagnosticEmission.counts?.bySeverity?.error || 0) > 0;
  const restartCheckpointBlocked = diagnosticEmission.restartCheckpointManifest?.readyForColdRestart !== true;
  const artifacts = [
    {
      id: "metadata",
      name: "metadata.json",
      category: "compiler",
      required: true,
      ready: diagnosticBlocked === false,
      reason: diagnosticBlocked ? "diagnostic errors block metadata export" : "metadata is deterministic"
    },
    {
      id: "diagnostics",
      name: "diagnostics.json",
      category: "compiler",
      required: true,
      ready: diagnosticEmission.counts?.total >= 0,
      reason: "diagnostic counters and actionable errors are emitted"
    },
    {
      id: "runtime-handoff",
      name: "runtime-handoff.json",
      category: "runtime",
      required: true,
      ready: runtimeBlocked === false,
      reason: runtimeBlocked ? "runtime start gates are not fully released" : "runtime handoff can start"
    },
    {
      id: "provider-service-handoff",
      name: "provider-service-handoff.json",
      category: "provider",
      required: providerServiceSummary.externalHandoff.required === true,
      ready: providerBlocked === false,
      reason: providerBlocked ? "provider service contract is not ready" : "provider handoff is ready or optional"
    },
    {
      id: "client-command-leases",
      name: "client-command-leases.json",
      category: "client",
      required: clientCommandLeases.ackRequired === true || clientCommandLeases.blockingCount > 0,
      ready: commandLeaseBlocked === false,
      reason: commandLeaseBlocked ? "client command lease blocks runtime start" : "client command leases are replay-safe"
    },
    {
      id: "status-snapshot",
      name: "status-snapshot.json",
      category: "history",
      required: true,
      ready: Boolean(diagnosticEmission.statusLedger?.resumeToken || job.id),
      reason: "status snapshot includes resume token and status revision"
    },
    {
      id: "diagnostic-export-ledger",
      name: "diagnostic-export-ledger.json",
      category: "history",
      required: true,
      ready: diagnosticEmission.exportLedger?.exportReady === true
        && Boolean(diagnosticEmission.exportLedger?.resumeToken),
      reason: diagnosticEmission.exportLedger?.exportReady === true
        ? "diagnostic export ledger is replay-safe and ready"
        : "diagnostic export ledger has blocked or waiting rows"
    },
    {
      id: "restart-checkpoint-manifest",
      name: "restart-checkpoint-manifest.json",
      category: "recovery",
      required: true,
      ready: restartCheckpointBlocked === false,
      reason: restartCheckpointBlocked
        ? "restart checkpoint manifest has missing required checkpoints"
        : "restart checkpoint manifest can resume cold restart deterministically"
    },
    {
      id: "analytics-summary",
      name: "analytics-summary.json",
      category: "analytics",
      required: true,
      ready: true,
      reason: "analytics counters are local and deterministic"
    }
  ];

  return artifacts.map((artifact, index) => ({
    order: index + 1,
    ...artifact,
    state: artifact.ready
      ? "ready"
      : artifact.required
        ? "blocked"
        : "optional-unready",
    idempotencyKey: `${job.id}:metadata-export:${artifact.id}:${artifact.ready ? "ready" : "blocked"}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    runtimeAdapter: runtimeSummary.adapter
  }));
}

function buildReportingTimeline(job, historySnapshots, artifactState, analyticsCounters, diagnosticEmission) {
  const artifactBlocked = artifactState.filter((artifact) => artifact.state === "blocked");
  const latestSnapshot = historySnapshots.at(-1) || {};
  const statusLedger = diagnosticEmission.statusLedger || {};
  const reportingRows = [
    ...historySnapshots.map((snapshot) => ({
      id: snapshot.id,
      order: snapshot.order,
      phase: snapshot.phase,
      source: "status-ledger",
      status: snapshot.status,
      healthLevel: snapshot.healthLevel,
      nextAction: snapshot.nextAction,
      resumeToken: snapshot.resumeToken,
      statusRevision: snapshot.statusRevision,
      counters: snapshot.counters
    })),
    {
      id: `${job.id}:export-artifacts:${artifactBlocked.length}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      order: historySnapshots.length + 1,
      phase: "export-artifacts",
      source: "metadata-emitter",
      status: artifactBlocked.length > 0 ? "blocked" : "ready",
      healthLevel: artifactBlocked.length > 0 ? "degraded" : analyticsCounters.status.healthCandidate,
      nextAction: artifactBlocked.length > 0
        ? "repair-metadata-export-artifacts"
        : diagnosticEmission.recovery?.nextAction || "handoff-to-runtime-adapter",
      resumeToken: statusLedger.resumeToken || latestSnapshot.resumeToken || `${job.id}:${diagnosticEmission.status}`,
      statusRevision: statusLedger.statusRevision || latestSnapshot.statusRevision || `${job.id}:${diagnosticEmission.status}`,
      counters: {
        artifacts: artifactState.length,
        readyArtifacts: artifactState.filter((artifact) => artifact.ready).length,
        blockedArtifacts: artifactBlocked.length
      }
    }
  ];

  return {
    schemaVersion: "aios.mailchimp.reporting-timeline.v1",
    provider: "mailchimp",
    jobId: job.id,
    rowCount: reportingRows.length,
    latestRowId: reportingRows.at(-1)?.id || null,
    blockedRows: reportingRows.filter((row) => row.status === "blocked").map((row) => row.id),
    rows: reportingRows
  };
}

function buildAnalyticsExportReport(job, diagnosticEmission, analyticsCounters, exportSummary, providerServiceSummary, artifactState, reportingTimeline) {
  const requiredArtifacts = artifactState.filter((artifact) => artifact.required);
  const blockedRequiredArtifacts = requiredArtifacts.filter((artifact) => artifact.state === "blocked");
  const providerActions = [
    ...providerServiceSummary.capabilityNegotiation.unnegotiated.map((capability) => `negotiate:${capability}`),
    ...(providerServiceSummary.externalHandoff.ready ? [] : [providerServiceSummary.clientState.nextAction]),
  ].filter(Boolean);
  const ready = exportSummary.readyForExport === true
    && blockedRequiredArtifacts.length === 0
    && diagnosticEmission.status !== "blocked";
  const reportId = `${job.id}:analytics-export:${diagnosticEmission.status}:${blockedRequiredArtifacts.length}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const exportLedger = diagnosticEmission.exportLedger || {};

  return {
    schemaVersion: "aios.mailchimp.analytics-export-report.v1",
    provider: "mailchimp",
    jobId: job.id,
    reportId,
    generatedFrom: "metadata-emitter",
    ready,
    status: ready
      ? "ready"
      : diagnosticEmission.status === "blocked"
        ? "blocked"
        : "needs-operator-action",
    exportCommand: {
      commandId: `${reportId}:command`,
      idempotencyKey: `${job.id}:analytics-export:${exportSummary.statusRevision}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      action: ready ? "queue-metadata-analytics-export" : "repair-metadata-analytics-export",
      retryable: ready || diagnosticEmission.status !== "blocked",
      replaySafe: true
    },
    artifacts: {
      total: artifactState.length,
      required: requiredArtifacts.length,
      ready: artifactState.filter((artifact) => artifact.ready).length,
      blocked: artifactState.filter((artifact) => artifact.state === "blocked").length,
      blockedRequired: blockedRequiredArtifacts.map((artifact) => artifact.id),
      plan: artifactState
    },
    counters: {
      ...analyticsCounters.totals,
      errors: analyticsCounters.diagnostics.errors,
      warnings: analyticsCounters.diagnostics.warnings,
      externalWriteActions: analyticsCounters.runtimeRisk.externalWriteActions,
      providerSyncMounts: analyticsCounters.runtimeRisk.providerSyncMounts,
      commandAckRequiredLeases: analyticsCounters.runtimeRisk.ackRequiredLeases,
      diagnosticExportLedgerRows: analyticsCounters.totals.diagnosticExportLedgerRows || 0,
      diagnosticExportLedgerBlockedRows: analyticsCounters.runtimeRisk.diagnosticExportLedgerBlockedRows || 0
    },
    diagnosticExportLedger: {
      status: exportLedger.status || "unknown",
      ready: exportLedger.exportReady === true,
      nextAction: exportLedger.nextAction || null,
      resumeToken: exportLedger.resumeToken || null,
      statusRevision: exportLedger.statusRevision || null,
      rowCount: exportLedger.rows?.length || 0,
      historySnapshotIds: exportLedger.exportSummary?.historySnapshotIds || []
    },
    providerActions,
    timeline: {
      rowCount: reportingTimeline.rowCount,
      latestRowId: reportingTimeline.latestRowId,
      blockedRows: reportingTimeline.blockedRows
    },
    statePatch: {
      analyticsExportReportId: reportId,
      analyticsExportReady: ready,
      analyticsExportStatus: ready ? "ready" : "blocked",
      analyticsExportNextAction: ready ? "queue-metadata-analytics-export" : "repair-metadata-analytics-export",
      analyticsExportResumeToken: exportSummary.resumeToken,
      analyticsExportStatusRevision: exportSummary.statusRevision,
      diagnosticExportLedgerReady: exportLedger.exportReady === true,
      diagnosticExportLedgerRows: exportLedger.rows?.length || 0
    }
  };
}

function buildClientExportReadinessCard({
  job,
  diagnosticEmission,
  runtimeSummary,
  preview,
  previewHandoff,
  adapterDispatchReadiness,
  clientRemediation,
  clientWorkflowRepair,
  exportSummary,
  artifactState,
  analyticsExportReport,
  reportingTimeline
}) {
  const requiredArtifacts = artifactState.filter((artifact) => artifact.required);
  const blockedArtifacts = artifactState.filter((artifact) => artifact.state === "blocked");
  const waitingArtifacts = artifactState.filter((artifact) => artifact.state === "optional-unready");
  const acceptance = previewHandoff.acceptance || preview.acceptance || {};
  const acceptanceRequired = acceptance.required === true
    || preview.acceptance?.required === true
    || adapterDispatchReadiness.acceptance?.required === true;
  const acceptanceAccepted = acceptance.accepted === true
    || preview.acceptance?.accepted === true
    || adapterDispatchReadiness.acceptance?.accepted === true;
  const runtimeReady = runtimeSummary.acceptedForRuntime === true
    && adapterDispatchReadiness.ready === true
    && exportSummary.readyForRuntimeStart === true;
  const exportReady = exportSummary.readyForExport === true
    && analyticsExportReport.ready === true
    && blockedArtifacts.length === 0;
  const blockedReasons = uniqueSorted([
    ...blockedArtifacts.map((artifact) => `artifact:${artifact.id}`),
    ...(acceptanceRequired && !acceptanceAccepted ? ["acceptance_required"] : []),
    ...(clientRemediation.readyForClient === true ? [] : [`client_remediation:${clientRemediation.status}`]),
    ...(clientWorkflowRepair.ready === true ? [] : clientWorkflowRepair.blockedReasons || []),
    ...(adapterDispatchReadiness.ready === true ? [] : adapterDispatchReadiness.blockedReasons || []),
    ...(diagnosticEmission.status === "blocked" ? ["metadata_status_blocked"] : [])
  ]);
  const status = exportReady
    ? acceptanceRequired && !acceptanceAccepted
      ? "waiting-for-acceptance"
      : runtimeReady
        ? "ready-for-runtime-export"
        : "ready-for-client-export"
    : blockedReasons.length > 0
      ? "blocked"
      : waitingArtifacts.length > 0
        ? "waiting"
        : "needs-review";
  const nextAction = status === "ready-for-runtime-export"
    ? "queue-metadata-client-export"
    : status === "ready-for-client-export"
      ? "present-metadata-export-preview"
      : status === "waiting-for-acceptance"
        ? "request-preview-acceptance"
        : clientWorkflowRepair.nextAction
          || clientRemediation.nextAction
          || adapterDispatchReadiness.nextAction
          || analyticsExportReport.exportCommand?.action
          || diagnosticEmission.recovery?.nextAction
          || "repair-metadata-client-export";
  const cardId = `${job.id}:client-export-card:${status}:${analyticsExportReport.reportId || "analytics"}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.client-export-readiness-card.v1",
    provider: "mailchimp",
    jobId: job.id,
    cardId,
    status,
    readyForClient: exportReady && blockedReasons.length === 0,
    readyForRuntimeStart: runtimeReady && blockedReasons.length === 0,
    exportReady,
    nextAction,
    route: {
      target: "client-runtime",
      method: "POST",
      path: `/mailchimp/metadata/${encodeURIComponent(job.id || "unknown")}/client-export`,
      idempotencyKey: `${cardId}:route`,
      requiredBodyKeys: acceptanceRequired && !acceptanceAccepted
        ? ["acceptanceToken", "accepted"]
        : ["jobId", "statusRevision"]
    },
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      token: acceptance.token || acceptance.acceptanceToken || preview.acceptance?.acceptanceToken || null,
      acceptedBy: acceptance.acceptedBy || null,
      acceptedAt: acceptance.acceptedAt || null,
      reason: acceptance.reason || (acceptanceRequired ? "metadata export acceptance required" : "")
    },
    validationSummary: {
      status: diagnosticEmission.status,
      errors: diagnosticEmission.counts?.bySeverity?.error || 0,
      warnings: diagnosticEmission.counts?.bySeverity?.warning || 0,
      blockedReasons,
      readyArtifacts: artifactState.filter((artifact) => artifact.ready).length,
      requiredArtifacts: requiredArtifacts.length,
      blockedArtifacts: blockedArtifacts.length,
      waitingArtifacts: waitingArtifacts.length,
      reportingRows: reportingTimeline.rowCount,
      blockedReportingRows: reportingTimeline.blockedRows.length
    },
    artifacts: artifactState.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      category: artifact.category,
      required: artifact.required === true,
      ready: artifact.ready === true,
      state: artifact.state,
      reason: artifact.reason
    })),
    preview: {
      title: preview.title || "Mailchimp metadata export",
      primaryAction: nextAction,
      secondaryAction: exportReady ? "download-client-export-summary" : "review-blocked-export-items",
      visibleStatus: status,
      explain: exportReady
        ? "Client export contains deterministic metadata, analytics counters, and reporting state."
        : "Client export is held until blocked metadata artifacts are resolved."
    },
    clientPatch: {
      metadataClientExportCardId: cardId,
      metadataClientExportStatus: status,
      metadataClientExportReady: exportReady && blockedReasons.length === 0,
      metadataClientExportNextAction: nextAction,
      metadataClientExportBlockedArtifacts: blockedArtifacts.map((artifact) => artifact.id),
      metadataClientExportAcceptanceRequired: acceptanceRequired && !acceptanceAccepted
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-metadata-client-export-card-id",
      resumeFromCardId: cardId,
      statusRevision: exportSummary.statusRevision,
      externalWritesPerformed: false
    }
  };
}

function buildClientExportTimelineState({
  job,
  clientExportReadiness,
  analyticsExportReport,
  previewExportReadiness,
  exportSummary,
  artifactState,
  reportingTimeline
}) {
  const artifactRows = artifactState.map((artifact) => ({
    id: `${job.id}:client-export-artifact:${artifact.id}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    source: "metadata-artifact-state",
    phase: `artifact:${artifact.id}`,
    status: artifact.state,
    ready: artifact.ready === true,
    required: artifact.required === true,
    nextAction: artifact.ready
      ? "include-client-export-artifact"
      : artifact.required
        ? "repair-metadata-export-artifacts"
        : "review-optional-client-export-artifact",
    resumeToken: exportSummary.resumeToken,
    statusRevision: exportSummary.statusRevision,
    blockedReasons: artifact.state === "blocked" ? [`artifact:${artifact.id}`] : [],
    counters: {
      artifacts: 1,
      required: artifact.required === true ? 1 : 0,
      ready: artifact.ready === true ? 1 : 0,
      blocked: artifact.state === "blocked" ? 1 : 0
    }
  }));
  const reportRows = Array.isArray(reportingTimeline.rows)
    ? reportingTimeline.rows.map((row) => ({
      id: row.id,
      source: row.source || "reporting-timeline",
      phase: row.phase,
      status: row.status,
      ready: row.status !== "blocked",
      required: true,
      nextAction: row.nextAction,
      resumeToken: row.resumeToken || exportSummary.resumeToken,
      statusRevision: row.statusRevision || exportSummary.statusRevision,
      blockedReasons: row.status === "blocked" ? [`timeline:${row.phase}`] : [],
      counters: row.counters || {}
    }))
    : [];
  const previewRows = (previewExportReadiness.rows || []).map((row) => ({
    id: row.id || `${job.id}:preview-export:${row.phase || "readiness"}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    source: "preview-export-readiness",
    phase: `preview:${row.phase || "readiness"}`,
    status: row.status || previewExportReadiness.status,
    ready: row.status !== "blocked" && row.status !== "waiting",
    required: true,
    nextAction: row.nextAction || previewExportReadiness.nextAction,
    resumeToken: previewExportReadiness.resumeToken || exportSummary.resumeToken,
    statusRevision: previewExportReadiness.statusRevision || exportSummary.statusRevision,
    blockedReasons: row.status === "blocked" ? [`preview:${row.phase || "readiness"}`] : [],
    counters: row.counters || {}
  }));
  const baseRows = [
    {
      id: `${job.id}:client-export-card:${clientExportReadiness.status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      source: "client-export-readiness",
      phase: "client-export-card",
      status: clientExportReadiness.status,
      ready: clientExportReadiness.readyForClient === true,
      required: true,
      nextAction: clientExportReadiness.nextAction,
      resumeToken: exportSummary.resumeToken,
      statusRevision: exportSummary.statusRevision,
      blockedReasons: clientExportReadiness.validationSummary?.blockedReasons || [],
      counters: {
        blockedArtifacts: clientExportReadiness.validationSummary?.blockedArtifacts || 0,
        waitingArtifacts: clientExportReadiness.validationSummary?.waitingArtifacts || 0
      }
    },
    {
      id: `${job.id}:analytics-export:${analyticsExportReport.status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      source: "analytics-export-report",
      phase: "analytics-export-report",
      status: analyticsExportReport.status,
      ready: analyticsExportReport.ready === true,
      required: true,
      nextAction: analyticsExportReport.exportCommand?.action || "repair-metadata-analytics-export",
      resumeToken: exportSummary.resumeToken,
      statusRevision: exportSummary.statusRevision,
      blockedReasons: analyticsExportReport.artifacts?.blockedRequired?.map((artifact) => `artifact:${artifact}`) || [],
      counters: {
        artifacts: analyticsExportReport.artifacts?.total || 0,
        blocked: analyticsExportReport.artifacts?.blocked || 0,
        blockedRequired: analyticsExportReport.artifacts?.blockedRequired?.length || 0
      }
    }
  ];
  const rows = [...baseRows, ...reportRows, ...previewRows, ...artifactRows]
    .map((row, index) => ({
      ...row,
      order: index + 1,
      clientVisible: row.required === true || row.ready !== true,
      routeState: row.ready === true ? "ready" : row.status === "waiting" ? "waiting" : "needs_attention"
    }));
  const blockedRows = rows.filter((row) => row.ready !== true && row.required === true);
  const waitingRows = rows.filter((row) => row.status === "waiting" || row.status === "needs-operator-action");
  const nextRow = blockedRows[0] || waitingRows[0] || rows.find((row) => row.ready !== true) || rows[0];
  const status = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : clientExportReadiness.readyForRuntimeStart === true
        ? "runtime-ready"
        : "client-ready";

  return {
    schemaVersion: "aios.mailchimp.client-export-timeline-state.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    ready: blockedRows.length === 0,
    readyForClient: clientExportReadiness.readyForClient === true && blockedRows.length === 0,
    readyForRuntimeStart: clientExportReadiness.readyForRuntimeStart === true && blockedRows.length === 0,
    nextAction: status === "runtime-ready"
      ? "queue-metadata-client-export"
      : nextRow?.nextAction || clientExportReadiness.nextAction || "repair-metadata-client-export",
    nextRowId: nextRow?.id || null,
    resumeToken: exportSummary.resumeToken,
    statusRevision: exportSummary.statusRevision,
    counters: {
      rows: rows.length,
      readyRows: rows.filter((row) => row.ready).length,
      blockedRows: blockedRows.length,
      waitingRows: waitingRows.length,
      requiredRows: rows.filter((row) => row.required).length,
      clientVisibleRows: rows.filter((row) => row.clientVisible).length
    },
    rows,
    exportSummary: {
      artifactName: "client-export-timeline-state.json",
      readyForExport: blockedRows.length === 0,
      rowIds: rows.map((row) => row.id),
      blockedRowIds: blockedRows.map((row) => row.id),
      waitingRowIds: waitingRows.map((row) => row.id),
      latestReportingRowId: reportingTimeline.latestRowId || null,
      analyticsReportId: analyticsExportReport.reportId || null
    },
    route: {
      target: "client-runtime",
      method: "POST",
      path: `/mailchimp/metadata/${encodeURIComponent(job.id || "unknown")}/client-export/timeline`,
      idempotencyKey: `${job.id}:client-export-timeline:${exportSummary.statusRevision || status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      requiredBodyKeys: blockedRows.length > 0 ? ["jobId", "repairRowId"] : ["jobId", "statusRevision"]
    },
    clientPatch: {
      metadataClientExportTimelineStatus: status,
      metadataClientExportTimelineReady: blockedRows.length === 0,
      metadataClientExportTimelineNextAction: nextRow?.nextAction || clientExportReadiness.nextAction,
      metadataClientExportTimelineNextRowId: nextRow?.id || null,
      metadataClientExportTimelineBlockedRows: blockedRows.map((row) => row.id)
    },
    restartSemantics: {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-client-export-timeline-revision",
      resumeFromTimelineKey: `${job.id}:client-export-timeline:${exportSummary.statusRevision || status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      externalWritesPerformed: false
    }
  };
}

function buildClientReadinessDecision({
  job,
  diagnosticEmission,
  runtimeSummary,
  preview,
  previewHandoff,
  adapterDispatchReadiness,
  clientRemediation,
  clientWorkflowRepair,
  clientRuntimeAdoption,
  clientRuntimeSettings,
  clientStatusHandoff,
  clientExportReadiness,
  clientExportTimelineState,
  runtimeReleaseControls,
  providerExternalHandoff,
  exportSummary
}) {
  const acceptance = clientExportReadiness.acceptance || previewHandoff.acceptance || preview.acceptance || {};
  const acceptanceRequired = acceptance.required === true
    || previewHandoff.acceptance?.required === true
    || adapterDispatchReadiness.acceptance?.required === true;
  const acceptanceAccepted = acceptance.accepted === true
    || previewHandoff.acceptance?.status === "accepted"
    || adapterDispatchReadiness.acceptance?.accepted === true;
  const runtimeBlocked = runtimeSummary.acceptedForRuntime !== true
    || runtimeReleaseControls.readyForRuntimeStart !== true
    || adapterDispatchReadiness.dispatchReady !== true
    || providerExternalHandoff.ready !== true;
  const clientBlocked = clientRuntimeAdoption.readyForClientRuntime !== true
    || clientRuntimeSettings.readyForClientRuntime !== true
    || clientStatusHandoff.readyForClient !== true
    || clientRemediation.readyForClient !== true
    || clientWorkflowRepair.ready !== true
    || clientExportReadiness.readyForClient !== true
    || clientExportTimelineState.ready !== true;
  const blockedReasons = uniqueSorted([
    ...(diagnosticEmission.status === "blocked" ? ["metadata_status_blocked"] : []),
    ...(acceptanceRequired && !acceptanceAccepted ? ["acceptance_required"] : []),
    ...(runtimeSummary.acceptedForRuntime === true ? [] : ["runtime_not_accepted"]),
    ...(runtimeReleaseControls.readyForRuntimeStart === true ? [] : [`runtime_release:${runtimeReleaseControls.status}`]),
    ...(adapterDispatchReadiness.dispatchReady === true ? [] : [`adapter_dispatch:${adapterDispatchReadiness.state}`]),
    ...(providerExternalHandoff.ready === true ? [] : [`provider_external_handoff:${providerExternalHandoff.status}`]),
    ...(clientRuntimeAdoption.readyForClientRuntime === true ? [] : [`client_adoption:${clientRuntimeAdoption.status}`]),
    ...(clientRuntimeSettings.readyForClientRuntime === true ? [] : [`client_settings:${clientRuntimeSettings.status}`]),
    ...(clientStatusHandoff.readyForClient === true ? [] : [`client_status:${clientStatusHandoff.status}`]),
    ...(clientRemediation.readyForClient === true ? [] : [`client_remediation:${clientRemediation.status}`]),
    ...(clientWorkflowRepair.ready === true ? [] : uniqueSorted(clientWorkflowRepair.blockedReasons || []).map((reason) => `client_workflow:${reason}`)),
    ...(clientExportReadiness.readyForClient === true ? [] : [`client_export:${clientExportReadiness.status}`]),
    ...(clientExportTimelineState.ready === true ? [] : [`client_export_timeline:${clientExportTimelineState.status}`])
  ]);
  const validationRows = [
    {
      id: "preview-acceptance",
      label: "Preview acceptance",
      ready: !acceptanceRequired || acceptanceAccepted,
      owner: acceptanceRequired && !acceptanceAccepted ? "operator" : "client",
      nextAction: acceptanceRequired && !acceptanceAccepted ? "request-preview-acceptance" : "reuse-preview-acceptance",
      evidence: acceptance.token || previewHandoff.acceptance?.token || null
    },
    {
      id: "client-runtime-state",
      label: "Client runtime state",
      ready: clientRuntimeAdoption.readyForClientRuntime === true && clientRuntimeSettings.readyForClientRuntime === true,
      owner: "client",
      nextAction: clientRuntimeAdoption.readyForClientRuntime === true
        ? clientRuntimeSettings.nextAction
        : clientRuntimeAdoption.nextAction,
      evidence: clientRuntimeAdoption.adoptionId || clientRuntimeSettings.settingsRevision || null
    },
    {
      id: "adapter-dispatch",
      label: "Adapter dispatch",
      ready: adapterDispatchReadiness.dispatchReady === true && providerExternalHandoff.ready === true,
      owner: "runtime",
      nextAction: adapterDispatchReadiness.dispatchReady === true
        ? providerExternalHandoff.nextAction
        : adapterDispatchReadiness.nextAction,
      evidence: adapterDispatchReadiness.readinessKey || providerExternalHandoff.handoffKey || null
    },
    {
      id: "runtime-release",
      label: "Runtime release",
      ready: runtimeReleaseControls.readyForRuntimeStart === true,
      owner: "runtime",
      nextAction: runtimeReleaseControls.nextAction,
      evidence: runtimeReleaseControls.releaseKey || null
    },
    {
      id: "client-export",
      label: "Client export",
      ready: clientExportReadiness.readyForClient === true && clientExportTimelineState.ready === true,
      owner: "client",
      nextAction: clientExportReadiness.readyForClient === true
        ? clientExportTimelineState.nextAction
        : clientExportReadiness.nextAction,
      evidence: clientExportReadiness.cardId || clientExportTimelineState.nextRowId || null
    }
  ];
  const failedRows = validationRows.filter((row) => row.ready !== true);
  const nextRow = failedRows[0] || validationRows[0];
  const status = blockedReasons.length > 0
    ? acceptanceRequired && !acceptanceAccepted
      ? "waiting-for-acceptance"
      : runtimeBlocked
        ? "runtime-blocked"
        : clientBlocked
          ? "client-action-required"
          : "blocked"
    : "ready";
  const decisionId = `${job.id}:client-readiness:${status}:${exportSummary.statusRevision || diagnosticEmission.status}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = status === "ready"
    ? "handoff-to-runtime-adapter"
    : nextRow?.nextAction
      || clientExportReadiness.nextAction
      || clientStatusHandoff.nextAction
      || diagnosticEmission.recovery?.nextAction
      || "repair-client-readiness";

  return {
    schemaVersion: "aios.mailchimp.client-readiness-decision.v1",
    provider: "mailchimp",
    jobId: job.id,
    decisionId,
    status,
    readyForPreview: previewHandoff.readyForAcceptance === true || preview.readyForPreview === true,
    readyForClient: status === "ready" || (clientBlocked === false && acceptanceRequired && !acceptanceAccepted),
    readyForRuntimeStart: status === "ready"
      && runtimeBlocked === false
      && clientExportReadiness.readyForRuntimeStart === true,
    nextAction,
    nextValidationId: nextRow?.id || null,
    blockedReasons,
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      token: acceptance.token || acceptance.acceptanceToken || previewHandoff.acceptance?.token || null,
      reason: acceptance.reason || (acceptanceRequired ? "Preview acceptance is required before runtime start." : "")
    },
    route: {
      target: "client-runtime-readiness",
      method: "POST",
      path: `/mailchimp/metadata/${encodeURIComponent(job.id || "unknown")}/client-readiness`,
      idempotencyKey: `${decisionId}:route`,
      requiredBodyKeys: acceptanceRequired && !acceptanceAccepted
        ? ["decisionId", "acceptanceToken", "accepted"]
        : ["decisionId", "statusRevision"]
    },
    validationSummary: {
      total: validationRows.length,
      ready: validationRows.filter((row) => row.ready).length,
      blocked: failedRows.length,
      runtimeBlocked,
      clientBlocked,
      diagnosticStatus: diagnosticEmission.status,
      errorCount: diagnosticEmission.counts?.bySeverity?.error || 0,
      warningCount: diagnosticEmission.counts?.bySeverity?.warning || 0
    },
    validations: validationRows.map((row) => ({
      id: row.id,
      label: row.label,
      ready: row.ready === true,
      owner: row.owner,
      nextAction: row.nextAction,
      evidence: row.evidence
    })),
    clientPatch: {
      mailchimpClientReadinessDecisionId: decisionId,
      mailchimpClientReadinessStatus: status,
      mailchimpClientReadinessReady: status === "ready",
      mailchimpClientReadinessNextAction: nextAction,
      mailchimpClientReadinessNextValidationId: nextRow?.id || null,
      mailchimpClientReadinessBlockedReasons: blockedReasons,
      mailchimpClientReadinessAcceptanceRequired: acceptanceRequired && !acceptanceAccepted
    },
    restartSemantics: {
      replaySafe: status === "ready" || status === "waiting-for-acceptance",
      duplicateCommandPolicy: "dedupe-by-client-readiness-decision-id",
      resumeFromDecisionId: decisionId,
      statusRevision: exportSummary.statusRevision,
      externalWritesPerformed: false
    }
  };
}

function summarizePreviewExportReadiness(job, diagnosticEmission, exportSummary, reportingTimeline) {
  const readiness = diagnosticEmission.previewExportReadiness || {};
  const rows = Array.isArray(readiness.rows) ? readiness.rows : [];
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const waitingRows = rows.filter((row) => row.status === "waiting" || row.status === "needs-operator-action");
  const ready = readiness.exportReady === true
    && blockedRows.length === 0
    && exportSummary.readyForExport === true;
  const status = readiness.status
    || (blockedRows.length > 0
      ? "blocked"
      : waitingRows.length > 0
        ? "needs-operator-action"
        : "ready");
  const nextRow = blockedRows[0] || waitingRows[0] || rows.find((row) => row.status !== "ready") || null;

  return {
    schemaVersion: "aios.mailchimp.preview-export-readiness-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    ready,
    readyForClientPreview: readiness.readyForClientPreview === true,
    readyForRuntimeStart: readiness.readyForRuntimeStart === true,
    acceptanceToken: readiness.acceptanceToken || null,
    routeId: readiness.routeId || null,
    resumeToken: readiness.resumeToken || exportSummary.resumeToken || null,
    statusRevision: readiness.statusRevision || exportSummary.statusRevision || null,
    nextAction: nextRow?.nextAction
      || readiness.nextAction
      || (ready ? "publish-preview-export-readiness" : "repair-preview-export-readiness"),
    validationSummary: {
      ...(readiness.validationSummary || {}),
      blocked: readiness.validationSummary?.blocked || blockedRows.length,
      waiting: readiness.validationSummary?.waiting || waitingRows.length,
      total: readiness.validationSummary?.total || rows.length
    },
    rows: rows.map((row) => ({
      id: row.id,
      order: row.order,
      phase: row.phase,
      status: row.status,
      nextAction: row.nextAction,
      counters: row.counters || {}
    })),
    exportSummary: {
      artifactName: readiness.exportSummary?.artifactName || "preview-export-readiness.json",
      rowIds: readiness.exportSummary?.rowIds || rows.map((row) => row.id),
      blockedRowIds: readiness.exportSummary?.blockedRowIds || blockedRows.map((row) => row.id),
      waitingRowIds: readiness.exportSummary?.waitingRowIds || waitingRows.map((row) => row.id),
      historySnapshotIds: readiness.exportSummary?.historySnapshotIds || [],
      externalWritesPerformed: false
    },
    timeline: {
      rowCount: reportingTimeline.rowCount,
      latestRowId: reportingTimeline.latestRowId,
      blockedRows: reportingTimeline.blockedRows
    },
    clientPatch: {
      ...(readiness.clientPatch || {}),
      previewExportReadinessSummaryStatus: status,
      previewExportReadinessSummaryReady: ready,
      previewExportReadinessSummaryNextAction: nextRow?.nextAction || readiness.nextAction || "publish-preview-export-readiness"
    },
    restartSemantics: readiness.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-preview-export-readiness-revision",
      resumeToken: readiness.resumeToken || exportSummary.resumeToken || null,
      externalWritesPerformed: false
    }
  };
}

function buildLifecycleClientState(job, diagnosticEmission, runtimeSummary, capabilitySummary) {
  const lifecycle = diagnosticEmission.lifecycleControls || {};
  const permissionGrantPlan = diagnosticEmission.permissionGrantPlan || {};
  const runtimeStart = lifecycle.runtimeStart || {};
  const preview = lifecycle.preview || {};
  const capabilityControls = lifecycle.capabilityControls || {};
  const schedule = lifecycle.schedule || {};
  const disabledRequiredActions = capabilityControls.disabledRequiredActions || [];
  const disabledWriteActions = capabilityControls.disabledWriteActions || [];
  const nextAction = lifecycle.nextAction
    || runtimeSummary.statusControls.nextLifecycleAction
    || diagnosticEmission.recovery?.nextAction
    || "handoff-to-runtime-adapter";
  const controlItems = [
    {
      id: "mailchimp.lifecycle.preview",
      label: "Client preview",
      enabled: preview.enabled === true,
      status: preview.enabled === true ? "enabled" : "disabled",
      required: true,
      disableReason: preview.disableReason || null,
      nextAction: preview.enabled === true ? "accept-preview" : "enable-mailchimp-client-preview"
    },
    {
      id: "mailchimp.lifecycle.runtime-start",
      label: "Runtime start",
      enabled: runtimeStart.enabled === true,
      status: runtimeStart.enabled === true ? "enabled" : lifecycle.status || "needs-operator-action",
      required: true,
      disableReason: runtimeStart.disableReason || null,
      nextAction: runtimeStart.enabled === true ? "handoff-to-runtime-adapter" : nextAction
    },
    {
      id: "mailchimp.lifecycle.schedule",
      label: "Schedule",
      enabled: schedule.supported !== false && schedule.paused !== true,
      status: schedule.supported === false
        ? "blocked"
        : schedule.paused === true
          ? "paused"
          : "enabled",
      required: true,
      disableReason: schedule.supported === false
        ? "unsupported-schedule-window"
        : schedule.paused === true
          ? "schedule-paused"
          : null,
      nextAction: schedule.supported === false
        ? "select-supported-schedule-window"
        : schedule.paused === true
          ? "resume-mailchimp-schedule"
          : "handoff-to-runtime-adapter"
    },
    {
      id: "mailchimp.lifecycle.permission-grants",
      label: "Tenant permission grants",
      enabled: permissionGrantPlan.status !== "blocked",
      status: permissionGrantPlan.status === "blocked" ? "blocked" : permissionGrantPlan.status || "ready",
      required: true,
      disableReason: permissionGrantPlan.status === "blocked" ? "permission-grant-plan-blocked" : null,
      nextAction: permissionGrantPlan.status === "blocked"
        ? permissionGrantPlan.nextAction || "repair-permission-grant-plan"
        : "append-tenant-permission-audit"
    },
    {
      id: "mailchimp.lifecycle.capabilities",
      label: "Required capabilities",
      enabled: disabledRequiredActions.length === 0,
      status: disabledRequiredActions.length ? "blocked" : "enabled",
      required: true,
      disableReason: disabledRequiredActions.length ? "disabled-required-capability" : null,
      nextAction: disabledRequiredActions.length
        ? "enable-required-mailchimp-capability"
        : "handoff-to-runtime-adapter"
    }
  ];

  return {
    schemaVersion: "aios.mailchimp.lifecycle-client-state.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: lifecycle.status || "unknown",
    nextAction,
    previewEnabled: preview.enabled === true,
    runtimeStartEnabled: runtimeStart.enabled === true,
    capabilityEnableControlsVisible: capabilityControls.canEnableDisabledCapabilities === true
      || disabledRequiredActions.length > 0
      || disabledWriteActions.length > 0,
    controls: controlItems,
    disabledActions: {
      required: disabledRequiredActions,
      write: disabledWriteActions,
      all: capabilityControls.disabledActions || capabilitySummary.disabledActions || []
    },
    schedule: {
      requestedWindow: schedule.requestedWindow || runtimeSummary.statusControls.scheduleWindow,
      nextEligibleWindow: schedule.nextEligibleWindow || runtimeSummary.statusControls.scheduleWindow,
      paused: schedule.paused === true,
      resumeAt: schedule.resumeAt || null,
      supported: schedule.supported !== false
    },
    statePatch: {
      workflowPhase: runtimeStart.enabled === true
        ? "ready"
        : lifecycle.status === "blocked"
          ? "repair"
          : "approval",
      primaryAction: nextAction,
      lifecycleStatus: lifecycle.status || "unknown",
      runtimeStartEnabled: runtimeStart.enabled === true,
      runtimeStartDisableReason: runtimeStart.disableReason || null,
      schedulePaused: schedule.paused === true,
      scheduleWindow: schedule.requestedWindow || runtimeSummary.statusControls.scheduleWindow,
      disabledRequiredActions,
      permissionGrantPlanStatus: permissionGrantPlan.status || "unknown",
      permissionGrantBlockingCount: permissionGrantPlan.summary?.blocking || 0,
      idempotencyKey: `${job.id}:lifecycle:${lifecycle.status || "unknown"}:${nextAction}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    }
  };
}

function buildWorkflowControlState(job, {
  lifecycleClientState,
  runtimeReleaseControls,
  adapterDispatchReadiness,
  providerSyncCheckpoint,
  providerServiceSummary,
  diagnosticEmission
}) {
  const lifecyclePatch = lifecycleClientState.statePatch || {};
  const runtimeBlocked = runtimeReleaseControls.readyForRuntimeStart !== true;
  const adapterBlocked = adapterDispatchReadiness.ready !== true;
  const providerBlocked = providerServiceSummary.status === "blocked"
    || providerServiceSummary.externalHandoff?.ready === false;
  const syncBlocked = providerSyncCheckpoint.ready !== true && providerSyncCheckpoint.syncRequired === true;
  const blockedReasons = uniqueSorted([
    ...(runtimeBlocked ? ["runtime_release_not_ready"] : []),
    ...(adapterBlocked ? ["adapter_dispatch_not_ready"] : []),
    ...(providerBlocked ? ["provider_service_not_ready"] : []),
    ...(syncBlocked ? ["provider_sync_checkpoint_not_ready"] : []),
    ...(lifecycleClientState.runtimeStartEnabled === true ? [] : ["lifecycle_runtime_start_disabled"]),
    ...(lifecycleClientState.schedule?.paused === true ? ["lifecycle_schedule_paused"] : []),
    ...(lifecycleClientState.disabledActions?.required || []).map((action) => `capability_disabled:${action}`),
    ...(runtimeReleaseControls.clientPatch?.runtimeReleaseBlockedGateIds || []).map((gateId) => `runtime_gate:${gateId}`),
    ...(adapterDispatchReadiness.blockedReasons || []).map((reason) => `adapter_dispatch:${reason}`)
  ]);
  const waitingReasons = uniqueSorted([
    ...(runtimeReleaseControls.clientPatch?.runtimeReleaseWaitingGateIds || []).map((gateId) => `runtime_gate:${gateId}`),
    ...(providerSyncCheckpoint.status === "needs-operator-action" ? ["provider_sync_operator_action"] : []),
    ...(diagnosticEmission.recovery?.requiredActionCount > 0 ? ["diagnostic_recovery_actions"] : [])
  ]);
  const state = blockedReasons.length > 0
    ? "blocked"
    : waitingReasons.length > 0
      ? "waiting"
      : lifecycleClientState.runtimeStartEnabled === true
        && runtimeReleaseControls.readyForRuntimeStart === true
        && adapterDispatchReadiness.ready === true
        ? "ready"
        : "review";
  const nextAction = state === "ready"
    ? "handoff-to-runtime-adapter"
    : runtimeReleaseControls.nextAction
      || adapterDispatchReadiness.nextAction
      || lifecycleClientState.nextAction
      || providerSyncCheckpoint.nextAction
      || providerServiceSummary.clientState?.nextAction
      || "review-mailchimp-workflow-controls";
  const controlKey = `${job.id}:workflow-controls:${state}:${nextAction}`
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.workflow-control-state.v1",
    provider: "mailchimp",
    jobId: job.id,
    controlKey,
    state,
    readyForClient: state !== "blocked",
    readyForRuntimeStart: state === "ready",
    nextAction,
    primaryAction: nextAction,
    blockedReasons,
    waitingReasons,
    lifecycle: {
      status: lifecycleClientState.status || "unknown",
      runtimeStartEnabled: lifecycleClientState.runtimeStartEnabled === true,
      previewEnabled: lifecycleClientState.previewEnabled === true,
      schedulePaused: lifecycleClientState.schedule?.paused === true,
      scheduleWindow: lifecycleClientState.schedule?.requestedWindow || null,
      disabledRequiredActions: lifecycleClientState.disabledActions?.required || []
    },
    runtimeRelease: {
      status: runtimeReleaseControls.status,
      ready: runtimeReleaseControls.readyForRuntimeStart === true,
      nextGateId: runtimeReleaseControls.nextGateId || null,
      releaseKey: runtimeReleaseControls.releaseKey || null
    },
    adapterDispatch: {
      state: adapterDispatchReadiness.state || "unknown",
      ready: adapterDispatchReadiness.ready === true,
      dispatchReady: adapterDispatchReadiness.dispatchReady === true,
      readinessKey: adapterDispatchReadiness.readinessKey || null
    },
    provider: {
      serviceStatus: providerServiceSummary.status || "unknown",
      serviceReady: providerServiceSummary.externalHandoff?.ready === true,
      syncCheckpointStatus: providerSyncCheckpoint.status || "unknown",
      syncCheckpointReady: providerSyncCheckpoint.ready === true
    },
    clientPatch: {
      workflowControlState: state,
      workflowControlKey: controlKey,
      workflowControlNextAction: nextAction,
      workflowControlBlockedReasons: blockedReasons,
      workflowControlWaitingReasons: waitingReasons,
      ...lifecyclePatch
    },
    restartSemantics: {
      replaySafe: state !== "blocked",
      duplicateCommandPolicy: "dedupe-by-workflow-control-key",
      resumeFromWorkflowControlKey: controlKey,
      externalWritesPerformed: false
    }
  };
}

function previewSectionStatus(diagnosticEmission, runtimeSummary, capabilitySummary, memorySummary) {
  const errors = diagnosticEmission.counts?.bySeverity?.error || 0;
  const warnings = diagnosticEmission.counts?.bySeverity?.warning || 0;
  const controls = runtimeSummary.statusControls || {};
  const lifecycleControls = diagnosticEmission.lifecycleControls || {};

  return {
    sourceReady: errors === 0,
    previewReady: errors === 0
      && runtimeSummary.acceptedForClientPreview !== false
      && lifecycleControls.preview?.enabled !== false,
    runtimeReady: errors === 0
      && warnings === 0
      && runtimeSummary.acceptedForRuntime === true
      && controls.canStartRuntime === true
      && lifecycleControls.runtimeStart?.enabled === true,
    approvalReady: controls.requiresApprovalBeforeExternalWrite !== true
      || capabilitySummary.approvalActions.length > 0,
    syncReady: memorySummary.syncRequired === false || memorySummary.providerSyncMounts.length > 0
  };
}

function buildAcceptanceChecklist(job, diagnosticEmission, runtimeSummary, capabilitySummary, memorySummary) {
  const sectionStatus = previewSectionStatus(diagnosticEmission, runtimeSummary, capabilitySummary, memorySummary);
  const visibleDiagnostics = diagnosticEmission.diagnostics
    .filter((diagnostic) => diagnostic.userVisible && diagnostic.severity !== "info");
  const approvalRequired = runtimeSummary.statusControls.requiresApprovalBeforeExternalWrite === true
    || capabilitySummary.requiresApproval === true;
  const checklist = [
    {
      id: "mailchimp.preview.source",
      label: "Source compiles to a Mailchimp kernel job",
      status: sectionStatus.sourceReady ? "accepted" : "blocked",
      required: true,
      evidence: {
        jobId: job.id,
        diagnosticCount: diagnosticEmission.counts?.total || 0,
        blockingDiagnosticCount: diagnosticEmission.counts?.bySeverity?.error || 0
      },
      nextAction: sectionStatus.sourceReady
        ? "review-preview"
        : diagnosticEmission.recovery?.nextAction || "repair-compile-contract"
    },
    {
      id: "mailchimp.preview.client",
      label: "Client preview can render without external Mailchimp writes",
      status: sectionStatus.previewReady ? "accepted" : "blocked",
      required: true,
      evidence: {
        acceptedForClientPreview: runtimeSummary.acceptedForClientPreview,
        previewEnabled: diagnosticEmission.clientWorkflow?.previewEnabled === true,
        externalWrites: false
      },
      nextAction: sectionStatus.previewReady
        ? "accept-preview"
        : "repair-runtime-handoff"
    },
    {
      id: "mailchimp.preview.approval",
      label: "External-write approval gate is visible before runtime start",
      status: approvalRequired
        ? capabilitySummary.approvalActions.length > 0 ? "needs-operator-action" : "blocked"
        : "accepted",
      required: approvalRequired,
      evidence: {
        approvalRequired,
        approvalActions: capabilitySummary.approvalActions,
        writeActions: capabilitySummary.writeActions
      },
      nextAction: approvalRequired
        ? "collect-human-approval"
        : "handoff-to-runtime-adapter"
    },
    {
      id: "mailchimp.preview.provider-sync",
      label: "Provider sync mounts and capability scopes are declared",
      status: sectionStatus.syncReady ? "accepted" : "needs-operator-action",
      required: memorySummary.syncRequired === true,
      evidence: {
        syncRequired: memorySummary.syncRequired,
        providerSyncMounts: memorySummary.providerSyncMounts,
        requiredScopes: capabilitySummary.requiredScopes
      },
      nextAction: sectionStatus.syncReady
        ? "handoff-to-runtime-adapter"
        : "declare-provider-sync-memory"
    },
    {
      id: "mailchimp.preview.runtime-start",
      label: "Runtime start is enabled after preview acceptance",
      status: sectionStatus.runtimeReady
        ? "accepted"
        : visibleDiagnostics.length > 0 ? "needs-operator-action" : "pending",
      required: true,
      evidence: {
        acceptedForRuntime: runtimeSummary.acceptedForRuntime,
        canStartRuntime: runtimeSummary.statusControls.canStartRuntime,
        visibleDiagnosticIds: visibleDiagnostics.map((diagnostic) => diagnostic.id)
      },
      nextAction: sectionStatus.runtimeReady
        ? "handoff-to-runtime-adapter"
        : visibleDiagnostics[0]?.recoveryAction || runtimeSummary.nextAction
    }
  ];
  const required = checklist.filter((item) => item.required);
  const blocked = checklist.filter((item) => item.status === "blocked");
  const pending = checklist.filter((item) => item.status === "pending" || item.status === "needs-operator-action");

  return {
    schemaVersion: "aios.mailchimp.preview-acceptance.v1",
    provider: "mailchimp",
    jobId: job.id,
    status: blocked.length > 0
      ? "blocked"
      : pending.length > 0
        ? "needs-operator-action"
        : "accepted",
    accepted: blocked.length === 0
      && required.every((item) => item.status === "accepted" || item.status === "needs-operator-action" && item.id === "mailchimp.preview.approval"),
    previewEnabled: sectionStatus.previewReady,
    runtimeStartEnabledAfterAcceptance: sectionStatus.runtimeReady,
    acceptanceToken: `${job.id}:${diagnosticEmission.status}:${checklist.map((item) => `${item.id}:${item.status}`).join("|")}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    checklist,
    validationSummary: {
      total: checklist.length,
      required: required.length,
      accepted: checklist.filter((item) => item.status === "accepted").length,
      blocked: blocked.length,
      pending: pending.length,
      warningDiagnostics: diagnosticEmission.counts?.bySeverity?.warning || 0,
      blockingDiagnostics: diagnosticEmission.counts?.bySeverity?.error || 0
    },
    nextStep: blocked[0]?.nextAction
      || pending[0]?.nextAction
      || "accept-preview-and-start-runtime",
    clientPatch: {
      workflowPhase: diagnosticEmission.clientWorkflow?.phase || "ready",
      banner: diagnosticEmission.clientWorkflow?.banner || "Mailchimp setup is ready for preview.",
      primaryAction: blocked[0]?.nextAction || pending[0]?.nextAction || "accept-preview",
      previewAccepted: blocked.length === 0 && pending.length === 0,
      acceptanceTokenRequired: true,
      acceptanceToken: `${job.id}:${diagnosticEmission.status}:${required.length}:${blocked.length}:${pending.length}`
    }
  };
}

function buildPreviewEnvelope(job, capabilitySummary, memorySummary, verifierSummary, runtimeSummary, diagnosticEmission, exportSummary) {
  const visibleDiagnostics = actionableErrorsFrom(diagnosticEmission);
  const acceptance = buildAcceptanceChecklist(
    job,
    diagnosticEmission,
    runtimeSummary,
    capabilitySummary,
    memorySummary
  );

  return {
    schemaVersion: "aios.mailchimp.preview.v1",
    provider: "mailchimp",
    jobId: job.id,
    title: verifierSummary.previewTitle,
    status: acceptance.status,
    readyForPreview: acceptance.previewEnabled,
    readyForRuntimeStart: exportSummary.readyForRuntimeStart && acceptance.runtimeStartEnabledAfterAcceptance,
    acceptance,
    summaryCards: [
      {
        id: "mailchimp.preview.capabilities",
        label: "Capabilities",
        value: capabilitySummary.count,
        detail: `${capabilitySummary.writeActions.length} external-write action(s)`
      },
      {
        id: "mailchimp.preview.memory",
        label: "Memory",
        value: memorySummary.count,
        detail: memorySummary.syncRequired ? "provider sync declared" : "local memory only"
      },
      {
        id: "mailchimp.preview.verifier",
        label: "Verifier",
        value: verifierSummary.count,
        detail: `${verifierSummary.blockingRuleIds.length} blocking rule(s)`
      },
      {
        id: "mailchimp.preview.diagnostics",
        label: "Diagnostics",
        value: diagnosticEmission.counts?.total || 0,
        detail: `${diagnosticEmission.counts?.bySeverity?.error || 0} blocking`
      }
    ],
    visibleDiagnostics,
    explainNextStep: {
      action: acceptance.nextStep,
      reason: acceptance.validationSummary.blocked > 0
        ? "preview-blocked"
        : acceptance.validationSummary.pending > 0
          ? "operator-action-pending"
          : "preview-accepted",
      resumeToken: exportSummary.resumeToken,
      statusRevision: exportSummary.statusRevision
    }
  };
}

function buildScopedClientWorkflow(job, diagnosticEmission, preview, lifecycleClientState, clientCommandLeases) {
  const workflow = diagnosticEmission.clientWorkflow || {};
  const boundary = diagnosticEmission.permissionBoundary || {};
  const validationSummary = workflow.validationSummary || {};
  const validationItems = Array.isArray(workflow.validationItems) ? workflow.validationItems : [];
  const safeBoundary = boundary.safeBoundary === true;
  const scopedStatus = safeBoundary === false
    ? "blocked"
    : workflow.status || diagnosticEmission.status;
  const primaryAction = safeBoundary === false
    ? boundary.nextAction || "repair-permission-boundary"
    : workflow.explainNextStep?.action || workflow.primaryAction || diagnosticEmission.recovery?.nextAction;
  const workflowKey = [
    job.id,
    boundary.isolationKey || "tenant.local_workspace.local",
    scopedStatus,
    primaryAction,
    validationSummary.blocked || 0,
    validationSummary.pending || 0
  ].join(":").replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const leasePatch = clientCommandLeases?.clientPatch || {};

  return {
    schemaVersion: "aios.mailchimp.scoped-client-workflow.v1",
    provider: "mailchimp",
    jobId: job.id,
    tenant: {
      tenantId: boundary.tenantId || "tenant.local",
      workspaceId: boundary.workspaceId || "workspace.local",
      isolationKey: boundary.isolationKey || "tenant.local:workspace.local",
      safeBoundary,
      allowedRoles: boundary.allowedRoles || [],
      missingRoles: boundary.missingRoles || [],
      deniedScopes: boundary.deniedScopes || []
    },
    status: scopedStatus,
    phase: safeBoundary ? workflow.phase || "preflight" : "repair",
    severity: safeBoundary ? workflow.severity || "info" : "error",
    banner: safeBoundary
      ? workflow.banner || "Mailchimp setup is ready for preview."
      : "Mailchimp setup needs tenant or workspace boundary repair before preview.",
    primaryAction,
    preview: {
      readyForPreview: safeBoundary && preview.readyForPreview === true,
      readyForRuntimeStart: safeBoundary && preview.readyForRuntimeStart === true,
      acceptanceToken: preview.acceptance?.acceptanceToken || null,
      acceptanceStatus: preview.acceptance?.status || "unknown"
    },
    lifecycle: {
      status: lifecycleClientState.status || "unknown",
      runtimeStartEnabled: safeBoundary && lifecycleClientState.runtimeStartEnabled === true,
      nextAction: lifecycleClientState.nextAction || primaryAction
    },
    validationSummary: {
      total: validationSummary.total || validationItems.length,
      accepted: validationSummary.accepted || validationItems.filter((item) => item.status === "accepted").length,
      blocked: safeBoundary ? validationSummary.blocked || 0 : (validationSummary.blocked || 0) + 1,
      pending: validationSummary.pending || 0,
      required: validationSummary.required || validationItems.filter((item) => item.required).length,
      blockingDiagnostics: validationSummary.blockingDiagnostics || diagnosticEmission.counts?.bySeverity?.error || 0,
      warningDiagnostics: validationSummary.warningDiagnostics || diagnosticEmission.counts?.bySeverity?.warning || 0
    },
    validationItems: [
      ...validationItems,
      ...safeBoundary ? [] : [{
        id: "mailchimp.workflow.tenant-boundary",
        label: "Tenant and workspace boundary is safe",
        status: "blocked",
        required: true,
        nextAction: boundary.nextAction || "repair-permission-boundary",
        evidence: {
          tenantId: boundary.tenantId || null,
          workspaceId: boundary.workspaceId || null,
          isolationKey: boundary.isolationKey || null,
          diagnosticIds: boundary.diagnosticIds || []
        }
      }]
    ],
    explainNextStep: {
      action: primaryAction,
      reason: safeBoundary
        ? workflow.explainNextStep?.reason || preview.explainNextStep?.reason || "workflow-ready"
        : "tenant-boundary-blocked",
      resumeToken: diagnosticEmission.statusLedger?.resumeToken || null,
      statusRevision: diagnosticEmission.statusLedger?.statusRevision || null,
      isolationKey: boundary.isolationKey || null,
      commandLeaseId: clientCommandLeases?.primaryLeaseId || null,
      commandAckRequired: clientCommandLeases?.ackRequired === true,
      commandAckKey: clientCommandLeases?.ackKeys?.[0] || null
    },
    statePatch: {
      ...(workflow.statePatch || {}),
      ...leasePatch,
      scopedWorkflowId: workflowKey,
      tenantIsolationKey: boundary.isolationKey || null,
      safeBoundary,
      primaryAction,
      previewAcceptanceToken: preview.acceptance?.acceptanceToken || null
    }
  };
}

function summarizePreviewHandoff(job, diagnosticEmission, preview, clientWorkflow, lifecycleClientState) {
  const source = diagnosticEmission.previewHandoff || {};
  const gates = Array.isArray(source.gates) ? source.gates : [];
  const blockedGates = gates.filter((gate) => gate.status === "blocked");
  const pendingGates = gates.filter((gate) => gate.status === "needs-operator-action");
  const status = source.status
    || (blockedGates.length > 0
      ? "blocked"
      : pendingGates.length > 0
        ? "needs-operator-action"
        : preview.readyForPreview === true
          ? "ready"
          : "waiting");
  const routeId = source.routeId
    || `${job.id}:preview-route:${clientWorkflow.tenant?.isolationKey || "tenant.local_workspace.local"}:${status}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const acceptanceToken = source.acceptance?.token
    || preview.acceptance?.acceptanceToken
    || `${routeId}:acceptance`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = source.primaryAction
    || source.explainNextStep?.action
    || clientWorkflow.primaryAction
    || preview.explainNextStep?.action
    || "handoff-to-runtime-adapter";

  return {
    schemaVersion: "aios.mailchimp.preview-handoff-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    routeId,
    status,
    visible: source.visible === true || (preview.readyForPreview === true && clientWorkflow.tenant?.safeBoundary === true),
    readyForAcceptance: source.readyForAcceptance === true
      || (status !== "blocked" && preview.acceptance?.status !== "blocked"),
    readyForRuntimeStart: source.readyForRuntimeStart === true
      || (preview.readyForRuntimeStart === true && lifecycleClientState.runtimeStartEnabled === true),
    primaryAction: nextAction,
    routePayload: source.routePayload || {
      method: "POST",
      path: `/mailchimp/jobs/${job.id}/preview/acceptance`,
      idempotencyKey: acceptanceToken,
      bodyShape: {
        acceptanceToken: "string",
        statusRevision: "string",
        isolationKey: "string",
        accepted: "boolean"
      }
    },
    acceptance: {
      required: source.acceptance?.required !== false,
      token: acceptanceToken,
      status: source.acceptance?.status || preview.acceptance?.status || "unknown",
      nextAction: source.acceptance?.nextAction || nextAction,
      requiredGateIds: source.acceptance?.requiredGateIds || gates.filter((gate) => gate.required).map((gate) => gate.id),
      blockedGateIds: source.acceptance?.blockedGateIds || blockedGates.map((gate) => gate.id),
      pendingGateIds: source.acceptance?.pendingGateIds || pendingGates.map((gate) => gate.id)
    },
    validationSummary: source.validationSummary || {
      total: gates.length,
      accepted: gates.filter((gate) => gate.status === "accepted").length,
      blocked: blockedGates.length,
      pending: pendingGates.length,
      required: gates.filter((gate) => gate.required).length,
      blockingDiagnostics: diagnosticEmission.counts?.bySeverity?.error || 0,
      warningDiagnostics: diagnosticEmission.counts?.bySeverity?.warning || 0
    },
    gates: gates.map((gate) => ({
      id: gate.id,
      label: gate.label,
      status: gate.status,
      required: gate.required === true,
      nextAction: gate.nextAction,
      evidence: gate.evidence || {}
    })),
    clientPatch: {
      ...(source.clientPatch || {}),
      previewHandoffRouteId: routeId,
      previewHandoffStatus: status,
      previewHandoffAcceptanceToken: acceptanceToken,
      previewHandoffNextAction: nextAction
    },
    explainNextStep: {
      action: source.explainNextStep?.action || nextAction,
      reason: source.explainNextStep?.reason || preview.explainNextStep?.reason || "preview-handoff-ready",
      resumeToken: source.explainNextStep?.resumeToken || diagnosticEmission.statusLedger?.resumeToken || null,
      statusRevision: source.explainNextStep?.statusRevision || diagnosticEmission.statusLedger?.statusRevision || null,
      isolationKey: source.explainNextStep?.isolationKey || clientWorkflow.tenant?.isolationKey || null
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-preview-handoff-token",
      resumeFromRouteId: routeId,
      externalWritesPerformed: false
    }
  };
}

function summarizeProviderReceiptEvidence(job, diagnosticEmission, dispatchReadiness = {}) {
  const source = dispatchReadiness.providerReceiptEvidence
    || job.providerReceiptEvidence
    || job.clientCommand?.providerReceiptEvidence
    || diagnosticEmission.providerReceiptEvidence
    || {};
  const route = source.route || {};
  const receipt = source.receipt || job.providerReceipt || {};
  const external = source.externalHandoff || job.externalHandoff || {};
  const missingEvidence = uniqueSorted(source.missingEvidence || []);
  const receiptRequired = source.externalHandoff?.receiptRequired === true
    || source.receipt?.required === true
    || receipt.required === true
    || external.receiptRequired === true;
  const acknowledged = source.receipt?.acknowledged === true
    || receipt.acknowledged === true
    || external.receiptAcknowledged === true;
  const state = source.state
    || (missingEvidence.length > 0
      ? missingEvidence.includes("provider_receipt_acknowledgement")
        ? "waiting_for_provider_receipt"
        : "blocked"
      : receiptRequired || external.state && external.state !== "local_only"
        ? "evidence_ready"
        : "not_required");
  const ready = source.ready === true
    || (missingEvidence.length === 0 && (!receiptRequired || acknowledged));
  const evidenceKey = source.evidenceKey
    || `${job.id}:provider-receipt-evidence:${state}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = source.nextAction
    || route.primaryAction
    || (ready ? "handoff-to-runtime-adapter" : "refresh-provider-receipt");

  return {
    schemaVersion: "aios.mailchimp.provider-receipt-evidence-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    evidenceKey,
    state,
    ready,
    restartSafe: source.restartSafe !== false && receipt.restartSafe !== false,
    replaySafe: source.restartSemantics?.replaySafe === true || source.replaySafe === true || ready,
    nextAction,
    externalHandoff: {
      state: external.state || source.externalHandoff?.state || "local_only",
      requestId: external.requestId || source.externalHandoff?.requestId || null,
      linked: external.linked === true || source.externalHandoff?.linked === true,
      receiptRequired,
      receiptAcknowledged: acknowledged
    },
    receipt: {
      state: receipt.state || source.receipt?.state || "missing",
      receiptId: receipt.receiptId || source.receipt?.receiptId || null,
      acknowledged,
      acknowledgedAt: receipt.acknowledgedAt || source.receipt?.acknowledgedAt || null,
      syncCursor: receipt.syncCursor || source.receipt?.syncCursor || null,
      restartSafe: receipt.restartSafe !== false,
      blockedReasons: uniqueSorted(receipt.blockedReasons || source.receipt?.blockedReasons || [])
    },
    missingEvidence,
    route: {
      target: route.target || "provider-receipt-evidence",
      idempotencyKey: route.idempotencyKey || evidenceKey,
      primaryAction: route.primaryAction || nextAction,
      requiredBodyKeys: route.requiredBodyKeys || (receiptRequired ? ["receiptId", "externalRequestId"] : ["requestId"])
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      metadataProviderReceiptEvidenceState: state,
      metadataProviderReceiptEvidenceReady: ready,
      metadataProviderReceiptEvidenceKey: evidenceKey,
      metadataProviderReceiptEvidenceNextAction: nextAction,
      metadataProviderReceiptEvidenceMissing: missingEvidence
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: ready,
      duplicateCommandPolicy: "dedupe-by-provider-receipt-evidence-key",
      resumeFromEvidenceKey: evidenceKey,
      externalWritesPerformed: false
    }
  };
}

function summarizeProviderExternalHandoff(job, diagnosticEmission, providerServiceSummary, providerReceiptEvidence) {
  const source = diagnosticEmission.providerExternalHandoff
    || job.providerExternalHandoff
    || job.providerContract?.externalHandoff
    || {};
  const serviceExternal = providerServiceSummary.externalHandoff || {};
  const serviceContinuity = providerServiceSummary.serviceContinuity || {};
  const evidenceExternal = providerReceiptEvidence.externalHandoff || {};
  const receipt = providerReceiptEvidence.receipt || {};
  const requestId = source.requestId
    || source.externalRequestId
    || evidenceExternal.requestId
    || serviceExternal.requestId
    || null;
  const state = source.state
    || source.externalHandoffState
    || evidenceExternal.state
    || (requestId ? "linked" : "local_only");
  const linked = state !== "local_only" || Boolean(requestId);
  const receiptRequired = source.receiptRequired === true
    || evidenceExternal.receiptRequired === true
    || serviceExternal.required === true
    || providerReceiptEvidence.receipt?.required === true;
  const receiptAcknowledged = source.receiptAcknowledged === true
    || evidenceExternal.receiptAcknowledged === true
    || providerReceiptEvidence.receipt?.acknowledged === true;
  const syncReady = source.syncReady === true
    || providerServiceSummary.syncMetadata?.syncHandoffReady === true
    || providerServiceSummary.syncMetadata?.syncRequired !== true;
  const capabilityReady = providerServiceSummary.capabilityNegotiation?.complete === true;
  const continuityReady = serviceContinuity.holdExternalWrite !== true
    && serviceContinuity.mode !== "blocked";
  const missingEvidence = uniqueSorted([
    ...(linked && !requestId ? ["external_request_id"] : []),
    ...(receiptRequired && !receiptAcknowledged ? ["provider_receipt_acknowledgement"] : []),
    ...(syncReady ? [] : ["provider_sync_checkpoint"]),
    ...(capabilityReady ? [] : ["provider_capability_negotiation"]),
    ...(continuityReady ? [] : ["provider_continuity_release"]),
    ...(providerReceiptEvidence.ready === false ? ["provider_receipt_evidence"] : []),
    ...(providerReceiptEvidence.missingEvidence || [])
  ]);
  const status = missingEvidence.length === 0
    ? linked ? "linked" : "local-only"
    : missingEvidence.includes("provider_receipt_acknowledgement")
      ? "waiting-for-provider-receipt"
      : missingEvidence.includes("external_request_id")
        ? "waiting-for-external-link"
        : missingEvidence.includes("provider_sync_checkpoint")
          ? "waiting-for-provider-sync"
          : "blocked";
  const nextAction = status === "linked" || status === "local-only"
    ? "handoff-to-runtime-adapter"
    : status === "waiting-for-provider-receipt"
      ? "refresh-provider-receipt"
      : status === "waiting-for-external-link"
        ? "relink-external-handoff"
        : status === "waiting-for-provider-sync"
          ? "refresh-provider-sync-before-replay"
          : serviceContinuity.nextAction || providerReceiptEvidence.nextAction || "refresh-provider-contract";
  const handoffKey = source.handoffKey
    || serviceExternal.idempotencyKey
    || providerReceiptEvidence.evidenceKey
    || `${job.id}:provider-external-handoff:${status}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const replaySafe = missingEvidence.length === 0
    && providerReceiptEvidence.restartSafe !== false
    && serviceContinuity.restartSemantics?.replaySafe !== false;

  return {
    schemaVersion: "aios.mailchimp.provider-external-handoff-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    handoffKey,
    status,
    state,
    linked,
    ready: missingEvidence.length === 0,
    replaySafe,
    restartSafe: replaySafe || status === "local-only",
    requestId,
    nextAction,
    receipt: {
      required: receiptRequired,
      acknowledged: receiptAcknowledged,
      receiptId: receipt.receiptId || null,
      state: receipt.state || "missing",
      restartSafe: receipt.restartSafe !== false,
      blockedReasons: uniqueSorted(receipt.blockedReasons || [])
    },
    sync: {
      required: providerServiceSummary.syncMetadata?.syncRequired === true,
      ready: syncReady,
      providerSyncMounts: providerServiceSummary.syncMetadata?.providerSyncMounts || [],
      serviceScopes: providerServiceSummary.syncMetadata?.serviceScopes || []
    },
    capabilityNegotiation: {
      ready: capabilityReady,
      required: providerServiceSummary.capabilityNegotiation?.required || [],
      unnegotiated: providerServiceSummary.capabilityNegotiation?.unnegotiated || []
    },
    continuity: {
      mode: serviceContinuity.mode || "unknown",
      holdExternalWrite: serviceContinuity.holdExternalWrite === true,
      retryable: serviceContinuity.retryable === true,
      nextAction: serviceContinuity.nextAction || null
    },
    missingEvidence,
    route: {
      target: "provider-external-handoff",
      idempotencyKey: handoffKey,
      primaryAction: nextAction,
      requiredBodyKeys: receiptRequired
        ? ["requestId", "receiptId", "receiptState"]
        : linked ? ["requestId"] : ["handoffKey"]
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      providerExternalHandoffStatus: status,
      providerExternalHandoffKey: handoffKey,
      providerExternalHandoffReady: missingEvidence.length === 0,
      providerExternalHandoffNextAction: nextAction,
      providerExternalHandoffMissingEvidence: missingEvidence
    },
    restartSemantics: source.restartSemantics || {
      replaySafe,
      duplicateCommandPolicy: "dedupe-by-provider-external-handoff-key",
      resumeFromExternalHandoffKey: handoffKey,
      externalWritesPerformed: false
    }
  };
}

function summarizeAdapterDispatchReadiness(job, diagnosticEmission, runtimeSummary, previewHandoff) {
  const source = job.adapterDispatchReadiness || {};
  const gates = source.gates || {};
  const blockedReasons = uniqueSorted(source.blockedReasons || []);
  const warningCodes = uniqueSorted(source.warningCodes || []);
  const ready = source.ready === true
    && blockedReasons.length === 0
    && runtimeSummary.acceptedForClientPreview !== false;
  const dispatchReady = source.dispatchReady === true
    && ready
    && runtimeSummary.acceptedForRuntime === true
    && runtimeSummary.statusControls.canStartRuntime === true;
  const state = source.state
    || (blockedReasons.length > 0
      ? "blocked"
      : dispatchReady
        ? "ready_to_dispatch"
        : ready
          ? "ready_to_queue"
          : "waiting");
  const acceptance = source.acceptance || {};
  const acceptanceRequired = acceptance.required === true || previewHandoff.acceptance?.required === true;
  const acceptanceAccepted = acceptance.accepted === true || previewHandoff.acceptance?.status === "accepted";
  const route = source.route || {};
  const readinessKey = source.readinessKey
    || `${job.id}:adapter-dispatch-readiness:${state}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const nextAction = dispatchReady
    ? "dispatch-mailchimp-handoff"
    : ready
      ? source.nextAction || "queue-mailchimp-handoff"
      : source.nextAction
        || previewHandoff.primaryAction
        || diagnosticEmission.recovery?.nextAction
        || "repair-mailchimp-dispatch-readiness";
  const gateRows = [
    ["diagnosticsClear", "Diagnostics clear", gates.diagnosticsClear !== false, "repair-compile-contract"],
    ["tenantBoundaryAllowed", "Tenant boundary allowed", gates.tenantBoundaryAllowed !== false, "repair-tenant-permissions"],
    ["lifecycleDispatchReady", "Lifecycle dispatch ready", gates.lifecycleDispatchReady === true, runtimeSummary.statusControls.nextLifecycleAction],
    ["idempotencyPresent", "Idempotency key present", gates.idempotencyPresent !== false, "attach-idempotency-key"],
    ["truthBoundaryVerified", "Truth boundary verified", gates.truthBoundaryVerified !== false, "collect-verifier-evidence"],
    ["providerOnline", "Provider online", gates.providerOnline !== false, "refresh-provider-contract"],
    ["providerCapabilitiesSatisfied", "Provider capabilities satisfied", gates.providerCapabilitiesSatisfied !== false, "renegotiate-mailchimp-provider-capabilities"],
    ["providerSyncReady", "Provider sync ready", gates.providerSyncReady !== false, "refresh-provider-sync-before-replay"],
    ["providerLeaseRestartSafe", "Provider lease restart-safe", gates.providerLeaseRestartSafe !== false, "refresh-provider-lease"],
    ["providerReceiptAcknowledged", "Provider receipt acknowledged", gates.providerReceiptAcknowledged !== false, "refresh-provider-receipt"],
    ["providerReceiptEvidenceReady", "Provider receipt evidence ready", gates.providerReceiptEvidenceReady !== false, source.providerReceiptEvidence?.nextAction || "refresh-provider-receipt"]
  ].map(([id, label, passed, gateNextAction], index) => ({
    id: `mailchimp.dispatch.${id}`,
    order: index + 1,
    label,
    status: passed ? "accepted" : "blocked",
    required: true,
    nextAction: passed ? nextAction : gateNextAction || nextAction
  }));
  const blockedGateIds = gateRows.filter((gate) => gate.status === "blocked").map((gate) => gate.id);

  return {
    schemaVersion: "aios.mailchimp.adapter-dispatch-readiness-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    readinessKey,
    state,
    ready,
    dispatchReady,
    queueReady: source.queueReady === true || (ready && dispatchReady === false),
    externalWrite: source.externalWrite === true,
    dryRun: source.dryRun === true || job.dryRun === true,
    nextAction,
    blockedReasons,
    warningCodes,
    acceptance: {
      required: acceptanceRequired,
      accepted: acceptanceAccepted,
      token: acceptance.token || previewHandoff.acceptance?.token || null,
      acceptedBy: acceptance.acceptedBy || null,
      acceptedAt: acceptance.acceptedAt || null
    },
    providerReceiptEvidence: summarizeProviderReceiptEvidence(job, diagnosticEmission, source),
    route: {
      method: route.method || "POST",
      path: route.path || `/mailchimp/jobs/${job.id}/dispatch-readiness`,
      idempotencyKey: route.idempotencyKey || readinessKey,
      primaryAction: route.primaryAction || nextAction,
      requiredBodyKeys: route.requiredBodyKeys || (acceptanceRequired ? ["acceptanceToken", "accepted"] : ["requestId"])
    },
    gates: gateRows,
    validationSummary: {
      ...(source.validationSummary || {}),
      total: gateRows.length,
      accepted: gateRows.filter((gate) => gate.status === "accepted").length,
      blocked: blockedGateIds.length,
      warnings: warningCodes.length,
      runtimeAccepted: runtimeSummary.acceptedForRuntime === true,
      runtimeStartEnabled: runtimeSummary.statusControls.canStartRuntime === true,
      acceptanceRequired,
      acceptanceAccepted
    },
    clientPatch: {
      adapterDispatchReadinessKey: readinessKey,
      adapterDispatchReadinessState: state,
      adapterDispatchReady: dispatchReady,
      adapterDispatchNextAction: nextAction,
      adapterDispatchBlockedReasons: blockedReasons,
      adapterDispatchBlockedGateIds: blockedGateIds
    },
    explainNextStep: {
      action: nextAction,
      reason: blockedReasons.length > 0
        ? "adapter-dispatch-blocked"
        : acceptanceRequired && !acceptanceAccepted
          ? "adapter-dispatch-acceptance-required"
          : dispatchReady
            ? "adapter-dispatch-ready"
            : "adapter-dispatch-queue-ready",
      readinessKey,
      resumeToken: diagnosticEmission.statusLedger?.resumeToken || null,
      statusRevision: diagnosticEmission.statusLedger?.statusRevision || null
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-dispatch-readiness-key",
      resumeFromReadinessKey: readinessKey,
      externalWritesPerformed: false
    }
  };
}

function summarizePersistedCommandEvidence(job, diagnosticEmission, adapterDispatchReadiness) {
  const source = job.adapterPersistedCommandEvidence
    || job.clientCommand?.persistedCommandEvidence
    || job.adapterDispatchReadiness?.persistedCommandEvidence
    || diagnosticEmission.adapterPersistedCommandEvidence
    || diagnosticEmission.clientCommand?.persistedCommandEvidence
    || {};
  const blockedReasons = uniqueSorted([
    ...(Array.isArray(source.blockedReasons) ? source.blockedReasons : []),
    ...(source.ready === false ? ["persisted-command-evidence-not-ready"] : []),
    ...(source.restartSafe === false ? ["persisted-command-not-restart-safe"] : []),
    ...(source.replaySafe === false ? ["persisted-command-not-replay-safe"] : []),
    ...(adapterDispatchReadiness.ready === false ? ["adapter-dispatch-readiness-not-ready"] : [])
  ]);
  const commandKey = source.commandKey
    || source.route?.idempotencyKey
    || job.clientCommand?.idempotencyKey
    || `${job.id}:adapter-command:${adapterDispatchReadiness.state}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const evidenceKey = source.evidenceKey
    || `${job.id}:persisted-command:${commandKey}:${blockedReasons.length ? "blocked" : "ready"}`
      .replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const state = source.state
    || (blockedReasons.length > 0
      ? "blocked"
      : source.externalHandoff?.acknowledged === true
        ? "acknowledged"
        : adapterDispatchReadiness.dispatchReady
          ? "ready_to_dispatch"
          : "ready_to_queue");
  const nextAction = source.nextAction
    || (blockedReasons.includes("adapter-dispatch-readiness-not-ready")
      ? adapterDispatchReadiness.nextAction
      : blockedReasons.includes("persisted-command-not-replay-safe")
        ? "repair-persisted-command-evidence"
        : state === "acknowledged"
          ? "observe-persisted-command"
          : adapterDispatchReadiness.nextAction || "queue-mailchimp-handoff");
  const replaySafe = source.replaySafe === true
    || (blockedReasons.length === 0 && source.replaySafe !== false);

  return {
    schemaVersion: "aios.mailchimp.persisted-command-evidence-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    evidenceKey,
    commandId: source.commandId || job.clientCommand?.commandId || null,
    commandKey,
    state,
    ready: blockedReasons.length === 0,
    replaySafe,
    restartSafe: replaySafe || state === "acknowledged",
    nextAction,
    blockedReasons,
    externalWrite: source.externalWrite === true || adapterDispatchReadiness.externalWrite === true,
    externalHandoff: {
      requestId: source.externalHandoff?.requestId || null,
      receiptId: source.externalHandoff?.receiptId || null,
      acknowledged: source.externalHandoff?.acknowledged === true
    },
    history: {
      eventCount: source.history?.eventCount || 0,
      latestState: source.history?.latestState || null,
      latestCode: source.history?.latestCode || null,
      latestAt: source.history?.latestAt || null
    },
    route: {
      target: source.route?.target || "adapter-persisted-command-evidence",
      idempotencyKey: source.route?.idempotencyKey || evidenceKey,
      primaryAction: source.route?.primaryAction || nextAction,
      requiredBodyKeys: source.route?.requiredBodyKeys || ["evidenceKey", "commandKey"]
    },
    clientPatch: {
      ...(source.clientPatch || {}),
      metadataPersistedCommandEvidenceKey: evidenceKey,
      metadataPersistedCommandState: state,
      metadataPersistedCommandReplaySafe: replaySafe,
      metadataPersistedCommandNextAction: nextAction,
      metadataPersistedCommandBlockedReasons: blockedReasons
    },
    restartSemantics: source.restartSemantics || {
      replaySafe,
      duplicateCommandPolicy: "dedupe-by-metadata-persisted-command-evidence-key",
      resumeFromPersistedCommandEvidenceKey: evidenceKey,
      externalWritesPerformed: false
    }
  };
}

function summarizeClientWorkflowRepair(job, diagnosticEmission, adapterDispatchReadiness, clientRuntimeAdoption) {
  const source = diagnosticEmission.clientWorkflowRepair
    || diagnosticEmission.compileCache?.clientWorkflowHandoff?.workflowRepair
    || diagnosticEmission.compileCache?.workflowRepair
    || job.clientCommand?.clientWorkflowHandoff
    || job.adapterDispatchReadiness?.clientWorkflowHandoff
    || {};
  const retry = source.retry || {};
  const clientPatch = source.clientPatch || {};
  const exportRow = source.exportRow || {};
  const blockedReasons = uniqueSorted([
    ...(Array.isArray(source.blockedReasons) ? source.blockedReasons : []),
    ...(Array.isArray(source.request?.blockedReasons) ? source.request.blockedReasons.map((reason) => `request:${reason}`) : []),
    ...(Array.isArray(source.provider?.blockedReasons) ? source.provider.blockedReasons.map((reason) => `provider:${reason}`) : []),
    ...(Array.isArray(source.boundary?.blockedReasons) ? source.boundary.blockedReasons.map((reason) => `boundary:${reason}`) : [])
  ]);
  const state = source.state
    || clientPatch.compileCacheWorkflowRepairState
    || clientPatch.adapterClientWorkflowState
    || (adapterDispatchReadiness.ready ? "ready" : "needs_attention");
  const nextAction = source.nextAction
    || source.primaryAction
    || clientPatch.compileCacheWorkflowRepairAction
    || clientPatch.adapterClientWorkflowNextAction
    || adapterDispatchReadiness.nextAction
    || clientRuntimeAdoption.nextAction
    || "handoff-to-runtime-adapter";
  const resumeToken = source.resumeToken
    || clientPatch.compileCacheWorkflowRepairToken
    || clientPatch.adapterClientWorkflowResumeToken
    || adapterDispatchReadiness.readinessKey
    || `${job.id}:client-workflow-repair:${state}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");
  const ready = source.ready === true
    || state === "no_repair_required"
    || state === "dispatch_ready"
    || state === "queue_ready"
    || adapterDispatchReadiness.ready === true && blockedReasons.length === 0;
  const operatorVisible = source.operatorVisible === true
    || clientPatch.compileCacheWorkflowRepairOperatorVisible === true
    || clientPatch.adapterClientWorkflowOperatorVisible === true
    || source.acceptance?.required === true && source.acceptance?.accepted !== true;
  const retryAfterMs = retry.retryAfterMs
    || clientPatch.compileCacheWorkflowRepairRetryAfterMs
    || clientPatch.adapterClientWorkflowRetryAfterMs
    || 0;

  return {
    schemaVersion: "aios.mailchimp.client-workflow-repair-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    state,
    status: ready ? "ready" : operatorVisible ? "needs-operator-action" : "degraded",
    ready,
    routeState: source.routeState || (ready ? "ready" : operatorVisible ? "acceptance_required" : "needs_attention"),
    severity: source.severity || (ready ? "info" : operatorVisible ? "warning" : "error"),
    nextAction,
    resumeToken,
    statusRevision: source.statusRevision || `${resumeToken}:${blockedReasons.join("|") || "clear"}`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    operatorVisible,
    retry: {
      retryable: retry.retryable === true && operatorVisible === false,
      retryAfterMs,
      maxAttempts: retry.maxAttempts || (retry.retryable === true ? 3 : 0),
      nextAction: retry.nextAction || nextAction,
      exhausted: retry.exhausted === true
    },
    request: {
      adoptionState: source.request?.adoptionState || clientRuntimeAdoption.status || "unknown",
      adopted: source.request?.adopted === true || clientRuntimeAdoption.readyForClientRuntime === true,
      requestId: source.request?.requestId || clientRuntimeAdoption.requestId || null,
      sessionId: source.request?.sessionId || null,
      viewId: source.request?.viewId || null,
      blockedReasons: uniqueSorted(source.request?.blockedReasons || [])
    },
    providerState: {
      state: source.provider?.state || "unknown",
      ready: source.provider?.ready === true,
      restartSafe: source.provider?.restartSafe !== false,
      replayAllowed: source.provider?.replayAllowed === true,
      nextAction: source.provider?.nextAction || null,
      externalHandoffState: source.provider?.externalHandoffState || "local_only",
      externalRequestId: source.provider?.externalRequestId || null,
      blockedReasons: uniqueSorted(source.provider?.blockedReasons || [])
    },
    acceptance: {
      required: source.acceptance?.required === true || operatorVisible,
      accepted: source.acceptance?.accepted === true,
      nextAction: source.acceptance?.nextAction || (operatorVisible ? "request_compile_cache_acceptance" : nextAction),
      reason: source.acceptance?.reason || (operatorVisible ? blockedReasons[0] || "operator_acceptance_required" : "")
    },
    focusedAction: source.focusedAction || null,
    actionQueue: Array.isArray(source.actionQueue) ? source.actionQueue : [],
    counters: {
      blockedReasons: blockedReasons.length,
      blockingActions: source.counters?.blockingActions || source.actionQueue?.filter?.((action) => action.blocking !== false).length || 0,
      retryableActions: source.counters?.retryableActions || (retry.retryable === true ? 1 : 0),
      providerBlocked: source.counters?.providerBlocked || (source.provider?.blockedReasons?.length > 0 ? 1 : 0),
      boundaryBlocked: source.counters?.boundaryBlocked || (source.boundary?.blockedReasons?.length > 0 ? 1 : 0)
    },
    clientPatch: {
      ...(clientPatch || {}),
      mailchimpClientWorkflowRepairState: state,
      mailchimpClientWorkflowRepairNextAction: nextAction,
      mailchimpClientWorkflowRepairResumeToken: resumeToken,
      mailchimpClientWorkflowRepairReady: ready
    },
    exportRow: {
      artifactName: exportRow.artifactName || "client-workflow-repair.json",
      rowId: exportRow.rowId || `${resumeToken}:metadata`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      readyForExport: exportRow.readyForExport !== false,
      status: exportRow.status || state,
      nextAction: exportRow.nextAction || nextAction,
      blockedReasons: uniqueSorted(exportRow.blockedReasons || blockedReasons)
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: ready || state === "waiting_for_operator_acceptance",
      duplicateCommandPolicy: "dedupe-by-client-workflow-repair-token",
      resumeFromWorkflowToken: resumeToken,
      externalWritesPerformed: false
    },
    blockedReasons
  };
}

function summarizeClientWorkflowStatus({
  job,
  runtimeSummary,
  clientWorkflow,
  clientWorkflowRepair,
  adapterDispatchReadiness,
  clientReadinessDecision,
  clientExportReadiness,
  clientExportTimelineState,
  providerExternalHandoff
}) {
  const workflow = clientWorkflow || {};
  const repair = clientWorkflowRepair || {};
  const dispatch = adapterDispatchReadiness || {};
  const readiness = clientReadinessDecision || {};
  const exportCard = clientExportReadiness || {};
  const exportTimeline = clientExportTimelineState || {};
  const providerHandoff = providerExternalHandoff || {};
  const blockedReasons = uniqueSorted([
    ...(runtimeSummary.acceptedForRuntime === true ? [] : ["runtime:not-accepted"]),
    ...(dispatch.ready === true ? [] : uniqueSorted(dispatch.blockedReasons || []).map((reason) => `dispatch:${reason}`)),
    ...(repair.ready === true ? [] : uniqueSorted(repair.blockedReasons || []).map((reason) => `repair:${reason}`)),
    ...(readiness.readyForRuntimeStart === true ? [] : uniqueSorted(readiness.blockedReasons || []).map((reason) => `readiness:${reason}`)),
    ...(exportCard.readyForClient === true ? [] : uniqueSorted(exportCard.clientPatch?.metadataClientExportBlockedArtifacts || []).map((reason) => `export:${reason}`)),
    ...(exportTimeline.ready === true ? [] : uniqueSorted(exportTimeline.clientPatch?.metadataClientExportTimelineBlockedRows || []).map((reason) => `timeline:${reason}`)),
    ...(providerHandoff.ready === true ? [] : uniqueSorted(providerHandoff.missingEvidence || []).map((reason) => `provider:${reason}`)),
    ...(readiness.acceptance?.required === true && readiness.acceptance?.accepted !== true
      ? ["client:acceptance-required"]
      : [])
  ]);
  const runtimeReady = runtimeSummary.acceptedForRuntime === true
    && dispatch.dispatchReady === true
    && readiness.readyForRuntimeStart === true
    && repair.ready === true
    && blockedReasons.length === 0;
  const clientReady = readiness.readyForClient === true
    && exportCard.readyForClient === true
    && blockedReasons.every((reason) => reason === "client:acceptance-required");
  const status = runtimeReady
    ? "ready-for-runtime"
    : clientReady
      ? "waiting-for-client-acceptance"
      : providerHandoff.ready === false
        ? "waiting-for-provider-handoff"
        : repair.ready !== true
          ? "repair-required"
          : "client-action-required";
  const nextAction = status === "ready-for-runtime"
    ? dispatch.nextAction || "handoff-to-runtime-adapter"
    : status === "waiting-for-client-acceptance"
      ? "request-preview-acceptance"
      : providerHandoff.ready === false
        ? providerHandoff.nextAction || "refresh-provider-handoff"
        : repair.ready !== true
          ? repair.nextAction || "repair-client-workflow"
          : readiness.nextAction || exportTimeline.nextAction || exportCard.nextAction || workflow.primaryAction || "review-client-workflow";
  const statusKey = [
    job.id,
    status,
    dispatch.readinessKey || readiness.decisionId || repair.resumeToken || "client-workflow"
  ].filter(Boolean).join(":").replace(/[^a-zA-Z0-9_.:-]/g, "_");

  return {
    schemaVersion: "aios.mailchimp.client-workflow-status.v1",
    provider: "mailchimp",
    jobId: job.id,
    statusKey,
    status,
    readyForClient: clientReady,
    readyForRuntimeStart: runtimeReady,
    nextAction,
    route: {
      target: "client-runtime-handoff",
      method: "POST",
      idempotencyKey: statusKey,
      primaryAction: nextAction,
      resumeToken: repair.resumeToken || readiness.restartSemantics?.resumeFromDecisionId || null,
      requiredBodyKeys: readiness.acceptance?.required === true && readiness.acceptance?.accepted !== true
        ? ["statusKey", "acceptanceToken", "accepted"]
        : ["statusKey", "statusRevision"]
    },
    counters: {
      blockedReasons: blockedReasons.length,
      dispatchBlockedReasons: uniqueSorted(dispatch.blockedReasons || []).length,
      repairBlockedReasons: uniqueSorted(repair.blockedReasons || []).length,
      readinessBlockedReasons: uniqueSorted(readiness.blockedReasons || []).length,
      exportBlockedArtifacts: uniqueSorted(exportCard.clientPatch?.metadataClientExportBlockedArtifacts || []).length,
      timelineBlockedRows: uniqueSorted(exportTimeline.clientPatch?.metadataClientExportTimelineBlockedRows || []).length,
      providerMissingEvidence: uniqueSorted(providerHandoff.missingEvidence || []).length
    },
    gates: {
      runtimeAccepted: runtimeSummary.acceptedForRuntime === true,
      dispatchReady: dispatch.dispatchReady === true,
      repairReady: repair.ready === true,
      readinessReady: readiness.readyForRuntimeStart === true,
      exportReady: exportCard.readyForClient === true && exportTimeline.ready === true,
      providerReady: providerHandoff.ready !== false,
      acceptanceSatisfied: readiness.acceptance?.required !== true || readiness.acceptance?.accepted === true
    },
    blockedReasons,
    clientPatch: {
      metadataClientWorkflowStatusKey: statusKey,
      metadataClientWorkflowStatus: status,
      metadataClientWorkflowReadyForClient: clientReady,
      metadataClientWorkflowReadyForRuntimeStart: runtimeReady,
      metadataClientWorkflowNextAction: nextAction,
      metadataClientWorkflowBlockedReasons: blockedReasons
    },
    exportRow: {
      artifactName: "metadata-client-workflow-status.json",
      rowId: `${statusKey}:client-workflow-status`.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
      status,
      nextAction,
      readyForExport: true,
      blockedReasons
    },
    restartSemantics: {
      replaySafe: runtimeReady || status === "waiting-for-client-acceptance",
      duplicateCommandPolicy: "dedupe-by-metadata-client-workflow-status-key",
      resumeFromClientWorkflowStatusKey: statusKey,
      externalWritesPerformed: false
    }
  };
}

function buildOperationalHealth(job, runtimeSummary, diagnosticEmission, lifecycleClientState) {
  const status = diagnosticEmission.status;
  const retry = retryProfileFor(status, diagnosticEmission);
  const failureState = diagnosticEmission.failureState || {};
  const providerService = diagnosticEmission.providerServiceContract || {};
  const commandLeasePlan = diagnosticEmission.clientCommandLeases || {};
  const clientRuntimeAdoption = summarizeClientRuntimeAdoption(job, diagnosticEmission, runtimeSummary);
  const clientWorkflowRepair = summarizeClientWorkflowRepair(
    job,
    diagnosticEmission,
    job.adapterDispatchReadiness || {},
    clientRuntimeAdoption
  );
  const permissionGrantPlan = summarizePermissionGrantPlan(job, diagnosticEmission);
  const tenantPermissionEnforcement = summarizeTenantPermissionEnforcement(
    job,
    diagnosticEmission,
    permissionGrantPlan
  );
  const operationalIncidents = summarizeOperationalIncidents(job, diagnosticEmission);
  const clientRemediation = summarizeClientRemediation(job, diagnosticEmission, runtimeSummary);
  const degradedReasons = [];
  if (status === "blocked") degradedReasons.push("blocking-diagnostics");
  if (status === "needs-operator-action") degradedReasons.push("operator-action-required");
  if (runtimeSummary.statusControls.requiresApprovalBeforeExternalWrite) {
    degradedReasons.push("approval-required-before-external-write");
  }
  if (!runtimeSummary.acceptedForRuntime) degradedReasons.push("runtime-not-accepted");
  if (failureState.mode === "blocked") degradedReasons.push("adapter-failure-state-blocked");
  if (failureState.mode === "degraded") degradedReasons.push("adapter-failure-state-degraded");
  if (lifecycleClientState.runtimeStartEnabled !== true) {
    degradedReasons.push(lifecycleClientState.statePatch?.runtimeStartDisableReason || "lifecycle-runtime-start-gated");
  }
  if (lifecycleClientState.schedule?.paused) degradedReasons.push("lifecycle-schedule-paused");
  if (providerService.status === "blocked") degradedReasons.push("provider-service-blocked");
  if (providerService.status === "needs-operator-action") degradedReasons.push("provider-service-action-required");
  if (providerService.externalHandoff?.ready === false) degradedReasons.push("provider-service-handoff-not-ready");
  const providerContinuity = summarizeProviderService(job, diagnosticEmission).serviceContinuity;
  if (providerContinuity.holdExternalWrite) degradedReasons.push("provider-continuity-hold-external-write");
  if (providerContinuity.queueOnly) degradedReasons.push("provider-continuity-queue-only");
  if (providerContinuity.degradedReasons.length > 0) degradedReasons.push("provider-continuity-degraded");
  if (commandLeasePlan.leaseStatus === "awaiting-client-ack") degradedReasons.push("client-command-ack-required");
  if (commandLeasePlan.leaseStatus === "blocked") degradedReasons.push("client-command-lease-blocked");
  if (clientRuntimeAdoption.status === "blocked") degradedReasons.push("client-runtime-adoption-blocked");
  if (clientRuntimeAdoption.status === "waiting-for-client") degradedReasons.push("client-runtime-adoption-waiting");
  if (clientWorkflowRepair.ready !== true) degradedReasons.push("client-workflow-repair-open");
  if (clientWorkflowRepair.retry.exhausted === true) degradedReasons.push("client-workflow-repair-retry-exhausted");
  if (permissionGrantPlan.status === "blocked") degradedReasons.push("permission-grant-plan-blocked");
  if (permissionGrantPlan.readyForAudit !== true) degradedReasons.push("permission-grant-audit-not-ready");
  if (tenantPermissionEnforcement.status === "blocked") degradedReasons.push("tenant-permission-enforcement-blocked");
  if (tenantPermissionEnforcement.audit.ready !== true) degradedReasons.push("tenant-permission-audit-not-ready");
  if (operationalIncidents.status === "blocked") degradedReasons.push("operational-incident-blocked");
  if (operationalIncidents.status === "degraded") degradedReasons.push("operational-incident-open");
  if (clientRemediation.status === "blocked") degradedReasons.push("client-remediation-blocked");
  if (clientRemediation.status === "needs-operator-action") degradedReasons.push("client-remediation-waiting");

  return {
    level: healthLevel(status, runtimeSummary, diagnosticEmission),
    status,
    degradedMode: status !== "ready"
      || runtimeSummary.acceptedForRuntime !== true
      || failureState.adapterHandoff?.degradedMode === true,
    degradedReasons: uniqueSorted(degradedReasons),
    retry,
    adapterFailureState: {
      mode: failureState.mode || "unknown",
      queueLength: failureState.summary?.total || 0,
      blocking: failureState.summary?.blocking || 0,
      retryable: failureState.summary?.retryable || 0,
      nextRetry: failureState.nextRetry || null,
      adapterHandoff: failureState.adapterHandoff || null
    },
    providerService: summarizeProviderService(job, diagnosticEmission),
    providerContinuity,
    permissionGrantPlan,
    tenantPermissionEnforcement,
    operationalIncidents,
    clientRemediation,
    clientCommandLeases: summarizeClientCommandLeases(job, diagnosticEmission),
    clientRuntimeAdoption,
    clientWorkflowRepair,
    clientWorkflow: diagnosticEmission.clientWorkflow,
    lifecycleClientState,
    actionableErrors: actionableErrorsFrom(diagnosticEmission),
    statusHandoff: {
      jobId: job.id,
      runtimeAdapter: runtimeSummary.adapter,
      readinessStatus: runtimeSummary.readinessStatus,
      acceptedForRuntime: runtimeSummary.acceptedForRuntime,
      acceptedForClientPreview: runtimeSummary.acceptedForClientPreview,
      nextAction: lifecycleClientState.nextAction || retry.nextAction,
      idempotencyKey: commandLeasePlan.primaryLeaseId
        ? `${job.id}:${commandLeasePlan.primaryLeaseId}:${commandLeasePlan.leaseStatus}`.replace(/[^a-zA-Z0-9_.:-]/g, "_")
        : diagnosticEmission.clientWorkflow?.statePatch?.idempotencyKey || `${job.id}:${status}`,
      resumeToken: diagnosticEmission.statusLedger?.resumeToken || `${job.id}:${status}`,
      statusRevision: diagnosticEmission.statusLedger?.statusRevision || `${job.id}:${status}`,
      lifecycleStatus: lifecycleClientState.status,
      runtimeStartEnabled: lifecycleClientState.runtimeStartEnabled,
      scheduleWindow: lifecycleClientState.schedule?.requestedWindow || null,
      commandLeaseStatus: commandLeasePlan.leaseStatus || "unknown",
      commandAckRequired: commandLeasePlan.clientAck?.required === true,
      commandLeaseResumeToken: commandLeasePlan.clientAck?.resumeToken || null,
      clientRuntimeAdoptionStatus: clientRuntimeAdoption.status,
      clientRuntimeReady: clientRuntimeAdoption.readyForClientRuntime,
      clientRuntimeAdoptionId: clientRuntimeAdoption.adoptionId,
      clientWorkflowRepairState: clientWorkflowRepair.state,
      clientWorkflowRepairNextAction: clientWorkflowRepair.nextAction,
      clientWorkflowRepairReady: clientWorkflowRepair.ready,
      permissionGrantPlanStatus: permissionGrantPlan.status,
      permissionGrantPlanReady: permissionGrantPlan.readyForAudit,
      tenantPermissionEnforcementStatus: tenantPermissionEnforcement.status,
      tenantPermissionEnforcementKey: tenantPermissionEnforcement.enforcementKey,
      tenantPermissionAuditReady: tenantPermissionEnforcement.audit.ready,
      operationalIncidentStatus: operationalIncidents.status,
      operationalIncidentCount: operationalIncidents.counts.total,
      operationalIncidentNextAction: operationalIncidents.nextAction,
      operationalIncidentOwner: operationalIncidents.nextOwner,
      clientRemediationStatus: clientRemediation.status,
      clientRemediationRouteId: clientRemediation.route.routeId,
      clientRemediationNextAction: clientRemediation.nextAction,
      clientRemediationBlocking: clientRemediation.counters.blocking,
      clientRemediationWaiting: clientRemediation.counters.waiting,
      permissionGrantPlanNextAction: permissionGrantPlan.nextAction
    }
  };
}

function summarizeServiceLevelObjectives(job, diagnosticEmission, runtimeSummary) {
  const source = diagnosticEmission.serviceLevelObjectives || {};
  const objectives = Array.isArray(source.objectives) ? source.objectives : [];
  const breaches = Array.isArray(source.breaches) ? source.breaches : [];
  const blocking = breaches.filter((breach) => breach.blocksRuntimeRelease);
  const nextBreach = breaches.find((breach) => breach.id === source.nextBreachId)
    || blocking[0]
    || breaches[0]
    || null;
  const status = source.status
    || (blocking.length > 0
      ? "blocked"
      : breaches.length > 0
        ? "degraded"
        : "ready");

  return {
    schemaVersion: "aios.mailchimp.service-level-objective-summary.v1",
    provider: "mailchimp",
    jobId: job.id,
    status,
    healthLevel: source.healthLevel || (status === "ready" ? "healthy" : status === "blocked" ? "unhealthy" : "degraded"),
    readyForRuntimeRelease: source.readyForRuntimeRelease === true
      && runtimeSummary.acceptedForRuntime === true
      && runtimeSummary.statusControls.canStartRuntime === true,
    nextAction: nextBreach?.nextAction || source.nextAction || "handoff-to-runtime-adapter",
    nextBreachId: nextBreach?.id || null,
    counters: {
      objectives: source.counters?.objectives || objectives.length,
      satisfied: source.counters?.satisfied || objectives.filter((objective) => objective.status === "satisfied").length,
      breached: source.counters?.breached || breaches.length,
      blocking: source.counters?.blocking || blocking.length,
      retryable: source.counters?.retryable || breaches.filter((breach) => breach.severity !== "error").length
    },
    retry: {
      retryable: source.retry?.retryable === true,
      backoffMs: source.retry?.backoffMs || 0,
      maxAttempts: source.retry?.maxAttempts || 0,
      failureClass: source.retry?.failureClass || "service-level-objective",
      nextAction: source.retry?.nextAction || source.nextAction || "handoff-to-runtime-adapter"
    },
    objectives: objectives.map((objective) => ({
      id: objective.id,
      label: objective.label,
      status: objective.status,
      observed: objective.observed,
      target: objective.target,
      unit: objective.unit,
      owner: objective.owner,
      nextAction: objective.nextAction
    })),
    breaches: breaches.map((breach) => ({
      id: breach.id,
      objectiveId: breach.objectiveId,
      severity: breach.severity,
      owner: breach.owner,
      nextAction: breach.nextAction,
      blocksRuntimeRelease: breach.blocksRuntimeRelease === true
    })),
    clientPatch: {
      ...(source.clientPatch || {}),
      serviceLevelObjectiveSummaryStatus: status,
      serviceLevelObjectiveSummaryNextAction: nextBreach?.nextAction || source.nextAction || "handoff-to-runtime-adapter",
      serviceLevelObjectiveSummaryBreaches: breaches.length
    },
    restartSemantics: source.restartSemantics || {
      replaySafe: true,
      duplicateCommandPolicy: "dedupe-by-service-level-objective-job-id",
      resumeFromBreachId: nextBreach?.id || null,
      externalWritesPerformed: false
    }
  };
}

export function emitMailchimpMetadata(source = {}, options = {}) {
  const job = compileIfNeeded(source, options);
  const diagnosticEmission = emitMailchimpDiagnostics(job, options);
  const capabilitySummary = summarizeCapabilities(job);
  const memorySummary = summarizeMemory(job);
  const verifierSummary = summarizeVerifier(job);
  const runtimeSummary = summarizeRuntime(job, diagnosticEmission);
  const providerServiceSummary = summarizeProviderService(job, diagnosticEmission);
  const providerSyncCheckpoint = summarizeProviderSyncCheckpoint(job, diagnosticEmission, providerServiceSummary);
  const runtimeReleaseControls = summarizeRuntimeReleaseControls(
    job,
    diagnosticEmission,
    runtimeSummary,
    providerServiceSummary,
    providerSyncCheckpoint
  );
  const permissionGrantSummary = summarizePermissionGrantPlan(job, diagnosticEmission);
  const tenantPermissionEnforcement = summarizeTenantPermissionEnforcement(
    job,
    diagnosticEmission,
    permissionGrantSummary
  );
  const tenantBoundaryPosture = summarizeTenantBoundaryPosture(
    job,
    diagnosticEmission,
    tenantPermissionEnforcement
  );
  const tenantBoundaryHandoff = summarizeTenantBoundaryHandoff(
    job,
    diagnosticEmission,
    tenantPermissionEnforcement,
    tenantBoundaryPosture
  );
  const tenantPermissionDecision = summarizeTenantPermissionDecisionBundle(
    job,
    tenantPermissionEnforcement,
    tenantBoundaryPosture,
    tenantBoundaryHandoff
  );
  const lifecycleClientState = buildLifecycleClientState(
    job,
    diagnosticEmission,
    runtimeSummary,
    capabilitySummary
  );
  const operationalHealth = buildOperationalHealth(
    job,
    runtimeSummary,
    diagnosticEmission,
    lifecycleClientState
  );
  const serviceLevelObjectives = summarizeServiceLevelObjectives(job, diagnosticEmission, runtimeSummary);
  const operationalIncidents = operationalHealth.operationalIncidents;
  const clientRemediation = operationalHealth.clientRemediation;
  const analyticsCounters = buildAnalyticsCounters(
    job,
    capabilitySummary,
    memorySummary,
    verifierSummary,
    runtimeSummary,
    diagnosticEmission
  );
  const historySnapshots = buildHistorySnapshots(job, runtimeSummary, diagnosticEmission, analyticsCounters);
  const exportSummary = buildExportReadySummary(
    job,
    runtimeSummary,
    diagnosticEmission,
    analyticsCounters,
    historySnapshots
  );
  const preview = buildPreviewEnvelope(
    job,
    capabilitySummary,
    memorySummary,
    verifierSummary,
    runtimeSummary,
    diagnosticEmission,
    exportSummary
  );
  const clientCommandLeases = summarizeClientCommandLeases(job, diagnosticEmission);
  const clientRuntimeAdoption = summarizeClientRuntimeAdoption(job, diagnosticEmission, runtimeSummary);
  const clientRuntimeSettings = summarizeClientRuntimeSettings(job, diagnosticEmission, clientRuntimeAdoption);
  const clientStatusHandoff = summarizeClientStatusHandoff(
    job,
    diagnosticEmission,
    clientRuntimeAdoption,
    clientRuntimeSettings
  );
  const statusRecovery = summarizeStatusRecovery(job, diagnosticEmission, runtimeSummary);
  const restartCheckpoints = summarizeRestartCheckpointManifest(job, diagnosticEmission, statusRecovery);
  const restartReplay = summarizeRestartReplayLedger(job, diagnosticEmission, restartCheckpoints);
  const clientWorkflow = buildScopedClientWorkflow(
    job,
    diagnosticEmission,
    preview,
    lifecycleClientState,
    clientCommandLeases
  );
  const previewHandoff = summarizePreviewHandoff(
    job,
    diagnosticEmission,
    preview,
    clientWorkflow,
    lifecycleClientState
  );
  const adapterDispatchReadiness = summarizeAdapterDispatchReadiness(
    job,
    diagnosticEmission,
    runtimeSummary,
    previewHandoff
  );
  const persistedCommandEvidence = summarizePersistedCommandEvidence(
    job,
    diagnosticEmission,
    adapterDispatchReadiness
  );
  const workflowControlState = buildWorkflowControlState(job, {
    lifecycleClientState,
    runtimeReleaseControls,
    adapterDispatchReadiness,
    providerSyncCheckpoint,
    providerServiceSummary,
    diagnosticEmission
  });
  const providerReceiptEvidence = adapterDispatchReadiness.providerReceiptEvidence;
  const providerExternalHandoff = summarizeProviderExternalHandoff(
    job,
    diagnosticEmission,
    providerServiceSummary,
    providerReceiptEvidence
  );
  const clientWorkflowRepair = summarizeClientWorkflowRepair(
    job,
    diagnosticEmission,
    adapterDispatchReadiness,
    clientRuntimeAdoption
  );
  const exportArtifactState = buildExportArtifactState(
    job,
    diagnosticEmission,
    runtimeSummary,
    providerServiceSummary,
    clientCommandLeases,
    exportSummary
  );
  const reportingTimeline = buildReportingTimeline(
    job,
    historySnapshots,
    exportArtifactState,
    analyticsCounters,
    diagnosticEmission
  );
  const analyticsExportReport = buildAnalyticsExportReport(
    job,
    diagnosticEmission,
    analyticsCounters,
    exportSummary,
    providerServiceSummary,
    exportArtifactState,
    reportingTimeline
  );
  const previewExportReadiness = summarizePreviewExportReadiness(
    job,
    diagnosticEmission,
    exportSummary,
    reportingTimeline
  );
  const clientExportReadiness = buildClientExportReadinessCard({
    job,
    diagnosticEmission,
    runtimeSummary,
    preview,
    previewHandoff,
    adapterDispatchReadiness,
    clientRemediation,
    clientWorkflowRepair,
    exportSummary,
    artifactState: exportArtifactState,
    analyticsExportReport,
    reportingTimeline
  });
  const clientExportTimelineState = buildClientExportTimelineState({
    job,
    clientExportReadiness,
    analyticsExportReport,
    previewExportReadiness,
    exportSummary,
    artifactState: exportArtifactState,
    reportingTimeline
  });
  const clientReadinessDecision = buildClientReadinessDecision({
    job,
    diagnosticEmission,
    runtimeSummary,
    preview,
    previewHandoff,
    adapterDispatchReadiness,
    clientRemediation,
    clientWorkflowRepair,
    clientRuntimeAdoption,
    clientRuntimeSettings,
    clientStatusHandoff,
    clientExportReadiness,
    clientExportTimelineState,
    runtimeReleaseControls,
    providerExternalHandoff,
    exportSummary
  });
  const clientWorkflowStatus = summarizeClientWorkflowStatus({
    job,
    runtimeSummary,
    clientWorkflow,
    clientWorkflowRepair,
    adapterDispatchReadiness,
    clientReadinessDecision,
    clientExportReadiness,
    clientExportTimelineState,
    providerExternalHandoff
  });

  return {
    kind: "aios.mailchimp.metadataEmission",
    schemaVersion: "aios.mailchimp.metadata.v1",
    provider: "mailchimp",
    jobId: job.id,
    task: job.task,
    status: diagnosticEmission.status,
    runtimeAdapter: runtimeSummary.adapter,
    labels: {
      providerService: runtimeSummary.providerService,
      providerServiceStatus: providerServiceSummary.status,
      providerContinuityMode: providerServiceSummary.serviceContinuity.mode,
      providerReceiptEvidenceState: providerReceiptEvidence.state,
      providerExternalHandoffStatus: providerExternalHandoff.status,
      tenantPermissionDecisionStatus: tenantPermissionDecision.status,
      persistedCommandState: persistedCommandEvidence.state,
      clientWorkflowStatus: clientWorkflowStatus.status,
      runtimeReadiness: runtimeSummary.readinessStatus,
      serviceLevelObjectiveStatus: serviceLevelObjectives.status,
      highestCapabilityRisk: capabilitySummary.highestRisk,
      memorySync: memorySummary.syncRequired ? "provider-sync" : "local-only"
    },
    capabilities: capabilitySummary,
    memory: memorySummary,
    verifier: verifierSummary,
    runtime: runtimeSummary,
    providerService: providerServiceSummary,
    providerContinuity: providerServiceSummary.serviceContinuity,
    providerSyncCheckpoint,
    runtimeReleaseControls,
    workflowControlState,
    previewExportReadiness,
    serviceLevelObjectives,
    permissionGrantPlan: permissionGrantSummary,
    tenantPermissionEnforcement,
    tenantBoundaryPosture,
    tenantBoundaryHandoff,
    tenantPermissionDecision,
    providerReceiptEvidence,
    providerExternalHandoff,
    operationalIncidents,
    clientRemediation,
    clientCommandLeases,
    clientRuntimeAdoption,
    clientRuntimeSettings,
    clientStatusHandoff,
    clientWorkflowStatus,
    clientWorkflowRepair,
    statusRecovery,
    restartCheckpoints,
    restartReplay,
    clientReadinessDecision,
    diagnosticExportLedger: {
      schemaVersion: diagnosticEmission.exportLedger?.schemaVersion || "aios.mailchimp.diagnostic-export-ledger.v1",
      status: diagnosticEmission.exportLedger?.status || "unknown",
      exportReady: diagnosticEmission.exportLedger?.exportReady === true,
      nextAction: diagnosticEmission.exportLedger?.nextAction || null,
      resumeToken: diagnosticEmission.exportLedger?.resumeToken || null,
      statusRevision: diagnosticEmission.exportLedger?.statusRevision || null,
      counters: diagnosticEmission.exportLedger?.counters || {},
      rows: diagnosticEmission.exportLedger?.rows || [],
      historySnapshotIds: diagnosticEmission.exportLedger?.exportSummary?.historySnapshotIds || []
    },
    lifecycle: lifecycleClientState,
    clientWorkflow,
    clientWorkflowRepair,
    previewHandoff,
    adapterDispatchReadiness,
    persistedCommandEvidence,
    clientExportReadiness,
    clientExportTimelineState,
    health: operationalHealth,
    analytics: analyticsCounters,
    preview,
    history: {
      schemaVersion: "aios.mailchimp.history.v1",
      snapshotCount: historySnapshots.length,
      latestSnapshotId: historySnapshots.at(-1)?.id || null,
      snapshots: historySnapshots,
      reportingTimeline,
      timeline: historySnapshots.map((snapshot) => ({
        id: snapshot.id,
        order: snapshot.order,
        phase: snapshot.phase,
        status: snapshot.status,
        nextAction: snapshot.nextAction
      }))
    },
    diagnostics: {
      status: diagnosticEmission.status,
      counts: diagnosticEmission.counts,
      nextActions: diagnosticEmission.nextActions.slice(0, 5),
      actionableErrors: operationalHealth.actionableErrors,
      recoveryCommands: diagnosticEmission.recoveryCommands?.commands?.slice(0, 5) || [],
      clientCommandLeases: clientCommandLeases.leases.slice(0, 5),
      clientRuntimeAdoption: {
        status: clientRuntimeAdoption.status,
        readyForClientRuntime: clientRuntimeAdoption.readyForClientRuntime,
        nextAction: clientRuntimeAdoption.nextAction,
        missingStateKeys: clientRuntimeAdoption.missingStateKeys,
        pendingAckKeys: clientRuntimeAdoption.commandAck.pendingKeys
      },
      clientRuntimeSettings: {
        status: clientRuntimeSettings.status,
        readyForClientRuntime: clientRuntimeSettings.readyForClientRuntime,
        nextAction: clientRuntimeSettings.nextAction,
        settingsRevision: clientRuntimeSettings.settingsRevision,
        missingRequiredSettings: clientRuntimeSettings.missingRequiredSettings
      },
      clientStatusHandoff: {
        status: clientStatusHandoff.status,
        visibleStatus: clientStatusHandoff.visibleStatus,
        readyForClient: clientStatusHandoff.readyForClient,
        readyForRuntime: clientStatusHandoff.readyForRuntime,
        nextAction: clientStatusHandoff.nextAction,
        routeId: clientStatusHandoff.route.routeId,
        statusRevision: clientStatusHandoff.statusLedger.statusRevision,
        pendingAckKeys: clientStatusHandoff.commandAck.pendingKeys
      },
      clientWorkflowRepair: {
        state: clientWorkflowRepair.state,
        status: clientWorkflowRepair.status,
        ready: clientWorkflowRepair.ready,
        routeState: clientWorkflowRepair.routeState,
        nextAction: clientWorkflowRepair.nextAction,
        resumeToken: clientWorkflowRepair.resumeToken,
        retryable: clientWorkflowRepair.retry.retryable,
        retryAfterMs: clientWorkflowRepair.retry.retryAfterMs,
        blockedReasons: clientWorkflowRepair.blockedReasons
      },
      clientWorkflowStatus: {
        status: clientWorkflowStatus.status,
        readyForClient: clientWorkflowStatus.readyForClient,
        readyForRuntimeStart: clientWorkflowStatus.readyForRuntimeStart,
        nextAction: clientWorkflowStatus.nextAction,
        statusKey: clientWorkflowStatus.statusKey,
        blockedReasons: clientWorkflowStatus.blockedReasons,
        counters: clientWorkflowStatus.counters
      },
      operationalIncidents: {
        status: operationalIncidents.status,
        nextAction: operationalIncidents.nextAction,
        nextIncidentId: operationalIncidents.nextIncidentId,
        nextOwner: operationalIncidents.nextOwner,
        counts: operationalIncidents.counts,
        incidents: operationalIncidents.incidents.slice(0, 5)
      },
      clientRemediation: {
        status: clientRemediation.status,
        visibleStatus: clientRemediation.visibleStatus,
        readyForClient: clientRemediation.readyForClient,
        readyForRuntime: clientRemediation.readyForRuntime,
        nextAction: clientRemediation.nextAction,
        routeId: clientRemediation.route.routeId,
        counters: clientRemediation.counters,
        steps: clientRemediation.steps.slice(0, 5)
      },
      tenantBoundaryPosture: {
        status: tenantBoundaryPosture.status,
        postureKey: tenantBoundaryPosture.postureKey,
        safeForRuntime: tenantBoundaryPosture.safeForRuntime,
        safeForAuditAppend: tenantBoundaryPosture.safeForAuditAppend,
        nextAction: tenantBoundaryPosture.nextAction,
        driftFlags: tenantBoundaryPosture.counters.driftFlags,
        blockedDecisionIds: tenantBoundaryPosture.runtimeGate.blockedDecisionIds
      },
      tenantBoundaryHandoff: {
        boundaryKey: tenantBoundaryHandoff.boundaryKey,
        readyForRuntime: tenantBoundaryHandoff.readyForRuntime,
        requiresAuditAppend: tenantBoundaryHandoff.requiresAuditAppend,
        auditAppendReady: tenantBoundaryHandoff.auditAppendReady,
        nextAction: tenantBoundaryHandoff.nextAction,
        blockedReasons: tenantBoundaryHandoff.blockedReasons
      },
      tenantPermissionDecision: {
        decisionKey: tenantPermissionDecision.decisionKey,
        status: tenantPermissionDecision.status,
        ready: tenantPermissionDecision.ready,
        allowedForRuntime: tenantPermissionDecision.allowedForRuntime,
        auditReady: tenantPermissionDecision.audit.ready,
        nextAction: tenantPermissionDecision.nextAction,
        blockedReasons: tenantPermissionDecision.blockedReasons
      },
      failureState: {
        mode: diagnosticEmission.failureState?.mode || "unknown",
        summary: diagnosticEmission.failureState?.summary || {},
        nextRetry: diagnosticEmission.failureState?.nextRetry || null,
        adapterHandoff: diagnosticEmission.failureState?.adapterHandoff || null
      },
      statusRecovery: {
        state: statusRecovery.state,
        readyForRuntimeResume: statusRecovery.readyForRuntimeResume,
        nextAction: statusRecovery.nextAction,
        resumeToken: statusRecovery.resume.resumeToken,
        missingRequiredCheckpoints: statusRecovery.blocking.missingRequiredCheckpoints
      },
      restartCheckpoints: {
        status: restartCheckpoints.status,
        readyForColdRestart: restartCheckpoints.readyForColdRestart,
        nextAction: restartCheckpoints.nextAction,
        resumeToken: restartCheckpoints.resumeToken,
        missingRequiredCheckpoints: restartCheckpoints.blocking.missingRequiredCheckpoints
      },
      providerService: {
        status: providerServiceSummary.status,
        diagnosticIds: providerServiceSummary.diagnosticIds,
        nextAction: providerServiceSummary.clientState.nextAction,
        handoffReady: providerServiceSummary.externalHandoff.ready,
        continuityMode: providerServiceSummary.serviceContinuity.mode,
        continuityNextAction: providerServiceSummary.serviceContinuity.nextAction
      },
      providerSyncCheckpoint: {
        status: providerSyncCheckpoint.status,
        ready: providerSyncCheckpoint.ready,
        nextAction: providerSyncCheckpoint.nextAction,
        missingAckMounts: providerSyncCheckpoint.missingAckMounts,
        missingWatermarkMounts: providerSyncCheckpoint.missingWatermarkMounts
      },
      runtimeReleaseControls: {
        status: runtimeReleaseControls.status,
        readyForRuntimeStart: runtimeReleaseControls.readyForRuntimeStart,
        nextAction: runtimeReleaseControls.nextAction,
        nextGateId: runtimeReleaseControls.nextGateId,
        releaseKey: runtimeReleaseControls.releaseKey,
        blockedGateIds: runtimeReleaseControls.clientPatch.runtimeReleaseBlockedGateIds,
        waitingGateIds: runtimeReleaseControls.clientPatch.runtimeReleaseWaitingGateIds
      },
      adapterDispatchReadiness: {
        state: adapterDispatchReadiness.state,
        ready: adapterDispatchReadiness.ready,
        dispatchReady: adapterDispatchReadiness.dispatchReady,
        nextAction: adapterDispatchReadiness.nextAction,
        readinessKey: adapterDispatchReadiness.readinessKey,
        blockedGateIds: adapterDispatchReadiness.clientPatch.adapterDispatchBlockedGateIds,
        blockedReasons: adapterDispatchReadiness.blockedReasons
      },
      persistedCommandEvidence: {
        state: persistedCommandEvidence.state,
        ready: persistedCommandEvidence.ready,
        replaySafe: persistedCommandEvidence.replaySafe,
        restartSafe: persistedCommandEvidence.restartSafe,
        nextAction: persistedCommandEvidence.nextAction,
        evidenceKey: persistedCommandEvidence.evidenceKey,
        commandKey: persistedCommandEvidence.commandKey,
        blockedReasons: persistedCommandEvidence.blockedReasons
      },
      clientExportReadiness: {
        status: clientExportReadiness.status,
        readyForClient: clientExportReadiness.readyForClient,
        readyForRuntimeStart: clientExportReadiness.readyForRuntimeStart,
        nextAction: clientExportReadiness.nextAction,
        cardId: clientExportReadiness.cardId,
        blockedArtifacts: clientExportReadiness.clientPatch.metadataClientExportBlockedArtifacts,
        acceptanceRequired: clientExportReadiness.clientPatch.metadataClientExportAcceptanceRequired
      },
      clientExportTimelineState: {
        status: clientExportTimelineState.status,
        ready: clientExportTimelineState.ready,
        readyForClient: clientExportTimelineState.readyForClient,
        readyForRuntimeStart: clientExportTimelineState.readyForRuntimeStart,
        nextAction: clientExportTimelineState.nextAction,
        nextRowId: clientExportTimelineState.nextRowId,
        counters: clientExportTimelineState.counters
      },
      clientReadinessDecision: {
        status: clientReadinessDecision.status,
        readyForClient: clientReadinessDecision.readyForClient,
        readyForRuntimeStart: clientReadinessDecision.readyForRuntimeStart,
        nextAction: clientReadinessDecision.nextAction,
        decisionId: clientReadinessDecision.decisionId,
        nextValidationId: clientReadinessDecision.nextValidationId,
        blockedReasons: clientReadinessDecision.blockedReasons
      },
      serviceLevelObjectives: {
        status: serviceLevelObjectives.status,
        healthLevel: serviceLevelObjectives.healthLevel,
        readyForRuntimeRelease: serviceLevelObjectives.readyForRuntimeRelease,
        nextAction: serviceLevelObjectives.nextAction,
        nextBreachId: serviceLevelObjectives.nextBreachId,
        counters: serviceLevelObjectives.counters,
        breaches: serviceLevelObjectives.breaches.slice(0, 5)
      },
      permissionGrantPlan: {
        status: permissionGrantSummary.status,
        readyForAudit: permissionGrantSummary.readyForAudit,
        nextAction: permissionGrantSummary.nextAction,
        blockingCommandIds: permissionGrantSummary.blockingCommandIds,
        retryableCommandIds: permissionGrantSummary.retryableCommandIds
      },
      tenantPermissionEnforcement: {
        status: tenantPermissionEnforcement.status,
        enforcementKey: tenantPermissionEnforcement.enforcementKey,
        nextAction: tenantPermissionEnforcement.nextAction,
        auditReady: tenantPermissionEnforcement.audit.ready,
        blockedDecisions: tenantPermissionEnforcement.counters.blocked,
        retryableDecisions: tenantPermissionEnforcement.counters.retryable
      },
      statusLedger: diagnosticEmission.statusLedger || null
    },
    exports: {
      summary: exportSummary,
      previewAcceptance: preview.acceptance,
      previewExportReadiness,
      lifecycleClientState,
      clientWorkflow,
      previewHandoff,
      adapterDispatchReadiness,
      persistedCommandEvidence,
      clientExportReadiness,
      clientExportTimelineState,
      clientReadinessDecision,
      providerServiceHandoff: providerServiceSummary.externalHandoff,
      providerContinuity: providerServiceSummary.serviceContinuity,
      providerSyncCheckpoint,
      runtimeReleaseControls,
      serviceLevelObjectives,
      permissionGrantPlan: permissionGrantSummary,
      tenantPermissionEnforcement,
      tenantBoundaryPosture,
      tenantBoundaryHandoff,
      tenantPermissionDecision,
      operationalIncidents,
      clientRemediation,
      clientCommandLeases,
      clientRuntimeAdoption,
      clientRuntimeSettings,
      clientStatusHandoff,
      clientWorkflowRepair,
      statusRecovery,
      restartCheckpoints,
      diagnosticExportLedger: diagnosticEmission.exportLedger || null,
      previewExportReadinessArtifact: previewExportReadiness.exportSummary.artifactName,
      runtimeReleaseControlsArtifact: "runtime-release-controls.json",
      analyticsExportReport,
      artifactState: exportArtifactState,
      reportingTimeline: {
        rowCount: reportingTimeline.rowCount,
        latestRowId: reportingTimeline.latestRowId,
        blockedRows: reportingTimeline.blockedRows
      },
      recommendedArtifactNames: exportSummary.recommendedArtifacts,
      deterministic: true,
      externalWrites: false
    },
    truthBoundary: {
      source: "metadata-emitter",
      deterministic: true,
      externalMailchimpStateVerified: false,
      includesRuntimeStatusHandoff: true,
      includesRecoveryActions: diagnosticEmission.nextActions.length > 0,
      includesAnalyticsCounters: true,
      includesHistorySnapshots: true,
      includesReportingTimeline: true,
      includesAnalyticsExportReport: true,
      includesDiagnosticExportLedger: true,
      includesPreviewExportReadiness: true,
      includesOperationalIncidentSummary: true,
      includesServiceLevelObjectiveSummary: true,
      includesClientRemediationSummary: true,
      includesFailureState: true,
      includesPreviewAcceptance: true,
      includesLifecycleClientState: true
      ,
      includesProviderServiceContract: true,
      includesProviderSyncCheckpoint: true,
      includesRuntimeReleaseControls: true,
      includesPermissionGrantPlan: true,
      includesTenantPermissionEnforcement: true,
      includesTenantBoundaryPosture: true,
      includesTenantBoundaryHandoff: true,
      includesTenantPermissionDecision: true,
      includesScopedClientWorkflow: true
      ,
      includesClientCommandLeases: true
      ,
      includesClientRuntimeAdoptionSummary: true
      ,
      includesClientRuntimeSettingsSummary: true,
      includesClientStatusHandoffSummary: true,
      includesClientWorkflowRepairSummary: true,
      includesStatusRecoverySummary: true
      ,
      includesRestartCheckpointSummary: true
      ,
      includesRestartReplaySummary: true
      ,
      includesAdapterDispatchReadiness: true,
      includesClientExportReadinessCard: true,
      includesClientExportTimelineState: true
    }
  };
}

export function assertMailchimpMetadataReady(metadata) {
  const missing = [];
  if (metadata?.provider !== "mailchimp") missing.push("provider");
  if (!metadata?.jobId) missing.push("jobId");
  if (!metadata?.runtimeAdapter) missing.push("runtimeAdapter");
  if (!metadata?.capabilities?.count) missing.push("capabilities");
  if (!metadata?.memory?.count) missing.push("memory");
  if (!metadata?.health?.statusHandoff?.idempotencyKey) missing.push("health.statusHandoff");
  if (!metadata?.health?.adapterFailureState?.mode) missing.push("health.adapterFailureState");
  if (!metadata?.lifecycle?.schemaVersion) missing.push("lifecycle");
  if (!metadata?.analytics?.schemaVersion) missing.push("analytics");
  if (metadata?.operationalIncidents?.schemaVersion !== "aios.mailchimp.operational-incident-summary.v1") missing.push("operationalIncidents");
  if (!metadata?.operationalIncidents?.nextAction) missing.push("operationalIncidents.nextAction");
  if (metadata?.clientRemediation?.schemaVersion !== "aios.mailchimp.client-remediation-summary.v1") missing.push("clientRemediation");
  if (!metadata?.clientRemediation?.route?.idempotencyKey) missing.push("clientRemediation.route");
  if (metadata?.clientRemediation?.restartSemantics?.externalWritesPerformed !== false) missing.push("clientRemediation.restartSemantics");
  if (!metadata?.preview?.acceptance?.acceptanceToken) missing.push("preview.acceptance");
    if (!metadata?.clientWorkflow?.schemaVersion) missing.push("clientWorkflow");
  if (!metadata?.clientWorkflow?.explainNextStep?.action) missing.push("clientWorkflow.explainNextStep");
  if (metadata?.previewHandoff?.schemaVersion !== "aios.mailchimp.preview-handoff-summary.v1") missing.push("previewHandoff");
  if (!metadata?.previewHandoff?.acceptance?.token) missing.push("previewHandoff.acceptance");
  if (!metadata?.previewHandoff?.routePayload?.idempotencyKey) missing.push("previewHandoff.routePayload");
  if (!metadata?.clientCommandLeases?.schemaVersion) missing.push("clientCommandLeases");
  if (!metadata?.clientCommandLeases?.resumeToken) missing.push("clientCommandLeases.resumeToken");
  if (metadata?.clientRuntimeAdoption?.schemaVersion !== "aios.mailchimp.client-runtime-adoption-summary.v1") missing.push("clientRuntimeAdoption");
  if (!metadata?.clientRuntimeAdoption?.adoptionId) missing.push("clientRuntimeAdoption.adoptionId");
  if (metadata?.clientRuntimeSettings?.schemaVersion !== "aios.mailchimp.client-runtime-settings-summary.v1") missing.push("clientRuntimeSettings");
  if (!metadata?.clientRuntimeSettings?.settingsRevision) missing.push("clientRuntimeSettings.settingsRevision");
  if (metadata?.clientStatusHandoff?.schemaVersion !== "aios.mailchimp.client-status-handoff-summary.v1") missing.push("clientStatusHandoff");
  if (!metadata?.clientStatusHandoff?.route?.idempotencyKey) missing.push("clientStatusHandoff.route");
  if (metadata?.clientStatusHandoff?.restartSemantics?.externalWritesPerformed !== false) missing.push("clientStatusHandoff.restartSemantics");
  if (metadata?.clientWorkflowRepair?.schemaVersion !== "aios.mailchimp.client-workflow-repair-summary.v1") missing.push("clientWorkflowRepair");
  if (!metadata?.clientWorkflowRepair?.resumeToken) missing.push("clientWorkflowRepair.resumeToken");
  if (metadata?.clientWorkflowRepair?.restartSemantics?.externalWritesPerformed !== false) missing.push("clientWorkflowRepair.restartSemantics");
  if (metadata?.clientWorkflowStatus?.schemaVersion !== "aios.mailchimp.client-workflow-status.v1") missing.push("clientWorkflowStatus");
  if (!metadata?.clientWorkflowStatus?.statusKey) missing.push("clientWorkflowStatus.statusKey");
  if (!metadata?.clientWorkflowStatus?.route?.idempotencyKey) missing.push("clientWorkflowStatus.route");
  if (metadata?.clientWorkflowStatus?.restartSemantics?.externalWritesPerformed !== false) missing.push("clientWorkflowStatus.restartSemantics");
  if (metadata?.statusRecovery?.schemaVersion !== "aios.mailchimp.status-recovery-summary.v1") missing.push("statusRecovery");
  if (!metadata?.statusRecovery?.resume?.resumeToken) missing.push("statusRecovery.resumeToken");
  if (metadata?.restartCheckpoints?.schemaVersion !== "aios.mailchimp.restart-checkpoint-summary.v1") missing.push("restartCheckpoints");
  if (!metadata?.restartCheckpoints?.resumeToken) missing.push("restartCheckpoints.resumeToken");
  if (metadata?.restartReplay?.schemaVersion !== "aios.mailchimp.restart-replay-summary.v1") missing.push("restartReplay");
  if (!metadata?.restartReplay?.resumeToken) missing.push("restartReplay.resumeToken");
  if (metadata?.restartReplay?.restartSemantics?.externalWritesPerformed !== false) missing.push("restartReplay.restartSemantics");
  if (!metadata?.history?.snapshotCount) missing.push("history");
  if (!metadata?.exports?.summary?.resumeToken) missing.push("exports.summary");
  if (metadata?.diagnosticExportLedger?.schemaVersion !== "aios.mailchimp.diagnostic-export-ledger.v1") missing.push("diagnosticExportLedger");
  if (!metadata?.diagnosticExportLedger?.resumeToken) missing.push("diagnosticExportLedger.resumeToken");
  if (metadata?.previewExportReadiness?.schemaVersion !== "aios.mailchimp.preview-export-readiness-summary.v1") missing.push("previewExportReadiness");
  if (!metadata?.previewExportReadiness?.resumeToken) missing.push("previewExportReadiness.resumeToken");
  if (metadata?.previewExportReadiness?.restartSemantics?.externalWritesPerformed !== false) missing.push("previewExportReadiness.restartSemantics");
  if (!metadata?.exports?.analyticsExportReport?.reportId) missing.push("exports.analyticsExportReport");
  if (!metadata?.exports?.artifactState?.length) missing.push("exports.artifactState");
  if (!metadata?.history?.reportingTimeline?.latestRowId) missing.push("history.reportingTimeline");
  if (!metadata?.providerService?.externalHandoff?.idempotencyKey) missing.push("providerService.externalHandoff");
  if (metadata?.providerContinuity?.schemaVersion !== "aios.mailchimp.provider-continuity-summary.v1") missing.push("providerContinuity");
  if (!metadata?.providerContinuity?.continuityKey) missing.push("providerContinuity.continuityKey");
  if (metadata?.providerContinuity?.restartSemantics?.externalWritesPerformed !== false) missing.push("providerContinuity.restartSemantics");
  if (metadata?.providerSyncCheckpoint?.schemaVersion !== "aios.mailchimp.provider-sync-checkpoint-summary.v1") missing.push("providerSyncCheckpoint");
  if (!metadata?.providerSyncCheckpoint?.resumeToken) missing.push("providerSyncCheckpoint.resumeToken");
  if (metadata?.runtimeReleaseControls?.schemaVersion !== "aios.mailchimp.runtime-release-controls-summary.v1") missing.push("runtimeReleaseControls");
  if (!metadata?.runtimeReleaseControls?.releaseKey) missing.push("runtimeReleaseControls.releaseKey");
  if (metadata?.runtimeReleaseControls?.restartSemantics?.externalWritesPerformed !== false) missing.push("runtimeReleaseControls.restartSemantics");
  if (metadata?.workflowControlState?.schemaVersion !== "aios.mailchimp.workflow-control-state.v1") missing.push("workflowControlState");
  if (!metadata?.workflowControlState?.controlKey) missing.push("workflowControlState.controlKey");
  if (metadata?.workflowControlState?.restartSemantics?.externalWritesPerformed !== false) missing.push("workflowControlState.restartSemantics");
  if (metadata?.serviceLevelObjectives?.schemaVersion !== "aios.mailchimp.service-level-objective-summary.v1") missing.push("serviceLevelObjectives");
  if (!metadata?.serviceLevelObjectives?.nextAction) missing.push("serviceLevelObjectives.nextAction");
  if (metadata?.serviceLevelObjectives?.restartSemantics?.externalWritesPerformed !== false) missing.push("serviceLevelObjectives.restartSemantics");
  if (metadata?.permissionGrantPlan?.schemaVersion !== "aios.mailchimp.permission-grant-summary.v1") missing.push("permissionGrantPlan");
  if (!metadata?.permissionGrantPlan?.nextAction) missing.push("permissionGrantPlan.nextAction");
  if (metadata?.tenantPermissionEnforcement?.schemaVersion !== "aios.mailchimp.tenant-permission-enforcement-summary.v1") missing.push("tenantPermissionEnforcement");
  if (!metadata?.tenantPermissionEnforcement?.enforcementKey) missing.push("tenantPermissionEnforcement.enforcementKey");
  if (metadata?.tenantBoundaryPosture?.schemaVersion !== "aios.mailchimp.tenant-boundary-posture-summary.v1") missing.push("tenantBoundaryPosture");
  if (!metadata?.tenantBoundaryPosture?.postureKey) missing.push("tenantBoundaryPosture.postureKey");
  if (metadata?.tenantBoundaryPosture?.restartSemantics?.externalWritesPerformed !== false) missing.push("tenantBoundaryPosture.restartSemantics");
  if (metadata?.tenantBoundaryHandoff?.schemaVersion !== "aios.mailchimp.tenant-boundary-handoff.v1") missing.push("tenantBoundaryHandoff");
  if (!metadata?.tenantBoundaryHandoff?.boundaryKey) missing.push("tenantBoundaryHandoff.boundaryKey");
  if (metadata?.tenantBoundaryHandoff?.restartSemantics?.externalWritesPerformed !== false) missing.push("tenantBoundaryHandoff.restartSemantics");
  if (metadata?.tenantPermissionDecision?.schemaVersion !== "aios.mailchimp.tenant-permission-decision-summary.v1") missing.push("tenantPermissionDecision");
  if (!metadata?.tenantPermissionDecision?.decisionKey) missing.push("tenantPermissionDecision.decisionKey");
  if (metadata?.tenantPermissionDecision?.restartSemantics?.externalWritesPerformed !== false) missing.push("tenantPermissionDecision.restartSemantics");
  if (metadata?.providerReceiptEvidence?.schemaVersion !== "aios.mailchimp.provider-receipt-evidence-summary.v1") missing.push("providerReceiptEvidence");
  if (!metadata?.providerReceiptEvidence?.evidenceKey) missing.push("providerReceiptEvidence.evidenceKey");
  if (metadata?.providerReceiptEvidence?.restartSemantics?.externalWritesPerformed !== false) missing.push("providerReceiptEvidence.restartSemantics");
  if (metadata?.providerExternalHandoff?.schemaVersion !== "aios.mailchimp.provider-external-handoff-summary.v1") missing.push("providerExternalHandoff");
  if (!metadata?.providerExternalHandoff?.handoffKey) missing.push("providerExternalHandoff.handoffKey");
  if (!metadata?.providerExternalHandoff?.route?.idempotencyKey) missing.push("providerExternalHandoff.route");
  if (metadata?.providerExternalHandoff?.restartSemantics?.externalWritesPerformed !== false) missing.push("providerExternalHandoff.restartSemantics");
  if (metadata?.adapterDispatchReadiness?.schemaVersion !== "aios.mailchimp.adapter-dispatch-readiness-summary.v1") missing.push("adapterDispatchReadiness");
  if (!metadata?.adapterDispatchReadiness?.readinessKey) missing.push("adapterDispatchReadiness.readinessKey");
  if (metadata?.adapterDispatchReadiness?.restartSemantics?.externalWritesPerformed !== false) missing.push("adapterDispatchReadiness.restartSemantics");
  if (metadata?.persistedCommandEvidence?.schemaVersion !== "aios.mailchimp.persisted-command-evidence-summary.v1") missing.push("persistedCommandEvidence");
  if (!metadata?.persistedCommandEvidence?.evidenceKey) missing.push("persistedCommandEvidence.evidenceKey");
  if (!metadata?.persistedCommandEvidence?.route?.idempotencyKey) missing.push("persistedCommandEvidence.route");
  if (metadata?.persistedCommandEvidence?.restartSemantics?.externalWritesPerformed !== false) missing.push("persistedCommandEvidence.restartSemantics");
  if (metadata?.clientExportReadiness?.schemaVersion !== "aios.mailchimp.client-export-readiness-card.v1") missing.push("clientExportReadiness");
  if (!metadata?.clientExportReadiness?.cardId) missing.push("clientExportReadiness.cardId");
  if (!metadata?.clientExportReadiness?.route?.idempotencyKey) missing.push("clientExportReadiness.route");
  if (metadata?.clientExportReadiness?.restartSemantics?.externalWritesPerformed !== false) missing.push("clientExportReadiness.restartSemantics");
  if (metadata?.clientExportTimelineState?.schemaVersion !== "aios.mailchimp.client-export-timeline-state.v1") missing.push("clientExportTimelineState");
  if (!metadata?.clientExportTimelineState?.route?.idempotencyKey) missing.push("clientExportTimelineState.route");
  if (metadata?.clientExportTimelineState?.restartSemantics?.externalWritesPerformed !== false) missing.push("clientExportTimelineState.restartSemantics");
  if (metadata?.clientReadinessDecision?.schemaVersion !== "aios.mailchimp.client-readiness-decision.v1") missing.push("clientReadinessDecision");
  if (!metadata?.clientReadinessDecision?.decisionId) missing.push("clientReadinessDecision.decisionId");
  if (!metadata?.clientReadinessDecision?.route?.idempotencyKey) missing.push("clientReadinessDecision.route");
  if (metadata?.clientReadinessDecision?.restartSemantics?.externalWritesPerformed !== false) missing.push("clientReadinessDecision.restartSemantics");

  return {
    ok: missing.length === 0,
    missing,
    healthLevel: metadata?.health?.level || "unknown",
    degradedMode: metadata?.health?.degradedMode === true,
    failureMode: metadata?.health?.adapterFailureState?.mode || "unknown",
    retryableFailureCount: metadata?.health?.adapterFailureState?.retryable || 0,
    lifecycleStatus: metadata?.lifecycle?.status || "unknown",
    runtimeStartEnabled: metadata?.lifecycle?.runtimeStartEnabled === true,
    previewStatus: metadata?.preview?.status || "unknown",
    previewReady: metadata?.preview?.readyForPreview === true,
    acceptanceToken: metadata?.preview?.acceptance?.acceptanceToken || null,
    clientWorkflowStatus: metadata?.clientWorkflow?.status || "unknown",
    clientWorkflowAction: metadata?.clientWorkflow?.primaryAction || null,
    previewHandoffStatus: metadata?.previewHandoff?.status || "unknown",
    previewHandoffReadyForAcceptance: metadata?.previewHandoff?.readyForAcceptance === true,
    previewHandoffReadyForRuntimeStart: metadata?.previewHandoff?.readyForRuntimeStart === true,
    previewHandoffNextAction: metadata?.previewHandoff?.primaryAction || null,
    previewHandoffRouteId: metadata?.previewHandoff?.routeId || null,
    previewHandoffAcceptanceToken: metadata?.previewHandoff?.acceptance?.token || null,
    clientCommandLeaseStatus: metadata?.clientCommandLeases?.leaseStatus || "unknown",
    clientCommandAckRequired: metadata?.clientCommandLeases?.ackRequired === true,
    clientRuntimeAdoptionStatus: metadata?.clientRuntimeAdoption?.status || "unknown",
    clientRuntimeReady: metadata?.clientRuntimeAdoption?.readyForClientRuntime === true,
    clientRuntimeAdoptionNextAction: metadata?.clientRuntimeAdoption?.nextAction || null,
    clientRuntimeSettingsStatus: metadata?.clientRuntimeSettings?.status || "unknown",
    clientRuntimeSettingsReady: metadata?.clientRuntimeSettings?.readyForClientRuntime === true,
    clientRuntimeSettingsRevision: metadata?.clientRuntimeSettings?.settingsRevision || null,
    clientRuntimeSettingsNextAction: metadata?.clientRuntimeSettings?.nextAction || null,
    clientWorkflowRepairState: metadata?.clientWorkflowRepair?.state || "unknown",
    clientWorkflowRepairReady: metadata?.clientWorkflowRepair?.ready === true,
    clientWorkflowRepairNextAction: metadata?.clientWorkflowRepair?.nextAction || null,
    clientWorkflowRepairRetryable: metadata?.clientWorkflowRepair?.retry?.retryable === true,
    clientWorkflowRepairBlockedReasons: metadata?.clientWorkflowRepair?.blockedReasons || [],
    clientWorkflowStatus: metadata?.clientWorkflowStatus?.status || "unknown",
    clientWorkflowStatusKey: metadata?.clientWorkflowStatus?.statusKey || null,
    clientWorkflowStatusReadyForClient: metadata?.clientWorkflowStatus?.readyForClient === true,
    clientWorkflowStatusReadyForRuntimeStart: metadata?.clientWorkflowStatus?.readyForRuntimeStart === true,
    clientWorkflowStatusNextAction: metadata?.clientWorkflowStatus?.nextAction || null,
    clientWorkflowStatusBlockedReasons: metadata?.clientWorkflowStatus?.blockedReasons || [],
    statusRecoveryState: metadata?.statusRecovery?.state || "unknown",
    statusRecoveryReady: metadata?.statusRecovery?.readyForRuntimeResume === true,
    statusRecoveryNextAction: metadata?.statusRecovery?.nextAction || null,
    restartCheckpointStatus: metadata?.restartCheckpoints?.status || "unknown",
    restartCheckpointReady: metadata?.restartCheckpoints?.readyForColdRestart === true,
    restartCheckpointNextAction: metadata?.restartCheckpoints?.nextAction || null,
    restartCheckpointMissing: metadata?.restartCheckpoints?.blocking?.missingRequiredCheckpoints || [],
    restartReplayStatus: metadata?.restartReplay?.status || "unknown",
    restartReplayReady: metadata?.restartReplay?.replayReady === true,
    restartReplayNextAction: metadata?.restartReplay?.nextAction || null,
    restartReplayUnsafeRows: metadata?.restartReplay?.counters?.unsafe || 0,
    restartReplayAckRequired: metadata?.restartReplay?.counters?.ackRequired || 0,
    providerServiceStatus: metadata?.providerService?.status || "unknown",
    providerContinuityMode: metadata?.providerContinuity?.mode || "unknown",
    providerContinuityHealthy: metadata?.providerContinuity?.healthy === true,
    providerContinuityNextAction: metadata?.providerContinuity?.nextAction || null,
    providerContinuityRetryable: metadata?.providerContinuity?.retryable === true,
    providerContinuityDegradedReasons: metadata?.providerContinuity?.degradedReasons || [],
    providerSyncCheckpointStatus: metadata?.providerSyncCheckpoint?.status || "unknown",
    providerSyncCheckpointReady: metadata?.providerSyncCheckpoint?.ready === true,
    providerSyncCheckpointNextAction: metadata?.providerSyncCheckpoint?.nextAction || null,
    runtimeReleaseControlsStatus: metadata?.runtimeReleaseControls?.status || "unknown",
    runtimeReleaseControlsReady: metadata?.runtimeReleaseControls?.readyForRuntimeStart === true,
    runtimeReleaseControlsNextAction: metadata?.runtimeReleaseControls?.nextAction || null,
    runtimeReleaseControlsNextGateId: metadata?.runtimeReleaseControls?.nextGateId || null,
    runtimeReleaseControlsBlockedGateIds: metadata?.runtimeReleaseControls?.clientPatch?.runtimeReleaseBlockedGateIds || [],
    runtimeReleaseControlsWaitingGateIds: metadata?.runtimeReleaseControls?.clientPatch?.runtimeReleaseWaitingGateIds || [],
    workflowControlState: metadata?.workflowControlState?.state || "unknown",
    workflowControlReadyForRuntimeStart: metadata?.workflowControlState?.readyForRuntimeStart === true,
    workflowControlNextAction: metadata?.workflowControlState?.nextAction || null,
    workflowControlBlockedReasons: metadata?.workflowControlState?.blockedReasons || [],
    adapterDispatchReadinessState: metadata?.adapterDispatchReadiness?.state || "unknown",
    adapterDispatchReady: metadata?.adapterDispatchReadiness?.ready === true,
    adapterDispatchRuntimeReady: metadata?.adapterDispatchReadiness?.dispatchReady === true,
    adapterDispatchNextAction: metadata?.adapterDispatchReadiness?.nextAction || null,
    adapterDispatchReadinessKey: metadata?.adapterDispatchReadiness?.readinessKey || null,
    adapterDispatchBlockedReasons: metadata?.adapterDispatchReadiness?.blockedReasons || [],
    persistedCommandState: metadata?.persistedCommandEvidence?.state || "unknown",
    persistedCommandReady: metadata?.persistedCommandEvidence?.ready === true,
    persistedCommandReplaySafe: metadata?.persistedCommandEvidence?.replaySafe === true,
    persistedCommandEvidenceKey: metadata?.persistedCommandEvidence?.evidenceKey || null,
    persistedCommandNextAction: metadata?.persistedCommandEvidence?.nextAction || null,
    persistedCommandBlockedReasons: metadata?.persistedCommandEvidence?.blockedReasons || [],
    clientExportReadinessStatus: metadata?.clientExportReadiness?.status || "unknown",
    clientExportReadinessReady: metadata?.clientExportReadiness?.readyForClient === true,
    clientExportReadinessRuntimeReady: metadata?.clientExportReadiness?.readyForRuntimeStart === true,
    clientExportReadinessNextAction: metadata?.clientExportReadiness?.nextAction || null,
    clientExportReadinessCardId: metadata?.clientExportReadiness?.cardId || null,
    clientExportReadinessBlockedArtifacts: metadata?.clientExportReadiness?.clientPatch?.metadataClientExportBlockedArtifacts || [],
    clientExportTimelineStatus: metadata?.clientExportTimelineState?.status || "unknown",
    clientExportTimelineReady: metadata?.clientExportTimelineState?.ready === true,
    clientExportTimelineNextAction: metadata?.clientExportTimelineState?.nextAction || null,
    clientExportTimelineNextRowId: metadata?.clientExportTimelineState?.nextRowId || null,
    clientExportTimelineBlockedRows: metadata?.clientExportTimelineState?.clientPatch?.metadataClientExportTimelineBlockedRows || [],
    clientReadinessDecisionStatus: metadata?.clientReadinessDecision?.status || "unknown",
    clientReadinessDecisionReadyForClient: metadata?.clientReadinessDecision?.readyForClient === true,
    clientReadinessDecisionReadyForRuntimeStart: metadata?.clientReadinessDecision?.readyForRuntimeStart === true,
    clientReadinessDecisionNextAction: metadata?.clientReadinessDecision?.nextAction || null,
    clientReadinessDecisionId: metadata?.clientReadinessDecision?.decisionId || null,
    clientReadinessNextValidationId: metadata?.clientReadinessDecision?.nextValidationId || null,
    clientReadinessBlockedReasons: metadata?.clientReadinessDecision?.blockedReasons || [],
    serviceLevelObjectiveStatus: metadata?.serviceLevelObjectives?.status || "unknown",
    serviceLevelObjectiveHealth: metadata?.serviceLevelObjectives?.healthLevel || "unknown",
    serviceLevelObjectiveReadyForRuntimeRelease: metadata?.serviceLevelObjectives?.readyForRuntimeRelease === true,
    serviceLevelObjectiveBreaches: metadata?.serviceLevelObjectives?.counters?.breached || 0,
    serviceLevelObjectiveBlocking: metadata?.serviceLevelObjectives?.counters?.blocking || 0,
    serviceLevelObjectiveNextAction: metadata?.serviceLevelObjectives?.nextAction || null,
    permissionGrantPlanStatus: metadata?.permissionGrantPlan?.status || "unknown",
    permissionGrantPlanReady: metadata?.permissionGrantPlan?.readyForAudit === true,
    permissionGrantPlanNextAction: metadata?.permissionGrantPlan?.nextAction || null,
    tenantPermissionEnforcementStatus: metadata?.tenantPermissionEnforcement?.status || "unknown",
    tenantPermissionEnforcementKey: metadata?.tenantPermissionEnforcement?.enforcementKey || null,
    tenantPermissionAuditReady: metadata?.tenantPermissionEnforcement?.audit?.ready === true,
    tenantPermissionBlockedDecisions: metadata?.tenantPermissionEnforcement?.counters?.blocked || 0,
    tenantBoundaryPostureStatus: metadata?.tenantBoundaryPosture?.status || "unknown",
    tenantBoundaryPostureKey: metadata?.tenantBoundaryPosture?.postureKey || null,
    tenantBoundarySafeForRuntime: metadata?.tenantBoundaryPosture?.safeForRuntime === true,
    tenantBoundarySafeForAuditAppend: metadata?.tenantBoundaryPosture?.safeForAuditAppend === true,
    tenantBoundaryPostureNextAction: metadata?.tenantBoundaryPosture?.nextAction || null,
    tenantBoundaryDriftFlags: metadata?.tenantBoundaryPosture?.counters?.driftFlags || 0,
    tenantBoundaryHandoffKey: metadata?.tenantBoundaryHandoff?.boundaryKey || null,
    tenantBoundaryHandoffReady: metadata?.tenantBoundaryHandoff?.readyForRuntime === true,
    tenantBoundaryHandoffNextAction: metadata?.tenantBoundaryHandoff?.nextAction || null,
    tenantBoundaryAuditAppendReady: metadata?.tenantBoundaryHandoff?.auditAppendReady === true,
    tenantBoundaryHandoffBlockedReasons: metadata?.tenantBoundaryHandoff?.blockedReasons || [],
    providerReceiptEvidenceState: metadata?.providerReceiptEvidence?.state || "unknown",
    providerReceiptEvidenceReady: metadata?.providerReceiptEvidence?.ready === true,
    providerReceiptEvidenceKey: metadata?.providerReceiptEvidence?.evidenceKey || null,
    providerReceiptEvidenceNextAction: metadata?.providerReceiptEvidence?.nextAction || null,
    providerReceiptEvidenceMissing: metadata?.providerReceiptEvidence?.missingEvidence || [],
    providerExternalHandoffStatus: metadata?.providerExternalHandoff?.status || "unknown",
    providerExternalHandoffReady: metadata?.providerExternalHandoff?.ready === true,
    providerExternalHandoffReplaySafe: metadata?.providerExternalHandoff?.replaySafe === true,
    providerExternalHandoffKey: metadata?.providerExternalHandoff?.handoffKey || null,
    providerExternalHandoffNextAction: metadata?.providerExternalHandoff?.nextAction || null,
    providerExternalHandoffMissingEvidence: metadata?.providerExternalHandoff?.missingEvidence || [],
    operationalIncidentStatus: metadata?.operationalIncidents?.status || "unknown",
    operationalIncidentCount: metadata?.operationalIncidents?.counts?.total || 0,
    operationalIncidentBlockingCount: metadata?.operationalIncidents?.counts?.blocking || 0,
    operationalIncidentNextAction: metadata?.operationalIncidents?.nextAction || null,
    clientRemediationStatus: metadata?.clientRemediation?.status || "unknown",
    clientRemediationReadyForClient: metadata?.clientRemediation?.readyForClient === true,
    clientRemediationReadyForRuntime: metadata?.clientRemediation?.readyForRuntime === true,
    clientRemediationRouteId: metadata?.clientRemediation?.route?.routeId || null,
    clientRemediationNextAction: metadata?.clientRemediation?.nextAction || null,
    clientRemediationBlocking: metadata?.clientRemediation?.counters?.blocking || 0,
    clientRemediationWaiting: metadata?.clientRemediation?.counters?.waiting || 0,
    providerServiceHandoffReady: metadata?.providerService?.externalHandoff?.ready === true,
    latestSnapshotId: metadata?.history?.latestSnapshotId || null,
    exportReady: metadata?.exports?.summary?.readyForExport === true,
    analyticsExportReady: metadata?.exports?.analyticsExportReport?.ready === true,
    analyticsExportStatus: metadata?.exports?.analyticsExportReport?.status || "unknown",
    blockedExportArtifacts: metadata?.exports?.analyticsExportReport?.artifacts?.blocked || 0,
    diagnosticExportLedgerReady: metadata?.diagnosticExportLedger?.exportReady === true,
    diagnosticExportLedgerRows: metadata?.diagnosticExportLedger?.rows?.length || 0,
    diagnosticExportLedgerNextAction: metadata?.diagnosticExportLedger?.nextAction || null,
    previewExportReadinessStatus: metadata?.previewExportReadiness?.status || "unknown",
    previewExportReady: metadata?.previewExportReadiness?.ready === true,
    previewExportRuntimeStartReady: metadata?.previewExportReadiness?.readyForRuntimeStart === true,
    previewExportNextAction: metadata?.previewExportReadiness?.nextAction || null,
    previewExportBlockedRows: metadata?.previewExportReadiness?.exportSummary?.blockedRowIds || [],
    reportingTimelineRows: metadata?.history?.reportingTimeline?.rowCount || 0,
    nextAction: missing.length ? "repair-metadata-emission" : metadata.health.retry.nextAction
  };
}
