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
      adoptionStatus: adoptionRow.status || "unknown",
      runtimeAction: actionRow.action || "observe",
      requestId: event.requestId || providerRow.requestId || adoptionRow.requestId || null,
      clientStatusPath: event.clientStatusPath || providerRow.clientStatusPath || adoptionRow.clientStatusPath || null,
      providerStatusPath: providerRow.providerStatusPath || adoptionRow.providerStatusPath || null,
      auditCorrelationId: event.auditCorrelationId || providerRow.auditId || null,
      ownerId: event.ownerId || providerRow.ownerId || null,
      retryDelayMs: event.retry?.nextDelayMs ?? actionRow.retryAfterMs ?? 0,
      scheduleBlockedReason: event.schedule?.blockedReason || "",
      lastHistoryEvent: event.lastHistoryEvent,
      exportable: Boolean(
        (event.requestId || providerRow.requestId || adoptionRow.requestId)
        && (event.clientStatusPath || providerRow.clientStatusPath || adoptionRow.clientStatusPath),
      ),
      nextAction: actionRow.nextAction || adoptionRow.nextAction || providerRow.nextAction || event.nextAction,
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
    const packageBlocked = packageRow.accepted === false
      || String(providerSync.status || "").startsWith("package-")
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
        auditId: "string",
        leasedCapabilities: "array",
      },
      rows: capabilityRows
        .filter((row) => row.status === "lease-ready" || row.status === "delegated-ready")
        .map((row) => ({
          envelopeId: ownershipEnvelope?.envelopeId || null,
          operationId: row.operationId,
          ownerId: row.ownerId,
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
        },
        lifecycleStatus: row.lifecycleStatus,
        packageAcceptanceStatus: row.packageAcceptanceStatus,
        packageAcceptanceKey: row.packageAcceptanceKey,
        providerTruthStatus: row.providerTruthStatus,
        providerPackageSyncKey: row.providerPackageSyncKey,
        previewReadiness: row.previewReadiness,
        nextAction: row.nextAction,
      })),
    },
  };
}

function buildApprovalExternalHandoffState(providerContract, clientRuntimeAdoption, runtimeActionQueue, exportManifest, runtimeHealth) {
  const adoptionByOperation = new Map((clientRuntimeAdoption.rows || []).map((row) => [row.operationId, row]));
  const actionByOperation = new Map((runtimeActionQueue.rows || []).map((row) => [row.operationId, row]));
  const manifestByOperation = new Map((exportManifest.rows || []).map((row) => [row.operationId, row]));
  const rows = (providerContract.externalHandoff?.rows || []).map((providerRow) => {
    const adoptionRow = adoptionByOperation.get(providerRow.operationId) || {};
    const actionRow = actionByOperation.get(providerRow.operationId) || {};
    const manifestRow = manifestByOperation.get(providerRow.operationId) || {};
    const permissionBoundary = normalizePermissionBoundaryHandoff(providerRow, adoptionRow, runtimeHealth);
    const blockedBy = [
      ...(providerRow.payloadReady === false ? ["ownership-envelope:payload-not-ready"] : []),
      ...permissionBoundary.blockedBy,
      ...(adoptionRow.status === "blocked" || adoptionRow.blockedReason ? [`adoption:${adoptionRow.blockedReason || "blocked"}`] : []),
      ...(actionRow.action === "repair" ? [`runtime-action:${actionRow.blockedReason || "repair-required"}`] : []),
      ...(manifestRow.exportable === false ? ["export:status-metadata-missing"] : []),
      ...(runtimeHealth.retry.exhausted ? ["runtime:retry-exhausted"] : []),
    ].sort();
    const pendingBy = [
      ...permissionBoundary.pendingBy,
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
      payload: {
        ...(providerRow.payload || {}),
        permissionBoundary,
        permissionStatusPatch: permissionBoundary.statusPatch,
        permissionCommands: permissionBoundary.commands,
        approvalStatus: manifestRow.approvalStatus || "unknown",
        runtimeAction: actionRow.action || "observe",
        providerSyncKey: providerContract.syncKey,
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
        prerequisiteCommand: permissionStatusCommand,
      },
      nextAction: blockedBy.length
        ? blockedBy[0].startsWith("permission:")
          ? permissionBoundary.nextAction
          : blockedBy[0].startsWith("permission-status:")
            ? permissionBoundary.nextAction
          : blockedBy[0].startsWith("adoption:")
          ? adoptionRow.nextAction || clientRuntimeAdoption.nextAction
          : blockedBy[0] === "runtime:retry-exhausted"
            ? "surface_retry_exhaustion"
            : "repair_provider_handoff_payload"
        : pendingBy.length
          ? pendingBy[0].startsWith("permission:")
            ? permissionBoundary.nextAction
            : pendingBy[0].startsWith("permission-status:")
              ? permissionBoundary.nextAction
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
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || dispatchRows[0]?.nextAction
      || runtimeActionQueue.nextAction,
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
  const ownershipJournal = ownership?.controlPersistence?.restartJournal || {};
  const actionByOperation = new Map((runtimeActionQueue.rows || []).map((row) => [row.operationId, row]));

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
      counters: {
        operations: 0,
        restartSafe: 0,
        blocked: 0,
        pending: 0,
        dispatchBlocked: 0,
      },
      nextAction: ownershipJournal.nextAction || externalHandoffState.nextAction || "wait_for_mailchimp_handoff",
    };
  }

  const rows = (journal.rows || []).map((row) => {
    const actionRow = actionByOperation.get(row.operationId) || {};
    const dispatchBlocked = row.status === "blocked"
      || row.status === "operator-review"
      || actionRow.action === "repair";
    const blockedBy = [
      ...((row.blockedBy || []).map((blocker) => `restart-journal:${blocker}`)),
      ...(row.status === "operator-review" ? ["restart-journal:operator-review"] : []),
      ...(actionRow.action === "repair" ? [`runtime-action:${actionRow.blockedReason || "repair-required"}`] : []),
    ].sort();
    const pendingBy = [
      ...((row.pendingBy || []).map((pending) => `restart-journal:${pending}`)),
      ...(row.status === "pending" ? ["restart-journal:pending"] : []),
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
      commandEnabled: row.command?.enabled === true,
      nextAction: dispatchBlocked
        ? row.nextAction || actionRow.nextAction || "repair_restart_journal"
        : pendingBy.length
          ? row.nextAction || "wait_for_restart_journal"
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
      statusPathLinked: rows.filter((row) => row.statusPath).length,
    },
    nextAction: blockedRows[0]?.nextAction
      || pendingRows[0]?.nextAction
      || journal.nextAction
      || "publish_restart_journal",
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
    const adoptionBlocked = truthAdoption.acceptedForClient === false
      || truthAdoption.metadataMatches === false
      || truthAdoption.boundaryMatches === false
      || truthAdoption.handoffAllowed === false
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
        canAdoptRuntime: !blockedReason && Boolean(adoptionKey) && providerContract.handoffAllowed === true,
      },
      nextAction: blockedReason === "package-acceptance"
        ? packageRow.nextStep?.action || provider.nextAction || ownershipSync.packageAcceptanceNextAction || packageAcceptance?.nextAction || "repair_package_acceptance_preview"
        : blockedReason === "client-runtime-adoption"
          ? truthAdoption.nextAction || "repair_client_runtime_adoption_evidence"
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
  const externalHandoffState = buildApprovalExternalHandoffState(
    providerContract,
    clientRuntimeAdoption,
    runtimeActionQueue,
    exportManifest,
    runtimeHealth,
  );
  const packageRestartJournalPreview = normalizePackageRestartJournalPreview(
    source,
    ownership,
    runtimeActionQueue,
    externalHandoffState,
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
        || syscallRecoveryPreview.status === "blocked"
        || approvalControlPlaneState.status === "blocked"
        ? "blocked"
        : packageRestartJournalPreview.status === "pending"
          ? "pending-restart-journal"
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
        nextAction: packageRestartJournalPreview.nextAction,
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
