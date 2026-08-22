const STATUS_ORDER = Object.freeze([
  "queued",
  "running",
  "verifying",
  "completed",
  "rolled_back",
  "failed",
]);

const TRUSTED_EVIDENCE_KINDS = Object.freeze([
  "mailchimp-read-receipt",
  "runtime-local-receipt",
  "operator-attestation",
]);

export function createTruthBoundaryReport(jobDescriptor, observations = {}) {
  assertJobDescriptor(jobDescriptor);

  const timeline = normalizeTimeline(observations.timeline ?? []);
  const evidence = normalizeEvidence(observations.evidence ?? []);
  const externalWrites = normalizeExternalWrites(observations.externalWrites ?? []);
  const tenantBoundary = normalizeTenantBoundary(jobDescriptor, observations.tenantBoundary ?? {});
  const missingEvidence = findMissingEvidence(jobDescriptor, evidence);
  const status = deriveStatus({
    timeline,
    missingEvidence,
    externalWrites,
    boundaryViolations: tenantBoundary.violations,
    requestedStatus: observations.status,
  });
  const health = buildAuditHealthState(jobDescriptor, {
    status,
    timeline,
    missingEvidence,
    externalWrites,
    boundaryViolations: tenantBoundary.violations,
    adapterHealth: observations.adapterHealth ?? observations.health ?? {},
  });

  return deepFreeze({
    kind: "aios.audit.truth-boundary",
    apiVersion: "aios.audit/v1",
    jobId: jobDescriptor.id,
    package: jobDescriptor.package,
    status,
    boundary: {
      externalWritesAllowed: false,
      externalWritesObserved: externalWrites,
      externalReadsDeclared: jobDescriptor.verifier.truthBoundary.externalReads,
      memoryWritePolicy: jobDescriptor.memory.writePolicy,
      tenantBoundary,
    },
    evidence: {
      accepted: evidence,
      missing: missingEvidence,
      rejected: rejectUntrustedEvidence(observations.evidence ?? []),
    },
    health,
    recovery: buildRecoveryReport(jobDescriptor, status, timeline, health),
    timeline,
    summary: summarize(status, missingEvidence, externalWrites, tenantBoundary.violations),
  });
}

export function createStatusEvent(status, details = {}) {
  if (!STATUS_ORDER.includes(status)) {
    throw new Error(`unsupported status: ${status}`);
  }

  return deepFreeze({
    status,
    at: normalizeClock(details.at ?? "logical:0"),
    message: String(details.message ?? status),
    actor: String(details.actor ?? "aios-runtime"),
  });
}

export function createEvidence(kind, subject, details = {}) {
  if (!TRUSTED_EVIDENCE_KINDS.includes(kind)) {
    throw new Error(`unsupported evidence kind: ${kind}`);
  }
  if (!subject || typeof subject !== "string") {
    throw new Error("evidence subject must be a string");
  }

  return deepFreeze({
    kind,
    subject,
    receipt: stableReceipt([kind, subject, JSON.stringify(details)]),
    details: normalizeEvidenceDetails(details),
  });
}

export function assertNoExternalWrites(report) {
  if (!report || report.kind !== "aios.audit.truth-boundary") {
    throw new Error("report must be produced by createTruthBoundaryReport");
  }
  if (report.boundary.externalWritesObserved.length > 0) {
    throw new Error("truth boundary violation: external writes observed");
  }
  return true;
}

export function mergeAuditReports(reports) {
  if (!Array.isArray(reports) || reports.length === 0) {
    throw new Error("reports must be a non-empty array");
  }

  const normalized = reports.map((report) => {
    if (!report || report.kind !== "aios.audit.truth-boundary") {
      throw new Error("every report must be produced by createTruthBoundaryReport");
    }
    return report;
  });

  const status = normalized.some((report) => report.status === "failed")
    ? "failed"
    : normalized.some((report) => report.status === "rolled_back")
      ? "rolled_back"
      : normalized.every((report) => report.status === "completed")
        ? "completed"
        : "verifying";

  return deepFreeze({
    kind: "aios.audit.bundle",
    apiVersion: "aios.audit/v1",
    status,
    jobIds: normalized.map((report) => report.jobId).sort(),
    violations: normalized.flatMap((report) => report.boundary.externalWritesObserved),
    boundaryViolations: normalized.flatMap((report) => report.boundary.tenantBoundary?.violations ?? []),
    missingEvidence: normalized.flatMap((report) => report.evidence.missing),
    summaries: normalized.map((report) => report.summary),
  });
}

export function createAuditHealthReport(report, options = {}) {
  const normalized = normalizeReportForExport(report);
  const retryPolicy = normalizeRetryPolicy(options.retry ?? report?.recovery?.policy?.retry ?? {});
  const adapterHealth = normalizeAdapterHealth(options.adapterHealth ?? report?.health?.adapter ?? {});
  const timeline = normalized.timeline.length > 0
    ? normalized.timeline
    : [{ status: normalized.status, at: "current", actor: "audit-health", message: normalized.status }];
  const health = buildAuditHealthState({
    recovery: {
      rollback: normalized.recovery.at(0)?.policy?.rollback ?? "status-only",
      retry: retryPolicy,
    },
  }, {
    status: normalized.status,
    timeline,
    missingEvidence: normalized.missingEvidence,
    externalWrites: normalized.violations,
    boundaryViolations: normalized.boundaryViolations,
    adapterHealth,
  });

  return deepFreeze({
    kind: "aios.audit.health-report",
    apiVersion: "aios.audit/v1",
    jobIds: normalized.jobIds,
    status: normalized.status,
    health,
    exportable: {
      ready: health.readyForExport,
      blockedReasons: health.actionableErrors.map((error) => error.message),
      nextAction: health.nextAction,
    },
  });
}

export function createAuditExportSnapshot(report, options = {}) {
  const normalized = normalizeReportForExport(report);
  const history = buildHistorySnapshots(normalized, options.history ?? []);
  const counters = buildAuditCounters(normalized, history);
  const blockers = deriveExportBlockers(normalized, counters);
  const exportId = stableReceipt([
    normalized.kind,
    normalized.jobId ?? normalized.jobIds.join(","),
    normalized.status,
    JSON.stringify(counters),
  ]);

  return deepFreeze({
    kind: "aios.audit.export-snapshot",
    apiVersion: "aios.audit/v1",
    exportId,
    generatedAt: normalizeClock(options.generatedAt ?? "logical:0"),
    format: normalizeExportFormat(options.format ?? "json.summary"),
    source: {
      kind: normalized.kind,
      jobIds: normalized.jobIds,
      status: normalized.status,
    },
    counters,
    timeline: buildExportTimeline(normalized, history),
    history,
    summary: buildExportSummary(normalized, counters),
    readiness: buildExportReadinessState(blockers, counters, options),
    truthBoundary: {
      externalWritesAllowed: false,
      externalWriteViolations: counters.externalWriteViolations,
      boundaryViolations: counters.boundaryViolations,
      missingEvidence: counters.missingEvidence,
      readyForExport: blockers.length === 0,
    },
  });
}

export function createAuditExportPackage(exportSnapshot, options = {}) {
  if (!exportSnapshot || exportSnapshot.kind !== "aios.audit.export-snapshot") {
    throw new Error("exportSnapshot must be produced by createAuditExportSnapshot");
  }

  const redaction = normalizeExportRedaction(options.redaction ?? {});
  const destination = normalizeExportDestination(options.destination ?? {});
  const retention = normalizeExportRetention(options.retention ?? {});
  const historyWindow = normalizeExportHistoryWindow(exportSnapshot.history, options.historyWindow ?? {});
  const ready = exportSnapshot.truthBoundary.readyForExport
    && destination.ready
    && redaction.ready
    && retention.ready;
  const blockers = uniqueSorted([
    ...exportSnapshot.readiness.blockedReasons,
    ...destination.blockedReasons,
    ...redaction.blockedReasons,
    ...retention.blockedReasons,
  ]);
  const packageId = stableReceipt([
    exportSnapshot.exportId,
    destination.target,
    redaction.mode,
    retention.policy,
    historyWindow.from,
    historyWindow.to,
  ]);

  return deepFreeze({
    kind: "aios.audit.export-package",
    apiVersion: "aios.audit/v1",
    packageId,
    exportId: exportSnapshot.exportId,
    generatedAt: normalizeClock(options.generatedAt ?? exportSnapshot.generatedAt),
    status: ready ? "ready" : "blocked",
    format: exportSnapshot.format,
    source: exportSnapshot.source,
    destination,
    redaction,
    retention,
    historyWindow,
    manifest: {
      fileName: buildExportFileName(exportSnapshot, destination),
      contentType: deriveExportContentType(exportSnapshot.format),
      recordCount: exportSnapshot.counters.jobs + exportSnapshot.counters.historySnapshots,
      includesTimeline: exportSnapshot.timeline.length > 0,
      includesCounters: true,
      includesEvidenceSubjects: redaction.includeEvidenceSubjects,
    },
    counters: exportSnapshot.counters,
    summary: ready
      ? `export package ready: ${exportSnapshot.summary}`
      : `export package blocked: ${blockers.join("; ")}`,
    readiness: {
      ready,
      nextAction: ready ? "audit.export.download" : deriveBlockedExportPackageAction(blockers),
      blockedReasons: blockers,
    },
    timeline: exportSnapshot.timeline.map((event) => ({
      at: event.at,
      status: event.status,
      source: event.source,
    })),
  });
}

export function buildAuditTimelineState(report, options = {}) {
  const normalized = normalizeReportForExport(report);
  const history = buildHistorySnapshots(normalized, options.history ?? []);
  const currentIndex = history.length - 1;
  const current = history[currentIndex];
  const previous = history[currentIndex - 1] ?? null;

  return deepFreeze({
    kind: "aios.audit.timeline-state",
    apiVersion: "aios.audit/v1",
    jobIds: normalized.jobIds,
    current,
    previous,
    changed: previous
      ? current.status !== previous.status
        || current.missingEvidence !== previous.missingEvidence
        || current.externalWriteViolations !== previous.externalWriteViolations
      : true,
    nextAction: deriveAuditNextAction(current),
    checkpoints: history.map((snapshot, index) => ({
      index,
      label: `${snapshot.status}:${snapshot.missingEvidence}:${snapshot.externalWriteViolations}`,
      exportReady: snapshot.exportReady,
    })),
  });
}

export function createProviderSyncEvidence(report, providerContract, options = {}) {
  const normalized = normalizeReportForExport(report);
  const provider = normalizeProviderContract(providerContract);
  const readiness = deriveProviderSyncReadiness(normalized, provider);
  const generatedAt = normalizeClock(options.generatedAt ?? "logical:0");
  const receipt = stableReceipt([
    normalized.kind,
    normalized.jobIds.join(","),
    provider.provider.name,
    provider.sync.checkpoint,
    readiness.status,
    generatedAt,
  ]);

  return deepFreeze({
    kind: "aios.audit.provider-sync-evidence",
    apiVersion: "aios.integration/v1",
    receipt,
    generatedAt,
    source: {
      auditKind: normalized.kind,
      jobIds: normalized.jobIds,
      status: normalized.status,
      acceptedEvidence: normalized.acceptedEvidence.length,
      missingEvidence: normalized.missingEvidence.length,
      externalWriteViolations: normalized.violations.length,
    },
    provider: provider.provider,
    negotiation: {
      satisfied: provider.negotiation.satisfied,
      requestedCapabilities: provider.negotiation.requestedCapabilities,
      grantedCapabilities: provider.negotiation.grantedCapabilities,
      deniedCapabilities: provider.negotiation.deniedCapabilities,
      providerScopes: provider.negotiation.providerScopes,
    },
    sync: {
      direction: provider.sync.direction,
      source: provider.sync.source,
      destination: provider.sync.destination,
      externalHandoff: provider.sync.externalHandoff,
      checkpoint: provider.sync.checkpoint,
      memoryWritePolicy: provider.sync.memoryWritePolicy,
    },
    handoff: {
      ready: provider.handoffState.ready,
      nextAction: provider.handoffState.nextAction,
      runtimeCommand: provider.handoffState.runtimeCommand,
      blockedReasons: provider.handoffState.blockedReasons,
      handoffToken: provider.handoffState.handoffToken,
    },
    readiness,
    truthBoundary: {
      externalWritesAllowed: false,
      readyForProviderSync: readiness.ready,
      evidenceSubject: `provider-sync:${provider.provider.name}:${provider.sync.checkpoint}`,
    },
  });
}

export function createAuditDecisionSummary(report, options = {}) {
  const normalized = normalizeReportForExport(report);
  const health = normalizeDecisionHealth(options.healthReport?.health ?? options.health ?? normalized.health ?? {});
  const exportSnapshot = normalizeDecisionExportSnapshot(options.exportSnapshot ?? options.auditExport ?? {});
  const exportPackage = normalizeDecisionExportPackage(options.exportPackage ?? {});
  const acceptance = normalizeDecisionAcceptance(options.acceptance ?? options);
  const validation = buildDecisionValidation(normalized, health, exportSnapshot, exportPackage);
  const readiness = buildDecisionReadiness(validation, health, exportSnapshot, exportPackage, acceptance);
  const decisionId = stableReceipt([
    normalized.kind,
    normalized.jobIds.join(","),
    normalized.status,
    readiness.status,
    readiness.nextAction,
    acceptance.acceptedAt ?? "pending",
  ]);

  return deepFreeze({
    kind: "aios.audit.decision-summary",
    apiVersion: "aios.audit/v1",
    decisionId,
    source: {
      kind: normalized.kind,
      jobIds: normalized.jobIds,
      status: normalized.status,
      summary: normalized.summaries.join("; "),
    },
    preview: {
      status: readiness.status,
      badge: deriveDecisionBadge(readiness),
      message: readiness.message,
      primaryAction: readiness.nextAction,
      secondaryActions: buildDecisionSecondaryActions(validation, health, exportPackage),
      counters: {
        acceptedEvidence: normalized.acceptedEvidence.length,
        missingEvidence: normalized.missingEvidence.length,
        rejectedEvidence: normalized.rejectedEvidence.length,
        externalWriteViolations: normalized.violations.length,
        boundaryViolations: normalized.boundaryViolations.length,
      },
    },
    acceptance: {
      required: readiness.acceptanceRequired,
      accepted: acceptance.accepted && validation.valid,
      acceptedBy: acceptance.accepted && validation.valid ? acceptance.acceptedBy : null,
      acceptedAt: acceptance.accepted && validation.valid ? acceptance.acceptedAt : null,
      command: readiness.acceptanceRequired && !acceptance.accepted ? "audit.preview.accept" : null,
      blockedReasons: acceptance.accepted && validation.valid ? [] : validation.blockedReasons,
    },
    readiness,
    validationSummary: validation,
    nextSteps: buildDecisionNextSteps(readiness, validation, health, exportPackage),
    handoff: {
      localOnly: exportPackage.localOnly !== false,
      exportId: exportSnapshot.exportId,
      packageId: exportPackage.packageId,
      destination: exportPackage.destination,
      redaction: exportPackage.redaction,
      command: readiness.nextAction,
    },
  });
}

export function createSchedulerPreflightAuditEvidence(preflight, verifierReport = {}, options = {}) {
  if (!preflight || typeof preflight !== "object" || Array.isArray(preflight)) {
    throw new Error("preflight must be produced by createMailchimpSchedulerPreflight or compileMailchimpScheduleJob");
  }

  const checklist = normalizePreflightChecklist(preflight.checklist ?? []);
  const status = normalizePreflightStatus(preflight.status ?? "blocked");
  const verifierStatus = String(verifierReport.status ?? "not-run").trim().toLowerCase();
  const preflightBlockedReasons = Array.isArray(preflight.blockedReasons) ? preflight.blockedReasons : [];
  const preflightWarningReasons = Array.isArray(preflight.warningReasons) ? preflight.warningReasons : [];
  const verifierChecks = Array.isArray(verifierReport.checks) ? verifierReport.checks : [];
  const recoveryEntries = Array.isArray(preflight.recovery) ? preflight.recovery : [];
  const blockedReasons = uniqueSorted([
    ...preflightBlockedReasons,
    ...checklist
      .filter((item) => item.status === "blocked")
      .map((item) => item.action || item.id),
  ]);
  const warnings = uniqueSorted([
    ...preflightWarningReasons,
    ...checklist
      .filter((item) => item.status === "warning")
      .map((item) => item.action || item.id),
  ]);
  const verifierPreflightCheck = verifierChecks.find((check) => check.name === "scheduler-preflight");
  const aligned = Boolean(
    preflight.commandId &&
    (!verifierReport.preflightCommandId || verifierReport.preflightCommandId === preflight.commandId) &&
    (!verifierPreflightCheck || verifierPreflightCheck.passed === true || verifierPreflightCheck.severity === "warning")
  );
  const ready = status === "ready" && blockedReasons.length === 0 && aligned;
  const receipt = stableReceipt([
    "scheduler-preflight",
    preflight.jobId ?? "unknown-job",
    preflight.commandId ?? "missing-command",
    status,
    verifierStatus,
    blockedReasons.join("|"),
    warnings.join("|"),
  ]);

  return deepFreeze({
    kind: "aios.audit.scheduler-preflight-evidence",
    apiVersion: "aios.audit/v1",
    receipt,
    generatedAt: normalizeClock(options.generatedAt ?? "logical:0"),
    jobId: String(preflight.jobId ?? verifierReport.jobId ?? "unknown"),
    commandId: String(preflight.commandId ?? ""),
    adapterCommandId: preflight.adapterCommandId ? String(preflight.adapterCommandId) : null,
    status,
    readyForVerifier: status !== "blocked",
    readyForAdapterHandoff: ready && verifierStatus === "verified",
    alignment: {
      verifierStatus,
      verifierCheckedPreflight: Boolean(verifierPreflightCheck),
      verifierPreflightPassed: verifierPreflightCheck?.passed === true,
      commandMatchesVerifier: aligned,
      verifierPreflightCode: verifierPreflightCheck?.code ?? null,
    },
    counters: {
      checks: checklist.length,
      passed: checklist.filter((item) => item.status === "passed").length,
      warnings: checklist.filter((item) => item.status === "warning").length,
      blocked: checklist.filter((item) => item.status === "blocked").length,
      recoveryActions: recoveryEntries.length,
    },
    blockedReasons,
    warnings,
    checklist,
    recovery: recoveryEntries.map((entry) => ({
      check: String(entry.check ?? "scheduler-preflight"),
      code: String(entry.code ?? "preflight_issue"),
      severity: String(entry.severity ?? "error"),
      retryable: Boolean(entry.retryable),
      action: String(entry.action ?? "operator-review"),
    })),
    nextAction:
      ready && verifierStatus === "verified"
        ? "audit.record-preflight-evidence"
        : blockedReasons.length > 0
          ? "scheduler.preflight.repair"
          : verifierStatus === "not-run"
            ? "process.verify"
            : "operator.review",
    truthBoundary: {
      externalWritesAllowed: false,
      externalWritesObserved: [],
      evidenceSubject: `scheduler-preflight:${preflight.commandId ?? "pending"}`,
      localOnly: true,
    },
  });
}

function normalizePreflightStatus(status) {
  const normalized = String(status ?? "blocked").trim().toLowerCase();
  if (!["ready", "degraded", "blocked"].includes(normalized)) {
    throw new Error(`unsupported scheduler preflight status: ${status}`);
  }
  return normalized;
}

function normalizePreflightChecklist(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("preflight checklist must be an array");
  }

  return entries.map((entry, index) => {
    const status = String(entry?.status ?? "blocked").trim().toLowerCase();
    if (!["passed", "warning", "blocked"].includes(status)) {
      throw new Error(`unsupported preflight checklist status at ${index}: ${status}`);
    }

    return {
      index,
      id: String(entry?.id ?? entry?.check ?? `check-${index + 1}`).trim().toLowerCase(),
      status,
      severity: String(entry?.severity ?? (status === "passed" ? "info" : "error")).trim().toLowerCase(),
      action: String(entry?.action ?? entry?.recovery ?? "operator-review"),
      evidence: String(entry?.evidence ?? entry?.subject ?? "pending"),
      source: String(entry?.source ?? "scheduler-preflight"),
    };
  });
}

function normalizeTimeline(events) {
  if (!Array.isArray(events)) {
    throw new Error("timeline must be an array");
  }

  const normalized = events.map((event) => createStatusEvent(event.status, event));
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = STATUS_ORDER.indexOf(normalized[index - 1].status);
    const next = STATUS_ORDER.indexOf(normalized[index].status);
    if (next < previous && normalized[index].status !== "rolled_back") {
      throw new Error("timeline status order cannot move backward");
    }
  }

  return normalized;
}

function normalizeEvidence(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("evidence must be an array");
  }

  return entries
    .filter((entry) => TRUSTED_EVIDENCE_KINDS.includes(entry?.kind))
    .map((entry) => createEvidence(entry.kind, entry.subject, entry.details ?? {}));
}

function rejectUntrustedEvidence(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry) => !TRUSTED_EVIDENCE_KINDS.includes(entry?.kind))
    .map((entry) => ({
      kind: String(entry?.kind ?? "unknown"),
      subject: String(entry?.subject ?? "unknown"),
      reason: "untrusted evidence kind",
    }));
}

function normalizeExternalWrites(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("externalWrites must be an array");
  }

  return entries.map((entry) => ({
    target: String(entry.target ?? entry),
    reason: String(entry.reason ?? "external write attempted"),
  }));
}

function findMissingEvidence(jobDescriptor, evidence) {
  const subjects = new Set(evidence.map((entry) => entry.subject));
  return jobDescriptor.verifier.requiredEvidence.filter((subject) => !subjects.has(subject));
}

function deriveStatus({ timeline, missingEvidence, externalWrites, boundaryViolations = [], requestedStatus }) {
  if (externalWrites.length > 0 || boundaryViolations.length > 0) {
    return "failed";
  }
  if (requestedStatus === "rolled_back") {
    return "rolled_back";
  }
  if (missingEvidence.length > 0) {
    return "verifying";
  }
  if (timeline.some((event) => event.status === "failed")) {
    return "failed";
  }
  return requestedStatus && STATUS_ORDER.includes(requestedStatus) ? requestedStatus : "completed";
}

function buildRecoveryReport(jobDescriptor, status, timeline, health) {
  const rollbackEnabled = jobDescriptor.recovery.rollback !== "none";
  const shouldRollback = status === "failed" && rollbackEnabled;

  return {
    policy: jobDescriptor.recovery,
    shouldRollback,
    rollbackStatus: shouldRollback ? "pending" : "not-required",
    lastKnownStatus: timeline.at(-1)?.status ?? "queued",
    retry: {
      ...health.retry,
      command: health.retry.allowed ? "process.retry" : null,
    },
    degradedMode: {
      active: health.mode === "degraded",
      reason: health.mode === "degraded" ? health.summary : null,
      command: health.mode === "degraded" ? health.nextAction : null,
    },
  };
}

function summarize(status, missingEvidence, externalWrites, boundaryViolations = []) {
  if (boundaryViolations.length > 0) {
    return `failed: ${boundaryViolations.length} tenant boundary violation(s)`;
  }
  if (externalWrites.length > 0) {
    return `failed: ${externalWrites.length} external write violation(s)`;
  }
  if (missingEvidence.length > 0) {
    return `verifying: ${missingEvidence.length} evidence receipt(s) missing`;
  }
  return `${status}: truth boundary satisfied`;
}

function normalizeReportForExport(report) {
  if (!report || !["aios.audit.truth-boundary", "aios.audit.bundle"].includes(report.kind)) {
    throw new Error("report must be an audit truth-boundary or bundle report");
  }

  if (report.kind === "aios.audit.truth-boundary") {
    return {
      kind: report.kind,
      jobId: report.jobId,
      jobIds: [report.jobId],
      status: report.status,
      summaries: [report.summary],
      timeline: report.timeline,
      missingEvidence: report.evidence.missing,
      violations: report.boundary.externalWritesObserved,
      boundaryViolations: report.boundary.tenantBoundary?.violations ?? [],
      acceptedEvidence: report.evidence.accepted,
      rejectedEvidence: report.evidence.rejected,
      recovery: [report.recovery],
      health: report.health ?? null,
    };
  }

  return {
    kind: report.kind,
    jobId: null,
    jobIds: report.jobIds,
    status: report.status,
    summaries: report.summaries,
    timeline: [],
    missingEvidence: report.missingEvidence,
    violations: report.violations,
    boundaryViolations: report.boundaryViolations ?? [],
    acceptedEvidence: [],
    rejectedEvidence: [],
    recovery: [],
    health: null,
  };
}

function buildAuditHealthState(jobDescriptor, input) {
  const retryPolicy = normalizeRetryPolicy(jobDescriptor.recovery?.retry ?? {});
  const adapter = normalizeAdapterHealth(input.adapterHealth ?? {});
  const failedEvents = input.timeline.filter((event) => event.status === "failed").length;
  const attempt = Math.max(adapter.retryAttempt, failedEvents);
  const actionableErrors = buildActionableAuditErrors(input, adapter);
  const retry = buildRetryDecision(retryPolicy, attempt, actionableErrors, input.status);
  const mode = deriveHealthMode(input, adapter, actionableErrors, retry);
  const readyForExport = mode === "healthy" && input.missingEvidence.length === 0;

  return {
    mode,
    severity: mode === "healthy"
      ? "ok"
      : mode === "degraded"
        ? "warning"
        : "blocked",
    readyForExport,
    adapter,
    retry,
    actionableErrors,
    nextAction: deriveHealthNextAction(mode, actionableErrors, retry, input.status),
    summary: summarizeHealth(mode, actionableErrors, retry),
  };
}

function normalizeRetryPolicy(policy) {
  const attempts = normalizeCounter(policy.attempts ?? 0, "retry.attempts");
  const backoff = String(policy.backoff ?? "deterministic-linear");
  if (!["deterministic-linear", "none"].includes(backoff)) {
    throw new Error(`unsupported retry backoff: ${backoff}`);
  }

  return {
    attempts,
    backoff,
  };
}

function normalizeAdapterHealth(health) {
  const input = health && typeof health === "object" && !Array.isArray(health) ? health : {};
  const status = String(input.status ?? "available").trim().toLowerCase();
  if (!["available", "degraded", "unavailable", "timeout", "rate-limited"].includes(status)) {
    throw new Error(`unsupported adapter health status: ${status}`);
  }

  return {
    status,
    message: String(input.message ?? status),
    retryAttempt: normalizeCounter(input.retryAttempt ?? input.attempt ?? 0, "adapter retryAttempt"),
    retryAfter: input.retryAfter ? normalizeClock(input.retryAfter) : null,
    checkpoint: input.checkpoint ? String(input.checkpoint) : null,
  };
}

function buildActionableAuditErrors(input, adapter) {
  const errors = [];
  if (input.externalWrites.length > 0) {
    errors.push({
      code: "truth-boundary.external-write",
      message: `${input.externalWrites.length} external write violation(s) observed`,
      action: "process.rollback",
      retryable: false,
    });
  }
  if (input.boundaryViolations.length > 0) {
    errors.push({
      code: "tenant-boundary.violation",
      message: `${input.boundaryViolations.length} tenant boundary violation(s) observed`,
      action: "package.settings.fix",
      retryable: false,
    });
  }
  if (input.missingEvidence.length > 0) {
    errors.push({
      code: "evidence.missing",
      message: `${input.missingEvidence.length} evidence receipt(s) missing`,
      action: "process.verify",
      retryable: true,
    });
  }
  if (["timeout", "rate-limited", "unavailable"].includes(adapter.status)) {
    errors.push({
      code: `adapter.${adapter.status}`,
      message: adapter.message,
      action: "process.retry",
      retryable: true,
    });
  }
  if (adapter.status === "degraded") {
    errors.push({
      code: "adapter.degraded",
      message: adapter.message,
      action: "process.degraded-mode",
      retryable: true,
    });
  }
  return errors.sort((left, right) => left.code.localeCompare(right.code));
}

function buildRetryDecision(policy, attempt, actionableErrors, status) {
  const retryable = actionableErrors.some((error) => error.retryable);
  const remaining = Math.max(policy.attempts - attempt, 0);
  const allowed = retryable && remaining > 0 && !["completed", "rolled_back"].includes(status);

  return {
    policy,
    attempt,
    remaining,
    allowed,
    backoffSlot: allowed ? `logical:${(attempt + 1) * 5}` : null,
    reason: allowed
      ? `retry ${attempt + 1} of ${policy.attempts}`
      : retryable
        ? "retry budget exhausted"
        : "no retryable audit error",
  };
}

function deriveHealthMode(input, adapter, actionableErrors, retry) {
  if (input.status === "failed" || actionableErrors.some((error) => error.retryable === false)) {
    return "failed";
  }
  if (adapter.status === "degraded" || (actionableErrors.length > 0 && retry.allowed)) {
    return "degraded";
  }
  if (actionableErrors.length > 0) {
    return "blocked";
  }
  return "healthy";
}

function deriveHealthNextAction(mode, actionableErrors, retry, status) {
  if (mode === "healthy") {
    return status === "completed" ? "audit.export" : "process.verify";
  }
  const rollback = actionableErrors.find((error) => error.action === "process.rollback");
  if (rollback) {
    return rollback.action;
  }
  if (retry.allowed) {
    return "process.retry";
  }
  return actionableErrors[0]?.action ?? "operator.review";
}

function summarizeHealth(mode, actionableErrors, retry) {
  if (mode === "healthy") {
    return "healthy: truth boundary satisfied";
  }
  if (retry.allowed) {
    return `${mode}: ${actionableErrors.length} actionable issue(s), ${retry.remaining} retry attempt(s) remaining`;
  }
  return `${mode}: ${actionableErrors.length} actionable issue(s)`;
}

function buildHistorySnapshots(normalized, historyInput) {
  if (!Array.isArray(historyInput)) {
    throw new Error("history must be an array");
  }

  const history = historyInput.map((entry, index) => normalizeHistorySnapshot(entry, index));
  history.push({
    at: "current",
    status: normalized.status,
    missingEvidence: normalized.missingEvidence.length,
    externalWriteViolations: normalized.violations.length,
    boundaryViolations: normalized.boundaryViolations.length,
    acceptedEvidence: normalized.acceptedEvidence.length,
    rejectedEvidence: normalized.rejectedEvidence.length,
    exportReady: normalized.missingEvidence.length === 0
      && normalized.violations.length === 0
      && normalized.boundaryViolations.length === 0,
  });

  return history;
}

function normalizeHistorySnapshot(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`history entry ${index} must be an object`);
  }
  const status = String(entry.status ?? "verifying");
  if (!STATUS_ORDER.includes(status)) {
    throw new Error(`unsupported history status: ${status}`);
  }

  const missingEvidence = normalizeCounter(entry.missingEvidence ?? 0, "missingEvidence");
  const externalWriteViolations = normalizeCounter(
    entry.externalWriteViolations ?? entry.violations ?? 0,
    "externalWriteViolations",
  );
  const acceptedEvidence = normalizeCounter(entry.acceptedEvidence ?? 0, "acceptedEvidence");
  const rejectedEvidence = normalizeCounter(entry.rejectedEvidence ?? 0, "rejectedEvidence");
  const boundaryViolations = normalizeCounter(entry.boundaryViolations ?? 0, "boundaryViolations");

  return {
    at: normalizeClock(entry.at ?? `logical:${index}`),
    status,
    missingEvidence,
    externalWriteViolations,
    boundaryViolations,
    acceptedEvidence,
    rejectedEvidence,
    exportReady: Boolean(
      entry.exportReady ?? (
        missingEvidence === 0
        && externalWriteViolations === 0
        && boundaryViolations === 0
      ),
    ),
  };
}

function buildAuditCounters(normalized, history) {
  const latest = history.at(-1);
  const statusCounts = Object.fromEntries(STATUS_ORDER.map((status) => [
    status,
    history.filter((snapshot) => snapshot.status === status).length,
  ]));

  return {
    jobs: normalized.jobIds.length,
    acceptedEvidence: latest.acceptedEvidence,
    rejectedEvidence: latest.rejectedEvidence,
    missingEvidence: latest.missingEvidence,
    externalWriteViolations: latest.externalWriteViolations,
    boundaryViolations: normalized.boundaryViolations.length,
    timelineEvents: normalized.timeline.length,
    historySnapshots: history.length,
    statusCounts,
  };
}

function deriveExportBlockers(normalized, counters) {
  const blockers = [];
  if (counters.externalWriteViolations > 0) {
    blockers.push(`${counters.externalWriteViolations} external write violation(s) observed`);
  }
  if (counters.boundaryViolations > 0) {
    blockers.push(`${counters.boundaryViolations} tenant boundary violation(s) observed`);
  }
  if (counters.missingEvidence > 0) {
    blockers.push(`${counters.missingEvidence} evidence receipt(s) missing`);
  }
  if (normalized.status === "failed") {
    blockers.push("failed audit status requires recovery before export");
  }
  return uniqueSorted(blockers);
}

function buildExportReadinessState(blockers, counters, options) {
  const minHistorySnapshots = normalizeCounter(options.minHistorySnapshots ?? 1, "minHistorySnapshots");
  const historyReady = counters.historySnapshots >= minHistorySnapshots;
  const allBlockers = uniqueSorted([
    ...blockers,
    ...(historyReady ? [] : [`at least ${minHistorySnapshots} history snapshot(s) required`]),
  ]);

  return {
    ready: allBlockers.length === 0,
    status: allBlockers.length === 0 ? "export-ready" : "export-blocked",
    nextAction: allBlockers.length === 0
      ? "audit.export.package"
      : blockers.some((blocker) => blocker.includes("evidence"))
        ? "process.verify"
        : blockers.some((blocker) => blocker.includes("external write") || blocker.includes("failed"))
          ? "process.rollback"
          : "package.settings.fix",
    blockedReasons: allBlockers,
    checks: {
      minimumHistorySnapshots: minHistorySnapshots,
      historySnapshots: counters.historySnapshots,
      evidenceComplete: counters.missingEvidence === 0,
      boundaryClean: counters.boundaryViolations === 0 && counters.externalWriteViolations === 0,
    },
  };
}

function buildExportTimeline(normalized, history) {
  const reportEvents = normalized.timeline.map((event, index) => ({
    index,
    at: event.at,
    status: event.status,
    actor: event.actor,
    message: event.message,
    source: "report",
  }));

  const historyEvents = history.map((snapshot, index) => ({
    index: reportEvents.length + index,
    at: snapshot.at,
    status: snapshot.status,
    actor: "audit-export",
    message: snapshot.exportReady ? "export-ready snapshot" : "export-blocked snapshot",
    source: "history",
  }));

  return [...reportEvents, ...historyEvents];
}

function buildExportSummary(normalized, counters) {
  if (counters.externalWriteViolations > 0) {
    return `blocked export: ${counters.externalWriteViolations} external write violation(s) across ${counters.jobs} job(s)`;
  }
  if (counters.boundaryViolations > 0) {
    return `blocked export: ${counters.boundaryViolations} tenant boundary violation(s) across ${counters.jobs} job(s)`;
  }
  if (counters.missingEvidence > 0) {
    return `pending export: ${counters.missingEvidence} evidence receipt(s) missing across ${counters.jobs} job(s)`;
  }
  return `ready export: ${normalized.status} with ${counters.acceptedEvidence} accepted evidence receipt(s)`;
}

function deriveAuditNextAction(snapshot) {
  if (snapshot.externalWriteViolations > 0) {
    return "rollback-and-investigate";
  }
  if (snapshot.missingEvidence > 0) {
    return "collect-evidence";
  }
  if (!snapshot.exportReady) {
    return "wait-for-verification";
  }
  return "export-summary";
}

function normalizeExportDestination(destination) {
  const target = String(destination.target ?? "operator-download").trim().toLowerCase();
  if (!["operator-download", "local-archive", "status-handoff"].includes(target)) {
    throw new Error(`unsupported audit export destination: ${destination.target}`);
  }

  const localOnly = destination.localOnly !== false;
  const blockedReasons = [];
  if (!localOnly) {
    blockedReasons.push("audit exports must remain local-only");
  }

  return {
    target,
    localOnly,
    channel: String(destination.channel ?? target),
    ready: blockedReasons.length === 0,
    blockedReasons,
  };
}

function normalizeExportRedaction(redaction) {
  const mode = String(redaction.mode ?? "receipt-subjects").trim().toLowerCase();
  if (!["receipt-subjects", "counts-only"].includes(mode)) {
    throw new Error(`unsupported audit export redaction mode: ${redaction.mode}`);
  }

  return {
    mode,
    includeEvidenceSubjects: mode === "receipt-subjects",
    includeReceiptDetails: false,
    ready: true,
    blockedReasons: [],
  };
}

function normalizeExportRetention(retention) {
  const policy = String(retention.policy ?? "ephemeral-review").trim().toLowerCase();
  if (!["ephemeral-review", "local-session"].includes(policy)) {
    throw new Error(`unsupported audit export retention policy: ${retention.policy}`);
  }

  const ttlMinutes = normalizeCounter(retention.ttlMinutes ?? 60, "retention.ttlMinutes");
  const blockedReasons = ttlMinutes === 0 ? ["audit export retention ttl must be greater than zero"] : [];
  return {
    policy,
    ttlMinutes,
    ready: blockedReasons.length === 0,
    blockedReasons,
  };
}

function normalizeExportHistoryWindow(history, window) {
  const fromIndex = normalizeCounter(window.fromIndex ?? 0, "historyWindow.fromIndex");
  const toIndex = normalizeCounter(window.toIndex ?? Math.max(history.length - 1, 0), "historyWindow.toIndex");
  if (fromIndex > toIndex) {
    throw new Error("historyWindow.fromIndex cannot be greater than toIndex");
  }
  if (toIndex >= history.length) {
    throw new Error("historyWindow.toIndex is outside export history");
  }

  return {
    from: history[fromIndex]?.at ?? "current",
    to: history[toIndex]?.at ?? "current",
    snapshotCount: toIndex - fromIndex + 1,
  };
}

function buildExportFileName(exportSnapshot, destination) {
  const ids = exportSnapshot.source.jobIds.join("_").replace(/[^a-z0-9_-]+/gi, "-");
  const suffix = exportSnapshot.format.replace(".", "-");
  return `${destination.target}_${ids}_${exportSnapshot.exportId}.${suffix}.json`;
}

function deriveExportContentType(format) {
  if (format === "csv.counters") {
    return "text/csv";
  }
  return "application/json";
}

function deriveBlockedExportPackageAction(blockers) {
  if (blockers.some((blocker) => blocker.includes("external write") || blocker.includes("failed"))) {
    return "process.rollback";
  }
  if (blockers.some((blocker) => blocker.includes("evidence"))) {
    return "process.verify";
  }
  return "operator.review";
}

function normalizeProviderContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new Error("providerContract must be an object");
  }

  const provider = contract.provider ?? {};
  const negotiation = contract.negotiation ?? {};
  const sync = contract.sync ?? {};
  const handoffState = contract.handoffState ?? {};

  return {
    provider: {
      name: String(provider.name ?? "mailchimp"),
      adapter: String(provider.adapter ?? "mailchimp.v1"),
      service: String(provider.service ?? "marketing-campaigns"),
      mode: String(provider.mode ?? "read-only"),
    },
    negotiation: {
      satisfied: negotiation.satisfied !== false,
      requestedCapabilities: normalizeStringList(negotiation.requestedCapabilities),
      grantedCapabilities: normalizeStringList(negotiation.grantedCapabilities),
      deniedCapabilities: normalizeDeniedCapabilities(negotiation.deniedCapabilities),
      providerScopes: normalizeStringList(negotiation.providerScopes),
    },
    sync: {
      direction: String(sync.direction ?? "provider-to-local"),
      source: String(sync.source ?? sync.providerResource ?? "campaign"),
      destination: String(sync.destination ?? sync.localNamespace ?? "local"),
      externalHandoff: String(sync.externalHandoff ?? "none"),
      checkpoint: String(sync.lastCheckpoint ?? sync.checkpoint ?? "provider_sync"),
      memoryWritePolicy: String(sync.memoryWritePolicy ?? "local-only"),
    },
    handoffState: {
      ready: Boolean(handoffState.ready),
      nextAction: String(handoffState.nextAction ?? "provider.wait"),
      runtimeCommand: handoffState.runtimeCommand ? String(handoffState.runtimeCommand) : null,
      blockedReasons: normalizeStringList(handoffState.blockedReasons),
      handoffToken: handoffState.handoffToken ? String(handoffState.handoffToken) : null,
    },
  };
}

function deriveProviderSyncReadiness(normalized, provider) {
  const blockers = [];
  if (normalized.violations.length > 0) {
    blockers.push(`${normalized.violations.length} external write violation(s) observed`);
  }
  if (normalized.missingEvidence.length > 0) {
    blockers.push(`${normalized.missingEvidence.length} evidence receipt(s) missing`);
  }
  if (!provider.negotiation.satisfied) {
    blockers.push("provider capability negotiation is not satisfied");
  }
  if (!provider.handoffState.ready) {
    blockers.push(...provider.handoffState.blockedReasons);
  }
  if (provider.sync.memoryWritePolicy !== "local-only") {
    blockers.push("provider sync must target local-only memory");
  }
  if (provider.sync.externalHandoff !== "none") {
    blockers.push("provider sync evidence expects no external handoff during audit");
  }

  const uniqueBlockers = [...new Set(blockers)].sort();
  const ready = uniqueBlockers.length === 0;
  return {
    ready,
    status: ready
      ? "sync-evidence-ready"
      : normalized.violations.length > 0
        ? "rollback-required"
        : "sync-evidence-blocked",
    nextAction: ready
      ? "record-provider-sync-evidence"
      : normalized.missingEvidence.length > 0
        ? "collect-evidence"
        : provider.handoffState.nextAction,
    blockedReasons: uniqueBlockers,
  };
}

function normalizeDecisionHealth(health) {
  const input = health && typeof health === "object" && !Array.isArray(health) ? health : {};
  const mode = String(input.mode ?? (input.readyForExport ? "healthy" : "blocked")).trim().toLowerCase();
  if (!["healthy", "degraded", "blocked", "failed"].includes(mode)) {
    throw new Error(`unsupported audit decision health mode: ${mode}`);
  }

  return {
    mode,
    readyForExport: Boolean(input.readyForExport ?? mode === "healthy"),
    nextAction: String(input.nextAction ?? (mode === "healthy" ? "audit.export.package" : "operator.review")),
    summary: String(input.summary ?? mode),
    retry: {
      allowed: Boolean(input.retry?.allowed ?? false),
      remaining: normalizeCounter(input.retry?.remaining ?? 0, "decision retry.remaining"),
      reason: String(input.retry?.reason ?? "no retry decision"),
    },
    actionableErrors: Array.isArray(input.actionableErrors)
      ? input.actionableErrors.map((error) => ({
        code: String(error.code ?? "audit.issue"),
        message: String(error.message ?? error),
        action: String(error.action ?? "operator.review"),
        retryable: Boolean(error.retryable),
      })).sort((left, right) => left.code.localeCompare(right.code))
      : [],
  };
}

function normalizeDecisionExportSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      exportId: null,
      ready: false,
      nextAction: "audit.export.package",
      blockedReasons: [],
    };
  }

  return {
    exportId: snapshot.exportId ? String(snapshot.exportId) : null,
    ready: Boolean(snapshot.truthBoundary?.readyForExport ?? snapshot.readiness?.ready ?? false),
    nextAction: String(snapshot.readiness?.nextAction ?? "audit.export.package"),
    blockedReasons: normalizeStringList(snapshot.readiness?.blockedReasons ?? []),
  };
}

function normalizeDecisionExportPackage(exportPackage) {
  if (!exportPackage || typeof exportPackage !== "object" || Array.isArray(exportPackage)) {
    return {
      packageId: null,
      ready: false,
      localOnly: true,
      destination: "operator-download",
      redaction: "receipt-subjects",
      nextAction: "audit.export.package",
      blockedReasons: [],
    };
  }

  return {
    packageId: exportPackage.packageId ? String(exportPackage.packageId) : null,
    ready: Boolean(exportPackage.readiness?.ready ?? exportPackage.status === "ready"),
    localOnly: exportPackage.destination?.localOnly !== false,
    destination: String(exportPackage.destination?.target ?? "operator-download"),
    redaction: String(exportPackage.redaction?.mode ?? "receipt-subjects"),
    nextAction: String(exportPackage.readiness?.nextAction ?? "audit.export.package"),
    blockedReasons: normalizeStringList(exportPackage.readiness?.blockedReasons ?? []),
  };
}

function normalizeDecisionAcceptance(input = {}) {
  const accepted = Boolean(input.accepted ?? input.operatorAccepted ?? false);
  return {
    accepted,
    acceptedBy: accepted ? String(input.acceptedBy ?? input.operator ?? "operator") : null,
    acceptedAt: accepted ? normalizeClock(input.acceptedAt ?? "logical:0") : null,
    required: input.required !== false,
  };
}

function buildDecisionValidation(normalized, health, exportSnapshot, exportPackage) {
  const errors = [];
  const warnings = [];

  if (normalized.status === "failed") {
    errors.push("failed audit status requires recovery before operator acceptance");
  }
  if (normalized.violations.length > 0) {
    errors.push(`${normalized.violations.length} external write violation(s) observed`);
  }
  if (normalized.boundaryViolations.length > 0) {
    errors.push(`${normalized.boundaryViolations.length} tenant boundary violation(s) observed`);
  }
  if (normalized.missingEvidence.length > 0) {
    errors.push(`${normalized.missingEvidence.length} evidence receipt(s) missing`);
  }
  if (!health.readyForExport && health.mode !== "degraded") {
    errors.push(health.summary);
  }
  if (!exportSnapshot.ready) {
    warnings.push(...exportSnapshot.blockedReasons);
  }
  if (!exportPackage.ready) {
    warnings.push(...exportPackage.blockedReasons);
  }
  if (!exportPackage.localOnly) {
    errors.push("audit decision handoff must remain local-only");
  }

  return {
    valid: errors.length === 0,
    errors: uniqueSorted(errors),
    warnings: uniqueSorted(warnings),
    blockedReasons: uniqueSorted([...errors, ...warnings]),
    checked: {
      auditStatus: normalized.status,
      healthMode: health.mode,
      healthReadyForExport: health.readyForExport,
      exportSnapshotReady: exportSnapshot.ready,
      exportPackageReady: exportPackage.ready,
      localOnlyHandoff: exportPackage.localOnly,
    },
  };
}

function buildDecisionReadiness(validation, health, exportSnapshot, exportPackage, acceptance) {
  const acceptanceRequired = acceptance.required;
  const accepted = !acceptanceRequired || acceptance.accepted;
  const exportReady = validation.valid && exportSnapshot.ready && exportPackage.ready;
  const ready = exportReady && accepted;
  const nextAction = ready
    ? "audit.export.download"
    : validation.valid && !accepted
      ? "audit.preview.accept"
      : deriveDecisionRecoveryAction(validation, health, exportPackage);

  return {
    ready,
    status: ready
      ? "accepted"
      : validation.valid && !accepted
        ? "awaiting-acceptance"
        : health.mode === "degraded" && health.retry.allowed
          ? "recoverable"
          : "blocked",
    acceptanceRequired,
    exportReady,
    nextAction,
    message: ready
      ? "audit export package accepted for local handoff"
      : validation.valid && !accepted
        ? "audit preview is ready for operator acceptance"
        : validation.blockedReasons.join("; "),
  };
}

function deriveDecisionRecoveryAction(validation, health, exportPackage) {
  if (validation.errors.some((reason) => reason.includes("external write") || reason.includes("failed audit"))) {
    return "process.rollback";
  }
  if (validation.errors.some((reason) => reason.includes("tenant boundary"))) {
    return "package.settings.fix";
  }
  if (validation.errors.some((reason) => reason.includes("evidence"))) {
    return "process.verify";
  }
  if (health.retry.allowed) {
    return "process.retry";
  }
  return exportPackage.nextAction ?? health.nextAction;
}

function deriveDecisionBadge(readiness) {
  if (readiness.ready) {
    return "accepted";
  }
  if (readiness.status === "awaiting-acceptance") {
    return "review";
  }
  if (readiness.status === "recoverable") {
    return "attention";
  }
  return "blocked";
}

function buildDecisionSecondaryActions(validation, health, exportPackage) {
  return uniqueSorted([
    ...(validation.errors.length > 0 ? ["operator.review"] : []),
    ...(health.retry.allowed ? ["process.retry"] : []),
    ...(exportPackage.ready ? ["audit.export.package"] : []),
  ]);
}

function buildDecisionNextSteps(readiness, validation, health, exportPackage) {
  if (readiness.ready) {
    return [{
      action: "audit.export.download",
      label: "Download local audit package",
      reason: readiness.message,
    }];
  }
  if (readiness.status === "awaiting-acceptance") {
    return [{
      action: "audit.preview.accept",
      label: "Accept audit preview",
      reason: readiness.message,
    }];
  }

  const reasons = validation.blockedReasons.length > 0
    ? validation.blockedReasons
    : [health.summary];
  return reasons.map((reason) => ({
    action: deriveDecisionRecoveryAction(validation, health, exportPackage),
    label: "Resolve audit decision blocker",
    reason,
  }));
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.map((value) => String(value)))].sort();
}

function normalizeDeniedCapabilities(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((entry) => ({
    capability: String(entry.capability ?? entry),
    reason: String(entry.reason ?? "provider capability is not granted"),
  })).sort((left, right) => left.capability.localeCompare(right.capability));
}

function normalizeCounter(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return normalized;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))].sort();
}

function normalizeExportFormat(format) {
  const normalized = String(format).trim().toLowerCase();
  if (!["json.summary", "json.timeline", "csv.counters"].includes(normalized)) {
    throw new Error(`unsupported audit export format: ${format}`);
  }
  return normalized;
}

function normalizeClock(value) {
  const normalized = String(value);
  if (!/^(logical:\d+|\d{4}-\d{2}-\d{2}T)/.test(normalized)) {
    throw new Error(`unsupported clock value: ${value}`);
  }
  return normalized;
}

function normalizeEvidenceDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [String(key), String(value)]).sort(),
  );
}

function normalizeTenantBoundary(jobDescriptor, observedBoundary) {
  const tenancy = jobDescriptor.tenancy ?? {};
  const observed = observedBoundary && typeof observedBoundary === "object" && !Array.isArray(observedBoundary)
    ? observedBoundary
    : {};
  const tenantId = String(observed.tenantId ?? tenancy.tenantId ?? "tenant-default");
  const workspaceId = String(observed.workspaceId ?? tenancy.workspaceId ?? "workspace-default");
  const allowedWorkspaces = normalizeStringList(tenancy.allowedWorkspaces ?? [workspaceId]);
  const permissions = normalizeStringList(tenancy.permissions ?? []);
  const violations = normalizeStringList([
    ...(tenancy.violations ?? []),
    ...(Array.isArray(observed.violations) ? observed.violations : []),
    ...(tenancy.boundarySatisfied === false ? ["job tenancy boundary is not satisfied"] : []),
    ...(allowedWorkspaces.length > 0 && !allowedWorkspaces.includes(workspaceId)
      ? [`workspace ${workspaceId} is outside tenant boundary`]
      : []),
  ]);

  return {
    tenantId,
    workspaceId,
    homeWorkspaceId: String(tenancy.homeWorkspaceId ?? tenancy.workspaceId ?? workspaceId),
    role: String(tenancy.role ?? "operator"),
    permissions,
    allowedWorkspaces,
    isolationMode: String(tenancy.isolationMode ?? jobDescriptor.verifier.truthBoundary.tenantIsolation ?? "tenant-workspace"),
    auditChannel: String(tenancy.auditChannel ?? `${tenantId}:${workspaceId}`),
    satisfied: violations.length === 0,
    violations,
  };
}

function assertJobDescriptor(jobDescriptor) {
  if (!jobDescriptor || jobDescriptor.kind !== "aios.kernel.job") {
    throw new Error("jobDescriptor must be produced by buildKernelJobDescriptor");
  }
  if (jobDescriptor.memory.writePolicy !== "local-only") {
    throw new Error("audit only accepts local-only memory write policies");
  }
  if (jobDescriptor.tenancy && jobDescriptor.tenancy.workspaceId) {
    const truthWorkspace = jobDescriptor.verifier.truthBoundary.workspaceId;
    if (truthWorkspace && truthWorkspace !== jobDescriptor.tenancy.workspaceId) {
      throw new Error("audit truth boundary workspace does not match job tenancy");
    }
  }
}

function stableReceipt(parts) {
  const text = parts.join("\u001f");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(31, hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return `receipt_${(hash >>> 0).toString(36)}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
