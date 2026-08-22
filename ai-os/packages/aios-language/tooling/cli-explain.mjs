import { buildAiosCliCheckContract } from "./cli-check.mjs";
import { buildAiosCliCompileContract, summarizeAiosCliCompileContract } from "./cli-compile.mjs";

const EXPLAIN_CONTRACT_PROTOCOL = "aios.language.cli-explain-contract.v1";

function diagnostic(severity, code, message, path = "$") {
  return Object.freeze({ severity, code, message, path });
}

function explainStatus(statusHandoff) {
  if (statusHandoff.state === "blocked") {
    return "The source compiled into a blocked runtime handoff. Repair blocking diagnostics before dispatch.";
  }
  if (statusHandoff.state === "waiting-for-adapter") {
    return "The source compiled into an external adapter handoff and needs provider acceptance before runtime dispatch.";
  }
  return "The source compiled into a runtime-ready AI OS contract.";
}

function explainRecovery(recoveryHandoff) {
  if (recoveryHandoff.recoverable) {
    return `Recovery can resume with ${recoveryHandoff.strategy} using the deterministic resume token.`;
  }
  return "Recovery requires operator repair before the runtime adapter can resume.";
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function createSettingsValidation(options, compileContract, checkContract) {
  const settings = options.explainSettings ?? options.settings ?? {};
  const mode = cleanText(settings.mode) || "operator";
  const schedule = cleanText(settings.schedule) || "manual";
  const enabled = settings.enabled !== false;
  const validModes = new Set(["operator", "audit", "runtime"]);
  const validSchedules = new Set(["manual", "on-check", "on-adapter-ready"]);
  const diagnostics = [];

  if (!validModes.has(mode)) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_EXPLAIN_MODE_INVALID", "Explain settings mode must be operator, audit, or runtime.", "$.lifecycle.settings.mode"));
  }
  if (!validSchedules.has(schedule)) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_EXPLAIN_SCHEDULE_INVALID", "Explain schedule must be manual, on-check, or on-adapter-ready.", "$.lifecycle.settings.schedule"));
  }
  if (schedule === "on-adapter-ready" && compileContract.statusHandoff.state === "blocked") {
    diagnostics.push(diagnostic("warning", "AIOS_CLI_EXPLAIN_SCHEDULE_BLOCKED", "Adapter-ready explanation is paused while the compile handoff is blocked.", "$.lifecycle.schedule"));
  }
  if (mode === "runtime" && checkContract.operationalHealth.status === "unhealthy") {
    diagnostics.push(diagnostic("warning", "AIOS_CLI_EXPLAIN_RUNTIME_UNHEALTHY", "Runtime explanations are disabled until operational health recovers.", "$.lifecycle.controls"));
  }

  return Object.freeze({
    valid: diagnostics.filter((entry) => entry.severity === "error").length === 0,
    diagnostics: Object.freeze(diagnostics),
    settings: Object.freeze({
      enabled,
      mode,
      schedule,
    }),
  });
}

function createLifecycleState(compileContract, checkContract, settingsValidation) {
  const health = checkContract.operationalHealth;
  const boundary = compileContract.boundaryProfile;
  const settings = settingsValidation.settings;
  const enabled = settings.enabled && settingsValidation.valid && health.status !== "unhealthy";
  const paused = settings.enabled && !enabled;
  const canSchedule = enabled && settings.schedule !== "manual";
  const disableReasons = [
    ...(!settings.enabled ? ["operator-disabled"] : []),
    ...(!settingsValidation.valid ? ["settings-invalid"] : []),
    ...(health.status === "unhealthy" ? [health.failureState] : []),
    ...(boundary?.state === "blocked" ? ["boundary-blocked"] : []),
  ];
  const nextAction = enabled
    ? canSchedule
      ? settings.schedule === "on-adapter-ready"
        ? "schedule-explain-after-adapter-acceptance"
        : "schedule-explain-after-check"
      : "show-cli-explanation"
    : disableReasons.includes("settings-invalid")
      ? "repair-explain-settings"
      : health.nextAction;

  return Object.freeze({
    protocol: "aios.language.cli-explain-lifecycle.v1",
    settings,
    controls: Object.freeze({
      enabled,
      paused,
      canEnable: settingsValidation.valid && health.status !== "unhealthy",
      canDisable: true,
      canSchedule,
    }),
    schedule: Object.freeze({
      mode: settings.schedule,
      queued: canSchedule,
      blockedBy: Object.freeze(disableReasons),
      resumeWhen: health.status === "unhealthy" ? health.failureState : boundary?.state === "review-required" ? "adapter-accepted" : "operator-request",
    }),
    boundary: boundary ? Object.freeze({
      state: boundary.state,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      auditHandoffId: boundary.audit.handoffId,
    }) : null,
    health: Object.freeze({
      status: health.status,
      degradedMode: health.degradedMode,
      failureState: health.failureState,
    }),
    nextAction,
  });
}

function createProviderServiceContract(compileContract, checkContract, lifecycle) {
  const readiness = compileContract.statusHandoff.providerReadiness;
  const providerName = cleanText(compileContract.statusHandoff.provider) || "mailchimp";
  const capabilities = compileContract.compileResult.capabilityManifest.map((capability) => Object.freeze({
    name: capability.name,
    mode: capability.mode ?? capability.scope ?? "use",
    provider: capability.target ?? providerName,
    negotiable: readiness?.required === true,
  }));
  const requiredCapabilities = Object.freeze(capabilities
    .filter((capability) => capability.provider === providerName || readiness?.required === true)
    .map((capability) => capability.name));
  const missingCapabilities = Object.freeze(readiness?.state === "blocked"
    ? requiredCapabilities
    : []);
  const providerEntries = Object.freeze((readiness?.providers ?? []).map((entry) => Object.freeze({
    provider: entry.provider,
    status: entry.status,
    accepted: entry.accepted,
    degraded: entry.degraded,
    statusChannel: entry.statusChannel,
    capabilityHandshake: entry.capabilityHandshake,
    message: entry.message,
  })));
  const negotiationState = readiness?.state === "ready" || readiness?.state === "not-required"
    ? "accepted"
    : readiness?.state === "blocked"
      ? "blocked"
      : "pending";
  const syncState = readiness?.handoff?.syncState ?? "not-required";
  const externalHandoffRequired = readiness?.required === true && readiness.state !== "ready";
  const canSync = lifecycle.controls.enabled && checkContract.operationalHealth.status !== "unhealthy" && readiness?.state !== "blocked";
  const nextAction = readiness?.actionableErrors?.[0]?.nextAction
    || (externalHandoffRequired
      ? readiness.retry.retryable ? "poll-provider-status-after-backoff" : "request-adapter-acceptance"
      : lifecycle.nextAction);

  return Object.freeze({
    protocol: "aios.language.cli-provider-service-contract.v1",
    service: Object.freeze({
      provider: providerName,
      target: compileContract.compileResult.target,
      command: "explain",
      sourceHash: compileContract.source.sourceHash,
    }),
    negotiation: Object.freeze({
      state: negotiationState,
      requiredCapabilities,
      missingCapabilities,
      capabilityCount: capabilities.length,
      providers: providerEntries,
    }),
    sync: Object.freeze({
      state: syncState,
      required: externalHandoffRequired,
      canSync,
      channel: readiness?.handoff?.channel ?? null,
      correlationId: readiness?.handoff?.correlationId ?? null,
      retryAfterMs: readiness?.retry?.retryAfterMs ?? null,
      backoff: readiness?.retry?.backoff ?? "none",
    }),
    externalHandoff: Object.freeze({
      required: externalHandoffRequired,
      blocked: readiness?.state === "blocked",
      degraded: readiness?.state === "degraded",
      pendingProviders: readiness?.pendingProviders ?? Object.freeze([]),
      degradedProviders: readiness?.degradedProviders ?? Object.freeze([]),
      failedProviders: readiness?.failedProviders ?? Object.freeze([]),
    }),
    nextAction,
  });
}

function createClientRuntimeHandoff(compileContract, checkContract, lifecycle, providerService) {
  const reviewGate = compileContract.reviewGate;
  const health = checkContract.operationalHealth;
  const status = compileContract.statusHandoff;
  const readyForRuntime = status.acceptedForRuntime === true
    && checkContract.ok === true
    && lifecycle.controls.enabled === true
    && providerService.externalHandoff.blocked !== true
    && reviewGate?.acceptance.accepted === true;
  const visibleWarnings = Object.freeze([
    ...(health.status === "degraded" ? ["operational-health-degraded"] : []),
    ...(providerService.externalHandoff.degraded ? ["provider-degraded"] : []),
    ...(reviewGate?.schedule.queued ? ["compile-review-scheduled"] : []),
    ...(lifecycle.schedule.queued ? ["explanation-scheduled"] : []),
  ]);
  const blockedReasons = Object.freeze([
    ...(checkContract.ok !== true ? ["check-not-passing"] : []),
    ...(lifecycle.controls.enabled !== true ? ["explain-lifecycle-disabled"] : []),
    ...(providerService.externalHandoff.blocked ? ["provider-blocked"] : []),
    ...(reviewGate?.controls.canPreview !== true ? ["preview-not-ready"] : []),
    ...(reviewGate?.acceptance.accepted !== true ? ["compile-review-not-accepted"] : []),
  ]);
  const nextAction = readyForRuntime
    ? "adopt-explanation-in-runtime-client"
    : blockedReasons.includes("compile-review-not-accepted") && reviewGate?.nextAction
      ? reviewGate.nextAction
      : providerService.nextAction || lifecycle.nextAction || checkContract.nextAction;

  return Object.freeze({
    protocol: "aios.language.cli-client-runtime-handoff.v1",
    state: readyForRuntime
      ? "ready"
      : blockedReasons.length > 0
        ? "blocked"
        : visibleWarnings.length > 0
          ? "degraded"
          : "preview",
    readyForRuntime,
    request: Object.freeze({
      command: "explain",
      sourceHash: compileContract.source.sourceHash,
      tenantId: compileContract.boundaryProfile?.tenantId ?? "local",
      workspaceId: compileContract.boundaryProfile?.workspaceId ?? "default",
      provider: status.provider,
      clientRequestId: `${compileContract.source.sourceHash}:explain`,
      idempotencyKey: `${compileContract.source.sourceHash}:${providerService.negotiation.state}:${lifecycle.settings.mode}`,
    }),
    clientState: Object.freeze({
      visibleStatus: status.visibleStatus,
      explanationEnabled: lifecycle.controls.enabled,
      scheduleQueued: lifecycle.schedule.queued || reviewGate?.schedule.queued === true,
      healthStatus: health.status,
      providerNegotiationState: providerService.negotiation.state,
      providerSyncState: providerService.sync.state,
      reviewGateState: reviewGate?.acceptance.accepted === true
        ? "accepted"
        : reviewGate?.schedule.queued === true
          ? "scheduled"
          : reviewGate?.controls.enabled === true
            ? "enabled"
            : "paused",
      warnings: visibleWarnings,
      blockedReasons,
    }),
    runtimeData: Object.freeze({
      sections: Object.freeze(["compile", "check", "recovery", "provider", "boundary"]),
      reportNames: Object.freeze({
        compile: compileContract.analytics?.exportSummary?.reportName ?? "compile-report.json",
        check: checkContract.analytics?.exportSummary?.reportName ?? "check-report.json",
      }),
      resumeToken: compileContract.recoveryHandoff.resumeToken,
      providerCorrelationId: providerService.sync.correlationId,
      auditHandoffId: compileContract.boundaryProfile?.audit.handoffId ?? null,
    }),
    handoff: Object.freeze({
      channel: providerService.sync.channel ?? `${status.provider}:runtime-client`,
      externalRequired: providerService.externalHandoff.required,
      canSync: providerService.sync.canSync,
      retryAfterMs: providerService.sync.retryAfterMs,
      nextAction,
    }),
    nextAction,
  });
}

function createMailchimpExplainPersistence(compileContract, checkContract, lifecycle, providerService, clientRuntime) {
  const provider = compileContract.mailchimpProvider;
  const preview = checkContract.mailchimpPreview;
  const sourceHash = compileContract.source.sourceHash;
  const baseKey = [
    sourceHash,
    provider?.sync?.externalStateKey ?? "local",
    providerService.negotiation.state,
    lifecycle.settings.mode,
  ].join(":");
  const blockedReasons = Object.freeze([
    ...(clientRuntime.state === "blocked" ? clientRuntime.clientState.blockedReasons : []),
    ...(provider?.state === "identity-required" ? ["mailchimp-identity-required"] : []),
    ...(provider?.state === "capability-gap" ? ["mailchimp-capability-gap"] : []),
    ...(provider?.sync?.state === "blocked" ? ["mailchimp-sync-blocked"] : []),
  ]);
  const commandState = blockedReasons.length > 0
    ? "blocked"
    : clientRuntime.readyForRuntime
      ? "ready"
      : providerService.sync.required
        ? "waiting-for-provider-sync"
        : "preview";
  const commands = Object.freeze([
    Object.freeze({
      id: "explain.mailchimp.preview",
      state: preview?.acceptable ? "ready" : "pending",
      idempotencyKey: `${baseKey}:preview`,
      checkpoint: `${sourceHash}:mailchimp-preview`,
      replayable: true,
      nextAction: preview?.nextStep?.action ?? "show-cli-explanation",
    }),
    Object.freeze({
      id: "explain.mailchimp.sync",
      state: providerService.sync.canSync ? "ready" : providerService.sync.required ? "pending" : "skipped",
      idempotencyKey: `${baseKey}:sync:${providerService.sync.state}`,
      checkpoint: `${sourceHash}:mailchimp-sync`,
      replayable: providerService.sync.required,
      nextAction: providerService.sync.required ? providerService.nextAction : "skip-provider-sync",
    }),
    Object.freeze({
      id: "explain.mailchimp.runtime",
      state: commandState,
      idempotencyKey: `${baseKey}:runtime:${clientRuntime.state}`,
      checkpoint: `${sourceHash}:mailchimp-runtime-client`,
      replayable: clientRuntime.state !== "blocked",
      nextAction: clientRuntime.nextAction,
    }),
  ]);
  const resumeToken = `${sourceHash}:${providerService.sync.state}:${clientRuntime.state}`;

  return Object.freeze({
    protocol: "aios.language.cli-explain-mailchimp-persistence.v1",
    restartSafe: commands.every((command) => command.replayable || command.state === "skipped" || command.state === "blocked"),
    state: commandState,
    resumeToken,
    commands,
    checkpoints: Object.freeze(commands.map((command) => Object.freeze({
      id: command.checkpoint,
      commandId: command.id,
      state: command.state,
      idempotencyKey: command.idempotencyKey,
    }))),
    externalState: Object.freeze({
      provider: provider?.provider ?? providerService.service.provider,
      accountId: provider?.identity?.accountId ?? null,
      audienceId: provider?.identity?.audienceId ?? null,
      campaignId: provider?.identity?.campaignId ?? null,
      syncState: providerService.sync.state,
      syncChannel: providerService.sync.channel,
      correlationId: providerService.sync.correlationId,
      externalStateKey: provider?.sync?.externalStateKey ?? null,
    }),
    recovery: Object.freeze({
      recoverable: commandState !== "blocked" && compileContract.recoveryHandoff.recoverable === true,
      blockedReasons,
      retryAfterMs: providerService.sync.retryAfterMs,
      nextAction: blockedReasons[0]
        ? clientRuntime.nextAction
        : providerService.sync.required
          ? providerService.nextAction
          : "resume-mailchimp-explain-client",
    }),
  });
}

function createSections(compileContract, checkContract) {
  const summary = summarizeAiosCliCompileContract(compileContract);
  const failedChecks = checkContract.checks.filter((check) => !check.passed);
  return Object.freeze([
    Object.freeze({
      id: "compile",
      title: "Compile Contract",
      status: summary.status,
      body: explainStatus(compileContract.statusHandoff),
      facts: Object.freeze({
        sourceHash: summary.sourceHash,
        descriptors: summary.descriptors,
        capabilities: summary.capabilities,
        runtimeReady: summary.runtimeReady,
      }),
    }),
    Object.freeze({
      id: "check",
      title: "Validation",
      status: checkContract.status,
      body: failedChecks.length > 0
        ? `Validation found ${failedChecks.length} check item(s) that need attention.`
        : "Validation checks passed for the CLI contract envelope.",
      facts: Object.freeze({
        failedRequired: failedChecks.filter((check) => check.required).length,
        advisory: failedChecks.filter((check) => !check.required).length,
        nextAction: checkContract.nextAction,
      }),
    }),
    Object.freeze({
      id: "recovery",
      title: "Recovery Handoff",
      status: compileContract.recoveryHandoff.strategy,
      body: explainRecovery(compileContract.recoveryHandoff),
      facts: Object.freeze({
        recoverable: compileContract.recoveryHandoff.recoverable,
        restartSafe: compileContract.recoveryHandoff.restartSafe,
        resumeToken: compileContract.recoveryHandoff.resumeToken,
      }),
    }),
    Object.freeze({
      id: "provider",
      title: "Provider Handoff",
      status: compileContract.statusHandoff.providerReadiness?.state ?? "unknown",
      body: compileContract.statusHandoff.providerReadiness?.required
        ? "Provider readiness and sync metadata are represented for the external CLI handoff."
        : "No external provider acceptance is required for this CLI contract.",
      facts: Object.freeze({
        provider: compileContract.statusHandoff.provider,
        syncState: compileContract.statusHandoff.providerReadiness?.handoff?.syncState ?? "not-required",
        retryAfterMs: compileContract.statusHandoff.providerReadiness?.retry?.retryAfterMs ?? null,
        nextAction: compileContract.statusHandoff.providerReadiness?.nextAction,
      }),
    }),
    Object.freeze({
      id: "review",
      title: "Review Gate",
      status: compileContract.reviewGate?.acceptance.accepted ? "accepted" : compileContract.reviewGate?.nextAction ?? "unknown",
      body: compileContract.reviewGate?.acceptance.accepted
        ? "Compile lifecycle review accepted the runtime handoff."
        : "Compile lifecycle review is carrying the next action for preview, acceptance, or scheduling.",
      facts: Object.freeze({
        enabled: compileContract.reviewGate?.controls.enabled,
        canPreview: compileContract.reviewGate?.controls.canPreview,
        canAccept: compileContract.reviewGate?.controls.canAccept,
        queued: compileContract.reviewGate?.schedule.queued,
        nextAction: compileContract.reviewGate?.nextAction,
      }),
    }),
    Object.freeze({
      id: "boundary",
      title: "Tenant Boundary",
      status: compileContract.boundaryProfile?.state ?? "unknown",
      body: compileContract.boundaryProfile?.state === "blocked"
        ? "Tenant, workspace, or permission boundaries must be resolved before runtime handoff."
        : "Tenant and workspace boundaries are represented in the compiled CLI handoff.",
      facts: Object.freeze({
        tenantId: compileContract.boundaryProfile?.tenantId,
        workspaceId: compileContract.boundaryProfile?.workspaceId,
        permissionState: compileContract.boundaryProfile?.permissionState,
        auditRequired: compileContract.boundaryProfile?.audit.required,
      }),
    }),
  ]);
}

export function buildAiosCliExplainContract(source = "", options = {}) {
  const compileContract = options.compileContract ?? buildAiosCliCompileContract(source, options);
  const checkContract = options.checkContract ?? buildAiosCliCheckContract(source, {
    ...options,
    compileContract,
  });
  const sections = createSections(compileContract, checkContract);
  const settingsValidation = createSettingsValidation(options, compileContract, checkContract);
  const lifecycle = createLifecycleState(compileContract, checkContract, settingsValidation);
  const providerService = createProviderServiceContract(compileContract, checkContract, lifecycle);
  const clientRuntime = createClientRuntimeHandoff(compileContract, checkContract, lifecycle, providerService);
  const mailchimpPersistence = createMailchimpExplainPersistence(compileContract, checkContract, lifecycle, providerService, clientRuntime);
  const diagnostics = Object.freeze([
    ...checkContract.diagnostics,
    ...settingsValidation.diagnostics,
    ...(sections.length === 0
      ? [diagnostic("error", "AIOS_CLI_EXPLAIN_EMPTY", "Explain contract must include at least one section.")]
      : []),
  ]);

  return Object.freeze({
    protocol: EXPLAIN_CONTRACT_PROTOCOL,
    command: "explain",
    source: compileContract.source,
    summary: summarizeAiosCliCompileContract(compileContract),
    sections,
    lifecycle,
    providerService,
    clientRuntime,
    mailchimpPersistence,
    statusHandoff: Object.freeze({
      ...compileContract.statusHandoff,
      explainable: sections.length > 0,
      checkStatus: checkContract.status,
      lifecycleEnabled: lifecycle.controls.enabled,
      scheduleQueued: lifecycle.schedule.queued,
      providerNegotiationState: providerService.negotiation.state,
      providerSyncState: providerService.sync.state,
      clientRuntimeState: clientRuntime.state,
      mailchimpPersistenceState: mailchimpPersistence.state,
      mailchimpResumeToken: mailchimpPersistence.resumeToken,
      runtimeReady: clientRuntime.readyForRuntime,
      reviewGateState: clientRuntime.clientState.reviewGateState,
    }),
    recoveryHandoff: Object.freeze({
      ...compileContract.recoveryHandoff,
      explanation: explainRecovery(compileContract.recoveryHandoff),
      providerSync: providerService.sync,
      clientRuntime: clientRuntime.handoff,
      mailchimpPersistence: mailchimpPersistence.recovery,
      lifecycleNextAction: lifecycle.nextAction,
    }),
    diagnostics,
    nextAction: clientRuntime.nextAction,
  });
}

export function assertAiosCliExplainContractReady(contract) {
  const diagnostics = [];
  if (contract?.protocol !== EXPLAIN_CONTRACT_PROTOCOL) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_EXPLAIN_PROTOCOL_INVALID", "Explain contract protocol is missing or unsupported."));
  }
  if (!Array.isArray(contract?.sections) || contract.sections.length === 0) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_EXPLAIN_SECTIONS_REQUIRED", "Explain contract requires deterministic sections.", "$.sections"));
  }
  if (!contract?.lifecycle?.controls) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_EXPLAIN_LIFECYCLE_REQUIRED", "Explain contract requires lifecycle controls.", "$.lifecycle.controls"));
  }
  if (!contract?.providerService?.negotiation) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_EXPLAIN_PROVIDER_SERVICE_REQUIRED", "Explain contract requires provider service negotiation state.", "$.providerService.negotiation"));
  }
  if (!contract?.clientRuntime?.request) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_EXPLAIN_CLIENT_RUNTIME_REQUIRED", "Explain contract requires client runtime handoff state.", "$.clientRuntime.request"));
  }
  if (!contract?.mailchimpPersistence?.commands) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_EXPLAIN_MAILCHIMP_PERSISTENCE_REQUIRED", "Explain contract requires restart-safe Mailchimp persistence commands.", "$.mailchimpPersistence.commands"));
  }
  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    nextAction: diagnostics[0]?.code || contract?.nextAction || "show-cli-explanation",
  });
}

export { EXPLAIN_CONTRACT_PROTOCOL };
