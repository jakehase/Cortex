import {
  createAuditExportSnapshot,
  createEvidence,
  createProviderSyncEvidence,
  createStatusEvent,
  createTruthBoundaryReport,
} from "../stdlib/audit.mjs";
import {
  buildPackageRuntimeAdoptionSnapshot,
  buildProviderServiceContract,
  compilePackageSource,
} from "../stdlib/packages.mjs";
import {
  buildRollbackAudit,
  buildRollbackHandoffContract,
  buildRollbackProgram,
} from "./rollback-job.mjs";

export const verifierClaimJobSource = `# deterministic Mailchimp verifier claim export
use mailchimp:campaign.read
use mailchimp:report.read
use memory:campaign.local
use verifier:evidence.record
use audit:truth-boundary.write
use status:timeline.write
recover rollback=status-only retry=0
step collect-provider-receipts input=auditId output=providerReceipts verify.source=mailchimp
step collect-local-receipts input=providerReceipts output=localReceipts verify.boundary=local-only
step bind-rollback-reference input=localReceipts output=rollbackReference verify.status=rollback-linked
step export-verifier-claim input=rollbackReference output=verifierClaim verify.claim=truth-boundary
`;

export function buildVerifierClaimProgram(options = {}) {
  return compilePackageSource(verifierClaimJobSource, {
    name: options.name ?? "mailchimp-verifier-claim-job",
    version: options.version ?? "0.1.0",
    description: "Compile a Mailchimp verifier claim job that binds provider sync evidence to rollback state.",
    capabilities: options.capabilities ?? [],
    exports: {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      verifierClaim: "./examples/verifier-claim-job.mjs#buildVerifierClaimPacket",
      verifierClaimState: "./examples/verifier-claim-job.mjs#buildVerifierClaimPersistedState",
      rollbackContract: "./examples/rollback-job.mjs#buildRollbackHandoffContract",
    },
  }, {
    name: "mailchimp-verifier-claim-job",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: options.dryRun ?? true,
      requireApproval: options.requireApproval ?? false,
      approvalTicket: options.approvalTicket,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 10,
    },
  });
}

export function buildVerifierClaimAudit(program = buildVerifierClaimProgram(), options = {}) {
  const missing = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missing.has(subject))
    .map((subject) => createEvidence(
      subject.includes("verify.source")
        ? "mailchimp-read-receipt"
        : subject.includes("verify.claim")
          ? "operator-attestation"
          : "runtime-local-receipt",
      subject,
      { surface: "verifier-claim-job", claim: "truth-boundary" },
    ));

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "completed",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "verifier claim queued" }),
      createStatusEvent("running", { at: "logical:1", message: "provider and local receipts collected" }),
      createStatusEvent("verifying", { at: "logical:2", message: "rollback reference bound" }),
      createStatusEvent(options.status ?? "completed", {
        at: "logical:3",
        message: "verifier claim exported",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildVerifierClaimPacket(
  program = buildVerifierClaimProgram(),
  audit = buildVerifierClaimAudit(program),
  options = {},
) {
  const rollbackProgram = options.rollbackProgram ?? buildRollbackProgram(options);
  const rollbackAudit = options.rollbackAudit ?? buildRollbackAudit(rollbackProgram, {
    ...options,
    status: options.rollbackStatus ?? "rolled_back",
  });
  const rollbackContract = options.rollbackContract
    ?? buildRollbackHandoffContract(rollbackProgram, rollbackAudit, {
      ...options,
      accepted: options.rollbackAccepted ?? true,
      acceptedBy: options.acceptedBy ?? "verifier-claim",
      allowMissingRestartToken: options.allowMissingRestartToken ?? true,
    });
  const exportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:9",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const providerContract = buildProviderServiceContract(program, {
    externalApproval: options.approvalTicket,
    providerResource: "campaign-report-verifier-claim",
    supportedCapabilities: options.supportedCapabilities,
    checkpoint: exportSnapshot.exportId,
    direction: "provider-metadata-only",
  });
  const syncEvidence = createProviderSyncEvidence(audit, providerContract, {
    generatedAt: options.syncEvidenceAt ?? "logical:10",
  });
  const claims = buildVerifierClaims(program, audit, rollbackContract, syncEvidence);
  const workspaceBoundary = buildVerifierClaimWorkspaceBoundary(
    program,
    rollbackContract,
    providerContract,
    options,
  );
  const rollbackAcceptance = buildVerifierRollbackAcceptanceHandoff(
    program,
    rollbackContract,
    workspaceBoundary,
    options,
  );
  const providerServiceReceipt = buildVerifierProviderServiceReceipt(
    program,
    providerContract,
    workspaceBoundary,
    options.installHandoffBridge ?? options.packageInstallHandoff ?? options.providerServiceHandoff,
    options,
  );
  const validation = validateVerifierClaimPacket(
    program,
    audit,
    exportSnapshot,
    providerContract,
    rollbackContract,
    syncEvidence,
    claims,
    workspaceBoundary,
    rollbackAcceptance,
    providerServiceReceipt,
  );
  const analyticsExport = buildVerifierClaimAnalyticsExport(
    program,
    audit,
    exportSnapshot,
    rollbackContract,
    syncEvidence,
    claims,
    workspaceBoundary,
    validation,
    {
      ...options,
      rollbackAcceptance,
    },
  );
  const acceptancePreview = buildVerifierClaimAcceptancePreview(
    program,
    validation,
    rollbackContract,
    syncEvidence,
    claims,
    workspaceBoundary,
    analyticsExport,
    {
      ...options,
      rollbackAcceptance,
    },
  );
  const persistedState = buildVerifierClaimPersistedState(
    program,
    validation,
    rollbackContract,
    claims,
    syncEvidence,
    exportSnapshot,
    workspaceBoundary,
    analyticsExport,
    acceptancePreview,
    {
      ...options,
      rollbackAcceptance,
    },
  );
  const restartCommandLedger = buildVerifierClaimRestartCommandLedger(
    program,
    validation,
    rollbackContract,
    syncEvidence,
    claims,
    workspaceBoundary,
    analyticsExport,
    acceptancePreview,
    persistedState,
    {
      ...options,
      rollbackAcceptance,
    },
  );
  const runtimeAdoption = buildPackageRuntimeAdoptionSnapshot(program, {
    providerContract,
    acceptance: {
      accepted: validation.ready,
      acceptedBy: validation.ready ? String(options.acceptedBy ?? "verifier-claim") : null,
      acceptedAt: validation.ready ? String(options.acceptedAt ?? "logical:11") : null,
    },
    persistedState,
    clientState: {
      ready: persistedState.ready,
      status: persistedState.status,
      runtime: {
        command: persistedState.restart.command,
        enabled: persistedState.restart.enabled,
        idempotencyKey: persistedState.restart.idempotencyKey,
        persistedRestartToken: persistedState.restart.token,
      },
      summary: {
        blockedReasons: validation.blockedReasons,
        rollbackAcceptanceStatus: rollbackAcceptance.status,
        rollbackAcceptanceReference: rollbackAcceptance.verifierClaimReference,
        providerServiceStatus: providerServiceReceipt.status,
        providerServiceReceipt: providerServiceReceipt.receipt,
      },
    },
    externalHandoff: {
      status: validation.ready ? "verifier-claim-export-ready" : "verifier-claim-export-pending",
      ready: validation.ready,
      reference: validation.ready ? persistedState.restart.token : null,
      nextAction: validation.ready ? "verifier.claim.export" : validation.nextAction,
      blockedReasons: validation.blockedReasons,
      rollbackAcceptanceReference: rollbackAcceptance.verifierClaimReference,
      providerServiceReceipt: providerServiceReceipt.receipt,
      providerServiceReplayKey: providerServiceReceipt.replay.replayKey,
      restartLedgerId: restartCommandLedger.ledgerId,
    },
  });

  return deepFreeze({
    kind: "mailchimp.verifier-claim.packet",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready: validation.ready,
    statusEvent: validation.ready ? "completed" : "verifying",
    claimToken: validation.ready ? stableToken([
      program.job.id,
      workspaceBoundary.scopeKey,
      exportSnapshot.exportId,
      rollbackContract.rollbackToken,
      syncEvidence.receipt,
    ]) : null,
    provider: providerContract.provider,
    sync: {
      checkpoint: providerContract.sync.checkpoint,
      direction: providerContract.sync.direction,
      externalHandoff: "verifier-claim",
      memoryWritePolicy: providerContract.sync.memoryWritePolicy,
    },
    rollbackReference: {
      jobId: rollbackContract.jobId,
      rollbackToken: rollbackContract.rollbackToken,
      statusEvent: rollbackContract.statusEvent,
    },
    workspaceBoundary,
    rollbackAcceptance,
    providerServiceReceipt,
    claims,
    syncEvidence,
    analyticsExport,
    acceptancePreview,
    restartCommandLedger,
    exportSnapshot,
    validation,
    persistedState,
    runtimeAdoption,
    nextSteps: buildVerifierClaimNextSteps(validation),
  });
}

export function buildVerifierClaimPersistedState(
  program = buildVerifierClaimProgram(),
  validationOrPacket = buildVerifierClaimPacket(program),
  rollbackContract,
  claims,
  syncEvidence,
  exportSnapshot,
  workspaceBoundary,
  analyticsExport,
  acceptancePreview,
  options = {},
) {
  const packetMode = validationOrPacket.kind === "mailchimp.verifier-claim.packet";
  const validation = packetMode ? validationOrPacket.validation : validationOrPacket;
  const sourceRollback = packetMode ? validationOrPacket.rollbackReference : rollbackContract;
  const sourceClaims = packetMode ? validationOrPacket.claims : claims;
  const sourceSyncEvidence = packetMode ? validationOrPacket.syncEvidence : syncEvidence;
  const snapshot = packetMode ? validationOrPacket.exportSnapshot : exportSnapshot;
  const analyticsOptionsMode = analyticsExport
    && analyticsExport.kind !== "mailchimp.verifier-claim.analytics-export"
    && !analyticsExport.exportId;
  const optionsMode = workspaceBoundary
    && workspaceBoundary.kind !== "mailchimp.verifier-claim.workspace-boundary"
    && !workspaceBoundary.scopeKey;
  const acceptanceOptionsMode = acceptancePreview
    && acceptancePreview.kind !== "mailchimp.verifier-claim.acceptance-preview"
    && !acceptancePreview.previewId;
  const stateOptions = analyticsOptionsMode
    ? analyticsExport
    : optionsMode
      ? workspaceBoundary
      : acceptanceOptionsMode ? acceptancePreview : options;
  const boundary = packetMode
    ? validationOrPacket.workspaceBoundary
    : optionsMode
      ? buildVerifierClaimWorkspaceBoundary(program, rollbackContract, null, stateOptions)
      : workspaceBoundary ?? buildVerifierClaimWorkspaceBoundary(program, rollbackContract, null, stateOptions);
  const sourceAnalytics = packetMode
    ? validationOrPacket.analyticsExport
    : analyticsExport?.kind === "mailchimp.verifier-claim.analytics-export"
      ? analyticsExport
      : buildVerifierClaimAnalyticsExport(
        program,
        buildVerifierClaimAudit(program, stateOptions),
        snapshot,
        rollbackContract,
        sourceSyncEvidence,
        sourceClaims,
        boundary,
        validation,
        stateOptions,
      );
  const preview = packetMode
    ? validationOrPacket.acceptancePreview
    : acceptancePreview?.kind === "mailchimp.verifier-claim.acceptance-preview"
      ? acceptancePreview
      : buildVerifierClaimAcceptancePreview(
        program,
        validation,
        rollbackContract,
        sourceSyncEvidence,
        sourceClaims,
        boundary,
        sourceAnalytics,
        stateOptions,
      );
  const rollbackAcceptance = packetMode
    ? validationOrPacket.rollbackAcceptance
    : stateOptions.rollbackAcceptance
      ?? buildVerifierRollbackAcceptanceHandoff(program, rollbackContract, boundary, stateOptions);
  const acceptedClaims = sourceClaims.filter((claim) => claim.verdict === "accepted");
  const pendingClaims = sourceClaims.filter((claim) => claim.verdict !== "accepted");
  const persistedAt = String(stateOptions.persistedAt ?? "logical:11");
  const stateKey = `${boundary.scopeKey}:verifier-claim:${snapshot?.exportId ?? "pending"}`;
  const claimRows = sourceClaims.map((claim) => ({
    subject: claim.subject,
    state: claim.verdict,
    receipt: claim.receipt,
    persistedKey: `${stateKey}:${stableToken([boundary.tenantId, boundary.workspaceId, claim.subject])}`,
    restartSafe: boundary.ready && claim.verdict === "accepted" && Boolean(claim.receipt),
    requires: claim.requires,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
  }));
  const blockedReasons = validation.blockedReasons;
  const ready = blockedReasons.length === 0;

  return deepFreeze({
    kind: "mailchimp.verifier-claim.persisted-state",
    apiVersion: "aios.state/v1",
    jobId: program.job.id,
    stateKey,
    status: ready ? "claim-export-ready" : "claim-export-blocked",
    persistedAt,
    ready,
    tenant: {
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      scopeKey: boundary.scopeKey,
      role: boundary.role,
      permissions: boundary.permissions,
      auditHandoff: boundary.auditHandoff,
      rollbackAcceptance: {
        status: rollbackAcceptance.status,
        accepted: rollbackAcceptance.accepted,
        readyForVerifierClaim: rollbackAcceptance.readyForVerifierClaim,
        verifierClaimReference: rollbackAcceptance.verifierClaimReference,
      },
    },
    restart: {
      command: ready ? "verifier.claim.export" : validation.nextAction,
      enabled: ready,
      token: ready ? stableToken([
        program.job.id,
        boundary.scopeKey,
        sourceRollback.rollbackToken ?? sourceRollback.rollbackReference?.rollbackToken,
        sourceSyncEvidence.receipt,
        acceptedClaims.length,
      ]) : null,
      idempotencyKey: `${program.job.id}:verifier-claim:restart:${snapshot?.exportId ?? "pending"}`,
    },
    rollbackReference: {
      jobId: sourceRollback.jobId,
      rollbackToken: sourceRollback.rollbackToken,
      statusEvent: sourceRollback.statusEvent,
      clientRuntimeReady: sourceRollback.clientRuntimeState?.ready ?? null,
      acceptancePreviewId: rollbackAcceptance.previewId,
      acceptanceStatus: rollbackAcceptance.status,
      acceptanceReference: rollbackAcceptance.verifierClaimReference,
    },
    syncEvidence: {
      receipt: sourceSyncEvidence.receipt,
      ready: sourceSyncEvidence.readiness.ready,
      blockedReasons: sourceSyncEvidence.readiness.blockedReasons,
    },
    summary: {
      acceptedClaims: acceptedClaims.length,
      pendingClaims: pendingClaims.length,
      totalClaims: sourceClaims.length,
      tenantScopedClaims: claimRows.filter((claim) => claim.tenantId === boundary.tenantId).length,
      blockedReasons,
      analyticsExportReady: sourceAnalytics.ready,
      acceptancePreviewReady: preview.ready,
      rollbackAcceptanceReady: rollbackAcceptance.readyForVerifierClaim,
      timelineEvents: sourceAnalytics.counters.timelineEvents,
      exportableClaims: sourceAnalytics.counters.exportableClaims,
    },
    acceptancePreview: {
      previewId: preview.previewId,
      status: preview.status,
      ready: preview.ready,
      primaryAction: preview.client.primaryAction,
      accepted: preview.acceptance.accepted,
      blockedReasons: preview.validation.blockedReasons,
    },
    analyticsExport: {
      exportId: sourceAnalytics.exportId,
      ready: sourceAnalytics.ready,
      counters: sourceAnalytics.counters,
      timeline: sourceAnalytics.timeline,
      report: sourceAnalytics.report,
    },
    claims: claimRows,
    commands: buildVerifierClaimPersistedCommands(validation, claimRows, ready, snapshot, boundary),
  });
}

export function describeVerifierClaimJob(options = {}) {
  const program = buildVerifierClaimProgram(options);
  const audit = buildVerifierClaimAudit(program, options);
  const packet = buildVerifierClaimPacket(program, audit, options);

  return deepFreeze({
    jobId: packet.jobId,
    ready: packet.ready,
    statusEvent: packet.statusEvent,
    claimToken: packet.claimToken,
    provider: packet.provider,
    rollbackReference: packet.rollbackReference,
    workspaceBoundary: packet.workspaceBoundary,
    rollbackAcceptance: packet.rollbackAcceptance,
    providerServiceReceipt: packet.providerServiceReceipt,
    analyticsExport: packet.analyticsExport,
    restartCommandLedger: packet.restartCommandLedger,
    claims: packet.claims.map((claim) => ({
      subject: claim.subject,
      verdict: claim.verdict,
      receipt: claim.receipt,
    })),
    persistedState: packet.persistedState,
    acceptancePreview: packet.acceptancePreview,
    runtimeAdoption: {
      adoptionKey: packet.runtimeAdoption.adoptionKey,
      ready: packet.runtimeAdoption.ready,
      status: packet.runtimeAdoption.status,
      nextAction: packet.runtimeAdoption.nextAction,
      primaryAction: packet.runtimeAdoption.clientState.primaryAction,
      restartSafe: packet.runtimeAdoption.clientState.restartSafe,
      blockedReasons: packet.runtimeAdoption.validation.blockedReasons,
    },
    blockedReasons: packet.validation.blockedReasons,
    nextSteps: packet.nextSteps,
  });
}

export function selfCheckVerifierClaimJob(options = {}) {
  const packet = buildVerifierClaimPacket(
    buildVerifierClaimProgram(options),
    buildVerifierClaimAudit(buildVerifierClaimProgram(options), options),
    {
      approvalTicket: "self_check_approval",
      acceptedBy: "self-check",
      ...options,
    },
  );

  return deepFreeze({
    kind: "mailchimp.verifier-claim.self-check",
    apiVersion: "aios.example/v1",
    passed: packet.ready,
    errors: packet.validation.blockedReasons,
    jobId: packet.jobId,
    claimToken: packet.claimToken,
  });
}

function buildVerifierClaims(program, audit, rollbackContract, syncEvidence) {
  const acceptedSubjects = new Set(audit.evidence.accepted.map((entry) => entry.subject));

  return program.job.verifier.requiredEvidence.map((subject) => {
    const present = acceptedSubjects.has(subject);
    const providerBound = subject.includes("verify.source")
      ? syncEvidence.readiness.ready
      : true;
    const rollbackBound = subject.includes("verify.status")
      ? Boolean(rollbackContract.rollbackToken)
      : true;

    return {
      subject,
      verdict: present && providerBound && rollbackBound ? "accepted" : "pending",
      receipt: present ? stableToken([program.job.id, subject, syncEvidence.receipt]) : null,
      requires: {
        providerSync: subject.includes("verify.source"),
        rollbackReference: subject.includes("verify.status"),
        localBoundary: subject.includes("verify.boundary") || subject.includes("verify.claim"),
      },
    };
  });
}

function validateVerifierClaimPacket(
  program,
  audit,
  exportSnapshot,
  providerContract,
  rollbackContract,
  syncEvidence,
  claims,
  workspaceBoundary,
  rollbackAcceptance,
  providerServiceReceipt,
) {
  const blockedReasons = uniqueSorted([
    ...(program.lifecycle.validation.valid ? [] : program.lifecycle.validation.errors),
    ...(providerContract.handoffState.ready ? [] : providerContract.handoffState.blockedReasons),
    ...(syncEvidence.readiness.ready ? [] : syncEvidence.readiness.blockedReasons),
    ...(rollbackContract.rollbackToken ? [] : ["rollback token required before verifier claim export"]),
    ...(workspaceBoundary.ready ? [] : workspaceBoundary.blockedReasons),
    ...(rollbackAcceptance.readyForVerifierClaim ? [] : rollbackAcceptance.blockedReasons),
    ...(providerServiceReceipt.ready ? [] : providerServiceReceipt.blockedReasons),
    ...(exportSnapshot.truthBoundary.readyForExport ? [] : [exportSnapshot.summary]),
    ...audit.boundary.externalWritesObserved.map((write) => `external write observed: ${write.target}`),
    ...claims
      .filter((claim) => claim.verdict !== "accepted")
      .map((claim) => `verifier claim pending: ${claim.subject}`),
  ]);

  return {
    ready: blockedReasons.length === 0,
    nextAction: blockedReasons.some((reason) => reason.includes("rollback token"))
      ? "rollback.accept-handoff"
      : blockedReasons.some((reason) => reason.includes("rollback acceptance"))
      ? "rollback.accept-handoff"
      : blockedReasons.some((reason) => reason.includes("permission") || reason.includes("tenant"))
        ? "verifier.claim.scope-review"
        : blockedReasons.some((reason) => reason.includes("provider service") || reason.includes("install bridge"))
          ? "verifier.claim.bind-provider-service"
        : blockedReasons.some((reason) => reason.includes("claim pending"))
          ? "verifier.evidence.collect"
          : "verifier.claim.review",
    blockedReasons,
    checked: {
      lifecycleValid: program.lifecycle.validation.valid,
      providerReady: providerContract.handoffState.ready,
      syncEvidenceReady: syncEvidence.readiness.ready,
      rollbackTokenPresent: Boolean(rollbackContract.rollbackToken),
      tenantBoundaryReady: workspaceBoundary.ready,
      rollbackAcceptanceReady: rollbackAcceptance.readyForVerifierClaim,
      rollbackAcceptanceStatus: rollbackAcceptance.status,
      providerServiceReady: providerServiceReceipt.ready,
      providerServiceStatus: providerServiceReceipt.status,
      providerServiceBridgeId: providerServiceReceipt.bridgeId,
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      role: workspaceBoundary.role,
      acceptedClaims: claims.filter((claim) => claim.verdict === "accepted").length,
    },
  };
}

function buildVerifierClaimNextSteps(validation) {
  if (validation.blockedReasons.length > 0) {
    return validation.blockedReasons.map((reason) => ({
      action: validation.nextAction,
      label: "Resolve verifier claim",
      reason,
      state: "blocked",
    }));
  }
  return [{
    action: "verifier.claim.export",
    label: "Export verifier claim",
    reason: "provider sync evidence and rollback reference are bound",
    state: "ready",
  }];
}

function buildVerifierClaimAcceptancePreview(
  program = buildVerifierClaimProgram(),
  validation = { ready: false, blockedReasons: [] },
  rollbackContract = {},
  syncEvidence = {},
  claims = [],
  workspaceBoundary = buildVerifierClaimWorkspaceBoundary(program, rollbackContract),
  analyticsExport = { ready: false, exportId: null, counters: {} },
  options = {},
) {
  const rollbackAcceptance = options.rollbackAcceptance
    ?? buildVerifierRollbackAcceptanceHandoff(program, rollbackContract, workspaceBoundary, options);
  const accepted = Boolean(options.accepted ?? validation.ready);
  const acceptedClaims = claims.filter((claim) => claim.verdict === "accepted");
  const pendingClaims = claims.filter((claim) => claim.verdict !== "accepted");
  const blockedReasons = uniqueSorted([
    ...(validation.blockedReasons ?? []),
    ...(workspaceBoundary.ready ? [] : workspaceBoundary.blockedReasons),
    ...(analyticsExport.ready ? [] : ["analytics export is not ready"]),
    ...(syncEvidence.readiness?.ready ? [] : syncEvidence.readiness?.blockedReasons ?? []),
    ...(rollbackContract.rollbackToken ? [] : ["rollback token required before verifier claim acceptance"]),
    ...(rollbackAcceptance.readyForVerifierClaim ? [] : rollbackAcceptance.blockedReasons),
  ]);
  const ready = blockedReasons.length === 0;
  const previewId = `verifier-claim-preview:${stableToken([
    program.job.id,
    workspaceBoundary.scopeKey,
    rollbackContract.rollbackToken,
    syncEvidence.receipt,
    rollbackAcceptance.verifierClaimReference,
    acceptedClaims.length,
    pendingClaims.length,
  ])}`;
  const acceptedAt = accepted && ready ? String(options.acceptedAt ?? "logical:11") : null;
  const acceptedBy = accepted && ready ? String(options.acceptedBy ?? "operator") : null;
  const primaryAction = ready
    ? accepted ? "verifier.claim.export" : "verifier.claim.accept"
    : validation.nextAction ?? "verifier.claim.review";

  return deepFreeze({
    kind: "mailchimp.verifier-claim.acceptance-preview",
    apiVersion: "aios.ui/v1",
    previewId,
    jobId: program.job.id,
    ready,
    status: ready
      ? accepted ? "accepted-ready" : "awaiting-acceptance"
      : blockedReasons.some((reason) => reason.includes("rollback"))
        ? "rollback-required"
        : blockedReasons.some((reason) => reason.includes("permission") || reason.includes("tenant"))
          ? "scope-review-required"
          : "evidence-required",
    client: {
      title: "Mailchimp verifier claim export",
      visibleStatus: ready
        ? accepted ? "ready to export" : "ready for acceptance"
        : "needs review",
      primaryAction,
      disabledReason: ready ? null : blockedReasons[0] ?? null,
      claimCount: claims.length,
      acceptedClaims: acceptedClaims.length,
      pendingClaims: pendingClaims.length,
    },
    acceptance: {
      required: true,
      accepted: accepted && ready,
      acceptedBy,
      acceptedAt,
      command: "verifier.claim.accept",
      idempotencyKey: `${program.job.id}:verifier-claim:accept:${workspaceBoundary.scopeKey}:${analyticsExport.exportId ?? "pending"}`,
    },
    readiness: {
      rollbackTokenPresent: Boolean(rollbackContract.rollbackToken),
      syncEvidenceReady: Boolean(syncEvidence.readiness?.ready),
      analyticsExportReady: Boolean(analyticsExport.ready),
      workspaceBoundaryReady: Boolean(workspaceBoundary.ready),
      rollbackAcceptanceReady: Boolean(rollbackAcceptance.readyForVerifierClaim),
      exportableClaims: ready ? acceptedClaims.length : 0,
    },
    rollbackAcceptance: {
      previewId: rollbackAcceptance.previewId,
      status: rollbackAcceptance.status,
      accepted: rollbackAcceptance.accepted,
      readyForVerifierClaim: rollbackAcceptance.readyForVerifierClaim,
      verifierClaimReference: rollbackAcceptance.verifierClaimReference,
      auditIdempotencyKey: rollbackAcceptance.auditIdempotencyKey,
    },
    validation: {
      valid: ready,
      blockedReasons,
      summary: blockedReasons.length
        ? `Verifier claim export blocked by ${blockedReasons.length} readiness issue(s).`
        : `${acceptedClaims.length} verifier claim(s) are ready for export.`,
    },
    nextSteps: ready
      ? [{
        action: primaryAction,
        label: accepted ? "Export verifier claim" : "Accept verifier claim",
        reason: accepted
          ? "accepted verifier claim preview can be exported"
          : "preview is valid and awaiting operator acceptance",
        state: accepted ? "ready" : "pending",
        idempotencyKey: accepted
          ? `${program.job.id}:verifier-claim:export:${workspaceBoundary.scopeKey}:${analyticsExport.exportId ?? "pending"}`
          : `${program.job.id}:verifier-claim:accept:${workspaceBoundary.scopeKey}:${analyticsExport.exportId ?? "pending"}`,
      }]
      : blockedReasons.map((reason) => ({
        action: validation.nextAction ?? "verifier.claim.review",
        label: "Resolve verifier claim preview",
        reason,
        state: "blocked",
        idempotencyKey: `verifier-claim:preview:${stableToken([
          previewId,
          reason,
        ])}`,
      })),
  });
}

export function buildVerifierClaimAnalyticsExport(
  program = buildVerifierClaimProgram(),
  audit = buildVerifierClaimAudit(program),
  exportSnapshot = createAuditExportSnapshot(audit),
  rollbackContract = {},
  syncEvidence = {},
  claims = [],
  workspaceBoundary = buildVerifierClaimWorkspaceBoundary(program, rollbackContract),
  validation = { ready: false, blockedReasons: [] },
  options = {},
) {
  const rollbackAcceptance = options.rollbackAcceptance
    ?? buildVerifierRollbackAcceptanceHandoff(program, rollbackContract, workspaceBoundary, options);
  const rollbackAnalytics = normalizeRollbackAnalyticsExport(rollbackContract.analyticsExport);
  const history = options.history ?? [];
  const timeline = audit.timeline.map((event, index) => ({
    index,
    status: event.status,
    at: event.at,
    message: event.message,
    tenantId: workspaceBoundary.tenantId,
    workspaceId: workspaceBoundary.workspaceId,
  }));
  const historySnapshots = history.map((entry, index) => ({
    index,
    status: String(entry.status ?? entry.label ?? "unknown"),
    at: String(entry.at ?? `history:${index}`),
    exportId: entry.exportId ? String(entry.exportId) : null,
    ready: Boolean(entry.ready ?? false),
  }));
  const rollbackTimeline = rollbackAnalytics
    ? rollbackAnalytics.timeline.slice(-6).map((entry, index) => ({
      source: "rollback-analytics",
      index: timeline.length + index,
      status: entry.status,
      at: entry.at,
      message: entry.message ?? entry.event,
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      rollbackEvent: entry.event,
      rollbackCommand: entry.command ?? null,
      blockedCount: entry.blockedCount ?? 0,
    }))
    : [];
  const rollbackHistorySnapshots = rollbackAnalytics
    ? rollbackAnalytics.historySnapshots.slice(-6).map((entry, index) => ({
      index: historySnapshots.length + index,
      status: entry.status,
      at: entry.at,
      exportId: entry.exportId,
      ready: entry.ready,
      source: "rollback-analytics",
      replayableCommands: entry.replayableCommands ?? 0,
      blockedReasons: entry.blockedReasons ?? [],
    }))
    : [];
  const acceptedClaims = claims.filter((claim) => claim.verdict === "accepted");
  const providerBoundClaims = claims.filter((claim) => claim.requires.providerSync);
  const localBoundaryClaims = claims.filter((claim) => claim.requires.localBoundary);
  const rollbackBoundClaims = claims.filter((claim) => claim.requires.rollbackReference);
  const blockedReasons = uniqueSorted([
    ...(validation.blockedReasons ?? []),
    ...(workspaceBoundary.ready ? [] : workspaceBoundary.blockedReasons),
    ...(rollbackAcceptance.readyForVerifierClaim ? [] : rollbackAcceptance.blockedReasons),
    ...(rollbackAnalytics && !rollbackAnalytics.ready
      ? [`rollback analytics export not ready: ${rollbackAnalytics.exportId}`]
      : []),
  ]);
  const ready = blockedReasons.length === 0;
  const exportId = stableToken([
    program.job.id,
    exportSnapshot.exportId,
    workspaceBoundary.scopeKey,
    rollbackContract.rollbackToken,
    rollbackAcceptance.verifierClaimReference,
    rollbackAnalytics?.exportId,
    syncEvidence.receipt,
    acceptedClaims.length,
  ]);
  const counters = {
    totalClaims: claims.length,
    acceptedClaims: acceptedClaims.length,
    pendingClaims: claims.length - acceptedClaims.length,
    providerBoundClaims: providerBoundClaims.length,
    localBoundaryClaims: localBoundaryClaims.length,
    rollbackBoundClaims: rollbackBoundClaims.length,
    exportableClaims: ready ? acceptedClaims.length : 0,
    rollbackAcceptanceReady: rollbackAcceptance.readyForVerifierClaim ? 1 : 0,
    missingEvidence: audit.evidence.missing.length,
    externalWriteViolations: audit.boundary.externalWritesObserved.length,
    timelineEvents: timeline.length + rollbackTimeline.length,
    historySnapshots: historySnapshots.length + rollbackHistorySnapshots.length,
    rollbackAnalyticsReady: rollbackAnalytics?.ready ? 1 : 0,
    rollbackReplayableCommands: rollbackAnalytics?.counters.replayableCommands ?? 0,
    rollbackBlockedCommands: rollbackAnalytics?.counters.blockedCommands ?? 0,
    rollbackWorkflowBlockedRows: rollbackAnalytics?.counters.workflowBlockedRows ?? 0,
  };

  return deepFreeze({
    kind: "mailchimp.verifier-claim.analytics-export",
    apiVersion: "aios.analytics/v1",
    jobId: program.job.id,
    exportId: `verifier-claim-analytics:${exportId}`,
    ready,
    generatedAt: String(options.analyticsGeneratedAt ?? "logical:12"),
    tenant: {
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      scopeKey: workspaceBoundary.scopeKey,
    },
    counters,
    timeline: [...timeline, ...rollbackTimeline],
    historySnapshots: [...historySnapshots, ...rollbackHistorySnapshots],
    upstreamRollbackAnalytics: rollbackAnalytics
      ? {
        exportId: rollbackAnalytics.exportId,
        ready: rollbackAnalytics.ready,
        status: rollbackAnalytics.status,
        nextAction: rollbackAnalytics.nextAction,
        rollbackTokenPresent: rollbackAnalytics.rollbackTokenPresent,
        counters: {
          replayableCommands: rollbackAnalytics.counters.replayableCommands,
          blockedCommands: rollbackAnalytics.counters.blockedCommands,
          workflowBlockedRows: rollbackAnalytics.counters.workflowBlockedRows,
          externalWriteViolations: rollbackAnalytics.counters.externalWriteViolations,
        },
        blockedReasons: rollbackAnalytics.blockedReasons,
      }
      : {
        exportId: null,
        ready: false,
        status: "not-provided",
        nextAction: "rollback.analytics.export",
        rollbackTokenPresent: false,
        counters: {
          replayableCommands: 0,
          blockedCommands: 0,
          workflowBlockedRows: 0,
          externalWriteViolations: 0,
        },
        blockedReasons: [],
      },
    report: {
      status: ready ? "export-ready" : "export-blocked",
      rollbackStatus: rollbackContract.statusEvent ?? rollbackContract.rollbackReference?.statusEvent ?? null,
      rollbackTokenPresent: Boolean(rollbackContract.rollbackToken ?? rollbackContract.rollbackReference?.rollbackToken),
      rollbackAcceptanceStatus: rollbackAcceptance.status,
      rollbackAcceptanceReference: rollbackAcceptance.verifierClaimReference,
      rollbackAnalyticsExportId: rollbackAnalytics?.exportId ?? null,
      rollbackAnalyticsReady: rollbackAnalytics?.ready ?? false,
      providerSyncReady: Boolean(syncEvidence.readiness?.ready),
      auditExportId: exportSnapshot.exportId,
      blockedReasons,
    },
  });
}

function buildVerifierRollbackAcceptanceHandoff(
  program,
  rollbackContract = {},
  workspaceBoundary = {},
  options = {},
) {
  const preview = rollbackContract.acceptancePreview
    ?? rollbackContract.clientRuntimeState?.acceptancePreview
    ?? {};
  const acceptance = rollbackContract.acceptance && typeof rollbackContract.acceptance === "object"
    ? rollbackContract.acceptance
    : preview.acceptance && typeof preview.acceptance === "object"
      ? preview.acceptance
      : {};
  const handoff = preview.handoff && typeof preview.handoff === "object" ? preview.handoff : {};
  const audit = handoff.audit && typeof handoff.audit === "object"
    ? handoff.audit
    : rollbackContract.persistedRuntimeState?.acceptanceHandoff
      ? {
        command: rollbackContract.persistedRuntimeState.acceptanceHandoff.auditCommand,
        idempotencyKey: rollbackContract.persistedRuntimeState.acceptanceHandoff.auditIdempotencyKey,
      }
      : {};
  const previewId = String(
    preview.previewId
      ?? rollbackContract.acceptance?.previewId
      ?? rollbackContract.clientRuntimeState?.acceptance?.previewId
      ?? "rollback-preview:missing",
  );
  const accepted = Boolean(
    options.rollbackAccepted
      ?? acceptance.accepted
      ?? rollbackContract.clientRuntimeState?.acceptance?.accepted,
  );
  const readyForVerifierClaim = Boolean(
    handoff.readyForVerifierClaim
      ?? rollbackContract.persistedRuntimeState?.acceptanceHandoff?.readyForVerifierClaim,
  ) && accepted;
  const verifierClaimReference = handoff.verifierClaimReference
    ?? rollbackContract.persistedRuntimeState?.acceptanceHandoff?.verifierClaimReference
    ?? null;
  const tenantMatches = !workspaceBoundary.tenantId
    || !preview.tenantBoundary?.tenantId
    || workspaceBoundary.tenantId === preview.tenantBoundary.tenantId;
  const workspaceMatches = !workspaceBoundary.workspaceId
    || !preview.tenantBoundary?.workspaceId
    || workspaceBoundary.workspaceId === preview.tenantBoundary.workspaceId;
  const blockedReasons = uniqueSorted([
    ...(preview.validation?.blockedReasons ?? []),
    ...(accepted ? [] : ["rollback acceptance required before verifier claim export"]),
    ...(readyForVerifierClaim ? [] : ["rollback acceptance handoff is not ready for verifier claim"]),
    ...(verifierClaimReference ? [] : ["rollback acceptance verifier claim reference missing"]),
    ...(tenantMatches ? [] : ["rollback acceptance tenant boundary mismatch"]),
    ...(workspaceMatches ? [] : ["rollback acceptance workspace boundary mismatch"]),
  ]);

  return deepFreeze({
    kind: "mailchimp.verifier-claim.rollback-acceptance-handoff",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    previewId,
    status: blockedReasons.length === 0
      ? "accepted-ready"
      : accepted ? "accepted-needs-review" : "awaiting-rollback-acceptance",
    accepted,
    acceptedBy: acceptance.acceptedBy ?? rollbackContract.acceptance?.acceptedBy ?? null,
    acceptedAt: acceptance.acceptedAt ?? rollbackContract.acceptance?.acceptedAt ?? null,
    readyForVerifierClaim: blockedReasons.length === 0,
    verifierClaimReference,
    rollbackToken: rollbackContract.rollbackToken ?? rollbackContract.rollbackReference?.rollbackToken ?? null,
    tenantBoundary: {
      tenantId: preview.tenantBoundary?.tenantId ?? workspaceBoundary.tenantId ?? null,
      workspaceId: preview.tenantBoundary?.workspaceId ?? workspaceBoundary.workspaceId ?? null,
      scopeKey: workspaceBoundary.scopeKey ?? null,
      tenantMatches,
      workspaceMatches,
    },
    audit: {
      command: audit.command ?? "audit.rollback.acceptance-record",
      idempotencyKey: audit.idempotencyKey ?? `${program.job.id}:rollback-acceptance:missing`,
      subject: audit.subject ?? `${workspaceBoundary.tenantId ?? "tenant"}/${workspaceBoundary.workspaceId ?? "workspace"}/${program.job.id}`,
    },
    auditIdempotencyKey: audit.idempotencyKey ?? `${program.job.id}:rollback-acceptance:missing`,
    blockedReasons,
    nextAction: blockedReasons.length === 0 ? "verifier.claim.export" : "rollback.accept-handoff",
  });
}

function buildVerifierClaimWorkspaceBoundary(program, rollbackContract, providerContract, options = {}) {
  const tenantId = normalizeScopePart(options.tenantId ?? "tenant_mailchimp_default", "tenant");
  const workspaceId = normalizeScopePart(options.workspaceId ?? "workspace_mailchimp_default", "workspace");
  const role = String(options.role ?? "operator").trim().toLowerCase();
  const permissions = uniqueSorted(options.permissions ?? [
    "audit:read",
    "claim:export",
    "rollback:read",
    "workspace:write-local",
  ]);
  const allowedRoles = new Set(["operator", "auditor", "service"]);
  const requiredPermissions = [
    "audit:read",
    "claim:export",
    "rollback:read",
    "workspace:write-local",
  ];
  const scopeKey = `${program.job.memory.namespace}:tenant:${tenantId}:workspace:${workspaceId}`;
  const rollbackNamespace = rollbackContract?.clientRuntimeState?.persistedState?.journalKey
    ?? rollbackContract?.persistedRuntimeState?.journalKey
    ?? rollbackContract?.rollbackReference?.journalKey
    ?? null;
  const blockedReasons = uniqueSorted([
    ...(allowedRoles.has(role) ? [] : [`role permission denied: ${role}`]),
    ...requiredPermissions
      .filter((permission) => !permissions.includes(permission))
      .map((permission) => `required permission missing: ${permission}`),
    ...(tenantId === "tenant_public" ? ["tenant scope must not be public"] : []),
    ...(workspaceId === "workspace_public" ? ["workspace scope must not be public"] : []),
    ...(providerContract?.sync?.localNamespace
      && providerContract.sync.localNamespace !== program.job.memory.namespace
      ? [`tenant boundary mismatch: ${providerContract.sync.localNamespace}`]
      : []),
  ]);

  return deepFreeze({
    kind: "mailchimp.verifier-claim.workspace-boundary",
    apiVersion: "aios.security/v1",
    tenantId,
    workspaceId,
    scopeKey,
    role,
    permissions,
    requiredPermissions,
    ready: blockedReasons.length === 0,
    auditHandoff: {
      subject: `${tenantId}/${workspaceId}/${program.job.id}`,
      command: "audit.claim.boundary-record",
      idempotencyKey: `${program.job.id}:verifier-claim:boundary:${stableToken([
        tenantId,
        workspaceId,
        role,
        permissions.join(","),
      ])}`,
      rollbackJournalKey: rollbackNamespace,
    },
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

function buildVerifierClaimPersistedCommands(validation, claimRows, ready, snapshot, boundary) {
  if (!ready) {
    return validation.blockedReasons.map((reason) => ({
      action: validation.nextAction,
      label: "Resolve verifier claim",
      reason,
      state: "blocked",
      idempotencyKey: `verifier-claim:resolve:${stableToken([
        boundary.scopeKey,
        reason,
        snapshot?.exportId,
      ])}`,
    }));
  }

  return [
    {
      action: "verifier.claim.persist",
      label: "Persist verifier claim state",
      reason: "all claim rows have accepted verifier receipts",
      state: "ready",
      idempotencyKey: `verifier-claim:persist:${boundary.scopeKey}:${snapshot?.exportId ?? "pending"}`,
      writes: claimRows.map((claim) => claim.persistedKey),
      auditHandoff: boundary.auditHandoff,
    },
    {
      action: "verifier.claim.export",
      label: "Export verifier claim",
      reason: "persisted claim state can be replayed after restart",
      state: "ready",
      idempotencyKey: `verifier-claim:export:${boundary.scopeKey}:${snapshot?.exportId ?? "pending"}`,
      writes: [],
      auditHandoff: boundary.auditHandoff,
    },
  ];
}

function buildVerifierClaimRestartCommandLedger(
  program,
  validation,
  rollbackContract,
  syncEvidence,
  claims,
  workspaceBoundary,
  analyticsExport,
  acceptancePreview,
  persistedState,
  options = {},
) {
  const rollbackAcceptance = options.rollbackAcceptance
    ?? buildVerifierRollbackAcceptanceHandoff(program, rollbackContract, workspaceBoundary, options);
  const checkpoint = analyticsExport?.report?.auditExportId ?? persistedState.stateKey.split(":").at(-1) ?? "pending";
  const acceptedClaims = claims.filter((claim) => claim.verdict === "accepted");
  const claimRows = claims.map((claim, index) => {
    const persistedClaim = persistedState.claims.find((row) => row.subject === claim.subject);
    const blockedReasons = uniqueSorted([
      ...(claim.verdict === "accepted" ? [] : [`verifier claim pending: ${claim.subject}`]),
      ...(claim.receipt ? [] : [`verifier claim receipt missing: ${claim.subject}`]),
      ...(persistedClaim?.restartSafe ? [] : [`verifier claim is not restart-safe: ${claim.subject}`]),
    ]);
    return {
      index,
      phase: "claim",
      subject: claim.subject,
      state: blockedReasons.length === 0 ? "restart-safe" : "blocked",
      command: blockedReasons.length === 0 ? "verifier.claim.persist-row" : "verifier.claim.collect-evidence",
      receipt: claim.receipt,
      persistedKey: persistedClaim?.persistedKey ?? null,
      idempotencyKey: `${program.job.id}:verifier-claim:ledger:${workspaceBoundary.scopeKey}:${index + 1}:${stableToken([
        claim.subject,
        checkpoint,
      ])}`,
      blockedReasons,
    };
  });
  const controlRows = [
    {
      phase: "rollback-acceptance",
      state: rollbackAcceptance.readyForVerifierClaim ? "restart-safe" : "blocked",
      command: rollbackAcceptance.readyForVerifierClaim ? "rollback.acceptance.verify" : "rollback.accept-handoff",
      receipt: rollbackAcceptance.verifierClaimReference,
      blockedReasons: rollbackAcceptance.readyForVerifierClaim ? [] : rollbackAcceptance.blockedReasons,
    },
    {
      phase: "sync-evidence",
      state: syncEvidence.readiness?.ready ? "restart-safe" : "blocked",
      command: syncEvidence.readiness?.ready ? "provider.sync.verify" : "provider.sync.collect",
      receipt: syncEvidence.receipt ?? null,
      blockedReasons: syncEvidence.readiness?.ready ? [] : syncEvidence.readiness?.blockedReasons ?? [],
    },
    {
      phase: "analytics-export",
      state: analyticsExport.ready ? "restart-safe" : "blocked",
      command: analyticsExport.ready ? "verifier.analytics.persist" : "verifier.analytics-review",
      receipt: analyticsExport.exportId,
      blockedReasons: analyticsExport.ready ? [] : analyticsExport.report?.blockedReasons ?? [],
    },
    {
      phase: "operator-acceptance",
      state: acceptancePreview.acceptance.accepted ? "restart-safe" : "pending",
      command: acceptancePreview.acceptance.accepted ? "verifier.claim.accepted" : "verifier.claim.accept",
      receipt: acceptancePreview.previewId,
      blockedReasons: acceptancePreview.acceptance.accepted ? [] : ["verifier claim acceptance is pending"],
    },
  ].map((row, index) => ({
    ...row,
    index: claimRows.length + index,
    idempotencyKey: `${program.job.id}:verifier-claim:ledger:${workspaceBoundary.scopeKey}:control:${index + 1}:${row.phase}`,
  }));
  const rows = [...claimRows, ...controlRows];
  const blockedReasons = uniqueSorted([
    ...(validation.blockedReasons ?? []),
    ...rows.flatMap((row) => row.blockedReasons),
  ]);
  const ready = blockedReasons.length === 0 && persistedState.ready;

  return deepFreeze({
    kind: "mailchimp.verifier-claim.restart-command-ledger",
    apiVersion: "aios.state/v1",
    ledgerId: `verifier-claim-ledger:${stableToken([
      program.job.id,
      workspaceBoundary.scopeKey,
      checkpoint,
      persistedState.restart.token,
      rows.map((row) => `${row.phase}:${row.state}`).join(","),
    ])}`,
    jobId: program.job.id,
    checkpoint,
    ready,
    status: ready ? "restart-ledger-ready" : "restart-ledger-blocked",
    tenant: {
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      scopeKey: workspaceBoundary.scopeKey,
    },
    restart: {
      command: ready ? "verifier.claim.export" : validation.nextAction,
      token: ready ? persistedState.restart.token : null,
      idempotencyKey: `${program.job.id}:verifier-claim:ledger-restart:${workspaceBoundary.scopeKey}:${checkpoint}`,
      acceptedClaims: acceptedClaims.length,
    },
    summary: {
      totalRows: rows.length,
      restartSafeRows: rows.filter((row) => row.state === "restart-safe").length,
      pendingRows: rows.filter((row) => row.state === "pending").length,
      blockedRows: rows.filter((row) => row.state === "blocked").length,
      blockedReasons,
    },
    rows,
  });
}

function buildVerifierProviderServiceReceipt(
  program,
  providerContract,
  workspaceBoundary,
  installBridge,
  options = {},
) {
  const required = Boolean(options.requireInstallHandoffBridge ?? false);
  if (!installBridge || typeof installBridge !== "object") {
    const blockedReasons = required
      ? ["verifier claim provider service receipt requires package install bridge"]
      : [];
    return deepFreeze({
      kind: "mailchimp.verifier-claim.provider-service-receipt",
      apiVersion: "aios.integration/v1",
      jobId: program.job.id,
      bridgeId: null,
      receipt: null,
      status: required ? "install-bridge-required" : "install-bridge-not-required",
      ready: blockedReasons.length === 0,
      provider: {
        name: providerContract.provider?.name ?? "mailchimp",
        resource: providerContract.provider?.resource ?? "campaign-report-verifier-claim",
        checkpoint: providerContract.sync?.checkpoint ?? null,
      },
      sync: {
        cursor: null,
        checkpoint: providerContract.sync?.checkpoint ?? null,
        packageRef: null,
        consumer: "verifier-claim",
      },
      replay: {
        idempotent: true,
        replayKey: `${workspaceBoundary.scopeKey}:provider-service:optional`,
        restartCommand: required ? "verifier.claim.bind-provider-service" : "verifier.claim.export",
        stableAcrossRestart: !required,
      },
      validation: {
        ready: blockedReasons.length === 0,
        optional: !required,
        bridgeReady: !required,
        checkpointConsistent: true,
        externalWriteSafe: true,
        verifierCompatible: !required,
        blockedReasons,
      },
      blockedReasons,
    });
  }

  const bridge = normalizeVerifierInstallBridge(installBridge);
  const providerName = providerContract.provider?.name ?? "mailchimp";
  const expectedConsumer = "verifier-claim";
  const blockedReasons = uniqueSorted([
    ...(bridge.ready ? [] : bridge.validation.blockedReasons.length > 0
      ? bridge.validation.blockedReasons
      : ["verifier claim install bridge is not ready"]),
    ...(bridge.consumer.name === expectedConsumer
      ? []
      : [`verifier claim install bridge consumer mismatch: ${bridge.consumer.name}`]),
    ...(bridge.consumer.receipt ? [] : ["verifier claim install bridge receipt missing"]),
    ...(bridge.providerService.externalWritesAllowed === false
      ? []
      : ["verifier claim provider service receipt forbids external writes"]),
    ...(bridge.replay.stableAcrossRestart
      ? []
      : ["verifier claim install bridge is not restart-safe"]),
    ...(bridge.validation.verifierClaimCompatible
      ? []
      : ["verifier claim install bridge is not verifier-compatible"]),
    ...(bridge.syncMetadata.checkpoint === providerContract.sync?.checkpoint
      ? []
      : ["verifier claim install bridge checkpoint mismatch"]),
    ...(bridge.syncMetadata.cursor ? [] : ["verifier claim install bridge sync cursor missing"]),
    ...(providerName === "mailchimp"
      ? []
      : [`verifier claim provider service expected mailchimp, received ${providerName}`]),
  ]);
  const ready = blockedReasons.length === 0;
  const receipt = ready
    ? `verifier-provider-service:${stableToken([
      program.job.id,
      workspaceBoundary.scopeKey,
      bridge.bridgeId,
      bridge.consumer.receipt,
      bridge.providerService.agreementId,
      bridge.syncMetadata.cursor,
    ])}`
    : null;

  return deepFreeze({
    kind: "mailchimp.verifier-claim.provider-service-receipt",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    bridgeId: bridge.bridgeId,
    receipt,
    status: ready ? "provider-service-bound" : "provider-service-review",
    ready,
    provider: {
      name: providerName,
      resource: providerContract.provider?.resource ?? "campaign-report-verifier-claim",
      checkpoint: providerContract.sync?.checkpoint ?? null,
      packageAgreementId: bridge.providerService.agreementId,
      packageAgreementStatus: bridge.providerService.status,
      packageServiceLevel: bridge.providerService.serviceLevel,
    },
    sync: {
      cursor: bridge.syncMetadata.cursor,
      checkpoint: bridge.syncMetadata.checkpoint,
      packageRef: bridge.syncMetadata.packageRef,
      consumer: bridge.consumer.name,
      installEnvelopeId: bridge.syncMetadata.envelopeId,
      installTimelineReportId: bridge.syncMetadata.timelineReportId,
      installActionLedgerId: bridge.syncMetadata.actionLedgerId,
    },
    replay: {
      idempotent: bridge.replay.idempotent,
      replayKey: `${workspaceBoundary.scopeKey}:provider-service:${bridge.bridgeId}`,
      upstreamReplayKey: bridge.replay.replayKey,
      restartCommand: ready ? "verifier.claim.export" : bridge.nextAction.command,
      stableAcrossRestart: bridge.replay.stableAcrossRestart,
    },
    acceptance: {
      accepted: bridge.acceptance.accepted,
      acceptedBy: bridge.acceptance.acceptedBy,
      acceptedAt: bridge.acceptance.acceptedAt,
      decisionReceipt: bridge.acceptance.decisionReceipt,
    },
    validation: {
      ready,
      optional: false,
      bridgeReady: bridge.ready,
      checkpointConsistent: bridge.syncMetadata.checkpoint === providerContract.sync?.checkpoint,
      externalWriteSafe: bridge.providerService.externalWritesAllowed === false,
      verifierCompatible: bridge.validation.verifierClaimCompatible,
      blockedReasons,
    },
    blockedReasons,
  });
}

function normalizeVerifierInstallBridge(bridge) {
  const validation = bridge.validation && typeof bridge.validation === "object" ? bridge.validation : {};
  const consumer = bridge.consumer && typeof bridge.consumer === "object" ? bridge.consumer : {};
  const providerService = bridge.providerService && typeof bridge.providerService === "object"
    ? bridge.providerService
    : {};
  const syncMetadata = bridge.syncMetadata && typeof bridge.syncMetadata === "object"
    ? bridge.syncMetadata
    : {};
  const replay = bridge.replay && typeof bridge.replay === "object" ? bridge.replay : {};
  const acceptance = bridge.acceptance && typeof bridge.acceptance === "object" ? bridge.acceptance : {};
  const nextAction = bridge.nextAction && typeof bridge.nextAction === "object" ? bridge.nextAction : {};

  return {
    bridgeId: bridge.bridgeId ? String(bridge.bridgeId) : null,
    ready: Boolean(bridge.ready),
    status: String(bridge.status ?? (bridge.ready ? "bridge_ready" : "bridge_blocked")),
    consumer: {
      name: String(consumer.name ?? "unknown"),
      command: String(consumer.command ?? "verifier.claim.bind-provider-service"),
      receipt: consumer.receipt ? String(consumer.receipt) : null,
      missingCapabilities: uniqueSorted(consumer.missingCapabilities ?? []),
    },
    providerService: {
      agreementId: providerService.agreementId ? String(providerService.agreementId) : null,
      status: String(providerService.status ?? "unknown"),
      serviceLevel: String(providerService.serviceLevel ?? "standard"),
      syncCursor: providerService.syncCursor ? String(providerService.syncCursor) : null,
      checkpoint: providerService.checkpoint ? String(providerService.checkpoint) : null,
      externalWritesAllowed: Boolean(providerService.externalWritesAllowed),
    },
    syncMetadata: {
      checkpoint: syncMetadata.checkpoint ? String(syncMetadata.checkpoint) : null,
      cursor: syncMetadata.cursor ? String(syncMetadata.cursor) : null,
      packageRef: syncMetadata.packageRef ? String(syncMetadata.packageRef) : null,
      envelopeId: syncMetadata.envelopeId ? String(syncMetadata.envelopeId) : null,
      timelineReportId: syncMetadata.timelineReportId ? String(syncMetadata.timelineReportId) : null,
      actionLedgerId: syncMetadata.actionLedgerId ? String(syncMetadata.actionLedgerId) : null,
    },
    replay: {
      idempotent: replay.idempotent !== false,
      replayKey: replay.replayKey ? String(replay.replayKey) : null,
      restartCommand: String(replay.restartCommand ?? "verifier.claim.bind-provider-service"),
      stableAcrossRestart: Boolean(replay.stableAcrossRestart),
    },
    acceptance: {
      accepted: Boolean(acceptance.accepted),
      acceptedBy: acceptance.acceptedBy ? String(acceptance.acceptedBy) : null,
      acceptedAt: acceptance.acceptedAt ? String(acceptance.acceptedAt) : null,
      decisionReceipt: acceptance.decisionReceipt ? String(acceptance.decisionReceipt) : null,
    },
    nextAction: {
      command: String(nextAction.command ?? replay.restartCommand ?? "verifier.claim.bind-provider-service"),
      label: String(nextAction.label ?? "Bind verifier claim provider service"),
      reason: String(nextAction.reason ?? "provider service bridge requires review"),
    },
    validation: {
      verifierClaimCompatible: Boolean(validation.verifierClaimCompatible),
      blockedReasons: uniqueSorted(validation.blockedReasons ?? []),
    },
  };
}

function normalizeRollbackAnalyticsExport(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const counters = value.counters && typeof value.counters === "object" ? value.counters : {};
  const report = value.report && typeof value.report === "object" ? value.report : {};
  const validation = value.validation && typeof value.validation === "object" ? value.validation : {};
  return {
    exportId: value.exportId ? String(value.exportId) : null,
    ready: Boolean(value.ready),
    status: String(report.status ?? value.status ?? (value.ready ? "export-ready" : "export-blocked")),
    nextAction: String(report.nextAction ?? "rollback.analytics.export"),
    rollbackTokenPresent: Boolean(report.rollbackToken),
    counters: {
      replayableCommands: Number(counters.replayableCommands ?? 0),
      blockedCommands: Number(counters.blockedCommands ?? 0),
      workflowBlockedRows: Number(counters.workflowBlockedRows ?? 0),
      externalWriteViolations: Number(counters.externalWriteViolations ?? 0),
    },
    timeline: Array.isArray(value.timeline) ? value.timeline.map((entry, index) => ({
      index,
      at: String(entry.at ?? `rollback:${index}`),
      event: String(entry.event ?? entry.status ?? "rollback.event"),
      status: String(entry.status ?? "unknown"),
      message: entry.message ? String(entry.message) : null,
      command: entry.command ? String(entry.command) : null,
      blockedCount: Number(entry.blockedCount ?? 0),
    })) : [],
    historySnapshots: Array.isArray(value.historySnapshots) ? value.historySnapshots.map((entry, index) => ({
      index,
      at: String(entry.at ?? `rollback-history:${index}`),
      status: String(entry.status ?? "unknown"),
      exportId: entry.exportId ? String(entry.exportId) : null,
      ready: Boolean(entry.ready),
      replayableCommands: Number(entry.replayableCommands ?? 0),
      blockedReasons: uniqueSorted(entry.blockedReasons ?? []),
    })) : [],
    blockedReasons: uniqueSorted(report.blockedReasons ?? validation.blockedReasons ?? []),
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
  return `vcl_${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
