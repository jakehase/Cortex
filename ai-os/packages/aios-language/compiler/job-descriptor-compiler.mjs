import {
  compileCapabilityCommandLedger,
  compileCapabilityRecoveryPlan,
  compileCapabilityStateRecoveryEnvelope,
  compileMailchimpCapabilities,
  summarizeCapabilityLifecycle,
  summarizeCapabilityRisk
} from "./capability-compiler.mjs";
import {
  compileMailchimpMemoryMounts,
  compileMemoryHealthContract,
  compileMemoryRecoveryPlan,
  compileRollbackMemoryPlan
} from "./memory-mount-compiler.mjs";
import {
  compileMailchimpVerifier,
  compileVerifierAnalyticsReport,
  compileVerifierRecoveryPlan
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
  const verifierHealth = contracts.verifier?.health || {};
  const stateEnvelope = contracts.stateEnvelope || {};

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
      restartStatus: stateEnvelope.restartStatus || "not-compiled"
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
  const verifierReport = contracts.verifier?.analyticsReport
    || compileVerifierAnalyticsReport(contracts.verifier, null, options);
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
    ...(verifierReport.exportSummary?.blockingRuleIds || []).map((ruleId) => ({
      source: "verifier",
      id: ruleId,
      nextAction: "hydrate-required-client-state"
    }))
  ];
  const requiredStateKeys = Array.from(new Set([
    ...(commandLedger.clientStateContract?.requiredStateKeys || []),
    ...(memoryHealth.persistedStateContract?.requiredStateKeys || []),
    verifierReport.persistedStateContract?.snapshotKey,
    verifierReport.persistedStateContract?.statusKey
  ].filter(Boolean))).sort();
  const adoptionEvents = Array.from(new Set([
    capabilityState.adoption?.event,
    memoryHealth.persistedStateContract?.adoptionEvent,
    verifierReport.persistedStateContract?.adoptionEvent,
    "mailchimp.job.state.adopted"
  ].filter(Boolean))).sort();
  const restartStatus = blockingDiagnostics.length
    ? "blocked"
    : capabilityState.status === "operator-review-required"
      ? "operator-review-required"
      : memoryHealth.healthStatus === "unhealthy"
        ? "blocked"
        : memoryHealth.healthStatus === "degraded" || verifierReport.healthStatus === "degraded"
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
        counters: capabilityState.counters
      },
      memory: {
        healthStatus: memoryHealth.healthStatus,
        runtimeMode: memoryHealth.runtimeMode,
        retryable: memoryHealth.retryable,
        counters: memoryHealth.counters
      },
      verifier: {
        snapshotId: verifierReport.snapshotId,
        status: verifierReport.status,
        healthStatus: verifierReport.healthStatus,
        counters: verifierReport.counters
      }
    },
    counters: {
      requiredStateKeys: requiredStateKeys.length,
      adoptionEvents: adoptionEvents.length,
      operatorReviewItems: operatorReviewItems.length,
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
    }
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

function compileRuntimeHandoffPlan(jobId, ast, contracts, diagnostics, status) {
  const capabilityService = contracts.capabilities?.providerServiceContract || {};
  const commandLedger = contracts.capabilities?.commandLedger || compileCapabilityCommandLedger(contracts.capabilities);
  const memoryPreview = contracts.memory?.previewAcceptance || {};
  const verifierHandoff = contracts.verifier?.runtimeHandoff || {};
  const verifierHealth = contracts.verifier?.health || {};
  const stateEnvelope = contracts.stateEnvelope || {};
  const lifecycleNextActions = contracts.capabilities?.lifecycleSummary?.nextActions || [];
  const memoryCriteria = memoryPreview.acceptanceCriteria || [];
  const verifierActions = verifierHandoff.nextActions || [];
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const disabledCapabilityActions = capabilityService.runtimeControls?.disabledActions || [];
  const approvalActions = capabilityService.runtimeControls?.approvalActions || [];
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
    ...commandNextActions
  ];
  const readinessStatus = blockingDiagnostics.length || missingMemory.length
    ? "blocked"
    : verifierHealth.healthStatus === "unhealthy"
      ? "blocked"
      : verifierHealth.healthStatus === "degraded"
        ? "degraded-preview-only"
    : disabledCapabilityActions.length || approvalRequired || memoryPreview.readiness?.status === "ready-with-warnings"
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
      disabledCapabilityActions,
      approvalActions,
      requiredApprovalPath: verifierApproval?.path || null,
      canAdoptCommandLedger: readinessStatus !== "blocked",
      commandLedgerStatus: commandLedger.status || "ready"
    },
    persistedState: stateEnvelope,
    serviceHandoff: {
      providerService: capabilityService.providerService || "mailchimp-marketing-api",
      operationCount: capabilityService.operationCount || 0,
      requiredMemory,
      missingMemory,
      syncRequired: contracts.memory?.providerServiceContract?.syncRequired === true,
      handoffStates: {
        capabilities: capabilityService.handoffStates || {},
        memory: contracts.memory?.providerServiceContract?.handoffStates || {}
      }
    },
    requestState: {
      persistenceNamespace: commandLedger.persistenceNamespace || "capability.commands",
      commandLedgerStatus: commandLedger.status || "ready",
      restartSafe: commandLedger.restartSafe !== false,
      requiredStateKeys: commandLedger.clientStateContract?.requiredStateKeys || [],
      missingStatePolicy: commandLedger.clientStateContract?.missingStatePolicy || "rebuild-empty-command-state-from-compiled-contract",
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
        commandLedger.clientStateContract?.statusEvent || "mailchimp.capability.command.status"
      ]
    },
    clientContract: {
      requiredClientState: verifierHandoff.requiredClientState || [],
      missingClientStatePolicy: "hydrate-before-runtime-handoff",
      previewTitle: contracts.verifier?.preview?.title || "Mailchimp campaign readiness",
      memoryPreviewTitle: memoryPreview.title || "Mailchimp memory readiness",
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
        restartSafeCommands: commandLedger.restartSafe !== false
      }
    },
    truthBoundary: {
      compiledLocally: true,
      externalMailchimpStateVerified: false,
      providerOperationsDeclared: true,
      clientStateEvaluated: false,
      commandStatePersisted: false,
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
  const memoryRecovery = compileMemoryRecoveryPlan(jobId, contracts.memory);
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
  const verifierBlocks = verifierRecovery.blockingRuleIds || [];
  const approvalRuleIds = verifierRecovery.approvalRuleIds || [];
  const verifierHealth = verifierRecovery.health || contracts.verifier?.health || {};
  const stateEnvelope = contracts.stateEnvelope || {};
  const commandRecoveryRequired = commandLedger.status !== "ready" || commandLedger.restartSafe === false;
  const canAutoRecover = status !== "blocked"
    && blockingDiagnostics.length === 0
    && writeOperations.length === 0
    && memoryReconciliation.length === 0
    && verifierBlocks.length === 0
    && !commandRecoveryRequired
    && verifierHealth.healthStatus !== "unhealthy";
  const statusAfterFailure = blockingDiagnostics.length
    ? "blocked-before-runtime-handoff"
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
    ...memoryRecovery.mounts.map((mount) => ({
      source: "memory",
      id: mount.mount,
      status: mount.failureStatus,
      nextAction: mount.rollbackPolicy.nextAction,
      required: mount.rollbackPolicy.journalRequired
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
      onMemoryFailure: memoryReconciliation.length ? "restore-local-and-reconcile-provider" : "restore-local-checkpoint",
      finalFailureStatus: statusAfterFailure
    },
    recoveryInputs: {
      capabilityRecoveryStatus: capabilityRecovery.statusAfterFailure,
      memoryRecoveryStatus: memoryRecovery.statusAfterFailure,
      verifierRecoveryStatus: verifierRecovery.statusAfterFailure,
      commandLedgerStatus: commandLedger.status,
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
      verifierBlockingRules: verifierBlocks.length,
      verifierApprovalRules: approvalRuleIds.length,
      runtimeCommands: commandLedger.commandCount || 0,
      approvalRuntimeCommands: commandLedger.approvalCommandIds?.length || 0,
      disabledRuntimeCommands: commandLedger.disabledCommandIds?.length || 0,
      verifierActionableErrors: verifierHealth.actionableErrors?.length || 0,
      restartOperatorReviewItems: stateEnvelope.counters?.operatorReviewItems || 0,
      orderedSteps: orderedSteps.length
    },
    orderedSteps,
    rollback: rollbackPlan,
    capabilityRecovery,
    commandLedger,
    stateEnvelope,
    memoryRecovery,
    verifierRecovery,
    clientContract: {
      event: "mailchimp.job.recovery.status",
      payloadShape: {
        jobId: "string",
        statusAfterFailure: "string",
        orderedSteps: "array",
        canAutoRecover: "boolean",
        commandLedgerStatus: "string",
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

function compileExportSummary(jobId, ast, analytics, history, contracts) {
  const nextActions = [
    ...analytics.lifecycle.nextActions.filter((item) => item.nextAction !== "no-action"),
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
      runtimeHandoffStatus: contracts.runtimeHandoffPlan?.readinessStatus || analytics.status,
      acceptedForClientPreview: contracts.runtimeHandoffPlan?.acceptedForClientPreview !== false
    },
    persistedState: contracts.stateEnvelope || null,
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
    timeline: history.timeline,
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
    persistedCommandState: options.persistedCommandState || ast.persistedCommandState
  });
  const memoryContract = compileMailchimpMemoryMounts({ mounts: ast.memory }, { localOnly: true });
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
  const analytics = compileJobAnalytics(jobId, ast, contracts, diagnostics, status);
  const history = compileJobHistory(jobId, analytics, diagnostics);
  const exportSummary = compileExportSummary(jobId, ast, analytics, history, contracts);

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
      persistedState: contracts.stateEnvelope,
      recoveryHandoff: contracts.recoveryPlan.adapterStatusHandoff
    },
    contracts,
    analytics,
    history,
    persistedState: contracts.stateEnvelope,
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
