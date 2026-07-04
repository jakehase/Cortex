import {
  compileCapabilityAdapterHandoffReadiness,
  compileCapabilityBoundaryAuditManifest,
  compileCapabilityClientWorkflowAdoption,
  compileCapabilityCommandLedger,
  compileCapabilityClientRuntimeAdoptionQueue,
  compileCapabilityControlReviewPacket,
  compileCapabilityOperationalAnalytics,
  compileCapabilityProviderExecutionBatch,
  compileCapabilityRecoveryPlan,
  compileCapabilityRuntimeSettingsAdoption,
  compileCapabilityRuntimeBoundaryGate,
  compileCapabilityStateRecoveryEnvelope,
  compileMailchimpCapabilities,
  summarizeCapabilityLifecycle,
  summarizeCapabilityRisk
} from "./capability-compiler.mjs";
import {
  compileMemoryAdapterSyncReadiness,
  compileMemoryIntegrationExport,
  compileMailchimpMemoryMounts,
  compileMemoryHealthContract,
  compileMemoryLifecycleControls,
  compileMemoryOperationalResumePlan,
  compileMemoryProviderSyncReviewPacket,
  compileMemoryProviderSyncPayload,
  compileMemoryRecoveryPlan,
  compileRollbackMemoryPlan
} from "./memory-mount-compiler.mjs";
import {
  compileMailchimpVerifier,
  compileVerifierAnalyticsReport,
  compileVerifierAcceptanceReviewPacket,
  compileVerifierProviderServiceContract,
  compileVerifierReportHistoryManifest,
  compileVerifierRecoveryPlan,
  compileVerifierTimelineExport
} from "./verifier-compiler.mjs";

const DEFAULT_MAILCHIMP_JOB = {
  provider: "mailchimp",
  task: "campaign.syncDraft",
  actions: ["campaign.read", "campaign.update", "audience.read", "template.read"],
  memory: ["campaignDraft", "audienceSnapshot", "verifierEvidence", "rollbackJournal"],
  runtimeAdapter: "mailchimp.campaignRuntimeAdapter"
};

function stableJobId(seed) {
  const text = JSON.stringify(seed, Object.keys(seed).sort());
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `job_mailchimp_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function deterministicSnapshotId(jobId, label, payload) {
  return stableJobId({ jobId, label, payload }).replace("job_mailchimp_", `snapshot_${label}_`);
}

function severityCounts(diagnostics) {
  return diagnostics.reduce((counts, diagnostic) => {
    counts[diagnostic.level] = (counts[diagnostic.level] || 0) + 1;
    return counts;
  }, { error: 0, warning: 0, info: 0 });
}

function compileJobAnalytics(jobId, ast, contracts, diagnostics, status) {
  const capabilityRisk = summarizeCapabilityRisk(contracts.capabilities);
  const capabilityLifecycle = summarizeCapabilityLifecycle(contracts.capabilities);
  const memoryMounts = contracts.memory?.mounts || [];
  const verifierRules = contracts.verifier?.rules || [];
  const writeCapabilities = (contracts.capabilities?.capabilities || [])
    .filter((capability) => capability.constraints?.noExternalWrite)
    .map((capability) => capability.action);
  const providerSyncRequired = contracts.memory?.providerServiceContract?.syncRequired === true;
  const verifierPreview = contracts.verifier?.preview?.summary || {};
  const commandLedger = contracts.capabilities?.commandLedger || compileCapabilityCommandLedger(contracts.capabilities);
  const capabilityAnalytics = contracts.capabilities?.operationalAnalytics
    || compileCapabilityOperationalAnalytics(contracts.capabilities);
  const capabilityWorkflow = contracts.capabilities?.clientWorkflowAdoption
    || compileCapabilityClientWorkflowAdoption(contracts.capabilities);
  const clientRuntimeAdoption = contracts.capabilities?.clientRuntimeAdoptionQueue
    || compileCapabilityClientRuntimeAdoptionQueue(contracts.capabilities);
  const runtimeSettingsAdoption = contracts.capabilities?.runtimeSettingsAdoption
    || compileCapabilityRuntimeSettingsAdoption(contracts.capabilities);
  const verifierHealth = contracts.verifier?.health || {};
  const stateEnvelope = contracts.stateEnvelope || {};
  const memoryLifecycle = contracts.memory?.lifecycleControls || compileMemoryLifecycleControls(contracts.memory);
  const memoryIntegration = contracts.memory?.integrationExport || compileMemoryIntegrationExport(contracts.memory);
  const memoryProviderHandoff = contracts.memory?.providerHandoffAdoption
    || memoryIntegration.providerHandoffAdoption
    || {};
  const boundaryGate = contracts.capabilities?.runtimeBoundaryGate
    || compileCapabilityRuntimeBoundaryGate(contracts.capabilities);
  const handoffReview = contracts.handoffReviewPacket || {};
  const providerDispatch = contracts.providerRuntimeDispatchPacket || {};

  return {
    provider: "mailchimp",
    jobId,
    task: ast.task,
    status,
    counters: {
      capabilities: capabilityRisk.count,
      writeCapabilities: capabilityRisk.writeCount,
      disabledCapabilities: capabilityLifecycle.disabledCount,
      approvalGates: capabilityLifecycle.approvalGateCount,
      memoryMounts: memoryMounts.length,
      providerSyncMounts: memoryMounts.filter((mount) => mount.providerContract?.syncDirection !== "local-only").length,
      verifierRules: verifierRules.length,
      verifierBlockingRules: verifierPreview.blockingRuleIds?.length || 0,
      runtimeCommands: commandLedger.commandCount || 0,
      queuedRuntimeCommands: commandLedger.queuedCommandIds?.length || 0,
      approvalRuntimeCommands: commandLedger.approvalCommandIds?.length || 0,
      disabledRuntimeCommands: commandLedger.disabledCommandIds?.length || 0,
      boundaryGateActions: boundaryGate.counters?.actions || 0,
      blockedBoundaryActions: boundaryGate.counters?.blockedActions || 0,
      boundaryViolations: boundaryGate.counters?.boundaryViolations || 0,
      capabilityExportReadyActions: capabilityAnalytics.counters?.exportReadyActions || 0,
      capabilityBlockedActions: capabilityAnalytics.counters?.blockedActions || 0,
      memoryLifecycleControls: memoryLifecycle.counters?.mounts || 0,
      disabledMemoryMounts: memoryLifecycle.counters?.disabledMounts || 0,
      manualMemoryControls: memoryLifecycle.counters?.manualControls || 0,
      memoryIntegrationTimelineEvents: memoryIntegration.counters?.timelineEvents || 0,
      memoryIntegrationBlockedMounts: memoryIntegration.counters?.blockedMounts || 0,
      memoryCapabilityBlockedMounts: memoryProviderHandoff.counters?.blockedMounts || 0,
      memoryMissingCapabilities: memoryProviderHandoff.counters?.missingCapabilities || 0,
      memoryHeldCapabilityCommands: memoryProviderHandoff.counters?.heldCommandIds || 0,
      memoryNegotiatedCapabilities: memoryIntegration.counters?.requiredCapabilities || 0,
      capabilityWorkflowActions: capabilityWorkflow.validationSummary?.actions || 0,
      capabilityWorkflowQueueableActions: capabilityWorkflow.validationSummary?.queueableActions || 0,
      capabilityWorkflowBlockedActions: capabilityWorkflow.validationSummary?.blockedActions || 0,
      capabilityWorkflowOperatorActions: capabilityWorkflow.validationSummary?.operatorActionRequired || 0,
      clientRuntimeAdoptionCommands: clientRuntimeAdoption.counters?.commands || 0,
      clientRuntimeQueueableCommands: clientRuntimeAdoption.counters?.queueableCommands || 0,
      clientRuntimeHeldCommands: clientRuntimeAdoption.counters?.heldCommands || 0,
      clientRuntimeBlockingReasons: clientRuntimeAdoption.counters?.blockingReasons || 0,
      runtimeSettings: runtimeSettingsAdoption.counters?.settings || 0,
      runtimeSettingsChanged: runtimeSettingsAdoption.counters?.changedSettings || 0,
      runtimeSettingsBlocked: runtimeSettingsAdoption.counters?.blockedSettings || 0,
      runtimeSettingsProviderWrites: runtimeSettingsAdoption.counters?.providerWriteSettings || 0,
      handoffReviewComponents: handoffReview.counters?.components || 0,
      handoffReviewBlockedComponents: handoffReview.counters?.blockedComponents || 0,
      handoffReviewRequiredActions: handoffReview.counters?.requiredNextActions || 0,
      handoffReviewOptionalActions: handoffReview.counters?.optionalNextActions || 0,
      providerDispatchCapabilityCommands: providerDispatch.counters?.capabilityCommands || 0,
      providerDispatchHeldCapabilityCommands: providerDispatch.counters?.heldCapabilityCommands || 0,
      providerDispatchMemorySyncItems: providerDispatch.counters?.memorySyncItems || 0,
      providerDispatchBlockedMemoryMounts: providerDispatch.counters?.blockedMemoryMounts || 0,
      providerDispatchRequiredStateKeys: providerDispatch.counters?.requiredStateKeys || 0,
      verifierActionableErrors: verifierHealth.actionableErrors?.length || 0,
      persistedStateKeys: stateEnvelope.persistence?.requiredStateKeys?.length || 0,
      restartOperatorReviewItems: stateEnvelope.counters?.operatorReviewItems || 0,
      diagnostics: diagnostics.length,
      ...Object.fromEntries(Object.entries(severityCounts(diagnostics)).map(([key, value]) => [`diagnostics_${key}`, value]))
    },
    dimensions: {
      runtimeAdapter: ast.runtimeAdapter || DEFAULT_MAILCHIMP_JOB.runtimeAdapter,
      highestCapabilityRisk: capabilityRisk.highestRisk,
      providerSyncRequired,
      requiresApproval: capabilityRisk.requiresApproval || capabilityLifecycle.approvalGateCount > 0,
      localContractsVerified: status !== "blocked",
      commandLedgerStatus: commandLedger.status || "ready",
      verifierHealthStatus: verifierHealth.healthStatus || "unknown",
      restartStatus: stateEnvelope.restartStatus || "not-compiled",
      boundaryGateStatus: boundaryGate.status || "not-compiled",
      capabilityAnalyticsStatus: capabilityAnalytics.status || "not-compiled",
      memoryLifecycleStatus: memoryLifecycle.status || "not-compiled",
      memoryIntegrationStatus: memoryIntegration.status || "not-compiled",
      memoryProviderHandoffStatus: memoryProviderHandoff.status || "not-compiled",
      capabilityWorkflowStatus: capabilityWorkflow.status || "not-compiled",
      clientRuntimeAdoptionStatus: clientRuntimeAdoption.status || "not-compiled",
      runtimeSettingsAdoptionStatus: runtimeSettingsAdoption.status || "not-compiled",
      runtimeSettingsAcceptedForQueue: runtimeSettingsAdoption.acceptedForRuntimeQueue === true,
      handoffReviewStatus: handoffReview.status || "not-compiled",
      handoffReviewAcceptedForRuntime: handoffReview.acceptance?.acceptedForRuntime === true,
      providerDispatchStatus: providerDispatch.status || "not-compiled",
      providerDispatchAccepted: providerDispatch.acceptedForRuntimeDispatch === true,
      tenantIsolationKey: boundaryGate.tenantBoundary?.isolationKey || null
    },
    lifecycle: capabilityLifecycle,
    commands: {
      status: commandLedger.status || "ready",
      restartSafe: commandLedger.restartSafe !== false,
      queuedCommandIds: commandLedger.queuedCommandIds || [],
      approvalCommandIds: commandLedger.approvalCommandIds || [],
      disabledCommandIds: commandLedger.disabledCommandIds || []
    },
    verifierHealth: {
      status: verifierHealth.healthStatus || "unknown",
      degradedMode: verifierHealth.degradedMode || "unknown",
      retryable: verifierHealth.retryable !== false
    },
    persistedState: {
      restartStatus: stateEnvelope.restartStatus || "not-compiled",
      statusAfterRestart: stateEnvelope.statusAfterRestart || status,
      requiredStateKeys: stateEnvelope.persistence?.requiredStateKeys || [],
      adoptionEvents: stateEnvelope.persistence?.adoptionEvents || []
    },
    boundaryGate: {
      status: boundaryGate.status,
      enforcementMode: boundaryGate.enforcementMode,
      blockedActions: boundaryGate.clientControls?.blockedActions || [],
      approvalRequiredActions: boundaryGate.clientControls?.approvalRequiredActions || [],
      disabledActions: boundaryGate.clientControls?.disabledActions || [],
      nextActions: boundaryGate.clientControls?.nextActions || []
    },
    capabilityAnalytics: {
      snapshotId: capabilityAnalytics.snapshotId,
      status: capabilityAnalytics.status,
      exportReady: capabilityAnalytics.exportSummary?.acceptedForRuntime === true,
      blockedActionIds: capabilityAnalytics.exportSummary?.blockedActionIds || [],
      nextActions: capabilityAnalytics.exportSummary?.nextActions || []
    },
    capabilityWorkflow: {
      workflowId: capabilityWorkflow.workflowId,
      status: capabilityWorkflow.status,
      acceptedForClientPreview: capabilityWorkflow.readiness?.acceptedForClientPreview === true,
      acceptedForRuntimeQueue: capabilityWorkflow.readiness?.acceptedForRuntimeQueue === true,
      acceptedForProviderWrite: capabilityWorkflow.readiness?.acceptedForProviderWrite === true,
      nextStep: capabilityWorkflow.readiness?.nextStep || "not-compiled",
      requiredStateKeys: capabilityWorkflow.requestStateContract?.requiredStateKeys || [],
      validationSummary: capabilityWorkflow.validationSummary || {}
    },
    clientRuntimeAdoption: {
      snapshotId: clientRuntimeAdoption.snapshotId,
      status: clientRuntimeAdoption.status,
      acceptedForRuntimeQueue: clientRuntimeAdoption.clientHandoff?.acceptedForRuntimeQueue === true,
      acceptedForProviderWrite: clientRuntimeAdoption.clientHandoff?.acceptedForProviderWrite === true,
      queueableCommandIds: clientRuntimeAdoption.runtimeQueue?.queueableCommandIds || [],
      heldCommandIds: clientRuntimeAdoption.runtimeQueue?.heldCommandIds || [],
      nextAction: clientRuntimeAdoption.clientHandoff?.nextAction || "not-compiled",
      requiredStateKeys: clientRuntimeAdoption.requestStateContract?.requiredStateKeys || []
    },
    runtimeSettingsAdoption: {
      snapshotId: runtimeSettingsAdoption.snapshotId,
      status: runtimeSettingsAdoption.status,
      acceptedForRuntimeQueue: runtimeSettingsAdoption.acceptedForRuntimeQueue === true,
      acceptedForProviderWrite: runtimeSettingsAdoption.acceptedForProviderWrite === true,
      changedActions: runtimeSettingsAdoption.runtimeSettingsPatch?.changedActions || [],
      heldCommandIds: runtimeSettingsAdoption.runtimeSettingsPatch?.heldCommandIds || [],
      nextActions: runtimeSettingsAdoption.nextActions || [],
      requiredStateKeys: runtimeSettingsAdoption.persistedStateContract?.requiredStateKeys || []
    },
    handoffReview: {
      snapshotId: handoffReview.snapshotId,
      status: handoffReview.status || "not-compiled",
      acceptedForRuntime: handoffReview.acceptance?.acceptedForRuntime === true,
      acceptedForAdapterHandoff: handoffReview.acceptance?.acceptedForAdapterHandoff === true,
      blockedComponents: handoffReview.blockedComponents || [],
      nextActions: handoffReview.nextActions || []
    },
    providerRuntimeDispatch: {
      snapshotId: providerDispatch.snapshotId,
      status: providerDispatch.status || "not-compiled",
      acceptedForRuntimeDispatch: providerDispatch.acceptedForRuntimeDispatch === true,
      capabilityCommands: providerDispatch.dispatch?.capabilityCommands || [],
      heldCapabilityCommands: providerDispatch.dispatch?.heldCapabilityCommands || [],
      memorySyncQueue: providerDispatch.dispatch?.memorySyncQueue || [],
      blockedMemoryMounts: providerDispatch.dispatch?.blockedMemoryMounts || [],
      nextActions: providerDispatch.nextActions || []
    },
    memoryLifecycle: {
      status: memoryLifecycle.status,
      nextActions: memoryLifecycle.nextActions || [],
      requiredStateKeys: memoryLifecycle.persistedStateContract?.requiredStateKeys || [],
      counters: memoryLifecycle.counters || {}
    },
    memoryIntegration: {
      snapshotId: memoryIntegration.snapshotId,
      status: memoryIntegration.status,
      exportReady: memoryIntegration.exportSummary?.acceptedForRuntime === true,
      acceptedForProviderSync: memoryIntegration.exportSummary?.acceptedForProviderSync === true,
      blockedMounts: memoryIntegration.exportSummary?.blockedMounts || [],
      providerSyncMounts: memoryIntegration.exportSummary?.providerSyncMounts || [],
      requiredCapabilities: memoryIntegration.exportSummary?.requiredCapabilities || [],
      capabilityAdoptionStatus: memoryProviderHandoff.status || "not-compiled",
      blockedByCapabilityMounts: memoryProviderHandoff.adapterHandoff?.blockedMounts || [],
      missingCapabilities: memoryProviderHandoff.adapterHandoff?.missingCapabilities || [],
      heldCommandIds: memoryProviderHandoff.adapterHandoff?.heldCommandIds || [],
      nextActions: memoryIntegration.exportSummary?.nextActions || []
    },
    sync: contracts.memory?.providerServiceContract || {
      providerService: "mailchimp-marketing-api",
      syncRequired: false,
      capabilityNegotiation: [],
      handoffStates: {}
    }
  };
}

function compileJobStateEnvelope(jobId, ast, contracts, diagnostics, status, options = {}) {
  const commandLedger = contracts.capabilities?.commandLedger || compileCapabilityCommandLedger(contracts.capabilities);
  const capabilityState = contracts.capabilities?.stateRecoveryEnvelope
    || compileCapabilityStateRecoveryEnvelope(contracts.capabilities, options.persistedCommandState || {});
  const memoryHealth = contracts.memory?.health
    || compileMemoryHealthContract(contracts.memory, options);
  const memoryLifecycle = contracts.memory?.lifecycleControls || compileMemoryLifecycleControls(contracts.memory, options);
  const verifierReport = contracts.verifier?.analyticsReport
    || compileVerifierAnalyticsReport(contracts.verifier, null, options);
  const verifierHistory = contracts.verifier?.reportHistoryManifest
    || compileVerifierReportHistoryManifest(contracts.verifier, null, options);
  const capabilityWorkflow = contracts.capabilities?.clientWorkflowAdoption
    || compileCapabilityClientWorkflowAdoption(contracts.capabilities, options);
  const clientRuntimeAdoption = contracts.capabilities?.clientRuntimeAdoptionQueue
    || compileCapabilityClientRuntimeAdoptionQueue(contracts.capabilities, options);
  const runtimeSettingsAdoption = contracts.capabilities?.runtimeSettingsAdoption
    || compileCapabilityRuntimeSettingsAdoption(contracts.capabilities, options);
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const operatorReviewItems = [
    ...(capabilityState.commands || [])
      .filter((command) => command.requiresOperatorReview)
      .map((command) => ({
        source: "capability-command",
        id: command.commandId,
        nextAction: command.restartAction
      })),
    ...(memoryHealth.mounts || [])
      .filter((mount) => mount.healthStatus === "degraded" || mount.healthStatus === "unhealthy")
      .map((mount) => ({
        source: "memory",
        id: mount.mount,
        nextAction: mount.persistedState.restartAction
      })),
    ...(memoryLifecycle.nextActions || []).map((item) => ({
      source: "memory-lifecycle",
      id: item.mount,
      nextAction: item.nextAction
    })),
    ...(verifierHistory.reportSummary?.nextActions || [])
      .filter((item) => item.required)
      .map((item) => ({
        source: "verifier-history",
        id: item.ruleId,
        nextAction: item.nextAction
      })),
    ...(verifierReport.exportSummary?.blockingRuleIds || []).map((ruleId) => ({
      source: "verifier",
      id: ruleId,
      nextAction: "hydrate-required-client-state"
    })),
    ...(capabilityWorkflow.nextActions || []).map((item) => ({
      source: "capability-workflow",
      id: item.action,
      nextAction: item.nextAction
    })),
    ...(clientRuntimeAdoption.nextActions || []).map((item) => ({
      source: "capability-runtime-adoption",
      id: item.commandId,
      nextAction: item.nextAction
    })),
    ...(runtimeSettingsAdoption.nextActions || []).map((item) => ({
      source: "capability-runtime-settings",
      id: item.action,
      nextAction: item.nextAction
    }))
  ];
  const requiredStateKeys = Array.from(new Set([
    ...(commandLedger.clientStateContract?.requiredStateKeys || []),
    ...(capabilityWorkflow.requestStateContract?.requiredStateKeys || []),
    ...(clientRuntimeAdoption.requestStateContract?.requiredStateKeys || []),
    ...(runtimeSettingsAdoption.persistedStateContract?.requiredStateKeys || []),
    ...(memoryHealth.persistedStateContract?.requiredStateKeys || []),
    ...(memoryLifecycle.persistedStateContract?.requiredStateKeys || []),
    verifierReport.persistedStateContract?.snapshotKey,
    verifierReport.persistedStateContract?.statusKey,
    ...(verifierHistory.persistedStateContract?.requiredStateKeys || [])
  ].filter(Boolean))).sort();
  const adoptionEvents = Array.from(new Set([
    capabilityState.adoption?.event,
    capabilityWorkflow.requestStateContract?.adoptionEvent,
    clientRuntimeAdoption.requestStateContract?.adoptionEvent,
    runtimeSettingsAdoption.persistedStateContract?.adoptionEvent,
    memoryHealth.persistedStateContract?.adoptionEvent,
    memoryLifecycle.persistedStateContract?.adoptionEvent,
    verifierReport.persistedStateContract?.adoptionEvent,
    verifierHistory.persistedStateContract?.adoptionEvent,
    "mailchimp.job.state.adopted"
  ].filter(Boolean))).sort();
  const restartStatus = blockingDiagnostics.length
    ? "blocked"
    : capabilityState.status === "operator-review-required"
      ? "operator-review-required"
      : memoryHealth.healthStatus === "unhealthy"
        ? "blocked"
        : memoryLifecycle.status === "invalid" || memoryLifecycle.status === "disabled-mounts-block-runtime"
        ? "blocked"
        : memoryHealth.healthStatus === "degraded" || verifierReport.healthStatus === "degraded"
          || verifierHistory.status === "awaiting-evaluation"
          || memoryLifecycle.status === "manual-action-required"
          ? "degraded-restart"
          : status === "compiled"
            ? "restart-safe"
            : status;

  return {
    kind: "aios.jobPersistedStateEnvelope",
    provider: "mailchimp",
    jobId,
    task: ast.task,
    restartStatus,
    statusAfterRestart: restartStatus === "restart-safe" ? "ready-for-runtime" : restartStatus,
    idempotency: {
      commandLedgerStatus: commandLedger.status || "ready",
      restartSafeCommands: commandLedger.restartSafe !== false,
      writeCommandIds: commandLedger.writeCommandIds || [],
      duplicatePolicy: "return-persisted-provider-result-when-available"
    },
    persistence: {
      namespace: `jobs.${jobId}`,
      requiredStateKeys,
      adoptionEvents,
      missingStatePolicy: blockingDiagnostics.length
        ? "block-until-compile-errors-resolved"
        : "rebuild-derived-state-from-compiled-contracts",
      statusEvent: "mailchimp.job.state.status"
    },
    componentState: {
      capability: {
        status: capabilityState.status,
        restartSafe: capabilityState.restartSafe,
        workflowStatus: capabilityWorkflow.status,
        clientRuntimeAdoptionStatus: clientRuntimeAdoption.status,
        runtimeSettingsAdoptionStatus: runtimeSettingsAdoption.status,
        counters: capabilityState.counters
      },
      memory: {
        healthStatus: memoryHealth.healthStatus,
        runtimeMode: memoryHealth.runtimeMode,
        retryable: memoryHealth.retryable,
        lifecycleStatus: memoryLifecycle.status,
        counters: memoryHealth.counters
      },
      verifier: {
        snapshotId: verifierReport.snapshotId,
        reportHistorySnapshotId: verifierHistory.snapshotId,
        status: verifierReport.status,
        historyStatus: verifierHistory.status,
        healthStatus: verifierReport.healthStatus,
        counters: {
          ...(verifierReport.counters || {}),
          historySnapshots: verifierHistory.analytics?.counters?.snapshots || 0,
          historyTimelineEvents: verifierHistory.analytics?.counters?.timelineEvents || 0
        }
      }
    },
    counters: {
      requiredStateKeys: requiredStateKeys.length,
      adoptionEvents: adoptionEvents.length,
      operatorReviewItems: operatorReviewItems.length,
      capabilityWorkflowActions: capabilityWorkflow.validationSummary?.actions || 0,
      capabilityWorkflowNextActions: capabilityWorkflow.nextActions?.length || 0,
      clientRuntimeAdoptionCommands: clientRuntimeAdoption.counters?.commands || 0,
      clientRuntimeHeldCommands: clientRuntimeAdoption.counters?.heldCommands || 0,
      runtimeSettingsChanged: runtimeSettingsAdoption.counters?.changedSettings || 0,
      runtimeSettingsBlocked: runtimeSettingsAdoption.counters?.blockedSettings || 0,
      verifierHistorySnapshots: verifierHistory.analytics?.counters?.snapshots || 0,
      verifierHistoryTimelineEvents: verifierHistory.analytics?.counters?.timelineEvents || 0,
      blockingDiagnostics: blockingDiagnostics.length
    },
    operatorReviewItems,
    truthBoundary: {
      source: "job-descriptor-compiler",
      persistedExternally: false,
      externalMailchimpStateVerified: false,
      deterministic: true
    }
  };
}

function compileJobHistory(jobId, analytics, diagnostics) {
  const diagnosticCounts = severityCounts(diagnostics);
  const componentSnapshots = [
    {
      id: deterministicSnapshotId(jobId, "capability-analytics", {
        status: analytics.capabilityAnalytics.status,
        blockedActionIds: analytics.capabilityAnalytics.blockedActionIds
      }),
      label: "capability-analytics",
      status: analytics.capabilityAnalytics.status || "not-compiled",
      counters: {
        exportReadyActions: analytics.counters.capabilityExportReadyActions,
        blockedActions: analytics.counters.capabilityBlockedActions,
        runtimeCommands: analytics.counters.runtimeCommands
      }
    },
    {
      id: deterministicSnapshotId(jobId, "memory-integration", {
        status: analytics.memoryIntegration.status,
        blockedMounts: analytics.memoryIntegration.blockedMounts,
        providerSyncMounts: analytics.memoryIntegration.providerSyncMounts
      }),
      label: "memory-integration",
      status: analytics.memoryIntegration.status || "not-compiled",
      counters: {
        providerSyncMounts: analytics.counters.providerSyncMounts,
        blockedMounts: analytics.counters.memoryIntegrationBlockedMounts,
        requiredCapabilities: analytics.counters.memoryNegotiatedCapabilities
      }
    },
    {
      id: deterministicSnapshotId(jobId, "verifier-health", {
        status: analytics.verifierHealth.status,
        actionableErrors: analytics.counters.verifierActionableErrors
      }),
      label: "verifier-health",
      status: analytics.verifierHealth.status || "unknown",
      counters: {
        verifierRules: analytics.counters.verifierRules,
        blockingRules: analytics.counters.verifierBlockingRules,
        actionableErrors: analytics.counters.verifierActionableErrors
      }
    },
    {
      id: deterministicSnapshotId(jobId, "handoff-review", {
        status: analytics.handoffReview.status,
        blockedComponents: analytics.counters.handoffReviewBlockedComponents,
        requiredActions: analytics.counters.handoffReviewRequiredActions
      }),
      label: "handoff-review",
      status: analytics.handoffReview.status || "not-compiled",
      counters: {
        components: analytics.counters.handoffReviewComponents,
        blockedComponents: analytics.counters.handoffReviewBlockedComponents,
        requiredActions: analytics.counters.handoffReviewRequiredActions
      }
    }
  ];
  const snapshots = [
    {
      id: deterministicSnapshotId(jobId, "compile", {
        task: analytics.task,
        capabilities: analytics.counters.capabilities,
        memoryMounts: analytics.counters.memoryMounts
      }),
      label: "compile",
      status: analytics.status,
      counters: {
        capabilities: analytics.counters.capabilities,
        memoryMounts: analytics.counters.memoryMounts,
        verifierRules: analytics.counters.verifierRules
      }
    },
    {
      id: deterministicSnapshotId(jobId, "readiness", {
        diagnostics: diagnosticCounts,
        approvalGates: analytics.counters.approvalGates
      }),
      label: "readiness",
      status: diagnosticCounts.error > 0 ? "blocked" : "ready",
      counters: {
        approvalGates: analytics.counters.approvalGates,
        blockingDiagnostics: diagnosticCounts.error,
        warningDiagnostics: diagnosticCounts.warning
      }
    },
    {
      id: deterministicSnapshotId(jobId, "handoff", {
        syncRequired: analytics.dimensions.providerSyncRequired,
        disabledCapabilities: analytics.counters.disabledCapabilities
      }),
      label: "handoff",
      status: analytics.status === "blocked" ? "blocked-before-handoff" : "ready",
      counters: {
        providerSyncMounts: analytics.counters.providerSyncMounts,
        disabledCapabilities: analytics.counters.disabledCapabilities
      }
    },
    ...componentSnapshots
  ];

  return {
    provider: "mailchimp",
    jobId,
    snapshots,
    timeline: snapshots.map((snapshot, index) => ({
      order: index + 1,
      snapshotId: snapshot.id,
      label: snapshot.label,
      status: snapshot.status
    }))
  };
}

function compileJobTimelineExport(jobId, ast, analytics, history, contracts, diagnostics) {
  const capabilityAnalytics = contracts.capabilities?.operationalAnalytics
    || compileCapabilityOperationalAnalytics(contracts.capabilities);
  const capabilityWorkflow = contracts.capabilities?.clientWorkflowAdoption
    || compileCapabilityClientWorkflowAdoption(contracts.capabilities);
  const clientRuntimeAdoption = contracts.capabilities?.clientRuntimeAdoptionQueue
    || compileCapabilityClientRuntimeAdoptionQueue(contracts.capabilities);
  const memoryIntegration = contracts.memory?.integrationExport
    || compileMemoryIntegrationExport(contracts.memory);
  const verifierTimeline = contracts.verifier?.analyticsReport?.timelineExport
    || compileVerifierTimelineExport(contracts.verifier);
  const verifierHistory = contracts.verifier?.reportHistoryManifest
    || compileVerifierReportHistoryManifest(contracts.verifier);
  const runtimeHandoff = contracts.runtimeHandoffPlan || {};
  const recoveryPlan = contracts.recoveryPlan || {};
  const restartManifest = contracts.restartManifest || {};
  const handoffReview = contracts.handoffReviewPacket || {};
  const providerDispatch = contracts.providerRuntimeDispatchPacket || {};
  const diagnosticCounts = severityCounts(diagnostics);
  const componentTimeline = [
    ...(capabilityAnalytics.history?.timeline || []).map((event) => ({
      component: "capability",
      order: event.order,
      event: `mailchimp.capability.${event.action || event.status}`,
      status: event.status,
      nextAction: event.nextAction,
      action: event.action || null
    })),
    ...(capabilityWorkflow.previewModel?.actions || []).map((action) => ({
      component: "capability-workflow",
      order: action.order,
      event: `mailchimp.capability.workflow.${action.status}`,
      status: action.status,
      nextAction: action.nextAction,
      action: action.action
    })),
    ...(clientRuntimeAdoption.queue || []).map((command) => ({
      component: "capability-runtime-adoption",
      order: command.order,
      event: `mailchimp.capability.runtime_adoption.${command.visibleStatus}`,
      status: command.visibleStatus,
      nextAction: command.clientControl?.nextAction || "adopt-runtime-command-queue",
      action: command.action
    })),
    ...(memoryIntegration.timeline || []).map((event) => ({
      component: "memory",
      order: event.order,
      event: event.event,
      status: event.status,
      nextAction: event.nextAction,
      action: null
    })),
    ...(verifierTimeline.timeline || []).map((event) => ({
      component: "verifier",
      order: event.order,
      event: event.event,
      status: event.status,
      nextAction: event.nextAction,
      action: null
    })),
    ...(verifierHistory.timeline || []).map((event) => ({
      component: "verifier-history",
      order: event.order,
      event: event.event,
      status: event.status,
      nextAction: event.nextAction,
      action: null
    })),
    ...(handoffReview.timeline || []).map((event) => ({
      component: "handoff-review",
      order: event.order,
      event: event.event,
      status: event.status,
      nextAction: event.nextAction,
      action: null
    })),
    ...(providerDispatch.status
      ? [{
        component: "provider-dispatch",
        order: 1,
        event: "mailchimp.job.provider_dispatch.prepared",
        status: providerDispatch.status,
        nextAction: providerDispatch.acceptedForRuntimeDispatch
          ? "dispatch-provider-runtime-packet"
          : providerDispatch.nextActions?.[0]?.nextAction || "review-provider-dispatch-packet",
        action: null
      }]
      : [])
  ].map((event, index) => ({
    ...event,
    globalOrder: index + 1
  }));
  const blockedComponents = [
    ...(capabilityAnalytics.exportSummary?.blockedActionIds || []).map((id) => ({
      component: "capability",
      id,
      nextAction: "resolve-capability-runtime-control"
    })),
    ...(capabilityWorkflow.status === "blocked"
      ? (capabilityWorkflow.nextActions || []).map((item) => ({
        component: "capability-workflow",
        id: item.action,
        nextAction: item.nextAction
      }))
      : []),
    ...(clientRuntimeAdoption.status === "blocked"
      ? (clientRuntimeAdoption.nextActions || []).map((item) => ({
        component: "capability-runtime-adoption",
        id: item.commandId,
        nextAction: item.nextAction
      }))
      : []),
    ...(memoryIntegration.exportSummary?.blockedMounts || []).map((id) => ({
      component: "memory",
      id,
      nextAction: "resolve-memory-integration-blocker"
    })),
    ...(verifierTimeline.reportSummary?.blockingRuleIds || []).map((id) => ({
      component: "verifier",
      id,
      nextAction: "resolve-blocking-verifier-rule"
    })),
    ...(verifierHistory.status === "blocked"
      ? (verifierHistory.reportSummary?.nextActions || [])
        .filter((item) => item.required)
        .map((item) => ({
          component: "verifier-history",
          id: item.ruleId,
          nextAction: item.nextAction
        }))
      : []),
    ...(verifierHistory.status === "awaiting-evaluation"
      ? (verifierHistory.reportSummary?.pendingBlockingRuleIds || []).map((id) => ({
        component: "verifier-history",
        id,
        nextAction: "evaluate-candidate-before-runtime-handoff"
      }))
      : []),
    ...(handoffReview.blockedComponents || []).map((item) => ({
      component: "handoff-review",
      id: item.component,
      nextAction: item.nextAction || "review-component-handoff"
    })),
    ...(providerDispatch.status === "blocked"
      ? (providerDispatch.blockedReasons || []).map((item) => ({
        component: "provider-dispatch",
        id: item.id,
        nextAction: item.nextAction || "review-provider-dispatch-packet"
      }))
      : []),
    ...diagnostics
      .filter((diagnostic) => diagnostic.level === "error")
      .map((diagnostic) => ({
        component: "diagnostic",
        id: diagnostic.code,
        nextAction: "fix-compile-diagnostic"
      }))
  ];
  const exportReady = blockedComponents.length === 0
    && runtimeHandoff.readinessStatus !== "blocked"
    && restartManifest.status !== "blocked";
  const snapshotId = deterministicSnapshotId(jobId, "timeline-export", {
    status: analytics.status,
    readinessStatus: runtimeHandoff.readinessStatus,
    restartStatus: restartManifest.status,
    blockedComponents
  });

  return {
    kind: "aios.jobTimelineExport",
    provider: "mailchimp",
    jobId,
    task: ast.task,
    snapshotId,
    exportFormat: "aios.mailchimp.job.timeline.v1",
    status: exportReady
      ? "export-ready"
      : blockedComponents.length
        ? "blocked"
        : "operator-action-required",
    exportSummary: {
      acceptedForRuntime: runtimeHandoff.acceptedForRuntime === true,
      acceptedForClientPreview: runtimeHandoff.acceptedForClientPreview !== false,
      acceptedForRestart: restartManifest.canResumeRuntime === true,
      acceptedForAnalyticsExport: exportReady,
      blockedComponents,
      nextActions: [
        ...(runtimeHandoff.nextActions || []).map((item) => ({
          component: item.source,
          id: item.action || item.commandId,
          nextAction: item.nextAction,
          required: item.required === true
        })),
        ...(blockedComponents.map((item) => ({
          component: item.component,
          id: item.id,
          nextAction: item.nextAction,
          required: true
        })))
      ]
    },
    counters: {
      historySnapshots: history.snapshots.length,
      componentTimelineEvents: componentTimeline.length,
      blockedComponents: blockedComponents.length,
      diagnostics: diagnostics.length,
      diagnostics_error: diagnosticCounts.error,
      diagnostics_warning: diagnosticCounts.warning,
      diagnostics_info: diagnosticCounts.info,
      runtimeNextActions: runtimeHandoff.nextActions?.length || 0,
      recoverySteps: recoveryPlan.orderedSteps?.length || 0,
      restartReviewReasons: restartManifest.counters?.reviewReasons || 0,
      handoffReviewRequiredActions: handoffReview.counters?.requiredNextActions || 0
    },
    snapshots: history.snapshots,
    timeline: [
      ...history.timeline.map((event) => ({
        component: "job",
        globalOrder: event.order,
        event: `mailchimp.job.${event.label}`,
        status: event.status,
        nextAction: event.status === "blocked" ? "resolve-job-blocker" : "continue-job-handoff",
        snapshotId: event.snapshotId
      })),
      ...componentTimeline.map((event) => ({
        ...event,
        globalOrder: history.timeline.length + event.globalOrder,
        snapshotId
      }))
    ],
    componentExports: {
      capability: {
        snapshotId: capabilityAnalytics.snapshotId,
        status: capabilityAnalytics.status,
        counters: capabilityAnalytics.counters,
        exportSummary: capabilityAnalytics.exportSummary,
        workflowAdoption: {
          workflowId: capabilityWorkflow.workflowId,
          status: capabilityWorkflow.status,
          readiness: capabilityWorkflow.readiness,
          previewTabs: capabilityWorkflow.previewModel?.tabs || [],
          validationSummary: capabilityWorkflow.validationSummary,
          requestStateContract: capabilityWorkflow.requestStateContract
        },
        runtimeAdoptionQueue: {
          snapshotId: clientRuntimeAdoption.snapshotId,
          status: clientRuntimeAdoption.status,
          runtimeQueue: clientRuntimeAdoption.runtimeQueue,
          requestStateContract: clientRuntimeAdoption.requestStateContract,
          clientHandoff: clientRuntimeAdoption.clientHandoff,
          counters: clientRuntimeAdoption.counters
        }
      },
      memory: {
        snapshotId: memoryIntegration.snapshotId,
        status: memoryIntegration.status,
        counters: memoryIntegration.counters,
        exportSummary: memoryIntegration.exportSummary,
        providerHandoff: memoryIntegration.providerHandoff
      },
      verifier: {
        snapshotId: verifierTimeline.snapshotId,
        reportHistorySnapshotId: verifierHistory.snapshotId,
        status: verifierTimeline.status,
        reportHistoryStatus: verifierHistory.status,
        reportSummary: verifierTimeline.reportSummary,
        reportHistorySummary: verifierHistory.reportSummary
      },
      handoffReview: {
        snapshotId: handoffReview.snapshotId,
        status: handoffReview.status || "not-compiled",
        acceptance: handoffReview.acceptance || null,
        counters: handoffReview.counters || {},
        exportSummary: handoffReview.exportSummary || null
      },
      providerDispatch: {
        snapshotId: providerDispatch.snapshotId,
        status: providerDispatch.status || "not-compiled",
        acceptedForRuntimeDispatch: providerDispatch.acceptedForRuntimeDispatch === true,
        counters: providerDispatch.counters || {},
        dispatch: providerDispatch.dispatch || null
      }
    },
    persistedStateContract: {
      namespace: `jobs.${jobId}.timeline`,
      snapshotKey: `jobs.${jobId}.timeline.${snapshotId}`,
      statusKey: `jobs.${jobId}.timeline.currentStatus`,
      requiredStateKeys: [
        verifierTimeline.persistedStateContract?.snapshotKey,
        verifierTimeline.persistedStateContract?.statusKey,
        ...(verifierHistory.persistedStateContract?.requiredStateKeys || []),
        ...(handoffReview.persistedStateContract?.requiredStateKeys || []),
        ...(providerDispatch.persistedStateContract?.requiredStateKeys || [])
      ].filter(Boolean),
      adoptionEvent: "mailchimp.job.timeline.adopted",
      statusEvent: "mailchimp.job.timeline.status",
      missingStatePolicy: "rebuild-job-timeline-from-component-exports"
    },
    truthBoundary: {
      source: "job-descriptor-compiler",
      deterministic: true,
      externalMailchimpStateVerified: false,
      componentExportsCompiledLocally: true
    }
  };
}

function compileRuntimeHandoffPlan(jobId, ast, contracts, diagnostics, status) {
  const capabilityService = contracts.capabilities?.providerServiceContract || {};
  const commandLedger = contracts.capabilities?.commandLedger || compileCapabilityCommandLedger(contracts.capabilities);
  const memoryPreview = contracts.memory?.previewAcceptance || {};
  const memoryLifecycle = contracts.memory?.lifecycleControls || compileMemoryLifecycleControls(contracts.memory);
  const memoryIntegration = contracts.memory?.integrationExport || compileMemoryIntegrationExport(contracts.memory);
  const memoryProviderHandoff = contracts.memory?.providerHandoffAdoption
    || memoryIntegration.providerHandoffAdoption
    || {};
  const verifierHandoff = contracts.verifier?.runtimeHandoff || {};
  const verifierHealth = contracts.verifier?.health || {};
  const stateEnvelope = contracts.stateEnvelope || {};
  const boundaryGate = contracts.capabilities?.runtimeBoundaryGate
    || compileCapabilityRuntimeBoundaryGate(contracts.capabilities);
  const capabilityWorkflow = contracts.capabilities?.clientWorkflowAdoption
    || compileCapabilityClientWorkflowAdoption(contracts.capabilities);
  const clientRuntimeAdoption = contracts.capabilities?.clientRuntimeAdoptionQueue
    || compileCapabilityClientRuntimeAdoptionQueue(contracts.capabilities);
  const runtimeSettingsAdoption = contracts.capabilities?.runtimeSettingsAdoption
    || compileCapabilityRuntimeSettingsAdoption(contracts.capabilities);
  const lifecycleNextActions = contracts.capabilities?.lifecycleSummary?.nextActions || [];
  const memoryCriteria = memoryPreview.acceptanceCriteria || [];
  const memoryLifecycleActions = memoryLifecycle.nextActions || [];
  const memoryCapabilityActions = memoryProviderHandoff.nextActions || [];
  const verifierActions = verifierHandoff.nextActions || [];
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const disabledCapabilityActions = capabilityService.runtimeControls?.disabledActions || [];
  const approvalActions = capabilityService.runtimeControls?.approvalActions || [];
  const boundaryNextActions = boundaryGate.clientControls?.nextActions || [];
  const workflowNextActions = capabilityWorkflow.nextActions || [];
  const runtimeAdoptionNextActions = clientRuntimeAdoption.nextActions || [];
  const runtimeSettingsNextActions = runtimeSettingsAdoption.nextActions || [];
  const boundaryBlockedActions = boundaryGate.clientControls?.blockedActions || [];
  const requiredMemory = capabilityService.requiredMemory || [];
  const mountedMemory = (contracts.memory?.mounts || []).map((mount) => mount.name);
  const missingMemory = requiredMemory.filter((mountName) => !mountedMemory.includes(mountName));
  const hasExternalWrite = (capabilityService.externalWriteOperationCount || 0) > 0;
  const approvalRequired = capabilityService.requiresApproval === true || hasExternalWrite;
  const memoryAccepted = memoryPreview.readiness?.acceptedForRuntime !== false;
  const verifierApproval = verifierHandoff.requiredApprovalState;
  const commandNextActions = (commandLedger.commands || [])
    .filter((command) => !command.clientControl.canQueue)
    .map((command) => ({
      source: "capability-command",
      action: command.commandId,
      nextAction: command.clientControl.nextAction,
      required: command.clientControl.approvalRequired || command.commandStatus === "disabled",
      scheduleWindow: command.clientControl.scheduleWindow
    }));
  const nextActions = [
    ...lifecycleNextActions
      .filter((item) => item.nextAction && item.nextAction !== "ready" && item.nextAction !== "no-action")
      .map((item) => ({
        source: "capability",
        action: item.action,
        nextAction: item.nextAction,
        required: item.enabled === false || approvalActions.includes(item.action),
        scheduleWindow: item.scheduleWindow
      })),
    ...memoryCriteria
      .filter((criterion) => criterion.required || criterion.passed === false)
      .map((criterion) => ({
        source: "memory",
        action: criterion.id,
        nextAction: criterion.passed ? "no-action" : criterion.nextStep,
        required: criterion.required,
        scheduleWindow: "preflight"
      })),
    ...memoryLifecycleActions.map((item) => ({
      source: "memory-lifecycle",
      action: item.mount,
      nextAction: item.nextAction,
      required: item.required,
      scheduleWindow: item.schedule
    })),
    ...memoryCapabilityActions.map((item) => ({
      source: "memory-capability-handoff",
      action: item.mount,
      nextAction: item.nextAction,
      required: item.required,
      scheduleWindow: "preflight"
    })),
    ...verifierActions.map((item) => ({
      source: "verifier",
      action: item.ruleId,
      nextAction: item.nextAction,
      required: item.required,
      scheduleWindow: "preflight"
    })),
    ...missingMemory.map((mountName) => ({
      source: "memory",
      action: mountName,
      nextAction: "mount-required-memory",
      required: true,
      scheduleWindow: "compile"
    })),
    ...commandNextActions.filter((item) => (
      !boundaryNextActions.some((boundaryItem) => boundaryItem.commandId === item.action)
    )),
    ...boundaryNextActions.map((item) => ({
      source: "capability-boundary",
      action: item.action,
      commandId: item.commandId,
      nextAction: item.nextAction,
      required: item.enforcementStatus === "role-denied" || item.enforcementStatus === "approval-required",
      scheduleWindow: item.enforcementStatus === "disabled" ? "runtime-control" : "preflight"
    })),
    ...workflowNextActions.map((item) => ({
      source: "capability-workflow",
      action: item.action,
      commandId: item.commandId,
      nextAction: item.nextAction,
      required: item.required,
      scheduleWindow: item.visibleControl === "enable-command" ? "runtime-control" : "preflight"
    })),
    ...runtimeAdoptionNextActions.map((item) => ({
      source: "capability-runtime-adoption",
      action: item.action,
      commandId: item.commandId,
      nextAction: item.nextAction,
      required: item.required,
      scheduleWindow: "before-runtime-queue"
    })),
    ...runtimeSettingsNextActions.map((item) => ({
      source: "capability-runtime-settings",
      action: item.action,
      commandId: item.commandId,
      nextAction: item.nextAction,
      required: item.required,
      scheduleWindow: item.scheduleWindow || "before-runtime-queue"
    }))
  ];
  const readinessStatus = blockingDiagnostics.length || missingMemory.length
    ? "blocked"
    : boundaryGate.status === "blocked"
      ? "blocked"
    : verifierHealth.healthStatus === "unhealthy"
      ? "blocked"
    : memoryProviderHandoff.status === "blocked"
      ? "blocked"
    : clientRuntimeAdoption.status === "blocked"
      ? "blocked"
    : runtimeSettingsAdoption.status === "operator-action-required"
      ? "blocked"
    : memoryLifecycle.status === "invalid" || memoryLifecycle.status === "disabled-mounts-block-runtime"
      ? "blocked"
      : verifierHealth.healthStatus === "degraded"
        ? "degraded-preview-only"
      : memoryLifecycle.status === "manual-action-required"
        ? "needs-operator-action"
    : boundaryGate.status === "needs-operator-action"
      || disabledCapabilityActions.length
      || approvalRequired
      || memoryPreview.readiness?.status === "ready-with-warnings"
      ? "needs-operator-action"
      : status === "compiled"
        ? "ready-for-runtime"
        : status;

  return {
    provider: "mailchimp",
    jobId,
    task: ast.task,
    runtimeAdapter: ast.runtimeAdapter || DEFAULT_MAILCHIMP_JOB.runtimeAdapter,
    readinessStatus,
    acceptedForRuntime: readinessStatus === "ready-for-runtime",
    acceptedForClientPreview: blockingDiagnostics.length === 0,
    hasExternalWrite,
    controls: {
      canStartRuntime: readinessStatus === "ready-for-runtime",
      canPreview: true,
      canEnableDisabledCapabilities: disabledCapabilityActions.length > 0,
      requiresApprovalBeforeExternalWrite: approvalRequired,
      boundaryGateStatus: boundaryGate.status || "not-compiled",
      canPassTenantBoundary: boundaryGate.status !== "blocked",
      blockedBoundaryActions: boundaryBlockedActions,
      disabledCapabilityActions,
      approvalActions,
      requiredApprovalPath: verifierApproval?.path || null,
      canAdoptCommandLedger: readinessStatus !== "blocked",
      commandLedgerStatus: commandLedger.status || "ready",
      memoryLifecycleStatus: memoryLifecycle.status || "not-compiled",
      memoryProviderHandoffStatus: memoryProviderHandoff.status || "not-compiled",
      capabilityWorkflowStatus: capabilityWorkflow.status || "not-compiled",
      clientRuntimeAdoptionStatus: clientRuntimeAdoption.status || "not-compiled",
      runtimeSettingsAdoptionStatus: runtimeSettingsAdoption.status || "not-compiled",
      canAdoptRuntimeSettings: runtimeSettingsAdoption.acceptedForRuntimeQueue === true,
      canAdoptRuntimeQueue: clientRuntimeAdoption.clientHandoff?.acceptedForRuntimeQueue === true
        && runtimeSettingsAdoption.status !== "operator-action-required"
    },
    persistedState: stateEnvelope,
    serviceHandoff: {
      providerService: capabilityService.providerService || "mailchimp-marketing-api",
      tenantBoundary: boundaryGate.tenantBoundary || capabilityService.tenantBoundary || null,
      boundaryGate: {
        status: boundaryGate.status,
        enforcementMode: boundaryGate.enforcementMode,
        auditStream: boundaryGate.auditHandoff?.stream,
        requiredAuditEvents: boundaryGate.auditHandoff?.requiredEvents || [],
        actionGates: boundaryGate.actionGates || []
      },
      operationCount: capabilityService.operationCount || 0,
      requiredMemory,
      missingMemory,
      syncRequired: contracts.memory?.providerServiceContract?.syncRequired === true,
      memoryLifecycle: {
        status: memoryLifecycle.status,
        controls: memoryLifecycle.controls || []
      },
      handoffStates: {
        capabilities: capabilityService.handoffStates || {},
        memory: contracts.memory?.providerServiceContract?.handoffStates || {}
      },
      memoryProviderHandoff: {
        status: memoryProviderHandoff.status || "not-compiled",
        acceptedForProviderSync: memoryProviderHandoff.acceptedForProviderSync === true,
        blockedMounts: memoryProviderHandoff.adapterHandoff?.blockedMounts || [],
        heldCommandIds: memoryProviderHandoff.adapterHandoff?.heldCommandIds || [],
        missingCapabilities: memoryProviderHandoff.adapterHandoff?.missingCapabilities || [],
        syncQueue: memoryProviderHandoff.adapterHandoff?.syncQueue || []
      },
      capabilityWorkflow: {
        workflowId: capabilityWorkflow.workflowId,
        status: capabilityWorkflow.status,
        acceptedForRuntimeQueue: capabilityWorkflow.readiness?.acceptedForRuntimeQueue === true,
        acceptedForProviderWrite: capabilityWorkflow.readiness?.acceptedForProviderWrite === true,
        nextStep: capabilityWorkflow.readiness?.nextStep || "not-compiled",
        previewTabs: capabilityWorkflow.previewModel?.tabs || [],
        auditStream: capabilityWorkflow.auditHandoff?.stream || null
      },
      clientRuntimeAdoption: {
        snapshotId: clientRuntimeAdoption.snapshotId,
        status: clientRuntimeAdoption.status,
        acceptedForRuntimeQueue: clientRuntimeAdoption.clientHandoff?.acceptedForRuntimeQueue === true,
        queueableCommandIds: clientRuntimeAdoption.runtimeQueue?.queueableCommandIds || [],
        heldCommandIds: clientRuntimeAdoption.runtimeQueue?.heldCommandIds || [],
        queuePolicy: clientRuntimeAdoption.runtimeQueue?.queuePolicy || "not-compiled",
        nextAction: clientRuntimeAdoption.clientHandoff?.nextAction || "not-compiled",
        auditStream: clientRuntimeAdoption.auditHandoff?.stream || null
      },
      runtimeSettingsAdoption: {
        snapshotId: runtimeSettingsAdoption.snapshotId,
        status: runtimeSettingsAdoption.status,
        acceptedForRuntimeQueue: runtimeSettingsAdoption.acceptedForRuntimeQueue === true,
        acceptedForProviderWrite: runtimeSettingsAdoption.acceptedForProviderWrite === true,
        changedActions: runtimeSettingsAdoption.runtimeSettingsPatch?.changedActions || [],
        heldCommandIds: runtimeSettingsAdoption.runtimeSettingsPatch?.heldCommandIds || [],
        applyPolicy: runtimeSettingsAdoption.runtimeSettingsPatch?.applyPolicy || "not-compiled"
      }
    },
    requestState: {
      persistenceNamespace: commandLedger.persistenceNamespace || "capability.commands",
      commandLedgerStatus: commandLedger.status || "ready",
      restartSafe: commandLedger.restartSafe !== false,
      requiredStateKeys: commandLedger.clientStateContract?.requiredStateKeys || [],
      workflowStateKeys: capabilityWorkflow.requestStateContract?.requiredStateKeys || [],
      runtimeAdoptionStateKeys: clientRuntimeAdoption.requestStateContract?.requiredStateKeys || [],
      runtimeSettingsStateKeys: runtimeSettingsAdoption.persistedStateContract?.requiredStateKeys || [],
      missingStatePolicy: commandLedger.clientStateContract?.missingStatePolicy || "rebuild-empty-command-state-from-compiled-contract",
      runtimeQueuePolicy: clientRuntimeAdoption.runtimeQueue?.queuePolicy || "not-compiled",
      commands: (commandLedger.commands || []).map((command) => ({
        commandId: command.commandId,
        action: command.action,
        status: command.commandStatus,
        persistedStateKey: command.persistedStateKey,
        idempotencyRequired: command.idempotency.required,
        clientNextAction: command.clientControl.nextAction
      })),
      events: [
        commandLedger.clientStateContract?.adoptionEvent || "mailchimp.capability.commands.adopted",
        commandLedger.clientStateContract?.statusEvent || "mailchimp.capability.command.status",
        capabilityWorkflow.requestStateContract?.adoptionEvent || "mailchimp.capability.workflow.adopted",
        capabilityWorkflow.requestStateContract?.statusEvent || "mailchimp.capability.workflow.status",
        clientRuntimeAdoption.requestStateContract?.adoptionEvent || "mailchimp.capability.client_runtime_adoption.adopted",
        clientRuntimeAdoption.requestStateContract?.statusEvent || "mailchimp.capability.client_runtime_adoption.status",
        runtimeSettingsAdoption.persistedStateContract?.adoptionEvent || "mailchimp.capability.runtime_settings.adopted",
        runtimeSettingsAdoption.persistedStateContract?.statusEvent || "mailchimp.capability.runtime_settings.status"
      ]
    },
    clientContract: {
      requiredClientState: verifierHandoff.requiredClientState || [],
      missingClientStatePolicy: "hydrate-before-runtime-handoff",
      previewTitle: contracts.verifier?.preview?.title || "Mailchimp campaign readiness",
      memoryPreviewTitle: memoryPreview.title || "Mailchimp memory readiness",
      memoryLifecycleStatus: memoryLifecycle.status || "not-compiled",
      capabilityWorkflowStatus: capabilityWorkflow.status || "not-compiled",
      capabilityWorkflowPreview: capabilityWorkflow.previewModel || null,
      clientRuntimeAdoptionStatus: clientRuntimeAdoption.status || "not-compiled",
      clientRuntimeAdoptionQueue: clientRuntimeAdoption.queue || [],
      runtimeSettingsAdoptionStatus: runtimeSettingsAdoption.status || "not-compiled",
      runtimeSettingsPatch: runtimeSettingsAdoption.runtimeSettingsPatch || null,
      verifierHealthStatus: verifierHealth.healthStatus || "unknown",
      verifierDegradedMode: verifierHealth.degradedMode || "unknown",
      actionableVerifierErrors: verifierHealth.actionableErrors || [],
      events: [
        ...(verifierHandoff.clientEvents || []),
        {
          event: "mailchimp.job.request_state.adopted",
          when: "before-runtime-handoff",
          payloadShape: {
            jobId: "string",
            commandLedgerStatus: "string",
            commandIds: "array",
            verifierHealthStatus: "string"
          }
        }
      ]
    },
    nextActions,
    validationSummary: {
      diagnostics: severityCounts(diagnostics),
      memory: memoryPreview.validationSummary || {},
      verifier: contracts.verifier?.preview?.summary || {},
      capabilityService: {
        externalWriteOperationCount: capabilityService.externalWriteOperationCount || 0,
        requiresIdempotencyKeys: capabilityService.requiresIdempotencyKeys === true,
        requiredScopeCount: capabilityService.syncMetadata?.serviceScopes?.length || 0,
        commandLedgerStatus: commandLedger.status || "ready",
        restartSafeCommands: commandLedger.restartSafe !== false,
        boundaryGateStatus: boundaryGate.status || "not-compiled",
        memoryProviderHandoffStatus: memoryProviderHandoff.status || "not-compiled",
        capabilityWorkflowStatus: capabilityWorkflow.status || "not-compiled",
        capabilityWorkflowQueueableActions: capabilityWorkflow.validationSummary?.queueableActions || 0,
        capabilityWorkflowBlockedActions: capabilityWorkflow.validationSummary?.blockedActions || 0,
        capabilityWorkflowOperatorActions: capabilityWorkflow.validationSummary?.operatorActionRequired || 0,
        clientRuntimeAdoptionStatus: clientRuntimeAdoption.status || "not-compiled",
        clientRuntimeQueueableCommands: clientRuntimeAdoption.counters?.queueableCommands || 0,
        clientRuntimeHeldCommands: clientRuntimeAdoption.counters?.heldCommands || 0,
        clientRuntimeBlockingReasons: clientRuntimeAdoption.counters?.blockingReasons || 0,
        runtimeSettingsAdoptionStatus: runtimeSettingsAdoption.status || "not-compiled",
        runtimeSettingsChanged: runtimeSettingsAdoption.counters?.changedSettings || 0,
        runtimeSettingsBlocked: runtimeSettingsAdoption.counters?.blockedSettings || 0,
        memoryCapabilityBlockedMounts: memoryProviderHandoff.counters?.blockedMounts || 0,
        memoryMissingCapabilities: memoryProviderHandoff.counters?.missingCapabilities || 0,
        memoryHeldCapabilityCommands: memoryProviderHandoff.counters?.heldCommandIds || 0,
        blockedBoundaryActions: boundaryBlockedActions.length,
        memoryLifecycleStatus: memoryLifecycle.status || "not-compiled",
        disabledMemoryMounts: memoryLifecycle.counters?.disabledMounts || 0,
        manualMemoryControls: memoryLifecycle.counters?.manualControls || 0
      }
    },
    truthBoundary: {
      compiledLocally: true,
      externalMailchimpStateVerified: false,
      providerOperationsDeclared: true,
      clientStateEvaluated: false,
      commandStatePersisted: false,
      tenantBoundaryEvaluated: Boolean(boundaryGate.kind),
      restartStateShaped: Boolean(stateEnvelope.kind),
      verifierHealthEvaluated: Boolean(verifierHealth.healthStatus)
    }
  };
}

function compileJobRecoveryPlan(jobId, ast, contracts, diagnostics, status) {
  const capabilityRecovery = contracts.capabilities?.recoveryPlan
    || compileCapabilityRecoveryPlan(contracts.capabilities);
  const commandLedger = contracts.capabilities?.commandLedger
    || capabilityRecovery.commandLedger
    || compileCapabilityCommandLedger(contracts.capabilities);
  const boundaryGate = contracts.capabilities?.runtimeBoundaryGate
    || compileCapabilityRuntimeBoundaryGate(contracts.capabilities);
  const memoryRecovery = compileMemoryRecoveryPlan(jobId, contracts.memory);
  const memoryLifecycle = contracts.memory?.lifecycleControls || compileMemoryLifecycleControls(contracts.memory);
  const verifierRecovery = contracts.verifier?.recoveryPlan
    || compileVerifierRecoveryPlan(contracts.verifier);
  const rollbackPlan = compileRollbackMemoryPlan(jobId, contracts.memory);
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const warningDiagnostics = diagnostics.filter((diagnostic) => diagnostic.level === "warning");
  const writeOperations = capabilityRecovery.operations
    .filter((operation) => operation.retryPolicy.requiresIdempotencyKey);
  const providerReadRetries = capabilityRecovery.operations
    .filter((operation) => operation.retryPolicy.canRetryAutomatically);
  const memoryReconciliation = memoryRecovery.providerReconciliation || [];
  const memoryLifecycleBlocks = memoryLifecycle.status === "invalid"
    || memoryLifecycle.status === "disabled-mounts-block-runtime";
  const verifierBlocks = verifierRecovery.blockingRuleIds || [];
  const approvalRuleIds = verifierRecovery.approvalRuleIds || [];
  const verifierHealth = verifierRecovery.health || contracts.verifier?.health || {};
  const stateEnvelope = contracts.stateEnvelope || {};
  const commandRecoveryRequired = commandLedger.status !== "ready" || commandLedger.restartSafe === false;
  const boundaryBlocked = boundaryGate.status === "blocked";
  const canAutoRecover = status !== "blocked"
    && blockingDiagnostics.length === 0
    && !boundaryBlocked
    && writeOperations.length === 0
    && memoryReconciliation.length === 0
    && !memoryLifecycleBlocks
    && verifierBlocks.length === 0
    && !commandRecoveryRequired
    && verifierHealth.healthStatus !== "unhealthy";
  const statusAfterFailure = blockingDiagnostics.length
    ? "blocked-before-runtime-handoff"
    : boundaryBlocked
      ? "tenant-boundary-blocked"
    : memoryLifecycleBlocks
      ? "memory-lifecycle-blocked"
    : verifierHealth.healthStatus === "unhealthy"
      ? "verifier-unhealthy"
    : writeOperations.length || memoryReconciliation.length
      ? "needs-operator-review"
      : commandRecoveryRequired
        ? "restore-command-ledger"
      : warningDiagnostics.length
        ? "ready-with-warning-review"
        : canAutoRecover
          ? "retryable-runtime-failure"
          : "needs-runtime-recovery";

  const orderedSteps = [
    ...blockingDiagnostics.map((diagnostic) => ({
      source: "diagnostic",
      id: diagnostic.code,
      status: "blocked-before-runtime-handoff",
      nextAction: "fix-compile-diagnostic",
      required: true
    })),
    ...verifierRecovery.rules.map((rule) => ({
      source: "verifier",
      id: rule.ruleId,
      status: rule.adapterRecovery.statusAfterFailure,
      nextAction: rule.clientRecovery.nextAction,
      required: rule.severity === "error"
    })),
    ...capabilityRecovery.operations.map((operation) => ({
      source: "capability",
      id: operation.action,
      commandId: operation.retryPolicy.commandId,
      status: operation.failureStatus,
      nextAction: operation.rollbackPolicy.nextAction,
      required: operation.retryPolicy.requiresIdempotencyKey
        || operation.operatorControl.approvalRequiredBeforeRetry
    })),
    ...(commandLedger.commands || [])
      .filter((command) => !command.clientControl.canQueue || command.idempotency.required)
      .map((command) => ({
        source: "capability-command",
        id: command.commandId,
        status: command.commandStatus,
        nextAction: command.clientControl.nextAction,
        required: command.idempotency.required || command.clientControl.approvalRequired
    })),
    ...(boundaryGate.clientControls?.nextActions || []).map((item) => ({
      source: "capability-boundary",
      id: item.action,
      commandId: item.commandId,
      status: item.enforcementStatus,
      nextAction: item.nextAction,
      required: item.enforcementStatus !== "disabled"
    })),
    ...memoryRecovery.mounts.map((mount) => ({
      source: "memory",
      id: mount.mount,
      status: mount.failureStatus,
      nextAction: mount.rollbackPolicy.nextAction,
      required: mount.rollbackPolicy.journalRequired
    })),
    ...(memoryLifecycle.nextActions || []).map((item) => ({
      source: "memory-lifecycle",
      id: item.mount,
      status: memoryLifecycle.status,
      nextAction: item.nextAction,
      required: item.required
    }))
  ];

  return {
    kind: "aios.jobRecoveryPlan",
    provider: "mailchimp",
    jobId,
    task: ast.task,
    statusAfterFailure,
    canAutoRecover,
    operatorReviewRequired: !canAutoRecover || approvalRuleIds.length > 0,
    adapterStatusHandoff: {
      beforeRuntime: blockingDiagnostics.length ? "blocked" : "ready-for-runtime-guard",
      onProviderReadFailure: providerReadRetries.length ? "retry-with-rate-limit-budget" : "surface-provider-read-failure",
      onProviderWriteFailure: writeOperations.length ? "pause-and-require-operator-review" : "not-applicable",
      onVerifierFailure: verifierBlocks.length ? "hydrate-client-state-before-runtime" : "continue-after-warning-review",
      onVerifierDegraded: verifierHealth.degradedMode || "not-required",
      onCommandLedgerMissing: commandLedger.commandCount ? commandLedger.recovery.onRestart : "not-required",
      onTenantBoundaryFailure: boundaryBlocked ? "block-provider-handoff-and-surface-boundary-gate" : "not-required",
      onMemoryFailure: memoryReconciliation.length ? "restore-local-and-reconcile-provider" : "restore-local-checkpoint",
      onMemoryLifecycleBlocked: memoryLifecycleBlocks ? "surface-memory-lifecycle-controls" : "not-required",
      finalFailureStatus: statusAfterFailure
    },
    recoveryInputs: {
      capabilityRecoveryStatus: capabilityRecovery.statusAfterFailure,
      memoryRecoveryStatus: memoryRecovery.statusAfterFailure,
      memoryLifecycleStatus: memoryLifecycle.status,
      verifierRecoveryStatus: verifierRecovery.statusAfterFailure,
      commandLedgerStatus: commandLedger.status,
      boundaryGateStatus: boundaryGate.status || "unknown",
      verifierHealthStatus: verifierHealth.healthStatus || "unknown",
      restartStatus: stateEnvelope.restartStatus || "unknown",
      rollbackStrategy: rollbackPlan.strategy
    },
    counters: {
      blockingDiagnostics: blockingDiagnostics.length,
      warningDiagnostics: warningDiagnostics.length,
      writeOperations: writeOperations.length,
      providerReadRetries: providerReadRetries.length,
      memoryCheckpoints: memoryRecovery.checkpoints.length,
      memoryReconciliation: memoryReconciliation.length,
      memoryLifecycleActions: memoryLifecycle.nextActions?.length || 0,
      verifierBlockingRules: verifierBlocks.length,
      verifierApprovalRules: approvalRuleIds.length,
      runtimeCommands: commandLedger.commandCount || 0,
      approvalRuntimeCommands: commandLedger.approvalCommandIds?.length || 0,
      disabledRuntimeCommands: commandLedger.disabledCommandIds?.length || 0,
      blockedBoundaryActions: boundaryGate.counters?.blockedActions || 0,
      boundaryViolations: boundaryGate.counters?.boundaryViolations || 0,
      verifierActionableErrors: verifierHealth.actionableErrors?.length || 0,
      restartOperatorReviewItems: stateEnvelope.counters?.operatorReviewItems || 0,
      orderedSteps: orderedSteps.length
    },
    orderedSteps,
    rollback: rollbackPlan,
    capabilityRecovery,
    boundaryGate,
    commandLedger,
    stateEnvelope,
    memoryRecovery,
    memoryLifecycle,
    verifierRecovery,
    clientContract: {
      event: "mailchimp.job.recovery.status",
      payloadShape: {
        jobId: "string",
        statusAfterFailure: "string",
        orderedSteps: "array",
        canAutoRecover: "boolean",
        commandLedgerStatus: "string",
        boundaryGateStatus: "string",
        verifierHealthStatus: "string",
        restartStatus: "string"
      },
      visibleStatuses: Array.from(new Set(orderedSteps.map((step) => step.status))).sort()
    },
    truthBoundary: {
      source: "job-descriptor-compiler",
      deterministic: true,
      externalMailchimpStateVerified: false,
      recoveryCompiledLocally: true
    }
  };
}

function compileAdapterOperationalHandoff(jobId, ast, contracts, diagnostics, status) {
  const capabilityReadiness = contracts.capabilities?.adapterHandoffReadiness
    || compileCapabilityAdapterHandoffReadiness(contracts.capabilities);
  const memoryReadiness = contracts.memory?.adapterSyncReadiness
    || compileMemoryAdapterSyncReadiness(contracts.memory, {
      capabilityContract: contracts.capabilities,
      capabilityProviderHandoffManifest: contracts.capabilities?.providerHandoffManifest,
      capabilityRuntimeSettingsAdoption: contracts.capabilities?.runtimeSettingsAdoption
    });
  const verifierService = contracts.verifier?.providerServiceContract
    || compileVerifierProviderServiceContract(contracts.verifier);
  const runtimeHandoff = contracts.runtimeHandoffPlan || {};
  const recoveryPlan = contracts.recoveryPlan || {};
  const restartManifest = contracts.restartManifest || {};
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const capabilityBlockers = capabilityReadiness.blockers || [];
  const memoryBlockers = memoryReadiness.blockers || [];
  const verifierBlockers = verifierService.blockers || [];
  const operatorActions = [
    ...(capabilityReadiness.operatorActions || []).map((item) => ({
      component: "capability",
      id: item.commandId || item.action,
      nextAction: item.nextAction,
      required: item.required === true
    })),
    ...(memoryReadiness.operatorActions || []).map((item) => ({
      component: "memory",
      id: item.mount || item.capability || item.commandId,
      nextAction: item.nextAction,
      required: item.required === true
    })),
    ...(verifierService.operatorActions || []).map((item) => ({
      component: "verifier",
      id: item.ruleId,
      nextAction: item.nextAction,
      required: item.required === true
    }))
  ];
  const blockers = [
    ...blockingDiagnostics.map((diagnostic) => ({
      component: "diagnostic",
      id: diagnostic.code,
      nextAction: "fix-compile-diagnostic",
      required: true
    })),
    ...capabilityBlockers.map((item) => ({
      component: "capability",
      id: item.commandId || item.action,
      nextAction: item.nextAction,
      required: item.required === true
    })),
    ...memoryBlockers.map((item) => ({
      component: "memory",
      id: item.mount,
      nextAction: item.nextAction,
      required: item.required === true
    })),
    ...verifierBlockers.map((item) => ({
      component: "verifier",
      id: item.ruleId,
      nextAction: item.nextAction,
      required: item.required === true
    }))
  ];
  const requiredStateKeys = Array.from(new Set([
    ...(capabilityReadiness.adapterQueue?.namespace
      ? contracts.capabilities?.commandLedger?.clientStateContract?.requiredStateKeys || []
      : []),
    ...(memoryReadiness.syncQueue || []).map((item) => item.resumeStateKey),
    ...(verifierService.adapterHandoff?.requiredStateKeys || []),
    ...(restartManifest.persistence?.requiredStateKeys || [])
  ].filter(Boolean))).sort();
  const providerSyncRequired = memoryReadiness.counters?.providerSyncMounts > 0;
  const accepted = blockers.length === 0
    && capabilityReadiness.acceptedForRuntimeAdapter === true
    && memoryReadiness.acceptedForRuntimeAdapter === true
    && verifierService.acceptedForRuntimeAdapter === true
    && runtimeHandoff.readinessStatus === "ready-for-runtime"
    && restartManifest.status !== "blocked";
  const handoffStatus = blockers.length
    ? "blocked"
    : accepted
      ? "ready-for-runtime-adapter"
      : operatorActions.some((item) => item.required)
        ? "operator-action-required"
        : recoveryPlan.statusAfterFailure === "needs-operator-review"
          ? "degraded-operator-review"
          : "degraded-ready";
  const snapshotId = deterministicSnapshotId(jobId, "adapter-operational-handoff", {
    capability: capabilityReadiness.snapshotId,
    memory: memoryReadiness.snapshotId,
    verifier: verifierService.snapshotId,
    handoffStatus,
    blockers,
    operatorActions
  });

  return {
    kind: "aios.jobAdapterOperationalHandoff",
    provider: "mailchimp",
    jobId,
    task: ast.task,
    snapshotId,
    runtimeAdapter: ast.runtimeAdapter || DEFAULT_MAILCHIMP_JOB.runtimeAdapter,
    status: handoffStatus,
    acceptedForRuntimeAdapter: accepted,
    acceptedForClientPreview: blockingDiagnostics.length === 0,
    degradedMode: handoffStatus === "degraded-ready" || handoffStatus === "degraded-operator-review"
      ? "render-client-preview-and-hold-provider-write"
      : "none",
    providerServiceContract: {
      providerService: capabilityReadiness.providerService || verifierService.providerService || "mailchimp-marketing-api",
      tenantBoundary: capabilityReadiness.tenantBoundary || null,
      requiredScopes: capabilityReadiness.providerContract?.requiredScopes || [],
      requiredMemory: capabilityReadiness.providerContract?.requiredMemory || [],
      requiredVerifierClientState: verifierService.negotiation?.requiredClientState || [],
      providerSyncRequired,
      rateLimitBudgetKey: capabilityReadiness.providerContract?.rateLimitBudgetKey || null,
      duplicatePolicy: capabilityReadiness.providerContract?.duplicatePolicy || null
    },
    adapterQueues: {
      capabilityCommandQueue: capabilityReadiness.adapterQueue || {},
      memorySyncQueue: memoryReadiness.syncQueue || [],
      verifierEvaluation: {
        status: verifierService.status,
        canEvaluateAutomatically: verifierService.negotiation?.canEvaluateAutomatically === true,
        schedule: verifierService.negotiation?.schedule || "preflight",
        requiredApprovalPath: verifierService.negotiation?.requiredApprovalPath || null
      }
    },
    persistedStateContract: {
      namespace: `jobs.${jobId}.adapter_handoff`,
      snapshotKey: `jobs.${jobId}.adapter_handoff.${snapshotId}`,
      statusKey: `jobs.${jobId}.adapter_handoff.currentStatus`,
      requiredStateKeys,
      adoptionEvent: "mailchimp.job.adapter_handoff.adopted",
      statusEvent: "mailchimp.job.adapter_handoff.status",
      missingStatePolicy: blockers.length
        ? "block-adapter-handoff-until-state-restored"
        : "rebuild-adapter-handoff-from-component-contracts"
    },
    retryAndRecovery: {
      canAutoRecover: recoveryPlan.canAutoRecover === true && blockers.length === 0,
      statusAfterFailure: recoveryPlan.statusAfterFailure || "not-compiled",
      finalFailureStatus: recoveryPlan.adapterStatusHandoff?.finalFailureStatus || "not-compiled",
      capabilityHeldCommandIds: capabilityReadiness.adapterQueue?.heldCommandIds || [],
      memoryNextRetryAfterSeconds: memoryReadiness.adapterControls?.nextRetryAfterSeconds || null,
      verifierRetryPolicy: verifierService.adapterHandoff?.retryPolicy || null
    },
    blockers,
    operatorActions,
    counters: {
      blockers: blockers.length,
      operatorActions: operatorActions.length,
      requiredStateKeys: requiredStateKeys.length,
      queueableCapabilityCommands: capabilityReadiness.counters?.queueableCommands || 0,
      heldCapabilityCommands: capabilityReadiness.counters?.heldCommands || 0,
      memorySyncQueueItems: memoryReadiness.counters?.syncQueueItems || 0,
      memoryBlockedMounts: memoryReadiness.counters?.blockedMounts || 0,
      verifierPendingBlockingRules: verifierService.counters?.pendingBlockingRules || 0,
      diagnostics_error: blockingDiagnostics.length
    },
    componentReadiness: {
      capability: capabilityReadiness,
      memory: memoryReadiness,
      verifier: verifierService
    },
    truthBoundary: {
      source: "job-descriptor-compiler",
      externalMailchimpStateVerified: false,
      componentContractsCompiledLocally: true,
      deterministic: true
    }
  };
}

function compileProviderRuntimeDispatchPacket(jobId, ast, contracts, diagnostics, status) {
  const capabilityBatch = contracts.capabilities?.providerExecutionBatch
    || compileCapabilityProviderExecutionBatch(contracts.capabilities);
  const memoryPayload = contracts.memory?.providerSyncPayload
    || compileMemoryProviderSyncPayload(contracts.memory, {
      capabilityContract: contracts.capabilities,
      capabilityProviderHandoffManifest: contracts.capabilities?.providerHandoffManifest,
      capabilityRuntimeSettingsAdoption: contracts.capabilities?.runtimeSettingsAdoption
    });
  const adapterHandoff = contracts.adapterOperationalHandoff || {};
  const restartManifest = contracts.restartManifest || {};
  const verifierService = contracts.verifier?.providerServiceContract
    || compileVerifierProviderServiceContract(contracts.verifier);
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const capabilityHeld = capabilityBatch.dispatchPlan?.heldCommandIds || [];
  const memoryBlocked = memoryPayload.syncDispatch?.blockedMounts || [];
  const verifierBlocked = verifierService.blockers || [];
  const blockedReasons = [
    ...blockingDiagnostics.map((diagnostic) => ({
      source: "diagnostic",
      id: diagnostic.code,
      nextAction: "fix-compile-diagnostic",
      required: true
    })),
    ...(capabilityBatch.nextActions || []).map((item) => ({
      source: "capability",
      id: item.commandId || item.action,
      nextAction: item.nextAction,
      required: item.required === true
    })),
    ...(memoryPayload.nextActions || [])
      .filter((item) => item.required)
      .map((item) => ({
        source: "memory",
        id: item.mount,
        nextAction: item.nextAction,
        required: true
      })),
    ...verifierBlocked.map((item) => ({
      source: "verifier",
      id: item.ruleId,
      nextAction: item.nextAction,
      required: item.required === true
    }))
  ];
  const dispatchStatus = blockedReasons.length || adapterHandoff.status === "blocked"
    ? "blocked"
    : capabilityBatch.status === "held-for-operator-action" || memoryPayload.status === "operator-action-required"
      ? "operator-action-required"
      : capabilityBatch.status === "ready-to-dispatch" || memoryPayload.status === "ready-to-sync"
        ? "ready-to-dispatch"
        : status === "compiled"
          ? "compiled-empty"
          : status;
  const requiredStateKeys = Array.from(new Set([
    ...(capabilityBatch.persistedStateContract?.requiredStateKeys || []),
    ...(memoryPayload.persistedStateContract?.requiredStateKeys || []),
    ...(verifierService.adapterHandoff?.requiredStateKeys || []),
    ...(restartManifest.persistence?.requiredStateKeys || [])
  ].filter(Boolean))).sort();
  const snapshotId = deterministicSnapshotId(jobId, "provider-runtime-dispatch", {
    capabilitySnapshot: capabilityBatch.snapshotId,
    memorySnapshot: memoryPayload.snapshotId,
    verifierSnapshot: verifierService.snapshotId,
    dispatchStatus,
    blockedReasons
  });

  return {
    kind: "aios.jobProviderRuntimeDispatchPacket",
    provider: "mailchimp",
    jobId,
    task: ast.task,
    snapshotId,
    runtimeAdapter: ast.runtimeAdapter || DEFAULT_MAILCHIMP_JOB.runtimeAdapter,
    status: dispatchStatus,
    acceptedForRuntimeDispatch: dispatchStatus === "ready-to-dispatch",
    acceptedForClientPreview: blockingDiagnostics.length === 0,
    providerService: {
      providerService: capabilityBatch.providerService || memoryPayload.providerService || verifierService.providerService || "mailchimp-marketing-api",
      tenantBoundary: capabilityBatch.tenantBoundary || adapterHandoff.providerServiceContract?.tenantBoundary || null,
      runtimeAdapter: ast.runtimeAdapter || DEFAULT_MAILCHIMP_JOB.runtimeAdapter,
      requiredScopes: adapterHandoff.providerServiceContract?.requiredScopes || [],
      requiredMemory: adapterHandoff.providerServiceContract?.requiredMemory || [],
      requiredVerifierClientState: verifierService.negotiation?.requiredClientState || []
    },
    dispatch: {
      capabilityCommands: capabilityBatch.dispatchPlan?.queuedCommandIds || [],
      heldCapabilityCommands: capabilityHeld,
      memorySyncQueue: memoryPayload.syncDispatch?.queue || [],
      blockedMemoryMounts: memoryBlocked,
      verifier: {
        status: verifierService.status,
        canEvaluateAutomatically: verifierService.negotiation?.canEvaluateAutomatically === true,
        schedule: verifierService.negotiation?.schedule || "preflight",
        statusAfterRestart: verifierService.adapterHandoff?.statusAfterRestart || "not-compiled"
      },
      ordering: [
        "hydrate-memory-cursors",
        "evaluate-verifier-preconditions",
        "dispatch-provider-reads",
        "stage-provider-writes-after-approval"
      ],
      externalWritePolicy: capabilityBatch.dispatchPlan?.externalWritePolicy || "read-through-provider-cache",
      memoryWritebackPolicy: memoryPayload.syncDispatch?.writebackPolicy || "read-through-or-local-only"
    },
    persistedStateContract: {
      namespace: `jobs.${jobId}.provider_dispatch`,
      snapshotKey: `jobs.${jobId}.provider_dispatch.${snapshotId}`,
      statusKey: `jobs.${jobId}.provider_dispatch.currentStatus`,
      requiredStateKeys,
      adoptionEvent: "mailchimp.job.provider_dispatch.adopted",
      statusEvent: "mailchimp.job.provider_dispatch.status",
      missingStatePolicy: dispatchStatus === "blocked"
        ? "block-provider-dispatch-until-required-state-restored"
        : "rebuild-provider-dispatch-from-component-payloads"
    },
    blockedReasons,
    nextActions: [
      ...blockedReasons,
      ...(memoryPayload.nextActions || [])
        .filter((item) => !item.required)
        .map((item) => ({
          source: "memory",
          id: item.mount,
          nextAction: item.nextAction,
          required: false
        }))
    ],
    counters: {
      capabilityCommands: capabilityBatch.counters?.queuedOperations || 0,
      heldCapabilityCommands: capabilityHeld.length,
      memorySyncItems: memoryPayload.counters?.syncReadyMounts || 0,
      blockedMemoryMounts: memoryBlocked.length,
      verifierBlockers: verifierBlocked.length,
      requiredStateKeys: requiredStateKeys.length,
      diagnostics_error: blockingDiagnostics.length
    },
    componentPayloads: {
      capabilityBatch,
      memoryPayload,
      verifierService
    },
    truthBoundary: {
      source: "job-descriptor-compiler",
      externalMailchimpStateVerified: false,
      componentDispatchPayloadsCompiledLocally: true,
      deterministic: true
    }
  };
}

function compileJobHandoffReviewPacket(jobId, ast, contracts, diagnostics, status) {
  const capabilityReview = contracts.capabilities?.controlReviewPacket
    || compileCapabilityControlReviewPacket(contracts.capabilities);
  const memoryReview = contracts.memory?.providerSyncReviewPacket
    || compileMemoryProviderSyncReviewPacket(contracts.memory, {
      capabilityContract: contracts.capabilities,
      capabilityProviderHandoffManifest: contracts.capabilities?.providerHandoffManifest,
      capabilityRuntimeSettingsAdoption: contracts.capabilities?.runtimeSettingsAdoption
    });
  const verifierReview = contracts.verifier?.acceptanceReviewPacket
    || compileVerifierAcceptanceReviewPacket(contracts.verifier);
  const adapterHandoff = contracts.adapterOperationalHandoff || {};
  const runtimeHandoff = contracts.runtimeHandoffPlan || {};
  const restartManifest = contracts.restartManifest || {};
  const diagnosticCounts = severityCounts(diagnostics);
  const componentReviews = [
    {
      component: "capability",
      snapshotId: capabilityReview.snapshotId,
      status: capabilityReview.status,
      acceptedForRuntime: capabilityReview.exportSummary?.acceptedForAdapterHandoff === true,
      acceptedForClientPreview: capabilityReview.exportSummary?.acceptedForClientPreview !== false,
      nextActions: (capabilityReview.exportSummary?.nextActions || []).map((item) => ({
        component: "capability",
        id: item.action,
        commandId: item.commandId,
        nextAction: item.nextAction,
        required: item.required === true
      })),
      counters: capabilityReview.counters || {}
    },
    {
      component: "memory",
      snapshotId: memoryReview.snapshotId,
      status: memoryReview.status,
      acceptedForRuntime: memoryReview.exportSummary?.acceptedForRuntime === true,
      acceptedForClientPreview: true,
      nextActions: (memoryReview.exportSummary?.nextActions || []).map((item) => ({
        component: "memory",
        id: item.mount,
        nextAction: item.nextAction,
        required: item.required === true
      })),
      counters: memoryReview.counters || {}
    },
    {
      component: "verifier",
      snapshotId: verifierReview.snapshotId,
      status: verifierReview.status,
      acceptedForRuntime: verifierReview.acceptance?.acceptedForRuntime === true,
      acceptedForClientPreview: verifierReview.acceptance?.acceptedForClientPreview !== false,
      nextActions: (verifierReview.exportSummary?.nextActions || []).map((item) => ({
        component: "verifier",
        id: item.ruleId,
        nextAction: item.nextAction,
        required: item.required === true
      })),
      counters: verifierReview.validationSummary || {}
    }
  ];
  const requiredNextActions = componentReviews
    .flatMap((review) => review.nextActions)
    .filter((item) => item.required);
  const optionalNextActions = componentReviews
    .flatMap((review) => review.nextActions)
    .filter((item) => !item.required);
  const blockedComponents = componentReviews
    .filter((review) => review.status === "blocked" || review.acceptedForRuntime === false)
    .map((review) => ({
      component: review.component,
      snapshotId: review.snapshotId,
      status: review.status,
      nextAction: review.nextActions[0]?.nextAction || "review-component-handoff"
    }));
  const readyForRuntime = diagnosticCounts.error === 0
    && blockedComponents.length === 0
    && adapterHandoff.acceptedForRuntimeAdapter === true
    && runtimeHandoff.acceptedForRuntime === true
    && restartManifest.status !== "blocked";
  const snapshotId = deterministicSnapshotId(jobId, "handoff-review", {
    components: componentReviews.map((review) => `${review.component}:${review.status}`),
    adapterStatus: adapterHandoff.status || "not-compiled",
    runtimeStatus: runtimeHandoff.readinessStatus || status,
    blockedComponents
  });

  return {
    kind: "aios.jobHandoffReviewPacket",
    provider: "mailchimp",
    jobId,
    task: ast.task,
    snapshotId,
    exportFormat: "aios.mailchimp.job.handoff-review.v1",
    status: diagnosticCounts.error
      ? "blocked"
      : blockedComponents.length
        ? "operator-action-required"
        : readyForRuntime
          ? "ready-for-runtime"
          : optionalNextActions.length || requiredNextActions.length
            ? "review-required"
            : "compiled",
    acceptance: {
      acceptedForClientPreview: componentReviews.every((review) => review.acceptedForClientPreview),
      acceptedForRuntime: readyForRuntime,
      acceptedForAdapterHandoff: adapterHandoff.acceptedForRuntimeAdapter === true,
      acceptedForAnalyticsExport: diagnosticCounts.error === 0,
      acceptedForRestart: restartManifest.canResumeRuntime === true,
      nextStep: diagnosticCounts.error
        ? "fix-compile-diagnostic"
        : requiredNextActions[0]?.nextAction
          || (readyForRuntime ? "start-runtime-adapter" : "review-handoff-packet")
    },
    componentReviews,
    blockedComponents,
    nextActions: [
      ...requiredNextActions,
      ...optionalNextActions
    ],
    timeline: [
      ...componentReviews.map((review, index) => ({
        order: index + 1,
        component: review.component,
        snapshotId: review.snapshotId,
        event: `mailchimp.job.handoff_review.${review.component}`,
        status: review.status,
        nextAction: review.nextActions[0]?.nextAction || "continue-handoff-review"
      })),
      {
        order: componentReviews.length + 1,
        component: "job",
        snapshotId,
        event: "mailchimp.job.handoff_review.summary",
        status: readyForRuntime ? "ready-for-runtime" : "review-required",
        nextAction: readyForRuntime ? "start-runtime-adapter" : "complete-handoff-review-actions"
      }
    ],
    exportSummary: {
      runtimeAdapter: ast.runtimeAdapter || DEFAULT_MAILCHIMP_JOB.runtimeAdapter,
      adapterHandoffStatus: adapterHandoff.status || "not-compiled",
      runtimeHandoffStatus: runtimeHandoff.readinessStatus || status,
      restartStatus: restartManifest.status || "not-compiled",
      capabilityStatus: capabilityReview.status,
      memoryStatus: memoryReview.status,
      verifierStatus: verifierReview.status,
      requiredStateKeys: Array.from(new Set([
        ...(capabilityReview.requestStateContract?.requiredStateKeys || []),
        ...(memoryReview.persistedStateContract?.requiredStateKeys || []),
        ...(verifierReview.persistedStateContract?.requiredStateKeys || []),
        ...(restartManifest.persistence?.requiredStateKeys || [])
      ].filter(Boolean))).sort()
    },
    counters: {
      components: componentReviews.length,
      blockedComponents: blockedComponents.length,
      requiredNextActions: requiredNextActions.length,
      optionalNextActions: optionalNextActions.length,
      diagnostics: diagnostics.length,
      diagnostics_error: diagnosticCounts.error,
      diagnostics_warning: diagnosticCounts.warning,
      capabilityControls: capabilityReview.counters?.controls || 0,
      memoryProviderSyncMounts: memoryReview.counters?.providerSyncMounts || 0,
      verifierVisibleChecks: verifierReview.validationSummary?.totalChecks || 0
    },
    persistedStateContract: {
      namespace: `jobs.${jobId}.handoff_review`,
      snapshotKey: `jobs.${jobId}.handoff_review.${snapshotId}`,
      statusKey: `jobs.${jobId}.handoff_review.currentStatus`,
      requiredStateKeys: Array.from(new Set([
        ...(capabilityReview.requestStateContract?.requiredStateKeys || []),
        ...(memoryReview.persistedStateContract?.requiredStateKeys || []),
        ...(verifierReview.persistedStateContract?.requiredStateKeys || [])
      ].filter(Boolean))).sort(),
      adoptionEvent: "mailchimp.job.handoff_review.adopted",
      statusEvent: "mailchimp.job.handoff_review.status",
      missingStatePolicy: blockedComponents.length
        ? "block-runtime-until-handoff-review-state-restored"
        : "rebuild-handoff-review-from-component-contracts"
    },
    truthBoundary: {
      source: "job-descriptor-compiler",
      componentReviewPacketsCompiledLocally: true,
      externalMailchimpStateVerified: false,
      deterministic: true
    }
  };
}

function compileJobRestartManifest(jobId, ast, contracts, diagnostics, status, options = {}) {
  const capabilityAudit = contracts.capabilities?.boundaryAuditManifest
    || compileCapabilityBoundaryAuditManifest(
      contracts.capabilities,
      options.persistedCommandState || ast.persistedCommandState || {}
    );
  const boundaryGate = contracts.capabilities?.runtimeBoundaryGate
    || compileCapabilityRuntimeBoundaryGate(contracts.capabilities, {
      ...options,
      persistedCommandState: options.persistedCommandState || ast.persistedCommandState || {}
    });
  const runtimeSettingsAdoption = contracts.capabilities?.runtimeSettingsAdoption
    || compileCapabilityRuntimeSettingsAdoption(contracts.capabilities, options);
  const memoryResume = contracts.memory?.operationalResumePlan
    || compileMemoryOperationalResumePlan(contracts.memory, {
      ...options,
      persistedMountState: options.persistedMountState || ast.persistedMountState || {}
    });
  const memoryLifecycle = contracts.memory?.lifecycleControls || compileMemoryLifecycleControls(contracts.memory, options);
  const memoryIntegration = contracts.memory?.integrationExport || compileMemoryIntegrationExport(contracts.memory, options);
  const memoryProviderHandoff = contracts.memory?.providerHandoffAdoption
    || memoryIntegration.providerHandoffAdoption
    || {};
  const verifierTimeline = contracts.verifier?.analyticsReport?.timelineExport
    || compileVerifierTimelineExport(contracts.verifier, null, options);
  const verifierHistory = contracts.verifier?.reportHistoryManifest
    || compileVerifierReportHistoryManifest(contracts.verifier, null, options);
  const stateEnvelope = contracts.stateEnvelope || compileJobStateEnvelope(
    jobId,
    ast,
    contracts,
    diagnostics,
    status,
    options
  );
  const runtimeHandoff = contracts.runtimeHandoffPlan || {};
  const recoveryPlan = contracts.recoveryPlan || {};
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const componentStatuses = {
    capability: capabilityAudit.status,
    capabilityBoundary: boundaryGate.status,
    memory: memoryResume.status,
    memoryLifecycle: memoryLifecycle.status,
    memoryProviderHandoff: memoryProviderHandoff.status || "not-compiled",
    capabilityRuntimeSettings: runtimeSettingsAdoption.status || "not-compiled",
    verifier: verifierTimeline.status,
    verifierHistory: verifierHistory.status,
    jobState: stateEnvelope.restartStatus,
    runtimeHandoff: runtimeHandoff.readinessStatus || status
  };
  const blockedReasons = [
    ...blockingDiagnostics.map((diagnostic) => ({
      source: "diagnostic",
      id: diagnostic.code,
      status: "blocked",
      nextAction: "fix-compile-diagnostic"
    })),
    ...(capabilityAudit.violations || [])
      .filter((violation) => violation.severity === "error")
      .map((violation) => ({
        source: "capability-boundary",
        id: violation.code,
        status: "blocked",
        nextAction: violation.nextAction
      })),
    ...(boundaryGate.boundaryViolations || [])
      .filter((violation) => violation.severity === "error")
      .map((violation) => ({
        source: "capability-boundary-gate",
        id: violation.code,
        status: "blocked",
        nextAction: violation.nextAction
      })),
    ...(memoryResume.actionableErrors || [])
      .filter((error) => error.nextAction === "fix-memory-mount")
      .map((error) => ({
        source: "memory",
        id: error.code,
        status: "blocked",
        nextAction: error.nextAction
      })),
    ...(["invalid", "disabled-mounts-block-runtime"].includes(memoryLifecycle.status)
      ? (memoryLifecycle.nextActions || []).map((item) => ({
        source: "memory-lifecycle",
        id: item.mount,
        status: "blocked",
        nextAction: item.nextAction
      }))
      : []),
    ...((memoryProviderHandoff.nextActions || []).map((item) => ({
      source: "memory-capability-handoff",
      id: item.mount,
      status: "blocked",
      nextAction: item.nextAction
    }))),
    ...(runtimeSettingsAdoption.status === "operator-action-required"
      ? (runtimeSettingsAdoption.nextActions || []).map((item) => ({
        source: "capability-runtime-settings",
        id: item.action,
        status: "blocked",
        nextAction: item.nextAction
      }))
      : []),
    ...(verifierTimeline.reportSummary?.blockingRuleIds || []).map((ruleId) => ({
      source: "verifier",
      id: ruleId,
      status: "blocked",
      nextAction: "resolve-blocking-verifier-rules"
    })),
    ...(verifierHistory.status === "blocked"
      ? (verifierHistory.reportSummary?.nextActions || [])
        .filter((item) => item.required)
        .map((item) => ({
          source: "verifier-history",
          id: item.ruleId,
          status: "blocked",
          nextAction: item.nextAction
        }))
      : []),
    ...(verifierHistory.status === "awaiting-evaluation"
      ? (verifierHistory.reportSummary?.pendingBlockingRuleIds || []).map((ruleId) => ({
        source: "verifier-history",
        id: ruleId,
        status: "blocked",
        nextAction: "evaluate-candidate-before-runtime-handoff"
      }))
      : [])
  ];
  const reviewReasons = [
    ...(capabilityAudit.violations || [])
      .filter((violation) => violation.severity !== "error")
      .map((violation) => ({
        source: "capability-boundary",
        id: violation.code,
        status: "review-required",
        nextAction: violation.nextAction
      })),
    ...(stateEnvelope.operatorReviewItems || []).map((item) => ({
      source: item.source,
      id: item.id,
      status: "review-required",
      nextAction: item.nextAction
    })),
    ...(boundaryGate.clientControls?.nextActions || []).map((item) => ({
      source: "capability-boundary-gate",
      id: item.action,
      status: item.enforcementStatus === "disabled" ? "runtime-control-required" : "review-required",
      nextAction: item.nextAction
    })),
    ...(runtimeSettingsAdoption.status !== "operator-action-required"
      ? (runtimeSettingsAdoption.nextActions || []).map((item) => ({
        source: "capability-runtime-settings",
        id: item.action,
        status: "review-required",
        nextAction: item.nextAction
      }))
      : []),
    ...((memoryResume.retryHandoff?.retryBudgetExhaustedMounts || []).map((mount) => ({
      source: "memory",
      id: mount,
      status: "review-required",
      nextAction: "review-memory-mount-before-runtime"
    }))),
    ...(memoryLifecycle.nextActions || []).map((item) => ({
      source: "memory-lifecycle",
      id: item.mount,
      status: item.required ? "review-required" : "informational",
      nextAction: item.nextAction
    })),
    ...(verifierHistory.status === "operator-review-required"
      ? (verifierHistory.reportSummary?.warningRuleIds || []).map((ruleId) => ({
        source: "verifier-history",
        id: ruleId,
        status: "review-required",
        nextAction: "surface-verifier-warning"
      }))
      : [])
  ];
  const restartStatus = blockedReasons.length
    ? "blocked"
    : memoryResume.status === "degraded" || stateEnvelope.restartStatus === "degraded-restart"
      ? "degraded-restart"
      : capabilityAudit.status === "review-required" || reviewReasons.length
        ? "operator-review-required"
        : runtimeHandoff.readinessStatus === "ready-for-runtime" || status === "compiled"
          ? "ready-for-runtime"
          : status;
  const requiredStateKeys = Array.from(new Set([
    ...(stateEnvelope.persistence?.requiredStateKeys || []),
    ...(capabilityAudit.commandAdoption?.requiredStateKeys || []),
    ...(memoryResume.persistedStateContract?.requiredStateKeys || []),
    ...(memoryLifecycle.persistedStateContract?.requiredStateKeys || []),
    ...(runtimeSettingsAdoption.persistedStateContract?.requiredStateKeys || []),
    verifierTimeline.persistedStateContract?.snapshotKey,
    verifierTimeline.persistedStateContract?.statusKey,
    ...(verifierHistory.persistedStateContract?.requiredStateKeys || [])
  ].filter(Boolean))).sort();
  const adoptionEvents = Array.from(new Set([
    ...(stateEnvelope.persistence?.adoptionEvents || []),
    capabilityAudit.commandAdoption?.adoptionEvent,
    memoryResume.persistedStateContract?.adoptionEvent,
    memoryLifecycle.persistedStateContract?.adoptionEvent,
    runtimeSettingsAdoption.persistedStateContract?.adoptionEvent,
    verifierTimeline.persistedStateContract?.adoptionEvent,
    verifierHistory.persistedStateContract?.adoptionEvent,
    "mailchimp.job.restart_manifest.adopted"
  ].filter(Boolean))).sort();

  return {
    kind: "aios.jobRestartManifest",
    provider: "mailchimp",
    jobId,
    task: ast.task,
    status: restartStatus,
    statusAfterRestart: restartStatus === "ready-for-runtime"
      ? "ready-for-runtime-adapter"
      : restartStatus,
    componentStatuses,
    canResumeRuntime: restartStatus === "ready-for-runtime" || restartStatus === "degraded-restart",
    canReplayCommands: capabilityAudit.idempotency?.missingIdempotencyCommandIds?.length === 0
      && componentStatuses.capability !== "blocked",
    persistence: {
      namespace: `jobs.${jobId}.restart`,
      requiredStateKeys,
      adoptionEvents,
      statusEvent: "mailchimp.job.restart_manifest.status",
      missingStatePolicy: blockedReasons.length
        ? "block-until-required-state-restored"
        : "rebuild-derived-restart-manifest"
    },
    adapterHandoff: {
      runtimeAdapter: ast.runtimeAdapter || DEFAULT_MAILCHIMP_JOB.runtimeAdapter,
      requestStateNamespace: runtimeHandoff.requestState?.persistenceNamespace || "capability.commands",
      commandLedgerStatus: capabilityAudit.commandAdoption?.namespace ? componentStatuses.capability : "not-compiled",
      boundaryGateStatus: boundaryGate.status,
      memoryResumeStatus: memoryResume.status,
      memoryLifecycleStatus: memoryLifecycle.status,
      memoryProviderHandoffStatus: memoryProviderHandoff.status || "not-compiled",
      capabilityRuntimeSettingsStatus: runtimeSettingsAdoption.status || "not-compiled",
      verifierTimelineStatus: verifierTimeline.status,
      verifierHistoryStatus: verifierHistory.status,
      verifierHistorySnapshotId: verifierHistory.snapshotId,
      finalFailureStatus: recoveryPlan.statusAfterFailure || "not-compiled",
      nextAction: blockedReasons.length
        ? "surface-blocking-restart-reasons"
        : reviewReasons.length
          ? "surface-operator-review-before-runtime"
          : "resume-runtime-adapter"
    },
    idempotency: {
      duplicatePolicy: capabilityAudit.idempotency?.duplicatePolicy,
      writeCommandIds: capabilityAudit.idempotency?.writeCommandIds || [],
      commandReplayPolicy: "dedupe-before-provider-write-and-return-persisted-result"
    },
    blockedReasons,
    reviewReasons,
    counters: {
      requiredStateKeys: requiredStateKeys.length,
      adoptionEvents: adoptionEvents.length,
      blockedReasons: blockedReasons.length,
      reviewReasons: reviewReasons.length,
      boundaryGateActions: boundaryGate.counters?.actions || 0,
      boundaryViolations: boundaryGate.counters?.boundaryViolations || 0,
      memoryMounts: memoryResume.counters?.mounts || 0,
      memoryLifecycleControls: memoryLifecycle.counters?.mounts || 0,
      memoryCapabilityBlockedMounts: memoryProviderHandoff.counters?.blockedMounts || 0,
      memoryMissingCapabilities: memoryProviderHandoff.counters?.missingCapabilities || 0,
      memoryHeldRuntimeSettings: memoryProviderHandoff.counters?.heldRuntimeSettings || 0,
      runtimeSettingsChanged: runtimeSettingsAdoption.counters?.changedSettings || 0,
      runtimeSettingsBlocked: runtimeSettingsAdoption.counters?.blockedSettings || 0,
      capabilityCommands: capabilityAudit.counters?.commands || 0,
      verifierTimelineEvents: verifierTimeline.timeline?.length || 0,
      verifierHistorySnapshots: verifierHistory.analytics?.counters?.snapshots || 0,
      verifierHistoryTimelineEvents: verifierHistory.analytics?.counters?.timelineEvents || 0
    },
    componentManifests: {
      capabilityAudit,
      boundaryGate,
      memoryResume,
      memoryLifecycle,
      memoryProviderHandoff,
      runtimeSettingsAdoption,
      verifierTimeline,
      verifierHistory
    },
    truthBoundary: {
      source: "job-descriptor-compiler",
      persistedStateTrustedAsCallerSupplied: true,
      externalMailchimpStateVerified: false,
      deterministic: true
    }
  };
}

function compileExportSummary(jobId, ast, analytics, history, contracts, timelineExport = null) {
  const capabilityWorkflow = contracts.capabilities?.clientWorkflowAdoption
    || compileCapabilityClientWorkflowAdoption(contracts.capabilities);
  const clientRuntimeAdoption = contracts.capabilities?.clientRuntimeAdoptionQueue
    || compileCapabilityClientRuntimeAdoptionQueue(contracts.capabilities);
  const runtimeSettingsAdoption = contracts.capabilities?.runtimeSettingsAdoption
    || compileCapabilityRuntimeSettingsAdoption(contracts.capabilities);
  const nextActions = [
    ...analytics.lifecycle.nextActions.filter((item) => item.nextAction !== "no-action"),
    ...(capabilityWorkflow.nextActions || []).map((item) => ({
      action: item.action,
      nextAction: item.nextAction,
      enabled: !item.required,
      scheduleWindow: item.visibleControl === "enable-command" ? "runtime-control" : "preflight"
    })),
    ...(clientRuntimeAdoption.nextActions || []).map((item) => ({
      action: item.action,
      nextAction: item.nextAction,
      enabled: !item.required,
      scheduleWindow: "before-runtime-queue"
    })),
    ...(runtimeSettingsAdoption.nextActions || []).map((item) => ({
      action: item.action,
      nextAction: item.nextAction,
      enabled: !item.required,
      scheduleWindow: item.scheduleWindow || "before-runtime-queue"
    })),
    ...(analytics.capabilityAnalytics?.nextActions || []).map((item) => ({
      action: item.action,
      nextAction: item.nextAction,
      enabled: !item.required,
      scheduleWindow: item.scheduleWindow || "runtime"
    })),
    ...(analytics.memoryLifecycle?.nextActions || []).map((item) => ({
      action: item.mount,
      nextAction: item.nextAction,
      enabled: !item.required,
      scheduleWindow: item.schedule || "preflight"
    })),
    ...(analytics.memoryIntegration?.nextActions || []).map((item) => ({
      action: item.mount,
      nextAction: item.nextAction,
      enabled: !item.required,
      scheduleWindow: "preflight"
    })),
    ...(contracts.verifier?.acceptance?.acceptanceCriteria || [])
      .filter((criterion) => criterion.required)
      .map((criterion) => ({
        action: criterion.ruleId,
        nextAction: "satisfy-verifier-criterion",
        enabled: true,
        scheduleWindow: "preflight"
      }))
  ];

  return {
    exportFormat: "aios.mailchimp.jobDescriptor.summary.v1",
    jobId,
    provider: "mailchimp",
    task: ast.task,
    status: analytics.status,
    runtimeAdapter: ast.runtimeAdapter || DEFAULT_MAILCHIMP_JOB.runtimeAdapter,
    counters: analytics.counters,
    readiness: {
      localContractsVerified: analytics.dimensions.localContractsVerified,
      requiresApproval: analytics.dimensions.requiresApproval,
      providerSyncRequired: analytics.dimensions.providerSyncRequired,
      highestCapabilityRisk: analytics.dimensions.highestCapabilityRisk,
      commandLedgerStatus: analytics.dimensions.commandLedgerStatus,
      verifierHealthStatus: analytics.dimensions.verifierHealthStatus,
      boundaryGateStatus: analytics.dimensions.boundaryGateStatus,
      capabilityAnalyticsStatus: analytics.dimensions.capabilityAnalyticsStatus,
      capabilityWorkflowStatus: analytics.dimensions.capabilityWorkflowStatus,
      memoryLifecycleStatus: analytics.dimensions.memoryLifecycleStatus,
      memoryIntegrationStatus: analytics.dimensions.memoryIntegrationStatus,
      memoryProviderHandoffStatus: analytics.dimensions.memoryProviderHandoffStatus,
      tenantIsolationKey: analytics.dimensions.tenantIsolationKey,
      runtimeHandoffStatus: contracts.runtimeHandoffPlan?.readinessStatus || analytics.status,
      capabilityWorkflowAcceptedForRuntimeQueue: capabilityWorkflow.readiness?.acceptedForRuntimeQueue === true,
      capabilityWorkflowAcceptedForProviderWrite: capabilityWorkflow.readiness?.acceptedForProviderWrite === true,
      clientRuntimeAdoptionStatus: clientRuntimeAdoption.status || "not-compiled",
      clientRuntimeQueueAccepted: clientRuntimeAdoption.clientHandoff?.acceptedForRuntimeQueue === true,
      clientRuntimeHeldCommands: clientRuntimeAdoption.counters?.heldCommands || 0,
      runtimeSettingsAdoptionStatus: runtimeSettingsAdoption.status || "not-compiled",
      runtimeSettingsQueueAccepted: runtimeSettingsAdoption.acceptedForRuntimeQueue === true,
      runtimeSettingsChanged: runtimeSettingsAdoption.counters?.changedSettings || 0,
      runtimeSettingsBlocked: runtimeSettingsAdoption.counters?.blockedSettings || 0,
      adapterOperationalHandoffStatus: contracts.adapterOperationalHandoff?.status || "not-compiled",
      adapterAcceptedForRuntime: contracts.adapterOperationalHandoff?.acceptedForRuntimeAdapter === true,
      adapterBlockedReasons: contracts.adapterOperationalHandoff?.counters?.blockers || 0,
      adapterOperatorActions: contracts.adapterOperationalHandoff?.counters?.operatorActions || 0,
      providerRuntimeDispatchStatus: contracts.providerRuntimeDispatchPacket?.status || "not-compiled",
      providerRuntimeDispatchAccepted: contracts.providerRuntimeDispatchPacket?.acceptedForRuntimeDispatch === true,
      providerRuntimeDispatchCommands: contracts.providerRuntimeDispatchPacket?.counters?.capabilityCommands || 0,
      providerRuntimeDispatchMemorySyncItems: contracts.providerRuntimeDispatchPacket?.counters?.memorySyncItems || 0,
      handoffReviewStatus: contracts.handoffReviewPacket?.status || "not-compiled",
      handoffReviewAcceptedForRuntime: contracts.handoffReviewPacket?.acceptance?.acceptedForRuntime === true,
      handoffReviewRequiredActions: contracts.handoffReviewPacket?.counters?.requiredNextActions || 0,
      acceptedForClientPreview: contracts.runtimeHandoffPlan?.acceptedForClientPreview !== false,
      analyticsExportStatus: timelineExport?.status || "not-compiled"
    },
    boundaryGate: contracts.capabilities?.runtimeBoundaryGate || null,
    capabilityWorkflow: {
      workflowId: capabilityWorkflow.workflowId,
      status: capabilityWorkflow.status,
      readiness: capabilityWorkflow.readiness,
      previewModel: capabilityWorkflow.previewModel,
      requestStateContract: capabilityWorkflow.requestStateContract,
      validationSummary: capabilityWorkflow.validationSummary
    },
    clientRuntimeAdoption: {
      snapshotId: clientRuntimeAdoption.snapshotId,
      status: clientRuntimeAdoption.status,
      runtimeQueue: clientRuntimeAdoption.runtimeQueue,
      requestStateContract: clientRuntimeAdoption.requestStateContract,
      clientHandoff: clientRuntimeAdoption.clientHandoff,
      nextActions: clientRuntimeAdoption.nextActions,
      counters: clientRuntimeAdoption.counters
    },
    runtimeSettingsAdoption: {
      snapshotId: runtimeSettingsAdoption.snapshotId,
      status: runtimeSettingsAdoption.status,
      acceptedForRuntimeQueue: runtimeSettingsAdoption.acceptedForRuntimeQueue,
      acceptedForProviderWrite: runtimeSettingsAdoption.acceptedForProviderWrite,
      runtimeSettingsPatch: runtimeSettingsAdoption.runtimeSettingsPatch,
      nextActions: runtimeSettingsAdoption.nextActions,
      persistedStateContract: runtimeSettingsAdoption.persistedStateContract,
      counters: runtimeSettingsAdoption.counters
    },
    componentExports: timelineExport?.componentExports || null,
    memoryIntegration: contracts.memory?.integrationExport || null,
    memoryProviderHandoff: contracts.memory?.providerHandoffAdoption
      || contracts.memory?.integrationExport?.providerHandoffAdoption
      || null,
    adapterOperationalHandoff: contracts.adapterOperationalHandoff || null,
    providerRuntimeDispatchPacket: contracts.providerRuntimeDispatchPacket || null,
    handoffReviewPacket: contracts.handoffReviewPacket || null,
    persistedState: contracts.stateEnvelope || null,
    restartManifest: contracts.restartManifest || null,
    requestState: contracts.runtimeHandoffPlan?.requestState || null,
    nextActions,
    runtimeHandoff: contracts.runtimeHandoffPlan || null,
    recovery: contracts.recoveryPlan
      ? {
        statusAfterFailure: contracts.recoveryPlan.statusAfterFailure,
        canAutoRecover: contracts.recoveryPlan.canAutoRecover,
        operatorReviewRequired: contracts.recoveryPlan.operatorReviewRequired,
        counters: contracts.recoveryPlan.counters
      }
      : null,
    timeline: timelineExport?.timeline || history.timeline,
    timelineExport,
    truthBoundary: {
      exportGeneratedBy: "job-descriptor-compiler",
      deterministic: true,
      externalMailchimpStateVerified: false
    }
  };
}

export function parseJobDescriptorSource(source = {}) {
  if (typeof source === "string") {
    const descriptor = {};
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, rawValue = ""] = trimmed.split(/\s*:\s*/, 2);
      const value = rawValue.includes(",") ? rawValue.split(",").map((item) => item.trim()).filter(Boolean) : rawValue;
      descriptor[key] = value;
    }
    return { ...DEFAULT_MAILCHIMP_JOB, ...descriptor };
  }

  return {
    ...DEFAULT_MAILCHIMP_JOB,
    ...source,
    actions: source.actions || source.capabilities || DEFAULT_MAILCHIMP_JOB.actions,
    memory: source.memory || source.mounts || DEFAULT_MAILCHIMP_JOB.memory
  };
}

export function compileMailchimpJobDescriptor(source = {}, options = {}) {
  const ast = parseJobDescriptorSource(source);
  const diagnostics = [];

  if (ast.provider !== "mailchimp") {
    diagnostics.push({
      level: "error",
      code: "job.provider.unsupported",
      message: `Unsupported job provider: ${ast.provider}`
    });
  }

  if (!ast.task || typeof ast.task !== "string") {
    diagnostics.push({
      level: "error",
      code: "job.task.missing",
      message: "Mailchimp job task is required."
    });
  }

  const capabilityContract = compileMailchimpCapabilities({ actions: ast.actions }, {
    localOnly: true,
    requireHumanApproval: ast.requireHumanApproval !== false,
    tenantId: ast.tenantId || options.tenantId,
    workspaceId: ast.workspaceId || options.workspaceId,
    actorRole: ast.actorRole || options.actorRole,
    runtimeSettings: ast.runtimeSettings || ast.capabilitySettings || options.runtimeSettings || options.capabilitySettings,
    persistedCommandState: options.persistedCommandState || ast.persistedCommandState
  });
  const memoryContract = compileMailchimpMemoryMounts({ mounts: ast.memory }, {
    localOnly: true,
    memoryControls: ast.memoryControls || options.memoryControls,
    capabilityContract,
    capabilityProviderHandoffManifest: capabilityContract.providerHandoffManifest,
    capabilityRuntimeSettingsAdoption: capabilityContract.runtimeSettingsAdoption
  });
  const verifierContract = compileMailchimpVerifier(ast.verifier || {}, {
    requireApprovalToken: ast.requireApprovalToken !== false
  });

  diagnostics.push(...capabilityContract.diagnostics, ...memoryContract.diagnostics, ...verifierContract.diagnostics);

  const capabilityRisk = summarizeCapabilityRisk(capabilityContract);
  const jobSeed = {
    task: ast.task,
    actions: capabilityContract.capabilities.map((capability) => capability.action),
    memory: memoryContract.mounts.map((mount) => mount.name),
    runtimeAdapter: ast.runtimeAdapter
  };
  const jobId = ast.id || stableJobId(jobSeed);
  const hasBlockingDiagnostic = diagnostics.some((diagnostic) => diagnostic.level === "error");
  const status = hasBlockingDiagnostic ? "blocked" : "compiled";
  const contracts = {
    capabilities: capabilityContract,
    memory: memoryContract,
    verifier: verifierContract
  };
  contracts.stateEnvelope = compileJobStateEnvelope(jobId, ast, contracts, diagnostics, status, options);
  contracts.runtimeHandoffPlan = compileRuntimeHandoffPlan(jobId, ast, contracts, diagnostics, status);
  contracts.recoveryPlan = compileJobRecoveryPlan(jobId, ast, contracts, diagnostics, status);
  contracts.restartManifest = compileJobRestartManifest(jobId, ast, contracts, diagnostics, status, options);
  contracts.adapterOperationalHandoff = compileAdapterOperationalHandoff(jobId, ast, contracts, diagnostics, status);
  contracts.providerRuntimeDispatchPacket = compileProviderRuntimeDispatchPacket(jobId, ast, contracts, diagnostics, status);
  contracts.handoffReviewPacket = compileJobHandoffReviewPacket(jobId, ast, contracts, diagnostics, status);
  const analytics = compileJobAnalytics(jobId, ast, contracts, diagnostics, status);
  const history = compileJobHistory(jobId, analytics, diagnostics);
  const timelineExport = compileJobTimelineExport(jobId, ast, analytics, history, contracts, diagnostics);
  contracts.timelineExport = timelineExport;
  const exportSummary = compileExportSummary(jobId, ast, analytics, history, contracts, timelineExport);

  return {
    kind: "aios.kernelJobDescriptor",
    id: jobId,
    provider: "mailchimp",
    task: ast.task,
    status,
    runtimeAdapter: {
      id: ast.runtimeAdapter || DEFAULT_MAILCHIMP_JOB.runtimeAdapter,
      handoff: hasBlockingDiagnostic ? "blocked-before-handoff" : contracts.runtimeHandoffPlan.readinessStatus,
      inputContract: {
        campaignId: "optional-string",
        audienceId: "required-string",
        draftPayload: "object"
      },
      clientContract: contracts.runtimeHandoffPlan.clientContract,
      serviceHandoff: contracts.runtimeHandoffPlan.serviceHandoff,
      requestState: contracts.runtimeHandoffPlan.requestState,
      clientRuntimeAdoption: contracts.runtimeHandoffPlan.serviceHandoff?.clientRuntimeAdoption || null,
      runtimeSettingsAdoption: contracts.runtimeHandoffPlan.serviceHandoff?.runtimeSettingsAdoption || null,
      adapterOperationalHandoff: contracts.adapterOperationalHandoff,
      providerRuntimeDispatchPacket: contracts.providerRuntimeDispatchPacket,
      handoffReviewPacket: contracts.handoffReviewPacket,
      persistedState: contracts.stateEnvelope,
      restartManifest: contracts.restartManifest,
      recoveryHandoff: contracts.recoveryPlan.adapterStatusHandoff
    },
    contracts,
    analytics,
    history,
    timelineExport,
    handoffReviewPacket: contracts.handoffReviewPacket,
    persistedState: contracts.stateEnvelope,
    restartManifest: contracts.restartManifest,
    exportSummary,
    recovery: {
      retry: contracts.recoveryPlan.canAutoRecover ? "auto-retry-read-paths" : "operator-reviewed-recovery",
      rollback: contracts.recoveryPlan.rollback,
      statusAfterFailure: contracts.recoveryPlan.statusAfterFailure,
      adapterStatusHandoff: contracts.recoveryPlan.adapterStatusHandoff,
      orderedSteps: contracts.recoveryPlan.orderedSteps
    },
    truthBoundary: {
      source: "job-descriptor-compiler",
      providerFacts: "caller-supplied",
      localContractsVerified: !hasBlockingDiagnostic,
      externalMailchimpStateVerified: false,
      capabilityRisk,
      exportSummaryDeterministic: true
    },
    diagnostics
  };
}

export function compileMailchimpCampaignSyncJob(campaign = {}, options = {}) {
  return compileMailchimpJobDescriptor({
    task: "campaign.syncDraft",
    actions: campaign.schedule
      ? ["campaign.read", "campaign.update", "campaign.schedule", "audience.read", "template.read"]
      : ["campaign.read", "campaign.update", "audience.read", "template.read"],
    memory: ["campaignDraft", "audienceSnapshot", "verifierEvidence", "rollbackJournal"],
    requireApprovalToken: options.requireApprovalToken !== false,
    runtimeAdapter: options.runtimeAdapter || DEFAULT_MAILCHIMP_JOB.runtimeAdapter,
    verifier: options.verifier,
    campaign
  }, options);
}
