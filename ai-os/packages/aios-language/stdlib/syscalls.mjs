export const MAILCHIMP_SYSCALLS = Object.freeze({
  planAudienceSync: "mailchimp.planAudienceSync",
  previewMemberUpsert: "mailchimp.previewMemberUpsert",
  commitAdapterBatch: "mailchimp.commitAdapterBatch",
  recordTruthBoundary: "mailchimp.recordTruthBoundary",
  exportAnalyticsHistory: "mailchimp.exportAnalyticsHistory",
  readOperatorControlState: "mailchimp.readOperatorControlState",
  readContinuationPacket: "mailchimp.readContinuationPacket",
  planRecoveryResume: "mailchimp.planRecoveryResume",
  preflightAdapterCommit: "mailchimp.preflightAdapterCommit",
  readProviderSyncCheckpoint: "mailchimp.readProviderSyncCheckpoint",
});

function syscallId(name, input) {
  const seed = JSON.stringify({ name, input });
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(31, hash) + seed.charCodeAt(index);
    hash |= 0;
  }

  return `${name}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function assertBoundaryShape(boundary) {
  if (!boundary || boundary.kind !== "aios.workspace.boundary_binding") {
    return [{
      code: "syscall.boundary_required",
      severity: "error",
      message: "Mailchimp syscalls require an aios.workspace.boundary_binding input.",
      path: "boundary.kind",
    }];
  }

  return [];
}

function summarizeCapabilities(boundary) {
  return Array.isArray(boundary?.providerJob?.capabilities) ? boundary.providerJob.capabilities : [];
}

function summarizeProviderSyncMetadata(boundary) {
  const handoff = boundary?.providerJob?.adapterHandoff ?? {};
  const lifecycle = boundary?.providerJob?.lifecycleState ?? handoff.lifecycle ?? {};

  return {
    provider: handoff.provider ?? boundary?.providerJob?.provider ?? "mailchimp",
    product: boundary?.providerJob?.product ?? "Mailchimp",
    audienceId: handoff.audience?.audienceId ?? null,
    segmentId: handoff.audience?.segmentId ?? null,
    commitMode: boundary?.providerJob?.commitMode ?? "dry-run",
    nextAction: lifecycle.nextAction ?? boundary?.analyticsExport?.exportSummary?.nextAction ?? "operator.review",
    schedule: lifecycle.schedule ?? null,
    settingsRevision: lifecycle.settingsRevision ?? null,
    exportId: boundary?.analyticsExport?.exportId ?? null,
  };
}

function summarizeProviderSyncCheckpoint(boundary) {
  const checkpoint = boundary?.providerSyncCheckpoint && typeof boundary.providerSyncCheckpoint === "object"
    ? boundary.providerSyncCheckpoint
    : boundary?.memoryContract?.providerSyncCheckpoint && typeof boundary.memoryContract.providerSyncCheckpoint === "object"
      ? boundary.memoryContract.providerSyncCheckpoint
      : boundary?.memoryContract?.exportContract?.providerSync
        && typeof boundary.memoryContract.exportContract.providerSync === "object"
        ? boundary.memoryContract.exportContract.providerSync
        : boundary?.providerJob?.memoryBinding?.providerSyncCheckpoint
          && typeof boundary.providerJob.memoryBinding.providerSyncCheckpoint === "object"
          ? boundary.providerJob.memoryBinding.providerSyncCheckpoint
          : boundary?.providerJob?.adapterHandoff?.providerSyncCheckpoint
            && typeof boundary.providerJob.adapterHandoff.providerSyncCheckpoint === "object"
            ? boundary.providerJob.adapterHandoff.providerSyncCheckpoint
            : {};
  const syncMetadata = checkpoint.syncMetadata && typeof checkpoint.syncMetadata === "object"
    ? checkpoint.syncMetadata
    : {};
  const capabilityNegotiation = checkpoint.capabilityNegotiation && typeof checkpoint.capabilityNegotiation === "object"
    ? checkpoint.capabilityNegotiation
    : {};
  const externalHandoff = checkpoint.externalHandoff && typeof checkpoint.externalHandoff === "object"
    ? checkpoint.externalHandoff
    : {};
  const commands = Array.isArray(checkpoint.commands)
    ? checkpoint.commands.map((command, index) => ({
        index: Number.isFinite(command.index) ? Math.max(1, Math.floor(command.index)) : index + 1,
        command: String(command.command ?? "").trim() || "memory.provider-sync.checkpoint",
        state: String(command.state ?? "").trim() || "pending",
        idempotencyKey: String(command.idempotencyKey ?? "").trim() || null,
        restartSafe: command.restartSafe === true,
      }))
    : [];
  const blockedReasons = Array.isArray(checkpoint.blockedReasons)
    ? checkpoint.blockedReasons.map((reason) => String(reason ?? "").trim()).filter(Boolean).sort()
    : [];
  const requiredCapabilities = Array.isArray(capabilityNegotiation.required)
    ? capabilityNegotiation.required.map((capability) => String(capability ?? "").trim()).filter(Boolean).sort()
    : [];
  const availableCapabilities = Array.isArray(capabilityNegotiation.available)
    ? capabilityNegotiation.available.map((capability) => String(capability ?? "").trim()).filter(Boolean).sort()
    : summarizeCapabilities(boundary);
  const missingCapabilities = Array.isArray(capabilityNegotiation.missing)
    ? capabilityNegotiation.missing.map((capability) => String(capability ?? "").trim()).filter(Boolean).sort()
    : requiredCapabilities.filter((capability) => !availableCapabilities.includes(capability));
  const deniedCapabilities = Array.isArray(capabilityNegotiation.denied)
    ? capabilityNegotiation.denied.map((capability) => String(capability ?? "").trim()).filter(Boolean).sort()
    : [];
  const status = String(checkpoint.status ?? "").trim()
    || (blockedReasons.length
      ? "blocked"
      : missingCapabilities.length || deniedCapabilities.length
        ? "capability_blocked"
        : checkpoint.ready === true
          ? "ready"
          : "not_bound");
  const retryable = syncMetadata.retryable === true || checkpoint.retryBackoff?.retryable === true;
  const ready = checkpoint.ready === true || status === "ready" || status === "degraded_checkpoint";
  const nextAction = String(externalHandoff.nextAction ?? checkpoint.nextAction ?? "").trim()
    || (blockedReasons.length
      ? retryable
        ? "memory.provider-sync.retry"
        : "memory.provider-sync.repair"
      : ready
        ? "kernel.job.dispatch"
        : "memory.provider-sync.checkpoint");

  return {
    contractVersion: "aios.mailchimp.provider-sync-checkpoint-syscall-summary.v1",
    checkpointKey: String(checkpoint.checkpointKey ?? "").trim() || null,
    status,
    ready,
    provider: String(checkpoint.provider ?? "").trim() || "mailchimp",
    tenant: checkpoint.tenant ?? boundary?.tenant ?? boundary?.providerJob?.tenant ?? null,
    workspace: checkpoint.workspace ?? boundary?.workspace ?? boundary?.providerJob?.workspace ?? null,
    memoryHash: String(checkpoint.memoryHash ?? boundary?.memoryContract?.memoryHash ?? "").trim() || null,
    persistedStateKey: String(checkpoint.persistedStateKey ?? "").trim() || null,
    syncMetadata: {
      cursor: String(syncMetadata.cursor ?? "").trim() || null,
      observedAt: String(syncMetadata.observedAt ?? "").trim() || null,
      lastProviderRequestId: String(syncMetadata.lastProviderRequestId ?? "").trim() || null,
      state: String(syncMetadata.state ?? status ?? "").trim() || "not_bound",
      consecutiveFailures: Number.isFinite(syncMetadata.consecutiveFailures)
        ? Math.max(0, Math.floor(syncMetadata.consecutiveFailures))
        : 0,
      retryable,
      retryAfterSeconds: Number.isFinite(syncMetadata.retryAfterSeconds)
        ? Math.max(0, Math.floor(syncMetadata.retryAfterSeconds))
        : Number.isFinite(checkpoint.retryBackoff?.retryAfterSeconds)
          ? Math.max(0, Math.floor(checkpoint.retryBackoff.retryAfterSeconds))
          : 0,
    },
    capabilityNegotiation: {
      status: String(capabilityNegotiation.status ?? "").trim()
        || (missingCapabilities.length || deniedCapabilities.length ? "blocked" : "ready"),
      required: requiredCapabilities,
      available: availableCapabilities,
      granted: Array.isArray(capabilityNegotiation.granted)
        ? capabilityNegotiation.granted.map((capability) => String(capability ?? "").trim()).filter(Boolean).sort()
        : requiredCapabilities.filter((capability) => availableCapabilities.includes(capability)),
      missing: missingCapabilities,
      denied: deniedCapabilities,
      disabled: Array.isArray(capabilityNegotiation.disabled)
        ? capabilityNegotiation.disabled.map((capability) => String(capability ?? "").trim()).filter(Boolean).sort()
        : [],
    },
    externalHandoff: {
      target: String(externalHandoff.target ?? "").trim() || "operator-console",
      queue: String(externalHandoff.queue ?? "").trim() || "memory-provider-sync",
      state: String(externalHandoff.state ?? "").trim() || "local_only",
      correlationId: String(externalHandoff.correlationId ?? "").trim() || null,
      requestId: String(externalHandoff.requestId ?? syncMetadata.lastProviderRequestId ?? "").trim() || null,
      restartSafe: externalHandoff.restartSafe !== false && checkpoint.restartSafe !== false,
      nextAction,
    },
    blockedReasons,
    retryBackoff: {
      retryable,
      mode: String(checkpoint.retryBackoff?.mode ?? "").trim() || (retryable ? "bounded-runtime-retry" : "operator-repair-required"),
      backoff: String(checkpoint.retryBackoff?.backoff ?? "").trim() || (retryable ? "exponential-with-jitter" : "none"),
      retryAfterSeconds: Number.isFinite(checkpoint.retryBackoff?.retryAfterSeconds)
        ? Math.max(0, Math.floor(checkpoint.retryBackoff.retryAfterSeconds))
        : 0,
      maxAttempts: Number.isFinite(checkpoint.retryBackoff?.maxAttempts)
        ? Math.max(0, Math.floor(checkpoint.retryBackoff.maxAttempts))
        : 0,
      issueCodes: Array.isArray(checkpoint.retryBackoff?.issueCodes)
        ? checkpoint.retryBackoff.issueCodes.map((code) => String(code ?? "").trim()).filter(Boolean).sort()
        : [],
    },
    commands,
    restartSafe: externalHandoff.restartSafe !== false
      && checkpoint.restartSafe !== false
      && commands.every((command) => command.restartSafe || command.state === "blocked"),
  };
}

function summarizeOperatorControlState(boundary) {
  const lifecycle = boundary?.providerJob?.lifecycleState ?? {};
  const operatorState = boundary?.operatorControlState ?? {};
  const commandQueue = Array.isArray(operatorState.commandQueue)
    ? operatorState.commandQueue
    : Array.isArray(lifecycle.commandQueue)
      ? lifecycle.commandQueue
      : [];

  return {
    stateId: operatorState.stateId ?? null,
    status: operatorState.status ?? boundary?.status ?? "blocked",
    nextAction: operatorState.nextAction ?? lifecycle.nextAction ?? "operator.review",
    settingsRevision: operatorState.settingsRevision ?? lifecycle.settingsRevision ?? null,
    settingsValidation: operatorState.settingsValidation ?? lifecycle.settingsValidation ?? null,
    schedulingControls: operatorState.schedulingControls ?? lifecycle.schedulingControls ?? null,
    enablementControls: operatorState.enablementControls ?? {
      enabled: lifecycle.enabled === true,
      previewAllowed: lifecycle.controls?.previewAllowed === true,
      commitAllowed: lifecycle.controls?.commitAllowed === true,
      acceptanceRequired: lifecycle.controls?.acceptanceRequired !== false,
    },
    availableCommands: operatorState.availableCommands ?? commandQueue.filter((entry) => entry.status === "ready").map((entry) => entry.command),
    blockedCommands: operatorState.blockedCommands ?? commandQueue.filter((entry) => entry.status !== "ready").map((entry) => ({
      command: entry.command,
      reason: entry.reason,
    })),
    commandQueue,
  };
}

function summarizeContinuationPacket(boundary) {
  const packet = boundary?.continuationPacket ?? {};
  const health = boundary?.providerJob?.operationalHealth ?? {};
  const previewAcceptance = boundary?.providerJob?.previewAcceptance ?? boundary?.providerJob?.adapterHandoff?.previewAcceptance ?? null;
  const retryBackoff = packet.retryBackoff ?? health.retryPlan ?? {
    mode: boundary?.status === "blocked" ? "do-not-retry-until-settings-change" : "bounded-client-retry",
    limit: 1,
    backoff: boundary?.status === "blocked" ? "none" : "linear",
    retryableIssueCodes: [],
  };
  const issueSummary = packet.issueSummary ?? {
    errors: Array.isArray(boundary?.issues)
      ? boundary.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code)
      : [],
    warnings: Array.isArray(boundary?.issues)
      ? boundary.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code)
      : [],
    total: Array.isArray(boundary?.issues) ? boundary.issues.length : 0,
  };

  return {
    packetId: packet.packetId ?? null,
    status: packet.status ?? health.status ?? boundary?.status ?? "blocked",
    nextClientStep: packet.nextClientStep ?? boundary?.providerJob?.lifecycleState?.nextAction ?? "operator.review",
    resumable: packet.resumable ?? {
      allowed: issueSummary.errors.length === 0,
      cursor: boundary?.providerJob?.jobId ?? null,
      reason: issueSummary.errors.length === 0
        ? "Runtime may retry from the provider job cursor."
        : "Resolve blocking issues before retry.",
    },
    degradedMode: packet.degradedMode ?? {
      active: health.degraded === true,
      localPreviewOnly: boundary?.providerJob?.commitMode !== "adapter-mediated",
      reasons: health.degradedReasons ?? [],
    },
    retryBackoff,
    previewAcceptance,
    issueSummary,
  };
}

function summarizeOperatorReport(boundary) {
  const report = boundary?.operatorReport && typeof boundary.operatorReport === "object"
    ? boundary.operatorReport
    : boundary?.artifactWriteSet?.operatorReport && typeof boundary.artifactWriteSet.operatorReport === "object"
      ? boundary.artifactWriteSet.operatorReport
      : boundary?.providerJob?.adapterHandoff?.operatorReport && typeof boundary.providerJob.adapterHandoff.operatorReport === "object"
        ? boundary.providerJob.adapterHandoff.operatorReport
        : {};
  const sections = report.sections && typeof report.sections === "object" ? report.sections : {};
  const blockingSections = Array.isArray(report.blockingSections)
    ? report.blockingSections.map((section) => ({
        name: String(section.name ?? "").trim(),
        status: String(section.status ?? "").trim() || "blocked",
        nextAction: String(section.nextAction ?? "").trim() || "operator.review",
        issueCodes: Array.isArray(section.issueCodes)
          ? section.issueCodes.map((code) => String(code ?? "").trim()).filter(Boolean).sort()
          : [],
      })).filter((section) => section.name)
    : [];
  const counters = report.counters && typeof report.counters === "object" ? report.counters : {};

  return {
    contractVersion: "aios.mailchimp.operator-report-syscall-summary.v1",
    reportId: String(report.reportId ?? "").trim() || null,
    status: String(report.status ?? "").trim() || "not_bound",
    nextAction: String(report.nextAction ?? "").trim() || (blockingSections[0]?.nextAction ?? "operator.review"),
    boundaryId: report.boundaryId ?? boundary?.boundaryId ?? null,
    providerJobId: report.providerJobId ?? boundary?.providerJob?.jobId ?? null,
    writeSetId: report.writeSetId ?? boundary?.artifactWriteSet?.persistence?.writeSetId ?? null,
    sections: Object.fromEntries(
      Object.entries(sections).map(([name, section]) => [
        name,
        {
          status: String(section.status ?? "").trim() || "unknown",
          nextAction: String(section.nextAction ?? "").trim() || "operator.review",
          digest: String(section.digest ?? "").trim() || null,
          issueCodes: Array.isArray(section.issueCodes)
            ? section.issueCodes.map((code) => String(code ?? "").trim()).filter(Boolean).sort()
            : [],
        },
      ]),
    ),
    counters: {
      issueTotal: Number.isFinite(counters.issueTotal) ? Math.max(0, Math.floor(counters.issueTotal)) : 0,
      blockingIssueTotal: Number.isFinite(counters.blockingIssueTotal)
        ? Math.max(0, Math.floor(counters.blockingIssueTotal))
        : blockingSections.length,
      warningIssueTotal: Number.isFinite(counters.warningIssueTotal) ? Math.max(0, Math.floor(counters.warningIssueTotal)) : 0,
      artifactRecordTotal: Number.isFinite(counters.artifactRecordTotal) ? Math.max(0, Math.floor(counters.artifactRecordTotal)) : 0,
      historySnapshotTotal: Number.isFinite(counters.historySnapshotTotal) ? Math.max(0, Math.floor(counters.historySnapshotTotal)) : 0,
      timelineEventTotal: Number.isFinite(counters.timelineEventTotal) ? Math.max(0, Math.floor(counters.timelineEventTotal)) : 0,
    },
    latestSnapshot: report.latestSnapshot ?? null,
    timeline: Array.isArray(report.timeline)
      ? report.timeline.slice(-8).map((entry, index) => ({
          index: Number.isFinite(entry.index) ? Math.max(0, Math.floor(entry.index)) : index,
          phase: String(entry.phase ?? "").trim() || "analytics",
          status: String(entry.status ?? "").trim() || "unknown",
          action: String(entry.action ?? "").trim() || "operator.review",
          restartSafe: entry.restartSafe !== false,
        }))
      : [],
    blockingSections,
    restartSafe: report.restartSafe !== false,
  };
}

function summarizeWorkflowActionPacket(boundary) {
  const packet = boundary?.workflowActionPacket && typeof boundary.workflowActionPacket === "object"
    ? boundary.workflowActionPacket
    : boundary?.artifactWriteSet?.workflowActionPacket && typeof boundary.artifactWriteSet.workflowActionPacket === "object"
      ? boundary.artifactWriteSet.workflowActionPacket
      : boundary?.memoryContract?.providerServiceContract?.workflowActionPacket
        && typeof boundary.memoryContract.providerServiceContract.workflowActionPacket === "object"
        ? boundary.memoryContract.providerServiceContract.workflowActionPacket
        : {};
  const steps = Array.isArray(packet.steps)
    ? packet.steps.map((step, index) => ({
        order: Number.isFinite(step.order) ? Math.max(1, Math.floor(step.order)) : index + 1,
        id: String(step.id ?? "").trim(),
        status: String(step.status ?? "").trim() || "waiting",
        active: step.active === true,
        nextAction: String(step.nextAction ?? "").trim() || "operator.review",
        blockerCodes: Array.isArray(step.blockerCodes)
          ? step.blockerCodes.map((code) => String(code ?? "").trim()).filter(Boolean).sort()
          : [],
      })).filter((step) => step.id)
    : [];
  const issueSummary = packet.issueSummary && typeof packet.issueSummary === "object" ? packet.issueSummary : {};
  const adapterCommit = packet.adapterCommit && typeof packet.adapterCommit === "object" ? packet.adapterCommit : {};
  const activeStep = steps.find((step) => step.id === packet.activeStepId)
    ?? steps.find((step) => step.active)
    ?? null;

  return {
    contractVersion: "aios.mailchimp.workflow-action-syscall-summary.v1",
    packetId: String(packet.packetId ?? "").trim() || null,
    status: String(packet.status ?? "").trim() || "not_bound",
    primaryAction: String(packet.primaryAction ?? "").trim() || activeStep?.nextAction || "operator.review",
    activeStepId: String(packet.activeStepId ?? activeStep?.id ?? "").trim() || null,
    boundaryId: packet.boundaryId ?? boundary?.boundaryId ?? null,
    providerJobId: packet.providerJobId ?? boundary?.providerJob?.jobId ?? null,
    writeSetId: packet.writeSetId ?? boundary?.artifactWriteSet?.persistence?.writeSetId ?? null,
    steps,
    issueSummary: {
      blockingCodes: Array.isArray(issueSummary.blockingCodes)
        ? issueSummary.blockingCodes.map((code) => String(code ?? "").trim()).filter(Boolean).sort()
        : [],
      pendingPreviewCount: Number.isFinite(issueSummary.pendingPreviewCount)
        ? Math.max(0, Math.floor(issueSummary.pendingPreviewCount))
        : 0,
      pendingArtifactWriteCount: Number.isFinite(issueSummary.pendingArtifactWriteCount)
        ? Math.max(0, Math.floor(issueSummary.pendingArtifactWriteCount))
        : 0,
      missingScopeCount: Number.isFinite(issueSummary.missingScopeCount)
        ? Math.max(0, Math.floor(issueSummary.missingScopeCount))
        : 0,
      deniedScopeCount: Number.isFinite(issueSummary.deniedScopeCount)
        ? Math.max(0, Math.floor(issueSummary.deniedScopeCount))
        : 0,
    },
    adapterCommit: {
      status: String(adapterCommit.status ?? "").trim() || "not_bound",
      canCommit: adapterCommit.canCommit === true,
      nextAction: String(adapterCommit.nextAction ?? "").trim() || "repair-adapter-commit-gate",
    },
    restartSafe: packet.restartSafe !== false,
  };
}

function summarizeExternalReviewBundle(boundary) {
  const bundle = boundary?.externalReviewBundle && typeof boundary.externalReviewBundle === "object"
    ? boundary.externalReviewBundle
    : boundary?.artifactWriteSet?.externalReviewBundle && typeof boundary.artifactWriteSet.externalReviewBundle === "object"
      ? boundary.artifactWriteSet.externalReviewBundle
      : boundary?.providerJob?.adapterHandoff?.externalReviewBundle
        && typeof boundary.providerJob.adapterHandoff.externalReviewBundle === "object"
        ? boundary.providerJob.adapterHandoff.externalReviewBundle
        : {};
  const artifactReferences = bundle.artifactReferences && typeof bundle.artifactReferences === "object"
    ? bundle.artifactReferences
    : {};
  const persistence = bundle.persistence && typeof bundle.persistence === "object" ? bundle.persistence : {};
  const adapterCommit = bundle.adapterCommit && typeof bundle.adapterCommit === "object" ? bundle.adapterCommit : {};
  const operatorReport = bundle.operatorReport && typeof bundle.operatorReport === "object" ? bundle.operatorReport : {};
  const workflowAction = bundle.workflowAction && typeof bundle.workflowAction === "object" ? bundle.workflowAction : {};
  const userVisibleSummary = bundle.userVisibleSummary && typeof bundle.userVisibleSummary === "object"
    ? bundle.userVisibleSummary
    : {};
  const blockingActions = Array.isArray(bundle.blockingActions)
    ? bundle.blockingActions.map((entry) => ({
        source: String(entry.source ?? "").trim() || "review",
        code: String(entry.code ?? entry.field ?? entry ?? "").trim() || "external_review_blocker",
        field: String(entry.field ?? "").trim() || null,
        action: String(entry.action ?? "").trim() || "repair-external-review-before-handoff",
      })).filter((entry) => entry.code)
    : [];
  const normalizedReferences = Object.fromEntries(
    Object.entries(artifactReferences).map(([name, record]) => [
      name,
      record && typeof record === "object"
        ? {
            path: String(record.path ?? "").trim() || null,
            digest: String(record.digest ?? "").trim() || null,
            bytes: Number.isFinite(record.bytes) ? Math.max(0, Math.floor(record.bytes)) : 0,
            mediaType: String(record.mediaType ?? "").trim() || null,
          }
        : null,
    ]),
  );
  const readyCommandCount = Number.isFinite(persistence.readyCommandCount)
    ? Math.max(0, Math.floor(persistence.readyCommandCount))
    : Number.isFinite(boundary?.artifactWriteSet?.persistence?.counters?.readyToWrite)
      ? Math.max(0, Math.floor(boundary.artifactWriteSet.persistence.counters.readyToWrite))
      : 0;
  const canCommit = adapterCommit.canCommit === true
    || boundary?.artifactWriteSet?.adapterCommitGate?.canCommit === true
    || boundary?.adapterCommitGate?.canCommit === true;
  const status = String(bundle.status ?? "").trim()
    || (blockingActions.length
      ? "blocked"
      : canCommit
        ? "ready_for_external_handoff"
        : readyCommandCount > 0
          ? "needs_local_persistence"
          : "not_bound");

  return {
    contractVersion: "aios.mailchimp.external-review-syscall-summary.v1",
    bundleId: String(bundle.bundleId ?? "").trim() || null,
    status,
    boundaryId: bundle.boundaryId ?? boundary?.boundaryId ?? null,
    providerJobId: bundle.providerJobId ?? boundary?.providerJob?.jobId ?? null,
    writeSetId: bundle.writeSetId ?? boundary?.artifactWriteSet?.persistence?.writeSetId ?? null,
    receiptId: bundle.receiptId ?? boundary?.artifactWriteSet?.acceptanceReceipt?.receiptId ?? null,
    nextAction: String(bundle.nextAction ?? "").trim()
      || (canCommit ? "adapter.commit-mailchimp-batch" : blockingActions[0]?.action ?? "operator.review"),
    userVisibleSummary: {
      previewRows: Number.isFinite(userVisibleSummary.previewRows) ? Math.max(0, Math.floor(userVisibleSummary.previewRows)) : 0,
      acceptedRows: Number.isFinite(userVisibleSummary.acceptedRows) ? Math.max(0, Math.floor(userVisibleSummary.acceptedRows)) : 0,
      rejectedRows: Number.isFinite(userVisibleSummary.rejectedRows) ? Math.max(0, Math.floor(userVisibleSummary.rejectedRows)) : 0,
      pendingRows: Number.isFinite(userVisibleSummary.pendingRows) ? Math.max(0, Math.floor(userVisibleSummary.pendingRows)) : 0,
      validationAccepted: userVisibleSummary.validationAccepted === true,
      validationErrors: Number.isFinite(userVisibleSummary.validationErrors) ? Math.max(0, Math.floor(userVisibleSummary.validationErrors)) : 0,
      validationWarnings: Number.isFinite(userVisibleSummary.validationWarnings) ? Math.max(0, Math.floor(userVisibleSummary.validationWarnings)) : 0,
      externalWriteMode: String(userVisibleSummary.externalWriteMode ?? adapterCommit.commitMode ?? boundary?.providerJob?.commitMode ?? "").trim() || "dry-run",
    },
    artifactReferences: normalizedReferences,
    persistence: {
      status: String(persistence.status ?? "").trim() || "not_bound",
      readyCommandCount,
      alreadyWrittenCount: Number.isFinite(persistence.alreadyWrittenCount)
        ? Math.max(0, Math.floor(persistence.alreadyWrittenCount))
        : 0,
      staleEntryCount: Number.isFinite(persistence.staleEntryCount)
        ? Math.max(0, Math.floor(persistence.staleEntryCount))
        : 0,
      commandIds: Array.isArray(persistence.commandIds)
        ? persistence.commandIds.map((id) => String(id ?? "").trim()).filter(Boolean).sort()
        : [],
    },
    adapterCommit: {
      status: String(adapterCommit.status ?? "").trim() || "not_bound",
      canCommit,
      commitMode: String(adapterCommit.commitMode ?? boundary?.providerJob?.commitMode ?? "").trim() || "dry-run",
      blockerCodes: Array.isArray(adapterCommit.blockerCodes)
        ? adapterCommit.blockerCodes.map((code) => String(code ?? "").trim()).filter(Boolean).sort()
        : [],
      capabilityStatus: String(adapterCommit.capabilityStatus ?? "").trim() || "unknown",
      missingScopes: Array.isArray(adapterCommit.missingScopes)
        ? adapterCommit.missingScopes.map((scope) => String(scope ?? "").trim()).filter(Boolean).sort()
        : [],
      deniedScopes: Array.isArray(adapterCommit.deniedScopes)
        ? adapterCommit.deniedScopes.map((scope) => String(scope ?? "").trim()).filter(Boolean).sort()
        : [],
    },
    operatorReport: {
      reportId: String(operatorReport.reportId ?? "").trim() || null,
      status: String(operatorReport.status ?? "").trim() || "not_bound",
      nextAction: String(operatorReport.nextAction ?? "").trim() || null,
      blockingSections: Array.isArray(operatorReport.blockingSections)
        ? operatorReport.blockingSections.map((section) => String(section ?? "").trim()).filter(Boolean).sort()
        : [],
    },
    workflowAction: {
      packetId: String(workflowAction.packetId ?? "").trim() || null,
      status: String(workflowAction.status ?? "").trim() || "not_bound",
      primaryAction: String(workflowAction.primaryAction ?? "").trim() || "operator.review",
      activeStepId: String(workflowAction.activeStepId ?? "").trim() || null,
      blockingCodes: Array.isArray(workflowAction.blockingCodes)
        ? workflowAction.blockingCodes.map((code) => String(code ?? "").trim()).filter(Boolean).sort()
        : [],
    },
    blockingActions,
    restartSafe: bundle.restartSafe !== false,
  };
}

function summarizeClientReviewEnvelope(boundary) {
  const envelope = boundary?.clientReviewEnvelope && typeof boundary.clientReviewEnvelope === "object"
    ? boundary.clientReviewEnvelope
    : boundary?.artifactWriteSet?.clientReviewEnvelope && typeof boundary.artifactWriteSet.clientReviewEnvelope === "object"
      ? boundary.artifactWriteSet.clientReviewEnvelope
      : boundary?.providerJob?.adapterHandoff?.clientReviewEnvelope
        && typeof boundary.providerJob.adapterHandoff.clientReviewEnvelope === "object"
        ? boundary.providerJob.adapterHandoff.clientReviewEnvelope
        : {};
  const acceptance = envelope.acceptance && typeof envelope.acceptance === "object" ? envelope.acceptance : {};
  const validation = envelope.validationSummary && typeof envelope.validationSummary === "object" ? envelope.validationSummary : {};
  const readiness = envelope.readiness && typeof envelope.readiness === "object" ? envelope.readiness : {};
  const requiredAcknowledgements = Array.isArray(envelope.requiredAcknowledgements)
    ? envelope.requiredAcknowledgements.map((entry) => ({
        id: String(entry.id ?? "").trim(),
        status: String(entry.status ?? "").trim() || "pending",
        count: Number.isFinite(entry.count) ? Math.max(0, Math.floor(entry.count)) : 0,
        action: String(entry.action ?? "").trim() || "operator.review",
      })).filter((entry) => entry.id)
    : [];
  const blockingExplanations = Array.isArray(envelope.blockingExplanations)
    ? envelope.blockingExplanations.map((entry) => ({
        source: String(entry.source ?? "").trim() || "review",
        code: String(entry.code ?? entry.field ?? entry ?? "").trim() || "client_review_blocker",
        field: String(entry.field ?? "").trim() || null,
        action: String(entry.action ?? "").trim() || "repair-client-review-envelope",
      })).filter((entry) => entry.code)
    : [];
  const issueCodes = Array.isArray(validation.issueCodes)
    ? validation.issueCodes.map((code) => String(code ?? "").trim()).filter(Boolean).sort()
    : [];
  const status = String(envelope.status ?? "").trim()
    || (blockingExplanations.length
      ? "blocked"
      : requiredAcknowledgements.length
        ? "needs_operator_acceptance"
        : readiness.adapterCommitAllowed === true
          ? "ready_for_adapter_commit"
          : "not_bound");

  return {
    contractVersion: "aios.mailchimp.client-review-syscall-summary.v1",
    envelopeId: String(envelope.envelopeId ?? "").trim() || null,
    status,
    nextAction: String(envelope.nextAction ?? "").trim()
      || requiredAcknowledgements[0]?.action
      || (readiness.adapterCommitAllowed === true ? "adapter.commit-mailchimp-batch" : "operator.review"),
    boundaryId: envelope.boundaryId ?? boundary?.boundaryId ?? null,
    providerJobId: envelope.providerJobId ?? boundary?.providerJob?.jobId ?? null,
    writeSetId: envelope.writeSetId ?? boundary?.artifactWriteSet?.persistence?.writeSetId ?? null,
    receiptId: envelope.receiptId ?? boundary?.artifactWriteSet?.acceptanceReceipt?.receiptId ?? null,
    reviewMode: String(envelope.reviewMode ?? "").trim() || "operator-preview",
    acceptance: {
      required: acceptance.required !== false,
      mode: String(acceptance.mode ?? "").trim() || "per-row",
      status: String(acceptance.status ?? "").trim() || "not_started",
      acceptedCount: Number.isFinite(acceptance.acceptedCount) ? Math.max(0, Math.floor(acceptance.acceptedCount)) : 0,
      rejectedCount: Number.isFinite(acceptance.rejectedCount) ? Math.max(0, Math.floor(acceptance.rejectedCount)) : 0,
      pendingCount: Number.isFinite(acceptance.pendingCount) ? Math.max(0, Math.floor(acceptance.pendingCount)) : 0,
      validationAccepted: acceptance.validationAccepted === true,
    },
    validationSummary: {
      status: String(validation.status ?? "").trim() || (issueCodes.length ? "blocked" : "not_bound"),
      errorTotal: Number.isFinite(validation.errorTotal) ? Math.max(0, Math.floor(validation.errorTotal)) : 0,
      warningTotal: Number.isFinite(validation.warningTotal) ? Math.max(0, Math.floor(validation.warningTotal)) : 0,
      issueCodes,
    },
    readiness: {
      artifactStatus: String(readiness.artifactStatus ?? "").trim() || "not_bound",
      artifactNextStep: String(readiness.artifactNextStep ?? "").trim() || null,
      clientNextAction: String(readiness.clientNextAction ?? "").trim() || null,
      workflowStatus: String(readiness.workflowStatus ?? "").trim() || "not_bound",
      workflowPrimaryAction: String(readiness.workflowPrimaryAction ?? "").trim() || "operator.review",
      activeStepId: String(readiness.activeStepId ?? "").trim() || null,
      adapterCommitStatus: String(readiness.adapterCommitStatus ?? "").trim() || "not_bound",
      adapterCommitAllowed: readiness.adapterCommitAllowed === true,
      externalReviewStatus: String(readiness.externalReviewStatus ?? "").trim() || "not_bound",
      externalReviewBundleId: String(readiness.externalReviewBundleId ?? "").trim() || null,
    },
    requiredAcknowledgements,
    blockingExplanations,
    restartSafe: envelope.restartSafe !== false,
  };
}

function summarizeCommitReadinessCapsule(boundary) {
  const capsule = boundary?.commitReadinessCapsule && typeof boundary.commitReadinessCapsule === "object"
    ? boundary.commitReadinessCapsule
    : boundary?.artifactWriteSet?.commitReadinessCapsule && typeof boundary.artifactWriteSet.commitReadinessCapsule === "object"
      ? boundary.artifactWriteSet.commitReadinessCapsule
      : boundary?.providerJob?.adapterHandoff?.commitReadinessCapsule
        && typeof boundary.providerJob.adapterHandoff.commitReadinessCapsule === "object"
        ? boundary.providerJob.adapterHandoff.commitReadinessCapsule
        : {};
  const actions = Array.isArray(capsule.actions)
    ? capsule.actions.map((entry, index) => ({
        order: Number.isFinite(entry.order) ? Math.max(1, Math.floor(entry.order)) : index + 1,
        source: String(entry.source ?? "").trim() || "commitReadiness",
        code: String(entry.code ?? entry.field ?? entry.id ?? "").trim() || "commit_readiness_action",
        field: String(entry.field ?? "").trim() || null,
        action: String(entry.action ?? entry.nextAction ?? "").trim() || "operator.review",
        status: String(entry.status ?? "").trim() || "waiting",
        idempotencyKey: String(entry.idempotencyKey ?? entry.commandId ?? "").trim() || null,
      })).filter((entry) => entry.code)
    : [];
  const gates = capsule.gates && typeof capsule.gates === "object" ? capsule.gates : {};
  const validationGate = gates.validation && typeof gates.validation === "object" ? gates.validation : {};
  const acceptanceGate = gates.operatorAcceptance && typeof gates.operatorAcceptance === "object"
    ? gates.operatorAcceptance
    : {};
  const persistenceGate = gates.localPersistence && typeof gates.localPersistence === "object"
    ? gates.localPersistence
    : {};
  const capabilityGate = gates.capabilities && typeof gates.capabilities === "object" ? gates.capabilities : {};
  const adapterGate = gates.adapterCommit && typeof gates.adapterCommit === "object" ? gates.adapterCommit : {};
  const resume = capsule.resume && typeof capsule.resume === "object" ? capsule.resume : {};
  const fallbackAdapterGate = summarizeAdapterCommitGate(boundary);
  const fallbackClientReview = summarizeClientReviewEnvelope(boundary);
  const fallbackStatus = String(capsule.status ?? "").trim()
    || (fallbackAdapterGate.canCommit
      ? "ready_for_adapter_commit"
      : fallbackClientReview.requiredAcknowledgements.length
        ? "needs_operator_acceptance"
        : fallbackAdapterGate.localArtifacts.pendingWriteCount > 0
          ? "needs_local_persistence"
          : fallbackAdapterGate.status === "blocked"
            ? "needs_adapter_gate"
            : "not_bound");
  const nextAction = String(capsule.nextAction ?? "").trim()
    || actions[0]?.action
    || (fallbackAdapterGate.canCommit ? "adapter.commit-mailchimp-batch" : fallbackAdapterGate.nextAction);

  return {
    contractVersion: "aios.mailchimp.commit-readiness-syscall-summary.v1",
    capsuleId: String(capsule.capsuleId ?? "").trim() || null,
    status: fallbackStatus,
    canCommit: capsule.canCommit === true || (fallbackStatus === "ready_for_adapter_commit" && fallbackAdapterGate.canCommit),
    provider: "mailchimp",
    boundaryId: capsule.boundaryId ?? boundary?.boundaryId ?? null,
    providerJobId: capsule.providerJobId ?? boundary?.providerJob?.jobId ?? null,
    writeSetId: capsule.writeSetId ?? boundary?.artifactWriteSet?.persistence?.writeSetId ?? fallbackAdapterGate.writeSetId,
    receiptId: capsule.receiptId ?? boundary?.artifactWriteSet?.acceptanceReceipt?.receiptId ?? fallbackAdapterGate.receiptId,
    nextAction,
    userVisibleState: {
      reviewStatus: String(capsule.userVisibleState?.reviewStatus ?? fallbackClientReview.status ?? "").trim() || "not_bound",
      reviewNextAction: String(capsule.userVisibleState?.reviewNextAction ?? fallbackClientReview.nextAction ?? "").trim() || "operator.review",
      workflowStatus: String(capsule.userVisibleState?.workflowStatus ?? boundary?.artifactWriteSet?.workflowActionPacket?.status ?? "").trim() || "not_bound",
      workflowPrimaryAction: String(capsule.userVisibleState?.workflowPrimaryAction ?? boundary?.artifactWriteSet?.workflowActionPacket?.primaryAction ?? "").trim() || "operator.review",
      externalReviewStatus: String(capsule.userVisibleState?.externalReviewStatus ?? boundary?.artifactWriteSet?.externalReviewBundle?.status ?? "").trim() || "not_bound",
      adapterCommitStatus: String(capsule.userVisibleState?.adapterCommitStatus ?? fallbackAdapterGate.status ?? "").trim() || "blocked",
      pendingPreviewRows: Number.isFinite(capsule.userVisibleState?.pendingPreviewRows)
        ? Math.max(0, Math.floor(capsule.userVisibleState.pendingPreviewRows))
        : fallbackClientReview.acceptance.pendingCount,
      rejectedPreviewRows: Number.isFinite(capsule.userVisibleState?.rejectedPreviewRows)
        ? Math.max(0, Math.floor(capsule.userVisibleState.rejectedPreviewRows))
        : fallbackClientReview.acceptance.rejectedCount,
      pendingArtifactWrites: Number.isFinite(capsule.userVisibleState?.pendingArtifactWrites)
        ? Math.max(0, Math.floor(capsule.userVisibleState.pendingArtifactWrites))
        : fallbackAdapterGate.localArtifacts.pendingWriteCount,
      validationErrors: Number.isFinite(capsule.userVisibleState?.validationErrors)
        ? Math.max(0, Math.floor(capsule.userVisibleState.validationErrors))
        : fallbackClientReview.validationSummary.errorTotal,
    },
    gates: {
      validation: {
        status: String(validationGate.status ?? "").trim() || (fallbackClientReview.validationSummary.errorTotal ? "blocked" : "ready"),
        blockingCodes: Array.isArray(validationGate.blockingCodes)
          ? validationGate.blockingCodes.map((code) => String(code ?? "").trim()).filter(Boolean).sort()
          : fallbackClientReview.validationSummary.issueCodes,
      },
      operatorAcceptance: {
        status: String(acceptanceGate.status ?? "").trim() || (fallbackClientReview.requiredAcknowledgements.length ? "pending" : "satisfied"),
        requiredAcknowledgements: Array.isArray(acceptanceGate.requiredAcknowledgements)
          ? acceptanceGate.requiredAcknowledgements.map((id) => String(id ?? "").trim()).filter(Boolean).sort()
          : fallbackClientReview.requiredAcknowledgements.map((entry) => entry.id).sort(),
      },
      localPersistence: {
        status: String(persistenceGate.status ?? "").trim() || (fallbackAdapterGate.localArtifacts.pendingWriteCount > 0 ? "pending" : "satisfied"),
        writeSetId: String(persistenceGate.writeSetId ?? fallbackAdapterGate.writeSetId ?? "").trim() || null,
        readyCommandCount: Number.isFinite(persistenceGate.readyCommandCount)
          ? Math.max(0, Math.floor(persistenceGate.readyCommandCount))
          : fallbackAdapterGate.localArtifacts.pendingWriteCount,
        alreadyWrittenCount: Number.isFinite(persistenceGate.alreadyWrittenCount)
          ? Math.max(0, Math.floor(persistenceGate.alreadyWrittenCount))
          : 0,
      },
      capabilities: {
        status: String(capabilityGate.status ?? fallbackAdapterGate.capabilityGate.status ?? "").trim() || "unknown",
        missingScopes: Array.isArray(capabilityGate.missingScopes)
          ? capabilityGate.missingScopes.map((scope) => String(scope ?? "").trim()).filter(Boolean).sort()
          : fallbackAdapterGate.capabilityGate.missingScopes,
        deniedScopes: Array.isArray(capabilityGate.deniedScopes)
          ? capabilityGate.deniedScopes.map((scope) => String(scope ?? "").trim()).filter(Boolean).sort()
          : fallbackAdapterGate.capabilityGate.deniedScopes,
      },
      adapterCommit: {
        status: String(adapterGate.status ?? fallbackAdapterGate.status ?? "").trim() || "blocked",
        canCommit: adapterGate.canCommit === true || fallbackAdapterGate.canCommit,
        commitMode: String(adapterGate.commitMode ?? fallbackAdapterGate.commitMode ?? "").trim() || "dry-run",
        blockerCodes: Array.isArray(adapterGate.blockerCodes)
          ? adapterGate.blockerCodes.map((code) => String(code ?? "").trim()).filter(Boolean).sort()
          : fallbackAdapterGate.blockers.map((blocker) => blocker.code),
      },
    },
    actions,
    resume: {
      allowed: resume.allowed === true || (fallbackStatus !== "blocked" && actions.every((entry) => entry.status !== "blocked")),
      mode: String(resume.mode ?? "").trim() || (fallbackStatus === "ready_for_adapter_commit" ? "commit_from_verified_local_state" : "resume_operator_review"),
      cursor: String(resume.cursor ?? capsule.writeSetId ?? boundary?.artifactWriteSet?.persistence?.writeSetId ?? "").trim() || null,
      restartSafe: resume.restartSafe !== false && capsule.restartSafe !== false,
    },
    restartSafe: capsule.restartSafe !== false && resume.restartSafe !== false,
  };
}

function negotiateMailchimpCapabilities(boundary, required = []) {
  const available = new Set(summarizeCapabilities(boundary));
  const requested = Array.isArray(required) ? required : [];
  const missing = requested.filter((capability) => !available.has(capability));

  return {
    status: missing.length ? "blocked" : "ready",
    requested,
    available: [...available].sort(),
    missing,
  };
}

function summarizeAdapterCommitGate(boundary) {
  const gate = boundary?.adapterCommitGate
    ?? boundary?.artifactWriteSet?.adapterCommitGate
    ?? boundary?.providerJob?.adapterHandoff?.adapterCommitGate
    ?? {};
  const capabilityNegotiation = gate.capabilityGate
    ?? boundary?.providerJob?.capabilityNegotiation
    ?? boundary?.capabilityNegotiation
    ?? {};
  const blockers = Array.isArray(gate.blockers)
    ? gate.blockers
    : [];
  const missingScopes = Array.isArray(capabilityNegotiation.missingScopes)
    ? capabilityNegotiation.missingScopes
    : Array.isArray(capabilityNegotiation.missing)
      ? capabilityNegotiation.missing
      : [];
  const deniedScopes = Array.isArray(capabilityNegotiation.deniedScopes)
    ? capabilityNegotiation.deniedScopes
    : Array.isArray(capabilityNegotiation.denied)
      ? capabilityNegotiation.denied
      : [];
  const pendingLocalWrites = Number.isFinite(gate.localArtifacts?.pendingWriteCount)
    ? Math.max(0, Math.floor(gate.localArtifacts.pendingWriteCount))
    : Number.isFinite(boundary?.artifactWriteSet?.persistence?.counters?.readyToWrite)
      ? Math.max(0, Math.floor(boundary.artifactWriteSet.persistence.counters.readyToWrite))
      : 0;
  const commitMode = gate.commitMode ?? boundary?.providerJob?.commitMode ?? "dry-run";
  const blockerRecords = [
    ...blockers.map((blocker) => ({
      code: String(blocker.code ?? blocker.field ?? blocker ?? "").trim() || "adapter_commit_gate_blocker",
      field: String(blocker.field ?? "").trim() || null,
      action: String(blocker.action ?? "").trim() || "repair-adapter-commit-gate-before-provider-write",
    })),
    ...missingScopes.map((scope) => ({
      code: "adapter_commit_capability_missing",
      field: scope,
      action: "grant-mailchimp-scope-before-adapter-commit",
    })),
    ...deniedScopes.map((scope) => ({
      code: "adapter_commit_capability_denied",
      field: scope,
      action: "surface-denied-scope-and-keep-commit-blocked",
    })),
    ...(pendingLocalWrites > 0
      ? [{
          code: "adapter_commit_local_artifacts_pending",
          field: "artifactWriteSet.persistence.commands",
          action: "persist-local-artifacts-before-adapter-commit",
        }]
      : []),
    ...(commitMode !== "adapter-mediated"
      ? [{
          code: "adapter_commit_dry_run_mode",
          field: "providerJob.commitMode",
          action: "switch-to-adapter-mediated-commit-mode-before-external-write",
        }]
      : []),
  ];
  const canCommit = gate.canCommit === true && blockerRecords.length === 0;

  return {
    contractVersion: "aios.mailchimp.adapter-commit-syscall-gate.v1",
    status: canCommit ? "ready" : gate.status ?? "blocked",
    canCommit,
    commitMode,
    boundaryId: boundary?.boundaryId ?? gate.boundaryId ?? null,
    providerJobId: boundary?.providerJob?.jobId ?? gate.providerJobId ?? null,
    writeSetId: gate.writeSetId ?? boundary?.artifactWriteSet?.persistence?.writeSetId ?? null,
    receiptId: gate.receiptId ?? boundary?.artifactWriteSet?.acceptanceReceipt?.receiptId ?? null,
    requiredCapabilities: [
      "provider.mailchimp.member.upsert",
      "provider.mailchimp.tag.write",
      "memory.local.artifact.write",
      "verifier.mailchimp.contract.check",
    ],
    localArtifacts: {
      pendingWriteCount: pendingLocalWrites,
      recordCount: gate.localArtifacts?.recordCount ?? boundary?.artifactWriteSet?.records?.length ?? 0,
      missingArtifacts: Array.isArray(gate.localArtifacts?.missingArtifacts)
        ? gate.localArtifacts.missingArtifacts
        : [],
    },
    capabilityGate: {
      status: capabilityNegotiation.status ?? (missingScopes.length || deniedScopes.length ? "blocked" : "unknown"),
      missingScopes: [...new Set(missingScopes)].sort(),
      deniedScopes: [...new Set(deniedScopes)].sort(),
    },
    blockers: blockerRecords,
    nextAction: canCommit ? "adapter.commit" : blockerRecords[0]?.action ?? gate.nextAction ?? "operator.review",
    restartSafe: true,
  };
}

export function createMailchimpSyscallManifest(boundary) {
  const issues = assertBoundaryShape(boundary);
  const capabilities = summarizeCapabilities(boundary);
  const status = issues.length || boundary.status === "blocked" ? "blocked" : "ready";
  const syncMetadata = summarizeProviderSyncMetadata(boundary);
  const adapterCommitGate = summarizeAdapterCommitGate(boundary);
  const operatorReport = summarizeOperatorReport(boundary);
  const workflowActionPacket = summarizeWorkflowActionPacket(boundary);
  const externalReviewBundle = summarizeExternalReviewBundle(boundary);
  const clientReviewEnvelope = summarizeClientReviewEnvelope(boundary);
  const commitReadinessCapsule = summarizeCommitReadinessCapsule(boundary);
  const providerSyncCheckpoint = summarizeProviderSyncCheckpoint(boundary);

  return {
    kind: "aios.stdlib.syscall_manifest",
    provider: "mailchimp",
    status,
    boundaryId: boundary?.boundaryId ?? null,
    syscalls: [
      {
        name: MAILCHIMP_SYSCALLS.planAudienceSync,
        id: syscallId(MAILCHIMP_SYSCALLS.planAudienceSync, boundary?.boundaryId),
        requires: ["verifier.mailchimp.contract.check", "memory.local.artifact.write"],
        sideEffects: ["local-artifact-write"],
        allowedWhen: ["ready", "blocked"],
      },
      {
        name: MAILCHIMP_SYSCALLS.previewMemberUpsert,
        id: syscallId(MAILCHIMP_SYSCALLS.previewMemberUpsert, boundary?.providerJob?.jobId),
        requires: ["provider.mailchimp.member.upsert"],
        sideEffects: ["adapter-preview"],
        allowedWhen: ["ready"],
      },
      {
        name: MAILCHIMP_SYSCALLS.commitAdapterBatch,
        id: syscallId(MAILCHIMP_SYSCALLS.commitAdapterBatch, boundary?.providerJob?.adapterHandoff),
        requires: ["provider.mailchimp.member.upsert", "provider.mailchimp.tag.write"],
        sideEffects: boundary?.providerJob?.commitMode === "adapter-mediated" ? ["external-provider-write"] : ["dry-run-result"],
        allowedWhen: boundary?.providerJob?.commitMode === "adapter-mediated" ? ["ready"] : [],
      },
      {
        name: MAILCHIMP_SYSCALLS.recordTruthBoundary,
        id: syscallId(MAILCHIMP_SYSCALLS.recordTruthBoundary, boundary?.truthBoundary),
        requires: ["memory.local.artifact.write"],
        sideEffects: ["local-artifact-write"],
        allowedWhen: ["ready", "blocked"],
      },
      {
        name: MAILCHIMP_SYSCALLS.exportAnalyticsHistory,
        id: syscallId(MAILCHIMP_SYSCALLS.exportAnalyticsHistory, boundary?.analyticsExport),
        requires: ["memory.local.artifact.write"],
        sideEffects: ["local-artifact-write", "analytics-export"],
        allowedWhen: ["ready", "blocked"],
      },
      {
        name: MAILCHIMP_SYSCALLS.readOperatorControlState,
        id: syscallId(MAILCHIMP_SYSCALLS.readOperatorControlState, boundary?.operatorControlState),
        requires: ["memory.local.artifact.write"],
        sideEffects: ["client-state-read"],
        allowedWhen: ["ready", "blocked"],
      },
      {
        name: MAILCHIMP_SYSCALLS.readContinuationPacket,
        id: syscallId(MAILCHIMP_SYSCALLS.readContinuationPacket, boundary?.continuationPacket),
        requires: ["memory.local.artifact.write"],
        sideEffects: ["client-state-read", "recovery-state-read"],
        allowedWhen: ["ready", "blocked"],
      },
      {
        name: MAILCHIMP_SYSCALLS.planRecoveryResume,
        id: syscallId(MAILCHIMP_SYSCALLS.planRecoveryResume, boundary?.recovery),
        requires: ["memory.local.artifact.write", "verifier.mailchimp.contract.check"],
        sideEffects: ["local-artifact-replay-plan"],
        allowedWhen: ["ready", "blocked"],
      },
      {
        name: MAILCHIMP_SYSCALLS.preflightAdapterCommit,
        id: syscallId(MAILCHIMP_SYSCALLS.preflightAdapterCommit, adapterCommitGate),
        requires: adapterCommitGate.requiredCapabilities,
        sideEffects: ["adapter-preflight-read", "recovery-state-read"],
        allowedWhen: ["ready", "blocked"],
      },
      {
        name: MAILCHIMP_SYSCALLS.readProviderSyncCheckpoint,
        id: syscallId(MAILCHIMP_SYSCALLS.readProviderSyncCheckpoint, providerSyncCheckpoint),
        requires: ["memory.local.artifact.write", "provider.mailchimp.audience.read"],
        sideEffects: ["client-state-read", "recovery-state-read"],
        allowedWhen: ["ready", "blocked"],
      },
    ],
    capabilities,
    syncMetadata,
    operatorControlState: summarizeOperatorControlState(boundary),
    continuationPacket: summarizeContinuationPacket(boundary),
    adapterCommitGate,
    operatorReport,
    workflowActionPacket,
    externalReviewBundle,
    clientReviewEnvelope,
    commitReadinessCapsule,
    providerSyncCheckpoint,
    negotiation: negotiateMailchimpCapabilities(boundary, [
      "provider.mailchimp.audience.read",
      "memory.local.artifact.write",
      "verifier.mailchimp.contract.check",
    ]),
    issues,
  };
}

export function buildMailchimpSyscallDescriptor(name, boundary, payload = {}) {
  const manifest = createMailchimpSyscallManifest(boundary);
  const syscall = manifest.syscalls.find((entry) => entry.name === name);
  const issues = [...manifest.issues];
  const boundaryStatus = boundary?.status ?? "blocked";
  const continuationPacket = manifest.continuationPacket;
  const adapterCommitGate = manifest.adapterCommitGate;
  const operatorReport = manifest.operatorReport;
  const workflowActionPacket = manifest.workflowActionPacket;
  const externalReviewBundle = manifest.externalReviewBundle;
  const clientReviewEnvelope = manifest.clientReviewEnvelope;
  const commitReadinessCapsule = manifest.commitReadinessCapsule;
  const providerSyncCheckpoint = manifest.providerSyncCheckpoint;

  if (!syscall) {
    issues.push({
      code: "syscall.unknown",
      severity: "error",
      message: `Unknown Mailchimp syscall: ${name}`,
      path: "name",
    });
  } else if (!syscall.allowedWhen.includes(boundaryStatus)) {
    issues.push({
      code: "syscall.status_not_allowed",
      severity: "error",
      message: `Syscall ${name} is not allowed while boundary status is ${boundaryStatus}.`,
      path: "boundary.status",
    });
  }

  return {
    kind: "aios.stdlib.syscall_descriptor",
    id: syscallId(name, { boundaryId: boundary?.boundaryId, payload }),
    name,
    status: issues.some((issue) => issue.severity === "error") ? "blocked" : "ready",
    boundaryId: boundary?.boundaryId ?? null,
    providerJobId: boundary?.providerJob?.jobId ?? null,
    payload,
    requiredCapabilities: syscall?.requires ?? [],
    capabilityNegotiation: negotiateMailchimpCapabilities(boundary, syscall?.requires ?? []),
    syncMetadata: manifest.syncMetadata,
    operatorControlState: manifest.operatorControlState,
    continuationPacket,
    operatorReport,
    workflowActionPacket,
    externalReviewBundle,
    clientReviewEnvelope,
    commitReadinessCapsule,
    providerSyncCheckpoint,
    sideEffects: syscall?.sideEffects ?? [],
    rollback: {
      mode: "local-artifact-replay",
      artifacts: boundary?.artifactPlan?.map((artifact) => artifact.path) ?? [],
      retryBackoff: continuationPacket.retryBackoff,
      resumable: continuationPacket.resumable,
    },
    truthBoundary: boundary?.truthBoundary ?? null,
    analyticsExport: name === MAILCHIMP_SYSCALLS.exportAnalyticsHistory ? boundary?.analyticsExport ?? null : null,
    operatorReportExport: name === MAILCHIMP_SYSCALLS.exportAnalyticsHistory
      ? {
          reportId: operatorReport.reportId,
          status: operatorReport.status,
          nextAction: operatorReport.nextAction,
          writeSetId: operatorReport.writeSetId,
          counters: operatorReport.counters,
          latestSnapshot: operatorReport.latestSnapshot,
          timeline: operatorReport.timeline,
          blockingSections: operatorReport.blockingSections,
        }
      : null,
    clientState: name === MAILCHIMP_SYSCALLS.readOperatorControlState
      ? {
          operatorControlState: manifest.operatorControlState,
          operatorReport,
          handoff: {
            boundaryId: boundary?.boundaryId ?? null,
            providerJobId: boundary?.providerJob?.jobId ?? null,
            nextAction: manifest.operatorControlState.nextAction,
            availableCommands: manifest.operatorControlState.availableCommands,
          operatorReportId: operatorReport.reportId,
          operatorReportStatus: operatorReport.status,
          workflowActionPacketId: workflowActionPacket.packetId,
          workflowPrimaryAction: workflowActionPacket.primaryAction,
          externalReviewBundleId: externalReviewBundle.bundleId,
          externalReviewStatus: externalReviewBundle.status,
          clientReviewEnvelopeId: clientReviewEnvelope.envelopeId,
          clientReviewStatus: clientReviewEnvelope.status,
          clientReviewNextAction: clientReviewEnvelope.nextAction,
          commitReadinessCapsuleId: commitReadinessCapsule.capsuleId,
          commitReadinessStatus: commitReadinessCapsule.status,
          commitReadinessNextAction: commitReadinessCapsule.nextAction,
          providerSyncCheckpointKey: providerSyncCheckpoint.checkpointKey,
          providerSyncStatus: providerSyncCheckpoint.status,
          providerSyncNextAction: providerSyncCheckpoint.externalHandoff.nextAction,
        },
      }
      : name === MAILCHIMP_SYSCALLS.readContinuationPacket
        ? {
            continuationPacket,
            providerSyncCheckpoint,
            handoff: {
              boundaryId: boundary?.boundaryId ?? null,
              providerJobId: boundary?.providerJob?.jobId ?? null,
              nextClientStep: continuationPacket.nextClientStep,
              retryMode: continuationPacket.retryBackoff.mode,
              degraded: continuationPacket.degradedMode.active,
              workflowActionStatus: workflowActionPacket.status,
              workflowActiveStepId: workflowActionPacket.activeStepId,
              externalReviewStatus: externalReviewBundle.status,
              externalReviewNextAction: externalReviewBundle.nextAction,
              clientReviewStatus: clientReviewEnvelope.status,
              clientReviewNextAction: clientReviewEnvelope.nextAction,
              commitReadinessStatus: commitReadinessCapsule.status,
              commitReadinessResumeMode: commitReadinessCapsule.resume.mode,
              commitReadinessRestartSafe: commitReadinessCapsule.resume.restartSafe,
              providerSyncStatus: providerSyncCheckpoint.status,
              providerSyncCursor: providerSyncCheckpoint.syncMetadata.cursor,
              providerSyncRetryable: providerSyncCheckpoint.syncMetadata.retryable,
              providerSyncNextAction: providerSyncCheckpoint.externalHandoff.nextAction,
            },
          }
        : name === MAILCHIMP_SYSCALLS.planRecoveryResume
          ? {
              recoveryPlan: {
                boundaryId: boundary?.boundaryId ?? null,
                providerJobId: boundary?.providerJob?.jobId ?? null,
                allowed: continuationPacket.resumable.allowed,
                cursor: continuationPacket.resumable.cursor,
                nextClientStep: continuationPacket.nextClientStep,
                retryBackoff: continuationPacket.retryBackoff,
                providerSync: {
                  checkpointKey: providerSyncCheckpoint.checkpointKey,
                  status: providerSyncCheckpoint.status,
                  cursor: providerSyncCheckpoint.syncMetadata.cursor,
                  retryable: providerSyncCheckpoint.syncMetadata.retryable,
                  retryAfterSeconds: providerSyncCheckpoint.syncMetadata.retryAfterSeconds,
                  restartSafe: providerSyncCheckpoint.restartSafe,
                  nextAction: providerSyncCheckpoint.externalHandoff.nextAction,
                },
                rollbackArtifacts: boundary?.recovery?.rollbackArtifacts ?? boundary?.artifactPlan?.map((artifact) => artifact.path) ?? [],
            },
          }
        : name === MAILCHIMP_SYSCALLS.preflightAdapterCommit
          ? {
              adapterCommitGate,
              handoff: {
                boundaryId: boundary?.boundaryId ?? null,
                providerJobId: boundary?.providerJob?.jobId ?? null,
                writeSetId: adapterCommitGate.writeSetId,
                allowed: adapterCommitGate.canCommit,
                nextAction: adapterCommitGate.nextAction,
                blockerCodes: adapterCommitGate.blockers.map((blocker) => blocker.code),
                externalReviewBundleId: externalReviewBundle.bundleId,
                externalReviewBlockingActions: externalReviewBundle.blockingActions.map((entry) => entry.code),
                clientReviewEnvelopeId: clientReviewEnvelope.envelopeId,
                clientReviewBlockingActions: clientReviewEnvelope.blockingExplanations.map((entry) => entry.code),
                commitReadinessCapsuleId: commitReadinessCapsule.capsuleId,
                commitReadinessActionCodes: commitReadinessCapsule.actions.map((entry) => entry.code),
                commitReadinessResumeMode: commitReadinessCapsule.resume.mode,
                providerSyncCheckpointKey: providerSyncCheckpoint.checkpointKey,
                providerSyncStatus: providerSyncCheckpoint.status,
                providerSyncBlockedReasons: providerSyncCheckpoint.blockedReasons,
              },
            }
      : name === MAILCHIMP_SYSCALLS.readProviderSyncCheckpoint
        ? {
            providerSyncCheckpoint,
            handoff: {
              boundaryId: boundary?.boundaryId ?? null,
              providerJobId: boundary?.providerJob?.jobId ?? null,
              checkpointKey: providerSyncCheckpoint.checkpointKey,
              status: providerSyncCheckpoint.status,
              ready: providerSyncCheckpoint.ready,
              cursor: providerSyncCheckpoint.syncMetadata.cursor,
              lastProviderRequestId: providerSyncCheckpoint.syncMetadata.lastProviderRequestId,
              retryable: providerSyncCheckpoint.syncMetadata.retryable,
              retryAfterSeconds: providerSyncCheckpoint.syncMetadata.retryAfterSeconds,
              capabilityStatus: providerSyncCheckpoint.capabilityNegotiation.status,
              missingCapabilities: providerSyncCheckpoint.capabilityNegotiation.missing,
              deniedCapabilities: providerSyncCheckpoint.capabilityNegotiation.denied,
              externalHandoffState: providerSyncCheckpoint.externalHandoff.state,
              nextAction: providerSyncCheckpoint.externalHandoff.nextAction,
              restartSafe: providerSyncCheckpoint.restartSafe,
            },
          }
      : null,
    issues,
  };
}

export function buildMailchimpAudienceSyncSyscalls(boundary, members = []) {
  const normalizedMembers = Array.isArray(members) ? members : [];

  return [
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.planAudienceSync, boundary, {
      memberCount: normalizedMembers.length,
      dryRun: true,
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.previewMemberUpsert, boundary, {
      members: normalizedMembers.map((member, index) => ({
        index,
        email_address: member?.email_address ?? null,
        hasMergeFields: Boolean(member?.merge_fields && typeof member.merge_fields === "object"),
        tagCount: Array.isArray(member?.tags) ? member.tags.length : 0,
      })),
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.recordTruthBoundary, boundary, {
      boundaryDigest: boundary?.truthBoundary?.workspaceDigest ?? boundary?.truthBoundary?.digest ?? null,
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.exportAnalyticsHistory, boundary, {
      exportId: boundary?.analyticsExport?.exportId ?? null,
      counters: boundary?.analyticsExport?.counters ?? null,
      operatorReportId: boundary?.operatorReport?.reportId ?? boundary?.artifactWriteSet?.operatorReport?.reportId ?? null,
      operatorReportStatus: boundary?.operatorReport?.status ?? boundary?.artifactWriteSet?.operatorReport?.status ?? null,
      timelineSteps: Array.isArray(boundary?.analyticsExport?.timeline)
        ? boundary.analyticsExport.timeline.map((entry) => entry.step)
        : [],
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.readOperatorControlState, boundary, {
      stateId: boundary?.operatorControlState?.stateId ?? null,
      nextAction: boundary?.operatorControlState?.nextAction ?? boundary?.providerJob?.lifecycleState?.nextAction ?? "operator.review",
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.readContinuationPacket, boundary, {
      packetId: boundary?.continuationPacket?.packetId ?? null,
      nextClientStep: boundary?.continuationPacket?.nextClientStep ?? boundary?.providerJob?.lifecycleState?.nextAction ?? "operator.review",
      retryMode: boundary?.continuationPacket?.retryBackoff?.mode ?? boundary?.providerJob?.operationalHealth?.retryPlan?.mode ?? null,
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.planRecoveryResume, boundary, {
      packetId: boundary?.continuationPacket?.packetId ?? null,
      resumable: boundary?.continuationPacket?.resumable?.allowed ?? (boundary?.status === "ready"),
      cursor: boundary?.continuationPacket?.resumable?.cursor ?? boundary?.providerJob?.jobId ?? null,
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.preflightAdapterCommit, boundary, {
      commitMode: boundary?.providerJob?.commitMode ?? "dry-run",
      writeSetId: boundary?.artifactWriteSet?.persistence?.writeSetId ?? null,
      adapterCommitGate: boundary?.adapterCommitGate ?? boundary?.artifactWriteSet?.adapterCommitGate ?? null,
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.readProviderSyncCheckpoint, boundary, {
      checkpointKey: boundary?.providerSyncCheckpoint?.checkpointKey
        ?? boundary?.memoryContract?.providerSyncCheckpoint?.checkpointKey
        ?? boundary?.memoryContract?.exportContract?.providerSync?.checkpointKey
        ?? null,
      providerSyncStatus: boundary?.providerSyncCheckpoint?.status
        ?? boundary?.memoryContract?.providerSyncCheckpoint?.status
        ?? boundary?.memoryContract?.exportContract?.providerSync?.status
        ?? "not_bound",
    }),
  ];
}

export function buildMailchimpArtifactWriteSyscalls(boundary, writeSet = {}) {
  const summary = {
    status: writeSet?.status ?? "blocked",
    boundaryId: writeSet?.boundaryId ?? boundary?.boundaryId ?? null,
    writeSetId: writeSet?.persistence?.writeSetId ?? null,
    recordCount: Array.isArray(writeSet?.records) ? writeSet.records.length : 0,
    readyArtifactCommandCount: writeSet?.persistence?.counters?.readyToWrite ?? 0,
    pendingAcceptanceCount: writeSet?.acceptance?.pendingCount ?? 0,
    issueCodes: Array.isArray(writeSet?.issues) ? writeSet.issues.map((issue) => issue.code).sort() : [],
    commitReadiness: writeSet?.commitReadinessCapsule
      ? {
          capsuleId: writeSet.commitReadinessCapsule.capsuleId ?? null,
          status: writeSet.commitReadinessCapsule.status ?? "not_bound",
          nextAction: writeSet.commitReadinessCapsule.nextAction ?? null,
          canCommit: writeSet.commitReadinessCapsule.canCommit === true,
          resumeMode: writeSet.commitReadinessCapsule.resume?.mode ?? null,
          actionCodes: Array.isArray(writeSet.commitReadinessCapsule.actions)
            ? writeSet.commitReadinessCapsule.actions.map((entry) => entry.code).sort()
            : [],
        }
      : null,
  };
  const continuation = boundary?.continuationPacket ?? {};
  const recoveryResume = writeSet?.status === "ready" || writeSet?.status === "needs_acceptance"
    ? {
        source: "artifact-write-set",
        writeSetId: summary.writeSetId,
        resumeMode: summary.readyArtifactCommandCount > 0 ? "resume_pending_local_writes" : "observe_persisted_artifacts",
      }
    : {
        source: "artifact-write-set",
        writeSetId: summary.writeSetId,
        resumeMode: "repair_artifact_contract",
      };

  return [
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.planAudienceSync, boundary, {
      dryRun: true,
      artifactWriteSet: summary,
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.recordTruthBoundary, boundary, {
      writeSetId: summary.writeSetId,
      paths: Array.isArray(writeSet?.records) ? writeSet.records.map((record) => record.path) : [],
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.exportAnalyticsHistory, boundary, {
      exportId: boundary?.analyticsExport?.exportId ?? null,
      writeSetId: summary.writeSetId,
      artifactReadiness: writeSet?.readiness ?? null,
      operatorReportId: writeSet?.operatorReport?.reportId ?? null,
      operatorReportStatus: writeSet?.operatorReport?.status ?? null,
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.readOperatorControlState, boundary, {
      stateId: boundary?.operatorControlState?.stateId ?? null,
      artifactAcceptance: writeSet?.acceptance ?? null,
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.readContinuationPacket, boundary, {
      packetId: continuation.packetId ?? null,
      artifactRecovery: writeSet?.persistence?.recovery ?? [],
      commitReadiness: summary.commitReadiness,
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.planRecoveryResume, boundary, recoveryResume),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.preflightAdapterCommit, boundary, {
      writeSetId: summary.writeSetId,
      status: writeSet?.adapterCommitGate?.status ?? "blocked",
      canCommit: writeSet?.adapterCommitGate?.canCommit === true,
      commitReadiness: summary.commitReadiness,
      blockers: Array.isArray(writeSet?.adapterCommitGate?.blockers)
        ? writeSet.adapterCommitGate.blockers.map((blocker) => blocker.code)
        : [],
    }),
    buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.readProviderSyncCheckpoint, boundary, {
      writeSetId: summary.writeSetId,
      providerSyncCheckpointKey: boundary?.providerSyncCheckpoint?.checkpointKey
        ?? boundary?.memoryContract?.providerSyncCheckpoint?.checkpointKey
        ?? boundary?.memoryContract?.exportContract?.providerSync?.checkpointKey
        ?? null,
    }),
  ];
}

export function buildMailchimpExternalHandoffState(boundary) {
  const manifest = createMailchimpSyscallManifest(boundary);
  const commitDescriptor = buildMailchimpSyscallDescriptor(MAILCHIMP_SYSCALLS.commitAdapterBatch, boundary, {
    requestedAction: manifest.syncMetadata.nextAction,
  });

  return {
    kind: "aios.stdlib.external_handoff_state",
    provider: "mailchimp",
    boundaryId: boundary?.boundaryId ?? null,
    status: commitDescriptor.status,
    syncMetadata: manifest.syncMetadata,
    operatorControlState: manifest.operatorControlState,
    continuationPacket: manifest.continuationPacket,
    adapterCommitGate: manifest.adapterCommitGate,
    operatorReport: manifest.operatorReport,
    workflowActionPacket: manifest.workflowActionPacket,
      externalReviewBundle: manifest.externalReviewBundle,
      clientReviewEnvelope: manifest.clientReviewEnvelope,
      commitReadinessCapsule: manifest.commitReadinessCapsule,
    providerSyncCheckpoint: manifest.providerSyncCheckpoint,
    capabilityNegotiation: commitDescriptor.capabilityNegotiation,
    sideEffectBoundary: boundary?.truthBoundary?.sideEffectBoundary ?? "local-dry-run",
    nextAction: manifest.adapterCommitGate.canCommit ? "adapter.commit" : manifest.adapterCommitGate.nextAction,
    availableCommands: manifest.operatorControlState.availableCommands,
    retryBackoff: manifest.continuationPacket.retryBackoff,
    degradedMode: manifest.continuationPacket.degradedMode,
    reportingHandoff: {
      reportId: manifest.operatorReport.reportId,
      status: manifest.operatorReport.status,
      nextAction: manifest.operatorReport.nextAction,
      blockingSections: manifest.operatorReport.blockingSections.map((section) => section.name),
      counters: manifest.operatorReport.counters,
    },
    workflowHandoff: {
      packetId: manifest.workflowActionPacket.packetId,
      status: manifest.workflowActionPacket.status,
      primaryAction: manifest.workflowActionPacket.primaryAction,
      activeStepId: manifest.workflowActionPacket.activeStepId,
      blockingCodes: manifest.workflowActionPacket.issueSummary.blockingCodes,
      canCommit: manifest.workflowActionPacket.adapterCommit.canCommit,
    },
    reviewHandoff: {
      bundleId: manifest.externalReviewBundle.bundleId,
      status: manifest.externalReviewBundle.status,
      nextAction: manifest.externalReviewBundle.nextAction,
      restartSafe: manifest.externalReviewBundle.restartSafe,
      artifactReferences: manifest.externalReviewBundle.artifactReferences,
      blockingActions: manifest.externalReviewBundle.blockingActions.map((entry) => entry.code),
      userVisibleSummary: manifest.externalReviewBundle.userVisibleSummary,
    },
    clientReviewHandoff: {
      envelopeId: manifest.clientReviewEnvelope.envelopeId,
      status: manifest.clientReviewEnvelope.status,
      nextAction: manifest.clientReviewEnvelope.nextAction,
      requiredAcknowledgements: manifest.clientReviewEnvelope.requiredAcknowledgements,
      validationSummary: manifest.clientReviewEnvelope.validationSummary,
      acceptance: manifest.clientReviewEnvelope.acceptance,
      readiness: manifest.clientReviewEnvelope.readiness,
      blockingCodes: manifest.clientReviewEnvelope.blockingExplanations.map((entry) => entry.code),
      restartSafe: manifest.clientReviewEnvelope.restartSafe,
    },
    commitReadinessHandoff: {
      capsuleId: manifest.commitReadinessCapsule.capsuleId,
      status: manifest.commitReadinessCapsule.status,
      canCommit: manifest.commitReadinessCapsule.canCommit,
      nextAction: manifest.commitReadinessCapsule.nextAction,
      resumeMode: manifest.commitReadinessCapsule.resume.mode,
      resumeAllowed: manifest.commitReadinessCapsule.resume.allowed,
      restartSafe: manifest.commitReadinessCapsule.restartSafe,
      gates: manifest.commitReadinessCapsule.gates,
      actionCodes: manifest.commitReadinessCapsule.actions.map((entry) => entry.code),
      userVisibleState: manifest.commitReadinessCapsule.userVisibleState,
    },
    providerSyncHandoff: {
      checkpointKey: manifest.providerSyncCheckpoint.checkpointKey,
      status: manifest.providerSyncCheckpoint.status,
      ready: manifest.providerSyncCheckpoint.ready,
      cursor: manifest.providerSyncCheckpoint.syncMetadata.cursor,
      lastProviderRequestId: manifest.providerSyncCheckpoint.syncMetadata.lastProviderRequestId,
      retryable: manifest.providerSyncCheckpoint.syncMetadata.retryable,
      retryAfterSeconds: manifest.providerSyncCheckpoint.syncMetadata.retryAfterSeconds,
      capabilityStatus: manifest.providerSyncCheckpoint.capabilityNegotiation.status,
      missingCapabilities: manifest.providerSyncCheckpoint.capabilityNegotiation.missing,
      deniedCapabilities: manifest.providerSyncCheckpoint.capabilityNegotiation.denied,
      externalHandoffState: manifest.providerSyncCheckpoint.externalHandoff.state,
      nextAction: manifest.providerSyncCheckpoint.externalHandoff.nextAction,
      restartSafe: manifest.providerSyncCheckpoint.restartSafe,
      commandStates: manifest.providerSyncCheckpoint.commands.map((command) => ({
        command: command.command,
        state: command.state,
        restartSafe: command.restartSafe,
      })),
    },
    issues: commitDescriptor.issues,
  };
}
