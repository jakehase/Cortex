import {
  buildAuditTimelineState,
  createAuditExportSnapshot,
  createEvidence,
  createStatusEvent,
  createTruthBoundaryReport,
} from "../stdlib/audit.mjs";
import {
  buildPackageOperationalReport,
  buildProviderServiceContract,
  compilePackageSource,
} from "../stdlib/packages.mjs";

export const operatorStatusJobSource = `# deterministic Mailchimp operator status handoff job
use mailchimp:campaign.read
use memory:campaign.local
use verifier:evidence.record
use status:timeline.write
recover rollback=snapshot retry=1
step collect-runtime-status input=jobId output=runtimeStatus verify.contract=status-readable
step collect-provider-status input=runtimeStatus.campaignId output=providerStatus verify.source=mailchimp
step reconcile-operator-view input=providerStatus output=operatorStatus verify.truth=operator-visible
step publish-status-handoff input=operatorStatus output=statusEvent verify.boundary=no-external-write
`;

export function buildOperatorStatusProgram(options = {}) {
  return compilePackageSource(operatorStatusJobSource, {
    name: options.name ?? "mailchimp-operator-status-job",
    version: options.version ?? "0.1.0",
    description: "Compile a Mailchimp operator status job that reconciles runtime and adapter state.",
    capabilities: options.capabilities ?? [],
    exports: {
      compile: "./stdlib/packages.mjs#compilePackageSource",
      audit: "./stdlib/audit.mjs#createTruthBoundaryReport",
      statusContract: "./examples/operator-status-job.mjs#buildOperatorStatusContract",
      recoveryHandoff: "./examples/operator-status-job.mjs#buildOperatorRecoveryStatusHandoff",
      selfCheck: "./examples/operator-status-job.mjs#selfCheckOperatorStatusJob",
    },
  }, {
    name: "mailchimp-operator-status-job",
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

export function buildOperatorStatusAudit(program = buildOperatorStatusProgram(), options = {}) {
  const missing = new Set(options.missingEvidence ?? []);
  const evidence = program.job.verifier.requiredEvidence
    .filter((subject) => !missing.has(subject))
    .map((subject) => createEvidence(
      subject.includes("verify.source") ? "mailchimp-read-receipt" : "runtime-local-receipt",
      subject,
      { example: "operator-status-job", operatorView: true },
    ));

  return createTruthBoundaryReport(program.job, {
    status: options.status ?? "completed",
    timeline: [
      createStatusEvent("queued", { at: "logical:0", message: "operator status queued" }),
      createStatusEvent("running", { at: "logical:1", message: "runtime and provider status collected" }),
      createStatusEvent("verifying", { at: "logical:2", message: "operator status reconciled" }),
      createStatusEvent(options.status ?? "completed", {
        at: "logical:3",
        message: "operator status handoff ready",
      }),
    ],
    evidence,
    externalWrites: options.externalWrites ?? [],
  });
}

export function buildOperatorRecoveryStatusHandoff(
  program = buildOperatorStatusProgram(),
  audit = buildOperatorStatusAudit(program),
  options = {},
) {
  const exportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:4",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const timelineState = buildAuditTimelineState(audit, {
    history: options.history ?? [],
  });
  const providerContract = buildProviderServiceContract(program, {
    checkpoint: exportSnapshot.exportId,
    providerResource: "operator-status",
    supportedCapabilities: options.supportedCapabilities,
  });
  const adapter = normalizeAdapterStatus(options.adapterStatus, options.adapterRetryAfterSeconds);
  const lifecycleControls = buildOperatorLifecycleControls(program, options);
  const statusModel = buildOperatorStatusModel(program, audit, timelineState, providerContract, adapter, lifecycleControls, options);

  return deepFreeze(buildOperatorRecoveryHandoff(
    program,
    audit,
    timelineState,
    statusModel,
    lifecycleControls,
    providerContract,
    options,
  ));
}

export function buildOperatorStatusContract(
  program = buildOperatorStatusProgram(),
  audit = buildOperatorStatusAudit(program),
  options = {},
) {
  const exportSnapshot = createAuditExportSnapshot(audit, {
    generatedAt: options.generatedAt ?? "logical:4",
    format: options.exportFormat ?? "json.summary",
    history: options.history ?? [],
  });
  const timelineState = buildAuditTimelineState(audit, {
    history: options.history ?? [],
  });
  const providerContract = buildProviderServiceContract(program, {
    checkpoint: exportSnapshot.exportId,
    providerResource: "operator-status",
    supportedCapabilities: options.supportedCapabilities,
  });
  const adapter = normalizeAdapterStatus(options.adapterStatus, options.adapterRetryAfterSeconds);
  const lifecycleControls = buildOperatorLifecycleControls(program, options);
  const statusModel = buildOperatorStatusModel(program, audit, timelineState, providerContract, adapter, lifecycleControls, options);
  const previewAcceptance = buildOperatorPreviewAcceptance(
    program,
    audit,
    timelineState,
    statusModel,
    lifecycleControls,
    options,
  );
  const analytics = buildOperatorStatusAnalytics(program, audit, timelineState, exportSnapshot, statusModel, options);
  const recoveryHandoff = buildOperatorRecoveryHandoff(
    program,
    audit,
    timelineState,
    statusModel,
    lifecycleControls,
    providerContract,
    options,
  );
  const providerServiceManifest = buildOperatorProviderServiceManifest(
    program,
    audit,
    timelineState,
    statusModel,
    previewAcceptance,
    recoveryHandoff,
    providerContract,
    lifecycleControls,
    options,
  );
  const routeDecisionPacket = buildOperatorRouteDecisionPacket(
    program,
    audit,
    timelineState,
    statusModel,
    previewAcceptance,
    recoveryHandoff,
    providerServiceManifest,
    analytics,
    lifecycleControls,
    options,
  );
  const packageReport = buildPackageOperationalReport(program, {
    generatedAt: options.generatedAt ?? "logical:4",
    exportFormat: options.packageReportFormat ?? "json.operator-status-operational-summary",
    history: options.packageHistory ?? options.history ?? [],
    providerContract,
    acceptance: {
      accepted: options.accepted ?? options.requireAcceptance !== true,
      acceptedBy: options.acceptedBy,
      acceptedAt: options.acceptedAt ?? "logical:4",
    },
    runtimeState: {
      persistedState: options.persistedRuntimeState ?? {
        ready: statusModel.ready,
        restartSafe: statusModel.ready,
        stateKey: `${program.job.memory.namespace}:operator-status:runtime`,
        restart: {
          token: statusModel.ready ? `${program.job.id}:operator-status:resume` : null,
          command: "operator.status.render",
        },
        recovery: recoveryHandoff.persistedState,
      },
      clientState: options.clientRuntimeState ?? {
        ready: statusModel.ready,
        status: statusModel.visibleStatus,
        runtime: {
          enabled: statusModel.ready,
          command: statusModel.primaryAction,
        },
        recovery: recoveryHandoff.clientState,
      },
    },
  });

  return deepFreeze({
    kind: "mailchimp.operator-status.contract",
    apiVersion: "aios.example/v1",
    jobId: program.job.id,
    statusModel,
    previewAcceptance,
    lifecycleControls,
    recoveryHandoff,
    providerServiceManifest,
    routeDecisionPacket,
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
    timelineState,
    provider: providerContract.provider,
    audit: {
      status: audit.status,
      exportId: exportSnapshot.exportId,
      readyForExport: exportSnapshot.truthBoundary.readyForExport,
      summary: exportSnapshot.summary,
    },
    runtimeHandoff: {
      ready: previewAcceptance.readiness.ready,
      command: previewAcceptance.nextAction.command,
      statusEvent: statusModel.visibleStatus,
      blockedReasons: previewAcceptance.readiness.blockedReasons,
      handoffToken: previewAcceptance.readiness.ready ? providerContract.handoffState.handoffToken : null,
      recoveryToken: recoveryHandoff.ready ? recoveryHandoff.resumeToken : null,
      recoveryAction: recoveryHandoff.nextAction,
      providerServiceManifestKey: providerServiceManifest.manifestKey,
      providerServiceState: providerServiceManifest.serviceState.status,
      providerSyncCommand: providerServiceManifest.commands.sync.command,
      providerAckCommand: providerServiceManifest.commands.ack.command,
      providerCapabilityFallback: providerServiceManifest.capabilityNegotiation.fallback,
      routeDecisionPacketKey: routeDecisionPacket.packetKey,
      routePrimaryCommand: routeDecisionPacket.commands.primary.command,
      routePreviewStatus: routeDecisionPacket.preview.status,
      lifecycleControlCommand: lifecycleControls.controlIntent.nextAction.command,
      lifecycleControlIdempotencyKey: lifecycleControls.controlIntent.idempotencyKey,
      lifecycleSettingsChanged: lifecycleControls.settingsChange.changedFields,
      packageReportStatus: packageReport.status,
      packageReportExportId: packageReport.exportId,
    },
    nextSteps: buildStatusNextSteps(statusModel, previewAcceptance),
  });
}

export function describeOperatorStatusJob(options = {}) {
  const contract = buildOperatorStatusContract(undefined, undefined, options);
  return deepFreeze({
    jobId: contract.jobId,
    ready: contract.statusModel.ready,
    visibleStatus: contract.statusModel.visibleStatus,
    badge: contract.statusModel.badge,
    previewAcceptance: contract.previewAcceptance.summary,
    lifecycleControls: contract.lifecycleControls,
    recoveryHandoff: contract.recoveryHandoff.summary,
    providerServiceManifest: contract.providerServiceManifest.summary,
    routeDecisionPacket: contract.routeDecisionPacket.summary,
    analytics: contract.analytics.exportSummary,
    packageReport: contract.packageReport.exportSummary,
    blockedReasons: contract.statusModel.blockedReasons,
    nextSteps: contract.nextSteps,
  });
}

export function selfCheckOperatorStatusJob(options = {}) {
  const contract = buildOperatorStatusContract(undefined, undefined, {
    adapterStatus: "healthy",
    ...options,
  });

  return deepFreeze({
    kind: "mailchimp.operator-status.self-check",
    apiVersion: "aios.example/v1",
    passed: contract.statusModel.ready,
    jobId: contract.jobId,
    recoveryReady: contract.recoveryHandoff.ready,
    providerServiceReady: contract.providerServiceManifest.validation.ready,
    providerServiceCommand: contract.providerServiceManifest.commands.sync.command,
    routeDecisionPacketReady: contract.routeDecisionPacket.validation.ready,
    routeDecisionCommand: contract.routeDecisionPacket.commands.primary.command,
    recoveryBlockedReasons: contract.recoveryHandoff.blockedReasons,
    blockedReasons: uniqueSorted([
      ...contract.statusModel.blockedReasons,
      ...contract.providerServiceManifest.validation.blockers,
      ...contract.routeDecisionPacket.validation.blockers,
    ]),
  });
}

function buildOperatorStatusModel(program, audit, timelineState, providerContract, adapter, lifecycleControls, options) {
  const blockers = uniqueSorted([
    ...(program.lifecycle.validation.valid ? [] : program.lifecycle.validation.errors),
    ...lifecycleControls.blockedReasons,
    ...(audit.evidence.missing.length === 0 ? [] : audit.evidence.missing.map((subject) => `missing operator status evidence: ${subject}`)),
    ...(audit.boundary.externalWritesObserved.length === 0 ? [] : audit.boundary.externalWritesObserved.map((write) => `external write observed: ${write.subject ?? write}`)),
    ...providerContract.handoffState.blockedReasons,
    ...(adapter.status === "healthy" ? [] : [`adapter status ${adapter.status}`]),
  ]);
  const ready = blockers.length === 0 && timelineState.current.exportReady;
  const visibleStatus = ready
    ? "ready"
    : adapter.status === "offline"
      ? "blocked"
      : timelineState.nextAction;

  return {
    ready,
    visibleStatus,
    badge: ready ? "completed" : audit.status,
    primaryAction: ready ? lifecycleControls.requestedCommand : lifecycleControls.nextAction,
    disabledReason: ready ? null : blockers[0] ?? "operator status export is not ready",
    adapter,
    controls: lifecycleControls,
    observedStatus: {
      auditStatus: audit.status,
      timelineChanged: timelineState.changed,
      packageName: program.manifest.name,
      campaignId: String(options.campaignId ?? "campaign:operator-status"),
    },
    blockedReasons: ready ? [] : uniqueSorted([
      ...blockers,
      ...(timelineState.current.exportReady ? [] : ["operator status timeline is not export-ready"]),
    ]),
  };
}

function buildOperatorRecoveryHandoff(program, audit, timelineState, statusModel, lifecycleControls, providerContract, options) {
  const policy = normalizeRecoveryPolicy(options.recoveryPolicy);
  const attempts = normalizeRecoveryAttempts(options.recoveryAttempts);
  const latestAttempt = attempts[attempts.length - 1] ?? null;
  const acceptedEvidence = getAcceptedEvidence(audit);
  const adapterRecoverable = ["healthy", "degraded"].includes(statusModel.adapter.status);
  const timelineRecoverable = Boolean(timelineState.current.exportReady || timelineState.previous);
  const evidenceRecoverable = acceptedEvidence.length > 0;
  const approvalReady = !lifecycleControls.settings.requireApproval || Boolean(options.recoveryApproved ?? options.accepted);
  const retryRemaining = Math.max(0, policy.retryLimit - attempts.length);
  const retryWindowSeconds = normalizeIntegerRange(
    options.recoveryRetryWindowSeconds ?? policy.retryWindowSeconds,
    "recoveryRetryWindowSeconds",
    15,
    86400,
  );
  const checkpoint = String(options.recoveryCheckpoint ?? providerContract.handoffState.checkpoint ?? `${program.job.id}:checkpoint`);
  const stateKey = String(options.recoveryStateKey ?? `${program.job.memory.namespace}:operator-status:recovery`);
  const blockedReasons = uniqueSorted([
    ...(policy.valid ? [] : policy.errors),
    ...(adapterRecoverable ? [] : [`adapter status ${statusModel.adapter.status} is not recoverable`]),
    ...(timelineRecoverable ? [] : ["operator status recovery requires a current or previous timeline checkpoint"]),
    ...(evidenceRecoverable ? [] : ["operator status recovery requires at least one evidence receipt"]),
    ...(retryRemaining > 0 ? [] : [`operator status recovery retry limit reached: ${policy.retryLimit}`]),
    ...(approvalReady ? [] : ["operator status recovery approval required"]),
    ...(lifecycleControls.enabled ? [] : ["operator status workflow is disabled"]),
  ]);
  const ready = blockedReasons.length === 0;
  const resumeToken = ready
    ? `${program.job.id}:recover:${checkpoint}:${retryRemaining}`
    : null;
  const rollbackToken = ready && policy.rollback === "snapshot"
    ? `${program.job.id}:rollback:${checkpoint}`
    : null;
  const nextAction = ready
    ? "operator.status.recover"
    : blockedReasons.some((reason) => reason.includes("approval"))
      ? "operator.status.approve-recovery"
      : blockedReasons.some((reason) => reason.includes("retry limit"))
        ? "operator.status.escalate-recovery"
        : blockedReasons.some((reason) => reason.includes("adapter status"))
          ? "operator.status.wait-for-adapter"
          : "operator.status.review-recovery";
  const reasonCode = ready
    ? "recovery-ready"
    : blockedReasons[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "recovery-blocked";
  const capabilityClaims = uniqueSorted([
    "mailchimp:campaign.read",
    "memory:campaign.local",
    "status:timeline.write",
    "verifier:evidence.record",
    ...(ready ? ["recovery:rollback.snapshot"] : []),
  ]);

  return {
    kind: "mailchimp.operator-status.recovery-handoff",
    apiVersion: "aios.example/v1",
    ready,
    policy: {
      rollback: policy.rollback,
      retryLimit: policy.retryLimit,
      retryRemaining,
      retryWindowSeconds,
      sourceDirective: policy.sourceDirective,
    },
    checkpoint,
    stateKey,
    resumeToken,
    rollbackToken,
    nextAction,
    reasonCode,
    blockedReasons,
    adapter: {
      status: statusModel.adapter.status,
      recoverable: adapterRecoverable,
      retryAfterSeconds: statusModel.adapter.retryAfterSeconds,
    },
    timeline: {
      currentAction: timelineState.nextAction,
      exportReady: timelineState.current.exportReady,
      changed: timelineState.changed,
      recoverable: timelineRecoverable,
    },
    evidence: {
      present: acceptedEvidence.length,
      missing: audit.evidence.missing.length,
      recoverable: evidenceRecoverable,
    },
    attempts,
    latestAttempt,
    capabilityClaims,
    persistedState: {
      ready,
      stateKey,
      checkpoint,
      resumeToken,
      rollbackToken,
      attempts: attempts.length,
      retryRemaining,
      nextAction,
    },
    clientState: {
      ready,
      status: ready ? "recoverable" : "blocked",
      command: nextAction,
      retryRemaining,
      blockedReasons,
    },
    summary: {
      ready,
      rollback: policy.rollback,
      retryRemaining,
      nextAction,
      reasonCode,
      blockedCount: blockedReasons.length,
    },
  };
}

function buildOperatorLifecycleControls(program, options) {
  const enabled = Boolean(options.enabled ?? program.lifecycle.enabled);
  const requestedCommand = String(options.command ?? (enabled ? "operator.status.render" : "operator.status.enable")).trim();
  const schedule = normalizeOperatorSchedule(options.schedule ?? program.lifecycle.schedule);
  const refreshSeconds = normalizeIntegerRange(options.refreshSeconds ?? 60, "refreshSeconds", 15, 3600);
  const staleAfterSeconds = normalizeIntegerRange(options.staleAfterSeconds ?? 300, "staleAfterSeconds", refreshSeconds, 86400);
  const settingsChange = normalizeOperatorSettingsChange(options.settingsChange, {
    enabled,
    schedule: schedule.value,
    refreshSeconds,
    staleAfterSeconds,
    visibleFields: options.visibleFields,
    requireApproval: options.requireApproval ?? program.lifecycle.requireApproval,
  });
  const controlIntent = buildOperatorLifecycleControlIntent(
    program,
    requestedCommand,
    enabled,
    schedule,
    settingsChange,
    options,
  );
  const allowedCommands = enabled
    ? [
      "operator.status.disable",
      "operator.status.render",
      "operator.status.refresh",
      "operator.status.reschedule",
      "operator.status.review",
      "operator.status.review-settings",
      "operator.status.approve-settings",
    ]
    : ["operator.status.enable", "operator.status.review", "operator.status.review-settings", "operator.status.approve-settings"];
  const commandAllowed = allowedCommands.includes(requestedCommand);
  const stale = Boolean(options.lastStatusAt) && Boolean(options.now) && String(options.lastStatusAt) !== String(options.now);
  const blockedReasons = uniqueSorted([
    ...(enabled ? [] : ["operator status workflow is disabled"]),
    ...(schedule.valid ? [] : schedule.errors),
    ...(commandAllowed ? [] : [`operator status command not allowed in current lifecycle: ${requestedCommand}`]),
    ...(stale ? [`operator status snapshot is stale after ${staleAfterSeconds}s`] : []),
    ...settingsChange.blockedReasons,
    ...controlIntent.blockedReasons,
  ]);
  const nextAction = blockedReasons.length === 0
    ? requestedCommand
    : controlIntent.blockedReasons.length > 0
      ? controlIntent.nextAction.command
    : !enabled
      ? "operator.status.enable"
      : schedule.valid
        ? stale
          ? "operator.status.refresh"
          : "operator.status.review"
        : "operator.status.reschedule";

  return {
    enabled,
    requestedCommand,
    allowedCommands,
    commandAllowed,
    schedule: schedule.value,
    refreshSeconds,
    staleAfterSeconds,
    stale,
    settings: {
      dryRun: Boolean(program.lifecycle.dryRun),
      requireApproval: Boolean(options.requireApproval ?? program.lifecycle.requireApproval),
      visibleFields: uniqueSorted(options.visibleFields ?? [
        "adapter",
        "audit",
        "timeline",
        "blockedReasons",
      ]),
    },
    settingsChange,
    controlIntent,
    nextAction,
    blockedReasons,
  };
}

function normalizeOperatorSettingsChange(change = {}, current) {
  const patch = change && typeof change === "object" ? change : {};
  const hasEnabled = Object.prototype.hasOwnProperty.call(patch, "enabled");
  const hasSchedule = Object.prototype.hasOwnProperty.call(patch, "schedule");
  const hasRefresh = Object.prototype.hasOwnProperty.call(patch, "refreshSeconds");
  const hasStale = Object.prototype.hasOwnProperty.call(patch, "staleAfterSeconds");
  const hasVisibleFields = Object.prototype.hasOwnProperty.call(patch, "visibleFields");
  const hasApproval = Object.prototype.hasOwnProperty.call(patch, "requireApproval");
  const nextEnabled = hasEnabled ? Boolean(patch.enabled) : current.enabled;
  const nextSchedule = hasSchedule ? normalizeOperatorSchedule(patch.schedule) : {
    valid: true,
    value: current.schedule,
    errors: [],
  };
  const nextRefreshSeconds = hasRefresh
    ? normalizeIntegerRange(patch.refreshSeconds, "operator settings refreshSeconds", 15, 3600)
    : current.refreshSeconds;
  const nextStaleAfterSeconds = hasStale
    ? normalizeIntegerRange(patch.staleAfterSeconds, "operator settings staleAfterSeconds", nextRefreshSeconds, 86400)
    : Math.max(current.staleAfterSeconds, nextRefreshSeconds);
  const nextVisibleFields = hasVisibleFields
    ? uniqueSorted(patch.visibleFields)
    : uniqueSorted(current.visibleFields ?? [
      "adapter",
      "audit",
      "timeline",
      "blockedReasons",
    ]);
  const nextRequireApproval = hasApproval
    ? Boolean(patch.requireApproval)
    : Boolean(current.requireApproval);
  const invalidFields = uniqueSorted([
    ...(nextVisibleFields.length === 0 ? ["visibleFields"] : []),
    ...(nextSchedule.valid ? [] : ["schedule"]),
    ...(nextStaleAfterSeconds < nextRefreshSeconds ? ["staleAfterSeconds"] : []),
  ]);
  const changedFields = uniqueSorted([
    ...(hasEnabled && nextEnabled !== current.enabled ? ["enabled"] : []),
    ...(hasSchedule && JSON.stringify(nextSchedule.value) !== JSON.stringify(current.schedule) ? ["schedule"] : []),
    ...(hasRefresh && nextRefreshSeconds !== current.refreshSeconds ? ["refreshSeconds"] : []),
    ...(hasStale && nextStaleAfterSeconds !== current.staleAfterSeconds ? ["staleAfterSeconds"] : []),
    ...(hasVisibleFields ? ["visibleFields"] : []),
    ...(hasApproval && nextRequireApproval !== Boolean(current.requireApproval) ? ["requireApproval"] : []),
  ]);
  const blockedReasons = uniqueSorted([
    ...nextSchedule.errors,
    ...invalidFields.map((field) => `operator status setting is invalid: ${field}`),
  ]);

  return {
    requested: Object.keys(patch).length > 0,
    valid: blockedReasons.length === 0,
    changedFields,
    invalidFields,
    nextSettings: {
      enabled: nextEnabled,
      schedule: nextSchedule.value,
      refreshSeconds: nextRefreshSeconds,
      staleAfterSeconds: nextStaleAfterSeconds,
      visibleFields: nextVisibleFields,
      requireApproval: nextRequireApproval,
    },
    blockedReasons,
  };
}

function buildOperatorLifecycleControlIntent(program, requestedCommand, enabled, schedule, settingsChange, options) {
  const mutationCommands = new Set([
    "operator.status.disable",
    "operator.status.enable",
    "operator.status.reschedule",
  ]);
  const isMutation = mutationCommands.has(requestedCommand) || settingsChange.requested;
  const requiresApproval = Boolean(options.requireApproval ?? program.lifecycle.requireApproval);
  const approved = !requiresApproval || Boolean(options.settingsApproved ?? options.accepted);
  const commandEffect = requestedCommand === "operator.status.enable"
    ? "enable"
    : requestedCommand === "operator.status.disable"
      ? "disable"
      : requestedCommand === "operator.status.reschedule" || settingsChange.changedFields.includes("schedule")
        ? "reschedule"
        : requestedCommand === "operator.status.refresh"
          ? "refresh"
          : "render";
  const targetEnabled = commandEffect === "enable"
    ? true
    : commandEffect === "disable"
      ? false
      : settingsChange.nextSettings.enabled;
  const blockedReasons = uniqueSorted([
    ...(schedule.valid ? [] : schedule.errors),
    ...(settingsChange.valid ? [] : settingsChange.blockedReasons),
    ...(isMutation && requiresApproval && !approved
      ? ["operator status lifecycle setting change requires approval"]
      : []),
    ...(commandEffect === "reschedule" && settingsChange.nextSettings.schedule.mode === "manual"
      ? ["operator status reschedule requires interval or cron schedule"]
      : []),
  ]);
  const acceptedCommand = blockedReasons.length === 0
    ? requestedCommand
    : requiresApproval && !approved
      ? "operator.status.approve-settings"
      : commandEffect === "reschedule"
        ? "operator.status.reschedule"
        : "operator.status.review-settings";
  const settingsFingerprint = [
    targetEnabled,
    settingsChange.nextSettings.schedule.mode,
    settingsChange.nextSettings.schedule.everySeconds ?? settingsChange.nextSettings.schedule.expression ?? "manual",
    settingsChange.nextSettings.refreshSeconds,
    settingsChange.nextSettings.staleAfterSeconds,
    settingsChange.nextSettings.visibleFields.join(","),
    settingsChange.nextSettings.requireApproval,
  ].join(":");

  return {
    kind: "mailchimp.operator-status.lifecycle-control-intent",
    apiVersion: "aios.example/v1",
    requestedCommand,
    effect: commandEffect,
    mutatesSettings: isMutation,
    approved,
    targetEnabled,
    targetSchedule: settingsChange.nextSettings.schedule,
    changedFields: settingsChange.changedFields,
    idempotencyKey: `${program.job.id}:lifecycle:${acceptedCommand}:${settingsFingerprint}`,
    acceptedCommand,
    nextAction: {
      command: acceptedCommand,
      enabled: blockedReasons.length === 0 || acceptedCommand === "operator.status.approve-settings",
      reason: blockedReasons[0] ?? `operator status lifecycle ${commandEffect} accepted`,
    },
    blockedReasons,
  };
}

function buildOperatorPreviewAcceptance(program, audit, timelineState, statusModel, lifecycleControls, options) {
  const acceptanceRequired = Boolean(options.requireAcceptance ?? false);
  const accepted = acceptanceRequired ? Boolean(options.accepted ?? false) : true;
  const acceptedBy = accepted && acceptanceRequired ? String(options.acceptedBy ?? "operator") : null;
  const acceptedAt = accepted && acceptanceRequired ? String(options.acceptedAt ?? "logical:4") : null;
  const previewRows = normalizeOperatorPreviewRows(options.previewRows, statusModel, timelineState);
  const acceptedEvidence = getAcceptedEvidence(audit);
  const validationSummary = {
    statusReady: statusModel.ready,
    timelineReady: timelineState.current.exportReady,
    lifecycleReady: lifecycleControls.blockedReasons.length === 0,
    adapterReady: statusModel.adapter.status === "healthy",
    evidenceMissing: audit.evidence.missing.length,
    externalWrites: audit.boundary.externalWritesObserved.length,
    previewRows: previewRows.length,
  };
  const validationCards = [
    {
      key: "adapter",
      label: "Adapter status",
      status: validationSummary.adapterReady ? "ready" : "blocked",
      detail: validationSummary.adapterReady
        ? "Mailchimp adapter is available for status handoff"
        : `Mailchimp adapter is ${statusModel.adapter.status}`,
    },
    {
      key: "timeline",
      label: "Timeline export",
      status: validationSummary.timelineReady ? "ready" : "blocked",
      detail: validationSummary.timelineReady
        ? `Next timeline action is ${timelineState.nextAction}`
        : "Operator status timeline is not export-ready",
    },
    {
      key: "evidence",
      label: "Evidence receipts",
      status: validationSummary.evidenceMissing === 0 ? "ready" : "missing",
      detail: validationSummary.evidenceMissing === 0
        ? `${acceptedEvidence.length} evidence receipt(s) present`
        : `${validationSummary.evidenceMissing} evidence receipt(s) missing`,
    },
    {
      key: "lifecycle",
      label: "Lifecycle command",
      status: validationSummary.lifecycleReady ? "ready" : "blocked",
      detail: validationSummary.lifecycleReady
        ? `Command ${lifecycleControls.requestedCommand} is allowed`
        : lifecycleControls.blockedReasons[0] ?? "Lifecycle command requires review",
    },
  ];
  const acceptanceBlockedReasons = acceptanceRequired && !accepted
    ? ["operator status preview acceptance required before handoff"]
    : [];
  const blockedReasons = uniqueSorted([
    ...statusModel.blockedReasons,
    ...acceptanceBlockedReasons,
  ]);
  const ready = statusModel.ready && accepted;
  const nextAction = ready
    ? {
      command: statusModel.primaryAction,
      label: "Render operator status",
      reason: "operator preview, runtime status, and provider status are ready",
    }
    : !accepted
      ? {
        command: "operator.status.accept-preview",
        label: "Accept operator status preview",
        reason: "operator acceptance is required before handoff",
      }
      : {
        command: lifecycleControls.nextAction,
        label: "Resolve operator status blocker",
        reason: blockedReasons[0] ?? "operator status requires review",
      };

  return {
    summary: {
      ready,
      acceptanceRequired,
      accepted,
      visibleStatus: statusModel.visibleStatus,
      previewRowCount: previewRows.length,
      validationCardCount: validationCards.length,
      blockedCount: blockedReasons.length,
      nextAction: nextAction.command,
    },
    preview: {
      title: `Mailchimp operator status: ${statusModel.observedStatus.campaignId}`,
      packageName: program.manifest.name,
      badge: statusModel.badge,
      visibleStatus: statusModel.visibleStatus,
      rows: previewRows,
      validationCards,
    },
    acceptance: {
      required: acceptanceRequired,
      accepted,
      acceptedBy,
      acceptedAt,
      receipt: accepted && acceptanceRequired
        ? `operator-status-acceptance:${statusModel.observedStatus.campaignId}:${acceptedBy}`
        : null,
      blockedReasons: acceptanceBlockedReasons,
    },
    readiness: {
      ready,
      statusReady: statusModel.ready,
      lifecycleReady: validationSummary.lifecycleReady,
      adapterReady: validationSummary.adapterReady,
      accepted,
      blockedReasons,
    },
    validationSummary,
    nextAction,
  };
}

function buildOperatorStatusAnalytics(program, audit, timelineState, exportSnapshot, statusModel, options) {
  const history = normalizeHistory(options.history);
  const acceptedEvidence = getAcceptedEvidence(audit);
  const currentSnapshot = {
    at: String(options.generatedAt ?? "logical:4"),
    jobId: program.job.id,
    status: statusModel.visibleStatus,
    auditStatus: audit.status,
    ready: statusModel.ready,
    blockedCount: statusModel.blockedReasons.length,
    evidencePresent: acceptedEvidence.length,
    evidenceMissing: audit.evidence.missing.length,
    externalWrites: audit.boundary.externalWritesObserved.length,
    blockedReasons: statusModel.blockedReasons,
    nextAction: statusModel.primaryAction,
    adapterStatus: statusModel.adapter.status,
    exportReady: Boolean(exportSnapshot.truthBoundary.readyForExport),
    timelineAction: timelineState.nextAction,
    handoffReady: Boolean(statusModel.ready && exportSnapshot.truthBoundary.readyForExport),
  };
  const snapshots = [...history, currentSnapshot].slice(-10);
  const statusCounts = countBy(snapshots, "status");
  const auditCounts = countBy(snapshots, "auditStatus");
  const adapterCounts = countBy(snapshots, "adapterStatus");
  const exportHistory = buildOperatorExportHistoryReport(snapshots, currentSnapshot, exportSnapshot, statusModel, timelineState);
  const timelineEvents = buildOperatorAnalyticsTimelineEvents(snapshots, timelineState, statusModel);
  const latestBlockedReasons = uniqueSorted([
    ...statusModel.blockedReasons,
    ...snapshots.flatMap((snapshot) => snapshot.blockedReasons ?? []),
  ]);
  const trend = snapshots.length < 2
    ? "new"
    : snapshots[snapshots.length - 1].ready === snapshots[snapshots.length - 2].ready
      ? "unchanged"
      : snapshots[snapshots.length - 1].ready
        ? "recovered"
        : "regressed";

  return {
    counters: {
      snapshots: snapshots.length,
      readySnapshots: snapshots.filter((snapshot) => snapshot.ready).length,
      blockedSnapshots: snapshots.filter((snapshot) => !snapshot.ready).length,
      handoffReadySnapshots: snapshots.filter((snapshot) => snapshot.handoffReady).length,
      exportReadySnapshots: snapshots.filter((snapshot) => snapshot.exportReady).length,
      adapterHealthySnapshots: snapshots.filter((snapshot) => snapshot.adapterStatus === "healthy").length,
      readinessTransitions: exportHistory.transitionCounts.total,
      recoveries: exportHistory.transitionCounts.recovered,
      regressions: exportHistory.transitionCounts.regressed,
      unchangedTransitions: exportHistory.transitionCounts.unchanged,
      currentBlockedReasons: statusModel.blockedReasons.length,
      uniqueBlockedReasons: latestBlockedReasons.length,
      evidencePresent: currentSnapshot.evidencePresent,
      evidenceMissing: currentSnapshot.evidenceMissing,
      externalWrites: currentSnapshot.externalWrites,
      statusCounts,
      auditCounts,
      adapterCounts,
    },
    history: snapshots,
    timelineReport: {
      changed: timelineState.changed,
      currentAction: timelineState.nextAction,
      exportReady: timelineState.current.exportReady,
      trend,
      lastStatus: currentSnapshot.status,
      readinessStreak: exportHistory.readinessStreak,
      lastTransition: exportHistory.lastTransition,
      events: timelineEvents,
      latestSnapshot: exportHistory.latestSnapshot,
    },
    exportSummary: {
      exportId: exportSnapshot.exportId,
      format: exportSnapshot.format,
      ready: statusModel.ready && exportSnapshot.truthBoundary.readyForExport,
      headline: statusModel.ready
        ? "operator status ready for export"
        : `operator status requires review: ${statusModel.disabledReason}`,
      latestBlockedReasons,
      historyWindow: exportHistory.window,
      handoffReady: currentSnapshot.handoffReady,
      currentSnapshot: exportHistory.latestSnapshot,
      counters: exportHistory.exportCounters,
      nextReportAction: exportHistory.nextReportAction,
    },
    exportHistory,
  };
}

function buildOperatorProviderServiceManifest(
  program,
  audit,
  timelineState,
  statusModel,
  previewAcceptance,
  recoveryHandoff,
  providerContract,
  lifecycleControls,
  options,
) {
  const priorState = options.priorProviderServiceState ?? {};
  const version = Number.isInteger(priorState.version) ? priorState.version + 1 : 1;
  const serviceName = String(options.providerServiceName ?? "mailchimp-operator-status-runtime");
  const providerName = providerContract.provider?.name ?? "mailchimp";
  const providerResource = providerContract.provider?.resource ?? "operator-status";
  const requestedCapabilities = uniqueSorted([
    "mailchimp:campaign.read",
    "memory:campaign.local",
    "status:timeline.write",
    "verifier:evidence.record",
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
  const providerAckStatus = normalizeOperatorProviderAckStatus(
    options.providerAckStatus ?? priorState.providerAckStatus ?? "pending",
  );
  const syncAttempt = normalizeIntegerRange(
    options.providerSyncAttempt ?? priorState.syncAttempt ?? 0,
    "operator provider sync attempt",
    0,
    20,
  );
  const maxSyncAttempts = normalizeIntegerRange(
    options.providerMaxSyncAttempts ?? 3,
    "operator provider max sync attempts",
    1,
    20,
  );
  const syncCursor = String(
    options.providerSyncCursor
      ?? `${program.job.id}:operator-status:${timelineState.current.eventId ?? timelineState.nextAction}`,
  );
  const manifestKey = String(
    options.providerManifestKey
      ?? `${program.job.memory.namespace}:operator-status:provider-service:${statusModel.observedStatus.campaignId}`,
  );
  const syncMetadata = {
    cursor: syncCursor,
    checkpoint: providerContract.handoffState.checkpoint,
    generatedAt: String(options.generatedAt ?? "logical:4"),
    timelineEvent: timelineState.current.eventId ?? timelineState.nextAction,
    timelineAction: timelineState.nextAction,
    evidencePresent: getAcceptedEvidence(audit).length,
    evidenceMissing: audit.evidence.missing.length,
    externalWriteCount: audit.boundary.externalWritesObserved.length,
    recoveryReady: recoveryHandoff.ready,
    acceptanceReady: previewAcceptance.readiness.ready,
  };
  const externalHandoffState = {
    provider: providerName,
    resource: providerResource,
    status: statusModel.ready && recoveryHandoff.ready ? "ready_for_adapter" : "blocked",
    handoffToken: providerContract.handoffState.handoffToken,
    recoveryToken: recoveryHandoff.resumeToken,
    rollbackToken: recoveryHandoff.rollbackToken,
    statusEvent: statusModel.visibleStatus,
    retryAfterSeconds: statusModel.adapter.retryAfterSeconds,
    clientCommand: previewAcceptance.nextAction.command,
  };
  const manifestFingerprint = operatorProviderFingerprint([
    providerName,
    providerResource,
    program.job.id,
    manifestKey,
    syncMetadata.cursor,
    syncMetadata.checkpoint,
    statusModel.visibleStatus,
    statusModel.adapter.status,
    recoveryHandoff.resumeToken,
    previewAcceptance.nextAction.command,
    requestedCapabilities.join(","),
    [...supportedCapabilities].sort().join(","),
  ]);
  const duplicateOf = priorState.manifestFingerprint === manifestFingerprint
    ? priorState.recordId ?? null
    : null;
  const retryable = providerAckStatus === "failed"
    && syncAttempt < maxSyncAttempts
    && ["healthy", "degraded"].includes(statusModel.adapter.status);
  const acknowledged = providerAckStatus === "acknowledged";
  const validationBlockers = uniqueSorted([
    ...(manifestKey.startsWith(`${program.job.memory.namespace}:operator-status:provider-service:`)
      ? []
      : ["operator provider service manifest key must stay inside memory namespace"]),
    ...deniedCapabilities.map((capability) => `operator provider capability not negotiated: ${capability}`),
    ...(statusModel.ready ? [] : ["operator provider service requires ready status model"]),
    ...(previewAcceptance.readiness.ready ? [] : ["operator provider service requires accepted ready preview"]),
    ...(recoveryHandoff.ready ? [] : ["operator provider service requires recovery handoff readiness"]),
    ...(lifecycleControls.blockedReasons.length === 0 ? [] : ["operator provider service requires lifecycle controls readiness"]),
    ...(providerContract.handoffState.handoffToken ? [] : ["operator provider service requires handoff token"]),
    ...(statusModel.adapter.status === "offline" ? ["operator provider service cannot sync while adapter is offline"] : []),
    ...(providerAckStatus === "rejected" ? ["operator provider service handoff was rejected by adapter"] : []),
    ...(syncAttempt <= maxSyncAttempts
      ? []
      : [`operator provider sync attempt ${syncAttempt} exceeds max ${maxSyncAttempts}`]),
  ]);
  const serviceStatus = acknowledged
    ? "acknowledged"
    : validationBlockers.length === 0
      ? "ready_to_sync"
      : retryable
        ? "retryable"
        : "blocked";
  const commandBase = `${manifestKey}:v${version}:${manifestFingerprint}`;

  return {
    kind: "mailchimp.operator-status.provider-service-manifest",
    apiVersion: "aios.integration/v1",
    manifestKey,
    version,
    recordId: `${commandBase}:record`,
    duplicateOf,
    provider: {
      name: providerName,
      resource: providerResource,
      serviceName,
      syncCursor,
      handoffToken: externalHandoffState.handoffToken,
    },
    capabilityNegotiation: {
      requestedCapabilities,
      supportedCapabilities: [...supportedCapabilities].sort(),
      deniedCapabilities,
      fullyGranted: deniedCapabilities.length === 0,
      fallback: deniedCapabilities.length === 0 ? null : "operator-status-read-only-handoff",
    },
    syncMetadata,
    externalHandoffState,
    serviceState: {
      status: serviceStatus,
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
        command: serviceStatus === "ready_to_sync"
          ? "operator.status.provider-sync"
          : "operator.status.provider-review",
        enabled: serviceStatus === "ready_to_sync",
      },
      retry: {
        idempotent: true,
        idempotencyKey: `${commandBase}:retry:${syncAttempt + 1}`,
        command: retryable ? "operator.status.provider-retry" : "operator.status.provider-review",
        enabled: retryable,
      },
      ack: {
        idempotent: true,
        idempotencyKey: `${commandBase}:ack`,
        command: "operator.status.provider-ack",
        enabled: serviceStatus === "ready_to_sync" || acknowledged,
      },
      review: {
        idempotent: true,
        idempotencyKey: `${commandBase}:review`,
        command: "operator.status.provider-review",
        enabled: validationBlockers.length > 0,
      },
    },
    validation: {
      ready: validationBlockers.length === 0 && (serviceStatus === "ready_to_sync" || acknowledged),
      blockers: validationBlockers,
      canSyncProvider: serviceStatus === "ready_to_sync",
      duplicateSafe: duplicateOf !== null || priorState.manifestFingerprint === undefined,
    },
    summary: {
      ready: validationBlockers.length === 0,
      status: serviceStatus,
      provider: providerName,
      resource: providerResource,
      syncCursor,
      deniedCapabilityCount: deniedCapabilities.length,
      command: serviceStatus === "ready_to_sync"
        ? "operator.status.provider-sync"
        : serviceStatus === "retryable"
          ? "operator.status.provider-retry"
          : "operator.status.provider-review",
      blockedCount: validationBlockers.length,
    },
  };
}

function buildOperatorExportHistoryReport(snapshots, currentSnapshot, exportSnapshot, statusModel, timelineState) {
  const transitions = snapshots.slice(1).map((snapshot, index) => {
    const previous = snapshots[index];
    const kind = snapshot.ready === previous.ready
      ? "unchanged"
      : snapshot.ready
        ? "recovered"
        : "regressed";
    return {
      from: previous.at,
      to: snapshot.at,
      kind,
      fromStatus: previous.status,
      toStatus: snapshot.status,
      fromReady: previous.ready,
      toReady: snapshot.ready,
      action: snapshot.nextAction,
    };
  });
  const transitionCounts = transitions.reduce((counts, transition) => {
    counts.total += 1;
    counts[transition.kind] = (counts[transition.kind] ?? 0) + 1;
    return counts;
  }, {
    total: 0,
    recovered: 0,
    regressed: 0,
    unchanged: 0,
  });
  const readinessStreak = countTrailingSnapshots(snapshots, (snapshot) => snapshot.ready === currentSnapshot.ready);
  const exportReadyStreak = countTrailingSnapshots(snapshots, (snapshot) => snapshot.exportReady === currentSnapshot.exportReady);
  const blockedReasonCounts = snapshots.reduce((counts, snapshot) => {
    for (const reason of snapshot.blockedReasons ?? []) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
    return counts;
  }, {});
  const latestSnapshot = {
    at: currentSnapshot.at,
    jobId: currentSnapshot.jobId,
    status: currentSnapshot.status,
    auditStatus: currentSnapshot.auditStatus,
    ready: currentSnapshot.ready,
    handoffReady: currentSnapshot.handoffReady,
    exportReady: currentSnapshot.exportReady,
    adapterStatus: currentSnapshot.adapterStatus,
    blockedCount: currentSnapshot.blockedCount,
    nextAction: currentSnapshot.nextAction,
    timelineAction: currentSnapshot.timelineAction,
  };
  const exportCounters = {
    readySnapshots: snapshots.filter((snapshot) => snapshot.ready).length,
    blockedSnapshots: snapshots.filter((snapshot) => !snapshot.ready).length,
    handoffReadySnapshots: snapshots.filter((snapshot) => snapshot.handoffReady).length,
    exportReadySnapshots: snapshots.filter((snapshot) => snapshot.exportReady).length,
    totalEvidencePresent: sumBy(snapshots, "evidencePresent"),
    totalEvidenceMissing: sumBy(snapshots, "evidenceMissing"),
    totalExternalWrites: sumBy(snapshots, "externalWrites"),
    blockedReasonCounts,
  };
  const nextReportAction = statusModel.ready && exportSnapshot.truthBoundary.readyForExport
    ? "operator.status.export-summary"
    : timelineState.current.exportReady
      ? statusModel.primaryAction
      : "operator.status.refresh-timeline";

  return {
    kind: "mailchimp.operator-status.export-history",
    apiVersion: "aios.example/v1",
    exportId: exportSnapshot.exportId,
    window: {
      size: snapshots.length,
      firstAt: snapshots[0]?.at ?? null,
      lastAt: snapshots[snapshots.length - 1]?.at ?? null,
      limit: 10,
    },
    transitionCounts,
    transitions,
    readinessStreak: {
      value: currentSnapshot.ready,
      count: readinessStreak,
    },
    exportReadyStreak: {
      value: currentSnapshot.exportReady,
      count: exportReadyStreak,
    },
    latestSnapshot,
    exportCounters,
    nextReportAction,
  };
}

function buildOperatorAnalyticsTimelineEvents(snapshots, timelineState, statusModel) {
  const snapshotEvents = snapshots.map((snapshot, index) => ({
    id: `operator-status-analytics:${index + 1}`,
    at: snapshot.at,
    type: snapshot.ready ? "ready" : "blocked",
    status: snapshot.status,
    action: snapshot.nextAction,
    exportReady: snapshot.exportReady,
    handoffReady: snapshot.handoffReady,
    adapterStatus: snapshot.adapterStatus,
    blockedCount: snapshot.blockedCount,
  }));
  const currentEvent = {
    id: "operator-status-analytics:current",
    at: snapshots[snapshots.length - 1]?.at ?? "logical:current",
    type: statusModel.ready ? "handoff-ready" : "handoff-blocked",
    status: statusModel.visibleStatus,
    action: statusModel.primaryAction,
    exportReady: timelineState.current.exportReady,
    handoffReady: statusModel.ready,
    adapterStatus: statusModel.adapter.status,
    blockedCount: statusModel.blockedReasons.length,
  };
  return [...snapshotEvents.slice(-4), currentEvent];
}

function buildStatusNextSteps(statusModel, previewAcceptance) {
  if (previewAcceptance.readiness.ready) {
    return [{
      action: previewAcceptance.nextAction.command,
      label: previewAcceptance.nextAction.label,
      reason: previewAcceptance.nextAction.reason,
    }];
  }
  return previewAcceptance.readiness.blockedReasons.map((reason) => ({
    action: reason.includes("acceptance")
      ? "operator.status.accept-preview"
      : statusModel.controls.nextAction,
    label: reason.includes("acceptance")
      ? "Accept operator status preview"
      : "Resolve operator status blocker",
    reason,
  }));
}

function buildOperatorRouteDecisionPacket(
  program,
  audit,
  timelineState,
  statusModel,
  previewAcceptance,
  recoveryHandoff,
  providerServiceManifest,
  analytics,
  lifecycleControls,
  options,
) {
  const routeName = String(options.routeName ?? "mailchimp.operator-status.preview");
  const requestId = String(options.requestId ?? `${program.job.id}:operator-route:${previewAcceptance.preview.visibleStatus}`);
  const packetKey = String(options.routeDecisionPacketKey ?? `${program.job.memory.namespace}:operator-status:route:${requestId}`);
  const acceptedEvidence = getAcceptedEvidence(audit);
  const visibleBlockers = uniqueSorted([
    ...previewAcceptance.readiness.blockedReasons,
    ...recoveryHandoff.blockedReasons,
    ...providerServiceManifest.validation.blockers,
  ]);
  const sections = [
    {
      id: "preview",
      label: "Preview",
      status: previewAcceptance.readiness.ready ? "ready" : "review",
      rows: previewAcceptance.preview.rows.map((row) => ({
        id: row.id,
        label: row.label,
        value: row.value,
        severity: row.severity,
      })),
      explanation: previewAcceptance.nextAction.reason,
    },
    {
      id: "readiness",
      label: "Readiness",
      status: statusModel.ready ? "ready" : "blocked",
      rows: previewAcceptance.preview.validationCards.map((card) => ({
        id: card.key,
        label: card.label,
        value: card.status,
        severity: card.status === "ready" ? "ready" : "review",
        detail: card.detail,
      })),
      explanation: statusModel.ready
        ? "Runtime, adapter, lifecycle, and evidence checks are ready."
        : statusModel.disabledReason,
    },
    {
      id: "handoff",
      label: "Handoff",
      status: providerServiceManifest.validation.ready && recoveryHandoff.ready ? "ready" : "blocked",
      rows: [
        {
          id: "provider-service",
          label: "Provider service",
          value: providerServiceManifest.serviceState.status,
          severity: providerServiceManifest.validation.ready ? "ready" : "blocked",
        },
        {
          id: "recovery",
          label: "Recovery",
          value: recoveryHandoff.summary.nextAction,
          severity: recoveryHandoff.ready ? "ready" : "review",
        },
        {
          id: "analytics",
          label: "Trend",
          value: analytics.timelineReport.trend,
          severity: analytics.timelineReport.trend === "regressed" ? "review" : "ready",
        },
      ],
      explanation: providerServiceManifest.validation.summary,
    },
  ];
  const ready = visibleBlockers.length === 0
    && previewAcceptance.readiness.ready
    && providerServiceManifest.validation.ready
    && recoveryHandoff.ready;
  const primaryCommand = ready
    ? previewAcceptance.nextAction.command
    : previewAcceptance.acceptance.required && !previewAcceptance.acceptance.accepted
      ? "operator.status.accept-preview"
      : visibleBlockers.some((reason) => reason.includes("adapter status"))
        ? "operator.status.wait-for-adapter"
        : lifecycleControls.nextAction;
  const secondaryCommand = ready
    ? "operator.status.refresh"
    : providerServiceManifest.commands.sync.command;
  const nextSteps = ready
    ? [{
      id: "render-operator-status",
      command: primaryCommand,
      label: "Render operator status",
      enabled: true,
      explains: "The preview has been accepted when required and the provider service can receive the status handoff.",
    }]
    : visibleBlockers.slice(0, 5).map((reason, index) => ({
      id: `operator-route-step:${index + 1}`,
      command: reason.includes("acceptance")
        ? "operator.status.accept-preview"
        : reason.includes("adapter status")
          ? "operator.status.wait-for-adapter"
          : lifecycleControls.nextAction,
      label: reason.includes("acceptance")
        ? "Accept operator status preview"
        : reason.includes("adapter status")
          ? "Wait for Mailchimp adapter"
          : "Review operator status",
      enabled: true,
      explains: reason,
    }));

  return {
    kind: "mailchimp.operator-status.route-decision-packet",
    apiVersion: "aios.client/v1",
    packetKey,
    request: {
      requestId,
      routeName,
      jobId: program.job.id,
      campaignId: statusModel.observedStatus.campaignId,
      packageName: program.manifest.name,
    },
    preview: {
      status: ready ? "ready" : "review_required",
      title: previewAcceptance.preview.title,
      badge: statusModel.badge,
      visibleStatus: statusModel.visibleStatus,
      sections,
    },
    acceptance: {
      required: previewAcceptance.acceptance.required,
      accepted: previewAcceptance.acceptance.accepted,
      receipt: previewAcceptance.acceptance.receipt,
      decisionCommand: previewAcceptance.acceptance.accepted
        ? null
        : "operator.status.accept-preview",
    },
    validation: {
      ready,
      blockers: visibleBlockers,
      summary: ready
        ? "Operator status preview is ready for route handoff."
        : `Operator status route requires review: ${visibleBlockers[0] ?? "unknown blocker"}`,
      counters: {
        evidencePresent: acceptedEvidence.length,
        evidenceMissing: audit.evidence.missing.length,
        externalWrites: audit.boundary.externalWritesObserved.length,
        validationCards: previewAcceptance.preview.validationCards.length,
        blockedSections: sections.filter((section) => section.status !== "ready").length,
      },
    },
    commands: {
      primary: {
        command: primaryCommand,
        enabled: ready || primaryCommand === "operator.status.accept-preview",
        idempotencyKey: `${packetKey}:primary:${primaryCommand}`,
      },
      secondary: {
        command: secondaryCommand,
        enabled: true,
        idempotencyKey: `${packetKey}:secondary:${secondaryCommand}`,
      },
      refresh: {
        command: "operator.status.refresh",
        enabled: lifecycleControls.allowedCommands.includes("operator.status.refresh"),
        idempotencyKey: `${packetKey}:refresh:${timelineState.nextAction}`,
      },
    },
    handoff: {
      providerManifestKey: providerServiceManifest.manifestKey,
      providerCommand: providerServiceManifest.commands.sync.command,
      recoveryToken: recoveryHandoff.resumeToken,
      handoffToken: ready ? providerServiceManifest.externalHandoffState.handoffToken : null,
      nextAction: ready ? "route-operator-status" : "route-operator-status-review",
    },
    nextSteps,
    summary: {
      ready,
      routeName,
      packetKey,
      primaryCommand,
      blockedCount: visibleBlockers.length,
      sectionCount: sections.length,
      nextStepCount: nextSteps.length,
    },
  };
}

function normalizeOperatorPreviewRows(rows = [], statusModel, timelineState) {
  const sourceRows = Array.isArray(rows) && rows.length > 0
    ? rows
    : [
      {
        id: "runtime",
        label: "Runtime status",
        value: statusModel.visibleStatus,
        severity: statusModel.ready ? "ready" : "review",
      },
      {
        id: "adapter",
        label: "Mailchimp adapter",
        value: statusModel.adapter.status,
        severity: statusModel.adapter.status === "healthy" ? "ready" : "blocked",
      },
      {
        id: "timeline",
        label: "Timeline action",
        value: timelineState.nextAction,
        severity: timelineState.current.exportReady ? "ready" : "review",
      },
    ];
  return sourceRows.slice(0, 8).map((row, index) => ({
    id: String(row.id ?? `operator-preview:${index + 1}`),
    label: String(row.label ?? row.id ?? `Row ${index + 1}`),
    value: String(row.value ?? row.status ?? "unknown"),
    severity: normalizePreviewSeverity(row.severity ?? row.status ?? "review"),
    detail: row.detail ? String(row.detail) : null,
  }));
}

function normalizePreviewSeverity(value) {
  const severity = String(value ?? "review").trim().toLowerCase();
  if (!["ready", "review", "blocked", "missing"].includes(severity)) {
    return "review";
  }
  return severity;
}

function normalizeAdapterStatus(status = "healthy", retryAfterSeconds = 30) {
  const normalized = String(status ?? "healthy").trim().toLowerCase();
  if (!["healthy", "degraded", "offline"].includes(normalized)) {
    throw new Error(`unsupported adapter status: ${status}`);
  }
  return {
    name: "mailchimp.v1",
    status: normalized,
    handoff: normalized === "healthy" ? "available" : normalized === "degraded" ? "deferred" : "blocked",
    retryAfterSeconds: normalized === "degraded" ? Number(retryAfterSeconds) : null,
  };
}

function normalizeRecoveryPolicy(policy = {}) {
  const sourceDirective = parseRecoveryDirective(operatorStatusJobSource);
  const rollback = String(policy.rollback ?? sourceDirective.rollback ?? "snapshot").trim().toLowerCase();
  const retryLimit = normalizeIntegerRange(policy.retryLimit ?? policy.retry ?? sourceDirective.retryLimit ?? 1, "recoveryRetryLimit", 0, 10);
  const retryWindowSeconds = normalizeIntegerRange(policy.retryWindowSeconds ?? 300, "recoveryRetryWindowSeconds", 15, 86400);
  const errors = [];
  if (!["snapshot", "none"].includes(rollback)) {
    errors.push(`unsupported operator status recovery rollback: ${rollback}`);
  }
  return {
    valid: errors.length === 0,
    errors,
    rollback,
    retryLimit,
    retryWindowSeconds,
    sourceDirective,
  };
}

function parseRecoveryDirective(source) {
  const recoverLine = String(source)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("recover "));
  if (!recoverLine) {
    return {
      rollback: "none",
      retryLimit: 0,
      tokens: [],
    };
  }
  const tokens = recoverLine
    .slice("recover ".length)
    .split(/\s+/)
    .filter(Boolean);
  const pairs = Object.fromEntries(tokens.map((token) => {
    const [key, ...rest] = token.split("=");
    return [key, rest.join("=") || true];
  }));
  return {
    rollback: String(pairs.rollback ?? "none").trim().toLowerCase(),
    retryLimit: Number.parseInt(pairs.retry ?? "0", 10),
    tokens,
  };
}

function normalizeRecoveryAttempts(attempts = []) {
  if (!Array.isArray(attempts)) {
    return [];
  }
  return attempts.slice(-10).map((attempt, index) => ({
    id: String(attempt.id ?? `recovery-attempt:${index + 1}`),
    at: String(attempt.at ?? `logical:recovery:${index + 1}`),
    status: normalizeRecoveryAttemptStatus(attempt.status),
    reason: String(attempt.reason ?? attempt.error ?? "operator status recovery attempt"),
    checkpoint: attempt.checkpoint ? String(attempt.checkpoint) : null,
  }));
}

function normalizeRecoveryAttemptStatus(status) {
  const normalized = String(status ?? "failed").trim().toLowerCase();
  if (["queued", "running", "failed", "recovered", "rolled-back"].includes(normalized)) {
    return normalized;
  }
  return "failed";
}

function normalizeOperatorProviderAckStatus(value) {
  const status = String(value ?? "pending").trim().toLowerCase();
  if (!["pending", "acknowledged", "failed", "rejected"].includes(status)) {
    throw new Error(`unsupported operator provider ack status: ${value}`);
  }
  return status;
}

function operatorProviderFingerprint(parts) {
  return parts
    .map((part) => String(part ?? "null").replaceAll("|", "%7C"))
    .join("|");
}

function getAcceptedEvidence(audit) {
  if (Array.isArray(audit?.evidence?.accepted)) {
    return audit.evidence.accepted;
  }
  if (Array.isArray(audit?.evidence?.present)) {
    return audit.evidence.present;
  }
  return [];
}

function normalizeOperatorSchedule(schedule = { mode: "manual" }) {
  const mode = String(schedule.mode ?? "manual").trim().toLowerCase();
  const errors = [];
  if (!["manual", "interval", "cron"].includes(mode)) {
    errors.push(`unsupported operator status schedule mode: ${mode}`);
  }
  if (mode === "interval") {
    const everySeconds = Number(schedule.everySeconds ?? schedule.everyMinutes * 60);
    if (!Number.isInteger(everySeconds) || everySeconds < 30) {
      errors.push("operator status interval schedule requires everySeconds >= 30");
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
      errors.push("operator status cron schedule requires a cron expression");
    }
    return {
      valid: errors.length === 0,
      value: { mode, expression: expression || null },
      errors,
    };
  }
  return {
    valid: errors.length === 0,
    value: { mode: "manual" },
    errors,
  };
}

function normalizeIntegerRange(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function normalizeHistory(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history.map((snapshot, index) => ({
    at: String(snapshot.at ?? `history:${index}`),
    jobId: String(snapshot.jobId ?? "unknown"),
    status: String(snapshot.status ?? snapshot.visibleStatus ?? "unknown"),
    auditStatus: String(snapshot.auditStatus ?? "unknown"),
    ready: Boolean(snapshot.ready),
    blockedCount: Number(snapshot.blockedCount ?? 0),
    blockedReasons: uniqueSorted(snapshot.blockedReasons ?? []),
    evidencePresent: Number(snapshot.evidencePresent ?? 0),
    evidenceMissing: Number(snapshot.evidenceMissing ?? 0),
    externalWrites: Number(snapshot.externalWrites ?? 0),
    nextAction: String(snapshot.nextAction ?? snapshot.action ?? "operator.status.review"),
    adapterStatus: normalizeHistoryAdapterStatus(snapshot.adapterStatus ?? snapshot.adapter?.status),
    exportReady: Boolean(snapshot.exportReady ?? snapshot.ready),
    timelineAction: String(snapshot.timelineAction ?? snapshot.timeline?.currentAction ?? snapshot.nextAction ?? "operator.status.review"),
    handoffReady: Boolean(snapshot.handoffReady ?? (snapshot.ready && (snapshot.exportReady ?? true))),
  }));
}

function normalizeHistoryAdapterStatus(status) {
  const normalized = String(status ?? "unknown").trim().toLowerCase();
  if (["healthy", "degraded", "offline", "unknown"].includes(normalized)) {
    return normalized;
  }
  return "unknown";
}

function countTrailingSnapshots(values, predicate) {
  let count = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (!predicate(values[index])) {
      break;
    }
    count += 1;
  }
  return count;
}

function sumBy(values, key) {
  return values.reduce((total, value) => total + Number(value[key] ?? 0), 0);
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
