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
  summarizeRollbackContract,
} from "../stdlib/rollback.mjs";

export const memoryMountJobSource = `# deterministic Mailchimp memory mount recovery job
use mailchimp:campaign.read
use memory:campaign.mount
use rollback:snapshot.create
use status:timeline.write
recover rollback=snapshot retry=2
step mount-campaign-memory input=campaignId output=memoryMount verify.truth=local-only
step read-campaign input=memoryMount.campaignId output=campaign verify.source=mailchimp
step snapshot-campaign input=campaign output=snapshot verify.intent=rollback-safe
step publish-local-status input=snapshot output=statusEvent verify.boundary=no-external-write
`;

const REQUIRED_MEMORY_MOUNT_PERMISSIONS = Object.freeze([
  "campaign:read",
  "memory:mount-local",
  "rollback:snapshot-create",
  "status:handoff",
]);

export function buildMemoryMountProgram(options = {}) {
  return compilePackageSource(memoryMountJobSource, {
    name: options.name ?? "mailchimp-memory-mount-job",
    version: options.version ?? "0.1.0",
    description: "Mount campaign memory, read Mailchimp state, and prepare a local rollback snapshot.",
    capabilities: options.capabilities ?? [],
  }, {
    name: "mailchimp-memory-mount-job",
    memoryMode: "mounted",
    lifecycle: {
      enabled: options.enabled ?? true,
      dryRun: options.dryRun ?? true,
      requireApproval: options.requireApproval ?? true,
      approvalTicket: options.approvalTicket,
      schedule: options.schedule ?? { mode: "manual" },
      maxRuntimeSteps: 16,
    },
  });
}

export function buildMemoryMountAudit(program = buildMemoryMountProgram(), options = {}) {
  const missingSubjects = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missingSubjects.has(subject))
    .map((subject) => createEvidence(
      subject.includes("verify.source") ? "mailchimp-read-receipt" : "runtime-local-receipt",
      subject,
      { example: "memory-mount-job", mounted: true },
    ));

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "completed",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "memory mount queued" }),
      createStatusEvent("running", { at: "logical:1", message: "campaign memory mounted" }),
      createStatusEvent("verifying", { at: "logical:2", message: "rollback snapshot checked" }),
      createStatusEvent(options.status ?? "completed", {
        at: "logical:3",
        message: "memory mount audit finished",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildMemoryMountContract(
  program = buildMemoryMountProgram(),
  audit = buildMemoryMountAudit(program),
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
    providerResource: "campaign-memory",
    supportedCapabilities: options.supportedCapabilities,
  });
  const rollbackContract = buildRollbackContract(program, audit, {
    adapterStatus: options.adapterHealth,
    adapterCheckedAt: options.adapterCheckedAt ?? "logical:5",
    commandStatuses: options.commandStatuses,
    completedSteps: options.completedSteps ?? 4,
    failedStep: options.failedStep,
    mountedCheckpoints: options.mountedCheckpoints,
    retryAfterSeconds: options.adapterRetryAfterSeconds,
  });
  const recoveryStatusHandoff = buildRecoveryStatusHandoff(rollbackContract, {
    accepted: options.accepted ?? false,
  });
  const workspaceBoundary = buildMemoryMountWorkspaceBoundary(
    program,
    providerContract,
    recoveryStatusHandoff,
    options,
  );
  const readiness = buildMemoryMountReadiness(
    program,
    audit,
    exportSnapshot,
    providerContract,
    recoveryStatusHandoff,
    workspaceBoundary,
    options,
  );
  const runtimeHandoff = buildMemoryMountRuntimeHandoff(
    program,
    providerContract,
    recoveryStatusHandoff,
    readiness,
  );
  const adapterDispatchPlan = buildMemoryMountAdapterDispatchPlan(
    program,
    audit,
    providerContract,
    recoveryStatusHandoff,
    readiness,
    runtimeHandoff,
    options,
  );
  const lifecycleControls = buildMemoryMountLifecycleControls(
    program,
    audit,
    readiness,
    adapterDispatchPlan,
    options,
  );
  const operatorHandoffPacket = buildMemoryMountOperatorHandoffPacket(
    program,
    audit,
    providerContract,
    recoveryStatusHandoff,
    readiness,
    runtimeHandoff,
    adapterDispatchPlan,
    lifecycleControls,
    options,
  );
  const acceptanceWorkflow = buildMemoryMountAcceptanceWorkflow(
    program,
    readiness,
    runtimeHandoff,
    adapterDispatchPlan,
    lifecycleControls,
    operatorHandoffPacket,
    recoveryStatusHandoff,
    options,
  );
  const persistedClientState = buildMemoryMountPersistedClientState(
    program,
    readiness,
    runtimeHandoff,
    adapterDispatchPlan,
    lifecycleControls,
    operatorHandoffPacket,
    acceptanceWorkflow,
    recoveryStatusHandoff,
    options,
  );

  return {
    kind: "mailchimp.memory-mount.contract",
    apiVersion: "aios.example/v1",
    jobId: program.job.id,
    status: audit.status,
    memory: {
      mode: program.job.memory.mode,
      namespace: program.job.memory.namespace,
      writePolicy: program.job.memory.writePolicy,
      mountKey: `${program.job.memory.namespace}:mount:${String(options.campaignId ?? "campaign:memory")}`,
      tenantScope: workspaceBoundary.scopeKey,
      auditSubject: workspaceBoundary.auditHandoff.subject,
    },
    workspaceBoundary,
    providerContract,
    rollback: {
      contract: rollbackContract,
      summary: summarizeRollbackContract(rollbackContract),
      statusHandoff: recoveryStatusHandoff,
    },
    exportSnapshot,
    readiness,
    runtimeHandoff,
    adapterDispatchPlan,
    lifecycleControls,
    operatorHandoffPacket,
    acceptanceWorkflow,
    persistedClientState,
    nextSteps: buildMemoryMountNextSteps(
      providerContract,
      recoveryStatusHandoff,
      readiness,
      adapterDispatchPlan,
      operatorHandoffPacket,
    ),
  };
}

export function describeMemoryMountJob(options = {}) {
  const program = buildMemoryMountProgram(options);
  const audit = buildMemoryMountAudit(program, options);
  const contract = buildMemoryMountContract(program, audit, options);

  return {
    jobId: program.job.id,
    package: program.manifest.name,
    status: audit.status,
    memory: contract.memory,
    workspaceBoundary: contract.workspaceBoundary,
    readiness: contract.readiness,
    lifecycleControls: contract.lifecycleControls,
    rollback: contract.rollback.summary,
    runtimeHandoff: contract.runtimeHandoff,
    persistedClientState: contract.persistedClientState,
    adapterDispatchPlan: contract.adapterDispatchPlan,
    operatorHandoffPacket: contract.operatorHandoffPacket,
    acceptanceWorkflow: contract.acceptanceWorkflow,
    nextSteps: contract.nextSteps,
  };
}

export function buildMemoryMountPreview(options = {}) {
  const program = options.program ?? buildMemoryMountProgram(options);
  const audit = options.audit ?? buildMemoryMountAudit(program, options);
  const contract = buildMemoryMountContract(program, audit, options);
  const packageReadiness = buildPackageReadinessPreview(program, {
    providerContract: contract.providerContract,
    acceptance: {
      accepted: options.accepted ?? false,
      acceptedBy: options.acceptedBy,
      acceptedAt: options.acceptedAt ?? "logical:6",
    },
  });

  return {
    kind: "mailchimp.memory-mount.preview",
    apiVersion: "aios.example/v1",
    title: "Mailchimp campaign memory mount",
    jobId: program.job.id,
    readiness: {
      ...contract.readiness,
      packageReady: packageReadiness.readiness.ready,
    },
    contract,
    packageReadiness,
    acceptance: {
      accepted: Boolean(options.accepted ?? false)
        && contract.readiness.ready
        && packageReadiness.readiness.ready,
      acceptedBy: options.acceptedBy ? String(options.acceptedBy) : null,
      acceptedAt: options.accepted ? String(options.acceptedAt ?? "logical:6") : null,
    },
    adapterDispatchPlan: contract.adapterDispatchPlan,
    lifecycleControls: contract.lifecycleControls,
    operatorHandoffPacket: contract.operatorHandoffPacket,
    acceptanceWorkflow: contract.acceptanceWorkflow,
    persistedClientState: contract.persistedClientState,
  };
}

function buildMemoryMountReadiness(
  program,
  audit,
  exportSnapshot,
  providerContract,
  recoveryStatusHandoff,
  workspaceBoundary,
  options,
) {
  const errors = [];
  const warnings = [];

  if (!program.lifecycle.validation.valid) {
    errors.push(...program.lifecycle.validation.errors);
  }
  if (audit.evidence.missing.length > 0) {
    errors.push(`${audit.evidence.missing.length} memory mount evidence receipt(s) missing`);
  }
  if (audit.boundary.externalWritesObserved.length > 0) {
    errors.push(`${audit.boundary.externalWritesObserved.length} external write violation(s) observed`);
  }
  if (!providerContract.handoffState.ready) {
    errors.push(...providerContract.handoffState.blockedReasons);
  }
  if (!recoveryStatusHandoff.ready) {
    errors.push(...recoveryStatusHandoff.blockedReasons);
  }
  if (!workspaceBoundary.ready) {
    errors.push(...workspaceBoundary.blockedReasons);
  }
  if (!exportSnapshot.truthBoundary.readyForExport) {
    warnings.push("memory mount export is pending truth-boundary completion");
  }
  if (options.adapterHealth === "degraded") {
    warnings.push("adapter recovery is degraded and will be retried deterministically");
  }

  return {
    ready: errors.length === 0 && exportSnapshot.truthBoundary.readyForExport,
    accepted: Boolean(options.accepted ?? false),
    nextAction: errors.length === 0
      ? "accept-memory-mount-preview"
      : "resolve-memory-mount-blockers",
    errors: uniqueSorted(errors),
    warnings: uniqueSorted(warnings),
    checked: {
      lifecycleValid: program.lifecycle.validation.valid,
      auditStatus: audit.status,
      exportReady: exportSnapshot.truthBoundary.readyForExport,
      providerReady: providerContract.handoffState.ready,
      recoveryReady: recoveryStatusHandoff.ready,
      workspaceBoundaryReady: workspaceBoundary.ready,
      tenantId: workspaceBoundary.tenantId,
      workspaceId: workspaceBoundary.workspaceId,
      memoryMode: program.job.memory.mode,
      memoryWritePolicy: program.job.memory.writePolicy,
    },
  };
}

export function buildMemoryMountWorkspaceBoundary(
  program = buildMemoryMountProgram(),
  providerContract = buildProviderServiceContract(program),
  recoveryStatusHandoff = { ready: false, restartToken: null },
  options = {},
) {
  const tenantId = normalizeMemoryMountScopePart(options.tenantId ?? "tenant_mailchimp_default", "tenant");
  const workspaceId = normalizeMemoryMountScopePart(options.workspaceId ?? "workspace_mailchimp_default", "workspace");
  const role = String(options.role ?? "operator").trim().toLowerCase();
  const permissions = uniqueSorted(options.permissions ?? REQUIRED_MEMORY_MOUNT_PERMISSIONS);
  const allowedRoles = new Set(["operator", "service"]);
  const providerNamespace = providerContract?.sync?.localNamespace ?? program.job.memory.namespace;
  const mountResource = normalizeMemoryMountScopePart(options.campaignId ?? "campaign_memory", "campaign_memory");
  const scopeKey = `${program.job.memory.namespace}:tenant:${tenantId}:workspace:${workspaceId}:mount:${mountResource}`;
  const blockedReasons = uniqueSorted([
    ...(allowedRoles.has(role) ? [] : [`memory mount role denied: ${role}`]),
    ...REQUIRED_MEMORY_MOUNT_PERMISSIONS
      .filter((permission) => !permissions.includes(permission))
      .map((permission) => `memory mount permission missing: ${permission}`),
    ...(tenantId === "tenant_public" ? ["memory mount tenant scope must not be public"] : []),
    ...(workspaceId === "workspace_public" ? ["memory mount workspace scope must not be public"] : []),
    ...(providerNamespace === program.job.memory.namespace
      ? []
      : [`memory mount namespace mismatch: ${providerNamespace}`]),
    ...(program.job.memory.writePolicy === "local-only"
      ? []
      : [`memory mount memory policy must be local-only: ${program.job.memory.writePolicy}`]),
    ...(recoveryStatusHandoff.ready || options.allowPendingRecoveryBoundary
      ? []
      : ["memory mount recovery handoff must be ready before tenant-bound mount release"]),
  ]);
  const auditHandoffId = stableMemoryMountToken([
    tenantId,
    workspaceId,
    role,
    permissions.join(","),
    providerNamespace,
    recoveryStatusHandoff.restartToken,
  ]);

  return {
    kind: "mailchimp.memory-mount.workspace-boundary",
    apiVersion: "aios.security/v1",
    tenantId,
    workspaceId,
    role,
    permissions,
    requiredPermissions: REQUIRED_MEMORY_MOUNT_PERMISSIONS,
    providerNamespace,
    mountResource,
    scopeKey,
    ready: blockedReasons.length === 0,
    isolation: {
      externalWritesAllowed: false,
      memoryWritePolicy: program.job.memory.writePolicy,
      mountKey: `${scopeKey}:active`,
      recoveryRestartTokenRequired: true,
      recoveryRestartToken: recoveryStatusHandoff.restartToken ?? null,
    },
    auditHandoff: {
      subject: `${tenantId}/${workspaceId}/${program.job.id}/memory-mount/${mountResource}`,
      command: "audit.memory-mount-boundary.record",
      idempotencyKey: `${program.job.id}:memory-mount:boundary:${auditHandoffId}`,
    },
    blockedReasons,
  };
}

function buildMemoryMountRuntimeHandoff(program, providerContract, recoveryStatusHandoff, readiness) {
  const ready = readiness.ready && recoveryStatusHandoff.ready;

  return {
    ready,
    command: ready ? "memory.mount.resume" : "memory.mount.review",
    jobId: program.job.id,
    provider: providerContract.provider,
    handoffToken: ready ? providerContract.handoffState.handoffToken : null,
    memoryNamespace: program.job.memory.namespace,
    recovery: recoveryStatusHandoff,
    blockedReasons: ready ? [] : uniqueSorted([
      ...readiness.errors,
      ...recoveryStatusHandoff.blockedReasons,
      ...providerContract.handoffState.blockedReasons,
    ]),
  };
}

export function buildMemoryMountLifecycleControls(
  program = buildMemoryMountProgram(),
  audit = buildMemoryMountAudit(program),
  readiness = { ready: false, errors: ["memory mount readiness was not evaluated"], warnings: [] },
  adapterDispatchPlan = buildMemoryMountAdapterDispatchPlan(program, audit),
  options = {},
) {
  const settings = normalizeMemoryMountSettings(program, options);
  const validation = validateMemoryMountSettings(program, audit, settings, readiness, adapterDispatchPlan);
  const desiredState = settings.enabled ? "enabled" : "disabled";
  const controlsReady = validation.errors.length === 0;
  const commandRows = [
    {
      id: "enable",
      command: "memory.mount.enable",
      enabled: !program.lifecycle.enabled && settings.enabled && controlsReady,
      state: program.lifecycle.enabled ? "already-enabled" : settings.enabled ? "ready" : "not-requested",
      idempotencyKey: `${program.job.id}:memory-mount:lifecycle:enable:${settings.settingsToken}`,
      nextAction: "memory.mount.configure",
    },
    {
      id: "disable",
      command: "memory.mount.disable",
      enabled: program.lifecycle.enabled && !settings.enabled && validation.canDisable,
      state: !program.lifecycle.enabled ? "already-disabled" : !settings.enabled ? "ready" : "not-requested",
      idempotencyKey: `${program.job.id}:memory-mount:lifecycle:disable:${settings.settingsToken}`,
      nextAction: "memory.mount.disable",
    },
    {
      id: "schedule",
      command: "memory.mount.schedule.update",
      enabled: controlsReady && settings.schedule.valid,
      state: settings.schedule.valid ? "ready" : "blocked",
      idempotencyKey: `${program.job.id}:memory-mount:lifecycle:schedule:${settings.settingsToken}`,
      nextAction: settings.schedule.mode === "manual" ? "memory.mount.manual-run" : "memory.mount.schedule",
    },
    {
      id: "accept",
      command: "memory.mount.accept-preview",
      enabled: controlsReady && readiness.ready && adapterDispatchPlan.ready && !settings.accepted,
      state: settings.accepted
        ? "accepted"
        : readiness.ready && adapterDispatchPlan.ready ? "ready" : "blocked",
      idempotencyKey: `${program.job.id}:memory-mount:lifecycle:accept:${settings.settingsToken}`,
      nextAction: "accept-memory-mount-preview",
    },
    {
      id: "dispatch",
      command: adapterDispatchPlan.dispatch.command,
      enabled: controlsReady && settings.accepted && adapterDispatchPlan.ready,
      state: adapterDispatchPlan.ready
        ? settings.accepted ? "ready" : "waiting-for-acceptance"
        : "blocked",
      idempotencyKey: `${program.job.id}:memory-mount:lifecycle:dispatch:${adapterDispatchPlan.dispatch.token ?? "pending"}`,
      nextAction: adapterDispatchPlan.nextAction,
    },
  ];
  const activeCommand = commandRows.find((row) => row.enabled)
    ?? commandRows.find((row) => row.state === "blocked")
    ?? commandRows.find((row) => row.state === "ready")
    ?? commandRows[0];
  const blockedReasons = uniqueSorted([
    ...validation.errors,
    ...commandRows
      .filter((row) => row.state === "blocked")
      .map((row) => `${row.command} is blocked`),
  ]);

  return {
    kind: "mailchimp.memory-mount.lifecycle-controls",
    apiVersion: "aios.control/v1",
    jobId: program.job.id,
    ready: blockedReasons.length === 0,
    desiredState,
    currentState: program.lifecycle.enabled ? "enabled" : "disabled",
    nextAction: activeCommand.nextAction,
    activeCommand: activeCommand.command,
    settings,
    validation,
    controls: {
      canEnable: commandRows.find((row) => row.id === "enable").enabled,
      canDisable: commandRows.find((row) => row.id === "disable").enabled,
      canSchedule: commandRows.find((row) => row.id === "schedule").enabled,
      canAccept: commandRows.find((row) => row.id === "accept").enabled,
      canDispatch: commandRows.find((row) => row.id === "dispatch").enabled,
    },
    commandRows,
    blockedReasons,
  };
}

function normalizeMemoryMountSettings(program, options) {
  const schedule = normalizeMemoryMountSchedule(options.schedule ?? program.lifecycle.schedule);
  const maxRuntimeSteps = Number(options.maxRuntimeSteps ?? program.lifecycle.maxRuntimeSteps ?? 16);
  const mountTtlSeconds = Math.max(60, Number(options.mountTtlSeconds ?? 900));
  const refreshWindowSeconds = Math.max(30, Number(options.refreshWindowSeconds ?? 120));
  const enabled = Boolean(options.enabled ?? program.lifecycle.enabled);
  const accepted = Boolean(options.accepted ?? false);
  const settingsToken = stableMemoryMountToken([
    program.job.id,
    enabled,
    accepted,
    schedule.mode,
    schedule.intervalSeconds,
    schedule.at,
    mountTtlSeconds,
    refreshWindowSeconds,
    maxRuntimeSteps,
  ]);

  return {
    enabled,
    accepted,
    dryRun: Boolean(options.dryRun ?? program.lifecycle.dryRun),
    requireApproval: Boolean(options.requireApproval ?? program.lifecycle.requireApproval),
    approvalTicket: options.approvalTicket ? String(options.approvalTicket) : null,
    maxRuntimeSteps,
    mountTtlSeconds,
    refreshWindowSeconds,
    schedule,
    settingsToken,
  };
}

function normalizeMemoryMountSchedule(schedule = { mode: "manual" }) {
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

function validateMemoryMountSettings(program, audit, settings, readiness, adapterDispatchPlan) {
  const errors = uniqueSorted([
    ...(settings.schedule.valid ? [] : ["memory mount schedule is invalid"]),
    ...(settings.schedule.mode === "interval" && settings.schedule.intervalSeconds < 60
      ? ["memory mount interval must be at least 60 seconds"]
      : []),
    ...(settings.maxRuntimeSteps < program.job.plan.length
      ? [`memory mount maxRuntimeSteps must cover ${program.job.plan.length} plan steps`]
      : []),
    ...(settings.mountTtlSeconds <= settings.refreshWindowSeconds
      ? ["memory mount ttl must be greater than refresh window"]
      : []),
    ...(settings.requireApproval && !settings.approvalTicket
      ? ["memory mount approval ticket is required"]
      : []),
    ...(readiness.ready ? [] : readiness.errors),
    ...(adapterDispatchPlan.summary.blockedRows > 0 ? adapterDispatchPlan.blockedReasons : []),
  ]);
  const warnings = uniqueSorted([
    ...readiness.warnings,
    ...(audit.status === "completed" && !settings.accepted
      ? ["memory mount preview is ready but not accepted"]
      : []),
    ...(settings.dryRun ? ["memory mount lifecycle is in dry-run mode"] : []),
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
      mountTtlSeconds: settings.mountTtlSeconds,
      refreshWindowSeconds: settings.refreshWindowSeconds,
      adapterDispatchReady: adapterDispatchPlan.ready,
    },
  };
}

export function buildMemoryMountAdapterDispatchPlan(
  program = buildMemoryMountProgram(),
  audit = buildMemoryMountAudit(program),
  providerContract = buildProviderServiceContract(program),
  recoveryStatusHandoff = { ready: false, blockedReasons: ["recovery status handoff is pending"], runtimeCommand: "recovery.review" },
  readiness = buildMemoryMountReadiness(
    program,
    audit,
    createAuditExportSnapshot(audit, { generatedAt: "logical:4", format: "json.summary" }),
    providerContract,
    recoveryStatusHandoff,
    buildMemoryMountWorkspaceBoundary(program, providerContract, recoveryStatusHandoff, { allowPendingRecoveryBoundary: true }),
    {},
  ),
  runtimeHandoff = buildMemoryMountRuntimeHandoff(program, providerContract, recoveryStatusHandoff, readiness),
  options = {},
) {
  const adapter = normalizeMemoryMountAdapterStatus(options.adapterHealth, options.adapterRetryAfterSeconds);
  const evidenceMissing = new Set(audit.evidence.missing);
  const mountKey = `${program.job.memory.namespace}:mount:${String(options.campaignId ?? "campaign:memory")}`;
  const dispatchKey = `${program.job.memory.namespace}:memory-mount:dispatch:${program.job.id}`;
  const rows = program.job.plan.map((step, index) => {
    const missing = evidenceMissing.has(`step:${step.op}`)
      || Object.keys(step.verifierHints).some((hint) => evidenceMissing.has(hint));
    const complete = audit.status === "completed" && !missing && Number(options.completedSteps ?? program.job.plan.length) > index;
    const command = step.op === "publish-local-status"
      ? "status.timeline.local.write"
      : step.op === "snapshot-campaign"
        ? "rollback.snapshot.create"
        : step.op === "read-campaign"
          ? "mailchimp.campaign.read"
          : "memory.campaign.mount";
    const rowBlockers = uniqueSorted([
      ...(missing ? [`memory mount dispatch evidence missing: ${step.op}`] : []),
      ...(readiness.ready ? [] : readiness.errors),
      ...(providerContract.handoffState.ready ? [] : providerContract.handoffState.blockedReasons),
      ...(recoveryStatusHandoff.ready ? [] : recoveryStatusHandoff.blockedReasons),
      ...(runtimeHandoff.ready ? [] : runtimeHandoff.blockedReasons),
      ...(adapter.status === "offline" ? ["memory mount adapter is offline"] : []),
    ]);
    const rowReady = rowBlockers.length === 0;
    const rowToken = stableMemoryMountToken([
      dispatchKey,
      mountKey,
      step.id,
      providerContract.handoffState.handoffToken,
      recoveryStatusHandoff.restartToken,
    ]);

    return {
      id: step.id,
      command,
      sourceStep: step.op,
      state: rowReady
        ? complete ? "already-applied" : "ready-to-dispatch"
        : missing ? "blocked" : "waiting-for-handoff",
      ready: rowReady,
      completed: complete,
      evidenceReady: !missing,
      mountKey,
      checkpoint: `${mountKey}:checkpoint:${index + 1}:${step.op}`,
      resumeCursor: `${program.job.id}:memory-mount:dispatch:${index + 1}`,
      idempotencyKey: `${program.job.id}:memory-mount:dispatch:${index + 1}:${rowToken}`,
      verifierClaimCount: Object.keys(step.verifierHints).length,
      blockers: rowBlockers,
    };
  });
  const blockedReasons = uniqueSorted([
    ...rows.flatMap((row) => row.blockers),
    ...audit.boundary.externalWritesObserved.map((write) => `external write observed: ${write.subject ?? write.target ?? write}`),
  ]);
  const dispatchableRows = rows.filter((row) => row.ready && row.state !== "already-applied");
  const ready = readiness.ready
    && runtimeHandoff.ready
    && adapter.status !== "offline"
    && blockedReasons.length === 0;

  return {
    kind: "mailchimp.memory-mount.adapter-dispatch-plan",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready,
    status: ready
      ? dispatchableRows.length > 0 ? "dispatch-ready" : "already-applied"
      : adapter.status === "offline" ? "adapter-offline" : "dispatch-blocked",
    nextAction: ready
      ? "memory.mount.resume"
      : adapter.status === "degraded"
        ? "adapter.status.poll"
        : runtimeHandoff.command,
    adapter: {
      name: program.job.runtimeAdapter,
      status: adapter.status,
      handoff: adapter.handoff,
      retryAfterSeconds: adapter.retryAfterSeconds,
    },
    dispatch: {
      command: ready ? "memory.mount.dispatch" : "memory.mount.review",
      enabled: ready,
      key: dispatchKey,
      mountKey,
      token: ready
        ? stableMemoryMountToken([
          dispatchKey,
          mountKey,
          providerContract.handoffState.handoffToken,
          recoveryStatusHandoff.restartToken,
          rows.map((row) => `${row.id}:${row.state}`).join(","),
        ])
        : null,
      handoffToken: ready ? providerContract.handoffState.handoffToken : null,
    },
    memory: {
      namespace: program.job.memory.namespace,
      mode: program.job.memory.mode,
      writePolicy: program.job.memory.writePolicy,
      mountKey,
    },
    recovery: {
      ready: recoveryStatusHandoff.ready,
      runtimeCommand: recoveryStatusHandoff.runtimeCommand,
      restartToken: recoveryStatusHandoff.restartToken ?? null,
    },
    summary: {
      totalRows: rows.length,
      dispatchableRows: dispatchableRows.length,
      blockedRows: rows.filter((row) => row.blockers.length > 0).length,
      missingEvidence: audit.evidence.missing.length,
      blockedReasons,
    },
    rows,
    blockedReasons,
  };
}

export function buildMemoryMountOperatorHandoffPacket(
  program = buildMemoryMountProgram(),
  audit = buildMemoryMountAudit(program),
  providerContract = buildProviderServiceContract(program),
  recoveryStatusHandoff = { ready: false, blockedReasons: ["recovery status handoff is pending"], runtimeCommand: "recovery.review" },
  readiness = buildMemoryMountReadiness(
    program,
    audit,
    createAuditExportSnapshot(audit, { generatedAt: "logical:4", format: "json.summary" }),
    providerContract,
    recoveryStatusHandoff,
    buildMemoryMountWorkspaceBoundary(program, providerContract, recoveryStatusHandoff, { allowPendingRecoveryBoundary: true }),
    {},
  ),
  runtimeHandoff = buildMemoryMountRuntimeHandoff(program, providerContract, recoveryStatusHandoff, readiness),
  adapterDispatchPlan = buildMemoryMountAdapterDispatchPlan(
    program,
    audit,
    providerContract,
    recoveryStatusHandoff,
    readiness,
    runtimeHandoff,
  ),
  lifecycleControls = buildMemoryMountLifecycleControls(program, audit, readiness, adapterDispatchPlan),
  options = {},
) {
  const providerSyncEvidence = createProviderSyncEvidence(audit, providerContract, {
    generatedAt: options.syncEvidenceAt ?? "logical:7",
  });
  const accepted = Boolean(options.accepted ?? false);
  const releaseReady = accepted
    && readiness.ready
    && runtimeHandoff.ready
    && adapterDispatchPlan.ready
    && lifecycleControls.ready
    && providerSyncEvidence.readiness.ready;
  const blockedReasons = uniqueSorted([
    ...(accepted ? [] : ["memory mount preview acceptance is pending"]),
    ...readiness.errors,
    ...runtimeHandoff.blockedReasons,
    ...adapterDispatchPlan.blockedReasons,
    ...lifecycleControls.blockedReasons,
    ...(providerSyncEvidence.readiness.ready ? [] : providerSyncEvidence.readiness.blockedReasons),
  ]);
  const rows = [
    {
      id: "memory-mount",
      command: "memory.campaign.mount",
      state: readiness.ready ? "ready" : "blocked",
      enabled: readiness.ready,
      idempotencyKey: `${program.job.id}:memory-mount:operator:mount:${providerSyncEvidence.receipt}`,
      blockers: readiness.errors,
    },
    {
      id: "rollback-status",
      command: recoveryStatusHandoff.runtimeCommand,
      state: recoveryStatusHandoff.ready ? "ready" : "blocked",
      enabled: recoveryStatusHandoff.ready,
      idempotencyKey: `${program.job.id}:memory-mount:operator:rollback:${recoveryStatusHandoff.restartToken ?? "pending"}`,
      blockers: recoveryStatusHandoff.blockedReasons,
    },
    {
      id: "adapter-dispatch",
      command: adapterDispatchPlan.dispatch.command,
      state: adapterDispatchPlan.ready ? "ready" : "blocked",
      enabled: releaseReady,
      idempotencyKey: `${program.job.id}:memory-mount:operator:dispatch:${adapterDispatchPlan.dispatch.token ?? "pending"}`,
      blockers: adapterDispatchPlan.blockedReasons,
    },
    {
      id: "operator-acceptance",
      command: "memory.mount.accept-preview",
      state: accepted ? "accepted" : "pending",
      enabled: !accepted && readiness.ready && adapterDispatchPlan.ready,
      idempotencyKey: `${program.job.id}:memory-mount:operator:accept:${providerSyncEvidence.receipt}`,
      blockers: accepted ? [] : ["memory mount preview acceptance is pending"],
    },
  ];
  const activeRow = rows.find((row) => row.enabled)
    ?? rows.find((row) => row.state === "blocked" || row.state === "pending")
    ?? rows[0];
  const handoffToken = releaseReady ? stableMemoryMountToken([
    program.job.id,
    providerSyncEvidence.receipt,
    recoveryStatusHandoff.restartToken,
    adapterDispatchPlan.dispatch.token,
    lifecycleControls.activeCommand,
  ]) : null;

  return {
    kind: "mailchimp.memory-mount.operator-handoff-packet",
    apiVersion: "aios.integration/v1",
    jobId: program.job.id,
    ready: releaseReady,
    status: releaseReady ? "ready-for-memory-handoff" : "waiting-for-memory-handoff",
    nextAction: releaseReady ? "memory.mount.operator-handoff.release" : activeRow.command,
    providerSync: {
      receipt: providerSyncEvidence.receipt,
      ready: providerSyncEvidence.readiness.ready,
      checkpoint: providerContract.sync.checkpoint,
      cursor: providerContract.sync.cursor,
      localNamespace: providerContract.sync.localNamespace,
    },
    memory: {
      namespace: program.job.memory.namespace,
      mode: program.job.memory.mode,
      writePolicy: program.job.memory.writePolicy,
      mountKey: adapterDispatchPlan.memory.mountKey,
    },
    release: {
      command: releaseReady ? "memory.mount.operator-handoff.release" : activeRow.command,
      enabled: releaseReady,
      token: handoffToken,
      idempotencyKey: `${program.job.id}:memory-mount:operator-handoff:${providerSyncEvidence.receipt}`,
      restartToken: releaseReady ? recoveryStatusHandoff.restartToken : null,
      adapterDispatchToken: releaseReady ? adapterDispatchPlan.dispatch.token : null,
      acceptedBy: accepted ? String(options.acceptedBy ?? "operator") : null,
    },
    clientState: {
      badge: releaseReady
        ? "memory-handoff-ready"
        : accepted ? "accepted-needs-review" : "awaiting-acceptance",
      primaryAction: activeRow.command,
      canAccept: rows.find((row) => row.id === "operator-acceptance").enabled,
      canDispatch: releaseReady,
      canPollAdapter: adapterDispatchPlan.adapter.status === "degraded",
      blockedReasons,
    },
    summary: {
      totalRows: rows.length,
      readyRows: rows.filter((row) => row.state === "ready" || row.state === "accepted").length,
      blockedRows: rows.filter((row) => row.blockers.length > 0).length,
      dispatchableRows: adapterDispatchPlan.summary.dispatchableRows,
      lifecycleReady: lifecycleControls.ready,
    },
    rows,
    blockedReasons,
  };
}

export function buildMemoryMountAcceptanceWorkflow(
  program = buildMemoryMountProgram(),
  readiness = { ready: false, accepted: false, errors: ["memory mount readiness was not evaluated"], warnings: [] },
  runtimeHandoff = buildMemoryMountRuntimeHandoff(
    program,
    buildProviderServiceContract(program),
    { ready: false, blockedReasons: ["recovery status handoff is pending"], runtimeCommand: "recovery.review" },
    readiness,
  ),
  adapterDispatchPlan = buildMemoryMountAdapterDispatchPlan(program, buildMemoryMountAudit(program)),
  lifecycleControls = buildMemoryMountLifecycleControls(program),
  operatorHandoffPacket = buildMemoryMountOperatorHandoffPacket(program),
  recoveryStatusHandoff = { ready: false, blockedReasons: ["recovery status handoff is pending"], runtimeCommand: "recovery.review" },
  options = {},
) {
  const routeBase = String(options.routeBase ?? "/mailchimp/memory-mount");
  const accepted = Boolean(options.accepted ?? readiness.accepted ?? false);
  const mountKey = adapterDispatchPlan.memory?.mountKey
    ?? `${program.job.memory.namespace}:mount:${String(options.campaignId ?? "campaign:memory")}`;
  const sections = [
    {
      id: "readiness",
      label: "Readiness",
      state: readiness.ready ? "ready" : "blocked",
      command: readiness.ready ? "memory.mount.readiness.confirm" : readiness.nextAction,
      route: `${routeBase}/readiness`,
      idempotencyKey: `${program.job.id}:memory-mount:workflow:readiness:${stableMemoryMountToken(readiness.errors ?? [])}`,
      blockers: readiness.errors ?? [],
      warnings: readiness.warnings ?? [],
      summary: readiness.ready
        ? "Memory mount, provider handoff, rollback status, and export checks are ready."
        : `${readiness.errors?.length ?? 0} readiness blocker(s) require review.`,
    },
    {
      id: "rollback",
      label: "Rollback status",
      state: recoveryStatusHandoff.ready ? "ready" : "blocked",
      command: recoveryStatusHandoff.runtimeCommand,
      route: `${routeBase}/rollback`,
      idempotencyKey: `${program.job.id}:memory-mount:workflow:rollback:${recoveryStatusHandoff.restartToken ?? "pending"}`,
      blockers: recoveryStatusHandoff.blockedReasons,
      restartToken: recoveryStatusHandoff.restartToken ?? null,
      summary: recoveryStatusHandoff.ready
        ? "Rollback status handoff is ready for restart-safe resume."
        : "Rollback status handoff must be resolved before dispatch.",
    },
    {
      id: "acceptance",
      label: "Acceptance",
      state: accepted ? "accepted" : readiness.ready ? "pending" : "blocked",
      command: "memory.mount.accept-preview",
      route: `${routeBase}/acceptance`,
      idempotencyKey: `${program.job.id}:memory-mount:workflow:accept:${stableMemoryMountToken([
        mountKey,
        options.acceptedBy,
      ])}`,
      blockers: accepted ? [] : ["memory mount preview acceptance is pending"],
      acceptedBy: accepted ? String(options.acceptedBy ?? "operator") : null,
      acceptedAt: accepted ? String(options.acceptedAt ?? "logical:6") : null,
      summary: accepted
        ? `Accepted by ${String(options.acceptedBy ?? "operator")}.`
        : "Acceptance releases the mounted-memory handoff controls.",
    },
    {
      id: "runtime",
      label: "Runtime handoff",
      state: runtimeHandoff.ready ? "ready" : "blocked",
      command: runtimeHandoff.command,
      route: `${routeBase}/runtime`,
      idempotencyKey: `${program.job.id}:memory-mount:workflow:runtime:${runtimeHandoff.handoffToken ?? "pending"}`,
      blockers: runtimeHandoff.blockedReasons,
      handoffToken: runtimeHandoff.handoffToken,
      summary: runtimeHandoff.ready
        ? "Runtime handoff token is available for the Mailchimp adapter."
        : "Runtime handoff is waiting for provider or recovery readiness.",
    },
    {
      id: "dispatch",
      label: "Dispatch",
      state: adapterDispatchPlan.ready
        ? adapterDispatchPlan.summary.dispatchableRows > 0 ? "dispatch-ready" : "already-applied"
        : "blocked",
      command: adapterDispatchPlan.dispatch.command,
      route: `${routeBase}/dispatch`,
      idempotencyKey: `${program.job.id}:memory-mount:workflow:dispatch:${adapterDispatchPlan.dispatch.token ?? "pending"}`,
      blockers: adapterDispatchPlan.blockedReasons,
      adapter: adapterDispatchPlan.adapter,
      summary: `${adapterDispatchPlan.summary.dispatchableRows}/${adapterDispatchPlan.summary.totalRows} row(s) dispatchable`,
    },
  ];
  const blockedReasons = uniqueSorted([
    ...sections.flatMap((section) => section.blockers ?? []),
    ...operatorHandoffPacket.blockedReasons,
    ...lifecycleControls.blockedReasons,
  ]);
  const releaseReady = accepted
    && readiness.ready
    && runtimeHandoff.ready
    && adapterDispatchPlan.ready
    && lifecycleControls.ready
    && operatorHandoffPacket.ready
    && recoveryStatusHandoff.ready
    && blockedReasons.length === 0;
  const activeSection = sections.find((section) => section.state === "blocked")
    ?? sections.find((section) => section.state === "pending")
    ?? sections.find((section) => section.state === "dispatch-ready")
    ?? sections[sections.length - 1];
  const commandRows = sections.map((section, index) => ({
    id: section.id,
    command: section.command,
    state: section.state,
    route: section.route,
    enabled: releaseReady ? section.id === "dispatch" : section.id === activeSection.id,
    ordinal: index + 1,
    idempotencyKey: section.idempotencyKey,
    blockers: section.blockers ?? [],
  }));
  const releaseToken = releaseReady ? stableMemoryMountToken([
    program.job.id,
    mountKey,
    operatorHandoffPacket.release.token,
    adapterDispatchPlan.dispatch.token,
    recoveryStatusHandoff.restartToken,
  ]) : null;

  return {
    kind: "mailchimp.memory-mount.acceptance-workflow",
    apiVersion: "aios.ui/v1",
    jobId: program.job.id,
    ready: releaseReady,
    status: releaseReady ? "ready-to-release" : "needs-operator-action",
    routeState: {
      base: routeBase,
      activeRoute: activeSection.route,
      badge: releaseReady
        ? "memory-release-ready"
        : accepted ? "accepted-needs-review" : "awaiting-acceptance",
      primaryAction: releaseReady ? "memory.mount.operator-handoff.release" : activeSection.command,
    },
    memory: {
      namespace: program.job.memory.namespace,
      mode: program.job.memory.mode,
      writePolicy: program.job.memory.writePolicy,
      mountKey,
    },
    progress: {
      totalSections: sections.length,
      readySections: sections.filter((section) => (
        section.state === "ready"
        || section.state === "accepted"
        || section.state === "already-applied"
        || section.state === "dispatch-ready"
      )).length,
      blockedSections: sections.filter((section) => section.state === "blocked").length,
      pendingSections: sections.filter((section) => section.state === "pending").length,
    },
    release: {
      command: releaseReady ? "memory.mount.operator-handoff.release" : activeSection.command,
      enabled: releaseReady,
      token: releaseToken,
      idempotencyKey: `${program.job.id}:memory-mount:workflow:release:${operatorHandoffPacket.providerSync.receipt}`,
      acceptedBy: accepted ? String(options.acceptedBy ?? "operator") : null,
      restartToken: releaseReady ? recoveryStatusHandoff.restartToken : null,
      dispatchToken: releaseReady ? adapterDispatchPlan.dispatch.token : null,
    },
    clientState: {
      canAccept: !accepted && readiness.ready && recoveryStatusHandoff.ready,
      canDispatch: adapterDispatchPlan.ready && accepted,
      canPollAdapter: adapterDispatchPlan.adapter.status === "degraded",
      nextActionLabel: activeSection.label,
      blockedReasons,
    },
    sections,
    commandRows,
    blockedReasons,
  };
}

export function buildMemoryMountPersistedClientState(
  program = buildMemoryMountProgram(),
  readiness = { ready: false, accepted: false, errors: ["memory mount readiness was not evaluated"], warnings: [] },
  runtimeHandoff = buildMemoryMountRuntimeHandoff(
    program,
    buildProviderServiceContract(program),
    { ready: false, blockedReasons: ["recovery status handoff is pending"], runtimeCommand: "recovery.review" },
    readiness,
  ),
  adapterDispatchPlan = buildMemoryMountAdapterDispatchPlan(program, buildMemoryMountAudit(program)),
  lifecycleControls = buildMemoryMountLifecycleControls(program),
  operatorHandoffPacket = buildMemoryMountOperatorHandoffPacket(program),
  acceptanceWorkflow = buildMemoryMountAcceptanceWorkflow(program),
  recoveryStatusHandoff = { ready: false, blockedReasons: ["recovery status handoff is pending"], runtimeCommand: "recovery.review" },
  options = {},
) {
  const clientId = String(options.clientId ?? "mailchimp-memory-console");
  const mountKey = adapterDispatchPlan.memory?.mountKey
    ?? `${program.job.memory.namespace}:mount:${String(options.campaignId ?? "campaign:memory")}`;
  const routeBase = acceptanceWorkflow.routeState?.base ?? String(options.routeBase ?? "/mailchimp/memory-mount");
  const accepted = Boolean(options.accepted ?? readiness.accepted ?? false);
  const releaseReady = accepted
    && readiness.ready
    && runtimeHandoff.ready
    && adapterDispatchPlan.ready
    && lifecycleControls.ready
    && operatorHandoffPacket.ready
    && acceptanceWorkflow.ready
    && recoveryStatusHandoff.ready;
  const rows = [
    {
      id: "memory-mount",
      command: "memory.campaign.mount",
      state: readiness.ready ? "ready" : "blocked",
      route: `${routeBase}/readiness`,
      token: mountKey,
      idempotencyKey: `${program.job.id}:memory-mount:client:mount:${stableMemoryMountToken([clientId, mountKey])}`,
      blockers: readiness.errors ?? [],
    },
    {
      id: "runtime-handoff",
      command: runtimeHandoff.command,
      state: runtimeHandoff.ready ? "ready" : "blocked",
      route: `${routeBase}/runtime`,
      token: runtimeHandoff.handoffToken,
      idempotencyKey: `${program.job.id}:memory-mount:client:runtime:${runtimeHandoff.handoffToken ?? "pending"}`,
      blockers: runtimeHandoff.blockedReasons,
    },
    {
      id: "rollback-resume",
      command: recoveryStatusHandoff.runtimeCommand,
      state: recoveryStatusHandoff.ready ? "ready" : "blocked",
      route: `${routeBase}/rollback`,
      token: recoveryStatusHandoff.restartToken ?? null,
      idempotencyKey: `${program.job.id}:memory-mount:client:rollback:${recoveryStatusHandoff.restartToken ?? "pending"}`,
      blockers: recoveryStatusHandoff.blockedReasons,
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
      idempotencyKey: `${program.job.id}:memory-mount:client:dispatch:${adapterDispatchPlan.dispatch.token ?? "pending"}`,
      blockers: adapterDispatchPlan.blockedReasons,
    },
  ];
  const blockedReasons = uniqueSorted([
    ...(accepted ? [] : ["memory mount preview acceptance is pending"]),
    ...rows.flatMap((row) => row.blockers),
    ...lifecycleControls.blockedReasons,
    ...acceptanceWorkflow.blockedReasons,
  ]);
  const activeRow = rows.find((row) => row.state === "blocked")
    ?? rows.find((row) => row.state === "dispatch-ready")
    ?? rows.find((row) => row.state === "ready")
    ?? rows[0];
  const restartSafe = releaseReady && blockedReasons.length === 0;
  const stateToken = restartSafe ? stableMemoryMountToken([
    clientId,
    program.job.id,
    mountKey,
    runtimeHandoff.handoffToken,
    recoveryStatusHandoff.restartToken,
    operatorHandoffPacket.release.token,
    adapterDispatchPlan.dispatch.token,
  ]) : null;

  return {
    kind: "mailchimp.memory-mount.persisted-client-state",
    apiVersion: "aios.client/v1",
    jobId: program.job.id,
    clientId,
    ready: restartSafe,
    status: restartSafe
      ? "memory-client-resume-ready"
      : accepted ? "accepted-memory-review" : "awaiting-memory-acceptance",
    routeState: {
      base: routeBase,
      activeRoute: activeRow.route,
      badge: restartSafe
        ? "memory-runtime-ready"
        : accepted ? "memory-review" : "acceptance-required",
      primaryAction: restartSafe ? "memory.mount.client.resume" : activeRow.command,
    },
    persistedState: {
      key: `${program.job.memory.namespace}:memory-mount:client:${clientId}:${mountKey}`,
      token: stateToken,
      idempotencyKey: `${program.job.id}:memory-mount:client-state:${clientId}`,
      mountKey,
      memoryNamespace: program.job.memory.namespace,
      runtimeHandoffToken: runtimeHandoff.handoffToken,
      restartToken: recoveryStatusHandoff.restartToken ?? null,
      operatorReleaseToken: operatorHandoffPacket.release.token,
      adapterDispatchToken: adapterDispatchPlan.dispatch.token,
    },
    controls: {
      canAccept: !accepted && readiness.ready && recoveryStatusHandoff.ready,
      canResume: restartSafe,
      canDispatch: adapterDispatchPlan.ready && accepted,
      canPollAdapter: adapterDispatchPlan.adapter.status === "degraded",
      canUpdateSchedule: lifecycleControls.controls.canSchedule,
    },
    summary: {
      totalRows: rows.length,
      readyRows: rows.filter((row) => row.state === "ready" || row.state === "already-applied").length,
      blockedRows: rows.filter((row) => row.blockers.length > 0).length,
      dispatchableRows: adapterDispatchPlan.summary.dispatchableRows,
      lifecycleReady: lifecycleControls.ready,
    },
    rows,
    blockedReasons,
  };
}

function buildMemoryMountNextSteps(
  providerContract,
  recoveryStatusHandoff,
  readiness,
  adapterDispatchPlan,
  operatorHandoffPacket = null,
) {
  if (operatorHandoffPacket && !operatorHandoffPacket.ready && operatorHandoffPacket.clientState.canDispatch === false) {
    return operatorHandoffPacket.blockedReasons.map((reason) => ({
      action: operatorHandoffPacket.nextAction,
      label: "Resolve memory mount handoff",
      reason,
    }));
  }
  if (!providerContract.handoffState.ready) {
    return providerContract.handoffState.blockedReasons.map((reason) => ({
      action: providerContract.handoffState.nextAction,
      label: "Resolve provider handoff",
      reason,
    }));
  }
  if (!recoveryStatusHandoff.ready) {
    return recoveryStatusHandoff.blockedReasons.map((reason) => ({
      action: recoveryStatusHandoff.runtimeCommand,
      label: "Prepare rollback status handoff",
      reason,
    }));
  }
  if (!readiness.ready) {
    return readiness.errors.map((reason) => ({
      action: readiness.nextAction,
      label: "Resolve memory mount readiness",
      reason,
    }));
  }
  if (!adapterDispatchPlan.ready) {
    return adapterDispatchPlan.blockedReasons.map((reason) => ({
      action: adapterDispatchPlan.nextAction,
      label: "Prepare memory mount dispatch",
      reason,
    }));
  }
  return [{
    action: "accept-memory-mount-preview",
    label: "Accept memory mount preview",
    reason: "memory mount, provider sync, and rollback status handoff are ready",
  }];
}

function normalizeMemoryMountAdapterStatus(status = "healthy", retryAfterSeconds = 30) {
  const normalized = String(status ?? "healthy").trim().toLowerCase();
  const safeStatus = ["healthy", "degraded", "offline"].includes(normalized) ? normalized : "offline";

  return {
    status: safeStatus,
    handoff: safeStatus === "healthy" ? "available" : safeStatus === "degraded" ? "deferred" : "blocked",
    retryAfterSeconds: safeStatus === "degraded" ? Number(retryAfterSeconds) : null,
  };
}

function normalizeMemoryMountScopePart(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function stableMemoryMountToken(parts) {
  const input = parts.map((part) => String(part ?? "")).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `mem_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
