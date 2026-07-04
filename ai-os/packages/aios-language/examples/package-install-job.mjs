import {
  createAuditExportSnapshot,
  createEvidence,
  createStatusEvent,
  createTruthBoundaryReport,
} from "../stdlib/audit.mjs";
import {
  buildPackageReadinessPreview,
  buildProviderServiceContract,
  compilePackageSource,
} from "../stdlib/packages.mjs";

export const packageInstallJobSource = `# deterministic Mailchimp package install readiness job
use mailchimp:campaign.read
use memory:campaign.local
use verifier:evidence.record
use status:timeline.write
recover rollback=snapshot retry=2
step resolve-package-manifest input=packageRef output=manifest verify.contract=manifest-stable
step negotiate-mailchimp-scopes input=manifest output=providerScopes verify.source=mailchimp
step create-install-checkpoint input=providerScopes output=installCheckpoint verify.truth=local-only
step publish-install-status input=installCheckpoint output=statusEvent verify.boundary=no-external-write
`;

const REQUIRED_EXPORTS = Object.freeze([
  "compile",
  "audit",
  "installContract",
  "installPreview",
  "selfCheck",
]);

export function buildPackageInstallProgram(options = {}) {
  return compilePackageSource(packageInstallJobSource, {
    name: options.name ?? "mailchimp-package-install-job",
    version: options.version ?? "0.1.0",
    description: "Compile a Mailchimp package install readiness job with deterministic provider scope handoff.",
    capabilities: options.capabilities ?? [],
    exports: {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      installContract: "./examples/package-install-job.mjs#buildPackageInstallContract",
      installPreview: "./examples/package-install-job.mjs#buildPackageInstallPreview",
      selfCheck: "./examples/package-install-job.mjs#selfCheckPackageInstallJob",
    },
  }, {
    name: "mailchimp-package-install-job",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: true,
      requireApproval: options.requireApproval ?? true,
      approvalTicket: options.approvalTicket,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 14,
    },
  });
}

export function buildPackageInstallAudit(program = buildPackageInstallProgram(), options = {}) {
  const missing = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missing.has(subject))
    .map((subject) => createEvidence(
      subject.includes("verify.source") ? "mailchimp-read-receipt" : "runtime-local-receipt",
      subject,
      { example: "package-install-job", packageRef: options.packageRef ?? program.manifest.name },
    ));

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "completed",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "package install queued" }),
      createStatusEvent("running", { at: "logical:1", message: "manifest and provider scopes resolved" }),
      createStatusEvent("verifying", { at: "logical:2", message: "install checkpoint verified" }),
      createStatusEvent(options.status ?? "completed", {
        at: "logical:3",
        message: "install status ready for handoff",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildPackageInstallContract(
  program = buildPackageInstallProgram(),
  audit = buildPackageInstallAudit(program),
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
    providerResource: "package-install",
    supportedCapabilities: options.supportedCapabilities,
  });
  const exportsStatus = validateExports(program.manifest.exports);
  const health = buildInstallOperationalHealth(program, audit, options);
  const installState = buildInstallState(program, providerContract, exportSnapshot, health, options);
  const lifecycleControls = buildInstallLifecycleControls(program, installState, health, options);
  const providerHandoff = buildInstallProviderHandoffState(
    program,
    providerContract,
    exportSnapshot,
    installState,
    health,
    options,
  );
  const providerServiceAgreement = buildInstallProviderServiceAgreement(
    program,
    providerContract,
    installState,
    providerHandoff,
    health,
    options,
  );
  const analytics = buildPackageInstallAnalytics(program, audit, exportSnapshot, installState, health, options);
  const decisionContract = buildInstallDecisionContract(
    program,
    audit,
    exportSnapshot,
    installState,
    providerHandoff,
    health,
    analytics,
    providerServiceAgreement,
    options,
  );
  const actionLedger = buildInstallActionabilityLedger(
    program,
    audit,
    exportSnapshot,
    installState,
    providerHandoff,
    providerServiceAgreement,
    health,
    analytics,
    decisionContract,
    options,
  );
  const blockedReasons = uniqueSorted([
    ...installState.blockedReasons,
    ...lifecycleControls.blockedReasons,
    ...health.blockedReasons,
    ...providerHandoff.blockedReasons,
    ...providerServiceAgreement.blockedReasons,
    ...decisionContract.blockedReasons,
    ...actionLedger.validation.blockedReasons,
    ...exportsStatus.missing.map((name) => `manifest export missing: ${name}`),
    ...(program.lifecycle.validation.valid ? [] : program.lifecycle.validation.errors),
    ...(audit.evidence.missing.length === 0 ? [] : [`${audit.evidence.missing.length} install evidence receipt(s) missing`]),
    ...(audit.boundary.externalWritesObserved.length === 0 ? [] : [`${audit.boundary.externalWritesObserved.length} external write violation(s) observed`]),
    ...providerContract.handoffState.blockedReasons,
  ]);
  const ready = blockedReasons.length === 0;
  const statusEnvelope = buildPackageInstallStatusHandoffEnvelope(
    program,
    audit,
    exportSnapshot,
    providerContract,
    installState,
    providerHandoff,
    providerServiceAgreement,
    health,
    analytics,
    decisionContract,
    actionLedger,
    blockedReasons,
    ready,
    options,
  );
  const timelineReport = buildPackageInstallTimelineReport(
    program,
    audit,
    exportSnapshot,
    installState,
    providerHandoff,
    providerServiceAgreement,
    health,
    analytics,
    decisionContract,
    actionLedger,
    statusEnvelope,
    blockedReasons,
    ready,
    options,
  );
  const externalHandoffBridge = buildPackageInstallExternalHandoffBridge(
    program,
    exportSnapshot,
    installState,
    providerHandoff,
    providerServiceAgreement,
    decisionContract,
    actionLedger,
    statusEnvelope,
    timelineReport,
    ready,
    options,
  );

  return deepFreeze({
    kind: "mailchimp.package-install.contract",
    apiVersion: "aios.example/v1",
    jobId: program.job.id,
    package: {
      name: program.manifest.name,
      version: program.manifest.version,
      requestedCapabilities: program.job.capabilities,
      exports: exportsStatus,
    },
    installState,
    lifecycleControls,
    health,
    providerHandoff,
    providerServiceAgreement,
    decisionContract,
    actionLedger,
    statusEnvelope,
    timelineReport,
    externalHandoffBridge,
    analytics,
    provider: providerContract.provider,
    audit: {
      status: audit.status,
      exportId: exportSnapshot.exportId,
      readyForExport: exportSnapshot.truthBoundary.readyForExport,
    },
    runtimeHandoff: {
      ready,
      command: ready ? providerHandoff.externalHandoff.command : providerHandoff.nextAction,
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
      envelopeId: statusEnvelope.envelopeId,
      envelopeStatus: statusEnvelope.status,
      envelopeRevision: statusEnvelope.revision,
      adapterStatus: statusEnvelope.adapter.status,
      adapterCommand: statusEnvelope.adapter.command,
      checkpoint: exportSnapshot.exportId,
      syncCursor: providerHandoff.syncMetadata.cursor,
      providerAgreementId: providerServiceAgreement.agreementId,
      providerAgreementStatus: providerServiceAgreement.status,
      providerAgreementNextAction: providerServiceAgreement.nextAction.command,
      providerAgreementReady: providerServiceAgreement.ready,
      decisionReceipt: ready ? decisionContract.receipt.id : null,
      acceptanceCommand: decisionContract.nextAction.command,
      lifecycleStatus: lifecycleControls.status,
      lifecycleCommand: lifecycleControls.nextAction.command,
      lifecycleCanCommit: lifecycleControls.canCommit,
      lifecycleScheduleMode: lifecycleControls.schedule.mode,
      actionLedgerId: actionLedger.ledgerId,
      actionLedgerStatus: actionLedger.status,
      reportId: analytics.exportSummary.reportId,
      timelineReportId: timelineReport.reportId,
      timelineReportStatus: timelineReport.status,
      timelineNextCommand: timelineReport.restart.nextCommand,
      externalBridgeId: externalHandoffBridge.bridgeId,
      externalBridgeStatus: externalHandoffBridge.status,
      externalBridgeReady: externalHandoffBridge.ready,
      externalBridgeReplayKey: externalHandoffBridge.replay.replayKey,
      externalBridgeNextAction: externalHandoffBridge.nextAction.command,
      blockedReasons,
    },
  });
}

export function buildPackageInstallPreview(options = {}) {
  const program = options.program ?? buildPackageInstallProgram(options);
  const audit = options.audit ?? buildPackageInstallAudit(program, options);
  const contract = buildPackageInstallContract(program, audit, options);
  const packageReadiness = buildPackageReadinessPreview(program, {
    providerContract: buildProviderServiceContract(program, {
      externalApproval: options.approvalTicket,
      providerResource: "package-install",
    }),
    acceptance: {
      accepted: options.accepted ?? false,
      acceptedBy: options.acceptedBy,
      acceptedAt: options.acceptedAt ?? "logical:5",
    },
  });

  return deepFreeze({
    kind: "mailchimp.package-install.preview",
    apiVersion: "aios.example/v1",
    title: "Mailchimp package install readiness",
    jobId: program.job.id,
    readiness: {
      ready: contract.runtimeHandoff.ready && packageReadiness.readiness.ready,
      installReady: contract.installState.ready,
      providerReady: contract.providerHandoff.ready,
      providerAgreementReady: contract.providerServiceAgreement.ready,
      lifecycleReady: contract.lifecycleControls.ready,
      healthReady: contract.health.ready,
      decisionReady: contract.decisionContract.ready,
      statusEnvelopeReady: contract.statusEnvelope.ready,
      actionLedgerReady: contract.actionLedger.ready,
      timelineReportReady: contract.timelineReport.ready,
      externalBridgeReady: contract.externalHandoffBridge.ready,
      degradedMode: contract.health.degradedMode,
      analyticsReady: contract.analytics.exportSummary.ready,
      packageReady: packageReadiness.readiness.ready,
      blockedReasons: uniqueSorted([
        ...contract.runtimeHandoff.blockedReasons,
        ...contract.lifecycleControls.blockedReasons,
        ...contract.providerServiceAgreement.validation.blockedReasons,
        ...contract.statusEnvelope.validation.blockedReasons,
        ...contract.timelineReport.validation.blockedReasons,
        ...contract.externalHandoffBridge.validation.blockedReasons,
        ...packageReadiness.acceptance.blockedReasons,
      ]),
    },
    contract,
    packageReadiness,
    decision: contract.decisionContract.preview,
    nextSteps: buildInstallNextSteps(contract, packageReadiness),
  });
}

export function describePackageInstallJob(options = {}) {
  const preview = buildPackageInstallPreview(options);
  return deepFreeze({
    jobId: preview.jobId,
    ready: preview.readiness.ready,
    installState: preview.contract.installState,
    lifecycleControls: preview.contract.lifecycleControls,
    providerHandoff: preview.contract.providerHandoff.summary,
    providerServiceAgreement: preview.contract.providerServiceAgreement.summary,
    decisionContract: preview.contract.decisionContract.summary,
    statusEnvelope: preview.contract.statusEnvelope,
    actionLedger: preview.contract.actionLedger,
    timelineReport: preview.contract.timelineReport,
    externalHandoffBridge: preview.contract.externalHandoffBridge,
    health: preview.contract.health,
    analytics: preview.contract.analytics.exportSummary,
    runtimeHandoff: preview.contract.runtimeHandoff,
    nextSteps: preview.nextSteps,
  });
}

export function selfCheckPackageInstallJob(options = {}) {
  const preview = buildPackageInstallPreview({
    accepted: true,
    acceptedBy: "self-check",
    approvalTicket: "install_self_check",
    operatorDecision: {
      accepted: true,
      acceptedBy: "self-check",
    },
    ...options,
  });

  return deepFreeze({
    kind: "mailchimp.package-install.self-check",
    apiVersion: "aios.example/v1",
    passed: preview.readiness.ready
      && preview.contract.actionLedger.ready
      && preview.contract.providerServiceAgreement.ready
      && preview.contract.providerServiceAgreement.validation.externalWriteSafe
      && preview.contract.statusEnvelope.ready
      && preview.contract.statusEnvelope.adapter.externalWritesAllowed === false
      && preview.contract.statusEnvelope.replayGuard.idempotent
      && preview.contract.lifecycleControls.validation.settingsValid
      && preview.contract.lifecycleControls.commands.review.idempotent
      && preview.contract.timelineReport.restart.restartSafe
      && preview.contract.timelineReport.validation.externalWriteSafe
      && preview.contract.externalHandoffBridge.ready
      && preview.contract.externalHandoffBridge.validation.verifierClaimCompatible,
    jobId: preview.jobId,
    blockedReasons: preview.readiness.blockedReasons,
  });
}

function buildPackageInstallStatusHandoffEnvelope(
  program,
  audit,
  exportSnapshot,
  providerContract,
  installState,
  providerHandoff,
  providerServiceAgreement,
  health,
  analytics,
  decisionContract,
  actionLedger,
  blockedReasons,
  ready,
  options,
) {
  const generatedAt = String(options.envelopeGeneratedAt ?? options.generatedAt ?? "logical:4");
  const revision = normalizePositiveInteger(options.envelopeRevision ?? 1, "envelopeRevision");
  const previous = normalizeInstallStatusEnvelope(options.previousStatusEnvelope);
  const status = ready
    ? "ready_for_provider_commit"
    : decisionContract.operatorDecision.accepted
      ? "accepted_review_required"
      : "operator_acceptance_required";
  const adapterCommand = ready
    ? providerHandoff.externalHandoff.command
    : actionLedger.nextAction
      ?? health.retryPlan.nextCommand
      ?? decisionContract.nextAction.command
      ?? providerHandoff.nextAction
      ?? "package.install.review";
  const evidenceState = {
    present: getAcceptedEvidence(audit).length,
    missing: getMissingEvidence(audit).length,
    externalWrites: audit.boundary.externalWritesObserved.length,
  };
  const sequence = [
    {
      index: 0,
      at: "logical:0",
      event: "install.manifest.resolved",
      status: installState.missingCapabilities.length === 0 ? "ready" : "blocked",
      command: "package.install.review-manifest",
      receipt: installState.packageRef,
      blockedReasons: installState.missingCapabilities.map((capability) => (
        `install manifest capability unresolved: ${capability}`
      )),
    },
    {
      index: 1,
      at: "logical:1",
      event: "install.provider.negotiated",
      status: providerHandoff.negotiation.fullyGranted ? "ready" : "blocked",
      command: providerHandoff.nextAction,
      receipt: providerHandoff.syncMetadata.cursor,
      blockedReasons: providerHandoff.negotiation.missingRequiredCapabilities.map((capability) => (
        `install provider capability unresolved: ${capability}`
      )),
    },
    {
      index: 2,
      at: "logical:2",
      event: "install.operator.decision",
      status: decisionContract.operatorDecision.accepted ? "ready" : "blocked",
      command: decisionContract.nextAction.command,
      receipt: decisionContract.receipt.id,
      blockedReasons: decisionContract.operatorDecision.accepted
        ? []
        : ["package install operator acceptance is pending"],
    },
    {
      index: 3,
      at: generatedAt,
      event: "install.adapter.status",
      status,
      command: adapterCommand,
      receipt: ready ? providerContract.handoffState.handoffToken : null,
      blockedReasons,
    },
  ];
  const fingerprintParts = [
    program.job.id,
    exportSnapshot.exportId,
    installState.packageRef,
    providerHandoff.syncMetadata.cursor,
    providerServiceAgreement.agreementId,
    providerServiceAgreement.status,
    decisionContract.receipt.id,
    decisionContract.operatorDecision.accepted,
    providerHandoff.providerStatus,
    health.state,
    actionLedger.ledgerId,
    status,
    revision,
  ];
  const fingerprint = deterministicFingerprint(fingerprintParts);
  const envelopeId = `install-status:${fingerprint}`;
  const replayGuard = {
    idempotent: true,
    replayKey: `${program.job.memory.namespace}:install:status-envelope:${envelopeId}`,
    priorEnvelopeId: previous?.envelopeId ?? null,
    changedSincePrevious: previous ? previous.fingerprint !== fingerprint : true,
    stableAcrossRestart: Boolean(providerHandoff.syncMetadata.cursor)
      && Boolean(decisionContract.receipt.id)
      && providerHandoff.externalHandoff.correlationId !== null,
    canReplay: ready
      && providerHandoff.ready
      && providerServiceAgreement.ready
      && decisionContract.ready
      && health.allowsCommit,
  };
  const validationBlockers = uniqueSorted([
    ...blockedReasons,
    ...(envelopeId ? [] : ["package install status envelope requires id"]),
    ...(providerHandoff.syncMetadata.checkpoint === exportSnapshot.exportId
      ? []
      : ["package install status envelope checkpoint mismatch"]),
    ...(providerHandoff.syncMetadata.packageRef === installState.packageRef
      ? []
      : ["package install status envelope package mismatch"]),
    ...(decisionContract.receipt.exportId === exportSnapshot.exportId
      ? []
      : ["package install decision receipt export mismatch"]),
    ...(analytics.exportSummary.exportId === exportSnapshot.exportId
      ? []
      : ["package install analytics export mismatch"]),
    ...(providerServiceAgreement.validation.ready ? [] : providerServiceAgreement.validation.blockedReasons),
    ...(providerServiceAgreement.sync.checkpoint === exportSnapshot.exportId
      ? []
      : ["package install provider agreement checkpoint mismatch"]),
    ...(actionLedger.validation.ready ? [] : actionLedger.validation.blockedReasons),
    ...(evidenceState.externalWrites === 0
      ? []
      : ["package install status envelope cannot advance after external write observation"]),
    ...(replayGuard.stableAcrossRestart ? [] : ["package install status envelope is not stable across restart"]),
  ]);

  return {
    kind: "mailchimp.package-install.status-envelope",
    apiVersion: "aios.integration/v1",
    envelopeId,
    revision,
    generatedAt,
    ready: ready && validationBlockers.length === 0,
    status: validationBlockers.length === 0 ? status : "status_envelope_blocked",
    jobId: program.job.id,
    checkpoint: exportSnapshot.exportId,
    packageRef: installState.packageRef,
    adapter: {
      provider: providerContract.provider?.name ?? "mailchimp",
      resource: providerContract.provider?.resource ?? "package-install",
      status: ready ? "ready_to_commit" : providerHandoff.providerStatus,
      command: adapterCommand,
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
      externalWritesAllowed: false,
      target: providerHandoff.externalHandoff.target,
      correlationId: providerHandoff.externalHandoff.correlationId,
      syncCursor: providerHandoff.syncMetadata.cursor,
      agreementId: providerServiceAgreement.agreementId,
      agreementStatus: providerServiceAgreement.status,
    },
    recovery: {
      retryable: health.retryable,
      retryAfterSeconds: health.retryPlan.retryAfterSeconds,
      retryCommand: health.retryPlan.nextCommand,
      degradedMode: health.degradedMode,
      failureCode: health.failure.code,
    },
    clientState: {
      primaryAction: adapterCommand,
      decisionReceipt: decisionContract.receipt.id,
      acceptedBy: decisionContract.operatorDecision.acceptedBy,
      acceptedAt: decisionContract.operatorDecision.acceptedAt,
      readinessTrend: analytics.exportSummary.trend,
      reportId: analytics.exportSummary.reportId,
      packageRef: installState.packageRef,
      actionLedgerId: actionLedger.ledgerId,
      actionLedgerStatus: actionLedger.status,
      providerAgreementId: providerServiceAgreement.agreementId,
      providerAgreementStatus: providerServiceAgreement.status,
    },
    providerAgreement: {
      agreementId: providerServiceAgreement.agreementId,
      status: providerServiceAgreement.status,
      nextAction: providerServiceAgreement.nextAction.command,
      serviceLevel: providerServiceAgreement.serviceLevel,
      endpointCount: providerServiceAgreement.endpoints.length,
      blockedReasons: providerServiceAgreement.validation.blockedReasons,
    },
    actionLedger: {
      ledgerId: actionLedger.ledgerId,
      status: actionLedger.status,
      nextAction: actionLedger.nextAction,
      ready: actionLedger.ready,
      retryableRows: actionLedger.summary.retryableRows,
      blockedRows: actionLedger.summary.blockedRows,
    },
    evidenceState,
    sequence,
    replayGuard,
    validation: {
      ready: validationBlockers.length === 0,
      blockedReasons: validationBlockers,
      externalWriteSafe: evidenceState.externalWrites === 0,
      checkpointConsistent: providerHandoff.syncMetadata.checkpoint === exportSnapshot.exportId
        && decisionContract.receipt.exportId === exportSnapshot.exportId,
      operatorDecisionAccepted: decisionContract.operatorDecision.accepted,
      actionLedgerReady: actionLedger.ready,
      providerAgreementReady: providerServiceAgreement.ready,
      sequenceComplete: sequence.every((entry) => entry.status === "ready" || entry.blockedReasons.length > 0),
    },
  };
}

function buildInstallActionabilityLedger(
  program,
  audit,
  exportSnapshot,
  installState,
  providerHandoff,
  providerServiceAgreement,
  health,
  analytics,
  decisionContract,
  options,
) {
  const evidenceRows = program.job.verifier.requiredEvidence.map((subject, index) => {
    const present = getAcceptedEvidence(audit).some((entry) => entry.subject === subject);
    return {
      phase: "evidence",
      index,
      subject,
      status: present ? "ready" : "blocked",
      retryable: !present,
      command: present ? "package.install.evidence-confirm" : "package.install.collect-evidence",
      receipt: present ? `evidence:${exportSnapshot.exportId}:${index + 1}` : null,
      idempotencyKey: `${program.job.id}:install:action:evidence:${exportSnapshot.exportId}:${index + 1}:${deterministicFingerprint([
        subject,
      ])}`,
      blockedReasons: present ? [] : [`package install evidence missing: ${subject}`],
    };
  });
  const capabilityRows = providerHandoff.negotiation.requiredCapabilities.map((capability, index) => {
    const granted = providerHandoff.negotiation.grantedCapabilities.includes(capability);
    return {
      phase: "capability",
      index: evidenceRows.length + index,
      capability,
      status: granted ? "ready" : "blocked",
      retryable: !granted && providerHandoff.providerStatus !== "offline",
      command: granted ? "package.install.capability-confirm" : "package.install.negotiate-capabilities",
      receipt: granted ? providerHandoff.syncMetadata.cursor : null,
      idempotencyKey: `${program.job.id}:install:action:capability:${installState.packageRef}:${index + 1}:${capability}`,
      blockedReasons: granted ? [] : [`package install required capability missing: ${capability}`],
    };
  });
  const healthRows = [
    {
      phase: "provider-service-agreement",
      index: evidenceRows.length + capabilityRows.length,
      status: providerServiceAgreement.ready ? "ready" : "blocked",
      retryable: providerServiceAgreement.retryable,
      command: providerServiceAgreement.ready
        ? "package.install.provider-agreement-confirm"
        : providerServiceAgreement.nextAction.command,
      receipt: providerServiceAgreement.agreementId,
      idempotencyKey: `${program.job.id}:install:action:provider-agreement:${providerServiceAgreement.agreementId}`,
      blockedReasons: providerServiceAgreement.validation.blockedReasons,
      serviceLevel: providerServiceAgreement.serviceLevel,
      endpointCount: providerServiceAgreement.endpoints.length,
    },
    {
      phase: "health",
      index: evidenceRows.length + capabilityRows.length + 1,
      status: health.allowsCommit ? "ready" : health.degradedMode ? "degraded" : "blocked",
      retryable: health.retryable,
      command: health.allowsCommit
        ? "package.install.health-confirm"
        : health.retryPlan.nextCommand ?? "package.install.health-review",
      receipt: health.state,
      idempotencyKey: `${program.job.id}:install:action:health:${exportSnapshot.exportId}:${health.state}:${health.retryPlan.retryCount}`,
      blockedReasons: health.allowsCommit || health.degradedMode ? [] : health.blockedReasons,
      retryAfterSeconds: health.retryPlan.retryAfterSeconds,
      actionableErrors: health.actionableErrors,
    },
    {
      phase: "operator-decision",
      index: evidenceRows.length + capabilityRows.length + 2,
      status: decisionContract.operatorDecision.accepted ? "ready" : "blocked",
      retryable: false,
      command: decisionContract.operatorDecision.accepted
        ? "package.install.decision-confirm"
        : "package.install.accept-preview",
      receipt: decisionContract.receipt.id,
      idempotencyKey: `${program.job.id}:install:action:decision:${decisionContract.receipt.id}`,
      blockedReasons: decisionContract.operatorDecision.accepted
        ? []
        : ["package install operator acceptance required before provider commit"],
    },
    {
      phase: "provider-handoff",
      index: evidenceRows.length + capabilityRows.length + 3,
      status: providerHandoff.ready ? "ready" : providerHandoff.providerStatus,
      retryable: providerHandoff.providerStatus !== "offline",
      command: providerHandoff.ready ? providerHandoff.externalHandoff.command : providerHandoff.nextAction,
      receipt: providerHandoff.externalHandoff.token,
      idempotencyKey: `${program.job.id}:install:action:provider:${providerHandoff.syncMetadata.cursor}`,
      blockedReasons: providerHandoff.ready ? [] : providerHandoff.blockedReasons,
    },
    {
      phase: "analytics",
      index: evidenceRows.length + capabilityRows.length + 4,
      status: analytics.exportSummary.ready ? "ready" : "review",
      retryable: false,
      command: analytics.exportSummary.nextReportAction,
      receipt: analytics.exportSummary.reportId,
      idempotencyKey: `${program.job.id}:install:action:analytics:${analytics.exportSummary.reportId}`,
      blockedReasons: analytics.exportSummary.ready ? [] : analytics.exportSummary.latestBlockedReasons,
    },
  ];
  const rows = [...evidenceRows, ...capabilityRows, ...healthRows];
  const blockedReasons = uniqueSorted([
    ...rows.flatMap((row) => row.blockedReasons),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["package install action ledger cannot advance after external write observation"]),
    ...(providerServiceAgreement.validation.ready ? [] : providerServiceAgreement.validation.blockedReasons),
  ]);
  const commitReady = blockedReasons.length === 0
    && installState.ready
    && providerHandoff.ready
    && providerServiceAgreement.ready
    && decisionContract.ready
    && health.allowsCommit;
  const retryableRows = rows.filter((row) => row.retryable && row.status !== "ready");
  const nextAction = commitReady
    ? providerHandoff.externalHandoff.command
    : retryableRows[0]?.command
      ?? decisionContract.nextAction.command
      ?? "package.install.review";

  return {
    kind: "mailchimp.package-install.actionability-ledger",
    apiVersion: "aios.ops/v1",
    ledgerId: `install-action-ledger:${deterministicFingerprint([
      program.job.id,
      exportSnapshot.exportId,
      installState.packageRef,
      providerHandoff.syncMetadata.cursor,
      providerServiceAgreement.agreementId,
      health.state,
      decisionContract.receipt.id,
      rows.map((row) => `${row.phase}:${row.status}`).join(","),
    ])}`,
    jobId: program.job.id,
    packageRef: installState.packageRef,
    checkpoint: exportSnapshot.exportId,
    ready: commitReady,
    status: commitReady
      ? "commit-ready"
      : health.degradedMode ? "degraded-action-required" : "action-required",
    nextAction,
    retryPlan: {
      retryable: retryableRows.length > 0 || health.retryable,
      retryAfterSeconds: health.retryPlan.retryAfterSeconds,
      nextCommand: retryableRows[0]?.command ?? health.retryPlan.nextCommand,
      backoffPolicy: health.retryable
        ? `linear:${health.retryPlan.retryAfterSeconds}s`
        : "none",
    },
    summary: {
      totalRows: rows.length,
      readyRows: rows.filter((row) => row.status === "ready").length,
      retryableRows: retryableRows.length,
      degradedRows: rows.filter((row) => row.status === "degraded").length,
      blockedRows: rows.filter((row) => row.status === "blocked").length,
      actionableErrorCount: health.actionableErrors.length,
      blockedReasons,
    },
    validation: {
      ready: blockedReasons.length === 0,
      externalWriteSafe: audit.boundary.externalWritesObserved.length === 0,
      providerRetryable: providerHandoff.providerStatus !== "offline",
      providerAgreementReady: providerServiceAgreement.ready,
      healthAllowsCommit: health.allowsCommit,
      operatorDecisionAccepted: decisionContract.operatorDecision.accepted,
      blockedReasons,
    },
    rows,
  };
}

function buildPackageInstallTimelineReport(
  program,
  audit,
  exportSnapshot,
  installState,
  providerHandoff,
  providerServiceAgreement,
  health,
  analytics,
  decisionContract,
  actionLedger,
  statusEnvelope,
  blockedReasons,
  ready,
  options,
) {
  const generatedAt = String(options.timelineReportGeneratedAt ?? options.generatedAt ?? "logical:5");
  const previous = normalizeInstallTimelineReport(options.previousTimelineReport);
  const evidencePresent = getAcceptedEvidence(audit).length;
  const evidenceMissing = getMissingEvidence(audit).length;
  const actionRows = actionLedger.rows.map((row) => ({
    phase: row.phase,
    index: row.index,
    status: row.status,
    retryable: row.retryable,
    command: row.command,
    idempotencyKey: row.idempotencyKey,
    blockedCount: row.blockedReasons.length,
  }));
  const phaseCounts = countBy(actionRows, "phase");
  const statusCounts = countBy(actionRows, "status");
  const retryRows = actionRows.filter((row) => row.retryable && row.status !== "ready");
  const restartSafe = statusEnvelope.replayGuard.stableAcrossRestart
    && actionLedger.validation.ready
    && providerServiceAgreement.validation.ready
    && Boolean(providerHandoff.syncMetadata.cursor)
    && Boolean(decisionContract.receipt.id);
  const reportFingerprint = deterministicFingerprint([
    program.job.id,
    exportSnapshot.exportId,
    installState.packageRef,
    statusEnvelope.envelopeId,
    actionLedger.ledgerId,
    providerServiceAgreement.agreementId,
    analytics.exportSummary.reportId,
    actionRows.map((row) => `${row.phase}:${row.status}:${row.command}`).join(","),
  ]);
  const reportId = `install-timeline:${reportFingerprint}`;
  const validationBlockers = uniqueSorted([
    ...blockedReasons,
    ...(statusEnvelope.ready ? [] : statusEnvelope.validation.blockedReasons),
    ...(actionLedger.ready ? [] : actionLedger.validation.blockedReasons),
    ...(analytics.exportSummary.exportId === exportSnapshot.exportId
      ? []
      : ["package install timeline report export mismatch"]),
    ...(providerHandoff.syncMetadata.checkpoint === exportSnapshot.exportId
      ? []
      : ["package install timeline report checkpoint mismatch"]),
    ...(providerServiceAgreement.validation.ready ? [] : providerServiceAgreement.validation.blockedReasons),
    ...(providerServiceAgreement.sync.cursor === providerHandoff.syncMetadata.cursor
      ? []
      : ["package install timeline report provider agreement cursor mismatch"]),
    ...(restartSafe ? [] : ["package install timeline report is not restart-safe"]),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["package install timeline report cannot advance after external write observation"]),
  ]);
  const reportReady = ready && validationBlockers.length === 0;
  const nextCommand = reportReady
    ? statusEnvelope.adapter.command
    : retryRows[0]?.command
      ?? health.retryPlan.nextCommand
      ?? decisionContract.nextAction.command
      ?? providerHandoff.nextAction;

  return {
    kind: "mailchimp.package-install.timeline-report",
    apiVersion: "aios.reporting/v1",
    reportId,
    jobId: program.job.id,
    packageRef: installState.packageRef,
    generatedAt,
    checkpoint: exportSnapshot.exportId,
    ready: reportReady,
    status: reportReady
      ? "export_ready"
      : health.degradedMode ? "degraded_review" : "blocked_review",
    previous: previous
      ? {
        reportId: previous.reportId,
        status: previous.status,
        changedSincePrevious: previous.fingerprint !== reportFingerprint,
      }
      : null,
    restart: {
      restartSafe,
      nextCommand,
      replayKey: `${program.job.memory.namespace}:install:timeline-report:${reportId}`,
      replayableRows: actionRows.filter((row) => row.status !== "ready" && row.idempotencyKey).length,
      retryAfterSeconds: health.retryPlan.retryAfterSeconds,
    },
    counters: {
      evidencePresent,
      evidenceMissing,
      externalWrites: audit.boundary.externalWritesObserved.length,
      actionRows: actionRows.length,
      readyRows: actionRows.filter((row) => row.status === "ready").length,
      blockedRows: actionRows.filter((row) => row.status === "blocked").length,
      retryableRows: retryRows.length,
      degradedRows: actionRows.filter((row) => row.status === "degraded").length,
      timelineEvents: statusEnvelope.sequence.length + analytics.timeline.length,
      historySnapshots: analytics.history.length,
      phaseCounts,
      statusCounts,
    },
    provider: {
      status: providerHandoff.providerStatus,
      serviceLevel: providerHandoff.serviceLevel,
      syncCursor: providerHandoff.syncMetadata.cursor,
      target: providerHandoff.externalHandoff.target,
      correlationId: providerHandoff.externalHandoff.correlationId,
      externalWritesAllowed: statusEnvelope.adapter.externalWritesAllowed,
      agreementId: providerServiceAgreement.agreementId,
      agreementStatus: providerServiceAgreement.status,
      agreementNextAction: providerServiceAgreement.nextAction.command,
    },
    decision: {
      accepted: decisionContract.operatorDecision.accepted,
      acceptedBy: decisionContract.operatorDecision.acceptedBy,
      acceptedAt: decisionContract.operatorDecision.acceptedAt,
      receiptId: decisionContract.receipt.id,
      nextAction: decisionContract.nextAction.command,
    },
    timeline: [
      ...analytics.timeline.map((entry) => ({
        source: "analytics",
        index: entry.index,
        at: entry.at,
        event: entry.event,
        status: entry.ready ? "ready" : "blocked",
        blockedCount: entry.blockedCount,
      })),
      ...statusEnvelope.sequence.map((entry) => ({
        source: "status-envelope",
        index: analytics.timeline.length + entry.index,
        at: entry.at,
        event: entry.event,
        status: entry.status,
        command: entry.command,
        blockedCount: entry.blockedReasons.length,
      })),
    ],
    actionRows,
    validation: {
      ready: validationBlockers.length === 0,
      restartSafe,
      externalWriteSafe: statusEnvelope.validation.externalWriteSafe,
      checkpointConsistent: statusEnvelope.validation.checkpointConsistent,
      actionLedgerReady: actionLedger.ready,
      providerAgreementReady: providerServiceAgreement.ready,
      blockedReasons: validationBlockers,
    },
  };
}

function buildPackageInstallExternalHandoffBridge(
  program,
  exportSnapshot,
  installState,
  providerHandoff,
  providerServiceAgreement,
  decisionContract,
  actionLedger,
  statusEnvelope,
  timelineReport,
  ready,
  options,
) {
  const requestedConsumer = String(options.handoffConsumer ?? "verifier-claim").trim();
  const generatedAt = String(options.bridgeGeneratedAt ?? options.generatedAt ?? "logical:6");
  const source = normalizeInstallExternalBridgeSource(options.previousExternalHandoffBridge);
  const bridgeCapabilities = uniqueSorted([
    "mailchimp:campaign.read",
    "memory:campaign.local",
    "verifier:evidence.record",
    "status:timeline.write",
    ...providerHandoff.negotiation.grantedCapabilities,
  ]);
  const requiredForVerifier = [
    "mailchimp:campaign.read",
    "memory:campaign.local",
    "verifier:evidence.record",
    "status:timeline.write",
  ];
  const missingVerifierCapabilities = requiredForVerifier.filter((capability) => (
    !bridgeCapabilities.includes(capability)
  ));
  const bridgeFingerprint = deterministicFingerprint([
    program.job.id,
    exportSnapshot.exportId,
    installState.packageRef,
    providerHandoff.syncMetadata.cursor,
    providerServiceAgreement.agreementId,
    statusEnvelope.envelopeId,
    timelineReport.reportId,
    decisionContract.receipt.id,
    actionLedger.ledgerId,
    requestedConsumer,
    ready,
  ]);
  const bridgeId = `install-external-bridge:${bridgeFingerprint}`;
  const replayKey = `${program.job.memory.namespace}:install:external-bridge:${bridgeId}`;
  const command = ready
    ? "package.install.external-handoff.commit"
    : timelineReport.restart.nextCommand ?? statusEnvelope.adapter.command ?? "package.install.review";
  const validationBlockers = uniqueSorted([
    ...(ready ? [] : ["package install external bridge requires ready contract"]),
    ...(statusEnvelope.ready ? [] : statusEnvelope.validation.blockedReasons),
    ...(timelineReport.ready ? [] : timelineReport.validation.blockedReasons),
    ...(actionLedger.ready ? [] : actionLedger.validation.blockedReasons),
    ...(providerServiceAgreement.ready ? [] : providerServiceAgreement.blockedReasons),
    ...(decisionContract.ready ? [] : decisionContract.blockedReasons),
    ...(statusEnvelope.checkpoint === exportSnapshot.exportId
      ? []
      : ["package install external bridge checkpoint mismatch"]),
    ...(timelineReport.checkpoint === exportSnapshot.exportId
      ? []
      : ["package install external bridge timeline checkpoint mismatch"]),
    ...(providerServiceAgreement.sync.checkpoint === exportSnapshot.exportId
      ? []
      : ["package install external bridge provider agreement checkpoint mismatch"]),
    ...(providerServiceAgreement.sync.cursor === providerHandoff.syncMetadata.cursor
      ? []
      : ["package install external bridge sync cursor mismatch"]),
    ...(statusEnvelope.adapter.agreementId === providerServiceAgreement.agreementId
      ? []
      : ["package install external bridge agreement mismatch"]),
    ...(statusEnvelope.replayGuard.stableAcrossRestart && timelineReport.restart.restartSafe
      ? []
      : ["package install external bridge is not restart-safe"]),
    ...(statusEnvelope.adapter.externalWritesAllowed === false
      ? []
      : ["package install external bridge forbids provider external writes"]),
    ...missingVerifierCapabilities.map((capability) => (
      `package install external bridge missing verifier capability: ${capability}`
    )),
  ]);
  const bridgeReady = validationBlockers.length === 0;
  const consumerReceipt = bridgeReady
    ? `install-bridge-receipt:${deterministicFingerprint([
      bridgeId,
      providerHandoff.syncMetadata.cursor,
      providerServiceAgreement.agreementId,
      requestedConsumer,
    ])}`
    : null;

  return {
    kind: "mailchimp.package-install.external-handoff-bridge",
    apiVersion: "aios.integration/v1",
    bridgeId,
    jobId: program.job.id,
    packageRef: installState.packageRef,
    generatedAt,
    status: bridgeReady ? "bridge_ready" : "bridge_blocked",
    ready: bridgeReady,
    consumer: {
      name: requestedConsumer,
      command: requestedConsumer === "verifier-claim"
        ? "verifier.claim.bind-provider-service"
        : "package.install.consume-external-bridge",
      receipt: consumerReceipt,
      requiredCapabilities: requiredForVerifier,
      missingCapabilities: missingVerifierCapabilities,
    },
    providerService: {
      agreementId: providerServiceAgreement.agreementId,
      status: providerServiceAgreement.status,
      serviceLevel: providerServiceAgreement.serviceLevel,
      endpointCount: providerServiceAgreement.endpoints.length,
      syncCursor: providerServiceAgreement.sync.cursor,
      checkpoint: providerServiceAgreement.sync.checkpoint,
      externalWritesAllowed: providerServiceAgreement.externalHandoff.writePolicy.externalWritesAllowed,
    },
    syncMetadata: {
      checkpoint: exportSnapshot.exportId,
      cursor: providerHandoff.syncMetadata.cursor,
      packageRef: installState.packageRef,
      providerResource: providerHandoff.syncMetadata.providerResource,
      generatedAt,
      envelopeId: statusEnvelope.envelopeId,
      timelineReportId: timelineReport.reportId,
      actionLedgerId: actionLedger.ledgerId,
    },
    replay: {
      idempotent: true,
      replayKey,
      priorBridgeId: source?.bridgeId ?? null,
      changedSincePrevious: source ? source.fingerprint !== bridgeFingerprint : true,
      stableAcrossRestart: statusEnvelope.replayGuard.stableAcrossRestart
        && timelineReport.restart.restartSafe,
      restartCommand: bridgeReady ? "package.install.external-handoff.replay" : command,
    },
    acceptance: {
      accepted: decisionContract.operatorDecision.accepted,
      acceptedBy: decisionContract.operatorDecision.acceptedBy,
      acceptedAt: decisionContract.operatorDecision.acceptedAt,
      decisionReceipt: decisionContract.receipt.id,
    },
    nextAction: {
      command: bridgeReady ? "verifier.claim.bind-provider-service" : command,
      label: bridgeReady ? "Bind verifier claim provider service" : "Resolve package install bridge",
      reason: bridgeReady
        ? "install provider service, status envelope, and timeline report are restart-safe"
        : validationBlockers[0] ?? "package install bridge requires review",
    },
    validation: {
      ready: bridgeReady,
      verifierClaimCompatible: missingVerifierCapabilities.length === 0
        && requestedConsumer === "verifier-claim",
      checkpointConsistent: statusEnvelope.checkpoint === exportSnapshot.exportId
        && timelineReport.checkpoint === exportSnapshot.exportId
        && providerServiceAgreement.sync.checkpoint === exportSnapshot.exportId,
      serviceAgreementReady: providerServiceAgreement.ready,
      statusEnvelopeReady: statusEnvelope.ready,
      timelineReportReady: timelineReport.ready,
      restartSafe: statusEnvelope.replayGuard.stableAcrossRestart
        && timelineReport.restart.restartSafe,
      externalWriteSafe: statusEnvelope.adapter.externalWritesAllowed === false
        && providerServiceAgreement.externalHandoff.writePolicy.externalWritesAllowed === false,
      blockedReasons: validationBlockers,
    },
  };
}

function buildInstallDecisionContract(
  program,
  audit,
  exportSnapshot,
  installState,
  providerHandoff,
  health,
  analytics,
  providerServiceAgreement,
  options,
) {
  const acceptancePolicy = normalizeInstallAcceptancePolicy(options.acceptancePolicy);
  const operatorDecision = normalizeInstallOperatorDecision({
    accepted: options.accepted,
    acceptedBy: options.acceptedBy,
    acceptedAt: options.acceptedAt,
    ...options.operatorDecision,
  }, acceptancePolicy);
  const validationCards = buildInstallDecisionValidationCards(
    audit,
    installState,
    providerHandoff,
    health,
    analytics,
    providerServiceAgreement,
  );
  const validationSummary = validationCards.reduce((summary, card) => {
    summary.total += 1;
    summary[card.status] = (summary[card.status] ?? 0) + 1;
    if (card.status !== "ready" && card.status !== "info") {
      summary.blocked += 1;
    }
    return summary;
  }, {
    total: 0,
    ready: 0,
    blocked: 0,
    missing: 0,
    review: 0,
    info: 0,
  });
  const acceptanceBlockedReasons = uniqueSorted([
    ...(acceptancePolicy.required && !operatorDecision.accepted
      ? ["package install operator acceptance required before provider commit"]
      : []),
    ...operatorDecision.errors,
  ]);
  const blockedReasons = uniqueSorted([
    ...installState.blockedReasons,
    ...providerHandoff.blockedReasons,
    ...providerServiceAgreement.blockedReasons,
    ...health.blockedReasons,
    ...acceptanceBlockedReasons,
    ...(validationSummary.blocked === 0 ? [] : [`${validationSummary.blocked} install validation card(s) require review`]),
  ]);
  const ready = blockedReasons.length === 0;
  const receipt = {
    id: operatorDecision.accepted
      ? `install-decision:${exportSnapshot.exportId}:${operatorDecision.acceptedBy}`
      : `install-decision:${exportSnapshot.exportId}:pending`,
    exportId: exportSnapshot.exportId,
    packageRef: installState.packageRef,
    accepted: operatorDecision.accepted,
    acceptedBy: operatorDecision.acceptedBy,
    acceptedAt: operatorDecision.acceptedAt,
    policy: acceptancePolicy.mode,
    checksum: [
      program.job.id,
      exportSnapshot.exportId,
      installState.packageRef,
      providerHandoff.syncMetadata.cursor,
      providerServiceAgreement.agreementId,
      operatorDecision.accepted ? "accepted" : "pending",
    ].join("|"),
  };
  const nextAction = ready
    ? {
      command: providerHandoff.externalHandoff.command,
      label: "Commit package install",
      reason: "operator decision, provider negotiation, and audit checkpoint are ready",
    }
    : !operatorDecision.accepted && acceptancePolicy.required
      ? {
        command: "package.install.accept-preview",
        label: "Accept package install preview",
        reason: "operator acceptance is required before provider commit",
      }
      : {
        command: providerServiceAgreement.nextAction.command
          ?? providerHandoff.nextAction
          ?? health.retryPlan.nextCommand
          ?? "package.install.review",
        label: "Resolve package install blocker",
        reason: blockedReasons[0] ?? "package install requires review",
      };

  return {
    ready,
    policy: acceptancePolicy,
    operatorDecision,
    receipt,
    preview: {
      title: `Mailchimp package install: ${installState.packageRef}`,
      packageName: program.manifest.name,
      packageVersion: program.manifest.version,
      checkpoint: exportSnapshot.exportId,
      providerStatus: providerHandoff.providerStatus,
      serviceLevel: providerHandoff.serviceLevel,
      providerAgreementId: providerServiceAgreement.agreementId,
      rows: buildInstallPreviewRows(installState, providerHandoff, providerServiceAgreement, health, analytics),
      validationCards,
      emptyState: validationCards.length === 0 ? "No install validation cards were produced" : null,
    },
    summary: {
      ready,
      packageRef: installState.packageRef,
      accepted: operatorDecision.accepted,
      acceptanceRequired: acceptancePolicy.required,
      validationCardCount: validationCards.length,
      blockedCount: blockedReasons.length,
      nextAction: nextAction.command,
      receiptId: receipt.id,
    },
    nextAction,
    validationSummary,
    blockedReasons,
  };
}

function buildInstallLifecycleControls(program, installState, health, options) {
  const enabled = Boolean(options.enabled ?? program.lifecycle.enabled);
  const dryRun = Boolean(options.dryRun ?? program.lifecycle.dryRun);
  const requireApproval = Boolean(options.requireApproval ?? program.lifecycle.requireApproval);
  const schedule = normalizeInstallSchedule(options.schedule ?? program.lifecycle.schedule);
  const requestedCommand = String(options.command ?? (
    enabled
      ? installState.ready && health.allowsCommit
        ? "package.install.commit"
        : "package.install.review"
      : "package.install.enable"
  )).trim();
  const commitWindowSeconds = normalizePositiveInteger(
    options.commitWindowSeconds ?? 1800,
    "commitWindowSeconds",
  );
  const pauseReason = options.pauseReason ? String(options.pauseReason).trim() : null;
  const approvalTicket = options.approvalTicket ? String(options.approvalTicket).trim() : "";
  const allowedCommands = enabled
    ? [
      "package.install.disable",
      "package.install.review",
      "package.install.reschedule",
      "package.install.retry",
      "package.install.accept-preview",
      "package.install.commit",
    ]
    : [
      "package.install.enable",
      "package.install.review",
    ];
  const commandAllowed = allowedCommands.includes(requestedCommand);
  const approvalSatisfied = !requireApproval || approvalTicket.length > 0;
  const paused = schedule.mode === "paused" || !enabled;
  const settingsRows = [
    {
      key: "enabled",
      value: enabled,
      valid: enabled || requestedCommand === "package.install.enable",
      command: enabled ? "package.install.disable" : "package.install.enable",
      blockedReasons: enabled ? [] : ["package install lifecycle is disabled"],
    },
    {
      key: "dryRun",
      value: dryRun,
      valid: true,
      command: dryRun ? "package.install.enable-commit" : "package.install.enable-dry-run",
      blockedReasons: [],
    },
    {
      key: "requireApproval",
      value: requireApproval,
      valid: approvalSatisfied,
      command: approvalSatisfied ? "package.install.approval-confirm" : "package.install.accept-preview",
      blockedReasons: approvalSatisfied ? [] : ["package install approval ticket is required"],
    },
    {
      key: "schedule",
      value: schedule.mode,
      valid: schedule.valid,
      command: schedule.valid ? "package.install.schedule-confirm" : "package.install.reschedule",
      blockedReasons: schedule.errors,
    },
    {
      key: "commitWindowSeconds",
      value: commitWindowSeconds,
      valid: commitWindowSeconds >= 60,
      command: "package.install.settings-review",
      blockedReasons: commitWindowSeconds >= 60
        ? []
        : ["package install commit window must be at least 60 seconds"],
    },
  ];
  const blockedReasons = uniqueSorted([
    ...settingsRows.flatMap((row) => row.blockedReasons),
    ...(commandAllowed ? [] : [`package install command not allowed in current lifecycle: ${requestedCommand}`]),
    ...(requestedCommand === "package.install.commit" && dryRun
      ? ["package install commit command cannot run while dryRun is enabled"]
      : []),
    ...(requestedCommand === "package.install.commit" && !installState.ready
      ? ["package install commit command requires install readiness"]
      : []),
    ...(requestedCommand === "package.install.commit" && !health.allowsCommit
      ? [`package install commit command blocked by health state: ${health.state}`]
      : []),
    ...(paused && requestedCommand !== "package.install.enable" && requestedCommand !== "package.install.review"
      ? ["package install lifecycle is paused"]
      : []),
    ...(pauseReason && enabled ? [`package install pause reason present while enabled: ${pauseReason}`] : []),
  ]);
  const settingsValid = settingsRows.every((row) => row.valid);
  const canCommit = blockedReasons.length === 0
    && settingsValid
    && enabled
    && !dryRun
    && approvalSatisfied
    && installState.ready
    && health.allowsCommit
    && requestedCommand === "package.install.commit";
  const nextAction = canCommit
    ? {
      command: "package.install.commit",
      label: "Commit package install",
      reason: "lifecycle settings, approval, install state, and health allow commit",
    }
    : !enabled
      ? {
        command: "package.install.enable",
        label: "Enable package install",
        reason: "install lifecycle is disabled",
      }
      : !schedule.valid || schedule.mode === "paused"
        ? {
          command: "package.install.reschedule",
          label: "Update install schedule",
          reason: schedule.errors[0] ?? "install schedule is paused",
        }
        : !approvalSatisfied
          ? {
            command: "package.install.accept-preview",
            label: "Accept package install preview",
            reason: "approval ticket is required before install commit",
          }
          : dryRun && requestedCommand === "package.install.commit"
            ? {
              command: "package.install.enable-commit",
              label: "Disable dry run before commit",
              reason: "commit command cannot run while dryRun is enabled",
            }
            : {
              command: requestedCommand === "package.install.retry"
                ? "package.install.retry"
                : "package.install.review",
              label: "Review package install",
              reason: blockedReasons[0] ?? "install lifecycle requires review",
            };
  const controlKey = `${program.job.memory.namespace}:install:lifecycle:${deterministicFingerprint([
    program.job.id,
    installState.packageRef,
    enabled,
    dryRun,
    requireApproval,
    schedule.mode,
    requestedCommand,
  ])}`;

  return {
    kind: "mailchimp.package-install.lifecycle-controls",
    apiVersion: "aios.controls/v1",
    controlKey,
    ready: blockedReasons.length === 0,
    canCommit,
    status: canCommit
      ? "commit-enabled"
      : enabled ? "review-required" : "disabled",
    requestedCommand,
    allowedCommands,
    schedule,
    settings: {
      enabled,
      dryRun,
      requireApproval,
      approvalTicket: approvalTicket || null,
      commitWindowSeconds,
      pauseReason,
      maxRuntimeSteps: program.lifecycle.maxRuntimeSteps,
      memoryMode: program.job.memory.mode,
    },
    commands: {
      enable: {
        command: "package.install.enable",
        enabled: !enabled,
        idempotent: true,
        idempotencyKey: `${controlKey}:enable`,
      },
      disable: {
        command: "package.install.disable",
        enabled,
        idempotent: true,
        idempotencyKey: `${controlKey}:disable`,
      },
      review: {
        command: "package.install.review",
        enabled: true,
        idempotent: true,
        idempotencyKey: `${controlKey}:review`,
      },
      reschedule: {
        command: "package.install.reschedule",
        enabled: !schedule.valid || schedule.mode !== "manual",
        idempotent: true,
        idempotencyKey: `${controlKey}:reschedule:${schedule.mode}`,
      },
      commit: {
        command: "package.install.commit",
        enabled: canCommit,
        idempotent: true,
        idempotencyKey: `${controlKey}:commit:${installState.checkpoint}`,
      },
    },
    rows: settingsRows,
    nextAction,
    validation: {
      ready: blockedReasons.length === 0,
      settingsValid,
      commandAllowed,
      approvalSatisfied,
      scheduleValid: schedule.valid,
      commitRequiresDryRunDisabled: requestedCommand === "package.install.commit" ? !dryRun : true,
      blockedReasons,
    },
    blockedReasons,
  };
}

function buildInstallState(program, providerContract, exportSnapshot, health, options) {
  const requested = providerContract.negotiation.requestedCapabilities;
  const granted = new Set(providerContract.negotiation.grantedCapabilities);
  const missingCapabilities = requested.filter((capability) => !granted.has(capability));
  const packageRef = String(options.packageRef ?? `${program.manifest.name}@${program.manifest.version}`);
  const approvalReady = Boolean(options.approvalTicket) || !program.lifecycle.validation.errors.some((error) => error.includes("approval"));
  const blockedReasons = uniqueSorted([
    ...missingCapabilities.map((capability) => `provider capability missing for install: ${capability}`),
    ...(approvalReady ? [] : ["approval ticket required before package install"]),
    ...(exportSnapshot.truthBoundary.readyForExport ? [] : [exportSnapshot.summary]),
    ...(health.allowsCommit ? [] : [`install health state blocks commit: ${health.state}`]),
  ]);

  return {
    ready: blockedReasons.length === 0,
    packageRef,
    approvalReady,
    requestedCapabilities: requested,
    grantedCapabilities: [...granted].sort(),
    missingCapabilities,
    checkpoint: exportSnapshot.exportId,
    retryPlan: health.retryPlan,
    actionableErrors: health.actionableErrors,
    blockedReasons,
  };
}

function buildInstallProviderHandoffState(program, providerContract, exportSnapshot, installState, health, options) {
  const providerStatus = normalizeProviderStatus(options.providerStatus ?? "connected");
  const syncMode = normalizeInstallSyncMode(options.syncMode ?? "checkpoint");
  const serviceLevel = normalizeServiceLevel(options.serviceLevel ?? "standard");
  const requestedCapabilities = uniqueSorted(providerContract.negotiation.requestedCapabilities);
  const grantedCapabilities = uniqueSorted(providerContract.negotiation.grantedCapabilities);
  const grantSet = new Set(grantedCapabilities);
  const requiredCapabilities = uniqueSorted(options.requiredProviderCapabilities ?? [
    "mailchimp:campaign.read",
    "memory:campaign.local",
    "verifier:evidence.record",
    "status:timeline.write",
  ]);
  const missingRequiredCapabilities = requiredCapabilities.filter((capability) => !grantSet.has(capability));
  const optionalCapabilities = uniqueSorted(options.optionalProviderCapabilities ?? [
    "mailchimp:campaign.write",
    "mailchimp:webhook.manage",
  ]);
  const optionalGranted = optionalCapabilities.filter((capability) => grantSet.has(capability));
  const externalHandoff = normalizeInstallExternalHandoff(options.externalHandoff);
  const syncMetadata = {
    providerResource: "package-install",
    checkpoint: exportSnapshot.exportId,
    packageRef: installState.packageRef,
    cursor: options.syncCursor ? String(options.syncCursor) : `install:${exportSnapshot.exportId}`,
    mode: syncMode,
    serviceLevel,
    generatedAt: String(options.generatedAt ?? "logical:4"),
    lastSyncedAt: options.lastSyncedAt ? String(options.lastSyncedAt) : null,
  };
  const blockedReasons = uniqueSorted([
    ...(providerStatus === "connected" ? [] : [`install provider status is ${providerStatus}`]),
    ...missingRequiredCapabilities.map((capability) => `install provider required capability missing: ${capability}`),
    ...externalHandoff.blockedReasons,
    ...(syncMode === "realtime" && !grantSet.has("status:timeline.write")
      ? ["realtime install sync requires status timeline capability"]
      : []),
    ...(serviceLevel === "strict" && health.degradedMode
      ? ["strict install service level blocks degraded health handoff"]
      : []),
  ]);
  const ready = blockedReasons.length === 0 && installState.ready && health.allowsCommit;
  const nextAction = ready
    ? externalHandoff.command
    : providerStatus === "connected"
      ? missingRequiredCapabilities.length > 0
        ? "package.install.negotiate-capabilities"
        : "package.install.review-provider"
      : "package.install.reconnect-provider";

  return {
    ready,
    providerStatus,
    serviceLevel,
    negotiation: {
      requestedCapabilities,
      grantedCapabilities,
      requiredCapabilities,
      missingRequiredCapabilities,
      optionalCapabilities,
      optionalGranted,
      fullyGranted: missingRequiredCapabilities.length === 0,
    },
    syncMetadata,
    externalHandoff: {
      ...externalHandoff,
      command: ready ? externalHandoff.command : nextAction,
      token: ready ? providerContract.handoffState.handoffToken : null,
    },
    summary: {
      ready,
      providerStatus,
      syncMode,
      serviceLevel,
      checkpoint: syncMetadata.checkpoint,
      packageRef: installState.packageRef,
      missingCapabilityCount: missingRequiredCapabilities.length,
      optionalGrantedCount: optionalGranted.length,
      nextAction,
    },
    nextAction,
    blockedReasons,
  };
}

function buildInstallProviderServiceAgreement(program, providerContract, installState, providerHandoff, health, options) {
  const defaultEndpointSpecs = [
    {
      name: "campaign-read",
      target: "mailchimp.campaign.read",
      required: true,
      capability: "mailchimp:campaign.read",
      method: "GET",
    },
    {
      name: "local-memory-checkpoint",
      target: "memory.campaign.local",
      required: true,
      capability: "memory:campaign.local",
      method: "LOCAL",
    },
    {
      name: "status-timeline",
      target: "status.timeline.write",
      required: true,
      capability: "status:timeline.write",
      method: "LOCAL",
    },
    {
      name: "verifier-evidence",
      target: "verifier.evidence.record",
      required: true,
      capability: "verifier:evidence.record",
      method: "LOCAL",
    },
  ];
  const endpointSpecs = Array.isArray(options.providerEndpoints) && options.providerEndpoints.length > 0
    ? options.providerEndpoints
    : defaultEndpointSpecs;
  const granted = new Set(providerHandoff.negotiation.grantedCapabilities);
  const endpoints = endpointSpecs.map((endpoint, index) => {
    const name = String(endpoint.name ?? `endpoint-${index + 1}`).trim();
    const capability = String(endpoint.capability ?? "").trim();
    const required = endpoint.required !== false;
    const target = String(endpoint.target ?? name).trim();
    const method = String(endpoint.method ?? "GET").trim().toUpperCase();
    const available = !capability || granted.has(capability);
    const externalWrite = Boolean(endpoint.externalWrite ?? (
      method !== "GET" && method !== "HEAD" && method !== "LOCAL"
    ));

    return {
      index,
      name,
      target,
      capability: capability || null,
      required,
      method,
      available,
      externalWrite,
      status: available && (!required || !externalWrite) ? "ready" : "blocked",
      blockedReasons: uniqueSorted([
        ...(name ? [] : ["package install provider endpoint requires a name"]),
        ...(target ? [] : [`package install provider endpoint ${name || index + 1} requires a target`]),
        ...(required && !available
          ? [`package install provider endpoint capability missing: ${capability || name}`]
          : []),
        ...(required && externalWrite
          ? [`package install provider endpoint forbids external write method: ${name}`]
          : []),
      ]),
    };
  });
  const requiredEndpoints = endpoints.filter((endpoint) => endpoint.required);
  const blockedEndpoints = endpoints.filter((endpoint) => endpoint.blockedReasons.length > 0);
  const maxSyncLagSeconds = normalizePositiveInteger(
    options.maxSyncLagSeconds ?? (providerHandoff.serviceLevel === "strict" ? 30 : 300),
    "maxSyncLagSeconds",
  );
  const heartbeatSeconds = normalizePositiveInteger(
    options.providerHeartbeatSeconds ?? Math.min(maxSyncLagSeconds, 60),
    "providerHeartbeatSeconds",
  );
  const externalWriteSafe = endpoints.every((endpoint) => !endpoint.externalWrite)
    && providerContract.sync.memoryWritePolicy !== "provider-write";
  const sync = {
    checkpoint: providerHandoff.syncMetadata.checkpoint,
    cursor: providerHandoff.syncMetadata.cursor,
    mode: providerHandoff.syncMetadata.mode,
    packageRef: providerHandoff.syncMetadata.packageRef,
    generatedAt: providerHandoff.syncMetadata.generatedAt,
    lastSyncedAt: providerHandoff.syncMetadata.lastSyncedAt,
    maxLagSeconds: maxSyncLagSeconds,
    heartbeatSeconds,
    replayKey: `${program.job.memory.namespace}:install:provider-agreement:${providerHandoff.syncMetadata.cursor}`,
  };
  const capabilitySummary = {
    requested: providerHandoff.negotiation.requestedCapabilities,
    granted: providerHandoff.negotiation.grantedCapabilities,
    required: providerHandoff.negotiation.requiredCapabilities,
    missingRequired: providerHandoff.negotiation.missingRequiredCapabilities,
    optionalGranted: providerHandoff.negotiation.optionalGranted,
    endpointCoverage: {
      required: requiredEndpoints.length,
      ready: requiredEndpoints.filter((endpoint) => endpoint.status === "ready").length,
      blocked: blockedEndpoints.length,
    },
  };
  const blockedReasons = uniqueSorted([
    ...providerHandoff.blockedReasons,
    ...blockedEndpoints.flatMap((endpoint) => endpoint.blockedReasons),
    ...(externalWriteSafe ? [] : ["package install provider service agreement requires local-only write policy"]),
    ...(sync.packageRef === installState.packageRef ? [] : ["package install provider service agreement package mismatch"]),
    ...(sync.checkpoint === installState.checkpoint ? [] : ["package install provider service agreement checkpoint mismatch"]),
    ...(heartbeatSeconds <= maxSyncLagSeconds
      ? []
      : ["package install provider heartbeat cannot exceed max sync lag"]),
    ...(providerHandoff.serviceLevel === "strict" && health.degradedMode
      ? ["strict package install provider service agreement blocks degraded health"]
      : []),
  ]);
  const ready = blockedReasons.length === 0 && providerHandoff.ready && installState.ready;
  const status = ready
    ? "agreement_ready"
    : providerHandoff.providerStatus === "offline"
      ? "provider_offline"
      : blockedEndpoints.length > 0
        ? "endpoint_review_required"
        : "agreement_review_required";
  const nextAction = ready
    ? {
      command: providerHandoff.externalHandoff.command,
      label: "Commit provider agreement",
      reason: "provider capabilities, endpoint contract, and local-only policy are ready",
    }
    : providerHandoff.providerStatus === "offline"
      ? {
        command: "package.install.reconnect-provider",
        label: "Reconnect provider",
        reason: "Mailchimp provider is offline",
      }
      : blockedEndpoints.length > 0
        ? {
          command: "package.install.negotiate-provider-agreement",
          label: "Negotiate provider service agreement",
          reason: blockedEndpoints[0].blockedReasons[0],
        }
        : {
          command: providerHandoff.nextAction ?? "package.install.review-provider",
          label: "Review provider service agreement",
          reason: blockedReasons[0] ?? "provider service agreement requires review",
        };
  const agreementId = `install-provider-agreement:${deterministicFingerprint([
    program.job.id,
    installState.packageRef,
    sync.checkpoint,
    sync.cursor,
    providerHandoff.serviceLevel,
    endpoints.map((endpoint) => `${endpoint.name}:${endpoint.status}:${endpoint.method}`).join(","),
  ])}`;

  return {
    kind: "mailchimp.package-install.provider-service-agreement",
    apiVersion: "aios.integration/v1",
    agreementId,
    jobId: program.job.id,
    packageRef: installState.packageRef,
    provider: providerContract.provider,
    serviceLevel: providerHandoff.serviceLevel,
    status,
    ready,
    retryable: providerHandoff.providerStatus !== "offline" && !ready,
    sync,
    capabilitySummary,
    endpoints,
    externalHandoff: {
      target: providerHandoff.externalHandoff.target,
      command: ready ? providerHandoff.externalHandoff.command : nextAction.command,
      correlationId: providerHandoff.externalHandoff.correlationId,
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
      writePolicy: {
        externalWritesAllowed: false,
        memoryWritePolicy: providerContract.sync.memoryWritePolicy,
      },
    },
    nextAction,
    summary: {
      agreementId,
      ready,
      status,
      serviceLevel: providerHandoff.serviceLevel,
      endpointCount: endpoints.length,
      requiredEndpointCount: requiredEndpoints.length,
      blockedEndpointCount: blockedEndpoints.length,
      missingCapabilityCount: capabilitySummary.missingRequired.length,
      syncCursor: sync.cursor,
      nextAction: nextAction.command,
    },
    validation: {
      ready: blockedReasons.length === 0,
      externalWriteSafe,
      endpointContractReady: blockedEndpoints.length === 0,
      capabilityCoverageReady: capabilitySummary.missingRequired.length === 0,
      syncCheckpointMatches: sync.checkpoint === installState.checkpoint,
      packageMatches: sync.packageRef === installState.packageRef,
      heartbeatWithinLag: heartbeatSeconds <= maxSyncLagSeconds,
      blockedReasons,
    },
    blockedReasons,
  };
}

function buildInstallOperationalHealth(program, audit, options) {
  const state = normalizeHealthState(options.healthState ?? options.adapterHealth ?? "healthy");
  const retryCount = normalizeNonNegativeInteger(options.retryCount ?? options.attempt ?? 0, "retryCount");
  const maxRetries = normalizeNonNegativeInteger(options.maxRetries ?? 2, "maxRetries");
  const retryAfterSeconds = normalizePositiveInteger(options.retryAfterSeconds ?? options.adapterRetryAfterSeconds ?? 30, "retryAfterSeconds");
  const failureCode = options.failureCode ? String(options.failureCode).trim() : null;
  const degradedMode = state === "degraded";
  const terminalFailure = state === "failed" || state === "offline";
  const retryable = !terminalFailure && state !== "healthy" && retryCount < maxRetries;
  const observedErrors = uniqueSorted([
    ...(audit.evidence.missing.length === 0 ? [] : ["install evidence incomplete"]),
    ...(audit.boundary.externalWritesObserved.length === 0 ? [] : ["install boundary violation observed"]),
    ...(failureCode ? [`provider error ${failureCode}`] : []),
  ]);
  const actionableErrors = observedErrors.map((message) => ({
    code: message.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, ""),
    message,
    action: message.includes("boundary")
      ? "package.install.audit-boundary"
      : message.includes("evidence")
        ? "package.install.collect-evidence"
        : "package.install.retry-provider",
  }));
  const blockedReasons = uniqueSorted([
    ...(state === "healthy" || degradedMode ? [] : [`install operational health is ${state}`]),
    ...(retryCount <= maxRetries ? [] : [`install retry count ${retryCount} exceeds max ${maxRetries}`]),
    ...(terminalFailure ? ["install is in a terminal failure state"] : []),
  ]);

  return {
    ready: blockedReasons.length === 0,
    state,
    degradedMode,
    allowsCommit: state === "healthy",
    retryable,
    retryPlan: {
      retryCount,
      maxRetries,
      retryAfterSeconds: retryable ? retryAfterSeconds * Math.max(1, retryCount + 1) : null,
      nextCommand: retryable ? "package.install.retry" : degradedMode ? "package.install.degraded-review" : null,
    },
    failure: {
      failed: terminalFailure,
      code: failureCode,
      observedErrors,
    },
    actionableErrors,
    blockedReasons,
  };
}

function buildPackageInstallAnalytics(program, audit, exportSnapshot, installState, health, options) {
  const history = normalizeInstallHistory(options.history);
  const currentSnapshot = {
    at: String(options.generatedAt ?? "logical:4"),
    jobId: program.job.id,
    packageRef: installState.packageRef,
    state: health.state,
    ready: installState.ready && health.ready,
    degradedMode: health.degradedMode,
    retryCount: health.retryPlan.retryCount,
    blockedCount: installState.blockedReasons.length + health.blockedReasons.length,
    evidencePresent: getAcceptedEvidence(audit).length,
    evidenceMissing: audit.evidence.missing.length,
    externalWrites: audit.boundary.externalWritesObserved.length,
    missingCapabilities: installState.missingCapabilities.length,
    blockedReasons: uniqueSorted([
      ...installState.blockedReasons,
      ...health.blockedReasons,
    ]),
  };
  const snapshots = [...history, currentSnapshot].slice(-12);
  const readinessTrend = snapshots.length < 2
    ? "new"
    : snapshots[snapshots.length - 1].ready === snapshots[snapshots.length - 2].ready
      ? "unchanged"
      : snapshots[snapshots.length - 1].ready
        ? "recovered"
        : "regressed";
  const capabilityDebt = snapshots.reduce((total, snapshot) => total + snapshot.missingCapabilities, 0);
  const blockedReasons = uniqueSorted(snapshots.flatMap((snapshot) => snapshot.blockedReasons));
  const timeline = snapshots.map((snapshot, index) => ({
    index,
    at: snapshot.at,
    state: snapshot.state,
    ready: snapshot.ready,
    event: snapshot.ready
      ? "install-ready"
      : snapshot.degradedMode
        ? "install-degraded"
        : "install-blocked",
    blockedCount: snapshot.blockedCount,
  }));

  return {
    counters: {
      snapshots: snapshots.length,
      readySnapshots: snapshots.filter((snapshot) => snapshot.ready).length,
      degradedSnapshots: snapshots.filter((snapshot) => snapshot.degradedMode).length,
      blockedSnapshots: snapshots.filter((snapshot) => !snapshot.ready).length,
      retryAttempts: snapshots.reduce((total, snapshot) => total + snapshot.retryCount, 0),
      evidencePresent: currentSnapshot.evidencePresent,
      evidenceMissing: currentSnapshot.evidenceMissing,
      externalWrites: currentSnapshot.externalWrites,
      capabilityDebt,
      stateCounts: countBy(snapshots, "state"),
    },
    history: snapshots,
    timeline,
    exportSummary: {
      reportId: `install-report:${exportSnapshot.exportId}`,
      exportId: exportSnapshot.exportId,
      format: exportSnapshot.format,
      ready: currentSnapshot.ready && exportSnapshot.truthBoundary.readyForExport,
      trend: readinessTrend,
      headline: currentSnapshot.ready
        ? "package install is ready to commit"
        : `package install requires review: ${blockedReasons[0] ?? "unknown blocker"}`,
      latestBlockedReasons: blockedReasons,
      nextReportAction: currentSnapshot.ready
        ? "package.install.commit"
        : health.retryPlan.nextCommand ?? "package.install.report-review",
    },
  };
}

function buildInstallNextSteps(contract, packageReadiness) {
  if (contract.runtimeHandoff.ready && packageReadiness.readiness.ready) {
    return [{
      action: contract.decisionContract.nextAction.command,
      label: contract.decisionContract.nextAction.label,
      reason: contract.decisionContract.nextAction.reason,
    }];
  }
  return uniqueSorted([
    ...contract.runtimeHandoff.blockedReasons,
    ...packageReadiness.acceptance.blockedReasons,
  ]).map((reason) => ({
    action: reason.includes("acceptance")
      ? "package.install.accept-preview"
      : reason.includes("lifecycle") || reason.includes("schedule") || reason.includes("dryRun") || reason.includes("command not allowed")
      ? contract.lifecycleControls.nextAction.command
      : reason.includes("health") || reason.includes("terminal") || reason.includes("retry")
      ? contract.health.retryPlan.nextCommand ?? "package.install.health-review"
      : contract.decisionContract.nextAction.command,
    label: reason.includes("acceptance")
      ? "Accept package install preview"
      : reason.includes("lifecycle") || reason.includes("schedule") || reason.includes("dryRun") || reason.includes("command not allowed")
      ? contract.lifecycleControls.nextAction.label
      : reason.includes("health") || reason.includes("terminal") || reason.includes("retry")
      ? "Resolve package install health blocker"
      : "Resolve package install blocker",
    reason,
  }));
}

function buildInstallDecisionValidationCards(
  audit,
  installState,
  providerHandoff,
  health,
  analytics,
  providerServiceAgreement,
) {
  return [
    {
      key: "manifest",
      label: "Package manifest",
      status: installState.ready ? "ready" : "blocked",
      detail: installState.ready
        ? `${installState.packageRef} is ready for install`
        : installState.blockedReasons[0] ?? "Package manifest requires review",
    },
    {
      key: "provider-capabilities",
      label: "Provider capabilities",
      status: providerHandoff.negotiation.fullyGranted ? "ready" : "missing",
      detail: providerHandoff.negotiation.fullyGranted
        ? `${providerHandoff.negotiation.grantedCapabilities.length} Mailchimp capability grant(s) available`
        : `Missing provider capability: ${providerHandoff.negotiation.missingRequiredCapabilities[0]}`,
    },
    {
      key: "provider-service-agreement",
      label: "Provider service agreement",
      status: providerServiceAgreement.ready ? "ready" : "blocked",
      detail: providerServiceAgreement.ready
        ? `${providerServiceAgreement.summary.requiredEndpointCount} required endpoint contract(s) are ready`
        : providerServiceAgreement.validation.blockedReasons[0] ?? "Provider service agreement requires review",
    },
    {
      key: "truth-boundary",
      label: "Truth boundary",
      status: audit.boundary.externalWritesObserved.length === 0 ? "ready" : "blocked",
      detail: audit.boundary.externalWritesObserved.length === 0
        ? "No external write violations observed"
        : `${audit.boundary.externalWritesObserved.length} external write violation(s) observed`,
    },
    {
      key: "health",
      label: "Install health",
      status: health.allowsCommit ? "ready" : health.degradedMode ? "review" : "blocked",
      detail: health.allowsCommit
        ? "Install health allows provider commit"
        : health.failure.observedErrors[0] ?? `Install health is ${health.state}`,
    },
    {
      key: "analytics",
      label: "Readiness trend",
      status: analytics.exportSummary.ready ? "ready" : "review",
      detail: analytics.exportSummary.headline,
    },
  ];
}

function buildInstallPreviewRows(installState, providerHandoff, providerServiceAgreement, health, analytics) {
  return [
    {
      id: "package",
      label: "Package",
      value: installState.packageRef,
      severity: installState.ready ? "ready" : "blocked",
    },
    {
      id: "provider",
      label: "Mailchimp provider",
      value: providerHandoff.providerStatus,
      severity: providerHandoff.ready ? "ready" : "review",
    },
    {
      id: "provider-agreement",
      label: "Provider agreement",
      value: providerServiceAgreement.status,
      severity: providerServiceAgreement.ready ? "ready" : "blocked",
    },
    {
      id: "checkpoint",
      label: "Checkpoint",
      value: providerHandoff.syncMetadata.checkpoint,
      severity: providerHandoff.syncMetadata.cursor ? "ready" : "review",
    },
    {
      id: "health",
      label: "Health",
      value: health.state,
      severity: health.allowsCommit ? "ready" : health.degradedMode ? "review" : "blocked",
    },
    {
      id: "trend",
      label: "Trend",
      value: analytics.exportSummary.trend,
      severity: analytics.exportSummary.ready ? "ready" : "review",
    },
  ];
}

function validateExports(exportsMap = {}) {
  const names = Object.keys(exportsMap).sort();
  const missing = REQUIRED_EXPORTS.filter((name) => !names.includes(name));
  return { names, required: REQUIRED_EXPORTS, missing, valid: missing.length === 0 };
}

function normalizeInstallStatusEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    return null;
  }
  return {
    envelopeId: envelope.envelopeId ? String(envelope.envelopeId) : null,
    fingerprint: envelope.envelopeId
      ? String(envelope.envelopeId).replace(/^install-status:/, "")
      : String(envelope.fingerprint ?? ""),
    status: envelope.status ? String(envelope.status) : "unknown",
    revision: Number(envelope.revision ?? 0),
  };
}

function normalizeInstallExternalBridgeSource(bridge) {
  if (!bridge || typeof bridge !== "object") {
    return null;
  }
  return {
    bridgeId: bridge.bridgeId ? String(bridge.bridgeId) : null,
    fingerprint: bridge.bridgeId
      ? String(bridge.bridgeId).replace(/^install-external-bridge:/, "")
      : String(bridge.fingerprint ?? ""),
    status: bridge.status ? String(bridge.status) : "unknown",
    ready: Boolean(bridge.ready),
  };
}

function normalizeInstallTimelineReport(report) {
  if (!report || typeof report !== "object") {
    return null;
  }
  return {
    reportId: report.reportId ? String(report.reportId) : null,
    fingerprint: report.reportId
      ? String(report.reportId).replace(/^install-timeline:/, "")
      : String(report.fingerprint ?? ""),
    status: report.status ? String(report.status) : "unknown",
  };
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

function deterministicFingerprint(parts) {
  return parts
    .map((part) => String(part ?? "null").replaceAll("|", "%7C"))
    .join("|");
}

function normalizeHealthState(value) {
  const state = String(value ?? "healthy").trim().toLowerCase();
  if (!["healthy", "degraded", "failed", "offline"].includes(state)) {
    throw new Error(`unsupported install health state: ${value}`);
  }
  return state;
}

function normalizeProviderStatus(value) {
  const status = String(value ?? "connected").trim().toLowerCase();
  if (!["connected", "degraded", "offline"].includes(status)) {
    throw new Error(`unsupported install provider status: ${value}`);
  }
  return status;
}

function normalizeInstallSyncMode(value) {
  const mode = String(value ?? "checkpoint").trim().toLowerCase();
  if (!["checkpoint", "incremental", "realtime"].includes(mode)) {
    throw new Error(`unsupported install sync mode: ${value}`);
  }
  return mode;
}

function normalizeInstallSchedule(schedule = { mode: "manual" }) {
  const mode = String(schedule.mode ?? "manual").trim().toLowerCase();
  const errors = [];
  if (!["manual", "interval", "cron", "paused"].includes(mode)) {
    errors.push(`unsupported install schedule mode: ${mode}`);
  }
  if (mode === "interval") {
    const everyMinutes = Number(schedule.everyMinutes ?? schedule.everySeconds / 60);
    if (!Number.isInteger(everyMinutes) || everyMinutes < 5) {
      errors.push("install interval schedule requires everyMinutes >= 5");
    }
    return {
      valid: errors.length === 0,
      mode,
      everyMinutes: Number.isInteger(everyMinutes) ? everyMinutes : null,
      nextRunAt: schedule.nextRunAt ? String(schedule.nextRunAt) : null,
      errors,
    };
  }
  if (mode === "cron") {
    const expression = String(schedule.expression ?? "").trim();
    if (expression.split(/\s+/).filter(Boolean).length < 5) {
      errors.push("install cron schedule requires a cron expression");
    }
    return {
      valid: errors.length === 0,
      mode,
      expression: expression || null,
      nextRunAt: schedule.nextRunAt ? String(schedule.nextRunAt) : null,
      errors,
    };
  }
  if (mode === "paused") {
    return {
      valid: errors.length === 0,
      mode,
      reason: schedule.reason ? String(schedule.reason) : "operator-paused",
      nextRunAt: null,
      errors,
    };
  }
  return {
    valid: errors.length === 0,
    mode: "manual",
    nextRunAt: null,
    errors,
  };
}

function normalizeServiceLevel(value) {
  const level = String(value ?? "standard").trim().toLowerCase();
  if (!["standard", "strict"].includes(level)) {
    throw new Error(`unsupported install service level: ${value}`);
  }
  return level;
}

function normalizeInstallExternalHandoff(handoff = {}) {
  const command = String(handoff.command ?? "package.install.commit").trim();
  const target = String(handoff.target ?? "mailchimp.package-install").trim();
  const blockedReasons = uniqueSorted([
    ...(command ? [] : ["install provider handoff command is required"]),
    ...(target ? [] : ["install provider handoff target is required"]),
  ]);
  return {
    command,
    target,
    correlationId: handoff.correlationId ? String(handoff.correlationId) : "install-handoff:local",
    acceptedBy: handoff.acceptedBy ? String(handoff.acceptedBy) : null,
    blockedReasons,
  };
}

function normalizeInstallAcceptancePolicy(policy = {}) {
  const mode = String(policy.mode ?? "operator").trim().toLowerCase();
  if (!["operator", "auto", "external"].includes(mode)) {
    throw new Error(`unsupported install acceptance policy: ${policy.mode}`);
  }
  return {
    mode,
    required: mode !== "auto",
    approverRole: String(policy.approverRole ?? "mailchimp.operator"),
    expiresAt: policy.expiresAt ? String(policy.expiresAt) : null,
  };
}

function normalizeInstallOperatorDecision(decision = {}, policy) {
  const accepted = policy.required ? Boolean(decision.accepted ?? false) : true;
  const acceptedBy = accepted ? String(decision.acceptedBy ?? "operator") : null;
  const acceptedAt = accepted ? String(decision.acceptedAt ?? "logical:install-acceptance") : null;
  const errors = uniqueSorted([
    ...(accepted && policy.required && !acceptedBy ? ["package install acceptance actor is required"] : []),
    ...(decision.rejectedReason ? [`package install rejected: ${decision.rejectedReason}`] : []),
  ]);
  return {
    accepted,
    acceptedBy,
    acceptedAt,
    note: decision.note ? String(decision.note) : null,
    errors,
  };
}

function normalizeNonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return number;
}

function normalizePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}

function normalizeInstallHistory(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.map((snapshot, index) => ({
    at: String(snapshot.at ?? `history:${index}`),
    jobId: String(snapshot.jobId ?? "unknown"),
    packageRef: String(snapshot.packageRef ?? "unknown"),
    state: String(snapshot.state ?? "unknown"),
    ready: Boolean(snapshot.ready),
    degradedMode: Boolean(snapshot.degradedMode),
    retryCount: Number(snapshot.retryCount ?? 0),
    blockedCount: Number(snapshot.blockedCount ?? 0),
    evidencePresent: Number(snapshot.evidencePresent ?? 0),
    evidenceMissing: Number(snapshot.evidenceMissing ?? 0),
    externalWrites: Number(snapshot.externalWrites ?? 0),
    missingCapabilities: Number(snapshot.missingCapabilities ?? 0),
    blockedReasons: uniqueSorted(snapshot.blockedReasons ?? []),
  }));
}

function countBy(values, key) {
  return values.reduce((counts, value) => {
    const name = String(value[key] ?? "unknown");
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});
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
