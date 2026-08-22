import {
  compileMailchimpVerifier,
  evaluateMailchimpVerifier,
} from "../compiler/verifier-compiler.mjs";

export const MAILCHIMP_VERIFIER_ANALYSIS_VERSION = "aios.semantic.verifier-analysis.v1";

function readPath(value, path) {
  return String(path || "").split(".").reduce((node, part) => (node == null ? undefined : node[part]), value);
}

function summarizeFindings(findings) {
  const normalized = Array.isArray(findings) ? findings : [];
  return {
    total: normalized.length,
    errors: normalized.filter((finding) => finding.severity === "error").length,
    warnings: normalized.filter((finding) => finding.severity === "warning").length,
    ruleIds: normalized.map((finding) => finding.ruleId).filter(Boolean).sort(),
  };
}

function inferCandidateCompleteness(contract, candidate) {
  const missingPaths = [];
  const presentPaths = [];
  for (const rule of contract.rules || []) {
    if (readPath(candidate, rule.path) == null) {
      missingPaths.push(rule.path);
    } else {
      presentPaths.push(rule.path);
    }
  }
  return {
    missingPaths: [...new Set(missingPaths)].sort(),
    presentPaths: [...new Set(presentPaths)].sort(),
    complete: missingPaths.length === 0,
  };
}

function defaultCandidate(source = {}) {
  return {
    campaign: {
      subject: source.subject || "Mailchimp semantic verification preview",
      footer: {
        unsubscribeLink: source.unsubscribeLink || "runtime-managed",
      },
    },
    audience: {
      id: source.audienceId || "preview-audience",
    },
    approval: {
      externalWrite: source.externalWriteApproved === true,
    },
  };
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableId(prefix, parts) {
  const input = JSON.stringify(parts);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function inferProviderServiceContract(source, contract, context) {
  const providerService = source.providerService || source.providerServiceContract || {};
  const requestedCapabilities = [
    "provider.mailchimp.audience.read",
    "provider.mailchimp.campaign.preview",
    ...(context.hasExternalWrite ? ["provider.mailchimp.campaign.write"] : []),
    ...asArray(providerService.requestedCapabilities),
  ];
  const offeredCapabilities = asArray(
    providerService.offeredCapabilities
      || source.offeredCapabilities
      || ["provider.mailchimp.audience.read", "provider.mailchimp.campaign.preview"],
  );
  const requiredRuleCapabilities = asArray(contract.requiredCapabilities);
  const requiredCapabilities = [...new Set([...requestedCapabilities, ...requiredRuleCapabilities])].sort();
  const missingCapabilities = requiredCapabilities
    .filter((capability) => !offeredCapabilities.includes(capability))
    .sort();
  const serviceId = providerService.serviceId || stableId("mailchimp-verifier-service", [
    providerService.providerService || "mailchimp-marketing-api",
    requiredCapabilities,
    offeredCapabilities,
  ]);
  return {
    providerService: providerService.providerService || "mailchimp-marketing-api",
    serviceId,
    version: providerService.version || "runtime-negotiated",
    requestedCapabilities: requiredCapabilities,
    offeredCapabilities: [...new Set(offeredCapabilities)].sort(),
    missingCapabilities,
    negotiatedCapabilities: requiredCapabilities.filter((capability) => offeredCapabilities.includes(capability)).sort(),
    status: missingCapabilities.length ? "capability-mismatch" : "negotiated",
  };
}

function buildSyncMetadata(source, providerServiceContract, acceptedForRuntime, acceptedForExternalWrite) {
  const cursor = source.syncCursor || source.cursor || null;
  return {
    syncId: stableId("mailchimp-verifier-sync", [
      providerServiceContract.serviceId,
      cursor,
      acceptedForRuntime,
      acceptedForExternalWrite,
    ]),
    cursor,
    statusChannel: "verifier.sync.mailchimp",
    handoffMode: acceptedForExternalWrite ? "external-write" : acceptedForRuntime ? "runtime-preview" : "blocked",
    checkpointRequired: acceptedForRuntime,
    replaySafe: !acceptedForExternalWrite,
    nextAction: !acceptedForRuntime
      ? "hold-verifier-sync"
      : acceptedForExternalWrite
        ? "handoff-approved-external-write"
        : "handoff-runtime-preview",
  };
}

function buildCapabilityNegotiation(providerServiceContract, evaluation, completeness) {
  const findingSummary = summarizeFindings(evaluation.findings);
  const blockers = [
    ...providerServiceContract.missingCapabilities,
    ...completeness.missingPaths.map((path) => `candidate:${path}`),
    ...evaluation.findings
      .filter((finding) => finding.severity === "error")
      .map((finding) => `rule:${finding.ruleId}`),
  ].sort();
  return {
    status: blockers.length ? "blocked" : "accepted",
    providerService: providerServiceContract.providerService,
    negotiatedCapabilities: providerServiceContract.negotiatedCapabilities,
    missingCapabilities: providerServiceContract.missingCapabilities,
    findingSummary,
    blockers,
    nextAction: providerServiceContract.missingCapabilities.length
      ? "refresh-provider-service-capabilities"
      : completeness.missingPaths.length
        ? "hydrate-verifier-candidate"
        : findingSummary.errors
          ? "resolve-verifier-findings"
          : "handoff-to-runtime-adapter",
  };
}

function buildVerifierPreviewState(contract, candidate, evaluation, completeness, providerServiceContract) {
  const findingSummary = summarizeFindings(evaluation.findings);
  const rulePreviews = (contract.rules || []).map((rule) => {
    const observed = !completeness.missingPaths.includes(rule.path);
    const finding = evaluation.findings.find((item) => item.ruleId === rule.id);
    return {
      ruleId: rule.id,
      path: rule.path,
      severity: rule.severity,
      observed,
      status: finding?.severity === "error"
        ? "blocking"
        : finding?.severity === "warning"
          ? "warning"
          : observed
            ? "satisfied"
            : "missing",
      valuePreview: observed ? readPath(candidate, rule.path) : null,
      nextAction: observed ? "no-action" : "hydrate-verifier-candidate",
    };
  });
  return {
    previewId: stableId("mailchimp-verifier-preview", [
      contract.id,
      providerServiceContract.serviceId,
      rulePreviews.map((rule) => [rule.ruleId, rule.status]),
    ]),
    title: contract.name || "Mailchimp verifier preview",
    status: findingSummary.errors ? "blocked" : completeness.complete ? "ready" : "needs-client-state",
    providerService: providerServiceContract.providerService,
    rules: rulePreviews,
    candidateShape: {
      presentPaths: completeness.presentPaths,
      missingPaths: completeness.missingPaths,
      complete: completeness.complete,
    },
    counters: {
      rules: rulePreviews.length,
      satisfiedRules: rulePreviews.filter((rule) => rule.status === "satisfied").length,
      warnings: findingSummary.warnings,
      errors: findingSummary.errors,
      missingPaths: completeness.missingPaths.length,
    },
  };
}

function buildVerifierAcceptanceState(source, options, evaluation, previewState, acceptedForRuntime, acceptedForExternalWrite) {
  const acceptance = options.acceptance || source.acceptance || {};
  const externalWriteRequested = options.hasExternalWrite === true || source.hasExternalWrite === true;
  const runtimeAccepted = acceptedForRuntime && (acceptance.accepted === true || previewState.status === "ready");
  const externalWriteAccepted = acceptedForExternalWrite && acceptance.externalWriteAccepted === true;
  const blockers = [
    ...previewState.candidateShape.missingPaths.map((path) => `missing-path:${path}`),
    ...evaluation.findings
      .filter((finding) => finding.severity === "error")
      .map((finding) => `finding:${finding.ruleId}`),
    ...(externalWriteRequested && !externalWriteAccepted ? ["external-write:approval-required"] : []),
  ].sort();
  return {
    acceptanceId: stableId("mailchimp-verifier-acceptance", [
      previewState.previewId,
      acceptance.acceptedBy,
      acceptance.externalWriteAccepted,
      externalWriteRequested,
    ]),
    runtimeAcceptanceRequired: previewState.status !== "blocked",
    externalWriteAcceptanceRequired: externalWriteRequested,
    acceptedForRuntime: runtimeAccepted,
    acceptedForExternalWrite: externalWriteAccepted,
    acceptedBy: acceptance.acceptedBy || null,
    acceptedAt: acceptance.acceptedAt || null,
    blockedBy: blockers,
    nextAction: blockers.length
      ? blockers[0].startsWith("missing-path:")
        ? "hydrate-verifier-candidate"
        : blockers[0] === "external-write:approval-required"
          ? "collect-external-write-approval"
          : "resolve-verifier-findings"
      : "handoff-to-runtime-adapter",
  };
}

function buildValidationSummary(providerServiceContract, capabilityNegotiation, previewState, acceptanceState) {
  const checks = [
    {
      check: "candidate-complete",
      status: previewState.candidateShape.complete ? "pass" : "fail",
      details: previewState.candidateShape.missingPaths,
    },
    {
      check: "provider-capabilities-negotiated",
      status: providerServiceContract.status === "negotiated" ? "pass" : "fail",
      details: providerServiceContract.missingCapabilities,
    },
    {
      check: "rule-findings-clear",
      status: previewState.counters.errors === 0 ? "pass" : "fail",
      details: capabilityNegotiation.findingSummary.ruleIds,
    },
    {
      check: "acceptance-collected",
      status: acceptanceState.acceptedForRuntime ? "pass" : "pending",
      details: acceptanceState.blockedBy,
    },
  ];
  const failed = checks.filter((check) => check.status === "fail");
  const pending = checks.filter((check) => check.status === "pending");
  return {
    status: failed.length ? "blocked" : pending.length ? "pending-acceptance" : "ready",
    checks,
    blockingChecks: failed.map((check) => check.check),
    pendingChecks: pending.map((check) => check.check),
    nextAction: failed.length
      ? failed[0].check === "provider-capabilities-negotiated"
        ? "refresh-provider-service-capabilities"
        : failed[0].check === "candidate-complete"
          ? "hydrate-verifier-candidate"
          : "resolve-verifier-findings"
      : pending.length
        ? "collect-verifier-acceptance"
        : "handoff-to-runtime-adapter",
  };
}

function buildClientRuntimeAdoptionState(source, candidate, previewState, acceptanceState, validationSummary, syncMetadata) {
  const clientRuntime = source.clientRuntime || {};
  const requestState = clientRuntime.requestState || source.requestState || {};
  const requiredClientState = [
    "requestId",
    "workflowId",
    "previewId",
    "acceptanceId",
    ...asArray(clientRuntime.requiredKeys),
  ];
  const observedState = {
    ...requestState,
    requestId: requestState.requestId || clientRuntime.requestId || source.requestId || null,
    workflowId: requestState.workflowId || clientRuntime.workflowId || source.workflowId || "mailchimp-campaign-workflow",
    previewId: previewState.previewId,
    acceptanceId: acceptanceState.acceptanceId,
    syncId: syncMetadata.syncId,
    validationStatus: validationSummary.status,
  };
  const missingClientState = [...new Set(requiredClientState)]
    .filter((key) => observedState[key] == null)
    .sort();
  const routeCommands = [
    {
      command: "render-verifier-preview",
      enabled: true,
      previewId: previewState.previewId,
    },
    {
      command: "persist-verifier-client-state",
      enabled: missingClientState.length > 0 || validationSummary.status !== "blocked",
      stateKey: clientRuntime.stateKey || stableId("mailchimp-verifier-client-state", [
        observedState.requestId,
        previewState.previewId,
      ]),
    },
    {
      command: "accept-verifier-preview",
      enabled: validationSummary.status !== "blocked" && !acceptanceState.acceptedForRuntime,
      acceptanceId: acceptanceState.acceptanceId,
    },
    {
      command: "handoff-verifier-runtime",
      enabled: validationSummary.status === "ready" && acceptanceState.acceptedForRuntime,
      syncId: syncMetadata.syncId,
    },
  ];
  return {
    adoptionId: stableId("mailchimp-verifier-runtime-adoption", [
      observedState.requestId,
      observedState.workflowId,
      previewState.previewId,
      acceptanceState.acceptanceId,
      validationSummary.status,
    ]),
    requestId: observedState.requestId,
    workflowId: observedState.workflowId,
    stateKey: clientRuntime.stateKey || stableId("mailchimp-verifier-client-state", [
      observedState.requestId,
      observedState.workflowId,
    ]),
    hydrated: missingClientState.length === 0,
    requiredClientState: [...new Set(requiredClientState)].sort(),
    missingClientState,
    persistedState: {
      ...observedState,
      candidateDigest: stableId("mailchimp-verifier-candidate", [
        candidate?.campaign?.subject,
        candidate?.audience?.id,
        previewState.candidateShape.presentPaths,
      ]),
      nextAction: validationSummary.nextAction,
    },
    routeCommands,
    userVisibleWorkflow: {
      previewId: previewState.previewId,
      acceptanceId: acceptanceState.acceptanceId,
      status: missingClientState.length
        ? "needs-client-state"
        : validationSummary.status,
      nextAction: missingClientState.length
        ? "hydrate-verifier-client-state"
        : validationSummary.nextAction,
      nextSteps: [
        ...missingClientState.map((key) => ({
          action: "hydrate-verifier-client-state",
          subject: key,
          reason: "Verifier route state is required before runtime handoff",
        })),
        ...validationSummary.blockingChecks.map((check) => ({
          action: validationSummary.nextAction,
          subject: check,
          reason: "Verifier validation check is blocking runtime adoption",
        })),
        ...(validationSummary.status === "ready" ? [{
          action: "handoff-verifier-runtime",
          subject: syncMetadata.syncId,
          reason: "Verifier preview is accepted and ready for runtime adapter adoption",
        }] : []),
      ],
    },
  };
}

function buildVerifierOperationalHealthState(
  source,
  providerServiceContract,
  capabilityNegotiation,
  validationSummary,
  clientRuntimeAdoptionState,
  syncMetadata,
) {
  const healthSource = source.operationalHealth
    || source.health
    || source.providerService?.health
    || {};
  const attempts = Math.max(0, Math.floor(Number(
    healthSource.attempts
      ?? healthSource.retryAttempts
      ?? source.retryAttempts
      ?? 0,
  )));
  const maxAttempts = Math.max(1, Math.floor(Number(
    healthSource.maxAttempts
      ?? healthSource.retryPolicy?.maxAttempts
      ?? 3,
  )));
  const providerAvailable = healthSource.providerAvailable !== false
    && healthSource.status !== "down"
    && healthSource.status !== "unavailable";
  const routeHydrated = clientRuntimeAdoptionState.hydrated === true;
  const capabilityBlocked = capabilityNegotiation.status !== "accepted";
  const validationBlocked = validationSummary.status === "blocked";
  const retryExhausted = attempts >= maxAttempts;
  const degradedReasons = [
    ...(providerAvailable ? [] : ["provider:unavailable"]),
    ...(capabilityBlocked ? capabilityNegotiation.blockers.map((blocker) => `capability:${blocker}`) : []),
    ...(validationBlocked ? validationSummary.blockingChecks.map((check) => `validation:${check}`) : []),
    ...(routeHydrated ? [] : clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`)),
    ...(retryExhausted ? ["retry:exhausted"] : []),
  ].sort();
  const retryable = providerAvailable
    && !retryExhausted
    && (capabilityBlocked || validationBlocked || !routeHydrated)
    && syncMetadata.handoffMode !== "external-write";
  const degradedMode = degradedReasons.length > 0;
  const healthStatus = degradedReasons.length
    ? retryExhausted
      ? "failed"
      : providerAvailable
        ? "degraded"
        : "provider-unavailable"
    : "healthy";
  const nextDelaySeconds = retryable
    ? Math.min(
      Math.max(15, Number(healthSource.retryPolicy?.initialDelaySeconds || 30))
        * (2 ** attempts),
      Math.max(60, Number(healthSource.retryPolicy?.maxDelaySeconds || 300)),
    )
    : null;
  const healthId = stableId("mailchimp-verifier-health", [
    providerServiceContract.serviceId,
    validationSummary.status,
    clientRuntimeAdoptionState.stateKey,
    attempts,
    degradedReasons,
  ]);
  const actionableErrors = degradedReasons.map((reason) => {
    if (reason.startsWith("provider:")) {
      return {
        code: "verifier.health.provider-unavailable",
        reason,
        action: "retry-provider-service-health-check",
      };
    }
    if (reason.startsWith("capability:")) {
      return {
        code: "verifier.health.capability-blocked",
        reason,
        action: "refresh-provider-service-capabilities",
      };
    }
    if (reason.startsWith("client-state:")) {
      return {
        code: "verifier.health.client-state-missing",
        reason,
        action: "hydrate-verifier-client-state",
      };
    }
    if (reason === "retry:exhausted") {
      return {
        code: "verifier.health.retry-exhausted",
        reason,
        action: "escalate-verifier-recovery",
      };
    }
    return {
      code: "verifier.health.validation-blocked",
      reason,
      action: validationSummary.nextAction,
    };
  });

  return {
    healthId,
    status: healthStatus,
    degradedMode,
    providerAvailable,
    retryable,
    attempts,
    maxAttempts,
    nextDelaySeconds,
    degradedReasons,
    actionableErrors,
    statusChannel: degradedMode ? "verifier.health.mailchimp.degraded" : "verifier.health.mailchimp",
    retryPolicy: {
      strategy: healthSource.retryPolicy?.strategy || "bounded-exponential",
      attempts,
      maxAttempts,
      nextDelaySeconds,
      retryable,
    },
    persistedState: {
      healthId,
      serviceId: providerServiceContract.serviceId,
      syncId: syncMetadata.syncId,
      stateKey: clientRuntimeAdoptionState.stateKey,
      status: healthStatus,
      degradedMode,
      attempts,
      nextAction: retryable
        ? "schedule-verifier-health-retry"
        : actionableErrors[0]?.action || "handoff-to-runtime-adapter",
    },
    commands: [
      {
        command: "persist-verifier-health-state",
        enabled: true,
        idempotencyKey: `verifier-health:${healthId}`,
      },
      {
        command: "schedule-verifier-health-retry",
        enabled: retryable,
        delaySeconds: nextDelaySeconds,
        idempotencyKey: `verifier-health-retry:${stableId("verifier-health-retry", [
          healthId,
          attempts + 1,
        ])}`,
      },
      {
        command: "enter-verifier-degraded-mode",
        enabled: degradedMode && !retryable,
        reasons: degradedReasons,
      },
    ],
    nextAction: retryable
      ? "schedule-verifier-health-retry"
      : actionableErrors[0]?.action || "handoff-to-runtime-adapter",
  };
}

function buildVerifierProviderReportingState(
  source,
  providerServiceContract,
  capabilityNegotiation,
  syncMetadata,
  previewState,
  acceptanceState,
  validationSummary,
  clientRuntimeAdoptionState,
  operationalHealthState,
  findingSummary,
) {
  const reportSource = source.providerReport
    || source.reporting
    || source.providerService?.reporting
    || {};
  const failedChecks = asArray(validationSummary.blockingChecks);
  const pendingChecks = asArray(validationSummary.pendingChecks);
  const missingClientState = asArray(clientRuntimeAdoptionState.missingClientState);
  const healthErrors = asArray(operationalHealthState.actionableErrors)
    .filter((error) => error.severity === "error" || error.code?.includes("unavailable"));
  const blockedBy = [
    ...providerServiceContract.missingCapabilities.map((capability) => `capability:${capability}`),
    ...failedChecks.map((check) => `validation:${check}`),
    ...missingClientState.map((key) => `client-state:${key}`),
    ...healthErrors.map((error) => `health:${error.code}`),
    ...asArray(reportSource.blockedBy),
  ].sort();
  const pendingBy = [
    ...pendingChecks.map((check) => `validation:${check}`),
    ...(acceptanceState.externalWriteAcceptanceRequired && !acceptanceState.acceptedForExternalWrite
      ? ["external-write:approval-required"]
      : []),
    ...(operationalHealthState.retryable ? ["health:retry-scheduled"] : []),
    ...asArray(reportSource.pendingBy),
  ].sort();
  const reportStatus = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : acceptanceState.acceptedForRuntime && clientRuntimeAdoptionState.hydrated
        ? "ready"
        : "waiting";
  const analyticsCounters = {
    rules: previewState.counters.rules,
    satisfiedRules: previewState.counters.satisfiedRules,
    missingPaths: previewState.counters.missingPaths,
    findings: findingSummary.total,
    findingErrors: findingSummary.errors,
    findingWarnings: findingSummary.warnings,
    requestedCapabilities: providerServiceContract.requestedCapabilities.length,
    negotiatedCapabilities: providerServiceContract.negotiatedCapabilities.length,
    missingCapabilities: providerServiceContract.missingCapabilities.length,
    missingClientState: missingClientState.length,
    healthErrors: healthErrors.length,
    retryableHealth: operationalHealthState.retryable ? 1 : 0,
  };
  const historySnapshots = [
    {
      phase: "provider-capabilities",
      status: providerServiceContract.status,
      subject: providerServiceContract.serviceId,
      counters: {
        requested: providerServiceContract.requestedCapabilities.length,
        negotiated: providerServiceContract.negotiatedCapabilities.length,
        missing: providerServiceContract.missingCapabilities.length,
      },
      nextAction: capabilityNegotiation.nextAction,
    },
    {
      phase: "verifier-preview",
      status: previewState.status,
      subject: previewState.previewId,
      counters: previewState.counters,
      nextAction: previewState.status === "ready" ? "review-verifier-preview" : validationSummary.nextAction,
    },
    {
      phase: "validation",
      status: validationSummary.status,
      subject: validationSummary.status,
      counters: {
        checks: validationSummary.checks.length,
        failedChecks: failedChecks.length,
        pendingChecks: pendingChecks.length,
      },
      nextAction: validationSummary.nextAction,
    },
    {
      phase: "acceptance",
      status: acceptanceState.acceptedForRuntime ? "accepted" : acceptanceState.nextAction,
      subject: acceptanceState.acceptanceId,
      counters: {
        blockers: acceptanceState.blockedBy.length,
        runtimeAccepted: acceptanceState.acceptedForRuntime ? 1 : 0,
        externalWriteAccepted: acceptanceState.acceptedForExternalWrite ? 1 : 0,
      },
      nextAction: acceptanceState.nextAction,
    },
    {
      phase: "sync-handoff",
      status: syncMetadata.handoffMode,
      subject: syncMetadata.syncId,
      counters: {
        checkpointRequired: syncMetadata.checkpointRequired ? 1 : 0,
        replaySafe: syncMetadata.replaySafe ? 1 : 0,
      },
      nextAction: syncMetadata.nextAction,
    },
    {
      phase: "provider-health",
      status: operationalHealthState.status,
      subject: operationalHealthState.healthId,
      counters: {
        degradedReasons: operationalHealthState.degradedReasons.length,
        actionableErrors: operationalHealthState.actionableErrors.length,
        attempts: operationalHealthState.attempts,
      },
      nextAction: operationalHealthState.nextAction,
    },
  ].map((event, index) => ({
    eventId: stableId("mailchimp-verifier-provider-event", [
      providerServiceContract.serviceId,
      event.phase,
      event.status,
      event.subject,
      index,
    ]),
    index,
    ...event,
  }));
  const nextAction = blockedBy.length
    ? blockedBy[0].startsWith("capability:")
      ? "refresh-provider-service-capabilities"
      : blockedBy[0].startsWith("client-state:")
        ? "hydrate-verifier-client-state"
        : blockedBy[0].startsWith("health:")
          ? operationalHealthState.nextAction
          : validationSummary.nextAction
    : pendingBy.length
      ? pendingBy.includes("external-write:approval-required")
        ? "collect-external-write-approval"
        : operationalHealthState.retryable
          ? "schedule-verifier-health-retry"
          : validationSummary.nextAction
      : reportStatus === "ready"
        ? "handoff-to-runtime-adapter"
        : clientRuntimeAdoptionState.userVisibleWorkflow.nextAction;

  return {
    reportId: stableId("mailchimp-verifier-provider-report", [
      providerServiceContract.serviceId,
      previewState.previewId,
      acceptanceState.acceptanceId,
      syncMetadata.syncId,
      reportStatus,
    ]),
    status: reportStatus,
    generatedDeterministically: true,
    analyticsCounters,
    providerHandoffSummary: {
      providerService: providerServiceContract.providerService,
      serviceId: providerServiceContract.serviceId,
      syncId: syncMetadata.syncId,
      healthId: operationalHealthState.healthId,
      handoffMode: syncMetadata.handoffMode,
      acceptedForRuntime: acceptanceState.acceptedForRuntime
        && clientRuntimeAdoptionState.hydrated
        && operationalHealthState.status === "healthy"
        && blockedBy.length === 0,
      acceptedForExternalWrite: acceptanceState.acceptedForExternalWrite,
      statusChannel: operationalHealthState.degradedMode
        ? operationalHealthState.statusChannel
        : syncMetadata.statusChannel,
      blockedBy,
      pendingBy,
      nextAction,
    },
    exportSummary: {
      exportKind: "mailchimp.verifierProvider.operationalSummary",
      status: reportStatus,
      providerService: providerServiceContract.providerService,
      serviceId: providerServiceContract.serviceId,
      previewId: previewState.previewId,
      acceptanceId: acceptanceState.acceptanceId,
      syncId: syncMetadata.syncId,
      rows: previewState.rules.map((rule) => ({
        ruleId: rule.ruleId,
        path: rule.path,
        status: rule.status,
        observed: rule.observed,
        nextAction: rule.nextAction,
      })),
      totals: analyticsCounters,
      blockedBy,
      pendingBy,
      nextAction,
    },
    historySnapshots,
    timelineState: {
      currentPhase: historySnapshots.find((event) => event.status === "blocked")?.phase
        || historySnapshots.find((event) => event.status === "capability-mismatch")?.phase
        || historySnapshots.find((event) => event.status === "degraded")?.phase
        || historySnapshots.find((event) => event.status === "pending")?.phase
        || historySnapshots.at(-1)?.phase
        || "provider-capabilities",
      phases: historySnapshots.map((event) => ({
        index: event.index,
        phase: event.phase,
        status: event.status,
        nextAction: event.nextAction,
      })),
      reportChannels: [
        syncMetadata.statusChannel,
        operationalHealthState.statusChannel,
        "verifier.status.mailchimp",
      ],
    },
    commands: [
      {
        command: "publish-verifier-provider-report",
        enabled: reportStatus !== "blocked",
        reportId: stableId("mailchimp-verifier-provider-report-command", [
          providerServiceContract.serviceId,
          reportStatus,
          syncMetadata.syncId,
        ]),
      },
      {
        command: "persist-verifier-provider-handoff-summary",
        enabled: true,
        idempotencyKey: `verifier-provider-handoff:${stableId("verifier-provider-handoff", [
          providerServiceContract.serviceId,
          syncMetadata.syncId,
          operationalHealthState.healthId,
        ])}`,
      },
    ],
    nextAction,
  };
}

function buildVerifierSyscallHandoffPackage(
  source,
  providerServiceContract,
  syncMetadata,
  previewState,
  acceptanceState,
  validationSummary,
  clientRuntimeAdoptionState,
  operationalHealthState,
  providerReportingState,
) {
  const handoffSource = source.syscallHandoff
    || source.syscallRecoveryHandoff
    || source.downstreamHandoff
    || {};
  const blockedBy = [
    ...asArray(providerReportingState.providerHandoffSummary.blockedBy),
    ...asArray(validationSummary.blockingChecks).map((check) => `validation:${check}`),
    ...asArray(clientRuntimeAdoptionState.missingClientState).map((key) => `client-state:${key}`),
    ...(operationalHealthState.status === "healthy" ? [] : [`health:${operationalHealthState.status}`]),
  ].sort();
  const pendingBy = [
    ...asArray(providerReportingState.providerHandoffSummary.pendingBy),
    ...asArray(validationSummary.pendingChecks).map((check) => `validation:${check}`),
    ...(operationalHealthState.retryable ? ["health:retry-scheduled"] : []),
    ...(acceptanceState.externalWriteAcceptanceRequired && !acceptanceState.acceptedForExternalWrite
      ? ["external-write:approval-required"]
      : []),
  ].sort();
  const acceptedForSyscallDispatch = blockedBy.length === 0
    && pendingBy.length === 0
    && acceptanceState.acceptedForRuntime === true
    && clientRuntimeAdoptionState.hydrated === true
    && operationalHealthState.status === "healthy";
  const status = blockedBy.length
    ? "blocked"
    : pendingBy.length
      ? "pending"
      : acceptedForSyscallDispatch
        ? "dispatch-ready"
        : "waiting";
  const packageId = handoffSource.packageId || stableId("mailchimp-verifier-syscall-handoff", [
    providerServiceContract.serviceId,
    syncMetadata.syncId,
    previewState.previewId,
    acceptanceState.acceptanceId,
    operationalHealthState.healthId,
    status,
  ]);
  const statusRows = [
    {
      key: "verifier-preview",
      status: previewState.status,
      accepted: validationSummary.status !== "blocked",
      restartSafe: true,
      statusPath: handoffSource.previewStatusPath || null,
      blockedBy: validationSummary.blockingChecks.map((check) => `validation:${check}`),
      pendingBy: validationSummary.pendingChecks.map((check) => `validation:${check}`),
      nextAction: validationSummary.nextAction,
    },
    {
      key: "client-runtime",
      status: clientRuntimeAdoptionState.hydrated ? "hydrated" : "needs-client-state",
      accepted: clientRuntimeAdoptionState.hydrated === true,
      restartSafe: clientRuntimeAdoptionState.hydrated === true,
      statusPath: clientRuntimeAdoptionState.stateKey,
      blockedBy: clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`),
      pendingBy: [],
      nextAction: clientRuntimeAdoptionState.nextAction,
    },
    {
      key: "provider-health",
      status: operationalHealthState.status,
      accepted: operationalHealthState.status === "healthy",
      restartSafe: operationalHealthState.retryPolicy.retryable !== false
        && operationalHealthState.retryPolicy.attempts < operationalHealthState.retryPolicy.maxAttempts,
      statusPath: operationalHealthState.statusChannel,
      blockedBy: operationalHealthState.status === "healthy"
        ? []
        : operationalHealthState.actionableErrors.map((error) => `health:${error.code}`),
      pendingBy: operationalHealthState.retryable ? ["health:retry-scheduled"] : [],
      nextAction: operationalHealthState.nextAction,
    },
    {
      key: "provider-report",
      status: providerReportingState.status,
      accepted: providerReportingState.providerHandoffSummary.acceptedForRuntime === true,
      restartSafe: true,
      statusPath: providerReportingState.providerHandoffSummary.statusChannel,
      blockedBy: providerReportingState.providerHandoffSummary.blockedBy,
      pendingBy: providerReportingState.providerHandoffSummary.pendingBy,
      nextAction: providerReportingState.nextAction,
    },
  ];
  const commands = [
    {
      command: "persist-verifier-syscall-handoff",
      enabled: true,
      idempotencyKey: `verifier-syscall-handoff:${packageId}`,
    },
    {
      command: "schedule-verifier-syscall-health-retry",
      enabled: operationalHealthState.retryable === true,
      delaySeconds: operationalHealthState.nextDelaySeconds,
      idempotencyKey: `verifier-syscall-retry:${stableId("verifier-syscall-retry", [
        packageId,
        operationalHealthState.attempts + 1,
      ])}`,
    },
    {
      command: "release-verifier-syscall-dispatch",
      enabled: acceptedForSyscallDispatch,
      idempotencyKey: `verifier-syscall-release:${stableId("verifier-syscall-release", [
        packageId,
        syncMetadata.syncId,
      ])}`,
    },
  ];

  return {
    format: "aios.mailchimp.verifier.syscallHandoff.v1",
    packageId,
    provider: "mailchimp",
    serviceId: providerServiceContract.serviceId,
    syncId: syncMetadata.syncId,
    previewId: previewState.previewId,
    acceptanceId: acceptanceState.acceptanceId,
    healthId: operationalHealthState.healthId,
    providerReportId: providerReportingState.reportId,
    status,
    acceptedForSyscallDispatch,
    restartSafe: status !== "blocked" && operationalHealthState.status !== "failed",
    retryable: operationalHealthState.retryable === true,
    nextDelaySeconds: operationalHealthState.nextDelaySeconds,
    statusChannel: operationalHealthState.degradedMode
      ? operationalHealthState.statusChannel
      : "verifier.syscall-handoff.mailchimp",
    blockedBy,
    pendingBy,
    statusRows,
    commands,
    incidentSummary: {
      total: operationalHealthState.actionableErrors.length,
      errors: operationalHealthState.actionableErrors
        .filter((error) => error.code?.includes("unavailable") || error.code?.includes("retry-exhausted")).length,
      warnings: operationalHealthState.actionableErrors
        .filter((error) => !error.code?.includes("unavailable") && !error.code?.includes("retry-exhausted")).length,
      retryable: operationalHealthState.retryable ? 1 : 0,
      codes: [...new Set(operationalHealthState.actionableErrors.map((error) => error.code).filter(Boolean))].sort(),
    },
    payloadShape: {
      packageId: "string",
      syncId: "string",
      previewId: "string",
      acceptanceId: "string",
      healthId: "string",
      acceptedForSyscallDispatch: "boolean",
      statusRows: "array",
      blockedBy: "array",
      pendingBy: "array",
      commands: "array",
    },
    nextAction: blockedBy.length
      ? blockedBy[0].startsWith("client-state:")
        ? "hydrate-verifier-client-state"
        : blockedBy[0].startsWith("health:")
          ? operationalHealthState.nextAction
          : validationSummary.nextAction
      : pendingBy.length
        ? pendingBy.includes("external-write:approval-required")
          ? "collect-external-write-approval"
          : operationalHealthState.retryable
            ? "schedule-verifier-syscall-health-retry"
            : providerReportingState.nextAction
        : acceptedForSyscallDispatch
          ? "release-verifier-syscall-dispatch"
          : providerReportingState.nextAction,
  };
}

function buildVerifierTenantDispatchGuard(source, options, syscallHandoffPackage, providerReportingState) {
  const clientRuntime = options.clientRuntime
    || source.clientRuntime
    || source.requestRuntime
    || {};
  const tenantPolicy = options.tenantPolicy
    || source.tenantPolicy
    || source.providerService?.tenantPolicy
    || {};
  const activeBoundary = tenantPolicy.activeBoundary || {};
  const operator = options.operatorControlState
    || source.operatorControlState
    || source.acceptance
    || {};
  const tenantId = activeBoundary.tenantId
    || tenantPolicy.tenantId
    || clientRuntime.tenantId
    || source.tenantId
    || null;
  const workspaceId = activeBoundary.workspaceId
    || tenantPolicy.workspaceId
    || clientRuntime.workspaceId
    || source.workspaceId
    || null;
  const actorRole = operator.actorRole
    || clientRuntime.actorRole
    || activeBoundary.actorRole
    || tenantPolicy.actorRole
    || "operator";
  const allowedRoles = [
    ...asArray(activeBoundary.allowedRoles),
    ...asArray(tenantPolicy.allowedRoles),
    "operator",
    "approver",
    "admin",
  ];
  const uniqueAllowedRoles = [...new Set(allowedRoles)].sort();
  const rolePolicies = asArray(tenantPolicy.rolePolicies);
  const rolePolicy = rolePolicies.find((policy) => policy?.role === actorRole) || {};
  const canDispatch = rolePolicy.canDispatch !== false
    && rolePolicy.canExecute !== false
    && uniqueAllowedRoles.includes(actorRole);
  const canApprove = rolePolicy.canApprove === true
    || actorRole === "approver"
    || actorRole === "admin";
  const externalWriteRequested = syscallHandoffPackage.pendingBy.includes("external-write:approval-required")
    || providerReportingState.providerHandoffSummary.acceptedForExternalWrite === true;
  const requiresApproval = activeBoundary.requiresApprovalForExternalWrite !== false
    && (tenantPolicy.requiresApprovalForExternalWrite !== false || externalWriteRequested);
  const blockedBy = [
    ...(tenantId ? [] : ["tenant:missing"]),
    ...(workspaceId ? [] : ["workspace:missing"]),
    ...(uniqueAllowedRoles.includes(actorRole) ? [] : [`role:${actorRole}:not-allowed`]),
    ...(!canDispatch ? [`role:${actorRole}:cannot-dispatch-verifier-handoff`] : []),
    ...(requiresApproval && externalWriteRequested && !canApprove
      ? [`role:${actorRole}:cannot-approve-external-write`]
      : []),
  ].sort();
  const pendingBy = [
    ...(requiresApproval && externalWriteRequested && canApprove
      && providerReportingState.providerHandoffSummary.acceptedForExternalWrite !== true
      ? ["approval:external-write"]
      : []),
  ];
  const guardId = stableId("mailchimp-verifier-tenant-dispatch-guard", [
    tenantId,
    workspaceId,
    actorRole,
    syscallHandoffPackage.packageId,
    blockedBy,
    pendingBy,
  ]);

  return {
    format: "aios.mailchimp.verifier.tenantDispatchGuard.v1",
    guardId,
    tenantId,
    workspaceId,
    actorRole,
    allowedRoles: uniqueAllowedRoles,
    canDispatch,
    canApprove,
    requiresApproval,
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : "ready",
    acceptedForSyscallDispatch: blockedBy.length === 0
      && pendingBy.length === 0
      && syscallHandoffPackage.acceptedForSyscallDispatch === true,
    restartSafe: blockedBy.length === 0 && syscallHandoffPackage.restartSafe !== false,
    blockedBy,
    pendingBy,
    statusRows: [
      {
        key: "tenant",
        status: tenantId ? "scoped" : "missing",
        accepted: Boolean(tenantId),
        restartSafe: Boolean(tenantId),
        statusPath: tenantId,
        blockedBy: tenantId ? [] : ["tenant:missing"],
        pendingBy: [],
        nextAction: tenantId ? "continue-verifier-dispatch-guard" : "repair-verifier-tenant-boundary",
      },
      {
        key: "workspace",
        status: workspaceId ? "scoped" : "missing",
        accepted: Boolean(workspaceId),
        restartSafe: Boolean(workspaceId),
        statusPath: workspaceId,
        blockedBy: workspaceId ? [] : ["workspace:missing"],
        pendingBy: [],
        nextAction: workspaceId ? "continue-verifier-dispatch-guard" : "repair-verifier-workspace-boundary",
      },
      {
        key: "actor-role",
        status: canDispatch ? "dispatch-allowed" : "blocked",
        accepted: canDispatch,
        restartSafe: canDispatch,
        statusPath: actorRole,
        blockedBy: canDispatch ? [] : [`role:${actorRole}:cannot-dispatch-verifier-handoff`],
        pendingBy,
        nextAction: canDispatch ? "continue-verifier-dispatch-guard" : "repair-verifier-role-policy",
      },
    ],
    commands: [
      {
        command: "persist-verifier-tenant-dispatch-guard",
        enabled: true,
        idempotencyKey: `verifier-tenant-dispatch-guard:${guardId}`,
      },
      {
        command: "release-verifier-tenant-dispatch-guard",
        enabled: blockedBy.length === 0 && pendingBy.length === 0,
        idempotencyKey: `verifier-tenant-dispatch-release:${guardId}`,
      },
    ],
    nextAction: blockedBy.length
      ? blockedBy[0].startsWith("tenant:")
        ? "repair-verifier-tenant-boundary"
        : blockedBy[0].startsWith("workspace:")
          ? "repair-verifier-workspace-boundary"
          : "repair-verifier-role-policy"
      : pendingBy.length
        ? "collect-verifier-dispatch-approval"
        : "release-verifier-tenant-dispatch-guard",
  };
}

function normalizeVerifierLifecycleSettings(source = {}, options = {}) {
  const raw = source.verifierLifecycle
    || source.lifecycle
    || source.settings?.verifier
    || source.settings
    || {};
  const mode = raw.mode || options.verifierMode || "supervised";
  const enabled = raw.enabled !== false && options.enabled !== false;
  const autoAcceptRuntime = raw.autoAcceptRuntime === true || options.autoAcceptRuntime === true;
  const autoPublishReport = raw.autoPublishReport !== false;
  const requireHealthyProvider = raw.requireHealthyProvider !== false;
  const requireHydratedClient = raw.requireHydratedClient !== false;
  const disabledCommands = new Set(asArray(raw.disabledCommands).map(String).filter(Boolean));
  const enabledCommands = new Set(asArray(raw.enabledCommands).map(String).filter(Boolean));
  const schedule = raw.schedule || {};
  const requestedInterval = Number(schedule.everySeconds ?? raw.scheduleEverySeconds ?? 0);
  const everySeconds = Number.isFinite(requestedInterval) && requestedInterval > 0
    ? Math.max(30, Math.floor(requestedInterval))
    : null;
  const maxCommandsPerTick = Number.isFinite(Number(schedule.maxCommandsPerTick ?? raw.maxCommandsPerTick))
    ? Math.max(1, Math.floor(Number(schedule.maxCommandsPerTick ?? raw.maxCommandsPerTick)))
    : 2;
  const validation = [];

  if (!["supervised", "automatic", "disabled"].includes(mode)) {
    validation.push({
      level: "error",
      code: "verifier.lifecycle.mode.invalid",
      field: "verifierLifecycle.mode",
      mode,
    });
  }
  if (mode === "automatic" && requireHealthyProvider === false) {
    validation.push({
      level: "warning",
      code: "verifier.lifecycle.automatic-without-health-gate",
      field: "verifierLifecycle.requireHealthyProvider",
    });
  }
  if (everySeconds != null && everySeconds < 30) {
    validation.push({
      level: "warning",
      code: "verifier.lifecycle.schedule.too-frequent",
      minimumSeconds: 30,
    });
  }

  return {
    mode,
    enabled: enabled && mode !== "disabled",
    autoAcceptRuntime: autoAcceptRuntime || mode === "automatic",
    autoPublishReport,
    requireHealthyProvider,
    requireHydratedClient,
    disabledCommands: [...disabledCommands].sort(),
    enabledCommands: [...enabledCommands].sort(),
    schedule: {
      everySeconds,
      maxCommandsPerTick,
      pauseAfterCommand: schedule.pauseAfterCommand !== false,
    },
    validation,
    commandEnabled(command) {
      if (!enabled || mode === "disabled" || disabledCommands.has(command)) return false;
      return enabledCommands.size === 0 || enabledCommands.has(command);
    },
  };
}

function buildVerifierLifecycleCommandState(
  settings,
  previewState,
  acceptanceState,
  validationSummary,
  clientRuntimeAdoptionState,
  operationalHealthState,
  providerReportingState,
  syscallHandoffPackage,
) {
  const settingsErrors = settings.validation.filter((diagnostic) => diagnostic.level === "error");
  const healthBlocked = settings.requireHealthyProvider && operationalHealthState.status !== "healthy";
  const clientBlocked = settings.requireHydratedClient && clientRuntimeAdoptionState.hydrated !== true;
  const blockedBy = [
    ...settingsErrors.map((diagnostic) => diagnostic.code),
    ...(healthBlocked ? [`health:${operationalHealthState.status}`] : []),
    ...(clientBlocked ? clientRuntimeAdoptionState.missingClientState.map((key) => `client-state:${key}`) : []),
    ...asArray(providerReportingState.providerHandoffSummary.blockedBy),
    ...asArray(syscallHandoffPackage.blockedBy),
  ].sort();
  const pendingBy = [
    ...settings.validation
      .filter((diagnostic) => diagnostic.level === "warning")
      .map((diagnostic) => diagnostic.code),
    ...asArray(providerReportingState.providerHandoffSummary.pendingBy),
    ...asArray(syscallHandoffPackage.pendingBy),
    ...(acceptanceState.runtimeAcceptanceRequired && !acceptanceState.acceptedForRuntime
      ? ["acceptance:runtime-pending"]
      : []),
  ].sort();
  const baseCommands = [
    {
      command: "render-verifier-preview",
      enabled: previewState.status !== "blocked",
      subject: previewState.previewId,
      reason: "Expose verifier findings and candidate shape to the client workflow.",
    },
    {
      command: "hydrate-verifier-client-state",
      enabled: clientRuntimeAdoptionState.hydrated !== true,
      subject: clientRuntimeAdoptionState.stateKey,
      reason: "Persist required request/workflow state before runtime handoff.",
    },
    {
      command: "accept-verifier-runtime",
      enabled: validationSummary.status !== "blocked"
        && !acceptanceState.acceptedForRuntime
        && settings.autoAcceptRuntime,
      subject: acceptanceState.acceptanceId,
      reason: "Automatic verifier lifecycle may accept runtime-safe previews.",
    },
    {
      command: "publish-verifier-provider-report",
      enabled: providerReportingState.status !== "blocked" && settings.autoPublishReport,
      subject: providerReportingState.reportId,
      reason: "Publish provider-facing verifier summary and history snapshots.",
    },
    {
      command: "release-verifier-syscall-dispatch",
      enabled: syscallHandoffPackage.acceptedForSyscallDispatch === true,
      subject: syscallHandoffPackage.packageId,
      reason: "Verifier handoff is accepted by syscall dispatch prerequisites.",
    },
    {
      command: "schedule-verifier-lifecycle-tick",
      enabled: settings.schedule.everySeconds != null
        && (operationalHealthState.retryable || pendingBy.length > 0)
        && blockedBy.length === 0,
      subject: providerReportingState.reportId,
      reason: "Continue supervised verifier workflow on the configured cadence.",
      delaySeconds: settings.schedule.everySeconds,
    },
  ];
  const commands = baseCommands.map((command) => {
    const allowed = settings.commandEnabled(command.command);
    return {
      ...command,
      enabled: settings.enabled && allowed && command.enabled && settingsErrors.length === 0,
      disabledBySettings: settings.enabled ? !allowed : true,
    };
  });
  const enabledCommands = commands.filter((command) => command.enabled)
    .slice(0, settings.schedule.maxCommandsPerTick);
  const status = settingsErrors.length
    ? "settings-blocked"
    : blockedBy.length
      ? "blocked"
      : enabledCommands.length
        ? settings.autoAcceptRuntime
          ? "automatic-ready"
          : "operator-ready"
        : pendingBy.length
          ? "waiting"
          : "complete";

  return {
    lifecycleId: stableId("mailchimp-verifier-lifecycle", [
      previewState.previewId,
      acceptanceState.acceptanceId,
      providerReportingState.reportId,
      syscallHandoffPackage.packageId,
      status,
    ]),
    status,
    mode: settings.mode,
    enabled: settings.enabled && settingsErrors.length === 0,
    blockedBy,
    pendingBy,
    commands,
    nextCommands: enabledCommands,
    settings: {
      mode: settings.mode,
      enabled: settings.enabled,
      autoAcceptRuntime: settings.autoAcceptRuntime,
      autoPublishReport: settings.autoPublishReport,
      requireHealthyProvider: settings.requireHealthyProvider,
      requireHydratedClient: settings.requireHydratedClient,
      disabledCommands: settings.disabledCommands,
      enabledCommands: settings.enabledCommands,
      schedule: settings.schedule,
      validation: settings.validation,
    },
    nextAction: settingsErrors.length
      ? "repair-verifier-lifecycle-settings"
      : blockedBy.length
        ? blockedBy[0].startsWith("client-state:")
          ? "hydrate-verifier-client-state"
          : blockedBy[0].startsWith("health:")
            ? operationalHealthState.nextAction
            : providerReportingState.nextAction
        : enabledCommands[0]?.command || providerReportingState.nextAction,
  };
}

function normalizeSyscallControlPlaneForVerifier(source, options, syscallHandoffPackage, lifecycleCommandState) {
  const packet = options.syscallControlPlane
    || source.syscallControlPlane
    || source.controlPlaneState
    || source.syscallHandoff?.controlPlaneState
    || {};
  const present = packet.format === "aios.mailchimp.syscall.controlPlane.v1"
    || Boolean(packet.controlPlaneId || packet.persistedState?.batchId);
  const blockedBy = asArray(packet.blockedBy).map((blocker) => `syscall-control:${blocker}`).sort();
  const pendingBy = asArray(packet.pendingBy).map((pending) => `syscall-control:${pending}`).sort();
  const persisted = packet.persistedState || {};
  const enabledCommands = asArray(packet.enabledCommands);
  const handoffReady = present
    && blockedBy.length === 0
    && !pendingBy.some((pending) => pending.includes("approval:"))
    && (packet.status === "handoff-ready" || enabledCommands.includes("handoff-syscall-control-plane"))
    && syscallHandoffPackage.acceptedForSyscallDispatch === true;
  const status = !present
    ? "not-provided"
    : blockedBy.length
      ? "blocked"
      : handoffReady
        ? "handoff-ready"
        : pendingBy.length
          ? "pending"
          : "observing";
  const commands = [
    {
      command: "persist-verifier-syscall-control-plane",
      enabled: present,
      idempotencyKey: `verifier-syscall-control:${packet.controlPlaneId || syscallHandoffPackage.packageId}`,
    },
    {
      command: "wait-for-syscall-control-plane",
      enabled: !present || status === "pending",
      idempotencyKey: `verifier-syscall-control-wait:${syscallHandoffPackage.packageId}`,
    },
    {
      command: "release-verifier-syscall-control-plane",
      enabled: handoffReady && lifecycleCommandState.enabled === true,
      idempotencyKey: `verifier-syscall-control-release:${packet.controlPlaneId || syscallHandoffPackage.packageId}`,
    },
  ];

  return {
    format: "aios.mailchimp.verifier.syscallControlPlane.v1",
    present,
    controlPlaneId: packet.controlPlaneId || null,
    status,
    provider: "mailchimp",
    upstreamStatus: packet.status || "unknown",
    statusChannel: packet.statusChannel || "syscall.control.mailchimp",
    blockedBy,
    pendingBy,
    persistedState: {
      batchId: persisted.batchId || null,
      handoffId: persisted.handoffId || null,
      serviceId: persisted.serviceId || null,
      scheduleId: persisted.scheduleId || null,
      restartJournalId: persisted.restartJournalId || null,
      acceptedForRuntime: persisted.acceptedForRuntime === true,
      restartSafe: persisted.restartSafe === true,
      nextAction: persisted.nextAction || null,
    },
    commands,
    acceptedForVerifierHandoff: handoffReady && lifecycleCommandState.enabled === true,
    nextAction: !present
      ? "wait-for-syscall-control-plane"
      : blockedBy.length
        ? "repair-syscall-control-plane"
        : pendingBy.length
          ? "wait-for-syscall-control-plane"
          : handoffReady
            ? "release-verifier-syscall-control-plane"
            : syscallHandoffPackage.nextAction,
  };
}

function buildVerifierSyscallAdoptionPacket(source, options, syscallHandoffPackage, syscallControlPlaneState) {
  const upstream = options.syscallProviderGateSummary
    || source.syscallProviderGateSummary
    || source.providerGateSummary
    || source.downstreamSyscallGateSummary
    || {};
  const gates = asArray(upstream.gates).map((gate) => ({
    gate: gate.gate || gate.key || "unknown",
    status: gate.status || "unknown",
    accepted: gate.accepted === true,
    restartSafe: gate.restartSafe !== false,
    packetId: gate.packetId || gate.packageId || null,
    blockedBy: asArray(gate.blockedBy).sort(),
    pendingBy: asArray(gate.pendingBy).sort(),
    nextAction: gate.nextAction || upstream.nextAction || "review-syscall-provider-gate",
  }));
  const blockedBy = [
    ...asArray(upstream.blockedBy).map((blocker) => `upstream:${blocker}`),
    ...gates.flatMap((gate) => gate.blockedBy.map((blocker) => `${gate.gate}:${blocker}`)),
    ...asArray(syscallControlPlaneState.blockedBy).map((blocker) => `control:${blocker}`),
  ].sort();
  const pendingBy = [
    ...asArray(upstream.pendingBy).map((pending) => `upstream:${pending}`),
    ...gates.flatMap((gate) => gate.pendingBy.map((pending) => `${gate.gate}:${pending}`)),
    ...asArray(syscallControlPlaneState.pendingBy).map((pending) => `control:${pending}`),
  ].sort();
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && syscallControlPlaneState.acceptedForVerifierHandoff === true
    && (upstream.releaseReady === true || gates.length === 0);
  const status = blockedBy.length ? "blocked" : pendingBy.length ? "pending" : releaseReady ? "release-ready" : "observing";

  return {
    format: "aios.mailchimp.verifier.syscallAdoption.v1",
    adoptionId: stableId("mailchimp-verifier-syscall-adoption", [
      syscallHandoffPackage.packageId,
      syscallControlPlaneState.controlPlaneId,
      upstream.summaryId || upstream.packetId || null,
      status,
    ]),
    status,
    releaseReady,
    syscallHandoffPackageId: syscallHandoffPackage.packageId,
    syscallControlPlaneId: syscallControlPlaneState.controlPlaneId,
    upstreamSummaryId: upstream.summaryId || upstream.packetId || null,
    statusChannel: syscallControlPlaneState.statusChannel || upstream.statusChannel || "verifier.syscall-adoption.mailchimp",
    gates,
    blockedBy,
    pendingBy,
    commands: [
      {
        command: "persist-verifier-syscall-adoption",
        enabled: true,
        idempotencyKey: `verifier-syscall-adoption:${syscallHandoffPackage.packageId}`,
      },
      {
        command: "release-verifier-syscall-adoption",
        enabled: releaseReady,
        idempotencyKey: `verifier-syscall-release:${syscallControlPlaneState.controlPlaneId || syscallHandoffPackage.packageId}`,
      },
    ],
    nextAction: blockedBy.length
      ? syscallControlPlaneState.nextAction
      : pendingBy.length
        ? upstream.nextAction || syscallControlPlaneState.nextAction
        : releaseReady
          ? "release-verifier-syscall-adoption"
          : syscallHandoffPackage.nextAction,
  };
}

function buildVerifierRecoveryExportEnvelope(
  source,
  providerServiceContract,
  validationSummary,
  operationalHealthState,
  providerReportingState,
  syscallHandoffPackage,
  tenantDispatchGuard,
  syscallAdoptionPacket,
) {
  const exportSource = source.recoveryExport
    || source.recovery?.export
    || source.providerService?.recoveryExport
    || {};
  const blockedBy = [
    ...asArray(validationSummary.blockingChecks).map((check) => `validation:${check}`),
    ...asArray(operationalHealthState.actionableErrors)
      .filter((error) => error.code)
      .map((error) => `health:${error.code}`),
    ...asArray(syscallHandoffPackage.blockedBy).map((blocker) => `syscall:${blocker}`),
    ...asArray(tenantDispatchGuard.blockedBy).map((blocker) => `tenant:${blocker}`),
    ...asArray(syscallAdoptionPacket.blockedBy).map((blocker) => `adoption:${blocker}`),
    ...asArray(exportSource.blockedBy),
  ].sort();
  const pendingBy = [
    ...asArray(validationSummary.pendingChecks).map((check) => `validation:${check}`),
    ...(operationalHealthState.retryable ? ["health:retry-scheduled"] : []),
    ...asArray(syscallHandoffPackage.pendingBy).map((pending) => `syscall:${pending}`),
    ...asArray(tenantDispatchGuard.pendingBy).map((pending) => `tenant:${pending}`),
    ...asArray(syscallAdoptionPacket.pendingBy).map((pending) => `adoption:${pending}`),
    ...asArray(exportSource.pendingBy),
  ].sort();
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && validationSummary.status === "ready"
    && operationalHealthState.status === "healthy"
    && syscallHandoffPackage.acceptedForSyscallDispatch === true
    && tenantDispatchGuard.acceptedForSyscallDispatch === true
    && syscallAdoptionPacket.releaseReady === true;
  const restartSafe = releaseReady
    && operationalHealthState.persistedState?.status === "healthy"
    && syscallHandoffPackage.restartSafe !== false
    && tenantDispatchGuard.restartSafe !== false
    && syscallAdoptionPacket.restartSafe !== false;
  const envelopeId = stableId("mailchimp-verifier-recovery-export", [
    providerServiceContract.serviceId,
    providerReportingState.reportId,
    syscallHandoffPackage.packageId,
    tenantDispatchGuard.guardId,
    syscallAdoptionPacket.adoptionId,
    blockedBy,
    pendingBy,
  ]);
  const rows = [
    {
      key: "provider-service",
      packetId: providerServiceContract.serviceId,
      status: providerServiceContract.status,
      accepted: providerServiceContract.status === "negotiated",
      restartSafe: providerServiceContract.missingCapabilities.length === 0,
      nextAction: providerServiceContract.missingCapabilities.length
        ? "refresh-provider-service-capabilities"
        : "continue-verifier-recovery-export",
    },
    {
      key: "operational-health",
      packetId: operationalHealthState.healthId,
      status: operationalHealthState.status,
      accepted: operationalHealthState.status === "healthy",
      restartSafe: operationalHealthState.status === "healthy" && operationalHealthState.retryable === false,
      nextAction: operationalHealthState.nextAction,
    },
    {
      key: "provider-report",
      packetId: providerReportingState.reportId,
      status: providerReportingState.status,
      accepted: providerReportingState.status === "ready",
      restartSafe: asArray(providerReportingState.providerHandoffSummary?.blockedBy).length === 0,
      nextAction: providerReportingState.nextAction,
    },
    {
      key: "syscall-handoff",
      packetId: syscallHandoffPackage.packageId,
      status: syscallHandoffPackage.status,
      accepted: syscallHandoffPackage.acceptedForSyscallDispatch === true,
      restartSafe: syscallHandoffPackage.restartSafe !== false,
      nextAction: syscallHandoffPackage.nextAction,
    },
    {
      key: "tenant-dispatch-guard",
      packetId: tenantDispatchGuard.guardId,
      status: tenantDispatchGuard.status,
      accepted: tenantDispatchGuard.acceptedForSyscallDispatch === true,
      restartSafe: tenantDispatchGuard.restartSafe !== false,
      nextAction: tenantDispatchGuard.nextAction,
    },
    {
      key: "syscall-adoption",
      packetId: syscallAdoptionPacket.adoptionId,
      status: syscallAdoptionPacket.status,
      accepted: syscallAdoptionPacket.releaseReady === true,
      restartSafe: syscallAdoptionPacket.restartSafe !== false,
      nextAction: syscallAdoptionPacket.nextAction,
    },
  ];

  return {
    format: "aios.mailchimp.verifier.recoveryExportEnvelope.v1",
    envelopeId,
    provider: "mailchimp",
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : releaseReady ? "export-ready" : "observing",
    releaseReady,
    acceptedForClaimRuntime: releaseReady,
    restartSafe,
    statusChannel: exportSource.statusChannel || "verifier.recovery-export.mailchimp",
    blockedBy,
    pendingBy,
    rows,
    exportSummary: {
      exportKind: "mailchimp.verifierRecoveryExport.summary",
      status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : "ready",
      rows: rows.map((row) => ({
        key: row.key,
        status: row.status,
        accepted: row.accepted,
        restartSafe: row.restartSafe,
        nextAction: row.nextAction,
      })),
      counters: {
        rows: rows.length,
        accepted: rows.filter((row) => row.accepted).length,
        blocked: blockedBy.length,
        pending: pendingBy.length,
        restartSafe: rows.filter((row) => row.restartSafe).length,
      },
    },
    commands: [
      {
        command: "persist-verifier-recovery-export",
        enabled: true,
        idempotencyKey: `verifier-recovery-export:${envelopeId}`,
      },
      {
        command: "publish-verifier-recovery-export",
        enabled: releaseReady,
        idempotencyKey: `verifier-recovery-export-publish:${envelopeId}`,
      },
      {
        command: "schedule-verifier-recovery-export-retry",
        enabled: pendingBy.length > 0 && blockedBy.length === 0,
        delaySeconds: operationalHealthState.retryPolicy?.nextDelaySeconds || 60,
        idempotencyKey: `verifier-recovery-export-retry:${stableId("verifier-recovery-export-retry", [
          envelopeId,
          pendingBy,
        ])}`,
      },
    ],
    nextAction: blockedBy.length
      ? blockedBy[0].startsWith("health:")
        ? operationalHealthState.nextAction
        : blockedBy[0].startsWith("tenant:")
          ? tenantDispatchGuard.nextAction
          : syscallHandoffPackage.nextAction
      : pendingBy.length
        ? "schedule-verifier-recovery-export-retry"
        : releaseReady
          ? "publish-verifier-recovery-export"
          : syscallAdoptionPacket.nextAction,
  };
}

function buildVerifierClaimAdoptionReceipt(
  source,
  recoveryExportEnvelope,
  previewState,
  acceptanceState,
  clientRuntimeAdoptionState,
  syscallAdoptionPacket,
) {
  const receiptSource = source.claimAdoptionReceipt
    || source.claimRuntimeAdoption
    || source.recovery?.claimAdoptionReceipt
    || {};
  const requiredRuntimeKeys = [
    "requestId",
    "workflowId",
    "previewId",
    "acceptanceId",
    "recoveryEnvelopeId",
    ...asArray(receiptSource.requiredRuntimeKeys),
  ];
  const observedRuntimeState = {
    requestId: clientRuntimeAdoptionState.requestId || null,
    workflowId: clientRuntimeAdoptionState.workflowId || null,
    previewId: previewState.previewId,
    acceptanceId: acceptanceState.acceptanceId,
    recoveryEnvelopeId: recoveryExportEnvelope.envelopeId,
    syscallAdoptionId: syscallAdoptionPacket.adoptionId,
    ...receiptSource.runtimeState,
  };
  const missingRuntimeKeys = [...new Set(requiredRuntimeKeys)]
    .filter((key) => observedRuntimeState[key] == null)
    .sort();
  const blockedBy = [
    ...asArray(recoveryExportEnvelope.blockedBy).map((blocker) => `recovery-export:${blocker}`),
    ...missingRuntimeKeys.map((key) => `runtime-state:${key}`),
    ...(recoveryExportEnvelope.acceptedForClaimRuntime === true ? [] : ["recovery-export:not-accepted"]),
    ...(syscallAdoptionPacket.releaseReady === true ? [] : ["syscall-adoption:not-released"]),
    ...(acceptanceState.acceptedForRuntime === true ? [] : ["verifier-acceptance:not-accepted"]),
    ...asArray(receiptSource.blockedBy),
  ].sort();
  const pendingBy = [
    ...asArray(recoveryExportEnvelope.pendingBy).map((pending) => `recovery-export:${pending}`),
    ...asArray(syscallAdoptionPacket.pendingBy).map((pending) => `syscall-adoption:${pending}`),
    ...asArray(receiptSource.pendingBy),
  ].sort();
  const acceptedForClaimRuntime = blockedBy.length === 0
    && pendingBy.length === 0
    && recoveryExportEnvelope.acceptedForClaimRuntime === true
    && clientRuntimeAdoptionState.hydrated === true;
  const restartSafe = acceptedForClaimRuntime
    && recoveryExportEnvelope.restartSafe === true
    && syscallAdoptionPacket.restartSafe !== false;
  const receiptId = receiptSource.receiptId || stableId("mailchimp-verifier-claim-adoption", [
    recoveryExportEnvelope.envelopeId,
    previewState.previewId,
    acceptanceState.acceptanceId,
    observedRuntimeState.requestId,
    blockedBy,
    pendingBy,
  ]);

  return {
    format: "aios.mailchimp.verifier.claimAdoptionReceipt.v1",
    receiptId,
    sourceEnvelopeId: recoveryExportEnvelope.envelopeId,
    previewId: previewState.previewId,
    acceptanceId: acceptanceState.acceptanceId,
    syscallAdoptionId: syscallAdoptionPacket.adoptionId,
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : acceptedForClaimRuntime ? "claim-ready" : "waiting",
    acceptedForClaimRuntime,
    restartSafe,
    runtimeState: observedRuntimeState,
    requiredRuntimeKeys: [...new Set(requiredRuntimeKeys)].sort(),
    missingRuntimeKeys,
    blockedBy,
    pendingBy,
    rows: [
      {
        key: "verifier-recovery-export",
        status: recoveryExportEnvelope.status,
        accepted: recoveryExportEnvelope.acceptedForClaimRuntime === true,
        restartSafe: recoveryExportEnvelope.restartSafe === true,
        blockedBy: asArray(recoveryExportEnvelope.blockedBy),
        pendingBy: asArray(recoveryExportEnvelope.pendingBy),
        nextAction: recoveryExportEnvelope.nextAction,
      },
      {
        key: "verifier-client-runtime",
        status: clientRuntimeAdoptionState.hydrated ? "hydrated" : "needs-client-state",
        accepted: clientRuntimeAdoptionState.hydrated === true,
        restartSafe: clientRuntimeAdoptionState.hydrated === true,
        blockedBy: missingRuntimeKeys.map((key) => `runtime-state:${key}`),
        pendingBy: [],
        nextAction: clientRuntimeAdoptionState.userVisibleWorkflow?.nextAction || "hydrate-verifier-client-state",
      },
      {
        key: "verifier-syscall-adoption",
        status: syscallAdoptionPacket.status,
        accepted: syscallAdoptionPacket.releaseReady === true,
        restartSafe: syscallAdoptionPacket.restartSafe !== false,
        blockedBy: asArray(syscallAdoptionPacket.blockedBy),
        pendingBy: asArray(syscallAdoptionPacket.pendingBy),
        nextAction: syscallAdoptionPacket.nextAction,
      },
    ],
    commands: [
      {
        command: "persist-verifier-claim-adoption-receipt",
        enabled: true,
        idempotencyKey: `verifier-claim-adoption:${receiptId}`,
      },
      {
        command: "release-verifier-claim-runtime",
        enabled: acceptedForClaimRuntime,
        idempotencyKey: `verifier-claim-runtime-release:${receiptId}`,
      },
    ],
    nextAction: blockedBy.length
      ? missingRuntimeKeys.length
        ? "hydrate-verifier-claim-runtime-state"
        : recoveryExportEnvelope.nextAction
      : pendingBy.length
        ? "wait-for-verifier-claim-adoption"
        : acceptedForClaimRuntime
          ? "release-verifier-claim-runtime"
          : "review-verifier-claim-adoption",
  };
}

function buildVerifierRecoveryTriageReceipt(
  providerServiceContract,
  operationalHealthState,
  lifecycleCommandState,
  syscallControlPlaneState,
  recoveryExportEnvelope,
  claimAdoptionReceipt,
) {
  const triageRows = [
    {
      gate: "provider-health",
      status: operationalHealthState.status,
      accepted: operationalHealthState.status === "healthy",
      restartSafe: operationalHealthState.status !== "failed",
      stateKey: operationalHealthState.healthId,
      blockedBy: operationalHealthState.status === "healthy"
        ? []
        : operationalHealthState.actionableErrors.map((error) => `health:${error.code}`),
      pendingBy: operationalHealthState.retryable ? ["health:retry-scheduled"] : [],
      nextAction: operationalHealthState.nextAction,
    },
    {
      gate: "lifecycle-commands",
      status: lifecycleCommandState.status,
      accepted: lifecycleCommandState.enabled === true && lifecycleCommandState.status !== "settings-blocked",
      restartSafe: lifecycleCommandState.status !== "settings-blocked",
      stateKey: lifecycleCommandState.lifecycleId,
      blockedBy: asArray(lifecycleCommandState.blockedBy),
      pendingBy: asArray(lifecycleCommandState.pendingBy),
      nextAction: lifecycleCommandState.nextAction,
    },
    {
      gate: "syscall-control-plane",
      status: syscallControlPlaneState.status,
      accepted: !syscallControlPlaneState.present || syscallControlPlaneState.acceptedForVerifierHandoff === true,
      restartSafe: !syscallControlPlaneState.present || syscallControlPlaneState.restartSafe !== false,
      stateKey: syscallControlPlaneState.controlPlaneId || null,
      blockedBy: asArray(syscallControlPlaneState.blockedBy),
      pendingBy: asArray(syscallControlPlaneState.pendingBy),
      nextAction: syscallControlPlaneState.nextAction,
    },
    {
      gate: "recovery-export",
      status: recoveryExportEnvelope.status,
      accepted: recoveryExportEnvelope.acceptedForClaimRuntime === true,
      restartSafe: recoveryExportEnvelope.restartSafe === true,
      stateKey: recoveryExportEnvelope.envelopeId,
      blockedBy: asArray(recoveryExportEnvelope.blockedBy),
      pendingBy: asArray(recoveryExportEnvelope.pendingBy),
      nextAction: recoveryExportEnvelope.nextAction,
    },
    {
      gate: "claim-adoption",
      status: claimAdoptionReceipt.status,
      accepted: claimAdoptionReceipt.acceptedForClaimRuntime === true,
      restartSafe: claimAdoptionReceipt.restartSafe !== false,
      stateKey: claimAdoptionReceipt.receiptId,
      blockedBy: asArray(claimAdoptionReceipt.blockedBy),
      pendingBy: asArray(claimAdoptionReceipt.pendingBy),
      nextAction: claimAdoptionReceipt.nextAction,
    },
  ];
  const blockedBy = triageRows
    .flatMap((row) => row.blockedBy.map((blocker) => `${row.gate}:${blocker}`))
    .sort();
  const pendingBy = triageRows
    .flatMap((row) => row.pendingBy.map((pending) => `${row.gate}:${pending}`))
    .sort();
  const retryable = operationalHealthState.retryable === true
    || triageRows.some((row) => row.pendingBy.some((pending) => pending.includes("retry")));
  const releaseReady = blockedBy.length === 0
    && pendingBy.length === 0
    && triageRows.every((row) => row.accepted && row.restartSafe !== false);
  const receiptId = stableId("mailchimp-verifier-recovery-triage", [
    providerServiceContract.serviceId,
    operationalHealthState.healthId,
    lifecycleCommandState.lifecycleId,
    syscallControlPlaneState.controlPlaneId,
    recoveryExportEnvelope.envelopeId,
    claimAdoptionReceipt.receiptId,
    triageRows.map((row) => [row.gate, row.status]),
  ]);

  return {
    format: "aios.mailchimp.verifier.recoveryTriageReceipt.v1",
    receiptId,
    status: blockedBy.length ? "blocked" : pendingBy.length ? "pending" : releaseReady ? "recovery-ready" : "waiting",
    releaseReady,
    acceptedForSyscallDispatch: releaseReady,
    acceptedForClaimRuntime: releaseReady && claimAdoptionReceipt.acceptedForClaimRuntime === true,
    restartSafe: triageRows.every((row) => row.restartSafe !== false),
    retryable,
    nextDelaySeconds: retryable ? operationalHealthState.nextDelaySeconds : null,
    statusChannel: retryable ? operationalHealthState.statusChannel : "verifier.recovery.mailchimp",
    blockedBy,
    pendingBy,
    triageRows,
    commands: [
      {
        command: "persist-verifier-recovery-triage-receipt",
        enabled: true,
        idempotencyKey: `verifier-recovery-triage:${receiptId}`,
      },
      {
        command: "schedule-verifier-recovery-triage-retry",
        enabled: retryable,
        delaySeconds: operationalHealthState.nextDelaySeconds,
        idempotencyKey: `verifier-recovery-triage-retry:${stableId("verifier-recovery-triage-retry", [
          receiptId,
          operationalHealthState.attempts + 1,
        ])}`,
      },
      {
        command: "release-verifier-recovery-to-claim",
        enabled: releaseReady,
        idempotencyKey: `verifier-recovery-claim-release:${receiptId}`,
      },
    ],
    nextAction: blockedBy.length
      ? triageRows.find((row) => row.blockedBy.length)?.nextAction || "repair-verifier-recovery-triage"
      : pendingBy.length
        ? triageRows.find((row) => row.pendingBy.length)?.nextAction || "wait-verifier-recovery-triage"
        : releaseReady
          ? "release-verifier-recovery-to-claim"
          : recoveryExportEnvelope.nextAction,
  };
}

export function analyzeMailchimpVerifier(source = {}, options = {}) {
  const contract = compileMailchimpVerifier(source.rules ? source : source.verifier || source, options);
  const candidate = options.candidate || source.candidate || defaultCandidate(source);
  const context = {
    hasExternalWrite: options.hasExternalWrite === true || source.hasExternalWrite === true,
    approvalTokenAccepted: options.approvalTokenAccepted === true || source.approvalTokenAccepted === true,
  };
  const evaluation = evaluateMailchimpVerifier(contract, candidate, context);
  const findingSummary = summarizeFindings(evaluation.findings);
  const completeness = inferCandidateCompleteness(contract, candidate);
  const acceptedForRuntime = evaluation.readiness.acceptedForRuntime && completeness.complete;
  const acceptedForExternalWrite = evaluation.readiness.acceptedForExternalWrite && context.approvalTokenAccepted === true;
  const providerServiceContract = inferProviderServiceContract(source, contract, context);
  const capabilityNegotiation = buildCapabilityNegotiation(providerServiceContract, evaluation, completeness);
  const acceptedForProviderHandoff = acceptedForRuntime && capabilityNegotiation.status === "accepted";
  const syncMetadata = buildSyncMetadata(
    source,
    providerServiceContract,
    acceptedForProviderHandoff,
    acceptedForExternalWrite,
  );
  const previewState = buildVerifierPreviewState(
    contract,
    candidate,
    evaluation,
    completeness,
    providerServiceContract,
  );
  const acceptanceState = buildVerifierAcceptanceState(
    source,
    options,
    evaluation,
    previewState,
    acceptedForProviderHandoff,
    acceptedForExternalWrite,
  );
  const validationSummary = buildValidationSummary(
    providerServiceContract,
    capabilityNegotiation,
    previewState,
    acceptanceState,
  );
  const clientRuntimeAdoptionState = buildClientRuntimeAdoptionState(
    source,
    candidate,
    previewState,
    acceptanceState,
    validationSummary,
    syncMetadata,
  );
  const operationalHealthState = buildVerifierOperationalHealthState(
    source,
    providerServiceContract,
    capabilityNegotiation,
    validationSummary,
    clientRuntimeAdoptionState,
    syncMetadata,
  );
  const providerReportingState = buildVerifierProviderReportingState(
    source,
    providerServiceContract,
    capabilityNegotiation,
    syncMetadata,
    previewState,
    acceptanceState,
    validationSummary,
    clientRuntimeAdoptionState,
    operationalHealthState,
    findingSummary,
  );
  const syscallHandoffPackage = buildVerifierSyscallHandoffPackage(
    source,
    providerServiceContract,
    syncMetadata,
    previewState,
    acceptanceState,
    validationSummary,
    clientRuntimeAdoptionState,
    operationalHealthState,
    providerReportingState,
  );
  const tenantDispatchGuard = buildVerifierTenantDispatchGuard(
    source,
    options,
    syscallHandoffPackage,
    providerReportingState,
  );
  syscallHandoffPackage.tenantDispatchGuard = tenantDispatchGuard;
  syscallHandoffPackage.acceptedForSyscallDispatch = syscallHandoffPackage.acceptedForSyscallDispatch
    && tenantDispatchGuard.acceptedForSyscallDispatch;
  syscallHandoffPackage.blockedBy = [
    ...asArray(syscallHandoffPackage.blockedBy),
    ...tenantDispatchGuard.blockedBy.map((blocker) => `tenant-dispatch:${blocker}`),
  ].sort();
  syscallHandoffPackage.pendingBy = [
    ...asArray(syscallHandoffPackage.pendingBy),
    ...tenantDispatchGuard.pendingBy.map((pending) => `tenant-dispatch:${pending}`),
  ].sort();
  syscallHandoffPackage.status = syscallHandoffPackage.blockedBy.length
    ? "blocked"
    : syscallHandoffPackage.pendingBy.length
      ? "pending"
      : syscallHandoffPackage.acceptedForSyscallDispatch
        ? "dispatch-ready"
        : syscallHandoffPackage.status;
  syscallHandoffPackage.nextAction = syscallHandoffPackage.blockedBy
    .some((blocker) => blocker.startsWith("tenant-dispatch:"))
    ? tenantDispatchGuard.nextAction
    : syscallHandoffPackage.pendingBy.some((pending) => pending.startsWith("tenant-dispatch:"))
      ? tenantDispatchGuard.nextAction
      : syscallHandoffPackage.nextAction;
  const lifecycleSettings = normalizeVerifierLifecycleSettings(source, options);
  const lifecycleCommandState = buildVerifierLifecycleCommandState(
    lifecycleSettings,
    previewState,
    acceptanceState,
    validationSummary,
    clientRuntimeAdoptionState,
    operationalHealthState,
    providerReportingState,
    syscallHandoffPackage,
  );
  const syscallControlPlaneState = normalizeSyscallControlPlaneForVerifier(
    source,
    options,
    syscallHandoffPackage,
    lifecycleCommandState,
  );
  const syscallAdoptionPacket = buildVerifierSyscallAdoptionPacket(
    source,
    options,
    syscallHandoffPackage,
    syscallControlPlaneState,
  );
  const recoveryExportEnvelope = buildVerifierRecoveryExportEnvelope(
    source,
    providerServiceContract,
    validationSummary,
    operationalHealthState,
    providerReportingState,
    syscallHandoffPackage,
    tenantDispatchGuard,
    syscallAdoptionPacket,
  );
  const claimAdoptionReceipt = buildVerifierClaimAdoptionReceipt(
    source,
    recoveryExportEnvelope,
    previewState,
    acceptanceState,
    clientRuntimeAdoptionState,
    syscallAdoptionPacket,
  );
  recoveryExportEnvelope.claimAdoptionReceipt = claimAdoptionReceipt;
  const recoveryTriageReceipt = buildVerifierRecoveryTriageReceipt(
    providerServiceContract,
    operationalHealthState,
    lifecycleCommandState,
    syscallControlPlaneState,
    recoveryExportEnvelope,
    claimAdoptionReceipt,
  );
  recoveryExportEnvelope.recoveryTriageReceipt = recoveryTriageReceipt;

  return {
    kind: "aios.semantic.verifierAnalysis",
    version: MAILCHIMP_VERIFIER_ANALYSIS_VERSION,
    provider: "mailchimp",
    status: acceptedForProviderHandoff
      ? findingSummary.warnings
        ? "ready-with-warnings"
        : "ready"
      : capabilityNegotiation.status === "accepted"
        ? "blocked"
        : "provider-negotiation-required",
    contract,
    candidateShape: completeness,
    evaluation,
    verifierContract: {
      requiredClaims: (contract.rules || []).map((rule) => ({
        name: rule.id,
        path: rule.path,
        severity: rule.severity,
        observed: !completeness.missingPaths.includes(rule.path),
      })),
      strict: true,
      missingClaims: evaluation.findings
        .filter((finding) => finding.severity === "error")
        .map((finding) => finding.ruleId)
        .sort(),
    },
    providerServiceContract,
    capabilityNegotiation,
    syncMetadata,
    previewState,
    acceptanceState,
    validationSummary,
    clientRuntimeAdoptionState,
    operationalHealthState,
    providerReportingState,
    syscallHandoffPackage,
    tenantDispatchGuard,
    syscallAdoptionPacket,
    claimAdoptionReceipt,
    providerHandoffSummary: providerReportingState.providerHandoffSummary,
    exportSummary: providerReportingState.exportSummary,
    historySnapshots: providerReportingState.historySnapshots,
    timelineState: {
      ...providerReportingState.timelineState,
      lifecycle: {
        lifecycleId: lifecycleCommandState.lifecycleId,
        status: lifecycleCommandState.status,
        nextAction: lifecycleCommandState.nextAction,
        nextCommands: lifecycleCommandState.nextCommands.map((command) => command.command),
      },
      syscallControlPlane: {
        present: syscallControlPlaneState.present,
        status: syscallControlPlaneState.status,
        statusChannel: syscallControlPlaneState.statusChannel,
        nextAction: syscallControlPlaneState.nextAction,
      },
      syscallAdoption: {
        adoptionId: syscallAdoptionPacket.adoptionId,
        status: syscallAdoptionPacket.status,
        nextAction: syscallAdoptionPacket.nextAction,
      },
    },
    lifecycleCommandState,
    syscallControlPlaneState,
    recoveryExportEnvelope,
    recoveryTriageReceipt,
    adapterHandoff: {
      statusChannel: operationalHealthState.degradedMode
        ? operationalHealthState.statusChannel
        : "verifier.status.mailchimp",
      acceptedForRuntime: acceptedForProviderHandoff
        && acceptanceState.acceptedForRuntime
        && clientRuntimeAdoptionState.hydrated
        && operationalHealthState.status === "healthy",
      acceptedForExternalWrite: acceptedForExternalWrite && acceptedForProviderHandoff && acceptanceState.acceptedForExternalWrite,
      providerService: providerServiceContract.providerService,
      syncId: syncMetadata.syncId,
      providerReportId: providerReportingState.reportId,
      previewId: previewState.previewId,
      acceptanceId: acceptanceState.acceptanceId,
      missingClientState: [
        ...new Set([
          ...asArray(evaluation.runtimeHandoff.missingClientState),
          ...clientRuntimeAdoptionState.missingClientState,
        ]),
      ].sort(),
      payload: evaluation.runtimeHandoff.payload,
      nextAction: !clientRuntimeAdoptionState.hydrated
        ? "hydrate-verifier-client-state"
        : operationalHealthState.status !== "healthy"
        ? operationalHealthState.nextAction
        : validationSummary.status !== "ready"
        ? validationSummary.nextAction
        : capabilityNegotiation.status !== "accepted"
        ? capabilityNegotiation.nextAction
        : acceptedForExternalWrite || !context.hasExternalWrite
          ? syncMetadata.nextAction
          : "collect-external-write-approval",
    },
    recovery: {
      restartSafe: true,
      retryable: !acceptedForProviderHandoff,
      requiredClientState: [
        ...new Set([
          ...asArray(evaluation.runtimeHandoff.requiredClientState),
          ...clientRuntimeAdoptionState.requiredClientState,
        ]),
      ].sort(),
      resumeAfter: clientRuntimeAdoptionState.hydrated
        ? acceptedForProviderHandoff ? "runtime-adapter-ack" : capabilityNegotiation.nextAction
        : "hydrate-verifier-client-state",
      persistedStateKey: clientRuntimeAdoptionState.stateKey,
      operationalHealth: operationalHealthState,
      idempotentCommands: operationalHealthState.commands
        .filter((command) => command.idempotencyKey)
        .map((command) => ({
          command: command.command,
          idempotencyKey: command.idempotencyKey,
          enabled: command.enabled,
        })),
      retryPlan: operationalHealthState.retryPolicy,
      providerReportCommands: providerReportingState.commands,
      lifecycleCommands: lifecycleCommandState.commands
        .filter((command) => command.enabled)
        .map((command) => ({
          command: command.command,
          subject: command.subject,
          delaySeconds: command.delaySeconds ?? null,
        })),
      syscallControlPlaneCommands: syscallControlPlaneState.commands
        .filter((command) => command.enabled)
        .map((command) => ({
          command: command.command,
          idempotencyKey: command.idempotencyKey,
        })),
      syscallControlPlaneState,
      syscallHandoffPackage,
      tenantDispatchGuard,
      syscallAdoptionPacket,
      claimAdoptionReceipt,
      recoveryExportEnvelope,
      recoveryTriageReceipt,
      recoveryExportCommands: recoveryExportEnvelope.commands,
      claimAdoptionCommands: claimAdoptionReceipt.commands,
      recoveryTriageCommands: recoveryTriageReceipt.commands,
    },
    findingSummary,
  };
}

export function validateMailchimpVerifierAnalysis(analysis) {
  const diagnostics = [];
  if (analysis?.kind !== "aios.semantic.verifierAnalysis") {
    diagnostics.push({ level: "error", code: "verifier.analysis.kind.invalid" });
  }
  if (!analysis?.contract?.rules?.length) {
    diagnostics.push({ level: "error", code: "verifier.analysis.rules.empty" });
  }
  if (analysis?.adapterHandoff?.acceptedForExternalWrite && !analysis.adapterHandoff.payload?.approvalTokenAccepted) {
    diagnostics.push({ level: "error", code: "verifier.analysis.external-write.unapproved" });
  }
  if (!analysis?.candidateShape?.complete) {
    diagnostics.push({
      level: "warning",
      code: "verifier.analysis.candidate.incomplete",
      missingPaths: analysis?.candidateShape?.missingPaths || [],
    });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime && analysis?.capabilityNegotiation?.status !== "accepted") {
    diagnostics.push({ level: "error", code: "verifier.analysis.provider-negotiation.not-accepted" });
  }
  if (analysis?.providerServiceContract?.missingCapabilities?.length && analysis?.syncMetadata?.handoffMode !== "blocked") {
    diagnostics.push({
      level: "error",
      code: "verifier.analysis.sync-open-with-missing-capabilities",
      missingCapabilities: analysis.providerServiceContract.missingCapabilities,
    });
  }
  if (!analysis?.syncMetadata?.syncId) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.sync-id.missing" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime && analysis?.acceptanceState?.acceptedForRuntime !== true) {
    diagnostics.push({ level: "error", code: "verifier.analysis.runtime-handoff-without-acceptance" });
  }
  if (analysis?.previewState?.rules?.length !== analysis?.contract?.rules?.length) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.preview.rules-mismatch" });
  }
  if (analysis?.validationSummary?.status === "ready" && analysis?.previewState?.status === "blocked") {
    diagnostics.push({ level: "error", code: "verifier.analysis.validation-ready-while-preview-blocked" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime && analysis?.clientRuntimeAdoptionState?.hydrated !== true) {
    diagnostics.push({ level: "error", code: "verifier.analysis.runtime-handoff-without-client-adoption" });
  }
  if (analysis?.clientRuntimeAdoptionState?.userVisibleWorkflow?.status === "needs-client-state"
    && analysis?.adapterHandoff?.acceptedForRuntime) {
    diagnostics.push({ level: "error", code: "verifier.analysis.accepted-with-missing-route-state" });
  }
  if (!analysis?.clientRuntimeAdoptionState?.routeCommands?.some((command) => command.command === "render-verifier-preview")) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.preview-route-command.missing" });
  }
  if (analysis?.adapterHandoff?.acceptedForRuntime && analysis?.operationalHealthState?.status !== "healthy") {
    diagnostics.push({ level: "error", code: "verifier.analysis.runtime-handoff-while-degraded" });
  }
  if (analysis?.operationalHealthState?.retryable && analysis?.operationalHealthState?.retryPolicy?.nextDelaySeconds == null) {
    diagnostics.push({ level: "error", code: "verifier.analysis.retryable-without-delay" });
  }
  if (analysis?.operationalHealthState?.status === "failed"
    && !analysis?.operationalHealthState?.actionableErrors?.some((error) => error.action === "escalate-verifier-recovery")) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.failed-health-without-escalation" });
  }
  if (!analysis?.recovery?.idempotentCommands?.some((command) => command.command === "persist-verifier-health-state")) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.health-state-command.missing" });
  }
  if (!analysis?.providerReportingState?.reportId) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.provider-report.missing" });
  }
  if (analysis?.exportSummary?.status === "ready" && analysis?.exportSummary?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "verifier.analysis.export-ready-with-blockers" });
  }
  if (analysis?.providerHandoffSummary?.acceptedForRuntime && analysis?.operationalHealthState?.status !== "healthy") {
    diagnostics.push({ level: "error", code: "verifier.analysis.provider-handoff-accepted-while-unhealthy" });
  }
  if (!analysis?.historySnapshots?.some((snapshot) => snapshot.phase === "provider-health")) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.provider-health-history.missing" });
  }
  if (!analysis?.timelineState?.reportChannels?.includes("verifier.status.mailchimp")) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.timeline-channel.missing" });
  }
  if (analysis?.providerReportingState?.status !== "blocked"
    && !analysis?.providerReportingState?.commands?.some((command) => command.command === "publish-verifier-provider-report")) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.provider-report-command.missing" });
  }
  if (!analysis?.syscallHandoffPackage?.packageId) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.syscall-handoff-package.missing" });
  }
  if (analysis?.syscallHandoffPackage?.acceptedForSyscallDispatch
    && analysis?.operationalHealthState?.status !== "healthy") {
    diagnostics.push({ level: "error", code: "verifier.analysis.syscall-handoff-accepted-while-unhealthy" });
  }
  if (analysis?.syscallHandoffPackage?.status === "dispatch-ready"
    && analysis?.syscallHandoffPackage?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "verifier.analysis.syscall-handoff-ready-with-blockers" });
  }
  if (analysis?.syscallHandoffPackage?.retryable
    && analysis?.syscallHandoffPackage?.nextDelaySeconds == null) {
    diagnostics.push({ level: "error", code: "verifier.analysis.syscall-handoff-retry-without-delay" });
  }
  if (!analysis?.syscallHandoffPackage?.commands?.some((command) => command.command === "persist-verifier-syscall-handoff")) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.syscall-handoff-command.missing" });
  }
  if (!analysis?.tenantDispatchGuard?.guardId) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.tenant-dispatch-guard.missing" });
  }
  if (analysis?.syscallHandoffPackage?.acceptedForSyscallDispatch
    && analysis?.tenantDispatchGuard?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "verifier.analysis.dispatch-accepted-without-tenant-guard" });
  }
  if (analysis?.tenantDispatchGuard?.status === "ready"
    && analysis?.tenantDispatchGuard?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "verifier.analysis.tenant-guard-ready-with-blockers" });
  }
  if (analysis?.tenantDispatchGuard?.acceptedForSyscallDispatch
    && (!analysis.tenantDispatchGuard.tenantId || !analysis.tenantDispatchGuard.workspaceId)) {
    diagnostics.push({ level: "error", code: "verifier.analysis.tenant-guard-accepted-without-scope" });
  }
  if (!analysis?.lifecycleCommandState?.lifecycleId) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.lifecycle-command-state.missing" });
  }
  if (analysis?.lifecycleCommandState?.status === "settings-blocked"
    && !analysis.lifecycleCommandState.blockedBy?.some((blocker) => blocker.startsWith("verifier.lifecycle."))) {
    diagnostics.push({ level: "error", code: "verifier.analysis.lifecycle-settings-blocked-without-diagnostic" });
  }
  if (analysis?.lifecycleCommandState?.nextCommands?.some((command) => command.disabledBySettings)) {
    diagnostics.push({ level: "error", code: "verifier.analysis.lifecycle-next-command-disabled" });
  }
  if (analysis?.timelineState?.lifecycle?.lifecycleId
    && analysis.timelineState.lifecycle.lifecycleId !== analysis.lifecycleCommandState?.lifecycleId) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.timeline-lifecycle-id.inconsistent" });
  }
  if (analysis?.recovery?.lifecycleCommands?.length
    && analysis?.lifecycleCommandState?.enabled !== true) {
    diagnostics.push({ level: "error", code: "verifier.analysis.recovery-lifecycle-command-while-disabled" });
  }
  if (analysis?.syscallControlPlaneState?.status === "blocked"
    && !analysis.syscallControlPlaneState.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "verifier.analysis.syscall-control-plane.blocked-without-reason" });
  }
  if (analysis?.syscallControlPlaneState?.acceptedForVerifierHandoff
    && analysis?.syscallHandoffPackage?.acceptedForSyscallDispatch !== true) {
    diagnostics.push({ level: "error", code: "verifier.analysis.syscall-control-plane.accepted-without-dispatch" });
  }
  if (analysis?.syscallControlPlaneState?.present
    && !analysis?.recovery?.syscallControlPlaneCommands?.some((command) => command.command === "persist-verifier-syscall-control-plane")) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.syscall-control-plane.persist-command.missing" });
  }
  if (!analysis?.recoveryExportEnvelope?.envelopeId) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.recovery-export-envelope.missing" });
  }
  if (analysis?.recoveryExportEnvelope?.releaseReady
    && analysis?.recoveryExportEnvelope?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "verifier.analysis.recovery-export-ready-with-blockers" });
  }
  if (analysis?.recoveryExportEnvelope?.acceptedForClaimRuntime
    && analysis?.recoveryExportEnvelope?.restartSafe !== true) {
    diagnostics.push({ level: "error", code: "verifier.analysis.recovery-export-accepted-without-restart-safe" });
  }
  if (analysis?.recoveryExportEnvelope?.releaseReady
    && analysis?.syscallAdoptionPacket?.releaseReady !== true) {
    diagnostics.push({ level: "error", code: "verifier.analysis.recovery-export-without-syscall-adoption" });
  }
  if (!analysis?.claimAdoptionReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.claim-adoption-receipt.missing" });
  }
  if (analysis?.claimAdoptionReceipt?.acceptedForClaimRuntime
    && analysis?.claimAdoptionReceipt?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "verifier.analysis.claim-adoption-ready-with-blockers" });
  }
  if (analysis?.claimAdoptionReceipt?.acceptedForClaimRuntime
    && analysis?.recoveryExportEnvelope?.acceptedForClaimRuntime !== true) {
    diagnostics.push({ level: "error", code: "verifier.analysis.claim-adoption-without-recovery-export" });
  }
  if (analysis?.claimAdoptionReceipt?.restartSafe
    && analysis?.claimAdoptionReceipt?.rows?.some((row) => row.restartSafe === false)) {
    diagnostics.push({ level: "error", code: "verifier.analysis.claim-adoption-safe-with-unsafe-row" });
  }
  if (!analysis?.claimAdoptionReceipt?.commands?.some((command) => (
    command.command === "persist-verifier-claim-adoption-receipt"
  ))) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.claim-adoption-persist-command.missing" });
  }
  if (!analysis?.recoveryTriageReceipt?.receiptId) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.recovery-triage-receipt.missing" });
  }
  if (analysis?.recoveryTriageReceipt?.releaseReady
    && analysis?.recoveryTriageReceipt?.blockedBy?.length) {
    diagnostics.push({ level: "error", code: "verifier.analysis.recovery-triage-ready-with-blockers" });
  }
  if (analysis?.recoveryTriageReceipt?.retryable
    && analysis?.recoveryTriageReceipt?.nextDelaySeconds == null) {
    diagnostics.push({ level: "error", code: "verifier.analysis.recovery-triage-retry-without-delay" });
  }
  if (analysis?.recoveryTriageReceipt?.acceptedForClaimRuntime
    && analysis?.claimAdoptionReceipt?.acceptedForClaimRuntime !== true) {
    diagnostics.push({ level: "error", code: "verifier.analysis.recovery-triage-without-claim-adoption" });
  }
  if (!analysis?.recoveryTriageReceipt?.commands?.some((command) => (
    command.command === "persist-verifier-recovery-triage-receipt"
  ))) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.recovery-triage-persist-command.missing" });
  }
  if (!analysis?.recovery?.recoveryExportCommands?.some((command) => (
    command.command === "persist-verifier-recovery-export"
  ))) {
    diagnostics.push({ level: "warning", code: "verifier.analysis.recovery-export-command.missing" });
  }
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    diagnostics,
  };
}

export function selfCheckMailchimpVerifierAnalysis() {
  const analysis = analyzeMailchimpVerifier();
  const validation = validateMailchimpVerifierAnalysis(analysis);
  return {
    ok: validation.ok && analysis.status === "ready",
    status: analysis.status,
    ruleCount: analysis.contract.rules.length,
    findingSummary: analysis.findingSummary,
    exportSummary: analysis.exportSummary,
    lifecycleCommandState: analysis.lifecycleCommandState,
    syscallControlPlaneState: analysis.syscallControlPlaneState,
    claimAdoptionReceipt: analysis.claimAdoptionReceipt,
    recoveryTriageReceipt: analysis.recoveryTriageReceipt,
    diagnostics: validation.diagnostics,
  };
}
