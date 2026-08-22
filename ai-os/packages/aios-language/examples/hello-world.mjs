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
import {
  buildRecoveryStatusHandoff,
  buildRollbackContract,
  buildRollbackAnalyticsSnapshot,
  buildRollbackPreviewAcceptanceContract,
  buildRollbackProviderHandoffContract,
  summarizeRollbackContract,
} from "../stdlib/rollback.mjs";
import {
  buildMailchimpExternalHandoffState,
  buildMailchimpStatusHandoff,
} from "../stdlib/status.mjs";
import {
  buildMailchimpLifecycleControlPlan,
} from "../stdlib/verifier.mjs";

export const helloWorldSource = `# deterministic Mailchimp read-only hello world
use mailchimp:campaign.read
use memory:campaign.local
recover rollback=snapshot retry=1
step fetch-campaign input=campaignId output=campaign verify.intent=read-only
step render-summary input=campaign output=summary verify.truth=operator-visible
`;

export function buildHelloWorldProgram(options = {}) {
  return compilePackageSource(helloWorldSource, {
    name: options.name ?? "mailchimp-hello-world",
    version: options.version ?? "0.1.0",
    description: "Read a Mailchimp campaign and render a local summary without external writes.",
    capabilities: options.capabilities ?? [],
  }, {
    name: "mailchimp-hello-world",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: true,
      requireApproval: options.requireApproval ?? false,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 10,
    },
  });
}

export function buildHelloWorldAudit(program = buildHelloWorldProgram()) {
  const evidence = program.job.verifier.requiredEvidence.map((subject) => (
    subject.endsWith(":input") || subject.endsWith(":output")
      ? createEvidence("runtime-local-receipt", subject, { example: "hello-world" })
      : createEvidence("operator-attestation", subject, { accepted: true })
  ));

  return createTruthBoundaryReport(program.job, {
    status: "completed",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "example queued" }),
      createStatusEvent("running", { at: "logical:1", message: "campaign read simulated" }),
      createStatusEvent("verifying", { at: "logical:2", message: "truth boundary checked" }),
      createStatusEvent("completed", { at: "logical:3", message: "summary ready" }),
    ],
    evidence,
  });
}

export function describeHelloWorld() {
  const program = buildHelloWorldProgram();
  const audit = buildHelloWorldAudit(program);
  const providerContract = buildHelloWorldProviderContract(program, audit);
  const preview = buildHelloWorldPreview({ program, audit });

  return {
    jobId: program.job.id,
    adapter: program.job.runtimeAdapter,
    capabilities: program.job.capabilities,
    status: audit.status,
    summary: audit.summary,
    providerContract,
    preview,
    acceptance: preview.acceptance,
    nextSteps: preview.nextSteps,
    runtimeHandoff: preview.runtimeHandoff,
    lifecycle: program.lifecycle,
  };
}

export function buildHelloWorldProviderContract(program = buildHelloWorldProgram(), audit = buildHelloWorldAudit(program)) {
  const mailchimpCapabilities = program.job.capabilities
    .filter((capability) => capability.startsWith("mailchimp:"));
  const exportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: "logical:4",
    format: "json.summary",
  });
  const serviceContract = buildProviderServiceContract(program, {
    checkpoint: exportSnapshot.exportId,
    providerResource: "campaign",
  });

  return {
    kind: "mailchimp.provider-contract",
    apiVersion: "aios.integration/v1",
    provider: serviceContract.provider,
    negotiation: {
      requestedCapabilities: mailchimpCapabilities,
      grantedCapabilities: serviceContract.negotiation.grantedCapabilities,
      deniedCapabilities: serviceContract.negotiation.deniedCapabilities,
      providerScopes: serviceContract.negotiation.providerScopes,
      memoryWritePolicy: program.job.memory.writePolicy,
    },
    sync: {
      direction: "provider-to-local",
      source: "campaign",
      destination: program.job.memory.namespace,
      externalHandoff: serviceContract.sync.externalHandoff,
      lastCheckpoint: serviceContract.sync.checkpoint,
    },
    handoffState: {
      ...serviceContract.handoffState,
      exportReady: exportSnapshot.truthBoundary.readyForExport,
      reason: exportSnapshot.truthBoundary.readyForExport
        ? serviceContract.handoffState.reason
        : exportSnapshot.summary,
    },
    clientState: serviceContract.clientState,
  };
}

export function buildHelloWorldPreview(options = {}) {
  const program = options.program ?? buildHelloWorldProgram(options);
  const audit = options.audit ?? buildHelloWorldAudit(program);
  const exportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:4",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const providerContract = buildProviderServiceContract(program, {
    checkpoint: exportSnapshot.exportId,
    externalApproval: options.approvalTicket,
    providerResource: "campaign",
  });
  const packageReadiness = buildPackageReadinessPreview(program, {
    providerContract,
    acceptance: {
      accepted: options.accepted ?? false,
      acceptedBy: options.acceptedBy,
      acceptedAt: options.acceptedAt ?? "logical:5",
    },
  });
  const providerSyncEvidence = createProviderSyncEvidence(audit, providerContract, {
    generatedAt: options.syncEvidenceAt ?? "logical:6",
  });
  const rollbackContract = buildRollbackContract(program, audit, {
    adapterStatus: options.adapterHealth,
    adapterCheckedAt: options.adapterCheckedAt ?? "logical:6",
    commandStatuses: options.recoveryCommandStatuses,
    completedSteps: options.completedSteps ?? 2,
    failedStep: options.failedStep,
    mountedCheckpoints: options.mountedCheckpoints,
    retryAfterSeconds: options.adapterRetryAfterSeconds,
  });
  const recoveryStatusHandoff = buildRecoveryStatusHandoff(rollbackContract, {
    accepted: options.accepted ?? false,
  });
  const rollbackAcceptance = buildRollbackPreviewAcceptanceContract(rollbackContract, {
    accepted: options.accepted ?? false,
    acceptedBy: options.acceptedBy,
    acceptedAt: options.acceptedAt ?? "logical:5",
  });
  const rollbackProviderHandoff = buildRollbackProviderHandoffContract(rollbackContract, {
    providerCapabilities: options.providerCapabilities,
    requestedCapabilities: options.requestedCapabilities,
  });
  const mailchimpStatusHandoff = buildMailchimpStatusHandoff({
    tenantId: options.tenantId ?? "tenant_demo",
    workspaceId: options.workspaceId ?? "workspace_demo",
    sourceId: program.job.id,
    campaignId: options.campaignId ?? "campaign_demo",
    accepted: options.accepted ?? false,
    role: options.role ?? "operator",
    permissions: options.permissions,
    runtime: {
      adapterHealth: {
        status: options.adapterHealth ?? "healthy",
        retryAfterSeconds: options.adapterRetryAfterSeconds,
      },
      commandResults: options.mailchimpRecoveryCommandResults,
    },
  });
  const externalHandoff = buildMailchimpExternalHandoffState(mailchimpStatusHandoff, {
    providerCapabilities: options.providerCapabilities,
    requestedCapabilities: options.requestedCapabilities,
  });
  const lifecycleControlPlan = buildMailchimpLifecycleControlPlan(
    buildHelloWorldVerifierJob(program, options),
    program.lifecycle,
    buildHelloWorldVerifierContext(providerContract, options),
  );
  const validation = summarizeHelloWorldValidation(program, audit, exportSnapshot, providerContract);
  const acceptance = buildHelloWorldAcceptance(validation, providerContract, packageReadiness, options);
  const handoffGate = buildHelloWorldHandoffGate({
    validation,
    acceptance,
    packageReadiness,
    providerSyncEvidence,
    lifecycleControlPlan,
    recoveryStatusHandoff,
  });

  return {
    kind: "mailchimp.hello-world.preview",
    apiVersion: "aios.example/v1",
    title: "Mailchimp campaign read preview",
    jobId: program.job.id,
    status: audit.status,
    readiness: {
      ready: handoffGate.ready,
      auditReady: validation.ready,
      accepted: acceptance.accepted,
      visibleStatus: providerContract.clientState.visibleStatus,
      nextAction: handoffGate.nextAction,
      packageReady: packageReadiness.readiness.ready,
      verifierReady: lifecycleControlPlan.nextActionState.ready,
      providerSyncReady: providerSyncEvidence.readiness.ready,
      recoveryReady: recoveryStatusHandoff.ready,
      statusReady: mailchimpStatusHandoff.ready,
      operationalHealth: mailchimpStatusHandoff.operationalHealth.health,
      statusExportReady: mailchimpStatusHandoff.exportPacket.readyForExport,
      externalHandoffReady: externalHandoff.ready,
      externalHandoffStatus: externalHandoff.status,
      rollbackAcceptanceReady: rollbackAcceptance.ready,
      rollbackAcceptanceStatus: rollbackAcceptance.status,
      rollbackProviderReady: rollbackProviderHandoff.handoffState.ready,
      gateStatus: handoffGate.status,
    },
    display: {
      summary: audit.summary,
      primaryAction: providerContract.clientState.primaryAction,
      disabledReason: providerContract.clientState.disabledReason,
      providerBadge: providerContract.clientState.badge,
      packagePreviewStatus: packageReadiness.readiness.status,
      verifierControlStatus: lifecycleControlPlan.status,
      degradedMode: mailchimpStatusHandoff.operationalHealth.degradedMode.mode,
      retryAfterSeconds: mailchimpStatusHandoff.operationalHealth.retry.retryAfterSeconds,
      statusExportStatus: mailchimpStatusHandoff.exportPacket.exportStatus,
      externalHandoffBadge: externalHandoff.clientState.badge,
      externalHandoffAction: externalHandoff.clientState.primaryAction,
      rollbackAcceptanceBadge: rollbackAcceptance.preview.badge,
      rollbackAcceptanceAction: rollbackAcceptance.preview.primaryAction,
      rollbackProviderStatus: rollbackProviderHandoff.handoffState.status,
    },
    validation,
    acceptance,
    handoffGate,
    providerContract,
    packageReadiness,
    providerSyncEvidence,
    recovery: {
      contract: rollbackContract,
      summary: summarizeRollbackContract(rollbackContract),
      analytics: buildRollbackAnalyticsSnapshot(rollbackContract),
      acceptance: rollbackAcceptance,
      providerHandoff: rollbackProviderHandoff,
      statusHandoff: recoveryStatusHandoff,
      mailchimpStatusHandoff,
      externalHandoff,
    },
    controls: buildHelloWorldControlState({
      program,
      lifecycleControlPlan,
      mailchimpStatusHandoff,
      handoffGate,
      acceptance,
      options,
    }),
    reporting: buildHelloWorldReportingState({
      program,
      audit,
      exportSnapshot,
      providerContract,
      packageReadiness,
      providerSyncEvidence,
      lifecycleControlPlan,
      recoveryStatusHandoff,
      mailchimpStatusHandoff,
      handoffGate,
      acceptance,
      rollbackAnalytics: rollbackContract.analytics,
      rollbackProviderHandoff,
      rollbackAcceptance,
      externalHandoff,
    }),
    lifecycleControlPlan,
    runtimeHandoff: buildHelloWorldRuntimeHandoff(
      program,
      packageReadiness,
      providerSyncEvidence,
      lifecycleControlPlan,
      acceptance,
      recoveryStatusHandoff,
      mailchimpStatusHandoff,
      externalHandoff,
      rollbackProviderHandoff,
      rollbackAcceptance,
      handoffGate,
    ),
    exportSnapshot,
    nextSteps: buildHelloWorldNextSteps(
      validation,
      acceptance,
      providerContract,
      packageReadiness,
      providerSyncEvidence,
      lifecycleControlPlan,
      recoveryStatusHandoff,
      mailchimpStatusHandoff,
      externalHandoff,
      rollbackProviderHandoff,
      rollbackAcceptance,
      handoffGate,
    ),
  };
}

function buildHelloWorldReportingState({
  program,
  audit,
  exportSnapshot,
  providerContract,
  packageReadiness,
  providerSyncEvidence,
  lifecycleControlPlan,
  recoveryStatusHandoff,
  mailchimpStatusHandoff,
  handoffGate,
  acceptance,
  rollbackAnalytics,
  rollbackProviderHandoff,
  rollbackAcceptance,
  externalHandoff,
}) {
  const statusSummary = {
    state: mailchimpStatusHandoff.state,
    ready: mailchimpStatusHandoff.ready,
    nextStep: mailchimpStatusHandoff.nextStep,
    restartSafe: mailchimpStatusHandoff.restartSafe,
    gateStatus: mailchimpStatusHandoff.gate.status,
    accessAllowed: mailchimpStatusHandoff.accessBoundary.allowed,
    restartKey: mailchimpStatusHandoff.persistedState.restartKey,
    recoveryStateKey: mailchimpStatusHandoff.persistedState.recoveryPersistence.stateKey,
    auditSubjectCount: mailchimpStatusHandoff.auditHandoff.auditSubjects.length
  };
  const healthSummary = {
    health: mailchimpStatusHandoff.operationalHealth.health,
    severity: mailchimpStatusHandoff.operationalHealth.severity,
    actionable: mailchimpStatusHandoff.operationalHealth.actionable,
    nextAction: mailchimpStatusHandoff.operationalHealth.nextAction,
    retryAfterSeconds: mailchimpStatusHandoff.operationalHealth.retry.retryAfterSeconds,
    degradedMode: mailchimpStatusHandoff.operationalHealth.degradedMode.mode,
    incidentId: mailchimpStatusHandoff.operationalHealth.incident.incidentId,
    incidentStatus: mailchimpStatusHandoff.operationalHealth.incident.status,
    incidentOpen: mailchimpStatusHandoff.operationalHealth.incident.open,
    healthExportId: mailchimpStatusHandoff.operationalHealth.exportReadiness.exportId,
    healthExportStatus: mailchimpStatusHandoff.operationalHealth.exportReadiness.exportStatus,
    healthReadyForExport: mailchimpStatusHandoff.operationalHealth.exportReadiness.readyForExport,
    statusExportId: mailchimpStatusHandoff.exportPacket.exportId,
    statusExportStatus: mailchimpStatusHandoff.exportPacket.exportStatus,
    statusReadyForExport: mailchimpStatusHandoff.exportPacket.readyForExport,
    externalHandoffReady: externalHandoff.ready,
    externalHandoffStatus: externalHandoff.status,
    externalHandoffAction: externalHandoff.nextAction,
    externalHandoffToken: externalHandoff.handoffState.handoffToken,
    rollbackAcceptanceReady: rollbackAcceptance.ready,
    rollbackAcceptanceStatus: rollbackAcceptance.status,
    rollbackAcceptanceAction: rollbackAcceptance.nextAction,
    rollbackAcceptanceCanAccept: rollbackAcceptance.canAccept,
    statusExportTimelineEvents: mailchimpStatusHandoff.exportPacket.counters.timelineEvents,
    actionQueueDepth: mailchimpStatusHandoff.operationalHealth.actionQueue.length,
    errors: mailchimpStatusHandoff.operationalHealth.errors.map((error) => ({
      code: error.code,
      message: error.message,
      action: error.action,
      retryable: error.retryable
    }))
  };
  const auditTimeline = audit.timeline.map((event, index) => ({
    sequence: index + 1,
    status: event.status,
    at: event.at,
    message: event.message,
    source: "audit"
  }));
  const recoveryTimeline = [
    {
      sequence: auditTimeline.length + 1,
      status: recoveryStatusHandoff.ready ? "recovery-ready" : "recovery-blocked",
      at: "logical:recovery",
      message: recoveryStatusHandoff.ready
        ? "rollback recovery handoff ready"
        : recoveryStatusHandoff.blockedReasons[0] ?? "rollback recovery handoff blocked",
      source: "rollback"
    },
    {
      sequence: auditTimeline.length + 2,
      status: mailchimpStatusHandoff.ready ? "status-ready" : "status-blocked",
      at: "logical:status",
      message: mailchimpStatusHandoff.ready
        ? "Mailchimp status handoff ready"
        : mailchimpStatusHandoff.auditHandoff.blockedReasons[0] ?? "Mailchimp status handoff blocked",
      source: "mailchimp-status"
    },
    {
      sequence: auditTimeline.length + 3,
      status: mailchimpStatusHandoff.exportPacket.readyForExport ? "status-export-ready" : "status-export-blocked",
      at: "logical:status.export",
      message: mailchimpStatusHandoff.exportPacket.readyForExport
        ? "Mailchimp status export packet ready"
        : mailchimpStatusHandoff.exportPacket.blockedReasons[0] ?? "Mailchimp status export packet blocked",
      source: "status-export",
      action: mailchimpStatusHandoff.exportPacket.nextAction
    },
    {
      sequence: auditTimeline.length + 4,
      status: externalHandoff.ready ? "external-handoff-ready" : externalHandoff.status,
      at: "logical:status.external",
      message: externalHandoff.ready
        ? "Mailchimp external handoff state is ready"
        : externalHandoff.blockedReasons[0] ?? externalHandoff.clientState.visibleStatus,
      source: "status-external-handoff",
      action: externalHandoff.nextAction
    },
    {
      sequence: auditTimeline.length + 5,
      status: rollbackAcceptance.ready ? "rollback-accepted" : rollbackAcceptance.status,
      at: "logical:rollback.acceptance",
      message: rollbackAcceptance.ready
        ? "rollback recovery preview accepted"
        : rollbackAcceptance.blockedReasons[0] ?? rollbackAcceptance.preview.visibleStatus,
      source: "rollback-acceptance",
      action: rollbackAcceptance.nextAction
    },
    {
      sequence: auditTimeline.length + 6,
      status: rollbackProviderHandoff.handoffState.ready ? "provider-handoff-ready" : "provider-handoff-blocked",
      at: "logical:rollback.provider",
      message: rollbackProviderHandoff.handoffState.ready
        ? "rollback provider handoff contract ready"
        : rollbackProviderHandoff.handoffState.blockedReasons[0] ?? "rollback provider handoff contract blocked",
      source: "rollback-provider",
      action: rollbackProviderHandoff.handoffState.nextAction
    },
    ...mailchimpStatusHandoff.operationalHealth.incident.timeline.map((event, index) => ({
      sequence: auditTimeline.length + 7 + index,
      status: event.status,
      at: event.at,
      message: event.message,
      source: event.source,
      action: event.action
    })),
    {
      sequence: auditTimeline.length + 7 + mailchimpStatusHandoff.operationalHealth.incident.timeline.length,
      status: handoffGate.ready ? "handoff-ready" : handoffGate.status,
      at: "logical:handoff",
      message: handoffGate.ready
        ? "hello-world preview is ready for local summary handoff"
        : handoffGate.blockers[0]?.message ?? "hello-world preview is blocked",
      source: "hello-world"
    }
  ];
  const timeline = [...auditTimeline, ...recoveryTimeline];
  const counters = {
    timelineEvents: timeline.length,
    evidenceAccepted: audit.evidence.accepted.length,
    evidenceMissing: audit.evidence.missing.length,
    evidenceRejected: audit.evidence.rejected.length,
    externalWriteViolations: audit.boundary.externalWritesObserved.length,
    providerScopes: providerContract.negotiation.providerScopes.length,
    deniedCapabilities: providerContract.negotiation.deniedCapabilities.length,
    packageValidationErrors: packageReadiness.validationSummary.errors.length,
    packageValidationWarnings: packageReadiness.validationSummary.warnings.length,
    lifecycleCommands: lifecycleControlPlan.commandPlan.commands.length,
    recoveryBlockedReasons: recoveryStatusHandoff.blockedReasons.length,
    statusBlockedReasons: mailchimpStatusHandoff.auditHandoff.blockedReasons.length,
    statusHealthErrors: mailchimpStatusHandoff.operationalHealth.errors.length,
    statusHealthActions: mailchimpStatusHandoff.operationalHealth.actionQueue.length,
    statusIncidentReasons: mailchimpStatusHandoff.operationalHealth.incident.reasonCodes.length,
    statusIncidentTimelineEvents: mailchimpStatusHandoff.operationalHealth.incident.timeline.length,
    statusHealthExportAuditSubjects: mailchimpStatusHandoff.operationalHealth.exportReadiness.auditSubjects.length,
    statusExportAuditSubjects: mailchimpStatusHandoff.exportPacket.auditSubjects.length,
    statusExportTimelineEvents: mailchimpStatusHandoff.exportPacket.counters.timelineEvents,
    externalHandoffAuditSubjects: externalHandoff.sync.auditSubjects.length,
    externalHandoffDeniedCapabilities: externalHandoff.negotiation.deniedCapabilities.length,
    rollbackAcceptanceCommands: rollbackAcceptance.commands.length,
    rollbackAcceptanceBlockers: rollbackAcceptance.blockedReasons.length,
    rollbackTimelineEvents: rollbackAnalytics.timeline.length,
    rollbackPendingCheckpoints: rollbackAnalytics.counters.pendingCheckpoints,
    rollbackReplayableCommands: rollbackAnalytics.counters.replayableCommands,
    rollbackProviderCapabilityGrants: rollbackProviderHandoff.negotiation.grantedCapabilities.length,
    rollbackProviderCapabilityDenials: rollbackProviderHandoff.negotiation.deniedCapabilities.length,
    rollbackProviderBlockedReasons: rollbackProviderHandoff.handoffState.blockedReasons.length,
    handoffBlockers: handoffGate.blockerCount
  };
  const historySnapshots = timeline.map((event) => ({
    key: ["hello-world.history", program.job.id, event.sequence, event.status]
      .join(":")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/(^\.|\.$)/g, ""),
    at: event.at,
    status: event.status,
    source: event.source,
    exportId: exportSnapshot.exportId,
    ready: event.sequence === timeline.length ? handoffGate.ready : event.status.includes("ready")
  }));
  const exportSummary = {
    exportId: exportSnapshot.exportId,
    jobId: program.job.id,
    adapter: program.job.runtimeAdapter,
    readyForExport: exportSnapshot.truthBoundary.readyForExport && handoffGate.ready,
    format: exportSnapshot.format,
    status: handoffGate.ready ? "ready" : "blocked",
    primaryAction: handoffGate.nextAction,
    statusRestartKey: mailchimpStatusHandoff.persistedState.restartKey,
    recoveryStateKey: mailchimpStatusHandoff.persistedState.recoveryPersistence.stateKey,
    rollbackExportId: rollbackAnalytics.exportSummary.exportId,
    rollbackExportStatus: rollbackAnalytics.exportSummary.exportStatus,
    healthExportId: mailchimpStatusHandoff.operationalHealth.exportReadiness.exportId,
    healthExportStatus: mailchimpStatusHandoff.operationalHealth.exportReadiness.exportStatus,
    healthReadyForExport: mailchimpStatusHandoff.operationalHealth.exportReadiness.readyForExport,
    healthIncidentId: mailchimpStatusHandoff.operationalHealth.incident.incidentId,
    healthIncidentStatus: mailchimpStatusHandoff.operationalHealth.incident.status,
    statusExportId: mailchimpStatusHandoff.exportPacket.exportId,
    statusExportStatus: mailchimpStatusHandoff.exportPacket.exportStatus,
    statusReadyForExport: mailchimpStatusHandoff.exportPacket.readyForExport,
    externalHandoffStatus: externalHandoff.status,
    externalHandoffReady: externalHandoff.ready,
    externalHandoffToken: externalHandoff.handoffState.handoffToken,
    rollbackAcceptanceStatus: rollbackAcceptance.status,
    rollbackAcceptanceReady: rollbackAcceptance.ready,
    rollbackAcceptanceCanAccept: rollbackAcceptance.canAccept,
    rollbackProviderContractId: rollbackProviderHandoff.contractId,
    rollbackProviderStatus: rollbackProviderHandoff.handoffState.status,
    rollbackProviderReady: rollbackProviderHandoff.handoffState.ready,
    healthActions: mailchimpStatusHandoff.operationalHealth.actionQueue.map((action) => ({
      sequence: action.sequence,
      command: action.command,
      category: action.category,
      reason: action.reason,
      retryable: action.retryable
    })),
    auditSubjects: mailchimpStatusHandoff.auditHandoff.auditSubjects,
    blockedReasons: uniqueSorted([
      ...recoveryStatusHandoff.blockedReasons,
      ...mailchimpStatusHandoff.auditHandoff.blockedReasons,
      ...(mailchimpStatusHandoff.operationalHealth.exportReadiness.readyForExport
        ? []
        : [`health export blocked: ${mailchimpStatusHandoff.operationalHealth.exportReadiness.nextAction}`]),
      ...(mailchimpStatusHandoff.exportPacket.readyForExport
        ? []
        : mailchimpStatusHandoff.exportPacket.blockedReasons),
      ...(externalHandoff.ready ? [] : externalHandoff.blockedReasons),
      ...(rollbackAcceptance.ready ? [] : rollbackAcceptance.blockedReasons),
      ...(rollbackProviderHandoff.handoffState.ready
        ? []
        : rollbackProviderHandoff.handoffState.blockedReasons),
      ...handoffGate.blockers.map((blocker) => blocker.message),
      ...acceptance.blockedReasons,
      ...providerSyncEvidence.readiness.blockedReasons,
      ...(lifecycleControlPlan.nextActionState.disabledReason
        ? [lifecycleControlPlan.nextActionState.disabledReason]
        : [])
    ])
  };

  return {
    kind: "mailchimp.hello-world.reporting-state",
    apiVersion: "aios.example/v1",
    jobId: program.job.id,
    counters,
    statusSummary,
    healthSummary,
    timeline,
    historySnapshots,
    rollbackAnalytics,
    exportSummary,
    truthBoundary: {
      externalWrites: false,
      source: "mailchimp-hello-world-reporting",
      auditExportReady: exportSnapshot.truthBoundary.readyForExport,
      providerSyncReady: providerSyncEvidence.readiness.ready,
      statusAuditReady: mailchimpStatusHandoff.auditHandoff.ready,
      statusHealth: mailchimpStatusHandoff.operationalHealth.health,
      statusHealthExportReady: mailchimpStatusHandoff.operationalHealth.exportReadiness.readyForExport,
      statusExportReady: mailchimpStatusHandoff.exportPacket.readyForExport,
      externalHandoffReady: externalHandoff.ready,
      rollbackAcceptanceReady: rollbackAcceptance.ready,
      statusIncidentOpen: mailchimpStatusHandoff.operationalHealth.incident.open,
      rollbackAnalyticsReady: rollbackAnalytics.exportSummary.readyForExport,
      rollbackProviderReady: rollbackProviderHandoff.handoffState.ready
    }
  };
}

function buildHelloWorldControlState({
  program,
  lifecycleControlPlan,
  mailchimpStatusHandoff,
  handoffGate,
  acceptance,
  options,
}) {
  const requestedEnabled = Boolean(options.enabled ?? program.lifecycle.enabled);
  const schedule = options.schedule ?? program.lifecycle.schedule ?? { mode: "manual" };
  const scheduleMode = String(schedule.mode ?? "manual").trim().toLowerCase();
  const validSchedule = ["manual", "interval", "cron"].includes(scheduleMode);
  const intervalMinutes = Number(schedule.intervalMinutes ?? schedule.everyMinutes ?? 0);
  const validInterval = scheduleMode !== "interval"
    || (Number.isFinite(intervalMinutes) && intervalMinutes >= 5);
  const cron = String(schedule.cron ?? "").trim();
  const validCron = scheduleMode !== "cron" || cron.split(/\s+/).length === 5;
  const canEnable = requestedEnabled
    && validSchedule
    && validInterval
    && validCron
    && mailchimpStatusHandoff.operationalHealth.health !== "failed";
  const healthAction = mailchimpStatusHandoff.operationalHealth.actionQueue[0] ?? null;
  const healthExport = mailchimpStatusHandoff.operationalHealth.exportReadiness;
  const controlBlockers = uniqueSorted([
    ...(validSchedule ? [] : [`unsupported schedule mode ${scheduleMode || "unknown"}`]),
    ...(validInterval ? [] : ["interval schedule must be at least 5 minutes"]),
    ...(validCron ? [] : ["cron schedule must contain five fields"]),
    ...(mailchimpStatusHandoff.operationalHealth.health === "failed"
      ? mailchimpStatusHandoff.operationalHealth.errors.map((error) => error.message)
      : []),
    ...(handoffGate.ready || !acceptance.accepted
      ? []
      : handoffGate.blockers.map((blocker) => blocker.message))
  ]);
  const commands = [
    {
      command: requestedEnabled ? "hello-world.disable" : "hello-world.enable",
      enabled: true,
      reason: requestedEnabled
        ? "disable local Mailchimp preview scheduling"
        : "enable local Mailchimp preview scheduling"
    },
    {
      command: "hello-world.schedule.update",
      enabled: canEnable,
      reason: canEnable
        ? `apply ${scheduleMode} schedule`
        : controlBlockers[0] ?? "schedule cannot be applied yet"
    },
    {
      command: "hello-world.preview.run",
      enabled: handoffGate.ready,
      reason: handoffGate.ready
        ? "run deterministic local preview"
        : handoffGate.blockers[0]?.message ?? "preview gate is blocked"
    },
    {
      command: "hello-world.status.retry",
      enabled: mailchimpStatusHandoff.operationalHealth.retry.retryable,
      reason: mailchimpStatusHandoff.operationalHealth.retry.retryable
        ? `retry after ${mailchimpStatusHandoff.operationalHealth.retry.retryAfterSeconds ?? 0} second(s)`
        : "no retry window is active"
    },
    {
      command: "hello-world.status.incident.review",
      enabled: mailchimpStatusHandoff.operationalHealth.incident.open,
      reason: mailchimpStatusHandoff.operationalHealth.incident.open
        ? healthAction?.reason ?? mailchimpStatusHandoff.operationalHealth.incident.primaryReason
        : "no status incident is open"
    },
    {
      command: "hello-world.status.health.export",
      enabled: healthExport.readyForExport,
      reason: healthExport.readyForExport
        ? `export ${healthExport.exportStatus} status health`
        : `health export blocked by ${healthExport.nextAction}`
    },
    {
      command: "hello-world.status.export",
      enabled: mailchimpStatusHandoff.exportPacket.readyForExport,
      reason: mailchimpStatusHandoff.exportPacket.readyForExport
        ? `export ${mailchimpStatusHandoff.exportPacket.exportStatus} status packet`
        : mailchimpStatusHandoff.exportPacket.blockedReasons[0] ?? "status export packet is blocked"
    }
  ];

  return {
    kind: "mailchimp.hello-world.control-state",
    apiVersion: "aios.example/v1",
    enabled: requestedEnabled && canEnable,
    requestedEnabled,
    schedule: {
      mode: scheduleMode,
      valid: validSchedule && validInterval && validCron,
      intervalMinutes: scheduleMode === "interval" ? intervalMinutes : null,
      cron: scheduleMode === "cron" ? cron : null
    },
    nextAction: commands.find((command) => command.enabled)?.command ?? "hello-world.controls.review",
    blockers: controlBlockers,
    commands,
    statusIncident: {
      incidentId: mailchimpStatusHandoff.operationalHealth.incident.incidentId,
      open: mailchimpStatusHandoff.operationalHealth.incident.open,
      status: mailchimpStatusHandoff.operationalHealth.incident.status,
      severity: mailchimpStatusHandoff.operationalHealth.severity,
      nextAction: mailchimpStatusHandoff.operationalHealth.incident.nextAction,
      primaryReason: mailchimpStatusHandoff.operationalHealth.incident.primaryReason,
      actionQueueDepth: mailchimpStatusHandoff.operationalHealth.actionQueue.length
    },
    healthExport: {
      exportId: healthExport.exportId,
      readyForExport: healthExport.readyForExport,
      exportStatus: healthExport.exportStatus,
      auditSubjectCount: healthExport.auditSubjects.length,
      nextAction: healthExport.nextAction
    },
    statusExport: {
      exportId: mailchimpStatusHandoff.exportPacket.exportId,
      readyForExport: mailchimpStatusHandoff.exportPacket.readyForExport,
      exportStatus: mailchimpStatusHandoff.exportPacket.exportStatus,
      auditSubjectCount: mailchimpStatusHandoff.exportPacket.auditSubjects.length,
      timelineEvents: mailchimpStatusHandoff.exportPacket.counters.timelineEvents,
      nextAction: mailchimpStatusHandoff.exportPacket.nextAction
    },
    lifecycle: {
      status: lifecycleControlPlan.status,
      verifierReady: lifecycleControlPlan.nextActionState.ready,
      nextAction: lifecycleControlPlan.nextActionState.action,
      disabledReason: lifecycleControlPlan.nextActionState.disabledReason
    },
    truthBoundary: {
      externalWrites: false,
      source: "mailchimp-hello-world-controls",
      statusHealth: mailchimpStatusHandoff.operationalHealth.health,
      statusIncidentOpen: mailchimpStatusHandoff.operationalHealth.incident.open,
      healthExportReady: healthExport.readyForExport,
      statusExportReady: mailchimpStatusHandoff.exportPacket.readyForExport
    }
  };
}

function summarizeHelloWorldValidation(program, audit, exportSnapshot, providerContract) {
  const errors = [];
  const warnings = [];

  if (!program.lifecycle.validation.valid) {
    errors.push(...program.lifecycle.validation.errors);
  }
  if (audit.evidence.missing.length > 0) {
    errors.push(`${audit.evidence.missing.length} evidence receipt(s) missing`);
  }
  if (audit.boundary.externalWritesObserved.length > 0) {
    errors.push(`${audit.boundary.externalWritesObserved.length} external write violation(s) observed`);
  }
  if (!providerContract.negotiation.satisfied) {
    errors.push("Mailchimp provider capabilities require review");
  }
  if (!exportSnapshot.truthBoundary.readyForExport) {
    warnings.push("audit export is pending truth-boundary completion");
  }
  if (program.lifecycle.validation.warnings.length > 0) {
    warnings.push(...program.lifecycle.validation.warnings);
  }

  return {
    ready: errors.length === 0
      && exportSnapshot.truthBoundary.readyForExport
      && providerContract.handoffState.ready,
    errors,
    warnings,
    checked: {
      lifecycleValid: program.lifecycle.validation.valid,
      auditStatus: audit.status,
      exportReady: exportSnapshot.truthBoundary.readyForExport,
      providerReady: providerContract.handoffState.ready,
      memoryWritePolicy: program.job.memory.writePolicy,
    },
  };
}

function buildHelloWorldAcceptance(validation, providerContract, packageReadiness, options) {
  const accepted = Boolean(options.accepted ?? false)
    && validation.ready
    && packageReadiness.validationSummary.valid;
  const acceptedBy = accepted ? String(options.acceptedBy ?? "operator") : null;

  return {
    accepted,
    acceptedBy,
    acceptedAt: accepted ? String(options.acceptedAt ?? "logical:5") : null,
    blockedReasons: accepted ? [] : uniqueSorted([
      ...validation.errors,
      ...packageReadiness.acceptance.blockedReasons,
      ...providerContract.handoffState.blockedReasons,
    ]),
    nextAction: accepted
      ? "handoff-local-summary"
      : validation.ready
        ? packageReadiness.readiness.nextAction
        : providerContract.handoffState.nextAction,
  };
}

function buildHelloWorldNextSteps(
  validation,
  acceptance,
  providerContract,
  packageReadiness,
  providerSyncEvidence,
  lifecycleControlPlan,
  recoveryStatusHandoff,
  mailchimpStatusHandoff,
  externalHandoff,
  rollbackProviderHandoff,
  rollbackAcceptance,
  handoffGate,
) {
  if (!handoffGate.ready) {
    return handoffGate.blockers.map((blocker) => ({
      action: blocker.action,
      label: blocker.label,
      reason: blocker.message,
      category: blocker.category,
    }));
  }

  if (!recoveryStatusHandoff.ready) {
    return recoveryStatusHandoff.blockedReasons.map((reason) => ({
      action: recoveryStatusHandoff.runtimeCommand,
      label: "Prepare recovery handoff",
      reason,
    }));
  }

  if (!mailchimpStatusHandoff.exportPacket.readyForExport) {
    return mailchimpStatusHandoff.exportPacket.blockedReasons.map((reason) => ({
      action: mailchimpStatusHandoff.exportPacket.nextAction,
      label: "Prepare status export",
      reason,
    }));
  }

  if (!externalHandoff.ready) {
    return externalHandoff.blockedReasons.map((reason) => ({
      action: externalHandoff.nextAction,
      label: "Prepare external status handoff",
      reason,
    }));
  }

  if (!rollbackAcceptance.ready) {
    return rollbackAcceptance.nextSteps.map((step) => ({
      action: step.action,
      label: step.label,
      reason: step.reason,
    }));
  }

  if (!rollbackProviderHandoff.handoffState.ready) {
    return rollbackProviderHandoff.handoffState.blockedReasons.map((reason) => ({
      action: rollbackProviderHandoff.handoffState.nextAction,
      label: "Prepare rollback provider handoff",
      reason,
    }));
  }

  if (!lifecycleControlPlan.nextActionState.ready) {
    return lifecycleControlPlan.commandPlan.commands.map((command) => ({
      action: command.command,
      label: lifecycleControlPlan.nextActionState.label,
      reason: command.reason,
    }));
  }

  if (!providerSyncEvidence.readiness.ready) {
    return providerSyncEvidence.readiness.blockedReasons.map((reason) => ({
      action: providerSyncEvidence.readiness.nextAction,
      label: "Record provider sync evidence",
      reason,
    }));
  }

  if (!validation.ready) {
    const reasons = validation.errors.length > 0
      ? validation.errors
      : providerContract.handoffState.blockedReasons;
    return reasons.map((reason) => ({
      action: providerContract.handoffState.nextAction,
      label: "Resolve preview blocker",
      reason,
    }));
  }

  if (!acceptance.accepted) {
    return packageReadiness.nextSteps.map((step) => ({
      action: step.action,
      label: step.label,
      reason: step.reason,
    }));
  }

  return [{
    action: providerContract.handoffState.runtimeCommand ?? "package.preview",
    label: "Open local campaign summary",
    reason: "operator accepted the Mailchimp read-only preview",
  }];
}

function buildHelloWorldVerifierJob(program, options) {
  return {
    id: program.job.id,
    payload: {
      campaignName: options.campaignName ?? "hello-world-campaign",
      listId: options.listId ?? "list_readonly",
      subjectLine: options.subjectLine ?? "Hello from AI OS",
      sendAt: options.sendAt ?? "2026-07-03T12:30:00.000Z",
    },
    memory: {
      required: ["campaignName", "listId", "subjectLine"],
      memoryKey: program.job.memory.namespace,
      continuationKey: `hello-world:${program.job.id}`,
      checksum: program.job.id,
    },
    capabilities: program.job.capabilities.map((capability) => ({ scope: capability })),
    runtimeAdapter: {
      mode: "deferred-handoff",
      externalWritePermittedAfterVerification: true,
    },
    runtimeScope: {
      tenantId: options.tenantId ?? "tenant_demo",
      workspaceId: options.workspaceId ?? "workspace_demo",
      actorId: options.actorId ?? "operator_demo",
      isolationKey: program.job.memory.namespace,
      missingPermissions: options.missingPermissions ?? [],
    },
    truthBoundary: {
      externalWrites: false,
    },
  };
}

function buildHelloWorldVerifierContext(providerContract, options) {
  const granted = new Set(providerContract.negotiation.grantedCapabilities);
  const requested = providerContract.negotiation.requestedCapabilities;
  const missing = requested.filter((capability) => !granted.has(capability));

  return {
    now: options.verifierNow ?? "2026-07-03T12:00:00.000Z",
    minLeadMinutes: options.minLeadMinutes ?? 15,
    capabilityValidation: {
      allowed: missing.length === 0,
      missing,
    },
    memoryContract: {
      records: [],
    },
    adapterHealth: {
      status: options.adapterHealth ?? "healthy",
      checkedAt: options.adapterCheckedAt ?? "logical:6",
      retryAfterSeconds: options.adapterRetryAfterSeconds,
    },
  };
}

function buildHelloWorldRuntimeHandoff(
  program,
  packageReadiness,
  providerSyncEvidence,
  lifecycleControlPlan,
  acceptance,
  recoveryStatusHandoff,
  mailchimpStatusHandoff,
  externalHandoff,
  rollbackProviderHandoff,
  rollbackAcceptance,
  handoffGate,
) {
  const ready = handoffGate.ready
    && externalHandoff.ready
    && rollbackAcceptance.ready
    && rollbackProviderHandoff.handoffState.ready
    && mailchimpStatusHandoff.exportPacket.readyForExport;

  return {
    ready,
    command: ready ? packageReadiness.readiness.nextAction : handoffGate.nextAction,
    jobId: program.job.id,
    handoffToken: ready
      ? packageReadiness.provider.primaryAction
      : null,
    localMemoryNamespace: program.job.memory.namespace,
    truthBoundary: {
      externalWrites: false,
      auditReceipt: providerSyncEvidence.receipt,
      verifierSource: lifecycleControlPlan.nextActionState.truthBoundary.source,
      recoveryStatusEvent: recoveryStatusHandoff.statusEvent,
      handoffGate: handoffGate.status,
      statusExportId: mailchimpStatusHandoff.exportPacket.exportId,
      externalHandoffStatus: externalHandoff.status,
      externalHandoffToken: externalHandoff.handoffState.handoffToken,
      rollbackProviderContractId: rollbackProviderHandoff.contractId,
      rollbackAcceptanceStatus: rollbackAcceptance.status,
    },
    recovery: recoveryStatusHandoff,
    statusExport: mailchimpStatusHandoff.exportPacket,
    externalHandoff,
    rollbackAcceptance,
    rollbackProviderHandoff,
    gate: handoffGate,
    blockedReasons: ready ? [] : uniqueSorted([
      ...handoffGate.blockers.map((blocker) => blocker.message),
      ...acceptance.blockedReasons,
      ...providerSyncEvidence.readiness.blockedReasons,
      ...recoveryStatusHandoff.blockedReasons,
      ...mailchimpStatusHandoff.exportPacket.blockedReasons,
      ...externalHandoff.blockedReasons,
      ...rollbackAcceptance.blockedReasons,
      ...rollbackProviderHandoff.handoffState.blockedReasons,
      ...(lifecycleControlPlan.nextActionState.disabledReason
        ? [lifecycleControlPlan.nextActionState.disabledReason]
        : []),
    ]),
  };
}

function buildHelloWorldHandoffGate({
  validation,
  acceptance,
  packageReadiness,
  providerSyncEvidence,
  lifecycleControlPlan,
  recoveryStatusHandoff,
}) {
  const blockers = uniqueBlockers([
    ...validation.errors.map((message) => ({
      id: gateId("validation", message),
      category: "validation",
      action: "package.preview.review",
      label: "Resolve preview blocker",
      message,
      restartSafe: true,
    })),
    ...packageReadiness.acceptance.blockedReasons.map((message) => ({
      id: gateId("package", message),
      category: "package",
      action: packageReadiness.readiness.nextAction,
      label: "Prepare package handoff",
      message,
      restartSafe: true,
    })),
    ...providerSyncEvidence.readiness.blockedReasons.map((message) => ({
      id: gateId("sync", message),
      category: "evidence",
      action: providerSyncEvidence.readiness.nextAction,
      label: "Record provider sync evidence",
      message,
      restartSafe: true,
    })),
    ...(lifecycleControlPlan.nextActionState.ready ? [] : [{
      id: gateId("lifecycle", lifecycleControlPlan.nextActionState.disabledReason),
      category: "lifecycle",
      action: lifecycleControlPlan.nextActionState.action,
      label: lifecycleControlPlan.nextActionState.label,
      message: lifecycleControlPlan.nextActionState.disabledReason,
      restartSafe: true,
    }]),
    ...recoveryStatusHandoff.blockedReasons.map((message) => ({
      id: gateId("recovery", message),
      category: "recovery",
      action: recoveryStatusHandoff.runtimeCommand,
      label: "Prepare recovery handoff",
      message,
      restartSafe: recoveryStatusHandoff.gate?.restartSafe ?? true,
    })),
    ...(acceptance.accepted ? [] : [{
      id: gateId("acceptance", acceptance.nextAction),
      category: "operator",
      action: acceptance.nextAction,
      label: "Accept local preview",
      message: "operator acceptance required before Mailchimp runtime handoff",
      restartSafe: true,
    }]),
  ]);
  const status = helloWorldGateStatus(blockers);

  return {
    kind: "mailchimp.hello-world.handoff-gate",
    apiVersion: "aios.example/v1",
    ready: status === "open",
    status,
    nextAction: helloWorldGateNextAction(status, blockers, acceptance),
    blockerCount: blockers.length,
    blockers,
    restartSafe: blockers.every((blocker) => blocker.restartSafe !== false),
    categories: blockers.reduce((counts, blocker) => {
      counts[blocker.category] = (counts[blocker.category] ?? 0) + 1;
      return counts;
    }, {}),
    truthBoundary: {
      externalWrites: false,
      source: "mailchimp-hello-world-preview",
      recoveryGate: recoveryStatusHandoff.gate?.status ?? "unknown",
    },
  };
}

function helloWorldGateStatus(blockers) {
  if (blockers.length === 0) return "open";
  if (blockers.some((blocker) => blocker.category === "validation")) return "validation_blocked";
  if (blockers.some((blocker) => blocker.category === "lifecycle")) return "lifecycle_blocked";
  if (blockers.some((blocker) => blocker.category === "recovery")) return "recovery_blocked";
  if (blockers.some((blocker) => blocker.category === "evidence")) return "evidence_blocked";
  if (blockers.some((blocker) => blocker.category === "operator")) return "awaiting_acceptance";
  return "package_blocked";
}

function helloWorldGateNextAction(status, blockers, acceptance) {
  if (status === "open") return "handoff-local-summary";
  const blocker = blockers[0];
  if (status === "awaiting_acceptance") return acceptance.nextAction;
  return blocker?.action ?? "package.preview.review";
}

function gateId(scope, value) {
  return ["hello-world", scope, String(value ?? "pending")]
    .join(":")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/(^\.|\.$)/g, "");
}

function uniqueBlockers(blockers) {
  const seen = new Set();
  return blockers
    .filter((blocker) => blocker.message)
    .filter((blocker) => {
      const key = [blocker.category, blocker.action, blocker.message].join(":");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}
