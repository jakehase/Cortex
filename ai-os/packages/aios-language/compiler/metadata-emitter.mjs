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
    clientState: {
      providerServiceReady: externalHandoff.ready === true,
      providerSyncReady: syncMetadata.syncHandoffReady === true,
      capabilityNegotiationReady: unnegotiated.length === 0,
      nextAction: providerContract.nextAction || "handoff-to-runtime-adapter",
      badge: providerContract.status === "ready"
        ? "provider-ready"
        : providerContract.status === "blocked"
          ? "provider-blocked"
          : "provider-action-needed"
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

function buildAnalyticsCounters(job, capabilitySummary, memorySummary, verifierSummary, runtimeSummary, diagnosticEmission) {
  const diagnostics = diagnosticEmission.counts || { bySeverity: {}, byScope: {} };
  const commandPlan = diagnosticEmission.recoveryCommands || {};
  const commands = Array.isArray(commandPlan.commands) ? commandPlan.commands : [];
  const commandLeasePlan = diagnosticEmission.clientCommandLeases || {};
  const leases = Array.isArray(commandLeasePlan.leases) ? commandLeasePlan.leases : [];
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
      clientCommandLeases: leases.length,
      nextActions: diagnosticEmission.nextActions?.length || 0,
      failureStates: failureState.summary?.total || 0
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
      clientVisibleLeases: clientVisibleLeases.length,
      commandLeaseStatus: commandLeasePlan.leaseStatus || "unknown",
      failureStateMode: failureState.mode || "unknown",
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

function buildHistorySnapshots(job, runtimeSummary, diagnosticEmission, analyticsCounters) {
  const ledger = diagnosticEmission.statusLedger || {};
  const commandCursor = diagnosticEmission.recoveryCommands?.restartCursor || {};
  const failureState = diagnosticEmission.failureState || {};
  const baseId = `${job.id}:${ledger.statusRevision || diagnosticEmission.status}`;
  return [
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
    }
  ];
}

function buildExportReadySummary(job, runtimeSummary, diagnosticEmission, analyticsCounters, historySnapshots) {
  const ledger = diagnosticEmission.statusLedger || {};
  const latestSnapshot = historySnapshots.at(-1) || {};
  const providerService = diagnosticEmission.providerServiceContract || {};
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
      "status-snapshot.json"
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
      retryableCommands: analyticsCounters.runtimeRisk.retryableCommands
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
      commandAckRequiredLeases: analyticsCounters.runtimeRisk.ackRequiredLeases
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
      analyticsExportStatusRevision: exportSummary.statusRevision
    }
  };
}

function buildLifecycleClientState(job, diagnosticEmission, runtimeSummary, capabilitySummary) {
  const lifecycle = diagnosticEmission.lifecycleControls || {};
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
      idempotencyKey: `${job.id}:lifecycle:${lifecycle.status || "unknown"}:${nextAction}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "_")
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

function buildOperationalHealth(job, runtimeSummary, diagnosticEmission, lifecycleClientState) {
  const status = diagnosticEmission.status;
  const retry = retryProfileFor(status, diagnosticEmission);
  const failureState = diagnosticEmission.failureState || {};
  const providerService = diagnosticEmission.providerServiceContract || {};
  const commandLeasePlan = diagnosticEmission.clientCommandLeases || {};
  const clientRuntimeAdoption = summarizeClientRuntimeAdoption(job, diagnosticEmission, runtimeSummary);
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
  if (commandLeasePlan.leaseStatus === "awaiting-client-ack") degradedReasons.push("client-command-ack-required");
  if (commandLeasePlan.leaseStatus === "blocked") degradedReasons.push("client-command-lease-blocked");
  if (clientRuntimeAdoption.status === "blocked") degradedReasons.push("client-runtime-adoption-blocked");
  if (clientRuntimeAdoption.status === "waiting-for-client") degradedReasons.push("client-runtime-adoption-waiting");

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
    clientCommandLeases: summarizeClientCommandLeases(job, diagnosticEmission),
    clientRuntimeAdoption,
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
      clientRuntimeAdoptionId: clientRuntimeAdoption.adoptionId
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
  const statusRecovery = summarizeStatusRecovery(job, diagnosticEmission, runtimeSummary);
  const clientWorkflow = buildScopedClientWorkflow(
    job,
    diagnosticEmission,
    preview,
    lifecycleClientState,
    clientCommandLeases
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
      runtimeReadiness: runtimeSummary.readinessStatus,
      highestCapabilityRisk: capabilitySummary.highestRisk,
      memorySync: memorySummary.syncRequired ? "provider-sync" : "local-only"
    },
    capabilities: capabilitySummary,
    memory: memorySummary,
    verifier: verifierSummary,
    runtime: runtimeSummary,
    providerService: providerServiceSummary,
    clientCommandLeases,
    clientRuntimeAdoption,
    statusRecovery,
    lifecycle: lifecycleClientState,
    clientWorkflow,
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
      providerService: {
        status: providerServiceSummary.status,
        diagnosticIds: providerServiceSummary.diagnosticIds,
        nextAction: providerServiceSummary.clientState.nextAction,
        handoffReady: providerServiceSummary.externalHandoff.ready
      },
      statusLedger: diagnosticEmission.statusLedger || null
    },
    exports: {
      summary: exportSummary,
      previewAcceptance: preview.acceptance,
      lifecycleClientState,
      clientWorkflow,
      providerServiceHandoff: providerServiceSummary.externalHandoff,
      clientCommandLeases,
      clientRuntimeAdoption,
      statusRecovery,
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
      includesFailureState: true,
      includesPreviewAcceptance: true,
      includesLifecycleClientState: true
      ,
      includesProviderServiceContract: true,
      includesScopedClientWorkflow: true
      ,
      includesClientCommandLeases: true
      ,
      includesClientRuntimeAdoptionSummary: true
      ,
      includesStatusRecoverySummary: true
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
  if (!metadata?.preview?.acceptance?.acceptanceToken) missing.push("preview.acceptance");
  if (!metadata?.clientWorkflow?.schemaVersion) missing.push("clientWorkflow");
  if (!metadata?.clientWorkflow?.explainNextStep?.action) missing.push("clientWorkflow.explainNextStep");
  if (!metadata?.clientCommandLeases?.schemaVersion) missing.push("clientCommandLeases");
  if (!metadata?.clientCommandLeases?.resumeToken) missing.push("clientCommandLeases.resumeToken");
  if (metadata?.clientRuntimeAdoption?.schemaVersion !== "aios.mailchimp.client-runtime-adoption-summary.v1") missing.push("clientRuntimeAdoption");
  if (!metadata?.clientRuntimeAdoption?.adoptionId) missing.push("clientRuntimeAdoption.adoptionId");
  if (metadata?.statusRecovery?.schemaVersion !== "aios.mailchimp.status-recovery-summary.v1") missing.push("statusRecovery");
  if (!metadata?.statusRecovery?.resume?.resumeToken) missing.push("statusRecovery.resumeToken");
  if (!metadata?.history?.snapshotCount) missing.push("history");
  if (!metadata?.exports?.summary?.resumeToken) missing.push("exports.summary");
  if (!metadata?.exports?.analyticsExportReport?.reportId) missing.push("exports.analyticsExportReport");
  if (!metadata?.exports?.artifactState?.length) missing.push("exports.artifactState");
  if (!metadata?.history?.reportingTimeline?.latestRowId) missing.push("history.reportingTimeline");
  if (!metadata?.providerService?.externalHandoff?.idempotencyKey) missing.push("providerService.externalHandoff");

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
    clientCommandLeaseStatus: metadata?.clientCommandLeases?.leaseStatus || "unknown",
    clientCommandAckRequired: metadata?.clientCommandLeases?.ackRequired === true,
    clientRuntimeAdoptionStatus: metadata?.clientRuntimeAdoption?.status || "unknown",
    clientRuntimeReady: metadata?.clientRuntimeAdoption?.readyForClientRuntime === true,
    clientRuntimeAdoptionNextAction: metadata?.clientRuntimeAdoption?.nextAction || null,
    statusRecoveryState: metadata?.statusRecovery?.state || "unknown",
    statusRecoveryReady: metadata?.statusRecovery?.readyForRuntimeResume === true,
    statusRecoveryNextAction: metadata?.statusRecovery?.nextAction || null,
    providerServiceStatus: metadata?.providerService?.status || "unknown",
    providerServiceHandoffReady: metadata?.providerService?.externalHandoff?.ready === true,
    latestSnapshotId: metadata?.history?.latestSnapshotId || null,
    exportReady: metadata?.exports?.summary?.readyForExport === true,
    analyticsExportReady: metadata?.exports?.analyticsExportReport?.ready === true,
    analyticsExportStatus: metadata?.exports?.analyticsExportReport?.status || "unknown",
    blockedExportArtifacts: metadata?.exports?.analyticsExportReport?.artifacts?.blocked || 0,
    reportingTimelineRows: metadata?.history?.reportingTimeline?.rowCount || 0,
    nextAction: missing.length ? "repair-metadata-emission" : metadata.health.retry.nextAction
  };
}
