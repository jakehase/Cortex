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
  lifecycleCommands: Object.freeze({
    enableCampaign: mailchimpLifecycleCommand({
      id: "enableCampaign",
      label: "Enable Mailchimp campaign",
      allowedStatuses: ["blocked", "disabled", "paused", "review"],
      nextAction: "enable-mailchimp-campaign-workflow",
    }),
    disableCampaign: mailchimpLifecycleCommand({
      id: "disableCampaign",
      label: "Disable Mailchimp campaign",
      allowedStatuses: ["ready", "review", "pending", "paused"],
      requiresReason: true,
      nextAction: "disable-mailchimp-campaign-workflow",
    }),
    pauseCampaign: mailchimpLifecycleCommand({
      id: "pauseCampaign",
      label: "Pause Mailchimp campaign",
      allowedStatuses: ["ready", "review", "pending"],
      requiresReason: true,
      nextAction: "pause-mailchimp-campaign-workflow",
    }),
    resumeCampaign: mailchimpLifecycleCommand({
      id: "resumeCampaign",
      label: "Resume Mailchimp campaign",
      allowedStatuses: ["paused", "review"],
      nextAction: "resume-mailchimp-campaign-workflow",
    }),
    updateSchedule: mailchimpLifecycleCommand({
      id: "updateSchedule",
      label: "Update Mailchimp schedule",
      allowedStatuses: ["ready", "review", "pending", "paused"],
      nextAction: "select-mailchimp-schedule-mode",
    }),
    acceptScheduleWindow: mailchimpLifecycleCommand({
      id: "acceptScheduleWindow",
      label: "Accept Mailchimp schedule window",
      allowedStatuses: ["review", "pending"],
      nextAction: "accept-mailchimp-schedule-window",
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

export function createMailchimpAstAnalyticsExportBundle(ast = {}, options = {}) {
  const analyticsReport = options.analyticsReport?.exportSummary?.summaryVersion === "ast-node-analytics.v1"
    ? options.analyticsReport
    : createAstNodeAnalyticsReport(ast, {
      ...options,
      history: options.astHistory ?? options.history,
      historyLimit: options.astHistoryLimit ?? options.historyLimit,
    });
  const acceptedIds = normalizeStringSet(options.acceptedMailchimpAstAnalyticsRowIds);
  const completedIds = normalizeStringSet(options.completedMailchimpAstAnalyticsRowIds);
  const failedIds = normalizeStringSet(options.failedMailchimpAstAnalyticsRowIds);
  const previousRows = normalizeMailchimpAstAnalyticsRows(options.previousMailchimpAstAnalyticsRows);
  const requireAcceptance = options.requireMailchimpAstAnalyticsAcceptance !== false;
  const baseRows = [
    mailchimpAstAnalyticsRow({
      id: "mailchimp-ast-analytics:counters",
      kind: "astCounters",
      status: analyticsReport.status,
      label: "Mailchimp AST node counters",
      detail: `${analyticsReport.visited ?? 0} AST node(s) classified for Mailchimp campaign export.`,
      count: analyticsReport.visited ?? 0,
      route: "mailchimp/ast-analytics/counters",
      idempotencyKey: `${options.fileName ?? analyticsReport.exportSummary?.fileName ?? "inline.aios"}:${options.revision ?? "working"}:ast-counters:${analyticsReport.visited ?? 0}`,
      nextAction: analyticsReport.ok ? "publish-mailchimp-ast-counter-summary" : "repair-mailchimp-ast-contract-counters",
    }),
    mailchimpAstAnalyticsRow({
      id: "mailchimp-ast-analytics:timeline",
      kind: "astTimeline",
      status: analyticsReport.timeline?.length ? analyticsReport.status : "review",
      label: "Mailchimp AST export timeline",
      detail: `${analyticsReport.exportSummary?.timeline?.length ?? 0} exportable AST timeline event(s) prepared.`,
      count: analyticsReport.exportSummary?.timeline?.length ?? 0,
      route: "mailchimp/ast-analytics/timeline",
      idempotencyKey: `${options.fileName ?? analyticsReport.exportSummary?.fileName ?? "inline.aios"}:${options.revision ?? "working"}:ast-timeline:${analyticsReport.exportSummary?.timeline?.length ?? 0}`,
      nextAction: analyticsReport.timeline?.length ? "publish-mailchimp-ast-export-timeline" : "rebuild-mailchimp-ast-export-timeline",
    }),
    mailchimpAstAnalyticsRow({
      id: "mailchimp-ast-analytics:history",
      kind: "astHistory",
      status: analyticsReport.history?.count ? "ready" : "review",
      label: "Mailchimp AST history snapshots",
      detail: `${analyticsReport.history?.count ?? 0} AST history snapshot(s) retained for restart comparison.`,
      count: analyticsReport.history?.count ?? 0,
      route: "mailchimp/ast-analytics/history",
      idempotencyKey: `${options.fileName ?? analyticsReport.exportSummary?.fileName ?? "inline.aios"}:${options.revision ?? "working"}:ast-history:${analyticsReport.history?.count ?? 0}`,
      nextAction: analyticsReport.history?.count ? "publish-mailchimp-ast-history" : "seed-mailchimp-ast-history",
    }),
    mailchimpAstAnalyticsRow({
      id: "mailchimp-ast-analytics:handoff",
      kind: "astHandoff",
      status: analyticsReport.exportSummary?.status ?? "review",
      label: "Mailchimp AST handoff summary",
      detail: `${analyticsReport.exportSummary?.exportableCount ?? 0} exportable contract row(s), ${analyticsReport.exportSummary?.blockedCount ?? 0} blocked row(s).`,
      count: analyticsReport.exportSummary?.exportableCount ?? 0,
      route: "mailchimp/ast-analytics/handoff",
      restartSafe: analyticsReport.exportSummary?.blockedCount === 0,
      idempotencyKey: `${options.fileName ?? analyticsReport.exportSummary?.fileName ?? "inline.aios"}:${options.revision ?? "working"}:ast-handoff:${analyticsReport.exportSummary?.status ?? "unknown"}`,
      nextAction: analyticsReport.exportSummary?.nextAction ?? "publish-mailchimp-ast-handoff-summary",
    }),
  ];
  const rows = Object.freeze(baseRows
    .map((row) => finalizeMailchimpAstAnalyticsRow(row, {
      acceptedIds,
      completedIds,
      failedIds,
      previousRows,
      requireAcceptance,
    }))
    .sort(compareMailchimpAstAnalyticsRows));
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review");
  const changed = rows.filter((row) => row.changeStatus === "changed" || row.changeStatus === "new");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length || changed.length
        ? "review"
        : "ready";

  return Object.freeze({
    version: "mailchimp-ast-analytics-export-bundle.v1",
    status,
    ok: status === "ready" || status === "review",
    exportAllowed: status === "ready" || (status === "review" && options.allowReviewMailchimpAstAnalyticsExport === true),
    providerId: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    fileName: options.fileName ?? analyticsReport.exportSummary?.fileName ?? "inline.aios",
    revision: options.revision ?? "working",
    syncKey: [
      AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
      options.fileName ?? analyticsReport.exportSummary?.fileName ?? "inline.aios",
      options.revision ?? "working",
      analyticsReport.exportSummary?.status ?? "status-unbound",
      rows.map((row) => row.idempotencyKey).filter(Boolean).join(".") || "rows-empty",
    ].join("|"),
    rows,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpAstAnalyticsRows(rows, "status")),
      byKind: freezeSortedRecord(countMailchimpAstAnalyticsRows(rows, "kind")),
      byChangeStatus: freezeSortedRecord(countMailchimpAstAnalyticsRows(rows, "changeStatus")),
      nodeByKind: analyticsReport.counters,
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      blockedRowCount: blocked.length,
      pendingRowCount: pending.length,
      reviewRowCount: review.length,
      changedRowCount: changed.length,
      acceptedRowCount: rows.filter((row) => row.accepted).length,
      completedRowCount: rows.filter((row) => row.completed).length,
      visitedNodeCount: analyticsReport.visited ?? 0,
      exportableNodeCount: analyticsReport.exportSummary?.exportableCount ?? 0,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pending.length === 0),
      requiredRowIds: Object.freeze(rows.map((row) => row.id).sort()),
      acceptedRowIds: Object.freeze(rows.filter((row) => row.accepted).map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(requireAcceptance ? pending.map((row) => row.id).sort() : []),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/ast-analytics/recovery"
        : status === "pending"
          ? "mailchimp/ast-analytics/acceptance"
          : status === "review"
            ? "mailchimp/ast-analytics/review"
            : "mailchimp/ast-analytics/export",
      restartSafe: blocked.length === 0,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? changed[0]?.nextAction
        ?? "publish-mailchimp-ast-analytics-export-bundle",
    }),
    exportSummary: Object.freeze({
      status,
      exportAllowed: status === "ready" || (status === "review" && options.allowReviewMailchimpAstAnalyticsExport === true),
      restartSafe: blocked.length === 0,
      syncKey: rows.map((row) => row.idempotencyKey).filter(Boolean).join("|") || "mailchimp-ast-analytics-empty",
      nextAction: status === "ready"
        ? "publish-mailchimp-ast-analytics-export-bundle"
        : "resume-mailchimp-ast-analytics-export-bundle",
    }),
    analyticsReport,
  });
}

export function createMailchimpAstPreviewAcceptanceContract(ast = {}, options = {}) {
  const analyticsReport = options.analyticsReport?.exportSummary?.summaryVersion === "ast-node-analytics.v1"
    ? options.analyticsReport
    : createAstNodeAnalyticsReport(ast, {
      ...options,
      history: options.astHistory ?? options.history,
      historyLimit: options.astHistoryLimit ?? options.historyLimit,
    });
  const analyticsBundle = options.mailchimpAstAnalyticsExportBundle?.version === "mailchimp-ast-analytics-export-bundle.v1"
    ? options.mailchimpAstAnalyticsExportBundle
    : createMailchimpAstAnalyticsExportBundle(ast, {
      ...options,
      analyticsReport,
      acceptedMailchimpAstAnalyticsRowIds: options.acceptedMailchimpAstAnalyticsRowIds,
      completedMailchimpAstAnalyticsRowIds: options.completedMailchimpAstAnalyticsRowIds,
      failedMailchimpAstAnalyticsRowIds: options.failedMailchimpAstAnalyticsRowIds,
      previousMailchimpAstAnalyticsRows: options.previousMailchimpAstAnalyticsRows,
      requireMailchimpAstAnalyticsAcceptance: options.requireMailchimpAstAnalyticsAcceptance,
      allowReviewMailchimpAstAnalyticsExport: options.allowReviewMailchimpAstAnalyticsExport,
    });
  const acceptedPreviewIds = normalizeStringSet(options.acceptedMailchimpAstPreviewIds);
  const completedPreviewIds = normalizeStringSet(options.completedMailchimpAstPreviewIds);
  const failedPreviewIds = normalizeStringSet(options.failedMailchimpAstPreviewIds);
  const requiredKinds = normalizeStringSet(options.requiredMailchimpAstPreviewKinds);
  const requireAcceptance = options.requireMailchimpAstPreviewAcceptance !== false;
  const rows = Object.freeze(createMailchimpAstPreviewRows(analyticsReport, analyticsBundle, {
    acceptedPreviewIds,
    completedPreviewIds,
    failedPreviewIds,
    requiredKinds,
    requireAcceptance,
    fileName: options.fileName ?? analyticsReport.exportSummary?.fileName ?? "inline.aios",
    revision: options.revision ?? "working",
  }).sort(compareMailchimpAstPreviewRows));
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending" || row.status === "needsAcceptance");
  const review = rows.filter((row) => row.status === "review" || row.status === "changed");
  const ready = rows.filter((row) => row.status === "ready");
  const status = analyticsReport.exportSummary?.status === "blocked" || analyticsBundle.status === "blocked" || blocked.length
    ? "blocked"
    : pending.length || analyticsBundle.status === "pending"
      ? "pending"
      : review.length || analyticsBundle.status === "review"
        ? "review"
        : rows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-ast-preview-acceptance.v1",
    status,
    ok: status === "ready" || status === "review" || status === "idle",
    exportAllowed: status === "ready" || (status === "review" && options.allowReviewMailchimpAstPreviewAcceptance === true),
    providerId: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    fileName: options.fileName ?? analyticsReport.exportSummary?.fileName ?? "inline.aios",
    revision: options.revision ?? "working",
    syncKey: [
      AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
      options.fileName ?? analyticsReport.exportSummary?.fileName ?? "inline.aios",
      options.revision ?? "working",
      analyticsBundle.syncKey ?? "analytics-unbound",
      rows.map((row) => row.idempotencyKey).filter(Boolean).join(".") || "preview-rows-empty",
    ].join("|"),
    rows,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpAstPreviewRows(rows, "status")),
      byKind: freezeSortedRecord(countMailchimpAstPreviewRows(rows, "kind")),
      byNodeKind: freezeSortedRecord(countMailchimpAstPreviewRows(rows, "nodeKind")),
      byRoute: freezeSortedRecord(countMailchimpAstPreviewRows(rows, "route")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      readyRowCount: ready.length,
      blockedRowCount: blocked.length,
      pendingRowCount: pending.length,
      reviewRowCount: review.length,
      acceptedRowCount: rows.filter((row) => row.accepted).length,
      completedRowCount: rows.filter((row) => row.completed).length,
      requiredKindCount: requiredKinds.size,
      exportableNodeCount: analyticsReport.exportSummary?.exportableCount ?? 0,
      analyticsRowCount: analyticsBundle.rows?.length ?? 0,
    }),
    validationSummary: Object.freeze({
      astStatus: analyticsReport.status,
      exportSummaryStatus: analyticsReport.exportSummary?.status ?? "unknown",
      analyticsBundleStatus: analyticsBundle.status,
      missingContractCount: analyticsReport.exportSummary?.blockedCount ?? 0,
      unsupportedCount: analyticsReport.analytics?.byStatus?.unsupported ?? 0,
      requiredKindsPresent: Object.freeze([...requiredKinds].sort().map((kind) => Object.freeze({
        kind,
        present: (analyticsReport.counters?.[kind] ?? 0) > 0,
      }))),
      readyForPreview: blocked.length === 0,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pending.length === 0),
      requiredPreviewIds: Object.freeze(rows.map((row) => row.id).sort()),
      acceptedPreviewIds: Object.freeze(rows.filter((row) => row.accepted).map((row) => row.id).sort()),
      pendingPreviewIds: Object.freeze(requireAcceptance ? pending.map((row) => row.id).sort() : []),
    }),
    nextSteps: Object.freeze(createMailchimpAstPreviewNextSteps(status, rows, {
      analyticsBundle,
      analyticsReport,
    })),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/ast-preview/recovery"
        : status === "pending"
          ? "mailchimp/ast-preview/acceptance"
          : status === "review"
            ? "mailchimp/ast-preview/review"
            : "mailchimp/ast-preview/summary",
      restartSafe: blocked.length === 0 && analyticsBundle.restartEnvelope?.restartSafe !== false,
      blockedPreviewIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingPreviewIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewPreviewIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? analyticsBundle.restartEnvelope?.nextAction
        ?? "publish-mailchimp-ast-preview-acceptance",
    }),
    analyticsBundle,
    analyticsReport,
  });
}

export function createMailchimpWorkflowState(ast = {}, settings = {}) {
  const jobs = Array.isArray(ast.jobs) ? ast.jobs : [];
  const workflowSettings = normalizeMailchimpWorkflowSettings(settings);
  const jobStates = jobs.map((job, index) => createMailchimpJobWorkflowState(job, index, workflowSettings));
  const lifecycleCommandState = createMailchimpLifecycleCommandStateFromJobs(jobStates, workflowSettings, settings);
  const issueCounters = {};
  const issues = [...lifecycleCommandState.issues];
  const handoffChannels = {};

  for (const issue of lifecycleCommandState.issues) {
    incrementCounter(issueCounters, issue.code);
    incrementCounter(handoffChannels, "mailchimp-lifecycle-command-queue");
  }

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
    lifecycleCommandState,
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
      channels: Object.freeze([
        ...Object.keys(handoffChannels),
        ...(lifecycleCommandState.rows.length ? ["mailchimp-lifecycle-command-queue"] : []),
      ].sort()),
      exportAllowed: (status === "ready" || status === "idle")
        && tenantBoundary.exportAllowed
        && lifecycleCommandState.exportAllowed,
      nextAction: lifecycleCommandState.status === "blocked" || lifecycleCommandState.status === "pending"
        ? lifecycleCommandState.nextAction
        : tenantBoundary.status === "blocked" || tenantBoundary.status === "review"
        ? tenantBoundary.nextAction
        : selectMailchimpWorkflowNextAction(status, issues, hasWorkflow),
    }),
  });
}

export function createMailchimpLifecycleCommandState(astOrWorkflowState = {}, settings = {}) {
  const workflowState = astOrWorkflowState?.providerId === AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId
    && Array.isArray(astOrWorkflowState.jobs)
    ? astOrWorkflowState
    : createMailchimpWorkflowState(astOrWorkflowState, settings);
  const workflowSettings = normalizeMailchimpWorkflowSettings(settings);
  return createMailchimpLifecycleCommandStateFromJobs(workflowState.jobs ?? [], workflowSettings, settings);
}

export function createMailchimpPersistedCommandEnvelope(astOrWorkflowState = {}, settings = {}) {
  const workflowState = astOrWorkflowState?.providerId === AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId
    && Array.isArray(astOrWorkflowState.jobs)
    ? astOrWorkflowState
    : createMailchimpWorkflowState(astOrWorkflowState, settings);
  const lifecycleCommandState = settings.lifecycleCommandState?.version === "mailchimp-lifecycle-command-state.v1"
    ? settings.lifecycleCommandState
    : createMailchimpLifecycleCommandState(workflowState, settings);
  const accepted = normalizeStringSet(settings.acceptedMailchimpPersistedCommandIds);
  const completed = normalizeStringSet(settings.completedMailchimpPersistedCommandIds);
  const failed = normalizeStringSet(settings.failedMailchimpPersistedCommandIds);
  const requireAcceptance = settings.requireMailchimpPersistedCommandAcceptance !== false;
  const commandRows = Object.freeze((lifecycleCommandState.rows ?? []).map((row) => {
    const persistedId = `mailchimp-persisted-command:${row.id}`;
    const acceptedRow = accepted.has(row.id) || accepted.has(persistedId);
    const completedRow = completed.has(row.id) || completed.has(persistedId);
    const failedRow = failed.has(row.id) || failed.has(persistedId);
    const pendingAcceptance = requireAcceptance && !acceptedRow && row.status !== "ready";
    const status = failedRow || row.status === "blocked"
      ? "blocked"
      : completedRow || row.status === "ready"
        ? "ready"
        : row.status === "pending" || pendingAcceptance
          ? "pending"
          : "review";

    return Object.freeze({
      id: persistedId,
      commandId: row.commandId,
      lifecycleRowId: row.id,
      jobName: row.jobName,
      status,
      sourceStatus: row.status,
      accepted: acceptedRow,
      completed: completedRow,
      failed: failedRow,
      restartSafe: status !== "blocked",
      route: status === "blocked"
        ? "mailchimp/persisted-commands/recovery"
        : status === "pending"
          ? "mailchimp/persisted-commands/acceptance"
          : "mailchimp/persisted-commands/export",
      idempotencyKey: [
        workflowState.providerId,
        workflowState.settings?.tenantId ?? "tenant-unbound",
        workflowState.settings?.workspaceId ?? "workspace-unbound",
        row.jobName ?? "job-unbound",
        row.commandId,
        row.idempotencyKey ?? row.status,
      ].join(":"),
      nextAction: status === "blocked"
        ? row.nextAction ?? "repair-mailchimp-persisted-command"
        : status === "pending"
          ? `accept-mailchimp-persisted-command:${persistedId}`
          : "retain-mailchimp-persisted-command",
    });
  }).sort(compareMailchimpPersistedCommandRows));
  const blocked = commandRows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = commandRows.filter((row) => row.status === "pending");
  const review = commandRows.filter((row) => row.status === "review");
  const status = lifecycleCommandState.status === "blocked" || blocked.length
    ? "blocked"
    : lifecycleCommandState.status === "pending" || pending.length
      ? "pending"
      : review.length
        ? "review"
        : commandRows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-persisted-command-envelope.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && settings.allowReviewMailchimpPersistedCommands === true),
    providerId: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    detected: workflowState.detected,
    syncKey: [
      AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
      workflowState.settings?.tenantId ?? "tenant-unbound",
      workflowState.settings?.workspaceId ?? "workspace-unbound",
      commandRows.map((row) => row.idempotencyKey).join(".") || "no-persisted-commands",
    ].join("|"),
    commands: commandRows,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpPersistedCommandRows(commandRows, "status")),
      byCommandId: freezeSortedRecord(countMailchimpPersistedCommandRows(commandRows, "commandId")),
      byJobName: freezeSortedRecord(countMailchimpPersistedCommandRows(commandRows, "jobName")),
    }),
    totals: Object.freeze({
      commandCount: commandRows.length,
      blockedCommandCount: blocked.length,
      pendingCommandCount: pending.length,
      reviewCommandCount: review.length,
      acceptedCommandCount: commandRows.filter((row) => row.accepted).length,
      completedCommandCount: commandRows.filter((row) => row.completed).length,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/persisted-commands/recovery"
        : status === "pending"
          ? "mailchimp/persisted-commands/acceptance"
          : status === "review"
            ? "mailchimp/persisted-commands/review"
            : "mailchimp/persisted-commands/export",
      restartSafe: blocked.length === 0,
      blockedCommandIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingCommandIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewCommandIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(commandRows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? lifecycleCommandState.nextAction
        ?? "publish-mailchimp-persisted-command-envelope",
    }),
    lifecycleCommandState,
  });
}

export function createMailchimpCampaignControlPlaneContract(state = {}, options = {}) {
  const workflowState = state.workflowState?.providerId === AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId
    ? state.workflowState
    : state.providerId === AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId && Array.isArray(state.jobs)
      ? state
      : createMailchimpWorkflowState(state.ast ?? {}, options.mailchimpWorkflow ?? options);
  const lifecycleCommandState = state.lifecycleCommandState?.version === "mailchimp-lifecycle-command-state.v1"
    ? state.lifecycleCommandState
    : createMailchimpLifecycleCommandState(workflowState, options.mailchimpWorkflow ?? options);
  const rows = Object.freeze([
    ...createMailchimpCampaignControlJobRows(workflowState.jobs ?? []),
    ...createMailchimpCampaignControlCommandRows(lifecycleCommandState.rows ?? []),
    mailchimpCampaignControlPlaneRow("provider-services", {
      kind: "providerServiceReadiness",
      status: state.providerServiceReadiness?.status ?? state.serviceReadiness?.status ?? workflowState.providerContract?.status,
      label: "Mailchimp provider services",
      detail: `${state.providerServiceReadiness?.totals?.rowCount ?? state.providerServiceReadiness?.rows?.length ?? workflowState.providerContract?.operations?.length ?? 0} service readiness rows prepared.`,
      handoff: "mailchimp-provider-service-readiness",
      route: state.providerServiceReadiness?.restartEnvelope?.route ?? "mailchimp/provider-services",
      exportAllowed: state.providerServiceReadiness?.exportAllowed ?? workflowState.providerContract?.exportAllowed,
      restartSafe: state.providerServiceReadiness?.restartEnvelope?.restartSafe,
      nextAction: state.providerServiceReadiness?.restartEnvelope?.nextAction ?? workflowState.providerContract?.recovery?.nextAction,
      idempotencyKey: state.providerServiceReadiness?.syncKey ?? workflowState.providerContract?.syncKey,
    }),
    mailchimpCampaignControlPlaneRow("tenant-boundary", {
      kind: "tenantBoundary",
      status: state.tenantPermissionDecision?.status ?? workflowState.tenantBoundary?.status,
      label: "Mailchimp tenant boundary",
      detail: `${state.tenantPermissionDecision?.totals?.rowCount ?? workflowState.tenantBoundary?.audit?.eventCount ?? 0} tenant permission rows prepared.`,
      handoff: "mailchimp-tenant-permission-audit",
      route: state.tenantPermissionDecision?.restartEnvelope?.route ?? "mailchimp/tenant-boundary",
      exportAllowed: state.tenantPermissionDecision?.exportAllowed ?? workflowState.tenantBoundary?.exportAllowed,
      restartSafe: state.tenantPermissionDecision?.restartEnvelope?.restartSafe,
      nextAction: state.tenantPermissionDecision?.restartEnvelope?.nextAction ?? workflowState.tenantBoundary?.nextAction,
      idempotencyKey: state.tenantPermissionDecision?.syncKey ?? workflowState.tenantBoundary?.syncKey,
    }),
    mailchimpCampaignControlPlaneRow("formatter-lifecycle", {
      kind: "formatterLifecycle",
      status: state.formatterLifecycle?.status,
      label: "Formatter lifecycle controls",
      detail: `${state.formatterLifecycle?.totals?.commandCount ?? 0} formatter lifecycle commands prepared.`,
      handoff: "formatter-lifecycle-controls",
      route: state.formatterLifecycle?.restartEnvelope?.route ?? "formatter/lifecycle/summary",
      exportAllowed: state.formatterLifecycle?.exportAllowed,
      restartSafe: state.formatterLifecycle?.restartEnvelope?.restartSafe,
      nextAction: state.formatterLifecycle?.restartEnvelope?.nextAction,
      idempotencyKey: state.formatterLifecycle?.restartEnvelope?.idempotencyKeys?.join("."),
    }),
  ].sort(compareMailchimpCampaignControlPlaneRows));
  const blocked = rows.filter((row) => row.status === "blocked" || row.exportAllowed === false || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending" || row.status === "needsAcceptance");
  const review = rows.filter((row) => row.status === "review" || row.status === "degraded");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : workflowState.detected
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-campaign-control-plane.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: status === "ready" || (status === "review" && options.allowReviewMailchimpControlPlane === true),
    providerId: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    fileName: options.fileName ?? "inline.aios",
    revision: options.revision ?? "working",
    detected: workflowState.detected,
    rows,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpCampaignControlRows(rows, "status")),
      byKind: freezeSortedRecord(countMailchimpCampaignControlRows(rows, "kind")),
      byHandoff: freezeSortedRecord(countMailchimpCampaignControlRows(rows, "handoff")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      workflowJobCount: workflowState.workflowJobCount ?? 0,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/control-plane/recovery"
        : status === "pending"
          ? "mailchimp/control-plane/actions"
          : status === "review"
            ? "mailchimp/control-plane/review"
            : "mailchimp/control-plane/summary",
      restartSafe: blocked.length === 0,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? (status === "idle" ? "skip-mailchimp-control-plane" : "publish-mailchimp-control-plane"),
    }),
    userVisible: Object.freeze({
      title: workflowState.detected ? "Mailchimp campaign controls" : "Mailchimp controls idle",
      detail: status === "ready"
        ? "Mailchimp workflow, schedule, provider service, tenant, and formatter controls are ready."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review control rows remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? (status === "idle" ? "skip-mailchimp-control-plane" : "publish-mailchimp-control-plane"),
    }),
    workflowState,
    lifecycleCommandState,
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

export function createMailchimpWorkflowHandoffReadinessPacket(contracts = {}, settings = {}) {
  const lanes = [
    mailchimpHandoffReadinessLane("workflow-preview", {
      label: "Mailchimp workflow preview",
      contract: contracts.workflowPreview,
      exportAllowed: contracts.workflowPreview?.acceptance?.acceptable !== false,
      count: contracts.workflowPreview?.validationSummary?.workflowJobCount ?? contracts.workflowPreview?.preview?.jobs?.length ?? 0,
      route: "mailchimp/workflow-preview",
      nextAction: contracts.workflowPreview?.readiness?.nextAction,
      idempotencyKey: contracts.workflowPreview?.previewVersion ?? "mailchimp-workflow-preview-unbound",
    }),
    mailchimpHandoffReadinessLane("provider-handoff", {
      label: "Mailchimp provider handoff",
      contract: contracts.providerHandoff ?? contracts.handoff,
      exportAllowed: contracts.providerHandoff?.exportAllowed ?? contracts.handoff?.exportAllowed,
      count: contracts.providerHandoff?.operationCount ?? contracts.providerHandoff?.totals?.operationCount ?? 0,
      route: contracts.providerHandoff?.restartEnvelope?.route ?? "mailchimp/provider-handoff",
      nextAction: contracts.providerHandoff?.nextAction ?? contracts.providerHandoff?.recoveryPlan?.actions?.[0]?.id,
      idempotencyKey: contracts.providerHandoff?.syncKey,
    }),
    mailchimpHandoffReadinessLane("source-anchors", {
      label: "Mailchimp source anchors",
      contract: contracts.sourceAnchors ?? contracts.mailchimpSourceAnchorHandoff,
      exportAllowed: contracts.sourceAnchors?.exportAllowed ?? contracts.mailchimpSourceAnchorHandoff?.exportAllowed,
      count: contracts.sourceAnchors?.totals?.anchoredOperationCount ?? contracts.mailchimpSourceAnchorHandoff?.totals?.anchoredOperationCount ?? 0,
      route: contracts.sourceAnchors?.restartEnvelope?.route ?? contracts.mailchimpSourceAnchorHandoff?.restartEnvelope?.route ?? "mailchimp/source-anchors",
      nextAction: contracts.sourceAnchors?.restartEnvelope?.nextAction ?? contracts.mailchimpSourceAnchorHandoff?.restartEnvelope?.nextAction,
      idempotencyKey: contracts.sourceAnchors?.syncKey ?? contracts.mailchimpSourceAnchorHandoff?.syncKey,
    }),
    mailchimpHandoffReadinessLane("launch-gates", {
      label: "Mailchimp launch gates",
      contract: contracts.launchGate ?? contracts.launchHandoff,
      exportAllowed: contracts.launchGate?.exportAllowed ?? contracts.launchHandoff?.exportAllowed,
      count: contracts.launchGate?.validationSummary?.gateCount ?? contracts.launchHandoff?.validationSummary?.gateCount ?? contracts.launchGate?.gates?.length ?? 0,
      route: "mailchimp/launch-gates",
      nextAction: contracts.launchGate?.nextAction ?? contracts.launchHandoff?.nextAction,
      idempotencyKey: contracts.launchGate?.syncKey ?? contracts.launchHandoff?.syncKey,
    }),
    mailchimpHandoffReadinessLane("runtime-targets", {
      label: "Mailchimp runtime targets",
      contract: contracts.runtimeTargets,
      exportAllowed: contracts.runtimeTargets?.exportAllowed,
      count: contracts.runtimeTargets?.targets?.length ?? contracts.runtimeTargets?.totals?.targetCount ?? 0,
      route: contracts.runtimeTargets?.restartEnvelope?.route ?? "mailchimp/runtime-targets",
      nextAction: contracts.runtimeTargets?.restartEnvelope?.nextAction,
      idempotencyKey: contracts.runtimeTargets?.syncKey,
    }),
    mailchimpHandoffReadinessLane("runtime-request", {
      label: "Mailchimp runtime request",
      contract: contracts.runtimeRequest ?? contracts.mailchimpRuntimeRequest,
      exportAllowed: contracts.runtimeRequest?.exportAllowed ?? contracts.mailchimpRuntimeRequest?.exportAllowed,
      count: contracts.runtimeRequest?.totals?.rowCount ?? contracts.mailchimpRuntimeRequest?.totals?.rowCount ?? 0,
      route: contracts.runtimeRequest?.restartEnvelope?.route ?? contracts.mailchimpRuntimeRequest?.restartEnvelope?.route ?? "mailchimp/runtime-request",
      nextAction: contracts.runtimeRequest?.restartEnvelope?.nextAction ?? contracts.mailchimpRuntimeRequest?.restartEnvelope?.nextAction,
      idempotencyKey: contracts.runtimeRequest?.syncKey ?? contracts.mailchimpRuntimeRequest?.syncKey,
    }),
    mailchimpHandoffReadinessLane("diagnostic-handoff", {
      label: "Diagnostic handoff gate",
      contract: contracts.diagnosticHandoffGate ?? contracts.diagnostics,
      exportAllowed: contracts.diagnosticHandoffGate?.exportAllowed ?? contracts.diagnostics?.exportAllowed,
      count: contracts.diagnosticHandoffGate?.totals?.rowCount ?? contracts.diagnostics?.totals?.rowCount ?? 0,
      route: contracts.diagnosticHandoffGate?.restartEnvelope?.route ?? "diagnostics/handoff",
      nextAction: contracts.diagnosticHandoffGate?.restartEnvelope?.nextAction ?? contracts.diagnostics?.restartEnvelope?.nextAction,
      idempotencyKey: contracts.diagnosticHandoffGate?.syncKey ?? contracts.diagnostics?.syncKey,
    }),
    mailchimpHandoffReadinessLane("tenant-boundary", {
      label: "Mailchimp tenant boundary",
      contract: contracts.tenantBoundary,
      exportAllowed: contracts.tenantBoundary?.exportAllowed ?? contracts.tenantBoundary?.handoff?.exportAllowed,
      count: contracts.tenantBoundary?.totals?.auditEventCount ?? contracts.tenantBoundary?.audit?.eventCount ?? 0,
      route: contracts.tenantBoundary?.restartEnvelope?.route ?? "mailchimp/tenant-boundary",
      nextAction: contracts.tenantBoundary?.restartEnvelope?.nextAction ?? contracts.tenantBoundary?.nextAction,
      idempotencyKey: contracts.tenantBoundary?.syncKey,
    }),
    mailchimpHandoffReadinessLane("campaign-release", {
      label: "Mailchimp campaign release",
      contract: contracts.campaignRelease,
      exportAllowed: contracts.campaignRelease?.exportAllowed,
      count: contracts.campaignRelease?.lanes?.length ?? contracts.campaignRelease?.totals?.laneCount ?? 0,
      route: contracts.campaignRelease?.restartEnvelope?.route ?? "mailchimp/campaign-release",
      nextAction: contracts.campaignRelease?.restartEnvelope?.nextAction,
      idempotencyKey: contracts.campaignRelease?.syncKey,
    }),
  ].filter((lane) => settings.includeIdleLanes === true || lane.status !== "idle" || lane.count > 0);
  const blocked = lanes.filter((lane) => lane.status === "blocked" || lane.exportAllowed === false || lane.restartSafe === false);
  const pending = lanes.filter((lane) => lane.status === "pending" || lane.status === "needsAcceptance");
  const review = lanes.filter((lane) => lane.status === "review" || lane.status === "degraded");
  const requireAcceptance = settings.requireMailchimpHandoffReadinessAcceptance !== false && lanes.length > 0;
  const acceptedIds = new Set((Array.isArray(settings.acceptedMailchimpHandoffReadinessLaneIds)
    ? settings.acceptedMailchimpHandoffReadinessLaneIds
    : [])
    .map((id) => String(id).trim())
    .filter(Boolean));
  const pendingAcceptance = requireAcceptance
    ? lanes.filter((lane) => lane.status !== "blocked" && !acceptedIds.has(lane.id))
    : [];
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : pendingAcceptance.length
          ? "needsAcceptance"
          : lanes.length
            ? "ready"
            : "idle";
  const nextAction = blocked[0]?.nextAction
    ?? pending[0]?.nextAction
    ?? review[0]?.nextAction
    ?? (pendingAcceptance[0]
      ? `accept-mailchimp-handoff-readiness:${pendingAcceptance[0].id}`
      : status === "idle"
        ? "skip-mailchimp-workflow-handoff"
        : "publish-mailchimp-workflow-handoff-readiness");

  return Object.freeze({
    version: "mailchimp-workflow-handoff-readiness.v1",
    status,
    ok: status === "ready" || status === "idle",
    exportAllowed: status === "ready",
    providerId: settings.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    fileName: settings.fileName ?? "inline.aios",
    revision: settings.revision ?? "working",
    syncKey: [
      settings.fileName ?? "inline.aios",
      settings.revision ?? "working",
      ...lanes.map((lane) => lane.idempotencyKey ?? `${lane.id}:${lane.status}`),
    ].join("|"),
    lanes: Object.freeze(lanes.sort(compareMailchimpHandoffReadinessLanes)),
    validationSummary: Object.freeze({
      laneCount: lanes.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      acceptedCount: lanes.filter((lane) => acceptedIds.has(lane.id)).length,
      byStatus: freezeSortedRecord(countMailchimpHandoffReadinessLanes(lanes, "status")),
      byRoute: freezeSortedRecord(countMailchimpHandoffReadinessLanes(lanes, "route")),
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && pendingAcceptance.length === 0,
      requiredLaneIds: Object.freeze(lanes.map((lane) => lane.id).sort()),
      acceptedLaneIds: Object.freeze([...acceptedIds].filter((id) => lanes.some((lane) => lane.id === id)).sort()),
      pendingLaneIds: Object.freeze(pendingAcceptance.map((lane) => lane.id).sort()),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/workflow-handoff/recovery"
        : status === "pending" || status === "needsAcceptance"
          ? "mailchimp/workflow-handoff/actions"
          : status === "review"
            ? "mailchimp/workflow-handoff/review"
            : "mailchimp/workflow-handoff/summary",
      restartSafe: blocked.length === 0 && lanes.every((lane) => lane.restartSafe !== false),
      blockedLaneIds: Object.freeze(blocked.map((lane) => lane.id).sort()),
      pendingLaneIds: Object.freeze([...pending, ...pendingAcceptance].map((lane) => lane.id).sort()),
      reviewLaneIds: Object.freeze(review.map((lane) => lane.id).sort()),
      idempotencyKeys: Object.freeze(lanes.map((lane) => lane.idempotencyKey).filter(Boolean).sort()),
      nextAction,
    }),
    userVisible: Object.freeze({
      title: status === "idle" ? "Mailchimp handoff not detected" : "Mailchimp handoff readiness",
      detail: createMailchimpHandoffReadinessDetail(status, blocked, pending, review, pendingAcceptance, lanes),
      nextAction,
    }),
    nextSteps: Object.freeze(createMailchimpHandoffReadinessNextSteps(status, lanes, pendingAcceptance)),
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

export function createMailchimpAstExportResumeLedger(ast = {}, settings = {}) {
  const evidence = settings.astEvidence?.version === "mailchimp-ast-export-evidence.v1"
    ? settings.astEvidence
    : createMailchimpAstExportEvidence(ast, settings);
  const batchSummary = settings.astExportBatchSummary?.version === "mailchimp-ast-export-batch-summary.v1"
    ? settings.astExportBatchSummary
    : createMailchimpAstExportBatchSummary(ast, {
        ...settings,
        astEvidence: evidence,
      });
  const completedLaneIds = normalizeStringSet(settings.completedMailchimpAstExportLaneIds);
  const acceptedLaneIds = normalizeStringSet(settings.acceptedMailchimpAstExportLaneIds);
  const retryLaneIds = normalizeStringSet(settings.retryMailchimpAstExportLaneIds);
  const laneCommands = (batchSummary.lanes ?? []).map((lane) => {
    const accepted = acceptedLaneIds.has(lane.id) || settings.requireMailchimpAstExportLaneAcceptance !== true;
    const completed = completedLaneIds.has(lane.id);
    const retryRequested = retryLaneIds.has(lane.id);
    const blocked = lane.status === "blocked";
    const pending = !blocked && !completed && (!accepted || lane.status === "needsAcceptance" || retryRequested);
    const status = blocked
      ? "blocked"
      : completed
        ? "ready"
        : pending
          ? "pending"
          : lane.status === "review"
            ? "review"
            : "ready";

    return Object.freeze({
      id: `mailchimp-ast-export-lane:${lane.id}`,
      laneId: lane.id,
      kind: "mailchimpAstExportLane",
      status,
      sourceStatus: lane.status,
      accepted,
      completed,
      retryRequested,
      restartSafe: status !== "blocked",
      idempotencyKey: [
        batchSummary.fileName,
        batchSummary.revision,
        batchSummary.handoff?.syncKey ?? "mailchimp-ast-export",
        lane.id,
      ].join(":"),
      nextAction: blocked
        ? lane.nextAction
        : completed
          ? "retain-mailchimp-ast-export-lane"
          : pending && !accepted
            ? `accept-mailchimp-ast-export-lane:${lane.id}`
            : retryRequested
              ? `retry-mailchimp-ast-export-lane:${lane.id}`
              : lane.nextAction ?? "publish-mailchimp-ast-export-lane",
    });
  });
  const timelineCommands = (batchSummary.timeline ?? []).map((event) => {
    const jobName = event.jobName ?? `event-${event.index}`;
    const commandId = `mailchimp-ast-timeline:${event.index}:${jobName}`;
    const completed = completedLaneIds.has(commandId);
    const status = event.status === "blocked"
      ? "blocked"
      : completed
        ? "ready"
        : event.status === "needsAcceptance"
          ? "pending"
          : event.status === "review"
            ? "review"
            : "ready";

    return Object.freeze({
      id: commandId,
      kind: "mailchimpAstTimelineEvent",
      laneId: "timeline",
      status,
      sourceStatus: event.status,
      jobName,
      accepted: true,
      completed,
      restartSafe: status !== "blocked",
      idempotencyKey: [
        batchSummary.fileName,
        batchSummary.revision,
        batchSummary.handoff?.syncKey ?? "mailchimp-ast-export",
        "timeline",
        event.index,
        jobName,
      ].join(":"),
      nextAction: status === "blocked"
        ? event.nextAction
        : completed
          ? "retain-mailchimp-ast-timeline-event"
          : event.nextAction ?? "publish-mailchimp-ast-timeline-event",
    });
  });
  const commands = Object.freeze([...laneCommands, ...timelineCommands]
    .sort((left, right) => left.status.localeCompare(right.status)
      || left.kind.localeCompare(right.kind)
      || left.id.localeCompare(right.id)));
  const counters = {};
  for (const command of commands) {
    incrementCounter(counters, command.status);
    incrementCounter(counters, `kind:${command.kind}`);
  }
  const blocked = commands.filter((command) => command.status === "blocked");
  const pending = commands.filter((command) => command.status === "pending");
  const review = commands.filter((command) => command.status === "review");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : batchSummary.status;

  return Object.freeze({
    version: "mailchimp-ast-export-resume-ledger.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "empty" || status === "review",
    providerId: batchSummary.providerId,
    fileName: batchSummary.fileName,
    revision: batchSummary.revision,
    exportAllowed: (status === "ready" || status === "idle" || status === "empty" || status === "review")
      && batchSummary.exportAllowed !== false,
    restartSafe: blocked.length === 0 && commands.every((command) => command.restartSafe !== false),
    counters: freezeSortedRecord(counters),
    totals: Object.freeze({
      commandCount: commands.length,
      laneCommandCount: laneCommands.length,
      timelineCommandCount: timelineCommands.length,
      blockedCommandCount: blocked.length,
      pendingCommandCount: pending.length,
      reviewCommandCount: review.length,
      completedCommandCount: commands.filter((command) => command.completed).length,
    }),
    commands,
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/ast-export/recovery"
        : status === "pending"
          ? "mailchimp/ast-export/acceptance"
          : "mailchimp/ast-export/resume",
      restartSafe: blocked.length === 0,
      blockedCommandIds: Object.freeze(blocked.map((command) => command.id).sort()),
      pendingCommandIds: Object.freeze(pending.map((command) => command.id).sort()),
      reviewCommandIds: Object.freeze(review.map((command) => command.id).sort()),
      idempotencyKeys: Object.freeze(commands
        .map((command) => command.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? batchSummary.handoff?.nextAction
        ?? "publish-mailchimp-ast-export-resume-ledger",
    }),
    batchSummary,
  });
}

export function createMailchimpAstExportCheckpointReport(ast = {}, settings = {}) {
  const evidence = settings.astEvidence?.version === "mailchimp-ast-export-evidence.v1"
    ? settings.astEvidence
    : createMailchimpAstExportEvidence(ast, settings);
  const batchSummary = settings.astExportBatchSummary?.version === "mailchimp-ast-export-batch-summary.v1"
    ? settings.astExportBatchSummary
    : createMailchimpAstExportBatchSummary(ast, { ...settings, astEvidence: evidence });
  const resumeLedger = settings.astExportResumeLedger?.version === "mailchimp-ast-export-resume-ledger.v1"
    ? settings.astExportResumeLedger
    : createMailchimpAstExportResumeLedger(ast, { ...settings, astEvidence: evidence, astExportBatchSummary: batchSummary });
  const campaignQueue = settings.campaignExportQueue?.version === "mailchimp-campaign-export-queue.v1"
    ? settings.campaignExportQueue
    : createMailchimpCampaignExportQueue(ast, { ...settings, astEvidence: evidence, astExportBatchSummary: batchSummary });
  const acceptedCheckpointIds = normalizeStringSet(settings.acceptedMailchimpAstCheckpointIds);
  const completedCheckpointIds = normalizeStringSet(settings.completedMailchimpAstCheckpointIds);
  const checkpoints = [
    ...createAstCheckpointRowsFromBatch(batchSummary),
    ...createAstCheckpointRowsFromResume(resumeLedger),
    ...createAstCheckpointRowsFromQueue(campaignQueue),
  ].map((row) => normalizeMailchimpAstCheckpointRow(row, {
    acceptedCheckpointIds,
    completedCheckpointIds,
    requireAcceptance: settings.requireMailchimpAstCheckpointAcceptance,
    revision: settings.revision,
    fileName: evidence.fileName ?? settings.fileName ?? "inline.aios",
  }));
  const blocked = checkpoints.filter((row) => row.status === "blocked");
  const pending = checkpoints.filter((row) => row.status === "pending");
  const review = checkpoints.filter((row) => row.status === "review" || row.status === "needsAcceptance");
  const incomplete = checkpoints.filter((row) => !row.completed);
  const status = evidence.status === "blocked" || blocked.length
    ? "blocked"
    : pending.length || (settings.requireMailchimpAstCheckpointCompletion === true && incomplete.length)
      ? "pending"
      : review.length
        ? "review"
        : checkpoints.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-ast-export-checkpoint-report.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    providerId: evidence.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    fileName: evidence.fileName ?? settings.fileName ?? "inline.aios",
    revision: settings.revision ?? "working",
    exportAllowed: status === "ready" || (status === "review" && settings.allowReviewCheckpointExport === true),
    restartSafe: blocked.length === 0 && resumeLedger.restartSafe !== false && campaignQueue.restartEnvelope?.restartSafe !== false,
    checkpoints: Object.freeze(checkpoints.sort(compareMailchimpAstCheckpointRows)),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countAstCheckpointField(checkpoints, "status")),
      byKind: freezeSortedRecord(countAstCheckpointField(checkpoints, "kind")),
      byHandoff: freezeSortedRecord(countAstCheckpointField(checkpoints, "handoff")),
      byCompletion: freezeSortedRecord(countAstCheckpointCompletion(checkpoints)),
    }),
    totals: Object.freeze({
      checkpointCount: checkpoints.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      completedCount: checkpoints.filter((row) => row.completed).length,
      incompleteCount: incomplete.length,
      timelineEventCount: batchSummary.totals?.timelineEventCount ?? 0,
      historySnapshotCount: batchSummary.totals?.historySnapshotCount ?? 0,
      queuedCampaignCount: campaignQueue.totals?.queuedCount ?? 0,
    }),
    acceptance: Object.freeze({
      mode: settings.requireMailchimpAstCheckpointAcceptance === false ? "implicit" : "explicit",
      acceptable: status !== "blocked" && (settings.requireMailchimpAstCheckpointAcceptance === false || pending.length === 0),
      requiredCheckpointIds: Object.freeze(checkpoints.map((row) => row.id).sort()),
      acceptedCheckpointIds: Object.freeze([...acceptedCheckpointIds].sort()),
      pendingCheckpointIds: Object.freeze(settings.requireMailchimpAstCheckpointAcceptance === false ? [] : pending.map((row) => row.id).sort()),
      completedCheckpointIds: Object.freeze([...completedCheckpointIds].sort()),
    }),
    timeline: Object.freeze((batchSummary.timeline ?? []).map((event, index) => Object.freeze({
      index,
      phase: "ast-export",
      status: event.status,
      jobName: event.jobName,
      nextAction: event.nextAction,
    }))),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/ast-checkpoints/recovery"
        : status === "pending"
          ? "mailchimp/ast-checkpoints/acceptance"
          : status === "review"
            ? "mailchimp/ast-checkpoints/review"
            : "mailchimp/ast-checkpoints/summary",
      restartSafe: blocked.length === 0,
      idempotencyKeys: Object.freeze(checkpoints.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      blockedCheckpointIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingCheckpointIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewCheckpointIds: Object.freeze(review.map((row) => row.id).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? incomplete[0]?.nextAction
        ?? "publish-mailchimp-ast-checkpoint-report",
    }),
    evidence,
    batchSummary,
    resumeLedger,
    campaignQueue,
  });
}

export function createMailchimpCampaignReleaseContract(state = {}, options = {}) {
  const workflowPreview = state.workflowPreview ?? state.mailchimpWorkflowPreview ?? null;
  const handoff = state.handoff ?? state.mailchimpHandoff ?? null;
  const launchGate = state.launchGate ?? state.mailchimpLaunchGate ?? null;
  const launchHandoff = state.launchHandoff ?? state.mailchimpLaunchHandoff ?? null;
  const runtimeTargets = state.runtimeTargets ?? state.mailchimpRuntimeTargets ?? null;
  const runtimeRequest = state.runtimeRequest ?? state.mailchimpRuntimeRequest ?? null;
  const astBatch = state.astBatch ?? state.astExportBatchSummary ?? null;
  const astResume = state.astResume ?? state.mailchimpAstExportResumeLedger ?? null;
  const campaignQueue = state.campaignQueue ?? state.mailchimpCampaignExportQueue ?? null;
  const sourceAnchors = state.sourceAnchors ?? state.mailchimpSourceAnchorHandoff ?? null;
  const sourceProvider = state.sourceProvider ?? state.sourceProviderExportSummary ?? null;
  const sourceClient = state.sourceClientAcceptance ?? state.sourceClientAcceptanceSummary ?? null;
  const sourceCommands = state.sourceCommands ?? state.sourceRangeClientCommandPacket ?? null;
  const diagnostics = state.diagnosticCommandSummary ?? state.diagnostics ?? null;
  const diagnosticAdoption = state.diagnosticClientRuntimeAdoption ?? null;
  const scheduleWindow = state.scheduleWindow ?? state.mailchimpScheduleWindowRuntime ?? null;
  const exportDecision = state.exportDecision ?? state.mailchimpExportDecision ?? null;
  const formatterLifecycle = state.formatterLifecycle ?? null;
  const providerIncident = state.providerIncident ?? state.mailchimpProviderIncidentContract ?? null;
  const acceptedLaneIds = normalizeStringSet(options.acceptedMailchimpReleaseLaneIds ?? options.acceptedReleaseLaneIds);
  const requiredLaneIds = normalizeStringSet(options.requiredMailchimpReleaseLaneIds ?? options.requiredReleaseLaneIds);
  const releaseId = String(options.releaseId ?? options.externalRunId ?? options.revision ?? "working").trim() || "working";
  const lanes = [
    campaignReleaseLane("workflow-preview", {
      label: "Workflow preview",
      status: workflowPreview?.status ?? "idle",
      exportAllowed: workflowPreview?.readiness?.exportAllowed !== false,
      restartSafe: workflowPreview?.status !== "blocked",
      count: workflowPreview?.preview?.jobs?.length ?? 0,
      route: "mailchimp/workflow-preview",
      nextAction: workflowPreview?.readiness?.nextAction ?? "publish-mailchimp-workflow-contract",
      idempotencyKey: workflowPreview?.previewVersion ?? null,
    }),
    campaignReleaseLane("provider-handoff", {
      label: "Provider handoff",
      status: handoff?.status ?? "idle",
      exportAllowed: handoff?.exportAllowed !== false,
      restartSafe: handoff?.commandContract?.restartSafe !== false && handoff?.receiptContract?.restartSafe !== false,
      count: handoff?.operations?.length ?? 0,
      route: "mailchimp/provider-handoff",
      nextAction: handoff?.nextAction ?? "publish-mailchimp-provider-handoff",
      idempotencyKey: handoff?.syncMetadata?.serviceSyncKey ?? null,
    }),
    campaignReleaseLane("launch-gates", {
      label: "Launch gates",
      status: launchHandoff?.status ?? launchGate?.status ?? "idle",
      exportAllowed: launchHandoff?.exportAllowed ?? launchGate?.exportAllowed ?? true,
      restartSafe: launchHandoff?.runtime?.restartSafe ?? launchGate?.handoff?.restartSafe ?? true,
      count: launchHandoff?.validationSummary?.gateCount ?? launchGate?.totals?.gateCount ?? 0,
      route: launchHandoff?.runtime?.route ?? launchGate?.handoff?.route ?? "mailchimp/launch/summary",
      nextAction: launchHandoff?.nextAction ?? launchGate?.handoff?.nextAction ?? "publish-mailchimp-launch-gates",
      idempotencyKey: launchHandoff?.syncKey ?? launchGate?.handoff?.syncKey ?? null,
    }),
    campaignReleaseLane("runtime-targets", {
      label: "Runtime targets",
      status: runtimeTargets?.status ?? "idle",
      exportAllowed: runtimeTargets?.exportAllowed !== false,
      restartSafe: runtimeTargets?.restartEnvelope?.restartSafe !== false,
      count: runtimeTargets?.targets?.length ?? 0,
      route: runtimeTargets?.restartEnvelope?.route ?? "mailchimp/runtime-targets",
      nextAction: runtimeTargets?.restartEnvelope?.nextAction ?? "publish-mailchimp-runtime-targets",
      idempotencyKey: runtimeTargets?.syncKey ?? null,
    }),
    campaignReleaseLane("runtime-request", {
      label: "Runtime request",
      status: runtimeRequest?.status ?? "idle",
      exportAllowed: runtimeRequest?.exportAllowed !== false,
      restartSafe: runtimeRequest?.restartEnvelope?.restartSafe !== false,
      count: runtimeRequest?.totals?.rowCount ?? 0,
      route: runtimeRequest?.restartEnvelope?.route ?? "mailchimp/runtime-request",
      nextAction: runtimeRequest?.restartEnvelope?.nextAction ?? "publish-mailchimp-runtime-request",
      idempotencyKey: runtimeRequest?.syncKey ?? null,
    }),
    campaignReleaseLane("ast-batch", {
      label: "AST batch evidence",
      status: astBatch?.status ?? "idle",
      exportAllowed: astBatch?.exportAllowed !== false,
      restartSafe: astBatch?.handoff?.restartSafe !== false,
      count: astBatch?.totals?.exportLaneCount ?? 0,
      route: "mailchimp/ast-export-batch",
      nextAction: astBatch?.handoff?.nextAction ?? "publish-mailchimp-ast-export-batch",
      idempotencyKey: astBatch?.handoff?.syncKey ?? null,
    }),
    campaignReleaseLane("ast-resume", {
      label: "AST resume ledger",
      status: astResume?.status ?? "idle",
      exportAllowed: astResume?.exportAllowed !== false,
      restartSafe: astResume?.restartEnvelope?.restartSafe !== false,
      count: astResume?.totals?.laneCount ?? astResume?.lanes?.length ?? 0,
      route: astResume?.restartEnvelope?.route ?? "mailchimp/ast-resume",
      nextAction: astResume?.restartEnvelope?.nextAction ?? "publish-mailchimp-ast-resume-ledger",
      idempotencyKey: astResume?.syncKey ?? null,
    }),
    campaignReleaseLane("campaign-queue", {
      label: "Campaign export queue",
      status: campaignQueue?.status ?? "idle",
      exportAllowed: campaignQueue?.exportAllowed !== false,
      restartSafe: campaignQueue?.restartEnvelope?.restartSafe !== false,
      count: campaignQueue?.totals?.queueCount ?? 0,
      route: campaignQueue?.restartEnvelope?.route ?? "mailchimp/campaign-export-queue",
      nextAction: campaignQueue?.restartEnvelope?.nextAction ?? "publish-mailchimp-campaign-export-queue",
      idempotencyKey: campaignQueue?.exportSummary?.syncKey ?? null,
    }),
    campaignReleaseLane("source-anchors", {
      label: "Source anchors",
      status: sourceAnchors?.status ?? sourceProvider?.status ?? "idle",
      exportAllowed: sourceAnchors?.exportAllowed ?? sourceProvider?.exportAllowed ?? true,
      restartSafe: sourceAnchors?.restartEnvelope?.restartSafe ?? sourceProvider?.handoff?.restartSafe ?? true,
      count: sourceAnchors?.totals?.operationCount ?? sourceProvider?.totals?.anchorCount ?? 0,
      route: sourceAnchors?.restartEnvelope?.route ?? sourceProvider?.handoff?.route ?? "source-ranges/provider-export",
      nextAction: sourceAnchors?.restartEnvelope?.nextAction ?? sourceProvider?.handoff?.nextAction ?? "publish-source-anchor-handoff",
      idempotencyKey: sourceAnchors?.syncKey ?? sourceProvider?.syncKey ?? null,
    }),
    campaignReleaseLane("source-client", {
      label: "Source client acceptance",
      status: sourceClient?.status ?? sourceCommands?.status ?? "idle",
      exportAllowed: sourceClient?.exportAllowed !== false && sourceCommands?.exportAllowed !== false,
      restartSafe: sourceClient?.restartEnvelope?.restartSafe !== false && sourceCommands?.restartEnvelope?.restartSafe !== false,
      count: (sourceClient?.totals?.rowCount ?? 0) + (sourceCommands?.totals?.commandCount ?? 0),
      route: sourceClient?.restartEnvelope?.route ?? sourceCommands?.restartEnvelope?.route ?? "source-ranges/client",
      nextAction: sourceClient?.restartEnvelope?.nextAction ?? sourceCommands?.restartEnvelope?.nextAction ?? "publish-source-client-handoff",
      idempotencyKey: [sourceClient?.syncKey, sourceCommands?.syncKey].filter(Boolean).join("|") || null,
    }),
    campaignReleaseLane("diagnostic-controls", {
      label: "Diagnostic controls",
      status: diagnostics?.status ?? diagnosticAdoption?.status ?? "idle",
      exportAllowed: diagnostics?.exportAllowed !== false && diagnosticAdoption?.exportAllowed !== false,
      restartSafe: diagnosticAdoption?.restartEnvelope?.restartSafe !== false,
      count: (diagnostics?.totals?.commandCount ?? 0) + (diagnosticAdoption?.totals?.rowCount ?? 0),
      route: diagnosticAdoption?.restartEnvelope?.route ?? "diagnostics/lifecycle-commands",
      nextAction: diagnostics?.recovery?.nextAction ?? diagnosticAdoption?.restartEnvelope?.nextAction ?? "publish-diagnostic-controls",
      idempotencyKey: diagnosticAdoption?.syncKey ?? diagnostics?.exportState?.exportSummary?.route ?? null,
    }),
    campaignReleaseLane("schedule-window", {
      label: "Schedule window",
      status: scheduleWindow?.status ?? "idle",
      exportAllowed: scheduleWindow?.exportAllowed !== false,
      restartSafe: scheduleWindow?.restartEnvelope?.restartSafe !== false,
      count: scheduleWindow?.totals?.windowCount ?? 0,
      route: scheduleWindow?.restartEnvelope?.route ?? "mailchimp/schedule-window",
      nextAction: scheduleWindow?.restartEnvelope?.nextAction ?? "publish-mailchimp-schedule-window",
      idempotencyKey: scheduleWindow?.syncKey ?? null,
    }),
    campaignReleaseLane("export-decision", {
      label: "Export decision",
      status: exportDecision?.status ?? "idle",
      exportAllowed: exportDecision?.exportAllowed !== false,
      restartSafe: exportDecision?.restartEnvelope?.restartSafe !== false,
      count: exportDecision?.totals?.laneCount ?? 0,
      route: exportDecision?.restartEnvelope?.route ?? "formatter/mailchimp-export/publish",
      nextAction: exportDecision?.restartEnvelope?.nextAction ?? "publish-formatter-mailchimp-export",
      idempotencyKey: exportDecision?.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
    }),
    campaignReleaseLane("formatter-lifecycle", {
      label: "Formatter lifecycle",
      status: formatterLifecycle?.status ?? "ready",
      exportAllowed: formatterLifecycle?.exportAllowed !== false,
      restartSafe: formatterLifecycle?.restartEnvelope?.restartSafe !== false,
      count: formatterLifecycle?.totals?.commandCount ?? 0,
      route: formatterLifecycle?.restartEnvelope?.route ?? "formatter/lifecycle/summary",
      nextAction: formatterLifecycle?.restartEnvelope?.nextAction ?? "publish-formatter-lifecycle-state",
      idempotencyKey: formatterLifecycle?.restartEnvelope?.idempotencyKeys?.join("|") ?? null,
    }),
    campaignReleaseLane("provider-incidents", {
      label: "Provider incidents",
      status: providerIncident?.status ?? "idle",
      exportAllowed: providerIncident?.exportAllowed !== false,
      restartSafe: providerIncident?.restartEnvelope?.restartSafe !== false,
      count: providerIncident?.totals?.incidentCount ?? 0,
      route: providerIncident?.restartEnvelope?.route ?? "mailchimp/incidents",
      nextAction: providerIncident?.restartEnvelope?.nextAction ?? "publish-mailchimp-provider-incidents",
      idempotencyKey: providerIncident?.syncKey ?? null,
    }),
  ].filter((lane) => requiredLaneIds.size === 0 || requiredLaneIds.has(lane.id));
  const acceptedLanes = lanes.map((lane) => Object.freeze({
    ...lane,
    accepted: acceptedLaneIds.has(lane.id) || options.requireMailchimpReleaseAcceptance === false,
    acceptanceState: acceptedLaneIds.has(lane.id) || options.requireMailchimpReleaseAcceptance === false
      ? "accepted"
      : lane.status === "ready" || lane.status === "idle"
        ? "pending"
        : "notReady",
  }));
  const blocked = acceptedLanes.filter((lane) => lane.status === "blocked" || lane.exportAllowed === false || lane.restartSafe === false);
  const pending = acceptedLanes.filter((lane) => lane.status === "pending" || lane.status === "needsAcceptance" || lane.acceptanceState === "pending");
  const review = acceptedLanes.filter((lane) => lane.status === "review" || lane.status === "degraded");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : acceptedLanes.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-campaign-release-contract.v1",
    status,
    ok: status === "ready" || status === "idle",
    providerId: handoff?.providerId ?? workflowPreview?.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    releaseId,
    revision: options.revision ?? "working",
    exportAllowed: status === "ready" || status === "idle",
    restartSafe: blocked.length === 0 && acceptedLanes.every((lane) => lane.restartSafe),
    lanes: Object.freeze(acceptedLanes.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpReleaseLanes(acceptedLanes, "status")),
      byRoute: freezeSortedRecord(countMailchimpReleaseLanes(acceptedLanes, "route")),
      byAcceptance: freezeSortedRecord(countMailchimpReleaseLanes(acceptedLanes, "acceptanceState")),
    }),
    totals: Object.freeze({
      laneCount: acceptedLanes.length,
      blockedLaneCount: blocked.length,
      pendingLaneCount: pending.length,
      reviewLaneCount: review.length,
      acceptedLaneCount: acceptedLanes.filter((lane) => lane.accepted).length,
    }),
    acceptance: Object.freeze({
      mode: options.requireMailchimpReleaseAcceptance === false ? "implicit" : "explicit",
      acceptable: status !== "blocked" && pending.length === 0,
      acceptedLaneIds: Object.freeze(acceptedLanes.filter((lane) => lane.accepted).map((lane) => lane.id).sort()),
      pendingLaneIds: Object.freeze(options.requireMailchimpReleaseAcceptance === false ? [] : pending.map((lane) => lane.id).sort()),
      requiredLaneIds: Object.freeze(acceptedLanes.map((lane) => lane.id).sort()),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/campaign-release/recovery"
        : status === "pending"
          ? "mailchimp/campaign-release/acceptance"
          : status === "review"
            ? "mailchimp/campaign-release/review"
            : "mailchimp/campaign-release/export",
      restartSafe: blocked.length === 0 && acceptedLanes.every((lane) => lane.restartSafe),
      blockedLaneIds: Object.freeze(blocked.map((lane) => lane.id).sort()),
      pendingLaneIds: Object.freeze(pending.map((lane) => lane.id).sort()),
      reviewLaneIds: Object.freeze(review.map((lane) => lane.id).sort()),
      idempotencyKeys: Object.freeze(acceptedLanes.map((lane) => lane.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-campaign-release",
    }),
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

export function createMailchimpClientRuntimeRequestContract(runtimeTargetsOrAst = {}, settings = {}) {
  const runtimeTargets = runtimeTargetsOrAst?.version === "mailchimp-client-runtime-targets.v1"
    ? runtimeTargetsOrAst
    : createMailchimpClientRuntimeTargets(runtimeTargetsOrAst, settings);
  const request = normalizeMailchimpClientRuntimeRequest(settings);
  const acceptedTargetIds = normalizeStringSet(settings.acceptedMailchimpRuntimeRequestTargetIds);
  const completedTargetIds = normalizeStringSet(settings.completedMailchimpRuntimeRequestTargetIds);
  const failedTargetIds = normalizeStringSet(settings.failedMailchimpRuntimeRequestTargetIds);
  const requireAcceptance = settings.requireMailchimpRuntimeRequestAcceptance !== false;
  const rows = (runtimeTargets.targets ?? []).map((target) => createMailchimpRuntimeRequestRow(target, {
    request,
    acceptedTargetIds,
    completedTargetIds,
    failedTargetIds,
    requireAcceptance,
  }));
  const missing = [];
  if (!request.clientRequestId) missing.push("clientRequestId");
  if (!request.sessionId) missing.push("sessionId");
  if (!request.workspaceId) missing.push("workspaceId");
  if (!request.route) missing.push("route");

  const requestShapeBlocked = missing.length > 0 && rows.length > 0;
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending" || row.status === "needsAcceptance");
  const review = rows.filter((row) => row.status === "review");
  const status = requestShapeBlocked || runtimeTargets.status === "blocked" || blocked.length
    ? "blocked"
    : runtimeTargets.status === "pending" || pending.length
      ? "pending"
      : runtimeTargets.status === "review" || review.length
        ? "review"
        : rows.length
          ? "ready"
          : "idle";
  const syncKey = [
    runtimeTargets.syncKey,
    request.clientRequestId ?? "request-unbound",
    request.sessionId ?? "session-unbound",
    request.workspaceId ?? "workspace-unbound",
    request.route ?? "route-unbound",
  ].join("|");
  const nextAction = requestShapeBlocked
    ? `bind-mailchimp-runtime-request:${missing[0]}`
    : blocked[0]?.nextAction
      ?? pending[0]?.nextAction
      ?? review[0]?.nextAction
      ?? runtimeTargets.restartEnvelope?.nextAction
      ?? "publish-mailchimp-runtime-request";

  return Object.freeze({
    version: "mailchimp-client-runtime-request.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    providerId: runtimeTargets.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    fileName: settings.fileName ?? "inline.aios",
    revision: settings.revision ?? "working",
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && settings.allowReviewMailchimpRuntimeRequest === true),
    restartSafe: !requestShapeBlocked && blocked.length === 0 && runtimeTargets.restartEnvelope?.restartSafe !== false,
    syncKey,
    request,
    rows: Object.freeze(rows.sort(compareMailchimpRuntimeRequestRows)),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpRuntimeRequestRows(rows, "status")),
      byRoute: freezeSortedRecord(countMailchimpRuntimeRequestRows(rows, "route")),
      byScheduleMode: freezeSortedRecord(countMailchimpRuntimeRequestRows(rows, "scheduleMode")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      blockedCount: blocked.length + (requestShapeBlocked ? 1 : 0),
      pendingCount: pending.length,
      reviewCount: review.length,
      missingRequestFieldCount: missing.length,
      acceptedTargetCount: rows.filter((row) => row.accepted).length,
      completedTargetCount: rows.filter((row) => row.completed).length,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: !requestShapeBlocked && status !== "blocked" && (!requireAcceptance || pending.length === 0),
      requiredTargetIds: Object.freeze(rows.map((row) => row.targetId).sort()),
      acceptedTargetIds: Object.freeze([...acceptedTargetIds].sort()),
      pendingTargetIds: Object.freeze(requireAcceptance ? pending.map((row) => row.targetId).sort() : []),
      completedTargetIds: Object.freeze([...completedTargetIds].sort()),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/runtime-request/recovery"
        : status === "pending"
          ? "mailchimp/runtime-request/acceptance"
          : status === "review"
            ? "mailchimp/runtime-request/review"
            : "mailchimp/runtime-request/summary",
      restartSafe: !requestShapeBlocked && blocked.length === 0 && runtimeTargets.restartEnvelope?.restartSafe !== false,
      blockedRowIds: Object.freeze([
        ...(requestShapeBlocked ? ["mailchimp-runtime-request:shape"] : []),
        ...blocked.map((row) => row.id),
      ].sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows
        .map((row) => row.idempotencyKey)
        .concat(syncKey)
        .filter(Boolean)
        .sort()),
      nextAction,
    }),
    userVisible: Object.freeze({
      title: "Mailchimp runtime request",
      detail: status === "ready" || status === "idle"
        ? "Mailchimp runtime targets are bound to the client request, session, workspace, and route."
        : requestShapeBlocked
          ? `Mailchimp runtime request is missing ${missing.join(", ")}.`
          : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review runtime request rows remain.`,
      nextAction,
    }),
    runtimeTargets,
  });
}

export function createMailchimpClientRuntimeHandoffCheckpoint(state = {}, settings = {}) {
  const requestPacket = state.mailchimpRuntimeRequest?.version === "mailchimp-client-runtime-request.v1"
    ? state.mailchimpRuntimeRequest
    : state.runtimeRequest?.version === "mailchimp-client-runtime-request.v1"
      ? state.runtimeRequest
      : null;
  const adoptionPacket = state.mailchimpClientRuntimeAdoption?.version === "mailchimp-client-runtime-adoption.v1"
    ? state.mailchimpClientRuntimeAdoption
    : state.clientRuntimeAdoption?.version === "mailchimp-client-runtime-adoption.v1"
      ? state.clientRuntimeAdoption
      : null;
  const workflowPacket = state.formatterClientRuntimeWorkflow?.version === "formatter-client-runtime-workflow.v1"
    ? state.formatterClientRuntimeWorkflow
    : state.clientRuntimeWorkflow?.version === "formatter-client-runtime-workflow.v1"
      ? state.clientRuntimeWorkflow
      : null;
  const accepted = normalizeStringSet(settings.acceptedMailchimpClientRuntimeCheckpointIds);
  const completed = normalizeStringSet(settings.completedMailchimpClientRuntimeCheckpointIds);
  const failed = normalizeStringSet(settings.failedMailchimpClientRuntimeCheckpointIds);
  const requireAcceptance = settings.requireMailchimpClientRuntimeCheckpointAcceptance !== false;
  const rows = Object.freeze([
    createMailchimpRuntimeCheckpointRow({
      id: "runtime-request",
      kind: "requestBinding",
      label: "Runtime request binding",
      status: requestPacket?.status ?? "blocked",
      sourceStatus: requestPacket?.status ?? "unbound",
      detail: requestPacket?.userVisible?.detail ?? "Mailchimp runtime request must bind request, session, workspace, and route state.",
      route: requestPacket?.restartEnvelope?.route ?? "mailchimp/runtime-request/recovery",
      count: requestPacket?.totals?.rowCount ?? 0,
      restartSafe: requestPacket?.restartSafe !== false && requestPacket?.restartEnvelope?.restartSafe !== false,
      exportAllowed: requestPacket?.exportAllowed === true,
      idempotencyKey: requestPacket?.syncKey ?? null,
      nextAction: requestPacket?.restartEnvelope?.nextAction ?? "bind-mailchimp-runtime-request",
    }, { accepted, completed, failed, requireAcceptance }),
    createMailchimpRuntimeCheckpointRow({
      id: "runtime-targets",
      kind: "targetReadiness",
      label: "Runtime target readiness",
      status: requestPacket?.runtimeTargets?.status ?? "blocked",
      sourceStatus: requestPacket?.runtimeTargets?.status ?? "unbound",
      detail: `${requestPacket?.runtimeTargets?.targets?.length ?? 0} Mailchimp runtime target(s) prepared for client handoff.`,
      route: requestPacket?.runtimeTargets?.restartEnvelope?.route ?? "mailchimp/runtime/summary",
      count: requestPacket?.runtimeTargets?.targets?.length ?? 0,
      restartSafe: requestPacket?.runtimeTargets?.restartEnvelope?.restartSafe !== false,
      exportAllowed: requestPacket?.runtimeTargets?.exportAllowed === true,
      idempotencyKey: requestPacket?.runtimeTargets?.syncKey ?? null,
      nextAction: requestPacket?.runtimeTargets?.restartEnvelope?.nextAction ?? "prepare-mailchimp-runtime-targets",
    }, { accepted, completed, failed, requireAcceptance }),
    createMailchimpRuntimeCheckpointRow({
      id: "adoption-packet",
      kind: "adoptionPacket",
      label: "Client runtime adoption packet",
      status: adoptionPacket?.status ?? "blocked",
      sourceStatus: adoptionPacket?.status ?? "unbound",
      detail: adoptionPacket?.userVisible?.detail ?? "Mailchimp client runtime adoption rows must settle before handoff.",
      route: adoptionPacket?.restartEnvelope?.route ?? "mailchimp/client-runtime-adoption/recovery",
      count: adoptionPacket?.totals?.rowCount ?? 0,
      restartSafe: adoptionPacket?.restartEnvelope?.restartSafe !== false,
      exportAllowed: adoptionPacket?.exportAllowed === true,
      idempotencyKey: adoptionPacket?.syncKey ?? null,
      nextAction: adoptionPacket?.restartEnvelope?.nextAction ?? "complete-mailchimp-client-runtime-adoption",
    }, { accepted, completed, failed, requireAcceptance }),
    createMailchimpRuntimeCheckpointRow({
      id: "workflow-lanes",
      kind: "workflowLaneSettlement",
      label: "Formatter workflow lane settlement",
      status: workflowPacket?.status ?? "blocked",
      sourceStatus: workflowPacket?.status ?? "unbound",
      detail: workflowPacket?.userVisible?.detail ?? "Formatter client runtime workflow lanes must be restart-safe for Mailchimp handoff.",
      route: workflowPacket?.restartEnvelope?.route ?? "formatter/client-runtime/recovery",
      count: workflowPacket?.totals?.laneCount ?? workflowPacket?.lanes?.length ?? 0,
      restartSafe: workflowPacket?.restartEnvelope?.restartSafe !== false,
      exportAllowed: workflowPacket?.exportAllowed === true,
      idempotencyKey: workflowPacket?.syncKey ?? null,
      nextAction: workflowPacket?.restartEnvelope?.nextAction ?? "settle-formatter-client-runtime-workflow",
    }, { accepted, completed, failed, requireAcceptance }),
  ].sort(compareMailchimpRuntimeCheckpointRows));
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review" || row.status === "degraded");
  const ready = rows.filter((row) => row.status === "ready");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : ready.length
          ? "ready"
          : "idle";
  const syncKey = [
    AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    settings.fileName ?? requestPacket?.fileName ?? "inline.aios",
    settings.revision ?? requestPacket?.revision ?? "working",
    requestPacket?.syncKey ?? "runtime-request-unbound",
    adoptionPacket?.syncKey ?? "adoption-unbound",
    workflowPacket?.syncKey ?? "workflow-unbound",
  ].join("|");

  return Object.freeze({
    version: "mailchimp-client-runtime-handoff-checkpoint.v1",
    providerId: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    fileName: settings.fileName ?? requestPacket?.fileName ?? "inline.aios",
    revision: settings.revision ?? requestPacket?.revision ?? "working",
    status,
    ok: status === "ready" || status === "review" || status === "idle",
    exportAllowed: status === "ready" || (status === "review" && settings.allowReviewMailchimpClientRuntimeCheckpoint === true),
    syncKey,
    rows,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpRuntimeCheckpointRows(rows, "status")),
      byKind: freezeSortedRecord(countMailchimpRuntimeCheckpointRows(rows, "kind")),
      byRoute: freezeSortedRecord(countMailchimpRuntimeCheckpointRows(rows, "route")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      readyCount: ready.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      acceptedCount: rows.filter((row) => row.accepted).length,
      completedCount: rows.filter((row) => row.completed).length,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pending.length === 0),
      requiredCheckpointIds: Object.freeze(rows.map((row) => row.id).sort()),
      acceptedCheckpointIds: Object.freeze(rows.filter((row) => row.accepted).map((row) => row.id).sort()),
      pendingCheckpointIds: Object.freeze(requireAcceptance ? pending.map((row) => row.id).sort() : []),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/client-runtime-checkpoint/recovery"
        : status === "pending"
          ? "mailchimp/client-runtime-checkpoint/acceptance"
          : status === "review"
            ? "mailchimp/client-runtime-checkpoint/review"
            : "mailchimp/client-runtime-checkpoint/summary",
      restartSafe: blocked.length === 0,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).concat(syncKey).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-client-runtime-checkpoint",
    }),
    userVisible: Object.freeze({
      title: "Mailchimp client runtime checkpoint",
      detail: status === "ready"
        ? "Mailchimp client runtime request, workflow lanes, and adoption rows are ready for handoff."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review checkpoint row(s) remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-client-runtime-checkpoint",
    }),
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
  const auditLedger = createMailchimpTenantPermissionAuditLedgerFromRows(auditRows, {
    revision: settings.revision ?? "working",
    externalRunId: settings.externalRunId,
    allowTenantBoundaryDegradedMode: settings.allowTenantBoundaryDegradedMode,
    retryAfterSecondsByReason: settings.retryAfterSecondsByReason,
    retryAfterSecondsByRowId: settings.retryAfterSecondsByRowId,
    maxRetryAttempts: settings.mailchimpTenantBoundaryMaxRetryAttempts ?? settings.maxRetryAttempts,
    attemptByRowId: settings.mailchimpTenantBoundaryAttemptByRowId ?? settings.attemptByRowId,
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
      ledgerByStatus: auditLedger.counters.byStatus,
      ledgerByRetryClass: auditLedger.counters.byRetryClass,
    }),
    totals: Object.freeze({
      jobCount: tenantBoundary.jobCount,
      boundaryCount: tenantBoundary.boundaries.length,
      operationCount: operationRows.length,
      auditEventCount: auditRows.length,
      blockedCount: blocked.length,
      reviewCount: review.length,
      retryableAuditRowCount: auditLedger.totals.retryableCount,
      degradedAuditRowCount: auditLedger.totals.degradedAllowedCount,
    }),
    operations: Object.freeze(operationRows),
    auditRows: Object.freeze(auditRows),
    auditLedger,
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

export function createMailchimpTenantPermissionAuditLedger(boundaryOrDecision = {}, settings = {}) {
  if (boundaryOrDecision?.version === "mailchimp-tenant-permission-decision.v1") {
    return createMailchimpTenantPermissionAuditLedgerFromRows(boundaryOrDecision.rows ?? [], {
      revision: settings.revision ?? "working",
      externalRunId: settings.externalRunId,
      syncKey: boundaryOrDecision.syncKey ?? boundaryOrDecision.boundaryContract?.syncKey,
      sourceStatus: boundaryOrDecision.status,
      allowTenantBoundaryDegradedMode: settings.allowTenantBoundaryDegradedMode,
      retryAfterSecondsByReason: settings.retryAfterSecondsByReason,
      retryAfterSecondsByRowId: settings.retryAfterSecondsByRowId,
      maxRetryAttempts: settings.mailchimpTenantBoundaryMaxRetryAttempts ?? settings.maxRetryAttempts,
      attemptByRowId: settings.mailchimpTenantBoundaryAttemptByRowId ?? settings.attemptByRowId,
    });
  }

  if (boundaryOrDecision?.version === "mailchimp-tenant-permission-boundary.v1") {
    return boundaryOrDecision.auditLedger?.version === "mailchimp-tenant-permission-audit-ledger.v1"
      ? boundaryOrDecision.auditLedger
      : createMailchimpTenantPermissionAuditLedgerFromRows(boundaryOrDecision.auditRows ?? [], {
        revision: settings.revision ?? "working",
        externalRunId: settings.externalRunId,
        syncKey: boundaryOrDecision.syncKey,
        sourceStatus: boundaryOrDecision.status,
        allowTenantBoundaryDegradedMode: settings.allowTenantBoundaryDegradedMode,
        retryAfterSecondsByReason: settings.retryAfterSecondsByReason,
        retryAfterSecondsByRowId: settings.retryAfterSecondsByRowId,
        maxRetryAttempts: settings.mailchimpTenantBoundaryMaxRetryAttempts ?? settings.maxRetryAttempts,
        attemptByRowId: settings.mailchimpTenantBoundaryAttemptByRowId ?? settings.attemptByRowId,
      });
  }

  if (Array.isArray(boundaryOrDecision)) {
    return createMailchimpTenantPermissionAuditLedgerFromRows(boundaryOrDecision, settings);
  }

  return createMailchimpTenantPermissionAuditLedgerFromRows([], settings);
}

export function createMailchimpTenantPermissionDecision(astOrBoundaryContract = {}, settings = {}) {
  const contract = astOrBoundaryContract?.version === "mailchimp-tenant-permission-boundary.v1"
    ? astOrBoundaryContract
    : createMailchimpTenantPermissionBoundaryContract(astOrBoundaryContract, settings);
  const requiredOperationIds = normalizeStringSet(settings.requiredMailchimpTenantOperationIds);
  const acceptedAuditRowIds = normalizeStringSet(settings.acceptedMailchimpTenantAuditRowIds);
  const acceptedJobNames = normalizeStringSet(settings.acceptedMailchimpTenantJobNames);
  const allowReviewHandoff = settings.allowReviewTenantPermissionHandoff === true;
  const rows = Array.isArray(contract.auditRows) ? contract.auditRows : [];
  const decisionRows = rows.map((row) => createMailchimpTenantPermissionDecisionRow(row, {
    acceptedAuditRowIds,
    acceptedJobNames,
    requiredOperationIds,
    requireAcceptance: settings.requireMailchimpTenantPermissionAcceptance !== false,
  }));
  const blocked = decisionRows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = decisionRows.filter((row) => row.status === "pending");
  const review = decisionRows.filter((row) => row.status === "review");
  const ready = decisionRows.filter((row) => row.status === "ready");
  const auditLedger = createMailchimpTenantPermissionAuditLedgerFromRows(decisionRows, {
    revision: settings.revision ?? "working",
    externalRunId: settings.externalRunId,
    syncKey: contract.syncKey,
    sourceStatus: contract.status,
    allowTenantBoundaryDegradedMode: settings.allowTenantBoundaryDegradedMode,
    retryAfterSecondsByReason: settings.retryAfterSecondsByReason,
    retryAfterSecondsByRowId: settings.retryAfterSecondsByRowId,
    maxRetryAttempts: settings.mailchimpTenantBoundaryMaxRetryAttempts ?? settings.maxRetryAttempts,
    attemptByRowId: settings.mailchimpTenantBoundaryAttemptByRowId ?? settings.attemptByRowId,
  });
  const status = contract.status === "blocked" || blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : contract.status === "review" || review.length
        ? "review"
        : contract.detected || decisionRows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-tenant-permission-decision.v1",
    providerId: contract.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    status,
    ok: status === "ready" || status === "idle" || (status === "review" && allowReviewHandoff),
    detected: Boolean(contract.detected),
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && allowReviewHandoff),
    restartSafe: blocked.length === 0 && contract.handoff?.restartSafe !== false,
    allowReviewHandoff,
    acceptance: Object.freeze({
      mode: settings.requireMailchimpTenantPermissionAcceptance === false ? "implicit" : "explicit",
      acceptable: blocked.length === 0 && pending.length === 0,
      acceptedAuditRowIds: Object.freeze(decisionRows.filter((row) => row.accepted).map((row) => row.auditRowId).sort()),
      pendingAuditRowIds: Object.freeze(pending.map((row) => row.auditRowId).sort()),
      requiredAuditRowIds: Object.freeze(decisionRows.map((row) => row.auditRowId).sort()),
    }),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpBoundaryRows(decisionRows, "status")),
      byTenant: freezeSortedRecord(countMailchimpBoundaryRows(decisionRows, "tenantId")),
      byWorkspace: freezeSortedRecord(countMailchimpBoundaryRows(decisionRows, "workspaceId")),
      byReason: freezeSortedRecord(countMailchimpTenantDecisionReasons(decisionRows)),
      byRetryClass: auditLedger.counters.byRetryClass,
      byDegradedMode: auditLedger.counters.byDegradedMode,
    }),
    totals: Object.freeze({
      rowCount: decisionRows.length,
      readyCount: ready.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      requiredOperationCount: requiredOperationIds.size,
      acceptedCount: decisionRows.filter((row) => row.accepted).length,
      retryableCount: auditLedger.totals.retryableCount,
      degradedAllowedCount: auditLedger.totals.degradedAllowedCount,
    }),
    rows: Object.freeze(decisionRows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    auditLedger,
    recovery: Object.freeze({
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? contract.recovery?.nextAction
        ?? "publish-mailchimp-tenant-permission-decision",
    }),
    handoff: Object.freeze({
      channel: "mailchimp-tenant-permission-decision",
      route: status === "blocked"
        ? "mailchimp/tenant-permission/recovery"
        : status === "pending"
          ? "mailchimp/tenant-permission/acceptance"
          : status === "review"
            ? "mailchimp/tenant-permission/review"
            : "mailchimp/tenant-permission/summary",
      restartSafe: blocked.length === 0 && contract.handoff?.restartSafe !== false,
      exportAllowed: status === "ready" || status === "idle" || (status === "review" && allowReviewHandoff),
      idempotencyKeys: Object.freeze(decisionRows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? contract.handoff?.nextAction
        ?? "publish-mailchimp-tenant-permission-decision",
    }),
    boundaryContract: contract,
  });
}

export function createMailchimpTenantSourceAnchorCorrelations(tenantPermissionDecision = {}, anchors = [], options = {}) {
  const decision = tenantPermissionDecision?.version === "mailchimp-tenant-permission-decision.v1"
    ? tenantPermissionDecision
    : createMailchimpTenantPermissionDecision(tenantPermissionDecision, options);
  const anchorRows = Array.isArray(anchors)
    ? anchors
    : Array.isArray(anchors?.anchors)
      ? anchors.anchors
      : [];
  const decisionRows = Array.isArray(decision.rows) ? decision.rows : [];
  const rowByJobName = new Map();
  const rowByOperationId = new Map();

  for (const row of decisionRows) {
    if (row.jobName) rowByJobName.set(String(row.jobName), row);
    if (row.operationId) rowByOperationId.set(String(row.operationId), row);
  }

  const correlations = anchorRows.map((anchor, index) => {
    const key = selectMailchimpTenantSourceAnchorKey(anchor, options);
    const decisionRow = key.operationId
      ? rowByOperationId.get(key.operationId) ?? rowByJobName.get(key.jobName)
      : rowByJobName.get(key.jobName);
    return createMailchimpTenantSourceAnchorCorrelationRow(anchor, decisionRow, {
      index,
      key,
      decision,
    });
  });
  const unanchoredDecisionRows = decisionRows
    .filter((row) => row.status !== "ready" && !correlations.some((correlation) => correlation.auditRowId === row.auditRowId))
    .map((row, index) => createMailchimpTenantSourceAnchorCorrelationRow(null, row, {
      index: correlations.length + index,
      key: {
        jobName: row.jobName ?? "workflow",
        operationId: row.operationId ?? null,
      },
      decision,
    }));
  const rows = Object.freeze([...correlations, ...unanchoredDecisionRows]
    .sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id)));
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false);
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review");
  const status = decision.status === "blocked" || blocked.length
    ? "blocked"
    : decision.status === "pending" || pending.length
      ? "pending"
      : decision.status === "review" || review.length
        ? "review"
        : rows.length || decision.detected
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-tenant-source-anchor-correlations.v1",
    providerId: decision.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    status,
    ok: status === "ready" || status === "idle" || (status === "review" && decision.allowReviewHandoff === true),
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && decision.allowReviewHandoff === true),
    restartSafe: blocked.length === 0 && decision.restartSafe !== false,
    syncKey: [
      decision.boundaryContract?.syncKey ?? "mailchimp-tenant-decision",
      rows.map((row) => row.idempotencyKey).join(".") || "no-source-anchors",
      options.revision ?? "working",
    ].join("|"),
    rows,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpBoundaryRows(rows, "status")),
      byAnchorType: freezeSortedRecord(countMailchimpBoundaryRows(rows, "anchorType")),
      byTenant: freezeSortedRecord(countMailchimpBoundaryRows(rows, "tenantId")),
      byWorkspace: freezeSortedRecord(countMailchimpBoundaryRows(rows, "workspaceId")),
      byReason: freezeSortedRecord(countMailchimpTenantDecisionReasons(rows)),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      anchoredCount: rows.filter((row) => row.anchorId).length,
      unanchoredDecisionCount: rows.filter((row) => !row.anchorId && row.auditRowId).length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
    }),
    recovery: Object.freeze({
      blockedAnchorIds: Object.freeze(blocked.map((row) => row.anchorId).filter(Boolean).sort()),
      pendingAnchorIds: Object.freeze(pending.map((row) => row.anchorId).filter(Boolean).sort()),
      reviewAnchorIds: Object.freeze(review.map((row) => row.anchorId).filter(Boolean).sort()),
      unanchoredAuditRowIds: Object.freeze(rows
        .filter((row) => !row.anchorId && row.auditRowId)
        .map((row) => row.auditRowId)
        .sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? decision.recovery?.nextAction
        ?? "publish-mailchimp-tenant-source-anchor-correlations",
    }),
    handoff: Object.freeze({
      channel: "mailchimp-tenant-source-anchor-boundary",
      route: status === "blocked"
        ? "mailchimp/tenant-source-anchors/recovery"
        : status === "pending"
          ? "mailchimp/tenant-source-anchors/acceptance"
          : status === "review"
            ? "mailchimp/tenant-source-anchors/review"
            : "mailchimp/tenant-source-anchors/summary",
      restartSafe: blocked.length === 0 && decision.restartSafe !== false,
      exportAllowed: status === "ready" || status === "idle" || (status === "review" && decision.allowReviewHandoff === true),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-tenant-source-anchor-correlations",
    }),
    tenantPermissionDecision: decision,
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
  const serviceSyncWindows = createMailchimpProviderServiceSyncWindows(operations, {
    syncMetadata,
    tenantBoundary,
    revision: options.revision,
    externalRunId: options.externalRunId,
    requireServiceSyncWindowAcceptance: options.requireServiceSyncWindowAcceptance,
    acceptedServiceSyncWindowIds: options.acceptedServiceSyncWindowIds,
  });
  const blockedWindows = serviceSyncWindows.windows.filter((window) => window.status === "blocked");
  const pendingWindows = serviceSyncWindows.windows.filter((window) => window.status === "pending");
  const reviewWindows = serviceSyncWindows.windows.filter((window) => window.status === "review");
  const status = !workflowState.detected && detectedJobs.length === 0
    ? "idle"
    : tenantBoundary.status === "blocked" || blockedCapabilities.length || blockedOperations.length || blockedWindows.length
      ? "blocked"
      : tenantBoundary.status === "review" || reviewOperations.length || pendingWindows.length || reviewWindows.length
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
    serviceSyncWindows,
    externalHandoff: Object.freeze({
      status,
      syncKey: syncMetadata.syncKey,
      externalRunId: syncMetadata.externalRunId,
      operationCount: operations.length,
      blockedOperationCount: blockedOperations.length,
      serviceWindowStatus: serviceSyncWindows.status,
      blockedServiceWindowCount: blockedWindows.length,
      pendingServiceWindowCount: pendingWindows.length,
      tenantBoundaryStatus: tenantBoundary.status,
      tenantAuditEventCount: tenantBoundary.audit.eventCount,
      channels: Object.freeze([...new Set(operations.map((operation) => operation.syncChannel))].sort()),
      commandContractStatus: createMailchimpProviderCommandContract({
        ...workflowState,
        providerContract: { operations, syncMetadata },
      }, options).status,
      nextAction: serviceSyncWindows.status === "blocked" || serviceSyncWindows.status === "pending" || serviceSyncWindows.status === "review"
        ? serviceSyncWindows.nextAction
        : tenantBoundary.status === "blocked" || tenantBoundary.status === "review"
        ? tenantBoundary.nextAction
        : selectMailchimpProviderServiceNextAction(status, blockedCapabilities, blockedOperations, reviewOperations),
    }),
  });
}

export function createMailchimpProviderServiceSyncCheckpoint(serviceContractOrWorkflowState = {}, options = {}) {
  const serviceContract = serviceContractOrWorkflowState?.serviceContractVersion === "mailchimp-provider-service.v1"
    ? serviceContractOrWorkflowState
    : serviceContractOrWorkflowState?.providerContract?.serviceContractVersion === "mailchimp-provider-service.v1"
      ? serviceContractOrWorkflowState.providerContract
      : createMailchimpProviderServiceContract(serviceContractOrWorkflowState, options);
  const serviceSyncWindows = serviceContract.serviceSyncWindows ?? createMailchimpProviderServiceSyncWindows(
    serviceContract.operations ?? [],
    {
      syncMetadata: serviceContract.syncMetadata,
      revision: options.revision,
      externalRunId: options.externalRunId,
      requireServiceSyncWindowAcceptance: options.requireServiceSyncWindowAcceptance,
      acceptedServiceSyncWindowIds: options.acceptedServiceSyncWindowIds,
    },
  );
  const requiredWindowIds = normalizeStringSet(options.requiredServiceSyncWindowIds);
  const acceptedWindowIds = normalizeStringSet(options.acceptedServiceSyncWindowIds);
  const completedWindowIds = normalizeStringSet(options.completedServiceSyncWindowIds);
  const failedWindowIds = normalizeStringSet(options.failedServiceSyncWindowIds);
  const requireAcceptance = options.requireServiceSyncWindowAcceptance === true
    || serviceSyncWindows.requireAcceptance === true;
  const rows = (serviceSyncWindows.windows ?? []).map((window) => {
    const required = requiredWindowIds.size === 0
      || requiredWindowIds.has(window.id)
      || requiredWindowIds.has(window.channel);
    const accepted = window.accepted
      || acceptedWindowIds.has(window.id)
      || acceptedWindowIds.has(window.channel)
      || !requireAcceptance
      || !required;
    const completed = completedWindowIds.has(window.id) || completedWindowIds.has(window.channel);
    const failed = failedWindowIds.has(window.id) || failedWindowIds.has(window.channel);
    const blocked = failed || window.status === "blocked" || window.restartSafe === false;
    const pending = !blocked && required && !accepted;
    const review = !blocked && !pending && window.status === "review";
    const status = blocked
      ? "blocked"
      : completed
        ? "ready"
        : pending
          ? "pending"
          : review
            ? "review"
            : window.status === "pending"
              ? "pending"
              : "ready";

    return Object.freeze({
      id: `mailchimp-service-sync-checkpoint:${window.id}`,
      windowId: window.id,
      channel: window.channel,
      status,
      sourceStatus: window.status,
      required,
      accepted,
      completed,
      failed,
      restartSafe: !blocked && window.restartSafe !== false,
      operationCount: window.operationCount ?? 0,
      operationIds: window.operationIds ?? Object.freeze([]),
      services: window.services ?? Object.freeze([]),
      tenants: window.tenants ?? Object.freeze([]),
      workspaces: window.workspaces ?? Object.freeze([]),
      externalState: window.externalState ?? Object.freeze({}),
      idempotencyKey: [
        serviceContract.syncMetadata?.syncKey ?? "mailchimp-service",
        "checkpoint",
        window.id,
        window.idempotencyKey ?? "window-unbound",
      ].join(":"),
      nextAction: blocked
        ? failed
          ? "retry-mailchimp-service-sync-window"
          : window.nextAction ?? "repair-mailchimp-service-sync-window"
        : completed
          ? "retain-mailchimp-service-sync-checkpoint"
          : pending
            ? "accept-mailchimp-service-sync-window"
            : review
              ? window.nextAction ?? "review-mailchimp-service-sync-window"
              : "publish-mailchimp-service-sync-checkpoint",
    });
  });
  const blocked = rows.filter((row) => row.status === "blocked");
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review");
  const completed = rows.filter((row) => row.completed);
  const status = serviceContract.status === "blocked" || serviceSyncWindows.status === "blocked" || blocked.length
    ? "blocked"
    : pending.length || serviceSyncWindows.status === "pending"
      ? "pending"
      : review.length || serviceSyncWindows.status === "review"
        ? "review"
        : rows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-service-sync-checkpoint.v1",
    status,
    ok: status === "ready" || status === "idle" || (status === "review" && options.allowReviewServiceSyncCheckpoint === true),
    providerId: serviceContract.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    detected: serviceContract.detected === true,
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && options.allowReviewServiceSyncCheckpoint === true),
    restartSafe: blocked.length === 0 && serviceContract.externalHandoff?.status !== "blocked",
    syncKey: [
      serviceContract.syncMetadata?.syncKey ?? "mailchimp-service-unbound",
      serviceSyncWindows.status ?? "idle",
      rows.map((row) => `${row.windowId}:${row.status}:${row.accepted}:${row.completed}`).join(",") || "no-service-windows",
      options.revision ?? serviceContract.syncMetadata?.revision ?? "working",
    ].join("|"),
    rows: Object.freeze(rows.sort((left, right) => left.status.localeCompare(right.status) || left.channel.localeCompare(right.channel))),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpWindowField(rows, "status")),
      byChannel: freezeSortedRecord(countMailchimpWindowField(rows, "channel")),
      bySourceStatus: freezeSortedRecord(countMailchimpWindowField(rows, "sourceStatus")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      windowCount: serviceSyncWindows.windowCount ?? rows.length,
      operationCount: serviceSyncWindows.operationCount ?? rows.reduce((total, row) => total + row.operationCount, 0),
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      completedCount: completed.length,
      acceptedCount: rows.filter((row) => row.accepted).length,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pending.length === 0),
      requiredWindowIds: Object.freeze(rows.filter((row) => row.required).map((row) => row.windowId).sort()),
      acceptedWindowIds: Object.freeze(rows.filter((row) => row.accepted).map((row) => row.windowId).sort()),
      pendingWindowIds: Object.freeze(requireAcceptance ? pending.map((row) => row.windowId).sort() : []),
      completedWindowIds: Object.freeze([...completedWindowIds].sort()),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/service-sync-checkpoint/recovery"
        : status === "pending"
          ? "mailchimp/service-sync-checkpoint/acceptance"
          : status === "review"
            ? "mailchimp/service-sync-checkpoint/review"
            : "mailchimp/service-sync-checkpoint/summary",
      restartSafe: blocked.length === 0,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? serviceSyncWindows.nextAction
        ?? "publish-mailchimp-service-sync-checkpoint",
    }),
    userVisible: Object.freeze({
      title: "Mailchimp service sync checkpoint",
      detail: status === "idle"
        ? "No Mailchimp service sync windows were detected."
        : `${rows.length} service sync window(s) cover ${serviceSyncWindows.operationCount ?? 0} provider operation(s).`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-service-sync-checkpoint",
    }),
    serviceSyncWindows,
  });
}

export function createMailchimpProviderServiceReadinessMatrix(serviceContractOrWorkflowState = {}, options = {}) {
  const serviceContract = serviceContractOrWorkflowState?.serviceContractVersion === "mailchimp-provider-service.v1"
    ? serviceContractOrWorkflowState
    : serviceContractOrWorkflowState?.providerContract?.serviceContractVersion === "mailchimp-provider-service.v1"
      ? serviceContractOrWorkflowState.providerContract
      : createMailchimpProviderServiceContract(serviceContractOrWorkflowState, options);
  const checkpoint = options.serviceSyncCheckpoint?.version === "mailchimp-service-sync-checkpoint.v1"
    ? options.serviceSyncCheckpoint
    : createMailchimpProviderServiceSyncCheckpoint(serviceContract, options);
  const operations = Array.isArray(serviceContract.operations) ? serviceContract.operations : [];
  const serviceContracts = listMailchimpProviderServiceContracts();
  const rows = serviceContracts.map((contract) => createMailchimpProviderServiceReadinessRow(contract, {
    serviceContract,
    checkpoint,
    operations,
    allowDegradedOptionalServices: options.allowDegradedOptionalServices === true,
  }));
  const blocked = rows.filter((row) => row.status === "blocked");
  const pending = rows.filter((row) => row.status === "pending");
  const degraded = rows.filter((row) => row.status === "degraded");
  const review = rows.filter((row) => row.status === "review");
  const ready = rows.filter((row) => row.status === "ready");
  const status = serviceContract.status === "blocked" || checkpoint.status === "blocked" || blocked.length
    ? "blocked"
    : checkpoint.status === "pending" || pending.length
      ? "pending"
      : degraded.length
        ? "degraded"
        : checkpoint.status === "review" || review.length
          ? "review"
          : rows.some((row) => row.operationCount > 0)
            ? "ready"
            : "idle";

  return Object.freeze({
    version: "mailchimp-provider-service-readiness-matrix.v1",
    status,
    ok: status === "ready" || status === "idle" || (status === "degraded" && options.allowDegradedOptionalServices === true),
    providerId: serviceContract.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    detected: serviceContract.detected === true,
    exportAllowed: (status === "ready" || status === "idle" || (status === "degraded" && options.allowDegradedOptionalServices === true))
      && checkpoint.exportAllowed !== false,
    restartSafe: checkpoint.restartSafe !== false && blocked.length === 0,
    syncKey: [
      serviceContract.syncMetadata?.syncKey ?? "mailchimp-service-unbound",
      checkpoint.syncKey ?? "mailchimp-checkpoint-unbound",
      rows.map((row) => `${row.service}:${row.operation}:${row.status}:${row.operationCount}`).join(",") || "no-service-rows",
      options.revision ?? serviceContract.syncMetadata?.revision ?? "working",
    ].join("|"),
    rows: Object.freeze(rows.sort(compareMailchimpServiceReadinessRows)),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpServiceReadinessField(rows, "status")),
      byService: freezeSortedRecord(countMailchimpServiceReadinessField(rows, "service")),
      byCapabilityStatus: freezeSortedRecord(countMailchimpServiceReadinessField(rows, "capabilityStatus")),
      byCheckpointStatus: freezeSortedRecord(countMailchimpServiceReadinessField(rows, "checkpointStatus")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      operationCount: operations.length,
      readyCount: ready.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      degradedCount: degraded.length,
      checkpointRowCount: checkpoint.totals?.rowCount ?? 0,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/provider-service-readiness/recovery"
        : status === "pending"
          ? "mailchimp/provider-service-readiness/acceptance"
          : status === "degraded" || status === "review"
            ? "mailchimp/provider-service-readiness/review"
            : "mailchimp/provider-service-readiness/summary",
      restartSafe: checkpoint.restartSafe !== false && blocked.length === 0,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      degradedRowIds: Object.freeze(degraded.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? degraded[0]?.nextAction
        ?? review[0]?.nextAction
        ?? checkpoint.restartEnvelope?.nextAction
        ?? "publish-mailchimp-provider-service-readiness",
    }),
    checkpoint,
    serviceContract,
  });
}

export function createMailchimpProviderServiceHandoffContract(serviceContractOrWorkflowState = {}, options = {}) {
  const serviceContract = serviceContractOrWorkflowState?.serviceContractVersion === "mailchimp-provider-service.v1"
    ? serviceContractOrWorkflowState
    : serviceContractOrWorkflowState?.providerContract?.serviceContractVersion === "mailchimp-provider-service.v1"
      ? serviceContractOrWorkflowState.providerContract
      : createMailchimpProviderServiceContract(serviceContractOrWorkflowState, options);
  const checkpoint = options.serviceSyncCheckpoint?.version === "mailchimp-service-sync-checkpoint.v1"
    ? options.serviceSyncCheckpoint
    : createMailchimpProviderServiceSyncCheckpoint(serviceContract, options);
  const readiness = options.providerServiceReadiness?.version === "mailchimp-provider-service-readiness-matrix.v1"
    ? options.providerServiceReadiness
    : createMailchimpProviderServiceReadinessMatrix(serviceContract, {
        ...options,
        serviceSyncCheckpoint: checkpoint,
      });
  const commandContract = options.providerCommandContract?.commandContractVersion === "mailchimp-provider-command.v1"
    ? options.providerCommandContract
    : createMailchimpProviderCommandContract({
        providerId: serviceContract.providerId,
        providerContract: serviceContract,
      }, {
        acceptedOperationIds: options.acceptedMailchimpOperationIds ?? options.acceptedOperationIds,
        queuedCommandIds: options.queuedMailchimpCommandIds ?? options.queuedCommandIds,
        failedCommandIds: options.failedMailchimpCommandIds ?? options.failedCommandIds,
        retryAfterByOperationId: options.mailchimpRetryAfterByOperationId ?? options.retryAfterByOperationId,
        attemptByOperationId: options.mailchimpAttemptByOperationId ?? options.attemptByOperationId,
        maxRetryAttempts: options.mailchimpMaxRetryAttempts ?? options.maxRetryAttempts,
        retryBaseSeconds: options.mailchimpRetryBaseSeconds ?? options.retryBaseSeconds,
        requireAcceptance: options.requireMailchimpOperationAcceptance ?? options.requireAcceptance,
        degradedMode: options.mailchimpDegradedMode ?? options.degradedMode,
      });
  const receiptContract = options.providerReceiptContract?.version === "mailchimp-provider-receipt-contract.v1"
    ? options.providerReceiptContract
    : createMailchimpProviderReceiptContract(commandContract, {
        receivedCommandIds: options.receivedMailchimpCommandIds ?? options.receivedCommandIds,
        acknowledgedCommandIds: options.acknowledgedMailchimpCommandIds ?? options.acknowledgedCommandIds,
        completedCommandIds: options.completedMailchimpCommandIds ?? options.completedCommandIds,
        failedReceiptCommandIds: options.receiptFailedMailchimpCommandIds
          ?? options.failedReceiptMailchimpCommandIds
          ?? options.failedReceiptCommandIds,
        duplicateCommandIds: options.duplicateMailchimpCommandIds ?? options.duplicateCommandIds,
        receiptIdByCommandId: options.mailchimpReceiptIdByCommandId ?? options.receiptIdByCommandId,
        providerMessageByCommandId: options.mailchimpProviderMessageByCommandId ?? options.providerMessageByCommandId,
        receiptReceivedAtByCommandId: options.mailchimpReceiptReceivedAtByCommandId ?? options.receiptReceivedAtByCommandId,
      });
  const lanes = Object.freeze([
    mailchimpProviderServiceHandoffLane("service-readiness", {
      label: "Mailchimp provider service readiness",
      contract: readiness,
      count: readiness.totals?.rowCount ?? readiness.rows?.length ?? 0,
      route: readiness.restartEnvelope?.route ?? "mailchimp/provider-service-readiness/summary",
      handoff: "mailchimp-provider-service-readiness",
    }),
    mailchimpProviderServiceHandoffLane("service-sync-checkpoint", {
      label: "Mailchimp service sync checkpoint",
      contract: checkpoint,
      count: checkpoint.totals?.rowCount ?? checkpoint.rows?.length ?? 0,
      route: checkpoint.restartEnvelope?.route ?? "mailchimp/service-sync-checkpoint/summary",
      handoff: "mailchimp-service-sync-window",
    }),
    mailchimpProviderServiceHandoffLane("provider-command", {
      label: "Mailchimp provider commands",
      contract: commandContract,
      count: commandContract.totals?.commandCount ?? commandContract.commands?.length ?? 0,
      route: commandContract.restartEnvelope?.route ?? "mailchimp/provider-commands/summary",
      handoff: "mailchimp-operational-health",
    }),
    mailchimpProviderServiceHandoffLane("provider-receipt", {
      label: "Mailchimp provider receipts",
      contract: receiptContract,
      count: receiptContract.totals?.receiptCount ?? receiptContract.receipts?.length ?? 0,
      route: receiptContract.restartEnvelope?.route ?? "mailchimp/provider-receipts/summary",
      handoff: "mailchimp-provider-receipt",
    }),
  ].sort(compareMailchimpProviderServiceHandoffLanes));
  const blocked = lanes.filter((lane) => lane.status === "blocked" || lane.exportAllowed === false || lane.restartSafe === false);
  const pending = lanes.filter((lane) => lane.status === "pending" || lane.status === "needsAcceptance");
  const review = lanes.filter((lane) => lane.status === "review" || lane.status === "degraded");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : lanes.some((lane) => lane.count > 0)
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-provider-service-handoff.v1",
    status,
    ok: status === "ready" || status === "idle" || (status === "review" && options.allowReviewProviderServiceHandoff === true),
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && options.allowReviewProviderServiceHandoff === true),
    restartSafe: blocked.length === 0,
    providerId: serviceContract.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    detected: serviceContract.detected === true,
    syncKey: [
      serviceContract.syncMetadata?.syncKey ?? "mailchimp-service-unbound",
      readiness.syncKey ?? "readiness-unbound",
      checkpoint.syncKey ?? "checkpoint-unbound",
      commandContract.syncKey ?? commandContract.commandSyncKey ?? "commands-unbound",
      receiptContract.syncKey ?? "receipts-unbound",
      options.revision ?? serviceContract.syncMetadata?.revision ?? "working",
    ].join("|"),
    lanes,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpProviderServiceHandoffField(lanes, "status")),
      byHandoff: freezeSortedRecord(countMailchimpProviderServiceHandoffField(lanes, "handoff")),
      byRoute: freezeSortedRecord(countMailchimpProviderServiceHandoffField(lanes, "route")),
    }),
    totals: Object.freeze({
      laneCount: lanes.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      operationCount: serviceContract.operations?.length ?? 0,
      serviceReadinessRowCount: readiness.totals?.rowCount ?? 0,
      serviceSyncRowCount: checkpoint.totals?.rowCount ?? 0,
      commandCount: commandContract.totals?.commandCount ?? commandContract.commands?.length ?? 0,
      receiptCount: receiptContract.totals?.receiptCount ?? receiptContract.receipts?.length ?? 0,
    }),
    externalState: Object.freeze({
      externalRunId: serviceContract.syncMetadata?.externalRunId ?? null,
      serviceContractStatus: serviceContract.status,
      readinessStatus: readiness.status,
      checkpointStatus: checkpoint.status,
      commandStatus: commandContract.status,
      receiptStatus: receiptContract.status,
      channels: serviceContract.externalHandoff?.channels ?? Object.freeze([]),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/provider-service-handoff/recovery"
        : status === "pending"
          ? "mailchimp/provider-service-handoff/actions"
          : status === "review"
            ? "mailchimp/provider-service-handoff/review"
            : "mailchimp/provider-service-handoff/summary",
      restartSafe: blocked.length === 0,
      blockedLaneIds: Object.freeze(blocked.map((lane) => lane.id).sort()),
      pendingLaneIds: Object.freeze(pending.map((lane) => lane.id).sort()),
      reviewLaneIds: Object.freeze(review.map((lane) => lane.id).sort()),
      idempotencyKeys: Object.freeze(lanes.map((lane) => lane.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? (status === "idle" ? "skip-mailchimp-provider-service-handoff" : "publish-mailchimp-provider-service-handoff"),
    }),
    userVisible: Object.freeze({
      title: serviceContract.detected ? "Mailchimp provider handoff" : "Mailchimp provider handoff idle",
      detail: status === "ready"
        ? "Provider services, sync checkpoint, commands, and receipts are ready for external Mailchimp handoff."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review provider handoff lane(s) remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? (status === "idle" ? "skip-mailchimp-provider-service-handoff" : "publish-mailchimp-provider-service-handoff"),
    }),
    readiness,
    checkpoint,
    commandContract,
    receiptContract,
    serviceContract,
  });
}

export function createMailchimpProviderServiceHandoffExportDeck(handoffOrServiceContract = {}, options = {}) {
  const handoff = handoffOrServiceContract?.version === "mailchimp-provider-service-handoff.v1"
    ? handoffOrServiceContract
    : createMailchimpProviderServiceHandoffContract(handoffOrServiceContract, options);
  const accepted = normalizeStringSet(options.acceptedMailchimpProviderServiceHandoffExportIds
    ?? options.acceptedProviderServiceHandoffExportIds);
  const completed = normalizeStringSet(options.completedMailchimpProviderServiceHandoffExportIds
    ?? options.completedProviderServiceHandoffExportIds);
  const failed = normalizeStringSet(options.failedMailchimpProviderServiceHandoffExportIds
    ?? options.failedProviderServiceHandoffExportIds);
  const requireAcceptance = options.requireMailchimpProviderServiceHandoffExportAcceptance !== false
    && options.requireProviderServiceHandoffExportAcceptance !== false;
  const rows = Object.freeze((handoff.lanes ?? [])
    .map((lane) => mailchimpProviderServiceHandoffExportRow(lane, {
      handoff,
      accepted,
      completed,
      failed,
      requireAcceptance,
    }))
    .sort(compareMailchimpProviderServiceHandoffExportRows));
  const blocked = rows.filter((row) => row.status === "blocked" || row.restartSafe === false || row.exportAllowed === false);
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : rows.length
          ? "ready"
          : "idle";
  const allowReview = options.allowReviewMailchimpProviderServiceHandoffExport === true
    || options.allowReviewProviderServiceHandoffExport === true;

  return Object.freeze({
    version: "mailchimp-provider-service-handoff-export-deck.v1",
    status,
    ok: status === "ready" || status === "idle" || (status === "review" && allowReview),
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && allowReview),
    restartSafe: blocked.length === 0 && handoff.restartSafe !== false,
    providerId: handoff.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    detected: handoff.detected === true,
    fileName: options.fileName ?? "inline.aios",
    revision: options.revision ?? "working",
    syncKey: [
      handoff.syncKey ?? "mailchimp-provider-service-handoff-unbound",
      options.fileName ?? "inline.aios",
      options.revision ?? "working",
      rows.map((row) => row.idempotencyKey).filter(Boolean).join(".") || "handoff-export-empty",
    ].join("|"),
    requireAcceptance,
    rows,
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpProviderServiceHandoffField(rows, "status")),
      byHandoff: freezeSortedRecord(countMailchimpProviderServiceHandoffField(rows, "handoff")),
      byRoute: freezeSortedRecord(countMailchimpProviderServiceHandoffField(rows, "route")),
      byLaneStatus: freezeSortedRecord(countMailchimpProviderServiceHandoffField(rows, "laneStatus")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      acceptedCount: rows.filter((row) => row.accepted).length,
      completedCount: rows.filter((row) => row.completed).length,
      failedCount: rows.filter((row) => row.failed).length,
      restartSafeCount: rows.filter((row) => row.restartSafe).length,
    }),
    acceptance: Object.freeze({
      mode: requireAcceptance ? "explicit" : "implicit",
      acceptable: status !== "blocked" && (!requireAcceptance || pending.length === 0),
      requiredRowIds: Object.freeze(rows.map((row) => row.id).sort()),
      acceptedRowIds: Object.freeze(rows.filter((row) => row.accepted).map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(requireAcceptance ? pending.map((row) => row.id).sort() : []),
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/provider-service-handoff/export/recovery"
        : status === "pending"
          ? "mailchimp/provider-service-handoff/export/acceptance"
          : status === "review"
            ? "mailchimp/provider-service-handoff/export/review"
            : "mailchimp/provider-service-handoff/export/summary",
      restartSafe: blocked.length === 0 && handoff.restartSafe !== false,
      blockedRowIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingRowIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewRowIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? handoff.restartEnvelope?.nextAction
        ?? (status === "idle" ? "skip-mailchimp-provider-service-handoff-export" : "publish-mailchimp-provider-service-handoff-export"),
    }),
    userVisible: Object.freeze({
      title: "Mailchimp provider service handoff export",
      detail: status === "ready" || status === "idle"
        ? "Provider service handoff lanes are export-ready for downstream product health."
        : `${blocked.length} blocked, ${pending.length} pending, and ${review.length} review provider service export row(s) remain.`,
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? (status === "idle" ? "skip-mailchimp-provider-service-handoff-export" : "publish-mailchimp-provider-service-handoff-export"),
    }),
    handoff,
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
  const exportDigest = createMailchimpOperationalHealthExportDigest({
    status,
    providerId: options.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    revision: options.revision ?? "working",
    externalRunId: options.externalRunId ?? null,
    degradedMode: options.degradedMode === true,
    restartSafe: restartUnsafe.length === 0 && blocked.length === 0,
    retryAfter,
    commandHealth,
    recoverySnapshot,
  });
  const incidentLedger = createMailchimpOperationalHealthIncidentLedger(exportDigest, {
    commandHealth,
    recoverySnapshot,
    degradedMode: options.degradedMode === true,
  });

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
    exportDigest,
    incidentLedger,
    nextAction: selectMailchimpOperationalHealthNextAction(status, {
      blocked,
      degraded,
      pending,
      restartUnsafe,
      recoverySnapshot,
    }),
  });
}

export function createMailchimpOperationalHealthExportDigest(health = {}, options = {}) {
  const commandHealth = Array.isArray(health.commandHealth)
    ? health.commandHealth
    : Array.isArray(options.commandHealth)
      ? options.commandHealth
      : [];
  const recoverySnapshot = health.recoverySnapshot ?? options.recoverySnapshot ?? {};
  const status = health.status ?? (commandHealth.length ? "ready" : "idle");
  const route = selectMailchimpOperationalHealthExportRoute(status);
  const counters = {};
  const issueCounters = {};
  const jobCounters = {};
  const actionableRows = [];
  const retrySchedule = [];
  const restartUnsafeIds = [];

  for (const item of commandHealth) {
    incrementCounter(counters, item.status ?? "unknown");
    incrementCounter(counters, `command:${item.commandStatus ?? "unknown"}`);
    incrementCounter(jobCounters, item.jobName ?? "unbound");
    for (const issue of item.issues ?? []) incrementCounter(issueCounters, issue);
    if (item.restartSafe === false) restartUnsafeIds.push(item.id);
    if (item.status !== "ready") {
      actionableRows.push(createMailchimpOperationalHealthDigestRow(item, {
        route,
        recoverySnapshot,
      }));
    }
    if (item.retryAfter || item.retryBudget?.nextDelaySeconds != null) {
      retrySchedule.push(Object.freeze({
        id: item.id,
        commandId: item.commandId,
        jobName: item.jobName,
        status: item.status,
        attempt: item.attempt,
        remainingAttempts: item.retryBudget?.remaining ?? 0,
        retryAfter: item.retryAfter ?? item.retryBudget?.retryAfter ?? null,
        nextDelaySeconds: item.retryBudget?.nextDelaySeconds ?? null,
        nextAction: item.nextAction,
      }));
    }
  }

  const blockedRows = actionableRows.filter((row) => row.status === "blocked");
  const pendingRows = actionableRows.filter((row) => row.status === "pending");
  const degradedRows = actionableRows.filter((row) => row.status === "degraded");
  const restartSafe = health.restartSafe !== false && restartUnsafeIds.length === 0 && blockedRows.length === 0;
  const nextAction = blockedRows[0]?.nextAction
    ?? degradedRows[0]?.nextAction
    ?? pendingRows[0]?.nextAction
    ?? recoverySnapshot.nextAction
    ?? selectMailchimpOperationalHealthNextAction(status, {
      blocked: blockedRows,
      degraded: degradedRows,
      pending: pendingRows,
      restartUnsafe: restartUnsafeIds,
      recoverySnapshot,
    });

  return Object.freeze({
    version: "mailchimp-operational-health-export-digest.v1",
    providerId: health.providerId ?? options.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    revision: health.revision ?? options.revision ?? "working",
    externalRunId: health.externalRunId ?? options.externalRunId ?? null,
    status,
    ok: status === "ready" || status === "idle",
    degradedMode: health.degradedMode === true || options.degradedMode === true,
    restartSafe,
    exportAllowed: status === "ready" || status === "idle",
    retryAfter: health.retryAfter ?? retrySchedule[0]?.retryAfter ?? recoverySnapshot.retryAfter ?? null,
    route,
    syncKey: [
      health.providerId ?? options.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
      recoverySnapshot.serviceSyncKey ?? "mailchimp-working",
      status,
      health.revision ?? options.revision ?? "working",
    ].join(":"),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(counters),
      byIssue: freezeSortedRecord(issueCounters),
      byJob: freezeSortedRecord(jobCounters),
    }),
    totals: Object.freeze({
      commandCount: commandHealth.length,
      actionableCount: actionableRows.length,
      blockedCount: blockedRows.length,
      degradedCount: degradedRows.length,
      pendingCount: pendingRows.length,
      retryScheduleCount: retrySchedule.length,
      restartUnsafeCount: restartUnsafeIds.length,
    }),
    actionableRows: Object.freeze(actionableRows.sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id))),
    retrySchedule: Object.freeze(retrySchedule.sort((left, right) => (
      String(left.retryAfter ?? "").localeCompare(String(right.retryAfter ?? ""))
      || left.id.localeCompare(right.id)
    ))),
    failureState: Object.freeze({
      blockedCommandIds: Object.freeze(blockedRows.map((row) => row.commandId ?? row.id).sort()),
      degradedCommandIds: Object.freeze(degradedRows.map((row) => row.commandId ?? row.id).sort()),
      pendingCommandIds: Object.freeze(pendingRows.map((row) => row.commandId ?? row.id).sort()),
      restartUnsafeCommandIds: Object.freeze(restartUnsafeIds.sort()),
    }),
    handoff: Object.freeze({
      channel: "mailchimp-operational-health",
      route,
      restartSafe,
      exportAllowed: status === "ready" || status === "idle",
      replayAllowed: recoverySnapshot.restartEnvelope?.replayAllowed !== false && restartSafe,
      idempotencyKeys: Object.freeze(commandHealth
        .map((item) => item.idempotencyKey)
        .filter(Boolean)
        .sort()),
      nextAction,
    }),
    nextAction,
  });
}

export function createMailchimpOperationalHealthIncidentLedger(exportDigest = {}, options = {}) {
  const commandHealth = Array.isArray(options.commandHealth)
    ? options.commandHealth
    : Array.isArray(exportDigest.commandHealth)
      ? exportDigest.commandHealth
      : [];
  const digestRows = Array.isArray(exportDigest.actionableRows) ? exportDigest.actionableRows : [];
  const rowsById = new Map(digestRows.map((row) => [row.id, row]));
  const rows = commandHealth
    .filter((item) => item.status !== "ready")
    .map((item) => createMailchimpOperationalHealthIncidentRow(item, {
      digestRow: rowsById.get(item.id),
      exportDigest,
      recoverySnapshot: options.recoverySnapshot ?? {},
      degradedMode: options.degradedMode === true || exportDigest.degradedMode === true,
    }))
    .sort(compareMailchimpOperationalHealthIncidentRows);
  const bySeverity = {};
  const byStatus = {};
  const byRoute = {};
  const byAction = {};

  for (const row of rows) {
    incrementCounter(bySeverity, row.severity);
    incrementCounter(byStatus, row.status);
    incrementCounter(byRoute, row.route);
    incrementCounter(byAction, row.nextAction);
  }

  const blocked = rows.filter((row) => row.status === "blocked" || row.severity === "error");
  const degraded = rows.filter((row) => row.status === "degraded");
  const pending = rows.filter((row) => row.status === "pending");
  const exhausted = rows.filter((row) => row.retryBudgetStatus === "exhausted");
  const restartUnsafe = rows.filter((row) => row.restartSafe === false);
  const status = blocked.length || exhausted.length || restartUnsafe.length
    ? "blocked"
    : degraded.length
      ? "degraded"
      : pending.length
        ? "pending"
        : rows.length
          ? "review"
          : exportDigest.status ?? "idle";
  const nextIncident = blocked[0] ?? exhausted[0] ?? restartUnsafe[0] ?? degraded[0] ?? pending[0] ?? rows[0] ?? null;

  return Object.freeze({
    version: "mailchimp-operational-health-incident-ledger.v1",
    providerId: exportDigest.providerId ?? options.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    revision: exportDigest.revision ?? options.revision ?? "working",
    externalRunId: exportDigest.externalRunId ?? options.externalRunId ?? null,
    status,
    ok: status === "ready" || status === "idle",
    degradedMode: options.degradedMode === true || exportDigest.degradedMode === true,
    restartSafe: restartUnsafe.length === 0 && exhausted.length === 0 && blocked.length === 0,
    exportAllowed: rows.length === 0 || (status === "degraded" && (options.degradedMode === true || exportDigest.degradedMode === true)),
    syncKey: [
      exportDigest.syncKey ?? "mailchimp-operational-health",
      status,
      rows.map((row) => row.idempotencyKey).filter(Boolean).join(".") || "incidents-empty",
    ].join(":"),
    counters: Object.freeze({
      bySeverity: freezeSortedRecord(bySeverity),
      byStatus: freezeSortedRecord(byStatus),
      byRoute: freezeSortedRecord(byRoute),
      byAction: freezeSortedRecord(byAction),
    }),
    totals: Object.freeze({
      incidentCount: rows.length,
      blockedCount: blocked.length,
      degradedCount: degraded.length,
      pendingCount: pending.length,
      retryBudgetExhaustedCount: exhausted.length,
      restartUnsafeCount: restartUnsafe.length,
    }),
    rows: Object.freeze(rows),
    timeline: Object.freeze(rows.map((row, index) => Object.freeze({
      index,
      id: row.id,
      commandId: row.commandId,
      jobName: row.jobName,
      severity: row.severity,
      status: row.status,
      issueCodes: row.issueCodes,
      retryAfter: row.retryAfter,
      route: row.route,
      nextAction: row.nextAction,
    }))),
    recovery: Object.freeze({
      blockedIncidentIds: Object.freeze(blocked.map((row) => row.id).sort()),
      degradedIncidentIds: Object.freeze(degraded.map((row) => row.id).sort()),
      pendingIncidentIds: Object.freeze(pending.map((row) => row.id).sort()),
      retryBudgetExhaustedIds: Object.freeze(exhausted.map((row) => row.id).sort()),
      restartUnsafeIncidentIds: Object.freeze(restartUnsafe.map((row) => row.id).sort()),
      nextAction: nextIncident?.nextAction ?? exportDigest.nextAction ?? "publish-mailchimp-operational-health",
    }),
    handoff: Object.freeze({
      channel: "mailchimp-operational-health-incidents",
      route: status === "blocked"
        ? "mailchimp/operational-health/incidents/recovery"
        : status === "degraded"
          ? "mailchimp/operational-health/incidents/degraded"
          : status === "pending"
            ? "mailchimp/operational-health/incidents/acceptance"
            : "mailchimp/operational-health/incidents/summary",
      restartSafe: restartUnsafe.length === 0 && exhausted.length === 0 && blocked.length === 0,
      exportAllowed: rows.length === 0 || (status === "degraded" && (options.degradedMode === true || exportDigest.degradedMode === true)),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: nextIncident?.nextAction ?? exportDigest.nextAction ?? "publish-mailchimp-operational-health",
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

function createMailchimpTenantPermissionDecisionRow(row = {}, context = {}) {
  const requiresAcceptance = context.requireAcceptance
    && (row.status === "review" || context.requiredOperationIds.has(row.operationId));
  const accepted = context.acceptedAuditRowIds.has(row.id)
    || context.acceptedJobNames.has(row.jobName)
    || !requiresAcceptance;
  const status = row.status === "blocked" || row.restartSafe === false
    ? "blocked"
    : requiresAcceptance && !accepted
      ? "pending"
      : row.status === "review"
        ? "review"
        : "ready";
  const nextAction = status === "blocked"
    ? row.nextAction ?? "repair-mailchimp-tenant-permission-boundary"
    : status === "pending"
      ? "accept-mailchimp-tenant-permission-boundary"
      : status === "review"
        ? row.nextAction ?? "review-mailchimp-tenant-permission-boundary"
        : "retain-mailchimp-tenant-permission-boundary";

  return Object.freeze({
    id: `mailchimp-tenant-decision:${row.id ?? row.jobName ?? "workflow"}`,
    auditRowId: row.id ?? null,
    jobName: row.jobName ?? null,
    operationId: row.operationId ?? null,
    status,
    accepted,
    requiresAcceptance,
    tenantId: row.tenantId ?? null,
    workspaceId: row.workspaceId ?? null,
    role: row.role ?? null,
    permission: row.permission ?? null,
    reasonCodes: Object.freeze([...(row.reasonCodes ?? [])].sort()),
    detail: row.detail ?? "Mailchimp tenant permission boundary is ready.",
    restartSafe: status !== "blocked" && row.restartSafe !== false,
    idempotencyKey: [
      row.idempotencyKey ?? row.id ?? "mailchimp-tenant-row",
      accepted ? "accepted" : "pending",
      status,
    ].join(":"),
    nextAction,
  });
}

function createMailchimpTenantPermissionAuditLedgerFromRows(rows = [], context = {}) {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => createMailchimpTenantPermissionLedgerRow(row, context))
    .sort((left, right) => left.status.localeCompare(right.status) || left.id.localeCompare(right.id));
  const blocked = normalizedRows.filter((row) => row.status === "blocked");
  const pending = normalizedRows.filter((row) => row.status === "pending");
  const review = normalizedRows.filter((row) => row.status === "review");
  const retryable = normalizedRows.filter((row) => row.retryable);
  const degradedAllowed = normalizedRows.filter((row) => row.degradedModeAllowed);
  const exhausted = normalizedRows.filter((row) => row.retryBudget.status === "exhausted");
  const status = blocked.length || exhausted.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : normalizedRows.length
          ? "ready"
          : "idle";
  const nextRetryAfterSeconds = retryable
    .map((row) => row.retryPolicy.retryAfterSeconds)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)[0] ?? null;

  return Object.freeze({
    version: "mailchimp-tenant-permission-audit-ledger.v1",
    status,
    ok: status === "ready" || status === "idle" || (status === "review" && degradedAllowed.length === review.length),
    exportAllowed: status === "ready" || status === "idle" || (status === "review" && degradedAllowed.length === review.length),
    restartSafe: blocked.length === 0 && exhausted.length === 0,
    syncKey: [
      context.syncKey ?? "mailchimp-tenant-boundary",
      context.revision ?? "working",
      context.externalRunId ?? "local",
      normalizedRows.map((row) => row.idempotencyKey).join(".") || "ledger-empty",
    ].join("|"),
    rows: Object.freeze(normalizedRows),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpBoundaryRows(normalizedRows, "status")),
      byRetryClass: freezeSortedRecord(countMailchimpBoundaryRows(normalizedRows, "retryClass")),
      byDegradedMode: freezeSortedRecord(countMailchimpBoundaryRows(normalizedRows, "degradedMode")),
      byReason: freezeSortedRecord(countMailchimpTenantLedgerReasons(normalizedRows)),
    }),
    totals: Object.freeze({
      rowCount: normalizedRows.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
      retryableCount: retryable.length,
      degradedAllowedCount: degradedAllowed.length,
      retryExhaustedCount: exhausted.length,
    }),
    health: Object.freeze({
      state: status === "blocked"
        ? "failed"
        : status === "pending"
          ? "waiting"
          : status === "review"
            ? "degraded"
            : "healthy",
      retryable: retryable.length > 0,
      degradedModeAllowed: status === "review" && degradedAllowed.length === review.length,
      nextRetryAfterSeconds,
      nextAction: blocked[0]?.nextAction
        ?? exhausted[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-tenant-permission-ledger",
    }),
    handoff: Object.freeze({
      channel: "mailchimp-tenant-permission-audit-ledger",
      route: status === "blocked"
        ? "mailchimp/tenant-permission-ledger/recovery"
        : status === "pending"
          ? "mailchimp/tenant-permission-ledger/acceptance"
          : status === "review"
            ? "mailchimp/tenant-permission-ledger/degraded-review"
            : "mailchimp/tenant-permission-ledger/summary",
      restartSafe: blocked.length === 0 && exhausted.length === 0,
      idempotencyKeys: Object.freeze(normalizedRows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? exhausted[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-tenant-permission-ledger",
    }),
  });
}

function createMailchimpTenantPermissionLedgerRow(row = {}, context = {}) {
  const reasonCodes = Object.freeze([...(row.reasonCodes ?? [])].map((reason) => String(reason)).sort());
  const retryClass = selectMailchimpTenantRetryClass(row, reasonCodes);
  const retryAfterSeconds = selectMailchimpTenantRetryAfterSeconds(row, reasonCodes, retryClass, context);
  const attempt = normalizeMailchimpTenantAttempt(row, context);
  const maxAttempts = normalizePositiveInteger(context.maxRetryAttempts, retryClass === "metadata-binding" ? 5 : 1);
  const retryable = retryAfterSeconds !== null && row.status !== "ready" && attempt < maxAttempts;
  const degradedModeAllowed = row.status === "review"
    && context.allowTenantBoundaryDegradedMode === true
    && retryClass !== "permission-policy";
  const degradedMode = degradedModeAllowed ? "allowed" : row.status === "review" ? "requires-acceptance" : "not-applicable";

  return Object.freeze({
    id: row.id ?? row.auditRowId ?? `mailchimp-tenant-ledger:${row.jobName ?? "workflow"}`,
    auditRowId: row.auditRowId ?? row.id ?? null,
    jobName: row.jobName ?? null,
    operationId: row.operationId ?? null,
    status: row.status ?? "unknown",
    tenantId: row.tenantId ?? null,
    workspaceId: row.workspaceId ?? null,
    role: row.role ?? null,
    permission: row.permission ?? null,
    reasonCodes,
    retryClass,
    retryable,
    degradedMode,
    degradedModeAllowed,
    restartSafe: row.restartSafe !== false && row.status !== "blocked",
    detail: row.detail ?? "Mailchimp tenant permission boundary row is ready.",
    retryPolicy: Object.freeze({
      retryAfterSeconds,
      maxAttempts,
      backoff: retryClass === "metadata-binding" ? "linear" : retryable ? "manual" : "none",
      retryCommand: retryable ? "retry-mailchimp-tenant-permission-boundary" : null,
    }),
    retryBudget: Object.freeze({
      attempt,
      remaining: Math.max(0, maxAttempts - attempt),
      status: retryable ? "available" : row.status === "ready" ? "not-needed" : "exhausted",
    }),
    handoff: Object.freeze({
      channel: row.handoff ?? "mailchimp-tenant-permission-audit",
      route: row.status === "blocked"
        ? "mailchimp/tenant-boundary/recovery"
        : row.status === "pending"
          ? "mailchimp/tenant-boundary/acceptance"
          : row.status === "review"
            ? "mailchimp/tenant-boundary/review"
            : "mailchimp/tenant-boundary/summary",
    }),
    nextAction: row.status === "blocked" && retryable
      ? "retry-mailchimp-tenant-permission-boundary"
      : row.nextAction ?? "retain-mailchimp-tenant-permission-boundary",
    idempotencyKey: [
      row.idempotencyKey ?? row.id ?? row.auditRowId ?? "mailchimp-tenant-row",
      retryClass,
      attempt,
      row.status ?? "unknown",
    ].join(":"),
  });
}

function selectMailchimpTenantRetryClass(row = {}, reasonCodes = []) {
  if (row.status === "pending") return "acceptance";
  if (reasonCodes.some((reason) => reason === "tenant-unbound" || reason === "workspace-unbound")) return "metadata-binding";
  if (reasonCodes.some((reason) => reason === "operation-blocked" || reason === "operation-review")) return "provider-operation";
  if (reasonCodes.some((reason) => reason === "policy-blocked" || reason === "policy-review")) return "permission-policy";
  if (row.status === "review") return "manual-review";
  if (row.status === "blocked") return "manual-repair";
  return "none";
}

function selectMailchimpTenantRetryAfterSeconds(row = {}, reasonCodes = [], retryClass = "none", context = {}) {
  const byRow = context.retryAfterSecondsByRowId ?? {};
  const rowRetry = byRow[row.id] ?? byRow[row.auditRowId];
  if (Number.isFinite(rowRetry) && rowRetry >= 0) return rowRetry;
  const byReason = context.retryAfterSecondsByReason ?? {};
  for (const reason of reasonCodes) {
    if (Number.isFinite(byReason[reason]) && byReason[reason] >= 0) return byReason[reason];
  }
  if (retryClass === "metadata-binding") return 300;
  if (retryClass === "provider-operation") return 120;
  if (retryClass === "acceptance") return 0;
  return null;
}

function normalizeMailchimpTenantAttempt(row = {}, context = {}) {
  const attempts = context.attemptByRowId ?? {};
  const value = attempts[row.id] ?? attempts[row.auditRowId] ?? row.attempt ?? row.retryAttempt ?? 0;
  return normalizePositiveInteger(value, 0);
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function countMailchimpTenantLedgerReasons(rows = []) {
  const counters = {};
  for (const row of rows) {
    for (const reason of row.reasonCodes ?? []) incrementCounter(counters, reason);
  }
  return counters;
}

function selectMailchimpTenantSourceAnchorKey(anchor = {}, options = {}) {
  const operationByAnchorId = options.mailchimpOperationIdBySourceAnchorId ?? options.operationIdBySourceAnchorId ?? {};
  const jobByAnchorId = options.mailchimpJobNameBySourceAnchorId ?? options.jobNameBySourceAnchorId ?? {};
  const name = anchor?.name === null || anchor?.name === undefined ? "" : String(anchor.name);
  const normalizedName = name.trim();
  const anchorId = anchor?.id === null || anchor?.id === undefined ? "" : String(anchor.id);

  return Object.freeze({
    anchorId: anchorId || null,
    jobName: normalizeMailchimpSourceAnchorJobName(
      jobByAnchorId[anchorId]
        ?? anchor?.jobName
        ?? (anchor?.type === AIOS_AST_NODE_KINDS.JobDeclaration ? normalizedName : null)
        ?? normalizedName,
    ),
    operationId: normalizeBoundaryString(
      operationByAnchorId[anchorId]
        ?? anchor?.operationId
        ?? anchor?.mailchimpOperationId
        ?? null,
    ),
  });
}

function createMailchimpTenantSourceAnchorCorrelationRow(anchor, decisionRow, context = {}) {
  const anchorId = anchor?.id ?? null;
  const anchorType = anchor?.type ?? "unanchored";
  const anchorStatus = anchor?.status ?? "unanchored";
  const accepted = anchor?.accepted === true;
  const rowStatus = decisionRow?.status ?? "ready";
  const status = !anchor && decisionRow
    ? "blocked"
    : rowStatus === "blocked" || anchor?.restartSafe === false
      ? "blocked"
      : rowStatus === "pending" || (anchor && context.decision?.acceptance?.mode === "explicit" && !accepted)
        ? "pending"
        : rowStatus === "review" || anchorStatus === "changed"
          ? "review"
          : "ready";
  const nextAction = status === "blocked"
    ? decisionRow?.nextAction ?? "bind-mailchimp-tenant-source-anchor"
    : status === "pending"
      ? accepted ? "accept-mailchimp-tenant-permission-boundary" : "accept-mailchimp-source-anchor-boundary"
      : status === "review"
        ? decisionRow?.nextAction ?? "review-mailchimp-tenant-source-anchor"
        : "retain-mailchimp-tenant-source-anchor-boundary";
  const jobName = decisionRow?.jobName ?? context.key?.jobName ?? null;
  const operationId = decisionRow?.operationId ?? context.key?.operationId ?? null;

  return Object.freeze({
    id: [
      "mailchimp-tenant-source-anchor",
      anchorId ?? `decision-${context.index}`,
      decisionRow?.auditRowId ?? jobName ?? "workflow",
    ].join(":"),
    anchorId,
    anchorType,
    anchorStatus,
    previewAddress: anchor?.compact ?? anchor?.previewAddress ?? null,
    jobName,
    operationId,
    auditRowId: decisionRow?.auditRowId ?? null,
    status,
    accepted,
    tenantId: decisionRow?.tenantId ?? null,
    workspaceId: decisionRow?.workspaceId ?? null,
    role: decisionRow?.role ?? null,
    permission: decisionRow?.permission ?? null,
    reasonCodes: Object.freeze([...(decisionRow?.reasonCodes ?? (decisionRow ? [] : ["within-boundary"]))].sort()),
    detail: decisionRow?.detail
      ?? (anchor ? "Source anchor is within the Mailchimp tenant permission boundary." : "Mailchimp tenant decision has no source anchor."),
    restartSafe: status !== "blocked" && anchor?.restartSafe !== false && decisionRow?.restartSafe !== false,
    nextAction,
    idempotencyKey: [
      context.decision?.boundaryContract?.syncKey ?? "mailchimp-tenant-decision",
      anchorId ?? "unanchored",
      decisionRow?.auditRowId ?? jobName ?? "workflow",
      status,
    ].join(":"),
  });
}

function normalizeMailchimpSourceAnchorJobName(value) {
  const normalized = normalizeBoundaryString(value);
  if (!normalized) return "workflow";
  return normalized;
}

function countMailchimpTenantDecisionReasons(rows = []) {
  const counters = {};
  for (const row of rows) {
    const reasons = row.reasonCodes?.length ? row.reasonCodes : ["within-boundary"];
    for (const reason of reasons) incrementCounter(counters, reason);
  }
  return counters;
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

function normalizeMailchimpClientRuntimeRequest(settings = {}) {
  const source = settings.mailchimpRuntimeRequest ?? settings.runtimeRequest ?? settings.clientRequest ?? settings;
  const route = source.route ?? source.clientRoute ?? source.handoffRoute ?? "mailchimp/runtime/summary";
  return Object.freeze({
    clientRequestId: normalizeOptionalString(source.clientRequestId ?? source.requestId ?? settings.clientRequestId),
    sessionId: normalizeOptionalString(source.sessionId ?? settings.sessionId),
    workspaceId: normalizeOptionalString(source.workspaceId ?? settings.workspaceId),
    tenantId: normalizeOptionalString(source.tenantId ?? settings.tenantId),
    route: normalizeOptionalString(route),
    requestedAt: normalizeOptionalString(source.requestedAt ?? settings.requestedAt),
    actorRole: normalizeOptionalString(source.actorRole ?? source.role ?? settings.role),
  });
}

function createMailchimpRuntimeRequestRow(target, context) {
  const accepted = context.acceptedTargetIds.has(target.id) || context.acceptedTargetIds.has(target.jobName);
  const completed = context.completedTargetIds.has(target.id) || context.completedTargetIds.has(target.jobName);
  const failed = context.failedTargetIds.has(target.id) || context.failedTargetIds.has(target.jobName);
  const needsAcceptance = context.requireAcceptance && !accepted && target.status !== "idle";
  const blocked = failed || target.status === "blocked" || target.restartSafe === false;
  const pending = !blocked && !completed && (needsAcceptance || target.status === "pending");
  const status = blocked
    ? "blocked"
    : completed
      ? "ready"
      : pending
        ? "pending"
        : target.status === "review"
          ? "review"
          : target.status === "idle"
            ? "idle"
            : "ready";
  const route = status === "blocked"
    ? "mailchimp/runtime-request/recovery"
    : status === "pending"
      ? "mailchimp/runtime-request/acceptance"
      : status === "review"
        ? "mailchimp/runtime-request/review"
        : context.request.route;

  return Object.freeze({
    id: `mailchimp-runtime-request:${target.jobName ?? target.id}`,
    targetId: target.id,
    jobName: target.jobName,
    status,
    sourceStatus: target.status,
    route,
    scheduleMode: target.scheduleMode,
    accepted,
    completed,
    failed,
    restartSafe: target.restartSafe !== false && !failed,
    exportAllowed: status === "ready" || status === "idle" || status === "review",
    blockedIds: target.blockedOperationIds ?? Object.freeze([]),
    pendingIds: Object.freeze([
      ...(target.pendingOperationIds ?? []),
      ...(needsAcceptance ? [target.id] : []),
    ].sort()),
    idempotencyKey: [
      context.request.clientRequestId ?? "request-unbound",
      context.request.sessionId ?? "session-unbound",
      context.request.workspaceId ?? "workspace-unbound",
      target.idempotencyKey ?? target.id,
      status,
    ].join(":"),
    nextAction: failed || blocked
      ? target.nextAction ?? "repair-mailchimp-runtime-request"
      : pending
        ? `accept-mailchimp-runtime-request:${target.id}`
        : status === "review"
          ? target.nextAction ?? "review-mailchimp-runtime-request"
          : "publish-mailchimp-runtime-request",
    userVisible: Object.freeze({
      title: target.userVisible?.title ?? target.jobName ?? target.id,
      detail: status === "ready" || status === "idle"
        ? "Runtime target is adopted by the current Mailchimp client request."
        : target.userVisible?.detail ?? `Runtime request row requires ${route}.`,
      action: target.nextAction,
    }),
  });
}

function compareMailchimpRuntimeRequestRows(left, right) {
  return rankMailchimpRuntimeRequestStatus(left.status) - rankMailchimpRuntimeRequestStatus(right.status)
    || left.route.localeCompare(right.route)
    || left.id.localeCompare(right.id);
}

function rankMailchimpRuntimeRequestStatus(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    ready: 3,
    idle: 4,
  }[status] ?? 5;
}

function countMailchimpRuntimeRequestRows(rows = [], field) {
  const counters = {};
  for (const row of rows) incrementCounter(counters, row[field] ?? "unknown");
  return counters;
}

function createMailchimpRuntimeCheckpointRow(row = {}, context = {}) {
  const sourceStatus = normalizeMailchimpRuntimeCheckpointStatus(row.status);
  const accepted = context.accepted.has(row.id);
  const completed = context.completed.has(row.id);
  const failed = context.failed.has(row.id);
  const blocked = failed || sourceStatus === "blocked" || row.restartSafe === false || row.exportAllowed === false;
  const pending = !blocked && context.requireAcceptance && !accepted && sourceStatus !== "idle";
  const status = blocked
    ? "blocked"
    : completed
      ? "ready"
      : pending
        ? "pending"
        : sourceStatus;

  return Object.freeze({
    id: `mailchimp-client-runtime-checkpoint:${row.id}`,
    checkpointId: row.id,
    kind: row.kind ?? "runtimeCheckpoint",
    status,
    sourceStatus: row.sourceStatus ?? sourceStatus,
    label: row.label ?? row.id,
    detail: row.detail ?? `${row.label ?? row.id} is ${status}.`,
    route: row.route ?? "mailchimp/client-runtime-checkpoint",
    count: Number.isFinite(Number(row.count)) ? Math.max(0, Math.trunc(Number(row.count))) : 0,
    accepted: accepted || context.requireAcceptance === false,
    completed,
    failed,
    restartSafe: row.restartSafe !== false && !failed && status !== "blocked",
    exportAllowed: row.exportAllowed !== false && status !== "blocked" && status !== "pending",
    idempotencyKey: [
      row.idempotencyKey ?? row.id,
      accepted ? "accepted" : "pending",
      completed ? "completed" : "open",
      status,
    ].join(":"),
    nextAction: blocked
      ? row.nextAction ?? "repair-mailchimp-client-runtime-checkpoint"
      : completed
        ? "retain-mailchimp-client-runtime-checkpoint"
        : pending
          ? `accept-mailchimp-client-runtime-checkpoint:${row.id}`
          : status === "review"
            ? row.nextAction ?? "review-mailchimp-client-runtime-checkpoint"
            : row.nextAction ?? "publish-mailchimp-client-runtime-checkpoint",
  });
}

function normalizeMailchimpRuntimeCheckpointStatus(status) {
  if (status === "ready" || status === "idle" || status === "empty") return status === "empty" ? "idle" : status;
  if (status === "pending" || status === "needsAcceptance" || status === "queued") return "pending";
  if (status === "blocked" || status === "failed" || status === "disabled" || status === "required" || status === "unbound") return "blocked";
  if (status === "review" || status === "degraded" || status === "changed") return "review";
  return status ? "review" : "blocked";
}

function compareMailchimpRuntimeCheckpointRows(left, right) {
  return rankMailchimpRuntimeRequestStatus(left.status) - rankMailchimpRuntimeRequestStatus(right.status)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function countMailchimpRuntimeCheckpointRows(rows = [], field) {
  const counters = {};
  for (const row of rows) incrementCounter(counters, row[field] ?? "unknown");
  return counters;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
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

function mailchimpAstAnalyticsRow(row = {}) {
  return Object.freeze({
    id: row.id,
    kind: row.kind,
    status: normalizeMailchimpAstAnalyticsStatus(row.status),
    label: row.label,
    detail: row.detail,
    count: Number.isFinite(Number(row.count)) ? Math.max(0, Math.trunc(Number(row.count))) : 0,
    route: row.route ?? "mailchimp/ast-analytics",
    restartSafe: row.restartSafe !== false,
    idempotencyKey: row.idempotencyKey ?? null,
    nextAction: row.nextAction ?? "publish-mailchimp-ast-analytics-row",
  });
}

function finalizeMailchimpAstAnalyticsRow(row, state) {
  const previous = state.previousRows.get(row.id) ?? null;
  const accepted = state.acceptedIds.has(row.id) || state.requireAcceptance === false;
  const completed = state.completedIds.has(row.id);
  const failed = state.failedIds.has(row.id);
  const changed = previous
    ? previous.status !== row.status || previous.count !== row.count || previous.idempotencyKey !== row.idempotencyKey
    : true;
  const blocked = failed || row.status === "blocked" || row.restartSafe === false;
  const status = blocked
    ? "blocked"
    : completed
      ? "ready"
      : state.requireAcceptance && !accepted
        ? "pending"
        : row.status === "pending"
          ? "pending"
          : row.status === "review" || changed
            ? "review"
            : "ready";

  return Object.freeze({
    ...row,
    status,
    accepted,
    completed,
    failed,
    changeStatus: previous ? changed ? "changed" : "unchanged" : "new",
    previousStatus: previous?.status ?? null,
    previousIdempotencyKey: previous?.idempotencyKey ?? null,
    restartSafe: row.restartSafe !== false && !failed,
    nextAction: blocked
      ? row.nextAction ?? "repair-mailchimp-ast-analytics-export-bundle"
      : completed
        ? "retain-mailchimp-ast-analytics-row"
        : state.requireAcceptance && !accepted
          ? `accept-mailchimp-ast-analytics-row:${row.id}`
          : changed
            ? `review-mailchimp-ast-analytics-row:${row.id}`
            : row.nextAction,
  });
}

function normalizeMailchimpAstAnalyticsRows(value) {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  return new Map(rows
    .filter((row) => row && typeof row === "object" && row.id)
    .map((row) => [String(row.id), Object.freeze({
      id: String(row.id),
      status: normalizeMailchimpAstAnalyticsStatus(row.status),
      count: Number.isFinite(Number(row.count)) ? Math.max(0, Math.trunc(Number(row.count))) : 0,
      idempotencyKey: row.idempotencyKey ?? null,
    })]));
}

function normalizeMailchimpAstAnalyticsStatus(status) {
  if (status === "ready" || status === "idle" || status === "empty") return "ready";
  if (status === "pending" || status === "needsAcceptance") return "pending";
  if (status === "blocked" || status === "failed" || status === "unsupported") return "blocked";
  if (status === "review" || status === "degraded" || status === "needsDiagnostic") return "review";
  return status ? "review" : "review";
}

function compareMailchimpAstAnalyticsRows(left, right) {
  return rankMailchimpAstAnalyticsStatus(left.status) - rankMailchimpAstAnalyticsStatus(right.status)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function rankMailchimpAstAnalyticsStatus(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    ready: 3,
  }[status] ?? 4;
}

function countMailchimpAstAnalyticsRows(rows = [], field) {
  const counters = {};
  for (const row of rows) incrementCounter(counters, row[field] ?? "unknown");
  return counters;
}

function createMailchimpAstPreviewRows(analyticsReport, analyticsBundle, state) {
  const exportTimelineRows = (analyticsReport.exportSummary?.timeline ?? []).map((item) => mailchimpAstPreviewRow({
    id: `mailchimp-ast-preview:node:${item.index}`,
    kind: "nodePreview",
    nodeKind: item.kind,
    status: analyticsReport.exportSummary?.status === "blocked" ? "blocked" : "ready",
    label: `${item.kind} ${item.label}`,
    detail: `${item.surface} contract preview for ${item.path.join(" > ")}.`,
    route: "mailchimp/ast-preview/nodes",
    sourcePath: item.path,
    handoff: item.handoff,
    count: 1,
    idempotencyKey: `${state.fileName}:${state.revision}:node:${item.index}:${item.kind}:${item.label}`,
    nextAction: "publish-mailchimp-ast-node-preview",
  }, state));
  const requiredKindRows = [...state.requiredKinds]
    .filter((kind) => !exportTimelineRows.some((row) => row.nodeKind === kind))
    .map((kind) => mailchimpAstPreviewRow({
      id: `mailchimp-ast-preview:required-kind:${kind}`,
      kind: "requiredKind",
      nodeKind: kind,
      status: "blocked",
      label: `${kind} required`,
      detail: `Mailchimp preview requires at least one ${kind} contract row before handoff.`,
      route: "mailchimp/ast-preview/requirements",
      handoff: ["mailchimp-ast-preview-acceptance"],
      count: 0,
      restartSafe: false,
      idempotencyKey: `${state.fileName}:${state.revision}:required-kind:${kind}:missing`,
      nextAction: `add-mailchimp-preview-node-kind:${kind}`,
    }, state));
  const analyticsRows = (analyticsBundle.rows ?? []).map((row) => mailchimpAstPreviewRow({
    id: `mailchimp-ast-preview:analytics:${row.id}`,
    kind: "analyticsPreview",
    nodeKind: row.kind,
    status: row.status,
    label: row.label,
    detail: row.detail,
    route: row.route ?? "mailchimp/ast-analytics",
    handoff: ["mailchimp-ast-analytics-export"],
    count: row.count,
    restartSafe: row.restartSafe,
    idempotencyKey: `${state.fileName}:${state.revision}:analytics:${row.id}:${row.status}`,
    nextAction: row.nextAction,
  }, state));
  const summaryRow = mailchimpAstPreviewRow({
    id: "mailchimp-ast-preview:summary",
    kind: "previewSummary",
    nodeKind: "summary",
    status: analyticsReport.exportSummary?.status === "blocked"
      ? "blocked"
      : analyticsBundle.status === "pending"
        ? "pending"
        : analyticsBundle.status === "review"
          ? "review"
          : "ready",
    label: "Mailchimp AST preview summary",
    detail: `${analyticsReport.exportSummary?.exportableCount ?? 0} exportable AST node preview row(s), ${analyticsReport.exportSummary?.blockedCount ?? 0} blocked contract row(s).`,
    route: "mailchimp/ast-preview/summary",
    handoff: ["mailchimp-ast-preview-acceptance", "mailchimp-ast-analytics-export"],
    count: analyticsReport.exportSummary?.exportableCount ?? 0,
    restartSafe: analyticsBundle.restartEnvelope?.restartSafe !== false,
    idempotencyKey: `${state.fileName}:${state.revision}:summary:${analyticsReport.exportSummary?.status ?? "unknown"}:${analyticsBundle.status}`,
    nextAction: analyticsReport.exportSummary?.nextAction ?? analyticsBundle.restartEnvelope?.nextAction,
  }, state);

  return dedupeMailchimpAstPreviewRows([
    summaryRow,
    ...requiredKindRows,
    ...exportTimelineRows,
    ...analyticsRows,
  ]);
}

function mailchimpAstPreviewRow(row, state) {
  const accepted = state.requireAcceptance === false || state.acceptedPreviewIds.has(row.id);
  const completed = state.completedPreviewIds.has(row.id);
  const failed = state.failedPreviewIds.has(row.id);
  const sourceStatus = normalizeMailchimpAstPreviewStatus(row.status);
  const blocked = failed || sourceStatus === "blocked" || row.restartSafe === false;
  const status = blocked
    ? "blocked"
    : completed
      ? "ready"
      : state.requireAcceptance && !accepted
        ? "pending"
        : sourceStatus;

  return Object.freeze({
    id: row.id,
    kind: row.kind,
    nodeKind: row.nodeKind ?? "unknown",
    status,
    sourceStatus,
    label: row.label ?? row.id,
    detail: row.detail ?? "",
    route: row.route ?? "mailchimp/ast-preview",
    sourcePath: Object.freeze(Array.isArray(row.sourcePath) ? row.sourcePath.map((item) => String(item)) : []),
    handoff: Object.freeze(Array.isArray(row.handoff) ? row.handoff.map((item) => String(item)).sort() : []),
    count: Number.isFinite(Number(row.count)) ? Math.max(0, Math.trunc(Number(row.count))) : 0,
    accepted,
    completed,
    failed,
    restartSafe: row.restartSafe !== false && !failed,
    idempotencyKey: row.idempotencyKey ?? `${state.fileName}:${state.revision}:${row.id}:${sourceStatus}`,
    nextAction: blocked
      ? row.nextAction ?? "repair-mailchimp-ast-preview-acceptance"
      : completed
        ? "retain-mailchimp-ast-preview-row"
        : state.requireAcceptance && !accepted
          ? `accept-mailchimp-ast-preview:${row.id}`
          : sourceStatus === "review"
            ? `review-mailchimp-ast-preview:${row.id}`
            : row.nextAction ?? "publish-mailchimp-ast-preview-row",
  });
}

function createMailchimpAstPreviewNextSteps(status, rows, context) {
  if (status === "idle") {
    return [Object.freeze({
      id: "mailchimp-ast-preview:add-job",
      status: "ready",
      label: "Add Mailchimp job declaration",
      detail: "No exportable AST preview rows were produced.",
      route: "mailchimp/ast-preview/summary",
      nextAction: context.analyticsReport.exportSummary?.nextAction ?? "add-job-declaration",
    })];
  }

  const actionable = rows.filter((row) => row.status !== "ready");
  if (actionable.length) {
    return actionable.map((row) => Object.freeze({
      id: `mailchimp-ast-preview-step:${row.id}`,
      status: row.status,
      label: row.label,
      detail: row.detail,
      route: row.route,
      nextAction: row.nextAction,
    }));
  }

  return [Object.freeze({
    id: "mailchimp-ast-preview:publish",
    status: "ready",
    label: "Publish Mailchimp AST preview",
    detail: `${rows.length} Mailchimp AST preview row(s) are accepted and restart-safe.`,
    route: "mailchimp/ast-preview/summary",
    nextAction: context.analyticsBundle.exportSummary?.nextAction ?? "publish-mailchimp-ast-preview-acceptance",
  })];
}

function dedupeMailchimpAstPreviewRows(rows = []) {
  const deduped = new Map();
  for (const row of rows) {
    const existing = deduped.get(row.id);
    if (!existing || rankMailchimpAstPreviewStatus(row.status) < rankMailchimpAstPreviewStatus(existing.status)) {
      deduped.set(row.id, row);
    }
  }
  return [...deduped.values()];
}

function compareMailchimpAstPreviewRows(left, right) {
  return rankMailchimpAstPreviewStatus(left.status) - rankMailchimpAstPreviewStatus(right.status)
    || left.kind.localeCompare(right.kind)
    || left.nodeKind.localeCompare(right.nodeKind)
    || left.id.localeCompare(right.id);
}

function normalizeMailchimpAstPreviewStatus(status) {
  if (status === "ready" || status === "idle" || status === "empty") return "ready";
  if (status === "pending" || status === "needsAcceptance" || status === "queued") return "pending";
  if (status === "blocked" || status === "failed" || status === "unsupported") return "blocked";
  if (status === "review" || status === "changed" || status === "degraded" || status === "needsDiagnostic") return "review";
  return status ? "review" : "review";
}

function rankMailchimpAstPreviewStatus(status) {
  return {
    blocked: 0,
    pending: 1,
    needsAcceptance: 1,
    review: 2,
    changed: 2,
    ready: 3,
    idle: 4,
  }[status] ?? 5;
}

function countMailchimpAstPreviewRows(rows = [], field) {
  const counters = {};
  for (const row of rows) incrementCounter(counters, row[field] ?? "unknown");
  return counters;
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

function createAstCheckpointRowsFromBatch(batchSummary = {}) {
  const laneRows = (batchSummary.lanes ?? []).map((lane) => Object.freeze({
    id: `batch:${lane.id}`,
    kind: "astBatchLane",
    status: lane.status,
    label: lane.label,
    detail: lane.detail,
    handoff: "mailchimp-ast-export-batch",
    nextAction: lane.nextAction,
    sourceId: lane.id,
  }));
  const historyRows = (batchSummary.history ?? []).map((row) => Object.freeze({
    id: `history:${row.index ?? row.hash ?? row.status}`,
    kind: "astHistorySnapshot",
    status: row.status === "changed" || row.status === "new" ? "review" : "ready",
    label: "AST history snapshot",
    detail: row.detail ?? `AST history ${row.status ?? "ready"}.`,
    handoff: "mailchimp-ast-history",
    nextAction: row.nextAction ?? "retain-mailchimp-ast-history",
    sourceId: row.hash ?? row.index ?? row.status,
  }));
  const timelineRows = (batchSummary.timeline ?? []).map((event) => Object.freeze({
    id: `timeline:${event.index}:${event.jobName ?? "unknown"}`,
    kind: "astTimelineEvent",
    status: event.status,
    label: event.jobName ? `Timeline ${event.jobName}` : "AST timeline event",
    detail: `${event.kind ?? AIOS_AST_NODE_KINDS.JobDeclaration} ${event.status ?? "ready"}.`,
    handoff: "mailchimp-ast-timeline",
    nextAction: event.nextAction,
    sourceId: `${event.index}:${event.jobName ?? "unknown"}`,
  }));

  return Object.freeze([...laneRows, ...historyRows, ...timelineRows]);
}

function createAstCheckpointRowsFromResume(resumeLedger = {}) {
  return Object.freeze((resumeLedger.commands ?? []).map((command) => Object.freeze({
    id: `resume:${command.id}`,
    kind: command.kind ?? "astResumeCommand",
    status: command.status,
    label: command.laneId ? `Resume ${command.laneId}` : "Resume AST export",
    detail: command.completed
      ? "AST export command already completed."
      : command.retryRequested
        ? "AST export command is queued for retry."
        : `AST export command is ${command.status ?? "ready"}.`,
    handoff: "mailchimp-ast-export-resume",
    nextAction: command.nextAction,
    sourceId: command.id,
    completed: command.completed,
    idempotencyKey: command.idempotencyKey,
  })));
}

function createAstCheckpointRowsFromQueue(campaignQueue = {}) {
  return Object.freeze((campaignQueue.queue ?? campaignQueue.rows ?? campaignQueue.jobs ?? []).map((row) => Object.freeze({
    id: `queue:${row.id ?? row.jobName ?? row.name ?? "mailchimp-campaign"}`,
    kind: "mailchimpCampaignQueue",
    status: row.status,
    label: row.jobName ? `Queue ${row.jobName}` : "Campaign export queue",
    detail: row.userVisible?.detail ?? row.detail ?? `Campaign export queue is ${row.status ?? "ready"}.`,
    handoff: "mailchimp-campaign-export-queue",
    nextAction: row.nextAction ?? row.userVisible?.nextAction,
    sourceId: row.id ?? row.jobName ?? row.name,
    completed: row.status === "exported" || row.status === "ready",
    idempotencyKey: row.idempotencyKey,
  })));
}

function normalizeMailchimpAstCheckpointRow(row = {}, state = {}) {
  const id = String(row.id ?? `${row.kind ?? "checkpoint"}:${row.sourceId ?? "unknown"}`);
  const accepted = state.requireAcceptance === false || state.acceptedCheckpointIds.has(id) || state.acceptedCheckpointIds.has(row.sourceId);
  const completed = Boolean(row.completed) || state.completedCheckpointIds.has(id) || state.completedCheckpointIds.has(row.sourceId);
  const sourceStatus = normalizeMailchimpCheckpointStatus(row.status);
  const status = sourceStatus === "blocked"
    ? "blocked"
    : completed
      ? "ready"
      : accepted
        ? sourceStatus
        : "pending";

  return Object.freeze({
    id,
    kind: String(row.kind ?? "astCheckpoint"),
    status,
    sourceStatus,
    accepted,
    completed,
    label: String(row.label ?? id),
    detail: String(row.detail ?? ""),
    handoff: String(row.handoff ?? "mailchimp-ast-checkpoint"),
    sourceId: row.sourceId ?? null,
    idempotencyKey: row.idempotencyKey ?? [
      state.fileName ?? "inline.aios",
      state.revision ?? "working",
      id,
      sourceStatus,
    ].join(":"),
    nextAction: status === "blocked"
      ? row.nextAction ?? "repair-mailchimp-ast-checkpoint"
      : completed
        ? "retain-mailchimp-ast-checkpoint"
        : !accepted
          ? `accept-mailchimp-ast-checkpoint:${id}`
          : row.nextAction ?? "publish-mailchimp-ast-checkpoint",
  });
}

function normalizeMailchimpCheckpointStatus(status) {
  if (status === "ready" || status === "idle" || status === "empty") return "ready";
  if (status === "pending" || status === "needsAcceptance") return "pending";
  if (status === "blocked" || status === "failed" || status === "disabled") return "blocked";
  return "review";
}

function compareMailchimpAstCheckpointRows(left, right) {
  return checkpointStatusRank(left.status) - checkpointStatusRank(right.status)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function checkpointStatusRank(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    ready: 3,
  }[status] ?? 4;
}

function countAstCheckpointField(rows = [], field) {
  const counters = {};
  for (const row of rows) incrementCounter(counters, row[field] ?? "unknown");
  return counters;
}

function countAstCheckpointCompletion(rows = []) {
  const counters = {};
  for (const row of rows) incrementCounter(counters, row.completed ? "completed" : "incomplete");
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
  const lifecycleCommands = normalizeMailchimpLifecycleCommandSettings(settings);

  return Object.freeze({
    disabledJobs,
    enabledJobs,
    scheduleOverrides,
    sendWindowOverrides,
    defaultSendWindow,
    requiredCapabilities,
    tenantPermissions,
    lifecycleCommands,
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
      lifecycleCommands: lifecycleCommands.publicSettings,
    }),
  });
}

function normalizeMailchimpLifecycleCommandSettings(settings = {}) {
  const raw = settings.lifecycleCommands && typeof settings.lifecycleCommands === "object"
    ? settings.lifecycleCommands
    : settings.mailchimpLifecycleCommands && typeof settings.mailchimpLifecycleCommands === "object"
      ? settings.mailchimpLifecycleCommands
      : settings;
  const requested = normalizeMailchimpCommandMap(raw.requested ?? raw.requestedCommands ?? raw.requestedLifecycleCommands);
  const completed = normalizeMailchimpCommandMap(raw.completed ?? raw.completedCommands ?? raw.completedLifecycleCommands);
  const failed = normalizeMailchimpCommandMap(raw.failed ?? raw.failedCommands ?? raw.failedLifecycleCommands);
  const pausedJobs = new Set((Array.isArray(raw.pausedJobs ?? settings.pausedJobs) ? raw.pausedJobs ?? settings.pausedJobs : [])
    .map((name) => String(name).trim())
    .filter(Boolean));
  const pauseReasons = normalizeMailchimpStringMap(raw.pauseReasons ?? settings.pauseReasons);
  const disableReasons = normalizeMailchimpStringMap(raw.disableReasons ?? settings.disableReasons);
  const commandReasons = normalizeMailchimpStringMap(raw.commandReasons ?? settings.commandReasons);

  return Object.freeze({
    requested,
    completed,
    failed,
    pausedJobs,
    pauseReasons,
    disableReasons,
    commandReasons,
    publicSettings: Object.freeze({
      requested: freezeMailchimpCommandMap(requested),
      completed: freezeMailchimpCommandMap(completed),
      failed: freezeMailchimpCommandMap(failed),
      pausedJobs: Object.freeze([...pausedJobs].sort()),
      pauseReasons,
      disableReasons,
      commandReasons,
    }),
  });
}

function createMailchimpLifecycleCommandStateFromJobs(jobStates = [], workflowSettings = {}, options = {}) {
  const settings = workflowSettings.lifecycleCommands ?? normalizeMailchimpLifecycleCommandSettings(options);
  const detectedJobs = (Array.isArray(jobStates) ? jobStates : []).filter((job) => job.detected);
  const rows = detectedJobs.flatMap((job) => createMailchimpLifecycleCommandRows(job, settings, options));
  const issues = rows
    .filter((row) => row.status === "blocked" || row.status === "review")
    .map((row) => createMailchimpWorkflowIssue({
      code: "AIOS_MAILCHIMP_LIFECYCLE_COMMAND",
      status: row.status,
      jobName: row.jobName,
      detail: row.detail,
      recovery: row.recovery,
      nextAction: row.nextAction,
      target: row.commandId,
    }));
  const blocked = rows.filter((row) => row.status === "blocked");
  const pending = rows.filter((row) => row.status === "pending");
  const review = rows.filter((row) => row.status === "review");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : rows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-lifecycle-command-state.v1",
    status,
    ok: status === "ready" || status === "idle" || status === "review",
    exportAllowed: blocked.length === 0 && pending.length === 0,
    providerId: AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
    rows: Object.freeze(rows.sort(compareMailchimpLifecycleCommandRows)),
    issues: Object.freeze(issues),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpLifecycleRows(rows, "status")),
      byCommand: freezeSortedRecord(countMailchimpLifecycleRows(rows, "commandId")),
      byJob: freezeSortedRecord(countMailchimpLifecycleRows(rows, "jobName")),
    }),
    totals: Object.freeze({
      rowCount: rows.length,
      detectedJobCount: detectedJobs.length,
      blockedCount: blocked.length,
      pendingCount: pending.length,
      reviewCount: review.length,
    }),
    restartEnvelope: Object.freeze({
      route: status === "blocked"
        ? "mailchimp/lifecycle-commands/recovery"
        : status === "pending"
          ? "mailchimp/lifecycle-commands/queue"
          : status === "review"
            ? "mailchimp/lifecycle-commands/review"
            : "mailchimp/lifecycle-commands/summary",
      restartSafe: blocked.length === 0,
      blockedCommandIds: Object.freeze(blocked.map((row) => row.id).sort()),
      pendingCommandIds: Object.freeze(pending.map((row) => row.id).sort()),
      reviewCommandIds: Object.freeze(review.map((row) => row.id).sort()),
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      nextAction: blocked[0]?.nextAction
        ?? pending[0]?.nextAction
        ?? review[0]?.nextAction
        ?? "publish-mailchimp-lifecycle-command-state",
    }),
    nextAction: blocked[0]?.nextAction
      ?? pending[0]?.nextAction
      ?? review[0]?.nextAction
      ?? "publish-mailchimp-lifecycle-command-state",
  });
}

function createMailchimpLifecycleCommandRows(job = {}, settings = {}, options = {}) {
  const commands = AIOS_MAILCHIMP_WORKFLOW_CONTROLS.lifecycleCommands;
  const paused = settings.pausedJobs?.has(job.jobName) || job.lifecycle?.paused === true || job.paused === true;
  const jobStatus = !job.enabled ? "disabled" : paused ? "paused" : job.status;
  return Object.values(commands).map((command) => {
    const commandKey = `${job.jobName}:${command.id}`;
    const requested = hasMailchimpCommand(settings.requested, job.jobName, command.id);
    const completed = hasMailchimpCommand(settings.completed, job.jobName, command.id);
    const failed = hasMailchimpCommand(settings.failed, job.jobName, command.id);
    const reason = selectMailchimpLifecycleCommandReason(command, job, settings, commandKey);
    const allowed = command.allowedStatuses.includes(jobStatus);
    const missingReason = command.requiresReason && requested && !reason;
    const scheduleReady = command.id !== "acceptScheduleWindow" || job.scheduleWindow?.status === "review";
    const status = failed || (requested && (!allowed || missingReason || !scheduleReady))
      ? "blocked"
      : completed
        ? "ready"
        : requested
          ? "pending"
          : command.id === "acceptScheduleWindow" && job.scheduleWindow?.status === "review"
            ? "review"
            : "ready";

    return Object.freeze({
      id: `mailchimp-lifecycle:${commandKey}`,
      commandId: command.id,
      label: command.label,
      jobName: job.jobName,
      status,
      jobStatus,
      requested,
      completed,
      failed,
      enabled: !completed,
      requiresReason: command.requiresReason,
      reason: reason ?? null,
      scheduleMode: job.schedule?.mode ?? "manual",
      scheduleWindowId: job.scheduleWindow?.id ?? null,
      scheduleWindowStatus: job.scheduleWindow?.status ?? "ready",
      detail: createMailchimpLifecycleCommandDetail(command, {
        job,
        status,
        jobStatus,
        allowed,
        missingReason,
        scheduleReady,
      }),
      recovery: status === "blocked"
        ? "repair-mailchimp-lifecycle-command"
        : command.nextAction,
      nextAction: status === "blocked"
        ? failed
          ? "retry-mailchimp-lifecycle-command"
          : missingReason
            ? "record-mailchimp-lifecycle-command-reason"
            : !scheduleReady
              ? "repair-mailchimp-send-window"
              : command.nextAction
        : status === "pending"
          ? "apply-mailchimp-lifecycle-command"
          : status === "review"
            ? command.nextAction
            : "retain-mailchimp-lifecycle-command",
      idempotencyKey: [
        options.revision ?? "working",
        job.jobName,
        command.id,
        jobStatus,
        job.schedule?.mode ?? "manual",
        job.scheduleWindow?.id ?? "window-unbound",
      ].join(":"),
    });
  });
}

function selectMailchimpLifecycleCommandReason(command = {}, job = {}, settings = {}, commandKey = "") {
  if (settings.commandReasons?.[commandKey]) return settings.commandReasons[commandKey];
  if (settings.commandReasons?.[command.id]) return settings.commandReasons[command.id];
  if (command.id === "pauseCampaign") return settings.pauseReasons?.[job.jobName] ?? null;
  if (command.id === "disableCampaign") return settings.disableReasons?.[job.jobName] ?? null;
  return null;
}

function createMailchimpLifecycleCommandDetail(command = {}, context = {}) {
  if (context.status === "blocked" && context.missingReason) {
    return `${command.label} for "${context.job.jobName}" needs a reason before handoff.`;
  }
  if (context.status === "blocked" && !context.allowed) {
    return `${command.label} is not allowed while "${context.job.jobName}" is ${context.jobStatus}.`;
  }
  if (context.status === "blocked" && !context.scheduleReady) {
    return `${command.label} needs a reviewable Mailchimp schedule window.`;
  }
  if (context.status === "pending") return `${command.label} is queued for "${context.job.jobName}".`;
  if (context.status === "review") return `${command.label} is available for "${context.job.jobName}" before export.`;
  return `${command.label} is retained for "${context.job.jobName}".`;
}

function normalizeMailchimpCommandMap(value) {
  const map = new Map();
  const add = (jobName, commandId) => {
    const safeJob = String(jobName ?? "").trim();
    const safeCommand = String(commandId ?? "").trim();
    if (!safeCommand) return;
    const key = safeJob || "*";
    const commands = map.get(key) ?? new Set();
    commands.add(safeCommand);
    map.set(key, commands);
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        const [jobName, commandId] = item.includes(":") ? item.split(":").slice(-2) : ["*", item];
        add(jobName, commandId);
      } else if (item && typeof item === "object") {
        add(item.jobName ?? item.job ?? item.target, item.commandId ?? item.command ?? item.id);
      }
    }
  } else if (value && typeof value === "object") {
    for (const [jobName, commands] of Object.entries(value)) {
      for (const commandId of Array.isArray(commands) ? commands : [commands]) add(jobName, commandId);
    }
  }

  return map;
}

function hasMailchimpCommand(map, jobName, commandId) {
  return Boolean(map?.get(jobName)?.has(commandId) || map?.get("*")?.has(commandId));
}

function freezeMailchimpCommandMap(map) {
  return Object.freeze(Object.fromEntries([...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([jobName, commands]) => [jobName, Object.freeze([...commands].sort())])));
}

function normalizeMailchimpStringMap(value) {
  const entries = Object.entries(value && typeof value === "object" ? value : {})
    .map(([key, raw]) => [String(key).trim(), raw == null ? "" : String(raw).trim()])
    .filter(([key, raw]) => key && raw);
  return Object.freeze(Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))));
}

function countMailchimpLifecycleRows(rows, field) {
  const counters = {};
  for (const row of rows) incrementCounter(counters, row[field] ?? "unknown");
  return counters;
}

function compareMailchimpLifecycleCommandRows(left, right) {
  return left.status.localeCompare(right.status)
    || left.jobName.localeCompare(right.jobName)
    || left.commandId.localeCompare(right.commandId)
    || left.id.localeCompare(right.id);
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
  const bySyncChannel = {};
  for (const operation of operations) {
    incrementCounter(byStatus, operation.status);
    incrementCounter(byService, operation.service);
    incrementCounter(bySyncChannel, operation.syncChannel);
  }

  return Object.freeze({
    providerId: options.providerId,
    revision: options.revision ?? "working",
    externalRunId: options.externalRunId ?? null,
    workflowJobCount: jobs.length,
    operationCount: operations.length,
    byStatus: freezeSortedRecord(byStatus),
    byService: freezeSortedRecord(byService),
    bySyncChannel: freezeSortedRecord(bySyncChannel),
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

function createMailchimpProviderServiceSyncWindows(operations = [], context = {}) {
  const acceptedWindowIds = normalizeStringSet(context.acceptedServiceSyncWindowIds);
  const requireAcceptance = context.requireServiceSyncWindowAcceptance === true;
  const byChannel = new Map();

  for (const operation of operations) {
    const channel = operation.syncChannel ?? "mailchimp-provider";
    const current = byChannel.get(channel) ?? {
      channel,
      operations: [],
    };
    current.operations.push(operation);
    byChannel.set(channel, current);
  }

  const windows = [...byChannel.values()].map((group) => {
    const operationStatuses = group.operations.map((operation) => operation.status);
    const blocked = group.operations.filter((operation) => operation.status === "blocked");
    const review = group.operations.filter((operation) => operation.status === "review");
    const operationIds = group.operations.map((operation) => operation.id).sort();
    const services = [...new Set(group.operations.map((operation) => operation.service))].sort();
    const tenants = [...new Set(group.operations
      .map((operation) => operation.tenantBoundary?.tenantId ?? "tenant-unbound"))].sort();
    const workspaces = [...new Set(group.operations
      .map((operation) => operation.tenantBoundary?.workspaceId ?? "workspace-unbound"))].sort();
    const id = [
      context.syncMetadata?.providerId ?? AIOS_MAILCHIMP_WORKFLOW_CONTROLS.providerId,
      context.syncMetadata?.revision ?? context.revision ?? "working",
      group.channel,
      tenants.join("+"),
      workspaces.join("+"),
    ].join(":");
    const accepted = acceptedWindowIds.has(id) || acceptedWindowIds.has(group.channel);
    const status = blocked.length
      ? "blocked"
      : review.length
        ? "review"
        : requireAcceptance && !accepted
          ? "pending"
          : "ready";

    return Object.freeze({
      id,
      channel: group.channel,
      status,
      accepted,
      requireAcceptance,
      operationIds: Object.freeze(operationIds),
      operationCount: group.operations.length,
      services: Object.freeze(services),
      tenants: Object.freeze(tenants),
      workspaces: Object.freeze(workspaces),
      operationStatuses: Object.freeze(operationStatuses.sort()),
      idempotencyKey: [
        context.syncMetadata?.syncKey ?? "mailchimp-service",
        group.channel,
        operationIds.join("+") || "no-operations",
      ].join(":"),
      restartSafe: blocked.length === 0,
      externalState: Object.freeze({
        externalRunId: context.syncMetadata?.externalRunId ?? context.externalRunId ?? null,
        revision: context.syncMetadata?.revision ?? context.revision ?? "working",
        tenantBoundaryStatus: context.tenantBoundary?.status ?? "unbound",
        syncKey: context.syncMetadata?.syncKey ?? null,
      }),
      nextAction: blocked[0]?.nextAction
        ?? (review.length ? "review-mailchimp-service-sync-window" : null)
        ?? (requireAcceptance && !accepted ? "accept-mailchimp-service-sync-window" : "publish-mailchimp-service-sync-window"),
    });
  }).sort((left, right) => left.status.localeCompare(right.status) || left.channel.localeCompare(right.channel));

  const blocked = windows.filter((window) => window.status === "blocked");
  const pending = windows.filter((window) => window.status === "pending");
  const review = windows.filter((window) => window.status === "review");
  const ready = windows.filter((window) => window.status === "ready");
  const status = blocked.length
    ? "blocked"
    : pending.length
      ? "pending"
      : review.length
        ? "review"
        : windows.length
          ? "ready"
          : "idle";

  return Object.freeze({
    version: "mailchimp-provider-service-sync-windows.v1",
    status,
    ok: status === "ready" || status === "idle",
    requireAcceptance,
    windowCount: windows.length,
    operationCount: operations.length,
    windows: Object.freeze(windows),
    counters: Object.freeze({
      byStatus: freezeSortedRecord(countMailchimpWindowField(windows, "status")),
      byChannel: freezeSortedRecord(countMailchimpWindowField(windows, "channel")),
    }),
    recovery: Object.freeze({
      blockedWindowIds: Object.freeze(blocked.map((window) => window.id).sort()),
      pendingWindowIds: Object.freeze(pending.map((window) => window.id).sort()),
      reviewWindowIds: Object.freeze(review.map((window) => window.id).sort()),
      readyWindowIds: Object.freeze(ready.map((window) => window.id).sort()),
    }),
    nextAction: blocked[0]?.nextAction
      ?? pending[0]?.nextAction
      ?? review[0]?.nextAction
      ?? (windows.length ? "publish-mailchimp-service-sync-windows" : "skip-mailchimp-service-sync-windows"),
  });
}

function createMailchimpProviderServiceReadinessRow(contract = {}, context = {}) {
  const operations = context.operations.filter((operation) => (
    operation.service === contract.service
    && operation.operation === contract.operation
  ));
  const operationIds = operations.map((operation) => operation.id).sort();
  const windows = (context.serviceContract.serviceSyncWindows?.windows ?? [])
    .filter((window) => (window.operationIds ?? []).some((id) => operationIds.includes(id)));
  const checkpointRows = (context.checkpoint.rows ?? [])
    .filter((row) => (row.operationIds ?? []).some((id) => operationIds.includes(id)));
  const missingCapabilities = (contract.requiredCapabilities ?? [])
    .filter((capability) => !(context.serviceContract.capabilityNegotiation ?? [])
      .some((row) => row.capability === capability && row.status === "ready"));
  const operationStatuses = operations.map((operation) => operation.status);
  const checkpointStatuses = checkpointRows.map((row) => row.status);
  const windowStatuses = windows.map((window) => window.status);
  const blocked = missingCapabilities.length > 0
    || operationStatuses.includes("blocked")
    || checkpointStatuses.includes("blocked")
    || windowStatuses.includes("blocked");
  const pending = !blocked && (
    checkpointStatuses.includes("pending")
    || windowStatuses.includes("pending")
  );
  const review = !blocked && !pending && (
    operationStatuses.includes("review")
    || checkpointStatuses.includes("review")
    || windowStatuses.includes("review")
  );
  const degraded = !blocked && !pending && !review && operations.length === 0;
  const status = blocked
    ? "blocked"
    : pending
      ? "pending"
      : review
        ? "review"
        : degraded
          ? "degraded"
          : "ready";
  const capabilityStatus = missingCapabilities.length
    ? "blocked"
    : operations.length
      ? "ready"
      : "degraded";
  const checkpointStatus = selectMailchimpServiceReadinessCheckpointStatus(checkpointRows, windows, operations);

  return Object.freeze({
    id: `mailchimp-provider-service-readiness:${contract.service}:${contract.operation}`,
    service: contract.service,
    operation: contract.operation,
    status,
    capabilityStatus,
    checkpointStatus,
    requiredCapabilities: contract.requiredCapabilities,
    missingCapabilities: Object.freeze(missingCapabilities.sort()),
    syncChannel: contract.syncChannel,
    idempotencyScope: contract.idempotencyScope,
    operationCount: operations.length,
    operationIds: Object.freeze(operationIds),
    windowIds: Object.freeze(windows.map((window) => window.id).sort()),
    checkpointRowIds: Object.freeze(checkpointRows.map((row) => row.id).sort()),
    restartSafe: status !== "blocked" && checkpointRows.every((row) => row.restartSafe !== false),
    exportAllowed: status === "ready"
      || (status === "degraded" && context.allowDegradedOptionalServices === true),
    idempotencyKey: [
      context.serviceContract.syncMetadata?.syncKey ?? "mailchimp-service-unbound",
      contract.service,
      contract.operation,
      operationIds.join("+") || "no-operations",
      checkpointRows.map((row) => row.status).sort().join("+") || "no-checkpoint",
    ].join(":"),
    nextAction: selectMailchimpServiceReadinessNextAction(status, {
      contract,
      missingCapabilities,
      checkpointRows,
      windows,
      operations,
    }),
  });
}

function selectMailchimpServiceReadinessCheckpointStatus(checkpointRows, windows, operations) {
  const checkpointStatuses = checkpointRows.map((row) => row.status);
  const windowStatuses = windows.map((window) => window.status);
  if (checkpointStatuses.includes("blocked") || windowStatuses.includes("blocked")) return "blocked";
  if (checkpointStatuses.includes("pending") || windowStatuses.includes("pending")) return "pending";
  if (checkpointStatuses.includes("review") || windowStatuses.includes("review")) return "review";
  if (checkpointRows.length || windows.length) return "ready";
  return operations.length ? "untracked" : "idle";
}

function selectMailchimpServiceReadinessNextAction(status, context) {
  if (context.missingCapabilities.length) return `negotiate-${context.missingCapabilities[0]}`;
  if (status === "blocked") {
    return context.checkpointRows.find((row) => row.status === "blocked")?.nextAction
      ?? context.windows.find((window) => window.status === "blocked")?.nextAction
      ?? context.operations.find((operation) => operation.status === "blocked")?.nextAction
      ?? context.contract.recovery
      ?? "repair-mailchimp-provider-service-readiness";
  }
  if (status === "pending") {
    return context.checkpointRows.find((row) => row.status === "pending")?.nextAction
      ?? context.windows.find((window) => window.status === "pending")?.nextAction
      ?? "accept-mailchimp-provider-service-readiness";
  }
  if (status === "review") {
    return context.checkpointRows.find((row) => row.status === "review")?.nextAction
      ?? context.windows.find((window) => window.status === "review")?.nextAction
      ?? "review-mailchimp-provider-service-readiness";
  }
  if (status === "degraded") return context.contract.recovery ?? "bind-mailchimp-provider-service-operation";
  return "publish-mailchimp-provider-service-readiness";
}

function compareMailchimpServiceReadinessRows(left, right) {
  return left.status.localeCompare(right.status)
    || left.service.localeCompare(right.service)
    || left.operation.localeCompare(right.operation);
}

function countMailchimpServiceReadinessField(rows = [], field) {
  const counters = {};
  for (const row of rows) incrementCounter(counters, row[field] ?? "unknown");
  return counters;
}

function mailchimpProviderServiceHandoffLane(id, lane = {}) {
  const contract = lane.contract ?? {};
  const status = normalizeMailchimpProviderServiceHandoffStatus(contract.status ?? lane.status ?? "idle");
  const exportAllowed = contract.exportAllowed ?? contract.exportSummary?.exportAllowed ?? lane.exportAllowed ?? (status === "ready" || status === "idle");
  const restartSafe = contract.restartEnvelope?.restartSafe ?? contract.restartSafe ?? lane.restartSafe ?? status !== "blocked";

  return Object.freeze({
    id,
    label: lane.label ?? id,
    status: exportAllowed === false && status === "ready" ? "blocked" : status,
    handoff: lane.handoff ?? "mailchimp-provider-service-handoff",
    route: lane.route ?? contract.restartEnvelope?.route ?? "mailchimp/provider-service-handoff",
    count: Number.isFinite(Number(lane.count)) ? Math.max(0, Math.trunc(Number(lane.count))) : 0,
    exportAllowed: exportAllowed !== false,
    restartSafe: restartSafe !== false,
    detail: lane.detail
      ?? contract.userVisible?.detail
      ?? `${lane.label ?? id} is ${status}.`,
    nextAction: lane.nextAction
      ?? contract.restartEnvelope?.nextAction
      ?? contract.recovery?.nextAction
      ?? contract.externalHandoff?.nextAction
      ?? selectMailchimpProviderServiceHandoffAction(id, status),
    idempotencyKey: lane.idempotencyKey
      ?? contract.syncKey
      ?? contract.commandSyncKey
      ?? contract.restartEnvelope?.idempotencyKeys?.join(".")
      ?? `${id}:${status}`,
  });
}

function normalizeMailchimpProviderServiceHandoffStatus(status) {
  if (status === "ready" || status === "idle" || status === "empty") return status;
  if (status === "pending" || status === "queued" || status === "needsAcceptance" || status === "retry") return "pending";
  if (status === "blocked" || status === "failed" || status === "disabled" || status === "required") return "blocked";
  if (status === "review" || status === "degraded" || status === "unbound") return "review";
  return status ? "review" : "idle";
}

function selectMailchimpProviderServiceHandoffAction(id, status) {
  if (status === "blocked") return `repair-mailchimp-provider-service-handoff:${id}`;
  if (status === "pending") return `settle-mailchimp-provider-service-handoff:${id}`;
  if (status === "review") return `review-mailchimp-provider-service-handoff:${id}`;
  if (status === "idle") return `skip-mailchimp-provider-service-handoff:${id}`;
  return `publish-mailchimp-provider-service-handoff:${id}`;
}

function compareMailchimpProviderServiceHandoffLanes(left, right) {
  return mailchimpProviderServiceHandoffStatusOrder(left.status) - mailchimpProviderServiceHandoffStatusOrder(right.status)
    || left.id.localeCompare(right.id);
}

function mailchimpProviderServiceHandoffStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    needsAcceptance: 1,
    review: 2,
    degraded: 2,
    ready: 3,
    idle: 4,
  }[status] ?? 5;
}

function countMailchimpProviderServiceHandoffField(rows = [], field) {
  const counters = {};
  for (const row of rows) incrementCounter(counters, row[field] ?? "unknown");
  return counters;
}

function mailchimpProviderServiceHandoffExportRow(lane = {}, state = {}) {
  const exportId = `provider-service-handoff-export:${lane.id}`;
  const accepted = state.accepted.has(lane.id) || state.accepted.has(exportId) || state.requireAcceptance === false;
  const completed = state.completed.has(lane.id) || state.completed.has(exportId);
  const failed = state.failed.has(lane.id) || state.failed.has(exportId);
  const blocked = failed || lane.status === "blocked" || lane.exportAllowed === false || lane.restartSafe === false;
  const status = blocked
    ? "blocked"
    : completed
      ? "ready"
      : state.requireAcceptance && !accepted
        ? "pending"
        : lane.status === "pending" || lane.status === "needsAcceptance"
          ? "pending"
          : lane.status === "review" || lane.status === "degraded"
            ? "review"
            : "ready";

  return Object.freeze({
    id: exportId,
    laneId: lane.id,
    status,
    laneStatus: lane.status,
    label: lane.label ?? lane.id,
    detail: lane.detail ?? `${lane.label ?? lane.id} is ${lane.status ?? "unbound"}.`,
    handoff: lane.handoff ?? "mailchimp-provider-service-handoff",
    route: status === "blocked"
      ? "mailchimp/provider-service-handoff/export/recovery"
      : status === "pending"
        ? "mailchimp/provider-service-handoff/export/acceptance"
        : status === "review"
          ? "mailchimp/provider-service-handoff/export/review"
          : lane.route ?? "mailchimp/provider-service-handoff/export/summary",
    count: Number.isFinite(Number(lane.count)) ? Math.max(0, Math.trunc(Number(lane.count))) : 0,
    accepted,
    completed,
    failed,
    exportAllowed: lane.exportAllowed !== false && !failed,
    restartSafe: lane.restartSafe !== false && !failed,
    idempotencyKey: [
      state.handoff.syncKey ?? "mailchimp-provider-service-handoff-unbound",
      lane.id,
      lane.idempotencyKey ?? lane.status ?? "unknown",
      status,
    ].join(":"),
    nextAction: blocked
      ? lane.nextAction ?? "repair-mailchimp-provider-service-handoff-export"
      : completed
        ? "retain-mailchimp-provider-service-handoff-export-row"
        : state.requireAcceptance && !accepted
          ? `accept-mailchimp-provider-service-handoff-export:${exportId}`
          : status === "review"
            ? lane.nextAction ?? "review-mailchimp-provider-service-handoff-export"
            : lane.nextAction ?? "publish-mailchimp-provider-service-handoff-export-row",
  });
}

function compareMailchimpProviderServiceHandoffExportRows(left, right) {
  return mailchimpProviderServiceHandoffStatusOrder(left.status) - mailchimpProviderServiceHandoffStatusOrder(right.status)
    || left.handoff.localeCompare(right.handoff)
    || left.id.localeCompare(right.id);
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

function countMailchimpWindowField(windows, field) {
  const counters = {};
  for (const window of windows) incrementCounter(counters, window[field] ?? "unknown");
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

function createMailchimpOperationalHealthDigestRow(item = {}, context = {}) {
  const issueText = (item.issues ?? []).length ? item.issues.join(",") : item.status ?? "unknown";
  const retryBudget = item.retryBudget ?? {};
  const exhausted = retryBudget.remaining === 0 && item.status !== "ready";
  return Object.freeze({
    id: item.id,
    commandId: item.commandId,
    operationId: item.operationId,
    jobName: item.jobName,
    service: item.service,
    operation: item.operation,
    status: item.status,
    commandStatus: item.commandStatus,
    queueState: item.queueState,
    issues: item.issues ?? Object.freeze([]),
    restartSafe: item.restartSafe !== false,
    retryAfter: item.retryAfter ?? retryBudget.retryAfter ?? context.recoverySnapshot?.retryAfter ?? null,
    remainingAttempts: retryBudget.remaining ?? null,
    retryBudgetExhausted: exhausted,
    idempotencyKey: item.idempotencyKey,
    route: context.route,
    detail: `${item.jobName ?? "unbound job"} ${item.service ?? "unknown"}.${item.operation ?? "unknown"} is ${item.status ?? "unknown"} (${issueText}).`,
    nextAction: exhausted
      ? "escalate-mailchimp-provider-command"
      : item.nextAction ?? "repair-mailchimp-provider-command",
  });
}

function createMailchimpOperationalHealthIncidentRow(item = {}, context = {}) {
  const digestRow = context.digestRow ?? {};
  const retryBudget = item.retryBudget ?? {};
  const exhausted = retryBudget.remaining === 0 && item.status !== "ready";
  const restartSafe = item.restartSafe !== false && Boolean(item.idempotencyKey);
  const blocked = item.status === "blocked" || exhausted || !restartSafe;
  const severity = blocked ? "error" : item.status === "degraded" ? "warning" : "notice";
  const issueCodes = Object.freeze([...(item.issues ?? [])]
    .map((issue) => String(issue).trim())
    .filter(Boolean)
    .sort());
  const retryAfter = item.retryAfter
    ?? digestRow.retryAfter
    ?? retryBudget.retryAfter
    ?? context.recoverySnapshot?.retryAfter
    ?? null;

  return Object.freeze({
    id: `incident:${item.id ?? item.commandId ?? "unknown"}`,
    commandHealthId: item.id ?? null,
    commandId: item.commandId ?? null,
    operationId: item.operationId ?? null,
    jobName: item.jobName ?? null,
    service: item.service ?? null,
    operation: item.operation ?? null,
    status: blocked ? "blocked" : item.status ?? "review",
    severity,
    commandStatus: item.commandStatus ?? "unknown",
    queueState: item.queueState ?? "unbound",
    issueCodes,
    restartSafe,
    retryable: !blocked && (item.status === "degraded" || item.nextAction === "retry-mailchimp-provider-command"),
    retryAfter,
    attempts: retryBudget.attempt ?? item.attempt ?? 0,
    remainingAttempts: retryBudget.remaining ?? null,
    retryBudgetStatus: exhausted ? "exhausted" : retryBudget.remaining > 0 ? "available" : "unbound",
    degradedModeAllowed: context.degradedMode === true && !blocked,
    route: blocked
      ? "mailchimp/operational-health/incidents/recovery"
      : item.status === "degraded"
        ? "mailchimp/operational-health/incidents/degraded"
        : item.status === "pending"
          ? "mailchimp/operational-health/incidents/acceptance"
          : "mailchimp/operational-health/incidents/review",
    detail: [
      `${item.jobName ?? "unbound job"} ${item.service ?? "unknown"}.${item.operation ?? "unknown"} is ${blocked ? "blocked" : item.status ?? "review"}.`,
      issueCodes.length ? `issues=${issueCodes.join(",")}` : null,
      retryAfter ? `retryAfter=${retryAfter}` : null,
      exhausted ? "retryBudget=exhausted" : null,
      restartSafe ? null : "restartSafe=false",
    ].filter(Boolean).join(" "),
    idempotencyKey: item.idempotencyKey ?? digestRow.idempotencyKey ?? null,
    nextAction: exhausted
      ? "escalate-mailchimp-provider-command"
      : !restartSafe
        ? "rebuild-mailchimp-provider-command-idempotency"
        : item.nextAction ?? digestRow.nextAction ?? "repair-mailchimp-provider-command",
  });
}

function compareMailchimpOperationalHealthIncidentRows(left, right) {
  return mailchimpOperationalIncidentSeverityOrder(left.severity) - mailchimpOperationalIncidentSeverityOrder(right.severity)
    || String(left.jobName ?? "").localeCompare(String(right.jobName ?? ""))
    || String(left.commandId ?? "").localeCompare(String(right.commandId ?? ""))
    || left.id.localeCompare(right.id);
}

function mailchimpOperationalIncidentSeverityOrder(severity) {
  return {
    error: 0,
    warning: 1,
    notice: 2,
  }[severity] ?? 3;
}

function selectMailchimpOperationalHealthExportRoute(status) {
  if (status === "blocked") return "mailchimp/operational-health/recovery";
  if (status === "degraded") return "mailchimp/operational-health/backoff";
  if (status === "pending") return "mailchimp/operational-health/acceptance";
  if (status === "idle") return "mailchimp/operational-health/idle";
  return "mailchimp/operational-health/summary";
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

function mailchimpLifecycleCommand(command) {
  return Object.freeze({
    ...command,
    allowedStatuses: Object.freeze(command.allowedStatuses),
    requiresReason: command.requiresReason === true,
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

function campaignReleaseLane(id, lane) {
  const status = normalizeMailchimpReleaseLaneStatus(lane.status);
  return Object.freeze({
    id,
    label: lane.label,
    status,
    exportAllowed: lane.exportAllowed !== false,
    restartSafe: lane.restartSafe !== false,
    count: Number.isFinite(Number(lane.count)) ? Math.max(0, Math.trunc(Number(lane.count))) : 0,
    route: lane.route ?? "mailchimp/campaign-release",
    nextAction: lane.nextAction ?? "review-mailchimp-campaign-release",
    idempotencyKey: lane.idempotencyKey ?? null,
  });
}

function normalizeMailchimpReleaseLaneStatus(status) {
  const normalized = String(status ?? "idle").trim();
  if ([
    "ready",
    "idle",
    "review",
    "degraded",
    "pending",
    "needsAcceptance",
    "queued",
    "acknowledged",
    "duplicate",
  ].includes(normalized)) {
    return normalized === "queued" || normalized === "acknowledged" || normalized === "duplicate"
      ? "ready"
      : normalized;
  }
  if (["blocked", "failed", "disabled"].includes(normalized)) return "blocked";
  return "review";
}

function countMailchimpReleaseLanes(lanes = [], field) {
  const counters = {};
  for (const lane of lanes) incrementCounter(counters, lane[field] ?? "unknown");
  return counters;
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

function mailchimpHandoffReadinessLane(id, lane) {
  const contract = lane.contract ?? null;
  const status = normalizeMailchimpHandoffReadinessStatus(contract?.status ?? lane.status ?? "idle");
  const exportAllowed = lane.exportAllowed ?? contract?.exportAllowed ?? contract?.exportSummary?.exportAllowed ?? status === "ready";
  const restartSafe = contract?.restartEnvelope?.restartSafe
    ?? contract?.restartSafe
    ?? contract?.exportSummary?.restartSafe
    ?? status !== "blocked";

  return Object.freeze({
    id,
    label: lane.label,
    status: exportAllowed === false && status === "ready" ? "blocked" : status,
    exportAllowed: exportAllowed !== false,
    restartSafe: restartSafe !== false,
    count: Number.isFinite(Number(lane.count)) ? Math.max(0, Math.trunc(Number(lane.count))) : 0,
    route: lane.route ?? contract?.restartEnvelope?.route ?? "mailchimp/workflow-handoff",
    detail: lane.detail ?? contract?.userVisible?.detail ?? contract?.preview?.detail ?? `${lane.label} is ${status}.`,
    nextAction: lane.nextAction
      ?? contract?.restartEnvelope?.nextAction
      ?? contract?.recovery?.nextAction
      ?? contract?.userVisible?.nextAction
      ?? selectMailchimpHandoffReadinessLaneAction(id, status),
    idempotencyKey: lane.idempotencyKey
      ?? contract?.syncKey
      ?? contract?.restartEnvelope?.idempotencyKeys?.join(".")
      ?? `${id}:${status}`,
  });
}

function normalizeMailchimpHandoffReadinessStatus(status) {
  if (status === "ready" || status === "idle" || status === "empty") return status;
  if (status === "needsAcceptance" || status === "pending" || status === "queued") return "pending";
  if (status === "blocked" || status === "failed" || status === "disabled" || status === "required") return "blocked";
  if (status === "review" || status === "degraded" || status === "unbound") return "review";
  return status ? "review" : "idle";
}

function selectMailchimpHandoffReadinessLaneAction(id, status) {
  if (status === "blocked") return `repair-mailchimp-handoff-lane:${id}`;
  if (status === "pending") return `accept-mailchimp-handoff-lane:${id}`;
  if (status === "review") return `review-mailchimp-handoff-lane:${id}`;
  if (status === "idle") return `skip-mailchimp-handoff-lane:${id}`;
  return `publish-mailchimp-handoff-lane:${id}`;
}

function createMailchimpCampaignControlJobRows(jobs = []) {
  return jobs
    .filter((job) => job.detected)
    .flatMap((job) => [
      mailchimpCampaignControlPlaneRow(`job:${job.jobName}:enabled`, {
        kind: "workflowEnabled",
        status: job.enabled ? "ready" : "blocked",
        label: `${job.jobName} workflow enablement`,
        detail: job.enabled
          ? "Mailchimp workflow is enabled for this job."
          : "Mailchimp workflow is disabled for this job.",
        handoff: "mailchimp-campaign-lifecycle",
        route: "mailchimp/control-plane/workflow",
        exportAllowed: job.enabled,
        restartSafe: true,
        nextAction: job.enabled ? "retain-mailchimp-workflow-enabled" : "enable-mailchimp-campaign-workflow",
        idempotencyKey: `${job.jobName}:enabled:${job.enabled ? "on" : "off"}`,
        jobName: job.jobName,
      }),
      mailchimpCampaignControlPlaneRow(`job:${job.jobName}:schedule`, {
        kind: "scheduleControl",
        status: normalizeMailchimpCampaignControlStatus(job.schedule?.status ?? job.scheduleWindow?.status),
        label: `${job.jobName} campaign schedule`,
        detail: job.schedule?.detail ?? job.scheduleWindow?.detail ?? "Mailchimp schedule controls are prepared.",
        handoff: "mailchimp-schedule-state",
        route: "mailchimp/control-plane/schedule",
        exportAllowed: job.schedule?.status !== "blocked" && job.scheduleWindow?.status !== "blocked",
        restartSafe: job.schedule?.status !== "blocked" && job.scheduleWindow?.status !== "blocked",
        nextAction: job.scheduleWindow?.nextAction ?? job.schedule?.nextAction ?? "publish-mailchimp-schedule-control",
        idempotencyKey: `${job.jobName}:schedule:${job.schedule?.mode ?? "manual"}:${job.scheduleWindow?.id ?? "window-unbound"}`,
        jobName: job.jobName,
      }),
      mailchimpCampaignControlPlaneRow(`job:${job.jobName}:audience`, {
        kind: "audienceBinding",
        status: job.audience?.bound ? "ready" : "blocked",
        label: `${job.jobName} audience binding`,
        detail: job.audience?.detail ?? "Mailchimp audience binding is required before handoff.",
        handoff: "mailchimp-provider-contract",
        route: "mailchimp/control-plane/audience",
        exportAllowed: job.audience?.bound === true,
        restartSafe: job.audience?.bound === true,
        nextAction: job.audience?.nextAction ?? "bind-mailchimp-audience",
        idempotencyKey: `${job.jobName}:audience:${job.audience?.id ?? "unbound"}`,
        jobName: job.jobName,
      }),
    ]);
}

function createMailchimpCampaignControlCommandRows(rows = []) {
  return rows.map((row) => mailchimpCampaignControlPlaneRow(`command:${row.jobName}:${row.commandId}`, {
    kind: "lifecycleCommand",
    status: row.status,
    label: row.label,
    detail: row.detail,
    handoff: "mailchimp-lifecycle-command-queue",
    route: row.status === "blocked"
      ? "mailchimp/lifecycle-commands/recovery"
      : row.status === "pending"
        ? "mailchimp/lifecycle-commands/queue"
        : "mailchimp/lifecycle-commands/summary",
    exportAllowed: row.status !== "blocked" && row.status !== "pending",
    restartSafe: row.status !== "blocked",
    nextAction: row.nextAction,
    idempotencyKey: row.idempotencyKey,
    jobName: row.jobName,
    commandId: row.commandId,
  }));
}

function mailchimpCampaignControlPlaneRow(id, row = {}) {
  const status = normalizeMailchimpCampaignControlStatus(row.status);
  const exportAllowed = row.exportAllowed ?? (status === "ready" || status === "idle");
  const restartSafe = row.restartSafe ?? status !== "blocked";

  return Object.freeze({
    id,
    kind: row.kind ?? "control",
    status: exportAllowed === false && status === "ready" ? "blocked" : status,
    label: row.label ?? id,
    detail: row.detail ?? `${row.label ?? id} is ${status}.`,
    jobName: row.jobName ?? null,
    commandId: row.commandId ?? null,
    handoff: row.handoff ?? "mailchimp-control-plane",
    route: row.route ?? "mailchimp/control-plane",
    exportAllowed: exportAllowed !== false,
    restartSafe: restartSafe !== false,
    nextAction: row.nextAction ?? selectMailchimpCampaignControlNextAction(id, status),
    idempotencyKey: row.idempotencyKey ?? `${id}:${status}`,
  });
}

function normalizeMailchimpCampaignControlStatus(status) {
  if (status === "ready" || status === "idle") return status;
  if (status === "pending" || status === "needsAcceptance" || status === "queued") return "pending";
  if (status === "blocked" || status === "disabled" || status === "failed" || status === "required") return "blocked";
  if (status === "review" || status === "degraded" || status === "changed") return "review";
  return status ? "review" : "ready";
}

function selectMailchimpCampaignControlNextAction(id, status) {
  if (status === "blocked") return `repair-mailchimp-control:${id}`;
  if (status === "pending") return `accept-mailchimp-control:${id}`;
  if (status === "review") return `review-mailchimp-control:${id}`;
  if (status === "idle") return `skip-mailchimp-control:${id}`;
  return `publish-mailchimp-control:${id}`;
}

function compareMailchimpCampaignControlPlaneRows(left, right) {
  return mailchimpCampaignControlStatusOrder(left.status) - mailchimpCampaignControlStatusOrder(right.status)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function mailchimpCampaignControlStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    ready: 3,
    idle: 4,
  }[status] ?? 5;
}

function countMailchimpCampaignControlRows(rows = [], field) {
  const counters = {};
  for (const row of rows) incrementCounter(counters, row[field] ?? "unknown");
  return counters;
}

function compareMailchimpPersistedCommandRows(left, right) {
  return mailchimpPersistedCommandStatusOrder(left.status) - mailchimpPersistedCommandStatusOrder(right.status)
    || String(left.jobName ?? "").localeCompare(String(right.jobName ?? ""))
    || left.commandId.localeCompare(right.commandId)
    || left.id.localeCompare(right.id);
}

function mailchimpPersistedCommandStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    review: 2,
    ready: 3,
    idle: 4,
  }[status] ?? 5;
}

function countMailchimpPersistedCommandRows(rows = [], field) {
  const counters = {};
  for (const row of rows) incrementCounter(counters, row[field] ?? "unknown");
  return counters;
}

function compareMailchimpHandoffReadinessLanes(left, right) {
  return mailchimpHandoffReadinessStatusOrder(left.status) - mailchimpHandoffReadinessStatusOrder(right.status)
    || left.id.localeCompare(right.id);
}

function mailchimpHandoffReadinessStatusOrder(status) {
  return {
    blocked: 0,
    pending: 1,
    needsAcceptance: 1,
    review: 2,
    degraded: 2,
    ready: 3,
    idle: 4,
  }[status] ?? 5;
}

function countMailchimpHandoffReadinessLanes(lanes = [], field) {
  const counters = {};
  for (const lane of lanes) incrementCounter(counters, lane[field] ?? "unknown");
  return counters;
}

function createMailchimpHandoffReadinessDetail(status, blocked, pending, review, pendingAcceptance, lanes) {
  if (status === "idle") return "No Mailchimp workflow handoff lanes were detected.";
  if (status === "blocked") return `${blocked.length} Mailchimp handoff readiness lane(s) block campaign release.`;
  if (status === "pending") return `${pending.length} Mailchimp handoff readiness lane(s) need runtime action.`;
  if (status === "review") return `${review.length} Mailchimp handoff readiness lane(s) need review.`;
  if (status === "needsAcceptance") return `${pendingAcceptance.length} Mailchimp handoff readiness lane(s) need acceptance.`;
  return `${lanes.length} Mailchimp handoff readiness lane(s) are ready for campaign release.`;
}

function createMailchimpHandoffReadinessNextSteps(status, lanes, pendingAcceptance) {
  if (status === "idle") {
    return [Object.freeze({
      id: "skip-mailchimp-workflow-handoff",
      status: "ready",
      label: "Continue without Mailchimp handoff",
      detail: "No Mailchimp handoff lanes were produced for this source.",
      nextAction: "skip-mailchimp-workflow-handoff",
    })];
  }

  const actionable = lanes.filter((lane) => lane.status !== "ready" && lane.status !== "idle");
  if (actionable.length) {
    return actionable.map((lane) => Object.freeze({
      id: `mailchimp-handoff:${lane.id}`,
      status: lane.status,
      label: lane.label,
      detail: lane.detail,
      route: lane.route,
      nextAction: lane.nextAction,
    }));
  }

  if (pendingAcceptance.length) {
    return pendingAcceptance.map((lane) => Object.freeze({
      id: `mailchimp-handoff-accept:${lane.id}`,
      status: "needsAcceptance",
      label: lane.label,
      detail: lane.detail,
      route: lane.route,
      nextAction: `accept-mailchimp-handoff-readiness:${lane.id}`,
    }));
  }

  return lanes.map((lane) => Object.freeze({
    id: `mailchimp-handoff-publish:${lane.id}`,
    status: "ready",
    label: lane.label,
    detail: lane.detail,
    route: lane.route,
    nextAction: lane.nextAction,
  }));
}
