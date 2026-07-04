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

function buildRestartRecoveryMatrix(jobs, claimDescriptor, packageDescriptor, restartProjection) {
  const claimState = claimDescriptor.requestState ?? {};
  const packageCommandLog = packageDescriptor.persistence?.commandLog ?? {};
  const rows = jobs.map((job, index) => {
    const replayManifest = job.stateContract?.replayManifest ?? {};
    const commandRows = replayManifest.commandRows ?? [];
    const statusRows = replayManifest.statusRows ?? [];
    const currentStatus = job.statusProjection?.current ?? "planned";
    const currentStatusRow = statusRows.find((row) => row.status === currentStatus)
      ?? statusRows.find((row) => row.status === "checkpointed")
      ?? null;
    const nextCommand = commandRows.find((command) => command.commandId === currentStatusRow?.nextCommandId)
      ?? commandRows.find((command) => command.statusBefore === currentStatus)
      ?? null;
    const adapterHandoff = job.adapterStatusHandoff ?? {};
    const blockedByClaim = claimState.status === "needs-evidence";
    const denied = job.permissions?.decision === "deny";
    const waitingForApproval = job.permissions?.decision === "needs-approval"
      || adapterHandoff.state === "waiting-for-approval";
    const missingStatusCursor = !adapterHandoff.recovery?.resumeCursor;
    const missingCommandLedger = !job.stateContract?.commandState?.ledgerKey;
    const restartUnsafe = job.statusProjection?.restartSafe !== true
      || replayManifest.restartSafe === false
      || missingStatusCursor
      || missingCommandLedger;
    const recoveryState = blockedByClaim || denied || restartUnsafe
      ? "blocked"
      : waitingForApproval
        ? "waiting"
        : currentStatusRow?.terminal === true
          ? "terminal"
          : "replayable";
    const nextAction = blockedByClaim
      ? "resume-claim-gate"
      : denied
        ? "repair-tenant-permission"
        : missingCommandLedger
          ? "repair-command-ledger"
          : missingStatusCursor
            ? "repair-adapter-status-cursor"
            : waitingForApproval
              ? "resume-approval"
              : nextCommand?.replayAction ?? "reload-status-ledger";
    const restartKey = stableId("recoveryrow", [
      job.id,
      replayManifest.id,
      currentStatus,
      recoveryState,
      nextAction,
      adapterHandoff.recovery?.resumeCursor,
    ]);
    return {
      sequence: index + 1,
      jobId: job.id,
      operation: job.operation,
      descriptorId: job.descriptorId,
      recoveryState,
      currentStatus,
      visibleStatus: currentStatusRow?.visibleStatus ?? job.statusProjection?.clientVisibleStatus ?? currentStatus,
      restartKey,
      restartSafe: recoveryState !== "blocked" && restartUnsafe === false,
      blockedReasons: [
        ...(blockedByClaim ? ["claim-evidence-required"] : []),
        ...(denied ? ["tenant-permission-denied"] : []),
        ...(missingCommandLedger ? ["command-ledger-missing"] : []),
        ...(missingStatusCursor ? ["adapter-status-cursor-missing"] : []),
        ...(job.statusProjection?.restartSafe !== true ? ["status-projection-not-restart-safe"] : []),
        ...(replayManifest.restartSafe === false ? ["replay-manifest-not-restart-safe"] : []),
      ],
      waitingReasons: [
        ...(waitingForApproval ? ["approval-required"] : []),
        ...(adapterHandoff.state === "waiting-for-approval" ? ["adapter-status-waiting-for-approval"] : []),
      ],
      nextAction,
      checkpointKey: job.stateContract?.checkpointKey ?? null,
      commandLedgerKey: job.stateContract?.commandState?.ledgerKey ?? null,
      operationStatusLedgerId: job.statusProjection?.operationStatusLedgerId ?? null,
      replayManifestId: replayManifest.id ?? null,
      replayCursor: job.recovery?.replayCursor ?? null,
      adapterStatusResumeCursor: adapterHandoff.recovery?.resumeCursor ?? null,
      idempotencyKey: job.recovery?.idempotencyKey ?? null,
      nextCommand: nextCommand ? {
        commandId: nextCommand.commandId,
        commandType: nextCommand.commandType,
        replayAction: nextCommand.replayAction,
        idempotencyKey: nextCommand.idempotencyKey,
        conflict: nextCommand.conflict,
      } : null,
    };
  });
  const blockedRows = rows.filter((row) => row.recoveryState === "blocked");
  const waitingRows = rows.filter((row) => row.recoveryState === "waiting");
  const replayableRows = rows.filter((row) => row.recoveryState === "replayable");
  const terminalRows = rows.filter((row) => row.recoveryState === "terminal");
  const matrixState = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : "replayable";
  const commands = [
    {
      id: stableId("recoverycmd", [
        packageDescriptor.id,
        claimDescriptor.id,
        matrixState,
        rows.map((row) => row.restartKey).join(","),
      ]),
      type: "persist-restart-recovery-matrix",
      idempotencyKey: stableId("idem", [
        packageDescriptor.id,
        claimDescriptor.id,
        "restart-recovery-matrix",
        restartProjection.replayCursor,
      ]),
      statusAfterReplay: matrixState,
      writes: ["recoveryRows", "resumeCursors", "nextAction", "restartSafe"],
      conflict: "return-existing",
    },
    ...(blockedRows.length > 0 ? [{
      id: stableId("recoverycmd", [
        packageDescriptor.id,
        claimDescriptor.id,
        "hold-blocked-recovery",
        blockedRows.map((row) => row.jobId).join(","),
      ]),
      type: "hold-blocked-restart-recovery",
      idempotencyKey: stableId("idem", [
        packageDescriptor.id,
        claimDescriptor.id,
        "hold-blocked-recovery",
        blockedRows.map((row) => row.restartKey).join(","),
      ]),
      statusAfterReplay: "blocked",
      writes: ["blockedJobIds", "blockedReasons", "operatorNextAction"],
      conflict: "return-existing",
    }] : []),
  ];
  const recoveryLedgerRows = rows.map((row) => ({
    ledgerRowId: stableId("recoveryledgerrow", [
      row.restartKey,
      row.jobId,
      row.recoveryState,
      row.nextAction,
    ]),
    jobId: row.jobId,
    operation: row.operation,
    recoveryState: row.recoveryState,
    currentStatus: row.currentStatus,
    visibleStatus: row.visibleStatus,
    restartSafe: row.restartSafe,
    checkpointKey: row.checkpointKey,
    commandLedgerKey: row.commandLedgerKey,
    operationStatusLedgerId: row.operationStatusLedgerId,
    replayManifestId: row.replayManifestId,
    replayCursor: row.replayCursor,
    adapterStatusResumeCursor: row.adapterStatusResumeCursor,
    idempotencyKey: row.idempotencyKey,
    nextCommandId: row.nextCommand?.commandId ?? null,
    nextAction: row.nextAction,
    exportState: row.recoveryState === "blocked"
      ? "blocked"
      : row.recoveryState === "waiting"
        ? "waiting"
        : row.restartSafe
          ? "exportable"
          : "review",
    blockedReasons: row.blockedReasons,
    waitingReasons: row.waitingReasons,
  }));
  const exportableLedgerRows = recoveryLedgerRows.filter((row) => row.exportState === "exportable");
  const blockedLedgerRows = recoveryLedgerRows.filter((row) => row.exportState === "blocked");
  const waitingLedgerRows = recoveryLedgerRows.filter((row) => row.exportState === "waiting");
  const reviewLedgerRows = recoveryLedgerRows.filter((row) => row.exportState === "review");
  const exportStatus = blockedLedgerRows.length > 0
    ? "blocked"
    : waitingLedgerRows.length > 0
      ? "waiting"
      : reviewLedgerRows.length > 0
        ? "review"
        : "ready";
  const exportLedgerId = stableId("recoveryledger", [
    packageDescriptor.id,
    claimDescriptor.id,
    restartProjection.replayCursor,
    exportStatus,
    recoveryLedgerRows.map((row) => `${row.jobId}:${row.exportState}:${row.nextAction}`).join(","),
  ]);
  const exportLedgerCommand = {
    id: stableId("recoveryexportcmd", [exportLedgerId, "persist-recovery-export-ledger"]),
    type: "persist-restart-recovery-export-ledger",
    idempotencyKey: stableId("idem", [exportLedgerId, "persist-recovery-export-ledger"]),
    statusAfterReplay: exportStatus,
    writes: ["recoveryLedgerRows", "exportStatus", "resumeCursors", "blockedReasons"],
    conflict: "return-existing",
  };
  const exportLedger = {
    protocol: "aios.mailchimp.restart-recovery-export-ledger.v1",
    id: exportLedgerId,
    product: "mailchimp",
    state: exportStatus,
    exportReady: exportStatus === "ready",
    restartSafe: exportStatus !== "blocked" && recoveryLedgerRows.every((row) => row.restartSafe),
    replayCursor: restartProjection.replayCursor,
    claimStateKey: claimState.key ?? null,
    packageCommandLogId: packageCommandLog.id ?? restartProjection.packageCommandLogId ?? null,
    latestStatusLedgerIds: [...new Set(recoveryLedgerRows
      .map((row) => row.operationStatusLedgerId)
      .filter(Boolean))].sort(),
    resumeCursors: [...new Set(recoveryLedgerRows
      .map((row) => row.adapterStatusResumeCursor)
      .filter(Boolean))].sort(),
    idempotencyKeys: [...new Set(recoveryLedgerRows
      .map((row) => row.idempotencyKey)
      .filter(Boolean))].sort(),
    rows: recoveryLedgerRows,
    commands: [exportLedgerCommand],
    counters: {
      rows: recoveryLedgerRows.length,
      exportable: exportableLedgerRows.length,
      blocked: blockedLedgerRows.length,
      waiting: waitingLedgerRows.length,
      review: reviewLedgerRows.length,
      restartSafe: recoveryLedgerRows.filter((row) => row.restartSafe).length,
      resumeCursors: new Set(recoveryLedgerRows.map((row) => row.adapterStatusResumeCursor).filter(Boolean)).size,
      statusLedgers: new Set(recoveryLedgerRows.map((row) => row.operationStatusLedgerId).filter(Boolean)).size,
    },
    nextAction: blockedLedgerRows[0]?.nextAction
      ?? waitingLedgerRows[0]?.nextAction
      ?? reviewLedgerRows[0]?.nextAction
      ?? "publish-restart-recovery-ledger",
    restartSemantics: {
      onColdRestart: exportStatus === "ready" ? "load-restart-recovery-export-ledger" : "reload-restart-recovery-matrix",
      onDuplicateCommand: "return-existing-restart-recovery-export-ledger",
      onMissingResumeCursor: "repair-adapter-status-cursor",
      duplicateAdapterCommandPolicy: "return-existing",
      externalWritesPerformed: false,
    },
  };
  return {
    protocol: "aios.mailchimp.restart-recovery-matrix.v1",
    id: stableId("recoverymatrix", [
      packageDescriptor.id,
      claimDescriptor.id,
      restartProjection.stateVersion,
      matrixState,
      rows.map((row) => `${row.jobId}:${row.recoveryState}:${row.nextAction}`).join(","),
    ]),
    product: "mailchimp",
    state: matrixState,
    restartSafe: matrixState !== "blocked" && rows.every((row) => row.restartSafe),
    replayCursor: restartProjection.replayCursor,
    claimStateKey: claimState.key ?? null,
    packageCommandLogId: packageCommandLog.id ?? restartProjection.packageCommandLogId ?? null,
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? replayableRows[0]?.nextAction
      ?? "return-existing-terminal-state",
    rows,
    commands,
    exportLedger,
    counters: {
      rows: rows.length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      replayable: replayableRows.length,
      terminal: terminalRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      missingStatusCursors: rows.filter((row) => row.blockedReasons.includes("adapter-status-cursor-missing")).length,
      missingCommandLedgers: rows.filter((row) => row.blockedReasons.includes("command-ledger-missing")).length,
      exportLedgerRows: exportLedger.counters.rows,
      exportLedgerBlocked: exportLedger.counters.blocked,
      exportLedgerWaiting: exportLedger.counters.waiting,
      exportLedgerReady: exportLedger.exportReady ? 1 : 0,
    },
    exportSummary: {
      format: "aios.mailchimp.restart-recovery-export-summary.v1",
      ledgerId: exportLedger.id,
      state: exportLedger.state,
      exportReady: exportLedger.exportReady,
      nextAction: exportLedger.nextAction,
      blockedJobIds: blockedLedgerRows.map((row) => row.jobId),
      waitingJobIds: waitingLedgerRows.map((row) => row.jobId),
      reviewJobIds: reviewLedgerRows.map((row) => row.jobId),
      resumeCursors: exportLedger.resumeCursors,
      commandIds: exportLedger.commands.map((command) => command.id),
      externalWritesPerformed: false,
    },
    restartSemantics: {
      onColdRestart: matrixState === "blocked" ? "hold-and-repair-recovery-matrix" : "load-recovery-matrix",
      onDuplicateCommand: "return-existing-recovery-matrix",
      onStaleClaimState: "reload-claim-state-before-replay",
      onTerminalStatus: "return-existing-terminal-state",
      duplicateAdapterCommandPolicy: "return-existing",
    },
    clientPatch: {
      restartRecoveryMatrixId: stableId("recoverypatch", [packageDescriptor.id, claimDescriptor.id, matrixState]),
      restartRecoveryState: matrixState,
      restartRecoverySafe: matrixState !== "blocked" && rows.every((row) => row.restartSafe),
      restartRecoveryNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? "replay-idempotent-commands",
      blockedJobIds: blockedRows.map((row) => row.jobId),
      waitingJobIds: waitingRows.map((row) => row.jobId),
      replayableJobIds: replayableRows.map((row) => row.jobId),
      resumeCursors: [...new Set(rows.map((row) => row.adapterStatusResumeCursor).filter(Boolean))].sort(),
      restartRecoveryExportLedgerId: exportLedger.id,
      restartRecoveryExportReady: exportLedger.exportReady,
      restartRecoveryExportNextAction: exportLedger.nextAction,
    },
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

function buildJobClientRecoveryBinding(jobShell, operation, claimDescriptor, permissionEnvelope) {
  const snapshot = claimDescriptor.clientRecoverySnapshot ?? claimDescriptor.clientRecovery ?? {};
  const snapshotRows = snapshot.rows ?? [];
  const blockedRows = snapshotRows.filter((row) => row.state === "blocked");
  const waitingRows = snapshotRows.filter((row) => ["waiting", "review"].includes(row.state));
  const commandState = operation.stateContract?.commandState ?? {};
  const operationCommands = commandState.commands ?? [];
  const adapterStatus = jobShell.adapterStatusHandoff ?? {};
  const permissionBlocked = permissionEnvelope.decision === "deny";
  const approvalWaiting = permissionEnvelope.decision === "needs-approval";
  const adapterBlocked = adapterStatus.state === "blocked";
  const adapterWaiting = adapterStatus.state === "waiting-for-approval";
  const jobState = permissionBlocked || adapterBlocked || blockedRows.length > 0
    ? "blocked"
    : approvalWaiting || adapterWaiting || waitingRows.length > 0
      ? "waiting"
      : "ready";
  const recoveryRows = [
    {
      key: "claim-client-recovery",
      state: snapshot.ready === true ? "ready" : snapshot.state ?? "unknown",
      sourceId: snapshot.id ?? null,
      nextAction: snapshot.nextAction ?? "reload-claim-client-recovery",
      resumeCursor: snapshot.resumeCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
      commandIds: snapshot.commandIds ?? [],
      restartSafe: snapshot.restartSemantics?.restartSafe !== false,
    },
    {
      key: "operation-checkpoint",
      state: operation.stateContract?.checkpointKey ? "ready" : "blocked",
      sourceId: operation.stateContract?.checkpointKey ?? null,
      nextAction: operation.stateContract?.checkpointKey ? "return-existing-operation-checkpoint" : "repair-operation-checkpoint",
      resumeCursor: jobShell.recovery?.replayCursor ?? null,
      commandIds: operationCommands.map((command) => command.id),
      restartSafe: operation.stateContract?.restartSafe !== false,
    },
    {
      key: "adapter-status-handoff",
      state: adapterBlocked
        ? "blocked"
        : adapterWaiting
          ? "waiting"
          : adapterStatus.commands?.statusCommandId
            ? "ready"
            : "blocked",
      sourceId: adapterStatus.id ?? null,
      nextAction: adapterBlocked
        ? "resume-claim-or-permission-gate"
        : adapterWaiting
          ? "collect-approval"
          : adapterStatus.commands?.statusCommandId
            ? "persist-adapter-status-cursor"
            : "repair-adapter-status-command",
      resumeCursor: adapterStatus.recovery?.resumeCursor ?? null,
      commandIds: [adapterStatus.commands?.statusCommandId].filter(Boolean),
      restartSafe: Boolean(adapterStatus.recovery?.resumeCursor && adapterStatus.commands?.statusCommandId),
    },
    {
      key: "tenant-permission",
      state: permissionBlocked ? "blocked" : approvalWaiting ? "waiting" : "ready",
      sourceId: permissionEnvelope.workspacePolicy?.boundaryId ?? null,
      nextAction: permissionBlocked
        ? "repair-tenant-permission"
        : approvalWaiting
          ? "collect-tenant-approval"
          : "append-audit-before-runtime-release",
      resumeCursor: adapterStatus.recovery?.resumeCursor ?? snapshot.resumeCursor ?? null,
      commandIds: [],
      restartSafe: !permissionBlocked,
    },
  ];
  const blocked = recoveryRows.filter((row) => row.state === "blocked");
  const waiting = recoveryRows.filter((row) => ["waiting", "review"].includes(row.state));
  return {
    protocol: "aios.mailchimp.executor-job-client-recovery.v1",
    id: stableId("jobrecover", [
      jobShell.id,
      snapshot.id,
      operation.id,
      jobState,
      recoveryRows.map((row) => `${row.key}:${row.state}:${row.sourceId}`).join(","),
    ]),
    product: "mailchimp",
    jobId: jobShell.id,
    operation: operation.operation,
    state: jobState,
    ready: jobState === "ready",
    sourceSnapshotId: snapshot.id ?? null,
    clientStateKey: claimDescriptor.requestState?.key ?? claimDescriptor.clientRuntime?.clientStateKey ?? null,
    continuationToken: claimDescriptor.clientRuntime?.continuationToken ?? null,
    resumeCursor: stableId("jobrecovercursor", [
      jobShell.id,
      snapshot.resumeCursor,
      adapterStatus.recovery?.resumeCursor,
      jobShell.recovery?.replayCursor,
    ]),
    rows: recoveryRows,
    blockedKeys: blocked.map((row) => row.key),
    waitingKeys: waiting.map((row) => row.key),
    commandIds: [...new Set(recoveryRows.flatMap((row) => row.commandIds))].sort(),
    resumeCursors: [...new Set(recoveryRows.map((row) => row.resumeCursor).filter(Boolean))].sort(),
    nextAction: blocked[0]?.nextAction ?? waiting[0]?.nextAction ?? "release-client-operation",
    clientPatch: {
      jobClientRecoveryId: stableId("jobrecoverpatch", [jobShell.id, jobState]),
      jobClientRecoveryState: jobState,
      jobClientRecoveryReady: jobState === "ready",
      jobClientRecoveryNextAction: blocked[0]?.nextAction ?? waiting[0]?.nextAction ?? "release-client-operation",
      jobClientRecoveryBlockedKeys: blocked.map((row) => row.key),
      jobClientRecoveryWaitingKeys: waiting.map((row) => row.key),
      jobClientRecoveryResumeCursor: adapterStatus.recovery?.resumeCursor ?? snapshot.resumeCursor ?? null,
    },
    restartSemantics: {
      restartSafe: jobState !== "blocked" && recoveryRows.every((row) => row.restartSafe),
      onRestart: jobState === "ready" ? "return-existing-job-client-recovery" : "reload-job-client-recovery",
      onDuplicateCommand: "return-existing-job-client-recovery-command",
      onAdapterStatusCursorMissing: "repair-adapter-status-command",
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

function capabilityProviderName(capabilityName, syncContract) {
  if (String(capabilityName).startsWith("mailchimp.")) {
    return syncContract.provider ?? "mailchimp-marketing";
  }
  if (["external.write", "network.write"].includes(capabilityName)) {
    return "aios-external-boundary";
  }
  return "aios-runtime";
}

function classifyCapabilityUse(capabilityName) {
  if (capabilityName.endsWith(".send")) return "campaign-send";
  if (capabilityName.includes("segment.write")) return "segment-write";
  if (capabilityName.endsWith(".write") || ["external.write", "network.write"].includes(capabilityName)) {
    return "external-write";
  }
  if (capabilityName.endsWith(".read")) return "external-read";
  if (capabilityName.includes("status")) return "status-probe";
  return "runtime";
}

function buildProviderCapabilityReplayContract(input) {
  const {
    packageDescriptor,
    claimDescriptor,
    tenantContext,
    jobs,
    syncContract,
    negotiatedCapabilities,
    missingWorkspaceCapabilities,
    externalHandoffState,
    permissionHandoffState,
    lifecycleHandoffState,
  } = input;
  const requiredProviderCapabilities = syncContract.requiredProviderCapabilities ?? [];
  const missingSet = new Set(missingWorkspaceCapabilities);
  const capabilityRows = [...new Set([
    ...negotiatedCapabilities,
    ...requiredProviderCapabilities,
  ])].sort().map((capabilityName, index) => {
    const provider = capabilityProviderName(capabilityName, syncContract);
    const usedByJobs = jobs
      .filter((job) => job.capabilities.some((capability) => capability.name === capabilityName))
      .map((job) => job.id)
      .sort();
    const requiredBySync = requiredProviderCapabilities.includes(capabilityName);
    const missing = missingSet.has(capabilityName);
    const grantState = missing
      ? "missing-workspace-grant"
      : externalHandoffState === "blocked"
        ? "held"
        : permissionHandoffState === "waiting-for-approval"
          ? "waiting-for-approval"
          : lifecycleHandoffState === "scheduled"
            ? "scheduled"
            : "granted";
    return {
      sequence: index + 1,
      capability: capabilityName,
      provider,
      use: classifyCapabilityUse(capabilityName),
      grantState,
      requiredBySync,
      usedByJobIds: usedByJobs,
      persistKey: stableId("capgrantkey", [
        tenantContext.tenantId,
        tenantContext.workspaceId,
        provider,
        capabilityName,
      ]),
      replayAction: missing
        ? "repair-workspace-capability-policy"
        : grantState === "granted"
          ? "return-existing-grant"
          : "persist-held-provider-grant",
      restartSafe: !missing,
    };
  });
  const grantRows = capabilityRows.filter((row) => row.grantState === "granted");
  const heldRows = capabilityRows.filter((row) => row.grantState !== "granted" && row.grantState !== "missing-workspace-grant");
  const missingRows = capabilityRows.filter((row) => row.grantState === "missing-workspace-grant");
  const state = missingRows.length > 0 || externalHandoffState === "blocked"
    ? "blocked"
    : heldRows.length > 0
      ? "waiting"
      : "ready";
  const commandScope = [
    packageDescriptor.id,
    claimDescriptor.id,
    tenantContext.isolationKey,
    syncContract.id,
    state,
  ];
  const commands = [
    {
      id: stableId("providercmd", [...commandScope, "persist-capability-ledger"]),
      type: "persist-provider-capability-ledger",
      idempotencyKey: stableId("idem", [...commandScope, "persist-capability-ledger"]),
      statusAfterReplay: state,
      writes: ["capabilityRows", "grantStates", "handoffState", "syncCursor"],
      conflict: "return-existing",
    },
    ...(missingRows.length > 0 ? [{
      id: stableId("providercmd", [...commandScope, "raise-capability-repair"]),
      type: "raise-provider-capability-repair",
      idempotencyKey: stableId("idem", [...commandScope, "raise-capability-repair", missingRows.map((row) => row.capability).join(",")]),
      statusAfterReplay: "blocked",
      writes: ["missingCapabilities", "requiredWorkspacePolicyActions"],
      conflict: "return-existing",
    }] : []),
    ...(heldRows.length > 0 ? [{
      id: stableId("providercmd", [...commandScope, "persist-held-grants"]),
      type: "persist-held-provider-grants",
      idempotencyKey: stableId("idem", [...commandScope, "persist-held-grants", heldRows.map((row) => row.capability).join(",")]),
      statusAfterReplay: "waiting",
      writes: ["heldCapabilityRows", "resumeCursor", "nextAction"],
      conflict: "return-existing",
    }] : []),
  ];
  const resumeCursor = stableId("providercursor", [
    packageDescriptor.id,
    claimDescriptor.requestState?.resumeCursor,
    syncContract.cursor?.checkpointKey,
    capabilityRows.map((row) => `${row.capability}:${row.grantState}`).join(","),
  ]);
  return {
    id: stableId("providercaps", [
      ...commandScope,
      capabilityRows.map((row) => `${row.capability}:${row.grantState}`).join(","),
    ]),
    protocol: "aios.mailchimp.provider-capability-replay.v1",
    product: "mailchimp",
    state,
    ready: state === "ready",
    tenantId: tenantContext.tenantId,
    workspaceId: tenantContext.workspaceId,
    syncContractId: syncContract.id ?? null,
    syncCursorKey: syncContract.cursor?.checkpointKey ?? null,
    resumeCursor,
    capabilityRows,
    grantRows: grantRows.map((row) => row.capability),
    heldRows: heldRows.map((row) => row.capability),
    missingRows: missingRows.map((row) => row.capability),
    commands,
    restartSemantics: {
      restartSafe: missingRows.length === 0,
      onRestart: state === "ready" ? "return-existing-provider-grants" : "reload-provider-capability-ledger",
      onDuplicateCommand: "return-existing-provider-grant-ledger",
      onMissingWorkspaceGrant: "hold-before-adapter-handoff",
    },
    nextAction: missingRows.length > 0
      ? "repair-workspace-capability-policy"
      : heldRows.length > 0
        ? "resume-provider-capability-negotiation"
        : "persist-provider-handoff",
  };
}

function buildJobBoundaryHealthEnvelope(jobId, operation, packageDescriptor, claimDescriptor, tenantContext, permissionEnvelope, adapterStatusHandoff) {
  const manifestBoundary = packageDescriptor.tenantCapabilityBoundary ?? {};
  const permissionReplayLedger = packageDescriptor.tenantPermissionReplayLedger ?? {};
  const claimBoundary = claimDescriptor.boundaryRecoveryLedger ?? claimDescriptor.boundaryRecovery ?? {};
  const workspaceRow = manifestBoundary.workspaceRows?.find((row) => row.workspaceId === tenantContext.workspaceId)
    ?? manifestBoundary.workspaceRows?.find((row) => row.workspaceId === manifestBoundary.defaultWorkspaceId)
    ?? null;
  const permissionRows = permissionReplayLedger.permissionRows ?? [];
  const ledgerPermissionRow = permissionRows.find((row) => (
    row.workspaceId === tenantContext.workspaceId
      && row.role === tenantContext.actorRole
      && (row.writeOperationIds ?? []).includes(operation.id)
  )) ?? permissionRows.find((row) => (
    row.workspaceId === tenantContext.workspaceId
      && row.role === tenantContext.actorRole
  )) ?? null;
  const requestedCapabilities = operation.capabilityNames ?? [];
  const manifestCapabilityRows = manifestBoundary.capabilityRows ?? [];
  const operationCapabilityRows = manifestCapabilityRows.filter((row) => (
    requestedCapabilities.includes(row.capability)
      || row.requestedByOperationIds?.includes(operation.id)
      || row.requestedByOperationIds?.includes(operation.descriptorId)
  ));
  const blockedCapabilities = operationCapabilityRows
    .filter((row) => row.state === "blocked")
    .map((row) => row.capability)
    .sort();
  const approvalCapabilities = operationCapabilityRows
    .filter((row) => row.state === "approval-required")
    .map((row) => row.capability)
    .sort();
  const claimBlockedKeys = claimBoundary.blockedKeys ?? claimBoundary.clientPatch?.claimBoundaryRecoveryBlockedKeys ?? [];
  const claimWaitingKeys = claimBoundary.waitingKeys ?? claimBoundary.clientPatch?.claimBoundaryRecoveryWaitingKeys ?? [];
  const missingWorkspacePolicy = !workspaceRow && Boolean(manifestBoundary.id);
  const missingPermissionReplayRow = Boolean(permissionReplayLedger.id) && !ledgerPermissionRow;
  const adapterBlocked = adapterStatusHandoff.state === "blocked";
  const adapterWaiting = adapterStatusHandoff.state === "waiting-for-approval";
  const permissionDenied = permissionEnvelope.decision === "deny";
  const permissionWaiting = permissionEnvelope.decision === "needs-approval";
  const permissionReplayBlocked = ledgerPermissionRow?.state === "blocked"
    || permissionReplayLedger.state === "blocked";
  const permissionReplayWaiting = ledgerPermissionRow?.state === "approval-required"
    || permissionReplayLedger.state === "approval-required";
  const permissionReplayReview = ledgerPermissionRow?.state === "review"
    || permissionReplayLedger.state === "review";
  const blockedReasons = [
    ...(permissionDenied ? permissionEnvelope.deniedReasons : []),
    ...(permissionReplayBlocked ? (ledgerPermissionRow?.blockedReasons ?? ["tenant-permission-replay-blocked"]) : []),
    ...blockedCapabilities.map((capability) => `manifest-capability-blocked:${capability}`),
    ...claimBlockedKeys.map((key) => `claim-boundary:${key}`),
    ...(missingWorkspacePolicy ? ["manifest-workspace-policy-missing"] : []),
    ...(missingPermissionReplayRow ? ["tenant-permission-replay-row-missing"] : []),
    ...(adapterBlocked ? ["adapter-status-handoff-blocked"] : []),
  ].sort();
  const waitingReasons = [
    ...(permissionWaiting ? ["tenant-approval-required"] : []),
    ...(permissionReplayWaiting ? (ledgerPermissionRow?.waitingReasons ?? ["tenant-permission-replay-waiting"]) : []),
    ...approvalCapabilities.map((capability) => `approval-required:${capability}`),
    ...claimWaitingKeys.map((key) => `claim-boundary:${key}`),
    ...(adapterWaiting ? ["adapter-status-waiting-for-approval"] : []),
  ].sort();
  const state = blockedReasons.length > 0
    ? "blocked"
    : waitingReasons.length > 0
      ? "waiting"
      : manifestBoundary.state === "review" || claimBoundary.state === "review" || permissionReplayReview
        ? "degraded"
        : "healthy";
  const retryable = blockedReasons.every((reason) => (
    reason.startsWith("claim-boundary:")
      || reason.startsWith("manifest-capability-blocked:")
      || reason === "manifest-workspace-policy-missing"
      || reason === "tenant-permission-replay-row-missing"
      || reason.startsWith("role-")
  ));
  const rows = [
    {
      key: "tenant-permission",
      state: permissionDenied ? "blocked" : permissionWaiting ? "waiting" : "ready",
      sourceId: permissionEnvelope.workspacePolicy?.boundaryId ?? null,
      nextAction: permissionDenied ? "repair-tenant-permission" : permissionWaiting ? "collect-tenant-approval" : "append-audit-before-runtime-release",
      restartSafe: !permissionDenied,
    },
    {
      key: "tenant-permission-replay-ledger",
      state: missingPermissionReplayRow || permissionReplayBlocked
        ? "blocked"
        : permissionReplayWaiting
          ? "waiting"
          : permissionReplayReview
            ? "review"
            : permissionReplayLedger.id
              ? "ready"
              : "unknown",
      sourceId: permissionReplayLedger.id ?? null,
      nextAction: missingPermissionReplayRow
        ? "rebuild-tenant-permission-replay-ledger"
        : permissionReplayBlocked
          ? ledgerPermissionRow?.nextAction ?? permissionReplayLedger.nextAction ?? "repair-tenant-permission-replay-ledger"
          : permissionReplayWaiting
            ? "collect-tenant-approval"
            : permissionReplayReview
              ? "review-tenant-permission-ledger"
              : "load-tenant-permission-replay-ledger",
      restartSafe: Boolean(
        permissionReplayLedger.id
          && permissionReplayLedger.restartSemantics?.restartSafe !== false
          && ledgerPermissionRow?.restartSafe !== false
          && !missingPermissionReplayRow
          && !permissionReplayBlocked,
      ),
    },
    {
      key: "manifest-capability-boundary",
      state: blockedCapabilities.length > 0 || missingWorkspacePolicy
        ? "blocked"
        : approvalCapabilities.length > 0
          ? "waiting"
          : manifestBoundary.state ?? "ready",
      sourceId: manifestBoundary.id ?? null,
      nextAction: blockedCapabilities.length > 0 || missingWorkspacePolicy
        ? "repair-manifest-workspace-capability-policy"
        : approvalCapabilities.length > 0
          ? "collect-workspace-write-approval"
          : "persist-tenant-capability-boundary",
      restartSafe: blockedCapabilities.length === 0 && !missingWorkspacePolicy,
    },
    {
      key: "claim-boundary-recovery",
      state: claimBoundary.state ?? "unknown",
      sourceId: claimBoundary.id ?? null,
      nextAction: claimBoundary.nextAction ?? "load-claim-boundary-recovery-ledger",
      restartSafe: claimBoundary.restartSemantics?.restartSafe !== false && claimBlockedKeys.length === 0,
    },
    {
      key: "adapter-status-handoff",
      state: adapterBlocked ? "blocked" : adapterWaiting ? "waiting" : "ready",
      sourceId: adapterStatusHandoff.id,
      nextAction: adapterBlocked ? "resume-claim-or-permission-gate" : adapterWaiting ? "collect-approval" : "persist-adapter-status-cursor",
      restartSafe: Boolean(adapterStatusHandoff.recovery?.resumeCursor),
    },
  ].map((row, index) => ({
    sequence: index + 1,
    ...row,
    rowId: stableId("jobboundaryrow", [jobId, row.key, row.state, row.sourceId]),
  }));
  const envelopeId = stableId("jobboundary", [
    jobId,
    manifestBoundary.id,
    claimBoundary.id,
    state,
    blockedReasons.join(","),
    waitingReasons.join(","),
  ]);
  return {
    protocol: "aios.mailchimp.executor-job-boundary-health.v1",
    id: envelopeId,
    product: "mailchimp",
    jobId,
    operationId: operation.id,
    tenantId: tenantContext.tenantId,
    workspaceId: tenantContext.workspaceId,
    state,
    ready: state === "healthy" || state === "degraded",
    retryable,
    degradedMode: state === "degraded" ? "boundary-review-with-runtime-hold" : null,
    blockedReasons,
    waitingReasons,
    blockedCapabilities,
    approvalRequiredCapabilities: approvalCapabilities,
    tenantPermissionReplay: permissionReplayLedger.id ? {
      ledgerId: permissionReplayLedger.id,
      ledgerState: permissionReplayLedger.state,
      rowId: ledgerPermissionRow?.rowId ?? null,
      rowState: ledgerPermissionRow?.state ?? "missing",
      commandIds: permissionReplayLedger.commands?.map((command) => command.id) ?? [],
      replayCursor: permissionReplayLedger.restartSemantics?.replayCursor ?? null,
    } : null,
    workspacePolicy: workspaceRow ? {
      workspaceId: workspaceRow.workspaceId,
      isolationKey: workspaceRow.isolationKey,
      allowedCapabilities: workspaceRow.allowedCapabilities ?? [],
      allowedRoles: workspaceRow.allowedRoles ?? [],
    } : null,
    rows,
    nextAction: rows.find((row) => row.state === "blocked")?.nextAction
      ?? rows.find((row) => row.state === "waiting")?.nextAction
      ?? (state === "degraded" ? "review-boundary-health" : "release-job-boundary"),
    clientPatch: {
      jobBoundaryHealthId: envelopeId,
      jobBoundaryHealthState: state,
      jobBoundaryHealthReady: state === "healthy" || state === "degraded",
      jobBoundaryHealthNextAction: rows.find((row) => row.state === "blocked")?.nextAction
        ?? rows.find((row) => row.state === "waiting")?.nextAction
        ?? "release-job-boundary",
      jobBoundaryBlockedReasons: blockedReasons,
      jobBoundaryWaitingReasons: waitingReasons,
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && rows.every((row) => row.restartSafe !== false),
      onRestart: state === "healthy" ? "load-job-boundary-health" : "rebuild-job-boundary-health",
      onDuplicateCommand: "return-existing-job-boundary-health",
      onBoundaryMutation: "recompute-job-boundary-health",
      onTenantPermissionReplayMissing: "rebuild-tenant-permission-replay-ledger",
      externalWritesPerformed: false,
    },
  };
}

function providerScopeForCapability(capabilityName, syncContract) {
  const objectBindings = syncContract.objectBindings ?? {};
  if (capabilityName.includes("audience")) return "audience";
  if (capabilityName.includes("campaign") || capabilityName.endsWith(".send")) return "campaign";
  if (capabilityName.includes("segment")) return "segment";
  if (capabilityName.includes("template")) return "template";
  return objectBindings.audience?.listField ?? "mailchimp";
}

function providerAccessLevelForCapability(capabilityName) {
  if (capabilityName.endsWith(".send")) return "send";
  if (capabilityName.endsWith(".write") || capabilityName.includes("segment.write")) return "write";
  if (capabilityName.endsWith(".read") || capabilityName.includes("status")) return "read";
  return "runtime";
}

function buildProviderCredentialLeaseContract(input) {
  const {
    packageDescriptor,
    claimDescriptor,
    tenantContext,
    jobs,
    syncContract,
    providerCapabilityReplay,
    externalHandoffState,
    permissionHandoffState,
    lifecycleHandoffState,
  } = input;
  const capabilityRows = providerCapabilityReplay.capabilityRows ?? [];
  const providerRows = capabilityRows.filter((row) => row.provider === (syncContract.provider ?? "mailchimp-marketing"));
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const scopeRows = providerRows.map((row, index) => {
    const object = providerScopeForCapability(row.capability, syncContract);
    const access = providerAccessLevelForCapability(row.capability);
    const providerScope = `mailchimp:${object}:${access}`;
    const affectedJobs = row.usedByJobIds
      .map((jobId) => jobById.get(jobId))
      .filter(Boolean);
    const needsConsent = ["send", "write"].includes(access) || affectedJobs.some((job) => (
      job.permissions?.decision === "needs-approval"
    ));
    const credentialKey = stableId("credkey", [
      tenantContext.tenantId,
      tenantContext.workspaceId,
      row.provider,
      providerScope,
    ]);
    const leaseState = row.grantState === "missing-workspace-grant"
      ? "blocked"
      : permissionHandoffState === "waiting-for-approval" && needsConsent
        ? "waiting-for-consent"
        : row.grantState === "granted" && externalHandoffState !== "blocked"
          ? "leased"
          : "held";
    return {
      sequence: index + 1,
      capability: row.capability,
      provider: row.provider,
      providerScope,
      object,
      access,
      leaseState,
      needsConsent,
      credentialKey,
      persistKey: stableId("credlease", [credentialKey, providerCapabilityReplay.resumeCursor]),
      usedByJobIds: row.usedByJobIds,
      requiredBySync: row.requiredBySync,
      restartSafe: leaseState !== "blocked",
      nextAction: leaseState === "blocked"
        ? "repair-workspace-capability-policy"
        : leaseState === "waiting-for-consent"
          ? "collect-provider-credential-consent"
          : leaseState === "held"
            ? "persist-held-provider-credential-lease"
            : "return-existing-provider-credential-lease",
    };
  });
  const blockedRows = scopeRows.filter((row) => row.leaseState === "blocked");
  const waitingRows = scopeRows.filter((row) => row.leaseState === "waiting-for-consent");
  const heldRows = scopeRows.filter((row) => row.leaseState === "held");
  const leasedRows = scopeRows.filter((row) => row.leaseState === "leased");
  const state = blockedRows.length > 0 || externalHandoffState === "blocked"
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting-for-consent"
      : heldRows.length > 0 || lifecycleHandoffState === "scheduled"
        ? "held"
        : "ready";
  const leaseScope = [
    packageDescriptor.id,
    claimDescriptor.id,
    tenantContext.isolationKey,
    syncContract.id,
    providerCapabilityReplay.id,
    state,
  ];
  const resumeCursor = stableId("credleasecursor", [
    ...leaseScope,
    syncContract.cursor?.checkpointKey,
    scopeRows.map((row) => `${row.providerScope}:${row.leaseState}`).join(","),
  ]);
  const commands = [
    {
      id: stableId("credleasecmd", [...leaseScope, "persist-credential-lease-ledger"]),
      type: "persist-provider-credential-lease-ledger",
      idempotencyKey: stableId("idem", [...leaseScope, "persist-credential-lease-ledger"]),
      statusAfterReplay: state,
      writes: ["credentialLeaseRows", "credentialKeys", "providerScopes", "resumeCursor"],
      conflict: "return-existing",
    },
    ...(waitingRows.length > 0 ? [{
      id: stableId("credleasecmd", [...leaseScope, "request-provider-consent"]),
      type: "request-provider-credential-consent",
      idempotencyKey: stableId("idem", [
        ...leaseScope,
        "request-provider-consent",
        waitingRows.map((row) => row.providerScope).join(","),
      ]),
      statusAfterReplay: "waiting-for-consent",
      writes: ["providerScopes", "consentJobIds", "operatorNextAction"],
      conflict: "return-existing",
    }] : []),
    ...(blockedRows.length > 0 ? [{
      id: stableId("credleasecmd", [...leaseScope, "hold-missing-credential-scopes"]),
      type: "hold-missing-provider-credential-scopes",
      idempotencyKey: stableId("idem", [
        ...leaseScope,
        "hold-missing-credential-scopes",
        blockedRows.map((row) => row.providerScope).join(","),
      ]),
      statusAfterReplay: "blocked",
      writes: ["blockedCredentialScopes", "missingWorkspaceCapabilities", "resumeCursor"],
      conflict: "return-existing",
    }] : []),
  ];
  return {
    id: stableId("credlease", [
      ...leaseScope,
      scopeRows.map((row) => `${row.providerScope}:${row.leaseState}`).join(","),
    ]),
    protocol: "aios.mailchimp.provider-credential-lease.v1",
    product: "mailchimp",
    provider: syncContract.provider ?? "mailchimp-marketing",
    state,
    ready: state === "ready",
    tenantId: tenantContext.tenantId,
    workspaceId: tenantContext.workspaceId,
    syncContractId: syncContract.id ?? null,
    providerCapabilityReplayId: providerCapabilityReplay.id,
    resumeCursor,
    scopeRows,
    leasedScopes: leasedRows.map((row) => row.providerScope),
    waitingScopes: waitingRows.map((row) => row.providerScope),
    heldScopes: heldRows.map((row) => row.providerScope),
    blockedScopes: blockedRows.map((row) => row.providerScope),
    credentialKeys: [...new Set(scopeRows.map((row) => row.credentialKey))].sort(),
    commands,
    restartSemantics: {
      restartSafe: blockedRows.length === 0,
      onRestart: state === "ready" ? "return-existing-provider-credential-leases" : "reload-provider-credential-lease-ledger",
      onDuplicateCommand: "return-existing-provider-credential-lease-command",
      onConsentRequired: "resume-provider-credential-consent",
      externalTokensPersisted: false,
    },
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? heldRows[0]?.nextAction
      ?? "persist-provider-credential-leases",
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
    lifecycleOperatorOverride = {},
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
      status: ["disabled", "blocked", "held", "operator-held"].includes(lifecycleHandoffState)
        ? "blocked"
        : lifecycleHandoffState === "review" || lifecycleHandoffState === "scheduled" || lifecycleHandoffState === "waiting"
          ? "degraded"
          : "ready",
      detail: releaseGate.id
        ? lifecycleOperatorOverride.affectsRuntimeHandoff === true
          ? `Lifecycle operator override ${lifecycleOperatorOverride.id} is ${lifecycleOperatorOverride.state}.`
          : `Lifecycle release gate ${releaseGate.id} is ${releaseGate.state}.`
        : `Lifecycle provider handoff state is ${lifecycleHandoffState}.`,
      nextAction: ["held", "operator-held"].includes(lifecycleHandoffState)
        ? "resume-lifecycle-operator-override"
        : releaseGate.nextAction ?? (
          lifecycleHandoffState === "ready" ? "continue-provider-handoff" : "review-lifecycle-release"
        ),
      releaseGateId: releaseGate.id ?? null,
      releaseGateState: releaseGate.state ?? lifecycleHandoffState,
      lifecycleOperatorOverrideId: lifecycleOperatorOverride.id ?? null,
      lifecycleOperatorOverrideState: lifecycleOperatorOverride.state ?? null,
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

function buildRuntimeProviderExternalHandoff(packageDescriptor, claimDescriptor, jobs, providerContext) {
  const manifestLedger = packageDescriptor.providerClientHandoff?.providerExternalHandoffLedger
    ?? packageDescriptor.providerClientHandoff?.externalHandoffLedger
    ?? packageDescriptor.clientHandoff?.providerExternalHandoffLedger
    ?? {};
  const {
    externalHandoffState,
    externalBlockedReason,
    providerOperationalHealth,
    providerCapabilityReplay,
    providerCredentialLease,
    providerIntegrationContract,
    syncContract,
    releaseGate,
  } = providerContext;
  const manifestRowsByOperationId = new Map((manifestLedger.operationRows ?? []).map((row) => [row.operationId, row]));
  const operatorOverride = packageDescriptor.lifecycleControls?.operatorOverride
    ?? packageDescriptor.lifecycleOperatorOverride
    ?? {};
  const runtimeRows = jobs.map((job, index) => {
    const manifestRow = manifestRowsByOperationId.get(job.descriptorId) ?? manifestRowsByOperationId.get(job.operation) ?? {};
    const blocked = job.permissions.decision === "deny"
      || !job.adapterStatusHandoff?.recovery?.resumeCursor
      || !job.stateContract?.commandState?.ledgerKey;
    const waiting = job.permissions.decision === "needs-approval" || externalHandoffState === "waiting-for-approval";
    const state = blocked
      ? "blocked"
      : waiting
        ? "waiting"
        : externalHandoffState === "ready"
          ? "ready"
          : externalHandoffState === "scheduled"
            ? "waiting"
            : "review";
    return {
      sequence: index + 1,
      jobId: job.id,
      operationId: job.descriptorId,
      operation: job.operation,
      adapter: job.adapter,
      state,
      permissionDecision: job.permissions.decision,
      checkpointKey: job.stateContract?.checkpointKey ?? manifestRow.checkpointKey ?? null,
      commandLedgerKey: job.stateContract?.commandState?.ledgerKey ?? manifestRow.commandLedgerKey ?? null,
      operationStatusLedgerId: job.statusProjection?.operationStatusLedgerId ?? null,
      adapterStatusHandoffId: job.adapterStatusHandoff?.id ?? null,
      adapterStatusResumeCursor: job.adapterStatusHandoff?.recovery?.resumeCursor ?? null,
      idempotencyKey: job.recovery?.idempotencyKey ?? manifestRow.idempotencyKey ?? null,
      manifestHandoffCommandId: manifestRow.handoffCommandId ?? null,
      manifestStatusCommandId: manifestRow.statusCommandId ?? null,
      lifecycleOperatorOverrideId: operatorOverride.id ?? null,
      lifecycleOperatorOverrideState: operatorOverride.state ?? "not-declared",
      nextAction: blocked
        ? (job.permissions.decision === "deny" ? "repair-tenant-permission" : "repair-provider-runtime-cursor")
        : waiting
          ? "collect-approval-before-provider-release"
          : operatorOverride.affectsRuntimeHandoff === true
            ? "resume-lifecycle-operator-override"
          : state === "ready"
            ? "release-provider-runtime-handoff"
            : "review-provider-runtime-handoff",
    };
  });
  const blockedRows = runtimeRows.filter((row) => row.state === "blocked");
  const waitingRows = runtimeRows.filter((row) => row.state === "waiting");
  const reviewRows = runtimeRows.filter((row) => row.state === "review");
  const state = blockedRows.length > 0 || externalHandoffState === "blocked"
    ? "blocked"
    : waitingRows.length > 0 || externalHandoffState === "scheduled"
      ? "waiting"
      : reviewRows.length > 0
        ? "review"
        : "ready";
  const scope = [
    packageDescriptor.id,
    claimDescriptor.id,
    manifestLedger.id,
    providerOperationalHealth.id,
    providerCapabilityReplay.id,
    providerCredentialLease.id,
    state,
    runtimeRows.map((row) => `${row.jobId}:${row.state}:${row.adapterStatusResumeCursor}`).join(","),
  ];
  const resumeCursor = stableId("runtimeproviderhandoffcursor", scope);
  const command = {
    id: stableId("runtimeproviderhandoffcmd", [...scope, "persist-runtime-provider-handoff"]),
    type: "persist-runtime-provider-external-handoff",
    idempotencyKey: stableId("idem", [...scope, "persist-runtime-provider-handoff"]),
    statusAfterReplay: state,
    writes: ["runtimeProviderHandoffRows", "resumeCursor", "providerHealthId", "nextAction"],
    conflict: "return-existing",
  };
  return {
    protocol: "aios.mailchimp.runtime-provider-external-handoff.v1",
    id: stableId("runtimeproviderhandoff", scope),
    product: "mailchimp",
    state,
    ready: state === "ready",
    sourceLedgerId: manifestLedger.id ?? null,
    sourceLedgerState: manifestLedger.state ?? "unknown",
    providerIntegrationContractId: providerIntegrationContract.id ?? null,
    syncContractId: syncContract.id ?? null,
    syncCursorKey: syncContract.cursor?.checkpointKey ?? manifestLedger.cursor?.checkpointKey ?? null,
    lifecycleGateId: releaseGate.id ?? null,
    lifecycleGateState: releaseGate.state ?? "unknown",
    lifecycleOperatorOverride: operatorOverride.id ? {
      id: operatorOverride.id,
      state: operatorOverride.state,
      requestedCommand: operatorOverride.requestedCommand,
      nextAction: operatorOverride.nextAction,
      affectsRuntimeHandoff: operatorOverride.affectsRuntimeHandoff === true,
    } : null,
    blockedReason: blockedRows[0]?.nextAction ? externalBlockedReason : externalBlockedReason ?? null,
    resumeCursor,
    rows: runtimeRows,
    capabilityReplay: {
      id: providerCapabilityReplay.id,
      state: providerCapabilityReplay.state,
      ready: providerCapabilityReplay.ready === true,
      resumeCursor: providerCapabilityReplay.resumeCursor,
    },
    credentialLease: {
      id: providerCredentialLease.id,
      state: providerCredentialLease.state,
      ready: providerCredentialLease.ready === true,
      resumeCursor: providerCredentialLease.resumeCursor,
    },
    health: {
      id: providerOperationalHealth.id,
      status: providerOperationalHealth.status,
      nextAction: providerOperationalHealth.nextAction,
    },
    command,
    validationSummary: {
      blockedJobIds: blockedRows.map((row) => row.jobId),
      waitingJobIds: waitingRows.map((row) => row.jobId),
      reviewJobIds: reviewRows.map((row) => row.jobId),
      missingResumeCursorJobIds: runtimeRows
        .filter((row) => !row.adapterStatusResumeCursor)
        .map((row) => row.jobId),
      deniedJobIds: runtimeRows
        .filter((row) => row.permissionDecision === "deny")
        .map((row) => row.jobId),
    },
    clientPatch: {
      runtimeProviderHandoffId: stableId("runtimeproviderhandoffpatch", [packageDescriptor.id, claimDescriptor.id, state]),
      runtimeProviderHandoffState: state,
      runtimeProviderHandoffReady: state === "ready",
      runtimeProviderHandoffNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? "release-provider-runtime-handoff",
      runtimeProviderHandoffResumeCursor: resumeCursor,
      runtimeProviderHandoffBlockedJobIds: blockedRows.map((row) => row.jobId),
      runtimeProviderHandoffWaitingJobIds: waitingRows.map((row) => row.jobId),
    },
    restartSemantics: {
      restartSafe: state !== "blocked"
        && runtimeRows.every((row) => row.adapterStatusResumeCursor && row.idempotencyKey),
      onColdRestart: state === "ready" ? "load-runtime-provider-handoff" : "reload-provider-service-state",
      onDuplicateCommand: "return-existing-runtime-provider-handoff",
      onMissingResumeCursor: "repair-provider-runtime-cursor",
      externalWritesPerformed: false,
    },
  };
}

function buildProviderServiceContract(packageDescriptor, claimDescriptor, tenantContext, jobs) {
  const lifecycle = packageDescriptor.lifecycleControls ?? {};
  const releaseGate = lifecycle.releaseGate ?? {};
  const operatorOverride = lifecycle.operatorOverride
    ?? packageDescriptor.lifecycleOperatorOverride
    ?? packageDescriptor.acceptance?.lifecycleOperatorOverride
    ?? {};
  const releaseAcceptance = lifecycle.releaseAcceptance ?? packageDescriptor.releaseAcceptanceContract ?? {};
  const operatorReleaseChecklist = lifecycle.operatorReleaseChecklist ?? packageDescriptor.operatorReleaseChecklist ?? {};
  const lifecycleCommandDispatch = lifecycle.commandDispatch
    ?? packageDescriptor.lifecycleCommandDispatch
    ?? {};
  const packagePreview = packageDescriptor.previewContract ?? {};
  const packageAnalytics = packageDescriptor.packageAnalyticsExport ?? packageDescriptor.analyticsExport ?? {};
  const claimAcceptance = claimDescriptor.claimAcceptance ?? {};
  const claimReporting = claimDescriptor.reporting ?? {};
  const claimExportPacket = claimDescriptor.exportPacket ?? claimDescriptor.exportContract ?? {};
  const syncContract = packageDescriptor.syncServiceContract ?? {};
  const syncMetadata = packageDescriptor.syncMetadata ?? {};
  const providerIntegrationContract = packageDescriptor.providerIntegrationContract
    ?? packageDescriptor.lifecycleControls?.providerIntegration
    ?? {};
  const providerSyncAcceptance = packageDescriptor.providerSyncAcceptanceContract
    ?? packageDescriptor.lifecycleControls?.providerSyncAcceptance
    ?? packageDescriptor.acceptance?.providerSyncAcceptance
    ?? {};
  const providerReadinessExport = packageDescriptor.providerReadinessExport
    ?? packageDescriptor.lifecycleControls?.providerReadinessExport
    ?? packageDescriptor.acceptance?.providerReadinessExport
    ?? {};
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
  const overrideHandoffState = operatorOverride.affectsRuntimeHandoff === true
    ? operatorOverride.state === "held"
      ? "operator-held"
      : operatorOverride.state
    : "ready";
  const lifecycleHandoffState = ["held", "blocked", "waiting", "operator-held"].includes(overrideHandoffState)
    ? overrideHandoffState
    : ["disabled", "blocked"].includes(releaseGate.state)
    ? "blocked"
    : releaseGate.state === "scheduled"
      ? "scheduled"
      : releaseGate.state === "review"
        ? "review"
        : "ready";
  const integrationHandoffState = providerIntegrationContract.state === "blocked"
    ? "blocked"
    : providerIntegrationContract.state === "waiting"
      ? "scheduled"
      : providerIntegrationContract.state === "degraded"
        ? "review"
        : "ready";
  const externalHandoffState = ["blocked", "held", "operator-held"].includes(lifecycleHandoffState)
    || permissionHandoffState === "blocked"
    || integrationHandoffState === "blocked"
    ? "blocked"
    : permissionHandoffState === "waiting-for-approval"
      ? "waiting-for-approval"
      : integrationHandoffState === "scheduled"
        ? "scheduled"
        : lifecycleHandoffState === "ready"
          ? integrationHandoffState
          : lifecycleHandoffState;
  const externalBlockedReason = ["held", "operator-held"].includes(lifecycleHandoffState)
    ? `lifecycle-operator-${operatorOverride.requestedCommand ?? "hold"}`
    : lifecycleHandoffState === "waiting"
      ? "lifecycle-operator-waiting"
    : releaseGate.state === "disabled"
    ? "lifecycle-disabled"
    : releaseGate.state === "blocked"
      ? `lifecycle-${releaseGate.gateReason ?? "blocked"}`
      : providerIntegrationContract.state === "blocked"
        ? "provider-integration-blocked"
        : deniedJobs.length > 0
          ? "permission-denied"
          : approvalJobs.length > 0
            ? "approval-required"
            : releaseGate.state === "scheduled"
              ? "waiting-for-release-schedule"
              : providerIntegrationContract.state === "waiting"
                ? "provider-integration-waiting"
                : releaseGate.state === "review"
                  ? `lifecycle-review-${releaseGate.gateReason ?? "required"}`
                  : providerIntegrationContract.state === "degraded"
                    ? "provider-integration-degraded"
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
    lifecycleOperatorOverride: operatorOverride,
    permissionHandoffState,
    integrationHandoffState,
    providerCapabilities: syncContract.requiredProviderCapabilities ?? [],
    missingWorkspaceCapabilities,
    releaseGate,
    syncContract,
  });
  const providerCapabilityReplay = buildProviderCapabilityReplayContract({
    packageDescriptor,
    claimDescriptor,
    tenantContext,
    jobs,
    syncContract,
    negotiatedCapabilities,
    missingWorkspaceCapabilities,
    externalHandoffState,
    permissionHandoffState,
    lifecycleHandoffState,
  });
  const providerCredentialLease = buildProviderCredentialLeaseContract({
    packageDescriptor,
    claimDescriptor,
    tenantContext,
    jobs,
    syncContract,
    providerCapabilityReplay,
    externalHandoffState,
    permissionHandoffState,
    lifecycleHandoffState,
  });
  const runtimeProviderHandoff = buildRuntimeProviderExternalHandoff(packageDescriptor, claimDescriptor, jobs, {
    externalHandoffState,
    externalBlockedReason,
    providerOperationalHealth,
    providerCapabilityReplay,
    providerCredentialLease,
    providerIntegrationContract,
    syncContract,
    releaseGate,
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
      providerIntegrationContractId: providerIntegrationContract.id ?? null,
      providerSyncAcceptanceContractId: providerSyncAcceptance.id ?? null,
      providerReadinessExportId: providerReadinessExport.id ?? null,
      serviceLevel: providerIntegrationContract.serviceLevel ?? null,
      integrationState: providerIntegrationContract.state ?? "unknown",
      integrationReady: providerIntegrationContract.ready === true,
      syncAcceptanceState: providerSyncAcceptance.state ?? "unknown",
      syncAcceptanceReady: providerSyncAcceptance.ready === true,
      readinessExportState: providerReadinessExport.state ?? "unknown",
      readinessExportReady: providerReadinessExport.ready === true,
    },
    providerIntegrationContract: providerIntegrationContract.id ? {
      id: providerIntegrationContract.id,
      protocol: providerIntegrationContract.protocol,
      service: providerIntegrationContract.service,
      apiVersion: providerIntegrationContract.apiVersion,
      region: providerIntegrationContract.region,
      state: providerIntegrationContract.state,
      ready: providerIntegrationContract.ready === true,
      nextAction: providerIntegrationContract.nextAction,
      serviceLevel: providerIntegrationContract.serviceLevel,
      capabilityNegotiation: providerIntegrationContract.capabilityNegotiation,
      featureRows: providerIntegrationContract.featureRows ?? [],
      validationSummary: providerIntegrationContract.validationSummary ?? {},
      commandId: providerIntegrationContract.command?.id ?? null,
    } : null,
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
      providerIntegrationContractId: providerIntegrationContract.id ?? null,
      providerIntegrationState: providerIntegrationContract.state ?? "unknown",
      providerIntegrationReady: providerIntegrationContract.ready === true,
      providerMissingFeatures: providerIntegrationContract.validationSummary?.missingFeatures ?? [],
      providerWaitingFeatures: providerIntegrationContract.validationSummary?.waitingFeatures ?? [],
      writeLikeJobIds: writeLikeJobs.map((job) => job.id),
      readyJobIds: readyJobs.map((job) => job.id),
      approvalJobIds: approvalJobs.map((job) => job.id),
      deniedJobIds: deniedJobs.map((job) => job.id),
      providerRequiredCapabilities: syncContract.requiredProviderCapabilities ?? [],
      replayContractId: providerCapabilityReplay.id,
      replayState: providerCapabilityReplay.state,
      replayReady: providerCapabilityReplay.ready,
      resumeCursor: providerCapabilityReplay.resumeCursor,
      commandIds: providerCapabilityReplay.commands.map((command) => command.id),
      rows: providerCapabilityReplay.capabilityRows,
      credentialLeaseId: providerCredentialLease.id,
      credentialLeaseState: providerCredentialLease.state,
      credentialLeaseReady: providerCredentialLease.ready,
      credentialLeaseResumeCursor: providerCredentialLease.resumeCursor,
      credentialLeaseCommandIds: providerCredentialLease.commands.map((command) => command.id),
    },
    providerCapabilityReplay,
    providerCredentialLease,
    providerSyncAcceptance: providerSyncAcceptance.id ? {
      id: providerSyncAcceptance.id,
      protocol: providerSyncAcceptance.protocol,
      state: providerSyncAcceptance.state,
      ready: providerSyncAcceptance.ready === true,
      visibleStatus: providerSyncAcceptance.visibleStatus,
      nextAction: providerSyncAcceptance.nextAction,
      syncContractId: providerSyncAcceptance.syncContractId,
      providerIntegrationContractId: providerSyncAcceptance.providerIntegrationContractId,
      providerClientHandoffId: providerSyncAcceptance.providerClientHandoffId,
      requiredInputs: providerSyncAcceptance.requiredInputs ?? [],
      rows: providerSyncAcceptance.rows ?? [],
      commandId: providerSyncAcceptance.command?.id ?? null,
      clientPatch: providerSyncAcceptance.clientPatch ?? null,
      validationSummary: providerSyncAcceptance.validationSummary ?? {},
      restartSemantics: providerSyncAcceptance.restartSemantics ?? null,
    } : null,
    providerReadinessExport: providerReadinessExport.id ? {
      id: providerReadinessExport.id,
      protocol: providerReadinessExport.protocol,
      state: providerReadinessExport.state,
      ready: providerReadinessExport.ready === true,
      visibleStatus: providerReadinessExport.visibleStatus,
      nextAction: providerReadinessExport.nextAction,
      syncContractId: providerReadinessExport.syncContractId,
      providerIntegrationContractId: providerReadinessExport.providerIntegrationContractId,
      providerSyncAcceptanceContractId: providerReadinessExport.providerSyncAcceptanceContractId,
      providerClientHandoffId: providerReadinessExport.providerClientHandoffId,
      requiredProviderCapabilities: providerReadinessExport.requiredProviderCapabilities ?? [],
      writeLikeOperationIds: providerReadinessExport.writeLikeOperationIds ?? [],
      rows: providerReadinessExport.rows ?? [],
      commandId: providerReadinessExport.command?.id ?? null,
      clientPatch: providerReadinessExport.clientPatch ?? null,
      validationSummary: providerReadinessExport.validationSummary ?? {},
      restartSemantics: providerReadinessExport.restartSemantics ?? null,
    } : null,
    runtimeProviderHandoff,
    providerExternalHandoff: runtimeProviderHandoff,
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
      providerIntegrationContractId: providerIntegrationContract.id ?? syncMetadata.providerIntegrationContractId ?? null,
      providerIntegrationState: providerIntegrationContract.state ?? "unknown",
      providerIntegrationReady: providerIntegrationContract.ready === true,
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
      operatorReleaseChecklist: operatorReleaseChecklist.id ? {
        id: operatorReleaseChecklist.id,
        state: operatorReleaseChecklist.state,
        ready: operatorReleaseChecklist.ready === true,
        visibleStatus: operatorReleaseChecklist.visibleStatus,
        nextAction: operatorReleaseChecklist.nextAction,
        commandId: operatorReleaseChecklist.command?.id ?? null,
        blockedCheckKeys: operatorReleaseChecklist.clientPatch?.operatorReleaseBlockedCheckKeys ?? [],
        waitingCheckKeys: operatorReleaseChecklist.clientPatch?.operatorReleaseWaitingCheckKeys ?? [],
        reviewCheckKeys: operatorReleaseChecklist.clientPatch?.operatorReleaseReviewCheckKeys ?? [],
        requiredInputNames: operatorReleaseChecklist.requiredInputNames ?? [],
      } : null,
      operatorOverride: operatorOverride.id ? {
        id: operatorOverride.id,
        state: operatorOverride.state,
        ready: operatorOverride.ready === true,
        requestedCommand: operatorOverride.requestedCommand,
        requestedBy: operatorOverride.requestedBy,
        reason: operatorOverride.reason,
        affectsRuntimeHandoff: operatorOverride.affectsRuntimeHandoff === true,
        nextAction: operatorOverride.nextAction,
        commandId: operatorOverride.command?.id ?? null,
        affectedOperationIds: operatorOverride.affectedOperationIds ?? [],
      } : null,
      commandDispatch: lifecycleCommandDispatch.id ? {
        id: lifecycleCommandDispatch.id,
        state: lifecycleCommandDispatch.state,
        ready: lifecycleCommandDispatch.ready === true,
        visibleStatus: lifecycleCommandDispatch.visibleStatus,
        nextAction: lifecycleCommandDispatch.nextAction,
        commandId: lifecycleCommandDispatch.command?.id ?? null,
        blockedKeys: lifecycleCommandDispatch.clientPatch?.lifecycleDispatchBlockedKeys ?? [],
        waitingKeys: lifecycleCommandDispatch.clientPatch?.lifecycleDispatchWaitingKeys ?? [],
        providerHandoff: lifecycleCommandDispatch.providerHandoff ?? null,
        scheduling: lifecycleCommandDispatch.scheduling ?? null,
      } : null,
      nextAction: lifecycle.nextAction ?? {
        action: externalHandoffState === "ready" ? "prepare-manual-release" : "hold-runtime-handoff",
        commandId: null,
      },
      commandIds: (lifecycle.commands ?? []).map((command) => command.id),
      runtimeBoundaryRelease: packageDescriptor.runtimeBoundaryRelease ?? lifecycle.runtimeBoundaryRelease ?? null,
      dispatchState: lifecycleCommandDispatch.state ?? "unknown",
      dispatchReady: lifecycleCommandDispatch.ready === true,
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
    packageAnalytics: {
      id: packageAnalytics.id ?? null,
      protocol: packageAnalytics.protocol ?? "aios.mailchimp.package-analytics-export.v1",
      status: packageAnalytics.status ?? "unknown",
      exportReady: packageAnalytics.exportReady === true,
      nextAction: packageAnalytics.nextAction ?? "review-package-analytics-export",
      counters: packageAnalytics.counters ?? {},
      historySnapshotIds: packageAnalytics.exportSummary?.historySnapshotIds ?? [],
      timelineEventIds: packageAnalytics.exportSummary?.timelineEventIds ?? [],
      blockedOperationIds: packageAnalytics.blockedOperationIds ?? [],
      reviewOperationIds: packageAnalytics.reviewOperationIds ?? [],
      clientPatch: packageAnalytics.clientPatch ?? null,
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
      runtimeProviderHandoffId: runtimeProviderHandoff.id,
      runtimeProviderHandoffState: runtimeProviderHandoff.state,
      runtimeProviderHandoffResumeCursor: runtimeProviderHandoff.resumeCursor,
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
      providerCapabilityReplayId: providerCapabilityReplay.id,
      providerCapabilityReplayState: providerCapabilityReplay.state,
      providerCapabilityReplayResumeCursor: providerCapabilityReplay.resumeCursor,
      providerCredentialLeaseId: providerCredentialLease.id,
      providerCredentialLeaseState: providerCredentialLease.state,
      providerCredentialLeaseResumeCursor: providerCredentialLease.resumeCursor,
      runtimeProviderHandoffCommandId: runtimeProviderHandoff.command.id,
      nextAction: providerOperationalHealth.nextAction,
    },
  };
}

function buildRuntimeBoundaryPlanPacket(planId, packageDescriptor, claimDescriptor, tenantContext, jobs, providerService) {
  const source = packageDescriptor.runtimeBoundaryRelease
    ?? packageDescriptor.lifecycleControls?.runtimeBoundaryRelease
    ?? {};
  const providerHealth = providerService.operationalHealth ?? {};
  const providerReplay = providerService.providerCapabilityReplay ?? {};
  const claimState = claimDescriptor.requestState ?? {};
  const tenantDeniedJobs = jobs.filter((job) => job.permissions.decision === "deny");
  const tenantApprovalJobs = jobs.filter((job) => job.permissions.decision === "needs-approval");
  const blockedAdapterJobs = jobs.filter((job) => job.adapterStatusHandoff.state === "blocked");
  const waitingAdapterJobs = jobs.filter((job) => job.adapterStatusHandoff.state === "waiting-for-approval");
  const sourceRows = Array.isArray(source.rows) ? source.rows : [];
  const rows = [
    ...sourceRows.map((row, index) => ({
      sequence: index + 1,
      key: row.key,
      state: row.state,
      source: "package-manifest",
      sourceId: row.sourceId ?? null,
      nextAction: row.nextAction ?? "review-runtime-boundary",
      commandId: row.commandId ?? null,
      blockingReason: row.state === "blocked" ? row.key : null,
    })),
    {
      sequence: sourceRows.length + 1,
      key: "claim-state",
      state: claimState.status === "ready-for-runtime" ? "ready" : "blocked",
      source: "claim-gate",
      sourceId: claimState.version ?? claimDescriptor.id,
      nextAction: claimState.status === "ready-for-runtime" ? "continue-runtime-boundary" : "collect-claim-evidence",
      commandId: claimState.commands?.find((command) => command.type === "persist-claim-state")?.id ?? null,
      blockingReason: claimState.status === "ready-for-runtime" ? null : "claim-state-not-ready",
    },
    {
      sequence: sourceRows.length + 2,
      key: "tenant-permissions",
      state: tenantDeniedJobs.length > 0
        ? "blocked"
        : tenantApprovalJobs.length > 0
          ? "waiting"
          : "ready",
      source: "executor-plan",
      sourceId: tenantContext.policyBoundaryId ?? tenantContext.isolationKey,
      nextAction: tenantDeniedJobs.length > 0
        ? "repair-tenant-permission"
        : tenantApprovalJobs.length > 0
          ? "collect-tenant-approval"
          : "append-tenant-audit",
      commandId: jobs.find((job) => job.auditHandoff?.id)?.auditHandoff?.id ?? null,
      blockingReason: tenantDeniedJobs.length > 0 ? "tenant-permission-denied" : null,
    },
    {
      sequence: sourceRows.length + 3,
      key: "provider-operational-health",
      state: providerHealth.status === "unhealthy"
        ? "blocked"
        : providerHealth.status === "degraded"
          ? "waiting"
          : "ready",
      source: "provider-service",
      sourceId: providerHealth.id ?? providerService.externalHandoff?.healthId ?? null,
      nextAction: providerHealth.nextAction ?? providerService.externalHandoff?.nextAction ?? "review-provider-health",
      commandId: providerReplay.commands?.find((command) => command.type === "persist-provider-capability-ledger")?.id ?? null,
      blockingReason: providerHealth.status === "unhealthy" ? providerHealth.blockedReason ?? "provider-unhealthy" : null,
    },
    {
      sequence: sourceRows.length + 4,
      key: "adapter-status-handoff",
      state: blockedAdapterJobs.length > 0
        ? "blocked"
        : waitingAdapterJobs.length > 0
          ? "waiting"
          : "ready",
      source: "executor-plan",
      sourceId: providerService.externalHandoff?.handoffId ?? null,
      nextAction: blockedAdapterJobs.length > 0
        ? "repair-adapter-status-handoff"
        : waitingAdapterJobs.length > 0
          ? "collect-tenant-approval"
          : "persist-adapter-status-cursors",
      commandId: jobs.find((job) => job.adapterStatusHandoff?.commands?.statusCommandId)?.adapterStatusHandoff?.commands?.statusCommandId ?? null,
      blockingReason: blockedAdapterJobs.length > 0 ? "adapter-status-blocked" : null,
    },
  ];
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const reviewRows = rows.filter((row) => row.state === "review");
  const state = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : reviewRows.length > 0
        ? "review"
        : "ready";
  const packetScope = [
    planId,
    source.id,
    tenantContext.isolationKey,
    providerService.externalHandoff?.handoffId,
    state,
    rows.map((row) => `${row.key}:${row.state}`).join(","),
  ];
  const command = {
    id: stableId("runtimeboundarycmd", [...packetScope, "persist-executor-boundary"]),
    type: "persist-executor-runtime-boundary",
    idempotencyKey: stableId("idem", [...packetScope, "persist-executor-boundary"]),
    statusAfterReplay: state === "ready" ? "executor-runtime-boundary-ready" : `executor-runtime-boundary-${state}`,
    writes: ["runtimeBoundaryPlanId", "boundaryRows", "tenantIsolationKey", "nextAction"],
    conflict: "return-existing",
  };
  return {
    id: stableId("runtimeboundaryplan", packetScope),
    product: "mailchimp",
    contractVersion: "aios.mailchimp.executor-runtime-boundary.v1",
    sourcePacketId: source.id ?? null,
    planId,
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "executor-runtime-boundary-ready"
      : state === "waiting"
        ? "executor-runtime-boundary-waiting"
        : state === "review"
          ? "executor-runtime-boundary-review"
          : "executor-runtime-boundary-blocked",
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? reviewRows[0]?.nextAction
      ?? "persist-executor-runtime-boundary",
    tenant: {
      tenantId: tenantContext.tenantId,
      workspaceId: tenantContext.workspaceId,
      isolationKey: tenantContext.isolationKey,
      policyBoundaryId: tenantContext.policyBoundaryId ?? null,
    },
    rows,
    command,
    counters: {
      rows: rows.length,
      ready: rows.filter((row) => row.state === "ready").length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      review: reviewRows.length,
      tenantDeniedJobs: tenantDeniedJobs.length,
      tenantApprovalJobs: tenantApprovalJobs.length,
      blockedAdapterJobs: blockedAdapterJobs.length,
      waitingAdapterJobs: waitingAdapterJobs.length,
    },
    clientPatch: {
      runtimeBoundaryPlanId: stableId("runtimeboundarypatch", [planId, state, tenantContext.isolationKey]),
      runtimeBoundaryState: state,
      runtimeBoundaryReady: state === "ready",
      runtimeBoundaryNextAction: blockedRows[0]?.nextAction ?? waitingRows[0]?.nextAction ?? "persist-executor-runtime-boundary",
      runtimeBoundaryBlockedKeys: blockedRows.map((row) => row.key),
      runtimeBoundaryWaitingKeys: waitingRows.map((row) => row.key),
      runtimeBoundaryBlockedJobIds: [...new Set([
        ...tenantDeniedJobs.map((job) => job.id),
        ...blockedAdapterJobs.map((job) => job.id),
      ])].sort(),
      runtimeBoundaryWaitingJobIds: [...new Set([
        ...tenantApprovalJobs.map((job) => job.id),
        ...waitingAdapterJobs.map((job) => job.id),
      ])].sort(),
    },
  };
}

function buildReadinessSummary(packageDescriptor, claimDescriptor, jobs, providerService, issues) {
  const sync = providerService.sync ?? {};
  const packagePreview = providerService.packagePreview ?? {};
  const packageAnalytics = providerService.packageAnalytics ?? packageDescriptor.analyticsExport ?? {};
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
  const operatorReleaseChecklist = lifecycle.operatorReleaseChecklist ?? packageDescriptor.operatorReleaseChecklist ?? {};
  const providerSyncAcceptance = providerService.providerSyncAcceptance
    ?? packageDescriptor.providerSyncAcceptanceContract
    ?? {};
  const providerReadinessExport = providerService.providerReadinessExport
    ?? packageDescriptor.providerReadinessExport
    ?? packageDescriptor.lifecycleControls?.providerReadinessExport
    ?? {};
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
      name: "operator-release-checklist",
      status: operatorReleaseChecklist.state === "ready"
        ? "ready"
        : operatorReleaseChecklist.state === "review" || operatorReleaseChecklist.state === "waiting"
          ? "needs-review"
          : operatorReleaseChecklist.state === "disabled"
            ? "disabled"
            : "blocked",
      detail: operatorReleaseChecklist.id
        ? `Operator release checklist ${operatorReleaseChecklist.id} is ${operatorReleaseChecklist.visibleStatus}.`
        : "Operator release checklist contract is not available.",
      nextAction: operatorReleaseChecklist.nextAction ?? "review-operator-release-checklist",
      checklistId: operatorReleaseChecklist.id ?? null,
      checklistState: operatorReleaseChecklist.state ?? "unknown",
      blockedCheckKeys: operatorReleaseChecklist.clientPatch?.operatorReleaseBlockedCheckKeys ?? [],
      waitingCheckKeys: operatorReleaseChecklist.clientPatch?.operatorReleaseWaitingCheckKeys ?? [],
      reviewCheckKeys: operatorReleaseChecklist.clientPatch?.operatorReleaseReviewCheckKeys ?? [],
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
    {
      name: "provider-sync-acceptance",
      status: providerSyncAcceptance.ready === true
        ? "ready"
        : providerSyncAcceptance.state === "waiting"
          ? "needs-review"
          : providerSyncAcceptance.state === "blocked"
            ? "blocked"
            : "needs-review",
      detail: providerSyncAcceptance.id
        ? `Provider sync acceptance ${providerSyncAcceptance.id} is ${providerSyncAcceptance.visibleStatus}.`
        : "Provider sync acceptance contract is not available.",
      nextAction: providerSyncAcceptance.nextAction ?? "review-provider-sync-acceptance",
      providerSyncAcceptanceId: providerSyncAcceptance.id ?? null,
      blockedKeys: providerSyncAcceptance.validationSummary?.blockedKeys ?? [],
      waitingKeys: providerSyncAcceptance.validationSummary?.waitingKeys ?? [],
      missingRequiredInputs: providerSyncAcceptance.validationSummary?.missingRequiredInputs ?? [],
    },
    {
      name: "provider-readiness-export",
      status: providerReadinessExport.ready === true
        ? "ready"
        : providerReadinessExport.state === "waiting" || providerReadinessExport.state === "review"
          ? "needs-review"
          : providerReadinessExport.state === "blocked"
            ? "blocked"
            : "needs-review",
      detail: providerReadinessExport.id
        ? `Provider readiness export ${providerReadinessExport.id} is ${providerReadinessExport.visibleStatus}.`
        : "Provider readiness export contract is not available.",
      nextAction: providerReadinessExport.nextAction ?? "review-provider-readiness-export",
      providerReadinessExportId: providerReadinessExport.id ?? null,
      blockedKeys: providerReadinessExport.validationSummary?.blockedKeys ?? [],
      waitingKeys: providerReadinessExport.validationSummary?.waitingKeys ?? [],
      reviewKeys: providerReadinessExport.validationSummary?.reviewKeys ?? [],
      missingProviderFeatures: providerReadinessExport.validationSummary?.missingProviderFeatures ?? [],
      waitingProviderFeatures: providerReadinessExport.validationSummary?.waitingProviderFeatures ?? [],
    },
    {
      name: "package-analytics-export",
      status: packageAnalytics.status === "blocked"
        ? "blocked"
        : packageAnalytics.status === "waiting" || packageAnalytics.status === "review"
          ? "needs-review"
          : packageAnalytics.exportReady === true
            ? "ready"
            : "needs-review",
      detail: packageAnalytics.id
        ? `Package analytics export ${packageAnalytics.id} is ${packageAnalytics.status}.`
        : "Package analytics export contract is not available.",
      nextAction: packageAnalytics.nextAction ?? "review-package-analytics-export",
      packageAnalyticsExportId: packageAnalytics.id ?? null,
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
      operatorReleaseChecklistId: operatorReleaseChecklist.id ?? null,
      operatorReleaseChecklistState: operatorReleaseChecklist.state ?? "unknown",
      providerSyncAcceptanceId: providerSyncAcceptance.id ?? null,
      providerSyncAcceptanceState: providerSyncAcceptance.state ?? "unknown",
      providerSyncAcceptanceReady: providerSyncAcceptance.ready === true,
      providerReadinessExportId: providerReadinessExport.id ?? null,
      providerReadinessState: providerReadinessExport.state ?? "unknown",
      providerReadinessReady: providerReadinessExport.ready === true,
      providerReadinessNextAction: providerReadinessExport.nextAction ?? null,
      providerReadinessBlockedKeys: providerReadinessExport.validationSummary?.blockedKeys ?? [],
      providerReadinessWaitingKeys: providerReadinessExport.validationSummary?.waitingKeys ?? [],
    },
  };
}

function buildAcceptanceContract(planId, packageDescriptor, claimDescriptor, jobs, providerService, readiness) {
  const lifecycle = packageDescriptor.lifecycleControls ?? {};
  const releaseAcceptance = lifecycle.releaseAcceptance ?? packageDescriptor.releaseAcceptanceContract ?? {};
  const operatorReleaseChecklist = lifecycle.operatorReleaseChecklist ?? packageDescriptor.operatorReleaseChecklist ?? {};
  const claimState = claimDescriptor.requestState ?? {};
  const claimAcceptance = claimDescriptor.claimAcceptance ?? {};
  const readyJobs = providerService.capabilityNegotiation?.readyJobIds ?? [];
  const approvalJobs = providerService.capabilityNegotiation?.approvalJobIds ?? [];
  const deniedJobs = providerService.capabilityNegotiation?.deniedJobIds ?? [];
  const releaseGate = lifecycle.releaseGate ?? {};
  const releaseGateReady = releaseGate.id ? releaseGate.releaseAllowed === true : true;
  const releaseAcceptanceReady = releaseAcceptance.id ? releaseAcceptance.ready === true : true;
  const operatorReleaseReady = operatorReleaseChecklist.id ? operatorReleaseChecklist.ready === true : true;
  const providerSyncAcceptance = providerService.providerSyncAcceptance
    ?? packageDescriptor.providerSyncAcceptanceContract
    ?? {};
  const providerSyncAcceptanceReady = providerSyncAcceptance.id ? providerSyncAcceptance.ready === true : true;
  const providerReadinessExport = providerService.providerReadinessExport
    ?? packageDescriptor.providerReadinessExport
    ?? packageDescriptor.lifecycleControls?.providerReadinessExport
    ?? {};
  const providerReadinessReady = providerReadinessExport.id ? providerReadinessExport.ready === true : true;
  const canAccept = readiness.status === "ready"
    && deniedJobs.length === 0
    && claimState.status !== "needs-evidence"
    && releaseGateReady
    && releaseAcceptanceReady
    && operatorReleaseReady
    && providerSyncAcceptanceReady
    && providerReadinessReady;
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
      name: "providerSyncAcceptanceId",
      value: providerSyncAcceptance.id ?? null,
      required: Boolean(providerSyncAcceptance.id),
    },
    {
      name: "providerSyncAcceptanceCommandId",
      value: providerSyncAcceptance.commandId ?? providerSyncAcceptance.command?.id ?? null,
      required: providerSyncAcceptance.ready === true,
    },
    {
      name: "providerReadinessExportId",
      value: providerReadinessExport.id ?? null,
      required: Boolean(providerReadinessExport.id),
    },
    {
      name: "providerReadinessExportCommandId",
      value: providerReadinessExport.commandId ?? providerReadinessExport.command?.id ?? null,
      required: providerReadinessExport.ready === true,
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
      name: "operatorReleaseChecklistId",
      value: operatorReleaseChecklist.id ?? null,
      required: Boolean(operatorReleaseChecklist.id),
    },
    {
      name: "operatorReleaseChecklistCommandId",
      value: operatorReleaseChecklist.command?.id ?? null,
      required: operatorReleaseChecklist.ready === true,
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
      operatorReleaseChecklistState: operatorReleaseChecklist.state ?? "unknown",
      operatorReleaseChecklistReady: operatorReleaseChecklist.ready === true,
      operatorReleaseBlockedCheckKeys: operatorReleaseChecklist.clientPatch?.operatorReleaseBlockedCheckKeys ?? [],
      operatorReleaseWaitingCheckKeys: operatorReleaseChecklist.clientPatch?.operatorReleaseWaitingCheckKeys ?? [],
      operatorReleaseReviewCheckKeys: operatorReleaseChecklist.clientPatch?.operatorReleaseReviewCheckKeys ?? [],
      providerSyncAcceptanceState: providerSyncAcceptance.state ?? "unknown",
      providerSyncAcceptanceReady: providerSyncAcceptance.ready === true,
      providerSyncAcceptanceBlockedKeys: providerSyncAcceptance.validationSummary?.blockedKeys ?? [],
      providerSyncAcceptanceWaitingKeys: providerSyncAcceptance.validationSummary?.waitingKeys ?? [],
      providerSyncAcceptanceMissingInputs: providerSyncAcceptance.validationSummary?.missingRequiredInputs ?? [],
      providerReadinessState: providerReadinessExport.state ?? "unknown",
      providerReadinessReady: providerReadinessExport.ready === true,
      providerReadinessBlockedKeys: providerReadinessExport.validationSummary?.blockedKeys ?? [],
      providerReadinessWaitingKeys: providerReadinessExport.validationSummary?.waitingKeys ?? [],
      providerReadinessReviewKeys: providerReadinessExport.validationSummary?.reviewKeys ?? [],
      providerReadinessMissingFeatures: providerReadinessExport.validationSummary?.missingProviderFeatures ?? [],
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
      operatorReleaseChecklistId: operatorReleaseChecklist.id ?? null,
      providerSyncAcceptanceId: providerSyncAcceptance.id ?? null,
      providerReadinessExportId: providerReadinessExport.id ?? null,
      claimAcceptanceId: claimAcceptance.id ?? null,
      claimAcceptanceToken: claimAcceptance.acceptanceToken ?? null,
    },
  };
}

function buildAcceptanceReadinessLedger(input) {
  const {
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    providerService,
    readinessSummary,
    acceptanceContract,
    runtimeBoundaryPlan,
    lifecycleRuntimeControl,
    restartRecoveryMatrix,
  } = input;
  const claimAcceptance = claimDescriptor.claimAcceptance ?? {};
  const claimOperatorReadiness = claimDescriptor.operatorReadiness ?? claimDescriptor.operatorReadinessPacket ?? {};
  const packagePreview = packageDescriptor.previewContract ?? providerService.packagePreview ?? {};
  const releaseAcceptance = packageDescriptor.releaseAcceptanceContract
    ?? packageDescriptor.lifecycleControls?.releaseAcceptance
    ?? {};
  const operatorChecklist = packageDescriptor.operatorReleaseChecklist
    ?? packageDescriptor.lifecycleControls?.operatorReleaseChecklist
    ?? {};
  const analyticsExport = packageDescriptor.packageAnalyticsExport
    ?? packageDescriptor.analyticsExport
    ?? providerService.packageAnalytics
    ?? {};
  const providerHealth = providerService.operationalHealth ?? {};
  const providerSyncAcceptance = providerService.providerSyncAcceptance
    ?? packageDescriptor.providerSyncAcceptanceContract
    ?? {};
  const claimExport = claimDescriptor.exportPacket ?? claimDescriptor.exportContract ?? {};
  const verifierAcceptance = claimDescriptor.verifierAcceptance
    ?? claimDescriptor.verifierReadiness
    ?? claimAcceptance.verifierAcceptance
    ?? {};
  const verifierRecovery = verifierAcceptance.recoveryHandoff
    ?? claimDescriptor.verifierRecoveryHandoff
    ?? claimDescriptor.clientRecovery?.rows?.find((row) => row.key === "verifier-recovery-handoff")
    ?? {};
  const verifierReviewBlockedKeys = verifierAcceptance.validationSummary?.blockedReviewKeys
    ?? verifierAcceptance.clientPatch?.verifierBlockedRuleIds
    ?? verifierRecovery.blockedRuleIds
    ?? [];
  const verifierReviewWaitingKeys = verifierAcceptance.validationSummary?.waitingReviewKeys
    ?? verifierAcceptance.clientPatch?.verifierMissingStateKeys
    ?? verifierRecovery.missingStateKeys
    ?? [];
  const approvalJobs = jobs.filter((job) => job.permissions?.decision === "needs-approval");
  const deniedJobs = jobs.filter((job) => job.permissions?.decision === "deny");
  const blockedAdapterJobs = jobs.filter((job) => job.adapterStatusHandoff?.state === "blocked");
  const waitingAdapterJobs = jobs.filter((job) => job.adapterStatusHandoff?.state === "waiting-for-approval");
  const rows = [
    {
      key: "claim-preview-acceptance",
      source: "claim-gate",
      sourceId: claimAcceptance.id ?? claimDescriptor.id,
      state: claimAcceptance.canAcknowledge === true ? "ready" : claimAcceptance.status === "review" ? "review" : "blocked",
      visibleStatus: claimAcceptance.visibleStatus ?? "claim-preview-unavailable",
      nextAction: claimAcceptance.nextAction ?? "review-claim-preview",
      required: true,
      commandIds: [claimAcceptance.acknowledgement?.command?.id].filter(Boolean),
      resumeCursor: claimDescriptor.requestState?.resumeCursor ?? null,
      blockers: claimAcceptance.validationSummary?.pendingFacts ?? claimDescriptor.truthBoundary?.unverifiedFacts ?? [],
      restartSafe: claimAcceptance.status !== "blocked",
    },
    {
      key: "verifier-acceptance",
      source: "verifier-compiler",
      sourceId: verifierAcceptance.snapshotId ?? verifierAcceptance.acceptanceReviewId ?? null,
      state: verifierAcceptance.state === "blocked"
        ? "blocked"
        : verifierAcceptance.state === "review"
          ? "review"
          : "ready",
      visibleStatus: verifierAcceptance.visibleStatus ?? "verifier-acceptance-not-required",
      nextAction: verifierAcceptance.nextAction ?? "continue-acceptance-readiness",
      required: verifierAcceptance.required === true,
      commandIds: verifierAcceptance.commandIds ?? [],
      resumeCursor: claimDescriptor.requestState?.resumeCursor ?? null,
      blockers: [
        ...(verifierAcceptance.blockingRuleIds ?? []),
        ...(verifierAcceptance.pendingRuleIds ?? []),
        ...verifierReviewBlockedKeys,
      ],
      restartSafe: verifierAcceptance.restartSemantics?.restartSafe !== false,
    },
    {
      key: "verifier-recovery-handoff",
      source: "verifier-compiler",
      sourceId: verifierRecovery.id ?? verifierAcceptance.clientPatch?.verifierRecoveryHandoffId ?? null,
      state: verifierRecovery.ready === true
        ? "ready"
        : verifierRecovery.state === "review" || verifierRecovery.state === "waiting"
          ? "review"
          : verifierAcceptance.required === true
            ? "blocked"
            : "ready",
      visibleStatus: verifierRecovery.visibleStatus
        ?? verifierAcceptance.clientPatch?.verifierAcceptanceVisibleStatus
        ?? "verifier-recovery-not-required",
      nextAction: verifierRecovery.nextAction
        ?? verifierAcceptance.clientPatch?.verifierAcceptanceNextAction
        ?? verifierAcceptance.nextAction
        ?? "review-verifier-recovery",
      required: verifierAcceptance.required === true,
      commandIds: verifierRecovery.commandIds
        ?? verifierAcceptance.commandIds
        ?? [verifierAcceptance.clientPatch?.verifierAcceptanceCommandId].filter(Boolean),
      resumeCursor: verifierRecovery.resumeCursor
        ?? verifierAcceptance.clientPatch?.verifierRecoveryResumeCursor
        ?? claimDescriptor.requestState?.resumeCursor
        ?? null,
      blockers: verifierReviewBlockedKeys,
      waiting: verifierReviewWaitingKeys,
      restartSafe: verifierRecovery.restartSemantics?.restartSafe !== false
        && verifierRecovery.state !== "blocked",
    },
    {
      key: "package-preview",
      source: "package-manifest",
      sourceId: packagePreview.id ?? packageDescriptor.id,
      state: packagePreview.status === "ready" ? "ready" : packagePreview.status === "review" ? "review" : "blocked",
      visibleStatus: packagePreview.visibleStatus ?? "package-preview-unavailable",
      nextAction: packagePreview.nextAction ?? "review-package-preview",
      required: true,
      commandIds: [],
      resumeCursor: providerService.sync?.cursor?.checkpointKey ?? null,
      blockers: packagePreview.validationSummary?.blockedOperationIds
        ?? packagePreview.validationSummary?.restartUnsafeOperationIds
        ?? [],
      restartSafe: packagePreview.status !== "blocked",
    },
    {
      key: "runtime-readiness",
      source: "executor-plan",
      sourceId: readinessSummary.id ?? planId,
      state: readinessSummary.status === "ready"
        ? "ready"
        : readinessSummary.status === "needs-review" || readinessSummary.status === "needs-approval"
          ? "review"
          : "blocked",
      visibleStatus: readinessSummary.status ?? "unknown",
      nextAction: readinessSummary.nextAction ?? "review-runtime-readiness",
      required: true,
      commandIds: [],
      resumeCursor: providerService.externalHandoff?.runtimeProviderHandoffResumeCursor ?? null,
      blockers: readinessSummary.checks
        ?.filter((check) => ["blocked", "disabled"].includes(check.status))
        .map((check) => check.name) ?? [],
      restartSafe: readinessSummary.status !== "blocked",
    },
    {
      key: "runtime-acceptance",
      source: "executor-plan",
      sourceId: acceptanceContract.id ?? null,
      state: acceptanceContract.canAccept === true
        ? "ready"
        : acceptanceContract.status === "acceptance-needs-approval"
          ? "review"
          : "blocked",
      visibleStatus: acceptanceContract.clientPreview?.visibleStatus ?? acceptanceContract.status ?? "unknown",
      nextAction: acceptanceContract.acceptAction ?? "review-runtime-acceptance",
      required: true,
      commandIds: [],
      resumeCursor: providerService.externalHandoff?.runtimeProviderHandoffResumeCursor ?? null,
      blockers: acceptanceContract.validationSummary?.deniedJobIds ?? [],
      restartSafe: acceptanceContract.status !== "acceptance-blocked",
    },
    {
      key: "release-acceptance",
      source: "package-manifest",
      sourceId: releaseAcceptance.id ?? null,
      state: releaseAcceptance.ready === true
        ? "ready"
        : releaseAcceptance.state === "review" || releaseAcceptance.state === "scheduled"
          ? "review"
          : "blocked",
      visibleStatus: releaseAcceptance.visibleStatus ?? "release-acceptance-unavailable",
      nextAction: releaseAcceptance.nextAction ?? "review-release-acceptance",
      required: Boolean(releaseAcceptance.id),
      commandIds: [releaseAcceptance.command?.id].filter(Boolean),
      resumeCursor: providerService.sync?.cursor?.checkpointKey ?? null,
      blockers: releaseAcceptance.clientPatch?.releaseAcceptanceBlockedOperationIds ?? [],
      restartSafe: releaseAcceptance.state !== "blocked",
    },
    {
      key: "operator-release-checklist",
      source: "package-manifest",
      sourceId: operatorChecklist.id ?? null,
      state: operatorChecklist.ready === true
        ? "ready"
        : operatorChecklist.state === "review" || operatorChecklist.state === "waiting"
          ? "review"
          : "blocked",
      visibleStatus: operatorChecklist.visibleStatus ?? "operator-checklist-unavailable",
      nextAction: operatorChecklist.nextAction ?? "review-operator-release-checklist",
      required: Boolean(operatorChecklist.id),
      commandIds: [operatorChecklist.command?.id].filter(Boolean),
      resumeCursor: providerService.sync?.cursor?.checkpointKey ?? null,
      blockers: operatorChecklist.clientPatch?.operatorReleaseBlockedCheckKeys ?? [],
      restartSafe: operatorChecklist.state !== "blocked",
    },
    {
      key: "provider-sync-acceptance",
      source: "package-manifest",
      sourceId: providerSyncAcceptance.id ?? null,
      state: providerSyncAcceptance.ready === true
        ? "ready"
        : providerSyncAcceptance.state === "waiting"
          ? "review"
          : "blocked",
      visibleStatus: providerSyncAcceptance.visibleStatus ?? "provider-sync-acceptance-unavailable",
      nextAction: providerSyncAcceptance.nextAction ?? "review-provider-sync-acceptance",
      required: Boolean(providerSyncAcceptance.id),
      commandIds: [providerSyncAcceptance.commandId ?? providerSyncAcceptance.command?.id].filter(Boolean),
      resumeCursor: providerSyncAcceptance.restartSemantics?.replayCursor
        ?? providerService.sync?.cursor?.checkpointKey
        ?? null,
      blockers: providerSyncAcceptance.validationSummary?.blockedKeys
        ?? providerSyncAcceptance.clientPatch?.blockedKeys
        ?? [],
      restartSafe: providerSyncAcceptance.restartSemantics?.restartSafe !== false
        && providerSyncAcceptance.state !== "blocked",
    },
    {
      key: "tenant-boundary",
      source: "executor-plan",
      sourceId: claimDescriptor.tenantPolicy?.boundaryId ?? null,
      state: deniedJobs.length > 0 ? "blocked" : approvalJobs.length > 0 ? "review" : "ready",
      visibleStatus: deniedJobs.length > 0
        ? "tenant-permission-blocked"
        : approvalJobs.length > 0
          ? "tenant-approval-required"
          : "tenant-boundary-ready",
      nextAction: deniedJobs.length > 0
        ? "repair-tenant-permission"
        : approvalJobs.length > 0
          ? "collect-tenant-approval"
          : "append-tenant-audit",
      required: true,
      commandIds: jobs.map((job) => job.auditHandoff?.id).filter(Boolean),
      resumeCursor: claimDescriptor.requestState?.resumeCursor ?? null,
      blockers: deniedJobs.map((job) => job.id),
      restartSafe: deniedJobs.length === 0,
    },
    {
      key: "adapter-status-resume",
      source: "executor-plan",
      sourceId: providerService.externalHandoff?.handoffId ?? null,
      state: blockedAdapterJobs.length > 0 ? "blocked" : waitingAdapterJobs.length > 0 ? "review" : "ready",
      visibleStatus: blockedAdapterJobs.length > 0
        ? "adapter-status-blocked"
        : waitingAdapterJobs.length > 0
          ? "adapter-status-waiting"
          : "adapter-status-ready",
      nextAction: blockedAdapterJobs.length > 0
        ? "repair-adapter-status-handoff"
        : waitingAdapterJobs.length > 0
          ? "collect-tenant-approval"
          : "persist-adapter-status-cursors",
      required: true,
      commandIds: jobs.map((job) => job.adapterStatusHandoff?.commands?.statusCommandId).filter(Boolean),
      resumeCursor: providerService.externalHandoff?.adapterStatusResumeCursors?.[0] ?? null,
      blockers: blockedAdapterJobs.map((job) => job.id),
      restartSafe: blockedAdapterJobs.length === 0,
    },
    {
      key: "runtime-boundary",
      source: "executor-plan",
      sourceId: runtimeBoundaryPlan.id,
      state: runtimeBoundaryPlan.ready ? "ready" : runtimeBoundaryPlan.state === "waiting" || runtimeBoundaryPlan.state === "review" ? "review" : "blocked",
      visibleStatus: runtimeBoundaryPlan.visibleStatus,
      nextAction: runtimeBoundaryPlan.nextAction,
      required: true,
      commandIds: [runtimeBoundaryPlan.command?.id].filter(Boolean),
      resumeCursor: providerService.externalHandoff?.runtimeProviderHandoffResumeCursor ?? null,
      blockers: runtimeBoundaryPlan.clientPatch?.runtimeBoundaryBlockedKeys ?? [],
      restartSafe: runtimeBoundaryPlan.state !== "blocked",
    },
    {
      key: "restart-recovery",
      source: "executor-plan",
      sourceId: restartRecoveryMatrix.id,
      state: restartRecoveryMatrix.restartSafe ? "ready" : restartRecoveryMatrix.state === "waiting" ? "review" : "blocked",
      visibleStatus: restartRecoveryMatrix.state,
      nextAction: restartRecoveryMatrix.nextAction,
      required: true,
      commandIds: restartRecoveryMatrix.commands?.map((command) => command.id) ?? [],
      resumeCursor: restartRecoveryMatrix.replayCursor ?? null,
      blockers: restartRecoveryMatrix.clientPatch?.blockedJobIds ?? [],
      restartSafe: restartRecoveryMatrix.restartSafe === true,
    },
    {
      key: "provider-health",
      source: "provider-service",
      sourceId: providerHealth.id ?? providerService.id ?? null,
      state: providerHealth.status === "healthy" ? "ready" : providerHealth.status === "degraded" ? "review" : "blocked",
      visibleStatus: providerHealth.status ?? "unknown",
      nextAction: providerHealth.nextAction ?? "review-provider-health",
      required: true,
      commandIds: providerService.providerCapabilityReplay?.commands?.map((command) => command.id) ?? [],
      resumeCursor: providerService.providerCapabilityReplay?.resumeCursor ?? null,
      blockers: providerHealth.actionableErrors?.filter((error) => error.severity === "error").map((error) => error.code) ?? [],
      restartSafe: providerHealth.status !== "unhealthy",
    },
    {
      key: "analytics-export",
      source: "package-manifest",
      sourceId: analyticsExport.id ?? null,
      state: analyticsExport.exportReady === true ? "ready" : analyticsExport.status === "waiting" || analyticsExport.status === "review" ? "review" : "blocked",
      visibleStatus: analyticsExport.status ?? "unknown",
      nextAction: analyticsExport.nextAction ?? "review-package-analytics-export",
      required: false,
      commandIds: analyticsExport.publishCommands?.map((command) => command.id) ?? [],
      resumeCursor: analyticsExport.replayCursor ?? null,
      blockers: analyticsExport.exportSummary?.blockerCodes ?? analyticsExport.blockedOperationIds ?? [],
      restartSafe: analyticsExport.status !== "blocked",
    },
    {
      key: "claim-export",
      source: "claim-gate",
      sourceId: claimExport.digest ?? claimExport.id ?? null,
      state: claimExport.exportReady === true || claimExport.ready === true ? "ready" : claimExport.state === "review" ? "review" : "blocked",
      visibleStatus: claimExport.state ? `claim-export-${claimExport.state}` : "claim-export-unavailable",
      nextAction: claimExport.nextAction ?? claimExport.exportSummary?.nextAction ?? "review-claim-export",
      required: false,
      commandIds: claimExport.publishCommands?.map((command) => command.id) ?? [],
      resumeCursor: claimExport.replayCursor ?? null,
      blockers: claimExport.exportSummary?.blockerArtifactNames ?? [],
      restartSafe: claimExport.state !== "blocked",
    },
    {
      key: "claim-operator-readiness",
      source: "claim-gate",
      sourceId: claimOperatorReadiness.id ?? null,
      state: claimOperatorReadiness.ready === true
        ? "ready"
        : claimOperatorReadiness.state === "review" || claimOperatorReadiness.state === "waiting"
          ? "review"
          : "blocked",
      visibleStatus: claimOperatorReadiness.visibleStatus ?? "claim-operator-readiness-unavailable",
      nextAction: claimOperatorReadiness.nextAction ?? "review-claim-operator-readiness",
      required: Boolean(claimOperatorReadiness.id),
      commandIds: [claimOperatorReadiness.acknowledgementCommand?.id].filter(Boolean),
      resumeCursor: claimOperatorReadiness.clientPatch?.resumeCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
      blockers: claimOperatorReadiness.validationSummary?.blockedReadinessKeys ?? [],
      restartSafe: claimOperatorReadiness.state !== "blocked",
    },
    {
      key: "lifecycle-runtime-control",
      source: "executor-plan",
      sourceId: lifecycleRuntimeControl.id,
      state: lifecycleRuntimeControl.ready ? "ready" : lifecycleRuntimeControl.state === "waiting" ? "review" : "blocked",
      visibleStatus: lifecycleRuntimeControl.visibleStatus,
      nextAction: lifecycleRuntimeControl.nextAction,
      required: true,
      commandIds: [lifecycleRuntimeControl.command?.id].filter(Boolean),
      resumeCursor: providerService.externalHandoff?.runtimeProviderHandoffResumeCursor ?? null,
      blockers: lifecycleRuntimeControl.clientPatch?.blockedControlKeys ?? [],
      restartSafe: lifecycleRuntimeControl.restartSemantics?.restartSafe !== false,
    },
  ];
  const requiredRows = rows.filter((row) => row.required);
  const blockedRows = requiredRows.filter((row) => row.state === "blocked");
  const reviewRows = requiredRows.filter((row) => row.state === "review");
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : "ready";
  const ledgerId = stableId("acceptledger", [
    planId,
    packageDescriptor.id,
    claimDescriptor.id,
    state,
    rows.map((row) => `${row.key}:${row.state}:${row.sourceId}`).join(","),
  ]);
  const command = {
    id: stableId("acceptledgercmd", [ledgerId, "persist-acceptance-readiness-ledger"]),
    type: "persist-acceptance-readiness-ledger",
    idempotencyKey: stableId("idem", [ledgerId, "persist-acceptance-readiness-ledger"]),
    statusAfterReplay: state === "ready" ? "acceptance-readiness-ready" : `acceptance-readiness-${state}`,
    writes: ["acceptanceReadinessLedgerId", "rows", "nextAction", "clientPatch", "resumeCursors"],
    conflict: "return-existing",
  };
  return {
    protocol: "aios.mailchimp.acceptance-readiness-ledger.v1",
    id: ledgerId,
    product: "mailchimp",
    planId,
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "acceptance-readiness-ready"
      : state === "review"
        ? "acceptance-readiness-review"
        : "acceptance-readiness-blocked",
    nextAction: blockedRows[0]?.nextAction ?? reviewRows[0]?.nextAction ?? "persist-acceptance-readiness-ledger",
    rows,
    command,
    acceptanceToken: claimAcceptance.acceptanceToken ?? acceptanceContract.clientPreview?.claimAcceptanceToken ?? null,
    digest: stableId("acceptledgerdigest", [
      ledgerId,
      command.id,
      rows.map((row) => `${row.key}:${row.state}:${row.visibleStatus}`).join(","),
    ]),
    counters: {
      rows: rows.length,
      required: requiredRows.length,
      ready: rows.filter((row) => row.state === "ready").length,
      blocked: rows.filter((row) => row.state === "blocked").length,
      review: rows.filter((row) => row.state === "review").length,
      deniedJobs: deniedJobs.length,
      approvalJobs: approvalJobs.length,
      blockedAdapterJobs: blockedAdapterJobs.length,
      verifierRecoveryBlocked: verifierReviewBlockedKeys.length,
      verifierRecoveryWaiting: verifierReviewWaitingKeys.length,
    },
    validationSummary: {
      blockedKeys: blockedRows.map((row) => row.key),
      reviewKeys: reviewRows.map((row) => row.key),
      optionalBlockedKeys: rows.filter((row) => !row.required && row.state === "blocked").map((row) => row.key),
      missingRequiredInputs: acceptanceContract.requiredInputs
        ?.filter((input) => input.required && (
          input.value === null
          || input.value === undefined
          || input.value === ""
          || (Array.isArray(input.value) && input.value.length === 0)
        ))
        .map((input) => input.name) ?? [],
      resumeCursors: [...new Set(rows.map((row) => row.resumeCursor).filter(Boolean))].sort(),
      commandIds: [...new Set(rows.flatMap((row) => row.commandIds))].sort(),
      verifierRecovery: {
        id: verifierRecovery.id ?? verifierAcceptance.clientPatch?.verifierRecoveryHandoffId ?? null,
        state: verifierRecovery.state ?? verifierAcceptance.state ?? "unknown",
        ready: verifierRecovery.ready === true,
        blockedRuleIds: verifierRecovery.blockedRuleIds ?? verifierReviewBlockedKeys,
        missingStateKeys: verifierRecovery.missingStateKeys ?? verifierReviewWaitingKeys,
        resumeCursor: verifierRecovery.resumeCursor
          ?? verifierAcceptance.clientPatch?.verifierRecoveryResumeCursor
          ?? null,
      },
    },
    clientPatch: {
      acceptanceReadinessLedgerId: ledgerId,
      acceptanceReadinessState: state,
      acceptanceReadinessReady: state === "ready",
      acceptanceReadinessVisibleStatus: state === "ready" ? "ready-to-accept-mailchimp-runtime" : `mailchimp-runtime-${state}`,
      acceptanceReadinessNextAction: blockedRows[0]?.nextAction ?? reviewRows[0]?.nextAction ?? "persist-acceptance-readiness-ledger",
      acceptanceReadinessBlockedKeys: blockedRows.map((row) => row.key),
      acceptanceReadinessReviewKeys: reviewRows.map((row) => row.key),
      acceptanceReadinessCommandId: command.id,
      verifierRecoveryHandoffId: verifierRecovery.id ?? verifierAcceptance.clientPatch?.verifierRecoveryHandoffId ?? null,
      verifierRecoveryState: verifierRecovery.state ?? verifierAcceptance.state ?? "unknown",
      verifierRecoveryResumeCursor: verifierRecovery.resumeCursor
        ?? verifierAcceptance.clientPatch?.verifierRecoveryResumeCursor
        ?? null,
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && rows.every((row) => row.restartSafe),
      replayCursor: stableId("acceptledgercursor", [
        ledgerId,
        restartRecoveryMatrix.replayCursor,
        rows.map((row) => row.resumeCursor).filter(Boolean).join(","),
      ]),
      onRestart: state === "ready" ? "load-acceptance-readiness-ledger" : "rebuild-acceptance-readiness-ledger",
      onDuplicateCommand: "return-existing-acceptance-readiness-ledger",
      externalWritesPerformed: false,
    },
  };
}

function buildClientHandoffPacket(planId, packageDescriptor, claimDescriptor, jobs, providerService, readiness, acceptance) {
  const manifestHandoff = packageDescriptor.providerClientHandoff ?? packageDescriptor.clientHandoff ?? {};
  const claimResume = claimDescriptor.clientResumeContract ?? {};
  const claimAcceptance = claimDescriptor.claimAcceptance ?? {};
  const releaseGate = packageDescriptor.lifecycleControls?.releaseGate ?? {};
  const settingsAdoption = packageDescriptor.lifecycleSettingsAdoption
    ?? packageDescriptor.lifecycleControls?.settingsAdoption
    ?? {};
  const operatorReleaseChecklist = packageDescriptor.lifecycleControls?.operatorReleaseChecklist
    ?? packageDescriptor.operatorReleaseChecklist
    ?? {};
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
    ...(operatorReleaseChecklist.id && operatorReleaseChecklist.ready !== true && operatorReleaseChecklist.state === "blocked"
      ? [`operator-release-checklist:${operatorReleaseChecklist.nextAction ?? "blocked"}`]
      : []),
    ...(settingsAdoption.state === "blocked"
      ? [`lifecycle-settings:${settingsAdoption.nextAction ?? "blocked"}`]
      : []),
  ];
  const reviewReasons = [
    ...(manifestHandoff.reviewReasons ?? []),
    ...(readiness.checks ?? [])
      .filter((check) => ["needs-review", "needs-approval", "needs-negotiation"].includes(check.status))
      .map((check) => `${check.name}:${check.nextAction}`),
    ...approvalJobs.map((job) => `approval-required:${job.id}`),
    ...(providerHealth.status === "degraded" ? providerHealth.actionableErrors?.map((error) => error.code) ?? [] : []),
    ...(operatorReleaseChecklist.id && ["review", "waiting"].includes(operatorReleaseChecklist.state)
      ? [`operator-release-checklist:${operatorReleaseChecklist.nextAction ?? "review"}`]
      : []),
    ...(settingsAdoption.id && ["review", "waiting"].includes(settingsAdoption.state)
      ? [`lifecycle-settings:${settingsAdoption.nextAction ?? settingsAdoption.state}`]
      : []),
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
      operatorReleaseChecklistId: operatorReleaseChecklist.id ?? null,
      operatorReleaseChecklistState: operatorReleaseChecklist.state ?? "unknown",
      operatorReleaseChecklistReady: operatorReleaseChecklist.ready === true,
      operatorReleaseChecklistCommandId: operatorReleaseChecklist.command?.id ?? null,
      operatorReleaseChecklistNextAction: operatorReleaseChecklist.nextAction ?? null,
      settingsAdoptionId: settingsAdoption.id ?? null,
      settingsAdoptionState: settingsAdoption.state ?? "unknown",
      settingsAdoptionReady: settingsAdoption.ready === true,
      settingsAdoptionCommandId: settingsAdoption.command?.id ?? null,
      settingsAdoptionNextAction: settingsAdoption.nextAction ?? null,
      settings: settingsAdoption.settings ?? null,
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
  if (String(reason).startsWith("lifecycle-settings")) return "review-lifecycle-settings";
  if (String(reason).startsWith("lifecycle")) return "repair-lifecycle-release-gate";
  if (String(reason).startsWith("operator-release-checklist")) return "review-operator-release-checklist";
  if (String(reason).startsWith("provider.")) return "repair-provider-health";
  if (String(reason).startsWith("missing-status-command")) return "repair-adapter-status-contract";
  return "review-readiness-checks";
}

function buildClientReadinessPacket(planId, packageDescriptor, claimDescriptor, jobs, providerService, readiness, acceptance, clientHandoff) {
  const packagePreview = packageDescriptor.previewContract ?? providerService.packagePreview ?? {};
  const claimAcceptance = claimDescriptor.claimAcceptance ?? {};
  const lifecycle = packageDescriptor.lifecycleControls ?? {};
  const releaseAcceptance = lifecycle.releaseAcceptance ?? packageDescriptor.releaseAcceptanceContract ?? {};
  const operatorReleaseChecklist = lifecycle.operatorReleaseChecklist ?? packageDescriptor.operatorReleaseChecklist ?? {};
  const settingsAdoption = lifecycle.settingsAdoption ?? packageDescriptor.lifecycleSettingsAdoption ?? {};
  const providerHealth = providerService.operationalHealth ?? {};
  const providerReplay = providerService.providerCapabilityReplay ?? {};
  const releaseGate = lifecycle.releaseGate ?? {};
  const verifierAcceptance = claimDescriptor.verifierAcceptance
    ?? claimDescriptor.verifierReadiness
    ?? claimAcceptance.verifierAcceptance
    ?? {};
  const rows = [
    {
      key: "claim-acceptance",
      label: "Claim Acceptance",
      sourceId: claimAcceptance.id ?? null,
      state: claimAcceptance.canAcknowledge === true ? "ready" : claimAcceptance.status === "review" ? "review" : "blocked",
      visibleStatus: claimAcceptance.visibleStatus ?? "claim-preview-unavailable",
      required: true,
      nextAction: claimAcceptance.nextAction ?? "review-claim-preview",
      commandId: claimAcceptance.acknowledgement?.command?.id ?? null,
      missingInputs: (claimAcceptance.acknowledgement?.requiredInputs ?? [])
        .filter((input) => input.required && (input.value === null || input.value === undefined || input.value === ""))
        .map((input) => input.name),
    },
    {
      key: "verifier-acceptance",
      label: "Verifier Acceptance",
      sourceId: verifierAcceptance.snapshotId ?? verifierAcceptance.acceptanceReviewId ?? null,
      state: verifierAcceptance.state === "blocked"
        ? "blocked"
        : verifierAcceptance.state === "review"
          ? "review"
          : "ready",
      visibleStatus: verifierAcceptance.visibleStatus ?? "verifier-acceptance-not-required",
      required: verifierAcceptance.required === true,
      nextAction: verifierAcceptance.nextAction ?? "continue-client-readiness",
      commandId: verifierAcceptance.commandIds?.[0] ?? null,
      missingInputs: [
        ...(verifierAcceptance.blockingRuleIds ?? []),
        ...(verifierAcceptance.pendingRuleIds ?? []),
      ],
    },
    {
      key: "package-preview",
      label: "Package Preview",
      sourceId: packagePreview.id ?? null,
      state: packagePreview.status === "ready" ? "ready" : packagePreview.status === "review" ? "review" : "blocked",
      visibleStatus: packagePreview.visibleStatus ?? "package-preview-unavailable",
      required: true,
      nextAction: packagePreview.nextAction ?? "review-package-preview",
      commandId: null,
      missingInputs: (packagePreview.acceptance?.requiredInputs ?? [])
        .filter((input) => input.required && (
          input.value === null
          || input.value === undefined
          || (Array.isArray(input.value) && input.value.length === 0)
        ))
        .map((input) => input.name),
    },
    {
      key: "provider-health",
      label: "Provider Health",
      sourceId: providerHealth.id ?? null,
      state: providerHealth.status === "healthy" ? "ready" : providerHealth.status === "degraded" ? "review" : "blocked",
      visibleStatus: providerHealth.status ?? "unknown",
      required: true,
      nextAction: providerHealth.nextAction ?? "review-provider-health",
      commandId: providerReplay.commands?.find((command) => command.type === "persist-provider-capability-ledger")?.id ?? null,
      missingInputs: providerHealth.actionableErrors
        ?.filter((error) => error.severity === "error")
        .map((error) => error.code) ?? [],
    },
    {
      key: "lifecycle-release",
      label: "Lifecycle Release",
      sourceId: releaseGate.id ?? lifecycle.stateId ?? null,
      state: releaseGate.state === "ready" || releaseGate.releaseAllowed === true
        ? "ready"
        : releaseGate.state === "review" || releaseGate.state === "scheduled"
          ? "review"
          : "blocked",
      visibleStatus: releaseGate.state ?? "unknown",
      required: lifecycle.enabled !== false,
      nextAction: releaseGate.nextAction ?? lifecycle.nextAction?.action ?? "prepare-manual-release",
      commandId: releaseGate.releaseCommandId ?? lifecycle.nextAction?.commandId ?? null,
      missingInputs: releaseGate.releaseAllowed === false ? [releaseGate.gateReason ?? "release-gate-blocked"] : [],
    },
    {
      key: "lifecycle-settings",
      label: "Lifecycle Settings",
      sourceId: settingsAdoption.id ?? null,
      state: settingsAdoption.ready === true
        ? "ready"
        : settingsAdoption.state === "review" || settingsAdoption.state === "waiting"
          ? "review"
          : "blocked",
      visibleStatus: settingsAdoption.visibleStatus ?? "lifecycle-settings-unavailable",
      required: Boolean(settingsAdoption.id),
      nextAction: settingsAdoption.nextAction ?? "review-lifecycle-settings",
      commandId: settingsAdoption.command?.id ?? null,
      missingInputs: [
        ...(settingsAdoption.validationSummary?.blockedKeys ?? []),
        ...(settingsAdoption.validationSummary?.waitingKeys ?? []),
      ],
    },
    {
      key: "release-acceptance",
      label: "Release Acceptance",
      sourceId: releaseAcceptance.id ?? null,
      state: releaseAcceptance.ready === true
        ? "ready"
        : ["review", "scheduled"].includes(releaseAcceptance.state)
          ? "review"
          : "blocked",
      visibleStatus: releaseAcceptance.visibleStatus ?? "release-acceptance-unavailable",
      required: Boolean(releaseAcceptance.id),
      nextAction: releaseAcceptance.nextAction ?? "review-release-acceptance",
      commandId: releaseAcceptance.command?.id ?? null,
      missingInputs: (releaseAcceptance.requiredInputs ?? [])
        .filter((input) => input.required && (
          input.value === null
          || input.value === undefined
          || (Array.isArray(input.value) && input.value.length === 0)
        ))
        .map((input) => input.name),
    },
    {
      key: "operator-release-checklist",
      label: "Operator Release Checklist",
      sourceId: operatorReleaseChecklist.id ?? null,
      state: operatorReleaseChecklist.ready === true
        ? "ready"
        : ["review", "waiting"].includes(operatorReleaseChecklist.state)
          ? "review"
          : "blocked",
      visibleStatus: operatorReleaseChecklist.visibleStatus ?? "operator-checklist-unavailable",
      required: Boolean(operatorReleaseChecklist.id),
      nextAction: operatorReleaseChecklist.nextAction ?? "review-operator-release-checklist",
      commandId: operatorReleaseChecklist.command?.id ?? null,
      missingInputs: operatorReleaseChecklist.requiredInputNames ?? [],
    },
    {
      key: "client-handoff",
      label: "Client Handoff",
      sourceId: clientHandoff.id ?? null,
      state: clientHandoff.ready === true ? "ready" : clientHandoff.state === "review" ? "review" : "blocked",
      visibleStatus: clientHandoff.visibleStatus ?? "client-handoff-unavailable",
      required: true,
      nextAction: clientHandoff.nextAction ?? "review-client-handoff",
      commandId: clientHandoff.commands?.[0]?.id ?? null,
      missingInputs: clientHandoff.requiredInputs
        ?.filter((input) => input.required && (
          input.value === null
          || input.value === undefined
          || (Array.isArray(input.value) && input.value.length === 0)
        ))
        .map((input) => input.name) ?? [],
    },
  ].filter((row) => row.required || row.sourceId);
  const operationRows = jobs.map((job, index) => ({
    sequence: index + 1,
    jobId: job.id,
    operation: job.operation,
    permissionDecision: job.permissions.decision,
    clientOperationStateId: job.clientOperationState?.id ?? null,
    visibleStatus: job.clientOperationState?.visibleStatus ?? job.statusProjection?.clientVisibleStatus,
    nextAction: job.clientOperationState?.nextAction ?? job.statusProjection?.restartAction,
    adapterStatusState: job.adapterStatusHandoff.state,
    statusCommandId: job.adapterStatusHandoff.commands.statusCommandId,
    resumeCursor: job.adapterStatusHandoff.recovery.resumeCursor,
    restartSafe: job.statusProjection?.restartSafe === true,
  }));
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const reviewRows = rows.filter((row) => row.state === "review");
  const blockedOperations = operationRows.filter((row) => (
    row.permissionDecision === "deny" || row.adapterStatusState === "blocked" || row.restartSafe !== true
  ));
  const waitingOperations = operationRows.filter((row) => (
    row.permissionDecision === "needs-approval" || row.adapterStatusState === "waiting-for-approval"
  ));
  const state = blockedRows.length > 0 || blockedOperations.length > 0
    ? "blocked"
    : reviewRows.length > 0 || waitingOperations.length > 0
      ? "review"
      : acceptance.canAccept
        ? "ready"
        : "waiting";
  const readinessKey = stableId("clientreadykey", [
    planId,
    readiness.id,
    acceptance.id,
    clientHandoff.id,
    state,
  ]);
  const command = {
    id: stableId("clientcmd", [readinessKey, "persist-client-readiness-packet"]),
    type: "persist-client-readiness-packet",
    idempotencyKey: stableId("idem", [readinessKey, "persist-client-readiness-packet"]),
    statusAfterReplay: state === "ready" ? "client-readiness-ready" : `client-readiness-${state}`,
    writes: ["clientReadinessPacketId", "readinessRows", "operationRows", "nextAction"],
    conflict: "return-existing",
  };
  return {
    id: stableId("clientready", [readinessKey, rows.map((row) => `${row.key}:${row.state}`).join(",")]),
    product: "mailchimp",
    contractVersion: "aios.mailchimp.executor-client-readiness.v1",
    planId,
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "ready-for-runtime-start"
      : state === "review"
        ? "review-before-runtime-start"
        : state === "waiting"
          ? "waiting-before-runtime-start"
          : "blocked-before-runtime-start",
    nextAction: blockedRows[0]?.nextAction
      ?? blockedOperations[0]?.nextAction
      ?? reviewRows[0]?.nextAction
      ?? waitingOperations[0]?.nextAction
      ?? (state === "ready" ? "persist-client-readiness-packet" : acceptance.acceptAction),
    rows,
    operationRows,
    command,
    clientPatch: {
      clientReadinessPacketId: stableId("clientreadypatch", [readinessKey, state]),
      clientReadinessState: state,
      clientReadinessReady: state === "ready",
      clientReadinessNextAction: state === "ready" ? "persist-client-readiness-packet" : null,
      blockedReadinessKeys: blockedRows.map((row) => row.key),
      reviewReadinessKeys: reviewRows.map((row) => row.key),
      blockedJobIds: blockedOperations.map((row) => row.jobId),
      waitingJobIds: waitingOperations.map((row) => row.jobId),
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && operationRows.every((row) => row.restartSafe),
      onRestart: state === "ready" ? "return-existing-client-readiness" : "reload-client-readiness-packet",
      onDuplicateCommand: "return-existing-client-readiness-packet",
      resumeCursor: claimDescriptor.requestState?.resumeCursor ?? null,
    },
  };
}

function buildClientWorkflowHandoffGate(
  planId,
  packageDescriptor,
  claimDescriptor,
  jobs,
  providerService,
  readiness,
  acceptance,
  clientHandoff,
  clientReadiness,
  restartProjection,
) {
  const providerHealth = providerService.operationalHealth ?? {};
  const providerReplay = providerService.providerCapabilityReplay ?? {};
  const externalHandoff = providerService.externalHandoff ?? {};
  const releaseGate = packageDescriptor.lifecycleControls?.releaseGate ?? {};
  const claimResume = claimDescriptor.clientResumeContract ?? {};
  const claimState = claimDescriptor.requestState ?? {};
  const workflowRows = [
    {
      key: "claim-resume",
      state: claimState.status === "ready-for-runtime" && claimResume.screenState === "ready" ? "ready" : "blocked",
      sourceId: claimResume.id ?? claimState.version ?? null,
      visibleStatus: claimResume.visibleStatus ?? claimState.status ?? "claim-state-unavailable",
      nextAction: claimResume.primaryAction ?? claimState.recoveryPaths?.onRestart ?? "collect-claim-evidence",
      commandId: claimState.commands?.find((command) => command.type === "persist-claim-state")?.id ?? null,
      resumeCursor: claimState.resumeCursor ?? null,
      blockingReason: claimState.status === "needs-evidence" ? "claim-evidence-required" : null,
    },
    {
      key: "provider-health",
      state: providerHealth.status === "healthy" ? "ready" : providerHealth.status === "degraded" ? "waiting" : "blocked",
      sourceId: providerHealth.id ?? null,
      visibleStatus: providerHealth.status ?? "provider-health-unavailable",
      nextAction: providerHealth.nextAction ?? "review-provider-health",
      commandId: providerReplay.commands?.find((command) => command.type === "persist-provider-capability-ledger")?.id ?? null,
      resumeCursor: providerReplay.resumeCursor ?? null,
      blockingReason: providerHealth.status === "unhealthy" ? providerHealth.blockedReason ?? "provider-health-unhealthy" : null,
    },
    {
      key: "client-handoff",
      state: clientHandoff.ready === true ? "ready" : clientHandoff.state === "review" || clientHandoff.state === "waiting-for-approval" ? "waiting" : "blocked",
      sourceId: clientHandoff.id ?? null,
      visibleStatus: clientHandoff.visibleStatus ?? "client-handoff-unavailable",
      nextAction: clientHandoff.nextAction ?? "review-client-handoff",
      commandId: clientHandoff.commands?.[0]?.id ?? null,
      resumeCursor: clientHandoff.clientState?.claimResumeCursor ?? null,
      blockingReason: clientHandoff.blockers?.[0] ?? null,
    },
    {
      key: "client-readiness",
      state: clientReadiness.ready === true ? "ready" : clientReadiness.state === "review" || clientReadiness.state === "waiting" ? "waiting" : "blocked",
      sourceId: clientReadiness.id ?? null,
      visibleStatus: clientReadiness.visibleStatus ?? "client-readiness-unavailable",
      nextAction: clientReadiness.nextAction ?? "review-client-readiness",
      commandId: clientReadiness.command?.id ?? null,
      resumeCursor: clientReadiness.restartSemantics?.resumeCursor ?? null,
      blockingReason: clientReadiness.clientPatch?.blockedReadinessKeys?.[0] ?? null,
    },
    {
      key: "restart-replay",
      state: restartProjection.restartSafe === true ? "ready" : "blocked",
      sourceId: restartProjection.stateVersion ?? null,
      visibleStatus: restartProjection.restartStatus ?? "restart-projection-unavailable",
      nextAction: restartProjection.recoveryAction ?? "reload-status-ledger",
      commandId: restartProjection.commandLedgers?.find((ledger) => ledger.commandIds?.length > 0)?.commandIds?.[0] ?? null,
      resumeCursor: restartProjection.replayCursor ?? null,
      blockingReason: restartProjection.restartSafe === true ? null : "restart-projection-not-safe",
    },
  ];
  const jobRows = jobs.map((job, index) => {
    const clientState = job.clientOperationState ?? {};
    const blocked = job.permissions.decision === "deny"
      || job.adapterStatusHandoff.state === "blocked"
      || job.statusProjection.restartSafe !== true;
    const waiting = !blocked && (
      job.permissions.decision === "needs-approval"
      || job.adapterStatusHandoff.state === "waiting-for-approval"
      || clientState.workflowState === "waiting-for-approval"
    );
    const state = blocked ? "blocked" : waiting ? "waiting" : "ready";
    return {
      sequence: index + 1,
      jobId: job.id,
      operation: job.operation,
      state,
      workflowState: clientState.workflowState ?? "unknown",
      visibleStatus: clientState.visibleStatus ?? job.statusProjection.clientVisibleStatus,
      nextAction: state === "blocked"
        ? clientState.nextAction ?? "repair-runtime-workflow-state"
        : state === "waiting"
          ? clientState.nextAction ?? "resume-runtime-workflow-state"
          : "return-existing-client-workflow-state",
      permissionDecision: job.permissions.decision,
      adapterStatusState: job.adapterStatusHandoff.state,
      checkpointKey: job.stateContract?.checkpointKey ?? null,
      commandLedgerKey: job.stateContract?.commandState?.ledgerKey ?? null,
      adapterStatusResumeCursor: job.adapterStatusHandoff.recovery.resumeCursor,
      replayCursor: job.recovery.replayCursor,
      restartSafe: job.statusProjection.restartSafe === true,
      commandIds: job.stateContract?.commandState?.commands?.map((command) => command.id) ?? [],
      blockingReason: blocked
        ? job.permissions.decision === "deny"
          ? "permission-denied"
          : job.adapterStatusHandoff.state === "blocked"
            ? "adapter-status-blocked"
            : "restart-unsafe"
        : null,
    };
  });
  const blockedRows = workflowRows.filter((row) => row.state === "blocked");
  const waitingRows = workflowRows.filter((row) => row.state === "waiting");
  const blockedJobs = jobRows.filter((row) => row.state === "blocked");
  const waitingJobs = jobRows.filter((row) => row.state === "waiting");
  const state = blockedRows.length > 0 || blockedJobs.length > 0
    ? "blocked"
    : waitingRows.length > 0 || waitingJobs.length > 0
      ? "waiting"
      : acceptance.canAccept && readiness.status === "ready"
        ? "ready"
        : "review";
  const gateScope = [
    planId,
    clientReadiness.id,
    externalHandoff.handoffId,
    restartProjection.stateVersion,
    state,
  ];
  const commands = [
    {
      id: stableId("workflowcmd", [...gateScope, "persist-workflow-handoff-gate"]),
      type: "persist-client-workflow-handoff-gate",
      idempotencyKey: stableId("idem", [...gateScope, "persist-workflow-handoff-gate"]),
      statusAfterReplay: state === "ready" ? "client-workflow-ready" : `client-workflow-${state}`,
      writes: ["workflowRows", "jobRows", "clientPatch", "resumeCursors"],
      conflict: "return-existing",
    },
    ...(state === "ready" ? [{
      id: stableId("workflowcmd", [...gateScope, "adopt-runtime-workflow"]),
      type: "adopt-runtime-workflow-handoff",
      idempotencyKey: stableId("idem", [...gateScope, "adopt-runtime-workflow"]),
      statusAfterReplay: "runtime-workflow-adopted",
      writes: ["providerHandoffId", "adapterStatusResumeCursors", "clientVisibleStatus"],
      conflict: "return-existing",
    }] : []),
    ...(waitingJobs.length > 0 ? [{
      id: stableId("workflowcmd", [...gateScope, "persist-waiting-workflow-jobs", waitingJobs.map((job) => job.jobId).join(",")]),
      type: "persist-waiting-workflow-jobs",
      idempotencyKey: stableId("idem", [...gateScope, "persist-waiting-workflow-jobs", waitingJobs.map((job) => job.jobId).join(",")]),
      statusAfterReplay: "client-workflow-waiting",
      writes: ["waitingJobIds", "approvalResumeCursors", "nextAction"],
      conflict: "return-existing",
    }] : []),
  ];
  return {
    id: stableId("workflowgate", [
      ...gateScope,
      workflowRows.map((row) => `${row.key}:${row.state}`).join(","),
      jobRows.map((row) => `${row.jobId}:${row.state}`).join(","),
    ]),
    product: "mailchimp",
    contractVersion: "aios.mailchimp.client-workflow-handoff-gate.v1",
    planId,
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "client-workflow-ready"
      : state === "waiting"
        ? "client-workflow-waiting"
        : state === "review"
          ? "client-workflow-review"
          : "client-workflow-blocked",
    nextAction: blockedRows[0]?.nextAction
      ?? blockedJobs[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? waitingJobs[0]?.nextAction
      ?? (state === "ready" ? "adopt-runtime-workflow-handoff" : "review-client-workflow-handoff"),
    workflowRows,
    jobRows,
    commands,
    resumeCursors: [...new Set([
      claimState.resumeCursor,
      restartProjection.replayCursor,
      providerReplay.resumeCursor,
      ...jobRows.map((row) => row.adapterStatusResumeCursor),
    ].filter(Boolean))].sort(),
    clientPatch: {
      workflowHandoffGateId: stableId("workflowpatch", [planId, state, clientReadiness.id]),
      workflowHandoffState: state,
      workflowHandoffReady: state === "ready",
      workflowHandoffNextAction: state === "ready" ? "adopt-runtime-workflow-handoff" : null,
      blockedWorkflowKeys: blockedRows.map((row) => row.key),
      waitingWorkflowKeys: waitingRows.map((row) => row.key),
      blockedJobIds: blockedJobs.map((row) => row.jobId),
      waitingJobIds: waitingJobs.map((row) => row.jobId),
      resumeCursors: [...new Set(jobRows.map((row) => row.adapterStatusResumeCursor).filter(Boolean))].sort(),
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && restartProjection.restartSafe === true,
      onRestart: state === "ready" ? "return-existing-workflow-handoff" : "reload-client-workflow-handoff-gate",
      onDuplicateCommand: "return-existing-client-workflow-handoff-gate",
      replayCursor: restartProjection.replayCursor ?? null,
    },
  };
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
  const boundaryHealth = buildJobBoundaryHealthEnvelope(
    jobId,
    operation,
    packageDescriptor,
    claimDescriptor,
    tenantContext,
    permissionEnvelope,
    adapterStatusHandoff,
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
  const clientRecoveryBinding = buildJobClientRecoveryBinding(
    jobShell,
    operation,
    claimDescriptor,
    permissionEnvelope,
  );
  const providerCapabilityGrant = {
    requiredCapabilities: requiredCapabilities.map((capability) => capability.name).sort(),
    persistKeys: requiredCapabilities.map((capability) => stableId("capgrantkey", [
      tenantContext.tenantId,
      tenantContext.workspaceId,
      capabilityProviderName(capability.name, packageDescriptor.syncServiceContract ?? {}),
      capability.name,
    ])).sort(),
    replayState: permissionEnvelope.decision === "deny"
      ? "blocked"
      : permissionEnvelope.decision === "needs-approval"
        ? "waiting-for-approval"
        : "ready",
  };
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
      providerCapabilityGrantKeys: providerCapabilityGrant.persistKeys,
      providerCapabilityGrantState: providerCapabilityGrant.replayState,
      boundaryHealthId: boundaryHealth.id,
      boundaryHealthState: boundaryHealth.state,
      boundaryHealthNextAction: boundaryHealth.nextAction,
      tenantPermissionReplayLedgerId: boundaryHealth.tenantPermissionReplay?.ledgerId ?? null,
      tenantPermissionReplayRowState: boundaryHealth.tenantPermissionReplay?.rowState ?? null,
      restartReplayManifestId: operation.stateContract?.replayManifest?.id ?? null,
      dryRunSupported: true,
      clientOperationStateId: clientOperationState.id,
      clientRecoveryBindingId: clientRecoveryBinding.id,
      clientRecoveryResumeCursor: clientRecoveryBinding.resumeCursor,
      clientRecoveryNextAction: clientRecoveryBinding.nextAction,
    },
    clientOperationState,
    clientRecoveryBinding,
    boundaryHealth,
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
      providerCapabilityGrant,
      boundaryHealth: {
        id: boundaryHealth.id,
        state: boundaryHealth.state,
        nextAction: boundaryHealth.nextAction,
        blockedReasons: boundaryHealth.blockedReasons,
        waitingReasons: boundaryHealth.waitingReasons,
        tenantPermissionReplay: boundaryHealth.tenantPermissionReplay,
        restartSafe: boundaryHealth.restartSemantics.restartSafe,
      },
      clientRecoveryBinding: {
        id: clientRecoveryBinding.id,
        state: clientRecoveryBinding.state,
        resumeCursor: clientRecoveryBinding.resumeCursor,
        nextAction: clientRecoveryBinding.nextAction,
        restartSafe: clientRecoveryBinding.restartSemantics.restartSafe,
      },
      restartReplayManifestId: operation.stateContract?.replayManifest?.id ?? null,
      replayCursor: statusProjection.ledgerKey
        ? stableId("replay", [jobId, statusProjection.ledgerKey, statusProjection.claimResumeCursor])
        : null,
    },
    truthBoundary,
  };
}

function buildPlanClientRecoveryHandoff(planId, claimDescriptor, jobs, restartRecoveryMatrix) {
  const claimSnapshot = claimDescriptor.clientRecoverySnapshot ?? claimDescriptor.clientRecovery ?? {};
  const jobRows = jobs.map((job, index) => {
    const binding = job.clientRecoveryBinding ?? {};
    const state = binding.state
      ?? (job.permissions.decision === "deny"
        ? "blocked"
        : job.permissions.decision === "needs-approval"
          ? "waiting"
          : "ready");
    return {
      sequence: index + 1,
      jobId: job.id,
      operation: job.operation,
      state,
      sourceBindingId: binding.id ?? null,
      clientOperationStateId: job.clientOperationState?.id ?? null,
      visibleStatus: job.clientOperationState?.visibleStatus ?? job.statusProjection?.clientVisibleStatus,
      nextAction: binding.nextAction ?? job.clientOperationState?.nextAction ?? job.statusProjection?.restartAction,
      resumeCursor: binding.resumeCursor ?? job.recovery?.adapterStatusResumeCursor ?? null,
      adapterStatusResumeCursor: job.recovery?.adapterStatusResumeCursor ?? null,
      blockedKeys: binding.blockedKeys ?? [],
      waitingKeys: binding.waitingKeys ?? [],
      commandIds: binding.commandIds ?? job.stateContract?.commandState?.commands?.map((command) => command.id) ?? [],
      restartSafe: binding.restartSemantics?.restartSafe === true,
    };
  });
  const blockedRows = jobRows.filter((row) => row.state === "blocked");
  const waitingRows = jobRows.filter((row) => ["waiting", "review"].includes(row.state));
  const state = claimSnapshot.state === "blocked" || blockedRows.length > 0
    ? "blocked"
    : claimSnapshot.state === "waiting" || waitingRows.length > 0
      ? "waiting"
      : "ready";
  const resumeCursors = [...new Set([
    claimSnapshot.resumeCursor,
    restartRecoveryMatrix?.replayCursor,
    ...jobRows.map((row) => row.resumeCursor),
    ...jobRows.map((row) => row.adapterStatusResumeCursor),
  ].filter(Boolean))].sort();
  return {
    protocol: "aios.mailchimp.executor-client-recovery-handoff.v1",
    id: stableId("planrecover", [
      planId,
      claimSnapshot.id,
      state,
      jobRows.map((row) => `${row.jobId}:${row.state}:${row.sourceBindingId}`).join(","),
    ]),
    product: "mailchimp",
    planId,
    state,
    ready: state === "ready",
    sourceClaimRecoverySnapshotId: claimSnapshot.id ?? null,
    claimStateKey: claimDescriptor.requestState?.key ?? null,
    continuationToken: claimDescriptor.clientRuntime?.continuationToken ?? null,
    resumeCursor: stableId("planrecovercursor", [
      planId,
      claimSnapshot.resumeCursor,
      restartRecoveryMatrix?.replayCursor,
      resumeCursors.join(","),
    ]),
    resumeCursors,
    rows: jobRows,
    blockedJobIds: blockedRows.map((row) => row.jobId),
    waitingJobIds: waitingRows.map((row) => row.jobId),
    blockedKeys: [...new Set([
      ...(claimSnapshot.blockedKeys ?? []),
      ...jobRows.flatMap((row) => row.blockedKeys),
    ])].sort(),
    waitingKeys: [...new Set([
      ...(claimSnapshot.waitingKeys ?? []),
      ...jobRows.flatMap((row) => row.waitingKeys),
    ])].sort(),
    commandIds: [...new Set([
      ...(claimSnapshot.commandIds ?? []),
      ...jobRows.flatMap((row) => row.commandIds),
    ])].sort(),
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? claimSnapshot.nextAction
      ?? "continue-client-runtime-handoff",
    clientPatch: {
      executorClientRecoveryId: stableId("planrecoverpatch", [planId, state]),
      executorClientRecoveryState: state,
      executorClientRecoveryReady: state === "ready",
      executorClientRecoveryNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? "continue-client-runtime-handoff",
      executorClientRecoveryBlockedJobs: blockedRows.map((row) => row.jobId),
      executorClientRecoveryWaitingJobs: waitingRows.map((row) => row.jobId),
      executorClientRecoveryBlockedKeys: [...new Set(jobRows.flatMap((row) => row.blockedKeys))].sort(),
      executorClientRecoveryWaitingKeys: [...new Set(jobRows.flatMap((row) => row.waitingKeys))].sort(),
      executorClientRecoveryResumeCursor: resumeCursors[0] ?? null,
    },
    restartSemantics: {
      restartSafe: state !== "blocked"
        && claimSnapshot.restartSemantics?.restartSafe !== false
        && jobRows.every((row) => row.restartSafe),
      onRestart: state === "ready" ? "return-existing-executor-client-recovery" : "reload-executor-client-recovery",
      onDuplicateCommand: "return-existing-executor-client-recovery-command",
      restartRecoveryMatrixId: restartRecoveryMatrix?.id ?? null,
    },
  };
}

function buildExecutorWorkflowCheckpointHandoff(input) {
  const {
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    providerService,
    readinessSummary,
    acceptanceContract,
    restartRecoveryMatrix,
    clientRecoveryHandoff,
    clientHandoffPacket,
    clientReadinessPacket,
    clientWorkflowHandoffGate,
    claimOperatorReadinessGate,
    operationalExportGate,
  } = input;
  const claimWorkflow = claimDescriptor.workflowCheckpointHandoff
    ?? claimDescriptor.workflowCheckpoint
    ?? {};
  const releaseGate = packageDescriptor.lifecycleControls?.releaseGate ?? {};
  const providerHandoff = providerService.externalHandoff ?? {};
  const jobCheckpointRows = jobs.map((job, index) => {
    const recoveryBinding = job.clientRecoveryBinding ?? {};
    const statusProjection = job.statusProjection ?? {};
    const adapterHandoff = job.adapterStatusHandoff ?? {};
    const boundaryHealth = job.boundaryHealthEnvelope ?? {};
    const blocked = job.permissions?.decision === "deny"
      || recoveryBinding.state === "blocked"
      || boundaryHealth.state === "blocked"
      || adapterHandoff.state === "blocked";
    const waiting = job.permissions?.decision === "needs-approval"
      || ["waiting", "review"].includes(recoveryBinding.state)
      || boundaryHealth.state === "waiting"
      || adapterHandoff.state === "waiting-for-approval";
    const state = blocked ? "blocked" : waiting ? "waiting" : "ready";
    return {
      sequence: index + 1,
      key: `job:${job.id}`,
      jobId: job.id,
      operation: job.operation,
      state,
      sourceId: recoveryBinding.id ?? statusProjection.operationStatusLedgerId ?? job.id,
      visibleStatus: recoveryBinding.state
        ? recoveryBinding.state
        : job.clientOperationState?.visibleStatus ?? statusProjection.clientVisibleStatus ?? state,
      nextAction: recoveryBinding.nextAction
        ?? job.clientOperationState?.nextAction
        ?? statusProjection.restartAction
        ?? "resume-operation",
      resumeCursor: recoveryBinding.resumeCursor
        ?? job.recovery?.adapterStatusResumeCursor
        ?? adapterHandoff.recovery?.resumeCursor
        ?? null,
      commandIds: recoveryBinding.commandIds
        ?? job.stateContract?.commandState?.commands?.map((command) => command.id)
        ?? [],
      blockers: [
        ...(job.permissions?.deniedReasons ?? []),
        ...(recoveryBinding.blockedKeys ?? []),
        ...(boundaryHealth.blockedReasons ?? []),
        ...(adapterHandoff.state === "blocked" ? ["adapter-status-handoff-blocked"] : []),
      ],
      waiting: [
        ...(job.permissions?.decision === "needs-approval" ? ["tenant-approval-required"] : []),
        ...(recoveryBinding.waitingKeys ?? []),
        ...(boundaryHealth.waitingReasons ?? []),
        ...(adapterHandoff.state === "waiting-for-approval" ? ["adapter-status-waiting-for-approval"] : []),
      ],
      restartSafe: Boolean(recoveryBinding.restartSemantics?.restartSafe === true
        && statusProjection.restartSafe === true
        && adapterHandoff.recovery?.resumeCursor),
    };
  });
  const rows = [
    {
      key: "claim-workflow-checkpoint",
      state: claimWorkflow.ready ? "ready" : claimWorkflow.state ?? "unknown",
      sourceId: claimWorkflow.id ?? null,
      visibleStatus: claimWorkflow.visibleStatus ?? claimWorkflow.state ?? "unknown",
      nextAction: claimWorkflow.nextAction ?? "load-claim-workflow-checkpoints",
      resumeCursor: claimWorkflow.resumeCursors?.[0]
        ?? claimDescriptor.requestState?.resumeCursor
        ?? null,
      commandIds: claimWorkflow.commandIds ?? [],
      blockers: claimWorkflow.blockedKeys ?? [],
      waiting: claimWorkflow.waitingKeys ?? [],
      restartSafe: claimWorkflow.restartSemantics?.restartSafe !== false,
    },
    {
      key: "executor-client-recovery",
      state: clientRecoveryHandoff.ready ? "ready" : clientRecoveryHandoff.state,
      sourceId: clientRecoveryHandoff.id,
      visibleStatus: clientRecoveryHandoff.state === "ready" ? "executor-client-recovery-ready" : `executor-client-recovery-${clientRecoveryHandoff.state}`,
      nextAction: clientRecoveryHandoff.nextAction,
      resumeCursor: clientRecoveryHandoff.resumeCursor,
      commandIds: clientRecoveryHandoff.commandIds ?? [],
      blockers: clientRecoveryHandoff.blockedKeys ?? [],
      waiting: clientRecoveryHandoff.waitingKeys ?? [],
      restartSafe: clientRecoveryHandoff.restartSemantics?.restartSafe !== false,
    },
    {
      key: "restart-recovery-matrix",
      state: restartRecoveryMatrix.restartSafe ? "ready" : restartRecoveryMatrix.state,
      sourceId: restartRecoveryMatrix.id,
      visibleStatus: restartRecoveryMatrix.state,
      nextAction: restartRecoveryMatrix.nextAction,
      resumeCursor: restartRecoveryMatrix.replayCursor,
      commandIds: restartRecoveryMatrix.commands?.map((command) => command.id) ?? [],
      blockers: restartRecoveryMatrix.clientPatch?.blockedJobIds ?? [],
      waiting: restartRecoveryMatrix.clientPatch?.waitingJobIds ?? [],
      restartSafe: restartRecoveryMatrix.restartSafe === true,
    },
    {
      key: "client-handoff-packet",
      state: clientHandoffPacket.ready ? "ready" : clientHandoffPacket.state,
      sourceId: clientHandoffPacket.id,
      visibleStatus: clientHandoffPacket.visibleStatus,
      nextAction: clientHandoffPacket.nextAction,
      resumeCursor: clientHandoffPacket.clientState?.claimResumeCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
      commandIds: clientHandoffPacket.commands?.map((command) => command.id) ?? [],
      blockers: clientHandoffPacket.blockers ?? [],
      waiting: clientHandoffPacket.reviewReasons ?? [],
      restartSafe: clientHandoffPacket.state !== "blocked",
    },
    {
      key: "client-readiness",
      state: clientReadinessPacket.ready ? "ready" : clientReadinessPacket.state,
      sourceId: clientReadinessPacket.id,
      visibleStatus: clientReadinessPacket.visibleStatus,
      nextAction: clientReadinessPacket.nextAction,
      resumeCursor: clientReadinessPacket.clientPatch?.resumeCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
      commandIds: [clientReadinessPacket.command?.id].filter(Boolean),
      blockers: clientReadinessPacket.clientPatch?.blockedReadinessKeys ?? [],
      waiting: clientReadinessPacket.clientPatch?.reviewReadinessKeys ?? [],
      restartSafe: clientReadinessPacket.restartSemantics?.restartSafe !== false,
    },
    {
      key: "workflow-handoff-gate",
      state: clientWorkflowHandoffGate.ready ? "ready" : clientWorkflowHandoffGate.state,
      sourceId: clientWorkflowHandoffGate.id,
      visibleStatus: clientWorkflowHandoffGate.visibleStatus,
      nextAction: clientWorkflowHandoffGate.nextAction,
      resumeCursor: clientWorkflowHandoffGate.restartSemantics?.replayCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
      commandIds: [clientWorkflowHandoffGate.command?.id].filter(Boolean),
      blockers: clientWorkflowHandoffGate.clientPatch?.blockedWorkflowKeys ?? [],
      waiting: clientWorkflowHandoffGate.clientPatch?.waitingWorkflowKeys ?? [],
      restartSafe: clientWorkflowHandoffGate.restartSemantics?.restartSafe !== false,
    },
    {
      key: "claim-operator-readiness",
      state: claimOperatorReadinessGate.ready ? "ready" : claimOperatorReadinessGate.state,
      sourceId: claimOperatorReadinessGate.id,
      visibleStatus: claimOperatorReadinessGate.visibleStatus,
      nextAction: claimOperatorReadinessGate.nextAction,
      resumeCursor: claimOperatorReadinessGate.clientPatch?.resumeCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
      commandIds: [claimOperatorReadinessGate.command?.id].filter(Boolean),
      blockers: claimOperatorReadinessGate.clientPatch?.blockedReadinessKeys ?? [],
      waiting: claimOperatorReadinessGate.clientPatch?.waitingReadinessKeys ?? [],
      restartSafe: claimOperatorReadinessGate.restartSemantics?.restartSafe !== false,
    },
    {
      key: "operational-export",
      state: operationalExportGate.ready ? "ready" : operationalExportGate.state,
      sourceId: operationalExportGate.id,
      visibleStatus: operationalExportGate.visibleStatus,
      nextAction: operationalExportGate.nextAction,
      resumeCursor: operationalExportGate.restartSemantics?.replayCursor ?? restartRecoveryMatrix.replayCursor ?? null,
      commandIds: operationalExportGate.commands?.map((command) => command.id) ?? [],
      blockers: operationalExportGate.blockedKeys ?? [],
      waiting: operationalExportGate.waitingKeys ?? [],
      restartSafe: operationalExportGate.restartSemantics?.restartSafe !== false,
    },
    ...jobCheckpointRows,
  ].map((row, index) => ({
    sequence: index + 1,
    rowId: stableId("executorworkflowrow", [planId, row.key, row.state, row.sourceId]),
    ...row,
  }));
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => ["waiting", "review"].includes(row.state));
  const state = blockedRows.length
    ? "blocked"
    : waitingRows.length
      ? "waiting"
      : releaseGate.state === "scheduled" || providerHandoff.state === "scheduled"
        ? "scheduled"
        : "ready";
  const handoffId = stableId("executorworkflow", [
    planId,
    claimWorkflow.id,
    clientRecoveryHandoff.id,
    restartRecoveryMatrix.id,
    state,
    rows.map((row) => `${row.key}:${row.state}:${row.sourceId}`).join(","),
  ]);
  const command = {
    id: stableId("executorworkflowcmd", [handoffId, "persist-executor-workflow-checkpoints"]),
    type: "persist-executor-workflow-checkpoints",
    idempotencyKey: stableId("idem", [handoffId, "persist-executor-workflow-checkpoints"]),
    statusAfterReplay: state === "ready" ? "executor-workflow-ready" : `executor-workflow-${state}`,
    writes: ["executorWorkflowRows", "clientVisibleStatus", "resumeCursors", "jobCheckpointStates"],
    conflict: "return-existing",
  };
  const resumeCursors = [...new Set(rows.map((row) => row.resumeCursor).filter(Boolean))].sort();
  return {
    protocol: "aios.mailchimp.executor-workflow-checkpoint-handoff.v1",
    id: handoffId,
    product: "mailchimp",
    planId,
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "executor-workflow-ready"
      : state === "scheduled"
        ? "executor-workflow-scheduled"
        : `executor-workflow-${state}`,
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? (state === "scheduled" ? "wait-for-release-schedule" : "publish-executor-workflow-checkpoints"),
    claimWorkflowCheckpointId: claimWorkflow.id ?? null,
    clientRecoveryHandoffId: clientRecoveryHandoff.id,
    restartRecoveryMatrixId: restartRecoveryMatrix.id,
    readinessSummaryId: readinessSummary.id ?? null,
    acceptanceContractId: acceptanceContract.id ?? null,
    rows,
    jobRows: jobCheckpointRows,
    blockedKeys: [...new Set(blockedRows.map((row) => row.key))].sort(),
    waitingKeys: [...new Set(waitingRows.map((row) => row.key))].sort(),
    blockedJobIds: [...new Set(jobCheckpointRows.filter((row) => row.state === "blocked").map((row) => row.jobId))].sort(),
    waitingJobIds: [...new Set(jobCheckpointRows.filter((row) => row.state === "waiting").map((row) => row.jobId))].sort(),
    resumeCursors,
    commandIds: [...new Set([command.id, ...rows.flatMap((row) => row.commandIds)])].sort(),
    command,
    clientPatch: {
      executorWorkflowCheckpointHandoffId: handoffId,
      executorWorkflowCheckpointState: state,
      executorWorkflowCheckpointReady: state === "ready",
      executorWorkflowCheckpointVisibleStatus: state === "ready" ? "executor-workflow-ready" : `executor-workflow-${state}`,
      executorWorkflowCheckpointNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? "publish-executor-workflow-checkpoints",
      executorWorkflowCheckpointBlockedKeys: blockedRows.map((row) => row.key),
      executorWorkflowCheckpointWaitingKeys: waitingRows.map((row) => row.key),
      executorWorkflowCheckpointBlockedJobs: jobCheckpointRows.filter((row) => row.state === "blocked").map((row) => row.jobId),
      executorWorkflowCheckpointWaitingJobs: jobCheckpointRows.filter((row) => row.state === "waiting").map((row) => row.jobId),
      executorWorkflowCheckpointResumeCursor: resumeCursors[0] ?? null,
      executorWorkflowCheckpointCommandId: command.id,
    },
    counters: {
      rows: rows.length,
      jobs: jobCheckpointRows.length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      restartSafeRows: rows.filter((row) => row.restartSafe).length,
      resumeCursors: resumeCursors.length,
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && rows.every((row) => row.restartSafe),
      onRestart: state === "ready" ? "load-executor-workflow-checkpoints" : "reload-executor-workflow-checkpoints",
      onDuplicateCommand: "return-existing-executor-workflow-checkpoints",
      onMissingClaimWorkflow: "rebuild-from-claim-client-recovery",
      externalWritesPerformed: false,
    },
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

function buildLifecycleRuntimeControlPacket(input) {
  const {
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    issues,
    providerService,
    readinessSummary,
    acceptanceContract,
  } = input;
  const lifecycle = packageDescriptor.lifecycleControls ?? {};
  const settings = {
    enabled: lifecycle.enabled !== false,
    command: lifecycle.command ?? "prepare",
    releasePolicy: lifecycle.releasePolicy ?? "manual-approval",
    schedule: lifecycle.schedule ?? { mode: "manual" },
    maxConcurrentJobs: lifecycle.concurrency?.maxConcurrentJobs ?? lifecycle.maxConcurrentJobs ?? jobs.length,
  };
  const releaseGate = lifecycle.releaseGate ?? {};
  const releaseAcceptance = lifecycle.releaseAcceptance ?? packageDescriptor.releaseAcceptanceContract ?? {};
  const operatorReleaseChecklist = lifecycle.operatorReleaseChecklist ?? packageDescriptor.operatorReleaseChecklist ?? {};
  const providerHealth = providerService.operationalHealth ?? {};
  const blockingIssues = issues.filter((issue) => issue.severity === "error");
  const approvalJobs = jobs.filter((job) => job.permissions?.decision === "needs-approval");
  const deniedJobs = jobs.filter((job) => job.permissions?.decision === "deny");
  const blockedStatusJobs = jobs.filter((job) => job.statusProjection?.current === "blocked");
  const writeLikeJobs = jobs.filter((job) => job.capabilities.some((capability) => (
    capability.name.endsWith(".write") || capability.name.endsWith(".send") || capability.name.includes("segment.write")
  )));
  const scheduleWindowMissing = settings.schedule.mode === "windowed"
    && (!settings.schedule.windowStart || !settings.schedule.windowEnd);
  const concurrencyExceeded = jobs.length > settings.maxConcurrentJobs;
  const rows = [
    {
      key: "lifecycle-enabled",
      state: settings.enabled ? "ready" : "blocked",
      sourceId: lifecycle.stateId ?? packageDescriptor.id,
      nextAction: settings.enabled ? "continue-runtime-control" : "enable-package-lifecycle",
      required: true,
      detail: settings.enabled ? "Lifecycle controls are enabled." : "Lifecycle controls hold runtime handoff.",
    },
    {
      key: "settings-command",
      state: ["disable", "cancel"].includes(settings.command) ? "blocked" : "ready",
      sourceId: lifecycle.stateId ?? packageDescriptor.id,
      nextAction: ["disable", "cancel"].includes(settings.command)
        ? "choose-runtime-enable-or-resume"
        : "persist-runtime-control-settings",
      required: true,
      detail: `Lifecycle command is ${settings.command}.`,
    },
    {
      key: "release-gate",
      state: releaseGate.state === "blocked" || releaseGate.state === "disabled"
        ? "blocked"
        : releaseGate.state === "review" || releaseGate.state === "scheduled"
          ? "waiting"
          : "ready",
      sourceId: releaseGate.id ?? lifecycle.stateId ?? null,
      nextAction: releaseGate.nextAction ?? lifecycle.nextAction?.action ?? "review-release-gate",
      required: true,
      detail: `Release gate state is ${releaseGate.state ?? "unknown"}.`,
    },
    {
      key: "schedule",
      state: settings.schedule.mode === "disabled" || scheduleWindowMissing
        ? "blocked"
        : settings.schedule.mode === "windowed" || settings.command === "schedule"
          ? "waiting"
          : "ready",
      sourceId: lifecycle.stateId ?? packageDescriptor.id,
      nextAction: settings.schedule.mode === "disabled"
        ? "choose-runtime-release-schedule"
        : scheduleWindowMissing
          ? "declare-runtime-release-window"
          : settings.schedule.mode === "windowed" || settings.command === "schedule"
            ? "wait-for-runtime-release-window"
            : "persist-runtime-release-schedule",
      required: settings.command === "schedule" || settings.schedule.mode !== "manual",
      detail: `Schedule mode is ${settings.schedule.mode ?? "manual"}.`,
    },
    {
      key: "provider-health",
      state: providerHealth.status === "unhealthy" || providerService.externalHandoff?.state === "blocked"
        ? "blocked"
        : providerHealth.status === "degraded"
          ? "waiting"
          : "ready",
      sourceId: providerHealth.id ?? providerService.id ?? null,
      nextAction: providerHealth.nextAction ?? providerService.externalHandoff?.nextAction ?? "review-provider-health",
      required: true,
      detail: `Provider health is ${providerHealth.status ?? "unknown"}.`,
    },
    {
      key: "readiness",
      state: readinessSummary.status === "blocked" || readinessSummary.status === "disabled"
        ? "blocked"
        : readinessSummary.status === "ready"
          ? "ready"
          : "waiting",
      sourceId: readinessSummary.id ?? planId,
      nextAction: readinessSummary.nextAction ?? "review-runtime-readiness",
      required: true,
      detail: `Runtime readiness is ${readinessSummary.status ?? "unknown"}.`,
    },
    {
      key: "acceptance",
      state: acceptanceContract.canAccept ? "ready" : "waiting",
      sourceId: acceptanceContract.id ?? null,
      nextAction: acceptanceContract.acceptAction ?? "collect-runtime-acceptance",
      required: true,
      detail: acceptanceContract.canAccept ? "Acceptance contract can be acknowledged." : "Acceptance contract is pending.",
    },
    {
      key: "release-acceptance",
      state: releaseAcceptance.state === "blocked"
        ? "blocked"
        : releaseAcceptance.ready === true
          ? "ready"
          : "waiting",
      sourceId: releaseAcceptance.id ?? null,
      nextAction: releaseAcceptance.nextAction ?? "review-release-acceptance",
      required: writeLikeJobs.length > 0,
      detail: `Release acceptance state is ${releaseAcceptance.state ?? "unknown"}.`,
    },
    {
      key: "operator-checklist",
      state: operatorReleaseChecklist.state === "blocked"
        ? "blocked"
        : operatorReleaseChecklist.ready === true
          ? "ready"
          : "waiting",
      sourceId: operatorReleaseChecklist.id ?? null,
      nextAction: operatorReleaseChecklist.nextAction ?? "review-operator-release-checklist",
      required: true,
      detail: `Operator release checklist state is ${operatorReleaseChecklist.state ?? "unknown"}.`,
    },
    {
      key: "tenant-permissions",
      state: deniedJobs.length > 0
        ? "blocked"
        : approvalJobs.length > 0
          ? "waiting"
          : "ready",
      sourceId: claimDescriptor.tenantPolicy?.boundaryId ?? claimDescriptor.id,
      nextAction: deniedJobs.length > 0
        ? "repair-tenant-permission"
        : approvalJobs.length > 0
          ? "collect-tenant-approval"
          : "persist-tenant-permission-audit",
      required: true,
      detail: `${deniedJobs.length} denied job(s), ${approvalJobs.length} approval job(s).`,
    },
    {
      key: "concurrency",
      state: concurrencyExceeded ? "waiting" : "ready",
      sourceId: lifecycle.stateId ?? packageDescriptor.id,
      nextAction: concurrencyExceeded ? "queue-runtime-release" : "continue-runtime-control",
      required: false,
      detail: `${jobs.length} job(s) against maxConcurrentJobs ${settings.maxConcurrentJobs}.`,
    },
  ];
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const state = blockingIssues.length > 0 || blockedRows.length > 0 || blockedStatusJobs.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : "ready";
  const nextAction = blockedRows[0]?.nextAction
    ?? waitingRows[0]?.nextAction
    ?? (settings.releasePolicy === "auto-when-healthy" ? "release-runtime-handoff" : "prepare-manual-release");
  const controlId = stableId("lifertctrl", [
    planId,
    packageDescriptor.id,
    claimDescriptor.id,
    state,
    rows.map((row) => `${row.key}:${row.state}`).join(","),
  ]);
  return {
    protocol: "aios.mailchimp.lifecycle-runtime-control.v1",
    id: controlId,
    product: "mailchimp",
    planId,
    packageId: packageDescriptor.id,
    claimGateId: claimDescriptor.id,
    state,
    ready: state === "ready",
    releaseAllowed: state === "ready" || (state === "waiting" && settings.releasePolicy === "auto-when-healthy"),
    visibleStatus: state === "ready"
      ? "runtime-control-ready"
      : state === "waiting"
        ? "runtime-control-waiting"
        : "runtime-control-blocked",
    nextAction,
    settings,
    rows,
    command: {
      id: stableId("lifertcmd", [controlId, "persist-lifecycle-runtime-control"]),
      type: "persist-lifecycle-runtime-control",
      idempotencyKey: stableId("idem", [controlId, "persist-lifecycle-runtime-control"]),
      statusAfterReplay: state === "ready" ? "runtime-control-ready" : `runtime-control-${state}`,
      writes: ["runtimeControlId", "rows", "nextAction", "blockedJobIds", "waitingJobIds"],
      conflict: "return-existing",
    },
    counters: {
      rows: rows.length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      ready: rows.filter((row) => row.state === "ready").length,
      blockingIssues: blockingIssues.length,
      deniedJobs: deniedJobs.length,
      approvalJobs: approvalJobs.length,
      writeLikeJobs: writeLikeJobs.length,
      blockedStatusJobs: blockedStatusJobs.length,
      scheduleWindowMissing: scheduleWindowMissing ? 1 : 0,
      concurrencyExceeded: concurrencyExceeded ? 1 : 0,
    },
    clientPatch: {
      lifecycleRuntimeControlId: controlId,
      lifecycleRuntimeControlState: state,
      lifecycleRuntimeControlReady: state === "ready",
      lifecycleRuntimeControlNextAction: nextAction,
      blockedControlKeys: blockedRows.map((row) => row.key),
      waitingControlKeys: waitingRows.map((row) => row.key),
      blockedJobIds: [...new Set([...deniedJobs, ...blockedStatusJobs].map((job) => job.id))].sort(),
      waitingJobIds: approvalJobs.map((job) => job.id).sort(),
    },
    exportSummary: {
      format: "aios.mailchimp.lifecycle-runtime-control-summary.v1",
      state,
      ready: state === "ready",
      nextAction,
      commandId: stableId("lifertcmd", [controlId, "persist-lifecycle-runtime-control"]),
      blockedControlKeys: blockedRows.map((row) => row.key),
      waitingControlKeys: waitingRows.map((row) => row.key),
      issueCodes: blockingIssues.map((issue) => issue.code),
    },
    restartSemantics: {
      restartSafe: state !== "blocked",
      onRestart: state === "ready" ? "load-lifecycle-runtime-control" : "rebuild-lifecycle-runtime-control",
      onDuplicateCommand: "return-existing-lifecycle-runtime-control",
      externalWritesPerformed: false,
    },
  };
}

function buildOperatorRuntimeReleaseInstruction(input) {
  const {
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    issues,
    providerService,
    readinessSummary,
    acceptanceContract,
    lifecycleRuntimeControl,
    clientWorkflowHandoffGate,
    claimOperatorReadinessGate,
  } = input;
  const releaseAcceptance = packageDescriptor.releaseAcceptanceContract
    ?? packageDescriptor.lifecycleControls?.releaseAcceptance
    ?? {};
  const operatorChecklist = packageDescriptor.operatorReleaseChecklist
    ?? packageDescriptor.lifecycleControls?.operatorReleaseChecklist
    ?? {};
  const settingsAdoption = packageDescriptor.lifecycleSettingsAdoption
    ?? packageDescriptor.lifecycleControls?.settingsAdoption
    ?? {};
  const runtimeBoundaryRelease = packageDescriptor.runtimeBoundaryRelease
    ?? packageDescriptor.lifecycleControls?.runtimeBoundaryRelease
    ?? {};
  const lifecycleSettings = lifecycleRuntimeControl.settings ?? {};
  const providerExternal = providerService.externalHandoff ?? {};
  const blockingIssues = issues.filter((issue) => issue.severity === "error");
  const deniedJobs = jobs.filter((job) => job.permissions?.decision === "deny");
  const approvalJobs = jobs.filter((job) => job.permissions?.decision === "needs-approval");
  const blockedClaimFacts = claimDescriptor.truthBoundary?.unverifiedFacts ?? [];
  const writeLikeJobs = jobs.filter((job) => job.capabilities.some((capability) => (
    capability.name.endsWith(".write") || capability.name.endsWith(".send") || capability.name.includes("segment.write")
  )));
  const scheduleWindowMissing = lifecycleSettings.schedule?.mode === "windowed"
    && (!lifecycleSettings.schedule.windowStart || !lifecycleSettings.schedule.windowEnd);
  const rows = [
    {
      key: "lifecycle-runtime-control",
      state: lifecycleRuntimeControl.state === "blocked"
        ? "blocked"
        : lifecycleRuntimeControl.state === "waiting"
          ? "waiting"
          : "ready",
      owner: "operator",
      sourceId: lifecycleRuntimeControl.id,
      nextAction: lifecycleRuntimeControl.nextAction,
      visibleStatus: lifecycleRuntimeControl.visibleStatus,
      commandId: lifecycleRuntimeControl.command?.id ?? null,
      requiredAcknowledgement: lifecycleRuntimeControl.state !== "ready",
      blockedJobIds: lifecycleRuntimeControl.clientPatch?.blockedJobIds ?? [],
      waitingJobIds: lifecycleRuntimeControl.clientPatch?.waitingJobIds ?? [],
      detail: `Runtime control is ${lifecycleRuntimeControl.state}.`,
    },
    {
      key: "settings-adoption",
      state: settingsAdoption.state === "blocked"
        ? "blocked"
        : settingsAdoption.ready === true
          ? "ready"
          : "waiting",
      owner: "operator",
      sourceId: settingsAdoption.id ?? settingsAdoption.digest ?? null,
      nextAction: settingsAdoption.nextAction ?? "review-lifecycle-settings-adoption",
      visibleStatus: settingsAdoption.userVisibleStatus ?? settingsAdoption.visibleStatus ?? "settings-adoption-pending",
      commandId: settingsAdoption.command?.id ?? null,
      requiredAcknowledgement: settingsAdoption.ready !== true,
      blockedJobIds: [],
      waitingJobIds: [],
      detail: `Lifecycle settings adoption is ${settingsAdoption.state ?? "unknown"}.`,
    },
    {
      key: "provider-handoff",
      state: providerExternal.state === "blocked" || providerService.operationalHealth?.status === "unhealthy"
        ? "blocked"
        : providerExternal.state === "scheduled" || providerService.operationalHealth?.status === "degraded"
          ? "waiting"
          : "ready",
      owner: "adapter",
      sourceId: providerExternal.handoffId ?? providerService.id ?? null,
      nextAction: providerExternal.nextAction ?? providerService.operationalHealth?.nextAction ?? "review-provider-handoff",
      visibleStatus: providerExternal.state ? `provider-handoff-${providerExternal.state}` : "provider-handoff-review",
      commandId: providerExternal.releaseCommandId ?? null,
      requiredAcknowledgement: providerExternal.state !== "ready-for-handoff",
      blockedJobIds: providerService.operationalHealth?.actionableErrors
        ?.filter((error) => error.severity === "error")
        .map((error) => error.jobId)
        .filter(Boolean) ?? [],
      waitingJobIds: [],
      detail: `Provider handoff is ${providerExternal.state ?? "unknown"}.`,
    },
    {
      key: "release-acceptance",
      state: releaseAcceptance.state === "blocked"
        ? "blocked"
        : releaseAcceptance.ready === true
          ? "ready"
          : "waiting",
      owner: "operator",
      sourceId: releaseAcceptance.id ?? null,
      nextAction: releaseAcceptance.nextAction ?? "collect-release-acceptance",
      visibleStatus: releaseAcceptance.visibleStatus ?? "release-acceptance-pending",
      commandId: releaseAcceptance.command?.id ?? null,
      requiredAcknowledgement: releaseAcceptance.ready !== true,
      blockedJobIds: releaseAcceptance.validationSummary?.blockedJobIds ?? [],
      waitingJobIds: releaseAcceptance.validationSummary?.waitingJobIds ?? [],
      detail: `Release acceptance is ${releaseAcceptance.state ?? "unknown"}.`,
    },
    {
      key: "operator-checklist",
      state: operatorChecklist.state === "blocked"
        ? "blocked"
        : operatorChecklist.ready === true
          ? "ready"
          : "waiting",
      owner: "operator",
      sourceId: operatorChecklist.id ?? null,
      nextAction: operatorChecklist.nextAction ?? "review-operator-release-checklist",
      visibleStatus: operatorChecklist.visibleStatus ?? "operator-checklist-pending",
      commandId: operatorChecklist.acknowledgementCommand?.id ?? operatorChecklist.command?.id ?? null,
      requiredAcknowledgement: operatorChecklist.ready !== true,
      blockedJobIds: operatorChecklist.validationSummary?.blockedJobIds ?? [],
      waitingJobIds: operatorChecklist.validationSummary?.waitingJobIds ?? [],
      detail: `Operator checklist is ${operatorChecklist.state ?? "unknown"}.`,
    },
    {
      key: "client-workflow-handoff",
      state: clientWorkflowHandoffGate.state === "blocked"
        ? "blocked"
        : clientWorkflowHandoffGate.ready === true
          ? "ready"
          : "waiting",
      owner: "client",
      sourceId: clientWorkflowHandoffGate.id,
      nextAction: clientWorkflowHandoffGate.nextAction,
      visibleStatus: clientWorkflowHandoffGate.visibleStatus ?? `client-workflow-${clientWorkflowHandoffGate.state}`,
      commandId: clientWorkflowHandoffGate.command?.id ?? null,
      requiredAcknowledgement: clientWorkflowHandoffGate.ready !== true,
      blockedJobIds: clientWorkflowHandoffGate.clientPatch?.blockedJobIds ?? [],
      waitingJobIds: clientWorkflowHandoffGate.clientPatch?.waitingJobIds ?? [],
      detail: `Client workflow handoff is ${clientWorkflowHandoffGate.state}.`,
    },
    {
      key: "claim-operator-readiness",
      state: claimOperatorReadinessGate.state === "blocked"
        ? "blocked"
        : claimOperatorReadinessGate.ready === true
          ? "ready"
          : "waiting",
      owner: "operator",
      sourceId: claimOperatorReadinessGate.id,
      nextAction: claimOperatorReadinessGate.nextAction,
      visibleStatus: claimOperatorReadinessGate.visibleStatus,
      commandId: claimOperatorReadinessGate.acknowledgementCommand?.id ?? null,
      requiredAcknowledgement: claimOperatorReadinessGate.ready !== true,
      blockedJobIds: claimOperatorReadinessGate.clientPatch?.blockedJobIds ?? [],
      waitingJobIds: claimOperatorReadinessGate.clientPatch?.waitingJobIds ?? [],
      detail: `Claim operator readiness is ${claimOperatorReadinessGate.state}.`,
    },
    {
      key: "runtime-boundary-release",
      state: runtimeBoundaryRelease.state === "blocked"
        ? "blocked"
        : runtimeBoundaryRelease.ready === true
          ? "ready"
          : "waiting",
      owner: "runtime",
      sourceId: runtimeBoundaryRelease.id ?? runtimeBoundaryRelease.digest ?? null,
      nextAction: runtimeBoundaryRelease.nextAction ?? "review-runtime-boundary-release",
      visibleStatus: runtimeBoundaryRelease.visibleStatus ?? `runtime-boundary-${runtimeBoundaryRelease.state ?? "review"}`,
      commandId: runtimeBoundaryRelease.command?.id ?? null,
      requiredAcknowledgement: runtimeBoundaryRelease.ready !== true,
      blockedJobIds: runtimeBoundaryRelease.validationSummary?.blockedJobIds ?? [],
      waitingJobIds: runtimeBoundaryRelease.validationSummary?.waitingJobIds ?? [],
      detail: `Runtime boundary release is ${runtimeBoundaryRelease.state ?? "unknown"}.`,
    },
  ];
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const state = blockingIssues.length > 0 || deniedJobs.length > 0 || blockedClaimFacts.length > 0 || blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0 || approvalJobs.length > 0 || scheduleWindowMissing
      ? "waiting"
      : readinessSummary.status === "ready" && acceptanceContract.canAccept === true
        ? "ready"
        : "review";
  const primaryRow = blockedRows[0] ?? waitingRows[0] ?? rows.find((row) => row.key === "release-acceptance");
  const instructionId = stableId("oprelease", [
    planId,
    state,
    rows.map((row) => `${row.key}:${row.state}:${row.sourceId}`).join(","),
  ]);
  const releaseToken = stableId("opreleasetoken", [
    instructionId,
    lifecycleRuntimeControl.id,
    packageDescriptor.releaseAcceptanceContract?.id,
    claimOperatorReadinessGate.id,
  ]);
  const commandId = stableId("opreleasecmd", [instructionId, "persist-operator-runtime-release-instruction"]);
  return {
    protocol: "aios.mailchimp.operator-runtime-release-instruction.v1",
    id: instructionId,
    product: "mailchimp",
    planId,
    packageId: packageDescriptor.id,
    claimGateId: claimDescriptor.id,
    state,
    ready: state === "ready",
    releaseToken,
    visibleStatus: state === "ready"
      ? "operator-release-ready"
      : state === "waiting"
        ? "operator-release-waiting"
        : state === "blocked"
          ? "operator-release-blocked"
          : "operator-release-review",
    nextAction: state === "ready"
      ? "release-runtime-handoff"
      : primaryRow?.nextAction ?? "review-operator-runtime-release",
    owner: state === "ready" ? "runtime" : primaryRow?.owner ?? "operator",
    releaseMode: lifecycleSettings.releasePolicy ?? "manual-approval",
    schedule: lifecycleSettings.schedule ?? { mode: "manual" },
    rows,
    requiredAcknowledgements: rows
      .filter((row) => row.requiredAcknowledgement)
      .map((row) => ({
        gate: row.key,
        owner: row.owner,
        nextAction: row.nextAction,
        commandId: row.commandId,
      })),
    command: {
      id: commandId,
      type: "persist-operator-runtime-release-instruction",
      idempotencyKey: stableId("idem", [commandId, releaseToken]),
      statusAfterReplay: state === "ready" ? "operator-release-ready" : `operator-release-${state}`,
      writes: ["operatorReleaseInstructionId", "rows", "releaseToken", "nextAction", "requiredAcknowledgements"],
      conflict: "return-existing",
    },
    validationSummary: {
      blockedGateIds: blockedRows.map((row) => row.key),
      waitingGateIds: waitingRows.map((row) => row.key),
      blockingIssueCodes: blockingIssues.map((issue) => issue.code),
      deniedJobIds: deniedJobs.map((job) => job.id),
      approvalJobIds: approvalJobs.map((job) => job.id),
      pendingClaimFacts: blockedClaimFacts,
      writeLikeJobIds: writeLikeJobs.map((job) => job.id),
      scheduleWindowMissing,
    },
    counters: {
      rows: rows.length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      ready: rows.filter((row) => row.state === "ready").length,
      requiredAcknowledgements: rows.filter((row) => row.requiredAcknowledgement).length,
      writeLikeJobs: writeLikeJobs.length,
    },
    clientPatch: {
      operatorReleaseInstructionId: instructionId,
      operatorReleaseState: state,
      operatorReleaseReady: state === "ready",
      operatorReleaseVisibleStatus: state === "ready" ? "operator-release-ready" : `operator-release-${state}`,
      operatorReleaseNextAction: state === "ready"
        ? "release-runtime-handoff"
        : primaryRow?.nextAction ?? "review-operator-runtime-release",
      operatorReleaseToken: releaseToken,
      operatorReleaseCommandId: commandId,
      operatorReleaseBlockedGateIds: blockedRows.map((row) => row.key),
      operatorReleaseWaitingGateIds: waitingRows.map((row) => row.key),
      operatorReleaseBlockedJobIds: [...new Set([
        ...deniedJobs.map((job) => job.id),
        ...blockedRows.flatMap((row) => row.blockedJobIds),
      ])].sort(),
      operatorReleaseWaitingJobIds: [...new Set([
        ...approvalJobs.map((job) => job.id),
        ...waitingRows.flatMap((row) => row.waitingJobIds),
      ])].sort(),
    },
    restartSemantics: {
      restartSafe: state !== "blocked",
      onRestart: state === "ready" ? "load-operator-release-instruction" : "rebuild-operator-release-instruction",
      onDuplicateCommand: "return-existing-operator-release-instruction",
      externalWritesPerformed: false,
    },
  };
}

function buildPackageTimelineRuntimeControl({
  planId,
  packageDescriptor,
  claimDescriptor,
  jobs,
  readinessSummary,
  acceptanceContract,
  providerService,
}) {
  const packageAnalytics = packageDescriptor.packageAnalyticsExport ?? packageDescriptor.analyticsExport ?? {};
  const timelineFeed = packageAnalytics.timelineFeed
    ?? packageAnalytics.packageTimelineFeed
    ?? packageAnalytics.exportSummary?.timelineFeed
    ?? {};
  const feedRows = timelineFeed.rows ?? [];
  const feedRowsByOperation = new Map(
    feedRows
      .filter((row) => row.operationId)
      .map((row) => [row.operationId, row]),
  );
  const jobRows = jobs.map((job, index) => {
    const feedRow = feedRowsByOperation.get(job.operation) ?? null;
    const permissionBlocked = job.permissions?.decision === "deny";
    const approvalWaiting = job.permissions?.decision === "needs-approval";
    const adapterBlocked = job.adapterStatusHandoff?.state === "blocked";
    const adapterWaiting = job.adapterStatusHandoff?.state === "waiting-for-approval";
    const feedBlocked = feedRow?.state === "blocked";
    const feedWaiting = ["waiting", "review", "scheduled"].includes(feedRow?.state);
    const state = permissionBlocked || adapterBlocked || feedBlocked
      ? "blocked"
      : approvalWaiting || adapterWaiting || feedWaiting
        ? "waiting"
        : "ready";
    return {
      sequence: index + 1,
      jobId: job.id,
      operation: job.operation,
      descriptorId: job.descriptorId,
      state,
      packageFeedRowKey: feedRow?.key ?? null,
      packageFeedState: feedRow?.state ?? null,
      permissionDecision: job.permissions?.decision ?? "unknown",
      adapterStatusState: job.adapterStatusHandoff?.state ?? "unknown",
      nextAction: state === "blocked"
        ? permissionBlocked
          ? "repair-tenant-permission"
          : adapterBlocked
            ? "resume-claim-or-permission-gate"
            : feedRow?.nextAction ?? "repair-package-timeline-feed"
        : state === "waiting"
          ? approvalWaiting
            ? "collect-tenant-approval"
            : adapterWaiting
              ? "collect-adapter-approval"
              : feedRow?.nextAction ?? "wait-for-package-timeline-feed"
          : feedRow?.nextAction ?? "release-client-operation",
      restartSafe: job.clientRecovery?.restartSemantics?.restartSafe !== false
        && job.statusProjection?.restartSafe !== false
        && feedRow?.restartSafe !== false,
      replayCursor: job.recovery?.replayCursor ?? null,
      adapterStatusResumeCursor: job.recovery?.adapterStatusResumeCursor ?? null,
      blockedKeys: [
        ...(permissionBlocked ? ["tenant-permission"] : []),
        ...(adapterBlocked ? ["adapter-status-handoff"] : []),
        ...(feedBlocked ? feedRow?.blockedKeys ?? [feedRow.key] : []),
      ],
      waitingKeys: [
        ...(approvalWaiting ? ["tenant-approval"] : []),
        ...(adapterWaiting ? ["adapter-approval"] : []),
        ...(feedWaiting ? feedRow?.waitingKeys ?? [feedRow.key] : []),
      ],
    };
  });
  const controlRows = [
    {
      key: "package-timeline-feed",
      state: timelineFeed.state ?? packageAnalytics.status ?? "unknown",
      sourceId: timelineFeed.id ?? packageAnalytics.id ?? null,
      nextAction: timelineFeed.nextAction ?? packageAnalytics.nextAction ?? "review-package-analytics-export",
      blockedKeys: timelineFeed.blockedKeys ?? [],
      waitingKeys: timelineFeed.waitingKeys ?? [],
      ready: timelineFeed.exportReady === true || packageAnalytics.exportReady === true,
      restartSafe: timelineFeed.restartSemantics?.restartSafe !== false,
    },
    {
      key: "claim-export",
      state: claimDescriptor.exportPacket?.state
        ?? claimDescriptor.exportContract?.state
        ?? (claimDescriptor.exportPacket?.exportReady === true ? "ready" : "unknown"),
      sourceId: claimDescriptor.exportPacket?.digest ?? claimDescriptor.exportContract?.digest ?? null,
      nextAction: claimDescriptor.exportPacket?.nextAction
        ?? claimDescriptor.exportContract?.nextAction
        ?? "review-claim-export",
      blockedKeys: claimDescriptor.exportPacket?.exportSummary?.blockerArtifactNames ?? [],
      waitingKeys: claimDescriptor.exportPacket?.exportSummary?.reviewArtifactNames ?? [],
      ready: claimDescriptor.exportPacket?.exportReady === true || claimDescriptor.exportContract?.ready === true,
      restartSafe: claimDescriptor.exportPacket?.restartSemantics?.restartSafe !== false,
    },
    {
      key: "runtime-readiness",
      state: readinessSummary.status ?? "unknown",
      sourceId: readinessSummary.id ?? null,
      nextAction: readinessSummary.nextAction ?? "review-runtime-readiness",
      blockedKeys: readinessSummary.checks
        ?.filter((check) => ["blocked", "disabled"].includes(check.status))
        .map((check) => check.name) ?? [],
      waitingKeys: readinessSummary.checks
        ?.filter((check) => ["waiting", "review"].includes(check.status))
        .map((check) => check.name) ?? [],
      ready: readinessSummary.status === "ready",
      restartSafe: true,
    },
    {
      key: "plan-acceptance",
      state: acceptanceContract.status ?? "unknown",
      sourceId: acceptanceContract.id ?? null,
      nextAction: acceptanceContract.acceptAction ?? "review-plan-acceptance",
      blockedKeys: acceptanceContract.requiredInputs
        ?.filter((input) => input.required && input.status === "blocked")
        .map((input) => input.name) ?? [],
      waitingKeys: acceptanceContract.requiredInputs
        ?.filter((input) => input.required && input.status !== "blocked")
        .map((input) => input.name) ?? [],
      ready: acceptanceContract.canAccept === true,
      restartSafe: true,
    },
    {
      key: "provider-handoff",
      state: providerService.externalHandoff?.state ?? "unknown",
      sourceId: providerService.externalHandoff?.handoffId ?? providerService.id ?? null,
      nextAction: providerService.operationalHealth?.nextAction
        ?? providerService.externalHandoff?.nextAction
        ?? "review-provider-handoff",
      blockedKeys: providerService.externalHandoff?.blockedReason ? [providerService.externalHandoff.blockedReason] : [],
      waitingKeys: providerService.externalHandoff?.state === "scheduled" ? ["provider-schedule"] : [],
      ready: ["ready", "ready-for-negotiation", "handoff-ready"].includes(providerService.externalHandoff?.state),
      restartSafe: providerService.externalHandoff?.externalWritesPerformed !== true,
    },
  ];
  const blockedJobRows = jobRows.filter((row) => row.state === "blocked");
  const waitingJobRows = jobRows.filter((row) => row.state === "waiting");
  const blockedControlRows = controlRows.filter((row) => row.ready !== true && row.blockedKeys.length > 0);
  const waitingControlRows = controlRows.filter((row) => row.ready !== true && row.waitingKeys.length > 0);
  const state = blockedJobRows.length > 0 || blockedControlRows.length > 0
    ? "blocked"
    : waitingJobRows.length > 0 || waitingControlRows.length > 0
      ? "waiting"
      : controlRows.every((row) => row.ready === true)
        ? "ready"
        : "review";
  const packetId = stableId("plantimeline", [
    planId,
    packageDescriptor.id,
    claimDescriptor.id,
    timelineFeed.id,
    state,
    jobRows.map((row) => `${row.jobId}:${row.state}`).join(","),
    controlRows.map((row) => `${row.key}:${row.state}:${row.ready}`).join(","),
  ]);
  const command = {
    id: stableId("plantimelinecmd", [packetId, "persist-runtime-control"]),
    type: "persist-package-timeline-runtime-control",
    idempotencyKey: stableId("idem", [packetId, "persist-runtime-control"]),
    statusAfterReplay: state === "ready" ? "package-timeline-runtime-ready" : `package-timeline-runtime-${state}`,
    writes: ["packageTimelineFeedId", "controlRows", "jobRows", "nextAction", "resumeCursors"],
    conflict: "return-existing",
  };
  return {
    protocol: "aios.mailchimp.package-timeline-runtime-control.v1",
    id: packetId,
    product: "mailchimp",
    planId,
    packageId: packageDescriptor.id,
    claimGateId: claimDescriptor.id,
    packageTimelineFeedId: timelineFeed.id ?? null,
    state,
    ready: state === "ready",
    controlRows,
    jobRows,
    command,
    counters: {
      controlRows: controlRows.length,
      jobRows: jobRows.length,
      blockedControls: blockedControlRows.length,
      waitingControls: waitingControlRows.length,
      blockedJobs: blockedJobRows.length,
      waitingJobs: waitingJobRows.length,
      readyJobs: jobRows.filter((row) => row.state === "ready").length,
      packageFeedRows: feedRows.length,
    },
    blockedKeys: [...new Set([
      ...blockedControlRows.flatMap((row) => row.blockedKeys),
      ...blockedJobRows.flatMap((row) => row.blockedKeys),
    ])].sort(),
    waitingKeys: [...new Set([
      ...waitingControlRows.flatMap((row) => row.waitingKeys),
      ...waitingJobRows.flatMap((row) => row.waitingKeys),
    ])].sort(),
    nextAction: blockedControlRows[0]?.nextAction
      ?? blockedJobRows[0]?.nextAction
      ?? waitingControlRows[0]?.nextAction
      ?? waitingJobRows[0]?.nextAction
      ?? (state === "ready" ? "publish-package-timeline-runtime-control" : "review-package-timeline-runtime-control"),
    clientPatch: {
      packageTimelineRuntimeControlId: packetId,
      packageTimelineRuntimeState: state,
      packageTimelineRuntimeReady: state === "ready",
      packageTimelineRuntimeNextAction: blockedControlRows[0]?.nextAction
        ?? blockedJobRows[0]?.nextAction
        ?? waitingControlRows[0]?.nextAction
        ?? waitingJobRows[0]?.nextAction
        ?? "publish-package-timeline-runtime-control",
      packageTimelineRuntimeBlockedKeys: [...new Set([
        ...blockedControlRows.flatMap((row) => row.blockedKeys),
        ...blockedJobRows.flatMap((row) => row.blockedKeys),
      ])].sort(),
      packageTimelineRuntimeWaitingKeys: [...new Set([
        ...waitingControlRows.flatMap((row) => row.waitingKeys),
        ...waitingJobRows.flatMap((row) => row.waitingKeys),
      ])].sort(),
      packageTimelineRuntimeBlockedJobIds: blockedJobRows.map((row) => row.jobId),
      packageTimelineRuntimeWaitingJobIds: waitingJobRows.map((row) => row.jobId),
      packageTimelineFeedId: timelineFeed.id ?? null,
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && controlRows.every((row) => row.restartSafe !== false) && jobRows.every((row) => row.restartSafe),
      onRestart: state === "ready" ? "load-package-timeline-runtime-control" : "rebuild-package-timeline-runtime-control",
      onDuplicateCommand: "return-existing-package-timeline-runtime-control",
      externalWritesPerformed: false,
    },
  };
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
  const operatorReleaseChecklist = lifecycle.operatorReleaseChecklist ?? packageDescriptor.operatorReleaseChecklist ?? {};
  const providerHealth = providerService.operationalHealth ?? {};
  const claimReporting = claimDescriptor.reporting ?? {};
  const claimExportPacket = claimDescriptor.exportPacket ?? claimDescriptor.exportContract ?? {};
  const claimAcceptance = claimDescriptor.claimAcceptance ?? {};
  const packagePreview = packageDescriptor.previewContract ?? {};
  const packageAnalytics = packageDescriptor.packageAnalyticsExport ?? packageDescriptor.analyticsExport ?? {};
  const packageAnalyticsExportLedger = packageDescriptor.packageAnalyticsExportLedger
    ?? packageDescriptor.analyticsExportLedger
    ?? packageAnalytics.exportLedger
    ?? packageAnalytics.packageAnalyticsExportLedger
    ?? {};
  const packageOperationalHealthExport = packageDescriptor.packageOperationalHealthExport
    ?? packageDescriptor.operationalHealthExport
    ?? {};
  const packageAnalyticsAdoption = packageDescriptor.packageAnalyticsAdoptionGate
    ?? packageAnalytics.adoptionGate
    ?? packageAnalytics.packageAnalyticsAdoptionGate
    ?? {};
  const packageTimelineRuntimeControl = buildPackageTimelineRuntimeControl({
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    readinessSummary,
    acceptanceContract,
    providerService,
  });
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
    {
      id: stableId("planhist", [...reportingScope, "package-analytics", packageAnalytics.id]),
      sequence: 5,
      type: "package-analytics-export-built",
      status: packageAnalytics.status ?? "unknown",
      exportReady: packageAnalytics.exportReady === true,
      nextAction: packageAnalytics.nextAction ?? "review-package-analytics-export",
      historySnapshotIds: packageAnalytics.exportSummary?.historySnapshotIds ?? [],
    },
    {
      id: stableId("planhist", [...reportingScope, "package-timeline-runtime", packageTimelineRuntimeControl.id]),
      sequence: 6,
      type: "package-timeline-runtime-control-built",
      status: packageTimelineRuntimeControl.state,
      ready: packageTimelineRuntimeControl.ready,
      packageTimelineFeedId: packageTimelineRuntimeControl.packageTimelineFeedId,
      nextAction: packageTimelineRuntimeControl.nextAction,
      blockedKeys: packageTimelineRuntimeControl.blockedKeys,
      waitingKeys: packageTimelineRuntimeControl.waitingKeys,
    },
    {
      id: stableId("planhist", [...reportingScope, "package-analytics-adoption", packageAnalyticsAdoption.id]),
      sequence: 7,
      type: "package-analytics-adoption-gate-built",
      status: packageAnalyticsAdoption.state ?? "unknown",
      ready: packageAnalyticsAdoption.ready === true,
      adoptionGateId: packageAnalyticsAdoption.id ?? null,
      timelineFeedId: packageAnalyticsAdoption.timelineFeedId ?? null,
      latestSnapshotId: packageAnalyticsAdoption.latestSnapshotId ?? null,
      nextAction: packageAnalyticsAdoption.nextAction ?? "review-package-analytics-adoption",
      blockedKeys: packageAnalyticsAdoption.blockedKeys ?? [],
      waitingKeys: packageAnalyticsAdoption.waitingKeys ?? [],
    },
    {
      id: stableId("planhist", [...reportingScope, "package-analytics-export-ledger", packageAnalyticsExportLedger.id]),
      sequence: 8,
      type: "package-analytics-export-ledger-built",
      status: packageAnalyticsExportLedger.state ?? "unknown",
      ready: packageAnalyticsExportLedger.exportReady === true,
      exportLedgerId: packageAnalyticsExportLedger.id ?? null,
      nextAction: packageAnalyticsExportLedger.nextAction ?? "review-package-analytics-export-ledger",
      blockedKeys: packageAnalyticsExportLedger.blockedKeys ?? [],
      waitingKeys: packageAnalyticsExportLedger.waitingKeys ?? [],
      commandIds: packageAnalyticsExportLedger.commands?.map((command) => command.id) ?? [],
    },
    {
      id: stableId("planhist", [...reportingScope, "package-operational-health-export", packageOperationalHealthExport.id]),
      sequence: 9,
      type: "package-operational-health-export-built",
      status: packageOperationalHealthExport.state ?? "unknown",
      ready: packageOperationalHealthExport.ready === true,
      exportReady: packageOperationalHealthExport.exportReady === true,
      exportId: packageOperationalHealthExport.id ?? null,
      incidentLedgerId: packageOperationalHealthExport.incidentLedgerId ?? null,
      nextAction: packageOperationalHealthExport.nextAction ?? "review-package-operational-health-export",
      blockedOperationIds: packageOperationalHealthExport.blockedOperationIds ?? [],
      reviewOperationIds: packageOperationalHealthExport.reviewOperationIds ?? [],
      blockedIncidentKeys: packageOperationalHealthExport.blockedIncidentKeys ?? [],
      reviewIncidentKeys: packageOperationalHealthExport.reviewIncidentKeys ?? [],
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
      event: "evaluate-operator-release-checklist",
      status: operatorReleaseChecklist.state ?? "unknown",
      artifactId: operatorReleaseChecklist.id ?? null,
      nextAction: operatorReleaseChecklist.nextAction ?? "review-operator-release-checklist",
    },
    {
      sequence: 7,
      event: "publish-acceptance-contract",
      status: acceptanceContract.status,
      artifactId: acceptanceContract.id,
      nextAction: acceptanceContract.acceptAction,
    },
    {
      sequence: 8,
      event: "evaluate-package-analytics-export",
      status: packageAnalytics.status ?? "unknown",
      artifactId: packageAnalytics.id ?? null,
      nextAction: packageAnalytics.nextAction ?? "review-package-analytics-export",
    },
    {
      sequence: 9,
      event: "evaluate-package-timeline-runtime-control",
      status: packageTimelineRuntimeControl.state,
      artifactId: packageTimelineRuntimeControl.id,
      nextAction: packageTimelineRuntimeControl.nextAction,
    },
    {
      sequence: 10,
      event: "evaluate-package-analytics-adoption",
      status: packageAnalyticsAdoption.state ?? "unknown",
      artifactId: packageAnalyticsAdoption.id ?? null,
      nextAction: packageAnalyticsAdoption.nextAction ?? "review-package-analytics-adoption",
    },
    {
      sequence: 11,
      event: "evaluate-package-analytics-export-ledger",
      status: packageAnalyticsExportLedger.state ?? "unknown",
      artifactId: packageAnalyticsExportLedger.id ?? null,
      nextAction: packageAnalyticsExportLedger.nextAction ?? "review-package-analytics-export-ledger",
    },
    {
      sequence: 12,
      event: "evaluate-package-operational-health-export",
      status: packageOperationalHealthExport.state ?? "unknown",
      artifactId: packageOperationalHealthExport.id ?? null,
      nextAction: packageOperationalHealthExport.nextAction ?? "review-package-operational-health-export",
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
    packageAnalyticsHistorySnapshots: packageAnalytics.exportSummary?.historySnapshotIds?.length ?? 0,
    packageAnalyticsTimelineEvents: packageAnalytics.exportSummary?.timelineEventIds?.length ?? 0,
    packageAnalyticsTimelineFeedRows: packageAnalytics.timelineFeed?.counters?.feedRows
      ?? packageAnalytics.packageTimelineFeed?.counters?.feedRows
      ?? 0,
    packageAnalyticsAdoptionRows: packageAnalyticsAdoption.counters?.rows ?? 0,
    packageAnalyticsAdoptionBlockedRows: packageAnalyticsAdoption.counters?.blockedRows ?? 0,
    packageAnalyticsAdoptionWaitingRows: packageAnalyticsAdoption.counters?.waitingRows ?? 0,
    packageAnalyticsAdoptionReady: packageAnalyticsAdoption.ready === true ? 1 : 0,
    packageAnalyticsExportLedgerRows: packageAnalyticsExportLedger.counters?.rows ?? 0,
    packageAnalyticsExportLedgerBlockedRows: packageAnalyticsExportLedger.counters?.blockedRows ?? 0,
    packageAnalyticsExportLedgerWaitingRows: packageAnalyticsExportLedger.counters?.waitingRows ?? 0,
    packageAnalyticsExportLedgerReady: packageAnalyticsExportLedger.exportReady === true ? 1 : 0,
    packageAnalyticsExportLedgerPublishCommands: packageAnalyticsExportLedger.commands?.length ?? 0,
    packageTimelineRuntimeControlRows: packageTimelineRuntimeControl.counters.controlRows,
    packageTimelineRuntimeBlockedControls: packageTimelineRuntimeControl.counters.blockedControls,
    packageTimelineRuntimeWaitingControls: packageTimelineRuntimeControl.counters.waitingControls,
    packageTimelineRuntimeBlockedJobs: packageTimelineRuntimeControl.counters.blockedJobs,
    packageTimelineRuntimeWaitingJobs: packageTimelineRuntimeControl.counters.waitingJobs,
    packageAnalyticsBlockedOperations: packageAnalytics.blockedOperationIds?.length ?? 0,
    packageAnalyticsReviewOperations: packageAnalytics.reviewOperationIds?.length ?? 0,
    packageAnalyticsExportReady: packageAnalytics.exportReady === true ? 1 : 0,
    packageOperationalHealthExportReady: packageOperationalHealthExport.exportReady === true ? 1 : 0,
    packageOperationalHealthBlockedOperations: packageOperationalHealthExport.blockedOperationIds?.length ?? 0,
    packageOperationalHealthReviewOperations: packageOperationalHealthExport.reviewOperationIds?.length ?? 0,
    packageOperationalHealthBlockedIncidents: packageOperationalHealthExport.blockedIncidentKeys?.length ?? 0,
    packageOperationalHealthReviewIncidents: packageOperationalHealthExport.reviewIncidentKeys?.length ?? 0,
    packageOperationalHealthPublishCommands: packageOperationalHealthExport.publishCommands?.length ?? 0,
    releaseAcceptanceRequiredInputs: releaseAcceptance.requiredInputs?.filter((input) => input.required).length ?? 0,
    releaseAcceptanceBlockedOperations: releaseAcceptance.clientPatch?.releaseAcceptanceBlockedOperationIds?.length ?? 0,
    releaseAcceptanceReviewOperations: releaseAcceptance.clientPatch?.releaseAcceptanceReviewOperationIds?.length ?? 0,
    operatorReleaseChecklistChecks: operatorReleaseChecklist.checks?.length ?? 0,
    operatorReleaseChecklistBlockedChecks: operatorReleaseChecklist.clientPatch?.operatorReleaseBlockedCheckKeys?.length ?? 0,
    operatorReleaseChecklistWaitingChecks: operatorReleaseChecklist.clientPatch?.operatorReleaseWaitingCheckKeys?.length ?? 0,
    operatorReleaseChecklistReviewChecks: operatorReleaseChecklist.clientPatch?.operatorReleaseReviewCheckKeys?.length ?? 0,
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
    operatorReleaseChecklistState: operatorReleaseChecklist.state ?? "unknown",
    operatorReleaseChecklistReady: operatorReleaseChecklist.ready === true,
    operatorReleaseChecklistNextAction: operatorReleaseChecklist.nextAction ?? null,
    packageAnalyticsStatus: packageAnalytics.status ?? "unknown",
    packageAnalyticsExportReady: packageAnalytics.exportReady === true,
    packageAnalyticsNextAction: packageAnalytics.nextAction ?? null,
    packageAnalyticsTimelineFeedId: packageAnalytics.timelineFeed?.id
      ?? packageAnalytics.packageTimelineFeed?.id
      ?? packageAnalytics.exportSummary?.timelineFeedId
      ?? null,
    packageAnalyticsAdoptionGateId: packageAnalyticsAdoption.id
      ?? packageAnalytics.exportSummary?.adoptionGateId
      ?? null,
    packageAnalyticsAdoptionState: packageAnalyticsAdoption.state
      ?? packageAnalytics.exportSummary?.adoptionGateState
      ?? "unknown",
    packageAnalyticsAdoptionReady: packageAnalyticsAdoption.ready === true
      || packageAnalytics.exportSummary?.adoptionGateReady === true,
    packageAnalyticsAdoptionNextAction: packageAnalyticsAdoption.nextAction
      ?? packageAnalytics.exportSummary?.adoptionGateNextAction
      ?? null,
    packageAnalyticsExportLedgerId: packageAnalyticsExportLedger.id
      ?? packageAnalytics.exportSummary?.exportLedgerId
      ?? null,
    packageAnalyticsExportLedgerState: packageAnalyticsExportLedger.state
      ?? packageAnalytics.exportSummary?.exportLedgerState
      ?? "unknown",
    packageAnalyticsExportLedgerReady: packageAnalyticsExportLedger.exportReady === true
      || packageAnalytics.exportSummary?.exportLedgerReady === true,
    packageAnalyticsExportLedgerNextAction: packageAnalyticsExportLedger.nextAction
      ?? packageAnalytics.exportSummary?.exportLedgerNextAction
      ?? null,
    packageAnalyticsExportLedgerBlockedKeys: packageAnalyticsExportLedger.blockedKeys
      ?? packageAnalytics.exportSummary?.exportLedgerBlockedKeys
      ?? [],
    packageAnalyticsExportLedgerWaitingKeys: packageAnalyticsExportLedger.waitingKeys
      ?? packageAnalytics.exportSummary?.exportLedgerWaitingKeys
      ?? [],
    packageOperationalHealthExportState: packageOperationalHealthExport.state ?? "unknown",
    packageOperationalHealthExportReady: packageOperationalHealthExport.exportReady === true,
    packageOperationalHealthExportNextAction: packageOperationalHealthExport.nextAction ?? null,
    packageOperationalHealthExportId: packageOperationalHealthExport.id ?? null,
    packageTimelineRuntimeControlState: packageTimelineRuntimeControl.state,
    packageTimelineRuntimeControlReady: packageTimelineRuntimeControl.ready,
    packageTimelineRuntimeControlNextAction: packageTimelineRuntimeControl.nextAction,
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
    packageAnalytics: packageAnalytics.exportSummary ?? null,
    packageAnalyticsExportLedger: packageAnalyticsExportLedger.id ? {
      id: packageAnalyticsExportLedger.id,
      state: packageAnalyticsExportLedger.state,
      exportReady: packageAnalyticsExportLedger.exportReady === true,
      visibleStatus: packageAnalyticsExportLedger.visibleStatus,
      nextAction: packageAnalyticsExportLedger.nextAction,
      blockedKeys: packageAnalyticsExportLedger.blockedKeys ?? [],
      waitingKeys: packageAnalyticsExportLedger.waitingKeys ?? [],
      commandIds: packageAnalyticsExportLedger.commands?.map((command) => command.id) ?? [],
      restartSafe: packageAnalyticsExportLedger.restartSemantics?.restartSafe === true,
    } : null,
    packageOperationalHealthExport: packageOperationalHealthExport.id ? {
      id: packageOperationalHealthExport.id,
      state: packageOperationalHealthExport.state,
      ready: packageOperationalHealthExport.ready === true,
      exportReady: packageOperationalHealthExport.exportReady === true,
      visibleStatus: packageOperationalHealthExport.visibleStatus,
      nextAction: packageOperationalHealthExport.nextAction,
      incidentLedgerId: packageOperationalHealthExport.incidentLedgerId ?? null,
      blockedOperationIds: packageOperationalHealthExport.blockedOperationIds ?? [],
      reviewOperationIds: packageOperationalHealthExport.reviewOperationIds ?? [],
      blockedIncidentKeys: packageOperationalHealthExport.blockedIncidentKeys ?? [],
      reviewIncidentKeys: packageOperationalHealthExport.reviewIncidentKeys ?? [],
      commandIds: packageOperationalHealthExport.publishCommands?.map((command) => command.id) ?? [],
      restartSafe: packageOperationalHealthExport.restartSemantics?.restartSafe === true,
    } : null,
    packageAnalyticsAdoption: packageAnalyticsAdoption.id ? {
      id: packageAnalyticsAdoption.id,
      state: packageAnalyticsAdoption.state,
      ready: packageAnalyticsAdoption.ready === true,
      visibleStatus: packageAnalyticsAdoption.visibleStatus,
      nextAction: packageAnalyticsAdoption.nextAction,
      blockedKeys: packageAnalyticsAdoption.blockedKeys ?? [],
      waitingKeys: packageAnalyticsAdoption.waitingKeys ?? [],
      timelineFeedId: packageAnalyticsAdoption.timelineFeedId ?? null,
      latestSnapshotId: packageAnalyticsAdoption.latestSnapshotId ?? null,
      commandId: packageAnalyticsAdoption.command?.id ?? null,
      restartSafe: packageAnalyticsAdoption.restartSemantics?.restartSafe === true,
    } : null,
    packageTimelineRuntimeControl: {
      id: packageTimelineRuntimeControl.id,
      state: packageTimelineRuntimeControl.state,
      ready: packageTimelineRuntimeControl.ready,
      nextAction: packageTimelineRuntimeControl.nextAction,
      blockedKeys: packageTimelineRuntimeControl.blockedKeys,
      waitingKeys: packageTimelineRuntimeControl.waitingKeys,
      blockedJobIds: packageTimelineRuntimeControl.clientPatch.packageTimelineRuntimeBlockedJobIds,
      waitingJobIds: packageTimelineRuntimeControl.clientPatch.packageTimelineRuntimeWaitingJobIds,
      packageTimelineFeedId: packageTimelineRuntimeControl.packageTimelineFeedId,
      commandId: packageTimelineRuntimeControl.command.id,
    },
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
    packageTimelineRuntimeControl,
    exportSummary,
  };
}

function buildClaimOperatorReadinessGate(planId, claimDescriptor, jobs, readinessSummary, clientWorkflowHandoffGate) {
  const sourcePacket = claimDescriptor.operatorReadinessPacket ?? claimDescriptor.operatorReadiness ?? {};
  const workflowGuard = sourcePacket.workflowHandoffGuard ?? {};
  const blockedJobs = jobs.filter((job) => (
    job.statusProjection?.current === "blocked"
    || job.permissions?.decision === "deny"
    || job.truthBoundary?.unverifiedFacts?.length > 0
  ));
  const waitingJobs = jobs.filter((job) => (
    job.permissions?.decision === "needs-approval"
    || job.adapterStatusHandoff?.state === "waiting-for-approval"
  ));
  const sourceBlockedKeys = sourcePacket.validationSummary?.blockedKeys
    ?? sourcePacket.clientPatch?.blockedReadinessKeys
    ?? [];
  const sourceReviewKeys = sourcePacket.validationSummary?.reviewKeys
    ?? sourcePacket.clientPatch?.reviewReadinessKeys
    ?? [];
  const workflowBlockedKeys = clientWorkflowHandoffGate?.clientPatch?.blockedWorkflowKeys ?? [];
  const workflowWaitingKeys = clientWorkflowHandoffGate?.clientPatch?.waitingWorkflowKeys ?? [];
  const guardBlockedKeys = workflowGuard.blockedKeys ?? sourcePacket.clientPatch?.workflowGuardBlockedKeys ?? [];
  const guardWaitingKeys = workflowGuard.reviewKeys ?? sourcePacket.clientPatch?.workflowGuardReviewKeys ?? [];
  const sourceGuardBlocked = workflowGuard.state === "blocked" || guardBlockedKeys.length > 0;
  const sourceGuardWaiting = workflowGuard.state === "review" || guardWaitingKeys.length > 0;
  const state = blockedJobs.length > 0 || sourcePacket.state === "blocked" || workflowBlockedKeys.length > 0 || sourceGuardBlocked
    ? "blocked"
    : waitingJobs.length > 0 || sourcePacket.state === "review" || workflowWaitingKeys.length > 0 || sourceGuardWaiting
      ? "waiting"
      : readinessSummary?.status === "ready" && clientWorkflowHandoffGate?.ready === true
        ? "ready"
        : "review";
  const gateId = stableId("claimopgate", [
    planId,
    claimDescriptor.id,
    sourcePacket.id,
    clientWorkflowHandoffGate?.id,
    state,
    blockedJobs.map((job) => job.id).join(","),
    waitingJobs.map((job) => job.id).join(","),
  ]);
  const blockedKeys = [...new Set([...sourceBlockedKeys, ...workflowBlockedKeys, ...guardBlockedKeys])].sort();
  const waitingKeys = [...new Set([...sourceReviewKeys, ...workflowWaitingKeys, ...guardWaitingKeys])].sort();
  const nextAction = state === "blocked"
    ? workflowGuard.nextAction ?? sourcePacket.nextAction ?? clientWorkflowHandoffGate?.nextAction ?? "repair-claim-operator-readiness"
    : state === "waiting"
      ? workflowGuard.nextAction ?? clientWorkflowHandoffGate?.nextAction ?? sourcePacket.nextAction ?? "resume-claim-operator-readiness"
      : state === "review"
        ? workflowGuard.nextAction ?? sourcePacket.nextAction ?? "review-claim-operator-readiness"
        : "persist-claim-operator-readiness-gate";
  const visibleStatus = state === "ready"
    ? "claim-operator-ready-for-runtime"
    : state === "waiting"
      ? "claim-operator-waiting"
      : state === "review"
        ? "review-claim-operator-runtime-handoff"
        : "repair-claim-operator-runtime-handoff";
  return {
    protocol: "aios.mailchimp.claim-operator-readiness-gate.v1",
    id: gateId,
    product: "mailchimp",
    planId,
    claimGateId: claimDescriptor.id,
    sourcePacketId: sourcePacket.id ?? null,
    sourceDigest: sourcePacket.digest ?? null,
    workflowGuard: workflowGuard.id ? {
      id: workflowGuard.id,
      state: workflowGuard.state,
      ready: workflowGuard.ready === true,
      digest: workflowGuard.digest ?? null,
      nextAction: workflowGuard.nextAction ?? null,
      blockedKeys: guardBlockedKeys,
      reviewKeys: guardWaitingKeys,
      clientStateKey: workflowGuard.clientStateKey ?? claimDescriptor.clientRuntime?.clientStateKey ?? null,
      resumeCursor: workflowGuard.resumeCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
    } : null,
    state,
    ready: state === "ready",
    visibleStatus,
    nextAction,
    command: {
      id: stableId("cmd", [gateId, "persist-claim-operator-gate"]),
      type: "persist-claim-operator-readiness-gate",
      idempotencyKey: stableId("idem", [gateId, "persist-claim-operator-gate"]),
      statusAfterReplay: state === "ready" ? "claim-operator-gate-ready" : `claim-operator-gate-${state}`,
      writes: ["claimOperatorGateId", "readinessPacketId", "blockedJobIds", "nextAction"],
      conflict: "return-existing",
    },
    rows: sourcePacket.rows ?? [],
    validationSummary: {
      sourceState: sourcePacket.state ?? "unknown",
      sourceVisibleStatus: sourcePacket.visibleStatus ?? null,
      sourceNextAction: sourcePacket.nextAction ?? null,
      readinessStatus: readinessSummary?.status ?? null,
      clientWorkflowHandoffState: clientWorkflowHandoffGate?.state ?? null,
      workflowGuardState: workflowGuard.state ?? null,
      workflowGuardReady: workflowGuard.ready === true,
      blockedKeys,
      waitingKeys,
      blockedJobIds: blockedJobs.map((job) => job.id),
      waitingJobIds: waitingJobs.map((job) => job.id),
      pendingFacts: sourcePacket.validationSummary?.pendingFacts ?? claimDescriptor.requestState?.pendingFacts ?? [],
      issueCodes: sourcePacket.issueRows?.map((issue) => issue.code) ?? [],
    },
    clientPatch: {
      claimOperatorReadinessGateId: gateId,
      claimOperatorReadinessState: state,
      claimOperatorReadinessVisibleStatus: visibleStatus,
      claimOperatorReadinessNextAction: nextAction,
      claimOperatorReadinessPacketId: sourcePacket.id ?? null,
      blockedReadinessKeys: blockedKeys,
      waitingReadinessKeys: waitingKeys,
      blockedJobIds: blockedJobs.map((job) => job.id),
      waitingJobIds: waitingJobs.map((job) => job.id),
      resumeCursor: claimDescriptor.requestState?.resumeCursor ?? null,
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && sourcePacket.restartSemantics?.restartSafe !== false,
      onRestart: state === "ready" ? "load-claim-operator-readiness-gate" : "rebuild-claim-operator-readiness-gate",
      onDuplicateCommand: "return-existing-claim-operator-readiness-gate",
      externalWritesPerformed: false,
    },
  };
}

function buildOperationalExportGate(input) {
  const {
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    readinessSummary,
    acceptanceContract,
    providerService,
    restartRecoveryMatrix,
    clientRecoveryHandoff,
    clientWorkflowHandoffGate,
    claimOperatorReadinessGate,
  } = input;
  const recoveryExport = restartRecoveryMatrix.exportLedger ?? {};
  const packageAnalytics = packageDescriptor.packageAnalyticsExport ?? packageDescriptor.analyticsExport ?? {};
  const packageAnalyticsExportLedger = packageDescriptor.packageAnalyticsExportLedger
    ?? packageDescriptor.analyticsExportLedger
    ?? packageAnalytics.exportLedger
    ?? packageAnalytics.packageAnalyticsExportLedger
    ?? {};
  const claimExport = claimDescriptor.exportPacket ?? claimDescriptor.exportContract ?? {};
  const providerHealth = providerService.operationalHealth ?? {};
  const providerHandoff = providerService.externalHandoff ?? {};
  const rows = [
    {
      key: "readiness",
      state: readinessSummary.status === "ready" ? "ready" : readinessSummary.status === "blocked" ? "blocked" : "waiting",
      sourceId: readinessSummary.id ?? null,
      nextAction: readinessSummary.nextAction ?? "review-plan-readiness",
      commandIds: [],
      resumeCursor: claimDescriptor.requestState?.resumeCursor ?? null,
      restartSafe: readinessSummary.status !== "blocked",
      blockers: readinessSummary.blockedJobIds ?? [],
    },
    {
      key: "acceptance",
      state: acceptanceContract.canAccept ? "ready" : acceptanceContract.status === "blocked" ? "blocked" : "waiting",
      sourceId: acceptanceContract.id ?? null,
      nextAction: acceptanceContract.nextAction ?? "review-runtime-acceptance",
      commandIds: [acceptanceContract.command?.id].filter(Boolean),
      resumeCursor: acceptanceContract.resumeCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
      restartSafe: acceptanceContract.status !== "blocked",
      blockers: acceptanceContract.validationSummary?.blockedJobIds ?? [],
    },
    {
      key: "provider-health",
      state: providerHealth.status === "healthy"
        ? "ready"
        : providerHealth.status === "unhealthy" || providerHandoff.state === "blocked"
          ? "blocked"
          : "waiting",
      sourceId: providerHealth.id ?? providerHandoff.handoffId ?? null,
      nextAction: providerHealth.nextAction ?? providerHandoff.nextAction ?? "review-provider-health",
      commandIds: providerHealth.commands?.map((command) => command.id) ?? [],
      resumeCursor: providerHandoff.resumeCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
      restartSafe: providerHealth.status !== "unhealthy" && providerHandoff.state !== "blocked",
      blockers: providerHealth.actionableErrors?.filter((error) => error.severity === "error").map((error) => error.code) ?? [],
    },
    {
      key: "restart-recovery-export",
      state: recoveryExport.exportReady === true
        ? "ready"
        : recoveryExport.state === "blocked" || restartRecoveryMatrix.state === "blocked"
          ? "blocked"
          : "waiting",
      sourceId: recoveryExport.id ?? restartRecoveryMatrix.id,
      nextAction: recoveryExport.nextAction ?? restartRecoveryMatrix.nextAction ?? "review-restart-recovery-export",
      commandIds: recoveryExport.commands?.map((command) => command.id) ?? [],
      resumeCursor: recoveryExport.replayCursor ?? restartRecoveryMatrix.replayCursor ?? null,
      restartSafe: recoveryExport.restartSafe !== false && restartRecoveryMatrix.restartSafe !== false,
      blockers: restartRecoveryMatrix.exportSummary?.blockedJobIds ?? restartRecoveryMatrix.clientPatch?.blockedJobIds ?? [],
    },
    {
      key: "client-recovery",
      state: clientRecoveryHandoff.ready ? "ready" : clientRecoveryHandoff.state === "blocked" ? "blocked" : "waiting",
      sourceId: clientRecoveryHandoff.id ?? null,
      nextAction: clientRecoveryHandoff.nextAction ?? "review-client-recovery",
      commandIds: clientRecoveryHandoff.commands?.map((command) => command.id) ?? [],
      resumeCursor: clientRecoveryHandoff.resumeCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
      restartSafe: clientRecoveryHandoff.restartSemantics?.restartSafe !== false,
      blockers: clientRecoveryHandoff.blockedJobIds ?? [],
    },
    {
      key: "client-workflow-handoff",
      state: clientWorkflowHandoffGate.ready ? "ready" : clientWorkflowHandoffGate.state === "blocked" ? "blocked" : "waiting",
      sourceId: clientWorkflowHandoffGate.id ?? null,
      nextAction: clientWorkflowHandoffGate.nextAction ?? "review-client-workflow-handoff",
      commandIds: [clientWorkflowHandoffGate.command?.id].filter(Boolean),
      resumeCursor: clientWorkflowHandoffGate.clientPatch?.resumeCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
      restartSafe: clientWorkflowHandoffGate.restartSemantics?.restartSafe !== false,
      blockers: clientWorkflowHandoffGate.clientPatch?.blockedWorkflowKeys ?? [],
    },
    {
      key: "claim-operator-readiness",
      state: claimOperatorReadinessGate.ready ? "ready" : claimOperatorReadinessGate.state === "blocked" ? "blocked" : "waiting",
      sourceId: claimOperatorReadinessGate.id ?? null,
      nextAction: claimOperatorReadinessGate.nextAction ?? "review-claim-operator-readiness",
      commandIds: [claimOperatorReadinessGate.command?.id].filter(Boolean),
      resumeCursor: claimOperatorReadinessGate.clientPatch?.resumeCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
      restartSafe: claimOperatorReadinessGate.restartSemantics?.restartSafe !== false,
      blockers: claimOperatorReadinessGate.validationSummary?.blockedKeys ?? [],
    },
    {
      key: "package-analytics-export",
      state: packageAnalytics.exportReady === true
        ? "ready"
        : packageAnalytics.status === "blocked" || packageAnalytics.state === "blocked"
          ? "blocked"
          : "waiting",
      sourceId: packageAnalytics.id ?? null,
      nextAction: packageAnalytics.nextAction ?? "review-package-analytics-export",
      commandIds: packageAnalytics.publishCommands?.map((command) => command.id) ?? [],
      resumeCursor: packageAnalytics.exportSummary?.latestSnapshotId ?? claimDescriptor.requestState?.resumeCursor ?? null,
      restartSafe: packageAnalytics.status !== "blocked" && packageAnalytics.state !== "blocked",
      blockers: packageAnalytics.blockedOperationIds ?? packageAnalytics.exportSummary?.blockerCodes ?? [],
    },
    {
      key: "package-analytics-export-ledger",
      state: packageAnalyticsExportLedger.exportReady === true
        ? "ready"
        : packageAnalyticsExportLedger.state === "blocked"
          ? "blocked"
          : "waiting",
      sourceId: packageAnalyticsExportLedger.id ?? null,
      nextAction: packageAnalyticsExportLedger.nextAction ?? "review-package-analytics-export-ledger",
      commandIds: packageAnalyticsExportLedger.commands?.map((command) => command.id) ?? [],
      resumeCursor: packageAnalyticsExportLedger.id ?? packageAnalytics.exportSummary?.exportLedgerId ?? claimDescriptor.requestState?.resumeCursor ?? null,
      restartSafe: packageAnalyticsExportLedger.restartSemantics?.restartSafe !== false
        && packageAnalyticsExportLedger.state !== "blocked",
      blockers: packageAnalyticsExportLedger.blockedKeys ?? packageAnalytics.exportSummary?.exportLedgerBlockedKeys ?? [],
    },
    {
      key: "claim-export",
      state: claimExport.exportReady === true || claimExport.ready === true
        ? "ready"
        : claimExport.state === "blocked"
          ? "blocked"
          : "waiting",
      sourceId: claimExport.digest ?? claimExport.id ?? null,
      nextAction: claimExport.nextAction ?? claimExport.exportSummary?.nextAction ?? "review-claim-export",
      commandIds: claimExport.publishCommands?.map((command) => command.id) ?? claimExport.publishCommandIds ?? [],
      resumeCursor: claimExport.replayCursor ?? claimDescriptor.requestState?.resumeCursor ?? null,
      restartSafe: claimExport.state !== "blocked",
      blockers: claimExport.exportSummary?.blockerArtifactNames ?? claimExport.blockedArtifactNames ?? [],
    },
  ];
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const readyRows = rows.filter((row) => row.state === "ready");
  const state = blockedRows.length > 0 ? "blocked" : waitingRows.length > 0 ? "waiting" : "ready";
  const gateId = stableId("opexport", [
    planId,
    state,
    rows.map((row) => `${row.key}:${row.state}:${row.sourceId}`).join(","),
  ]);
  const command = {
    id: stableId("opexportcmd", [gateId, "persist-operational-export-gate"]),
    type: "persist-operational-export-gate",
    idempotencyKey: stableId("idem", [gateId, "persist-operational-export-gate"]),
    statusAfterReplay: state === "ready" ? "operational-export-ready" : `operational-export-${state}`,
    writes: ["operationalExportRows", "resumeCursors", "nextAction", "restartSafe"],
    conflict: "return-existing",
  };
  return {
    protocol: "aios.mailchimp.executor-operational-export-gate.v1",
    id: gateId,
    product: "mailchimp",
    planId,
    state,
    ready: state === "ready",
    nextAction: blockedRows[0]?.nextAction ?? waitingRows[0]?.nextAction ?? "publish-operational-export-gate",
    rows,
    command,
    counters: {
      rows: rows.length,
      ready: readyRows.length,
      waiting: waitingRows.length,
      blocked: blockedRows.length,
      jobs: jobs.length,
      commandIds: rows.flatMap((row) => row.commandIds).length,
      resumeCursors: new Set(rows.map((row) => row.resumeCursor).filter(Boolean)).size,
    },
    blockedKeys: blockedRows.map((row) => row.key),
    waitingKeys: waitingRows.map((row) => row.key),
    commandIds: [...new Set(rows.flatMap((row) => row.commandIds))].sort(),
    resumeCursors: [...new Set(rows.map((row) => row.resumeCursor).filter(Boolean))].sort(),
    restartSemantics: {
      restartSafe: state !== "blocked" && rows.every((row) => row.restartSafe),
      onRestart: state === "ready" ? "load-operational-export-gate" : "rebuild-operational-export-gate",
      onDuplicateCommand: "return-existing-operational-export-gate",
      externalWritesPerformed: false,
    },
    clientPatch: {
      operationalExportGateId: gateId,
      operationalExportState: state,
      operationalExportReady: state === "ready",
      operationalExportNextAction: blockedRows[0]?.nextAction ?? waitingRows[0]?.nextAction ?? "publish-operational-export-gate",
      operationalExportBlockedKeys: blockedRows.map((row) => row.key),
      operationalExportWaitingKeys: waitingRows.map((row) => row.key),
      operationalExportResumeCursors: [...new Set(rows.map((row) => row.resumeCursor).filter(Boolean))].sort(),
    },
  };
}

function buildPlanOperationalStatusRollup(input) {
  const {
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    issues,
    providerService,
    readinessSummary,
    operationalExportGate,
    restartRecoveryMatrix,
  } = input;
  const packageLedger = packageDescriptor.operationalIncidentLedger ?? {};
  const providerHealth = providerService.operationalHealth ?? {};
  const claimHealth = claimDescriptor.operationalHealth ?? {};
  const deniedJobs = jobs.filter((job) => job.permissions?.decision === "deny");
  const approvalJobs = jobs.filter((job) => job.permissions?.decision === "needs-approval");
  const adapterBlockedJobs = jobs.filter((job) => job.adapterStatusHandoff?.state === "blocked");
  const incidentRows = [
    {
      key: "package-operational-incidents",
      source: "package-manifest",
      sourceId: packageLedger.id ?? null,
      state: packageLedger.state === "blocked"
        ? "blocked"
        : packageLedger.state === "review"
          ? "review"
          : "ready",
      visibleStatus: packageLedger.visibleStatus ?? packageDescriptor.operationalHealthSummary?.state ?? "unknown",
      nextAction: packageLedger.nextAction
        ?? packageDescriptor.operationalHealthSummary?.nextAction
        ?? "review-package-operational-incidents",
      counters: packageLedger.counters ?? packageDescriptor.operationalHealthSummary?.counters ?? {},
      blockers: packageLedger.clientPatch?.packageOperationalBlockedKeys
        ?? packageDescriptor.operationalHealthSummary?.blockedKeys
        ?? [],
      commandIds: [packageLedger.command?.id].filter(Boolean),
      restartSafe: packageLedger.restartSemantics?.restartSafe !== false,
    },
    {
      key: "provider-operational-health",
      source: "provider-service",
      sourceId: providerHealth.id ?? null,
      state: providerHealth.status === "unhealthy"
        ? "blocked"
        : providerHealth.status === "degraded"
          ? "review"
          : "ready",
      visibleStatus: providerHealth.status ?? "unknown",
      nextAction: providerHealth.nextAction ?? "review-provider-operational-health",
      counters: {
        checks: providerHealth.checks?.length ?? 0,
        actionableErrors: providerHealth.actionableErrors?.length ?? 0,
        adapterStatusResumeCursors: providerHealth.adapterStatusResumeCursors?.length ?? 0,
      },
      blockers: providerHealth.actionableErrors
        ?.filter((error) => error.severity === "error")
        .map((error) => error.code) ?? [],
      commandIds: providerService.providerCapabilityReplay?.commands?.map((command) => command.id) ?? [],
      restartSafe: providerHealth.status !== "unhealthy",
    },
    {
      key: "claim-operational-health",
      source: "claim-gate",
      sourceId: claimHealth.id ?? claimDescriptor.id,
      state: claimHealth.status === "unhealthy" || claimDescriptor.admission === "blocked"
        ? "blocked"
        : claimHealth.status === "degraded" || claimDescriptor.admission === "reviewable"
          ? "review"
          : "ready",
      visibleStatus: claimHealth.status ?? claimDescriptor.admission ?? "unknown",
      nextAction: claimHealth.nextAction
        ?? (claimDescriptor.admission === "blocked" ? "collect-claim-evidence" : "review-claim-gate"),
      counters: {
        pendingFacts: claimDescriptor.requestState?.pendingFacts?.length ?? 0,
        blockedRules: claimDescriptor.rules?.filter((rule) => rule.status === "blocked").length ?? 0,
        actionableErrors: claimHealth.actionableErrors?.length ?? 0,
      },
      blockers: [
        ...(claimDescriptor.requestState?.pendingFacts ?? []),
        ...(claimHealth.actionableErrors?.filter((error) => error.severity === "error").map((error) => error.code) ?? []),
      ],
      commandIds: claimDescriptor.requestState?.commands?.map((command) => command.id) ?? [],
      restartSafe: claimDescriptor.requestState?.restartSafe !== false,
    },
    {
      key: "tenant-permission-envelope",
      source: "executor-plan",
      sourceId: claimDescriptor.tenantPolicy?.boundaryId ?? null,
      state: deniedJobs.length > 0 ? "blocked" : approvalJobs.length > 0 ? "review" : "ready",
      visibleStatus: deniedJobs.length > 0
        ? "tenant-permission-blocked"
        : approvalJobs.length > 0
          ? "tenant-approval-required"
          : "tenant-permission-ready",
      nextAction: deniedJobs.length > 0
        ? "repair-tenant-permission"
        : approvalJobs.length > 0
          ? "collect-tenant-approval"
          : "append-tenant-audit",
      counters: {
        deniedJobs: deniedJobs.length,
        approvalJobs: approvalJobs.length,
        auditedJobs: jobs.filter((job) => job.auditHandoff?.id).length,
      },
      blockers: deniedJobs.map((job) => job.id),
      commandIds: jobs.map((job) => job.auditHandoff?.id).filter(Boolean),
      restartSafe: deniedJobs.length === 0,
    },
    {
      key: "adapter-status-resume",
      source: "executor-plan",
      sourceId: providerService.externalHandoff?.handoffId ?? null,
      state: adapterBlockedJobs.length > 0 ? "blocked" : "ready",
      visibleStatus: adapterBlockedJobs.length > 0 ? "adapter-status-blocked" : "adapter-status-ready",
      nextAction: adapterBlockedJobs.length > 0 ? "repair-adapter-status-handoff" : "persist-adapter-status-cursors",
      counters: {
        blockedJobs: adapterBlockedJobs.length,
        statusCommands: jobs.filter((job) => job.adapterStatusHandoff?.commands?.statusCommandId).length,
        resumeCursors: jobs.filter((job) => job.adapterStatusHandoff?.recovery?.resumeCursor).length,
      },
      blockers: adapterBlockedJobs.map((job) => job.id),
      commandIds: jobs.map((job) => job.adapterStatusHandoff?.commands?.statusCommandId).filter(Boolean),
      restartSafe: adapterBlockedJobs.length === 0,
    },
    {
      key: "operational-export-gate",
      source: "executor-plan",
      sourceId: operationalExportGate.id ?? null,
      state: operationalExportGate.ready === true
        ? "ready"
        : operationalExportGate.state === "waiting" || operationalExportGate.state === "review"
          ? "review"
          : "blocked",
      visibleStatus: operationalExportGate.visibleStatus ?? operationalExportGate.state ?? "unknown",
      nextAction: operationalExportGate.nextAction ?? "review-operational-export-gate",
      counters: operationalExportGate.counters ?? {},
      blockers: operationalExportGate.blockedKeys ?? [],
      commandIds: [operationalExportGate.command?.id].filter(Boolean),
      restartSafe: operationalExportGate.restartSemantics?.restartSafe !== false,
    },
    {
      key: "restart-recovery",
      source: "executor-plan",
      sourceId: restartRecoveryMatrix.id ?? null,
      state: restartRecoveryMatrix.restartSafe === true
        ? "ready"
        : restartRecoveryMatrix.state === "waiting"
          ? "review"
          : "blocked",
      visibleStatus: restartRecoveryMatrix.state ?? "unknown",
      nextAction: restartRecoveryMatrix.nextAction ?? "review-restart-recovery",
      counters: restartRecoveryMatrix.counters ?? {},
      blockers: restartRecoveryMatrix.clientPatch?.blockedJobIds ?? [],
      commandIds: restartRecoveryMatrix.commands?.map((command) => command.id) ?? [],
      restartSafe: restartRecoveryMatrix.restartSafe === true,
    },
  ];
  const issueRows = issues.map((issue, index) => ({
    key: issue.code ?? `plan-issue-${index + 1}`,
    source: "plan-issue",
    sourceId: issue.jobId ?? issue.operationId ?? null,
    state: issue.severity === "error" ? "blocked" : "review",
    visibleStatus: issue.severity,
    nextAction: issue.severity === "error" ? "repair-plan-issue" : "review-plan-warning",
    counters: {},
    blockers: [issue.jobId, issue.operationId, issue.code].filter(Boolean),
    commandIds: [],
    restartSafe: issue.severity !== "error",
  }));
  const rows = [...incidentRows, ...issueRows].map((row, index) => ({
    sequence: index + 1,
    ...row,
  }));
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const reviewRows = rows.filter((row) => row.state === "review");
  const state = blockedRows.length > 0
    ? "blocked"
    : reviewRows.length > 0
      ? "review"
      : "ready";
  const rollupId = stableId("opsrollup", [
    planId,
    packageLedger.id,
    providerHealth.id,
    claimHealth.id,
    operationalExportGate.id,
    restartRecoveryMatrix.id,
    state,
    rows.map((row) => `${row.source}:${row.key}:${row.state}`).join(","),
  ]);
  const command = {
    id: stableId("opsrollupcmd", [rollupId, "persist-operational-status-rollup"]),
    type: "persist-executor-operational-status-rollup",
    idempotencyKey: stableId("idem", [rollupId, "persist-operational-status-rollup"]),
    statusAfterReplay: state === "ready" ? "executor-operational-ready" : `executor-operational-${state}`,
    writes: ["operationalStatusRollupId", "rows", "counters", "nextAction"],
    conflict: "return-existing",
  };
  return {
    protocol: "aios.mailchimp.executor-operational-status-rollup.v1",
    id: rollupId,
    product: "mailchimp",
    planId,
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "executor-operational-ready"
      : state === "review"
        ? "executor-operational-review"
        : "executor-operational-blocked",
    nextAction: blockedRows[0]?.nextAction
      ?? reviewRows[0]?.nextAction
      ?? readinessSummary.nextAction
      ?? "persist-operational-status-rollup",
    rows,
    command,
    counters: {
      rows: rows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      ready: rows.filter((row) => row.state === "ready").length,
      planIssues: issueRows.length,
      deniedJobs: deniedJobs.length,
      approvalJobs: approvalJobs.length,
      adapterBlockedJobs: adapterBlockedJobs.length,
      packageIncidentRows: packageLedger.counters?.rows ?? 0,
      providerActionableErrors: providerHealth.actionableErrors?.length ?? 0,
    },
    exportSummary: {
      packageOperationalIncidentLedgerId: packageLedger.id ?? null,
      providerOperationalHealthId: providerHealth.id ?? null,
      claimOperationalHealthId: claimHealth.id ?? null,
      operationalExportGateId: operationalExportGate.id ?? null,
      restartRecoveryMatrixId: restartRecoveryMatrix.id ?? null,
      blockedKeys: blockedRows.map((row) => row.key),
      reviewKeys: reviewRows.map((row) => row.key),
      commandId: command.id,
    },
    clientPatch: {
      operationalStatusRollupId: rollupId,
      operationalStatusState: state,
      operationalStatusReady: state === "ready",
      operationalStatusNextAction: blockedRows[0]?.nextAction ?? reviewRows[0]?.nextAction ?? "persist-operational-status-rollup",
      operationalStatusBlockedKeys: blockedRows.map((row) => row.key),
      operationalStatusReviewKeys: reviewRows.map((row) => row.key),
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && rows.every((row) => row.restartSafe !== false),
      replayCursor: stableId("opsrollupcursor", [rollupId, command.id]),
      onRestart: state === "ready" ? "load-operational-status-rollup" : "rebuild-operational-status-rollup",
      onDuplicateCommand: "return-existing-operational-status-rollup",
      externalWritesPerformed: false,
    },
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
  const runtimeBoundaryPlan = buildRuntimeBoundaryPlanPacket(
    planId,
    packageDescriptor,
    claimDescriptor,
    tenantContext,
    jobs,
    providerService,
  );
  const readinessSummary = buildReadinessSummary(packageDescriptor, claimDescriptor, jobs, providerService, issues);
  const acceptanceContract = buildAcceptanceContract(
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    providerService,
    readinessSummary,
  );
  const lifecycleRuntimeControl = buildLifecycleRuntimeControlPacket({
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    issues,
    providerService,
    readinessSummary,
    acceptanceContract,
  });
  const restartProjection = buildPlanRestartProjection(jobs, claimDescriptor, packageDescriptor);
  const restartRecoveryMatrix = buildRestartRecoveryMatrix(
    jobs,
    claimDescriptor,
    packageDescriptor,
    restartProjection,
  );
  const acceptanceReadinessLedger = buildAcceptanceReadinessLedger({
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    providerService,
    readinessSummary,
    acceptanceContract,
    runtimeBoundaryPlan,
    lifecycleRuntimeControl,
    restartRecoveryMatrix,
  });
  const clientRecoveryHandoff = buildPlanClientRecoveryHandoff(
    planId,
    claimDescriptor,
    jobs,
    restartRecoveryMatrix,
  );
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
  const clientReadinessPacket = buildClientReadinessPacket(
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    providerService,
    readinessSummary,
    acceptanceContract,
    clientHandoffPacket,
  );
  const clientWorkflowHandoffGate = buildClientWorkflowHandoffGate(
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    providerService,
    readinessSummary,
    acceptanceContract,
    clientHandoffPacket,
    clientReadinessPacket,
    restartProjection,
  );
  const claimOperatorReadinessGate = buildClaimOperatorReadinessGate(
    planId,
    claimDescriptor,
    jobs,
    readinessSummary,
    clientWorkflowHandoffGate,
  );
  const operationalExportGate = buildOperationalExportGate({
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    readinessSummary,
    acceptanceContract,
    providerService,
    restartRecoveryMatrix,
    clientRecoveryHandoff,
    clientWorkflowHandoffGate,
    claimOperatorReadinessGate,
  });
  const executorWorkflowCheckpointHandoff = buildExecutorWorkflowCheckpointHandoff({
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    providerService,
    readinessSummary,
    acceptanceContract,
    restartRecoveryMatrix,
    clientRecoveryHandoff,
    clientHandoffPacket,
    clientReadinessPacket,
    clientWorkflowHandoffGate,
    claimOperatorReadinessGate,
    operationalExportGate,
  });
  const operationalStatusRollup = buildPlanOperationalStatusRollup({
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    issues,
    providerService,
    readinessSummary,
    operationalExportGate,
    restartRecoveryMatrix,
  });
  const operatorRuntimeReleaseInstruction = buildOperatorRuntimeReleaseInstruction({
    planId,
    packageDescriptor,
    claimDescriptor,
    jobs,
    issues,
    providerService,
    readinessSummary,
    acceptanceContract,
    lifecycleRuntimeControl,
    clientWorkflowHandoffGate,
    claimOperatorReadinessGate,
  });
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
      operatorReleaseChecklist: packageDescriptor.operatorReleaseChecklist,
      runtimeBoundaryRelease: packageDescriptor.runtimeBoundaryRelease,
      lifecycleSettingsAdoption: packageDescriptor.lifecycleSettingsAdoption,
      lifecycleRuntimeControl,
      providerIntegrationContract: packageDescriptor.providerIntegrationContract,
      providerSyncAcceptanceContract: packageDescriptor.providerSyncAcceptanceContract,
      providerReadinessExport: packageDescriptor.providerReadinessExport,
      providerClientHandoff: packageDescriptor.providerClientHandoff,
      tenantCapabilityBoundary: packageDescriptor.tenantCapabilityBoundary,
      packageAnalyticsExport: packageDescriptor.packageAnalyticsExport,
      packageAnalyticsAdoptionGate: packageDescriptor.packageAnalyticsAdoptionGate,
      packageAnalyticsExportLedger: packageDescriptor.packageAnalyticsExportLedger,
      analyticsSummary: packageDescriptor.analyticsSummary,
      analyticsExportLedgerSummary: packageDescriptor.analyticsExportLedgerSummary,
      operationalIncidentLedger: packageDescriptor.operationalIncidentLedger,
      packageOperationalHealthExport: packageDescriptor.packageOperationalHealthExport,
      operationalHealthExport: packageDescriptor.operationalHealthExport,
      operationalHealthSummary: packageDescriptor.operationalHealthSummary,
      validationSummary: packageDescriptor.validationSummary,
      userVisiblePreview: packageDescriptor.userVisiblePreview,
      operatorRuntimeReleaseInstruction,
      acceptanceReadinessLedger,
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
      clientRecovery: claimDescriptor.clientRecovery,
      clientRecoverySnapshot: claimDescriptor.clientRecoverySnapshot,
      workflowCheckpointHandoff: claimDescriptor.workflowCheckpointHandoff,
      workflowCheckpoint: claimDescriptor.workflowCheckpoint,
      operatorReadinessPacket: claimDescriptor.operatorReadinessPacket,
      operatorReadiness: claimDescriptor.operatorReadiness,
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
      restartRecoveryMatrix,
    },
    providerService,
    readinessSummary,
    acceptanceContract,
    acceptanceReadinessLedger,
    releaseAcceptanceContract: packageDescriptor.releaseAcceptanceContract,
    operatorReleaseChecklist: packageDescriptor.operatorReleaseChecklist,
    lifecycleSettingsAdoption: packageDescriptor.lifecycleSettingsAdoption,
    lifecycleRuntimeControl,
    runtimeBoundaryPlan,
    clientHandoffPacket,
    clientReadinessPacket,
    clientWorkflowHandoffGate,
    claimOperatorReadinessGate,
    operatorRuntimeReleaseInstruction,
    clientRecoveryHandoff,
    restartProjection,
    restartRecoveryMatrix,
    reporting,
    operationalExportGate,
    executorWorkflowCheckpointHandoff,
    operationalStatusRollup,
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
    operatorReleaseChecklistState: plan.operatorReleaseChecklist?.state
      ?? plan.package?.operatorReleaseChecklist?.state
      ?? plan.package?.lifecycleControls?.operatorReleaseChecklist?.state,
    operatorReleaseChecklistReady: plan.operatorReleaseChecklist?.ready === true
      || plan.package?.operatorReleaseChecklist?.ready === true
      || plan.package?.lifecycleControls?.operatorReleaseChecklist?.ready === true,
    operatorReleaseChecklistNextAction: plan.operatorReleaseChecklist?.nextAction
      ?? plan.package?.operatorReleaseChecklist?.nextAction
      ?? plan.package?.lifecycleControls?.operatorReleaseChecklist?.nextAction,
    lifecycleSettingsAdoptionState: plan.lifecycleSettingsAdoption?.state
      ?? plan.package?.lifecycleSettingsAdoption?.state
      ?? plan.package?.lifecycleControls?.settingsAdoption?.state,
    lifecycleSettingsAdoptionReady: plan.lifecycleSettingsAdoption?.ready === true
      || plan.package?.lifecycleSettingsAdoption?.ready === true
      || plan.package?.lifecycleControls?.settingsAdoption?.ready === true,
    lifecycleSettingsAdoptionNextAction: plan.lifecycleSettingsAdoption?.nextAction
      ?? plan.package?.lifecycleSettingsAdoption?.nextAction
      ?? plan.package?.lifecycleControls?.settingsAdoption?.nextAction,
    lifecycleSettingsBlockedKeys: plan.lifecycleSettingsAdoption?.clientPatch?.lifecycleSettingsBlockedKeys
      ?? plan.package?.lifecycleSettingsAdoption?.clientPatch?.lifecycleSettingsBlockedKeys
      ?? plan.package?.lifecycleControls?.settingsAdoption?.clientPatch?.lifecycleSettingsBlockedKeys
      ?? [],
    lifecycleSettingsWaitingKeys: plan.lifecycleSettingsAdoption?.clientPatch?.lifecycleSettingsWaitingKeys
      ?? plan.package?.lifecycleSettingsAdoption?.clientPatch?.lifecycleSettingsWaitingKeys
      ?? plan.package?.lifecycleControls?.settingsAdoption?.clientPatch?.lifecycleSettingsWaitingKeys
      ?? [],
    lifecycleRuntimeControlState: plan.lifecycleRuntimeControl?.state
      ?? plan.package?.lifecycleRuntimeControl?.state,
    lifecycleRuntimeControlReady: plan.lifecycleRuntimeControl?.ready === true
      || plan.package?.lifecycleRuntimeControl?.ready === true,
    lifecycleRuntimeControlNextAction: plan.lifecycleRuntimeControl?.nextAction
      ?? plan.package?.lifecycleRuntimeControl?.nextAction,
    lifecycleRuntimeControlBlockedKeys: plan.lifecycleRuntimeControl?.clientPatch?.blockedControlKeys
      ?? plan.package?.lifecycleRuntimeControl?.clientPatch?.blockedControlKeys
      ?? [],
    lifecycleRuntimeControlWaitingKeys: plan.lifecycleRuntimeControl?.clientPatch?.waitingControlKeys
      ?? plan.package?.lifecycleRuntimeControl?.clientPatch?.waitingControlKeys
      ?? [],
    lifecycleRuntimeControlCounters: plan.lifecycleRuntimeControl?.counters
      ?? plan.package?.lifecycleRuntimeControl?.counters
      ?? {},
    operatorRuntimeReleaseState: plan.operatorRuntimeReleaseInstruction?.state
      ?? plan.package?.operatorRuntimeReleaseInstruction?.state,
    operatorRuntimeReleaseReady: plan.operatorRuntimeReleaseInstruction?.ready === true
      || plan.package?.operatorRuntimeReleaseInstruction?.ready === true,
    operatorRuntimeReleaseNextAction: plan.operatorRuntimeReleaseInstruction?.nextAction
      ?? plan.package?.operatorRuntimeReleaseInstruction?.nextAction,
    operatorRuntimeReleaseVisibleStatus: plan.operatorRuntimeReleaseInstruction?.visibleStatus
      ?? plan.package?.operatorRuntimeReleaseInstruction?.visibleStatus,
    operatorRuntimeReleaseToken: plan.operatorRuntimeReleaseInstruction?.releaseToken
      ?? plan.package?.operatorRuntimeReleaseInstruction?.releaseToken,
    operatorRuntimeReleaseBlockedGateIds: plan.operatorRuntimeReleaseInstruction?.clientPatch?.operatorReleaseBlockedGateIds
      ?? plan.package?.operatorRuntimeReleaseInstruction?.clientPatch?.operatorReleaseBlockedGateIds
      ?? [],
    operatorRuntimeReleaseWaitingGateIds: plan.operatorRuntimeReleaseInstruction?.clientPatch?.operatorReleaseWaitingGateIds
      ?? plan.package?.operatorRuntimeReleaseInstruction?.clientPatch?.operatorReleaseWaitingGateIds
      ?? [],
    operatorRuntimeReleaseBlockedJobIds: plan.operatorRuntimeReleaseInstruction?.clientPatch?.operatorReleaseBlockedJobIds
      ?? plan.package?.operatorRuntimeReleaseInstruction?.clientPatch?.operatorReleaseBlockedJobIds
      ?? [],
    operatorRuntimeReleaseWaitingJobIds: plan.operatorRuntimeReleaseInstruction?.clientPatch?.operatorReleaseWaitingJobIds
      ?? plan.package?.operatorRuntimeReleaseInstruction?.clientPatch?.operatorReleaseWaitingJobIds
      ?? [],
    operatorRuntimeReleaseAcknowledgements: plan.operatorRuntimeReleaseInstruction?.requiredAcknowledgements?.length
      ?? plan.package?.operatorRuntimeReleaseInstruction?.requiredAcknowledgements?.length
      ?? 0,
    providerHealthStatus: plan.providerService?.operationalHealth?.status,
    providerHealthNextAction: plan.providerService?.operationalHealth?.nextAction,
    providerHealthErrorCodes: plan.providerService?.operationalHealth?.actionableErrors?.map((error) => error.code) ?? [],
    providerIntegrationState: plan.providerService?.providerIntegrationContract?.state
      ?? plan.package?.providerIntegrationContract?.state
      ?? "unknown",
    providerIntegrationReady: plan.providerService?.providerIntegrationContract?.ready === true
      || plan.package?.providerIntegrationContract?.ready === true,
    providerIntegrationNextAction: plan.providerService?.providerIntegrationContract?.nextAction
      ?? plan.package?.providerIntegrationContract?.nextAction
      ?? null,
    providerIntegrationMissingFeatures: plan.providerService?.providerIntegrationContract?.validationSummary?.missingFeatures
      ?? plan.package?.providerIntegrationContract?.validationSummary?.missingFeatures
      ?? [],
    providerIntegrationWaitingFeatures: plan.providerService?.providerIntegrationContract?.validationSummary?.waitingFeatures
      ?? plan.package?.providerIntegrationContract?.validationSummary?.waitingFeatures
      ?? [],
    providerReadinessState: plan.providerService?.providerReadinessExport?.state
      ?? plan.package?.providerReadinessExport?.state
      ?? "unknown",
    providerReadinessReady: plan.providerService?.providerReadinessExport?.ready === true
      || plan.package?.providerReadinessExport?.ready === true,
    providerReadinessNextAction: plan.providerService?.providerReadinessExport?.nextAction
      ?? plan.package?.providerReadinessExport?.nextAction
      ?? null,
    providerReadinessExportId: plan.providerService?.providerReadinessExport?.id
      ?? plan.package?.providerReadinessExport?.id
      ?? null,
    providerReadinessCommandId: plan.providerService?.providerReadinessExport?.commandId
      ?? plan.package?.providerReadinessExport?.command?.id
      ?? null,
    providerReadinessBlockedKeys: plan.providerService?.providerReadinessExport?.validationSummary?.blockedKeys
      ?? plan.package?.providerReadinessExport?.validationSummary?.blockedKeys
      ?? [],
    providerReadinessWaitingKeys: plan.providerService?.providerReadinessExport?.validationSummary?.waitingKeys
      ?? plan.package?.providerReadinessExport?.validationSummary?.waitingKeys
      ?? [],
    providerReadinessMissingFeatures: plan.providerService?.providerReadinessExport?.validationSummary?.missingProviderFeatures
      ?? plan.package?.providerReadinessExport?.validationSummary?.missingProviderFeatures
      ?? [],
    negotiatedCapabilities: plan.providerService?.capabilityNegotiation?.requestedCapabilities ?? [],
    providerCapabilityReplayState: plan.providerService?.providerCapabilityReplay?.state,
    providerCapabilityReplayReady: plan.providerService?.providerCapabilityReplay?.ready === true,
    providerCapabilityReplayNextAction: plan.providerService?.providerCapabilityReplay?.nextAction,
    providerCapabilityReplayResumeCursor: plan.providerService?.providerCapabilityReplay?.resumeCursor,
    providerCapabilityReplayCommands: plan.providerService?.providerCapabilityReplay?.commands?.length ?? 0,
    runtimeBoundaryState: plan.runtimeBoundaryPlan?.state,
    runtimeBoundaryReady: plan.runtimeBoundaryPlan?.ready === true,
    runtimeBoundaryNextAction: plan.runtimeBoundaryPlan?.nextAction,
    runtimeBoundaryBlockedKeys: plan.runtimeBoundaryPlan?.clientPatch?.runtimeBoundaryBlockedKeys ?? [],
    runtimeBoundaryWaitingKeys: plan.runtimeBoundaryPlan?.clientPatch?.runtimeBoundaryWaitingKeys ?? [],
    runtimeBoundaryCounters: plan.runtimeBoundaryPlan?.counters ?? {},
    acceptanceReadinessState: plan.acceptanceReadinessLedger?.state,
    acceptanceReadinessReady: plan.acceptanceReadinessLedger?.ready === true,
    acceptanceReadinessVisibleStatus: plan.acceptanceReadinessLedger?.visibleStatus,
    acceptanceReadinessNextAction: plan.acceptanceReadinessLedger?.nextAction,
    acceptanceReadinessBlockedKeys: plan.acceptanceReadinessLedger?.clientPatch?.acceptanceReadinessBlockedKeys ?? [],
    acceptanceReadinessReviewKeys: plan.acceptanceReadinessLedger?.clientPatch?.acceptanceReadinessReviewKeys ?? [],
    acceptanceReadinessCommandId: plan.acceptanceReadinessLedger?.command?.id,
    acceptanceReadinessDigest: plan.acceptanceReadinessLedger?.digest,
    readinessStatus: plan.readinessSummary?.status,
    acceptanceStatus: plan.acceptanceContract?.status,
    acceptanceVisibleStatus: plan.acceptanceContract?.clientPreview?.visibleStatus,
    reportingId: plan.reporting?.id,
    reportingNextAction: plan.reporting?.exportSummary?.nextAction,
    reportingHistorySnapshots: plan.reporting?.history?.length ?? 0,
    reportingTimelineEvents: plan.reporting?.timeline?.length ?? 0,
    reportingCounters: plan.reporting?.counters ?? {},
    restartRecoveryState: plan.restartRecoveryMatrix?.state,
    restartRecoverySafe: plan.restartRecoveryMatrix?.restartSafe === true,
    restartRecoveryNextAction: plan.restartRecoveryMatrix?.nextAction,
    restartRecoveryCounters: plan.restartRecoveryMatrix?.counters ?? {},
    restartRecoveryBlockedJobs: plan.restartRecoveryMatrix?.clientPatch?.blockedJobIds ?? [],
    restartRecoveryWaitingJobs: plan.restartRecoveryMatrix?.clientPatch?.waitingJobIds ?? [],
    restartRecoveryReplayableJobs: plan.restartRecoveryMatrix?.clientPatch?.replayableJobIds ?? [],
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
    verifierAcceptanceState: plan.claimGate?.verifierAcceptance?.state
      ?? plan.claimGate?.verifierReadiness?.state
      ?? plan.claimGate?.claimAcceptance?.verifierAcceptance?.state
      ?? "unknown",
    verifierAcceptanceReady: plan.claimGate?.verifierAcceptance?.ready === true
      || plan.claimGate?.verifierReadiness?.ready === true
      || plan.claimGate?.claimAcceptance?.verifierAcceptance?.ready === true,
    verifierAcceptanceNextAction: plan.claimGate?.verifierAcceptance?.nextAction
      ?? plan.claimGate?.verifierReadiness?.nextAction
      ?? plan.claimGate?.claimAcceptance?.verifierAcceptance?.nextAction
      ?? null,
    verifierAcceptanceSnapshotId: plan.claimGate?.verifierAcceptance?.snapshotId
      ?? plan.claimGate?.verifierReadiness?.snapshotId
      ?? plan.claimGate?.claimAcceptance?.verifierAcceptance?.snapshotId
      ?? null,
    verifierAcceptanceBlockingRules: plan.claimGate?.verifierAcceptance?.blockingRuleIds
      ?? plan.claimGate?.claimAcceptance?.verifierAcceptance?.blockingRuleIds
      ?? [],
    verifierAcceptancePendingRules: plan.claimGate?.verifierAcceptance?.pendingRuleIds
      ?? plan.claimGate?.claimAcceptance?.verifierAcceptance?.pendingRuleIds
      ?? [],
    verifierRecoveryState: plan.claimGate?.verifierAcceptance?.recoveryHandoff?.state
      ?? plan.claimGate?.verifierReadiness?.recoveryHandoff?.state
      ?? plan.claimGate?.clientRecovery?.clientPatch?.verifierRecoveryState
      ?? "unknown",
    verifierRecoveryReady: plan.claimGate?.verifierAcceptance?.recoveryHandoff?.ready === true
      || plan.claimGate?.verifierReadiness?.recoveryHandoff?.ready === true,
    verifierRecoveryNextAction: plan.claimGate?.verifierAcceptance?.recoveryHandoff?.nextAction
      ?? plan.claimGate?.verifierReadiness?.recoveryHandoff?.nextAction
      ?? plan.claimGate?.clientRecovery?.clientPatch?.verifierRecoveryNextAction
      ?? null,
    verifierRecoveryHandoffId: plan.claimGate?.verifierAcceptance?.recoveryHandoff?.id
      ?? plan.claimGate?.verifierReadiness?.recoveryHandoff?.id
      ?? plan.claimGate?.clientRecovery?.clientPatch?.verifierRecoveryHandoffId
      ?? null,
    verifierRecoveryResumeCursor: plan.claimGate?.verifierAcceptance?.recoveryHandoff?.resumeCursor
      ?? plan.claimGate?.verifierReadiness?.recoveryHandoff?.resumeCursor
      ?? plan.claimGate?.clientRecovery?.clientPatch?.verifierRecoveryResumeCursor
      ?? null,
    verifierRecoveryBlockedRules: plan.claimGate?.verifierAcceptance?.recoveryHandoff?.blockedRuleIds
      ?? plan.claimGate?.verifierReadiness?.recoveryHandoff?.blockedRuleIds
      ?? plan.claimGate?.clientRecovery?.clientPatch?.verifierRecoveryBlockedRuleIds
      ?? [],
    verifierRecoveryMissingStateKeys: plan.claimGate?.verifierAcceptance?.recoveryHandoff?.missingStateKeys
      ?? plan.claimGate?.verifierReadiness?.recoveryHandoff?.missingStateKeys
      ?? plan.claimGate?.clientRecovery?.clientPatch?.verifierRecoveryMissingStateKeys
      ?? [],
    claimOperatorReadinessState: plan.claimOperatorReadinessGate?.state
      ?? plan.claimGate?.operatorReadiness?.state,
    claimOperatorReadinessReady: plan.claimOperatorReadinessGate?.ready === true
      || plan.claimGate?.operatorReadiness?.ready === true,
    claimOperatorReadinessNextAction: plan.claimOperatorReadinessGate?.nextAction
      ?? plan.claimGate?.operatorReadiness?.nextAction,
    claimOperatorReadinessBlockedKeys: plan.claimOperatorReadinessGate?.clientPatch?.blockedReadinessKeys
      ?? plan.claimGate?.operatorReadiness?.clientPatch?.blockedReadinessKeys
      ?? [],
    claimOperatorReadinessWaitingKeys: plan.claimOperatorReadinessGate?.clientPatch?.waitingReadinessKeys
      ?? plan.claimGate?.operatorReadiness?.clientPatch?.reviewReadinessKeys
      ?? [],
    packagePreviewStatus: plan.package?.previewContract?.status,
    packagePreviewVisibleStatus: plan.package?.previewContract?.visibleStatus,
    packagePreviewNextAction: plan.package?.previewContract?.nextAction,
    packageAnalyticsStatus: plan.package?.packageAnalyticsExport?.status
      ?? plan.providerService?.packageAnalytics?.status
      ?? "unknown",
    packageAnalyticsExportReady: plan.package?.packageAnalyticsExport?.exportReady === true
      || plan.providerService?.packageAnalytics?.exportReady === true,
    packageAnalyticsNextAction: plan.package?.packageAnalyticsExport?.nextAction
      ?? plan.providerService?.packageAnalytics?.nextAction
      ?? null,
    packageAnalyticsHistorySnapshots: plan.package?.packageAnalyticsExport?.exportSummary?.historySnapshotIds?.length
      ?? plan.providerService?.packageAnalytics?.historySnapshotIds?.length
      ?? 0,
    packageAnalyticsTimelineFeedId: plan.package?.packageAnalyticsExport?.timelineFeed?.id
      ?? plan.package?.packageAnalyticsExport?.packageTimelineFeed?.id
      ?? plan.package?.packageAnalyticsExport?.exportSummary?.timelineFeedId
      ?? null,
    packageAnalyticsTimelineFeedState: plan.package?.packageAnalyticsExport?.timelineFeed?.state
      ?? plan.package?.packageAnalyticsExport?.packageTimelineFeed?.state
      ?? plan.package?.packageAnalyticsExport?.exportSummary?.timelineFeedState
      ?? "unknown",
    packageAnalyticsTimelineFeedReady: plan.package?.packageAnalyticsExport?.timelineFeed?.exportReady === true
      || plan.package?.packageAnalyticsExport?.packageTimelineFeed?.exportReady === true
      || plan.package?.packageAnalyticsExport?.exportSummary?.timelineFeedReady === true,
    packageAnalyticsTimelineBlockedKeys: plan.package?.packageAnalyticsExport?.timelineFeed?.blockedKeys
      ?? plan.package?.packageAnalyticsExport?.packageTimelineFeed?.blockedKeys
      ?? plan.package?.packageAnalyticsExport?.exportSummary?.timelineFeedBlockedKeys
      ?? [],
    packageAnalyticsTimelineWaitingKeys: plan.package?.packageAnalyticsExport?.timelineFeed?.waitingKeys
      ?? plan.package?.packageAnalyticsExport?.packageTimelineFeed?.waitingKeys
      ?? plan.package?.packageAnalyticsExport?.exportSummary?.timelineFeedWaitingKeys
      ?? [],
    packageAnalyticsAdoptionState: plan.package?.packageAnalyticsAdoptionGate?.state
      ?? plan.package?.packageAnalyticsExport?.adoptionGate?.state
      ?? plan.package?.packageAnalyticsExport?.exportSummary?.adoptionGateState
      ?? plan.reporting?.exportSummary?.packageAnalyticsAdoptionState
      ?? "unknown",
    packageAnalyticsAdoptionReady: plan.package?.packageAnalyticsAdoptionGate?.ready === true
      || plan.package?.packageAnalyticsExport?.adoptionGate?.ready === true
      || plan.package?.packageAnalyticsExport?.exportSummary?.adoptionGateReady === true
      || plan.reporting?.exportSummary?.packageAnalyticsAdoptionReady === true,
    packageAnalyticsAdoptionNextAction: plan.package?.packageAnalyticsAdoptionGate?.nextAction
      ?? plan.package?.packageAnalyticsExport?.adoptionGate?.nextAction
      ?? plan.package?.packageAnalyticsExport?.exportSummary?.adoptionGateNextAction
      ?? plan.reporting?.exportSummary?.packageAnalyticsAdoptionNextAction
      ?? null,
    packageAnalyticsAdoptionBlockedKeys: plan.package?.packageAnalyticsAdoptionGate?.blockedKeys
      ?? plan.package?.packageAnalyticsExport?.adoptionGate?.blockedKeys
      ?? plan.package?.packageAnalyticsExport?.exportSummary?.adoptionGateBlockedKeys
      ?? plan.reporting?.exportSummary?.packageAnalyticsAdoption?.blockedKeys
      ?? [],
    packageAnalyticsAdoptionWaitingKeys: plan.package?.packageAnalyticsAdoptionGate?.waitingKeys
      ?? plan.package?.packageAnalyticsExport?.adoptionGate?.waitingKeys
      ?? plan.package?.packageAnalyticsExport?.exportSummary?.adoptionGateWaitingKeys
      ?? plan.reporting?.exportSummary?.packageAnalyticsAdoption?.waitingKeys
      ?? [],
    packageAnalyticsAdoptionCommandId: plan.package?.packageAnalyticsAdoptionGate?.command?.id
      ?? plan.package?.packageAnalyticsExport?.adoptionGate?.command?.id
      ?? plan.package?.packageAnalyticsExport?.exportSummary?.adoptionCommandId
      ?? plan.reporting?.exportSummary?.packageAnalyticsAdoption?.commandId
      ?? null,
    packageAnalyticsExportLedgerState: plan.package?.packageAnalyticsExportLedger?.state
      ?? plan.package?.analyticsExportLedgerSummary?.state
      ?? plan.package?.packageAnalyticsExport?.exportLedger?.state
      ?? plan.reporting?.exportSummary?.packageAnalyticsExportLedgerState
      ?? "unknown",
    packageAnalyticsExportLedgerReady: plan.package?.packageAnalyticsExportLedger?.exportReady === true
      || plan.package?.analyticsExportLedgerSummary?.exportReady === true
      || plan.package?.packageAnalyticsExport?.exportLedger?.exportReady === true
      || plan.reporting?.exportSummary?.packageAnalyticsExportLedgerReady === true,
    packageAnalyticsExportLedgerNextAction: plan.package?.packageAnalyticsExportLedger?.nextAction
      ?? plan.package?.analyticsExportLedgerSummary?.nextAction
      ?? plan.package?.packageAnalyticsExport?.exportLedger?.nextAction
      ?? plan.reporting?.exportSummary?.packageAnalyticsExportLedgerNextAction
      ?? null,
    packageAnalyticsExportLedgerBlockedKeys: plan.package?.packageAnalyticsExportLedger?.blockedKeys
      ?? plan.package?.analyticsExportLedgerSummary?.blockedKeys
      ?? plan.package?.packageAnalyticsExport?.exportLedger?.blockedKeys
      ?? plan.reporting?.exportSummary?.packageAnalyticsExportLedgerBlockedKeys
      ?? [],
    packageAnalyticsExportLedgerWaitingKeys: plan.package?.packageAnalyticsExportLedger?.waitingKeys
      ?? plan.package?.analyticsExportLedgerSummary?.waitingKeys
      ?? plan.package?.packageAnalyticsExport?.exportLedger?.waitingKeys
      ?? plan.reporting?.exportSummary?.packageAnalyticsExportLedgerWaitingKeys
      ?? [],
    packageAnalyticsExportLedgerCommandIds: plan.package?.packageAnalyticsExportLedger?.commands?.map((command) => command.id)
      ?? plan.package?.analyticsExportLedgerSummary?.commandIds
      ?? plan.package?.packageAnalyticsExport?.exportSummary?.publishCommandIds
      ?? [],
    packageTimelineRuntimeControlState: plan.reporting?.packageTimelineRuntimeControl?.state
      ?? plan.reporting?.exportSummary?.packageTimelineRuntimeControlState
      ?? "unknown",
    packageTimelineRuntimeControlReady: plan.reporting?.packageTimelineRuntimeControl?.ready === true
      || plan.reporting?.exportSummary?.packageTimelineRuntimeControlReady === true,
    packageTimelineRuntimeControlNextAction: plan.reporting?.packageTimelineRuntimeControl?.nextAction
      ?? plan.reporting?.exportSummary?.packageTimelineRuntimeControlNextAction
      ?? null,
    packageTimelineRuntimeBlockedKeys: plan.reporting?.packageTimelineRuntimeControl?.blockedKeys
      ?? plan.reporting?.exportSummary?.packageTimelineRuntimeControl?.blockedKeys
      ?? [],
    packageTimelineRuntimeWaitingKeys: plan.reporting?.packageTimelineRuntimeControl?.waitingKeys
      ?? plan.reporting?.exportSummary?.packageTimelineRuntimeControl?.waitingKeys
      ?? [],
    packageTimelineRuntimeBlockedJobs: plan.reporting?.packageTimelineRuntimeControl?.clientPatch?.packageTimelineRuntimeBlockedJobIds
      ?? plan.reporting?.exportSummary?.packageTimelineRuntimeControl?.blockedJobIds
      ?? [],
    packageTimelineRuntimeWaitingJobs: plan.reporting?.packageTimelineRuntimeControl?.clientPatch?.packageTimelineRuntimeWaitingJobIds
      ?? plan.reporting?.exportSummary?.packageTimelineRuntimeControl?.waitingJobIds
      ?? [],
    packageAnalyticsBlockedOperations: plan.package?.packageAnalyticsExport?.blockedOperationIds
      ?? plan.providerService?.packageAnalytics?.blockedOperationIds
      ?? [],
    packageOperationalIncidentState: plan.package?.operationalIncidentLedger?.state
      ?? plan.package?.operationalHealthSummary?.state
      ?? "unknown",
    packageOperationalIncidentReady: plan.package?.operationalIncidentLedger?.ready === true
      || plan.package?.operationalHealthSummary?.ready === true,
    packageOperationalIncidentNextAction: plan.package?.operationalIncidentLedger?.nextAction
      ?? plan.package?.operationalHealthSummary?.nextAction
      ?? null,
    packageOperationalIncidentCounters: plan.package?.operationalIncidentLedger?.counters
      ?? plan.package?.operationalHealthSummary?.counters
      ?? {},
    packageOperationalBlockedKeys: plan.package?.operationalIncidentLedger?.clientPatch?.packageOperationalBlockedKeys
      ?? plan.package?.operationalHealthSummary?.blockedKeys
      ?? [],
    packageOperationalReviewKeys: plan.package?.operationalIncidentLedger?.clientPatch?.packageOperationalReviewKeys
      ?? plan.package?.operationalHealthSummary?.reviewKeys
      ?? [],
    packageOperationalHealthExportState: plan.package?.packageOperationalHealthExport?.state
      ?? plan.package?.operationalHealthExport?.state
      ?? plan.package?.operationalHealthSummary?.exportState
      ?? plan.reporting?.exportSummary?.packageOperationalHealthExportState
      ?? "unknown",
    packageOperationalHealthExportReady: plan.package?.packageOperationalHealthExport?.exportReady === true
      || plan.package?.operationalHealthExport?.exportReady === true
      || plan.package?.operationalHealthSummary?.exportReady === true
      || plan.reporting?.exportSummary?.packageOperationalHealthExportReady === true,
    packageOperationalHealthExportNextAction: plan.package?.packageOperationalHealthExport?.nextAction
      ?? plan.package?.operationalHealthExport?.nextAction
      ?? plan.package?.operationalHealthSummary?.exportNextAction
      ?? plan.reporting?.exportSummary?.packageOperationalHealthExportNextAction
      ?? null,
    packageOperationalHealthBlockedOperations: plan.package?.packageOperationalHealthExport?.blockedOperationIds
      ?? plan.package?.operationalHealthExport?.blockedOperationIds
      ?? plan.package?.operationalHealthSummary?.blockedOperationIds
      ?? plan.reporting?.exportSummary?.packageOperationalHealthExport?.blockedOperationIds
      ?? [],
    packageOperationalHealthReviewOperations: plan.package?.packageOperationalHealthExport?.reviewOperationIds
      ?? plan.package?.operationalHealthExport?.reviewOperationIds
      ?? plan.package?.operationalHealthSummary?.reviewOperationIds
      ?? plan.reporting?.exportSummary?.packageOperationalHealthExport?.reviewOperationIds
      ?? [],
    clientHandoffState: plan.clientHandoffPacket?.state,
    clientHandoffVisibleStatus: plan.clientHandoffPacket?.visibleStatus,
    clientHandoffNextAction: plan.clientHandoffPacket?.nextAction,
    clientHandoffCommandCount: plan.clientHandoffPacket?.commands?.length ?? 0,
    clientReadinessState: plan.clientReadinessPacket?.state,
    clientReadinessReady: plan.clientReadinessPacket?.ready === true,
    clientReadinessNextAction: plan.clientReadinessPacket?.nextAction,
    clientReadinessBlockedKeys: plan.clientReadinessPacket?.clientPatch?.blockedReadinessKeys ?? [],
    clientReadinessReviewKeys: plan.clientReadinessPacket?.clientPatch?.reviewReadinessKeys ?? [],
    clientReadinessBlockedJobs: plan.clientReadinessPacket?.clientPatch?.blockedJobIds ?? [],
    clientReadinessWaitingJobs: plan.clientReadinessPacket?.clientPatch?.waitingJobIds ?? [],
    clientWorkflowHandoffState: plan.clientWorkflowHandoffGate?.state,
    clientWorkflowHandoffReady: plan.clientWorkflowHandoffGate?.ready === true,
    clientWorkflowHandoffNextAction: plan.clientWorkflowHandoffGate?.nextAction,
    clientWorkflowHandoffBlockedKeys: plan.clientWorkflowHandoffGate?.clientPatch?.blockedWorkflowKeys ?? [],
    clientWorkflowHandoffWaitingKeys: plan.clientWorkflowHandoffGate?.clientPatch?.waitingWorkflowKeys ?? [],
    clientWorkflowHandoffBlockedJobs: plan.clientWorkflowHandoffGate?.clientPatch?.blockedJobIds ?? [],
    clientWorkflowHandoffWaitingJobs: plan.clientWorkflowHandoffGate?.clientPatch?.waitingJobIds ?? [],
    clientRecoveryState: plan.clientRecoveryHandoff?.state,
    clientRecoveryReady: plan.clientRecoveryHandoff?.ready === true,
    clientRecoveryNextAction: plan.clientRecoveryHandoff?.nextAction,
    clientRecoveryBlockedJobs: plan.clientRecoveryHandoff?.blockedJobIds ?? [],
    clientRecoveryWaitingJobs: plan.clientRecoveryHandoff?.waitingJobIds ?? [],
    clientRecoveryBlockedKeys: plan.clientRecoveryHandoff?.blockedKeys ?? [],
    clientRecoveryWaitingKeys: plan.clientRecoveryHandoff?.waitingKeys ?? [],
    clientRecoveryResumeCursor: plan.clientRecoveryHandoff?.resumeCursor,
    claimWorkflowCheckpointState: plan.claimGate?.workflowCheckpointHandoff?.state
      ?? plan.claimGate?.workflowCheckpoint?.state,
    claimWorkflowCheckpointReady: plan.claimGate?.workflowCheckpointHandoff?.ready === true
      || plan.claimGate?.workflowCheckpoint?.ready === true,
    claimWorkflowCheckpointNextAction: plan.claimGate?.workflowCheckpointHandoff?.nextAction
      ?? plan.claimGate?.workflowCheckpoint?.nextAction,
    claimWorkflowCheckpointBlockedKeys: plan.claimGate?.workflowCheckpointHandoff?.blockedKeys
      ?? plan.claimGate?.workflowCheckpoint?.blockedKeys
      ?? [],
    claimWorkflowCheckpointWaitingKeys: plan.claimGate?.workflowCheckpointHandoff?.waitingKeys
      ?? plan.claimGate?.workflowCheckpoint?.waitingKeys
      ?? [],
    executorWorkflowCheckpointState: plan.executorWorkflowCheckpointHandoff?.state,
    executorWorkflowCheckpointReady: plan.executorWorkflowCheckpointHandoff?.ready === true,
    executorWorkflowCheckpointVisibleStatus: plan.executorWorkflowCheckpointHandoff?.visibleStatus,
    executorWorkflowCheckpointNextAction: plan.executorWorkflowCheckpointHandoff?.nextAction,
    executorWorkflowCheckpointBlockedKeys: plan.executorWorkflowCheckpointHandoff?.blockedKeys ?? [],
    executorWorkflowCheckpointWaitingKeys: plan.executorWorkflowCheckpointHandoff?.waitingKeys ?? [],
    executorWorkflowCheckpointBlockedJobs: plan.executorWorkflowCheckpointHandoff?.blockedJobIds ?? [],
    executorWorkflowCheckpointWaitingJobs: plan.executorWorkflowCheckpointHandoff?.waitingJobIds ?? [],
    executorWorkflowCheckpointResumeCursors: plan.executorWorkflowCheckpointHandoff?.resumeCursors ?? [],
    executorWorkflowCheckpointCommandId: plan.executorWorkflowCheckpointHandoff?.command?.id,
    executorWorkflowCheckpointRestartSafe: plan.executorWorkflowCheckpointHandoff?.restartSemantics?.restartSafe === true,
    operationalExportGateState: plan.operationalExportGate?.state,
    operationalExportGateReady: plan.operationalExportGate?.ready === true,
    operationalExportGateNextAction: plan.operationalExportGate?.nextAction,
    operationalExportBlockedKeys: plan.operationalExportGate?.blockedKeys ?? [],
    operationalExportWaitingKeys: plan.operationalExportGate?.waitingKeys ?? [],
    operationalExportRestartSafe: plan.operationalExportGate?.restartSemantics?.restartSafe === true,
    operationalStatusRollupState: plan.operationalStatusRollup?.state,
    operationalStatusRollupReady: plan.operationalStatusRollup?.ready === true,
    operationalStatusRollupNextAction: plan.operationalStatusRollup?.nextAction,
    operationalStatusRollupCounters: plan.operationalStatusRollup?.counters ?? {},
    operationalStatusBlockedKeys: plan.operationalStatusRollup?.clientPatch?.operationalStatusBlockedKeys ?? [],
    operationalStatusReviewKeys: plan.operationalStatusRollup?.clientPatch?.operationalStatusReviewKeys ?? [],
    operationalStatusRestartSafe: plan.operationalStatusRollup?.restartSemantics?.restartSafe === true,
  };
}
