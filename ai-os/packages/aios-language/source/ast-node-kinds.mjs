export const AIOS_AST_NODE_KINDS = Object.freeze({
  Program: "Program",
  JobDeclaration: "JobDeclaration",
  CapabilityDeclaration: "CapabilityDeclaration",
  MemoryDeclaration: "MemoryDeclaration",
  StepDeclaration: "StepDeclaration",
  VerifierDeclaration: "VerifierDeclaration",
  TruthBoundaryDeclaration: "TruthBoundaryDeclaration",
  RollbackDeclaration: "RollbackDeclaration",
});

const NODE_KIND_ORDER = Object.freeze([
  AIOS_AST_NODE_KINDS.Program,
  AIOS_AST_NODE_KINDS.JobDeclaration,
  AIOS_AST_NODE_KINDS.CapabilityDeclaration,
  AIOS_AST_NODE_KINDS.MemoryDeclaration,
  AIOS_AST_NODE_KINDS.StepDeclaration,
  AIOS_AST_NODE_KINDS.VerifierDeclaration,
  AIOS_AST_NODE_KINDS.TruthBoundaryDeclaration,
  AIOS_AST_NODE_KINDS.RollbackDeclaration,
]);

export const AIOS_AST_NODE_KIND_CONTRACTS = Object.freeze({
  Program: freezeNodeKindContract({
    kind: AIOS_AST_NODE_KINDS.Program,
    compileRole: "sourceUnit",
    kernelSurface: "module",
    statusField: "jobs",
    requiredFields: ["type", "jobs"],
    childCollections: ["jobs"],
    recoverySemantics: ["continue-empty", "block-invalid-root"],
    handoffSemantics: ["diagnostic-summary", "descriptor-export-summary"],
  }),
  JobDeclaration: freezeNodeKindContract({
    kind: AIOS_AST_NODE_KINDS.JobDeclaration,
    compileRole: "kernelJob",
    kernelSurface: "jobDescriptor",
    statusField: "name",
    requiredFields: ["type", "name", "capabilities", "memory", "steps", "verifiers", "truthBoundaries"],
    childCollections: ["capabilities", "memory", "steps", "verifiers", "truthBoundaries"],
    recoverySemantics: ["rollback-default-halt", "adapter-step-status-rollup"],
    handoffSemantics: ["provider-contract", "lifecycle-controls", "export-state"],
  }),
  CapabilityDeclaration: freezeNodeKindContract({
    kind: AIOS_AST_NODE_KINDS.CapabilityDeclaration,
    compileRole: "capabilityContract",
    kernelSurface: "capability",
    statusField: "name",
    requiredFields: ["type", "name", "scope"],
    childCollections: [],
    recoverySemantics: ["scope-required", "external-boundary-adapter-required"],
    handoffSemantics: ["provider-capability-negotiation", "external-boundary-flag"],
  }),
  MemoryDeclaration: freezeNodeKindContract({
    kind: AIOS_AST_NODE_KINDS.MemoryDeclaration,
    compileRole: "memoryLaneContract",
    kernelSurface: "memory",
    statusField: "name",
    requiredFields: ["type", "name", "mode"],
    childCollections: [],
    recoverySemantics: ["mode-validation", "persistent-explicit-retention"],
    handoffSemantics: ["memory-read-write-index", "sync-ledger"],
  }),
  StepDeclaration: freezeNodeKindContract({
    kind: AIOS_AST_NODE_KINDS.StepDeclaration,
    compileRole: "adapterInvocation",
    kernelSurface: "step",
    statusField: "name",
    requiredFields: ["type", "name", "adapter", "args"],
    childCollections: [],
    recoverySemantics: ["adapter-status", "step-recovery-or-job-rollback", "memory-reference-check"],
    handoffSemantics: ["adapter-provider-operation", "status-handoff", "memory-sync"],
  }),
  VerifierDeclaration: freezeNodeKindContract({
    kind: AIOS_AST_NODE_KINDS.VerifierDeclaration,
    compileRole: "verifierClaim",
    kernelSurface: "verifier",
    statusField: "expression",
    requiredFields: ["type", "expression"],
    childCollections: [],
    recoverySemantics: ["claim-expression-required", "block-export-without-contract"],
    handoffSemantics: ["claim-contract", "truth-boundary-link"],
  }),
  TruthBoundaryDeclaration: freezeNodeKindContract({
    kind: AIOS_AST_NODE_KINDS.TruthBoundaryDeclaration,
    compileRole: "truthBoundary",
    kernelSurface: "truthBoundary",
    statusField: "name",
    requiredFields: ["type", "name", "source", "confidence"],
    childCollections: [],
    recoverySemantics: ["source-confidence-required", "reported-confidence-audit"],
    handoffSemantics: ["provider-truth-source", "audit-confidence"],
  }),
  RollbackDeclaration: freezeNodeKindContract({
    kind: AIOS_AST_NODE_KINDS.RollbackDeclaration,
    compileRole: "recoveryPolicy",
    kernelSurface: "rollback",
    statusField: "strategy",
    requiredFields: ["type", "strategy"],
    childCollections: [],
    recoverySemantics: ["halt-default", "compensate-target-required"],
    handoffSemantics: ["recovery-route", "adapter-failure-status"],
  }),
});

export const AIOS_MAILCHIMP_WORKFLOW_CONTROLS = Object.freeze({
  providerId: "mailchimp",
  requiredCapabilities: Object.freeze([
    "mailchimp:campaigns:write",
    "mailchimp:audiences:read",
  ]),
  optionalCapabilities: Object.freeze([
    "mailchimp:templates:read",
    "mailchimp:reports:read",
  ]),
  lifecycleControls: Object.freeze({
    enabled: Object.freeze({
      field: "enabled",
      defaultValue: true,
      blockedWhenFalse: true,
      recovery: "enable-mailchimp-campaign-workflow",
      nextAction: "enable-campaign-workflow",
    }),
    schedule: Object.freeze({
      field: "schedule",
      allowedModes: Object.freeze(["manual", "draft", "scheduled", "immediate"]),
      allowedWindowModes: Object.freeze(["anytime", "businessHours", "custom"]),
      recovery: "select-mailchimp-schedule-mode",
      nextAction: "select-campaign-schedule",
    }),
    audience: Object.freeze({
      fields: Object.freeze(["audienceId", "listId", "segmentId"]),
      recovery: "bind-mailchimp-audience",
      nextAction: "select-mailchimp-audience",
    }),
    tenantPermissions: Object.freeze({
      fields: Object.freeze(["tenantId", "workspaceId", "role", "permission"]),
      allowedRoles: Object.freeze(["owner", "admin", "marketer", "viewer", "service"]),
      writeRoles: Object.freeze(["owner", "admin", "marketer", "service"]),
      recovery: "bind-mailchimp-tenant-permissions",
      nextAction: "select-mailchimp-tenant-boundary",
    }),
  }),
});

export const AIOS_MAILCHIMP_PROVIDER_SERVICE_CONTRACTS = Object.freeze({
  campaignDraft: mailchimpServiceContract({
    service: "campaign",
    operation: "draft",
    requiredCapabilities: ["mailchimp:campaigns:write", "mailchimp:audiences:read"],
    syncChannel: "mailchimp-campaign-draft",
    idempotencyScope: "job:audience:schedule",
    recovery: "rebuild-mailchimp-draft-contract",
  }),
  audienceSegment: mailchimpServiceContract({
    service: "audience",
    operation: "segment",
    requiredCapabilities: ["mailchimp:audiences:read"],
    syncChannel: "mailchimp-audience-segment",
    idempotencyScope: "job:audience",
    recovery: "refresh-mailchimp-audience-binding",
  }),
  templateRender: mailchimpServiceContract({
    service: "template",
    operation: "render",
    requiredCapabilities: ["mailchimp:templates:read"],
    syncChannel: "mailchimp-template-render",
    idempotencyScope: "job:template",
    recovery: "refresh-mailchimp-template-preview",
  }),
  reportSnapshot: mailchimpServiceContract({
    service: "report",
    operation: "snapshot",
    requiredCapabilities: ["mailchimp:reports:read"],
    syncChannel: "mailchimp-report-snapshot",
    idempotencyScope: "job:campaign",
    recovery: "defer-mailchimp-report-sync",
  }),
});

export function listAstNodeKindContracts() {
  return Object.freeze(NODE_KIND_ORDER.map((kind) => AIOS_AST_NODE_KIND_CONTRACTS[kind]));
}

export function normalizeAstNodeKind(kindOrNode) {
  const kind = typeof kindOrNode === "string" ? kindOrNode : kindOrNode?.type;
  return NODE_KIND_ORDER.includes(kind) ? kind : null;
}

export function getAstNodeKindContract(kindOrNode) {
  const kind = normalizeAstNodeKind(kindOrNode);
  return kind ? AIOS_AST_NODE_KIND_CONTRACTS[kind] : null;
}

export function classifyAstNodeForKernel(node = {}) {
  const contract = getAstNodeKindContract(node);
  if (!contract) {
    return Object.freeze({
      ok: false,
      kind: node?.type ?? "Unknown",
      compileRole: "unknown",
      kernelSurface: "unknown",
      exportable: false,
      missingFields: Object.freeze(["type"]),
      status: "unsupported",
      recovery: Object.freeze(["emit-unsupported-node-diagnostic"]),
      handoff: Object.freeze([]),
    });
  }

  const missingFields = contract.requiredFields.filter((field) => node[field] === undefined || node[field] === null);
  return Object.freeze({
    ok: missingFields.length === 0,
    kind: contract.kind,
    compileRole: contract.compileRole,
    kernelSurface: contract.kernelSurface,
    exportable: missingFields.length === 0 && contract.kernelSurface !== "module",
    missingFields: Object.freeze(missingFields),
    status: missingFields.length === 0 ? "ready" : "needsDiagnostic",
    recovery: contract.recoverySemantics,
    handoff: contract.handoffSemantics,
  });
}

export function createAstNodeContractSnapshot(ast = {}) {
  const counters = Object.fromEntries(NODE_KIND_ORDER.map((kind) => [kind, 0]));
  const missing = [];
  const unsupported = [];

  visitAstNode(ast, (node) => {
    const classification = classifyAstNodeForKernel(node);
    if (classification.ok || classification.status === "needsDiagnostic") {
      counters[classification.kind] += 1;
      if (!classification.ok) {
        missing.push(Object.freeze({
          kind: classification.kind,
          statusField: getAstNodeKindContract(classification.kind)?.statusField ?? "type",
          missingFields: classification.missingFields,
          recovery: classification.recovery,
        }));
      }
    } else {
      unsupported.push(Object.freeze({
        kind: classification.kind,
        recovery: classification.recovery,
      }));
    }
  });

  return Object.freeze({
    ok: missing.length === 0 && unsupported.length === 0,
    counters: freezeSortedRecord(counters),
    missing: Object.freeze(missing),
    unsupported: Object.freeze(unsupported),
    contracts: listAstNodeKindContracts(),
  });
}

export function createAstNodeAnalyticsReport(ast = {}, options = {}) {
  const timeline = [];
  const byCompileRole = {};
  const byKernelSurface = {};
  const byStatus = {};
  const byHandoff = {};
  const byRecovery = {};
  const exportableKinds = {};
  const missingFieldCounters = {};
  let visited = 0;

  visitAstNode(ast, (node, path) => {
    const classification = classifyAstNodeForKernel(node);
    const contract = getAstNodeKindContract(classification.kind);
    const statusField = contract?.statusField ?? "type";
    const label = node?.[statusField] ?? node?.name ?? node?.type ?? classification.kind;
    visited += 1;
    incrementCounter(byCompileRole, classification.compileRole);
    incrementCounter(byKernelSurface, classification.kernelSurface);
    incrementCounter(byStatus, classification.status);
    for (const handoff of classification.handoff) incrementCounter(byHandoff, handoff);
    for (const recovery of classification.recovery) incrementCounter(byRecovery, recovery);
    for (const field of classification.missingFields) {
      incrementCounter(missingFieldCounters, `${classification.kind}.${field}`);
    }
    if (classification.exportable) incrementCounter(exportableKinds, classification.kind);

    timeline.push(Object.freeze({
      index: timeline.length,
      path: Object.freeze(path),
      kind: classification.kind,
      label: String(label),
      status: classification.status,
      exportable: classification.exportable,
      compileRole: classification.compileRole,
      kernelSurface: classification.kernelSurface,
      missingFields: classification.missingFields,
      handoff: classification.handoff,
    }));
  });

  const snapshot = createAstNodeContractSnapshot(ast);
  const history = createAstNodeHistorySnapshots([
    ...(Array.isArray(options.history) ? options.history : []),
    snapshot,
  ], options);
  const blockedCount = (byStatus.unsupported ?? 0) + (byStatus.needsDiagnostic ?? 0);

  return Object.freeze({
    ok: snapshot.ok,
    status: snapshot.ok ? "ready" : blockedCount ? "review" : "ready",
    visited,
    counters: snapshot.counters,
    analytics: Object.freeze({
      byCompileRole: freezeSortedRecord(byCompileRole),
      byKernelSurface: freezeSortedRecord(byKernelSurface),
      byStatus: freezeSortedRecord(byStatus),
      byHandoff: freezeSortedRecord(byHandoff),
      byRecovery: freezeSortedRecord(byRecovery),
      exportableKinds: freezeSortedRecord(exportableKinds),
      missingFieldCounters: freezeSortedRecord(missingFieldCounters),
    }),
    timeline: Object.freeze(timeline),
    history,
    exportSummary: createAstNodeExportSummary(snapshot, timeline, history, options),
  });
}

export function createMailchimpWorkflowState(ast = {}, settings = {}) {
  const jobs = Array.isArray(ast.jobs) ? ast.jobs : [];
  const workflowSettings = normalizeMailchimpWorkflowSettings(settings);
  const jobStates = jobs.map((job, index) => createMailchimpJobWorkflowState(job, index, workflowSettings));
  const issueCounters = {};
  const issues = [];
  const handoffChannels = {};

  for (const jobState of jobStates) {
    for (const issue of jobState.issues) {
      issues.push(issue);
      incrementCounter(issueCounters, issue.code);
    }
    for (const channel of jobState.handoff.channels) {
      incrementCounter(handoffChannels, channel);
    }
  }

  const blocked = issues.some((issue) => issue.status === "blocked");
  const review = issues.some((issue) => issue.status === "review");
  const hasWorkflow = jobStates.some((job) => job.detected);
  const tenantBoundary = createMailchimpTenantBoundaryState(jobStates, workflowSettings);
  const status = blocked
    || tenantBoundary.status === "blocked"
    ? "blocked"
    : review
      || tenantBoundary.status === "review"
      ? "review"
      : hasWorkflow
        ? "ready"
        : "idle";

  return Object.freeze({
    ok: status === "ready" || status === "idle",
    status,
    providerId: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    detected: hasWorkflow,
    jobCount: jobStates.length,
    workflowJobCount: jobStates.filter((job) => job.detected).length,
    requiredCapabilities: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.requiredCapabilities,
    optionalCapabilities: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.optionalCapabilities,
    settings: workflowSettings.publicSettings,
    tenantBoundary,
    jobs: Object.freeze(jobStates),
    issues: Object.freeze(issues),
    issueCounters: freezeSortedRecord(issueCounters),
    providerContract: createMailchimpProviderServiceContract({
      status,
      providerId: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
      jobs: jobStates,
      detected: hasWorkflow,
      tenantBoundary,
      requiredCapabilities: workflowSettings.publicSettings.requiredCapabilities,
      optionalCapabilities: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.optionalCapabilities,
    }, {
      revision: settings.revision,
      externalRunId: settings.externalRunId,
    }),
    handoff: Object.freeze({
      status,
      channels: Object.freeze(Object.keys(handoffChannels).sort()),
      exportAllowed: (status === "ready" || status === "idle") && tenantBoundary.exportAllowed,
      nextAction: tenantBoundary.status === "blocked" || tenantBoundary.status === "review"
        ? tenantBoundary.nextAction
        : selectMailchimpWorkflowNextAction(status, issues, hasWorkflow),
    }),
  });
}

export function createMailchimpWorkflowPreviewContract(ast = {}, settings = {}) {
  const workflowState = createMailchimpWorkflowState(ast, settings);
  const acceptedJobs = new Set((Array.isArray(settings.acceptedMailchimpJobNames)
    ? settings.acceptedMailchimpJobNames
    : [])
    .map((name) => String(name).trim())
    .filter(Boolean));
  const visibleJobs = workflowState.jobs
    .filter((job) => job.detected || settings.includeIdleJobs === true)
    .map((job) => createMailchimpWorkflowPreviewJob(job, acceptedJobs));
  const blockedJobs = visibleJobs.filter((job) => job.status === "blocked");
  const reviewJobs = visibleJobs.filter((job) => job.status === "review");
  const pendingAcceptance = visibleJobs.filter((job) => job.acceptanceState === "pending");
  const requireAcceptance = settings.requireMailchimpWorkflowAcceptance !== false && visibleJobs.length > 0;
  const status = workflowState.status === "blocked" || blockedJobs.length
    ? "blocked"
    : workflowState.status === "review" || reviewJobs.length
      ? "review"
      : requireAcceptance && pendingAcceptance.length
        ? "needsAcceptance"
        : workflowState.status;
  const validationSummary = createMailchimpWorkflowValidationSummary(workflowState, visibleJobs);

  return Object.freeze({
    ok: status === "ready" || status === "idle",
    status,
    providerId: workflowState.providerId,
    detected: workflowState.detected,
    previewVersion: "mailchimp-workflow-preview.v1",
    validationSummary,
    preview: Object.freeze({
      title: workflowState.detected ? "Mailchimp workflow preview" : "Mailchimp workflow not detected",
      detail: createMailchimpWorkflowPreviewDetail(status, visibleJobs, validationSummary),
      jobs: Object.freeze(visibleJobs),
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pendingAcceptance.length === 0),
      requiredJobNames: Object.freeze(visibleJobs.map((job) => job.jobName).sort()),
      acceptedJobNames: Object.freeze([...acceptedJobs].sort()),
      pendingJobNames: Object.freeze(requireAcceptance ? pendingAcceptance.map((job) => job.jobName).sort() : []),
      acceptedAt: settings.acceptedAt ?? null,
    }),
    readiness: Object.freeze({
      exportAllowed: status === "ready" || status === "idle",
      blockedCount: blockedJobs.length,
      reviewCount: reviewJobs.length,
      pendingAcceptanceCount: pendingAcceptance.length,
      nextAction: selectMailchimpWorkflowPreviewNextAction(status, workflowState, blockedJobs, reviewJobs, pendingAcceptance),
    }),
    nextSteps: Object.freeze(createMailchimpWorkflowPreviewNextSteps(status, workflowState, visibleJobs, pendingAcceptance)),
    workflowState,
  });
}

export function createMailchimpAstExportEvidence(ast = {}, settings = {}) {
  const analyticsReport = createAstNodeAnalyticsReport(ast, {
    fileName: settings.fileName,
    history: settings.astHistory,
    historyLimit: settings.astHistoryLimit,
    includeTimeline: true,
  });
  const workflowState = createMailchimpWorkflowState(ast, settings);
  const workflowPreview = createMailchimpWorkflowPreviewContract(ast, settings);
  const detectedTimeline = analyticsReport.timeline
    .filter((event) => event.kind === AIOS_AST_NODE_KINDS.JobDeclaration)
    .map((event) => createMailchimpAstTimelineEvent(event, workflowState));
  const exportLanes = createMailchimpAstExportLanes(analyticsReport, workflowState, workflowPreview);
  const blockedLanes = exportLanes.filter((lane) => lane.status === "blocked");
  const reviewLanes = exportLanes.filter((lane) => lane.status === "review" || lane.status === "needsAcceptance");
  const status = blockedLanes.length
    ? "blocked"
    : reviewLanes.length
      ? "review"
      : workflowState.detected
        ? "ready"
        : analyticsReport.exportSummary.status;

  return Object.freeze({
    version: "mailchimp-ast-export-evidence.v1",
    status,
    ok: status === "ready" || status === "empty",
    fileName: settings.fileName ?? "inline.aios",
    providerId: workflowState.providerId,
    detected: workflowState.detected,
    counters: Object.freeze({
      astByKind: analyticsReport.counters,
      astByStatus: analyticsReport.analytics.byStatus,
      astByHandoff: analyticsReport.analytics.byHandoff,
      workflowIssuesByCode: workflowState.issueCounters,
      workflowJobsByStatus: freezeSortedRecord(countWorkflowJobsBy(workflowState.jobs, "status")),
      providerOperationsByStatus: workflowState.providerContract.syncMetadata.byStatus,
      providerOperationsByService: workflowState.providerContract.syncMetadata.byService,
      tenantBoundaryByStatus: workflowState.tenantBoundary.byStatus,
    }),
    totals: Object.freeze({
      astVisitedCount: analyticsReport.visited,
      astExportableCount: analyticsReport.exportSummary.exportableCount,
      astBlockedCount: analyticsReport.exportSummary.blockedCount,
      workflowJobCount: workflowState.workflowJobCount,
      workflowIssueCount: workflowState.issues.length,
      providerOperationCount: workflowState.providerContract.operations.length,
      tenantAuditEventCount: workflowState.tenantBoundary.audit.eventCount,
      pendingWorkflowAcceptanceCount: workflowPreview.acceptance.pendingJobNames.length,
    }),
    exportLanes: Object.freeze(exportLanes),
    timeline: Object.freeze(detectedTimeline),
    history: analyticsReport.history,
    exportSummary: Object.freeze({
      status,
      exportAllowed: analyticsReport.exportSummary.exportAllowed
        && workflowState.handoff.exportAllowed
        && workflowPreview.acceptance.acceptable
        && blockedLanes.length === 0,
      astSummaryVersion: analyticsReport.exportSummary.summaryVersion,
      mailchimpPreviewVersion: workflowPreview.previewVersion,
      syncKey: workflowState.providerContract.syncMetadata.syncKey,
      serviceContractVersion: workflowState.providerContract.serviceContractVersion,
      blockedLaneIds: Object.freeze(blockedLanes.map((lane) => lane.id).sort()),
      reviewLaneIds: Object.freeze(reviewLanes.map((lane) => lane.id).sort()),
      historyDelta: analyticsReport.history.delta,
      nextAction: blockedLanes[0]?.nextAction
        ?? reviewLanes[0]?.nextAction
        ?? workflowPreview.readiness.nextAction
        ?? analyticsReport.exportSummary.nextAction,
    }),
  });
}

export function createMailchimpAstExportBatchSummary(ast = {}, settings = {}) {
  const evidence = settings.astEvidence?.version === "mailchimp-ast-export-evidence.v1"
    ? settings.astEvidence
    : createMailchimpAstExportEvidence(ast, settings);
  const workflowState = settings.workflowState ?? evidence.workflowState ?? createMailchimpWorkflowState(ast, settings);
  const timelineLimit = normalizePositiveLimit(settings.timelineLimit, 12);
  const historyLimit = normalizePositiveLimit(settings.historyLimit ?? settings.astHistoryLimit, 6);
  const exportLaneCounters = {};
  const timelineCounters = {};
  const historyRows = createMailchimpAstBatchHistoryRows(evidence.history, historyLimit);
  const exportLanes = Array.isArray(evidence.exportLanes) ? evidence.exportLanes : [];
  const timeline = Array.isArray(evidence.timeline) ? evidence.timeline : [];

  for (const lane of exportLanes) {
    incrementCounter(exportLaneCounters, lane.status ?? "unknown");
    incrementCounter(exportLaneCounters, `next:${lane.nextAction ?? "none"}`);
  }
  for (const event of timeline) {
    incrementCounter(timelineCounters, event.status ?? "unknown");
    incrementCounter(timelineCounters, `job:${event.jobName ?? event.label ?? "unknown"}`);
  }

  const blockedLanes = exportLanes.filter((lane) => lane.status === "blocked");
  const reviewLanes = exportLanes.filter((lane) => lane.status === "review" || lane.status === "needsAcceptance");
  const pendingHistory = historyRows.filter((row) => row.status === "changed" || row.status === "new");
  const status = evidence.status === "blocked" || blockedLanes.length
    ? "blocked"
    : reviewLanes.length || pendingHistory.length
      ? "review"
      : evidence.exportSummary?.exportAllowed === false
        ? "pending"
        : evidence.status ?? "ready";

  return Object.freeze({
    version: "mailchimp-ast-export-batch-summary.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "empty",
    providerId: evidence.providerId ?? workflowState.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    fileName: evidence.fileName ?? settings.fileName ?? "inline.aios",
    revision: settings.revision ?? "working",
    detected: evidence.detected ?? Boolean(workflowState.detected),
    exportAllowed: status === "ready" || status === "idle" || status === "empty",
    counters: Object.freeze({
      exportLaneByStatus: freezeSortedRecord(exportLaneCounters),
      timelineByStatus: freezeSortedRecord(timelineCounters),
      astByKind: evidence.counters?.astByKind ?? {},
      astByStatus: evidence.counters?.astByStatus ?? {},
      workflowIssuesByCode: evidence.counters?.workflowIssuesByCode ?? {},
    }),
    totals: Object.freeze({
      exportLaneCount: exportLanes.length,
      blockedLaneCount: blockedLanes.length,
      reviewLaneCount: reviewLanes.length,
      timelineEventCount: timeline.length,
      historySnapshotCount: historyRows.length,
      changedHistoryCount: pendingHistory.length,
      workflowJobCount: evidence.totals?.workflowJobCount ?? workflowState.workflowJobCount ?? 0,
      providerOperationCount: evidence.totals?.providerOperationCount ?? workflowState.providerContract?.operations?.length ?? 0,
    }),
    lanes: Object.freeze(exportLanes.map((lane) => Object.freeze({
      id: lane.id,
      status: lane.status,
      label: lane.label,
      detail: lane.detail,
      nextAction: lane.nextAction,
    }))),
    timeline: Object.freeze(timeline.slice(0, timelineLimit).map((event, index) => Object.freeze({
      index,
      jobName: event.jobName ?? event.label ?? null,
      kind: event.kind ?? AIOS_AST_NODE_KINDS.JobDeclaration,
      status: event.status ?? "unknown",
      exportable: event.exportable !== false,
      nextAction: event.nextAction ?? evidence.exportSummary?.nextAction ?? "review-mailchimp-ast-export",
    }))),
    history: Object.freeze(historyRows),
    handoff: Object.freeze({
      channel: "mailchimp-ast-export-batch",
      syncKey: [
        evidence.exportSummary?.syncKey ?? workflowState.providerContract?.syncMetadata?.syncKey ?? "mailchimp-ast",
        evidence.exportSummary?.historyDelta?.status ?? evidence.history?.delta?.status ?? "history-unbound",
        settings.revision ?? "working",
      ].join("|"),
      restartSafe: blockedLanes.length === 0,
      nextAction: blockedLanes[0]?.nextAction
        ?? reviewLanes[0]?.nextAction
        ?? pendingHistory[0]?.nextAction
        ?? evidence.exportSummary?.nextAction
        ?? "publish-mailchimp-ast-export-batch",
    }),
    evidence,
  });
}

export function createMailchimpCampaignExportQueue(ast = {}, settings = {}) {
  const evidence = settings.astEvidence?.version === "mailchimp-ast-export-evidence.v1"
    ? settings.astEvidence
    : createMailchimpAstExportEvidence(ast, settings);
  const batchSummary = settings.astExportBatchSummary?.version === "mailchimp-ast-export-batch-summary.v1"
    ? settings.astExportBatchSummary
    : createMailchimpAstExportBatchSummary(ast, {
        ...settings,
        astEvidence: evidence,
      });
  const workflowState = settings.workflowState ?? createMailchimpWorkflowState(ast, settings);
  const acceptedJobNames = normalizeStringSet(settings.acceptedMailchimpExportJobNames ?? settings.acceptedMailchimpJobNames);
  const queuedJobNames = normalizeStringSet(settings.queuedMailchimpExportJobNames);
  const exportedJobNames = normalizeStringSet(settings.exportedMailchimpJobNames);
  const failedJobNames = normalizeStringSet(settings.failedMailchimpExportJobNames);
  const queueRows = workflowState.jobs
    .filter((job) => job.detected)
    .map((job, index) => createMailchimpCampaignExportQueueRow(job, {
      index,
      evidence,
      batchSummary,
      acceptedJobNames,
      queuedJobNames,
      exportedJobNames,
      failedJobNames,
      requireAcceptance: settings.requireMailchimpCampaignExportAcceptance,
      revision: settings.revision,
      fileName: evidence.fileName ?? settings.fileName ?? "inline.aios",
    }));
  const blockedRows = queueRows.filter((row) => row.status === "blocked");
  const failedRows = queueRows.filter((row) => row.status === "failed");
  const pendingRows = queueRows.filter((row) => row.status === "pending" || row.status === "queued");
  const reviewRows = queueRows.filter((row) => row.status === "review");
  const readyRows = queueRows.filter((row) => row.status === "ready" || row.status === "exported");
  const requireAcceptance = settings.requireMailchimpCampaignExportAcceptance === true;
  const status = blockedRows.length || failedRows.length || batchSummary.status === "blocked"
    ? "blocked"
    : requireAcceptance && queueRows.some((row) => row.acceptanceState === "pending")
      ? "pending"
      : pendingRows.length
        ? "pending"
        : reviewRows.length || batchSummary.status === "review"
          ? "review"
          : queueRows.length
            ? "ready"
            : "idle";
  const counters = createMailchimpCampaignExportQueueCounters(queueRows);

  return Object.freeze({
    version: "mailchimp-campaign-export-queue.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    providerId: evidence.providerId ?? workflowState.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    fileName: evidence.fileName ?? settings.fileName ?? "inline.aios",
    revision: settings.revision ?? "working",
    exportAllowed: (status === "ready" || status === "idle" || status === "review")
      && evidence.exportSummary?.exportAllowed !== false
      && batchSummary.exportAllowed !== false,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(counters.byStatus),
      byScheduleMode: freezeSortedRecord(counters.byScheduleMode),
      byTenantStatus: freezeSortedRecord(counters.byTenantStatus),
      byAcceptance: freezeSortedRecord(counters.byAcceptance),
      byOperationStatus: freezeSortedRecord(counters.byOperationStatus),
    }),
    totals: Object.freeze({
      queueCount: queueRows.length,
      readyCount: readyRows.length,
      blockedCount: blockedRows.length,
      failedCount: failedRows.length,
      pendingCount: pendingRows.length,
      reviewCount: reviewRows.length,
      operationCount: queueRows.reduce((sum, row) => sum + row.operationCount, 0),
      exportableAstCount: evidence.totals?.astExportableCount ?? 0,
      batchLaneCount: batchSummary.totals?.exportLaneCount ?? 0,
    }),
    rows: Object.freeze(queueRows.sort(compareMailchimpCampaignExportQueueRows)),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: !requireAcceptance || queueRows.every((row) => row.acceptanceState !== "pending"),
      requiredJobNames: Object.freeze(queueRows.map((row) => row.jobName).sort()),
      acceptedJobNames: Object.freeze([...acceptedJobNames].sort()),
      pendingJobNames: Object.freeze(requireAcceptance
        ? queueRows.filter((row) => row.acceptanceState === "pending").map((row) => row.jobName).sort()
        : []),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/campaign-export/recovery"
        : status === "pending"
          ? "mailchimp/campaign-export/acceptance"
          : "mailchimp/campaign-export/queue",
      restartSafe: blockedRows.length === 0 && failedRows.length === 0,
      blockedJobNames: Object.freeze(blockedRows.map((row) => row.jobName).sort()),
      pendingJobNames: Object.freeze(pendingRows.map((row) => row.jobName).sort()),
      reviewJobNames: Object.freeze(reviewRows.map((row) => row.jobName).sort()),
      idempotencyKeys: Object.freeze(queueRows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blockedRows[0]?.nextAction
        ?? failedRows[0]?.nextAction
        ?? pendingRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? batchSummary.handoff?.nextAction
        ?? "publish-mailchimp-campaign-export-queue",
    }),
    exportSummary: Object.freeze({
      status,
      exportAllowed: (status === "ready" || status === "idle" || status === "review")
        && evidence.exportSummary?.exportAllowed !== false
        && batchSummary.exportAllowed !== false,
      syncKey: [
        batchSummary.handoff?.syncKey ?? evidence.exportSummary?.syncKey ?? "mailchimp-ast-export",
        settings.revision ?? "working",
        queueRows.map((row) => row.status).join(".") || "idle",
      ].join("|"),
      nextAction: status === "ready" || status === "idle" || status === "review"
        ? "publish-mailchimp-campaign-export-queue"
        : "resume-mailchimp-campaign-export-queue",
    }),
    evidence,
    batchSummary,
  });
}

export function createMailchimpLaunchGateContract(ast = {}, settings = {}) {
  const workflowState = settings.workflowState ?? createMailchimpWorkflowState(ast, settings);
  const workflowPreview = settings.workflowPreview ?? createMailchimpWorkflowPreviewContract(ast, settings);
  const astEvidence = settings.astEvidence ?? createMailchimpAstExportEvidence(ast, settings);
  const requiredGateIds = new Set(Array.isArray(settings.requiredLaunchGateIds)
    ? settings.requiredLaunchGateIds.map((id) => String(id).trim()).filter(Boolean)
    : [
        "workflow-enabled",
        "audience-bound",
        "schedule-ready",
        "tenant-boundary",
        "provider-operations",
        "workflow-acceptance",
      ]);
  const gates = workflowState.jobs
    .filter((job) => job.detected || settings.includeIdleJobs === true)
    .flatMap((job) => createMailchimpJobLaunchGates(job, workflowPreview, requiredGateIds));
  const blocked = gates.filter((gate) => gate.status === "blocked");
  const review = gates.filter((gate) => gate.status === "review");
  const pending = gates.filter((gate) => gate.status === "pending");
  const ready = gates.filter((gate) => gate.status === "ready");
  const status = !workflowState.detected && gates.length === 0
    ? "idle"
    : blocked.length || astEvidence.exportSummary.exportAllowed === false
      ? "blocked"
      : review.length
        ? "review"
        : pending.length
          ? "pending"
          : "ready";

  return Object.freeze({
    version: "mailchimp-launch-gate.v1",
    providerId: workflowState.providerId,
    status,
    ok: status === "ready" || status === "idle",
    detected: workflowState.detected,
    exportAllowed: status === "ready" || status === "idle",
    requiredGateIds: Object.freeze([...requiredGateIds].sort()),
    gates: Object.freeze(gates.sort(compareMailchimpLaunchGates)),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countLaunchGateField(gates, "status")),
      byKind: freezeSortedRecord(countLaunchGateField(gates, "kind")),
      byJob: freezeSortedRecord(countLaunchGateField(gates, "jobName")),
    }),
    totals: Object.freeze({
      gateCount: gates.length,
      readyGateCount: ready.length,
      pendingGateCount: pending.length,
      reviewGateCount: review.length,
      blockedGateCount: blocked.length,
      workflowJobCount: workflowState.workflowJobCount,
      providerOperationCount: workflowState.providerContract.operations.length,
      astBlockedLaneCount: astEvidence.exportSummary.blockedLaneIds.length,
    }),
    recovery: Object.freeze({
      blockedGateIds: Object.freeze(blocked.map((gate) => gate.id).sort()),
      pendingGateIds: Object.freeze(pending.map((gate) => gate.id).sort()),
      reviewGateIds: Object.freeze(review.map((gate) => gate.id).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? workflowPreview.readiness.nextAction
        ?? astEvidence.exportSummary.nextAction,
    }),
    handoff: Object.freeze({
      channel: "mailchimp-launch-gate",
      syncKey: [
        workflowState.providerContract.syncMetadata.syncKey,
        astEvidence.exportSummary.syncKey,
        settings.revision ?? "working",
      ].join("|"),
      exportAllowed: status === "ready" || status === "idle",
      nextAction: status === "ready"
        ? "queue-mailchimp-launch-handoff"
        : status === "idle"
          ? "skip-mailchimp-launch-handoff"
          : blocked[0]?.nextAction ?? pending[0]?.nextAction ?? review[0]?.nextAction,
    }),
  });
}

export function createMailchimpClientRuntimeTargets(ast = {}, settings = {}) {
  const workflowState = settings.workflowState ?? createMailchimpWorkflowState(ast, settings);
  const workflowPreview = settings.workflowPreview ?? createMailchimpWorkflowPreviewContract(ast, settings);
  const launchGate = settings.launchGate ?? createMailchimpLaunchGateContract(ast, {
    ...settings,
    workflowState,
    workflowPreview,
  });
  const acceptedJobNames = new Set((Array.isArray(settings.acceptedMailchimpJobNames)
    ? settings.acceptedMailchimpJobNames
    : workflowPreview.acceptance?.acceptedJobNames ?? [])
    .map((name) => String(name).trim())
    .filter(Boolean));
  const acceptedOperationIds = new Set((Array.isArray(settings.acceptedMailchimpOperationIds)
    ? settings.acceptedMailchimpOperationIds
    : [])
    .map((id) => String(id).trim())
    .filter(Boolean));
  const operationByJobName = groupMailchimpOperationsByJobName(workflowState.providerContract?.operations);
  const gateByJobName = groupMailchimpLaunchGatesByJobName(launchGate.gates);
  const targets = workflowState.jobs
    .filter((job) => job.detected || settings.includeIdleJobs === true)
    .map((job, index) => createMailchimpClientRuntimeTarget(job, index, {
      workflowState,
      workflowPreview,
      launchGate,
      acceptedJobNames,
      acceptedOperationIds,
      operations: operationByJobName.get(job.jobName) ?? [],
      gates: gateByJobName.get(job.jobName) ?? [],
      revision: settings.revision ?? "working",
    }));
  const blocked = targets.filter((target) => target.status === "blocked");
  const pending = targets.filter((target) => target.status === "pending" || target.status === "needsAcceptance");
  const review = targets.filter((target) => target.status === "review");
  const status = launchGate.status === "blocked" || blocked.length
    ? "blocked"
    : pending.length || launchGate.status === "pending"
      ? "pending"
      : review.length || workflowState.status === "review"
        ? "review"
        : workflowState.detected
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-client-runtime-targets.v1",
    providerId: workflowState.providerId,
    status,
    ok: status === "ready" || status === "idle",
    detected: workflowState.detected,
    exportAllowed: status === "ready" || status === "idle",
    syncKey: [
      workflowState.providerContract.syncMetadata.syncKey,
      launchGate.handoff.syncKey,
      settings.revision ?? "working",
    ].join("|"),
    targets: Object.freeze(targets.sort(compareMailchimpClientRuntimeTargets)),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpRuntimeTargets(targets, "status")),
      byRoute: freezeSortedRecord(countMailchimpRuntimeTargets(targets, "route")),
      byScheduleMode: freezeSortedRecord(countMailchimpRuntimeTargets(targets, "scheduleMode")),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/runtime/recovery"
        : status === "pending"
          ? "mailchimp/runtime/acceptance"
          : status === "review"
            ? "mailchimp/runtime/review"
            : "mailchimp/runtime/summary",
      restartSafe: blocked.every((target) => target.restartSafe),
      blockedTargetIds: Object.freeze(blocked.map((target) => target.id).sort()),
      pendingTargetIds: Object.freeze(pending.map((target) => target.id).sort()),
      reviewTargetIds: Object.freeze(review.map((target) => target.id).sort()),
      idempotencyKeys: Object.freeze(targets
        .map((target) => target.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? launchGate.handoff.nextAction,
    }),
    workflowPreview,
    launchGate,
  });
}

export function createMailchimpTenantPermissionBoundaryContract(astOrWorkflowState = {}, settings = {}) {
  const workflowState = astOrWorkflowState?.providerId === AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId
    && Array.isArray(astOrWorkflowState.jobs)
    ? astOrWorkflowState
    : createMailchimpWorkflowState(astOrWorkflowState, settings);
  const tenantBoundary = workflowState.tenantBoundary ?? createMailchimpTenantBoundaryState(workflowState.jobs, settings);
  const operationRows = createMailchimpTenantBoundaryOperationRows(workflowState, tenantBoundary);
  const auditRows = createMailchimpTenantBoundaryAuditRows(tenantBoundary, operationRows, {
    revision: settings.revision ?? "working",
    externalRunId: settings.externalRunId,
  });
  const blocked = auditRows.filter((row) => row.status === "blocked");
  const review = auditRows.filter((row) => row.status === "review");
  const idle = !workflowState.detected && auditRows.length === 0;
  const status = tenantBoundary.status === "blocked" || blocked.length
    ? "blocked"
    : tenantBoundary.status === "review" || review.length
      ? "review"
      : idle
        ? "idle"
        : "ready";

  return Object.freeze({
    version: "mailchimp-tenant-permission-boundary.v1",
    providerId: workflowState.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    status,
    ok: status === "ready" || status === "idle",
    detected: Boolean(workflowState.detected),
    exportAllowed: status === "ready" || status === "idle",
    required: tenantBoundary.required,
    syncKey: [
      workflowState.providerContract?.syncMetadata?.syncKey ?? "mailchimp-workflow",
      tenantBoundary.defaultTenantId ?? "tenant-unbound",
      tenantBoundary.defaultWorkspaceId ?? "workspace-unbound",
      settings.revision ?? "working",
    ].join("|"),
    policy: Object.freeze({
      defaultTenantId: tenantBoundary.defaultTenantId,
      defaultWorkspaceId: tenantBoundary.defaultWorkspaceId,
      allowedTenantIds: tenantBoundary.allowedTenantIds,
      allowedWorkspaceIds: tenantBoundary.allowedWorkspaceIds,
      allowedRoles: tenantBoundary.allowedRoles,
      writeRoles: tenantBoundary.writeRoles,
    }),
    counters: Object.freeze({
      byStatus: tenantBoundary.byStatus,
      byTenant: tenantBoundary.byTenant,
      byWorkspace: tenantBoundary.byWorkspace,
      byRole: tenantBoundary.byRole,
      operationByStatus: freezeSortedRecord(countMailchimpBoundaryRows(operationRows, "status")),
      auditByReason: freezeSortedRecord(countMailchimpBoundaryReasons(auditRows)),
    }),
    totals: Object.freeze({
      jobCount: tenantBoundary.jobCount,
      boundaryCount: tenantBoundary.boundaries.length,
      operationCount: operationRows.length,
      auditEventCount: auditRows.length,
      blockedCount: blocked.length,
      reviewCount: review.length,
    }),
    operations: Object.freeze(operationRows),
    auditRows: Object.freeze(auditRows),
    recovery: Object.freeze({
      blockedJobNames: Object.freeze([...new Set(blocked.map((row) => row.jobName).filter(Boolean))].sort()),
      reviewJobNames: Object.freeze([...new Set(review.map((row) => row.jobName).filter(Boolean))].sort()),
      blockedOperationIds: Object.freeze(blocked.map((row) => row.operationId).filter(Boolean).sort()),
      reviewOperationIds: Object.freeze(review.map((row) => row.operationId).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? review[0]?.nextAction
        ?? tenantBoundary.nextAction,
    }),
    handoff: Object.freeze({
      channel: "mailchimp-tenant-permission-audit",
      route: status === "blocked"
        ? "mailchimp/tenant-boundary/recovery"
        : status === "review"
          ? "mailchimp/tenant-boundary/review"
          : "mailchimp/tenant-boundary/summary",
      restartSafe: blocked.length === 0,
      exportAllowed: status === "ready" || status === "idle",
      idempotencyKeys: Object.freeze(auditRows
        .map((row) => row.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: status === "ready"
        ? "publish-mailchimp-tenant-boundary"
        : status === "idle"
          ? "skip-mailchimp-tenant-boundary"
          : blocked[0]?.nextAction ?? review[0]?.nextAction ?? tenantBoundary.nextAction,
    }),
    tenantBoundary,
  });
}

export function listMailchimpProviderServiceContracts() {
  return Object.freeze(Object.values(AIOS_MAILCHIMP_PROVIDER_SERVICE_CONTRACTS)
    .sort((left, right) => left.service.localeCompare(right.service) || left.operation.localeCompare(right.operation)));
}

export function createMailchimpProviderServiceContract(workflowState = {}, options = {}) {
  const jobs = Array.isArray(workflowState.jobs) ? workflowState.jobs : [];
  const detectedJobs = jobs.filter((job) => job.detected);
  const operations = detectedJobs.flatMap((job) => Array.isArray(job.serviceOperations) ? job.serviceOperations : []);
  const capabilityNegotiation = negotiateMailchimpProviderCapabilities(detectedJobs, workflowState, options);
  const blockedCapabilities = capabilityNegotiation.filter((capability) => capability.status === "blocked");
  const blockedOperations = operations.filter((operation) => operation.status === "blocked");
  const reviewOperations = operations.filter((operation) => operation.status === "review");
  const tenantBoundary = workflowState.tenantBoundary ?? createMailchimpTenantBoundaryState(jobs, {});
  const syncMetadata = createMailchimpProviderSyncMetadata(detectedJobs, operations, {
    revision: options.revision,
    externalRunId: options.externalRunId,
    providerId: workflowState.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    tenantBoundary,
  });
  const status = !workflowState.detected && detectedJobs.length === 0
    ? "idle"
    : tenantBoundary.status === "blocked" || blockedCapabilities.length || blockedOperations.length
      ? "blocked"
      : tenantBoundary.status === "review" || reviewOperations.length
        ? "review"
        : "ready";

  return Object.freeze({
    ok: status === "ready" || status === "idle",
    status,
    providerId: workflowState.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    detected: detectedJobs.length > 0 || Boolean(workflowState.detected),
    serviceContractVersion: "mailchimp-provider-service.v1",
    services: listMailchimpProviderServiceContracts(),
    tenantBoundary,
    capabilityNegotiation,
    operations: Object.freeze(operations.sort(compareMailchimpOperations)),
    syncMetadata,
    externalHandoff: Object.freeze({
      status,
      syncKey: syncMetadata.syncKey,
      externalRunId: syncMetadata.externalRunId,
      operationCount: operations.length,
      blockedOperationCount: blockedOperations.length,
      tenantBoundaryStatus: tenantBoundary.status,
      tenantAuditEventCount: tenantBoundary.audit.eventCount,
      channels: Object.freeze([...new Set(operations.map((operation) => operation.syncChannel))].sort()),
      commandContractStatus: createMailchimpProviderCommandContract({
        ...workflowState,
        providerContract: { operations, syncMetadata },
      }, options).status,
      nextAction: tenantBoundary.status === "blocked" || tenantBoundary.status === "review"
        ? tenantBoundary.nextAction
        : selectMailchimpProviderServiceNextAction(status, blockedCapabilities, blockedOperations, reviewOperations),
    }),
  });
}

export function createMailchimpProviderCommandContract(workflowState = {}, options = {}) {
  const serviceContract = workflowState.providerContract ?? {};
  const operations = Array.isArray(serviceContract.operations)
    ? serviceContract.operations
    : Array.isArray(workflowState.jobs)
      ? workflowState.jobs.flatMap((job) => job.serviceOperations ?? [])
      : [];
  const acceptedOperationIds = normalizeStringSet(options.acceptedOperationIds);
  const queuedCommandIds = normalizeStringSet(options.queuedCommandIds);
  const failedCommandIds = normalizeStringSet(options.failedCommandIds);
  const retryAfterByOperationId = normalizeStringRecord(options.retryAfterByOperationId);
  const attemptByOperationId = normalizeNumberRecord(options.attemptByOperationId);
  const requireAcceptance = options.requireAcceptance === true;
  const degradedMode = options.degradedMode === true;
  const commands = operations.map((operation) => createMailchimpProviderCommand(operation, {
    acceptedOperationIds,
    queuedCommandIds,
    failedCommandIds,
    retryAfterByOperationId,
    attemptByOperationId,
    requireAcceptance,
    degradedMode,
    serviceSyncKey: serviceContract.syncMetadata?.syncKey ?? workflowState.providerContract?.syncMetadata?.syncKey ?? "mailchimp-working",
  }));
  const blockedCommands = commands.filter((command) => command.status === "blocked");
  const retryCommands = commands.filter((command) => command.status === "retry");
  const pendingCommands = commands.filter((command) => command.status === "pending");
  const queuedCommands = commands.filter((command) => command.status === "queued");
  const recoverySnapshot = createMailchimpProviderCommandRecoverySnapshot(commands, {
    providerId: workflowState.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    serviceSyncKey: serviceContract.syncMetadata?.syncKey ?? workflowState.providerContract?.syncMetadata?.syncKey,
    externalRunId: serviceContract.syncMetadata?.externalRunId,
    revision: options.revision,
  });
  const operationalHealth = createMailchimpProviderOperationalHealth(commands, recoverySnapshot, {
    providerId: workflowState.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    externalRunId: serviceContract.syncMetadata?.externalRunId,
    revision: options.revision,
    degradedMode,
    maxRetryAttempts: options.maxRetryAttempts,
    retryBaseSeconds: options.retryBaseSeconds,
  });
  const status = !workflowState.detected && commands.length === 0
    ? "idle"
    : blockedCommands.length
      || operationalHealth.status === "blocked"
      ? "blocked"
    : retryCommands.length
      || operationalHealth.status === "degraded"
        ? "degraded"
        : pendingCommands.length
          ? "pending"
          : queuedCommands.length
            ? "queued"
            : "ready";

  return Object.freeze({
    ok: status === "ready" || status === "idle" || status === "queued",
    status,
    providerId: workflowState.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    commandContractVersion: "mailchimp-provider-command.v1",
    requireAcceptance,
    degradedMode,
    operationalHealth,
    operationCount: operations.length,
    commandCount: commands.length,
    restartSafe: recoverySnapshot.restartSafe && operationalHealth.restartSafe,
    commands: Object.freeze(commands.sort(compareMailchimpProviderCommands)),
    summary: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpCommandField(commands, "status")),
      byService: freezeSortedRecord(countMailchimpCommandField(commands, "service")),
      healthStatus: operationalHealth.status,
      healthIssueCount: operationalHealth.issueCount,
      blockedCommandIds: Object.freeze(blockedCommands.map((command) => command.id).sort()),
      retryCommandIds: Object.freeze(retryCommands.map((command) => command.id).sort()),
      pendingCommandIds: Object.freeze(pendingCommands.map((command) => command.id).sort()),
      queuedCommandIds: Object.freeze(queuedCommands.map((command) => command.id).sort()),
    }),
    recoverySnapshot,
    recovery: Object.freeze({
      nextAction: recoverySnapshot.nextAction,
      retryAfter: recoverySnapshot.retryAfter,
      healthNextAction: operationalHealth.nextAction,
      externalRunId: serviceContract.syncMetadata?.externalRunId ?? null,
      replayCommandIds: recoverySnapshot.replayCommandIds,
      blockedCommandIds: recoverySnapshot.blockedCommandIds,
      pendingAcceptanceCommandIds: recoverySnapshot.pendingAcceptanceCommandIds,
    }),
  });
}

export function createMailchimpProviderReceiptContract(commandContract = {}, options = {}) {
  const commands = Array.isArray(commandContract.commands) ? commandContract.commands : [];
  const receivedCommandIds = normalizeStringSet(options.receivedCommandIds);
  const acknowledgedCommandIds = normalizeStringSet(options.acknowledgedCommandIds);
  const completedCommandIds = normalizeStringSet(options.completedCommandIds);
  const failedCommandIds = normalizeStringSet(options.failedCommandIds);
  const duplicateCommandIds = normalizeStringSet(options.duplicateCommandIds);
  const receiptIdByCommandId = normalizeStringRecord(options.receiptIdByCommandId);
  const providerMessageByCommandId = normalizeStringRecord(options.providerMessageByCommandId);
  const receivedAtByCommandId = normalizeStringRecord(options.receivedAtByCommandId);
  const counters = {};
  const receipts = commands.map((command) => createMailchimpProviderReceipt(command, {
    receivedCommandIds,
    acknowledgedCommandIds,
    completedCommandIds,
    failedCommandIds,
    duplicateCommandIds,
    receiptIdByCommandId,
    providerMessageByCommandId,
    receivedAtByCommandId,
    commandContract,
  }));

  for (const receipt of receipts) {
    incrementCounter(counters, receipt.status);
    incrementCounter(counters, `handoff:${receipt.handoffState}`);
  }

  const blocked = receipts.filter((receipt) => receipt.status === "blocked");
  const failed = receipts.filter((receipt) => receipt.status === "failed");
  const pending = receipts.filter((receipt) => receipt.status === "pending");
  const acknowledged = receipts.filter((receipt) => receipt.status === "acknowledged");
  const completed = receipts.filter((receipt) => receipt.status === "completed");
  const duplicate = receipts.filter((receipt) => receipt.status === "duplicate");
  const status = commandContract.status === "blocked" || blocked.length
    ? "blocked"
    : failed.length
      ? "failed"
      : pending.length
        ? "pending"
        : duplicate.length && completed.length + acknowledged.length === 0
          ? "duplicate"
          : completed.length || acknowledged.length
            ? "acknowledged"
            : commands.length
              ? "pending"
              : "idle";

  return Object.freeze({
    version: "mailchimp-provider-receipt.v1",
    providerId: commandContract.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    status,
    ok: status === "acknowledged" || status === "idle" || status === "duplicate",
    commandContractStatus: commandContract.status ?? "unknown",
    commandContractVersion: commandContract.commandContractVersion ?? "mailchimp-provider-command.v1",
    commandCount: commands.length,
    receiptCount: receipts.length,
    restartSafe: commandContract.restartSafe !== false && blocked.length === 0,
    receipts: Object.freeze(receipts.sort(compareMailchimpProviderReceipts)),
    counters: freezeSortedRecord(counters),
    syncMetadata: Object.freeze({
      serviceSyncKey: commandContract.recoverySnapshot?.serviceSyncKey ?? null,
      externalRunId: commandContract.recovery?.externalRunId ?? null,
      receiptSyncKey: [
        commandContract.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
        commandContract.recoverySnapshot?.serviceSyncKey ?? "mailchimp-working",
        commandContract.commandCount ?? commands.length,
        status,
      ].join(":"),
      completedCount: completed.length,
      acknowledgedCount: acknowledged.length,
      failedCount: failed.length,
      duplicateCount: duplicate.length,
    }),
    recovery: Object.freeze({
      blockedCommandIds: Object.freeze(blocked.map((receipt) => receipt.commandId).sort()),
      failedCommandIds: Object.freeze(failed.map((receipt) => receipt.commandId).sort()),
      pendingCommandIds: Object.freeze(pending.map((receipt) => receipt.commandId).sort()),
      acknowledgedCommandIds: Object.freeze(acknowledged.map((receipt) => receipt.commandId).sort()),
      completedCommandIds: Object.freeze(completed.map((receipt) => receipt.commandId).sort()),
      duplicateCommandIds: Object.freeze(duplicate.map((receipt) => receipt.commandId).sort()),
      nextAction: blocked[0]?.nextAction
        ?? failed[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? duplicate[0]?.nextAction
        ?? acknowledged[0]?.nextAction
        ?? "skip-mailchimp-provider-receipt",
    }),
    externalHandoff: Object.freeze({
      status,
      channel: "mailchimp-provider-receipt",
      exportAllowed: status === "acknowledged" || status === "idle" || status === "duplicate",
      restartSafe: commandContract.restartSafe !== false && blocked.length === 0,
      idempotencyKeys: Object.freeze(receipts
        .map((receipt) => receipt.idempotencyKey)
        .filter(Boolean)
        .sort()),
      receiptIds: Object.freeze(receipts
        .map((receipt) => receipt.receiptId)
        .filter(Boolean)
        .sort()),
      nextAction: status === "acknowledged"
        ? "publish-mailchimp-provider-receipts"
        : status === "idle"
          ? "skip-mailchimp-provider-receipts"
          : blocked[0]?.nextAction ?? failed[0]?.nextAction ?? pending[0]?.nextAction ?? "retain-mailchimp-provider-receipts",
    }),
  });
}

export function createMailchimpProviderOperationalHealth(commands = [], recoverySnapshot = {}, options = {}) {
  const normalizedCommands = Array.isArray(commands) ? commands : [];
  const maxRetryAttempts = Number.isFinite(Number(options.maxRetryAttempts))
    ? Math.max(0, Math.trunc(Number(options.maxRetryAttempts)))
    : 3;
  const retryBaseSeconds = Number.isFinite(Number(options.retryBaseSeconds))
    ? Math.max(1, Math.trunc(Number(options.retryBaseSeconds)))
    : 60;
  const issueCounters = {};
  const commandHealth = normalizedCommands.map((command) => createMailchimpCommandHealth(command, {
    maxRetryAttempts,
    retryBaseSeconds,
  }));
  const blocked = commandHealth.filter((item) => item.status === "blocked");
  const degraded = commandHealth.filter((item) => item.status === "degraded");
  const pending = commandHealth.filter((item) => item.status === "pending");
  const ready = commandHealth.filter((item) => item.status === "ready");

  for (const item of commandHealth) {
    incrementCounter(issueCounters, item.status);
    for (const issue of item.issues) incrementCounter(issueCounters, issue);
  }

  const restartUnsafe = commandHealth.filter((item) => item.restartSafe === false);
  const retryAfter = commandHealth
    .map((item) => item.retryAfter)
    .filter(Boolean)
    .sort()[0] ?? recoverySnapshot.retryAfter ?? null;
  const status = blocked.length || restartUnsafe.length
    ? "blocked"
    : degraded.length
      ? "degraded"
      : pending.length
        ? "pending"
        : normalizedCommands.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-provider-operational-health.v1",
    providerId: options.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    revision: options.revision ?? "working",
    externalRunId: options.externalRunId ?? null,
    status,
    ok: status === "ready" || status === "idle",
    degradedMode: options.degradedMode === true,
    restartSafe: restartUnsafe.length === 0 && blocked.length === 0,
    commandCount: normalizedCommands.length,
    issueCount: blocked.length + degraded.length + pending.length + restartUnsafe.length,
    maxRetryAttempts,
    retryBaseSeconds,
    retryAfter,
    counters: freezeSortedRecord(issueCounters),
    commandHealth: Object.freeze(commandHealth.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    failureState: Object.freeze({
      blockedCommandIds: Object.freeze(blocked.map((item) => item.id).sort()),
      degradedCommandIds: Object.freeze(degraded.map((item) => item.id).sort()),
      pendingCommandIds: Object.freeze(pending.map((item) => item.id).sort()),
      readyCommandIds: Object.freeze(ready.map((item) => item.id).sort()),
      restartUnsafeCommandIds: Object.freeze(restartUnsafe.map((item) => item.id).sort()),
      retryBudgetExhaustedIds: Object.freeze(commandHealth
        .filter((item) => item.retryBudget.remaining === 0 && item.status !== "ready")
        .map((item) => item.id)
        .sort()),
    }),
    backoff: Object.freeze({
      retryAfter,
      retryCommandIds: Object.freeze(commandHealth
        .filter((item) => item.nextAction === "retry-mailchimp-provider-command")
        .map((item) => item.id)
        .sort()),
      schedule: Object.freeze(commandHealth
        .filter((item) => item.status === "degraded")
        .map((item) => Object.freeze({
          id: item.id,
          attempt: item.attempt,
          retryAfter: item.retryAfter,
          nextDelaySeconds: item.retryBudget.nextDelaySeconds,
        }))
        .sort((left, right) => left.id.localeCompare(right.id))),
    }),
    nextAction: selectMailchimpOperationalHealthNextAction(status, {
      blocked,
      degraded,
      pending,
      restartUnsafe,
      recoverySnapshot,
    }),
  });
}

export function createMailchimpProviderCommandRecoverySnapshot(commands = [], options = {}) {
  const normalizedCommands = Array.isArray(commands) ? commands : [];
  const statusCounters = {};
  const replayable = [];
  const retained = [];
  const blocked = [];
  const pendingAcceptance = [];
  const retryable = [];
  const unsafe = [];
  const timeline = [];

  for (const command of normalizedCommands) {
    const status = command.status ?? "unknown";
    incrementCounter(statusCounters, status);
    const restartSafe = command.restartSafe !== false && Boolean(command.idempotencyKey);
    const queueRetained = status === "queued";
    const retry = status === "retry";
    const pending = status === "pending";
    const blockedState = status === "blocked";
    const replayState = status === "ready" || retry;

    if (!restartSafe) unsafe.push(command);
    if (queueRetained) retained.push(command);
    if (retry) retryable.push(command);
    if (pending) pendingAcceptance.push(command);
    if (blockedState) blocked.push(command);
    if (replayState && restartSafe) replayable.push(command);

    timeline.push(Object.freeze({
      index: timeline.length,
      id: command.id,
      commandId: command.commandId,
      operationId: command.operationId,
      jobName: command.jobName,
      service: command.service,
      status,
      queueState: command.queueState ?? "notQueued",
      attempt: command.attempt ?? 0,
      retryAfter: command.retryAfter ?? null,
      idempotencyKey: command.idempotencyKey ?? null,
      restartSafe,
      recoveryAction: selectMailchimpCommandRecoveryAction(command, {
        restartSafe,
        replayState,
        queueRetained,
        retry,
        pending,
        blockedState,
      }),
    }));
  }

  const nextAction = blocked[0]?.nextAction
    ?? pendingAcceptance[0]?.nextAction
    ?? retryable[0]?.nextAction
    ?? replayable[0]?.nextAction
    ?? retained[0]?.nextAction
    ?? (normalizedCommands.length ? "retain-mailchimp-provider-command-ledger" : "skip-mailchimp-provider-commands");

  return Object.freeze({
    version: "mailchimp-provider-command-recovery.v1",
    providerId: options.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    serviceSyncKey: options.serviceSyncKey ?? null,
    externalRunId: options.externalRunId ?? null,
    revision: options.revision ?? "working",
    status: blocked.length || unsafe.length
      ? "blocked"
      : pendingAcceptance.length
        ? "pending"
        : retryable.length
          ? "degraded"
          : retained.length
            ? "queued"
            : normalizedCommands.length
              ? "ready"
              : "idle",
    restartSafe: blocked.length === 0 && unsafe.length === 0,
    commandCount: normalizedCommands.length,
    replayCommandIds: Object.freeze(replayable.map((command) => command.id).sort()),
    retainedCommandIds: Object.freeze(retained.map((command) => command.id).sort()),
    retryCommandIds: Object.freeze(retryable.map((command) => command.id).sort()),
    pendingAcceptanceCommandIds: Object.freeze(pendingAcceptance.map((command) => command.id).sort()),
    blockedCommandIds: Object.freeze(blocked.map((command) => command.id).sort()),
    unsafeCommandIds: Object.freeze(unsafe.map((command) => command.id).sort()),
    idempotencyKeys: Object.freeze(normalizedCommands
      .map((command) => command.idempotencyKey)
      .filter(Boolean)
      .sort()),
    byStatus: freezeSortedRecord(statusCounters),
    timeline: Object.freeze(timeline.sort((left, right) => left.index - right.index)),
    retryAfter: retryable
      .map((command) => command.retryAfter)
      .filter(Boolean)
      .sort()[0] ?? null,
    nextAction,
    restartEnvelope: Object.freeze({
      route: blocked.length || unsafe.length
        ? "mailchimp-command-repair"
        : pendingAcceptance.length
          ? "mailchimp-command-acceptance"
          : retryable.length
            ? "mailchimp-command-retry"
            : retained.length
              ? "mailchimp-command-retain"
              : "mailchimp-command-replay",
      replayAllowed: blocked.length === 0 && unsafe.length === 0 && pendingAcceptance.length === 0,
      replayCount: replayable.length,
      retainCount: retained.length,
      nextAction,
    }),
  });
}

export function createMailchimpTenantBoundaryState(jobStates = [], settings = {}) {
  const tenantSettings = settings.tenantPermissions ?? normalizeMailchimpTenantPermissions(settings);
  const detectedJobs = (Array.isArray(jobStates) ? jobStates : []).filter((job) => job.detected);
  const boundaries = detectedJobs.map((job) => job.tenantBoundary ?? createMailchimpJobTenantBoundary({}, {
    detected: true,
    jobName: job.jobName,
    settings: tenantSettings,
  }));
  const blocked = boundaries.filter((boundary) => boundary.status === "blocked");
  const review = boundaries.filter((boundary) => boundary.status === "review");
  const byStatus = {};
  const byTenant = {};
  const byWorkspace = {};
  const byRole = {};
  const auditEvents = [];

  for (const boundary of boundaries) {
    incrementCounter(byStatus, boundary.status);
    incrementCounter(byTenant, boundary.operationBoundary.tenantId ?? "unbound");
    incrementCounter(byWorkspace, boundary.operationBoundary.workspaceId ?? "unbound");
    incrementCounter(byRole, boundary.operationBoundary.role ?? "unbound");
    auditEvents.push(...boundary.auditEvents);
  }

  const status = blocked.length
    ? "blocked"
    : review.length
      ? "review"
      : detectedJobs.length
        ? "ready"
        : "idle";

  return Object.freeze({
    version: "mailchimp-tenant-boundary.v1",
    status,
    ok: status === "ready" || status === "idle",
    exportAllowed: status === "ready" || status === "idle",
    required: tenantSettings.requireTenantBoundary,
    jobCount: detectedJobs.length,
    blockedJobNames: Object.freeze(blocked.map((boundary) => boundary.jobName).sort()),
    reviewJobNames: Object.freeze(review.map((boundary) => boundary.jobName).sort()),
    defaultTenantId: tenantSettings.defaultTenantId,
    defaultWorkspaceId: tenantSettings.defaultWorkspaceId,
    allowedTenantIds: tenantSettings.allowedTenantIds,
    allowedWorkspaceIds: tenantSettings.allowedWorkspaceIds,
    allowedRoles: tenantSettings.allowedRoles,
    writeRoles: tenantSettings.writeRoles,
    byStatus: freezeSortedRecord(byStatus),
    byTenant: freezeSortedRecord(byTenant),
    byWorkspace: freezeSortedRecord(byWorkspace),
    byRole: freezeSortedRecord(byRole),
    boundaries: Object.freeze(boundaries.sort((left, right) => left.jobName.localeCompare(right.jobName))),
    audit: Object.freeze({
      handoff: "mailchimp-tenant-permission-audit",
      eventCount: auditEvents.length,
      events: Object.freeze(auditEvents.sort((left, right) => left.id.localeCompare(right.id))),
    }),
    nextAction: blocked[0]?.nextAction
      ?? review[0]?.nextAction
      ?? (detectedJobs.length ? "publish-mailchimp-tenant-boundary" : "skip-mailchimp-tenant-boundary"),
  });
}

function createMailchimpTenantBoundaryOperationRows(workflowState = {}, tenantBoundary = {}) {
  const boundaryByJobName = new Map((tenantBoundary.boundaries ?? [])
    .map((boundary) => [boundary.jobName, boundary]));
  const operations = Array.isArray(workflowState.providerContract?.operations)
    ? workflowState.providerContract.operations
    : Array.isArray(workflowState.jobs)
      ? workflowState.jobs.flatMap((job) => job.serviceOperations ?? [])
      : [];

  return Object.freeze(operations.map((operation) => {
    const boundary = boundaryByJobName.get(operation.jobName) ?? null;
    const operationBoundary = operation.tenantBoundary ?? boundary?.operationBoundary ?? {};
    const reasons = Object.freeze([
      ...(boundary?.issues ?? []).map((issue) => issue.target ?? issue.detail),
      ...(operation.reasons ?? []).filter((reason) => String(reason).startsWith("tenant-boundary")),
    ].filter(Boolean).map((reason) => String(reason)));
    const status = boundary?.status === "blocked" || operation.status === "blocked"
      ? "blocked"
      : boundary?.status === "review" || operation.status === "review"
        ? "review"
        : operation.status === "ready"
          ? "ready"
          : operation.status ?? "unknown";

    return Object.freeze({
      id: `tenant-operation:${operation.id}`,
      operationId: operation.id,
      jobName: operation.jobName,
      service: operation.service,
      operation: operation.operation,
      status,
      tenantId: operationBoundary.tenantId ?? null,
      workspaceId: operationBoundary.workspaceId ?? null,
      role: operationBoundary.role ?? null,
      permission: operationBoundary.permission ?? null,
      reason: reasons.join(",") || "within-boundary",
      syncChannel: operation.syncChannel,
      nextAction: status === "blocked" || status === "review"
        ? boundary?.nextAction ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.tenantPermissions.nextAction
        : "retain-mailchimp-tenant-operation-boundary",
    });
  }).sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id)));
}

function createMailchimpTenantBoundaryAuditRows(tenantBoundary = {}, operationRows = [], options = {}) {
  const operationByJobName = new Map();
  for (const operation of operationRows) {
    const list = operationByJobName.get(operation.jobName) ?? [];
    list.push(operation);
    operationByJobName.set(operation.jobName, list);
  }

  const rows = [];
  for (const boundary of tenantBoundary.boundaries ?? []) {
    const operations = operationByJobName.get(boundary.jobName) ?? [];
    const baseRows = operations.length ? operations : [null];
    for (const operation of baseRows) {
      const reasons = createMailchimpTenantBoundaryReasons(boundary, operation);
      const status = reasons.some((reason) => reason.blocking)
        ? "blocked"
        : reasons.some((reason) => reason.review)
          ? "review"
          : boundary.status;
      const operationId = operation?.operationId ?? null;
      rows.push(Object.freeze({
        id: [
          "mailchimp-tenant-audit",
          boundary.jobName,
          operationId ?? "workflow",
          boundary.operationBoundary.tenantId ?? "tenant-unbound",
          boundary.operationBoundary.workspaceId ?? "workspace-unbound",
        ].join(":"),
        jobName: boundary.jobName,
        operationId,
        status,
        tenantId: boundary.operationBoundary.tenantId,
        workspaceId: boundary.operationBoundary.workspaceId,
        role: boundary.operationBoundary.role,
        permission: boundary.operationBoundary.permission,
        reasonCodes: Object.freeze(reasons.map((reason) => reason.code).sort()),
        detail: reasons.map((reason) => reason.detail).join("; ") || "Mailchimp tenant boundary is within policy.",
        handoff: "mailchimp-tenant-permission-audit",
        restartSafe: status !== "blocked",
        nextAction: status === "blocked" || status === "review"
          ? boundary.nextAction
          : "retain-mailchimp-tenant-boundary",
        idempotencyKey: [
          boundary.jobName,
          operationId ?? "workflow",
          boundary.operationBoundary.tenantId ?? "tenant-unbound",
          boundary.operationBoundary.workspaceId ?? "workspace-unbound",
          options.revision ?? "working",
          options.externalRunId ?? "local",
        ].join(":"),
      }));
    }
  }

  return Object.freeze(rows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id)));
}

function createMailchimpTenantBoundaryReasons(boundary = {}, operation = null) {
  const reasons = [];
  const op = boundary.operationBoundary ?? {};
  if (!op.tenantId) {
    reasons.push(mailchimpBoundaryReason("tenant-unbound", "Tenant metadata is missing.", true));
  }
  if (!op.workspaceId) {
    reasons.push(mailchimpBoundaryReason("workspace-unbound", "Workspace metadata is missing.", true));
  }
  for (const issue of boundary.issues ?? []) {
    const detail = issue.detail ?? issue.target ?? "Tenant permission issue.";
    const code = issue.status === "blocked" ? "policy-blocked" : "policy-review";
    reasons.push(mailchimpBoundaryReason(code, detail, issue.status === "blocked", issue.status === "review"));
  }
  if (operation?.status === "blocked" && !reasons.some((reason) => reason.blocking)) {
    reasons.push(mailchimpBoundaryReason("operation-blocked", "Provider operation is blocked by boundary state.", true));
  }
  if (operation?.status === "review" && !reasons.some((reason) => reason.review)) {
    reasons.push(mailchimpBoundaryReason("operation-review", "Provider operation needs boundary review.", false, true));
  }
  return Object.freeze(reasons.length ? reasons : [
    mailchimpBoundaryReason("within-boundary", "Mailchimp workflow is within the tenant permission boundary.", false, false),
  ]);
}

function mailchimpBoundaryReason(code, detail, blocking = false, review = false) {
  return Object.freeze({ code, detail, blocking, review });
}

function countMailchimpBoundaryRows(rows = [], field) {
  const counters = {};
  for (const row of rows) incrementCounter(counters, row?.[field] ?? "unknown");
  return counters;
}

function countMailchimpBoundaryReasons(rows = []) {
  const counters = {};
  for (const row of rows) {
    for (const reason of row.reasonCodes ?? []) incrementCounter(counters, reason);
  }
  return counters;
}

function createMailchimpClientRuntimeTarget(job, index, context) {
  const operations = context.operations ?? [];
  const gates = context.gates ?? [];
  const blockedOperation = operations.find((operation) => operation.status === "blocked");
  const reviewOperation = operations.find((operation) => operation.status === "review");
  const pendingOperation = operations.find((operation) => (
    operation.status === "ready" && !context.acceptedOperationIds.has(operation.id)
  ));
  const blockedGate = gates.find((gate) => gate.status === "blocked");
  const pendingGate = gates.find((gate) => gate.status === "pending");
  const reviewGate = gates.find((gate) => gate.status === "review");
  const accepted = context.acceptedJobNames.has(job.jobName);
  const needsAcceptance = context.workflowPreview.acceptance?.mode === "explicit" && !accepted;
  const status = job.status === "blocked" || blockedOperation || blockedGate
    ? "blocked"
    : needsAcceptance || pendingOperation || pendingGate
      ? "pending"
      : job.status === "review" || reviewOperation || reviewGate
        ? "review"
        : job.detected
          ? "ready"
          : "idle";
  const route = status === "blocked"
    ? "mailchimp/runtime/job-recovery"
    : status === "pending"
      ? "mailchimp/runtime/job-acceptance"
      : status === "review"
        ? "mailchimp/runtime/job-review"
        : "mailchimp/runtime/job-summary";
  const nextAction = blockedGate?.nextAction
    ?? blockedOperation?.nextAction
    ?? job.tenantBoundary?.nextAction
    ?? pendingGate?.nextAction
    ?? pendingOperation?.nextAction
    ?? reviewGate?.nextAction
    ?? reviewOperation?.nextAction
    ?? (needsAcceptance ? "accept-mailchimp-workflow-preview" : job.handoff?.nextAction ?? "publish-mailchimp-workflow-contract");

  return Object.freeze({
    id: `mailchimp-runtime:${job.jobName ?? `job-${index}`}`,
    jobName: job.jobName,
    status,
    route,
    enabled: job.enabled,
    scheduleMode: job.schedule?.mode ?? "manual",
    audienceBound: Boolean(job.audienceBound),
    tenantBoundaryStatus: job.tenantBoundary?.status ?? "unbound",
    operationIds: Object.freeze(operations.map((operation) => operation.id).sort()),
    blockedOperationIds: Object.freeze(operations
      .filter((operation) => operation.status === "blocked")
      .map((operation) => operation.id)
      .sort()),
    pendingOperationIds: Object.freeze(operations
      .filter((operation) => operation.status !== "blocked" && !context.acceptedOperationIds.has(operation.id))
      .map((operation) => operation.id)
      .sort()),
    gateIds: Object.freeze(gates.map((gate) => gate.id).sort()),
    accepted,
    restartSafe: status !== "blocked",
    idempotencyKey: [
      context.workflowState.providerContract.syncMetadata.syncKey,
      job.jobName ?? `job-${index}`,
      context.revision,
    ].join(":"),
    nextAction,
    userVisible: Object.freeze({
      title: job.jobName ?? `Mailchimp job ${index + 1}`,
      detail: status === "ready"
        ? `${operations.length} provider operations are ready for Mailchimp handoff.`
        : `${operations.length} operations and ${gates.length} launch gates require ${route}.`,
      action: nextAction,
    }),
  });
}

function groupMailchimpOperationsByJobName(operations = []) {
  const grouped = new Map();
  for (const operation of Array.isArray(operations) ? operations : []) {
    const jobName = operation.jobName ?? "unknown";
    grouped.set(jobName, [...(grouped.get(jobName) ?? []), operation]);
  }
  return grouped;
}

function groupMailchimpLaunchGatesByJobName(gates = []) {
  const grouped = new Map();
  for (const gate of Array.isArray(gates) ? gates : []) {
    const jobName = gate.jobName ?? "unknown";
    grouped.set(jobName, [...(grouped.get(jobName) ?? []), gate]);
  }
  return grouped;
}

function compareMailchimpClientRuntimeTargets(left, right) {
  return left.status.localeCompare(right.status) || left.id.localeCompare(right.id);
}

function countMailchimpRuntimeTargets(targets = [], field) {
  const counters = {};
  for (const target of targets) incrementCounter(counters, target[field] ?? "unknown");
  return counters;
}

export function createAstNodeHistorySnapshots(snapshots = [], options = {}) {
  const limit = Number.isFinite(Number(options.historyLimit))
    ? Math.max(1, Math.trunc(Number(options.historyLimit)))
    : 5;
  const normalized = snapshots
    .filter((snapshot) => snapshot && typeof snapshot === "object")
    .slice(-limit)
    .map((snapshot, index, list) => {
      const counters = normalizeCounterRecord(snapshot.counters);
      const total = Object.values(counters).reduce((sum, count) => sum + count, 0);
      const missingCount = Array.isArray(snapshot.missing) ? snapshot.missing.length : 0;
      const unsupportedCount = Array.isArray(snapshot.unsupported) ? snapshot.unsupported.length : 0;
      return Object.freeze({
        index,
        age: list.length - index - 1,
        ok: Boolean(snapshot.ok),
        total,
        missingCount,
        unsupportedCount,
        counters: freezeSortedRecord(counters),
        exportableCount: Object.entries(counters)
          .filter(([kind]) => AIOS_AST_NODE_KIND_CONTRACTS[kind]?.kernelSurface !== "module")
          .reduce((sum, [, count]) => sum + count, 0),
      });
    });
  const latest = normalized.at(-1) ?? null;
  const previous = normalized.length > 1 ? normalized.at(-2) : null;
  const delta = latest && previous
    ? Object.fromEntries(NODE_KIND_ORDER.map((kind) => [
        kind,
        (latest.counters[kind] ?? 0) - (previous.counters[kind] ?? 0),
      ]))
    : Object.fromEntries(NODE_KIND_ORDER.map((kind) => [kind, latest?.counters[kind] ?? 0]));

  return Object.freeze({
    limit,
    count: normalized.length,
    latest,
    previous,
    delta: freezeSortedRecord(delta),
    snapshots: Object.freeze(normalized),
  });
}

export function validateAstNodeKindContracts() {
  const diagnostics = [];
  const seenSurfaces = new Set();

  for (const contract of listAstNodeKindContracts()) {
    if (!contract.kind || !contract.compileRole || !contract.kernelSurface) {
      diagnostics.push(`Contract ${contract.kind ?? "unknown"} is missing core routing metadata.`);
    }
    if (!Array.isArray(contract.requiredFields) || contract.requiredFields.length === 0) {
      diagnostics.push(`Contract ${contract.kind} must declare required fields.`);
    }
    const surfaceKey = `${contract.compileRole}:${contract.kernelSurface}`;
    if (seenSurfaces.has(surfaceKey)) {
      diagnostics.push(`Contract ${contract.kind} duplicates compile surface ${surfaceKey}.`);
    }
    seenSurfaces.add(surfaceKey);
  }

  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    kinds: Object.freeze([...NODE_KIND_ORDER]),
  });
}

function visitAstNode(node, visitor) {
  visitAstNodePath(node, visitor, []);
}

function visitAstNodePath(node, visitor, path) {
  if (!node || typeof node !== "object") return;
  const contract = getAstNodeKindContract(node);
  const label = node.name ?? node.expression ?? node.strategy ?? node.type ?? "Unknown";
  const nodePath = Object.freeze([...path, `${node.type ?? "Unknown"}:${label}`]);
  visitor(node, nodePath);
  for (const collection of contract?.childCollections ?? []) {
    for (const child of node[collection] ?? []) visitAstNodePath(child, visitor, nodePath);
  }
  if (node.rollback) visitAstNodePath(node.rollback, visitor, nodePath);
}

function freezeNodeKindContract(contract) {
  return Object.freeze({
    ...contract,
    requiredFields: Object.freeze(contract.requiredFields),
    childCollections: Object.freeze(contract.childCollections),
    recoverySemantics: Object.freeze(contract.recoverySemantics),
    handoffSemantics: Object.freeze(contract.handoffSemantics),
  });
}

function freezeSortedRecord(record = {}) {
  return Object.freeze(Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  ));
}

function createAstNodeExportSummary(snapshot, timeline, history, options) {
  const includeTimeline = options.includeTimeline !== false;
  const blocked = snapshot.missing.length + snapshot.unsupported.length;
  const exportableItems = timeline.filter((item) => item.exportable);
  const status = blocked ? "blocked" : exportableItems.length ? "ready" : "empty";

  return Object.freeze({
    status,
    exportAllowed: blocked === 0,
    exportableCount: exportableItems.length,
    blockedCount: blocked,
    fileName: options.fileName ?? "inline.aios",
    summaryVersion: "ast-node-analytics.v1",
    timeline: includeTimeline
      ? Object.freeze(exportableItems.map((item) => Object.freeze({
          index: item.index,
          path: item.path,
          kind: item.kind,
          label: item.label,
          surface: item.kernelSurface,
          handoff: item.handoff,
        })))
      : Object.freeze([]),
    historyDelta: history.delta,
    nextAction: blocked
      ? "resolve-node-contract-diagnostics"
      : exportableItems.length
        ? "emit-kernel-contracts"
        : "add-job-declaration",
  });
}

function createMailchimpCampaignExportQueueRow(job, state) {
  const operationCounters = {};
  const operations = Array.isArray(job.serviceOperations) ? job.serviceOperations : [];
  for (const operation of operations) incrementCounter(operationCounters, operation.status ?? "unknown");
  const blockedOperationCount = (operationCounters.blocked ?? 0) + (operationCounters.failed ?? 0);
  const reviewOperationCount = operationCounters.review ?? 0;
  const accepted = state.acceptedJobNames.has(job.jobName);
  const queued = state.queuedJobNames.has(job.jobName);
  const exported = state.exportedJobNames.has(job.jobName);
  const failed = state.failedJobNames.has(job.jobName);
  const acceptanceState = state.requireAcceptance === true && !accepted ? "pending" : "accepted";
  const scheduleMode = job.schedule?.mode ?? "manual";
  const tenantStatus = job.tenantBoundary?.status ?? "unbound";
  const workflowBlocked = job.status === "blocked" || tenantStatus === "blocked" || blockedOperationCount > 0;
  const workflowReview = job.status === "review" || tenantStatus === "review" || reviewOperationCount > 0;
  const batchLane = (state.batchSummary.lanes ?? [])
    .find((lane) => lane.id === "mailchimp-workflow" || lane.id === "mailchimp-provider") ?? null;
  const status = failed
    ? "failed"
    : workflowBlocked
      ? "blocked"
      : exported
        ? "exported"
        : queued
          ? "queued"
          : acceptanceState === "pending"
            ? "pending"
            : workflowReview || state.evidence.status === "review" || state.batchSummary.status === "review"
              ? "review"
              : "ready";
  const operationIds = operations
    .map((operation) => operation.id ?? operation.operationId ?? operation.commandId)
    .filter(Boolean)
    .map((id) => String(id))
    .sort();
  const nextAction = status === "failed"
    ? "reconcile-mailchimp-campaign-export-failure"
    : status === "blocked"
      ? job.handoff?.nextAction ?? batchLane?.nextAction ?? "repair-mailchimp-campaign-export"
      : status === "pending"
        ? `accept-mailchimp-campaign-export:${job.jobName}`
        : status === "queued"
          ? "retain-mailchimp-campaign-export-queue"
          : status === "review"
            ? job.handoff?.nextAction ?? "review-mailchimp-campaign-export"
            : "publish-mailchimp-campaign-export";

  return Object.freeze({
    id: `mailchimp-campaign-export:${job.jobName}`,
    index: state.index,
    jobName: job.jobName,
    status,
    acceptanceState,
    detected: Boolean(job.detected),
    enabled: Boolean(job.enabled),
    audienceBound: Boolean(job.audienceBound),
    scheduleMode,
    scheduledAt: job.schedule?.scheduledAt ?? null,
    tenantStatus,
    providerId: job.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    operationCount: operations.length,
    operationIds: Object.freeze(operationIds),
    operationStatus: freezeSortedRecord(operationCounters),
    exportable: status === "ready" || status === "review" || status === "exported",
    restartSafe: status !== "blocked" && status !== "failed",
    idempotencyKey: [
      state.fileName,
      state.revision ?? "working",
      job.jobName,
      scheduleMode,
      operationIds.join(".") || "operations-unbound",
    ].join(":"),
    userVisible: Object.freeze({
      label: `${job.jobName} Mailchimp campaign export`,
      detail: createMailchimpCampaignExportQueueDetail(status, job, operations, acceptanceState),
      nextAction,
    }),
    nextAction,
  });
}

function createMailchimpCampaignExportQueueDetail(status, job, operations, acceptanceState) {
  if (status === "failed") return "Mailchimp campaign export has a failed provider handoff that needs reconciliation.";
  if (status === "blocked") return job.handoff?.nextAction ?? "Mailchimp campaign export is blocked by workflow or provider state.";
  if (acceptanceState === "pending") return "Mailchimp campaign export is valid and waiting for explicit acceptance.";
  if (status === "queued") return "Mailchimp campaign export is already queued for provider handoff.";
  if (status === "exported") return "Mailchimp campaign export has already been recorded as exported.";
  if (status === "review") return `${operations.length} Mailchimp operations are prepared and need review before export.`;
  return `${operations.length} Mailchimp operations are ready for campaign export.`;
}

function createMailchimpCampaignExportQueueCounters(queueRows) {
  const counters = {
    byStatus: {},
    byScheduleMode: {},
    byTenantStatus: {},
    byAcceptance: {},
    byOperationStatus: {},
  };
  for (const row of queueRows) {
    incrementCounter(counters.byStatus, row.status);
    incrementCounter(counters.byScheduleMode, row.scheduleMode);
    incrementCounter(counters.byTenantStatus, row.tenantStatus);
    incrementCounter(counters.byAcceptance, row.acceptanceState);
    for (const [status, count] of Object.entries(row.operationStatus)) {
      counters.byOperationStatus[status] = (counters.byOperationStatus[status] ?? 0) + count;
    }
  }
  return counters;
}

function compareMailchimpCampaignExportQueueRows(left, right) {
  return left.status.localeCompare(right.status)
    || left.scheduleMode.localeCompare(right.scheduleMode)
    || left.jobName.localeCompare(right.jobName);
}

function createMailchimpAstExportLanes(analyticsReport, workflowState, workflowPreview) {
  const lanes = [
    {
      id: "ast-contracts",
      label: "AST contracts",
      status: analyticsReport.exportSummary.status === "blocked" ? "blocked" : analyticsReport.exportSummary.status,
      count: analyticsReport.exportSummary.exportableCount,
      nextAction: analyticsReport.exportSummary.nextAction,
      handoff: "descriptor-export-summary",
    },
    {
      id: "mailchimp-workflow",
      label: "Mailchimp workflow",
      status: workflowState.status,
      count: workflowState.workflowJobCount,
      nextAction: workflowState.handoff.nextAction,
      handoff: "mailchimp-campaign-lifecycle",
    },
    {
      id: "mailchimp-provider",
      label: "Mailchimp provider contract",
      status: workflowState.providerContract.status,
      count: workflowState.providerContract.operations.length,
      nextAction: workflowState.providerContract.externalHandoff.nextAction,
      handoff: "mailchimp-provider-contract",
    },
    {
      id: "mailchimp-tenant-boundary",
      label: "Mailchimp tenant boundary",
      status: workflowState.tenantBoundary.status,
      count: workflowState.tenantBoundary.audit.eventCount,
      nextAction: workflowState.tenantBoundary.nextAction,
      handoff: "mailchimp-tenant-permission-audit",
    },
    {
      id: "mailchimp-preview-acceptance",
      label: "Mailchimp preview acceptance",
      status: workflowPreview.acceptance.acceptable ? "ready" : workflowPreview.status,
      count: workflowPreview.acceptance.pendingJobNames.length,
      nextAction: workflowPreview.readiness.nextAction,
      handoff: "mailchimp-workflow-preview",
    },
  ];

  return lanes.map((lane) => Object.freeze({
    id: lane.id,
    label: lane.label,
    status: lane.status,
    count: lane.count,
    exportAllowed: lane.status === "ready" || lane.status === "idle" || lane.status === "empty",
    handoff: lane.handoff,
    nextAction: lane.nextAction,
  }));
}

function createMailchimpAstTimelineEvent(event, workflowState) {
  const job = workflowState.jobs.find((item) => item.jobName === event.label) ?? null;
  return Object.freeze({
    index: event.index,
    path: event.path,
    jobName: event.label,
    astStatus: event.status,
    workflowStatus: job?.status ?? "unbound",
    providerDetected: Boolean(job?.detected),
    operationCount: job?.serviceOperations?.length ?? 0,
    issueCount: job?.issues?.length ?? 0,
    tenantBoundaryStatus: job?.tenantBoundary?.status ?? "unbound",
    handoff: job?.handoff?.channels ?? event.handoff,
    nextAction: job?.handoff?.nextAction ?? "skip-mailchimp-workflow",
  });
}

function createMailchimpAstBatchHistoryRows(history = {}, limit = 6) {
  const snapshots = Array.isArray(history.snapshots) ? history.snapshots : [];
  const delta = history.delta ?? {};
  return Object.freeze(snapshots.slice(-limit).map((snapshot) => {
    const changedKinds = Object.entries(delta)
      .filter(([, count]) => Number(count) !== 0)
      .map(([kind]) => kind)
      .sort();
    const status = snapshot.ok
      ? changedKinds.length && snapshot.age === 0 ? "changed" : "ready"
      : snapshot.missingCount || snapshot.unsupportedCount ? "blocked" : "review";
    return Object.freeze({
      index: snapshot.index,
      age: snapshot.age,
      status,
      ok: snapshot.ok,
      total: snapshot.total,
      exportableCount: snapshot.exportableCount,
      missingCount: snapshot.missingCount,
      unsupportedCount: snapshot.unsupportedCount,
      changedKinds: Object.freeze(snapshot.age === 0 ? changedKinds : []),
      nextAction: status === "blocked"
        ? "resolve-mailchimp-ast-history-blockers"
        : status === "changed"
          ? "review-mailchimp-ast-history-delta"
          : "retain-mailchimp-ast-history",
    });
  }));
}

function normalizePositiveLimit(value, fallback) {
  const limit = Number(value);
  return Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : fallback;
}

function countWorkflowJobsBy(jobs = [], field) {
  const counters = {};
  for (const job of Array.isArray(jobs) ? jobs : []) {
    incrementCounter(counters, job?.[field] ?? "unknown");
  }
  return counters;
}

function normalizeCounterRecord(record = {}) {
  const counters = Object.fromEntries(NODE_KIND_ORDER.map((kind) => [kind, 0]));
  for (const [kind, count] of Object.entries(record ?? {})) {
    if (NODE_KIND_ORDER.includes(kind)) counters[kind] = Math.max(0, Math.trunc(Number(count) || 0));
  }
  return counters;
}

function incrementCounter(record, key) {
  const safeKey = key ?? "unknown";
  record[safeKey] = (record[safeKey] ?? 0) + 1;
}

function normalizeMailchimpWorkflowSettings(settings = {}) {
  const disabledJobs = new Set((Array.isArray(settings.disabledJobs) ? settings.disabledJobs : [])
    .map((name) => String(name).trim())
    .filter(Boolean));
  const enabledJobs = new Set((Array.isArray(settings.enabledJobs) ? settings.enabledJobs : [])
    .map((name) => String(name).trim())
    .filter(Boolean));
  const scheduleOverrides = settings.scheduleOverrides && typeof settings.scheduleOverrides === "object"
    ? settings.scheduleOverrides
    : {};
  const sendWindowOverrides = settings.sendWindowOverrides && typeof settings.sendWindowOverrides === "object"
    ? settings.sendWindowOverrides
    : {};
  const requiredCapabilities = new Set(
    (Array.isArray(settings.requiredCapabilities) && settings.requiredCapabilities.length
      ? settings.requiredCapabilities
      : AIOS_MAILCHIMP_WORKFLOW_CONTROLS.requiredCapabilities)
      .map((capability) => String(capability).trim())
      .filter(Boolean),
  );
  const tenantPermissions = normalizeMailchimpTenantPermissions(settings);
  const defaultSendWindow = normalizeMailchimpSendWindow(settings.defaultSendWindow ?? settings.sendWindow, {
    jobName: "default",
  });

  return Object.freeze({
    disabledJobs,
    enabledJobs,
    scheduleOverrides,
    sendWindowOverrides,
    defaultSendWindow,
    requiredCapabilities,
    tenantPermissions,
    publicSettings: Object.freeze({
      disabledJobs: Object.freeze([...disabledJobs].sort()),
      enabledJobs: Object.freeze([...enabledJobs].sort()),
      scheduleOverrides: Object.freeze(Object.fromEntries(
        Object.entries(scheduleOverrides).sort(([left], [right]) => left.localeCompare(right)),
      )),
      sendWindowOverrides: Object.freeze(Object.fromEntries(
        Object.entries(sendWindowOverrides).sort(([left], [right]) => left.localeCompare(right)),
      )),
      defaultSendWindow,
      requiredCapabilities: Object.freeze([...requiredCapabilities].sort()),
      tenantPermissions: tenantPermissions.publicSettings,
    }),
  });
}

function normalizeMailchimpTenantPermissions(settings = {}) {
  const raw = settings.tenantPermissions && typeof settings.tenantPermissions === "object"
    ? settings.tenantPermissions
    : settings;
  const controls = AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.tenantPermissions;
  const defaultTenantId = normalizeBoundaryString(raw.defaultTenantId ?? raw.tenantId);
  const defaultWorkspaceId = normalizeBoundaryString(raw.defaultWorkspaceId ?? raw.workspaceId);
  const allowedTenantIds = normalizeBoundarySet(raw.allowedTenantIds, defaultTenantId);
  const allowedWorkspaceIds = normalizeBoundarySet(raw.allowedWorkspaceIds, defaultWorkspaceId);
  const allowedRoles = normalizeBoundarySet(raw.allowedRoles, null, controls.allowedRoles);
  const writeRoles = normalizeBoundarySet(raw.writeRoles, null, controls.writeRoles);

  return Object.freeze({
    requireTenantBoundary: raw.requireTenantBoundary !== false,
    defaultTenantId,
    defaultWorkspaceId,
    allowedTenantIds,
    allowedWorkspaceIds,
    allowedRoles,
    writeRoles,
    publicSettings: Object.freeze({
      requireTenantBoundary: raw.requireTenantBoundary !== false,
      defaultTenantId,
      defaultWorkspaceId,
      allowedTenantIds,
      allowedWorkspaceIds,
      allowedRoles,
      writeRoles,
    }),
  });
}

function createMailchimpJobTenantBoundary(job = {}, context = {}) {
  const settings = context.settings ?? normalizeMailchimpTenantPermissions({});
  const controls = AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.tenantPermissions;
  const jobName = context.jobName ?? String(job.name ?? "mailchimp-job");
  const tenantId = normalizeBoundaryString(job.tenantId ?? job.workspace?.tenantId ?? job.lifecycle?.tenantId)
    ?? settings.defaultTenantId;
  const workspaceId = normalizeBoundaryString(job.workspaceId ?? job.workspace?.id ?? job.lifecycle?.workspaceId)
    ?? settings.defaultWorkspaceId;
  const role = normalizeBoundaryString(job.role ?? job.permissionRole ?? job.lifecycle?.role ?? job.permissions?.role)
    ?? "service";
  const permission = normalizeBoundaryString(job.permission ?? job.lifecycle?.permission ?? inferMailchimpPermission(job))
    ?? "mailchimp:campaigns:write";
  const issues = [];
  const auditEvents = [];

  if (!context.detected) {
    return Object.freeze({
      version: "mailchimp-job-tenant-boundary.v1",
      jobName,
      status: "idle",
      ok: true,
      nextAction: "skip-mailchimp-tenant-boundary",
      operationBoundary: freezeMailchimpOperationBoundary({ tenantId, workspaceId, role, permission }),
      issues: Object.freeze([]),
      auditEvents: Object.freeze([]),
    });
  }

  const missing = [];
  if (settings.requireTenantBoundary && !tenantId) missing.push("tenantId");
  if (settings.requireTenantBoundary && !workspaceId) missing.push("workspaceId");
  if (missing.length) {
    issues.push(createMailchimpTenantBoundaryIssue({
      jobName,
      detail: `Mailchimp workflow "${jobName}" is missing ${missing.join(" and ")} boundary metadata.`,
      target: missing.join(","),
      status: "blocked",
    }));
  }

  if (tenantId && settings.allowedTenantIds.length && !settings.allowedTenantIds.includes(tenantId)) {
    issues.push(createMailchimpTenantBoundaryIssue({
      jobName,
      detail: `Mailchimp workflow "${jobName}" targets tenant "${tenantId}" outside the allowed tenant boundary.`,
      target: tenantId,
      status: "blocked",
    }));
  }

  if (workspaceId && settings.allowedWorkspaceIds.length && !settings.allowedWorkspaceIds.includes(workspaceId)) {
    issues.push(createMailchimpTenantBoundaryIssue({
      jobName,
      detail: `Mailchimp workflow "${jobName}" targets workspace "${workspaceId}" outside the allowed workspace boundary.`,
      target: workspaceId,
      status: "blocked",
    }));
  }

  if (role && !settings.allowedRoles.includes(role)) {
    issues.push(createMailchimpTenantBoundaryIssue({
      jobName,
      detail: `Mailchimp workflow "${jobName}" uses role "${role}" that is not allowed for Mailchimp handoff.`,
      target: role,
      status: "blocked",
    }));
  } else if (role && !settings.writeRoles.includes(role)) {
    issues.push(createMailchimpTenantBoundaryIssue({
      jobName,
      detail: `Mailchimp workflow "${jobName}" uses read-only role "${role}" for a write provider operation.`,
      target: role,
      status: "blocked",
    }));
  }

  if (!permission.startsWith("mailchimp:")) {
    issues.push(createMailchimpTenantBoundaryIssue({
      jobName,
      detail: `Mailchimp workflow "${jobName}" permission "${permission}" is not scoped to Mailchimp.`,
      target: permission,
      status: "review",
    }));
  }

  auditEvents.push(createMailchimpTenantAuditEvent({
    jobName,
    tenantId,
    workspaceId,
    role,
    permission,
    status: issues.some((issue) => issue.status === "blocked")
      ? "blocked"
      : issues.length
        ? "review"
        : "ready",
  }));

  const status = issues.some((issue) => issue.status === "blocked")
    ? "blocked"
    : issues.length
      ? "review"
      : "ready";

  return Object.freeze({
    version: "mailchimp-job-tenant-boundary.v1",
    jobName,
    status,
    ok: status === "ready",
    nextAction: status === "ready"
      ? "retain-mailchimp-tenant-boundary"
      : controls.nextAction,
    operationBoundary: freezeMailchimpOperationBoundary({ tenantId, workspaceId, role, permission }),
    issues: Object.freeze(issues),
    auditEvents: Object.freeze(auditEvents),
  });
}

function createMailchimpTenantBoundaryIssue(issue) {
  const controls = AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.tenantPermissions;
  return createMailchimpWorkflowIssue({
    code: "AIOS_MAILCHIMP_TENANT_PERMISSION",
    status: issue.status,
    jobName: issue.jobName,
    detail: issue.detail,
    recovery: controls.recovery,
    nextAction: controls.nextAction,
    target: issue.target,
  });
}

function createMailchimpTenantAuditEvent(event) {
  const tenant = event.tenantId ?? "tenant-unbound";
  const workspace = event.workspaceId ?? "workspace-unbound";
  const role = event.role ?? "role-unbound";
  return Object.freeze({
    id: `${event.jobName}:${tenant}:${workspace}:${role}`,
    jobName: event.jobName,
    status: event.status,
    tenantId: event.tenantId,
    workspaceId: event.workspaceId,
    role: event.role,
    permission: event.permission,
    handoff: "mailchimp-tenant-permission-audit",
    nextAction: event.status === "ready"
      ? "retain-mailchimp-tenant-boundary"
      : AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.tenantPermissions.nextAction,
  });
}

function freezeMailchimpOperationBoundary(boundary) {
  return Object.freeze({
    tenantId: boundary.tenantId ?? null,
    workspaceId: boundary.workspaceId ?? null,
    role: boundary.role ?? null,
    permission: boundary.permission ?? null,
    auditHandoff: "mailchimp-tenant-permission-audit",
  });
}

function normalizeBoundarySet(value, fallback, defaultValues = []) {
  const values = Array.isArray(value) && value.length
    ? value
    : defaultValues.length
      ? defaultValues
      : fallback
        ? [fallback]
        : [];
  return Object.freeze([...new Set(values
    .map((item) => normalizeBoundaryString(item))
    .filter(Boolean))]
    .sort());
}

function normalizeBoundaryString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function inferMailchimpPermission(job = {}) {
  const scopes = (Array.isArray(job.capabilities) ? job.capabilities : [])
    .flatMap((capability) => normalizeCapabilityScopes(capability))
    .filter((scope) => String(scope).startsWith("mailchimp:"));
  return scopes[0] ?? null;
}

function createMailchimpJobWorkflowState(job = {}, index = 0, settings) {
  const jobName = String(job.name ?? `job-${index + 1}`);
  const capabilities = Array.isArray(job.capabilities) ? job.capabilities : [];
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const capabilityNames = new Set(capabilities.map((capability) => capability.name).filter(Boolean));
  const capabilityScopes = new Set(capabilities.flatMap((capability) => normalizeCapabilityScopes(capability)));
  const mailchimpSteps = steps.filter(isMailchimpStep);
  const detected = capabilityNames.has("mailchimp")
    || [...capabilityScopes].some((scope) => String(scope).startsWith("mailchimp:"))
    || mailchimpSteps.length > 0
    || job.provider === "mailchimp"
    || job.service === "mailchimp";
  const disabledBySettings = settings.disabledJobs.has(jobName) && !settings.enabledJobs.has(jobName);
  const enabled = job.enabled !== false && !disabledBySettings;
  const schedule = normalizeMailchimpSchedule(settings.scheduleOverrides[jobName] ?? job.schedule ?? job.lifecycle?.schedule);
  const scheduleWindow = normalizeMailchimpSendWindow(
    settings.sendWindowOverrides[jobName]
      ?? job.sendWindow
      ?? job.lifecycle?.sendWindow
      ?? schedule.sendWindow
      ?? settings.defaultSendWindow,
    { jobName, schedule },
  );
  const tenantBoundary = createMailchimpJobTenantBoundary(job, {
    detected,
    jobName,
    settings: settings.tenantPermissions,
  });
  const missingCapabilities = detected
    ? [...settings.requiredCapabilities].filter((capability) => !capabilityScopes.has(capability))
    : [];
  const audienceFields = AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.audience.fields;
  const hasAudience = detected && audienceFields.some((field) => job[field] || job.settings?.[field] || job.lifecycle?.[field]);
  const issues = [];
  const serviceOperations = detected
    ? createMailchimpJobServiceOperations(job, {
        jobName,
        index,
        enabled,
        schedule,
        scheduleWindow,
        hasAudience,
        capabilityScopes,
        mailchimpSteps,
        tenantBoundary,
        requiredCapabilities: settings.requiredCapabilities,
      })
    : [];

  if (detected && !enabled) {
    issues.push(createMailchimpWorkflowIssue({
      code: "AIOS_MAILCHIMP_CAMPAIGN_DISABLED",
      status: "blocked",
      jobName,
      detail: `Mailchimp workflow "${jobName}" is disabled.`,
      recovery: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.enabled.recovery,
      nextAction: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.enabled.nextAction,
    }));
  }

  for (const capability of missingCapabilities) {
    issues.push(createMailchimpWorkflowIssue({
      code: "AIOS_MAILCHIMP_PROVIDER_CONTRACT",
      status: "blocked",
      jobName,
      detail: `Mailchimp workflow "${jobName}" is missing provider capability ${capability}.`,
      recovery: "bind-mailchimp-provider-capability",
      nextAction: "negotiate-mailchimp-provider-contract",
      target: capability,
    }));
  }

  if (detected && !hasAudience) {
    issues.push(createMailchimpWorkflowIssue({
      code: "AIOS_MAILCHIMP_PROVIDER_CONTRACT",
      status: "blocked",
      jobName,
      detail: `Mailchimp workflow "${jobName}" must bind an audience, list, or segment.`,
      recovery: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.audience.recovery,
      nextAction: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.audience.nextAction,
    }));
  }

  if (detected && schedule.status !== "ready") {
    issues.push(createMailchimpWorkflowIssue({
      code: "AIOS_MAILCHIMP_SCHEDULE",
      status: schedule.status,
      jobName,
      detail: schedule.detail,
      recovery: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.schedule.recovery,
      nextAction: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.schedule.nextAction,
      target: schedule.mode,
    }));
  }

  if (detected && scheduleWindow.status !== "ready") {
    issues.push(createMailchimpWorkflowIssue({
      code: "AIOS_MAILCHIMP_SCHEDULE",
      status: scheduleWindow.status,
      jobName,
      detail: scheduleWindow.detail,
      recovery: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.schedule.recovery,
      nextAction: scheduleWindow.nextAction,
      target: scheduleWindow.id,
    }));
  }

  for (const issue of tenantBoundary.issues) {
    issues.push(issue);
  }

  return Object.freeze({
    jobName,
    index,
    detected,
    enabled,
    status: issues.some((issue) => issue.status === "blocked")
      ? "blocked"
      : issues.some((issue) => issue.status === "review")
        ? "review"
        : detected
          ? "ready"
          : "idle",
    providerId: detected ? "mailchimp" : null,
    capabilityScopes: Object.freeze([...capabilityScopes].sort()),
    mailchimpStepCount: mailchimpSteps.length,
    serviceOperations: Object.freeze(serviceOperations),
    schedule,
    scheduleWindow,
    audienceBound: hasAudience,
    tenantBoundary,
    issues: Object.freeze(issues),
    handoff: Object.freeze({
      channels: Object.freeze(detected
        ? ["provider-contract", "campaign-lifecycle", "schedule-state", "schedule-window", "audience-binding", "tenant-permission-boundary"]
        : []),
      nextAction: issues[0]?.nextAction ?? (detected ? "publish-mailchimp-workflow-contract" : "skip-mailchimp-workflow"),
    }),
  });
}

function createMailchimpJobServiceOperations(job, context) {
  const declaredOperations = context.mailchimpSteps.length
    ? context.mailchimpSteps.map((step, index) => normalizeMailchimpStepOperation(step, index))
    : [Object.freeze({ operationKey: "campaignDraft", adapter: "mailchimp", source: "inferred-campaign-draft" })];
  const operations = [];

  for (const declared of declaredOperations) {
    const contract = AIOS_MAILCHIMP_PROVIDER_SERVICE_CONTRACTS[declared.operationKey]
      ?? AIOS_MAILCHIMP_PROVIDER_SERVICE_CONTRACTS.campaignDraft;
    const missingCapabilities = contract.requiredCapabilities
      .filter((capability) => !context.capabilityScopes.has(capability));
    const blockedReasons = [];
    if (!context.enabled) blockedReasons.push("workflow-disabled");
    if (!context.hasAudience && contract.service !== "report") blockedReasons.push("audience-unbound");
    if (context.tenantBoundary.status === "blocked") blockedReasons.push("tenant-boundary-blocked");
    for (const capability of missingCapabilities) blockedReasons.push(`missing:${capability}`);
    if (context.schedule.status === "blocked" && contract.service === "campaign") blockedReasons.push("schedule-blocked");
    if (context.scheduleWindow.status === "blocked" && contract.service === "campaign") blockedReasons.push("schedule-window-blocked");
    const reviewReasons = [];
    if (context.schedule.status === "review" && contract.service === "campaign") reviewReasons.push("schedule-needs-run-time");
    if (context.scheduleWindow.status === "review" && contract.service === "campaign") reviewReasons.push("schedule-window-needs-approval");
    if (declared.source === "inferred-campaign-draft") reviewReasons.push("operation-inferred");
    if (context.tenantBoundary.status === "review") reviewReasons.push("tenant-boundary-review");

    const status = blockedReasons.length
      ? "blocked"
      : reviewReasons.length
        ? "review"
        : "ready";

    operations.push(Object.freeze({
      id: `${context.jobName}:${contract.service}:${contract.operation}:${declared.index ?? 0}`,
      jobName: context.jobName,
      jobIndex: context.index,
      service: contract.service,
      operation: contract.operation,
      adapter: declared.adapter,
      status,
      requiredCapabilities: contract.requiredCapabilities,
      missingCapabilities: Object.freeze(missingCapabilities),
      syncChannel: contract.syncChannel,
      idempotencyScope: contract.idempotencyScope,
      tenantBoundary: context.tenantBoundary.operationBoundary,
      recovery: contract.recovery,
      reasons: Object.freeze([...blockedReasons, ...reviewReasons]),
      externalState: Object.freeze({
        scheduleMode: context.schedule.mode,
        scheduledAt: context.schedule.scheduledAt,
        scheduleWindowId: context.scheduleWindow.id,
        scheduleWindowMode: context.scheduleWindow.mode,
        scheduleWindowTimezone: context.scheduleWindow.timezone,
        scheduleWindowNextAction: context.scheduleWindow.nextAction,
        audienceBound: context.hasAudience,
        tenantId: context.tenantBoundary.operationBoundary.tenantId,
        workspaceId: context.tenantBoundary.operationBoundary.workspaceId,
        commandId: [
          context.jobName,
          contract.syncChannel,
          context.schedule.mode,
          context.scheduleWindow.id,
          context.tenantBoundary.operationBoundary.tenantId ?? "tenant-unbound",
          context.tenantBoundary.operationBoundary.workspaceId ?? "workspace-unbound",
        ].join(":"),
        restartSafe: status !== "blocked",
      }),
      nextAction: status === "blocked"
        ? contract.recovery
        : status === "review"
          ? "confirm-mailchimp-operation-handoff"
          : "queue-mailchimp-provider-operation",
    }));
  }

  return operations.sort(compareMailchimpOperations);
}

function normalizeMailchimpStepOperation(step = {}, index = 0) {
  const rawOperation = String(step.operation ?? step.action ?? step.name ?? "").toLowerCase();
  const adapter = String(step.adapter ?? "mailchimp");
  const operationKey = rawOperation.includes("segment")
    ? "audienceSegment"
    : rawOperation.includes("template") || rawOperation.includes("render")
      ? "templateRender"
      : rawOperation.includes("report")
        ? "reportSnapshot"
        : "campaignDraft";

  return Object.freeze({
    index,
    adapter,
    operationKey,
    source: step.operation || step.action || step.name ? "step" : "adapter",
  });
}

function negotiateMailchimpProviderCapabilities(jobs, workflowState, options) {
  const requestedCapabilities = new Set([
    ...(workflowState.requiredCapabilities ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.requiredCapabilities),
    ...(options.includeOptionalCapabilities === false ? [] : workflowState.optionalCapabilities ?? []),
  ]);
  const grantedCapabilities = new Set(jobs.flatMap((job) => [...(job.capabilityScopes ?? [])]));

  return Object.freeze([...requestedCapabilities]
    .sort()
    .map((capability) => {
      const required = (workflowState.requiredCapabilities ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.requiredCapabilities)
        .includes(capability);
      const granted = grantedCapabilities.has(capability);
      return Object.freeze({
        capability,
        required,
        status: granted ? "ready" : required ? "blocked" : "degraded",
        handoff: granted ? "include-provider-capability" : required ? "request-provider-capability" : "omit-optional-capability",
        nextAction: granted ? "retain-mailchimp-capability" : `negotiate-${capability}`,
      });
    }));
}

function createMailchimpProviderSyncMetadata(jobs, operations, options) {
  const byStatus = {};
  const byService = {};
  for (const operation of operations) {
    incrementCounter(byStatus, operation.status);
    incrementCounter(byService, operation.service);
  }

  return Object.freeze({
    providerId: options.providerId,
    revision: options.revision ?? "working",
    externalRunId: options.externalRunId ?? null,
    workflowJobCount: jobs.length,
    operationCount: operations.length,
    byStatus: freezeSortedRecord(byStatus),
    byService: freezeSortedRecord(byService),
    tenantBoundaryStatus: options.tenantBoundary?.status ?? "unbound",
    tenantAuditEventCount: options.tenantBoundary?.audit?.eventCount ?? 0,
    syncKey: [
      options.providerId,
      options.revision ?? "working",
      jobs.length,
      operations.length,
      options.tenantBoundary?.status ?? "unbound",
    ].join(":"),
  });
}

function selectMailchimpProviderServiceNextAction(status, blockedCapabilities, blockedOperations, reviewOperations) {
  if (status === "idle") return "skip-mailchimp-provider-service-contract";
  if (blockedCapabilities.length) return blockedCapabilities[0].nextAction;
  if (blockedOperations.length) return blockedOperations[0].nextAction;
  if (reviewOperations.length) return "review-mailchimp-provider-operations";
  return "publish-mailchimp-provider-service-contract";
}

function compareMailchimpOperations(left, right) {
  return left.jobName.localeCompare(right.jobName)
    || left.service.localeCompare(right.service)
    || left.operation.localeCompare(right.operation)
    || left.id.localeCompare(right.id);
}

function createMailchimpProviderCommand(operation = {}, context = {}) {
  const commandId = operation.externalState?.commandId ?? operation.id;
  const accepted = context.acceptedOperationIds.has(operation.id);
  const queued = context.queuedCommandIds.has(commandId) || context.queuedCommandIds.has(operation.id);
  const failed = context.failedCommandIds.has(commandId) || context.failedCommandIds.has(operation.id);
  const attempt = context.attemptByOperationId[operation.id] ?? context.attemptByOperationId[commandId] ?? 0;
  const retryAfter = context.retryAfterByOperationId[operation.id] ?? context.retryAfterByOperationId[commandId] ?? null;
  const needsAcceptance = context.requireAcceptance && !accepted;
  const restartSafe = operation.externalState?.restartSafe !== false && operation.status !== "blocked";
  const status = operation.status === "blocked"
    ? "blocked"
    : failed
      ? context.degradedMode ? "retry" : "blocked"
      : needsAcceptance
        ? "pending"
        : queued
          ? "queued"
          : "ready";

  return Object.freeze({
    id: `mailchimp-provider:${operation.id}`,
    commandId,
    operationId: operation.id,
    jobName: operation.jobName,
    service: operation.service,
    operation: operation.operation,
    status,
    acceptanceState: accepted || !context.requireAcceptance ? "accepted" : "pending",
    queueState: queued ? "queued" : "notQueued",
    attempt,
    retryAfter,
    syncChannel: operation.syncChannel,
    tenantBoundary: operation.tenantBoundary ?? null,
    idempotencyKey: [
      context.serviceSyncKey,
      operation.syncChannel,
      commandId,
      operation.idempotencyScope,
      operation.tenantBoundary?.tenantId ?? "tenant-unbound",
      operation.tenantBoundary?.workspaceId ?? "workspace-unbound",
    ].join(":"),
    restartSafe,
    degradedMode: context.degradedMode && failed,
    nextAction: status === "blocked"
      ? operation.nextAction ?? operation.recovery ?? "repair-mailchimp-provider-command"
      : status === "retry"
        ? "retry-mailchimp-provider-command"
        : status === "pending"
          ? "accept-mailchimp-provider-operation"
          : status === "queued"
            ? "retain-mailchimp-provider-command"
            : "queue-mailchimp-provider-command",
    userVisible: Object.freeze({
      label: `${operation.jobName} ${operation.service}.${operation.operation}`,
      detail: status === "blocked"
        ? (operation.reasons ?? []).join("; ") || "Mailchimp provider command is blocked."
        : status === "retry"
          ? `Retry after ${retryAfter ?? "runtime backoff"}.`
          : status === "pending"
            ? "Accept this Mailchimp provider operation before queueing."
            : status === "queued"
              ? "Mailchimp provider command is already queued and will be retained on restart."
              : "Mailchimp provider command is ready to queue.",
      status,
    }),
  });
}

function compareMailchimpProviderCommands(left, right) {
  return left.status.localeCompare(right.status)
    || left.jobName.localeCompare(right.jobName)
    || left.service.localeCompare(right.service)
    || left.id.localeCompare(right.id);
}

function createMailchimpProviderReceipt(command = {}, context = {}) {
  const commandIds = [
    command.commandId,
    command.id,
    command.operationId,
  ].map((id) => String(id ?? "").trim()).filter(Boolean);
  const has = (set) => commandIds.some((id) => set.has(id));
  const received = has(context.receivedCommandIds);
  const acknowledged = has(context.acknowledgedCommandIds);
  const completed = has(context.completedCommandIds);
  const failed = has(context.failedCommandIds);
  const duplicate = has(context.duplicateCommandIds);
  const blocked = command.status === "blocked" || command.restartSafe === false;
  const receiptId = commandIds.map((id) => context.receiptIdByCommandId[id]).find(Boolean)
    ?? (acknowledged || completed || failed || duplicate ? `${command.commandId ?? command.id}:receipt` : null);
  const receivedAt = commandIds.map((id) => context.receivedAtByCommandId[id]).find(Boolean) ?? null;
  const providerMessage = commandIds.map((id) => context.providerMessageByCommandId[id]).find(Boolean) ?? null;
  const status = blocked
    ? "blocked"
    : failed
      ? "failed"
      : completed
        ? "completed"
        : duplicate
          ? "duplicate"
          : acknowledged || received
            ? "acknowledged"
            : "pending";
  const handoffState = status === "completed"
    ? "settled"
    : status === "acknowledged" || status === "duplicate"
      ? "accepted"
      : status === "failed"
        ? "recoverable"
        : status === "blocked"
          ? "blocked"
          : "waiting";

  return Object.freeze({
    id: `mailchimp-receipt:${command.operationId ?? command.commandId ?? command.id}`,
    commandId: command.commandId ?? command.id ?? null,
    commandKey: command.id ?? command.commandId ?? null,
    operationId: command.operationId ?? null,
    jobName: command.jobName ?? null,
    service: command.service ?? "unknown",
    operation: command.operation ?? "unknown",
    status,
    handoffState,
    queueState: command.queueState ?? "notQueued",
    commandStatus: command.status ?? "unknown",
    receiptId,
    receivedAt,
    providerMessage,
    idempotencyKey: command.idempotencyKey ?? null,
    restartSafe: !blocked && Boolean(command.idempotencyKey),
    externalRunId: context.commandContract.recovery?.externalRunId ?? null,
    syncChannel: command.syncChannel ?? "mailchimp-provider",
    nextAction: selectMailchimpReceiptNextAction(status, command),
    userVisible: Object.freeze({
      label: `${command.jobName ?? "Mailchimp"} ${command.service ?? "provider"}.${command.operation ?? "operation"}`,
      detail: createMailchimpReceiptDetail(status, command, { receiptId, receivedAt, providerMessage }),
      status,
    }),
  });
}

function compareMailchimpProviderReceipts(left, right) {
  return left.status.localeCompare(right.status)
    || String(left.jobName ?? "").localeCompare(String(right.jobName ?? ""))
    || String(left.service ?? "").localeCompare(String(right.service ?? ""))
    || left.id.localeCompare(right.id);
}

function selectMailchimpReceiptNextAction(status, command = {}) {
  if (status === "blocked") return command.nextAction ?? "repair-mailchimp-provider-command";
  if (status === "failed") return "retry-mailchimp-provider-command";
  if (status === "pending") return command.status === "queued"
    ? "wait-for-mailchimp-provider-receipt"
    : "queue-mailchimp-provider-command";
  if (status === "duplicate") return "retain-mailchimp-provider-receipt";
  if (status === "completed") return "settle-mailchimp-provider-receipt";
  return "retain-mailchimp-provider-receipt";
}

function createMailchimpReceiptDetail(status, command = {}, receipt = {}) {
  if (status === "blocked") return "Provider command must be repaired before a Mailchimp receipt can be accepted.";
  if (status === "failed") return receipt.providerMessage ?? "Mailchimp provider reported command failure.";
  if (status === "pending") return command.status === "queued"
    ? "Mailchimp provider command is queued and waiting for receipt acknowledgement."
    : "Mailchimp provider command has not been queued for receipt tracking.";
  if (status === "duplicate") return "Mailchimp provider returned a duplicate receipt for an idempotent command.";
  if (status === "completed") return `Mailchimp provider receipt ${receipt.receiptId ?? "received"} completed${receipt.receivedAt ? ` at ${receipt.receivedAt}` : ""}.`;
  return `Mailchimp provider receipt ${receipt.receiptId ?? "received"} acknowledged${receipt.receivedAt ? ` at ${receipt.receivedAt}` : ""}.`;
}

function countMailchimpCommandField(commands, field) {
  const counters = {};
  for (const command of commands) incrementCounter(counters, command[field] ?? "unknown");
  return counters;
}

function createMailchimpCommandHealth(command = {}, options = {}) {
  const attempt = Number.isFinite(Number(command.attempt))
    ? Math.max(0, Math.trunc(Number(command.attempt)))
    : 0;
  const retryBudget = createMailchimpRetryBudget(attempt, options);
  const issues = [];
  const restartSafe = command.restartSafe !== false && Boolean(command.idempotencyKey);
  if (!restartSafe) issues.push("restart-unsafe");
  if (command.status === "blocked") issues.push("blocked-command");
  if (command.status === "retry") issues.push("retry-required");
  if (command.status === "pending") issues.push("acceptance-pending");
  if (command.status === "queued") issues.push("queue-retained");
  if (command.status === "retry" && retryBudget.remaining === 0) issues.push("retry-budget-exhausted");
  if (command.tenantBoundary && (!command.tenantBoundary.tenantId || !command.tenantBoundary.workspaceId)) {
    issues.push("tenant-boundary-incomplete");
  }

  const status = !restartSafe
    || command.status === "blocked"
    || (command.status === "retry" && retryBudget.remaining === 0)
    ? "blocked"
    : command.status === "retry"
      ? "degraded"
      : command.status === "pending"
        ? "pending"
        : "ready";

  return Object.freeze({
    id: command.id ?? command.commandId ?? "mailchimp-provider:unknown",
    commandId: command.commandId ?? null,
    operationId: command.operationId ?? null,
    jobName: command.jobName ?? null,
    service: command.service ?? "unknown",
    operation: command.operation ?? "unknown",
    status,
    commandStatus: command.status ?? "unknown",
    queueState: command.queueState ?? "notQueued",
    attempt,
    retryAfter: command.retryAfter ?? retryBudget.retryAfter,
    retryBudget,
    restartSafe,
    degradedMode: command.degradedMode === true,
    idempotencyKey: command.idempotencyKey ?? null,
    issues: Object.freeze(issues.sort()),
    nextAction: status === "blocked"
      ? issues.includes("retry-budget-exhausted")
        ? "escalate-mailchimp-provider-command"
        : issues.includes("restart-unsafe")
          ? "rebuild-mailchimp-provider-command-idempotency"
          : command.nextAction ?? "repair-mailchimp-provider-command"
      : status === "degraded"
        ? "retry-mailchimp-provider-command"
        : status === "pending"
          ? "accept-mailchimp-provider-operation"
          : command.status === "queued"
            ? "retain-mailchimp-provider-command"
            : "queue-mailchimp-provider-command",
  });
}

function createMailchimpRetryBudget(attempt, options = {}) {
  const maxRetryAttempts = Number.isFinite(Number(options.maxRetryAttempts))
    ? Math.max(0, Math.trunc(Number(options.maxRetryAttempts)))
    : 3;
  const retryBaseSeconds = Number.isFinite(Number(options.retryBaseSeconds))
    ? Math.max(1, Math.trunc(Number(options.retryBaseSeconds)))
    : 60;
  const remaining = Math.max(0, maxRetryAttempts - attempt);
  const nextDelaySeconds = remaining === 0
    ? null
    : Math.min(3600, retryBaseSeconds * (2 ** Math.max(0, attempt)));

  return Object.freeze({
    maxAttempts: maxRetryAttempts,
    attempt,
    remaining,
    nextDelaySeconds,
    retryAfter: nextDelaySeconds === null ? null : `PT${nextDelaySeconds}S`,
  });
}

function selectMailchimpOperationalHealthNextAction(status, state) {
  if (status === "idle") return "skip-mailchimp-operational-health";
  if (state.restartUnsafe.length) return "rebuild-mailchimp-provider-command-idempotency";
  if (state.blocked.length) return state.blocked[0].nextAction;
  if (state.degraded.length) return "retry-mailchimp-provider-command";
  if (state.pending.length) return "accept-mailchimp-provider-operation";
  if (state.recoverySnapshot?.restartEnvelope?.replayAllowed === false) return "repair-mailchimp-command-replay-envelope";
  return "publish-mailchimp-operational-health";
}

function selectMailchimpCommandRecoveryAction(command, state) {
  if (!state.restartSafe) return "rebuild-mailchimp-provider-command-idempotency";
  if (state.blockedState) return command.nextAction ?? "repair-mailchimp-provider-command";
  if (state.pending) return "accept-mailchimp-provider-operation";
  if (state.retry) return "retry-mailchimp-provider-command";
  if (state.queueRetained) return "retain-mailchimp-provider-command";
  if (state.replayState) return "replay-mailchimp-provider-command";
  return command.nextAction ?? "retain-mailchimp-provider-command-ledger";
}

function normalizeStringSet(value) {
  return new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item).trim())
    .filter(Boolean));
}

function normalizeStringRecord(value) {
  const record = {};
  for (const [key, raw] of Object.entries(value && typeof value === "object" ? value : {})) {
    const safeKey = String(key).trim();
    if (safeKey) record[safeKey] = raw == null ? null : String(raw);
  }
  return Object.freeze(record);
}

function normalizeNumberRecord(value) {
  const record = {};
  for (const [key, raw] of Object.entries(value && typeof value === "object" ? value : {})) {
    const safeKey = String(key).trim();
    const number = Number(raw);
    if (safeKey && Number.isFinite(number)) record[safeKey] = Math.max(0, Math.trunc(number));
  }
  return Object.freeze(record);
}

function normalizeCapabilityScopes(capability = {}) {
  const scopes = [];
  if (capability.scope) scopes.push(capability.scope);
  if (Array.isArray(capability.scopes)) scopes.push(...capability.scopes);
  if (capability.name === "mailchimp" && scopes.length === 0) scopes.push("mailchimp:campaigns:write");
  return scopes.map((scope) => String(scope).trim()).filter(Boolean);
}

function isMailchimpStep(step = {}) {
  return step.adapter === "mailchimp"
    || String(step.adapter ?? "").startsWith("mailchimp.")
    || String(step.operation ?? "").startsWith("mailchimp.")
    || step.provider === "mailchimp";
}

function normalizeMailchimpSchedule(schedule) {
  const mode = typeof schedule === "string" ? schedule : schedule?.mode ?? schedule?.cadence ?? "manual";
  const allowedModes = AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.schedule.allowedModes;
  if (!allowedModes.includes(mode)) {
    return Object.freeze({
      mode,
      status: "blocked",
      detail: `Unsupported Mailchimp schedule mode "${mode}".`,
      scheduledAt: schedule?.scheduledAt ?? schedule?.nextRun ?? null,
    });
  }
  if (mode === "scheduled" && !(schedule?.scheduledAt || schedule?.nextRun)) {
    return Object.freeze({
      mode,
      status: "review",
      detail: "Scheduled Mailchimp campaign needs a scheduledAt or nextRun value.",
      scheduledAt: null,
    });
  }
  return Object.freeze({
    mode,
    status: "ready",
    detail: `Mailchimp schedule mode ${mode} is ready.`,
    scheduledAt: schedule?.scheduledAt ?? schedule?.nextRun ?? null,
    sendWindow: schedule?.sendWindow ?? schedule?.window ?? null,
  });
}

function normalizeMailchimpSendWindow(window = {}, context = {}) {
  const raw = window && typeof window === "object" ? window : {};
  const mode = String(raw.mode ?? raw.kind ?? "anytime");
  const controls = AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleControls.schedule;
  const allowedModes = controls.allowedWindowModes;
  const timezone = normalizeBoundaryString(raw.timezone ?? raw.tz) ?? "UTC";
  const start = normalizeMailchimpWindowClock(raw.start ?? raw.startTime);
  const end = normalizeMailchimpWindowClock(raw.end ?? raw.endTime);
  const blackoutDates = normalizeMailchimpBlackoutDates(raw.blackoutDates ?? raw.blackouts);
  const scheduledAt = context.schedule?.scheduledAt ?? null;
  const issues = [];

  if (!allowedModes.includes(mode)) issues.push(`unsupported-window-mode:${mode}`);
  if (mode === "custom" && (!start || !end)) issues.push("custom-window-missing-clock");
  if (mode === "custom" && start && end && start.minutes >= end.minutes) issues.push("custom-window-order");
  if (scheduledAt && blackoutDates.includes(String(scheduledAt).slice(0, 10))) issues.push("scheduled-date-blackout");

  const blocked = issues.some((issue) => issue.startsWith("unsupported") || issue === "custom-window-order");
  const review = issues.length > 0 || mode === "businessHours" || mode === "custom";
  const status = blocked ? "blocked" : review ? "review" : "ready";
  const id = [
    context.jobName ?? "mailchimp",
    mode,
    timezone,
    start?.clock ?? "start-any",
    end?.clock ?? "end-any",
    blackoutDates.join(".") || "no-blackout",
  ].join(":");

  return Object.freeze({
    id,
    mode,
    status,
    timezone,
    start: start?.clock ?? null,
    end: end?.clock ?? null,
    blackoutDates,
    scheduledAt,
    issues: Object.freeze(issues.sort()),
    detail: createMailchimpSendWindowDetail(status, {
      mode,
      timezone,
      start,
      end,
      blackoutDates,
      scheduledAt,
      issues,
    }),
    nextAction: status === "ready"
      ? "retain-mailchimp-send-window"
      : blocked
        ? "repair-mailchimp-send-window"
        : "confirm-mailchimp-send-window",
  });
}

function normalizeMailchimpWindowClock(value) {
  if (value === undefined || value === null || value === "") return null;
  const match = String(value).trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return Object.freeze({
    clock: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    minutes: hour * 60 + minute,
  });
}

function normalizeMailchimpBlackoutDates(value) {
  return Object.freeze([...(Array.isArray(value) ? value : [])]
    .map((date) => String(date).trim().slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort());
}

function createMailchimpSendWindowDetail(status, window) {
  if (status === "blocked") return `Mailchimp send window is invalid: ${window.issues.join(", ")}.`;
  if (window.issues.includes("scheduled-date-blackout")) {
    return `Scheduled Mailchimp send date ${String(window.scheduledAt).slice(0, 10)} is in a blackout window.`;
  }
  if (window.mode === "custom") {
    return `Mailchimp send window ${window.start?.clock ?? "unbound"}-${window.end?.clock ?? "unbound"} ${window.timezone} needs confirmation.`;
  }
  if (window.mode === "businessHours") return `Mailchimp send window uses business hours in ${window.timezone}.`;
  return "Mailchimp send window allows immediate provider handoff.";
}

function createMailchimpWorkflowIssue(issue) {
  return Object.freeze({
    code: issue.code,
    status: issue.status,
    jobName: issue.jobName,
    detail: issue.detail,
    recovery: issue.recovery,
    nextAction: issue.nextAction,
    target: issue.target ?? null,
  });
}

function mailchimpServiceContract(contract) {
  return Object.freeze({
    ...contract,
    requiredCapabilities: Object.freeze(contract.requiredCapabilities),
  });
}

function selectMailchimpWorkflowNextAction(status, issues, detected) {
  if (!detected) return "skip-mailchimp-workflow";
  if (status === "blocked") return issues.find((issue) => issue.status === "blocked")?.nextAction ?? "repair-mailchimp-workflow";
  if (status === "review") return issues.find((issue) => issue.status === "review")?.nextAction ?? "review-mailchimp-workflow";
  return "publish-mailchimp-workflow-contract";
}

function createMailchimpWorkflowPreviewJob(job, acceptedJobs) {
  const operations = Array.isArray(job.serviceOperations) ? job.serviceOperations : [];
  const blockedOperations = operations.filter((operation) => operation.status === "blocked");
  const reviewOperations = operations.filter((operation) => operation.status === "review");
  const accepted = acceptedJobs.has(job.jobName);

  return Object.freeze({
    jobName: job.jobName,
    status: job.status,
    detected: job.detected,
    enabled: job.enabled,
    providerId: job.providerId,
    acceptanceState: job.detected && !accepted ? "pending" : "accepted",
    audienceBound: job.audienceBound,
    tenantBoundary: Object.freeze({
      status: job.tenantBoundary?.status ?? "unbound",
      tenantId: job.tenantBoundary?.operationBoundary?.tenantId ?? null,
      workspaceId: job.tenantBoundary?.operationBoundary?.workspaceId ?? null,
      role: job.tenantBoundary?.operationBoundary?.role ?? null,
      detail: createMailchimpTenantBoundaryPreviewDetail(job.tenantBoundary),
      nextAction: job.tenantBoundary?.nextAction ?? "skip-mailchimp-tenant-boundary",
    }),
    schedule: Object.freeze({
      mode: job.schedule?.mode ?? "manual",
      status: job.schedule?.status ?? "ready",
      scheduledAt: job.schedule?.scheduledAt ?? null,
      detail: job.schedule?.detail ?? "Mailchimp schedule is not configured.",
      window: Object.freeze({
        id: job.scheduleWindow?.id ?? null,
        mode: job.scheduleWindow?.mode ?? "anytime",
        status: job.scheduleWindow?.status ?? "ready",
        timezone: job.scheduleWindow?.timezone ?? "UTC",
        start: job.scheduleWindow?.start ?? null,
        end: job.scheduleWindow?.end ?? null,
        blackoutDates: job.scheduleWindow?.blackoutDates ?? Object.freeze([]),
        detail: job.scheduleWindow?.detail ?? "Mailchimp send window is not configured.",
        nextAction: job.scheduleWindow?.nextAction ?? "retain-mailchimp-send-window",
      }),
    }),
    capabilityScopeCount: job.capabilityScopes.length,
    missingCapabilityCount: job.issues.filter((issue) => issue.recovery === "bind-mailchimp-provider-capability").length,
    issueCount: job.issues.length,
    operationCount: operations.length,
    blockedOperationCount: blockedOperations.length,
    reviewOperationCount: reviewOperations.length,
    handoffChannels: job.handoff.channels,
    userVisible: Object.freeze({
      title: job.detected ? `${job.jobName} Mailchimp workflow` : `${job.jobName} workflow`,
      detail: createMailchimpWorkflowJobDetail(job, operations),
      nextAction: job.handoff.nextAction,
    }),
  });
}

function createMailchimpWorkflowValidationSummary(workflowState, jobs) {
  const byStatus = {};
  const byScheduleMode = {};
  for (const job of jobs) {
    incrementCounter(byStatus, job.status);
    incrementCounter(byScheduleMode, job.schedule.mode);
  }
  const byScheduleWindowStatus = {};
  const byScheduleWindowMode = {};
  for (const job of jobs) {
    incrementCounter(byScheduleWindowStatus, job.schedule.window?.status ?? "unknown");
    incrementCounter(byScheduleWindowMode, job.schedule.window?.mode ?? "anytime");
  }

  return Object.freeze({
    status: workflowState.status,
    jobCount: workflowState.jobCount,
    workflowJobCount: workflowState.workflowJobCount,
    visibleJobCount: jobs.length,
    issueCount: workflowState.issues.length,
    requiredCapabilityCount: workflowState.requiredCapabilities.length,
    optionalCapabilityCount: workflowState.optionalCapabilities.length,
    byStatus: freezeSortedRecord(byStatus),
    byScheduleMode: freezeSortedRecord(byScheduleMode),
    byScheduleWindowStatus: freezeSortedRecord(byScheduleWindowStatus),
    byScheduleWindowMode: freezeSortedRecord(byScheduleWindowMode),
    issueCounters: workflowState.issueCounters,
    tenantBoundaryStatus: workflowState.tenantBoundary.status,
    tenantAuditEventCount: workflowState.tenantBoundary.audit.eventCount,
    providerContractStatus: workflowState.providerContract.status,
    providerOperationCount: workflowState.providerContract.operations.length,
  });
}

function createMailchimpWorkflowPreviewDetail(status, jobs, summary) {
  if (status === "idle") return "No Mailchimp workflow jobs were found in this source.";
  if (status === "blocked") return `${summary.issueCount} workflow issues block Mailchimp export.`;
  if (status === "review") return `${jobs.filter((job) => job.status === "review").length} Mailchimp workflow jobs need review.`;
  if (status === "needsAcceptance") return "Mailchimp workflow contracts are valid and need preview acceptance.";
  return `${summary.workflowJobCount} Mailchimp workflow jobs are ready for provider handoff.`;
}

function createMailchimpWorkflowJobDetail(job, operations) {
  if (!job.detected) return "No Mailchimp provider usage detected for this job.";
  if (!job.enabled) return "Workflow is disabled before Mailchimp provider handoff.";
  if (job.tenantBoundary?.status === "blocked") return createMailchimpTenantBoundaryPreviewDetail(job.tenantBoundary);
  if (job.tenantBoundary?.status === "review") return createMailchimpTenantBoundaryPreviewDetail(job.tenantBoundary);
  if (!job.audienceBound) return "Audience, list, or segment binding is required before handoff.";
  if (job.schedule.status !== "ready") return job.schedule.detail;
  if (job.scheduleWindow?.status !== "ready") return job.scheduleWindow.detail;
  return `${operations.length} provider operations will be prepared for Mailchimp handoff.`;
}

function createMailchimpTenantBoundaryPreviewDetail(boundary) {
  if (!boundary || boundary.status === "idle") return "Tenant permission boundary is not required for this job.";
  if (boundary.status === "ready") {
    return `Tenant ${boundary.operationBoundary.tenantId ?? "unbound"} workspace ${boundary.operationBoundary.workspaceId ?? "unbound"} is ready for Mailchimp handoff.`;
  }
  const firstIssue = boundary.issues?.[0];
  return firstIssue?.detail ?? "Tenant permission boundary requires review before Mailchimp handoff.";
}

function selectMailchimpWorkflowPreviewNextAction(status, workflowState, blockedJobs, reviewJobs, pendingAcceptance) {
  if (status === "idle") return "skip-mailchimp-workflow";
  if (status === "blocked") return blockedJobs[0]?.userVisible.nextAction ?? workflowState.handoff.nextAction;
  if (status === "review") return reviewJobs[0]?.userVisible.nextAction ?? "review-mailchimp-workflow-preview";
  if (status === "needsAcceptance") return `accept-mailchimp-workflow:${pendingAcceptance[0]?.jobName ?? "all"}`;
  return "publish-mailchimp-workflow-contract";
}

function createMailchimpWorkflowPreviewNextSteps(status, workflowState, jobs, pendingAcceptance) {
  if (status === "idle") {
    return [Object.freeze({
      id: "skip-mailchimp-workflow",
      status: "ready",
      label: "Continue without Mailchimp handoff",
      detail: "No Mailchimp workflow was detected in the current AST.",
    })];
  }

  const issueSteps = workflowState.issues.map((issue, index) => Object.freeze({
    id: `mailchimp-issue:${issue.code}:${index}`,
    status: issue.status,
    label: issue.nextAction,
    detail: issue.detail,
    jobName: issue.jobName,
    recovery: issue.recovery,
  }));
  if (issueSteps.length) return issueSteps;

  if (pendingAcceptance.length) {
    return pendingAcceptance.map((job) => Object.freeze({
      id: `mailchimp-accept:${job.jobName}`,
      status: "needsAcceptance",
      label: "Accept Mailchimp workflow preview",
      detail: job.userVisible.detail,
      jobName: job.jobName,
    }));
  }

  return jobs.map((job) => Object.freeze({
    id: `mailchimp-publish:${job.jobName}`,
    status: "ready",
    label: "Publish Mailchimp workflow contract",
    detail: job.userVisible.detail,
    jobName: job.jobName,
  }));
}

function createMailchimpJobLaunchGates(job, workflowPreview, requiredGateIds) {
  const previewJob = workflowPreview.preview.jobs.find((item) => item.jobName === job.jobName);
  const operations = Array.isArray(job.serviceOperations) ? job.serviceOperations : [];
  const blockedOperations = operations.filter((operation) => operation.status === "blocked");
  const reviewOperations = operations.filter((operation) => operation.status === "review");
  const pendingAcceptance = previewJob?.acceptanceState === "pending";
  const gates = [
    launchGate("workflow-enabled", {
      jobName: job.jobName,
      kind: "lifecycle",
      status: job.enabled ? "ready" : "blocked",
      detail: job.enabled
        ? "Mailchimp workflow is enabled."
        : `Mailchimp workflow "${job.jobName}" is disabled.`,
      handoff: "mailchimp-campaign-lifecycle",
      nextAction: job.enabled ? "retain-mailchimp-workflow-enabled" : "enable-campaign-workflow",
    }),
    launchGate("audience-bound", {
      jobName: job.jobName,
      kind: "provider",
      status: job.audienceBound ? "ready" : "blocked",
      detail: job.audienceBound
        ? "Audience, list, or segment binding is present."
        : "Audience, list, or segment binding is required before launch.",
      handoff: "mailchimp-provider-contract",
      nextAction: job.audienceBound ? "retain-mailchimp-audience-binding" : "select-mailchimp-audience",
    }),
    launchGate("schedule-ready", {
      jobName: job.jobName,
      kind: "schedule",
      status: job.schedule.status === "ready" && job.scheduleWindow?.status === "ready"
        ? "ready"
        : job.schedule.status === "blocked" || job.scheduleWindow?.status === "blocked"
          ? "blocked"
          : "review",
      detail: job.schedule.status !== "ready" ? job.schedule.detail : job.scheduleWindow?.detail ?? job.schedule.detail,
      handoff: "mailchimp-schedule-state",
      nextAction: job.schedule.status !== "ready"
        ? "select-campaign-schedule"
        : job.scheduleWindow?.status === "ready"
          ? "retain-mailchimp-schedule"
          : job.scheduleWindow?.nextAction ?? "confirm-mailchimp-send-window",
    }),
    launchGate("tenant-boundary", {
      jobName: job.jobName,
      kind: "tenant",
      status: job.tenantBoundary.status === "idle" ? "ready" : job.tenantBoundary.status,
      detail: createMailchimpTenantBoundaryPreviewDetail(job.tenantBoundary),
      handoff: "mailchimp-tenant-permission-audit",
      nextAction: job.tenantBoundary.nextAction,
    }),
    launchGate("provider-operations", {
      jobName: job.jobName,
      kind: "provider",
      status: blockedOperations.length
        ? "blocked"
        : reviewOperations.length
          ? "review"
          : operations.length
            ? "ready"
            : "blocked",
      detail: operations.length
        ? `${operations.length} Mailchimp provider operations prepared; ${blockedOperations.length} blocked.`
        : "At least one Mailchimp provider operation is required before launch.",
      handoff: "mailchimp-provider-contract",
      nextAction: blockedOperations[0]?.nextAction
        ?? (reviewOperations.length ? "review-mailchimp-provider-operations" : "queue-mailchimp-provider-operation"),
    }),
    launchGate("workflow-acceptance", {
      jobName: job.jobName,
      kind: "acceptance",
      status: pendingAcceptance ? "pending" : "ready",
      detail: pendingAcceptance
        ? "Mailchimp workflow preview requires explicit acceptance."
        : "Mailchimp workflow preview acceptance is satisfied.",
      handoff: "mailchimp-workflow-preview",
      nextAction: pendingAcceptance ? `accept-mailchimp-workflow:${job.jobName}` : "retain-mailchimp-workflow-acceptance",
    }),
  ];

  return gates.filter((gate) => requiredGateIds.has(gate.gateId));
}

function launchGate(gateId, gate) {
  return Object.freeze({
    id: `${gate.jobName}:${gateId}`,
    gateId,
    jobName: gate.jobName,
    kind: gate.kind,
    status: gate.status,
    detail: gate.detail,
    handoff: gate.handoff,
    nextAction: gate.nextAction,
  });
}

function compareMailchimpLaunchGates(left, right) {
  return left.status.localeCompare(right.status)
    || left.jobName.localeCompare(right.jobName)
    || left.gateId.localeCompare(right.gateId);
}

function countLaunchGateField(gates = [], field) {
  const counters = {};
  for (const gate of gates) incrementCounter(counters, gate[field] ?? "unknown");
  return counters;
}
