import { analyzeMailchimpOwnership, findMailchimpOwnershipForOperation } from "./ownership-analysis.mjs";
import { analyzeMailchimpTruthBoundary } from "./truth-boundary-analysis.mjs";

function compactString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeApprovalState(state = {}) {
  const approvedBy = compactString(state.approvedBy || state.operator || state.user);
  const approvedAt = compactString(state.approvedAt || state.time || state.timestamp);
  const token = compactString(state.token || state.approvalToken);
  return {
    accepted: state.accepted === true || state.externalWrite === true || Boolean(approvedBy && approvedAt && token),
    externalWrite: state.externalWrite === true || state.accepted === true,
    approvedBy,
    approvedAt,
    token,
    reason: compactString(state.reason || state.message),
  };
}

function normalizeApprovalHistory(history = []) {
  const entries = Array.isArray(history) ? history : [];
  return entries.map((entry, index) => {
    const state = normalizeApprovalState(entry);
    return {
      index,
      operationId: compactString(entry.operationId || entry.operation || entry.id),
      event: compactString(entry.event || entry.type, state.accepted ? "approved" : "observed"),
      actor: compactString(entry.actor || entry.approvedBy || state.approvedBy, "unknown"),
      at: compactString(entry.at || entry.time || entry.timestamp || state.approvedAt),
      accepted: state.accepted,
      externalWrite: state.externalWrite,
      reason: compactString(entry.reason || state.reason),
      tokenPresent: Boolean(state.token),
    };
  });
}

function normalizeRuntimeHealth(runtime = {}) {
  const health = runtime.health || runtime.status || {};
  const retry = runtime.retry || health.retry || {};
  const failure = runtime.failure || health.failure || {};
  const attempt = Number.isFinite(Number(retry.attempt ?? runtime.attempt))
    ? Math.max(0, Number(retry.attempt ?? runtime.attempt))
    : 0;
  const maxAttempts = Number.isFinite(Number(retry.maxAttempts))
    ? Math.max(1, Number(retry.maxAttempts))
    : 3;
  const baseDelayMs = Number.isFinite(Number(retry.baseDelayMs))
    ? Math.max(250, Number(retry.baseDelayMs))
    : 1000;
  const nextDelayMs = Math.min(baseDelayMs * (2 ** attempt), 60000);
  const degraded = health.degraded === true || runtime.degraded === true || failure.mode === "degraded";
  const lastError = compactString(failure.message || health.lastError || runtime.lastError);

  return {
    state: compactString(health.state || runtime.state, degraded ? "degraded" : "healthy"),
    degraded,
    lastError,
    retry: {
      attempt,
      maxAttempts,
      nextDelayMs,
      exhausted: attempt >= maxAttempts,
      reason: compactString(retry.reason || failure.code || health.reason),
    },
    failure: {
      code: compactString(failure.code || health.code),
      actionable: compactString(failure.actionable || health.actionable),
      operationId: compactString(failure.operationId || health.operationId),
    },
  };
}

function normalizeApprovalSettings(settings = {}, options = {}) {
  const raw = settings.approval || settings.controls || settings;
  const mode = compactString(raw.mode || options.approvalMode, "manual");
  const enabled = raw.enabled !== false && options.enabled !== false;
  const autoDispatch = raw.autoDispatch === true || options.autoDispatch === true;
  const requireToken = raw.requireToken !== false;
  const allowedRoles = Array.isArray(raw.allowedRoles)
    ? raw.allowedRoles.map((role) => compactString(role)).filter(Boolean).sort()
    : ["operator", "admin"];
  const disabledOperations = new Set(Array.isArray(raw.disabledOperations) ? raw.disabledOperations.map((id) => compactString(id)).filter(Boolean) : []);
  const enabledOperations = new Set(Array.isArray(raw.enabledOperations) ? raw.enabledOperations.map((id) => compactString(id)).filter(Boolean) : []);
  const schedule = raw.schedule || {};
  const earliestAt = compactString(schedule.earliestAt || raw.earliestAt);
  const notAfter = compactString(schedule.notAfter || raw.notAfter);
  const maxDispatches = Number.isFinite(Number(raw.maxDispatches ?? schedule.maxDispatches))
    ? Math.max(0, Number(raw.maxDispatches ?? schedule.maxDispatches))
    : Infinity;
  const cooldownMs = Number.isFinite(Number(schedule.cooldownMs ?? raw.cooldownMs))
    ? Math.max(0, Number(schedule.cooldownMs ?? raw.cooldownMs))
    : 0;
  const validation = [];

  if (!["manual", "auto", "disabled"].includes(mode)) {
    validation.push({
      severity: "error",
      code: "approval.settings.mode_invalid",
      message: `Unsupported Mailchimp approval mode "${mode}".`,
      field: "runtime.settings.mode",
    });
  }
  if (allowedRoles.length === 0 && enabled) {
    validation.push({
      severity: "error",
      code: "approval.settings.roles_missing",
      message: "Mailchimp approval controls require at least one allowed operator role.",
      field: "runtime.settings.allowedRoles",
    });
  }
  if (mode === "auto" && requireToken) {
    validation.push({
      severity: "warning",
      code: "approval.settings.auto_requires_token",
      message: "Automatic Mailchimp dispatch still requires an approval token before external write handoff.",
      field: "runtime.settings.requireToken",
    });
  }
  if (earliestAt && notAfter && earliestAt > notAfter) {
    validation.push({
      severity: "error",
      code: "approval.settings.schedule_invalid",
      message: "Mailchimp approval schedule has earliestAt after notAfter.",
      field: "runtime.settings.schedule",
    });
  }

  return {
    mode,
    enabled: enabled && mode !== "disabled",
    autoDispatch: autoDispatch || mode === "auto",
    requireToken,
    allowedRoles,
    disabledOperations: [...disabledOperations].sort(),
    enabledOperations: [...enabledOperations].sort(),
    schedule: {
      earliestAt,
      notAfter,
      cooldownMs,
      maxDispatches: Number.isFinite(maxDispatches) ? maxDispatches : null,
    },
    validation,
    isOperationEnabled(operationId) {
      if (!enabled || mode === "disabled" || disabledOperations.has(operationId)) {
        return false;
      }
      return enabledOperations.size === 0 || enabledOperations.has(operationId);
    },
  };
}

function scheduleStateForGate(gate, settings, dispatchedCount = 0) {
  const operationEnabled = settings.isOperationEnabled(gate.operationId);
  const dispatchLimitReached = settings.schedule.maxDispatches !== null
    && dispatchedCount >= settings.schedule.maxDispatches;
  const scheduled = Boolean(settings.schedule.earliestAt || settings.schedule.notAfter || settings.schedule.cooldownMs);
  const blockedReason = !settings.enabled
    ? "approval-disabled"
    : !operationEnabled
      ? "operation-disabled"
      : dispatchLimitReached
        ? "dispatch-limit"
        : "";

  return {
    enabled: settings.enabled,
    operationEnabled,
    scheduled,
    earliestAt: settings.schedule.earliestAt,
    notAfter: settings.schedule.notAfter,
    cooldownMs: settings.schedule.cooldownMs,
    dispatchLimitReached,
    blockedReason,
    nextAction: blockedReason
      ? "update_approval_settings"
      : scheduled
        ? "schedule_approval_handoff"
        : "evaluate_approval_gate",
  };
}

function timelineStatusForGate(gate, runtimeHealth) {
  if (gate.status === "blocked") {
    return `blocked:${gate.blockedReason || "approval"}`;
  }
  if (runtimeHealth.retry.exhausted) {
    return "retry-exhausted";
  }
  if (runtimeHealth.degraded) {
    return "degraded";
  }
  return gate.status;
}

function buildApprovalTimeline(gates, history, runtimeHealth, settings) {
  const historyByOperation = new Map();
  for (const event of history) {
    const operationId = event.operationId || "*";
    const existing = historyByOperation.get(operationId) || [];
    existing.push(event);
    historyByOperation.set(operationId, existing);
  }

  const dispatchHistoryCount = history.filter((event) => event.event === "dispatched" || event.event === "approved").length;
  return gates.map((gate, index) => {
    const events = [
      ...(historyByOperation.get(gate.operationId) || []),
      ...(historyByOperation.get("*") || []),
    ].sort((left, right) => left.index - right.index);
    const lastEvent = events.at(-1) || null;
    const scheduleState = scheduleStateForGate(gate, settings, dispatchHistoryCount);
    return {
      index,
      operationId: gate.operationId,
      status: scheduleState.blockedReason
        ? `blocked:${scheduleState.blockedReason}`
        : timelineStatusForGate(gate, runtimeHealth),
      requiresApproval: gate.requiresApproval,
      blockedReason: gate.blockedReason || null,
      nextAction: gate.nextAction,
      requestId: gate.evidence.requestId,
      clientStatusPath: gate.evidence.clientStatusPath,
      auditCorrelationId: gate.evidence.auditCorrelationId,
      ownerId: gate.evidence.ownershipOwnerId,
      lastHistoryEvent: lastEvent
        ? {
          event: lastEvent.event,
          actor: lastEvent.actor,
          at: lastEvent.at,
          accepted: lastEvent.accepted,
          reason: lastEvent.reason,
        }
        : null,
      retry: {
        attempt: runtimeHealth.retry.attempt,
        maxAttempts: runtimeHealth.retry.maxAttempts,
        nextDelayMs: gate.status === "blocked" || runtimeHealth.degraded ? runtimeHealth.retry.nextDelayMs : 0,
      },
      schedule: scheduleState,
    };
  });
}

function summarizeApprovalAnalytics(gates, diagnostics, history, timeline, runtimeHealth) {
  const byStatus = gates.reduce((accumulator, gate) => {
    accumulator[gate.status] = (accumulator[gate.status] || 0) + 1;
    return accumulator;
  }, {});
  const byBlockedReason = gates.reduce((accumulator, gate) => {
    const reason = gate.blockedReason || "none";
    accumulator[reason] = (accumulator[reason] || 0) + 1;
    return accumulator;
  }, {});
  const historyAccepted = history.filter((event) => event.accepted).length;
  const exportableOperations = timeline.filter((event) => event.requestId && event.clientStatusPath).length;

  return {
    counters: {
      gateCount: gates.length,
      approvalRequired: gates.filter((gate) => gate.requiresApproval).length,
      dispatchable: gates.filter((gate) => gate.controls?.canDispatch === true).length,
      blocked: gates.filter((gate) => gate.status === "blocked").length,
      historyEvents: history.length,
      historyAccepted,
      diagnostics: diagnostics.length,
      retryable: timeline.filter((event) => event.retry.nextDelayMs > 0).length,
      exportableOperations,
      scheduled: timeline.filter((event) => event.schedule?.scheduled).length,
      settingsBlocked: timeline.filter((event) => event.schedule?.blockedReason).length,
    },
    byStatus,
    byBlockedReason,
    healthCounters: {
      degraded: runtimeHealth.degraded,
      retryAttempt: runtimeHealth.retry.attempt,
      retryExhausted: runtimeHealth.retry.exhausted,
      lastErrorPresent: Boolean(runtimeHealth.lastError),
    },
  };
}

function buildLifecycleCommandState(gates, timeline, settings, retryPlan) {
  const blockedBySettings = timeline.filter((event) => event.schedule?.blockedReason);
  const dispatchable = gates.filter((gate) => gate.controls?.canDispatch === true)
    .filter((gate) => !blockedBySettings.some((event) => event.operationId === gate.operationId));
  const command = blockedBySettings.length
    ? "update_settings"
    : retryPlan.status === "exhausted"
      ? "hold"
      : settings.autoDispatch && dispatchable.length
        ? "dispatch"
        : dispatchable.length
          ? "await_operator"
          : "hold";

  return {
    command,
    status: blockedBySettings.length
      ? "settings-blocked"
      : retryPlan.status === "exhausted"
        ? "retry-exhausted"
        : dispatchable.length
          ? settings.autoDispatch
            ? "dispatch-ready"
            : "operator-ready"
          : "waiting",
    operationIds: dispatchable.map((gate) => gate.operationId).sort(),
    blockedBySettings: blockedBySettings.map((event) => ({
      operationId: event.operationId,
      reason: event.schedule.blockedReason,
      nextAction: event.schedule.nextAction,
    })),
    settings: {
      mode: settings.mode,
      enabled: settings.enabled,
      autoDispatch: settings.autoDispatch,
      requireToken: settings.requireToken,
      allowedRoles: settings.allowedRoles,
      schedule: settings.schedule,
    },
    nextAction: blockedBySettings.length
      ? "update_approval_settings"
      : command === "dispatch"
        ? "dispatch_enabled_approval_gates"
        : command === "await_operator"
          ? "present_approval_actions_to_operator"
          : retryPlan.status === "exhausted"
            ? "surface_retry_exhaustion"
            : "wait_for_gate_readiness",
  };
}

function buildApprovalExportSummary(packageInfo, gates, analytics, timeline, retryPlan, lifecycleCommand) {
  const generatedKey = [
    packageInfo?.id || "mailchimp",
    gates.length,
    analytics.counters.blocked,
    retryPlan.status,
  ].join(":");

  return {
    format: "aios.mailchimp.approval.report.v1",
    generatedKey,
    packageId: packageInfo?.id || null,
    provider: "mailchimp",
    status: analytics.counters.blocked > 0
      ? "blocked"
      : retryPlan.status === "exhausted"
        ? "retry-exhausted"
        : "export-ready",
    counters: analytics.counters,
    lifecycle: {
      command: lifecycleCommand.command,
      status: lifecycleCommand.status,
      nextAction: lifecycleCommand.nextAction,
      operationIds: lifecycleCommand.operationIds,
    },
    operationRows: timeline.map((event) => ({
      operationId: event.operationId,
      status: event.status,
      requiresApproval: event.requiresApproval,
      nextAction: event.nextAction,
      requestId: event.requestId,
      clientStatusPath: event.clientStatusPath,
      auditCorrelationId: event.auditCorrelationId,
      ownerId: event.ownerId,
      retryAttempt: event.retry.attempt,
      retryDelayMs: event.retry.nextDelayMs,
      scheduleBlockedReason: event.schedule?.blockedReason || "",
      scheduledEarliestAt: event.schedule?.earliestAt || "",
    })),
    blockedOperationIds: timeline
      .filter((event) => event.blockedReason)
      .map((event) => event.operationId)
      .sort(),
  };
}

function buildApprovalExportManifest(packageInfo, analytics, history, timeline, providerContract, clientRuntimeAdoption, runtimeActionQueue) {
  const exportRows = timeline.map((event) => {
    const providerRow = (providerContract.capabilities || []).find((row) => row.operationId === event.operationId) || {};
    const adoptionRow = (clientRuntimeAdoption.rows || []).find((row) => row.operationId === event.operationId) || {};
    const actionRow = (runtimeActionQueue.rows || []).find((row) => row.operationId === event.operationId) || {};
    const providerConfirmation = providerRow.providerReadinessConfirmation || {};
    const providerConfirmationMissing = Array.isArray(providerConfirmation.missingFields)
      ? providerConfirmation.missingFields
      : [];
    const state = actionRow.action === "dispatch"
      ? "ready"
      : actionRow.action === "approve"
        ? "waiting_for_approval"
        : actionRow.action === "repair"
          ? "blocked"
          : actionRow.action === "poll"
            ? "degraded"
            : "waiting";

    return {
      operationId: event.operationId,
      state,
      approvalStatus: event.status,
      providerStatus: providerRow.status || "unknown",
      providerReadinessConfirmationStatus: providerConfirmation.status || "unknown",
      providerReadinessConfirmationAccepted: providerConfirmation.accepted === true,
      providerReadinessConfirmationRequired: providerConfirmation.required === true,
      providerReadinessConfirmationMissingFields: providerConfirmationMissing,
      providerReadinessConfirmationPatchId: providerConfirmation.statusPatch?.patchId || null,
      adoptionStatus: adoptionRow.status || "unknown",
      runtimeAction: actionRow.action || "observe",
      requestId: event.requestId || providerRow.requestId || adoptionRow.requestId || null,
      clientStatusPath: event.clientStatusPath || providerRow.clientStatusPath || adoptionRow.clientStatusPath || null,
      providerStatusPath: providerRow.providerStatusPath || adoptionRow.providerStatusPath || null,
      auditCorrelationId: event.auditCorrelationId || providerRow.auditId || null,
      ownerId: event.ownerId || providerRow.ownerId || null,
      retryDelayMs: event.retry?.nextDelayMs ?? actionRow.retryAfterMs ?? 0,
      scheduleBlockedReason: event.schedule?.blockedReason || "",
      providerConfirmationVisibleState: providerConfirmation.statusPatch?.visibleState || null,
      lastHistoryEvent: event.lastHistoryEvent,
      exportable: Boolean(
        (event.requestId || providerRow.requestId || adoptionRow.requestId)
        && (event.clientStatusPath || providerRow.clientStatusPath || adoptionRow.clientStatusPath),
      ),
      nextAction: providerConfirmation.required === true && providerConfirmation.accepted !== true
        ? providerConfirmation.nextAction || providerRow.nextAction || actionRow.nextAction || "wait_for_provider_confirmation_ack"
        : actionRow.nextAction || adoptionRow.nextAction || providerRow.nextAction || event.nextAction,
    };
  });
  const historySnapshots = history.map((event) => ({
    sequence: event.index,
    operationId: event.operationId || "*",
    event: event.event,
    actor: event.actor,
    at: event.at,
    accepted: event.accepted,
    externalWrite: event.externalWrite,
    tokenPresent: event.tokenPresent,
    reason: event.reason,
    digest: compactApprovalDigest({
      operationId: event.operationId || "*",
      event: event.event,
      actor: event.actor,
      at: event.at,
      accepted: event.accepted,
      tokenPresent: event.tokenPresent,
    }),
  }));
  const readyRows = exportRows.filter((row) => row.state === "ready");
  const blockedRows = exportRows.filter((row) => row.state === "blocked");
  const waitingRows = exportRows.filter((row) => row.state === "waiting" || row.state === "waiting_for_approval");
  const digest = compactApprovalDigest({
    packageId: packageInfo?.id || null,
    counters: analytics.counters,
    rows: exportRows.map((row) => ({
      operationId: row.operationId,
      state: row.state,
      requestId: row.requestId,
      clientStatusPath: row.clientStatusPath,
      nextAction: row.nextAction,
    })),
    history: historySnapshots.map((snapshot) => snapshot.digest),
  });

  return {
    format: "aios.mailchimp.approval.exportManifest.v1",
    packageId: packageInfo?.id || null,
    provider: "mailchimp",
    digest,
    status: blockedRows.length
      ? "blocked"
      : readyRows.length === exportRows.length
        ? "ready"
        : waitingRows.length
          ? "waiting"
          : "observing",
    counters: {
      operationCount: exportRows.length,
      readyCount: readyRows.length,
      blockedCount: blockedRows.length,
      waitingCount: waitingRows.length,
      exportableCount: exportRows.filter((row) => row.exportable).length,
      historySnapshotCount: historySnapshots.length,
      acceptedHistoryCount: historySnapshots.filter((snapshot) => snapshot.accepted).length,
      providerStatusLinkCount: exportRows.filter((row) => row.providerStatusPath).length,
      providerConfirmationRequiredCount: exportRows.filter((row) => row.providerReadinessConfirmationRequired).length,
      providerConfirmationAcceptedCount: exportRows.filter((row) => row.providerReadinessConfirmationAccepted).length,
      providerConfirmationMissingCount: exportRows.filter((row) => row.providerReadinessConfirmationMissingFields.length > 0).length,
      retryDelayCount: exportRows.filter((row) => row.retryDelayMs > 0).length,
    },
    rows: exportRows,
    historySnapshots,
    latestSnapshot: historySnapshots.at(-1) || null,
    nextAction: blockedRows[0]?.nextAction
      || waitingRows[0]?.nextAction
      || readyRows[0]?.nextAction
      || runtimeActionQueue.nextAction,
  };
}

function providerCapabilityRows(ownership, truth, gates, packageAcceptance = null) {
  const truthByOperation = new Map((truth?.operations || []).map((operation) => [operation.operationId, operation]));
  const gateByOperation = new Map((gates || []).map((gate) => [gate.operationId, gate]));
  const previewByOperation = new Map((truth?.preview?.rows || []).map((row) => [row.operationId, row]));
  const providerSyncByOperation = new Map((ownership?.providerSync?.rows || []).map((row) => [row.operationId, row]));
  const packageAcceptanceByOperation = new Map((packageAcceptance?.rows || []).map((row) => [row.operationId, row]));

  return (ownership?.owners || []).map((entry) => {
    const gate = gateByOperation.get(entry.operationId) || {};
    const truthOperation = truthByOperation.get(entry.operationId) || {};
    const preview = previewByOperation.get(entry.operationId) || {};
    const providerSync = providerSyncByOperation.get(entry.operationId) || {};
    const packageRow = packageAcceptanceByOperation.get(entry.operationId) || {};
    const truthProvider = truthOperation.providerService || {};
    const leasedCapabilities = (entry.capabilities || [])
      .filter((capability) => capability.leaseRequired)
      .map((capability) => capability.capability)
      .sort();
    const delegatedCapabilities = (entry.capabilities || [])
      .filter((capability) => !capability.leaseRequired)
      .map((capability) => capability.capability)
      .sort();
    const boundaryReady = entry.boundary?.status === "isolated"
      && truthOperation.boundaryScope?.accepted !== false;
    const auditReady = !gate.requiresApproval
      || gate.evidence?.auditHandoffStatus === "audit-ready"
      || Boolean(gate.evidence?.auditCorrelationId);
    const approvalReady = !gate.requiresApproval || gate.status === "approved";
    const lifecycleBlocked = String(providerSync.status || "").startsWith("lifecycle-")
      || preview.readiness === "lifecycle-blocked";
    const recoveryCheckpointBlocked = String(providerSync.status || "").startsWith("recovery-checkpoint-")
      || providerSync.recoveryCheckpointStatus === "blocked"
      || providerSync.recoveryCheckpointStatus === "operator-review";
    const providerReadinessBlocked = String(providerSync.status || "").startsWith("provider-readiness-blocked")
      || providerSync.status === "provider-readiness-status-patch-blocked"
      || providerSync.providerReadinessAccepted === false
      || providerSync.providerReadinessStatusPatch?.patchable === false;
    const providerReadinessPending = providerSync.status === "provider-readiness-pending"
      || providerSync.providerReadinessStatus === "pending"
      || (providerSync.providerReadinessConfirmation?.required === true
        && providerSync.providerReadinessConfirmation?.accepted !== true);
    const packageBlocked = packageRow.accepted === false
      || String(providerSync.status || "").startsWith("package-")
      || String(providerSync.status || "").startsWith("operational-incident-")
      || [
        "metadata-incomplete",
        "boundary-blocked",
        "adapter-failed",
        "validation-blocked",
      ].includes(packageRow.readiness)
      || String(packageRow.readiness || "").startsWith("lifecycle-");
    const previewAccepted = preview.accepted !== false;
    const providerMetadataReady = truthProvider.metadataReady !== false
      && Boolean(
        truthProvider.requestId
        || gate.evidence?.requestId
        || entry.gate?.runtimeState?.requestId,
      )
      && Boolean(
        truthProvider.clientStatusPath
        || gate.evidence?.clientStatusPath
        || entry.gate?.runtimeState?.clientStatusPath,
      );
    const providerTruthBlocked = truthProvider.acceptedForClient === false
      && !["read-contract-ready", "external-write-contract-ready"].includes(truthProvider.status);
    const capabilityStatus = lifecycleBlocked
      ? "lifecycle-blocked"
      : recoveryCheckpointBlocked
        ? "recovery-checkpoint-blocked"
      : providerReadinessBlocked
        ? "provider-readiness-blocked"
      : providerReadinessPending
        ? "provider-readiness-pending"
      : packageBlocked
        ? "package-acceptance-blocked"
      : !providerMetadataReady
        ? "metadata-incomplete"
        : providerTruthBlocked
          ? `provider-${truthProvider.status || "blocked"}`
      : !previewAccepted
        ? "preview-not-accepted"
        : !boundaryReady
      ? "boundary-blocked"
      : !auditReady
        ? "audit-missing"
        : !approvalReady
          ? "approval-required"
          : leasedCapabilities.length
            ? "lease-ready"
            : "delegated-ready";

    return {
      operationId: entry.operationId,
      ownerId: entry.owner?.id || null,
      boundaryKey: entry.boundary?.boundaryKey || truthOperation.boundaryScope?.boundaryKey || null,
      status: capabilityStatus,
      packageAcceptanceKey: packageAcceptance?.acceptanceKey || providerSync.packageAcceptanceKey || null,
      packageAcceptanceStatus: packageRow.readiness || providerSync.packageAcceptanceStatus || packageAcceptance?.status || "unknown",
      packageAcceptanceAccepted: packageBlocked ? false : packageRow.accepted !== false,
      providerReadinessHandoffKey: providerSync.providerReadinessHandoffKey || null,
      providerReadinessId: providerSync.providerReadinessId || null,
      providerReadinessStatus: providerSync.providerReadinessStatus || "unknown",
      providerReadinessAccepted: providerSync.providerReadinessAccepted === true,
      providerReadinessBlockedBy: providerSync.providerReadinessBlockedBy || [],
      providerReadinessPendingBy: providerSync.providerReadinessPendingBy || [],
      clientHandoffReceiptId: providerSync.clientHandoffReceiptId || null,
      clientHandoffReceiptState: providerSync.clientHandoffReceiptState || "unknown",
      clientHandoffReceiptAccepted: providerSync.clientHandoffReceiptAccepted === true,
      clientHandoffReceiptMatches: providerSync.clientHandoffReceiptMatches !== false,
      recoveryCheckpointPlanKey: providerSync.recoveryCheckpointPlanKey || null,
      recoveryCheckpointId: providerSync.recoveryCheckpointId || null,
      recoveryCheckpointStatus: providerSync.recoveryCheckpointStatus || "unknown",
      recoveryCheckpointReplaySafe: providerSync.recoveryCheckpointReplaySafe === true,
      recoveryCheckpointBlockedBy: providerSync.recoveryCheckpointBlockedBy || [],
      recoveryCheckpointPendingBy: providerSync.recoveryCheckpointPendingBy || [],
      previewAccepted,
      previewReadiness: preview.readiness || "unknown",
      lifecycleStatus: providerSync.lifecycleStatus || preview.lifecycleStatus || "unknown",
      providerTruthStatus: truthProvider.status || preview.providerStatus || "unknown",
      providerPackageSyncKey: truthProvider.packageSyncKey || preview.providerPackageSyncKey || null,
      leasedCapabilities,
      delegatedCapabilities,
      providerReadinessChecks: providerSync.providerReadinessChecks || {},
      providerReadinessConfirmation: providerSync.providerReadinessConfirmation || {
        required: false,
        accepted: true,
        observedState: null,
        observedAtPath: null,
        ackTokenPresent: false,
      },
      providerReadinessStatusPatch: {
        patchId: providerSync.providerReadinessStatusPatch?.patchId || null,
        patchable: providerSync.providerReadinessStatusPatch?.patchable === true,
        statusPath: providerSync.providerReadinessStatusPatch?.statusPath || null,
        providerStatusPath: providerSync.providerReadinessStatusPatch?.providerStatusPath || null,
        state: providerSync.providerReadinessStatusPatch?.state || "unknown",
        visibleState: providerSync.providerReadinessStatusPatch?.visibleState || null,
        blockedBy: providerSync.providerReadinessStatusPatch?.blockedBy || [],
        nextAction: providerSync.providerReadinessStatusPatch?.nextAction || null,
      },
      memoryKeys: (entry.memory || []).map((item) => item.key).sort(),
      requiredRoles: entry.boundary?.allowedRoles || [],
      observedRoles: entry.owner?.roles || [],
      requestId: truthProvider.requestId || gate.evidence?.requestId || entry.gate?.runtimeState?.requestId || null,
      clientStatusPath: truthProvider.clientStatusPath || gate.evidence?.clientStatusPath || entry.gate?.runtimeState?.clientStatusPath || null,
      providerStatusPath: truthProvider.providerStatusPath || preview.providerStatusPath || null,
      auditChannel: entry.auditHandoff?.auditChannel || entry.boundary?.auditChannel || null,
      auditId: entry.auditHandoff?.auditId || null,
      nextAction: capabilityStatus === "boundary-blocked"
        ? entry.boundary?.nextAction || "repair_provider_boundary"
        : capabilityStatus === "package-acceptance-blocked"
          ? packageRow.nextStep?.action || providerSync.packageAcceptanceNextAction || packageAcceptance?.nextAction || "repair_package_acceptance_preview"
        : capabilityStatus === "recovery-checkpoint-blocked"
          ? providerSync.nextAction || "repair_adapter_recovery_checkpoint"
        : capabilityStatus === "provider-readiness-blocked" || capabilityStatus === "provider-readiness-pending"
          ? providerSync.providerReadinessStatusPatch?.patchable === false
            ? providerSync.providerReadinessStatusPatch?.nextAction || "repair_provider_readiness_status_patch"
            : providerSync.providerReadinessConfirmation?.required === true && providerSync.providerReadinessConfirmation?.accepted !== true
              ? providerSync.nextAction || "wait_for_provider_readiness_confirmation"
              : providerSync.nextAction || "repair_provider_readiness_handoff"
        : capabilityStatus === "metadata-incomplete"
          ? "repair_provider_sync_metadata"
        : capabilityStatus === "lifecycle-blocked"
          ? providerSync.lifecycleNextAction || preview.lifecycleNextAction || "repair_lifecycle_visibility"
          : capabilityStatus.startsWith("provider-")
            ? truthProvider.nextAction || "repair_provider_contract"
          : capabilityStatus === "preview-not-accepted"
            ? preview.clientHandoff?.nextAction || "review_truth_boundary_preview"
        : capabilityStatus === "audit-missing"
          ? "attach_provider_audit_correlation"
          : capabilityStatus === "approval-required"
            ? "request_operator_approval"
            : leasedCapabilities.length
              ? "negotiate_external_write_lease"
              : "delegate_read_capability",
    };
  });
}

function normalizePermissionBoundaryHandoff(providerRow = {}, adoptionRow = {}, runtimeHealth = {}) {
  const packet = providerRow.permissionBoundary
    || providerRow.payload?.permissionBoundary
    || providerRow.boundaryPacket
    || {};
  const boundary = packet.boundary || {};
  const audit = packet.audit || {};
  const statusPatch = packet.statusPatch
    || providerRow.permissionStatusPatch
    || providerRow.payload?.permissionStatusPatch
    || {};
  const packetCommands = Array.isArray(packet.commands)
    ? packet.commands
    : Array.isArray(providerRow.permissionCommands)
      ? providerRow.permissionCommands
      : Array.isArray(providerRow.payload?.permissionCommands)
        ? providerRow.payload.permissionCommands
      : [];
  const requiredRoles = Array.isArray(boundary.requiredRoles)
    ? boundary.requiredRoles
    : Array.isArray(providerRow.requiredRoles)
      ? providerRow.requiredRoles
      : [];
  const observedRoles = Array.isArray(boundary.observedRoles)
    ? boundary.observedRoles
    : [];
  const missingRoles = requiredRoles
    .filter((role) => !observedRoles.includes(role))
    .sort();
  const packetBlockedBy = Array.isArray(packet.blockedBy) ? packet.blockedBy : [];
  const blockedBy = [
    ...packetBlockedBy.map((blocker) => `permission:${blocker}`),
    ...(packet.accepted === false ? ["permission:packet-not-accepted"] : []),
    ...(!packet.packetId && providerRow.leasedCapabilities?.length ? ["permission:packet-missing"] : []),
    ...(!boundary.boundaryKey && providerRow.leasedCapabilities?.length ? ["permission:boundary-key-missing"] : []),
    ...(statusPatch.patchable === false
      ? (statusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `permission-status:${blocker}`)
      : []),
    ...(providerRow.leasedCapabilities?.length && !statusPatch.statusPath ? ["permission-status:status-path-missing"] : []),
    ...(providerRow.leasedCapabilities?.length && !statusPatch.providerStatusPath ? ["permission-status:provider-status-path-missing"] : []),
    ...(missingRoles.map((role) => `permission:role:${role}:missing`)),
    ...(runtimeHealth.retry.exhausted ? ["permission:runtime-retry-exhausted"] : []),
  ].sort();
  const pendingBy = [
    ...(audit.required && !audit.auditId ? ["permission:audit-correlation-pending"] : []),
    ...(packet.status === "lease-audit-ready" && adoptionRow.status !== "adopted" ? ["permission:runtime-adoption-pending"] : []),
    ...(statusPatch.patchable === true && statusPatch.state === "lease_ready" && packet.status !== "accepted"
      ? ["permission-status:publish-pending"]
      : []),
  ].sort();
  const commandRows = packetCommands.map((command) => ({
    command: command.command || "unknown",
    enabled: command.enabled === true && blockedBy.length === 0,
    idempotencyKey: command.idempotencyKey || null,
    statusPath: command.statusPath || statusPatch.statusPath || null,
    patch: command.patch || null,
  }));

  return {
    packetId: packet.packetId || null,
    status: blockedBy.length
      ? "blocked"
      : pendingBy.length
        ? "pending"
        : packet.status || "accepted",
    accepted: blockedBy.length === 0 && pendingBy.length === 0 && packet.accepted !== false,
    restartSafe: packet.restartSafe !== false && blockedBy.length === 0,
    externalWrite: packet.externalWrite === true || Boolean(providerRow.leasedCapabilities?.length),
    blockedBy,
    pendingBy,
    boundary: {
      boundaryKey: boundary.boundaryKey || providerRow.boundaryKey || null,
      tenant: boundary.tenant || null,
      workspace: boundary.workspace || null,
      environment: boundary.environment || null,
      status: boundary.status || "unknown",
      statusPath: boundary.statusPath || null,
      requiredRoles,
      observedRoles,
      deniedRoles: boundary.deniedRoles || [],
    },
    statusPatch: {
      patchId: statusPatch.patchId || null,
      patchable: statusPatch.patchable === true && blockedBy.length === 0,
      statusPath: statusPatch.statusPath || null,
      providerStatusPath: statusPatch.providerStatusPath || null,
      state: statusPatch.state || "unknown",
      visibleState: statusPatch.visibleState || null,
      blockedBy: statusPatch.blockedBy || [],
      fields: statusPatch.fields || null,
      nextAction: statusPatch.nextAction || null,
    },
    audit: {
      auditId: audit.auditId || providerRow.auditId || null,
      auditChannel: audit.auditChannel || providerRow.auditChannel || null,
      status: audit.status || "unknown",
      required: audit.required === true || Boolean(providerRow.leasedCapabilities?.length),
    },
    commands: commandRows,
    enabledCommands: commandRows.filter((command) => command.enabled).map((command) => command.command),
    nextAction: blockedBy.length
      ? blockedBy[0] === "permission:packet-missing"
        ? "refresh_ownership_permission_boundary"
        : blockedBy[0].startsWith("permission-status:")
          ? statusPatch.nextAction || "repair_permission_status_patch"
        : blockedBy[0].includes(":role:")
          ? "assign_owner_with_required_role"
          : blockedBy[0].includes("tenant:")
            ? "repair_owner_tenant_scope"
            : "repair_permission_boundary"
      : pendingBy.length
        ? pendingBy[0] === "permission:audit-correlation-pending"
          ? "attach_provider_audit_correlation"
          : pendingBy[0].startsWith("permission-status:")
            ? statusPatch.nextAction || "publish_permission_boundary_status"
          : "complete_client_runtime_adoption"
        : "dispatch_mailchimp_external_handoff",
  };
}

function buildProviderServiceContract(ownership, truth, gates, runtimeHealth, settings, retryPlan, lifecycleCommand, packageAcceptance = null) {
  const capabilityRows = providerCapabilityRows(ownership, truth, gates, packageAcceptance);
  const ownershipEnvelope = ownership?.providerHandoffEnvelope || null;
  const envelopeByOperation = new Map((ownershipEnvelope?.rows || []).map((row) => [row.operationId, row]));
  const blockedRows = capabilityRows.filter((row) => (
    row.status === "boundary-blocked"
    || row.status === "lifecycle-blocked"
    || row.status === "package-acceptance-blocked"
    || row.status === "recovery-checkpoint-blocked"
    || row.status === "provider-readiness-blocked"
    || row.status === "provider-readiness-pending"
    || row.status === "preview-not-accepted"
    || row.status === "audit-missing"
    || row.status === "approval-required"
    || row.status === "metadata-incomplete"
    || row.status.startsWith("provider-")
  ));
  const leaseRows = capabilityRows.filter((row) => row.status === "lease-ready");
  const delegatedRows = capabilityRows.filter((row) => row.status === "delegated-ready");
  const missingStatusRows = capabilityRows.filter((row) => !row.requestId || !row.clientStatusPath);
  const serviceStatus = blockedRows.length
    ? "blocked"
    : missingStatusRows.length
      ? "metadata-incomplete"
      : runtimeHealth.retry.exhausted
        ? "retry-exhausted"
        : runtimeHealth.degraded
          ? "degraded"
          : leaseRows.length
            ? "lease-negotiation-ready"
            : "delegation-ready";
  const handoffAllowed = serviceStatus === "lease-negotiation-ready"
    || serviceStatus === "delegation-ready";
  const syncKey = [
    ownership?.package?.id || truth?.package?.id || "mailchimp",
    capabilityRows.length,
    blockedRows.length,
    leaseRows.length,
    retryPlan.status,
  ].join(":");

  return {
    format: "aios.mailchimp.providerContract.v1",
    provider: "mailchimp",
    service: "mailchimp-marketing",
    syncKey,
    status: serviceStatus,
    handoffAllowed,
    negotiatedAtPath: "runtime.providerSync.mailchimp.negotiatedAt",
    counters: {
      operations: capabilityRows.length,
      blocked: blockedRows.length,
      leaseReady: leaseRows.length,
      delegatedReady: delegatedRows.length,
      metadataIncomplete: missingStatusRows.length,
      lifecycleBlocked: capabilityRows.filter((row) => row.status === "lifecycle-blocked").length,
      packageAcceptanceBlocked: capabilityRows.filter((row) => row.status === "package-acceptance-blocked").length,
      recoveryCheckpointBlocked: capabilityRows.filter((row) => row.status === "recovery-checkpoint-blocked").length,
      providerReadinessBlocked: capabilityRows.filter((row) => row.status === "provider-readiness-blocked").length,
      providerReadinessPending: capabilityRows.filter((row) => row.status === "provider-readiness-pending").length,
      providerReadinessReady: capabilityRows.filter((row) => row.providerReadinessAccepted).length,
      providerBlocked: capabilityRows.filter((row) => row.status.startsWith("provider-")).length,
      previewBlocked: capabilityRows.filter((row) => row.status === "preview-not-accepted").length,
      retryable: retryPlan.retryableOperationIds.length,
      ownershipEnvelopeReady: (ownershipEnvelope?.rows || []).filter((row) => row.payloadReady).length,
      ownershipEnvelopeBlocked: (ownershipEnvelope?.rows || []).filter((row) => !row.payloadReady).length,
    },
    capabilities: capabilityRows,
    requirements: {
      approvalMode: settings.mode,
      approvalEnabled: settings.enabled,
      autoDispatch: settings.autoDispatch,
      requireToken: settings.requireToken,
      allowedApprovalRoles: settings.allowedRoles,
      providerStatusPollRequired: runtimeHealth.degraded || runtimeHealth.retry.exhausted,
      idempotencyRequired: capabilityRows.some((row) => row.leasedCapabilities.length > 0),
      auditCorrelationRequired: capabilityRows.some((row) => row.status === "audit-missing" || row.leasedCapabilities.length > 0),
    },
    sync: {
      state: handoffAllowed
        ? lifecycleCommand.command === "dispatch"
          ? "ready_for_provider_dispatch"
          : "ready_for_operator_release"
        : serviceStatus === "metadata-incomplete"
          ? "waiting_for_runtime_metadata"
          : serviceStatus === "degraded"
            ? "waiting_for_provider_health"
            : serviceStatus === "retry-exhausted"
              ? "operator_review_required"
              : "waiting_for_gate_repair",
      nextAction: handoffAllowed
        ? lifecycleCommand.nextAction
        : blockedRows[0]?.nextAction
          || (missingStatusRows.length ? "repair_provider_sync_metadata" : "surface_provider_contract_status"),
      retryAfterMs: runtimeHealth.degraded || retryPlan.status === "waiting"
        ? retryPlan.nextDelayMs
        : 0,
      operationIds: capabilityRows.map((row) => row.operationId).sort(),
      blockedOperationIds: blockedRows.map((row) => row.operationId).sort(),
    },
    externalHandoff: {
      payloadShape: {
        syncKey: "string",
        provider: "mailchimp",
        service: "mailchimp-marketing",
        operationId: "string",
        requestId: "string",
        clientStatusPath: "string",
        providerReadinessConfirmation: "object",
        providerConfirmationStatusPatch: "object|null",
        auditId: "string",
        leasedCapabilities: "array",
      },
      rows: capabilityRows
        .filter((row) => row.status === "lease-ready" || row.status === "delegated-ready")
        .map((row) => ({
          envelopeId: ownershipEnvelope?.envelopeId || null,
          operationId: row.operationId,
          ownerId: row.ownerId,
        providerReadinessId: row.providerReadinessId,
        providerReadinessStatus: row.providerReadinessStatus,
        providerReadinessConfirmation: row.providerReadinessConfirmation || {
          required: false,
          status: "not-required",
          accepted: true,
          missingFields: [],
        },
        providerConfirmationStatusPatch: row.providerReadinessConfirmation?.statusPatch || null,
        clientHandoffReceiptId: row.clientHandoffReceiptId || null,
        clientHandoffReceiptState: row.clientHandoffReceiptState || "unknown",
        clientHandoffReceiptAccepted: row.clientHandoffReceiptAccepted === true,
        clientHandoffReceiptMatches: row.clientHandoffReceiptMatches !== false,
          requestId: row.requestId,
        clientStatusPath: row.clientStatusPath,
        providerStatusPath: row.providerStatusPath,
        auditId: row.auditId,
        auditChannel: row.auditChannel,
        idempotencyKey: envelopeByOperation.get(row.operationId)?.idempotencyKey || null,
        replayToken: envelopeByOperation.get(row.operationId)?.replayToken || null,
        leasedCapabilities: row.leasedCapabilities,
        delegatedCapabilities: row.delegatedCapabilities,
        permissionBoundary: envelopeByOperation.get(row.operationId)?.permissionBoundary || null,
        clientHandoffReceiptId: row.clientHandoffReceiptId || null,
        clientHandoffReceiptState: row.clientHandoffReceiptState || "unknown",
        ownershipEnvelopeStatus: envelopeByOperation.get(row.operationId)?.status || "not-provided",
        payloadReady: envelopeByOperation.get(row.operationId)?.payloadReady !== false,
        payload: envelopeByOperation.get(row.operationId)?.payload || {
          provider: "mailchimp",
          service: "mailchimp-marketing",
          operationId: row.operationId,
          ownerId: row.ownerId,
          requestId: row.requestId,
          clientStatusPath: row.clientStatusPath,
          providerStatusPath: row.providerStatusPath,
          auditId: row.auditId,
          auditChannel: row.auditChannel,
          leaseCapabilities: row.leasedCapabilities,
          delegatedCapabilities: row.delegatedCapabilities,
          permissionBoundary: envelopeByOperation.get(row.operationId)?.permissionBoundary || null,
          providerReadinessConfirmation: row.providerReadinessConfirmation || null,
          providerConfirmationStatusPatch: row.providerReadinessConfirmation?.statusPatch || null,
        },
        lifecycleStatus: row.lifecycleStatus,
        packageAcceptanceStatus: row.packageAcceptanceStatus,
        packageAcceptanceKey: row.packageAcceptanceKey,
        providerReadinessHandoffKey: row.providerReadinessHandoffKey,
        providerReadinessAccepted: row.providerReadinessAccepted,
        providerReadinessConfirmationStatus: row.providerReadinessConfirmation?.status || "unknown",
        providerReadinessConfirmationAccepted: row.providerReadinessConfirmation?.accepted === true,
        providerReadinessConfirmationMissingFields: row.providerReadinessConfirmation?.missingFields || [],
        providerTruthStatus: row.providerTruthStatus,
        providerPackageSyncKey: row.providerPackageSyncKey,
        previewReadiness: row.previewReadiness,
        nextAction: row.nextAction,
      })),
    },
  };
}

function normalizePackageOperationalIncidentPreview(source = {}, runtimeActionQueue = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const ledger = packageAnalysis?.operationalIncidentLedger
    || packageAnalysis?.runtimeContract?.operationalIncidentLedger
    || source?.operationalIncidentLedger
    || source?.runtimeContract?.operationalIncidentLedger
    || null;
  const actionByOperation = new Map((runtimeActionQueue.rows || []).map((row) => [row.operationId, row]));

  if (!ledger?.ledgerKey) {
    return {
      format: "aios.mailchimp.approval.packageOperationalIncidentPreview.v1",
      present: false,
      ledgerKey: null,
      status: "not-provided",
      acceptedForDispatch: true,
      blockedBy: [],
      pendingBy: [],
      rows: [],
      counters: {
        operations: 0,
        blocked: 0,
        pending: 0,
        degraded: 0,
        retryable: 0,
        patchable: 0,
      },
      nextAction: runtimeActionQueue.nextAction || "wait_for_runtime_action_queue",
    };
  }

  const rows = (ledger.rows || []).map((row) => {
    const actionRow = actionByOperation.get(row.operationId) || {};
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `operational:${blocker}`)),
      ...(row.status === "blocked" ? ["operational:blocked"] : []),
      ...(row.statusPatch?.patchable === false
        ? (row.statusPatch.blockedBy || ["status-patch"]).map((blocker) => `operational-status:${blocker}`)
        : []),
      ...(actionRow.action === "repair" ? [`runtime-action:${actionRow.blockedReason || "repair"}`] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `operational:${pending}`)),
      ...(row.status === "pending" ? ["operational:pending"] : []),
      ...(row.status === "degraded" ? ["operational:degraded"] : []),
      ...(actionRow.action === "poll" ? ["runtime-action:poll"] : []),
    ].sort();
    const acceptedForDispatch = blockedBy.length === 0
      && pendingBy.length === 0
      && row.status !== "blocked"
      && row.status !== "pending";

    return {
      operationId: row.operationId,
      incidentId: row.incidentId || null,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? row.status === "degraded" ? "degraded" : "pending"
          : "clear",
      acceptedForDispatch,
      severity: row.severity || "info",
      retryable: row.retryable === true,
      retryAfterMs: row.retryAfterMs || actionRow.retryAfterMs || 0,
      requestId: row.requestId || actionRow.requestId || null,
      clientStatusPath: row.clientStatusPath || actionRow.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || actionRow.providerStatusPath || null,
      blockedBy,
      pendingBy,
      statusPatch: {
        patchId: row.statusPatch?.patchId || null,
        patchable: row.statusPatch?.patchable === true && blockedBy.length === 0,
        statusPath: row.statusPatch?.statusPath || row.clientStatusPath || null,
        providerStatusPath: row.statusPatch?.providerStatusPath || row.providerStatusPath || null,
        state: row.statusPatch?.state || "unknown",
        visibleState: row.statusPatch?.visibleState || null,
        blockedBy: row.statusPatch?.blockedBy || [],
        nextAction: row.statusPatch?.nextAction || null,
      },
      command: {
        command: row.command?.command || "publish-operational-handoff-status",
        enabled: row.command?.enabled === true && blockedBy.length === 0,
        idempotencyKey: row.command?.idempotencyKey || (row.incidentId ? `operational-incident:${row.incidentId}` : null),
        statusPath: row.command?.statusPath || row.clientStatusPath || null,
        providerStatusPath: row.command?.providerStatusPath || row.providerStatusPath || null,
      },
      nextAction: blockedBy.length
        ? row.nextAction || "repair_operational_incident_ledger"
        : pendingBy.length
          ? row.nextAction || "wait_for_operational_incident_ledger"
          : row.nextAction || "accept_operational_incident_ledger",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const degradedRows = rows.filter((row) => row.status === "degraded");

  return {
    format: "aios.mailchimp.approval.packageOperationalIncidentPreview.v1",
    present: true,
    ledgerKey: ledger.ledgerKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : degradedRows.length
          ? "degraded"
          : "clear",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0,
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set([...pendingRows, ...degradedRows].flatMap((row) => row.pendingBy))].sort(),
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      degraded: degradedRows.length,
      retryable: rows.filter((row) => row.retryable).length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || degradedRows[0]?.nextAction
      || ledger.nextAction
      || "accept_operational_incident_ledger",
  };
}

function normalizePackageProviderAckWorkflowPreview(source = {}, runtimeActionQueue = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const handoff = packageAnalysis?.providerDeliveryAckWorkflowHandoff
    || packageAnalysis?.runtimeContract?.providerDeliveryAckWorkflowHandoff
    || source?.providerDeliveryAckWorkflowHandoff
    || source?.runtimeContract?.providerDeliveryAckWorkflowHandoff
    || null;
  const actionByOperation = new Map((runtimeActionQueue.rows || []).map((row) => [row.operationId, row]));

  if (!handoff?.handoffKey) {
    return {
      format: "aios.mailchimp.approval.packageProviderAckWorkflowPreview.v1",
      present: false,
      handoffKey: null,
      ledgerKey: null,
      status: "not-provided",
      acceptedForDispatch: true,
      blockedBy: [],
      pendingBy: [],
      rows: [],
      counters: {
        operations: 0,
        required: 0,
        acknowledged: 0,
        blocked: 0,
        pending: 0,
        pollable: 0,
        patchable: 0,
        commandEnabled: 0,
        callbackReceiptObserved: 0,
        callbackReceiptAccepted: 0,
        callbackReceiptBlocked: 0,
      },
      commands: [],
      userVisibleSummary: "",
      nextAction: runtimeActionQueue.nextAction || "wait_for_runtime_action_queue",
    };
  }

  const rows = (handoff.rows || []).map((row) => {
    const actionRow = actionByOperation.get(row.operationId) || {};
    const callbackReceipt = row.callbackReceipt || row.observed?.callbackReceipt || {};
    const callbackReceiptAccepted = callbackReceipt.status === "accepted"
      || callbackReceipt.accepted === true;
    const callbackReceiptBlocked = callbackReceipt.status === "blocked";
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `provider-ack:${blocker}`)),
      ...(row.state === "blocked" ? ["provider-ack:blocked"] : []),
      ...(row.required && row.statusPatch?.patchable === false
        ? (row.statusPatch.blockedBy || ["status-patch"]).map((blocker) => `provider-ack-status:${blocker}`)
        : []),
      ...(callbackReceiptBlocked ? (callbackReceipt.blockedBy || ["callback-receipt"]).map((blocker) => `provider-callback:${blocker}`) : []),
      ...(actionRow.action === "repair" ? [`runtime-action:${actionRow.blockedReason || "repair"}`] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `provider-ack:${pending}`)),
      ...(["pending", "waiting"].includes(row.state) ? [`provider-ack:${row.state}`] : []),
      ...(row.required && row.replay?.safeToPoll === true && row.state !== "acknowledged" ? ["provider-ack:pollable"] : []),
      ...(actionRow.action === "poll" ? ["runtime-action:poll"] : []),
    ].sort();
    const acceptedForDispatch = row.acceptedForApproval === true
      && blockedBy.length === 0
      && pendingBy.length === 0;

    return {
      operationId: row.operationId,
      workflowId: row.workflowId || null,
      ackId: row.ackId || null,
      evidenceId: row.evidenceId || null,
      required: row.required === true,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : row.state || "ready",
      acceptedForDispatch,
      acceptedForTruthHandoff: row.acceptedForTruthHandoff === true,
      requestId: row.requestId || actionRow.requestId || null,
      idempotencyKeyPresent: Boolean(row.idempotencyKey || actionRow.idempotencyKey),
      clientStatusPath: row.clientStatusPath || actionRow.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || actionRow.providerStatusPath || null,
      expectedAckPath: row.expectedAckPath || null,
      callbackReceipt: {
        present: callbackReceipt.present === true,
        status: callbackReceipt.status || "unknown",
        accepted: callbackReceiptAccepted,
        metadataMatches: callbackReceipt.metadataMatches === true,
        event: callbackReceipt.event || null,
        providerDeliveryId: callbackReceipt.providerDeliveryId || null,
        requestId: callbackReceipt.requestId || null,
        idempotencyKeyPresent: Boolean(callbackReceipt.idempotencyKey),
        providerStatusPath: callbackReceipt.providerStatusPath || null,
        externalProviderHandoffEntryId: callbackReceipt.externalProviderHandoffEntryId || null,
        receivedAt: callbackReceipt.receivedAt || null,
        statusPatchId: callbackReceipt.statusPatchId || null,
        blockedBy: callbackReceipt.blockedBy || [],
        missingFields: callbackReceipt.missingFields || [],
        nextAction: callbackReceipt.nextAction || null,
      },
      blockedBy,
      pendingBy,
      replay: {
        safeToPoll: row.replay?.safeToPoll === true,
        dedupeKey: row.replay?.dedupeKey || row.command?.idempotencyKey || null,
        providerStatusPath: row.replay?.providerStatusPath || row.providerStatusPath || null,
        expectedAckPath: row.replay?.expectedAckPath || row.expectedAckPath || null,
      },
      statusPatch: {
        patchId: row.statusPatch?.patchId || null,
        patchable: row.statusPatch?.patchable === true && blockedBy.length === 0,
        statusPath: row.statusPatch?.statusPath || row.clientStatusPath || null,
        providerStatusPath: row.statusPatch?.providerStatusPath || row.providerStatusPath || null,
        state: row.statusPatch?.state || row.state || "unknown",
        visibleState: row.statusPatch?.visibleState || null,
        blockedBy: row.statusPatch?.blockedBy || [],
        nextAction: row.statusPatch?.nextAction || null,
      },
      command: {
        command: row.command?.command || (row.required ? "poll-mailchimp-provider-ack-workflow" : "publish-mailchimp-provider-ack-workflow"),
        enabled: row.command?.enabled === true && blockedBy.length === 0,
        idempotencyKey: row.command?.idempotencyKey || row.replay?.dedupeKey || null,
        statusPath: row.command?.statusPath || row.clientStatusPath || null,
        providerStatusPath: row.command?.providerStatusPath || row.providerStatusPath || null,
        ackPath: row.command?.ackPath || row.expectedAckPath || null,
        statusPatchId: row.command?.statusPatchId || row.statusPatch?.patchId || null,
      },
      nextAction: blockedBy.length
        ? row.nextAction || "repair_provider_ack_workflow"
        : callbackReceiptBlocked
          ? callbackReceipt.nextAction || "repair_provider_callback_receipt"
        : pendingBy.length
          ? row.nextAction || "poll_provider_ack_workflow"
          : row.required && callbackReceiptAccepted
            ? "dispatch_with_provider_callback_receipt"
          : row.nextAction || "accept_provider_ack_workflow",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");

  return {
    format: "aios.mailchimp.approval.packageProviderAckWorkflowPreview.v1",
    present: true,
    handoffKey: handoff.handoffKey,
    ledgerKey: handoff.ledgerKey || null,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "ready",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.acceptedForDispatch),
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    rows,
    counters: {
      operations: rows.length,
      required: rows.filter((row) => row.required).length,
      acknowledged: rows.filter((row) => row.status === "acknowledged" || row.status === "not-required").length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      pollable: rows.filter((row) => row.replay.safeToPoll).length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      commandEnabled: rows.filter((row) => row.command.enabled).length,
      callbackReceiptObserved: rows.filter((row) => row.callbackReceipt.present).length,
      callbackReceiptAccepted: rows.filter((row) => row.callbackReceipt.accepted).length,
      callbackReceiptBlocked: rows.filter((row) => row.callbackReceipt.status === "blocked").length,
    },
    commands: rows.map((row) => row.command),
    userVisibleSummary: handoff.userVisibleSummary || "",
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || handoff.nextAction
      || "accept_provider_ack_workflow",
  };
}

function normalizePackageAcceptanceAcknowledgementPreview(source = {}, runtimeActionQueue = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const control = packageAnalysis?.acceptanceAcknowledgementControl
    || packageAnalysis?.runtimeContract?.acceptanceAcknowledgementControl
    || source?.acceptanceAcknowledgementControl
    || source?.runtimeContract?.acceptanceAcknowledgementControl
    || null;
  const actionByOperation = new Map((runtimeActionQueue.rows || []).map((row) => [row.operationId, row]));

  if (!control?.acknowledgementKey) {
    return {
      format: "aios.mailchimp.approval.packageAcceptanceAcknowledgementPreview.v1",
      present: false,
      acknowledgementKey: null,
      acceptanceKey: null,
      status: "not-provided",
      acceptedForDispatch: true,
      blockedBy: [],
      pendingBy: [],
      rows: [],
      counters: {
        operations: 0,
        blocked: 0,
        pending: 0,
        required: 0,
        commandEnabled: 0,
        patchable: 0,
      },
      commands: [],
      userVisibleSummary: "Package acceptance acknowledgement controls are not provided.",
      nextAction: runtimeActionQueue.nextAction || "wait_for_runtime_action_queue",
    };
  }

  const rows = (control.rows || []).map((row) => {
    const actionRow = actionByOperation.get(row.operationId) || {};
    const enabledCommands = (row.commands || []).filter((command) => command.enabled === true);
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `acceptance-ack:${blocker}`)),
      ...(row.status === "blocked" ? ["acceptance-ack:blocked"] : []),
      ...(row.acceptedForApproval === false && row.required === true && row.status !== "blocked"
        ? ["acceptance-ack:not-approval-ready"]
        : []),
      ...(row.statusPatch?.patchable === false
        ? (row.statusPatch.blockedBy || ["status-patch"]).map((blocker) => `acceptance-ack-status:${blocker}`)
        : []),
      ...(actionRow.action === "repair" ? [`runtime-action:${actionRow.blockedReason || "repair"}`] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `acceptance-ack:${pending}`)),
      ...(row.required === true && enabledCommands.length > 0 ? ["acceptance-ack:publish-pending"] : []),
      ...(actionRow.action === "approve" ? ["runtime-action:approval"] : []),
    ].sort();
    const acceptedForDispatch = blockedBy.length === 0
      && (row.required !== true || row.acceptedForApproval === true)
      && row.status !== "blocked";

    return {
      operationId: row.operationId,
      acknowledgementId: row.acknowledgementId || null,
      acceptanceKey: row.acceptanceKey || control.acceptanceKey || null,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : "accepted",
      required: row.required === true,
      acceptedForDispatch,
      readiness: row.readiness || "unknown",
      operatorVisible: row.operatorVisible === true,
      externalWrite: row.externalWrite === true,
      requestId: row.request?.requestId || actionRow.requestId || null,
      clientStatusPath: row.client?.statusPath || actionRow.clientStatusPath || null,
      providerStatusPath: row.client?.providerStatusPath || actionRow.providerStatusPath || null,
      blockedBy,
      pendingBy,
      statusPatch: {
        patchId: row.statusPatch?.patchId || null,
        patchable: row.statusPatch?.patchable === true && blockedBy.length === 0,
        statusPath: row.statusPatch?.statusPath || row.client?.statusPath || null,
        providerStatusPath: row.statusPatch?.providerStatusPath || row.client?.providerStatusPath || null,
        state: row.statusPatch?.state || "unknown",
        visibleState: row.statusPatch?.visibleState || null,
        blockedBy: row.statusPatch?.blockedBy || [],
        pendingBy: row.statusPatch?.pendingBy || [],
        nextAction: row.statusPatch?.nextAction || null,
      },
      commands: (row.commands || []).map((command) => ({
        command: command.command || "acknowledge-package-acceptance-preview",
        enabled: command.enabled === true && blockedBy.length === 0,
        idempotencyKey: command.idempotencyKey || row.acknowledgementId || null,
        statusPath: command.statusPath || row.client?.statusPath || null,
        providerStatusPath: command.providerStatusPath || row.client?.providerStatusPath || null,
      })),
      nextAction: blockedBy.length
        ? row.nextAction || "repair_package_acceptance_acknowledgement"
        : pendingBy.length
          ? row.nextAction || "publish_package_acceptance_acknowledgement"
          : row.nextAction || "accept_package_acceptance_acknowledgement",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const requiredRows = rows.filter((row) => row.required);
  const commands = rows.flatMap((row) => row.commands).filter((command) => command.enabled);

  return {
    format: "aios.mailchimp.approval.packageAcceptanceAcknowledgementPreview.v1",
    present: true,
    acknowledgementKey: control.acknowledgementKey,
    acceptanceKey: control.acceptanceKey || null,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "accepted",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0,
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      required: requiredRows.length,
      commandEnabled: commands.length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
    },
    commands,
    userVisibleSummary: blockedRows.length
      ? `${blockedRows.length} Mailchimp package acceptance acknowledgement row(s) need repair before dispatch.`
      : pendingRows.length
        ? `${pendingRows.length} Mailchimp package acceptance acknowledgement row(s) are waiting for publication.`
        : "Mailchimp package acceptance acknowledgements are ready for dispatch.",
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || control.nextAction
      || "accept_package_acceptance_acknowledgement",
  };
}

function buildApprovalExternalHandoffState(providerContract, clientRuntimeAdoption, runtimeActionQueue, exportManifest, runtimeHealth, packageOperatorHandoffPreview = {}, packagePermissionBoundaryPreview = {}, packageExportReadinessPreview = {}, packageExportAuditPreview = {}, packageExportHistoryPreview = {}, packageOperationalIncidentPreview = {}, packagePreviewAcceptanceSummary = {}) {
  const adoptionByOperation = new Map((clientRuntimeAdoption.rows || []).map((row) => [row.operationId, row]));
  const actionByOperation = new Map((runtimeActionQueue.rows || []).map((row) => [row.operationId, row]));
  const manifestByOperation = new Map((exportManifest.rows || []).map((row) => [row.operationId, row]));
  const operatorPacketByOperation = new Map((packageOperatorHandoffPreview.rows || []).map((row) => [row.operationId, row]));
  const packagePermissionByOperation = new Map((packagePermissionBoundaryPreview.rows || []).map((row) => [row.operationId, row]));
  const packageExportByOperation = new Map((packageExportReadinessPreview.rows || []).map((row) => [row.operationId, row]));
  const packageAuditByOperation = new Map((packageExportAuditPreview.rows || []).map((row) => [row.operationId, row]));
  const packageHistoryByOperation = new Map((packageExportHistoryPreview.rows || []).map((row) => [row.operationId, row]));
  const packageIncidentByOperation = new Map((packageOperationalIncidentPreview.rows || []).map((row) => [row.operationId, row]));
  const packagePreviewAcceptanceByOperation = new Map((packagePreviewAcceptanceSummary.rows || []).map((row) => [row.operationId, row]));
  const rows = (providerContract.externalHandoff?.rows || []).map((providerRow) => {
    const adoptionRow = adoptionByOperation.get(providerRow.operationId) || {};
    const actionRow = actionByOperation.get(providerRow.operationId) || {};
    const manifestRow = manifestByOperation.get(providerRow.operationId) || {};
    const operatorPacketRow = operatorPacketByOperation.get(providerRow.operationId) || {};
    const packagePermissionRow = packagePermissionByOperation.get(providerRow.operationId) || {};
    const packageExportRow = packageExportByOperation.get(providerRow.operationId) || {};
    const packageAuditRow = packageAuditByOperation.get(providerRow.operationId) || {};
    const packageHistoryRow = packageHistoryByOperation.get(providerRow.operationId) || {};
    const packageIncidentRow = packageIncidentByOperation.get(providerRow.operationId) || {};
    const packagePreviewAcceptanceRow = packagePreviewAcceptanceByOperation.get(providerRow.operationId) || {};
    const permissionBoundary = normalizePermissionBoundaryHandoff(providerRow, adoptionRow, runtimeHealth);
    const confirmationPatch = providerRow.providerReadinessConfirmation?.statusPatch || {};
    const providerConfirmationObservation = providerRow.providerReadinessConfirmation?.observedProvider || {};
    const providerConfirmationFailed = providerRow.providerReadinessConfirmation?.status === "provider-failed"
      || providerConfirmationObservation.unavailable === true;
    const providerConfirmationDegraded = providerRow.providerReadinessConfirmation?.status === "provider-degraded"
      || providerConfirmationObservation.degraded === true;
    const blockedBy = [
      ...(providerRow.payloadReady === false ? ["ownership-envelope:payload-not-ready"] : []),
      ...(operatorPacketRow.status === "blocked" || operatorPacketRow.acceptedForOperator === false ? ["operator-handoff:blocked"] : []),
      ...((operatorPacketRow.blockedBy || []).map((blocker) => `operator-handoff:${blocker}`)),
      ...permissionBoundary.blockedBy,
      ...(packageExportRow.status === "blocked" || packageExportRow.status === "metadata-incomplete" ? ["package-export:blocked"] : []),
      ...((packageExportRow.blockedBy || []).map((blocker) => `package-export:${blocker}`)),
      ...(packageAuditRow.status === "blocked" ? ["package-export-audit:blocked"] : []),
      ...((packageAuditRow.blockedBy || []).map((blocker) => `package-export-audit:${blocker}`)),
      ...(packageHistoryRow.status === "blocked" || packageHistoryRow.status === "metadata-incomplete" ? ["package-export-history:blocked"] : []),
      ...((packageHistoryRow.blockedBy || []).map((blocker) => `package-export-history:${blocker}`)),
      ...(packageIncidentRow.status === "blocked" ? ["package-operational:blocked"] : []),
      ...((packageIncidentRow.blockedBy || []).map((blocker) => `package-operational:${blocker}`)),
      ...(packagePreviewAcceptanceRow.readiness === "blocked" || packagePreviewAcceptanceRow.acceptedForApproval === false
        ? ["package-preview-acceptance:blocked"]
        : []),
      ...((packagePreviewAcceptanceRow.blockedBy || []).map((blocker) => `package-preview-acceptance:${blocker}`)),
      ...(packagePreviewAcceptanceRow.statusPatch?.patchable === false
        ? (packagePreviewAcceptanceRow.statusPatch.blockedBy || ["status-patch"]).map((blocker) => `package-preview-acceptance-status:${blocker}`)
        : []),
      ...(packagePermissionRow.status === "blocked" ? ["package-permission:blocked"] : []),
      ...(packagePermissionRow.statusPatch?.patchable === false ? ["package-permission-status:blocked"] : []),
      ...((packagePermissionRow.blockedBy || []).map((blocker) => `package-${blocker}`)),
      ...(providerRow.providerReadinessAccepted === false ? [`provider-readiness:${providerRow.providerReadinessStatus || "blocked"}`] : []),
      ...((providerRow.providerReadinessBlockedBy || []).map((blocker) => `provider-readiness:${blocker}`)),
      ...(providerRow.providerReadinessStatusPatch?.patchable === false
        ? (providerRow.providerReadinessStatusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `provider-readiness-status:${blocker}`)
        : []),
      ...(providerRow.providerReadinessConfirmation?.status === "metadata-incomplete"
        ? (providerRow.providerReadinessConfirmation.missingFields || ["metadata"]).map((field) => `provider-readiness-confirmation:${field}`)
        : []),
      ...(providerConfirmationFailed
        ? (providerRow.providerReadinessConfirmation?.blockedBy || ["provider-failed"]).map((blocker) => `provider-readiness-confirmation:${blocker}`)
        : []),
      ...(providerRow.providerReadinessConfirmation?.statusPatch?.patchable === false
        ? (providerRow.providerReadinessConfirmation.statusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `provider-readiness-confirmation-status:${blocker}`)
        : []),
      ...(providerRow.clientHandoffReceiptAccepted === false ? ["receipt:not-accepted"] : []),
      ...(providerRow.clientHandoffReceiptMatches === false ? ["receipt:mismatch"] : []),
      ...(adoptionRow.status === "blocked" || adoptionRow.blockedReason ? [`adoption:${adoptionRow.blockedReason || "blocked"}`] : []),
      ...(adoptionRow.clientHandoffReceiptAccepted === false ? ["receipt:adoption-not-accepted"] : []),
      ...(adoptionRow.clientHandoffReceiptMatches === false ? ["receipt:adoption-mismatch"] : []),
      ...(actionRow.action === "repair" ? [`runtime-action:${actionRow.blockedReason || "repair-required"}`] : []),
      ...(manifestRow.exportable === false ? ["export:status-metadata-missing"] : []),
      ...(runtimeHealth.retry.exhausted ? ["runtime:retry-exhausted"] : []),
    ].sort();
    const pendingBy = [
      ...(operatorPacketRow.status === "pending" ? ["operator-handoff:pending"] : []),
      ...((operatorPacketRow.pendingBy || []).map((pending) => `operator-handoff:${pending}`)),
      ...permissionBoundary.pendingBy,
      ...(packageExportRow.status === "pending" ? ["package-export:pending"] : []),
      ...((packageExportRow.pendingBy || []).map((pending) => `package-export:${pending}`)),
      ...(packageAuditRow.status === "pending" ? ["package-export-audit:pending"] : []),
      ...((packageAuditRow.pendingBy || []).map((pending) => `package-export-audit:${pending}`)),
      ...(packageHistoryRow.status === "pending" ? ["package-export-history:pending"] : []),
      ...((packageHistoryRow.pendingBy || []).map((pending) => `package-export-history:${pending}`)),
      ...(packageIncidentRow.status === "pending" || packageIncidentRow.status === "degraded" ? [`package-operational:${packageIncidentRow.status}`] : []),
      ...((packageIncidentRow.pendingBy || []).map((pending) => `package-operational:${pending}`)),
      ...(packagePreviewAcceptanceRow.readiness === "pending" ? ["package-preview-acceptance:pending"] : []),
      ...((packagePreviewAcceptanceRow.pendingBy || []).map((pending) => `package-preview-acceptance:${pending}`)),
      ...(packagePermissionRow.status === "pending" ? ["package-permission:pending"] : []),
      ...((packagePermissionRow.pendingBy || []).map((pending) => `package-${pending}`)),
      ...((providerRow.providerReadinessPendingBy || []).map((pending) => `provider-readiness:${pending}`)),
      ...(providerRow.providerReadinessConfirmation?.required === true
        && providerRow.providerReadinessConfirmation.accepted !== true
        && providerRow.providerReadinessConfirmation.status !== "metadata-incomplete"
        ? (providerRow.providerReadinessConfirmation.missingFields || [providerRow.providerReadinessConfirmation.observedState || "pending"])
          .map((pending) => `provider-readiness-confirmation:${pending}`)
        : []),
      ...(providerConfirmationDegraded && !providerConfirmationFailed
        ? (providerRow.providerReadinessConfirmation?.pendingBy || ["provider-degraded"]).map((pending) => `provider-readiness-confirmation:${pending}`)
        : []),
      ...(actionRow.action === "approve" ? ["approval:operator-required"] : []),
      ...(actionRow.action === "poll" ? ["provider:health-poll"] : []),
      ...(runtimeHealth.degraded && actionRow.action !== "poll" ? ["runtime:degraded"] : []),
    ].sort();
    const dispatchReady = blockedBy.length === 0
      && pendingBy.length === 0
      && actionRow.action === "dispatch"
      && providerContract.handoffAllowed === true;
    const permissionStatusCommand = permissionBoundary.commands
      .find((command) => command.command === "publish-permission-boundary-status")
      || null;
    const providerConfirmationStatusCommand = confirmationPatch.patchable === true
      ? {
        command: "publish-provider-confirmation-status",
        enabled: blockedBy.length === 0 && !providerConfirmationFailed,
        idempotencyKey: `provider-confirmation:${providerRow.providerReadinessConfirmation?.confirmationId || providerRow.providerReadinessId || providerRow.operationId}`,
        statusPath: confirmationPatch.statusPath || providerRow.clientStatusPath || null,
        providerStatusPath: confirmationPatch.providerStatusPath || providerRow.providerStatusPath || null,
        patch: confirmationPatch.fields || null,
        observedProvider: providerConfirmationObservation,
        retryAfterMs: providerConfirmationObservation.retryAfterMs || 0,
        nextAction: confirmationPatch.nextAction || providerRow.providerReadinessConfirmation?.nextAction || null,
      }
      : null;

    return {
      operationId: providerRow.operationId,
      ownerId: providerRow.ownerId,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : dispatchReady
            ? "dispatch-ready"
            : "waiting",
      dispatchReady,
      blockedBy,
      pendingBy,
      envelopeId: providerRow.envelopeId || null,
      ownershipEnvelopeStatus: providerRow.ownershipEnvelopeStatus || "unknown",
      providerReadinessId: providerRow.providerReadinessId || null,
      providerReadinessStatus: providerRow.providerReadinessStatus || "unknown",
      providerReadinessAccepted: providerRow.providerReadinessAccepted === true,
      providerReadinessChecks: providerRow.providerReadinessChecks || {},
      providerReadinessConfirmation: providerRow.providerReadinessConfirmation || {
        required: false,
        accepted: true,
        observedState: null,
        observedAtPath: null,
        ackTokenPresent: false,
      },
      providerReadinessConfirmationState: providerConfirmationFailed
        ? "failed"
        : providerConfirmationDegraded
          ? "degraded"
          : providerRow.providerReadinessConfirmation?.required === true && providerRow.providerReadinessConfirmation?.accepted !== true
            ? "pending"
            : providerRow.providerReadinessConfirmation?.accepted === true
              ? "accepted"
              : "not-required",
      providerReadinessConfirmationRetryAfterMs: providerConfirmationObservation.retryAfterMs || 0,
      providerReadinessStatusPatch: providerRow.providerReadinessStatusPatch || {
        patchId: null,
        patchable: false,
        statusPath: null,
        providerStatusPath: null,
        state: "unknown",
        visibleState: null,
        blockedBy: [],
        nextAction: null,
      },
      clientHandoffReceiptId: providerRow.clientHandoffReceiptId || adoptionRow.clientHandoffReceiptId || null,
      clientHandoffReceiptState: providerRow.clientHandoffReceiptState || adoptionRow.clientHandoffReceiptState || "unknown",
      clientHandoffReceiptAccepted: providerRow.clientHandoffReceiptAccepted === true && adoptionRow.clientHandoffReceiptAccepted !== false,
      clientHandoffReceiptMatches: providerRow.clientHandoffReceiptMatches !== false && adoptionRow.clientHandoffReceiptMatches !== false,
      requestId: providerRow.requestId || adoptionRow.requestId || null,
      clientStatusPath: providerRow.clientStatusPath || adoptionRow.clientStatusPath || null,
      providerStatusPath: providerRow.providerStatusPath || adoptionRow.providerStatusPath || null,
      auditId: providerRow.auditId || manifestRow.auditCorrelationId || null,
      auditChannel: providerRow.auditChannel || null,
      idempotencyKey: providerRow.idempotencyKey
        || `approval-handoff:${compactApprovalDigest([
          providerContract.syncKey,
          providerRow.operationId,
          providerRow.requestId,
        ])}`,
      replayToken: providerRow.replayToken || null,
      leasedCapabilities: providerRow.leasedCapabilities || [],
      delegatedCapabilities: providerRow.delegatedCapabilities || [],
      permissionBoundary,
      packagePermissionBoundary: packagePermissionRow.packetId
        ? {
          packetId: packagePermissionRow.packetId,
          status: packagePermissionRow.status,
          acceptedForDispatch: packagePermissionRow.acceptedForDispatch === true,
          boundaryKey: packagePermissionRow.boundaryKey || null,
          statusPatch: packagePermissionRow.statusPatch || null,
          blockedBy: packagePermissionRow.blockedBy || [],
          pendingBy: packagePermissionRow.pendingBy || [],
          commands: packagePermissionRow.commands || [],
          nextAction: packagePermissionRow.nextAction || null,
        }
        : null,
      packageOperatorHandoff: operatorPacketRow.packetRowId
        ? {
          packetId: packageOperatorHandoffPreview.packetId || null,
          packetRowId: operatorPacketRow.packetRowId,
          status: operatorPacketRow.status,
          acceptedForOperator: operatorPacketRow.acceptedForOperator === true,
          visibleState: operatorPacketRow.visibleState || null,
          command: operatorPacketRow.command || null,
          blockedBy: operatorPacketRow.blockedBy || [],
          pendingBy: operatorPacketRow.pendingBy || [],
          nextAction: operatorPacketRow.nextAction || null,
        }
        : null,
      packageExportReadiness: packageExportRow.operationId
        ? {
          ledgerKey: packageExportReadinessPreview.ledgerKey || null,
          status: packageExportRow.status,
          exportable: packageExportRow.exportable === true,
          blockedBy: packageExportRow.blockedBy || [],
          pendingBy: packageExportRow.pendingBy || [],
          providerReadinessId: packageExportRow.providerReadinessId || null,
          permissionPacketId: packageExportRow.permissionPacketId || null,
          restartJournalEntryId: packageExportRow.restartJournalEntryId || null,
          nextAction: packageExportRow.nextAction || null,
        }
        : null,
      packageExportAudit: packageAuditRow.operationId
        ? {
          auditTrailId: packageExportAuditPreview.auditTrailId || null,
          eventId: packageAuditRow.eventId || null,
          auditDigest: packageAuditRow.auditDigest || null,
          status: packageAuditRow.status,
          acceptedForDispatch: packageAuditRow.acceptedForDispatch === true,
          blockedBy: packageAuditRow.blockedBy || [],
          pendingBy: packageAuditRow.pendingBy || [],
          command: packageAuditRow.command || null,
          nextAction: packageAuditRow.nextAction || null,
        }
        : null,
      packageExportHistory: packageHistoryRow.operationId
        ? {
          bundleId: packageExportHistoryPreview.bundleId || null,
          snapshotId: packageHistoryRow.snapshotId || null,
          digest: packageHistoryRow.digest || null,
          status: packageHistoryRow.status,
          acceptedForDispatch: packageHistoryRow.acceptedForDispatch === true,
          auditEventId: packageHistoryRow.auditEventId || null,
          blockedBy: packageHistoryRow.blockedBy || [],
          pendingBy: packageHistoryRow.pendingBy || [],
          command: packageHistoryRow.command || null,
          nextAction: packageHistoryRow.nextAction || null,
        }
        : null,
      packageOperationalIncident: packageIncidentRow.operationId
        ? {
          ledgerKey: packageOperationalIncidentPreview.ledgerKey || null,
          incidentId: packageIncidentRow.incidentId || null,
          status: packageIncidentRow.status,
          severity: packageIncidentRow.severity || "info",
          retryable: packageIncidentRow.retryable === true,
          retryAfterMs: packageIncidentRow.retryAfterMs || 0,
          blockedBy: packageIncidentRow.blockedBy || [],
          pendingBy: packageIncidentRow.pendingBy || [],
          statusPatch: packageIncidentRow.statusPatch || null,
          command: packageIncidentRow.command || null,
          nextAction: packageIncidentRow.nextAction || null,
        }
        : null,
      packagePreviewAcceptance: packagePreviewAcceptanceRow.operationId
        ? {
          summaryKey: packagePreviewAcceptanceSummary.summaryKey || null,
          summaryId: packagePreviewAcceptanceRow.summaryId || null,
          readiness: packagePreviewAcceptanceRow.readiness || "unknown",
          acceptedForRoute: packagePreviewAcceptanceRow.acceptedForRoute === true,
          acceptedForApproval: packagePreviewAcceptanceRow.acceptedForApproval === true,
          statusPatch: packagePreviewAcceptanceRow.statusPatch || null,
          blockedBy: packagePreviewAcceptanceRow.blockedBy || [],
          pendingBy: packagePreviewAcceptanceRow.pendingBy || [],
          commands: packagePreviewAcceptanceRow.commands || [],
          userVisibleSummary: packagePreviewAcceptanceSummary.userVisibleSummary || null,
          nextAction: packagePreviewAcceptanceRow.nextAction || packagePreviewAcceptanceSummary.nextAction || null,
        }
        : null,
      payload: {
        ...(providerRow.payload || {}),
        packageOperatorHandoff: operatorPacketRow.packetRowId ? operatorPacketRow : null,
        permissionBoundary,
        packagePermissionBoundary: packagePermissionRow.packetId ? packagePermissionRow : null,
        packageExportReadiness: packageExportRow.operationId ? packageExportRow : null,
        packageExportAudit: packageAuditRow.operationId ? packageAuditRow : null,
        packageExportHistory: packageHistoryRow.operationId ? packageHistoryRow : null,
        packageOperationalIncident: packageIncidentRow.operationId ? packageIncidentRow : null,
        packagePreviewAcceptance: packagePreviewAcceptanceRow.operationId ? packagePreviewAcceptanceRow : null,
        permissionStatusPatch: permissionBoundary.statusPatch,
        packagePermissionStatusPatch: packagePermissionRow.statusPatch || null,
        permissionCommands: permissionBoundary.commands,
        packagePermissionCommands: packagePermissionRow.commands || [],
        approvalStatus: manifestRow.approvalStatus || "unknown",
        runtimeAction: actionRow.action || "observe",
        providerSyncKey: providerContract.syncKey,
        providerReadinessId: providerRow.providerReadinessId || null,
        providerReadinessStatus: providerRow.providerReadinessStatus || "unknown",
        providerReadinessChecks: providerRow.providerReadinessChecks || {},
        providerReadinessConfirmation: providerRow.providerReadinessConfirmation || null,
        providerReadinessConfirmationState: providerConfirmationFailed
          ? "failed"
          : providerConfirmationDegraded
            ? "degraded"
            : providerRow.providerReadinessConfirmation?.status || "unknown",
        providerReadinessConfirmationRetryAfterMs: providerConfirmationObservation.retryAfterMs || 0,
        providerConfirmationStatusPatch: confirmationPatch.patchId ? confirmationPatch : null,
        providerReadinessStatusPatch: providerRow.providerReadinessStatusPatch || null,
        clientHandoffReceiptId: providerRow.clientHandoffReceiptId || adoptionRow.clientHandoffReceiptId || null,
        clientHandoffReceiptState: providerRow.clientHandoffReceiptState || adoptionRow.clientHandoffReceiptState || "unknown",
        exportDigest: exportManifest.digest,
      },
      command: {
        command: "dispatch_mailchimp_external_handoff",
        enabled: dispatchReady,
        idempotencyKey: providerRow.idempotencyKey
          || `approval-handoff:${compactApprovalDigest([
            providerContract.syncKey,
            providerRow.operationId,
            providerRow.requestId,
          ])}`,
        statusPath: providerRow.clientStatusPath || adoptionRow.clientStatusPath || null,
        permissionStatusPatch: permissionBoundary.statusPatch.patchable
          ? permissionBoundary.statusPatch.fields
          : null,
        providerConfirmationStatusPatch: confirmationPatch.patchable === true
          ? {
            ...confirmationPatch.fields,
            observedProvider: providerConfirmationObservation,
            retryAfterMs: providerConfirmationObservation.retryAfterMs || 0,
          }
          : null,
        prerequisiteCommand: providerConfirmationStatusCommand || permissionStatusCommand,
        prerequisiteCommands: [
          permissionStatusCommand,
          providerConfirmationStatusCommand,
        ].filter(Boolean),
      },
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("operator-handoff:")
          ? operatorPacketRow.nextAction || packageOperatorHandoffPreview.nextAction || "repair_operator_handoff_packet"
        : blockedBy[0].startsWith("permission:")
          ? permissionBoundary.nextAction
          : blockedBy[0].startsWith("permission-status:")
            ? permissionBoundary.nextAction
          : blockedBy[0].startsWith("package-export:")
            ? packageExportRow.nextAction || packageExportReadinessPreview.nextAction || "repair_package_export_readiness"
        : blockedBy[0].startsWith("package-export-audit:")
            ? packageAuditRow.nextAction || packageExportAuditPreview.nextAction || "repair_package_export_audit"
        : blockedBy[0].startsWith("package-export-history:")
            ? packageHistoryRow.nextAction || packageExportHistoryPreview.nextAction || "repair_package_export_history"
        : blockedBy[0].startsWith("package-operational:")
            ? packageIncidentRow.nextAction || packageOperationalIncidentPreview.nextAction || "repair_package_operational_incident"
        : blockedBy[0].startsWith("package-preview-acceptance-status:")
            ? packagePreviewAcceptanceRow.statusPatch?.nextAction || packagePreviewAcceptanceRow.nextAction || "repair_preview_acceptance_status_patch"
        : blockedBy[0].startsWith("package-preview-acceptance:")
            ? packagePreviewAcceptanceRow.nextAction || packagePreviewAcceptanceSummary.nextAction || "repair_preview_acceptance_summary"
        : blockedBy[0].startsWith("package-permission")
            ? packagePermissionRow.nextAction || packagePermissionBoundaryPreview.nextAction
          : blockedBy[0].startsWith("provider-readiness-status:")
            ? providerRow.providerReadinessStatusPatch?.nextAction || "repair_provider_readiness_status_patch"
          : blockedBy[0].startsWith("provider-readiness-confirmation-status:")
            ? providerRow.providerReadinessConfirmation?.statusPatch?.nextAction || "repair_provider_confirmation_status_patch"
          : blockedBy[0].startsWith("provider-readiness-confirmation:")
            ? providerConfirmationFailed
              ? providerRow.providerReadinessConfirmation?.nextAction || "surface_provider_confirmation_failure"
              : providerRow.providerReadinessConfirmation?.nextAction || "repair_provider_readiness_confirmation"
          : blockedBy[0].startsWith("provider-readiness:")
            ? providerRow.nextAction || providerContract.sync.nextAction || "repair_provider_readiness_handoff"
          : blockedBy[0].startsWith("adoption:")
          ? adoptionRow.nextAction || clientRuntimeAdoption.nextAction
          : blockedBy[0].startsWith("receipt:")
            ? "refresh_client_handoff_receipt_evidence"
          : blockedBy[0] === "runtime:retry-exhausted"
            ? "surface_retry_exhaustion"
            : "repair_provider_handoff_payload"
        : pendingBy.length
          ? pendingBy[0].startsWith("operator-handoff:")
            ? operatorPacketRow.nextAction || packageOperatorHandoffPreview.nextAction || "wait_for_operator_handoff_packet"
          : pendingBy[0].startsWith("permission:")
            ? permissionBoundary.nextAction
            : pendingBy[0].startsWith("permission-status:")
              ? permissionBoundary.nextAction
            : pendingBy[0].startsWith("package-export:")
              ? packageExportRow.nextAction || packageExportReadinessPreview.nextAction || "wait_for_package_export_readiness"
            : pendingBy[0].startsWith("package-export-audit:")
              ? packageAuditRow.nextAction || packageExportAuditPreview.nextAction || "wait_for_package_export_audit"
            : pendingBy[0].startsWith("package-export-history:")
              ? packageHistoryRow.nextAction || packageExportHistoryPreview.nextAction || "wait_for_package_export_history"
            : pendingBy[0].startsWith("package-operational:")
              ? packageIncidentRow.nextAction || packageOperationalIncidentPreview.nextAction || "wait_for_package_operational_incident"
            : pendingBy[0].startsWith("package-preview-acceptance:")
              ? packagePreviewAcceptanceRow.nextAction || packagePreviewAcceptanceSummary.nextAction || "wait_for_preview_acceptance_summary"
            : pendingBy[0].startsWith("package-permission")
              ? packagePermissionRow.nextAction || packagePermissionBoundaryPreview.nextAction
            : pendingBy[0].startsWith("provider-readiness-confirmation:")
              ? providerConfirmationDegraded
                ? providerRow.providerReadinessConfirmation?.nextAction || "poll_provider_confirmation_after_backoff"
                : providerRow.providerReadinessConfirmation?.nextAction || providerRow.nextAction || "wait_for_provider_readiness_confirmation"
            : pendingBy[0].startsWith("provider-readiness:")
              ? providerRow.nextAction || "wait_for_provider_readiness_handoff"
            : pendingBy[0] === "approval:operator-required"
            ? "request_operator_approval"
            : "poll_mailchimp_provider_status"
          : dispatchReady
            ? "dispatch_mailchimp_external_handoff"
            : actionRow.nextAction || runtimeActionQueue.nextAction,
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const dispatchRows = rows.filter((row) => row.dispatchReady);

  return {
    format: "aios.mailchimp.approval.externalHandoffState.v1",
    provider: "mailchimp",
    service: "mailchimp-marketing",
    syncKey: providerContract.syncKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : dispatchRows.length
          ? "dispatch-ready"
          : "waiting",
    rows,
    counters: {
      operations: rows.length,
      dispatchReady: dispatchRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.leasedCapabilities.length > 0).length,
      delegatedRead: rows.filter((row) => row.delegatedCapabilities.length > 0).length,
      payloadsWithStatusPath: rows.filter((row) => row.clientStatusPath).length,
      permissionAccepted: rows.filter((row) => row.permissionBoundary.accepted).length,
      permissionBlocked: rows.filter((row) => row.permissionBoundary.status === "blocked").length,
      permissionStatusPatchable: rows.filter((row) => row.permissionBoundary.statusPatch.patchable).length,
      permissionStatusBlocked: rows.filter((row) => row.permissionBoundary.statusPatch.patchable === false).length,
      packagePermissionAccepted: rows.filter((row) => row.packagePermissionBoundary?.acceptedForDispatch).length,
      packagePermissionBlocked: rows.filter((row) => row.packagePermissionBoundary?.status === "blocked").length,
      packagePermissionStatusPatchable: rows.filter((row) => row.packagePermissionBoundary?.statusPatch?.patchable).length,
      packageOperatorHandoffLinked: rows.filter((row) => row.packageOperatorHandoff).length,
      packageOperatorHandoffBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("operator-handoff:"))).length,
      packageOperatorHandoffPending: rows.filter((row) => row.pendingBy.some((pending) => pending.startsWith("operator-handoff:"))).length,
      packageExportReady: rows.filter((row) => row.packageExportReadiness?.exportable).length,
      packageExportBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("package-export:"))).length,
      packageExportPending: rows.filter((row) => row.pendingBy.some((pending) => pending.startsWith("package-export:"))).length,
      packageExportAuditAccepted: rows.filter((row) => row.packageExportAudit?.acceptedForDispatch).length,
      packageExportAuditBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("package-export-audit:"))).length,
      packageExportAuditPending: rows.filter((row) => row.pendingBy.some((pending) => pending.startsWith("package-export-audit:"))).length,
      packageOperationalBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("package-operational:"))).length,
      packageOperationalPending: rows.filter((row) => row.pendingBy.some((pending) => pending.startsWith("package-operational:"))).length,
      packageOperationalRetryable: rows.filter((row) => row.packageOperationalIncident?.retryable).length,
      packagePreviewAcceptanceBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("package-preview-acceptance:"))).length,
      packagePreviewAcceptancePending: rows.filter((row) => row.pendingBy.some((pending) => pending.startsWith("package-preview-acceptance:"))).length,
      packagePreviewAcceptanceAccepted: rows.filter((row) => row.packagePreviewAcceptance?.acceptedForApproval).length,
      providerReadinessAccepted: rows.filter((row) => row.providerReadinessAccepted).length,
      providerReadinessBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("provider-readiness:"))).length,
      providerReadinessPending: rows.filter((row) => row.pendingBy.some((pending) => pending.startsWith("provider-readiness:"))).length,
      providerReadinessStatusPatchBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("provider-readiness-status:"))).length,
      providerReadinessConfirmationPending: rows.filter((row) => row.pendingBy.some((pending) => pending.startsWith("provider-readiness-confirmation:"))).length,
      providerReadinessConfirmationFailed: rows.filter((row) => row.providerReadinessConfirmationState === "failed").length,
      providerReadinessConfirmationDegraded: rows.filter((row) => row.providerReadinessConfirmationState === "degraded").length,
      providerReadinessConfirmationPollable: rows.filter((row) => row.providerReadinessConfirmation?.observedProvider?.pollable).length,
    },
    commands: rows.map((row) => row.command),
    payloadShape: {
      provider: "mailchimp",
      service: "mailchimp-marketing",
      operationId: "string",
      requestId: "string",
      clientStatusPath: "string",
      providerSyncKey: "string",
      approvalStatus: "string",
      runtimeAction: "string",
      exportDigest: "string",
      permissionBoundary: "object",
      packagePermissionBoundary: "object|null",
      packageExportReadiness: "object|null",
      packageExportAudit: "object|null",
      packageOperationalIncident: "object|null",
      packagePreviewAcceptance: "object|null",
      providerReadinessId: "string|null",
      providerReadinessStatusPatch: "object|null",
      providerReadinessConfirmation: "object|null",
      providerReadinessConfirmationState: "string",
      providerReadinessConfirmationRetryAfterMs: "number",
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || dispatchRows[0]?.nextAction
      || runtimeActionQueue.nextAction,
  };
}

function normalizePackageExportReadinessPreview(source = {}, providerContract = {}, exportManifest = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const ledger = packageAnalysis?.exportReadinessLedger
    || packageAnalysis?.runtimeContract?.exportReadinessLedger
    || source?.exportReadinessLedger
    || source?.runtimeContract?.exportReadinessLedger
    || null;
  const providerByOperation = new Map((providerContract.capabilities || []).map((row) => [row.operationId, row]));
  const manifestByOperation = new Map((exportManifest.rows || []).map((row) => [row.operationId, row]));

  if (!ledger?.ledgerKey) {
    return {
      format: "aios.mailchimp.approval.packageExportReadinessPreview.v1",
      present: false,
      ledgerKey: null,
      status: "not-provided",
      acceptedForDispatch: true,
      blockedBy: [],
      pendingBy: [],
      rows: [],
      counters: {
        operations: 0,
        ready: 0,
        blocked: 0,
        pending: 0,
        exportable: 0,
      },
      userVisibleSummary: {
        title: "Mailchimp package export readiness",
        status: "not-provided",
        rows: [],
        nextAction: providerContract.sync?.nextAction || "wait_for_provider_contract",
      },
      nextAction: providerContract.sync?.nextAction || "wait_for_provider_contract",
    };
  }

  const rows = (ledger.rows || []).map((row) => {
    const providerRow = providerByOperation.get(row.operationId) || {};
    const manifestRow = manifestByOperation.get(row.operationId) || {};
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `package-export:${blocker}`)),
      ...(row.status === "blocked" || row.status === "metadata-incomplete" ? [`package-export:${row.status}`] : []),
      ...(manifestRow.exportable === false ? ["approval-export:manifest-row-not-exportable"] : []),
      ...(providerRow.status === "metadata-incomplete" ? ["provider:metadata-incomplete"] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `package-export:${pending}`)),
      ...(row.status === "pending" ? ["package-export:pending"] : []),
      ...(providerRow.status === "provider-readiness-pending" ? ["provider:readiness-pending"] : []),
    ].sort();
    const exportable = row.exportable === true
      && blockedBy.length === 0
      && Boolean(row.requestId || providerRow.requestId || manifestRow.requestId)
      && Boolean(row.clientStatusPath || providerRow.clientStatusPath || manifestRow.clientStatusPath);

    return {
      operationId: row.operationId,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : exportable
            ? "export-ready"
            : "metadata-incomplete",
      exportable,
      externalWrite: row.externalWrite === true,
      requestId: row.requestId || providerRow.requestId || manifestRow.requestId || null,
      clientStatusPath: row.clientStatusPath || providerRow.clientStatusPath || manifestRow.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || providerRow.providerStatusPath || manifestRow.providerStatusPath || null,
      providerReadinessId: row.providerReadinessId || providerRow.providerReadinessId || null,
      permissionPacketId: row.permissionPacketId || null,
      restartJournalEntryId: row.restartJournalEntryId || null,
      analyticsTags: row.analyticsTags || [],
      blockedBy,
      pendingBy,
      nextAction: blockedBy.length
        ? row.nextAction || "repair_package_export_readiness"
        : pendingBy.length
          ? row.nextAction || "wait_for_package_export_readiness"
          : row.nextAction || "accept_package_export_readiness",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.status === "metadata-incomplete");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.exportable && row.status === "export-ready");

  return {
    format: "aios.mailchimp.approval.packageExportReadinessPreview.v1",
    present: true,
    ledgerKey: ledger.ledgerKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "ready",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.exportable),
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      exportable: rows.filter((row) => row.exportable).length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      providerReadinessLinked: rows.filter((row) => row.providerReadinessId).length,
      permissionLinked: rows.filter((row) => row.permissionPacketId).length,
      restartLinked: rows.filter((row) => row.restartJournalEntryId).length,
    },
    userVisibleSummary: {
      title: "Mailchimp package export readiness",
      status: blockedRows.length ? "blocked" : pendingRows.length ? "pending" : "ready",
      rows: rows.map((row) => ({
        operationId: row.operationId,
        status: row.status,
        exportable: row.exportable,
        blockedBy: row.blockedBy,
        pendingBy: row.pendingBy,
        nextAction: row.nextAction,
      })),
      nextAction: blockedRows[0]?.nextAction || pendingRows[0]?.nextAction || "accept_package_export_readiness",
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || ledger.nextAction
      || "accept_package_export_readiness",
  };
}

function normalizePackageExportAuditPreview(source = {}, packageExportReadinessPreview = {}, exportManifest = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const auditTrail = packageAnalysis?.exportAuditTrail
    || packageAnalysis?.runtimeContract?.exportAuditTrail
    || source?.exportAuditTrail
    || source?.runtimeContract?.exportAuditTrail
    || null;
  const exportByOperation = new Map((packageExportReadinessPreview.rows || []).map((row) => [row.operationId, row]));
  const manifestByOperation = new Map((exportManifest.rows || []).map((row) => [row.operationId, row]));

  if (!auditTrail?.auditTrailId) {
    return {
      format: "aios.mailchimp.approval.packageExportAuditPreview.v1",
      present: false,
      auditTrailId: null,
      status: "not-provided",
      acceptedForDispatch: true,
      blockedBy: [],
      pendingBy: [],
      rows: [],
      commands: [],
      counters: {
        operations: 0,
        accepted: 0,
        blocked: 0,
        pending: 0,
        commandsEnabled: 0,
      },
      userVisibleSummary: {
        title: "Mailchimp package export audit",
        status: "not-provided",
        rows: [],
        nextAction: packageExportReadinessPreview.nextAction || "wait_for_package_export_readiness",
      },
      nextAction: packageExportReadinessPreview.nextAction || "wait_for_package_export_readiness",
    };
  }

  const rows = (auditTrail.rows || []).map((row) => {
    const exportRow = exportByOperation.get(row.operationId) || {};
    const manifestRow = manifestByOperation.get(row.operationId) || {};
    const command = row.command || {};
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `package-export-audit:${blocker}`)),
      ...(row.status === "blocked" ? ["package-export-audit:blocked"] : []),
      ...(!row.eventId ? ["package-export-audit:event-id-missing"] : []),
      ...(!row.auditDigest ? ["package-export-audit:digest-missing"] : []),
      ...(!row.clientStatusPath && !manifestRow.clientStatusPath ? ["package-export-audit:client-status-path-missing"] : []),
      ...(exportRow.status === "blocked" || exportRow.status === "metadata-incomplete"
        ? [`package-export-readiness:${exportRow.status}`]
        : []),
      ...(manifestRow.exportable === false ? ["approval-export:manifest-row-not-exportable"] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `package-export-audit:${pending}`)),
      ...(row.status === "pending" ? ["package-export-audit:pending"] : []),
      ...(exportRow.status === "pending" ? ["package-export-readiness:pending"] : []),
    ].sort();
    const acceptedForDispatch = row.acceptedForExport === true
      && blockedBy.length === 0
      && pendingBy.length === 0
      && Boolean(row.eventId && row.auditDigest)
      && Boolean(row.clientStatusPath || manifestRow.clientStatusPath);

    return {
      operationId: row.operationId,
      eventId: row.eventId || null,
      auditDigest: row.auditDigest || null,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : acceptedForDispatch
            ? "accepted"
            : "metadata-incomplete",
      acceptedForDispatch,
      externalWrite: row.externalWrite === true,
      requestId: row.requestId || manifestRow.requestId || null,
      clientStatusPath: row.clientStatusPath || manifestRow.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || manifestRow.providerStatusPath || null,
      exportLedgerKey: row.exportLedgerKey || packageExportReadinessPreview.ledgerKey || null,
      externalHandoffEntryId: row.externalHandoffEntryId || null,
      operatorPacketRowId: row.operatorPacketRowId || null,
      historySnapshotId: row.historySnapshotId || null,
      historyStatus: row.historyStatus || "unknown",
      exportReadinessStatus: row.exportReadinessStatus || exportRow.status || "unknown",
      blockedBy,
      pendingBy,
      command: {
        command: command.command || "persist-package-export-audit-event",
        enabled: command.enabled === true && blockedBy.length === 0,
        idempotencyKey: command.idempotencyKey || (row.eventId ? `package-export-audit:${row.eventId}` : null),
        statusPath: command.statusPath || row.clientStatusPath || manifestRow.clientStatusPath || null,
        providerStatusPath: command.providerStatusPath || row.providerStatusPath || manifestRow.providerStatusPath || null,
        payload: command.payload || null,
      },
      userVisibleRow: {
        operationId: row.operationId,
        status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : "accepted",
        eventId: row.eventId || null,
        clientStatusPath: row.clientStatusPath || manifestRow.clientStatusPath || null,
        nextAction: row.nextAction || null,
      },
      nextAction: blockedBy.length
        ? row.nextAction || "repair_package_export_audit"
        : pendingBy.length
          ? row.nextAction || "wait_for_package_export_audit"
          : row.nextAction || "accept_package_export_audit",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.status === "metadata-incomplete");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const acceptedRows = rows.filter((row) => row.acceptedForDispatch);

  return {
    format: "aios.mailchimp.approval.packageExportAuditPreview.v1",
    present: true,
    auditTrailId: auditTrail.auditTrailId,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "accepted",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.acceptedForDispatch),
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    rows,
    commands: rows.map((row) => row.command),
    counters: {
      operations: rows.length,
      accepted: acceptedRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      commandsEnabled: rows.filter((row) => row.command.enabled).length,
      historyLinked: rows.filter((row) => row.historySnapshotId).length,
      providerStatusLinked: rows.filter((row) => row.providerStatusPath).length,
    },
    userVisibleSummary: {
      title: "Mailchimp package export audit",
      status: blockedRows.length ? "blocked" : pendingRows.length ? "pending" : "accepted",
      rows: rows.map((row) => row.userVisibleRow),
      nextAction: blockedRows[0]?.nextAction
        || pendingRows[0]?.nextAction
        || "accept_package_export_audit",
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || auditTrail.nextAction
      || "accept_package_export_audit",
  };
}

function normalizePackageExportHistoryPreview(source = {}, packageExportReadinessPreview = {}, packageExportAuditPreview = {}, exportManifest = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const historyBundle = packageAnalysis?.exportHistoryBundle
    || packageAnalysis?.runtimeContract?.exportHistoryBundle
    || source?.exportHistoryBundle
    || source?.runtimeContract?.exportHistoryBundle
    || null;
  const exportByOperation = new Map((packageExportReadinessPreview.rows || []).map((row) => [row.operationId, row]));
  const auditByOperation = new Map((packageExportAuditPreview.rows || []).map((row) => [row.operationId, row]));
  const manifestByOperation = new Map((exportManifest.rows || []).map((row) => [row.operationId, row]));

  if (!historyBundle?.bundleId) {
    return {
      format: "aios.mailchimp.approval.packageExportHistoryPreview.v1",
      present: false,
      bundleId: null,
      status: "not-provided",
      acceptedForDispatch: true,
      blockedBy: [],
      pendingBy: [],
      rows: [],
      commands: [],
      counters: {
        operations: 0,
        ready: 0,
        blocked: 0,
        pending: 0,
        digestCount: 0,
        auditLinked: 0,
      },
      userVisibleSummary: {
        title: "Mailchimp package export history",
        status: "not-provided",
        latestSnapshot: null,
        rows: [],
        nextAction: packageExportAuditPreview.nextAction || packageExportReadinessPreview.nextAction || "wait_for_package_export_audit",
      },
      nextAction: packageExportAuditPreview.nextAction || packageExportReadinessPreview.nextAction || "wait_for_package_export_audit",
    };
  }

  const rows = (historyBundle.rows || []).map((row) => {
    const exportRow = exportByOperation.get(row.operationId) || {};
    const auditRow = auditByOperation.get(row.operationId) || {};
    const manifestRow = manifestByOperation.get(row.operationId) || {};
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `package-export-history:${blocker}`)),
      ...(row.status === "blocked" || row.status === "metadata-incomplete" ? [`package-export-history:${row.status}`] : []),
      ...(exportRow.status === "blocked" || exportRow.status === "metadata-incomplete" ? [`package-export-readiness:${exportRow.status}`] : []),
      ...(auditRow.status === "blocked" || auditRow.status === "metadata-incomplete" ? [`package-export-audit:${auditRow.status}`] : []),
      ...(manifestRow.exportable === false ? ["approval-export:manifest-row-not-exportable"] : []),
      ...(!row.snapshotId ? ["package-export-history:snapshot-id-missing"] : []),
      ...(!row.digest ? ["package-export-history:digest-missing"] : []),
      ...(!row.clientStatusPath && !manifestRow.clientStatusPath ? ["package-export-history:client-status-path-missing"] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `package-export-history:${pending}`)),
      ...(row.status === "pending" ? ["package-export-history:pending"] : []),
      ...(exportRow.status === "pending" ? ["package-export-readiness:pending"] : []),
      ...(auditRow.status === "pending" ? ["package-export-audit:pending"] : []),
    ].sort();
    const acceptedForDispatch = row.exportReady === true
      && blockedBy.length === 0
      && pendingBy.length === 0
      && Boolean(row.snapshotId && row.digest)
      && Boolean(row.clientStatusPath || manifestRow.clientStatusPath);

    return {
      operationId: row.operationId,
      snapshotId: row.snapshotId || null,
      digest: row.digest || null,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : acceptedForDispatch
            ? "accepted"
            : "metadata-incomplete",
      acceptedForDispatch,
      requestId: row.requestId || manifestRow.requestId || null,
      clientStatusPath: row.clientStatusPath || manifestRow.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || manifestRow.providerStatusPath || null,
      exportLedgerKey: row.exportLedgerKey || packageExportReadinessPreview.ledgerKey || null,
      auditTrailId: row.auditTrailId || packageExportAuditPreview.auditTrailId || null,
      auditEventId: row.auditEventId || auditRow.eventId || null,
      auditDigest: row.auditDigest || auditRow.auditDigest || null,
      historyStatus: row.historyStatus || "unknown",
      exportReadinessStatus: row.exportReadinessStatus || exportRow.status || "unknown",
      exportAuditStatus: row.exportAuditStatus || auditRow.status || "unknown",
      retryable: row.retryable === true,
      degradedMode: row.degradedMode === true,
      blockedBy,
      pendingBy,
      command: {
        command: "publish-package-export-history-snapshot",
        enabled: acceptedForDispatch,
        idempotencyKey: row.snapshotId ? `package-export-history:${row.snapshotId}:${row.digest || "digest"}` : null,
        statusPath: row.clientStatusPath || manifestRow.clientStatusPath || null,
        providerStatusPath: row.providerStatusPath || manifestRow.providerStatusPath || null,
        payload: acceptedForDispatch
          ? {
            bundleId: historyBundle.bundleId,
            operationId: row.operationId,
            snapshotId: row.snapshotId,
            digest: row.digest,
            auditEventId: row.auditEventId || auditRow.eventId || null,
          }
          : null,
      },
      userVisibleRow: {
        operationId: row.operationId,
        status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : "accepted",
        snapshotId: row.snapshotId || null,
        digest: row.digest || null,
        auditEventId: row.auditEventId || auditRow.eventId || null,
        clientStatusPath: row.clientStatusPath || manifestRow.clientStatusPath || null,
        nextAction: row.nextAction || null,
      },
      nextAction: blockedBy.length
        ? row.nextAction || "repair_package_export_history"
        : pendingBy.length
          ? row.nextAction || "wait_for_package_export_history"
          : row.nextAction || "accept_package_export_history",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.status === "metadata-incomplete");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const acceptedRows = rows.filter((row) => row.acceptedForDispatch);
  const latestSnapshot = historyBundle.latestSnapshot
    ? {
      operationId: historyBundle.latestSnapshot.operationId || null,
      snapshotId: historyBundle.latestSnapshot.snapshotId || null,
      digest: historyBundle.latestSnapshot.digest || null,
      status: historyBundle.latestSnapshot.status || "unknown",
      auditEventId: historyBundle.latestSnapshot.auditEventId || null,
    }
    : acceptedRows.at(-1)?.userVisibleRow || null;

  return {
    format: "aios.mailchimp.approval.packageExportHistoryPreview.v1",
    present: true,
    bundleId: historyBundle.bundleId,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : rows.every((row) => row.acceptedForDispatch)
          ? "accepted"
          : "metadata-incomplete",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.acceptedForDispatch),
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    rows,
    commands: rows.map((row) => row.command),
    counters: {
      operations: rows.length,
      accepted: acceptedRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      ready: acceptedRows.length,
      digestCount: rows.filter((row) => row.digest).length,
      auditLinked: rows.filter((row) => row.auditEventId).length,
      providerStatusLinked: rows.filter((row) => row.providerStatusPath).length,
      commandsEnabled: rows.filter((row) => row.command.enabled).length,
      retryable: rows.filter((row) => row.retryable).length,
      degraded: rows.filter((row) => row.degradedMode).length,
    },
    latestSnapshot,
    userVisibleSummary: {
      title: "Mailchimp package export history",
      status: blockedRows.length ? "blocked" : pendingRows.length ? "pending" : "accepted",
      latestSnapshot,
      rows: rows.map((row) => row.userVisibleRow),
      nextAction: blockedRows[0]?.nextAction
        || pendingRows[0]?.nextAction
        || "accept_package_export_history",
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || historyBundle.nextAction
      || "accept_package_export_history",
  };
}

function normalizePackageExportReportingPreview(source = {}, packageExportHistoryPreview = {}, exportManifest = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const checkpoint = packageAnalysis?.exportReportingCheckpoint
    || packageAnalysis?.runtimeContract?.exportReportingCheckpoint
    || source?.exportReportingCheckpoint
    || source?.runtimeContract?.exportReportingCheckpoint
    || null;
  const historyByOperation = new Map((packageExportHistoryPreview.rows || []).map((row) => [row.operationId, row]));
  const manifestByOperation = new Map((exportManifest.rows || []).map((row) => [row.operationId, row]));

  if (!checkpoint?.checkpointKey) {
    return {
      format: "aios.mailchimp.approval.packageExportReportingPreview.v1",
      present: false,
      checkpointKey: null,
      status: "not-provided",
      acceptedForDispatch: true,
      blockedBy: [],
      pendingBy: [],
      rows: [],
      commands: [],
      counters: {
        operations: 0,
        ready: 0,
        blocked: 0,
        pending: 0,
        digestCount: 0,
        patchable: 0,
        commandsEnabled: 0,
        restartSafe: 0,
        resumeCommandsEnabled: 0,
        snapshotBlocked: 0,
      },
      restartSnapshots: [],
      resumeCommands: [],
      latestReadyReport: null,
      userVisibleSummary: {
        title: "Mailchimp export report",
        status: "not-provided",
        rows: [],
        latestReadyReport: null,
        nextAction: packageExportHistoryPreview.nextAction || "wait_for_package_export_history",
      },
      nextAction: packageExportHistoryPreview.nextAction || "wait_for_package_export_history",
    };
  }

  const rows = (checkpoint.rows || []).map((row) => {
    const historyRow = historyByOperation.get(row.operationId) || {};
    const manifestRow = manifestByOperation.get(row.operationId) || {};
    const statusPatch = row.statusPatch || {};
    const restartSnapshot = row.restartSnapshot || {};
    const resumeCommand = row.resumeCommand || {};
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `package-export-report:${blocker}`)),
      ...((restartSnapshot.blockedBy || []).map((blocker) => `package-export-report-restart:${blocker}`)),
      ...(row.status === "blocked" || row.status === "metadata-incomplete" ? [`package-export-report:${row.status}`] : []),
      ...(restartSnapshot.status === "resume-blocked" ? ["package-export-report-restart:resume-blocked"] : []),
      ...(historyRow.status === "blocked" || historyRow.status === "metadata-incomplete" ? [`package-export-history:${historyRow.status}`] : []),
      ...(manifestRow.exportable === false ? ["approval-export:manifest-row-not-exportable"] : []),
      ...(!row.reportDigest ? ["package-export-report:digest-missing"] : []),
      ...(!row.checkpointId ? ["package-export-report:checkpoint-id-missing"] : []),
      ...(!statusPatch.patchId ? ["package-export-report:status-patch-missing"] : []),
      ...(!restartSnapshot.snapshotId ? ["package-export-report-restart:snapshot-id-missing"] : []),
      ...(!restartSnapshot.resumeToken ? ["package-export-report-restart:resume-token-missing"] : []),
      ...(!row.clientStatusPath && !manifestRow.clientStatusPath ? ["package-export-report:client-status-path-missing"] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `package-export-report:${pending}`)),
      ...(row.status === "pending" ? ["package-export-report:pending"] : []),
      ...(restartSnapshot.status === "resume-pending" ? ["package-export-report-restart:resume-pending"] : []),
      ...(historyRow.status === "pending" ? ["package-export-history:pending"] : []),
    ].sort();
    const restartReady = restartSnapshot.restartSafe === true
      && resumeCommand.enabled === true
      && Boolean(restartSnapshot.snapshotId && restartSnapshot.resumeToken);
    const acceptedForDispatch = row.acceptedForRoute === true
      && blockedBy.length === 0
      && pendingBy.length === 0
      && statusPatch.patchable === true
      && restartReady
      && Boolean(row.reportDigest && row.checkpointId);

    return {
      operationId: row.operationId,
      checkpointId: row.checkpointId || null,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : acceptedForDispatch
            ? "accepted"
            : "metadata-incomplete",
      acceptedForDispatch,
      reportDigest: row.reportDigest || null,
      requestId: row.requestId || manifestRow.requestId || null,
      clientStatusPath: row.clientStatusPath || manifestRow.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || manifestRow.providerStatusPath || null,
      auditEventId: row.auditEventId || historyRow.auditEventId || null,
      historySnapshotId: row.historySnapshotId || historyRow.snapshotId || null,
      routePreviewDigest: row.routePreviewDigest || null,
      statuses: row.statuses || {},
      restartSnapshot: {
        snapshotId: restartSnapshot.snapshotId || null,
        resumeToken: restartSnapshot.resumeToken || null,
        status: restartSnapshot.status || "not-provided",
        restartSafe: restartReady,
        persistedKeys: restartSnapshot.persistedKeys || [],
        expectedPatchId: restartSnapshot.expectedPatchId || statusPatch.patchId || null,
        blockedBy: restartSnapshot.blockedBy || [],
        nextAction: restartSnapshot.nextAction || null,
      },
      blockedBy,
      pendingBy,
      statusPatch: {
        patchId: statusPatch.patchId || null,
        patchable: acceptedForDispatch,
        statusPath: statusPatch.statusPath || row.clientStatusPath || manifestRow.clientStatusPath || null,
        providerStatusPath: statusPatch.providerStatusPath || row.providerStatusPath || manifestRow.providerStatusPath || null,
        state: statusPatch.state || row.status || "unknown",
        visibleState: statusPatch.visibleState || null,
        blockedBy: statusPatch.blockedBy || blockedBy,
        pendingBy: statusPatch.pendingBy || pendingBy,
        nextAction: statusPatch.nextAction || row.nextAction || null,
      },
      command: {
        ...(row.command || {}),
        command: row.command?.command || "publish-package-export-report",
        enabled: acceptedForDispatch && row.command?.enabled !== false,
        statusPatchId: row.command?.statusPatchId || statusPatch.patchId || null,
        payload: acceptedForDispatch ? row.command?.payload || {
          checkpointId: row.checkpointId,
          operationId: row.operationId,
          reportDigest: row.reportDigest,
        } : null,
      },
      resumeCommand: {
        ...(resumeCommand || {}),
        commandId: resumeCommand.commandId || null,
        command: resumeCommand.command || "resume-package-export-report",
        enabled: acceptedForDispatch && resumeCommand.enabled === true,
        idempotencyKey: resumeCommand.idempotencyKey || null,
        statusPatchId: resumeCommand.statusPatchId || statusPatch.patchId || null,
        snapshotId: resumeCommand.snapshotId || restartSnapshot.snapshotId || null,
        replaySafe: restartReady,
        payload: acceptedForDispatch
          ? resumeCommand.payload || {
            checkpointId: row.checkpointId,
            operationId: row.operationId,
            reportDigest: row.reportDigest,
            resumeToken: restartSnapshot.resumeToken,
            snapshotId: restartSnapshot.snapshotId,
          }
          : null,
        nextAction: resumeCommand.nextAction || restartSnapshot.nextAction || null,
      },
      userVisibleRow: {
        operationId: row.operationId,
        status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : "accepted",
        checkpointId: row.checkpointId || null,
        reportDigest: row.reportDigest || null,
        clientStatusPath: row.clientStatusPath || manifestRow.clientStatusPath || null,
        restartSafe: restartReady,
        snapshotId: restartSnapshot.snapshotId || null,
        nextAction: row.nextAction || statusPatch.nextAction || null,
      },
      nextAction: blockedBy.length
        ? restartSnapshot.nextAction || row.nextAction || statusPatch.nextAction || "repair_package_export_reporting"
        : pendingBy.length
          ? restartSnapshot.nextAction || row.nextAction || statusPatch.nextAction || "wait_for_package_export_reporting"
          : row.nextAction || "accept_package_export_reporting",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.status === "metadata-incomplete");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const acceptedRows = rows.filter((row) => row.acceptedForDispatch);
  const restartSafeRows = rows.filter((row) => row.restartSnapshot.restartSafe);
  const latestReadyReport = checkpoint.latestReadyReport || acceptedRows.at(-1)?.userVisibleRow || null;

  return {
    format: "aios.mailchimp.approval.packageExportReportingPreview.v1",
    present: true,
    checkpointKey: checkpoint.checkpointKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : rows.every((row) => row.acceptedForDispatch)
          ? "accepted"
          : "metadata-incomplete",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.acceptedForDispatch),
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    rows,
    commands: rows.map((row) => row.command),
    restartSnapshots: rows.map((row) => row.restartSnapshot),
    resumeCommands: rows.map((row) => row.resumeCommand),
    counters: {
      operations: rows.length,
      ready: acceptedRows.length,
      accepted: acceptedRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      digestCount: rows.filter((row) => row.reportDigest).length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      commandsEnabled: rows.filter((row) => row.command.enabled).length,
      providerStatusLinked: rows.filter((row) => row.providerStatusPath).length,
      routePreviewLinked: rows.filter((row) => row.routePreviewDigest).length,
      restartSafe: restartSafeRows.length,
      resumeCommandsEnabled: rows.filter((row) => row.resumeCommand.enabled).length,
      snapshotBlocked: rows.filter((row) => row.restartSnapshot.status === "resume-blocked").length,
    },
    latestReadyReport,
    userVisibleSummary: {
      title: "Mailchimp export report",
      status: blockedRows.length ? "blocked" : pendingRows.length ? "pending" : "accepted",
      latestReadyReport,
      rows: rows.map((row) => row.userVisibleRow),
      restartSafeCount: restartSafeRows.length,
      nextAction: blockedRows[0]?.nextAction
        || pendingRows[0]?.nextAction
        || "accept_package_export_reporting",
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || checkpoint.nextAction
      || "accept_package_export_reporting",
  };
}

function normalizePackageOperatorHandoffPreview(source = {}, runtimeActionQueue = {}, externalPreview = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const packet = packageAnalysis?.operatorHandoffPacket
    || packageAnalysis?.runtimeContract?.operatorHandoffPacket
    || source?.operatorHandoffPacket
    || source?.runtimeContract?.operatorHandoffPacket
    || null;
  const actionByOperation = new Map((runtimeActionQueue.rows || []).map((row) => [row.operationId, row]));
  const externalByOperation = new Map((externalPreview.rows || []).map((row) => [row.operationId, row]));

  if (!packet?.packetId) {
    return {
      format: "aios.mailchimp.approval.packageOperatorHandoffPreview.v1",
      present: false,
      packetId: null,
      status: "not-provided",
      acceptedForDispatch: true,
      blockedBy: [],
      pendingBy: [],
      rows: [],
      counters: {
        operations: 0,
        ready: 0,
        blocked: 0,
        pending: 0,
        commandsEnabled: 0,
      },
      userVisibleSummary: {
        title: "Mailchimp operator handoff",
        status: "not-provided",
        rows: [],
        nextAction: runtimeActionQueue.nextAction || "wait_for_runtime_action_queue",
      },
      nextAction: runtimeActionQueue.nextAction || "wait_for_runtime_action_queue",
    };
  }

  const rows = (packet.rows || []).map((row) => {
    const actionRow = actionByOperation.get(row.operationId) || {};
    const externalRow = externalByOperation.get(row.operationId) || {};
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `operator-handoff:${blocker}`)),
      ...(row.status === "blocked" || row.acceptedForOperator === false ? ["operator-handoff:blocked"] : []),
      ...(actionRow.action === "repair" ? [`runtime-action:${actionRow.blockedReason || "repair"}`] : []),
      ...(externalRow.status === "blocked" ? ["external-handoff:blocked"] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `operator-handoff:${pending}`)),
      ...(row.status === "pending" ? ["operator-handoff:pending"] : []),
      ...(actionRow.action === "approve" ? ["approval:operator-required"] : []),
      ...(externalRow.status === "pending" ? ["external-handoff:pending"] : []),
    ].sort();
    const command = row.command || {};
    const commandEnabled = command.enabled === true
      && blockedBy.length === 0
      && pendingBy.length === 0;

    return {
      operationId: row.operationId,
      packetRowId: row.packetRowId || null,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : row.externalWrite ? "approval-ready" : "handoff-ready",
      acceptedForOperator: blockedBy.length === 0 && row.acceptedForOperator !== false,
      externalWrite: row.externalWrite === true,
      visibleState: row.visibleState || null,
      requestId: row.requestId || actionRow.requestId || externalRow.requestId || null,
      clientStatusPath: row.clientStatusPath || actionRow.clientStatusPath || externalRow.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || actionRow.providerStatusPath || externalRow.providerStatusPath || null,
      boundaryStatusPath: row.boundaryStatusPath || null,
      providerReadinessId: row.providerReadinessId || null,
      permissionPacketId: row.permissionPacketId || null,
      exportLedgerKey: row.exportLedgerKey || null,
      externalHandoffEntryId: row.externalHandoffEntryId || null,
      restartJournalEntryId: row.restartJournalEntryId || null,
      command: {
        command: command.command || (row.externalWrite ? "present-mailchimp-operator-approval" : "publish-mailchimp-runtime-handoff"),
        enabled: commandEnabled,
        idempotencyKey: command.idempotencyKey || null,
        statusPath: command.statusPath || row.clientStatusPath || null,
        providerStatusPath: command.providerStatusPath || row.providerStatusPath || null,
        payload: command.payload || null,
      },
      blockedBy,
      pendingBy,
      validationSummary: row.validationSummary || null,
      nextAction: blockedBy.length
        ? row.nextAction || "repair_operator_handoff_packet"
        : pendingBy.length
          ? row.nextAction || "wait_for_operator_handoff_packet"
          : row.nextAction || (row.externalWrite ? "present_mailchimp_operator_approval" : "publish_mailchimp_runtime_handoff"),
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.command.enabled);

  return {
    format: "aios.mailchimp.approval.packageOperatorHandoffPreview.v1",
    present: true,
    packetId: packet.packetId,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "ready",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0,
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      commandsEnabled: readyRows.length,
      statusPathLinked: rows.filter((row) => row.clientStatusPath).length,
      providerStatusLinked: rows.filter((row) => row.providerStatusPath).length,
    },
    userVisibleSummary: {
      title: "Mailchimp operator handoff",
      status: blockedRows.length ? "blocked" : pendingRows.length ? "pending" : "ready",
      rows: rows.map((row) => ({
        operationId: row.operationId,
        status: row.status,
        visibleState: row.visibleState,
        clientStatusPath: row.clientStatusPath,
        providerStatusPath: row.providerStatusPath,
        nextAction: row.nextAction,
      })),
      nextAction: blockedRows[0]?.nextAction
        || pendingRows[0]?.nextAction
        || "accept_operator_handoff_packet",
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || packet.nextAction
      || "accept_operator_handoff_packet",
  };
}

function normalizeSyscallRecoveryHandoffPackage(source = {}, runtime = {}, externalHandoffState = {}) {
  const packageSource = runtime.syscallRecoveryHandoff
    || runtime.recoveryHandoff
    || source.syscallRecoveryHandoff
    || source.adapterRecoveryHandoffPackage
    || source.syscallAnalysis?.adapterRecoveryHandoffPackage
    || source.syscall?.adapterRecoveryHandoffPackage
    || null;
  if (!packageSource) {
    return {
      format: "aios.mailchimp.approval.syscallRecoveryPreview.v1",
      present: false,
      packageId: null,
      status: "not-provided",
      restartSafe: true,
      acceptedForAdapter: externalHandoffState.status !== "blocked",
      blockedBy: [],
      pendingBy: [],
      rows: [],
      commands: [],
      counters: {
        operations: 0,
        blocked: 0,
        pending: 0,
        restartSafe: 0,
        accepted: 0,
      },
      userVisiblePreview: {
        title: "Mailchimp syscall recovery handoff",
        status: "not-provided",
        rows: [],
        nextAction: externalHandoffState.nextAction || "wait_for_mailchimp_handoff",
      },
      nextAction: externalHandoffState.nextAction || "wait_for_mailchimp_handoff",
    };
  }

  const statusRows = Array.isArray(packageSource.statusRows) ? packageSource.statusRows : [];
  const operationRows = Array.isArray(packageSource.operationRows) ? packageSource.operationRows : [];
  const commandRows = Array.isArray(packageSource.commands) ? packageSource.commands : [];
  const blockedBy = [...new Set([
    ...(Array.isArray(packageSource.blockedBy) ? packageSource.blockedBy : []),
    ...statusRows.flatMap((row) => Array.isArray(row.blockedBy) ? row.blockedBy : []),
  ])].sort();
  const pendingBy = [...new Set([
    ...(Array.isArray(packageSource.pendingBy) ? packageSource.pendingBy : []),
    ...statusRows
      .filter((row) => row.accepted === false && !(Array.isArray(row.blockedBy) && row.blockedBy.length))
      .map((row) => `status:${row.key || "unknown"}:${row.status || "waiting"}`),
  ])].sort();
  const restartSafeRows = statusRows.filter((row) => row.restartSafe === true).length
    + operationRows.filter((row) => row.retrySafe !== false).length;
  const unsafeRows = [
    ...statusRows
      .filter((row) => row.restartSafe === false)
      .map((row) => `status:${row.key || "unknown"}`),
    ...operationRows
      .filter((row) => row.retrySafe === false)
      .map((row) => `operation:${row.operation || "unknown"}`),
  ].sort();
  const externalRows = operationRows.filter((row) => row.kind === "external-write");
  const acceptedForAdapter = packageSource.acceptedForAdapter === true
    && blockedBy.length === 0
    && unsafeRows.length === 0
    && externalHandoffState.status !== "blocked";
  const status = blockedBy.length || unsafeRows.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : acceptedForAdapter
        ? "adapter-ready"
        : packageSource.status || "waiting";
  const nextAction = blockedBy.length
    ? blockedBy[0].startsWith("client-state:")
      ? "repair_client_runtime_state"
      : blockedBy[0].startsWith("tenant:")
        ? "repair_tenant_boundary"
        : packageSource.nextAction || externalHandoffState.nextAction || "repair_syscall_recovery_handoff"
    : unsafeRows.length
      ? "review_restart_safety_before_dispatch"
      : pendingBy.length
        ? pendingBy[0].startsWith("external-write:")
          ? "request_operator_approval"
          : packageSource.nextAction || "wait_for_syscall_recovery_handoff"
        : acceptedForAdapter
          ? externalHandoffState.nextAction || "dispatch_mailchimp_external_handoff"
          : packageSource.nextAction || externalHandoffState.nextAction || "wait_for_mailchimp_handoff";

  return {
    format: "aios.mailchimp.approval.syscallRecoveryPreview.v1",
    present: true,
    packageId: packageSource.packageId || null,
    sourceFormat: packageSource.format || "unknown",
    status,
    restartSafe: packageSource.restartSafe === true && unsafeRows.length === 0,
    acceptedForAdapter,
    stateKeys: packageSource.stateKeys || {},
    blockedBy: [...new Set([...blockedBy, ...unsafeRows.map((row) => `restart-unsafe:${row}`)])].sort(),
    pendingBy,
    rows: [
      ...statusRows.map((row) => ({
        rowType: "status",
        key: row.key || "unknown",
        status: row.status || "unknown",
        accepted: row.accepted === true,
        restartSafe: row.restartSafe === true,
        statusPath: row.statusPath || null,
        nextAction: row.nextAction || nextAction,
      })),
      ...operationRows.map((row) => ({
        rowType: "operation",
        key: row.operation || "unknown",
        status: row.commandEnabled ? "command-ready" : row.retrySafe === false ? "restart-unsafe" : "waiting",
        accepted: row.commandEnabled === true,
        restartSafe: row.retrySafe !== false,
        statusPath: row.statusPath || null,
        nextAction: row.nextAction || nextAction,
      })),
    ],
    commands: commandRows.map((command) => ({
      command: command.command,
      enabled: command.enabled === true && status !== "blocked",
      idempotencyKey: command.idempotencyKey || null,
      operation: command.operation || null,
      statusPath: command.statusPath || null,
    })),
    counters: {
      operations: operationRows.length,
      externalWrite: externalRows.length,
      blocked: blockedBy.length + unsafeRows.length,
      pending: pendingBy.length,
      restartSafe: restartSafeRows,
      accepted: statusRows.filter((row) => row.accepted === true).length
        + operationRows.filter((row) => row.commandEnabled === true).length,
    },
    userVisiblePreview: {
      title: packageSource.userVisiblePreview?.title || "Mailchimp syscall recovery handoff",
      status,
      rows: statusRows.map((row) => ({
        label: row.key || "unknown",
        status: row.status || "unknown",
        accepted: row.accepted === true,
        restartSafe: row.restartSafe === true,
        nextAction: row.nextAction || nextAction,
      })),
      nextAction,
    },
    nextAction,
  };
}

function normalizePackageClientHandoffPreview(source = {}, providerContract = {}, clientRuntimeAdoption = {}, runtimeActionQueue = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const plan = packageAnalysis?.clientHandoffReadiness
    || packageAnalysis?.runtimeContract?.clientHandoffReadiness
    || source?.clientHandoffReadiness
    || source?.runtimeContract?.clientHandoffReadiness
    || null;
  const providerByOperation = new Map((providerContract.capabilities || []).map((row) => [row.operationId, row]));
  const adoptionByOperation = new Map((clientRuntimeAdoption.rows || []).map((row) => [row.operationId, row]));
  const actionByOperation = new Map((runtimeActionQueue.rows || []).map((row) => [row.operationId, row]));

  if (!plan?.planKey) {
    return {
      format: "aios.mailchimp.approval.packageClientHandoffPreview.v1",
      present: false,
      planKey: null,
      status: "not-provided",
      acceptedForDispatch: true,
      blockedBy: [],
      pendingBy: [],
      commands: [],
      rows: [],
      counters: {
        operations: 0,
        ready: 0,
        blocked: 0,
        pending: 0,
        commands: 0,
      },
      userVisibleSummary: {
        title: "Mailchimp client handoff readiness",
        status: "not-provided",
        rows: [],
        nextAction: runtimeActionQueue.nextAction || "wait_for_runtime_action_queue",
      },
      nextAction: runtimeActionQueue.nextAction || "wait_for_runtime_action_queue",
    };
  }

  const rows = (plan.rows || []).map((row) => {
    const providerRow = providerByOperation.get(row.operationId) || {};
    const adoptionRow = adoptionByOperation.get(row.operationId) || {};
    const actionRow = actionByOperation.get(row.operationId) || {};
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `client-handoff:${blocker}`)),
      ...(row.status === "blocked" ? ["client-handoff:blocked"] : []),
      ...(providerRow.status === "metadata-incomplete" ? ["provider:metadata-incomplete"] : []),
      ...(adoptionRow.status === "blocked" ? ["client-adoption:blocked"] : []),
      ...(actionRow.action === "repair" ? [`runtime-action:${actionRow.blockedReason || "repair"}`] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `client-handoff:${pending}`)),
      ...(row.status === "pending" ? ["client-handoff:pending"] : []),
      ...(actionRow.action === "poll" ? ["runtime-action:poll"] : []),
      ...(providerRow.status === "provider-readiness-pending" ? ["provider:readiness-pending"] : []),
    ].sort();
    const acceptedForDispatch = row.acceptedForClient === true
      && blockedBy.length === 0
      && pendingBy.length === 0
      && Boolean(row.requestId || providerRow.requestId || adoptionRow.requestId)
      && Boolean(row.clientStatusPath || providerRow.clientStatusPath || adoptionRow.clientStatusPath);

    return {
      operationId: row.operationId,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : acceptedForDispatch
            ? row.externalWrite ? "approval-ready" : "handoff-ready"
            : "metadata-incomplete",
      acceptedForDispatch,
      externalWrite: row.externalWrite === true,
      visibleState: row.visibleState || (acceptedForDispatch ? "ready_for_handoff" : "waiting"),
      requestId: row.requestId || providerRow.requestId || adoptionRow.requestId || null,
      clientStatusPath: row.clientStatusPath || providerRow.clientStatusPath || adoptionRow.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || providerRow.providerStatusPath || adoptionRow.providerStatusPath || null,
      boundaryStatusPath: row.boundaryStatusPath || providerRow.boundaryStatusPath || adoptionRow.boundaryStatusPath || null,
      replayToken: row.replayToken || actionRow.replayToken || null,
      providerReadinessId: row.providerReadinessId || providerRow.providerReadinessId || null,
      acceptanceKey: row.acceptanceKey || providerRow.packageAcceptanceKey || null,
      exportLedgerKey: row.exportLedgerKey || null,
      commands: row.commands || [],
      blockedBy,
      pendingBy,
      nextAction: blockedBy.length
        ? row.nextAction || "repair_client_handoff_readiness"
        : pendingBy.length
          ? row.nextAction || "wait_for_client_handoff_readiness"
          : row.nextAction || (row.externalWrite ? "present_mailchimp_approval_handoff" : "publish_mailchimp_client_handoff"),
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked" || row.status === "metadata-incomplete");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.acceptedForDispatch);
  const commands = rows.flatMap((row) => row.commands.map((command) => ({
    operationId: row.operationId,
    ...command,
  })));

  return {
    format: "aios.mailchimp.approval.packageClientHandoffPreview.v1",
    present: true,
    planKey: plan.planKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "ready",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.acceptedForDispatch),
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    commands,
    rows,
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      commands: commands.length,
      approvalReady: rows.filter((row) => row.status === "approval-ready").length,
      handoffReady: rows.filter((row) => row.status === "handoff-ready").length,
      providerLinked: rows.filter((row) => row.providerReadinessId).length,
      statusPathLinked: rows.filter((row) => row.clientStatusPath).length,
    },
    userVisibleSummary: {
      title: "Mailchimp client handoff readiness",
      status: blockedRows.length
        ? "blocked"
        : pendingRows.length
          ? "pending"
          : "ready",
      rows: rows.map((row) => ({
        operationId: row.operationId,
        status: row.status,
        visibleState: row.visibleState,
        clientStatusPath: row.clientStatusPath,
        providerStatusPath: row.providerStatusPath,
        nextAction: row.nextAction,
      })),
      nextAction: blockedRows[0]?.nextAction
        || pendingRows[0]?.nextAction
        || "accept_client_handoff_readiness",
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || "accept_client_handoff_readiness",
  };
}

function normalizePackageRestartJournalPreview(source = {}, ownership = {}, runtimeActionQueue = {}, externalHandoffState = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const journal = packageAnalysis?.restartJournal
    || packageAnalysis?.runtimeContract?.restartJournal
    || source?.restartJournal
    || source?.runtimeContract?.restartJournal
    || null;
  const statusEnvelope = packageAnalysis?.restartSafeStatusEnvelope
    || packageAnalysis?.runtimeContract?.restartSafeStatusEnvelope
    || source?.restartSafeStatusEnvelope
    || source?.runtimeContract?.restartSafeStatusEnvelope
    || {};
  const ownershipJournal = ownership?.controlPersistence?.restartJournal || {};
  const actionByOperation = new Map((runtimeActionQueue.rows || []).map((row) => [row.operationId, row]));
  const envelopeByOperation = new Map((statusEnvelope.rows || []).map((row) => [row.operationId, row]));

  if (!journal?.journalId) {
    return {
      format: "aios.mailchimp.approval.packageRestartJournalPreview.v1",
      present: false,
      journalId: ownershipJournal.journalId || null,
      status: ownershipJournal.status || "not-provided",
      acceptedForRuntime: externalHandoffState.status !== "blocked",
      blockedBy: [],
      pendingBy: [],
      rows: [],
      statusCommands: [],
      counters: {
        operations: 0,
        restartSafe: 0,
        blocked: 0,
        pending: 0,
        dispatchBlocked: 0,
        statusEnvelopeBlocked: 0,
        statusEnvelopePending: 0,
      },
      statusEnvelope: {
        present: Boolean(statusEnvelope.envelopeId),
        envelopeId: statusEnvelope.envelopeId || null,
        status: statusEnvelope.status || "not-provided",
        acceptedForRuntime: statusEnvelope.acceptedForRuntime === true,
        counters: statusEnvelope.counters || null,
      },
      nextAction: ownershipJournal.nextAction || externalHandoffState.nextAction || "wait_for_mailchimp_handoff",
    };
  }

  const rows = (journal.rows || []).map((row) => {
    const actionRow = actionByOperation.get(row.operationId) || {};
    const envelopeRow = envelopeByOperation.get(row.operationId) || {};
    const statusPatch = row.statusPatch || {};
    const statusCommand = row.statusCommand || {};
    const statusResolution = row.statusResolution || {};
    const dispatchBlocked = row.status === "blocked"
      || row.status === "operator-review"
      || actionRow.action === "repair"
      || envelopeRow.status === "blocked"
      || envelopeRow.status === "operator-review"
      || statusPatch.patchable === false
      || statusResolution.status === "blocked"
      || statusResolution.status === "operator-review";
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `restart-journal:${blocker}`)),
      ...(row.status === "operator-review" ? ["restart-journal:operator-review"] : []),
      ...(actionRow.action === "repair" ? [`runtime-action:${actionRow.blockedReason || "repair-required"}`] : []),
      ...(statusPatch.patchable === false
        ? (statusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `restart-status:${blocker}`)
        : []),
      ...(statusResolution.status === "blocked" ? ["restart-resolution:blocked"] : []),
      ...(statusResolution.status === "operator-review" ? ["restart-resolution:operator-review"] : []),
      ...((statusResolution.blockedBy || []).map((blocker) => `restart-resolution:${blocker}`)),
      ...(statusEnvelope.envelopeId && !envelopeRow.operationId ? ["restart-status-envelope:row-missing"] : []),
      ...(envelopeRow.status === "blocked" ? [`restart-status-envelope:${envelopeRow.nextAction || "blocked"}`] : []),
      ...(envelopeRow.status === "operator-review" ? ["restart-status-envelope:operator-review"] : []),
      ...((envelopeRow.blockedBy || []).map((blocker) => `restart-status-envelope:${blocker}`)),
      ...(envelopeRow.command?.enabled === false && envelopeRow.status !== "blocked" ? ["restart-status-envelope:command-disabled"] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `restart-journal:${pending}`)),
      ...(row.status === "pending" ? ["restart-journal:pending"] : []),
      ...(statusPatch.patchable === true && statusCommand.enabled !== true ? ["restart-status:publish-pending"] : []),
      ...(statusResolution.status === "pending" ? ["restart-resolution:pending"] : []),
      ...((statusResolution.pendingBy || []).map((pending) => `restart-resolution:${pending}`)),
      ...(envelopeRow.status === "pending" ? ["restart-status-envelope:pending"] : []),
      ...((envelopeRow.pendingBy || []).map((pending) => `restart-status-envelope:${pending}`)),
    ].sort();

    return {
      operationId: row.operationId,
      journalEntryId: row.journalEntryId || null,
      status: row.status || "unknown",
      restartSafe: row.restartSafe === true,
      dispatchBlocked,
      blockedBy,
      pendingBy,
      requestId: row.requestId || actionRow.requestId || null,
      statusPath: row.statusPath || actionRow.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || actionRow.providerStatusPath || null,
      snapshotKey: row.snapshotKey || null,
      ledgerKey: row.ledgerKey || null,
      adapterCheckpointId: row.adapterCheckpointId || null,
      transitionToken: row.transitionToken || null,
      statusEnvelopeId: statusEnvelope.envelopeId || null,
      statusEnvelopeStatus: envelopeRow.status || "unknown",
      statusEnvelopeRestartSafe: envelopeRow.restartSafe === true,
      statusEnvelopeCommandId: envelopeRow.command?.commandId || null,
      statusEnvelopeCommandEnabled: envelopeRow.command?.enabled === true && blockedBy.length === 0,
      commandEnabled: row.command?.enabled === true,
      statusPatch: {
        patchId: statusPatch.patchId || null,
        patchable: statusPatch.patchable === true && blockedBy.length === 0,
        state: statusPatch.state || row.status || "unknown",
        visibleState: statusPatch.visibleState || null,
        statusPath: statusPatch.statusPath || row.statusPath || actionRow.clientStatusPath || null,
        providerStatusPath: statusPatch.providerStatusPath || row.providerStatusPath || actionRow.providerStatusPath || null,
        blockedBy: statusPatch.blockedBy || [],
        fields: statusPatch.fields || null,
        nextAction: statusPatch.nextAction || null,
      },
      statusCommand: {
        commandId: envelopeRow.command?.commandId || null,
        command: envelopeRow.command?.command || statusCommand.command || "publish-restart-status-patch",
        enabled: (envelopeRow.command?.enabled === true || statusCommand.enabled === true) && blockedBy.length === 0,
        idempotencyKey: envelopeRow.command?.idempotencyKey || statusCommand.idempotencyKey || null,
        statusPath: envelopeRow.command?.statusPath || statusCommand.statusPath || statusPatch.statusPath || row.statusPath || null,
        providerStatusPath: envelopeRow.command?.providerStatusPath || statusCommand.providerStatusPath || statusPatch.providerStatusPath || row.providerStatusPath || null,
        patch: statusCommand.patch || statusPatch.fields || null,
      },
      statusResolution: {
        resolutionId: statusResolution.resolutionId || null,
        status: statusResolution.status || "unknown",
        restartSafe: statusResolution.restartSafe === true,
        terminalState: statusResolution.terminalState || null,
        observedState: statusResolution.observed?.state || null,
        observedPatchId: statusResolution.observed?.patchId || null,
        expectedPatchId: statusResolution.expected?.patchId || statusPatch.patchId || null,
        commandEnabled: statusResolution.command?.enabled === true && blockedBy.length === 0,
        blockedBy: statusResolution.blockedBy || [],
        pendingBy: statusResolution.pendingBy || [],
        nextAction: statusResolution.nextAction || null,
      },
      nextAction: dispatchBlocked
        ? statusResolution.status === "blocked" || statusResolution.status === "operator-review"
          ? statusResolution.nextAction || "repair_restart_status_resolution"
          : statusPatch.patchable === false
          ? statusPatch.nextAction || row.nextAction || "repair_restart_status_patch"
          : envelopeRow.status === "blocked" || envelopeRow.status === "operator-review"
            ? envelopeRow.nextAction || statusEnvelope.nextAction || "repair_restart_safe_status_envelope"
          : row.nextAction || actionRow.nextAction || "repair_restart_journal"
        : pendingBy.length
          ? pendingBy[0].startsWith("restart-status:")
            ? "publish_restart_status_patch"
            : row.nextAction || "wait_for_restart_journal"
          : row.nextAction || "persist_restart_journal_entry",
    };
  });
  const blockedRows = rows.filter((row) => row.dispatchBlocked || row.blockedBy.length);
  const pendingRows = rows.filter((row) => !row.dispatchBlocked && row.pendingBy.length);
  const restartSafeRows = rows.filter((row) => row.restartSafe);

  return {
    format: "aios.mailchimp.approval.packageRestartJournalPreview.v1",
    present: true,
    journalId: journal.journalId,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : restartSafeRows.length === rows.length
          ? "restart-safe"
          : "operator-review",
    acceptedForRuntime: journal.acceptedForRuntime === true && blockedRows.length === 0,
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy.length ? row.blockedBy : [`restart-journal:${row.status}`]))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    rows,
    counters: {
      operations: rows.length,
      restartSafe: restartSafeRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      dispatchBlocked: rows.filter((row) => row.dispatchBlocked).length,
      commandEnabled: rows.filter((row) => row.commandEnabled).length,
      statusPatchable: rows.filter((row) => row.statusPatch.patchable).length,
      statusPatchBlocked: rows.filter((row) => row.statusPatch.patchable === false).length,
      statusCommandEnabled: rows.filter((row) => row.statusCommand.enabled).length,
      statusPathLinked: rows.filter((row) => row.statusPath).length,
      statusResolutionReady: rows.filter((row) => row.statusResolution.status === "resume-ready").length,
      statusResolutionBlocked: rows.filter((row) => row.statusResolution.status === "blocked").length,
      statusResolutionPending: rows.filter((row) => row.statusResolution.status === "pending").length,
      statusResolutionTerminal: rows.filter((row) => row.statusResolution.status === "terminal-observed").length,
      statusResolutionCommandEnabled: rows.filter((row) => row.statusResolution.commandEnabled).length,
      statusEnvelopeLinked: rows.filter((row) => row.statusEnvelopeId).length,
      statusEnvelopeRestartSafe: rows.filter((row) => row.statusEnvelopeRestartSafe).length,
      statusEnvelopeBlocked: rows.filter((row) => row.blockedBy.some((blocker) => blocker.startsWith("restart-status-envelope:"))).length,
      statusEnvelopePending: rows.filter((row) => row.pendingBy.some((pending) => pending.startsWith("restart-status-envelope:"))).length,
      statusEnvelopeCommandEnabled: rows.filter((row) => row.statusEnvelopeCommandEnabled).length,
    },
    statusEnvelope: {
      present: Boolean(statusEnvelope.envelopeId),
      envelopeId: statusEnvelope.envelopeId || null,
      status: statusEnvelope.status || "not-provided",
      acceptedForRuntime: statusEnvelope.acceptedForRuntime === true,
      blockedOperationIds: statusEnvelope.blockedOperationIds || [],
      pendingOperationIds: statusEnvelope.pendingOperationIds || [],
      restartSafeOperationIds: statusEnvelope.restartSafeOperationIds || [],
      counters: statusEnvelope.counters || null,
      commands: statusEnvelope.commands || [],
      nextAction: statusEnvelope.nextAction || null,
    },
    statusCommands: rows.map((row) => row.statusCommand),
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || journal.nextAction
      || "publish_restart_journal",
  };
}

function normalizePackagePersistedStatusRecoveryPreview(source = {}, runtimeActionQueue = {}, packageRestartJournalPreview = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const ledger = packageAnalysis?.persistedStatusRecoveryLedger
    || packageAnalysis?.runtimeContract?.persistedStatusRecoveryLedger
    || source?.persistedStatusRecoveryLedger
    || source?.runtimeContract?.persistedStatusRecoveryLedger
    || null;
  const actionByOperation = new Map((runtimeActionQueue.rows || []).map((row) => [row.operationId, row]));
  const restartByOperation = new Map((packageRestartJournalPreview.rows || []).map((row) => [row.operationId, row]));

  if (!ledger?.ledgerKey) {
    return {
      format: "aios.mailchimp.approval.packagePersistedStatusRecoveryPreview.v1",
      present: false,
      ledgerKey: null,
      status: "not-provided",
      acceptedForDispatch: true,
      blockedBy: [],
      pendingBy: [],
      rows: [],
      commands: [],
      counters: {
        operations: 0,
        resumeReady: 0,
        observeOnly: 0,
        blocked: 0,
        pending: 0,
        patchable: 0,
        commandEnabled: 0,
      },
      nextAction: packageRestartJournalPreview.nextAction || runtimeActionQueue.nextAction || "wait_for_runtime_action_queue",
    };
  }

  const rows = (ledger.rows || []).map((row) => {
    const actionRow = actionByOperation.get(row.operationId) || {};
    const restartRow = restartByOperation.get(row.operationId) || {};
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `persisted-status:${blocker}`)),
      ...(row.status === "blocked" ? ["persisted-status:blocked"] : []),
      ...(row.acceptedForAdapter === false && row.status !== "pending" ? ["persisted-status:not-adapter-ready"] : []),
      ...(row.statusPatch?.patchable === false
        ? (row.statusPatch.blockedBy || ["status-patch"]).map((blocker) => `persisted-status-patch:${blocker}`)
        : []),
      ...(restartRow.status === "blocked" || restartRow.dispatchBlocked ? ["restart-journal:blocked"] : []),
      ...(actionRow.action === "repair" ? [`runtime-action:${actionRow.blockedReason || "repair"}`] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `persisted-status:${pending}`)),
      ...(row.status === "pending" ? ["persisted-status:pending"] : []),
      ...(restartRow.status === "pending" ? ["restart-journal:pending"] : []),
      ...(actionRow.action === "poll" ? ["runtime-action:poll"] : []),
      ...(row.command?.enabled === true && row.statusPatch?.patchable === true && row.status !== "resume-ready"
        ? ["persisted-status:publish-pending"]
        : []),
    ].sort();
    const acceptedForDispatch = blockedBy.length === 0
      && pendingBy.length === 0
      && row.acceptedForAdapter !== false;

    return {
      operationId: row.operationId,
      ledgerEntryId: row.ledgerEntryId || null,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : row.status || "observe-only",
      acceptedForDispatch,
      restartSafe: row.restartSafe === true,
      recoveryMode: row.recoveryMode || "observe",
      requestId: row.requestId || actionRow.requestId || null,
      statusPath: row.statusPath || actionRow.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || actionRow.providerStatusPath || null,
      snapshotKey: row.snapshotKey || null,
      ledgerKey: row.ledgerKey || null,
      checkpointKey: row.checkpointKey || null,
      blockedBy,
      pendingBy,
      statusPatch: {
        patchId: row.statusPatch?.patchId || null,
        patchable: row.statusPatch?.patchable === true && blockedBy.length === 0,
        statusPath: row.statusPatch?.statusPath || row.statusPath || null,
        providerStatusPath: row.statusPatch?.providerStatusPath || row.providerStatusPath || null,
        state: row.statusPatch?.state || row.status || "unknown",
        visibleState: row.statusPatch?.visibleState || null,
        fields: row.statusPatch?.fields || null,
        blockedBy: row.statusPatch?.blockedBy || [],
        pendingBy: row.statusPatch?.pendingBy || [],
        nextAction: row.statusPatch?.nextAction || null,
      },
      command: {
        commandId: row.command?.commandId || null,
        command: row.command?.command || "publish-persisted-status-recovery",
        enabled: row.command?.enabled === true && blockedBy.length === 0,
        idempotent: row.command?.idempotent !== false,
        idempotencyKey: row.command?.idempotencyKey || null,
        statusPath: row.command?.statusPath || row.statusPath || null,
        providerStatusPath: row.command?.providerStatusPath || row.providerStatusPath || null,
        patchId: row.command?.patchId || row.statusPatch?.patchId || null,
      },
      nextAction: blockedBy.length
        ? row.nextAction || "repair_persisted_status_recovery"
        : pendingBy.length
          ? row.nextAction || "publish_persisted_status_recovery"
          : row.nextAction || "accept_persisted_status_recovery",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const resumeRows = rows.filter((row) => row.status === "resume-ready");
  const commands = rows.map((row) => row.command).filter((command) => command.enabled);

  return {
    format: "aios.mailchimp.approval.packagePersistedStatusRecoveryPreview.v1",
    present: true,
    ledgerKey: ledger.ledgerKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : resumeRows.length === rows.length
          ? "resume-ready"
          : "observe-only",
    acceptedForDispatch: blockedRows.length === 0 && pendingRows.length === 0,
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    rows,
    commands,
    counters: {
      operations: rows.length,
      resumeReady: resumeRows.length,
      observeOnly: rows.filter((row) => row.status === "observe-only").length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      commandEnabled: commands.length,
      providerLinked: rows.filter((row) => row.providerStatusPath).length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
    },
    userVisibleSummary: blockedRows.length
      ? `${blockedRows.length} Mailchimp persisted recovery row(s) need repair before dispatch.`
      : pendingRows.length
        ? `${pendingRows.length} Mailchimp persisted recovery row(s) are waiting for status publication.`
        : "Mailchimp persisted recovery status is ready for dispatch.",
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || ledger.nextAction
      || "accept_persisted_status_recovery",
  };
}

function normalizePackagePermissionBoundaryPreview(source = {}, ownership = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const handoff = packageAnalysis?.permissionBoundaryHandoff
    || packageAnalysis?.runtimeContract?.permissionBoundaryHandoff
    || source?.permissionBoundaryHandoff
    || source?.runtimeContract?.permissionBoundaryHandoff
    || null;
  const enforcementMatrix = packageAnalysis?.tenantPermissionEnforcementMatrix
    || packageAnalysis?.runtimeContract?.tenantPermissionEnforcementMatrix
    || source?.tenantPermissionEnforcementMatrix
    || source?.runtimeContract?.tenantPermissionEnforcementMatrix
    || {};
  const actionQueue = packageAnalysis?.tenantBoundaryActionQueue
    || packageAnalysis?.runtimeContract?.tenantBoundaryActionQueue
    || source?.tenantBoundaryActionQueue
    || source?.runtimeContract?.tenantBoundaryActionQueue
    || {};
  const releaseLedger = enforcementMatrix.releaseLedger || {};
  const enforcementByOperation = new Map((enforcementMatrix.rows || []).map((row) => [row.operationId, row]));
  const releaseByOperation = new Map((releaseLedger.rows || []).map((row) => [row.operationId, row]));
  const actionByOperation = new Map((actionQueue.rows || []).map((row) => [row.operationId, row]));
  const ownershipEnvelope = ownership?.providerHandoffEnvelope || {};
  const envelopeByOperation = new Map((ownershipEnvelope.rows || []).map((row) => [row.operationId, row]));

  if (!handoff?.handoffKey) {
    return {
      format: "aios.mailchimp.approval.packagePermissionBoundaryPreview.v1",
      present: false,
      handoffKey: null,
      status: "not-provided",
      acceptedForDispatch: true,
      blockedBy: [],
      pendingBy: [],
      rows: [],
      commands: [],
      counters: {
        operations: 0,
        ready: 0,
        blocked: 0,
        pending: 0,
        statusPatchable: 0,
        statusPatchBlocked: 0,
        enforcementBlocked: 0,
        enforcementPending: 0,
        enforcementAccepted: 0,
        actionQueueBlocked: 0,
        actionQueuePending: 0,
        actionQueueAccepted: 0,
      },
      nextAction: ownershipEnvelope.nextAction || "wait_for_permission_boundary_handoff",
    };
  }

  const rows = (handoff.rows || []).map((row) => {
    const envelopeRow = envelopeByOperation.get(row.operationId) || {};
    const enforcementRow = enforcementByOperation.get(row.operationId) || {};
    const releaseRow = enforcementRow.release || releaseByOperation.get(row.operationId) || {};
    const actionRow = actionByOperation.get(row.operationId) || {};
    const statusPatch = row.statusPatch || {};
    const boundaryEvidence = row.boundaryEvidence || {};
    const boundaryEvidencePatch = boundaryEvidence.statusPatch || {};
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `package-permission:${blocker}`)),
      ...(row.status === "blocked" ? ["package-permission:blocked"] : []),
      ...(boundaryEvidence.acceptedForBoundary === false
        ? (boundaryEvidence.missingFields || ["not-accepted"]).map((field) => `boundary-evidence:${field}`)
        : []),
      ...(boundaryEvidencePatch.state === "boundary-evidence-blocked"
        ? (boundaryEvidencePatch.blockedBy || ["status-patch"]).map((field) => `boundary-evidence-status:${field}`)
        : []),
      ...(statusPatch.patchable === false
        ? (statusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `package-permission-status:${blocker}`)
        : []),
      ...(enforcementRow.status === "blocked"
        ? (enforcementRow.blockedBy || ["blocked"]).map((blocker) => `tenant-permission:${blocker}`)
        : []),
      ...(enforcementRow.statusPatch?.patchable === false
        ? (enforcementRow.statusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `tenant-permission-status:${blocker}`)
        : []),
      ...(releaseRow.status === "blocked"
        ? (releaseRow.blockedBy || ["blocked"]).map((blocker) => `tenant-permission-release:${blocker}`)
        : []),
      ...(actionRow.status === "blocked"
        ? (actionRow.blockedBy || ["blocked"]).map((blocker) => `tenant-boundary-action:${blocker}`)
        : []),
      ...(actionRow.statusPatch?.patchable === false
        ? (actionRow.statusPatch.blockedBy || ["status-patch-not-ready"]).map((blocker) => `tenant-boundary-action-status:${blocker}`)
        : []),
      ...(envelopeRow.payloadReady === false ? ["ownership-envelope:payload-not-ready"] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `package-permission:${pending}`)),
      ...(row.status === "pending" ? ["package-permission:pending"] : []),
      ...(statusPatch.patchable === true && !(row.commands || []).some((command) => (
        command.command === "publish-package-permission-status" && command.enabled === true
      )) ? ["package-permission-status:publish-pending"] : []),
      ...(boundaryEvidence.acceptedForBoundary === true
        && boundaryEvidencePatch.fields
        && !(row.commands || []).some((command) => (
          command.command === "publish-boundary-evidence-status" && command.enabled === true
        )) ? ["boundary-evidence-status:publish-pending"] : []),
      ...(enforcementRow.status === "pending"
        ? (enforcementRow.pendingBy || ["pending"]).map((pending) => `tenant-permission:${pending}`)
        : []),
      ...(enforcementRow.acceptedForHandoff === true
        && enforcementRow.statusPatch?.patchable === true
        && !(enforcementRow.commands || []).some((command) => (
          command.command === "publish-tenant-permission-enforcement" && command.enabled === true
        )) ? ["tenant-permission-status:publish-pending"] : []),
      ...(releaseRow.status === "pending"
        ? (releaseRow.pendingBy || ["pending"]).map((pending) => `tenant-permission-release:${pending}`)
        : []),
      ...(actionRow.status === "pending"
        ? (actionRow.pendingBy || ["pending"]).map((pending) => `tenant-boundary-action:${pending}`)
        : []),
      ...(actionRow.status === "ready"
        && actionRow.statusPatch?.patchable === true
        && !(actionRow.commands || []).some((command) => command.enabled === true)
        ? ["tenant-boundary-action-status:publish-pending"] : []),
    ].sort();
    const acceptedForDispatch = blockedBy.length === 0
      && row.acceptedForDispatch !== false
      && row.status !== "blocked"
      && statusPatch.patchable !== false
      && enforcementRow.status !== "blocked"
      && enforcementRow.status !== "pending"
      && releaseRow.status !== "blocked"
      && releaseRow.status !== "pending"
      && releaseRow.ready !== false
      && actionRow.status !== "blocked"
      && actionRow.status !== "pending"
      && actionRow.acceptedForRuntime !== false;

    return {
      operationId: row.operationId,
      packetId: row.packetId || null,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : row.status || "ready",
      acceptedForDispatch,
      externalWrite: row.externalWrite === true,
      requestId: row.requestId || envelopeRow.requestId || null,
      clientStatusPath: row.clientStatusPath || envelopeRow.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || envelopeRow.providerStatusPath || null,
      boundaryStatusPath: row.boundaryStatusPath || envelopeRow.permissionBoundary?.boundary?.statusPath || null,
      boundaryKey: row.boundary?.boundaryKey || envelopeRow.boundaryKey || null,
      requiredRoles: row.boundary?.requiredRoles || envelopeRow.requiredRoles || [],
      boundaryEvidence: {
        packetId: boundaryEvidence.packetId || null,
        status: boundaryEvidence.status || "unknown",
        acceptedForBoundary: boundaryEvidence.acceptedForBoundary === true,
        requiredFields: boundaryEvidence.requiredFields || [],
        missingFields: boundaryEvidence.missingFields || [],
        tenant: boundaryEvidence.scope?.tenant || row.boundary?.tenant || null,
        workspace: boundaryEvidence.scope?.workspace || row.boundary?.workspace || null,
        allowedRoles: boundaryEvidence.roles?.allowed || row.boundary?.requiredRoles || [],
        auditRequired: boundaryEvidence.audit?.required === true,
        leaseRequired: boundaryEvidence.lease?.required === true,
        requestId: boundaryEvidence.request?.requestId || row.requestId || null,
        statusPatch: {
          patchId: boundaryEvidencePatch.patchId || null,
          statusPath: boundaryEvidencePatch.statusPath || row.boundaryStatusPath || null,
          state: boundaryEvidencePatch.state || "unknown",
          patchable: Boolean(boundaryEvidencePatch.fields) && blockedBy.every((blocker) => !blocker.startsWith("boundary-evidence")),
          blockedBy: boundaryEvidencePatch.blockedBy || [],
          nextAction: boundaryEvidencePatch.nextAction || null,
        },
        nextAction: boundaryEvidence.nextAction || null,
      },
      tenantPermissionEnforcement: {
        matrixKey: enforcementMatrix.matrixKey || null,
        enforcementId: enforcementRow.enforcementId || null,
        releaseLedgerKey: releaseLedger.ledgerKey || null,
        status: enforcementRow.status || (enforcementMatrix.matrixKey ? "missing-row" : "not-provided"),
        acceptedForHandoff: enforcementRow.acceptedForHandoff === true,
        boundaryKey: enforcementRow.boundaryKey || row.boundary?.boundaryKey || null,
        blockedBy: enforcementRow.blockedBy || [],
        pendingBy: enforcementRow.pendingBy || [],
        statusPatch: {
          patchId: enforcementRow.statusPatch?.patchId || null,
          patchable: enforcementRow.statusPatch?.patchable === true && blockedBy.every((blocker) => !blocker.startsWith("tenant-permission")),
          statusPath: enforcementRow.statusPatch?.statusPath || statusPatch.statusPath || row.clientStatusPath || null,
          providerStatusPath: enforcementRow.statusPatch?.providerStatusPath || row.providerStatusPath || null,
          state: enforcementRow.statusPatch?.state || enforcementRow.status || "unknown",
          nextAction: enforcementRow.statusPatch?.nextAction || null,
        },
        commands: (enforcementRow.commands || []).map((command) => ({
          command: command.command || "unknown",
          enabled: command.enabled === true && blockedBy.length === 0,
          idempotencyKey: command.idempotencyKey || null,
          statusPath: command.statusPath || null,
        })),
        release: {
          releaseId: releaseRow.releaseId || null,
          status: releaseRow.status || (releaseLedger.ledgerKey ? "missing-row" : "not-provided"),
          ready: releaseRow.ready === true && blockedBy.every((blocker) => !blocker.startsWith("tenant-permission-release:")),
          mode: releaseRow.mode || (row.externalWrite ? "external-write-lease" : "delegated-read"),
          requestId: releaseRow.requestId || row.requestId || null,
          clientStatusPath: releaseRow.clientStatusPath || row.clientStatusPath || null,
          providerStatusPath: releaseRow.providerStatusPath || row.providerStatusPath || null,
          blockedBy: releaseRow.blockedBy || [],
          pendingBy: releaseRow.pendingBy || [],
          nextAction: releaseRow.nextAction || null,
        },
        nextAction: enforcementRow.nextAction || null,
      },
      tenantBoundaryAction: {
        queueKey: actionQueue.queueKey || null,
        queueId: actionRow.queueId || null,
        status: actionRow.status || (actionQueue.queueKey ? "missing-row" : "not-provided"),
        acceptedForRuntime: actionRow.acceptedForRuntime === true,
        action: actionRow.action || "observe",
        commandEnabled: (actionRow.commands || []).some((command) => command.enabled === true),
        blockedBy: actionRow.blockedBy || [],
        pendingBy: actionRow.pendingBy || [],
        statusPatch: {
          patchId: actionRow.statusPatch?.patchId || null,
          patchable: actionRow.statusPatch?.patchable === true && blockedBy.every((blocker) => !blocker.startsWith("tenant-boundary-action")),
          statusPath: actionRow.statusPatch?.statusPath || row.clientStatusPath || null,
          providerStatusPath: actionRow.statusPatch?.providerStatusPath || row.providerStatusPath || null,
          state: actionRow.statusPatch?.state || actionRow.status || "unknown",
          nextAction: actionRow.statusPatch?.nextAction || null,
        },
        nextAction: actionRow.statusPatch?.nextAction || actionRow.nextAction || null,
      },
      restartJournalEntryId: row.restartJournalEntryId || null,
      adapterCheckpointId: row.adapterCheckpointId || null,
      transitionToken: row.transitionToken || null,
      blockedBy,
      pendingBy,
      statusPatch: {
        patchId: statusPatch.patchId || null,
        patchable: statusPatch.patchable === true && blockedBy.length === 0,
        statusPath: statusPatch.statusPath || row.clientStatusPath || null,
        providerStatusPath: statusPatch.providerStatusPath || row.providerStatusPath || null,
        state: statusPatch.state || row.status || "unknown",
        visibleState: statusPatch.visibleState || null,
        blockedBy: statusPatch.blockedBy || [],
        fields: statusPatch.fields || null,
        nextAction: statusPatch.nextAction || null,
      },
      commands: (row.commands || []).map((command) => ({
        command: command.command || "unknown",
        enabled: command.enabled === true && blockedBy.length === 0,
        idempotencyKey: command.idempotencyKey || null,
        statusPath: command.statusPath || statusPatch.statusPath || null,
        patch: command.patch || null,
      })),
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("package-permission-status:")
          ? statusPatch.nextAction || "repair_package_permission_status"
          : blockedBy[0].startsWith("boundary-evidence:")
            ? boundaryEvidence.nextAction || "repair_boundary_evidence_packet"
          : blockedBy[0].startsWith("boundary-evidence-status:")
            ? boundaryEvidencePatch.nextAction || "publish_boundary_evidence_status"
          : blockedBy[0].startsWith("ownership-envelope:")
            ? ownershipEnvelope.nextAction || "repair_ownership_provider_handoff"
            : blockedBy[0].startsWith("tenant-permission-status:")
              ? enforcementRow.statusPatch?.nextAction || "publish_tenant_permission_enforcement_status"
              : blockedBy[0].startsWith("tenant-permission-release:")
                ? releaseRow.nextAction || "repair_tenant_permission_release"
              : blockedBy[0].startsWith("tenant-permission:")
                ? enforcementRow.nextAction || "repair_tenant_permission_enforcement"
              : blockedBy[0].startsWith("tenant-boundary-action-status:")
                ? actionRow.statusPatch?.nextAction || "repair_tenant_boundary_action_status"
              : blockedBy[0].startsWith("tenant-boundary-action:")
                ? actionRow.statusPatch?.nextAction || "repair_tenant_boundary_action"
            : row.nextAction || "repair_package_permission_boundary"
        : pendingBy.length
          ? pendingBy[0].startsWith("package-permission-status:")
            ? "publish_package_permission_status"
            : pendingBy[0].startsWith("boundary-evidence-status:")
              ? "publish_boundary_evidence_status"
              : pendingBy[0].startsWith("tenant-permission-status:")
                ? "publish_tenant_permission_enforcement_status"
                : pendingBy[0].startsWith("tenant-permission-release:")
                  ? releaseRow.nextAction || "publish_tenant_permission_release_status"
                : pendingBy[0].startsWith("tenant-permission:")
                  ? enforcementRow.nextAction || "wait_for_tenant_permission_enforcement"
                : pendingBy[0].startsWith("tenant-boundary-action-status:")
                  ? actionRow.statusPatch?.nextAction || "publish_tenant_boundary_action_status"
                : pendingBy[0].startsWith("tenant-boundary-action:")
                  ? actionRow.statusPatch?.nextAction || "wait_for_tenant_boundary_action"
            : row.nextAction || "wait_for_package_permission_boundary"
          : row.nextAction || "accept_package_permission_boundary",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.acceptedForDispatch);

  return {
    format: "aios.mailchimp.approval.packagePermissionBoundaryPreview.v1",
    present: true,
    handoffKey: handoff.handoffKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : "ready",
    acceptedForDispatch: blockedRows.length === 0 && rows.every((row) => row.acceptedForDispatch),
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    rows,
    commands: rows.flatMap((row) => row.commands),
    counters: {
      operations: rows.length,
      ready: readyRows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      externalWrite: rows.filter((row) => row.externalWrite).length,
      statusPatchable: rows.filter((row) => row.statusPatch.patchable).length,
      statusPatchBlocked: rows.filter((row) => row.statusPatch.patchable === false).length,
      boundaryEvidenceReady: rows.filter((row) => row.boundaryEvidence.acceptedForBoundary).length,
      boundaryEvidenceBlocked: rows.filter((row) => row.boundaryEvidence.acceptedForBoundary === false).length,
      boundaryEvidenceStatusPatchable: rows.filter((row) => row.boundaryEvidence.statusPatch.patchable).length,
      enforcementAccepted: rows.filter((row) => row.tenantPermissionEnforcement.acceptedForHandoff).length,
      enforcementBlocked: rows.filter((row) => row.tenantPermissionEnforcement.status === "blocked").length,
      enforcementPending: rows.filter((row) => row.tenantPermissionEnforcement.status === "pending").length,
      enforcementStatusPatchable: rows.filter((row) => row.tenantPermissionEnforcement.statusPatch.patchable).length,
      enforcementReleaseReady: rows.filter((row) => row.tenantPermissionEnforcement.release.ready).length,
      enforcementReleaseBlocked: rows.filter((row) => row.tenantPermissionEnforcement.release.status === "blocked").length,
      enforcementReleasePending: rows.filter((row) => row.tenantPermissionEnforcement.release.status === "pending").length,
      actionQueueAccepted: rows.filter((row) => row.tenantBoundaryAction.acceptedForRuntime).length,
      actionQueueBlocked: rows.filter((row) => row.tenantBoundaryAction.status === "blocked").length,
      actionQueuePending: rows.filter((row) => row.tenantBoundaryAction.status === "pending").length,
      actionQueuePatchable: rows.filter((row) => row.tenantBoundaryAction.statusPatch.patchable).length,
      actionQueueCommandEnabled: rows.filter((row) => row.tenantBoundaryAction.commandEnabled).length,
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || handoff.nextAction
      || "accept_package_permission_boundary",
  };
}

function buildClientRuntimeAdoptionContract(ownership, truth, gates, timeline, providerContract, lifecycleCommand, packageAcceptance = null) {
  const previewByOperation = new Map((truth?.preview?.rows || []).map((row) => [row.operationId, row]));
  const providerByOperation = new Map((providerContract.capabilities || []).map((row) => [row.operationId, row]));
  const ownershipByOperation = new Map((ownership?.providerSync?.rows || []).map((row) => [row.operationId, row]));
  const packageAcceptanceByOperation = new Map((packageAcceptance?.rows || []).map((row) => [row.operationId, row]));
  const truthByOperation = new Map((truth?.operations || []).map((operation) => [operation.operationId, operation]));
  const rows = timeline.map((event) => {
    const preview = previewByOperation.get(event.operationId) || {};
    const provider = providerByOperation.get(event.operationId) || {};
    const ownershipSync = ownershipByOperation.get(event.operationId) || {};
    const packageRow = packageAcceptanceByOperation.get(event.operationId) || {};
    const truthOperation = truthByOperation.get(event.operationId) || {};
    const truthAdoption = truthOperation.boundaryScope?.clientRuntimeAdoption || {};
    const gate = gates.find((entry) => entry.operationId === event.operationId) || {};
    const clientStatusPath = event.clientStatusPath
      || packageRow.clientHandoff?.statusPath
      || preview.clientHandoff?.statusPath
      || provider.clientStatusPath
      || ownershipSync.clientStatusPath
      || truthAdoption.expectedStatusPath
      || null;
    const adoptionKey = preview.adoptionKey
      || truthAdoption.adoptionKey
      || ownershipSync.adoptionKey
      || packageRow.adoptionKey
      || null;
    const expectedReceiptId = truthAdoption.expectedReceiptId
      || ownershipSync.clientHandoffReceiptId
      || null;
    const observedReceiptId = truthAdoption.observedReceiptId || null;
    const receiptBlocked = truthAdoption.receiptReady === false
      || truthAdoption.receiptMatches === false
      || ownershipSync.clientHandoffReceiptAccepted === false
      || ownershipSync.clientHandoffReceiptMatches === false;
    const adoptionBlocked = truthAdoption.acceptedForClient === false
      || truthAdoption.metadataMatches === false
      || truthAdoption.boundaryMatches === false
      || truthAdoption.handoffAllowed === false
      || receiptBlocked
      || String(truthAdoption.status || "").startsWith("blocked:");
    const blockedReason = event.schedule?.blockedReason
      || gate.blockedReason
      || (adoptionBlocked ? "client-runtime-adoption" : "")
      || (provider.status === "recovery-checkpoint-blocked" ? "recovery-checkpoint" : "")
      || (provider.status === "package-acceptance-blocked" || packageRow.accepted === false ? "package-acceptance" : "")
      || (preview.accepted === false ? "truth-preview" : "")
      || (provider.status === "lifecycle-blocked" ? "lifecycle" : "");
    const status = blockedReason
      ? `blocked:${blockedReason}`
      : provider.status === "lease-ready" || provider.status === "delegated-ready"
        ? "adoptable"
        : event.status;

    return {
      operationId: event.operationId,
      status,
      blockedReason,
      requestId: event.requestId || provider.requestId || ownershipSync.requestId || null,
      clientStatusPath,
      adoptionKey,
      adoptionStatus: truthAdoption.status || ownershipSync.adoptionStatus || "unknown",
      adoptionAccepted: truthAdoption.acceptedForClient !== false && !adoptionBlocked,
      adoptionDrift: ownershipSync.adoptionDrift || [],
      clientHandoffReceiptId: expectedReceiptId,
      observedClientHandoffReceiptId: observedReceiptId,
      clientHandoffReceiptState: ownershipSync.clientHandoffReceiptState || "unknown",
      clientHandoffReceiptAccepted: truthAdoption.receiptReady !== false && ownershipSync.clientHandoffReceiptAccepted !== false,
      clientHandoffReceiptMatches: truthAdoption.receiptMatches !== false && ownershipSync.clientHandoffReceiptMatches !== false,
      providerStatus: provider.status || "unknown",
      packageAcceptanceKey: packageAcceptance?.acceptanceKey || provider.packageAcceptanceKey || ownershipSync.packageAcceptanceKey || null,
      packageAcceptanceStatus: packageRow.readiness || provider.packageAcceptanceStatus || ownershipSync.packageAcceptanceStatus || "unknown",
      providerTruthStatus: provider.providerTruthStatus || "unknown",
      recoveryCheckpointId: provider.recoveryCheckpointId || ownershipSync.recoveryCheckpointId || null,
      recoveryCheckpointStatus: provider.recoveryCheckpointStatus || ownershipSync.recoveryCheckpointStatus || "unknown",
      recoveryCheckpointReplaySafe: provider.recoveryCheckpointReplaySafe === true || ownershipSync.recoveryCheckpointReplaySafe === true,
      providerStatusPath: provider.providerStatusPath || preview.providerStatusPath || null,
      previewReadiness: preview.readiness || "unknown",
      lifecycleStatus: provider.lifecycleStatus || ownershipSync.lifecycleStatus || preview.lifecycleStatus || "unknown",
      visibleToOperator: event.requiresApproval || preview.visibleToOperator === true || Boolean(blockedReason),
      controls: {
        canDispatch: !blockedReason && gate.controls?.canDispatch === true && providerContract.handoffAllowed === true,
        canApprove: gate.controls?.canApprove === true,
        canRetry: event.retry?.nextDelayMs > 0,
        canOpenStatus: Boolean(clientStatusPath),
        canOpenProviderStatus: Boolean(provider.providerStatusPath || preview.providerStatusPath),
        canAdoptRuntime: !blockedReason && Boolean(adoptionKey) && !receiptBlocked && providerContract.handoffAllowed === true,
      },
      nextAction: blockedReason === "package-acceptance"
        ? packageRow.nextStep?.action || provider.nextAction || ownershipSync.packageAcceptanceNextAction || packageAcceptance?.nextAction || "repair_package_acceptance_preview"
        : blockedReason === "client-runtime-adoption"
          ? receiptBlocked
            ? "refresh_client_handoff_receipt_evidence"
            : truthAdoption.nextAction || "repair_client_runtime_adoption_evidence"
        : blockedReason === "recovery-checkpoint"
          ? provider.nextAction || ownershipSync.nextAction || "repair_adapter_recovery_checkpoint"
        : blockedReason === "truth-preview"
        ? preview.clientHandoff?.nextAction || "review_truth_boundary_preview"
        : blockedReason === "lifecycle"
          ? provider.nextAction || ownershipSync.nextAction || "repair_lifecycle_visibility"
          : blockedReason
            ? event.schedule?.nextAction || gate.nextAction || "repair_client_runtime_state"
            : provider.nextAction || event.nextAction || lifecycleCommand.nextAction,
    };
  });
  const blockedRows = rows.filter((row) => row.blockedReason);
  const adoptableRows = rows.filter((row) => row.status === "adoptable");

  return {
    format: "aios.mailchimp.clientRuntimeAdoption.v1",
    provider: "mailchimp",
    status: blockedRows.length
      ? "blocked"
      : adoptableRows.length
        ? "adoptable"
        : lifecycleCommand.status,
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      adoptable: adoptableRows.length,
      operatorVisible: rows.filter((row) => row.visibleToOperator).length,
      openStatusLinks: rows.filter((row) => row.controls.canOpenStatus).length,
      providerStatusLinks: rows.filter((row) => row.controls.canOpenProviderStatus).length,
      packageAcceptanceBlocked: rows.filter((row) => row.blockedReason === "package-acceptance").length,
      recoveryCheckpointBlocked: rows.filter((row) => row.blockedReason === "recovery-checkpoint").length,
      adoptionBlocked: rows.filter((row) => row.blockedReason === "client-runtime-adoption").length,
      adoptionReady: rows.filter((row) => row.adoptionAccepted).length,
      clientHandoffReceiptBlocked: rows.filter((row) => row.clientHandoffReceiptAccepted === false || row.clientHandoffReceiptMatches === false).length,
    },
    nextAction: blockedRows[0]?.nextAction
      || (adoptableRows.length ? "adopt_client_runtime_handoff" : lifecycleCommand.nextAction),
  };
}

function buildApprovalRuntimeActionQueue(gates, adoption, providerContract, runtimeHealth) {
  const adoptionByOperation = new Map((adoption.rows || []).map((row) => [row.operationId, row]));
  const providerByOperation = new Map((providerContract.capabilities || []).map((row) => [row.operationId, row]));
  const rows = gates.map((gate) => {
    const adoptionRow = adoptionByOperation.get(gate.operationId) || {};
    const providerRow = providerByOperation.get(gate.operationId) || {};
    const approvalBlocked = gate.blockedReason === "approval";
    const repairBlocked = Boolean(gate.blockedReason && gate.blockedReason !== "approval")
      || adoptionRow.blockedReason
      || providerRow.status === "metadata-incomplete"
      || String(providerRow.status || "").startsWith("provider-");
    const dispatchReady = gate.controls?.canDispatch === true
      && adoptionRow.controls?.canAdoptRuntime === true
      && providerContract.handoffAllowed === true
      && !runtimeHealth.retry.exhausted
      && !repairBlocked;
    const action = repairBlocked
      ? "repair"
      : approvalBlocked
        ? "approve"
        : dispatchReady
          ? "dispatch"
          : runtimeHealth.degraded
            ? "poll"
            : "observe";

    return {
      operationId: gate.operationId,
      action,
      status: action === "dispatch"
        ? "dispatch-ready"
        : action === "approve"
          ? "operator-approval-required"
          : action === "repair"
            ? "repair-required"
            : action === "poll"
              ? "provider-health-poll"
              : "waiting",
      requestId: adoptionRow.requestId || gate.evidence?.requestId || providerRow.requestId || null,
      adoptionKey: adoptionRow.adoptionKey || null,
      clientStatusPath: adoptionRow.clientStatusPath || gate.evidence?.clientStatusPath || providerRow.clientStatusPath || null,
      providerStatusPath: adoptionRow.providerStatusPath || providerRow.providerStatusPath || null,
      approvalTokenPresent: gate.evidence?.approvalTokenPresent === true,
      auditCorrelationId: gate.evidence?.auditCorrelationId || null,
      blockedReason: adoptionRow.blockedReason || gate.blockedReason || "",
      retryAfterMs: runtimeHealth.degraded || runtimeHealth.retry.exhausted ? runtimeHealth.retry.nextDelayMs : 0,
      nextAction: action === "dispatch"
        ? "dispatch_mailchimp_client_runtime_handoff"
        : action === "approve"
          ? "request_operator_approval"
          : action === "repair"
            ? adoptionRow.nextAction || gate.nextAction || providerRow.nextAction || "repair_mailchimp_handoff"
            : action === "poll"
              ? "poll_mailchimp_provider_status"
              : adoptionRow.nextAction || gate.nextAction || "wait_for_mailchimp_handoff",
    };
  });

  return {
    format: "aios.mailchimp.approval.runtimeActionQueue.v1",
    provider: "mailchimp",
    status: rows.some((row) => row.status === "repair-required")
      ? "repair-required"
      : rows.some((row) => row.status === "operator-approval-required")
        ? "approval-required"
        : rows.some((row) => row.status === "dispatch-ready")
          ? "dispatch-ready"
          : runtimeHealth.degraded
            ? "degraded"
            : "waiting",
    rows,
    counters: {
      operations: rows.length,
      dispatchReady: rows.filter((row) => row.action === "dispatch").length,
      approvalRequired: rows.filter((row) => row.action === "approve").length,
      repairRequired: rows.filter((row) => row.action === "repair").length,
      providerPoll: rows.filter((row) => row.action === "poll").length,
    },
    nextAction: rows.find((row) => row.action === "repair")?.nextAction
      || rows.find((row) => row.action === "approve")?.nextAction
      || rows.find((row) => row.action === "dispatch")?.nextAction
      || (runtimeHealth.degraded ? "poll_mailchimp_provider_status" : "wait_for_mailchimp_handoff"),
  };
}

function buildApprovalControlPlaneState(
  runtimeActionQueue,
  externalHandoffState,
  syscallRecoveryPreview,
  lifecycleCommand,
  runtimeHealth,
  approvalSettings,
) {
  const recoveryBlocked = syscallRecoveryPreview.status === "blocked";
  const recoveryPending = syscallRecoveryPreview.status === "pending";
  const queueRepairRows = runtimeActionQueue.rows.filter((row) => row.action === "repair");
  const approvalRows = runtimeActionQueue.rows.filter((row) => row.action === "approve");
  const dispatchRows = runtimeActionQueue.rows.filter((row) => row.action === "dispatch");
  const settingsErrors = approvalSettings.validation
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code)
    .sort();
  const blockedBy = [
    ...settingsErrors.map((code) => `settings:${code}`),
    ...queueRepairRows.map((row) => `runtime:${row.operationId}:${row.blockedReason || "repair"}`),
    ...(externalHandoffState.status === "blocked" ? [`external-handoff:${externalHandoffState.nextAction}`] : []),
    ...(recoveryBlocked ? syscallRecoveryPreview.blockedBy.map((blocker) => `recovery:${blocker}`) : []),
    ...(runtimeHealth.retry.exhausted ? ["runtime:retry-exhausted"] : []),
  ].sort();
  const pendingBy = [
    ...approvalRows.map((row) => `approval:${row.operationId}`),
    ...(recoveryPending ? syscallRecoveryPreview.pendingBy.map((pending) => `recovery:${pending}`) : []),
    ...(runtimeHealth.degraded && !runtimeHealth.retry.exhausted ? ["runtime:degraded"] : []),
  ].sort();
  const commands = [
    {
      command: "repair-approval-control-plane",
      enabled: blockedBy.length > 0,
      idempotencyKey: `approval-control-repair:${externalHandoffState.syncKey || "mailchimp"}`,
      operationIds: queueRepairRows.map((row) => row.operationId).sort(),
    },
    {
      command: "request-operator-approval",
      enabled: blockedBy.length === 0 && approvalRows.length > 0 && approvalSettings.enabled,
      idempotencyKey: `approval-control-request:${externalHandoffState.syncKey || "mailchimp"}`,
      operationIds: approvalRows.map((row) => row.operationId).sort(),
    },
    {
      command: "dispatch-approval-control-plane",
      enabled: blockedBy.length === 0
        && pendingBy.filter((pending) => pending.startsWith("approval:")).length === 0
        && dispatchRows.length > 0
        && externalHandoffState.status === "dispatch-ready"
        && !runtimeHealth.degraded,
      idempotencyKey: `approval-control-dispatch:${externalHandoffState.syncKey || "mailchimp"}`,
      operationIds: dispatchRows.map((row) => row.operationId).sort(),
    },
    {
      command: "schedule-approval-control-retry",
      enabled: blockedBy.length === 0
        && pendingBy.length > 0
        && runtimeHealth.retry.exhausted !== true
        && runtimeHealth.retry.nextDelayMs > 0,
      idempotencyKey: `approval-control-retry:${externalHandoffState.syncKey || "mailchimp"}:${runtimeHealth.retry.attempt + 1}`,
      delayMs: runtimeHealth.retry.nextDelayMs,
      operationIds: runtimeActionQueue.rows
        .filter((row) => row.retryAfterMs > 0)
        .map((row) => row.operationId)
        .sort(),
    },
    {
      command: "persist-approval-control-plane",
      enabled: true,
      idempotencyKey: `approval-control-persist:${externalHandoffState.syncKey || "mailchimp"}`,
      operationIds: runtimeActionQueue.rows.map((row) => row.operationId).sort(),
    },
  ];
  const enabledCommands = commands.filter((command) => command.enabled);
  const status = blockedBy.length
    ? "blocked"
    : enabledCommands.some((command) => command.command === "dispatch-approval-control-plane")
      ? "dispatch-ready"
      : approvalRows.length
        ? "approval-required"
        : pendingBy.length
          ? "pending"
          : "observing";

  return {
    format: "aios.mailchimp.approval.controlPlane.v1",
    controlPlaneId: compactApprovalDigest({
      syncKey: externalHandoffState.syncKey,
      recoveryPackageId: syscallRecoveryPreview.packageId,
      lifecycleStatus: lifecycleCommand.status,
      blockedBy,
      pendingBy,
      dispatch: dispatchRows.map((row) => row.operationId),
    }),
    provider: "mailchimp",
    status,
    statusChannel: status === "blocked"
      ? "approval.control.mailchimp.blocked"
      : "approval.control.mailchimp",
    blockedBy,
    pendingBy,
    commands,
    enabledCommands: enabledCommands.map((command) => command.command),
    counters: {
      operations: runtimeActionQueue.rows.length,
      repair: queueRepairRows.length,
      approvals: approvalRows.length,
      dispatchReady: dispatchRows.length,
      recoveryBlocked: recoveryBlocked ? 1 : 0,
      recoveryPending: recoveryPending ? 1 : 0,
    },
    persistedState: {
      syncKey: externalHandoffState.syncKey || null,
      recoveryPackageId: syscallRecoveryPreview.packageId || null,
      lifecycleStatus: lifecycleCommand.status,
      runtimeActionQueueStatus: runtimeActionQueue.status,
      externalHandoffStatus: externalHandoffState.status,
      retryAttempt: runtimeHealth.retry.attempt,
      retryExhausted: runtimeHealth.retry.exhausted,
      nextAction: enabledCommands[0]?.command || lifecycleCommand.nextAction,
    },
    nextAction: blockedBy.length
      ? blockedBy[0].startsWith("settings:")
        ? "repair_approval_settings"
        : blockedBy[0].startsWith("runtime:")
          ? runtimeActionQueue.nextAction
          : blockedBy[0].startsWith("recovery:")
            ? syscallRecoveryPreview.nextAction
            : externalHandoffState.nextAction
      : enabledCommands[0]?.command || lifecycleCommand.nextAction,
  };
}

function actionableErrorForGate(gate, health) {
  if (!gate.blockedReason && !health.degraded && !health.lastError) {
    return null;
  }

  const code = gate.blockedReason
    ? `mailchimp.${gate.blockedReason}.blocked`
    : health.failure.code || "mailchimp.runtime.degraded";
  const action = gate.nextAction || health.failure.actionable || "inspect_runtime_status";

  return {
    code,
    operationId: gate.operationId,
    severity: gate.blockedReason === "approval" || health.degraded ? "warning" : "error",
    message: gate.blockedReason
      ? `Mailchimp handoff is waiting on ${gate.blockedReason}.`
      : compactString(health.lastError, "Mailchimp runtime is operating in degraded mode."),
    action,
    retryable: !health.retry.exhausted && gate.blockedReason !== "approval",
    statusPath: gate.evidence.clientStatusPath || null,
  };
}

function normalizePackageOperatorReleaseDossierPreview(source = {}, runtimeActionQueue = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const dossier = packageAnalysis?.operatorReleaseDossier
    || packageAnalysis?.runtimeContract?.operatorReleaseDossier
    || source?.operatorReleaseDossier
    || source?.runtimeContract?.operatorReleaseDossier
    || null;
  const actionByOperation = new Map((runtimeActionQueue.rows || []).map((row) => [row.operationId, row]));

  if (!dossier?.dossierKey) {
    return {
      format: "aios.mailchimp.approval.packageOperatorReleaseDossierPreview.v1",
      present: false,
      dossierKey: null,
      status: "not-provided",
      acceptedForDispatch: true,
      rows: [],
      counters: {
        operations: 0,
        blocked: 0,
        pending: 0,
        approvalReady: 0,
        runtimeReady: 0,
        commandEnabled: 0,
        patchable: 0,
      },
      blockedBy: [],
      pendingBy: [],
      commands: [],
      userVisibleSummary: "",
      nextAction: runtimeActionQueue.nextAction || "wait_for_runtime_action_queue",
    };
  }

  const rows = (dossier.rows || []).map((row) => {
    const actionRow = actionByOperation.get(row.operationId) || {};
    const releaseCommand = (row.commands || []).find((command) => command.enabled === true)
      || (row.commands || [])[0]
      || {};
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `release:${blocker}`)),
      ...(row.readiness === "blocked" ? ["release:blocked"] : []),
      ...(row.statusPatch?.patchable === false
        ? (row.statusPatch.blockedBy || ["status-patch"]).map((blocker) => `release-status:${blocker}`)
        : []),
      ...(actionRow.action === "repair" ? [`runtime-action:${actionRow.blockedReason || "repair"}`] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `release:${pending}`)),
      ...(row.readiness === "pending" ? ["release:pending"] : []),
      ...(actionRow.action === "approve" ? ["runtime-action:approval"] : []),
      ...(actionRow.action === "poll" ? ["runtime-action:poll"] : []),
    ].sort();
    const acceptedForDispatch = blockedBy.length === 0
      && pendingBy.length === 0
      && row.statusPatch?.patchable !== false
      && (row.acceptedForApproval === true || row.acceptedForRuntime === true);

    return {
      operationId: row.operationId,
      releaseId: row.releaseId || null,
      readiness: row.readiness || "unknown",
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : row.acceptedForApproval
            ? "approval-ready"
            : row.acceptedForRuntime
              ? "runtime-ready"
              : "observing",
      acceptedForDispatch,
      acceptedForApproval: row.acceptedForApproval === true,
      acceptedForRuntime: row.acceptedForRuntime === true,
      requestId: row.requestId || actionRow.requestId || null,
      clientStatusPath: row.clientStatusPath || actionRow.clientStatusPath || null,
      providerStatusPath: row.providerStatusPath || actionRow.providerStatusPath || null,
      blockedBy,
      pendingBy,
      previewAcceptance: row.previewAcceptance || null,
      acknowledgement: row.acknowledgement || null,
      operatorPacket: row.operatorPacket || null,
      exportReport: row.exportReport || null,
      operationalAcceptance: row.operationalAcceptance || null,
      statusPatch: {
        patchId: row.statusPatch?.patchId || null,
        patchable: row.statusPatch?.patchable === true && blockedBy.length === 0,
        statusPath: row.statusPatch?.statusPath || row.clientStatusPath || actionRow.clientStatusPath || null,
        providerStatusPath: row.statusPatch?.providerStatusPath || row.providerStatusPath || actionRow.providerStatusPath || null,
        state: row.statusPatch?.state || "unknown",
        visibleState: row.statusPatch?.visibleState || null,
        blockedBy: row.statusPatch?.blockedBy || [],
        pendingBy: row.statusPatch?.pendingBy || [],
        nextAction: row.statusPatch?.nextAction || null,
      },
      command: {
        command: releaseCommand.command || (row.acceptedForApproval ? "present-operator-release-approval" : "publish-runtime-release"),
        enabled: releaseCommand.enabled === true && blockedBy.length === 0 && pendingBy.length === 0,
        idempotencyKey: releaseCommand.idempotencyKey || row.statusPatch?.patchId || null,
        statusPath: releaseCommand.statusPath || row.statusPatch?.statusPath || row.clientStatusPath || null,
        providerStatusPath: releaseCommand.providerStatusPath || row.statusPatch?.providerStatusPath || row.providerStatusPath || null,
        patch: releaseCommand.patch || row.statusPatch?.fields || null,
      },
      nextAction: blockedBy.length
        ? row.nextAction || row.statusPatch?.nextAction || "repair_operator_release_dossier"
        : pendingBy.length
          ? row.nextAction || "wait_for_operator_release_dossier"
          : row.nextAction || (row.acceptedForApproval ? "present_operator_release_for_approval" : "publish_operator_release_for_runtime"),
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const approvalRows = rows.filter((row) => row.status === "approval-ready");
  const runtimeRows = rows.filter((row) => row.status === "runtime-ready");

  return {
    format: "aios.mailchimp.approval.packageOperatorReleaseDossierPreview.v1",
    present: true,
    dossierKey: dossier.dossierKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : approvalRows.length
          ? "approval-ready"
          : runtimeRows.length
            ? "runtime-ready"
            : "observing",
    acceptedForDispatch: rows.length > 0 && blockedRows.length === 0 && pendingRows.length === 0 && rows.every((row) => row.acceptedForDispatch),
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      approvalReady: approvalRows.length,
      runtimeReady: runtimeRows.length,
      commandEnabled: rows.filter((row) => row.command.enabled).length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
    },
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    commands: rows.map((row) => row.command),
    userVisibleSummary: dossier.userVisibleSummary || "",
    exportSummary: dossier.exportSummary || null,
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || dossier.nextAction
      || "accept_operator_release_dossier",
  };
}

function buildApprovalGate(operationTruth, ownership, approvalState) {
  const ownershipGate = ownership?.gate || {};
  const requiresApproval = operationTruth.externalWrite
    || ownershipGate.status === "lease-required"
    || operationTruth.gate.requiresExternalFactCheck;
  const leaseReady = !requiresApproval || ownershipGate.status !== "blocked";
  const truthReady = operationTruth.gate.status === "ready";
  const approvalReady = !requiresApproval || approvalState.accepted;
  const blockedReason = !leaseReady
    ? "ownership"
    : !truthReady
      ? "truth-boundary"
      : !approvalReady
        ? "approval"
        : "";

  return {
    operationId: operationTruth.operationId,
    requiresApproval,
    status: blockedReason ? "blocked" : requiresApproval ? "approved" : "ready",
    blockedReason,
    nextAction: blockedReason === "ownership"
      ? ownershipGate.nextAction || "repair_ownership_contract"
      : blockedReason === "truth-boundary"
        ? operationTruth.gate.nextAction || "collect_truth_evidence"
        : blockedReason === "approval"
          ? "request_operator_approval"
          : "queue_adapter_handoff",
    evidence: {
      approvalTokenPresent: Boolean(approvalState.token),
      approvedBy: approvalState.approvedBy,
      approvedAt: approvalState.approvedAt,
      reason: approvalState.reason,
      truthHandoffStatus: operationTruth.gate.handoffStatus,
      auditCorrelationId: operationTruth.gate.auditHandoff?.correlationId || null,
      auditHandoffStatus: operationTruth.gate.auditHandoff?.status || "not-required",
      clientStatusPath: operationTruth.boundaryScope?.statusPath || ownershipGate.runtimeState?.clientStatusPath || null,
      requestId: operationTruth.boundaryScope?.requestId || ownershipGate.runtimeState?.requestId || null,
      ownershipOwnerId: ownership?.owner?.id || null,
    },
    controls: {
      canApprove: requiresApproval && truthReady && leaseReady,
      canRevoke: approvalReady && requiresApproval,
      canDispatch: !blockedReason,
      canDryRun: true,
    },
  };
}

function normalizePackageOperatorNextActionPreview(source = {}, runtimeActionQueue = {}, truth = {}) {
  const packageAnalysis = source?.kind === "aios.semantic.packageAnalysis"
    ? source
    : source?.packageAnalysis?.kind === "aios.semantic.packageAnalysis"
      ? source.packageAnalysis
      : null;
  const actionState = packageAnalysis?.operatorNextActionState
    || packageAnalysis?.runtimeContract?.operatorNextActionState
    || source?.operatorNextActionState
    || source?.runtimeContract?.operatorNextActionState
    || null;
  const actionByOperation = new Map((runtimeActionQueue.rows || []).map((row) => [row.operationId, row]));
  const truthPreviewByOperation = new Map((truth?.preview?.rows || []).map((row) => [row.operationId, row]));

  if (!actionState?.actionKey) {
    return {
      format: "aios.mailchimp.approval.packageOperatorNextActionPreview.v1",
      present: false,
      actionKey: null,
      status: "not-provided",
      acceptedForDispatch: true,
      blockedBy: [],
      pendingBy: [],
      rows: [],
      counters: {
        operations: 0,
        blocked: 0,
        pending: 0,
        dispatchReady: 0,
        patchable: 0,
        commandEnabled: 0,
      },
      userVisibleSummary: "",
      nextAction: runtimeActionQueue.nextAction || "wait_for_runtime_action_queue",
    };
  }

  const rows = (actionState.rows || []).map((row) => {
    const actionRow = actionByOperation.get(row.operationId) || {};
    const truthPreview = truthPreviewByOperation.get(row.operationId) || {};
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `operator-next:${blocker}`)),
      ...(row.status === "blocked" ? ["operator-next:blocked"] : []),
      ...(row.statusPatch?.patchable === false
        ? (row.statusPatch.blockedBy || ["status-patch"]).map((blocker) => `operator-next-status:${blocker}`)
        : []),
      ...(truthPreview.operatorNextAction?.status === "blocked"
        ? (truthPreview.operatorNextAction.blockedBy || ["truth-preview"]).map((blocker) => `truth-preview:${blocker}`)
        : []),
      ...(actionRow.action === "repair" ? [`runtime-action:${actionRow.blockedReason || "repair"}`] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `operator-next:${pending}`)),
      ...(row.status === "pending" ? ["operator-next:pending"] : []),
      ...(truthPreview.operatorNextAction?.status === "pending"
        ? (truthPreview.operatorNextAction.pendingBy || ["truth-preview"]).map((pending) => `truth-preview:${pending}`)
        : []),
      ...(actionRow.action === "approve" ? ["runtime-action:approval-required"] : []),
      ...(actionRow.action === "poll" ? ["runtime-action:poll"] : []),
    ].sort();
    const commandEnabled = (row.commands || []).some((command) => command.enabled === true)
      || actionRow.command?.enabled === true
      || actionRow.action === "dispatch";
    const acceptedForDispatch = row.acceptedForDispatch === true
      && blockedBy.length === 0
      && pendingBy.length === 0
      && commandEnabled;

    return {
      operationId: row.operationId,
      actionId: row.actionId || null,
      status: blockedBy.length
        ? "blocked"
        : pendingBy.length
          ? "pending"
          : row.status || "operator-review",
      visibleState: row.visibleState || truthPreview.operatorNextAction?.visibleState || "",
      acceptedForDispatch,
      requestId: row.requestId || actionRow.requestId || truthPreview.clientHandoff?.requestId || null,
      clientStatusPath: row.clientStatusPath || actionRow.clientStatusPath || truthPreview.clientHandoff?.statusPath || null,
      providerStatusPath: row.providerStatusPath || actionRow.providerStatusPath || truthPreview.clientHandoff?.providerStatusPath || null,
      blockedBy,
      pendingBy,
      statusPatch: {
        patchId: row.statusPatch?.patchId || null,
        patchable: row.statusPatch?.patchable === true && blockedBy.length === 0,
        state: row.statusPatch?.state || row.status || "unknown",
        visibleState: row.statusPatch?.visibleState || row.visibleState || null,
        nextAction: row.statusPatch?.nextAction || null,
      },
      commands: (row.commands || []).map((command) => ({
        command: command.command,
        enabled: command.enabled === true && blockedBy.length === 0,
        patchId: command.patchId || null,
        nextAction: command.nextAction || null,
      })),
      runtimeAction: actionRow.action || "observe",
      truthReadiness: truthPreview.readiness || "unknown",
      nextAction: blockedBy.length
        ? row.nextAction || truthPreview.operatorNextAction?.nextAction || "repair_operator_next_action"
        : pendingBy.length
          ? row.nextAction || truthPreview.operatorNextAction?.nextAction || "wait_for_operator_next_action"
          : row.nextAction || actionRow.nextAction || truthPreview.clientHandoff?.nextAction || "dispatch_mailchimp_lifecycle_handoff",
    };
  });
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const pendingRows = rows.filter((row) => row.status === "pending");
  const readyRows = rows.filter((row) => row.acceptedForDispatch);

  return {
    format: "aios.mailchimp.approval.packageOperatorNextActionPreview.v1",
    present: true,
    actionKey: actionState.actionKey,
    status: blockedRows.length
      ? "blocked"
      : pendingRows.length
        ? "pending"
        : readyRows.length === rows.length
          ? "dispatch-ready"
          : actionState.status || "operator-review",
    acceptedForDispatch: rows.length > 0 && blockedRows.length === 0 && pendingRows.length === 0 && readyRows.length === rows.length,
    blockedBy: [...new Set(blockedRows.flatMap((row) => row.blockedBy))].sort(),
    pendingBy: [...new Set(pendingRows.flatMap((row) => row.pendingBy))].sort(),
    rows,
    counters: {
      operations: rows.length,
      blocked: blockedRows.length,
      pending: pendingRows.length,
      dispatchReady: readyRows.length,
      patchable: rows.filter((row) => row.statusPatch.patchable).length,
      commandEnabled: rows.filter((row) => row.commands.some((command) => command.enabled)).length,
    },
    userVisibleSummary: blockedRows.length
      ? `${blockedRows.length} Mailchimp operator action${blockedRows.length === 1 ? "" : "s"} need repair.`
      : pendingRows.length
        ? `${pendingRows.length} Mailchimp operator action${pendingRows.length === 1 ? "" : "s"} are waiting.`
        : readyRows.length
          ? `${readyRows.length} Mailchimp operator action${readyRows.length === 1 ? "" : "s"} can dispatch.`
          : "Mailchimp operator actions are in review.",
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || readyRows[0]?.nextAction
      || actionState.nextAction
      || runtimeActionQueue.nextAction,
  };
}

export function analyzeMailchimpApproval(source = {}, runtime = {}, options = {}) {
  const ownership = source?.ownership?.kind === "aios.semantic.ownershipAnalysis"
    ? source.ownership
    : analyzeMailchimpOwnership(source?.packageAnalysis || source, options);
  const truth = source?.truth?.kind === "aios.semantic.truthBoundaryAnalysis"
    ? source.truth
    : analyzeMailchimpTruthBoundary(
      source?.packageAnalysis || source,
      {
        ...(runtime.evidence || {}),
        approval: runtime.approval || runtime.operatorApproval || {},
        runtimeHealth: runtime.health || runtime.status || {},
      },
      options,
    );
  const approvalState = normalizeApprovalState(runtime.approval || runtime.operatorApproval || {});
  const approvalHistory = normalizeApprovalHistory(runtime.approvalHistory || runtime.history || []);
  const runtimeHealth = normalizeRuntimeHealth(runtime);
  const approvalSettings = normalizeApprovalSettings(runtime.settings || runtime.approvalSettings || {}, options);
  const packageAcceptance = source?.packageAnalysis?.acceptancePreview
    || (source?.kind === "aios.semantic.packageAnalysis" ? source.acceptancePreview : null)
    || ownership.packageAcceptance
    || null;
  const gates = truth.operations.map((operationTruth) => (
    buildApprovalGate(
      operationTruth,
      findMailchimpOwnershipForOperation(ownership, operationTruth.operationId),
      approvalState,
    )
  ));
  const blocked = gates.filter((gate) => gate.status === "blocked");
  const approvalRequired = gates.filter((gate) => gate.requiresApproval);
  const actionableErrors = gates
    .map((gate) => actionableErrorForGate(gate, runtimeHealth))
    .filter(Boolean);
  const dispatchableGateCount = gates.filter((gate) => gate.controls?.canDispatch === true).length;
  const degradedMode = runtimeHealth.degraded
    || runtimeHealth.retry.exhausted
    || (runtimeHealth.lastError && blocked.length > 0);
  const retryPlan = {
    status: runtimeHealth.retry.exhausted
      ? "exhausted"
      : blocked.length
        ? "waiting"
        : degradedMode
          ? "degraded"
          : "ready",
    attempt: runtimeHealth.retry.attempt,
    maxAttempts: runtimeHealth.retry.maxAttempts,
    nextDelayMs: blocked.length || degradedMode ? runtimeHealth.retry.nextDelayMs : 0,
    retryableOperationIds: actionableErrors
      .filter((error) => error.retryable)
      .map((error) => error.operationId)
      .sort(),
  };
  const diagnostics = [
    ...approvalSettings.validation,
    ...blocked.map((gate) => ({
      severity: gate.blockedReason === "approval" ? "warning" : "error",
      code: `approval.${gate.blockedReason || "blocked"}`,
      message: `Operation ${gate.operationId} is blocked by ${gate.blockedReason || "approval"} before Mailchimp handoff.`,
      field: `operations.${gate.operationId}.approval`,
      operationId: gate.operationId,
    })),
    ...(degradedMode ? [{
      severity: runtimeHealth.retry.exhausted ? "error" : "warning",
      code: runtimeHealth.retry.exhausted ? "approval.retry_exhausted" : "approval.runtime_degraded",
      message: runtimeHealth.retry.exhausted
        ? "Mailchimp approval handoff retry attempts are exhausted."
        : "Mailchimp approval handoff is running with degraded runtime health.",
      field: "runtime.health",
      operationId: runtimeHealth.failure.operationId || "",
    }] : []),
  ];
  const timeline = buildApprovalTimeline(gates, approvalHistory, runtimeHealth, approvalSettings);
  const analytics = summarizeApprovalAnalytics(gates, diagnostics, approvalHistory, timeline, runtimeHealth);
  const lifecycleCommand = buildLifecycleCommandState(gates, timeline, approvalSettings, retryPlan);
  const exportSummary = buildApprovalExportSummary(truth.package || ownership.package, gates, analytics, timeline, retryPlan, lifecycleCommand);
  const providerContract = buildProviderServiceContract(
    ownership,
    truth,
    gates,
    runtimeHealth,
    approvalSettings,
    retryPlan,
    lifecycleCommand,
    packageAcceptance,
  );
  const clientRuntimeAdoption = buildClientRuntimeAdoptionContract(
    ownership,
    truth,
    gates,
    timeline,
    providerContract,
    lifecycleCommand,
    packageAcceptance,
  );
  const runtimeActionQueue = buildApprovalRuntimeActionQueue(
    gates,
    clientRuntimeAdoption,
    providerContract,
    runtimeHealth,
  );
  const exportManifest = buildApprovalExportManifest(
    truth.package || ownership.package,
    analytics,
    approvalHistory,
    timeline,
    providerContract,
    clientRuntimeAdoption,
    runtimeActionQueue,
  );
  const packageExportReadinessPreview = normalizePackageExportReadinessPreview(
    source,
    providerContract,
    exportManifest,
  );
  const packageExportAuditPreview = normalizePackageExportAuditPreview(
    source,
    packageExportReadinessPreview,
    exportManifest,
  );
  const packageExportHistoryPreview = normalizePackageExportHistoryPreview(
    source,
    packageExportReadinessPreview,
    packageExportAuditPreview,
    exportManifest,
  );
  const packageExportReportingPreview = normalizePackageExportReportingPreview(
    source,
    packageExportHistoryPreview,
    exportManifest,
  );
  const packageOperationalIncidentPreview = normalizePackageOperationalIncidentPreview(
    source,
    runtimeActionQueue,
  );
  const packageProviderAckWorkflowPreview = normalizePackageProviderAckWorkflowPreview(
    source,
    runtimeActionQueue,
  );
  const packagePreviewAcceptanceSummary = source?.packageAnalysis?.previewAcceptanceSummary
    || (source?.kind === "aios.semantic.packageAnalysis" ? source.previewAcceptanceSummary : null)
    || ownership.packagePreviewAcceptanceSummary
    || ownership.packageAnalysis?.previewAcceptanceSummary
    || {};
  const packageAcceptanceAcknowledgementPreview = normalizePackageAcceptanceAcknowledgementPreview(
    source,
    runtimeActionQueue,
  );
  const packageClientHandoffPreview = normalizePackageClientHandoffPreview(
    source,
    providerContract,
    clientRuntimeAdoption,
    runtimeActionQueue,
  );
  const packageOperatorHandoffPreview = normalizePackageOperatorHandoffPreview(
    source,
    runtimeActionQueue,
  );
  const packageOperatorReleaseDossierPreview = normalizePackageOperatorReleaseDossierPreview(
    source,
    runtimeActionQueue,
  );
  const packageOperatorNextActionPreview = normalizePackageOperatorNextActionPreview(
    source,
    runtimeActionQueue,
    truth,
  );
  const packagePermissionBoundaryPreview = normalizePackagePermissionBoundaryPreview(source, ownership);
  const externalHandoffState = buildApprovalExternalHandoffState(
    providerContract,
    clientRuntimeAdoption,
    runtimeActionQueue,
    exportManifest,
    runtimeHealth,
    packageOperatorHandoffPreview,
    packagePermissionBoundaryPreview,
    packageExportReadinessPreview,
    packageExportAuditPreview,
    packageExportHistoryPreview,
    packageOperationalIncidentPreview,
    packagePreviewAcceptanceSummary,
  );
  const packageRestartJournalPreview = normalizePackageRestartJournalPreview(
    source,
    ownership,
    runtimeActionQueue,
    externalHandoffState,
  );
  const packagePersistedStatusRecoveryPreview = normalizePackagePersistedStatusRecoveryPreview(
    source,
    runtimeActionQueue,
    packageRestartJournalPreview,
  );
  const syscallRecoveryPreview = normalizeSyscallRecoveryHandoffPackage(
    source,
    runtime,
    externalHandoffState,
  );
  const approvalControlPlaneState = buildApprovalControlPlaneState(
    runtimeActionQueue,
    externalHandoffState,
    syscallRecoveryPreview,
    lifecycleCommand,
    runtimeHealth,
    approvalSettings,
  );
  const providerDiagnostics = [
    ...(providerContract.status === "metadata-incomplete"
      ? [{
        severity: "error",
        code: "approval.provider.metadata_incomplete",
        message: "Mailchimp provider handoff requires request id and client status path metadata.",
        field: "providerContract.capabilities",
      }]
      : []),
    ...(providerContract.status === "blocked"
      ? [{
        severity: "warning",
        code: "approval.provider.negotiation_blocked",
        message: "Mailchimp provider capability negotiation is waiting on approval, audit, or boundary repair.",
        field: "providerContract.sync",
      }]
      : []),
    ...(clientRuntimeAdoption.status === "blocked"
      ? [{
        severity: "warning",
        code: "approval.client_runtime_adoption.blocked",
        message: "Mailchimp client runtime adoption is waiting on lifecycle, preview, or approval state.",
        field: "clientRuntimeAdoption.rows",
        action: clientRuntimeAdoption.nextAction,
      }]
      : []),
    ...(clientRuntimeAdoption.counters?.clientHandoffReceiptBlocked
      ? [{
        severity: "error",
        code: "approval.client_handoff_receipt.blocked",
        message: "Mailchimp approval dispatch is blocked by a stale or incomplete client handoff receipt.",
        field: "clientRuntimeAdoption.rows.clientHandoffReceiptId",
        action: "refresh_client_handoff_receipt_evidence",
        blockedCount: clientRuntimeAdoption.counters.clientHandoffReceiptBlocked,
      }]
      : []),
    ...(runtimeActionQueue.status === "repair-required"
      ? [{
        severity: "error",
        code: "approval.runtime_action_queue.repair_required",
        message: "Mailchimp approval runtime action queue contains handoffs that must be repaired before dispatch.",
        field: "runtimeActionQueue.rows",
        action: runtimeActionQueue.nextAction,
      }]
      : []),
    ...(externalHandoffState.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.external_handoff.blocked",
        message: "Mailchimp external handoff payloads are blocked before provider dispatch.",
        field: "externalHandoffState.rows",
        action: externalHandoffState.nextAction,
      }]
      : []),
    ...(packageRestartJournalPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_restart_journal.blocked",
        message: "Mailchimp package restart journal blocks approval dispatch until persisted recovery state is repaired.",
        field: "packageRestartJournalPreview",
        action: packageRestartJournalPreview.nextAction,
        blockedBy: packageRestartJournalPreview.blockedBy,
      }]
      : []),
    ...(packageRestartJournalPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_restart_journal.pending",
        message: "Mailchimp package restart journal has pending recovery state before approval dispatch.",
        field: "packageRestartJournalPreview",
        action: packageRestartJournalPreview.nextAction,
        pendingBy: packageRestartJournalPreview.pendingBy,
      }]
      : []),
    ...(packagePersistedStatusRecoveryPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_persisted_status_recovery.blocked",
        message: "Mailchimp persisted status recovery blocks approval dispatch until restart-safe status state is repaired.",
        field: "packagePersistedStatusRecoveryPreview",
        action: packagePersistedStatusRecoveryPreview.nextAction,
        blockedBy: packagePersistedStatusRecoveryPreview.blockedBy,
      }]
      : []),
    ...(packagePersistedStatusRecoveryPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_persisted_status_recovery.pending",
        message: "Mailchimp persisted status recovery has pending status publication before approval dispatch.",
        field: "packagePersistedStatusRecoveryPreview",
        action: packagePersistedStatusRecoveryPreview.nextAction,
        pendingBy: packagePersistedStatusRecoveryPreview.pendingBy,
      }]
      : []),
    ...(packagePermissionBoundaryPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_permission_boundary.blocked",
        message: "Mailchimp package permission boundary handoff blocks approval dispatch until tenant and status patch state is repaired.",
        field: "packagePermissionBoundaryPreview",
        action: packagePermissionBoundaryPreview.nextAction,
        blockedBy: packagePermissionBoundaryPreview.blockedBy,
      }]
      : []),
    ...(packageExportReadinessPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_export_readiness.blocked",
        message: "Mailchimp package export readiness blocks approval dispatch until package metadata and handoff state are repaired.",
        field: "packageExportReadinessPreview",
        action: packageExportReadinessPreview.nextAction,
        blockedBy: packageExportReadinessPreview.blockedBy,
      }]
      : []),
    ...(packageExportReadinessPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_export_readiness.pending",
        message: "Mailchimp package export readiness has pending provider, permission, or restart state before approval dispatch.",
        field: "packageExportReadinessPreview",
        action: packageExportReadinessPreview.nextAction,
        pendingBy: packageExportReadinessPreview.pendingBy,
      }]
      : []),
    ...(packageExportAuditPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_export_audit.blocked",
        message: "Mailchimp package export audit trail blocks approval dispatch until audit metadata is repaired.",
        field: "packageExportAuditPreview",
        action: packageExportAuditPreview.nextAction,
        blockedBy: packageExportAuditPreview.blockedBy,
      }]
      : []),
    ...(packageExportAuditPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_export_audit.pending",
        message: "Mailchimp package export audit trail has pending handoff or history state before approval dispatch.",
        field: "packageExportAuditPreview",
        action: packageExportAuditPreview.nextAction,
        pendingBy: packageExportAuditPreview.pendingBy,
      }]
      : []),
    ...(packageExportHistoryPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_export_history.blocked",
        message: "Mailchimp package export history blocks approval dispatch until snapshot digest, audit, and status metadata are repaired.",
        field: "packageExportHistoryPreview",
        action: packageExportHistoryPreview.nextAction,
        blockedBy: packageExportHistoryPreview.blockedBy,
      }]
      : []),
    ...(packageExportHistoryPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_export_history.pending",
        message: "Mailchimp package export history has pending export or audit snapshots before approval dispatch.",
        field: "packageExportHistoryPreview",
        action: packageExportHistoryPreview.nextAction,
        pendingBy: packageExportHistoryPreview.pendingBy,
      }]
      : []),
    ...(packageExportReportingPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_export_reporting.blocked",
        message: "Mailchimp package export reporting checkpoint blocks approval dispatch until report digest and route status state are repaired.",
        field: "packageExportReportingPreview",
        action: packageExportReportingPreview.nextAction,
        blockedBy: packageExportReportingPreview.blockedBy,
      }]
      : []),
    ...(packageExportReportingPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_export_reporting.pending",
        message: "Mailchimp package export reporting checkpoint has pending report or route status state before approval dispatch.",
        field: "packageExportReportingPreview",
        action: packageExportReportingPreview.nextAction,
        pendingBy: packageExportReportingPreview.pendingBy,
      }]
      : []),
    ...(packageOperationalIncidentPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_operational_incident.blocked",
        message: "Mailchimp package operational incidents block approval dispatch until adapter health, receipts, or handoff state is repaired.",
        field: "packageOperationalIncidentPreview",
        action: packageOperationalIncidentPreview.nextAction,
        blockedBy: packageOperationalIncidentPreview.blockedBy,
      }]
      : []),
    ...(packageOperationalIncidentPreview.status === "pending" || packageOperationalIncidentPreview.status === "degraded"
      ? [{
        severity: "warning",
        code: `approval.package_operational_incident.${packageOperationalIncidentPreview.status}`,
        message: "Mailchimp package operational incident state is pending or degraded before approval dispatch.",
        field: "packageOperationalIncidentPreview",
        action: packageOperationalIncidentPreview.nextAction,
        pendingBy: packageOperationalIncidentPreview.pendingBy,
      }]
      : []),
    ...(packageProviderAckWorkflowPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_provider_ack_workflow.blocked",
        message: "Mailchimp provider acknowledgement workflow blocks approval dispatch until delivery acknowledgement state is repaired.",
        field: "packageProviderAckWorkflowPreview",
        action: packageProviderAckWorkflowPreview.nextAction,
        blockedBy: packageProviderAckWorkflowPreview.blockedBy,
      }]
      : []),
    ...(packageProviderAckWorkflowPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_provider_ack_workflow.pending",
        message: "Mailchimp provider acknowledgement workflow is waiting on provider delivery confirmation before approval export.",
        field: "packageProviderAckWorkflowPreview",
        action: packageProviderAckWorkflowPreview.nextAction,
        pendingBy: packageProviderAckWorkflowPreview.pendingBy,
      }]
      : []),
    ...(packagePreviewAcceptanceSummary.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_preview_acceptance.blocked",
        message: "Mailchimp package preview acceptance blocks approval dispatch until route and handoff status patches are repaired.",
        field: "packagePreviewAcceptanceSummary",
        action: packagePreviewAcceptanceSummary.nextAction,
        blockedBy: [...new Set((packagePreviewAcceptanceSummary.rows || []).flatMap((row) => row.blockedBy || []))].sort(),
      }]
      : []),
    ...(packagePreviewAcceptanceSummary.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_preview_acceptance.pending",
        message: "Mailchimp package preview acceptance is waiting on route, provider, or lifecycle prerequisites before approval dispatch.",
        field: "packagePreviewAcceptanceSummary",
        action: packagePreviewAcceptanceSummary.nextAction,
        pendingBy: [...new Set((packagePreviewAcceptanceSummary.rows || []).flatMap((row) => row.pendingBy || []))].sort(),
      }]
      : []),
    ...(packageAcceptanceAcknowledgementPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_acceptance_acknowledgement.blocked",
        message: "Mailchimp package acceptance acknowledgements block approval dispatch until preview status patches are repaired.",
        field: "packageAcceptanceAcknowledgementPreview",
        action: packageAcceptanceAcknowledgementPreview.nextAction,
        blockedBy: packageAcceptanceAcknowledgementPreview.blockedBy,
      }]
      : []),
    ...(packageAcceptanceAcknowledgementPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_acceptance_acknowledgement.pending",
        message: "Mailchimp package acceptance acknowledgements are pending publication before approval dispatch.",
        field: "packageAcceptanceAcknowledgementPreview",
        action: packageAcceptanceAcknowledgementPreview.nextAction,
        pendingBy: packageAcceptanceAcknowledgementPreview.pendingBy,
      }]
      : []),
    ...(packageClientHandoffPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_client_handoff_blocked",
        message: "Mailchimp package client handoff readiness blocks approval dispatch.",
        field: "packageClientHandoffPreview",
        action: packageClientHandoffPreview.nextAction,
        blockedBy: packageClientHandoffPreview.blockedBy,
      }]
      : []),
    ...(packageClientHandoffPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_client_handoff_pending",
        message: "Mailchimp package client handoff readiness is pending before approval dispatch.",
        field: "packageClientHandoffPreview",
        action: packageClientHandoffPreview.nextAction,
        pendingBy: packageClientHandoffPreview.pendingBy,
      }]
      : []),
    ...(packageOperatorHandoffPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_operator_handoff.blocked",
        message: "Mailchimp package operator handoff packet blocks approval dispatch.",
        field: "packageOperatorHandoffPreview",
        action: packageOperatorHandoffPreview.nextAction,
        blockedBy: packageOperatorHandoffPreview.blockedBy,
      }]
      : []),
    ...(packageOperatorHandoffPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_operator_handoff.pending",
        message: "Mailchimp package operator handoff packet has pending runtime or operator prerequisites before dispatch.",
        field: "packageOperatorHandoffPreview",
        action: packageOperatorHandoffPreview.nextAction,
        pendingBy: packageOperatorHandoffPreview.pendingBy,
      }]
      : []),
    ...(packageOperatorReleaseDossierPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_operator_release_dossier.blocked",
        message: "Mailchimp operator release dossier blocks approval dispatch until release status patches are repaired.",
        field: "packageOperatorReleaseDossierPreview",
        action: packageOperatorReleaseDossierPreview.nextAction,
        blockedBy: packageOperatorReleaseDossierPreview.blockedBy,
      }]
      : []),
    ...(packageOperatorReleaseDossierPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_operator_release_dossier.pending",
        message: "Mailchimp operator release dossier has pending route, acknowledgement, or export report prerequisites before dispatch.",
        field: "packageOperatorReleaseDossierPreview",
        action: packageOperatorReleaseDossierPreview.nextAction,
        pendingBy: packageOperatorReleaseDossierPreview.pendingBy,
      }]
      : []),
    ...(packageOperatorNextActionPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.package_operator_next_action.blocked",
        message: "Mailchimp operator next-action state blocks approval dispatch until lifecycle, route, or status patch state is repaired.",
        field: "packageOperatorNextActionPreview",
        action: packageOperatorNextActionPreview.nextAction,
        blockedBy: packageOperatorNextActionPreview.blockedBy,
      }]
      : []),
    ...(packageOperatorNextActionPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_operator_next_action.pending",
        message: "Mailchimp operator next-action state has pending lifecycle, route, or approval prerequisites before dispatch.",
        field: "packageOperatorNextActionPreview",
        action: packageOperatorNextActionPreview.nextAction,
        pendingBy: packageOperatorNextActionPreview.pendingBy,
      }]
      : []),
    ...(packagePermissionBoundaryPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.package_permission_boundary.pending",
        message: "Mailchimp package permission boundary handoff has pending status or approval prerequisites before dispatch.",
        field: "packagePermissionBoundaryPreview",
        action: packagePermissionBoundaryPreview.nextAction,
        pendingBy: packagePermissionBoundaryPreview.pendingBy,
      }]
      : []),
    ...externalHandoffState.rows
      .filter((row) => row.permissionBoundary?.statusPatch?.patchable === false)
      .map((row) => ({
        severity: "error",
        code: "approval.external_handoff.permission_status_patch_blocked",
        message: `Operation ${row.operationId} cannot dispatch until the Mailchimp permission boundary status patch is publishable.`,
        field: `externalHandoffState.rows.${row.operationId}.permissionBoundary.statusPatch`,
        operationId: row.operationId,
        action: row.permissionBoundary.statusPatch.nextAction || row.nextAction,
        blockedBy: row.permissionBoundary.statusPatch.blockedBy,
      })),
    ...externalHandoffState.rows
      .filter((row) => row.packagePermissionBoundary?.statusPatch?.patchable === false)
      .map((row) => ({
        severity: "error",
        code: "approval.external_handoff.package_permission_status_patch_blocked",
        message: `Operation ${row.operationId} cannot dispatch until the package Mailchimp permission boundary status patch is publishable.`,
        field: `externalHandoffState.rows.${row.operationId}.packagePermissionBoundary.statusPatch`,
        operationId: row.operationId,
        action: row.packagePermissionBoundary.statusPatch.nextAction || row.nextAction,
        blockedBy: row.packagePermissionBoundary.statusPatch.blockedBy,
      })),
    ...(syscallRecoveryPreview.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.syscall_recovery_handoff.blocked",
        message: "Mailchimp syscall recovery handoff is not restart-safe for approval dispatch.",
        field: "syscallRecoveryPreview",
        action: syscallRecoveryPreview.nextAction,
        blockedBy: syscallRecoveryPreview.blockedBy,
      }]
      : []),
    ...(syscallRecoveryPreview.status === "pending"
      ? [{
        severity: "warning",
        code: "approval.syscall_recovery_handoff.pending",
        message: "Mailchimp syscall recovery handoff has pending restart or approval state.",
        field: "syscallRecoveryPreview",
        action: syscallRecoveryPreview.nextAction,
        pendingBy: syscallRecoveryPreview.pendingBy,
      }]
      : []),
    ...(approvalControlPlaneState.status === "blocked"
      ? [{
        severity: "error",
        code: "approval.control_plane.blocked",
        message: "Mailchimp approval control plane is blocked before operator or adapter dispatch.",
        field: "approvalControlPlaneState",
        action: approvalControlPlaneState.nextAction,
        blockedBy: approvalControlPlaneState.blockedBy,
      }]
      : []),
  ];
  diagnostics.push(...providerDiagnostics);

  return {
    kind: "aios.semantic.approvalAnalysis",
    provider: "mailchimp",
    package: truth.package || ownership.package,
    gates,
    diagnostics,
    summary: {
      operationCount: gates.length,
      approvalRequiredCount: approvalRequired.length,
      approvedCount: gates.filter((gate) => gate.status === "approved").length,
      blockedCount: blocked.length,
      dispatchableGateCount,
      degradedMode,
      historyEventCount: approvalHistory.length,
      timelineEventCount: timeline.length,
      exportStatus: exportSummary.status,
      lifecycleStatus: lifecycleCommand.status,
      providerContractStatus: providerContract.status,
      clientRuntimeAdoptionStatus: clientRuntimeAdoption.status,
      runtimeActionQueueStatus: runtimeActionQueue.status,
      exportManifestStatus: exportManifest.status,
      externalHandoffStatus: externalHandoffState.status,
      packageRestartJournalStatus: packageRestartJournalPreview.status,
      packageRestartStatusPatchableCount: packageRestartJournalPreview.counters.statusPatchable || 0,
      packageRestartStatusBlockedCount: packageRestartJournalPreview.counters.statusPatchBlocked || 0,
      packageRestartStatusCommandEnabledCount: packageRestartJournalPreview.counters.statusCommandEnabled || 0,
      packageRestartStatusEnvelopeStatus: packageRestartJournalPreview.statusEnvelope?.status || "not-provided",
      packageRestartStatusEnvelopeBlockedCount: packageRestartJournalPreview.counters.statusEnvelopeBlocked || 0,
      packageRestartStatusEnvelopePendingCount: packageRestartJournalPreview.counters.statusEnvelopePending || 0,
      packageRestartStatusEnvelopeCommandEnabledCount: packageRestartJournalPreview.counters.statusEnvelopeCommandEnabled || 0,
      packagePersistedStatusRecoveryStatus: packagePersistedStatusRecoveryPreview.status,
      packagePersistedStatusRecoveryBlockedCount: packagePersistedStatusRecoveryPreview.counters.blocked || 0,
      packagePersistedStatusRecoveryPendingCount: packagePersistedStatusRecoveryPreview.counters.pending || 0,
      packagePersistedStatusRecoveryResumeReadyCount: packagePersistedStatusRecoveryPreview.counters.resumeReady || 0,
      packagePersistedStatusRecoveryCommandEnabledCount: packagePersistedStatusRecoveryPreview.counters.commandEnabled || 0,
      packagePermissionBoundaryStatus: packagePermissionBoundaryPreview.status,
      packagePermissionBoundaryPatchableCount: packagePermissionBoundaryPreview.counters.statusPatchable || 0,
      packagePermissionBoundaryBlockedCount: packagePermissionBoundaryPreview.counters.statusPatchBlocked || 0,
      packageTenantBoundaryActionAcceptedCount: packagePermissionBoundaryPreview.counters.actionQueueAccepted || 0,
      packageTenantBoundaryActionBlockedCount: packagePermissionBoundaryPreview.counters.actionQueueBlocked || 0,
      packageTenantBoundaryActionPendingCount: packagePermissionBoundaryPreview.counters.actionQueuePending || 0,
      packageTenantBoundaryActionCommandEnabledCount: packagePermissionBoundaryPreview.counters.actionQueueCommandEnabled || 0,
      packageExportReadinessStatus: packageExportReadinessPreview.status,
      packageExportReadyCount: packageExportReadinessPreview.counters.ready || 0,
      packageExportBlockedCount: packageExportReadinessPreview.counters.blocked || 0,
      packageExportPendingCount: packageExportReadinessPreview.counters.pending || 0,
      packageExportAuditStatus: packageExportAuditPreview.status,
      packageExportAuditAcceptedCount: packageExportAuditPreview.counters.accepted || 0,
      packageExportAuditBlockedCount: packageExportAuditPreview.counters.blocked || 0,
      packageExportAuditPendingCount: packageExportAuditPreview.counters.pending || 0,
      packageExportHistoryStatus: packageExportHistoryPreview.status,
      packageExportHistoryAcceptedCount: packageExportHistoryPreview.counters.accepted || 0,
      packageExportHistoryBlockedCount: packageExportHistoryPreview.counters.blocked || 0,
      packageExportHistoryPendingCount: packageExportHistoryPreview.counters.pending || 0,
      packageExportHistoryDigestCount: packageExportHistoryPreview.counters.digestCount || 0,
      packageExportReportingStatus: packageExportReportingPreview.status,
      packageExportReportingAcceptedCount: packageExportReportingPreview.counters.accepted || 0,
      packageExportReportingBlockedCount: packageExportReportingPreview.counters.blocked || 0,
      packageExportReportingPendingCount: packageExportReportingPreview.counters.pending || 0,
      packageExportReportingPatchableCount: packageExportReportingPreview.counters.patchable || 0,
      packageOperationalIncidentStatus: packageOperationalIncidentPreview.status,
      packageOperationalIncidentBlockedCount: packageOperationalIncidentPreview.counters.blocked || 0,
      packageOperationalIncidentPendingCount: packageOperationalIncidentPreview.counters.pending || 0,
      packageOperationalIncidentDegradedCount: packageOperationalIncidentPreview.counters.degraded || 0,
      packageOperationalIncidentRetryableCount: packageOperationalIncidentPreview.counters.retryable || 0,
      packageProviderAckWorkflowStatus: packageProviderAckWorkflowPreview.status,
      packageProviderAckWorkflowBlockedCount: packageProviderAckWorkflowPreview.counters.blocked || 0,
      packageProviderAckWorkflowPendingCount: packageProviderAckWorkflowPreview.counters.pending || 0,
      packageProviderAckWorkflowPollableCount: packageProviderAckWorkflowPreview.counters.pollable || 0,
      packageProviderAckWorkflowCommandEnabledCount: packageProviderAckWorkflowPreview.counters.commandEnabled || 0,
      packagePreviewAcceptanceStatus: packagePreviewAcceptanceSummary.status || "not-provided",
      packagePreviewAcceptanceBlockedCount: packagePreviewAcceptanceSummary.counters?.blocked || 0,
      packagePreviewAcceptancePendingCount: packagePreviewAcceptanceSummary.counters?.pending || 0,
      packagePreviewAcceptanceApprovalReadyCount: packagePreviewAcceptanceSummary.counters?.approvalReady || 0,
      packagePreviewAcceptancePatchableCount: packagePreviewAcceptanceSummary.counters?.patchable || 0,
      packageAcceptanceAcknowledgementStatus: packageAcceptanceAcknowledgementPreview.status,
      packageAcceptanceAcknowledgementBlockedCount: packageAcceptanceAcknowledgementPreview.counters.blocked || 0,
      packageAcceptanceAcknowledgementPendingCount: packageAcceptanceAcknowledgementPreview.counters.pending || 0,
      packageAcceptanceAcknowledgementRequiredCount: packageAcceptanceAcknowledgementPreview.counters.required || 0,
      packageAcceptanceAcknowledgementCommandEnabledCount: packageAcceptanceAcknowledgementPreview.counters.commandEnabled || 0,
      packageClientHandoffStatus: packageClientHandoffPreview.status,
      packageClientHandoffReadyCount: packageClientHandoffPreview.counters.ready || 0,
      packageClientHandoffBlockedCount: packageClientHandoffPreview.counters.blocked || 0,
      packageClientHandoffPendingCount: packageClientHandoffPreview.counters.pending || 0,
      packageOperatorHandoffStatus: packageOperatorHandoffPreview.status,
      packageOperatorHandoffReadyCount: packageOperatorHandoffPreview.counters.ready || 0,
      packageOperatorHandoffBlockedCount: packageOperatorHandoffPreview.counters.blocked || 0,
      packageOperatorHandoffPendingCount: packageOperatorHandoffPreview.counters.pending || 0,
      packageOperatorReleaseDossierStatus: packageOperatorReleaseDossierPreview.status,
      packageOperatorReleaseDossierBlockedCount: packageOperatorReleaseDossierPreview.counters.blocked || 0,
      packageOperatorReleaseDossierPendingCount: packageOperatorReleaseDossierPreview.counters.pending || 0,
      packageOperatorReleaseDossierApprovalReadyCount: packageOperatorReleaseDossierPreview.counters.approvalReady || 0,
      packageOperatorReleaseDossierCommandEnabledCount: packageOperatorReleaseDossierPreview.counters.commandEnabled || 0,
      packageOperatorNextActionStatus: packageOperatorNextActionPreview.status,
      packageOperatorNextActionBlockedCount: packageOperatorNextActionPreview.counters.blocked || 0,
      packageOperatorNextActionPendingCount: packageOperatorNextActionPreview.counters.pending || 0,
      packageOperatorNextActionDispatchReadyCount: packageOperatorNextActionPreview.counters.dispatchReady || 0,
      packageOperatorNextActionPatchableCount: packageOperatorNextActionPreview.counters.patchable || 0,
      packageOperatorNextActionCommandEnabledCount: packageOperatorNextActionPreview.counters.commandEnabled || 0,
      syscallRecoveryStatus: syscallRecoveryPreview.status,
      approvalControlPlaneStatus: approvalControlPlaneState.status,
      packageAcceptanceStatus: packageAcceptance?.status || "unknown",
      status: blocked.length
        || approvalSettings.validation.some((entry) => entry.severity === "error")
        || providerContract.status === "metadata-incomplete"
        || clientRuntimeAdoption.status === "blocked"
        || runtimeActionQueue.status === "repair-required"
        || exportManifest.status === "blocked"
        || externalHandoffState.status === "blocked"
        || packageRestartJournalPreview.status === "blocked"
        || packagePersistedStatusRecoveryPreview.status === "blocked"
        || packagePermissionBoundaryPreview.status === "blocked"
        || packageExportReadinessPreview.status === "blocked"
        || packageExportAuditPreview.status === "blocked"
        || packageExportHistoryPreview.status === "blocked"
        || packageExportReportingPreview.status === "blocked"
        || packageOperationalIncidentPreview.status === "blocked"
        || packageProviderAckWorkflowPreview.status === "blocked"
        || packagePreviewAcceptanceSummary.status === "blocked"
        || packageAcceptanceAcknowledgementPreview.status === "blocked"
        || packageClientHandoffPreview.status === "blocked"
        || packageOperatorHandoffPreview.status === "blocked"
        || packageOperatorReleaseDossierPreview.status === "blocked"
        || packageOperatorNextActionPreview.status === "blocked"
        || syscallRecoveryPreview.status === "blocked"
        || approvalControlPlaneState.status === "blocked"
        ? "blocked"
        : packageRestartJournalPreview.status === "pending"
          ? "pending-restart-journal"
        : packagePersistedStatusRecoveryPreview.status === "pending"
          ? "pending-persisted-status-recovery"
        : packagePermissionBoundaryPreview.status === "pending"
          ? "pending-permission-boundary"
        : packageExportReadinessPreview.status === "pending"
          ? "pending-package-export"
        : packageExportAuditPreview.status === "pending"
          ? "pending-export-audit"
        : packageExportHistoryPreview.status === "pending"
          ? "pending-export-history"
        : packageExportReportingPreview.status === "pending"
          ? "pending-export-reporting"
        : packageOperationalIncidentPreview.status === "pending"
          ? "pending-operational-incident"
        : packageOperationalIncidentPreview.status === "degraded"
          ? "degraded-operational-incident"
        : packageProviderAckWorkflowPreview.status === "pending"
          ? "pending-provider-ack-workflow"
        : packageAcceptanceAcknowledgementPreview.status === "pending"
          ? "pending-acceptance-acknowledgement"
        : packageClientHandoffPreview.status === "pending"
          ? "pending-client-handoff"
        : packageOperatorHandoffPreview.status === "pending"
          ? "pending-operator-handoff"
        : packageOperatorReleaseDossierPreview.status === "pending"
          ? "pending-operator-release-dossier"
        : packageOperatorNextActionPreview.status === "pending"
          ? "pending-operator-next-action"
        : syscallRecoveryPreview.status === "pending"
          ? "pending-recovery"
        : degradedMode
          ? "degraded"
          : externalHandoffState.status === "dispatch-ready"
            ? "dispatch-ready"
          : approvalRequired.length
            ? "approved"
            : "ready",
      nextAction: blocked.length
        ? blocked[0].nextAction
        : approvalSettings.validation.some((entry) => entry.severity === "error")
          ? "repair_approval_settings"
        : providerContract.status === "metadata-incomplete"
          ? "repair_provider_sync_metadata"
        : clientRuntimeAdoption.status === "blocked"
          ? clientRuntimeAdoption.nextAction
        : runtimeActionQueue.status === "repair-required"
          ? runtimeActionQueue.nextAction
        : exportManifest.status === "blocked"
          ? exportManifest.nextAction
        : externalHandoffState.status === "blocked"
          ? externalHandoffState.nextAction
        : packageRestartJournalPreview.status === "blocked" || packageRestartJournalPreview.status === "pending"
          ? packageRestartJournalPreview.nextAction
        : packagePersistedStatusRecoveryPreview.status === "blocked" || packagePersistedStatusRecoveryPreview.status === "pending"
          ? packagePersistedStatusRecoveryPreview.nextAction
        : packagePermissionBoundaryPreview.status === "blocked" || packagePermissionBoundaryPreview.status === "pending"
          ? packagePermissionBoundaryPreview.nextAction
        : packageExportReadinessPreview.status === "blocked" || packageExportReadinessPreview.status === "pending"
          ? packageExportReadinessPreview.nextAction
        : packageExportAuditPreview.status === "blocked" || packageExportAuditPreview.status === "pending"
          ? packageExportAuditPreview.nextAction
        : packageExportHistoryPreview.status === "blocked" || packageExportHistoryPreview.status === "pending"
          ? packageExportHistoryPreview.nextAction
        : packageExportReportingPreview.status === "blocked" || packageExportReportingPreview.status === "pending"
          ? packageExportReportingPreview.nextAction
        : packageOperationalIncidentPreview.status === "blocked" || packageOperationalIncidentPreview.status === "pending" || packageOperationalIncidentPreview.status === "degraded"
          ? packageOperationalIncidentPreview.nextAction
        : packageProviderAckWorkflowPreview.status === "blocked" || packageProviderAckWorkflowPreview.status === "pending"
          ? packageProviderAckWorkflowPreview.nextAction
        : packagePreviewAcceptanceSummary.status === "blocked" || packagePreviewAcceptanceSummary.status === "pending"
          ? packagePreviewAcceptanceSummary.nextAction
        : packageAcceptanceAcknowledgementPreview.status === "blocked" || packageAcceptanceAcknowledgementPreview.status === "pending"
          ? packageAcceptanceAcknowledgementPreview.nextAction
        : packageClientHandoffPreview.status === "blocked" || packageClientHandoffPreview.status === "pending"
          ? packageClientHandoffPreview.nextAction
        : packageOperatorHandoffPreview.status === "blocked" || packageOperatorHandoffPreview.status === "pending"
          ? packageOperatorHandoffPreview.nextAction
        : packageOperatorReleaseDossierPreview.status === "blocked" || packageOperatorReleaseDossierPreview.status === "pending"
          ? packageOperatorReleaseDossierPreview.nextAction
        : packageOperatorNextActionPreview.status === "blocked" || packageOperatorNextActionPreview.status === "pending"
          ? packageOperatorNextActionPreview.nextAction
        : syscallRecoveryPreview.status === "blocked" || syscallRecoveryPreview.status === "pending"
          ? syscallRecoveryPreview.nextAction
        : approvalControlPlaneState.status === "blocked"
          ? approvalControlPlaneState.nextAction
        : degradedMode
          ? "surface_runtime_health_to_operator"
        : externalHandoffState.status === "dispatch-ready"
          ? externalHandoffState.nextAction
          : runtimeActionQueue.nextAction || lifecycleCommand.nextAction,
    },
    health: {
      runtime: runtimeHealth,
      retryPlan,
      actionableErrors,
    },
    analytics,
    history: {
      events: approvalHistory,
      latestAcceptedAt: approvalHistory
        .filter((event) => event.accepted && event.at)
        .map((event) => event.at)
        .sort()
        .at(-1) || "",
      latestActor: approvalHistory
        .filter((event) => event.actor && event.actor !== "unknown")
        .at(-1)?.actor || "",
    },
    timeline,
    lifecycle: lifecycleCommand,
    providerContract,
    clientRuntimeAdoption,
    runtimeActionQueue,
    exportManifest,
    externalHandoffState,
    packageRestartJournalPreview,
    packagePersistedStatusRecoveryPreview,
    packagePermissionBoundaryPreview,
    packageExportReadinessPreview,
    packageExportAuditPreview,
    packageExportHistoryPreview,
    packageExportReportingPreview,
    packageOperationalIncidentPreview,
    packageProviderAckWorkflowPreview,
    packagePreviewAcceptanceSummary,
    packageAcceptanceAcknowledgementPreview,
    packageClientHandoffPreview,
    packageOperatorHandoffPreview,
    packageOperatorReleaseDossierPreview,
    packageOperatorNextActionPreview,
    syscallRecoveryPreview,
    approvalControlPlaneState,
    packageAcceptance,
    settings: {
      mode: approvalSettings.mode,
      enabled: approvalSettings.enabled,
      autoDispatch: approvalSettings.autoDispatch,
      requireToken: approvalSettings.requireToken,
      allowedRoles: approvalSettings.allowedRoles,
      disabledOperations: approvalSettings.disabledOperations,
      enabledOperations: approvalSettings.enabledOperations,
      schedule: approvalSettings.schedule,
      validation: approvalSettings.validation,
    },
    exportSummary,
    statusHandoff: {
      state: approvalSettings.validation.some((entry) => entry.severity === "error")
        ? "settings_blocked"
        : blocked.length
        ? "waiting_for_approval"
        : packageRestartJournalPreview.status === "blocked"
          ? "restart_journal_blocked"
        : packageRestartJournalPreview.status === "pending"
          ? "restart_journal_pending"
        : packagePersistedStatusRecoveryPreview.status === "blocked"
          ? "persisted_status_recovery_blocked"
        : packagePersistedStatusRecoveryPreview.status === "pending"
          ? "persisted_status_recovery_pending"
        : packagePermissionBoundaryPreview.status === "blocked"
          ? "permission_boundary_blocked"
        : packagePermissionBoundaryPreview.status === "pending"
          ? "permission_boundary_pending"
        : packageExportReadinessPreview.status === "blocked"
          ? "export_readiness_blocked"
        : packageExportReadinessPreview.status === "pending"
          ? "export_readiness_pending"
        : packageExportAuditPreview.status === "blocked"
          ? "export_audit_blocked"
        : packageExportAuditPreview.status === "pending"
          ? "export_audit_pending"
        : packageExportHistoryPreview.status === "blocked"
          ? "export_history_blocked"
        : packageExportHistoryPreview.status === "pending"
          ? "export_history_pending"
        : packageExportReportingPreview.status === "blocked"
          ? "export_reporting_blocked"
        : packageExportReportingPreview.status === "pending"
          ? "export_reporting_pending"
        : packageOperationalIncidentPreview.status === "blocked"
          ? "operational_incident_blocked"
        : packageOperationalIncidentPreview.status === "pending"
          ? "operational_incident_pending"
        : packageOperationalIncidentPreview.status === "degraded"
          ? "operational_incident_degraded"
        : packageProviderAckWorkflowPreview.status === "blocked"
          ? "provider_ack_workflow_blocked"
        : packageProviderAckWorkflowPreview.status === "pending"
          ? "provider_ack_workflow_pending"
        : packagePreviewAcceptanceSummary.status === "blocked"
          ? "preview_acceptance_blocked"
        : packagePreviewAcceptanceSummary.status === "pending"
          ? "preview_acceptance_pending"
        : packageAcceptanceAcknowledgementPreview.status === "blocked"
          ? "acceptance_acknowledgement_blocked"
        : packageAcceptanceAcknowledgementPreview.status === "pending"
          ? "acceptance_acknowledgement_pending"
        : packageClientHandoffPreview.status === "blocked"
          ? "client_handoff_blocked"
        : packageClientHandoffPreview.status === "pending"
          ? "client_handoff_pending"
        : packageOperatorHandoffPreview.status === "blocked"
          ? "operator_handoff_blocked"
        : packageOperatorHandoffPreview.status === "pending"
          ? "operator_handoff_pending"
        : packageOperatorReleaseDossierPreview.status === "blocked"
          ? "operator_release_dossier_blocked"
        : packageOperatorReleaseDossierPreview.status === "pending"
          ? "operator_release_dossier_pending"
        : syscallRecoveryPreview.status === "blocked"
          ? "recovery_blocked"
        : syscallRecoveryPreview.status === "pending"
          ? "recovery_pending"
        : degradedMode
          ? "degraded"
          : lifecycleCommand.status,
      nextAction: approvalSettings.validation.some((entry) => entry.severity === "error")
        ? "repair_approval_settings"
        : blocked.length
        ? blocked[0].nextAction
        : packageRestartJournalPreview.status === "blocked" || packageRestartJournalPreview.status === "pending"
          ? packageRestartJournalPreview.nextAction
        : packagePersistedStatusRecoveryPreview.status === "blocked" || packagePersistedStatusRecoveryPreview.status === "pending"
          ? packagePersistedStatusRecoveryPreview.nextAction
        : packagePermissionBoundaryPreview.status === "blocked" || packagePermissionBoundaryPreview.status === "pending"
          ? packagePermissionBoundaryPreview.nextAction
        : packageExportReadinessPreview.status === "blocked" || packageExportReadinessPreview.status === "pending"
          ? packageExportReadinessPreview.nextAction
        : packageExportAuditPreview.status === "blocked" || packageExportAuditPreview.status === "pending"
          ? packageExportAuditPreview.nextAction
        : packageExportHistoryPreview.status === "blocked" || packageExportHistoryPreview.status === "pending"
          ? packageExportHistoryPreview.nextAction
        : packageExportReportingPreview.status === "blocked" || packageExportReportingPreview.status === "pending"
          ? packageExportReportingPreview.nextAction
        : packageOperationalIncidentPreview.status === "blocked" || packageOperationalIncidentPreview.status === "pending" || packageOperationalIncidentPreview.status === "degraded"
          ? packageOperationalIncidentPreview.nextAction
        : packageProviderAckWorkflowPreview.status === "blocked" || packageProviderAckWorkflowPreview.status === "pending"
          ? packageProviderAckWorkflowPreview.nextAction
        : packagePreviewAcceptanceSummary.status === "blocked" || packagePreviewAcceptanceSummary.status === "pending"
          ? packagePreviewAcceptanceSummary.nextAction
        : packageAcceptanceAcknowledgementPreview.status === "blocked" || packageAcceptanceAcknowledgementPreview.status === "pending"
          ? packageAcceptanceAcknowledgementPreview.nextAction
        : packageClientHandoffPreview.status === "blocked" || packageClientHandoffPreview.status === "pending"
          ? packageClientHandoffPreview.nextAction
        : packageOperatorHandoffPreview.status === "blocked" || packageOperatorHandoffPreview.status === "pending"
          ? packageOperatorHandoffPreview.nextAction
        : packageOperatorReleaseDossierPreview.status === "blocked" || packageOperatorReleaseDossierPreview.status === "pending"
          ? packageOperatorReleaseDossierPreview.nextAction
        : syscallRecoveryPreview.status === "blocked" || syscallRecoveryPreview.status === "pending"
          ? syscallRecoveryPreview.nextAction
        : degradedMode
          ? "surface_runtime_health_to_operator"
          : lifecycleCommand.nextAction,
      operatorVisible: approvalRequired.length > 0,
      retryable: retryPlan.status !== "exhausted" && actionableErrors.some((error) => error.retryable),
      degradedMode,
      payloadShape: {
        approvalTokenPresent: "boolean",
        approvedBy: "string",
        approvedAt: "string",
        blockedReason: "ownership|truth-boundary|approval",
        requestId: "string",
        clientStatusPath: "string",
        retryPlan: "object",
        actionableErrors: "array",
        analytics: "object",
        timeline: "array",
        exportSummary: "object",
        lifecycle: "object",
        providerContract: "object",
        clientRuntimeAdoption: "object",
        runtimeActionQueue: "object",
        exportManifest: "object",
        externalHandoffState: "object",
        packageRestartJournalPreview: "object",
        packagePersistedStatusRecoveryPreview: "object",
        packagePermissionBoundaryPreview: "object",
        packageExportReadinessPreview: "object",
        packageExportAuditPreview: "object",
        packageExportHistoryPreview: "object",
        packageExportReportingPreview: "object",
        packageOperationalIncidentPreview: "object",
        packageProviderAckWorkflowPreview: "object",
        packagePreviewAcceptanceSummary: "object",
        packageAcceptanceAcknowledgementPreview: "object",
        packageClientHandoffPreview: "object",
        packageOperatorReleaseDossierPreview: "object",
        syscallRecoveryPreview: "object",
        packageAcceptance: "object|null",
        settings: "object",
      },
      providerSync: {
        syncKey: providerContract.syncKey,
        state: providerContract.sync.state,
        nextAction: providerContract.sync.nextAction,
        handoffAllowed: providerContract.handoffAllowed,
        retryAfterMs: providerContract.sync.retryAfterMs,
      },
      clientRuntimeAdoption: {
        status: clientRuntimeAdoption.status,
        nextAction: clientRuntimeAdoption.nextAction,
        counters: clientRuntimeAdoption.counters,
      },
      runtimeActionQueue: {
        status: runtimeActionQueue.status,
        nextAction: runtimeActionQueue.nextAction,
        counters: runtimeActionQueue.counters,
      },
      externalHandoffState: {
        status: externalHandoffState.status,
        nextAction: externalHandoffState.nextAction,
        counters: externalHandoffState.counters,
        syncKey: externalHandoffState.syncKey,
      },
      packageRestartJournalPreview: {
        present: packageRestartJournalPreview.present,
        journalId: packageRestartJournalPreview.journalId,
        status: packageRestartJournalPreview.status,
        acceptedForRuntime: packageRestartJournalPreview.acceptedForRuntime,
        counters: packageRestartJournalPreview.counters,
        blockedBy: packageRestartJournalPreview.blockedBy,
        pendingBy: packageRestartJournalPreview.pendingBy,
        statusCommands: packageRestartJournalPreview.statusCommands,
        statusEnvelope: packageRestartJournalPreview.statusEnvelope,
        nextAction: packageRestartJournalPreview.nextAction,
      },
      packagePersistedStatusRecoveryPreview: {
        present: packagePersistedStatusRecoveryPreview.present,
        ledgerKey: packagePersistedStatusRecoveryPreview.ledgerKey,
        status: packagePersistedStatusRecoveryPreview.status,
        acceptedForDispatch: packagePersistedStatusRecoveryPreview.acceptedForDispatch,
        counters: packagePersistedStatusRecoveryPreview.counters,
        blockedBy: packagePersistedStatusRecoveryPreview.blockedBy,
        pendingBy: packagePersistedStatusRecoveryPreview.pendingBy,
        commands: packagePersistedStatusRecoveryPreview.commands,
        nextAction: packagePersistedStatusRecoveryPreview.nextAction,
      },
      packagePermissionBoundaryPreview: {
        present: packagePermissionBoundaryPreview.present,
        handoffKey: packagePermissionBoundaryPreview.handoffKey,
        status: packagePermissionBoundaryPreview.status,
        acceptedForDispatch: packagePermissionBoundaryPreview.acceptedForDispatch,
        counters: packagePermissionBoundaryPreview.counters,
        blockedBy: packagePermissionBoundaryPreview.blockedBy,
        pendingBy: packagePermissionBoundaryPreview.pendingBy,
        commands: packagePermissionBoundaryPreview.commands,
        nextAction: packagePermissionBoundaryPreview.nextAction,
      },
      packageExportReadinessPreview: {
        present: packageExportReadinessPreview.present,
        ledgerKey: packageExportReadinessPreview.ledgerKey,
        status: packageExportReadinessPreview.status,
        acceptedForDispatch: packageExportReadinessPreview.acceptedForDispatch,
        counters: packageExportReadinessPreview.counters,
        blockedBy: packageExportReadinessPreview.blockedBy,
        pendingBy: packageExportReadinessPreview.pendingBy,
        userVisibleSummary: packageExportReadinessPreview.userVisibleSummary,
        nextAction: packageExportReadinessPreview.nextAction,
      },
      packageExportAuditPreview: {
        present: packageExportAuditPreview.present,
        auditTrailId: packageExportAuditPreview.auditTrailId,
        status: packageExportAuditPreview.status,
        acceptedForDispatch: packageExportAuditPreview.acceptedForDispatch,
        counters: packageExportAuditPreview.counters,
        blockedBy: packageExportAuditPreview.blockedBy,
        pendingBy: packageExportAuditPreview.pendingBy,
        commands: packageExportAuditPreview.commands,
        userVisibleSummary: packageExportAuditPreview.userVisibleSummary,
        nextAction: packageExportAuditPreview.nextAction,
      },
      packageExportHistoryPreview: {
        present: packageExportHistoryPreview.present,
        bundleId: packageExportHistoryPreview.bundleId,
        status: packageExportHistoryPreview.status,
        acceptedForDispatch: packageExportHistoryPreview.acceptedForDispatch,
        counters: packageExportHistoryPreview.counters,
        blockedBy: packageExportHistoryPreview.blockedBy,
        pendingBy: packageExportHistoryPreview.pendingBy,
        commands: packageExportHistoryPreview.commands,
        latestSnapshot: packageExportHistoryPreview.latestSnapshot,
        userVisibleSummary: packageExportHistoryPreview.userVisibleSummary,
        nextAction: packageExportHistoryPreview.nextAction,
      },
      packageExportReportingPreview: {
        present: packageExportReportingPreview.present,
        checkpointKey: packageExportReportingPreview.checkpointKey,
        status: packageExportReportingPreview.status,
        acceptedForDispatch: packageExportReportingPreview.acceptedForDispatch,
        counters: packageExportReportingPreview.counters,
        blockedBy: packageExportReportingPreview.blockedBy,
        pendingBy: packageExportReportingPreview.pendingBy,
        commands: packageExportReportingPreview.commands,
        latestReadyReport: packageExportReportingPreview.latestReadyReport,
        userVisibleSummary: packageExportReportingPreview.userVisibleSummary,
        nextAction: packageExportReportingPreview.nextAction,
      },
      packageOperationalIncidentPreview: {
        present: packageOperationalIncidentPreview.present,
        ledgerKey: packageOperationalIncidentPreview.ledgerKey,
        status: packageOperationalIncidentPreview.status,
        acceptedForDispatch: packageOperationalIncidentPreview.acceptedForDispatch,
        counters: packageOperationalIncidentPreview.counters,
        blockedBy: packageOperationalIncidentPreview.blockedBy,
        pendingBy: packageOperationalIncidentPreview.pendingBy,
        nextAction: packageOperationalIncidentPreview.nextAction,
      },
      packageProviderAckWorkflowPreview: {
        present: packageProviderAckWorkflowPreview.present,
        handoffKey: packageProviderAckWorkflowPreview.handoffKey,
        ledgerKey: packageProviderAckWorkflowPreview.ledgerKey,
        status: packageProviderAckWorkflowPreview.status,
        acceptedForDispatch: packageProviderAckWorkflowPreview.acceptedForDispatch,
        counters: packageProviderAckWorkflowPreview.counters,
        blockedBy: packageProviderAckWorkflowPreview.blockedBy,
        pendingBy: packageProviderAckWorkflowPreview.pendingBy,
        commands: packageProviderAckWorkflowPreview.commands,
        userVisibleSummary: packageProviderAckWorkflowPreview.userVisibleSummary,
        nextAction: packageProviderAckWorkflowPreview.nextAction,
      },
      packagePreviewAcceptanceSummary: {
        summaryKey: packagePreviewAcceptanceSummary.summaryKey || null,
        acceptanceKey: packagePreviewAcceptanceSummary.acceptanceKey || null,
        routeSurfaceId: packagePreviewAcceptanceSummary.routeSurfaceId || null,
        status: packagePreviewAcceptanceSummary.status || "not-provided",
        acceptedForRoute: packagePreviewAcceptanceSummary.acceptedForRoute === true,
        acceptedForApproval: packagePreviewAcceptanceSummary.acceptedForApproval === true,
        counters: packagePreviewAcceptanceSummary.counters || null,
        blockedOperationIds: packagePreviewAcceptanceSummary.blockedOperationIds || [],
        pendingOperationIds: packagePreviewAcceptanceSummary.pendingOperationIds || [],
        userVisibleSummary: packagePreviewAcceptanceSummary.userVisibleSummary || "",
        nextAction: packagePreviewAcceptanceSummary.nextAction || null,
      },
      packageAcceptanceAcknowledgementPreview: {
        present: packageAcceptanceAcknowledgementPreview.present,
        acknowledgementKey: packageAcceptanceAcknowledgementPreview.acknowledgementKey,
        acceptanceKey: packageAcceptanceAcknowledgementPreview.acceptanceKey,
        status: packageAcceptanceAcknowledgementPreview.status,
        acceptedForDispatch: packageAcceptanceAcknowledgementPreview.acceptedForDispatch,
        counters: packageAcceptanceAcknowledgementPreview.counters,
        blockedBy: packageAcceptanceAcknowledgementPreview.blockedBy,
        pendingBy: packageAcceptanceAcknowledgementPreview.pendingBy,
        commands: packageAcceptanceAcknowledgementPreview.commands,
        userVisibleSummary: packageAcceptanceAcknowledgementPreview.userVisibleSummary,
        nextAction: packageAcceptanceAcknowledgementPreview.nextAction,
      },
      packageClientHandoffPreview: {
        present: packageClientHandoffPreview.present,
        planKey: packageClientHandoffPreview.planKey,
        status: packageClientHandoffPreview.status,
        acceptedForDispatch: packageClientHandoffPreview.acceptedForDispatch,
        counters: packageClientHandoffPreview.counters,
        blockedBy: packageClientHandoffPreview.blockedBy,
        pendingBy: packageClientHandoffPreview.pendingBy,
        commands: packageClientHandoffPreview.commands,
        userVisibleSummary: packageClientHandoffPreview.userVisibleSummary,
        nextAction: packageClientHandoffPreview.nextAction,
      },
      packageOperatorReleaseDossierPreview: {
        present: packageOperatorReleaseDossierPreview.present,
        dossierKey: packageOperatorReleaseDossierPreview.dossierKey,
        status: packageOperatorReleaseDossierPreview.status,
        acceptedForDispatch: packageOperatorReleaseDossierPreview.acceptedForDispatch,
        counters: packageOperatorReleaseDossierPreview.counters,
        blockedBy: packageOperatorReleaseDossierPreview.blockedBy,
        pendingBy: packageOperatorReleaseDossierPreview.pendingBy,
        commands: packageOperatorReleaseDossierPreview.commands,
        userVisibleSummary: packageOperatorReleaseDossierPreview.userVisibleSummary,
        nextAction: packageOperatorReleaseDossierPreview.nextAction,
      },
      packageOperatorNextActionPreview: {
        present: packageOperatorNextActionPreview.present,
        actionKey: packageOperatorNextActionPreview.actionKey,
        status: packageOperatorNextActionPreview.status,
        acceptedForDispatch: packageOperatorNextActionPreview.acceptedForDispatch,
        counters: packageOperatorNextActionPreview.counters,
        blockedBy: packageOperatorNextActionPreview.blockedBy,
        pendingBy: packageOperatorNextActionPreview.pendingBy,
        userVisibleSummary: packageOperatorNextActionPreview.userVisibleSummary,
        nextAction: packageOperatorNextActionPreview.nextAction,
      },
      syscallRecoveryPreview: {
        present: syscallRecoveryPreview.present,
        packageId: syscallRecoveryPreview.packageId,
        status: syscallRecoveryPreview.status,
        restartSafe: syscallRecoveryPreview.restartSafe,
        acceptedForAdapter: syscallRecoveryPreview.acceptedForAdapter,
        counters: syscallRecoveryPreview.counters,
        nextAction: syscallRecoveryPreview.nextAction,
      },
      approvalControlPlane: {
        controlPlaneId: approvalControlPlaneState.controlPlaneId,
        status: approvalControlPlaneState.status,
        statusChannel: approvalControlPlaneState.statusChannel,
        blockedBy: approvalControlPlaneState.blockedBy,
        pendingBy: approvalControlPlaneState.pendingBy,
        enabledCommands: approvalControlPlaneState.enabledCommands,
        nextAction: approvalControlPlaneState.nextAction,
      },
      exportManifest: {
        status: exportManifest.status,
        digest: exportManifest.digest,
        nextAction: exportManifest.nextAction,
        counters: exportManifest.counters,
      },
      packageAcceptance: packageAcceptance
        ? {
          acceptanceKey: packageAcceptance.acceptanceKey,
          status: packageAcceptance.status,
          accepted: packageAcceptance.accepted,
          nextAction: packageAcceptance.nextAction,
          counters: packageAcceptance.counters,
        }
        : null,
    },
  };
}

export function isMailchimpApprovalDispatchable(approvalAnalysis) {
  const lifecycleStatus = approvalAnalysis?.lifecycle?.status || "";
  return Boolean(
    approvalAnalysis?.kind === "aios.semantic.approvalAnalysis"
    && approvalAnalysis.summary?.blockedCount === 0
    && approvalAnalysis.summary?.degradedMode !== true
    && approvalAnalysis.providerContract?.handoffAllowed === true
    && approvalAnalysis.clientRuntimeAdoption?.status !== "blocked"
    && approvalAnalysis.runtimeActionQueue?.status === "dispatch-ready"
    && approvalAnalysis.packageRestartJournalPreview?.status !== "blocked"
    && approvalAnalysis.packageRestartJournalPreview?.status !== "pending"
    && approvalAnalysis.packagePersistedStatusRecoveryPreview?.status !== "blocked"
    && approvalAnalysis.packagePersistedStatusRecoveryPreview?.status !== "pending"
    && approvalAnalysis.packagePermissionBoundaryPreview?.status !== "blocked"
    && approvalAnalysis.packagePermissionBoundaryPreview?.status !== "pending"
    && approvalAnalysis.packageExportReadinessPreview?.status !== "blocked"
    && approvalAnalysis.packageExportReadinessPreview?.status !== "pending"
    && approvalAnalysis.packageExportAuditPreview?.status !== "blocked"
    && approvalAnalysis.packageExportAuditPreview?.status !== "pending"
    && approvalAnalysis.packageExportHistoryPreview?.status !== "blocked"
    && approvalAnalysis.packageExportHistoryPreview?.status !== "pending"
    && approvalAnalysis.packageExportReportingPreview?.status !== "blocked"
    && approvalAnalysis.packageExportReportingPreview?.status !== "pending"
    && approvalAnalysis.packageOperationalIncidentPreview?.status !== "blocked"
    && approvalAnalysis.packageOperationalIncidentPreview?.status !== "pending"
    && approvalAnalysis.packageOperationalIncidentPreview?.status !== "degraded"
    && approvalAnalysis.packageProviderAckWorkflowPreview?.status !== "blocked"
    && approvalAnalysis.packageProviderAckWorkflowPreview?.status !== "pending"
    && approvalAnalysis.packagePreviewAcceptanceSummary?.status !== "blocked"
    && approvalAnalysis.packagePreviewAcceptanceSummary?.status !== "pending"
    && approvalAnalysis.packageAcceptanceAcknowledgementPreview?.status !== "blocked"
    && approvalAnalysis.packageAcceptanceAcknowledgementPreview?.status !== "pending"
    && approvalAnalysis.packageClientHandoffPreview?.status !== "blocked"
    && approvalAnalysis.packageClientHandoffPreview?.status !== "pending"
    && approvalAnalysis.packageOperatorReleaseDossierPreview?.status !== "blocked"
    && approvalAnalysis.packageOperatorReleaseDossierPreview?.status !== "pending"
    && approvalAnalysis.packageOperatorNextActionPreview?.status !== "blocked"
    && approvalAnalysis.packageOperatorNextActionPreview?.status !== "pending"
    && approvalAnalysis.packageOperatorNextActionPreview?.acceptedForDispatch !== false
    && approvalAnalysis.syscallRecoveryPreview?.status !== "blocked"
    && approvalAnalysis.syscallRecoveryPreview?.status !== "pending"
    && approvalAnalysis.health?.retryPlan?.status !== "exhausted"
    && (lifecycleStatus === "dispatch-ready" || lifecycleStatus === "operator-ready")
    && (approvalAnalysis.gates || []).every((gate) => gate.controls?.canDispatch === true),
  );
}

function compactApprovalDigest(value) {
  const serialized = JSON.stringify(stableApprovalClone(value));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableApprovalClone(value) {
  if (Array.isArray(value)) return value.map(stableApprovalClone);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableApprovalClone(nested)]),
    );
  }
  return value;
}

export default analyzeMailchimpApproval;
