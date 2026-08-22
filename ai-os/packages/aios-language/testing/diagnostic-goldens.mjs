import {
  assertMailchimpDiagnosticsReady,
  emitMailchimpDiagnostics
} from "../compiler/diagnostic-emitter.mjs";
import {
  MAILCHIMP_RUNTIME_GOLDEN,
  assertMailchimpRuntimeGolden,
  buildMailchimpRuntimeGolden
} from "./runtime-goldens.mjs";

export const MAILCHIMP_DIAGNOSTIC_GOLDEN_OPTIONS = Object.freeze({
  providerServiceContract: {
    negotiatedCapabilities: ["campaign.update", "campaign.schedule"],
    serviceScopes: [
      "mailchimp:campaigns:read",
      "mailchimp:campaigns:write",
      "mailchimp:campaigns:schedule",
      "mailchimp:lists:read"
    ]
  }
});

function stableDiagnosticCodes(emission) {
  return (emission?.diagnostics || [])
    .map((diagnostic) => ({
      id: diagnostic.id,
      code: diagnostic.code,
      severity: diagnostic.severity,
      source: diagnostic.source || "unknown",
      nextAction: diagnostic.recoveryAction || diagnostic.nextAction || null,
      blocksRuntimeHandoff: diagnostic.blocksRuntimeHandoff === true
    }))
    .sort((left, right) => {
      if (left.severity !== right.severity) return left.severity.localeCompare(right.severity);
      if (left.code !== right.code) return left.code.localeCompare(right.code);
      return left.id.localeCompare(right.id);
    });
}

function buildRecoveryStatusProjection(emission) {
  const recovery = emission?.recovery || {};
  const statusHandoff = recovery.statusHandoff || {};
  const providerService = emission?.providerServiceContract || {};
  return {
    recoverable: recovery.recoverable === true,
    strategy: recovery.strategy || null,
    nextAction: recovery.nextAction || null,
    resumeToken: recovery.resumeToken || null,
    statusHandoffState: statusHandoff.handoffState || null,
    visibleStatus: statusHandoff.visibleStatus || null,
    ackRequired: statusHandoff.ackRequired === true,
    providerServiceStatus: providerService.status || null,
    providerServiceNextAction: providerService.nextAction || null,
    providerServiceHandoffReady: providerService.externalHandoff?.ready === true,
    restartCursor: recovery.restartCursor || null
  };
}

function buildOperationalHealthProjection(emission, runtimeGolden, runtimeCheck) {
  const diagnostics = stableDiagnosticCodes(emission);
  const runtimeExpected = runtimeGolden.expected || {};
  const boundary = runtimeGolden.boundaryEnvelope || {};
  const recoveryPlan = runtimeGolden.recoveryPlan || {};
  const recovery = recoveryPlan.recovery || {};
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.blocksRuntimeHandoff);
  const warningDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const errorDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const boundaryBlocked = (boundary.blockedReasons || []).length > 0;
  const providerBlocked = runtimeExpected.providerState !== "online"
    || runtimeExpected.externalHandoffState !== "linked";
  const degraded = runtimeCheck.ok !== true
    || blockingDiagnostics.length > 0
    || boundaryBlocked
    || providerBlocked;
  const retryable = recoveryPlan.recoverable === true
    && errorDiagnostics.length === 0
    && boundaryBlocked === false;
  const backoffSeconds = retryable
    ? Math.max(5, recovery.backoffSeconds || 30)
    : 0;
  const failureState = boundaryBlocked
    ? "blocked_by_boundary"
    : errorDiagnostics.length > 0
      ? "failed_validation"
      : providerBlocked
        ? "provider_handoff_degraded"
        : blockingDiagnostics.length > 0
          ? "blocked_by_diagnostics"
          : "healthy";

  return {
    protocol: "aios.testing.diagnostic-health.mailchimp.v1",
    requestId: runtimeExpected.requestId || runtimeGolden.adapterDescriptor?.requestId || null,
    status: degraded ? "degraded" : "healthy",
    failureState,
    retryable,
    backoffSeconds,
    maxAttempts: recovery.maxAttempts || 0,
    degradedMode: {
      enabled: degraded,
      allowExternalWrite: degraded === false && boundary.allowed === true,
      allowReadOnlyRecovery: degraded === true && boundaryBlocked === false,
      visibleStatus: degraded ? "needs-operator-action" : "ready"
    },
    counters: {
      diagnostics: diagnostics.length,
      warnings: warningDiagnostics.length,
      errors: errorDiagnostics.length,
      blocking: blockingDiagnostics.length,
      boundaryBlocks: (boundary.blockedReasons || []).length
    },
    actionableErrors: [
      ...blockingDiagnostics.map((diagnostic) => ({
        id: diagnostic.id,
        code: diagnostic.code,
        nextAction: diagnostic.nextAction || "repair-diagnostic"
      })),
      ...(boundary.blockedReasons || []).map((reason) => ({
        id: `${runtimeExpected.requestId || "runtime"}.boundary.${reason}`,
        code: "mailchimp.runtime.boundary_blocked",
        nextAction: boundary.nextAction || "repair-runtime-boundary"
      }))
    ],
    nextAction: degraded
      ? (boundaryBlocked
        ? boundary.nextAction
        : recovery.command || recoveryPlan.nextAction || "repair-runtime")
      : "dispatch-runtime-handoff"
  };
}

function buildDiagnosticAcceptance(emission, runtimeCheck, runtimeGolden) {
  const ready = assertMailchimpDiagnosticsReady(emission);
  const diagnostics = stableDiagnosticCodes(emission);
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.blocksRuntimeHandoff);
  const recoveryProjection = buildRecoveryStatusProjection(emission);
  const healthProjection = buildOperationalHealthProjection(emission, runtimeGolden, runtimeCheck);
  return {
    diagnostics,
    ready,
    recoveryProjection,
    healthProjection,
    runtimeAccepted: runtimeCheck.ok === true,
    deterministicIds: diagnostics.every((diagnostic) => diagnostic.id?.startsWith(`${emission.jobId}.`)),
    blockingDiagnosticCount: blockingDiagnostics.length,
    statusHandoffActionable: ready.statusHandoffState !== "unknown"
      && Boolean(ready.statusHandoffNextAction || recoveryProjection.nextAction),
    clientAckRequired: ready.clientCommandAckRequired === true || recoveryProjection.ackRequired === true,
    nextAction: healthProjection.nextAction || ready.nextAction || recoveryProjection.nextAction
  };
}

function buildDiagnosticTimelineReport(emission, runtimeGolden, acceptance) {
  const diagnostics = acceptance.diagnostics || [];
  const health = acceptance.healthProjection || {};
  const runtimeHealth = runtimeGolden.operationalHealth || {};
  const runtimeEvents = runtimeGolden.statusSnapshot?.events || [];
  const recoveryProjection = acceptance.recoveryProjection || {};
  const severityCounters = diagnostics.reduce((memo, diagnostic) => {
    const severity = diagnostic.severity || "unknown";
    memo[severity] = (memo[severity] || 0) + 1;
    return memo;
  }, {});
  const sourceCounters = diagnostics.reduce((memo, diagnostic) => {
    const source = diagnostic.source || "unknown";
    memo[source] = (memo[source] || 0) + 1;
    return memo;
  }, {});
  const timeline = [
    ...runtimeEvents.map((event) => ({
      at: event.at,
      sequence: event.index + 1,
      type: "runtime-event",
      code: event.code,
      state: event.state,
      severity: "info",
      nextAction: null
    })),
    ...diagnostics.map((diagnostic, index) => ({
      at: `diagnostic:${index + 1}`,
      sequence: runtimeEvents.length + index + 1,
      type: "diagnostic",
      code: diagnostic.code,
      state: diagnostic.blocksRuntimeHandoff ? "blocking" : "observed",
      severity: diagnostic.severity,
      nextAction: diagnostic.nextAction
    })),
    {
      at: "runtime-health",
      sequence: runtimeEvents.length + diagnostics.length + 1,
      type: "operational-health",
      code: runtimeHealth.protocol || health.protocol,
      state: runtimeHealth.status || health.status || "unknown",
      severity: runtimeHealth.status === "healthy" ? "info" : "warning",
      nextAction: runtimeHealth.nextAction || health.nextAction || null
    }
  ];
  const historySnapshots = timeline.map((entry) => ({
    id: `${emission.jobId || "mailchimp-diagnostic"}.${entry.sequence}`,
    sequence: entry.sequence,
    state: entry.state,
    code: entry.code,
    visibleStatus: entry.type === "operational-health"
      ? runtimeHealth.degradedMode?.visibleStatus || health.degradedMode?.visibleStatus || "unknown"
      : recoveryProjection.visibleStatus || "queued",
    nextAction: entry.nextAction
  }));
  const actionableTimeline = timeline
    .filter((entry) => entry.nextAction)
    .map((entry) => ({
      sequence: entry.sequence,
      code: entry.code,
      nextAction: entry.nextAction
    }));

  return {
    protocol: "aios.testing.diagnostic-report.mailchimp.v1",
    jobId: emission.jobId || null,
    requestId: runtimeGolden.expected?.requestId || null,
    counters: {
      totalDiagnostics: diagnostics.length,
      blockingDiagnostics: acceptance.blockingDiagnosticCount || 0,
      timelineEvents: timeline.length,
      actionableEvents: actionableTimeline.length,
      runtimeDegradedReasons: runtimeHealth.degradedReasons?.length || 0,
      runtimeValidationFailures: runtimeHealth.validationFailures?.length || 0,
      bySeverity: severityCounters,
      bySource: sourceCounters
    },
    timeline,
    historySnapshots,
    exportSummary: {
      provider: "mailchimp",
      status: runtimeHealth.status || health.status || "unknown",
      failureState: runtimeHealth.failureState || health.failureState || "unknown",
      retryable: runtimeHealth.retryable === true || health.retryable === true,
      backoffSeconds: runtimeHealth.backoffSeconds || health.backoffSeconds || 0,
      nextAction: runtimeHealth.nextAction || health.nextAction || acceptance.nextAction || null,
      visibleStatus: runtimeHealth.degradedMode?.visibleStatus
        || health.degradedMode?.visibleStatus
        || recoveryProjection.visibleStatus
        || "unknown",
      actionableTimeline
    }
  };
}

export function buildMailchimpDiagnosticGolden(options = {}) {
  const runtimeGolden = options.runtimeGolden || buildMailchimpRuntimeGolden();
  const runtimeCheck = assertMailchimpRuntimeGolden(runtimeGolden);
  const emission = emitMailchimpDiagnostics(runtimeGolden.source, {
    ...MAILCHIMP_DIAGNOSTIC_GOLDEN_OPTIONS,
    ...(options.diagnosticOptions || {})
  });
  const expected = buildDiagnosticAcceptance(emission, runtimeCheck, runtimeGolden);
  return {
    kind: "aios.testing.mailchimpDiagnosticGolden",
    provider: "mailchimp",
    runtimeGolden,
    emission,
    expected: {
      ...expected,
      report: buildDiagnosticTimelineReport(emission, runtimeGolden, expected)
    }
  };
}

export function assertMailchimpDiagnosticGolden(golden = buildMailchimpDiagnosticGolden()) {
  const expected = golden.expected || {};
  const ready = expected.ready || {};
  const recovery = expected.recoveryProjection || {};
  const health = expected.healthProjection || {};
  const report = expected.report || {};
  const diagnosticIds = (expected.diagnostics || []).map((diagnostic) => diagnostic.id);
  const duplicateDiagnosticIds = diagnosticIds
    .filter((id, index) => diagnosticIds.indexOf(id) !== index);
  const blockingWithoutRecovery = (expected.diagnostics || [])
    .filter((diagnostic) => diagnostic.blocksRuntimeHandoff && !diagnostic.nextAction)
    .map((diagnostic) => diagnostic.id);
  const reportTimelineCodes = (report.timeline || []).map((entry) => entry.code);
  const missingReportDiagnostics = (expected.diagnostics || [])
    .filter((diagnostic) => !reportTimelineCodes.includes(diagnostic.code))
    .map((diagnostic) => diagnostic.id);
  const missingHistorySnapshots = (report.timeline || [])
    .filter((entry) => !(report.historySnapshots || []).some((snapshot) => snapshot.sequence === entry.sequence))
    .map((entry) => entry.sequence);

  return {
    ok: golden.emission?.kind === "aios.mailchimp.diagnosticEmission"
      && ready.ok === true
      && expected.runtimeAccepted === true
      && expected.deterministicIds === true
      && expected.statusHandoffActionable === true
      && recovery.recoverable === true
      && Boolean(recovery.resumeToken)
      && health.protocol === "aios.testing.diagnostic-health.mailchimp.v1"
      && ["healthy", "degraded"].includes(health.status)
      && Boolean(health.nextAction)
      && (health.status === "healthy"
        ? health.degradedMode?.allowExternalWrite === true
        : health.degradedMode?.allowReadOnlyRecovery === true
          && health.actionableErrors?.length > 0)
      && report.protocol === "aios.testing.diagnostic-report.mailchimp.v1"
      && report.counters?.totalDiagnostics === expected.diagnostics?.length
      && report.exportSummary?.status === (golden.runtimeGolden?.operationalHealth?.status || health.status)
      && missingReportDiagnostics.length === 0
      && missingHistorySnapshots.length === 0
      && duplicateDiagnosticIds.length === 0
      && blockingWithoutRecovery.length === 0,
    diagnosticCount: expected.diagnostics?.length || 0,
    blockingDiagnosticCount: expected.blockingDiagnosticCount || 0,
    duplicateDiagnosticIds,
    blockingWithoutRecovery,
    missingReportDiagnostics,
    missingHistorySnapshots,
    statusHandoffState: ready.statusHandoffState || recovery.statusHandoffState,
    statusHandoffVisibleStatus: ready.statusHandoffVisibleStatus || recovery.visibleStatus,
    nextAction: expected.nextAction || null,
    healthStatus: health.status || "unknown",
    failureState: health.failureState || "unknown",
    retryable: health.retryable === true,
    backoffSeconds: health.backoffSeconds || 0,
    reportStatus: report.exportSummary?.status || "unknown",
    reportNextAction: report.exportSummary?.nextAction || null,
    reportTimelineEvents: report.counters?.timelineEvents || 0,
    providerServiceStatus: recovery.providerServiceStatus,
    providerServiceHandoffReady: recovery.providerServiceHandoffReady
  };
}

export const MAILCHIMP_DIAGNOSTIC_GOLDEN = buildMailchimpDiagnosticGolden({
  runtimeGolden: MAILCHIMP_RUNTIME_GOLDEN
});
export const MAILCHIMP_DIAGNOSTIC_GOLDEN_CHECK = assertMailchimpDiagnosticGolden(MAILCHIMP_DIAGNOSTIC_GOLDEN);
