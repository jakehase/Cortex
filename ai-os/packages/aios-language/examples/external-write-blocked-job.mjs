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

export const externalWriteBlockedJobSource = `# deterministic Mailchimp external write block
use mailchimp:campaign.read
use memory:campaign.local
use verifier:evidence.record
use rollback:snapshot.create
use status:timeline.write
recover rollback=snapshot retry=2
step load-campaign-draft input=campaignId output=draft verify.intent=read-only
step detect-external-write input=draft output=writeIntent verify.boundary=no-external-write
step quarantine-write-intent input=writeIntent output=quarantineReceipt verify.intent=blocked
step emit-blocked-status input=quarantineReceipt output=statusEvent verify.status=adapter-handoff
`;

export function buildExternalWriteBlockedProgram(options = {}) {
  return compilePackageSource(externalWriteBlockedJobSource, {
    name: options.name ?? "mailchimp-external-write-blocked-job",
    version: options.version ?? "0.1.0",
    description: "Compile a Mailchimp job that blocks outbound writes and converts them into local recovery status.",
    capabilities: options.capabilities ?? [],
    exports: {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      writeBlock: "./examples/external-write-blocked-job.mjs#buildExternalWriteBlockedContract",
      recoveryStatus: "./examples/external-write-blocked-job.mjs#buildExternalWriteBlockedRecoveryStatus",
    },
  }, {
    name: "mailchimp-external-write-blocked-job",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: options.dryRun ?? true,
      requireApproval: options.requireApproval ?? true,
      approvalTicket: options.approvalTicket,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 10,
    },
  });
}

export function buildExternalWriteBlockedAudit(
  program = buildExternalWriteBlockedProgram(),
  options = {},
) {
  const missingSubjects = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missingSubjects.has(subject))
    .map((subject) => createEvidence(
      subject.includes("verify.boundary") ? "operator-attestation" : "runtime-local-receipt",
      subject,
      { example: "external-write-blocked-job", externalWriteBlocked: true },
    ));

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "verifying",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "external write boundary queued" }),
      createStatusEvent("running", { at: "logical:1", message: "write intent detected locally" }),
      createStatusEvent("verifying", { at: "logical:2", message: "write intent quarantined" }),
      createStatusEvent(options.status ?? "verifying", {
        at: "logical:3",
        message: "blocked write handoff shaped",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildExternalWriteBlockedContract(
  program = buildExternalWriteBlockedProgram(),
  audit = buildExternalWriteBlockedAudit(program),
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
    providerResource: "campaign-draft",
    supportedCapabilities: options.supportedCapabilities,
  });
  const rollbackContract = buildRollbackContract(withRollbackVerifierHints(program), audit, {
    adapterStatus: options.adapterHealth,
    adapterCheckedAt: options.adapterCheckedAt ?? "logical:5",
    commandStatuses: options.commandStatuses,
    completedSteps: options.completedSteps ?? 3,
    failedStep: options.failedStep,
    retryAfterSeconds: options.adapterRetryAfterSeconds,
  });
  const recoveryStatus = buildRecoveryStatusHandoff(rollbackContract, {
    accepted: options.accepted ?? false,
  });
  const acceptance = buildBlockedWriteAcceptance(program, audit, exportSnapshot, recoveryStatus, options);
  const clientState = buildBlockedWriteClientState(program, audit, acceptance, recoveryStatus, options);
  const boundary = buildBlockedWriteTenantBoundary(
    program,
    audit,
    acceptance,
    clientState,
    recoveryStatus,
    options,
  );
  const continuity = buildBlockedWriteContinuityPacket(
    program,
    audit,
    acceptance,
    clientState,
    recoveryStatus,
    options,
  );
  const operationalHealth = buildBlockedWriteOperationalHealth(
    program,
    audit,
    acceptance,
    clientState,
    boundary,
    continuity,
    recoveryStatus,
    options,
  );
  const reportingState = buildBlockedWriteReportingState(
    program,
    audit,
    exportSnapshot,
    acceptance,
    clientState,
    boundary,
    continuity,
    operationalHealth,
    recoveryStatus,
    options,
  );
  const lifecycleControls = buildBlockedWriteLifecycleControls(
    program,
    audit,
    acceptance,
    clientState,
    boundary,
    continuity,
    operationalHealth,
    reportingState,
    recoveryStatus,
    options,
  );
  const providerHandoff = buildBlockedWriteProviderHandoff(
    program,
    audit,
    providerContract,
    acceptance,
    clientState,
    boundary,
    continuity,
    operationalHealth,
    reportingState,
    lifecycleControls,
    recoveryStatus,
    options,
  );
  const reviewManifest = buildBlockedWriteReviewManifest(
    program,
    audit,
    exportSnapshot,
    acceptance,
    clientState,
    boundary,
    continuity,
    operationalHealth,
    reportingState,
    lifecycleControls,
    providerHandoff,
    recoveryStatus,
    options,
  );
  const clientCommandEnvelope = buildBlockedWriteClientCommandEnvelope(
    program,
    audit,
    acceptance,
    clientState,
    boundary,
    continuity,
    operationalHealth,
    reportingState,
    lifecycleControls,
    providerHandoff,
    reviewManifest,
    recoveryStatus,
    options,
  );
  const externalWriteViolations = audit.boundary.externalWritesObserved.length;
  const blockedReasons = uniqueSorted([
    ...audit.evidence.missing.map((subject) => `missing write-block evidence: ${subject}`),
    ...providerContract.handoffState.blockedReasons,
    ...recoveryStatus.blockedReasons,
    ...acceptance.validation.blockers,
    ...clientState.validation.blockers,
    ...boundary.validation.blockers,
    ...continuity.validation.blockers,
    ...operationalHealth.validation.blockers,
    ...lifecycleControls.validation.blockers,
    ...providerHandoff.validation.blockers,
    ...reviewManifest.validation.blockers,
    ...(externalWriteViolations > 0
      ? [`${externalWriteViolations} external write attempt(s) observed after block`]
      : []),
  ]);
  const ready = blockedReasons.length === 0
    && exportSnapshot.truthBoundary.readyForExport
    && acceptance.validation.ready
    && clientState.validation.ready
    && operationalHealth.validation.ready
    && lifecycleControls.validation.ready
    && providerHandoff.validation.ready
    && reviewManifest.validation.ready;

  return {
    kind: "mailchimp.external-write-blocked.contract",
    apiVersion: "aios.example/v1",
    jobId: program.job.id,
    status: audit.status,
    writeBoundary: {
      externalWritesAllowed: false,
      observedViolations: externalWriteViolations,
      quarantineKey: `${program.job.memory.namespace}:quarantine:${exportSnapshot.exportId}`,
      blockedOutputs: program.job.plan
        .filter((step) => step.op.includes("quarantine") || step.op.includes("blocked"))
        .map((step) => step.output),
    },
    acceptance,
    clientState,
    boundary,
    continuity,
    operationalHealth,
    reportingState,
    lifecycleControls,
    providerHandoff,
    reviewManifest,
    clientCommandEnvelope,
    providerContract,
    rollback: {
      contract: rollbackContract,
      summary: summarizeRollbackContract(rollbackContract),
      statusHandoff: recoveryStatus,
    },
    exportSnapshot,
    readiness: {
      ready,
      nextAction: ready ? "handoff-blocked-write-status" : "resolve-write-boundary-blockers",
      blockedReasons,
    },
    runtimeHandoff: {
      ready,
      command: ready ? "external-write.blocked.handoff" : "external-write.blocked.review",
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
      restartToken: recoveryStatus.restartToken,
      previewToken: acceptance.preview.previewToken,
      clientRequestId: clientState.request.requestId,
      tenantScope: boundary.scope,
      auditHandoff: boundary.auditHandoff,
      continuityKey: continuity.continuityKey,
      persistedStatus: continuity.persistedState.status,
      health: operationalHealth.health,
      retryPlan: operationalHealth.retryPlan,
      exportReportId: reportingState.exportReadySummary.reportId,
      lifecycleState: lifecycleControls.state.status,
      lifecycleAction: lifecycleControls.nextAction.command,
      providerHandoffKey: providerHandoff.handoffKey,
      providerHandoffStatus: providerHandoff.state.status,
      providerSyncCommand: providerHandoff.commands.sync.command,
      providerAckCommand: providerHandoff.commands.ack.command,
      reviewManifestKey: reviewManifest.manifestKey,
      reviewSurface: reviewManifest.surface.name,
      reviewPrimaryCommand: reviewManifest.commands.primary.command,
      reviewReadinessSummary: reviewManifest.readiness.summary,
      commandEnvelopeKey: clientCommandEnvelope.envelopeKey,
      commandEnvelopeFingerprint: clientCommandEnvelope.fingerprint,
      commandEnvelopePrimary: clientCommandEnvelope.commands.primary.command,
      commandEnvelopePhase: clientCommandEnvelope.status.phase,
      commandEnvelopeReplaySafe: clientCommandEnvelope.replayGuard.safeToReplay,
      timelineEvent: reportingState.timeline.currentEvent,
      degradedMode: operationalHealth.degradedMode,
      visibleState: clientState.visibleState,
      nextSteps: acceptance.nextSteps,
    },
  };
}

export function buildExternalWriteBlockedRecoveryStatus(options = {}) {
  const program = options.program ?? buildExternalWriteBlockedProgram(options);
  const audit = options.audit ?? buildExternalWriteBlockedAudit(program, options);
  const contract = buildExternalWriteBlockedContract(program, audit, options);

  return {
    kind: "mailchimp.external-write-blocked.recovery-status",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready: contract.readiness.ready,
    statusEvent: contract.rollback.statusHandoff.statusEvent,
    runtimeCommand: contract.runtimeHandoff.command,
    truthBoundary: contract.rollback.statusHandoff.truthBoundary,
    quarantineKey: contract.writeBoundary.quarantineKey,
    preview: contract.acceptance.preview,
    clientState: contract.clientState,
    boundary: contract.boundary,
    continuity: contract.continuity,
    operationalHealth: contract.operationalHealth,
    reportingState: contract.reportingState,
    lifecycleControls: contract.lifecycleControls,
    providerHandoff: contract.providerHandoff,
    reviewManifest: contract.reviewManifest,
    clientCommandEnvelope: contract.clientCommandEnvelope,
    nextSteps: contract.acceptance.nextSteps,
    blockedReasons: contract.readiness.blockedReasons,
  };
}

export function describeExternalWriteBlockedJob(options = {}) {
  const program = buildExternalWriteBlockedProgram(options);
  const audit = buildExternalWriteBlockedAudit(program, options);
  const contract = buildExternalWriteBlockedContract(program, audit, options);

  return {
    jobId: program.job.id,
    package: program.manifest.name,
    status: audit.status,
    writeBoundary: contract.writeBoundary,
    acceptance: contract.acceptance,
    clientState: contract.clientState,
    boundary: contract.boundary,
    continuity: contract.continuity,
    operationalHealth: contract.operationalHealth,
    reportingState: contract.reportingState,
    lifecycleControls: contract.lifecycleControls,
    providerHandoff: contract.providerHandoff,
    reviewManifest: contract.reviewManifest,
    clientCommandEnvelope: contract.clientCommandEnvelope,
    readiness: contract.readiness,
    runtimeHandoff: contract.runtimeHandoff,
  };
}

export function selfCheckExternalWriteBlockedContract(options = {}) {
  const contract = buildExternalWriteBlockedContract(
    buildExternalWriteBlockedProgram(options),
    undefined,
    options,
  );

  return {
    ok: contract.writeBoundary.externalWritesAllowed === false
      && contract.writeBoundary.quarantineKey.includes(":quarantine:")
      && contract.acceptance.preview.actions.length > 0
      && contract.clientState.request.intent === "review-blocked-mailchimp-write"
      && contract.boundary.permissions.externalWritesAllowed === false
      && contract.boundary.validation.tenantIsolated === true
      && contract.continuity.commands.keepBlocked.idempotent === true
      && contract.operationalHealth.actionableErrors.every((error) => error.action)
      && contract.operationalHealth.retryPlan.commands.retry.idempotent === true
      && contract.reportingState.exportReadySummary.timeline.length > 0
      && contract.lifecycleControls.commands.keepBlocked.idempotent === true
      && contract.lifecycleControls.settings.externalWritesAllowed === false
      && contract.reportingState.counters.totalQuarantinedSubjects >= contract.clientState.visibleState.quarantineItems.length
      && contract.providerHandoff.commands.sync.idempotent === true
      && contract.providerHandoff.capabilityNegotiation.externalWritesAllowed === false
      && contract.reviewManifest.commands.primary.idempotent === true
      && contract.reviewManifest.readiness.externalWritesAllowed === false
      && contract.clientCommandEnvelope.commands.primary.idempotent === true
      && contract.clientCommandEnvelope.validation.externalWritesAllowed === false,
    jobId: contract.jobId,
    checked: ["compile", "truth-boundary", "quarantine", "adapter-handoff", "preview-acceptance", "client-state", "tenant-boundary", "continuity", "operational-health", "reporting-state", "lifecycle-controls", "provider-handoff", "review-manifest", "client-command-envelope"],
    blockedReasons: contract.readiness.blockedReasons,
  };
}

function buildBlockedWriteAcceptance(program, audit, exportSnapshot, recoveryStatus, options) {
  const observedWrites = audit.boundary.externalWritesObserved.map((write, index) => ({
    index,
    subject: String(write.subject ?? write),
    blocked: true,
    visibleMessage: "Mailchimp write was quarantined locally and was not sent.",
  }));
  const previewToken = options.previewToken
    ?? `${program.job.id}:blocked-write-preview:${exportSnapshot.exportId}`;
  const accepted = options.accepted === true;
  const operator = options.operator ?? "local-operator";
  const validationBlockers = uniqueSorted([
    ...(observedWrites.length > 0 ? ["blocked write preview contains observed external write attempts"] : []),
    ...(audit.evidence.missing.length > 0 ? ["preview cannot be accepted until write-block evidence is complete"] : []),
    ...(recoveryStatus.ready ? [] : ["recovery handoff must be ready before acceptance"]),
    ...(accepted ? [] : ["operator acceptance is required for blocked write handoff"]),
  ]);
  const nextSteps = validationBlockers.length === 0
    ? [{
      id: "handoff-blocked-write-status",
      label: "Send blocked write status to adapter",
      command: "external-write.blocked.handoff",
      enabled: true,
    }]
    : [
      {
        id: "review-preview",
        label: "Review quarantined write preview",
        command: "external-write.blocked.review-preview",
        enabled: true,
      },
      {
        id: "accept-preview",
        label: "Accept blocked write handoff",
        command: "external-write.blocked.accept",
        enabled: audit.evidence.missing.length === 0,
      },
    ];

  return {
    kind: "mailchimp.external-write-blocked.acceptance",
    apiVersion: "aios.client/v1",
    preview: {
      previewToken,
      title: "Blocked Mailchimp write",
      summary: observedWrites.length === 0
        ? "No external Mailchimp writes were observed; the local quarantine receipt is ready for review."
        : `${observedWrites.length} Mailchimp write attempt(s) were quarantined before provider execution.`,
      actions: [
        {
          id: "accept",
          command: "external-write.blocked.accept",
          enabled: audit.evidence.missing.length === 0,
        },
        {
          id: "keep-blocked",
          command: "external-write.blocked.keep-blocked",
          enabled: true,
        },
      ],
      observedWrites,
    },
    acceptance: {
      accepted,
      acceptedBy: accepted ? operator : null,
      acceptedAt: accepted ? (options.acceptedAt ?? "logical:5") : null,
      requiresOperatorDecision: !accepted,
      decisionKey: `${previewToken}:${operator}`,
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      summary: validationBlockers.length === 0
        ? "Blocked write preview accepted and ready for adapter handoff."
        : "Blocked write preview requires operator acceptance or missing evidence resolution.",
    },
    nextSteps,
  };
}

function buildBlockedWriteReportingState(
  program,
  audit,
  exportSnapshot,
  acceptance,
  clientState,
  boundary,
  continuity,
  operationalHealth,
  recoveryStatus,
  options,
) {
  const history = normalizeBlockedWriteHistory(options.history);
  const currentSnapshot = {
    at: String(options.generatedAt ?? "logical:4"),
    jobId: program.job.id,
    status: audit.status,
    accepted: acceptance.acceptance.accepted,
    tenantId: boundary.scope.tenantId,
    workspaceId: boundary.scope.workspaceId,
    ready: acceptance.validation.ready
      && clientState.validation.ready
      && boundary.validation.ready
      && continuity.validation.ready
      && operationalHealth.validation.ready,
    healthStatus: operationalHealth.health.status,
    degraded: operationalHealth.degradedMode.enabled,
    retryable: operationalHealth.health.retryable,
    evidencePresent: getAcceptedEvidence(audit).length,
    evidenceMissing: getMissingEvidence(audit).length,
    observedExternalWrites: audit.boundary.externalWritesObserved.length,
    quarantinedSubjects: continuity.persistedState.quarantineSubjects.length,
    blockedReasons: uniqueSorted([
      ...acceptance.validation.blockers,
      ...clientState.validation.blockers,
      ...boundary.validation.blockers,
      ...continuity.validation.blockers,
      ...operationalHealth.validation.blockers,
      ...recoveryStatus.blockedReasons,
    ]),
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
  const timeline = snapshots.map((snapshot, index) => ({
    index,
    at: snapshot.at,
    event: snapshot.ready
      ? "blocked-write-export-ready"
      : snapshot.accepted
        ? "blocked-write-accepted-review"
        : snapshot.observedExternalWrites > 0
          ? "blocked-write-quarantined"
          : "blocked-write-review-required",
    status: snapshot.status,
    ready: snapshot.ready,
    healthStatus: snapshot.healthStatus,
    degraded: snapshot.degraded,
    retryable: snapshot.retryable,
    observedExternalWrites: snapshot.observedExternalWrites,
    quarantinedSubjects: snapshot.quarantinedSubjects,
    blockedCount: snapshot.blockedReasons.length,
  }));
  const latestBlockedReasons = uniqueSorted(snapshots.flatMap((snapshot) => snapshot.blockedReasons));
  const exportRows = [
    {
      key: "quarantine",
      label: "Quarantined subjects",
      value: currentSnapshot.quarantinedSubjects,
      status: currentSnapshot.quarantinedSubjects > 0 || currentSnapshot.observedExternalWrites === 0
        ? "ready"
        : "blocked",
    },
    {
      key: "boundary",
      label: "External writes",
      value: currentSnapshot.observedExternalWrites,
      status: boundary.permissions.externalWritesAllowed === false ? "blocked_by_policy" : "invalid",
    },
    {
      key: "acceptance",
      label: "Operator decision",
      value: currentSnapshot.accepted ? "accepted" : "pending",
      status: currentSnapshot.accepted ? "ready" : "review",
    },
    {
      key: "health",
      label: "Operational health",
      value: currentSnapshot.healthStatus,
      status: operationalHealth.validation.ready ? "ready" : currentSnapshot.healthStatus,
    },
  ];
  const reportId = `blocked-write-report:${exportSnapshot.exportId}`;
  const canExport = currentSnapshot.ready
    && exportSnapshot.truthBoundary.readyForExport
    && boundary.permissions.externalWritesAllowed === false;

  return {
    kind: "mailchimp.external-write-blocked.reporting-state",
    apiVersion: "aios.reporting/v1",
    counters: {
      snapshots: snapshots.length,
      readySnapshots: snapshots.filter((snapshot) => snapshot.ready).length,
      blockedSnapshots: snapshots.filter((snapshot) => !snapshot.ready).length,
      acceptedSnapshots: snapshots.filter((snapshot) => snapshot.accepted).length,
      degradedSnapshots: snapshots.filter((snapshot) => snapshot.degraded).length,
      retryableSnapshots: snapshots.filter((snapshot) => snapshot.retryable).length,
      totalObservedExternalWrites: snapshots.reduce((sum, snapshot) => sum + snapshot.observedExternalWrites, 0),
      totalQuarantinedSubjects: snapshots.reduce((sum, snapshot) => sum + snapshot.quarantinedSubjects, 0),
      evidenceMissing: currentSnapshot.evidenceMissing,
      statusCounts: countBy(snapshots, "status"),
      healthCounts: countBy(snapshots, "healthStatus"),
    },
    history: snapshots,
    timeline: {
      trend,
      currentEvent: timeline[timeline.length - 1]?.event ?? "blocked-write-report-unknown",
      exportReady: canExport,
      latestBlockedReasons,
      timeline,
    },
    exportReadySummary: {
      reportId,
      exportId: exportSnapshot.exportId,
      format: exportSnapshot.format,
      ready: canExport,
      headline: canExport
        ? "blocked write report is ready for export"
        : `blocked write report requires review: ${latestBlockedReasons[0] ?? "truth boundary not export-ready"}`,
      rows: exportRows,
      timeline,
      nextReportAction: canExport
        ? "external-write.blocked.export-report"
        : operationalHealth.retryPlan.commands.retry.enabled
          ? operationalHealth.retryPlan.commands.retry.command
          : "external-write.blocked.review-report",
    },
    handoffManifest: {
      reportId,
      quarantineKey: `${program.job.memory.namespace}:quarantine:${exportSnapshot.exportId}`,
      requestId: clientState.request.requestId,
      continuityKey: continuity.continuityKey,
      boundaryKey: boundary.boundaryKey,
      restartToken: recoveryStatus.restartToken,
      statusEvent: recoveryStatus.statusEvent,
      externalWritesAllowed: false,
      exportRows,
    },
  };
}

function buildBlockedWriteClientState(program, audit, acceptance, recoveryStatus, options) {
  const requestId = options.requestId
    ?? `${program.job.id}:blocked-write-request:${acceptance.preview.previewToken}`;
  const quarantineItems = acceptance.preview.observedWrites.map((write) => ({
    id: `${requestId}:write:${write.index}`,
    subject: write.subject,
    status: "quarantined",
    selected: true,
  }));
  const visiblePhase = acceptance.validation.ready
    ? "ready_to_handoff"
    : acceptance.acceptance.accepted
      ? "waiting_for_recovery"
      : "needs_operator_decision";
  const validationBlockers = uniqueSorted([
    ...(acceptance.preview.previewToken ? [] : ["blocked write client state requires a preview token"]),
    ...(recoveryStatus.restartToken ? [] : ["blocked write client state requires a restart token"]),
    ...(acceptance.acceptance.accepted || quarantineItems.length === 0
      ? []
      : ["client cannot hand off observed quarantined writes until accepted"]),
  ]);

  return {
    kind: "mailchimp.external-write-blocked.client-state",
    apiVersion: "aios.client/v1",
    request: {
      requestId,
      intent: "review-blocked-mailchimp-write",
      source: "mailchimp-draft-write-boundary",
      previewToken: acceptance.preview.previewToken,
      restartToken: recoveryStatus.restartToken,
      commands: acceptance.nextSteps.map((step) => ({
        id: step.id,
        command: step.command,
        enabled: step.enabled,
      })),
    },
    visibleState: {
      title: acceptance.preview.title,
      phase: visiblePhase,
      summary: acceptance.preview.summary,
      quarantineItems,
      primaryAction: acceptance.validation.ready
        ? "external-write.blocked.handoff"
        : "external-write.blocked.accept",
      secondaryAction: "external-write.blocked.keep-blocked",
    },
    runtimeAdoption: {
      statusEvent: recoveryStatus.statusEvent,
      restartToken: recoveryStatus.restartToken,
      canResumeFromClient: acceptance.validation.ready && validationBlockers.length === 0,
      handoffPayload: {
        quarantineSubjects: quarantineItems.map((item) => item.subject),
        acceptedAt: acceptance.acceptance.acceptedAt,
        acceptedBy: acceptance.acceptance.acceptedBy,
      },
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
    },
  };
}

function buildBlockedWriteTenantBoundary(program, audit, acceptance, clientState, recoveryStatus, options) {
  const tenantId = options.tenantId ?? "tenant:local-mailchimp";
  const workspaceId = options.workspaceId ?? "workspace:mailchimp-local";
  const role = options.role ?? "operator";
  const allowedRoles = new Set(options.allowedRoles ?? ["operator", "auditor", "runtime"]);
  const requiredPermissions = uniqueSorted([
    "mailchimp:campaign.read",
    "memory:campaign.local",
    "status:timeline.write",
    ...(options.requiredPermissions ?? []),
  ]);
  const grantedPermissions = new Set(options.grantedPermissions ?? requiredPermissions);
  const deniedPermissions = requiredPermissions
    .filter((permission) => !grantedPermissions.has(permission));
  const restrictedTenants = new Set(options.restrictedTenants ?? []);
  const quarantineSubjects = clientState.runtimeAdoption.handoffPayload.quarantineSubjects;
  const boundaryKey = options.boundaryKey
    ?? `${program.job.memory.namespace}:blocked-write:boundary:${tenantId}:${workspaceId}:${clientState.request.requestId}`;
  const validationBlockers = uniqueSorted([
    ...(tenantId && workspaceId ? [] : ["blocked-write boundary requires tenant and workspace scope"]),
    ...(restrictedTenants.has(tenantId) ? [`tenant is restricted for blocked-write handoff: ${tenantId}`] : []),
    ...(allowedRoles.has(role) ? [] : [`role cannot hand off blocked write: ${role}`]),
    ...deniedPermissions.map((permission) => `permission not granted for blocked-write boundary: ${permission}`),
    ...(clientState.request.restartToken ? [] : ["blocked-write boundary requires restart token"]),
    ...(recoveryStatus.ready ? [] : ["blocked-write boundary requires ready recovery status"]),
    ...(acceptance.acceptance.accepted || quarantineSubjects.length === 0
      ? []
      : ["blocked-write boundary cannot release quarantined subjects before acceptance"]),
    ...(audit.boundary.externalWritesObserved.length === 0 || quarantineSubjects.length > 0
      ? []
      : ["blocked-write boundary requires quarantine subjects for observed writes"]),
  ]);

  return {
    kind: "mailchimp.external-write-blocked.tenant-boundary",
    apiVersion: "aios.runtime/v1",
    boundaryKey,
    scope: {
      tenantId,
      workspaceId,
      role,
      memoryNamespace: program.job.memory.namespace,
      statePrefix: `${program.job.memory.namespace}:blocked-write:`,
    },
    permissions: {
      required: requiredPermissions,
      granted: [...grantedPermissions].sort(),
      denied: deniedPermissions,
      providerReadsOnly: true,
      externalWritesAllowed: false,
      quarantineWriteOnly: true,
    },
    isolation: {
      requestId: clientState.request.requestId,
      previewToken: clientState.request.previewToken,
      quarantineSubjects,
      allowedStatePrefix: `${program.job.memory.namespace}:blocked-write:`,
      isolated: boundaryKey.startsWith(`${program.job.memory.namespace}:blocked-write:`),
    },
    auditHandoff: {
      handoffId: `${boundaryKey}:audit`,
      command: validationBlockers.length === 0
        ? "external-write.blocked.audit-handoff"
        : "external-write.blocked.audit-review",
      statusEvent: recoveryStatus.statusEvent,
      decision: validationBlockers.length === 0 ? "allow_blocked_write_handoff" : "review_required",
      includesQuarantineSubjects: quarantineSubjects.length,
      acceptedBy: acceptance.acceptance.acceptedBy,
      acceptedAt: acceptance.acceptance.acceptedAt,
    },
    safeBoundary: {
      externalProviderMutation: "blocked",
      localQuarantineMutation: "allowed",
      clientVisiblePhase: clientState.visibleState.phase,
      fallbackCommand: "external-write.blocked.keep-blocked",
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      tenantIsolated: boundaryKey.startsWith(`${program.job.memory.namespace}:blocked-write:`)
        && Boolean(tenantId)
        && Boolean(workspaceId),
    },
  };
}

function buildBlockedWriteContinuityPacket(program, audit, acceptance, clientState, recoveryStatus, options) {
  const continuityKey = options.continuityKey
    ?? `${program.job.memory.namespace}:blocked-write:continuity:${clientState.request.requestId}`;
  const priorState = options.priorContinuityState ?? {};
  const version = Number.isInteger(priorState.version) ? priorState.version + 1 : 1;
  const quarantineSubjects = uniqueSorted([
    ...clientState.runtimeAdoption.handoffPayload.quarantineSubjects,
    ...(options.quarantineSubjects ?? []),
  ]);
  const commandBase = `${continuityKey}:v${version}`;
  const accepted = acceptance.acceptance.accepted === true;
  const persistedStatus = acceptance.validation.ready
    ? "ready_for_adapter_handoff"
    : accepted
      ? "accepted_waiting_for_recovery"
      : "operator_review_required";
  const validationBlockers = uniqueSorted([
    ...(clientState.request.restartToken ? [] : ["blocked-write continuity requires restart token"]),
    ...(clientState.request.previewToken ? [] : ["blocked-write continuity requires preview token"]),
    ...(clientState.visibleState.quarantineItems.every((item) => item.status === "quarantined")
      ? []
      : ["blocked-write continuity can only persist quarantined items"]),
    ...(audit.boundary.externalWritesObserved.length === 0 || quarantineSubjects.length > 0
      ? []
      : ["observed blocked writes require persisted quarantine subjects"]),
    ...(clientState.runtimeAdoption.canResumeFromClient || accepted === false
      ? []
      : ["accepted blocked-write continuity is waiting on recovery readiness"]),
  ]);

  return {
    kind: "mailchimp.external-write-blocked.continuity-packet",
    apiVersion: "aios.runtime/v1",
    continuityKey,
    version,
    persistedState: {
      status: persistedStatus,
      requestId: clientState.request.requestId,
      previewToken: clientState.request.previewToken,
      restartToken: clientState.request.restartToken,
      quarantineSubjects,
      writePolicy: {
        externalWritesAllowed: false,
        provider: "mailchimp",
        fallback: "local-quarantine-only",
      },
    },
    commands: {
      accept: {
        idempotent: true,
        idempotencyKey: `${commandBase}:accept:${acceptance.acceptance.decisionKey ?? clientState.request.previewToken}`,
        command: "external-write.blocked.accept",
        enabled: !accepted && acceptance.preview.actions.some((action) => action.command === "external-write.blocked.accept"),
      },
      handoff: {
        idempotent: true,
        idempotencyKey: `${commandBase}:handoff:${recoveryStatus.restartToken}`,
        command: clientState.runtimeAdoption.canResumeFromClient
          ? "external-write.blocked.handoff"
          : "external-write.blocked.review",
        enabled: clientState.runtimeAdoption.canResumeFromClient,
      },
      keepBlocked: {
        idempotent: true,
        idempotencyKey: `${commandBase}:keep-blocked`,
        command: "external-write.blocked.keep-blocked",
        enabled: true,
      },
    },
    userVisibleHandoff: {
      phase: clientState.visibleState.phase,
      title: clientState.visibleState.title,
      primaryAction: clientState.visibleState.primaryAction,
      secondaryAction: clientState.visibleState.secondaryAction,
      itemCount: clientState.visibleState.quarantineItems.length,
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      restartSafe: validationBlockers.length === 0 && Boolean(clientState.request.restartToken),
    },
  };
}

function buildBlockedWriteOperationalHealth(
  program,
  audit,
  acceptance,
  clientState,
  boundary,
  continuity,
  recoveryStatus,
  options,
) {
  const retryAttempt = Number.isInteger(options.retryAttempt) ? options.retryAttempt : 0;
  const retryLimit = program.job.recovery.retry.attempts;
  const baseBackoffSeconds = Number.isInteger(options.baseBackoffSeconds)
    ? options.baseBackoffSeconds
    : 20;
  const quarantineSubjects = continuity.persistedState.quarantineSubjects;
  const evidenceFailures = audit.evidence.missing
    .map((subject) => `write-block evidence missing: ${subject}`);
  const observedWriteFailures = audit.boundary.externalWritesObserved
    .map((write) => `external write remained visible after block: ${write.subject ?? write}`);
  const stateFailures = uniqueSorted([
    ...evidenceFailures,
    ...observedWriteFailures,
    ...acceptance.validation.blockers,
    ...clientState.validation.blockers,
    ...boundary.validation.blockers,
    ...continuity.validation.blockers,
    ...recoveryStatus.blockedReasons,
  ]);
  const retryable = stateFailures.length > 0
    && retryAttempt < retryLimit
    && Boolean(recoveryStatus.restartToken)
    && boundary.safeBoundary.externalProviderMutation === "blocked";
  const degraded = stateFailures.length > 0
    && boundary.permissions.externalWritesAllowed === false
    && continuity.commands.keepBlocked.enabled === true;
  const nextBackoffSeconds = Math.min(
    baseBackoffSeconds * (2 ** Math.min(retryAttempt, retryLimit)),
    360,
  );
  const healthStatus = stateFailures.length === 0
    ? "healthy"
    : retryable
      ? "retryable"
      : degraded
        ? "degraded"
        : "failed";
  const actionableErrors = stateFailures.map((message, index) => {
    const isBoundaryFailure = message.includes("external write")
      || message.includes("permission")
      || message.includes("tenant");

    return {
      id: `${program.job.id}:blocked-write:error:${index}`,
      message,
      severity: isBoundaryFailure ? "critical" : "warning",
      action: retryable
        ? "external-write.blocked.retry-handoff"
        : "external-write.blocked.review",
      retryAfterSeconds: retryable ? nextBackoffSeconds : null,
      safeFallback: "external-write.blocked.keep-blocked",
    };
  });
  const validationBlockers = uniqueSorted([
    ...(retryAttempt <= retryLimit ? [] : ["blocked-write retry attempt exceeds retry limit"]),
    ...(healthStatus === "failed" ? ["blocked-write health has no safe retry path"] : []),
    ...(boundary.permissions.externalWritesAllowed
      ? ["blocked-write health requires external writes to stay disabled"]
      : []),
    ...(continuity.persistedState.writePolicy.externalWritesAllowed
      ? ["blocked-write persisted policy cannot allow external writes"]
      : []),
  ]);

  return {
    kind: "mailchimp.external-write-blocked.operational-health",
    apiVersion: "aios.runtime/v1",
    health: {
      status: healthStatus,
      degraded,
      retryable,
      retryAttempt,
      retryLimit,
      failureCount: stateFailures.length,
      quarantinedSubjectCount: quarantineSubjects.length,
      lastStatusEvent: recoveryStatus.statusEvent,
      visiblePhase: clientState.visibleState.phase,
    },
    retryPlan: {
      restartToken: recoveryStatus.restartToken,
      nextBackoffSeconds: retryable ? nextBackoffSeconds : null,
      retryableSubjects: quarantineSubjects,
      commands: {
        retry: {
          idempotent: true,
          idempotencyKey: `${continuity.continuityKey}:health-retry:${retryAttempt}:${recoveryStatus.restartToken}`,
          command: retryable
            ? "external-write.blocked.retry-handoff"
            : "external-write.blocked.review",
          enabled: retryable,
        },
        keepBlocked: {
          idempotent: true,
          idempotencyKey: continuity.commands.keepBlocked.idempotencyKey,
          command: continuity.commands.keepBlocked.command,
          enabled: true,
        },
        review: {
          idempotent: true,
          idempotencyKey: `${continuity.continuityKey}:review:${clientState.request.requestId}`,
          command: "external-write.blocked.review",
          enabled: stateFailures.length > 0,
        },
      },
    },
    degradedMode: {
      enabled: degraded,
      status: degraded ? "local_quarantine_only" : "not_needed",
      externalWritesAllowed: false,
      retainedSubjects: quarantineSubjects,
      clientVisiblePhase: clientState.visibleState.phase,
      visibleMessage: degraded
        ? "Mailchimp write execution remains blocked; local quarantine state can be reviewed or retried."
        : "Blocked write handoff is healthy or waiting for review.",
    },
    actionableErrors,
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      canHandoff: healthStatus === "healthy"
        && boundary.validation.ready
        && continuity.validation.restartSafe,
    },
  };
}

function buildBlockedWriteProviderHandoff(
  program,
  audit,
  providerContract,
  acceptance,
  clientState,
  boundary,
  continuity,
  operationalHealth,
  reportingState,
  lifecycleControls,
  recoveryStatus,
  options,
) {
  const priorState = options.priorProviderHandoffState ?? {};
  const version = Number.isInteger(priorState.version) ? priorState.version + 1 : 1;
  const handoffKey = options.providerHandoffKey
    ?? `${program.job.memory.namespace}:blocked-write:provider-handoff:${clientState.request.requestId}`;
  const requestedCapabilities = uniqueSorted([
    "mailchimp:campaign.read",
    "status:timeline.write",
    "memory:campaign.local",
    "external-write:block",
    ...(options.requestedProviderCapabilities ?? []),
  ]);
  const negotiatedCapabilities = providerContract.negotiation?.supportedCapabilities ?? [];
  const supportedCapabilities = new Set(
    options.supportedCapabilities === undefined && negotiatedCapabilities.length === 0
      ? requestedCapabilities
      : negotiatedCapabilities,
  );
  const deniedCapabilities = requestedCapabilities
    .filter((capability) => !supportedCapabilities.has(capability));
  const providerAckStatus = normalizeProviderHandoffAckStatus(
    options.providerAckStatus ?? priorState.providerAckStatus ?? "pending",
  );
  const syncAttempt = normalizeBlockedWriteInteger(
    options.providerSyncAttempt ?? priorState.syncAttempt ?? 0,
    "providerSyncAttempt",
    0,
    20,
  );
  const maxSyncAttempts = normalizeBlockedWriteInteger(
    options.providerMaxSyncAttempts ?? 3,
    "providerMaxSyncAttempts",
    1,
    20,
  );
  const quarantineSubjects = continuity.persistedState.quarantineSubjects;
  const syncCursor = options.providerSyncCursor
    ?? `${program.job.id}:blocked-write:${reportingState.exportReadySummary.reportId}`;
  const manifest = {
    provider: providerContract.provider?.name ?? "mailchimp",
    providerResource: providerContract.provider?.resource ?? "campaign-draft",
    jobId: program.job.id,
    reportId: reportingState.exportReadySummary.reportId,
    exportId: reportingState.exportReadySummary.exportId,
    requestId: clientState.request.requestId,
    previewToken: clientState.request.previewToken,
    continuityKey: continuity.continuityKey,
    boundaryKey: boundary.boundaryKey,
    restartToken: recoveryStatus.restartToken,
    handoffToken: providerContract.handoffState.handoffToken,
    quarantineSubjects,
    externalWritesAllowed: false,
    statusEvent: recoveryStatus.statusEvent,
  };
  const manifestFingerprint = deterministicHandoffFingerprint([
    manifest.provider,
    manifest.providerResource,
    manifest.jobId,
    manifest.reportId,
    manifest.exportId,
    manifest.requestId,
    manifest.previewToken,
    manifest.continuityKey,
    manifest.boundaryKey,
    manifest.restartToken,
    manifest.handoffToken,
    manifest.quarantineSubjects.join(","),
    manifest.externalWritesAllowed,
    manifest.statusEvent,
  ]);
  const duplicateOf = priorState.manifestFingerprint === manifestFingerprint
    ? priorState.recordId ?? null
    : null;
  const accepted = acceptance.acceptance.accepted === true;
  const providerMutationDenied = boundary.permissions.externalWritesAllowed === false
    && continuity.persistedState.writePolicy.externalWritesAllowed === false
    && manifest.externalWritesAllowed === false;
  const retryable = providerAckStatus === "failed"
    && syncAttempt < maxSyncAttempts
    && operationalHealth.retryPlan.commands.keepBlocked.enabled;
  const acknowledged = providerAckStatus === "acknowledged";
  const validationBlockers = uniqueSorted([
    ...(handoffKey.startsWith(`${program.job.memory.namespace}:blocked-write:provider-handoff:`)
      ? []
      : ["blocked-write provider handoff key must stay inside memory namespace"]),
    ...deniedCapabilities.map((capability) => `blocked-write provider capability not negotiated: ${capability}`),
    ...(accepted || quarantineSubjects.length === 0
      ? []
      : ["blocked-write provider handoff requires accepted operator decision for quarantined subjects"]),
    ...(clientState.validation.ready ? [] : ["blocked-write provider handoff requires client state readiness"]),
    ...(boundary.validation.ready ? [] : ["blocked-write provider handoff requires tenant boundary readiness"]),
    ...(continuity.validation.restartSafe ? [] : ["blocked-write provider handoff requires restart-safe continuity"]),
    ...(lifecycleControls.validation.canRunNextAction ? [] : ["blocked-write provider handoff requires runnable lifecycle action"]),
    ...(providerMutationDenied ? [] : ["blocked-write provider handoff cannot permit external mutation"]),
    ...(recoveryStatus.restartToken ? [] : ["blocked-write provider handoff requires restart token"]),
    ...(providerContract.handoffState.handoffToken ? [] : ["blocked-write provider handoff requires adapter handoff token"]),
    ...(audit.boundary.externalWritesObserved.length === 0 || quarantineSubjects.length > 0
      ? []
      : ["blocked-write provider handoff requires quarantine subjects for observed writes"]),
    ...(providerAckStatus === "rejected" ? ["blocked-write provider handoff was rejected by adapter"] : []),
    ...(syncAttempt <= maxSyncAttempts
      ? []
      : [`blocked-write provider sync attempt ${syncAttempt} exceeds max ${maxSyncAttempts}`]),
  ]);
  const status = acknowledged
    ? "acknowledged"
    : validationBlockers.length === 0
      ? "ready_to_sync"
      : retryable
        ? "retryable"
        : "blocked";
  const commandBase = `${handoffKey}:v${version}:${manifestFingerprint}`;

  return {
    kind: "mailchimp.external-write-blocked.provider-handoff",
    apiVersion: "aios.integration/v1",
    handoffKey,
    version,
    recordId: `${commandBase}:record`,
    duplicateOf,
    provider: {
      name: manifest.provider,
      resource: manifest.providerResource,
      syncCursor,
      handoffToken: manifest.handoffToken,
    },
    capabilityNegotiation: {
      requestedCapabilities,
      supportedCapabilities: [...supportedCapabilities].sort(),
      deniedCapabilities,
      externalWritesAllowed: false,
      fallback: deniedCapabilities.length === 0 ? null : "local-quarantine-status-only",
    },
    syncManifest: {
      manifestFingerprint,
      queuedAt: String(options.providerQueuedAt ?? "logical:provider-sync"),
      ackedAt: acknowledged ? String(options.providerAckedAt ?? "logical:provider-ack") : null,
      manifest,
      metadata: {
        healthStatus: operationalHealth.health.status,
        reportReady: reportingState.exportReadySummary.ready,
        lifecycleState: lifecycleControls.state.status,
        quarantineCount: quarantineSubjects.length,
      },
    },
    state: {
      status,
      providerAckStatus,
      syncAttempt,
      maxSyncAttempts,
      acknowledged,
      retryable,
      stableAcrossRestart: duplicateOf !== null
        || priorState.manifestFingerprint === undefined
        || priorState.manifestFingerprint === manifestFingerprint,
    },
    commands: {
      sync: {
        idempotent: true,
        idempotencyKey: `${commandBase}:sync`,
        command: status === "ready_to_sync"
          ? "external-write.blocked.provider-sync"
          : "external-write.blocked.provider-review",
        enabled: status === "ready_to_sync",
      },
      retry: {
        idempotent: true,
        idempotencyKey: `${commandBase}:retry:${syncAttempt + 1}`,
        command: retryable
          ? "external-write.blocked.provider-retry"
          : "external-write.blocked.provider-review",
        enabled: retryable,
      },
      ack: {
        idempotent: true,
        idempotencyKey: `${commandBase}:ack`,
        command: "external-write.blocked.provider-ack",
        enabled: status === "ready_to_sync" || acknowledged,
      },
      keepBlocked: {
        ...continuity.commands.keepBlocked,
        enabled: true,
      },
    },
    validation: {
      ready: validationBlockers.length === 0 && (status === "ready_to_sync" || acknowledged),
      blockers: validationBlockers,
      canSyncProvider: status === "ready_to_sync",
      duplicateSafe: duplicateOf !== null || priorState.manifestFingerprint === undefined,
    },
  };
}

function buildBlockedWriteReviewManifest(
  program,
  audit,
  exportSnapshot,
  acceptance,
  clientState,
  boundary,
  continuity,
  operationalHealth,
  reportingState,
  lifecycleControls,
  providerHandoff,
  recoveryStatus,
  options,
) {
  const surfaceName = String(options.reviewSurface ?? "mailchimp-blocked-write-review");
  const manifestKey = String(
    options.reviewManifestKey
      ?? `${program.job.memory.namespace}:blocked-write:review-manifest:${clientState.request.requestId}`,
  );
  const operatorDecision = acceptance.acceptance.accepted ? "accepted" : "pending";
  const previewItems = clientState.visibleState.quarantineItems.map((item, index) => ({
    id: item.id,
    index,
    subject: item.subject,
    status: item.status,
    selected: item.selected,
    userVisibleMessage: "This Mailchimp write remains quarantined locally.",
    providerMutation: "blocked",
  }));
  const validationSummary = {
    evidenceReady: audit.evidence.missing.length === 0,
    recoveryReady: recoveryStatus.ready,
    acceptanceReady: acceptance.validation.ready,
    clientReady: clientState.validation.ready,
    boundaryReady: boundary.validation.ready,
    continuityReady: continuity.validation.ready,
    healthReady: operationalHealth.validation.ready,
    reportReady: reportingState.exportReadySummary.ready,
    lifecycleReady: lifecycleControls.validation.ready,
    providerReady: providerHandoff.validation.ready,
    observedExternalWrites: audit.boundary.externalWritesObserved.length,
    quarantinedSubjects: continuity.persistedState.quarantineSubjects.length,
  };
  const readinessBlockers = uniqueSorted([
    ...acceptance.validation.blockers,
    ...clientState.validation.blockers,
    ...boundary.validation.blockers,
    ...continuity.validation.blockers,
    ...operationalHealth.validation.blockers,
    ...lifecycleControls.validation.blockers,
    ...providerHandoff.validation.blockers,
    ...(exportSnapshot.truthBoundary.readyForExport ? [] : [exportSnapshot.summary]),
    ...(manifestKey.startsWith(`${program.job.memory.namespace}:blocked-write:review-manifest:`)
      ? []
      : ["blocked-write review manifest key must stay inside memory namespace"]),
    ...(boundary.permissions.externalWritesAllowed === false
      ? []
      : ["blocked-write review manifest cannot expose provider write permission"]),
    ...(continuity.persistedState.writePolicy.externalWritesAllowed === false
      ? []
      : ["blocked-write review manifest requires local quarantine-only persisted policy"]),
  ]);
  const ready = readinessBlockers.length === 0
    && validationSummary.acceptanceReady
    && validationSummary.providerReady;
  const primaryCommand = ready
    ? providerHandoff.commands.sync.command
    : !acceptance.acceptance.accepted
      ? "external-write.blocked.accept"
      : operationalHealth.retryPlan.commands.retry.enabled
        ? operationalHealth.retryPlan.commands.retry.command
        : lifecycleControls.nextAction.command;
  const secondaryCommand = continuity.commands.keepBlocked.command;
  const manifestFingerprint = deterministicHandoffFingerprint([
    manifestKey,
    surfaceName,
    clientState.request.requestId,
    acceptance.preview.previewToken,
    continuity.continuityKey,
    boundary.boundaryKey,
    providerHandoff.handoffKey,
    recoveryStatus.restartToken,
    operatorDecision,
    primaryCommand,
    previewItems.map((item) => item.subject).join(","),
    readinessBlockers.join(","),
  ]);
  const validationCards = [
    {
      key: "operator-decision",
      label: "Operator decision",
      status: acceptance.acceptance.accepted ? "ready" : "review",
      detail: acceptance.acceptance.accepted
        ? `Accepted by ${acceptance.acceptance.acceptedBy}`
        : "Acceptance is required before adapter handoff.",
    },
    {
      key: "quarantine",
      label: "Quarantine state",
      status: validationSummary.quarantinedSubjects > 0 || validationSummary.observedExternalWrites === 0
        ? "ready"
        : "missing",
      detail: `${validationSummary.quarantinedSubjects} quarantined subject(s), ${validationSummary.observedExternalWrites} observed write attempt(s).`,
    },
    {
      key: "provider-handoff",
      label: "Provider handoff",
      status: providerHandoff.validation.ready ? "ready" : providerHandoff.state.status,
      detail: providerHandoff.validation.ready
        ? `Provider sync command ${providerHandoff.commands.sync.command} is ready.`
        : providerHandoff.validation.blockers[0] ?? "Provider handoff requires review.",
    },
    {
      key: "truth-boundary",
      label: "Truth boundary",
      status: exportSnapshot.truthBoundary.readyForExport ? "ready" : "blocked",
      detail: exportSnapshot.truthBoundary.readyForExport
        ? "Export snapshot is ready and external provider writes remain blocked."
        : exportSnapshot.summary,
    },
    {
      key: "recovery",
      label: "Recovery status",
      status: recoveryStatus.ready ? "ready" : "blocked",
      detail: recoveryStatus.ready
        ? `Restart token ${recoveryStatus.restartToken} is available.`
        : recoveryStatus.blockedReasons[0] ?? "Recovery status requires review.",
    },
  ];
  const nextSteps = ready
    ? [{
      id: "sync-provider-handoff",
      label: "Sync blocked write handoff",
      command: providerHandoff.commands.sync.command,
      enabled: providerHandoff.commands.sync.enabled,
      reason: "Preview accepted, quarantine state persisted, and provider handoff is ready.",
    }]
    : [
      {
        id: "review-blocked-write",
        label: "Review blocked write details",
        command: "external-write.blocked.review",
        enabled: true,
        reason: readinessBlockers[0] ?? "Blocked write review is required.",
      },
      {
        id: "accept-blocked-write",
        label: "Accept blocked write handoff",
        command: "external-write.blocked.accept",
        enabled: audit.evidence.missing.length === 0 && !acceptance.acceptance.accepted,
        reason: acceptance.acceptance.accepted
          ? "Operator decision already recorded."
          : "Accept the local quarantine preview before provider handoff.",
      },
      {
        id: "keep-blocked",
        label: "Keep write blocked",
        command: secondaryCommand,
        enabled: true,
        reason: "External Mailchimp mutation remains disabled while blockers are resolved.",
      },
    ];

  return {
    kind: "mailchimp.external-write-blocked.review-manifest",
    apiVersion: "aios.client/v1",
    manifestKey,
    manifestFingerprint,
    surface: {
      name: surfaceName,
      title: clientState.visibleState.title,
      phase: clientState.visibleState.phase,
      requestId: clientState.request.requestId,
      previewToken: acceptance.preview.previewToken,
      reportId: reportingState.exportReadySummary.reportId,
      statusChannel: `status:${program.job.id}`,
    },
    preview: {
      title: acceptance.preview.title,
      summary: acceptance.preview.summary,
      items: previewItems,
      validationCards,
      emptyState: previewItems.length === 0
        ? "No provider writes were observed; the local blocked-write receipt can still be reviewed."
        : null,
    },
    acceptance: {
      required: true,
      status: operatorDecision,
      acceptedBy: acceptance.acceptance.acceptedBy,
      acceptedAt: acceptance.acceptance.acceptedAt,
      decisionKey: acceptance.acceptance.decisionKey,
    },
    readiness: {
      ready,
      summary: ready
        ? "Blocked write review is ready for provider handoff."
        : `Blocked write review requires action: ${readinessBlockers[0] ?? "review required"}`,
      externalWritesAllowed: false,
      providerMutation: "blocked",
      validationSummary,
      blockedReasons: readinessBlockers,
    },
    commands: {
      primary: {
        idempotent: true,
        idempotencyKey: `${manifestKey}:${manifestFingerprint}:primary`,
        command: primaryCommand,
        enabled: ready
          ? providerHandoff.commands.sync.enabled
          : primaryCommand === "external-write.blocked.accept"
            ? !acceptance.acceptance.accepted && audit.evidence.missing.length === 0
            : true,
      },
      secondary: {
        idempotent: true,
        idempotencyKey: `${manifestKey}:${manifestFingerprint}:secondary`,
        command: secondaryCommand,
        enabled: true,
      },
      report: {
        idempotent: true,
        idempotencyKey: `${manifestKey}:${manifestFingerprint}:report:${reportingState.exportReadySummary.reportId}`,
        command: reportingState.exportReadySummary.nextReportAction,
        enabled: reportingState.exportReadySummary.ready || operationalHealth.retryPlan.commands.retry.enabled,
      },
    },
    handoffState: {
      providerHandoffKey: providerHandoff.handoffKey,
      providerHandoffStatus: providerHandoff.state.status,
      lifecycleStatus: lifecycleControls.state.status,
      continuityKey: continuity.continuityKey,
      boundaryKey: boundary.boundaryKey,
      restartToken: recoveryStatus.restartToken,
      quarantineSubjects: continuity.persistedState.quarantineSubjects,
      auditHandoff: boundary.auditHandoff,
    },
    nextSteps,
    validation: {
      ready,
      blockers: readinessBlockers,
      previewSafe: boundary.permissions.externalWritesAllowed === false
        && continuity.persistedState.writePolicy.externalWritesAllowed === false,
      canSubmitPrimary: ready && providerHandoff.commands.sync.enabled,
    },
  };
}

function buildBlockedWriteLifecycleControls(
  program,
  audit,
  acceptance,
  clientState,
  boundary,
  continuity,
  operationalHealth,
  reportingState,
  recoveryStatus,
  options,
) {
  const enabled = Boolean(options.enabled ?? program.lifecycle.enabled);
  const paused = Boolean(options.paused ?? false);
  const requestedCommand = String(options.command ?? (
    enabled
      ? paused
        ? "external-write.blocked.resume-monitoring"
        : reportingState.exportReadySummary.ready
          ? "external-write.blocked.export-report"
          : operationalHealth.retryPlan.commands.retry.enabled
            ? "external-write.blocked.retry-handoff"
            : clientState.visibleState.primaryAction
      : "external-write.blocked.enable"
  )).trim();
  const schedule = normalizeBlockedWriteSchedule(options.schedule ?? program.lifecycle.schedule);
  const retentionDays = normalizeBlockedWriteInteger(
    options.retentionDays ?? 14,
    "retentionDays",
    1,
    90,
  );
  const maxQuarantineItems = normalizeBlockedWriteInteger(
    options.maxQuarantineItems ?? 250,
    "maxQuarantineItems",
    1,
    5000,
  );
  const notificationWindowSeconds = normalizeBlockedWriteInteger(
    options.notificationWindowSeconds ?? 300,
    "notificationWindowSeconds",
    30,
    86400,
  );
  const allowedCommands = enabled
    ? paused
      ? [
        "external-write.blocked.disable",
        "external-write.blocked.keep-blocked",
        "external-write.blocked.resume-monitoring",
        "external-write.blocked.review",
      ]
      : [
        "external-write.blocked.accept",
        "external-write.blocked.disable",
        "external-write.blocked.export-report",
        "external-write.blocked.handoff",
        "external-write.blocked.keep-blocked",
        "external-write.blocked.pause-monitoring",
        "external-write.blocked.reschedule",
        "external-write.blocked.retry-handoff",
        "external-write.blocked.review",
        "external-write.blocked.review-preview",
      ]
    : ["external-write.blocked.enable", "external-write.blocked.review"];
  const quarantineItemCount = continuity.persistedState.quarantineSubjects.length;
  const commandAllowed = allowedCommands.includes(requestedCommand);
  const settingsBlockers = uniqueSorted([
    ...(enabled ? [] : ["blocked-write lifecycle is disabled"]),
    ...(paused ? ["blocked-write lifecycle is paused"] : []),
    ...(schedule.valid ? [] : schedule.errors),
    ...(commandAllowed ? [] : [`blocked-write lifecycle command is not allowed: ${requestedCommand}`]),
    ...(boundary.permissions.externalWritesAllowed
      ? ["blocked-write lifecycle settings cannot allow external writes"]
      : []),
    ...(continuity.persistedState.writePolicy.externalWritesAllowed
      ? ["blocked-write lifecycle persisted policy cannot allow external writes"]
      : []),
    ...(quarantineItemCount <= maxQuarantineItems
      ? []
      : [`blocked-write quarantine item count ${quarantineItemCount} exceeds limit ${maxQuarantineItems}`]),
    ...(recoveryStatus.restartToken ? [] : ["blocked-write lifecycle requires restart token"]),
  ]);
  const stateStatus = !enabled
    ? "disabled"
    : paused
      ? "paused"
      : settingsBlockers.length === 0 && reportingState.exportReadySummary.ready
        ? "export_ready"
        : operationalHealth.health.retryable
          ? "retryable"
          : acceptance.acceptance.accepted
            ? "accepted_review"
            : "operator_review";
  const nextActionCommand = settingsBlockers.length === 0
    ? requestedCommand
    : !enabled
      ? "external-write.blocked.enable"
      : paused
        ? "external-write.blocked.resume-monitoring"
        : !schedule.valid
          ? "external-write.blocked.reschedule"
          : operationalHealth.retryPlan.commands.retry.enabled
            ? operationalHealth.retryPlan.commands.retry.command
            : "external-write.blocked.review";
  const commandBase = `${continuity.continuityKey}:lifecycle:${stateStatus}`;
  const commands = {
    enable: {
      idempotent: true,
      idempotencyKey: `${commandBase}:enable`,
      command: "external-write.blocked.enable",
      enabled: !enabled,
    },
    disable: {
      idempotent: true,
      idempotencyKey: `${commandBase}:disable`,
      command: "external-write.blocked.disable",
      enabled,
    },
    pause: {
      idempotent: true,
      idempotencyKey: `${commandBase}:pause`,
      command: "external-write.blocked.pause-monitoring",
      enabled: enabled && !paused,
    },
    resume: {
      idempotent: true,
      idempotencyKey: `${commandBase}:resume`,
      command: "external-write.blocked.resume-monitoring",
      enabled: enabled && paused,
    },
    reschedule: {
      idempotent: true,
      idempotencyKey: `${commandBase}:reschedule:${schedule.value.mode}`,
      command: "external-write.blocked.reschedule",
      enabled: enabled && (!schedule.valid || schedule.value.mode !== "manual"),
    },
    retry: {
      ...operationalHealth.retryPlan.commands.retry,
      enabled: enabled && !paused && operationalHealth.retryPlan.commands.retry.enabled,
    },
    keepBlocked: {
      ...continuity.commands.keepBlocked,
      enabled: true,
    },
    exportReport: {
      idempotent: true,
      idempotencyKey: `${commandBase}:export:${reportingState.exportReadySummary.reportId}`,
      command: "external-write.blocked.export-report",
      enabled: enabled && !paused && reportingState.exportReadySummary.ready,
    },
  };

  return {
    kind: "mailchimp.external-write-blocked.lifecycle-controls",
    apiVersion: "aios.runtime/v1",
    state: {
      status: stateStatus,
      enabled,
      paused,
      requestedCommand,
      commandAllowed,
      allowedCommands,
      currentPhase: clientState.visibleState.phase,
      healthStatus: operationalHealth.health.status,
      timelineEvent: reportingState.timeline.currentEvent,
    },
    settings: {
      dryRun: Boolean(program.lifecycle.dryRun),
      requireApproval: Boolean(program.lifecycle.requireApproval),
      externalWritesAllowed: false,
      localQuarantineAllowed: true,
      retentionDays,
      maxQuarantineItems,
      notificationWindowSeconds,
      schedule: schedule.value,
      manualOnly: schedule.value.mode === "manual",
    },
    commands,
    nextAction: {
      command: nextActionCommand,
      label: nextActionCommand === "external-write.blocked.export-report"
        ? "Export blocked write report"
        : nextActionCommand === "external-write.blocked.retry-handoff"
          ? "Retry blocked write handoff"
          : nextActionCommand === "external-write.blocked.resume-monitoring"
            ? "Resume blocked write monitoring"
            : nextActionCommand === "external-write.blocked.reschedule"
              ? "Update blocked write schedule"
              : "Review blocked write lifecycle",
      reason: settingsBlockers[0]
        ?? reportingState.exportReadySummary.headline
        ?? operationalHealth.degradedMode.visibleMessage,
    },
    auditHandoff: {
      lifecycleId: `${boundary.boundaryKey}:lifecycle`,
      decision: settingsBlockers.length === 0 ? "allow_lifecycle_transition" : "review_required",
      statusEvent: recoveryStatus.statusEvent,
      auditStatus: audit.status,
      reportId: reportingState.exportReadySummary.reportId,
      acceptedBy: acceptance.acceptance.acceptedBy,
      acceptedAt: acceptance.acceptance.acceptedAt,
    },
    validation: {
      ready: settingsBlockers.length === 0,
      blockers: settingsBlockers,
      settingsValid: schedule.valid
        && retentionDays >= 1
        && maxQuarantineItems >= quarantineItemCount
        && boundary.permissions.externalWritesAllowed === false,
      canRunNextAction: allowedCommands.includes(nextActionCommand)
        && commands.keepBlocked.enabled
        && Boolean(recoveryStatus.restartToken),
    },
  };
}

function buildBlockedWriteClientCommandEnvelope(
  program,
  audit,
  acceptance,
  clientState,
  boundary,
  continuity,
  operationalHealth,
  reportingState,
  lifecycleControls,
  providerHandoff,
  reviewManifest,
  recoveryStatus,
  options,
) {
  const envelopeKey = String(
    options.commandEnvelopeKey
      ?? `${program.job.memory.namespace}:blocked-write:command-envelope:${clientState.request.requestId}`,
  );
  const replay = normalizeBlockedWriteCommandReplay(options.commandReplay);
  const quarantineSubjects = continuity.persistedState.quarantineSubjects;
  const readinessBlockers = uniqueSorted([
    ...(envelopeKey.startsWith(`${program.job.memory.namespace}:blocked-write:command-envelope:`)
      ? []
      : ["blocked-write command envelope key must stay inside memory namespace"]),
    ...acceptance.validation.blockers,
    ...clientState.validation.blockers,
    ...boundary.validation.blockers,
    ...continuity.validation.blockers,
    ...operationalHealth.validation.blockers,
    ...reportingState.timeline.latestBlockedReasons,
    ...lifecycleControls.validation.blockers,
    ...providerHandoff.validation.blockers,
    ...reviewManifest.validation.blockers,
    ...replay.blockedReasons,
    ...(audit.boundary.externalWritesObserved.length === 0 || quarantineSubjects.length > 0
      ? []
      : ["blocked-write command envelope requires quarantine subjects for observed writes"]),
  ]);
  const ready = readinessBlockers.length === 0
    && reviewManifest.validation.ready
    && providerHandoff.validation.ready
    && continuity.validation.restartSafe;
  const phase = ready
    ? "ready_to_sync"
    : replay.detected
      ? "replay_review"
      : operationalHealth.health.retryable
        ? "retryable"
        : acceptance.acceptance.accepted
          ? "accepted_review"
          : "awaiting_operator_decision";
  const primaryCommand = ready
    ? providerHandoff.commands.sync.command
    : !acceptance.acceptance.accepted
      ? "external-write.blocked.accept"
      : operationalHealth.retryPlan.commands.retry.enabled
        ? operationalHealth.retryPlan.commands.retry.command
        : reviewManifest.commands.primary.command;
  const commandSet = {
    primary: {
      command: primaryCommand,
      enabled: ready
        ? providerHandoff.commands.sync.enabled
        : primaryCommand === "external-write.blocked.accept"
          ? !acceptance.acceptance.accepted && audit.evidence.missing.length === 0
          : true,
      reason: ready
        ? "blocked write command envelope is ready for provider handoff"
        : readinessBlockers[0] ?? reviewManifest.readiness.summary,
    },
    accept: {
      command: "external-write.blocked.accept",
      enabled: !acceptance.acceptance.accepted && audit.evidence.missing.length === 0,
      reason: acceptance.acceptance.accepted
        ? "blocked write handoff is already accepted"
        : "operator acceptance is required before provider handoff",
    },
    keepBlocked: {
      command: continuity.commands.keepBlocked.command,
      enabled: true,
      reason: "external Mailchimp writes remain disabled while review continues",
    },
    retry: {
      command: operationalHealth.retryPlan.commands.retry.command,
      enabled: operationalHealth.retryPlan.commands.retry.enabled,
      reason: operationalHealth.retryPlan.commands.retry.enabled
        ? `retry after ${operationalHealth.retryPlan.nextBackoffSeconds}s`
        : operationalHealth.actionableErrors[0]?.message ?? "retry is not currently available",
    },
    providerSync: {
      command: providerHandoff.commands.sync.command,
      enabled: providerHandoff.commands.sync.enabled,
      reason: providerHandoff.commands.sync.enabled
        ? "provider handoff manifest is ready to sync"
        : providerHandoff.validation.blockers[0] ?? "provider handoff requires review",
    },
    exportReport: {
      command: reportingState.exportReadySummary.nextReportAction,
      enabled: reportingState.exportReadySummary.ready,
      reason: reportingState.exportReadySummary.headline,
    },
    review: {
      command: "external-write.blocked.review",
      enabled: true,
      reason: readinessBlockers[0] ?? "blocked write review is always available",
    },
  };
  const commandNames = Object.keys(commandSet);
  const fingerprint = deterministicHandoffFingerprint([
    envelopeKey,
    clientState.request.requestId,
    clientState.request.previewToken,
    continuity.continuityKey,
    boundary.boundaryKey,
    providerHandoff.handoffKey,
    reviewManifest.manifestFingerprint,
    reportingState.exportReadySummary.reportId,
    recoveryStatus.restartToken,
    quarantineSubjects.join(","),
    primaryCommand,
    readinessBlockers.join(","),
  ]);
  const commandBase = `${envelopeKey}:${fingerprint}`;

  return {
    kind: "mailchimp.external-write-blocked.client-command-envelope",
    apiVersion: "aios.client/v1",
    envelopeKey,
    fingerprint,
    status: {
      ready,
      phase,
      accepted: acceptance.acceptance.accepted,
      health: operationalHealth.health.status,
      providerHandoffStatus: providerHandoff.state.status,
      replayed: replay.detected,
      blockedCount: readinessBlockers.length,
    },
    routePayload: {
      requestId: clientState.request.requestId,
      previewToken: clientState.request.previewToken,
      restartToken: clientState.request.restartToken,
      reportId: reportingState.exportReadySummary.reportId,
      reviewManifestKey: reviewManifest.manifestKey,
      continuityKey: continuity.continuityKey,
      boundaryKey: boundary.boundaryKey,
      providerHandoffKey: providerHandoff.handoffKey,
      statusChannel: `status:${program.job.id}`,
      visiblePhase: clientState.visibleState.phase,
      quarantineSubjects,
      externalWritesAllowed: false,
    },
    commands: Object.fromEntries(commandNames.map((name) => {
      const spec = commandSet[name];
      return [name, {
        idempotent: true,
        idempotencyKey: `${commandBase}:${name}:${spec.command}`,
        command: spec.command,
        enabled: spec.enabled,
        reason: spec.reason,
      }];
    })),
    replayGuard: {
      detected: replay.detected,
      replayOf: replay.replayOf,
      lastIdempotencyKey: replay.lastIdempotencyKey,
      safeToReplay: replay.detected
        ? Object.values(commandSet).some((spec) => `${commandBase}:${spec.command}`.includes(replay.lastIdempotencyKey ?? ""))
          || replay.lastIdempotencyKey === continuity.commands.keepBlocked.idempotencyKey
        : true,
      duplicateProviderRecord: providerHandoff.duplicateOf,
    },
    visibleWorkflow: {
      title: reviewManifest.surface.title,
      phase,
      primaryCommand,
      secondaryCommand: continuity.commands.keepBlocked.command,
      validationCards: reviewManifest.preview.validationCards,
      actionableErrors: operationalHealth.actionableErrors,
      nextSteps: reviewManifest.nextSteps,
    },
    summary: {
      ready,
      phase,
      primaryCommand,
      commandCount: commandNames.length,
      fingerprint,
      blockedCount: readinessBlockers.length,
      quarantineCount: quarantineSubjects.length,
    },
    validation: {
      ready,
      blockers: readinessBlockers,
      externalWritesAllowed: false,
      restartSafe: continuity.validation.restartSafe,
      canSubmitPrimary: ready && providerHandoff.commands.sync.enabled,
    },
  };
}

function normalizeBlockedWriteCommandReplay(replay = {}) {
  const detected = Boolean(replay.detected ?? replay.replayed ?? false);
  const lastIdempotencyKey = replay.lastIdempotencyKey ? String(replay.lastIdempotencyKey) : null;
  const replayOf = replay.replayOf ? String(replay.replayOf) : null;
  const blockedReasons = uniqueSorted([
    ...(detected && !lastIdempotencyKey
      ? ["blocked-write command replay requires last idempotency key"]
      : []),
  ]);
  return {
    detected,
    lastIdempotencyKey,
    replayOf,
    blockedReasons,
  };
}

function normalizeBlockedWriteSchedule(schedule = { mode: "manual" }) {
  const mode = String(schedule.mode ?? "manual").trim().toLowerCase();
  const errors = [];
  if (!["manual", "interval", "cron", "paused"].includes(mode)) {
    errors.push(`unsupported blocked-write schedule mode: ${mode}`);
  }
  if (mode === "interval") {
    const everySeconds = Number(schedule.everySeconds ?? schedule.everyMinutes * 60);
    if (!Number.isInteger(everySeconds) || everySeconds < 60) {
      errors.push("blocked-write interval schedule requires everySeconds >= 60");
    }
    return {
      valid: errors.length === 0,
      value: { mode, everySeconds: Number.isInteger(everySeconds) ? everySeconds : null },
      errors,
    };
  }
  if (mode === "cron") {
    const expression = String(schedule.expression ?? "").trim();
    if (expression.split(/\s+/).filter(Boolean).length < 5) {
      errors.push("blocked-write cron schedule requires a cron expression");
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

function normalizeBlockedWriteInteger(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function normalizeProviderHandoffAckStatus(value) {
  const status = String(value ?? "pending").trim().toLowerCase();
  if (!["pending", "acknowledged", "failed", "rejected"].includes(status)) {
    throw new Error(`unsupported blocked-write provider ack status: ${value}`);
  }
  return status;
}

function deterministicHandoffFingerprint(parts) {
  return parts
    .map((part) => String(part ?? "null").replaceAll("|", "%7C"))
    .join("|");
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

function normalizeBlockedWriteHistory(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.map((snapshot, index) => ({
    at: String(snapshot.at ?? `history:${index}`),
    jobId: String(snapshot.jobId ?? "unknown"),
    status: String(snapshot.status ?? "unknown"),
    accepted: Boolean(snapshot.accepted),
    tenantId: String(snapshot.tenantId ?? "tenant:unknown"),
    workspaceId: String(snapshot.workspaceId ?? "workspace:unknown"),
    ready: Boolean(snapshot.ready),
    healthStatus: String(snapshot.healthStatus ?? "unknown"),
    degraded: Boolean(snapshot.degraded),
    retryable: Boolean(snapshot.retryable),
    evidencePresent: Number(snapshot.evidencePresent ?? 0),
    evidenceMissing: Number(snapshot.evidenceMissing ?? 0),
    observedExternalWrites: Number(snapshot.observedExternalWrites ?? snapshot.externalWrites ?? 0),
    quarantinedSubjects: Number(snapshot.quarantinedSubjects ?? 0),
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
