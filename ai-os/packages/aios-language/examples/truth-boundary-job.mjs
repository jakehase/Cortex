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

export const truthBoundaryJobSource = `# deterministic Mailchimp truth boundary claim job
use mailchimp:campaign.read
use mailchimp:report.read
use memory:campaign.local
use verifier:evidence.record
use rollback:snapshot.create
use status:timeline.write
recover rollback=snapshot retry=2
step read-campaign-facts input=campaignId output=campaignFacts verify.source=mailchimp
step read-report-facts input=campaignId output=reportFacts verify.source=mailchimp
step bind-truth-claim input=campaignFacts,reportFacts output=truthClaim verify.truth=local-only
step emit-boundary-status input=truthClaim output=statusEvent verify.boundary=no-external-write
`;

export function buildTruthBoundaryProgram(options = {}) {
  return compilePackageSource(truthBoundaryJobSource, {
    name: options.name ?? "mailchimp-truth-boundary-job",
    version: options.version ?? "0.1.0",
    description: "Compile a Mailchimp truth-boundary job that binds provider reads to local claims before handoff.",
    capabilities: options.capabilities ?? [],
    exports: {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      truthBoundary: "./examples/truth-boundary-job.mjs#buildTruthBoundaryContract",
      recoveryStatus: "./examples/truth-boundary-job.mjs#buildTruthBoundaryRecoveryStatus",
    },
  }, {
    name: "mailchimp-truth-boundary-job",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: options.dryRun ?? true,
      requireApproval: options.requireApproval ?? true,
      approvalTicket: options.approvalTicket,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 12,
    },
  });
}

export function buildTruthBoundaryAudit(program = buildTruthBoundaryProgram(), options = {}) {
  const missingSubjects = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missingSubjects.has(subject))
    .map((subject) => createEvidence(
      subject.includes("verify.source") ? "mailchimp-read-receipt" : "runtime-local-receipt",
      subject,
      { example: "truth-boundary-job", claimBinding: true },
    ));

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "completed",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "truth boundary queued" }),
      createStatusEvent("running", { at: "logical:1", message: "provider facts read" }),
      createStatusEvent("verifying", { at: "logical:2", message: "local truth claim bound" }),
      createStatusEvent(options.status ?? "completed", {
        at: "logical:3",
        message: "truth boundary handoff shaped",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildTruthBoundaryContract(
  program = buildTruthBoundaryProgram(),
  audit = buildTruthBoundaryAudit(program),
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
    providerResource: "campaign-truth-boundary",
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
  const claimContract = buildClaimContract(program, audit, exportSnapshot);
  const persistedState = buildTruthBoundaryPersistedState(
    program,
    audit,
    claimContract,
    recoveryStatus,
    options,
  );
  const tenantBoundary = buildTruthBoundaryTenantBoundary(
    program,
    audit,
    claimContract,
    persistedState,
    recoveryStatus,
    options,
  );
  const operationalHealth = buildTruthBoundaryOperationalHealth(
    program,
    audit,
    claimContract,
    persistedState,
    tenantBoundary,
    recoveryStatus,
    options,
  );
  const analytics = buildTruthBoundaryAnalytics(
    program,
    audit,
    claimContract,
    persistedState,
    tenantBoundary,
    operationalHealth,
    exportSnapshot,
    recoveryStatus,
    options,
  );
  const clientRuntimeHandoff = buildTruthBoundaryClientRuntimeHandoff(
    program,
    audit,
    claimContract,
    persistedState,
    tenantBoundary,
    operationalHealth,
    analytics,
    recoveryStatus,
    options,
  );
  const adapterRecoveryHandoff = buildTruthBoundaryAdapterRecoveryHandoff(
    program,
    audit,
    claimContract,
    persistedState,
    tenantBoundary,
    operationalHealth,
    analytics,
    clientRuntimeHandoff,
    recoveryStatus,
    options,
  );
  const blockedReasons = uniqueSorted([
    ...claimContract.missingClaims.map((claim) => `missing truth claim evidence: ${claim}`),
    ...audit.boundary.externalWritesObserved.map((write) => `truth boundary external write: ${write.subject ?? write}`),
    ...providerContract.handoffState.blockedReasons,
    ...recoveryStatus.blockedReasons,
    ...persistedState.validation.blockers,
    ...tenantBoundary.validation.blockers,
    ...operationalHealth.validation.blockers,
    ...analytics.validation.blockers,
    ...clientRuntimeHandoff.validation.blockers,
    ...adapterRecoveryHandoff.validation.blockers,
  ]);
  const ready = blockedReasons.length === 0
    && claimContract.ready
    && exportSnapshot.truthBoundary.readyForExport
    && persistedState.validation.ready
    && tenantBoundary.validation.ready
    && adapterRecoveryHandoff.validation.ready;

  return {
    kind: "mailchimp.truth-boundary.contract",
    apiVersion: "aios.example/v1",
    jobId: program.job.id,
    status: audit.status,
    claimContract,
    persistedState,
    tenantBoundary,
    operationalHealth,
    analytics,
    clientRuntimeHandoff,
    adapterRecoveryHandoff,
    providerContract,
    rollback: {
      contract: rollbackContract,
      summary: summarizeRollbackContract(rollbackContract),
      statusHandoff: recoveryStatus,
    },
    exportSnapshot,
    readiness: {
      ready,
      nextAction: ready ? "handoff-truth-boundary-claim" : "resolve-truth-boundary-blockers",
      blockedReasons,
    },
    runtimeHandoff: {
      ready,
      command: ready ? "truth-boundary.claim.resume" : "truth-boundary.claim.review",
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
      restartToken: recoveryStatus.restartToken,
      persistedStateKey: persistedState.stateKey,
      idempotencyKey: persistedState.commands.resume.idempotencyKey,
      clientRequest: clientRuntimeHandoff.request,
      visibleState: clientRuntimeHandoff.visibleState,
      acceptanceGate: clientRuntimeHandoff.acceptanceGate,
      tenantScope: tenantBoundary.scope,
      auditHandoff: tenantBoundary.auditHandoff,
      health: operationalHealth.health,
      retryPlan: operationalHealth.retryPlan,
      analyticsExportId: analytics.exportSummary.exportId,
      reportCursor: analytics.history.cursor,
      adapterCommand: adapterRecoveryHandoff.command.command,
      adapterStatus: adapterRecoveryHandoff.status.status,
      adapterStatusEvent: adapterRecoveryHandoff.status.event,
      adapterCheckpoint: adapterRecoveryHandoff.checkpoint,
    },
  };
}

export function buildTruthBoundaryRecoveryStatus(options = {}) {
  const program = options.program ?? buildTruthBoundaryProgram(options);
  const audit = options.audit ?? buildTruthBoundaryAudit(program, options);
  const contract = buildTruthBoundaryContract(program, audit, options);

  return {
    kind: "mailchimp.truth-boundary.recovery-status",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready: contract.readiness.ready,
    statusEvent: contract.rollback.statusHandoff.statusEvent,
    runtimeCommand: contract.runtimeHandoff.command,
    claimContract: contract.claimContract,
    persistedState: contract.persistedState,
    tenantBoundary: contract.tenantBoundary,
    operationalHealth: contract.operationalHealth,
    analytics: contract.analytics,
    clientRuntimeHandoff: contract.clientRuntimeHandoff,
    adapterRecoveryHandoff: contract.adapterRecoveryHandoff,
    blockedReasons: contract.readiness.blockedReasons,
  };
}

export function describeTruthBoundaryJob(options = {}) {
  const program = buildTruthBoundaryProgram(options);
  const audit = buildTruthBoundaryAudit(program, options);
  const contract = buildTruthBoundaryContract(program, audit, options);

  return {
    jobId: program.job.id,
    package: program.manifest.name,
    status: audit.status,
    claimContract: contract.claimContract,
    persistedState: contract.persistedState,
    tenantBoundary: contract.tenantBoundary,
    operationalHealth: contract.operationalHealth,
    analytics: contract.analytics,
    clientRuntimeHandoff: contract.clientRuntimeHandoff,
    adapterRecoveryHandoff: contract.adapterRecoveryHandoff,
    readiness: contract.readiness,
    runtimeHandoff: contract.runtimeHandoff,
  };
}

export function selfCheckTruthBoundaryContract(options = {}) {
  const summary = describeTruthBoundaryJob(options);
  return {
    ok: summary.claimContract.claims.length >= 3
      && summary.claimContract.externalWritesAllowed === false
      && summary.persistedState.commands.resume.idempotent === true
      && summary.tenantBoundary.scope.tenantId === "tenant:local-mailchimp"
      && summary.operationalHealth.retryPlan.commands.retry.idempotent === true
      && summary.analytics.counters.claims.total >= summary.analytics.counters.claims.ready
      && summary.clientRuntimeHandoff.acceptanceGate.idempotent === true
      && summary.clientRuntimeHandoff.visibleState.claimRows.length === summary.claimContract.claims.length
      && summary.adapterRecoveryHandoff.command.idempotent === true
      && summary.adapterRecoveryHandoff.status.timeline.length >= 2
      && summary.adapterRecoveryHandoff.checkpoint.stateKey === summary.persistedState.stateKey,
    jobId: summary.jobId,
    checked: ["compile", "provider-evidence", "claim-binding", "adapter-handoff", "persisted-state", "tenant-boundary", "operational-health", "analytics", "client-runtime-handoff", "adapter-recovery-handoff"],
    blockedReasons: summary.readiness.blockedReasons,
  };
}

function buildClaimContract(program, audit, exportSnapshot) {
  const claims = program.job.plan.map((step) => ({
    subject: `step:${step.op}`,
    output: step.output,
    verifierHints: step.verifierHints,
    evidenceReady: !audit.evidence.missing.includes(`step:${step.op}`),
  }));
  const missingClaims = claims
    .filter((claim) => !claim.evidenceReady)
    .map((claim) => claim.subject);

  return {
    kind: "mailchimp.truth-boundary.claim-contract",
    apiVersion: "aios.language/v1",
    claims,
    missingClaims,
    externalWritesAllowed: false,
    memoryWritePolicy: program.job.memory.writePolicy,
    exportId: exportSnapshot.exportId,
    ready: missingClaims.length === 0 && exportSnapshot.truthBoundary.readyForExport,
  };
}

function buildTruthBoundaryPersistedState(program, audit, claimContract, recoveryStatus, options) {
  const stateKey = options.stateKey
    ?? `${program.job.memory.namespace}:truth-boundary:${claimContract.exportId}`;
  const priorState = options.priorState ?? {};
  const currentVersion = Number.isInteger(priorState.version) ? priorState.version + 1 : 1;
  const persistedClaims = claimContract.claims.map((claim) => ({
    subject: claim.subject,
    output: claim.output,
    evidenceReady: claim.evidenceReady,
    persistedAt: claim.evidenceReady ? (options.persistedAt ?? "logical:5") : null,
  }));
  const restoreCursor = priorState.restoreCursor
    ?? `${program.job.id}:truth-boundary:restore:${currentVersion}`;
  const resumeIdempotencyKey = `${stateKey}:resume:${claimContract.exportId}`;
  const retryIdempotencyKey = `${stateKey}:retry:${recoveryStatus.restartToken}`;
  const validationBlockers = uniqueSorted([
    ...(claimContract.missingClaims.length > 0 ? ["cannot persist incomplete truth-boundary claims"] : []),
    ...(audit.status === "failed" ? ["failed truth-boundary audit requires retry command"] : []),
    ...(recoveryStatus.ready ? [] : ["restart-safe recovery status is not ready"]),
  ]);

  return {
    kind: "mailchimp.truth-boundary.persisted-state",
    apiVersion: "aios.runtime/v1",
    stateKey,
    version: currentVersion,
    shape: {
      jobId: program.job.id,
      exportId: claimContract.exportId,
      memoryNamespace: program.job.memory.namespace,
      restoreCursor,
      claims: persistedClaims,
      status: validationBlockers.length === 0 ? "restart_safe" : "blocked",
    },
    recoveryPaths: {
      resume: {
        from: restoreCursor,
        command: "truth-boundary.claim.resume",
        requiresEvidence: claimContract.missingClaims,
      },
      retry: {
        from: recoveryStatus.restartToken,
        command: "truth-boundary.claim.retry",
        retryable: audit.status !== "completed",
      },
      review: {
        from: stateKey,
        command: "truth-boundary.claim.review",
        reason: validationBlockers[0] ?? null,
      },
    },
    commands: {
      resume: {
        idempotent: true,
        idempotencyKey: resumeIdempotencyKey,
        command: validationBlockers.length === 0
          ? "truth-boundary.claim.resume"
          : "truth-boundary.claim.review",
      },
      retry: {
        idempotent: true,
        idempotencyKey: retryIdempotencyKey,
        command: "truth-boundary.claim.retry",
      },
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      restartSafe: validationBlockers.length === 0 && persistedClaims.every((claim) => claim.persistedAt),
    },
  };
}

function buildTruthBoundaryTenantBoundary(
  program,
  audit,
  claimContract,
  persistedState,
  recoveryStatus,
  options,
) {
  const tenantId = options.tenantId ?? "tenant:local-mailchimp";
  const workspaceId = options.workspaceId ?? "workspace:mailchimp-local";
  const role = options.role ?? "operator";
  const requiredPermissions = uniqueSorted([
    "mailchimp:campaign.read",
    "mailchimp:report.read",
    "memory:campaign.local",
    "status:timeline.write",
    ...(options.requiredPermissions ?? []),
  ]);
  const grantedPermissions = new Set(options.grantedPermissions ?? requiredPermissions);
  const deniedPermissions = requiredPermissions
    .filter((permission) => !grantedPermissions.has(permission));
  const allowedRoles = new Set(options.allowedRoles ?? ["operator", "auditor", "runtime"]);
  const restrictedTenants = new Set(options.restrictedTenants ?? []);
  const claimSubjects = claimContract.claims.map((claim) => claim.subject);
  const auditHandoffId = options.auditHandoffId
    ?? `${persistedState.stateKey}:tenant-boundary:${tenantId}:${workspaceId}`;
  const validationBlockers = uniqueSorted([
    ...(tenantId && workspaceId ? [] : ["truth boundary requires tenant and workspace scope"]),
    ...(restrictedTenants.has(tenantId) ? [`tenant is restricted for truth-boundary handoff: ${tenantId}`] : []),
    ...(allowedRoles.has(role) ? [] : [`role cannot hand off truth-boundary claim: ${role}`]),
    ...deniedPermissions.map((permission) => `permission not granted for tenant boundary: ${permission}`),
    ...(audit.boundary.externalWritesObserved.length > 0
      ? ["tenant boundary cannot hand off claims with observed external writes"]
      : []),
    ...(persistedState.validation.restartSafe ? [] : ["tenant boundary requires restart-safe persisted state"]),
    ...(recoveryStatus.ready ? [] : ["tenant boundary requires ready recovery status"]),
  ]);

  return {
    kind: "mailchimp.truth-boundary.tenant-boundary",
    apiVersion: "aios.runtime/v1",
    scope: {
      tenantId,
      workspaceId,
      role,
      memoryNamespace: program.job.memory.namespace,
      claimNamespace: `${tenantId}/${workspaceId}/${program.job.id}`,
    },
    permissions: {
      required: requiredPermissions,
      granted: [...grantedPermissions].sort(),
      denied: deniedPermissions,
      readOnlyProvider: true,
      externalWritesAllowed: false,
    },
    isolation: {
      stateKey: persistedState.stateKey,
      allowedStatePrefix: `${program.job.memory.namespace}:truth-boundary:`,
      isolated: persistedState.stateKey.startsWith(`${program.job.memory.namespace}:truth-boundary:`),
      claimSubjects,
    },
    auditHandoff: {
      handoffId: auditHandoffId,
      command: validationBlockers.length === 0
        ? "truth-boundary.audit.handoff"
        : "truth-boundary.audit.review",
      statusEvent: recoveryStatus.statusEvent,
      includesClaims: claimSubjects.length,
      exportId: claimContract.exportId,
      decision: validationBlockers.length === 0 ? "allow_handoff" : "review_required",
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      summary: validationBlockers.length === 0
        ? "Tenant, workspace, role, and read-only permissions allow truth-boundary handoff."
        : "Truth-boundary handoff requires tenant scope, permission, or audit review.",
    },
  };
}

function buildTruthBoundaryOperationalHealth(
  program,
  audit,
  claimContract,
  persistedState,
  tenantBoundary,
  recoveryStatus,
  options,
) {
  const observedFailures = uniqueSorted([
    ...(audit.status === "failed" ? ["truth-boundary audit failed"] : []),
    ...claimContract.missingClaims.map((claim) => `claim evidence missing: ${claim}`),
    ...persistedState.validation.blockers,
    ...tenantBoundary.validation.blockers,
    ...recoveryStatus.blockedReasons,
  ]);
  const retryAttempt = Number.isInteger(options.retryAttempt) ? options.retryAttempt : 0;
  const retryLimit = program.job.recovery.retry.attempts;
  const baseBackoffSeconds = Number.isInteger(options.baseBackoffSeconds)
    ? options.baseBackoffSeconds
    : 15;
  const nextBackoffSeconds = Math.min(
    baseBackoffSeconds * (2 ** Math.min(retryAttempt, retryLimit)),
    300,
  );
  const degraded = observedFailures.length > 0
    && claimContract.claims.some((claim) => claim.evidenceReady);
  const retryable = observedFailures.length > 0
    && retryAttempt < retryLimit
    && Boolean(recoveryStatus.restartToken);
  const healthStatus = observedFailures.length === 0
    ? "healthy"
    : retryable
      ? "retryable"
      : degraded
        ? "degraded"
        : "failed";
  const actionableErrors = observedFailures.map((message, index) => ({
    id: `${program.job.id}:truth-boundary:error:${index}`,
    message,
    severity: message.includes("external write") ? "critical" : "warning",
    action: retryable ? "truth-boundary.claim.retry" : "truth-boundary.claim.review",
  }));
  const validationBlockers = uniqueSorted([
    ...(healthStatus === "failed" ? ["truth-boundary health has no safe retry path"] : []),
    ...(tenantBoundary.auditHandoff.decision === "allow_handoff" || healthStatus !== "healthy"
      ? []
      : ["healthy truth-boundary state requires audit handoff allowance"]),
    ...(retryAttempt <= retryLimit ? [] : ["truth-boundary retry attempt exceeds retry limit"]),
  ]);

  return {
    kind: "mailchimp.truth-boundary.operational-health",
    apiVersion: "aios.runtime/v1",
    health: {
      status: healthStatus,
      degraded,
      retryable,
      retryAttempt,
      retryLimit,
      lastStatusEvent: recoveryStatus.statusEvent,
      failureCount: observedFailures.length,
    },
    retryPlan: {
      restartToken: recoveryStatus.restartToken,
      nextBackoffSeconds: retryable ? nextBackoffSeconds : null,
      commands: {
        retry: {
          idempotent: true,
          idempotencyKey: `${persistedState.stateKey}:health-retry:${retryAttempt}:${recoveryStatus.restartToken}`,
          command: retryable ? "truth-boundary.claim.retry" : "truth-boundary.claim.review",
          enabled: retryable,
        },
        degrade: {
          idempotent: true,
          idempotencyKey: `${persistedState.stateKey}:degraded:${claimContract.exportId}`,
          command: degraded ? "truth-boundary.claim.degraded-review" : "truth-boundary.claim.review",
          enabled: degraded,
        },
      },
    },
    degradedMode: {
      enabled: degraded,
      readableClaims: claimContract.claims
        .filter((claim) => claim.evidenceReady)
        .map((claim) => claim.subject),
      blockedClaims: claimContract.missingClaims,
      externalWritesAllowed: false,
      visibleMessage: degraded
        ? "Some Mailchimp truth-boundary claims are available, but handoff requires review before resume."
        : "Truth-boundary claims are healthy or waiting for retry review.",
    },
    actionableErrors,
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      canHandoff: healthStatus === "healthy" && tenantBoundary.validation.ready,
    },
  };
}

function buildTruthBoundaryAnalytics(
  program,
  audit,
  claimContract,
  persistedState,
  tenantBoundary,
  operationalHealth,
  exportSnapshot,
  recoveryStatus,
  options,
) {
  const generatedAt = options.analyticsGeneratedAt ?? "logical:6";
  const priorHistory = Array.isArray(options.analyticsHistory) ? options.analyticsHistory : [];
  const evidenceSummary = normalizeTruthBoundaryEvidence(audit.evidence);
  const readyClaimCount = claimContract.claims.filter((claim) => claim.evidenceReady).length;
  const timelineSnapshots = audit.timeline.map((event, index) => ({
    index,
    status: event.status,
    at: event.at,
    message: event.message,
    claimReadyCount: readyClaimCount,
    missingClaimCount: claimContract.missingClaims.length,
  }));
  const claimOutputs = uniqueSorted(claimContract.claims.map((claim) => claim.output));
  const counters = {
    claims: {
      total: claimContract.claims.length,
      ready: readyClaimCount,
      missing: claimContract.missingClaims.length,
      outputs: claimOutputs.length,
    },
    evidence: {
      recorded: evidenceSummary.recorded.length,
      missing: evidenceSummary.missing.length,
      rejected: evidenceSummary.rejected.length,
    },
    boundary: {
      externalWritesObserved: audit.boundary.externalWritesObserved.length,
      externalWritesAllowed: false,
    },
    runtime: {
      persistedVersion: persistedState.version,
      retryAttempt: operationalHealth.health.retryAttempt,
      failureCount: operationalHealth.health.failureCount,
      degraded: operationalHealth.health.degraded,
    },
  };
  const exportId = `${exportSnapshot.exportId}:analytics`;
  const historyEntry = {
    cursor: `${program.job.id}:truth-boundary:analytics:${persistedState.version}`,
    generatedAt,
    status: audit.status,
    health: operationalHealth.health.status,
    readyClaims: counters.claims.ready,
    missingClaims: counters.claims.missing,
    externalWritesObserved: counters.boundary.externalWritesObserved,
  };
  const history = [...priorHistory, historyEntry].slice(-10);
  const validationBlockers = uniqueSorted([
    ...(timelineSnapshots.length > 0 ? [] : ["truth-boundary analytics requires timeline snapshots"]),
    ...(claimContract.claims.length > 0 ? [] : ["truth-boundary analytics requires claim counters"]),
    ...(exportSnapshot.exportId ? [] : ["truth-boundary analytics requires export snapshot id"]),
    ...(tenantBoundary.scope.tenantId ? [] : ["truth-boundary analytics requires tenant scope"]),
  ]);

  return {
    kind: "mailchimp.truth-boundary.analytics",
    apiVersion: "aios.reporting/v1",
    counters,
    timelineSnapshots,
    exportSummary: {
      exportId,
      sourceExportId: exportSnapshot.exportId,
      generatedAt,
      format: "json.analytics-summary",
      readyForExport: validationBlockers.length === 0,
      tenantId: tenantBoundary.scope.tenantId,
      workspaceId: tenantBoundary.scope.workspaceId,
      healthStatus: operationalHealth.health.status,
      restartToken: recoveryStatus.restartToken,
      claimSubjects: claimContract.claims.map((claim) => claim.subject),
      evidenceSubjects: evidenceSummary.recordedSubjects,
    },
    report: {
      title: "Mailchimp truth-boundary report",
      status: audit.status,
      health: operationalHealth.health.status,
      readiness: validationBlockers.length === 0 ? "export_ready" : "needs_review",
      keyMetrics: [
        { name: "claims.total", value: counters.claims.total },
        { name: "claims.ready", value: counters.claims.ready },
        { name: "evidence.missing", value: counters.evidence.missing },
        { name: "boundary.externalWritesObserved", value: counters.boundary.externalWritesObserved },
      ],
    },
    history: {
      cursor: historyEntry.cursor,
      entries: history,
      snapshotCount: history.length,
      latest: historyEntry,
    },
    evidenceLineage: {
      recordedSubjects: evidenceSummary.recordedSubjects,
      missingSubjects: evidenceSummary.missingSubjects,
      rejectedSubjects: evidenceSummary.rejectedSubjects,
      source: "mailchimp-truth-boundary-job",
      externalWritesAllowed: false,
    },
    validation: {
      ready: validationBlockers.length === 0,
      blockers: validationBlockers,
      exportReady: validationBlockers.length === 0
        && counters.boundary.externalWritesAllowed === false
        && Boolean(exportSnapshot.truthBoundary.readyForExport),
    },
  };
}

function normalizeTruthBoundaryEvidence(evidence = {}) {
  const recorded = Array.isArray(evidence.present)
    ? evidence.present
    : Array.isArray(evidence.accepted)
      ? evidence.accepted
      : [];
  const missing = Array.isArray(evidence.missing) ? evidence.missing : [];
  const rejected = Array.isArray(evidence.rejected) ? evidence.rejected : [];

  return {
    recorded,
    missing,
    rejected,
    recordedSubjects: uniqueSorted(recorded.map((entry) => entry.subject ?? entry)),
    missingSubjects: uniqueSorted(missing.map((entry) => entry.subject ?? entry)),
    rejectedSubjects: uniqueSorted(rejected.map((entry) => entry.subject ?? entry)),
  };
}

export function buildTruthBoundaryClientRuntimeHandoff(
  program = buildTruthBoundaryProgram(),
  audit = buildTruthBoundaryAudit(program),
  claimContract,
  persistedState,
  tenantBoundary,
  operationalHealth,
  analytics,
  recoveryStatus,
  options = {},
) {
  const fallbackRecoveryStatus = recoveryStatus
    ?? buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit));
  const fallbackExportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:4",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const resolvedClaimContract = claimContract
    ?? buildClaimContract(program, audit, fallbackExportSnapshot);
  const resolvedPersistedState = persistedState
    ?? buildTruthBoundaryPersistedState(program, audit, resolvedClaimContract, fallbackRecoveryStatus, options);
  const resolvedTenantBoundary = tenantBoundary
    ?? buildTruthBoundaryTenantBoundary(
      program,
      audit,
      resolvedClaimContract,
      resolvedPersistedState,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedOperationalHealth = operationalHealth
    ?? buildTruthBoundaryOperationalHealth(
      program,
      audit,
      resolvedClaimContract,
      resolvedPersistedState,
      resolvedTenantBoundary,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedAnalytics = analytics
    ?? buildTruthBoundaryAnalytics(
      program,
      audit,
      resolvedClaimContract,
      resolvedPersistedState,
      resolvedTenantBoundary,
      resolvedOperationalHealth,
      fallbackExportSnapshot,
      fallbackRecoveryStatus,
      options,
    );
  const accepted = options.claimAccepted === true || options.accepted === true;
  const requestId = options.requestId
    ?? `${program.job.id}:truth-boundary-client:${resolvedClaimContract.exportId}`;
  const claimRows = resolvedClaimContract.claims.map((claim, index) => {
    const persistedClaim = resolvedPersistedState.shape.claims
      .find((entry) => entry.subject === claim.subject);

    return {
      rowId: `${requestId}:claim:${index + 1}`,
      subject: claim.subject,
      output: claim.output,
      verifierHints: claim.verifierHints,
      evidenceState: claim.evidenceReady ? "recorded" : "missing",
      persistenceState: persistedClaim?.persistedAt ? "persisted" : "not_persisted",
      visibleStatus: claim.evidenceReady && persistedClaim?.persistedAt ? "ready" : "needs_review",
    };
  });
  const validationBlockers = uniqueSorted([
    ...(resolvedClaimContract.ready ? [] : ["client runtime requires complete truth-boundary claims"]),
    ...(resolvedPersistedState.validation.restartSafe ? [] : ["client runtime requires restart-safe truth-boundary state"]),
    ...(resolvedTenantBoundary.validation.ready ? [] : ["client runtime requires tenant-boundary handoff allowance"]),
    ...(resolvedOperationalHealth.validation.canHandoff ? [] : ["client runtime requires healthy truth-boundary handoff"]),
    ...(resolvedAnalytics.validation.exportReady ? [] : ["client runtime requires export-ready analytics summary"]),
    ...(fallbackRecoveryStatus.ready ? [] : ["client runtime requires ready recovery handoff"]),
    ...(claimRows.some((row) => row.visibleStatus !== "ready")
      ? ["client runtime claim rows require review"]
      : []),
    ...(audit.boundary.externalWritesObserved.length > 0
      ? ["client runtime blocks truth-boundary external writes"]
      : []),
  ]);
  const readyForAcceptance = validationBlockers.length === 0;
  const acceptanceCommand = readyForAcceptance && accepted
    ? "truth-boundary.claim.accept"
    : readyForAcceptance
      ? "truth-boundary.claim.preview"
      : "truth-boundary.claim.review";

  return {
    kind: "mailchimp.truth-boundary.client-runtime-handoff",
    apiVersion: "aios.client/v1",
    request: {
      requestId,
      command: acceptanceCommand,
      source: "mailchimp-truth-boundary",
      tenantId: resolvedTenantBoundary.scope.tenantId,
      workspaceId: resolvedTenantBoundary.scope.workspaceId,
      exportId: resolvedClaimContract.exportId,
      analyticsExportId: resolvedAnalytics.exportSummary.exportId,
      idempotencyKey: `${resolvedPersistedState.stateKey}:client:${requestId}`,
    },
    visibleState: {
      title: "Mailchimp truth-boundary claims",
      phase: readyForAcceptance ? "ready_for_acceptance" : "needs_review",
      health: resolvedOperationalHealth.health.status,
      reportCursor: resolvedAnalytics.history.cursor,
      claimRows,
      primaryAction: accepted && readyForAcceptance
        ? "truth-boundary.claim.resume"
        : acceptanceCommand,
      validationSummary: {
        totalClaims: claimRows.length,
        readyClaims: claimRows.filter((row) => row.visibleStatus === "ready").length,
        missingClaims: resolvedClaimContract.missingClaims.length,
        externalWritesObserved: audit.boundary.externalWritesObserved.length,
      },
    },
    acceptanceGate: {
      accepted,
      readyForAcceptance,
      command: acceptanceCommand,
      idempotent: true,
      idempotencyKey: `${resolvedPersistedState.stateKey}:accept:${requestId}`,
      requiresOperatorAcceptance: readyForAcceptance,
      resumeCommand: accepted && readyForAcceptance
        ? "truth-boundary.claim.resume"
        : "truth-boundary.claim.review",
      restartToken: fallbackRecoveryStatus.restartToken,
      auditHandoffId: resolvedTenantBoundary.auditHandoff.handoffId,
    },
    nextSteps: [
      {
        action: readyForAcceptance ? "show-claim-preview" : "review-claim-blockers",
        label: readyForAcceptance ? "Show truth-boundary claim preview" : "Review truth-boundary blockers",
        enabled: true,
      },
      {
        action: "accept-claims",
        label: "Accept truth-boundary claims",
        enabled: readyForAcceptance && !accepted,
      },
      {
        action: "resume-runtime",
        label: "Resume truth-boundary runtime",
        enabled: readyForAcceptance && accepted,
      },
    ],
    validation: {
      ready: readyForAcceptance && (options.requireClaimAcceptance !== true || accepted),
      readyForAcceptance,
      blockers: options.requireClaimAcceptance !== true || accepted
        ? validationBlockers
        : uniqueSorted([...validationBlockers, "operator truth-boundary claim acceptance is required"]),
    },
  };
}

export function buildTruthBoundaryAdapterRecoveryHandoff(
  program = buildTruthBoundaryProgram(),
  audit = buildTruthBoundaryAudit(program),
  claimContract,
  persistedState,
  tenantBoundary,
  operationalHealth,
  analytics,
  clientRuntimeHandoff,
  recoveryStatus,
  options = {},
) {
  const fallbackRecoveryStatus = recoveryStatus
    ?? buildRecoveryStatusHandoff(buildRollbackContract(withRollbackVerifierHints(program), audit));
  const fallbackExportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:4",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const resolvedClaimContract = claimContract
    ?? buildClaimContract(program, audit, fallbackExportSnapshot);
  const resolvedPersistedState = persistedState
    ?? buildTruthBoundaryPersistedState(program, audit, resolvedClaimContract, fallbackRecoveryStatus, options);
  const resolvedTenantBoundary = tenantBoundary
    ?? buildTruthBoundaryTenantBoundary(
      program,
      audit,
      resolvedClaimContract,
      resolvedPersistedState,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedOperationalHealth = operationalHealth
    ?? buildTruthBoundaryOperationalHealth(
      program,
      audit,
      resolvedClaimContract,
      resolvedPersistedState,
      resolvedTenantBoundary,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedAnalytics = analytics
    ?? buildTruthBoundaryAnalytics(
      program,
      audit,
      resolvedClaimContract,
      resolvedPersistedState,
      resolvedTenantBoundary,
      resolvedOperationalHealth,
      fallbackExportSnapshot,
      fallbackRecoveryStatus,
      options,
    );
  const resolvedClientRuntimeHandoff = clientRuntimeHandoff
    ?? buildTruthBoundaryClientRuntimeHandoff(
      program,
      audit,
      resolvedClaimContract,
      resolvedPersistedState,
      resolvedTenantBoundary,
      resolvedOperationalHealth,
      resolvedAnalytics,
      fallbackRecoveryStatus,
      options,
    );
  const adapterId = options.adapterId ?? "adapter:mailchimp.truth-boundary";
  const statusCursor = options.adapterStatusCursor
    ?? `${program.job.id}:truth-boundary:adapter-status:${resolvedPersistedState.version}`;
  const commandId = options.adapterCommandId
    ?? `${adapterId}:${resolvedPersistedState.stateKey}:${resolvedClaimContract.exportId}`;
  const readyForAdapter = resolvedClientRuntimeHandoff.validation.ready
    && resolvedOperationalHealth.validation.canHandoff
    && resolvedTenantBoundary.auditHandoff.decision === "allow_handoff"
    && fallbackRecoveryStatus.ready;
  const needsRetry = resolvedOperationalHealth.health.retryable
    || audit.status === "failed"
    || fallbackRecoveryStatus.blockedReasons.length > 0;
  const commandName = readyForAdapter
    ? "mailchimp.truth-boundary.adapter.resume"
    : needsRetry
      ? "mailchimp.truth-boundary.adapter.retry"
      : "mailchimp.truth-boundary.adapter.review";
  const checkpoint = {
    checkpointId: `${commandId}:checkpoint`,
    jobId: program.job.id,
    stateKey: resolvedPersistedState.stateKey,
    restoreCursor: resolvedPersistedState.shape.restoreCursor,
    restartToken: fallbackRecoveryStatus.restartToken,
    exportId: resolvedClaimContract.exportId,
    analyticsExportId: resolvedAnalytics.exportSummary.exportId,
    auditHandoffId: resolvedTenantBoundary.auditHandoff.handoffId,
  };
  const timeline = [
    {
      status: "adapter_checkpoint_bound",
      at: options.adapterCheckedAt ?? "logical:7",
      message: "Adapter recovery checkpoint bound to persisted truth-boundary state.",
      cursor: statusCursor,
    },
    {
      status: readyForAdapter ? "adapter_resume_ready" : needsRetry ? "adapter_retry_ready" : "adapter_review_required",
      at: options.adapterStatusAt ?? "logical:8",
      message: readyForAdapter
        ? "Adapter can resume Mailchimp truth-boundary handoff from restart token."
        : needsRetry
          ? "Adapter can retry Mailchimp truth-boundary handoff after recovery delay."
          : "Adapter requires operator review before Mailchimp truth-boundary handoff.",
      cursor: `${statusCursor}:decision`,
    },
  ];
  const recoveryInputs = {
    claimReady: resolvedClaimContract.ready,
    stateRestartSafe: resolvedPersistedState.validation.restartSafe,
    tenantReady: resolvedTenantBoundary.validation.ready,
    healthStatus: resolvedOperationalHealth.health.status,
    clientReady: resolvedClientRuntimeHandoff.validation.ready,
    recoveryReady: fallbackRecoveryStatus.ready,
    externalWritesObserved: audit.boundary.externalWritesObserved.length,
  };
  const validationBlockers = uniqueSorted([
    ...(resolvedClaimContract.ready ? [] : ["adapter recovery requires complete claim contract"]),
    ...(resolvedPersistedState.validation.restartSafe ? [] : ["adapter recovery requires restart-safe persisted state"]),
    ...(resolvedTenantBoundary.validation.ready ? [] : ["adapter recovery requires tenant-boundary allowance"]),
    ...(resolvedOperationalHealth.validation.canHandoff || needsRetry
      ? []
      : ["adapter recovery requires healthy handoff or retryable failure"]),
    ...(resolvedClientRuntimeHandoff.validation.ready || needsRetry
      ? []
      : ["adapter recovery requires accepted client runtime handoff"]),
    ...(fallbackRecoveryStatus.restartToken ? [] : ["adapter recovery requires restart token"]),
    ...(audit.boundary.externalWritesObserved.length === 0
      ? []
      : ["adapter recovery blocks observed external writes"]),
  ]);

  return {
    kind: "mailchimp.truth-boundary.adapter-recovery-handoff",
    apiVersion: "aios.adapter/v1",
    adapter: {
      adapterId,
      provider: "mailchimp",
      resource: "campaign-truth-boundary",
      externalWritesAllowed: false,
      statusCursor,
    },
    checkpoint,
    command: {
      commandId,
      command: commandName,
      idempotent: true,
      idempotencyKey: `${resolvedPersistedState.stateKey}:adapter:${commandName}:${fallbackRecoveryStatus.restartToken}`,
      enabled: validationBlockers.length === 0 && (readyForAdapter || needsRetry),
      retryAfterSeconds: needsRetry
        ? resolvedOperationalHealth.retryPlan.nextBackoffSeconds
        : null,
      payload: {
        restartToken: fallbackRecoveryStatus.restartToken,
        stateKey: resolvedPersistedState.stateKey,
        restoreCursor: resolvedPersistedState.shape.restoreCursor,
        tenantId: resolvedTenantBoundary.scope.tenantId,
        workspaceId: resolvedTenantBoundary.scope.workspaceId,
        exportId: resolvedClaimContract.exportId,
        analyticsExportId: resolvedAnalytics.exportSummary.exportId,
      },
    },
    status: {
      status: readyForAdapter ? "resume_ready" : needsRetry ? "retry_ready" : "review_required",
      event: timeline[timeline.length - 1],
      timeline,
      recoveryInputs,
      handoffToken: readyForAdapter
        ? `${adapterId}:${fallbackRecoveryStatus.restartToken}:${resolvedClaimContract.exportId}`
        : null,
    },
    validation: {
      ready: validationBlockers.length === 0 && readyForAdapter,
      retryable: validationBlockers.length === 0 && needsRetry,
      blockers: validationBlockers,
      nextAction: validationBlockers.length > 0
        ? "review-adapter-recovery-blockers"
        : readyForAdapter
          ? "resume-adapter-handoff"
          : "retry-adapter-handoff",
    },
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
