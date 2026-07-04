import {
  createAuditExportSnapshot,
  createEvidence,
  createProviderSyncEvidence,
  createStatusEvent,
  createTruthBoundaryReport,
} from "../stdlib/audit.mjs";
import {
  buildPackageReadinessPreview,
  buildProviderServiceContract,
  compilePackageSource,
} from "../stdlib/packages.mjs";

export const recoveryJobSource = `# deterministic Mailchimp recovery status handoff
use mailchimp:campaign.read
use mailchimp:report.read
use memory:campaign.local
use verifier:evidence.record
use status:timeline.write
recover rollback=snapshot retry=3
step recover-provider-cursor input=syncCursor output=providerCursor verify.status=cursor-safe
step replay-campaign-read input=providerCursor output=campaign verify.source=mailchimp
step replay-report-read input=campaign.id output=report verify.source=mailchimp
step reconcile-local-memory input=report output=memoryClaim verify.boundary=local-only
step publish-recovery-status input=memoryClaim output=statusEvent verify.status=adapter-handoff
`;

const REQUIRED_RECOVERY_CAPABILITIES = Object.freeze([
  "mailchimp:campaign.read",
  "mailchimp:report.read",
  "status:timeline.write",
]);

const REQUIRED_RECOVERY_PERMISSIONS = Object.freeze([
  "campaign:read",
  "report:read",
  "memory:write-local",
  "recovery:resume",
  "status:handoff",
]);

export function buildRecoveryProgram(options = {}) {
  return compilePackageSource(recoveryJobSource, {
    name: options.name ?? "mailchimp-recovery-job",
    version: options.version ?? "0.1.0",
    description: "Compile a Mailchimp provider recovery job with local-only replay and adapter status handoff.",
    capabilities: options.capabilities ?? [],
    exports: {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      providerContract: "./stdlib/packages.mjs#buildProviderServiceContract",
      operationalHealth: "./examples/recovery-job.mjs#buildRecoveryOperationalHealth",
      recoveryHandoff: "./examples/recovery-job.mjs#buildRecoveryStatusHandoffContract",
      recoveryPersistedState: "./examples/recovery-job.mjs#buildRecoveryPersistedHandoffState",
      recoveryAnalyticsSummary: "./examples/recovery-job.mjs#buildRecoveryAnalyticsSummary",
      describe: "./examples/recovery-job.mjs#describeRecoveryJob",
    },
  }, {
    name: "mailchimp-recovery-job",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: options.dryRun ?? true,
      requireApproval: options.requireApproval ?? true,
      approvalTicket: options.approvalTicket,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 18,
    },
  });
}

export function buildRecoveryAudit(program = buildRecoveryProgram(), options = {}) {
  const missing = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missing.has(subject))
    .map((subject) => createEvidence(
      subject.startsWith("verify.source") ? "mailchimp-read-receipt" : "runtime-local-receipt",
      subject,
      {
        surface: "recovery-job",
        adapter: program.job.runtimeAdapter,
        replay: true,
      },
    ));

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "completed",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "recovery job queued" }),
      createStatusEvent("running", { at: "logical:1", message: "provider cursor replay started" }),
      createStatusEvent("verifying", { at: "logical:2", message: "local memory reconciliation checked" }),
      createStatusEvent(options.status ?? "completed", {
        at: "logical:3",
        message: "recovery status handoff evaluated",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildRecoveryStatusHandoffContract(
  program = buildRecoveryProgram(),
  audit = buildRecoveryAudit(program),
  options = {},
) {
  const exportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:4",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const providerContract = buildProviderServiceContract(program, {
    externalApproval: options.approvalTicket,
    providerResource: options.providerResource ?? "campaign-report-recovery",
    supportedCapabilities: options.supportedCapabilities,
    syncCursor: options.syncCursor,
    checkpoint: exportSnapshot.exportId,
  });
  const adapter = normalizeAdapterStatus(options.adapterStatus, options.adapterRetryAfterSeconds);
  const checkpoints = buildRecoveryCheckpoints(program, audit, options.completedSteps);
  const workspaceBoundary = buildRecoveryWorkspaceBoundary(program, providerContract, options);
  const operationalHealth = buildRecoveryOperationalHealth(
    program,
    audit,
    providerContract,
    adapter,
    checkpoints,
    workspaceBoundary,
    options,
  );
  const validation = validateRecoveryHandoff(
    program,
    audit,
    exportSnapshot,
    providerContract,
    adapter,
    checkpoints,
    workspaceBoundary,
    operationalHealth,
  );
  const accepted = Boolean(options.accepted ?? false);
  const ready = validation.ready && accepted;
  const providerSyncEvidence = createProviderSyncEvidence(audit, providerContract, {
    generatedAt: options.syncEvidenceAt ?? "logical:5",
  });
  const clientState = buildRecoveryClientHandoffState(
    program,
    validation,
    adapter,
    operationalHealth,
    checkpoints,
    accepted,
    providerSyncEvidence,
    workspaceBoundary,
  );
  const persistedHandoffState = buildRecoveryPersistedHandoffState(
    program,
    validation,
    adapter,
    operationalHealth,
    checkpoints,
    accepted,
    providerSyncEvidence,
    exportSnapshot,
    workspaceBoundary,
    options,
  );
  const runtimeAdoption = buildRecoveryRuntimeAdoptionState(
    program,
    validation,
    clientState,
    persistedHandoffState,
    adapter,
    operationalHealth,
    checkpoints,
    accepted,
    providerSyncEvidence,
    options,
  );
  const operatorHandoffPacket = buildRecoveryOperatorHandoffPacket(
    program,
    validation,
    clientState,
    persistedHandoffState,
    runtimeAdoption,
    adapter,
    operationalHealth,
    checkpoints,
    accepted,
    providerSyncEvidence,
    workspaceBoundary,
    options,
  );
  const analyticsSummary = buildRecoveryAnalyticsSummary(
    program,
    audit,
    exportSnapshot,
    providerContract,
    adapter,
    checkpoints,
    workspaceBoundary,
    operationalHealth,
    validation,
    clientState,
    persistedHandoffState,
    runtimeAdoption,
    operatorHandoffPacket,
    providerSyncEvidence,
    options,
  );

  return deepFreeze({
    kind: "mailchimp.recovery.status-handoff",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready,
    statusEvent: ready ? "completed" : "verifying",
    runtimeCommand: ready ? "recovery.resume" : validation.nextAction,
    restartToken: ready ? stableToken([
      program.job.id,
      providerContract.handoffState.handoffToken,
      adapter.status,
      checkpoints.filter((checkpoint) => checkpoint.complete).length,
    ]) : null,
    provider: providerContract.provider,
    sync: {
      ...providerContract.sync,
      externalHandoff: ready ? "adapter-status" : "none",
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
    },
    adapter,
    operationalHealth,
    workspaceBoundary,
    checkpoints,
    truthBoundary: {
      exportReady: exportSnapshot.truthBoundary.readyForExport,
      externalWritesAllowed: false,
      memoryWritePolicy: program.job.memory.writePolicy,
      missingEvidence: audit.evidence.missing,
    },
    acceptance: {
      accepted,
      acceptedBy: accepted ? String(options.acceptedBy ?? "operator") : null,
      acceptedAt: accepted ? String(options.acceptedAt ?? "logical:6") : null,
    },
    validation,
    clientState,
    persistedHandoffState,
    runtimeAdoption,
    operatorHandoffPacket,
    analyticsSummary,
    providerSyncEvidence,
    exportSnapshot,
  });
}

export function buildRecoveryPersistedHandoffState(
  program = buildRecoveryProgram(),
  validationOrHandoff = buildRecoveryStatusHandoffContract(program),
  adapter,
  operationalHealth,
  checkpoints,
  accepted,
  providerSyncEvidence,
  exportSnapshot,
  workspaceBoundary,
  options = {},
) {
  const handoffMode = validationOrHandoff.kind === "mailchimp.recovery.status-handoff";
  const legacySignature = Array.isArray(operationalHealth);
  const shiftedHealth = legacySignature ? null : operationalHealth;
  const shiftedCheckpoints = legacySignature ? operationalHealth : checkpoints;
  const shiftedAccepted = legacySignature ? checkpoints : accepted;
  const shiftedSyncEvidence = legacySignature ? accepted : providerSyncEvidence;
  const shiftedSnapshot = legacySignature ? providerSyncEvidence : exportSnapshot;
  const shiftedBoundary = legacySignature ? exportSnapshot : workspaceBoundary;
  const shiftedOptions = legacySignature ? workspaceBoundary ?? {} : options;
  const validation = handoffMode ? validationOrHandoff.validation : validationOrHandoff;
  const sourceAdapter = handoffMode ? validationOrHandoff.adapter : adapter;
  const sourceCheckpoints = handoffMode ? validationOrHandoff.checkpoints : shiftedCheckpoints;
  const sourceHealth = handoffMode
    ? validationOrHandoff.operationalHealth
    : shiftedHealth ?? validation.operationalHealth ?? buildRecoveryOperationalHealth(
      program,
      null,
      null,
      sourceAdapter ?? normalizeAdapterStatus(),
      sourceCheckpoints ?? [],
      null,
      shiftedOptions,
    );
  const isAccepted = handoffMode ? validationOrHandoff.acceptance.accepted : Boolean(shiftedAccepted);
  const syncEvidence = handoffMode ? validationOrHandoff.providerSyncEvidence : shiftedSyncEvidence;
  const snapshot = handoffMode ? validationOrHandoff.exportSnapshot : shiftedSnapshot;
  const optionsMode = shiftedBoundary
    && shiftedBoundary.kind !== "mailchimp.recovery.workspace-boundary"
    && !shiftedBoundary.scopeKey;
  const boundary = handoffMode
    ? validationOrHandoff.workspaceBoundary
    : shiftedBoundary?.kind === "mailchimp.recovery.workspace-boundary"
      ? shiftedBoundary
      : buildRecoveryWorkspaceBoundary(program, null, optionsMode ? shiftedBoundary : shiftedOptions);
  const stateOptions = handoffMode ? adapter ?? {} : optionsMode ? shiftedBoundary : shiftedOptions;
  const receiptMap = buildRecoveryReceiptMap(stateOptions.priorRecoveryReceipts);
  const stateKey = `${program.job.memory.namespace}:recovery-handoff:${snapshot?.exportId ?? "pending"}`;
  const blockedReasons = validation.blockedReasons;
  const releaseReady = blockedReasons.length === 0 && isAccepted && sourceHealth.runtimeEnabled;
  const rows = sourceCheckpoints.map((checkpoint, index) => {
    const prior = receiptMap.get(checkpoint.key)
      ?? receiptMap.get(checkpoint.stepId)
      ?? receiptMap.get(checkpoint.command)
      ?? null;
    const replayState = prior?.state
      ?? (checkpoint.complete && checkpoint.evidenceReady
        ? "ready-to-replay"
        : checkpoint.evidenceReady ? "waiting-for-checkpoint" : "blocked");
    const replayAllowed = releaseReady && checkpoint.complete && checkpoint.evidenceReady;
    const rowHash = stableToken([
      stateKey,
      checkpoint.key,
      checkpoint.resumeCursor,
      syncEvidence?.receipt,
    ]);

    return {
      id: checkpoint.stepId,
      checkpointKey: checkpoint.key,
      command: checkpoint.command,
      state: replayState,
      complete: checkpoint.complete,
      evidenceReady: checkpoint.evidenceReady,
      replayAllowed,
      receipt: prior?.receipt ?? null,
      persistedKey: `${stateKey}:checkpoint:${index + 1}:${rowHash}`,
      idempotencyKey: `${program.job.id}:recovery:checkpoint:${index + 1}:${rowHash}`,
      resumeCursor: checkpoint.resumeCursor,
      verifierClaimCount: Object.keys(checkpoint.verifierClaims).length,
      restartCommand: replayAllowed ? checkpoint.command : validation.nextAction,
      blockers: uniqueSorted([
        ...(checkpoint.complete ? [] : [`checkpoint incomplete: ${checkpoint.command}`]),
        ...(checkpoint.evidenceReady ? [] : [`checkpoint evidence missing: ${checkpoint.command}`]),
        ...(blockedReasons.length === 0 ? [] : blockedReasons),
        ...(sourceHealth.runtimeEnabled ? [] : sourceHealth.blockedReasons),
        ...(isAccepted ? [] : ["operator recovery acceptance is pending"]),
      ]),
    };
  });
  const readyRows = rows.filter((row) => row.replayAllowed);
  const appliedRows = rows.filter((row) => row.state === "applied" || row.state === "resumed");
  const rowBlockers = uniqueSorted(rows.flatMap((row) => row.blockers));
  const restartSafe = releaseReady && rowBlockers.length === 0 && readyRows.length === rows.length;
  const resumeToken = restartSafe ? stableToken([
    program.job.id,
    stateKey,
    syncEvidence?.receipt,
    rows.map((row) => `${row.id}:${row.state}`).join(","),
  ]) : null;

  return deepFreeze({
    kind: "mailchimp.recovery.persisted-handoff-state",
    apiVersion: "aios.state/v1",
    jobId: program.job.id,
    stateKey,
    persistedAt: String(stateOptions.persistedAt ?? "logical:6"),
    ready: restartSafe,
    status: restartSafe
      ? appliedRows.length === rows.length ? "recovery-resume-complete" : "recovery-resume-ready"
      : rowBlockers.length > 0 ? "recovery-resume-blocked" : "recovery-resume-waiting",
    restart: {
      command: restartSafe ? "recovery.resume" : validation.nextAction,
      enabled: restartSafe,
      token: resumeToken,
      idempotencyKey: `${program.job.id}:recovery:restart:${snapshot?.exportId ?? "pending"}`,
    },
    adapter: {
      name: sourceAdapter.name,
      status: sourceAdapter.status,
      handoff: sourceAdapter.handoff,
      retryAfterSeconds: sourceAdapter.retryAfterSeconds,
    },
    operationalHealth: {
      mode: sourceHealth.mode,
      severity: sourceHealth.severity,
      degraded: sourceHealth.degraded,
      retryAttempt: sourceHealth.retryAttempt,
      maxRetries: sourceHealth.maxRetries,
      retryAfterSeconds: sourceHealth.retryAfterSeconds,
      runtimeEnabled: sourceHealth.runtimeEnabled,
      nextAction: sourceHealth.nextAction,
      failureState: sourceHealth.failureState,
      actionableErrors: sourceHealth.actionableErrors,
    },
    acceptance: {
      required: true,
      accepted: isAccepted,
      command: "recovery.accept-handoff",
      idempotencyKey: `${program.job.id}:recovery:persisted-accept:${syncEvidence?.receipt ?? "pending"}`,
    },
    evidence: {
      exportId: snapshot?.exportId ?? null,
      providerSyncReceipt: syncEvidence?.receipt ?? null,
      providerSyncReady: syncEvidence?.readiness?.ready ?? false,
      auditHandoff: boundary.auditHandoff,
    },
    tenant: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      scopeKey: boundary.scopeKey,
      role: boundary.role,
      permissions: boundary.permissions,
    },
    summary: {
      totalRows: rows.length,
      readyRows: readyRows.length,
      appliedRows: appliedRows.length,
      blockedRows: rows.filter((row) => row.blockers.length > 0).length,
      healthMode: sourceHealth.mode,
      healthSeverity: sourceHealth.severity,
      blockedReasons: rowBlockers,
    },
    rows,
  });
}

export function buildRecoveryPreview(options = {}) {
  const program = options.program ?? buildRecoveryProgram(options);
  const audit = options.audit ?? buildRecoveryAudit(program, options);
  const handoff = buildRecoveryStatusHandoffContract(program, audit, options);
  const packageReadiness = buildPackageReadinessPreview(program, {
    providerContract: buildProviderServiceContract(program, {
      externalApproval: options.approvalTicket,
      providerResource: "campaign-report-recovery",
      supportedCapabilities: options.supportedCapabilities,
      checkpoint: handoff.exportSnapshot.exportId,
    }),
    acceptance: {
      accepted: options.accepted ?? false,
      acceptedBy: options.acceptedBy,
      acceptedAt: options.acceptedAt ?? "logical:6",
    },
  });

  return deepFreeze({
    kind: "mailchimp.recovery.preview",
    apiVersion: "aios.example/v1",
    title: "Mailchimp recovery status handoff",
    jobId: program.job.id,
    ready: handoff.ready && packageReadiness.readiness.ready,
    handoff,
    packageReadiness,
    runtimeAdoption: handoff.runtimeAdoption,
    operatorHandoffPacket: handoff.operatorHandoffPacket,
    nextSteps: buildRecoveryNextSteps(handoff, packageReadiness),
  });
}

export function describeRecoveryJob(options = {}) {
  const preview = buildRecoveryPreview(options);

  return deepFreeze({
    jobId: preview.jobId,
    ready: preview.ready,
    statusEvent: preview.handoff.statusEvent,
    runtimeCommand: preview.handoff.runtimeCommand,
    restartToken: preview.handoff.restartToken,
    adapter: preview.handoff.adapter,
    operationalHealth: preview.handoff.operationalHealth,
    workspaceBoundary: preview.handoff.workspaceBoundary,
    sync: preview.handoff.sync,
    clientState: preview.handoff.clientState,
    runtimeAdoption: preview.handoff.runtimeAdoption,
    operatorHandoffPacket: preview.handoff.operatorHandoffPacket,
    analyticsSummary: {
      exportId: preview.handoff.analyticsSummary.exportId,
      ready: preview.handoff.analyticsSummary.ready,
      status: preview.handoff.analyticsSummary.report.status,
      counters: preview.handoff.analyticsSummary.counters,
      nextAction: preview.handoff.analyticsSummary.report.nextAction,
    },
    persistedHandoffState: {
      stateKey: preview.handoff.persistedHandoffState.stateKey,
      status: preview.handoff.persistedHandoffState.status,
      restartToken: preview.handoff.persistedHandoffState.restart.token,
      readyRows: preview.handoff.persistedHandoffState.summary.readyRows,
      blockedRows: preview.handoff.persistedHandoffState.summary.blockedRows,
    },
    blockedReasons: preview.handoff.validation.blockedReasons,
    nextSteps: preview.nextSteps,
  });
}

export function selfCheckRecoveryJob(options = {}) {
  const preview = buildRecoveryPreview({
    accepted: true,
    acceptedBy: "self-check",
    approvalTicket: "self_check_approval",
    ...options,
  });

  return deepFreeze({
    kind: "mailchimp.recovery.self-check",
    apiVersion: "aios.example/v1",
    passed: preview.ready,
    errors: preview.handoff.validation.blockedReasons,
    jobId: preview.jobId,
    runtimeCommand: preview.handoff.runtimeCommand,
    persistedHandoffState: preview.handoff.persistedHandoffState,
    operatorHandoffPacket: preview.handoff.operatorHandoffPacket,
    analyticsSummary: preview.handoff.analyticsSummary,
  });
}

export function buildRecoveryAnalyticsSummary(
  program = buildRecoveryProgram(),
  audit = buildRecoveryAudit(program),
  exportSnapshot = createAuditExportSnapshot(audit, { generatedAt: "logical:4", format: "json.summary" }),
  providerContract = buildProviderServiceContract(program),
  adapter = normalizeAdapterStatus(),
  checkpoints = buildRecoveryCheckpoints(program, audit),
  workspaceBoundary = buildRecoveryWorkspaceBoundary(program, providerContract),
  operationalHealth = buildRecoveryOperationalHealth(program, audit, providerContract, adapter, checkpoints, workspaceBoundary),
  validation = { ready: false, nextAction: "recovery.review", blockedReasons: ["recovery validation is pending"] },
  clientState = null,
  persistedHandoffState = null,
  runtimeAdoption = null,
  operatorHandoffPacket = null,
  providerSyncEvidence = null,
  options = {},
) {
  const generatedAt = String(options.analyticsGeneratedAt ?? options.generatedAt ?? "logical:7");
  const checkpointRows = checkpoints.map((checkpoint, index) => ({
    id: checkpoint.stepId,
    command: checkpoint.command,
    ordinal: index + 1,
    complete: checkpoint.complete,
    evidenceReady: checkpoint.evidenceReady,
    resumeCursor: checkpoint.resumeCursor,
    state: checkpoint.complete && checkpoint.evidenceReady
      ? "complete"
      : checkpoint.evidenceReady ? "waiting-for-replay" : "blocked",
    verifierClaimCount: Object.keys(checkpoint.verifierClaims ?? {}).length,
  }));
  const timeline = [
    ...audit.timeline.map((event, index) => ({
      source: "audit",
      index,
      at: event.at,
      event: event.status,
      status: event.status,
      message: event.message,
      command: index === audit.timeline.length - 1 ? validation.nextAction : null,
      blockedCount: index === audit.timeline.length - 1 ? validation.blockedReasons.length : 0,
    })),
    ...checkpointRows.map((row, index) => ({
      source: "checkpoint",
      index: audit.timeline.length + index,
      at: generatedAt,
      event: `recovery.${row.command}`,
      status: row.state,
      message: row.evidenceReady ? row.resumeCursor : `evidence missing for ${row.command}`,
      command: row.evidenceReady ? row.command : "verifier.evidence.collect",
      blockedCount: row.evidenceReady ? 0 : 1,
    })),
  ];
  const priorHistory = (options.history ?? []).map((entry, index) => ({
    index,
    at: String(entry.at ?? `history:${index}`),
    status: String(entry.status ?? entry.label ?? "unknown"),
    exportId: entry.exportId ? String(entry.exportId) : null,
    ready: Boolean(entry.ready ?? false),
    completeCheckpoints: Number(entry.completeCheckpoints ?? 0),
    blockedReasons: uniqueSorted(entry.blockedReasons ?? []),
  }));
  const historySnapshots = [
    ...priorHistory,
    {
      index: priorHistory.length,
      at: generatedAt,
      status: validation.ready ? "ready" : operationalHealth.mode,
      exportId: exportSnapshot.exportId,
      ready: validation.ready,
      completeCheckpoints: checkpointRows.filter((row) => row.complete).length,
      blockedReasons: validation.blockedReasons,
    },
  ].slice(-12);
  const blockedReasons = uniqueSorted([
    ...(validation.blockedReasons ?? []),
    ...(workspaceBoundary.ready ? [] : workspaceBoundary.blockedReasons),
    ...(providerSyncEvidence?.readiness?.ready ?? false
      ? []
      : providerSyncEvidence?.readiness?.blockedReasons ?? ["recovery provider sync evidence is pending"]),
    ...(operatorHandoffPacket?.ready ?? false
      ? []
      : operatorHandoffPacket?.blockedReasons ?? []),
    ...checkpointRows
      .filter((row) => !row.evidenceReady)
      .map((row) => `recovery analytics evidence missing: ${row.command}`),
  ]);
  const ready = blockedReasons.length === 0
    && validation.ready
    && exportSnapshot.truthBoundary.readyForExport
    && operationalHealth.runtimeEnabled;
  const exportId = `recovery-analytics:${stableToken([
    program.job.id,
    exportSnapshot.exportId,
    providerSyncEvidence?.receipt,
    workspaceBoundary.scopeKey,
    checkpointRows.map((row) => `${row.id}:${row.state}`).join(","),
  ])}`;
  const counters = {
    totalCheckpoints: checkpointRows.length,
    completeCheckpoints: checkpointRows.filter((row) => row.complete).length,
    evidenceReadyCheckpoints: checkpointRows.filter((row) => row.evidenceReady).length,
    blockedCheckpoints: checkpointRows.filter((row) => row.state === "blocked").length,
    missingEvidence: audit.evidence.missing.length,
    acceptedEvidence: audit.evidence.accepted.length,
    externalWriteViolations: audit.boundary.externalWritesObserved.length,
    timelineEvents: timeline.length,
    historySnapshots: historySnapshots.length,
    runtimeAdoptionReadyRows: runtimeAdoption?.summary?.readyRows ?? 0,
    persistedReadyRows: persistedHandoffState?.summary?.readyRows ?? 0,
  };

  return deepFreeze({
    kind: "mailchimp.recovery.analytics-summary",
    apiVersion: "aios.analytics/v1",
    jobId: program.job.id,
    exportId,
    generatedAt,
    ready,
    counters,
    timeline,
    historySnapshots,
    checkpointRows,
    report: {
      status: ready ? "export-ready" : "export-blocked",
      nextAction: ready
        ? clientState?.runtime?.command ?? "recovery.resume"
        : validation.nextAction ?? operationalHealth.nextAction,
      restartToken: ready ? persistedHandoffState?.restart?.token ?? null : null,
      providerSyncReceipt: providerSyncEvidence?.receipt ?? null,
      auditExportId: exportSnapshot.exportId,
      tenantScope: workspaceBoundary.scopeKey,
      adapterStatus: adapter.status,
      healthSeverity: operationalHealth.severity,
      blockedReasons,
    },
    validation: {
      ready,
      truthBoundaryReady: exportSnapshot.truthBoundary.readyForExport,
      runtimeHealthEnabled: operationalHealth.runtimeEnabled,
      tenantBoundaryReady: workspaceBoundary.ready,
      providerReady: providerContract.handoffState.ready,
      blockedReasons,
    },
  });
}

function buildRecoveryCheckpoints(program, audit, completedSteps) {
  const completed = Number.isInteger(completedSteps)
    ? completedSteps
    : audit.status === "completed"
      ? program.job.plan.length
      : Math.max(0, program.job.plan.length - audit.evidence.missing.length);

  return program.job.plan.map((step, index) => {
    const missing = audit.evidence.missing.includes(`step:${step.op}`)
      || Object.keys(step.verifierHints).some((hint) => audit.evidence.missing.includes(hint));
    const complete = index < completed && !missing;

    return {
      key: `${program.job.memory.namespace}:recovery:${index + 1}:${step.op}`,
      stepId: step.id,
      command: step.op,
      complete,
      evidenceReady: !missing,
      resumeCursor: `${program.job.id}:recovery:${index + 1}`,
      verifierClaims: step.verifierHints,
    };
  });
}

function validateRecoveryHandoff(
  program,
  audit,
  exportSnapshot,
  providerContract,
  adapter,
  checkpoints,
  workspaceBoundary,
  operationalHealth,
) {
  const blockedReasons = uniqueSorted([
    ...(program.lifecycle.validation.valid ? [] : program.lifecycle.validation.errors),
    ...REQUIRED_RECOVERY_CAPABILITIES
      .filter((capability) => !program.job.capabilities.includes(capability))
      .map((capability) => `required recovery capability missing: ${capability}`),
    ...(providerContract.handoffState.ready ? [] : providerContract.handoffState.blockedReasons),
    ...(workspaceBoundary.ready ? [] : workspaceBoundary.blockedReasons),
    ...(exportSnapshot.truthBoundary.readyForExport ? [] : [exportSnapshot.summary]),
    ...audit.boundary.externalWritesObserved.map((write) => `external write observed: ${write.target}`),
    ...checkpoints
      .filter((checkpoint) => !checkpoint.evidenceReady)
      .map((checkpoint) => `checkpoint evidence missing: ${checkpoint.command}`),
    ...operationalHealth.blockedReasons,
  ]);
  const ready = blockedReasons.length === 0;

  return {
    ready,
    nextAction: ready ? "recovery.accept-handoff" : deriveRecoveryNextAction(blockedReasons, adapter, operationalHealth),
    operationalHealth,
    blockedReasons,
    checked: {
      lifecycleValid: program.lifecycle.validation.valid,
      providerReady: providerContract.handoffState.ready,
      exportReady: exportSnapshot.truthBoundary.readyForExport,
      adapterStatus: adapter.status,
      healthMode: operationalHealth.mode,
      retryAttempt: operationalHealth.retryAttempt,
      tenantBoundaryReady: workspaceBoundary.ready,
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      completeCheckpoints: checkpoints.filter((checkpoint) => checkpoint.complete).length,
    },
  };
}

export function buildRecoveryOperationalHealth(
  program = buildRecoveryProgram(),
  audit = buildRecoveryAudit(program),
  providerContract = null,
  adapter = normalizeAdapterStatus(),
  checkpoints = [],
  workspaceBoundary = null,
  options = {},
) {
  const retryAttempt = Math.max(0, Number(options.retryAttempt ?? 0));
  const maxRetries = Math.max(0, Number(options.maxRetries ?? program.job.recovery.retry ?? 3));
  const retryAfterSeconds = adapter.status === "degraded"
    ? Math.max(5, Number(adapter.retryAfterSeconds ?? options.adapterRetryAfterSeconds ?? 30))
    : null;
  const missingEvidence = audit?.evidence?.missing ?? [];
  const externalWrites = (audit?.boundary?.externalWritesObserved ?? [])
    .map((write) => String(write.subject ?? write.target ?? write));
  const incompleteCheckpoints = checkpoints.filter((checkpoint) => !checkpoint.complete);
  const checkpointEvidenceGaps = checkpoints
    .filter((checkpoint) => !checkpoint.evidenceReady)
    .map((checkpoint) => checkpoint.command);
  const providerBlocked = providerContract?.handoffState?.ready === false
    ? providerContract.handoffState.blockedReasons
    : [];
  const boundaryBlocked = workspaceBoundary?.ready === false
    ? workspaceBoundary.blockedReasons
    : [];
  const blockedReasons = uniqueSorted([
    ...(adapter.status === "offline" ? ["recovery adapter is offline"] : []),
    ...(retryAttempt > maxRetries ? [`recovery retry budget exhausted: ${retryAttempt}/${maxRetries}`] : []),
    ...missingEvidence.map((subject) => `recovery evidence missing: ${subject}`),
    ...checkpointEvidenceGaps.map((command) => `recovery checkpoint evidence missing: ${command}`),
    ...externalWrites.map((subject) => `recovery external write observed: ${subject}`),
    ...providerBlocked,
    ...boundaryBlocked,
  ]);
  const degraded = adapter.status === "degraded" || retryAttempt > 0 || incompleteCheckpoints.length > 0;
  const runtimeEnabled = blockedReasons.length === 0 && adapter.status !== "offline";
  const mode = runtimeEnabled
    ? degraded ? "degraded-retry" : "normal"
    : adapter.status === "offline" ? "offline" : "blocked";
  const severity = blockedReasons.length > 0
    ? adapter.status === "offline" || retryAttempt > maxRetries ? "critical" : "error"
    : degraded ? "warning" : "ok";
  const nextAction = adapter.status === "offline"
    ? "adapter.status.poll"
    : retryAttempt > maxRetries
      ? "recovery.retry-budget.review"
      : missingEvidence.length > 0 || checkpointEvidenceGaps.length > 0
        ? "verifier.evidence.collect"
        : providerBlocked.length > 0 || boundaryBlocked.length > 0
          ? "recovery.scope-review"
          : "recovery.resume";
  const completedCheckpoints = checkpoints.filter((checkpoint) => checkpoint.complete && checkpoint.evidenceReady);
  const failureState = blockedReasons.length === 0
    ? null
    : {
      code: severity === "critical" ? "recovery_critical" : "recovery_blocked",
      message: blockedReasons[0],
      retryable: adapter.status !== "offline" && retryAttempt <= maxRetries,
      lastGoodCursor: completedCheckpoints[completedCheckpoints.length - 1]?.resumeCursor ?? null,
      resumeCommand: completedCheckpoints[completedCheckpoints.length - 1]?.command ?? null,
    };

  return deepFreeze({
    kind: "mailchimp.recovery.operational-health",
    apiVersion: "aios.health/v1",
    jobId: program.job.id,
    mode,
    severity,
    degraded,
    adapterStatus: adapter.status,
    retryAttempt,
    maxRetries,
    retryAfterSeconds,
    runtimeEnabled,
    nextAction,
    failureState,
    counters: {
      totalCheckpoints: checkpoints.length,
      completeCheckpoints: completedCheckpoints.length,
      incompleteCheckpoints: incompleteCheckpoints.length,
      missingEvidence: missingEvidence.length,
      externalWriteViolations: externalWrites.length,
      providerBlockers: providerBlocked.length,
      scopeBlockers: boundaryBlocked.length,
    },
    blockedReasons,
    actionableErrors: blockedReasons.map((reason) => ({
      reason,
      action: reason.includes("evidence")
        ? "verifier.evidence.collect"
        : reason.includes("retry budget")
          ? "recovery.retry-budget.review"
          : reason.includes("offline")
            ? "adapter.status.poll"
            : reason.includes("permission") || reason.includes("tenant") || reason.includes("workspace")
              ? "recovery.scope-review"
              : "recovery.review",
      retryAfterSeconds,
      idempotencyKey: `${program.job.id}:recovery:health:${stableToken([
        reason,
        retryAttempt,
        maxRetries,
      ])}`,
    })),
  });
}

function buildRecoveryNextSteps(handoff, packageReadiness) {
  if (handoff.operatorHandoffPacket && !handoff.operatorHandoffPacket.ready) {
    return handoff.operatorHandoffPacket.blockedReasons.map((reason) => ({
      action: handoff.operatorHandoffPacket.nextAction,
      label: "Resolve recovery operator handoff",
      reason,
      idempotencyKey: handoff.operatorHandoffPacket.release.idempotencyKey,
    }));
  }
  if (handoff.validation.blockedReasons.length > 0) {
    return handoff.clientState.actions.filter((action) => action.state !== "complete");
  }
  if (!handoff.acceptance.accepted || !packageReadiness.acceptance.accepted) {
    return [{
      action: "recovery.accept-handoff",
      label: "Accept recovery handoff",
      reason: "provider sync, audit export, and adapter recovery are ready",
      idempotencyKey: handoff.clientState.acceptance.idempotencyKey,
    }];
  }
  return [{
    action: handoff.runtimeCommand,
    label: "Resume Mailchimp recovery",
    reason: "accepted recovery handoff is ready for the adapter",
    idempotencyKey: handoff.clientState.runtime.idempotencyKey,
  }];
}

function deriveRecoveryNextAction(blockedReasons, adapter, operationalHealth) {
  if (operationalHealth?.nextAction && operationalHealth.nextAction !== "recovery.resume") {
    return operationalHealth.nextAction;
  }
  if (adapter.status === "degraded") {
    return "adapter.status.poll";
  }
  if (blockedReasons.some((reason) => reason.includes("permission") || reason.includes("tenant") || reason.includes("workspace"))) {
    return "recovery.scope-review";
  }
  if (blockedReasons.some((reason) => reason.includes("evidence"))) {
    return "verifier.evidence.collect";
  }
  return "recovery.review";
}

export function buildRecoveryWorkspaceBoundary(
  program = buildRecoveryProgram(),
  providerContract = null,
  options = {},
) {
  const tenantId = normalizeScopePart(options.tenantId ?? "tenant_mailchimp_default", "tenant");
  const workspaceId = normalizeScopePart(options.workspaceId ?? "workspace_mailchimp_default", "workspace");
  const role = String(options.role ?? "operator").trim().toLowerCase();
  const permissions = uniqueSorted(options.permissions ?? REQUIRED_RECOVERY_PERMISSIONS);
  const allowedRoles = new Set(["operator", "service"]);
  const providerNamespace = providerContract?.sync?.localNamespace ?? program.job.memory.namespace;
  const scopeKey = `${program.job.memory.namespace}:tenant:${tenantId}:workspace:${workspaceId}:recovery`;
  const blockedReasons = uniqueSorted([
    ...(allowedRoles.has(role) ? [] : [`recovery role denied: ${role}`]),
    ...REQUIRED_RECOVERY_PERMISSIONS
      .filter((permission) => !permissions.includes(permission))
      .map((permission) => `recovery permission missing: ${permission}`),
    ...(tenantId === "tenant_public" ? ["recovery tenant scope must not be public"] : []),
    ...(workspaceId === "workspace_public" ? ["recovery workspace scope must not be public"] : []),
    ...(providerNamespace === program.job.memory.namespace
      ? []
      : [`recovery namespace mismatch: ${providerNamespace}`]),
    ...(program.job.memory.writePolicy === "local-only"
      ? []
      : [`recovery memory policy must be local-only: ${program.job.memory.writePolicy}`]),
  ]);

  return deepFreeze({
    kind: "mailchimp.recovery.workspace-boundary",
    apiVersion: "aios.security/v1",
    tenantId,
    workspaceId,
    scopeKey,
    role,
    permissions,
    requiredPermissions: REQUIRED_RECOVERY_PERMISSIONS,
    providerNamespace,
    ready: blockedReasons.length === 0,
    auditHandoff: {
      subject: `${tenantId}/${workspaceId}/${program.job.id}/recovery`,
      command: "audit.recovery-boundary.record",
      idempotencyKey: `${program.job.id}:recovery:boundary:${stableToken([
        tenantId,
        workspaceId,
        role,
        permissions.join(","),
      ])}`,
    },
    blockedReasons,
  });
}

function normalizeAdapterStatus(status = "healthy", retryAfterSeconds = 30) {
  const normalized = String(status ?? "healthy").trim().toLowerCase();
  if (!["healthy", "degraded", "offline"].includes(normalized)) {
    throw new Error(`unsupported adapter status: ${status}`);
  }

  return {
    name: "mailchimp.v1",
    status: normalized,
    handoff: normalized === "healthy" ? "available" : normalized === "degraded" ? "deferred" : "blocked",
    retryAfterSeconds: normalized === "degraded" ? Number(retryAfterSeconds) : null,
  };
}

function buildRecoveryReceiptMap(receipts = []) {
  return new Map((receipts ?? []).map((entry) => {
    const key = String(entry.checkpointKey ?? entry.stepId ?? entry.command ?? entry.idempotencyKey ?? "");
    return [
      key,
      {
        state: String(entry.state ?? entry.status ?? "applied"),
        receipt: entry.receipt ? String(entry.receipt) : null,
      },
    ];
  }).filter(([key]) => key));
}

function buildRecoveryClientHandoffState(
  program,
  validation,
  adapter,
  operationalHealth,
  checkpoints,
  accepted,
  providerSyncEvidence,
  workspaceBoundary,
) {
  const legacySignature = Array.isArray(operationalHealth);
  const sourceCheckpoints = legacySignature ? operationalHealth : checkpoints;
  const health = (legacySignature ? validation.operationalHealth : operationalHealth)
    ?? buildRecoveryOperationalHealth(program, null, null, adapter, sourceCheckpoints, null, {});
  const isAccepted = legacySignature ? checkpoints : accepted;
  const syncEvidence = legacySignature ? accepted : providerSyncEvidence;
  const boundary = legacySignature ? providerSyncEvidence : workspaceBoundary;
  const incompleteCheckpoints = sourceCheckpoints.filter((checkpoint) => !checkpoint.complete);
  const checkpointRows = sourceCheckpoints.map((checkpoint) => ({
    id: checkpoint.stepId,
    command: checkpoint.command,
    state: checkpoint.complete
      ? "complete"
      : checkpoint.evidenceReady
        ? "ready"
        : "blocked",
    resumeCursor: checkpoint.resumeCursor,
    verifierClaimCount: Object.keys(checkpoint.verifierClaims).length,
  }));
  const actions = validation.blockedReasons.length > 0
    ? validation.blockedReasons.map((reason) => ({
      action: validation.nextAction,
      label: "Resolve recovery handoff",
      reason,
      state: reason.includes("adapter recovery") ? adapter.handoff : "blocked",
      idempotencyKey: `${program.job.id}:recovery:resolve:${stableToken([reason])}`,
    }))
    : [
      {
        action: isAccepted ? "recovery.resume" : "recovery.accept-handoff",
        label: isAccepted ? "Resume Mailchimp recovery" : "Accept recovery handoff",
        reason: isAccepted
          ? "accepted recovery handoff is ready for the adapter"
          : "operator acceptance releases the restart token",
        state: isAccepted ? "ready" : "pending",
        idempotencyKey: `${program.job.id}:recovery:${isAccepted ? "resume" : "accept"}`,
      },
    ];

  return deepFreeze({
    kind: "mailchimp.recovery.client-handoff-state",
    apiVersion: "aios.ui/v1",
    jobId: program.job.id,
    ready: validation.ready && isAccepted,
    statusBadge: validation.ready
      ? isAccepted ? "ready-to-resume" : "awaiting-acceptance"
      : adapter.status === "healthy" ? "needs-review" : `adapter-${adapter.status}`,
    runtime: {
      command: validation.ready && isAccepted ? "recovery.resume" : validation.nextAction,
      enabled: validation.ready && isAccepted,
      idempotencyKey: `${program.job.id}:recovery:runtime:${syncEvidence.receipt}`,
      restartSafe: validation.ready && incompleteCheckpoints.length === 0,
    },
    acceptance: {
      required: true,
      accepted: isAccepted,
      command: "recovery.accept-handoff",
      idempotencyKey: `${program.job.id}:recovery:accept:${syncEvidence.receipt}`,
    },
    adapter: {
      status: adapter.status,
      handoff: adapter.handoff,
      retryAfterSeconds: adapter.retryAfterSeconds,
      pollCommand: adapter.status === "degraded" ? "adapter.status.poll" : null,
    },
    operationalHealth: {
      mode: health.mode,
      severity: health.severity,
      degraded: health.degraded,
      runtimeEnabled: health.runtimeEnabled,
      nextAction: health.nextAction,
      failureState: health.failureState,
      actionableErrors: health.actionableErrors,
    },
    tenant: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      scopeKey: boundary.scopeKey,
      ready: boundary.ready,
      auditHandoff: boundary.auditHandoff,
    },
    checkpoints: {
      complete: sourceCheckpoints.length - incompleteCheckpoints.length,
      total: sourceCheckpoints.length,
      rows: checkpointRows,
    },
    actions,
  });
}

export function buildRecoveryRuntimeAdoptionState(
  program = buildRecoveryProgram(),
  validation = { ready: false, nextAction: "recovery.review", blockedReasons: ["recovery validation is pending"] },
  clientState = null,
  persistedHandoffState = null,
  adapter = normalizeAdapterStatus(),
  operationalHealth = buildRecoveryOperationalHealth(program, null, null, adapter, [], null, {}),
  checkpoints = [],
  accepted = false,
  providerSyncEvidence = null,
  options = {},
) {
  const adoptionClientState = clientState ?? buildRecoveryClientHandoffState(
    program,
    validation,
    adapter,
    operationalHealth,
    checkpoints,
    Boolean(accepted),
    providerSyncEvidence ?? { receipt: "pending", readiness: { ready: false } },
    buildRecoveryWorkspaceBoundary(program, null, options),
  );
  const persisted = persistedHandoffState ?? {
    ready: false,
    status: "recovery-resume-waiting",
    restart: {
      command: validation.nextAction,
      enabled: false,
      token: null,
      idempotencyKey: `${program.job.id}:recovery:restart:pending`,
    },
    summary: {
      readyRows: 0,
      blockedRows: checkpoints.length,
      blockedReasons: validation.blockedReasons,
    },
    rows: checkpoints.map((checkpoint) => ({
      id: checkpoint.stepId,
      command: checkpoint.command,
      state: checkpoint.complete ? "ready-to-replay" : "blocked",
      replayAllowed: false,
      blockers: checkpoint.evidenceReady ? [] : [`checkpoint evidence missing: ${checkpoint.command}`],
    })),
  };
  const adoptedReceipts = new Set((options.adoptedRuntimeReceipts ?? [])
    .map((receipt) => String(receipt.checkpointKey ?? receipt.stepId ?? receipt.command ?? receipt.id ?? "")));
  const rows = persisted.rows.map((row, index) => {
    const adopted = adoptedReceipts.has(row.checkpointKey)
      || adoptedReceipts.has(row.id)
      || adoptedReceipts.has(row.command)
      || row.state === "applied"
      || row.state === "resumed";
    const adoptionAllowed = validation.ready
      && Boolean(accepted)
      && persisted.ready
      && row.replayAllowed !== false
      && row.blockers.length === 0;
    const command = adopted
      ? "recovery.runtime.receipt.confirm"
      : adoptionAllowed
        ? row.restartCommand ?? persisted.restart.command
        : validation.nextAction;

    return {
      id: row.id,
      command: row.command,
      checkpointKey: row.checkpointKey ?? `${program.job.id}:runtime-adoption:${index + 1}`,
      state: adopted
        ? "adopted"
        : adoptionAllowed ? "ready-for-runtime" : row.state,
      adopted,
      adoptionAllowed,
      runtimeCommand: command,
      resumeCursor: row.resumeCursor ?? null,
      idempotencyKey: `${program.job.id}:recovery:runtime-adopt:${index + 1}:${stableToken([
        row.id,
        row.command,
        row.state,
        providerSyncEvidence?.receipt,
      ])}`,
      blockers: uniqueSorted([
        ...(row.blockers ?? []),
        ...(validation.ready ? [] : validation.blockedReasons),
        ...(accepted ? [] : ["operator recovery acceptance is pending"]),
        ...(persisted.ready ? [] : persisted.summary.blockedReasons),
        ...(adapter.status === "offline" ? ["recovery adapter is offline"] : []),
      ]),
    };
  });
  const blockedReasons = uniqueSorted([
    ...validation.blockedReasons,
    ...persisted.summary.blockedReasons,
    ...rows.flatMap((row) => row.blockers),
    ...(operationalHealth.runtimeEnabled ? [] : operationalHealth.blockedReasons),
  ]);
  const readyRows = rows.filter((row) => row.adoptionAllowed && !row.adopted);
  const adoptedRows = rows.filter((row) => row.adopted);
  const fullyAdopted = rows.length > 0 && adoptedRows.length === rows.length;
  const releaseReady = blockedReasons.length === 0
    && Boolean(accepted)
    && validation.ready
    && persisted.ready
    && adapter.status !== "offline";
  const adoptionToken = releaseReady ? stableToken([
    program.job.id,
    persisted.restart.token,
    providerSyncEvidence?.receipt,
    rows.map((row) => `${row.id}:${row.state}`).join(","),
  ]) : null;
  const activeAction = adoptionClientState.actions.find((action) => action.state !== "complete")
    ?? adoptionClientState.actions[0]
    ?? {
      action: releaseReady ? "recovery.resume" : validation.nextAction,
      label: releaseReady ? "Resume Mailchimp recovery" : "Review recovery adoption",
      reason: blockedReasons[0] ?? "runtime adoption state is available",
      idempotencyKey: `${program.job.id}:recovery:runtime-adoption`,
    };

  return deepFreeze({
    kind: "mailchimp.recovery.runtime-adoption-state",
    apiVersion: "aios.ui/v1",
    jobId: program.job.id,
    ready: releaseReady,
    status: fullyAdopted
      ? "runtime-adopted"
      : releaseReady ? "runtime-adoption-ready" : "runtime-adoption-blocked",
    nextAction: releaseReady
      ? readyRows.length > 0 ? "recovery.runtime.adopt" : "recovery.resume"
      : activeAction.action,
    adoption: {
      command: releaseReady ? "recovery.runtime.adopt" : activeAction.action,
      enabled: releaseReady && readyRows.length > 0,
      token: adoptionToken,
      idempotencyKey: `${program.job.id}:recovery:runtime-adopt:${providerSyncEvidence?.receipt ?? "pending"}`,
      accepted: Boolean(accepted),
      acceptedBy: options.acceptedBy ? String(options.acceptedBy) : null,
    },
    runtime: {
      command: releaseReady ? persisted.restart.command : validation.nextAction,
      restartToken: releaseReady ? persisted.restart.token : null,
      restartSafe: adoptionClientState.runtime.restartSafe && persisted.ready,
      clientCommand: adoptionClientState.runtime.command,
      clientEnabled: adoptionClientState.runtime.enabled,
    },
    adapter: {
      status: adapter.status,
      handoff: adapter.handoff,
      retryAfterSeconds: adapter.retryAfterSeconds,
      pollCommand: adapter.status === "degraded" ? "adapter.status.poll" : null,
    },
    operationalHealth: {
      mode: operationalHealth.mode,
      severity: operationalHealth.severity,
      runtimeEnabled: operationalHealth.runtimeEnabled,
      nextAction: operationalHealth.nextAction,
      failureState: operationalHealth.failureState,
    },
    summary: {
      totalRows: rows.length,
      readyRows: readyRows.length,
      adoptedRows: adoptedRows.length,
      blockedRows: rows.filter((row) => row.blockers.length > 0).length,
      persistedStatus: persisted.status,
      clientStatusBadge: adoptionClientState.statusBadge,
      blockedReasons,
    },
    actions: [
      activeAction,
      ...rows
        .filter((row) => row.adoptionAllowed && !row.adopted)
        .map((row) => ({
          action: row.runtimeCommand,
          label: "Adopt recovery checkpoint",
          reason: row.checkpointKey,
          state: row.state,
          idempotencyKey: row.idempotencyKey,
        })),
    ],
    rows,
  });
}

export function buildRecoveryOperatorHandoffPacket(
  program = buildRecoveryProgram(),
  validation = { ready: false, nextAction: "recovery.review", blockedReasons: ["recovery validation is pending"] },
  clientState = null,
  persistedHandoffState = null,
  runtimeAdoption = null,
  adapter = normalizeAdapterStatus(),
  operationalHealth = buildRecoveryOperationalHealth(program, null, null, adapter, [], null, {}),
  checkpoints = [],
  accepted = false,
  providerSyncEvidence = { receipt: "pending", readiness: { ready: false, blockedReasons: ["provider sync evidence is pending"] } },
  workspaceBoundary = buildRecoveryWorkspaceBoundary(program),
  options = {},
) {
  const adoptionClientState = clientState ?? buildRecoveryClientHandoffState(
    program,
    validation,
    adapter,
    operationalHealth,
    checkpoints,
    Boolean(accepted),
    providerSyncEvidence,
    workspaceBoundary,
  );
  const persisted = persistedHandoffState ?? buildRecoveryPersistedHandoffState(
    program,
    validation,
    adapter,
    operationalHealth,
    checkpoints,
    Boolean(accepted),
    providerSyncEvidence,
    null,
    workspaceBoundary,
    options,
  );
  const adoption = runtimeAdoption ?? buildRecoveryRuntimeAdoptionState(
    program,
    validation,
    adoptionClientState,
    persisted,
    adapter,
    operationalHealth,
    checkpoints,
    Boolean(accepted),
    providerSyncEvidence,
    options,
  );
  const isAccepted = Boolean(accepted);
  const releaseReady = validation.ready
    && isAccepted
    && persisted.ready
    && adoption.ready
    && adoptionClientState.ready
    && providerSyncEvidence.readiness.ready
    && workspaceBoundary.ready
    && adapter.status !== "offline";
  const blockedReasons = uniqueSorted([
    ...validation.blockedReasons,
    ...(isAccepted ? [] : ["operator recovery acceptance is pending"]),
    ...persisted.summary.blockedReasons,
    ...adoption.summary.blockedReasons,
    ...(providerSyncEvidence.readiness.ready ? [] : providerSyncEvidence.readiness.blockedReasons),
    ...(workspaceBoundary.ready ? [] : workspaceBoundary.blockedReasons),
    ...(operationalHealth.runtimeEnabled ? [] : operationalHealth.blockedReasons),
    ...(adapter.status === "offline" ? ["recovery adapter is offline"] : []),
  ]);
  const rows = [
    {
      id: "scope-boundary",
      command: workspaceBoundary.auditHandoff.command,
      state: workspaceBoundary.ready ? "ready" : "blocked",
      enabled: workspaceBoundary.ready,
      idempotencyKey: workspaceBoundary.auditHandoff.idempotencyKey,
      blockers: workspaceBoundary.blockedReasons,
    },
    {
      id: "persisted-resume",
      command: persisted.restart.command,
      state: persisted.ready ? "ready" : "blocked",
      enabled: persisted.ready && isAccepted,
      idempotencyKey: persisted.restart.idempotencyKey,
      blockers: persisted.summary.blockedReasons,
    },
    {
      id: "runtime-adoption",
      command: adoption.adoption.command,
      state: adoption.ready ? "ready" : "blocked",
      enabled: adoption.ready,
      idempotencyKey: adoption.adoption.idempotencyKey,
      blockers: adoption.summary.blockedReasons,
    },
    {
      id: "operator-acceptance",
      command: adoptionClientState.acceptance.command,
      state: isAccepted ? "accepted" : "pending",
      enabled: !isAccepted && validation.ready && workspaceBoundary.ready,
      idempotencyKey: adoptionClientState.acceptance.idempotencyKey,
      blockers: isAccepted ? [] : ["operator recovery acceptance is pending"],
    },
  ];
  const activeRow = rows.find((row) => row.enabled)
    ?? rows.find((row) => row.state === "blocked" || row.state === "pending")
    ?? rows[0];
  const releaseToken = releaseReady ? stableToken([
    program.job.id,
    providerSyncEvidence.receipt,
    persisted.restart.token,
    adoption.adoption.token,
    workspaceBoundary.scopeKey,
  ]) : null;

  return deepFreeze({
    kind: "mailchimp.recovery.operator-handoff-packet",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready: releaseReady,
    status: releaseReady ? "ready-for-recovery-runtime" : "waiting-for-recovery-runtime",
    nextAction: releaseReady ? "recovery.operator-handoff.release" : activeRow.command,
    providerSync: {
      receipt: providerSyncEvidence.receipt,
      ready: providerSyncEvidence.readiness.ready,
      checkpoint: providerSyncEvidence.contract?.sync?.checkpoint ?? null,
      cursor: providerSyncEvidence.contract?.sync?.cursor ?? null,
      readinessBlockedReasons: providerSyncEvidence.readiness.blockedReasons,
    },
    tenant: {
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      scopeKey: workspaceBoundary.scopeKey,
      ready: workspaceBoundary.ready,
    },
    release: {
      command: releaseReady ? "recovery.operator-handoff.release" : activeRow.command,
      enabled: releaseReady,
      token: releaseToken,
      idempotencyKey: `${program.job.id}:recovery:operator-handoff:${providerSyncEvidence.receipt}`,
      restartToken: releaseReady ? persisted.restart.token : null,
      adoptionToken: releaseReady ? adoption.adoption.token : null,
      acceptedBy: isAccepted ? String(options.acceptedBy ?? "operator") : null,
    },
    clientState: {
      badge: releaseReady
        ? "recovery-runtime-ready"
        : isAccepted ? "accepted-needs-review" : "awaiting-acceptance",
      primaryAction: activeRow.command,
      canAccept: rows.find((row) => row.id === "operator-acceptance").enabled,
      canRelease: releaseReady,
      canPollAdapter: adapter.status === "degraded",
      blockedReasons,
    },
    summary: {
      totalRows: rows.length,
      readyRows: rows.filter((row) => row.state === "ready" || row.state === "accepted").length,
      blockedRows: rows.filter((row) => row.blockers.length > 0).length,
      checkpoints: checkpoints.length,
      persistedReadyRows: persisted.summary.readyRows,
      adoptionReadyRows: adoption.summary.readyRows,
      healthSeverity: operationalHealth.severity,
    },
    rows,
    blockedReasons,
  });
}

function normalizeScopePart(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
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
  return `rec_${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
