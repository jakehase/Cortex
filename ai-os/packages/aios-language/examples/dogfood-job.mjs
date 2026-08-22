import {
  buildAuditTimelineState,
  createAuditExportSnapshot,
  createEvidence,
  createProviderSyncEvidence,
  createStatusEvent,
  createTruthBoundaryReport,
  mergeAuditReports,
} from "../stdlib/audit.mjs";
import {
  buildProviderServiceContract,
  compilePackageSource,
} from "../stdlib/packages.mjs";
import {
  buildRecoveryStatusHandoff,
  buildRollbackContract,
  buildRollbackPreviewAcceptanceContract,
  summarizeRollbackContract,
} from "../stdlib/rollback.mjs";
import {
  buildHelloWorldAudit,
  buildHelloWorldProgram,
  buildHelloWorldProviderContract,
} from "./hello-world.mjs";

export const dogfoodCampaignSource = `# package audit dogfood for Mailchimp campaign operations
use mailchimp:campaign.read
use mailchimp:report.read
use memory:campaign.local
use status:timeline.write
recover rollback=snapshot retry=2
step load-campaign input=campaignId output=campaign verify.intent=read-only
step load-report input=campaign.id output=report verify.source=mailchimp
step compare-subject input=campaign.subject output=subjectFinding verify.truth=local-only
step emit-status input=subjectFinding output=statusEvent verify.boundary=no-external-write
`;

export function buildDogfoodProgram(options = {}) {
  return compilePackageSource(dogfoodCampaignSource, {
    name: options.name ?? "mailchimp-dogfood-audit",
    version: options.version ?? "0.1.0",
    description: "Dogfood job that audits Mailchimp campaign reads before local status emission.",
    capabilities: options.capabilities ?? ["audit:truth-boundary.write"],
  }, {
    name: "mailchimp-dogfood-audit",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: options.dryRun ?? true,
      requireApproval: options.requireApproval ?? true,
      approvalTicket: options.approvalTicket,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 20,
    },
  });
}

export function buildDogfoodAudit(program = buildDogfoodProgram(), options = {}) {
  const missingSubjects = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missingSubjects.has(subject))
    .map((subject) => {
      const kind = subject.includes("verify.source")
        ? "mailchimp-read-receipt"
        : subject.includes("verify.")
          ? "operator-attestation"
          : "runtime-local-receipt";
      return createEvidence(kind, subject, { example: "dogfood-job" });
    });

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "completed",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "dogfood queued" }),
      createStatusEvent("running", { at: "logical:1", message: "mailchimp reads simulated" }),
      createStatusEvent("verifying", { at: "logical:2", message: "evidence checked" }),
      createStatusEvent(options.status ?? "completed", {
        at: "logical:3",
        message: "dogfood audit finished",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildDogfoodBundleReport(options = {}) {
  const hello = buildHelloWorldAudit(buildHelloWorldProgram());
  const dogfood = buildDogfoodAudit(buildDogfoodProgram(), options);

  return mergeAuditReports([hello, dogfood]);
}

export function describeDogfoodJob(options = {}) {
  const program = buildDogfoodProgram(options);
  const audit = buildDogfoodAudit(program, options);
  const bundle = buildDogfoodBundleReport(options);
  const preview = buildDogfoodPreview(program, audit, bundle, options);

  return {
    jobId: program.job.id,
    package: program.manifest.name,
    status: audit.status,
    recovery: audit.recovery,
    bundleStatus: bundle.status,
    missingEvidence: bundle.missingEvidence,
    violations: bundle.violations,
    lifecycle: program.lifecycle,
    preview,
    persistedRecovery: preview.persistedRecovery,
    acceptance: preview.acceptance,
    analyticsReport: preview.analyticsReport,
    exportReadySummary: preview.exportReadySummary,
    timelineReport: preview.timelineReport,
    adapterDispatchPlan: preview.adapterDispatchPlan,
    operatorHandoffPacket: preview.operatorHandoffPacket,
    acceptanceWorkflow: preview.acceptanceWorkflow,
    clientRuntimeAdoption: preview.clientRuntimeAdoption,
    externalHandoffManifest: preview.externalHandoffManifest,
    lifecycleControls: preview.lifecycleControls,
    nextSteps: preview.nextSteps,
  };
}

export function buildDogfoodPreview(
  program = buildDogfoodProgram(),
  audit = buildDogfoodAudit(program),
  bundle = buildDogfoodBundleReport(),
  options = {},
) {
  const exportSnapshot = createAuditExportSnapshot(bundle, {
    generatedAt: "logical:5",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const timelineState = buildAuditTimelineState(audit, {
    history: options.history ?? [],
  });
  const persistedRecovery = buildDogfoodPersistedRecovery(program, audit, bundle, {
    campaignId: options.campaignId,
    commandStatuses: options.commandStatuses,
    restartToken: options.restartToken,
    resumeCursor: options.resumeCursor,
    recoveredAt: options.recoveredAt,
  });
  const helloProgram = buildHelloWorldProgram();
  const providerContract = buildHelloWorldProviderContract(
    helloProgram,
    buildHelloWorldAudit(helloProgram),
  );
  const dogfoodProviderContract = buildProviderServiceContract(program, {
    checkpoint: exportSnapshot.exportId,
    externalApproval: options.approvalTicket,
    providerResource: "campaign-report",
    supportedCapabilities: options.supportedCapabilities,
  });
  const validation = summarizeDogfoodValidation(program, audit, bundle, exportSnapshot);
  const rollbackContract = buildRollbackContract(program, bundle, {
    adapterStatus: options.adapterHealth,
    adapterCheckedAt: options.adapterCheckedAt ?? "logical:7",
    commandStatuses: options.commandStatuses,
    completedSteps: options.completedSteps,
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
    acceptedAt: options.acceptedAt ?? "logical:6",
  });
  const acceptance = buildDogfoodAcceptance(
    program,
    audit,
    validation,
    persistedRecovery,
    dogfoodProviderContract,
    recoveryStatusHandoff,
    options,
  );
  const adapterDispatchPlan = buildDogfoodAdapterDispatchPlan(
    program,
    audit,
    bundle,
    validation,
    acceptance,
    persistedRecovery,
    dogfoodProviderContract,
    recoveryStatusHandoff,
    options,
  );
  const lifecycleControls = buildDogfoodLifecycleControls(
    program,
    audit,
    validation,
    acceptance,
    persistedRecovery,
    adapterDispatchPlan,
    options,
  );
  const analyticsReport = buildDogfoodAnalyticsReport(
    program,
    audit,
    bundle,
    exportSnapshot,
    timelineState,
    adapterDispatchPlan,
    options,
  );
  const operatorHandoffPacket = buildDogfoodOperatorHandoffPacket(
    program,
    audit,
    validation,
    acceptance,
    persistedRecovery,
    dogfoodProviderContract,
    recoveryStatusHandoff,
    adapterDispatchPlan,
    analyticsReport,
    options,
  );
  const acceptanceWorkflow = buildDogfoodAcceptanceWorkflow(
    program,
    validation,
    acceptance,
    persistedRecovery,
    adapterDispatchPlan,
    lifecycleControls,
    operatorHandoffPacket,
    analyticsReport,
    options,
  );
  const clientRuntimeAdoption = buildDogfoodClientRuntimeAdoption(
    program,
    validation,
    acceptance,
    persistedRecovery,
    dogfoodProviderContract,
    recoveryStatusHandoff,
    adapterDispatchPlan,
    operatorHandoffPacket,
    acceptanceWorkflow,
    analyticsReport,
    options,
  );
  const externalHandoffManifest = buildDogfoodExternalHandoffManifest(
    program,
    validation,
    acceptance,
    persistedRecovery,
    dogfoodProviderContract,
    recoveryStatusHandoff,
    rollbackAcceptance,
    adapterDispatchPlan,
    operatorHandoffPacket,
    acceptanceWorkflow,
    clientRuntimeAdoption,
    analyticsReport,
    options,
  );

  return {
    kind: "mailchimp.dogfood.preview",
    apiVersion: "aios.example/v1",
    title: "Mailchimp campaign audit dogfood",
    jobId: program.job.id,
    status: audit.status,
    readiness: {
      ready: validation.ready && acceptance.accepted && persistedRecovery.restart.ready,
      auditReady: validation.ready,
      accepted: acceptance.accepted,
      restartReady: persistedRecovery.restart.ready,
      recoveryReady: recoveryStatusHandoff.ready,
      rollbackAcceptanceReady: rollbackAcceptance.ready,
      externalHandoffReady: externalHandoffManifest.ready,
      nextAction: acceptance.nextAction,
    },
    providerContract: {
      provider: providerContract.provider,
      negotiation: providerContract.negotiation,
      handoffState: {
        ...providerContract.handoffState,
        dogfoodExportId: exportSnapshot.exportId,
      },
    },
    runtimeHandoff: {
      provider: dogfoodProviderContract.provider,
      negotiation: dogfoodProviderContract.negotiation,
      sync: dogfoodProviderContract.sync,
      handoffState: dogfoodProviderContract.handoffState,
      clientState: dogfoodProviderContract.clientState,
    },
    validation,
    persistedRecovery,
    recovery: {
      contract: rollbackContract,
      summary: summarizeRollbackContract(rollbackContract),
      statusHandoff: recoveryStatusHandoff,
      acceptance: rollbackAcceptance,
    },
    acceptance,
    lifecycleControls,
    adapterDispatchPlan,
    operatorHandoffPacket,
    acceptanceWorkflow,
    clientRuntimeAdoption,
    externalHandoffManifest,
    analyticsReport,
    exportReadySummary: analyticsReport.exportReadySummary,
    timelineReport: analyticsReport.timelineReport,
    timelineState,
    exportSnapshot,
    nextSteps: buildDogfoodNextSteps(
      program,
      validation,
      acceptance,
      persistedRecovery,
      timelineState,
      dogfoodProviderContract,
      recoveryStatusHandoff,
      adapterDispatchPlan,
      lifecycleControls,
      operatorHandoffPacket,
    ),
  };
}

function summarizeDogfoodValidation(program, audit, bundle, exportSnapshot) {
  const errors = [];
  const warnings = [];

  if (!program.lifecycle.validation.valid) {
    errors.push(...program.lifecycle.validation.errors);
  }
  if (audit.evidence.missing.length > 0) {
    errors.push(`${audit.evidence.missing.length} dogfood evidence receipt(s) missing`);
  }
  if (bundle.violations.length > 0) {
    errors.push(`${bundle.violations.length} external write violation(s) observed`);
  }
  if (bundle.missingEvidence.length > 0 && audit.evidence.missing.length === 0) {
    warnings.push(`${bundle.missingEvidence.length} bundled evidence receipt(s) pending`);
  }
  if (!exportSnapshot.truthBoundary.readyForExport) {
    warnings.push("export snapshot is not ready for handoff");
  }

  return {
    ready: errors.length === 0 && exportSnapshot.truthBoundary.readyForExport,
    errors,
    warnings,
    checked: {
      lifecycleValid: program.lifecycle.validation.valid,
      auditStatus: audit.status,
      bundleStatus: bundle.status,
      exportReady: exportSnapshot.truthBoundary.readyForExport,
      memoryWritePolicy: program.job.memory.writePolicy,
    },
  };
}

export function buildDogfoodAnalyticsReport(
  program = buildDogfoodProgram(),
  audit = buildDogfoodAudit(program),
  bundle = buildDogfoodBundleReport(),
  exportSnapshot = createAuditExportSnapshot(bundle, { generatedAt: "logical:5", format: "json.summary" }),
  timelineState = buildAuditTimelineState(audit),
  adapterDispatchPlan = buildDogfoodAdapterDispatchPlan(program, audit, bundle),
  options = {},
) {
  const historySnapshots = normalizeDogfoodHistorySnapshots(options.history, exportSnapshot, audit, bundle);
  const previousSnapshot = historySnapshots.at(-2) ?? null;
  const currentSnapshot = historySnapshots.at(-1);
  const historyTrend = previousSnapshot
    ? {
      evidenceDelta: currentSnapshot.counters.acceptedEvidence - previousSnapshot.counters.acceptedEvidence,
      missingEvidenceDelta: currentSnapshot.counters.missingEvidence - previousSnapshot.counters.missingEvidence,
      violationDelta: currentSnapshot.counters.externalWriteViolations - previousSnapshot.counters.externalWriteViolations,
      readinessChanged: currentSnapshot.ready !== previousSnapshot.ready,
    }
    : {
      evidenceDelta: 0,
      missingEvidenceDelta: 0,
      violationDelta: 0,
      readinessChanged: false,
    };
  const statusCounts = audit.timeline.reduce((counts, event) => ({
    ...counts,
    [event.status]: (counts[event.status] ?? 0) + 1,
  }), {});
  const commandRows = adapterDispatchPlan.rows.map((row) => ({
    id: row.id,
    command: row.command,
    state: row.state,
    ready: row.ready,
    evidenceReady: row.evidenceReady,
    completed: row.completed,
    blockerCount: row.blockers.length,
    checkpoint: row.checkpoint,
  }));
  const blockers = uniqueSorted([
    ...adapterDispatchPlan.blockedReasons,
    ...audit.evidence.missing.map((subject) => `missing evidence: ${subject}`),
    ...bundle.violations.map((violation) => `external write violation: ${violation.subject ?? violation.target ?? violation}`),
  ]);
  const exportReady = exportSnapshot.truthBoundary.readyForExport
    && blockers.length === 0
    && adapterDispatchPlan.summary.blockedRows === 0;
  const exportToken = exportReady ? stableDogfoodToken([
    program.job.id,
    exportSnapshot.exportId,
    currentSnapshot.snapshotId,
    adapterDispatchPlan.dispatch.token,
  ]) : null;
  const timelineReport = buildDogfoodTimelineReport(program, audit, timelineState, historySnapshots, options);

  return {
    kind: "mailchimp.dogfood.analytics-report",
    apiVersion: "aios.analytics/v1",
    jobId: program.job.id,
    generatedAt: String(options.analyticsGeneratedAt ?? "logical:8"),
    ready: exportReady,
    counters: {
      auditTimelineEvents: audit.timeline.length,
      acceptedEvidence: audit.evidence.accepted.length,
      missingEvidence: audit.evidence.missing.length,
      bundledMissingEvidence: bundle.missingEvidence.length,
      externalWriteViolations: bundle.violations.length,
      dispatchRows: adapterDispatchPlan.summary.totalRows,
      dispatchableRows: adapterDispatchPlan.summary.dispatchableRows,
      blockedRows: adapterDispatchPlan.summary.blockedRows,
      historySnapshots: historySnapshots.length,
      statusCounts,
    },
    history: {
      latest: currentSnapshot,
      previous: previousSnapshot,
      trend: historyTrend,
      snapshots: historySnapshots,
    },
    commandRows,
    timelineReport,
    exportReadySummary: {
      exportId: exportSnapshot.exportId,
      format: exportSnapshot.format,
      ready: exportReady,
      token: exportToken,
      command: exportReady ? "dogfood.analytics.export" : "dogfood.analytics.review",
      idempotencyKey: `${program.job.id}:dogfood:analytics:${exportSnapshot.exportId}`,
      blockedReasons: blockers,
      summary: exportReady
        ? `ready:${commandRows.filter((row) => row.ready).length}/${commandRows.length}`
        : `blocked:${blockers.length}`,
    },
    reportState: {
      status: exportReady ? "export-ready" : "needs-review",
      severity: blockers.length > 0
        ? bundle.violations.length > 0 ? "error" : "warning"
        : "ok",
      nextAction: exportReady
        ? "dogfood.analytics.export"
        : adapterDispatchPlan.nextAction,
      lastCompleteTimelineLabel: timelineReport.lastCompleteEvent?.status ?? null,
    },
  };
}

export function buildDogfoodOperatorHandoffPacket(
  program = buildDogfoodProgram(),
  audit = buildDogfoodAudit(program),
  validation = summarizeDogfoodValidation(
    program,
    audit,
    buildDogfoodBundleReport(),
    createAuditExportSnapshot(audit, { generatedAt: "logical:5", format: "json.summary" }),
  ),
  acceptance = { accepted: false, blockedReasons: ["operator acceptance is pending"], nextAction: "accept-preview" },
  persistedRecovery = buildDogfoodPersistedRecovery(program, audit, buildDogfoodBundleReport()),
  providerContract = buildProviderServiceContract(program),
  recoveryStatusHandoff = { ready: false, blockedReasons: ["recovery status handoff is pending"], runtimeCommand: "recovery.review" },
  adapterDispatchPlan = buildDogfoodAdapterDispatchPlan(program, audit, buildDogfoodBundleReport()),
  analyticsReport = buildDogfoodAnalyticsReport(program, audit, buildDogfoodBundleReport()),
  options = {},
) {
  const providerSyncEvidence = createProviderSyncEvidence(audit, providerContract, {
    generatedAt: options.syncEvidenceAt ?? "logical:9",
  });
  const releaseReady = validation.ready
    && acceptance.accepted
    && persistedRecovery.restart.ready
    && providerContract.handoffState.ready
    && recoveryStatusHandoff.ready
    && adapterDispatchPlan.ready
    && analyticsReport.exportReadySummary.ready;
  const blockedReasons = uniqueSorted([
    ...validation.errors,
    ...acceptance.blockedReasons,
    ...persistedRecovery.restart.blockedReasons,
    ...providerContract.handoffState.blockedReasons,
    ...recoveryStatusHandoff.blockedReasons,
    ...adapterDispatchPlan.blockedReasons,
    ...analyticsReport.exportReadySummary.blockedReasons,
    ...(providerSyncEvidence.readiness.ready ? [] : providerSyncEvidence.readiness.blockedReasons),
  ]);
  const commandRows = [
    {
      id: "provider-sync",
      command: "mailchimp.provider-sync.record",
      state: providerSyncEvidence.readiness.ready ? "ready" : "blocked",
      enabled: providerSyncEvidence.readiness.ready,
      idempotencyKey: `${program.job.id}:dogfood:provider-sync:${providerSyncEvidence.receipt}`,
      receipt: providerSyncEvidence.receipt,
      blockers: providerSyncEvidence.readiness.blockedReasons,
    },
    {
      id: "restart-replay",
      command: persistedRecovery.restart.nextAction,
      state: persistedRecovery.restart.ready ? "ready" : "blocked",
      enabled: persistedRecovery.restart.ready && persistedRecovery.restart.replayCommands.length > 0,
      idempotencyKey: `${program.job.id}:dogfood:restart:${persistedRecovery.restartToken}`,
      receipt: persistedRecovery.restartToken,
      blockers: persistedRecovery.restart.blockedReasons,
    },
    {
      id: "adapter-dispatch",
      command: adapterDispatchPlan.dispatch.command,
      state: adapterDispatchPlan.ready ? "ready" : "blocked",
      enabled: releaseReady,
      idempotencyKey: `${program.job.id}:dogfood:adapter:${adapterDispatchPlan.dispatch.token ?? "pending"}`,
      receipt: adapterDispatchPlan.dispatch.token,
      blockers: adapterDispatchPlan.blockedReasons,
    },
    {
      id: "analytics-export",
      command: analyticsReport.exportReadySummary.command,
      state: analyticsReport.exportReadySummary.ready ? "ready" : "blocked",
      enabled: releaseReady,
      idempotencyKey: analyticsReport.exportReadySummary.idempotencyKey,
      receipt: analyticsReport.exportReadySummary.token,
      blockers: analyticsReport.exportReadySummary.blockedReasons,
    },
  ];
  const activeRow = commandRows.find((row) => row.enabled)
    ?? commandRows.find((row) => row.state === "blocked")
    ?? commandRows[0];
  const handoffToken = releaseReady ? stableDogfoodToken([
    program.job.id,
    providerSyncEvidence.receipt,
    persistedRecovery.restartToken,
    adapterDispatchPlan.dispatch.token,
    analyticsReport.exportReadySummary.token,
  ]) : null;

  return {
    kind: "mailchimp.dogfood.operator-handoff-packet",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready: releaseReady,
    status: releaseReady ? "ready-for-external-handoff" : "waiting-for-operator-handoff",
    nextAction: releaseReady ? "dogfood.operator-handoff.release" : activeRow.command,
    providerSync: {
      receipt: providerSyncEvidence.receipt,
      ready: providerSyncEvidence.readiness.ready,
      checkpoint: providerContract.sync.checkpoint,
      cursor: providerContract.sync.cursor,
      localNamespace: providerContract.sync.localNamespace,
    },
    release: {
      command: releaseReady ? "dogfood.operator-handoff.release" : activeRow.command,
      enabled: releaseReady,
      token: handoffToken,
      idempotencyKey: `${program.job.id}:dogfood:operator-handoff:${providerSyncEvidence.receipt}`,
      acceptedBy: acceptance.acceptedBy,
      restartToken: releaseReady ? persistedRecovery.restartToken : null,
      adapterDispatchToken: releaseReady ? adapterDispatchPlan.dispatch.token : null,
      exportToken: releaseReady ? analyticsReport.exportReadySummary.token : null,
    },
    clientState: {
      badge: releaseReady
        ? "handoff-ready"
        : acceptance.accepted ? "accepted-needs-review" : "awaiting-acceptance",
      primaryAction: activeRow.command,
      canDispatch: releaseReady,
      canReplay: persistedRecovery.restart.ready && persistedRecovery.restart.replayCommands.length > 0,
      canExport: analyticsReport.exportReadySummary.ready,
      blockedReasons,
    },
    summary: {
      commandRows: commandRows.length,
      enabledRows: commandRows.filter((row) => row.enabled).length,
      blockedRows: commandRows.filter((row) => row.blockers.length > 0).length,
      replayCommands: persistedRecovery.restart.replayCommands.length,
      dispatchRows: adapterDispatchPlan.summary.dispatchableRows,
    },
    commandRows,
    blockedReasons,
  };
}

function normalizeDogfoodHistorySnapshots(history = [], exportSnapshot, audit, bundle) {
  const snapshots = (history ?? []).map((entry, index) => {
    const status = String(entry.status ?? entry.label ?? "unknown");
    const acceptedEvidence = Number(entry.acceptedEvidence ?? entry.evidenceAccepted ?? 0);
    const missingEvidence = Number(entry.missingEvidence ?? 0);
    const externalWriteViolations = Number(entry.externalWriteViolations ?? entry.violations ?? 0);

    return {
      snapshotId: String(entry.snapshotId ?? entry.id ?? `history:${index + 1}`),
      at: String(entry.at ?? entry.generatedAt ?? `logical:history:${index + 1}`),
      status,
      ready: Boolean(entry.ready ?? (missingEvidence === 0 && externalWriteViolations === 0)),
      counters: {
        acceptedEvidence,
        missingEvidence,
        externalWriteViolations,
      },
      classification: classifyDogfoodHistory(status, missingEvidence, externalWriteViolations),
    };
  });

  snapshots.push({
    snapshotId: String(exportSnapshot.exportId),
    at: String(exportSnapshot.generatedAt ?? "logical:5"),
    status: audit.status,
    ready: exportSnapshot.truthBoundary.readyForExport && bundle.violations.length === 0,
    counters: {
      acceptedEvidence: audit.evidence.accepted.length,
      missingEvidence: bundle.missingEvidence.length,
      externalWriteViolations: bundle.violations.length,
    },
    classification: classifyDogfoodHistory(audit.status, bundle.missingEvidence.length, bundle.violations.length),
  });

  return snapshots;
}

function classifyDogfoodHistory(status, missingEvidence, externalWriteViolations) {
  if (externalWriteViolations > 0) {
    return "truth-boundary-violation";
  }
  if (missingEvidence > 0) {
    return "evidence-pending";
  }
  if (status === "completed") {
    return "complete";
  }
  return "in-progress";
}

function buildDogfoodTimelineReport(program, audit, timelineState, historySnapshots, options) {
  const eventRows = audit.timeline.map((event, index) => ({
    index,
    status: event.status,
    at: event.at,
    message: event.message,
    terminal: index === audit.timeline.length - 1,
    exportAnchor: `${program.job.id}:timeline:${index + 1}`,
  }));
  const lastCompleteEvent = [...eventRows].reverse().find((event) => (
    event.status === "completed" || event.status === "verifying"
  )) ?? null;
  const stalled = Boolean(options.timelineStalled ?? false)
    || (timelineState.current?.status !== "completed" && audit.status === "completed");

  return {
    kind: "mailchimp.dogfood.timeline-report",
    current: timelineState.current,
    nextAction: stalled ? "timeline.status.reconcile" : timelineState.nextAction,
    stalled,
    historyWindow: {
      firstSnapshotAt: historySnapshots[0]?.at ?? null,
      latestSnapshotAt: historySnapshots.at(-1)?.at ?? null,
      size: historySnapshots.length,
    },
    lastCompleteEvent,
    rows: eventRows,
  };
}

export function buildDogfoodAcceptanceWorkflow(
  program = buildDogfoodProgram(),
  validation = {
    ready: false,
    errors: ["dogfood validation was not evaluated"],
    warnings: [],
    checked: {},
  },
  acceptance = {
    accepted: false,
    acceptedBy: null,
    acceptedAt: null,
    blockedReasons: ["operator acceptance is pending"],
    nextAction: "accept-preview",
  },
  persistedRecovery = buildDogfoodPersistedRecovery(program, buildDogfoodAudit(program), buildDogfoodBundleReport()),
  adapterDispatchPlan = buildDogfoodAdapterDispatchPlan(program, buildDogfoodAudit(program), buildDogfoodBundleReport()),
  lifecycleControls = buildDogfoodLifecycleControls(program),
  operatorHandoffPacket = buildDogfoodOperatorHandoffPacket(program),
  analyticsReport = buildDogfoodAnalyticsReport(program, buildDogfoodAudit(program), buildDogfoodBundleReport()),
  options = {},
) {
  const routeBase = String(options.routeBase ?? "/mailchimp/dogfood");
  const accepted = Boolean(acceptance.accepted);
  const exportReady = Boolean(analyticsReport.exportReadySummary?.ready);
  const sections = [
    {
      id: "validation",
      label: "Validation",
      state: validation.ready ? "ready" : "blocked",
      command: validation.ready ? "dogfood.validation.confirm" : "dogfood.validation.review",
      route: `${routeBase}/validation`,
      idempotencyKey: `${program.job.id}:dogfood:workflow:validation:${stableDogfoodToken(validation.errors ?? [])}`,
      blockers: validation.errors ?? [],
      warnings: validation.warnings ?? [],
      summary: validation.ready
        ? "Lifecycle, audit, bundle, and export checks are ready."
        : `${validation.errors?.length ?? 0} validation blocker(s) require review.`,
    },
    {
      id: "restart",
      label: "Restart state",
      state: persistedRecovery.restart.ready
        ? persistedRecovery.restart.replayCommands.length > 0 ? "ready-to-replay" : "complete"
        : "blocked",
      command: persistedRecovery.restart.nextAction,
      route: `${routeBase}/restart`,
      idempotencyKey: `${program.job.id}:dogfood:workflow:restart:${persistedRecovery.restartToken}`,
      blockers: persistedRecovery.restart.blockedReasons,
      replayCommands: persistedRecovery.restart.replayCommands,
      summary: `${persistedRecovery.commandLedger.counts.completed}/${persistedRecovery.commandLedger.counts.total} command(s) completed`,
    },
    {
      id: "acceptance",
      label: "Acceptance",
      state: accepted ? "accepted" : validation.ready ? "pending" : "blocked",
      command: "dogfood.preview.accept",
      route: `${routeBase}/acceptance`,
      idempotencyKey: `${program.job.id}:dogfood:workflow:accept:${stableDogfoodToken([
        acceptance.acceptedBy,
        persistedRecovery.restartToken,
      ])}`,
      blockers: accepted ? [] : acceptance.blockedReasons,
      acceptedBy: acceptance.acceptedBy,
      acceptedAt: acceptance.acceptedAt,
      summary: accepted
        ? `Accepted by ${acceptance.acceptedBy ?? "operator"}.`
        : "Operator acceptance is required before adapter dispatch.",
    },
    {
      id: "dispatch",
      label: "Adapter dispatch",
      state: adapterDispatchPlan.ready
        ? adapterDispatchPlan.summary.dispatchableRows > 0 ? "dispatch-ready" : "already-applied"
        : "blocked",
      command: adapterDispatchPlan.dispatch.command,
      route: `${routeBase}/dispatch`,
      idempotencyKey: `${program.job.id}:dogfood:workflow:dispatch:${adapterDispatchPlan.dispatch.token ?? "pending"}`,
      blockers: adapterDispatchPlan.blockedReasons,
      adapter: adapterDispatchPlan.adapter,
      summary: `${adapterDispatchPlan.summary.dispatchableRows}/${adapterDispatchPlan.summary.totalRows} row(s) dispatchable`,
    },
    {
      id: "export",
      label: "Export",
      state: exportReady ? "ready" : "blocked",
      command: analyticsReport.exportReadySummary.command,
      route: `${routeBase}/export`,
      idempotencyKey: analyticsReport.exportReadySummary.idempotencyKey,
      blockers: analyticsReport.exportReadySummary.blockedReasons,
      receipt: analyticsReport.exportReadySummary.token,
      summary: analyticsReport.exportReadySummary.summary,
    },
  ];
  const blockedReasons = uniqueSorted([
    ...sections.flatMap((section) => section.blockers ?? []),
    ...operatorHandoffPacket.blockedReasons,
    ...lifecycleControls.blockedReasons,
  ]);
  const releaseReady = accepted
    && validation.ready
    && persistedRecovery.restart.ready
    && adapterDispatchPlan.ready
    && operatorHandoffPacket.ready
    && lifecycleControls.ready
    && exportReady
    && blockedReasons.length === 0;
  const activeSection = sections.find((section) => section.state === "blocked")
    ?? sections.find((section) => section.state === "pending" || section.state === "ready-to-replay")
    ?? sections.find((section) => section.state === "dispatch-ready")
    ?? sections[sections.length - 1];
  const commandRows = sections.map((section, index) => ({
    id: section.id,
    command: section.command,
    state: section.state,
    route: section.route,
    enabled: releaseReady ? section.id === "export" : section.id === activeSection.id,
    ordinal: index + 1,
    idempotencyKey: section.idempotencyKey,
    blockers: section.blockers ?? [],
  }));
  const releaseToken = releaseReady ? stableDogfoodToken([
    program.job.id,
    operatorHandoffPacket.release.token,
    analyticsReport.exportReadySummary.token,
    adapterDispatchPlan.dispatch.token,
  ]) : null;

  return {
    kind: "mailchimp.dogfood.acceptance-workflow",
    apiVersion: "aios.ui/v1",
    jobId: program.job.id,
    ready: releaseReady,
    status: releaseReady ? "ready-to-release" : "needs-operator-action",
    routeState: {
      base: routeBase,
      activeRoute: activeSection.route,
      badge: releaseReady
        ? "release-ready"
        : accepted ? "accepted-needs-review" : "awaiting-acceptance",
      primaryAction: releaseReady ? "dogfood.operator-handoff.release" : activeSection.command,
    },
    progress: {
      totalSections: sections.length,
      readySections: sections.filter((section) => (
        section.state === "ready"
        || section.state === "accepted"
        || section.state === "complete"
        || section.state === "already-applied"
        || section.state === "dispatch-ready"
      )).length,
      blockedSections: sections.filter((section) => section.state === "blocked").length,
      pendingSections: sections.filter((section) => section.state === "pending").length,
    },
    release: {
      command: releaseReady ? "dogfood.operator-handoff.release" : activeSection.command,
      enabled: releaseReady,
      token: releaseToken,
      idempotencyKey: `${program.job.id}:dogfood:workflow:release:${operatorHandoffPacket.providerSync.receipt}`,
      acceptedBy: acceptance.acceptedBy,
      exportToken: releaseReady ? analyticsReport.exportReadySummary.token : null,
      dispatchToken: releaseReady ? adapterDispatchPlan.dispatch.token : null,
    },
    clientState: {
      canAccept: !accepted && validation.ready && persistedRecovery.restart.ready,
      canReplay: persistedRecovery.restart.replayCommands.length > 0,
      canDispatch: adapterDispatchPlan.ready && accepted,
      canExport: exportReady && accepted,
      nextActionLabel: activeSection.label,
      blockedReasons,
    },
    sections,
    commandRows,
    blockedReasons,
  };
}

export function buildDogfoodClientRuntimeAdoption(
  program = buildDogfoodProgram(),
  validation = {
    ready: false,
    errors: ["dogfood validation was not evaluated"],
    warnings: [],
  },
  acceptance = {
    accepted: false,
    acceptedBy: null,
    acceptedAt: null,
    blockedReasons: ["operator acceptance is pending"],
  },
  persistedRecovery = buildDogfoodPersistedRecovery(program, buildDogfoodAudit(program), buildDogfoodBundleReport()),
  providerContract = buildProviderServiceContract(program),
  recoveryStatusHandoff = { ready: false, blockedReasons: ["recovery status handoff is pending"], runtimeCommand: "recovery.review" },
  adapterDispatchPlan = buildDogfoodAdapterDispatchPlan(program, buildDogfoodAudit(program), buildDogfoodBundleReport()),
  operatorHandoffPacket = buildDogfoodOperatorHandoffPacket(program),
  acceptanceWorkflow = buildDogfoodAcceptanceWorkflow(program),
  analyticsReport = buildDogfoodAnalyticsReport(program, buildDogfoodAudit(program), buildDogfoodBundleReport()),
  options = {},
) {
  const clientId = String(options.clientId ?? "mailchimp-dogfood-console");
  const routeBase = acceptanceWorkflow.routeState?.base ?? String(options.routeBase ?? "/mailchimp/dogfood");
  const releaseReady = validation.ready
    && acceptance.accepted
    && persistedRecovery.restart.ready
    && providerContract.handoffState.ready
    && recoveryStatusHandoff.ready
    && adapterDispatchPlan.ready
    && operatorHandoffPacket.ready
    && acceptanceWorkflow.ready
    && analyticsReport.exportReadySummary.ready;
  const rows = [
    {
      id: "provider-handoff",
      command: providerContract.handoffState.runtimeCommand ?? "provider.handoff.review",
      state: providerContract.handoffState.ready ? "ready" : "blocked",
      route: `${routeBase}/provider`,
      token: providerContract.handoffState.handoffToken ?? null,
      idempotencyKey: `${program.job.id}:dogfood:client:provider:${providerContract.sync.checkpoint}`,
      blockers: providerContract.handoffState.blockedReasons,
    },
    {
      id: "restart-replay",
      command: persistedRecovery.restart.nextAction,
      state: persistedRecovery.restart.ready
        ? persistedRecovery.restart.replayCommands.length > 0 ? "ready-to-replay" : "complete"
        : "blocked",
      route: `${routeBase}/restart`,
      token: persistedRecovery.restartToken,
      idempotencyKey: `${program.job.id}:dogfood:client:restart:${persistedRecovery.restartToken}`,
      blockers: persistedRecovery.restart.blockedReasons,
    },
    {
      id: "operator-release",
      command: operatorHandoffPacket.release.command,
      state: operatorHandoffPacket.ready ? "ready" : "blocked",
      route: `${routeBase}/handoff`,
      token: operatorHandoffPacket.release.token,
      idempotencyKey: operatorHandoffPacket.release.idempotencyKey,
      blockers: operatorHandoffPacket.blockedReasons,
    },
    {
      id: "adapter-dispatch",
      command: adapterDispatchPlan.dispatch.command,
      state: adapterDispatchPlan.ready
        ? adapterDispatchPlan.summary.dispatchableRows > 0 ? "dispatch-ready" : "already-applied"
        : "blocked",
      route: `${routeBase}/dispatch`,
      token: adapterDispatchPlan.dispatch.token,
      idempotencyKey: `${program.job.id}:dogfood:client:dispatch:${adapterDispatchPlan.dispatch.token ?? "pending"}`,
      blockers: adapterDispatchPlan.blockedReasons,
    },
    {
      id: "analytics-export",
      command: analyticsReport.exportReadySummary.command,
      state: analyticsReport.exportReadySummary.ready ? "ready" : "blocked",
      route: `${routeBase}/export`,
      token: analyticsReport.exportReadySummary.token,
      idempotencyKey: analyticsReport.exportReadySummary.idempotencyKey,
      blockers: analyticsReport.exportReadySummary.blockedReasons,
    },
  ];
  const blockedReasons = uniqueSorted([
    ...validation.errors,
    ...acceptance.blockedReasons,
    ...recoveryStatusHandoff.blockedReasons,
    ...rows.flatMap((row) => row.blockers),
  ]);
  const activeRow = rows.find((row) => row.state === "blocked")
    ?? rows.find((row) => row.state === "ready-to-replay" || row.state === "dispatch-ready")
    ?? rows.find((row) => row.state === "ready")
    ?? rows[0];
  const adoptionReady = releaseReady && blockedReasons.length === 0;
  const adoptionToken = adoptionReady ? stableDogfoodToken([
    clientId,
    program.job.id,
    providerContract.handoffState.handoffToken,
    persistedRecovery.restartToken,
    operatorHandoffPacket.release.token,
    adapterDispatchPlan.dispatch.token,
    analyticsReport.exportReadySummary.token,
  ]) : null;

  return {
    kind: "mailchimp.dogfood.client-runtime-adoption",
    apiVersion: "aios.client/v1",
    jobId: program.job.id,
    clientId,
    ready: adoptionReady,
    status: adoptionReady
      ? "runtime-adoption-ready"
      : acceptance.accepted ? "accepted-runtime-review" : "awaiting-operator-acceptance",
    routeState: {
      base: routeBase,
      activeRoute: activeRow.route,
      badge: adoptionReady
        ? "runtime-ready"
        : acceptance.accepted ? "runtime-review" : "acceptance-required",
      primaryAction: adoptionReady ? "dogfood.client-runtime.adopt" : activeRow.command,
    },
    persistedClientState: {
      key: `${program.job.memory.namespace}:dogfood:client:${clientId}:${program.job.id}`,
      token: adoptionToken,
      idempotencyKey: `${program.job.id}:dogfood:client-runtime:${clientId}`,
      resumeCursor: persistedRecovery.resumeCursor,
      restartToken: persistedRecovery.restartToken,
      adapterDispatchToken: adapterDispatchPlan.dispatch.token,
      exportToken: analyticsReport.exportReadySummary.token,
      providerCheckpoint: providerContract.sync.checkpoint,
    },
    controls: {
      canAccept: !acceptance.accepted && validation.ready && persistedRecovery.restart.ready,
      canReplay: persistedRecovery.restart.replayCommands.length > 0,
      canRelease: operatorHandoffPacket.ready && acceptanceWorkflow.ready,
      canDispatch: adapterDispatchPlan.ready && acceptance.accepted,
      canExport: analyticsReport.exportReadySummary.ready && acceptance.accepted,
    },
    summary: {
      totalRows: rows.length,
      readyRows: rows.filter((row) => row.state === "ready" || row.state === "complete").length,
      blockedRows: rows.filter((row) => row.blockers.length > 0).length,
      replayCommands: persistedRecovery.restart.replayCommands.length,
      dispatchableRows: adapterDispatchPlan.summary.dispatchableRows,
    },
    rows,
    blockedReasons,
  };
}

export function buildDogfoodExternalHandoffManifest(
  program = buildDogfoodProgram(),
  validation = {
    ready: false,
    errors: ["dogfood validation was not evaluated"],
    warnings: [],
  },
  acceptance = {
    accepted: false,
    acceptedBy: null,
    acceptedAt: null,
    blockedReasons: ["operator acceptance is pending"],
  },
  persistedRecovery = buildDogfoodPersistedRecovery(program, buildDogfoodAudit(program), buildDogfoodBundleReport()),
  providerContract = buildProviderServiceContract(program),
  recoveryStatusHandoff = { ready: false, blockedReasons: ["recovery status handoff is pending"], runtimeCommand: "recovery.review" },
  rollbackAcceptance = { ready: false, blockedReasons: ["rollback acceptance is pending"], nextAction: "rollback.preview.accept", acceptance: { idempotencyKey: `${program.job.id}:rollback:accept` } },
  adapterDispatchPlan = buildDogfoodAdapterDispatchPlan(program, buildDogfoodAudit(program), buildDogfoodBundleReport()),
  operatorHandoffPacket = buildDogfoodOperatorHandoffPacket(program),
  acceptanceWorkflow = buildDogfoodAcceptanceWorkflow(program),
  clientRuntimeAdoption = buildDogfoodClientRuntimeAdoption(program),
  analyticsReport = buildDogfoodAnalyticsReport(program, buildDogfoodAudit(program), buildDogfoodBundleReport()),
  options = {},
) {
  const manifestId = stableDogfoodToken([
    "external-handoff",
    program.job.id,
    persistedRecovery.restartToken,
    providerContract.sync?.checkpoint,
    adapterDispatchPlan.dispatch?.token,
    operatorHandoffPacket.release?.token,
    analyticsReport.exportReadySummary?.token,
  ]);
  const releaseReady = validation.ready
    && acceptance.accepted
    && persistedRecovery.restart.ready
    && providerContract.handoffState.ready
    && recoveryStatusHandoff.ready
    && rollbackAcceptance.ready
    && adapterDispatchPlan.ready
    && operatorHandoffPacket.ready
    && acceptanceWorkflow.ready
    && clientRuntimeAdoption.ready
    && analyticsReport.exportReadySummary.ready;
  const capabilityRows = uniqueSorted([
    ...(providerContract.negotiation?.requestedCapabilities ?? []),
    ...program.job.capabilities,
  ]).map((capability) => {
    const granted = providerContract.negotiation?.grantedCapabilities?.includes(capability) ?? false;
    return {
      capability,
      granted,
      source: capability.startsWith("mailchimp:") ? "mailchimp-provider" : "aios-runtime",
      action: granted ? "use-provider-capability" : "review-provider-capability",
    };
  });
  const syncRows = [
    {
      id: "provider-sync",
      state: providerContract.sync?.ready === false ? "blocked" : "ready",
      command: "mailchimp.provider-sync.record",
      checkpoint: providerContract.sync?.checkpoint ?? null,
      cursor: providerContract.sync?.cursor ?? null,
      idempotencyKey: `${program.job.id}:dogfood:manifest:provider:${providerContract.sync?.checkpoint ?? "pending"}`,
    },
    {
      id: "restart-state",
      state: persistedRecovery.restart.ready ? "ready" : "blocked",
      command: persistedRecovery.restart.nextAction,
      checkpoint: persistedRecovery.restartToken,
      cursor: persistedRecovery.resumeCursor,
      idempotencyKey: `${program.job.id}:dogfood:manifest:restart:${persistedRecovery.restartToken}`,
    },
    {
      id: "rollback-acceptance",
      state: rollbackAcceptance.ready ? "accepted" : rollbackAcceptance.status ?? "blocked",
      command: rollbackAcceptance.nextAction,
      checkpoint: rollbackAcceptance.acceptance?.idempotencyKey ?? null,
      cursor: recoveryStatusHandoff.restartToken ?? null,
      idempotencyKey: rollbackAcceptance.acceptance?.idempotencyKey ?? `${program.job.id}:dogfood:manifest:rollback`,
    },
    {
      id: "adapter-dispatch",
      state: adapterDispatchPlan.ready ? adapterDispatchPlan.status : "blocked",
      command: adapterDispatchPlan.dispatch.command,
      checkpoint: adapterDispatchPlan.dispatch.token,
      cursor: adapterDispatchPlan.dispatch.key,
      idempotencyKey: `${program.job.id}:dogfood:manifest:adapter:${adapterDispatchPlan.dispatch.token ?? "pending"}`,
    },
    {
      id: "operator-release",
      state: operatorHandoffPacket.ready ? "ready" : "blocked",
      command: operatorHandoffPacket.release.command,
      checkpoint: operatorHandoffPacket.release.token,
      cursor: operatorHandoffPacket.providerSync.receipt,
      idempotencyKey: operatorHandoffPacket.release.idempotencyKey,
    },
    {
      id: "analytics-export",
      state: analyticsReport.exportReadySummary.ready ? "ready" : "blocked",
      command: analyticsReport.exportReadySummary.command,
      checkpoint: analyticsReport.exportReadySummary.token,
      cursor: analyticsReport.exportReadySummary.exportId,
      idempotencyKey: analyticsReport.exportReadySummary.idempotencyKey,
    },
  ];
  const blockedReasons = uniqueSorted([
    ...validation.errors,
    ...acceptance.blockedReasons,
    ...persistedRecovery.restart.blockedReasons,
    ...providerContract.handoffState.blockedReasons,
    ...recoveryStatusHandoff.blockedReasons,
    ...rollbackAcceptance.blockedReasons,
    ...adapterDispatchPlan.blockedReasons,
    ...operatorHandoffPacket.blockedReasons,
    ...acceptanceWorkflow.blockedReasons,
    ...clientRuntimeAdoption.blockedReasons,
    ...analyticsReport.exportReadySummary.blockedReasons,
    ...capabilityRows
      .filter((row) => !row.granted)
      .map((row) => `provider capability denied: ${row.capability}`),
  ]);
  const activeRow = syncRows.find((row) => row.state === "blocked")
    ?? syncRows.find((row) => row.state === "accepted" || row.state === "ready")
    ?? syncRows[0];
  const ready = releaseReady && blockedReasons.length === 0;

  return {
    kind: "mailchimp.dogfood.external-handoff-manifest",
    apiVersion: "aios.integration/v1",
    manifestId,
    jobId: program.job.id,
    ready,
    status: ready ? "ready-for-provider-handoff" : "handoff-review-required",
    nextAction: ready ? "dogfood.external-handoff.release" : activeRow.command,
    provider: providerContract.provider,
    negotiation: {
      requestedCapabilities: providerContract.negotiation?.requestedCapabilities ?? [],
      grantedCapabilities: providerContract.negotiation?.grantedCapabilities ?? [],
      deniedCapabilities: providerContract.negotiation?.deniedCapabilities ?? [],
      capabilityRows,
    },
    sync: {
      direction: "local-to-provider",
      ready,
      checkpoint: analyticsReport.exportReadySummary.exportId,
      cursor: `${persistedRecovery.restartToken}:${adapterDispatchPlan.dispatch.token ?? "pending"}`,
      stateKey: persistedRecovery.snapshotKey,
      restartToken: persistedRecovery.restartToken,
      providerCheckpoint: providerContract.sync?.checkpoint ?? null,
      adapterDispatchToken: adapterDispatchPlan.dispatch.token,
      operatorReleaseToken: operatorHandoffPacket.release.token,
      analyticsExportToken: analyticsReport.exportReadySummary.token,
    },
    release: {
      command: ready ? "dogfood.external-handoff.release" : activeRow.command,
      enabled: ready,
      token: ready ? manifestId : null,
      idempotencyKey: `${program.job.id}:dogfood:external-handoff:${manifestId}`,
      acceptedBy: acceptance.acceptedBy,
      acceptedAt: acceptance.acceptedAt,
      dryRun: Boolean(options.dryRun ?? program.lifecycle.dryRun),
    },
    clientState: {
      badge: ready ? "external-handoff-ready" : "handoff-review",
      primaryAction: ready ? "dogfood.external-handoff.release" : activeRow.command,
      activeRoute: clientRuntimeAdoption.routeState?.activeRoute ?? acceptanceWorkflow.routeState?.activeRoute,
      disabledReason: ready ? null : blockedReasons[0] ?? "external handoff is not ready",
      canRelease: ready,
      canReplay: persistedRecovery.restart.replayCommands.length > 0,
      canDispatch: adapterDispatchPlan.ready && acceptance.accepted,
      canExport: analyticsReport.exportReadySummary.ready && acceptance.accepted,
    },
    syncRows,
    blockedReasons,
    counters: {
      syncRows: syncRows.length,
      readyRows: syncRows.filter((row) => row.state === "ready" || row.state === "accepted").length,
      blockedRows: syncRows.filter((row) => row.state === "blocked").length,
      grantedCapabilities: capabilityRows.filter((row) => row.granted).length,
      deniedCapabilities: capabilityRows.filter((row) => !row.granted).length,
      replayCommands: persistedRecovery.restart.replayCommands.length,
    },
    truthBoundary: {
      externalWrites: false,
      source: "mailchimp-dogfood-external-handoff",
      memoryWritePolicy: program.job.memory.writePolicy,
      providerSyncRequiresRuntimeAdapter: true,
    },
  };
}

function buildDogfoodAcceptance(
  program,
  audit,
  validation,
  persistedRecovery,
  providerContract,
  recoveryStatusHandoff,
  options,
) {
  const acceptedBy = options.acceptedBy ? String(options.acceptedBy) : null;
  const accepted = Boolean(options.accepted ?? false)
    && validation.ready
    && persistedRecovery.restart.ready
    && providerContract.handoffState.ready
    && recoveryStatusHandoff.ready;
  const approvalRequired = program.lifecycle.enabled
    && program.lifecycle.commandQueue.some((command) => command.command === "package.approval.request");

  return {
    accepted,
    acceptedBy,
    acceptedAt: accepted ? String(options.acceptedAt ?? "logical:6") : null,
    approvalRequired,
    blockedReasons: [
      ...validation.errors,
      ...(persistedRecovery.restart.ready === false
        ? ["persisted recovery state is not restart-ready"]
        : []),
      ...providerContract.handoffState.blockedReasons,
      ...recoveryStatusHandoff.blockedReasons,
      ...(approvalRequired && !program.lifecycle.commandQueue.some((command) => command.command === "package.preview")
        ? ["lifecycle approval is pending"]
        : []),
    ],
    nextAction: accepted
      ? "handoff-export-summary"
      : !persistedRecovery.restart.ready
      ? persistedRecovery.restart.nextAction
      : recoveryStatusHandoff.ready === false
        ? recoveryStatusHandoff.runtimeCommand
      : validation.ready && providerContract.handoffState.ready
        ? "collect-operator-acceptance"
        : providerContract.handoffState.nextAction,
    auditReceiptCount: audit.evidence.accepted.length,
    handoffToken: accepted ? providerContract.handoffState.handoffToken : null,
  };
}

function buildDogfoodPersistedRecovery(program, audit, bundle, options = {}) {
  const campaignId = String(options.campaignId ?? "campaign:dogfood");
  const statusByName = new Map(Object.entries(options.commandStatuses ?? {}));
  const baseKey = `${program.job.id}:${campaignId}`;
  const commands = [
    {
      id: "load-campaign",
      name: "mailchimp.campaign.read",
      idempotencyKey: `${baseKey}:load-campaign`,
      checkpoint: `${baseKey}:checkpoint:campaign`,
      requiredEvidence: "step:load-campaign",
      rollbackAction: null,
    },
    {
      id: "load-report",
      name: "mailchimp.report.read",
      idempotencyKey: `${baseKey}:load-report`,
      checkpoint: `${baseKey}:checkpoint:report`,
      requiredEvidence: "step:load-report",
      rollbackAction: null,
    },
    {
      id: "emit-status",
      name: "status.timeline.local.write",
      idempotencyKey: `${baseKey}:emit-status`,
      checkpoint: `${baseKey}:checkpoint:status`,
      requiredEvidence: "step:emit-status",
      rollbackAction: "status.timeline.local.retract",
    },
  ].map((command) => {
    const status = String(statusByName.get(command.id) ?? statusByName.get(command.name) ?? "pending");
    return {
      ...command,
      status,
      replayable: true,
      completed: status === "completed" || status === "succeeded",
      failed: status === "failed",
    };
  });
  const checkpoints = commands.map((command) => ({
    key: command.checkpoint,
    commandId: command.id,
    status: command.completed ? "completed" : command.failed ? "failed" : "pending",
    required: true,
  }));
  const failedCommands = commands.filter((command) => command.failed);
  const pendingCommands = commands.filter((command) => !command.completed && !command.failed);
  const replayCommands = pendingCommands.filter((command) => command.replayable);
  const missingEvidence = [
    ...audit.evidence.missing,
    ...bundle.missingEvidence.filter((subject) => !audit.evidence.missing.includes(subject)),
  ];
  const externalViolationCount = bundle.violations.length;
  const restartSafe = failedCommands.length === 0
    && externalViolationCount === 0
    && commands.every((command) => command.replayable && command.idempotencyKey);
  const ready = restartSafe && missingEvidence.length === 0;
  const status = ready
    ? replayCommands.length > 0
      ? "replay-ready"
      : "complete"
    : failedCommands.length > 0
      ? "operator-review"
      : "blocked";

  return {
    kind: "mailchimp.dogfood.persisted-recovery",
    snapshotKey: `aios:mailchimp:dogfood:${program.job.id}:${campaignId}`,
    restartToken: String(options.restartToken ?? `${baseKey}:restart`),
    resumeCursor: String(options.resumeCursor ?? `${baseKey}:cursor:${commands.filter((command) => command.completed).length}`),
    recoveredAt: options.recoveredAt ? String(options.recoveredAt) : null,
    commandLedger: {
      commands,
      checkpoints,
      counts: {
        total: commands.length,
        completed: commands.filter((command) => command.completed).length,
        pending: pendingCommands.length,
        failed: failedCommands.length,
        replayable: replayCommands.length,
      },
    },
    restart: {
      ready,
      safe: restartSafe,
      status,
      nextAction: ready
        ? replayCommands.length > 0
          ? "replay-idempotent-commands"
          : "export-status"
        : "collect-missing-evidence",
      replayCommands: replayCommands.map((command) => ({
        id: command.id,
        name: command.name,
        idempotencyKey: command.idempotencyKey,
        checkpoint: command.checkpoint,
      })),
      blockedReasons: [
        ...missingEvidence.map((subject) => `missing evidence: ${subject}`),
        ...failedCommands.map((command) => `failed command: ${command.id}`),
        ...(externalViolationCount > 0 ? [`${externalViolationCount} external write violation(s)`] : []),
      ],
    },
  };
}

function buildDogfoodNextSteps(
  program,
  validation,
  acceptance,
  persistedRecovery,
  timelineState,
  providerContract,
  recoveryStatusHandoff,
  adapterDispatchPlan,
  lifecycleControls = null,
  operatorHandoffPacket = null,
) {
  if (operatorHandoffPacket && !operatorHandoffPacket.ready && operatorHandoffPacket.clientState.canDispatch === false) {
    return operatorHandoffPacket.blockedReasons.map((reason) => ({
      action: operatorHandoffPacket.nextAction,
      label: "Resolve operator handoff",
      reason,
    }));
  }

  if (lifecycleControls && !lifecycleControls.ready) {
    return lifecycleControls.blockedReasons.map((reason) => ({
      action: lifecycleControls.nextAction,
      label: "Resolve dogfood lifecycle controls",
      reason,
    }));
  }

  if (!program.lifecycle.enabled) {
    return [{
      action: "enable-package",
      label: "Enable dogfood package",
      reason: "lifecycle controls are disabled",
    }];
  }

  if (!validation.ready) {
    return validation.errors.map((error) => ({
      action: "fix-validation",
      label: "Resolve validation issue",
      reason: error,
    }));
  }

  if (!persistedRecovery.restart.ready) {
    return persistedRecovery.restart.blockedReasons.map((reason) => ({
      action: persistedRecovery.restart.nextAction,
      label: "Recover persisted Mailchimp state",
      reason,
    }));
  }

  if (persistedRecovery.restart.replayCommands.length > 0) {
    return persistedRecovery.restart.replayCommands.map((command) => ({
      action: "replay-idempotent-command",
      label: command.name,
      reason: `restart-safe replay for ${command.checkpoint}`,
    }));
  }

  if (!providerContract.handoffState.ready) {
    return providerContract.handoffState.blockedReasons.map((reason) => ({
      action: providerContract.handoffState.nextAction,
      label: "Resolve Mailchimp handoff",
      reason,
    }));
  }

  if (!recoveryStatusHandoff.ready) {
    return recoveryStatusHandoff.blockedReasons.map((reason) => ({
      action: recoveryStatusHandoff.runtimeCommand,
      label: "Prepare recovery status handoff",
      reason,
    }));
  }

  if (!adapterDispatchPlan.ready) {
    return adapterDispatchPlan.blockedReasons.map((reason) => ({
      action: adapterDispatchPlan.nextAction,
      label: "Prepare adapter dispatch",
      reason,
    }));
  }

  if (!acceptance.accepted) {
    return [{
      action: "accept-preview",
      label: "Accept preview",
      reason: "audit is ready but operator acceptance is still pending",
    }];
  }

  return [{
    action: timelineState.nextAction,
    label: "Export audit summary",
    reason: "preview accepted and truth boundary is ready",
  }];
}

export function buildDogfoodLifecycleControls(
  program = buildDogfoodProgram(),
  audit = buildDogfoodAudit(program),
  validation = summarizeDogfoodValidation(
    program,
    audit,
    buildDogfoodBundleReport(),
    createAuditExportSnapshot(audit, { generatedAt: "logical:5", format: "json.summary" }),
  ),
  acceptance = { accepted: false, blockedReasons: ["operator acceptance is pending"] },
  persistedRecovery = buildDogfoodPersistedRecovery(program, audit, buildDogfoodBundleReport()),
  adapterDispatchPlan = buildDogfoodAdapterDispatchPlan(program, audit, buildDogfoodBundleReport()),
  options = {},
) {
  const settings = normalizeDogfoodLifecycleSettings(program, options);
  const validationState = validateDogfoodLifecycleSettings(
    program,
    audit,
    validation,
    acceptance,
    persistedRecovery,
    adapterDispatchPlan,
    settings,
  );
  const controlsReady = validationState.errors.length === 0;
  const commandRows = [
    {
      id: "enable",
      command: "dogfood.lifecycle.enable",
      enabled: !program.lifecycle.enabled && settings.enabled && controlsReady,
      state: program.lifecycle.enabled ? "already-enabled" : settings.enabled ? "ready" : "not-requested",
      idempotencyKey: `${program.job.id}:dogfood:lifecycle:enable:${settings.settingsToken}`,
      nextAction: "dogfood.lifecycle.configure",
    },
    {
      id: "disable",
      command: "dogfood.lifecycle.disable",
      enabled: program.lifecycle.enabled && !settings.enabled && validationState.canDisable,
      state: !program.lifecycle.enabled ? "already-disabled" : !settings.enabled ? "ready" : "not-requested",
      idempotencyKey: `${program.job.id}:dogfood:lifecycle:disable:${settings.settingsToken}`,
      nextAction: "dogfood.lifecycle.disable",
    },
    {
      id: "schedule",
      command: "dogfood.lifecycle.schedule.update",
      enabled: controlsReady && settings.schedule.valid,
      state: settings.schedule.valid ? "ready" : "blocked",
      idempotencyKey: `${program.job.id}:dogfood:lifecycle:schedule:${settings.settingsToken}`,
      nextAction: settings.schedule.mode === "manual" ? "dogfood.manual-run" : "dogfood.schedule",
    },
    {
      id: "accept",
      command: "dogfood.preview.accept",
      enabled: controlsReady && validation.ready && persistedRecovery.restart.ready && !settings.accepted,
      state: settings.accepted
        ? "accepted"
        : validation.ready && persistedRecovery.restart.ready ? "ready" : "blocked",
      idempotencyKey: `${program.job.id}:dogfood:lifecycle:accept:${settings.settingsToken}`,
      nextAction: "accept-preview",
    },
    {
      id: "dispatch",
      command: adapterDispatchPlan.dispatch.command,
      enabled: controlsReady && settings.accepted && adapterDispatchPlan.ready,
      state: adapterDispatchPlan.ready
        ? settings.accepted ? "ready" : "waiting-for-acceptance"
        : "blocked",
      idempotencyKey: `${program.job.id}:dogfood:lifecycle:dispatch:${adapterDispatchPlan.dispatch.token ?? "pending"}`,
      nextAction: adapterDispatchPlan.nextAction,
    },
    {
      id: "export",
      command: "dogfood.analytics.export",
      enabled: controlsReady && settings.accepted && adapterDispatchPlan.ready && audit.status === "completed",
      state: audit.status === "completed"
        ? settings.accepted && adapterDispatchPlan.ready ? "ready" : "waiting-for-dispatch"
        : "waiting-for-audit",
      idempotencyKey: `${program.job.id}:dogfood:lifecycle:export:${settings.settingsToken}`,
      nextAction: "dogfood.analytics.export",
    },
  ];
  const blockedReasons = uniqueSorted([
    ...validationState.errors,
    ...commandRows
      .filter((row) => row.state === "blocked")
      .map((row) => `${row.command} is blocked`),
  ]);
  const activeCommand = commandRows.find((row) => row.enabled)
    ?? commandRows.find((row) => row.state === "blocked")
    ?? commandRows.find((row) => row.state === "ready")
    ?? commandRows[0];

  return {
    kind: "mailchimp.dogfood.lifecycle-controls",
    apiVersion: "aios.control/v1",
    jobId: program.job.id,
    ready: blockedReasons.length === 0,
    desiredState: settings.enabled ? "enabled" : "disabled",
    currentState: program.lifecycle.enabled ? "enabled" : "disabled",
    nextAction: activeCommand.nextAction,
    activeCommand: activeCommand.command,
    settings,
    validation: validationState,
    controls: {
      canEnable: commandRows.find((row) => row.id === "enable").enabled,
      canDisable: commandRows.find((row) => row.id === "disable").enabled,
      canSchedule: commandRows.find((row) => row.id === "schedule").enabled,
      canAccept: commandRows.find((row) => row.id === "accept").enabled,
      canDispatch: commandRows.find((row) => row.id === "dispatch").enabled,
      canExport: commandRows.find((row) => row.id === "export").enabled,
    },
    commandRows,
    blockedReasons,
  };
}

function normalizeDogfoodLifecycleSettings(program, options) {
  const schedule = normalizeDogfoodSchedule(options.schedule ?? program.lifecycle.schedule);
  const maxRuntimeSteps = Number(options.maxRuntimeSteps ?? program.lifecycle.maxRuntimeSteps ?? 20);
  const evidenceTtlSeconds = Math.max(60, Number(options.evidenceTtlSeconds ?? 600));
  const exportWindowSeconds = Math.max(30, Number(options.exportWindowSeconds ?? 120));
  const enabled = Boolean(options.enabled ?? program.lifecycle.enabled);
  const accepted = Boolean(options.accepted ?? false);
  const settingsToken = stableDogfoodToken([
    program.job.id,
    enabled,
    accepted,
    schedule.mode,
    schedule.intervalSeconds,
    schedule.at,
    maxRuntimeSteps,
    evidenceTtlSeconds,
    exportWindowSeconds,
    options.approvalTicket,
  ]);

  return {
    enabled,
    accepted,
    dryRun: Boolean(options.dryRun ?? program.lifecycle.dryRun),
    requireApproval: Boolean(options.requireApproval ?? program.lifecycle.requireApproval),
    approvalTicket: options.approvalTicket ? String(options.approvalTicket) : null,
    maxRuntimeSteps,
    evidenceTtlSeconds,
    exportWindowSeconds,
    schedule,
    settingsToken,
  };
}

function normalizeDogfoodSchedule(schedule = { mode: "manual" }) {
  const mode = String(schedule?.mode ?? "manual").trim().toLowerCase();
  const intervalSeconds = schedule?.intervalSeconds == null ? null : Number(schedule.intervalSeconds);
  const at = schedule?.at == null ? null : String(schedule.at);
  const validModes = new Set(["manual", "interval", "once"]);
  const valid = validModes.has(mode)
    && (mode !== "interval" || Number.isFinite(intervalSeconds))
    && (mode !== "once" || Boolean(at));

  return {
    mode: validModes.has(mode) ? mode : "invalid",
    intervalSeconds: Number.isFinite(intervalSeconds) ? intervalSeconds : null,
    at,
    valid,
  };
}

function validateDogfoodLifecycleSettings(
  program,
  audit,
  validation,
  acceptance,
  persistedRecovery,
  adapterDispatchPlan,
  settings,
) {
  const errors = uniqueSorted([
    ...(settings.schedule.valid ? [] : ["dogfood schedule is invalid"]),
    ...(settings.schedule.mode === "interval" && settings.schedule.intervalSeconds < 120
      ? ["dogfood interval must be at least 120 seconds"]
      : []),
    ...(settings.maxRuntimeSteps < program.job.plan.length
      ? [`dogfood maxRuntimeSteps must cover ${program.job.plan.length} plan steps`]
      : []),
    ...(settings.evidenceTtlSeconds <= settings.exportWindowSeconds
      ? ["dogfood evidence ttl must be greater than export window"]
      : []),
    ...(settings.requireApproval && !settings.approvalTicket
      ? ["dogfood approval ticket is required"]
      : []),
    ...(validation.ready ? [] : validation.errors),
    ...(persistedRecovery.restart.ready ? [] : persistedRecovery.restart.blockedReasons),
    ...(adapterDispatchPlan.summary.blockedRows > 0 ? adapterDispatchPlan.blockedReasons : []),
  ]);
  const warnings = uniqueSorted([
    ...validation.warnings,
    ...(audit.status === "completed" && !acceptance.accepted
      ? ["dogfood preview is ready but not accepted"]
      : []),
    ...(settings.dryRun ? ["dogfood lifecycle is in dry-run mode"] : []),
    ...(settings.enabled ? [] : ["dogfood lifecycle is disabled"]),
  ]);

  return {
    valid: errors.length === 0,
    canDisable: audit.status !== "running" || adapterDispatchPlan.dispatch.enabled === false,
    errors,
    warnings,
    checked: {
      lifecycleValid: program.lifecycle.validation.valid,
      scheduleMode: settings.schedule.mode,
      maxRuntimeSteps: settings.maxRuntimeSteps,
      planSteps: program.job.plan.length,
      evidenceTtlSeconds: settings.evidenceTtlSeconds,
      exportWindowSeconds: settings.exportWindowSeconds,
      restartReady: persistedRecovery.restart.ready,
      adapterDispatchReady: adapterDispatchPlan.ready,
    },
  };
}

export function buildDogfoodAdapterDispatchPlan(
  program = buildDogfoodProgram(),
  audit = buildDogfoodAudit(program),
  bundle = buildDogfoodBundleReport(),
  validation = summarizeDogfoodValidation(
    program,
    audit,
    bundle,
    createAuditExportSnapshot(bundle, { generatedAt: "logical:5", format: "json.summary" }),
  ),
  acceptance = { accepted: false, blockedReasons: ["operator acceptance is pending"] },
  persistedRecovery = buildDogfoodPersistedRecovery(program, audit, bundle),
  providerContract = buildProviderServiceContract(program),
  recoveryStatusHandoff = { ready: false, blockedReasons: ["recovery status handoff is pending"], runtimeCommand: "recovery.review" },
  options = {},
) {
  const adapter = normalizeDogfoodAdapterStatus(options.adapterHealth, options.adapterRetryAfterSeconds);
  const evidenceMissing = new Set([
    ...audit.evidence.missing,
    ...bundle.missingEvidence,
  ]);
  const externalWriteSubjects = bundle.violations.map((violation) => String(
    violation.subject ?? violation.target ?? violation,
  ));
  const ready = validation.ready
    && acceptance.accepted
    && persistedRecovery.restart.ready
    && providerContract.handoffState.ready
    && recoveryStatusHandoff.ready
    && adapter.status !== "offline";
  const dispatchKey = `${program.job.memory.namespace}:dogfood:dispatch:${program.job.id}`;
  const rows = program.job.plan.map((step, index) => {
    const missing = evidenceMissing.has(`step:${step.op}`)
      || Object.keys(step.verifierHints).some((hint) => evidenceMissing.has(hint));
    const priorCommand = persistedRecovery.commandLedger.commands.find((command) => (
      command.id === step.op || command.id === step.id || command.name.endsWith(step.op)
    ));
    const replayCandidate = persistedRecovery.restart.replayCommands.find((command) => (
      command.id === priorCommand?.id || command.checkpoint === priorCommand?.checkpoint
    ));
    const completed = priorCommand?.completed ?? (audit.status === "completed" && !missing);
    const dispatchCommand = step.op === "emit-status"
      ? "status.timeline.local.write"
      : step.op === "load-report"
        ? "mailchimp.report.read"
        : step.op === "load-campaign"
          ? "mailchimp.campaign.read"
          : step.op;
    const rowReady = ready && !missing && !priorCommand?.failed;
    const rowToken = stableDogfoodToken([
      dispatchKey,
      step.id,
      step.op,
      providerContract.handoffState.handoffToken,
      recoveryStatusHandoff.restartToken,
    ]);

    return {
      id: step.id,
      command: dispatchCommand,
      sourceStep: step.op,
      state: priorCommand?.failed
        ? "failed"
        : rowReady
          ? completed ? "already-applied" : "ready-to-dispatch"
          : missing ? "blocked"
            : completed ? "waiting-for-acceptance" : "waiting-for-replay",
      ready: rowReady,
      completed,
      evidenceReady: !missing,
      checkpoint: replayCandidate?.checkpoint ?? priorCommand?.checkpoint ?? `${dispatchKey}:checkpoint:${index + 1}`,
      idempotencyKey: replayCandidate?.idempotencyKey
        ?? priorCommand?.idempotencyKey
        ?? `${program.job.id}:dogfood:dispatch:${index + 1}:${rowToken}`,
      resumeCursor: `${program.job.id}:dogfood:dispatch:${index + 1}`,
      verifierClaimCount: Object.keys(step.verifierHints).length,
      blockers: uniqueSorted([
        ...(missing ? [`dispatch evidence missing: ${step.op}`] : []),
        ...(priorCommand?.failed ? [`dispatch command failed: ${priorCommand.id}`] : []),
        ...(validation.ready ? [] : validation.errors),
        ...(acceptance.accepted ? [] : ["operator acceptance is pending"]),
        ...(persistedRecovery.restart.ready ? [] : persistedRecovery.restart.blockedReasons),
        ...(providerContract.handoffState.ready ? [] : providerContract.handoffState.blockedReasons),
        ...(recoveryStatusHandoff.ready ? [] : recoveryStatusHandoff.blockedReasons),
        ...(adapter.status === "offline" ? ["dogfood adapter is offline"] : []),
      ]),
    };
  });
  const blockedReasons = uniqueSorted([
    ...rows.flatMap((row) => row.blockers),
    ...externalWriteSubjects.map((subject) => `external write violation observed: ${subject}`),
  ]);
  const dispatchableRows = rows.filter((row) => row.ready && row.state !== "already-applied");

  return {
    kind: "mailchimp.dogfood.adapter-dispatch-plan",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready: ready && blockedReasons.length === 0,
    status: ready && blockedReasons.length === 0
      ? dispatchableRows.length > 0 ? "dispatch-ready" : "already-applied"
      : adapter.status === "offline" ? "adapter-offline" : "dispatch-blocked",
    nextAction: ready && blockedReasons.length === 0
      ? "handoff-export-summary"
      : adapter.status === "degraded"
        ? "adapter.status.poll"
        : recoveryStatusHandoff.ready === false
          ? recoveryStatusHandoff.runtimeCommand
          : acceptance.accepted ? "dogfood.dispatch.review" : "accept-preview",
    adapter: {
      name: program.job.runtimeAdapter,
      status: adapter.status,
      handoff: adapter.handoff,
      retryAfterSeconds: adapter.retryAfterSeconds,
    },
    dispatch: {
      command: ready && blockedReasons.length === 0 ? "dogfood.adapter.dispatch" : "dogfood.dispatch.review",
      enabled: ready && blockedReasons.length === 0,
      key: dispatchKey,
      token: ready && blockedReasons.length === 0
        ? stableDogfoodToken([
          dispatchKey,
          providerContract.handoffState.handoffToken,
          recoveryStatusHandoff.restartToken,
          rows.map((row) => `${row.id}:${row.state}`).join(","),
        ])
        : null,
      handoffToken: ready && blockedReasons.length === 0 ? providerContract.handoffState.handoffToken : null,
    },
    acceptance: {
      required: true,
      accepted: acceptance.accepted,
      acceptedBy: acceptance.acceptedBy,
      command: "accept-preview",
      idempotencyKey: `${program.job.id}:dogfood:dispatch:accept`,
    },
    summary: {
      totalRows: rows.length,
      dispatchableRows: dispatchableRows.length,
      blockedRows: rows.filter((row) => row.blockers.length > 0).length,
      externalWriteViolations: externalWriteSubjects.length,
      blockedReasons,
    },
    rows,
    blockedReasons,
  };
}

function normalizeDogfoodAdapterStatus(status = "healthy", retryAfterSeconds = 30) {
  const normalized = String(status ?? "healthy").trim().toLowerCase();
  const safeStatus = ["healthy", "degraded", "offline"].includes(normalized) ? normalized : "offline";

  return {
    status: safeStatus,
    handoff: safeStatus === "healthy" ? "available" : safeStatus === "degraded" ? "deferred" : "blocked",
    retryAfterSeconds: safeStatus === "degraded" ? Number(retryAfterSeconds) : null,
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function stableDogfoodToken(parts) {
  const input = parts.map((part) => String(part ?? "")).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `dog_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
