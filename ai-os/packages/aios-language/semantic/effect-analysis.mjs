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
  const leaseRefreshContracts = contracts.filter((contract) => {
    return contract.lifecycle?.controls?.requirePermissionLeaseRefresh === true
      && contract.boundaryDecision?.leaseRecovery?.state === "blocked";
  });
  const onlyLeaseBoundary = boundaryHeld
    && leaseRefreshContracts.length > 0
    && contracts
      .filter((contract) => contract.boundaryDecision?.decision === "hold")
      .every((contract) => toArray(contract.boundaryDecision?.reasons).every((reason) => compactString(reason).includes("permission-lease")));
  const leaseRetryAfterMs = leaseRefreshContracts.reduce((delay, contract) => {
    const nextDelay = Number(contract.boundaryDecision?.leaseRecovery?.retryAfterMs);
    return Number.isFinite(nextDelay) && nextDelay > 0 ? Math.max(delay, nextDelay) : delay;
  }, 0);
  const maxAttempts = boundaryHeld && !onlyLeaseBoundary ? 0 : positiveInteger(retry.maxAttempts ?? step.maxAttempts, onlyLeaseBoundary ? 2 : externalWrite ? 3 : 1);
  const baseDelayMs = positiveInteger(retry.baseDelayMs ?? step.retryDelayMs, leaseRetryAfterMs || (highRisk ? 5000 : 1000));

  return Object.freeze({
    strategy: boundaryHeld && !onlyLeaseBoundary
      ? "manual-boundary-resolution"
      : onlyLeaseBoundary
        ? "permission-lease-refresh"
        : externalWrite
          ? "exponential-backoff"
          : "none",
    maxAttempts,
    baseDelayMs: boundaryHeld && !onlyLeaseBoundary ? 0 : baseDelayMs,
    maxDelayMs: boundaryHeld && !onlyLeaseBoundary ? 0 : positiveInteger(retry.maxDelayMs, Math.max(baseDelayMs, onlyLeaseBoundary ? 60000 : externalWrite ? 30000 : baseDelayMs)),
    jitter: boundaryHeld && !onlyLeaseBoundary ? false : retry.jitter !== false && (externalWrite || onlyLeaseBoundary),
    idempotencyRequired: externalWrite,
    retryableStatuses: freezeArray(boundaryHeld && !onlyLeaseBoundary ? [] : onlyLeaseBoundary ? ["permission-lease-refresh"] : externalWrite ? ["429", "500", "502", "503", "504", "adapter-timeout"] : []),
    leaseRefresh: freezeArray(leaseRefreshContracts.map((contract) => ({
      action: contract.action,
      command: contract.boundaryDecision?.leaseRecovery?.nextCommand || "refresh_mailchimp_permission_lease",
      retryAfterMs: contract.boundaryDecision?.leaseRecovery?.retryAfterMs ?? 0,
      statusChannel: contract.boundaryDecision?.leaseRecovery?.handoff?.statusChannel || contract.audit?.statusChannel || "",
      leaseToken: contract.boundaryDecision?.permissionLease?.token || "",
    }))),
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
  const adapterStatusSnapshotBlocked = contracts.some((contract) => contract.statusReconciliation?.state === "snapshot-blocked");
  const adapterStatusPending = contracts.some((contract) => contract.statusReconciliation?.state === "pending");
  const clientCommandReceiptBlocked = contracts.some((contract) => contract.workflowGate?.state === "client-command-receipt-blocked");
  const workflowBlocked = contracts.some((contract) => {
    return contract.workflowGate?.acceptedForAdapter === false
      && contract.workflowGate?.state !== "client-command-receipt-blocked";
  });
  const providerBudgetBlocked = contracts.some((contract) => contract.lifecycle?.providerBudget?.state === "blocked");
  const providerBudgetThrottled = contracts.some((contract) => ["degraded", "throttled"].includes(contract.lifecycle?.providerBudget?.state));
  const providerCallbackBlocked = contracts.some((contract) => contract.lifecycle?.providerCallback?.state === "blocked");
  const providerCallbackPending = contracts.some((contract) => contract.lifecycle?.providerCallback?.state === "pending-verification");
  const providerEventSubscriptionBlocked = contracts.some((contract) => ["blocked", "missing-subscription"].includes(contract.lifecycle?.providerEventSubscription?.state));
  const providerEventSubscriptionPending = contracts.some((contract) => contract.lifecycle?.providerEventSubscription?.state === "pending");
  const providerMaintenanceBlocked = contracts.some((contract) => contract.lifecycle?.providerMaintenance?.state === "blocked");
  const providerMaintenanceDegraded = contracts.some((contract) => contract.lifecycle?.providerMaintenance?.state === "degraded");
  const lifecycleReceiptBlocked = contracts.some((contract) => contract.lifecycle?.controls?.requireLifecycleCommandReceipt === true);
  const workspaceBoundaryBlocked = contracts.some((contract) => contract.health?.degradedMode === "workspace-boundary-quarantine"
    || toArray(contract.boundaryDecision?.reasons).some((reason) => compactString(reason).includes("workspace-boundary")));
  const adapterHandoffReceiptBlocked = contracts.some((contract) => contract.health?.degradedMode === "adapter-handoff-receipt"
    || contract.handoff?.adapterHandoffReceipt?.state === "blocked");
  const operationIdentityBlocked = contracts.some((contract) => contract.operationIdentity?.state === "blocked" || toArray(contract.operationIdentity?.missing).length > 0 || contract.health?.degradedMode === "operation-identity");
  const resumptionJournalBlocked = contracts.some((contract) => contract.handoff?.resumptionJournalRow?.state === "blocked");
  const resumptionJournalReplayable = contracts.some((contract) => contract.handoff?.resumptionJournalRow?.safeToReplay === true || contract.handoff?.resumptionJournalRow?.state === "replayable");
  const recoveryCheckpointBlocked = contracts.some((contract) => contract.recoveryCheckpoint?.state === "blocked" || toArray(contract.recoveryCheckpoint?.missing).length > 0 || contract.health?.degradedMode === "recovery-checkpoint");
  const recoveryCheckpointWaiting = contracts.some((contract) => contract.recoveryCheckpoint?.state === "waiting-adapter");
  const recoveryCheckpointReplayable = contracts.some((contract) => contract.recoveryCheckpoint?.safeToReplay === true || contract.recoveryCheckpoint?.state === "replayable");
  const degradedByCapability = contracts.some((contract) => contract.health?.degradedMode && contract.health.degradedMode !== "none");
  const leaseRefreshBlocked = contracts.filter((contract) => contract.lifecycle?.controls?.requirePermissionLeaseRefresh === true);
  const status = boundaryHeld
    ? "held-for-boundary-review"
    : clientCommandReceiptBlocked
      ? "client-command-receipt-blocked"
    : workflowBlocked
      ? "client-workflow-blocked"
    : providerBudgetBlocked
      ? "provider-budget-blocked"
    : providerCallbackBlocked
      ? "provider-callback-blocked"
    : providerEventSubscriptionBlocked
      ? "provider-event-subscription-blocked"
    : providerMaintenanceBlocked
      ? "provider-maintenance-blocked"
    : lifecycleReceiptBlocked
      ? "lifecycle-command-receipt-blocked"
    : workspaceBoundaryBlocked
      ? "workspace-boundary-quarantined"
    : adapterHandoffReceiptBlocked
      ? "adapter-handoff-receipt-blocked"
    : operationIdentityBlocked
      ? "operation-identity-blocked"
    : resumptionJournalBlocked
      ? "resumption-journal-blocked"
    : recoveryCheckpointBlocked
      ? "recovery-checkpoint-blocked"
    : adapterStatusFailed
      ? "adapter-status-failed"
      : adapterStatusMissing
        ? "adapter-status-missing"
      : adapterStatusSnapshotBlocked
        ? "adapter-status-snapshot-blocked"
        : adapterStatusPending
          ? "adapter-status-pending"
        : providerCallbackPending
          ? "provider-callback-pending"
        : providerEventSubscriptionPending
          ? "provider-event-subscription-pending"
        : providerMaintenanceDegraded
          ? "provider-maintenance-degraded"
        : recoveryCheckpointWaiting
          ? "recovery-checkpoint-waiting"
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
    adapterStatusSnapshotBlocked && createActionableError(
      name,
      "aios.effects.adapter_status_snapshot_blocked",
      `Step "${name}" needs materialized adapter status snapshot rows before replay-safe handoff.`,
      contracts.find((contract) => contract.statusReconciliation?.state === "snapshot-blocked")?.statusReconciliation?.nextCommand || "materialize_adapter_status_snapshot",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.statusReconciliation?.state === "snapshot-blocked")
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
    clientCommandReceiptBlocked && createActionableError(
      name,
      "aios.effects.client_command_receipt_blocked",
      `Step "${name}" is waiting on accepted client command receipts before Mailchimp adapter handoff.`,
      contracts.find((contract) => contract.workflowGate?.state === "client-command-receipt-blocked")?.workflowGate?.nextCommand || "attach_client_command_receipt",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.workflowGate?.state === "client-command-receipt-blocked")
          .map((contract) => contract.action)),
        commands: freezeArray(contracts
          .filter((contract) => contract.workflowGate?.clientCommandReceipt)
          .map((contract) => contract.workflowGate.clientCommandReceipt.command)
          .filter(Boolean)),
      }
    ),
    providerBudgetBlocked && createActionableError(
      name,
      "aios.effects.provider_budget_blocked",
      `Step "${name}" is waiting for Mailchimp provider budget recovery before adapter handoff.`,
      contracts.find((contract) => contract.lifecycle?.providerBudget?.state === "blocked")?.lifecycle?.providerBudget?.nextCommand || "wait_for_provider_budget_reset",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.lifecycle?.providerBudget?.state === "blocked")
          .map((contract) => contract.action)),
        retryAfterMs: contracts.find((contract) => contract.lifecycle?.providerBudget?.state === "blocked")?.lifecycle?.providerBudget?.retryAfterMs ?? 0,
      }
    ),
    providerCallbackBlocked && createActionableError(
      name,
      "aios.effects.provider_callback_blocked",
      `Step "${name}" is waiting for Mailchimp provider callback endpoint state before adapter handoff.`,
      contracts.find((contract) => contract.lifecycle?.providerCallback?.state === "blocked")?.lifecycle?.providerCallback?.nextCommand || "attach_provider_callback_endpoint",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.lifecycle?.providerCallback?.state === "blocked")
          .map((contract) => contract.action)),
      }
    ),
    providerMaintenanceBlocked && createActionableError(
      name,
      "aios.effects.provider_maintenance_blocked",
      `Step "${name}" is waiting for Mailchimp provider maintenance to clear before adapter handoff.`,
      contracts.find((contract) => contract.lifecycle?.providerMaintenance?.state === "blocked")?.lifecycle?.providerMaintenance?.nextCommand || "wait_for_provider_maintenance_window",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.lifecycle?.providerMaintenance?.state === "blocked")
          .map((contract) => contract.action)),
        retryAfterMs: contracts.find((contract) => contract.lifecycle?.providerMaintenance?.state === "blocked")?.lifecycle?.providerMaintenance?.retryAfterMs ?? 0,
      }
    ),
    lifecycleReceiptBlocked && createActionableError(
      name,
      "aios.effects.lifecycle_command_receipt_blocked",
      `Step "${name}" is waiting for accepted Mailchimp lifecycle command receipts before adapter handoff.`,
      contracts.find((contract) => contract.lifecycle?.controls?.requireLifecycleCommandReceipt === true)?.lifecycle?.lifecycleGate?.overrideReceipt?.nextCommand || "attach_mailchimp_lifecycle_command_receipt",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.lifecycle?.controls?.requireLifecycleCommandReceipt === true)
          .map((contract) => contract.action)),
        commands: freezeArray([...new Set(contracts
          .filter((contract) => contract.lifecycle?.controls?.requireLifecycleCommandReceipt === true)
          .map((contract) => contract.lifecycle?.lifecycleGate?.overrideReceipt?.command)
          .filter(Boolean))]),
      }
    ),
    providerCallbackPending && createActionableError(
      name,
      "aios.effects.provider_callback_pending",
      `Step "${name}" is waiting for Mailchimp callback endpoint verification.`,
      contracts.find((contract) => contract.lifecycle?.providerCallback?.state === "pending-verification")?.lifecycle?.providerCallback?.nextCommand || "verify_provider_callback_endpoint",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.lifecycle?.providerCallback?.state === "pending-verification")
          .map((contract) => contract.action)),
        retryAfterMs: contracts.find((contract) => contract.lifecycle?.providerCallback?.state === "pending-verification")?.lifecycle?.providerCallback?.retryAfterMs ?? 0,
      }
    ),
    providerEventSubscriptionBlocked && createActionableError(
      name,
      "aios.effects.provider_event_subscription_blocked",
      `Step "${name}" is waiting for Mailchimp event subscriptions before adapter handoff.`,
      contracts.find((contract) => ["blocked", "missing-subscription"].includes(contract.lifecycle?.providerEventSubscription?.state))?.lifecycle?.providerEventSubscription?.nextCommand || "subscribe_provider_events",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => ["blocked", "missing-subscription"].includes(contract.lifecycle?.providerEventSubscription?.state))
          .map((contract) => contract.action)),
      }
    ),
    providerEventSubscriptionPending && createActionableError(
      name,
      "aios.effects.provider_event_subscription_pending",
      `Step "${name}" is waiting for Mailchimp event subscription confirmation.`,
      contracts.find((contract) => contract.lifecycle?.providerEventSubscription?.state === "pending")?.lifecycle?.providerEventSubscription?.nextCommand || "poll_provider_event_subscription",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.lifecycle?.providerEventSubscription?.state === "pending")
          .map((contract) => contract.action)),
        retryAfterMs: contracts.find((contract) => contract.lifecycle?.providerEventSubscription?.state === "pending")?.lifecycle?.providerEventSubscription?.retryAfterMs ?? 0,
      }
    ),
    workspaceBoundaryBlocked && createActionableError(
      name,
      "aios.effects.workspace_boundary_quarantined",
      `Step "${name}" references a Mailchimp capability quarantined by tenant/workspace boundary approval requirements.`,
      contracts.find((contract) => contract.health?.degradedMode === "workspace-boundary-quarantine")?.health?.actionableError?.nextCommand
        || "collect_workspace_boundary_approval",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.health?.degradedMode === "workspace-boundary-quarantine"
            || toArray(contract.boundaryDecision?.reasons).some((reason) => compactString(reason).includes("workspace-boundary")))
          .map((contract) => contract.action)),
      }
    ),
    adapterHandoffReceiptBlocked && createActionableError(
      name,
      "aios.effects.adapter_handoff_receipt_blocked",
      `Step "${name}" is missing an accepted adapter handoff receipt for Mailchimp status recovery.`,
      contracts.find((contract) => contract.health?.degradedMode === "adapter-handoff-receipt" || contract.handoff?.adapterHandoffReceipt?.state === "blocked")?.handoff?.adapterHandoffReceipt?.nextCommand
        || "attach_adapter_handoff_receipt",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.health?.degradedMode === "adapter-handoff-receipt"
            || contract.handoff?.adapterHandoffReceipt?.state === "blocked")
          .map((contract) => contract.action)),
        commandIds: freezeArray(contracts
          .map((contract) => contract.handoff?.adapterHandoffReceipt?.commandId)
          .filter(Boolean)),
      }
    ),
    operationIdentityBlocked && createActionableError(
      name,
      "aios.effects.operation_identity_blocked",
      `Step "${name}" is missing restart-safe operation identity state before Mailchimp adapter handoff.`,
      contracts.find((contract) => contract.operationIdentity?.state === "blocked" || contract.health?.degradedMode === "operation-identity")?.operationIdentity?.nextCommand || "attach_recovery_status_handoff",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.operationIdentity?.state === "blocked" || contract.health?.degradedMode === "operation-identity")
          .map((contract) => contract.action)),
      }
    ),
    resumptionJournalBlocked && createActionableError(
      name,
      "aios.effects.resumption_journal_blocked",
      `Step "${name}" is missing restart-safe resumption journal state before Mailchimp adapter replay.`,
      contracts.find((contract) => contract.handoff?.resumptionJournalRow?.state === "blocked")?.handoff?.resumptionJournalRow?.nextCommand || "attach_recovery_status_handoff",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.handoff?.resumptionJournalRow?.state === "blocked")
          .map((contract) => contract.action)),
        rows: freezeArray(contracts
          .map((contract) => contract.handoff?.resumptionJournalRow?.rowId)
          .filter(Boolean)),
      }
    ),
    recoveryCheckpointBlocked && createActionableError(
      name,
      "aios.effects.recovery_checkpoint_blocked",
      `Step "${name}" has a Mailchimp recovery checkpoint that is not restart-safe.`,
      contracts.find((contract) => contract.recoveryCheckpoint?.state === "blocked" || toArray(contract.recoveryCheckpoint?.missing).length > 0)?.recoveryCheckpoint?.nextCommand || "attach_recovery_status_handoff",
      {
        capabilities: freezeArray(contracts
          .filter((contract) => contract.recoveryCheckpoint?.state === "blocked" || toArray(contract.recoveryCheckpoint?.missing).length > 0)
          .map((contract) => contract.action)),
        checkpointRows: freezeArray(contracts
          .filter((contract) => contract.recoveryCheckpoint?.state === "blocked" || toArray(contract.recoveryCheckpoint?.missing).length > 0)
          .map((contract) => contract.recoveryCheckpoint?.rowId)
          .filter(Boolean)),
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
        : clientCommandReceiptBlocked
          ? "blocked"
        : workflowBlocked
          ? "blocked"
        : providerBudgetBlocked
          ? "blocked"
        : providerCallbackBlocked
          ? "blocked"
        : providerBudgetThrottled
          ? "degraded"
        : providerCallbackPending
          ? "degraded"
        : workspaceBoundaryBlocked
          ? "blocked"
        : resumptionJournalBlocked
          ? "blocked"
        : recoveryCheckpointBlocked
          ? "blocked"
          : degradedByCapability
            ? "degraded"
          : externalWrite
            ? "adapter-ready"
            : "healthy",
      degradedMode: boundaryHeld
        ? "preview-only"
        : clientCommandReceiptBlocked
          ? "client-command-receipt"
        : workspaceBoundaryBlocked
          ? "workspace-boundary-quarantine"
        : adapterHandoffReceiptBlocked
          ? "adapter-handoff-receipt"
        : resumptionJournalBlocked
          ? "resumption-journal"
        : recoveryCheckpointBlocked
          ? "recovery-checkpoint"
        : recoveryCheckpointWaiting
          ? "recovery-checkpoint-waiting"
        : providerBudgetBlocked || providerBudgetThrottled
          ? "provider-budget"
        : providerCallbackBlocked || providerCallbackPending
          ? "provider-callback"
        : providerMaintenanceBlocked || providerMaintenanceDegraded
          ? "provider-maintenance"
        : lifecycleReceiptBlocked
          ? "lifecycle-command-receipt"
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
          clientCommandReceipt: contract.workflowGate.clientCommandReceipt || null,
        }))),
      providerBudgets: freezeArray(contracts
        .filter((contract) => contract.lifecycle?.providerBudget && contract.lifecycle.providerBudget.state !== "not-required")
        .map((contract) => ({
          action: contract.action,
          state: contract.lifecycle.providerBudget.state,
          budgetId: contract.lifecycle.providerBudget.budgetId,
          remaining: contract.lifecycle.providerBudget.remaining,
          retryAfterMs: contract.lifecycle.providerBudget.retryAfterMs,
          nextCommand: contract.lifecycle.providerBudget.nextCommand,
        }))),
      providerCallbacks: freezeArray(contracts
        .filter((contract) => contract.lifecycle?.providerCallback && contract.lifecycle.providerCallback.state !== "not-required")
        .map((contract) => ({
          action: contract.action,
          state: contract.lifecycle.providerCallback.state,
          callbackId: contract.lifecycle.providerCallback.callbackId,
          verificationState: contract.lifecycle.providerCallback.verificationState,
          retryAfterMs: contract.lifecycle.providerCallback.retryAfterMs,
          nextCommand: contract.lifecycle.providerCallback.nextCommand,
          missing: contract.lifecycle.providerCallback.missing,
        }))),
      providerEventSubscriptions: freezeArray(contracts
        .filter((contract) => contract.lifecycle?.providerEventSubscription && contract.lifecycle.providerEventSubscription.state !== "not-required")
        .map((contract) => ({
          action: contract.action,
          state: contract.lifecycle.providerEventSubscription.state,
          subscriptionId: contract.lifecycle.providerEventSubscription.subscriptionId,
          callbackId: contract.lifecycle.providerEventSubscription.callbackId,
          missingEvents: contract.lifecycle.providerEventSubscription.missingEvents,
          retryAfterMs: contract.lifecycle.providerEventSubscription.retryAfterMs,
          nextCommand: contract.lifecycle.providerEventSubscription.nextCommand,
        }))),
      providerMaintenance: freezeArray(contracts
        .filter((contract) => contract.lifecycle?.providerMaintenance && contract.lifecycle.providerMaintenance.state !== "not-required")
        .map((contract) => ({
          action: contract.action,
          state: contract.lifecycle.providerMaintenance.state,
          windowId: contract.lifecycle.providerMaintenance.windowId,
          serviceWindow: contract.lifecycle.providerMaintenance.serviceWindow || null,
          retryAfterMs: contract.lifecycle.providerMaintenance.retryAfterMs,
          nextCommand: contract.lifecycle.providerMaintenance.nextCommand,
          blockedBy: contract.lifecycle.providerMaintenance.blockedBy,
        }))),
      lifecycleCommandReceipts: freezeArray(contracts
        .filter((contract) => contract.lifecycle?.lifecycleGate?.overrideReceipt?.required === true)
        .map((contract) => ({
          action: contract.action,
          command: contract.lifecycle.lifecycleGate.overrideReceipt.command,
          state: contract.lifecycle.lifecycleGate.overrideReceipt.state,
          receiptToken: contract.lifecycle.lifecycleGate.overrideReceipt.receiptToken,
          expired: contract.lifecycle.lifecycleGate.overrideReceipt.expired === true,
          nextCommand: contract.lifecycle.lifecycleGate.overrideReceipt.nextCommand,
        }))),
      workspaceBoundaries: freezeArray(contracts
        .filter((contract) => contract.boundaryDecision?.workspaceBoundary)
        .map((contract) => ({
          action: contract.action,
          state: contract.boundaryDecision.workspaceBoundary.state,
          transferToken: contract.boundaryDecision.workspaceBoundary.transferToken,
          nextCommand: contract.boundaryDecision.workspaceBoundary.nextCommand,
          blockedBy: contract.boundaryDecision.workspaceBoundary.blockedBy,
        }))),
      adapterHandoffReceipts: freezeArray(contracts
        .filter((contract) => contract.handoff?.adapterHandoffReceipt)
        .map((contract) => ({
          action: contract.action,
          state: contract.handoff.adapterHandoffReceipt.state,
          commandId: contract.handoff.adapterHandoffReceipt.commandId,
          receiptToken: contract.handoff.adapterHandoffReceipt.receiptToken,
          providerRequestId: contract.handoff.adapterHandoffReceipt.providerRequestId,
          nextCommand: contract.handoff.adapterHandoffReceipt.nextCommand,
          missing: contract.handoff.adapterHandoffReceipt.missing || freezeArray([]),
        }))),
      operationIdentities: freezeArray(contracts
        .filter((contract) => contract.operationIdentity)
        .map((contract) => ({
          action: contract.action,
          operationId: contract.operationIdentity.operationId,
          state: contract.operationIdentity.state,
          commandId: contract.operationIdentity.commandId,
          nextCommand: contract.operationIdentity.nextCommand,
          missing: contract.operationIdentity.missing || freezeArray([]),
        }))),
      resumptionJournal: freezeArray(contracts
        .filter((contract) => contract.handoff?.resumptionJournalRow)
        .map((contract) => ({
          action: contract.action,
          rowId: contract.handoff.resumptionJournalRow.rowId,
          state: contract.handoff.resumptionJournalRow.state,
          command: contract.handoff.resumptionJournalRow.command,
          replayKey: contract.handoff.resumptionJournalRow.replayKey,
          safeToReplay: contract.handoff.resumptionJournalRow.safeToReplay === true,
          nextCommand: contract.handoff.resumptionJournalRow.nextCommand,
          missing: contract.handoff.resumptionJournalRow.missing || freezeArray([]),
        }))),
      recoveryCheckpoints: freezeArray(contracts
        .filter((contract) => contract.recoveryCheckpoint)
        .map((contract) => ({
          action: contract.action,
          rowId: contract.recoveryCheckpoint.rowId,
          state: contract.recoveryCheckpoint.state,
          commandId: contract.recoveryCheckpoint.commandId,
          replayKey: contract.recoveryCheckpoint.replayKey,
          safeToReplay: contract.recoveryCheckpoint.safeToReplay === true,
          nextCommand: contract.recoveryCheckpoint.nextCommand,
          missing: contract.recoveryCheckpoint.missing || freezeArray([]),
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
      permissionLeaseRefresh: freezeArray(leaseRefreshBlocked.map((contract) => ({
        action: contract.action,
        state: contract.boundaryDecision?.leaseRecovery?.state || contract.boundaryDecision?.leaseState || "blocked",
        command: contract.boundaryDecision?.leaseRecovery?.nextCommand || contract.lifecycle?.leaseRefresh?.command || "refresh_mailchimp_permission_lease",
        retryAfterMs: contract.boundaryDecision?.leaseRecovery?.retryAfterMs ?? contract.lifecycle?.leaseRefresh?.retryAfterMs ?? 0,
        statusChannel: contract.boundaryDecision?.leaseRecovery?.handoff?.statusChannel || contract.audit?.statusChannel || "",
        leaseToken: contract.boundaryDecision?.permissionLease?.token || "",
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
        : clientCommandReceiptBlocked
          ? contracts.find((contract) => contract.workflowGate?.state === "client-command-receipt-blocked")?.workflowGate?.nextCommand || "attach_client_command_receipt"
        : providerBudgetBlocked
          ? contracts.find((contract) => contract.lifecycle?.providerBudget?.state === "blocked")?.lifecycle?.providerBudget?.nextCommand || "wait_for_provider_budget_reset"
        : providerCallbackBlocked || providerCallbackPending
          ? contracts.find((contract) => ["blocked", "pending-verification"].includes(contract.lifecycle?.providerCallback?.state))?.lifecycle?.providerCallback?.nextCommand || "verify_provider_callback_endpoint"
        : providerMaintenanceBlocked
          ? contracts.find((contract) => contract.lifecycle?.providerMaintenance?.state === "blocked")?.lifecycle?.providerMaintenance?.nextCommand || "wait_for_provider_maintenance_window"
        : lifecycleReceiptBlocked
          ? contracts.find((contract) => contract.lifecycle?.controls?.requireLifecycleCommandReceipt === true)?.lifecycle?.lifecycleGate?.overrideReceipt?.nextCommand || "attach_mailchimp_lifecycle_command_receipt"
        : workspaceBoundaryBlocked
          ? contracts.find((contract) => contract.health?.degradedMode === "workspace-boundary-quarantine")?.health?.actionableError?.nextCommand || "collect_workspace_boundary_approval"
        : adapterHandoffReceiptBlocked
          ? contracts.find((contract) => contract.handoff?.adapterHandoffReceipt?.state === "blocked")?.handoff?.adapterHandoffReceipt?.nextCommand || "attach_adapter_handoff_receipt"
        : operationIdentityBlocked
          ? contracts.find((contract) => contract.operationIdentity?.state === "blocked" || contract.health?.degradedMode === "operation-identity")?.operationIdentity?.nextCommand || "attach_recovery_status_handoff"
        : resumptionJournalBlocked
          ? contracts.find((contract) => contract.handoff?.resumptionJournalRow?.state === "blocked")?.handoff?.resumptionJournalRow?.nextCommand || "attach_recovery_status_handoff"
        : adapterStatusMissing
            ? "load_adapter_status_snapshot"
          : adapterStatusSnapshotBlocked
            ? contracts.find((contract) => contract.statusReconciliation?.state === "snapshot-blocked")?.statusReconciliation?.nextCommand || "materialize_adapter_status_snapshot"
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
      leaseRefreshCommand: retryPolicy.leaseRefresh?.[0]?.command || "",
      leaseRetryAfterMs: retryPolicy.leaseRefresh?.[0]?.retryAfterMs ?? 0,
      resumptionReplayReady: resumptionJournalReplayable && !resumptionJournalBlocked,
      checkpointReplayReady: recoveryCheckpointReplayable && !recoveryCheckpointBlocked,
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
    adapterStatusSnapshotBlocked: 0,
    adapterStatusPending: 0,
    clientWorkflowBlocked: 0,
    clientWorkflowReady: 0,
    clientCommandReceiptBlocked: 0,
    clientCommandReceipts: 0,
    providerBudgetBlocked: 0,
    providerBudgetThrottled: 0,
    providerCallbackBlocked: 0,
    providerCallbackPending: 0,
    providerCallbackReady: 0,
    providerEventSubscriptionBlocked: 0,
    providerEventSubscriptionPending: 0,
    providerEventSubscriptionReady: 0,
    providerMaintenanceBlocked: 0,
    providerMaintenanceDegraded: 0,
    lifecycleCommandReceiptBlocked: 0,
    providerServiceUnavailable: 0,
    providerServiceDegraded: 0,
    adapterHandoffReceiptRows: 0,
    adapterHandoffReceiptBlocked: 0,
    adapterHandoffReceiptAccepted: 0,
    operationIdentityTracked: 0,
    operationIdentityBlocked: 0,
    resumptionJournalRows: 0,
    resumptionJournalReplayable: 0,
    resumptionJournalBlocked: 0,
    recoveryCheckpointRows: 0,
    recoveryCheckpointReplayable: 0,
    recoveryCheckpointBlocked: 0,
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
    if (effect.status === "adapter-status-snapshot-blocked") counters.adapterStatusSnapshotBlocked += 1;
    if (effect.status === "adapter-status-pending") counters.adapterStatusPending += 1;
    if (effect.status === "client-workflow-blocked") counters.clientWorkflowBlocked += 1;
    if (effect.health?.clientWorkflow?.some?.((row) => row.state === "ready")) counters.clientWorkflowReady += 1;
    if (effect.status === "client-command-receipt-blocked") counters.clientCommandReceiptBlocked += 1;
    if (effect.health?.clientWorkflow?.some?.((row) => row.clientCommandReceipt)) counters.clientCommandReceipts += 1;
    if (effect.status === "provider-budget-blocked") counters.providerBudgetBlocked += 1;
    if (effect.health?.providerBudgets?.some?.((row) => ["degraded", "throttled"].includes(row.state))) counters.providerBudgetThrottled += 1;
    if (effect.status === "provider-callback-blocked") counters.providerCallbackBlocked += 1;
    if (effect.status === "provider-callback-pending" || effect.health?.providerCallbacks?.some?.((row) => row.state === "pending-verification")) counters.providerCallbackPending += 1;
    if (effect.health?.providerCallbacks?.some?.((row) => row.state === "verified")) counters.providerCallbackReady += 1;
    if (effect.status === "provider-event-subscription-blocked") counters.providerEventSubscriptionBlocked += 1;
    if (effect.status === "provider-event-subscription-pending" || effect.health?.providerEventSubscriptions?.some?.((row) => row.state === "pending")) counters.providerEventSubscriptionPending += 1;
    if (effect.health?.providerEventSubscriptions?.some?.((row) => row.state === "subscribed")) counters.providerEventSubscriptionReady += 1;
    if (effect.status === "provider-maintenance-blocked") counters.providerMaintenanceBlocked += 1;
    if (effect.status === "provider-maintenance-degraded" || effect.health?.providerMaintenance?.some?.((row) => row.state === "degraded")) counters.providerMaintenanceDegraded += 1;
    if (effect.status === "lifecycle-command-receipt-blocked" || effect.health?.lifecycleCommandReceipts?.some?.((row) => ["missing", "pending", "rejected", "revoked", "expired"].includes(row.state))) counters.lifecycleCommandReceiptBlocked += 1;
    if (effect.health?.providerMaintenance?.some?.((row) => toArray(row.blockedBy).some((reason) => compactString(reason).startsWith("provider-service-")))) counters.providerServiceUnavailable += 1;
    if (effect.health?.providerMaintenance?.some?.((row) => row.serviceWindow?.state === "degraded")) counters.providerServiceDegraded += 1;
    counters.adapterHandoffReceiptRows += effect.health?.adapterHandoffReceipts?.length ?? 0;
    if (effect.status === "adapter-handoff-receipt-blocked" || effect.health?.adapterHandoffReceipts?.some?.((row) => row.state === "blocked")) counters.adapterHandoffReceiptBlocked += 1;
    if (effect.health?.adapterHandoffReceipts?.some?.((row) => row.state === "accepted")) counters.adapterHandoffReceiptAccepted += 1;
    if (effect.health?.operationIdentities?.length > 0) counters.operationIdentityTracked += 1;
    if (effect.status === "operation-identity-blocked" || effect.health?.operationIdentities?.some?.((row) => row.state === "blocked" || row.missing?.length > 0)) counters.operationIdentityBlocked += 1;
    counters.resumptionJournalRows += effect.health?.resumptionJournal?.length ?? 0;
    if (effect.health?.resumptionJournal?.some?.((row) => row.safeToReplay || row.state === "replayable")) counters.resumptionJournalReplayable += 1;
    if (effect.status === "resumption-journal-blocked" || effect.health?.resumptionJournal?.some?.((row) => row.state === "blocked")) counters.resumptionJournalBlocked += 1;
    counters.recoveryCheckpointRows += effect.health?.recoveryCheckpoints?.length ?? 0;
    if (effect.health?.recoveryCheckpoints?.some?.((row) => row.safeToReplay || row.state === "replayable")) counters.recoveryCheckpointReplayable += 1;
    if (effect.status === "recovery-checkpoint-blocked" || effect.health?.recoveryCheckpoints?.some?.((row) => row.state === "blocked" || row.missing?.length > 0)) counters.recoveryCheckpointBlocked += 1;
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
        operationIds: freezeArray(toArray(effect.health.operationIdentities).map((row) => row.operationId).filter(Boolean)),
        resumptionRows: freezeArray(toArray(effect.health.resumptionJournal).map((row) => ({
          rowId: row.rowId,
          state: row.state,
          replayKey: row.replayKey,
          nextCommand: row.nextCommand,
        })).filter((row) => row.rowId || row.replayKey)),
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
  const adapterStatusSnapshotBlocked = mailchimpContracts.filter((contract) => contract.statusReconciliation?.state === "snapshot-blocked");
  const workflowBlocked = mailchimpContracts.filter((contract) => contract.workflowGate?.acceptedForAdapter === false);
  const workflowReady = mailchimpContracts.filter((contract) => contract.workflowGate?.state === "ready");
  const leaseBlocked = mailchimpContracts.filter((contract) => contract.lifecycle?.controls?.requirePermissionLeaseRefresh === true);
  const leaseReady = mailchimpContracts.filter((contract) => contract.boundaryDecision?.leaseState === "ready");
  const permissionPostureBlocked = mailchimpContracts.filter((contract) => contract.boundaryDecision?.permissionPosture?.state?.endsWith?.("blocked"));
  const permissionPostureGrantBlocked = permissionPostureBlocked.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "grant-blocked");
  const permissionPostureLeaseBlocked = permissionPostureBlocked.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "lease-blocked");
  const permissionPostureIdentityBlocked = permissionPostureBlocked.filter((contract) => contract.boundaryDecision?.permissionPosture?.state === "identity-blocked");
  const providerBudgetBlocked = mailchimpContracts.filter((contract) => contract.lifecycle?.providerBudget?.state === "blocked");
  const providerBudgetThrottled = mailchimpContracts.filter((contract) => ["degraded", "throttled"].includes(contract.lifecycle?.providerBudget?.state));
  const providerCallbackBlocked = mailchimpContracts.filter((contract) => contract.lifecycle?.providerCallback?.state === "blocked");
  const providerCallbackPending = mailchimpContracts.filter((contract) => contract.lifecycle?.providerCallback?.state === "pending-verification");
  const providerCallbackReady = mailchimpContracts.filter((contract) => contract.lifecycle?.providerCallback?.state === "verified");
  const providerEventSubscriptionBlocked = mailchimpContracts.filter((contract) => ["blocked", "missing-subscription"].includes(contract.lifecycle?.providerEventSubscription?.state));
  const providerEventSubscriptionPending = mailchimpContracts.filter((contract) => contract.lifecycle?.providerEventSubscription?.state === "pending");
  const providerEventSubscriptionReady = mailchimpContracts.filter((contract) => contract.lifecycle?.providerEventSubscription?.state === "subscribed");
  const providerMaintenanceBlocked = mailchimpContracts.filter((contract) => contract.lifecycle?.providerMaintenance?.state === "blocked");
  const providerMaintenanceDegraded = mailchimpContracts.filter((contract) => contract.lifecycle?.providerMaintenance?.state === "degraded");
  const providerServiceUnavailable = mailchimpContracts.filter((contract) => {
    return toArray(contract.lifecycle?.providerMaintenance?.blockedBy)
      .some((reason) => compactString(reason).startsWith("provider-service-"));
  });
  const providerServiceDegraded = mailchimpContracts.filter((contract) => {
    return contract.lifecycle?.providerMaintenance?.serviceWindow?.state === "degraded";
  });
  const providerExportBoundaryBlocked = mailchimpContracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.state === "blocked" || contract.lifecycle?.providerExportBoundary?.exportable === false);
  const providerExportBoundaryRetryable = mailchimpContracts.filter((contract) => contract.lifecycle?.providerExportBoundary?.retryable === true);
  const providerPublicationBlocked = mailchimpContracts.filter((contract) => {
    return contract.lifecycle?.providerPublication?.state === "blocked"
      || toArray(contract.lifecycle?.providerPublication?.blockedBy).length > 0;
  });
  const providerPublicationReady = mailchimpContracts.filter((contract) => contract.lifecycle?.providerPublication?.acceptedForExport === true);
  const providerPublicationReceiptBlocked = mailchimpContracts.filter((contract) => contract.lifecycle?.providerPublication?.receiptState === "blocked");
  const providerPublicationReceiptPending = mailchimpContracts.filter((contract) => {
    return ["pending", "pending-receipt", "needs-receipt"].includes(contract.lifecycle?.providerPublication?.receiptState);
  });
  const providerPublicationReceiptAccepted = mailchimpContracts.filter((contract) => contract.lifecycle?.providerPublication?.acceptedForProviderHandoff === true);
  const settingsBlocked = mailchimpContracts.filter((contract) => contract.lifecycle?.settingsAdoption?.state === "blocked");
  const settingsPatchRequired = mailchimpContracts.filter((contract) => contract.lifecycle?.settingsAdoption?.state === "patch-required");
  const settingsDisabled = mailchimpContracts.filter((contract) => contract.lifecycle?.settingsAdoption?.state === "disabled");
  const lifecycleGateBlocked = mailchimpContracts.filter((contract) => ["blocked", "disabled"].includes(contract.lifecycle?.lifecycleGate?.state));
  const lifecycleGateGated = mailchimpContracts.filter((contract) => contract.lifecycle?.lifecycleGate?.state === "gated");
  const lifecycleReceiptBlocked = mailchimpContracts.filter((contract) => contract.lifecycle?.controls?.requireLifecycleCommandReceipt === true);
  const marketingConsentBlocked = mailchimpContracts.filter((contract) => contract.lifecycle?.controls?.requireMarketingConsent === true);
  const marketingConsentExpired = mailchimpContracts.filter((contract) => contract.lifecycle?.lifecycleGate?.marketingConsent?.expired === true);
  const negotiatedCapabilities = mailchimpContracts.map((contract) => ({
    action: contract.action,
    serviceScopes: contract.serviceScopes,
    lifecycleMode: contract.lifecycle?.mode || "unknown",
    adapterHandoff: contract.lifecycle?.controls?.enableAdapterHandoff === true,
    operatorAcceptance: contract.acceptance || null,
    operationIdentity: contract.operationIdentity || null,
    providerSync: contract.providerSync || null,
    providerCallback: contract.lifecycle?.providerCallback || null,
    providerEventSubscription: contract.lifecycle?.providerEventSubscription || null,
    providerMaintenance: contract.lifecycle?.providerMaintenance || null,
    providerExportBoundary: contract.lifecycle?.providerExportBoundary || null,
    providerPublication: contract.lifecycle?.providerPublication || null,
    providerPublicationReceipts: contract.lifecycle?.providerPublication?.receiptRows || freezeArray([]),
    lifecycleGate: contract.lifecycle?.lifecycleGate || null,
    lifecycleOverrideReceipt: contract.lifecycle?.lifecycleGate?.overrideReceipt || null,
    marketingConsent: contract.lifecycle?.lifecycleGate?.marketingConsent || null,
    scheduling: contract.lifecycle?.scheduling || null,
    syncMetadata: Object.freeze({
      statusState: contract.handoff?.statusState || "",
      statusChannel: contract.audit?.statusChannel || "",
      statusSnapshotKey: contract.audit?.statusSnapshotKey || "",
      requestId: contract.audit?.requestId || "",
      syncState: contract.providerSync?.state || "not-applicable",
      syncScopeState: contract.providerSync?.metadata?.scopeSyncState || "not-provided",
      watermarkKey: contract.providerSync?.metadata?.watermarkKey || "",
      checkpointKey: contract.providerSync?.metadata?.checkpointKey || "",
      objectRef: contract.providerSync?.metadata?.objectRef || "",
      retryStrategy: contract.handoff?.retry?.strategy || "none",
      adapterStatusState: contract.statusReconciliation?.state || "unobserved",
      adapterStatusNextCommand: contract.statusReconciliation?.nextCommand || "observe",
      workflowState: contract.workflowGate?.state || "not-required",
      workflowNextCommand: contract.workflowGate?.nextCommand || "observe",
      previewDecisionState: contract.workflowGate?.previewDecision?.state || "not-provided",
      previewDecisionNextCommand: contract.workflowGate?.previewDecision?.nextCommand || "",
      previewAcceptanceToken: contract.workflowGate?.previewDecision?.acceptanceToken || "",
      permissionLeaseState: contract.boundaryDecision?.leaseState || "not-required",
      permissionLeaseToken: contract.boundaryDecision?.permissionLease?.token || "",
      permissionLeaseRetryAfterMs: contract.boundaryDecision?.leaseRecovery?.retryAfterMs ?? 0,
      permissionLeaseNextCommand: contract.boundaryDecision?.leaseRecovery?.nextCommand || "",
      permissionPostureState: contract.boundaryDecision?.permissionPosture?.state || "not-provided",
      permissionPostureNextCommand: contract.boundaryDecision?.permissionPosture?.nextCommand || "",
      permissionPostureFingerprint: contract.boundaryDecision?.permissionPosture?.fingerprint || "",
      providerBudgetState: contract.lifecycle?.providerBudget?.state || "not-required",
      providerBudgetId: contract.lifecycle?.providerBudget?.budgetId || "",
      providerBudgetRemaining: contract.lifecycle?.providerBudget?.remaining ?? null,
      providerBudgetRetryAfterMs: contract.lifecycle?.providerBudget?.retryAfterMs ?? 0,
      providerBudgetNextCommand: contract.lifecycle?.providerBudget?.nextCommand || "observe",
      providerCallbackState: contract.lifecycle?.providerCallback?.state || "not-required",
      providerCallbackId: contract.lifecycle?.providerCallback?.callbackId || "",
      providerCallbackVerificationState: contract.lifecycle?.providerCallback?.verificationState || "",
      providerCallbackRetryAfterMs: contract.lifecycle?.providerCallback?.retryAfterMs ?? 0,
      providerCallbackNextCommand: contract.lifecycle?.providerCallback?.nextCommand || "observe",
      providerEventSubscriptionState: contract.lifecycle?.providerEventSubscription?.state || "not-required",
      providerEventSubscriptionId: contract.lifecycle?.providerEventSubscription?.subscriptionId || "",
      providerEventSubscriptionNextCommand: contract.lifecycle?.providerEventSubscription?.nextCommand || "observe",
      providerMaintenanceState: contract.lifecycle?.providerMaintenance?.state || "not-required",
      providerMaintenanceWindowId: contract.lifecycle?.providerMaintenance?.windowId || "",
      providerServiceWindowId: contract.lifecycle?.providerMaintenance?.serviceWindow?.serviceWindowId || "",
      providerServiceState: contract.lifecycle?.providerMaintenance?.serviceWindow?.state || "available",
      providerServiceSeverity: contract.lifecycle?.providerMaintenance?.serviceWindow?.severity || "",
      providerServiceNextCommand: contract.lifecycle?.providerMaintenance?.serviceWindow?.nextCommand || contract.lifecycle?.providerMaintenance?.nextCommand || "observe",
      providerMaintenanceRetryAfterMs: contract.lifecycle?.providerMaintenance?.retryAfterMs ?? 0,
      providerMaintenanceNextCommand: contract.lifecycle?.providerMaintenance?.nextCommand || "observe",
      providerExportBoundaryState: contract.lifecycle?.providerExportBoundary?.state || "not-required",
      providerExportLaneKey: contract.lifecycle?.providerExportBoundary?.laneKey || "",
      providerExportBoundaryFingerprint: contract.lifecycle?.providerExportBoundary?.boundaryFingerprint || "",
      providerExportBoundaryRetryable: contract.lifecycle?.providerExportBoundary?.retryable === true,
      providerExportBoundaryNextCommand: contract.lifecycle?.providerExportBoundary?.nextCommand || "observe",
      providerPublicationState: contract.lifecycle?.providerPublication?.state || "not-required",
      providerPublicationId: contract.lifecycle?.providerPublication?.publicationId || "",
      providerPublicationManifestKey: contract.lifecycle?.providerPublication?.manifestKey || "",
      providerPublicationNextCommand: contract.lifecycle?.providerPublication?.nextCommand || "observe",
      providerPublicationReceiptState: contract.lifecycle?.providerPublication?.receiptState || "not-required",
      providerPublicationReceiptAccepted: contract.lifecycle?.providerPublication?.acceptedForProviderHandoff === true,
      providerPublicationReceiptNextCommand: contract.lifecycle?.providerPublication?.blockedReceiptRows?.[0]?.nextCommand
        || contract.lifecycle?.providerPublication?.receiptRows?.find?.((row) => row.state !== "accepted")?.nextCommand
        || "observe",
      lifecycleGateState: contract.lifecycle?.lifecycleGate?.state || "not-required",
      lifecycleGateMode: contract.lifecycle?.lifecycleGate?.mode || "enabled",
      lifecycleGateNextCommand: contract.lifecycle?.lifecycleGate?.nextCommand || "observe",
      lifecycleScheduleRequested: contract.lifecycle?.lifecycleGate?.scheduling?.requested === true,
      lifecycleSendLock: contract.lifecycle?.lifecycleGate?.sendLock?.locked === true,
      lifecycleOverrideReceiptState: contract.lifecycle?.lifecycleGate?.overrideReceipt?.state || "not-required",
      lifecycleOverrideReceiptCommand: contract.lifecycle?.lifecycleGate?.overrideReceipt?.command || "",
      lifecycleOverrideReceiptToken: contract.lifecycle?.lifecycleGate?.overrideReceipt?.receiptToken || "",
      lifecycleOverrideReceiptNextCommand: contract.lifecycle?.lifecycleGate?.overrideReceipt?.nextCommand || "observe",
      marketingConsentState: contract.lifecycle?.lifecycleGate?.marketingConsent?.state || "not-required",
      marketingConsentId: contract.lifecycle?.lifecycleGate?.marketingConsent?.consentId || "",
      marketingConsentNextCommand: contract.lifecycle?.lifecycleGate?.marketingConsent?.nextCommand || "observe",
      settingsAdoptionState: contract.lifecycle?.settingsAdoption?.state || "not-required",
      settingsChangedFields: contract.lifecycle?.settingsAdoption?.changedFields || freezeArray([]),
      settingsMissing: contract.lifecycle?.settingsAdoption?.missing || freezeArray([]),
      settingsNextCommand: contract.lifecycle?.settingsAdoption?.nextCommand || "observe",
      operationId: contract.operationIdentity?.operationId || "",
      operationState: contract.operationIdentity?.state || "not-provided",
      operationNextCommand: contract.operationIdentity?.nextCommand || "observe",
    }),
    nextAction: contract.lifecycle?.nextAction || contract.handoff?.recoveryCommand || "observe",
  }));
  const syncBlocked = mailchimpContracts.filter((contract) => contract.providerSync?.state === "blocked");
  const syncPending = mailchimpContracts.filter((contract) => contract.providerSync?.state === "needs-provider-confirmation");
  const segmentSyncReceiptBlocked = mailchimpContracts.filter((contract) => contract.segmentSyncReceipt?.state === "blocked");
  const segmentSyncReceiptPending = mailchimpContracts.filter((contract) => contract.segmentSyncReceipt?.state === "pending");
  const providerHandoffReadiness = capabilityJob.analyticsSnapshot?.providerHandoffReadiness
    || capabilityJob.analyticsExport?.providerHandoffReadiness
    || Object.freeze({
      protocol: "aios.effects.provider-handoff-readiness.v1",
      state: "not-provided",
      acceptedForAdapter: mailchimpContracts.length === 0,
      rows: freezeArray([]),
      blockedRows: freezeArray([]),
      waitingRows: freezeArray([]),
      readyRows: freezeArray([]),
      nextCommand: "observe",
    });
  const providerHandoffRows = toArray(providerHandoffReadiness.rows);
  const providerHandoffBlocked = toArray(providerHandoffReadiness.blockedRows);
  const providerHandoffWaiting = toArray(providerHandoffReadiness.waitingRows);
  const providerHandoffReady = toArray(providerHandoffReadiness.readyRows);
  const scopeLineage = capabilityJob.analyticsSnapshot?.scopeLineage || capabilityJob.scopeLineage || Object.freeze({
    protocol: "aios.effects.provider.scope-lineage.v1",
    state: "not-provided",
    acceptedForProviderExport: true,
    scopeExportRows: freezeArray([]),
    blockedRows: freezeArray([]),
    staleRows: freezeArray([]),
    historyRows: freezeArray([]),
    exportDestinations: freezeArray([]),
  });
  const scopeBlockedRows = toArray(scopeLineage.blockedRows);
  const scopeStaleRows = toArray(scopeLineage.staleRows);
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
    adapterStatusSnapshotBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_adapter_status_snapshot_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" needs Mailchimp adapter status rows materialized before replay-safe handoff.`,
      nextCommand: adapterStatusSnapshotBlocked[0]?.statusReconciliation?.nextCommand || "materialize_adapter_status_snapshot",
      capabilities: freezeArray(adapterStatusSnapshotBlocked.map((contract) => contract.action)),
    }),
    syncBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_sync_invalid",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities with invalid sync checkpoint metadata.`,
      nextCommand: "repair_provider_sync_metadata",
      capabilities: freezeArray(syncBlocked.map((contract) => contract.action)),
    }),
    segmentSyncReceiptBlocked.length > 0 && Object.freeze({
      code: "aios.effects.segment_sync_receipt_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp segment sync receipts blocking provider handoff.`,
      nextCommand: segmentSyncReceiptBlocked[0]?.segmentSyncReceipt?.nextCommand || "attach_segment_sync_receipt",
      capabilities: freezeArray(segmentSyncReceiptBlocked.map((contract) => contract.action)),
    }),
    workflowBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_workflow_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities waiting on client workflow handoff commands.`,
      nextCommand: workflowBlocked[0]?.workflowGate?.nextCommand || "resolve_runtime_readiness",
      capabilities: freezeArray(workflowBlocked.map((contract) => contract.action)),
    }),
    leaseBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_permission_lease_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities waiting on workspace permission lease refresh.`,
      nextCommand: "refresh_mailchimp_permission_lease",
      capabilities: freezeArray(leaseBlocked.map((contract) => contract.action)),
    }),
    permissionPostureBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_permission_posture_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities blocked by tenant permission posture.`,
      nextCommand: permissionPostureIdentityBlocked[0]?.boundaryDecision?.permissionPosture?.nextCommand
        || permissionPostureGrantBlocked[0]?.boundaryDecision?.permissionPosture?.nextCommand
        || permissionPostureLeaseBlocked[0]?.boundaryDecision?.permissionPosture?.nextCommand
        || permissionPostureBlocked[0]?.boundaryDecision?.permissionPosture?.nextCommand
        || "resolve_boundary_hold",
      capabilities: freezeArray(permissionPostureBlocked.map((contract) => contract.action)),
      states: freezeArray([...new Set(permissionPostureBlocked.map((contract) => contract.boundaryDecision?.permissionPosture?.state).filter(Boolean))]),
    }),
    providerBudgetBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_budget_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities blocked by provider budget state.`,
      nextCommand: providerBudgetBlocked[0]?.lifecycle?.providerBudget?.nextCommand || "wait_for_provider_budget_reset",
      capabilities: freezeArray(providerBudgetBlocked.map((contract) => contract.action)),
      retryAfterMs: providerBudgetBlocked[0]?.lifecycle?.providerBudget?.retryAfterMs ?? 0,
    }),
    providerCallbackBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_callback_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities without complete callback endpoint state.`,
      nextCommand: providerCallbackBlocked[0]?.lifecycle?.providerCallback?.nextCommand || "attach_provider_callback_endpoint",
      capabilities: freezeArray(providerCallbackBlocked.map((contract) => contract.action)),
    }),
    providerEventSubscriptionBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_event_subscription_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities without required event subscriptions.`,
      nextCommand: providerEventSubscriptionBlocked[0]?.lifecycle?.providerEventSubscription?.nextCommand || "subscribe_provider_events",
      capabilities: freezeArray(providerEventSubscriptionBlocked.map((contract) => contract.action)),
    }),
    providerMaintenanceBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_maintenance_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities blocked by provider maintenance windows.`,
      nextCommand: providerMaintenanceBlocked[0]?.lifecycle?.providerMaintenance?.nextCommand || "wait_for_provider_maintenance_window",
      capabilities: freezeArray(providerMaintenanceBlocked.map((contract) => contract.action)),
      retryAfterMs: providerMaintenanceBlocked[0]?.lifecycle?.providerMaintenance?.retryAfterMs ?? 0,
    }),
    providerServiceUnavailable.length > 0 && Object.freeze({
      code: "aios.effects.provider_service_unavailable",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities blocked by provider service availability.`,
      nextCommand: providerServiceUnavailable[0]?.lifecycle?.providerMaintenance?.serviceWindow?.nextCommand
        || providerServiceUnavailable[0]?.lifecycle?.providerMaintenance?.nextCommand
        || "wait_for_provider_service_recovery",
      capabilities: freezeArray(providerServiceUnavailable.map((contract) => contract.action)),
      serviceWindows: freezeArray(providerServiceUnavailable
        .map((contract) => contract.lifecycle?.providerMaintenance?.serviceWindow?.serviceWindowId)
        .filter(Boolean)),
      retryAfterMs: providerServiceUnavailable[0]?.lifecycle?.providerMaintenance?.retryAfterMs ?? 0,
    }),
    providerExportBoundaryBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_export_boundary_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities with blocked provider export boundary lanes.`,
      nextCommand: providerExportBoundaryBlocked[0]?.lifecycle?.providerExportBoundary?.nextCommand || "repair_provider_export_boundary",
      capabilities: freezeArray(providerExportBoundaryBlocked.map((contract) => contract.action)),
      retryableCapabilities: freezeArray(providerExportBoundaryRetryable.map((contract) => contract.action)),
    }),
    providerPublicationBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_publication_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp analytics publication rows blocked before export.`,
      nextCommand: providerPublicationBlocked[0]?.lifecycle?.providerPublication?.nextCommand || "repair_scope_analytics_export",
      capabilities: freezeArray(providerPublicationBlocked.map((contract) => contract.action)),
      publicationId: providerPublicationBlocked[0]?.lifecycle?.providerPublication?.publicationId || "",
    }),
    providerPublicationReceiptBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_publication_receipt_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has blocked Mailchimp analytics publication receipts before provider handoff.`,
      nextCommand: providerPublicationReceiptBlocked[0]?.lifecycle?.providerPublication?.blockedReceiptRows?.[0]?.nextCommand || "repair_scope_publication_receipt",
      capabilities: freezeArray(providerPublicationReceiptBlocked.map((contract) => contract.action)),
      publicationId: providerPublicationReceiptBlocked[0]?.lifecycle?.providerPublication?.publicationId || "",
      destinations: freezeArray(providerPublicationReceiptBlocked
        .flatMap((contract) => contract.lifecycle?.providerPublication?.blockedReceiptRows || [])
        .map((row) => row.destinationId)
        .filter(Boolean)),
    }),
    providerPublicationReceiptPending.length > 0 && Object.freeze({
      code: "aios.effects.provider_publication_receipt_pending",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" needs Mailchimp analytics publication receipts before provider handoff.`,
      nextCommand: providerPublicationReceiptPending[0]?.lifecycle?.providerPublication?.receiptRows?.find?.((row) => row.state !== "accepted")?.nextCommand || "attach_scope_publication_receipt",
      capabilities: freezeArray(providerPublicationReceiptPending.map((contract) => contract.action)),
      publicationId: providerPublicationReceiptPending[0]?.lifecycle?.providerPublication?.publicationId || "",
    }),
    settingsBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_settings_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities with incomplete provider settings.`,
      nextCommand: settingsBlocked[0]?.lifecycle?.settingsAdoption?.nextCommand || "repair_mailchimp_settings",
      capabilities: freezeArray(settingsBlocked.map((contract) => contract.action)),
    }),
    settingsDisabled.length > 0 && Object.freeze({
      code: "aios.effects.provider_settings_disabled",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities disabled by provider settings.`,
      nextCommand: settingsDisabled[0]?.lifecycle?.settingsAdoption?.nextCommand || "observe",
      capabilities: freezeArray(settingsDisabled.map((contract) => contract.action)),
    }),
    lifecycleGateBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_lifecycle_gate_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities blocked by lifecycle controls.`,
      nextCommand: lifecycleGateBlocked[0]?.lifecycle?.lifecycleGate?.nextCommand || "repair_mailchimp_lifecycle_controls",
      capabilities: freezeArray(lifecycleGateBlocked.map((contract) => contract.action)),
    }),
    lifecycleReceiptBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_lifecycle_command_receipt_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp lifecycle override commands without accepted client receipts.`,
      nextCommand: lifecycleReceiptBlocked[0]?.lifecycle?.lifecycleGate?.overrideReceipt?.nextCommand || "attach_mailchimp_lifecycle_command_receipt",
      capabilities: freezeArray(lifecycleReceiptBlocked.map((contract) => contract.action)),
      commands: freezeArray([...new Set(lifecycleReceiptBlocked
        .map((contract) => contract.lifecycle?.lifecycleGate?.overrideReceipt?.command)
        .filter(Boolean))]),
      receiptTokens: freezeArray(lifecycleReceiptBlocked
        .map((contract) => contract.lifecycle?.lifecycleGate?.overrideReceipt?.receiptToken)
        .filter(Boolean)),
    }),
    marketingConsentBlocked.length > 0 && Object.freeze({
      code: "aios.effects.provider_marketing_consent_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has Mailchimp capabilities blocked by marketing consent controls.`,
      nextCommand: marketingConsentBlocked[0]?.lifecycle?.lifecycleGate?.marketingConsent?.nextCommand || "collect_marketing_consent",
      capabilities: freezeArray(marketingConsentBlocked.map((contract) => contract.action)),
      expiredCapabilities: freezeArray(marketingConsentExpired.map((contract) => contract.action)),
    }),
    scopeBlockedRows.length > 0 && Object.freeze({
      code: "aios.effects.scope_lineage_blocked",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has blocked scope analytics export lineage.`,
      nextCommand: scopeBlockedRows[0]?.nextCommand || "repair_scope_analytics_export",
      capabilities: freezeArray([...new Set(scopeBlockedRows.map((row) => row.action).filter(Boolean))]),
    }),
    scopeStaleRows.length > 0 && Object.freeze({
      code: "aios.effects.scope_lineage_stale",
      message: `Job "${compactString(job.name || capabilityJob.jobName || "anonymous")}" has stale scope analytics history and should refresh before provider export.`,
      nextCommand: scopeStaleRows[0]?.nextCommand || "refresh_scope_analytics_snapshot",
      retryAfterMs: 0,
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
    && permissionPostureBlocked.length === 0
    && pendingAcceptance.length === 0
    && syncPending.length === 0
    && segmentSyncReceiptPending.length === 0
    && providerCallbackPending.length === 0
    && providerEventSubscriptionPending.length === 0
    && providerMaintenanceBlocked.length === 0
    && providerServiceUnavailable.length === 0
    && providerExportBoundaryBlocked.length === 0
    && providerPublicationBlocked.length === 0
    && providerPublicationReceiptBlocked.length === 0
    && providerPublicationReceiptPending.length === 0
    && lifecycleReceiptBlocked.length === 0
    && marketingConsentBlocked.length === 0
    && lifecycleGateBlocked.length === 0
    && settingsPatchRequired.length === 0
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
      : providerCallbackPending.length > 0
        ? "waiting-for-provider-callback"
      : providerEventSubscriptionPending.length > 0
        ? "waiting-for-provider-events"
      : providerMaintenanceDegraded.length > 0
        ? "waiting-for-provider-maintenance"
      : providerServiceDegraded.length > 0
        ? "provider-service-degraded"
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
      adapterStatusSnapshotBlocked: adapterStatusSnapshotBlocked.length,
      syncBlocked: syncBlocked.length,
      syncPendingConfirmation: syncPending.length,
      segmentSyncReceiptBlocked: segmentSyncReceiptBlocked.length,
      segmentSyncReceiptPending: segmentSyncReceiptPending.length,
      segmentSyncReceiptAccepted: mailchimpContracts.filter((contract) => contract.segmentSyncReceipt?.state === "accepted").length,
      syncScopeBlocked: mailchimpContracts.filter((contract) => contract.providerSync?.metadata?.scopeSyncState === "blocked").length,
      workflowBlocked: workflowBlocked.length,
      workflowReady: workflowReady.length,
      permissionLeaseBlocked: leaseBlocked.length,
      permissionLeaseReady: leaseReady.length,
      permissionPostureBlocked: permissionPostureBlocked.length,
      permissionPostureGrantBlocked: permissionPostureGrantBlocked.length,
      permissionPostureLeaseBlocked: permissionPostureLeaseBlocked.length,
      permissionPostureIdentityBlocked: permissionPostureIdentityBlocked.length,
      providerBudgetBlocked: providerBudgetBlocked.length,
      providerBudgetThrottled: providerBudgetThrottled.length,
      providerCallbackBlocked: providerCallbackBlocked.length,
      providerCallbackPending: providerCallbackPending.length,
      providerCallbackReady: providerCallbackReady.length,
      providerEventSubscriptionBlocked: providerEventSubscriptionBlocked.length,
      providerEventSubscriptionPending: providerEventSubscriptionPending.length,
      providerEventSubscriptionReady: providerEventSubscriptionReady.length,
      providerMaintenanceBlocked: providerMaintenanceBlocked.length,
      providerMaintenanceDegraded: providerMaintenanceDegraded.length,
      providerServiceUnavailable: providerServiceUnavailable.length,
      providerServiceDegraded: providerServiceDegraded.length,
      providerExportBoundaryBlocked: providerExportBoundaryBlocked.length,
      providerExportBoundaryRetryable: providerExportBoundaryRetryable.length,
      providerPublicationBlocked: providerPublicationBlocked.length,
      providerPublicationReady: providerPublicationReady.length,
      providerPublicationReceiptBlocked: providerPublicationReceiptBlocked.length,
      providerPublicationReceiptPending: providerPublicationReceiptPending.length,
      providerPublicationReceiptAccepted: providerPublicationReceiptAccepted.length,
      lifecycleCommandReceiptBlocked: lifecycleReceiptBlocked.length,
      marketingConsentRequired: mailchimpContracts.filter((contract) => contract.lifecycle?.lifecycleGate?.marketingConsent?.required === true).length,
      marketingConsentBlocked: marketingConsentBlocked.length,
      marketingConsentExpired: marketingConsentExpired.length,
      lifecycleGateBlocked: lifecycleGateBlocked.length,
      lifecycleGateGated: lifecycleGateGated.length,
      settingsAdoptionBlocked: settingsBlocked.length,
      settingsAdoptionPatchRequired: settingsPatchRequired.length,
      settingsAdoptionDisabled: settingsDisabled.length,
      blockedScopeLineageRows: scopeBlockedRows.length,
      staleScopeLineageRows: scopeStaleRows.length,
      scopeHistoryRows: toArray(scopeLineage.historyRows).length,
      scopeExportDestinations: toArray(scopeLineage.exportDestinations).length,
      providerHandoffRows: providerHandoffRows.length,
      providerHandoffBlocked: providerHandoffBlocked.length,
      providerHandoffWaiting: providerHandoffWaiting.length,
      providerHandoffReady: providerHandoffReady.length,
      acceptedForExternalHandoff: providerAccepted,
      acceptanceGates: freezeArray(acceptanceGates),
      capabilities: freezeArray(negotiatedCapabilities),
    }),
    providerHandoffReadiness: Object.freeze({
      protocol: "aios.effects.provider-handoff-readiness.v1",
      state: compactString(providerHandoffReadiness.state || "not-provided"),
      acceptedForPreview: true,
      acceptedForAdapter: providerHandoffReadiness.acceptedForAdapter === true && providerAccepted,
      rows: freezeArray(providerHandoffRows.map((row) => ({
        rowId: compactString(row.rowId),
        action: compactString(row.action),
        provider: compactString(row.provider || "mailchimp"),
        state: compactString(row.state || "preview"),
        phase: compactString(row.phase || "preview"),
        readyForAdapter: row.readyForAdapter === true,
        exportable: row.exportable === true,
        nextCommand: compactString(row.nextCommand || "observe"),
        statusChannel: compactString(row.statusChannel),
        statusSnapshotKey: compactString(row.statusSnapshotKey),
        requestId: compactString(row.requestId),
        blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
        waitingOn: freezeArray(toArray(row.waitingOn).map(compactString).filter(Boolean)),
        requiredPermission: compactString(row.requiredPermission),
        permissionLeaseState: compactString(row.permissionLeaseState || "not-required"),
        providerSyncState: compactString(row.providerSyncState || "not-applicable"),
        workflowState: compactString(row.workflowState || "not-required"),
        adapterStatusState: compactString(row.adapterStatusState || "unobserved"),
        publicationState: compactString(row.publicationState || "not-required"),
        publicationReceiptState: compactString(row.publicationReceiptState || "not-required"),
      }))),
      blockedRows: freezeArray(providerHandoffBlocked),
      waitingRows: freezeArray(providerHandoffWaiting),
      readyRows: freezeArray(providerHandoffReady),
      counters: Object.freeze({
        rows: providerHandoffRows.length,
        blocked: providerHandoffBlocked.length,
        waiting: providerHandoffWaiting.length,
        ready: providerHandoffReady.length,
        exportable: providerHandoffRows.filter((row) => row.exportable === true).length,
      }),
      nextCommand: compactString(providerHandoffBlocked[0]?.nextCommand
        || providerHandoffWaiting[0]?.nextCommand
        || providerHandoffReady[0]?.nextCommand
        || providerHandoffReadiness.nextCommand
        || "observe"),
    }),
    scopeLineage: Object.freeze({
      protocol: "aios.effects.provider.scope-lineage.v1",
      state: compactString(scopeLineage.state || "not-provided"),
      acceptedForProviderExport: scopeLineage.acceptedForProviderExport !== false,
      rows: freezeArray(toArray(scopeLineage.scopeExportRows || scopeLineage.rows).map((row) => ({
        rowId: compactString(row.rowId),
        action: compactString(row.action),
        provider: compactString(row.provider),
        state: compactString(row.state),
        exportable: row.exportable === true,
        statusChannel: compactString(row.statusChannel),
        statusSnapshotKey: compactString(row.statusSnapshotKey),
        restartToken: compactString(row.restartToken),
        adapterStatusState: compactString(row.adapterStatusState),
        permissionLeaseState: compactString(row.permissionLeaseState),
        nextCommand: compactString(row.nextCommand || "observe"),
        blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
      }))),
      blockedRows: freezeArray(toArray(scopeLineage.blockedRows).map((row) => ({
        rowId: compactString(row.rowId),
        action: compactString(row.action),
        nextCommand: compactString(row.nextCommand || "repair_scope_analytics_export"),
        blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean)),
      }))),
      staleRows: freezeArray(toArray(scopeLineage.staleRows).map((row) => ({
        rowId: compactString(row.rowId),
        jobName: compactString(row.jobName),
        ageMs: Number(row.ageMs) || 0,
        nextCommand: compactString(row.nextCommand || "refresh_scope_analytics_snapshot"),
      }))),
      historyRows: freezeArray(toArray(scopeLineage.historyRows).map((row) => ({
        rowId: compactString(row.rowId),
        jobName: compactString(row.jobName),
        state: compactString(row.state),
        fingerprint: compactString(row.fingerprint),
        stale: row.stale === true,
        exportRows: Number(row.exportRows) || 0,
        exportableRows: Number(row.exportableRows) || 0,
        blockedRows: Number(row.blockedRows) || 0,
        nextCommand: compactString(row.nextCommand || "observe"),
      }))),
      exportDestinations: freezeArray(toArray(scopeLineage.exportDestinations).map((destination) => ({
        destinationId: compactString(destination.destinationId),
        name: compactString(destination.name),
        format: compactString(destination.format),
        enabled: destination.enabled !== false,
        maxAgeMs: Number(destination.maxAgeMs) || 0,
        nextCommand: compactString(destination.nextCommand || "publish_scope_analytics_export"),
      }))),
      nextCommand: compactString(scopeLineage.nextCommand
        || scopeLineage.blockedRows?.[0]?.nextCommand
        || scopeLineage.staleRows?.[0]?.nextCommand
        || "observe"),
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
      providerSyncScopeStates: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.providerSync?.metadata?.scopeSyncState).filter(Boolean))]),
      adapterStatusStates: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.statusReconciliation?.state).filter(Boolean))]),
      workflowStates: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.workflowGate?.state).filter(Boolean))]),
      workflowNextCommands: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.workflowGate?.nextCommand).filter(Boolean))]),
      previewDecisionStates: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.workflowGate?.previewDecision?.state).filter(Boolean))]),
      previewDecisionNextCommands: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.workflowGate?.previewDecision?.nextCommand).filter(Boolean))]),
      previewAcceptanceTokens: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.workflowGate?.previewDecision?.acceptanceToken).filter(Boolean))]),
      permissionLeaseStates: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.boundaryDecision?.leaseState).filter(Boolean))]),
      permissionLeaseTokens: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.boundaryDecision?.permissionLease?.token).filter(Boolean))]),
      providerBudgetStates: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.lifecycle?.providerBudget?.state).filter(Boolean))]),
      providerBudgetIds: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.lifecycle?.providerBudget?.budgetId).filter(Boolean))]),
      providerBudgetRetrySchedule: freezeArray(mailchimpContracts
        .filter((contract) => contract.lifecycle?.providerBudget?.state && contract.lifecycle.providerBudget.state !== "not-required")
        .map((contract) => ({
          action: contract.action,
          state: contract.lifecycle.providerBudget.state,
          budgetId: contract.lifecycle.providerBudget.budgetId,
          command: contract.lifecycle.providerBudget.nextCommand || "observe",
          retryAfterMs: contract.lifecycle.providerBudget.retryAfterMs ?? 0,
          resetAt: contract.lifecycle.providerBudget.resetAt || "",
        }))),
      providerCallbackSchedule: freezeArray(mailchimpContracts
        .filter((contract) => contract.lifecycle?.providerCallback?.state && contract.lifecycle.providerCallback.state !== "not-required")
        .map((contract) => ({
          action: contract.action,
          state: contract.lifecycle.providerCallback.state,
          callbackId: contract.lifecycle.providerCallback.callbackId,
          command: contract.lifecycle.providerCallback.nextCommand || "observe",
          retryAfterMs: contract.lifecycle.providerCallback.retryAfterMs ?? 0,
          verificationState: contract.lifecycle.providerCallback.verificationState || "",
        }))),
      providerEventSubscriptionSchedule: freezeArray(mailchimpContracts
        .filter((contract) => contract.lifecycle?.providerEventSubscription?.state && contract.lifecycle.providerEventSubscription.state !== "not-required")
        .map((contract) => ({
          action: contract.action,
          state: contract.lifecycle.providerEventSubscription.state,
          subscriptionId: contract.lifecycle.providerEventSubscription.subscriptionId,
          callbackId: contract.lifecycle.providerEventSubscription.callbackId,
          command: contract.lifecycle.providerEventSubscription.nextCommand || "observe",
          retryAfterMs: contract.lifecycle.providerEventSubscription.retryAfterMs ?? 0,
          missingEvents: contract.lifecycle.providerEventSubscription.missingEvents || freezeArray([]),
        }))),
      providerMaintenanceSchedule: freezeArray(mailchimpContracts
        .filter((contract) => contract.lifecycle?.providerMaintenance?.state && contract.lifecycle.providerMaintenance.state !== "not-required")
        .map((contract) => ({
          action: contract.action,
          state: contract.lifecycle.providerMaintenance.state,
          windowId: contract.lifecycle.providerMaintenance.windowId,
          serviceWindowId: contract.lifecycle.providerMaintenance.serviceWindow?.serviceWindowId || "",
          serviceState: contract.lifecycle.providerMaintenance.serviceWindow?.state || "available",
          serviceSeverity: contract.lifecycle.providerMaintenance.serviceWindow?.severity || "",
          serviceBlocksReads: contract.lifecycle.providerMaintenance.serviceWindow?.blocksReads === true,
          serviceBlocksWrites: contract.lifecycle.providerMaintenance.serviceWindow?.blocksWrites === true,
          command: contract.lifecycle.providerMaintenance.nextCommand || "observe",
          retryAfterMs: contract.lifecycle.providerMaintenance.retryAfterMs ?? 0,
        }))),
      settingsAdoptionSchedule: freezeArray(mailchimpContracts
        .filter((contract) => contract.lifecycle?.settingsAdoption?.state && contract.lifecycle.settingsAdoption.state !== "not-required")
        .map((contract) => ({
          action: contract.action,
          state: contract.lifecycle.settingsAdoption.state,
          changedFields: contract.lifecycle.settingsAdoption.changedFields,
          missing: contract.lifecycle.settingsAdoption.missing,
          command: contract.lifecycle.settingsAdoption.nextCommand || "observe",
          statusChannel: contract.lifecycle.settingsAdoption.statusChannel || contract.audit?.statusChannel || "",
        }))),
      lifecycleGateSchedule: freezeArray(mailchimpContracts
        .filter((contract) => contract.lifecycle?.lifecycleGate?.state && contract.lifecycle.lifecycleGate.state !== "not-required")
        .map((contract) => ({
          action: contract.action,
          state: contract.lifecycle.lifecycleGate.state,
          mode: contract.lifecycle.lifecycleGate.mode,
          command: contract.lifecycle.lifecycleGate.nextCommand || "observe",
          missing: contract.lifecycle.lifecycleGate.missing || freezeArray([]),
          scheduleRequested: contract.lifecycle.lifecycleGate.scheduling?.requested === true,
          sendLocked: contract.lifecycle.lifecycleGate.sendLock?.locked === true,
          marketingConsent: contract.lifecycle.lifecycleGate.marketingConsent || Object.freeze({ required: false, state: "not-required" }),
        }))),
      providerPublicationReceiptStates: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.lifecycle?.providerPublication?.receiptState).filter(Boolean))]),
      providerPublicationReceiptSchedule: freezeArray(mailchimpContracts
        .filter((contract) => {
          const state = contract.lifecycle?.providerPublication?.receiptState;
          return state && state !== "not-required" && state !== "accepted";
        })
        .map((contract) => ({
          action: contract.action,
          state: contract.lifecycle.providerPublication.receiptState,
          publicationId: contract.lifecycle.providerPublication.publicationId || "",
          command: contract.lifecycle.providerPublication.blockedReceiptRows?.[0]?.nextCommand
            || contract.lifecycle.providerPublication.receiptRows?.find?.((row) => row.state !== "accepted")?.nextCommand
            || "attach_scope_publication_receipt",
          destinations: freezeArray(toArray(contract.lifecycle.providerPublication.receiptRows)
            .filter((row) => row.state !== "accepted")
            .map((row) => row.destinationId)
            .filter(Boolean)),
        }))),
      marketingConsentSchedule: freezeArray(marketingConsentBlocked.map((contract) => ({
        action: contract.action,
        state: contract.lifecycle.lifecycleGate?.marketingConsent?.state || "missing",
        consentId: contract.lifecycle.lifecycleGate?.marketingConsent?.consentId || "",
        command: contract.lifecycle.lifecycleGate?.marketingConsent?.nextCommand || "collect_marketing_consent",
        expired: contract.lifecycle.lifecycleGate?.marketingConsent?.expired === true,
        statusChannel: contract.lifecycle.lifecycleGate?.marketingConsent?.statusChannel || contract.audit?.statusChannel || "",
      }))),
      operationIds: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.operationIdentity?.operationId).filter(Boolean))]),
      operationStates: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.operationIdentity?.state).filter(Boolean))]),
      permissionLeaseRetrySchedule: freezeArray(mailchimpContracts
        .filter((contract) => contract.lifecycle?.controls?.requirePermissionLeaseRefresh === true)
        .map((contract) => ({
          action: contract.action,
          command: contract.boundaryDecision?.leaseRecovery?.nextCommand || contract.lifecycle?.leaseRefresh?.command || "refresh_mailchimp_permission_lease",
          retryAfterMs: contract.boundaryDecision?.leaseRecovery?.retryAfterMs ?? contract.lifecycle?.leaseRefresh?.retryAfterMs ?? 0,
          strategy: contract.boundaryDecision?.leaseRecovery?.backoff?.strategy || contract.lifecycle?.leaseRefresh?.strategy || "bounded-refresh",
          statusChannel: contract.boundaryDecision?.leaseRecovery?.handoff?.statusChannel || contract.audit?.statusChannel || "",
        }))),
      auditEvents: freezeArray([...new Set(mailchimpContracts.map((contract) => contract.audit?.event).filter(Boolean))]),
    }),
    externalHandoff: Object.freeze({
      accepted: providerAccepted,
      nextCommand: handoffErrors[0]?.nextCommand
        || pendingAcceptance[0]?.acceptance?.nextCommand
        || syncPending[0]?.providerSync?.nextCommand
        || segmentSyncReceiptPending[0]?.segmentSyncReceipt?.nextCommand
        || providerCallbackPending[0]?.lifecycle?.providerCallback?.nextCommand
        || providerEventSubscriptionPending[0]?.lifecycle?.providerEventSubscription?.nextCommand
        || providerServiceUnavailable[0]?.lifecycle?.providerMaintenance?.serviceWindow?.nextCommand
        || providerMaintenanceBlocked[0]?.lifecycle?.providerMaintenance?.nextCommand
        || providerPublicationReceiptBlocked[0]?.lifecycle?.providerPublication?.blockedReceiptRows?.[0]?.nextCommand
        || providerPublicationReceiptPending[0]?.lifecycle?.providerPublication?.receiptRows?.find?.((row) => row.state !== "accepted")?.nextCommand
        || marketingConsentBlocked[0]?.lifecycle?.lifecycleGate?.marketingConsent?.nextCommand
        || lifecycleGateBlocked[0]?.lifecycle?.lifecycleGate?.nextCommand
        || settingsPatchRequired[0]?.lifecycle?.settingsAdoption?.nextCommand
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

function millisecondsBetween(later, earlier) {
  const laterMs = Date.parse(compactString(later));
  const earlierMs = Date.parse(compactString(earlier));
  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs) || laterMs < earlierMs) return 0;
  return laterMs - earlierMs;
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

function createRuntimeWorkflowAdoption(job = {}, stepEffects = [], capabilityJob = {}, providerServiceContract = {}, replayWorkflow = {}, replayEvidence = {}) {
  const capabilityHandoff = capabilityJob.workflowHandoff || {};
  const capabilityRows = toArray(capabilityHandoff.rows);
  const previewRuntimeRows = toArray(capabilityJob.contracts)
    .map((contract) => contract.handoff?.previewRuntimeHandoff
      ? Object.freeze({
        ...contract.handoff.previewRuntimeHandoff,
        capability: contract.action,
      })
      : null)
    .filter(Boolean);
  const replayCommands = toArray(replayWorkflow.commands);
  const replayBlocked = toArray(replayWorkflow.blockedCommands);
  const evidenceBlocked = toArray(replayEvidence.blockedCommands);
  const providerErrors = toArray(providerServiceContract.externalHandoff?.errors);
  const effectRows = toArray(stepEffects).map((effect, index) => {
    const firstCapability = effect.capabilities?.[0] || "";
    const matchingCapability = capabilityRows.find((row) => {
      return compactString(row.action) && effect.capabilities?.includes?.(row.action);
    });
    const matchingReplay = replayCommands.find((command) => {
      return compactString(command.stepName) === effect.step || (firstCapability && compactString(command.capability) === firstCapability);
    });
    const matchingPreviewRuntime = previewRuntimeRows.find((row) => {
      return compactString(row.capability) === firstCapability || compactString(row.name) === firstCapability || compactString(row.name) === effect.step;
    });
    const blocked = effect.actionableErrors?.length > 0
      || matchingCapability?.blocking === true
      || matchingReplay?.state === "blocked"
      || (matchingPreviewRuntime && matchingPreviewRuntime.acceptedForRuntime === false);
    const ready = !blocked
      && (effect.status === "ready-for-adapter-handoff"
        || matchingCapability?.state === "ready"
        || matchingReplay?.state === "runnable"
        || matchingPreviewRuntime?.acceptedForAdapter === true);

    return Object.freeze({
      index,
      kind: "effect-step",
      name: effect.step,
      capability: firstCapability,
      state: blocked ? "blocked" : ready ? "ready" : effect.status === "adapter-status-pending" ? "waiting" : "preview",
      command: effect.actionableErrors?.[0]?.nextCommand
        || matchingPreviewRuntime?.nextCommand
        || matchingCapability?.command
        || matchingReplay?.nextCommand
        || effect.recovery?.command
        || "observe",
      phase: matchingReplay?.phase || matchingCapability?.phase || (effect.effectClass === "external-write" ? "adapter-handoff" : "runtime"),
      blocking: blocked,
      reason: effect.actionableErrors?.[0]?.message
        || (matchingPreviewRuntime?.acceptedForRuntime === false ? "Preview runtime handoff is missing accepted client/runtime state." : "")
        || matchingCapability?.reason
        || (ready ? "Effect step is ready for runtime adoption." : "Effect step can remain in preview."),
      statusChannel: compactString(effect.health?.statusChannel || matchingPreviewRuntime?.statusChannel || matchingCapability?.runtime?.statusChannel),
      statusSnapshotKeys: effect.health?.statusSnapshotKeys || freezeArray([]),
      idempotencyKey: compactString(matchingReplay?.idempotencyKey || matchingPreviewRuntime?.idempotencyKey || matchingCapability?.runtime?.idempotencyKey),
      replayPolicy: compactString(matchingReplay?.replayPolicy || "dedupe-by-command-id"),
      blockedBy: freezeArray([
        ...toArray(effect.actionableErrors).map((error) => error.code || error.nextCommand).filter(Boolean),
        ...toArray(matchingPreviewRuntime?.missing).map((missing) => `preview:${missing}`),
        ...toArray(matchingCapability?.blockedBy),
        ...toArray(matchingReplay?.missing).map((missing) => `missing:${missing}`),
      ].map(compactString).filter(Boolean).sort()),
    });
  });
  const capabilityOnlyRows = capabilityRows
    .filter((row) => !effectRows.some((effect) => effect.capability === row.action))
    .map((row, index) => Object.freeze({
      index: effectRows.length + index,
      kind: "capability-handoff",
      name: row.action,
      capability: row.action,
      state: row.state,
      command: row.command,
      phase: row.phase,
      blocking: row.blocking,
      reason: row.reason,
      statusChannel: row.runtime?.statusChannel || "",
      statusSnapshotKeys: freezeArray([row.runtime?.statusSnapshotKey].filter(Boolean)),
      idempotencyKey: row.runtime?.idempotencyKey || "",
      replayPolicy: "capability-workflow-handoff",
      blockedBy: row.blockedBy || freezeArray([]),
    }));
  const previewRuntimeOnlyRows = previewRuntimeRows
    .filter((row) => !effectRows.some((effect) => effect.capability === row.capability || effect.name === row.name))
    .map((row, index) => Object.freeze({
      index: effectRows.length + capabilityOnlyRows.length + index,
      kind: "preview-runtime-handoff",
      name: row.name || row.capability,
      capability: row.capability || row.name,
      state: row.acceptedForAdapter ? "ready" : row.acceptedForRuntime ? "preview" : "blocked",
      command: row.nextCommand || "accept_scope_preview_row",
      phase: "preview-runtime-handoff",
      blocking: row.acceptedForRuntime === false,
      reason: row.acceptedForAdapter
        ? "Preview runtime handoff is accepted for adapter adoption."
        : "Preview runtime handoff is waiting on acceptance or runtime identity.",
      statusChannel: row.statusChannel || "",
      statusSnapshotKeys: freezeArray([row.statusSnapshotKey].filter(Boolean)),
      idempotencyKey: row.idempotencyKey || "",
      replayPolicy: "preview-acceptance-receipt",
      blockedBy: freezeArray(toArray(row.missing).map((missing) => `preview:${missing}`).sort()),
    }));
  const replayOnlyRows = replayCommands
    .filter((command) => !effectRows.some((effect) => effect.name === command.stepName || effect.capability === command.capability))
    .map((command, index) => Object.freeze({
      index: effectRows.length + capabilityOnlyRows.length + previewRuntimeOnlyRows.length + index,
      kind: "replay-command",
      name: command.command,
      capability: compactString(command.capability),
      state: command.state === "blocked" || toArray(command.missing).length > 0 ? "blocked" : command.state === "runnable" ? "ready" : "waiting",
      command: command.nextCommand || command.command,
      phase: command.phase,
      blocking: command.state === "blocked" || toArray(command.missing).length > 0,
      reason: toArray(command.missing).length > 0 ? "Replay command is missing persisted runtime state." : "Replay command is ready for adoption.",
      statusChannel: "",
      statusSnapshotKeys: freezeArray([command.statusSnapshotKey].filter(Boolean)),
      idempotencyKey: compactString(command.idempotencyKey),
      replayPolicy: compactString(command.replayPolicy),
      blockedBy: freezeArray(toArray(command.missing).map((missing) => `missing:${missing}`).sort()),
    }));
  const rows = [...effectRows, ...capabilityOnlyRows, ...previewRuntimeOnlyRows, ...replayOnlyRows]
    .sort((left, right) => {
      if (left.blocking !== right.blocking) return left.blocking ? -1 : 1;
      if (left.state !== right.state) return left.state.localeCompare(right.state);
      return left.index - right.index;
    });
  const blocked = rows.filter((row) => row.blocking || row.state === "blocked");
  const waiting = rows.filter((row) => row.state === "waiting");
  const ready = rows.filter((row) => row.state === "ready");
  const providerBlocked = providerErrors.length > 0 || capabilityHandoff.state === "blocked";
  const replayBlockedState = replayBlocked.length > 0 || evidenceBlocked.length > 0;

  return Object.freeze({
    protocol: "aios.effects.runtime-workflow-adoption.v1",
    jobName: compactString(job.name || capabilityJob.jobName || "anonymous"),
    state: providerBlocked || replayBlockedState || blocked.length > 0
      ? "blocked"
      : ready.length > 0 && providerServiceContract.externalHandoff?.accepted !== false
        ? "ready"
        : waiting.length > 0
          ? "waiting"
          : rows.length > 0
            ? "preview"
            : "empty",
    acceptedForPreview: true,
    acceptedForRuntime: providerBlocked === false && replayBlockedState === false && blocked.length === 0,
    acceptedForAdapter: providerServiceContract.externalHandoff?.accepted === true
      && replayWorkflow.acceptedForAdapter === true
      && replayEvidence.acceptedForAdapter !== false
      && blocked.length === 0,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    readyRows: freezeArray(ready),
    waitingRows: freezeArray(waiting),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      ready: ready.length,
      waiting: waiting.length,
      providerErrors: providerErrors.length,
      replayBlocked: replayBlocked.length,
      replayEvidenceBlocked: evidenceBlocked.length,
      capabilityHandoffRows: capabilityRows.length,
      previewRuntimeHandoffRows: previewRuntimeRows.length,
      previewRuntimeHandoffBlocked: previewRuntimeRows.filter((row) => row.acceptedForRuntime === false).length,
      previewRuntimeHandoffReady: previewRuntimeRows.filter((row) => row.acceptedForAdapter === true).length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.command
        || replayBlocked[0]?.nextCommand
        || evidenceBlocked[0]?.nextCommand
        || providerServiceContract.externalHandoff?.nextCommand
        || waiting[0]?.command
        || ready[0]?.command
        || "observe",
      reason: blocked.length > 0
        ? "Runtime workflow adoption has blocking effect, capability, or replay requirements."
        : replayBlockedState
          ? "Runtime workflow adoption is waiting for replay evidence repair."
          : providerBlocked
            ? "Runtime workflow adoption is waiting for provider handoff repair."
            : ready.length > 0
              ? "Runtime workflow adoption can queue ready adapter work."
              : "Runtime workflow adoption has no required adapter commands.",
    }),
  });
}

function createTypedRecoveryRunbook(job = {}, stepEffects = [], typeJob = {}, providerServiceContract = {}, replayWorkflow = {}, replayEvidence = {}, runtimeWorkflowAdoption = {}) {
  const graph = typeJob.recoveryCommandGraph || typeJob.contract?.recoveryCommandGraph || typeJob.clientRuntimeAdoption?.workflow?.recoveryCommandGraph || {};
  const graphCommands = toArray(graph.commands);
  const providerErrors = toArray(providerServiceContract.externalHandoff?.errors);
  const replayBlocked = [
    ...toArray(replayWorkflow.blockedCommands),
    ...toArray(replayEvidence.blockedCommands),
  ];
  const workflowBlocked = toArray(runtimeWorkflowAdoption.blockedRows);
  const effectErrors = toArray(stepEffects).flatMap((effect) => toArray(effect.actionableErrors).map((error) => ({
    stepName: effect.step,
    capability: effect.capabilities?.[0] || "",
    command: error.nextCommand,
    code: error.code,
    message: error.message,
  })));
  const rows = [];
  const pushRow = (row = {}) => {
    const command = compactString(row.command || row.nextCommand);
    if (!command || command === "observe") return;
    const phase = compactString(row.phase || "recover");
    const capability = compactString(row.capability || row.action);
    const stepName = compactString(row.stepName || row.step);
    const key = [phase, command, capability, stepName, compactString(row.reason || row.message)].join("|");
    if (rows.some((existing) => existing.key === key)) return;
    const blocking = row.blocking === true || row.state === "blocked";

    rows.push(Object.freeze({
      key,
      command,
      commandId: compactString(row.commandId),
      phase,
      capability,
      stepName,
      state: compactString(row.state || (blocking ? "blocked" : "ready")),
      priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : blocking ? 5 : 1,
      blocking,
      reason: compactString(row.reason || row.message || "Recovery command must be completed before Mailchimp adapter handoff."),
      nextCommand: compactString(row.nextCommand || command),
      retryAfterMs: Number.isFinite(Number(row.retryAfterMs)) ? Number(row.retryAfterMs) : 0,
      statusChannel: compactString(row.statusChannel || graph.statusChannel || providerServiceContract.syncMetadata?.statusChannels?.[0]),
      statusSnapshotKey: compactString(row.statusSnapshotKey || graph.statusSnapshotKey || providerServiceContract.syncMetadata?.statusSnapshotKeys?.[0]),
      idempotencyKey: compactString(row.idempotencyKey),
      replayKey: compactString(row.replayKey),
      replayPolicy: compactString(row.replayPolicy || "dedupe-by-command-id"),
      safeToReplay: row.safeToReplay === true,
      blockedBy: freezeArray(toArray(row.blockedBy || row.missing).map(compactString).filter(Boolean).sort()),
      source: compactString(row.source || "effects"),
    }));
  };

  for (const command of graphCommands) {
    pushRow({
      ...command,
      source: "type-recovery-command-graph",
    });
  }

  for (const error of providerErrors) {
    pushRow({
      command: error.nextCommand,
      phase: error.code === "aios.effects.provider_permission_lease_blocked" ? "permission-lease" : "provider-handoff",
      state: "blocked",
      blocking: true,
      priority: 12,
      reason: error.message,
      blockedBy: [error.code, ...toArray(error.capabilities).map((capability) => `capability:${capability}`)],
      source: "provider-service-contract",
    });
  }

  for (const command of replayBlocked) {
    pushRow({
      command: command.nextCommand || "attach_recovery_status_handoff",
      phase: command.phase || "replay",
      capability: command.capability,
      stepName: command.stepName,
      state: "blocked",
      blocking: true,
      priority: 10,
      reason: `Replay command "${command.command}" is blocked by missing persisted recovery evidence.`,
      blockedBy: toArray(command.missing).map((missing) => `missing:${missing}`),
      source: "replay",
    });
  }

  for (const row of workflowBlocked) {
    pushRow({
      command: row.command || runtimeWorkflowAdoption.nextStep?.command || "resolve_runtime_workflow_adoption",
      phase: row.phase || "runtime-workflow",
      capability: row.capability,
      stepName: row.name,
      state: "blocked",
      blocking: true,
      priority: 9,
      reason: row.reason,
      blockedBy: row.blockedBy,
      statusChannel: row.statusChannel,
      statusSnapshotKey: row.statusSnapshotKeys?.[0],
      idempotencyKey: row.idempotencyKey,
      source: "runtime-workflow-adoption",
    });
  }

  for (const error of effectErrors) {
    pushRow({
      command: error.command,
      phase: "effect-validation",
      capability: error.capability,
      stepName: error.stepName,
      state: "blocked",
      blocking: true,
      priority: 11,
      reason: error.message,
      blockedBy: [error.code],
      source: "step-effect",
    });
  }

  const sortedRows = rows
    .sort((left, right) => {
      if (left.blocking !== right.blocking) return left.blocking ? -1 : 1;
      if (left.priority !== right.priority) return right.priority - left.priority;
      return left.command.localeCompare(right.command) || left.capability.localeCompare(right.capability) || left.stepName.localeCompare(right.stepName);
    })
    .map(({ key, ...row }) => Object.freeze(row));
  const blocked = sortedRows.filter((row) => row.blocking || row.state === "blocked");
  const ready = sortedRows.filter((row) => row.state === "ready" && !row.blocking);
  const waiting = sortedRows.filter((row) => row.state === "waiting");
  const persistedLedgerRows = sortedRows.filter((row) => row.source === "type-recovery-command-graph" && row.replayKey);
  const replayableLedgerRows = persistedLedgerRows.filter((row) => row.safeToReplay);

  return Object.freeze({
    protocol: "aios.effects.typed-recovery-runbook.v1",
    jobName: compactString(job.name || typeJob.jobName || "anonymous"),
    state: blocked.length > 0
      ? "blocked"
      : ready.length > 0
        ? "ready"
        : waiting.length > 0
          ? "waiting"
          : "not-required",
    acceptedForPreview: true,
    acceptedForRuntime: blocked.length === 0,
    acceptedForAdapter: blocked.length === 0 && (ready.some((row) => row.phase === "adapter-handoff") || graph.acceptedForAdapter === true),
    restartToken: compactString(graph.restartToken || typeJob.persistedState?.restartToken),
    statusChannel: compactString(graph.statusChannel || typeJob.persistedState?.statusChannel),
    statusSnapshotKey: compactString(graph.statusSnapshotKey || typeJob.persistedState?.statusSnapshotKey),
    rows: freezeArray(sortedRows),
    blockedRows: freezeArray(blocked),
    readyRows: freezeArray(ready),
    waitingRows: freezeArray(waiting),
    persistedRecoveryLedger: Object.freeze({
      state: persistedLedgerRows.some((row) => row.state === "blocked")
        ? "blocked"
        : replayableLedgerRows.length > 0
          ? "replayable"
          : persistedLedgerRows.length > 0
            ? "waiting"
            : "not-required",
      replayableRows: freezeArray(replayableLedgerRows.map((row) => ({
        commandId: row.commandId,
        replayKey: row.replayKey,
        command: row.command,
        phase: row.phase,
        capability: row.capability,
        stepName: row.stepName,
        replayPolicy: row.replayPolicy,
      }))),
      blockedRows: freezeArray(persistedLedgerRows.filter((row) => row.state === "blocked").map((row) => ({
        commandId: row.commandId,
        command: row.command,
        phase: row.phase,
        capability: row.capability,
        stepName: row.stepName,
        nextCommand: row.nextCommand,
        blockedBy: row.blockedBy,
      }))),
    }),
    counters: Object.freeze({
      rows: sortedRows.length,
      blocked: blocked.length,
      ready: ready.length,
      waiting: waiting.length,
      typedGraphRows: graphCommands.length,
      persistedLedgerRows: persistedLedgerRows.length,
      persistedLedgerReplayable: replayableLedgerRows.length,
      persistedLedgerBlocked: persistedLedgerRows.filter((row) => row.state === "blocked").length,
      providerErrors: providerErrors.length,
      replayBlocked: replayBlocked.length,
      workflowBlocked: workflowBlocked.length,
      effectErrors: effectErrors.length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand
        || waiting[0]?.nextCommand
        || ready[0]?.nextCommand
        || "observe",
      reason: blocked[0]?.reason
        || waiting[0]?.reason
        || ready[0]?.reason
        || "No typed recovery command is required.",
    }),
  });
}

function createEffectAdapterHandoffManifest(jobPlans = [], diagnostics = []) {
  const rows = toArray(jobPlans).flatMap((job) => {
    const adoption = job.runtimeWorkflowAdoption || {};
    const provider = job.providerServiceContract || {};
    const replayEvidence = job.replayEvidence || {};
    const providerCapabilities = new Map(toArray(provider.negotiation?.capabilities)
      .map((capability) => [compactString(capability.action), capability]));
    return toArray(adoption.rows).map((row, index) => {
      const capability = compactString(row.capability || row.name);
      const providerCapability = providerCapabilities.get(capability) || null;
      const replayCommand = toArray(replayEvidence.commands)
        .find((command) => compactString(command.capability) === capability || compactString(command.stepName) === compactString(row.name));
      const previewRuntime = row.kind === "preview-runtime-handoff"
        ? row
        : toArray(adoption.rows).find((candidate) => {
          return candidate.kind === "preview-runtime-handoff"
            && (compactString(candidate.capability) === capability || compactString(candidate.name) === capability);
        });
      const blockedBy = [
        ...toArray(row.blockedBy).map(compactString).filter(Boolean),
        provider.externalHandoff?.accepted === false && "provider-handoff-not-accepted",
        replayCommand?.state === "blocked" && "replay-evidence-blocked",
        previewRuntime?.state === "blocked" && "preview-runtime-handoff-blocked",
        providerCapability?.adapterHandoff === false && "capability-handoff-disabled",
      ].filter(Boolean);
      const queueable = row.state === "ready"
        && row.blocking !== true
        && blockedBy.length === 0
        && provider.externalHandoff?.accepted !== false
        && (replayCommand ? replayCommand.state !== "blocked" : true);

      return Object.freeze({
        rowId: stableCommandToken("effect-handoff-row", [job.jobName, capability || row.name, index]),
        jobName: compactString(job.jobName),
        stepName: compactString(row.kind === "effect-step" ? row.name : row.stepName || ""),
        capability,
        provider: provider.provider || "local",
        state: queueable ? "queueable" : blockedBy.length > 0 || row.blocking === true ? "blocked" : row.state === "waiting" ? "waiting" : "preview",
        queueable,
        command: queueable ? "queue_adapter_handoff" : compactString(row.command || provider.externalHandoff?.nextCommand || "observe"),
        commandId: stableCommandToken("effect-handoff-cmd", [job.jobName, capability, row.command, replayCommand?.commandId]),
        phase: compactString(row.phase || "adapter-handoff"),
        reason: compactString(row.reason || provider.externalHandoff?.errors?.[0]?.message || "Adapter handoff row derived from effect workflow adoption."),
        runtime: Object.freeze({
          statusChannel: compactString(row.statusChannel || provider.syncMetadata?.statusChannels?.[0]),
          statusSnapshotKeys: row.statusSnapshotKeys || provider.syncMetadata?.statusSnapshotKeys || freezeArray([]),
          idempotencyKey: compactString(row.idempotencyKey || replayCommand?.idempotencyKey),
          replayPolicy: compactString(row.replayPolicy || replayCommand?.replayPolicy || "dedupe-by-command-id"),
        }),
        guards: Object.freeze({
          providerState: compactString(provider.state || "not-applicable"),
          replayEvidenceState: compactString(replayEvidence.state || "not-required"),
          runtimeWorkflowState: compactString(adoption.state || "not-required"),
          previewRuntimeHandoffState: compactString(previewRuntime?.state || "not-required"),
          adapterStatusState: compactString(providerCapability?.syncMetadata?.adapterStatusState || ""),
          workflowState: compactString(providerCapability?.syncMetadata?.workflowState || ""),
          permissionLeaseState: compactString(providerCapability?.syncMetadata?.permissionLeaseState || ""),
        }),
        blockedBy: freezeArray([...new Set(blockedBy)].sort()),
      });
    });
  }).sort((left, right) => {
    if (left.state !== right.state) return left.state.localeCompare(right.state);
    return left.jobName.localeCompare(right.jobName) || left.capability.localeCompare(right.capability) || left.stepName.localeCompare(right.stepName);
  });
  const blocked = rows.filter((row) => row.state === "blocked");
  const waiting = rows.filter((row) => row.state === "waiting");
  const queueable = rows.filter((row) => row.queueable);
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");

  return Object.freeze({
    protocol: "aios.effects.adapter-handoff-manifest.v1",
    state: errors.length > 0 || blocked.length > 0
      ? "blocked"
      : waiting.length > 0
        ? "waiting"
        : queueable.length > 0
          ? "queueable"
          : "not-required",
    acceptedForPreview: true,
    acceptedForRuntime: errors.length === 0 && blocked.length === 0,
    acceptedForAdapter: errors.length === 0 && blocked.length === 0 && waiting.length === 0 && queueable.length > 0,
    rows: freezeArray(rows),
    blockedRows: freezeArray(blocked),
    waitingRows: freezeArray(waiting),
    queueableRows: freezeArray(queueable),
    counters: Object.freeze({
      rows: rows.length,
      blocked: blocked.length,
      waiting: waiting.length,
      queueable: queueable.length,
      diagnostics: diagnostics.length,
      errors: errors.length,
      providerBlocked: rows.filter((row) => row.blockedBy.includes("provider-handoff-not-accepted")).length,
      replayBlocked: rows.filter((row) => row.blockedBy.includes("replay-evidence-blocked")).length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.command || waiting[0]?.command || queueable[0]?.command || "observe",
      reason: blocked.length > 0
        ? "Effect adapter handoff has blocking provider, replay, or runtime workflow guards."
        : waiting.length > 0
          ? "Effect adapter handoff is waiting on provider or runtime workflow state."
          : queueable.length > 0
            ? "Effect adapter handoff rows are queueable for Mailchimp adapter execution."
            : "No effect adapter handoff rows were produced.",
    }),
  });
}

function createProviderPersistencePlan(job = {}, capabilityJob = {}, providerServiceContract = {}, typeJob = {}) {
  const contracts = toArray(capabilityJob.contracts).filter((contract) => contract.provider === "mailchimp");
  const restartToken = compactString(capabilityJob.principal?.restartToken);
  const statusSnapshotKey = compactString(capabilityJob.principal?.statusSnapshotKey);
  const observedAt = compactString(job.observedAt || job.clientState?.observedAt || job.requestState?.observedAt || typeJob.scope?.runtimeScope?.observedAt);
  const syncContracts = contracts.map((contract) => {
    const sync = contract.providerSync || {};
    const checkpointKey = compactString(sync.metadata?.checkpointKey);
    const watermarkKey = compactString(sync.metadata?.watermarkKey);
    const action = compactString(contract.action);
    const maxAgeMs = positiveInteger(sync.metadata?.maxAgeMs ?? sync.maxAgeMs ?? contract.syncMaxAgeMs, 0);
    const lastSyncedAt = compactString(sync.metadata?.lastSyncedAt);
    const ageMs = maxAgeMs > 0 && observedAt && lastSyncedAt ? millisecondsBetween(observedAt, lastSyncedAt) : 0;
    const stale = maxAgeMs > 0 && (!lastSyncedAt || ageMs > maxAgeMs);
    const scopeSyncState = compactString(sync.metadata?.scopeSyncState || "not-provided");
    const scopeSyncNextCommand = compactString(sync.metadata?.scopeSyncNextCommand || "");
    return Object.freeze({
      action,
      state: sync.state || "not-applicable",
      scopeSyncState,
      scopeSyncNextCommand,
      adapterStatusState: contract.statusReconciliation?.state || "unobserved",
      adapterStatusNextCommand: contract.statusReconciliation?.nextCommand || "observe",
      resources: sync.resources || freezeArray([]),
      checkpointKey,
      watermarkKey,
      cursor: compactString(sync.metadata?.cursor),
      objectRef: compactString(sync.metadata?.objectRef),
      idempotencyKey: compactString(contract.audit?.requestId),
      lastSyncedAt,
      observedAt,
      maxAgeMs,
      ageMs,
      stale,
      leaseRefreshCommand: contract.boundaryDecision?.leaseRecovery?.nextCommand || contract.lifecycle?.leaseRefresh?.command || "",
      leaseRetryAfterMs: contract.boundaryDecision?.leaseRecovery?.retryAfterMs ?? contract.lifecycle?.leaseRefresh?.retryAfterMs ?? 0,
      providerCallbackState: contract.lifecycle?.providerCallback?.state || "not-required",
      providerCallbackId: contract.lifecycle?.providerCallback?.callbackId || "",
      providerCallbackCommand: contract.lifecycle?.providerCallback?.nextCommand || "observe",
      restartSafe: sync.health?.restartSafe !== false
        && stale === false
        && scopeSyncState !== "blocked"
        && !["blocked", "pending-verification"].includes(contract.lifecycle?.providerCallback?.state)
        && !["failed", "timed-out", "cancelled", "missing-status", "snapshot-blocked"].includes(contract.statusReconciliation?.state)
        && Boolean(checkpointKey || !contract.effects?.externalWrite),
      resumeCommand: ["failed", "timed-out", "cancelled"].includes(contract.statusReconciliation?.state)
        ? contract.statusReconciliation?.nextCommand || "inspect_adapter_failure"
        : contract.statusReconciliation?.state === "snapshot-blocked"
          ? contract.statusReconciliation?.nextCommand || "materialize_adapter_status_snapshot"
        : contract.statusReconciliation?.state === "missing-status"
          ? "load_adapter_status_snapshot"
        : scopeSyncState === "blocked"
        ? scopeSyncNextCommand || "repair_provider_sync_scope"
        : stale
          ? "refresh_provider_sync_checkpoint"
        : ["blocked", "pending-verification"].includes(contract.lifecycle?.providerCallback?.state)
          ? contract.lifecycle?.providerCallback?.nextCommand || "verify_provider_callback_endpoint"
        : sync.state === "blocked"
        ? contract.lifecycle?.controls?.requirePermissionLeaseRefresh === true
          ? contract.boundaryDecision?.leaseRecovery?.nextCommand || "refresh_mailchimp_permission_lease"
          : "repair_provider_sync_metadata"
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
  const blocked = syncContracts.filter((contract) => contract.state === "blocked" || contract.scopeSyncState === "blocked" || contract.restartSafe === false);
  const pending = syncContracts.filter((contract) => contract.state === "needs-provider-confirmation");
  const stale = syncContracts.filter((contract) => contract.stale);
  const statusBlocked = syncContracts.filter((contract) => ["failed", "timed-out", "cancelled", "missing-status", "snapshot-blocked"].includes(contract.adapterStatusState));
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
      stale: contract.stale,
      ageMs: contract.ageMs,
      maxAgeMs: contract.maxAgeMs,
      leaseRefreshCommand: contract.leaseRefreshCommand,
      leaseRetryAfterMs: contract.leaseRetryAfterMs,
      providerCallbackState: contract.providerCallbackState,
      providerCallbackId: contract.providerCallbackId,
      providerCallbackCommand: contract.providerCallbackCommand,
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
      staleCheckpoints: freezeArray(stale.map((contract) => ({
        action: contract.action,
        checkpointKey: contract.checkpointKey,
        watermarkKey: contract.watermarkKey,
        lastSyncedAt: contract.lastSyncedAt,
        observedAt: contract.observedAt,
        ageMs: contract.ageMs,
        maxAgeMs: contract.maxAgeMs,
        nextCommand: contract.resumeCommand,
      }))),
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
  const runtimeWorkflowAdoptions = toArray(jobPlans).map((job) => job.runtimeWorkflowAdoption).filter(Boolean);
  const typedRecoveryRunbooks = toArray(jobPlans).map((job) => job.typedRecoveryRunbook).filter(Boolean);
  const typedRecoveryBlocked = typedRecoveryRunbooks.filter((runbook) => runbook.state === "blocked" || runbook.blockedRows?.length > 0);
  const persistedLedgerRows = typedRecoveryRunbooks.flatMap((runbook) => runbook.persistedRecoveryLedger?.replayableRows || []);
  const blockedPersistedLedgerRows = typedRecoveryRunbooks.flatMap((runbook) => runbook.persistedRecoveryLedger?.blockedRows || []);
  const resumptionRows = toArray(jobPlans).flatMap((job) => {
    return toArray(job.effects).flatMap((effect) => toArray(effect.health?.resumptionJournal).map((row) => ({
      ...row,
      jobName: job.jobName,
      step: effect.step,
    })));
  });
  const blockedResumptionRows = resumptionRows.filter((row) => row.state === "blocked");
  const replayableResumptionRows = resumptionRows.filter((row) => row.safeToReplay === true || row.state === "replayable");
  const checkpointRows = toArray(jobPlans).flatMap((job) => {
    return toArray(job.effects).flatMap((effect) => toArray(effect.health?.recoveryCheckpoints).map((row) => ({
      ...row,
      jobName: job.jobName,
      step: effect.step,
    })));
  });
  const blockedCheckpointRows = checkpointRows.filter((row) => row.state === "blocked" || toArray(row.missing).length > 0);
  const replayableCheckpointRows = checkpointRows.filter((row) => row.safeToReplay === true || row.state === "replayable");

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
      permissionLeaseStates: freezeArray([...new Set(reportRows.flatMap((row) => row.permissionLeaseStates || []))]),
      permissionLeaseBlockedJobs: reportRows.filter((row) => row.permissionLeaseStates?.includes?.("blocked")).length,
      operationIdentityStates: freezeArray([...new Set(toArray(jobPlans).flatMap((job) => job.providerServiceContract?.syncMetadata?.operationStates || []).filter(Boolean))]),
      operationIdentityBlockedSteps: counters.operationIdentityBlocked,
      operationIdentityTrackedSteps: counters.operationIdentityTracked,
      syncCheckpointKeys: freezeArray([...new Set(toArray(jobPlans).flatMap((job) => job.providerPersistencePlan?.checkpointSlots || []).map((slot) => slot.checkpointKey).filter(Boolean))]),
      staleProviderCheckpoints: toArray(jobPlans).reduce((count, job) => count + (job.providerPersistencePlan?.recovery?.staleCheckpoints?.length ?? 0), 0),
      replayWorkflowStates: freezeArray([...new Set(toArray(jobPlans).map((job) => job.replayWorkflow?.state).filter(Boolean))]),
      replayWorkflowCommands: freezeArray([...new Set(toArray(jobPlans).flatMap((job) => job.replayWorkflow?.commands || []).map((command) => command.command).filter(Boolean))]),
      blockedReplayCommands: toArray(jobPlans).reduce((count, job) => count + (job.replayWorkflow?.blockedCommands?.length ?? 0), 0),
      replayEvidenceStates: freezeArray([...new Set(replayEvidence.map((evidence) => evidence.state).filter(Boolean))]),
      replayEvidenceCommands: freezeArray([...new Set(replayEvidence.flatMap((evidence) => evidence.commands || []).map((command) => command.command).filter(Boolean))]),
      replayEvidenceCheckpoints: freezeArray([...new Set(replayEvidence.flatMap((evidence) => evidence.checkpointEvidence || []).map((checkpoint) => checkpoint.checkpointKey).filter(Boolean))]),
      blockedReplayEvidence: replayBlocked.length,
      runtimeWorkflowStates: freezeArray([...new Set(runtimeWorkflowAdoptions.map((adoption) => adoption.state).filter(Boolean))]),
      runtimeWorkflowCommands: freezeArray([...new Set(runtimeWorkflowAdoptions.flatMap((adoption) => adoption.rows || []).map((row) => row.command).filter(Boolean))]),
      runtimeWorkflowBlockedRows: runtimeWorkflowAdoptions.reduce((count, adoption) => count + (adoption.counters?.blocked ?? 0), 0),
      runtimeWorkflowReadyRows: runtimeWorkflowAdoptions.reduce((count, adoption) => count + (adoption.counters?.ready ?? 0), 0),
      typedRecoveryStates: freezeArray([...new Set(typedRecoveryRunbooks.map((runbook) => runbook.state).filter(Boolean))]),
      typedRecoveryCommands: freezeArray([...new Set(typedRecoveryRunbooks.flatMap((runbook) => runbook.rows || []).map((row) => row.command).filter(Boolean))]),
      typedRecoveryBlockedRows: typedRecoveryRunbooks.reduce((count, runbook) => count + (runbook.counters?.blocked ?? 0), 0),
      typedRecoveryReadyRows: typedRecoveryRunbooks.reduce((count, runbook) => count + (runbook.counters?.ready ?? 0), 0),
      persistedRecoveryReplayKeys: freezeArray([...new Set(persistedLedgerRows.map((row) => row.replayKey).filter(Boolean))]),
      persistedRecoveryReplayableRows: persistedLedgerRows.length,
      persistedRecoveryBlockedRows: blockedPersistedLedgerRows.length,
      resumptionJournalStates: freezeArray([...new Set(resumptionRows.map((row) => row.state).filter(Boolean))]),
      resumptionJournalReplayKeys: freezeArray([...new Set(resumptionRows.map((row) => row.replayKey).filter(Boolean))]),
      resumptionJournalRows: resumptionRows.length,
      resumptionJournalReplayableRows: replayableResumptionRows.length,
      resumptionJournalBlockedRows: blockedResumptionRows.length,
      recoveryCheckpointStates: freezeArray([...new Set(checkpointRows.map((row) => row.state).filter(Boolean))]),
      recoveryCheckpointReplayKeys: freezeArray([...new Set(checkpointRows.map((row) => row.replayKey).filter(Boolean))]),
      recoveryCheckpointRows: checkpointRows.length,
      recoveryCheckpointReplayableRows: replayableCheckpointRows.length,
      recoveryCheckpointBlockedRows: blockedCheckpointRows.length,
    }),
    resumptionJournal: Object.freeze({
      rows: freezeArray(resumptionRows.map((row) => ({
        jobName: row.jobName,
        step: row.step,
        rowId: row.rowId,
        state: row.state,
        command: row.command,
        replayKey: row.replayKey,
        safeToReplay: row.safeToReplay === true,
        nextCommand: row.nextCommand,
      }))),
      blockedRows: freezeArray(blockedResumptionRows.map((row) => ({
        jobName: row.jobName,
        step: row.step,
        rowId: row.rowId,
        missing: row.missing || freezeArray([]),
        nextCommand: row.nextCommand,
      }))),
      replayableRows: freezeArray(replayableResumptionRows.map((row) => ({
        jobName: row.jobName,
        step: row.step,
        rowId: row.rowId,
        replayKey: row.replayKey,
        nextCommand: row.nextCommand,
      }))),
    }),
    recoveryCheckpoints: Object.freeze({
      rows: freezeArray(checkpointRows.map((row) => ({
        jobName: row.jobName,
        step: row.step,
        rowId: row.rowId,
        action: row.action,
        state: row.state,
        commandId: row.commandId,
        replayKey: row.replayKey,
        safeToReplay: row.safeToReplay === true,
        nextCommand: row.nextCommand,
      }))),
      blockedRows: freezeArray(blockedCheckpointRows.map((row) => ({
        jobName: row.jobName,
        step: row.step,
        rowId: row.rowId,
        action: row.action,
        missing: row.missing || freezeArray([]),
        nextCommand: row.nextCommand,
      }))),
      replayableRows: freezeArray(replayableCheckpointRows.map((row) => ({
        jobName: row.jobName,
        step: row.step,
        rowId: row.rowId,
        replayKey: row.replayKey,
        nextCommand: row.nextCommand,
      }))),
    }),
    exportRows: freezeArray(reportRows),
    replayEvidence: freezeArray(replayEvidence),
    exportReadiness: Object.freeze({
      ready: counters.errors === 0 && blockedRows.length === 0 && replayBlocked.length === 0 && typedRecoveryBlocked.length === 0 && blockedResumptionRows.length === 0 && blockedCheckpointRows.length === 0,
      adapterReadyJobs: adapterRows.length,
      replayTrackedJobs: replayRows.length,
      runtimeWorkflowReadyJobs: runtimeWorkflowAdoptions.filter((adoption) => adoption.state === "ready").length,
      blockedRows: blockedRows.length + blockedResumptionRows.length + blockedCheckpointRows.length + typedRecoveryBlocked.reduce((count, runbook) => count + (runbook.blockedRows?.length ?? 0), 0),
      blockedBy: freezeArray([...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort()),
      nextCommand: replayBlocked[0]?.nextCommand
        || blockedResumptionRows[0]?.nextCommand
        || typedRecoveryBlocked[0]?.nextStep?.command
        || runtimeWorkflowAdoptions.find((adoption) => adoption.state === "blocked")?.nextStep?.command
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
  const runtimeWorkflowAdoption = job.runtimeWorkflowAdoption || {};
  const typedRecoveryRunbook = job.typedRecoveryRunbook || {};
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
    ...toArray(runtimeWorkflowAdoption.blockedRows)
      .map((row) => `runtime-workflow:${row.command || row.name}`),
    ...toArray(typedRecoveryRunbook.blockedRows)
      .map((row) => `typed-recovery:${row.command || row.nextCommand}`),
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
  const permissionLeaseStates = toArray(providerServiceContract.syncMetadata?.permissionLeaseStates).filter(Boolean);
  const resumptionJournalRows = toArray(job.effects).flatMap((effect) => toArray(effect.health?.resumptionJournal));
  const blockedResumptionJournalRows = resumptionJournalRows.filter((row) => row.state === "blocked");
  for (const row of blockedResumptionJournalRows) {
    blockedBy.push(`resumption-journal:${row.rowId || row.command || "blocked"}`);
  }
  const publicationCapabilities = toArray(providerServiceContract.negotiation?.capabilities)
    .map((capability) => capability.providerPublication)
    .filter(Boolean);
  const publicationErrors = toArray(providerServiceContract.externalHandoff?.errors)
    .filter((error) => error.code === "aios.effects.provider_publication_blocked");

  return Object.freeze({
    jobName: job.jobName || preview.jobName || "anonymous",
    status: blockedBy.length ? "blocked" : job.status || "unknown",
    previewState: preview.state || "not-rendered",
    adapterReady: preview.acceptedForAdapter === true || handoff.acceptedForRuntime === true,
    runtimeReady: preview.acceptedForRuntime === true || handoff.acceptedForRuntime === true,
    providerState: providerServiceContract.state || "not-applicable",
    providerPublicationState: publicationErrors.length > 0
      ? "blocked"
      : publicationCapabilities.some((publication) => publication.acceptedForExport === true)
        ? "ready"
        : "not-required",
    providerPublicationIds: freezeArray([...new Set(publicationCapabilities.map((publication) => publication.publicationId).filter(Boolean))].sort()),
    providerPublicationNextCommands: freezeArray([...new Set(publicationCapabilities.map((publication) => publication.nextCommand).filter(Boolean))].sort()),
    providerPersistenceState: providerPersistencePlan.state || "not-applicable",
    staleProviderCheckpoints: providerPersistencePlan.recovery?.staleCheckpoints?.length ?? 0,
    replayState: replayWorkflow.state || "not-required",
    replayEvidenceState: replayEvidence.state || "not-required",
    runtimeWorkflowState: runtimeWorkflowAdoption.state || "not-required",
    typedRecoveryState: typedRecoveryRunbook.state || "not-required",
    statusChannels: freezeArray([
      ...toArray(providerServiceContract.syncMetadata?.statusChannels),
      preview.providerPersistence?.statusChannel,
      ...toArray(runtimeWorkflowAdoption.rows).map((row) => row.statusChannel),
    ].filter(Boolean)),
    statusSnapshotKeys: freezeArray([...new Set(statusSnapshotKeys)].sort()),
    adapterStatusStates: freezeArray([...new Set(adapterStatusStates)].sort()),
    workflowStates: freezeArray([...new Set(workflowStates)].sort()),
    workflowNextCommands: freezeArray([...new Set(workflowNextCommands)].sort()),
    permissionLeaseStates: freezeArray([...new Set(permissionLeaseStates)].sort()),
    counters: Object.freeze({
      steps: job.analytics?.totalSteps ?? toArray(job.effects).length,
      externalWrites: job.analytics?.externalWrites ?? 0,
      blockedSteps: job.analytics?.blockedSteps ?? 0,
      retryableSteps: job.analytics?.retryableSteps ?? 0,
      replayCommands: replayWorkflow.commands?.length ?? 0,
      blockedReplayCommands: replayWorkflow.blockedCommands?.length ?? 0,
      replayEvidenceCommands: replayEvidence.commands?.length ?? 0,
      blockedReplayEvidence: replayEvidence.blockedCommands?.length ?? 0,
      runtimeWorkflowRows: runtimeWorkflowAdoption.counters?.rows ?? 0,
      runtimeWorkflowBlockedRows: runtimeWorkflowAdoption.counters?.blocked ?? 0,
      runtimeWorkflowReadyRows: runtimeWorkflowAdoption.counters?.ready ?? 0,
      typedRecoveryRows: typedRecoveryRunbook.counters?.rows ?? 0,
      typedRecoveryBlockedRows: typedRecoveryRunbook.counters?.blocked ?? 0,
      typedRecoveryReadyRows: typedRecoveryRunbook.counters?.ready ?? 0,
      resumptionJournalRows: resumptionJournalRows.length,
      resumptionJournalReplayableRows: resumptionJournalRows.filter((row) => row.safeToReplay === true || row.state === "replayable").length,
      resumptionJournalBlockedRows: blockedResumptionJournalRows.length,
      adapterStatusFailures: toArray(job.effects).filter((effect) => effect.status === "adapter-status-failed").length,
      adapterStatusMissing: toArray(job.effects).filter((effect) => effect.status === "adapter-status-missing").length,
      adapterStatusSnapshotBlocked: toArray(job.effects).filter((effect) => effect.status === "adapter-status-snapshot-blocked").length,
      clientWorkflowBlocked: toArray(job.effects).filter((effect) => effect.status === "client-workflow-blocked").length,
      permissionLeaseBlocked: toArray(providerServiceContract.externalHandoff?.errors)
        .filter((error) => error.code === "aios.effects.provider_permission_lease_blocked").length,
      providerPublicationBlocked: publicationErrors.length,
      providerPublicationReady: publicationCapabilities.filter((publication) => publication.acceptedForExport === true).length,
      staleProviderCheckpoints: providerPersistencePlan.recovery?.staleCheckpoints?.length ?? 0,
    }),
    blockedBy: freezeArray([...new Set(blockedBy)]),
    nextCommand: typedRecoveryRunbook.nextStep?.command
      || blockedResumptionJournalRows[0]?.nextCommand
      || runtimeWorkflowAdoption.nextStep?.command
      || replayEvidence.nextCommand
      || replayWorkflow.userWorkflow?.nextCommand
      || providerServiceContract.externalHandoff?.nextCommand
      || preview.nextStep?.command
      || handoff.recovery?.nextCommand
      || "observe",
  });
}

function createEffectExportManifest(jobPlans = [], diagnostics = [], acceptanceReport = {}, lifecycleControlPlane = {}) {
  const rows = toArray(jobPlans).map((job) => createJobExportReportRow(job));
  const scopeLineage = toArray(lifecycleControlPlane.scopeLineage?.rows);
  const blockedScopeRows = toArray(lifecycleControlPlane.scopeLineage?.blockedRows);
  const staleScopeRows = toArray(lifecycleControlPlane.scopeLineage?.staleRows);
  const scopeHistoryRows = toArray(lifecycleControlPlane.scopeLineage?.historyRows);
  const scopeExportDestinations = toArray(lifecycleControlPlane.scopeLineage?.exportDestinations);
  const diagnosticsByCode = countDiagnosticsByCode(diagnostics);
  const statusChannels = [...new Set(rows.flatMap((row) => row.statusChannels))].sort();
  const statusSnapshotKeys = [...new Set(rows.flatMap((row) => row.statusSnapshotKeys))].sort();
  const permissionLeaseStates = [...new Set(rows.flatMap((row) => row.permissionLeaseStates || []))].sort();
  const blockedRows = rows.filter((row) => row.blockedBy.length > 0);
  const replayEvidence = toArray(jobPlans).map((job) => job.replayEvidence).filter(Boolean);
  const blockedReplayEvidence = replayEvidence.filter((evidence) => evidence.state === "blocked" || evidence.blockedCommands?.length > 0);
  const runtimeWorkflowAdoptions = toArray(jobPlans).map((job) => job.runtimeWorkflowAdoption).filter(Boolean);
  const blockedRuntimeWorkflowRows = runtimeWorkflowAdoptions.flatMap((adoption) => adoption.blockedRows || []);
  const typedRecoveryRunbooks = toArray(jobPlans).map((job) => job.typedRecoveryRunbook).filter(Boolean);
  const blockedTypedRecoveryRows = typedRecoveryRunbooks.flatMap((runbook) => runbook.blockedRows || []);
  const exportReady = blockedRows.length === 0
    && blockedReplayEvidence.length === 0
    && blockedRuntimeWorkflowRows.length === 0
    && blockedTypedRecoveryRows.length === 0
    && blockedScopeRows.length === 0
    && staleScopeRows.length === 0
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
    permissionLeaseStates: freezeArray(permissionLeaseStates),
    scopeLineage: Object.freeze({
      protocol: "aios.effects.scope-lineage-readiness.v1",
      state: blockedScopeRows.length > 0
        ? "blocked"
        : staleScopeRows.length > 0
          ? "stale"
        : scopeLineage.length > 0
          ? "linked"
          : "not-provided",
      acceptedForExport: blockedScopeRows.length === 0 && staleScopeRows.length === 0,
      rows: freezeArray(scopeLineage),
      blockedRows: freezeArray(blockedScopeRows),
      staleRows: freezeArray(staleScopeRows),
      historyRows: freezeArray(scopeHistoryRows),
      exportDestinations: freezeArray(scopeExportDestinations),
      statusChannels: freezeArray([...new Set(scopeLineage.map((row) => row.statusChannel).filter(Boolean))]),
      statusSnapshotKeys: freezeArray([...new Set(scopeLineage.map((row) => row.statusSnapshotKey).filter(Boolean))]),
      restartTokens: freezeArray([...new Set(scopeLineage.map((row) => row.restartToken).filter(Boolean))]),
      nextCommand: blockedScopeRows[0]?.nextCommand
        || staleScopeRows[0]?.nextCommand
        || lifecycleControlPlane.scopeLineage?.nextCommand
        || "observe",
    }),
    replayEvidence: freezeArray(replayEvidence),
      runtimeWorkflowAdoptions: freezeArray(runtimeWorkflowAdoptions.map((adoption) => ({
      jobName: adoption.jobName,
      state: adoption.state,
      acceptedForAdapter: adoption.acceptedForAdapter === true,
      counters: adoption.counters,
      nextCommand: adoption.nextStep?.command || "observe",
    }))),
    typedRecoveryRunbooks: freezeArray(typedRecoveryRunbooks.map((runbook) => ({
      jobName: runbook.jobName,
      state: runbook.state,
      acceptedForAdapter: runbook.acceptedForAdapter === true,
      counters: runbook.counters,
      nextCommand: runbook.nextStep?.command || "observe",
    }))),
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
        enabled: blockedRows.length > 0 || blockedReplayEvidence.length > 0 || blockedRuntimeWorkflowRows.length > 0 || blockedTypedRecoveryRows.length > 0,
        blockedBy: freezeArray([...new Set([
          ...blockedRows.flatMap((row) => row.blockedBy),
          ...blockedReplayEvidence.flatMap((evidence) => toArray(evidence.blockedCommands).map((command) => `replay-evidence:${command.command}`)),
          ...blockedRuntimeWorkflowRows.map((row) => `runtime-workflow:${row.command || row.name}`),
          ...blockedTypedRecoveryRows.map((row) => `typed-recovery:${row.command || row.nextCommand}`),
          ...blockedScopeRows.flatMap((row) => toArray(row.blockedBy).map((reason) => `scope:${reason}`)),
          ...staleScopeRows.map((row) => `scope-stale:${row.jobName || row.rowId}`),
        ])].sort()),
      },
    ]),
    nextAction: exportReady
      ? "publish_effect_analytics_export"
      : blockedScopeRows[0]?.nextCommand
        || staleScopeRows[0]?.nextCommand
        || blockedReplayEvidence[0]?.nextCommand
        || blockedTypedRecoveryRows[0]?.nextCommand
        || runtimeWorkflowAdoptions.find((adoption) => adoption.state === "blocked")?.nextStep?.command
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

function createProviderHandoffPreviewChecklist(providerServiceContract = {}, cards = []) {
  const readiness = providerServiceContract.providerHandoffReadiness || {};
  const rows = toArray(readiness.rows);
  const byAction = new Map(rows.map((row) => [compactString(row.action), row]));
  const cardRows = toArray(cards).flatMap((card) => {
    return toArray(card.capabilities).map((action) => {
      const capabilityRow = byAction.get(compactString(action));
      const blockedBy = toArray(capabilityRow?.blockedBy).map(compactString).filter(Boolean);
      const waitingOn = toArray(capabilityRow?.waitingOn).map(compactString).filter(Boolean);
      const state = capabilityRow?.state
        || (card.previewState === "blocked"
          ? "blocked"
          : card.previewState === "ready"
            ? "ready"
            : "preview");

      return Object.freeze({
        rowId: compactString(capabilityRow?.rowId || `${card.step}:${action}`),
        step: card.step,
        action: compactString(action),
        state,
        phase: compactString(capabilityRow?.phase || (card.effectClass === "external-write" ? "adapter-handoff" : "runtime")),
        previewState: card.previewState,
        readyForAdapter: capabilityRow?.readyForAdapter === true && card.acceptance?.acceptedForRuntime === true,
        exportable: capabilityRow?.exportable === true,
        nextCommand: compactString(capabilityRow?.nextCommand || card.nextCommand || "observe"),
        blockedBy: freezeArray([...new Set([
          ...blockedBy,
          ...toArray(card.validation?.actionableErrors).map((error) => compactString(error.code)).filter(Boolean),
        ])].sort()),
        waitingOn: freezeArray([...new Set(waitingOn)].sort()),
        status: Object.freeze({
          statusChannel: compactString(capabilityRow?.statusChannel || card.statusChannel),
          statusSnapshotKey: compactString(capabilityRow?.statusSnapshotKey || card.statusSnapshotKeys?.[0]),
          adapterStatusState: compactString(capabilityRow?.adapterStatusState || "unobserved"),
          providerSyncState: compactString(capabilityRow?.providerSyncState || "not-applicable"),
          workflowState: compactString(capabilityRow?.workflowState || "not-required"),
          publicationReceiptState: compactString(capabilityRow?.publicationReceiptState || "not-required"),
        }),
      });
    });
  });
  const capabilityOnlyRows = rows
    .filter((row) => !cardRows.some((cardRow) => cardRow.action === row.action))
    .map((row) => Object.freeze({
      rowId: compactString(row.rowId),
      step: "",
      action: compactString(row.action),
      state: compactString(row.state || "preview"),
      phase: compactString(row.phase || "provider"),
      previewState: row.readyForAdapter === true ? "ready" : row.state === "blocked" ? "blocked" : "preview-only",
      readyForAdapter: row.readyForAdapter === true,
      exportable: row.exportable === true,
      nextCommand: compactString(row.nextCommand || "observe"),
      blockedBy: freezeArray(toArray(row.blockedBy).map(compactString).filter(Boolean).sort()),
      waitingOn: freezeArray(toArray(row.waitingOn).map(compactString).filter(Boolean).sort()),
      status: Object.freeze({
        statusChannel: compactString(row.statusChannel),
        statusSnapshotKey: compactString(row.statusSnapshotKey),
        adapterStatusState: compactString(row.adapterStatusState || "unobserved"),
        providerSyncState: compactString(row.providerSyncState || "not-applicable"),
        workflowState: compactString(row.workflowState || "not-required"),
        publicationReceiptState: compactString(row.publicationReceiptState || "not-required"),
      }),
    }));
  const checklistRows = [...cardRows, ...capabilityOnlyRows].sort((left, right) => {
    const leftBlocking = left.blockedBy.length > 0 || left.state === "blocked";
    const rightBlocking = right.blockedBy.length > 0 || right.state === "blocked";
    if (leftBlocking !== rightBlocking) return leftBlocking ? -1 : 1;
    if (left.state !== right.state) return left.state.localeCompare(right.state);
    return left.action.localeCompare(right.action) || left.step.localeCompare(right.step);
  });
  const blocked = checklistRows.filter((row) => row.state === "blocked" || row.blockedBy.length > 0);
  const waiting = checklistRows.filter((row) => row.state === "waiting" || row.waitingOn.length > 0);
  const ready = checklistRows.filter((row) => row.readyForAdapter === true);

  return Object.freeze({
    protocol: "aios.effects.provider-handoff-preview-checklist.v1",
    state: blocked.length > 0
      ? "blocked"
      : waiting.length > 0
        ? "waiting"
        : ready.length > 0 && ready.length === checklistRows.length
          ? "ready"
          : checklistRows.length > 0
            ? "preview"
            : "not-required",
    acceptedForPreview: true,
    acceptedForAdapter: checklistRows.length > 0 && blocked.length === 0 && waiting.length === 0 && ready.length === checklistRows.length,
    rows: freezeArray(checklistRows),
    blockedRows: freezeArray(blocked),
    waitingRows: freezeArray(waiting),
    readyRows: freezeArray(ready),
    counters: Object.freeze({
      rows: checklistRows.length,
      blocked: blocked.length,
      waiting: waiting.length,
      ready: ready.length,
      exportable: checklistRows.filter((row) => row.exportable === true).length,
    }),
    nextStep: Object.freeze({
      command: blocked[0]?.nextCommand
        || waiting[0]?.nextCommand
        || ready[0]?.nextCommand
        || providerServiceContract.providerHandoffReadiness?.nextCommand
        || "observe",
      reason: blocked.length > 0
        ? "Provider handoff checklist has blocking capability requirements."
        : waiting.length > 0
          ? "Provider handoff checklist is waiting on provider or client confirmation."
          : ready.length > 0
            ? "Provider handoff checklist is ready for adapter queueing."
            : "Provider handoff checklist is not required for this preview.",
    }),
  });
}

function createUserVisibleEffectPreview(job = {}, stepEffects = [], diagnostics = [], providerServiceContract = {}, providerPersistencePlan = {}, replayWorkflow = {}, runtimeWorkflowAdoption = {}, typedRecoveryRunbook = {}) {
  const cards = stepEffects.map(createPreviewStepCard);
  const providerHandoffChecklist = createProviderHandoffPreviewChecklist(providerServiceContract, cards);
  const blocked = cards.filter((card) => card.previewState === "blocked");
  const previewOnly = cards.filter((card) => card.previewState === "preview-only");
  const operator = cards.filter((card) => card.previewState === "needs-operator-action");
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const external = cards.filter((card) => card.effectClass === "external-write");
  const providerAccepted = providerServiceContract.externalHandoff?.accepted !== false;
  const providerNextCommand = providerServiceContract.externalHandoff?.nextCommand || "";
  const replayBlocked = toArray(replayWorkflow.blockedCommands);
  const replayRunnable = toArray(replayWorkflow.runnableCommands);
  const adoptionBlocked = toArray(runtimeWorkflowAdoption.blockedRows);
  const adoptionReady = toArray(runtimeWorkflowAdoption.readyRows);
  const runbookBlocked = toArray(typedRecoveryRunbook.blockedRows);
  const runbookReady = toArray(typedRecoveryRunbook.readyRows);
  const nextCommand = runbookBlocked[0]?.nextCommand
    || (providerHandoffChecklist.state === "blocked" ? providerHandoffChecklist.nextStep.command : "")
    || adoptionBlocked[0]?.command
    || replayBlocked[0]?.nextCommand
    || (providerAccepted === false ? providerNextCommand || "resolve_provider_handoff" : replayRunnable[0]?.nextCommand)
    || adoptionReady[0]?.command
    || runbookReady[0]?.nextCommand
    || (providerHandoffChecklist.state === "waiting" ? providerHandoffChecklist.nextStep.command : "")
    || (providerAccepted === false
      ? providerNextCommand || "resolve_provider_handoff"
      : blocked[0]?.nextCommand
        || previewOnly[0]?.nextCommand
        || operator[0]?.nextCommand
        || (external.length > 0 ? "queue_adapter_handoff" : "start_runtime"));
  const nextReason = runbookBlocked.length > 0
    ? runbookBlocked[0].reason
    : providerHandoffChecklist.state === "blocked"
    ? providerHandoffChecklist.nextStep.reason
    : adoptionBlocked.length > 0
    ? "Runtime workflow adoption has blocking handoff commands."
    : replayBlocked.length > 0
    ? "Restart replay commands need persisted status state before adapter handoff."
    : providerAccepted === false
      ? "Provider handoff requirements are not satisfied."
      : providerHandoffChecklist.state === "waiting"
        ? providerHandoffChecklist.nextStep.reason
      : blocked.length > 0
        ? "Blocking effect validation errors must be resolved."
        : previewOnly.length > 0
          ? "Preview can render while degraded adapter state is repaired."
          : operator.length > 0
            ? "Verifier evidence or operator approval is required."
            : external.length > 0
              ? "External effects are ready for adapter handoff."
              : "Local runtime effects are ready.";
  const state = errors.length > 0 || blocked.length > 0 || runtimeWorkflowAdoption.state === "blocked" || typedRecoveryRunbook.state === "blocked"
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
      adapterStatusSnapshotBlocked: providerServiceContract.negotiation?.adapterStatusSnapshotBlocked ?? 0,
      workflowBlocked: providerServiceContract.negotiation?.workflowBlocked ?? 0,
      workflowReady: providerServiceContract.negotiation?.workflowReady ?? 0,
      persistedCheckpoints: providerPersistencePlan.checkpointSlots?.length ?? 0,
      replayCommands: replayWorkflow.commands?.length ?? 0,
      blockedReplayCommands: replayBlocked.length,
      runnableReplayCommands: replayRunnable.length,
      runtimeWorkflowRows: runtimeWorkflowAdoption.counters?.rows ?? 0,
      runtimeWorkflowBlocked: runtimeWorkflowAdoption.counters?.blocked ?? 0,
      runtimeWorkflowReady: runtimeWorkflowAdoption.counters?.ready ?? 0,
      providerHandoffRows: providerHandoffChecklist.counters.rows,
      providerHandoffBlocked: providerHandoffChecklist.counters.blocked,
      providerHandoffWaiting: providerHandoffChecklist.counters.waiting,
      providerHandoffReady: providerHandoffChecklist.counters.ready,
      previewRuntimeHandoffRows: runtimeWorkflowAdoption.counters?.previewRuntimeHandoffRows ?? 0,
      previewRuntimeHandoffBlocked: runtimeWorkflowAdoption.counters?.previewRuntimeHandoffBlocked ?? 0,
      previewRuntimeHandoffReady: runtimeWorkflowAdoption.counters?.previewRuntimeHandoffReady ?? 0,
      recoveryRunbookRows: typedRecoveryRunbook.counters?.rows ?? 0,
      recoveryRunbookBlocked: typedRecoveryRunbook.counters?.blocked ?? 0,
      recoveryRunbookReady: typedRecoveryRunbook.counters?.ready ?? 0,
      scopeExportRows: providerServiceContract.scopeLineage?.rows?.length ?? 0,
      blockedScopeExportRows: providerServiceContract.scopeLineage?.blockedRows?.length ?? 0,
      providerPublicationReceiptBlocked: providerServiceContract.negotiation?.providerPublicationReceiptBlocked ?? 0,
      providerPublicationReceiptPending: providerServiceContract.negotiation?.providerPublicationReceiptPending ?? 0,
      providerPublicationReceiptAccepted: providerServiceContract.negotiation?.providerPublicationReceiptAccepted ?? 0,
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
    providerHandoffChecklist,
    scopeLineage: providerServiceContract.scopeLineage || Object.freeze({
      protocol: "aios.effects.scope-lineage-preview.v1",
      state: "not-provided",
      acceptedForProviderExport: true,
      rows: freezeArray([]),
      blockedRows: freezeArray([]),
      nextCommand: "observe",
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
    runtimeWorkflowAdoption,
    typedRecoveryRunbook,
  });
}

function createEffectAcceptanceReport(jobPlans = [], diagnostics = []) {
  const previews = toArray(jobPlans).map((job) => job.preview).filter(Boolean);
  const errors = toArray(diagnostics).filter((diagnostic) => diagnostic.level === "error");
  const blocked = previews.filter((preview) => preview.state === "blocked");
  const previewOnly = previews.filter((preview) => preview.state === "preview-only");
  const operator = previews.filter((preview) => preview.state === "needs-operator-action");
  const handoffChecklists = previews.map((preview) => preview.providerHandoffChecklist).filter(Boolean);
  const handoffRows = handoffChecklists.flatMap((checklist) => checklist.rows || []);
  const handoffBlocked = handoffChecklists.flatMap((checklist) => checklist.blockedRows || []);
  const handoffWaiting = handoffChecklists.flatMap((checklist) => checklist.waitingRows || []);
  const handoffReady = handoffChecklists.flatMap((checklist) => checklist.readyRows || []);

  return Object.freeze({
    protocol: "aios.effects.acceptance-report.v1",
    state: errors.length > 0 || blocked.length > 0 || handoffBlocked.length > 0
      ? "blocked"
      : handoffWaiting.length > 0
        ? "waiting-for-provider-handoff"
      : previewOnly.length > 0
        ? "preview-only"
        : operator.length > 0
          ? "needs-operator-action"
          : "accepted",
    acceptedForPreview: true,
    acceptedForRuntime: errors.length === 0 && blocked.length === 0 && handoffBlocked.length === 0 && previewOnly.length === 0 && operator.length === 0,
    acceptedForAdapter: errors.length === 0
      && handoffBlocked.length === 0
      && handoffWaiting.length === 0
      && previews.every((preview) => preview.acceptedForAdapter || preview.state === "local-ready"),
    previews: freezeArray(previews),
    providerHandoff: Object.freeze({
      protocol: "aios.effects.acceptance-provider-handoff.v1",
      state: handoffBlocked.length > 0
        ? "blocked"
        : handoffWaiting.length > 0
          ? "waiting"
          : handoffReady.length > 0 && handoffReady.length === handoffRows.length
            ? "ready"
            : handoffRows.length > 0
              ? "preview"
              : "not-required",
      acceptedForAdapter: handoffRows.length === 0 || (handoffBlocked.length === 0 && handoffWaiting.length === 0 && handoffReady.length === handoffRows.length),
      rows: freezeArray(handoffRows),
      blockedRows: freezeArray(handoffBlocked),
      waitingRows: freezeArray(handoffWaiting),
      readyRows: freezeArray(handoffReady),
      nextCommand: handoffBlocked[0]?.nextCommand
        || handoffWaiting[0]?.nextCommand
        || handoffReady[0]?.nextCommand
        || "observe",
    }),
    validationSummary: Object.freeze({
      jobs: previews.length,
      blockedJobs: blocked.length,
      previewOnlyJobs: previewOnly.length,
      operatorJobs: operator.length,
      runtimeAcceptedJobs: previews.filter((preview) => preview.acceptedForRuntime).length,
      adapterAcceptedJobs: previews.filter((preview) => preview.acceptedForAdapter).length,
      replayBlockedJobs: previews.filter((preview) => preview.replayWorkflow?.state === "blocked").length,
      replayRunnableJobs: previews.filter((preview) => preview.replayWorkflow?.state === "runnable").length,
      providerHandoffRows: handoffRows.length,
      providerHandoffBlocked: handoffBlocked.length,
      providerHandoffWaiting: handoffWaiting.length,
      providerHandoffReady: handoffReady.length,
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
  const leaseBlocked = toArray(analytics.permissionLeases?.blocked);
  const postureBlocked = toArray(analytics.timeline).filter((row) => compactString(row.permissionPostureState).endsWith("blocked"));
  const postureGrantBlocked = postureBlocked.filter((row) => row.permissionPostureState === "grant-blocked");
  const postureLeaseBlocked = postureBlocked.filter((row) => row.permissionPostureState === "lease-blocked");
  const postureIdentityBlocked = postureBlocked.filter((row) => row.permissionPostureState === "identity-blocked");
  const scopeLineage = analytics.scopeLineage || {};
  const blockedScopeRows = toArray(scopeLineage.blockedRows);
  const staleScopeRows = toArray(scopeLineage.staleRows);
  const scopeHistoryRows = toArray(scopeLineage.historyRows);
  const scopeExportDestinations = toArray(scopeLineage.exportDestinations);
  const settingsBlockedJobs = toArray(jobPlans).filter((job) => {
    return toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_settings_blocked" || error.code === "aios.effects.provider_settings_disabled");
  });
  const settingsPatchJobs = toArray(jobPlans).filter((job) => {
    return (job.providerServiceContract?.negotiation?.settingsAdoptionPatchRequired ?? 0) > 0;
  });
  const lifecycleGateBlockedJobs = toArray(jobPlans).filter((job) => {
    return toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_lifecycle_gate_blocked");
  });
  const lifecycleReceiptBlockedJobs = toArray(jobPlans).filter((job) => {
    return toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_lifecycle_command_receipt_blocked");
  });
  const marketingConsentBlockedJobs = toArray(jobPlans).filter((job) => {
    return toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_marketing_consent_blocked");
  });
  const lifecycleGateGatedJobs = toArray(jobPlans).filter((job) => {
    return (job.providerServiceContract?.negotiation?.lifecycleGateGated ?? 0) > 0;
  });
  const jobStates = toArray(jobPlans).map((job) => ({
    jobName: job.jobName,
    status: job.status,
    blocked: job.status === "blocked",
    degraded: job.status === "degraded-boundary-hold",
    needsOperator: job.status === "needs-operator-action",
    acceptedForRuntime: job.handoff?.acceptedForRuntime === true,
    nextCommand: job.handoff?.recovery?.nextCommand || "observe",
    replayWorkflowState: job.replayWorkflow?.state || "not-required",
    runtimeWorkflowState: job.runtimeWorkflowAdoption?.state || "not-required",
    recoveryRunbookState: job.typedRecoveryRunbook?.state || "not-required",
    recoveryNextCommand: job.typedRecoveryRunbook?.nextStep?.command || "observe",
  }));
  const blockedJobs = jobStates.filter((job) => job.blocked);
  const degradedJobs = jobStates.filter((job) => job.degraded);
  const operatorJobs = jobStates.filter((job) => job.needsOperator);
  const replayBlockedJobs = jobStates.filter((job) => job.replayWorkflowState === "blocked");
  const runtimeWorkflowBlockedJobs = jobStates.filter((job) => job.runtimeWorkflowState === "blocked");
  const recoveryRunbookBlockedJobs = jobStates.filter((job) => job.recoveryRunbookState === "blocked");
  const hasErrors = toArray(diagnostics).some((diagnostic) => diagnostic.level === "error");

  return Object.freeze({
    protocol: "aios.effects.lifecycle-control-plane.v1",
    state: hasErrors || blockedJobs.length > 0 || postureBlocked.length > 0
      ? "disabled"
      : degradedJobs.length > 0
        ? "preview-only"
        : operatorJobs.length > 0
          ? "waiting-for-operator"
          : "enabled",
    controls: Object.freeze({
      enableRuntime: !hasErrors && blockedJobs.length === 0 && postureBlocked.length === 0 && degradedJobs.length === 0 && operatorJobs.length === 0 && replayBlockedJobs.length === 0 && runtimeWorkflowBlockedJobs.length === 0 && recoveryRunbookBlockedJobs.length === 0,
      enablePreview: true,
      enableAdapterHandoff: analytics.exportReady === true && heldCapabilities.length === 0 && postureBlocked.length === 0 && blockedJobs.length === 0 && operatorJobs.length === 0 && replayBlockedJobs.length === 0 && runtimeWorkflowBlockedJobs.length === 0 && recoveryRunbookBlockedJobs.length === 0 && blockedScopeRows.length === 0 && staleScopeRows.length === 0,
      enableRetry: jobPlans.some((job) => job.analytics?.retryableSteps > 0) && heldCapabilities.length === 0 && leaseBlocked.length === 0 && postureBlocked.length === 0,
      requireOperatorGate: operatorJobs.length > 0,
      requireBoundaryResolution: heldCapabilities.length > 0 || blockedJobs.length > 0 || postureBlocked.length > 0,
      requirePermissionPostureRepair: postureBlocked.length > 0,
      requirePermissionGrant: postureGrantBlocked.length > 0,
      requirePermissionLeaseRefresh: leaseBlocked.length > 0 || postureLeaseBlocked.length > 0,
      requireTenantRuntimeIdentity: postureIdentityBlocked.length > 0,
      requireReplayRepair: jobPlans.some((job) => job.replayWorkflow?.state === "blocked"),
      requireRuntimeWorkflowRepair: runtimeWorkflowBlockedJobs.length > 0,
      requireTypedRecoveryRunbook: recoveryRunbookBlockedJobs.length > 0,
      requireScopeLineageRepair: blockedScopeRows.length > 0,
      requireScopeLineageRefresh: staleScopeRows.length > 0,
      requireSettingsRepair: settingsBlockedJobs.length > 0,
      requireSettingsPatch: settingsPatchJobs.length > 0,
      requireLifecycleCommandReceipt: lifecycleReceiptBlockedJobs.length > 0,
      requireMarketingConsent: marketingConsentBlockedJobs.length > 0,
      requireLifecycleGateRepair: lifecycleGateBlockedJobs.length > 0,
      requireLifecycleGateCommand: lifecycleGateGatedJobs.length > 0,
    }),
    permissionPosture: Object.freeze({
      state: postureBlocked.length > 0 ? "blocked" : toArray(analytics.timeline).length > 0 ? "covered" : "not-provided",
      blockedRows: freezeArray(postureBlocked.map((row) => ({
        jobName: compactString(row.jobName),
        action: compactString(row.action),
        state: compactString(row.permissionPostureState),
        fingerprint: compactString(row.permissionPostureFingerprint),
        nextCommand: compactString(row.permissionPostureNextCommand || "resolve_boundary_hold"),
      }))),
      counters: Object.freeze({
        blocked: postureBlocked.length,
        grantBlocked: postureGrantBlocked.length,
        leaseBlocked: postureLeaseBlocked.length,
        identityBlocked: postureIdentityBlocked.length,
      }),
    }),
    scopeLineage: Object.freeze({
      protocol: "aios.effects.lifecycle.scope-lineage.v1",
      state: blockedScopeRows.length > 0
        ? "blocked"
        : staleScopeRows.length > 0
          ? "stale"
        : toArray(scopeLineage.rows).length > 0
          ? "linked"
          : "not-provided",
      acceptedForExport: blockedScopeRows.length === 0 && staleScopeRows.length === 0,
      rows: scopeLineage.rows || freezeArray([]),
      blockedRows: freezeArray(blockedScopeRows),
      staleRows: freezeArray(staleScopeRows),
      historyRows: freezeArray(scopeHistoryRows),
      exportDestinations: freezeArray(scopeExportDestinations),
      nextCommand: blockedScopeRows[0]?.nextCommand
        || staleScopeRows[0]?.nextCommand
        || scopeLineage.nextCommand
        || "observe",
    }),
    nextAction: blockedScopeRows.length > 0
      ? Object.freeze({
        command: blockedScopeRows[0]?.nextCommand || "repair_scope_analytics_export",
        reason: "Effect export is waiting on scope analytics lineage rows to become exportable.",
        rows: freezeArray(blockedScopeRows),
      })
      : staleScopeRows.length > 0
      ? Object.freeze({
        command: staleScopeRows[0]?.nextCommand || "refresh_scope_analytics_snapshot",
        reason: "Effect export is waiting on fresh scope analytics history before provider handoff.",
        rows: freezeArray(staleScopeRows),
      })
      : postureIdentityBlocked.length > 0
      ? Object.freeze({
        command: postureIdentityBlocked[0]?.permissionPostureNextCommand || "attach_client_runtime_request",
        reason: "Mailchimp tenant permission posture has identity or workspace mismatches before effect handoff.",
        actions: freezeArray(postureIdentityBlocked.map((row) => row.action)),
      })
      : postureGrantBlocked.length > 0
      ? Object.freeze({
        command: postureGrantBlocked[0]?.permissionPostureNextCommand || "grant_mailchimp_permission",
        reason: "Mailchimp tenant permission posture is missing grants before effect handoff.",
        actions: freezeArray(postureGrantBlocked.map((row) => row.action)),
      })
      : postureLeaseBlocked.length > 0
      ? Object.freeze({
        command: postureLeaseBlocked[0]?.permissionPostureNextCommand || "refresh_mailchimp_permission_lease",
        reason: "Mailchimp tenant permission posture requires active workspace permission leases before effect handoff.",
        actions: freezeArray(postureLeaseBlocked.map((row) => row.action)),
      })
      : settingsBlockedJobs.length > 0
      ? Object.freeze({
        command: settingsBlockedJobs[0]?.providerServiceContract?.externalHandoff?.nextCommand || "repair_mailchimp_settings",
        reason: "Mailchimp provider settings must be repaired before adapter handoff.",
        jobs: freezeArray(settingsBlockedJobs.map((job) => job.jobName)),
      })
      : settingsPatchJobs.length > 0
      ? Object.freeze({
        command: settingsPatchJobs[0]?.providerServiceContract?.externalHandoff?.nextCommand || "apply_mailchimp_settings_patch",
        reason: "Mailchimp provider settings changes must be applied before adapter handoff.",
        jobs: freezeArray(settingsPatchJobs.map((job) => job.jobName)),
      })
      : lifecycleReceiptBlockedJobs.length > 0
      ? Object.freeze({
        command: toArray(lifecycleReceiptBlockedJobs[0]?.providerServiceContract?.externalHandoff?.errors)
          .find((error) => error.code === "aios.effects.provider_lifecycle_command_receipt_blocked")?.nextCommand
          || "attach_mailchimp_lifecycle_command_receipt",
        reason: "Mailchimp lifecycle override command receipts must be accepted before adapter handoff.",
        jobs: freezeArray(lifecycleReceiptBlockedJobs.map((job) => job.jobName)),
      })
      : marketingConsentBlockedJobs.length > 0
      ? Object.freeze({
        command: marketingConsentBlockedJobs[0]?.providerServiceContract?.externalHandoff?.nextCommand || "collect_marketing_consent",
        reason: "Mailchimp marketing consent must be collected or refreshed before adapter handoff.",
        jobs: freezeArray(marketingConsentBlockedJobs.map((job) => job.jobName)),
      })
      : lifecycleGateBlockedJobs.length > 0
      ? Object.freeze({
        command: lifecycleGateBlockedJobs[0]?.providerServiceContract?.externalHandoff?.nextCommand || "repair_mailchimp_lifecycle_controls",
        reason: "Mailchimp lifecycle controls must be repaired before adapter handoff.",
        jobs: freezeArray(lifecycleGateBlockedJobs.map((job) => job.jobName)),
      })
      : lifecycleGateGatedJobs.length > 0
      ? Object.freeze({
        command: lifecycleGateGatedJobs[0]?.providerServiceContract?.externalHandoff?.nextCommand || "queue_provider_schedule",
        reason: "Mailchimp lifecycle gates require a schedule or lifecycle command before handoff.",
        jobs: freezeArray(lifecycleGateGatedJobs.map((job) => job.jobName)),
      })
      : replayBlockedJobs.length > 0
      ? Object.freeze({
        command: "attach_recovery_status_handoff",
        reason: "Restart replay commands need persisted status state before adapter handoff.",
        jobs: freezeArray(replayBlockedJobs.map((job) => job.jobName)),
      })
      : runtimeWorkflowBlockedJobs.length > 0
      ? Object.freeze({
        command: jobPlans.find((job) => job.runtimeWorkflowAdoption?.state === "blocked")?.runtimeWorkflowAdoption?.nextStep?.command || "resolve_runtime_workflow_adoption",
        reason: "Runtime workflow adoption commands must be repaired before adapter handoff.",
        jobs: freezeArray(runtimeWorkflowBlockedJobs.map((job) => job.jobName)),
      })
      : recoveryRunbookBlockedJobs.length > 0
      ? Object.freeze({
        command: recoveryRunbookBlockedJobs[0]?.recoveryNextCommand || "resolve_typed_recovery_runbook",
        reason: "Typed recovery runbook has blocking commands before adapter handoff.",
        jobs: freezeArray(recoveryRunbookBlockedJobs.map((job) => job.jobName)),
      })
      : leaseBlocked.length > 0
      ? Object.freeze({
        command: "refresh_mailchimp_permission_lease",
        reason: "Mailchimp adapter handoff requires active workspace permission leases.",
        leases: freezeArray(leaseBlocked),
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
  const runtimeWorkflowAdoption = createRuntimeWorkflowAdoption(job, stepEffects, capabilityJob, providerServiceContract, replayWorkflow, replayEvidence);
  const typedRecoveryRunbook = createTypedRecoveryRunbook(job, stepEffects, typeJob, providerServiceContract, replayWorkflow, replayEvidence, runtimeWorkflowAdoption);

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

  for (const row of typedRecoveryRunbook.blockedRows) {
    if (diagnostics.some((diagnostic) => diagnostic.nextCommand === row.nextCommand && diagnostic.message === row.reason)) continue;
    diagnostics.push(Object.freeze({
      level: "error",
      code: "aios.effects.typed_recovery_command_blocked",
      message: row.reason,
      jobName: job.name,
      command: row.command,
      capability: row.capability,
      stepName: row.stepName,
      blockedBy: row.blockedBy,
      nextCommand: row.nextCommand,
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
    preview: createUserVisibleEffectPreview(job, stepEffects, diagnostics, providerServiceContract, providerPersistencePlan, replayWorkflow, runtimeWorkflowAdoption, typedRecoveryRunbook),
    providerServiceContract,
    providerPersistencePlan,
    replayWorkflow,
    replayEvidence,
    runtimeWorkflowAdoption,
    typedRecoveryRunbook,
    handoff: createEffectHandoff(job, stepEffects, approvalSteps, capabilityJob, providerServiceContract, providerPersistencePlan, replayWorkflow, runtimeWorkflowAdoption, typedRecoveryRunbook),
  });
}

export function createEffectHandoff(
  job = {},
  stepEffects = [],
  approvalSteps = [],
  capabilityJob = {},
  providerServiceContract = createProviderServiceContract(job, stepEffects, capabilityJob),
  providerPersistencePlan = createProviderPersistencePlan(job, capabilityJob, providerServiceContract),
  replayWorkflow = createReplayWorkflowContract(job, providerPersistencePlan, {}, providerServiceContract),
  runtimeWorkflowAdoption = createRuntimeWorkflowAdoption(job, stepEffects, capabilityJob, providerServiceContract, replayWorkflow, {}),
  typedRecoveryRunbook = createTypedRecoveryRunbook(job, stepEffects, {}, providerServiceContract, replayWorkflow, {}, runtimeWorkflowAdoption)
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
    acceptedForAdapter: runtimeWorkflowAdoption.acceptedForAdapter === true,
    providerServiceContract,
    runtimeWorkflowAdoption,
    typedRecoveryRunbook,
    health: createOperationalHealth(job, stepEffects, capabilityJob, typedRecoveryRunbook),
    recovery: Object.freeze({
      recoverable: true,
      nextCommand: typedRecoveryRunbook.state === "blocked"
        ? typedRecoveryRunbook.nextStep?.command || "resolve_typed_recovery_runbook"
        : runtimeWorkflowAdoption.state === "blocked"
        ? runtimeWorkflowAdoption.nextStep?.command || "resolve_runtime_workflow_adoption"
        : replayWorkflow.state === "blocked"
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
      staleProviderCheckpoints: providerPersistencePlan.recovery?.staleCheckpoints?.length ?? 0,
      replayWorkflowState: replayWorkflow.state || "not-required",
      replayCommands: replayWorkflow.commands?.length ?? 0,
      blockedReplayCommands: replayWorkflow.blockedCommands?.length ?? 0,
      runtimeWorkflowState: runtimeWorkflowAdoption.state || "not-required",
      runtimeWorkflowRows: runtimeWorkflowAdoption.counters?.rows ?? 0,
      runtimeWorkflowBlockedRows: runtimeWorkflowAdoption.counters?.blocked ?? 0,
      runtimeWorkflowReadyRows: runtimeWorkflowAdoption.counters?.ready ?? 0,
      previewRuntimeHandoffRows: runtimeWorkflowAdoption.counters?.previewRuntimeHandoffRows ?? 0,
      previewRuntimeHandoffBlockedRows: runtimeWorkflowAdoption.counters?.previewRuntimeHandoffBlocked ?? 0,
      previewRuntimeHandoffReadyRows: runtimeWorkflowAdoption.counters?.previewRuntimeHandoffReady ?? 0,
      typedRecoveryState: typedRecoveryRunbook.state || "not-required",
      typedRecoveryRows: typedRecoveryRunbook.counters?.rows ?? 0,
      typedRecoveryBlockedRows: typedRecoveryRunbook.counters?.blocked ?? 0,
      typedRecoveryReadyRows: typedRecoveryRunbook.counters?.ready ?? 0,
      syncCheckpointKeys: freezeArray([...new Set((providerPersistencePlan.checkpointSlots || []).map((slot) => slot.checkpointKey).filter(Boolean))]),
      syncWatermarkKeys: freezeArray([...new Set((providerPersistencePlan.checkpointSlots || []).map((slot) => slot.watermarkKey).filter(Boolean))]),
      staleSyncActions: freezeArray((providerPersistencePlan.recovery?.staleCheckpoints || []).map((slot) => slot.action).filter(Boolean)),
    }),
  });
}

export function createOperationalHealth(job = {}, stepEffects = [], capabilityJob = {}, typedRecoveryRunbook = {}) {
  const blocked = stepEffects.filter((effect) => effect.actionableErrors.length > 0);
  const degraded = stepEffects.filter((effect) => effect.health.degradedMode !== "none");
  const retryable = stepEffects.filter((effect) => effect.retryPolicy.maxAttempts > 0 && effect.retryPolicy.retryableStatuses.length > 0);
  return Object.freeze({
    protocol: "aios.effects.operational-health.v1",
    jobName: compactString(job.name || capabilityJob.jobName || "anonymous"),
    state: blocked.length > 0 ? "blocked" : degraded.length > 0 ? "degraded" : "healthy",
    acceptedForAdapter: blocked.length === 0 && degraded.length === 0,
    acceptedForRecovery: typedRecoveryRunbook.state !== "blocked",
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
    typedRecovery: Object.freeze({
      state: typedRecoveryRunbook.state || "not-required",
      nextCommand: typedRecoveryRunbook.nextStep?.command || "observe",
      blockedRows: typedRecoveryRunbook.blockedRows || freezeArray([]),
      readyRows: typedRecoveryRunbook.readyRows || freezeArray([]),
      counters: typedRecoveryRunbook.counters || Object.freeze({
        rows: 0,
        blocked: 0,
        ready: 0,
        waiting: 0,
      }),
    }),
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
  const adapterHandoffManifest = createEffectAdapterHandoffManifest(jobPlans, diagnostics);
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
    adapterHandoffManifest,
    lifecycleControlPlane,
    acceptanceReport,
    summary: summarizeAiosEffects(jobPlans, diagnostics),
  });
}

export function summarizeAiosEffects(jobPlans = [], diagnostics = []) {
  const effects = toArray(jobPlans).flatMap((job) => job.effects || []);
  const adapterHandoffManifest = createEffectAdapterHandoffManifest(jobPlans, diagnostics);
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
    permissionLeaseBlockedJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_permission_lease_blocked")).length,
    permissionLeaseRefreshRequired: toArray(jobPlans).reduce((count, job) => {
      return count + (job.providerServiceContract?.negotiation?.permissionLeaseBlocked ?? 0);
    }, 0),
    permissionPostureBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.permissionPostureBlocked ?? 0), 0),
    permissionPostureGrantBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.permissionPostureGrantBlocked ?? 0), 0),
    permissionPostureLeaseBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.permissionPostureLeaseBlocked ?? 0), 0),
    permissionPostureIdentityBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.permissionPostureIdentityBlocked ?? 0), 0),
    providerBudgetBlockedJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_budget_blocked")).length,
    providerBudgetBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerBudgetBlocked ?? 0), 0),
    providerBudgetThrottledCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerBudgetThrottled ?? 0), 0),
    providerCallbackBlockedJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_callback_blocked")).length,
    providerCallbackPendingJobs: toArray(jobPlans).filter((job) => (job.providerServiceContract?.negotiation?.providerCallbackPending ?? 0) > 0).length,
    providerCallbackBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerCallbackBlocked ?? 0), 0),
    providerCallbackPendingCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerCallbackPending ?? 0), 0),
    providerEventSubscriptionBlockedJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_event_subscription_blocked")).length,
    providerEventSubscriptionPendingJobs: toArray(jobPlans).filter((job) => (job.providerServiceContract?.negotiation?.providerEventSubscriptionPending ?? 0) > 0).length,
    providerEventSubscriptionBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerEventSubscriptionBlocked ?? 0), 0),
    providerEventSubscriptionPendingCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerEventSubscriptionPending ?? 0), 0),
    providerEventSubscriptionReadyCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerEventSubscriptionReady ?? 0), 0),
    providerServiceUnavailableJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_service_unavailable")).length,
    providerServiceUnavailableCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerServiceUnavailable ?? 0), 0),
    providerServiceDegradedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerServiceDegraded ?? 0), 0),
    providerExportBoundaryBlockedJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_export_boundary_blocked")).length,
    providerExportBoundaryBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerExportBoundaryBlocked ?? 0), 0),
    providerExportBoundaryRetryableCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerExportBoundaryRetryable ?? 0), 0),
    providerPublicationBlockedJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_publication_blocked")).length,
    providerPublicationBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerPublicationBlocked ?? 0), 0),
    providerPublicationReadyCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerPublicationReady ?? 0), 0),
    providerPublicationReceiptBlockedJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_publication_receipt_blocked")).length,
    providerPublicationReceiptPendingJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_publication_receipt_pending")).length,
    providerPublicationReceiptBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerPublicationReceiptBlocked ?? 0), 0),
    providerPublicationReceiptPendingCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerPublicationReceiptPending ?? 0), 0),
    providerPublicationReceiptAcceptedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.providerPublicationReceiptAccepted ?? 0), 0),
    settingsAdoptionBlockedJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_settings_blocked" || error.code === "aios.effects.provider_settings_disabled")).length,
    settingsAdoptionPatchJobs: toArray(jobPlans).filter((job) => (job.providerServiceContract?.negotiation?.settingsAdoptionPatchRequired ?? 0) > 0).length,
    settingsAdoptionBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.settingsAdoptionBlocked ?? 0), 0),
    settingsAdoptionPatchCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.settingsAdoptionPatchRequired ?? 0), 0),
    lifecycleGateBlockedJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_lifecycle_gate_blocked")).length,
    lifecycleGateBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.lifecycleGateBlocked ?? 0), 0),
    lifecycleGateGatedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.lifecycleGateGated ?? 0), 0),
    lifecycleCommandReceiptBlockedJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_lifecycle_command_receipt_blocked")).length,
    lifecycleCommandReceiptBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.lifecycleCommandReceiptBlocked ?? 0), 0),
    marketingConsentBlockedJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.provider_marketing_consent_blocked")).length,
    marketingConsentRequiredCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.marketingConsentRequired ?? 0), 0),
    marketingConsentBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.marketingConsentBlocked ?? 0), 0),
    marketingConsentExpiredCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.marketingConsentExpired ?? 0), 0),
    negotiatedProviderContracts: toArray(jobPlans).filter((job) => job.providerServiceContract?.state === "negotiated").length,
    restartSafeProviderPersistence: toArray(jobPlans).filter((job) => job.providerPersistencePlan?.state === "restart-safe").length,
    blockedProviderPersistence: toArray(jobPlans).filter((job) => job.providerPersistencePlan?.state === "blocked").length,
    providerSyncCheckpoints: toArray(jobPlans).reduce((count, job) => count + (job.providerPersistencePlan?.checkpointSlots?.length ?? 0), 0),
    segmentSyncReceiptBlockedJobs: toArray(jobPlans).filter((job) => toArray(job.providerServiceContract?.externalHandoff?.errors)
      .some((error) => error.code === "aios.effects.segment_sync_receipt_blocked")).length,
    segmentSyncReceiptBlockedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.segmentSyncReceiptBlocked ?? 0), 0),
    segmentSyncReceiptPendingCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.segmentSyncReceiptPending ?? 0), 0),
    segmentSyncReceiptAcceptedCapabilities: toArray(jobPlans).reduce((count, job) => count + (job.providerServiceContract?.negotiation?.segmentSyncReceiptAccepted ?? 0), 0),
    staleProviderCheckpoints: toArray(jobPlans).reduce((count, job) => count + (job.providerPersistencePlan?.recovery?.staleCheckpoints?.length ?? 0), 0),
    replayWorkflowRunnableJobs: toArray(jobPlans).filter((job) => job.replayWorkflow?.state === "runnable").length,
    replayWorkflowBlockedJobs: toArray(jobPlans).filter((job) => job.replayWorkflow?.state === "blocked").length,
    replayWorkflowCommands: toArray(jobPlans).reduce((count, job) => count + (job.replayWorkflow?.commands?.length ?? 0), 0),
    blockedReplayCommands: toArray(jobPlans).reduce((count, job) => count + (job.replayWorkflow?.blockedCommands?.length ?? 0), 0),
    clientCommandReceiptBlockedSteps: effects.filter((effect) => effect.status === "client-command-receipt-blocked").length,
    clientCommandReceiptSteps: effects.filter((effect) => effect.health?.clientWorkflow?.some?.((row) => row.clientCommandReceipt)).length,
    adapterHandoffReceiptBlockedSteps: effects.filter((effect) => effect.status === "adapter-handoff-receipt-blocked").length,
    adapterHandoffReceiptRows: effects.reduce((count, effect) => count + (effect.health?.adapterHandoffReceipts?.length ?? 0), 0),
    adapterHandoffReceiptAcceptedRows: effects.reduce((count, effect) => count + (effect.health?.adapterHandoffReceipts?.filter?.((row) => row.state === "accepted").length ?? 0), 0),
    runtimeWorkflowReadyJobs: toArray(jobPlans).filter((job) => job.runtimeWorkflowAdoption?.state === "ready").length,
    runtimeWorkflowBlockedJobs: toArray(jobPlans).filter((job) => job.runtimeWorkflowAdoption?.state === "blocked").length,
    runtimeWorkflowRows: toArray(jobPlans).reduce((count, job) => count + (job.runtimeWorkflowAdoption?.counters?.rows ?? 0), 0),
    blockedRuntimeWorkflowRows: toArray(jobPlans).reduce((count, job) => count + (job.runtimeWorkflowAdoption?.counters?.blocked ?? 0), 0),
    typedRecoveryReadyJobs: toArray(jobPlans).filter((job) => job.typedRecoveryRunbook?.state === "ready").length,
    typedRecoveryBlockedJobs: toArray(jobPlans).filter((job) => job.typedRecoveryRunbook?.state === "blocked").length,
    typedRecoveryRows: toArray(jobPlans).reduce((count, job) => count + (job.typedRecoveryRunbook?.counters?.rows ?? 0), 0),
    blockedTypedRecoveryRows: toArray(jobPlans).reduce((count, job) => count + (job.typedRecoveryRunbook?.counters?.blocked ?? 0), 0),
    readyTypedRecoveryRows: toArray(jobPlans).reduce((count, job) => count + (job.typedRecoveryRunbook?.counters?.ready ?? 0), 0),
    persistedRecoveryLedgerRows: toArray(jobPlans).reduce((count, job) => count + (job.typedRecoveryRunbook?.counters?.persistedLedgerRows ?? 0), 0),
    persistedRecoveryReplayableRows: toArray(jobPlans).reduce((count, job) => count + (job.typedRecoveryRunbook?.counters?.persistedLedgerReplayable ?? 0), 0),
    persistedRecoveryBlockedRows: toArray(jobPlans).reduce((count, job) => count + (job.typedRecoveryRunbook?.counters?.persistedLedgerBlocked ?? 0), 0),
    adapterHandoffQueueableRows: adapterHandoffManifest.counters.queueable,
    adapterHandoffBlockedRows: adapterHandoffManifest.counters.blocked,
    adapterStatusFailedSteps: effects.filter((effect) => effect.status === "adapter-status-failed").length,
    adapterStatusMissingSteps: effects.filter((effect) => effect.status === "adapter-status-missing").length,
    adapterStatusPendingSteps: effects.filter((effect) => effect.status === "adapter-status-pending").length,
    operationIdentityTrackedSteps: effects.filter((effect) => effect.health?.operationIdentities?.length > 0).length,
    operationIdentityBlockedSteps: effects.filter((effect) => effect.status === "operation-identity-blocked").length,
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
