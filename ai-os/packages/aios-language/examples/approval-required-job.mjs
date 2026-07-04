import {
  createAuditExportSnapshot,
  createEvidence,
  createStatusEvent,
  createTruthBoundaryReport,
} from "../stdlib/audit.mjs";
import {
  buildPackageOperationalReport,
  buildPackageReadinessPreview,
  buildProviderServiceContract,
  compilePackageSource,
} from "../stdlib/packages.mjs";
import {
  buildRecoveryStatusHandoff,
  buildRollbackContract,
  summarizeRollbackContract,
} from "../stdlib/rollback.mjs";

export const approvalRequiredJobSource = `# deterministic Mailchimp approval gate before adapter handoff
use mailchimp:campaign.read
use memory:campaign.local
use verifier:evidence.record
use status:timeline.write
recover rollback=snapshot retry=1
step load-approval-context input=approvalTicket output=approvalContext verify.intent=operator-approved
step fetch-campaign-preview input=approvalContext.campaignId output=campaign verify.source=mailchimp
step record-approval-evidence input=campaign output=approvalEvidence verify.truth=operator-visible
step publish-approval-status input=approvalEvidence output=statusEvent verify.boundary=no-external-write
`;

const REQUIRED_EXPORTS = Object.freeze([
  "compile",
  "audit",
  "preview",
  "approvalContract",
  "selfCheck",
]);

export function buildApprovalRequiredProgram(options = {}) {
  return compilePackageSource(approvalRequiredJobSource, {
    name: options.name ?? "mailchimp-approval-required-job",
    version: options.version ?? "0.1.0",
    description: "Compile a Mailchimp read job that cannot hand off until an operator approval ticket is present.",
    capabilities: options.capabilities ?? [],
    exports: {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      preview: "./examples/approval-required-job.mjs#buildApprovalRequiredPreview",
      approvalContract: "./examples/approval-required-job.mjs#buildApprovalRequiredContract",
      selfCheck: "./examples/approval-required-job.mjs#selfCheckApprovalRequiredJob",
    },
  }, {
    name: "mailchimp-approval-required-job",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: true,
      requireApproval: true,
      approvalTicket: options.approvalTicket,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 12,
    },
  });
}

export function buildApprovalRequiredAudit(program = buildApprovalRequiredProgram(), options = {}) {
  const missing = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missing.has(subject))
    .map((subject) => createEvidence(
      subject.includes("verify.source") ? "mailchimp-read-receipt" : "operator-attestation",
      subject,
      { example: "approval-required-job", approvalTicket: options.approvalTicket ?? "pending" },
    ));

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "completed",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "approval-gated job queued" }),
      createStatusEvent("running", { at: "logical:1", message: "approval context loaded" }),
      createStatusEvent("verifying", { at: "logical:2", message: "approval evidence verified" }),
      createStatusEvent(options.status ?? "completed", {
        at: "logical:3",
        message: "approval handoff status shaped",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildApprovalRequiredContract(
  program = buildApprovalRequiredProgram(),
  audit = buildApprovalRequiredAudit(program),
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
    providerResource: "campaign-approval-preview",
    supportedCapabilities: options.supportedCapabilities,
  });
  const rollbackContract = buildRollbackContract(withRollbackVerifierHints(program), audit, {
    adapterStatus: options.adapterHealth,
    adapterCheckedAt: options.adapterCheckedAt ?? "logical:5",
    completedSteps: options.completedSteps ?? program.job.plan.length,
    failedStep: options.failedStep,
    retryAfterSeconds: options.adapterRetryAfterSeconds,
  });
  const recoveryStatus = buildRecoveryStatusHandoff(rollbackContract, {
    accepted: Boolean(options.approvalTicket) && Boolean(options.accepted ?? false),
  });
  const packageReport = buildPackageOperationalReport(program, {
    generatedAt: options.generatedAt ?? "logical:4",
    exportFormat: options.packageReportFormat ?? "json.approval-operational-summary",
    history: options.packageHistory ?? options.history ?? [],
    providerContract,
    acceptance: {
      accepted: Boolean(options.accepted ?? false),
      acceptedBy: options.acceptedBy,
      acceptedAt: options.acceptedAt ?? "logical:6",
    },
    runtimeState: {
      persistedState: options.persistedRuntimeState ?? {
        ready: Boolean(options.accepted ?? false),
        restartSafe: Boolean(recoveryStatus.restartToken),
        stateKey: `${program.job.memory.namespace}:approval:runtime`,
        restart: {
          token: recoveryStatus.restartToken,
          command: "approval.handoff",
        },
      },
      clientState: options.clientRuntimeState ?? {
        ready: Boolean(options.accepted ?? false),
        status: options.accepted ? "approval-runtime-ready" : "approval-runtime-review",
        runtime: {
          enabled: Boolean(options.accepted ?? false),
          command: "approval.handoff",
        },
      },
    },
  });
  const operationalHealth = buildApprovalOperationalHealth(program, audit, recoveryStatus, options);
  const exportStatus = validateExports(program.manifest.exports);
  const approval = normalizeApproval(options);
  const lifecycleControls = buildApprovalLifecycleControls(program, approval, options);
  const boundary = buildTenantPermissionBoundary(program, audit, approval, options);
  const decisionPacket = buildApprovalDecisionPacket(
    program,
    audit,
    exportSnapshot,
    approval,
    lifecycleControls,
    boundary,
    operationalHealth,
    recoveryStatus,
    options,
  );
  const requestState = buildApprovalRequestState(
    program,
    audit,
    exportSnapshot,
    approval,
    lifecycleControls,
    boundary,
    decisionPacket,
    operationalHealth,
    recoveryStatus,
    options,
  );
  const providerOutbox = buildApprovalProviderOutbox(
    program,
    audit,
    exportSnapshot,
    providerContract,
    approval,
    boundary,
    decisionPacket,
    requestState,
    recoveryStatus,
    options,
  );
  const analytics = buildApprovalExportAnalytics(
    program,
    audit,
    exportSnapshot,
    approval,
    boundary,
    operationalHealth,
    recoveryStatus,
    options,
  );
  const auditPermissionHandoff = buildApprovalAuditPermissionHandoff(
    program,
    audit,
    exportSnapshot,
    approval,
    lifecycleControls,
    boundary,
    decisionPacket,
    requestState,
    providerOutbox,
    operationalHealth,
    recoveryStatus,
    options,
  );
  const blockers = uniqueSorted([
    ...approval.blockedReasons,
    ...boundary.blockedReasons,
    ...operationalHealth.blockedReasons,
    ...lifecycleControls.blockedReasons,
    ...requestState.validation.blockers,
    ...providerOutbox.validation.blockers,
    ...exportStatus.missing.map((name) => `manifest export missing: ${name}`),
    ...(program.lifecycle.validation.valid ? [] : program.lifecycle.validation.errors),
    ...(exportSnapshot.truthBoundary.readyForExport ? [] : [exportSnapshot.summary]),
    ...providerContract.handoffState.blockedReasons,
    ...recoveryStatus.blockedReasons,
    ...auditPermissionHandoff.validation.blockedReasons,
  ]);
  const ready = blockers.length === 0;
  const statusEnvelope = buildApprovalStatusHandoffEnvelope(
    program,
    audit,
    exportSnapshot,
    providerContract,
    approval,
    lifecycleControls,
    boundary,
    decisionPacket,
    requestState,
    providerOutbox,
    auditPermissionHandoff,
    operationalHealth,
    recoveryStatus,
    blockers,
    ready,
    options,
  );
  const recoveryExportSummary = buildApprovalRecoveryExportSummary(
    program,
    audit,
    exportSnapshot,
    approval,
    lifecycleControls,
    boundary,
    decisionPacket,
    requestState,
    providerOutbox,
    auditPermissionHandoff,
    operationalHealth,
    recoveryStatus,
    statusEnvelope,
    blockers,
    ready,
    options,
  );
  const commandReport = buildApprovalCommandReport(
    program,
    audit,
    exportSnapshot,
    approval,
    lifecycleControls,
    boundary,
    decisionPacket,
    requestState,
    providerOutbox,
    auditPermissionHandoff,
    statusEnvelope,
    recoveryExportSummary,
    analytics,
    blockers,
    ready,
    options,
  );

  return deepFreeze({
    kind: "mailchimp.approval-required.contract",
    apiVersion: "aios.example/v1",
    jobId: program.job.id,
    approval,
    lifecycleControls,
    boundary,
    decisionPacket,
    requestState,
    providerOutbox,
    auditPermissionHandoff,
    statusEnvelope,
    recoveryExportSummary,
    commandReport,
    operationalHealth,
    analytics,
    packageReport: {
      exportId: packageReport.exportId,
      ready: packageReport.ready,
      status: packageReport.status,
      nextAction: packageReport.nextAction,
      counters: packageReport.counters,
      exportSummary: packageReport.exportSummary,
      timelineReport: packageReport.timelineReport,
      actionCards: packageReport.actionCards,
    },
    exports: exportStatus,
    audit: {
      status: audit.status,
      exportId: exportSnapshot.exportId,
      readyForExport: exportSnapshot.truthBoundary.readyForExport,
      handoff: boundary.auditHandoff,
    },
    provider: providerContract.provider,
    recovery: {
      summary: summarizeRollbackContract(rollbackContract),
      statusHandoff: recoveryStatus,
    },
    runtimeHandoff: {
      ready,
      command: ready ? decisionPacket.commands.handoff.command : decisionPacket.nextAction.command,
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
      envelopeId: statusEnvelope.envelopeId,
      envelopeStatus: statusEnvelope.status,
      envelopeRevision: statusEnvelope.revision,
      adapterStatus: statusEnvelope.adapter.status,
      adapterCommand: statusEnvelope.adapter.command,
      statusEvent: ready ? "completed" : operationalHealth.visibleState,
      previewToken: decisionPacket.preview.previewToken,
      requestId: requestState.request.requestId,
      providerOutboxKey: providerOutbox.outboxKey,
      providerOutboxStatus: providerOutbox.status.status,
      providerServiceContractId: providerOutbox.serviceContract.contractId,
      providerServiceContractStatus: providerOutbox.serviceContract.status,
      providerServiceNextAction: providerOutbox.serviceContract.nextAction.command,
      providerAckCommand: providerOutbox.commands.ack.command,
      auditPermissionHandoffKey: auditPermissionHandoff.handoffKey,
      auditPermissionHandoffStatus: auditPermissionHandoff.status,
      packageReportStatus: packageReport.status,
      packageReportExportId: packageReport.exportId,
      recoveryExportId: recoveryExportSummary.exportId,
      recoveryExportStatus: recoveryExportSummary.status,
      recoveryExportReady: recoveryExportSummary.ready,
      recoveryNextCommand: recoveryExportSummary.restart.nextCommand,
      commandReportId: commandReport.reportId,
      commandReportReady: commandReport.ready,
      commandReportStatus: commandReport.status,
      commandReportNextAction: commandReport.nextAction,
      clientPhase: requestState.visibleState.phase,
      persistedStatus: requestState.persistedRuntimeState.status,
      decisionKey: decisionPacket.acceptance.decisionKey,
      validationSummary: decisionPacket.validation.summary,
      blockedReasons: blockers,
    },
  });
}

export function buildApprovalRequiredPreview(options = {}) {
  const program = options.program ?? buildApprovalRequiredProgram(options);
  const audit = options.audit ?? buildApprovalRequiredAudit(program, options);
  const contract = buildApprovalRequiredContract(program, audit, options);
  const packageReadiness = buildPackageReadinessPreview(program, {
    providerContract: buildProviderServiceContract(program, {
      externalApproval: options.approvalTicket,
      providerResource: "campaign-approval-preview",
    }),
    acceptance: {
      accepted: options.accepted ?? false,
      acceptedBy: options.acceptedBy,
      acceptedAt: options.acceptedAt ?? "logical:6",
    },
  });

  return deepFreeze({
    kind: "mailchimp.approval-required.preview",
    apiVersion: "aios.example/v1",
    title: "Mailchimp approval-required handoff",
    jobId: program.job.id,
    readiness: {
      ready: contract.runtimeHandoff.ready && packageReadiness.readiness.ready,
      approvalReady: contract.approval.accepted,
      boundaryReady: contract.boundary.ready,
      lifecycleReady: contract.lifecycleControls.ready,
      healthReady: contract.operationalHealth.ready,
      analyticsReady: contract.analytics.exportSummary.ready,
      requestReady: contract.requestState.validation.ready,
      providerOutboxReady: contract.providerOutbox.validation.ready,
      providerServiceContractReady: contract.providerOutbox.serviceContract.ready,
      degradedMode: contract.operationalHealth.degradedMode,
      packageReady: packageReadiness.readiness.ready,
      packageReportReady: contract.packageReport.ready,
      recoveryReady: contract.recovery.statusHandoff.ready,
      statusEnvelopeReady: contract.statusEnvelope.ready,
      recoveryExportReady: contract.recoveryExportSummary.ready,
      commandReportReady: contract.commandReport.ready,
      blockedReasons: uniqueSorted([
        ...contract.runtimeHandoff.blockedReasons,
        ...contract.providerOutbox.serviceContract.validation.blockedReasons,
        ...contract.statusEnvelope.validation.blockedReasons,
        ...contract.recoveryExportSummary.validation.blockedReasons,
        ...contract.commandReport.validation.blockedReasons,
        ...packageReadiness.acceptance.blockedReasons,
        ...(contract.packageReport.exportSummary.disabledReason ? [contract.packageReport.exportSummary.disabledReason] : []),
      ]),
    },
    contract,
    packageReadiness,
    decisionPacket: contract.decisionPacket,
    nextSteps: buildApprovalNextSteps(contract, packageReadiness),
  });
}

export function describeApprovalRequiredJob(options = {}) {
  const preview = buildApprovalRequiredPreview(options);
  return deepFreeze({
    jobId: preview.jobId,
    ready: preview.readiness.ready,
    approval: preview.contract.approval,
    lifecycleControls: preview.contract.lifecycleControls,
    boundary: preview.contract.boundary,
    requestState: preview.contract.requestState,
    providerOutbox: preview.contract.providerOutbox,
    auditPermissionHandoff: preview.contract.auditPermissionHandoff,
    statusEnvelope: preview.contract.statusEnvelope,
    recoveryExportSummary: preview.contract.recoveryExportSummary,
    commandReport: preview.contract.commandReport,
    decisionPacket: preview.contract.decisionPacket,
    operationalHealth: preview.contract.operationalHealth,
    analytics: preview.contract.analytics.exportSummary,
    packageReport: preview.contract.packageReport.exportSummary,
    runtimeHandoff: preview.contract.runtimeHandoff,
    nextSteps: preview.nextSteps,
  });
}

export function selfCheckApprovalRequiredJob(options = {}) {
  const preview = buildApprovalRequiredPreview({
    accepted: true,
    acceptedBy: "self-check",
    approvalTicket: "approval_self_check",
    ...options,
  });

  return deepFreeze({
    kind: "mailchimp.approval-required.self-check",
    apiVersion: "aios.example/v1",
    passed: preview.readiness.ready
      && preview.decisionPacket.validation.clientReady
      && preview.contract.requestState.request.intent === "approve-mailchimp-adapter-handoff"
      && preview.contract.providerOutbox.commands.submit.idempotent
      && preview.contract.providerOutbox.serviceContract.ready
      && preview.contract.providerOutbox.serviceContract.validation.externalWriteSafe
      && preview.contract.providerOutbox.delivery.payload.writePolicy.externalWritesAllowed === false
      && preview.contract.statusEnvelope.ready
      && preview.contract.statusEnvelope.adapter.externalWritesAllowed === false
      && preview.contract.auditPermissionHandoff.ready
      && preview.contract.auditPermissionHandoff.validation.tenantIsolated
      && preview.contract.statusEnvelope.replayGuard.idempotent
      && preview.contract.recoveryExportSummary.restart.restartSafe
      && preview.contract.recoveryExportSummary.validation.externalWriteSafe
      && preview.contract.commandReport.validation.exportSafe
      && preview.contract.commandReport.counters.commandRows >= 4
      && preview.decisionPacket.commands.review.idempotent,
    jobId: preview.jobId,
    blockedReasons: preview.readiness.blockedReasons,
  });
}

function buildApprovalCommandReport(
  program,
  audit,
  exportSnapshot,
  approval,
  lifecycleControls,
  boundary,
  decisionPacket,
  requestState,
  providerOutbox,
  auditPermissionHandoff,
  statusEnvelope,
  recoveryExportSummary,
  analytics,
  blockedReasons,
  ready,
  options,
) {
  const generatedAt = String(options.commandReportGeneratedAt ?? options.generatedAt ?? "logical:9");
  const previous = normalizeApprovalCommandReport(options.previousCommandReport);
  const commandRows = [
    {
      phase: "approval",
      command: decisionPacket.commands.accept.command,
      enabled: decisionPacket.commands.accept.enabled,
      idempotent: decisionPacket.commands.accept.idempotent,
      idempotencyKey: decisionPacket.commands.accept.idempotencyKey,
      status: approval.accepted ? "applied" : "pending",
      actor: approval.acceptedBy,
      blockedReasons: approval.blockedReasons,
    },
    {
      phase: "review",
      command: decisionPacket.commands.review.command,
      enabled: decisionPacket.commands.review.enabled,
      idempotent: decisionPacket.commands.review.idempotent,
      idempotencyKey: decisionPacket.commands.review.idempotencyKey,
      status: decisionPacket.validation.clientReady ? "ready" : "review",
      actor: approval.acceptedBy,
      blockedReasons: decisionPacket.validation.blockers,
    },
    {
      phase: "runtime",
      command: requestState.runtimeAdoption.handoffCommand,
      enabled: requestState.runtimeAdoption.canAdoptRuntime,
      idempotent: true,
      idempotencyKey: `${requestState.request.requestId}:command-report:runtime`,
      status: requestState.runtimeAdoption.canAdoptRuntime ? "ready" : "blocked",
      actor: approval.acceptedBy,
      blockedReasons: requestState.validation.blockers,
    },
    {
      phase: "provider-outbox",
      command: providerOutbox.commands.submit.command,
      enabled: providerOutbox.commands.submit.enabled,
      idempotent: providerOutbox.commands.submit.idempotent,
      idempotencyKey: providerOutbox.commands.submit.idempotencyKey,
      status: providerOutbox.status.status,
      actor: providerOutbox.delivery.payload.provider,
      blockedReasons: providerOutbox.validation.blockers,
    },
    {
      phase: "audit-permission",
      command: auditPermissionHandoff.nextAction,
      enabled: auditPermissionHandoff.ready,
      idempotent: true,
      idempotencyKey: `${auditPermissionHandoff.handoffKey}:command-report`,
      status: auditPermissionHandoff.status,
      actor: boundary.tenant,
      blockedReasons: auditPermissionHandoff.validation.blockedReasons,
    },
    {
      phase: "status-envelope",
      command: statusEnvelope.adapter.command,
      enabled: statusEnvelope.ready,
      idempotent: statusEnvelope.replayGuard.idempotent,
      idempotencyKey: statusEnvelope.replayGuard.replayKey,
      status: statusEnvelope.status,
      actor: statusEnvelope.adapter.provider,
      blockedReasons: statusEnvelope.validation.blockedReasons,
    },
    {
      phase: "recovery-export",
      command: recoveryExportSummary.restart.nextCommand,
      enabled: recoveryExportSummary.ready,
      idempotent: true,
      idempotencyKey: recoveryExportSummary.restart.replayKey,
      status: recoveryExportSummary.status,
      actor: "recovery",
      blockedReasons: recoveryExportSummary.validation.blockedReasons,
    },
  ];
  const exportRows = commandRows.map((row, index) => ({
    index,
    phase: row.phase,
    command: row.command,
    status: row.status,
    enabled: row.enabled,
    idempotent: row.idempotent,
    actor: row.actor,
    blockedCount: row.blockedReasons.length,
    idempotencyKey: row.idempotencyKey,
  }));
  const commandStatusCounts = countBy(exportRows, "status");
  const phaseCounts = countBy(exportRows, "phase");
  const history = [
    ...analytics.history,
    {
      at: generatedAt,
      jobId: program.job.id,
      tenant: boundary.tenant,
      workspace: boundary.workspace,
      status: ready ? "ready" : "blocked",
      approvalAccepted: approval.accepted,
      boundaryReady: boundary.ready,
      healthState: analytics.timelineReport.timeline.at(-1)?.healthState ?? "unknown",
      recoveryReady: recoveryExportSummary.validation.restartSafe,
      exportReady: ready,
      ready,
      evidencePresent: getAcceptedEvidence(audit).length,
      evidenceMissing: getMissingEvidence(audit).length,
      externalWrites: audit.boundary.externalWritesObserved.length,
      retryCount: recoveryExportSummary.counters.retryAttempt,
      blockedCount: blockedReasons.length,
      blockedReasons,
      commandRows: exportRows.length,
      enabledCommands: exportRows.filter((row) => row.enabled).length,
    },
  ].slice(-12);
  const fingerprint = deterministicFingerprint([
    program.job.id,
    exportSnapshot.exportId,
    requestState.request.requestId,
    providerOutbox.recordId,
    auditPermissionHandoff.handoffKey,
    statusEnvelope.envelopeId,
    recoveryExportSummary.exportId,
    exportRows.map((row) => `${row.phase}:${row.status}:${row.enabled}`).join(","),
  ]);
  const validationBlockers = uniqueSorted([
    ...blockedReasons,
    ...(statusEnvelope.ready ? [] : statusEnvelope.validation.blockedReasons),
    ...(recoveryExportSummary.ready ? [] : recoveryExportSummary.validation.blockedReasons),
    ...(auditPermissionHandoff.ready ? [] : auditPermissionHandoff.validation.blockedReasons),
    ...(exportRows.every((row) => row.idempotencyKey) ? [] : ["approval command report requires idempotency keys"]),
    ...(providerOutbox.delivery.payload.writePolicy.externalWritesAllowed === false
      ? []
      : ["approval command report forbids external provider writes"]),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["approval command report cannot export after external write observation"]),
  ]);
  const reportId = `approval-command-report:${fingerprint}`;
  const exportSafe = validationBlockers.length === 0
    && exportSnapshot.truthBoundary.readyForExport
    && lifecycleControls.commandAllowed;
  const nextAction = exportSafe
    ? statusEnvelope.adapter.command
    : !lifecycleControls.commandAllowed
      ? lifecycleControls.nextAction
      : exportRows.find((row) => row.status === "blocked" || row.status === "review")?.command
        ?? recoveryExportSummary.restart.nextCommand
        ?? "approval.report-review";

  return {
    kind: "mailchimp.approval-required.command-report",
    apiVersion: "aios.reporting/v1",
    reportId,
    jobId: program.job.id,
    generatedAt,
    checkpoint: exportSnapshot.exportId,
    ready: ready && exportSafe,
    status: ready && exportSafe ? "export_ready" : "operator_report_review",
    previous: previous
      ? {
        reportId: previous.reportId,
        status: previous.status,
        changedSincePrevious: previous.fingerprint !== fingerprint,
      }
      : null,
    tenant: {
      tenant: boundary.tenant,
      workspace: boundary.workspace,
      isolationKey: boundary.isolationKey,
      auditReceipt: boundary.auditHandoff.receipt,
    },
    counters: {
      commandRows: exportRows.length,
      enabledCommands: exportRows.filter((row) => row.enabled).length,
      blockedCommands: exportRows.filter((row) => row.status === "blocked").length,
      reviewCommands: exportRows.filter((row) => row.status === "review").length,
      idempotentCommands: exportRows.filter((row) => row.idempotent).length,
      evidencePresent: getAcceptedEvidence(audit).length,
      evidenceMissing: getMissingEvidence(audit).length,
      externalWrites: audit.boundary.externalWritesObserved.length,
      historySnapshots: history.length,
      commandStatusCounts,
      phaseCounts,
    },
    exportSummary: {
      exportId: exportSnapshot.exportId,
      format: exportSnapshot.format,
      headline: ready && exportSafe
        ? "approval command report is ready for export"
        : `approval command report requires review: ${validationBlockers[0] ?? "unknown blocker"}`,
      nextReportAction: nextAction,
      statusEnvelopeId: statusEnvelope.envelopeId,
      recoveryExportId: recoveryExportSummary.exportId,
    },
    timeline: [
      ...analytics.timelineReport.timeline.map((entry) => ({
        source: "approval-analytics",
        at: entry.at,
        event: entry.event,
        status: entry.status,
        blockedCount: entry.blockedCount,
      })),
      ...statusEnvelope.sequence.map((entry) => ({
        source: "status-envelope",
        at: entry.at,
        event: entry.event,
        status: entry.status,
        command: entry.command,
        blockedCount: entry.blockedReasons.length,
      })),
    ],
    history,
    commandRows: exportRows,
    nextAction,
    validation: {
      ready: validationBlockers.length === 0,
      exportSafe,
      lifecycleCommandAllowed: lifecycleControls.commandAllowed,
      externalWriteSafe: audit.boundary.externalWritesObserved.length === 0,
      statusEnvelopeReady: statusEnvelope.ready,
      recoveryExportReady: recoveryExportSummary.ready,
      auditPermissionReady: auditPermissionHandoff.ready,
      blockedReasons: validationBlockers,
    },
  };
}

function buildApprovalRecoveryExportSummary(
  program,
  audit,
  exportSnapshot,
  approval,
  lifecycleControls,
  boundary,
  decisionPacket,
  requestState,
  providerOutbox,
  auditPermissionHandoff,
  operationalHealth,
  recoveryStatus,
  statusEnvelope,
  blockedReasons,
  ready,
  options,
) {
  const generatedAt = String(options.recoveryExportGeneratedAt ?? options.generatedAt ?? "logical:8");
  const previous = normalizeApprovalRecoveryExport(options.previousRecoveryExportSummary);
  const evidencePresent = getAcceptedEvidence(audit).length;
  const evidenceMissing = getMissingEvidence(audit).length;
  const actionableErrors = uniqueSorted([
    ...operationalHealth.actionableErrors.map((error) => error.message),
    ...blockedReasons,
    ...statusEnvelope.validation.blockedReasons,
  ]);
  const commandQueue = [
    {
      phase: "approval",
      command: decisionPacket.commands.accept.command,
      enabled: decisionPacket.commands.accept.enabled,
      idempotencyKey: decisionPacket.commands.accept.idempotencyKey,
      status: approval.accepted ? "applied" : "pending",
    },
    {
      phase: "request",
      command: requestState.runtimeAdoption.handoffCommand,
      enabled: requestState.runtimeAdoption.canAdoptRuntime,
      idempotencyKey: `${requestState.request.requestId}:runtime-adoption`,
      status: requestState.runtimeAdoption.canAdoptRuntime ? "ready" : "blocked",
    },
    {
      phase: "provider-outbox",
      command: providerOutbox.commands.submit.command,
      enabled: providerOutbox.commands.submit.enabled,
      idempotencyKey: providerOutbox.commands.submit.idempotencyKey,
      status: providerOutbox.status.status,
    },
    {
      phase: "status-envelope",
      command: statusEnvelope.adapter.command,
      enabled: statusEnvelope.ready,
      idempotencyKey: statusEnvelope.replayGuard.replayKey,
      status: statusEnvelope.status,
    },
  ];
  const replayableCommands = commandQueue.filter((command) => (
    command.enabled && command.idempotencyKey && command.status !== "applied"
  ));
  const restartSafe = Boolean(recoveryStatus.restartToken)
    && statusEnvelope.replayGuard.stableAcrossRestart
    && providerOutbox.status.stableAcrossRestart
    && requestState.validation.clientCanHandoff;
  const fingerprint = deterministicFingerprint([
    program.job.id,
    exportSnapshot.exportId,
    requestState.request.requestId,
    statusEnvelope.envelopeId,
    providerOutbox.recordId,
    auditPermissionHandoff.handoffKey,
    recoveryStatus.restartToken,
    commandQueue.map((command) => `${command.phase}:${command.status}:${command.enabled}`).join(","),
  ]);
  const exportId = `approval-recovery-export:${fingerprint}`;
  const validationBlockers = uniqueSorted([
    ...blockedReasons,
    ...(statusEnvelope.ready ? [] : statusEnvelope.validation.blockedReasons),
    ...(recoveryStatus.restartToken ? [] : ["approval recovery export requires restart token"]),
    ...(restartSafe ? [] : ["approval recovery export is not restart-safe"]),
    ...(auditPermissionHandoff.validation.ready ? [] : auditPermissionHandoff.validation.blockedReasons),
    ...(providerOutbox.delivery.payload.writePolicy.externalWritesAllowed === false
      ? []
      : ["approval recovery export forbids external provider writes"]),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["approval recovery export cannot advance after external write observation"]),
  ]);
  const exportReady = ready && validationBlockers.length === 0;

  return {
    kind: "mailchimp.approval-required.recovery-export-summary",
    apiVersion: "aios.integration/v1",
    exportId,
    jobId: program.job.id,
    generatedAt,
    ready: exportReady,
    status: exportReady
      ? "restart_export_ready"
      : operationalHealth.retryable ? "retryable_review" : "blocked_review",
    checkpoint: exportSnapshot.exportId,
    previous: previous
      ? {
        exportId: previous.exportId,
        status: previous.status,
        changedSincePrevious: previous.fingerprint !== fingerprint,
      }
      : null,
    restart: {
      restartSafe,
      token: exportReady ? recoveryStatus.restartToken : null,
      nextCommand: exportReady
        ? statusEnvelope.adapter.command
        : operationalHealth.retryPlan.nextCommand
          ?? lifecycleControls.nextAction
          ?? decisionPacket.nextAction.command,
      replayKey: `${program.job.memory.namespace}:approval:recovery-export:${exportId}`,
      replayableCommands: replayableCommands.length,
    },
    counters: {
      evidencePresent,
      evidenceMissing,
      externalWrites: audit.boundary.externalWritesObserved.length,
      actionableErrors: actionableErrors.length,
      commandCount: commandQueue.length,
      enabledCommands: commandQueue.filter((command) => command.enabled).length,
      blockedCommands: commandQueue.filter((command) => command.status === "blocked").length,
      retryAttempt: operationalHealth.retryPlan.retryCount,
    },
    tenant: {
      tenant: boundary.tenant,
      workspace: boundary.workspace,
      isolationKey: boundary.isolationKey,
      auditReceipt: boundary.auditHandoff.receipt,
    },
    adapter: {
      provider: statusEnvelope.adapter.provider,
      resource: statusEnvelope.adapter.resource,
      status: statusEnvelope.adapter.status,
      command: statusEnvelope.adapter.command,
      outboxRecordId: statusEnvelope.adapter.outboxRecordId,
      ackStatus: statusEnvelope.adapter.ackStatus,
      externalWritesAllowed: statusEnvelope.adapter.externalWritesAllowed,
    },
    timeline: statusEnvelope.sequence.map((entry) => ({
      index: entry.index,
      at: entry.at,
      event: entry.event,
      status: entry.status,
      command: entry.command,
      blockedCount: entry.blockedReasons.length,
    })),
    commandQueue,
    validation: {
      ready: validationBlockers.length === 0,
      restartSafe,
      externalWriteSafe: statusEnvelope.validation.externalWriteSafe,
      requestMatchesOutbox: statusEnvelope.validation.providerPayloadMatchesRequest,
      blockedReasons: validationBlockers,
    },
  };
}

function buildApprovalStatusHandoffEnvelope(
  program,
  audit,
  exportSnapshot,
  providerContract,
  approval,
  lifecycleControls,
  boundary,
  decisionPacket,
  requestState,
  providerOutbox,
  auditPermissionHandoff,
  operationalHealth,
  recoveryStatus,
  blockedReasons,
  ready,
  options,
) {
  const generatedAt = String(options.envelopeGeneratedAt ?? options.generatedAt ?? "logical:7");
  const revision = normalizeIntegerInRange(options.envelopeRevision ?? 1, "envelopeRevision", 1, 1000000);
  const previous = normalizeApprovalStatusEnvelope(options.previousStatusEnvelope);
  const status = ready
    ? providerOutbox.status.acknowledged ? "adapter_acknowledged" : "ready_for_adapter"
    : approval.accepted
      ? "operator_accepted_review_required"
      : "operator_approval_required";
  const sequence = [
    {
      index: 0,
      at: "logical:0",
      event: "approval.context.loaded",
      status: approval.ticket ? "ready" : "blocked",
      command: "approval.review",
      receipt: approval.ticket,
      blockedReasons: approval.blockedReasons,
    },
    {
      index: 1,
      at: "logical:1",
      event: "approval.boundary.checked",
      status: boundary.ready ? "ready" : "blocked",
      command: "approval.boundary.review",
      receipt: boundary.auditHandoff.receipt,
      blockedReasons: boundary.blockedReasons,
    },
    {
      index: 2,
      at: "logical:2",
      event: "approval.recovery.bound",
      status: recoveryStatus.ready ? "ready" : "blocked",
      command: recoveryStatus.ready ? "approval.handoff.resume" : "approval.recovery-review",
      receipt: recoveryStatus.restartToken,
      blockedReasons: recoveryStatus.blockedReasons,
    },
    {
      index: 3,
      at: generatedAt,
      event: "approval.adapter.status",
      status,
      command: ready ? "approval.handoff" : decisionPacket.nextAction.command,
      receipt: providerOutbox.validation.canFlushProvider
        ? providerOutbox.recordId
        : decisionPacket.acceptance.decisionReceipt,
      blockedReasons,
    },
  ];
  const idempotencyMaterial = [
    program.job.id,
    exportSnapshot.exportId,
    approval.ticket,
    decisionPacket.acceptance.decisionKey,
    requestState.request.requestId,
    providerOutbox.recordId,
    auditPermissionHandoff.handoffKey,
    recoveryStatus.restartToken,
    status,
    revision,
  ];
  const envelopeId = `approval-status:${deterministicFingerprint(idempotencyMaterial)}`;
  const replayGuard = {
    idempotent: true,
    stableAcrossRestart: providerOutbox.status.stableAcrossRestart && Boolean(recoveryStatus.restartToken),
    replayKey: `${program.job.memory.namespace}:approval:status-envelope:${envelopeId}`,
    priorEnvelopeId: previous?.envelopeId ?? null,
    changedSincePrevious: previous ? previous.fingerprint !== deterministicFingerprint(idempotencyMaterial) : true,
    canReplay: ready
      && providerOutbox.validation.ready
      && requestState.validation.clientCanHandoff
      && providerOutbox.status.stableAcrossRestart,
  };
  const validationBlockers = uniqueSorted([
    ...blockedReasons,
    ...(envelopeId ? [] : ["approval status envelope requires id"]),
    ...(requestState.request.restartToken ? [] : ["approval status envelope requires restart token"]),
    ...(requestState.request.exportId === exportSnapshot.exportId ? [] : ["approval status envelope export mismatch"]),
    ...(providerOutbox.delivery.payload.exportId === exportSnapshot.exportId ? [] : ["approval provider payload export mismatch"]),
    ...(providerOutbox.delivery.payload.requestId === requestState.request.requestId ? [] : ["approval provider payload request mismatch"]),
    ...(auditPermissionHandoff.validation.ready ? [] : auditPermissionHandoff.validation.blockedReasons),
    ...(providerOutbox.delivery.payload.writePolicy.externalWritesAllowed === false
      ? []
      : ["approval status envelope forbids external provider writes"]),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["approval status envelope cannot advance after external write observation"]),
    ...(replayGuard.stableAcrossRestart ? [] : ["approval status envelope is not stable across restart"]),
  ]);
  const adapterCommand = ready
    ? providerOutbox.commands.submit.command
    : operationalHealth.retryPlan.nextCommand
      ?? lifecycleControls.nextAction
      ?? "approval.review";

  return {
    kind: "mailchimp.approval-required.status-envelope",
    apiVersion: "aios.integration/v1",
    envelopeId,
    revision,
    generatedAt,
    ready: ready && validationBlockers.length === 0,
    status: validationBlockers.length === 0 ? status : "status_envelope_blocked",
    jobId: program.job.id,
    checkpoint: exportSnapshot.exportId,
    adapter: {
      provider: providerContract.provider?.name ?? "mailchimp",
      resource: providerContract.provider?.resource ?? "campaign-approval-preview",
      status: ready ? "ready_to_flush" : providerOutbox.status.status,
      command: adapterCommand,
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
      externalWritesAllowed: false,
      outboxKey: providerOutbox.outboxKey,
      outboxRecordId: providerOutbox.recordId,
      ackStatus: providerOutbox.status.ackStatus,
      serviceContractId: providerOutbox.serviceContract.contractId,
      serviceContractStatus: providerOutbox.serviceContract.status,
      serviceContractNextAction: providerOutbox.serviceContract.nextAction.command,
    },
    recovery: {
      ready: recoveryStatus.ready,
      restartToken: recoveryStatus.restartToken,
      command: recoveryStatus.ready ? "approval.handoff.resume" : "approval.recovery-review",
      blockedReasons: recoveryStatus.blockedReasons,
    },
    clientState: {
      requestId: requestState.request.requestId,
      phase: requestState.visibleState.phase,
      primaryAction: ready ? adapterCommand : requestState.visibleState.primaryAction,
      persistedStatus: requestState.persistedRuntimeState.status,
      decisionReceipt: requestState.persistedRuntimeState.decisionReceipt,
      evidenceSubjects: requestState.request.commands.map((command) => command.command),
      auditPermissionHandoffKey: auditPermissionHandoff.handoffKey,
    },
    sequence,
    replayGuard,
    validation: {
      ready: validationBlockers.length === 0,
      blockedReasons: validationBlockers,
      externalWriteSafe: providerOutbox.delivery.payload.writePolicy.externalWritesAllowed === false
        && audit.boundary.externalWritesObserved.length === 0,
      restartSafe: replayGuard.stableAcrossRestart,
      providerPayloadMatchesRequest: providerOutbox.delivery.payload.requestId === requestState.request.requestId,
      providerServiceContractReady: providerOutbox.serviceContract.ready,
      sequenceComplete: sequence.every((entry) => entry.status === "ready" || entry.blockedReasons.length > 0),
    },
  };
}

function buildApprovalRequestState(
  program,
  audit,
  exportSnapshot,
  approval,
  lifecycleControls,
  boundary,
  decisionPacket,
  operationalHealth,
  recoveryStatus,
  options,
) {
  const requestId = options.requestId
    ?? `${program.job.id}:approval-request:${decisionPacket.preview.previewToken}`;
  const acceptedEvidence = new Set(getAcceptedEvidence(audit).map((entry) => entry.subject));
  const requiredEvidence = program.job.verifier.requiredEvidence.map((subject, index) => ({
    id: `${requestId}:evidence:${index + 1}`,
    subject,
    present: acceptedEvidence.has(subject),
    clientVisible: true,
    action: acceptedEvidence.has(subject) ? null : "approval.collect-evidence",
  }));
  const accepted = decisionPacket.acceptance.accepted;
  const phase = accepted
    ? "ready_to_handoff"
    : approval.accepted
      ? "waiting_for_runtime_validation"
      : lifecycleControls.reminderDue
        ? "approval_reminder_due"
        : "needs_operator_approval";
  const commandList = [
    decisionPacket.commands.accept,
    decisionPacket.commands.review,
    decisionPacket.commands.handoff,
    {
      idempotent: true,
      idempotencyKey: `${requestId}:reminder:${approval.ticket ?? "pending"}`,
      command: "approval.send-reminder",
      enabled: lifecycleControls.reminderDue && !approval.accepted,
    },
    {
      idempotent: true,
      idempotencyKey: `${requestId}:reschedule:${lifecycleControls.schedule.mode}`,
      command: "approval.reschedule",
      enabled: lifecycleControls.schedule.mode !== "manual" || !lifecycleControls.ready,
    },
  ];
  const validationBlockers = uniqueSorted([
    ...(requestId ? [] : ["approval request state requires request id"]),
    ...(decisionPacket.preview.previewToken ? [] : ["approval request state requires preview token"]),
    ...(recoveryStatus.restartToken ? [] : ["approval request state requires restart token"]),
    ...(boundary.ready ? [] : ["approval request state requires tenant boundary readiness"]),
    ...(operationalHealth.ready || operationalHealth.degradedMode
      ? []
      : ["approval request state requires healthy or degraded-review operational state"]),
    ...(requiredEvidence.every((entry) => entry.present)
      ? []
      : ["approval request state requires all evidence rows to be present"]),
  ]);
  const canAdoptRuntime = accepted
    && validationBlockers.length === 0
    && lifecycleControls.commandAllowed
    && recoveryStatus.ready;
  const stateVersion = Number.isInteger(options.requestStateVersion)
    ? options.requestStateVersion
    : 1;
  const stateKey = options.requestStateKey
    ?? `${program.job.memory.namespace}:approval:request-state:${requestId}:v${stateVersion}`;

  return {
    kind: "mailchimp.approval-required.request-state",
    apiVersion: "aios.client/v1",
    request: {
      requestId,
      intent: "approve-mailchimp-adapter-handoff",
      campaignId: decisionPacket.preview.campaignId,
      previewToken: decisionPacket.preview.previewToken,
      restartToken: recoveryStatus.restartToken,
      exportId: exportSnapshot.exportId,
      commands: commandList.map((command) => ({
        command: command.command,
        enabled: command.enabled,
        idempotent: command.idempotent,
        idempotencyKey: command.idempotencyKey,
      })),
    },
    visibleState: {
      title: decisionPacket.preview.title,
      phase,
      summary: decisionPacket.preview.summary,
      primaryAction: canAdoptRuntime ? "approval.handoff" : decisionPacket.nextAction.command,
      secondaryAction: lifecycleControls.reminderDue ? "approval.send-reminder" : "approval.review",
      blockedCount: validationBlockers.length + decisionPacket.validation.blockedCount,
      validationCards: decisionPacket.preview.validationCards,
      evidenceRows: requiredEvidence,
    },
    persistedRuntimeState: {
      stateKey,
      version: stateVersion,
      status: canAdoptRuntime ? "ready_for_adapter_handoff" : "operator_review_required",
      tenant: boundary.tenant,
      workspace: boundary.workspace,
      isolationKey: boundary.isolationKey,
      approvalTicket: approval.ticket,
      decisionReceipt: decisionPacket.acceptance.decisionReceipt,
      acceptedAt: decisionPacket.acceptance.acceptedAt,
      acceptedBy: decisionPacket.acceptance.acceptedBy,
      writePolicy: {
        externalWritesAllowed: false,
        provider: "mailchimp",
        fallback: "approval-status-only",
      },
    },
    runtimeAdoption: {
      canAdoptRuntime,
      statusEvent: canAdoptRuntime ? "approval-ready-for-handoff" : operationalHealth.visibleState,
      handoffCommand: canAdoptRuntime ? "approval.handoff" : lifecycleControls.nextAction,
      handoffPayload: {
        requestId,
        decisionKey: decisionPacket.acceptance.decisionKey,
        restartToken: recoveryStatus.restartToken,
        auditReceipt: boundary.auditHandoff.receipt,
        evidenceSubjects: requiredEvidence.map((entry) => entry.subject),
      },
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      evidenceComplete: requiredEvidence.every((entry) => entry.present),
      clientCanHandoff: canAdoptRuntime,
    },
  };
}

function normalizeApproval(options) {
  const ticket = options.approvalTicket ? String(options.approvalTicket).trim() : "";
  const accepted = Boolean(options.accepted ?? false) && ticket.length > 0;
  return {
    required: true,
    accepted,
    ticket: ticket || null,
    acceptedBy: accepted ? String(options.acceptedBy ?? "operator") : null,
    acceptedAt: accepted ? String(options.acceptedAt ?? "logical:approval") : null,
    blockedReasons: accepted ? [] : ["operator approval ticket required before adapter handoff"],
  };
}

function buildApprovalLifecycleControls(program, approval, options) {
  const enabled = Boolean(options.enabled ?? program.lifecycle.enabled);
  const requestedCommand = String(options.command ?? (
    enabled
      ? approval.accepted
        ? "approval.handoff"
        : "approval.review"
      : "approval.enable"
  )).trim();
  const schedule = normalizeApprovalSchedule(options.schedule ?? program.lifecycle.schedule);
  const approvalExpiresInSeconds = normalizeIntegerInRange(
    options.approvalExpiresInSeconds ?? 900,
    "approvalExpiresInSeconds",
    60,
    86400,
  );
  const reminderAfterSeconds = normalizeIntegerInRange(
    options.reminderAfterSeconds ?? 300,
    "reminderAfterSeconds",
    30,
    approvalExpiresInSeconds,
  );
  const allowedCommands = enabled
    ? [
      "approval.disable",
      "approval.handoff",
      "approval.review",
      "approval.reschedule",
      "approval.retry",
      "approval.send-reminder",
    ]
    : ["approval.enable", "approval.review"];
  const commandAllowed = allowedCommands.includes(requestedCommand);
  const approvalExpired = Boolean(options.approvalAcceptedAt)
    && Boolean(options.now)
    && String(options.approvalAcceptedAt) !== String(options.now)
    && !options.ignoreApprovalExpiry;
  const reminderDue = !approval.accepted
    && Boolean(options.lastReminderAt)
    && Boolean(options.now)
    && String(options.lastReminderAt) !== String(options.now);
  const blockedReasons = uniqueSorted([
    ...(enabled ? [] : ["approval workflow is disabled"]),
    ...(schedule.valid ? [] : schedule.errors),
    ...(commandAllowed ? [] : [`approval command not allowed in current lifecycle: ${requestedCommand}`]),
    ...(requestedCommand === "approval.handoff" && !approval.accepted
      ? ["approval handoff command requires accepted approval ticket"]
      : []),
    ...(approvalExpired ? [`approval ticket expired after ${approvalExpiresInSeconds}s`] : []),
  ]);
  const nextAction = blockedReasons.length === 0
    ? requestedCommand
    : !enabled
      ? "approval.enable"
      : !schedule.valid
        ? "approval.reschedule"
        : approvalExpired
          ? "approval.review"
          : reminderDue
            ? "approval.send-reminder"
            : "approval.review";

  return {
    ready: blockedReasons.length === 0,
    enabled,
    requestedCommand,
    allowedCommands,
    commandAllowed,
    schedule: schedule.value,
    approvalExpiresInSeconds,
    reminderAfterSeconds,
    reminderDue,
    approvalExpired,
    settings: {
      dryRun: Boolean(program.lifecycle.dryRun),
      requireApproval: true,
      manualOnly: schedule.value.mode === "manual",
      clientVisibleControls: uniqueSorted(options.clientVisibleControls ?? [
        "accept",
        "reject",
        "send-reminder",
        "reschedule",
      ]),
    },
    nextAction,
    blockedReasons,
  };
}

function buildApprovalOperationalHealth(program, audit, recoveryStatus, options) {
  const state = normalizeApprovalHealthState(options.healthState ?? options.adapterHealth ?? "healthy");
  const retryCount = normalizeIntegerInRange(options.retryCount ?? 0, "retryCount", 0, 20);
  const maxRetries = normalizeIntegerInRange(options.maxRetries ?? 1, "maxRetries", 0, 20);
  const retryAfterSeconds = normalizeIntegerInRange(
    options.retryAfterSeconds ?? options.adapterRetryAfterSeconds ?? 45,
    "retryAfterSeconds",
    1,
    3600,
  );
  const pendingFailure = options.failureCode ? String(options.failureCode).trim() : "";
  const degradedMode = state === "degraded";
  const terminal = state === "failed" || state === "offline";
  const retryable = !terminal && state !== "healthy" && retryCount < maxRetries;
  const missingEvidence = audit.evidence.missing.map((subject) => `approval evidence missing: ${subject}`);
  const boundaryWrites = audit.boundary.externalWritesObserved.map((write) => (
    `approval external write observed: ${write.subject ?? write}`
  ));
  const failureReasons = uniqueSorted([
    ...missingEvidence,
    ...boundaryWrites,
    ...(pendingFailure ? [`approval provider failure: ${pendingFailure}`] : []),
    ...recoveryStatus.blockedReasons.map((reason) => `recovery handoff blocked: ${reason}`),
  ]);
  const blockedReasons = uniqueSorted([
    ...(state === "healthy" || degradedMode ? [] : [`approval operational health is ${state}`]),
    ...(terminal ? ["approval handoff is in a terminal failure state"] : []),
    ...(retryCount <= maxRetries ? [] : [`approval retry count ${retryCount} exceeds max ${maxRetries}`]),
    ...(failureReasons.length === 0 || degradedMode ? [] : failureReasons),
  ]);
  const retryDelaySeconds = retryable
    ? retryAfterSeconds * Math.max(1, retryCount + 1)
    : null;

  return {
    ready: blockedReasons.length === 0,
    state,
    degradedMode,
    visibleState: state === "healthy" ? "verifying" : state,
    retryable,
    retryPlan: {
      retryCount,
      maxRetries,
      retryAfterSeconds: retryDelaySeconds,
      nextCommand: retryable
        ? "approval.retry"
        : degradedMode
          ? "approval.degraded-review"
          : terminal
            ? "approval.failure-review"
            : null,
      backoffPolicy: retryable ? `linear:${retryDelaySeconds}s` : "none",
    },
    failure: {
      failed: terminal,
      code: pendingFailure || null,
      reasons: failureReasons,
    },
    actionableErrors: failureReasons.map((reason) => ({
      code: reason.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, ""),
      message: reason,
      action: reason.includes("evidence")
        ? "approval.collect-evidence"
        : reason.includes("external write")
          ? "approval.audit-boundary"
          : reason.includes("recovery")
            ? "approval.recovery-review"
            : "approval.provider-review",
    })),
    blockedReasons,
  };
}

function buildTenantPermissionBoundary(program, audit, approval, options) {
  const tenant = normalizeIdentifier(options.tenantId ?? options.tenant ?? "tenant:mailchimp-default", "tenant");
  const workspace = normalizeIdentifier(options.workspaceId ?? options.workspace ?? "workspace:campaign-local", "workspace");
  const allowedTenants = normalizeAllowList(options.allowedTenants, tenant);
  const allowedWorkspaces = normalizeAllowList(options.allowedWorkspaces, workspace);
  const requiredRoles = uniqueSorted(options.requiredRoles ?? ["mailchimp.operator", "approval.reviewer"]);
  const operatorRoles = uniqueSorted(options.operatorRoles ?? (approval.accepted ? requiredRoles : []));
  const roleSet = new Set(operatorRoles);
  const missingRoles = requiredRoles.filter((role) => !roleSet.has(role));
  const scopeClaims = uniqueSorted([
    ...program.job.capabilities.map((capability) => `capability:${capability}`),
    ...normalizeMemoryScopeClaims(program.job.memory),
    `job:${program.job.id}`,
  ]);
  const auditSubjects = new Set([
    ...getAcceptedEvidence(audit).map((entry) => entry.subject),
    ...getMissingEvidence(audit),
  ]);
  const boundaryViolations = uniqueSorted([
    ...(allowedTenants.includes(tenant) ? [] : [`tenant ${tenant} is outside approval allow-list`]),
    ...(allowedWorkspaces.includes(workspace) ? [] : [`workspace ${workspace} is outside approval allow-list`]),
    ...missingRoles.map((role) => `operator role missing for approval boundary: ${role}`),
    ...([...auditSubjects].some((subject) => subject === "verify.boundary" || subject === "verify.boundary=no-external-write")
      ? []
      : ["approval audit boundary evidence missing"]),
  ]);
  const ready = boundaryViolations.length === 0;

  return {
    ready,
    tenant,
    workspace,
    allowedTenants,
    allowedWorkspaces,
    requiredRoles,
    operatorRoles,
    missingRoles,
    scopeClaims,
    isolationKey: `${tenant}::${workspace}::${program.job.id}`,
    auditHandoff: {
      ready,
      status: ready ? "tenant-boundary-cleared" : "tenant-boundary-review",
      receipt: ready ? `audit:${tenant}:${workspace}:${audit.id}` : null,
      subjects: [...auditSubjects].sort(),
    },
    blockedReasons: boundaryViolations,
  };
}

function buildApprovalDecisionPacket(
  program,
  audit,
  exportSnapshot,
  approval,
  lifecycleControls,
  boundary,
  operationalHealth,
  recoveryStatus,
  options,
) {
  const previewToken = options.previewToken
    ?? `${program.job.id}:approval-preview:${exportSnapshot.exportId}`;
  const operator = approval.acceptedBy ?? String(options.operator ?? "local-operator");
  const evidenceRows = program.job.verifier.requiredEvidence.map((subject, index) => {
    const present = getAcceptedEvidence(audit).some((entry) => entry.subject === subject);
    return {
      id: `approval-evidence:${index + 1}`,
      subject,
      status: present ? "present" : "missing",
      label: subject.includes("verify.source")
        ? "Mailchimp source receipt"
        : subject.includes("verify.boundary")
          ? "No-write boundary receipt"
          : "Operator-visible evidence",
      action: present ? null : "approval.collect-evidence",
    };
  });
  const validationCards = [
    {
      key: "approval",
      label: "Operator approval",
      status: approval.accepted ? "ready" : "blocked",
      detail: approval.accepted
        ? `Accepted by ${approval.acceptedBy}`
        : "Approval ticket is required before adapter handoff",
    },
    {
      key: "boundary",
      label: "Tenant boundary",
      status: boundary.ready ? "ready" : "blocked",
      detail: boundary.ready
        ? `${boundary.tenant} and ${boundary.workspace} are isolated`
        : boundary.blockedReasons[0] ?? "Tenant boundary requires review",
    },
    {
      key: "health",
      label: "Operational health",
      status: operationalHealth.ready
        ? "ready"
        : operationalHealth.degradedMode
          ? "review"
          : "blocked",
      detail: operationalHealth.ready
        ? "Approval health is ready"
        : operationalHealth.failure.reasons[0] ?? `Approval health is ${operationalHealth.state}`,
    },
    {
      key: "recovery",
      label: "Recovery handoff",
      status: recoveryStatus.ready ? "ready" : "blocked",
      detail: recoveryStatus.ready
        ? `Restart token ${recoveryStatus.restartToken}`
        : recoveryStatus.blockedReasons[0] ?? "Recovery handoff is not ready",
    },
  ];
  const validationBlockers = uniqueSorted([
    ...approval.blockedReasons,
    ...boundary.blockedReasons,
    ...operationalHealth.blockedReasons,
    ...recoveryStatus.blockedReasons.map((reason) => `approval recovery blocked: ${reason}`),
    ...evidenceRows
      .filter((row) => row.status === "missing")
      .map((row) => `approval preview evidence missing: ${row.subject}`),
    ...(lifecycleControls.ready ? [] : lifecycleControls.blockedReasons),
  ]);
  const accepted = approval.accepted && validationBlockers.length === 0;
  const decisionKey = `${previewToken}:${operator}:${approval.ticket ?? "pending"}`;
  const primaryCommand = accepted ? "approval.handoff" : lifecycleControls.nextAction;
  const nextAction = accepted
    ? {
      command: "approval.handoff",
      label: "Hand off approved job",
      reason: "approval ticket, evidence, tenant boundary, and recovery state are ready",
    }
    : {
      command: primaryCommand,
      label: primaryCommand === "approval.send-reminder"
        ? "Send approval reminder"
        : primaryCommand === "approval.retry"
          ? "Retry approval handoff"
          : "Review approval package",
      reason: validationBlockers[0] ?? "approval package requires review",
    };

  return {
    kind: "mailchimp.approval-required.decision-packet",
    apiVersion: "aios.client/v1",
    preview: {
      previewToken,
      title: "Mailchimp approval gate",
      summary: accepted
        ? "Approval package is accepted and ready for adapter handoff."
        : "Approval package requires operator review before adapter handoff.",
      campaignId: String(options.campaignId ?? "campaign:approval-required"),
      evidenceRows,
      validationCards,
    },
    acceptance: {
      required: true,
      accepted,
      acceptedBy: accepted ? approval.acceptedBy : null,
      acceptedAt: accepted ? approval.acceptedAt : null,
      ticket: approval.ticket,
      decisionKey,
      decisionReceipt: accepted
        ? `approval-decision:${program.job.id}:${approval.ticket}:${operator}`
        : null,
    },
    validation: {
      ready: accepted,
      clientReady: validationBlockers.length === 0,
      evidenceComplete: evidenceRows.every((row) => row.status === "present"),
      validationCardCount: validationCards.length,
      missingEvidenceCount: evidenceRows.filter((row) => row.status === "missing").length,
      blockedCount: validationBlockers.length,
      blockers: validationBlockers,
      summary: {
        approvalReady: approval.accepted,
        lifecycleReady: lifecycleControls.ready,
        boundaryReady: boundary.ready,
        healthReady: operationalHealth.ready,
        recoveryReady: recoveryStatus.ready,
      },
    },
    commands: {
      accept: {
        idempotent: true,
        idempotencyKey: `${decisionKey}:accept`,
        command: "approval.accept",
        enabled: !approval.accepted && evidenceRows.every((row) => row.status === "present"),
      },
      review: {
        idempotent: true,
        idempotencyKey: `${decisionKey}:review`,
        command: "approval.review",
        enabled: true,
      },
      handoff: {
        idempotent: true,
        idempotencyKey: `${decisionKey}:handoff:${recoveryStatus.restartToken}`,
        command: accepted ? "approval.handoff" : "approval.review",
        enabled: accepted,
      },
    },
    nextAction,
  };
}

function buildApprovalProviderOutbox(
  program,
  audit,
  exportSnapshot,
  providerContract,
  approval,
  boundary,
  decisionPacket,
  requestState,
  recoveryStatus,
  options,
) {
  const priorState = options.priorProviderOutboxState ?? {};
  const version = Number.isInteger(priorState.version) ? priorState.version + 1 : 1;
  const outboxKey = options.providerOutboxKey
    ?? `${program.job.memory.namespace}:approval:provider-outbox:${requestState.request.requestId}`;
  const ackStatus = normalizeProviderAckStatus(options.providerAckStatus ?? priorState.ackStatus ?? "pending");
  const deliveryAttempt = normalizeIntegerInRange(
    options.providerDeliveryAttempt ?? priorState.deliveryAttempt ?? 0,
    "providerDeliveryAttempt",
    0,
    20,
  );
  const maxDeliveryAttempts = normalizeIntegerInRange(
    options.providerMaxDeliveryAttempts ?? 3,
    "providerMaxDeliveryAttempts",
    1,
    20,
  );
  const deliveryKey = `${outboxKey}:v${version}:${decisionPacket.acceptance.decisionKey}`;
  const payload = {
    provider: providerContract.provider?.name ?? "mailchimp",
    providerResource: providerContract.provider?.resource ?? "campaign-approval-preview",
    jobId: program.job.id,
    exportId: exportSnapshot.exportId,
    requestId: requestState.request.requestId,
    approvalTicket: approval.ticket,
    decisionReceipt: requestState.persistedRuntimeState.decisionReceipt,
    auditReceipt: boundary.auditHandoff.receipt,
    restartToken: recoveryStatus.restartToken,
    handoffToken: providerContract.handoffState.handoffToken,
    writePolicy: requestState.persistedRuntimeState.writePolicy,
  };
  const serviceContract = buildApprovalProviderServiceContract(
    program,
    exportSnapshot,
    providerContract,
    payload,
    boundary,
    recoveryStatus,
    {
      ackStatus,
      deliveryAttempt,
      maxDeliveryAttempts,
      channel: options.providerChannel,
      requiredCapabilities: options.requiredProviderCapabilities,
      heartbeatSeconds: options.providerHeartbeatSeconds,
      maxAckSeconds: options.providerMaxAckSeconds,
      adapterTarget: options.adapterTarget,
    },
  );
  const payloadFingerprint = deterministicFingerprint([
    payload.provider,
    payload.providerResource,
    payload.jobId,
    payload.exportId,
    payload.requestId,
    payload.approvalTicket,
    payload.decisionReceipt,
    payload.auditReceipt,
    payload.restartToken,
    payload.handoffToken,
    payload.writePolicy.externalWritesAllowed,
    serviceContract.contractId,
    serviceContract.status,
  ]);
  const duplicateOf = priorState.payloadFingerprint === payloadFingerprint
    ? priorState.recordId ?? null
    : null;
  const retryable = ackStatus === "failed" && deliveryAttempt < maxDeliveryAttempts;
  const acknowledged = ackStatus === "acknowledged";
  const submitEnabled = decisionPacket.acceptance.accepted
    && requestState.validation.clientCanHandoff
    && !acknowledged;
  const validationBlockers = uniqueSorted([
    ...(outboxKey.startsWith(`${program.job.memory.namespace}:approval:provider-outbox:`)
      ? []
      : ["approval provider outbox key must stay inside approval memory namespace"]),
    ...(decisionPacket.acceptance.accepted ? [] : ["approval provider outbox requires accepted decision packet"]),
    ...(requestState.validation.clientCanHandoff ? [] : ["approval provider outbox requires client handoff readiness"]),
    ...(providerContract.handoffState.handoffToken ? [] : ["approval provider outbox requires provider handoff token"]),
    ...(recoveryStatus.restartToken ? [] : ["approval provider outbox requires restart token"]),
    ...(boundary.auditHandoff.receipt ? [] : ["approval provider outbox requires tenant audit receipt"]),
    ...(requestState.persistedRuntimeState.writePolicy.externalWritesAllowed === false
      ? []
      : ["approval provider outbox cannot allow external writes"]),
    ...(serviceContract.validation.ready ? [] : serviceContract.validation.blockedReasons),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["approval provider outbox cannot flush after observed external writes"]),
    ...(ackStatus === "rejected" ? ["approval provider outbox was rejected by adapter"] : []),
    ...(deliveryAttempt <= maxDeliveryAttempts
      ? []
      : [`approval provider outbox delivery attempt ${deliveryAttempt} exceeds max ${maxDeliveryAttempts}`]),
  ]);
  const status = acknowledged
    ? "acknowledged"
    : validationBlockers.length === 0
      ? "ready_to_flush"
      : retryable
        ? "retryable"
        : "blocked";

  return {
    kind: "mailchimp.approval-required.provider-outbox",
    apiVersion: "aios.integration/v1",
    outboxKey,
    version,
    recordId: `${deliveryKey}:${payloadFingerprint}`,
    duplicateOf,
    delivery: {
      attempt: deliveryAttempt,
      maxAttempts: maxDeliveryAttempts,
      payloadFingerprint,
      payload,
      serviceContractId: serviceContract.contractId,
      queuedAt: String(options.providerQueuedAt ?? "logical:7"),
      ackedAt: acknowledged ? String(options.providerAckedAt ?? "logical:adapter-ack") : null,
    },
    status: {
      status,
      ackStatus,
      acknowledged,
      retryable,
      serviceContractReady: serviceContract.ready,
      stableAcrossRestart: duplicateOf !== null
        || priorState.payloadFingerprint === undefined
        || priorState.payloadFingerprint === payloadFingerprint,
    },
    commands: {
      submit: {
        idempotent: true,
        idempotencyKey: `${deliveryKey}:submit:${payloadFingerprint}`,
        command: submitEnabled ? "approval.provider-outbox.submit" : "approval.provider-outbox.review",
        enabled: submitEnabled,
      },
      retry: {
        idempotent: true,
        idempotencyKey: `${deliveryKey}:retry:${deliveryAttempt + 1}`,
        command: retryable ? "approval.provider-outbox.retry" : "approval.provider-outbox.review",
        enabled: retryable,
      },
      ack: {
        idempotent: true,
        idempotencyKey: `${deliveryKey}:ack:${payloadFingerprint}`,
        command: "approval.provider-outbox.ack",
        enabled: status === "ready_to_flush" || acknowledged,
      },
      review: {
        idempotent: true,
        idempotencyKey: `${deliveryKey}:review`,
        command: serviceContract.ready
          ? "approval.provider-outbox.review"
          : serviceContract.nextAction.command,
        enabled: validationBlockers.length > 0,
      },
    },
    serviceContract,
    validation: {
      ready: validationBlockers.length === 0 && (status === "ready_to_flush" || acknowledged),
      blockers: validationBlockers,
      duplicateSafe: duplicateOf !== null || priorState.payloadFingerprint === undefined,
      serviceContractReady: serviceContract.ready,
      canFlushProvider: status === "ready_to_flush" && submitEnabled,
    },
  };
}

function buildApprovalProviderServiceContract(
  program,
  exportSnapshot,
  providerContract,
  payload,
  boundary,
  recoveryStatus,
  options,
) {
  const channel = String(options.channel ?? "status-outbox").trim().toLowerCase();
  const adapterTarget = String(options.adapterTarget ?? "mailchimp.approval-handoff").trim();
  const requiredCapabilities = uniqueSorted(options.requiredCapabilities ?? [
    "mailchimp:campaign.read",
    "memory:campaign.local",
    "verifier:evidence.record",
    "status:timeline.write",
  ]);
  const grantedCapabilities = uniqueSorted(providerContract.negotiation?.grantedCapabilities ?? []);
  const grantSet = new Set(grantedCapabilities);
  const missingCapabilities = requiredCapabilities.filter((capability) => !grantSet.has(capability));
  const maxAckSeconds = normalizeIntegerInRange(
    options.maxAckSeconds ?? 300,
    "providerMaxAckSeconds",
    1,
    3600,
  );
  const heartbeatSeconds = normalizeIntegerInRange(
    options.heartbeatSeconds ?? 60,
    "providerHeartbeatSeconds",
    1,
    maxAckSeconds,
  );
  const endpointRows = [
    {
      name: "approval-status-outbox",
      target: adapterTarget,
      channel,
      required: true,
      method: "LOCAL_STATUS",
      capability: "status:timeline.write",
    },
    {
      name: "approval-audit-receipt",
      target: boundary.auditHandoff.receipt ?? "pending-audit",
      channel: "audit",
      required: true,
      method: "LOCAL_RECEIPT",
      capability: "verifier:evidence.record",
    },
    {
      name: "approval-recovery-resume",
      target: recoveryStatus.restartToken ?? "pending-restart",
      channel: "recovery",
      required: true,
      method: "LOCAL_STATUS",
      capability: "memory:campaign.local",
    },
  ].map((endpoint, index) => {
    const capabilityGranted = grantSet.has(endpoint.capability);
    const targetReady = !String(endpoint.target).startsWith("pending-");
    const ready = capabilityGranted && targetReady;

    return {
      index,
      ...endpoint,
      ready,
      idempotencyKey: `${program.job.id}:approval:service-endpoint:${index + 1}:${endpoint.name}`,
      blockedReasons: uniqueSorted([
        ...(capabilityGranted ? [] : [`approval provider service capability missing: ${endpoint.capability}`]),
        ...(targetReady ? [] : [`approval provider service endpoint target pending: ${endpoint.name}`]),
      ]),
    };
  });
  const externalWriteSafe = payload.writePolicy?.externalWritesAllowed === false
    && providerContract.sync?.memoryWritePolicy !== "provider-write";
  const blockedReasons = uniqueSorted([
    ...(channel ? [] : ["approval provider service channel is required"]),
    ...(adapterTarget ? [] : ["approval provider service adapter target is required"]),
    ...missingCapabilities.map((capability) => `approval provider service required capability missing: ${capability}`),
    ...endpointRows.flatMap((endpoint) => endpoint.blockedReasons),
    ...(payload.exportId === exportSnapshot.exportId ? [] : ["approval provider service export mismatch"]),
    ...(payload.auditReceipt === boundary.auditHandoff.receipt ? [] : ["approval provider service audit receipt mismatch"]),
    ...(payload.restartToken === recoveryStatus.restartToken ? [] : ["approval provider service restart token mismatch"]),
    ...(externalWriteSafe ? [] : ["approval provider service contract forbids external provider writes"]),
    ...(heartbeatSeconds <= maxAckSeconds ? [] : ["approval provider service heartbeat exceeds ack window"]),
    ...(options.deliveryAttempt <= options.maxDeliveryAttempts
      ? []
      : [`approval provider service delivery attempt ${options.deliveryAttempt} exceeds max ${options.maxDeliveryAttempts}`]),
  ]);
  const ready = blockedReasons.length === 0;
  const status = ready
    ? "service_contract_ready"
    : missingCapabilities.length > 0
      ? "capability_negotiation_required"
      : endpointRows.some((endpoint) => !endpoint.ready)
        ? "endpoint_binding_required"
        : "service_contract_review";
  const nextAction = ready
    ? {
      command: "approval.provider-outbox.submit",
      label: "Submit approval provider outbox",
      reason: "adapter service contract, restart token, audit receipt, and local write policy are ready",
    }
    : missingCapabilities.length > 0
      ? {
        command: "approval.provider-service.negotiate-capabilities",
        label: "Negotiate approval provider capabilities",
        reason: `missing provider capability: ${missingCapabilities[0]}`,
      }
      : {
        command: "approval.provider-service.review",
        label: "Review approval provider service contract",
        reason: blockedReasons[0] ?? "approval provider service contract requires review",
      };
  const contractId = `approval-provider-service:${deterministicFingerprint([
    program.job.id,
    exportSnapshot.exportId,
    payload.requestId,
    payload.decisionReceipt,
    recoveryStatus.restartToken,
    boundary.auditHandoff.receipt,
    channel,
    adapterTarget,
    endpointRows.map((endpoint) => `${endpoint.name}:${endpoint.ready}`).join(","),
  ])}`;

  return {
    kind: "mailchimp.approval-required.provider-service-contract",
    apiVersion: "aios.integration/v1",
    contractId,
    jobId: program.job.id,
    checkpoint: exportSnapshot.exportId,
    ready,
    status,
    channel,
    adapterTarget,
    provider: providerContract.provider,
    sync: {
      checkpoint: providerContract.sync?.checkpoint ?? exportSnapshot.exportId,
      memoryWritePolicy: providerContract.sync?.memoryWritePolicy ?? "local-only",
      heartbeatSeconds,
      maxAckSeconds,
      replayKey: `${program.job.memory.namespace}:approval:provider-service:${contractId}`,
    },
    capabilities: {
      required: requiredCapabilities,
      granted: grantedCapabilities,
      missing: missingCapabilities,
    },
    endpoints: endpointRows,
    nextAction,
    summary: {
      contractId,
      ready,
      status,
      channel,
      adapterTarget,
      endpointCount: endpointRows.length,
      readyEndpointCount: endpointRows.filter((endpoint) => endpoint.ready).length,
      missingCapabilityCount: missingCapabilities.length,
      nextAction: nextAction.command,
    },
    validation: {
      ready: blockedReasons.length === 0,
      externalWriteSafe,
      endpointBindingsReady: endpointRows.every((endpoint) => endpoint.ready),
      capabilitiesReady: missingCapabilities.length === 0,
      auditReceiptBound: payload.auditReceipt === boundary.auditHandoff.receipt,
      restartTokenBound: payload.restartToken === recoveryStatus.restartToken,
      blockedReasons,
    },
    blockedReasons,
  };
}

function buildApprovalAuditPermissionHandoff(
  program,
  audit,
  exportSnapshot,
  approval,
  lifecycleControls,
  boundary,
  decisionPacket,
  requestState,
  providerOutbox,
  operationalHealth,
  recoveryStatus,
  options,
) {
  const tenantScoped = requestState.persistedRuntimeState.tenant === boundary.tenant
    && requestState.persistedRuntimeState.workspace === boundary.workspace
    && requestState.persistedRuntimeState.isolationKey === boundary.isolationKey;
  const requiredRoles = new Set(boundary.requiredRoles);
  const grantedRoles = new Set(boundary.operatorRoles);
  const roleRows = boundary.requiredRoles.map((role, index) => ({
    index,
    role,
    granted: grantedRoles.has(role),
    command: grantedRoles.has(role) ? "approval.permission.confirm" : "approval.permission-request",
    idempotencyKey: `${program.job.id}:approval:permission:${boundary.isolationKey}:${index + 1}:${role}`,
    blockedReasons: grantedRoles.has(role) ? [] : [`approval permission role missing: ${role}`],
  }));
  const evidenceRows = program.job.verifier.requiredEvidence.map((subject, index) => {
    const present = getAcceptedEvidence(audit).some((entry) => entry.subject === subject);
    return {
      index,
      subject,
      present,
      auditSubject: `${boundary.tenant}/${boundary.workspace}/${subject}`,
      command: present ? "approval.audit.confirm-evidence" : "approval.collect-evidence",
      idempotencyKey: `${program.job.id}:approval:audit-evidence:${boundary.isolationKey}:${index + 1}:${deterministicFingerprint([
        subject,
        exportSnapshot.exportId,
      ])}`,
      blockedReasons: present ? [] : [`approval audit evidence missing: ${subject}`],
    };
  });
  const handoffRows = [
    {
      phase: "tenant-boundary",
      status: boundary.ready && tenantScoped ? "ready" : "blocked",
      command: boundary.ready ? "approval.boundary.accept" : "approval.boundary.review",
      receipt: boundary.auditHandoff.receipt,
      idempotencyKey: `${program.job.id}:approval:audit-handoff:${boundary.isolationKey}:boundary`,
      blockedReasons: uniqueSorted([
        ...boundary.blockedReasons,
        ...(tenantScoped ? [] : ["approval request state tenant boundary mismatch"]),
      ]),
    },
    {
      phase: "operator-decision",
      status: decisionPacket.acceptance.accepted ? "ready" : "blocked",
      command: decisionPacket.acceptance.accepted ? "approval.decision.confirm" : decisionPacket.nextAction.command,
      receipt: decisionPacket.acceptance.decisionReceipt,
      idempotencyKey: `${program.job.id}:approval:audit-handoff:${boundary.isolationKey}:decision:${decisionPacket.acceptance.decisionKey}`,
      blockedReasons: decisionPacket.acceptance.accepted ? [] : decisionPacket.validation.blockers,
    },
    {
      phase: "provider-outbox",
      status: providerOutbox.validation.ready ? "ready" : providerOutbox.status.status,
      command: providerOutbox.validation.canFlushProvider
        ? providerOutbox.commands.submit.command
        : providerOutbox.commands.review.command,
      receipt: providerOutbox.recordId,
      idempotencyKey: `${program.job.id}:approval:audit-handoff:${boundary.isolationKey}:outbox:${providerOutbox.version}`,
      blockedReasons: providerOutbox.validation.blockers,
    },
    {
      phase: "recovery",
      status: recoveryStatus.ready ? "ready" : "blocked",
      command: recoveryStatus.ready ? "approval.handoff.resume" : "approval.recovery-review",
      receipt: recoveryStatus.restartToken,
      idempotencyKey: `${program.job.id}:approval:audit-handoff:${boundary.isolationKey}:recovery`,
      blockedReasons: recoveryStatus.blockedReasons,
    },
    {
      phase: "operational-health",
      status: operationalHealth.ready || operationalHealth.degradedMode ? "ready" : "blocked",
      command: operationalHealth.retryPlan.nextCommand ?? lifecycleControls.nextAction,
      receipt: operationalHealth.state,
      idempotencyKey: `${program.job.id}:approval:audit-handoff:${boundary.isolationKey}:health:${operationalHealth.state}`,
      blockedReasons: operationalHealth.ready || operationalHealth.degradedMode
        ? []
        : operationalHealth.blockedReasons,
    },
  ];
  const blockedReasons = uniqueSorted([
    ...(approval.accepted ? [] : ["approval audit handoff requires accepted approval ticket"]),
    ...(lifecycleControls.commandAllowed ? [] : [`approval audit handoff command not allowed: ${lifecycleControls.requestedCommand}`]),
    ...(providerOutbox.delivery.payload.writePolicy.externalWritesAllowed === false
      ? []
      : ["approval audit handoff forbids external provider writes"]),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["approval audit handoff cannot advance after external write observation"]),
    ...roleRows.flatMap((row) => row.blockedReasons),
    ...evidenceRows.flatMap((row) => row.blockedReasons),
    ...handoffRows.flatMap((row) => row.blockedReasons),
  ]);
  const ready = blockedReasons.length === 0;
  const handoffKey = `${program.job.memory.namespace}:approval:audit-permission:${deterministicFingerprint([
    boundary.isolationKey,
    exportSnapshot.exportId,
    approval.ticket,
    decisionPacket.acceptance.decisionReceipt,
    providerOutbox.recordId,
  ])}`;

  return {
    kind: "mailchimp.approval-required.audit-permission-handoff",
    apiVersion: "aios.security/v1",
    handoffKey,
    ready,
    status: ready
      ? "audit-permission-ready"
      : approval.accepted ? "audit-permission-review" : "approval-required",
    tenant: {
      tenant: boundary.tenant,
      workspace: boundary.workspace,
      isolationKey: boundary.isolationKey,
      tenantScoped,
      allowedTenants: boundary.allowedTenants,
      allowedWorkspaces: boundary.allowedWorkspaces,
    },
    permissions: {
      requiredRoles: [...requiredRoles].sort(),
      grantedRoles: [...grantedRoles].sort(),
      missingRoles: boundary.missingRoles,
      rows: roleRows,
    },
    audit: {
      exportId: exportSnapshot.exportId,
      auditReceipt: boundary.auditHandoff.receipt,
      requestId: requestState.request.requestId,
      providerOutboxRecordId: providerOutbox.recordId,
      evidenceRows,
    },
    handoffRows,
    validation: {
      ready,
      tenantIsolated: tenantScoped && boundary.ready,
      externalWriteSafe: providerOutbox.delivery.payload.writePolicy.externalWritesAllowed === false
        && audit.boundary.externalWritesObserved.length === 0,
      rolesSatisfied: roleRows.every((row) => row.granted),
      evidenceComplete: evidenceRows.every((row) => row.present),
      providerOutboxReady: providerOutbox.validation.ready,
      blockedReasons,
    },
    nextAction: ready
      ? "approval.handoff"
      : blockedReasons.some((reason) => reason.includes("permission") || reason.includes("role"))
        ? "approval.permission-review"
        : blockedReasons.some((reason) => reason.includes("evidence"))
          ? "approval.collect-evidence"
          : decisionPacket.nextAction.command,
  };
}

function buildApprovalExportAnalytics(
  program,
  audit,
  exportSnapshot,
  approval,
  boundary,
  operationalHealth,
  recoveryStatus,
  options,
) {
  const history = normalizeApprovalHistory(options.history);
  const blockerReasons = uniqueSorted([
    ...approval.blockedReasons,
    ...boundary.blockedReasons,
    ...operationalHealth.blockedReasons,
    ...recoveryStatus.blockedReasons.map((reason) => `recovery handoff blocked: ${reason}`),
  ]);
  const currentSnapshot = {
    at: String(options.generatedAt ?? "logical:4"),
    jobId: program.job.id,
    tenant: boundary.tenant,
    workspace: boundary.workspace,
    status: audit.status,
    approvalAccepted: approval.accepted,
    boundaryReady: boundary.ready,
    healthState: operationalHealth.state,
    recoveryReady: recoveryStatus.ready,
    exportReady: exportSnapshot.truthBoundary.readyForExport,
    ready: approval.accepted
      && boundary.ready
      && operationalHealth.ready
      && recoveryStatus.ready
      && exportSnapshot.truthBoundary.readyForExport,
    evidencePresent: getAcceptedEvidence(audit).length,
    evidenceMissing: getMissingEvidence(audit).length,
    externalWrites: audit.boundary.externalWritesObserved.length,
    retryCount: operationalHealth.retryPlan.retryCount,
    blockedCount: blockerReasons.length,
    blockedReasons: blockerReasons,
  };
  const snapshots = [...history, currentSnapshot].slice(-12);
  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots[snapshots.length - 2] ?? null;
  const trend = !previous
    ? "new"
    : previous.ready === latest.ready
      ? "unchanged"
      : latest.ready
        ? "recovered"
        : "regressed";
  const latestBlockedReasons = uniqueSorted(snapshots.flatMap((snapshot) => snapshot.blockedReasons));
  const timeline = snapshots.map((snapshot, index) => ({
    index,
    at: snapshot.at,
    event: snapshot.ready
      ? "approval-export-ready"
      : snapshot.approvalAccepted
        ? "approval-export-review"
        : "approval-ticket-required",
    status: snapshot.status,
    ready: snapshot.ready,
    approvalAccepted: snapshot.approvalAccepted,
    healthState: snapshot.healthState,
    blockedCount: snapshot.blockedCount,
  }));
  const handoffSummary = {
    tenant: boundary.tenant,
    workspace: boundary.workspace,
    isolationKey: boundary.isolationKey,
    auditReceipt: boundary.auditHandoff.receipt,
    recoveryCommand: recoveryStatus.ready
      ? "approval.handoff.resume"
      : operationalHealth.retryPlan.nextCommand ?? "approval.recovery-review",
  };

  return {
    counters: {
      snapshots: snapshots.length,
      readySnapshots: snapshots.filter((snapshot) => snapshot.ready).length,
      blockedSnapshots: snapshots.filter((snapshot) => !snapshot.ready).length,
      acceptedSnapshots: snapshots.filter((snapshot) => snapshot.approvalAccepted).length,
      degradedSnapshots: snapshots.filter((snapshot) => snapshot.healthState === "degraded").length,
      retryAttempts: snapshots.reduce((total, snapshot) => total + snapshot.retryCount, 0),
      evidencePresent: currentSnapshot.evidencePresent,
      evidenceMissing: currentSnapshot.evidenceMissing,
      externalWrites: currentSnapshot.externalWrites,
      statusCounts: countBy(snapshots, "status"),
      healthCounts: countBy(snapshots, "healthState"),
    },
    history: snapshots,
    timelineReport: {
      trend,
      currentEvent: timeline[timeline.length - 1]?.event ?? "approval-export-unknown",
      exportReady: currentSnapshot.exportReady,
      approvalAccepted: currentSnapshot.approvalAccepted,
      latestBlockedReasons,
      timeline,
    },
    exportSummary: {
      reportId: `approval-report:${exportSnapshot.exportId}`,
      exportId: exportSnapshot.exportId,
      format: exportSnapshot.format,
      ready: currentSnapshot.ready,
      headline: currentSnapshot.ready
        ? "approval export is ready for adapter handoff"
        : `approval export requires review: ${latestBlockedReasons[0] ?? "unknown blocker"}`,
      handoffSummary,
      nextReportAction: currentSnapshot.ready
        ? "approval.handoff"
        : operationalHealth.retryPlan.nextCommand ?? "approval.report-review",
    },
  };
}

function buildApprovalNextSteps(contract, packageReadiness) {
  if (contract.runtimeHandoff.ready && packageReadiness.readiness.ready) {
    return [{ action: contract.runtimeHandoff.command, label: "Hand off approved job", reason: "approval, audit, and recovery contracts are ready" }];
  }
  return uniqueSorted([
    ...contract.runtimeHandoff.blockedReasons,
    ...packageReadiness.acceptance.blockedReasons,
  ]).map((reason) => ({
    action: reason.includes("health") || reason.includes("terminal") || reason.includes("retry") || reason.includes("provider failure")
      ? contract.operationalHealth.retryPlan.nextCommand ?? "approval.health-review"
      : reason.includes("tenant") || reason.includes("workspace") || reason.includes("role")
      ? "approval.boundary.review"
      : "approval.review",
    label: reason.includes("health") || reason.includes("terminal") || reason.includes("retry") || reason.includes("provider failure")
      ? "Resolve approval health blocker"
      : reason.includes("tenant") || reason.includes("workspace") || reason.includes("role")
      ? "Resolve approval boundary blocker"
      : "Resolve approval handoff blocker",
    reason,
  }));
}

function normalizeApprovalSchedule(schedule = { mode: "manual" }) {
  const mode = String(schedule.mode ?? "manual").trim().toLowerCase();
  const errors = [];
  if (!["manual", "interval", "cron", "paused"].includes(mode)) {
    errors.push(`unsupported approval schedule mode: ${mode}`);
  }
  if (mode === "interval") {
    const everyMinutes = Number(schedule.everyMinutes ?? schedule.everySeconds / 60);
    if (!Number.isInteger(everyMinutes) || everyMinutes < 5) {
      errors.push("approval interval schedule requires everyMinutes >= 5");
    }
    return {
      valid: errors.length === 0,
      value: { mode, everyMinutes: Number.isInteger(everyMinutes) ? everyMinutes : null },
      errors,
    };
  }
  if (mode === "cron") {
    const expression = String(schedule.expression ?? "").trim();
    if (expression.split(/\s+/).filter(Boolean).length < 5) {
      errors.push("approval cron schedule requires a cron expression");
    }
    return {
      valid: errors.length === 0,
      value: { mode, expression: expression || null },
      errors,
    };
  }
  if (mode === "paused") {
    return {
      valid: errors.length === 0,
      value: { mode, reason: schedule.reason ? String(schedule.reason) : "operator-paused" },
      errors,
    };
  }
  return {
    valid: errors.length === 0,
    value: { mode: "manual" },
    errors,
  };
}

function normalizeApprovalCommandReport(report) {
  if (!report || typeof report !== "object") {
    return null;
  }
  return {
    reportId: report.reportId ? String(report.reportId) : null,
    fingerprint: report.reportId
      ? String(report.reportId).replace(/^approval-command-report:/, "")
      : String(report.fingerprint ?? ""),
    status: report.status ? String(report.status) : "unknown",
  };
}

function validateExports(exportsMap = {}) {
  const names = Object.keys(exportsMap).sort();
  const missing = REQUIRED_EXPORTS.filter((name) => !names.includes(name));
  return { names, required: REQUIRED_EXPORTS, missing, valid: missing.length === 0 };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function getAcceptedEvidence(audit) {
  if (Array.isArray(audit?.evidence?.present)) {
    return audit.evidence.present;
  }
  if (Array.isArray(audit?.evidence?.accepted)) {
    return audit.evidence.accepted;
  }
  return [];
}

function getMissingEvidence(audit) {
  return Array.isArray(audit?.evidence?.missing) ? audit.evidence.missing : [];
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

function normalizeIdentifier(value, prefix) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return `${prefix}:unknown`;
  }
  return normalized.includes(":") ? normalized : `${prefix}:${normalized}`;
}

function normalizeAllowList(values, fallback) {
  if (!Array.isArray(values) || values.length === 0) {
    return [fallback];
  }
  return uniqueSorted(values.map((value) => normalizeIdentifier(value, fallback.split(":")[0])));
}

function normalizeMemoryScopeClaims(memory) {
  if (Array.isArray(memory)) {
    return memory.map((entry) => `memory:${entry}`);
  }
  if (!memory || typeof memory !== "object") {
    return ["memory:unknown"];
  }
  return uniqueSorted([
    memory.mode ? `memory-mode:${memory.mode}` : null,
    memory.namespace ? `memory-namespace:${memory.namespace}` : null,
    memory.writePolicy ? `memory-write-policy:${memory.writePolicy}` : null,
  ]);
}

function normalizeApprovalHistory(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.map((snapshot, index) => ({
    at: String(snapshot.at ?? `history:${index}`),
    jobId: String(snapshot.jobId ?? "unknown"),
    tenant: String(snapshot.tenant ?? "tenant:unknown"),
    workspace: String(snapshot.workspace ?? "workspace:unknown"),
    status: String(snapshot.status ?? "unknown"),
    approvalAccepted: Boolean(snapshot.approvalAccepted ?? snapshot.accepted),
    boundaryReady: Boolean(snapshot.boundaryReady),
    healthState: String(snapshot.healthState ?? "unknown"),
    recoveryReady: Boolean(snapshot.recoveryReady),
    exportReady: Boolean(snapshot.exportReady),
    ready: Boolean(snapshot.ready),
    evidencePresent: Number(snapshot.evidencePresent ?? 0),
    evidenceMissing: Number(snapshot.evidenceMissing ?? 0),
    externalWrites: Number(snapshot.externalWrites ?? 0),
    retryCount: Number(snapshot.retryCount ?? 0),
    blockedCount: Number(snapshot.blockedCount ?? 0),
    blockedReasons: uniqueSorted(snapshot.blockedReasons ?? []),
  }));
}

function normalizeApprovalStatusEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    return null;
  }
  return {
    envelopeId: envelope.envelopeId ? String(envelope.envelopeId) : null,
    fingerprint: envelope.envelopeId
      ? String(envelope.envelopeId).replace(/^approval-status:/, "")
      : String(envelope.fingerprint ?? ""),
    status: envelope.status ? String(envelope.status) : "unknown",
    revision: Number(envelope.revision ?? 0),
  };
}

function normalizeApprovalRecoveryExport(summary) {
  if (!summary || typeof summary !== "object") {
    return null;
  }
  return {
    exportId: summary.exportId ? String(summary.exportId) : null,
    fingerprint: summary.exportId
      ? String(summary.exportId).replace(/^approval-recovery-export:/, "")
      : String(summary.fingerprint ?? ""),
    status: summary.status ? String(summary.status) : "unknown",
  };
}

function countBy(values, key) {
  return values.reduce((counts, value) => {
    const name = String(value[key] ?? "unknown");
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
}

function normalizeApprovalHealthState(value) {
  const state = String(value ?? "healthy").trim().toLowerCase();
  if (!["healthy", "degraded", "failed", "offline"].includes(state)) {
    throw new Error(`unsupported approval health state: ${value}`);
  }
  return state;
}

function normalizeProviderAckStatus(value) {
  const status = String(value ?? "pending").trim().toLowerCase();
  if (!["pending", "acknowledged", "failed", "rejected"].includes(status)) {
    throw new Error(`unsupported approval provider ack status: ${value}`);
  }
  return status;
}

function normalizeIntegerInRange(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function deterministicFingerprint(parts) {
  return parts
    .map((part) => String(part ?? "null").replaceAll("|", "%7C"))
    .join("|");
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
