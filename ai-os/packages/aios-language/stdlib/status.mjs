import { compileMailchimpClaimContract, validateMailchimpClaimContract } from "./claims.mjs";
import { compileMailchimpApprovalContract, validateMailchimpApprovals } from "./approvals.mjs";
import {
  buildMailchimpRecoveryGate,
  buildMailchimpRecoveryHandoff,
  buildMailchimpRecoveryRuntimeState,
  compileMailchimpRecoveryPlan,
  buildMailchimpRecoveryAccessBoundary,
} from "./recovery.mjs";

const STATUS_PROTOCOL = "aios.mailchimp.stdlib-status.v1";

function compactString(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return compactString(value).toLowerCase().replaceAll("-", "_");
}

function countByStatus(items = []) {
  return items.reduce((counts, item) => {
    const status = normalizeToken(item.status || (item.passed === true ? "passed" : "unknown"));
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function uniqueBy(values, keyFor) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeRole(value) {
  const role = normalizeToken(value || "viewer");
  if (["owner", "admin", "operator", "viewer", "auditor"].includes(role)) return role;
  return "viewer";
}

function buildStatusAccessBoundary(source, claimContract, gate, recoveryRuntimeState) {
  const actor = source.actor ?? {};
  const role = normalizeRole(source.role ?? actor.role ?? "operator");
  const permissions = uniqueSorted([
    ...(Array.isArray(source.permissions) ? source.permissions : []),
    ...(Array.isArray(actor.permissions) ? actor.permissions : [])
  ]).map(normalizeToken);
  const requiredPermissions = gate.ready
    ? ["mailchimp.status.handoff"]
    : ["mailchimp.status.review"];
  const roleAllowsHandoff = ["owner", "admin", "operator"].includes(role);
  const tenantId = compactString(source.tenantId ?? actor.tenantId ?? claimContract.tenantId);
  const workspaceId = compactString(source.workspaceId ?? actor.workspaceId ?? claimContract.workspaceId);
  const sameTenant = tenantId === claimContract.tenantId;
  const sameWorkspace = workspaceId === claimContract.workspaceId;
  const permissionScoped = permissions.length > 0;
  const missingPermissions = permissionScoped
    ? requiredPermissions.filter((permission) => (
        !permissions.includes(permission) && !permissions.includes("mailchimp.status.*")
      ))
    : [];
  const blockers = [
    ...(sameTenant ? [] : [{
      code: "mailchimp.status.tenant_mismatch",
      category: "isolation",
      message: "actor tenant does not match Mailchimp status tenant"
    }]),
    ...(sameWorkspace ? [] : [{
      code: "mailchimp.status.workspace_mismatch",
      category: "isolation",
      message: "actor workspace does not match Mailchimp status workspace"
    }]),
    ...(roleAllowsHandoff ? [] : [{
      code: "mailchimp.status.role_denied",
      category: "permission",
      message: "actor role cannot approve Mailchimp adapter handoff"
    }]),
    ...missingPermissions.map((permission) => ({
      code: "mailchimp.status.permission_missing",
      category: "permission",
      subject: permission,
      message: `missing permission ${permission}`
    }))
  ];

  return {
    protocol: "aios.mailchimp.status-access-boundary.v1",
    adapter: "mailchimp",
    actor: {
      id: compactString(source.actorId ?? actor.id) || "operator",
      role,
      tenantId,
      workspaceId,
      permissions
    },
    requiredPermissions,
    permissionScoped,
    allowed: blockers.length === 0,
    blockers,
    isolation: {
      tenantId: claimContract.tenantId,
      workspaceId: claimContract.workspaceId,
      sameTenant,
      sameWorkspace,
      recoveryStateKey: recoveryRuntimeState.persistenceSnapshot.stateKey
    },
    truthBoundary: {
      source: "mailchimp-status-access-boundary",
      externalWrites: false,
      requiresRuntimeAdapter: false,
      evaluatedAgainst: STATUS_PROTOCOL
    }
  };
}

function readinessFrom(claimValidation, approvalValidation, recoveryPlan) {
  if (claimValidation.passed !== true) {
    return {
      ready: false,
      state: "waiting_for_claims",
      nextStep: "bind-required-mailchimp-claim-inputs"
    };
  }
  if (approvalValidation.passed !== true) {
    return {
      ready: false,
      state: approvalValidation.status,
      nextStep: "resolve-mailchimp-approvals"
    };
  }
  if (recoveryPlan.status !== "ready") {
    return {
      ready: false,
      state: recoveryPlan.status,
      nextStep: recoveryPlan.nextAction
    };
  }
  return {
    ready: true,
    state: "ready_for_adapter_handoff",
    nextStep: "dispatch-mailchimp-adapter"
  };
}

function buildStatusGate({ claimValidation, approvalValidation, recoveryGate, readiness }, options = {}) {
  const accepted = Boolean(options.accepted ?? false);
  const blockers = [
    ...claimValidation.failedClaims.map((claim) => ({
      id: ["mailchimp.status.blocker.claim", claim.id || claim.code].map(normalizeToken).join("."),
      code: claim.code || "mailchimp.claim.validation_failed",
      category: "claim",
      subject: compactString(claim.id || claim.subject),
      action: "bind-required-mailchimp-claim-inputs",
      message: compactString(claim.message) || "Required Mailchimp claim input is missing"
    })),
    ...approvalValidation.blockingApprovals.map((approval) => ({
      id: ["mailchimp.status.blocker.approval", approval.key || approval.code].map(normalizeToken).join("."),
      code: approval.code || "mailchimp.approval.blocking",
      category: "operator",
      subject: compactString(approval.key || approval.subject),
      action: "resolve-mailchimp-approvals",
      message: compactString(approval.message) || "Operator approval is required before handoff"
    })),
    ...recoveryGate.blockers.map((blocker) => ({
      id: blocker.id,
      code: blocker.code,
      category: blocker.category,
      subject: blocker.subject,
      action: blocker.action,
      message: blocker.message,
      retryAfterSeconds: blocker.retryAfterSeconds
    }))
  ];
  const deduped = blockers.filter((blocker, index) => (
    blockers.findIndex((candidate) => (
      candidate.code === blocker.code && candidate.subject === blocker.subject
    )) === index
  ));
  const status = deriveStatusGateState(readiness, recoveryGate, deduped, accepted);

  return {
    protocol: "aios.mailchimp.status-gate.v1",
    adapter: "mailchimp",
    ready: status === "open",
    accepted,
    status,
    nextAction: nextStatusGateAction(status, readiness, recoveryGate),
    blockerCount: deduped.length,
    blockers: deduped,
    categories: countByStatus(deduped.map((blocker) => ({ status: blocker.category }))),
    restartSafe: recoveryGate.restartSafe && !deduped.some((blocker) => blocker.category === "operator"),
    truthBoundary: {
      source: "mailchimp-status-gate",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: STATUS_PROTOCOL
    }
  };
}

function deriveStatusGateState(readiness, recoveryGate, blockers, accepted) {
  if (blockers.length === 0 && readiness.ready && accepted) return "open";
  if (blockers.length === 0 && readiness.ready) return "awaiting_acceptance";
  if (blockers.some((blocker) => blocker.category === "claim")) return "claim_blocked";
  if (blockers.some((blocker) => blocker.category === "operator")) return "operator_blocked";
  if (recoveryGate.status === "adapter_blocked") return "adapter_blocked";
  if (recoveryGate.status === "recoverable") return "recoverable";
  return "contract_blocked";
}

function nextStatusGateAction(status, readiness, recoveryGate) {
  if (status === "open") return "dispatch-mailchimp-adapter";
  if (status === "awaiting_acceptance") return "collect-operator-acceptance";
  if (status === "claim_blocked") return "bind-required-mailchimp-claim-inputs";
  if (status === "operator_blocked") return "resolve-mailchimp-approvals";
  if (status === "adapter_blocked") return "poll-mailchimp-adapter-health";
  return recoveryGate.nextAction || readiness.nextStep || "repair-contract-before-handoff";
}

function buildPersistedStatusState({
  claimContract,
  approvalValidation,
  recoveryPlan,
  recoveryRuntimeState,
  gate,
  readiness,
  accessBoundary
}) {
  const claimScope = {
    tenantId: claimContract.tenantId,
    workspaceId: claimContract.workspaceId,
    sourceId: claimContract.sourceId,
    campaignId: claimContract.campaignId
  };
  const pendingApprovals = approvalValidation.blockingApprovals.map((approval) => ({
    key: compactString(approval.key || approval.subject),
    code: approval.code || "mailchimp.approval.blocking",
    message: compactString(approval.message) || "Operator approval is required before handoff"
  }));
  const persistedBlockers = gate.blockers.map((blocker) => ({
    code: blocker.code,
    category: blocker.category,
    subject: blocker.subject,
    action: blocker.action,
    retryAfterSeconds: blocker.retryAfterSeconds ?? null
  }));
  const restartKey = [
    "mailchimp.status",
    claimScope.tenantId,
    claimScope.workspaceId,
    claimScope.sourceId,
    recoveryRuntimeState.fingerprint
  ].map(normalizeToken).join(".");

  return {
    protocol: "aios.mailchimp.status-persisted-state.v1",
    adapter: "mailchimp",
    scope: claimScope,
    state: readiness.state,
    ready: gate.ready,
    restartKey,
    restartSafe: gate.restartSafe && recoveryRuntimeState.restartSafe,
    recoveryFingerprint: recoveryRuntimeState.fingerprint,
    recoveryResumeCursor: recoveryRuntimeState.resumeCursor,
    recoveryPersistence: recoveryRuntimeState.persistenceSnapshot,
    accessBoundary: {
      allowed: accessBoundary.allowed,
      actorId: accessBoundary.actor.id,
      role: accessBoundary.actor.role,
      blockerCount: accessBoundary.blockers.length,
      requiredPermissions: accessBoundary.requiredPermissions
    },
    pendingApprovals,
    blockers: persistedBlockers,
    counters: {
      blockers: persistedBlockers.length,
      pendingApprovals: pendingApprovals.length,
      recoveryCommands: recoveryPlan.commands.length,
      recoveryPending: recoveryRuntimeState.checkpoint.pendingCount,
      recoveryFailed: recoveryRuntimeState.checkpoint.failedCount,
      accessBlockers: accessBoundary.blockers.length
    },
    clientState: {
      visibleStatus: recoveryRuntimeState.clientWorkflow.visibleStatus,
      primaryAction: gate.nextAction,
      disabledReason: gate.ready ? null : gate.blockers[0]?.message || recoveryRuntimeState.clientWorkflow.disabledReason,
      retryAfterSeconds: recoveryRuntimeState.clientWorkflow.retryAfterSeconds,
      resumeCursor: recoveryRuntimeState.resumeCursor,
      phase: recoveryRuntimeState.phase
    },
    truthBoundary: {
      source: "mailchimp-status-persisted-state",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: STATUS_PROTOCOL
    }
  };
}

function buildStatusAuditHandoff({ status, claimContract, gate, persistedState, accessBoundary }) {
  const blockers = uniqueSorted([
    ...gate.blockers.map((blocker) => blocker.message),
    ...accessBoundary.blockers.map((blocker) => blocker.message)
  ]);

  return {
    protocol: "aios.mailchimp.status-audit-handoff.v1",
    adapter: "mailchimp",
    tenantId: claimContract.tenantId,
    workspaceId: claimContract.workspaceId,
    sourceId: claimContract.sourceId,
    ready: status.ready && accessBoundary.allowed,
    state: status.state,
    gateStatus: gate.status,
    restartKey: persistedState.restartKey,
    recoveryStateKey: persistedState.recoveryPersistence.stateKey,
    actor: accessBoundary.actor,
    auditSubjects: [
      persistedState.restartKey,
      persistedState.recoveryPersistence.stateKey,
      ...persistedState.recoveryPersistence.commands.map((command) => command.auditSubject)
    ],
    blockedReasons: blockers,
    counters: {
      blockers: blockers.length,
      recoveryCommands: persistedState.counters.recoveryCommands,
      pendingApprovals: persistedState.counters.pendingApprovals,
      accessBlockers: accessBoundary.blockers.length
    },
    truthBoundary: {
      source: "mailchimp-status-audit-handoff",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: STATUS_PROTOCOL
    }
  };
}

function buildStatusOperationalHealth({
  readiness,
  gate,
  accessBoundary,
  recoveryPlan,
  recoveryRuntimeState,
  recoveryAccessBoundary,
  persistedState
}) {
  const recoveryPersistence = persistedState.recoveryPersistence;
  const retrySchedule = recoveryPersistence.retrySchedule ?? [];
  const degradedReasons = uniqueSorted([
    ...(readiness.ready ? [] : [readiness.nextStep]),
    ...gate.blockers.map((blocker) => blocker.message),
    ...accessBoundary.blockers.map((blocker) => blocker.message),
    ...recoveryAccessBoundary.blockers.map((blocker) => blocker.message),
    ...(recoveryRuntimeState.phase === "waiting_for_adapter"
      ? ["Mailchimp adapter health is delaying status handoff"]
      : []),
    ...(recoveryRuntimeState.phase === "failed_recovery"
      ? ["Mailchimp recovery command failed and needs review"]
      : [])
  ]);
  const hardFailure = gate.blockers.some((blocker) => blocker.category === "claim")
    || accessBoundary.blockers.some((blocker) => blocker.category === "isolation")
    || recoveryAccessBoundary.blockers.some((blocker) => blocker.category === "isolation")
    || recoveryRuntimeState.phase === "failed_recovery";
  const degraded = degradedReasons.length > 0 || recoveryPlan.adapterHealth.status !== "healthy";
  const retryWindows = retrySchedule
    .map((entry) => Number(entry.retryAfterSeconds))
    .filter((value) => Number.isFinite(value));
  const retryAfterSeconds = retryWindows.length > 0
    ? Math.min(...retryWindows)
    : recoveryPlan.adapterHealth.retryAfterSeconds;
  const health = hardFailure
    ? "failed"
    : degraded
      ? "degraded"
      : "healthy";
  const action = health === "healthy"
    ? "dispatch-mailchimp-adapter"
    : hardFailure
      ? "review-mailchimp-status-failure"
      : retryAfterSeconds != null
        ? "schedule-mailchimp-status-retry"
        : "repair-mailchimp-status-handoff";
  const severity = deriveOperationalSeverity({
    health,
    hardFailure,
    gate,
    accessBoundary,
    recoveryAccessBoundary,
    retryAfterSeconds
  });
  const incident = buildStatusIncidentReport({
    health,
    severity,
    action,
    degradedReasons,
    retryAfterSeconds,
    gate,
    accessBoundary,
    recoveryAccessBoundary,
    recoveryRuntimeState,
    persistedState
  });
  const actionQueue = buildStatusActionQueue({
    action,
    health,
    hardFailure,
    retryAfterSeconds,
    gate,
    accessBoundary,
    recoveryAccessBoundary,
    persistedState
  });
  const exportReadiness = buildStatusHealthExportReadiness({
    health,
    severity,
    action,
    incident,
    actionQueue,
    gate,
    accessBoundary,
    recoveryAccessBoundary,
    recoveryPersistence
  });

  return {
    protocol: "aios.mailchimp.status-operational-health.v1",
    adapter: "mailchimp",
    health,
    severity,
    degraded,
    failed: hardFailure,
    actionable: health !== "healthy",
    nextAction: action,
    retry: {
      retryable: !hardFailure && (retrySchedule.length > 0 || recoveryPlan.retryable),
      retryAfterSeconds: retryAfterSeconds == null ? null : Math.max(0, Math.floor(Number(retryAfterSeconds))),
      schedule: retrySchedule,
      backoffSource: retrySchedule.length > 0 ? "recovery-command" : "adapter-health"
    },
    degradedMode: {
      enabled: health === "degraded",
      mode: health === "degraded" ? "local-status-only" : null,
      externalWritesAllowed: false,
      handoffPermitted: health === "healthy" && gate.ready && accessBoundary.allowed && recoveryAccessBoundary.allowed
    },
    incident,
    actionQueue,
    exportReadiness,
    errors: degradedReasons.map((reason, index) => ({
      code: ["mailchimp.status.health", health, index + 1].map(normalizeToken).join("."),
      message: reason,
      action: hardFailure ? "review-mailchimp-status-failure" : action,
      retryable: !hardFailure
    })),
    counters: {
      statusBlockers: gate.blockers.length,
      accessBlockers: accessBoundary.blockers.length,
      recoveryAccessBlockers: recoveryAccessBoundary.blockers.length,
      retryCommands: retrySchedule.length,
      pendingRecoveryCommands: recoveryPersistence.counters.pending,
      failedRecoveryCommands: recoveryPersistence.counters.failed
    },
    truthBoundary: {
      source: "mailchimp-status-operational-health",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: STATUS_PROTOCOL
    }
  };
}

function deriveOperationalSeverity({
  health,
  hardFailure,
  gate,
  accessBoundary,
  recoveryAccessBoundary,
  retryAfterSeconds
}) {
  if (health === "healthy") return "none";
  if (hardFailure) return "critical";
  if (accessBoundary.blockers.length > 0 || recoveryAccessBoundary.blockers.length > 0) return "high";
  if (gate.blockers.some((blocker) => blocker.category === "operator")) return "medium";
  if (Number.isFinite(Number(retryAfterSeconds))) return "low";
  return "medium";
}

function buildStatusIncidentReport({
  health,
  severity,
  action,
  degradedReasons,
  retryAfterSeconds,
  gate,
  accessBoundary,
  recoveryAccessBoundary,
  recoveryRuntimeState,
  persistedState
}) {
  const recoveryPersistence = persistedState.recoveryPersistence;
  const incidentId = [
    "mailchimp.status.incident",
    persistedState.scope.tenantId,
    persistedState.scope.workspaceId,
    persistedState.scope.sourceId,
    health,
    severity,
    recoveryPersistence.resume.mode
  ].map(normalizeToken).join(".");
  const timeline = [
    {
      sequence: 1,
      at: "logical:status.gate",
      status: gate.status,
      source: "status-gate",
      message: gate.ready
        ? "Mailchimp status gate is open"
        : gate.blockers[0]?.message ?? "Mailchimp status gate is blocked",
      action: gate.nextAction
    },
    {
      sequence: 2,
      at: "logical:status.access",
      status: accessBoundary.allowed ? "allowed" : "blocked",
      source: "status-access",
      message: accessBoundary.allowed
        ? "Mailchimp status actor can operate in scope"
        : accessBoundary.blockers[0]?.message ?? "Mailchimp status access is blocked",
      action: accessBoundary.allowed ? "continue-mailchimp-status-handoff" : "resolve-mailchimp-status-access"
    },
    {
      sequence: 3,
      at: "logical:recovery.access",
      status: recoveryAccessBoundary.allowed ? "allowed" : "blocked",
      source: "recovery-access",
      message: recoveryAccessBoundary.allowed
        ? "Mailchimp recovery actor can operate in scope"
        : recoveryAccessBoundary.blockers[0]?.message ?? "Mailchimp recovery access is blocked",
      action: recoveryAccessBoundary.allowed ? "continue-mailchimp-recovery" : "resolve-mailchimp-recovery-access"
    },
    {
      sequence: 4,
      at: "logical:recovery.runtime",
      status: recoveryRuntimeState.phase,
      source: "recovery-runtime",
      message: recoveryRuntimeState.clientWorkflow.disabledReason
        ?? recoveryRuntimeState.clientWorkflow.visibleStatus,
      action: recoveryRuntimeState.clientWorkflow.primaryAction
    }
  ];
  const activeReasons = degradedReasons.length > 0
    ? degradedReasons
    : ["Mailchimp status handoff is healthy"];

  return {
    protocol: "aios.mailchimp.status-incident-report.v1",
    incidentId,
    health,
    severity,
    open: health !== "healthy",
    status: health === "healthy" ? "closed" : severity === "critical" ? "failure_review" : "degraded_watch",
    nextAction: action,
    retryAfterSeconds: retryAfterSeconds == null ? null : Math.max(0, Math.floor(Number(retryAfterSeconds))),
    primaryReason: activeReasons[0],
    reasonCodes: activeReasons.map((reason, index) => ({
      code: ["mailchimp.status.incident.reason", index + 1].map(normalizeToken).join("."),
      message: reason
    })),
    timeline,
    resume: {
      mode: recoveryPersistence.resume.mode,
      cursor: recoveryPersistence.resume.cursor,
      runnableCommandId: recoveryPersistence.resume.runnableCommandId,
      restartSafe: recoveryPersistence.resume.restartSafe
    },
    counters: {
      reasons: activeReasons.length,
      gateBlockers: gate.blockerCount,
      accessBlockers: accessBoundary.blockers.length,
      recoveryAccessBlockers: recoveryAccessBoundary.blockers.length,
      pendingRecoveryCommands: recoveryPersistence.counters.pending,
      failedRecoveryCommands: recoveryPersistence.counters.failed
    }
  };
}

function buildStatusActionQueue({
  action,
  health,
  hardFailure,
  retryAfterSeconds,
  gate,
  accessBoundary,
  recoveryAccessBoundary,
  persistedState
}) {
  const recoveryPersistence = persistedState.recoveryPersistence;
  const queue = [
    ...accessBoundary.blockers.map((blocker, index) => ({
      id: ["mailchimp.status.action", "access", index + 1, blocker.code].map(normalizeToken).join("."),
      command: "resolve-mailchimp-status-access",
      category: blocker.category,
      label: "Resolve status access",
      reason: blocker.message,
      retryable: false,
      restartSafe: true
    })),
    ...recoveryAccessBoundary.blockers.map((blocker, index) => ({
      id: ["mailchimp.status.action", "recovery_access", index + 1, blocker.code].map(normalizeToken).join("."),
      command: "resolve-mailchimp-recovery-access",
      category: blocker.category,
      label: "Resolve recovery access",
      reason: blocker.message,
      retryable: false,
      restartSafe: true
    })),
    ...gate.blockers.map((blocker, index) => ({
      id: ["mailchimp.status.action", "gate", index + 1, blocker.code].map(normalizeToken).join("."),
      command: blocker.action,
      category: blocker.category,
      label: blocker.category === "operator" ? "Resolve operator decision" : "Resolve status blocker",
      reason: blocker.message,
      retryAfterSeconds: blocker.retryAfterSeconds ?? null,
      retryable: blocker.retryAfterSeconds != null,
      restartSafe: blocker.restartSafe !== false
    })),
    ...recoveryPersistence.retrySchedule.map((entry, index) => ({
      id: ["mailchimp.status.action", "retry", index + 1, entry.commandId].map(normalizeToken).join("."),
      command: "schedule-mailchimp-status-retry",
      category: "retry",
      label: "Schedule status retry",
      reason: `retry ${entry.commandId} after ${entry.retryAfterSeconds ?? 0} second(s)`,
      retryAfterSeconds: entry.retryAfterSeconds ?? null,
      retryAt: entry.retryAt,
      retryable: true,
      restartSafe: true
    }))
  ];
  const fallback = queue.length === 0 && health !== "healthy"
    ? [{
        id: ["mailchimp.status.action", "fallback", action].map(normalizeToken).join("."),
        command: action,
        category: hardFailure ? "failure" : "repair",
        label: hardFailure ? "Review status failure" : "Repair status handoff",
        reason: hardFailure
          ? "Mailchimp status failure requires review"
          : "Mailchimp status handoff requires repair",
        retryAfterSeconds: retryAfterSeconds ?? null,
        retryable: !hardFailure,
        restartSafe: !hardFailure
      }]
    : [];

  return uniqueBy([...queue, ...fallback], (item) => [item.command, item.category, item.reason].join(":"))
    .map((item, index) => ({
      sequence: index + 1,
      ...item
    }));
}

function buildStatusHealthExportReadiness({
  health,
  severity,
  action,
  incident,
  actionQueue,
  gate,
  accessBoundary,
  recoveryAccessBoundary,
  recoveryPersistence
}) {
  const readyForExport = health !== "failed"
    && accessBoundary.allowed
    && recoveryAccessBoundary.allowed
    && recoveryPersistence.resume.restartSafe;
  return {
    protocol: "aios.mailchimp.status-health-export.v1",
    exportId: [
      "mailchimp.status.health.export",
      recoveryPersistence.scope.tenantId,
      recoveryPersistence.scope.workspaceId,
      recoveryPersistence.scope.sourceId,
      incident.incidentId
    ].map(normalizeToken).join("."),
    readyForExport,
    exportStatus: readyForExport ? health : "blocked",
    health,
    severity,
    nextAction: readyForExport ? action : actionQueue[0]?.command ?? "review-mailchimp-status-failure",
    incidentId: incident.incidentId,
    gateStatus: gate.status,
    restartSafe: recoveryPersistence.resume.restartSafe,
    actionCount: actionQueue.length,
    blockerCount: gate.blockerCount + accessBoundary.blockers.length + recoveryAccessBoundary.blockers.length,
    resumeMode: recoveryPersistence.resume.mode,
    auditSubjects: [
      recoveryPersistence.stateKey,
      ...recoveryPersistence.commands.map((command) => command.auditSubject)
    ],
    truthBoundary: {
      source: "mailchimp-status-health-export",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      degradedExportsAllowed: true
    }
  };
}

function buildStatusExportPacket({
  claimContract,
  readiness,
  gate,
  accessBoundary,
  recoveryAccessBoundary,
  recoveryRuntimeState,
  persistedState,
  auditHandoff,
  operationalHealth
}) {
  const recoveryExport = recoveryRuntimeState.exportPacket;
  const healthExport = operationalHealth.exportReadiness;
  const readyForExport = auditHandoff.ready
    && healthExport.readyForExport
    && recoveryExport.readyForExport
    && accessBoundary.allowed
    && recoveryAccessBoundary.allowed;
  const timeline = [
    {
      sequence: 1,
      at: "logical:status.readiness",
      status: readiness.state,
      source: "status-readiness",
      message: readiness.ready
        ? "Mailchimp status contract is ready"
        : `Mailchimp status waits for ${readiness.nextStep}`,
      action: readiness.nextStep
    },
    {
      sequence: 2,
      at: "logical:status.gate",
      status: gate.status,
      source: "status-gate",
      message: gate.ready
        ? "Mailchimp status gate is open"
        : gate.blockers[0]?.message ?? "Mailchimp status gate is blocked",
      action: gate.nextAction
    },
    {
      sequence: 3,
      at: "logical:status.health",
      status: operationalHealth.health,
      source: "status-health",
      message: operationalHealth.incident.primaryReason,
      action: operationalHealth.nextAction,
      retryAfterSeconds: operationalHealth.retry.retryAfterSeconds
    },
    ...recoveryExport.timeline.map((event) => ({
      sequence: event.sequence + 3,
      at: event.at,
      status: event.status,
      source: event.source,
      message: event.message,
      action: event.action,
      commandId: event.commandId ?? null,
      cursor: event.cursor ?? null
    }))
  ];
  const exportId = [
    "mailchimp.status.export",
    claimContract.tenantId,
    claimContract.workspaceId,
    claimContract.sourceId,
    persistedState.restartKey,
    operationalHealth.health,
    recoveryExport.exportId
  ].map(normalizeToken).join(".");
  const blockers = uniqueSorted([
    ...gate.blockers.map((blocker) => blocker.message),
    ...accessBoundary.blockers.map((blocker) => blocker.message),
    ...recoveryAccessBoundary.blockers.map((blocker) => blocker.message),
    ...(healthExport.readyForExport ? [] : [`health export blocked by ${healthExport.nextAction}`]),
    ...(recoveryExport.readyForExport ? [] : [`recovery export blocked by ${recoveryExport.nextAction}`])
  ]);

  return {
    protocol: "aios.mailchimp.status-export-packet.v1",
    adapter: "mailchimp",
    exportId,
    readyForExport,
    exportStatus: readyForExport
      ? operationalHealth.health
      : operationalHealth.health === "failed"
        ? "blocked"
        : "pending",
    nextAction: readyForExport
      ? "export-mailchimp-status-summary"
      : blockers.length > 0
        ? operationalHealth.nextAction
        : gate.nextAction,
    scope: {
      tenantId: claimContract.tenantId,
      workspaceId: claimContract.workspaceId,
      sourceId: claimContract.sourceId,
      campaignId: claimContract.campaignId
    },
    counters: {
      timelineEvents: timeline.length,
      blockers: blockers.length,
      gateBlockers: gate.blockerCount,
      accessBlockers: accessBoundary.blockers.length,
      recoveryAccessBlockers: recoveryAccessBoundary.blockers.length,
      healthActions: operationalHealth.actionQueue.length,
      healthErrors: operationalHealth.errors.length,
      recoveryCommands: recoveryExport.counters.commands,
      recoveryPending: recoveryExport.counters.pending,
      recoveryFailed: recoveryExport.counters.failed,
      auditSubjects: auditHandoff.auditSubjects.length + healthExport.auditSubjects.length
    },
    timeline,
    historySnapshots: timeline.map((event) => ({
      key: [
        "mailchimp.status.history",
        claimContract.tenantId,
        claimContract.workspaceId,
        claimContract.sourceId,
        event.sequence,
        event.status,
        event.source
      ].map(normalizeToken).join("."),
      sequence: event.sequence,
      at: event.at,
      status: event.status,
      source: event.source,
      exportId,
      ready: readyForExport && event.sequence === timeline.length
    })),
    summaries: {
      state: readiness.state,
      gateStatus: gate.status,
      health: operationalHealth.health,
      severity: operationalHealth.severity,
      incidentId: operationalHealth.incident.incidentId,
      restartKey: persistedState.restartKey,
      recoveryExportId: recoveryExport.exportId,
      recoveryStateKey: persistedState.recoveryPersistence.stateKey,
      healthExportId: healthExport.exportId
    },
    blockedReasons: blockers,
    auditSubjects: uniqueSorted([
      ...auditHandoff.auditSubjects,
      ...healthExport.auditSubjects,
      ...recoveryExport.auditSubjects
    ]),
    handoffState: {
      restartKey: persistedState.restartKey,
      recoveryStateKey: persistedState.recoveryPersistence.stateKey,
      resumeCursor: persistedState.recoveryResumeCursor,
      resumeMode: persistedState.recoveryPersistence.resume.mode,
      healthExportId: healthExport.exportId,
      recoveryExportId: recoveryExport.exportId,
      restartSafe: persistedState.restartSafe && recoveryExport.handoffState.restartSafe
    },
    truthBoundary: {
      source: "mailchimp-status-export-packet",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: STATUS_PROTOCOL
    }
  };
}

function buildStatusExternalHandoffState({
  claimContract,
  gate,
  accessBoundary,
  recoveryAccessBoundary,
  recoveryRuntimeState,
  recoveryHandoff,
  persistedState,
  auditHandoff,
  operationalHealth,
  exportPacket
}, options = {}) {
  const requestedCapabilities = uniqueSorted([
    "mailchimp:status.read",
    "mailchimp:status.handoff",
    ...(Array.isArray(options.requestedCapabilities) ? options.requestedCapabilities : []),
    ...(recoveryHandoff?.capabilities ?? [])
  ]);
  const providerCapabilities = uniqueSorted(
    Array.isArray(options.providerCapabilities)
      ? options.providerCapabilities
      : requestedCapabilities
  );
  const grantedCapabilities = requestedCapabilities.filter((capability) => (
    providerCapabilities.includes(capability)
  ));
  const deniedCapabilities = requestedCapabilities.filter((capability) => (
    !providerCapabilities.includes(capability)
  ));
  const ready = exportPacket.readyForExport
    && gate.ready
    && accessBoundary.allowed
    && recoveryAccessBoundary.allowed
    && operationalHealth.health !== "failed"
    && deniedCapabilities.length === 0;
  const syncCursor = [
    persistedState.restartKey,
    persistedState.recoveryPersistence.resume.cursor,
    exportPacket.exportId
  ].map(normalizeToken).join(".");
  const blockedReasons = uniqueSorted([
    ...exportPacket.blockedReasons,
    ...gate.blockers.map((blocker) => blocker.message),
    ...accessBoundary.blockers.map((blocker) => blocker.message),
    ...recoveryAccessBoundary.blockers.map((blocker) => blocker.message),
    ...deniedCapabilities.map((capability) => `provider capability denied: ${capability}`),
    ...(operationalHealth.health === "failed" ? [operationalHealth.incident.primaryReason] : [])
  ]);

  return {
    protocol: "aios.mailchimp.status-external-handoff.v1",
    adapter: "mailchimp",
    tenantId: claimContract.tenantId,
    workspaceId: claimContract.workspaceId,
    sourceId: claimContract.sourceId,
    ready,
    status: ready
      ? "ready_for_external_handoff"
      : accessBoundary.allowed && recoveryAccessBoundary.allowed
        ? "waiting_for_provider_readiness"
        : "access_blocked",
    nextAction: ready
      ? "handoff-mailchimp-status-export"
      : blockedReasons.length > 0
        ? exportPacket.nextAction
        : gate.nextAction,
    negotiation: {
      requestedCapabilities,
      grantedCapabilities,
      deniedCapabilities,
      satisfied: deniedCapabilities.length === 0,
      requiredRuntimeAdapter: "mailchimp",
      memoryWritePolicy: "local-only"
    },
    sync: {
      direction: "local-to-provider",
      ready,
      cursor: syncCursor,
      checkpoint: exportPacket.exportId,
      stateKey: persistedState.recoveryPersistence.stateKey,
      restartKey: persistedState.restartKey,
      resumeCursor: persistedState.recoveryResumeCursor,
      exportStatus: exportPacket.exportStatus,
      healthStatus: operationalHealth.health,
      auditSubjects: exportPacket.auditSubjects,
      metadata: {
        timelineEvents: exportPacket.counters.timelineEvents,
        recoveryCommands: exportPacket.counters.recoveryCommands,
        recoveryPending: exportPacket.counters.recoveryPending,
        recoveryFailed: exportPacket.counters.recoveryFailed,
        actionQueueDepth: operationalHealth.actionQueue.length
      }
    },
    handoffState: {
      ready,
      command: ready ? "mailchimp.status.external_handoff" : exportPacket.nextAction,
      externalWritesAllowed: false,
      restartSafe: persistedState.restartSafe && exportPacket.handoffState.restartSafe,
      idempotencyKey: [
        "mailchimp.status.external",
        claimContract.tenantId,
        claimContract.workspaceId,
        claimContract.sourceId,
        syncCursor
      ].map(normalizeToken).join("."),
      handoffToken: ready
        ? [
          "mailchimp.status.handoff",
          claimContract.tenantId,
          claimContract.workspaceId,
          claimContract.sourceId,
          exportPacket.exportId
        ].map(normalizeToken).join(".")
        : null,
      retryAfterSeconds: operationalHealth.retry.retryAfterSeconds,
      blockedReasons
    },
    clientState: {
      visibleStatus: ready
        ? "Mailchimp status handoff ready"
        : blockedReasons[0] ?? "Mailchimp status handoff is waiting",
      badge: ready
        ? "external-handoff-ready"
        : operationalHealth.health === "degraded" ? "degraded" : "review-required",
      primaryAction: ready ? "mailchimp.status.external_handoff" : exportPacket.nextAction,
      disabledReason: ready ? null : blockedReasons[0] ?? "external handoff is not ready",
      canRetry: operationalHealth.retry.retryable,
      canExport: exportPacket.readyForExport,
      canHandoff: ready
    },
    auditHandoff: {
      ready: auditHandoff.ready,
      auditSubjects: auditHandoff.auditSubjects,
      recoveryStateKey: auditHandoff.recoveryStateKey,
      blockedReasons: auditHandoff.blockedReasons
    },
    blockedReasons,
    truthBoundary: {
      source: "mailchimp-status-external-handoff",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: STATUS_PROTOCOL
    }
  };
}

export function buildMailchimpStdlibStatus(source = {}) {
  const claimContract =
    source.claimContract?.protocol === "aios.mailchimp.claim-contract.v1"
      ? source.claimContract
      : compileMailchimpClaimContract(source, source.claimOptions ?? {});
  const claimValidation = validateMailchimpClaimContract(claimContract, source.runtime ?? {});
  const approvalContract =
    source.approvalContract?.protocol === "aios.mailchimp.approval-contract.v1"
      ? source.approvalContract
      : compileMailchimpApprovalContract({ ...source, claimContract });
  const approvalValidation = validateMailchimpApprovals(approvalContract);
  const recoveryPlan =
    source.recoveryPlan?.protocol === "aios.mailchimp.stdlib-recovery.v1"
      ? source.recoveryPlan
      : compileMailchimpRecoveryPlan({ ...source, claimContract, approvalContract });
  const recoveryGate = buildMailchimpRecoveryGate(recoveryPlan, { accepted: source.accepted });
  const recoveryRuntimeState = buildMailchimpRecoveryRuntimeState(recoveryPlan, {
    accepted: source.accepted,
    commandResults: source.commandResults,
    runtime: source.runtime
  });
  const recoveryHandoff = buildMailchimpRecoveryHandoff(recoveryPlan, {
    accepted: source.accepted,
    commandResults: source.commandResults,
    runtime: source.runtime,
    actor: source.actor,
    role: source.role,
    permissions: source.permissions
  });
  const recoveryAccessBoundary = buildMailchimpRecoveryAccessBoundary(recoveryPlan, source);
  const readiness = readinessFrom(claimValidation, approvalValidation, recoveryPlan);
  const gate = buildStatusGate({
    claimValidation,
    approvalValidation,
    recoveryGate,
    readiness
  }, { accepted: source.accepted });
  const accessBoundary = buildStatusAccessBoundary(source, claimContract, gate, recoveryRuntimeState);
  const persistedState = buildPersistedStatusState({
    claimContract,
    approvalValidation,
    recoveryPlan,
    recoveryRuntimeState,
    gate,
    readiness,
    accessBoundary
  });
  const effectiveReady = gate.ready && accessBoundary.allowed;
  const auditHandoff = buildStatusAuditHandoff({
    status: {
      ready: effectiveReady,
      state: accessBoundary.allowed ? readiness.state : "access_blocked"
    },
    claimContract,
    gate,
    persistedState,
    accessBoundary
  });
  const operationalHealth = buildStatusOperationalHealth({
    readiness,
    gate,
    accessBoundary,
    recoveryPlan,
    recoveryRuntimeState,
    recoveryAccessBoundary,
    persistedState
  });
  const exportPacket = buildStatusExportPacket({
    claimContract,
    readiness,
    gate,
    accessBoundary,
    recoveryAccessBoundary,
    recoveryRuntimeState,
    persistedState,
    auditHandoff,
    operationalHealth
  });
  const externalHandoff = buildStatusExternalHandoffState({
    claimContract,
    gate,
    accessBoundary,
    recoveryAccessBoundary,
    recoveryRuntimeState,
    recoveryHandoff,
    persistedState,
    auditHandoff,
    operationalHealth,
    exportPacket
  }, source);

  return {
    protocol: STATUS_PROTOCOL,
    adapter: "mailchimp",
    tenantId: claimContract.tenantId,
    workspaceId: claimContract.workspaceId,
    sourceId: claimContract.sourceId,
    state: accessBoundary.allowed ? readiness.state : "access_blocked",
    ready: effectiveReady,
    nextStep: accessBoundary.allowed ? gate.nextAction : "resolve-mailchimp-status-access",
    restartSafe: claimContract.restartSafe && approvalContract.restartSafe && gate.restartSafe && accessBoundary.allowed,
    gate,
    accessBoundary,
    recoveryAccessBoundary,
    operationalHealth,
    persistedState,
    auditHandoff,
    exportPacket,
    summaries: {
      claims: {
        status: claimValidation.status,
        passed: claimValidation.passed,
        counts: countByStatus(claimValidation.results),
        failed: claimValidation.failedClaims.length
      },
      approvals: {
        status: approvalValidation.status,
        passed: approvalValidation.passed,
        counts: countByStatus(approvalContract.approvals),
        blocking: approvalValidation.blockingApprovals.length
      },
      recovery: {
        status: recoveryPlan.status,
        commandCount: recoveryPlan.commands.length,
        nextAction: recoveryPlan.nextAction,
        gateStatus: recoveryGate.status,
        blockerCount: recoveryGate.blockerCount,
        runtimePhase: recoveryRuntimeState.phase,
        resumeCursor: recoveryRuntimeState.resumeCursor,
        persistenceStateKey: recoveryRuntimeState.persistenceSnapshot.stateKey,
        resumeMode: recoveryRuntimeState.persistenceSnapshot.resume.mode
      },
      access: {
        allowed: accessBoundary.allowed,
        recoveryAllowed: recoveryAccessBoundary.allowed,
        role: accessBoundary.actor.role,
        blockerCount: accessBoundary.blockers.length,
        recoveryBlockerCount: recoveryAccessBoundary.blockers.length,
        sameTenant: accessBoundary.isolation.sameTenant,
        sameWorkspace: accessBoundary.isolation.sameWorkspace
      },
      health: {
        health: operationalHealth.health,
        severity: operationalHealth.severity,
        nextAction: operationalHealth.nextAction,
        retryAfterSeconds: operationalHealth.retry.retryAfterSeconds,
        errorCount: operationalHealth.errors.length,
        degradedMode: operationalHealth.degradedMode.enabled,
        incidentId: operationalHealth.incident.incidentId,
        incidentStatus: operationalHealth.incident.status,
        actionCount: operationalHealth.actionQueue.length,
        exportId: operationalHealth.exportReadiness.exportId,
        exportStatus: operationalHealth.exportReadiness.exportStatus,
        readyForExport: operationalHealth.exportReadiness.readyForExport,
        statusExportId: exportPacket.exportId,
        statusExportStatus: exportPacket.exportStatus,
        statusReadyForExport: exportPacket.readyForExport,
        externalHandoffReady: externalHandoff.ready,
        externalHandoffStatus: externalHandoff.status,
        externalHandoffAction: externalHandoff.nextAction
      }
    },
    adapterHandoff: {
      permitted: effectiveReady,
      mode: effectiveReady ? "deferred-external-write" : "local-only",
      recovery: recoveryHandoff,
      persistedState,
      gate,
      accessBoundary,
      recoveryAccessBoundary,
      operationalHealth,
      auditHandoff,
      exportPacket,
      externalHandoff,
      truthBoundary: {
        source: "mailchimp-status-stdlib",
        externalWrites: false,
        requiresRuntimeAdapter: true,
        evaluatedAgainst: STATUS_PROTOCOL
      }
    },
    externalHandoff
  };
}

export function summarizeMailchimpStdlibStatus(status = {}) {
  const normalized = status.protocol === STATUS_PROTOCOL ? status : buildMailchimpStdlibStatus(status);
  return {
    protocol: "aios.mailchimp.stdlib-status-summary.v1",
    adapter: "mailchimp",
    state: normalized.state,
    ready: normalized.ready,
    restartSafe: normalized.restartSafe,
    nextStep: normalized.nextStep,
    claimFailures: normalized.summaries.claims.failed,
    blockingApprovals: normalized.summaries.approvals.blocking,
    recoveryCommands: normalized.summaries.recovery.commandCount,
    handoffPermitted: normalized.adapterHandoff.permitted,
    gateStatus: normalized.gate.status,
    gateBlockers: normalized.gate.blockerCount,
    blockerCategories: normalized.gate.categories,
    runtimePhase: normalized.persistedState.clientState.phase,
    restartKey: normalized.persistedState.restartKey,
    resumeCursor: normalized.persistedState.recoveryResumeCursor,
    recoveryStateKey: normalized.persistedState.recoveryPersistence.stateKey,
    accessAllowed: normalized.accessBoundary.allowed,
    accessBlockers: normalized.accessBoundary.blockers.length,
    recoveryAccessAllowed: normalized.recoveryAccessBoundary.allowed,
    recoveryAccessBlockers: normalized.recoveryAccessBoundary.blockers.length,
    operationalHealth: normalized.operationalHealth.health,
    operationalSeverity: normalized.operationalHealth.severity,
    operationalNextAction: normalized.operationalHealth.nextAction,
    operationalErrorCount: normalized.operationalHealth.errors.length,
    operationalActionCount: normalized.operationalHealth.actionQueue.length,
    operationalIncidentId: normalized.operationalHealth.incident.incidentId,
    operationalIncidentStatus: normalized.operationalHealth.incident.status,
    healthExportId: normalized.operationalHealth.exportReadiness.exportId,
    healthExportStatus: normalized.operationalHealth.exportReadiness.exportStatus,
    healthReadyForExport: normalized.operationalHealth.exportReadiness.readyForExport,
    statusExportId: normalized.exportPacket.exportId,
    statusExportStatus: normalized.exportPacket.exportStatus,
    statusReadyForExport: normalized.exportPacket.readyForExport,
    statusExportTimelineEvents: normalized.exportPacket.counters.timelineEvents,
    externalHandoffReady: normalized.externalHandoff.ready,
    externalHandoffStatus: normalized.externalHandoff.status,
    externalHandoffAction: normalized.externalHandoff.nextAction,
    externalHandoffToken: normalized.externalHandoff.handoffState.handoffToken,
    externalDeniedCapabilities: normalized.externalHandoff.negotiation.deniedCapabilities.length,
    retryAfterSeconds: normalized.operationalHealth.retry.retryAfterSeconds,
    auditSubjectCount: normalized.auditHandoff.auditSubjects.length
  };
}

export function buildMailchimpExternalHandoffState(status = {}, options = {}) {
  const normalized = status.protocol === STATUS_PROTOCOL
    ? status
    : buildMailchimpStdlibStatus({ ...status, ...options });
  return buildStatusExternalHandoffState({
    claimContract: {
      tenantId: normalized.tenantId,
      workspaceId: normalized.workspaceId,
      sourceId: normalized.sourceId,
      campaignId: normalized.persistedState.scope.campaignId
    },
    gate: normalized.gate,
    accessBoundary: normalized.accessBoundary,
    recoveryAccessBoundary: normalized.recoveryAccessBoundary,
    recoveryRuntimeState: {
      exportPacket: normalized.adapterHandoff.recovery.exportPacket,
      fingerprint: normalized.persistedState.recoveryFingerprint
    },
    recoveryHandoff: normalized.adapterHandoff.recovery,
    persistedState: normalized.persistedState,
    auditHandoff: normalized.auditHandoff,
    operationalHealth: normalized.operationalHealth,
    exportPacket: normalized.exportPacket
  }, options);
}

export function buildMailchimpStatusGate(source = {}, options = {}) {
  const status = buildMailchimpStdlibStatus({ ...source, accepted: options.accepted ?? source.accepted });
  return {
    ...status.gate,
    tenantId: status.tenantId,
    workspaceId: status.workspaceId,
    sourceId: status.sourceId,
    state: status.state,
    summaries: {
      claimFailures: status.summaries.claims.failed,
      blockingApprovals: status.summaries.approvals.blocking,
      recoveryCommands: status.summaries.recovery.commandCount,
      accessBlockers: status.summaries.access.blockerCount,
      recoveryAccessBlockers: status.summaries.access.recoveryBlockerCount,
      health: status.summaries.health.health,
      severity: status.summaries.health.severity,
      incidentStatus: status.summaries.health.incidentStatus,
      actionCount: status.summaries.health.actionCount,
      healthExportStatus: status.summaries.health.exportStatus
    },
    accessBoundary: status.accessBoundary,
    recoveryAccessBoundary: status.recoveryAccessBoundary,
    operationalHealth: status.operationalHealth,
    auditHandoff: status.auditHandoff,
    exportPacket: status.exportPacket,
    persistedState: status.persistedState,
    blockedReasons: uniqueSorted([
      ...status.gate.blockers.map((blocker) => blocker.message),
      ...status.accessBoundary.blockers.map((blocker) => blocker.message)
    ])
  };
}

export function buildMailchimpStatusHandoff(source = {}) {
  const status = buildMailchimpStdlibStatus(source);
  return {
    protocol: "aios.mailchimp.status-handoff.v1",
    adapter: "mailchimp",
    state: status.state,
    ready: status.ready,
    nextStep: status.nextStep,
    restartSafe: status.restartSafe,
    tenantId: status.tenantId,
    workspaceId: status.workspaceId,
    sourceId: status.sourceId,
    summaries: status.summaries,
    gate: status.gate,
    accessBoundary: status.accessBoundary,
    recoveryAccessBoundary: status.recoveryAccessBoundary,
    operationalHealth: status.operationalHealth,
    auditHandoff: status.auditHandoff,
    exportPacket: status.exportPacket,
    externalHandoff: status.externalHandoff,
    persistedState: status.persistedState,
    adapterHandoff: status.adapterHandoff
  };
}

export function mailchimpStatusSelfCheck(source = {}) {
  const status = buildMailchimpStdlibStatus(source);
  const summary = summarizeMailchimpStdlibStatus(status);
  return {
    protocol: "aios.mailchimp.status-self-check.v1",
    deterministic: true,
    importSideEffects: false,
    state: status.state,
    ready: summary.ready,
    nextStep: summary.nextStep,
    gateStatus: summary.gateStatus,
    restartKey: summary.restartKey,
    runtimePhase: summary.runtimePhase,
    accessAllowed: summary.accessAllowed,
    recoveryAccessAllowed: summary.recoveryAccessAllowed,
    operationalHealth: summary.operationalHealth,
    operationalSeverity: summary.operationalSeverity,
    operationalErrorCount: summary.operationalErrorCount,
    operationalIncidentStatus: summary.operationalIncidentStatus,
    healthReadyForExport: summary.healthReadyForExport,
    statusReadyForExport: summary.statusReadyForExport,
    statusExportStatus: summary.statusExportStatus,
    statusExportTimelineEvents: summary.statusExportTimelineEvents,
    externalHandoffReady: summary.externalHandoffReady,
    externalHandoffStatus: summary.externalHandoffStatus,
    externalDeniedCapabilities: summary.externalDeniedCapabilities,
    auditSubjectCount: summary.auditSubjectCount
  };
}

export const mailchimpStatusProtocols = Object.freeze({
  status: STATUS_PROTOCOL,
  summary: "aios.mailchimp.stdlib-status-summary.v1",
  handoff: "aios.mailchimp.status-handoff.v1",
  gate: "aios.mailchimp.status-gate.v1",
  persistedState: "aios.mailchimp.status-persisted-state.v1",
  accessBoundary: "aios.mailchimp.status-access-boundary.v1",
  operationalHealth: "aios.mailchimp.status-operational-health.v1",
  incidentReport: "aios.mailchimp.status-incident-report.v1",
  healthExport: "aios.mailchimp.status-health-export.v1",
  statusExport: "aios.mailchimp.status-export-packet.v1",
  auditHandoff: "aios.mailchimp.status-audit-handoff.v1",
  externalHandoff: "aios.mailchimp.status-external-handoff.v1"
});
