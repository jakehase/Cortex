import {
  assertAiosCliCompileContractReady,
  buildAiosCliCompileContract,
  summarizeAiosCliCompileContract,
} from "./cli-compile.mjs";

const CHECK_CONTRACT_PROTOCOL = "aios.language.cli-check-contract.v1";

function cleanText(value) {
  return String(value ?? "").trim();
}

function diagnostic(severity, code, message, path = "$") {
  return Object.freeze({ severity, code, message, path });
}

function countDiagnostics(diagnostics = []) {
  return Object.freeze({
    error: diagnostics.filter((entry) => entry.severity === "error").length,
    warning: diagnostics.filter((entry) => entry.severity === "warning").length,
    info: diagnostics.filter((entry) => entry.severity === "info").length,
  });
}

function createProviderChecks(compileContract) {
  const readiness = compileContract.statusHandoff.providerReadiness;
  if (!readiness) {
    return Object.freeze([
      {
        id: "provider-readiness-present",
        passed: false,
        required: true,
        path: "$.statusHandoff.providerReadiness",
        nextAction: "rebuild-provider-readiness",
      },
    ]);
  }
  return Object.freeze([
    {
      id: "provider-handoff-not-failed",
      passed: readiness.failedProviders.length === 0,
      required: true,
      path: "$.statusHandoff.providerReadiness.failedProviders",
      nextAction: "repair-provider-handoff",
    },
    {
      id: "provider-sync-route-known",
      passed: readiness.required !== true || Boolean(readiness.handoff?.channel && readiness.handoff?.correlationId),
      required: true,
      path: "$.statusHandoff.providerReadiness.handoff",
      nextAction: "configure-provider-status-channel",
    },
    {
      id: "provider-backoff-actionable",
      passed: readiness.retry.retryable !== true || Number.isFinite(readiness.retry.retryAfterMs),
      required: false,
      path: "$.statusHandoff.providerReadiness.retry",
      nextAction: "wait-for-provider-backoff",
    },
    {
      id: "provider-degraded-mode-declared",
      passed: readiness.state !== "degraded" || readiness.degradedProviders.length > 0,
      required: false,
      path: "$.statusHandoff.providerReadiness.degradedProviders",
      nextAction: "record-provider-degraded-mode",
    },
  ]);
}

function createBoundaryChecks(compileContract) {
  const boundary = compileContract.boundaryProfile;
  if (!boundary) {
    return Object.freeze([
      {
        id: "boundary-profile-present",
        passed: false,
        required: true,
        path: "$.boundaryProfile",
        nextAction: "rebuild-boundary-profile",
      },
    ]);
  }
  return Object.freeze([
    {
      id: "tenant-boundary-isolated",
      passed: boundary.tenantIsolation.isolated === true,
      required: true,
      path: "$.boundaryProfile.tenantIsolation",
      nextAction: "resolve-cli-tenant-workspace-boundary",
    },
    {
      id: "permission-decision-complete",
      passed: boundary.permissionState !== "denied",
      required: true,
      path: "$.boundaryProfile.deniedPermissions",
      nextAction: "resolve-cli-permission-denial",
    },
    {
      id: "audit-handoff-routable",
      passed: boundary.audit.required !== true || Boolean(boundary.audit.channel && boundary.audit.handoffId),
      required: true,
      path: "$.boundaryProfile.audit",
      nextAction: "configure-cli-audit-handoff",
    },
  ]);
}

function createReviewGateChecks(compileContract) {
  const reviewGate = compileContract.reviewGate;
  if (!reviewGate) {
    return Object.freeze([
      {
        id: "review-gate-present",
        passed: false,
        required: true,
        path: "$.reviewGate",
        nextAction: "rebuild-compile-review-gate",
      },
    ]);
  }
  return Object.freeze([
    {
      id: "review-gate-settings-valid",
      passed: reviewGate.diagnostics.filter((entry) => entry.severity === "error").length === 0,
      required: true,
      path: "$.reviewGate.settings",
      nextAction: "repair-compile-lifecycle-settings",
    },
    {
      id: "review-gate-previewable",
      passed: reviewGate.controls.canPreview === true,
      required: true,
      path: "$.reviewGate.controls.canPreview",
      nextAction: "repair-preview-readiness",
    },
    {
      id: "review-gate-acceptance-routable",
      passed: reviewGate.controls.canAccept === true || reviewGate.controls.canSchedule === true || reviewGate.acceptance.runtimeReady !== true,
      required: false,
      path: "$.reviewGate.acceptance",
      nextAction: reviewGate.nextAction,
    },
    {
      id: "review-gate-schedule-deterministic",
      passed: Boolean(reviewGate.schedule.mode && reviewGate.schedule.resumeWhen && reviewGate.nextAction),
      required: true,
      path: "$.reviewGate.schedule",
      nextAction: "rebuild-compile-review-schedule",
    },
  ]);
}

function createOperationalHealth(compileContract, checks, diagnostics) {
  const boundary = compileContract.boundaryProfile;
  const providerReadiness = compileContract.statusHandoff.providerReadiness;
  const reviewGate = compileContract.reviewGate;
  const requiredFailures = checks.filter((check) => check.required && !check.passed);
  const advisoryFailures = checks.filter((check) => !check.required && !check.passed);
  const errorCount = diagnostics.filter((entry) => entry.severity === "error").length;
  const boundaryFailure = requiredFailures.find((check) => check.id.includes("boundary") || check.id.includes("permission") || check.id.includes("audit"));
  const providerFailure = requiredFailures.find((check) => check.id.includes("provider"));
  const compileFailure = requiredFailures.find((check) => check.id === "source-parses" || check.id === "kernel-contract-emitted");
  const status = errorCount > 0 || requiredFailures.length > 0
    ? "unhealthy"
    : advisoryFailures.length > 0 || compileContract.statusHandoff.state === "waiting-for-adapter" || providerReadiness?.state === "degraded"
      ? "degraded"
      : "healthy";
  const failureState = boundaryFailure
    ? "boundary-blocked"
    : providerFailure
      ? providerReadiness?.failureState ?? "provider-failed"
      : compileFailure
        ? "contract-invalid"
        : compileContract.statusHandoff.state === "waiting-for-adapter"
          ? providerReadiness?.failureState ?? "adapter-pending"
          : advisoryFailures.length > 0
            ? "advisory"
            : "none";
  const retryable = status !== "unhealthy" && compileContract.recoveryHandoff.recoverable === true;
  const retryAfterMs = providerReadiness?.retry?.retryAfterMs
    ?? (retryable
      ? compileContract.statusHandoff.state === "waiting-for-adapter" ? 5000 : 0
      : null);
  const actionableErrors = requiredFailures.map((check) => Object.freeze({
    code: `AIOS_CLI_ACTION_${check.id.toUpperCase().replaceAll("-", "_")}`,
    path: check.path,
    nextAction: check.nextAction,
  }));

  return Object.freeze({
    protocol: "aios.language.cli-operational-health.v1",
    status,
    failureState,
    degradedMode: status === "degraded",
    retry: Object.freeze({
      retryable,
      retryAfterMs,
      backoff: providerReadiness?.retry?.backoff ?? (retryable && retryAfterMs > 0 ? "fixed-adapter-poll" : "none"),
      retryLimit: compileContract.recoveryHandoff.retryLimit,
    }),
    provider: providerReadiness ? Object.freeze({
      state: providerReadiness.state,
      failureState: providerReadiness.failureState,
      required: providerReadiness.required,
      acceptedCount: providerReadiness.acceptedProviders.length,
      pendingCount: providerReadiness.pendingProviders.length,
      degradedCount: providerReadiness.degradedProviders.length,
      failedCount: providerReadiness.failedProviders.length,
      syncState: providerReadiness.handoff?.syncState ?? "not-required",
    }) : null,
    reviewGate: reviewGate ? Object.freeze({
      enabled: reviewGate.controls.enabled,
      canPreview: reviewGate.controls.canPreview,
      canAccept: reviewGate.controls.canAccept,
      canSchedule: reviewGate.controls.canSchedule,
      accepted: reviewGate.acceptance.accepted,
      scheduleQueued: reviewGate.schedule.queued,
      nextAction: reviewGate.nextAction,
    }) : null,
    boundary: boundary ? Object.freeze({
      state: boundary.state,
      permissionState: boundary.permissionState,
      isolated: boundary.tenantIsolation.isolated,
      auditRequired: boundary.audit.required,
    }) : null,
    actionableErrors: Object.freeze(actionableErrors),
    nextAction: actionableErrors[0]?.nextAction || compileContract.statusHandoff.nextAction,
  });
}

function createCheckItems(compileContract) {
  const compileReadiness = assertAiosCliCompileContractReady(compileContract);
  const compileSummary = summarizeAiosCliCompileContract(compileContract);
  const result = compileContract.compileResult;
  const status = compileContract.statusHandoff;
  const recovery = compileContract.recoveryHandoff;
  const checks = [
    {
      id: "source-parses",
      passed: compileContract.compiled.summary?.ok === true,
      required: true,
      path: "$.compiled.summary",
      nextAction: "repair-source-syntax",
    },
    {
      id: "kernel-contract-emitted",
      passed: (result.jobs?.length ?? 0) > 0,
      required: true,
      path: "$.compileResult.jobs",
      nextAction: "add-job-contract",
    },
    {
      id: "capability-contract-bound",
      passed: result.capabilityManifest.length > 0,
      required: true,
      path: "$.compileResult.capabilityManifest",
      nextAction: "declare-capability",
    },
    {
      id: "memory-contract-locality-known",
      passed: typeof result.memoryContract.localOnly === "boolean",
      required: true,
      path: "$.compileResult.memoryContract.localOnly",
      nextAction: "declare-memory-boundary",
    },
    {
      id: "verifier-or-recovery-present",
      passed: result.verifierContracts.length > 0 || recovery.recoverable === true,
      required: false,
      path: "$.compileResult.verifierContracts",
      nextAction: "add-verifier-contract",
    },
    {
      id: "status-handoff-deterministic",
      passed: Boolean(status.sourceHash && status.nextAction && status.visibleStatus),
      required: true,
      path: "$.statusHandoff",
      nextAction: "rebuild-status-handoff",
    },
    {
      id: "recovery-handoff-deterministic",
      passed: Boolean(recovery.resumeToken && recovery.strategy && recovery.nextAction),
      required: true,
      path: "$.recoveryHandoff",
      nextAction: "rebuild-recovery-handoff",
    },
    ...createProviderChecks(compileContract),
    ...createReviewGateChecks(compileContract),
    {
      id: "compile-contract-ready",
      passed: compileReadiness.ok,
      required: true,
      path: "$",
      nextAction: compileReadiness.nextAction,
    },
    ...createBoundaryChecks(compileContract),
  ];

  return Object.freeze(checks.map((check) => Object.freeze({
    ...check,
    status: check.passed ? "passed" : check.required ? "failed" : "advisory",
    summary: compileSummary,
  })));
}

function diagnosticsFromChecks(checks) {
  return Object.freeze(checks
    .filter((check) => !check.passed)
    .map((check) => diagnostic(
      check.required ? "error" : "warning",
      `AIOS_CLI_CHECK_${check.id.toUpperCase().replaceAll("-", "_")}`,
      `CLI check "${check.id}" did not pass.`,
      check.path,
    )));
}

function createCheckAnalytics(compileContract, checks, diagnostics, operationalHealth) {
  const readiness = compileContract.statusHandoff.providerReadiness;
  const reviewGate = compileContract.reviewGate;
  const counts = countDiagnostics(diagnostics);
  const failedRequired = checks.filter((check) => check.required && !check.passed);
  const advisory = checks.filter((check) => !check.required && !check.passed);
  const providerChecks = checks.filter((check) => check.id.startsWith("provider-"));
  const counters = Object.freeze({
    totalChecks: checks.length,
    passedChecks: checks.filter((check) => check.passed).length,
    failedRequiredChecks: failedRequired.length,
    advisoryChecks: advisory.length,
    providerCheckCount: providerChecks.length,
    providerFailedCount: readiness?.failedProviders.length ?? 0,
    providerPendingCount: readiness?.pendingProviders.length ?? 0,
    providerDegradedCount: readiness?.degradedProviders.length ?? 0,
    reviewGateEnabled: reviewGate?.controls.enabled === true ? 1 : 0,
    reviewGateAcceptable: reviewGate?.controls.canAccept === true ? 1 : 0,
    reviewGateScheduled: reviewGate?.schedule.queued === true ? 1 : 0,
    diagnosticErrorCount: counts.error,
    diagnosticWarningCount: counts.warning,
  });
  const history = Object.freeze([
    Object.freeze({
      id: "compile-status",
      sourceHash: compileContract.source.sourceHash,
      status: compileContract.statusHandoff.state,
      nextAction: compileContract.statusHandoff.nextAction,
      providerState: readiness?.state ?? "unknown",
      providerSyncState: readiness?.handoff?.syncState ?? "unknown",
      reviewGateNextAction: reviewGate?.nextAction ?? "unknown",
    }),
    Object.freeze({
      id: "check-evaluation",
      sourceHash: compileContract.source.sourceHash,
      status: failedRequired.length > 0 ? "failed" : advisory.length > 0 ? "advisory" : "passed",
      failedRequired: failedRequired.length,
      advisory: advisory.length,
      nextAction: failedRequired[0]?.nextAction || advisory[0]?.nextAction || compileContract.statusHandoff.nextAction,
    }),
    Object.freeze({
      id: "operational-health",
      sourceHash: compileContract.source.sourceHash,
      status: operationalHealth.status,
      failureState: operationalHealth.failureState,
      retryAfterMs: operationalHealth.retry.retryAfterMs,
      nextAction: operationalHealth.nextAction,
      reviewGateAccepted: reviewGate?.acceptance.accepted === true,
    }),
  ]);
  const timeline = Object.freeze(history.map((snapshot, index) => Object.freeze({
    order: index + 1,
    event: snapshot.id,
    status: snapshot.status,
    providerState: snapshot.providerState ?? readiness?.state ?? "unknown",
    nextAction: snapshot.nextAction ?? null,
  })));

  return Object.freeze({
    protocol: "aios.language.cli-check-analytics.v1",
    counters,
    history,
    timeline,
    exportSummary: Object.freeze({
      reportName: "check-report.json",
      compileReportName: compileContract.analytics?.exportSummary?.reportName ?? "compile-report.json",
      healthStatus: operationalHealth.status,
      failureState: operationalHealth.failureState,
      providerState: readiness?.state ?? "unknown",
      providerSyncState: readiness?.handoff?.syncState ?? "unknown",
      reviewGateState: reviewGate?.acceptance.accepted === true
        ? "accepted"
        : reviewGate?.schedule.queued === true
          ? "scheduled"
          : reviewGate?.controls.enabled === true
            ? "enabled"
            : "paused",
      reviewGateNextAction: reviewGate?.nextAction,
      requiredPassed: failedRequired.length === 0,
      retryable: operationalHealth.retry.retryable,
      compileTimelineEvents: compileContract.analytics?.timeline?.length ?? 0,
    }),
  });
}

function createCheckLifecycleSettings(options = {}) {
  const settings = options.checkSettings ?? options.settings ?? {};
  const mode = cleanText(settings.mode) || "strict";
  const schedule = cleanText(settings.schedule) || "manual";
  const enabled = settings.enabled !== false;
  const intervalMs = Math.max(0, Number.parseInt(settings.intervalMs ?? options.checkIntervalMs ?? 0, 10) || 0);
  const validModes = new Set(["strict", "advisory", "provider-gate"]);
  const validSchedules = new Set(["manual", "on-compile-change", "on-provider-ready", "interval"]);
  const diagnostics = [];

  if (!validModes.has(mode)) {
    diagnostics.push(diagnostic(
      "error",
      "AIOS_CLI_CHECK_MODE_INVALID",
      "Check settings mode must be strict, advisory, or provider-gate.",
      "$.lifecycle.settings.mode",
    ));
  }
  if (!validSchedules.has(schedule)) {
    diagnostics.push(diagnostic(
      "error",
      "AIOS_CLI_CHECK_SCHEDULE_INVALID",
      "Check schedule must be manual, on-compile-change, on-provider-ready, or interval.",
      "$.lifecycle.settings.schedule",
    ));
  }
  if (schedule === "interval" && intervalMs <= 0) {
    diagnostics.push(diagnostic(
      "error",
      "AIOS_CLI_CHECK_INTERVAL_REQUIRED",
      "Interval scheduling requires a positive intervalMs setting.",
      "$.lifecycle.settings.intervalMs",
    ));
  }

  return Object.freeze({
    valid: diagnostics.filter((entry) => entry.severity === "error").length === 0,
    diagnostics: Object.freeze(diagnostics),
    settings: Object.freeze({
      enabled,
      mode,
      schedule,
      intervalMs,
    }),
  });
}

function createCheckLifecycleControls(compileContract, checks, operationalHealth, analytics, settingsValidation) {
  const settings = settingsValidation.settings;
  const readiness = compileContract.statusHandoff.providerReadiness;
  const reviewGate = compileContract.reviewGate;
  const requiredFailures = checks.filter((check) => check.required && !check.passed);
  const advisoryFailures = checks.filter((check) => !check.required && !check.passed);
  const compileChanged = analytics.exportSummary.compileTimelineEvents > 0;
  const providerWaiting = readiness?.state === "waiting" || readiness?.state === "degraded";
  const providerBlocked = readiness?.state === "blocked" || operationalHealth.failureState === "provider-failed";
  const reviewGatePaused = reviewGate?.controls.enabled === false && reviewGate?.settings.enabled !== false;
  const reviewGateWaiting = reviewGate?.schedule.queued === true || reviewGate?.controls.canSchedule === true;
  const strictBlocked = settings.mode === "strict" && requiredFailures.length > 0;
  const providerGateBlocked = settings.mode === "provider-gate" && providerWaiting;
  const disabledReasons = Object.freeze([
    ...(!settings.enabled ? ["operator-disabled"] : []),
    ...(!settingsValidation.valid ? ["settings-invalid"] : []),
    ...(providerBlocked ? ["provider-blocked"] : []),
    ...(reviewGatePaused ? ["compile-review-gate-paused"] : []),
    ...(strictBlocked ? ["required-check-failed"] : []),
    ...(providerGateBlocked ? ["provider-acceptance-pending"] : []),
  ]);
  const enabled = settings.enabled && settingsValidation.valid && !providerBlocked && !reviewGatePaused && !strictBlocked && !providerGateBlocked;
  const canRunNow = enabled && operationalHealth.status !== "unhealthy";
  const canSchedule = settings.enabled
    && settingsValidation.valid
    && settings.schedule !== "manual"
    && !providerBlocked
    && (settings.schedule !== "on-provider-ready" || providerWaiting || reviewGateWaiting);
  const scheduleQueued = canSchedule && (
    settings.schedule === "interval"
    || settings.schedule === "on-provider-ready"
    || (settings.schedule === "on-compile-change" && compileChanged)
  );
  const nextAction = canRunNow
    ? requiredFailures.length > 0
      ? requiredFailures[0].nextAction
      : advisoryFailures.length > 0 && settings.mode !== "advisory"
        ? advisoryFailures[0].nextAction
        : "publish-cli-check-report"
    : disabledReasons.includes("settings-invalid")
      ? "repair-check-settings"
      : providerGateBlocked
        ? "schedule-check-after-provider-acceptance"
        : reviewGatePaused
          ? reviewGate.nextAction
        : operationalHealth.nextAction;

  return Object.freeze({
    protocol: "aios.language.cli-check-lifecycle.v1",
    settings,
    controls: Object.freeze({
      enabled,
      canRunNow,
      canDisable: true,
      canSchedule,
      canPublishReport: canRunNow && requiredFailures.length === 0,
    }),
    schedule: Object.freeze({
      mode: settings.schedule,
      queued: scheduleQueued,
      intervalMs: settings.intervalMs,
      retryAfterMs: readiness?.retry?.retryAfterMs ?? operationalHealth.retry.retryAfterMs,
      blockedBy: disabledReasons,
      resumeWhen: providerWaiting
        ? "provider-accepted"
        : operationalHealth.status === "unhealthy"
          ? operationalHealth.failureState
          : settings.schedule === "on-compile-change"
            ? "compile-timeline-updated"
            : "operator-request",
    }),
    report: Object.freeze({
      name: analytics.exportSummary.reportName,
      compileReportName: analytics.exportSummary.compileReportName,
      healthStatus: operationalHealth.status,
      requiredPassed: requiredFailures.length === 0,
      advisoryCount: advisoryFailures.length,
      publishable: canRunNow && requiredFailures.length === 0,
      reviewGateAccepted: reviewGate?.acceptance.accepted === true,
      reviewGateNextAction: reviewGate?.nextAction ?? null,
    }),
    nextAction,
  });
}

function createMailchimpAcceptancePreview(compileContract, checks, operationalHealth, lifecycle) {
  const provider = compileContract.mailchimpProvider;
  const failedRequired = checks.filter((check) => check.required && !check.passed);
  const missingScopes = provider?.capabilityNegotiation?.missingScopes ?? Object.freeze([]);
  const identity = provider?.identity ?? {};
  const identityReady = Boolean(identity.audienceId || identity.campaignId);
  const syncReady = provider?.sync?.state === "synced" || provider?.sync?.state === "not-required";
  const capabilityReady = missingScopes.length === 0 && provider?.capabilityNegotiation?.accepted === true;
  const providerReady = provider?.state === "ready" || provider?.state === "not-required";
  const previewable = compileContract.statusHandoff.acceptedForClientPreview === true
    && operationalHealth.status !== "unhealthy";
  const acceptable = previewable
    && failedRequired.length === 0
    && identityReady
    && capabilityReady
    && providerReady;
  const validationItems = Object.freeze([
    Object.freeze({
      id: "mailchimp-identity",
      label: "Mailchimp audience or campaign",
      status: identityReady ? "passed" : "needs-input",
      path: "$.compile.mailchimpProvider.identity",
      nextAction: identityReady ? "none" : "configure-mailchimp-provider-identity",
    }),
    Object.freeze({
      id: "mailchimp-capabilities",
      label: "Mailchimp provider scopes",
      status: capabilityReady ? "passed" : "blocked",
      path: "$.compile.mailchimpProvider.capabilityNegotiation",
      nextAction: capabilityReady ? "none" : "negotiate-mailchimp-provider-capabilities",
    }),
    Object.freeze({
      id: "mailchimp-sync",
      label: "Mailchimp external sync",
      status: syncReady ? "passed" : provider?.sync?.state === "blocked" ? "blocked" : "pending",
      path: "$.compile.mailchimpProvider.sync",
      nextAction: syncReady ? "none" : "request-mailchimp-provider-sync",
    }),
    Object.freeze({
      id: "cli-required-checks",
      label: "CLI required checks",
      status: failedRequired.length === 0 ? "passed" : "blocked",
      path: "$.checks",
      nextAction: failedRequired[0]?.nextAction ?? "none",
    }),
  ]);
  const blockingItems = validationItems.filter((item) => item.status === "blocked" || item.status === "needs-input");
  const nextAction = acceptable
    ? "accept-mailchimp-cli-preview"
    : blockingItems[0]?.nextAction
      || lifecycle.nextAction
      || operationalHealth.nextAction;

  return Object.freeze({
    protocol: "aios.language.cli-check-mailchimp-preview.v1",
    status: acceptable ? "acceptable" : previewable ? "needs-review" : "blocked",
    previewable,
    acceptable,
    provider: provider ? Object.freeze({
      name: provider.provider,
      state: provider.state,
      accountId: provider.identity.accountId,
      audienceId: provider.identity.audienceId,
      campaignId: provider.identity.campaignId,
      syncState: provider.sync.state,
      correlationId: provider.sync.correlationId,
    }) : null,
    validationSummary: Object.freeze({
      total: validationItems.length,
      passed: validationItems.filter((item) => item.status === "passed").length,
      blocked: validationItems.filter((item) => item.status === "blocked").length,
      needsInput: validationItems.filter((item) => item.status === "needs-input").length,
      missingScopes,
      failedRequiredChecks: failedRequired.length,
      healthStatus: operationalHealth.status,
    }),
    validationItems,
    acceptance: Object.freeze({
      userVisible: previewable,
      runtimeReady: compileContract.statusHandoff.acceptedForRuntime === true,
      canAcceptPreview: acceptable,
      canAcceptRuntime: acceptable && compileContract.statusHandoff.acceptedForRuntime === true,
      acceptedBy: "cli-operator",
      acceptedState: acceptable ? "ready-for-mailchimp-handoff" : "pending-review",
    }),
    nextStep: Object.freeze({
      action: nextAction,
      reason: blockingItems[0]?.id ?? (acceptable ? "mailchimp-preview-ready" : "cli-preview-waiting"),
      handoffId: provider?.handoff?.id ?? null,
      syncChannel: provider?.sync?.channel ?? null,
    }),
  });
}

export function buildAiosCliCheckContract(source = "", options = {}) {
  const compileContract = options.compileContract ?? buildAiosCliCompileContract(source, options);
  const checks = createCheckItems(compileContract);
  const checkDiagnostics = diagnosticsFromChecks(checks);
  const settingsValidation = createCheckLifecycleSettings(options);
  const allDiagnostics = Object.freeze([
    ...compileContract.diagnostics,
    ...checkDiagnostics,
    ...settingsValidation.diagnostics,
  ]);
  const counts = countDiagnostics(allDiagnostics);
  const failedRequired = checks.filter((check) => check.required && !check.passed);
  const advisory = checks.filter((check) => !check.required && !check.passed);
  const status = failedRequired.length > 0 ? "failed" : advisory.length > 0 ? "advisory" : "passed";
  const operationalHealth = createOperationalHealth(compileContract, checks, allDiagnostics);
  const analytics = createCheckAnalytics(compileContract, checks, allDiagnostics, operationalHealth);
  const lifecycle = createCheckLifecycleControls(compileContract, checks, operationalHealth, analytics, settingsValidation);
  const mailchimpPreview = createMailchimpAcceptancePreview(compileContract, checks, operationalHealth, lifecycle);

  return Object.freeze({
    protocol: CHECK_CONTRACT_PROTOCOL,
    command: "check",
    source: compileContract.source,
    compile: summarizeAiosCliCompileContract(compileContract),
    status,
    ok: status !== "failed" && counts.error === 0,
    checks,
    diagnostics: allDiagnostics,
    counts,
    operationalHealth,
    analytics,
    lifecycle,
    mailchimpPreview,
    statusHandoff: Object.freeze({
      ...compileContract.statusHandoff,
      checkStatus: status,
      healthStatus: operationalHealth.status,
      failureState: operationalHealth.failureState,
      providerState: analytics.exportSummary.providerState,
      providerSyncState: analytics.exportSummary.providerSyncState,
      reviewGateState: analytics.exportSummary.reviewGateState,
      reviewGateNextAction: analytics.exportSummary.reviewGateNextAction,
      requiredPassed: failedRequired.length === 0,
      advisoryCount: advisory.length,
      lifecycleEnabled: lifecycle.controls.enabled,
      scheduleQueued: lifecycle.schedule.queued,
      reportName: lifecycle.report.name,
      mailchimpState: compileContract.mailchimpProvider?.state ?? "unknown",
      mailchimpSyncState: compileContract.mailchimpProvider?.sync?.state ?? "unknown",
      mailchimpPreviewStatus: mailchimpPreview.status,
      mailchimpNextStep: mailchimpPreview.nextStep.action,
    }),
    recoveryHandoff: Object.freeze({
      ...compileContract.recoveryHandoff,
      checkRepairRequired: failedRequired.length > 0,
      degradedMode: operationalHealth.degradedMode,
      retry: operationalHealth.retry,
      timeline: analytics.timeline,
      mailchimpPreview: mailchimpPreview.nextStep,
      lifecycleNextAction: lifecycle.nextAction,
      nextAction: lifecycle.nextAction || failedRequired[0]?.nextAction || compileContract.recoveryHandoff.nextAction,
    }),
    nextAction: lifecycle.nextAction
      || operationalHealth.nextAction
      || failedRequired[0]?.nextAction
      || advisory[0]?.nextAction
      || compileContract.statusHandoff.nextAction,
  });
}

export function assertAiosCliCheckContractReady(contract) {
  const diagnostics = [];
  if (contract?.protocol !== CHECK_CONTRACT_PROTOCOL) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_CHECK_PROTOCOL_INVALID", "Check contract protocol is missing or unsupported."));
  }
  if (contract?.ok !== true) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_CHECK_FAILED", "CLI check contract has failing required checks.", "$.checks"));
  }
  if (!cleanText(contract?.nextAction)) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_CHECK_NEXT_ACTION_REQUIRED", "CLI check contract must expose a deterministic next action.", "$.nextAction"));
  }
  if (!contract?.operationalHealth?.status) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_CHECK_HEALTH_REQUIRED", "CLI check contract must expose operational health.", "$.operationalHealth"));
  }
  if (!contract?.analytics?.exportSummary?.reportName) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_CHECK_ANALYTICS_REQUIRED", "CLI check contract must expose export-ready analytics.", "$.analytics.exportSummary"));
  }
  if (!contract?.lifecycle?.controls) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_CHECK_LIFECYCLE_REQUIRED", "CLI check contract must expose lifecycle controls.", "$.lifecycle.controls"));
  }
  if (!contract?.mailchimpPreview?.validationSummary) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_CHECK_MAILCHIMP_PREVIEW_REQUIRED", "CLI check contract must expose Mailchimp preview validation summary.", "$.mailchimpPreview.validationSummary"));
  }
  if (contract?.lifecycle?.settings?.schedule === "interval" && contract.lifecycle.settings.intervalMs <= 0) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_CHECK_INTERVAL_REQUIRED", "Interval lifecycle scheduling requires a positive interval.", "$.lifecycle.settings.intervalMs"));
  }
  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    nextAction: diagnostics[0]?.code || contract?.nextAction || "repair-cli-check-contract",
  });
}

export { CHECK_CONTRACT_PROTOCOL };
