const RECOVERY_STATUSES = Object.freeze([
  "clean",
  "resume-ready",
  "rollback-ready",
  "adapter-wait",
  "blocked",
]);

const TERMINAL_AUDIT_STATUSES = Object.freeze([
  "completed",
  "rolled_back",
  "failed",
]);

export function buildRollbackContract(compiledProgram, auditReport = null, options = {}) {
  const program = normalizeCompiledProgram(compiledProgram);
  const audit = normalizeAuditReport(auditReport);
  const commands = buildRecoveryCommands(program, options);
  const checkpoints = buildCheckpoints(program, commands, audit, options);
  const adapter = buildAdapterRecoveryState(program, audit, checkpoints, options);
  const validation = validateRecoveryContract(program, commands, checkpoints, adapter, audit);
  const status = deriveRecoveryStatus(commands, checkpoints, adapter, validation, audit);
  const blockedReasons = buildBlockedReasons(validation, adapter, checkpoints, audit);
  const nextAction = deriveNextAction(status, commands, adapter, blockedReasons);
  const analytics = buildRollbackAnalyticsFrom({
    program,
    audit,
    commands,
    checkpoints,
    adapter,
    validation,
    status,
    blockedReasons,
    nextAction,
  }, options);
  const providerContract = buildRollbackProviderHandoffContractFrom({
    program,
    audit,
    commands,
    checkpoints,
    adapter,
    validation,
    status,
    blockedReasons,
    nextAction,
    analytics,
  }, options);
  const handoffGate = buildRollbackHandoffGate({
    jobId: program.job.id,
    policy: {
      memoryWritePolicy: program.job.memory.writePolicy,
    },
    commands,
    checkpoints,
    adapter,
    validation,
    analytics,
    providerContract,
    status,
    nextAction,
    blockedReasons,
    readyForRuntimeHandoff: blockedReasons.length === 0
      && (status === "clean" || status === "resume-ready" || status === "rollback-ready"),
  }, options);

  return deepFreeze({
    kind: "aios.rollback.contract",
    apiVersion: "aios.language/v1",
    jobId: program.job.id,
    package: {
      name: program.manifest.name,
      version: program.manifest.version,
    },
    policy: {
      rollback: program.job.recovery.rollback,
      retryAttempts: program.job.recovery.retry.attempts,
      backoff: program.job.recovery.retry.backoff,
      memoryWritePolicy: program.job.memory.writePolicy,
    },
    commands,
    checkpoints,
    adapter,
    validation,
    analytics,
    providerContract,
    status,
    nextAction,
    handoffGate,
    readyForRuntimeHandoff: blockedReasons.length === 0
      && (status === "clean" || status === "resume-ready" || status === "rollback-ready"),
    blockedReasons,
    restartToken: stableToken([
      program.job.id,
      status,
      adapter.status,
      checkpoints.map((checkpoint) => checkpoint.status).join(","),
      analytics.exportSummary.exportStatus,
    ]),
  });
}

export function buildRecoveryStatusHandoff(rollbackContract, options = {}) {
  const contract = normalizeRollbackContract(rollbackContract);
  const accepted = Boolean(options.accepted ?? false);
  const gate = buildRollbackHandoffGate(contract, { accepted });
  const ready = gate.ready;
  const statusEvent = deriveStatusEvent(contract, ready);

  return deepFreeze({
    kind: "aios.rollback.status-handoff",
    apiVersion: "aios.integration/v1",
    jobId: contract.jobId,
    ready,
    gate,
    statusEvent,
    runtimeCommand: ready ? contract.nextAction.runtimeCommand : gate.nextAction,
    restartToken: ready ? contract.restartToken : null,
    adapter: {
      name: contract.adapter.name,
      status: contract.adapter.status,
      handoff: contract.adapter.handoff,
      retryAfterSeconds: contract.adapter.retryAfterSeconds,
    },
    truthBoundary: {
      externalWritesAllowed: false,
      memoryWritePolicy: contract.policy.memoryWritePolicy,
      checkpointCount: contract.checkpoints.length,
      incompleteCheckpoints: contract.checkpoints.filter((checkpoint) => !checkpoint.complete).length,
      analyticsExportId: contract.analytics?.exportSummary?.exportId ?? null,
      providerContractId: contract.providerContract?.contractId ?? null,
    },
    analytics: contract.analytics ?? buildRollbackAnalyticsSnapshot(contract),
    providerContract: contract.providerContract ?? buildRollbackProviderHandoffContract(rollbackContract, options),
    blockedReasons: ready ? [] : uniqueSorted([
      ...gate.blockers.map((blocker) => blocker.message),
    ]),
  });
}

export function assertRollbackContractReady(rollbackContract) {
  const contract = normalizeRollbackContract(rollbackContract);
  if (!contract.readyForRuntimeHandoff) {
    throw new Error(`rollback contract is not handoff-ready: ${contract.blockedReasons.join("; ")}`);
  }
  return true;
}

export function summarizeRollbackContract(rollbackContract) {
  const contract = normalizeRollbackContract(rollbackContract);

  return deepFreeze({
    kind: "aios.rollback.summary",
    apiVersion: "aios.language/v1",
    jobId: contract.jobId,
    status: contract.status,
    nextAction: contract.nextAction.action,
    commandCount: contract.commands.length,
    checkpointCount: contract.checkpoints.length,
    adapterStatus: contract.adapter.status,
    readyForRuntimeHandoff: contract.readyForRuntimeHandoff,
    gateStatus: contract.handoffGate.status,
    gateBlockers: contract.handoffGate.blockerCount,
    blockedReasons: contract.blockedReasons,
    analytics: {
      exportId: contract.analytics?.exportSummary?.exportId ?? null,
      exportStatus: contract.analytics?.exportSummary?.exportStatus ?? "unknown",
      timelineEvents: contract.analytics?.counters?.timelineEvents ?? 0,
      replayableCommands: contract.analytics?.counters?.replayableCommands ?? 0,
      pendingCheckpoints: contract.analytics?.counters?.pendingCheckpoints ?? 0,
    },
    providerContract: {
      contractId: contract.providerContract?.contractId ?? null,
      provider: contract.providerContract?.provider ?? contract.adapter.name,
      handoffStatus: contract.providerContract?.handoffState?.status ?? "unknown",
      syncReady: contract.providerContract?.sync?.ready ?? false,
      negotiatedCapabilities: contract.providerContract?.negotiation?.grantedCapabilities?.length ?? 0,
      deniedCapabilities: contract.providerContract?.negotiation?.deniedCapabilities?.length ?? 0,
    },
  });
}

export function buildRollbackAnalyticsSnapshot(rollbackContract, options = {}) {
  const contract = normalizeRollbackContract(rollbackContract);
  return buildRollbackAnalyticsFrom({
    program: {
      job: {
        id: contract.jobId,
        runtimeAdapter: contract.adapter.name,
        memory: { namespace: contract.checkpoints[0]?.memoryNamespace ?? contract.jobId },
      },
      manifest: contract.package,
    },
    audit: options.audit ?? null,
    commands: contract.commands,
    checkpoints: contract.checkpoints,
    adapter: contract.adapter,
    validation: contract.validation,
    status: contract.status,
    blockedReasons: contract.blockedReasons,
    nextAction: contract.nextAction,
  }, options);
}

export function buildRollbackHandoffGate(rollbackContract, options = {}) {
  const contract = rollbackContract?.kind === "aios.rollback.contract"
    ? normalizeRollbackContract(rollbackContract)
    : rollbackContract;
  if (!contract || typeof contract !== "object") {
    throw new Error("rollbackContract must be produced by buildRollbackContract");
  }

  const accepted = Boolean(options.accepted ?? false);
  const blockers = buildRollbackGateBlockers(contract, accepted);
  const status = deriveRollbackGateStatus(contract, blockers, accepted);

  return deepFreeze({
    kind: "aios.rollback.handoff-gate",
    apiVersion: "aios.integration/v1",
    jobId: contract.jobId,
    ready: status === "open",
    accepted,
    status,
    nextAction: nextRollbackGateAction(status, contract),
    blockerCount: blockers.length,
    blockers,
    restartSafe: blockers.every((blocker) => blocker.restartSafe !== false),
    truthBoundary: {
      externalWritesAllowed: false,
      memoryWritePolicy: contract.policy?.memoryWritePolicy ?? "local-only",
      checkpointCount: contract.checkpoints?.length ?? 0,
      incompleteCheckpoints: (contract.checkpoints ?? []).filter((checkpoint) => !checkpoint.complete).length,
    },
  });
}

export function buildRollbackProviderHandoffContract(rollbackContract, options = {}) {
  const contract = normalizeRollbackContract(rollbackContract);
  return buildRollbackProviderHandoffContractFrom({
    program: {
      job: {
        id: contract.jobId,
        runtimeAdapter: contract.adapter.name,
        capabilities: contract.providerContract?.negotiation?.requestedCapabilities ?? [],
        memory: { namespace: contract.checkpoints[0]?.memoryNamespace ?? contract.jobId },
      },
      manifest: contract.package,
    },
    audit: options.audit ?? null,
    commands: contract.commands,
    checkpoints: contract.checkpoints,
    adapter: contract.adapter,
    validation: contract.validation,
    status: contract.status,
    blockedReasons: contract.blockedReasons,
    nextAction: contract.nextAction,
    analytics: contract.analytics ?? buildRollbackAnalyticsSnapshot(contract),
  }, options);
}

export function buildRollbackPreviewAcceptanceContract(rollbackContract, options = {}) {
  const contract = normalizeRollbackContract(rollbackContract);
  const accepted = Boolean(options.accepted ?? false);
  const acceptedBy = accepted ? String(options.acceptedBy ?? "operator") : null;
  const acceptedAt = accepted ? String(options.acceptedAt ?? "logical:rollback.accepted") : null;
  const gate = buildRollbackHandoffGate(contract, { accepted });
  const providerContract = contract.providerContract ?? buildRollbackProviderHandoffContract(contract, options);
  const analytics = contract.analytics ?? buildRollbackAnalyticsSnapshot(contract, options);
  const validationErrors = contract.validation?.errors ?? [];
  const validationWarnings = contract.validation?.warnings ?? [];
  const pendingCheckpoints = contract.checkpoints.filter((checkpoint) => !checkpoint.complete);
  const failedCommands = contract.commands.filter((command) => command.failed);
  const replayableCommands = contract.commands.filter((command) => command.replayable);
  const canAccept = contract.readyForRuntimeHandoff
    && gate.blockers.every((blocker) => blocker.category !== "contract")
    && providerContract.negotiation.satisfied;
  const ready = accepted && gate.ready && providerContract.handoffState.ready;
  const validationSummary = {
    valid: validationErrors.length === 0,
    status: validationErrors.length === 0
      ? validationWarnings.length > 0 ? "warning" : "valid"
      : "invalid",
    errors: validationErrors,
    warnings: validationWarnings,
    checked: {
      rollbackPolicy: contract.policy.rollback,
      memoryWritePolicy: contract.policy.memoryWritePolicy,
      adapterStatus: contract.adapter.status,
      providerNegotiationSatisfied: providerContract.negotiation.satisfied,
      checkpointCount: contract.checkpoints.length,
      pendingCheckpointCount: pendingCheckpoints.length,
      failedCommandCount: failedCommands.length,
      replayableCommandCount: replayableCommands.length,
    },
  };
  const blockers = uniqueSorted([
    ...gate.blockers.map((blocker) => blocker.message),
    ...providerContract.handoffState.blockedReasons,
    ...validationErrors,
    ...(accepted || canAccept ? [] : ["operator acceptance is pending"]),
  ]);
  const commands = [
    {
      id: "review",
      command: "rollback.preview.review",
      enabled: blockers.length > 0,
      state: blockers.length > 0 ? "active" : "complete",
      label: "Review rollback preview",
      reason: blockers[0] ?? "rollback preview has no blockers",
    },
    {
      id: "accept",
      command: "rollback.preview.accept",
      enabled: canAccept && !accepted,
      state: accepted ? "accepted" : canAccept ? "ready" : "blocked",
      label: "Accept rollback preview",
      reason: canAccept
        ? "rollback recovery can be accepted for runtime handoff"
        : blockers[0] ?? "rollback recovery cannot be accepted yet",
    },
    {
      id: "resume",
      command: "recovery.resume",
      enabled: ready && contract.status === "resume-ready",
      state: contract.status === "resume-ready" ? "ready" : "not-needed",
      label: "Resume from checkpoint",
      reason: pendingCheckpoints[0]
        ? `resume ${pendingCheckpoints[0].commandId}`
        : "no checkpoint resume is pending",
    },
    {
      id: "rollback",
      command: "recovery.rollback",
      enabled: ready && contract.status === "rollback-ready",
      state: contract.status === "rollback-ready" ? "ready" : "not-needed",
      label: "Rollback to snapshot",
      reason: failedCommands[0]
        ? `rollback ${failedCommands[0].id}`
        : "no failed command requires rollback",
    },
    {
      id: "export",
      command: analytics.exportSummary.runtimeCommand,
      enabled: ready && analytics.exportSummary.readyForExport,
      state: analytics.exportSummary.readyForExport ? "ready" : "blocked",
      label: "Export rollback status",
      reason: analytics.exportSummary.readyForExport
        ? `export ${analytics.exportSummary.exportStatus}`
        : analytics.exportSummary.blockedReasons[0] ?? "rollback export is blocked",
    },
  ];
  const activeCommand = commands.find((command) => command.enabled)
    ?? commands.find((command) => command.state === "blocked")
    ?? commands[0];

  return deepFreeze({
    kind: "aios.rollback.preview-acceptance",
    apiVersion: "aios.ui/v1",
    jobId: contract.jobId,
    ready,
    status: ready
      ? "accepted"
      : canAccept ? "awaiting_acceptance" : gate.status,
    nextAction: ready ? activeCommand.command : activeCommand.command,
    accepted,
    acceptedBy,
    acceptedAt,
    canAccept,
    validationSummary,
    readiness: {
      contractReady: contract.readyForRuntimeHandoff,
      gateReady: gate.ready,
      providerReady: providerContract.handoffState.ready,
      analyticsReady: analytics.exportSummary.readyForExport,
      restartSafe: gate.restartSafe && providerContract.handoffState.restartSafe,
      nextRuntimeCommand: ready ? contract.nextAction.runtimeCommand : gate.nextAction,
    },
    preview: {
      title: "Rollback recovery preview",
      visibleStatus: ready
        ? "Rollback recovery accepted"
        : blockers[0] ?? contract.nextAction.label,
      primaryAction: activeCommand.command,
      disabledReason: ready ? null : blockers[0] ?? null,
      badge: ready ? "accepted" : canAccept ? "acceptance-required" : "review-required",
    },
    acceptance: {
      required: true,
      accepted,
      acceptedBy,
      acceptedAt,
      command: "rollback.preview.accept",
      idempotencyKey: `${contract.jobId}:rollback:accept:${contract.restartToken}`,
      blockedReasons: accepted ? [] : blockers,
    },
    nextSteps: commands
      .filter((command) => command.enabled || command.state === "blocked")
      .map((command) => ({
        action: command.command,
        label: command.label,
        reason: command.reason,
        enabled: command.enabled,
      })),
    commands,
    blockedReasons: blockers,
    analytics: {
      exportId: analytics.exportSummary.exportId,
      exportStatus: analytics.exportSummary.exportStatus,
      readyForExport: analytics.exportSummary.readyForExport,
      timelineEvents: analytics.timeline.length,
      pendingCheckpoints: analytics.counters.pendingCheckpoints,
      failedCommands: analytics.counters.failedCommands,
    },
    providerContract: {
      contractId: providerContract.contractId,
      provider: providerContract.provider,
      handoffStatus: providerContract.handoffState.status,
      syncReady: providerContract.sync.ready,
      deniedCapabilities: providerContract.negotiation.deniedCapabilities,
    },
    truthBoundary: {
      externalWritesAllowed: false,
      memoryWritePolicy: contract.policy.memoryWritePolicy,
      generatedBy: "rollback-preview-acceptance",
    },
  });
}

function buildRecoveryCommands(program, options) {
  const commandStatuses = new Map(Object.entries(options.commandStatuses ?? {}));

  return program.job.plan.map((step, index) => {
    const commandId = step.op;
    const verifierHints = normalizeVerifierHints(step.verifierHints);
    const status = normalizeCommandStatus(
      commandStatuses.get(commandId)
        ?? commandStatuses.get(step.id)
        ?? inferCommandStatus(index, options.completedSteps ?? 0, options.failedStep),
    );
    const localWrite = step.output === "statusEvent"
      || step.op.includes("status")
      || verifierHints.some((hint) => hint.includes("boundary=no-external-write"));

    return deepFreeze({
      id: commandId,
      stepId: step.id,
      index,
      input: step.input,
      output: step.output,
      status,
      complete: status === "completed",
      failed: status === "failed",
      replayable: status !== "external_write",
      idempotencyKey: `${program.job.id}:${index + 1}:${commandId}`,
      checkpointKey: `${program.job.memory.namespace}:checkpoint:${index + 1}:${commandId}`,
      rollbackAction: localWrite ? `${commandId}.local.retract` : null,
      verifierHints,
    });
  });
}

function buildCheckpoints(program, commands, audit, options) {
  const mounted = new Set(options.mountedCheckpoints ?? []);
  const auditMissing = new Set(audit?.missingEvidence ?? []);

  return commands.map((command) => {
    const evidenceSubject = `step:${command.id}`;
    const complete = command.complete
      || mounted.has(command.checkpointKey)
      || mounted.has(command.id);
    const evidenceReady = !audit || !auditMissing.has(evidenceSubject);

    return deepFreeze({
      key: command.checkpointKey,
      commandId: command.id,
      memoryNamespace: program.job.memory.namespace,
      status: complete ? "completed" : command.failed ? "failed" : "pending",
      complete,
      evidenceSubject,
      evidenceReady,
      required: true,
      resumeCursor: `${program.job.id}:${command.index + 1}`,
    });
  });
}

function buildAdapterRecoveryState(program, audit, checkpoints, options) {
  const status = normalizeAdapterStatus(options.adapterStatus ?? "healthy");
  const incomplete = checkpoints.filter((checkpoint) => !checkpoint.complete);
  const terminalAudit = audit ? TERMINAL_AUDIT_STATUSES.includes(audit.status) : false;
  const handoff = status === "healthy" && (incomplete.length > 0 || terminalAudit)
    ? "available"
    : status === "degraded"
      ? "deferred"
      : "blocked";

  return deepFreeze({
    name: program.job.runtimeAdapter,
    status,
    checkedAt: String(options.adapterCheckedAt ?? "logical:recovery"),
    retryAfterSeconds: status === "degraded"
      ? Number(options.retryAfterSeconds ?? 30)
      : null,
    handoff,
    reason: handoff === "available"
      ? "adapter can accept deterministic recovery state"
      : status === "degraded"
        ? "adapter recovery is temporarily degraded"
        : "adapter recovery is unavailable",
  });
}

function buildRollbackProviderHandoffContractFrom({
  program,
  commands,
  checkpoints,
  adapter,
  validation,
  status,
  blockedReasons,
  nextAction,
  analytics,
}, options = {}) {
  const requestedCapabilities = normalizeProviderCapabilities(
    options.requestedCapabilities ?? program.job.capabilities ?? []
  );
  const providerCapabilities = normalizeProviderCapabilities(
    options.providerCapabilities ?? requestedCapabilities
  );
  const grantedCapabilities = requestedCapabilities.filter((capability) => providerCapabilities.includes(capability));
  const deniedCapabilities = requestedCapabilities.filter((capability) => !providerCapabilities.includes(capability));
  const pendingCheckpoints = checkpoints.filter((checkpoint) => !checkpoint.complete);
  const failedCommands = commands.filter((command) => command.failed);
  const replayableCommands = commands.filter((command) => command.replayable);
  const ready = validation.valid
    && blockedReasons.length === 0
    && deniedCapabilities.length === 0
    && adapter.handoff !== "blocked";
  const contractId = stableToken([
    "rollback.provider",
    program.job.id,
    adapter.name,
    status,
    analytics.exportSummary.exportId,
    grantedCapabilities.join(","),
    deniedCapabilities.join(",")
  ]);

  return deepFreeze({
    kind: "aios.rollback.provider-handoff-contract",
    apiVersion: "aios.integration/v1",
    contractId,
    provider: adapter.name,
    jobId: program.job.id,
    package: {
      name: program.manifest.name,
      version: program.manifest.version,
    },
    negotiation: {
      requestedCapabilities,
      grantedCapabilities,
      deniedCapabilities,
      satisfied: deniedCapabilities.length === 0,
      requiredRuntimeAdapter: adapter.name,
      memoryWritePolicy: "local-only"
    },
    sync: {
      direction: "runtime-to-provider",
      ready,
      status: ready ? "ready" : "blocked",
      checkpointCount: checkpoints.length,
      pendingCheckpointCount: pendingCheckpoints.length,
      failedCommandCount: failedCommands.length,
      replayableCommandCount: replayableCommands.length,
      resumeCursor: pendingCheckpoints[0]?.resumeCursor ?? null,
      checkpointKeys: checkpoints.map((checkpoint) => checkpoint.key),
      analyticsExportId: analytics.exportSummary.exportId,
      exportStatus: analytics.exportSummary.exportStatus
    },
    capabilityHints: commands.map((command) => ({
      commandId: command.id,
      status: command.status,
      replayable: command.replayable,
      idempotencyKey: command.idempotencyKey,
      rollbackAction: command.rollbackAction,
      handoffCommand: command.failed
        ? "recovery.rollback"
        : command.complete
          ? "status.timeline.export"
          : "recovery.resume"
    })),
    handoffState: {
      ready,
      status: ready ? "ready" : status,
      nextAction: ready ? nextAction.runtimeCommand : "provider.rollback.review",
      restartSafe: replayableCommands.length === commands.length && adapter.handoff !== "blocked",
      adapterStatus: adapter.status,
      adapterHandoff: adapter.handoff,
      retryAfterSeconds: adapter.retryAfterSeconds,
      blockedReasons: uniqueSorted([
        ...blockedReasons,
        ...validation.errors,
        ...deniedCapabilities.map((capability) => `provider capability denied: ${capability}`),
        ...(adapter.handoff === "blocked" ? [adapter.reason] : [])
      ])
    },
    exportSummary: {
      exportId: contractId,
      analyticsExportId: analytics.exportSummary.exportId,
      readyForExport: ready,
      exportStatus: ready ? status : "blocked",
      nextAction: ready ? nextAction.action : "review-provider-handoff",
      timelineEvents: analytics.timeline.length,
      historySnapshots: analytics.historySnapshots.length
    },
    truthBoundary: {
      externalWritesAllowed: false,
      generatedBy: "rollback-provider-handoff-contract",
      memoryWritePolicy: "local-only",
      providerSyncRequiresRuntimeAdapter: true
    }
  });
}

function buildRollbackGateBlockers(contract, accepted) {
  return uniqueSortedObjects([
    ...contract.validation.errors.map((error) => ({
      id: stableToken(["validation", error]),
      category: "contract",
      code: "aios.rollback.validation",
      action: "resolve-recovery-blockers",
      subject: contract.jobId,
      message: error,
      restartSafe: false,
    })),
    ...(accepted ? [] : [{
      id: stableToken(["acceptance", contract.jobId]),
      category: "operator",
      code: "aios.rollback.acceptance_required",
      action: "collect-operator-acceptance",
      subject: contract.jobId,
      message: "operator acceptance required before recovery handoff",
      restartSafe: true,
    }]),
    ...contract.checkpoints
      .filter((checkpoint) => checkpoint.required && !checkpoint.evidenceReady)
      .map((checkpoint) => ({
        id: stableToken(["checkpoint", checkpoint.key, checkpoint.evidenceSubject]),
        category: "evidence",
        code: "aios.rollback.checkpoint_evidence_missing",
        action: "collect-checkpoint-evidence",
        subject: checkpoint.evidenceSubject,
        message: `missing checkpoint evidence: ${checkpoint.evidenceSubject}`,
        restartSafe: true,
      })),
    ...contract.checkpoints
      .filter((checkpoint) => checkpoint.required && checkpoint.evidenceReady && !checkpoint.complete)
      .map((checkpoint) => ({
        id: stableToken(["checkpoint", checkpoint.key, "pending"]),
        category: "checkpoint",
        code: "aios.rollback.checkpoint_pending",
        action: "resume-from-checkpoint",
        subject: checkpoint.commandId,
        message: `checkpoint pending for ${checkpoint.commandId}`,
        restartSafe: true,
      })),
    ...(contract.adapter.status === "degraded" ? [{
      id: stableToken(["adapter", contract.adapter.name, "degraded"]),
      category: "adapter",
      code: "aios.rollback.adapter_degraded",
      action: "wait-for-adapter-recovery",
      subject: contract.adapter.name,
      message: contract.adapter.reason,
      retryAfterSeconds: contract.adapter.retryAfterSeconds,
      restartSafe: true,
    }] : []),
    ...(contract.adapter.handoff === "blocked" ? [{
      id: stableToken(["adapter", contract.adapter.name, "blocked"]),
      category: "adapter",
      code: "aios.rollback.adapter_blocked",
      action: "resolve-recovery-blockers",
      subject: contract.adapter.name,
      message: contract.adapter.reason,
      restartSafe: false,
    }] : []),
    ...contract.commands
      .filter((command) => command.failed)
      .map((command) => ({
        id: stableToken(["command", command.id, "failed"]),
        category: "rollback",
        code: "aios.rollback.command_failed",
        action: "rollback-to-snapshot",
        subject: command.id,
        message: `rollback required for failed command ${command.id}`,
        restartSafe: command.replayable,
      })),
  ], (blocker) => [blocker.code, blocker.subject, blocker.message].join(":"));
}

function deriveRollbackGateStatus(contract, blockers, accepted) {
  if (blockers.length === 0 && contract.readyForRuntimeHandoff && accepted) return "open";
  if (blockers.some((blocker) => blocker.category === "contract")) return "contract_blocked";
  if (blockers.some((blocker) => blocker.category === "adapter")) return "adapter_blocked";
  if (blockers.some((blocker) => blocker.category === "evidence")) return "evidence_blocked";
  if (blockers.some((blocker) => blocker.category === "rollback")) return "rollback_ready";
  if (blockers.some((blocker) => blocker.category === "checkpoint")) return "resume_ready";
  if (!accepted) return "awaiting_acceptance";
  return "contract_blocked";
}

function nextRollbackGateAction(status, contract) {
  if (status === "open") return contract.nextAction.runtimeCommand;
  if (status === "awaiting_acceptance") return "recovery.accept";
  if (status === "adapter_blocked") return "adapter.status.poll";
  if (status === "evidence_blocked") return "recovery.evidence.collect";
  if (status === "rollback_ready") return "recovery.rollback";
  if (status === "resume_ready") return "recovery.resume";
  return "recovery.review";
}

function validateRecoveryContract(program, commands, checkpoints, adapter, audit) {
  const errors = [];
  const warnings = [];

  if (program.job.recovery.rollback !== "snapshot") {
    errors.push(`unsupported rollback policy: ${program.job.recovery.rollback}`);
  }
  if (program.job.memory.writePolicy !== "local-only") {
    errors.push(`unsupported memory write policy: ${program.job.memory.writePolicy}`);
  }
  if (commands.length === 0) {
    errors.push("recovery contract requires at least one command");
  }
  if (commands.some((command) => !command.idempotencyKey)) {
    errors.push("every recovery command requires an idempotency key");
  }
  if (checkpoints.some((checkpoint) => checkpoint.required && !checkpoint.evidenceReady)) {
    errors.push("required checkpoint evidence is missing");
  }
  if (adapter.status === "offline") {
    errors.push("adapter recovery is offline");
  }
  if (audit?.externalWriteViolations > 0) {
    errors.push(`${audit.externalWriteViolations} external write violation(s) block rollback handoff`);
  }
  if (adapter.status === "degraded") {
    warnings.push("adapter recovery handoff is deferred until retry window");
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
  });
}

function deriveRecoveryStatus(commands, checkpoints, adapter, validation, audit) {
  if (!validation.valid) {
    return "blocked";
  }
  if (adapter.status === "degraded") {
    return "adapter-wait";
  }
  if (commands.some((command) => command.failed)) {
    return "rollback-ready";
  }
  if (checkpoints.some((checkpoint) => !checkpoint.complete)) {
    return "resume-ready";
  }
  if (audit && audit.status === "failed") {
    return "rollback-ready";
  }
  return "clean";
}

function deriveNextAction(status, commands, adapter, blockedReasons) {
  if (blockedReasons.length > 0) {
    return deepFreeze({
      action: "resolve-recovery-blockers",
      runtimeCommand: "recovery.review",
      label: "Resolve recovery blockers",
    });
  }
  if (status === "adapter-wait") {
    return deepFreeze({
      action: "wait-for-adapter-recovery",
      runtimeCommand: "adapter.status.poll",
      label: "Wait for adapter recovery",
    });
  }
  if (status === "rollback-ready") {
    const failed = commands.find((command) => command.failed);
    return deepFreeze({
      action: "rollback-to-snapshot",
      runtimeCommand: "recovery.rollback",
      label: failed ? `Rollback ${failed.id}` : "Rollback failed audit",
    });
  }
  if (status === "resume-ready") {
    const pending = commands.find((command) => !command.complete);
    return deepFreeze({
      action: "resume-from-checkpoint",
      runtimeCommand: "recovery.resume",
      label: pending ? `Resume ${pending.id}` : "Resume package job",
    });
  }
  return deepFreeze({
    action: "export-clean-status",
    runtimeCommand: "status.timeline.export",
    label: "Export clean status",
  });
}

function buildBlockedReasons(validation, adapter, checkpoints, audit) {
  return uniqueSorted([
    ...validation.errors,
    ...(adapter.handoff === "blocked" ? [adapter.reason] : []),
    ...checkpoints
      .filter((checkpoint) => checkpoint.required && !checkpoint.evidenceReady)
      .map((checkpoint) => `missing checkpoint evidence: ${checkpoint.evidenceSubject}`),
    ...(audit?.status === "rolled_back" ? ["audit already rolled back"] : []),
  ]);
}

function deriveStatusEvent(contract, ready) {
  if (!ready) {
    return "verifying";
  }
  if (contract.status === "rollback-ready") {
    return "rolled_back";
  }
  if (contract.status === "blocked") {
    return "failed";
  }
  return "completed";
}

function buildRollbackAnalyticsFrom({
  program,
  audit,
  commands,
  checkpoints,
  adapter,
  validation,
  status,
  blockedReasons,
  nextAction,
}, options = {}) {
  const commandCounts = countBy(commands, (command) => command.status);
  const checkpointCounts = countBy(checkpoints, (checkpoint) => checkpoint.status);
  const failedCommands = commands.filter((command) => command.failed);
  const pendingCheckpoints = checkpoints.filter((checkpoint) => !checkpoint.complete);
  const replayableCommands = commands.filter((command) => command.replayable);
  const blocked = blockedReasons.length > 0 || validation.valid !== true;
  const exportId = stableToken([
    "rollback.analytics",
    program.job.id,
    status,
    adapter.status,
    commands.map((command) => `${command.id}:${command.status}`).join(","),
    checkpoints.map((checkpoint) => `${checkpoint.commandId}:${checkpoint.status}`).join(","),
  ]);
  const timeline = [
    {
      sequence: 1,
      at: String(options.generatedAt ?? "logical:rollback.analytics"),
      status,
      source: "rollback-contract",
      message: blocked
        ? blockedReasons[0] ?? validation.errors[0] ?? "rollback contract blocked"
        : "rollback contract ready for deterministic recovery handoff",
    },
    ...commands.map((command, index) => ({
      sequence: index + 2,
      at: `logical:command:${index + 1}`,
      status: command.status,
      source: "rollback-command",
      commandId: command.id,
      checkpointKey: command.checkpointKey,
      message: command.failed
        ? `command ${command.id} requires rollback`
        : command.complete
          ? `command ${command.id} completed`
          : `command ${command.id} pending checkpoint resume`,
    })),
    {
      sequence: commands.length + 2,
      at: String(adapter.checkedAt ?? "logical:adapter"),
      status: adapter.status,
      source: "adapter",
      message: adapter.reason,
      retryAfterSeconds: adapter.retryAfterSeconds,
    },
  ];
  const historySnapshots = timeline.map((event) => ({
    key: stableToken(["rollback.history", program.job.id, event.sequence, event.status, event.source]),
    sequence: event.sequence,
    at: event.at,
    status: event.status,
    source: event.source,
    commandId: event.commandId ?? null,
    exportId,
    ready: !blocked && ["clean", "resume-ready", "rollback-ready"].includes(status),
  }));
  const exportSummary = {
    exportId,
    jobId: program.job.id,
    package: program.manifest.name,
    adapter: adapter.name,
    exportStatus: blocked ? "blocked" : status,
    readyForExport: !blocked,
    nextAction: nextAction.action,
    runtimeCommand: nextAction.runtimeCommand,
    blockedReasons,
    warnings: validation.warnings,
    stateKeys: checkpoints.map((checkpoint) => checkpoint.key),
  };

  return deepFreeze({
    kind: "aios.rollback.analytics",
    apiVersion: "aios.language/v1",
    jobId: program.job.id,
    counters: {
      commands: commands.length,
      replayableCommands: replayableCommands.length,
      failedCommands: failedCommands.length,
      completedCommands: commands.filter((command) => command.complete).length,
      pendingCommands: commands.filter((command) => command.status === "pending").length,
      checkpoints: checkpoints.length,
      completedCheckpoints: checkpoints.filter((checkpoint) => checkpoint.complete).length,
      pendingCheckpoints: pendingCheckpoints.length,
      missingEvidence: checkpoints.filter((checkpoint) => !checkpoint.evidenceReady).length,
      validationErrors: validation.errors.length,
      validationWarnings: validation.warnings.length,
      blockedReasons: blockedReasons.length,
      timelineEvents: timeline.length,
      byCommandStatus: commandCounts,
      byCheckpointStatus: checkpointCounts,
    },
    timeline,
    historySnapshots,
    exportSummary,
    truthBoundary: {
      externalWritesAllowed: false,
      memoryWritePolicy: "local-only",
      generatedBy: "rollback-analytics",
      auditStatus: audit?.status ?? "not-provided",
    },
  });
}

function normalizeCompiledProgram(program) {
  if (!program || typeof program !== "object") {
    throw new Error("compiledProgram must be produced by compilePackageSource");
  }
  if (!program.manifest || !program.job || !program.lifecycle) {
    throw new Error("compiledProgram is missing manifest, job, or lifecycle");
  }
  if (program.job.kind !== "aios.kernel.job") {
    throw new Error("compiledProgram.job must be an AI OS kernel job");
  }
  return program;
}

function normalizeAuditReport(report) {
  if (!report) {
    return null;
  }
  if (report.kind === "aios.audit.truth-boundary") {
    return {
      status: report.status,
      missingEvidence: report.evidence.missing,
      externalWriteViolations: report.boundary.externalWritesObserved.length,
    };
  }
  if (report.kind === "aios.audit.bundle") {
    return {
      status: report.status,
      missingEvidence: report.missingEvidence,
      externalWriteViolations: report.violations.length,
    };
  }
  throw new Error("auditReport must be an AI OS audit report or bundle");
}

function normalizeRollbackContract(contract) {
  if (!contract || contract.kind !== "aios.rollback.contract") {
    throw new Error("rollbackContract must be produced by buildRollbackContract");
  }
  if (!RECOVERY_STATUSES.includes(contract.status)) {
    throw new Error(`unsupported rollback contract status: ${contract.status}`);
  }
  return contract;
}

function normalizeCommandStatus(status) {
  const normalized = String(status ?? "pending").trim().toLowerCase();
  if (["pending", "completed", "failed", "external_write"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "succeeded" || normalized === "done") {
    return "completed";
  }
  return "pending";
}

function normalizeAdapterStatus(status) {
  const normalized = String(status ?? "healthy").trim().toLowerCase();
  if (["healthy", "degraded", "offline"].includes(normalized)) {
    return normalized;
  }
  return "healthy";
}

function normalizeVerifierHints(hints) {
  if (Array.isArray(hints)) {
    return hints.map(String).filter(Boolean);
  }
  if (hints && typeof hints === "object") {
    return Object.entries(hints)
      .map(([key, value]) => `${key}=${value}`)
      .filter(Boolean)
      .sort();
  }
  return [];
}

function normalizeProviderCapabilities(capabilities) {
  const list = Array.isArray(capabilities)
    ? capabilities
    : capabilities == null
      ? []
      : String(capabilities).split(",");
  return [...new Set(list.map((capability) => String(capability).trim()).filter(Boolean))].sort();
}

function inferCommandStatus(index, completedSteps, failedStep) {
  if (failedStep === index || failedStep === index + 1) {
    return "failed";
  }
  return index < Number(completedSteps ?? 0) ? "completed" : "pending";
}

function stableToken(parts) {
  const input = parts.join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `recovery_${hash.toString(16).padStart(8, "0")}`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function uniqueSortedObjects(values, keyFor) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function countBy(values, keyFor) {
  return values.reduce((counts, value) => {
    const key = String(keyFor(value) ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}
