import { compileClaimGate } from "./claim-gate-compiler.mjs";
import { compilePackageManifest } from "./package-manifest-compiler.mjs";

function stableId(prefix, parts) {
  const input = parts.filter((part) => part !== undefined && part !== null).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function uniqueByName(items) {
  const seen = new Map();
  for (const item of items) {
    if (!seen.has(item.name)) {
      seen.set(item.name, item);
    }
  }
  return [...seen.values()];
}

function normalizeCapability(capability) {
  if (typeof capability === "string") {
    return { name: capability, scope: "local" };
  }
  return {
    name: capability.name,
    scope: capability.scope ?? "local",
    reason: capability.reason,
  };
}

function normalizeTenantContext(value, claimDescriptor) {
  const source = typeof value === "string" ? { tenantId: value } : { ...value };
  const clientRuntime = claimDescriptor.clientRuntime ?? {};
  const tenantPolicy = claimDescriptor.tenantPolicy ?? {};
  const activeBoundary = tenantPolicy.activeBoundary ?? {};
  const tenantId = source.tenantId ?? source.tenant ?? clientRuntime.tenantId ?? "mailchimp-tenant";
  const workspaceId = source.workspaceId ?? source.workspace ?? clientRuntime.workspaceId ?? activeBoundary.workspaceId ?? tenantId;
  const actorRole = source.actorRole ?? source.role ?? clientRuntime.actorRole ?? "operator";
  const workspacePolicy = (tenantPolicy.workspaces ?? []).find((workspace) => workspace.workspaceId === workspaceId)
    ?? (tenantPolicy.workspaces ?? []).find((workspace) => workspace.workspaceId === tenantPolicy.defaultWorkspaceId)
    ?? null;
  const rolePolicy = (tenantPolicy.rolePolicies ?? []).find((policy) => policy.role === actorRole) ?? null;
  const allowedRoles = Array.isArray(source.allowedRoles) && source.allowedRoles.length > 0
    ? source.allowedRoles
    : workspacePolicy?.allowedRoles ?? tenantPolicy.allowedRoles ?? ["operator", "approver", "admin"];
  return {
    tenantId,
    workspaceId,
    actorRole,
    isolationKey: activeBoundary.workspaceIsolationKey ?? workspacePolicy?.isolationKey ?? stableId("tenant", [tenantId, workspaceId]),
    allowedRoles,
    policyBoundaryId: tenantPolicy.boundaryId,
    workspaceIsolation: tenantPolicy.workspaceIsolation ?? "strict",
    auditRequired: tenantPolicy.auditRequired !== false,
    workspacePolicy: workspacePolicy ? {
      workspaceId: workspacePolicy.workspaceId,
      requiresApprovalForExternalWrite: workspacePolicy.requiresApprovalForExternalWrite !== false,
      allowedCapabilities: workspacePolicy.allowedCapabilities ?? [],
    } : {
      workspaceId,
      requiresApprovalForExternalWrite: true,
      allowedCapabilities: [],
    },
    rolePolicy: rolePolicy ? {
      role: rolePolicy.role,
      canApprove: rolePolicy.canApprove === true,
      canExecute: rolePolicy.canExecute !== false,
      maxExternalWrites: Number.isInteger(rolePolicy.maxExternalWrites) ? rolePolicy.maxExternalWrites : 0,
    } : {
      role: actorRole,
      canApprove: ["approver", "admin"].includes(actorRole),
      canExecute: true,
      maxExternalWrites: ["approver", "admin"].includes(actorRole) ? 25 : 0,
    },
  };
}

function resolvePermissionEnvelope(operation, requiredCapabilities, tenantContext) {
  const externalScopes = requiredCapabilities.filter((capability) => capability.scope === "external");
  const writeLikeCapabilities = requiredCapabilities.filter((capability) => (
    capability.name.endsWith(".write") || capability.name.endsWith(".send") || capability.name.includes("segment.write")
  ));
  const workspaceAllowedCapabilities = new Set(tenantContext.workspacePolicy.allowedCapabilities ?? []);
  const restrictedCapabilities = workspaceAllowedCapabilities.size === 0
    ? []
    : requiredCapabilities.filter((capability) => !workspaceAllowedCapabilities.has(capability.name));
  const externalWriteCount = writeLikeCapabilities.length;
  const roleCanExecute = tenantContext.rolePolicy.canExecute !== false;
  const roleCanApprove = tenantContext.rolePolicy.canApprove === true;
  const roleWithinWorkspace = tenantContext.allowedRoles.includes(tenantContext.actorRole);
  const exceedsExternalWriteBudget = externalWriteCount > tenantContext.rolePolicy.maxExternalWrites;
  const requiresApproval = (
    externalScopes.length > 0
    || writeLikeCapabilities.length > 0
    || tenantContext.workspacePolicy.requiresApprovalForExternalWrite
  ) && externalWriteCount > 0;
  const deniedReasons = [
    !roleWithinWorkspace ? "actor-role-outside-workspace-policy" : null,
    !roleCanExecute ? "actor-role-execute-disabled" : null,
    restrictedCapabilities.length > 0 ? "capability-outside-workspace-policy" : null,
    exceedsExternalWriteBudget ? "external-write-budget-exceeded" : null,
  ].filter(Boolean);
  const decision = deniedReasons.length > 0
    ? "deny"
    : requiresApproval && !roleCanApprove
      ? "needs-approval"
      : "allow";
  return {
    tenantId: tenantContext.tenantId,
    workspaceId: tenantContext.workspaceId,
    actorRole: tenantContext.actorRole,
    allowedRoles: tenantContext.allowedRoles,
    decision,
    requiresApproval,
    capabilityNames: requiredCapabilities.map((capability) => capability.name),
    deniedReason: deniedReasons[0] ?? null,
    deniedReasons,
    approval: {
      actorCanApprove: roleCanApprove,
      requiredForExternalWrite: requiresApproval,
      approverRoles: tenantContext.allowedRoles.filter((role) => ["approver", "admin"].includes(role)),
    },
    workspacePolicy: {
      boundaryId: tenantContext.policyBoundaryId,
      isolationMode: tenantContext.workspaceIsolation,
      auditRequired: tenantContext.auditRequired,
      allowedCapabilities: tenantContext.workspacePolicy.allowedCapabilities,
      restrictedCapabilities: restrictedCapabilities.map((capability) => capability.name),
      maxExternalWrites: tenantContext.rolePolicy.maxExternalWrites,
      requestedExternalWrites: externalWriteCount,
    },
    boundary: {
      localOnly: externalScopes.length === 0,
      externalScopes: externalScopes.map((capability) => capability.name),
      workspaceIsolationKey: tenantContext.isolationKey,
      safeBehavior: decision === "deny"
        ? "hold-and-audit"
        : decision === "needs-approval"
          ? "pause-before-adapter-handoff"
          : "handoff-with-audit",
    },
  };
}

function buildAuditHandoff(jobId, operation, claimDescriptor, tenantContext, permissionEnvelope) {
  const clientRuntime = claimDescriptor.clientRuntime ?? {};
  return {
    id: stableId("audit", [
      jobId,
      tenantContext.tenantId,
      clientRuntime.workflowId,
      clientRuntime.requestId,
      permissionEnvelope.decision,
    ]),
    product: "mailchimp",
    tenantId: tenantContext.tenantId,
    workspaceId: tenantContext.workspaceId,
    requestId: clientRuntime.requestId,
    workflowId: clientRuntime.workflowId,
    operation: operation.operation,
    permissionDecision: permissionEnvelope.decision,
    permissionDeniedReasons: permissionEnvelope.deniedReasons,
    workspacePolicyBoundaryId: permissionEnvelope.workspacePolicy.boundaryId,
    workspaceIsolationKey: permissionEnvelope.boundary.workspaceIsolationKey,
    persistedStateKey: operation.stateContract?.checkpointKey,
    truthBoundaryMode: operation.truthBoundary.mode,
    auditRequired: permissionEnvelope.workspacePolicy.auditRequired,
  };
}

function buildJobStatusProjection(operation, claimDescriptor, permissionEnvelope) {
  const commandState = operation.stateContract?.commandState;
  const adapterStatus = operation.stateContract?.adapterStatus ?? operation.adapterStatus;
  const statusLedger = operation.stateContract?.statusLedger;
  const claimState = claimDescriptor.requestState ?? {};
  const approvalStatus = permissionEnvelope.decision === "needs-approval" ? "needs-approval" : null;
  const blockedStatus = permissionEnvelope.decision === "deny" || claimState.status === "needs-evidence"
    ? "blocked"
    : null;
  const firstRunnableStatus = approvalStatus ?? blockedStatus ?? "checkpointed";
  const transitions = [
    {
      from: "planned",
      to: claimState.status === "needs-evidence" ? "blocked" : "checkpointed",
      reason: claimState.status === "needs-evidence" ? "claim-gate-needs-evidence" : "claim-state-ready",
    },
    {
      from: "checkpointed",
      to: approvalStatus ?? "admitted",
      reason: approvalStatus ? "tenant-approval-required" : "adapter-handoff-ready",
    },
    {
      from: "admitted",
      to: "verified",
      reason: "adapter-status-confirmed",
    },
    {
      from: "verified",
      to: "completed",
      reason: "adapter-result-recorded",
    },
    {
      from: "verified",
      to: "rolled-back",
      reason: "rollback-command-recorded",
    },
  ];
  return {
    current: firstRunnableStatus,
    restartSafe: Boolean(commandState?.restartSafe && claimState.restartSafe !== false),
    claimStateVersion: claimState.version,
    claimResumeCursor: claimState.resumeCursor,
    ledgerKey: commandState?.ledgerKey,
    operationStatusLedgerId: statusLedger?.id ?? null,
    clientVisibleStatus: statusLedger?.clientStatusIndex?.[firstRunnableStatus]?.visibleStatus
      ?? statusLedger?.clientStatusIndex?.checkpointed?.visibleStatus
      ?? firstRunnableStatus,
    restartAction: statusLedger?.clientStatusIndex?.[firstRunnableStatus]?.recoveryAction
      ?? (firstRunnableStatus === "blocked" ? "resume-claim-gate" : "replay-idempotent-commands"),
    commandIds: commandState?.commands?.map((command) => command.id) ?? [],
    adapterStatusContractId: adapterStatus?.id ?? null,
    adapterTerminalStatuses: adapterStatus?.expected?.terminal ?? [],
    transitions,
    terminalStates: ["completed", "rolled-back", "blocked"],
    duplicateCommandPolicy: commandState?.replay?.duplicateAdapterCommand ?? "return-existing",
  };
}

function buildPlanRestartProjection(jobs, claimDescriptor, packageDescriptor) {
  const commandLedgers = jobs.map((job) => ({
    jobId: job.id,
    ledgerKey: job.statusProjection.ledgerKey,
    checkpointKey: job.stateContract?.checkpointKey,
    replayManifestId: job.stateContract?.replayManifest?.id ?? null,
    operationStatusLedgerId: job.statusProjection.operationStatusLedgerId,
    clientVisibleStatus: job.statusProjection.clientVisibleStatus,
    restartAction: job.statusProjection.restartAction,
    commandIds: job.statusProjection.commandIds,
    restartSafe: job.statusProjection.restartSafe,
  }));
  const replayManifests = jobs.map((job) => buildJobRestartReplayManifest(job, claimDescriptor));
  const blockedJobs = jobs.filter((job) => job.statusProjection.current === "blocked");
  const approvalJobs = jobs.filter((job) => job.statusProjection.current === "needs-approval");
  return {
    stateVersion: stableId("restart", [
      claimDescriptor.requestState?.version,
      packageDescriptor.persistence?.commandLog?.id,
      commandLedgers.map((ledger) => `${ledger.jobId}:${ledger.ledgerKey}`).join(","),
    ]),
    claimStateKey: claimDescriptor.requestState?.key,
    claimResumeCursor: claimDescriptor.requestState?.resumeCursor,
    packageCommandLogId: packageDescriptor.persistence?.commandLog?.id,
    commandLedgers,
    statusLedgerIds: commandLedgers
      .map((ledger) => ledger.operationStatusLedgerId)
      .filter(Boolean),
    replayManifestIds: replayManifests.map((manifest) => manifest.id),
    replayManifests,
    restartSafe: commandLedgers.every((ledger) => ledger.restartSafe),
    restartStatus: blockedJobs.length > 0
      ? "blocked"
      : approvalJobs.length > 0
        ? "needs-approval"
        : "checkpointed",
    recoveryAction: blockedJobs.length > 0
      ? "resume-claim-gate"
      : approvalJobs.length > 0
        ? "resume-approval"
        : "replay-idempotent-commands",
    replayCursor: stableId("replay", [
      claimDescriptor.requestState?.resumeCursor,
      commandLedgers.map((ledger) => ledger.ledgerKey).join(","),
      replayManifests.map((manifest) => manifest.replayCursor).join(","),
    ]),
  };
}

function buildJobRestartReplayManifest(job, claimDescriptor) {
  const replayManifest = job.stateContract?.replayManifest ?? {};
  const statusRows = replayManifest.statusRows ?? [];
  const commandRows = replayManifest.commandRows ?? [];
  const currentStatus = job.statusProjection?.current ?? "planned";
  const permissionDecision = job.permissions?.decision ?? "unknown";
  const claimBlocked = claimDescriptor.requestState?.status === "needs-evidence";
  const currentStatusRow = statusRows.find((row) => row.status === currentStatus) ?? null;
  const nextCommand = commandRows.find((command) => command.commandId === currentStatusRow?.nextCommandId)
    ?? commandRows.find((command) => command.statusBefore === currentStatus)
    ?? null;
  const held = claimBlocked || permissionDecision === "deny" || permissionDecision === "needs-approval";
  const terminal = (replayManifest.terminalStatuses ?? []).includes(currentStatus);
  const replayDecision = claimBlocked
    ? "hold-for-claim-evidence"
    : permissionDecision === "deny"
      ? "hold-for-tenant-permission"
      : permissionDecision === "needs-approval"
        ? "hold-for-approval"
        : terminal
          ? "return-existing-terminal-state"
          : nextCommand
            ? nextCommand.replayAction
            : "reload-status-ledger";
  const replayCursor = stableId("jobreplay", [
    job.id,
    replayManifest.id,
    currentStatus,
    nextCommand?.commandId,
    claimDescriptor.requestState?.resumeCursor,
  ]);
  return {
    id: stableId("restartreplay", [
      job.id,
      replayManifest.id,
      currentStatus,
      replayDecision,
    ]),
    product: "mailchimp",
    jobId: job.id,
    operation: job.operation,
    adapter: job.adapter,
    checkpointKey: job.stateContract?.checkpointKey ?? null,
    ledgerKey: replayManifest.ledgerKey ?? job.statusProjection?.ledgerKey ?? null,
    replayManifestId: replayManifest.id ?? null,
    replayCursor,
    currentStatus,
    currentVisibleStatus: currentStatusRow?.visibleStatus ?? job.statusProjection?.clientVisibleStatus,
    replayDecision,
    held,
    terminal,
    restartSafe: Boolean(replayManifest.restartSafe && job.statusProjection?.restartSafe),
    nextCommand: nextCommand ? {
      commandId: nextCommand.commandId,
      commandType: nextCommand.commandType,
      idempotencyKey: nextCommand.idempotencyKey,
      conflict: nextCommand.conflict,
      replayAction: nextCommand.replayAction,
      writes: nextCommand.writes,
    } : null,
    statusLedger: {
      statusLedgerId: job.statusProjection?.operationStatusLedgerId ?? null,
      resumableStatuses: replayManifest.resumableStatuses ?? [],
      terminalStatuses: replayManifest.terminalStatuses ?? [],
      duplicateHandling: replayManifest.duplicateHandling ?? null,
    },
    resumeInputs: {
      claimStateKey: claimDescriptor.requestState?.key ?? null,
      claimResumeCursor: claimDescriptor.requestState?.resumeCursor ?? null,
      adapterStatusResumeCursor: job.adapterStatusHandoff?.recovery?.resumeCursor ?? null,
      continuationToken: claimDescriptor.clientRuntime?.continuationToken ?? null,
    },
  };
}

function buildClientOperationState(job, operation, claimDescriptor, permissionEnvelope) {
  const statusLedger = operation.stateContract?.statusLedger;
  const claimResume = claimDescriptor.clientResumeContract ?? {};
  const handoff = job.adapterStatusHandoff;
  const currentStatus = job.statusProjection.current;
  const ledgerState = statusLedger?.clientStatusIndex?.[currentStatus]
    ?? statusLedger?.clientStatusIndex?.checkpointed
    ?? {};
  const blockedByClaim = claimDescriptor.requestState?.status === "needs-evidence";
  const blockedByPermission = permissionEnvelope.decision === "deny";
  const waitingForApproval = permissionEnvelope.decision === "needs-approval";
  const workflowState = blockedByClaim || blockedByPermission
    ? "blocked"
    : waitingForApproval
      ? "waiting-for-approval"
      : "resumable";
  return {
    id: stableId("clientop", [
      job.id,
      statusLedger?.id,
      claimResume.id,
      workflowState,
    ]),
    product: "mailchimp",
    jobId: job.id,
    operation: operation.operation,
    adapter: operation.adapter,
    workflowState,
    visibleStatus: blockedByClaim
      ? "needs-mailchimp-evidence"
      : blockedByPermission
        ? "permission-blocked"
        : waitingForApproval
          ? "waiting-for-approval"
          : ledgerState.visibleStatus ?? job.statusProjection.clientVisibleStatus,
    nextAction: blockedByClaim
      ? claimResume.primaryAction ?? "collect-evidence"
      : blockedByPermission
        ? "repair-tenant-permission"
        : waitingForApproval
          ? "collect-approval"
          : ledgerState.recoveryAction ?? "resume-operation",
    stateKeys: {
      claimStateKey: claimDescriptor.requestState?.key ?? null,
      operationCheckpointKey: operation.stateContract?.checkpointKey ?? null,
      commandLedgerKey: operation.stateContract?.commandState?.ledgerKey ?? null,
      operationStatusLedgerId: statusLedger?.id ?? null,
    },
    resume: {
      claimResumeCursor: claimDescriptor.requestState?.resumeCursor ?? null,
      adapterStatusResumeCursor: handoff.recovery.resumeCursor,
      replayCursor: job.recovery.replayCursor,
      continuationToken: claimDescriptor.clientRuntime?.continuationToken ?? null,
    },
    persistedStatus: {
      current: currentStatus,
      terminalStates: job.statusProjection.terminalStates,
      resumableStatuses: statusLedger?.resumableStatuses ?? [],
      terminalStatuses: statusLedger?.terminalStatuses ?? [],
    },
  };
}

function buildAdapterStatusHandoff(jobId, operation, claimDescriptor, tenantContext, permissionEnvelope) {
  const adapterStatus = operation.stateContract?.adapterStatus ?? operation.adapterStatus;
  const commandState = operation.stateContract?.commandState;
  const statusCommand = commandState?.commands?.find((command) => command.type === "adapter-status-probe");
  const adapterCommand = commandState?.commands?.find((command) => command.type === "adapter-handoff");
  const clientRuntime = claimDescriptor.clientRuntime ?? {};
  const blocked = permissionEnvelope.decision === "deny" || claimDescriptor.requestState?.status === "needs-evidence";
  const pausedForApproval = permissionEnvelope.decision === "needs-approval";
  const handoffState = blocked
    ? "blocked"
    : pausedForApproval
      ? "waiting-for-approval"
      : "ready-to-probe";
  return {
    id: stableId("adapterhandoff", [
      jobId,
      adapterStatus?.id,
      clientRuntime.workflowId,
      clientRuntime.requestId,
      handoffState,
    ]),
    state: handoffState,
    adapter: operation.adapter,
    operation: operation.operation,
    probe: adapterStatus?.probe ?? `${operation.operation}.status`,
    correlation: {
      field: adapterStatus?.correlationField ?? "id",
      key: adapterStatus?.correlationKey ?? stableId("corr", [jobId, operation.operation]),
      sourceCommandId: adapterCommand?.id ?? null,
      persistedField: "adapterCorrelationId",
    },
    commands: {
      adapterCommandId: adapterCommand?.id ?? null,
      statusCommandId: statusCommand?.id ?? null,
      rollbackCommandId: adapterStatus?.recovery?.rollbackCommand ?? null,
      resumeCommandId: adapterStatus?.recovery?.resumeCommand ?? null,
    },
    expectedStatuses: adapterStatus?.expected ?? {
      success: ["succeeded", "completed"],
      pending: ["queued", "running"],
      failure: ["failed", "rejected"],
      terminal: ["succeeded", "completed", "failed", "rejected"],
      fixtures: [],
      defaultFixtureId: null,
    },
    polling: adapterStatus?.polling ?? {
      intervalMs: 1000,
      maxPolls: 30,
      timeoutMs: 30000,
      timeoutStatus: "manual-review",
    },
    recovery: {
      signal: adapterStatus?.recovery?.signal ?? stableId("signal", [jobId, "adapter-status"]),
      onFailure: adapterStatus?.recovery?.onFailure ?? "rollback",
      onTimeout: adapterStatus?.recovery?.onTimeout ?? "manual-review",
      resumeCursor: stableId("adaptercursor", [
        jobId,
        adapterStatus?.correlationKey,
        clientRuntime.continuationToken,
      ]),
    },
    dryRunFixtures: {
      defaultFixtureId: adapterStatus?.expected?.defaultFixtureId ?? null,
      fixtures: adapterStatus?.expected?.fixtures ?? [],
      deterministic: (adapterStatus?.expected?.fixtures ?? []).every((fixture) => fixture.deterministic !== false),
      fixtureCount: adapterStatus?.expected?.fixtures?.length ?? 0,
    },
    visibleStatus: blocked
      ? "blocked-before-adapter-status"
      : pausedForApproval
        ? "waiting-for-approval-before-adapter-status"
        : "waiting-for-adapter-status",
  };
}

function buildProviderOperationalHealth(input) {
  const {
    packageDescriptor,
    claimDescriptor,
    tenantContext,
    jobs,
    externalHandoffState,
    externalBlockedReason,
    lifecycleHandoffState,
    permissionHandoffState,
    providerCapabilities,
    missingWorkspaceCapabilities,
    releaseGate,
    syncContract,
  } = input;
  const deniedJobs = jobs.filter((job) => job.permissions.decision === "deny");
  const approvalJobs = jobs.filter((job) => job.permissions.decision === "needs-approval");
  const blockedStatusJobs = jobs.filter((job) => job.adapterStatusHandoff.state === "blocked");
  const missingStatusCommandJobs = jobs.filter((job) => !job.adapterStatusHandoff.commands.statusCommandId);
  const missingTerminalStatusJobs = jobs.filter((job) => (
    (job.adapterStatusHandoff.expectedStatuses?.terminal ?? []).length === 0
  ));
  const syncFacts = syncContract.requiredFacts ?? [];
  const verifiedFacts = new Set(claimDescriptor.truthBoundary?.verifiedFacts ?? []);
  const missingSyncFacts = syncFacts.filter((fact) => !verifiedFacts.has(fact));
  const checks = [
    {
      name: "provider-capabilities",
      status: missingWorkspaceCapabilities.length > 0 ? "blocked" : providerCapabilities.length > 0 ? "ready" : "review",
      detail: missingWorkspaceCapabilities.length > 0
        ? `Workspace policy is missing Mailchimp capabilities: ${missingWorkspaceCapabilities.join(", ")}.`
        : providerCapabilities.length > 0
          ? "Provider capability negotiation has concrete Mailchimp requirements."
          : "Provider capability negotiation has no concrete Mailchimp requirements.",
      nextAction: missingWorkspaceCapabilities.length > 0
        ? "repair-workspace-capability-policy"
        : providerCapabilities.length > 0
          ? "persist-provider-capability-grant"
          : "declare-provider-capabilities",
      capabilityNames: providerCapabilities,
      missingCapabilities: missingWorkspaceCapabilities,
    },
    {
      name: "tenant-permission",
      status: deniedJobs.length > 0 ? "blocked" : approvalJobs.length > 0 ? "degraded" : "ready",
      detail: deniedJobs.length > 0
        ? `${deniedJobs.length} Mailchimp job(s) are denied by tenant policy.`
        : approvalJobs.length > 0
          ? `${approvalJobs.length} Mailchimp job(s) wait for approval.`
          : "Tenant permission policy allows Mailchimp provider handoff.",
      nextAction: deniedJobs.length > 0
        ? "repair-tenant-permission"
        : approvalJobs.length > 0
          ? "collect-approval"
          : "continue-provider-handoff",
      jobIds: [...deniedJobs, ...approvalJobs].map((job) => job.id),
    },
    {
      name: "adapter-status",
      status: missingStatusCommandJobs.length > 0 || missingTerminalStatusJobs.length > 0 || blockedStatusJobs.length > 0
        ? "blocked"
        : "ready",
      detail: missingStatusCommandJobs.length > 0
        ? `${missingStatusCommandJobs.length} Mailchimp job(s) lack adapter status commands.`
        : missingTerminalStatusJobs.length > 0
          ? `${missingTerminalStatusJobs.length} Mailchimp job(s) lack terminal adapter statuses.`
          : blockedStatusJobs.length > 0
            ? `${blockedStatusJobs.length} Mailchimp job(s) cannot resume adapter status probing.`
            : "Adapter status handoffs expose commands, terminal statuses, and resume cursors.",
      nextAction: missingStatusCommandJobs.length > 0 || missingTerminalStatusJobs.length > 0
        ? "repair-adapter-status-contract"
        : blockedStatusJobs.length > 0
          ? "resume-claim-or-permission-gate"
          : "persist-adapter-status-cursors",
      jobIds: [...new Set([
        ...missingStatusCommandJobs.map((job) => job.id),
        ...missingTerminalStatusJobs.map((job) => job.id),
        ...blockedStatusJobs.map((job) => job.id),
      ])],
    },
    {
      name: "sync-facts",
      status: missingSyncFacts.length > 0 ? "blocked" : "ready",
      detail: missingSyncFacts.length > 0
        ? `Mailchimp sync is missing claim facts: ${missingSyncFacts.join(", ")}.`
        : "Mailchimp sync facts are available for provider handoff.",
      nextAction: missingSyncFacts.length > 0 ? "collect-claim-evidence" : "continue-provider-handoff",
      factNames: missingSyncFacts,
    },
    {
      name: "lifecycle-release",
      status: ["disabled", "blocked"].includes(lifecycleHandoffState)
        ? "blocked"
        : lifecycleHandoffState === "review" || lifecycleHandoffState === "scheduled"
          ? "degraded"
          : "ready",
      detail: releaseGate.id
        ? `Lifecycle release gate ${releaseGate.id} is ${releaseGate.state}.`
        : `Lifecycle provider handoff state is ${lifecycleHandoffState}.`,
      nextAction: releaseGate.nextAction ?? (
        lifecycleHandoffState === "ready" ? "continue-provider-handoff" : "review-lifecycle-release"
      ),
      releaseGateId: releaseGate.id ?? null,
      releaseGateState: releaseGate.state ?? lifecycleHandoffState,
    },
  ];
  const blockedChecks = checks.filter((check) => check.status === "blocked");
  const degradedChecks = checks.filter((check) => check.status === "degraded" || check.status === "review");
  const status = blockedChecks.length > 0
    ? "unhealthy"
    : degradedChecks.length > 0
      ? "degraded"
      : "healthy";
  const actionableErrors = checks
    .filter((check) => check.status !== "ready")
    .map((check) => ({
      code: `provider.${check.name}.${check.status}`,
      severity: check.status === "blocked" ? "error" : "warning",
      action: check.nextAction,
      detail: check.detail,
      jobIds: check.jobIds ?? [],
      facts: check.factNames ?? [],
      capabilities: check.missingCapabilities ?? [],
    }));
  const retryable = status !== "unhealthy" && externalHandoffState !== "blocked";
  const retryBaseDelayMs = status === "degraded" ? 1000 : 250;
  return {
    id: stableId("providerhealth", [
      packageDescriptor.id,
      claimDescriptor.id,
      tenantContext.isolationKey,
      externalHandoffState,
      checks.map((check) => `${check.name}:${check.status}`).join(","),
    ]),
    product: "mailchimp",
    status,
    externalHandoffState,
    blockedReason: externalBlockedReason,
    permissionHandoffState,
    lifecycleHandoffState,
    checks,
    actionableErrors,
    degradedMode: {
      enabled: status === "degraded",
      reason: degradedChecks[0]?.name ?? null,
      allowedActions: status === "degraded"
        ? ["persist-provider-cursors", "collect-approval", "wait-for-schedule-window"]
        : [],
      blockedAdapterCalls: blockedChecks.flatMap((check) => check.jobIds ?? []),
    },
    retryPolicy: {
      retryable,
      maxAttempts: retryable ? 3 : 0,
      backoff: retryable
        ? [0, 1, 2].map((index) => ({
          attempt: index + 1,
          delayMs: retryBaseDelayMs * (2 ** index),
          condition: status === "degraded" ? "provider-health-degraded" : "provider-health-ready",
        }))
        : [],
    },
    nextAction: blockedChecks[0]?.nextAction
      ?? degradedChecks[0]?.nextAction
      ?? (externalHandoffState === "ready" ? "persist-provider-handoff" : "review-provider-handoff"),
    syncContractId: syncContract.id ?? null,
    adapterStatusResumeCursors: jobs.map((job) => job.recovery.adapterStatusResumeCursor).filter(Boolean),
  };
}

function buildProviderServiceContract(packageDescriptor, claimDescriptor, tenantContext, jobs) {
  const lifecycle = packageDescriptor.lifecycleControls ?? {};
  const releaseGate = lifecycle.releaseGate ?? {};
  const releaseAcceptance = lifecycle.releaseAcceptance ?? packageDescriptor.releaseAcceptanceContract ?? {};
  const packagePreview = packageDescriptor.previewContract ?? {};
  const claimAcceptance = claimDescriptor.claimAcceptance ?? {};
  const claimReporting = claimDescriptor.reporting ?? {};
  const claimExportPacket = claimDescriptor.exportPacket ?? claimDescriptor.exportContract ?? {};
  const syncContract = packageDescriptor.syncServiceContract ?? {};
  const syncMetadata = packageDescriptor.syncMetadata ?? {};
  const adapters = [...new Set(jobs.map((job) => job.adapter))].sort();
  const operations = jobs.map((job) => ({
    jobId: job.id,
    operation: job.operation,
    adapter: job.adapter,
    descriptorId: job.descriptorId,
    permissionDecision: job.permissions.decision,
    clientOperationStateId: job.clientOperationState?.id ?? null,
    clientVisibleStatus: job.clientOperationState?.visibleStatus ?? job.statusProjection?.clientVisibleStatus,
    clientNextAction: job.clientOperationState?.nextAction ?? job.statusProjection?.restartAction,
    operationStatusLedgerId: job.clientOperationState?.stateKeys?.operationStatusLedgerId ?? null,
    adapterStatusHandoffId: job.adapterStatusHandoff.id,
    adapterStatusProbe: job.adapterStatusHandoff.probe,
    adapterStatusResumeCursor: job.adapterStatusHandoff.recovery.resumeCursor,
    adapterStatusDefaultFixtureId: job.adapterStatusHandoff.dryRunFixtures?.defaultFixtureId ?? null,
    adapterStatusFixtureCount: job.adapterStatusHandoff.dryRunFixtures?.fixtureCount ?? 0,
    requiredCapabilities: job.capabilities.map((capability) => capability.name),
  }));
  const writeLikeJobs = jobs.filter((job) => job.capabilities.some((capability) => (
    capability.name.endsWith(".write") || capability.name.endsWith(".send") || capability.name.includes("segment.write")
  )));
  const deniedJobs = jobs.filter((job) => job.permissions.decision === "deny");
  const approvalJobs = jobs.filter((job) => job.permissions.decision === "needs-approval");
  const readyJobs = jobs.filter((job) => job.permissions.decision === "allow");
  const negotiatedCapabilities = [...new Set(jobs.flatMap((job) => job.capabilities.map((capability) => capability.name)))].sort();
  const missingWorkspaceCapabilities = [...new Set(jobs.flatMap((job) => (
    job.permissions.workspacePolicy.restrictedCapabilities ?? []
  )))].sort();
  const permissionHandoffState = deniedJobs.length > 0
    ? "blocked"
    : approvalJobs.length > 0
      ? "waiting-for-approval"
      : "ready";
  const lifecycleHandoffState = ["disabled", "blocked"].includes(releaseGate.state)
    ? "blocked"
    : releaseGate.state === "scheduled"
      ? "scheduled"
      : releaseGate.state === "review"
        ? "review"
        : "ready";
  const externalHandoffState = lifecycleHandoffState === "blocked" || permissionHandoffState === "blocked"
    ? "blocked"
    : permissionHandoffState === "waiting-for-approval"
      ? "waiting-for-approval"
      : lifecycleHandoffState;
  const externalBlockedReason = releaseGate.state === "disabled"
    ? "lifecycle-disabled"
    : releaseGate.state === "blocked"
      ? `lifecycle-${releaseGate.gateReason ?? "blocked"}`
      : deniedJobs.length > 0
        ? "permission-denied"
        : approvalJobs.length > 0
          ? "approval-required"
          : releaseGate.state === "scheduled"
            ? "waiting-for-release-schedule"
            : releaseGate.state === "review"
              ? `lifecycle-review-${releaseGate.gateReason ?? "required"}`
              : null;
  const serviceScope = [
    packageDescriptor.id,
    claimDescriptor.id,
    tenantContext.tenantId,
    tenantContext.workspaceId,
    adapters.join(","),
    externalHandoffState,
  ];
  const providerOperationalHealth = buildProviderOperationalHealth({
    packageDescriptor,
    claimDescriptor,
    tenantContext,
    jobs,
    externalHandoffState,
    externalBlockedReason,
    lifecycleHandoffState,
    permissionHandoffState,
    providerCapabilities: syncContract.requiredProviderCapabilities ?? [],
    missingWorkspaceCapabilities,
    releaseGate,
    syncContract,
  });
  return {
    id: stableId("svc", serviceScope),
    product: "mailchimp",
    provider: {
      adapter: packageDescriptor.runtimeAdapter,
      adapters,
      service: "mailchimp-marketing",
      contractVersion: "aios.provider.mailchimp.v1",
      supportsDryRun: true,
      supportsStatusProbe: jobs.every((job) => Boolean(job.adapterStatusHandoff.commands.statusCommandId)),
      supportsResume: jobs.every((job) => Boolean(job.recovery.adapterStatusResumeCursor)),
      syncContractId: syncContract.id ?? syncMetadata.serviceContractId ?? null,
      syncMode: syncContract.mode ?? syncMetadata.mode ?? "push",
    },
    tenantBoundary: {
      tenantId: tenantContext.tenantId,
      workspaceId: tenantContext.workspaceId,
      isolationKey: tenantContext.isolationKey,
      policyBoundaryId: tenantContext.policyBoundaryId,
      auditRequired: tenantContext.auditRequired,
    },
    capabilityNegotiation: {
      decision: deniedJobs.length > 0
        ? "deny"
        : approvalJobs.length > 0
          ? "approval-required"
          : "allow",
      requestedCapabilities: negotiatedCapabilities,
      missingWorkspaceCapabilities,
      writeLikeJobIds: writeLikeJobs.map((job) => job.id),
      readyJobIds: readyJobs.map((job) => job.id),
      approvalJobIds: approvalJobs.map((job) => job.id),
      deniedJobIds: deniedJobs.map((job) => job.id),
      providerRequiredCapabilities: syncContract.requiredProviderCapabilities ?? [],
    },
    operationalHealth: providerOperationalHealth,
    sync: {
      contractId: syncContract.id ?? syncMetadata.serviceContractId ?? null,
      provider: syncContract.provider ?? syncMetadata.provider ?? "mailchimp-marketing",
      mode: syncContract.mode ?? syncMetadata.mode ?? "push",
      handoffMode: syncContract.handoffMode ?? syncMetadata.handoffMode ?? "adapter",
      conflictPolicy: syncContract.conflictPolicy ?? syncMetadata.conflictPolicy ?? "manual-review",
      requiredFacts: syncContract.requiredFacts ?? syncMetadata.requiredFacts ?? [],
      requiredProviderCapabilities: syncContract.requiredProviderCapabilities ?? [],
      cursor: syncContract.cursor ?? syncMetadata.cursor ?? null,
      objectBindings: syncContract.objectBindings ?? {
        audience: syncMetadata.audience,
        campaign: syncMetadata.campaign,
        segment: syncMetadata.segment,
        template: syncMetadata.template,
      },
      externalHandoff: syncContract.externalHandoff ?? {
        state: externalHandoffState,
        handoffId: stableId("synchandoff", [packageDescriptor.id, claimDescriptor.id, externalHandoffState]),
        nextAction: externalHandoffState === "ready"
          ? "negotiate-provider-capabilities"
          : releaseGate.nextAction ?? "hold-runtime-handoff",
      },
    },
    lifecycle: {
      stateId: lifecycle.stateId ?? null,
      enabled: lifecycle.enabled !== false,
      command: lifecycle.command ?? "prepare",
      releasePolicy: lifecycle.releasePolicy ?? "manual-approval",
      schedule: lifecycle.schedule ?? { mode: "manual" },
      releaseGate: releaseGate.id ? {
        id: releaseGate.id,
        state: releaseGate.state,
        releaseAllowed: releaseGate.releaseAllowed === true,
        gateReason: releaseGate.gateReason,
        nextAction: releaseGate.nextAction,
        releaseCommandId: releaseGate.releaseCommandId,
        blockedCheckNames: releaseGate.blockedCheckNames ?? [],
        reviewCheckNames: releaseGate.reviewCheckNames ?? [],
      } : null,
      releaseAcceptance: releaseAcceptance.id ? {
        id: releaseAcceptance.id,
        state: releaseAcceptance.state,
        ready: releaseAcceptance.ready === true,
        visibleStatus: releaseAcceptance.visibleStatus,
        nextAction: releaseAcceptance.nextAction,
        canReleaseNow: releaseAcceptance.canReleaseNow === true,
        commandId: releaseAcceptance.command?.id ?? null,
        blockedOperationIds: releaseAcceptance.clientPatch?.releaseAcceptanceBlockedOperationIds ?? [],
        reviewOperationIds: releaseAcceptance.clientPatch?.releaseAcceptanceReviewOperationIds ?? [],
      } : null,
      nextAction: lifecycle.nextAction ?? {
        action: externalHandoffState === "ready" ? "prepare-manual-release" : "hold-runtime-handoff",
        commandId: null,
      },
      commandIds: (lifecycle.commands ?? []).map((command) => command.id),
    },
    packagePreview: {
      id: packagePreview.id ?? null,
      status: packagePreview.status ?? "unknown",
      visibleStatus: packagePreview.visibleStatus ?? "preview-unavailable",
      nextAction: packagePreview.nextAction ?? "review-package-preview",
      validationSummary: packagePreview.validationSummary ?? packageDescriptor.validationSummary ?? {},
      operationCount: packagePreview.preview?.operations?.length ?? packageDescriptor.operations?.length ?? 0,
      writeLikeOperationIds: packagePreview.validationSummary?.writeLikeOperationIds ?? [],
      restartUnsafeOperationIds: packagePreview.validationSummary?.restartUnsafeOperationIds ?? [],
      requiredEvidenceFacts: packagePreview.validationSummary?.requiredEvidenceFacts ?? [],
      acceptance: packagePreview.acceptance ?? packageDescriptor.acceptance ?? null,
    },
    claimReporting: {
      exportFormat: claimReporting.exportSummary?.format ?? "aios.mailchimp.claim-gate.v1",
      historySnapshotIds: claimReporting.exportSummary?.historySnapshotIds ?? [],
      pendingFacts: claimReporting.exportSummary?.pendingFacts ?? claimDescriptor.truthBoundary.unverifiedFacts,
      counters: claimReporting.counters ?? {},
      exportPacket: {
        protocol: claimExportPacket.protocol ?? "aios.mailchimp.claim-gate.export-packet.v1",
        state: claimExportPacket.state ?? claimExportPacket.summary?.status ?? "unknown",
        ready: claimExportPacket.exportReady === true || claimExportPacket.ready === true,
        digest: claimExportPacket.digest ?? claimExportPacket.summary?.digest ?? null,
        nextAction: claimExportPacket.exportSummary?.nextAction
          ?? claimExportPacket.summary?.nextAction
          ?? claimExportPacket.clientPatch?.claimExportNextAction
          ?? "review-claim-export-packet",
        counters: claimExportPacket.counters ?? {},
        artifactNames: (claimExportPacket.artifacts ?? []).map((artifact) => artifact.name),
        blockedArtifactNames: claimExportPacket.exportSummary?.blockerArtifactNames
          ?? claimExportPacket.clientPatch?.claimExportBlockedArtifacts
          ?? [],
        publishCommandIds: (claimExportPacket.publishCommands ?? []).map((command) => command.id).filter(Boolean),
        latestSnapshotId: claimExportPacket.manifest?.latestSnapshotId
          ?? claimExportPacket.clientPatch?.claimExportLatestSnapshotId
          ?? null,
      },
      acceptance: {
        id: claimAcceptance.id ?? null,
        status: claimAcceptance.status ?? "unknown",
        visibleStatus: claimAcceptance.visibleStatus ?? "claim-preview-unavailable",
        nextAction: claimAcceptance.nextAction ?? "review-claim-preview",
        acceptanceToken: claimAcceptance.acceptanceToken ?? null,
        canAcknowledge: claimAcceptance.canAcknowledge === true,
        requiredInputNames: claimAcceptance.acknowledgement?.requiredInputs
          ?.filter((input) => input.required)
          .map((input) => input.name) ?? [],
        validationSummary: claimAcceptance.validationSummary ?? {},
        commandId: claimAcceptance.acknowledgement?.command?.id ?? null,
      },
    },
    operations,
    externalHandoff: {
      state: externalHandoffState,
      handoffId: stableId("handoff", [...serviceScope, jobs.map((job) => job.id).join(",")]),
      releaseCommandId: lifecycle.commands?.find((command) => (
        ["prepare-runtime-handoff", "schedule-runtime-release"].includes(command.type)
      ))?.id ?? releaseGate.releaseCommandId ?? null,
      blockedReason: externalBlockedReason,
      lifecycleGateId: releaseGate.id ?? null,
      lifecycleGateState: releaseGate.state ?? "unknown",
      lifecycleGateNextAction: releaseGate.nextAction ?? null,
      adapterStatusResumeCursors: jobs
        .map((job) => job.recovery.adapterStatusResumeCursor)
        .filter(Boolean),
      healthId: providerOperationalHealth.id,
      healthStatus: providerOperationalHealth.status,
      nextAction: providerOperationalHealth.nextAction,
    },
  };
}

function buildReadinessSummary(packageDescriptor, claimDescriptor, jobs, providerService, issues) {
  const sync = providerService.sync ?? {};
  const packagePreview = providerService.packagePreview ?? {};
  const claimAcceptance = claimDescriptor.claimAcceptance ?? {};
  const verifiedFacts = new Set(claimDescriptor.truthBoundary?.verifiedFacts ?? []);
  const unverifiedFacts = new Set(claimDescriptor.truthBoundary?.unverifiedFacts ?? []);
  const requiredSyncFacts = sync.requiredFacts ?? [];
  const missingSyncFacts = requiredSyncFacts.filter((fact) => !verifiedFacts.has(fact));
  const blockedJobs = jobs.filter((job) => job.permissions.decision === "deny");
  const approvalJobs = jobs.filter((job) => job.permissions.decision === "needs-approval");
  const adapterBlockedJobs = jobs.filter((job) => job.adapterStatusHandoff.state === "blocked");
  const lifecycle = packageDescriptor.lifecycleControls ?? {};
  const releaseGate = lifecycle.releaseGate ?? {};
  const releaseAcceptance = lifecycle.releaseAcceptance ?? packageDescriptor.releaseAcceptanceContract ?? {};
  const readinessChecks = [
    {
      name: "package-preview",
      status: packagePreview.status === "blocked"
        ? "blocked"
        : packagePreview.status === "review"
          ? "needs-review"
          : "ready",
      detail: packagePreview.id
        ? `Package preview ${packagePreview.id} is ${packagePreview.visibleStatus}.`
        : "Package preview contract is not available.",
      nextAction: packagePreview.nextAction ?? "review-package-preview",
    },
    {
      name: "claim-gate",
      status: unverifiedFacts.size > 0 || missingSyncFacts.length > 0 ? "blocked" : "ready",
      detail: missingSyncFacts.length > 0
        ? `Missing Mailchimp sync facts: ${missingSyncFacts.join(", ")}.`
        : unverifiedFacts.size > 0
          ? `Unverified claim facts: ${[...unverifiedFacts].join(", ")}.`
          : "Claim evidence satisfies Mailchimp sync requirements.",
      nextAction: missingSyncFacts.length > 0 || unverifiedFacts.size > 0
        ? "collect-claim-evidence"
        : "continue-provider-negotiation",
    },
    {
      name: "claim-acknowledgment",
      status: claimAcceptance.status === "ready"
        ? "ready"
        : claimAcceptance.status === "review"
          ? "needs-review"
          : "blocked",
      detail: claimAcceptance.id
        ? `Claim preview ${claimAcceptance.id} is ${claimAcceptance.visibleStatus}.`
        : "Claim preview acknowledgment contract is not available.",
      nextAction: claimAcceptance.nextAction ?? "review-claim-preview",
      token: claimAcceptance.acceptanceToken ?? null,
    },
    {
      name: "tenant-permission",
      status: blockedJobs.length > 0
        ? "blocked"
        : approvalJobs.length > 0
          ? "needs-approval"
          : "ready",
      detail: blockedJobs.length > 0
        ? `${blockedJobs.length} job(s) are outside the tenant permission envelope.`
        : approvalJobs.length > 0
          ? `${approvalJobs.length} job(s) require approval before Mailchimp handoff.`
          : "Tenant permission envelope allows Mailchimp handoff.",
      nextAction: blockedJobs.length > 0
        ? "repair-tenant-permission"
        : approvalJobs.length > 0
          ? "collect-approval"
          : "continue-provider-negotiation",
    },
    {
      name: "adapter-status",
      status: adapterBlockedJobs.length > 0 ? "blocked" : "ready",
      detail: adapterBlockedJobs.length > 0
        ? `${adapterBlockedJobs.length} job(s) cannot resume adapter status probing.`
        : "Adapter status probes have deterministic resume cursors.",
      nextAction: adapterBlockedJobs.length > 0 ? "repair-adapter-status-handoff" : "persist-status-cursors",
    },
    {
      name: "lifecycle",
      status: releaseGate.state === "disabled"
        ? "disabled"
        : releaseGate.state === "blocked"
          ? "blocked"
          : ["scheduled", "review"].includes(releaseGate.state)
            ? "needs-review"
            : lifecycle.enabled === false
              ? "disabled"
        : lifecycle.nextAction?.requiresHealthyPlan && issues.some((issue) => issue.severity === "error")
          ? "blocked"
          : "ready",
      detail: releaseGate.id
        ? `Lifecycle release gate ${releaseGate.id} is ${releaseGate.state}.`
        : lifecycle.enabled === false
        ? "Package lifecycle is disabled."
        : `Lifecycle command ${lifecycle.command ?? "prepare"} is ${lifecycle.nextAction?.action ?? "prepare-manual-release"}.`,
      nextAction: releaseGate.nextAction
        ?? (lifecycle.enabled === false
        ? "enable-package-lifecycle"
        : lifecycle.nextAction?.action ?? "prepare-manual-release"),
      releaseGateId: releaseGate.id ?? null,
      releaseGateState: releaseGate.state ?? "unknown",
    },
    {
      name: "release-acceptance",
      status: releaseAcceptance.state === "ready"
        ? "ready"
        : releaseAcceptance.state === "review" || releaseAcceptance.state === "scheduled"
          ? "needs-review"
          : releaseAcceptance.state === "disabled"
            ? "disabled"
            : "blocked",
      detail: releaseAcceptance.id
        ? `Lifecycle release acceptance ${releaseAcceptance.id} is ${releaseAcceptance.visibleStatus}.`
        : "Lifecycle release acceptance contract is not available.",
      nextAction: releaseAcceptance.nextAction ?? "review-release-acceptance",
      releaseAcceptanceId: releaseAcceptance.id ?? null,
      releaseAcceptanceState: releaseAcceptance.state ?? "unknown",
      blockedOperationIds: releaseAcceptance.clientPatch?.releaseAcceptanceBlockedOperationIds ?? [],
      reviewOperationIds: releaseAcceptance.clientPatch?.releaseAcceptanceReviewOperationIds ?? [],
    },
    {
      name: "provider-sync",
      status: sync.externalHandoff?.state === "disabled"
        ? "disabled"
        : (sync.requiredProviderCapabilities ?? []).length === 0
          ? "needs-negotiation"
          : "ready",
      detail: `Mailchimp sync contract ${sync.contractId ?? "unbound"} uses ${sync.mode ?? "push"} mode.`,
      nextAction: sync.externalHandoff?.nextAction ?? "negotiate-provider-capabilities",
    },
  ];
  const blockingChecks = readinessChecks.filter((check) => ["blocked", "disabled"].includes(check.status));
  const approvalChecks = readinessChecks.filter((check) => check.status === "needs-approval");
  const reviewChecks = readinessChecks.filter((check) => check.status === "needs-review");
  return {
    id: stableId("ready", [
      packageDescriptor.id,
      claimDescriptor.id,
      readinessChecks.map((check) => `${check.name}:${check.status}`).join(","),
    ]),
    product: "mailchimp",
    status: blockingChecks.length > 0
      ? "blocked"
      : approvalChecks.length > 0
        ? "needs-approval"
        : reviewChecks.length > 0
          ? "needs-review"
          : "ready",
    checks: readinessChecks,
    missingSyncFacts,
    requiredSyncFacts,
    nextAction: blockingChecks[0]?.nextAction
      ?? approvalChecks[0]?.nextAction
      ?? reviewChecks[0]?.nextAction
      ?? (providerService.externalHandoff?.state === "ready"
        ? "preview-runtime-acceptance"
        : providerService.externalHandoff?.blockedReason ?? "review-provider-handoff"),
    preview: {
      title: "Mailchimp runtime handoff",
      objectBindings: sync.objectBindings ?? {},
      cursor: sync.cursor ?? null,
      providerCapabilities: sync.requiredProviderCapabilities ?? [],
      jobCount: jobs.length,
      readyJobIds: providerService.capabilityNegotiation?.readyJobIds ?? [],
      approvalJobIds: providerService.capabilityNegotiation?.approvalJobIds ?? [],
      deniedJobIds: providerService.capabilityNegotiation?.deniedJobIds ?? [],
      packagePreviewId: packagePreview.id ?? null,
      packagePreviewStatus: packagePreview.status ?? "unknown",
      packagePreviewOperationCount: packagePreview.operationCount ?? 0,
      claimAcceptanceId: claimAcceptance.id ?? null,
      claimAcceptanceStatus: claimAcceptance.status ?? "unknown",
      lifecycleReleaseGateId: releaseGate.id ?? null,
      lifecycleReleaseGateState: releaseGate.state ?? "unknown",
      lifecycleReleaseAcceptanceId: releaseAcceptance.id ?? null,
      lifecycleReleaseAcceptanceState: releaseAcceptance.state ?? "unknown",
    },
  };
}

function buildAcceptanceContract(planId, packageDescriptor, claimDescriptor, jobs, providerService, readiness) {
  const lifecycle = packageDescriptor.lifecycleControls ?? {};
  const releaseAcceptance = lifecycle.releaseAcceptance ?? packageDescriptor.releaseAcceptanceContract ?? {};
  const claimState = claimDescriptor.requestState ?? {};
  const claimAcceptance = claimDescriptor.claimAcceptance ?? {};
  const readyJobs = providerService.capabilityNegotiation?.readyJobIds ?? [];
  const approvalJobs = providerService.capabilityNegotiation?.approvalJobIds ?? [];
  const deniedJobs = providerService.capabilityNegotiation?.deniedJobIds ?? [];
  const releaseGate = lifecycle.releaseGate ?? {};
  const releaseGateReady = releaseGate.id ? releaseGate.releaseAllowed === true : true;
  const releaseAcceptanceReady = releaseAcceptance.id ? releaseAcceptance.ready === true : true;
  const canAccept = readiness.status === "ready"
    && deniedJobs.length === 0
    && claimState.status !== "needs-evidence"
    && releaseGateReady
    && releaseAcceptanceReady;
  const acceptanceInputs = [
    {
      name: "packagePreviewId",
      value: providerService.packagePreview?.id ?? null,
      required: true,
    },
    {
      name: "claimAcceptanceToken",
      value: claimAcceptance.acceptanceToken ?? null,
      required: true,
    },
    {
      name: "claimStateVersion",
      value: claimState.version ?? null,
      required: true,
    },
    {
      name: "syncContractId",
      value: providerService.sync?.contractId ?? null,
      required: true,
    },
    {
      name: "lifecycleCommandId",
      value: lifecycle.nextAction?.commandId ?? null,
      required: lifecycle.enabled !== false,
    },
    {
      name: "lifecycleReleaseGateId",
      value: releaseGate.id ?? null,
      required: Boolean(releaseGate.id),
    },
    {
      name: "releaseAcceptanceId",
      value: releaseAcceptance.id ?? null,
      required: Boolean(releaseAcceptance.id),
    },
    {
      name: "releaseAcceptanceCommandId",
      value: releaseAcceptance.command?.id ?? null,
      required: releaseAcceptance.ready === true,
    },
    {
      name: "adapterStatusResumeCursors",
      value: providerService.externalHandoff?.adapterStatusResumeCursors ?? [],
      required: true,
    },
  ];
  return {
    id: stableId("accept", [
      planId,
      readiness.id,
      readyJobs.join(","),
      approvalJobs.join(","),
      deniedJobs.join(","),
    ]),
    product: "mailchimp",
    canAccept,
    status: canAccept
      ? "acceptance-ready"
      : approvalJobs.length > 0
        ? "acceptance-needs-approval"
        : "acceptance-blocked",
    acceptAction: canAccept ? "accept-and-prepare-mailchimp-handoff" : "review-readiness-checks",
    requiredInputs: acceptanceInputs,
    validationSummary: {
      readinessStatus: readiness.status,
      issueCount: readiness.checks.filter((check) => check.status !== "ready").length,
      missingSyncFacts: readiness.missingSyncFacts,
      approvalJobIds: approvalJobs,
      deniedJobIds: deniedJobs,
      packagePreviewStatus: providerService.packagePreview?.status ?? "unknown",
      packagePreviewIssueCodes: providerService.packagePreview?.validationSummary?.issueCodes ?? [],
      claimAcceptanceStatus: claimAcceptance.status ?? "unknown",
      claimAcceptanceIssueCodes: claimAcceptance.validationSummary?.issueCodes ?? [],
      lifecycleReleaseGateState: releaseGate.state ?? "unknown",
      lifecycleReleaseGateReason: releaseGate.gateReason ?? null,
      releaseAcceptanceState: releaseAcceptance.state ?? "unknown",
      releaseAcceptanceReady: releaseAcceptance.ready === true,
      releaseAcceptanceBlockedOperationIds: releaseAcceptance.clientPatch?.releaseAcceptanceBlockedOperationIds ?? [],
      releaseAcceptanceReviewOperationIds: releaseAcceptance.clientPatch?.releaseAcceptanceReviewOperationIds ?? [],
    },
    clientPreview: {
      visibleStatus: canAccept
        ? "ready-to-accept"
        : approvalJobs.length > 0
          ? "waiting-for-approval"
          : "blocked-before-acceptance",
      primaryAction: canAccept ? "Accept Mailchimp handoff" : "Review required actions",
      nextAction: readiness.nextAction,
      handoffId: providerService.externalHandoff?.handoffId ?? null,
      lifecycleReleaseGateId: releaseGate.id ?? null,
      releaseAcceptanceId: releaseAcceptance.id ?? null,
      claimAcceptanceId: claimAcceptance.id ?? null,
      claimAcceptanceToken: claimAcceptance.acceptanceToken ?? null,
    },
  };
}

function buildClientHandoffPacket(planId, packageDescriptor, claimDescriptor, jobs, providerService, readiness, acceptance) {
  const manifestHandoff = packageDescriptor.providerClientHandoff ?? packageDescriptor.clientHandoff ?? {};
  const claimResume = claimDescriptor.clientResumeContract ?? {};
  const claimAcceptance = claimDescriptor.claimAcceptance ?? {};
  const releaseGate = packageDescriptor.lifecycleControls?.releaseGate ?? {};
  const providerHealth = providerService.operationalHealth ?? {};
  const blockedJobs = jobs.filter((job) => job.permissions.decision === "deny");
  const approvalJobs = jobs.filter((job) => job.permissions.decision === "needs-approval");
  const waitingStatusJobs = jobs.filter((job) => job.adapterStatusHandoff.state !== "ready-to-probe");
  const requiredInputs = [
    ...(manifestHandoff.clientRequiredInputs ?? []),
    ...acceptance.requiredInputs,
  ];
  const inputNames = [...new Set(requiredInputs.filter((input) => input.required).map((input) => input.name))].sort();
  const blockerReasons = [
    ...(manifestHandoff.blockers ?? []),
    ...(readiness.checks ?? [])
      .filter((check) => ["blocked", "disabled"].includes(check.status))
      .map((check) => `${check.name}:${check.nextAction}`),
    ...blockedJobs.map((job) => `permission-denied:${job.id}`),
    ...waitingStatusJobs
      .filter((job) => job.adapterStatusHandoff.state === "blocked")
      .map((job) => `adapter-status-blocked:${job.id}`),
    ...(providerHealth.status === "unhealthy" ? providerHealth.actionableErrors?.map((error) => error.code) ?? [] : []),
  ];
  const reviewReasons = [
    ...(manifestHandoff.reviewReasons ?? []),
    ...(readiness.checks ?? [])
      .filter((check) => ["needs-review", "needs-approval", "needs-negotiation"].includes(check.status))
      .map((check) => `${check.name}:${check.nextAction}`),
    ...approvalJobs.map((job) => `approval-required:${job.id}`),
    ...(providerHealth.status === "degraded" ? providerHealth.actionableErrors?.map((error) => error.code) ?? [] : []),
  ];
  const state = blockerReasons.length > 0
    ? "blocked"
    : approvalJobs.length > 0
      ? "waiting-for-approval"
      : releaseGate.state === "scheduled" || manifestHandoff.state === "scheduled"
        ? "scheduled"
        : reviewReasons.length > 0
          ? "review"
          : acceptance.canAccept
            ? "ready"
            : "waiting";
  const jobPackets = jobs.map((job, index) => ({
    sequence: index + 1,
    jobId: job.id,
    operation: job.operation,
    adapter: job.adapter,
    descriptorId: job.descriptorId,
    permissionDecision: job.permissions.decision,
    visibleStatus: job.clientOperationState?.visibleStatus ?? job.statusProjection.clientVisibleStatus,
    nextAction: job.clientOperationState?.nextAction ?? job.statusProjection.restartAction,
    checkpointKey: job.stateContract?.checkpointKey ?? null,
    commandLedgerKey: job.stateContract?.commandState?.ledgerKey ?? null,
    replayManifestId: job.stateContract?.replayManifest?.id ?? null,
    adapterStatus: {
      handoffId: job.adapterStatusHandoff.id,
      state: job.adapterStatusHandoff.state,
      probe: job.adapterStatusHandoff.probe,
      commandId: job.adapterStatusHandoff.commands.statusCommandId,
      resumeCursor: job.adapterStatusHandoff.recovery.resumeCursor,
      terminalStatuses: job.adapterStatusHandoff.expectedStatuses?.terminal ?? [],
      defaultFixtureId: job.adapterStatusHandoff.dryRunFixtures?.defaultFixtureId ?? null,
      fixtureCount: job.adapterStatusHandoff.dryRunFixtures?.fixtureCount ?? 0,
    },
    resume: {
      replayCursor: job.recovery.replayCursor,
      claimResumeCursor: claimDescriptor.requestState?.resumeCursor ?? null,
      continuationToken: claimDescriptor.clientRuntime?.continuationToken ?? null,
    },
  }));
  const packetScope = [
    planId,
    manifestHandoff.id,
    claimResume.id,
    providerService.externalHandoff?.handoffId,
    state,
    jobPackets.map((job) => `${job.jobId}:${job.adapterStatus.state}`).join(","),
  ];
  const clientCommands = [
    {
      id: stableId("clientcmd", [...packetScope, "persist-client-handoff"]),
      type: "persist-client-handoff",
      idempotencyKey: stableId("idem", [...packetScope, "persist-client-handoff"]),
      statusAfterReplay: state === "ready" ? "handoff-ready" : state,
      writes: ["clientHandoffPacket", "visibleStatus", "nextAction", "requiredInputs"],
      conflict: "return-existing",
    },
    ...(state === "ready" ? [{
      id: stableId("clientcmd", [...packetScope, "publish-runtime-acceptance"]),
      type: "publish-runtime-acceptance",
      idempotencyKey: stableId("idem", [...packetScope, "publish-runtime-acceptance"]),
      statusAfterReplay: "runtime-acceptance-published",
      writes: ["acceptanceContractId", "providerHandoffId", "adapterStatusCursors"],
      conflict: "return-existing",
    }] : []),
    ...(approvalJobs.length > 0 ? [{
      id: stableId("clientcmd", [...packetScope, "pause-for-approval"]),
      type: "pause-for-approval",
      idempotencyKey: stableId("idem", [...packetScope, "pause-for-approval"]),
      statusAfterReplay: "waiting-for-approval",
      writes: ["approvalJobIds", "visibleStatus", "resumeCursor"],
      conflict: "return-existing",
    }] : []),
  ];
  return {
    id: stableId("clientpacket", packetScope),
    product: "mailchimp",
    contractVersion: "aios.mailchimp.executor-client-handoff.v1",
    planId,
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "ready-to-handoff"
      : state === "waiting-for-approval"
        ? "waiting-for-approval"
        : state === "scheduled"
          ? "waiting-for-release-schedule"
          : state === "review"
            ? "review-before-handoff"
            : "blocked-before-handoff",
    nextAction: blockerReasons.length > 0
      ? clientHandoffBlockerAction(blockerReasons[0])
      : state === "waiting-for-approval"
        ? "collect-approval"
        : state === "scheduled"
          ? "wait-for-release-schedule"
          : state === "review"
            ? "review-client-handoff"
            : state === "ready"
              ? "publish-runtime-acceptance"
              : readiness.nextAction,
    requiredInputNames: inputNames,
    requiredInputs,
    clientState: {
      requestId: claimDescriptor.clientRuntime?.requestId ?? null,
      workflowId: claimDescriptor.clientRuntime?.workflowId ?? null,
      tenantId: claimDescriptor.clientRuntime?.tenantId ?? null,
      workspaceId: claimDescriptor.clientRuntime?.workspaceId ?? null,
      clientStateKey: claimDescriptor.clientRuntime?.clientStateKey ?? null,
      continuationToken: claimDescriptor.clientRuntime?.continuationToken ?? null,
      claimResumeCursor: claimDescriptor.requestState?.resumeCursor ?? null,
      claimAcceptanceToken: claimAcceptance.acceptanceToken ?? null,
      packagePreviewId: providerService.packagePreview?.id ?? packageDescriptor.previewContract?.id ?? null,
      providerHandoffId: providerService.externalHandoff?.handoffId ?? null,
      providerHealthId: providerHealth.id ?? null,
    },
    providerSync: {
      contractId: providerService.sync?.contractId ?? manifestHandoff.sync?.contractId ?? null,
      state: providerService.externalHandoff?.state ?? manifestHandoff.state ?? "unknown",
      mode: providerService.sync?.mode ?? manifestHandoff.sync?.mode ?? "push",
      cursor: providerService.sync?.cursor ?? manifestHandoff.sync?.cursor ?? null,
      requiredFacts: providerService.sync?.requiredFacts ?? manifestHandoff.sync?.requiredFacts ?? [],
      requiredProviderCapabilities: providerService.sync?.requiredProviderCapabilities ?? manifestHandoff.sync?.requiredProviderCapabilities ?? [],
    },
    lifecycle: {
      releaseGateId: releaseGate.id ?? manifestHandoff.lifecycle?.releaseGateId ?? null,
      releaseGateState: releaseGate.state ?? manifestHandoff.lifecycle?.releaseGateState ?? "unknown",
      releaseAllowed: releaseGate.releaseAllowed === true,
      releaseCommandId: releaseGate.releaseCommandId ?? manifestHandoff.lifecycle?.releaseCommandId ?? null,
      nextAction: releaseGate.nextAction ?? manifestHandoff.lifecycle?.nextAction ?? null,
    },
    jobs: jobPackets,
    commands: clientCommands,
    blockers: [...new Set(blockerReasons)].sort(),
    reviewReasons: [...new Set(reviewReasons)].sort(),
    digest: stableId("clientdigest", packetScope),
  };
}

function clientHandoffBlockerAction(reason) {
  if (String(reason).startsWith("permission-denied")) return "repair-tenant-permission";
  if (String(reason).startsWith("adapter-status-blocked")) return "repair-adapter-status-handoff";
  if (String(reason).startsWith("claim-gate")) return "collect-claim-evidence";
  if (String(reason).startsWith("lifecycle")) return "repair-lifecycle-release-gate";
  if (String(reason).startsWith("provider.")) return "repair-provider-health";
  if (String(reason).startsWith("missing-status-command")) return "repair-adapter-status-contract";
  return "review-readiness-checks";
}

function buildJob(operation, packageDescriptor, claimDescriptor, tenantContext, index) {
  const requiredCapabilities = uniqueByName([
    ...packageDescriptor.capabilities.map(normalizeCapability),
    ...operation.requires.map(normalizeCapability),
  ]);
  const requiredVerifiers = [...new Set([
    ...packageDescriptor.verifierContracts.map((verifier) => verifier.name),
    ...operation.verifier.map((verifier) => verifier.name),
    claimDescriptor.verifierContract.id,
  ])];
  const truthBoundary = {
    product: "mailchimp",
    packageId: packageDescriptor.id,
    claimGateId: claimDescriptor.id,
    operation: operation.operation,
    evidenceRequired: operation.truthBoundary.evidenceRequired || claimDescriptor.truthBoundary.unverifiedFacts.length > 0,
    verifiedFacts: claimDescriptor.truthBoundary.verifiedFacts,
    unverifiedFacts: claimDescriptor.truthBoundary.unverifiedFacts,
  };
  const jobId = stableId("job", [packageDescriptor.id, claimDescriptor.id, operation.id, tenantContext.isolationKey, index]);
  const permissionEnvelope = resolvePermissionEnvelope(operation, requiredCapabilities, tenantContext);
  const statusProjection = buildJobStatusProjection(operation, claimDescriptor, permissionEnvelope);
  const adapterStatusHandoff = buildAdapterStatusHandoff(
    jobId,
    operation,
    claimDescriptor,
    tenantContext,
    permissionEnvelope,
  );
  const jobShell = {
    id: jobId,
    statusProjection,
    adapterStatusHandoff,
    recovery: {
      replayCursor: statusProjection.ledgerKey
        ? stableId("replay", [jobId, statusProjection.ledgerKey, statusProjection.claimResumeCursor])
        : null,
    },
  };
  const clientOperationState = buildClientOperationState(
    jobShell,
    operation,
    claimDescriptor,
    permissionEnvelope,
  );
  return {
    id: jobId,
    sequence: index + 1,
    adapter: operation.adapter,
    operation: operation.operation,
    descriptorId: operation.descriptorId,
    status: "planned",
    inputSchema: operation.inputSchema,
    outputSchema: operation.outputSchema,
    capabilities: requiredCapabilities,
    memory: packageDescriptor.memory,
    stateContract: operation.stateContract,
    statusProjection,
    tenant: {
      tenantId: tenantContext.tenantId,
      workspaceId: tenantContext.workspaceId,
      isolationKey: tenantContext.isolationKey,
    },
    permissions: permissionEnvelope,
    verifierContracts: requiredVerifiers,
    runtimeHandoff: {
      adapter: operation.adapter,
      method: operation.operation,
      packageName: packageDescriptor.name,
      requestId: claimDescriptor.clientRuntime?.requestId,
      workflowId: claimDescriptor.clientRuntime?.workflowId,
      continuationToken: claimDescriptor.clientRuntime?.continuationToken,
      clientStateKey: claimDescriptor.clientRuntime?.clientStateKey,
      checkpointKey: operation.stateContract?.checkpointKey,
      commandLedgerKey: operation.stateContract?.commandState?.ledgerKey,
      expectedCommandIds: operation.stateContract?.commandState?.commands?.map((command) => command.id) ?? [],
      adapterStatusContractId: adapterStatusHandoff.id,
      adapterStatusProbe: adapterStatusHandoff.probe,
      adapterStatusCommandId: adapterStatusHandoff.commands.statusCommandId,
      adapterStatusResumeCursor: adapterStatusHandoff.recovery.resumeCursor,
      adapterStatusDefaultFixtureId: adapterStatusHandoff.dryRunFixtures.defaultFixtureId,
      adapterStatusFixtureCount: adapterStatusHandoff.dryRunFixtures.fixtureCount,
      restartReplayManifestId: operation.stateContract?.replayManifest?.id ?? null,
      dryRunSupported: true,
      clientOperationStateId: clientOperationState.id,
    },
    clientOperationState,
    adapterStatusHandoff,
    auditHandoff: buildAuditHandoff(jobId, operation, claimDescriptor, tenantContext, permissionEnvelope),
    recovery: {
      checkpoint: `${packageDescriptor.id}:${operation.id}`,
      rollback: operation.rollback || packageDescriptor.recovery.rollbackStrategy,
      onVerifierFailure: "block-and-retain-evidence",
      onAdapterFailure: adapterStatusHandoff.recovery.onFailure,
      onAdapterTimeout: adapterStatusHandoff.recovery.onTimeout,
      replayPolicy: operation.stateContract?.replayPolicy ?? packageDescriptor.recovery.restartPolicy,
      idempotencyKey: operation.stateContract?.idempotency?.key ?? null,
      ledgerKey: operation.stateContract?.commandState?.ledgerKey,
      adapterStatusResumeCursor: adapterStatusHandoff.recovery.resumeCursor,
      adapterStatusFixtures: adapterStatusHandoff.dryRunFixtures,
      restartReplayManifestId: operation.stateContract?.replayManifest?.id ?? null,
      replayCursor: statusProjection.ledgerKey
        ? stableId("replay", [jobId, statusProjection.ledgerKey, statusProjection.claimResumeCursor])
        : null,
    },
    truthBoundary,
  };
}

function collectPlanIssues(packageCompilation, claimCompilation, jobs) {
  const issues = [
    ...packageCompilation.issues.map((issue) => ({ ...issue, source: "package-manifest" })),
    ...claimCompilation.issues.map((issue) => ({ ...issue, source: "claim-gate" })),
  ];
  for (const job of jobs) {
    const externalWriteCapability = job.capabilities.find((capability) => capability.scope === "external");
    if (externalWriteCapability) {
      issues.push({
        code: "executor-plan.external-capability-scope",
        severity: "error",
        message: `Job ${job.id} requests external capability scope ${externalWriteCapability.name}.`,
        jobId: job.id,
      });
    }
    if (job.truthBoundary.evidenceRequired && job.truthBoundary.unverifiedFacts.length > 0) {
      issues.push({
        code: "executor-plan.truth-boundary-open",
        severity: "warning",
        message: `Job ${job.id} has unverified claim facts.`,
        jobId: job.id,
      });
    }
    if (job.permissions.decision === "deny") {
      issues.push({
        code: "executor-plan.permission-denied",
        severity: "error",
        message: `Job ${job.id} actor role ${job.permissions.actorRole} is outside the tenant permission envelope.`,
        jobId: job.id,
        tenantId: job.tenant.tenantId,
      });
    }
    if (job.permissions.decision === "needs-approval") {
      issues.push({
        code: "executor-plan.permission-approval-required",
        severity: "warning",
        message: `Job ${job.id} requires approval before runtime handoff.`,
        jobId: job.id,
        tenantId: job.tenant.tenantId,
      });
    }
    if (!job.adapterStatusHandoff?.commands?.statusCommandId) {
      issues.push({
        code: "executor-plan.adapter-status-command-missing",
        severity: "error",
        message: `Job ${job.id} cannot produce a deterministic adapter status probe command.`,
        jobId: job.id,
      });
    }
    if ((job.adapterStatusHandoff?.expectedStatuses?.terminal ?? []).length === 0) {
      issues.push({
        code: "executor-plan.adapter-status-terminal-missing",
        severity: "error",
        message: `Job ${job.id} adapter status handoff has no terminal states.`,
        jobId: job.id,
      });
    }
  }
  return issues;
}

function countBy(items, keySelector) {
  return items.reduce((counts, item) => {
    const key = keySelector(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function buildPlanReportingContract(input) {
  const {
    planId,
    packageDescriptor,
    claimDescriptor,
    tenantContext,
    jobs,
    issues,
    providerService,
    readinessSummary,
    acceptanceContract,
    restartProjection,
  } = input;
  const lifecycle = packageDescriptor.lifecycleControls ?? {};
  const releaseGate = lifecycle.releaseGate ?? {};
  const releaseAcceptance = lifecycle.releaseAcceptance ?? packageDescriptor.releaseAcceptanceContract ?? {};
  const providerHealth = providerService.operationalHealth ?? {};
  const claimReporting = claimDescriptor.reporting ?? {};
  const claimExportPacket = claimDescriptor.exportPacket ?? claimDescriptor.exportContract ?? {};
  const claimAcceptance = claimDescriptor.claimAcceptance ?? {};
  const packagePreview = packageDescriptor.previewContract ?? {};
  const blockedJobs = jobs.filter((job) => job.permissions.decision === "deny");
  const approvalJobs = jobs.filter((job) => job.permissions.decision === "needs-approval");
  const readyJobs = jobs.filter((job) => job.permissions.decision === "allow");
  const writeLikeJobs = jobs.filter((job) => job.capabilities.some((capability) => (
    capability.name.endsWith(".write") || capability.name.endsWith(".send") || capability.name.includes("segment.write")
  )));
  const adapterBlockedJobs = jobs.filter((job) => job.adapterStatusHandoff.state === "blocked");
  const issueCounts = countBy(issues, (issue) => issue.severity);
  const permissionCounts = countBy(jobs, (job) => job.permissions.decision);
  const adapterStatusCounts = countBy(jobs, (job) => job.adapterStatusHandoff.state);
  const operationCounts = countBy(jobs, (job) => job.operation);
  const reportingScope = [
    planId,
    packageDescriptor.id,
    claimDescriptor.id,
    tenantContext.isolationKey,
    readinessSummary.status,
    providerService.externalHandoff?.state,
  ];
  const history = [
    {
      id: stableId("planhist", [...reportingScope, "compiled"]),
      sequence: 1,
      type: "executor-plan-compiled",
      status: issues.some((issue) => issue.severity === "error") || claimDescriptor.admission === "blocked"
        ? "blocked"
        : "planned",
      packageId: packageDescriptor.id,
      claimGateId: claimDescriptor.id,
      jobCount: jobs.length,
      issueCount: issues.length,
    },
    {
      id: stableId("planhist", [...reportingScope, "provider-service"]),
      sequence: 2,
      type: "provider-service-evaluated",
      status: providerService.externalHandoff?.state ?? "unknown",
      handoffId: providerService.externalHandoff?.handoffId ?? null,
      blockedReason: providerService.externalHandoff?.blockedReason ?? null,
      providerHealthStatus: providerHealth.status ?? "unknown",
      providerHealthNextAction: providerHealth.nextAction ?? null,
    },
    {
      id: stableId("planhist", [...reportingScope, "readiness"]),
      sequence: 3,
      type: "runtime-readiness-evaluated",
      status: readinessSummary.status,
      nextAction: readinessSummary.nextAction,
      missingSyncFacts: readinessSummary.missingSyncFacts,
      requiredSyncFacts: readinessSummary.requiredSyncFacts,
    },
    {
      id: stableId("planhist", [...reportingScope, "acceptance"]),
      sequence: 4,
      type: "acceptance-contract-built",
      status: acceptanceContract.status,
      canAccept: acceptanceContract.canAccept,
      acceptAction: acceptanceContract.acceptAction,
      requiredInputs: acceptanceContract.requiredInputs
        .filter((input) => input.required)
        .map((input) => input.name),
    },
  ];
  const timeline = [
    {
      sequence: 1,
      event: "compile-package-preview",
      status: packagePreview.status ?? "unknown",
      artifactId: packagePreview.id ?? null,
      nextAction: packagePreview.nextAction ?? "review-package-preview",
    },
    {
      sequence: 2,
      event: "compile-claim-gate",
      status: claimAcceptance.status ?? claimDescriptor.admission,
      artifactId: claimAcceptance.id ?? claimDescriptor.id,
      nextAction: claimAcceptance.nextAction ?? "review-claim-preview",
    },
    {
      sequence: 3,
      event: "evaluate-provider-capabilities",
      status: providerService.capabilityNegotiation?.decision ?? "unknown",
      artifactId: providerService.id,
      nextAction: providerHealth.nextAction ?? providerService.externalHandoff?.nextAction ?? "review-provider-handoff",
    },
    {
      sequence: 4,
      event: "evaluate-lifecycle-release",
      status: releaseGate.state ?? "unknown",
      artifactId: releaseGate.id ?? lifecycle.stateId ?? null,
      nextAction: releaseGate.nextAction ?? lifecycle.nextAction?.action ?? "prepare-manual-release",
    },
    {
      sequence: 5,
      event: "evaluate-release-acceptance",
      status: releaseAcceptance.state ?? "unknown",
      artifactId: releaseAcceptance.id ?? null,
      nextAction: releaseAcceptance.nextAction ?? "review-release-acceptance",
    },
    {
      sequence: 6,
      event: "publish-acceptance-contract",
      status: acceptanceContract.status,
      artifactId: acceptanceContract.id,
      nextAction: acceptanceContract.acceptAction,
    },
  ];
  const jobRows = jobs.map((job, index) => ({
    sequence: index + 1,
    jobId: job.id,
    operation: job.operation,
    adapter: job.adapter,
    descriptorId: job.descriptorId,
    permissionDecision: job.permissions.decision,
    adapterStatusState: job.adapterStatusHandoff.state,
    clientVisibleStatus: job.clientOperationState?.visibleStatus ?? job.statusProjection.clientVisibleStatus,
    nextAction: job.clientOperationState?.nextAction ?? job.statusProjection.restartAction,
    checkpointKey: job.stateContract?.checkpointKey ?? null,
    ledgerKey: job.statusProjection.ledgerKey ?? null,
    replayCursor: job.recovery.replayCursor,
    adapterStatusResumeCursor: job.recovery.adapterStatusResumeCursor,
    adapterStatusDefaultFixtureId: job.adapterStatusHandoff.dryRunFixtures?.defaultFixtureId ?? null,
    adapterStatusFixtureCount: job.adapterStatusHandoff.dryRunFixtures?.fixtureCount ?? 0,
    requiredCapabilities: job.capabilities.map((capability) => capability.name),
  }));
  const counters = {
    jobsTotal: jobs.length,
    jobsReady: readyJobs.length,
    jobsNeedingApproval: approvalJobs.length,
    jobsDenied: blockedJobs.length,
    writeLikeJobs: writeLikeJobs.length,
    adapterStatusBlockedJobs: adapterBlockedJobs.length,
    issuesTotal: issues.length,
    issueErrors: issueCounts.error ?? 0,
    issueWarnings: issueCounts.warning ?? 0,
    readinessChecks: readinessSummary.checks?.length ?? 0,
    readinessBlockedChecks: readinessSummary.checks?.filter((check) => ["blocked", "disabled"].includes(check.status)).length ?? 0,
    providerHealthChecks: providerHealth.checks?.length ?? 0,
    providerActionableErrors: providerHealth.actionableErrors?.length ?? 0,
    claimPendingFacts: claimReporting.exportSummary?.pendingFacts?.length ?? claimDescriptor.truthBoundary.unverifiedFacts.length,
    claimHistorySnapshots: claimReporting.exportSummary?.historySnapshotIds?.length ?? 0,
    claimExportReady: claimExportPacket.exportReady === true || claimExportPacket.ready === true ? 1 : 0,
    claimExportArtifacts: claimExportPacket.counters?.artifacts ?? claimExportPacket.artifacts?.length ?? 0,
    claimExportBlockedArtifacts: claimExportPacket.counters?.blockedArtifacts
      ?? claimExportPacket.exportSummary?.blockerArtifactNames?.length
      ?? 0,
    packagePreviewRequiredInputs: packagePreview.acceptance?.requiredInputs?.filter((input) => input.required).length ?? 0,
    releaseAcceptanceRequiredInputs: releaseAcceptance.requiredInputs?.filter((input) => input.required).length ?? 0,
    releaseAcceptanceBlockedOperations: releaseAcceptance.clientPatch?.releaseAcceptanceBlockedOperationIds?.length ?? 0,
    releaseAcceptanceReviewOperations: releaseAcceptance.clientPatch?.releaseAcceptanceReviewOperationIds?.length ?? 0,
    acceptanceRequiredInputs: acceptanceContract.requiredInputs.filter((input) => input.required).length,
    lifecycleCommands: lifecycle.commands?.length ?? 0,
    restartReplayManifests: restartProjection.replayManifestIds?.length ?? 0,
  };
  const exportSummary = {
    format: "aios.mailchimp.executor-plan.v1",
    planId,
    product: "mailchimp",
    packageId: packageDescriptor.id,
    claimGateId: claimDescriptor.id,
    tenantId: tenantContext.tenantId,
    workspaceId: tenantContext.workspaceId,
    readinessStatus: readinessSummary.status,
    acceptanceStatus: acceptanceContract.status,
    canAccept: acceptanceContract.canAccept,
    providerState: providerService.externalHandoff?.state ?? "unknown",
    providerHealthStatus: providerHealth.status ?? "unknown",
    lifecycleReleaseGateState: releaseGate.state ?? "unknown",
    lifecycleReleaseAcceptanceState: releaseAcceptance.state ?? "unknown",
    lifecycleReleaseAcceptanceReady: releaseAcceptance.ready === true,
    claimExportStatus: claimExportPacket.state ?? claimExportPacket.exportSummary?.status ?? "unknown",
    claimExportReady: claimExportPacket.exportReady === true || claimExportPacket.ready === true,
    claimExportDigest: claimExportPacket.digest ?? claimExportPacket.exportSummary?.digest ?? null,
    counters,
    byIssueSeverity: issueCounts,
    byPermissionDecision: permissionCounts,
    byAdapterStatusState: adapterStatusCounts,
    byOperation: operationCounts,
    nextAction: acceptanceContract.canAccept
      ? acceptanceContract.acceptAction
      : readinessSummary.nextAction ?? providerHealth.nextAction ?? "review-executor-plan",
    historySnapshotIds: history.map((entry) => entry.id),
    claimExport: claimExportPacket.exportSummary ?? claimExportPacket.summary ?? null,
  };
  return {
    id: stableId("planreport", [
      planId,
      exportSummary.readinessStatus,
      exportSummary.acceptanceStatus,
      exportSummary.providerState,
    ]),
    product: "mailchimp",
    generatedBy: "executor-plan",
    counters,
    byIssueSeverity: issueCounts,
    byPermissionDecision: permissionCounts,
    byAdapterStatusState: adapterStatusCounts,
    byOperation: operationCounts,
    history,
    timeline,
    jobRows,
    exportSummary,
  };
}

export function createExecutorPlan(input, options = {}) {
  const packageCompilation = compilePackageManifest(input.packageManifest ?? input.manifest ?? {}, options.packageOptions);
  const claimCompilation = compileClaimGate(input.claimGate ?? input.gate ?? {}, options.claimOptions);
  const packageDescriptor = packageCompilation.descriptor;
  const claimDescriptor = claimCompilation.descriptor;
  const tenantContext = normalizeTenantContext(options.tenantContext ?? input.tenantContext, claimDescriptor);
  const jobs = packageDescriptor.operations.map((operation, index) => (
    buildJob(operation, packageDescriptor, claimDescriptor, tenantContext, index)
  ));
  const issues = collectPlanIssues(packageCompilation, claimCompilation, jobs);
  const blocked = issues.some((issue) => issue.severity === "error") || claimDescriptor.admission === "blocked";
  const providerService = buildProviderServiceContract(packageDescriptor, claimDescriptor, tenantContext, jobs);
  const planId = stableId("plan", [packageDescriptor.id, claimDescriptor.id, jobs.map((job) => job.id).join(",")]);
  const readinessSummary = buildReadinessSummary(packageDescriptor, claimDescriptor, jobs, providerService, issues);
  const acceptanceContract = buildAcceptanceContract(
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    providerService,
    readinessSummary,
  );
  const restartProjection = buildPlanRestartProjection(jobs, claimDescriptor, packageDescriptor);
  const reporting = buildPlanReportingContract({
    planId,
    packageDescriptor,
    claimDescriptor,
    tenantContext,
    jobs,
    issues,
    providerService,
    readinessSummary,
    acceptanceContract,
    restartProjection,
  });
  const clientHandoffPacket = buildClientHandoffPacket(
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    providerService,
    readinessSummary,
    acceptanceContract,
  );
  return {
    kind: "AiosExecutorPlan",
    id: planId,
    product: "mailchimp",
    status: blocked ? "blocked" : "planned",
    package: {
      id: packageDescriptor.id,
      name: packageDescriptor.name,
      version: packageDescriptor.version,
      runtimeAdapter: packageDescriptor.runtimeAdapter,
      persistence: packageDescriptor.persistence,
      lifecycleControls: packageDescriptor.lifecycleControls,
      previewContract: packageDescriptor.previewContract,
      releaseAcceptanceContract: packageDescriptor.releaseAcceptanceContract,
      providerClientHandoff: packageDescriptor.providerClientHandoff,
      validationSummary: packageDescriptor.validationSummary,
      userVisiblePreview: packageDescriptor.userVisiblePreview,
      acceptance: packageDescriptor.acceptance,
    },
    claimGate: {
      id: claimDescriptor.id,
      name: claimDescriptor.name,
      admission: claimDescriptor.admission,
      clientRuntime: claimDescriptor.clientRuntime,
      clientResumeContract: claimDescriptor.clientResumeContract,
      reporting: claimDescriptor.reporting,
      claimAcceptance: claimDescriptor.claimAcceptance,
      exportPacket: claimDescriptor.exportPacket,
      exportContract: claimDescriptor.exportContract,
      userVisiblePreview: claimDescriptor.userVisiblePreview,
      acceptance: claimDescriptor.acceptance,
    },
    tenant: tenantContext,
    jobs,
    issues,
    recovery: {
      checkpointOrder: jobs.map((job) => job.recovery.checkpoint),
      rollbackOrder: [...jobs].reverse().map((job) => ({ jobId: job.id, action: job.recovery.rollback })),
      replayOrder: jobs.map((job) => ({
        jobId: job.id,
        checkpointKey: job.stateContract?.checkpointKey,
        policy: job.recovery.replayPolicy,
        idempotencyKey: job.recovery.idempotencyKey,
        adapterStatusResumeCursor: job.recovery.adapterStatusResumeCursor,
        adapterStatusDefaultFixtureId: job.recovery.adapterStatusFixtures?.defaultFixtureId ?? null,
      })),
      adapterStatusOrder: jobs.map((job) => ({
        jobId: job.id,
        handoffId: job.adapterStatusHandoff.id,
        probe: job.adapterStatusHandoff.probe,
        statusCommandId: job.adapterStatusHandoff.commands.statusCommandId,
        resumeCursor: job.adapterStatusHandoff.recovery.resumeCursor,
        visibleStatus: job.adapterStatusHandoff.visibleStatus,
        defaultFixtureId: job.adapterStatusHandoff.dryRunFixtures?.defaultFixtureId ?? null,
        fixtureCount: job.adapterStatusHandoff.dryRunFixtures?.fixtureCount ?? 0,
      })),
      statusStates: ["planned", "needs-approval", "blocked", "admitted", "verified", "running", "replayed", "rolled-back", "completed"],
    },
    providerService,
    readinessSummary,
    acceptanceContract,
    releaseAcceptanceContract: packageDescriptor.releaseAcceptanceContract,
    clientHandoffPacket,
    restartProjection,
    reporting,
    audit: {
      generatedBy: "executor-plan",
      handoffs: jobs.map((job) => job.auditHandoff),
      tenantIsolationKey: tenantContext.isolationKey,
    },
    truthBoundaryReport: {
      generatedBy: "executor-plan",
      product: "mailchimp",
      verifiedFacts: claimDescriptor.truthBoundary.verifiedFacts,
      unverifiedFacts: claimDescriptor.truthBoundary.unverifiedFacts,
      packageReportsExternalState: packageDescriptor.truthBoundary.reportsExternalState,
      evidenceRequired: jobs.some((job) => job.truthBoundary.evidenceRequired),
    },
  };
}

export function summarizeExecutorPlan(plan) {
  return {
    id: plan.id,
    status: plan.status,
    product: plan.product,
    jobCount: plan.jobs.length,
    blockedJobs: plan.status === "blocked" ? plan.jobs.map((job) => job.id) : [],
    issueCount: plan.issues.length,
    truthBoundaryOpen: plan.truthBoundaryReport.unverifiedFacts.length > 0,
    providerServiceState: plan.providerService?.externalHandoff?.state,
    providerBlockedReason: plan.providerService?.externalHandoff?.blockedReason,
    lifecycleReleaseGateState: plan.providerService?.externalHandoff?.lifecycleGateState,
    lifecycleReleaseGateNextAction: plan.providerService?.externalHandoff?.lifecycleGateNextAction,
    lifecycleReleaseAcceptanceState: plan.releaseAcceptanceContract?.state
      ?? plan.package?.releaseAcceptanceContract?.state
      ?? plan.package?.lifecycleControls?.releaseAcceptance?.state,
    lifecycleReleaseAcceptanceReady: plan.releaseAcceptanceContract?.ready === true
      || plan.package?.releaseAcceptanceContract?.ready === true
      || plan.package?.lifecycleControls?.releaseAcceptance?.ready === true,
    lifecycleReleaseAcceptanceNextAction: plan.releaseAcceptanceContract?.nextAction
      ?? plan.package?.releaseAcceptanceContract?.nextAction
      ?? plan.package?.lifecycleControls?.releaseAcceptance?.nextAction,
    providerHealthStatus: plan.providerService?.operationalHealth?.status,
    providerHealthNextAction: plan.providerService?.operationalHealth?.nextAction,
    providerHealthErrorCodes: plan.providerService?.operationalHealth?.actionableErrors?.map((error) => error.code) ?? [],
    negotiatedCapabilities: plan.providerService?.capabilityNegotiation?.requestedCapabilities ?? [],
    readinessStatus: plan.readinessSummary?.status,
    acceptanceStatus: plan.acceptanceContract?.status,
    acceptanceVisibleStatus: plan.acceptanceContract?.clientPreview?.visibleStatus,
    reportingId: plan.reporting?.id,
    reportingNextAction: plan.reporting?.exportSummary?.nextAction,
    reportingHistorySnapshots: plan.reporting?.history?.length ?? 0,
    reportingTimelineEvents: plan.reporting?.timeline?.length ?? 0,
    reportingCounters: plan.reporting?.counters ?? {},
    claimExportStatus: plan.reporting?.exportSummary?.claimExportStatus
      ?? plan.claimGate?.exportPacket?.state
      ?? "unknown",
    claimExportReady: plan.reporting?.exportSummary?.claimExportReady === true
      || plan.claimGate?.exportPacket?.exportReady === true,
    claimExportDigest: plan.reporting?.exportSummary?.claimExportDigest
      ?? plan.claimGate?.exportPacket?.digest
      ?? null,
    claimAcceptanceStatus: plan.claimGate?.claimAcceptance?.status,
    claimAcceptanceVisibleStatus: plan.claimGate?.claimAcceptance?.visibleStatus,
    claimAcceptanceNextAction: plan.claimGate?.claimAcceptance?.nextAction,
    packagePreviewStatus: plan.package?.previewContract?.status,
    packagePreviewVisibleStatus: plan.package?.previewContract?.visibleStatus,
    packagePreviewNextAction: plan.package?.previewContract?.nextAction,
    clientHandoffState: plan.clientHandoffPacket?.state,
    clientHandoffVisibleStatus: plan.clientHandoffPacket?.visibleStatus,
    clientHandoffNextAction: plan.clientHandoffPacket?.nextAction,
    clientHandoffCommandCount: plan.clientHandoffPacket?.commands?.length ?? 0,
  };
}
