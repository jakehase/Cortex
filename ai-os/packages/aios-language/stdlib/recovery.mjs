import { compileMailchimpClaimContract, validateMailchimpClaimContract } from "./claims.mjs";
import { compileMailchimpApprovalContract, validateMailchimpApprovals } from "./approvals.mjs";

const RECOVERY_PROTOCOL = "aios.mailchimp.stdlib-recovery.v1";

const RECOVERY_ACTIONS = Object.freeze({
  "mailchimp.claim.missing_facts": "bind-required-mailchimp-facts",
  "mailchimp.claim.missing_evidence": "collect-verifier-evidence",
  "mailchimp.approval.pending": "request-operator-approval",
  "mailchimp.approval.denied": "hold-for-operator",
  "mailchimp.adapter.degraded": "retry-after-backoff",
  "mailchimp.adapter.unhealthy": "hold-for-adapter-health",
  "mailchimp.status.not_ready": "repair-contract-before-handoff"
});

const GATE_SEVERITY = Object.freeze({
  "mailchimp.approval.denied": "operator",
  "mailchimp.approval.pending": "operator",
  "mailchimp.adapter.degraded": "retry",
  "mailchimp.adapter.unhealthy": "adapter",
  "mailchimp.claim.missing_evidence": "evidence",
  "mailchimp.claim.missing_facts": "claim",
  "mailchimp.status.not_ready": "contract"
});

function compactString(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return compactString(value).toLowerCase().replaceAll("-", "_");
}

function stableList(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : String(value).split(",");
  return [...new Set(list.map(compactString).filter(Boolean))].sort();
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

function commandIdFor(source, code, index) {
  const tenantId = compactString(source.tenantId) || "tenant";
  const workspaceId = compactString(source.workspaceId) || "workspace";
  const requestId = compactString(source.sourceId || source.requestId || source.campaignId) || "request";
  return ["mailchimp.recovery", tenantId, workspaceId, requestId, code, index].map(normalizeToken).join(".");
}

function normalizeAdapterHealth(runtime = {}) {
  const status = normalizeToken(runtime.adapterHealth?.status || runtime.adapterStatus || "unknown");
  const retryAfterSeconds = Number(runtime.adapterHealth?.retryAfterSeconds ?? runtime.retryAfterSeconds);
  if (status === "ok" || status === "healthy") {
    return { status: "healthy", code: null, retryAfterSeconds: null };
  }
  if (status === "degraded" || status === "rate_limited") {
    return {
      status: "degraded",
      code: "mailchimp.adapter.degraded",
      retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? Math.max(0, Math.floor(retryAfterSeconds)) : 60
    };
  }
  return {
    status: "unknown",
    code: "mailchimp.adapter.unhealthy",
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? Math.max(0, Math.floor(retryAfterSeconds)) : 30
  };
}

function normalizeRecoveryActor(source = {}, claimContract = {}) {
  const actor = source.actor ?? source.runtime?.actor ?? {};
  const role = normalizeToken(source.role ?? actor.role ?? "operator");
  const normalizedRole = ["owner", "admin", "operator", "viewer", "auditor"].includes(role)
    ? role
    : "viewer";
  const permissions = stableList([
    ...(Array.isArray(source.permissions) ? source.permissions : []),
    ...(Array.isArray(actor.permissions) ? actor.permissions : []),
    ...(Array.isArray(source.runtime?.permissions) ? source.runtime.permissions : [])
  ]).map(normalizeToken);
  return {
    id: compactString(source.actorId ?? actor.id) || "operator",
    role: normalizedRole,
    tenantId: compactString(source.tenantId ?? actor.tenantId ?? claimContract.tenantId),
    workspaceId: compactString(source.workspaceId ?? actor.workspaceId ?? claimContract.workspaceId),
    permissions
  };
}

function normalizeRecoveryInputs(source = {}) {
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
  const adapterHealth = normalizeAdapterHealth(source.runtime ?? source);

  return { claimContract, claimValidation, approvalContract, approvalValidation, adapterHealth };
}

function buildRecoveryAccessBoundaryFrom(plan, source = {}, options = {}) {
  const actor = normalizeRecoveryActor({ ...source, ...options }, plan);
  const commandCount = Array.isArray(plan.commands) ? plan.commands.length : 0;
  const retryable = Boolean(plan.retryable);
  const requiredPermissions = [
    commandCount > 0 ? "mailchimp.recovery.review" : "mailchimp.recovery.status",
    ...(retryable ? ["mailchimp.recovery.resume"] : []),
    ...(plan.status === "operator_hold" ? ["mailchimp.recovery.operator"] : [])
  ];
  const roleAllowsRecovery = ["owner", "admin", "operator"].includes(actor.role);
  const sameTenant = actor.tenantId === compactString(plan.tenantId);
  const sameWorkspace = actor.workspaceId === compactString(plan.workspaceId);
  const permissionScoped = actor.permissions.length > 0;
  const missingPermissions = permissionScoped
    ? requiredPermissions.filter((permission) => (
        !actor.permissions.includes(permission)
        && !actor.permissions.includes("mailchimp.recovery.*")
        && !actor.permissions.includes("mailchimp.*")
      ))
    : [];
  const blockers = [
    ...(sameTenant ? [] : [{
      code: "mailchimp.recovery.tenant_mismatch",
      category: "isolation",
      action: "bind-recovery-tenant",
      message: "actor tenant does not match Mailchimp recovery tenant"
    }]),
    ...(sameWorkspace ? [] : [{
      code: "mailchimp.recovery.workspace_mismatch",
      category: "isolation",
      action: "bind-recovery-workspace",
      message: "actor workspace does not match Mailchimp recovery workspace"
    }]),
    ...(roleAllowsRecovery ? [] : [{
      code: "mailchimp.recovery.role_denied",
      category: "permission",
      action: "escalate-recovery-operator",
      message: "actor role cannot advance Mailchimp recovery handoff"
    }]),
    ...missingPermissions.map((permission) => ({
      code: "mailchimp.recovery.permission_missing",
      category: "permission",
      subject: permission,
      action: "grant-recovery-permission",
      message: `missing permission ${permission}`
    }))
  ];

  return {
    protocol: "aios.mailchimp.recovery-access-boundary.v1",
    adapter: "mailchimp",
    actor,
    requiredPermissions,
    permissionScoped,
    allowed: blockers.length === 0,
    blockers,
    isolation: {
      tenantId: plan.tenantId,
      workspaceId: plan.workspaceId,
      sameTenant,
      sameWorkspace,
      sourceId: plan.sourceId
    },
    audit: {
      subject: ["mailchimp.recovery.access", plan.tenantId, plan.workspaceId, plan.sourceId]
        .map(normalizeToken)
        .join("."),
      decision: blockers.length === 0 ? "allow" : "deny",
      blockerCodes: blockers.map((blocker) => blocker.code)
    },
    truthBoundary: {
      source: "mailchimp-recovery-access-boundary",
      externalWrites: false,
      requiresRuntimeAdapter: false,
      evaluatedAgainst: RECOVERY_PROTOCOL
    }
  };
}

function recoveryItemsFrom(source, inputs) {
  const base = [
    ...stableList(source.recoveryCodes).map((code) => ({ code, action: RECOVERY_ACTIONS[code] || "observe" })),
    ...(inputs.claimValidation.recovery ?? []),
    ...(inputs.approvalValidation.recovery ?? [])
  ];
  if (inputs.adapterHealth.code) {
    base.push({
      code: inputs.adapterHealth.code,
      action: RECOVERY_ACTIONS[inputs.adapterHealth.code],
      retryAfterSeconds: inputs.adapterHealth.retryAfterSeconds
    });
  }
  if (inputs.claimValidation.passed !== true || inputs.approvalValidation.passed !== true) {
    base.push({
      code: "mailchimp.status.not_ready",
      action: RECOVERY_ACTIONS["mailchimp.status.not_ready"]
    });
  }
  return base;
}

function gateBlockerFromCommand(command, index) {
  const subject = compactString(command.claimId || command.approvalKey || command.code);
  const category = GATE_SEVERITY[command.code] || "recovery";
  return {
    id: ["mailchimp.recovery.blocker", command.code, subject || index].map(normalizeToken).join("."),
    code: command.code,
    category,
    action: command.action,
    subject,
    retryAfterSeconds: command.retryAfterSeconds,
    operatorVisible: category === "operator" || category === "contract",
    restartSafe: command.restartSafe,
    message: recoveryMessageFor(command, category)
  };
}

function recoveryMessageFor(command, category) {
  if (category === "retry") {
    return `Retry ${command.action} after ${command.retryAfterSeconds ?? 0} second(s)`;
  }
  if (category === "adapter") {
    return "Adapter health must recover before Mailchimp handoff";
  }
  if (category === "operator") {
    return `Operator action required for ${command.approvalKey || command.code}`;
  }
  if (category === "claim") {
    return `Claim input required for ${command.claimId || command.code}`;
  }
  if (category === "evidence") {
    return `Verifier evidence required for ${command.claimId || command.code}`;
  }
  return `Resolve ${command.code} before Mailchimp handoff`;
}

function deriveGateStatus(plan, blockers, accepted) {
  if (blockers.length === 0) {
    return accepted ? "open" : "awaiting_acceptance";
  }
  if (blockers.some((blocker) => blocker.category === "adapter")) {
    return "adapter_blocked";
  }
  if (blockers.some((blocker) => blocker.category === "operator")) {
    return "operator_blocked";
  }
  if (plan.status === "recoverable") {
    return "recoverable";
  }
  return "contract_blocked";
}

function nextGateAction(gateStatus, plan, accepted) {
  if (gateStatus === "open") return "dispatch-mailchimp-adapter";
  if (gateStatus === "awaiting_acceptance" && !accepted) return "collect-operator-acceptance";
  if (gateStatus === "adapter_blocked") return "poll-mailchimp-adapter-health";
  if (gateStatus === "operator_blocked") return "resolve-operator-decision";
  return plan.nextAction || "repair-contract-before-handoff";
}

function runtimeCommandState(command, index, observed = {}) {
  const observedStatus = normalizeToken(
    observed[command.id]?.status
      || observed[command.code]?.status
      || observed[index]?.status
      || command.status
  );
  const status = ["completed", "running", "failed", "operator_hold", "pending"].includes(observedStatus)
    ? observedStatus
    : "pending";
  const attempts = Number(
    observed[command.id]?.attempts
      ?? observed[command.code]?.attempts
      ?? observed[index]?.attempts
      ?? 0
  );
  const retryAt = observed[command.id]?.retryAt
    ?? observed[command.code]?.retryAt
    ?? observed[index]?.retryAt
    ?? null;

  return {
    id: command.id,
    code: command.code,
    action: command.action,
    status,
    complete: status === "completed",
    failed: status === "failed",
    attempts: Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0,
    retryAt: compactString(retryAt) || null,
    retryAfterSeconds: command.retryAfterSeconds,
    idempotencyKey: command.id,
    restartSafe: command.restartSafe,
    clientVisible: command.status === "operator_hold" || command.retryAfterSeconds != null,
    cursor: ["mailchimp.recovery.cursor", index + 1, command.code].map(normalizeToken).join(".")
  };
}

function stableFingerprint(parts) {
  const input = parts.map((part) => JSON.stringify(part)).join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `mailchimp_recovery_${hash.toString(16).padStart(8, "0")}`;
}

function deriveRuntimePhase(plan, gate, commandStates) {
  if (gate.ready) return "handoff_ready";
  if (commandStates.some((command) => command.failed)) return "failed_recovery";
  if (gate.status === "awaiting_acceptance") return "awaiting_operator_acceptance";
  if (gate.status === "adapter_blocked") return "waiting_for_adapter";
  if (gate.status === "operator_blocked") return "waiting_for_operator";
  if (plan.status === "recoverable") return "recovering";
  return "blocked";
}

function buildRuntimeClientWorkflow(phase, gate, commandStates) {
  const visibleCommands = commandStates.filter((command) => (
    command.clientVisible || command.failed || command.status === "running"
  ));
  const retryableCommand = commandStates.find((command) => (
    command.retryAfterSeconds != null && command.status !== "completed"
  ));

  return {
    phase,
    visibleStatus: phase === "handoff_ready"
      ? "Ready for Mailchimp handoff"
      : phase === "waiting_for_adapter"
        ? "Waiting for Mailchimp adapter recovery"
        : phase === "awaiting_operator_acceptance"
          ? "Waiting for operator acceptance"
          : "Recovery action required",
    primaryAction: gate.nextAction,
    disabledReason: gate.ready
      ? null
      : gate.blockers[0]?.message || "Recovery gate is not ready",
    retryAfterSeconds: retryableCommand?.retryAfterSeconds ?? null,
    commands: visibleCommands.map((command) => ({
      id: command.id,
      action: command.action,
      status: command.status,
      retryAfterSeconds: command.retryAfterSeconds,
      cursor: command.cursor
    }))
  };
}

function buildRecoveryLifecycleControls(normalized, gate, commandStates, options = {}) {
  const settings = options.settings ?? options.runtime?.settings ?? {};
  const enabled = settings.enabled !== false && options.enabled !== false;
  const scheduleEnabled = settings.scheduleEnabled !== false;
  const maxAttempts = Number(settings.maxAttempts ?? options.maxAttempts ?? 3);
  const retryWindowSeconds = Number(settings.retryWindowSeconds ?? options.retryWindowSeconds ?? 300);
  const invalidSettings = [
    ...(Number.isFinite(maxAttempts) && maxAttempts >= 0 ? [] : [{
      code: "mailchimp.recovery.settings.max_attempts_invalid",
      field: "maxAttempts",
      message: "maxAttempts must be a non-negative number"
    }]),
    ...(Number.isFinite(retryWindowSeconds) && retryWindowSeconds >= 0 ? [] : [{
      code: "mailchimp.recovery.settings.retry_window_invalid",
      field: "retryWindowSeconds",
      message: "retryWindowSeconds must be a non-negative number"
    }])
  ];
  const pending = commandStates.filter((command) => !command.complete);
  const retryable = pending.filter((command) => command.retryAfterSeconds != null || command.retryAt != null);
  const blockedBySettings = invalidSettings.length > 0 || !enabled;
  const nextRunnable = pending.find((command) => (
    command.status === "pending"
    && command.retryAfterSeconds == null
    && command.retryAt == null
  ));
  const nextScheduled = retryable[0] ?? null;
  const command = blockedBySettings
    ? "recovery.settings.fix"
    : gate.ready
      ? "dispatch-mailchimp-adapter"
      : nextRunnable?.action
        ?? (scheduleEnabled ? nextScheduled?.action : null)
        ?? gate.nextAction;

  return {
    protocol: "aios.mailchimp.recovery-lifecycle-controls.v1",
    adapter: "mailchimp",
    enabled,
    scheduleEnabled,
    valid: invalidSettings.length === 0,
    status: blockedBySettings
      ? "settings_blocked"
      : gate.ready
        ? "handoff_ready"
        : scheduleEnabled && nextScheduled
          ? "scheduled_retry"
          : "manual_action",
    nextAction: command,
    settings: {
      maxAttempts: Number.isFinite(maxAttempts) ? Math.max(0, Math.floor(maxAttempts)) : null,
      retryWindowSeconds: Number.isFinite(retryWindowSeconds) ? Math.max(0, Math.floor(retryWindowSeconds)) : null,
      degradedModeAllowed: settings.degradedModeAllowed !== false,
    },
    enableDisable: {
      canEnable: !enabled && invalidSettings.length === 0,
      canDisable: enabled && !gate.ready,
      enableCommand: "recovery.enable",
      disableCommand: "recovery.disable",
      disabledReason: enabled
        ? null
        : "Mailchimp recovery lifecycle controls are disabled",
    },
    scheduling: {
      enabled: scheduleEnabled,
      nextCommandId: nextScheduled?.id ?? nextRunnable?.id ?? null,
      nextRetryAt: nextScheduled?.retryAt ?? null,
      retryAfterSeconds: nextScheduled?.retryAfterSeconds ?? null,
      pendingCount: pending.length,
      retryableCount: retryable.length,
      command: scheduleEnabled ? "recovery.schedule.next" : "recovery.schedule.enable",
    },
    settingsErrors: invalidSettings,
    nextState: {
      command,
      ready: gate.ready && !blockedBySettings,
      reason: invalidSettings[0]?.message
        ?? (!enabled ? "recovery lifecycle is disabled" : gate.blockers[0]?.message ?? "recovery lifecycle evaluated"),
      resumeCursor: pending[0]?.cursor ?? null,
    },
    truthBoundary: {
      source: "mailchimp-recovery-lifecycle-controls",
      externalWrites: false,
      requiresRuntimeAdapter: false,
      evaluatedAgainst: RECOVERY_PROTOCOL
    }
  };
}

function countCommandStates(commandStates) {
  return commandStates.reduce((counts, command) => {
    counts[command.status] = (counts[command.status] ?? 0) + 1;
    return counts;
  }, {});
}

function buildRecoveryPersistenceSnapshot(normalized, gate, commandStates, checkpoint) {
  const pending = commandStates.filter((command) => !command.complete);
  const failed = commandStates.filter((command) => command.failed);
  const firstRunnable = pending.find((command) => (
    command.status === "pending" && command.retryAfterSeconds == null && command.retryAt == null
  ));
  const retryable = pending.filter((command) => (
    command.retryAfterSeconds != null || command.retryAt != null
  ));
  const persistedCommands = commandStates.map((command, index) => ({
    sequence: index + 1,
    id: command.id,
    code: command.code,
    action: command.action,
    status: command.status,
    idempotencyKey: command.idempotencyKey,
    restartSafe: command.restartSafe,
    attempts: command.attempts,
    cursor: command.cursor,
    resumeEligible: !command.complete && command.restartSafe && !command.failed,
    retry: command.retryAfterSeconds == null && command.retryAt == null
      ? null
      : {
          retryAfterSeconds: command.retryAfterSeconds ?? null,
          retryAt: command.retryAt,
          attempts: command.attempts
        },
    auditSubject: ["mailchimp.recovery.command", command.code, index + 1].map(normalizeToken).join(".")
  }));

  return {
    protocol: "aios.mailchimp.recovery-persistence-snapshot.v1",
    adapter: "mailchimp",
    scope: {
      tenantId: normalized.tenantId,
      workspaceId: normalized.workspaceId,
      sourceId: normalized.sourceId
    },
    stateKey: [
      "mailchimp.recovery.state",
      normalized.tenantId,
      normalized.workspaceId,
      normalized.sourceId
    ].map(normalizeToken).join("."),
    checkpoint,
    gate: {
      status: gate.status,
      ready: gate.ready,
      accepted: gate.accepted,
      nextAction: gate.nextAction,
      blockerCount: gate.blockerCount
    },
    counters: {
      total: commandStates.length,
      pending: pending.length,
      failed: failed.length,
      completed: commandStates.filter((command) => command.complete).length,
      byStatus: countCommandStates(commandStates),
      retryable: retryable.length
    },
    resume: {
      cursor: pending[0]?.cursor ?? null,
      commandId: pending[0]?.id ?? null,
      runnableCommandId: firstRunnable?.id ?? null,
      mode: failed.length > 0
        ? "manual-review"
        : pending.length === 0
          ? "complete"
          : gate.status === "adapter_blocked"
            ? "adapter-wait"
            : "command-resume",
      restartSafe: gate.restartSafe && failed.every((command) => command.restartSafe)
    },
    commands: persistedCommands,
    retrySchedule: retryable.map((command) => ({
      commandId: command.id,
      code: command.code,
      retryAfterSeconds: command.retryAfterSeconds ?? null,
      retryAt: command.retryAt,
      attempts: command.attempts,
      cursor: command.cursor
    })),
    statusSemantics: {
      completedIsTerminal: true,
      failedRequiresReview: true,
      pendingIsReplayableWhenRestartSafe: true,
      idempotencyKeySource: "command.id"
    },
    truthBoundary: {
      source: "mailchimp-recovery-persistence-snapshot",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: RECOVERY_PROTOCOL
    }
  };
}

function buildRecoveryExportPacketFrom(normalized, runtimeState, options = {}) {
  const persistence = runtimeState.persistenceSnapshot;
  const commandStates = runtimeState.commandStates ?? [];
  const generatedAt = compactString(options.generatedAt) || "logical:recovery.export";
  const commandCounters = commandStates.reduce((counts, command) => {
    counts[command.status] = (counts[command.status] ?? 0) + 1;
    return counts;
  }, {});
  const timeline = [
    {
      sequence: 1,
      at: generatedAt,
      status: runtimeState.phase,
      source: "recovery-runtime",
      message: runtimeState.clientWorkflow.visibleStatus,
      action: runtimeState.clientWorkflow.primaryAction
    },
    ...commandStates.map((command, index) => ({
      sequence: index + 2,
      at: `logical:recovery.command:${index + 1}`,
      status: command.status,
      source: "recovery-command",
      commandId: command.id,
      code: command.code,
      message: command.complete
        ? `recovery command ${command.code} completed`
        : command.failed
          ? `recovery command ${command.code} failed`
          : `recovery command ${command.code} awaiting ${command.action}`,
      action: command.action,
      cursor: command.cursor,
      retryAfterSeconds: command.retryAfterSeconds ?? null
    })),
    {
      sequence: commandStates.length + 2,
      at: "logical:recovery.gate",
      status: runtimeState.gateStatus,
      source: "recovery-gate",
      message: runtimeState.clientWorkflow.disabledReason ?? "Mailchimp recovery gate can be handed off",
      action: runtimeState.clientWorkflow.primaryAction
    }
  ];
  const blockerCodes = runtimeState.persistenceSnapshot.gate.blockerCount === 0
    ? []
    : normalized.gate.blockers.map((blocker) => blocker.code);
  const exportId = stableFingerprint([
    "recovery-export",
    normalized.tenantId,
    normalized.workspaceId,
    normalized.sourceId,
    runtimeState.fingerprint,
    runtimeState.phase,
    commandCounters
  ]);
  const historySnapshots = timeline.map((event) => ({
    key: stableFingerprint([
      "recovery-history",
      normalized.tenantId,
      normalized.workspaceId,
      normalized.sourceId,
      event.sequence,
      event.status,
      event.source
    ]),
    sequence: event.sequence,
    at: event.at,
    status: event.status,
    source: event.source,
    commandId: event.commandId ?? null,
    cursor: event.cursor ?? null,
    exportId,
    restartSafe: runtimeState.restartSafe,
    ready: runtimeState.phase === "handoff_ready" || event.status === "completed"
  }));
  const summaries = {
    scope: {
      tenantId: normalized.tenantId,
      workspaceId: normalized.workspaceId,
      sourceId: normalized.sourceId
    },
    runtime: {
      phase: runtimeState.phase,
      fingerprint: runtimeState.fingerprint,
      resumeCursor: runtimeState.resumeCursor,
      restartSafe: runtimeState.restartSafe
    },
    gate: {
      status: runtimeState.gateStatus,
      ready: persistence.gate.ready,
      accepted: persistence.gate.accepted,
      nextAction: persistence.gate.nextAction,
      blockerCount: persistence.gate.blockerCount,
      blockerCodes
    }
  };

  return {
    protocol: "aios.mailchimp.recovery-export-packet.v1",
    adapter: "mailchimp",
    exportId,
    generatedAt,
    readyForExport: runtimeState.restartSafe && runtimeState.phase !== "failed_recovery",
    exportStatus: runtimeState.phase === "handoff_ready"
      ? "ready"
      : runtimeState.phase === "failed_recovery"
        ? "blocked"
        : "recovering",
    nextAction: runtimeState.clientWorkflow.primaryAction,
    summaries,
    counters: {
      commands: commandStates.length,
      pending: persistence.counters.pending,
      completed: persistence.counters.completed,
      failed: persistence.counters.failed,
      retryable: persistence.counters.retryable,
      timelineEvents: timeline.length,
      historySnapshots: historySnapshots.length,
      blockers: persistence.gate.blockerCount,
      byCommandStatus: commandCounters
    },
    timeline,
    historySnapshots,
    auditSubjects: [
      persistence.stateKey,
      ...persistence.commands.map((command) => command.auditSubject)
    ],
    handoffState: {
      stateKey: persistence.stateKey,
      resumeCursor: runtimeState.resumeCursor,
      resumeMode: persistence.resume.mode,
      runnableCommandId: persistence.resume.runnableCommandId,
      restartSafe: persistence.resume.restartSafe,
      idempotencyKeys: persistence.commands.map((command) => command.idempotencyKey)
    },
    truthBoundary: {
      source: "mailchimp-recovery-export-packet",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: RECOVERY_PROTOCOL
    }
  };
}

export function compileMailchimpRecoveryPlan(source = {}, options = {}) {
  const inputs = normalizeRecoveryInputs(source);
  const items = recoveryItemsFrom(source, inputs);
  const seen = new Set();
  const commands = items
    .filter((item) => compactString(item.code))
    .map((item, index) => {
      const code = compactString(item.code);
      const id = commandIdFor(
        {
          tenantId: inputs.claimContract.tenantId || source.tenantId,
          workspaceId: inputs.claimContract.workspaceId || source.workspaceId,
          sourceId: inputs.claimContract.sourceId || source.requestId,
          campaignId: inputs.claimContract.campaignId || source.campaignId
        },
        code,
        index
      );
      return {
        id,
        code,
        action: compactString(item.action) || RECOVERY_ACTIONS[code] || "observe",
        claimId: compactString(item.claimId),
        approvalKey: compactString(item.approvalKey),
        retryAfterSeconds: Number.isFinite(Number(item.retryAfterSeconds))
          ? Math.max(0, Math.floor(Number(item.retryAfterSeconds)))
          : null,
        idempotent: true,
        restartSafe: code !== "mailchimp.approval.denied",
        status: code === "mailchimp.approval.denied" ? "operator_hold" : "pending"
      };
    })
    .filter((command) => {
      const key = [command.code, command.claimId, command.approvalKey].join(":");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const operatorHold = commands.some((command) => command.status === "operator_hold");
  const retryable = commands.some((command) => command.retryAfterSeconds != null || command.restartSafe);
  const status =
    commands.length === 0
      ? "ready"
      : operatorHold
        ? "operator_hold"
        : retryable
          ? "recoverable"
          : "blocked";
  const gate = buildMailchimpRecoveryGate({
    protocol: RECOVERY_PROTOCOL,
    status,
    restartSafe: commands.every((command) => command.restartSafe),
    retryable,
    commands,
    adapterHealth: inputs.adapterHealth,
    nextAction: commands[0]?.action || options.defaultAction || "handoff-ready"
  }, options);

  return {
    protocol: RECOVERY_PROTOCOL,
    adapter: "mailchimp",
    tenantId: inputs.claimContract.tenantId,
    workspaceId: inputs.claimContract.workspaceId,
    sourceId: inputs.claimContract.sourceId,
    status,
    restartSafe: commands.every((command) => command.restartSafe),
    retryable,
    adapterHealth: inputs.adapterHealth,
    commands,
    nextAction: commands[0]?.action || options.defaultAction || "handoff-ready",
    gate,
    truthBoundary: {
      source: "mailchimp-recovery-stdlib",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: RECOVERY_PROTOCOL
    }
  };
}

export function buildMailchimpRecoveryGate(plan = {}, options = {}) {
  const normalized = plan.protocol === RECOVERY_PROTOCOL ? plan : compileMailchimpRecoveryPlan(plan, options);
  const accepted = Boolean(options.accepted ?? false);
  const blockers = uniqueBy(
    (normalized.commands ?? [])
      .filter((command) => command.status !== "completed")
      .map(gateBlockerFromCommand),
    (blocker) => [blocker.code, blocker.subject].join(":")
  );
  const gateStatus = deriveGateStatus(normalized, blockers, accepted);
  const ready = gateStatus === "open";

  return {
    protocol: "aios.mailchimp.recovery-gate.v1",
    adapter: "mailchimp",
    ready,
    accepted,
    status: gateStatus,
    recoveryStatus: normalized.status,
    nextAction: nextGateAction(gateStatus, normalized, accepted),
    restartSafe: normalized.restartSafe && blockers.every((blocker) => blocker.restartSafe),
    retryable: normalized.retryable || blockers.some((blocker) => blocker.retryAfterSeconds != null),
    blockerCount: blockers.length,
    blockers,
    truthBoundary: {
      source: "mailchimp-recovery-gate",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: RECOVERY_PROTOCOL
    }
  };
}

export function buildMailchimpRecoveryHandoff(plan = {}, options = {}) {
  const normalized = plan.protocol === RECOVERY_PROTOCOL ? plan : compileMailchimpRecoveryPlan(plan);
  const gate = buildMailchimpRecoveryGate(normalized, options);
  const runtimeState = buildMailchimpRecoveryRuntimeState(normalized, options);
  const accessBoundary = buildRecoveryAccessBoundaryFrom(normalized, plan, options);
  const permitted = gate.ready && accessBoundary.allowed;
  return {
    protocol: "aios.mailchimp.recovery-handoff.v1",
    adapter: "mailchimp",
    status: normalized.status,
    restartSafe: gate.restartSafe && accessBoundary.allowed,
    permitted,
    nextAction: accessBoundary.allowed ? gate.nextAction : "resolve-mailchimp-recovery-access",
    gate,
    accessBoundary,
    runtimeState,
    commands: normalized.commands.map((command) => ({
      id: command.id,
      code: command.code,
      action: command.action,
      idempotent: command.idempotent,
      retryAfterSeconds: command.retryAfterSeconds,
      status: command.status
    }))
  };
}

export function buildMailchimpRecoveryRuntimeState(plan = {}, options = {}) {
  const normalized = plan.protocol === RECOVERY_PROTOCOL ? plan : compileMailchimpRecoveryPlan(plan, options);
  const accepted = Boolean(options.accepted ?? false);
  const gate = buildMailchimpRecoveryGate(normalized, { accepted });
  const accessBoundary = buildRecoveryAccessBoundaryFrom(normalized, plan, options);
  const observed = options.commandResults ?? options.runtime?.commandResults ?? {};
  const commandStates = normalized.commands.map((command, index) => runtimeCommandState(command, index, observed));
  const pending = commandStates.filter((command) => !command.complete);
  const failed = commandStates.filter((command) => command.failed);
  const phase = deriveRuntimePhase(normalized, gate, commandStates);
  const lifecycleControls = buildRecoveryLifecycleControls(normalized, gate, commandStates, options);
  const checkpoint = {
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
    adapter: normalized.adapter,
    phase,
    gateStatus: gate.status,
    commandCount: commandStates.length,
    pendingCount: pending.length,
    failedCount: failed.length
  };
  const persistenceSnapshot = buildRecoveryPersistenceSnapshot(normalized, gate, commandStates, checkpoint);
  const runtimeState = {
    protocol: "aios.mailchimp.recovery-runtime-state.v1",
    adapter: "mailchimp",
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    sourceId: normalized.sourceId,
    phase,
    accepted,
    restartSafe: gate.restartSafe && failed.every((command) => command.restartSafe),
    resumeCursor: pending[0]?.cursor ?? null,
    fingerprint: stableFingerprint([
      checkpoint,
      commandStates.map((command) => [command.id, command.status, command.attempts, command.retryAt]),
      gate.blockers.map((blocker) => [blocker.code, blocker.subject])
    ]),
    checkpoint,
    accessBoundary,
    persistenceSnapshot,
    lifecycleControls,
    commandStates,
    clientWorkflow: {
      ...buildRuntimeClientWorkflow(phase, gate, commandStates),
      lifecycleStatus: lifecycleControls.status,
      lifecycleNextAction: lifecycleControls.nextAction,
      settingsErrors: lifecycleControls.settingsErrors,
    },
    truthBoundary: {
      source: "mailchimp-recovery-runtime-state",
      externalWrites: false,
      requiresRuntimeAdapter: true,
      evaluatedAgainst: RECOVERY_PROTOCOL
    }
  };

  return {
    ...runtimeState,
    exportPacket: buildRecoveryExportPacketFrom(normalized, runtimeState, options)
  };
}

export function buildMailchimpRecoveryAccessBoundary(plan = {}, options = {}) {
  const normalized = plan.protocol === RECOVERY_PROTOCOL ? plan : compileMailchimpRecoveryPlan(plan, options);
  return buildRecoveryAccessBoundaryFrom(normalized, plan, options);
}

export function buildMailchimpRecoveryPersistenceSnapshot(plan = {}, options = {}) {
  return buildMailchimpRecoveryRuntimeState(plan, options).persistenceSnapshot;
}

export function buildMailchimpRecoveryExportPacket(plan = {}, options = {}) {
  return buildMailchimpRecoveryRuntimeState(plan, options).exportPacket;
}

export function mailchimpRecoverySelfCheck(source = {}) {
  const plan = compileMailchimpRecoveryPlan(source);
  const handoff = buildMailchimpRecoveryHandoff(plan);
  const gate = buildMailchimpRecoveryGate(plan, { accepted: true });
  const runtimeState = buildMailchimpRecoveryRuntimeState(plan, { accepted: true });
  return {
    protocol: "aios.mailchimp.recovery-self-check.v1",
    deterministic: true,
    importSideEffects: false,
    status: plan.status,
    commandCount: handoff.commands.length,
    gateReadyWhenAccepted: gate.ready,
    restartSafe: plan.restartSafe,
    runtimePhase: runtimeState.phase,
    runtimeFingerprint: runtimeState.fingerprint,
    persistenceStateKey: runtimeState.persistenceSnapshot.stateKey,
    persistenceResumeMode: runtimeState.persistenceSnapshot.resume.mode,
    lifecycleStatus: runtimeState.lifecycleControls.status,
    lifecycleNextAction: runtimeState.lifecycleControls.nextAction,
    lifecycleSettingsValid: runtimeState.lifecycleControls.valid,
    accessBoundaryAllowed: runtimeState.accessBoundary.allowed,
    exportId: runtimeState.exportPacket.exportId,
    exportStatus: runtimeState.exportPacket.exportStatus,
    exportTimelineEvents: runtimeState.exportPacket.counters.timelineEvents
  };
}

export const mailchimpRecoveryProtocols = Object.freeze({
  plan: RECOVERY_PROTOCOL,
  handoff: "aios.mailchimp.recovery-handoff.v1",
  gate: "aios.mailchimp.recovery-gate.v1",
  runtimeState: "aios.mailchimp.recovery-runtime-state.v1",
  persistenceSnapshot: "aios.mailchimp.recovery-persistence-snapshot.v1",
  exportPacket: "aios.mailchimp.recovery-export-packet.v1",
  accessBoundary: "aios.mailchimp.recovery-access-boundary.v1",
  lifecycleControls: "aios.mailchimp.recovery-lifecycle-controls.v1"
});
