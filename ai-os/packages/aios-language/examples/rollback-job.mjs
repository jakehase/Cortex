import {
  createAuditExportSnapshot,
  createEvidence,
  createStatusEvent,
  createTruthBoundaryReport,
} from "../stdlib/audit.mjs";
import {
  buildPackageRuntimeAdoptionSnapshot,
  buildProviderServiceContract,
  compilePackageSource,
} from "../stdlib/packages.mjs";
import {
  buildRecoveryStatusHandoffContract,
  buildRecoveryAudit,
  buildRecoveryProgram,
} from "./recovery-job.mjs";

export const rollbackJobSource = `# deterministic Mailchimp snapshot rollback contract
use mailchimp:campaign.read
use mailchimp:report.read
use memory:campaign.local
use rollback:snapshot.create
use verifier:evidence.record
use status:timeline.write
recover rollback=snapshot retry=1
step load-recovery-snapshot input=restartToken output=snapshot verify.status=snapshot-present
step verify-provider-readonly input=snapshot.providerCursor output=capabilityGrant verify.contract=provider-readonly
step retract-local-memory input=snapshot output=memoryClaim verify.boundary=local-only
step emit-rollback-status input=memoryClaim output=statusEvent verify.status=rolled-back
`;

export function buildRollbackProgram(options = {}) {
  return compilePackageSource(rollbackJobSource, {
    name: options.name ?? "mailchimp-rollback-job",
    version: options.version ?? "0.1.0",
    description: "Compile a Mailchimp snapshot rollback job that never writes back to the provider.",
    capabilities: options.capabilities ?? [],
    exports: {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      rollbackContract: "./examples/rollback-job.mjs#buildRollbackHandoffContract",
      rollbackRuntimeState: "./examples/rollback-job.mjs#buildRollbackPersistedRuntimeState",
      rollbackLifecycleControls: "./examples/rollback-job.mjs#buildRollbackLifecycleControls",
      recoveryHandoff: "./examples/recovery-job.mjs#buildRecoveryStatusHandoffContract",
    },
  }, {
    name: "mailchimp-rollback-job",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: options.dryRun ?? true,
      requireApproval: options.requireApproval ?? true,
      approvalTicket: options.approvalTicket,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 12,
    },
  });
}

export function buildRollbackAudit(program = buildRollbackProgram(), options = {}) {
  const missing = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missing.has(subject))
    .map((subject) => createEvidence(
      subject.includes("verify.contract") ? "operator-attestation" : "runtime-local-receipt",
      subject,
      { surface: "rollback-job", rollback: true },
    ));

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "rolled_back",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "rollback job queued" }),
      createStatusEvent("running", { at: "logical:1", message: "snapshot rollback started" }),
      createStatusEvent("verifying", { at: "logical:2", message: "local-only rollback checked" }),
      createStatusEvent(options.status ?? "rolled_back", {
        at: "logical:3",
        message: "rollback status handoff emitted",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildRollbackHandoffContract(
  program = buildRollbackProgram(),
  audit = buildRollbackAudit(program),
  options = {},
) {
  const recoveryProgram = options.recoveryProgram ?? buildRecoveryProgram(options);
  const recoveryAudit = options.recoveryAudit ?? buildRecoveryAudit(recoveryProgram, {
    ...options,
    status: options.recoveryStatus ?? "failed",
  });
  const recoveryHandoff = options.recoveryHandoff
    ?? buildRecoveryStatusHandoffContract(recoveryProgram, recoveryAudit, {
      ...options,
      accepted: options.recoveryAccepted ?? true,
      acceptedBy: options.acceptedBy ?? "rollback-contract",
    });
  const exportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:7",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const providerContract = buildProviderServiceContract(program, {
    externalApproval: options.approvalTicket,
    providerResource: "campaign-report-rollback",
    supportedCapabilities: options.supportedCapabilities,
    checkpoint: exportSnapshot.exportId,
  });
  const commands = buildRollbackCommands(program, audit, options);
  const operationalHealth = buildRollbackOperationalHealth(program, audit, recoveryHandoff, commands, options);
  const validation = validateRollbackContract(
    program,
    audit,
    exportSnapshot,
    providerContract,
    recoveryHandoff,
    commands,
    operationalHealth,
    options,
  );
  const accepted = Boolean(options.accepted ?? false);
  const ready = validation.ready && accepted;
  const acceptancePreview = buildRollbackAcceptancePreview(
    program,
    validation,
    recoveryHandoff,
    commands,
    operationalHealth,
    accepted,
    exportSnapshot,
    options,
  );
  const persistedRuntimeState = buildRollbackPersistedRuntimeState(
    program,
    validation,
    recoveryHandoff,
    commands,
    operationalHealth,
    accepted,
    exportSnapshot,
    options,
  );
  const clientRuntimeState = buildRollbackClientRuntimeState(
    program,
    validation,
    recoveryHandoff,
    commands,
    accepted,
    exportSnapshot,
    persistedRuntimeState,
    acceptancePreview,
  );
  const workflowHandoffLedger = buildRollbackWorkflowHandoffLedger(
    program,
    validation,
    recoveryHandoff,
    commands,
    operationalHealth,
    persistedRuntimeState,
    clientRuntimeState,
    acceptancePreview,
    exportSnapshot,
  );
  const analyticsExport = buildRollbackAnalyticsExport(
    program,
    audit,
    exportSnapshot,
    recoveryHandoff,
    commands,
    operationalHealth,
    validation,
    persistedRuntimeState,
    clientRuntimeState,
    acceptancePreview,
    workflowHandoffLedger,
    options,
  );
  const lifecycleControls = buildRollbackLifecycleControls(
    program,
    audit,
    validation,
    recoveryHandoff,
    commands,
    operationalHealth,
    persistedRuntimeState,
    clientRuntimeState,
    acceptancePreview,
    workflowHandoffLedger,
    analyticsExport,
    options,
  );
  const runtimeAdoption = buildPackageRuntimeAdoptionSnapshot(program, {
    providerContract,
    acceptance: {
      accepted,
      acceptedBy: accepted ? String(options.acceptedBy ?? "operator") : null,
      acceptedAt: accepted ? String(options.acceptedAt ?? "logical:8") : null,
      previewId: acceptancePreview.previewId,
    },
    persistedRuntimeState,
    clientRuntimeState,
    externalHandoff: {
      status: ready ? "rollback-status-ready" : "rollback-status-pending",
      ready,
      reference: ready ? persistedRuntimeState.restart.token : null,
      nextAction: ready ? "recovery.rollback" : validation.nextAction,
      blockedReasons: validation.blockedReasons,
      acceptancePreviewId: acceptancePreview.previewId,
      workflowLedgerId: workflowHandoffLedger.ledgerId,
      analyticsExportId: analyticsExport.exportId,
      lifecycleStatus: lifecycleControls.status,
      lifecycleNextAction: lifecycleControls.nextAction,
    },
  });

  return deepFreeze({
    kind: "mailchimp.rollback.handoff-contract",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready,
    statusEvent: ready ? "rolled_back" : "verifying",
    runtimeCommand: ready ? "recovery.rollback" : validation.nextAction,
    rollbackToken: ready ? stableToken([
      program.job.id,
      recoveryHandoff.restartToken,
      exportSnapshot.exportId,
      commands.map((command) => command.status).join(","),
    ]) : null,
    provider: {
      ...providerContract.provider,
      externalWritePolicy: "forbidden",
    },
    recoverySource: {
      jobId: recoveryHandoff.jobId,
      statusEvent: recoveryHandoff.statusEvent,
      restartToken: recoveryHandoff.restartToken,
      adapter: recoveryHandoff.adapter,
    },
    commands,
    operationalHealth,
    sync: {
      checkpoint: providerContract.sync.checkpoint,
      source: "local-snapshot",
      destination: providerContract.sync.localNamespace,
      externalHandoff: ready ? "rollback-status" : "none",
      memoryWritePolicy: providerContract.sync.memoryWritePolicy,
    },
    truthBoundary: {
      externalWritesAllowed: false,
      exportReady: exportSnapshot.truthBoundary.readyForExport,
      externalWriteViolations: audit.boundary.externalWritesObserved.length,
      missingEvidence: audit.evidence.missing,
    },
    acceptance: {
      accepted,
      acceptedBy: accepted ? String(options.acceptedBy ?? "operator") : null,
      acceptedAt: accepted ? String(options.acceptedAt ?? "logical:8") : null,
      previewId: acceptancePreview.previewId,
    },
    acceptancePreview,
    workflowHandoffLedger,
    analyticsExport,
    lifecycleControls,
    validation,
    persistedRuntimeState,
    clientRuntimeState,
    runtimeAdoption,
    exportSnapshot,
  });
}

export function buildRollbackPersistedRuntimeState(
  program = buildRollbackProgram(),
  validationOrContract = buildRollbackHandoffContract(program),
  recoveryHandoff,
  commands,
  operationalHealth,
  accepted,
  exportSnapshot,
  options = {},
) {
  const contractMode = validationOrContract.kind === "mailchimp.rollback.handoff-contract";
  const validation = contractMode ? validationOrContract.validation : validationOrContract;
  const sourceRecovery = contractMode ? validationOrContract.recoverySource : recoveryHandoff;
  const sourceCommands = contractMode ? validationOrContract.commands : commands;
  const legacySignature = typeof operationalHealth === "boolean";
  const sourceHealth = contractMode
    ? validationOrContract.operationalHealth
    : legacySignature
      ? validation.operationalHealth ?? buildRollbackOperationalHealth(program, null, sourceRecovery, sourceCommands, options)
      : operationalHealth ?? validation.operationalHealth ?? buildRollbackOperationalHealth(program, null, sourceRecovery, sourceCommands, options);
  const isAccepted = contractMode
    ? validationOrContract.acceptance.accepted
    : Boolean(legacySignature ? operationalHealth : accepted);
  const snapshot = contractMode
    ? validationOrContract.exportSnapshot
    : legacySignature ? accepted : exportSnapshot;
  const stateOptions = legacySignature ? exportSnapshot ?? {} : options;
  const priorReceipts = new Map((stateOptions.priorCommandReceipts ?? []).map((entry) => [
    String(entry.id ?? entry.command ?? entry.idempotencyKey),
    {
      status: String(entry.status ?? "applied"),
      receipt: entry.receipt ? String(entry.receipt) : null,
      appliedAt: entry.appliedAt ? String(entry.appliedAt) : null,
    },
  ]));
  const journalKey = `${program.job.memory.namespace}:rollback-journal:${snapshot?.exportId ?? "pending"}`;
  const blockedReasons = validation.blockedReasons;
  const ready = blockedReasons.length === 0 && isAccepted && sourceHealth.runtimeEnabled;
  const rows = sourceCommands.map((command, index) => {
    const prior = priorReceipts.get(command.id)
      ?? priorReceipts.get(command.idempotencyKey)
      ?? null;
    const replaySafe = command.providerWrite === false && command.evidenceReady;
    const desiredStatus = command.status === "rollback-target" ? "rolled-back" : "observed";
    const currentStatus = prior?.status ?? (ready && replaySafe ? "pending-replay" : "blocked");
    const idempotencyKey = `${journalKey}:${index + 1}:${command.id}`;

    return {
      id: command.id,
      stepId: command.stepId,
      journalEntryKey: `${journalKey}:entry:${index + 1}`,
      snapshotKey: command.snapshotKey,
      idempotencyKey,
      providerWrite: command.providerWrite,
      evidenceReady: command.evidenceReady,
      replaySafe,
      desiredStatus,
      currentStatus,
      receipt: prior?.receipt ?? null,
      replayCommand: replaySafe ? command.localAction : "rollback.review",
      resumeCursor: `${program.job.id}:rollback:persisted:${index + 1}`,
      blockers: uniqueSorted([
        ...(command.evidenceReady ? [] : [`rollback evidence missing: ${command.id}`]),
        ...(command.providerWrite ? [`provider write forbidden: ${command.id}`] : []),
      ]),
    };
  });
  const appliedRows = rows.filter((row) => row.currentStatus === "applied" || row.currentStatus === "rolled-back");
  const replayRows = rows.filter((row) => row.currentStatus === "pending-replay");
  const replayGuard = buildRollbackReplayGuard(
    program,
    validation,
    sourceRecovery,
    rows,
    sourceHealth,
    snapshot,
    ready,
  );
  const acceptancePreview = contractMode
    ? validationOrContract.acceptancePreview
    : buildRollbackAcceptancePreview(
      program,
      validation,
      sourceRecovery,
      sourceCommands,
      sourceHealth,
      isAccepted,
      snapshot,
      stateOptions,
    );

  return deepFreeze({
    kind: "mailchimp.rollback.persisted-runtime-state",
    apiVersion: "aios.state/v1",
    jobId: program.job.id,
    journalKey,
    ready,
    status: ready
      ? replayRows.length > 0 ? "rollback-replay-ready" : "rollback-replay-complete"
      : blockedReasons.length > 0 ? "rollback-blocked" : "rollback-awaiting-acceptance",
    generatedAt: String(stateOptions.persistedAt ?? "logical:8"),
    restart: {
      command: ready ? "recovery.rollback" : validation.nextAction,
      enabled: ready,
      token: ready ? stableToken([
        program.job.id,
        sourceRecovery.restartToken,
        snapshot?.exportId,
        rows.map((row) => `${row.id}:${row.currentStatus}`).join(","),
      ]) : null,
      idempotencyKey: `${program.job.id}:rollback:journal:${snapshot?.exportId ?? "pending"}`,
    },
    recoverySource: {
      jobId: sourceRecovery.jobId,
      statusEvent: sourceRecovery.statusEvent,
      restartToken: sourceRecovery.restartToken,
      restartTokenRequired: true,
    },
    health: {
      mode: sourceHealth.mode,
      severity: sourceHealth.severity,
      degraded: sourceHealth.degraded,
      retryAttempt: sourceHealth.retryAttempt,
      maxRetries: sourceHealth.maxRetries,
      retryAfterSeconds: sourceHealth.retryAfterSeconds,
      runtimeEnabled: sourceHealth.runtimeEnabled,
      actionableErrors: sourceHealth.actionableErrors,
    },
    acceptanceHandoff: {
      previewId: acceptancePreview.previewId,
      status: acceptancePreview.status,
      accepted: acceptancePreview.acceptance.accepted,
      readyForVerifierClaim: acceptancePreview.handoff.readyForVerifierClaim,
      auditCommand: acceptancePreview.handoff.audit.command,
      auditIdempotencyKey: acceptancePreview.handoff.audit.idempotencyKey,
      verifierClaimReference: acceptancePreview.handoff.verifierClaimReference,
      blockedReasons: acceptancePreview.validation.blockedReasons,
    },
    summary: {
      appliedCommands: appliedRows.length,
      replayableCommands: replayRows.length,
      totalCommands: rows.length,
      blockedReasons,
      replayGuardStatus: replayGuard.status,
      acceptancePreviewReady: acceptancePreview.ready,
    },
    replayGuard,
    rows,
  });
}

export function buildRollbackClientRuntimeState(
  program = buildRollbackProgram(),
  validationOrContract = buildRollbackHandoffContract(program),
  recoveryHandoff,
  commands,
  accepted,
  exportSnapshot,
  persistedRuntimeState,
  acceptancePreview,
) {
  const contractMode = validationOrContract.kind === "mailchimp.rollback.handoff-contract";
  const validation = contractMode ? validationOrContract.validation : validationOrContract;
  const sourceRecovery = contractMode ? validationOrContract.recoverySource : recoveryHandoff;
  const sourceCommands = contractMode ? validationOrContract.commands : commands;
  const sourceHealth = contractMode
    ? validationOrContract.operationalHealth
    : validation.operationalHealth ?? persistedRuntimeState?.health ?? buildRollbackOperationalHealth(
      program,
      null,
      recoveryHandoff,
      commands,
      {},
    );
  const isAccepted = contractMode ? validationOrContract.acceptance.accepted : Boolean(accepted);
  const snapshot = contractMode ? validationOrContract.exportSnapshot : exportSnapshot;
  const persistedState = contractMode
    ? validationOrContract.persistedRuntimeState
    : persistedRuntimeState ?? buildRollbackPersistedRuntimeState(
      program,
      validation,
      recoveryHandoff,
      commands,
      sourceHealth,
      accepted,
      exportSnapshot,
    );
  const preview = contractMode
    ? validationOrContract.acceptancePreview
    : acceptancePreview ?? buildRollbackAcceptancePreview(
      program,
      validation,
      sourceRecovery,
      sourceCommands,
      sourceHealth,
      isAccepted,
      snapshot,
    );
  const commandRows = sourceCommands.map((command, index) => {
    const blocked = !command.evidenceReady || command.providerWrite;
    const persistedRow = persistedState.rows.find((row) => row.id === command.id);
    return {
      id: command.id,
      stepId: command.stepId,
      state: blocked ? "blocked" : command.status,
      localAction: command.localAction,
      providerWrite: command.providerWrite,
      idempotencyKey: command.idempotencyKey,
      persistedState: persistedRow?.currentStatus ?? "unknown",
      journalEntryKey: persistedRow?.journalEntryKey ?? null,
      resumeCursor: `${program.job.id}:rollback:client:${index + 1}`,
      explanation: blocked
        ? "Rollback command cannot run until evidence is present and provider writes are forbidden."
        : "Rollback command is local-only and can be replayed safely.",
    };
  });
  const blockedReasons = validation.blockedReasons;
  const runtimeEnabled = blockedReasons.length === 0 && isAccepted && sourceHealth.runtimeEnabled;
  const replayGuard = persistedState.replayGuard ?? buildRollbackReplayGuard(
    program,
    validation,
    sourceRecovery,
    persistedState.rows,
    sourceHealth,
    snapshot,
    runtimeEnabled,
  );

  return deepFreeze({
    kind: "mailchimp.rollback.client-runtime-state",
    apiVersion: "aios.ui/v1",
    jobId: program.job.id,
    ready: runtimeEnabled,
    statusBadge: runtimeEnabled
      ? "ready-to-rollback"
      : blockedReasons.length > 0 ? "needs-review" : "awaiting-acceptance",
    runtime: {
      command: runtimeEnabled ? "recovery.rollback" : validation.nextAction,
      enabled: runtimeEnabled,
      idempotencyKey: `${program.job.id}:rollback:runtime:${snapshot?.exportId ?? "pending"}`,
      restartSafe: persistedState.ready
        && replayGuard.restartSafe
        && commandRows.every((command) => command.providerWrite === false && command.state !== "blocked"),
      persistedRestartToken: persistedState.restart.token,
      replayToken: replayGuard.replayToken,
    },
    acceptance: {
      required: true,
      accepted: isAccepted,
      command: "rollback.accept-handoff",
      idempotencyKey: `${program.job.id}:rollback:accept:${snapshot?.exportId ?? "pending"}`,
      previewId: preview.previewId,
      acceptedAt: preview.acceptance.acceptedAt,
      acceptedBy: preview.acceptance.acceptedBy,
      readyForVerifierClaim: preview.handoff.readyForVerifierClaim,
      verifierClaimReference: preview.handoff.verifierClaimReference,
    },
    recoverySource: {
      jobId: sourceRecovery.jobId,
      statusEvent: sourceRecovery.statusEvent,
      restartToken: sourceRecovery.restartToken,
      restartTokenRequired: true,
    },
    persistedState: {
      journalKey: persistedState.journalKey,
      status: persistedState.status,
      restartCommand: persistedState.restart.command,
      replayableCommands: persistedState.summary.replayableCommands,
      appliedCommands: persistedState.summary.appliedCommands,
      replayGuardStatus: replayGuard.status,
      acceptancePreviewStatus: preview.status,
    },
    health: {
      mode: sourceHealth.mode,
      severity: sourceHealth.severity,
      degraded: sourceHealth.degraded,
      retryAfterSeconds: sourceHealth.retryAfterSeconds,
      actionableErrors: sourceHealth.actionableErrors,
    },
    summary: {
      commandCount: commandRows.length,
      runnableCommands: commandRows.filter((command) => command.state !== "blocked").length,
      localOnlyCommands: commandRows.filter((command) => command.providerWrite === false).length,
      replayableCommands: replayGuard.summary.replayableCommands,
      blockedReplayCommands: replayGuard.summary.blockedCommands,
      blockedReasons,
      acceptancePreviewReady: preview.ready,
    },
    commands: commandRows,
    acceptancePreview: preview,
    replayGuard,
    actions: buildRollbackClientActions(validation, isAccepted, runtimeEnabled, snapshot),
  });
}

export function describeRollbackJob(options = {}) {
  const program = buildRollbackProgram(options);
  const audit = buildRollbackAudit(program, options);
  const contract = buildRollbackHandoffContract(program, audit, options);

  return deepFreeze({
    jobId: contract.jobId,
    ready: contract.ready,
    statusEvent: contract.statusEvent,
    runtimeCommand: contract.runtimeCommand,
    rollbackToken: contract.rollbackToken,
    provider: contract.provider,
    recoverySource: contract.recoverySource,
    operationalHealth: contract.operationalHealth,
    persistedRuntimeState: {
      journalKey: contract.persistedRuntimeState.journalKey,
      status: contract.persistedRuntimeState.status,
      restartToken: contract.persistedRuntimeState.restart.token,
      replayableCommands: contract.persistedRuntimeState.summary.replayableCommands,
      appliedCommands: contract.persistedRuntimeState.summary.appliedCommands,
    },
    clientRuntimeState: contract.clientRuntimeState,
    acceptancePreview: contract.acceptancePreview,
    workflowHandoffLedger: contract.workflowHandoffLedger,
    analyticsExport: {
      exportId: contract.analyticsExport.exportId,
      ready: contract.analyticsExport.ready,
      status: contract.analyticsExport.report.status,
      counters: contract.analyticsExport.counters,
      nextAction: contract.analyticsExport.report.nextAction,
    },
    lifecycleControls: {
      status: contract.lifecycleControls.status,
      enabled: contract.lifecycleControls.settings.enabled,
      nextAction: contract.lifecycleControls.nextAction,
      activeCommand: contract.lifecycleControls.activeCommand,
      canSchedule: contract.lifecycleControls.controls.canSchedule,
      canRun: contract.lifecycleControls.controls.canRun,
      blockedReasons: contract.lifecycleControls.blockedReasons,
    },
    runtimeAdoption: {
      adoptionKey: contract.runtimeAdoption.adoptionKey,
      ready: contract.runtimeAdoption.ready,
      status: contract.runtimeAdoption.status,
      nextAction: contract.runtimeAdoption.nextAction,
      primaryAction: contract.runtimeAdoption.clientState.primaryAction,
      restartSafe: contract.runtimeAdoption.clientState.restartSafe,
      blockedReasons: contract.runtimeAdoption.validation.blockedReasons,
    },
    blockedReasons: contract.validation.blockedReasons,
    nextSteps: buildRollbackNextSteps(contract),
  });
}

export function selfCheckRollbackJob(options = {}) {
  const summary = describeRollbackJob({
    accepted: true,
    acceptedBy: "self-check",
    approvalTicket: "self_check_approval",
    ...options,
  });

  return deepFreeze({
    kind: "mailchimp.rollback.self-check",
    apiVersion: "aios.example/v1",
    passed: summary.ready,
    errors: summary.blockedReasons,
    jobId: summary.jobId,
    runtimeCommand: summary.runtimeCommand,
    lifecycleControls: summary.lifecycleControls,
  });
}

export function buildRollbackLifecycleControls(
  program = buildRollbackProgram(),
  audit = buildRollbackAudit(program),
  validation = { ready: false, nextAction: "rollback.review", blockedReasons: ["rollback validation is pending"] },
  recoveryHandoff = {},
  commands = [],
  operationalHealth = buildRollbackOperationalHealth(program, audit, recoveryHandoff, commands),
  persistedRuntimeState = null,
  clientRuntimeState = null,
  acceptancePreview = null,
  workflowHandoffLedger = null,
  analyticsExport = null,
  options = {},
) {
  const settings = normalizeRollbackLifecycleSettings(program, options);
  const validationErrors = validateRollbackLifecycleSettings(
    program,
    audit,
    validation,
    recoveryHandoff,
    commands,
    operationalHealth,
    persistedRuntimeState,
    clientRuntimeState,
    acceptancePreview,
    workflowHandoffLedger,
    analyticsExport,
    settings,
  );
  const accepted = Boolean(acceptancePreview?.acceptance?.accepted ?? options.accepted ?? false);
  const rollbackReady = validationErrors.length === 0
    && validation.ready
    && accepted
    && Boolean(clientRuntimeState?.runtime?.restartSafe)
    && operationalHealth.runtimeEnabled;
  const commandRows = [
    {
      id: "enable",
      command: "rollback.lifecycle.enable",
      state: program.lifecycle.enabled ? "already-enabled" : settings.enabled ? "ready" : "not-requested",
      enabled: !program.lifecycle.enabled && settings.enabled && validationErrors.length === 0,
      idempotencyKey: `${program.job.id}:rollback:lifecycle:enable:${settings.settingsToken}`,
      blockers: settings.enabled ? [] : ["rollback lifecycle enable was not requested"],
    },
    {
      id: "disable",
      command: "rollback.lifecycle.disable",
      state: !settings.enabled ? "ready" : "not-requested",
      enabled: program.lifecycle.enabled && !settings.enabled && audit.status !== "running",
      idempotencyKey: `${program.job.id}:rollback:lifecycle:disable:${settings.settingsToken}`,
      blockers: audit.status === "running" ? ["rollback lifecycle cannot disable while audit is running"] : [],
    },
    {
      id: "schedule",
      command: "rollback.lifecycle.schedule",
      state: settings.schedule.valid ? "ready" : "blocked",
      enabled: settings.schedule.valid && validationErrors.length === 0,
      idempotencyKey: `${program.job.id}:rollback:lifecycle:schedule:${settings.settingsToken}`,
      blockers: settings.schedule.valid ? [] : ["rollback lifecycle schedule is invalid"],
    },
    {
      id: "accept",
      command: "rollback.accept-handoff",
      state: accepted ? "accepted" : validation.ready ? "pending" : "blocked",
      enabled: !accepted && validation.ready && settings.enabled && settings.schedule.valid,
      idempotencyKey: `${program.job.id}:rollback:lifecycle:accept:${acceptancePreview?.previewId ?? "pending"}`,
      blockers: accepted ? [] : ["rollback lifecycle awaits accepted handoff preview"],
    },
    {
      id: "run",
      command: rollbackReady ? "recovery.rollback" : validation.nextAction,
      state: rollbackReady ? "ready" : "blocked",
      enabled: rollbackReady,
      idempotencyKey: `${program.job.id}:rollback:lifecycle:run:${clientRuntimeState?.runtime?.replayToken ?? "pending"}`,
      blockers: validationErrors,
    },
  ];
  const activeRow = commandRows.find((row) => row.enabled)
    ?? commandRows.find((row) => row.state === "blocked" || row.state === "pending")
    ?? commandRows[0];
  const blockedReasons = uniqueSorted([
    ...validationErrors,
    ...commandRows.flatMap((row) => row.blockers),
  ]);

  return deepFreeze({
    kind: "mailchimp.rollback.lifecycle-controls",
    apiVersion: "aios.control/v1",
    jobId: program.job.id,
    ready: rollbackReady,
    status: rollbackReady
      ? "rollback-run-enabled"
      : accepted ? "rollback-review-required" : "rollback-awaiting-acceptance",
    nextAction: rollbackReady ? "recovery.rollback" : activeRow.command,
    activeCommand: activeRow.command,
    settings,
    controls: {
      canEnable: commandRows.find((row) => row.id === "enable").enabled,
      canDisable: commandRows.find((row) => row.id === "disable").enabled,
      canSchedule: commandRows.find((row) => row.id === "schedule").enabled,
      canAccept: commandRows.find((row) => row.id === "accept").enabled,
      canRun: commandRows.find((row) => row.id === "run").enabled,
      canPollAdapter: operationalHealth.adapterStatus === "degraded",
    },
    summary: {
      commandCount: commandRows.length,
      readyCommands: commandRows.filter((row) => row.state === "ready" || row.state === "accepted").length,
      blockedCommands: commandRows.filter((row) => row.state === "blocked").length,
      localOnlyCommands: commands.filter((command) => command.providerWrite === false).length,
      lifecycleValid: blockedReasons.length === 0,
      blockedReasons,
    },
    commandRows,
    blockedReasons,
  });
}

function normalizeRollbackLifecycleSettings(program, options) {
  const schedule = normalizeRollbackSchedule(options.rollbackSchedule ?? options.schedule ?? program.lifecycle.schedule);
  const enabled = Boolean(options.rollbackEnabled ?? options.enabled ?? program.lifecycle.enabled);
  const maxRuntimeSteps = Number(options.maxRuntimeSteps ?? program.lifecycle.maxRuntimeSteps ?? 12);
  const requireApproval = Boolean(options.requireApproval ?? program.lifecycle.requireApproval);
  const settingsToken = stableToken([
    program.job.id,
    enabled,
    schedule.mode,
    schedule.intervalSeconds,
    schedule.at,
    maxRuntimeSteps,
    requireApproval,
    options.approvalTicket,
  ]);

  return {
    enabled,
    dryRun: Boolean(options.dryRun ?? program.lifecycle.dryRun),
    requireApproval,
    approvalTicket: options.approvalTicket ? String(options.approvalTicket) : null,
    maxRuntimeSteps,
    schedule,
    settingsToken,
  };
}

function normalizeRollbackSchedule(schedule = { mode: "manual" }) {
  const mode = String(schedule?.mode ?? "manual").trim().toLowerCase();
  const intervalSeconds = schedule?.intervalSeconds == null ? null : Number(schedule.intervalSeconds);
  const at = schedule?.at == null ? null : String(schedule.at);
  const validModes = new Set(["manual", "interval", "once", "disabled"]);
  const valid = validModes.has(mode)
    && (mode !== "interval" || (Number.isFinite(intervalSeconds) && intervalSeconds >= 60))
    && (mode !== "once" || Boolean(at));

  return {
    mode: validModes.has(mode) ? mode : "invalid",
    intervalSeconds: Number.isFinite(intervalSeconds) ? intervalSeconds : null,
    at,
    valid,
  };
}

function validateRollbackLifecycleSettings(
  program,
  audit,
  validation,
  recoveryHandoff,
  commands,
  operationalHealth,
  persistedRuntimeState,
  clientRuntimeState,
  acceptancePreview,
  workflowHandoffLedger,
  analyticsExport,
  settings,
) {
  return uniqueSorted([
    ...(settings.schedule.valid ? [] : ["rollback lifecycle schedule is invalid"]),
    ...(settings.maxRuntimeSteps < program.job.plan.length
      ? [`rollback maxRuntimeSteps must cover ${program.job.plan.length} plan steps`]
      : []),
    ...(settings.requireApproval && !settings.approvalTicket
      ? ["rollback lifecycle approval ticket is required"]
      : []),
    ...(settings.enabled ? [] : ["rollback lifecycle is disabled"]),
    ...(program.lifecycle.validation.valid ? [] : program.lifecycle.validation.errors),
    ...(validation.ready ? [] : validation.blockedReasons),
    ...(recoveryHandoff?.restartToken ? [] : ["rollback lifecycle requires recovery restart token"]),
    ...(operationalHealth.runtimeEnabled ? [] : operationalHealth.blockedReasons),
    ...(persistedRuntimeState?.ready ? [] : persistedRuntimeState?.summary?.blockedReasons ?? ["rollback persisted runtime state is not ready"]),
    ...(clientRuntimeState?.runtime?.restartSafe ? [] : ["rollback client runtime is not restart-safe"]),
    ...(acceptancePreview?.validation?.valid ? [] : acceptancePreview?.validation?.blockedReasons ?? ["rollback acceptance preview is not valid"]),
    ...(workflowHandoffLedger?.ready ? [] : workflowHandoffLedger?.summary?.blockedReasons ?? ["rollback workflow ledger is not ready"]),
    ...(analyticsExport?.ready ? [] : analyticsExport?.report?.blockedReasons ?? ["rollback analytics export is not ready"]),
    ...commands
      .filter((command) => command.providerWrite)
      .map((command) => `rollback lifecycle forbids provider write: ${command.id}`),
    ...audit.boundary.externalWritesObserved.map((write) => `rollback lifecycle external write observed: ${write.target ?? write.subject ?? write}`),
  ]);
}

function buildRollbackCommands(program, audit, options) {
  const failedStep = String(options.failedStep ?? "reconcile-local-memory");

  return program.job.plan.map((step, index) => {
    const evidenceReady = !Object.keys(step.verifierHints).some((hint) => (
      audit.evidence.missing.includes(hint)
    ));
    const status = step.op === failedStep
      ? "rollback-target"
      : index < Number(options.completedSteps ?? program.job.plan.length)
        ? "completed"
        : "pending";

    return {
      id: step.op,
      stepId: step.id,
      status,
      evidenceReady,
      idempotencyKey: `${program.job.id}:rollback:${index + 1}:${step.op}`,
      snapshotKey: `${program.job.memory.namespace}:snapshot:${index + 1}:${step.op}`,
      localAction: step.op.includes("status") ? "status.timeline.append" : `${step.op}.local-only`,
      providerWrite: false,
      verifierClaims: step.verifierHints,
    };
  });
}

function validateRollbackContract(
  program,
  audit,
  exportSnapshot,
  providerContract,
  recoveryHandoff,
  commands,
  operationalHealth,
  options,
) {
  const blockedReasons = uniqueSorted([
    ...(program.lifecycle.validation.valid ? [] : program.lifecycle.validation.errors),
    ...(program.job.recovery.rollback === "snapshot" ? [] : ["rollback policy must be snapshot"]),
    ...(providerContract.handoffState.ready ? [] : providerContract.handoffState.blockedReasons),
    ...(recoveryHandoff.restartToken || options.allowMissingRestartToken
      ? []
      : ["recovery restart token required before rollback"]),
    ...(exportSnapshot.truthBoundary.readyForExport ? [] : [exportSnapshot.summary]),
    ...audit.boundary.externalWritesObserved.map((write) => `external write observed: ${write.target}`),
    ...commands
      .filter((command) => !command.evidenceReady)
      .map((command) => `rollback evidence missing: ${command.id}`),
    ...commands
      .filter((command) => command.providerWrite)
      .map((command) => `provider write forbidden: ${command.id}`),
    ...operationalHealth.blockedReasons,
  ]);

  return {
    ready: blockedReasons.length === 0,
    nextAction: blockedReasons.length === 0
      ? "recovery.rollback"
      : operationalHealth.nextAction !== "recovery.rollback"
        ? operationalHealth.nextAction
        : blockedReasons.some((reason) => reason.includes("restart token"))
          ? "recovery.resume"
          : blockedReasons.some((reason) => reason.includes("evidence"))
            ? "verifier.evidence.collect"
            : "rollback.review",
    operationalHealth,
    blockedReasons,
    checked: {
      lifecycleValid: program.lifecycle.validation.valid,
      providerReady: providerContract.handoffState.ready,
      recoveryRestartToken: Boolean(recoveryHandoff.restartToken),
      exportReady: exportSnapshot.truthBoundary.readyForExport,
      commandCount: commands.length,
      healthMode: operationalHealth.mode,
      retryAttempt: operationalHealth.retryAttempt,
    },
  };
}

export function buildRollbackAcceptancePreview(
  program = buildRollbackProgram(),
  validation = { ready: false, blockedReasons: [] },
  recoveryHandoff = {},
  commands = [],
  operationalHealth = { runtimeEnabled: false, mode: "unknown", severity: "unknown", actionableErrors: [] },
  accepted = false,
  exportSnapshot = null,
  options = {},
) {
  const tenantId = String(
    options.tenantId
      ?? program.job.tenancy?.tenantId
      ?? program.manifest?.tenantBoundary?.tenantId
      ?? "tenant-default",
  );
  const workspaceId = String(
    options.workspaceId
      ?? program.job.tenancy?.workspaceId
      ?? program.manifest?.tenantBoundary?.workspaceId
      ?? "workspace-default",
  );
  const localOnlyCommands = commands.filter((command) => command.providerWrite === false);
  const unsafeCommands = commands.filter((command) => command.providerWrite !== false);
  const missingEvidence = commands
    .filter((command) => command.evidenceReady === false)
    .map((command) => command.id);
  const recoveryRestartToken = recoveryHandoff?.restartToken
    ?? recoveryHandoff?.restart?.token
    ?? null;
  const blockedReasons = uniqueSorted([
    ...(validation.blockedReasons ?? []),
    ...(recoveryRestartToken ? [] : ["rollback acceptance requires recovery restart token"]),
    ...(operationalHealth.runtimeEnabled ? [] : ["rollback runtime health is not enabled"]),
    ...unsafeCommands.map((command) => `rollback acceptance forbids provider write: ${command.id}`),
    ...missingEvidence.map((commandId) => `rollback acceptance missing evidence: ${commandId}`),
  ]);
  const valid = blockedReasons.length === 0;
  const acceptedBy = accepted && valid ? String(options.acceptedBy ?? "operator") : null;
  const acceptedAt = accepted && valid ? String(options.acceptedAt ?? "logical:8") : null;
  const previewId = `rollback-preview:${stableToken([
    program.job.id,
    tenantId,
    workspaceId,
    exportSnapshot?.exportId,
    recoveryRestartToken,
    localOnlyCommands.map((command) => command.id).join(","),
    accepted ? "accepted" : "pending",
  ])}`;
  const auditIdempotencyKey = `${program.job.id}:rollback:acceptance-audit:${stableToken([
    previewId,
    acceptedBy,
    acceptedAt,
  ])}`;
  const primaryAction = valid
    ? accepted ? "recovery.rollback" : "rollback.accept-handoff"
    : validation.nextAction ?? operationalHealth.nextAction ?? "rollback.review";

  return deepFreeze({
    kind: "mailchimp.rollback.acceptance-preview",
    apiVersion: "aios.ui/v1",
    previewId,
    jobId: program.job.id,
    ready: valid && accepted,
    status: valid
      ? accepted ? "accepted-ready" : "awaiting-acceptance"
      : blockedReasons.some((reason) => reason.includes("provider write"))
        ? "unsafe-command-review"
        : blockedReasons.some((reason) => reason.includes("evidence"))
          ? "evidence-required"
          : "handoff-review-required",
    tenantBoundary: {
      tenantId,
      workspaceId,
      role: program.job.tenancy?.role ?? "operator",
      auditChannel: program.job.tenancy?.auditChannel ?? `${tenantId}:${workspaceId}:rollback`,
      isolationMode: program.job.tenancy?.isolationMode ?? "tenant-workspace",
    },
    client: {
      title: "Mailchimp rollback handoff",
      visibleStatus: valid
        ? accepted ? "ready to roll back" : "ready for acceptance"
        : "needs review",
      primaryAction,
      disabledReason: valid ? null : blockedReasons[0] ?? null,
      localOnlyCommands: localOnlyCommands.length,
      blockedCommands: commands.length - localOnlyCommands.length + missingEvidence.length,
      healthMode: operationalHealth.mode,
      healthSeverity: operationalHealth.severity,
    },
    acceptance: {
      required: true,
      accepted: accepted && valid,
      acceptedBy,
      acceptedAt,
      command: "rollback.accept-handoff",
      idempotencyKey: `${program.job.id}:rollback:accept:${exportSnapshot?.exportId ?? "pending"}`,
    },
    handoff: {
      readyForVerifierClaim: valid && accepted,
      verifierClaimReference: valid && accepted ? stableToken([
        program.job.id,
        previewId,
        recoveryRestartToken,
        exportSnapshot?.exportId,
      ]) : null,
      recoveryRestartToken,
      rollbackJournal: `${program.job.memory.namespace}:rollback-journal:${exportSnapshot?.exportId ?? "pending"}`,
      audit: {
        command: "audit.rollback.acceptance-record",
        idempotencyKey: auditIdempotencyKey,
        subject: `${tenantId}/${workspaceId}/${program.job.id}`,
        exportId: exportSnapshot?.exportId ?? null,
      },
    },
    validation: {
      valid,
      blockedReasons,
      summary: valid
        ? `${localOnlyCommands.length} local-only rollback command(s) can be accepted.`
        : `Rollback acceptance blocked by ${blockedReasons.length} issue(s).`,
      checked: {
        recoveryRestartTokenPresent: Boolean(recoveryRestartToken),
        runtimeHealthEnabled: Boolean(operationalHealth.runtimeEnabled),
        commandCount: commands.length,
        localOnlyCommands: localOnlyCommands.length,
        unsafeCommands: unsafeCommands.length,
        missingEvidence: missingEvidence.length,
      },
    },
    nextSteps: valid
      ? [{
        action: primaryAction,
        label: accepted ? "Run rollback" : "Accept rollback handoff",
        reason: accepted
          ? "accepted rollback preview is bound to a restart token"
          : "rollback preview is valid and awaiting operator acceptance",
        state: accepted ? "ready" : "pending",
        idempotencyKey: accepted
          ? `${program.job.id}:rollback:run:${exportSnapshot?.exportId ?? "pending"}`
          : `${program.job.id}:rollback:accept:${exportSnapshot?.exportId ?? "pending"}`,
      }]
      : blockedReasons.map((reason) => ({
        action: validation.nextAction ?? operationalHealth.nextAction ?? "rollback.review",
        label: "Resolve rollback preview",
        reason,
        state: "blocked",
        idempotencyKey: `rollback:preview:${stableToken([previewId, reason])}`,
      })),
  });
}

export function buildRollbackOperationalHealth(
  program = buildRollbackProgram(),
  audit = null,
  recoveryHandoff = {},
  commands = [],
  options = {},
) {
  const rawAdapterStatus = String(
    options.adapterStatus
      ?? recoveryHandoff?.adapter?.status
      ?? recoveryHandoff?.adapter?.handoff
      ?? "healthy",
  ).trim().toLowerCase();
  const adapterStatus = rawAdapterStatus === "available"
    ? "healthy"
    : rawAdapterStatus === "deferred"
      ? "degraded"
      : rawAdapterStatus === "blocked" ? "offline" : rawAdapterStatus;
  const retryAttempt = Math.max(0, Number(options.retryAttempt ?? 0));
  const maxRetries = Math.max(0, Number(options.maxRetries ?? program.job.recovery.retry ?? 1));
  const retryAfterSeconds = adapterStatus === "degraded"
    ? Math.max(5, Number(options.retryAfterSeconds ?? recoveryHandoff?.adapter?.retryAfterSeconds ?? 45))
    : null;
  const missingEvidence = audit?.evidence?.missing ?? [];
  const commandBlockers = commands.flatMap((command) => [
    ...(command.evidenceReady ? [] : [`rollback command lacks evidence: ${command.id}`]),
    ...(command.providerWrite ? [`rollback command attempts provider write: ${command.id}`] : []),
  ]);
  const blockedReasons = uniqueSorted([
    ...(adapterStatus === "offline" ? ["rollback adapter is offline"] : []),
    ...(retryAttempt > maxRetries ? [`rollback retry budget exhausted: ${retryAttempt}/${maxRetries}`] : []),
    ...missingEvidence.map((subject) => `rollback evidence missing: ${subject}`),
    ...commandBlockers,
  ]);
  const degraded = adapterStatus === "degraded" || retryAttempt > 0;
  const runtimeEnabled = blockedReasons.length === 0 && adapterStatus !== "offline";
  const mode = runtimeEnabled
    ? degraded ? "degraded-retry" : "normal"
    : adapterStatus === "offline" ? "offline" : "blocked";
  const severity = blockedReasons.length > 0
    ? adapterStatus === "offline" || retryAttempt > maxRetries ? "critical" : "error"
    : degraded ? "warning" : "ok";
  const nextAction = adapterStatus === "offline"
    ? "adapter.status.poll"
    : retryAttempt > maxRetries
      ? "rollback.retry-budget.review"
      : missingEvidence.length > 0
        ? "verifier.evidence.collect"
        : runtimeEnabled ? "recovery.rollback" : "rollback.review";

  return deepFreeze({
    kind: "mailchimp.rollback.operational-health",
    apiVersion: "aios.health/v1",
    jobId: program.job.id,
    mode,
    severity,
    degraded,
    adapterStatus,
    retryAttempt,
    maxRetries,
    retryAfterSeconds,
    runtimeEnabled,
    nextAction,
    blockedReasons,
    actionableErrors: blockedReasons.map((reason) => ({
      reason,
      action: reason.includes("evidence")
        ? "verifier.evidence.collect"
        : reason.includes("retry budget")
          ? "rollback.retry-budget.review"
          : reason.includes("offline")
            ? "adapter.status.poll"
            : "rollback.review",
      idempotencyKey: `${program.job.id}:rollback:health:${stableToken([reason, retryAttempt, maxRetries])}`,
    })),
  });
}

function buildRollbackNextSteps(contract) {
  if (contract.validation.blockedReasons.length > 0) {
    return contract.clientRuntimeState.actions;
  }
  if (!contract.acceptance.accepted) {
    return [{
      action: "rollback.accept-handoff",
      label: "Accept rollback handoff",
      reason: "snapshot rollback is local-only and ready for adapter handoff",
      idempotencyKey: contract.clientRuntimeState.acceptance.idempotencyKey,
    }];
  }
  return [{
    action: contract.runtimeCommand,
    label: "Run rollback",
    reason: "accepted rollback contract has a deterministic rollback token",
    idempotencyKey: contract.clientRuntimeState.runtime.idempotencyKey,
  }];
}

function buildRollbackClientActions(validation, accepted, runtimeEnabled, snapshot) {
  if (validation.blockedReasons.length > 0) {
    return validation.blockedReasons.map((reason) => ({
      action: validation.nextAction,
      label: "Resolve rollback handoff",
      reason,
      state: "blocked",
      idempotencyKey: `rollback:resolve:${stableToken([reason, snapshot?.exportId])}`,
    }));
  }
  if (!accepted) {
    return [{
      action: "rollback.accept-handoff",
      label: "Accept rollback handoff",
      reason: "acceptance records that local-only rollback can be handed to the adapter",
      state: "pending",
      idempotencyKey: `rollback:accept:${snapshot?.exportId ?? "pending"}`,
    }];
  }
  return [{
    action: "recovery.rollback",
    label: "Run rollback",
    reason: runtimeEnabled
      ? "all rollback commands are restart-safe and local-only"
      : "rollback runtime is waiting for validation",
    state: runtimeEnabled ? "ready" : "pending",
    idempotencyKey: `rollback:run:${snapshot?.exportId ?? "pending"}`,
  }];
}

function buildRollbackReplayGuard(
  program,
  validation,
  recoverySource,
  rows,
  operationalHealth,
  snapshot,
  ready,
) {
  const restartToken = recoverySource?.restartToken ?? recoverySource?.restart?.token ?? null;
  const snapshotId = snapshot?.exportId ?? "pending";
  const guardKey = `${program.job.id}:rollback:replay-guard:${snapshotId}`;
  const blockedReasons = uniqueSorted([
    ...(validation.blockedReasons ?? []),
    ...(restartToken ? [] : ["rollback replay requires recovery restart token"]),
    ...(operationalHealth?.runtimeEnabled ? [] : ["rollback runtime health is not enabled"]),
    ...rows
      .filter((row) => row.providerWrite)
      .map((row) => `rollback replay forbids provider write: ${row.id}`),
    ...rows
      .filter((row) => row.evidenceReady === false)
      .map((row) => `rollback replay missing evidence: ${row.id}`),
  ]);
  const replayRows = rows.map((row, index) => {
    const rowBlockedReasons = uniqueSorted([
      row.providerWrite ? "provider-write-forbidden" : "",
      row.evidenceReady === false ? "evidence-missing" : "",
      row.replaySafe === false ? "not-replay-safe" : "",
      restartToken ? "" : "restart-token-missing",
    ]);
    const applied = row.currentStatus === "applied" || row.currentStatus === "rolled-back";
    const replayable = rowBlockedReasons.length === 0 && ready && !applied;

    return {
      id: row.id,
      index: index + 1,
      command: row.replayCommand,
      desiredStatus: row.desiredStatus,
      currentStatus: applied ? "applied" : replayable ? "pending-replay" : "blocked",
      idempotencyKey: `${guardKey}:${index + 1}:${row.id}`,
      sourceIdempotencyKey: row.idempotencyKey,
      journalEntryKey: row.journalEntryKey,
      receipt: row.receipt,
      resumeCursor: row.resumeCursor,
      replaySafe: replayable || applied,
      blockedReasons: rowBlockedReasons,
    };
  });
  const replayableCommands = replayRows.filter((row) => row.currentStatus === "pending-replay").length;
  const appliedCommands = replayRows.filter((row) => row.currentStatus === "applied").length;
  const blockedCommands = replayRows.filter((row) => row.currentStatus === "blocked").length;
  const restartSafe = blockedReasons.length === 0
    && replayRows.every((row) => row.replaySafe)
    && Boolean(restartToken);

  return {
    kind: "mailchimp.rollback.replay-guard",
    apiVersion: "aios.state/v1",
    guardKey,
    restartSafe,
    status: blockedReasons.length
      ? "replay-blocked"
      : blockedCommands > 0
        ? "replay-review"
        : replayableCommands > 0
          ? "replay-ready"
          : "replay-complete",
    replayToken: restartSafe ? stableToken([
      guardKey,
      restartToken,
      replayRows.map((row) => `${row.id}:${row.currentStatus}:${row.receipt ?? ""}`).join(","),
    ]) : null,
    recoverySource: {
      jobId: recoverySource?.jobId ?? null,
      statusEvent: recoverySource?.statusEvent ?? null,
      restartToken,
    },
    summary: {
      appliedCommands,
      replayableCommands,
      blockedCommands,
      totalCommands: replayRows.length,
      blockedReasons,
    },
    rows: replayRows,
  };
}

function buildRollbackWorkflowHandoffLedger(
  program,
  validation,
  recoveryHandoff,
  commands,
  operationalHealth,
  persistedRuntimeState,
  clientRuntimeState,
  acceptancePreview,
  exportSnapshot,
) {
  const checkpoint = exportSnapshot?.exportId ?? "pending";
  const restartToken = recoveryHandoff?.restartToken ?? recoveryHandoff?.restart?.token ?? null;
  const accepted = Boolean(acceptancePreview?.acceptance?.accepted);
  const rows = [
    {
      phase: "recovery",
      status: restartToken ? "ready" : "blocked",
      command: restartToken ? "recovery.resume" : "recovery.status-review",
      receipt: restartToken,
      clientVisible: true,
      adapterVisible: true,
      blockedReasons: restartToken ? [] : ["rollback workflow ledger requires recovery restart token"],
    },
    {
      phase: "health",
      status: operationalHealth.runtimeEnabled ? "ready" : "blocked",
      command: operationalHealth.runtimeEnabled
        ? "rollback.health.accept"
        : operationalHealth.nextAction ?? "rollback.health-review",
      receipt: operationalHealth.mode,
      clientVisible: true,
      adapterVisible: false,
      blockedReasons: operationalHealth.runtimeEnabled ? [] : operationalHealth.blockedReasons,
    },
    {
      phase: "acceptance",
      status: accepted ? "ready" : "pending",
      command: accepted ? "rollback.acceptance.recorded" : "rollback.accept-handoff",
      receipt: acceptancePreview?.previewId ?? null,
      clientVisible: true,
      adapterVisible: false,
      blockedReasons: accepted ? [] : ["rollback workflow ledger awaits accepted handoff preview"],
    },
    {
      phase: "persisted-state",
      status: persistedRuntimeState.ready ? "ready" : "blocked",
      command: persistedRuntimeState.restart.command,
      receipt: persistedRuntimeState.restart.token,
      clientVisible: false,
      adapterVisible: true,
      blockedReasons: persistedRuntimeState.ready ? [] : persistedRuntimeState.summary.blockedReasons,
    },
    {
      phase: "client-runtime",
      status: clientRuntimeState.ready ? "ready" : "blocked",
      command: clientRuntimeState.runtime.command,
      receipt: clientRuntimeState.runtime.replayToken,
      clientVisible: true,
      adapterVisible: true,
      blockedReasons: clientRuntimeState.ready ? [] : clientRuntimeState.summary.blockedReasons,
    },
  ].map((row, index) => ({
    ...row,
    index,
    idempotencyKey: `${program.job.id}:rollback:workflow:${checkpoint}:${index + 1}:${row.phase}`,
  }));
  const commandRows = commands.map((command, index) => {
    const persistedRow = persistedRuntimeState.rows.find((row) => row.id === command.id);
    const blockedReasons = uniqueSorted([
      ...(command.evidenceReady ? [] : [`rollback command evidence missing: ${command.id}`]),
      ...(command.providerWrite ? [`rollback command would write provider: ${command.id}`] : []),
      ...(persistedRow?.replaySafe ? [] : [`rollback command not replay-safe: ${command.id}`]),
    ]);
    return {
      phase: "command",
      index: rows.length + index,
      commandId: command.id,
      stepId: command.stepId,
      status: blockedReasons.length === 0 ? persistedRow?.currentStatus ?? "ready" : "blocked",
      command: blockedReasons.length === 0 ? command.localAction : "rollback.command-review",
      receipt: persistedRow?.receipt ?? null,
      clientVisible: true,
      adapterVisible: true,
      idempotencyKey: `${program.job.id}:rollback:workflow:${checkpoint}:command:${index + 1}:${command.id}`,
      blockedReasons,
    };
  });
  const allRows = [...rows, ...commandRows];
  const blockedReasons = uniqueSorted([
    ...(validation.blockedReasons ?? []),
    ...allRows.flatMap((row) => row.blockedReasons),
  ]);
  const ready = blockedReasons.length === 0 && accepted && clientRuntimeState.ready;

  return deepFreeze({
    kind: "mailchimp.rollback.workflow-handoff-ledger",
    apiVersion: "aios.workflow/v1",
    ledgerId: `rollback-workflow:${stableToken([
      program.job.id,
      checkpoint,
      restartToken,
      acceptancePreview?.previewId,
      allRows.map((row) => `${row.phase}:${row.status}`).join(","),
    ])}`,
    jobId: program.job.id,
    checkpoint,
    ready,
    status: ready
      ? "workflow-ready"
      : accepted ? "workflow-review-required" : "workflow-awaiting-acceptance",
    primaryAction: ready ? "recovery.rollback" : clientRuntimeState.actions[0]?.action ?? validation.nextAction,
    restart: {
      restartToken,
      persistedRestartToken: persistedRuntimeState.restart.token,
      replayToken: clientRuntimeState.runtime.replayToken,
      restartSafe: clientRuntimeState.runtime.restartSafe,
    },
    visibility: {
      clientRows: allRows.filter((row) => row.clientVisible).length,
      adapterRows: allRows.filter((row) => row.adapterVisible).length,
    },
    summary: {
      totalRows: allRows.length,
      readyRows: allRows.filter((row) => row.status === "ready" || row.status === "applied").length,
      blockedRows: allRows.filter((row) => row.status === "blocked").length,
      pendingRows: allRows.filter((row) => row.status === "pending").length,
      blockedReasons,
    },
    rows: allRows,
  });
}

function buildRollbackAnalyticsExport(
  program,
  audit,
  exportSnapshot,
  recoveryHandoff,
  commands,
  operationalHealth,
  validation,
  persistedRuntimeState,
  clientRuntimeState,
  acceptancePreview,
  workflowHandoffLedger,
  options,
) {
  const generatedAt = String(options.analyticsGeneratedAt ?? options.generatedAt ?? "logical:9");
  const previous = normalizeRollbackAnalyticsExport(options.previousAnalyticsExport);
  const checkpoint = exportSnapshot?.exportId ?? "pending";
  const acceptedEvidence = audit.evidence.accepted ?? [];
  const missingEvidence = audit.evidence.missing ?? [];
  const timeline = [
    ...audit.timeline.map((event, index) => ({
      source: "audit",
      index,
      at: event.at,
      event: event.status,
      status: event.status,
      message: event.message,
      command: index === audit.timeline.length - 1 ? clientRuntimeState.runtime.command : null,
      blockedCount: index === audit.timeline.length - 1 ? validation.blockedReasons.length : 0,
    })),
    ...workflowHandoffLedger.rows.map((row, index) => ({
      source: "workflow-ledger",
      index: audit.timeline.length + index,
      at: generatedAt,
      event: `rollback.${row.phase}`,
      status: row.status,
      message: row.blockedReasons[0] ?? row.command,
      command: row.command,
      blockedCount: row.blockedReasons.length,
    })),
  ];
  const commandRows = commands.map((command) => {
    const persistedRow = persistedRuntimeState.rows.find((row) => row.id === command.id);
    const clientRow = clientRuntimeState.commands.find((row) => row.id === command.id);
    return {
      id: command.id,
      stepId: command.stepId,
      status: persistedRow?.currentStatus ?? command.status,
      clientState: clientRow?.state ?? "unknown",
      localAction: command.localAction,
      providerWrite: command.providerWrite,
      evidenceReady: command.evidenceReady,
      replaySafe: Boolean(persistedRow?.replaySafe),
      idempotencyKey: persistedRow?.idempotencyKey ?? command.idempotencyKey,
      journalEntryKey: persistedRow?.journalEntryKey ?? null,
      receipt: persistedRow?.receipt ?? null,
      blockedReasons: uniqueSorted([
        ...(command.evidenceReady ? [] : [`rollback analytics evidence missing: ${command.id}`]),
        ...(command.providerWrite ? [`rollback analytics provider write forbidden: ${command.id}`] : []),
        ...(persistedRow?.replaySafe ? [] : [`rollback analytics replay guard blocked: ${command.id}`]),
      ]),
    };
  });
  const historySnapshots = [
    ...(options.history ?? []).map((entry, index) => ({
      index,
      at: String(entry.at ?? `history:${index}`),
      status: String(entry.status ?? entry.label ?? "unknown"),
      exportId: entry.exportId ? String(entry.exportId) : null,
      ready: Boolean(entry.ready ?? false),
      replayableCommands: Number(entry.replayableCommands ?? 0),
      blockedReasons: uniqueSorted(entry.blockedReasons ?? []),
    })),
    {
      index: (options.history ?? []).length,
      at: generatedAt,
      status: clientRuntimeState.ready ? "ready" : clientRuntimeState.statusBadge,
      exportId: checkpoint,
      ready: clientRuntimeState.ready,
      replayableCommands: persistedRuntimeState.summary.replayableCommands,
      blockedReasons: validation.blockedReasons,
    },
  ].slice(-12);
  const counters = {
    totalCommands: commandRows.length,
    localOnlyCommands: commandRows.filter((row) => row.providerWrite === false).length,
    replaySafeCommands: commandRows.filter((row) => row.replaySafe).length,
    replayableCommands: persistedRuntimeState.summary.replayableCommands,
    appliedCommands: persistedRuntimeState.summary.appliedCommands,
    blockedCommands: commandRows.filter((row) => row.blockedReasons.length > 0).length,
    acceptedEvidence: acceptedEvidence.length,
    missingEvidence: missingEvidence.length,
    externalWriteViolations: audit.boundary.externalWritesObserved.length,
    workflowRows: workflowHandoffLedger.summary.totalRows,
    workflowBlockedRows: workflowHandoffLedger.summary.blockedRows,
    timelineEvents: timeline.length,
    historySnapshots: historySnapshots.length,
  };
  const blockedReasons = uniqueSorted([
    ...(validation.blockedReasons ?? []),
    ...commandRows.flatMap((row) => row.blockedReasons),
    ...(workflowHandoffLedger.ready ? [] : workflowHandoffLedger.summary.blockedReasons),
    ...(clientRuntimeState.runtime.restartSafe ? [] : ["rollback analytics export requires restart-safe client runtime"]),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["rollback analytics export cannot advance after external write observation"]),
  ]);
  const ready = blockedReasons.length === 0;
  const fingerprint = stableToken([
    program.job.id,
    checkpoint,
    recoveryHandoff?.restartToken,
    persistedRuntimeState.restart.token,
    clientRuntimeState.runtime.replayToken,
    workflowHandoffLedger.ledgerId,
    commandRows.map((row) => `${row.id}:${row.status}:${row.replaySafe}`).join(","),
  ]);
  const exportId = `rollback-analytics:${fingerprint}`;

  return deepFreeze({
    kind: "mailchimp.rollback.analytics-export",
    apiVersion: "aios.analytics/v1",
    jobId: program.job.id,
    exportId,
    generatedAt,
    checkpoint,
    ready,
    previous: previous
      ? {
        exportId: previous.exportId,
        status: previous.status,
        changedSincePrevious: previous.fingerprint !== fingerprint,
      }
      : null,
    counters,
    timeline,
    historySnapshots,
    commandRows,
    report: {
      status: ready ? "export-ready" : "export-blocked",
      nextAction: ready ? clientRuntimeState.runtime.command : validation.nextAction,
      rollbackToken: ready ? clientRuntimeState.runtime.replayToken : null,
      recoveryRestartTokenPresent: Boolean(recoveryHandoff?.restartToken),
      acceptanceStatus: acceptancePreview.status,
      workflowLedgerId: workflowHandoffLedger.ledgerId,
      workflowStatus: workflowHandoffLedger.status,
      auditExportId: checkpoint,
      blockedReasons,
    },
    validation: {
      ready,
      externalWriteSafe: audit.boundary.externalWritesObserved.length === 0,
      restartSafe: clientRuntimeState.runtime.restartSafe,
      workflowReady: workflowHandoffLedger.ready,
      checkpointConsistent: persistedRuntimeState.journalKey.includes(checkpoint),
      blockedReasons,
    },
  });
}

function normalizeRollbackAnalyticsExport(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    exportId: value.exportId ? String(value.exportId) : null,
    status: value.report?.status ? String(value.report.status) : String(value.status ?? "unknown"),
    fingerprint: String(value.exportId ?? value.fingerprint ?? ""),
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function stableToken(parts) {
  const input = parts.map((part) => String(part ?? "")).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `rbk_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}
