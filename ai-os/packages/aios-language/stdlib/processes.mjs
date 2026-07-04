import {
  buildPackageControlSurface,
  buildPackageReadinessPreview,
  buildProviderServiceContract,
} from "./packages.mjs";
import {
  createAuditDecisionSummary,
  createAuditExportPackage,
  createAuditExportSnapshot,
  createAuditHealthReport,
  createStatusEvent,
  createTruthBoundaryReport,
} from "./audit.mjs";
import {
  compileMailchimpApprovalContract,
  createMailchimpApprovalStatusHandoff,
} from "./approvals.mjs";

const PROCESS_STATUSES = Object.freeze([
  "draft",
  "blocked",
  "ready",
  "running",
  "verifying",
  "completed",
  "rolled_back",
  "failed",
]);

const PROCESS_COMMANDS = Object.freeze([
  "package.enable",
  "package.disable",
  "package.settings.fix",
  "package.approve",
  "package.approval.request",
  "package.preview",
  "package.preview.accept",
  "package.run",
  "package.schedule.update",
  "package.schedule.next",
  "process.start",
  "process.verify",
  "process.retry",
  "process.resume",
  "process.degraded-mode",
  "process.inspect",
  "process.rollback",
  "audit.preview.accept",
  "audit.export.package",
]);

export function createProcessEnvelope(compiledProgram, options = {}) {
  assertCompiledProgram(compiledProgram);

  const providerContract = options.providerContract
    ?? buildProviderServiceContract(compiledProgram, options.providerOptions ?? options);
  const readinessPreview = options.readinessPreview
    ?? buildPackageReadinessPreview(compiledProgram, {
      ...options,
      providerContract,
      acceptance: options.acceptance ?? options,
    });
  const controlSurface = options.controlSurface
    ?? buildPackageControlSurface(compiledProgram, {
      ...options,
      providerContract,
      readinessPreview,
      acceptance: options.acceptance ?? options,
    });
  assertProviderContract(providerContract);
  assertReadinessPreview(readinessPreview);
  assertControlSurface(controlSurface);

  const status = deriveProcessStatus(compiledProgram.lifecycle, readinessPreview, options);
  const mailchimpHandoff = buildMailchimpRuntimeHandoff(compiledProgram, options);
  const mailchimpApprovalPreview = buildMailchimpProcessApprovalPreview(mailchimpHandoff);
  const mailchimpExternalHandoff = mailchimpApprovalPreview?.externalHandoff ?? mailchimpHandoff?.externalHandoff ?? null;
  const mailchimpClientRuntimeAdoption = mailchimpApprovalPreview?.clientRuntimeAdoption
    ?? mailchimpHandoff?.clientRuntimeAdoption
    ?? null;
  const queuedCommands = buildProcessCommandQueue(
    compiledProgram,
    providerContract,
    readinessPreview,
    controlSurface,
    status,
    {
      ...options,
      mailchimpHandoff,
    },
  );
  const processId = `proc_${stableId([
    compiledProgram.job.id,
    providerContract.sync.checkpoint,
    readinessPreview.previewId,
    status,
  ])}`;
  const persistedState = buildProcessPersistedState(
    compiledProgram,
    providerContract,
    readinessPreview,
    queuedCommands,
    status,
    processId,
    mailchimpApprovalPreview,
    mailchimpExternalHandoff,
    mailchimpClientRuntimeAdoption,
    options,
  );

  return deepFreeze({
    kind: "aios.process.envelope",
    apiVersion: "aios.runtime/v1",
    processId,
    package: {
      name: compiledProgram.manifest.name,
      version: compiledProgram.manifest.version,
    },
    jobId: compiledProgram.job.id,
    status,
    runtime: {
      adapter: compiledProgram.job.runtimeAdapter,
      command: queuedCommands.find((command) => command.ready)?.command ?? readinessPreview.readiness.nextAction,
      dryRun: compiledProgram.lifecycle.commandQueue.some((command) => command.command === "package.preview"),
      memoryNamespace: compiledProgram.job.memory.namespace,
      memoryWritePolicy: compiledProgram.job.memory.writePolicy,
    },
    provider: {
      name: providerContract.provider.name,
      adapter: providerContract.provider.adapter,
      mode: providerContract.provider.mode,
      checkpoint: providerContract.sync.checkpoint,
      cursor: providerContract.sync.cursor,
      scopes: providerContract.negotiation.providerScopes,
      workspaceId: providerContract.sync.workspaceId,
    },
    tenantBoundary: buildProcessTenantBoundary(compiledProgram.job, providerContract, readinessPreview),
    readiness: {
      ready: readinessPreview.readiness.ready,
      status: readinessPreview.readiness.status,
      nextAction: readinessPreview.readiness.nextAction,
      reason: readinessPreview.readiness.reason,
      blockedReasons: uniqueSorted(readinessPreview.validationSummary.blockedReasons),
    },
    controls: buildProcessControlState(controlSurface, queuedCommands, status),
    clientState: buildProcessClientState(
      controlSurface,
      readinessPreview,
      queuedCommands,
      status,
      mailchimpApprovalPreview,
    ),
    recovery: buildProcessRecovery(compiledProgram.job, providerContract, readinessPreview, status),
    adapterContracts: {
      mailchimp: mailchimpHandoff,
      mailchimpApprovalPreview,
      mailchimpExternalHandoff,
      mailchimpClientRuntimeAdoption,
    },
    exportPolicy: buildProcessExportPolicy(compiledProgram.lifecycle, providerContract, readinessPreview),
    persistedState,
    commands: queuedCommands,
    verifier: {
      truthBoundaryReporter: compiledProgram.job.verifier.truthBoundary.reportedBy,
      requiredEvidence: compiledProgram.job.verifier.requiredEvidence,
      externalReads: compiledProgram.job.verifier.truthBoundary.externalReads,
      externalWrites: compiledProgram.job.verifier.truthBoundary.externalWrites,
    },
  });
}

export function createProcessStatusHandoff(processEnvelope, observations = {}) {
  assertProcessEnvelope(processEnvelope);
  const timeline = normalizeTimelineInput(observations.timeline ?? [], processEnvelope.status);
  const evidence = normalizeEvidenceInput(observations.evidence ?? [], processEnvelope);
  const externalWrites = normalizeExternalWriteInput(observations.externalWrites ?? []);
  const boundaryViolations = normalizeBoundaryViolationsInput(observations.boundaryViolations ?? []);
  const auditReport = observations.auditReport ?? createTruthBoundaryReport(
    buildJobDescriptorForAudit(processEnvelope),
    {
      timeline,
      evidence,
      externalWrites,
      status: mapProcessStatusToAuditStatus(processEnvelope.status, observations.status),
    },
  );
  if (!auditReport || auditReport.kind !== "aios.audit.truth-boundary") {
    throw new Error("auditReport must be produced by createTruthBoundaryReport");
  }

  const status = reduceProcessStatus(processEnvelope, auditReport, {
    ...observations,
    boundaryViolations,
  });
  const healthReport = observations.healthReport ?? createAuditHealthReport(auditReport, {
    retry: processEnvelope.recovery.retry,
    adapterHealth: observations.adapterHealth ?? observations.health ?? {},
  });
  assertAuditHealthReport(healthReport);
  const exportSnapshot = observations.auditExport
    ?? createAuditExportSnapshot(auditReport, {
      generatedAt: observations.generatedAt ?? "logical:0",
      format: observations.exportFormat ?? "json.summary",
      history: observations.history ?? [],
    });
  const exportPackage = observations.exportPackage
    ?? createAuditExportPackage(exportSnapshot, {
      generatedAt: observations.generatedAt ?? "logical:0",
      destination: {
        target: processEnvelope.exportPolicy.destination,
        localOnly: true,
        channel: processEnvelope.tenantBoundary.auditChannel,
      },
      redaction: {
        mode: processEnvelope.exportPolicy.redaction,
      },
      retention: observations.retention ?? {},
      historyWindow: observations.historyWindow ?? {},
    });
  const auditDecision = observations.auditDecision
    ?? createAuditDecisionSummary(auditReport, {
      healthReport,
      exportSnapshot,
      exportPackage,
      acceptance: observations.auditAcceptance ?? observations.acceptance ?? observations,
    });
  assertAuditDecisionSummary(auditDecision);
  const persistedState = buildStatusHandoffPersistedState(
    processEnvelope,
    auditReport,
    healthReport,
    exportSnapshot,
    exportPackage,
    auditDecision,
    status,
    observations,
  );
  const handoffId = `handoff_${stableId([
    processEnvelope.processId,
    auditReport.jobId,
    auditReport.status,
    status,
    healthReport.health.mode,
  ])}`;

  return deepFreeze({
    kind: "aios.process.status-handoff",
    apiVersion: "aios.runtime/v1",
    handoffId,
    processId: processEnvelope.processId,
    jobId: processEnvelope.jobId,
    status,
    auditStatus: auditReport.status,
    health: buildProcessHealthState(processEnvelope, status, auditReport, healthReport),
    export: buildProcessExportState(processEnvelope, status, auditReport, exportSnapshot, exportPackage),
    auditDecision: buildProcessAuditDecisionState(processEnvelope, auditDecision, status),
    persistedState,
    adapterStatus: deriveAdapterStatus(status, auditReport, healthReport),
    nextAction: deriveHandoffNextAction(processEnvelope, auditReport, status, healthReport),
    runtimeCommand: deriveRuntimeCommand(processEnvelope, status, healthReport),
    blockedReasons: deriveHandoffBlockers(processEnvelope, auditReport, status, boundaryViolations, healthReport),
    recovery: {
      shouldRollback: auditReport.recovery.shouldRollback || status === "failed",
      rollbackStatus: auditReport.recovery.rollbackStatus,
      command: auditReport.recovery.shouldRollback ? "process.rollback" : null,
      lastKnownStatus: auditReport.recovery.lastKnownStatus,
      retry: healthReport.health.retry,
      degradedMode: {
        active: healthReport.health.mode === "degraded",
        command: healthReport.health.nextAction === "process.retry"
          ? "process.retry"
          : "process.degraded-mode",
        reason: healthReport.health.summary,
      },
      resume: persistedState.resume,
    },
    evidence: {
      accepted: auditReport.evidence.accepted.length,
      missing: auditReport.evidence.missing,
      rejected: auditReport.evidence.rejected,
    },
    truthBoundary: {
      externalWritesAllowed: false,
      externalWritesObserved: auditReport.boundary.externalWritesObserved,
      memoryWritePolicy: processEnvelope.runtime.memoryWritePolicy,
      healthMode: healthReport.health.mode,
      readyForExport: healthReport.health.readyForExport,
    },
    tenantBoundary: {
      ...processEnvelope.tenantBoundary,
      observedViolations: boundaryViolations,
      satisfied: processEnvelope.tenantBoundary.satisfied && boundaryViolations.length === 0,
    },
  });
}

export function reduceProcessStatus(processEnvelope, auditReport, options = {}) {
  assertProcessEnvelope(processEnvelope);
  if (!auditReport || auditReport.kind !== "aios.audit.truth-boundary") {
    throw new Error("auditReport must be produced by createTruthBoundaryReport");
  }

  const requestedStatus = options.status ? normalizeProcessStatus(options.status) : null;
  if (auditReport.boundary.externalWritesObserved.length > 0 || auditReport.status === "failed") {
    return "failed";
  }
  if (options.boundaryViolations?.length > 0 || processEnvelope.tenantBoundary.satisfied === false) {
    return "failed";
  }
  if (auditReport.status === "rolled_back") {
    return "rolled_back";
  }
  if (auditReport.evidence.missing.length > 0 || auditReport.status === "verifying") {
    return "verifying";
  }
  if (requestedStatus && ["running", "completed"].includes(requestedStatus)) {
    return requestedStatus;
  }
  if (processEnvelope.status === "ready") {
    return "running";
  }
  return processEnvelope.status === "blocked" ? "blocked" : "completed";
}

export function createProcessSelfCheck(processEnvelope, statusHandoff = null) {
  assertProcessEnvelope(processEnvelope);
  if (statusHandoff && statusHandoff.kind !== "aios.process.status-handoff") {
    throw new Error("statusHandoff must be produced by createProcessStatusHandoff");
  }

  const errors = [];
  const warnings = [];
  if (processEnvelope.runtime.memoryWritePolicy !== "local-only") {
    errors.push("process memory write policy must remain local-only");
  }
  if (processEnvelope.verifier.externalWrites !== "forbidden") {
    errors.push("process truth boundary must forbid external writes");
  }
  if (!processEnvelope.provider.scopes.length) {
    warnings.push("provider scope list is empty; Mailchimp reads may be unavailable");
  }
  if (!processEnvelope.tenantBoundary.satisfied) {
    errors.push(...processEnvelope.tenantBoundary.violations);
  }
  if (!processEnvelope.tenantBoundary.permissions.includes("mailchimp:read")) {
    errors.push("tenant boundary must grant mailchimp:read permission");
  }
  if (
    processEnvelope.tenantBoundary.isolationMode === "tenant-workspace"
    && !processEnvelope.runtime.memoryNamespace.includes(processEnvelope.tenantBoundary.workspaceId)
  ) {
    errors.push("process memory namespace must include the scoped workspace");
  }
  if (processEnvelope.status === "ready" && !processEnvelope.commands.some((command) => command.ready)) {
    errors.push("ready process must expose at least one ready command");
  }
  if (
    statusHandoff?.health?.mode === "degraded"
    && !statusHandoff.recovery.retry.allowed
    && statusHandoff.nextAction === "process.retry"
  ) {
    errors.push("degraded process cannot request retry after retry budget is exhausted");
  }
  if (
    statusHandoff?.health?.mode === "failed"
    && statusHandoff.runtimeCommand !== "process.rollback"
    && processEnvelope.recovery.policy !== "none"
  ) {
    errors.push("failed process with rollback policy must surface rollback runtime command");
  }
  if (statusHandoff && statusHandoff.processId !== processEnvelope.processId) {
    errors.push("status handoff processId does not match process envelope");
  }
  if (
    statusHandoff?.export?.ready
    && !processEnvelope.commands.some((command) => command.command === "audit.export.package")
  ) {
    errors.push("export-ready handoff must expose audit.export.package command");
  }
  if (
    statusHandoff?.export?.ready
    && statusHandoff.export.localOnly !== true
  ) {
    errors.push("export-ready handoff must remain local-only");
  }
  if (
    statusHandoff?.auditDecision?.ready
    && statusHandoff.auditDecision.acceptance?.accepted !== true
  ) {
    errors.push("accepted audit decision must include operator acceptance");
  }
  if (
    statusHandoff?.auditDecision?.handoff?.localOnly !== true
  ) {
    errors.push("audit decision handoff must remain local-only");
  }
  if (
    statusHandoff?.auditDecision?.handoff?.packageId
    && statusHandoff.export?.packageId
    && statusHandoff.auditDecision.handoff.packageId !== statusHandoff.export.packageId
  ) {
    errors.push("audit decision packageId must match status handoff export package");
  }
  if (processEnvelope.persistedState?.storage?.localOnly !== true) {
    errors.push("process persisted state must remain local-only");
  }
  if (processEnvelope.persistedState?.provider?.checkpoint !== processEnvelope.provider.checkpoint) {
    errors.push("process persisted provider checkpoint must match provider panel checkpoint");
  }
  if (
    processEnvelope.persistedState?.resume?.command
    && !processEnvelope.commands.some((command) => command.command === processEnvelope.persistedState.resume.command)
  ) {
    errors.push("process resume command must be present in command queue");
  }
  if (
    statusHandoff?.persistedState
    && statusHandoff.persistedState.previousStateId !== processEnvelope.persistedState?.stateId
  ) {
    errors.push("status handoff persisted state must advance the process persisted state");
  }
  if (
    statusHandoff?.persistedState?.provider?.checkpoint
    && statusHandoff.persistedState.provider.checkpoint !== processEnvelope.provider.checkpoint
    && statusHandoff.persistedState.provider.checkpointChanged !== true
  ) {
    errors.push("status handoff provider checkpoint must either match or explicitly advance the process checkpoint");
  }
  if (processEnvelope.adapterContracts?.mailchimp) {
    const handoff = processEnvelope.adapterContracts.mailchimp;
    const preview = processEnvelope.adapterContracts.mailchimpApprovalPreview;
    if (handoff.protocol !== "aios.mailchimp.approval-status-handoff.v1") {
      errors.push("Mailchimp adapter handoff must use the approval status handoff protocol");
    }
    if (handoff.truthBoundary?.localOnly !== true) {
      errors.push("Mailchimp adapter handoff must remain local-only");
    }
    if (handoff.ready && handoff.blockedReasons.length > 0) {
      errors.push("ready Mailchimp adapter handoff cannot include blocked reasons");
    }
    if (!handoff.ready && !processEnvelope.commands.some((command) => command.command === handoff.nextAction)) {
      errors.push("Mailchimp adapter handoff nextAction must be present in the process command queue");
    }
    if (handoff.ready && processEnvelope.status === "ready" && !processEnvelope.commands.some((command) => (
      command.command === "process.start" && command.ready
    ))) {
      errors.push("ready Mailchimp adapter handoff must enable process.start on ready processes");
    }
    if (!preview || preview.protocol !== "aios.process.mailchimp-approval-preview.v1") {
      errors.push("Mailchimp approval preview must be attached to the process envelope");
    }
    if (preview?.localOnly !== true) {
      errors.push("Mailchimp approval preview must remain local-only");
    }
    if (preview?.ready !== handoff.ready) {
      errors.push("Mailchimp approval preview readiness must match adapter handoff readiness");
    }
    if (preview?.claimPreview?.localOnly !== true) {
      errors.push("Mailchimp claim readiness preview must remain local-only");
    }
    if (preview?.claimHealth?.truthBoundary?.externalWrites !== false) {
      errors.push("Mailchimp claim operational health must not permit external writes");
    }
    if (
      preview?.claimHealth?.mode === "failed"
      && preview.nextAction !== "process.inspect"
      && preview.claimHealth.primaryAction !== "process.inspect"
    ) {
      errors.push("failed Mailchimp claim health must surface an inspect action");
    }
    if (
      preview?.claimHealth?.retryPlan?.retryable
      && preview.claimHealth.retryPlan.command !== "process.retry"
    ) {
      errors.push("retryable Mailchimp claim health must route through process.retry");
    }
    if (!preview?.approvalAnalytics) {
      errors.push("Mailchimp approval analytics snapshot must be attached to the process preview");
    }
    if (preview?.approvalAnalytics?.protocol !== "aios.mailchimp.approval-analytics-snapshot.v1") {
      errors.push("Mailchimp approval analytics snapshot must use the expected protocol");
    }
    if (preview?.approvalAnalytics?.truthBoundary?.externalWrites !== false) {
      errors.push("Mailchimp approval analytics snapshot must remain read-only");
    }
    if (preview?.approvalAnalytics?.exportReadySummary?.localOnly !== true) {
      errors.push("Mailchimp approval analytics export summary must remain local-only");
    }
    if (
      preview?.approvalAnalytics?.counters?.timelineEvents !== undefined
      && preview.approvalAnalytics.timeline?.length !== preview.approvalAnalytics.counters.timelineEvents
    ) {
      errors.push("Mailchimp approval analytics timeline counter must match timeline length");
    }
    if (
      preview?.approvalAnalytics?.historySnapshots?.length
      && preview.approvalAnalytics.historySnapshots.length !== preview.approvalAnalytics.timeline?.length
    ) {
      errors.push("Mailchimp approval analytics history snapshots must align with timeline events");
    }
    if (preview?.adoptionPlan?.localOnly !== true) {
      errors.push("Mailchimp approval adoption plan must remain local-only");
    }
    if (preview?.adoptionPlan?.ready && preview.ready !== true) {
      errors.push("Mailchimp adoption plan cannot be ready while approval preview is blocked");
    }
    if (preview?.adoptionPlan?.ready && preview.claimPreview?.ready !== true) {
      errors.push("Mailchimp adoption plan requires ready claim preview");
    }
    if (preview?.acceptanceReceipt?.localOnly !== true) {
      errors.push("Mailchimp acceptance receipt must remain local-only");
    }
    if (preview?.acceptanceReceipt?.ready && preview.ready !== true) {
      errors.push("Mailchimp acceptance receipt cannot be ready while approval preview is blocked");
    }
    if (
      preview?.acceptanceReceipt?.ready
      && preview.acceptanceReceipt.auditHandoff?.command !== "process.start"
    ) {
      errors.push("ready Mailchimp acceptance receipt must hand off through process.start");
    }
    if (
      preview?.acceptanceReceipt?.ready
      && preview.acceptanceReceipt.scope?.workspaceId !== processEnvelope.tenantBoundary.workspaceId
    ) {
      errors.push("Mailchimp acceptance receipt workspace must match process tenant boundary");
    }
    if (
      processEnvelope.persistedState?.mailchimpApproval
      && processEnvelope.persistedState.mailchimpApproval.previewId !== preview?.previewId
    ) {
      errors.push("persisted Mailchimp approval preview must match process preview");
    }
    if (
      processEnvelope.persistedState?.mailchimpApproval?.adoptionReady
      && preview?.adoptionPlan?.ready !== true
    ) {
      errors.push("persisted Mailchimp adoption readiness must match adoption plan");
    }
    const externalHandoff = processEnvelope.adapterContracts.mailchimpExternalHandoff
      ?? preview?.externalHandoff
      ?? handoff.externalHandoff;
    if (!externalHandoff || externalHandoff.protocol !== "aios.mailchimp.external-handoff-state.v1") {
      errors.push("Mailchimp external handoff state must be attached to the process envelope");
    }
    if (externalHandoff?.persistence?.localOnly !== true || externalHandoff?.truthBoundary?.localOnly !== true) {
      errors.push("Mailchimp external handoff state must remain local-only before adapter execution");
    }
    if (externalHandoff?.ready && handoff.ready !== true) {
      errors.push("Mailchimp external handoff cannot be ready while approval handoff is blocked");
    }
    if (externalHandoff?.ready && preview?.adoptionPlan?.ready !== true) {
      errors.push("Mailchimp external handoff requires a ready adoption plan");
    }
    if (
      externalHandoff?.ready
      && externalHandoff.command !== "process.start"
    ) {
      errors.push("ready Mailchimp external handoff must start the local runtime process");
    }
    if (
      externalHandoff?.nextAction
      && !processEnvelope.commands.some((command) => command.command === externalHandoff.nextAction)
      && externalHandoff.nextAction !== "process.start"
    ) {
      errors.push("Mailchimp external handoff nextAction must be present in the process command queue");
    }
    if (
      processEnvelope.persistedState?.mailchimpExternalHandoff
      && processEnvelope.persistedState.mailchimpExternalHandoff.receiptId !== externalHandoff?.receiptId
    ) {
      errors.push("persisted Mailchimp external handoff receipt must match adapter contract");
    }
    if (
      processEnvelope.persistedState?.mailchimpExternalHandoff?.ready
      && externalHandoff?.ready !== true
    ) {
      errors.push("persisted Mailchimp external handoff readiness must match adapter contract");
    }
    if (
      processEnvelope.persistedState?.mailchimpAcceptanceReceipt
      && processEnvelope.persistedState.mailchimpAcceptanceReceipt.receiptId !== preview?.acceptanceReceipt?.receiptId
    ) {
      errors.push("persisted Mailchimp acceptance receipt must match process preview");
    }
    if (
      processEnvelope.persistedState?.mailchimpAcceptanceReceipt?.ready
      && preview?.acceptanceReceipt?.ready !== true
    ) {
      errors.push("persisted Mailchimp acceptance readiness must match acceptance receipt");
    }
    const clientRuntimeAdoption = processEnvelope.adapterContracts.mailchimpClientRuntimeAdoption
      ?? preview?.clientRuntimeAdoption
      ?? handoff.clientRuntimeAdoption;
    if (!clientRuntimeAdoption || clientRuntimeAdoption.protocol !== "aios.mailchimp.client-runtime-adoption.v1") {
      errors.push("Mailchimp client runtime adoption receipt must be attached to the process envelope");
    }
    if (
      clientRuntimeAdoption?.localOnly !== true
      || clientRuntimeAdoption?.persistence?.localOnly !== true
      || clientRuntimeAdoption?.truthBoundary?.localOnly !== true
    ) {
      errors.push("Mailchimp client runtime adoption receipt must remain local-only");
    }
    if (clientRuntimeAdoption?.ready && externalHandoff?.ready !== true) {
      errors.push("Mailchimp client runtime adoption cannot be ready while external handoff is blocked");
    }
    if (clientRuntimeAdoption?.ready && preview?.acceptanceReceipt?.ready !== true) {
      errors.push("Mailchimp client runtime adoption requires a ready acceptance receipt");
    }
    if (
      clientRuntimeAdoption?.ready
      && clientRuntimeAdoption.command !== "process.start"
    ) {
      errors.push("ready Mailchimp client runtime adoption must start the process");
    }
    if (
      clientRuntimeAdoption?.ready
      && clientRuntimeAdoption.clientState?.primaryCommand !== "process.start"
    ) {
      errors.push("ready Mailchimp client runtime adoption must expose process.start as client primary command");
    }
    if (
      clientRuntimeAdoption?.ready
      && !clientRuntimeAdoption.idempotencyKey
    ) {
      errors.push("ready Mailchimp client runtime adoption requires an idempotency key");
    }
    if (
      clientRuntimeAdoption?.ready
      && clientRuntimeAdoption.scope?.workspaceId !== processEnvelope.tenantBoundary.workspaceId
    ) {
      errors.push("Mailchimp client runtime adoption workspace must match process tenant boundary");
    }
    if (
      processEnvelope.persistedState?.mailchimpClientRuntimeAdoption
      && processEnvelope.persistedState.mailchimpClientRuntimeAdoption.receiptId !== clientRuntimeAdoption?.receiptId
    ) {
      errors.push("persisted Mailchimp client runtime adoption receipt must match adapter contract");
    }
    if (
      processEnvelope.persistedState?.mailchimpClientRuntimeAdoption?.ready
      && clientRuntimeAdoption?.ready !== true
    ) {
      errors.push("persisted Mailchimp client runtime adoption readiness must match adapter contract");
    }
    if (
      processEnvelope.persistedState?.mailchimpClientRuntimeAdoption?.primaryCommand
      && !processEnvelope.commands.some((command) => (
        command.command === processEnvelope.persistedState.mailchimpClientRuntimeAdoption.primaryCommand
      ))
      && processEnvelope.persistedState.mailchimpClientRuntimeAdoption.primaryCommand !== "process.start"
    ) {
      errors.push("persisted Mailchimp client runtime adoption primary command must be in the process command queue");
    }
    if (
      preview?.nextAction
      && !processEnvelope.commands.some((command) => command.command === preview.nextAction)
      && preview.nextAction !== "process.start"
    ) {
      errors.push("Mailchimp approval preview nextAction must be present in the process command queue");
    }
  }

  return deepFreeze({
    kind: "aios.process.self-check",
    apiVersion: "aios.runtime/v1",
    processId: processEnvelope.processId,
    valid: errors.length === 0,
    errors: uniqueSorted(errors),
    warnings: uniqueSorted(warnings),
    checked: {
      localOnlyMemory: processEnvelope.runtime.memoryWritePolicy === "local-only",
      externalWritesForbidden: processEnvelope.verifier.externalWrites === "forbidden",
      commandCount: processEnvelope.commands.length,
      handoffAttached: Boolean(statusHandoff),
      tenantBoundarySatisfied: processEnvelope.tenantBoundary.satisfied,
      workspaceId: processEnvelope.tenantBoundary.workspaceId,
      healthMode: statusHandoff?.health?.mode ?? "not-attached",
      retryRemaining: statusHandoff?.recovery?.retry?.remaining ?? null,
      exportReady: statusHandoff?.export?.ready ?? false,
      exportDestination: statusHandoff?.export?.destination ?? null,
      auditDecisionStatus: statusHandoff?.auditDecision?.status ?? null,
      auditDecisionNextAction: statusHandoff?.auditDecision?.nextAction ?? null,
      auditDecisionAccepted: statusHandoff?.auditDecision?.acceptance?.accepted ?? false,
      persistedStateLocalOnly: processEnvelope.persistedState?.storage?.localOnly === true,
      persistedStateId: processEnvelope.persistedState?.stateId ?? null,
      handoffPersistedStateId: statusHandoff?.persistedState?.stateId ?? null,
      resumeCommand: statusHandoff?.persistedState?.resume?.command
        ?? processEnvelope.persistedState?.resume?.command
        ?? null,
      mailchimpHandoffStatus: processEnvelope.adapterContracts?.mailchimp?.status ?? null,
      mailchimpHandoffReady: processEnvelope.adapterContracts?.mailchimp?.ready ?? null,
      mailchimpHandoffNextAction: processEnvelope.adapterContracts?.mailchimp?.nextAction ?? null,
      mailchimpApprovalPreviewStatus: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.status ?? null,
      mailchimpApprovalPreviewReady: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.ready ?? null,
      mailchimpApprovalPreviewNextAction: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.nextAction ?? null,
      mailchimpClaimPreviewReady: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.claimPreview?.ready ?? null,
      mailchimpClaimHealthMode: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.claimHealth?.mode ?? null,
      mailchimpClaimHealthRetryable: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.claimHealth?.retryPlan?.retryable ?? null,
      mailchimpApprovalAnalyticsReady: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.approvalAnalytics?.ready ?? null,
      mailchimpApprovalAnalyticsTimelineEvents: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.approvalAnalytics?.timeline?.length ?? null,
      mailchimpApprovalAnalyticsExportId: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.approvalAnalytics?.exportReadySummary?.exportId ?? null,
      mailchimpAdoptionPlanReady: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.adoptionPlan?.ready ?? null,
      mailchimpAdoptionPlanNextAction: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.adoptionPlan?.nextAction ?? null,
      persistedMailchimpAdoptionReady: processEnvelope.persistedState?.mailchimpApproval?.adoptionReady ?? null,
      mailchimpExternalHandoffStatus: processEnvelope.adapterContracts?.mailchimpExternalHandoff?.status ?? null,
      mailchimpExternalHandoffReady: processEnvelope.adapterContracts?.mailchimpExternalHandoff?.ready ?? null,
      mailchimpExternalHandoffCommand: processEnvelope.adapterContracts?.mailchimpExternalHandoff?.command ?? null,
      persistedMailchimpExternalHandoffReady: processEnvelope.persistedState?.mailchimpExternalHandoff?.ready ?? null,
      mailchimpAcceptanceReceiptReady: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.acceptanceReceipt?.ready ?? null,
      mailchimpAcceptanceReceiptId: processEnvelope.adapterContracts?.mailchimpApprovalPreview?.acceptanceReceipt?.receiptId ?? null,
      persistedMailchimpAcceptanceReceiptReady: processEnvelope.persistedState?.mailchimpAcceptanceReceipt?.ready ?? null,
      mailchimpClientRuntimeAdoptionReady: processEnvelope.adapterContracts?.mailchimpClientRuntimeAdoption?.ready ?? null,
      mailchimpClientRuntimeAdoptionCommand: processEnvelope.adapterContracts?.mailchimpClientRuntimeAdoption?.command ?? null,
      mailchimpClientRuntimeAdoptionReceiptId: processEnvelope.adapterContracts?.mailchimpClientRuntimeAdoption?.receiptId ?? null,
      persistedMailchimpClientRuntimeAdoptionReady: processEnvelope.persistedState?.mailchimpClientRuntimeAdoption?.ready ?? null,
    },
  });
}

function deriveProcessStatus(lifecycle, readinessPreview, options) {
  const requestedStatus = options.status ? normalizeProcessStatus(options.status) : null;
  if (!lifecycle.enabled || !readinessPreview.validationSummary.valid) {
    return "blocked";
  }
  if (requestedStatus && !["draft", "ready"].includes(requestedStatus)) {
    return requestedStatus;
  }
  return readinessPreview.readiness.ready ? "ready" : "blocked";
}

function buildProcessCommandQueue(compiledProgram, providerContract, readinessPreview, controlSurface, status, options) {
  const commands = [];
  const lifecycleCommands = compiledProgram.lifecycle.commandQueue.map((command) => ({
    command: normalizeProcessCommand(command.command),
    ready: Boolean(command.ready),
    reason: String(command.reason ?? command.command),
    source: "package-lifecycle",
  }));
  commands.push(...lifecycleCommands);

  for (const control of flattenControlSurface(controlSurface)) {
    commands.push({
      command: normalizeProcessCommand(control.command),
      ready: control.ready && isControlAllowedForProcessStatus(control.command, status),
      reason: control.ready
        ? control.reason
        : control.disabledReason ?? control.reason,
      source: "package-control-surface",
      selected: control.selected,
      metadata: control.metadata,
    });
  }

  if (readinessPreview.acceptance.required && !readinessPreview.acceptance.accepted) {
    commands.push({
      command: "package.preview.accept",
      ready: readinessPreview.validationSummary.valid,
      reason: "operator preview acceptance is required",
      source: "readiness-preview",
    });
  }
  if (options.mailchimpHandoff && !options.mailchimpHandoff.ready) {
    commands.push({
      command: normalizeProcessCommand(options.mailchimpHandoff.nextAction),
      ready: options.mailchimpHandoff.nextAction === "package.approval.request"
        && options.mailchimpHandoff.status === "approval_required",
      reason: options.mailchimpHandoff.blockedReasons.join("; ") || "Mailchimp adapter handoff is waiting",
      source: "mailchimp-adapter-handoff",
      adapterStatus: options.mailchimpHandoff.adapterStatus,
      handoffStatus: options.mailchimpHandoff.status,
    });
  }
  if (options.mailchimpHandoff?.ready) {
    commands.push({
      command: "package.approve",
      ready: true,
      reason: "Mailchimp approval and claim contracts are satisfied",
      source: "mailchimp-adapter-handoff",
      adapterStatus: options.mailchimpHandoff.adapterStatus,
      handoffStatus: options.mailchimpHandoff.status,
    });
  }
  if (status === "ready") {
    commands.push({
      command: "process.start",
      ready: providerContract.handoffState.ready,
      reason: "start local Mailchimp runtime process",
      source: "process-runtime",
      handoffToken: providerContract.handoffState.handoffToken,
    });
  }
  if (options.includeVerifyCommand ?? true) {
    commands.push({
      command: "process.verify",
      ready: ["ready", "running", "verifying"].includes(status),
      reason: "verify truth-boundary evidence",
      source: "process-runtime",
    });
  }
  if (compiledProgram.job.recovery.retry.attempts > 0) {
    commands.push({
      command: "process.retry",
      ready: ["running", "verifying", "failed"].includes(status),
      reason: `retry adapter handoff with ${compiledProgram.job.recovery.retry.attempts} configured attempt(s)`,
      source: "process-recovery",
      checkpoint: providerContract.sync.checkpoint,
    });
  }
  if (options.previousState ?? options.persistedState) {
    commands.push({
      command: "process.resume",
      ready: ["ready", "running", "verifying", "failed"].includes(status),
      reason: "resume Mailchimp sync from persisted local checkpoint",
      source: "process-persistence",
      checkpoint: providerContract.sync.checkpoint,
    });
  }
  if (providerContract.provider.mode === "sandbox-read") {
    commands.push({
      command: "process.degraded-mode",
      ready: ["ready", "running", "verifying"].includes(status),
      reason: "continue with sandbox Mailchimp reads while provider health is degraded",
      source: "process-recovery",
      checkpoint: providerContract.sync.checkpoint,
    });
  }
  commands.push({
    command: "audit.export.package",
    ready: status === "completed"
      && readinessPreview.readiness.ready
      && providerContract.handoffState.ready
      && compiledProgram.lifecycle.controls.exportPackage?.allowed === true,
    reason: compiledProgram.lifecycle.controls.exportPackage?.allowed === true
      ? `prepare local audit export package for ${compiledProgram.lifecycle.controls.exportPackage.destination}`
      : compiledProgram.lifecycle.controls.exportPackage?.disabledReason ?? "audit export packaging is unavailable",
    source: "audit-export",
    destination: compiledProgram.lifecycle.controls.exportPackage?.destination ?? "operator-download",
    redaction: compiledProgram.lifecycle.controls.exportPackage?.redaction ?? "receipt-subjects",
  });

  return uniqueCommands(commands);
}

function buildProcessControlState(controlSurface, queuedCommands, status) {
  const byCommand = new Map(queuedCommands.map((command) => [command.command, command]));
  const groups = Object.fromEntries(Object.entries(controlSurface.controls).map(([group, controls]) => [
    group,
    controls.map((control) => {
      const command = byCommand.get(control.command);
      const ready = Boolean(command?.ready);
      return {
        command: control.command,
        ready,
        allowed: control.allowed,
        label: control.label,
        reason: ready ? command.reason : control.disabledReason ?? command?.reason ?? control.reason,
        selected: Boolean(control.selected || command?.selected),
        metadata: control.metadata,
      };
    }),
  ]));

  return {
    status: controlSurface.status,
    nextAction: controlSurface.nextAction,
    primaryCommand: controlSurface.clientState.primaryCommand,
    scheduleBadge: controlSurface.clientState.scheduleBadge,
    exportBadge: controlSurface.clientState.exportBadge,
    disabledReason: controlSurface.clientState.disabledReason,
    groups,
    summary: summarizeProcessControls(groups, status),
  };
}

function buildProcessClientState(controlSurface, readinessPreview, queuedCommands, status, mailchimpApprovalPreview = null) {
  const readyCommands = queuedCommands.filter((command) => command.ready);
  const primary = readyCommands.find((command) => command.command === controlSurface.clientState.primaryCommand)
    ?? readyCommands.find((command) => command.selected)
    ?? readyCommands[0]
    ?? null;

  return {
    visibleStatus: deriveClientVisibleStatus(status, controlSurface, readinessPreview),
    nextAction: primary?.command ?? controlSurface.nextAction,
    primaryCommand: primary
      ? {
        command: primary.command,
        reason: primary.reason,
        source: primary.source,
      }
      : null,
    disabledReason: primary ? null : controlSurface.clientState.disabledReason,
    acceptance: {
      required: controlSurface.clientState.acceptanceRequired,
      accepted: controlSurface.clientState.accepted,
      command: controlSurface.clientState.accepted ? null : "package.preview.accept",
    },
    schedule: {
      badge: controlSurface.clientState.scheduleBadge,
      nextCommand: queuedCommands.find((command) => command.command === "package.schedule.next")?.ready
        ? "package.schedule.next"
        : null,
    },
    export: {
      badge: controlSurface.clientState.exportBadge,
      command: queuedCommands.find((command) => command.command === "audit.export.package")?.ready
        ? "audit.export.package"
        : null,
    },
    mailchimpApproval: mailchimpApprovalPreview
      ? {
        previewId: mailchimpApprovalPreview.previewId,
        status: mailchimpApprovalPreview.status,
        ready: mailchimpApprovalPreview.ready,
        nextAction: mailchimpApprovalPreview.nextAction,
        message: mailchimpApprovalPreview.message,
        counters: mailchimpApprovalPreview.counters,
        acceptance: mailchimpApprovalPreview.acceptance,
        exportSummary: mailchimpApprovalPreview.exportSummary,
        approvalAnalytics: mailchimpApprovalPreview.approvalAnalytics,
        claimPreview: mailchimpApprovalPreview.claimPreview,
        claimHealth: mailchimpApprovalPreview.claimHealth,
        adoptionPlan: mailchimpApprovalPreview.adoptionPlan,
        externalHandoff: mailchimpApprovalPreview.externalHandoff,
        acceptanceReceipt: mailchimpApprovalPreview.acceptanceReceipt,
        clientRuntimeAdoption: mailchimpApprovalPreview.clientRuntimeAdoption,
        blockedReasons: mailchimpApprovalPreview.blockedReasons,
      }
      : {
        previewId: null,
        status: "not-attached",
        ready: false,
        nextAction: null,
        message: "No Mailchimp approval preview is attached.",
        counters: {
          required: 0,
          approved: 0,
          pending: 0,
          denied: 0,
          blockerCount: 0,
        },
        acceptance: {
          required: false,
          accepted: false,
          command: null,
        },
        exportSummary: {
          localOnly: true,
          readyForExport: false,
          blockedReasons: [],
        },
        approvalAnalytics: {
          protocol: "aios.mailchimp.approval-analytics-snapshot.v1",
          ready: false,
          counters: {
            timelineEvents: 0,
          },
          timeline: [],
          historySnapshots: [],
          exportReadySummary: {
            exportId: null,
            localOnly: true,
            readyForExport: false,
            blockedReasons: [],
          },
          truthBoundary: {
            externalWrites: false,
          },
        },
        claimPreview: {
          protocol: "aios.mailchimp.claim-readiness-preview.v1",
          ready: false,
          status: "not-attached",
          nextAction: null,
          counters: {
            required: 0,
            ready: 0,
            missingFacts: 0,
            missingEvidence: 0,
            evidenceAccepted: 0,
            blockerCount: 0,
          },
          rows: [],
          blockedReasons: [],
          localOnly: true,
        },
        claimHealth: {
          protocol: "aios.mailchimp.claim-operational-health.v1",
          mode: "unknown",
          ready: false,
          degraded: false,
          primaryAction: null,
          actionableErrors: [],
          retryPlan: {
            retryable: false,
            command: null,
            retryAfterSeconds: null,
          },
          truthBoundary: {
            externalWrites: false,
          },
        },
        adoptionPlan: buildEmptyMailchimpAdoptionPlan(),
        externalHandoff: buildEmptyMailchimpExternalHandoff(),
        acceptanceReceipt: buildEmptyMailchimpAcceptanceReceipt(),
        clientRuntimeAdoption: buildEmptyMailchimpClientRuntimeAdoption(),
        blockedReasons: [],
      },
  };
}

function buildMailchimpRuntimeHandoff(compiledProgram, options) {
  const source = options.mailchimpSource
    ?? options.approvalSource
    ?? compiledProgram.mailchimp
    ?? compiledProgram.source?.mailchimp
    ?? null;
  const explicit = options.mailchimpApprovalContract ?? options.approvalContract ?? null;
  if (!source && !explicit) {
    return null;
  }

  const baseSource = {
    ...(source ?? {}),
    tenantId: source?.tenantId ?? compiledProgram.job.tenancy?.tenantId,
    workspaceId: source?.workspaceId ?? compiledProgram.job.tenancy?.workspaceId,
    requestId: source?.requestId ?? compiledProgram.job.id,
    sourceId: source?.sourceId ?? compiledProgram.job.id,
    externalWrite: source?.externalWrite ?? true,
  };
  const contract = explicit?.protocol === "aios.mailchimp.approval-contract.v1"
    ? explicit
    : compileMailchimpApprovalContract(baseSource, options.mailchimpClaimOptions ?? options.claimOptions ?? {});
  return createMailchimpApprovalStatusHandoff(contract, {
    ...options.mailchimpRuntime,
    claimContract: baseSource.claimContract,
  });
}

function buildMailchimpProcessApprovalPreview(handoff) {
  if (!handoff) {
    return null;
  }

  const preview = handoff.preview ?? {};
  const counters = {
    required: Number(preview.counters?.required ?? handoff.counts?.required ?? 0),
    approved: Number(preview.counters?.approved ?? handoff.counts?.approved ?? 0),
    pending: Number(preview.counters?.pending ?? handoff.counts?.pending ?? 0),
    denied: Number(preview.counters?.denied ?? handoff.counts?.denied ?? 0),
    externalWriteApprovals: Number(preview.counters?.externalWriteApprovals ?? 0),
    acceptedRecords: Number(preview.counters?.acceptedRecords ?? handoff.counts?.acceptedRecords ?? 0),
    commandCount: Number(preview.counters?.commandCount ?? handoff.counts?.commandCount ?? 0),
    blockerCount: Number(preview.counters?.blockerCount ?? handoff.blockedReasons?.length ?? 0),
  };
  const blockedReasons = uniqueSorted([
    ...(preview.exportSummary?.blockedReasons ?? []),
    ...(handoff.blockedReasons ?? []),
  ]);
  const nextAction = preview.nextAction ?? handoff.nextAction;
  const claimPreview = preview.claimPreview ?? handoff.claimHandoff?.preview ?? {
    protocol: "aios.mailchimp.claim-readiness-preview.v1",
    ready: Boolean(handoff.claimHandoff?.ready),
    status: handoff.claimHandoff?.status ?? "not-attached",
    nextAction: handoff.claimHandoff?.nextAction ?? null,
    counters: {
      required: 0,
      ready: handoff.claimHandoff?.ready ? 1 : 0,
      missingFacts: handoff.claimHandoff?.missingFacts?.length ?? 0,
      missingEvidence: handoff.claimHandoff?.missingEvidence?.length ?? 0,
      evidenceAccepted: 0,
      blockerCount: handoff.claimHandoff?.blockedReasons?.length ?? 0,
    },
    rows: [],
    blockedReasons: handoff.claimHandoff?.blockedReasons ?? [],
    localOnly: true,
  };
  const claimHealth = preview.claimHealth ?? handoff.claimHandoff?.health ?? {
    protocol: "aios.mailchimp.claim-operational-health.v1",
    adapter: "mailchimp",
    mode: handoff.claimHandoff?.ready ? "healthy" : "failed",
    ready: Boolean(handoff.claimHandoff?.ready),
    degraded: false,
    primaryAction: handoff.claimHandoff?.nextAction ?? nextAction,
    actionableErrors: (handoff.claimHandoff?.blockedReasons ?? []).map((reason) => ({
      code: "mailchimp.claim.blocked",
      message: reason,
      command: handoff.claimHandoff?.nextAction ?? nextAction,
      retryable: false,
    })),
    retryPlan: {
      retryable: false,
      command: handoff.claimHandoff?.nextAction ?? nextAction,
      retryAfterSeconds: null,
    },
    truthBoundary: {
      externalWrites: false,
    },
  };
  const adoptionPlan = normalizeMailchimpAdoptionPlan(
    preview.adoptionPlan ?? handoff.adoptionPlan,
    {
      handoff,
      preview,
      claimPreview,
      blockedReasons,
      nextAction,
    },
  );
  const externalHandoff = normalizeMailchimpExternalHandoff(
    handoff.externalHandoff,
    {
      handoff,
      preview,
      adoptionPlan,
      claimPreview,
      blockedReasons,
      nextAction,
    },
  );
  const acceptanceReceipt = normalizeMailchimpAcceptanceReceipt(
    preview.acceptanceReceipt ?? handoff.acceptanceReceipt ?? externalHandoff.acceptanceReceipt,
    {
      handoff,
      preview,
      claimPreview,
      adoptionPlan,
      externalHandoff,
      blockedReasons,
      nextAction,
    },
  );
  const clientRuntimeAdoption = normalizeMailchimpClientRuntimeAdoption(
    handoff.clientRuntimeAdoption ?? preview.clientRuntimeAdoption,
    {
      handoff,
      preview,
      claimPreview,
      adoptionPlan,
      externalHandoff,
      acceptanceReceipt,
      blockedReasons,
      nextAction,
    },
  );

  return {
    protocol: "aios.process.mailchimp-approval-preview.v1",
    adapter: "mailchimp",
    previewId: preview.previewId ?? `mailchimp_preview_${stableId([
      handoff.tenantId,
      handoff.workspaceId,
      handoff.sourceId,
      handoff.status,
    ])}`,
    sourceProtocol: preview.protocol ?? "aios.mailchimp.approval-preview-summary.v1",
    tenantId: handoff.tenantId,
    workspaceId: handoff.workspaceId,
    sourceId: handoff.sourceId,
    status: preview.status ?? handoff.status,
    ready: handoff.ready === true && blockedReasons.length === 0,
    nextAction,
    message: preview.message ?? blockedReasons.join("; ") ?? "Mailchimp approval preview is unavailable.",
    counters,
    claimPreview,
    acceptance: {
      required: Boolean(preview.acceptance?.required ?? counters.required > 0),
      accepted: Boolean(preview.acceptance?.accepted ?? handoff.ready),
      acceptedBy: preview.acceptance?.acceptedBy ?? null,
      acceptedAt: preview.acceptance?.acceptedAt ?? null,
      command: preview.acceptance?.command ?? (
        handoff.ready ? null : nextAction
      ),
      records: preview.acceptance?.records ?? [],
    },
    exportSummary: {
      localOnly: preview.exportSummary?.localOnly !== false,
      readyForExport: Boolean(preview.exportSummary?.readyForExport ?? handoff.ready),
      redaction: preview.exportSummary?.redaction ?? "receipt-subjects",
      subjects: preview.exportSummary?.subjects ?? handoff.approvals?.map((approval) => approval.approvalId) ?? [],
      blockedReasons,
    },
    approvalAnalytics: preview.approvalAnalytics ?? null,
    adoptionPlan,
    externalHandoff,
    acceptanceReceipt,
    clientRuntimeAdoption,
    claimHealth,
    rows: preview.rows ?? handoff.approvals ?? [],
    nextSteps: preview.nextSteps ?? blockedReasons.map((reason) => ({
      action: nextAction,
      label: "Resolve Mailchimp approval blocker",
      reason,
    })),
    blockedReasons,
    localOnly: true,
  };
}

function buildEmptyMailchimpAcceptanceReceipt() {
  return {
    protocol: "aios.mailchimp.acceptance-receipt.v1",
    adapter: "mailchimp",
    receiptId: null,
    scope: {
      tenantId: null,
      workspaceId: null,
      sourceId: null,
    },
    status: "not-attached",
    ready: false,
    restartSafe: false,
    localOnly: true,
    nextAction: null,
    idempotencyKey: null,
    fingerprint: null,
    acceptedSubjects: [],
    acceptedRecords: [],
    operator: null,
    acceptedAt: null,
    counters: {
      required: 0,
      approved: 0,
      pending: 0,
      denied: 0,
      claimRows: 0,
      commands: 0,
      blockers: 0,
    },
    validationSummary: {
      valid: false,
      errors: [],
      warnings: [],
      blockedReasons: [],
      checked: {},
    },
    auditHandoff: {
      localOnly: true,
      redaction: "receipt-subjects",
      subjects: [],
      command: null,
      externalWritesPermitted: false,
      evaluatedAgainst: "aios.mailchimp.approval-contract.v1",
    },
    nextSteps: [],
  };
}

function normalizeMailchimpAcceptanceReceipt(receipt, context) {
  const fallback = buildEmptyMailchimpAcceptanceReceipt();
  const blockedReasons = uniqueSorted([
    ...(receipt?.validationSummary?.blockedReasons ?? []),
    ...(receipt?.validationSummary?.errors ?? []),
    ...context.blockedReasons,
    ...(context.externalHandoff?.persistence?.blockedReasons ?? []),
  ]);
  const ready = receipt?.ready === true
    && context.handoff.ready === true
    && context.claimPreview.ready === true
    && context.adoptionPlan.ready === true
    && context.externalHandoff.ready === true
    && blockedReasons.length === 0;
  const receiptId = receipt?.receiptId ?? (ready ? `mailchimp_accept_${stableId([
    context.handoff.tenantId,
    context.handoff.workspaceId,
    context.handoff.sourceId,
    context.handoff.status,
  ])}` : null);
  const nextAction = ready ? "process.start" : receipt?.nextAction ?? context.nextAction;

  return {
    ...fallback,
    ...(receipt ?? {}),
    receiptId,
    scope: {
      tenantId: receipt?.scope?.tenantId ?? context.handoff.tenantId,
      workspaceId: receipt?.scope?.workspaceId ?? context.handoff.workspaceId,
      sourceId: receipt?.scope?.sourceId ?? context.handoff.sourceId,
    },
    status: ready ? "accepted" : receipt?.status ?? (blockedReasons.length > 0 ? "blocked" : "awaiting_operator"),
    ready,
    restartSafe: ready && receipt?.restartSafe === true && context.externalHandoff.restartSafe === true,
    localOnly: receipt?.localOnly !== false,
    nextAction,
    idempotencyKey: receipt?.idempotencyKey ?? context.externalHandoff.idempotencyKey ?? null,
    fingerprint: receipt?.fingerprint ?? context.externalHandoff.approvalFingerprint ?? null,
    counters: {
      ...fallback.counters,
      ...(receipt?.counters ?? {}),
      blockers: blockedReasons.length,
    },
    validationSummary: {
      ...fallback.validationSummary,
      ...(receipt?.validationSummary ?? {}),
      valid: ready,
      errors: blockedReasons,
      blockedReasons,
    },
    auditHandoff: {
      ...fallback.auditHandoff,
      ...(receipt?.auditHandoff ?? {}),
      localOnly: receipt?.auditHandoff?.localOnly !== false,
      command: ready ? "process.start" : nextAction,
      externalWritesPermitted: ready,
    },
    nextSteps: receipt?.nextSteps ?? blockedReasons.map((reason) => ({
      action: nextAction,
      label: "Resolve Mailchimp acceptance receipt blocker",
      reason,
    })),
  };
}

function buildEmptyMailchimpClientRuntimeAdoption() {
  return {
    protocol: "aios.mailchimp.client-runtime-adoption.v1",
    adapter: "mailchimp",
    receiptId: null,
    scope: {
      tenantId: null,
      workspaceId: null,
      sourceId: null,
    },
    status: "not-attached",
    ready: false,
    restartSafe: false,
    localOnly: true,
    command: null,
    nextAction: null,
    idempotencyKey: null,
    statusToken: null,
    operator: null,
    acceptedAt: null,
    preview: {
      previewId: null,
      status: "not-attached",
      ready: false,
      blockerCount: 0,
    },
    receipts: {
      acceptanceReceiptId: null,
      externalHandoffReceiptId: null,
      approvalFingerprint: null,
    },
    clientState: {
      visibleStatus: "not-attached",
      primaryCommand: null,
      disabledReason: "No Mailchimp client runtime adoption receipt is attached.",
      badge: "blocked",
      resumeToken: null,
    },
    persistence: {
      localOnly: true,
      stateKey: null,
      resumeToken: null,
      command: null,
      checkpoint: null,
      blockedReasons: [],
    },
    truthBoundary: {
      localOnly: true,
      externalWritesPermitted: false,
      externalWritesObserved: [],
      evaluatedAgainst: "aios.mailchimp.approval-contract.v1",
    },
    validationSummary: {
      valid: false,
      errors: [],
      warnings: [],
      blockedReasons: [],
      checked: {},
    },
    nextSteps: [],
  };
}

function normalizeMailchimpClientRuntimeAdoption(receipt, context) {
  const fallback = buildEmptyMailchimpClientRuntimeAdoption();
  const blockedReasons = uniqueSorted([
    ...(receipt?.validationSummary?.blockedReasons ?? []),
    ...(receipt?.persistence?.blockedReasons ?? []),
    ...context.blockedReasons,
    ...(context.acceptanceReceipt.ready === true ? [] : ["Mailchimp acceptance receipt is not ready"]),
    ...(context.externalHandoff.ready === true ? [] : ["Mailchimp external handoff is not ready"]),
  ]);
  const ready = receipt?.ready === true
    && context.handoff.ready === true
    && context.claimPreview.ready === true
    && context.adoptionPlan.ready === true
    && context.acceptanceReceipt.ready === true
    && context.externalHandoff.ready === true
    && blockedReasons.length === 0;
  const nextAction = ready ? "process.start" : receipt?.nextAction ?? context.nextAction;

  return {
    ...fallback,
    ...(receipt ?? {}),
    scope: {
      tenantId: receipt?.scope?.tenantId ?? context.handoff.tenantId,
      workspaceId: receipt?.scope?.workspaceId ?? context.handoff.workspaceId,
      sourceId: receipt?.scope?.sourceId ?? context.handoff.sourceId,
    },
    status: ready ? "adopted" : receipt?.status ?? (blockedReasons.length > 0 ? "blocked" : "awaiting_operator"),
    ready,
    restartSafe: ready && receipt?.restartSafe === true && context.externalHandoff.restartSafe === true,
    localOnly: receipt?.localOnly !== false
      && receipt?.persistence?.localOnly !== false
      && receipt?.truthBoundary?.localOnly !== false,
    command: ready ? "process.start" : receipt?.command ?? nextAction,
    nextAction,
    receipts: {
      acceptanceReceiptId: receipt?.receipts?.acceptanceReceiptId
        ?? context.acceptanceReceipt.receiptId
        ?? null,
      externalHandoffReceiptId: receipt?.receipts?.externalHandoffReceiptId
        ?? context.externalHandoff.receiptId
        ?? null,
      approvalFingerprint: receipt?.receipts?.approvalFingerprint
        ?? context.externalHandoff.approvalFingerprint
        ?? context.acceptanceReceipt.fingerprint
        ?? null,
    },
    clientState: {
      ...fallback.clientState,
      ...(receipt?.clientState ?? {}),
      visibleStatus: ready ? "ready-to-start" : receipt?.clientState?.visibleStatus ?? context.preview.status,
      primaryCommand: ready ? "process.start" : receipt?.clientState?.primaryCommand ?? nextAction,
      disabledReason: ready ? null : blockedReasons[0] ?? receipt?.clientState?.disabledReason ?? null,
      badge: ready ? "armed" : blockedReasons.length > 0 ? "blocked" : "review",
    },
    persistence: {
      ...fallback.persistence,
      ...(receipt?.persistence ?? {}),
      localOnly: receipt?.persistence?.localOnly !== false,
      command: ready ? "process.start" : receipt?.persistence?.command ?? nextAction,
      checkpoint: receipt?.persistence?.checkpoint ?? context.externalHandoff.sync?.checkpoint ?? null,
      blockedReasons,
    },
    truthBoundary: {
      ...fallback.truthBoundary,
      ...(receipt?.truthBoundary ?? {}),
      localOnly: receipt?.truthBoundary?.localOnly !== false,
      externalWritesPermitted: ready,
      externalWritesObserved: receipt?.truthBoundary?.externalWritesObserved ?? [],
    },
    validationSummary: {
      ...fallback.validationSummary,
      ...(receipt?.validationSummary ?? {}),
      valid: ready,
      errors: blockedReasons,
      blockedReasons,
    },
    nextSteps: receipt?.nextSteps ?? blockedReasons.map((reason) => ({
      action: nextAction,
      label: "Resolve Mailchimp client runtime adoption blocker",
      reason,
    })),
  };
}

function buildEmptyMailchimpExternalHandoff() {
  return {
    protocol: "aios.mailchimp.external-handoff-state.v1",
    adapter: "mailchimp",
    receiptId: null,
    status: "not-attached",
    ready: false,
    command: null,
    nextAction: null,
    restartSafe: false,
    idempotencyKey: null,
    approvalFingerprint: null,
    operator: null,
    acceptedAt: null,
    sync: {
      checkpoint: null,
      cursor: "",
      mode: "local-preview",
      externalWrite: {
        permitted: false,
        observed: [],
        operation: "mailchimp.campaign.handoff",
      },
    },
    approvalState: {
      required: 0,
      approved: 0,
      pending: [],
      denied: [],
      acceptedRecords: [],
      acceptanceReceiptId: null,
    },
    acceptanceReceipt: buildEmptyMailchimpAcceptanceReceipt(),
    claimState: {
      status: "not-attached",
      ready: false,
      missingFacts: [],
      missingEvidence: [],
    },
    persistence: {
      localOnly: true,
      stateKey: null,
      resumeToken: null,
      command: null,
      blockedReasons: [],
    },
    nextSteps: [],
    truthBoundary: {
      localOnly: true,
      externalWritesPermitted: false,
      externalWritesObserved: [],
      evaluatedAgainst: "aios.mailchimp.approval-contract.v1",
    },
  };
}

function normalizeMailchimpExternalHandoff(state, context) {
  const fallback = buildEmptyMailchimpExternalHandoff();
  if (!state) {
    const ready = context.handoff.ready === true
      && context.adoptionPlan.ready === true
      && context.claimPreview.ready === true
      && context.blockedReasons.length === 0;
    return {
      ...fallback,
      tenantId: context.handoff.tenantId,
      workspaceId: context.handoff.workspaceId,
      sourceId: context.handoff.sourceId,
      receiptId: ready ? `mailchimp_handoff_${stableId([
        context.handoff.tenantId,
        context.handoff.workspaceId,
        context.handoff.sourceId,
        context.handoff.status,
      ])}` : null,
      status: ready ? "ready_for_adapter" : "blocked",
      ready,
      command: ready ? "process.start" : context.nextAction,
      nextAction: ready ? "process.start" : context.nextAction,
      restartSafe: ready && context.handoff.restartSafe === true,
      sync: {
        ...fallback.sync,
        checkpoint: ready ? context.handoff.sourceId : null,
        mode: ready ? "external-write-armed" : "local-preview",
        externalWrite: {
          ...fallback.sync.externalWrite,
          permitted: ready,
        },
      },
      approvalState: {
        ...fallback.approvalState,
        required: context.handoff.counts?.required ?? 0,
        approved: context.handoff.counts?.approved ?? 0,
        pending: context.handoff.approvals
          ?.filter((approval) => approval.status === "pending")
          .map((approval) => approval.approvalId) ?? [],
        denied: context.handoff.approvals
          ?.filter((approval) => approval.status === "denied")
          .map((approval) => approval.approvalId) ?? [],
        acceptanceReceiptId: context.preview?.acceptanceReceipt?.receiptId ?? null,
      },
      acceptanceReceipt: context.preview?.acceptanceReceipt ?? fallback.acceptanceReceipt,
      claimState: {
        status: context.handoff.claimHandoff?.status ?? context.claimPreview.status,
        ready: context.claimPreview.ready === true,
        missingFacts: context.handoff.claimHandoff?.missingFacts ?? [],
        missingEvidence: context.handoff.claimHandoff?.missingEvidence ?? [],
      },
      persistence: {
        ...fallback.persistence,
        command: ready ? "process.start" : context.nextAction,
        blockedReasons: context.blockedReasons,
      },
      nextSteps: context.blockedReasons.map((reason) => ({
        action: context.nextAction,
        label: "Resolve Mailchimp handoff blocker",
        reason,
      })),
    };
  }

  const blockedReasons = uniqueSorted([
    ...(state.persistence?.blockedReasons ?? []),
    ...context.blockedReasons,
  ]);
  const ready = state.ready === true
    && context.handoff.ready === true
    && context.adoptionPlan.ready === true
    && context.claimPreview.ready === true
    && blockedReasons.length === 0;
  return {
    ...fallback,
    ...state,
    ready,
    restartSafe: ready && state.restartSafe === true,
    command: state.command ?? (ready ? "process.start" : context.nextAction),
    nextAction: state.nextAction ?? state.command ?? (ready ? "process.start" : context.nextAction),
    sync: {
      ...fallback.sync,
      ...(state.sync ?? {}),
      mode: ready ? "external-write-armed" : state.sync?.mode ?? "local-preview",
      externalWrite: {
        ...fallback.sync.externalWrite,
        ...(state.sync?.externalWrite ?? {}),
        permitted: ready,
        observed: state.sync?.externalWrite?.observed ?? [],
      },
    },
    persistence: {
      ...fallback.persistence,
      ...(state.persistence ?? {}),
      localOnly: state.persistence?.localOnly !== false,
      command: state.persistence?.command ?? state.command ?? context.nextAction,
      blockedReasons,
    },
    truthBoundary: {
      ...fallback.truthBoundary,
      ...(state.truthBoundary ?? {}),
      localOnly: state.truthBoundary?.localOnly !== false,
      externalWritesPermitted: ready,
      externalWritesObserved: state.truthBoundary?.externalWritesObserved ?? [],
    },
  };
}

function buildEmptyMailchimpAdoptionPlan() {
  return {
    protocol: "aios.mailchimp.approval-adoption-plan.v1",
    adapter: "mailchimp",
    status: "not-attached",
    ready: false,
    nextAction: null,
    localOnly: true,
    operator: null,
    acceptedRecords: [],
    commandPlan: [],
    steps: [],
    blockedReasons: [],
    handoff: {
      externalWritesPermitted: false,
      externalWritesObserved: [],
      evaluatedAgainst: "aios.mailchimp.approval-contract.v1",
      restartSafe: false,
    },
  };
}

function normalizeMailchimpAdoptionPlan(plan, context) {
  if (plan?.protocol === "aios.mailchimp.approval-adoption-plan.v1") {
    const blockedReasons = uniqueSorted([
      ...(plan.blockedReasons ?? []),
      ...(context.claimPreview.localOnly === true ? [] : ["claim readiness preview must remain local-only"]),
    ]);
    return {
      ...plan,
      ready: plan.ready === true && blockedReasons.length === 0,
      localOnly: plan.localOnly !== false,
      nextAction: plan.ready === true && blockedReasons.length === 0
        ? plan.nextAction
        : plan.nextAction ?? context.nextAction,
      blockedReasons,
    };
  }

  const ready = context.handoff.ready === true
    && context.claimPreview.ready === true
    && context.blockedReasons.length === 0;
  return {
    ...buildEmptyMailchimpAdoptionPlan(),
    adapter: "mailchimp",
    tenantId: context.handoff.tenantId,
    workspaceId: context.handoff.workspaceId,
    sourceId: context.handoff.sourceId,
    status: ready ? "ready_to_adopt" : "blocked",
    ready,
    nextAction: ready ? "process.start" : context.nextAction,
    steps: [
      {
        id: "claims-ready",
        label: "Confirm Mailchimp claim readiness",
        command: context.claimPreview.nextAction,
        ready: context.claimPreview.ready === true,
        status: context.claimPreview.status,
        reason: context.claimPreview.message ?? context.claimPreview.blockedReasons?.join("; ") ?? "",
        localOnly: true,
      },
      {
        id: "runtime-handoff",
        label: "Adopt preview into runtime handoff",
        command: ready ? "process.start" : context.nextAction,
        ready,
        status: context.handoff.status,
        reason: ready
          ? "approval preview can be adopted by the local runtime"
          : context.blockedReasons[0] ?? "approval preview adoption is blocked",
        localOnly: true,
      },
    ],
    blockedReasons: context.blockedReasons,
    handoff: {
      externalWritesPermitted: ready,
      externalWritesObserved: [],
      evaluatedAgainst: context.handoff.truthBoundary?.evaluatedAgainst ?? "aios.mailchimp.approval-contract.v1",
      restartSafe: ready && context.handoff.restartSafe === true,
    },
  };
}

function flattenControlSurface(controlSurface) {
  return Object.values(controlSurface.controls).flat();
}

function isControlAllowedForProcessStatus(command, status) {
  if (command === "package.enable") {
    return status === "blocked";
  }
  if (command === "package.disable" || command === "package.schedule.update") {
    return !["failed", "rolled_back"].includes(status);
  }
  if (command === "package.preview.accept") {
    return ["blocked", "ready"].includes(status);
  }
  if (command === "package.preview" || command === "package.run" || command === "process.start") {
    return status === "ready";
  }
  if (command === "audit.export.package") {
    return status === "completed";
  }
  return true;
}

function summarizeProcessControls(groups, status) {
  const controls = Object.values(groups).flat();
  const ready = controls.filter((control) => control.ready).length;
  const blocked = controls.length - ready;
  return {
    status,
    total: controls.length,
    ready,
    blocked,
    nextReadyCommand: controls.find((control) => control.ready && control.selected)?.command
      ?? controls.find((control) => control.ready)?.command
      ?? null,
  };
}

function deriveClientVisibleStatus(status, controlSurface, readinessPreview) {
  if (status === "blocked") {
    return controlSurface.status;
  }
  if (status === "ready" && readinessPreview.readiness.acceptanceRequired && !readinessPreview.acceptance.accepted) {
    return "awaiting-acceptance";
  }
  if (status === "ready" && controlSurface.clientState.scheduleBadge === "scheduled") {
    return "scheduled-ready";
  }
  return status;
}

function buildProcessExportPolicy(lifecycle, providerContract, readinessPreview) {
  const lifecycleCommand = lifecycle.commandQueue.find((command) => command.command === "audit.export.package");
  const control = lifecycle.controls.exportPackage ?? {};
  const destination = lifecycleCommand?.destination ?? control.destination ?? "operator-download";
  const redaction = lifecycleCommand?.redaction ?? control.redaction ?? "receipt-subjects";
  const blockedReasons = uniqueSorted([
    ...(control.allowed === false ? [control.disabledReason ?? "audit export packaging is disabled"] : []),
    ...(readinessPreview.validationSummary.valid ? [] : readinessPreview.validationSummary.errors),
    ...(providerContract.sync.externalHandoff === "none" ? [] : ["provider handoff must remain local before export"]),
  ]);

  return {
    enabled: control.allowed !== false && destination !== "disabled",
    destination,
    redaction,
    autoPackage: Boolean(lifecycleCommand?.autoPackage),
    requireCompletedAudit: lifecycleCommand?.requireCompletedAudit !== false,
    localOnly: true,
    readyBeforeAudit: blockedReasons.length === 0 && readinessPreview.readiness.ready,
    blockedReasons,
  };
}

function buildProcessPersistedState(
  compiledProgram,
  providerContract,
  readinessPreview,
  queuedCommands,
  status,
  processId,
  mailchimpApprovalPreview,
  mailchimpExternalHandoff,
  mailchimpClientRuntimeAdoption,
  options,
) {
  const previous = normalizePreviousPersistedState(options.previousState ?? options.persistedState);
  const readyCommands = queuedCommands
    .filter((command) => command.ready)
    .map((command) => command.command);
  const commandFingerprint = stableId(queuedCommands.map((command) => [
    command.command,
    command.ready ? "ready" : "blocked",
    command.source,
  ].join(":")));
  const replayToken = stableId([
    processId,
    providerContract.sync.checkpoint,
    providerContract.sync.cursor,
    status,
    commandFingerprint,
  ]);
  const resumeCommand = derivePersistedResumeCommand(status, readyCommands, previous);
  const stateId = `state_${stableId([
    processId,
    providerContract.sync.checkpoint,
    previous?.stateId ?? "initial",
    status,
    replayToken,
  ])}`;

  return {
    kind: "aios.process.persisted-state",
    apiVersion: "aios.runtime/v1",
    stateId,
    previousStateId: previous?.stateId ?? null,
    processId,
    jobId: compiledProgram.job.id,
    status,
    storage: {
      scope: "local-runtime",
      localOnly: true,
      namespace: compiledProgram.job.memory.namespace,
      key: [
        compiledProgram.job.tenancy.tenantId,
        compiledProgram.job.tenancy.workspaceId,
        compiledProgram.manifest.name,
        processId,
      ].join("/"),
      writePolicy: compiledProgram.job.memory.writePolicy,
    },
    provider: {
      name: providerContract.provider.name,
      adapter: providerContract.provider.adapter,
      service: providerContract.provider.service,
      mode: providerContract.provider.mode,
      cursor: providerContract.sync.cursor,
      checkpoint: providerContract.sync.checkpoint,
      resource: providerContract.sync.providerResource,
      direction: providerContract.sync.direction,
      externalHandoff: providerContract.sync.externalHandoff,
      scopes: providerContract.negotiation.providerScopes,
    },
    tenantBoundary: {
      tenantId: compiledProgram.job.tenancy.tenantId,
      workspaceId: compiledProgram.job.tenancy.workspaceId,
      auditChannel: compiledProgram.job.tenancy.auditChannel,
      satisfied: compiledProgram.job.tenancy.boundarySatisfied,
    },
    replay: {
      token: replayToken,
      commandFingerprint,
      idempotencyKey: stableId([
        providerContract.sync.checkpoint,
        compiledProgram.job.id,
        readinessPreview.previewId,
      ]),
      acceptedPreviewId: readinessPreview.acceptance.accepted
        ? readinessPreview.previewId
        : null,
      acceptedMailchimpPreviewId: mailchimpApprovalPreview?.adoptionPlan?.ready
        ? mailchimpApprovalPreview.previewId
        : null,
      readyCommands,
    },
    mailchimpApproval: mailchimpApprovalPreview
      ? {
        previewId: mailchimpApprovalPreview.previewId,
        status: mailchimpApprovalPreview.status,
        ready: mailchimpApprovalPreview.ready,
        nextAction: mailchimpApprovalPreview.nextAction,
        adoptionReady: mailchimpApprovalPreview.adoptionPlan?.ready === true,
        adoptionStatus: mailchimpApprovalPreview.adoptionPlan?.status ?? "not-attached",
        adoptionNextAction: mailchimpApprovalPreview.adoptionPlan?.nextAction ?? mailchimpApprovalPreview.nextAction,
        claimReady: mailchimpApprovalPreview.claimPreview?.ready === true,
        localOnly: mailchimpApprovalPreview.localOnly !== false
          && mailchimpApprovalPreview.adoptionPlan?.localOnly !== false
          && mailchimpApprovalPreview.claimPreview?.localOnly !== false,
        blockedReasons: uniqueSorted([
          ...mailchimpApprovalPreview.blockedReasons,
          ...(mailchimpApprovalPreview.adoptionPlan?.blockedReasons ?? []),
          ...(mailchimpApprovalPreview.claimPreview?.blockedReasons ?? []),
        ]),
      }
      : null,
    mailchimpExternalHandoff: mailchimpExternalHandoff
      ? {
        receiptId: mailchimpExternalHandoff.receiptId,
        status: mailchimpExternalHandoff.status,
        ready: mailchimpExternalHandoff.ready,
        command: mailchimpExternalHandoff.command,
        nextAction: mailchimpExternalHandoff.nextAction,
        restartSafe: mailchimpExternalHandoff.restartSafe,
        idempotencyKey: mailchimpExternalHandoff.idempotencyKey,
        approvalFingerprint: mailchimpExternalHandoff.approvalFingerprint,
        checkpoint: mailchimpExternalHandoff.sync?.checkpoint ?? providerContract.sync.checkpoint,
        cursor: mailchimpExternalHandoff.sync?.cursor ?? providerContract.sync.cursor,
        externalWritesPermitted: mailchimpExternalHandoff.truthBoundary?.externalWritesPermitted === true,
        localOnly: mailchimpExternalHandoff.persistence?.localOnly !== false
          && mailchimpExternalHandoff.truthBoundary?.localOnly !== false,
        stateKey: mailchimpExternalHandoff.persistence?.stateKey ?? null,
        resumeToken: mailchimpExternalHandoff.persistence?.resumeToken ?? null,
        blockedReasons: mailchimpExternalHandoff.persistence?.blockedReasons ?? [],
      }
      : null,
    mailchimpAcceptanceReceipt: mailchimpApprovalPreview?.acceptanceReceipt
      ? {
        receiptId: mailchimpApprovalPreview.acceptanceReceipt.receiptId,
        status: mailchimpApprovalPreview.acceptanceReceipt.status,
        ready: mailchimpApprovalPreview.acceptanceReceipt.ready,
        restartSafe: mailchimpApprovalPreview.acceptanceReceipt.restartSafe,
        nextAction: mailchimpApprovalPreview.acceptanceReceipt.nextAction,
        idempotencyKey: mailchimpApprovalPreview.acceptanceReceipt.idempotencyKey,
        fingerprint: mailchimpApprovalPreview.acceptanceReceipt.fingerprint,
        tenantId: mailchimpApprovalPreview.acceptanceReceipt.scope?.tenantId ?? null,
        workspaceId: mailchimpApprovalPreview.acceptanceReceipt.scope?.workspaceId ?? null,
        sourceId: mailchimpApprovalPreview.acceptanceReceipt.scope?.sourceId ?? null,
        operator: mailchimpApprovalPreview.acceptanceReceipt.operator,
        acceptedAt: mailchimpApprovalPreview.acceptanceReceipt.acceptedAt,
        localOnly: mailchimpApprovalPreview.acceptanceReceipt.localOnly !== false
          && mailchimpApprovalPreview.acceptanceReceipt.auditHandoff?.localOnly !== false,
        auditCommand: mailchimpApprovalPreview.acceptanceReceipt.auditHandoff?.command ?? null,
        blockedReasons: mailchimpApprovalPreview.acceptanceReceipt.validationSummary?.blockedReasons ?? [],
      }
      : null,
    mailchimpClientRuntimeAdoption: mailchimpClientRuntimeAdoption
      ? {
        receiptId: mailchimpClientRuntimeAdoption.receiptId,
        status: mailchimpClientRuntimeAdoption.status,
        ready: mailchimpClientRuntimeAdoption.ready,
        restartSafe: mailchimpClientRuntimeAdoption.restartSafe,
        command: mailchimpClientRuntimeAdoption.command,
        nextAction: mailchimpClientRuntimeAdoption.nextAction,
        idempotencyKey: mailchimpClientRuntimeAdoption.idempotencyKey,
        statusToken: mailchimpClientRuntimeAdoption.statusToken,
        tenantId: mailchimpClientRuntimeAdoption.scope?.tenantId ?? null,
        workspaceId: mailchimpClientRuntimeAdoption.scope?.workspaceId ?? null,
        sourceId: mailchimpClientRuntimeAdoption.scope?.sourceId ?? null,
        acceptanceReceiptId: mailchimpClientRuntimeAdoption.receipts?.acceptanceReceiptId ?? null,
        externalHandoffReceiptId: mailchimpClientRuntimeAdoption.receipts?.externalHandoffReceiptId ?? null,
        primaryCommand: mailchimpClientRuntimeAdoption.clientState?.primaryCommand ?? null,
        visibleStatus: mailchimpClientRuntimeAdoption.clientState?.visibleStatus ?? null,
        resumeToken: mailchimpClientRuntimeAdoption.persistence?.resumeToken ?? null,
        stateKey: mailchimpClientRuntimeAdoption.persistence?.stateKey ?? null,
        localOnly: mailchimpClientRuntimeAdoption.localOnly !== false
          && mailchimpClientRuntimeAdoption.persistence?.localOnly !== false
          && mailchimpClientRuntimeAdoption.truthBoundary?.localOnly !== false,
        blockedReasons: mailchimpClientRuntimeAdoption.validationSummary?.blockedReasons ?? [],
      }
      : null,
    resume: {
      available: Boolean(resumeCommand),
      command: resumeCommand,
      reason: resumeCommand
        ? "local checkpoint can resume Mailchimp sync without external writes"
        : "no restart-safe command is available for current process state",
      checkpoint: providerContract.sync.checkpoint,
      replayToken,
      requiresOperatorReview: !readinessPreview.acceptance.accepted
        && readinessPreview.readiness.acceptanceRequired,
    },
  };
}

function buildStatusHandoffPersistedState(
  processEnvelope,
  auditReport,
  healthReport,
  exportSnapshot,
  exportPackage,
  auditDecision,
  status,
  observations,
) {
  const previous = normalizePreviousPersistedState(observations.previousState ?? processEnvelope.persistedState);
  const adapterCheckpoint = healthReport.health.adapter.checkpoint
    ?? processEnvelope.provider.checkpoint;
  const evidenceFingerprint = stableId([
    auditReport.evidence.accepted.map((entry) => entry.receipt ?? entry.subject).join(","),
    auditReport.evidence.missing.join(","),
    auditReport.boundary.externalWritesObserved.length,
  ]);
  const replayToken = stableId([
    processEnvelope.processId,
    adapterCheckpoint,
    auditReport.status,
    status,
    evidenceFingerprint,
    exportSnapshot.exportId,
  ]);
  const resumeCommand = deriveHandoffResumeCommand(status, healthReport, auditReport, processEnvelope);
  const stateId = `state_${stableId([
    previous?.stateId ?? processEnvelope.processId,
    adapterCheckpoint,
    status,
    replayToken,
  ])}`;

  return {
    kind: "aios.process.status-persisted-state",
    apiVersion: "aios.runtime/v1",
    stateId,
    previousStateId: previous?.stateId ?? null,
    processId: processEnvelope.processId,
    handoffStatus: status,
    auditStatus: auditReport.status,
    storage: {
      scope: "local-runtime",
      localOnly: true,
      namespace: processEnvelope.runtime.memoryNamespace,
      key: previous?.storage?.key ?? [
        processEnvelope.tenantBoundary.tenantId,
        processEnvelope.tenantBoundary.workspaceId,
        processEnvelope.package.name,
        processEnvelope.processId,
      ].join("/"),
      writePolicy: processEnvelope.runtime.memoryWritePolicy,
    },
    provider: {
      name: processEnvelope.provider.name,
      adapter: processEnvelope.provider.adapter,
      mode: processEnvelope.provider.mode,
      cursor: processEnvelope.provider.cursor,
      checkpoint: adapterCheckpoint,
      previousCheckpoint: previous?.provider?.checkpoint ?? null,
      checkpointChanged: adapterCheckpoint !== (previous?.provider?.checkpoint ?? adapterCheckpoint),
      scopes: processEnvelope.provider.scopes,
    },
    replay: {
      token: replayToken,
      idempotencyKey: stableId([
        processEnvelope.processId,
        adapterCheckpoint,
        auditReport.jobId,
      ]),
      evidenceFingerprint,
      exportId: exportSnapshot.exportId,
      packageId: exportPackage.packageId,
      decisionId: auditDecision.decisionId,
      decisionStatus: auditDecision.readiness.status,
      decisionNextAction: auditDecision.readiness.nextAction,
      operatorAccepted: auditDecision.acceptance.accepted,
      missingEvidence: auditReport.evidence.missing,
      externalWritesObserved: auditReport.boundary.externalWritesObserved.length,
    },
    decision: {
      decisionId: auditDecision.decisionId,
      status: auditDecision.readiness.status,
      ready: auditDecision.readiness.ready,
      nextAction: auditDecision.readiness.nextAction,
      acceptanceRequired: auditDecision.acceptance.required,
      accepted: auditDecision.acceptance.accepted,
      acceptedBy: auditDecision.acceptance.acceptedBy,
      acceptedAt: auditDecision.acceptance.acceptedAt,
      blockedReasons: auditDecision.validationSummary.blockedReasons,
      exportId: exportSnapshot.exportId,
      packageId: exportPackage.packageId,
      localOnly: auditDecision.handoff.localOnly,
    },
    mailchimpClientRuntimeAdoption: processEnvelope.persistedState?.mailchimpClientRuntimeAdoption
      ? {
        ...processEnvelope.persistedState.mailchimpClientRuntimeAdoption,
        carriedFromStateId: processEnvelope.persistedState.stateId,
        statusHandoffReady: processEnvelope.adapterContracts?.mailchimpClientRuntimeAdoption?.ready === true,
        commandReady: processEnvelope.commands.some((command) => (
          command.command === processEnvelope.persistedState.mailchimpClientRuntimeAdoption.primaryCommand
          && command.ready
        )),
      }
      : null,
    resume: {
      available: Boolean(resumeCommand),
      command: resumeCommand,
      reason: deriveHandoffResumeReason(status, healthReport, auditReport, resumeCommand),
      checkpoint: adapterCheckpoint,
      replayToken,
      retryAfter: healthReport.health.adapter.retryAfter,
      requiresOperatorReview: status === "failed" || auditReport.evidence.missing.length > 0,
    },
  };
}

function buildProcessAuditDecisionState(processEnvelope, auditDecision, status) {
  const exportCommand = processEnvelope.commands.find((command) => command.command === "audit.export.package");
  const ready = auditDecision.readiness.ready
    && status === "completed"
    && Boolean(exportCommand);
  const nextAction = ready
    ? "audit.export.package"
    : auditDecision.readiness.nextAction === "audit.export.download"
      ? "audit.export.package"
      : auditDecision.readiness.nextAction;

  return {
    decisionId: auditDecision.decisionId,
    status: auditDecision.readiness.status,
    ready,
    preview: auditDecision.preview,
    acceptance: auditDecision.acceptance,
    validationSummary: auditDecision.validationSummary,
    nextAction,
    nextSteps: auditDecision.nextSteps,
    handoff: auditDecision.handoff,
    commandReady: ready,
    blockedReasons: uniqueSorted([
      ...auditDecision.validationSummary.blockedReasons,
      ...(status === "completed" ? [] : ["completed process status is required before audit decision handoff"]),
      ...(exportCommand ? [] : ["audit export package command is unavailable"]),
    ]),
  };
}

function normalizePreviousPersistedState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }
  return {
    stateId: state.stateId ? String(state.stateId) : null,
    storage: state.storage && typeof state.storage === "object" ? state.storage : {},
    provider: state.provider && typeof state.provider === "object" ? state.provider : {},
  };
}

function derivePersistedResumeCommand(status, readyCommands, previous) {
  if (!previous) {
    return null;
  }
  if (readyCommands.includes("process.resume")) {
    return "process.resume";
  }
  if (["running", "verifying"].includes(status) && readyCommands.includes("process.verify")) {
    return "process.verify";
  }
  if (status === "ready" && readyCommands.includes("process.start")) {
    return "process.start";
  }
  if (status === "failed" && readyCommands.includes("process.retry")) {
    return "process.retry";
  }
  return null;
}

function deriveHandoffResumeCommand(status, healthReport, auditReport, processEnvelope) {
  if (status === "failed") {
    return processEnvelope.recovery.policy === "none" ? "process.inspect" : "process.rollback";
  }
  if (healthReport.health.retry.allowed) {
    return "process.retry";
  }
  if (auditReport.evidence.missing.length > 0) {
    return "process.verify";
  }
  if (["running", "verifying"].includes(status)) {
    return "process.verify";
  }
  if (status === "completed" && processEnvelope.exportPolicy.enabled) {
    return "audit.export.package";
  }
  return null;
}

function deriveHandoffResumeReason(status, healthReport, auditReport, resumeCommand) {
  if (!resumeCommand) {
    return "handoff is terminal or waiting for operator review";
  }
  if (status === "failed") {
    return "resume requires recovery from the last local checkpoint";
  }
  if (healthReport.health.retry.allowed) {
    return healthReport.health.retry.reason;
  }
  if (auditReport.evidence.missing.length > 0) {
    return `${auditReport.evidence.missing.length} evidence receipt(s) must be verified from the checkpoint`;
  }
  if (resumeCommand === "audit.export.package") {
    return "completed handoff can resume at local audit export packaging";
  }
  return "handoff can resume from persisted local checkpoint";
}

function buildProcessRecovery(jobDescriptor, providerContract, readinessPreview, status) {
  const rollbackEnabled = jobDescriptor.recovery.rollback !== "none";
  return {
    policy: jobDescriptor.recovery.rollback,
    retry: jobDescriptor.recovery.retry,
    adapterCheckpoint: providerContract.sync.checkpoint,
    statusTransitions: jobDescriptor.recovery.statusTransitions,
    shouldSnapshot: rollbackEnabled && ["ready", "running", "verifying"].includes(status),
    blockedReasons: status === "blocked" ? readinessPreview.validationSummary.blockedReasons : [],
  };
}

function buildProcessTenantBoundary(jobDescriptor, providerContract, readinessPreview) {
  const violations = uniqueSorted([
    ...(jobDescriptor.tenancy?.violations ?? []),
    ...(readinessPreview.tenantBoundary?.workspaceId !== providerContract.tenantBoundary?.workspaceId
      ? ["readiness preview workspace does not match provider workspace"]
      : []),
    ...(providerContract.sync.workspaceId !== jobDescriptor.tenancy?.workspaceId
      ? ["provider sync workspace does not match job tenancy"]
      : []),
  ]);

  return {
    tenantId: String(jobDescriptor.tenancy?.tenantId ?? "tenant-default"),
    workspaceId: String(jobDescriptor.tenancy?.workspaceId ?? "workspace-default"),
    homeWorkspaceId: String(jobDescriptor.tenancy?.homeWorkspaceId ?? jobDescriptor.tenancy?.workspaceId ?? "workspace-default"),
    role: String(jobDescriptor.tenancy?.role ?? "operator"),
    permissions: uniqueSorted(jobDescriptor.tenancy?.permissions ?? []),
    allowedWorkspaces: uniqueSorted(jobDescriptor.tenancy?.allowedWorkspaces ?? []),
    auditChannel: String(jobDescriptor.tenancy?.auditChannel ?? providerContract.sync.auditChannel ?? "tenant-default:workspace-default"),
    isolationMode: String(jobDescriptor.tenancy?.isolationMode ?? "tenant-workspace"),
    satisfied: Boolean(jobDescriptor.tenancy?.boundarySatisfied) && violations.length === 0,
    violations,
  };
}

function buildJobDescriptorForAudit(processEnvelope) {
  return {
    kind: "aios.kernel.job",
    id: processEnvelope.jobId,
    package: processEnvelope.package,
    memory: {
      writePolicy: processEnvelope.runtime.memoryWritePolicy,
    },
    tenancy: processEnvelope.tenantBoundary,
    verifier: {
      requiredEvidence: processEnvelope.verifier.requiredEvidence,
      truthBoundary: {
        externalReads: processEnvelope.verifier.externalReads,
        workspaceId: processEnvelope.tenantBoundary.workspaceId,
        tenantIsolation: processEnvelope.tenantBoundary.isolationMode,
      },
    },
    recovery: {
      rollback: processEnvelope.recovery.policy,
      retry: processEnvelope.recovery.retry,
    },
  };
}

function normalizeTimelineInput(events, processStatus) {
  const baseStatus = mapProcessStatusToAuditStatus(processStatus);
  const normalized = Array.isArray(events) ? events : [];
  if (normalized.length > 0) {
    return normalized;
  }
  return [createStatusEvent(baseStatus, {
    at: "logical:0",
    actor: "aios-process",
    message: `process ${processStatus}`,
  })];
}

function normalizeEvidenceInput(entries, processEnvelope) {
  if (Array.isArray(entries) && entries.length > 0) {
    return entries;
  }
  return processEnvelope.verifier.requiredEvidence.map((subject) => ({
    kind: subject.includes("mailchimp") ? "mailchimp-read-receipt" : "runtime-local-receipt",
    subject,
    details: {
      processId: processEnvelope.processId,
      checkpoint: processEnvelope.provider.checkpoint,
    },
  }));
}

function normalizeExternalWriteInput(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("externalWrites must be an array");
  }
  return entries;
}

function normalizeBoundaryViolationsInput(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("boundaryViolations must be an array");
  }
  return entries.map((entry) => ({
    boundary: String(entry.boundary ?? entry.target ?? "tenant-workspace"),
    reason: String(entry.reason ?? entry),
  })).sort((left, right) => left.boundary.localeCompare(right.boundary));
}

function mapProcessStatusToAuditStatus(processStatus, requestedStatus = null) {
  const status = requestedStatus ? normalizeProcessStatus(requestedStatus) : normalizeProcessStatus(processStatus);
  if (status === "failed") {
    return "failed";
  }
  if (status === "rolled_back") {
    return "rolled_back";
  }
  if (["running", "verifying", "blocked"].includes(status)) {
    return "verifying";
  }
  return "completed";
}

function buildProcessHealthState(processEnvelope, status, auditReport, healthReport) {
  const actionableErrors = healthReport.health.actionableErrors.map((error) => ({
    code: error.code,
    message: error.message,
    action: error.action,
    retryable: error.retryable,
  }));

  return {
    mode: status === "failed" ? "failed" : healthReport.health.mode,
    severity: healthReport.health.severity,
    summary: healthReport.health.summary,
    nextAction: healthReport.health.nextAction,
    readyForExport: healthReport.health.readyForExport && status === "completed",
    retry: healthReport.health.retry,
    adapter: healthReport.health.adapter,
    actionableErrors,
    degradedModeAvailable: processEnvelope.commands.some((command) => command.command === "process.degraded-mode"),
    retryCommandAvailable: processEnvelope.commands.some((command) => command.command === "process.retry"),
    blockedReasonCount: actionableErrors.length + (auditReport.evidence.missing.length > 0 ? 1 : 0),
  };
}

function buildProcessExportState(processEnvelope, status, auditReport, exportSnapshot, exportPackage) {
  if (!exportSnapshot || exportSnapshot.kind !== "aios.audit.export-snapshot") {
    throw new Error("auditExport must be produced by createAuditExportSnapshot");
  }
  if (!exportPackage || exportPackage.kind !== "aios.audit.export-package") {
    throw new Error("exportPackage must be produced by createAuditExportPackage");
  }

  const command = processEnvelope.commands.find((item) => item.command === "audit.export.package");
  const requiresCompleted = processEnvelope.exportPolicy.requireCompletedAudit;
  const completionBlocked = requiresCompleted && status !== "completed";
  const blockers = uniqueSorted([
    ...processEnvelope.exportPolicy.blockedReasons,
    ...exportPackage.readiness.blockedReasons,
    ...(completionBlocked ? ["completed audit status is required before export packaging"] : []),
  ]);
  const ready = blockers.length === 0
    && exportPackage.readiness.ready
    && Boolean(command)
    && auditReport.status === "completed";

  return {
    exportId: exportSnapshot.exportId,
    packageId: exportPackage.packageId,
    ready,
    status: ready ? "ready" : "blocked",
    command: "audit.export.package",
    commandReady: ready,
    destination: exportPackage.destination.target,
    localOnly: exportPackage.destination.localOnly,
    redaction: exportPackage.redaction.mode,
    retention: exportPackage.retention,
    manifest: exportPackage.manifest,
    counters: exportSnapshot.counters,
    summary: ready ? exportPackage.summary : blockers.join("; "),
    nextAction: ready
      ? "audit.export.download"
      : exportPackage.readiness.nextAction === "audit.export.download"
        ? "process.verify"
        : exportPackage.readiness.nextAction,
    blockedReasons: blockers,
  };
}

function assertAuditDecisionSummary(summary) {
  if (!summary || summary.kind !== "aios.audit.decision-summary") {
    throw new Error("auditDecision must be produced by createAuditDecisionSummary");
  }
}

function deriveAdapterStatus(status, auditReport, healthReport) {
  if (healthReport.health.mode === "degraded") {
    return healthReport.health.retry.allowed
      ? "adapter-degraded-retryable"
      : "adapter-degraded";
  }
  if (status === "failed") {
    return "adapter-recovery-required";
  }
  if (status === "verifying") {
    return auditReport.evidence.missing.length > 0 ? "adapter-awaiting-evidence" : "adapter-verifying";
  }
  if (status === "completed") {
    return "adapter-handoff-complete";
  }
  return `adapter-${status}`;
}

function deriveHandoffNextAction(processEnvelope, auditReport, status, healthReport) {
  if (status === "failed") {
    return processEnvelope.recovery.policy === "none" ? "process.inspect" : "process.rollback";
  }
  if (healthReport.health.nextAction === "process.retry" && healthReport.health.retry.allowed) {
    return "process.retry";
  }
  if (healthReport.health.mode === "degraded") {
    return processEnvelope.commands.some((command) => command.command === "process.degraded-mode")
      ? "process.degraded-mode"
      : "process.verify";
  }
  if (auditReport.evidence.missing.length > 0) {
    return "process.verify";
  }
  if (status === "running") {
    return "process.verify";
  }
  if (status === "completed") {
    return processEnvelope.exportPolicy.enabled ? "audit.export.package" : "operator.review-complete";
  }
  return processEnvelope.readiness.nextAction;
}

function deriveRuntimeCommand(processEnvelope, status, healthReport) {
  if (status === "failed" && processEnvelope.recovery.policy !== "none") {
    return "process.rollback";
  }
  if (healthReport.health.nextAction === "process.retry" && healthReport.health.retry.allowed) {
    return "process.retry";
  }
  if (healthReport.health.mode === "degraded") {
    return processEnvelope.commands.some((command) => command.command === "process.degraded-mode")
      ? "process.degraded-mode"
      : "process.verify";
  }
  if (status === "ready") {
    return "process.start";
  }
  if (["running", "verifying"].includes(status)) {
    return "process.verify";
  }
  return null;
}

function deriveHandoffBlockers(processEnvelope, auditReport, status, boundaryViolations = [], healthReport = null) {
  const blockers = [];
  if (status === "blocked") {
    blockers.push(...processEnvelope.readiness.blockedReasons);
  }
  if (!processEnvelope.tenantBoundary.satisfied) {
    blockers.push(...processEnvelope.tenantBoundary.violations);
  }
  if (boundaryViolations.length > 0) {
    blockers.push(...boundaryViolations.map((violation) => violation.reason));
  }
  if (auditReport.evidence.missing.length > 0) {
    blockers.push(`${auditReport.evidence.missing.length} evidence receipt(s) missing`);
  }
  if (auditReport.boundary.externalWritesObserved.length > 0) {
    blockers.push(`${auditReport.boundary.externalWritesObserved.length} external write violation(s) observed`);
  }
  if (healthReport) {
    blockers.push(...healthReport.health.actionableErrors
      .filter((error) => error.action !== "process.retry" || !healthReport.health.retry.allowed)
      .map((error) => error.message));
  }
  return uniqueSorted(blockers);
}

function normalizeProcessStatus(status) {
  const normalized = String(status).trim().toLowerCase();
  if (!PROCESS_STATUSES.includes(normalized)) {
    throw new Error(`unsupported process status: ${status}`);
  }
  return normalized;
}

function normalizeProcessCommand(command) {
  const normalized = String(command).trim();
  return PROCESS_COMMANDS.includes(normalized) ? normalized : "package.settings.fix";
}

function assertCompiledProgram(compiledProgram) {
  if (!compiledProgram || typeof compiledProgram !== "object") {
    throw new Error("compiledProgram must be produced by compilePackageSource");
  }
  if (!compiledProgram.manifest || compiledProgram.manifest.kind !== "aios.package") {
    throw new Error("compiledProgram.manifest must be an AI OS package manifest");
  }
  if (!compiledProgram.job || compiledProgram.job.kind !== "aios.kernel.job") {
    throw new Error("compiledProgram.job must be an AI OS kernel job");
  }
  if (!compiledProgram.lifecycle || compiledProgram.lifecycle.kind !== "aios.package.lifecycle") {
    throw new Error("compiledProgram.lifecycle must be an AI OS package lifecycle");
  }
}

function assertProviderContract(contract) {
  if (!contract || contract.kind !== "aios.package.provider-service-contract") {
    throw new Error("providerContract must be produced by buildProviderServiceContract");
  }
}

function assertReadinessPreview(preview) {
  if (!preview || preview.kind !== "aios.package.readiness-preview") {
    throw new Error("readinessPreview must be produced by buildPackageReadinessPreview");
  }
}

function assertControlSurface(controlSurface) {
  if (!controlSurface || controlSurface.kind !== "aios.package.control-surface") {
    throw new Error("controlSurface must be produced by buildPackageControlSurface");
  }
}

function assertAuditHealthReport(report) {
  if (!report || report.kind !== "aios.audit.health-report") {
    throw new Error("healthReport must be produced by createAuditHealthReport");
  }
}

function assertProcessEnvelope(processEnvelope) {
  if (!processEnvelope || processEnvelope.kind !== "aios.process.envelope") {
    throw new Error("processEnvelope must be produced by createProcessEnvelope");
  }
}

function uniqueCommands(commands) {
  const byCommand = new Map();
  for (const command of commands) {
    const existing = byCommand.get(command.command);
    if (!existing || (!existing.ready && command.ready)) {
      byCommand.set(command.command, command);
    }
  }
  return [...byCommand.values()].sort((left, right) => left.command.localeCompare(right.command));
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))].sort();
}

function stableId(parts) {
  const text = parts.join("\u001f");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
