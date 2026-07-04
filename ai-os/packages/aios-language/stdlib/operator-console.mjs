import {
  createAuditExportPackage,
  createAuditExportSnapshot,
} from "./audit.mjs";
import {
  createProcessEnvelope,
  createProcessStatusHandoff,
  createProcessSelfCheck,
} from "./processes.mjs";

const CONSOLE_SECTIONS = Object.freeze([
  "overview",
  "readiness",
  "provider",
  "lifecycle",
  "evidence",
  "recovery",
  "boundary",
  "commands",
]);

export function buildOperatorConsoleModel(compiledProgram, options = {}) {
  const processEnvelope = options.processEnvelope
    ?? createProcessEnvelope(compiledProgram, options.processOptions ?? options);
  assertProcessEnvelope(processEnvelope);

  const statusHandoff = options.statusHandoff
    ?? createProcessStatusHandoff(processEnvelope, options.observations ?? {});
  assertStatusHandoff(statusHandoff);

  const auditExport = options.auditExport
    ?? createAuditExportSnapshot(buildAuditReportForExport(statusHandoff, options), {
      generatedAt: options.generatedAt ?? "logical:0",
      format: options.exportFormat ?? "json.summary",
      history: options.history ?? [],
    });
  const auditExportPackage = options.auditExportPackage
    ?? createAuditExportPackage(auditExport, {
      generatedAt: options.generatedAt ?? "logical:0",
      destination: {
        target: statusHandoff.export?.destination ?? processEnvelope.exportPolicy.destination,
        localOnly: true,
        channel: processEnvelope.tenantBoundary.auditChannel,
      },
      redaction: {
        mode: statusHandoff.export?.redaction ?? processEnvelope.exportPolicy.redaction,
      },
      retention: options.retention ?? {},
      historyWindow: options.historyWindow ?? {},
    });
  const selfCheck = createProcessSelfCheck(processEnvelope, statusHandoff);
  const selectedSection = normalizeSection(options.section ?? deriveSelectedSection(processEnvelope, statusHandoff));
  const modelId = `console_${stableId([
    processEnvelope.processId,
    statusHandoff.handoffId,
    auditExport.exportId,
    selectedSection,
  ])}`;

  return deepFreeze({
    kind: "aios.operator-console.model",
    apiVersion: "aios.console/v1",
    modelId,
    selectedSection,
    status: buildConsoleStatus(processEnvelope, statusHandoff, selfCheck),
    package: processEnvelope.package,
    jobId: processEnvelope.jobId,
    process: {
      processId: processEnvelope.processId,
      status: processEnvelope.status,
      runtimeCommand: processEnvelope.runtime.command,
      adapterStatus: statusHandoff.adapterStatus,
      healthMode: statusHandoff.health.mode,
      healthSummary: statusHandoff.health.summary,
      persistedStateId: processEnvelope.persistedState?.stateId ?? null,
      handoffPersistedStateId: statusHandoff.persistedState?.stateId ?? null,
    },
    provider: buildProviderPanel(processEnvelope, statusHandoff),
    boundary: buildBoundaryPanel(processEnvelope, statusHandoff),
    readiness: buildReadinessPanel(processEnvelope, selfCheck),
    auditDecision: buildAuditDecisionPanel(processEnvelope, statusHandoff),
    evidence: buildEvidencePanel(statusHandoff, auditExport),
    recovery: buildRecoveryPanel(processEnvelope, statusHandoff),
    mailchimp: buildMailchimpHandoffPanel(processEnvelope),
    lifecycle: buildLifecycleControlsPanel(processEnvelope, statusHandoff, selfCheck),
    commands: buildCommandPalette(processEnvelope, statusHandoff, selfCheck),
    sections: CONSOLE_SECTIONS.map((section) => buildSectionState(section, selectedSection, processEnvelope, statusHandoff)),
    export: {
      exportId: auditExport.exportId,
      ready: auditExport.truthBoundary.readyForExport,
      format: auditExport.format,
      summary: auditExport.summary,
      counters: auditExport.counters,
      analytics: buildConsoleAnalytics(processEnvelope, statusHandoff, auditExport),
      history: buildConsoleHistory(options.history ?? [], statusHandoff),
      package: buildExportPackagePanel(processEnvelope, statusHandoff, auditExport, auditExportPackage),
    },
  });
}

export function buildOperatorConsolePatch(previousModel, nextModel) {
  assertConsoleModel(previousModel, "previousModel");
  assertConsoleModel(nextModel, "nextModel");

  const changedSections = CONSOLE_SECTIONS.filter((section) => {
    const previousValue = JSON.stringify(previousModel[section] ?? null);
    const nextValue = JSON.stringify(nextModel[section] ?? null);
    return previousValue !== nextValue;
  });

  return deepFreeze({
    kind: "aios.operator-console.patch",
    apiVersion: "aios.console/v1",
    fromModelId: previousModel.modelId,
    toModelId: nextModel.modelId,
    changed: previousModel.modelId !== nextModel.modelId,
    changedSections,
    statusChanged: previousModel.status.label !== nextModel.status.label,
    commandDelta: diffCommands(previousModel.commands.items, nextModel.commands.items),
    nextFocus: changedSections.includes(nextModel.selectedSection)
      ? nextModel.selectedSection
      : changedSections[0] ?? nextModel.selectedSection,
  });
}

export function createOperatorConsoleSelfCheck(model) {
  assertConsoleModel(model, "model");
  const errors = [];
  const warnings = [];

  if (!CONSOLE_SECTIONS.includes(model.selectedSection)) {
    errors.push("selected console section is not registered");
  }
  if (model.status.severity === "blocked" && model.commands.primary?.ready) {
    warnings.push("blocked console has a ready primary command");
  }
  if (model.export.ready && model.evidence.missing.length > 0) {
    errors.push("audit export cannot be ready while evidence is missing");
  }
  if (model.boundary.satisfied === false && model.export.ready) {
    errors.push("audit export cannot be ready while tenant boundary is violated");
  }
  if (model.export.package.ready && model.export.ready === false) {
    errors.push("audit export package cannot be ready while base export is blocked");
  }
  if (model.export.package.localOnly !== true) {
    errors.push("audit export package must be local-only");
  }
  if (model.export.package.ready && model.commands.primary?.command !== "audit.export.package") {
    warnings.push("ready export package should prioritize audit.export.package");
  }
  if (model.status.health.mode === "degraded" && !model.lifecycle.retry.allowed && model.status.nextAction === "process.retry") {
    errors.push("console cannot select retry when retry control is not allowed");
  }
  if (model.status.health.mode === "failed" && model.recovery.shouldRollback && model.commands.primary?.command !== "process.rollback") {
    warnings.push("failed process should prioritize rollback command");
  }
  if (!model.commands.items.some((command) => command.command === model.commands.primary?.command)) {
    errors.push("primary command must be present in command palette");
  }
  if (model.lifecycle.controls.primaryCommand && model.commands.primary?.command !== model.lifecycle.controls.primaryCommand) {
    warnings.push("console primary command differs from process control surface primary command");
  }
  if (model.readiness.acceptance.required && !model.readiness.acceptance.accepted && model.commands.primary?.command !== "package.preview.accept") {
    warnings.push("pending preview acceptance should be the primary console command");
  }
  if (model.lifecycle.schedule.available && !model.lifecycle.controls.groups.schedule.some((control) => control.command === "package.schedule.next")) {
    errors.push("schedule panel must include package.schedule.next when scheduling is available");
  }
  if (model.provider.syncResume.persistence.localOnly !== true) {
    errors.push("provider sync resume state must be local-only");
  }
  if (
    model.provider.syncResume.provider.checkpoint !== model.provider.checkpoint
    && model.provider.syncResume.provider.checkpoint !== model.provider.health.checkpoint
    && model.provider.syncResume.provider.checkpointChanged !== true
  ) {
    errors.push("provider sync resume checkpoint must match or explicitly advance the visible provider checkpoint");
  }
  if (
    model.provider.syncResume.resume.command
    && !model.commands.items.some((command) => command.command === model.provider.syncResume.resume.command)
  ) {
    errors.push("provider sync resume command must be present in command palette");
  }
  if (
    model.provider.syncResume.resume.available
    && model.provider.syncResume.resume.command === "process.retry"
    && !model.lifecycle.retry.allowed
  ) {
    errors.push("provider sync resume cannot retry when retry is not allowed");
  }
  if (
    model.provider.syncResume.replay.externalWritesObserved > 0
    && model.provider.syncResume.resume.command !== "process.rollback"
  ) {
    errors.push("provider sync resume must select rollback after external writes are observed");
  }
  if (model.auditDecision.handoff.localOnly !== true) {
    errors.push("audit decision handoff must remain local-only");
  }
  if (
    model.auditDecision.ready
    && model.auditDecision.acceptance.accepted !== true
  ) {
    errors.push("ready audit decision requires accepted operator review");
  }
  if (
    model.auditDecision.ready
    && model.auditDecision.command !== "audit.export.package"
  ) {
    errors.push("ready audit decision must hand off through audit.export.package");
  }
  if (
    model.auditDecision.command
    && !model.commands.items.some((command) => command.command === model.auditDecision.command)
  ) {
    errors.push("audit decision command must be present in command palette");
  }
  if (
    model.auditDecision.handoff.packageId
    && model.export.package.packageId
    && model.auditDecision.handoff.packageId !== model.export.package.packageId
  ) {
    errors.push("audit decision packageId must match export package panel");
  }
  if (model.mailchimp.available) {
    if (model.mailchimp.truthBoundary.localOnly !== true) {
      errors.push("Mailchimp console handoff must remain local-only");
    }
    if (model.mailchimp.ready && model.mailchimp.blockedReasons.length > 0) {
      errors.push("ready Mailchimp console handoff cannot include blocked reasons");
    }
    if (
      model.mailchimp.nextAction
      && !model.commands.items.some((command) => command.command === model.mailchimp.nextAction)
      && model.mailchimp.nextAction !== "process.start"
    ) {
      errors.push("Mailchimp console handoff nextAction must be available in command palette");
    }
    if (model.mailchimp.approvalPreview.localOnly !== true) {
      errors.push("Mailchimp approval preview must remain local-only in the console model");
    }
    if (model.mailchimp.ready !== model.mailchimp.approvalPreview.ready) {
      errors.push("Mailchimp approval preview readiness must match console handoff readiness");
    }
    if (
      model.mailchimp.approvalPreview.ready
      && model.mailchimp.approvalPreview.exportSummary.readyForExport !== true
    ) {
      errors.push("ready Mailchimp approval preview must be export-ready");
    }
    if (model.mailchimp.approvalPreview.claimPreview.localOnly !== true) {
      errors.push("Mailchimp claim readiness preview must remain local-only in the console model");
    }
    if (model.mailchimp.approvalPreview.adoptionPlan.localOnly !== true) {
      errors.push("Mailchimp approval adoption plan must remain local-only in the console model");
    }
    if (
      model.mailchimp.approvalPreview.adoptionPlan.ready
      && model.mailchimp.approvalPreview.ready !== true
    ) {
      errors.push("Mailchimp adoption plan cannot be ready while approval preview is blocked");
    }
    if (
      model.mailchimp.approvalPreview.adoptionPlan.ready
      && model.mailchimp.approvalPreview.claimPreview.ready !== true
    ) {
      errors.push("Mailchimp adoption plan requires ready claim preview");
    }
    if (model.mailchimp.approvalPreview.acceptanceReceipt.localOnly !== true) {
      errors.push("Mailchimp acceptance receipt must remain local-only in the console model");
    }
    if (
      model.mailchimp.approvalPreview.acceptanceReceipt.ready
      && model.mailchimp.approvalPreview.ready !== true
    ) {
      errors.push("Mailchimp acceptance receipt cannot be ready while approval preview is blocked");
    }
    if (
      model.mailchimp.approvalPreview.acceptanceReceipt.ready
      && model.mailchimp.approvalPreview.acceptanceReceipt.scope.workspaceId !== model.boundary.workspaceId
    ) {
      errors.push("Mailchimp acceptance receipt workspace must match console tenant boundary");
    }
    if (
      model.mailchimp.approvalPreview.acceptanceReceipt.ready
      && model.mailchimp.approvalPreview.acceptanceReceipt.auditHandoff.command !== "process.start"
    ) {
      errors.push("ready Mailchimp acceptance receipt must hand off through process.start");
    }
    if (model.mailchimp.externalHandoff.localOnly !== true) {
      errors.push("Mailchimp external handoff receipt must remain local-only before adapter execution");
    }
    if (model.mailchimp.externalHandoff.ready && model.mailchimp.ready !== true) {
      errors.push("Mailchimp external handoff cannot be ready while approval handoff is blocked");
    }
    if (
      model.mailchimp.externalHandoff.ready
      && model.mailchimp.approvalPreview.adoptionPlan.ready !== true
    ) {
      errors.push("Mailchimp external handoff requires a ready adoption plan");
    }
    if (
      model.mailchimp.externalHandoff.ready
      && model.mailchimp.externalHandoff.command !== "process.start"
    ) {
      errors.push("ready Mailchimp external handoff must start the local runtime process");
    }
    if (
      model.mailchimp.externalHandoff.nextAction
      && !model.commands.items.some((command) => command.command === model.mailchimp.externalHandoff.nextAction)
      && model.mailchimp.externalHandoff.nextAction !== "process.start"
    ) {
      errors.push("Mailchimp external handoff nextAction must be available in command palette");
    }
    if (
      model.mailchimp.externalHandoff.restartSafe
      && !model.mailchimp.externalHandoff.idempotencyKey
    ) {
      errors.push("restart-safe Mailchimp external handoff requires an idempotency key");
    }
    if (model.mailchimp.clientRuntimeAdoption.localOnly !== true) {
      errors.push("Mailchimp client runtime adoption receipt must remain local-only");
    }
    if (
      model.mailchimp.clientRuntimeAdoption.ready
      && model.mailchimp.externalHandoff.ready !== true
    ) {
      errors.push("Mailchimp client runtime adoption cannot be ready while external handoff is blocked");
    }
    if (
      model.mailchimp.clientRuntimeAdoption.ready
      && model.mailchimp.approvalPreview.acceptanceReceipt.ready !== true
    ) {
      errors.push("Mailchimp client runtime adoption requires a ready acceptance receipt");
    }
    if (
      model.mailchimp.clientRuntimeAdoption.ready
      && model.mailchimp.clientRuntimeAdoption.command !== "process.start"
    ) {
      errors.push("ready Mailchimp client runtime adoption must start the local process");
    }
    if (
      model.mailchimp.clientRuntimeAdoption.ready
      && model.mailchimp.clientRuntimeAdoption.clientState.primaryCommand !== "process.start"
    ) {
      errors.push("ready Mailchimp client runtime adoption must expose process.start as primary client command");
    }
    if (
      model.mailchimp.clientRuntimeAdoption.ready
      && !model.mailchimp.clientRuntimeAdoption.idempotencyKey
    ) {
      errors.push("ready Mailchimp client runtime adoption requires an idempotency key");
    }
    if (
      model.mailchimp.clientRuntimeAdoption.ready
      && model.mailchimp.clientRuntimeAdoption.scope.workspaceId !== model.boundary.workspaceId
    ) {
      errors.push("Mailchimp client runtime adoption workspace must match console tenant boundary");
    }
    if (
      model.mailchimp.clientRuntimeAdoption.ready
      && model.mailchimp.clientRuntimeAdoption.persistence.persistedMatches === false
    ) {
      errors.push("ready Mailchimp client runtime adoption must match persisted process state");
    }
    if (model.mailchimp.providerSyncManifest.localOnly !== true) {
      errors.push("Mailchimp provider sync manifest must remain local-only in the console model");
    }
    if (
      model.mailchimp.providerSyncManifest.ready
      && model.mailchimp.providerSyncManifest.command !== "provider.sync.record"
    ) {
      errors.push("ready Mailchimp provider sync manifest must record sync state before adapter handoff");
    }
    if (
      model.mailchimp.providerSyncManifest.ready
      && model.mailchimp.providerSyncManifest.restartSafe !== true
    ) {
      errors.push("ready Mailchimp provider sync manifest must be restart-safe");
    }
    if (
      model.mailchimp.providerSyncManifest.ready
      && model.mailchimp.providerSyncManifest.persistence.namespace !== model.provider.syncResume.persistence.namespace
    ) {
      errors.push("Mailchimp provider sync manifest namespace must match provider sync resume namespace");
    }
    if (
      model.mailchimp.providerSyncManifest.ready
      && model.mailchimp.providerSyncManifest.provider.checkpoint !== model.provider.checkpoint
    ) {
      errors.push("Mailchimp provider sync manifest checkpoint must match visible provider checkpoint");
    }
    if (
      model.mailchimp.approvalPreview.adoptionPlan.nextAction
      && !model.commands.items.some((command) => (
        command.command === model.mailchimp.approvalPreview.adoptionPlan.nextAction
      ))
      && model.mailchimp.approvalPreview.adoptionPlan.nextAction !== "process.start"
    ) {
      errors.push("Mailchimp adoption plan nextAction must be available in command palette");
    }
  }

  return deepFreeze({
    kind: "aios.operator-console.self-check",
    apiVersion: "aios.console/v1",
    modelId: model.modelId,
    valid: errors.length === 0,
    errors: uniqueSorted(errors),
    warnings: uniqueSorted(warnings),
    checked: {
      sections: model.sections.length,
      commands: model.commands.items.length,
      exportReady: model.export.ready,
      selectedSection: model.selectedSection,
      tenantBoundarySatisfied: model.boundary.satisfied,
      healthMode: model.status.health.mode,
      exportPackageReady: model.export.package.ready,
      exportDestination: model.export.package.destination,
      retryAllowed: model.lifecycle.retry.allowed,
      degradedModeAllowed: model.lifecycle.degradedMode.allowed,
      controlSurfaceStatus: model.lifecycle.controls.status,
      acceptanceRequired: model.readiness.acceptance.required,
      acceptanceAccepted: model.readiness.acceptance.accepted,
      providerSyncLocalOnly: model.provider.syncResume.persistence.localOnly,
      providerSyncStateId: model.provider.syncResume.persistence.stateId,
      providerSyncResumeCommand: model.provider.syncResume.resume.command,
      providerSyncReplayToken: model.provider.syncResume.replay.token,
      auditDecisionStatus: model.auditDecision.status,
      auditDecisionReady: model.auditDecision.ready,
      auditDecisionCommand: model.auditDecision.command,
      auditDecisionAccepted: model.auditDecision.acceptance.accepted,
      mailchimpHandoffAvailable: model.mailchimp.available,
      mailchimpHandoffStatus: model.mailchimp.status,
      mailchimpHandoffReady: model.mailchimp.ready,
      mailchimpHandoffNextAction: model.mailchimp.nextAction,
      mailchimpApprovalPreviewStatus: model.mailchimp.approvalPreview.status,
      mailchimpApprovalPreviewReady: model.mailchimp.approvalPreview.ready,
      mailchimpApprovalPending: model.mailchimp.approvalPreview.counters.pending,
      mailchimpApprovalDenied: model.mailchimp.approvalPreview.counters.denied,
      mailchimpClaimPreviewReady: model.mailchimp.approvalPreview.claimPreview.ready,
      mailchimpAdoptionPlanReady: model.mailchimp.approvalPreview.adoptionPlan.ready,
      mailchimpAdoptionPlanNextAction: model.mailchimp.approvalPreview.adoptionPlan.nextAction,
      mailchimpAcceptanceReceiptStatus: model.mailchimp.approvalPreview.acceptanceReceipt.status,
      mailchimpAcceptanceReceiptReady: model.mailchimp.approvalPreview.acceptanceReceipt.ready,
      mailchimpExternalHandoffStatus: model.mailchimp.externalHandoff.status,
      mailchimpExternalHandoffReady: model.mailchimp.externalHandoff.ready,
      mailchimpExternalHandoffCommand: model.mailchimp.externalHandoff.command,
      mailchimpExternalHandoffRestartSafe: model.mailchimp.externalHandoff.restartSafe,
      mailchimpClientRuntimeAdoptionStatus: model.mailchimp.clientRuntimeAdoption.status,
      mailchimpClientRuntimeAdoptionReady: model.mailchimp.clientRuntimeAdoption.ready,
      mailchimpClientRuntimeAdoptionCommand: model.mailchimp.clientRuntimeAdoption.command,
      mailchimpClientRuntimeAdoptionRestartSafe: model.mailchimp.clientRuntimeAdoption.restartSafe,
      mailchimpClientRuntimeAdoptionPersistedMatches: model.mailchimp.clientRuntimeAdoption.persistence.persistedMatches,
      mailchimpProviderSyncStatus: model.mailchimp.providerSyncManifest.status,
      mailchimpProviderSyncReady: model.mailchimp.providerSyncManifest.ready,
      mailchimpProviderSyncRestartSafe: model.mailchimp.providerSyncManifest.restartSafe,
      mailchimpProviderSyncCommand: model.mailchimp.providerSyncManifest.command,
    },
  });
}

function buildConsoleStatus(processEnvelope, statusHandoff, selfCheck) {
  const severity = deriveSeverity(processEnvelope, statusHandoff, selfCheck);
  return {
    label: statusHandoff.status,
    severity,
    badge: severity === "ok"
      ? "ready"
      : severity === "warning"
        ? "attention"
        : "blocked",
    nextAction: statusHandoff.nextAction,
    health: {
      mode: statusHandoff.health.mode,
      severity: statusHandoff.health.severity,
      summary: statusHandoff.health.summary,
      readyForExport: statusHandoff.health.readyForExport,
      retryRemaining: statusHandoff.health.retry.remaining,
      adapterStatus: statusHandoff.health.adapter.status,
    },
    blockedReasons: uniqueSorted([
      ...processEnvelope.readiness.blockedReasons,
      ...statusHandoff.blockedReasons,
      ...selfCheck.errors,
    ]),
  };
}

function buildProviderPanel(processEnvelope, statusHandoff) {
  return {
    title: "Mailchimp provider",
    name: processEnvelope.provider.name,
    adapter: processEnvelope.provider.adapter,
    mode: processEnvelope.provider.mode,
    checkpoint: processEnvelope.provider.checkpoint,
    cursor: processEnvelope.provider.cursor,
    scopes: processEnvelope.provider.scopes,
    status: statusHandoff.adapterStatus,
    health: {
      mode: statusHandoff.health.mode,
      adapterStatus: statusHandoff.health.adapter.status,
      retryAfter: statusHandoff.health.adapter.retryAfter,
      checkpoint: statusHandoff.health.adapter.checkpoint ?? processEnvelope.provider.checkpoint,
      nextAction: statusHandoff.health.nextAction,
    },
    syncResume: buildProviderSyncResumePanel(processEnvelope, statusHandoff),
    localOnly: processEnvelope.runtime.memoryWritePolicy === "local-only",
    workspaceId: processEnvelope.tenantBoundary.workspaceId,
  };
}

function buildProviderSyncResumePanel(processEnvelope, statusHandoff) {
  const processState = processEnvelope.persistedState ?? {};
  const handoffState = statusHandoff.persistedState ?? processState;
  const resume = handoffState.resume ?? processState.resume ?? {};
  const replay = handoffState.replay ?? processState.replay ?? {};
  const provider = handoffState.provider ?? processState.provider ?? {};
  const storage = handoffState.storage ?? processState.storage ?? {};
  const checkpoint = provider.checkpoint ?? processEnvelope.provider.checkpoint;
  const resumeCommand = resume.command ?? null;
  const command = resumeCommand
    ? processEnvelope.commands.find((item) => item.command === resumeCommand)
    : null;
  const blockedReasons = deriveProviderSyncResumeBlockers(
    processEnvelope,
    statusHandoff,
    resume,
    storage,
    command,
  );

  return {
    title: "Mailchimp sync resume",
    provider: {
      name: provider.name ?? processEnvelope.provider.name,
      adapter: provider.adapter ?? processEnvelope.provider.adapter,
      mode: provider.mode ?? processEnvelope.provider.mode,
      cursor: provider.cursor ?? processEnvelope.provider.cursor,
      checkpoint,
      previousCheckpoint: provider.previousCheckpoint ?? processState.provider?.checkpoint ?? null,
      checkpointChanged: Boolean(provider.checkpointChanged ?? false),
      scopes: provider.scopes ?? processEnvelope.provider.scopes,
    },
    persistence: {
      stateId: handoffState.stateId ?? processState.stateId ?? null,
      previousStateId: handoffState.previousStateId ?? processState.previousStateId ?? null,
      namespace: storage.namespace ?? processEnvelope.runtime.memoryNamespace,
      key: storage.key ?? null,
      localOnly: storage.localOnly === true,
      writePolicy: storage.writePolicy ?? processEnvelope.runtime.memoryWritePolicy,
    },
    replay: {
      token: replay.token ?? resume.replayToken ?? null,
      idempotencyKey: replay.idempotencyKey ?? null,
      evidenceFingerprint: replay.evidenceFingerprint ?? null,
      exportId: replay.exportId ?? null,
      missingEvidence: replay.missingEvidence ?? statusHandoff.evidence.missing,
      externalWritesObserved: Number(replay.externalWritesObserved ?? statusHandoff.truthBoundary.externalWritesObserved.length),
    },
    resume: {
      available: Boolean(resume.available) && blockedReasons.length === 0,
      command: resumeCommand,
      commandReady: Boolean(command?.ready),
      reason: blockedReasons[0] ?? resume.reason ?? "no persisted resume state is available",
      retryAfter: resume.retryAfter ?? statusHandoff.health.adapter.retryAfter,
      requiresOperatorReview: Boolean(resume.requiresOperatorReview),
      nextAction: blockedReasons.length > 0
        ? "process.inspect"
        : resumeCommand ?? statusHandoff.nextAction,
    },
    blockedReasons,
  };
}

function buildBoundaryPanel(processEnvelope, statusHandoff) {
  const observedViolations = statusHandoff.tenantBoundary?.observedViolations ?? [];
  const configuredViolations = processEnvelope.tenantBoundary.violations ?? [];
  const satisfied = processEnvelope.tenantBoundary.satisfied
    && statusHandoff.tenantBoundary?.satisfied !== false
    && observedViolations.length === 0;

  return {
    title: "Tenant boundary",
    tenantId: processEnvelope.tenantBoundary.tenantId,
    workspaceId: processEnvelope.tenantBoundary.workspaceId,
    homeWorkspaceId: processEnvelope.tenantBoundary.homeWorkspaceId,
    role: processEnvelope.tenantBoundary.role,
    permissions: processEnvelope.tenantBoundary.permissions,
    allowedWorkspaces: processEnvelope.tenantBoundary.allowedWorkspaces,
    auditChannel: processEnvelope.tenantBoundary.auditChannel,
    isolationMode: processEnvelope.tenantBoundary.isolationMode,
    satisfied,
    badge: satisfied ? "scoped" : "blocked",
    violations: uniqueSorted([
      ...configuredViolations,
      ...observedViolations.map((violation) => violation.reason),
    ]),
    nextAction: satisfied ? "audit.export" : "package.settings.fix",
  };
}

function buildReadinessPanel(processEnvelope, selfCheck) {
  return {
    ready: processEnvelope.readiness.ready && selfCheck.valid,
    status: processEnvelope.readiness.status,
    nextAction: processEnvelope.readiness.nextAction,
    reason: processEnvelope.readiness.reason,
    visibleStatus: processEnvelope.clientState?.visibleStatus ?? processEnvelope.readiness.status,
    primaryCommand: processEnvelope.clientState?.primaryCommand ?? null,
    acceptance: {
      required: Boolean(processEnvelope.clientState?.acceptance?.required),
      accepted: Boolean(processEnvelope.clientState?.acceptance?.accepted),
      command: processEnvelope.clientState?.acceptance?.command ?? null,
      blockedReason: processEnvelope.clientState?.acceptance?.accepted
        ? null
        : processEnvelope.readiness.reason,
    },
    controls: {
      primaryCommand: processEnvelope.controls?.primaryCommand ?? processEnvelope.clientState?.nextAction ?? null,
      disabledReason: processEnvelope.controls?.disabledReason ?? null,
      preview: selectConsoleControlGroup(processEnvelope, "preview"),
      package: selectConsoleControlGroup(processEnvelope, "package"),
    },
    blockedReasons: uniqueSorted([
      ...processEnvelope.readiness.blockedReasons,
      ...selfCheck.errors,
    ]),
    checks: selfCheck.checked,
  };
}

function buildAuditDecisionPanel(processEnvelope, statusHandoff) {
  const decision = statusHandoff.auditDecision ?? buildFallbackAuditDecision(statusHandoff);
  const persisted = statusHandoff.persistedState?.decision ?? {};
  const persistedMatches = !persisted.decisionId || persisted.decisionId === decision.decisionId;
  const blockedReasons = uniqueSorted([
    ...(decision.blockedReasons ?? decision.validationSummary?.blockedReasons ?? []),
    ...(persistedMatches ? [] : ["persisted audit decision does not match current status handoff"]),
  ]);
  const ready = Boolean(decision.ready)
    && persistedMatches
    && statusHandoff.export?.ready === true
    && processEnvelope.commands.some((command) => command.command === "audit.export.package");

  return {
    title: "Audit decision",
    decisionId: decision.decisionId,
    status: decision.status,
    ready,
    badge: ready
      ? "accepted"
      : decision.acceptance?.required && !decision.acceptance?.accepted
        ? "review"
        : blockedReasons.length > 0 ? "blocked" : "attention",
    command: ready
      ? "audit.export.package"
      : decision.nextAction ?? "operator.review",
    message: decision.preview?.message ?? blockedReasons.join("; ") ?? statusHandoff.health.summary,
    preview: {
      badge: decision.preview?.badge ?? "blocked",
      primaryAction: decision.preview?.primaryAction ?? decision.nextAction,
      secondaryActions: decision.preview?.secondaryActions ?? [],
      counters: decision.preview?.counters ?? {
        acceptedEvidence: statusHandoff.evidence.accepted,
        missingEvidence: statusHandoff.evidence.missing.length,
        rejectedEvidence: statusHandoff.evidence.rejected.length,
        externalWriteViolations: statusHandoff.truthBoundary.externalWritesObserved.length,
        boundaryViolations: statusHandoff.tenantBoundary?.observedViolations?.length ?? 0,
      },
    },
    acceptance: {
      required: Boolean(decision.acceptance?.required),
      accepted: Boolean(decision.acceptance?.accepted),
      acceptedBy: decision.acceptance?.acceptedBy ?? null,
      acceptedAt: decision.acceptance?.acceptedAt ?? null,
      command: decision.acceptance?.command ?? (
        decision.acceptance?.required && !decision.acceptance?.accepted ? "audit.preview.accept" : null
      ),
      blockedReasons: decision.acceptance?.blockedReasons ?? blockedReasons,
    },
    validationSummary: decision.validationSummary ?? {
      valid: blockedReasons.length === 0,
      errors: blockedReasons,
      warnings: [],
      blockedReasons,
      checked: {},
    },
    handoff: {
      localOnly: decision.handoff?.localOnly !== false,
      exportId: decision.handoff?.exportId ?? statusHandoff.export?.exportId ?? null,
      packageId: decision.handoff?.packageId ?? statusHandoff.export?.packageId ?? null,
      destination: decision.handoff?.destination ?? statusHandoff.export?.destination ?? null,
      redaction: decision.handoff?.redaction ?? statusHandoff.export?.redaction ?? null,
    },
    persistence: {
      stateId: statusHandoff.persistedState?.stateId ?? null,
      decisionId: persisted.decisionId ?? null,
      persistedMatches,
      acceptedAt: persisted.acceptedAt ?? null,
    },
    nextSteps: decision.nextSteps ?? blockedReasons.map((reason) => ({
      action: decision.nextAction ?? "operator.review",
      label: "Resolve audit decision blocker",
      reason,
    })),
    blockedReasons,
  };
}

function buildEvidencePanel(statusHandoff, auditExport) {
  return {
    accepted: statusHandoff.evidence.accepted,
    missing: statusHandoff.evidence.missing,
    rejected: statusHandoff.evidence.rejected,
    externalWritesObserved: statusHandoff.truthBoundary.externalWritesObserved,
    boundaryViolations: statusHandoff.tenantBoundary?.observedViolations ?? [],
    exportReady: auditExport.truthBoundary.readyForExport,
    nextAction: statusHandoff.tenantBoundary?.satisfied === false
      ? "package.settings.fix"
      : statusHandoff.evidence.missing.length > 0 ? "process.verify" : "audit.export",
  };
}

function buildRecoveryPanel(processEnvelope, statusHandoff) {
  return {
    policy: processEnvelope.recovery.policy,
    shouldSnapshot: processEnvelope.recovery.shouldSnapshot,
    shouldRollback: statusHandoff.recovery.shouldRollback,
    rollbackStatus: statusHandoff.recovery.rollbackStatus,
    command: statusHandoff.recovery.command,
    lastKnownStatus: statusHandoff.recovery.lastKnownStatus,
    adapterCheckpoint: processEnvelope.recovery.adapterCheckpoint,
    retry: {
      allowed: statusHandoff.recovery.retry.allowed,
      attempt: statusHandoff.recovery.retry.attempt,
      remaining: statusHandoff.recovery.retry.remaining,
      backoffSlot: statusHandoff.recovery.retry.backoffSlot,
      command: statusHandoff.recovery.retry.allowed ? "process.retry" : null,
      reason: statusHandoff.recovery.retry.reason,
    },
    degradedMode: statusHandoff.recovery.degradedMode,
    resume: {
      available: Boolean(statusHandoff.recovery.resume?.available),
      command: statusHandoff.recovery.resume?.command ?? null,
      checkpoint: statusHandoff.recovery.resume?.checkpoint ?? processEnvelope.provider.checkpoint,
      replayToken: statusHandoff.recovery.resume?.replayToken ?? null,
      requiresOperatorReview: Boolean(statusHandoff.recovery.resume?.requiresOperatorReview),
      reason: statusHandoff.recovery.resume?.reason ?? "no recovery resume state is available",
    },
  };
}

function buildMailchimpHandoffPanel(processEnvelope) {
  const handoff = processEnvelope.adapterContracts?.mailchimp ?? null;
  const approvalPreview = processEnvelope.adapterContracts?.mailchimpApprovalPreview
    ?? processEnvelope.clientState?.mailchimpApproval
    ?? null;
  if (!handoff) {
    return {
      title: "Mailchimp handoff",
      available: false,
      ready: false,
      status: "not-attached",
      adapterStatus: null,
      nextAction: null,
      counts: {
        required: 0,
        approved: 0,
        pending: 0,
        denied: 0,
        commandCount: 0,
      },
      approvals: [],
      claimHandoff: null,
      commands: [],
      blockedReasons: [],
      recovery: [],
      approvalPreview: buildEmptyMailchimpApprovalPreview(),
      externalHandoff: buildEmptyConsoleMailchimpExternalHandoff(),
      clientRuntimeAdoption: buildEmptyConsoleMailchimpClientRuntimeAdoption(),
      providerSyncManifest: buildEmptyConsoleProviderSyncManifest(),
      truthBoundary: {
        localOnly: true,
        externalWritesPermitted: false,
        externalWritesObserved: [],
      },
    };
  }

  return {
    title: "Mailchimp handoff",
    available: true,
    ready: Boolean(handoff.ready),
    status: handoff.status,
    adapterStatus: handoff.adapterStatus,
    nextAction: handoff.nextAction,
    counts: handoff.counts,
    approvals: handoff.approvals,
    approvalPreview: buildConsoleMailchimpApprovalPreview(approvalPreview, handoff),
    externalHandoff: buildConsoleMailchimpExternalHandoff(
      processEnvelope.adapterContracts?.mailchimpExternalHandoff
        ?? approvalPreview?.externalHandoff
        ?? handoff.externalHandoff,
      handoff,
      approvalPreview,
    ),
    clientRuntimeAdoption: buildConsoleMailchimpClientRuntimeAdoption(
      processEnvelope.adapterContracts?.mailchimpClientRuntimeAdoption
        ?? approvalPreview?.clientRuntimeAdoption
        ?? handoff.clientRuntimeAdoption,
      {
        handoff,
        approvalPreview,
        persisted: processEnvelope.persistedState?.mailchimpClientRuntimeAdoption ?? null,
        tenantBoundary: processEnvelope.tenantBoundary,
      },
    ),
    providerSyncManifest: buildConsoleProviderSyncManifest(
      processEnvelope.adapterContracts?.mailchimpProviderSyncManifest
        ?? handoff.providerSyncManifest
        ?? processEnvelope.provider?.syncManifest,
      {
        handoff,
        provider: processEnvelope.provider,
        syncResume: processEnvelope.persistedState?.provider ?? null,
        runtime: processEnvelope.runtime,
      },
    ),
    claimHandoff: handoff.claimHandoff,
    commands: handoff.commands,
    blockedReasons: handoff.blockedReasons,
    recovery: handoff.recovery.map((entry) => ({
      code: entry.code,
      command: entry.command,
      action: entry.action,
      restartSafe: entry.restartSafe,
      approvalId: entry.approvalId ?? null,
      kind: entry.kind ?? null,
    })),
    truthBoundary: handoff.truthBoundary,
  };
}

function buildEmptyConsoleMailchimpExternalHandoff() {
  return {
    title: "Mailchimp external handoff",
    available: false,
    receiptId: null,
    status: "not-attached",
    ready: false,
    badge: "blocked",
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
    acceptanceReceipt: buildEmptyConsoleMailchimpAcceptanceReceipt(),
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
    localOnly: true,
    blockedReasons: [],
  };
}

function buildConsoleMailchimpExternalHandoff(state, handoff, approvalPreview) {
  const fallback = buildEmptyConsoleMailchimpExternalHandoff();
  if (!state) {
    const blockedReasons = uniqueSorted([
      ...(handoff?.blockedReasons ?? []),
      ...(approvalPreview?.blockedReasons ?? []),
    ]);
    return {
      ...fallback,
      available: Boolean(handoff),
      status: handoff?.ready ? "ready_for_adapter" : handoff?.status ?? fallback.status,
      ready: Boolean(handoff?.ready) && approvalPreview?.adoptionPlan?.ready === true && blockedReasons.length === 0,
      badge: handoff?.ready ? "armed" : "blocked",
      command: handoff?.ready ? "process.start" : handoff?.nextAction ?? null,
      nextAction: handoff?.ready ? "process.start" : handoff?.nextAction ?? null,
      blockedReasons,
      persistence: {
        ...fallback.persistence,
        command: handoff?.ready ? "process.start" : handoff?.nextAction ?? null,
        blockedReasons,
      },
    };
  }

  const blockedReasons = uniqueSorted([
    ...(state.persistence?.blockedReasons ?? []),
    ...(handoff?.blockedReasons ?? []),
    ...(approvalPreview?.adoptionPlan?.blockedReasons ?? []),
  ]);
  const ready = state.ready === true
    && handoff?.ready === true
    && approvalPreview?.adoptionPlan?.ready === true
    && blockedReasons.length === 0;
  return {
    title: "Mailchimp external handoff",
    available: true,
    receiptId: state.receiptId ?? null,
    status: state.status ?? (ready ? "ready_for_adapter" : "blocked"),
    ready,
    badge: ready ? "armed" : blockedReasons.length > 0 ? "blocked" : "review",
    command: state.command ?? (ready ? "process.start" : handoff?.nextAction ?? null),
    nextAction: state.nextAction ?? state.command ?? (ready ? "process.start" : handoff?.nextAction ?? null),
    restartSafe: ready && state.restartSafe === true,
    idempotencyKey: state.idempotencyKey ?? null,
    approvalFingerprint: state.approvalFingerprint ?? null,
    operator: state.operator ?? approvalPreview?.acceptance?.acceptedBy ?? null,
    acceptedAt: state.acceptedAt ?? approvalPreview?.acceptance?.acceptedAt ?? null,
    sync: {
      checkpoint: state.sync?.checkpoint ?? null,
      cursor: state.sync?.cursor ?? "",
      mode: ready ? "external-write-armed" : state.sync?.mode ?? "local-preview",
      externalWrite: {
        permitted: ready,
        observed: state.sync?.externalWrite?.observed ?? [],
        operation: state.sync?.externalWrite?.operation ?? "mailchimp.campaign.handoff",
      },
    },
    approvalState: {
      required: Number(state.approvalState?.required ?? handoff?.counts?.required ?? 0),
      approved: Number(state.approvalState?.approved ?? handoff?.counts?.approved ?? 0),
      pending: state.approvalState?.pending ?? [],
      denied: state.approvalState?.denied ?? [],
      acceptedRecords: state.approvalState?.acceptedRecords ?? approvalPreview?.acceptance?.records ?? [],
      acceptanceReceiptId: state.approvalState?.acceptanceReceiptId
        ?? approvalPreview?.acceptanceReceipt?.receiptId
        ?? null,
    },
    acceptanceReceipt: buildConsoleMailchimpAcceptanceReceipt(
      state.acceptanceReceipt ?? approvalPreview?.acceptanceReceipt,
      {
        handoff,
        preview: approvalPreview,
        claimPreview: approvalPreview?.claimPreview ?? {
          ready: Boolean(state.claimState?.ready ?? handoff?.claimHandoff?.ready),
        },
        adoptionPlan: approvalPreview?.adoptionPlan ?? {
          ready: false,
        },
        blockedReasons,
        nextAction: state.nextAction ?? handoff?.nextAction ?? null,
      },
    ),
    claimState: {
      status: state.claimState?.status ?? handoff?.claimHandoff?.status ?? "not-attached",
      ready: Boolean(state.claimState?.ready ?? handoff?.claimHandoff?.ready),
      missingFacts: state.claimState?.missingFacts ?? handoff?.claimHandoff?.missingFacts ?? [],
      missingEvidence: state.claimState?.missingEvidence ?? handoff?.claimHandoff?.missingEvidence ?? [],
    },
    persistence: {
      localOnly: state.persistence?.localOnly !== false,
      stateKey: state.persistence?.stateKey ?? null,
      resumeToken: state.persistence?.resumeToken ?? null,
      command: state.persistence?.command ?? state.command ?? null,
      blockedReasons,
    },
    nextSteps: state.nextSteps ?? blockedReasons.map((reason) => ({
      action: state.nextAction ?? handoff?.nextAction ?? "process.inspect",
      label: "Resolve Mailchimp external handoff blocker",
      reason,
    })),
    localOnly: state.persistence?.localOnly !== false && state.truthBoundary?.localOnly !== false,
    blockedReasons,
  };
}

function buildEmptyConsoleMailchimpClientRuntimeAdoption() {
  return {
    title: "Mailchimp client runtime adoption",
    available: false,
    receiptId: null,
    status: "not-attached",
    ready: false,
    badge: "blocked",
    command: null,
    nextAction: null,
    restartSafe: false,
    localOnly: true,
    idempotencyKey: null,
    statusToken: null,
    scope: {
      tenantId: null,
      workspaceId: null,
      sourceId: null,
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
      persistedMatches: false,
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
    blockedReasons: [],
  };
}

function buildConsoleMailchimpClientRuntimeAdoption(receipt, context) {
  const fallback = buildEmptyConsoleMailchimpClientRuntimeAdoption();
  if (!receipt) {
    return {
      ...fallback,
      available: Boolean(context.handoff),
      status: context.handoff?.ready ? "missing_receipt" : context.handoff?.status ?? fallback.status,
      nextAction: context.handoff?.nextAction ?? null,
      blockedReasons: context.handoff?.ready
        ? ["Mailchimp client runtime adoption receipt is missing"]
        : context.handoff?.blockedReasons ?? [],
    };
  }

  const persisted = context.persisted ?? {};
  const persistedMatches = !persisted.receiptId || persisted.receiptId === receipt.receiptId;
  const blockedReasons = uniqueSorted([
    ...(receipt.validationSummary?.blockedReasons ?? []),
    ...(receipt.validationSummary?.errors ?? []),
    ...(receipt.persistence?.blockedReasons ?? []),
    ...(context.handoff?.blockedReasons ?? []),
    ...(persistedMatches ? [] : ["persisted Mailchimp client runtime adoption receipt does not match current handoff"]),
    ...(receipt.scope?.workspaceId === context.tenantBoundary?.workspaceId
      ? []
      : ["Mailchimp client runtime adoption workspace does not match tenant boundary"]),
  ]);
  const ready = receipt.ready === true
    && context.handoff?.ready === true
    && persistedMatches
    && blockedReasons.length === 0;
  const nextAction = ready ? "process.start" : receipt.nextAction ?? context.handoff?.nextAction ?? null;

  return {
    ...fallback,
    ...receipt,
    title: "Mailchimp client runtime adoption",
    available: true,
    status: ready ? "adopted" : receipt.status ?? "blocked",
    ready,
    badge: ready ? "armed" : blockedReasons.length > 0 ? "blocked" : "review",
    command: ready ? "process.start" : receipt.command ?? nextAction,
    nextAction,
    restartSafe: ready && receipt.restartSafe === true,
    localOnly: receipt.localOnly !== false
      && receipt.persistence?.localOnly !== false
      && receipt.truthBoundary?.localOnly !== false,
    scope: {
      tenantId: receipt.scope?.tenantId ?? context.handoff?.tenantId ?? null,
      workspaceId: receipt.scope?.workspaceId ?? context.handoff?.workspaceId ?? null,
      sourceId: receipt.scope?.sourceId ?? context.handoff?.sourceId ?? null,
    },
    clientState: {
      ...fallback.clientState,
      ...(receipt.clientState ?? {}),
      visibleStatus: ready ? "ready-to-start" : receipt.clientState?.visibleStatus ?? receipt.status ?? "blocked",
      primaryCommand: ready ? "process.start" : receipt.clientState?.primaryCommand ?? nextAction,
      disabledReason: ready ? null : blockedReasons[0] ?? receipt.clientState?.disabledReason ?? null,
      badge: ready ? "armed" : blockedReasons.length > 0 ? "blocked" : "review",
    },
    persistence: {
      ...fallback.persistence,
      ...(receipt.persistence ?? {}),
      localOnly: receipt.persistence?.localOnly !== false,
      command: ready ? "process.start" : receipt.persistence?.command ?? receipt.command ?? nextAction,
      blockedReasons,
      persistedMatches,
      persistedStateKey: persisted.stateKey ?? null,
      persistedReceiptId: persisted.receiptId ?? null,
    },
    truthBoundary: {
      ...fallback.truthBoundary,
      ...(receipt.truthBoundary ?? {}),
      localOnly: receipt.truthBoundary?.localOnly !== false,
      externalWritesPermitted: ready,
      externalWritesObserved: receipt.truthBoundary?.externalWritesObserved ?? [],
    },
    validationSummary: {
      ...fallback.validationSummary,
      ...(receipt.validationSummary ?? {}),
      valid: ready,
      errors: blockedReasons,
      blockedReasons,
    },
    nextSteps: receipt.nextSteps ?? blockedReasons.map((reason) => ({
      action: nextAction ?? "process.inspect",
      label: "Resolve Mailchimp client runtime adoption blocker",
      reason,
    })),
    blockedReasons,
  };
}

function buildEmptyConsoleProviderSyncManifest() {
  return {
    title: "Mailchimp provider sync manifest",
    available: false,
    manifestId: null,
    status: "not-attached",
    ready: false,
    badge: "blocked",
    command: null,
    nextAction: null,
    restartSafe: false,
    localOnly: true,
    provider: {
      name: "mailchimp",
      checkpoint: null,
      cursor: null,
      scopes: [],
      deniedCapabilities: [],
    },
    sync: {
      direction: null,
      providerResource: null,
      localNamespace: null,
      memoryWritePolicy: null,
      observedStatus: "not-observed",
      observedCheckpoint: null,
      checkpointMatched: false,
    },
    persistence: {
      stateKey: null,
      restartToken: null,
      checksum: null,
      namespace: null,
      localOnly: true,
      restartSafe: false,
      replayToken: null,
      persistedMatches: false,
    },
    validationSummary: {
      valid: false,
      blockedReasons: [],
      checked: {},
    },
    clientState: {
      visibleStatus: "not-attached",
      primaryAction: null,
      disabledReason: "No Mailchimp provider sync manifest is attached.",
      badge: "blocked",
      restartSafe: false,
    },
    truthBoundary: {
      localOnly: true,
      externalWrites: false,
      verifierRequiredBeforeAdapter: true,
    },
    nextSteps: [],
    blockedReasons: [],
  };
}

function buildConsoleProviderSyncManifest(manifest, context) {
  const fallback = buildEmptyConsoleProviderSyncManifest();
  if (!manifest) {
    return {
      ...fallback,
      available: Boolean(context.handoff),
      status: context.handoff?.ready ? "missing_manifest" : context.handoff?.status ?? fallback.status,
      nextAction: context.handoff?.nextAction ?? null,
      blockedReasons: context.handoff?.ready
        ? ["Mailchimp provider sync manifest is missing"]
        : context.handoff?.blockedReasons ?? [],
    };
  }

  const persistence = manifest.persistence ?? {};
  const provider = manifest.provider ?? {};
  const sync = manifest.sync ?? {};
  const validation = manifest.validation ?? {};
  const command = manifest.command ?? {};
  const persistedCheckpoint = context.syncResume?.checkpoint ?? context.provider?.checkpoint ?? null;
  const checkpointMatches = !persistedCheckpoint || persistedCheckpoint === provider.checkpoint;
  const blockedReasons = uniqueSorted([
    ...(validation.blockedReasons ?? []),
    ...(manifest.blockedReasons ?? []),
    ...(context.handoff?.blockedReasons ?? []),
    ...(checkpointMatches ? [] : ["provider sync manifest checkpoint does not match persisted provider checkpoint"]),
    ...(persistence.localOnly === false ? ["provider sync manifest persistence is not local-only"] : []),
    ...(manifest.truthBoundary?.localOnly === false ? ["provider sync manifest truth boundary is not local-only"] : []),
  ]);
  const ready = manifest.ready === true
    && command.ready === true
    && persistence.restartSafe === true
    && checkpointMatches
    && blockedReasons.length === 0;
  const nextAction = ready
    ? command.command ?? "provider.sync.record"
    : manifest.nextAction ?? "provider.sync.review";

  return {
    title: "Mailchimp provider sync manifest",
    available: true,
    manifestId: manifest.manifestId ?? null,
    status: ready ? "ready" : manifest.status ?? "blocked",
    ready,
    badge: ready
      ? "sync-ready"
      : manifest.status === "checkpoint-mismatch" ? "sync-refresh-required" : "blocked",
    command: ready ? command.command ?? "provider.sync.record" : nextAction,
    nextAction,
    restartSafe: ready && persistence.restartSafe === true,
    localOnly: persistence.localOnly !== false && manifest.truthBoundary?.localOnly !== false,
    provider: {
      name: provider.name ?? "mailchimp",
      checkpoint: provider.checkpoint ?? context.provider?.checkpoint ?? null,
      cursor: provider.cursor ?? context.provider?.cursor ?? null,
      scopes: provider.scopes ?? context.provider?.scopes ?? [],
      deniedCapabilities: provider.deniedCapabilities ?? [],
    },
    sync: {
      direction: sync.direction ?? null,
      providerResource: sync.providerResource ?? null,
      localNamespace: sync.localNamespace ?? context.runtime?.memoryNamespace ?? null,
      memoryWritePolicy: sync.memoryWritePolicy ?? context.runtime?.memoryWritePolicy ?? null,
      observedStatus: sync.observedStatus ?? "not-observed",
      observedCheckpoint: sync.observedCheckpoint ?? null,
      checkpointMatched: sync.checkpointMatched === true,
    },
    persistence: {
      stateKey: persistence.stateKey ?? null,
      restartToken: persistence.restartToken ?? null,
      checksum: persistence.checksum ?? null,
      namespace: persistence.namespace ?? context.runtime?.memoryNamespace ?? null,
      localOnly: persistence.localOnly !== false,
      restartSafe: persistence.restartSafe === true,
      replayToken: persistence.replayToken ?? null,
      persistedMatches: checkpointMatches,
    },
    validationSummary: {
      valid: ready,
      blockedReasons,
      checked: validation.checked ?? {},
    },
    clientState: {
      visibleStatus: ready ? "ready" : manifest.clientState?.visibleStatus ?? manifest.status ?? "blocked",
      primaryAction: ready ? command.command ?? "provider.sync.record" : manifest.clientState?.primaryAction ?? nextAction,
      disabledReason: ready ? null : blockedReasons[0] ?? manifest.clientState?.disabledReason ?? null,
      badge: ready ? "sync-ready" : manifest.clientState?.badge ?? "blocked",
      restartSafe: ready && persistence.restartSafe === true,
    },
    truthBoundary: {
      localOnly: manifest.truthBoundary?.localOnly !== false,
      externalWrites: manifest.truthBoundary?.externalWrites === true,
      verifierRequiredBeforeAdapter: manifest.truthBoundary?.verifierRequiredBeforeAdapter !== false,
    },
    nextSteps: manifest.nextSteps ?? blockedReasons.map((reason) => ({
      action: nextAction,
      label: "Resolve Mailchimp provider sync blocker",
      reason,
    })),
    blockedReasons,
  };
}

function buildEmptyMailchimpApprovalPreview() {
  return {
    title: "Mailchimp approval preview",
    available: false,
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
      externalWriteApprovals: 0,
      acceptedRecords: 0,
      commandCount: 0,
      blockerCount: 0,
    },
    acceptance: {
      required: false,
      accepted: false,
      acceptedBy: null,
      acceptedAt: null,
      command: null,
      records: [],
    },
    exportSummary: {
      localOnly: true,
      readyForExport: false,
      redaction: "receipt-subjects",
      subjects: [],
      blockedReasons: [],
    },
    claimPreview: {
      protocol: "aios.mailchimp.claim-readiness-preview.v1",
      ready: false,
      status: "not-attached",
      nextAction: null,
      message: "No Mailchimp claim readiness preview is attached.",
      counters: {
        required: 0,
        ready: 0,
        missingFacts: 0,
        missingEvidence: 0,
        evidenceAccepted: 0,
        blockerCount: 0,
      },
      rows: [],
      nextSteps: [],
      blockedReasons: [],
      localOnly: true,
    },
    adoptionPlan: buildEmptyConsoleMailchimpAdoptionPlan(),
    acceptanceReceipt: buildEmptyConsoleMailchimpAcceptanceReceipt(),
    clientRuntimeAdoption: buildEmptyConsoleMailchimpClientRuntimeAdoption(),
    timeline: [],
    rows: [],
    nextSteps: [],
    blockedReasons: [],
    localOnly: true,
  };
}

function buildConsoleMailchimpApprovalPreview(preview, handoff) {
  const fallback = buildEmptyMailchimpApprovalPreview();
  if (!preview) {
    return {
      ...fallback,
      available: Boolean(handoff),
      status: handoff?.status ?? fallback.status,
      ready: Boolean(handoff?.ready),
      nextAction: handoff?.nextAction ?? null,
      message: handoff?.blockedReasons?.join("; ") || fallback.message,
      blockedReasons: handoff?.blockedReasons ?? [],
    };
  }

  const counters = {
    required: Number(preview.counters?.required ?? handoff?.counts?.required ?? 0),
    approved: Number(preview.counters?.approved ?? handoff?.counts?.approved ?? 0),
    pending: Number(preview.counters?.pending ?? handoff?.counts?.pending ?? 0),
    denied: Number(preview.counters?.denied ?? handoff?.counts?.denied ?? 0),
    externalWriteApprovals: Number(preview.counters?.externalWriteApprovals ?? 0),
    acceptedRecords: Number(preview.counters?.acceptedRecords ?? handoff?.counts?.acceptedRecords ?? 0),
    commandCount: Number(preview.counters?.commandCount ?? handoff?.counts?.commandCount ?? 0),
    blockerCount: Number(preview.counters?.blockerCount ?? preview.blockedReasons?.length ?? 0),
  };
  const blockedReasons = uniqueSorted([
    ...(preview.blockedReasons ?? []),
    ...(preview.exportSummary?.blockedReasons ?? []),
    ...(handoff?.blockedReasons ?? []),
  ]);
  const rows = (preview.rows ?? handoff?.approvals ?? []).map((row) => ({
    key: row.key ?? row.approvalId,
    approvalId: row.approvalId,
    kind: row.kind,
    status: row.status,
    badge: row.badge ?? (
      row.status === "approved" ? "accepted" : row.status === "denied" ? "blocked" : "review"
    ),
    command: row.command ?? (
      row.status === "pending" ? "package.approval.request" : row.status === "denied" ? "process.inspect" : null
    ),
    reason: row.reason ?? null,
    requiredForExternalWrite: Boolean(row.requiredForExternalWrite),
    restartSafe: Boolean(row.restartSafe),
  }));
  const nextSteps = preview.nextSteps ?? blockedReasons.map((reason) => ({
    action: preview.nextAction ?? handoff?.nextAction ?? "process.inspect",
    label: "Resolve Mailchimp approval blocker",
    reason,
  }));
  const claimPreview = buildConsoleMailchimpClaimPreview(preview.claimPreview, handoff);
  const adoptionPlan = buildConsoleMailchimpAdoptionPlan(
    preview.adoptionPlan ?? handoff?.adoptionPlan,
    {
      handoff,
      claimPreview,
      blockedReasons,
      nextAction: preview.nextAction ?? handoff?.nextAction ?? null,
    },
  );
  const acceptanceReceipt = buildConsoleMailchimpAcceptanceReceipt(
    preview.acceptanceReceipt ?? handoff?.acceptanceReceipt,
    {
      handoff,
      preview,
      claimPreview,
      adoptionPlan,
      blockedReasons,
      nextAction: preview.nextAction ?? handoff?.nextAction ?? null,
    },
  );
  const clientRuntimeAdoption = buildConsoleMailchimpClientRuntimeAdoption(
    preview.clientRuntimeAdoption ?? handoff?.clientRuntimeAdoption,
    {
      handoff,
      approvalPreview: preview,
      persisted: null,
      tenantBoundary: {
        tenantId: handoff?.tenantId ?? null,
        workspaceId: handoff?.workspaceId ?? null,
      },
    },
  );

  return {
    title: "Mailchimp approval preview",
    available: true,
    previewId: preview.previewId ?? null,
    status: preview.status ?? handoff?.status ?? "not-attached",
    ready: Boolean(preview.ready ?? handoff?.ready) && blockedReasons.length === 0,
    nextAction: preview.nextAction ?? handoff?.nextAction ?? null,
    message: preview.message ?? blockedReasons.join("; "),
    counters,
    acceptance: {
      required: Boolean(preview.acceptance?.required ?? counters.required > 0),
      accepted: Boolean(preview.acceptance?.accepted ?? handoff?.ready),
      acceptedBy: preview.acceptance?.acceptedBy ?? null,
      acceptedAt: preview.acceptance?.acceptedAt ?? null,
      command: preview.acceptance?.command ?? (
        handoff?.ready ? null : preview.nextAction ?? handoff?.nextAction ?? null
      ),
      records: preview.acceptance?.records ?? [],
    },
    exportSummary: {
      localOnly: preview.exportSummary?.localOnly !== false,
      readyForExport: Boolean(preview.exportSummary?.readyForExport ?? handoff?.ready) && blockedReasons.length === 0,
      redaction: preview.exportSummary?.redaction ?? "receipt-subjects",
      subjects: preview.exportSummary?.subjects ?? rows.map((row) => row.approvalId),
      blockedReasons,
    },
    claimPreview,
    adoptionPlan,
    acceptanceReceipt,
    clientRuntimeAdoption,
    timeline: buildMailchimpApprovalTimeline(preview, rows, blockedReasons),
    rows,
    nextSteps,
    blockedReasons,
    localOnly: preview.localOnly !== false,
  };
}

function buildConsoleMailchimpClaimPreview(claimPreview, handoff) {
  const fallback = buildEmptyMailchimpApprovalPreview().claimPreview;
  if (!claimPreview) {
    return {
      ...fallback,
      ready: Boolean(handoff?.claimHandoff?.ready),
      status: handoff?.claimHandoff?.status ?? fallback.status,
      nextAction: handoff?.claimHandoff?.nextAction ?? null,
      message: handoff?.claimHandoff?.blockedReasons?.join("; ") || fallback.message,
      blockedReasons: handoff?.claimHandoff?.blockedReasons ?? [],
      counters: {
        ...fallback.counters,
        ready: handoff?.claimHandoff?.ready ? 1 : 0,
        missingFacts: handoff?.claimHandoff?.missingFacts?.length ?? 0,
        missingEvidence: handoff?.claimHandoff?.missingEvidence?.length ?? 0,
        blockerCount: handoff?.claimHandoff?.blockedReasons?.length ?? 0,
      },
    };
  }

  return {
    protocol: claimPreview.protocol ?? "aios.mailchimp.claim-readiness-preview.v1",
    ready: Boolean(claimPreview.ready),
    status: claimPreview.status ?? "blocked",
    nextAction: claimPreview.nextAction ?? null,
    message: claimPreview.message ?? claimPreview.blockedReasons?.join("; ") ?? "",
    counters: {
      required: Number(claimPreview.counters?.required ?? claimPreview.rows?.length ?? 0),
      ready: Number(claimPreview.counters?.ready ?? 0),
      missingFacts: Number(claimPreview.counters?.missingFacts ?? 0),
      missingEvidence: Number(claimPreview.counters?.missingEvidence ?? 0),
      evidenceAccepted: Number(claimPreview.counters?.evidenceAccepted ?? 0),
      blockerCount: Number(claimPreview.counters?.blockerCount ?? claimPreview.blockedReasons?.length ?? 0),
    },
    acceptanceGate: claimPreview.acceptanceGate ?? {
      requiredBeforeApproval: true,
      command: claimPreview.nextAction ?? null,
      satisfied: Boolean(claimPreview.ready),
      reason: claimPreview.message ?? "",
    },
    validationSummary: claimPreview.validationSummary ?? {
      valid: Boolean(claimPreview.ready),
      errors: claimPreview.blockedReasons ?? [],
      warnings: [],
      blockedReasons: claimPreview.blockedReasons ?? [],
      checked: {},
    },
    rows: claimPreview.rows ?? [],
    nextSteps: claimPreview.nextSteps ?? [],
    blockedReasons: uniqueSorted(claimPreview.blockedReasons ?? claimPreview.validationSummary?.blockedReasons ?? []),
    localOnly: claimPreview.localOnly !== false,
  };
}

function buildEmptyConsoleMailchimpAcceptanceReceipt() {
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
    blockedReasons: [],
  };
}

function buildConsoleMailchimpAcceptanceReceipt(receipt, context) {
  const fallback = buildEmptyConsoleMailchimpAcceptanceReceipt();
  const blockedReasons = uniqueSorted([
    ...(receipt?.validationSummary?.blockedReasons ?? []),
    ...(receipt?.validationSummary?.errors ?? []),
    ...(receipt?.blockedReasons ?? []),
    ...context.blockedReasons,
  ]);
  const ready = receipt?.ready === true
    && context.handoff?.ready === true
    && context.claimPreview.ready === true
    && context.adoptionPlan.ready === true
    && blockedReasons.length === 0;
  const nextAction = ready ? "process.start" : receipt?.nextAction ?? context.nextAction;

  return {
    ...fallback,
    ...(receipt ?? {}),
    scope: {
      tenantId: receipt?.scope?.tenantId ?? context.handoff?.tenantId ?? null,
      workspaceId: receipt?.scope?.workspaceId ?? context.handoff?.workspaceId ?? null,
      sourceId: receipt?.scope?.sourceId ?? context.handoff?.sourceId ?? null,
    },
    status: ready ? "accepted" : receipt?.status ?? (blockedReasons.length > 0 ? "blocked" : "awaiting_operator"),
    ready,
    restartSafe: ready && receipt?.restartSafe === true,
    localOnly: receipt?.localOnly !== false && receipt?.auditHandoff?.localOnly !== false,
    nextAction,
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
    blockedReasons,
  };
}

function buildEmptyConsoleMailchimpAdoptionPlan() {
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

function buildConsoleMailchimpAdoptionPlan(plan, context) {
  if (!plan) {
    const fallback = buildEmptyConsoleMailchimpAdoptionPlan();
    const ready = context.claimPreview.ready
      && context.blockedReasons.length === 0
      && context.handoff?.ready === true;
    return {
      ...fallback,
      status: ready ? "ready_to_adopt" : "blocked",
      ready,
      nextAction: ready ? "process.start" : context.nextAction,
      blockedReasons: context.blockedReasons,
    };
  }

  const blockedReasons = uniqueSorted([
    ...(plan.blockedReasons ?? []),
    ...(context.claimPreview.localOnly ? [] : ["claim readiness preview must remain local-only"]),
    ...context.blockedReasons,
  ]);
  return {
    protocol: plan.protocol ?? "aios.mailchimp.approval-adoption-plan.v1",
    adapter: plan.adapter ?? "mailchimp",
    tenantId: plan.tenantId ?? context.handoff?.tenantId ?? null,
    workspaceId: plan.workspaceId ?? context.handoff?.workspaceId ?? null,
    sourceId: plan.sourceId ?? context.handoff?.sourceId ?? null,
    status: plan.status ?? (blockedReasons.length === 0 ? "ready_to_adopt" : "blocked"),
    ready: Boolean(plan.ready) && blockedReasons.length === 0,
    nextAction: plan.nextAction ?? context.nextAction,
    localOnly: plan.localOnly !== false,
    operator: plan.operator ?? null,
    acceptedRecords: plan.acceptedRecords ?? [],
    commandPlan: plan.commandPlan ?? [],
    steps: plan.steps ?? [],
    blockedReasons,
    handoff: {
      externalWritesPermitted: Boolean(plan.handoff?.externalWritesPermitted) && blockedReasons.length === 0,
      externalWritesObserved: plan.handoff?.externalWritesObserved ?? [],
      evaluatedAgainst: plan.handoff?.evaluatedAgainst ?? "aios.mailchimp.approval-contract.v1",
      restartSafe: Boolean(plan.handoff?.restartSafe),
    },
  };
}

function buildMailchimpApprovalTimeline(preview, rows, blockedReasons) {
  const acceptedAt = preview.acceptance?.acceptedAt ?? null;
  const events = rows.map((row, index) => ({
    index,
    at: row.status === "approved"
      ? acceptedAt ?? `logical:approval:${index}`
      : `logical:pending:${index}`,
    subject: row.approvalId,
    status: row.status,
    command: row.command,
    exportReady: row.status === "approved",
  }));
  events.push({
    index: events.length,
    at: "current",
    subject: "mailchimp.approval.preview",
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    command: preview.nextAction ?? null,
    exportReady: blockedReasons.length === 0 && preview.exportSummary?.readyForExport !== false,
  });
  return events;
}

function buildConsoleAnalytics(processEnvelope, statusHandoff, auditExport) {
  const readyCommands = processEnvelope.commands.filter((command) => command.ready).length;
  const blockedCommands = processEnvelope.commands.length - readyCommands;
  const boundaryViolations = statusHandoff.tenantBoundary?.observedViolations?.length ?? 0;
  const missingEvidence = statusHandoff.evidence.missing.length;
  const externalWrites = statusHandoff.truthBoundary.externalWritesObserved.length;
  const blockedReasons = uniqueSorted([
    ...processEnvelope.readiness.blockedReasons,
    ...statusHandoff.blockedReasons,
    ...(statusHandoff.tenantBoundary?.observedViolations ?? []).map((violation) => violation.reason),
  ]);
  const mailchimpPreview = processEnvelope.adapterContracts?.mailchimpApprovalPreview
    ?? processEnvelope.clientState?.mailchimpApproval
    ?? null;
  const mailchimpExternalHandoff = processEnvelope.adapterContracts?.mailchimpExternalHandoff
    ?? mailchimpPreview?.externalHandoff
    ?? processEnvelope.adapterContracts?.mailchimp?.externalHandoff
    ?? null;
  const mailchimpClientRuntimeAdoption = processEnvelope.adapterContracts?.mailchimpClientRuntimeAdoption
    ?? mailchimpPreview?.clientRuntimeAdoption
    ?? processEnvelope.adapterContracts?.mailchimp?.clientRuntimeAdoption
    ?? null;

  return {
    counters: {
      readyCommands,
      blockedCommands,
      missingEvidence,
      rejectedEvidence: statusHandoff.evidence.rejected.length,
      externalWrites,
      boundaryViolations,
      acceptedEvidence: statusHandoff.evidence.accepted,
      exportHistorySnapshots: auditExport.history.length,
      persistedStateAttached: processEnvelope.persistedState ? 1 : 0,
      handoffPersistedStateAttached: statusHandoff.persistedState ? 1 : 0,
      mailchimpApprovalRequired: mailchimpPreview?.counters?.required ?? 0,
      mailchimpApprovalApproved: mailchimpPreview?.counters?.approved ?? 0,
      mailchimpApprovalPending: mailchimpPreview?.counters?.pending ?? 0,
      mailchimpApprovalDenied: mailchimpPreview?.counters?.denied ?? 0,
      mailchimpApprovalBlockers: mailchimpPreview?.counters?.blockerCount ?? 0,
      mailchimpApprovalAcceptedRecords: mailchimpPreview?.counters?.acceptedRecords ?? 0,
      mailchimpClaimMissingFacts: mailchimpPreview?.claimPreview?.counters?.missingFacts ?? 0,
      mailchimpClaimMissingEvidence: mailchimpPreview?.claimPreview?.counters?.missingEvidence ?? 0,
      mailchimpAdoptionSteps: mailchimpPreview?.adoptionPlan?.steps?.length ?? 0,
      mailchimpAdoptionBlockedReasons: mailchimpPreview?.adoptionPlan?.blockedReasons?.length ?? 0,
      mailchimpAcceptanceReceiptReady: mailchimpPreview?.acceptanceReceipt?.ready ? 1 : 0,
      mailchimpAcceptanceReceiptBlockers: mailchimpPreview?.acceptanceReceipt?.counters?.blockers ?? 0,
      mailchimpExternalHandoffReady: mailchimpExternalHandoff?.ready ? 1 : 0,
      mailchimpExternalHandoffBlockedReasons: mailchimpExternalHandoff?.persistence?.blockedReasons?.length ?? 0,
      mailchimpExternalHandoffRestartSafe: mailchimpExternalHandoff?.restartSafe ? 1 : 0,
      mailchimpClientRuntimeAdoptionReady: mailchimpClientRuntimeAdoption?.ready ? 1 : 0,
      mailchimpClientRuntimeAdoptionBlockers: mailchimpClientRuntimeAdoption?.validationSummary?.blockedReasons?.length ?? 0,
      mailchimpClientRuntimeAdoptionRestartSafe: mailchimpClientRuntimeAdoption?.restartSafe ? 1 : 0,
    },
    health: {
      boundaryScoped: processEnvelope.tenantBoundary.satisfied && boundaryViolations === 0,
      providerLocalOnly: processEnvelope.runtime.memoryWritePolicy === "local-only",
      exportReady: auditExport.truthBoundary.readyForExport && boundaryViolations === 0,
      blockedReasonCount: blockedReasons.length,
      runtimeMode: statusHandoff.health.mode,
      retryRemaining: statusHandoff.health.retry.remaining,
      degradedModeAvailable: statusHandoff.health.degradedModeAvailable,
      actionableErrors: statusHandoff.health.actionableErrors.length,
      providerSyncLocalOnly: processEnvelope.persistedState?.storage?.localOnly === true
        && statusHandoff.persistedState?.storage?.localOnly === true,
    providerCheckpointAccepted: processEnvelope.provider.checkpoint
        === (statusHandoff.persistedState?.provider?.checkpoint ?? processEnvelope.provider.checkpoint)
        || statusHandoff.persistedState?.provider?.checkpointChanged === true,
      auditDecisionReady: statusHandoff.auditDecision?.ready ?? false,
      auditDecisionAccepted: statusHandoff.auditDecision?.acceptance?.accepted ?? false,
      mailchimpHandoffReady: processEnvelope.adapterContracts?.mailchimp?.ready ?? false,
      mailchimpHandoffBlockedReasons: processEnvelope.adapterContracts?.mailchimp?.blockedReasons?.length ?? 0,
      mailchimpApprovalPreviewReady: mailchimpPreview?.ready ?? false,
      mailchimpApprovalPreviewLocalOnly: mailchimpPreview?.localOnly !== false
        && mailchimpPreview?.exportSummary?.localOnly !== false,
      mailchimpApprovalExportReady: mailchimpPreview?.exportSummary?.readyForExport ?? false,
      mailchimpClaimPreviewReady: mailchimpPreview?.claimPreview?.ready ?? false,
      mailchimpAdoptionPlanReady: mailchimpPreview?.adoptionPlan?.ready ?? false,
      mailchimpAdoptionPlanLocalOnly: mailchimpPreview?.adoptionPlan?.localOnly !== false,
      mailchimpAcceptanceReceiptReady: mailchimpPreview?.acceptanceReceipt?.ready ?? false,
      mailchimpAcceptanceReceiptLocalOnly: mailchimpPreview?.acceptanceReceipt?.localOnly !== false,
      mailchimpExternalHandoffReady: mailchimpExternalHandoff?.ready ?? false,
      mailchimpExternalHandoffLocalOnly: mailchimpExternalHandoff?.persistence?.localOnly !== false
        && mailchimpExternalHandoff?.truthBoundary?.localOnly !== false,
      mailchimpExternalHandoffRestartSafe: mailchimpExternalHandoff?.restartSafe ?? false,
      mailchimpClientRuntimeAdoptionReady: mailchimpClientRuntimeAdoption?.ready ?? false,
      mailchimpClientRuntimeAdoptionLocalOnly: mailchimpClientRuntimeAdoption?.localOnly !== false
        && mailchimpClientRuntimeAdoption?.persistence?.localOnly !== false
        && mailchimpClientRuntimeAdoption?.truthBoundary?.localOnly !== false,
      mailchimpClientRuntimeAdoptionRestartSafe: mailchimpClientRuntimeAdoption?.restartSafe ?? false,
    },
    mailchimpApproval: mailchimpPreview
      ? {
        previewId: mailchimpPreview.previewId,
        status: mailchimpPreview.status,
        ready: mailchimpPreview.ready,
        nextAction: mailchimpPreview.nextAction,
        message: mailchimpPreview.message,
        counters: mailchimpPreview.counters,
        claimPreview: {
          status: mailchimpPreview.claimPreview?.status,
          ready: mailchimpPreview.claimPreview?.ready,
          nextAction: mailchimpPreview.claimPreview?.nextAction,
          counters: mailchimpPreview.claimPreview?.counters,
        },
        adoptionPlan: {
          status: mailchimpPreview.adoptionPlan?.status,
          ready: mailchimpPreview.adoptionPlan?.ready,
          nextAction: mailchimpPreview.adoptionPlan?.nextAction,
          blockedReasons: mailchimpPreview.adoptionPlan?.blockedReasons,
        },
        acceptanceReceipt: {
          receiptId: mailchimpPreview.acceptanceReceipt?.receiptId,
          status: mailchimpPreview.acceptanceReceipt?.status,
          ready: mailchimpPreview.acceptanceReceipt?.ready,
          restartSafe: mailchimpPreview.acceptanceReceipt?.restartSafe,
          nextAction: mailchimpPreview.acceptanceReceipt?.nextAction,
          scope: mailchimpPreview.acceptanceReceipt?.scope,
          blockers: mailchimpPreview.acceptanceReceipt?.validationSummary?.blockedReasons ?? [],
        },
        externalHandoff: mailchimpExternalHandoff
          ? {
            receiptId: mailchimpExternalHandoff.receiptId,
            status: mailchimpExternalHandoff.status,
            ready: mailchimpExternalHandoff.ready,
            command: mailchimpExternalHandoff.command,
            restartSafe: mailchimpExternalHandoff.restartSafe,
            checkpoint: mailchimpExternalHandoff.sync?.checkpoint ?? null,
          }
          : null,
        clientRuntimeAdoption: mailchimpClientRuntimeAdoption
          ? {
            receiptId: mailchimpClientRuntimeAdoption.receiptId,
            status: mailchimpClientRuntimeAdoption.status,
            ready: mailchimpClientRuntimeAdoption.ready,
            command: mailchimpClientRuntimeAdoption.command,
            restartSafe: mailchimpClientRuntimeAdoption.restartSafe,
            visibleStatus: mailchimpClientRuntimeAdoption.clientState?.visibleStatus ?? null,
            primaryCommand: mailchimpClientRuntimeAdoption.clientState?.primaryCommand ?? null,
            resumeToken: mailchimpClientRuntimeAdoption.persistence?.resumeToken ?? null,
          }
          : null,
      }
      : null,
    blockedReasons,
    summary: boundaryViolations > 0
      ? `blocked: ${boundaryViolations} tenant boundary violation(s)`
      : missingEvidence > 0
        ? `verifying: ${missingEvidence} evidence receipt(s) missing`
        : mailchimpPreview && mailchimpPreview.ready === false
          ? `waiting: Mailchimp approval preview ${mailchimpPreview.status}`
        : auditExport.summary,
  };
}

function buildConsoleHistory(historyInput, statusHandoff) {
  const history = Array.isArray(historyInput) ? historyInput : [];
  const normalized = history.map((entry, index) => ({
    index,
    at: String(entry.at ?? `logical:${index}`),
    status: String(entry.status ?? "verifying"),
    exportReady: Boolean(entry.exportReady ?? false),
    boundarySatisfied: Boolean(entry.boundarySatisfied ?? true),
    missingEvidence: Number(entry.missingEvidence ?? 0),
    externalWriteViolations: Number(entry.externalWriteViolations ?? entry.violations ?? 0),
    healthMode: String(entry.healthMode ?? entry.mode ?? "healthy"),
    retryRemaining: Number(entry.retryRemaining ?? 0),
  }));

  normalized.push({
    index: normalized.length,
    at: "current",
    status: statusHandoff.status,
    exportReady: statusHandoff.evidence.missing.length === 0
      && statusHandoff.truthBoundary.externalWritesObserved.length === 0
      && statusHandoff.tenantBoundary?.satisfied !== false,
    boundarySatisfied: statusHandoff.tenantBoundary?.satisfied !== false,
    missingEvidence: statusHandoff.evidence.missing.length,
    externalWriteViolations: statusHandoff.truthBoundary.externalWritesObserved.length,
    healthMode: statusHandoff.health.mode,
    retryRemaining: statusHandoff.health.retry.remaining,
  });

  return normalized.map((entry) => ({
    ...entry,
    nextAction: entry.boundarySatisfied
      ? entry.healthMode === "degraded" && entry.retryRemaining > 0
        ? "process.retry"
        : entry.missingEvidence > 0 ? "process.verify" : "audit.export"
      : "package.settings.fix",
  }));
}

function buildLifecycleControlsPanel(processEnvelope, statusHandoff, selfCheck) {
  const retry = statusHandoff.recovery.retry;
  const canUseRuntime = selfCheck.valid && !["failed", "rolled_back"].includes(statusHandoff.status);
  const degradedModeCommand = processEnvelope.commands.find((command) => command.command === "process.degraded-mode");
  const retryCommand = processEnvelope.commands.find((command) => command.command === "process.retry");
  const exportCommand = processEnvelope.commands.find((command) => command.command === "audit.export.package");
  const resumeCommand = processEnvelope.commands.find((command) => (
    command.command === statusHandoff.persistedState?.resume?.command
  ));

  return {
    enabled: processEnvelope.status !== "blocked",
    nextAction: statusHandoff.nextAction,
    controls: {
      status: processEnvelope.controls?.status ?? processEnvelope.readiness.status,
      nextAction: processEnvelope.controls?.nextAction ?? statusHandoff.nextAction,
      primaryCommand: processEnvelope.controls?.primaryCommand ?? null,
      disabledReason: processEnvelope.controls?.disabledReason ?? null,
      groups: {
        package: selectConsoleControlGroup(processEnvelope, "package"),
        preview: selectConsoleControlGroup(processEnvelope, "preview"),
        schedule: selectConsoleControlGroup(processEnvelope, "schedule"),
        audit: selectConsoleControlGroup(processEnvelope, "audit"),
      },
      summary: processEnvelope.controls?.summary ?? {
        total: processEnvelope.commands.length,
        ready: processEnvelope.commands.filter((command) => command.ready).length,
        blocked: processEnvelope.commands.filter((command) => !command.ready).length,
        nextReadyCommand: processEnvelope.commands.find((command) => command.ready)?.command ?? null,
      },
    },
    settings: {
      fixRequired: processEnvelope.readiness.blockedReasons.length > 0 || !selfCheck.valid,
      command: "package.settings.fix",
      blockedReasons: uniqueSorted([
        ...processEnvelope.readiness.blockedReasons,
        ...selfCheck.errors,
      ]),
    },
    retry: {
      allowed: canUseRuntime && retry.allowed && Boolean(retryCommand),
      command: "process.retry",
      attempt: retry.attempt,
      remaining: retry.remaining,
      backoffSlot: retry.backoffSlot,
      reason: retry.reason,
      disabledReason: retry.allowed && retryCommand
        ? null
        : retry.reason,
    },
    degradedMode: {
      allowed: canUseRuntime
        && statusHandoff.health.mode === "degraded"
        && Boolean(degradedModeCommand),
      command: "process.degraded-mode",
      reason: statusHandoff.recovery.degradedMode.reason,
      disabledReason: degradedModeCommand
        ? null
        : "degraded mode command is unavailable for this provider mode",
    },
    resume: {
      allowed: canUseRuntime
        && Boolean(statusHandoff.persistedState?.resume?.available)
        && Boolean(resumeCommand),
      command: statusHandoff.persistedState?.resume?.command ?? null,
      checkpoint: statusHandoff.persistedState?.resume?.checkpoint ?? processEnvelope.provider.checkpoint,
      replayToken: statusHandoff.persistedState?.resume?.replayToken ?? null,
      reason: statusHandoff.persistedState?.resume?.reason ?? "no persisted resume command is available",
      disabledReason: statusHandoff.persistedState?.resume?.available && resumeCommand
        ? null
        : statusHandoff.persistedState?.resume?.reason ?? "resume is unavailable for this handoff state",
    },
    rollback: {
      allowed: statusHandoff.recovery.shouldRollback && processEnvelope.recovery.policy !== "none",
      command: "process.rollback",
      reason: statusHandoff.recovery.shouldRollback
        ? "rollback pending from audit recovery"
        : "rollback is not required",
    },
    schedule: {
      command: "package.schedule.next",
      available: processEnvelope.commands.some((command) => command.command === "package.schedule.next"),
      selected: statusHandoff.nextAction === "package.schedule.next",
      badge: processEnvelope.clientState?.schedule?.badge ?? "manual",
      nextCommand: processEnvelope.clientState?.schedule?.nextCommand ?? null,
      controls: selectConsoleControlGroup(processEnvelope, "schedule"),
    },
    exportPackage: {
      allowed: selfCheck.valid
        && statusHandoff.export?.ready === true
        && Boolean(exportCommand),
      command: "audit.export.package",
      destination: statusHandoff.export?.destination ?? processEnvelope.exportPolicy.destination,
      redaction: statusHandoff.export?.redaction ?? processEnvelope.exportPolicy.redaction,
      selected: statusHandoff.nextAction === "audit.export.package"
        || statusHandoff.export?.nextAction === "audit.export.download",
      reason: statusHandoff.export?.summary ?? exportCommand?.reason ?? "audit export package status unavailable",
      disabledReason: statusHandoff.export?.ready === true && exportCommand
        ? null
        : statusHandoff.export?.blockedReasons?.join("; ") ?? exportCommand?.reason ?? "audit export package is not ready",
      badge: processEnvelope.clientState?.export?.badge ?? "disabled",
      clientCommand: processEnvelope.clientState?.export?.command ?? null,
    },
  };
}

function buildCommandPalette(processEnvelope, statusHandoff, selfCheck) {
  const clientPrimary = processEnvelope.clientState?.primaryCommand?.command
    ?? processEnvelope.controls?.primaryCommand
    ?? null;
  const items = processEnvelope.commands.map((command) => ({
    command: command.command,
    ready: deriveConsoleCommandReadiness(command, statusHandoff, selfCheck),
    reason: deriveConsoleCommandReason(command, statusHandoff, selfCheck),
    source: command.source,
    selected: command.command === clientPrimary
      || command.command === statusHandoff.runtimeCommand
      || command.command === statusHandoff.nextAction,
    healthMode: statusHandoff.health.mode,
    clientPrimary: command.command === clientPrimary,
  }));

  if (statusHandoff.runtimeCommand && !items.some((item) => item.command === statusHandoff.runtimeCommand)) {
    items.push({
      command: statusHandoff.runtimeCommand,
      ready: selfCheck.valid,
      reason: "runtime status handoff command",
      source: "status-handoff",
      selected: true,
      healthMode: statusHandoff.health.mode,
    });
  }
  if (
    statusHandoff.auditDecision?.nextAction
    && !items.some((item) => item.command === statusHandoff.auditDecision.nextAction)
  ) {
    const isAcceptanceAction = statusHandoff.auditDecision.nextAction === statusHandoff.auditDecision.acceptance?.command;
    items.push({
      command: statusHandoff.auditDecision.nextAction,
      ready: selfCheck.valid && (
        statusHandoff.auditDecision.ready === true
        || (
          isAcceptanceAction
          && statusHandoff.auditDecision.validationSummary?.valid === true
          && statusHandoff.auditDecision.acceptance?.accepted !== true
        )
      ),
      reason: statusHandoff.auditDecision.preview?.message ?? "audit decision next action",
      source: "audit-decision",
      selected: true,
      healthMode: statusHandoff.health.mode,
    });
  }
  if (
    statusHandoff.auditDecision?.acceptance?.command
    && !items.some((item) => item.command === statusHandoff.auditDecision.acceptance.command)
  ) {
    items.push({
      command: statusHandoff.auditDecision.acceptance.command,
      ready: selfCheck.valid && statusHandoff.auditDecision.validationSummary?.valid === true,
      reason: "accept current audit preview before export handoff",
      source: "audit-decision",
      selected: statusHandoff.auditDecision.readiness?.status === "awaiting-acceptance",
      healthMode: statusHandoff.health.mode,
    });
  }

  const sorted = items.sort((left, right) => {
    if (left.selected !== right.selected) {
      return left.selected ? -1 : 1;
    }
    if (left.ready !== right.ready) {
      return left.ready ? -1 : 1;
    }
    return left.command.localeCompare(right.command);
  });

  return {
    primary: sorted.find((command) => command.selected) ?? sorted.find((command) => command.ready) ?? sorted[0] ?? null,
    items: sorted,
  };
}

function selectConsoleControlGroup(processEnvelope, group) {
  return (processEnvelope.controls?.groups?.[group] ?? []).map((control) => ({
    command: control.command,
    ready: control.ready,
    allowed: control.allowed,
    label: control.label,
    reason: control.reason,
    selected: control.selected,
    metadata: control.metadata,
  }));
}

function deriveConsoleCommandReadiness(command, statusHandoff, selfCheck) {
  if (!selfCheck.valid && command.command !== "package.settings.fix") {
    return false;
  }
  if (command.command === "process.retry") {
    return command.ready && statusHandoff.recovery.retry.allowed;
  }
  if (command.command === "process.degraded-mode") {
    return command.ready && statusHandoff.health.mode === "degraded";
  }
  if (command.command === "process.rollback") {
    return statusHandoff.recovery.shouldRollback;
  }
  if (command.command === "audit.export.package") {
    return statusHandoff.export?.ready === true;
  }
  if (command.command === "audit.preview.accept") {
    return statusHandoff.auditDecision?.validationSummary?.valid === true
      && statusHandoff.auditDecision?.acceptance?.accepted !== true;
  }
  return command.ready && selfCheck.valid;
}

function deriveConsoleCommandReason(command, statusHandoff, selfCheck) {
  if (!selfCheck.valid && command.command !== "package.settings.fix") {
    return selfCheck.errors.join("; ");
  }
  if (command.command === "process.retry") {
    return statusHandoff.recovery.retry.allowed
      ? statusHandoff.recovery.retry.reason
      : "retry is not currently allowed";
  }
  if (command.command === "process.degraded-mode") {
    return statusHandoff.health.mode === "degraded"
      ? statusHandoff.health.summary
      : "runtime is not in degraded mode";
  }
  if (command.command === "audit.export.package") {
    return statusHandoff.export?.ready === true
      ? statusHandoff.export.summary
      : statusHandoff.export?.blockedReasons?.join("; ") ?? "audit export package is not ready";
  }
  if (command.command === "audit.preview.accept") {
    return statusHandoff.auditDecision?.acceptance?.accepted
      ? "audit preview is already accepted"
      : statusHandoff.auditDecision?.preview?.message ?? "accept current audit decision preview";
  }
  return command.reason;
}

function buildFallbackAuditDecision(statusHandoff) {
  const blockers = uniqueSorted([
    ...statusHandoff.blockedReasons,
    ...statusHandoff.evidence.missing.map((subject) => `missing evidence: ${subject}`),
  ]);
  return {
    decisionId: `fallback_${statusHandoff.handoffId}`,
    status: blockers.length === 0 ? "awaiting-acceptance" : "blocked",
    ready: false,
    nextAction: blockers.length === 0 ? "audit.preview.accept" : statusHandoff.nextAction,
    preview: {
      badge: blockers.length === 0 ? "review" : "blocked",
      message: blockers.join("; ") || "audit preview is ready for operator acceptance",
      primaryAction: blockers.length === 0 ? "audit.preview.accept" : statusHandoff.nextAction,
      secondaryActions: [],
    },
    acceptance: {
      required: true,
      accepted: false,
      acceptedBy: null,
      acceptedAt: null,
      command: "audit.preview.accept",
      blockedReasons: blockers,
    },
    validationSummary: {
      valid: blockers.length === 0,
      errors: blockers,
      warnings: [],
      blockedReasons: blockers,
      checked: {},
    },
    handoff: {
      localOnly: true,
      exportId: statusHandoff.export?.exportId ?? null,
      packageId: statusHandoff.export?.packageId ?? null,
      destination: statusHandoff.export?.destination ?? null,
      redaction: statusHandoff.export?.redaction ?? null,
    },
    nextSteps: blockers.map((reason) => ({
      action: statusHandoff.nextAction,
      label: "Resolve audit decision blocker",
      reason,
    })),
    blockedReasons: blockers,
  };
}

function buildExportPackagePanel(processEnvelope, statusHandoff, auditExport, auditExportPackage) {
  if (!auditExportPackage || auditExportPackage.kind !== "aios.audit.export-package") {
    throw new Error("auditExportPackage must be produced by createAuditExportPackage");
  }

  const handoffExport = statusHandoff.export ?? {};
  const blockers = uniqueSorted([
    ...(handoffExport.blockedReasons ?? []),
    ...auditExportPackage.readiness.blockedReasons,
  ]);
  const ready = auditExport.truthBoundary.readyForExport
    && auditExportPackage.readiness.ready
    && handoffExport.ready !== false
    && blockers.length === 0;

  return {
    packageId: auditExportPackage.packageId,
    ready,
    status: ready ? "ready" : "blocked",
    command: "audit.export.package",
    destination: auditExportPackage.destination.target,
    localOnly: auditExportPackage.destination.localOnly,
    redaction: auditExportPackage.redaction.mode,
    retention: auditExportPackage.retention,
    manifest: auditExportPackage.manifest,
    nextAction: ready
      ? "audit.export.download"
      : handoffExport.nextAction ?? auditExportPackage.readiness.nextAction,
    blockedReasons: blockers,
    preview: {
      fileName: auditExportPackage.manifest.fileName,
      recordCount: auditExportPackage.manifest.recordCount,
      historySnapshots: auditExport.counters.historySnapshots,
      acceptedEvidence: auditExport.counters.acceptedEvidence,
      missingEvidence: auditExport.counters.missingEvidence,
      externalWriteViolations: auditExport.counters.externalWriteViolations,
    },
    policy: {
      enabled: processEnvelope.exportPolicy.enabled,
      destination: processEnvelope.exportPolicy.destination,
      redaction: processEnvelope.exportPolicy.redaction,
      requireCompletedAudit: processEnvelope.exportPolicy.requireCompletedAudit,
    },
  };
}

function buildSectionState(section, selectedSection, processEnvelope, statusHandoff) {
  return {
    id: section,
    selected: section === selectedSection,
    badge: deriveSectionBadge(section, processEnvelope, statusHandoff),
    disabled: section === "recovery" && processEnvelope.recovery.policy === "none",
  };
}

function deriveProviderSyncResumeBlockers(processEnvelope, statusHandoff, resume, storage, command) {
  const blockers = [];
  if (storage.localOnly !== true) {
    blockers.push("provider sync resume must use local-only persisted state");
  }
  if (storage.writePolicy && storage.writePolicy !== "local-only") {
    blockers.push("provider sync resume write policy must remain local-only");
  }
  if (statusHandoff.tenantBoundary?.satisfied === false || processEnvelope.tenantBoundary.satisfied === false) {
    blockers.push("tenant boundary must be satisfied before provider sync resume");
  }
  if (resume.available && resume.command && !command) {
    blockers.push("provider sync resume command is missing from the command palette");
  }
  if (resume.command === "process.retry" && !statusHandoff.recovery.retry.allowed) {
    blockers.push("retry budget is exhausted for provider sync resume");
  }
  if (
    statusHandoff.truthBoundary.externalWritesObserved.length > 0
    && resume.command !== "process.rollback"
  ) {
    blockers.push("rollback is required before resuming after external write observations");
  }
  return uniqueSorted(blockers);
}

function buildAuditReportForExport(statusHandoff, options) {
  if (options.auditReport) {
    return options.auditReport;
  }
  return {
    kind: "aios.audit.truth-boundary",
    jobId: statusHandoff.jobId,
    status: statusHandoff.auditStatus,
    summary: `${statusHandoff.auditStatus}: status handoff ${statusHandoff.handoffId}`,
    timeline: [],
    evidence: {
      accepted: Array.from({ length: statusHandoff.evidence.accepted }, (_, index) => ({
        subject: `accepted:${index + 1}`,
      })),
      missing: statusHandoff.evidence.missing,
      rejected: statusHandoff.evidence.rejected,
    },
    boundary: {
      externalWritesObserved: statusHandoff.truthBoundary.externalWritesObserved,
    },
    recovery: [statusHandoff.recovery],
  };
}

function deriveSelectedSection(processEnvelope, statusHandoff) {
  if (statusHandoff.recovery.shouldRollback) {
    return "recovery";
  }
  if (statusHandoff.tenantBoundary?.satisfied === false || processEnvelope.tenantBoundary.satisfied === false) {
    return "boundary";
  }
  if (statusHandoff.evidence.missing.length > 0 || statusHandoff.truthBoundary.externalWritesObserved.length > 0) {
    return "evidence";
  }
  if (statusHandoff.health.mode === "degraded") {
    return "recovery";
  }
  if (statusHandoff.export?.ready === true) {
    return "evidence";
  }
  if (!processEnvelope.readiness.ready) {
    return "readiness";
  }
  return "overview";
}

function deriveSeverity(processEnvelope, statusHandoff, selfCheck) {
  if (!selfCheck.valid || ["failed", "rolled_back", "blocked"].includes(statusHandoff.status)) {
    return "blocked";
  }
  if (!processEnvelope.readiness.ready || statusHandoff.status === "verifying" || statusHandoff.health.mode === "degraded") {
    return "warning";
  }
  return "ok";
}

function deriveSectionBadge(section, processEnvelope, statusHandoff) {
  if (section === "evidence") {
    return statusHandoff.export?.ready === true
      ? "ready"
      : statusHandoff.evidence.missing.length > 0 ? "attention" : "ok";
  }
  if (section === "recovery") {
    return statusHandoff.recovery.shouldRollback
      ? "blocked"
      : statusHandoff.health.mode === "degraded" ? "attention" : "ok";
  }
  if (section === "boundary") {
    return statusHandoff.tenantBoundary?.satisfied === false
      || processEnvelope.tenantBoundary.satisfied === false
      ? "blocked"
      : "scoped";
  }
  if (section === "readiness") {
    return processEnvelope.readiness.ready ? "ok" : "attention";
  }
  if (section === "commands") {
    return processEnvelope.commands.some((command) => command.ready) ? "ready" : "blocked";
  }
  return "ok";
}

function diffCommands(previousCommands, nextCommands) {
  const previous = new Map(previousCommands.map((command) => [command.command, command]));
  const next = new Map(nextCommands.map((command) => [command.command, command]));
  const added = [...next.keys()].filter((command) => !previous.has(command)).sort();
  const removed = [...previous.keys()].filter((command) => !next.has(command)).sort();
  const readinessChanged = [...next.keys()].filter((command) => (
    previous.has(command) && previous.get(command).ready !== next.get(command).ready
  )).sort();

  return {
    added,
    removed,
    readinessChanged,
  };
}

function normalizeSection(section) {
  const normalized = String(section).trim().toLowerCase();
  if (!CONSOLE_SECTIONS.includes(normalized)) {
    throw new Error(`unsupported operator console section: ${section}`);
  }
  return normalized;
}

function assertProcessEnvelope(processEnvelope) {
  if (!processEnvelope || processEnvelope.kind !== "aios.process.envelope") {
    throw new Error("processEnvelope must be produced by createProcessEnvelope");
  }
}

function assertStatusHandoff(statusHandoff) {
  if (!statusHandoff || statusHandoff.kind !== "aios.process.status-handoff") {
    throw new Error("statusHandoff must be produced by createProcessStatusHandoff");
  }
}

function assertConsoleModel(model, label) {
  if (!model || model.kind !== "aios.operator-console.model") {
    throw new Error(`${label} must be produced by buildOperatorConsoleModel`);
  }
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
