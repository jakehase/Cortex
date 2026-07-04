import { formatAiosSource } from "../source/format.mjs";
import { buildAiosCliCheckContract } from "./cli-check.mjs";
import { buildAiosCliCompileContract } from "./cli-compile.mjs";

const FORMAT_CONTRACT_PROTOCOL = "aios.language.cli-format-contract.v1";

function diagnostic(severity, code, message, path = "$") {
  return Object.freeze({ severity, code, message, path });
}

function normalizeNewlines(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function buildSourcePatch(original, formatted) {
  const originalLines = normalizeNewlines(original).split("\n");
  const formattedLines = normalizeNewlines(formatted).split("\n");
  const changedLines = [];
  const max = Math.max(originalLines.length, formattedLines.length);
  for (let index = 0; index < max; index += 1) {
    if (originalLines[index] !== formattedLines[index]) {
      changedLines.push(index + 1);
    }
  }
  return Object.freeze({
    changed: changedLines.length > 0,
    changedLineCount: changedLines.length,
    changedLines: Object.freeze(changedLines.slice(0, 50)),
  });
}

function buildFormatAnalytics(original, formatted, patch, compileBefore, compileAfter, checkAfter) {
  const originalLines = normalizeNewlines(original).split("\n");
  const formattedLines = normalizeNewlines(formatted).split("\n");
  const capabilityDelta = compileAfter.exportManifest.capabilityCount - compileBefore.exportManifest.capabilityCount;
  const descriptorDelta = compileAfter.exportManifest.descriptorCount - compileBefore.exportManifest.descriptorCount;
  const diagnosticCounts = checkAfter.counts;
  const boundary = compileAfter.boundaryProfile;
  const providerReadiness = compileAfter.statusHandoff.providerReadiness;
  const counters = Object.freeze({
    originalLineCount: originalLines.length,
    formattedLineCount: formattedLines.length,
    changedLineCount: patch.changedLineCount,
    descriptorDelta,
    capabilityDelta,
    errorCount: diagnosticCounts.error,
    warningCount: diagnosticCounts.warning,
    infoCount: diagnosticCounts.info,
    deniedPermissionCount: boundary?.deniedPermissions.length ?? 0,
    providerPendingCount: providerReadiness?.pendingProviders.length ?? 0,
    providerDegradedCount: providerReadiness?.degradedProviders.length ?? 0,
    providerFailedCount: providerReadiness?.failedProviders.length ?? 0,
  });
  const history = Object.freeze([
    Object.freeze({
      id: "before-format",
      sourceHash: compileBefore.source.sourceHash,
      status: compileBefore.statusHandoff.state,
      descriptors: compileBefore.exportManifest.descriptorCount,
      capabilities: compileBefore.exportManifest.capabilityCount,
      boundaryState: compileBefore.boundaryProfile?.state,
      providerState: compileBefore.statusHandoff.providerReadiness?.state,
    }),
    Object.freeze({
      id: "after-format",
      sourceHash: compileAfter.source.sourceHash,
      status: compileAfter.statusHandoff.state,
      descriptors: compileAfter.exportManifest.descriptorCount,
      capabilities: compileAfter.exportManifest.capabilityCount,
      boundaryState: boundary?.state,
      providerState: providerReadiness?.state,
      providerSyncState: providerReadiness?.handoff?.syncState ?? "not-required",
    }),
    Object.freeze({
      id: "post-check",
      sourceHash: checkAfter.source.sourceHash,
      status: checkAfter.status,
      healthStatus: checkAfter.operationalHealth.status,
      failureState: checkAfter.operationalHealth.failureState,
      providerState: checkAfter.analytics.exportSummary.providerState,
      nextAction: checkAfter.nextAction,
    }),
  ]);
  const timeline = Object.freeze(history.map((snapshot, index) => Object.freeze({
    order: index + 1,
    event: snapshot.id,
    status: snapshot.status,
    healthStatus: snapshot.healthStatus ?? null,
    providerState: snapshot.providerState ?? null,
    nextAction: snapshot.nextAction ?? null,
  })));

  return Object.freeze({
    protocol: "aios.language.cli-format-analytics.v1",
    counters,
    history,
    timeline,
    exportSummary: Object.freeze({
      changed: patch.changed,
      semanticStable: descriptorDelta === 0 && capabilityDelta === 0,
      reportName: "format-report.json",
      boundaryState: boundary?.state,
      healthStatus: checkAfter.operationalHealth.status,
      providerState: providerReadiness?.state ?? "unknown",
      providerSyncState: providerReadiness?.handoff?.syncState ?? "not-required",
    }),
  });
}

function createFormatLifecycleControls(patch, semanticStable, checkAfter, analytics) {
  const providerState = analytics.exportSummary.providerState;
  const reviewGate = checkAfter.operationalHealth.reviewGate;
  const providerBlocked = providerState === "blocked";
  const providerWaiting = providerState === "waiting" || providerState === "degraded";
  const reviewGatePaused = reviewGate?.enabled === false && reviewGate?.canPreview !== true;
  const enabled = semanticStable && !providerBlocked && !reviewGatePaused;
  const canApply = enabled && patch.changed && checkAfter.status !== "failed";
  const canSchedule = enabled && (providerWaiting || reviewGate?.canSchedule === true);
  const disabledReasons = Object.freeze([
    ...(!semanticStable ? ["semantic-drift"] : []),
    ...(providerBlocked ? ["provider-blocked"] : []),
    ...(reviewGatePaused ? ["compile-review-gate-paused"] : []),
    ...(checkAfter.status === "failed" ? ["check-failed"] : []),
  ]);
  return Object.freeze({
    protocol: "aios.language.cli-format-lifecycle-controls.v1",
    controls: Object.freeze({
      enabled,
      canApply,
      canDisable: true,
      canSchedule,
    }),
    acceptance: Object.freeze({
      previewReady: checkAfter.statusHandoff.acceptedForClientPreview === true,
      reviewGateAccepted: reviewGate?.accepted === true,
      canAcceptPreview: enabled && semanticStable && checkAfter.status !== "failed",
      canAcceptRuntime: enabled && reviewGate?.canAccept === true && checkAfter.ok === true,
      reviewGateNextAction: reviewGate?.nextAction ?? null,
    }),
    schedule: Object.freeze({
      mode: providerWaiting
        ? "after-provider-sync"
        : reviewGate?.canSchedule
          ? "after-compile-review-gate"
          : "manual",
      queued: canSchedule,
      retryAfterMs: checkAfter.operationalHealth.retry.retryAfterMs,
      blockedBy: disabledReasons,
    }),
    nextAction: canApply
      ? "apply-formatted-source"
      : providerWaiting
        ? "schedule-format-after-provider-sync"
        : reviewGate?.canSchedule
          ? reviewGate.nextAction
        : disabledReasons[0] === "semantic-drift"
          ? "review-format-semantic-drift"
          : checkAfter.nextAction,
  });
}

function createFormatPreviewContract(original, formatted, patch, semanticStable, checkAfter, lifecycle) {
  const previewLines = normalizeNewlines(formatted).split("\n").slice(0, 12);
  const changedPreviewLines = patch.changedLines.slice(0, 8);
  const acceptedForPreview = lifecycle.acceptance.canAcceptPreview && checkAfter.statusHandoff.acceptedForClientPreview === true;
  const acceptedForRuntime = lifecycle.acceptance.canAcceptRuntime && checkAfter.statusHandoff.acceptedForRuntime === true;
  const validationSummary = Object.freeze({
    status: checkAfter.status,
    healthStatus: checkAfter.operationalHealth.status,
    errors: checkAfter.counts.error,
    warnings: checkAfter.counts.warning,
    semanticStable,
    changedLineCount: patch.changedLineCount,
  });
  const nextStep = acceptedForRuntime
    ? "accept-format-runtime-handoff"
    : acceptedForPreview
      ? patch.changed ? "accept-format-preview" : "no-format-changes"
      : lifecycle.nextAction;

  return Object.freeze({
    protocol: "aios.language.cli-format-preview-contract.v1",
    status: acceptedForRuntime ? "runtime-accepted" : acceptedForPreview ? "preview-accepted" : "needs-review",
    acceptedForPreview,
    acceptedForRuntime,
    diff: Object.freeze({
      changed: patch.changed,
      changedLineCount: patch.changedLineCount,
      changedLines: patch.changedLines,
      previewChangedLines: Object.freeze(changedPreviewLines),
    }),
    preview: Object.freeze({
      lineCount: previewLines.length,
      lines: Object.freeze(previewLines),
      truncated: normalizeNewlines(formatted).split("\n").length > previewLines.length,
    }),
    validationSummary,
    handoff: Object.freeze({
      reportName: checkAfter.analytics.exportSummary.reportName,
      providerState: checkAfter.statusHandoff.providerState,
      providerSyncState: checkAfter.statusHandoff.providerSyncState,
      reviewGateState: checkAfter.statusHandoff.reviewGateState,
      reviewGateNextAction: checkAfter.statusHandoff.reviewGateNextAction,
    }),
    nextStep: Object.freeze({
      action: nextStep,
      userVisible: acceptedForPreview,
      reason: lifecycle.schedule.blockedBy[0] ?? (patch.changed ? "format-changes-ready" : "source-already-formatted"),
    }),
  });
}

function createMailchimpFormatWorkflow(compileAfter, checkAfter, lifecycle, previewContract) {
  const provider = compileAfter.mailchimpProvider;
  const preview = checkAfter.mailchimpPreview;
  const changed = previewContract.diff.changed;
  const canAdopt = lifecycle.controls.enabled
    && previewContract.validationSummary.semanticStable === true
    && preview?.acceptance?.canAcceptPreview === true;
  const canSync = canAdopt
    && provider?.sync?.state !== "blocked"
    && provider?.capabilityNegotiation?.accepted === true;
  const blockedReasons = Object.freeze([
    ...(!changed ? ["source-already-formatted"] : []),
    ...(previewContract.validationSummary.semanticStable !== true ? ["semantic-drift"] : []),
    ...(preview?.acceptance?.canAcceptPreview !== true ? ["mailchimp-preview-not-accepted"] : []),
    ...(provider?.state === "capability-gap" ? ["mailchimp-capability-gap"] : []),
    ...(provider?.state === "identity-required" ? ["mailchimp-identity-required"] : []),
    ...(provider?.sync?.state === "blocked" ? ["mailchimp-sync-blocked"] : []),
  ]);
  const requestId = `${compileAfter.source.sourceHash}:format:${provider?.sync?.externalStateKey ?? "local"}`;
  const nextAction = canAdopt
    ? canSync && provider?.sync?.required
      ? "sync-formatted-source-to-mailchimp"
      : "apply-formatted-source"
    : blockedReasons[0] === "source-already-formatted"
      ? "no-format-changes"
      : preview?.nextStep?.action ?? lifecycle.nextAction;

  return Object.freeze({
    protocol: "aios.language.cli-format-mailchimp-workflow.v1",
    state: canAdopt ? "adoptable" : blockedReasons[0] === "source-already-formatted" ? "unchanged" : "blocked",
    request: Object.freeze({
      command: "format",
      provider: provider?.provider ?? "mailchimp",
      sourceHash: compileAfter.source.sourceHash,
      clientRequestId: requestId,
      idempotencyKey: `${requestId}:${previewContract.diff.changedLineCount}`,
      audienceId: provider?.identity?.audienceId ?? null,
      campaignId: provider?.identity?.campaignId ?? null,
    }),
    clientState: Object.freeze({
      visibleStatus: previewContract.status,
      changed,
      changedLineCount: previewContract.diff.changedLineCount,
      previewStatus: preview?.status ?? "unknown",
      providerState: provider?.state ?? "unknown",
      providerSyncState: provider?.sync?.state ?? "unknown",
      blockedReasons,
    }),
    runtimeData: Object.freeze({
      patchLines: previewContract.diff.previewChangedLines,
      validationSummary: previewContract.validationSummary,
      handoffId: provider?.handoff?.id ?? null,
      syncChannel: provider?.sync?.channel ?? null,
      syncCorrelationId: provider?.sync?.correlationId ?? null,
      externalStateKey: provider?.sync?.externalStateKey ?? null,
    }),
    sync: Object.freeze({
      required: Boolean(provider?.sync?.required),
      canSync,
      state: provider?.sync?.state ?? "unknown",
      retryAfterMs: provider?.handoff?.retryAfterMs ?? null,
    }),
    nextAction,
  });
}

export function buildAiosCliFormatContract(source = "", options = {}) {
  const original = normalizeNewlines(source);
  const formatted = formatAiosSource(original, options);
  const compileBefore = buildAiosCliCompileContract(original, options);
  const compileAfter = buildAiosCliCompileContract(formatted.source, options);
  const checkAfter = buildAiosCliCheckContract(formatted.source, {
    ...options,
    compileContract: compileAfter,
  });
  const patch = buildSourcePatch(original, formatted.source);
  const analytics = buildFormatAnalytics(original, formatted.source, patch, compileBefore, compileAfter, checkAfter);
  const semanticStable = compileBefore.exportManifest.descriptorCount === compileAfter.exportManifest.descriptorCount
    && compileBefore.exportManifest.capabilityCount === compileAfter.exportManifest.capabilityCount
    && compileBefore.statusHandoff.acceptedForClientPreview === compileAfter.statusHandoff.acceptedForClientPreview;
  const diagnostics = Object.freeze([
    ...formatted.diagnostics,
    ...(semanticStable
      ? []
      : [diagnostic("error", "AIOS_CLI_FORMAT_SEMANTIC_DRIFT", "Formatted source changed the compiled contract shape.", "$.semanticStable")]),
  ]);
  const lifecycle = createFormatLifecycleControls(patch, semanticStable, checkAfter, analytics);
  const previewContract = createFormatPreviewContract(original, formatted.source, patch, semanticStable, checkAfter, lifecycle);
  const mailchimpWorkflow = createMailchimpFormatWorkflow(compileAfter, checkAfter, lifecycle, previewContract);

  return Object.freeze({
    protocol: FORMAT_CONTRACT_PROTOCOL,
    command: "format",
    source: compileAfter.source,
    formattedSource: formatted.source,
    patch,
    analytics,
    lifecycle,
    semanticStable,
    preview: formatted.preview,
    previewContract,
    mailchimpWorkflow,
    check: checkAfter,
    statusHandoff: Object.freeze({
      ...compileAfter.statusHandoff,
      formatChanged: patch.changed,
      semanticStable,
      checkStatus: checkAfter.status,
      healthStatus: checkAfter.operationalHealth.status,
      reportName: analytics.exportSummary.reportName,
      providerState: analytics.exportSummary.providerState,
      providerSyncState: analytics.exportSummary.providerSyncState,
      lifecycleEnabled: lifecycle.controls.enabled,
      previewAccepted: previewContract.acceptedForPreview,
      runtimeAccepted: previewContract.acceptedForRuntime,
      mailchimpWorkflowState: mailchimpWorkflow.state,
      mailchimpSyncState: mailchimpWorkflow.sync.state,
      nextStep: previewContract.nextStep.action,
    }),
    recoveryHandoff: Object.freeze({
      ...compileAfter.recoveryHandoff,
      timeline: analytics.timeline,
      previewContract: previewContract.nextStep,
      mailchimpWorkflow: mailchimpWorkflow.runtimeData,
      lifecycleNextAction: lifecycle.nextAction,
      nextAction: mailchimpWorkflow.nextAction,
    }),
    diagnostics,
    nextAction: mailchimpWorkflow.nextAction,
  });
}

export function assertAiosCliFormatContractReady(contract) {
  const diagnostics = [];
  if (contract?.protocol !== FORMAT_CONTRACT_PROTOCOL) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_FORMAT_PROTOCOL_INVALID", "Format contract protocol is missing or unsupported."));
  }
  if (contract?.semanticStable !== true) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_FORMAT_UNSTABLE", "Format contract must preserve the compiled runtime contract.", "$.semanticStable"));
  }
  if (!contract?.analytics?.exportSummary?.reportName) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_FORMAT_ANALYTICS_REQUIRED", "Format contract must include export-ready analytics.", "$.analytics.exportSummary"));
  }
  if (!contract?.lifecycle?.controls) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_FORMAT_LIFECYCLE_REQUIRED", "Format contract must include lifecycle controls.", "$.lifecycle.controls"));
  }
  if (!contract?.previewContract?.validationSummary) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_FORMAT_PREVIEW_CONTRACT_REQUIRED", "Format contract must include preview acceptance validation summary.", "$.previewContract.validationSummary"));
  }
  if (!contract?.mailchimpWorkflow?.request) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_FORMAT_MAILCHIMP_WORKFLOW_REQUIRED", "Format contract must include Mailchimp workflow request state.", "$.mailchimpWorkflow.request"));
  }
  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    nextAction: diagnostics[0]?.code || contract?.nextAction || "apply-formatted-source",
  });
}

export { FORMAT_CONTRACT_PROTOCOL };
