import { buildCommentContractIndex } from "../source/comment-syntax.mjs";
import { collectLiteralContracts } from "../source/literal-syntax.mjs";
import { buildAiosRecoveryStatus, mergeRecoveryDiagnostics } from "../source/error-recovery.mjs";
import { parse } from "../source/parser.mjs";

function compact(value) {
  return String(value ?? "").trim();
}

function symbolId(kind, name, scope = "global") {
  return `${compact(scope) || "global"}:${compact(kind) || "unknown"}:${compact(name) || "anonymous"}`;
}

function freezeSymbol(symbol) {
  return Object.freeze({
    schema: "aios.symbol.v1",
    id: symbolId(symbol.kind, symbol.name, symbol.scope),
    kind: compact(symbol.kind || "unknown"),
    name: compact(symbol.name || "anonymous"),
    scope: compact(symbol.scope || "global"),
    source: compact(symbol.source || "ast"),
    role: compact(symbol.role || symbol.kind || "unknown"),
    range: symbol.range ?? null,
    contract: symbol.contract ?? null,
  });
}

function literalEntriesFromClause(clause) {
  if (!clause || typeof clause !== "object") return [];
  switch (clause.type) {
    case "WorkspaceClause":
      return [{ key: "workspace", value: clause.workspace }];
    case "TenantClause":
      return [{ key: "tenant", value: clause.tenant }];
    case "RoleClause":
      return [{ key: "role", value: clause.role }];
    case "CapabilityClause":
      return [{ key: "capability", value: clause.name }, { key: "scope", value: clause.scope }];
    case "MemoryClause":
      return [{ key: "memory", value: clause.name }, { key: "alias", value: clause.alias }];
    case "VerifyClause":
      return [{ key: "truth", value: clause.boundary }, { key: "minConfidence", value: clause.minConfidence }];
    case "HandoffClause":
      return [{ key: "adapter", value: clause.adapter }];
    case "StatusClause":
      return [{ key: "status", value: clause.channel }];
    case "RecoverClause":
      return [{ key: "checkpoint", value: clause.checkpoint }];
    case "IdempotencyClause":
      return [{ key: "idempotency", value: clause.key }];
    default:
      return [];
  }
}

function symbolsFromJob(job) {
  const symbols = [freezeSymbol({
    kind: "job",
    name: job.name,
    scope: "global",
    source: "ast",
    role: "kernel-job",
    range: job.location ? { start: job.location, end: job.location } : null,
  })];

  for (const clause of job.clauses ?? []) {
    if (clause.type === "CapabilityClause") {
      symbols.push(freezeSymbol({ kind: "capability", name: clause.name, scope: job.name, role: "capability-contract" }));
    }
    if (clause.type === "MemoryClause") {
      symbols.push(freezeSymbol({ kind: "memory", name: clause.alias || clause.name, scope: job.name, role: "memory-mount" }));
    }
    if (clause.type === "VerifyClause") {
      symbols.push(freezeSymbol({ kind: "verifier", name: clause.boundary, scope: job.name, role: "truth-boundary" }));
    }
    if (clause.type === "HandoffClause") {
      symbols.push(freezeSymbol({ kind: "adapter", name: clause.adapter, scope: job.name, role: "adapter-handoff" }));
    }
    if (clause.type === "StatusClause") {
      symbols.push(freezeSymbol({ kind: "status", name: clause.channel, scope: job.name, role: "status-handoff" }));
    }
  }

  return symbols;
}

function commentSymbols(commentIndex) {
  return Object.entries(commentIndex.byField ?? {}).flatMap(([field, directives]) => directives.map((directive, index) => freezeSymbol({
    kind: "comment-directive",
    name: `${field}:${directive.value || index}`,
    scope: "source-comments",
    source: "comment",
    role: directive.contractRole,
    range: directive.range,
    contract: directive,
  })));
}

function duplicateDiagnostics(symbols) {
  const seen = new Map();
  const diagnostics = [];
  for (const symbol of symbols) {
    if (seen.has(symbol.id)) {
      diagnostics.push(Object.freeze({
        code: "AIOS_SYMBOL_DUPLICATE",
        severity: "error",
        message: `Duplicate AI OS symbol "${symbol.name}" in scope "${symbol.scope}".`,
        line: symbol.range?.start?.line ?? 1,
        column: symbol.range?.start?.column ?? 1,
        offset: symbol.range?.start?.offset ?? 0,
        recovery: "rename_symbol",
      }));
    }
    seen.set(symbol.id, symbol);
  }
  return diagnostics;
}

function buildLiteralContractSet(program) {
  const entries = [];
  for (const job of program.body ?? []) {
    for (const clause of job.clauses ?? []) {
      for (const entry of literalEntriesFromClause(clause)) {
        if (entry.value !== undefined && entry.value !== null) {
          entries.push({ key: `${job.name}.${entry.key}`, value: entry.value });
        }
      }
    }
  }
  return collectLiteralContracts(entries);
}

function buildSymbolPreview(symbols, literalContracts, comments) {
  const previewRows = symbols.map((symbol) => Object.freeze({
    id: symbol.id,
    label: `${symbol.kind}:${symbol.name}`,
    scope: symbol.scope,
    role: symbol.role,
    source: symbol.source,
    selectable: symbol.kind !== "comment-directive" || Boolean(symbol.contract?.value),
  }));
  const commentLifecycle = comments.lifecycle ?? {};
  const commentRuntime = comments.runtimeState ?? {};
  const commentAnalytics = comments.analytics ?? {};
  const commentExportSummary = comments.exportSummary ?? {};
  const commentExportPackage = comments.exportPackage ?? {};
  const literalWorkflow = literalContracts.workflowControls ?? {};
  const providerContract = comments.providerContract ?? {};
  const literalProviders = literalContracts.providerContracts ?? {};
  const literalRuntime = literalContracts.runtimeState ?? {};
  const literalHealth = literalContracts.operationalHealth ?? {};
  const literalBoundary = literalContracts.boundaryContract ?? {};
  const literalExportPackage = literalContracts.exportPackage ?? {};
  const literalReleaseReport = literalContracts.releaseReport ?? {};
  return Object.freeze({
    schema: "aios.symbol-table.preview.v1",
    title: "AI OS Mailchimp contract preview",
    rows: Object.freeze(previewRows),
    counts: Object.freeze({
      symbols: symbols.length,
      kernelJobs: symbols.filter((symbol) => symbol.role === "kernel-job").length,
      exportableLiterals: literalContracts.exportSummary?.exportableKeys?.length ?? 0,
      commentControls: commentLifecycle.controls?.length ?? 0,
      commentRuntimeCommands: commentRuntime.commandSummary?.total ?? 0,
      commentRuntimeBlocked: commentRuntime.commandSummary?.blocked ?? 0,
      commentExports: commentExportSummary.exportableFields?.length ?? 0,
      commentPublishableExports: commentExportPackage.counters?.publishable ?? 0,
      commentBlockedExportPackageRows: commentExportPackage.counters?.blocked ?? 0,
      commentHistoryEvents: comments.history?.timeline?.length ?? 0,
      commentAnalyticsWarnings: commentAnalytics.counters?.warnings ?? 0,
      literalPublishableExports: literalExportPackage.counters?.publishable ?? 0,
      literalBlockedExportPackageRows: literalExportPackage.counters?.blocked ?? 0,
      literalReleaseReadyRows: literalReleaseReport.counters?.releaseReady ?? 0,
      literalReleaseBlockedRows: literalReleaseReport.counters?.blocked ?? 0,
      literalControls: literalWorkflow.controls?.length ?? 0,
      literalRuntimeCommands: literalRuntime.commandSummary?.total ?? 0,
      literalRuntimeBlocked: literalRuntime.commandSummary?.blocked ?? 0,
      literalHealthFailures: literalHealth.failureCount ?? 0,
      literalHealthDegraded: literalHealth.degradedCount ?? 0,
      boundaryWorkspaces: literalBoundary.workspaces?.length ?? 0,
      boundaryTenants: literalBoundary.tenants?.length ?? 0,
      boundaryRoles: literalBoundary.roles?.length ?? 0,
      boundaryAuditEvents: literalBoundary.auditTrail?.length ?? 0,
      providerDirectives: providerContract.directives?.length ?? 0,
      literalProviders: literalProviders.providers?.length ?? 0,
      negotiatedCapabilities: literalProviders.requestedCapabilities?.length ?? 0,
      adoptionSignatures: [
        comments.adoptionSignature,
        literalContracts.adoptionSignature,
      ].filter(Boolean).length,
    }),
    timeline: Object.freeze([
      ...(literalContracts.history?.timeline ?? []).map((event) => Object.freeze({
        source: "literal",
        label: event.key,
        state: event.state,
        nextAction: event.nextAction,
      })),
      ...(commentLifecycle.schedules ?? []).map((schedule) => Object.freeze({
        source: "comment",
        label: schedule.value,
        state: schedule.parsed.valid ? "scheduled" : "blocked",
        nextAction: schedule.parsed.valid ? "schedule_comment_contracts" : "repair_comment_schedule",
      })),
      ...(comments.history?.timeline ?? []).map((event) => Object.freeze({
        source: "comment-history",
        label: `${event.field}:${event.value}`,
        state: event.state,
        nextAction: event.nextAction,
      })),
      ...(commentExportPackage.manifest ?? []).map((row) => Object.freeze({
        source: "comment-export-package",
        label: `${row.field}:${row.value}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalExportPackage.manifest ?? []).map((row) => Object.freeze({
        source: "literal-export-package",
        label: `${row.role}:${row.key}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalReleaseReport.history?.timeline ?? []).map((event) => Object.freeze({
        source: "literal-release-report",
        label: event.key,
        state: event.state,
        nextAction: event.nextAction,
      })),
      ...(commentRuntime.commands ?? []).map((command) => Object.freeze({
        source: "comment-runtime",
        label: `${command.field}:${command.value}`,
        state: command.state === "ready" ? "queued" : command.state,
        nextAction: command.nextAction,
      })),
      ...(literalWorkflow.schedules ?? []).map((schedule) => Object.freeze({
        source: "literal-workflow",
        label: `${schedule.key}:${schedule.value}`,
        state: schedule.parsed.valid ? "scheduled" : "blocked",
        nextAction: schedule.parsed.valid ? "schedule_literal_workflow" : "repair_literal_schedule",
      })),
      ...(literalRuntime.commands ?? []).map((command) => Object.freeze({
        source: "literal-runtime",
        label: `${command.type}:${command.key}`,
        state: command.state === "ready" ? "queued" : command.state,
        nextAction: command.nextAction,
      })),
      ...(providerContract.directives ?? []).map((entry) => Object.freeze({
        source: "comment-provider",
        label: `${entry.directive.field}:${entry.directive.value}`,
        state: entry.parsed.valid ? "handoff-ready" : "blocked",
        nextAction: entry.parsed.valid ? providerContract.handoff?.nextAction ?? "handoff_comment_provider_status" : "repair_comment_provider_contract",
      })),
      ...(literalProviders.providers ?? []).map((provider) => Object.freeze({
        source: "literal-provider",
        label: `${provider.sourceKey}:${provider.adapter}`,
        state: provider.handoff.ready ? "handoff-ready" : "blocked",
        nextAction: provider.handoff.nextAction,
      })),
      ...((literalHealth.failures ?? []).map((failure) => Object.freeze({
        source: "literal-health",
        label: `${failure.code}:${failure.key}`,
        state: "failed",
        nextAction: failure.action,
      }))),
      ...((literalHealth.degraded ?? []).map((event) => Object.freeze({
        source: "literal-health",
        label: `${event.code}:${event.key}`,
        state: "degraded",
        nextAction: event.action,
      }))),
      ...(literalBoundary.auditTrail ?? []).map((event) => Object.freeze({
        source: "literal-boundary",
        label: `${event.type}:${event.subject}`,
        state: event.state,
        nextAction: event.nextAction,
      })),
    ]),
  });
}

function buildAcceptanceContract(symbols, literalContracts, comments, recoveryStatus, reconciliation = null) {
  const exportsReady = recoveryStatus.exportReady && (literalContracts.exportSummary?.blockedKeys?.length ?? 0) === 0;
  const hasKernelJob = symbols.some((symbol) => symbol.role === "kernel-job");
  const hasCapability = symbols.some((symbol) => symbol.kind === "capability")
    || Boolean(comments.byField?.capability?.length)
    || (literalContracts.workflowControls?.mailchimpScopes?.length ?? 0) > 0;
  const lifecycleValid = comments.lifecycle?.valid !== false;
  const commentRuntimeEmpty = (comments.runtimeState?.commandSummary?.total ?? 0) === 0;
  const commentRuntimeReady = commentRuntimeEmpty || (
    comments.runtimeState?.clientHandoff?.ready !== false
    && comments.runtimeState?.persistedView?.restartSafe !== false
  );
  const literalRuntimeEmpty = (literalContracts.runtimeState?.commandSummary?.total ?? 0) === 0;
  const literalRuntimeReady = literalRuntimeEmpty || (
    literalContracts.runtimeState?.clientHandoff?.ready !== false
    && literalContracts.runtimeState?.persistedView?.restartSafe !== false
  );
  const literalHealthReady = literalContracts.operationalHealth?.handoffReady !== false
    && literalContracts.operationalHealth?.state !== "failed";
  const commentExportsReady = comments.exportSummary?.exportReady !== false;
  const commentExportPackageReady = comments.exportPackage?.handoff?.ready !== false;
  const literalExportPackageReady = literalContracts.exportPackage?.handoff?.ready !== false;
  const literalReleaseReportReady = literalContracts.releaseReport?.handoff?.ready !== false;
  const literalWorkflowValid = literalContracts.workflowControls?.valid !== false;
  const providerReady = comments.providerContract?.handoff?.ready !== false
    && literalContracts.providerContracts?.handoff?.ready !== false;
  const boundaryReady = literalContracts.boundaryContract?.handoff?.ready !== false;
  const surfaceReconciliationReady = reconciliation?.handoff?.ready !== false;
  const tenantReady = literalContracts.boundaryContract?.handoff?.tenant
    || literalContracts.providerContracts?.sync?.externalWriteRequested !== true;
  const blockers = [
    ...(!hasKernelJob ? ["missing_kernel_job"] : []),
    ...(!hasCapability ? ["missing_capability_contract"] : []),
    ...(!exportsReady ? ["exports_not_ready"] : []),
    ...(!lifecycleValid ? ["comment_lifecycle_invalid"] : []),
    ...(!commentRuntimeReady ? ["comment_runtime_not_restart_safe"] : []),
    ...(!literalRuntimeReady ? ["literal_runtime_not_restart_safe"] : []),
    ...(!commentExportsReady ? ["comment_exports_not_ready"] : []),
    ...(!commentExportPackageReady ? ["comment_export_package_not_ready"] : []),
    ...(!literalExportPackageReady ? ["literal_export_package_not_ready"] : []),
    ...(!literalReleaseReportReady ? ["literal_release_report_not_ready"] : []),
    ...(!literalHealthReady ? ["literal_health_failed"] : []),
    ...(!literalWorkflowValid ? ["literal_workflow_invalid"] : []),
    ...(!providerReady ? ["provider_handoff_invalid"] : []),
    ...(!boundaryReady ? ["boundary_handoff_invalid"] : []),
    ...(!surfaceReconciliationReady ? ["mailchimp_surface_reconciliation_invalid"] : []),
    ...(!tenantReady ? ["tenant_boundary_missing"] : []),
  ];
  const warnings = [
    ...recoveryStatus.recovery.items
    .filter((item) => item.severity === "warning")
      .map((item) => item.code),
    ...(reconciliation?.issues ?? [])
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.code),
  ];
  const nextAction = acceptanceNextAction(blockers[0], literalContracts, comments, recoveryStatus);
  return Object.freeze({
    schema: "aios.symbol-table.acceptance.v1",
    accepted: blockers.length === 0,
    readiness: blockers.length === 0 ? "ready" : recoveryStatus.state === "recovering" ? "recovering" : "blocked",
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    gates: Object.freeze({
      hasKernelJob,
      hasCapability,
      exportsReady,
      lifecycleValid,
      commentRuntimeReady,
      literalRuntimeReady,
      commentExportsReady,
      commentExportPackageReady,
      literalExportPackageReady,
      literalReleaseReportReady,
      literalHealthReady,
      literalWorkflowValid,
      providerReady,
      boundaryReady,
      surfaceReconciliationReady,
      tenantReady: Boolean(tenantReady),
      recoveryRestartSafe: recoveryStatus.restartSafe,
      providerHandoffReady: recoveryStatus.providerContract?.sync?.statusHandoffReady === true,
      literalProviderHandoffReady: literalContracts.providerContracts?.handoff?.ready !== false,
      boundaryHandoffReady: literalContracts.boundaryContract?.handoff?.ready !== false,
    }),
    nextAction,
  });
}

function acceptanceNextAction(blocker, literalContracts, comments, recoveryStatus) {
  if (blocker === "missing_kernel_job") return "add_kernel_job";
  if (blocker === "missing_capability_contract") return "add_mailchimp_capability";
  if (blocker === "exports_not_ready") return recoveryStatus.nextAction;
  if (blocker === "comment_lifecycle_invalid") return comments.lifecycle?.nextAction ?? "repair_comment_lifecycle";
  if (blocker === "comment_runtime_not_restart_safe") return comments.runtimeState?.resume?.nextAction ?? "repair_comment_runtime_state";
  if (blocker === "literal_runtime_not_restart_safe") return literalContracts.runtimeState?.resume?.nextAction ?? "repair_literal_runtime_state";
  if (blocker === "comment_exports_not_ready") return comments.exportSummary?.nextAction ?? "repair_comment_exports";
  if (blocker === "comment_export_package_not_ready") return comments.exportPackage?.handoff?.nextAction ?? "publish_comment_export_package";
  if (blocker === "literal_export_package_not_ready") return literalContracts.exportPackage?.handoff?.nextAction ?? "publish_literal_export_package";
  if (blocker === "literal_release_report_not_ready") return literalContracts.releaseReport?.handoff?.nextAction ?? "publish_literal_release_report";
  if (blocker === "literal_health_failed") return literalContracts.operationalHealth?.statusPatch?.nextAction ?? "repair_literal_operational_health";
  if (blocker === "literal_workflow_invalid") return literalContracts.workflowControls?.nextAction ?? "repair_literal_workflow";
  if (blocker === "provider_handoff_invalid") {
    return literalContracts.providerContracts?.handoff?.ready === false
      ? literalContracts.providerContracts?.handoff?.nextAction ?? "repair_literal_provider_contract"
      : comments.providerContract?.handoff?.nextAction ?? "repair_comment_provider_contract";
  }
  if (blocker === "boundary_handoff_invalid") return literalContracts.boundaryContract?.handoff?.nextAction ?? "repair_boundary_scope";
  if (blocker === "mailchimp_surface_reconciliation_invalid") return "reconcile_mailchimp_contract_surfaces";
  if (blocker === "tenant_boundary_missing") return "bind_tenant_boundary";
  return "accept_symbol_contracts";
}

function buildValidationSummary(diagnostics, recoveryStatus, acceptance) {
  const bySeverity = diagnostics.reduce((groups, diagnostic) => {
    groups[diagnostic.severity] = (groups[diagnostic.severity] ?? 0) + 1;
    return groups;
  }, {});
  const persistence = recoveryStatus.persistence ?? {};
  return Object.freeze({
    schema: "aios.symbol-table.validation-summary.v1",
    state: acceptance.readiness,
    diagnosticCount: diagnostics.length,
    bySeverity: Object.freeze(Object.fromEntries(Object.entries(bySeverity).sort())),
    firstRecovery: recoveryStatus.recovery.items[0] ?? null,
    restartSafe: recoveryStatus.restartSafe,
    persistedRecovery: Object.freeze({
      replayState: persistence.replayState ?? "unknown",
      commandCount: persistence.commandSummary?.total ?? 0,
      resumeAvailable: recoveryStatus.resume?.available === true,
      resumeToken: persistence.ledger?.resumeToken ?? "",
    }),
    nextAction: acceptance.nextAction,
  });
}

function buildExplainableNextSteps(preview, acceptance, recoveryStatus) {
  const steps = [];
  if (!acceptance.gates.hasKernelJob) {
    steps.push({ action: "add_kernel_job", reason: "A kernel job anchors Mailchimp contracts to an executable unit." });
  }
  if (!acceptance.gates.hasCapability) {
    steps.push({ action: "add_mailchimp_capability", reason: "A capability declares the Mailchimp operation this source can request." });
  }
  if (!acceptance.gates.exportsReady) {
    steps.push({ action: recoveryStatus.nextAction, reason: "Literal or recovery exports still need repair before handoff." });
  }
  if (!acceptance.gates.lifecycleValid) {
    steps.push({ action: "repair_comment_lifecycle", reason: "Comment lifecycle controls must validate before scheduling or enablement." });
  }
  if (!acceptance.gates.commentRuntimeReady) {
    steps.push({ action: "repair_comment_runtime_state", reason: "Comment directives need restart-safe persisted commands before client adoption." });
  }
  if (!acceptance.gates.literalRuntimeReady) {
    steps.push({ action: "repair_literal_runtime_state", reason: "Literal provider and workflow controls need restart-safe replay commands before client adoption." });
  }
  if (!acceptance.gates.commentExportsReady) {
    steps.push({ action: "repair_comment_exports", reason: "Comment directives need export-ready summaries before kernel contract handoff." });
  }
  if (!acceptance.gates.commentExportPackageReady) {
    steps.push({ action: exportPackageNextAction(preview, "comment"), reason: "Comment export package rows must be publishable before client adoption." });
  }
  if (!acceptance.gates.literalExportPackageReady) {
    steps.push({ action: exportPackageNextAction(preview, "literal"), reason: "Literal export package rows must be publishable before Mailchimp runtime adoption." });
  }
  if (!acceptance.gates.literalReleaseReportReady) {
    steps.push({ action: literalReleaseNextAction(preview), reason: "Literal release rows must be report-ready before client export summaries can be accepted." });
  }
  if (!acceptance.gates.literalHealthReady) {
    steps.push({ action: "repair_literal_operational_health", reason: "Literal operational health must be non-failed before Mailchimp runtime adoption." });
  }
  if (!acceptance.gates.literalWorkflowValid) {
    steps.push({ action: "repair_literal_workflow", reason: "Literal workflow controls must validate before client scheduling can adopt them." });
  }
  if (!acceptance.gates.providerReady) {
    steps.push({ action: "repair_comment_provider_contract", reason: "Provider comments must identify a Mailchimp handoff target before external status can be advertised." });
  }
  if (!acceptance.gates.boundaryReady) {
    steps.push({ action: "repair_boundary_scope", reason: "Workspace, role, and permission boundaries must be safe before Mailchimp handoff." });
  }
  if (!acceptance.gates.surfaceReconciliationReady) {
    steps.push({ action: "reconcile_mailchimp_contract_surfaces", reason: "Comment and literal Mailchimp contract surfaces must agree before runtime adoption." });
  }
  if (!acceptance.gates.tenantReady) {
    steps.push({ action: "bind_tenant_boundary", reason: "External Mailchimp sync requires a tenant boundary for audit handoff." });
  }
  if (steps.length === 0) {
    steps.push({ action: "accept_symbol_contracts", reason: `${preview.counts.symbols} symbols are ready for client preview and adapter handoff.` });
  }
  return Object.freeze({
    schema: "aios.symbol-table.next-steps.v1",
    primary: steps[0].action,
    steps: Object.freeze(steps.map((step, index) => Object.freeze({ order: index + 1, ...step }))),
  });
}

function exportPackageNextAction(preview, sourceKind) {
  const source = sourceKind === "literal" ? "literal-export-package" : "comment-export-package";
  return preview.timeline.find((event) => event.source === source && event.state !== "publishable")?.nextAction
    ?? (sourceKind === "literal" ? "publish_literal_export_package" : "publish_comment_export_package");
}

function literalReleaseNextAction(preview) {
  return preview.timeline.find((event) => event.source === "literal-release-report" && event.state !== "release-ready")?.nextAction
    ?? "publish_literal_release_report";
}

function buildMailchimpRuntimeAdoption(symbols, literalContracts, comments, acceptance, recoveryStatus, reconciliation = null) {
  const provider = comments.providerContract ?? {};
  const literalProviders = literalContracts.providerContracts ?? {};
  const literalWorkflow = literalContracts.workflowControls ?? {};
  const literalRuntime = literalContracts.runtimeState ?? {};
  const literalBoundary = literalContracts.boundaryContract ?? {};
  const literalHealth = literalContracts.operationalHealth ?? {};
  const literalExportPackage = literalContracts.exportPackage ?? {};
  const literalReleaseReport = literalContracts.releaseReport ?? {};
  const commentExportPackage = comments.exportPackage ?? {};
  const commentSignature = comments.adoptionSignature ?? {};
  const literalSignature = literalContracts.adoptionSignature ?? {};
  const commentLifecycle = comments.lifecycle ?? {};
  const commentRuntime = comments.runtimeState ?? {};
  const astCapabilities = symbols.filter((symbol) => symbol.kind === "capability").map((symbol) => symbol.name);
  const commentCapabilities = (comments.byField?.capability ?? []).map((directive) => directive.value);
  const literalCapabilities = literalWorkflow.mailchimpScopes ?? [];
  const capabilities = Object.freeze(Array.from(new Set([
    ...astCapabilities,
    ...commentCapabilities,
    ...literalCapabilities,
    ...(provider.requestedCapabilities ?? []),
    ...(literalProviders.requestedCapabilities ?? []),
  ].filter(Boolean))).sort());
  const disabled = new Set([
    ...(commentLifecycle.disabled ?? []),
    ...(literalWorkflow.disabled ?? []),
  ]);
  const enabled = Object.freeze(Array.from(new Set([
    ...(commentLifecycle.enabled ?? []),
    ...(literalWorkflow.enabled ?? []),
  ].filter((item) => !disabled.has(item)))).sort());
  const schedules = Object.freeze([
    ...(commentLifecycle.schedules ?? []).map((schedule) => Object.freeze({
      source: "comment",
      value: schedule.value,
      mode: schedule.parsed.mode,
      cadence: schedule.parsed.cadence,
      valid: schedule.parsed.valid,
    })),
    ...(literalWorkflow.schedules ?? []).map((schedule) => Object.freeze({
      source: "literal",
      key: schedule.key,
      value: schedule.value,
      mode: schedule.parsed.mode,
      cadence: schedule.parsed.cadence,
      valid: schedule.parsed.valid,
    })),
  ]);
  const settings = Object.freeze(Object.fromEntries(Object.entries({
    ...(commentLifecycle.settings ?? {}),
    ...(literalWorkflow.settings ?? {}),
  }).sort(([left], [right]) => left.localeCompare(right))));
  const boundaryAuditReady = literalBoundary.handoff?.ready !== false;
  const boundaryScope = Object.freeze({
    workspace: literalBoundary.handoff?.workspace ?? "global",
    tenant: literalBoundary.handoff?.tenant ?? "",
    role: literalBoundary.handoff?.role ?? "",
    workspaces: Object.freeze((literalBoundary.workspaces ?? []).map((item) => item.value).sort()),
    tenants: Object.freeze((literalBoundary.tenants ?? []).map((item) => item.value).sort()),
    roles: Object.freeze((literalBoundary.roles ?? []).map((item) => item.value).sort()),
    deniedCapabilities: Object.freeze(literalBoundary.permissionState?.denied ?? []),
    auditEvents: literalBoundary.auditTrail?.length ?? 0,
    nextAction: literalBoundary.handoff?.nextAction ?? "handoff_boundary_audit",
  });
  const readyForClient = acceptance.accepted
    && recoveryStatus.restartSafe
    && schedules.every((schedule) => schedule.valid)
    && commentRuntime.persistedView?.restartSafe !== false
    && literalRuntime.persistedView?.restartSafe !== false
    && comments.exportSummary?.exportReady !== false
    && commentExportPackage.handoff?.ready !== false
    && literalExportPackage.handoff?.ready !== false
    && literalReleaseReport.handoff?.ready !== false
    && literalHealth.handoffReady !== false
    && literalHealth.state !== "failed"
    && provider.handoff?.ready !== false
    && literalProviders.handoff?.ready !== false
    && boundaryAuditReady
    && reconciliation?.handoff?.ready !== false;
  const checkpointCandidates = [
    commentRuntime.checkpoint,
    literalRuntime.checkpoint,
    ...(literalProviders.sync?.checkpoints ?? []),
    provider.sync?.checkpoint,
    recoveryStatus.handoff?.checkpoint,
  ].filter(Boolean);
  const statusChannels = Array.from(new Set([
    commentRuntime.statusChannel,
    literalRuntime.statusChannel,
    ...(literalProviders.sync?.statusChannels ?? []),
    provider.statusChannel,
    recoveryStatus.handoff?.statusChannel,
    "mailchimp.contract.status",
  ].filter(Boolean))).sort();
  const commentCommandIds = Object.freeze((commentRuntime.commands ?? []).map((command) => command.id).filter(Boolean).sort());
  const literalCommandIds = Object.freeze((literalRuntime.commands ?? []).map((command) => command.id).filter(Boolean).sort());
  const idempotencyCommands = Object.freeze(Array.from(new Set([
    ...(literalProviders.idempotencyCommands ?? []),
    ...(commentRuntime.persistedView?.idempotencyKeys ?? []),
    ...(literalRuntime.persistedView?.idempotencyKeys ?? []),
  ])).sort());

  return Object.freeze({
    schema: "aios.symbol-table.mailchimp-runtime-adoption.v1",
    requestState: Object.freeze({
      service: provider.service || literalProviders.service || "mailchimp",
      adapter: provider.adapter || literalProviders.adapter || "mailchimp",
      statusChannel: statusChannels[0],
      capabilities,
      enabled,
      disabled: Object.freeze(Array.from(disabled).sort()),
      settings,
      schedules,
      commentCommandIds,
      literalCommandIds,
      idempotencyCommands,
      boundaryScope,
      commentExportSummary: comments.exportSummary ?? null,
      commentExportPackage: commentExportPackage.status ?? null,
      literalExportPackage: literalExportPackage.status ?? null,
      literalReleaseReport: literalReleaseReport.exportSummary ?? null,
      literalHealth: literalHealth.statusPatch ?? null,
      adoptionSurfaces: Object.freeze({
        comment: commentSignature.revision ? Object.freeze({
          revision: commentSignature.revision,
          fingerprint: commentSignature.fingerprint,
          ready: commentSignature.handoff?.ready === true,
          checkpoint: commentSignature.handoff?.checkpoint ?? "",
          statusChannel: commentSignature.handoff?.statusChannel ?? "",
        }) : null,
        literal: literalSignature.revision ? Object.freeze({
          revision: literalSignature.revision,
          fingerprint: literalSignature.fingerprint,
          ready: literalSignature.handoff?.ready === true,
          checkpoint: literalSignature.handoff?.checkpoint ?? "",
          statusChannel: literalSignature.handoff?.statusChannel ?? "",
        }) : null,
      }),
    }),
    handoff: Object.freeze({
      ready: readyForClient,
      localOnly: provider.sync?.localOnly !== false && literalProviders.sync?.localOnly !== false || recoveryStatus.localOnly,
      writesExternalSystem: (provider.sync?.externalWriteAllowed === true || literalProviders.sync?.externalWriteAllowed === true) && recoveryStatus.writesExternalSystem === true,
      checkpoint: checkpointCandidates[0] || "mailchimp:local",
      statusChannel: statusChannels[0],
      statusChannels: Object.freeze(statusChannels),
      commentReplayState: commentRuntime.replayState ?? "empty",
      commentResumeAvailable: commentRuntime.resume?.available === true,
      literalReplayState: literalRuntime.replayState ?? "empty",
      literalResumeAvailable: literalRuntime.resume?.available === true,
      boundaryAuditReady,
      boundaryNextAction: boundaryScope.nextAction,
      commentExportReady: comments.exportSummary?.exportReady !== false,
      commentExportPackageReady: commentExportPackage.handoff?.ready !== false,
      literalExportPackageReady: literalExportPackage.handoff?.ready !== false,
      literalReleaseReportReady: literalReleaseReport.handoff?.ready !== false,
      literalHealthState: literalHealth.state ?? "unknown",
      literalHealthRetryable: literalHealth.retryable === true,
      surfaceReconciliationReady: reconciliation?.handoff?.ready !== false,
      surfaceReconciliationRevision: reconciliation?.revision ?? "",
    }),
    client: Object.freeze({
      previewReady: recoveryStatus.state === "ready" || recoveryStatus.state === "review",
      acceptanceRequired: !acceptance.accepted,
      userVisibleState: commentRuntime.clientHandoff?.userVisibleState
        ?? (readyForClient ? "queued" : "needs-attention"),
      nextAction: readyForClient
        ? "adopt_mailchimp_runtime_contract"
        : acceptance.nextAction || recoveryStatus.nextAction,
    }),
  });
}

function buildMailchimpNegotiation(comments, literalContracts) {
  const commentProvider = comments.providerContract ?? {};
  const literalProviders = literalContracts.providerContracts ?? {};
  const requested = Array.from(new Set([
    ...(commentProvider.requestedCapabilities ?? []),
    ...(literalProviders.requestedCapabilities ?? []),
    ...(literalContracts.workflowControls?.mailchimpScopes ?? []),
  ].filter(Boolean))).sort();
  const providerCapabilities = new Set([
    ...(commentProvider.requestedCapabilities ?? []),
    ...(literalProviders.requestedCapabilities ?? []),
  ]);
  const missingFromProvider = requested.filter((capability) => !providerCapabilities.has(capability));
  const externalWriteRequested = commentProvider.sync?.externalWriteRequested === true
    || literalProviders.sync?.externalWriteRequested === true;
  const externalWriteAllowed = commentProvider.sync?.externalWriteAllowed === true
    || literalProviders.sync?.externalWriteAllowed === true;

  return Object.freeze({
    schema: "aios.symbol-table.mailchimp-negotiation.v1",
    requestedCapabilities: Object.freeze(requested),
    missingFromProvider: Object.freeze(missingFromProvider),
    negotiated: missingFromProvider.length === 0,
    sync: Object.freeze({
      externalWriteRequested,
      externalWriteAllowed,
      localOnly: !externalWriteAllowed,
      checkpoints: Object.freeze(Array.from(new Set([
        ...(literalProviders.sync?.checkpoints ?? []),
        commentProvider.sync?.checkpoint,
      ].filter(Boolean))).sort()),
    }),
    nextAction: missingFromProvider.length > 0
      ? "declare_mailchimp_provider_capabilities"
      : externalWriteRequested && !externalWriteAllowed
        ? "confirm_mailchimp_external_sync"
        : "negotiate_mailchimp_provider_handoff",
  });
}

function signatureValue(signature, field) {
  return compact(signature?.[field]).toLowerCase();
}

function signatureSet(signature, path) {
  const value = path.reduce((current, key) => current?.[key], signature);
  return new Set(Array.from(value ?? []).map((item) => compact(item).toLowerCase()).filter(Boolean));
}

function setDifference(left, right) {
  return Object.freeze(Array.from(left).filter((item) => !right.has(item)).sort());
}

function setIntersection(left, right) {
  return Object.freeze(Array.from(left).filter((item) => right.has(item)).sort());
}

function buildSurfaceIssue(code, severity, subject, detail, action) {
  return Object.freeze({
    code,
    severity,
    subject,
    detail,
    action,
    recovery: action,
    message: detail,
    line: 1,
    column: 1,
    offset: 0,
  });
}

function buildMailchimpSurfaceReconciliation(comments, literalContracts, negotiation) {
  const comment = comments.adoptionSignature ?? null;
  const literal = literalContracts.adoptionSignature ?? null;
  const issues = [];
  const commentService = signatureValue(comment, "service");
  const literalService = signatureValue(literal, "service");
  const commentAdapter = signatureValue(comment, "adapter");
  const literalAdapter = signatureValue(literal, "adapter");
  const commentCapabilities = signatureSet(comment, ["capabilities"]);
  const literalCapabilities = signatureSet(literal, ["capabilities"]);
  const commentChannels = signatureSet(comment, ["sync", "statusChannels"]);
  const literalChannels = signatureSet(literal, ["sync", "statusChannels"]);
  const sharedChannels = setIntersection(commentChannels, literalChannels);
  const missingFromLiteral = setDifference(commentCapabilities, literalCapabilities);
  const missingFromComment = setDifference(literalCapabilities, commentCapabilities);
  const commentExternal = comment?.sync?.externalWriteAllowed === true;
  const literalExternal = literal?.sync?.externalWriteAllowed === true;
  const externalRequested = comment?.sync?.externalWriteRequested === true
    || literal?.sync?.externalWriteRequested === true
    || negotiation.sync?.externalWriteRequested === true;

  if (!comment) {
    issues.push(buildSurfaceIssue(
      "AIOS_SURFACE_COMMENT_SIGNATURE_MISSING",
      "warning",
      "comment",
      "Comment adoption signature is missing from Mailchimp contract reconciliation.",
      "attach_comment_provider",
    ));
  }
  if (!literal) {
    issues.push(buildSurfaceIssue(
      "AIOS_SURFACE_LITERAL_SIGNATURE_MISSING",
      "warning",
      "literal",
      "Literal adoption signature is missing from Mailchimp contract reconciliation.",
      "attach_literal_mailchimp_provider",
    ));
  }
  if (commentService && literalService && commentService !== literalService) {
    issues.push(buildSurfaceIssue(
      "AIOS_SURFACE_SERVICE_MISMATCH",
      "error",
      "service",
      `Comment service "${comment.service}" does not match literal service "${literal.service}".`,
      "reconcile_mailchimp_service",
    ));
  }
  if (commentAdapter && literalAdapter && commentAdapter !== literalAdapter) {
    issues.push(buildSurfaceIssue(
      "AIOS_SURFACE_ADAPTER_MISMATCH",
      "error",
      "adapter",
      `Comment adapter "${comment.adapter}" does not match literal adapter "${literal.adapter}".`,
      "reconcile_mailchimp_adapter",
    ));
  }
  if (commentChannels.size > 0 && literalChannels.size > 0 && sharedChannels.length === 0) {
    issues.push(buildSurfaceIssue(
      "AIOS_SURFACE_STATUS_CHANNEL_SPLIT",
      "warning",
      "statusChannel",
      "Comment and literal Mailchimp surfaces publish to disjoint status channels.",
      "reconcile_mailchimp_status_channel",
    ));
  }
  if (externalRequested && commentExternal !== literalExternal) {
    issues.push(buildSurfaceIssue(
      "AIOS_SURFACE_EXTERNAL_SYNC_MISMATCH",
      "error",
      "externalWrite",
      "Comment and literal Mailchimp surfaces disagree about external write handoff.",
      "reconcile_mailchimp_external_sync",
    ));
  }
  if (missingFromLiteral.length > 0) {
    issues.push(buildSurfaceIssue(
      "AIOS_SURFACE_LITERAL_CAPABILITY_GAP",
      "warning",
      "capability",
      `Literal surface is missing ${missingFromLiteral.length} comment-requested Mailchimp capabilities.`,
      "mirror_comment_capabilities_to_literals",
    ));
  }
  if (missingFromComment.length > 0) {
    issues.push(buildSurfaceIssue(
      "AIOS_SURFACE_COMMENT_CAPABILITY_GAP",
      "warning",
      "capability",
      `Comment surface is missing ${missingFromComment.length} literal-requested Mailchimp capabilities.`,
      "mirror_literal_capabilities_to_comments",
    ));
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const ready = errors.length === 0
    && comment?.handoff?.ready !== false
    && literal?.handoff?.ready !== false;

  return Object.freeze({
    schema: "aios.symbol-table.mailchimp-surface-reconciliation.v1",
    revision: stableReportRevision([
      "surface",
      comment?.revision ?? "comment:none",
      literal?.revision ?? "literal:none",
      errors.length,
      warnings.length,
    ]),
    state: errors.length > 0 ? "blocked" : warnings.length > 0 ? "review" : "ready",
    signatures: Object.freeze({ comment, literal }),
    service: comment?.service || literal?.service || "mailchimp",
    adapter: comment?.adapter || literal?.adapter || "mailchimp",
    capabilities: Object.freeze({
      comment: Object.freeze(Array.from(commentCapabilities).sort()),
      literal: Object.freeze(Array.from(literalCapabilities).sort()),
      shared: setIntersection(commentCapabilities, literalCapabilities),
      missingFromLiteral,
      missingFromComment,
    }),
    statusChannels: Object.freeze({
      comment: Object.freeze(Array.from(commentChannels).sort()),
      literal: Object.freeze(Array.from(literalChannels).sort()),
      shared: sharedChannels,
    }),
    sync: Object.freeze({
      externalWriteRequested: externalRequested,
      commentExternalWriteAllowed: commentExternal,
      literalExternalWriteAllowed: literalExternal,
      negotiatedExternalWriteAllowed: negotiation.sync?.externalWriteAllowed === true,
    }),
    issues: Object.freeze(issues),
    diagnostics: Object.freeze(issues.map((issue) => Object.freeze({
      code: issue.code,
      severity: issue.severity,
      message: issue.detail,
      line: issue.line,
      column: issue.column,
      offset: issue.offset,
      recovery: issue.recovery,
    }))),
    handoff: Object.freeze({
      ready,
      checkpoint: comment?.handoff?.checkpoint || literal?.handoff?.checkpoint || "mailchimp:surface",
      statusChannel: sharedChannels[0] || comment?.handoff?.statusChannel || literal?.handoff?.statusChannel || "mailchimp.contract.status",
      nextAction: issues[0]?.action ?? "adopt_reconciled_mailchimp_surface",
    }),
  });
}

function buildPersistedMailchimpState(tableParts) {
  const { symbols, literalContracts, comments, runtimeAdoption, recoveryStatus, acceptance, negotiation, reconciliation } = tableParts;
  const recoveryPersistence = recoveryStatus.persistence ?? {};
  const commentRuntime = comments.runtimeState ?? {};
  const commentExport = comments.exportSummary ?? {};
  const commentExportPackage = comments.exportPackage ?? {};
  const literalRuntime = literalContracts.runtimeState ?? {};
  const literalHealth = literalContracts.operationalHealth ?? {};
  const literalExportPackage = literalContracts.exportPackage ?? {};
  const literalReleaseReport = literalContracts.releaseReport ?? {};
  const literalBoundary = literalContracts.boundaryContract ?? {};
  const revisionParts = [
    symbols.length,
    literalContracts.history?.revision ?? "literal:0",
    comments.directives?.length ?? 0,
    commentRuntime.revision ?? "comment-runtime:none",
    literalRuntime.revision ?? "literal-runtime:none",
    literalReleaseReport.revision ?? "literal-release:none",
    runtimeAdoption.handoff.checkpoint,
    reconciliation?.revision ?? "surface:none",
    literalBoundary.handoff?.workspace ?? "global",
    literalBoundary.handoff?.tenant ?? "tenant:none",
    literalBoundary.handoff?.role ?? "role:none",
    recoveryStatus.state,
    recoveryPersistence.revision ?? "recovery:none",
  ];
  const providerCommands = [];
  for (const command of runtimeAdoption.requestState.idempotencyCommands ?? []) {
    providerCommands.push(Object.freeze({
      id: command,
      type: "mailchimp.provider.handoff",
      checkpoint: runtimeAdoption.handoff.checkpoint,
      statusChannel: runtimeAdoption.handoff.statusChannel,
      idempotent: true,
      restartSafe: runtimeAdoption.handoff.ready,
    }));
  }
  if (providerCommands.length === 0 && negotiation.requestedCapabilities.length > 0) {
    providerCommands.push(Object.freeze({
      id: `mailchimp:negotiate:${negotiation.requestedCapabilities.join("+")}`,
      type: "mailchimp.provider.negotiate",
      checkpoint: runtimeAdoption.handoff.checkpoint,
      statusChannel: runtimeAdoption.handoff.statusChannel,
      idempotent: true,
      restartSafe: recoveryStatus.restartSafe,
    }));
  }
  const commentCommands = Object.freeze((commentRuntime.commands ?? []).map((command) => Object.freeze({
    id: command.id,
    type: `aios.comment.${command.type}`,
    action: command.nextAction,
    field: command.field,
    value: command.value,
    checkpoint: command.checkpoint,
    statusChannel: command.statusChannel,
    idempotencyKey: command.idempotencyKey,
    idempotent: command.idempotent === true,
    restartSafe: command.restartSafe === true,
    localOnly: command.localOnly !== false,
    writesExternalSystem: command.writesExternalSystem === true,
    state: command.state,
    statusPatch: command.statusPatch,
  })));
  const literalCommands = Object.freeze((literalRuntime.commands ?? []).map((command) => Object.freeze({
    id: command.id,
    type: `aios.literal.${command.type}`,
    action: command.nextAction,
    key: command.key,
    value: command.value,
    checkpoint: command.checkpoint,
    statusChannel: command.statusChannel,
    idempotencyKey: command.idempotencyKey,
    idempotent: command.idempotent === true,
    restartSafe: command.restartSafe === true,
    localOnly: command.localOnly !== false,
    writesExternalSystem: command.writesExternalSystem === true,
    state: command.state,
    statusPatch: command.statusPatch,
  })));
  const packageCommands = Object.freeze([
    ...(commentExportPackage.manifest ?? []).filter((row) => row.state === "publishable").map((row) => Object.freeze({
      id: `comment-export:${commentExportPackage.revision}:${row.field}:${stableReportRevision([row.value])}`,
      type: "aios.comment.export-package.publish",
      action: row.nextAction,
      field: row.field,
      value: row.value,
      checkpoint: commentExportPackage.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: commentExportPackage.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      idempotencyKey: row.runtime.idempotencyKey || `comment-export:${row.field}:${stableReportRevision([row.value])}`,
      idempotent: true,
      restartSafe: row.runtime.restartSafe === true,
      localOnly: commentExportPackage.handoff?.localOnly !== false,
      writesExternalSystem: commentExportPackage.handoff?.writesExternalSystem === true,
      state: row.state,
      statusPatch: Object.freeze({
        state: "queued",
        nextAction: row.nextAction,
        message: `Comment export ${row.field} is publishable from ${commentExportPackage.revision}.`,
      }),
    })),
    ...(literalExportPackage.manifest ?? []).filter((row) => row.state === "publishable").map((row) => Object.freeze({
      id: `literal-export:${literalExportPackage.revision}:${row.role}:${stableReportRevision([row.key])}`,
      type: "aios.literal.export-package.publish",
      action: row.nextAction,
      key: row.key,
      value: row.value,
      checkpoint: literalExportPackage.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: literalExportPackage.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      idempotencyKey: `literal-export:${row.key}:${literalExportPackage.revision}`,
      idempotent: true,
      restartSafe: row.runtime.restartSafe === true,
      localOnly: literalExportPackage.handoff?.localOnly !== false,
      writesExternalSystem: literalExportPackage.handoff?.writesExternalSystem === true,
      state: row.state,
      statusPatch: Object.freeze({
        state: "queued",
        nextAction: row.nextAction,
        message: `Literal export ${row.key} is publishable from ${literalExportPackage.revision}.`,
      }),
    })),
  ].sort((left, right) => left.id.localeCompare(right.id)));
  const recoveryCommands = Object.freeze((recoveryPersistence.commands ?? []).map((command) => Object.freeze({
    id: command.id,
    type: `aios.recovery.${command.type}`,
    action: command.action,
    phase: command.phase,
    checkpoint: command.checkpoint,
    statusChannel: command.statusChannel,
    idempotencyKey: command.idempotencyKey,
    idempotent: command.idempotent === true,
    restartSafe: command.restartSafe === true,
    localOnly: command.localOnly !== false,
    writesExternalSystem: command.writesExternalSystem === true,
    statusPatch: command.statusPatch,
  })));
  const boundaryCommands = Object.freeze((literalBoundary.auditTrail ?? []).map((event, index) => Object.freeze({
    id: `boundary:audit:${runtimeAdoption.handoff.checkpoint}:${index + 1}:${event.type}:${event.subject}`,
    type: "aios.boundary.audit",
    action: event.nextAction,
    subject: event.subject,
    boundaryType: event.type,
    checkpoint: runtimeAdoption.handoff.checkpoint,
    statusChannel: runtimeAdoption.handoff.statusChannel,
    idempotencyKey: `boundary:${event.type}:${event.subject}:${runtimeAdoption.handoff.checkpoint}`,
    idempotent: true,
    restartSafe: event.state !== "blocked",
    localOnly: event.localOnly !== false,
    writesExternalSystem: event.writesExternalSystem === true,
    state: event.state,
    statusPatch: Object.freeze({
      state: event.state,
      nextAction: event.nextAction,
      message: event.detail || `${event.type} boundary ${event.subject} is ${event.state}.`,
    }),
  })));
  const pendingCommands = Object.freeze([...providerCommands, ...commentCommands, ...literalCommands, ...packageCommands, ...recoveryCommands, ...boundaryCommands].sort((left, right) => left.id.localeCompare(right.id)));
  const unsafeCommandIds = pendingCommands.filter((command) => !command.restartSafe).map((command) => command.id);
  const replayState = !recoveryStatus.restartSafe
    ? "hold"
    : unsafeCommandIds.length > 0
      ? "hold"
    : acceptance.accepted && runtimeAdoption.handoff.ready
      ? "replay-ready"
      : recoveryPersistence.replayState === "repair-ready"
        ? "repair-ready"
        : "preview-only";
  const resumeCheckpoint = recoveryPersistence.resume?.fromCheckpoint
    || recoveryPersistence.checkpoint
    || runtimeAdoption.handoff.checkpoint;
  const resumeAvailable = recoveryStatus.restartSafe
    && unsafeCommandIds.length === 0
    && Boolean(resumeCheckpoint);

  return Object.freeze({
    schema: "aios.symbol-table.persisted-mailchimp-state.v1",
    revision: `mailchimp:${revisionParts.join(":")}`,
    replayState,
    checkpoint: runtimeAdoption.handoff.checkpoint,
    statusChannel: runtimeAdoption.handoff.statusChannel,
    requestedCapabilities: negotiation.requestedCapabilities,
    pendingCommands,
    commandSummary: Object.freeze({
      total: pendingCommands.length,
      provider: providerCommands.length,
      comment: commentCommands.length,
      literal: literalCommands.length,
      exportPackages: packageCommands.length,
      recovery: recoveryCommands.length,
      boundary: boundaryCommands.length,
      restartSafe: pendingCommands.filter((command) => command.restartSafe).length,
      unsafe: unsafeCommandIds.length,
    }),
    boundaryLedger: Object.freeze({
      workspace: literalBoundary.handoff?.workspace ?? "global",
      tenant: literalBoundary.handoff?.tenant ?? "",
      role: literalBoundary.handoff?.role ?? "",
      ready: literalBoundary.handoff?.ready !== false,
      nextAction: literalBoundary.handoff?.nextAction ?? "handoff_boundary_audit",
      deniedCapabilities: Object.freeze(literalBoundary.permissionState?.denied ?? []),
      auditCommandIds: Object.freeze(boundaryCommands.map((command) => command.id).sort()),
    }),
    surfaceLedger: Object.freeze({
      revision: reconciliation?.revision ?? "",
      state: reconciliation?.state ?? "unknown",
      ready: reconciliation?.handoff?.ready === true,
      service: reconciliation?.service ?? runtimeAdoption.requestState.service,
      adapter: reconciliation?.adapter ?? runtimeAdoption.requestState.adapter,
      statusChannel: reconciliation?.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      issueCodes: Object.freeze((reconciliation?.issues ?? []).map((issue) => issue.code).sort()),
      nextAction: reconciliation?.handoff?.nextAction ?? "adopt_reconciled_mailchimp_surface",
    }),
    commentLedger: Object.freeze({
      revision: commentRuntime.revision ?? "",
      replayState: commentRuntime.replayState ?? "empty",
      checkpoint: commentRuntime.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: commentRuntime.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      resumeAvailable: commentRuntime.resume?.available === true,
      resumeNextAction: commentRuntime.resume?.nextAction ?? "",
      exportReady: commentExport.exportReady === true,
      exportState: commentExport.status?.state ?? "unknown",
      exportHistoryRevision: commentExport.status?.historyRevision ?? "",
      exportPackageRevision: commentExportPackage.revision ?? "",
      publishablePackageRows: commentExportPackage.counters?.publishable ?? 0,
      blockedPackageRows: commentExportPackage.counters?.blocked ?? 0,
      blockedExportFields: Object.freeze(commentExport.blockedFields ?? []),
      blockedCommands: Object.freeze(commentRuntime.persistedView?.blockedCommandIds ?? []),
      idempotencyKeys: Object.freeze(commentRuntime.persistedView?.idempotencyKeys ?? []),
    }),
    literalLedger: Object.freeze({
      revision: literalRuntime.revision ?? "",
      replayState: literalRuntime.replayState ?? "empty",
      checkpoint: literalRuntime.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: literalRuntime.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      resumeAvailable: literalRuntime.resume?.available === true,
      resumeNextAction: literalRuntime.resume?.nextAction ?? "",
      healthState: literalHealth.state ?? "unknown",
      healthRetryable: literalHealth.retryable === true,
      healthNextAction: literalHealth.statusPatch?.nextAction ?? "",
      healthFailures: Object.freeze((literalHealth.failures ?? []).map((failure) => failure.code).sort()),
      healthDegraded: Object.freeze((literalHealth.degraded ?? []).map((event) => event.code).sort()),
      exportPackageRevision: literalExportPackage.revision ?? "",
      releaseReportRevision: literalReleaseReport.revision ?? "",
      releaseReportReady: literalReleaseReport.handoff?.ready === true,
      releaseReadyRows: literalReleaseReport.counters?.releaseReady ?? 0,
      releaseBlockedRows: literalReleaseReport.counters?.blocked ?? 0,
      releaseBlockers: Object.freeze(literalReleaseReport.handoff?.blockers ?? []),
      publishablePackageRows: literalExportPackage.counters?.publishable ?? 0,
      blockedPackageRows: literalExportPackage.counters?.blocked ?? 0,
      blockedCommands: Object.freeze(literalRuntime.persistedView?.blockedCommandIds ?? []),
      idempotencyKeys: Object.freeze(literalRuntime.persistedView?.idempotencyKeys ?? []),
    }),
    recoveryLedger: Object.freeze({
      revision: recoveryPersistence.revision ?? "",
      replayState: recoveryPersistence.replayState ?? "unknown",
      checkpoint: resumeCheckpoint,
      statusChannel: recoveryPersistence.statusChannel ?? recoveryStatus.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      resumeToken: recoveryPersistence.ledger?.resumeToken ?? "",
      blockedCommands: Object.freeze([
        ...(recoveryPersistence.blockedCommands ?? []),
        ...unsafeCommandIds,
      ].filter(Boolean).sort()),
    }),
    recoveryPath: Object.freeze({
      state: recoveryStatus.state,
      restartSafe: recoveryStatus.restartSafe,
      nextAction: replayState === "hold"
        ? unsafeCommandIds.includes(commentRuntime.persistedView?.blockedCommandIds?.[0])
          ? commentRuntime.resume?.nextAction ?? recoveryStatus.nextAction
          : unsafeCommandIds.includes(literalRuntime.persistedView?.blockedCommandIds?.[0])
            ? literalRuntime.resume?.nextAction ?? recoveryStatus.nextAction
          : recoveryStatus.nextAction
        : commentRuntime.resume?.nextAction || literalRuntime.resume?.nextAction || recoveryPersistence.resume?.nextAction || runtimeAdoption.client.nextAction,
      resumeFromCheckpoint: resumeAvailable,
      resumeCheckpoint,
      nextCommandId: commentRuntime.resume?.nextCommandId ?? literalRuntime.resume?.nextCommandId ?? recoveryPersistence.resume?.nextCommandId ?? pendingCommands[0]?.id ?? "",
    }),
  });
}

function buildOperationalHealth({ acceptance, runtimeAdoption, persistedState, recoveryStatus, comments, literalContracts, reconciliation }) {
  const commentRuntime = comments.runtimeState ?? {};
  const commentExport = comments.exportSummary ?? {};
  const commentExportPackage = comments.exportPackage ?? {};
  const literalRuntime = literalContracts.runtimeState ?? {};
  const literalProviders = literalContracts.providerContracts ?? {};
  const literalHealth = literalContracts.operationalHealth ?? {};
  const literalExportPackage = literalContracts.exportPackage ?? {};
  const literalReleaseReport = literalContracts.releaseReport ?? {};
  const literalBoundary = literalContracts.boundaryContract ?? {};
  const failures = [];
  const degraded = [];

  if (!acceptance.accepted) {
    failures.push(Object.freeze({
      code: "AIOS_SYMBOL_ACCEPTANCE_BLOCKED",
      action: acceptance.nextAction,
      detail: acceptance.blockers[0] ?? "unknown",
    }));
  }
  if (commentRuntime.persistedView?.restartSafe === false) {
    failures.push(Object.freeze({
      code: "AIOS_COMMENT_RUNTIME_UNSAFE",
      action: commentRuntime.resume?.nextAction ?? "repair_comment_runtime_state",
      detail: commentRuntime.persistedView.blockedCommandIds?.[0] ?? "comment_runtime",
    }));
  }
  if (literalRuntime.persistedView?.restartSafe === false) {
    failures.push(Object.freeze({
      code: "AIOS_LITERAL_RUNTIME_UNSAFE",
      action: literalRuntime.resume?.nextAction ?? "repair_literal_runtime_state",
      detail: literalRuntime.persistedView.blockedCommandIds?.[0] ?? "literal_runtime",
    }));
  }
  if (commentExport.exportReady === false) {
    failures.push(Object.freeze({
      code: "AIOS_COMMENT_EXPORT_BLOCKED",
      action: commentExport.nextAction ?? "repair_comment_exports",
      detail: commentExport.blockedFields?.[0] ?? commentExport.status?.state ?? "comment_exports",
    }));
  }
  if (commentExportPackage.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_COMMENT_EXPORT_PACKAGE_BLOCKED",
      action: commentExportPackage.handoff.nextAction,
      detail: `${commentExportPackage.counters?.blocked ?? 0} comment export package rows are blocked.`,
    }));
  }
  if (literalExportPackage.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_LITERAL_EXPORT_PACKAGE_BLOCKED",
      action: literalExportPackage.handoff.nextAction,
      detail: `${literalExportPackage.counters?.blocked ?? 0} literal export package rows are blocked.`,
    }));
  }
  if (literalReleaseReport.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_LITERAL_RELEASE_REPORT_BLOCKED",
      action: literalReleaseReport.handoff.nextAction,
      detail: literalReleaseReport.handoff.blockers?.[0] ?? `${literalReleaseReport.counters?.blocked ?? 0} literal release rows are blocked.`,
    }));
  }
  if (literalHealth.state === "failed") {
    failures.push(Object.freeze({
      code: "AIOS_LITERAL_OPERATIONAL_HEALTH_FAILED",
      action: literalHealth.statusPatch?.nextAction ?? "repair_literal_operational_health",
      detail: literalHealth.statusPatch?.message ?? "Literal operational health failed.",
    }));
  }
  if (persistedState.commandSummary.unsafe > 0) {
    failures.push(Object.freeze({
      code: "AIOS_PERSISTED_COMMAND_UNSAFE",
      action: "hold_mailchimp_replay",
      detail: `${persistedState.commandSummary.unsafe} pending commands are not restart safe.`,
    }));
  }
  if (recoveryStatus.state === "recovering" || recoveryStatus.state === "blocked") {
    degraded.push(Object.freeze({
      code: "AIOS_RECOVERY_ACTIVE",
      action: recoveryStatus.nextAction,
      detail: recoveryStatus.state,
    }));
  }
  if (runtimeAdoption.handoff.commentReplayState === "review-ready") {
    degraded.push(Object.freeze({
      code: "AIOS_COMMENT_RUNTIME_REVIEW",
      action: commentRuntime.resume?.nextAction ?? "review_comment_runtime_state",
      detail: "Comment directives are replayable but include warnings.",
    }));
  }
  if (runtimeAdoption.handoff.literalReplayState === "review-ready") {
    degraded.push(Object.freeze({
      code: "AIOS_LITERAL_RUNTIME_REVIEW",
      action: literalRuntime.resume?.nextAction ?? "review_literal_runtime_state",
      detail: "Literal commands are replayable but include warnings.",
    }));
  }
  if (commentExport.status?.state === "review") {
    degraded.push(Object.freeze({
      code: "AIOS_COMMENT_EXPORT_REVIEW",
      action: commentExport.nextAction ?? "review_comment_exports",
      detail: `Comment export history ${commentExport.status.historyRevision} is in review.`,
    }));
  }
  if (literalHealth.state === "degraded") {
    degraded.push(Object.freeze({
      code: "AIOS_LITERAL_OPERATIONAL_HEALTH_DEGRADED",
      action: literalHealth.statusPatch?.nextAction ?? "review_literal_operational_health",
      detail: literalHealth.statusPatch?.message ?? "Literal operational health is degraded.",
    }));
  }
  if (literalProviders.handoff?.ready === false) {
    degraded.push(Object.freeze({
      code: "AIOS_LITERAL_PROVIDER_HANDOFF",
      action: literalProviders.handoff.nextAction,
      detail: "Literal provider contracts are not ready for handoff.",
    }));
  }
  if (literalBoundary.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_BOUNDARY_HANDOFF_UNSAFE",
      action: literalBoundary.handoff.nextAction,
      detail: literalBoundary.diagnostics?.[0]?.message ?? "Literal boundary contract is not safe for handoff.",
    }));
  }
  if (reconciliation?.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_MAILCHIMP_SURFACE_RECONCILIATION_BLOCKED",
      action: reconciliation.handoff.nextAction,
      detail: reconciliation.issues?.[0]?.detail ?? "Mailchimp comment and literal surfaces need reconciliation.",
    }));
  } else if (reconciliation?.state === "review") {
    degraded.push(Object.freeze({
      code: "AIOS_MAILCHIMP_SURFACE_RECONCILIATION_REVIEW",
      action: reconciliation.handoff.nextAction,
      detail: reconciliation.issues?.[0]?.detail ?? "Mailchimp surface reconciliation has warnings.",
    }));
  }
  if (persistedState.boundaryLedger?.deniedCapabilities?.length > 0) {
    failures.push(Object.freeze({
      code: "AIOS_BOUNDARY_PERMISSION_DENIED",
      action: "repair_role_permission_boundary",
      detail: persistedState.boundaryLedger.deniedCapabilities[0],
    }));
  }

  const state = failures.length > 0
    ? "failed"
    : degraded.length > 0
      ? "degraded"
      : runtimeAdoption.handoff.ready ? "healthy" : "warming";
  const retryable = state !== "healthy"
    && (persistedState.recoveryPath.resumeFromCheckpoint === true || literalHealth.retryable === true);
  const backoffSeconds = retryable
    ? Math.max(
      literalHealth.backoff?.seconds ?? 0,
      Math.min(300, 5 * Math.max(1, persistedState.commandSummary.unsafe + recoveryStatus.recovery.summary.errors + 1)),
    )
    : 0;

  return Object.freeze({
    schema: "aios.symbol-table.operational-health.v1",
    state,
    retryable,
    backoff: Object.freeze({
      strategy: retryable ? "linear-checkpoint" : "none",
      seconds: backoffSeconds,
      checkpoint: literalHealth.backoff?.checkpoint ?? persistedState.recoveryPath.resumeCheckpoint,
      resumeToken: persistedState.recoveryLedger.resumeToken,
    }),
    failureCount: failures.length,
    degradedCount: degraded.length,
    failures: Object.freeze(failures),
    degraded: Object.freeze(degraded),
    nextAction: failures[0]?.action
      ?? degraded[0]?.action
      ?? runtimeAdoption.client.nextAction,
    userVisible: Object.freeze({
      state: failures.length > 0 ? "needs-attention" : runtimeAdoption.client.userVisibleState,
      statusChannel: runtimeAdoption.handoff.statusChannel,
      message: failures[0]?.detail
        ?? degraded[0]?.detail
        ?? `${persistedState.commandSummary.total} Mailchimp runtime commands are ready.`,
    }),
  });
}

function buildSymbolTimelineReport({ preview, persistedState, runtimeAdoption, literalContracts, comments, recoveryStatus, operationalHealth, reconciliation }) {
  const runtimeEvents = (persistedState.pendingCommands ?? []).map((command, index) => Object.freeze({
    sequence: index + 1,
    source: command.type.startsWith("aios.literal.") ? "literal"
      : command.type.startsWith("aios.comment.") ? "comment"
        : command.type.startsWith("aios.recovery.") ? "recovery" : "provider",
    label: command.id,
    state: command.state ?? (command.restartSafe ? "ready" : "blocked"),
    checkpoint: command.checkpoint,
    statusChannel: command.statusChannel,
    nextAction: command.action ?? command.statusPatch?.nextAction ?? "inspect_runtime_command",
  }));
  const exportCounters = {
    symbols: preview.counts.symbols,
    capabilities: runtimeAdoption.requestState.capabilities.length,
    pendingCommands: persistedState.commandSummary.total,
    literalCommands: persistedState.commandSummary.literal,
    commentCommands: persistedState.commandSummary.comment,
    recoveryCommands: persistedState.commandSummary.recovery,
    boundaryCommands: persistedState.commandSummary.boundary,
    unsafeCommands: persistedState.commandSummary.unsafe,
    boundaryAuditEvents: literalContracts.boundaryContract?.auditTrail?.length ?? 0,
    literalExports: literalContracts.exportSummary?.exportableKeys?.length ?? 0,
    literalHealthFailures: literalContracts.operationalHealth?.failureCount ?? 0,
    literalHealthDegraded: literalContracts.operationalHealth?.degradedCount ?? 0,
    commentExports: comments.exportSummary?.exportableFields?.length ?? 0,
    commentHistoryEvents: comments.history?.timeline?.length ?? 0,
    commentPublishableExports: comments.exportPackage?.counters?.publishable ?? 0,
    literalPublishableExports: literalContracts.exportPackage?.counters?.publishable ?? 0,
    literalReleaseReadyRows: literalContracts.releaseReport?.counters?.releaseReady ?? 0,
    literalReleaseBlockedRows: literalContracts.releaseReport?.counters?.blocked ?? 0,
    exportPackageCommands: persistedState.commandSummary.exportPackages ?? 0,
    commentWarnings: comments.analytics?.counters?.warnings ?? 0,
    surfaceIssues: reconciliation?.issues?.length ?? 0,
  };

  return Object.freeze({
    schema: "aios.symbol-table.timeline-report.v1",
    revision: stableReportRevision([
      persistedState.revision,
      operationalHealth.state,
      recoveryStatus.state,
      runtimeEvents.length,
      exportCounters.literalCommands,
      exportCounters.commentCommands,
    ]),
    counters: Object.freeze(exportCounters),
    health: Object.freeze({
      state: operationalHealth.state,
      retryable: operationalHealth.retryable,
      nextAction: operationalHealth.nextAction,
      statusChannel: runtimeAdoption.handoff.statusChannel,
    }),
    timeline: Object.freeze([
      ...preview.timeline.map((event, index) => Object.freeze({
        sequence: index + 1,
        source: event.source,
        label: event.label,
        state: event.state,
        checkpoint: runtimeAdoption.handoff.checkpoint,
        statusChannel: runtimeAdoption.handoff.statusChannel,
        nextAction: event.nextAction,
      })),
      ...runtimeEvents.map((event, index) => Object.freeze({
        ...event,
        sequence: preview.timeline.length + index + 1,
      })),
    ]),
    exportReady: Object.freeze({
      accepted: operationalHealth.state === "healthy" || operationalHealth.state === "warming",
      replayState: persistedState.replayState,
      checkpoint: persistedState.checkpoint,
      commentExportReady: comments.exportSummary?.exportReady === true,
      commentExportPackageReady: comments.exportPackage?.handoff?.ready !== false,
      literalExportPackageReady: literalContracts.exportPackage?.handoff?.ready !== false,
      literalReleaseReportReady: literalContracts.releaseReport?.handoff?.ready !== false,
      literalHealthState: literalContracts.operationalHealth?.state ?? "unknown",
      surfaceReconciliationReady: reconciliation?.handoff?.ready !== false,
      nextAction: operationalHealth.nextAction,
    }),
  });
}

function stableReportRevision(parts) {
  return compact(parts.join(":"))
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "symbol-report:none";
}

export function buildAiosSymbolTable(source, options = {}) {
  const program = parse(source, options);
  const comments = buildCommentContractIndex(source);
  const literalContracts = buildLiteralContractSet(program);
  const astSymbols = (program.body ?? []).flatMap(symbolsFromJob);
  const symbols = Object.freeze([...astSymbols, ...commentSymbols(comments)].sort((left, right) => left.id.localeCompare(right.id)));
  const symbolDiagnostics = duplicateDiagnostics(symbols);
  const provider = comments.providerContract ?? {};
  const literalProviders = literalContracts.providerContracts ?? {};
  const negotiation = buildMailchimpNegotiation(comments, literalContracts);
  const reconciliation = buildMailchimpSurfaceReconciliation(comments, literalContracts, negotiation);
  const diagnostics = mergeRecoveryDiagnostics(
    program.diagnostics,
    comments.diagnostics,
    literalContracts.diagnostics,
    reconciliation.diagnostics,
    symbolDiagnostics,
  );
  const recoveryStatus = buildAiosRecoveryStatus(diagnostics, {
    adapter: provider.adapter || literalProviders.adapter || "aios-language",
    service: provider.service || literalProviders.service || "mailchimp-contract-compiler",
    statusChannel: provider.statusChannel || literalProviders.sync?.statusChannels?.[0] || "aios.semantic.symbol-table",
    requestedCapabilities: ["status.read", "recovery.preview", ...negotiation.requestedCapabilities],
    providedCapabilities: ["status.read", "recovery.preview", "recovery.patch.local"],
    syncMode: provider.sync?.mode,
    checkpoint: provider.sync?.checkpoint || literalProviders.sync?.checkpoints?.[0],
    externalWriteRequested: negotiation.sync.externalWriteRequested,
    allowExternalWrite: negotiation.sync.externalWriteAllowed,
    allowSourceRecovery: options.allowSourceRecovery === true,
  });
  const preview = buildSymbolPreview(symbols, literalContracts, comments);
  const acceptance = buildAcceptanceContract(symbols, literalContracts, comments, recoveryStatus, reconciliation);
  const validationSummary = buildValidationSummary(diagnostics, recoveryStatus, acceptance);
  const nextSteps = buildExplainableNextSteps(preview, acceptance, recoveryStatus);
  const runtimeAdoption = buildMailchimpRuntimeAdoption(symbols, literalContracts, comments, acceptance, recoveryStatus, reconciliation);
  const persistedState = buildPersistedMailchimpState({
    symbols,
    literalContracts,
    comments,
    runtimeAdoption,
    recoveryStatus,
    acceptance,
    negotiation,
    reconciliation,
  });
  const operationalHealth = buildOperationalHealth({
    acceptance,
    runtimeAdoption,
    persistedState,
    recoveryStatus,
    comments,
    literalContracts,
    reconciliation,
  });
  const timelineReport = buildSymbolTimelineReport({
    preview,
    persistedState,
    runtimeAdoption,
    literalContracts,
    comments,
    recoveryStatus,
    operationalHealth,
    reconciliation,
  });

  return Object.freeze({
    schema: "aios.semantic.symbol-table.v1",
    ok: recoveryStatus.state === "ready" || recoveryStatus.state === "review",
    symbols,
    byId: Object.freeze(Object.fromEntries(symbols.map((symbol) => [symbol.id, symbol]))),
    byKind: Object.freeze(symbols.reduce((groups, symbol) => {
      groups[symbol.kind] = Object.freeze([...(groups[symbol.kind] ?? []), symbol.id]);
      return groups;
    }, {})),
    literals: literalContracts,
    comments,
    diagnostics,
    status: recoveryStatus,
    preview,
    acceptance,
    validationSummary,
    nextSteps,
    negotiation,
    reconciliation,
    runtimeAdoption,
    persistedState,
    operationalHealth,
    boundary: literalContracts.boundaryContract,
    timelineReport,
    exports: Object.freeze({
      kernelJobs: Object.freeze(symbols.filter((symbol) => symbol.role === "kernel-job").map((symbol) => symbol.name)),
      capabilities: runtimeAdoption.requestState.capabilities,
      memoryMounts: Object.freeze(symbols.filter((symbol) => symbol.kind === "memory").map((symbol) => symbol.name)),
      verifiers: Object.freeze(symbols.filter((symbol) => symbol.kind === "verifier").map((symbol) => symbol.name)),
      statusChannels: Object.freeze(Array.from(new Set([
        ...symbols.filter((symbol) => symbol.kind === "status").map((symbol) => symbol.name),
        runtimeAdoption.requestState.statusChannel,
      ].filter(Boolean))).sort()),
      preview,
      acceptance,
      negotiation,
      reconciliation,
      runtimeAdoption,
      persistedState,
      operationalHealth,
      boundary: literalContracts.boundaryContract,
      commentExportPackage: comments.exportPackage,
      literalExportPackage: literalContracts.exportPackage,
      literalReleaseReport: literalContracts.releaseReport,
      timelineReport,
    }),
  });
}

export function lookupAiosSymbol(table, query = {}) {
  const id = query.id ?? symbolId(query.kind, query.name, query.scope);
  return table?.byId?.[id] ?? null;
}

export function symbolTableSelfCheck() {
  const table = buildAiosSymbolTable("/* @aios provider mailchimp adapter=mailchimp */\n/* @aios capability mailchimp.campaign */\n/* @aios claim campaign-safe */\njob demo { workspace 'mail/root'; tenant 'demo'; role editor; capability mailchimp.campaign scope write; status emits 'local'; }");
  return Object.freeze({
    ok: table.symbols.length >= 3
      && table.exports.capabilities.includes("mailchimp.campaign")
      && table.runtimeAdoption.requestState.service === "mailchimp"
      && table.runtimeAdoption.requestState.boundaryScope.tenant === "demo"
      && table.boundary.handoff.ready === true
      && table.acceptance.accepted === true
      && table.reconciliation.handoff.ready === true
      && table.persistedState.recoveryPath.resumeFromCheckpoint === true
      && table.operationalHealth.retryable === false
      && table.literals.releaseReport.releaseReady === true
      && table.timelineReport.counters.literalReleaseReadyRows >= 1
      && table.timelineReport.counters.pendingCommands >= table.persistedState.commandSummary.total,
    symbolCount: table.symbols.length,
    state: table.status.state,
    health: table.operationalHealth.state,
  });
}
