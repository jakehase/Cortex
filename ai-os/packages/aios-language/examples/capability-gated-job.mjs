import {
  buildPackageReadinessPreview,
  buildProviderServiceContract,
  compilePackageSource,
} from "../stdlib/packages.mjs";
import {
  buildAuditTimelineState,
  createAuditExportSnapshot,
  createEvidence,
  createProviderSyncEvidence,
  createStatusEvent,
  createTruthBoundaryReport,
} from "../stdlib/audit.mjs";

export const capabilityGatedJobSource = `# deterministic Mailchimp capability gate before runtime handoff
use mailchimp:campaign.read
use mailchimp:report.read
use memory:campaign.local
use verifier:evidence.record
use status:timeline.write
recover rollback=snapshot retry=2
step negotiate-capabilities input=providerScopes output=capabilityGrant verify.contract=provider-grant
step fetch-campaign input=campaignId output=campaign verify.intent=read-only
step fetch-report input=campaign.id output=report verify.source=mailchimp
step verify-local-memory input=report output=memoryClaim verify.boundary=local-only
step emit-status-handoff input=memoryClaim output=statusEvent verify.status=adapter-handoff
`;

const REQUIRED_PROVIDER_CAPABILITIES = Object.freeze([
  "mailchimp:campaign.read",
  "mailchimp:report.read",
]);

const REQUIRED_EXPORTS = Object.freeze([
  "compile",
  "audit",
  "process",
  "operatorConsole",
  "capabilityGate",
  "operationalHealth",
  "recoveryStatus",
  "providerHandoff",
  "persistedRecoveryState",
]);

const REQUIRED_GATE_PERMISSIONS = Object.freeze([
  "campaign:read",
  "report:read",
  "memory:write-local",
  "status:handoff",
]);

export function buildCapabilityGatedProgram(options = {}) {
  return compilePackageSource(capabilityGatedJobSource, {
    name: options.name ?? "mailchimp-capability-gated-job",
    version: options.version ?? "0.1.0",
    description: "Compile a Mailchimp read job that must pass provider capability gates before runtime handoff.",
    capabilities: options.capabilities ?? [],
    exports: {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      process: "./stdlib/processes.mjs#createProcessEnvelope",
      operatorConsole: "./stdlib/operator-console.mjs#buildOperatorConsoleModel",
      capabilityGate: "./examples/capability-gated-job.mjs#buildCapabilityGateContract",
      operationalHealth: "./examples/capability-gated-job.mjs#buildCapabilityGateOperationalHealth",
      recoveryStatus: "./examples/capability-gated-job.mjs#buildCapabilityGateRecoveryStatus",
      providerHandoff: "./examples/capability-gated-job.mjs#buildCapabilityGateProviderHandoffState",
      persistedRecoveryState: "./examples/capability-gated-job.mjs#buildCapabilityGatePersistedRecoveryState",
    },
  }, {
    name: "mailchimp-capability-gated-job",
    memoryMode: "ephemeral",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: options.dryRun ?? true,
      requireApproval: options.requireApproval ?? true,
      approvalTicket: options.approvalTicket,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 15,
    },
  });
}

export function buildCapabilityGateContract(program = buildCapabilityGatedProgram(), options = {}) {
  const providerContract = buildProviderServiceContract(program, {
    externalApproval: options.approvalTicket,
    providerResource: options.providerResource ?? "campaign-report",
    supportedCapabilities: options.supportedCapabilities,
    syncCursor: options.syncCursor,
    checkpoint: options.checkpoint,
  });
  const missingProviderCapabilities = REQUIRED_PROVIDER_CAPABILITIES
    .filter((capability) => !providerContract.negotiation.grantedCapabilities.includes(capability));
  const deniedCapabilities = providerContract.negotiation.deniedCapabilities
    .map((entry) => entry.capability);
  const exportStatus = validateManifestExports(program.manifest.exports);
  const workspaceBoundary = buildCapabilityGateWorkspaceBoundary(program, providerContract, options);
  const gateErrors = [
    ...missingProviderCapabilities.map((capability) => `required provider capability not granted: ${capability}`),
    ...exportStatus.missing.map((name) => `manifest export missing: ${name}`),
    ...workspaceBoundary.blockedReasons,
  ];

  return deepFreeze({
    kind: "mailchimp.capability-gate.contract",
    apiVersion: "aios.example/v1",
    jobId: program.job.id,
    package: program.job.package,
    provider: providerContract.provider,
    requestedCapabilities: providerContract.negotiation.requestedCapabilities,
    requiredProviderCapabilities: REQUIRED_PROVIDER_CAPABILITIES,
    grantedCapabilities: providerContract.negotiation.grantedCapabilities,
    deniedCapabilities,
    providerScopes: providerContract.negotiation.providerScopes,
    memory: {
      namespace: program.job.memory.namespace,
      writePolicy: program.job.memory.writePolicy,
      externalWritesAllowed: false,
    },
    workspaceBoundary,
    exports: exportStatus,
    status: {
      ready: gateErrors.length === 0 && providerContract.handoffState.ready,
      nextAction: gateErrors.length > 0
        ? "provider.capabilities.review"
        : providerContract.handoffState.nextAction,
      runtimeCommand: gateErrors.length === 0
        ? providerContract.handoffState.runtimeCommand
        : null,
      blockedReasons: uniqueSorted([
        ...gateErrors,
        ...providerContract.handoffState.blockedReasons,
      ]),
    },
    sync: providerContract.sync,
    handoffToken: gateErrors.length === 0 ? providerContract.handoffState.handoffToken : null,
  });
}

export function buildCapabilityGateWorkspaceBoundary(
  program = buildCapabilityGatedProgram(),
  providerContract = buildProviderServiceContract(program),
  options = {},
) {
  const tenantId = normalizeScopePart(options.tenantId ?? "tenant_mailchimp_default", "tenant");
  const workspaceId = normalizeScopePart(options.workspaceId ?? "workspace_mailchimp_default", "workspace");
  const role = String(options.role ?? "operator").trim().toLowerCase();
  const permissions = uniqueSorted(options.permissions ?? REQUIRED_GATE_PERMISSIONS);
  const allowedRoles = new Set(["operator", "service"]);
  const providerNamespace = providerContract?.sync?.localNamespace ?? program.job.memory.namespace;
  const scopeKey = `${program.job.memory.namespace}:tenant:${tenantId}:workspace:${workspaceId}`;
  const blockedReasons = uniqueSorted([
    ...(allowedRoles.has(role) ? [] : [`capability gate role denied: ${role}`]),
    ...REQUIRED_GATE_PERMISSIONS
      .filter((permission) => !permissions.includes(permission))
      .map((permission) => `capability gate permission missing: ${permission}`),
    ...(tenantId === "tenant_public" ? ["capability gate tenant scope must not be public"] : []),
    ...(workspaceId === "workspace_public" ? ["capability gate workspace scope must not be public"] : []),
    ...(providerNamespace === program.job.memory.namespace
      ? []
      : [`capability gate namespace mismatch: ${providerNamespace}`]),
    ...(program.job.memory.writePolicy === "local-only"
      ? []
      : [`capability gate memory policy must be local-only: ${program.job.memory.writePolicy}`]),
  ]);

  return deepFreeze({
    kind: "mailchimp.capability-gate.workspace-boundary",
    apiVersion: "aios.security/v1",
    tenantId,
    workspaceId,
    scopeKey,
    role,
    permissions,
    requiredPermissions: REQUIRED_GATE_PERMISSIONS,
    providerNamespace,
    ready: blockedReasons.length === 0,
    auditHandoff: {
      subject: `${tenantId}/${workspaceId}/${program.job.id}/capability-gate`,
      command: "audit.capability-boundary.record",
      idempotencyKey: `${program.job.id}:capability-gate:boundary:${stableToken([
        tenantId,
        workspaceId,
        role,
        permissions.join(","),
      ])}`,
    },
    blockedReasons,
  });
}

export function buildCapabilityGateAudit(program = buildCapabilityGatedProgram(), options = {}) {
  const missingSubjects = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missingSubjects.has(subject))
    .map((subject) => {
      if (subject.includes("verify.source")) {
        return createEvidence("mailchimp-read-receipt", subject, { surface: "capability-gated-job" });
      }
      if (subject.includes("verify.")) {
        return createEvidence("operator-attestation", subject, { surface: "capability-gated-job" });
      }
      return createEvidence("runtime-local-receipt", subject, { surface: "capability-gated-job" });
    });

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "completed",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "capability-gated job queued" }),
      createStatusEvent("running", { at: "logical:1", message: "provider capability grant evaluated" }),
      createStatusEvent("verifying", { at: "logical:2", message: "truth boundary and memory claim checked" }),
      createStatusEvent(options.status ?? "completed", {
        at: "logical:3",
        message: "status handoff contract shaped",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildCapabilityGateRecoveryStatus(
  program = buildCapabilityGatedProgram(),
  audit = buildCapabilityGateAudit(program),
  gate = buildCapabilityGateContract(program),
  options = {},
) {
  const timelineState = buildAuditTimelineState(audit, {
    history: options.history ?? [],
  });
  const completedSteps = Number.isInteger(options.completedSteps)
    ? options.completedSteps
    : audit.status === "completed"
      ? program.job.plan.length
      : Math.max(0, program.job.plan.length - audit.evidence.missing.length - 1);
  const adapter = normalizeAdapterRecovery(options.adapterStatus, options.adapterRetryAfterSeconds);
  const checkpoints = program.job.plan.map((step, index) => {
    const complete = index < completedSteps;
    const evidenceMissing = audit.evidence.missing.includes(`step:${step.op}`)
      || audit.evidence.missing.some((subject) => subject.startsWith(`step:${step.op}:`));

    return {
      key: `${program.job.memory.namespace}:gate:${index + 1}:${step.op}`,
      stepId: step.id,
      command: step.op,
      complete,
      evidenceReady: !evidenceMissing,
      resumeCursor: `${program.job.id}:gate:${index + 1}`,
      verifierClaims: step.verifierHints,
    };
  });
  const operationalHealth = buildCapabilityGateOperationalHealth(
    program,
    audit,
    gate,
    adapter,
    checkpoints,
    options,
  );
  const blockedReasons = uniqueSorted([
    ...gate.status.blockedReasons,
    ...audit.evidence.missing.map((subject) => `missing verifier evidence: ${subject}`),
    ...audit.boundary.externalWritesObserved.map((write) => `external write observed: ${write.subject ?? write}`),
    ...operationalHealth.blockedReasons,
  ]);
  const ready = blockedReasons.length === 0 && gate.status.ready && operationalHealth.runtimeEnabled;

  return deepFreeze({
    kind: "mailchimp.capability-gate.recovery-status",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready,
    statusEvent: ready ? "completed" : "verifying",
    runtimeCommand: ready ? gate.status.runtimeCommand : "recovery.review",
    restartToken: ready ? stableToken([
      program.job.id,
      gate.handoffToken,
      timelineState.current.label,
      checkpoints.filter((checkpoint) => checkpoint.complete).length,
    ]) : null,
    adapter: {
      name: program.job.runtimeAdapter,
      status: adapter.status,
      handoff: ready ? "available" : adapter.handoff,
      retryAfterSeconds: adapter.retryAfterSeconds,
    },
    operationalHealth,
    truthBoundary: {
      externalWritesAllowed: false,
      memoryWritePolicy: program.job.memory.writePolicy,
      checkpointCount: checkpoints.length,
      incompleteCheckpoints: checkpoints.filter((checkpoint) => !checkpoint.complete).length,
    },
    checkpoints,
    timelineState,
    blockedReasons,
  });
}

export function buildCapabilityGateOperationalHealth(
  program = buildCapabilityGatedProgram(),
  audit = buildCapabilityGateAudit(program),
  gate = buildCapabilityGateContract(program),
  adapter = normalizeAdapterRecovery(),
  checkpoints = [],
  options = {},
) {
  const retryAttempt = Math.max(0, Number(options.retryAttempt ?? 0));
  const maxRetries = Math.max(0, Number(options.maxRetries ?? program.job.recovery.retry ?? 2));
  const retryAfterSeconds = adapter.status === "degraded"
    ? Math.max(5, Number(adapter.retryAfterSeconds ?? options.adapterRetryAfterSeconds ?? 30))
    : null;
  const incompleteCheckpoints = checkpoints.filter((checkpoint) => !checkpoint.complete);
  const missingCheckpointEvidence = checkpoints
    .filter((checkpoint) => !checkpoint.evidenceReady)
    .map((checkpoint) => checkpoint.command);
  const externalWrites = audit.boundary.externalWritesObserved.map((write) => String(write.subject ?? write.target ?? write));
  const blockedReasons = uniqueSorted([
    ...(gate.status.ready ? [] : gate.status.blockedReasons),
    ...(adapter.status === "offline" ? ["capability gate adapter is offline"] : []),
    ...(retryAttempt > maxRetries ? [`capability gate retry budget exhausted: ${retryAttempt}/${maxRetries}`] : []),
    ...audit.evidence.missing.map((subject) => `capability gate evidence missing: ${subject}`),
    ...missingCheckpointEvidence.map((command) => `capability gate checkpoint evidence missing: ${command}`),
    ...externalWrites.map((subject) => `capability gate external write observed: ${subject}`),
  ]);
  const degraded = adapter.status === "degraded" || retryAttempt > 0 || incompleteCheckpoints.length > 0;
  const runtimeEnabled = blockedReasons.length === 0 && adapter.status !== "offline";
  const mode = runtimeEnabled
    ? degraded ? "degraded-retry" : "normal"
    : adapter.status === "offline" ? "offline" : "blocked";
  const severity = blockedReasons.length > 0
    ? adapter.status === "offline" || retryAttempt > maxRetries ? "critical" : "error"
    : degraded ? "warning" : "ok";
  const nextAction = adapter.status === "offline"
    ? "adapter.status.poll"
    : retryAttempt > maxRetries
      ? "capability-gate.retry-budget.review"
      : audit.evidence.missing.length > 0 || missingCheckpointEvidence.length > 0
        ? "verifier.evidence.collect"
        : gate.status.ready ? "provider.handoff.dispatch" : gate.status.nextAction;
  const failureState = blockedReasons.length === 0
    ? null
    : {
      code: severity === "critical" ? "capability_gate_critical" : "capability_gate_blocked",
      message: blockedReasons[0],
      retryable: adapter.status !== "offline" && retryAttempt <= maxRetries,
      lastGoodCheckpoint: checkpoints
        .filter((checkpoint) => checkpoint.complete && checkpoint.evidenceReady)
        .at(-1)?.resumeCursor ?? null,
    };
  const incidentPlan = buildCapabilityGateIncidentPlan(
    program,
    gate,
    adapter,
    checkpoints,
    blockedReasons,
    retryAttempt,
    maxRetries,
    retryAfterSeconds,
  );

  return deepFreeze({
    kind: "mailchimp.capability-gate.operational-health",
    apiVersion: "aios.health/v1",
    jobId: program.job.id,
    mode,
    severity,
    degraded,
    adapterStatus: adapter.status,
    retryAttempt,
    maxRetries,
    retryAfterSeconds,
    runtimeEnabled,
    nextAction,
    failureState,
    incidentPlan,
    counters: {
      totalCheckpoints: checkpoints.length,
      incompleteCheckpoints: incompleteCheckpoints.length,
      missingEvidence: audit.evidence.missing.length,
      externalWriteViolations: externalWrites.length,
      grantedCapabilities: gate.grantedCapabilities.length,
      deniedCapabilities: gate.deniedCapabilities.length,
    },
    blockedReasons,
    actionableErrors: blockedReasons.map((reason) => ({
      reason,
      action: reason.includes("evidence")
        ? "verifier.evidence.collect"
        : reason.includes("retry budget")
          ? "capability-gate.retry-budget.review"
          : reason.includes("offline")
            ? "adapter.status.poll"
            : "capability-gate.review",
      retryAfterSeconds,
      idempotencyKey: `${program.job.id}:capability-gate:health:${stableToken([
        reason,
        retryAttempt,
        maxRetries,
      ])}`,
    })),
  });
}

export function buildCapabilityGateIncidentPlan(
  program = buildCapabilityGatedProgram(),
  gate = buildCapabilityGateContract(program),
  adapter = normalizeAdapterRecovery(),
  checkpoints = [],
  blockedReasons = [],
  retryAttempt = 0,
  maxRetries = program.job.recovery.retry ?? 2,
  retryAfterSeconds = null,
) {
  const checkpointRows = checkpoints.map((checkpoint, index) => ({
    id: checkpoint.stepId,
    command: checkpoint.command,
    ordinal: index + 1,
    state: checkpoint.complete
      ? checkpoint.evidenceReady ? "complete" : "evidence-missing"
      : checkpoint.evidenceReady ? "incomplete" : "blocked",
    resumeCursor: checkpoint.resumeCursor,
    verifierClaimCount: Object.keys(checkpoint.verifierClaims ?? {}).length,
  }));
  const actionableReasons = uniqueSorted(blockedReasons);
  const retryable = adapter.status !== "offline" && Number(retryAttempt) <= Number(maxRetries);
  const escalationRequired = actionableReasons.some((reason) => (
    reason.includes("role denied")
    || reason.includes("permission missing")
    || reason.includes("tenant scope")
    || reason.includes("workspace scope")
    || reason.includes("namespace mismatch")
    || reason.includes("external write")
  ));
  const exhausted = Number(retryAttempt) > Number(maxRetries);
  const primaryAction = adapter.status === "offline"
    ? "adapter.status.poll"
    : exhausted
      ? "capability-gate.retry-budget.review"
      : escalationRequired
        ? "capability-gate.boundary-escalate"
        : actionableReasons.some((reason) => reason.includes("evidence"))
          ? "verifier.evidence.collect"
          : gate.status.nextAction;
  const incidentKey = `${program.job.id}:capability-gate:incident:${stableToken([
    adapter.status,
    retryAttempt,
    maxRetries,
    gate.workspaceBoundary?.scopeKey,
    actionableReasons.join("|"),
  ])}`;

  return deepFreeze({
    kind: "mailchimp.capability-gate.incident-plan",
    apiVersion: "aios.health/v1",
    incidentKey,
    status: actionableReasons.length === 0
      ? "clear"
      : escalationRequired ? "escalation-required" : retryable ? "retryable" : "blocked",
    primaryAction,
    retry: {
      retryable,
      attempt: Number(retryAttempt),
      maxRetries: Number(maxRetries),
      retryAfterSeconds,
      nextRetryCommand: retryable && adapter.status === "degraded" ? "adapter.status.poll" : null,
    },
    scope: {
      tenantId: gate.workspaceBoundary?.tenantId ?? null,
      workspaceId: gate.workspaceBoundary?.workspaceId ?? null,
      role: gate.workspaceBoundary?.role ?? null,
      auditCommand: gate.workspaceBoundary?.auditHandoff?.command ?? null,
      auditIdempotencyKey: gate.workspaceBoundary?.auditHandoff?.idempotencyKey ?? null,
    },
    provider: {
      name: gate.provider?.name ?? "mailchimp",
      requestedCapabilities: gate.requestedCapabilities ?? [],
      grantedCapabilities: gate.grantedCapabilities ?? [],
      deniedCapabilities: gate.deniedCapabilities ?? [],
    },
    summary: {
      blockedReasons: actionableReasons,
      checkpointCount: checkpointRows.length,
      blockedCheckpoints: checkpointRows.filter((row) => row.state === "blocked").length,
      escalationRequired,
      adapterStatus: adapter.status,
    },
    checkpointRows,
  });
}

export function buildCapabilityGatePersistedRecoveryState(
  program = buildCapabilityGatedProgram(),
  audit = buildCapabilityGateAudit(program),
  gate = buildCapabilityGateContract(program),
  recoveryStatus = buildCapabilityGateRecoveryStatus(program, audit, gate),
  providerHandoff = buildCapabilityGateProviderHandoffState(program, audit, gate),
  options = {},
) {
  const receiptMap = buildReceiptMap(options.priorRecoveryReceipts);
  const stateKey = `${program.job.memory.namespace}:capability-gate:recovery:${program.job.id}`;
  const generatedAt = String(options.persistedAt ?? "logical:7");
  const handoffReady = recoveryStatus.ready && providerHandoff.ready;
  const releaseToken = handoffReady ? stableToken([
    program.job.id,
    recoveryStatus.restartToken,
    providerHandoff.externalHandoff.handoffToken,
    generatedAt,
  ]) : null;
  const rows = recoveryStatus.checkpoints.map((checkpoint, index) => {
    const prior = receiptMap.get(checkpoint.key)
      ?? receiptMap.get(checkpoint.stepId)
      ?? receiptMap.get(checkpoint.command)
      ?? null;
    const replayable = handoffReady && checkpoint.complete && checkpoint.evidenceReady;
    const command = index === recoveryStatus.checkpoints.length - 1
      ? "provider.handoff.dispatch"
      : checkpoint.command;
    const state = prior?.state
      ?? (replayable ? "ready-to-replay" : checkpoint.evidenceReady ? "waiting-for-completion" : "blocked");
    const rowToken = stableToken([
      stateKey,
      checkpoint.key,
      checkpoint.resumeCursor,
      providerHandoff.evidence.providerSyncReceipt,
    ]);

    return {
      id: checkpoint.stepId,
      checkpointKey: checkpoint.key,
      command,
      state,
      complete: checkpoint.complete,
      evidenceReady: checkpoint.evidenceReady,
      resumeCursor: checkpoint.resumeCursor,
      replayable,
      receipt: prior?.receipt ?? null,
      receiptState: prior?.state ?? null,
      persistedKey: `${stateKey}:row:${index + 1}:${rowToken}`,
      idempotencyKey: `${program.job.id}:capability-gate:replay:${index + 1}:${rowToken}`,
      restartCommand: replayable ? command : recoveryStatus.runtimeCommand,
      verifierClaimCount: Object.keys(checkpoint.verifierClaims).length,
      blockers: uniqueSorted([
        ...(checkpoint.complete ? [] : [`checkpoint incomplete: ${checkpoint.command}`]),
        ...(checkpoint.evidenceReady ? [] : [`checkpoint evidence missing: ${checkpoint.command}`]),
        ...(recoveryStatus.ready ? [] : recoveryStatus.blockedReasons),
        ...(providerHandoff.ready ? [] : providerHandoff.blockedReasons),
      ]),
    };
  });
  const replayableRows = rows.filter((row) => row.replayable && row.state !== "applied");
  const appliedRows = rows.filter((row) => row.state === "applied" || row.receiptState === "applied");
  const blockedReasons = uniqueSorted([
    ...recoveryStatus.blockedReasons,
    ...providerHandoff.blockedReasons,
    ...rows.flatMap((row) => row.blockers),
  ]);
  const restartSafe = handoffReady && blockedReasons.length === 0 && replayableRows.length === rows.length;

  return deepFreeze({
    kind: "mailchimp.capability-gate.persisted-recovery-state",
    apiVersion: "aios.state/v1",
    jobId: program.job.id,
    stateKey,
    generatedAt,
    ready: restartSafe,
    status: restartSafe
      ? appliedRows.length === rows.length ? "handoff-replay-complete" : "handoff-replay-ready"
      : blockedReasons.length > 0 ? "handoff-replay-blocked" : "handoff-replay-waiting",
    restart: {
      command: restartSafe ? "provider.handoff.dispatch" : recoveryStatus.runtimeCommand,
      enabled: restartSafe,
      token: releaseToken,
      idempotencyKey: `${program.job.id}:capability-gate:restart:${providerHandoff.evidence.exportId}`,
    },
    adapter: {
      name: recoveryStatus.adapter.name,
      status: recoveryStatus.adapter.status,
      handoff: providerHandoff.externalHandoff.status,
      retryAfterSeconds: recoveryStatus.adapter.retryAfterSeconds,
    },
    evidence: {
      exportId: providerHandoff.evidence.exportId,
      providerSyncReceipt: providerHandoff.evidence.providerSyncReceipt,
      truthBoundaryReady: providerHandoff.evidence.truthBoundaryReady,
    },
    summary: {
      totalRows: rows.length,
      replayableRows: replayableRows.length,
      appliedRows: appliedRows.length,
      blockedRows: rows.filter((row) => row.blockers.length > 0).length,
      blockedReasons,
      healthMode: recoveryStatus.operationalHealth.mode,
      healthSeverity: recoveryStatus.operationalHealth.severity,
    },
    rows,
  });
}

export function buildCapabilityGateProviderHandoffState(
  program = buildCapabilityGatedProgram(),
  audit = buildCapabilityGateAudit(program),
  gate = buildCapabilityGateContract(program),
  options = {},
) {
  const adapter = normalizeAdapterRecovery(options.adapterStatus, options.adapterRetryAfterSeconds);
  const accepted = Boolean(options.accepted ?? false);
  const exportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:4",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const providerSyncEvidence = createProviderSyncEvidence(audit, {
    kind: "aios.package.provider-service-contract",
    apiVersion: "aios.integration/v1",
    provider: gate.provider,
    negotiation: {
      satisfied: gate.deniedCapabilities.length === 0,
      requestedCapabilities: gate.requestedCapabilities,
      grantedCapabilities: gate.grantedCapabilities,
      deniedCapabilities: gate.deniedCapabilities.map((capability) => ({
        capability,
        reason: "provider capability is not declared as supported",
      })),
      providerScopes: gate.providerScopes,
    },
    sync: gate.sync,
    handoffState: {
      ready: gate.status.ready,
      nextAction: gate.status.nextAction,
      runtimeCommand: gate.status.runtimeCommand,
      blockedReasons: gate.status.blockedReasons,
      handoffToken: gate.handoffToken,
    },
  }, {
    generatedAt: options.syncEvidenceAt ?? "logical:6",
  });
  const blockers = uniqueSorted([
    ...(gate.status.ready ? [] : gate.status.blockedReasons),
    ...(gate.workspaceBoundary.ready ? [] : gate.workspaceBoundary.blockedReasons),
    ...(exportSnapshot.truthBoundary.readyForExport ? [] : [exportSnapshot.summary]),
    ...(providerSyncEvidence.readiness.ready ? [] : providerSyncEvidence.readiness.blockedReasons),
    ...(adapter.status === "healthy" ? [] : [`adapter recovery ${adapter.status}`]),
    ...(accepted ? [] : ["operator preview acceptance is pending"]),
  ]);
  const ready = blockers.length === 0;
  const handoffToken = ready ? stableToken([
    program.job.id,
    gate.handoffToken,
    providerSyncEvidence.receipt,
    adapter.status,
  ]) : null;

  return deepFreeze({
    kind: "mailchimp.capability-gate.provider-handoff-state",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready,
    provider: gate.provider,
    workspaceBoundary: gate.workspaceBoundary,
    negotiation: {
      requestedCapabilities: gate.requestedCapabilities,
      grantedCapabilities: gate.grantedCapabilities,
      deniedCapabilities: gate.deniedCapabilities,
      providerScopes: gate.providerScopes,
    },
    sync: {
      checkpoint: gate.sync.checkpoint,
      cursor: gate.sync.cursor,
      direction: gate.sync.direction,
      externalHandoff: ready ? "adapter-status" : "none",
      memoryWritePolicy: gate.sync.memoryWritePolicy,
    },
    externalHandoff: {
      adapter: program.job.runtimeAdapter,
      status: adapter.status,
      command: ready ? gate.status.runtimeCommand : "provider.handoff.review",
      handoffToken,
      retryAfterSeconds: adapter.retryAfterSeconds,
      stages: buildCapabilityGateHandoffStages(ready, handoffToken, providerSyncEvidence.receipt),
    },
    evidence: {
      providerSyncReceipt: providerSyncEvidence.receipt,
      exportId: exportSnapshot.exportId,
      truthBoundaryReady: exportSnapshot.truthBoundary.readyForExport,
      auditHandoff: gate.workspaceBoundary.auditHandoff,
    },
    blockedReasons: blockers,
  });
}

export function buildCapabilityGatedPreview(options = {}) {
  const program = options.program ?? buildCapabilityGatedProgram(options);
  const gate = options.gate ?? buildCapabilityGateContract(program, options);
  const audit = options.audit ?? buildCapabilityGateAudit(program, options);
  const exportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:4",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const readinessPreview = buildPackageReadinessPreview(program, {
    providerContract: buildProviderServiceContract(program, {
      externalApproval: options.approvalTicket,
      providerResource: "campaign-report",
      supportedCapabilities: options.supportedCapabilities,
      checkpoint: exportSnapshot.exportId,
    }),
    acceptance: {
      accepted: options.accepted ?? false,
      acceptedBy: options.acceptedBy,
      acceptedAt: options.acceptedAt ?? "logical:5",
    },
  });
  const recoveryStatus = buildCapabilityGateRecoveryStatus(program, audit, gate, options);
  const providerSyncEvidence = createProviderSyncEvidence(audit, {
    kind: "aios.package.provider-service-contract",
    apiVersion: "aios.integration/v1",
    provider: gate.provider,
    negotiation: {
      satisfied: gate.deniedCapabilities.length === 0,
      requestedCapabilities: gate.requestedCapabilities,
      grantedCapabilities: gate.grantedCapabilities,
      deniedCapabilities: gate.deniedCapabilities.map((capability) => ({
        capability,
        reason: "provider capability is not declared as supported",
      })),
      providerScopes: gate.providerScopes,
    },
    sync: gate.sync,
  }, {
    generatedAt: options.syncEvidenceAt ?? "logical:6",
  });
  const providerHandoff = buildCapabilityGateProviderHandoffState(program, audit, gate, options);
  const persistedRecoveryState = buildCapabilityGatePersistedRecoveryState(
    program,
    audit,
    gate,
    recoveryStatus,
    providerHandoff,
    options,
  );
  const validation = validateCapabilityGatedPreview(program, gate, audit, exportSnapshot, recoveryStatus);
  const operatorHandoffPacket = buildCapabilityGateOperatorHandoffPacket(
    program,
    validation,
    readinessPreview,
    recoveryStatus,
    providerHandoff,
    persistedRecoveryState,
    providerSyncEvidence,
    options,
  );

  return deepFreeze({
    kind: "mailchimp.capability-gated-job.preview",
    apiVersion: "aios.example/v1",
    title: "Mailchimp capability-gated runtime handoff",
    jobId: program.job.id,
    status: audit.status,
    operatorPreview: buildCapabilityGateOperatorPreview(
      program,
      validation,
      readinessPreview,
      recoveryStatus,
      providerHandoff,
    ),
    readiness: {
      ready: validation.ready && readinessPreview.acceptance.accepted,
      gateReady: gate.status.ready,
      auditReady: exportSnapshot.truthBoundary.readyForExport,
      recoveryReady: recoveryStatus.ready,
      accepted: readinessPreview.acceptance.accepted,
      blockedReasons: validation.blockedReasons,
    },
    contracts: {
      capabilityGate: gate,
      recoveryStatus,
      providerHandoff,
      persistedRecoveryState,
      readinessPreview,
      providerSyncEvidence,
      exportSnapshot,
      operatorHandoffPacket,
    },
    nextSteps: derivePreviewNextSteps(validation, readinessPreview, recoveryStatus, operatorHandoffPacket),
  });
}

export function describeCapabilityGatedJob(options = {}) {
  const preview = buildCapabilityGatedPreview(options);

  return deepFreeze({
    jobId: preview.jobId,
    status: preview.status,
    ready: preview.readiness.ready,
    providerScopes: preview.contracts.capabilityGate.providerScopes,
    workspaceBoundary: preview.contracts.capabilityGate.workspaceBoundary,
    grantedCapabilities: preview.contracts.capabilityGate.grantedCapabilities,
    operationalHealth: preview.contracts.recoveryStatus.operationalHealth,
    blockedReasons: preview.readiness.blockedReasons,
    runtimeCommand: preview.contracts.recoveryStatus.runtimeCommand,
    restartToken: preview.contracts.recoveryStatus.restartToken,
    externalHandoff: preview.contracts.providerHandoff.externalHandoff,
    persistedRecoveryState: {
      stateKey: preview.contracts.persistedRecoveryState.stateKey,
      status: preview.contracts.persistedRecoveryState.status,
      restartToken: preview.contracts.persistedRecoveryState.restart.token,
      replayableRows: preview.contracts.persistedRecoveryState.summary.replayableRows,
      blockedRows: preview.contracts.persistedRecoveryState.summary.blockedRows,
    },
    operatorHandoffPacket: preview.contracts.operatorHandoffPacket,
    operatorPreview: preview.operatorPreview,
    nextSteps: preview.nextSteps,
  });
}

export function selfCheckCapabilityGatedJob(options = {}) {
  const checkOptions = {
    accepted: true,
    acceptedBy: "self-check",
    approvalTicket: "self_check_approval",
    ...options,
  };
  const program = buildCapabilityGatedProgram(checkOptions);
  const gate = buildCapabilityGateContract(program, checkOptions);
  const audit = buildCapabilityGateAudit(program, checkOptions);
  const recoveryStatus = buildCapabilityGateRecoveryStatus(program, audit, gate, checkOptions);
  const preview = buildCapabilityGatedPreview({ ...checkOptions, program, gate, audit });
  const errors = validateCapabilityGatedPreview(
    program,
    gate,
    audit,
    preview.contracts.exportSnapshot,
    recoveryStatus,
  ).blockedReasons;

  return deepFreeze({
    kind: "mailchimp.capability-gated-job.self-check",
    apiVersion: "aios.example/v1",
    passed: errors.length === 0,
    errors,
    jobId: program.job.id,
    exports: validateManifestExports(program.manifest.exports),
    providerHandoff: buildCapabilityGateProviderHandoffState(program, audit, gate, checkOptions),
    persistedRecoveryState: buildCapabilityGatePersistedRecoveryState(
      program,
      audit,
      gate,
      recoveryStatus,
      preview.contracts.providerHandoff,
      checkOptions,
    ),
    operatorHandoffPacket: preview.contracts.operatorHandoffPacket,
  });
}

function validateCapabilityGatedPreview(program, gate, audit, exportSnapshot, recoveryStatus) {
  const blockedReasons = uniqueSorted([
    ...gate.status.blockedReasons,
    ...(gate.workspaceBoundary.ready ? [] : gate.workspaceBoundary.blockedReasons),
    ...(program.job.memory.writePolicy === "local-only" ? [] : ["job memory must remain local-only"]),
    ...(exportSnapshot.truthBoundary.readyForExport ? [] : [exportSnapshot.summary]),
    ...(recoveryStatus.ready ? [] : recoveryStatus.blockedReasons),
  ]);

  return deepFreeze({
    ready: blockedReasons.length === 0,
    blockedReasons,
    checked: {
      package: program.manifest.name,
      jobId: program.job.id,
      auditStatus: audit.status,
      exportId: exportSnapshot.exportId,
      recoveryReady: recoveryStatus.ready,
    },
  });
}

function validateManifestExports(exportsMap = {}) {
  const names = Object.keys(exportsMap).sort();
  const missing = REQUIRED_EXPORTS.filter((name) => !names.includes(name));

  return {
    names,
    required: REQUIRED_EXPORTS,
    missing,
    valid: missing.length === 0,
  };
}

export function buildCapabilityGateOperatorHandoffPacket(
  program = buildCapabilityGatedProgram(),
  validation = { ready: false, blockedReasons: ["capability gate validation is pending"] },
  readinessPreview = { acceptance: { accepted: false, acceptedBy: null } },
  recoveryStatus = buildCapabilityGateRecoveryStatus(program),
  providerHandoff = buildCapabilityGateProviderHandoffState(program),
  persistedRecoveryState = buildCapabilityGatePersistedRecoveryState(program),
  providerSyncEvidence = { receipt: "pending", readiness: { ready: false, blockedReasons: ["provider sync evidence is pending"] } },
  options = {},
) {
  const accepted = Boolean(readinessPreview.acceptance?.accepted ?? options.accepted ?? false);
  const releaseReady = validation.ready
    && accepted
    && recoveryStatus.ready
    && providerHandoff.ready
    && persistedRecoveryState.ready
    && providerSyncEvidence.readiness.ready;
  const blockedReasons = uniqueSorted([
    ...validation.blockedReasons,
    ...(accepted ? [] : ["capability gate preview acceptance is pending"]),
    ...recoveryStatus.blockedReasons,
    ...providerHandoff.blockedReasons,
    ...persistedRecoveryState.summary.blockedReasons,
    ...(providerSyncEvidence.readiness.ready ? [] : providerSyncEvidence.readiness.blockedReasons),
  ]);
  const rows = [
    {
      id: "capability-gate",
      command: "capability-gate.review",
      state: validation.ready ? "ready" : "blocked",
      enabled: !validation.ready,
      idempotencyKey: `${program.job.id}:capability-gate:operator:gate:${providerSyncEvidence.receipt}`,
      blockers: validation.blockedReasons,
    },
    {
      id: "provider-handoff",
      command: providerHandoff.externalHandoff.command,
      state: providerHandoff.ready ? "ready" : "blocked",
      enabled: providerHandoff.ready && accepted,
      idempotencyKey: `${program.job.id}:capability-gate:operator:provider:${providerHandoff.externalHandoff.handoffToken ?? "pending"}`,
      blockers: providerHandoff.blockedReasons,
    },
    {
      id: "persisted-replay",
      command: persistedRecoveryState.restart.command,
      state: persistedRecoveryState.ready ? "ready" : "blocked",
      enabled: persistedRecoveryState.ready && accepted,
      idempotencyKey: persistedRecoveryState.restart.idempotencyKey,
      blockers: persistedRecoveryState.summary.blockedReasons,
    },
    {
      id: "operator-acceptance",
      command: "capability-gate.accept-preview",
      state: accepted ? "accepted" : "pending",
      enabled: !accepted && validation.ready && recoveryStatus.ready,
      idempotencyKey: `${program.job.id}:capability-gate:operator:accept:${providerSyncEvidence.receipt}`,
      blockers: accepted ? [] : ["capability gate preview acceptance is pending"],
    },
  ];
  const activeRow = rows.find((row) => row.enabled)
    ?? rows.find((row) => row.state === "blocked" || row.state === "pending")
    ?? rows[0];
  const releaseToken = releaseReady ? stableToken([
    program.job.id,
    providerSyncEvidence.receipt,
    recoveryStatus.restartToken,
    providerHandoff.externalHandoff.handoffToken,
    persistedRecoveryState.restart.token,
  ]) : null;

  return deepFreeze({
    kind: "mailchimp.capability-gate.operator-handoff-packet",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready: releaseReady,
    status: releaseReady ? "ready-for-provider-handoff" : "waiting-for-provider-handoff",
    nextAction: releaseReady ? "capability-gate.operator-handoff.release" : activeRow.command,
    providerSync: {
      receipt: providerSyncEvidence.receipt,
      ready: providerSyncEvidence.readiness.ready,
      checkpoint: providerHandoff.sync.checkpoint,
      cursor: providerHandoff.sync.cursor,
      externalHandoff: providerHandoff.sync.externalHandoff,
    },
    release: {
      command: releaseReady ? "capability-gate.operator-handoff.release" : activeRow.command,
      enabled: releaseReady,
      token: releaseToken,
      idempotencyKey: `${program.job.id}:capability-gate:operator-handoff:${providerSyncEvidence.receipt}`,
      acceptedBy: readinessPreview.acceptance?.acceptedBy ?? null,
      restartToken: releaseReady ? recoveryStatus.restartToken : null,
      providerHandoffToken: releaseReady ? providerHandoff.externalHandoff.handoffToken : null,
      persistedRestartToken: releaseReady ? persistedRecoveryState.restart.token : null,
    },
    clientState: {
      badge: releaseReady
        ? "provider-handoff-ready"
        : accepted ? "accepted-needs-review" : "awaiting-acceptance",
      primaryAction: activeRow.command,
      canAccept: rows.find((row) => row.id === "operator-acceptance").enabled,
      canDispatch: releaseReady,
      canReplay: persistedRecoveryState.summary.replayableRows > 0,
      blockedReasons,
    },
    summary: {
      totalRows: rows.length,
      readyRows: rows.filter((row) => row.state === "ready" || row.state === "accepted").length,
      blockedRows: rows.filter((row) => row.blockers.length > 0).length,
      replayableRows: persistedRecoveryState.summary.replayableRows,
      providerStages: providerHandoff.externalHandoff.stages.length,
    },
    rows,
    blockedReasons,
  });
}

function derivePreviewNextSteps(validation, readinessPreview, recoveryStatus, operatorHandoffPacket = null) {
  if (operatorHandoffPacket && !operatorHandoffPacket.ready && operatorHandoffPacket.clientState.canDispatch === false) {
    return operatorHandoffPacket.blockedReasons.map((reason) => ({
      action: operatorHandoffPacket.nextAction,
      label: "Resolve capability handoff",
      reason,
    }));
  }
  if (validation.ready && readinessPreview.acceptance.accepted) {
    return [{
      action: "provider.handoff.dispatch",
      label: "Handoff to Mailchimp adapter",
      reason: "capability gate, audit export, recovery status, and operator acceptance are ready",
    }];
  }
  if (!readinessPreview.acceptance.accepted) {
    return [{
      action: "capability-gate.accept-preview",
      label: "Accept capability preview",
      reason: "operator acceptance is required before provider handoff",
    }];
  }
  if (!recoveryStatus.ready) {
    return recoveryStatus.blockedReasons.map((reason) => ({
      action: recoveryStatus.runtimeCommand,
      label: "Resolve recovery handoff",
      reason,
    }));
  }
  return validation.blockedReasons.length > 0
    ? validation.blockedReasons.map((reason) => ({
      action: "capability-gate.review",
      label: "Resolve capability gate",
      reason,
    }))
    : readinessPreview.nextSteps.map((step) => (
      typeof step === "string"
        ? { action: "package.readiness.review", label: "Review package readiness", reason: step }
        : step
    ));
}

function buildCapabilityGateHandoffStages(ready, handoffToken, providerSyncReceipt) {
  return [
    {
      name: "recovery-status",
      ready,
      command: ready ? "recovery.resume" : "recovery.review",
      handoffToken,
    },
    {
      name: "snapshot-rollback",
      ready,
      command: ready ? "recovery.rollback.prepare" : "rollback.review",
      handoffToken,
    },
    {
      name: "verifier-claim",
      ready,
      command: ready ? "verifier.claim.export" : "verifier.claim.review",
      providerSyncReceipt,
    },
  ];
}

function buildCapabilityGateOperatorPreview(
  program,
  validation,
  readinessPreview,
  recoveryStatus,
  providerHandoff,
) {
  const rows = [
    {
      id: "tenant-boundary",
      label: "Tenant boundary",
      state: providerHandoff.workspaceBoundary.ready ? "ready" : "blocked",
      detail: providerHandoff.workspaceBoundary.ready
        ? "Tenant, workspace, role, and local-memory permissions are bound to this handoff."
        : "Tenant boundary or workspace permissions must be resolved before adapter dispatch.",
    },
    {
      id: "provider-capabilities",
      label: "Provider capabilities",
      state: validation.blockedReasons.some((reason) => reason.includes("capability"))
        ? "blocked"
        : "ready",
      detail: "Mailchimp campaign and report read grants are present before runtime handoff.",
    },
    {
      id: "truth-boundary",
      label: "Truth boundary",
      state: validation.blockedReasons.some((reason) => reason.includes("external write"))
        ? "blocked"
        : "ready",
      detail: "The job remains local-only and exports a verifier-readable audit snapshot.",
    },
    {
      id: "recovery-status",
      label: "Recovery status",
      state: recoveryStatus.ready ? "ready" : "blocked",
      detail: recoveryStatus.ready
        ? "Recovery restart state is available for the adapter."
        : "Recovery state must be resolved before adapter dispatch.",
    },
    {
      id: "operator-acceptance",
      label: "Operator acceptance",
      state: readinessPreview.acceptance.accepted ? "accepted" : "pending",
      detail: readinessPreview.acceptance.accepted
        ? `Accepted by ${readinessPreview.acceptance.acceptedBy ?? "operator"}.`
        : "Acceptance is required to release the provider handoff token.",
    },
  ];
  const visibleBlockers = uniqueSorted([
    ...validation.blockedReasons,
    ...providerHandoff.blockedReasons,
    ...(readinessPreview.acceptance.accepted ? [] : ["operator acceptance pending"]),
  ]);
  const nextAction = visibleBlockers.length > 0
    ? visibleBlockers.some((reason) => reason.includes("acceptance"))
      ? "capability-gate.accept-preview"
      : "capability-gate.review"
    : "provider.handoff.dispatch";

  return deepFreeze({
    kind: "mailchimp.capability-gate.operator-preview",
    apiVersion: "aios.ui/v1",
    jobId: program.job.id,
    title: "Capability-gated handoff",
    ready: visibleBlockers.length === 0,
    nextAction,
    acceptance: {
      required: true,
      accepted: readinessPreview.acceptance.accepted,
      command: "capability-gate.accept-preview",
      idempotencyKey: `${program.job.id}:accept:capability-gate`,
    },
    summary: {
      readyRows: rows.filter((row) => row.state === "ready" || row.state === "accepted").length,
      totalRows: rows.length,
      blockedReasons: visibleBlockers,
    },
    rows,
  });
}

function normalizeAdapterRecovery(status = "healthy", retryAfterSeconds = 30) {
  const normalized = String(status ?? "healthy").trim().toLowerCase();
  if (!["healthy", "degraded", "offline"].includes(normalized)) {
    throw new Error(`unsupported adapter recovery status: ${status}`);
  }

  return {
    status: normalized,
    handoff: normalized === "healthy" ? "available" : normalized === "degraded" ? "deferred" : "blocked",
    retryAfterSeconds: normalized === "degraded" ? Number(retryAfterSeconds) : null,
  };
}

function normalizeScopePart(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

function buildReceiptMap(receipts = []) {
  return new Map((receipts ?? []).map((entry) => {
    const key = String(entry.checkpointKey ?? entry.stepId ?? entry.command ?? entry.idempotencyKey ?? "");
    return [
      key,
      {
        state: String(entry.state ?? entry.status ?? "applied"),
        receipt: entry.receipt ? String(entry.receipt) : null,
      },
    ];
  }).filter(([key]) => key));
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
  return `cap_${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
