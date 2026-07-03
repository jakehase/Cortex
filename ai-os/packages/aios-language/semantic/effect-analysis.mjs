import { analyzeAiosCapabilities } from "./capability-analysis.mjs";

function compactString(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function freezeArray(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

function getJobs(input = {}) {
  if (Array.isArray(input.jobs)) return input.jobs;
  if (Array.isArray(input.ast?.jobs)) return input.ast.jobs;
  return [];
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function capabilityByAction(capabilityJob = {}) {
  return new Map(toArray(capabilityJob.contracts).map((contract) => [contract.action, contract]));
}

function createRetryPolicy(step = {}, contracts = []) {
  const retry = step.retry || {};
  const externalWrite = contracts.some((contract) => contract.effects.externalWrite);
  const highRisk = contracts.some((contract) => contract.risk === "high");
  const boundaryHeld = contracts.some((contract) => contract.boundaryDecision?.decision === "hold");
  const maxAttempts = boundaryHeld ? 0 : positiveInteger(retry.maxAttempts ?? step.maxAttempts, externalWrite ? 3 : 1);
  const baseDelayMs = positiveInteger(retry.baseDelayMs ?? step.retryDelayMs, highRisk ? 5000 : 1000);

  return Object.freeze({
    strategy: boundaryHeld ? "manual-boundary-resolution" : externalWrite ? "exponential-backoff" : "none",
    maxAttempts,
    baseDelayMs,
    maxDelayMs: boundaryHeld ? 0 : positiveInteger(retry.maxDelayMs, Math.max(baseDelayMs, externalWrite ? 30000 : baseDelayMs)),
    jitter: boundaryHeld ? false : retry.jitter !== false && externalWrite,
    idempotencyRequired: externalWrite,
    retryableStatuses: freezeArray(boundaryHeld ? [] : externalWrite ? ["429", "500", "502", "503", "504", "adapter-timeout"] : []),
  });
}

function createActionableError(stepName, code, message, nextCommand, context = {}) {
  return Object.freeze({
    code,
    message,
    step: stepName,
    nextCommand,
    ...context,
  });
}

function severityRank(effect = {}) {
  if (effect.actionableErrors?.length > 0) return 3;
  if (effect.status === "held-for-boundary-review") return 3;
  if (effect.status === "awaiting-operator-approval") return 2;
  if (effect.effectClass === "external-write") return 1;
  return 0;
}

function createStepEffect(step = {}, capabilityContracts) {
  const name = compactString(step.name || step.id || "step");
  const capabilityRefs = toArray(step.capability || step.capabilities || step.requiresCapability).map(compactString).filter(Boolean);
  const contracts = capabilityRefs.map((action) => capabilityContracts.get(action)).filter(Boolean);
  const reads = new Set(toArray(step.memoryReads || step.reads).map(compactString).filter(Boolean));
  const writes = new Set(toArray(step.memoryWrites || step.writes || step.output).map(compactString).filter(Boolean));

  for (const contract of contracts) {
    for (const memoryName of contract.effects.reads) reads.add(memoryName);
    for (const memoryName of contract.effects.writes) writes.add(memoryName);
  }

  const externalWrite = contracts.some((contract) => contract.effects.externalWrite);
  const approvalRequired = contracts.some((contract) => contract.effects.requiredApproval);
  const approvalRejected = contracts.some((contract) => contract.acceptance?.state === "rejected");
  const highRisk = contracts.some((contract) => contract.risk === "high");
  const boundaryHeld = contracts.some((contract) => contract.boundaryDecision?.decision === "hold");
  const adapterStatusFailed = contracts.some((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state));
  const adapterStatusMissing = contracts.some((contract) => contract.statusReconciliation?.state === "missing-status");
  const adapterStatusPending = contracts.some((contract) => contract.statusReconciliation?.state === "pending");
  const workflowBlocked = contracts.some((contract) => contract.workflowGate?.acceptedForAdapter === false);
  const degradedByCapability = contracts.some((contract) => contract.health?.degradedMode && contract.health.degradedMode !== "none");
  const status = boundaryHeld
    ? "held-for-boundary-review"
    : workflowBlocked
      ? "client-workflow-blocked"
    : adapterStatusFailed
      ? "adapter-status-failed"
      : adapterStatusMissing
        ? "adapter-status-missing"
        : adapterStatusPending
          ? "adapter-status-pending"
    : approvalRejected
      ? "operator-rejected"
      : approvalRequired
      ? "awaiting-operator-approval"
      : externalWrite
        ? "ready-for-adapter-handoff"
        : "ready";
  const retryPolicy = createRetryPolicy(step, contracts);
  const actionableErrors = [
    boundaryHeld && createActionableError(
      name,
      "aios.effects.boundary_hold",
      `Step "${name}" cannot be handed to the adapter until capability boundary holds are resolved.`,
      "resolve_boundary_hold",
      { capabilities: freezeArray(contracts.filter((contract) => contract.boundaryDecision?.decision === "hold").map((contract) => contract.action)) }
    ),
    externalWrite && retryPolicy.idempotencyRequired && !contracts.some((contract) => compactString(contract.audit?.requestId)) && createActionableError(
      name,
      "aios.effects.request_identity_missing",
      `Step "${name}" performs an external write without request identity in the capability audit handoff.`,
      "attach_client_runtime_request",
      { capabilities: freezeArray(contracts.map((contract) => contract.action)) }
    ),
    approvalRejected && createActionableError(
      name,
      "aios.effects.operator_acceptance_rejected",
      `Step "${name}" references a capability rejected by operator acceptance controls.`,
      "revise_or_cancel_provider_action",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.acceptance?.state === "rejected")
          .map((contract) => contract.action)),
      }
    ),
    adapterStatusFailed && createActionableError(
      name,
      "aios.effects.adapter_status_failed",
      `Step "${name}" references a capability with terminal adapter status.`,
      contracts.find((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state))?.statusReconciliation?.nextCommand || "inspect_adapter_failure",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state))
          .map((contract) => contract.action)),
      }
    ),
    adapterStatusMissing && createActionableError(
      name,
      "aios.effects.adapter_status_missing",
      `Step "${name}" needs adapter status snapshot data before replay-safe handoff.`,
      "load_adapter_status_snapshot",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.statusReconciliation?.state === "missing-status")
          .map((contract) => contract.action)),
      }
    ),
    workflowBlocked && createActionableError(
      name,
      "aios.effects.client_workflow_blocked",
      `Step "${name}" is waiting on client workflow commands before Mailchimp adapter handoff.`,
      contracts.find((contract) => contract.workflowGate?.acceptedForAdapter === false)?.workflowGate?.nextCommand || "resolve_runtime_readiness",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.workflowGate?.acceptedForAdapter === false)
          .map((contract) => contract.action)),
      }
    ),
  ].filter(Boolean);

  return Object.freeze({
    step: name,
    adapter: compactString(step.adapter || (contracts.some((contract) => contract.provider === "mailchimp") ? "mailchimp.campaignRuntimeAdapter" : "runtime")),
    reads: freezeArray([...reads].sort()),
    writes: freezeArray([...writes].sort()),
    capabilities: freezeArray(capabilityRefs),
    effectClass: externalWrite ? "external-write" : writes.size > 0 ? "memory-write" : "read-only",
    status,
    health: Object.freeze({
      state: actionableErrors.length > 0
        ? "blocked"
        : boundaryHeld
          ? "degraded"
          : adapterStatusPending
          ? "waiting-adapter"
          : workflowBlocked
            ? "blocked"
          : degradedByCapability
            ? "degraded"
          : externalWrite
            ? "adapter-ready"
            : "healthy",
      degradedMode: boundaryHeld
        ? "preview-only"
        : degradedByCapability
          ? "capability-health-degraded"
          : step.degradedMode === "preview" ? "preview-only" : "none",
      statusChannel: compactString(contracts.find((contract) => contract.audit?.statusChannel)?.audit?.statusChannel),
      statusSnapshotKeys: freezeArray([...new Set(contracts.map((contract) => contract.audit?.statusSnapshotKey).filter(Boolean))]),
      adapterStatus: freezeArray(contracts.map((contract) => contract.statusReconciliation).filter(Boolean).map((statusRow) => ({
        action: statusRow.action,
        state: statusRow.state,
        nextCommand: statusRow.nextCommand,
        providerRequestId: statusRow.providerRequestId,
      }))),
      clientWorkflow: freezeArray(contracts
        .filter((contract) => contract.workflowGate && contract.workflowGate.state !== "not-required")
        .map((contract) => ({
          action: contract.action,
          state: contract.workflowGate.state,
          nextCommand: contract.workflowGate.nextCommand,
          blockedCommands: contract.workflowGate.blockedCommands,
          readyCommands: contract.workflowGate.readyCommands,
        }))),
      auditEvents: freezeArray(contracts.map((contract) => contract.audit?.event).filter(Boolean).sort()),
      operatorAcceptance: freezeArray(contracts
        .filter((contract) => contract.acceptance?.required)
        .map((contract) => ({
          action: contract.action,
          state: contract.acceptance.state,
          token: contract.acceptance.token,
          nextCommand: contract.acceptance.nextCommand,
          evidenceRefs: contract.acceptance.evidenceRefs,
        }))),
    }),
    retryPolicy,
    actionableErrors: freezeArray(actionableErrors),
    recovery: Object.freeze({
      command: boundaryHeld
        ? "resolve_boundary_hold"
        : adapterStatusFailed
        ? contracts.find((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state))?.statusReconciliation?.nextCommand || "inspect_adapter_failure"
        : workflowBlocked
          ? contracts.find((contract) => contract.workflowGate?.acceptedForAdapter === false)?.workflowGate?.nextCommand || "resolve_runtime_readiness"
          : adapterStatusMissing
            ? "load_adapter_status_snapshot"
            : adapterStatusPending
              ? "poll_adapter_status_channel"
              : approvalRejected
                ? "revise_or_cancel_provider_action"
                : approvalRequired
                  ? "hold_for_operator"
                  : externalWrite
                    ? "retry_same_idempotency_key"
                    : compactString(step.recovery || "observe"),
      adapterStatusCommand: contracts.find((contract) => contract.statusReconciliation?.nextCommand && contract.statusReconciliation.nextCommand !== "observe")?.statusReconciliation?.nextCommand || "",
      rollbackRequired: externalWrite || highRisk,
      verifierEvidenceRequired: approvalRequired || highRisk,
    }),
  });
}

function createAnalyticsCounters(stepEffects = [], diagnostics = []) {
  const counters = {
    totalSteps: stepEffects.length,
    readySteps: 0,
    externalWrites: 0,
    memoryWrites: 0,
    readOnlySteps: 0,
    approvalSteps: 0,
    boundaryHeldSteps: 0,
    degradedSteps: 0,
    blockedSteps: 0,
    retryableSteps: 0,
    adapterStatusFailed: 0,
    adapterStatusMissing: 0,
    adapterStatusPending: 0,
    clientWorkflowBlocked: 0,
    clientWorkflowReady: 0,
    rollbackRequired: 0,
    verifierEvidenceRequired: 0,
    diagnostics: diagnostics.length,
    errors: diagnostics.filter((diagnostic) => diagnostic.level === "error").length,
    warnings: diagnostics.filter((diagnostic) => diagnostic.level === "warning").length,
  };

  for (const effect of stepEffects) {
    if (effect.status === "ready" || effect.status === "ready-for-adapter-handoff") counters.readySteps += 1;
    if (effect.effectClass === "external-write") counters.externalWrites += 1;
    if (effect.effectClass === "memory-write") counters.memoryWrites += 1;
    if (effect.effectClass === "read-only") counters.readOnlySteps += 1;
    if (effect.status === "awaiting-operator-approval") counters.approvalSteps += 1;
    if (effect.status === "held-for-boundary-review") counters.boundaryHeldSteps += 1;
    if (effect.status === "adapter-status-failed") counters.adapterStatusFailed += 1;
    if (effect.status === "adapter-status-missing") counters.adapterStatusMissing += 1;
    if (effect.status === "adapter-status-pending") counters.adapterStatusPending += 1;
    if (effect.status === "client-workflow-blocked") counters.clientWorkflowBlocked += 1;
    if (effect.health?.clientWorkflow?.some?.((row) => row.state === "ready")) counters.clientWorkflowReady += 1;
    if (effect.health?.degradedMode && effect.health.degradedMode !== "none") counters.degradedSteps += 1;
    if (effect.actionableErrors?.length > 0) counters.blockedSteps += 1;
    if (effect.retryPolicy?.retryableStatuses?.length > 0) counters.retryableSteps += 1;
    if (effect.recovery?.rollbackRequired) counters.rollbackRequired += 1;
    if (effect.recovery?.verifierEvidenceRequired) counters.verifierEvidenceRequired += 1;
  }

  return Object.freeze(counters);
}

function createTimeline(stepEffects = [], capabilityJob = {}) {
  const auditEvents = new Map();
  for (const event of toArray(capabilityJob.auditHandoff?.events)) {
    const key = compactString(event.requiredPermission || event.event || event.decision);
    if (key) auditEvents.set(key, event);
  }

  return freezeArray(stepEffects
    .map((effect, index) => {
      const firstCapability = effect.capabilities[0] || "";
      const matchingAudit = auditEvents.get(firstCapability) || null;
      return {
        index,
        step: effect.step,
        state: effect.status,
        severity: severityRank(effect),
        effectClass: effect.effectClass,
        adapter: effect.adapter,
        capabilities: effect.capabilities,
        statusChannel: effect.health.statusChannel,
        statusSnapshotKeys: effect.health.statusSnapshotKeys || freezeArray([]),
        nextCommand: effect.actionableErrors[0]?.nextCommand || effect.recovery.command,
        retryStrategy: effect.retryPolicy.strategy,
        auditEvent: matchingAudit?.event || effect.health.auditEvents[0] || "",
      };
    })
    .sort((left, right) => right.severity - left.severity || left.index - right.index));
}

function createHistorySnapshot(job = {}, stepEffects = [], diagnostics = [], capabilityJob = {}) {
  const counters = createAnalyticsCounters(stepEffects, diagnostics);
  const state = counters.errors > 0 || counters.blockedSteps > 0
    ? "blocked"
    : counters.degradedSteps > 0 || capabilityJob.operationalReport?.state === "degraded"
      ? "degraded"
      : counters.approvalSteps > 0
        ? "needs-operator-action"
        : "ready";

  return Object.freeze({
    protocol: "aios.effects.history-snapshot.v1",
    jobName: compactString(job.name || capabilityJob.jobName || "anonymous"),
    state,
    counters,
    statusChannels: freezeArray([...new Set(stepEffects.map((effect) => effect.health.statusChannel).filter(Boolean))]),
    statusSnapshotKeys: freezeArray([...new Set(stepEffects.flatMap((effect) => effect.health.statusSnapshotKeys || []).filter(Boolean))]),
    timeline: createTimeline(stepEffects, capabilityJob),
  });
}

function createProviderServiceContract(job = {}, stepEffects = [], capabilityJob = {}) {
  const contracts = toArray(capabilityJob.contracts);
  const mailchimpContracts = contracts.filter((contract) => contract.provider === "mailchimp");
  const externalEffects = stepEffects.filter((effect) => effect.effectClass === "external-write");
  const disabled = mailchimpContracts.filter((contract) => contract.lifecycle?.mode === "disabled");
  const adapterReady = mailchimpContracts.filter((contract) => contract.lifecycle?.controls?.enableAdapterHandoff);
  const statusChannels = [...new Set([
    ...stepEffects.map((effect) => effect.health?.statusChannel).filter(Boolean),
    capabilityJob.principal?.statusChannel,
  ].filter(Boolean))];
  const statusSnapshotKeys = [...new Set(stepEffects.flatMap((effect) => effect.health?.statusSnapshotKeys || []).filter(Boolean))];
  const pendingAcceptance = mailchimpContracts.filter((contract) => contract.acceptance?.state === "pending");
  const rejectedAcceptance = mailchimpContracts.filter((contract) => contract.acceptance?.state === "rejected");
  const adapterStatusFailed = mailchimpContracts.filter((contract) => ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state));
  const adapterStatusMissing = mailchimpContracts.filter((contract) => contract.statusReconciliation?.state === "missing-status");
  const workflowBlocked = mailchimpContracts.filter((contract) => contract.workflowGate?.acceptedForAdapter === false);
  const workflowReady = mailchimpContracts.filter((contract) => contract.workflowGate?.state === "ready");
  const negotiatedCapabilities = mailchimpContracts.map((contract) => ({
    action: contract.action,
    serviceScopes: contract.serviceScopes,
    lifecycleMode: contract.lifecycle?.mode || "unknown",
    adapterHandoff: contract.lifecycle?.controls?.enableAdapterHandoff === true,
    operatorAcceptance: contract.acceptance || null,
    providerSync: contract.providerSync || null,
    scheduling: contract.lifecycle?.scheduling || null,
    syncMetadata: Object.freeze({
      statusState: contract.handoff?.statusState || "",
      statusChannel: contract.audit?.statusChannel || "",
      statusSnapshotKey: contract.audit?.statusSnapshotKey || "",
      requestId: contract.audit?.requestId || "",
      syncState: contract.providerSync?.state || "not-applicable",
      watermarkKey: contract.providerSync?.metadata?.watermarkKey || "",
      checkpointKey: contract.providerSync?.metadata?.checkpointKey || "",
      objectRef: contract.providerSync?.metadata?.objectRef || "",
      retryStrategy: contract.handoff?.retry?.strategy || "none",
      adapterStatusState: contract.statusReconciliation?.state || "unobserved",
      adapterStatusNextCommand: contract.statusReconciliation?.nextCommand || "observe",
      workflowState: contract.workflowGate?.state || "not-required",
      workflowNextCommand: contract.workflowGate?.nextCommand || "observe",
    }),
    nextAction: contract.lifecycle?.nextAction || contract.handoff?.recoveryCommand || "observe",
  }));
  const syncBlocked = mailchimpContracts.filter((contract) => contract.providerSync?.state === "blocked");
  const syncPending = mailchimpContracts.filter((contract) => contract.providerSync?.state === "needs-provider-confirmation");
  const handoffErrors = [
    mailchimpContracts.length > 0 && statusChannels.length === 0 && Object.freeze({
      code: "aios.effects.provider_status_channel_missing",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp effects without a provider status channel.`,
      nextCommand: "attach_recovery_status_handoff",
    }),
    mailchimpContracts.length > 0 && externalEffects.length > 0 && statusSnapshotKeys.length === 0 && Object.freeze({
      code: "aios.effects.provider_status_snapshot_missing",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp writes without status snapshot metadata.`,
      nextCommand: "attach_status_snapshot_store",
    }),
    disabled.length > 0 && Object.freeze({
      code: "aios.effects.provider_capability_disabled",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities disabled by lifecycle controls.`,
      nextCommand: disabled[0]?.lifecycle?.nextAction || "repair_capability_settings",
      capabilities: freezeArray(disabled.map((contract) => contract.action)),
    }),
    rejectedAcceptance.length > 0 && Object.freeze({
      code: "aios.effects.provider_operator_acceptance_rejected",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities rejected by operator acceptance.`,
      nextCommand: "revise_or_cancel_provider_action",
      capabilities: freezeArray(rejectedAcceptance.map((contract) => contract.action)),
    }),
    adapterStatusFailed.length > 0 && Object.freeze({
      code: "aios.effects.provider_adapter_status_failed",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities with terminal adapter status.`,
      nextCommand: adapterStatusFailed[0]?.statusReconciliation?.nextCommand || "inspect_adapter_failure",
      capabilities: freezeArray(adapterStatusFailed.map((contract) => contract.action)),
    }),
    adapterStatusMissing.length > 0 && Object.freeze({
      code: "aios.effects.provider_adapter_status_missing",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" needs Mailchimp adapter status snapshots before replay-safe handoff.`,
      nextCommand: "load_adapter_status_snapshot",
      capabilities: freezeArray(adapterStatusMissing.map((contract) => contract.action)),
    }),
    syncBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_sync_invalid",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities with invalid sync checkpoint metadata.`,
      nextCommand: "repair_provider_sync_metadata",
      capabilities: freezeArray(syncBlocked.map((contract) => contract.action)),
    }),
    workflowBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_workflow_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities waiting on client workflow handoff commands.`,
      nextCommand: workflowBlocked[0]?.workflowGate?.nextCommand || "resolve_runtime_readiness",
      capabilities: freezeArray(workflowBlocked.map((contract) => contract.action)),
    }),
  ].filter(Boolean);
  const acceptanceGates = [
    ...pendingAcceptance.map((contract) => Object.freeze({
      action: contract.action,
      state: contract.acceptance.state,
      token: contract.acceptance.token,
      nextCommand: contract.acceptance.nextCommand,
      missing: contract.acceptance.missing,
    })),
    ...rejectedAcceptance.map((contract) => Object.freeze({
      action: contract.action,
      state: contract.acceptance.state,
      token: contract.acceptance.token,
      nextCommand: contract.acceptance.nextCommand,
      missing: contract.acceptance.missing,
    })),
  ];
  const providerAccepted = handoffErrors.length === 0
    && pendingAcceptance.length === 0
    && syncPending.length === 0
    && workflowBlocked.length === 0
    && adapterReady.length === mailchimpContracts.length;

  return Object.freeze({
    protocol: "aios.effects.provider-service-contract.v1",
    provider: mailchimpContracts.length > 0 ? "mailchimp" : "local",
    service: mailchimpContracts.length > 0 ? "mailchimp.campaignRuntimeAdapter" : "runtime",
    state: handoffErrors.length > 0
      ? "blocked"
      : pendingAcceptance.length > 0
        ? "waiting-for-operator"
      : syncPending.length > 0
        ? "waiting-for-provider-confirmation"
      : adapterReady.length === mailchimpContracts.length && mailchimpContracts.length > 0
        ? "negotiated"
        : mailchimpContracts.length > 0
          ? "preview-only"
          : "not-applicable",
    negotiation: Object.freeze({
      requestedCapabilities: mailchimpContracts.length,
      acceptedCapabilities: adapterReady.length,
      disabledCapabilities: disabled.length,
      pendingAcceptance: pendingAcceptance.length,
      rejectedAcceptance: rejectedAcceptance.length,
      adapterStatusFailed: adapterStatusFailed.length,
      adapterStatusMissing: adapterStatusMissing.length,
      syncBlocked: syncBlocked.length,
      syncPendingConfirmation: syncPending.length,
      workflowBlocked: workflowBlocked.length,
      workflowReady: workflowReady.length,
      acceptedForExternalHandoff: providerAccepted,
      acceptanceGates: freezeArray(acceptanceGates),
      capabilities: freezeArray(negotiatedCapabilities),
    }),
    syncMetadata: Object.freeze({
      tenantId: capabilityJob.principal?.tenantId || "",
      workspaceId: capabilityJob.principal?.workspaceId || "",
      actorId: capabilityJob.principal?.actorId || "",
      requestId: capabilityJob.principal?.requestId || "",
      statusChannels: freezeArray(statusChannels),
      statusSnapshotKeys: freezeArray(statusSnapshotKeys),
      syncWatermarkKeys: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.providerSync?.metadata?.watermarkKey).filter(Boolean))]),
      syncCheckpointKeys: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.providerSync?.metadata?.checkpointKey).filter(Boolean))]),
      providerObjectRefs: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.providerSync?.metadata?.objectRef).filter(Boolean))]),
      adapterStatusStates: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.statusReconciliation?.state).filter(Boolean))]),
      workflowStates: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.workflowGate?.state).filter(Boolean))]),
      workflowNextCommands: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.workflowGate?.nextCommand).filter(Boolean))]),
      auditEvents: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.audit?.event).filter(Boolean))]),
    }),
    externalHandoff: Object.freeze({
      accepted: providerAccepted,
      nextCommand: handoffErrors[0]?.nextCommand
        || pendingAcceptance[0]?.acceptance?.nextCommand
        || syncPending[0]?.providerSync?.nextCommand
        || negotiatedCapabilities.find((capability) => capability.nextAction !== "observe")?.nextAction
        || "observe",
      errors: freezeArray(handoffErrors),
      acceptanceGates: freezeArray(acceptanceGates),
    }),
  });
}

function commandRowsFromTypeManifest(typeJob = {}) {
  const manifest = typeJob.persistedState?.restartCommandManifest || {};
  return toArray(manifest.commands).map((command) => Object.freeze({
    command: compactString(command.command),
    commandId: compactString(command.commandId),
    phase: compactString(command.phase || "resume"),
    stepName: compactString(command.stepName),
    capability: compactString(command.capability),
    state: compactString(command.state || "ready"),
    nextCommand: compactString(command.nextCommand || manifest.userWorkflow?.nextCommand || "observe"),
    replayPolicy: compactString(command.replayPolicy || "dedupe-by-command-id"),
    idempotencyKey: compactString(command.idempotencyKey),
    statusSnapshotKey: compactString(command.statusSnapshotKey || manifest.statusSnapshotKey),
    resumeCursorKey: compactString(command.resumeCursorKey || manifest.resumeCursorKey),
    missing: command.missing || freezeArray([]),
    userVisible: command.userVisible || Object.freeze({
      label: compactString(command.command),
      blocking: command.state === "blocked",
      handoff: command.phase === "resume" ? "adapter" : "runtime",
    }),
  }));
}

function createReplayWorkflowContract(job = {}, providerPersistencePlan = {}, typeJob = {}, providerServiceContract = {}) {
  const typedCommands = commandRowsFromTypeManifest(typeJob);
  const providerCommands = toArray(providerPersistencePlan.idempotentCommands).map((command) => Object.freeze({
    command: compactString(command.command),
    commandId: compactString(command.commandId || `${providerPersistencePlan.restartToken || "restart:missing"}:${command.command}`),
    phase: "provider-sync",
    stepName: "",
    capability: compactString(command.action),
    state: command.externalWrite === false || command.checkpointKey || command.watermarkKey ? "runnable" : "blocked",
    nextCommand: compactString(command.command || providerPersistencePlan.recovery?.nextCommand || "observe"),
    replayPolicy: compactString(command.replayPolicy || "resume-from-provider-checkpoint"),
    idempotencyKey: compactString(command.idempotencyKey),
    statusSnapshotKey: compactString(providerPersistencePlan.statusSnapshotKey),
    resumeCursorKey: compactString(command.checkpointKey || command.watermarkKey),
    missing: freezeArray([
      command.externalWrite !== false && !command.idempotencyKey && "idempotencyKey",
      command.externalWrite !== false && !providerPersistencePlan.statusSnapshotKey && "statusSnapshotKey",
      command.externalWrite !== false && !command.checkpointKey && !command.watermarkKey && "providerCheckpoint",
    ].filter(Boolean)),
    userVisible: Object.freeze({
      label: command.action ? `Resume ${command.action}` : compactString(command.command),
      blocking: command.externalWrite !== false && !command.checkpointKey && !command.watermarkKey,
      handoff: "adapter",
    }),
  }));
  const commandsById = new Map();
  for (const command of [...typedCommands, ...providerCommands]) {
    const key = command.commandId || `${command.phase}:${command.command}:${command.capability || command.stepName}`;
    if (!commandsById.has(key)) commandsById.set(key, command);
  }
  const commands = [...commandsById.values()].sort((left, right) => {
    return left.phase.localeCompare(right.phase) || left.command.localeCompare(right.command) || left.capability.localeCompare(right.capability);
  });
  const blocked = commands.filter((command) => command.state === "blocked" || command.missing.length > 0 || command.userVisible?.blocking === true);
  const runnable = commands.filter((command) => command.state === "runnable" && command.missing.length === 0);
  const providerAccepted = providerServiceContract.externalHandoff?.accepted !== false;

  return Object.freeze({
    protocol: "aios.effects.replay-workflow.v1",
    jobName: compactString(job.name || typeJob.jobName || providerPersistencePlan.jobName || "anonymous"),
    state: blocked.length > 0
      ? "blocked"
      : runnable.length > 0 && providerAccepted
        ? "runnable"
        : commands.length > 0
          ? "waiting"
          : "not-required",
    acceptedForReplay: blocked.length === 0 && providerAccepted,
    acceptedForAdapter: blocked.length === 0 && providerAccepted && (providerPersistencePlan.state === "restart-safe" || providerPersistencePlan.state === "not-applicable"),
    commandKey: typeJob.persistedState?.restartCommandManifest?.commandKey || typeJob.persistedState?.commandKey || "",
    restartToken: typeJob.persistedState?.restartCommandManifest?.restartToken || providerPersistencePlan.restartToken || "",
    statusSnapshotKey: providerPersistencePlan.statusSnapshotKey || typeJob.persistedState?.statusSnapshotKey || "",
    commands: freezeArray(commands),
    blockedCommands: freezeArray(blocked.map((command) => ({
      command: command.command,
      phase: command.phase,
      capability: command.capability,
      stepName: command.stepName,
      missing: command.missing,
      nextCommand: command.nextCommand,
    }))),
    runnableCommands: freezeArray(runnable.map((command) => ({
      command: command.command,
      commandId: command.commandId,
      phase: command.phase,
      capability: command.capability,
      stepName: command.stepName,
      replayPolicy: command.replayPolicy,
    }))),
    userWorkflow: Object.freeze({
      nextCommand: blocked[0]?.nextCommand
        || runnable[0]?.nextCommand
        || providerPersistencePlan.recovery?.nextCommand
        || "observe",
      labels: freezeArray(commands.map((command) => command.userVisible?.label || command.command)),
      blockingLabels: freezeArray(blocked.map((command) => command.userVisible?.label || command.command)),
    }),
  });
}

function createReplayEvidenceSummary(job = {}, typeJob = {}, providerPersistencePlan = {}, replayWorkflow = {}, stepEffects = []) {
  const persistedState = typeJob.persistedState || {};
  const manifest = persistedState.restartCommandManifest || {};
  const scopeReplayReport = typeJob.scope?.persistedRuntime?.replayReport || {};
  const scopeSegments = toArray(typeJob.scope?.persistedRuntime?.replaySegments);
  const workflowCommands = toArray(replayWorkflow.commands);
  const providerCommands = toArray(providerPersistencePlan.idempotentCommands);
  const commandEvidence = workflowCommands.map((command, index) => {
    const matchingSegment = scopeSegments.find((segment) => {
      return compactString(segment.commandId) === compactString(command.commandId)
        || (segment.name && (segment.name === command.stepName || segment.name === command.capability));
    });
    const matchingProvider = providerCommands.find((providerCommand) => {
      return compactString(providerCommand.commandId) === compactString(command.commandId)
        || compactString(providerCommand.action) === compactString(command.capability);
    });
    const statusSnapshotKey = compactString(command.statusSnapshotKey || replayWorkflow.statusSnapshotKey || providerPersistencePlan.statusSnapshotKey);
    const idempotencyKey = compactString(command.idempotencyKey || matchingProvider?.idempotencyKey);
    const missing = [
      ...toArray(command.missing).map(compactString).filter(Boolean),
      command.phase === "provider-sync" && !matchingProvider?.checkpointKey && !matchingProvider?.watermarkKey && "providerCheckpoint",
      command.phase !== "restore" && command.phase !== "verify" && !idempotencyKey && "idempotencyKey",
      command.phase !== "restore" && !statusSnapshotKey && "statusSnapshotKey",
    ].filter(Boolean);

    return Object.freeze({
      index,
      command: compactString(command.command),
      commandId: compactString(command.commandId),
      phase: compactString(command.phase),
      stepName: compactString(command.stepName),
      capability: compactString(command.capability),
      state: missing.length > 0 || command.state === "blocked" ? "blocked" : compactString(command.state || "ready"),
      replayPolicy: compactString(command.replayPolicy || matchingSegment?.replayPolicy || matchingProvider?.replayPolicy || "dedupe-by-command-id"),
      idempotencyKey,
      statusSnapshotKey,
      checkpointKey: compactString(matchingProvider?.checkpointKey),
      watermarkKey: compactString(matchingProvider?.watermarkKey),
      segmentId: compactString(matchingSegment?.segmentId),
      missing: freezeArray([...new Set(missing)].sort()),
      nextCommand: missing.length > 0
        ? compactString(command.nextCommand || "attach_recovery_status_handoff")
        : compactString(command.nextCommand || matchingProvider?.command || "observe"),
    });
  });
  const blocked = commandEvidence.filter((row) => row.state === "blocked" || row.missing.length > 0);
  const runnable = commandEvidence.filter((row) => row.state === "runnable" || row.state === "ready");
  const externalWriteSteps = toArray(stepEffects).filter((effect) => effect.effectClass === "external-write");
  const checkpointSlots = toArray(providerPersistencePlan.checkpointSlots);
  const missingExternalEvidence = externalWriteSteps.length > 0 && commandEvidence.length === 0;
  const state = blocked.length > 0 || missingExternalEvidence
    ? "blocked"
    : replayWorkflow.state === "runnable" || scopeReplayReport.state === "adapter-replay-ready"
      ? "replay-ready"
      : commandEvidence.length > 0
        ? "tracked"
        : "not-required";

  return Object.freeze({
    protocol: "aios.effects.replay-evidence-summary.v1",
    jobName: compactString(job.name || typeJob.jobName || providerPersistencePlan.jobName || "anonymous"),
    state,
    acceptedForReplay: blocked.length === 0 && !missingExternalEvidence && replayWorkflow.acceptedForReplay !== false,
    acceptedForAdapter: blocked.length === 0
      && !missingExternalEvidence
      && replayWorkflow.acceptedForAdapter === true
      && providerPersistencePlan.recovery?.restartSafe !== false,
    restartToken: compactString(replayWorkflow.restartToken || manifest.restartToken || persistedState.restartToken),
    commandKey: compactString(replayWorkflow.commandKey || manifest.commandKey || persistedState.commandKey),
    statusSnapshotKey: compactString(replayWorkflow.statusSnapshotKey || providerPersistencePlan.statusSnapshotKey || persistedState.statusSnapshotKey),
    counters: Object.freeze({
      commands: commandEvidence.length,
      blockedCommands: blocked.length,
      runnableCommands: runnable.length,
      providerCommands: providerCommands.length,
      checkpointSlots: checkpointSlots.length,
      externalWriteSteps: externalWriteSteps.length,
      scopeReplaySegments: scopeSegments.length,
      scopeBlockedSegments: toArray(scopeReplayReport.blockedSegments).length,
    }),
    commands: freezeArray(commandEvidence),
    blockedCommands: freezeArray(blocked.map((row) => ({
      command: row.command,
      phase: row.phase,
      capability: row.capability,
      stepName: row.stepName,
      missing: row.missing,
      nextCommand: row.nextCommand,
    }))),
    checkpointEvidence: freezeArray(checkpointSlots.map((slot) => ({
      name: compactString(slot.name),
      checkpointKey: compactString(slot.checkpointKey),
      watermarkKey: compactString(slot.watermarkKey),
      objectRef: compactString(slot.objectRef),
      mode: compactString(slot.mode),
    }))),
    timeline: freezeArray(commandEvidence.map((row, index) => ({
      index,
      event: `replay-${row.phase || "command"}`,
      name: row.command,
      state: row.state,
      nextCommand: row.nextCommand,
      severity: row.missing.length > 0 ? 3 : row.phase === "provider-sync" ? 1 : 0,
    })).sort((left, right) => right.severity - left.severity || left.index - right.index)),
    nextCommand: blocked[0]?.nextCommand
      || (missingExternalEvidence ? "repair_restart_command_ledger" : "")
      || replayWorkflow.userWorkflow?.nextCommand
      || providerPersistencePlan.recovery?.nextCommand
      || "observe",
  });
}

function createProviderPersistencePlan(job = {}, capabilityJob = {}, providerServiceContract = {}, typeJob = {}) {
  const contracts = toArray(capabilityJob.contracts).filter((contract) => contract.provider === "mailchimp");
  const restartToken = compactString(capabilityJob.principal?.restartToken);
  const statusSnapshotKey = compactString(capabilityJob.principal?.statusSnapshotKey);
  const syncContracts = contracts.map((contract) => {
    const sync = contract.providerSync || {};
    const checkpointKey = compactString(sync.metadata?.checkpointKey);
    const watermarkKey = compactString(sync.metadata?.watermarkKey);
    const action = compactString(contract.action);
    return Object.freeze({
      action,
      state: sync.state || "not-applicable",
      adapterStatusState: contract.statusReconciliation?.state || "unobserved",
      adapterStatusNextCommand: contract.statusReconciliation?.nextCommand || "observe",
      resources: sync.resources || freezeArray([]),
      checkpointKey,
      watermarkKey,
      cursor: compactString(sync.metadata?.cursor),
      objectRef: compactString(sync.metadata?.objectRef),
      idempotencyKey: compactString(contract.audit?.requestId),
      restartSafe: sync.health?.restartSafe !== false
        && !["failed", "timed-out", "cancelled", "missing-status"].includes(contract.statusReconciliation?.state)
        && Boolean(checkpointKey || !contract.effects?.externalWrite),
      resumeCommand: ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state)
        ? contract.statusReconciliation?.nextCommand || "inspect_adapter_failure"
        : contract.statusReconciliation?.state === "missing-status"
          ? "load_adapter_status_snapshot"
        : sync.state === "blocked"
        ? "repair_provider_sync_metadata"
        : sync.state === "needs-provider-confirmation"
          ? "confirm_provider_resource_state"
          : contract.effects?.externalWrite
            ? "resume_provider_checkpoint"
            : "refresh_provider_watermark",
    });
  });
  const checkpointSlots = syncContracts
    .filter((contract) => contract.checkpointKey || contract.watermarkKey)
    .map((contract) => Object.freeze({
      name: `provider:${contract.action}`,
      checkpointKey: contract.checkpointKey,
      watermarkKey: contract.watermarkKey,
      objectRef: contract.objectRef,
      cursor: contract.cursor,
      mode: contract.checkpointKey ? "checkpoint" : "watermark",
    }));
  const blocked = syncContracts.filter((contract) => contract.state === "blocked" || contract.restartSafe === false);
  const pending = syncContracts.filter((contract) => contract.state === "needs-provider-confirmation");
  const statusBlocked = syncContracts.filter((contract) => ["failed", "timed-out", "cancelled", "missing-status"].includes(contract.adapterStatusState));
  const externalAccepted = providerServiceContract.externalHandoff?.accepted !== false;

  return Object.freeze({
    protocol: "aios.effects.provider-persistence-plan.v1",
    jobName: compactString(job.name || capabilityJob.jobName || "anonymous"),
    provider: contracts.length > 0 ? "mailchimp" : "local",
    state: statusBlocked.length > 0 || blocked.length > 0
      ? "blocked"
      : pending.length > 0
        ? "awaiting-provider-confirmation"
        : contracts.length > 0 && externalAccepted
          ? "restart-safe"
          : contracts.length > 0
            ? "preview-only"
            : "not-applicable",
    restartToken,
    statusSnapshotKey,
    checkpointSlots: freezeArray(checkpointSlots),
    syncContracts: freezeArray(syncContracts),
    idempotentCommands: freezeArray(syncContracts.map((contract) => ({
      command: contract.resumeCommand,
      commandId: stableProviderCommandId(typeJob, contract.resumeCommand, contract.action),
      action: contract.action,
      adapterStatusState: contract.adapterStatusState,
      externalWrite: contract.state !== "not-applicable" && contracts.some((candidate) => candidate.action === contract.action && candidate.effects?.externalWrite),
      idempotencyKey: contract.idempotencyKey,
      checkpointKey: contract.checkpointKey,
      watermarkKey: contract.watermarkKey,
      replayPolicy: contract.checkpointKey ? "resume-from-provider-checkpoint" : "refresh-provider-watermark",
    }))),
    recovery: Object.freeze({
      nextCommand: statusBlocked[0]?.resumeCommand
        || blocked[0]?.resumeCommand
        || pending[0]?.resumeCommand
        || providerServiceContract.externalHandoff?.nextCommand
        || "observe",
      restartSafe: blocked.length === 0 && syncContracts.every((contract) => contract.restartSafe),
      requiresExternalConfirmation: pending.length > 0,
    }),
  });
}

function stableProviderCommandId(typeJob = {}, command, action) {
  const manifest = typeJob.persistedState?.restartCommandManifest || {};
  return stableCommandToken("provider", [
    manifest.restartToken || typeJob.persistedState?.restartToken,
    manifest.commandKey || typeJob.persistedState?.commandKey,
    command,
    action,
  ]);
}

function stableCommandToken(prefix, parts) {
  const body = parts.map(compactString).filter(Boolean).join(":");
  return `${prefix}:${body || "anonymous"}`;
}

function createEffectAnalyticsExport(jobPlans = [], diagnostics = []) {
  const snapshots = toArray(jobPlans).map((job) => job.historySnapshot).filter(Boolean);
  const counters = createAnalyticsCounters(toArray(jobPlans).flatMap((job) => job.effects || []), diagnostics);
  const reportRows = toArray(jobPlans).map((job) => createJobExportReportRow(job));
  const blockedRows = reportRows.filter((row) => row.status === "blocked" || row.blockedBy.length > 0);
  const adapterRows = reportRows.filter((row) => row.adapterReady);
  const replayRows = reportRows.filter((row) => row.replayState !== "not-required");
  const replayEvidence = toArray(jobPlans).map((job) => job.replayEvidence).filter(Boolean);
  const replayBlocked = replayEvidence.filter((evidence) => evidence.state === "blocked" || evidence.blockedCommands?.length > 0);

  return Object.freeze({
    protocol: "aios.effects.analytics-export.v1",
    state: counters.errors > 0 || counters.blockedSteps > 0
      ? "blocked"
      : counters.degradedSteps > 0
        ? "degraded"
        : counters.approvalSteps > 0
          ? "needs-operator-action"
          : "ready",
    counters,
    snapshots: freezeArray(snapshots),
    timeline: freezeArray(snapshots
      .flatMap((snapshot) => snapshot.timeline.map((event) => ({ ...event, jobName: snapshot.jobName })))
      .sort((left, right) => right.severity - left.severity || left.jobName.localeCompare(right.jobName) || left.index - right.index)),
    report: Object.freeze({
      exportReady: counters.errors === 0,
      blockedJobs: snapshots.filter((snapshot) => snapshot.state === "blocked").length,
      degradedJobs: snapshots.filter((snapshot) => snapshot.state === "degraded").length,
      statusChannels: freezeArray([...new Set(snapshots.flatMap((snapshot) => snapshot.statusChannels))]),
      statusSnapshotKeys: freezeArray([...new Set(snapshots.flatMap((snapshot) => snapshot.statusSnapshotKeys))]),
      adapterStatusStates: freezeArray([...new Set(reportRows.flatMap((row) => row.adapterStatusStates || []))]),
      workflowStates: freezeArray([...new Set(reportRows.flatMap((row) => row.workflowStates || []))]),
      workflowNextCommands: freezeArray([...new Set(reportRows.flatMap((row) => row.workflowNextCommands || []))]),
      syncCheckpointKeys: freezeArray([...new Set(toArray(jobPlans).flatMap((job) => job.providerPersistencePlan?.checkpointSlots || []).map((slot) => slot.checkpointKey).filter(Boolean))]),
      replayWorkflowStates: freezeArray([...new Set(toArray(jobPlans).map((job) => job.replayWorkflow?.state).filter(Boolean))]),
      replayWorkflowCommands: freezeArray([...new Set(toArray(jobPlans).flatMap((job) => job.replayWorkflow?.commands || []).map((command) => command.command).filter(Boolean))]),
      blockedReplayCommands: toArray(jobPlans).reduce((count, job) => count + (job.replayWorkflow?.blockedCommands?.length ?? 0), 0),
      replayEvidenceStates: freezeArray([...new Set(replayEvidence.map((evidence) => evidence.state).filter(Boolean))]),
      replayEvidenceCommands: freezeArray([...new Set(replayEvidence.flatMap((evidence) => evidence.commands || []).map((command) => command.command).filter(Boolean))]),
      replayEvidenceCheckpoints: freezeArray([...new Set(replayEvidence.flatMap((evidence) => evidence.checkpointEvidence || []).map((checkpoint) => checkpoint.checkpointKey).filter(Boolean))]),
      blockedReplayEvidence: replayBlocked.length,
    }),
    exportRows: freezeArray(reportRows),
    replayEvidence: freezeArray(replayEvidence),
    exportReadiness: Object.freeze({
      ready: counters.errors === 0 && blockedRows.length === 0 && replayBlocked.length === 0,
      adapterReadyJobs: adapterRows.length,
      replayTrackedJobs: replayRows.length,
      blockedRows: blockedRows.length,
      blockedBy: freezeArray([...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort()),
      nextCommand: replayBlocked[0]?.nextCommand
        || blockedRows[0]?.nextCommand
        || reportRows.find((row) => row.nextCommand !== "observe")?.nextCommand
        || "publish_effect_analytics_export",
    }),
  });
}

function createJobExportReportRow(job = {}) {
  const preview = job.preview || {};
  const handoff = job.handoff || {};
  const providerServiceContract = job.providerServiceContract || {};
  const providerPersistencePlan = job.providerPersistencePlan || {};
  const replayWorkflow = job.replayWorkflow || {};
  const replayEvidence = job.replayEvidence || {};
  const diagnostics = toArray(job.diagnostics);
  const blockedBy = [
    ...diagnostics
      .filter((diagnostic) => diagnostic.level === "error")
      .map((diagnostic) => diagnostic.code || "diagnostic:error"),
    ...toArray(providerServiceContract.externalHandoff?.errors)
      .map((error) => error.code || "provider:error"),
    ...toArray(replayWorkflow.blockedCommands)
      .map((command) => `replay:${command.command}`),
    ...toArray(replayEvidence.blockedCommands)
      .map((command) => `replay-evidence:${command.command}`),
  ].sort();
  const statusSnapshotKeys = [
    ...toArray(handoff.statusSummary?.statusSnapshotKeys),
    ...toArray(providerServiceContract.syncMetadata?.statusSnapshotKeys),
    providerPersistencePlan.statusSnapshotKey,
  ].filter(Boolean);
  const adapterStatusStates = [
    ...toArray(providerServiceContract.syncMetadata?.adapterStatusStates),
    ...toArray(providerPersistencePlan.syncContracts).map((contract) => contract.adapterStatusState),
    ...toArray(job.effects).flatMap((effect) => toArray(effect.health?.adapterStatus).map((row) => row.state)),
  ].filter(Boolean);
  const workflowStates = [
    ...toArray(providerServiceContract.syncMetadata?.workflowStates),
    ...toArray(job.effects).flatMap((effect) => toArray(effect.health?.clientWorkflow).map((row) => row.state)),
  ].filter(Boolean);
  const workflowNextCommands = [
    ...toArray(providerServiceContract.syncMetadata?.workflowNextCommands),
    ...toArray(job.effects).flatMap((effect) => toArray(effect.health?.clientWorkflow).map((row) => row.nextCommand)),
  ].filter(Boolean);

  return Object.freeze({
    jobName: job.jobName || preview.jobName || "anonymous",
    status: blockedBy.length ? "blocked" : job.status || "unknown",
    previewState: preview.state || "not-rendered",
    adapterReady: preview.acceptedForAdapter === true || handoff.acceptedForRuntime === true,
    runtimeReady: preview.acceptedForRuntime === true || handoff.acceptedForRuntime === true,
    providerState: providerServiceContract.state || "not-applicable",
    providerPersistenceState: providerPersistencePlan.state || "not-applicable",
    replayState: replayWorkflow.state || "not-required",
    replayEvidenceState: replayEvidence.state || "not-required",
    statusChannels: freezeArray([
      ...toArray(providerServiceContract.syncMetadata?.statusChannels),
      preview.providerPersistence?.statusChannel,
    ].filter(Boolean)),
    statusSnapshotKeys: freezeArray([...new Set(statusSnapshotKeys)].sort()),
    adapterStatusStates: freezeArray([...new Set(adapterStatusStates)].sort()),
    workflowStates: freezeArray([...new Set(workflowStates)].sort()),
    workflowNextCommands: freezeArray([...new Set(workflowNextCommands)].sort()),
    counters: Object.freeze({
      steps: job.analytics?.totalSteps ?? toArray(job.effects).length,
      externalWrites: job.analytics?.externalWrites ?? 0,
      blockedSteps: job.analytics?.blockedSteps ?? 0,
      retryableSteps: job.analytics?.retryableSteps ?? 0,
      replayCommands: replayWorkflow.commands?.length ?? 0,
      blockedReplayCommands: replayWorkflow.blockedCommands?.length ?? 0,
      replayEvidenceCommands: replayEvidence.commands?.length ?? 0,
      blockedReplayEvidence: replayEvidence.blockedCommands?.length ?? 0,
      adapterStatusFailures: toArray(job.effects).filter((effect) => effect.status === "adapter-status-failed").length,
      adapterStatusMissing: toArray(job.effects).filter((effect) => effect.status === "adapter-status-missing").length,
      clientWorkflowBlocked: toArray(job.effects).filter((effect) => effect.status === "client-workflow-blocked").length,
    }),
    blockedBy: freezeArray([...new Set(blockedBy)]),
    nextCommand: replayEvidence.nextCommand
      || replayWorkflow.userWorkflow?.nextCommand
      || providerServiceContract.externalHandoff?.nextCommand
      || preview.nextStep?.command
      || handoff.recovery?.nextCommand
      || "observe",
  });
}

function createEffectExportManifest(jobPlans = [], diagnostics = [], acceptanceReport = {}, lifecycleControlPlane = {}) {
  const rows = toArray(jobPlans).map((job) => createJobExportReportRow(job));
  const diagnosticsByCode = countDiagnosticsByCode(diagnostics);
  const statusChannels = [...new Set(rows.flatMap((row) => row.statusChannels))].sort();
  const statusSnapshotKeys = [...new Set(rows.flatMap((row) => row.statusSnapshotKeys))].sort();
  const blockedRows = rows.filter((row) => row.blockedBy.length > 0);
  const replayEvidence = toArray(jobPlans).map((job) => job.replayEvidence).filter(Boolean);
  const blockedReplayEvidence = replayEvidence.filter((evidence) => evidence.state === "blocked" || evidence.blockedCommands?.length > 0);
  const exportReady = blockedRows.length === 0
    && blockedReplayEvidence.length === 0
    && toArray(diagnostics).every((diagnostic) => diagnostic.level !== "error")
    && lifecycleControlPlane.controls?.enablePreview === true;
  const timeline = rows.map((row, index) => Object.freeze({
    index,
    jobName: row.jobName,
    phase: row.replayState === "blocked"
      ? "replay"
      : row.providerPersistenceState === "blocked"
        ? "provider-persistence"
        : row.providerState === "waiting-for-operator"
          ? "operator-acceptance"
          : row.adapterReady
            ? "adapter-handoff"
            : "runtime-preview",
    status: row.status,
    nextCommand: row.nextCommand,
    severity: row.blockedBy.length ? 3 : row.previewState === "needs-operator-action" ? 2 : row.adapterReady ? 0 : 1,
  })).sort((left, right) => right.severity - left.severity || left.index - right.index);

  return Object.freeze({
    protocol: "aios.effects.export-manifest.v1",
    manifestId: stableCommandToken("effect-export", [
      rows.map((row) => row.jobName).join(","),
      statusSnapshotKeys.join(","),
      acceptanceReport.state,
      lifecycleControlPlane.state,
    ]),
    exportReady,
    status: exportReady
      ? "ready"
      : blockedRows.length
        ? "blocked"
        : acceptanceReport.state === "needs-operator-action"
          ? "needs-operator-action"
          : "waiting",
    format: Object.freeze({
      kind: "mailchimp.effectAnalyticsExport",
      schemaVersion: 1,
      deterministic: true,
      primaryKey: "jobName",
    }),
    rows: freezeArray(rows),
    diagnosticsByCode: Object.freeze(diagnosticsByCode),
    statusChannels: freezeArray(statusChannels),
    statusSnapshotKeys: freezeArray(statusSnapshotKeys),
    replayEvidence: freezeArray(replayEvidence),
    timeline: freezeArray(timeline),
    commands: freezeArray([
      {
        command: "publish_effect_analytics_export",
        enabled: exportReady,
        manifestId: stableCommandToken("publish-effect-export", [statusSnapshotKeys.join(","), rows.length]),
      },
      {
        command: "persist_effect_export_manifest",
        enabled: true,
        manifestId: stableCommandToken("persist-effect-export", [rows.map((row) => row.jobName).join(","), rows.length]),
      },
      {
        command: "repair_effect_export_blockers",
        enabled: blockedRows.length > 0 || blockedReplayEvidence.length > 0,
        blockedBy: freezeArray([...new Set([
          ...blockedRows.flatMap((row) => row.blockedBy),
          ...blockedReplayEvidence.flatMap((evidence) => toArray(evidence.blockedCommands).map((command) => `replay-evidence:${command.command}`)),
        ])].sort()),
      },
    ]),
    nextAction: exportReady
      ? "publish_effect_analytics_export"
      : blockedReplayEvidence[0]?.nextCommand
        || blockedRows[0]?.nextCommand
        || lifecycleControlPlane.nextAction?.command
        || acceptanceReport.nextActions?.[0]?.command
        || "persist_effect_export_manifest",
  });
}

function countDiagnosticsByCode(diagnostics = []) {
  const counts = {};
  for (const diagnostic of toArray(diagnostics)) {
    const code = diagnostic.code || `${diagnostic.level || "info"}:uncoded`;
    counts[code] = (counts[code] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function createPreviewStepCard(effect = {}) {
  const blocked = toArray(effect.actionableErrors).length > 0;
  const degraded = compactString(effect.health?.degradedMode) && effect.health.degradedMode !== "none";
  const statusChannel = compactString(effect.health?.statusChannel);
  const nextCommand = effect.actionableErrors?.[0]?.nextCommand || effect.recovery?.command || "observe";

  return Object.freeze({
    step: effect.step,
    adapter: effect.adapter,
    effectClass: effect.effectClass,
    status: effect.status,
    previewState: blocked
      ? "blocked"
      : degraded
        ? "preview-only"
        : effect.status === "awaiting-operator-approval"
          ? "needs-operator-action"
          : "ready",
    reads: effect.reads || freezeArray([]),
    writes: effect.writes || freezeArray([]),
    capabilities: effect.capabilities || freezeArray([]),
    statusChannel,
      statusSnapshotKeys: effect.health?.statusSnapshotKeys || freezeArray([]),
      adapterStatus: effect.health?.adapterStatus || freezeArray([]),
      nextCommand,
    acceptance: Object.freeze({
      acceptedForPreview: true,
      acceptedForRuntime: !blocked && !degraded && effect.status !== "awaiting-operator-approval",
      retryEnabled: effect.retryPolicy?.retryableStatuses?.length > 0 && !blocked,
      rollbackRequired: effect.recovery?.rollbackRequired === true,
      verifierEvidenceRequired: effect.recovery?.verifierEvidenceRequired === true,
    }),
    validation: Object.freeze({
      actionableErrors: effect.actionableErrors || freezeArray([]),
      degradedMode: effect.health?.degradedMode || "none",
      retryStrategy: effect.retryPolicy?.strategy || "none",
      auditEvents: effect.health?.auditEvents || freezeArray([]),
      operatorAcceptance: effect.health?.operatorAcceptance || freezeArray([]),
      adapterStatus: effect.health?.adapterStatus || freezeArray([]),
    }),
  });
}

function createUserVisibleEffectPreview(job = {}, stepEffects = [], diagnostics = [], providerServiceContract = {}, providerPersistencePlan = {}, replayWorkflow = {}) {
  const cards = stepEffects.map(createPreviewStepCard);
  const blocked = cards.filter((card) => card.previewState === "blocked");
  const previewOnly = cards.filter((card) => card.previewState === "preview-only");
  const operator = cards.filter((card) => card.previewState === "needs-operator-action");
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const external = cards.filter((card) => card.effectClass === "external-write");
  const providerAccepted = providerServiceContract.externalHandoff?.accepted !== false;
  const providerNextCommand = providerServiceContract.externalHandoff?.nextCommand || "";
  const replayBlocked = toArray(replayWorkflow.blockedCommands);
  const replayRunnable = toArray(replayWorkflow.runnableCommands);
  const nextCommand = replayBlocked[0]?.nextCommand
    || (providerAccepted === false ? providerNextCommand || "resolve_provider_handoff" : replayRunnable[0]?.nextCommand)
    || (providerAccepted === false
      ? providerNextCommand || "resolve_provider_handoff"
      : blocked[0]?.nextCommand
        || previewOnly[0]?.nextCommand
        || operator[0]?.nextCommand
        || (external.length > 0 ? "queue_adapter_handoff" : "start_runtime"));
  const nextReason = replayBlocked.length > 0
    ? "Restart replay commands need persisted status state before adapter handoff."
    : providerAccepted === false
      ? "Provider handoff requirements are not satisfied."
      : blocked.length > 0
        ? "Blocking effect validation errors must be resolved."
        : previewOnly.length > 0
          ? "Preview can render while degraded adapter state is repaired."
          : operator.length > 0
            ? "Verifier evidence or operator approval is required."
            : external.length > 0
              ? "External effects are ready for adapter handoff."
              : "Local runtime effects are ready.";
  const state = errors.length > 0 || blocked.length > 0
    ? "blocked"
    : replayWorkflow.state === "blocked"
      ? "blocked"
    : previewOnly.length > 0 || providerServiceContract.state === "preview-only"
      ? "preview-only"
      : providerServiceContract.state === "waiting-for-operator"
        ? "needs-operator-action"
      : operator.length > 0
        ? "needs-operator-action"
        : external.length > 0
          ? "adapter-ready"
          : "local-ready";

  return Object.freeze({
    protocol: "aios.effects.user-visible-preview.v1",
    jobName: compactString(job.name || "anonymous"),
    state,
    title: compactString(job.previewTitle || job.name || "AI OS effect preview"),
    acceptedForPreview: true,
    acceptedForRuntime: state === "local-ready" || state === "adapter-ready",
    acceptedForAdapter: providerAccepted && state === "adapter-ready",
    cards: freezeArray(cards),
    validationSummary: Object.freeze({
      errors: errors.length,
      warnings: toArray(diagnostics).filter((diagnostic) => diagnostic.level === "warning").length,
      blockedSteps: blocked.length,
      previewOnlySteps: previewOnly.length,
      operatorSteps: operator.length,
      externalWrites: external.length,
      providerState: providerServiceContract.state || "not-applicable",
      pendingAcceptance: providerServiceContract.negotiation?.pendingAcceptance ?? 0,
      rejectedAcceptance: providerServiceContract.negotiation?.rejectedAcceptance ?? 0,
      providerSyncBlocked: providerServiceContract.negotiation?.syncBlocked ?? 0,
      providerSyncPending: providerServiceContract.negotiation?.syncPendingConfirmation ?? 0,
      adapterStatusFailed: providerServiceContract.negotiation?.adapterStatusFailed ?? 0,
      adapterStatusMissing: providerServiceContract.negotiation?.adapterStatusMissing ?? 0,
      workflowBlocked: providerServiceContract.negotiation?.workflowBlocked ?? 0,
      workflowReady: providerServiceContract.negotiation?.workflowReady ?? 0,
      persistedCheckpoints: providerPersistencePlan.checkpointSlots?.length ?? 0,
      replayCommands: replayWorkflow.commands?.length ?? 0,
      blockedReplayCommands: replayBlocked.length,
      runnableReplayCommands: replayRunnable.length,
    }),
    nextStep: Object.freeze({
      command: nextCommand,
      reason: nextReason,
    }),
    providerNegotiation: providerServiceContract.negotiation || Object.freeze({
      requestedCapabilities: 0,
      acceptedCapabilities: 0,
      disabledCapabilities: 0,
      acceptedForExternalHandoff: true,
      capabilities: freezeArray([]),
    }),
    providerPersistence: Object.freeze({
      state: providerPersistencePlan.state || "not-applicable",
      checkpointSlots: providerPersistencePlan.checkpointSlots || freezeArray([]),
      nextCommand: providerPersistencePlan.recovery?.nextCommand || "observe",
      restartSafe: providerPersistencePlan.recovery?.restartSafe !== false,
      adapterStatusStates: freezeArray([...new Set(toArray(providerPersistencePlan.syncContracts).map((contract) => contract.adapterStatusState).filter(Boolean))]),
    }),
    replayWorkflow: Object.freeze({
      state: replayWorkflow.state || "not-required",
      acceptedForReplay: replayWorkflow.acceptedForReplay !== false,
      acceptedForAdapter: replayWorkflow.acceptedForAdapter === true,
      commands: replayWorkflow.commands || freezeArray([]),
      blockedCommands: replayWorkflow.blockedCommands || freezeArray([]),
      runnableCommands: replayWorkflow.runnableCommands || freezeArray([]),
      nextCommand: replayWorkflow.userWorkflow?.nextCommand || "observe",
    }),
  });
}

function createEffectAcceptanceReport(jobPlans = [], diagnostics = []) {
  const previews = toArray(jobPlans).map((job) => job.preview).filter(Boolean);
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const blocked = previews.filter((preview) => preview.state === "blocked");
  const previewOnly = previews.filter((preview) => preview.state === "preview-only");
  const operator = previews.filter((preview) => preview.state === "needs-operator-action");

  return Object.freeze({
    protocol: "aios.effects.acceptance-report.v1",
    state: errors.length > 0 || blocked.length > 0
      ? "blocked"
      : previewOnly.length > 0
        ? "preview-only"
        : operator.length > 0
          ? "needs-operator-action"
          : "accepted",
    acceptedForPreview: true,
    acceptedForRuntime: errors.length === 0 && blocked.length === 0 && previewOnly.length === 0 && operator.length === 0,
    acceptedForAdapter: errors.length === 0 && previews.every((preview) => preview.acceptedForAdapter || preview.state === "local-ready"),
    previews: freezeArray(previews),
    validationSummary: Object.freeze({
      jobs: previews.length,
      blockedJobs: blocked.length,
      previewOnlyJobs: previewOnly.length,
      operatorJobs: operator.length,
      runtimeAcceptedJobs: previews.filter((preview) => preview.acceptedForRuntime).length,
      adapterAcceptedJobs: previews.filter((preview) => preview.acceptedForAdapter).length,
      replayBlockedJobs: previews.filter((preview) => preview.replayWorkflow?.state === "blocked").length,
      replayRunnableJobs: previews.filter((preview) => preview.replayWorkflow?.state === "runnable").length,
      errors: errors.length,
      warnings: toArray(diagnostics).filter((diagnostic) => diagnostic.level === "warning").length,
    }),
    nextActions: freezeArray([...new Map(previews
      .map((preview) => preview.nextStep)
      .filter((nextStep) => nextStep?.command)
      .map((nextStep) => [nextStep.command, nextStep])).values()]),
  });
}

function createLifecycleControlPlane(jobPlans = [], capabilityAnalysis = {}, diagnostics = []) {
  const analytics = capabilityAnalysis.analyticsExport || {};
  const heldCapabilities = toArray(analytics.heldCapabilities);
  const jobStates = toArray(jobPlans).map((job) => ({
    jobName: job.jobName,
    status: job.status,
    blocked: job.status === "blocked",
    degraded: job.status === "degraded-boundary-hold",
    needsOperator: job.status === "needs-operator-action",
    acceptedForRuntime: job.handoff?.acceptedForRuntime === true,
    nextCommand: job.handoff?.recovery?.nextCommand || "observe",
    replayWorkflowState: job.replayWorkflow?.state || "not-required",
  }));
  const blockedJobs = jobStates.filter((job) => job.blocked);
  const degradedJobs = jobStates.filter((job) => job.degraded);
  const operatorJobs = jobStates.filter((job) => job.needsOperator);
  const replayBlockedJobs = jobStates.filter((job) => job.replayWorkflowState === "blocked");
  const hasErrors = toArray(diagnostics).some((diagnostic) => diagnostic.level === "error");

  return Object.freeze({
    protocol: "aios.effects.lifecycle-control-plane.v1",
    state: hasErrors || blockedJobs.length > 0
      ? "disabled"
      : degradedJobs.length > 0
        ? "preview-only"
        : operatorJobs.length > 0
          ? "waiting-for-operator"
          : "enabled",
    controls: Object.freeze({
      enableRuntime: !hasErrors && blockedJobs.length === 0 && degradedJobs.length === 0 && operatorJobs.length === 0 && replayBlockedJobs.length === 0,
      enablePreview: true,
      enableAdapterHandoff: analytics.exportReady === true && heldCapabilities.length === 0 && blockedJobs.length === 0 && operatorJobs.length === 0 && replayBlockedJobs.length === 0,
      enableRetry: jobPlans.some((job) => job.analytics?.retryableSteps > 0) && heldCapabilities.length === 0,
      requireOperatorGate: operatorJobs.length > 0,
      requireBoundaryResolution: heldCapabilities.length > 0 || blockedJobs.length > 0,
      requireReplayRepair: jobPlans.some((job) => job.replayWorkflow?.state === "blocked"),
    }),
    nextAction: replayBlockedJobs.length > 0
      ? Object.freeze({
        command: "attach_recovery_status_handoff",
        reason: "Restart replay commands need persisted status state before adapter handoff.",
        jobs: freezeArray(replayBlockedJobs.map((job) => job.jobName)),
      })
      : heldCapabilities.length > 0
      ? Object.freeze({
        command: "resolve_boundary_hold",
        reason: "Mailchimp capability boundaries must be cleared before adapter handoff.",
        heldCapabilities: freezeArray(heldCapabilities),
      })
      : blockedJobs.length > 0
        ? Object.freeze({
          command: "resolve_actionable_errors",
          reason: "Effect plan contains blocking actionable errors.",
          jobs: freezeArray(blockedJobs.map((job) => job.jobName)),
        })
        : operatorJobs.length > 0
          ? Object.freeze({
            command: "collect_verifier_evidence",
            reason: "Operator approval or verifier evidence is required.",
            jobs: freezeArray(operatorJobs.map((job) => job.jobName)),
          })
          : degradedJobs.length > 0
            ? Object.freeze({
              command: "continue_preview_and_resolve_holds",
              reason: "Runtime can preview while degraded boundary state is resolved.",
              jobs: freezeArray(degradedJobs.map((job) => job.jobName)),
            })
            : Object.freeze({
              command: "start_runtime",
              reason: "Effects are ready for runtime execution.",
              jobs: freezeArray(jobStates.map((job) => job.jobName)),
            }),
    jobs: freezeArray(jobStates),
  });
}

function createJobEffectPlan(job = {}, capabilityJob = {}, typeJob = {}) {
  const capabilities = capabilityByAction(capabilityJob);
  const stepEffects = toArray(job.steps).map((step) => createStepEffect(step, capabilities));
  const externalWrites = stepEffects.filter((effect) => effect.effectClass === "external-write");
  const approvalSteps = stepEffects.filter((effect) => effect.status === "awaiting-operator-approval");
  const boundaryHeldSteps = stepEffects.filter((effect) => effect.status === "held-for-boundary-review");
  const rollback = job.rollback || {};
  const rollbackReady = externalWrites.length === 0 || Boolean(rollback.strategy || rollback.target || rollback.command);
  const diagnostics = [];
  const providerServiceContract = createProviderServiceContract(job, stepEffects, capabilityJob);
  const providerPersistencePlan = createProviderPersistencePlan(job, capabilityJob, providerServiceContract, typeJob);
  const replayWorkflow = createReplayWorkflowContract(job, providerPersistencePlan, typeJob, providerServiceContract);
  const replayEvidence = createReplayEvidenceSummary(job, typeJob, providerPersistencePlan, replayWorkflow, stepEffects);

  if (externalWrites.length > 0 && !rollbackReady) {
    diagnostics.push(Object.freeze({
      level: "warning",
      code: "aios.effects.external_write_missing_rollback",
      message: `Job "${job.name}" performs external writes without an explicit rollback plan.`,
      jobName: job.name,
    }));
  }

  for (const effect of stepEffects) {
    for (const error of effect.actionableErrors) {
      diagnostics.push(Object.freeze({
        level: "error",
        code: error.code,
        message: error.message,
        jobName: job.name,
        stepName: effect.step,
        nextCommand: error.nextCommand,
      }));
    }
  }

  for (const error of providerServiceContract.externalHandoff.errors) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: error.code,
      message: error.message,
      jobName: job.name,
      nextCommand: error.nextCommand,
    }));
  }

  if (providerPersistencePlan.state === "blocked") {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.effects.provider_persistence_blocked",
      message: `Job "${job.name}" cannot persist restart-safe Mailchimp checkpoints until provider sync metadata is repaired.`,
      jobName: job.name,
      nextCommand: providerPersistencePlan.recovery.nextCommand,
    }));
  }

  for (const command of replayWorkflow.blockedCommands) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.effects.replay_command_blocked",
      message: `Job "${job.name}" cannot replay restart command "${command.command}" until persisted recovery state is attached.`,
      jobName: job.name,
      command: command.command,
      missing: command.missing,
      nextCommand: command.nextCommand,
    }));
  }

  for (const command of replayEvidence.blockedCommands) {
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.effects.replay_evidence_blocked",
      message: `Job "${job.name}" has incomplete replay evidence for command "${command.command}".`,
      jobName: job.name,
      command: command.command,
      missing: command.missing,
      nextCommand: command.nextCommand,
    }));
  }

  if (approvalSteps.length > 0 && toArray(job.verifiers).length === 0) {
    diagnostics.push(Object.freeze({
      level: "warning",
      code: "aios.effects.approval_without_verifier",
      message: `Job "${job.name}" requires approval but has no verifier contract.`,
      jobName: job.name,
    }));
  }

  return Object.freeze({
    jobName: compactString(job.name || capabilityJob.jobName || "anonymous"),
    status: diagnostics.some((diagnostic) => diagnostic.level === "error")
      ? "blocked"
      : boundaryHeldSteps.length > 0
        ? "degraded-boundary-hold"
      : approvalSteps.length > 0
        ? "needs-operator-action"
        : "ready-for-runtime",
    effects: freezeArray(stepEffects),
    diagnostics: freezeArray(diagnostics),
    analytics: createAnalyticsCounters(stepEffects, diagnostics),
    historySnapshot: createHistorySnapshot(job, stepEffects, diagnostics, capabilityJob),
    preview: createUserVisibleEffectPreview(job, stepEffects, diagnostics, providerServiceContract, providerPersistencePlan, replayWorkflow),
    providerServiceContract,
    providerPersistencePlan,
    replayWorkflow,
    replayEvidence,
    handoff: createEffectHandoff(job, stepEffects, approvalSteps, capabilityJob, providerServiceContract, providerPersistencePlan, replayWorkflow),
  });
}

export function createEffectHandoff(
  job = {},
  stepEffects = [],
  approvalSteps = [],
  capabilityJob = {},
  providerServiceContract = createProviderServiceContract(job, stepEffects, capabilityJob),
  providerPersistencePlan = createProviderPersistencePlan(job, capabilityJob, providerServiceContract),
  replayWorkflow = createReplayWorkflowContract(job, providerPersistencePlan, {}, providerServiceContract)
) {
  const external = stepEffects.filter((effect) => effect.effectClass === "external-write");
  const blocked = stepEffects.filter((effect) => effect.actionableErrors.length > 0);
  const degraded = stepEffects.filter((effect) => effect.health.degradedMode !== "none");
  const verifierEvidence = stepEffects.filter((effect) => effect.recovery.verifierEvidenceRequired).map((effect) => effect.step).sort();
  const statusState = blocked.length > 0
    ? "blocked"
    : degraded.length > 0
      ? "degraded"
      : external.length === 0
    ? "local-ready"
    : approvalSteps.length > 0
      ? "waiting_for_verifier"
      : "queued";

  return Object.freeze({
    adapter: external.some((effect) => effect.adapter.includes("mailchimp")) ? "mailchimp.campaignRuntimeAdapter" : "runtime",
    state: statusState,
    acceptedForRuntime: statusState === "local-ready" || statusState === "queued",
    acceptedForPreview: true,
    providerServiceContract,
    health: createOperationalHealth(job, stepEffects, capabilityJob),
    recovery: Object.freeze({
      recoverable: true,
      nextCommand: replayWorkflow.state === "blocked"
        ? replayWorkflow.userWorkflow?.nextCommand || "attach_recovery_status_handoff"
        : providerServiceContract.externalHandoff?.accepted === false
        ? providerServiceContract.externalHandoff.nextCommand
        : statusState === "blocked"
        ? "resolve_actionable_errors"
        : statusState === "degraded"
          ? "continue_preview_and_resolve_holds"
          : statusState === "waiting_for_verifier"
            ? "collect_verifier_evidence"
            : "observe",
      rollbackRequired: stepEffects.some((effect) => effect.recovery.rollbackRequired),
    }),
    statusSummary: Object.freeze({
      jobName: compactString(job.name || "anonymous"),
      totalSteps: stepEffects.length,
      externalWrites: external.length,
      approvalSteps: approvalSteps.length,
      degradedSteps: degraded.length,
      blockedSteps: blocked.length,
      verifierEvidence,
      statusSnapshotKeys: freezeArray([...new Set(stepEffects.flatMap((effect) => effect.health.statusSnapshotKeys || []).filter(Boolean))]),
      providerState: providerServiceContract.state,
      negotiatedCapabilities: providerServiceContract.negotiation?.acceptedCapabilities ?? 0,
      providerPersistenceState: providerPersistencePlan.state,
      replayWorkflowState: replayWorkflow.state || "not-required",
      replayCommands: replayWorkflow.commands?.length ?? 0,
      blockedReplayCommands: replayWorkflow.blockedCommands?.length ?? 0,
      syncCheckpointKeys: freezeArray([...new Set((providerPersistencePlan.checkpointSlots || []).map((slot) => slot.checkpointKey).filter(Boolean))]),
      syncWatermarkKeys: freezeArray([...new Set((providerPersistencePlan.checkpointSlots || []).map((slot) => slot.watermarkKey).filter(Boolean))]),
    }),
  });
}

export function createOperationalHealth(job = {}, stepEffects = [], capabilityJob = {}) {
  const blocked = stepEffects.filter((effect) => effect.actionableErrors.length > 0);
  const degraded = stepEffects.filter((effect) => effect.health.degradedMode !== "none");
  const retryable = stepEffects.filter((effect) => effect.retryPolicy.maxAttempts > 0 && effect.retryPolicy.retryableStatuses.length > 0);
  return Object.freeze({
    protocol: "aios.effects.operational-health.v1",
    jobName: compactString(job.name || capabilityJob.jobName || "anonymous"),
    state: blocked.length > 0 ? "blocked" : degraded.length > 0 ? "degraded" : "healthy",
    acceptedForAdapter: blocked.length === 0 && degraded.length === 0,
    acceptedForPreview: true,
    auditAccepted: capabilityJob.auditHandoff?.acceptedForAdapter !== false,
    retryableSteps: freezeArray(retryable.map((effect) => ({
      step: effect.step,
      strategy: effect.retryPolicy.strategy,
      maxAttempts: effect.retryPolicy.maxAttempts,
      baseDelayMs: effect.retryPolicy.baseDelayMs,
      retryableStatuses: effect.retryPolicy.retryableStatuses,
    }))),
    actionableErrors: freezeArray(blocked.flatMap((effect) => effect.actionableErrors)),
    degradedModes: freezeArray(degraded.map((effect) => ({
      step: effect.step,
      mode: effect.health.degradedMode,
      nextCommand: effect.recovery.command,
    }))),
  });
}

export function analyzeAiosEffects(input = {}) {
  const jobs = getJobs(input);
  const capabilityAnalysis = input.capabilityAnalysis || analyzeAiosCapabilities(input);
  const jobPlans = jobs.map((job, index) => createJobEffectPlan(job, capabilityAnalysis.jobs?.[index], capabilityAnalysis.typeHints?.jobs?.[index]));
  const diagnostics = [
    ...(capabilityAnalysis.diagnostics || []),
    ...jobPlans.flatMap((job) => job.diagnostics),
  ];
  const lifecycleControlPlane = createLifecycleControlPlane(jobPlans, capabilityAnalysis, diagnostics);
  const acceptanceReport = createEffectAcceptanceReport(jobPlans, diagnostics);
  const exportManifest = createEffectExportManifest(jobPlans, diagnostics, acceptanceReport, lifecycleControlPlane);

  return Object.freeze({
    protocol: "aios.semantic.effect-analysis.v1",
    status: diagnostics.some((diagnostic) => diagnostic.level === "error")
      ? "blocked"
      : jobPlans.some((job) => job.status === "degraded-boundary-hold")
        ? "degraded"
      : jobPlans.some((job) => job.status === "needs-operator-action")
        ? "needs-operator-action"
        : "ready-for-runtime",
    capabilityAnalysis,
    jobs: freezeArray(jobPlans),
    diagnostics: freezeArray(diagnostics),
    analyticsExport: createEffectAnalyticsExport(jobPlans, diagnostics),
    exportManifest,
    lifecycleControlPlane,
    acceptanceReport,
    summary: summarizeAiosEffects(jobPlans, diagnostics),
  });
}

export function summarizeAiosEffects(jobPlans = [], diagnostics = []) {
  const effects = toArray(jobPlans).flatMap((job) => job.effects || []);
  return Object.freeze({
    jobs: jobPlans.length,
    steps: effects.length,
    externalWrites: effects.filter((effect) => effect.effectClass === "external-write").length,
    memoryWrites: effects.filter((effect) => effect.effectClass === "memory-write").length,
    approvalSteps: effects.filter((effect) => effect.status === "awaiting-operator-approval").length,
    degradedSteps: effects.filter((effect) => effect.health?.degradedMode !== "none").length,
    blockedSteps: effects.filter((effect) => effect.actionableErrors?.length > 0).length,
    retryableSteps: effects.filter((effect) => effect.retryPolicy?.retryableStatuses?.length > 0).length,
    rollbackRequired: effects.filter((effect) => effect.recovery.rollbackRequired).length,
    statusSnapshotKeys: [...new Set(effects.flatMap((effect) => effect.health?.statusSnapshotKeys || []).filter(Boolean))].length,
    providerContracts: toArray(jobPlans).filter((job) => job.providerServiceContract?.provider === "mailchimp").length,
    negotiatedProviderContracts: toArray(jobPlans).filter((job) => job.providerServiceContract?.state === "negotiated").length,
    restartSafeProviderPersistence: toArray(jobPlans).filter((job) => job.providerPersistencePlan?.state === "restart-safe").length,
    blockedProviderPersistence: toArray(jobPlans).filter((job) => job.providerPersistencePlan?.state === "blocked").length,
    providerSyncCheckpoints: toArray(jobPlans).reduce((count, job) => count + (job.providerPersistencePlan?.checkpointSlots?.length ?? 0), 0),
    replayWorkflowRunnableJobs: toArray(jobPlans).filter((job) => job.replayWorkflow?.state === "runnable").length,
    replayWorkflowBlockedJobs: toArray(jobPlans).filter((job) => job.replayWorkflow?.state === "blocked").length,
    replayWorkflowCommands: toArray(jobPlans).reduce((count, job) => count + (job.replayWorkflow?.commands?.length ?? 0), 0),
    blockedReplayCommands: toArray(jobPlans).reduce((count, job) => count + (job.replayWorkflow?.blockedCommands?.length ?? 0), 0),
    adapterStatusFailedSteps: effects.filter((effect) => effect.status === "adapter-status-failed").length,
    adapterStatusMissingSteps: effects.filter((effect) => effect.status === "adapter-status-missing").length,
    adapterStatusPendingSteps: effects.filter((effect) => effect.status === "adapter-status-pending").length,
    previewReadyJobs: toArray(jobPlans).filter((job) => job.preview?.acceptedForPreview).length,
    runtimeAcceptedJobs: toArray(jobPlans).filter((job) => job.preview?.acceptedForRuntime).length,
    adapterAcceptedJobs: toArray(jobPlans).filter((job) => job.preview?.acceptedForAdapter).length,
    exportReportRows: toArray(jobPlans).length,
    exportBlockedRows: toArray(jobPlans).map((job) => createJobExportReportRow(job)).filter((row) => row.blockedBy.length > 0).length,
    exportReady: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    diagnostics: diagnostics.length,
    runtimeStatus: diagnostics.some((diagnostic) => diagnostic.level === "error")
      ? "blocked"
      : effects.some((effect) => effect.health?.degradedMode !== "none")
        ? "degraded"
        : "handoff-ready",
  });
}
