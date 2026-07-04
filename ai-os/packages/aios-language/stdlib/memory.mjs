import { compileMailchimpWorkflowActionPacket } from "./capabilities.mjs";

const SENSITIVE_KEYS = new Set(["apiKey", "token", "authorization", "secret", "password"]);

function stableString(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableString).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`)
    .join(",")}}`;
}

function stableHash(value) {
  const input = stableString(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function scrub(value) {
  if (Array.isArray(value)) {
    return value.map(scrub);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEYS.has(key) ? "[redacted]" : scrub(entry)
    ])
  );
}

function normalizeAudience(audience = {}) {
  return {
    listId: String(audience.listId ?? audience.id ?? "").trim(),
    segmentId: String(audience.segmentId ?? "").trim(),
    expectedRecipients: Number.isFinite(audience.expectedRecipients)
      ? Math.max(0, Math.floor(audience.expectedRecipients))
      : null
  };
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeRuntimeState(input = {}) {
  const runtime = input.runtime ?? input.clientRuntime ?? {};
  const request = input.request ?? {};
  const workflow = input.workflow ?? {};
  const handoff = input.handoff ?? runtime.handoff ?? {};
  const requestedAt = normalizeString(runtime.requestedAt ?? request.requestedAt);

  return {
    requestId: normalizeString(runtime.requestId ?? request.id ?? input.requestId),
    conversationId: normalizeString(runtime.conversationId ?? request.conversationId),
    userMessageId: normalizeString(runtime.userMessageId ?? request.userMessageId),
    workflowId: normalizeString(runtime.workflowId ?? workflow.id ?? input.workflowId),
    workflowStep: normalizeString(runtime.workflowStep ?? workflow.step ?? input.workflowStep),
    requestedAt: requestedAt || null,
    handoffStatus: normalizeString(handoff.status ?? runtime.handoffStatus) || "not_started",
    adapterRunId: normalizeString(handoff.adapterRunId ?? runtime.adapterRunId),
    resumeToken: normalizeString(handoff.resumeToken ?? runtime.resumeToken),
    clientVisibleStatus:
      normalizeString(runtime.clientVisibleStatus ?? input.clientVisibleStatus) || "collecting_facts"
  };
}

function normalizePreviewAcceptanceMemory(input = {}) {
  const providerJob = input.providerJob && typeof input.providerJob === "object" ? input.providerJob : {};
  const writeSet = input.artifactWriteSet && typeof input.artifactWriteSet === "object" ? input.artifactWriteSet : {};
  const previewAcceptance = input.previewAcceptance && typeof input.previewAcceptance === "object"
    ? input.previewAcceptance
    : providerJob.previewAcceptance && typeof providerJob.previewAcceptance === "object"
      ? providerJob.previewAcceptance
      : {};
  const clientPreviewSurface = input.clientPreviewSurface && typeof input.clientPreviewSurface === "object"
    ? input.clientPreviewSurface
    : providerJob.clientPreviewSurface && typeof providerJob.clientPreviewSurface === "object"
      ? providerJob.clientPreviewSurface
      : {};
  const clientRuntimeHandoff = input.clientRuntimeHandoff && typeof input.clientRuntimeHandoff === "object"
    ? input.clientRuntimeHandoff
    : providerJob.clientRuntimeHandoff && typeof providerJob.clientRuntimeHandoff === "object"
      ? providerJob.clientRuntimeHandoff
      : providerJob.adapterHandoff?.clientRuntimeHandoff && typeof providerJob.adapterHandoff.clientRuntimeHandoff === "object"
        ? providerJob.adapterHandoff.clientRuntimeHandoff
        : {};
  const acceptance = writeSet.acceptance && typeof writeSet.acceptance === "object"
    ? writeSet.acceptance
    : input.acceptance && typeof input.acceptance === "object"
      ? input.acceptance
      : {};
  const receipt = writeSet.acceptanceReceipt && typeof writeSet.acceptanceReceipt === "object"
    ? writeSet.acceptanceReceipt
    : input.acceptanceReceipt && typeof input.acceptanceReceipt === "object"
      ? input.acceptanceReceipt
      : {};
  const preview = Array.isArray(writeSet.previewRows)
    ? { rowCount: writeSet.previewRows.length }
    : input.preview && typeof input.preview === "object"
      ? input.preview
      : {};
  const pendingKeys = Array.isArray(acceptance.pendingKeys) ? acceptance.pendingKeys.map(normalizeString).filter(Boolean) : [];
  const acceptedKeys = Array.isArray(acceptance.acceptedKeys) ? acceptance.acceptedKeys.map(normalizeString).filter(Boolean) : [];
  const rejectedKeys = Array.isArray(acceptance.rejectedKeys) ? acceptance.rejectedKeys.map(normalizeString).filter(Boolean) : [];
  const blockingIssueCodes = Array.isArray(clientPreviewSurface.readiness?.blockingIssueCodes)
    ? clientPreviewSurface.readiness.blockingIssueCodes
    : Array.isArray(previewAcceptance.validationSummary?.blockingIssueCodes)
      ? previewAcceptance.validationSummary.blockingIssueCodes
      : [];

  return {
    contractVersion: "aios.mailchimp.preview-acceptance-memory.v1",
    providerJobId: normalizeString(providerJob.jobId || input.providerJobId),
    audienceId: normalizeString(
      providerJob.adapterHandoff?.audience?.audienceId
        || input.audience?.audienceId
        || input.audience?.listId
        || input.listId
    ),
    status: normalizeString(acceptance.status || previewAcceptance.status || clientPreviewSurface.status) || "not_started",
    receiptId: normalizeString(receipt.receiptId),
    preview: {
      rowCount: Number.isFinite(preview.rowCount) ? Math.max(0, Math.floor(preview.rowCount)) : 0,
      maxRows: Number.isFinite(clientPreviewSurface.preview?.maxRows)
        ? Math.max(0, Math.floor(clientPreviewSurface.preview.maxRows))
        : Number.isFinite(providerJob.lifecycleState?.settings?.maxPreviewRows)
          ? Math.max(0, Math.floor(providerJob.lifecycleState.settings.maxPreviewRows))
          : null,
      validationSummaryRequired: clientPreviewSurface.preview?.validationSummaryRequired !== false,
    },
    acceptance: {
      required: acceptance.acceptanceRequired ?? clientPreviewSurface.acceptance?.required ?? true,
      mode: normalizeString(acceptance.acceptanceMode || clientPreviewSurface.acceptance?.mode) || "per-row",
      acceptedCount: Number.isFinite(acceptance.acceptedCount) ? Math.max(0, Math.floor(acceptance.acceptedCount)) : acceptedKeys.length,
      rejectedCount: Number.isFinite(acceptance.rejectedCount) ? Math.max(0, Math.floor(acceptance.rejectedCount)) : rejectedKeys.length,
      pendingCount: Number.isFinite(acceptance.pendingCount) ? Math.max(0, Math.floor(acceptance.pendingCount)) : pendingKeys.length,
      validationAccepted: acceptance.validationAccepted === true || receipt.validationAccepted === true,
      acceptedKeys,
      rejectedKeys,
      pendingKeys,
    },
    readiness: {
      previewEnabled: clientPreviewSurface.readiness?.previewEnabled === true,
      commitEnabled: clientPreviewSurface.readiness?.commitEnabled === true,
      blockingIssueCodes: blockingIssueCodes.map(normalizeString).filter(Boolean).sort(),
      nextAction: normalizeString(
        writeSet.clientWorkflowHandoff?.nextAction
          || clientPreviewSurface.nextActions?.find?.((action) => action.enabled)?.id
          || acceptance.nextStep
      ) || "operator.review",
    },
    externalHandoff: {
      status: normalizeString(clientPreviewSurface.handoff?.status) || "local_preview",
      commitMode: normalizeString(clientPreviewSurface.handoff?.commitMode) || "dry-run",
      settingsRevision: normalizeString(clientPreviewSurface.handoff?.settingsRevision || providerJob.lifecycleState?.settingsRevision),
      digest: normalizeString(clientPreviewSurface.handoff?.digest),
    },
    clientRuntimeHandoff: normalizeClientRuntimeHandoffMemory(clientRuntimeHandoff),
  };
}

function normalizeClientRuntimeHandoffMemory(handoff = {}) {
  const requestState = handoff.requestState && typeof handoff.requestState === "object" ? handoff.requestState : {};
  const workflowHandoff = handoff.workflowHandoff && typeof handoff.workflowHandoff === "object" ? handoff.workflowHandoff : {};
  const retryPolicy = handoff.retryPolicy && typeof handoff.retryPolicy === "object" ? handoff.retryPolicy : {};
  const missingFields = Array.isArray(requestState.missingFields)
    ? requestState.missingFields.map(normalizeString).filter(Boolean).sort()
    : [];
  const blockedIssueCodes = Array.isArray(retryPolicy.blockedIssueCodes)
    ? retryPolicy.blockedIssueCodes.map(normalizeString).filter(Boolean).sort()
    : [];

  return {
    contractVersion: "aios.mailchimp.client-runtime-handoff-memory.v1",
    status: normalizeString(handoff.status) || (missingFields.length ? "needs_client_state" : "not_bound"),
    requestState: {
      requestId: normalizeString(requestState.requestId),
      workflowId: normalizeString(requestState.workflowId),
      workflowStep: normalizeString(requestState.workflowStep),
      conversationId: normalizeString(requestState.conversationId),
      userMessageId: normalizeString(requestState.userMessageId),
      clientVisibleStatus: normalizeString(requestState.clientVisibleStatus) || "provider_settings_review",
      missingFields,
    },
    workflowHandoff: {
      handoffStatus: normalizeString(workflowHandoff.handoffStatus) || "not_started",
      adapterRunId: normalizeString(workflowHandoff.adapterRunId),
      resumeToken: normalizeString(workflowHandoff.resumeToken),
      continuationKey: normalizeString(workflowHandoff.continuationKey),
      nextClientAction: normalizeString(workflowHandoff.nextClientAction) || "review-mailchimp-preview",
    },
    retryPolicy: {
      retryable: retryPolicy.retryable !== false,
      retryLimit: Number.isFinite(retryPolicy.retryLimit) ? Math.max(0, Math.floor(retryPolicy.retryLimit)) : 0,
      backoff: normalizeString(retryPolicy.backoff) || "none",
      retryableIssueCodes: Array.isArray(retryPolicy.retryableIssueCodes)
        ? retryPolicy.retryableIssueCodes.map(normalizeString).filter(Boolean).sort()
        : [],
      blockedIssueCodes,
    },
  };
}

function normalizeProviderRuntimePersistenceMemory(input = {}) {
  const providerJob = input.providerJob && typeof input.providerJob === "object" ? input.providerJob : {};
  const source = input.runtimePersistence && typeof input.runtimePersistence === "object"
    ? input.runtimePersistence
    : providerJob.runtimePersistence && typeof providerJob.runtimePersistence === "object"
      ? providerJob.runtimePersistence
      : providerJob.adapterHandoff?.runtimePersistence && typeof providerJob.adapterHandoff.runtimePersistence === "object"
        ? providerJob.adapterHandoff.runtimePersistence
        : {};
  const persistCommand = source.persistCommand && typeof source.persistCommand === "object" ? source.persistCommand : {};
  const resumeCommand = source.resumeCommand && typeof source.resumeCommand === "object" ? source.resumeCommand : {};
  const recovery = Array.isArray(source.recovery) ? source.recovery : [];

  return {
    contractVersion: "aios.mailchimp.provider-runtime-persistence-memory.v1",
    stateKey: normalizeString(source.stateKey),
    providerJobId: normalizeString(source.providerJobId || providerJob.jobId || input.providerJobId),
    audienceId: normalizeString(source.audienceId || providerJob.adapterHandoff?.audience?.audienceId),
    settingsRevision: normalizeString(source.settingsRevision || providerJob.lifecycleState?.settingsRevision),
    status: normalizeString(source.status) || "not_bound",
    sequence: Number.isFinite(source.sequence) ? Math.max(0, Math.floor(source.sequence)) : 0,
    checksum: normalizeString(source.checksum),
    previousChecksum: normalizeString(source.previousChecksum) || null,
    restartSafe: source.restartSafe === true,
    alreadyPersisted: source.alreadyPersisted === true,
    commands: {
      persist: {
        id: normalizeString(persistCommand.id),
        idempotencyKey: normalizeString(persistCommand.idempotencyKey),
        status: normalizeString(persistCommand.status) || "not_planned",
      },
      resume: {
        id: normalizeString(resumeCommand.id),
        idempotencyKey: normalizeString(resumeCommand.idempotencyKey),
        status: normalizeString(resumeCommand.status) || "not_planned",
        continuationKey: normalizeString(resumeCommand.continuationKey),
        resumeTokenPresent: Boolean(resumeCommand.resumeToken),
        adapterRunId: normalizeString(resumeCommand.adapterRunId),
      },
    },
    recovery: recovery.map((entry) => ({
      code: normalizeString(entry.code),
      field: normalizeString(entry.field),
      action: normalizeString(entry.action),
    })).filter((entry) => entry.code || entry.action),
  };
}

function normalizeRuntimeBoundaryMemory(input = {}) {
  const providerJob = input.providerJob && typeof input.providerJob === "object" ? input.providerJob : {};
  const providerService = input.providerServiceContract && typeof input.providerServiceContract === "object"
    ? input.providerServiceContract
    : {};
  const source = input.runtimeBoundary && typeof input.runtimeBoundary === "object"
    ? input.runtimeBoundary
    : input.providerRuntimeBoundary && typeof input.providerRuntimeBoundary === "object"
      ? input.providerRuntimeBoundary
      : providerJob.runtimeBoundary && typeof providerJob.runtimeBoundary === "object"
        ? providerJob.runtimeBoundary
        : providerJob.adapterHandoff?.runtimeBoundary && typeof providerJob.adapterHandoff.runtimeBoundary === "object"
          ? providerJob.adapterHandoff.runtimeBoundary
          : providerService.runtimeBoundary && typeof providerService.runtimeBoundary === "object"
            ? providerService.runtimeBoundary
            : {};
  const controls = source.controls && typeof source.controls === "object" ? source.controls : {};
  const audit = source.auditHandoff && typeof source.auditHandoff === "object" ? source.auditHandoff : {};
  const missingPermissions = Array.isArray(source.missingPermissions)
    ? source.missingPermissions.map(normalizeString).filter(Boolean).sort()
    : Array.isArray(source.permissions?.missing)
      ? source.permissions.missing.map(normalizeString).filter(Boolean).sort()
      : [];
  const tenant = normalizeString(source.tenant || input.tenant || input.tenantId);
  const workspace = normalizeString(source.workspace || input.workspace || input.workspaceId || input.audience?.audienceId || input.audience?.listId);
  const leaseState = normalizeString(source.leaseState || source.state || "observed").replaceAll("-", "_");
  const digest = normalizeString(source.digest) || stableHash({
    tenant,
    workspace,
    leaseId: source.leaseId,
    policyVersion: source.policyVersion,
    missingPermissions,
  });

  return {
    contractVersion: "aios.mailchimp.runtime-boundary-memory.v1",
    tenant,
    workspace,
    actorId: normalizeString(source.actorId || source.actor),
    leaseId: normalizeString(source.leaseId),
    leaseState,
    policyVersion: normalizeString(source.policyVersion) || "1",
    digest,
    auditSink: normalizeString(source.auditSink || audit.sink) || "local-runtime-audit",
    previewAllowed: controls.previewAllowed === true || source.previewAllowed === true,
    commitAllowed: controls.commitAllowed === true || source.commitAllowed === true,
    leaseActive: controls.leaseActive === true || !["expired", "revoked", "blocked"].includes(leaseState),
    missingPermissions,
    restartSafe: Boolean(tenant && workspace && !["expired", "revoked", "blocked"].includes(leaseState)),
    auditHandoff: {
      sink: normalizeString(source.auditSink || audit.sink) || "local-runtime-audit",
      eventType: normalizeString(audit.eventType) || "mailchimp.memory.runtime_boundary.persisted",
      tenant,
      workspace,
      actorId: normalizeString(source.actorId || source.actor),
      boundaryDigest: digest,
      restartSafe: true,
    },
    nextAction: tenant && workspace && missingPermissions.length === 0
      ? "persist-memory-snapshot"
      : "bind-runtime-boundary",
  };
}

function normalizeProviderAnalyticsExportMemory(input = {}) {
  const providerJob = input.providerJob && typeof input.providerJob === "object" ? input.providerJob : {};
  const writeSet = input.artifactWriteSet && typeof input.artifactWriteSet === "object" ? input.artifactWriteSet : {};
  const source = input.analyticsExport && typeof input.analyticsExport === "object"
    ? input.analyticsExport
    : providerJob.analyticsExport && typeof providerJob.analyticsExport === "object"
      ? providerJob.analyticsExport
      : providerJob.adapterHandoff?.analyticsExport && typeof providerJob.adapterHandoff.analyticsExport === "object"
        ? providerJob.adapterHandoff.analyticsExport
        : {};
  const summary = source.exportSummary && typeof source.exportSummary === "object" ? source.exportSummary : {};
  const analyticsRecord = Array.isArray(writeSet.records)
    ? writeSet.records.find((record) => record.logicalName === "analytics-export")
    : null;
  const history = Array.isArray(source.historySnapshots) ? source.historySnapshots : [];
  const timeline = Array.isArray(source.timeline) ? source.timeline : [];
  const counters = source.counters && typeof source.counters === "object" ? source.counters : {};
  const blockedReasons = Array.isArray(summary.blockedReasons)
    ? summary.blockedReasons.map(normalizeString).filter(Boolean).sort()
    : [];
  const exportDigest = normalizeString(source.exportDigest || analyticsRecord?.digest);

  return {
    contractVersion: "aios.mailchimp.provider-analytics-export-memory.v1",
    providerJobId: normalizeString(source.providerJobId || providerJob.jobId || input.providerJobId),
    audienceId: normalizeString(source.audienceId || providerJob.adapterHandoff?.audience?.audienceId || input.audience?.listId),
    status: normalizeString(summary.status || source.status) || "not_bound",
    exportDigest,
    artifactDigest: normalizeString(analyticsRecord?.digest),
    artifactPath: normalizeString(analyticsRecord?.path),
    settingsRevision: normalizeString(summary.settingsRevision || providerJob.lifecycleState?.settingsRevision),
    stateKey: normalizeString(summary.stateKey),
    sequence: Number.isFinite(summary.sequence) ? Math.max(0, Math.floor(summary.sequence)) : 0,
    restartSafe: summary.restartSafe === true || (Boolean(exportDigest) && blockedReasons.length === 0),
    counters: {
      issueTotal: Number.isFinite(counters.issueTotal) ? Math.max(0, Math.floor(counters.issueTotal)) : 0,
      blockingIssueTotal: Number.isFinite(counters.blockingIssueTotal) ? Math.max(0, Math.floor(counters.blockingIssueTotal)) : blockedReasons.length,
      warningIssueTotal: Number.isFinite(counters.warningIssueTotal) ? Math.max(0, Math.floor(counters.warningIssueTotal)) : 0,
      historySnapshotTotal: history.length,
      timelineEventTotal: timeline.length,
    },
    history: {
      latestDigest: normalizeString(history.at(-1)?.digest || exportDigest),
      snapshotCount: history.length,
      statuses: [...new Set(history.map((entry) => normalizeString(entry.status)).filter(Boolean))].sort(),
    },
    timeline: timeline.slice(0, 12).map((entry, index) => ({
      index,
      phase: normalizeString(entry.phase) || "analytics",
      status: normalizeString(entry.status) || "unknown",
      action: normalizeString(entry.action) || "operator.review",
      restartSafe: entry.restartSafe !== false,
    })),
    blockedReasons,
    nextAction: normalizeString(summary.nextAction) || (blockedReasons.length ? "repair-provider-analytics-export" : "persist-memory-snapshot"),
  };
}

function normalizeOperatorReportMemory(input = {}) {
  const providerJob = input.providerJob && typeof input.providerJob === "object" ? input.providerJob : {};
  const writeSet = input.artifactWriteSet && typeof input.artifactWriteSet === "object" ? input.artifactWriteSet : {};
  const providerService = input.providerServiceContract && typeof input.providerServiceContract === "object"
    ? input.providerServiceContract
    : {};
  const source = input.operatorReport && typeof input.operatorReport === "object"
    ? input.operatorReport
    : writeSet.operatorReport && typeof writeSet.operatorReport === "object"
      ? writeSet.operatorReport
      : providerJob.adapterHandoff?.operatorReport && typeof providerJob.adapterHandoff.operatorReport === "object"
        ? providerJob.adapterHandoff.operatorReport
        : providerService.operatorReport && typeof providerService.operatorReport === "object"
          ? providerService.operatorReport
          : {};
  const sections = source.sections && typeof source.sections === "object" ? source.sections : {};
  const blockingSections = Array.isArray(source.blockingSections)
    ? source.blockingSections.map((section) => ({
        name: normalizeString(section.name),
        status: normalizeString(section.status) || "blocked",
        nextAction: normalizeString(section.nextAction) || "operator.review",
        issueCodes: Array.isArray(section.issueCodes)
          ? section.issueCodes.map(normalizeString).filter(Boolean).sort()
          : [],
      })).filter((section) => section.name)
    : [];
  const counters = source.counters && typeof source.counters === "object" ? source.counters : {};
  const timeline = Array.isArray(source.timeline) ? source.timeline : [];
  const artifacts = Array.isArray(source.artifacts) ? source.artifacts : [];

  return {
    contractVersion: "aios.mailchimp.operator-report-memory.v1",
    reportId: normalizeString(source.reportId),
    providerJobId: normalizeString(source.providerJobId || providerJob.jobId || input.providerJobId),
    boundaryId: normalizeString(source.boundaryId || input.boundaryId),
    writeSetId: normalizeString(source.writeSetId || writeSet.persistence?.writeSetId),
    status: normalizeString(source.status) || "not_bound",
    nextAction: normalizeString(source.nextAction) || (blockingSections[0]?.nextAction ?? "operator.review"),
    restartSafe: source.restartSafe === true || Boolean(source.reportId),
    sections: Object.fromEntries(
      Object.entries(sections).map(([name, section]) => [
        name,
        {
          status: normalizeString(section.status) || "unknown",
          nextAction: normalizeString(section.nextAction || section.nextStep) || "operator.review",
          digest: normalizeString(section.digest) || null,
          issueCodes: Array.isArray(section.issueCodes)
            ? section.issueCodes.map(normalizeString).filter(Boolean).sort()
            : [],
          counters: section.counters && typeof section.counters === "object"
            ? Object.fromEntries(
                Object.entries(section.counters)
                  .filter(([, value]) => Number.isFinite(value))
                  .map(([key, value]) => [key, Math.max(0, Math.floor(value))]),
              )
            : {},
        },
      ]),
    ),
    counters: {
      issueTotal: Number.isFinite(counters.issueTotal) ? Math.max(0, Math.floor(counters.issueTotal)) : 0,
      blockingIssueTotal: Number.isFinite(counters.blockingIssueTotal)
        ? Math.max(0, Math.floor(counters.blockingIssueTotal))
        : blockingSections.length,
      warningIssueTotal: Number.isFinite(counters.warningIssueTotal) ? Math.max(0, Math.floor(counters.warningIssueTotal)) : 0,
      artifactRecordTotal: Number.isFinite(counters.artifactRecordTotal) ? Math.max(0, Math.floor(counters.artifactRecordTotal)) : artifacts.length,
      totalBytes: Number.isFinite(counters.totalBytes) ? Math.max(0, Math.floor(counters.totalBytes)) : 0,
      historySnapshotTotal: Number.isFinite(counters.historySnapshotTotal) ? Math.max(0, Math.floor(counters.historySnapshotTotal)) : 0,
      timelineEventTotal: Number.isFinite(counters.timelineEventTotal) ? Math.max(0, Math.floor(counters.timelineEventTotal)) : timeline.length,
    },
    latestSnapshot: source.latestSnapshot && typeof source.latestSnapshot === "object"
      ? {
          digest: normalizeString(source.latestSnapshot.digest),
          status: normalizeString(source.latestSnapshot.status) || "unknown",
          nextAction: normalizeString(source.latestSnapshot.nextAction) || "operator.review",
          index: Number.isFinite(source.latestSnapshot.index) ? Math.max(0, Math.floor(source.latestSnapshot.index)) : 0,
        }
      : null,
    timeline: timeline.slice(-8).map((entry, index) => ({
      index: Number.isFinite(entry.index) ? Math.max(0, Math.floor(entry.index)) : index,
      phase: normalizeString(entry.phase) || "analytics",
      status: normalizeString(entry.status) || "unknown",
      action: normalizeString(entry.action) || "operator.review",
      restartSafe: entry.restartSafe !== false,
    })),
    artifacts: artifacts.map((artifact) => ({
      logicalName: normalizeString(artifact.logicalName),
      path: normalizeString(artifact.path),
      digest: normalizeString(artifact.digest),
      bytes: Number.isFinite(artifact.bytes) ? Math.max(0, Math.floor(artifact.bytes)) : 0,
    })).filter((artifact) => artifact.logicalName || artifact.path),
    analyticsArtifact: source.analyticsArtifact && typeof source.analyticsArtifact === "object"
      ? {
          path: normalizeString(source.analyticsArtifact.path),
          digest: normalizeString(source.analyticsArtifact.digest),
          bytes: Number.isFinite(source.analyticsArtifact.bytes) ? Math.max(0, Math.floor(source.analyticsArtifact.bytes)) : 0,
        }
      : null,
    blockingSections,
  };
}

function runtimeBoundaryRecoveryIssues(persistedBoundary = {}, observedBoundary = {}) {
  const issues = [];
  if (!persistedBoundary.tenant) {
    issues.push({
      code: "runtime_boundary_missing_tenant",
      field: "runtimeBoundary.tenant",
      action: "bind-runtime-boundary-before-memory-resume"
    });
  }
  if (!persistedBoundary.workspace) {
    issues.push({
      code: "runtime_boundary_missing_workspace",
      field: "runtimeBoundary.workspace",
      action: "bind-runtime-boundary-before-memory-resume"
    });
  }
  if (observedBoundary.tenant && persistedBoundary.tenant && observedBoundary.tenant !== persistedBoundary.tenant) {
    issues.push({
      code: "runtime_boundary_tenant_changed",
      field: "runtimeBoundary.tenant",
      action: "restart-from-review-step-before-cross-tenant-resume",
      previousTenant: persistedBoundary.tenant,
      observedTenant: observedBoundary.tenant
    });
  }
  if (observedBoundary.workspace && persistedBoundary.workspace && observedBoundary.workspace !== persistedBoundary.workspace) {
    issues.push({
      code: "runtime_boundary_workspace_changed",
      field: "runtimeBoundary.workspace",
      action: "restart-from-review-step-before-cross-workspace-resume",
      previousWorkspace: persistedBoundary.workspace,
      observedWorkspace: observedBoundary.workspace
    });
  }
  for (const permission of persistedBoundary.missingPermissions || []) {
    issues.push({
      code: "runtime_boundary_permission_missing",
      field: permission,
      action: "refresh-runtime-permissions-before-memory-resume"
    });
  }
  if (persistedBoundary.leaseActive === false) {
    issues.push({
      code: "runtime_boundary_lease_inactive",
      field: "runtimeBoundary.leaseState",
      action: "refresh-runtime-boundary-lease-before-memory-resume"
    });
  }
  return issues;
}

function buildPreviewDecisionPrompt(previewAcceptance, runtimeState) {
  const pendingCount = previewAcceptance.acceptance.pendingCount;
  const rejectedCount = previewAcceptance.acceptance.rejectedCount;
  const blockingIssueCodes = previewAcceptance.readiness.blockingIssueCodes;
  const runtimeMissing = clientStateMissingFields(runtimeState);
  const handoffMissing = previewAcceptance.clientRuntimeHandoff.requestState.missingFields;
  const missingClientState = [...new Set([...runtimeMissing, ...handoffMissing])].sort();
  const status = blockingIssueCodes.length
    ? "blocked"
    : missingClientState.length
      ? "needs_client_state"
      : rejectedCount > 0
        ? "needs_preview_revision"
        : pendingCount > 0 || previewAcceptance.status === "needs_validation_ack"
          ? "needs_operator_decision"
          : previewAcceptance.readiness.commitEnabled
            ? "ready_for_commit_review"
            : "ready_for_preview";
  const primaryAction = status === "blocked"
    ? "resolve-preview-validation"
    : status === "needs_client_state"
      ? "bind-client-runtime-state"
      : status === "needs_preview_revision"
        ? "revise-preview-rows"
        : status === "needs_operator_decision"
          ? "collect-preview-acceptance"
          : status === "ready_for_commit_review"
            ? "show-commit-review"
            : "show-preview";

  return {
    contractVersion: "aios.mailchimp.preview-decision-prompt.v1",
    status,
    primaryAction,
    missingClientState,
    decisionSummary: {
      previewRows: previewAcceptance.preview.rowCount,
      acceptedRows: previewAcceptance.acceptance.acceptedCount,
      rejectedRows: rejectedCount,
      pendingRows: pendingCount,
      validationAccepted: previewAcceptance.acceptance.validationAccepted,
      acceptanceRequired: previewAcceptance.acceptance.required,
      acceptanceMode: previewAcceptance.acceptance.mode,
    },
    readinessSummary: {
      previewEnabled: previewAcceptance.readiness.previewEnabled,
      commitEnabled: previewAcceptance.readiness.commitEnabled,
      blockingIssueCodes,
      nextAction: previewAcceptance.readiness.nextAction,
    },
    handoffSummary: {
      providerJobId: previewAcceptance.providerJobId,
      receiptId: previewAcceptance.receiptId || null,
      externalStatus: previewAcceptance.externalHandoff.status,
      commitMode: previewAcceptance.externalHandoff.commitMode,
      continuationKey: previewAcceptance.clientRuntimeHandoff.workflowHandoff.continuationKey || null,
      nextClientAction: previewAcceptance.clientRuntimeHandoff.workflowHandoff.nextClientAction,
    },
  };
}

function normalizeClientReviewEnvelopeMemory(input = {}) {
  const providerJob = input.providerJob && typeof input.providerJob === "object" ? input.providerJob : {};
  const writeSet = input.artifactWriteSet && typeof input.artifactWriteSet === "object" ? input.artifactWriteSet : {};
  const source = input.clientReviewEnvelope && typeof input.clientReviewEnvelope === "object"
    ? input.clientReviewEnvelope
    : writeSet.clientReviewEnvelope && typeof writeSet.clientReviewEnvelope === "object"
      ? writeSet.clientReviewEnvelope
      : providerJob.adapterHandoff?.clientReviewEnvelope && typeof providerJob.adapterHandoff.clientReviewEnvelope === "object"
        ? providerJob.adapterHandoff.clientReviewEnvelope
        : {};
  const acceptance = source.acceptance && typeof source.acceptance === "object" ? source.acceptance : {};
  const validation = source.validationSummary && typeof source.validationSummary === "object" ? source.validationSummary : {};
  const readiness = source.readiness && typeof source.readiness === "object" ? source.readiness : {};
  const requiredAcknowledgements = Array.isArray(source.requiredAcknowledgements)
    ? source.requiredAcknowledgements.map((entry) => ({
        id: normalizeString(entry.id),
        status: normalizeString(entry.status) || "pending",
        count: Number.isFinite(entry.count) ? Math.max(0, Math.floor(entry.count)) : 0,
        action: normalizeString(entry.action) || "operator.review",
      })).filter((entry) => entry.id)
    : [];
  const blockingExplanations = Array.isArray(source.blockingExplanations)
    ? source.blockingExplanations.map((entry) => ({
        source: normalizeString(entry.source) || "review",
        code: normalizeString(entry.code || entry.field || entry) || "client_review_blocker",
        field: normalizeString(entry.field) || null,
        action: normalizeString(entry.action) || "repair-client-review-envelope",
      })).filter((entry) => entry.code)
    : [];
  const pendingKeys = Array.isArray(acceptance.pendingKeys)
    ? acceptance.pendingKeys.map(normalizeString).filter(Boolean).sort()
    : [];
  const issueCodes = Array.isArray(validation.issueCodes)
    ? validation.issueCodes.map(normalizeString).filter(Boolean).sort()
    : [];
  const status = normalizeString(source.status)
    || (blockingExplanations.length
      ? "blocked"
      : requiredAcknowledgements.length
        ? "needs_operator_acceptance"
        : readiness.adapterCommitAllowed === true
          ? "ready_for_adapter_commit"
          : "not_bound");

  return {
    contractVersion: "aios.mailchimp.client-review-envelope-memory.v1",
    envelopeId: normalizeString(source.envelopeId),
    status,
    nextAction: normalizeString(source.nextAction)
      || requiredAcknowledgements[0]?.action
      || (readiness.adapterCommitAllowed === true ? "adapter.commit-mailchimp-batch" : "operator.review"),
    boundaryId: normalizeString(source.boundaryId || input.boundaryId),
    providerJobId: normalizeString(source.providerJobId || providerJob.jobId || input.providerJobId),
    writeSetId: normalizeString(source.writeSetId || writeSet.persistence?.writeSetId),
    receiptId: normalizeString(source.receiptId || writeSet.acceptanceReceipt?.receiptId),
    reviewMode: normalizeString(source.reviewMode) || "operator-preview",
    acceptance: {
      required: acceptance.required !== false,
      mode: normalizeString(acceptance.mode) || "per-row",
      status: normalizeString(acceptance.status) || "not_started",
      acceptedCount: Number.isFinite(acceptance.acceptedCount) ? Math.max(0, Math.floor(acceptance.acceptedCount)) : 0,
      rejectedCount: Number.isFinite(acceptance.rejectedCount) ? Math.max(0, Math.floor(acceptance.rejectedCount)) : 0,
      pendingCount: Number.isFinite(acceptance.pendingCount) ? Math.max(0, Math.floor(acceptance.pendingCount)) : pendingKeys.length,
      validationAccepted: acceptance.validationAccepted === true,
      pendingKeys,
    },
    validationSummary: {
      status: normalizeString(validation.status) || (issueCodes.length ? "blocked" : "not_bound"),
      errorTotal: Number.isFinite(validation.errorTotal) ? Math.max(0, Math.floor(validation.errorTotal)) : 0,
      warningTotal: Number.isFinite(validation.warningTotal) ? Math.max(0, Math.floor(validation.warningTotal)) : 0,
      issueCodes,
    },
    readiness: {
      artifactStatus: normalizeString(readiness.artifactStatus) || "not_bound",
      artifactNextStep: normalizeString(readiness.artifactNextStep),
      clientNextAction: normalizeString(readiness.clientNextAction),
      workflowStatus: normalizeString(readiness.workflowStatus) || "not_bound",
      workflowPrimaryAction: normalizeString(readiness.workflowPrimaryAction) || "operator.review",
      activeStepId: normalizeString(readiness.activeStepId),
      adapterCommitStatus: normalizeString(readiness.adapterCommitStatus) || "not_bound",
      adapterCommitAllowed: readiness.adapterCommitAllowed === true,
      externalReviewStatus: normalizeString(readiness.externalReviewStatus) || "not_bound",
      externalReviewBundleId: normalizeString(readiness.externalReviewBundleId),
    },
    requiredAcknowledgements,
    blockingExplanations,
    restartSafe: source.restartSafe !== false,
  };
}

function clientStateMissingFields(state) {
  return Object.entries({
    requestId: state.requestId,
    workflowId: state.workflowId,
    workflowStep: state.workflowStep
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

function deriveClientWorkflowStatus(record, state) {
  if (record.missing.length > 0 || clientStateMissingFields(state).length > 0) {
    return "needs_input";
  }

  if (state.handoffStatus === "adapter_confirmed" && state.adapterRunId) {
    return "handoff_confirmed";
  }

  if (state.handoffStatus === "handoff_started" || state.resumeToken) {
    return "handoff_pending";
  }

  return "ready_for_handoff";
}

function normalizeSequence(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizePersistedSnapshot(snapshot = {}) {
  const runtime = normalizeRuntimeState(snapshot);
  const status = normalizeString(snapshot.status) || "unknown";
  const sequence = normalizeSequence(snapshot.sequence ?? snapshot.revision);

  return {
    snapshotVersion: normalizeString(snapshot.snapshotVersion) || "aios.mailchimp.memory-snapshot.v1",
    memoryKey: normalizeString(snapshot.memoryKey ?? snapshot.key),
    continuationKey: normalizeString(snapshot.continuationKey),
    sequence,
    status,
    clientRuntime: runtime,
    checksum: normalizeString(snapshot.checksum),
    persistedAt: normalizeString(snapshot.persistedAt) || null,
    recoveredAt: normalizeString(snapshot.recoveredAt) || null
  };
}

function snapshotCommandId(memoryKey, continuationKey, requestId, sequence) {
  return [
    "mailchimp.memory.persist",
    normalizeString(memoryKey) || "memory",
    normalizeString(continuationKey) || "continuation",
    normalizeString(requestId) || "request",
    String(sequence)
  ]
    .join(".")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-");
}

function continuationResumeCommandId(continuationKey, requestId, resumeToken) {
  return [
    "mailchimp.memory.resume",
    normalizeString(continuationKey) || "continuation",
    normalizeString(requestId) || "request",
    normalizeString(resumeToken) || "no-token"
  ]
    .join(".")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-");
}

function normalizeAdapterCommitGateMemory(input = {}) {
  const providerJob = input.providerJob && typeof input.providerJob === "object" ? input.providerJob : {};
  const writeSet = input.artifactWriteSet && typeof input.artifactWriteSet === "object" ? input.artifactWriteSet : {};
  const providerService = input.providerServiceContract && typeof input.providerServiceContract === "object"
    ? input.providerServiceContract
    : {};
  const source = input.adapterCommitGate && typeof input.adapterCommitGate === "object"
    ? input.adapterCommitGate
    : writeSet.adapterCommitGate && typeof writeSet.adapterCommitGate === "object"
      ? writeSet.adapterCommitGate
      : providerJob.adapterHandoff?.adapterCommitGate && typeof providerJob.adapterHandoff.adapterCommitGate === "object"
        ? providerJob.adapterHandoff.adapterCommitGate
        : providerService.adapterCommitGate && typeof providerService.adapterCommitGate === "object"
          ? providerService.adapterCommitGate
          : {};
  const localArtifacts = source.localArtifacts && typeof source.localArtifacts === "object" ? source.localArtifacts : {};
  const capabilityGate = source.capabilityGate && typeof source.capabilityGate === "object"
    ? source.capabilityGate
    : providerService.capabilityNegotiation && typeof providerService.capabilityNegotiation === "object"
      ? providerService.capabilityNegotiation
      : {};
  const blockers = Array.isArray(source.blockers) ? source.blockers : [];
  const blockerCodes = blockers
    .map((blocker) => normalizeString(blocker.code || blocker.field || blocker))
    .filter(Boolean)
    .sort();
  const missingScopes = Array.isArray(capabilityGate.missingScopes)
    ? capabilityGate.missingScopes.map(normalizeString).filter(Boolean).sort()
    : Array.isArray(capabilityGate.missing)
      ? capabilityGate.missing.map(normalizeString).filter(Boolean).sort()
      : [];
  const deniedScopes = Array.isArray(capabilityGate.deniedScopes)
    ? capabilityGate.deniedScopes.map(normalizeString).filter(Boolean).sort()
    : Array.isArray(capabilityGate.denied)
      ? capabilityGate.denied.map(normalizeString).filter(Boolean).sort()
      : [];
  const requiredScopes = Array.isArray(capabilityGate.requiredScopes)
    ? capabilityGate.requiredScopes.map(normalizeString).filter(Boolean).sort()
    : Array.isArray(capabilityGate.required)
      ? capabilityGate.required.map(normalizeString).filter(Boolean).sort()
      : [];
  const grantedScopes = Array.isArray(capabilityGate.grantedScopes)
    ? capabilityGate.grantedScopes.map(normalizeString).filter(Boolean).sort()
    : Array.isArray(capabilityGate.granted)
      ? capabilityGate.granted.map(normalizeString).filter(Boolean).sort()
      : [];
  const commitMode = normalizeString(source.commitMode || providerJob.commitMode) || "dry-run";
  const status = normalizeString(source.status)
    || (blockerCodes.length || missingScopes.length || deniedScopes.length ? "blocked" : "not_bound");
  const canCommit = source.canCommit === true
    || source.allowed === true
    || (status === "ready" && blockerCodes.length === 0 && missingScopes.length === 0 && deniedScopes.length === 0);

  return {
    contractVersion: "aios.mailchimp.adapter-commit-gate-memory.v1",
    status,
    canCommit,
    commitMode,
    boundaryId: normalizeString(source.boundaryId || input.boundaryId),
    providerJobId: normalizeString(source.providerJobId || providerJob.jobId || input.providerJobId),
    writeSetId: normalizeString(source.writeSetId || writeSet.persistence?.writeSetId),
    receiptId: normalizeString(source.receiptId || writeSet.acceptanceReceipt?.receiptId),
    nextAction: normalizeString(source.nextAction) || (canCommit ? "adapter.commit-mailchimp-batch" : "repair-adapter-commit-gate"),
    localArtifacts: {
      recordCount: Number.isFinite(localArtifacts.recordCount)
        ? Math.max(0, Math.floor(localArtifacts.recordCount))
        : Array.isArray(writeSet.records)
          ? writeSet.records.length
          : 0,
      pendingWriteCount: Number.isFinite(localArtifacts.pendingWriteCount)
        ? Math.max(0, Math.floor(localArtifacts.pendingWriteCount))
        : Number.isFinite(writeSet.persistence?.counters?.readyToWrite)
          ? Math.max(0, Math.floor(writeSet.persistence.counters.readyToWrite))
          : 0,
      alreadyWrittenCount: Number.isFinite(localArtifacts.alreadyWrittenCount)
        ? Math.max(0, Math.floor(localArtifacts.alreadyWrittenCount))
        : Number.isFinite(writeSet.persistence?.counters?.alreadyWritten)
          ? Math.max(0, Math.floor(writeSet.persistence.counters.alreadyWritten))
          : 0,
      missingArtifacts: Array.isArray(localArtifacts.missingArtifacts)
        ? localArtifacts.missingArtifacts.map(normalizeString).filter(Boolean).sort()
        : [],
    },
    capabilityGate: {
      status: normalizeString(capabilityGate.status) || (missingScopes.length || deniedScopes.length ? "blocked" : "unknown"),
      canHandoff: capabilityGate.canHandoff === true || capabilityGate.allowed === true,
      requiredScopes,
      grantedScopes,
      missingScopes,
      deniedScopes,
    },
    blockers: blockers.map((blocker) => ({
      code: normalizeString(blocker.code || blocker.field || blocker) || "adapter_commit_gate_blocker",
      field: normalizeString(blocker.field) || null,
      action: normalizeString(blocker.action) || "repair-adapter-commit-gate-before-provider-write",
    })).filter((blocker) => blocker.code),
    blockerCodes,
    restartSafe: source.restartSafe !== false,
  };
}

function normalizeWorkflowActionPacketMemory(input = {}) {
  const providerJob = input.providerJob && typeof input.providerJob === "object" ? input.providerJob : {};
  const writeSet = input.artifactWriteSet && typeof input.artifactWriteSet === "object" ? input.artifactWriteSet : {};
  const providerService = input.providerServiceContract && typeof input.providerServiceContract === "object"
    ? input.providerServiceContract
    : {};
  const source = input.workflowActionPacket && typeof input.workflowActionPacket === "object"
    ? input.workflowActionPacket
    : writeSet.workflowActionPacket && typeof writeSet.workflowActionPacket === "object"
      ? writeSet.workflowActionPacket
      : providerService.workflowActionPacket && typeof providerService.workflowActionPacket === "object"
        ? providerService.workflowActionPacket
        : compileMailchimpWorkflowActionPacket({
            providerJob,
            operatorControlState: input.operatorControlState,
            clientRuntime: normalizeRuntimeState(input),
            artifactWriteSet: writeSet,
            previewAcceptance: writeSet.acceptance ?? input.previewAcceptance,
            readiness: writeSet.readiness,
            persistence: writeSet.persistence,
            adapterCommitGate: writeSet.adapterCommitGate ?? input.adapterCommitGate,
            operatorReport: writeSet.operatorReport ?? input.operatorReport,
            capabilityGate: providerService.capabilityNegotiation ?? input.capabilityNegotiation,
            previewDecision: input.previewDecision,
            boundaryId: input.boundaryId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            requestId: input.requestId,
          });
  const steps = Array.isArray(source.steps) ? source.steps : [];
  const issueSummary = source.issueSummary && typeof source.issueSummary === "object" ? source.issueSummary : {};
  const adapterCommit = source.adapterCommit && typeof source.adapterCommit === "object" ? source.adapterCommit : {};
  const preview = source.preview && typeof source.preview === "object" ? source.preview : {};
  const artifacts = source.artifacts && typeof source.artifacts === "object" ? source.artifacts : {};
  const capabilities = source.capabilities && typeof source.capabilities === "object" ? source.capabilities : {};

  return {
    contractVersion: "aios.mailchimp.workflow-action-memory.v1",
    packetId: normalizeString(source.packetId),
    status: normalizeString(source.status) || "not_bound",
    primaryAction: normalizeString(source.primaryAction) || "operator.review",
    activeStepId: normalizeString(source.activeStepId),
    boundaryId: normalizeString(source.boundaryId || input.boundaryId),
    providerJobId: normalizeString(source.providerJobId || providerJob.jobId || input.providerJobId),
    writeSetId: normalizeString(source.writeSetId || writeSet.persistence?.writeSetId),
    requestId: normalizeString(source.requestId || input.requestId),
    steps: steps.map((step, index) => ({
      order: Number.isFinite(step.order) ? Math.max(1, Math.floor(step.order)) : index + 1,
      id: normalizeString(step.id),
      status: normalizeString(step.status) || "waiting",
      active: step.active === true,
      nextAction: normalizeString(step.nextAction) || "operator.review",
      blockerCodes: Array.isArray(step.blockerCodes)
        ? step.blockerCodes.map(normalizeString).filter(Boolean).sort()
        : [],
    })).filter((step) => step.id),
    preview: {
      status: normalizeString(preview.status) || "not_bound",
      pendingCount: Number.isFinite(preview.pendingCount) ? Math.max(0, Math.floor(preview.pendingCount)) : 0,
      rejectedCount: Number.isFinite(preview.rejectedCount) ? Math.max(0, Math.floor(preview.rejectedCount)) : 0,
      validationAccepted: preview.validationAccepted === true,
      blockerCodes: Array.isArray(preview.blockerCodes)
        ? preview.blockerCodes.map(normalizeString).filter(Boolean).sort()
        : [],
    },
    artifacts: {
      status: normalizeString(artifacts.status) || "not_bound",
      pendingWriteCount: Number.isFinite(artifacts.pendingWriteCount) ? Math.max(0, Math.floor(artifacts.pendingWriteCount)) : 0,
      blockerCodes: Array.isArray(artifacts.blockerCodes)
        ? artifacts.blockerCodes.map(normalizeString).filter(Boolean).sort()
        : [],
    },
    capabilities: {
      status: normalizeString(capabilities.status) || "unknown",
      missingScopes: Array.isArray(capabilities.missingScopes)
        ? capabilities.missingScopes.map(normalizeString).filter(Boolean).sort()
        : [],
      deniedScopes: Array.isArray(capabilities.deniedScopes)
        ? capabilities.deniedScopes.map(normalizeString).filter(Boolean).sort()
        : [],
      pendingScopes: Array.isArray(capabilities.pendingScopes)
        ? capabilities.pendingScopes.map(normalizeString).filter(Boolean).sort()
        : [],
    },
    adapterCommit: {
      status: normalizeString(adapterCommit.status) || "not_bound",
      canCommit: adapterCommit.canCommit === true,
      commitMode: normalizeString(adapterCommit.commitMode) || "dry-run",
      blockerCodes: Array.isArray(adapterCommit.blockerCodes)
        ? adapterCommit.blockerCodes.map(normalizeString).filter(Boolean).sort()
        : [],
      nextAction: normalizeString(adapterCommit.nextAction) || "repair-adapter-commit-gate",
    },
    issueSummary: {
      blockingCodes: Array.isArray(issueSummary.blockingCodes)
        ? issueSummary.blockingCodes.map(normalizeString).filter(Boolean).sort()
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
    restartSafe: source.restartSafe !== false,
  };
}

function normalizeOperationalHealthIssue(entry = {}, fallback = {}) {
  const source = entry && typeof entry === "object" ? entry : {};
  const code = normalizeString(source.code || source.field || entry) || fallback.code || "memory_health_issue";
  const severity = normalizeString(source.severity) || fallback.severity || "error";

  return {
    code,
    severity: ["info", "warning", "error"].includes(severity) ? severity : fallback.severity || "error",
    field: normalizeString(source.field || fallback.field) || null,
    action: normalizeString(source.action || source.nextAction || fallback.action) || "repair-mailchimp-memory-state",
    retryable: source.retryable !== false && fallback.retryable !== false,
  };
}

function normalizeMemoryBackoffPolicy(policy = {}) {
  const baseSeconds = Number.isFinite(policy.baseSeconds) ? Math.max(1, Math.floor(policy.baseSeconds)) : 20;
  const maxSeconds = Number.isFinite(policy.maxSeconds) ? Math.max(baseSeconds, Math.floor(policy.maxSeconds)) : 240;
  const attempt = Number.isFinite(policy.attempt) ? Math.max(0, Math.floor(policy.attempt)) : 0;
  const mode = normalizeString(policy.mode || "deterministic-linear");

  return {
    mode: ["none", "deterministic-linear", "deterministic-exponential"].includes(mode)
      ? mode
      : "deterministic-linear",
    attempt,
    baseSeconds,
    maxSeconds,
  };
}

function memoryBackoffSeconds(policy, issueCount) {
  if (policy.mode === "none" || issueCount === 0) {
    return null;
  }

  const multiplier = policy.mode === "deterministic-exponential"
    ? 2 ** Math.min(policy.attempt, 6)
    : policy.attempt + 1;
  return Math.min(policy.maxSeconds, policy.baseSeconds * multiplier);
}

function deriveMemoryOperationalHealth(record, input = {}) {
  const facts = record.facts ?? {};
  const runtime = facts.clientRuntime ?? {};
  const runtimeBoundary = facts.runtimeBoundary ?? {};
  const previewAcceptance = facts.previewAcceptance ?? {};
  const persistence = facts.providerRuntimePersistence ?? {};
  const analytics = facts.providerAnalyticsExport ?? {};
  const adapterCommitGate = facts.adapterCommitGate ?? {};
  const operatorReport = facts.operatorReport ?? {};
  const clientReviewEnvelope = facts.clientReviewEnvelope ?? {};
  const workflowActionPacket = facts.workflowActionPacket ?? {};
  const boundaryIssues = runtimeBoundaryRecoveryIssues(runtimeBoundary);
  const errors = [
    ...record.missing.map((field) => normalizeOperationalHealthIssue(field, {
      code: "memory_fact_missing",
      field,
      action: "request-or-bind-fact-before-memory-persistence",
    })),
    ...clientStateMissingFields(runtime).map((field) => normalizeOperationalHealthIssue(field, {
      code: "memory_client_state_missing",
      field,
      action: "bind-client-runtime-state-before-memory-persistence",
    })),
    ...boundaryIssues.map((issue) => normalizeOperationalHealthIssue(issue, {
      code: issue.code,
      field: issue.field,
      action: issue.action,
      retryable: !issue.code.includes("tenant_changed") && !issue.code.includes("workspace_changed"),
    })),
    ...adapterCommitGate.blockers.map((blocker) => normalizeOperationalHealthIssue(blocker, {
      code: "memory_adapter_commit_blocked",
      field: blocker.code,
      action: blocker.action,
    })),
    ...clientReviewEnvelope.blockingExplanations.map((entry) => normalizeOperationalHealthIssue(entry, {
      code: "memory_client_review_blocked",
      field: entry.code,
      action: entry.action,
    })),
    ...workflowActionPacket.issueSummary.blockingCodes.map((code) => normalizeOperationalHealthIssue(code, {
      code: "memory_workflow_action_blocked",
      field: code,
      action: workflowActionPacket.primaryAction || "repair-mailchimp-workflow-action",
    })),
  ];
  const warnings = [
    ...(!persistence.checksum && persistence.status !== "not_bound"
      ? [normalizeOperationalHealthIssue("providerRuntimePersistence.checksum", {
          code: "memory_persistence_checksum_missing",
          severity: "warning",
          field: "providerRuntimePersistence.checksum",
          action: "refresh-memory-checksum-before-resume",
        })]
      : []),
    ...(!analytics.exportDigest && analytics.status !== "not_bound"
      ? [normalizeOperationalHealthIssue("providerAnalyticsExport.exportDigest", {
          code: "memory_analytics_export_digest_missing",
          severity: "warning",
          field: "providerAnalyticsExport.exportDigest",
          action: analytics.nextAction || "rebuild-provider-analytics-export",
        })]
      : []),
    ...(previewAcceptance.status === "needs_acceptance" || previewAcceptance.status === "needs_validation_ack"
      ? [normalizeOperationalHealthIssue("previewAcceptance.status", {
          code: "memory_preview_decision_pending",
          severity: "warning",
          field: "previewAcceptance.status",
          action: previewAcceptance.readiness?.nextAction || "collect-preview-acceptance",
        })]
      : []),
    ...operatorReport.blockingSections.map((section) => normalizeOperationalHealthIssue(section, {
      code: "memory_operator_report_section_blocked",
      severity: "warning",
      field: section.name,
      action: section.nextAction,
    })),
  ];
  const policy = normalizeMemoryBackoffPolicy(input.memoryHealthPolicy ?? input.retry ?? {});
  const retryableErrors = errors.filter((issue) => issue.retryable);
  const degradedMode = errors.length === 0 && warnings.length > 0;
  const status = errors.length
    ? "blocked"
    : degradedMode
      ? "degraded"
      : "healthy";
  const nextAction = errors[0]?.action
    ?? warnings[0]?.action
    ?? (runtime.handoffStatus === "handoff_pending" ? "resume-memory-continuation" : "persist-memory-snapshot");

  return {
    contractVersion: "aios.mailchimp.memory-operational-health.v1",
    status,
    degradedMode,
    retryable: retryableErrors.length > 0 || degradedMode,
    nextAction,
    issueCounts: {
      errors: errors.length,
      warnings: warnings.length,
      retryable: retryableErrors.length,
      nonRetryable: errors.filter((issue) => !issue.retryable).length,
    },
    retry: {
      policy,
      backoffSeconds: retryableErrors.length || degradedMode
        ? memoryBackoffSeconds(policy, retryableErrors.length + warnings.length) ?? policy.baseSeconds
        : null,
      retryCommand: retryableErrors.length || degradedMode
        ? snapshotCommandId(record.key, `${record.key}.health`, runtime.requestId, policy.attempt + 1)
        : null,
    },
    errors,
    warnings,
    restartSafe: status !== "blocked"
      || errors.every((issue) => issue.retryable)
      || Boolean(persistence.restartSafe && runtimeBoundary.restartSafe),
  };
}

export function createMailchimpMemoryRecord(input = {}) {
  const providerJob = input.providerJob && typeof input.providerJob === "object" ? input.providerJob : {};
  const campaign = scrub(input.campaign ?? {});
  const audience = normalizeAudience(input.audience);
  const template = scrub(input.template ?? {});
  const clientRuntime = normalizeRuntimeState(input);
  const previewAcceptance = normalizePreviewAcceptanceMemory(input);
  const providerRuntimePersistence = normalizeProviderRuntimePersistenceMemory(input);
  const runtimeBoundary = normalizeRuntimeBoundaryMemory(input);
  const providerAnalyticsExport = normalizeProviderAnalyticsExportMemory(input);
  const adapterCommitGate = normalizeAdapterCommitGateMemory(input);
  const operatorReport = normalizeOperatorReportMemory(input);
  const clientReviewEnvelope = normalizeClientReviewEnvelopeMemory(input);
  const previewDecision = buildPreviewDecisionPrompt(previewAcceptance, clientRuntime);
  const workflowActionPacket = normalizeWorkflowActionPacketMemory({
    ...input,
    providerJob,
    clientRuntime,
    previewAcceptance,
    adapterCommitGate,
    operatorReport,
    clientReviewEnvelope,
    previewDecision,
  });
  const facts = {
    campaignId: String(campaign.id ?? input.campaignId ?? "").trim(),
    campaignName: String(campaign.name ?? input.campaignName ?? "").trim(),
    audience,
    templateId: String(template.id ?? input.templateId ?? "").trim(),
    subjectLine: String(campaign.subjectLine ?? input.subjectLine ?? "").trim(),
    clientRuntime,
    runtimeBoundary,
    previewAcceptance,
    providerRuntimePersistence,
    providerAnalyticsExport,
    adapterCommitGate,
    operatorReport,
    clientReviewEnvelope,
    previewDecision,
    workflowActionPacket
  };

  const missing = Object.entries({
    campaignName: facts.campaignName,
    listId: facts.audience.listId,
    subjectLine: facts.subjectLine
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  const record = {
    memoryVersion: "aios.mailchimp.memory.v1",
    key: `mailchimp.campaign.${stableHash(facts)}`,
    facts,
    missing,
    clientRuntimeStatus: deriveClientWorkflowStatus({ missing }, clientRuntime),
    previewDecisionStatus: previewDecision.status,
    confidence: missing.length === 0 ? "grounded" : "partial",
    truthBoundary: {
      source: "compiler-input",
      externalWrites: false,
      redactedFields: [...SENSITIVE_KEYS].filter((key) => stableString(input).includes(key))
    }
  };

  record.facts.operationalHealth = deriveMemoryOperationalHealth(record, input);
  return record;
}

export function compileMailchimpMemoryContract(input = {}) {
  const record = createMailchimpMemoryRecord(input);
  const clientMissing = clientStateMissingFields(record.facts.clientRuntime);
  const previewAcceptance = record.facts.previewAcceptance;
  const providerRuntimePersistence = record.facts.providerRuntimePersistence;
  const runtimeBoundary = record.facts.runtimeBoundary;
  const providerAnalyticsExport = record.facts.providerAnalyticsExport;
  const adapterCommitGate = record.facts.adapterCommitGate;
  const operatorReport = record.facts.operatorReport;
  const clientReviewEnvelope = record.facts.clientReviewEnvelope;
  const previewDecision = record.facts.previewDecision;
  const workflowActionPacket = record.facts.workflowActionPacket;
  const operationalHealth = record.facts.operationalHealth;
  const previewNeedsDecision = [
    "needs_acceptance",
    "needs_validation_ack",
    "awaiting-operator-acceptance"
  ].includes(previewAcceptance.status);
  const requiredFacts = ["campaignName", "listId", "subjectLine"];
  const checkpoints = [
    {
      name: "before-adapter-handoff",
      memoryKey: record.key,
      requiredFacts,
      requiredClientState: ["requestId", "workflowId", "workflowStep"],
      status: record.missing.length === 0 && clientMissing.length === 0 ? "ready" : "needs_input"
    },
    {
      name: "client-runtime-continuation",
      memoryKey: record.key,
      requiredFacts: [],
      requiredClientState: ["requestId", "workflowId", "workflowStep", "clientVisibleStatus"],
      status: clientMissing.length === 0 ? "ready" : "needs_input"
    },
    {
      name: "preview-acceptance-handoff",
      memoryKey: record.key,
      requiredFacts: [],
      requiredClientState: ["requestId", "workflowId", "workflowStep"],
      status: previewAcceptance.readiness.blockingIssueCodes.length
        ? "blocked"
        : previewNeedsDecision
          ? "needs_acceptance"
          : "ready",
      providerJobId: previewAcceptance.providerJobId,
      receiptId: previewAcceptance.receiptId
    },
    {
      name: "adapter-commit-gate",
      memoryKey: record.key,
      requiredFacts: [],
      requiredClientState: ["requestId", "workflowId", "workflowStep"],
      status: adapterCommitGate.canCommit
        ? "ready"
        : adapterCommitGate.status === "not_bound"
          ? "not_bound"
          : "blocked",
      providerJobId: adapterCommitGate.providerJobId,
      writeSetId: adapterCommitGate.writeSetId,
      blockerCodes: adapterCommitGate.blockerCodes
    }
  ];

  return {
    contractVersion: "aios.mailchimp.memory-contract.v1",
    records: [record],
    checkpoints,
    clientRuntime: {
      ...record.facts.clientRuntime,
      continuationKey: `${record.key}.client-runtime`,
      status: record.clientRuntimeStatus,
      requiredClientState: clientMissing,
      nextUserVisibleAction:
        record.missing.length > 0
          ? "ask-user-for-campaign-fields"
          : clientMissing.length > 0
            ? "bind-client-request-state"
            : "show-review-and-schedule-handoff"
    },
    previewAcceptance,
    previewDecision,
    clientReviewEnvelope,
    workflowActionPacket,
    providerServiceContract: {
      contractVersion: "aios.mailchimp.provider-service-memory.v1",
      provider: "mailchimp",
      providerJobId: previewAcceptance.providerJobId,
      audienceId: previewAcceptance.audienceId || record.facts.audience.listId,
      capabilityNegotiation: {
        preview: previewAcceptance.readiness.previewEnabled ? "granted" : "blocked",
        commit: previewAcceptance.readiness.commitEnabled ? "granted" : "gated",
        externalWriteMode: previewAcceptance.externalHandoff.commitMode,
      },
      syncMetadata: {
        previewStatus: previewAcceptance.status,
        previewDecisionStatus: previewDecision.status,
        receiptId: previewAcceptance.receiptId || null,
        settingsRevision: previewAcceptance.externalHandoff.settingsRevision || null,
        pendingAcceptanceCount: previewAcceptance.acceptance.pendingCount,
        rejectedAcceptanceCount: previewAcceptance.acceptance.rejectedCount,
      },
      externalHandoff: previewAcceptance.externalHandoff,
      clientRuntimeHandoff: previewAcceptance.clientRuntimeHandoff,
      runtimePersistence: providerRuntimePersistence,
      runtimeBoundary,
      analyticsExport: providerAnalyticsExport,
      adapterCommitGate,
      operatorReport,
      clientReviewEnvelope,
      workflowActionPacket,
      operationalHealth,
    },
    recovery: [
      ...operationalHealth.errors.map((issue) => ({
        code: issue.code,
        field: issue.field,
        action: issue.action,
        retryable: issue.retryable,
      })),
      ...record.missing.map((field) => ({
        code: "missing_mailchimp_fact",
        field,
        action: "request-or-bind-fact-before-scheduling"
      })),
      ...clientMissing.map((field) => ({
        code: "missing_client_runtime_state",
        field,
        action: "persist-request-workflow-state-before-adapter-handoff"
      })),
      ...(previewAcceptance.readiness.blockingIssueCodes.length
        ? previewAcceptance.readiness.blockingIssueCodes.map((code) => ({
            code: "preview_acceptance_blocked",
            field: code,
            action: "resolve-preview-validation-before-provider-handoff"
          }))
        : []),
      ...(previewNeedsDecision
        ? [
            {
              code: "preview_acceptance_required",
              field: "previewAcceptance.acceptance.pendingKeys",
              action: "collect-preview-acceptance-before-adapter-commit"
            }
          ]
        : []),
      ...(previewDecision.missingClientState.length
        ? previewDecision.missingClientState.map((field) => ({
            code: "preview_decision_missing_client_state",
            field,
            action: "bind-client-runtime-state-before-user-visible-preview"
          }))
        : []),
      ...(providerRuntimePersistence.recovery || []).map((entry) => ({
        code: "provider_runtime_persistence_recovery",
        field: entry.code || entry.field,
        action: entry.action || "repair-provider-runtime-persistence-before-resume"
      })),
      ...(providerAnalyticsExport.blockedReasons || []).map((reason) => ({
        code: "provider_analytics_export_blocked",
        field: reason,
        action: providerAnalyticsExport.nextAction || "repair-provider-analytics-export"
      })),
      ...(!providerAnalyticsExport.exportDigest && providerAnalyticsExport.status !== "not_bound"
        ? [
            {
              code: "provider_analytics_export_missing_digest",
              field: "providerAnalyticsExport.exportDigest",
              action: "rebuild-provider-analytics-export-before-memory-snapshot"
            }
          ]
        : []),
      ...adapterCommitGate.blockers.map((blocker) => ({
        code: "adapter_commit_gate_blocked",
        field: blocker.code,
        action: blocker.action
      })),
      ...operatorReport.blockingSections.map((section) => ({
        code: "operator_report_section_blocked",
        field: section.name,
        action: section.nextAction
      })),
      ...clientReviewEnvelope.blockingExplanations.map((entry) => ({
        code: "client_review_blocked",
        field: entry.code,
        action: entry.action
      })),
      ...clientReviewEnvelope.requiredAcknowledgements.map((entry) => ({
        code: "client_review_acknowledgement_required",
        field: entry.id,
        action: entry.action
      })),
      ...workflowActionPacket.issueSummary.blockingCodes.map((code) => ({
        code: "workflow_action_blocked",
        field: code,
        action: workflowActionPacket.primaryAction || "repair-mailchimp-workflow-action"
      })),
      ...(!operatorReport.reportId && operatorReport.status !== "not_bound"
        ? [
            {
              code: "operator_report_missing_id",
              field: "operatorReport.reportId",
              action: "rebuild-operator-report-before-memory-snapshot"
            }
          ]
        : []),
      ...(adapterCommitGate.localArtifacts.pendingWriteCount > 0
        ? [
            {
              code: "adapter_commit_gate_local_artifacts_pending",
              field: "adapterCommitGate.localArtifacts.pendingWriteCount",
              action: "persist-local-artifacts-before-adapter-commit"
            }
          ]
        : []),
      ...runtimeBoundaryRecoveryIssues(runtimeBoundary).map((entry) => ({
        code: entry.code,
        field: entry.field,
        action: entry.action
      }))
    ],
    rollback: {
      supported: true,
      memoryKey: record.key,
      continuationKey: `${record.key}.client-runtime`,
      strategy: "discard-uncommitted-campaign-memory-and-restore-client-workflow"
    }
  };
}

export function mergeMailchimpMemoryRecords(records = []) {
  const facts = {};
  const missing = new Set();

  for (const record of records) {
    Object.assign(facts, scrub(record.facts ?? {}));
    for (const field of record.missing ?? []) {
      missing.add(field);
    }
  }

  const clientRuntime = normalizeRuntimeState(facts);
  const clientMissing = clientStateMissingFields(clientRuntime);
  for (const field of clientMissing) {
    missing.add(`clientRuntime.${field}`);
  }

  return {
    memoryVersion: "aios.mailchimp.memory.v1",
    key: `mailchimp.campaign.${stableHash(facts)}`,
    facts: {
      ...facts,
      clientRuntime
    },
    missing: [...missing].filter((field) => !facts[field]),
    confidence: missing.size === 0 ? "grounded" : "partial",
    truthBoundary: {
      source: "merged-local-records",
      externalWrites: false
    }
  };
}

export function compileMailchimpClientRuntimeMemory(input = {}) {
  const contract = compileMailchimpMemoryContract(input);
  const record = contract.records[0];
  const runtime = contract.clientRuntime;

  return {
    contractVersion: "aios.mailchimp.client-runtime-memory.v1",
    memoryKey: record.key,
    continuationKey: runtime.continuationKey,
    status: runtime.status,
    requestState: {
      requestId: runtime.requestId,
      conversationId: runtime.conversationId,
      userMessageId: runtime.userMessageId,
      workflowId: runtime.workflowId,
      workflowStep: runtime.workflowStep,
      clientVisibleStatus: runtime.clientVisibleStatus
    },
    handoffState: {
      status: runtime.handoffStatus,
      adapterRunId: runtime.adapterRunId,
      resumeToken: runtime.resumeToken
    },
    previewAcceptance: contract.previewAcceptance,
    previewDecision: contract.previewDecision,
    workflowActionPacket: contract.workflowActionPacket,
    clientReviewEnvelope: contract.providerServiceContract.clientReviewEnvelope,
    providerServiceContract: contract.providerServiceContract,
    providerRuntimePersistence: contract.providerServiceContract.runtimePersistence,
    providerAnalyticsExport: contract.providerServiceContract.analyticsExport,
    adapterCommitGate: contract.providerServiceContract.adapterCommitGate,
    operationalHealth: contract.providerServiceContract.operationalHealth,
    userVisibleWorkflow: {
      nextAction: contract.previewDecision.primaryAction || runtime.nextUserVisibleAction,
      workflowPrimaryAction: contract.workflowActionPacket.primaryAction,
      workflowActionStatus: contract.workflowActionPacket.status,
      workflowActiveStepId: contract.workflowActionPacket.activeStepId,
      workflowBlockingCodes: contract.workflowActionPacket.issueSummary.blockingCodes,
      clientReviewEnvelopeId: contract.providerServiceContract.clientReviewEnvelope.envelopeId,
      clientReviewStatus: contract.providerServiceContract.clientReviewEnvelope.status,
      clientReviewNextAction: contract.providerServiceContract.clientReviewEnvelope.nextAction,
      clientReviewRequiredAcknowledgements: contract.providerServiceContract.clientReviewEnvelope.requiredAcknowledgements.map((entry) => entry.id),
      clientReviewBlockingCodes: contract.providerServiceContract.clientReviewEnvelope.blockingExplanations.map((entry) => entry.code),
      missingCampaignFacts: [...record.missing],
      missingClientState: [...runtime.requiredClientState],
      previewAcceptanceStatus: contract.previewAcceptance.status,
      previewDecisionStatus: contract.previewDecision.status,
      previewNextAction: contract.previewDecision.primaryAction,
      pendingPreviewRows: contract.previewDecision.decisionSummary.pendingRows,
      blockedIssueCodes: contract.previewDecision.readinessSummary.blockingIssueCodes,
      providerRuntimeStatus: contract.providerServiceContract.runtimePersistence.status,
      providerResumeStatus: contract.providerServiceContract.runtimePersistence.commands.resume.status,
      analyticsExportStatus: contract.providerServiceContract.analyticsExport.status,
      analyticsExportDigest: contract.providerServiceContract.analyticsExport.exportDigest,
      analyticsExportNextAction: contract.providerServiceContract.analyticsExport.nextAction,
      operatorReportStatus: contract.providerServiceContract.operatorReport.status,
      operatorReportId: contract.providerServiceContract.operatorReport.reportId,
      operatorReportNextAction: contract.providerServiceContract.operatorReport.nextAction,
      operatorReportBlockingSections: contract.providerServiceContract.operatorReport.blockingSections.map((section) => section.name),
      adapterCommitStatus: contract.providerServiceContract.adapterCommitGate.status,
      adapterCommitAllowed: contract.providerServiceContract.adapterCommitGate.canCommit,
      adapterCommitNextAction: contract.providerServiceContract.adapterCommitGate.nextAction,
      adapterCommitBlockers: contract.providerServiceContract.adapterCommitGate.blockerCodes,
      runtimeBoundaryStatus: contract.providerServiceContract.runtimeBoundary.restartSafe
        ? "restart_safe"
        : "needs_boundary",
      runtimeBoundaryNextAction: contract.providerServiceContract.runtimeBoundary.nextAction,
      memoryHealthStatus: contract.providerServiceContract.operationalHealth.status,
      memoryHealthNextAction: contract.providerServiceContract.operationalHealth.nextAction,
      memoryHealthBackoffSeconds: contract.providerServiceContract.operationalHealth.retry.backoffSeconds,
    },
    recovery: contract.recovery,
    rollback: contract.rollback,
    truthBoundary: {
      source: "deterministic-client-runtime-memory",
      externalWrites: false,
      redactedFields: record.truthBoundary.redactedFields
    }
  };
}

export function shapeMailchimpPersistedMemorySnapshot(input = {}, persistedSnapshot = {}) {
  const contract = compileMailchimpMemoryContract(input);
  const record = contract.records[0];
  const runtime = contract.clientRuntime;
  const previous = normalizePersistedSnapshot(persistedSnapshot);
  const facts = scrub(record.facts);
  const sequence = previous.memoryKey === record.key ? previous.sequence + 1 : 1;
  const snapshotBody = {
    memoryVersion: record.memoryVersion,
    memoryKey: record.key,
    continuationKey: runtime.continuationKey,
    facts,
    missing: [...record.missing],
    clientRuntime: {
      requestId: runtime.requestId,
      conversationId: runtime.conversationId,
      userMessageId: runtime.userMessageId,
      workflowId: runtime.workflowId,
      workflowStep: runtime.workflowStep,
      clientVisibleStatus: runtime.clientVisibleStatus,
      handoffStatus: runtime.handoffStatus,
      adapterRunId: runtime.adapterRunId,
      resumeToken: runtime.resumeToken
    },
    previewAcceptance: contract.previewAcceptance,
    providerServiceContract: contract.providerServiceContract,
    runtimeBoundary: contract.providerServiceContract.runtimeBoundary,
    providerAnalyticsExport: contract.providerServiceContract.analyticsExport,
    adapterCommitGate: contract.providerServiceContract.adapterCommitGate,
    status: runtime.status,
    sequence
  };
  const checksum = stableHash(snapshotBody);
  const commandId = snapshotCommandId(record.key, runtime.continuationKey, runtime.requestId, sequence);

  return {
    snapshotVersion: "aios.mailchimp.memory-snapshot.v1",
    memoryKey: record.key,
    continuationKey: runtime.continuationKey,
    sequence,
    checksum,
    status: runtime.status,
    previousChecksum: previous.checksum || null,
    clientRuntime: snapshotBody.clientRuntime,
    previewAcceptance: snapshotBody.previewAcceptance,
    providerServiceContract: snapshotBody.providerServiceContract,
    providerRuntimePersistence: snapshotBody.providerServiceContract.runtimePersistence,
    providerAnalyticsExport: snapshotBody.providerAnalyticsExport,
    adapterCommitGate: snapshotBody.adapterCommitGate,
    operationalHealth: snapshotBody.providerServiceContract.operationalHealth,
    operatorReport: snapshotBody.providerServiceContract.operatorReport,
    workflowActionPacket: snapshotBody.providerServiceContract.workflowActionPacket,
    clientReviewEnvelope: snapshotBody.providerServiceContract.clientReviewEnvelope,
    runtimeBoundary: snapshotBody.runtimeBoundary,
    facts,
    missing: [...record.missing],
    persistCommand: {
      commandVersion: "aios.mailchimp.memory-command.v1",
      id: commandId,
      type: "persist-memory-snapshot",
      idempotencyKey: commandId,
      memoryKey: record.key,
      continuationKey: runtime.continuationKey,
      checksum,
      expectedPreviousChecksum: previous.checksum || null,
      sequence,
      externalWrites: false,
      status: runtime.status === "needs_input" ? "pending_required_state" : "ready_to_persist"
    },
    restartSafeStatus: {
      status: runtime.status,
      mayResume:
        runtime.status === "handoff_pending" ||
        runtime.status === "handoff_confirmed" ||
        runtime.status === "ready_for_handoff",
      missingCampaignFacts: [...record.missing],
      missingClientState: [...runtime.requiredClientState],
      resumeCommandId: continuationResumeCommandId(
        runtime.continuationKey,
        runtime.requestId,
        runtime.resumeToken
      ),
      operationalHealthStatus: snapshotBody.providerServiceContract.operationalHealth.status,
      operationalHealthRetryable: snapshotBody.providerServiceContract.operationalHealth.retryable,
      operationalHealthNextAction: snapshotBody.providerServiceContract.operationalHealth.nextAction
    },
    recovery: [
      ...contract.recovery,
      ...(previous.memoryKey && previous.memoryKey !== record.key
        ? [
            {
              code: "persisted_memory_key_changed",
              action: "write-new-snapshot-with-fresh-continuation-key",
              previousMemoryKey: previous.memoryKey,
              nextMemoryKey: record.key
            }
          ]
        : []),
      ...(previous.checksum && previous.checksum === checksum
        ? [
            {
              code: "memory_snapshot_already_persisted",
              action: "treat-persist-command-as-idempotent-success",
              checksum
            }
          ]
        : []),
      ...snapshotBody.adapterCommitGate.blockers.map((blocker) => ({
        code: "adapter_commit_gate_blocked",
        field: blocker.code,
        action: blocker.action
      })),
      ...snapshotBody.providerServiceContract.workflowActionPacket.issueSummary.blockingCodes.map((code) => ({
        code: "workflow_action_blocked",
        field: code,
        action: snapshotBody.providerServiceContract.workflowActionPacket.primaryAction || "repair-mailchimp-workflow-action"
      })),
      ...snapshotBody.providerServiceContract.clientReviewEnvelope.blockingExplanations.map((entry) => ({
        code: "client_review_blocked",
        field: entry.code,
        action: entry.action
      })),
      ...runtimeBoundaryRecoveryIssues(snapshotBody.runtimeBoundary)
      ,
      ...snapshotBody.providerServiceContract.operationalHealth.warnings.map((issue) => ({
        code: issue.code,
        field: issue.field,
        action: issue.action,
        retryable: issue.retryable
      }))
    ],
    rollback: {
      ...contract.rollback,
      snapshotSequence: sequence,
      idempotencyKey: commandId,
      strategy: "restore-previous-checksum-or-drop-uncommitted-snapshot"
    },
    truthBoundary: {
      source: "deterministic-memory-snapshot-shaper",
      externalWrites: false,
      redactedFields: record.truthBoundary.redactedFields
    }
  };
}

export function recoverMailchimpMemoryContinuation(snapshot = {}, runtimeObservation = {}) {
  const persisted = normalizePersistedSnapshot(snapshot);
  const persistedPreviewAcceptance = snapshot.previewAcceptance && typeof snapshot.previewAcceptance === "object"
    ? snapshot.previewAcceptance
    : {};
  const persistedProviderService = snapshot.providerServiceContract && typeof snapshot.providerServiceContract === "object"
    ? snapshot.providerServiceContract
    : {};
  const persistedAnalyticsExport = snapshot.providerAnalyticsExport && typeof snapshot.providerAnalyticsExport === "object"
    ? snapshot.providerAnalyticsExport
    : persistedProviderService.analyticsExport && typeof persistedProviderService.analyticsExport === "object"
      ? persistedProviderService.analyticsExport
      : normalizeProviderAnalyticsExportMemory({});
  const persistedAdapterCommitGate = snapshot.adapterCommitGate && typeof snapshot.adapterCommitGate === "object"
    ? normalizeAdapterCommitGateMemory({ adapterCommitGate: snapshot.adapterCommitGate })
    : persistedProviderService.adapterCommitGate && typeof persistedProviderService.adapterCommitGate === "object"
      ? normalizeAdapterCommitGateMemory({ adapterCommitGate: persistedProviderService.adapterCommitGate })
      : normalizeAdapterCommitGateMemory({});
  const persistedOperatorReport = snapshot.operatorReport && typeof snapshot.operatorReport === "object"
    ? normalizeOperatorReportMemory({ operatorReport: snapshot.operatorReport })
    : persistedProviderService.operatorReport && typeof persistedProviderService.operatorReport === "object"
      ? normalizeOperatorReportMemory({ operatorReport: persistedProviderService.operatorReport })
      : normalizeOperatorReportMemory({});
  const persistedWorkflowActionPacket = snapshot.workflowActionPacket && typeof snapshot.workflowActionPacket === "object"
    ? normalizeWorkflowActionPacketMemory({ workflowActionPacket: snapshot.workflowActionPacket })
    : persistedProviderService.workflowActionPacket && typeof persistedProviderService.workflowActionPacket === "object"
      ? normalizeWorkflowActionPacketMemory({ workflowActionPacket: persistedProviderService.workflowActionPacket })
      : normalizeWorkflowActionPacketMemory({
          providerServiceContract: persistedProviderService,
          previewAcceptance: persistedPreviewAcceptance,
          providerAnalyticsExport: persistedAnalyticsExport,
          adapterCommitGate: persistedAdapterCommitGate,
          operatorReport: persistedOperatorReport,
        });
  const persistedClientReviewEnvelope = snapshot.clientReviewEnvelope && typeof snapshot.clientReviewEnvelope === "object"
    ? normalizeClientReviewEnvelopeMemory({ clientReviewEnvelope: snapshot.clientReviewEnvelope })
    : persistedProviderService.clientReviewEnvelope && typeof persistedProviderService.clientReviewEnvelope === "object"
      ? normalizeClientReviewEnvelopeMemory({ clientReviewEnvelope: persistedProviderService.clientReviewEnvelope })
      : normalizeClientReviewEnvelopeMemory({
          providerServiceContract: persistedProviderService,
          artifactWriteSet: {
            adapterCommitGate: persistedAdapterCommitGate,
            workflowActionPacket: persistedWorkflowActionPacket,
          },
        });
  const persistedBoundary = snapshot.runtimeBoundary && typeof snapshot.runtimeBoundary === "object"
    ? normalizeRuntimeBoundaryMemory({ runtimeBoundary: snapshot.runtimeBoundary })
    : persistedProviderService.runtimeBoundary && typeof persistedProviderService.runtimeBoundary === "object"
      ? normalizeRuntimeBoundaryMemory({ runtimeBoundary: persistedProviderService.runtimeBoundary })
      : normalizeRuntimeBoundaryMemory({});
  const observedBoundary = normalizeRuntimeBoundaryMemory(runtimeObservation);
  const observed = normalizeRuntimeState(runtimeObservation);
  const persistedOperationalHealth = snapshot.operationalHealth && typeof snapshot.operationalHealth === "object"
    ? snapshot.operationalHealth
    : persistedProviderService.operationalHealth && typeof persistedProviderService.operationalHealth === "object"
      ? persistedProviderService.operationalHealth
      : { status: "not_bound", errors: [], warnings: [], retry: { backoffSeconds: null }, nextAction: "persist-memory-snapshot" };
  const continuationKey =
    persisted.continuationKey ||
    normalizeString(runtimeObservation.continuationKey) ||
    `${persisted.memoryKey}.client-runtime`;
  const requestId = observed.requestId || persisted.clientRuntime.requestId;
  const resumeToken = observed.resumeToken || persisted.clientRuntime.resumeToken;
  const handoffStatus = observed.handoffStatus || persisted.clientRuntime.handoffStatus;
  const adapterRunId = observed.adapterRunId || persisted.clientRuntime.adapterRunId;
  const mergedRuntime = {
    ...persisted.clientRuntime,
    ...observed,
    requestId,
    conversationId: observed.conversationId || persisted.clientRuntime.conversationId,
    userMessageId: observed.userMessageId || persisted.clientRuntime.userMessageId,
    workflowId: observed.workflowId || persisted.clientRuntime.workflowId,
    workflowStep: observed.workflowStep || persisted.clientRuntime.workflowStep,
    handoffStatus,
    adapterRunId,
    resumeToken
  };
  const missing = clientStateMissingFields(mergedRuntime);
  const boundaryIssues = runtimeBoundaryRecoveryIssues(persistedBoundary, observedBoundary);
  const reviewIssues = [
    ...persistedClientReviewEnvelope.blockingExplanations.map((entry) => ({
      code: "client_review_blocked",
      field: entry.code,
      action: entry.action,
    })),
    ...persistedClientReviewEnvelope.requiredAcknowledgements.map((entry) => ({
      code: "client_review_acknowledgement_required",
      field: entry.id,
      action: entry.action,
    })),
  ];
  const canResume = missing.length === 0
    && boundaryIssues.length === 0
    && reviewIssues.length === 0
    && (resumeToken || adapterRunId || handoffStatus === "handoff_started");
  const status =
    missing.length > 0
      ? "needs_client_state"
      : boundaryIssues.length > 0
        ? "runtime_boundary_blocked"
        : reviewIssues.length > 0
        ? "client_review_blocked"
        : adapterRunId && handoffStatus === "adapter_confirmed"
        ? "already_confirmed"
        : canResume
          ? "resume_ready"
          : "awaiting_handoff";
  const commandId = continuationResumeCommandId(continuationKey, requestId, resumeToken);

  return {
    recoveryVersion: "aios.mailchimp.memory-recovery.v1",
    memoryKey: persisted.memoryKey,
    continuationKey,
    status,
    restartSafe: true,
    sequence: persisted.sequence,
    checksum: persisted.checksum,
    clientRuntime: mergedRuntime,
    previewAcceptance: persistedPreviewAcceptance,
    providerServiceContract: persistedProviderService,
    providerAnalyticsExport: persistedAnalyticsExport,
    adapterCommitGate: persistedAdapterCommitGate,
    operatorReport: persistedOperatorReport,
    workflowActionPacket: persistedWorkflowActionPacket,
    clientReviewEnvelope: persistedClientReviewEnvelope,
    runtimeBoundary: {
      persisted: persistedBoundary,
      observed: observedBoundary,
      issues: boundaryIssues,
      auditHandoff: {
        ...persistedBoundary.auditHandoff,
        eventType: "mailchimp.memory.runtime_boundary.recovery_checked",
        allowed: boundaryIssues.length === 0,
      },
    },
    operationalHealth: {
      status: normalizeString(persistedOperationalHealth.status) || "not_bound",
      nextAction: normalizeString(persistedOperationalHealth.nextAction) || "persist-memory-snapshot",
      retryable: persistedOperationalHealth.retryable === true,
      backoffSeconds: Number.isFinite(persistedOperationalHealth.retry?.backoffSeconds)
        ? Math.max(0, Math.floor(persistedOperationalHealth.retry.backoffSeconds))
        : null,
      issueCounts: persistedOperationalHealth.issueCounts ?? {
        errors: Array.isArray(persistedOperationalHealth.errors) ? persistedOperationalHealth.errors.length : 0,
        warnings: Array.isArray(persistedOperationalHealth.warnings) ? persistedOperationalHealth.warnings.length : 0,
      },
    },
    resumeCommand: {
      commandVersion: "aios.mailchimp.memory-command.v1",
      id: commandId,
      type: "resume-memory-continuation",
      idempotencyKey: commandId,
      memoryKey: persisted.memoryKey,
      continuationKey,
      resumeToken,
      adapterRunId,
      status: canResume ? "ready_to_resume" : "blocked",
      externalWrites: false
    },
    recovery: [
      ...missing.map((field) => ({
        code: "missing_recovery_client_state",
        field,
        action: "bind-client-runtime-state-before-resume"
      })),
      ...(!resumeToken && !adapterRunId
        ? [
            {
              code: "missing_resume_handle",
              action: "restart-from-review-step-before-adapter-handoff"
            }
          ]
        : []),
      ...(persistedAnalyticsExport.blockedReasons || []).map((reason) => ({
        code: "provider_analytics_export_blocked",
        field: reason,
        action: persistedAnalyticsExport.nextAction || "repair-provider-analytics-export-before-resume"
      })),
      ...(!persistedAnalyticsExport.exportDigest && persistedAnalyticsExport.status !== "not_bound"
        ? [
            {
              code: "provider_analytics_export_missing_digest",
              action: "rebuild-provider-analytics-export-before-resume"
            }
          ]
        : []),
      ...persistedAdapterCommitGate.blockers.map((blocker) => ({
        code: "adapter_commit_gate_blocked",
        field: blocker.code,
        action: blocker.action
      })),
      ...(persistedAdapterCommitGate.status !== "not_bound" && persistedAdapterCommitGate.canCommit !== true
        ? [
            {
              code: "adapter_commit_gate_not_ready",
              action: persistedAdapterCommitGate.nextAction || "repair-adapter-commit-gate-before-resume"
            }
          ]
        : []),
      ...persistedOperatorReport.blockingSections.map((section) => ({
        code: "operator_report_section_blocked",
        field: section.name,
        action: section.nextAction
      })),
      ...persistedWorkflowActionPacket.issueSummary.blockingCodes.map((code) => ({
        code: "workflow_action_blocked",
        field: code,
        action: persistedWorkflowActionPacket.primaryAction || "repair-mailchimp-workflow-action-before-resume"
      })),
      ...reviewIssues,
      ...(!persistedOperatorReport.reportId && persistedOperatorReport.status !== "not_bound"
        ? [
            {
              code: "operator_report_missing_id",
              action: "rebuild-operator-report-before-resume"
            }
          ]
        : []),
      ...boundaryIssues
    ],
    truthBoundary: {
      source: "persisted-local-memory-snapshot",
      externalWrites: false
    }
  };
}
