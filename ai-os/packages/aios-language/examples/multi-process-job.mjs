import {
  createAuditExportSnapshot,
  createEvidence,
  createStatusEvent,
  createTruthBoundaryReport,
} from "../stdlib/audit.mjs";
import {
  buildProviderServiceContract,
  compilePackageSource,
} from "../stdlib/packages.mjs";
import {
  buildRecoveryStatusHandoff,
  buildRollbackContract,
  summarizeRollbackContract,
} from "../stdlib/rollback.mjs";

export const multiProcessJobSource = `# deterministic Mailchimp multi-process read fanout
use mailchimp:campaign.read
use mailchimp:report.read
use memory:campaign.local
use verifier:evidence.record
use rollback:snapshot.create
use status:timeline.write
recover rollback=snapshot retry=2
step spawn-campaign-reader input=campaignId output=campaignProcess verify.intent=read-only
step spawn-report-reader input=campaignId output=reportProcess verify.source=mailchimp
step join-process-claims input=campaignProcess,reportProcess output=joinedClaim verify.truth=local-only
step emit-process-status input=joinedClaim output=statusEvent verify.status=adapter-handoff
`;

export function buildMultiProcessProgram(options = {}) {
  return compilePackageSource(multiProcessJobSource, {
    name: options.name ?? "mailchimp-multi-process-job",
    version: options.version ?? "0.1.0",
    description: "Compile a Mailchimp multi-process read fanout with joined verifier claims and adapter handoff.",
    capabilities: options.capabilities ?? [],
    exports: {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      processJoin: "./examples/multi-process-job.mjs#buildMultiProcessContract",
      recoveryStatus: "./examples/multi-process-job.mjs#buildMultiProcessRecoveryStatus",
    },
  }, {
    name: "mailchimp-multi-process-job",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: options.dryRun ?? true,
      requireApproval: options.requireApproval ?? true,
      approvalTicket: options.approvalTicket,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 14,
    },
  });
}

export function buildMultiProcessAudit(program = buildMultiProcessProgram(), options = {}) {
  const missingSubjects = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missingSubjects.has(subject))
    .map((subject) => createEvidence(
      subject.includes("verify.source") ? "mailchimp-read-receipt" : "runtime-local-receipt",
      subject,
      { example: "multi-process-job", processFanout: true },
    ));

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "completed",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "multi-process fanout queued" }),
      createStatusEvent("running", { at: "logical:1", message: "campaign and report readers spawned" }),
      createStatusEvent("verifying", { at: "logical:2", message: "process claims joined" }),
      createStatusEvent(options.status ?? "completed", {
        at: "logical:3",
        message: "joined status handoff shaped",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildMultiProcessContract(
  program = buildMultiProcessProgram(),
  audit = buildMultiProcessAudit(program),
  options = {},
) {
  const exportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:4",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const providerContract = buildProviderServiceContract(program, {
    checkpoint: exportSnapshot.exportId,
    externalApproval: options.approvalTicket,
    providerResource: "campaign-report-fanout",
    supportedCapabilities: options.supportedCapabilities,
  });
  const rollbackContract = buildRollbackContract(withRollbackVerifierHints(program), audit, {
    adapterStatus: options.adapterHealth,
    adapterCheckedAt: options.adapterCheckedAt ?? "logical:5",
    commandStatuses: options.commandStatuses,
    completedSteps: options.completedSteps ?? 4,
    failedStep: options.failedStep,
    retryAfterSeconds: options.adapterRetryAfterSeconds,
  });
  const recoveryStatus = buildRecoveryStatusHandoff(rollbackContract, {
    accepted: options.accepted ?? false,
  });
  const processGraph = buildProcessGraph(program);
  const providerServiceHandoff = buildMultiProcessProviderServiceHandoff(
    program,
    audit,
    providerContract,
    recoveryStatus,
    processGraph,
    options,
  );
  const clientWorkflow = buildMultiProcessClientWorkflow(program, audit, processGraph, recoveryStatus, options);
  const persistedState = buildMultiProcessPersistedState(
    program,
    audit,
    processGraph,
    clientWorkflow,
    recoveryStatus,
    options,
  );
  const operationalHealth = buildMultiProcessOperationalHealth(
    program,
    audit,
    processGraph,
    clientWorkflow,
    persistedState,
    recoveryStatus,
    options,
  );
  const continuity = buildMultiProcessContinuityPacket(
    program,
    audit,
    processGraph,
    clientWorkflow,
    persistedState,
    recoveryStatus,
    options,
  );
  const previewAcceptance = buildMultiProcessPreviewAcceptance(
    program,
    audit,
    processGraph,
    clientWorkflow,
    persistedState,
    operationalHealth,
    continuity,
    providerServiceHandoff,
    recoveryStatus,
    options,
  );
  const clientRuntimeAdoption = buildMultiProcessClientRuntimeAdoption(
    program,
    audit,
    processGraph,
    clientWorkflow,
    persistedState,
    operationalHealth,
    continuity,
    previewAcceptance,
    providerServiceHandoff,
    recoveryStatus,
    options,
  );
  const clientSessionHandoff = buildMultiProcessClientSessionHandoff(
    program,
    audit,
    processGraph,
    clientWorkflow,
    persistedState,
    operationalHealth,
    continuity,
    previewAcceptance,
    clientRuntimeAdoption,
    providerServiceHandoff,
    recoveryStatus,
    options,
  );
  const restartStatusLedger = buildMultiProcessRestartStatusLedger(
    program,
    audit,
    persistedState,
    operationalHealth,
    continuity,
    providerServiceHandoff,
    clientSessionHandoff,
    recoveryStatus,
    options,
  );
  const tenantPermissionBoundary = buildMultiProcessTenantPermissionBoundary(
    program,
    audit,
    processGraph,
    clientWorkflow,
    persistedState,
    continuity,
    providerServiceHandoff,
    recoveryStatus,
    options,
  );
  const blockedReasons = uniqueSorted([
    ...audit.evidence.missing.map((subject) => `missing process evidence: ${subject}`),
    ...audit.boundary.externalWritesObserved.map((write) => `external write observed: ${write.subject ?? write}`),
    ...providerContract.handoffState.blockedReasons,
    ...providerServiceHandoff.validation.blockers,
    ...recoveryStatus.blockedReasons,
    ...clientWorkflow.validation.blockers,
    ...persistedState.validation.blockers,
    ...operationalHealth.validation.blockers,
    ...continuity.validation.blockers,
    ...previewAcceptance.validation.blockers,
    ...clientRuntimeAdoption.validation.blockers,
    ...clientSessionHandoff.validation.blockers,
    ...restartStatusLedger.validation.blockers,
    ...tenantPermissionBoundary.validation.blockers,
    ...(processGraph.joinSteps.length === 0 ? ["multi-process contract requires a join step"] : []),
  ]);
  const ready = blockedReasons.length === 0
    && exportSnapshot.truthBoundary.readyForExport
    && clientWorkflow.validation.ready
    && persistedState.validation.ready
    && clientRuntimeAdoption.validation.ready
    && clientSessionHandoff.validation.ready
    && restartStatusLedger.validation.ready
    && tenantPermissionBoundary.validation.ready;

  return {
    kind: "mailchimp.multi-process.contract",
    apiVersion: "aios.example/v1",
    jobId: program.job.id,
    status: audit.status,
    processGraph,
    clientWorkflow,
    persistedState,
    operationalHealth,
    continuity,
    previewAcceptance,
    clientRuntimeAdoption,
    clientSessionHandoff,
    restartStatusLedger,
    tenantPermissionBoundary,
    providerServiceHandoff,
    providerContract,
    rollback: {
      contract: rollbackContract,
      summary: summarizeRollbackContract(rollbackContract),
      statusHandoff: recoveryStatus,
    },
    exportSnapshot,
    readiness: {
      ready,
      nextAction: ready ? "handoff-joined-process-status" : "resolve-process-join-blockers",
      blockedReasons,
    },
    runtimeHandoff: {
      ready,
      command: ready ? "process.joined.resume" : "process.joined.review",
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
      restartToken: recoveryStatus.restartToken,
      clientRequest: clientWorkflow.request,
      visibleState: clientWorkflow.visibleState,
      persistedStateKey: persistedState.stateKey,
      idempotencyKey: persistedState.commands.resume.idempotencyKey,
      health: operationalHealth.health,
      retryPlan: operationalHealth.retryPlan,
      continuityKey: continuity.continuityKey,
      previewId: previewAcceptance.preview.previewId,
      acceptanceId: previewAcceptance.acceptance.acceptanceId,
      acceptanceCommand: previewAcceptance.acceptance.command,
      clientAdoptionKey: clientRuntimeAdoption.adoptionKey,
      clientAdoptionPhase: clientRuntimeAdoption.visibleState.phase,
      clientAdoptionCommand: clientRuntimeAdoption.commands.adopt.command,
      clientSessionId: clientSessionHandoff.session.sessionId,
      clientSessionPhase: clientSessionHandoff.session.phase,
      clientSessionCommand: clientSessionHandoff.commands.primary.command,
      clientSessionStatusChannel: clientSessionHandoff.session.statusChannel,
      clientSessionSubmissionDecision: clientSessionHandoff.submissionGuard.decision,
      clientSessionSubmissionCommand: clientSessionHandoff.submissionGuard.command,
      clientSessionSubmissionReplaySafe: clientSessionHandoff.submissionGuard.replaySafe,
      restartLedgerKey: restartStatusLedger.ledgerKey,
      restartLedgerCommand: restartStatusLedger.commands.record.command,
      restartLedgerCursor: restartStatusLedger.replay.cursor,
      restartLedgerStatus: restartStatusLedger.status.finalStatus,
      tenantScope: continuity.scope,
      tenantBoundaryDecision: tenantPermissionBoundary.decision.state,
      tenantBoundaryCommand: tenantPermissionBoundary.commands.primary.command,
      tenantBoundaryScopeToken: tenantPermissionBoundary.scope.scopeToken,
      tenantBoundaryAuditHandoff: tenantPermissionBoundary.auditHandoff,
      tenantBoundaryStatusEvent: tenantPermissionBoundary.statusHandoff,
      externalProviderHandoff: providerServiceHandoff.externalHandoff,
    },
  };
}

export function buildMultiProcessRecoveryStatus(options = {}) {
  const program = options.program ?? buildMultiProcessProgram(options);
  const audit = options.audit ?? buildMultiProcessAudit(program, options);
  const contract = buildMultiProcessContract(program, audit, options);

  return {
    kind: "mailchimp.multi-process.recovery-status",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready: contract.readiness.ready,
    statusEvent: contract.rollback.statusHandoff.statusEvent,
    runtimeCommand: contract.runtimeHandoff.command,
    processGraph: contract.processGraph,
    clientWorkflow: contract.clientWorkflow,
    persistedState: contract.persistedState,
    operationalHealth: contract.operationalHealth,
    continuity: contract.continuity,
    previewAcceptance: contract.previewAcceptance,
    clientRuntimeAdoption: contract.clientRuntimeAdoption,
    clientSessionHandoff: contract.clientSessionHandoff,
    restartStatusLedger: contract.restartStatusLedger,
    tenantPermissionBoundary: contract.tenantPermissionBoundary,
    providerServiceHandoff: contract.providerServiceHandoff,
    blockedReasons: contract.readiness.blockedReasons,
  };
}

export function describeMultiProcessJob(options = {}) {
  const program = buildMultiProcessProgram(options);
  const audit = buildMultiProcessAudit(program, options);
  const contract = buildMultiProcessContract(program, audit, options);

  return {
    jobId: program.job.id,
    package: program.manifest.name,
    status: audit.status,
    processGraph: contract.processGraph,
    clientWorkflow: contract.clientWorkflow,
    persistedState: contract.persistedState,
    operationalHealth: contract.operationalHealth,
    continuity: contract.continuity,
    previewAcceptance: contract.previewAcceptance,
    clientRuntimeAdoption: contract.clientRuntimeAdoption,
    clientSessionHandoff: contract.clientSessionHandoff,
    restartStatusLedger: contract.restartStatusLedger,
    tenantPermissionBoundary: contract.tenantPermissionBoundary,
    providerServiceHandoff: contract.providerServiceHandoff,
    readiness: contract.readiness,
    runtimeHandoff: contract.runtimeHandoff,
  };
}

export function selfCheckMultiProcessContract(options = {}) {
  const summary = describeMultiProcessJob(options);
  return {
    ok: summary.processGraph.spawnSteps.length === 2
      && summary.processGraph.joinSteps.length === 1
      && summary.clientWorkflow.request.inputs.length === 2
      && summary.persistedState.commands.resume.idempotent === true
      && summary.operationalHealth.retryPlan.commands.retry.idempotent === true
      && summary.operationalHealth.actionableErrors.every((error) => error.action)
      && summary.continuity.permissions.externalWritesAllowed === false
      && summary.previewAcceptance.acceptance.idempotent === true
      && summary.previewAcceptance.nextSteps.length >= 2
      && summary.clientRuntimeAdoption.commands.adopt.idempotent === true
      && summary.clientRuntimeAdoption.routeState.tabs.length >= 3
      && summary.clientSessionHandoff.commands.primary.idempotent === true
      && summary.clientSessionHandoff.session.statusChannel === "status:timeline.write"
      && summary.clientSessionHandoff.runtimeDataContract.statusProjection.length >= 3
      && summary.clientSessionHandoff.submissionGuard.externalWritesAllowed === false
      && summary.clientSessionHandoff.submissionGuard.idempotent === true
      && summary.clientSessionHandoff.submissionGuard.queueAttached === summary.clientSessionHandoff.runtimeDataContract.providerQueue.every((entry) => entry.selectedInClient && entry.queueState === "ready")
      && summary.restartStatusLedger.commands.record.idempotent === true
      && summary.restartStatusLedger.replay.entries.length >= 4
      && summary.restartStatusLedger.validation.sequenceStable === true
      && summary.providerServiceHandoff.negotiation.requiredCapabilities.length >= 2
      && summary.providerServiceHandoff.externalHandoff.queue.length === 2
      && summary.tenantPermissionBoundary.validation.scopeSafe === true
      && summary.tenantPermissionBoundary.permissions.denied.length === 0
      && summary.tenantPermissionBoundary.commands.primary.idempotent === true,
    jobId: summary.jobId,
    checked: ["compile", "spawn", "join", "adapter-handoff", "client-workflow", "persisted-state", "operational-health", "continuity", "preview-acceptance", "client-runtime-adoption", "client-session-handoff", "restart-status-ledger", "provider-service-handoff", "tenant-permission-boundary"],
    blockedReasons: summary.readiness.blockedReasons,
  };
}

export function buildMultiProcessProviderServiceHandoff(
  program = buildMultiProcessProgram(),
  audit = buildMultiProcessAudit(program),
  providerContract = buildProviderServiceContract(program),
  recoveryStatus = buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit)),
  processGraph = buildProcessGraph(program),
  options = {},
) {
  const provider = options.provider ?? "mailchimp";
  const serviceName = options.serviceName ?? "mailchimp-campaign-report-fanout";
  const syncCursor = options.syncCursor
    ?? `${program.job.id}:provider-sync:${providerContract.handoffState.checkpoint ?? "checkpoint"}`;
  const requiredCapabilities = uniqueSorted([
    "mailchimp:campaign.read",
    "mailchimp:report.read",
    "status:timeline.write",
    ...(providerContract.negotiation?.requiredCapabilities ?? []),
    ...(options.requiredProviderCapabilities ?? []),
  ]);
  const grantedCapabilities = new Set(options.grantedProviderCapabilities ?? requiredCapabilities);
  const missingCapabilities = requiredCapabilities
    .filter((capability) => !grantedCapabilities.has(capability));
  const syncMetadata = {
    provider,
    serviceName,
    checkpoint: providerContract.handoffState.checkpoint,
    syncCursor,
    syncMode: options.syncMode ?? "read-through-cache",
    source: "mailchimp.multi-process.provider-service",
    statusEvent: recoveryStatus.statusEvent,
    externalWritesAllowed: false,
    requestedAt: options.providerRequestedAt ?? "logical:5",
  };
  const queue = processGraph.spawnSteps.map((step, index) => {
    const capability = step.verifierHints.source === "mailchimp"
      ? "mailchimp:report.read"
      : "mailchimp:campaign.read";
    const evidenceMissing = audit.evidence.missing.some((subject) => subject.includes(step.command));
    return {
      handoffId: `${syncCursor}:${step.output}`,
      processId: step.output,
      command: step.command,
      provider,
      serviceName,
      capability,
      order: index + 1,
      idempotencyKey: `${program.job.id}:${step.output}:${providerContract.handoffState.checkpoint ?? "checkpoint"}`,
      syncCursor,
      state: evidenceMissing
        ? "waiting_for_evidence"
        : missingCapabilities.includes(capability)
          ? "waiting_for_capability"
          : recoveryStatus.ready
            ? "ready"
            : "waiting_for_recovery",
      visibleLabel: step.command.replace(/^spawn-/, "").replaceAll("-", " "),
    };
  });
  const readyQueue = queue.filter((entry) => entry.state === "ready");
  const validationBlockers = uniqueSorted([
    ...(providerContract.handoffState.ready ? [] : providerContract.handoffState.blockedReasons),
    ...missingCapabilities.map((capability) => `provider capability not granted: ${capability}`),
    ...(recoveryStatus.ready ? [] : ["provider service handoff requires restart-safe recovery status"]),
    ...(queue.length >= 2 ? [] : ["provider service handoff requires both campaign and report reads"]),
    ...(queue.some((entry) => entry.state === "waiting_for_evidence")
      ? ["provider service handoff is waiting for process evidence"]
      : []),
    ...(audit.boundary.externalWritesObserved.length > 0
      ? ["provider service handoff blocks external write contamination"]
      : []),
  ]);
  const ready = validationBlockers.length === 0 && readyQueue.length === queue.length;

  return {
    kind: "mailchimp.multi-process.provider-service-handoff",
    apiVersion: "aios.integration/v1",
    provider,
    service: {
      name: serviceName,
      target: providerContract.service?.target ?? program.manifest.name,
      resource: providerContract.service?.resource ?? "campaign-report-fanout",
      command: ready ? "mailchimp.provider-sync.resume" : "mailchimp.provider-sync.review",
      idempotencyKey: `${syncCursor}:provider-service:${readyQueue.length}:${queue.length}`,
    },
    negotiation: {
      state: ready
        ? "accepted"
        : missingCapabilities.length > 0
          ? "capability_review"
          : "handoff_review",
      requiredCapabilities,
      grantedCapabilities: [...grantedCapabilities].sort(),
      missingCapabilities,
      supportedCapabilities: providerContract.negotiation?.supportedCapabilities ?? [],
    },
    syncMetadata,
    externalHandoff: {
      state: ready ? "ready" : "blocked",
      queue,
      readyCount: readyQueue.length,
      blockedCount: queue.length - readyQueue.length,
      nextAction: ready ? "resume-mailchimp-provider-sync" : "review-mailchimp-provider-sync",
      statusChannel: options.statusChannel ?? "status:timeline.write",
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
    },
    validation: {
      ready,
      blockers: validationBlockers,
      preview: {
        title: "Mailchimp provider sync handoff",
        summary: ready
          ? "Campaign and report read processes are ready for external provider sync."
          : "Mailchimp provider sync requires evidence, capability, or recovery review.",
        queueStates: queue.map((entry) => `${entry.processId}:${entry.state}`),
      },
    },
  };
}

function buildMultiProcessClientWorkflow(program, audit, processGraph, recoveryStatus, options) {
  const requestId = options.requestId ?? `${program.job.id}:client-request:logical:4`;
  const spawnOutputs = new Set(processGraph.spawnSteps.map((step) => step.output));
  const joinedInputs = new Set(processGraph.joinSteps.flatMap((step) => normalizeStepInputs(step.input)));
  const orphanedInputs = [...joinedInputs].filter((input) => !spawnOutputs.has(input));
  const pendingEvidence = audit.evidence.missing.map((subject) => ({
    subject,
    visibleState: "waiting_for_receipt",
  }));
  const processCards = processGraph.spawnSteps.map((step) => ({
    id: step.output,
    title: step.command.replace(/^spawn-/, "").replaceAll("-", " "),
    status: pendingEvidence.some((evidence) => evidence.subject.includes(step.command))
      ? "waiting_for_evidence"
      : "ready",
    command: step.command,
    verifierHints: step.verifierHints,
  }));
  const validationBlockers = uniqueSorted([
    ...(orphanedInputs.length > 0
      ? orphanedInputs.map((input) => `join input has no spawned process: ${input}`)
      : []),
    ...(processCards.length < 2 ? ["client workflow requires at least two read processes"] : []),
    ...(recoveryStatus.ready ? [] : ["joined process recovery status is not ready"]),
  ]);

  return {
    kind: "mailchimp.multi-process.client-workflow",
    apiVersion: "aios.client/v1",
    request: {
      requestId,
      source: "mailchimp-campaign-report-fanout",
      inputs: processGraph.spawnSteps.map((step) => ({
        processId: step.output,
        command: step.command,
        capability: step.verifierHints.source === "mailchimp" ? "mailchimp:report.read" : "mailchimp:campaign.read",
      })),
      join: processGraph.joinSteps.map((step) => ({
        command: step.command,
        requires: step.requires,
        output: step.output,
      })),
    },
    visibleState: {
      title: "Mailchimp read fanout",
      phase: validationBlockers.length === 0 ? "ready_to_handoff" : "needs_attention",
      processCards,
      pendingEvidence,
      primaryAction: validationBlockers.length === 0
        ? "process.joined.resume"
        : "process.joined.review",
    },
    runtimeAdoption: {
      handoffMode: "joined-read-claim",
      restartToken: recoveryStatus.restartToken,
      statusEvent: recoveryStatus.statusEvent,
      canResumeFromClient: validationBlockers.length === 0,
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
    },
  };
}

function buildMultiProcessPersistedState(program, audit, processGraph, clientWorkflow, recoveryStatus, options) {
  const stateKey = options.stateKey
    ?? `${program.job.memory.namespace}:multi-process:${clientWorkflow.request.requestId}`;
  const priorState = options.priorState ?? {};
  const version = Number.isInteger(priorState.version) ? priorState.version + 1 : 1;
  const restoreCursor = priorState.restoreCursor
    ?? `${program.job.id}:multi-process:restore:${version}`;
  const joinedOutputs = new Set(processGraph.joinSteps.map((step) => step.output));
  const processSnapshots = processGraph.spawnSteps.map((step) => ({
    processId: step.output,
    command: step.command,
    status: clientWorkflow.visibleState.processCards.find((card) => card.id === step.output)?.status ?? "unknown",
    persistedAt: audit.evidence.missing.some((subject) => subject.includes(step.command))
      ? null
      : (options.persistedAt ?? "logical:5"),
  }));
  const joinSnapshots = processGraph.joinSteps.map((step) => ({
    joinId: step.output,
    command: step.command,
    requires: step.requires,
    complete: step.requires.every((required) => processSnapshots.some((snapshot) => (
      snapshot.processId === required && snapshot.persistedAt
    ))),
  }));
  const resumeIdempotencyKey = `${stateKey}:resume:${clientWorkflow.request.requestId}`;
  const retryIdempotencyKey = `${stateKey}:retry:${recoveryStatus.restartToken}`;
  const validationBlockers = uniqueSorted([
    ...(processSnapshots.some((snapshot) => !snapshot.persistedAt)
      ? ["cannot persist multi-process state until spawned read evidence is complete"]
      : []),
    ...(joinSnapshots.some((snapshot) => !snapshot.complete)
      ? ["joined process state is incomplete"]
      : []),
    ...(joinedOutputs.has("joinedClaim") ? [] : ["multi-process persisted state requires joinedClaim output"]),
    ...(recoveryStatus.ready ? [] : ["multi-process recovery status is not restart safe"]),
  ]);

  return {
    kind: "mailchimp.multi-process.persisted-state",
    apiVersion: "aios.runtime/v1",
    stateKey,
    version,
    shape: {
      jobId: program.job.id,
      requestId: clientWorkflow.request.requestId,
      memoryNamespace: program.job.memory.namespace,
      restoreCursor,
      processes: processSnapshots,
      joins: joinSnapshots,
      status: validationBlockers.length === 0 ? "restart_safe" : "blocked",
    },
    recoveryPaths: {
      resume: {
        from: restoreCursor,
        command: "process.joined.resume",
        requires: joinSnapshots.flatMap((join) => join.requires),
      },
      retryMissingProcess: {
        from: recoveryStatus.restartToken,
        command: "process.joined.retry-missing",
        retryableProcesses: processSnapshots
          .filter((snapshot) => !snapshot.persistedAt)
          .map((snapshot) => snapshot.processId),
      },
      review: {
        from: stateKey,
        command: "process.joined.review",
        reason: validationBlockers[0] ?? null,
      },
    },
    commands: {
      resume: {
        idempotent: true,
        idempotencyKey: resumeIdempotencyKey,
        command: validationBlockers.length === 0
          ? "process.joined.resume"
          : "process.joined.review",
      },
      retryMissingProcess: {
        idempotent: true,
        idempotencyKey: retryIdempotencyKey,
        command: "process.joined.retry-missing",
      },
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      restartSafe: validationBlockers.length === 0
        && processSnapshots.every((snapshot) => snapshot.persistedAt)
        && joinSnapshots.every((snapshot) => snapshot.complete),
    },
  };
}

function buildMultiProcessOperationalHealth(
  program,
  audit,
  processGraph,
  clientWorkflow,
  persistedState,
  recoveryStatus,
  options,
) {
  const retryAttempt = Number.isInteger(options.retryAttempt) ? options.retryAttempt : 0;
  const retryLimit = program.job.recovery.retry.attempts;
  const baseBackoffSeconds = Number.isInteger(options.baseBackoffSeconds)
    ? options.baseBackoffSeconds
    : 10;
  const missingProcesses = persistedState.shape.processes
    .filter((process) => !process.persistedAt)
    .map((process) => process.processId);
  const incompleteJoins = persistedState.shape.joins
    .filter((join) => !join.complete)
    .map((join) => join.joinId);
  const observedFailures = uniqueSorted([
    ...(audit.status === "failed" ? ["multi-process audit failed"] : []),
    ...audit.evidence.missing.map((subject) => `process evidence missing: ${subject}`),
    ...missingProcesses.map((processId) => `spawned process not persisted: ${processId}`),
    ...incompleteJoins.map((joinId) => `join output incomplete: ${joinId}`),
    ...clientWorkflow.validation.blockers,
    ...persistedState.validation.blockers,
    ...recoveryStatus.blockedReasons,
  ]);
  const retryable = observedFailures.length > 0
    && retryAttempt < retryLimit
    && Boolean(recoveryStatus.restartToken);
  const degraded = observedFailures.length > 0
    && persistedState.shape.processes.some((process) => process.persistedAt);
  const nextBackoffSeconds = Math.min(
    baseBackoffSeconds * (2 ** Math.min(retryAttempt, retryLimit)),
    240,
  );
  const healthStatus = observedFailures.length === 0
    ? "healthy"
    : retryable
      ? "retryable"
      : degraded
        ? "degraded"
        : "failed";
  const actionableErrors = observedFailures.map((message, index) => ({
    id: `${program.job.id}:multi-process:error:${index}`,
    message,
    severity: message.includes("external write") || message.includes("audit failed") ? "critical" : "warning",
    action: retryable ? "process.joined.retry-missing" : "process.joined.review",
    retryAfterSeconds: retryable ? nextBackoffSeconds : null,
  }));
  const validationBlockers = uniqueSorted([
    ...(retryAttempt <= retryLimit ? [] : ["multi-process retry attempt exceeds retry limit"]),
    ...(healthStatus === "failed" ? ["multi-process health has no restart-safe retry path"] : []),
    ...(audit.boundary.externalWritesObserved.length > 0
      ? ["multi-process health blocks external write contamination"]
      : []),
  ]);

  return {
    kind: "mailchimp.multi-process.operational-health",
    apiVersion: "aios.runtime/v1",
    health: {
      status: healthStatus,
      degraded,
      retryable,
      retryAttempt,
      retryLimit,
      failureCount: observedFailures.length,
      processCount: processGraph.spawnSteps.length,
      joinCount: processGraph.joinSteps.length,
      lastStatusEvent: recoveryStatus.statusEvent,
    },
    retryPlan: {
      restartToken: recoveryStatus.restartToken,
      missingProcesses,
      incompleteJoins,
      nextBackoffSeconds: retryable ? nextBackoffSeconds : null,
      commands: {
        retry: {
          idempotent: true,
          idempotencyKey: `${persistedState.stateKey}:health-retry:${retryAttempt}:${recoveryStatus.restartToken}`,
          command: retryable ? "process.joined.retry-missing" : "process.joined.review",
          enabled: retryable,
        },
        degrade: {
          idempotent: true,
          idempotencyKey: `${persistedState.stateKey}:degraded:${clientWorkflow.request.requestId}`,
          command: degraded ? "process.joined.degraded-review" : "process.joined.review",
          enabled: degraded,
        },
      },
    },
    degradedMode: {
      enabled: degraded,
      readableProcesses: persistedState.shape.processes
        .filter((process) => process.persistedAt)
        .map((process) => process.processId),
      blockedProcesses: missingProcesses,
      blockedJoins: incompleteJoins,
      externalWritesAllowed: false,
      visibleMessage: degraded
        ? "Some Mailchimp read processes are available, but joined handoff requires review or retry."
        : "Mailchimp read fanout is healthy or waiting for review.",
    },
    actionableErrors,
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      canHandoff: healthStatus === "healthy" && persistedState.validation.restartSafe,
    },
  };
}

function buildMultiProcessContinuityPacket(
  program,
  audit,
  processGraph,
  clientWorkflow,
  persistedState,
  recoveryStatus,
  options,
) {
  const tenantId = options.tenantId ?? "tenant:local-mailchimp";
  const workspaceId = options.workspaceId ?? "workspace:mailchimp-local";
  const role = options.role ?? "operator";
  const continuityKey = options.continuityKey
    ?? `${program.job.memory.namespace}:multi-process:continuity:${tenantId}:${workspaceId}:${clientWorkflow.request.requestId}`;
  const requiredPermissions = uniqueSorted([
    ...clientWorkflow.request.inputs.map((input) => input.capability),
    "memory:campaign.local",
    "status:timeline.write",
    ...(options.requiredPermissions ?? []),
  ]);
  const grantedPermissions = new Set(options.grantedPermissions ?? requiredPermissions);
  const deniedPermissions = requiredPermissions
    .filter((permission) => !grantedPermissions.has(permission));
  const allowedRoles = new Set(options.allowedRoles ?? ["operator", "auditor", "runtime"]);
  const processIds = processGraph.spawnSteps.map((step) => step.output);
  const joinedOutputs = processGraph.joinSteps.map((step) => step.output);
  const validationBlockers = uniqueSorted([
    ...(tenantId && workspaceId ? [] : ["multi-process continuity requires tenant and workspace scope"]),
    ...(allowedRoles.has(role) ? [] : [`role cannot resume joined process workflow: ${role}`]),
    ...deniedPermissions.map((permission) => `permission not granted for multi-process continuity: ${permission}`),
    ...(persistedState.validation.restartSafe ? [] : ["multi-process continuity requires restart-safe persisted state"]),
    ...(clientWorkflow.runtimeAdoption.canResumeFromClient ? [] : ["client workflow is not ready for joined-process resume"]),
    ...(audit.boundary.externalWritesObserved.length > 0
      ? ["multi-process continuity cannot include external writes"]
      : []),
    ...(processIds.length >= 2 && joinedOutputs.includes("joinedClaim")
      ? []
      : ["multi-process continuity requires at least two spawned reads and joinedClaim output"]),
    ...(recoveryStatus.restartToken ? [] : ["multi-process continuity requires restart token"]),
  ]);

  return {
    kind: "mailchimp.multi-process.continuity-packet",
    apiVersion: "aios.runtime/v1",
    continuityKey,
    scope: {
      tenantId,
      workspaceId,
      role,
      memoryNamespace: program.job.memory.namespace,
      statePrefix: `${program.job.memory.namespace}:multi-process:`,
    },
    permissions: {
      required: requiredPermissions,
      granted: [...grantedPermissions].sort(),
      denied: deniedPermissions,
      externalWritesAllowed: false,
      providerReadsOnly: true,
    },
    replayPlan: {
      restartToken: recoveryStatus.restartToken,
      stateKey: persistedState.stateKey,
      restoreCursor: persistedState.shape.restoreCursor,
      processIds,
      joinedOutputs,
      command: validationBlockers.length === 0
        ? "process.joined.resume"
        : "process.joined.review",
      idempotencyKey: persistedState.commands.resume.idempotencyKey,
    },
    auditHandoff: {
      handoffId: `${continuityKey}:audit`,
      statusEvent: recoveryStatus.statusEvent,
      requestId: clientWorkflow.request.requestId,
      processCount: processIds.length,
      joinCount: joinedOutputs.length,
      decision: validationBlockers.length === 0 ? "allow_resume" : "review_required",
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      tenantIsolated: persistedState.stateKey.startsWith(`${program.job.memory.namespace}:multi-process:`)
        && Boolean(tenantId)
        && Boolean(workspaceId),
    },
  };
}

export function buildMultiProcessTenantPermissionBoundary(
  program = buildMultiProcessProgram(),
  audit = buildMultiProcessAudit(program),
  processGraph = buildProcessGraph(program),
  clientWorkflow,
  persistedState,
  continuity,
  providerServiceHandoff,
  recoveryStatus,
  options = {},
) {
  const fallbackRecoveryStatus = recoveryStatus
    ?? buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit));
  const resolvedClientWorkflow = clientWorkflow
    ?? buildMultiProcessClientWorkflow(program, audit, processGraph, fallbackRecoveryStatus, options);
  const resolvedPersistedState = persistedState
    ?? buildMultiProcessPersistedState(
      program,
      audit,
      processGraph,
      resolvedClientWorkflow,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedContinuity = continuity
    ?? buildMultiProcessContinuityPacket(
      program,
      audit,
      processGraph,
      resolvedClientWorkflow,
      resolvedPersistedState,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedProviderServiceHandoff = providerServiceHandoff
    ?? buildMultiProcessProviderServiceHandoff(
      program,
      audit,
      buildProviderServiceContract(program),
      fallbackRecoveryStatus,
      processGraph,
      options,
    );
  const tenantId = normalizeScopeSegment(resolvedContinuity.scope.tenantId, "tenant:local-mailchimp");
  const workspaceId = normalizeScopeSegment(resolvedContinuity.scope.workspaceId, "workspace:mailchimp-local");
  const role = normalizeScopeSegment(resolvedContinuity.scope.role, "operator");
  const memoryNamespace = program.job.memory.namespace;
  const boundaryId = options.boundaryId
    ?? `${memoryNamespace}:multi-process:boundary:${tenantId}:${workspaceId}:${resolvedClientWorkflow.request.requestId}`;
  const scopeToken = options.scopeToken
    ?? `${boundaryId}:scope:${fallbackRecoveryStatus.restartToken ?? "pending-restart"}`;
  const rolePermissionMatrix = {
    operator: {
      capabilities: [
        "mailchimp:campaign.read",
        "mailchimp:report.read",
        "memory:campaign.local",
        "status:timeline.write",
        "verifier:evidence.record",
      ],
      commands: [
        "mailchimp.provider-sync.resume",
        "process.joined.accept",
        "process.joined.client-adopt",
        "process.joined.client-session.hydrate",
        "process.joined.review",
        "process.joined.resume",
        "process.joined.status-ledger.record",
        "process.joined.status-ledger.replay",
      ],
    },
    runtime: {
      capabilities: [
        "mailchimp:campaign.read",
        "mailchimp:report.read",
        "memory:campaign.local",
        "status:timeline.write",
      ],
      commands: [
        "mailchimp.provider-sync.resume",
        "process.joined.client-session.hydrate",
        "process.joined.review",
        "process.joined.resume",
        "process.joined.status-ledger.record",
        "process.joined.status-ledger.replay",
      ],
    },
    auditor: {
      capabilities: [
        "mailchimp:campaign.read",
        "mailchimp:report.read",
        "status:timeline.write",
        "verifier:evidence.record",
      ],
      commands: [
        "process.joined.review",
        "process.joined.status-ledger.replay",
      ],
    },
    service: {
      capabilities: [
        "mailchimp:campaign.read",
        "mailchimp:report.read",
        "status:timeline.write",
      ],
      commands: [
        "mailchimp.provider-sync.resume",
        "process.joined.review",
      ],
    },
    ...(options.rolePermissionMatrix ?? {}),
  };
  const roleGrant = rolePermissionMatrix[role] ?? { capabilities: [], commands: [] };
  const requiredCapabilities = uniqueSorted([
    ...resolvedClientWorkflow.request.inputs.map((input) => input.capability),
    ...resolvedProviderServiceHandoff.externalHandoff.queue.map((entry) => entry.capability),
    "memory:campaign.local",
    "status:timeline.write",
    ...(options.requiredBoundaryCapabilities ?? []),
  ]);
  const explicitGrantedCapabilities = options.grantedBoundaryCapabilities;
  const grantedCapabilities = uniqueSorted(explicitGrantedCapabilities ?? roleGrant.capabilities);
  const deniedCapabilities = requiredCapabilities
    .filter((capability) => !grantedCapabilities.includes(capability));
  const requiredCommands = uniqueSorted([
    "process.joined.review",
    ...(resolvedPersistedState.validation.restartSafe ? ["process.joined.resume"] : []),
    ...(resolvedProviderServiceHandoff.externalHandoff.state === "ready" ? ["mailchimp.provider-sync.resume"] : []),
    ...(options.requiredBoundaryCommands ?? []),
  ]);
  const grantedCommands = uniqueSorted(options.grantedBoundaryCommands ?? roleGrant.commands);
  const deniedCommands = requiredCommands
    .filter((command) => !grantedCommands.includes(command));
  const observedStateKeys = uniqueSorted([
    resolvedPersistedState.stateKey,
    resolvedPersistedState.shape.restoreCursor,
    resolvedContinuity.continuityKey,
    resolvedContinuity.replayPlan.stateKey,
    resolvedContinuity.replayPlan.restoreCursor,
    resolvedProviderServiceHandoff.syncMetadata.syncCursor,
    ...(options.observedStateKeys ?? []),
  ]);
  const scopedStateKeys = observedStateKeys.map((key) => {
    const scopeState = classifyScopeKey(key, {
      jobId: program.job.id,
      memoryNamespace,
      tenantId,
      workspaceId,
    });

    return {
      key,
      ...scopeState,
    };
  });
  const unsafeStateKeys = scopedStateKeys.filter((entry) => entry.safe !== true);
  const providerQueueScope = resolvedProviderServiceHandoff.externalHandoff.queue.map((entry) => ({
    processId: entry.processId,
    capability: entry.capability,
    state: entry.state,
    scopedToTenant: tenantId,
    scopedToWorkspace: workspaceId,
    externalWritesAllowed: false,
    readBoundary: entry.capability.startsWith("mailchimp:")
      ? "provider-read-only"
      : "runtime-local",
  }));
  const auditSubjects = uniqueSorted([
    ...(audit.evidence.present ?? []).map((entry) => entry.subject),
    ...audit.evidence.missing,
  ]);
  const auditCoverage = {
    requiredSubjects: auditSubjects,
    missingSubjects: audit.evidence.missing,
    evidenceComplete: audit.evidence.missing.length === 0,
    externalWritesObserved: audit.boundary.externalWritesObserved.length,
    handoffReady: fallbackRecoveryStatus.ready,
  };
  const validationBlockers = uniqueSorted([
    ...(tenantId && workspaceId ? [] : ["tenant permission boundary requires tenant and workspace identifiers"]),
    ...(rolePermissionMatrix[role] ? [] : [`tenant permission boundary role is not recognized: ${role}`]),
    ...deniedCapabilities.map((capability) => `tenant boundary capability denied: ${capability}`),
    ...deniedCommands.map((command) => `tenant boundary command denied: ${command}`),
    ...unsafeStateKeys.map((entry) => `tenant boundary rejected state key ${entry.key}: ${entry.reason}`),
    ...(resolvedContinuity.validation.tenantIsolated ? [] : ["tenant boundary requires tenant-isolated continuity"]),
    ...(resolvedPersistedState.validation.restartSafe ? [] : ["tenant boundary requires restart-safe persisted state"]),
    ...(fallbackRecoveryStatus.ready ? [] : ["tenant boundary requires recovery status handoff readiness"]),
    ...(auditCoverage.evidenceComplete ? [] : ["tenant boundary requires complete audit evidence"]),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["tenant boundary blocks observed external writes"]),
    ...(providerQueueScope.every((entry) => entry.readBoundary === "provider-read-only" || entry.readBoundary === "runtime-local")
      ? []
      : ["tenant boundary cannot classify provider queue access"]),
  ]);
  const ready = validationBlockers.length === 0;
  const decisionState = ready
    ? "allow_scoped_resume"
    : deniedCapabilities.length > 0 || deniedCommands.length > 0
      ? "permission_review"
      : unsafeStateKeys.length > 0
        ? "scope_review"
        : "handoff_review";

  return {
    kind: "mailchimp.multi-process.tenant-permission-boundary",
    apiVersion: "aios.runtime/v1",
    boundaryId,
    scope: {
      tenantId,
      workspaceId,
      role,
      memoryNamespace,
      scopeToken,
      statePrefix: `${memoryNamespace}:multi-process:`,
      workspaceStatePrefix: `${memoryNamespace}:multi-process:${tenantId}:${workspaceId}:`,
    },
    permissions: {
      required: requiredCapabilities,
      granted: grantedCapabilities,
      denied: deniedCapabilities,
      requiredCommands,
      grantedCommands,
      deniedCommands,
      roleMatrixVersion: "mailchimp.multi-process.roles/v1",
      externalWritesAllowed: false,
    },
    stateBoundary: {
      observedStateKeys: scopedStateKeys,
      unsafeStateKeys,
      providerQueueScope,
      stateKey: resolvedPersistedState.stateKey,
      restoreCursor: resolvedPersistedState.shape.restoreCursor,
      continuityKey: resolvedContinuity.continuityKey,
      tenantIsolated: unsafeStateKeys.length === 0 && resolvedContinuity.validation.tenantIsolated,
    },
    decision: {
      state: decisionState,
      allowResume: ready,
      allowProviderHandoff: ready && resolvedProviderServiceHandoff.externalHandoff.state === "ready",
      allowAuditExport: ready && auditCoverage.evidenceComplete,
      nextAction: ready ? "resume-scoped-mailchimp-fanout" : "review-tenant-permission-boundary",
    },
    statusHandoff: {
      statusEvent: fallbackRecoveryStatus.statusEvent,
      statusChannel: options.statusChannel ?? "status:timeline.write",
      phase: ready ? "boundary_ready" : "boundary_review",
      message: ready
        ? "Tenant and workspace permissions allow scoped Mailchimp fanout resume."
        : "Tenant, workspace, permission, or audit boundary requires review before resume.",
    },
    auditHandoff: {
      handoffId: `${boundaryId}:audit-handoff`,
      exportSubject: audit.jobId ?? program.job.id,
      scopeToken,
      evidenceComplete: auditCoverage.evidenceComplete,
      externalWritesAllowed: false,
      decision: ready ? "allow_export_and_resume" : "hold_for_boundary_review",
      missingEvidence: auditCoverage.missingSubjects,
      blockedStateKeys: unsafeStateKeys.map((entry) => entry.key),
    },
    commands: {
      primary: {
        idempotent: true,
        idempotencyKey: `${boundaryId}:primary:${decisionState}:${fallbackRecoveryStatus.restartToken}`,
        command: ready ? "process.joined.resume" : "process.joined.boundary-review",
        enabled: ready || validationBlockers.length > 0,
      },
      auditReview: {
        idempotent: true,
        idempotencyKey: `${boundaryId}:audit:${auditCoverage.missingSubjects.length}:${auditCoverage.externalWritesObserved}`,
        command: auditCoverage.evidenceComplete && auditCoverage.externalWritesObserved === 0
          ? "process.joined.audit-handoff"
          : "process.joined.audit-review",
        enabled: true,
      },
      providerResume: {
        idempotent: true,
        idempotencyKey: `${boundaryId}:provider:${resolvedProviderServiceHandoff.externalHandoff.readyCount}:${resolvedProviderServiceHandoff.externalHandoff.blockedCount}`,
        command: ready && resolvedProviderServiceHandoff.externalHandoff.state === "ready"
          ? "mailchimp.provider-sync.resume"
          : "process.joined.boundary-review",
        enabled: ready && resolvedProviderServiceHandoff.externalHandoff.state === "ready",
      },
    },
    validation: {
      ready,
      blockers: validationBlockers,
      scopeSafe: unsafeStateKeys.length === 0,
      permissionsSatisfied: deniedCapabilities.length === 0 && deniedCommands.length === 0,
      auditSafe: auditCoverage.evidenceComplete && auditCoverage.externalWritesObserved === 0,
      recoverySafe: fallbackRecoveryStatus.ready === true,
    },
  };
}

export function buildMultiProcessPreviewAcceptance(
  program = buildMultiProcessProgram(),
  audit = buildMultiProcessAudit(program),
  processGraph = buildProcessGraph(program),
  clientWorkflow = buildMultiProcessClientWorkflow(
    program,
    audit,
    processGraph,
    buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit)),
    {},
  ),
  persistedState = buildMultiProcessPersistedState(
    program,
    audit,
    processGraph,
    clientWorkflow,
    buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit)),
    {},
  ),
  operationalHealth = buildMultiProcessOperationalHealth(
    program,
    audit,
    processGraph,
    clientWorkflow,
    persistedState,
    buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit)),
    {},
  ),
  continuity = buildMultiProcessContinuityPacket(
    program,
    audit,
    processGraph,
    clientWorkflow,
    persistedState,
    buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit)),
    {},
  ),
  providerServiceHandoff = buildMultiProcessProviderServiceHandoff(
    program,
    audit,
    buildProviderServiceContract(program),
    buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit)),
    processGraph,
    {},
  ),
  recoveryStatus = buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit)),
  options = {},
) {
  const accepted = options.previewAccepted === true || options.accepted === true;
  const previewId = options.previewId
    ?? `${program.job.id}:preview:${clientWorkflow.request.requestId}`;
  const acceptanceId = options.acceptanceId
    ?? `${previewId}:accept:${persistedState.version}`;
  const processRows = processGraph.spawnSteps.map((step, index) => {
    const handoffEntry = providerServiceHandoff.externalHandoff.queue
      .find((entry) => entry.processId === step.output);
    const persisted = persistedState.shape.processes
      .find((entry) => entry.processId === step.output);

    return {
      rowId: `${previewId}:process:${index + 1}`,
      processId: step.output,
      label: step.command.replace(/^spawn-/, "").replaceAll("-", " "),
      capability: handoffEntry?.capability
        ?? (step.verifierHints.source === "mailchimp" ? "mailchimp:report.read" : "mailchimp:campaign.read"),
      evidenceState: persisted?.persistedAt ? "recorded" : "waiting_for_receipt",
      providerState: handoffEntry?.state ?? "missing_handoff",
      visibleStatus: persisted?.persistedAt && handoffEntry?.state === "ready" ? "ready" : "needs_review",
    };
  });
  const joinRows = processGraph.joinSteps.map((step, index) => {
    const persistedJoin = persistedState.shape.joins
      .find((entry) => entry.joinId === step.output);

    return {
      rowId: `${previewId}:join:${index + 1}`,
      joinId: step.output,
      label: step.command.replaceAll("-", " "),
      requires: step.requires,
      complete: persistedJoin?.complete === true,
      visibleStatus: persistedJoin?.complete === true ? "ready" : "needs_review",
    };
  });
  const readinessInputs = [
    ["client workflow", clientWorkflow.validation.ready],
    ["persisted state", persistedState.validation.ready],
    ["operational health", operationalHealth.validation.ready],
    ["continuity", continuity.validation.ready],
    ["provider service handoff", providerServiceHandoff.validation.ready],
    ["recovery status", recoveryStatus.ready],
  ];
  const validationBlockers = uniqueSorted([
    ...readinessInputs
      .filter(([, ready]) => ready !== true)
      .map(([name]) => `${name} is not ready for preview acceptance`),
    ...(processRows.some((row) => row.visibleStatus !== "ready")
      ? ["preview contains process rows that need review"]
      : []),
    ...(joinRows.some((row) => row.visibleStatus !== "ready")
      ? ["preview contains joined claim rows that need review"]
      : []),
    ...(audit.boundary.externalWritesObserved.length > 0
      ? ["preview acceptance blocks observed external writes"]
      : []),
  ]);
  const readyForAcceptance = validationBlockers.length === 0;
  const command = readyForAcceptance && accepted
    ? "process.joined.accept"
    : readyForAcceptance
      ? "process.joined.preview"
      : "process.joined.review";

  return {
    kind: "mailchimp.multi-process.preview-acceptance",
    apiVersion: "aios.client/v1",
    preview: {
      previewId,
      title: "Mailchimp fanout preview",
      phase: readyForAcceptance ? "ready_for_acceptance" : "needs_review",
      processRows,
      joinRows,
      validationSummary: {
        totalRows: processRows.length + joinRows.length,
        readyRows: [...processRows, ...joinRows]
          .filter((row) => row.visibleStatus === "ready" || row.complete === true)
          .length,
        blockedRows: [...processRows, ...joinRows]
          .filter((row) => row.visibleStatus === "needs_review")
          .length,
        health: operationalHealth.health.status,
      },
    },
    acceptance: {
      acceptanceId,
      accepted,
      command,
      idempotent: true,
      idempotencyKey: `${persistedState.stateKey}:preview-accept:${acceptanceId}`,
      requiresOperatorAcceptance: readyForAcceptance,
      resumeCommand: accepted && readyForAcceptance ? "process.joined.resume" : "process.joined.review",
      restartToken: recoveryStatus.restartToken,
      handoffToken: accepted && readyForAcceptance
        ? providerServiceHandoff.externalHandoff.handoffToken
        : null,
    },
    nextSteps: [
      {
        action: readyForAcceptance ? "show-preview" : "review-preview-blockers",
        label: readyForAcceptance ? "Show Mailchimp fanout preview" : "Review fanout blockers",
        enabled: true,
      },
      {
        action: "accept-preview",
        label: "Accept joined Mailchimp claim",
        enabled: readyForAcceptance && !accepted,
      },
      {
        action: "resume-runtime",
        label: "Resume joined Mailchimp runtime",
        enabled: readyForAcceptance && accepted,
      },
    ],
    validation: {
      ready: readyForAcceptance && (options.requirePreviewAcceptance !== true || accepted),
      readyForAcceptance,
      blockers: options.requirePreviewAcceptance !== true || accepted
        ? validationBlockers
        : uniqueSorted([...validationBlockers, "operator preview acceptance is required"]),
    },
  };
}

export function buildMultiProcessClientRuntimeAdoption(
  program = buildMultiProcessProgram(),
  audit = buildMultiProcessAudit(program),
  processGraph = buildProcessGraph(program),
  clientWorkflow,
  persistedState,
  operationalHealth,
  continuity,
  previewAcceptance,
  providerServiceHandoff,
  recoveryStatus,
  options = {},
) {
  const fallbackRecoveryStatus = recoveryStatus
    ?? buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit));
  const resolvedClientWorkflow = clientWorkflow
    ?? buildMultiProcessClientWorkflow(program, audit, processGraph, fallbackRecoveryStatus, options);
  const resolvedPersistedState = persistedState
    ?? buildMultiProcessPersistedState(program, audit, processGraph, resolvedClientWorkflow, fallbackRecoveryStatus, options);
  const resolvedOperationalHealth = operationalHealth
    ?? buildMultiProcessOperationalHealth(
      program,
      audit,
      processGraph,
      resolvedClientWorkflow,
      resolvedPersistedState,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedContinuity = continuity
    ?? buildMultiProcessContinuityPacket(
      program,
      audit,
      processGraph,
      resolvedClientWorkflow,
      resolvedPersistedState,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedProviderServiceHandoff = providerServiceHandoff
    ?? buildMultiProcessProviderServiceHandoff(
      program,
      audit,
      buildProviderServiceContract(program),
      fallbackRecoveryStatus,
      processGraph,
      options,
    );
  const resolvedPreviewAcceptance = previewAcceptance
    ?? buildMultiProcessPreviewAcceptance(
      program,
      audit,
      processGraph,
      resolvedClientWorkflow,
      resolvedPersistedState,
      resolvedOperationalHealth,
      resolvedContinuity,
      resolvedProviderServiceHandoff,
      fallbackRecoveryStatus,
      options,
    );
  const routeId = options.routeId ?? "mailchimp.multi-process.joined-claim";
  const adoptionKey = options.clientAdoptionKey
    ?? `${program.job.memory.namespace}:multi-process:client-adoption:${resolvedClientWorkflow.request.requestId}`;
  const processRows = resolvedPreviewAcceptance.preview.processRows.map((row) => ({
    id: `${adoptionKey}:process:${row.processId}`,
    processId: row.processId,
    label: row.label,
    capability: row.capability,
    providerState: row.providerState,
    evidenceState: row.evidenceState,
    selected: row.visibleStatus === "ready",
    disabledReason: row.visibleStatus === "ready" ? null : "process row requires review before adoption",
  }));
  const joinRows = resolvedPreviewAcceptance.preview.joinRows.map((row) => ({
    id: `${adoptionKey}:join:${row.joinId}`,
    joinId: row.joinId,
    label: row.label,
    requires: row.requires,
    selected: row.complete === true,
    disabledReason: row.complete === true ? null : "joined claim row requires review before adoption",
  }));
  const selectedProcessIds = processRows
    .filter((row) => row.selected)
    .map((row) => row.processId);
  const pendingProcessIds = processRows
    .filter((row) => !row.selected)
    .map((row) => row.processId);
  const readyForClient = resolvedClientWorkflow.validation.ready
    && resolvedPersistedState.validation.restartSafe
    && resolvedContinuity.validation.ready
    && resolvedPreviewAcceptance.validation.readyForAcceptance
    && resolvedProviderServiceHandoff.externalHandoff.state === "ready";
  const adopted = options.clientAdopted === true || (
    options.accepted === true && options.requireClientAdoption !== true
  );
  const validationBlockers = uniqueSorted([
    ...(resolvedClientWorkflow.validation.ready ? [] : resolvedClientWorkflow.validation.blockers),
    ...(resolvedPersistedState.validation.restartSafe ? [] : ["client adoption requires restart-safe multi-process state"]),
    ...(resolvedOperationalHealth.validation.canHandoff ? [] : ["client adoption requires healthy joined process handoff"]),
    ...(resolvedContinuity.validation.ready ? [] : resolvedContinuity.validation.blockers),
    ...(resolvedPreviewAcceptance.validation.readyForAcceptance ? [] : ["client adoption requires preview acceptance readiness"]),
    ...(resolvedProviderServiceHandoff.externalHandoff.state === "ready"
      ? []
      : ["client adoption requires ready provider service handoff"]),
    ...(pendingProcessIds.length === 0
      ? []
      : pendingProcessIds.map((processId) => `client adoption blocked by process row: ${processId}`)),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["client adoption blocks observed external writes"]),
    ...(options.requireClientAdoption === true && !adopted
      ? ["client adoption decision is required"]
      : []),
  ]);
  const ready = validationBlockers.length === 0 && readyForClient;
  const commandBase = `${adoptionKey}:${resolvedPersistedState.version}`;

  return {
    kind: "mailchimp.multi-process.client-runtime-adoption",
    apiVersion: "aios.client/v1",
    adoptionKey,
    routeState: {
      routeId,
      requestId: resolvedClientWorkflow.request.requestId,
      tabs: [
        {
          id: "processes",
          label: "Processes",
          badge: `${selectedProcessIds.length}/${processRows.length}`,
          status: pendingProcessIds.length === 0 ? "ready" : "needs_review",
        },
        {
          id: "joined-claim",
          label: "Joined claim",
          badge: `${joinRows.filter((row) => row.selected).length}/${joinRows.length}`,
          status: joinRows.every((row) => row.selected) ? "ready" : "needs_review",
        },
        {
          id: "handoff",
          label: "Handoff",
          badge: resolvedOperationalHealth.health.status,
          status: readyForClient ? "ready" : "blocked",
        },
      ],
      selectedProcessIds,
      pendingProcessIds,
      primaryAction: ready
        ? "process.joined.resume"
        : readyForClient
          ? "process.joined.client-adopt"
          : "process.joined.review",
    },
    visibleState: {
      title: resolvedClientWorkflow.visibleState.title,
      phase: ready
        ? "ready_to_resume"
        : readyForClient
          ? "ready_for_client_adoption"
          : "review_required",
      summary: ready
        ? "Joined Mailchimp reads are adopted by the client runtime and ready to resume."
        : readyForClient
          ? "Joined Mailchimp reads are ready for client adoption before runtime resume."
          : "Joined Mailchimp reads require evidence, health, provider, or continuity review.",
      processRows,
      joinRows,
      health: resolvedOperationalHealth.health,
      providerQueue: resolvedProviderServiceHandoff.externalHandoff.queue,
    },
    runtimeDataContract: {
      request: resolvedClientWorkflow.request,
      restartToken: fallbackRecoveryStatus.restartToken,
      statusEvent: fallbackRecoveryStatus.statusEvent,
      stateKey: resolvedPersistedState.stateKey,
      restoreCursor: resolvedPersistedState.shape.restoreCursor,
      continuityKey: resolvedContinuity.continuityKey,
      previewId: resolvedPreviewAcceptance.preview.previewId,
      acceptanceId: resolvedPreviewAcceptance.acceptance.acceptanceId,
      providerHandoffToken: ready
        ? resolvedProviderServiceHandoff.externalHandoff.handoffToken
        : null,
      payload: {
        processIds: selectedProcessIds,
        joinedOutputs: resolvedContinuity.replayPlan.joinedOutputs,
        healthStatus: resolvedOperationalHealth.health.status,
        externalWritesAllowed: false,
      },
    },
    commands: {
      adopt: {
        idempotent: true,
        idempotencyKey: `${commandBase}:adopt:${resolvedPreviewAcceptance.acceptance.acceptanceId}`,
        command: readyForClient ? "process.joined.client-adopt" : "process.joined.review",
        enabled: readyForClient && !adopted,
      },
      resume: {
        idempotent: true,
        idempotencyKey: `${commandBase}:resume:${fallbackRecoveryStatus.restartToken}`,
        command: ready ? "process.joined.resume" : "process.joined.review",
        enabled: ready,
      },
      review: {
        idempotent: true,
        idempotencyKey: `${commandBase}:review:${routeId}`,
        command: "process.joined.review",
        enabled: true,
      },
    },
    validation: {
      ready,
      readyForClient,
      adopted,
      blockers: validationBlockers,
      summary: ready
        ? "Client runtime adopted the joined Mailchimp process contract and can resume from persisted state."
        : "Client runtime adoption requires review, adoption, or provider handoff readiness.",
    },
  };
}

export function buildMultiProcessClientSessionHandoff(
  program = buildMultiProcessProgram(),
  audit = buildMultiProcessAudit(program),
  processGraph = buildProcessGraph(program),
  clientWorkflow,
  persistedState,
  operationalHealth,
  continuity,
  previewAcceptance,
  clientRuntimeAdoption,
  providerServiceHandoff,
  recoveryStatus,
  options = {},
) {
  const fallbackRecoveryStatus = recoveryStatus
    ?? buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit));
  const resolvedClientWorkflow = clientWorkflow
    ?? buildMultiProcessClientWorkflow(program, audit, processGraph, fallbackRecoveryStatus, options);
  const resolvedPersistedState = persistedState
    ?? buildMultiProcessPersistedState(program, audit, processGraph, resolvedClientWorkflow, fallbackRecoveryStatus, options);
  const resolvedOperationalHealth = operationalHealth
    ?? buildMultiProcessOperationalHealth(
      program,
      audit,
      processGraph,
      resolvedClientWorkflow,
      resolvedPersistedState,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedContinuity = continuity
    ?? buildMultiProcessContinuityPacket(
      program,
      audit,
      processGraph,
      resolvedClientWorkflow,
      resolvedPersistedState,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedProviderServiceHandoff = providerServiceHandoff
    ?? buildMultiProcessProviderServiceHandoff(
      program,
      audit,
      buildProviderServiceContract(program),
      fallbackRecoveryStatus,
      processGraph,
      options,
    );
  const resolvedPreviewAcceptance = previewAcceptance
    ?? buildMultiProcessPreviewAcceptance(
      program,
      audit,
      processGraph,
      resolvedClientWorkflow,
      resolvedPersistedState,
      resolvedOperationalHealth,
      resolvedContinuity,
      resolvedProviderServiceHandoff,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedClientRuntimeAdoption = clientRuntimeAdoption
    ?? buildMultiProcessClientRuntimeAdoption(
      program,
      audit,
      processGraph,
      resolvedClientWorkflow,
      resolvedPersistedState,
      resolvedOperationalHealth,
      resolvedContinuity,
      resolvedPreviewAcceptance,
      resolvedProviderServiceHandoff,
      fallbackRecoveryStatus,
      options,
    );
  const sessionId = options.clientSessionId
    ?? `${program.job.memory.namespace}:multi-process:client-session:${resolvedClientWorkflow.request.requestId}`;
  const statusChannel = options.statusChannel ?? "status:timeline.write";
  const hydrated = options.clientSessionHydrated === true || options.hydrated === true;
  const visibleRoute = options.visibleRoute ?? resolvedClientRuntimeAdoption.routeState.routeId;
  const processStatusById = new Map(
    resolvedClientRuntimeAdoption.visibleState.processRows.map((row) => [
      row.processId,
      {
        selected: row.selected,
        providerState: row.providerState,
        evidenceState: row.evidenceState,
        disabledReason: row.disabledReason,
      },
    ]),
  );
  const providerQueue = resolvedProviderServiceHandoff.externalHandoff.queue.map((entry) => {
    const processStatus = processStatusById.get(entry.processId);

    return {
      handoffId: entry.handoffId,
      processId: entry.processId,
      capability: entry.capability,
      queueState: entry.state,
      selectedInClient: processStatus?.selected === true,
      evidenceState: processStatus?.evidenceState ?? "unknown",
      disabledReason: processStatus?.disabledReason ?? null,
      command: entry.state === "ready" && processStatus?.selected === true
        ? "process.joined.queue-attach"
        : "process.joined.review",
    };
  });
  const statusProjection = [
    {
      id: `${sessionId}:status:request`,
      channel: statusChannel,
      phase: resolvedClientWorkflow.visibleState.phase,
      message: resolvedClientWorkflow.visibleState.primaryAction,
      source: "client-workflow",
    },
    {
      id: `${sessionId}:status:preview`,
      channel: statusChannel,
      phase: resolvedPreviewAcceptance.preview.phase,
      message: resolvedPreviewAcceptance.acceptance.command,
      source: "preview-acceptance",
    },
    {
      id: `${sessionId}:status:adoption`,
      channel: statusChannel,
      phase: resolvedClientRuntimeAdoption.visibleState.phase,
      message: resolvedClientRuntimeAdoption.routeState.primaryAction,
      source: "client-runtime-adoption",
    },
    {
      id: `${sessionId}:status:provider`,
      channel: statusChannel,
      phase: resolvedProviderServiceHandoff.externalHandoff.state,
      message: resolvedProviderServiceHandoff.externalHandoff.nextAction,
      source: "provider-service-handoff",
    },
  ];
  const pendingInteractions = uniqueSorted([
    ...resolvedClientRuntimeAdoption.routeState.pendingProcessIds
      .map((processId) => `review process row: ${processId}`),
    ...providerQueue
      .filter((entry) => entry.queueState !== "ready")
      .map((entry) => `review provider queue: ${entry.processId}`),
    ...(resolvedPreviewAcceptance.validation.readyForAcceptance ? [] : ["review preview acceptance blockers"]),
    ...(resolvedOperationalHealth.health.status === "healthy" ? [] : ["review operational health status"]),
  ]);
  const routeCheckpoints = resolvedClientRuntimeAdoption.routeState.tabs.map((tab) => ({
    checkpointId: `${sessionId}:route:${tab.id}`,
    routeId: visibleRoute,
    tabId: tab.id,
    label: tab.label,
    status: tab.status,
    badge: tab.badge,
    restoreCursor: resolvedPersistedState.shape.restoreCursor,
    restartToken: fallbackRecoveryStatus.restartToken,
  }));
  const requireSessionHydration = options.requireClientSessionHydration === true;
  const validationBlockers = uniqueSorted([
    ...(resolvedClientRuntimeAdoption.validation.readyForClient
      ? []
      : ["client session requires adoption-ready runtime data contract"]),
    ...(resolvedPersistedState.validation.restartSafe
      ? []
      : ["client session requires restart-safe persisted state"]),
    ...(resolvedProviderServiceHandoff.externalHandoff.state === "ready"
      ? []
      : ["client session requires ready provider handoff queue"]),
    ...(resolvedOperationalHealth.validation.canHandoff
      ? []
      : ["client session requires healthy operational handoff"]),
    ...(providerQueue.every((entry) => entry.selectedInClient && entry.queueState === "ready")
      ? []
      : ["client session provider queue is not fully attached to selected rows"]),
    ...(resolvedContinuity.validation.tenantIsolated
      ? []
      : ["client session requires tenant-isolated continuity state"]),
    ...(statusProjection.every((event) => event.channel === statusChannel && event.message)
      ? []
      : ["client session status projection is incomplete"]),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["client session blocks observed external writes"]),
    ...(requireSessionHydration && !hydrated
      ? ["client session hydration is required before runtime resume"]
      : []),
  ]);
  const readyForResume = validationBlockers.length === 0
    && resolvedClientRuntimeAdoption.validation.readyForClient
    && resolvedOperationalHealth.validation.canHandoff;
  const phase = readyForResume && hydrated
    ? "hydrated_ready_to_resume"
    : readyForResume
      ? "ready_for_session_hydration"
      : "review_required";
  const primaryCommand = readyForResume && hydrated
    ? "process.joined.resume"
    : readyForResume
      ? "process.joined.client-session.hydrate"
      : "process.joined.review";
  const commandBase = `${sessionId}:${resolvedPersistedState.version}`;
  const sessionCommandState = normalizeClientSessionCommandState(options.clientSessionCommandState, {
    requestId: resolvedClientWorkflow.request.requestId,
    routeId: visibleRoute,
    statusChannel,
  });
  const queueAttached = providerQueue.every((entry) => entry.selectedInClient && entry.queueState === "ready");
  const replaySafe = sessionCommandState.replayOf === null
    || sessionCommandState.lastIdempotencyKey === `${commandBase}:primary:${fallbackRecoveryStatus.restartToken}`;
  const submissionBlockers = uniqueSorted([
    ...validationBlockers,
    ...sessionCommandState.blockedReasons,
    ...(sessionCommandState.requestId === resolvedClientWorkflow.request.requestId
      ? []
      : ["client session command request id does not match workflow request"]),
    ...(sessionCommandState.routeId === visibleRoute
      ? []
      : ["client session command route id does not match visible route"]),
    ...(sessionCommandState.statusChannel === statusChannel
      ? []
      : ["client session command status channel does not match handoff channel"]),
    ...(queueAttached ? [] : ["client session command requires attached provider queue"]),
    ...(fallbackRecoveryStatus.restartToken ? [] : ["client session command requires restart token"]),
    ...(resolvedPersistedState.validation.restartSafe ? [] : ["client session command requires restart-safe persisted state"]),
    ...(resolvedProviderServiceHandoff.externalHandoff.handoffToken || !readyForResume
      ? []
      : ["client session command requires provider handoff token before resume"]),
    ...(replaySafe ? [] : ["client session command replay idempotency key does not match current primary command"]),
  ]);
  const submissionDecision = submissionBlockers.length === 0 && readyForResume && hydrated
    ? "submit_resume"
    : submissionBlockers.length === 0 && readyForResume
      ? "submit_hydration"
      : sessionCommandState.replayOf
        ? "replay_status"
        : resolvedOperationalHealth.health.retryable
          ? "retry_missing_process"
          : "review_session";
  const submissionCommand = submissionDecision === "submit_resume"
    ? "process.joined.resume"
    : submissionDecision === "submit_hydration"
      ? "process.joined.client-session.hydrate"
      : submissionDecision === "replay_status"
        ? "process.joined.status-ledger.replay"
        : submissionDecision === "retry_missing_process"
          ? resolvedOperationalHealth.retryPlan.commands.retry.command
          : "process.joined.review";

  return {
    kind: "mailchimp.multi-process.client-session-handoff",
    apiVersion: "aios.client/v1",
    session: {
      sessionId,
      requestId: resolvedClientWorkflow.request.requestId,
      routeId: visibleRoute,
      phase,
      hydrated,
      statusChannel,
      stateKey: resolvedPersistedState.stateKey,
      continuityKey: resolvedContinuity.continuityKey,
      adoptionKey: resolvedClientRuntimeAdoption.adoptionKey,
    },
    routeCheckpoints,
    runtimeDataContract: {
      request: resolvedClientWorkflow.request,
      visibleState: resolvedClientRuntimeAdoption.visibleState,
      providerQueue,
      statusProjection,
      restartToken: fallbackRecoveryStatus.restartToken,
      restoreCursor: resolvedPersistedState.shape.restoreCursor,
      handoffToken: readyForResume && hydrated
        ? resolvedProviderServiceHandoff.externalHandoff.handoffToken
        : null,
      payload: {
        processIds: resolvedClientRuntimeAdoption.runtimeDataContract.payload.processIds,
        joinedOutputs: resolvedClientRuntimeAdoption.runtimeDataContract.payload.joinedOutputs,
        routeCheckpoints: routeCheckpoints.map((checkpoint) => checkpoint.checkpointId),
        pendingInteractions,
        externalWritesAllowed: false,
      },
    },
    commands: {
      primary: {
        idempotent: true,
        idempotencyKey: `${commandBase}:primary:${fallbackRecoveryStatus.restartToken}`,
        command: primaryCommand,
        enabled: readyForResume || validationBlockers.length > 0,
      },
      hydrate: {
        idempotent: true,
        idempotencyKey: `${commandBase}:hydrate:${resolvedClientRuntimeAdoption.adoptionKey}`,
        command: readyForResume ? "process.joined.client-session.hydrate" : "process.joined.review",
        enabled: readyForResume && !hydrated,
      },
      resume: {
        idempotent: true,
        idempotencyKey: `${commandBase}:resume:${fallbackRecoveryStatus.restartToken}`,
        command: readyForResume && hydrated ? "process.joined.resume" : "process.joined.review",
        enabled: readyForResume && hydrated,
      },
    },
    submissionGuard: {
      kind: "mailchimp.multi-process.client-session-submission-guard",
      apiVersion: "aios.client/v1",
      decision: submissionDecision,
      command: submissionCommand,
      idempotent: true,
      idempotencyKey: `${commandBase}:submission:${submissionDecision}:${submissionCommand}`,
      enabled: submissionBlockers.length === 0 || submissionDecision === "replay_status",
      externalWritesAllowed: false,
      replaySafe,
      queueAttached,
      hydrated,
      request: {
        requestId: sessionCommandState.requestId,
        routeId: sessionCommandState.routeId,
        statusChannel: sessionCommandState.statusChannel,
        lastSeenSequence: sessionCommandState.lastSeenSequence,
      },
      providerQueue: providerQueue.map((entry) => ({
        processId: entry.processId,
        queueState: entry.queueState,
        selectedInClient: entry.selectedInClient,
        command: entry.command,
      })),
      restart: {
        restartToken: fallbackRecoveryStatus.restartToken,
        stateKey: resolvedPersistedState.stateKey,
        restoreCursor: resolvedPersistedState.shape.restoreCursor,
        primaryIdempotencyKey: `${commandBase}:primary:${fallbackRecoveryStatus.restartToken}`,
        lastIdempotencyKey: sessionCommandState.lastIdempotencyKey,
      },
      userVisibleStatus: {
        phase: submissionDecision,
        primaryAction: submissionCommand,
        message: submissionBlockers[0]
          ?? (submissionDecision === "submit_resume"
            ? "Joined Mailchimp process session can resume from the hydrated client route."
            : "Joined Mailchimp process session requires hydration, replay, retry, or review."),
      },
      blockedReasons: submissionBlockers,
    },
    validation: {
      ready: readyForResume && (hydrated || !requireSessionHydration),
      readyForResume,
      hydrated,
      blockers: validationBlockers,
      pendingInteractions,
      submissionGuardReady: submissionBlockers.length === 0,
      summary: readyForResume
        ? "Client session has deterministic request, route, provider queue, and status handoff state."
        : "Client session handoff requires route, provider, health, or persisted-state review.",
    },
  };
}

export function buildMultiProcessRestartStatusLedger(
  program = buildMultiProcessProgram(),
  audit = buildMultiProcessAudit(program),
  persistedState,
  operationalHealth,
  continuity,
  providerServiceHandoff,
  clientSessionHandoff,
  recoveryStatus,
  options = {},
) {
  const fallbackRecoveryStatus = recoveryStatus
    ?? buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit));
  const processGraph = buildProcessGraph(program);
  const fallbackClientWorkflow = buildMultiProcessClientWorkflow(
    program,
    audit,
    processGraph,
    fallbackRecoveryStatus,
    options,
  );
  const resolvedPersistedState = persistedState
    ?? buildMultiProcessPersistedState(
      program,
      audit,
      processGraph,
      fallbackClientWorkflow,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedOperationalHealth = operationalHealth
    ?? buildMultiProcessOperationalHealth(
      program,
      audit,
      processGraph,
      fallbackClientWorkflow,
      resolvedPersistedState,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedContinuity = continuity
    ?? buildMultiProcessContinuityPacket(
      program,
      audit,
      processGraph,
      fallbackClientWorkflow,
      resolvedPersistedState,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedProviderServiceHandoff = providerServiceHandoff
    ?? buildMultiProcessProviderServiceHandoff(
      program,
      audit,
      buildProviderServiceContract(program),
      fallbackRecoveryStatus,
      processGraph,
      options,
    );
  const resolvedClientSessionHandoff = clientSessionHandoff
    ?? buildMultiProcessClientSessionHandoff(
      program,
      audit,
      processGraph,
      fallbackClientWorkflow,
      resolvedPersistedState,
      resolvedOperationalHealth,
      resolvedContinuity,
      undefined,
      undefined,
      resolvedProviderServiceHandoff,
      fallbackRecoveryStatus,
      options,
    );
  const ledgerKey = options.restartLedgerKey
    ?? `${program.job.memory.namespace}:multi-process:restart-ledger:${fallbackClientWorkflow.request.requestId}`;
  const ledgerEpoch = options.restartLedgerEpoch ?? resolvedPersistedState.version;
  const priorEntries = normalizeLedgerEntries(options.priorRestartLedger?.entries);
  const baseRecord = {
    ledgerKey,
    epoch: ledgerEpoch,
    stateKey: resolvedPersistedState.stateKey,
    restoreCursor: resolvedPersistedState.shape.restoreCursor,
    restartToken: fallbackRecoveryStatus.restartToken,
    statusChannel: resolvedClientSessionHandoff.session.statusChannel,
  };
  const derivedEntries = [
    {
      phase: "persisted-state",
      status: resolvedPersistedState.validation.restartSafe ? "restart_safe" : "blocked",
      source: resolvedPersistedState.kind,
      command: resolvedPersistedState.commands.resume.command,
      idempotencyKey: resolvedPersistedState.commands.resume.idempotencyKey,
      detail: resolvedPersistedState.shape.status,
    },
    {
      phase: "operational-health",
      status: resolvedOperationalHealth.validation.canHandoff ? "healthy" : resolvedOperationalHealth.health.status,
      source: resolvedOperationalHealth.kind,
      command: resolvedOperationalHealth.retryPlan.commands.retry.command,
      idempotencyKey: resolvedOperationalHealth.retryPlan.commands.retry.idempotencyKey,
      detail: `${resolvedOperationalHealth.health.failureCount} failure(s)`,
    },
    {
      phase: "provider-handoff",
      status: resolvedProviderServiceHandoff.externalHandoff.state,
      source: resolvedProviderServiceHandoff.kind,
      command: resolvedProviderServiceHandoff.service.command,
      idempotencyKey: resolvedProviderServiceHandoff.service.idempotencyKey,
      detail: `${resolvedProviderServiceHandoff.externalHandoff.readyCount}/${resolvedProviderServiceHandoff.externalHandoff.queue.length} ready`,
    },
    {
      phase: "client-session",
      status: resolvedClientSessionHandoff.validation.readyForResume ? "resume_ready" : resolvedClientSessionHandoff.session.phase,
      source: resolvedClientSessionHandoff.kind,
      command: resolvedClientSessionHandoff.commands.primary.command,
      idempotencyKey: resolvedClientSessionHandoff.commands.primary.idempotencyKey,
      detail: resolvedClientSessionHandoff.session.phase,
    },
  ];
  const replayEntries = mergeLedgerEntries(priorEntries, derivedEntries, baseRecord);
  const duplicateKeys = findDuplicateValues(replayEntries.map((entry) => entry.idempotencyKey));
  const sequenceStable = replayEntries.every((entry, index) => entry.sequence === index + 1);
  const finalEntry = replayEntries.at(-1);
  const readyForResume = resolvedPersistedState.validation.restartSafe
    && resolvedOperationalHealth.validation.canHandoff
    && resolvedProviderServiceHandoff.externalHandoff.state === "ready"
    && resolvedClientSessionHandoff.validation.readyForResume;
  const finalStatus = readyForResume
    ? "resume_ready"
    : resolvedOperationalHealth.health.retryable
      ? "retryable"
      : "review_required";
  const validationBlockers = uniqueSorted([
    ...(resolvedPersistedState.validation.restartSafe ? [] : ["restart ledger requires restart-safe persisted state"]),
    ...(resolvedOperationalHealth.validation.canHandoff ? [] : ["restart ledger requires healthy operational handoff"]),
    ...(resolvedProviderServiceHandoff.externalHandoff.state === "ready" ? [] : ["restart ledger requires ready provider handoff"]),
    ...(resolvedClientSessionHandoff.validation.readyForResume ? [] : ["restart ledger requires resume-ready client session"]),
    ...(fallbackRecoveryStatus.restartToken ? [] : ["restart ledger requires recovery restart token"]),
    ...(sequenceStable ? [] : ["restart ledger sequence is not stable"]),
    ...duplicateKeys.map((key) => `restart ledger duplicate idempotency key: ${key}`),
    ...(audit.boundary.externalWritesObserved.length === 0 ? [] : ["restart ledger blocks observed external writes"]),
  ]);

  return {
    kind: "mailchimp.multi-process.restart-status-ledger",
    apiVersion: "aios.runtime/v1",
    ledgerKey,
    scope: {
      tenantId: resolvedContinuity.scope.tenantId,
      workspaceId: resolvedContinuity.scope.workspaceId,
      memoryNamespace: program.job.memory.namespace,
      requestId: fallbackClientWorkflow.request.requestId,
    },
    status: {
      finalStatus,
      lastPhase: finalEntry?.phase ?? null,
      lastCommand: finalEntry?.command ?? null,
      statusChannel: resolvedClientSessionHandoff.session.statusChannel,
      restartSafe: validationBlockers.length === 0,
    },
    replay: {
      cursor: `${ledgerKey}:epoch:${ledgerEpoch}:entries:${replayEntries.length}`,
      epoch: ledgerEpoch,
      entries: replayEntries,
      priorEntryCount: priorEntries.length,
      derivedEntryCount: derivedEntries.length,
    },
    recoveryPaths: {
      resume: {
        command: readyForResume ? "process.joined.resume" : "process.joined.review",
        from: resolvedPersistedState.shape.restoreCursor,
        idempotencyKey: `${ledgerKey}:resume:${fallbackRecoveryStatus.restartToken}`,
      },
      replayStatus: {
        command: "process.joined.status-ledger.replay",
        from: ledgerKey,
        idempotencyKey: `${ledgerKey}:replay:${ledgerEpoch}:${replayEntries.length}`,
      },
      repair: {
        command: resolvedOperationalHealth.health.retryable
          ? "process.joined.retry-missing"
          : "process.joined.review",
        from: fallbackRecoveryStatus.restartToken,
        idempotencyKey: `${ledgerKey}:repair:${resolvedOperationalHealth.health.retryAttempt}`,
      },
    },
    commands: {
      record: {
        idempotent: true,
        idempotencyKey: `${ledgerKey}:record:${ledgerEpoch}:${finalStatus}`,
        command: validationBlockers.length === 0
          ? "process.joined.status-ledger.record"
          : "process.joined.status-ledger.review",
        enabled: true,
      },
      replay: {
        idempotent: true,
        idempotencyKey: `${ledgerKey}:replay:${ledgerEpoch}:${fallbackRecoveryStatus.restartToken}`,
        command: "process.joined.status-ledger.replay",
        enabled: replayEntries.length > 0,
      },
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      sequenceStable,
      duplicateIdempotencyKeys: duplicateKeys,
      restartSafeStatus: finalStatus === "resume_ready" && validationBlockers.length === 0,
    },
  };
}

function normalizeStepInputs(input) {
  if (Array.isArray(input)) {
    return input.flatMap((value) => normalizeStepInputs(value));
  }

  return String(input ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeLedgerEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => ({
      sequence: Number.isInteger(entry.sequence) && entry.sequence > 0
        ? entry.sequence
        : index + 1,
      phase: String(entry.phase ?? "unknown"),
      status: String(entry.status ?? "unknown"),
      source: String(entry.source ?? "prior-ledger"),
      command: String(entry.command ?? "process.joined.status-ledger.replay"),
      idempotencyKey: String(entry.idempotencyKey ?? `prior-ledger:${index + 1}`),
      ledgerKey: entry.ledgerKey ? String(entry.ledgerKey) : undefined,
      epoch: Number.isInteger(entry.epoch) ? entry.epoch : undefined,
      stateKey: entry.stateKey ? String(entry.stateKey) : undefined,
      restoreCursor: entry.restoreCursor ? String(entry.restoreCursor) : undefined,
      restartToken: entry.restartToken ? String(entry.restartToken) : undefined,
      statusChannel: entry.statusChannel ? String(entry.statusChannel) : undefined,
      detail: entry.detail ? String(entry.detail) : null,
      replayed: entry.replayed === true,
    }));
}

function normalizeClientSessionCommandState(state = {}, defaults = {}) {
  const requestId = String(state.requestId ?? defaults.requestId ?? "").trim();
  const routeId = String(state.routeId ?? defaults.routeId ?? "").trim();
  const statusChannel = String(state.statusChannel ?? defaults.statusChannel ?? "").trim();
  const lastSeenSequence = Number(state.lastSeenSequence ?? state.sequence ?? 0);
  const lastIdempotencyKey = state.lastIdempotencyKey ? String(state.lastIdempotencyKey) : null;
  const replayOf = state.replayOf ? String(state.replayOf) : null;
  const online = state.online !== false;
  const blockedReasons = uniqueSorted([
    ...(requestId ? [] : ["client session command state requires request id"]),
    ...(routeId ? [] : ["client session command state requires route id"]),
    ...(statusChannel ? [] : ["client session command state requires status channel"]),
    ...(Number.isInteger(lastSeenSequence) && lastSeenSequence >= 0
      ? []
      : ["client session command state lastSeenSequence must be a non-negative integer"]),
    ...(online ? [] : ["client session command state is offline"]),
    ...(replayOf && !lastIdempotencyKey
      ? ["client session command replay requires last idempotency key"]
      : []),
  ]);

  return {
    valid: blockedReasons.length === 0,
    requestId,
    routeId,
    statusChannel,
    lastSeenSequence: Number.isInteger(lastSeenSequence) && lastSeenSequence >= 0 ? lastSeenSequence : 0,
    lastIdempotencyKey,
    replayOf,
    online,
    blockedReasons,
  };
}

function mergeLedgerEntries(priorEntries, derivedEntries, baseRecord) {
  const byIdempotencyKey = new Map();
  for (const entry of priorEntries) {
    byIdempotencyKey.set(entry.idempotencyKey, {
      ...baseRecord,
      ...entry,
      replayed: true,
    });
  }

  for (const entry of derivedEntries) {
    byIdempotencyKey.set(entry.idempotencyKey, {
      ...baseRecord,
      ...entry,
      replayed: false,
    });
  }

  return [...byIdempotencyKey.values()]
    .sort((left, right) => {
      const sequenceDelta = (left.sequence ?? 0) - (right.sequence ?? 0);
      return sequenceDelta === 0
        ? left.idempotencyKey.localeCompare(right.idempotencyKey)
        : sequenceDelta;
    })
    .map((entry, index) => ({
      ...entry,
      sequence: index + 1,
      committed: entry.status === "restart_safe"
        || entry.status === "healthy"
        || entry.status === "ready"
        || entry.status === "resume_ready",
    }));
}

function findDuplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();

  for (const value of values.filter(Boolean).map(String)) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }

  return [...duplicates].sort();
}

function normalizeScopeSegment(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function classifyScopeKey(key, scope) {
  const normalizedKey = String(key ?? "");
  const hasTenantMarker = normalizedKey.includes("tenant:");
  const hasWorkspaceMarker = normalizedKey.includes("workspace:");
  const expectedStatePrefix = `${scope.memoryNamespace}:multi-process:`;
  const expectedJobPrefix = `${scope.jobId}:multi-process:`;

  if (!normalizedKey) {
    return {
      safe: false,
      reason: "empty state key",
    };
  }

  if (
    normalizedKey.includes(":multi-process:")
    && !normalizedKey.startsWith(expectedStatePrefix)
    && !normalizedKey.startsWith(expectedJobPrefix)
  ) {
    return {
      safe: false,
      reason: `state key is outside memory namespace ${scope.memoryNamespace} and job ${scope.jobId}`,
    };
  }

  if (hasTenantMarker && !normalizedKey.includes(scope.tenantId)) {
    return {
      safe: false,
      reason: `state key is outside tenant ${scope.tenantId}`,
    };
  }

  if (hasWorkspaceMarker && !normalizedKey.includes(scope.workspaceId)) {
    return {
      safe: false,
      reason: `state key is outside workspace ${scope.workspaceId}`,
    };
  }

  return {
    safe: true,
    reason: "scope accepted",
  };
}

function buildProcessGraph(program) {
  const spawnSteps = program.job.plan
    .filter((step) => step.op.startsWith("spawn-"))
    .map((step) => ({
      stepId: step.id,
      command: step.op,
      output: step.output,
      verifierHints: step.verifierHints,
    }));
  const joinSteps = program.job.plan
    .filter((step) => step.op.includes("join-"))
    .map((step) => ({
      stepId: step.id,
      command: step.op,
      input: step.input,
      output: step.output,
      requires: spawnSteps.map((spawn) => spawn.output),
    }));

  return {
    spawnSteps,
    joinSteps,
    statusSteps: program.job.plan.filter((step) => step.output === "statusEvent").map((step) => step.id),
    memoryNamespace: program.job.memory.namespace,
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function withRollbackVerifierHints(program) {
  return {
    ...program,
    job: {
      ...program.job,
      plan: program.job.plan.map((step) => ({
        ...step,
        verifierHints: Object.entries(step.verifierHints ?? {})
          .map(([key, value]) => `${key}=${value}`),
      })),
    },
  };
}
