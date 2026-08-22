import { buildCommentContractIndex } from "../source/comment-syntax.mjs";
import { collectLiteralContracts } from "../source/literal-syntax.mjs";
import { buildAiosRecoveryLifecyclePlan, buildAiosRecoveryStatus, mergeRecoveryDiagnostics, validateAiosRecoveryClientSession } from "../source/error-recovery.mjs";
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

function buildSymbolPreview(symbols, literalContracts, comments, sourcePreviewAcceptance = null) {
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
  const literalPermissionMatrix = literalBoundary.permissionEnvelope?.permissionMatrix ?? {};
  const literalTenantLease = literalBoundary.tenantBoundaryLease ?? {};
  const literalBoundaryCommandCenter = literalBoundary.commandCenter ?? {};
  const literalExportPackage = literalContracts.exportPackage ?? {};
  const literalReleaseReport = literalContracts.releaseReport ?? {};
  const commentDeployment = comments.deploymentIntent ?? {};
  const literalDeployment = literalContracts.deploymentPlan ?? {};
  const literalClientReadiness = literalContracts.clientReadiness ?? {};
  const literalAnalyticsJournal = literalContracts.analyticsExportJournal ?? {};
  const literalExportAuditBundle = literalContracts.exportAuditBundle ?? {};
  const commentWorkflowHandoff = comments.workflowHandoff ?? {};
  const literalWorkflowHandoff = literalContracts.workflowHandoff ?? {};
  const commentLifecycleReadiness = comments.lifecycleReadiness ?? {};
  const literalLifecycleReadiness = literalContracts.lifecycleReadiness ?? {};
  const commentClientStatusAdoption = comments.clientStatusAdoption ?? {};
  const literalClientStatusAdoption = literalContracts.clientStatusAdoption ?? {};
  const commentRecoveryAdoption = comments.recoveryAdoption ?? {};
  const literalRecoveryAdoption = literalContracts.recoveryAdoption ?? {};
  const commentProviderCommitWindow = comments.providerCommitWindow ?? {};
  const literalProviderCommitWindow = literalContracts.providerCommitWindow ?? {};
  const commentOperationalReport = comments.operationalReport ?? {};
  const commentAnalyticsReport = comments.analyticsReport ?? {};
  const commentIncidentAnalytics = comments.incidentAnalytics ?? {};
  const literalOperationalReport = literalContracts.operationalReport ?? {};
  const literalIncidentSnapshot = literalContracts.incidentSnapshot ?? {};
  const commentClientResumeEnvelope = comments.clientResumeEnvelope ?? {};
  const literalClientResumeEnvelope = literalContracts.clientResumeEnvelope ?? {};
  const literalPreviewAcceptance = literalContracts.previewAcceptance ?? {};
  const literalResumeManifest = literalContracts.resumeManifest ?? {};
  const literalRestartDigest = literalContracts.restartDigest ?? {};
  const literalCampaignExportReadiness = literalContracts.campaignExportReadiness ?? {};
  const commentLifecycleCommandCenter = comments.lifecycleCommandCenter ?? {};
  const commentProviderHandoffPanel = comments.providerHandoffPanel ?? {};
  const commentControlIntent = comments.controlIntent ?? {};
  const literalOperatorControlPanel = literalContracts.operatorControlPanel ?? {};
  const literalControlIntent = literalContracts.controlIntent ?? {};
  const commentExternalHandoff = comments.externalHandoffState ?? {};
  const literalExternalHandoff = literalContracts.externalHandoffState ?? {};
  const commentPreviewAcceptance = comments.clientPreviewAcceptance ?? {};
  const commentClientRequestSnapshot = comments.clientRequestSnapshot ?? {};
  const literalClientRequestSnapshot = literalContracts.clientRequestSnapshot ?? {};
  const commentMailchimpReviewPacket = comments.mailchimpReviewPacket ?? {};
  const literalMailchimpReviewPacket = literalContracts.mailchimpReviewPacket ?? {};
  const commentProviderFreshness = comments.providerFreshness ?? {};
  const literalProviderFreshness = literalContracts.providerFreshness ?? {};
  const sourcePreview = sourcePreviewAcceptance ?? {};
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
      commentStatusLedgerRows: commentRuntime.statusLedger?.counters?.rows ?? 0,
      commentStatusLedgerDrifted: commentRuntime.statusLedger?.counters?.drifted ?? 0,
      commentExports: commentExportSummary.exportableFields?.length ?? 0,
      commentPublishableExports: commentExportPackage.counters?.publishable ?? 0,
      commentBlockedExportPackageRows: commentExportPackage.counters?.blocked ?? 0,
      commentHistoryEvents: comments.history?.timeline?.length ?? 0,
      commentAnalyticsWarnings: commentAnalytics.counters?.warnings ?? 0,
      literalPublishableExports: literalExportPackage.counters?.publishable ?? 0,
      literalBlockedExportPackageRows: literalExportPackage.counters?.blocked ?? 0,
      literalReleaseReadyRows: literalReleaseReport.counters?.releaseReady ?? 0,
      literalReleaseBlockedRows: literalReleaseReport.counters?.blocked ?? 0,
      commentDeploymentControls: commentDeployment.counters?.controls ?? 0,
      commentDeploymentBlockedControls: commentDeployment.counters?.blockedControls ?? 0,
      literalDeploymentControls: literalDeployment.counters?.controls ?? 0,
      literalDeploymentBlockedControls: literalDeployment.counters?.blockedControls ?? 0,
      literalClientReadinessRows: literalClientReadiness.preview?.counters?.rows ?? 0,
      literalClientReadinessBlocked: literalClientReadiness.preview?.counters?.blocked ?? 0,
      literalClientReadinessReview: literalClientReadiness.preview?.counters?.review ?? 0,
      literalAnalyticsJournalRows: literalAnalyticsJournal.history?.rows?.length ?? 0,
      literalAnalyticsJournalBlocked: literalAnalyticsJournal.counters?.blocked ?? 0,
      literalAnalyticsJournalReview: literalAnalyticsJournal.counters?.review ?? 0,
      literalAnalyticsJournalExportReady: literalAnalyticsJournal.counters?.exportReady ?? 0,
      literalExportAuditRows: literalExportAuditBundle.counters?.rows ?? 0,
      literalExportAuditBlocked: literalExportAuditBundle.counters?.blocked ?? 0,
      literalExportAuditReview: literalExportAuditBundle.counters?.review ?? 0,
      literalExportAuditReady: literalExportAuditBundle.handoff?.ready === true ? 1 : 0,
      commentSyncPreviewRows: comments.syncPreview?.preview?.providerRows?.length ?? 0,
      commentSyncPreviewBlocked: comments.syncPreview?.validationSummary?.blocked ?? 0,
      commentClientActionRows: comments.clientActionQueue?.counters?.rows ?? 0,
      commentClientActionBlocked: comments.clientActionQueue?.counters?.blocked ?? 0,
      commentWorkflowHandoffRows: commentWorkflowHandoff.preview?.counters?.rows ?? 0,
      commentWorkflowHandoffBlocked: commentWorkflowHandoff.preview?.counters?.blocked ?? 0,
      commentLifecycleReadinessRows: commentLifecycleReadiness.counters?.rows ?? 0,
      commentLifecycleReadinessBlocked: commentLifecycleReadiness.counters?.blocked ?? 0,
      literalLifecycleReadinessRows: literalLifecycleReadiness.counters?.rows ?? 0,
      literalLifecycleReadinessBlocked: literalLifecycleReadiness.counters?.blocked ?? 0,
      literalSyncBridgeProviders: literalContracts.syncBridge?.counters?.providers ?? 0,
      literalSyncBridgeBlocked: literalContracts.syncBridge?.counters?.blocked ?? 0,
      literalProviderNegotiationProviders: literalContracts.providerNegotiation?.counters?.providers ?? 0,
      literalProviderNegotiationBlocked: literalContracts.providerNegotiation?.counters?.blockedProviders ?? 0,
      literalProviderNegotiationMissingCapabilities: literalContracts.providerNegotiation?.counters?.missingCapabilities ?? 0,
      commentProviderAcceptanceRows: comments.providerAcceptance?.preview?.counters?.providers ?? 0,
      commentProviderAcceptanceBlocked: comments.providerAcceptance?.preview?.counters?.blocked ?? 0,
      commentProviderCommitRows: commentProviderCommitWindow.counters?.providers ?? 0,
      commentProviderCommitHeld: commentProviderCommitWindow.counters?.held ?? 0,
      literalProviderCommitRows: literalProviderCommitWindow.counters?.rows ?? 0,
      literalProviderCommitHeld: literalProviderCommitWindow.counters?.held ?? 0,
      literalClientActionRows: literalContracts.clientActionQueue?.counters?.rows ?? 0,
      literalClientActionBlocked: literalContracts.clientActionQueue?.counters?.blocked ?? 0,
      literalWorkflowHandoffRows: literalWorkflowHandoff.preview?.counters?.rows ?? 0,
      literalWorkflowHandoffBlocked: literalWorkflowHandoff.preview?.counters?.blocked ?? 0,
      commentClientStatusAdoptionRows: commentClientStatusAdoption.counters?.rows ?? 0,
      commentClientStatusAdoptionBlocked: commentClientStatusAdoption.counters?.blocked ?? 0,
      literalClientStatusAdoptionRows: literalClientStatusAdoption.counters?.rows ?? 0,
      literalClientStatusAdoptionBlocked: literalClientStatusAdoption.counters?.blocked ?? 0,
      commentRecoveryAdoptionRows: commentRecoveryAdoption.counters?.rows ?? 0,
      commentRecoveryAdoptionBlocked: commentRecoveryAdoption.counters?.blocked ?? 0,
      literalRecoveryAdoptionRows: literalRecoveryAdoption.counters?.rows ?? 0,
      literalRecoveryAdoptionBlocked: literalRecoveryAdoption.counters?.blocked ?? 0,
      commentOperationalReportRows: commentOperationalReport.counters?.rows ?? 0,
      commentOperationalReportBlocked: commentOperationalReport.counters?.blocked ?? 0,
      commentAnalyticsReportRows: commentAnalyticsReport.counters?.rows ?? 0,
      commentAnalyticsReportExportReady: commentAnalyticsReport.counters?.exportReady ?? 0,
      commentAnalyticsReportBlocked: commentAnalyticsReport.counters?.blocked ?? 0,
      commentAnalyticsReportReady: commentAnalyticsReport.handoff?.ready === true ? 1 : 0,
      commentIncidentAnalyticsRows: commentIncidentAnalytics.counters?.rows ?? 0,
      commentIncidentAnalyticsBlocked: commentIncidentAnalytics.counters?.blocked ?? 0,
      commentIncidentAnalyticsReady: commentIncidentAnalytics.handoff?.ready === true ? 1 : 0,
      literalOperationalReportRows: literalOperationalReport.counters?.rows ?? 0,
      literalOperationalReportBlocked: literalOperationalReport.counters?.blocked ?? 0,
      literalIncidentSnapshotRows: literalIncidentSnapshot.counters?.rows ?? 0,
      literalIncidentSnapshotFailures: literalIncidentSnapshot.counters?.failures ?? 0,
      literalIncidentSnapshotReady: literalIncidentSnapshot.handoff?.ready === true ? 1 : 0,
      commentClientResumeRows: commentClientResumeEnvelope.counters?.rows ?? 0,
      commentClientResumeBlocked: commentClientResumeEnvelope.counters?.blocked ?? 0,
      literalClientResumeRows: literalClientResumeEnvelope.counters?.rows ?? 0,
      literalClientResumeBlocked: literalClientResumeEnvelope.counters?.blocked ?? 0,
      literalPreviewAcceptanceRows: literalPreviewAcceptance.validationSummary?.rows ?? 0,
      literalPreviewAcceptanceBlocked: literalPreviewAcceptance.validationSummary?.blocked ?? 0,
      literalPreviewAcceptanceWarnings: literalPreviewAcceptance.validationSummary?.warnings ?? 0,
      literalResumeManifestRows: literalResumeManifest.counters?.rows ?? 0,
      literalResumeManifestReplayable: literalResumeManifest.counters?.replayable ?? 0,
      literalResumeManifestHeld: literalResumeManifest.counters?.held ?? 0,
      literalResumeManifestReady: literalResumeManifest.handoff?.ready === true ? 1 : 0,
      literalRestartDigestRows: literalRestartDigest.counters?.rows ?? 0,
      literalRestartDigestBlocked: literalRestartDigest.counters?.blocked ?? 0,
      literalRestartDigestReady: literalRestartDigest.handoff?.ready === true ? 1 : 0,
      literalCampaignExportRows: literalCampaignExportReadiness.counters?.rows ?? 0,
      literalCampaignExportBlocked: literalCampaignExportReadiness.counters?.blocked ?? 0,
      literalCampaignExportReady: literalCampaignExportReadiness.handoff?.ready === true ? 1 : 0,
      commentLifecycleCommandRows: commentLifecycleCommandCenter.counters?.commands ?? 0,
      commentLifecycleCommandBlocked: commentLifecycleCommandCenter.counters?.blocked ?? 0,
      commentLifecycleCommandReady: commentLifecycleCommandCenter.handoff?.ready === true ? 1 : 0,
      commentProviderHandoffPanelRows: commentProviderHandoffPanel.counters?.rows ?? 0,
      commentProviderHandoffPanelBlocked: commentProviderHandoffPanel.counters?.blocked ?? 0,
      commentControlIntentRows: commentControlIntent.counters?.rows ?? 0,
      commentControlIntentBlocked: commentControlIntent.counters?.blocked ?? 0,
      commentControlIntentReady: commentControlIntent.handoff?.ready === true ? 1 : 0,
      literalOperatorControlRows: literalOperatorControlPanel.counters?.rows ?? 0,
      literalOperatorControlBlocked: literalOperatorControlPanel.counters?.blocked ?? 0,
      literalControlIntentRows: literalControlIntent.counters?.rows ?? 0,
      literalControlIntentBlocked: literalControlIntent.counters?.blocked ?? 0,
      literalControlIntentReady: literalControlIntent.handoff?.ready === true ? 1 : 0,
      commentExternalHandoffRows: commentExternalHandoff.counters?.rows ?? 0,
      commentExternalHandoffBlocked: commentExternalHandoff.counters?.blocked ?? 0,
      commentExternalHandoffReady: commentExternalHandoff.handoff?.ready === true ? 1 : 0,
      commentClientPreviewRows: commentPreviewAcceptance.validationSummary?.rows ?? 0,
      commentClientPreviewBlocked: commentPreviewAcceptance.validationSummary?.blocked ?? 0,
      commentClientPreviewReady: commentPreviewAcceptance.handoff?.ready === true ? 1 : 0,
      commentClientRequestRows: commentClientRequestSnapshot.counters?.rows ?? 0,
      commentClientRequestBlocked: commentClientRequestSnapshot.counters?.blocked ?? 0,
      commentClientRequestReady: commentClientRequestSnapshot.handoff?.ready === true ? 1 : 0,
      commentClientRequestResumeRows: commentClientRequestSnapshot.requestResumeDecision?.counters?.rows ?? 0,
      commentClientRequestResumeHeld: commentClientRequestSnapshot.requestResumeDecision?.counters?.held ?? 0,
      commentClientRequestResumeReplayable: commentClientRequestSnapshot.requestResumeDecision?.counters?.replayable ?? 0,
      commentMailchimpReviewRows: commentMailchimpReviewPacket.validationSummary?.rows ?? 0,
      commentMailchimpReviewBlocked: commentMailchimpReviewPacket.validationSummary?.blocked ?? 0,
      commentMailchimpReviewReady: commentMailchimpReviewPacket.handoff?.ready === true ? 1 : 0,
      literalMailchimpReviewRows: literalMailchimpReviewPacket.validationSummary?.rows ?? 0,
      literalMailchimpReviewBlocked: literalMailchimpReviewPacket.validationSummary?.blocked ?? 0,
      literalMailchimpReviewReady: literalMailchimpReviewPacket.handoff?.ready === true ? 1 : 0,
      commentProviderSlaRows: commentProviderFreshness.sla?.counters?.rows ?? 0,
      commentProviderSlaBlocked: commentProviderFreshness.sla?.counters?.blocked ?? 0,
      commentProviderSlaStale: commentProviderFreshness.sla?.counters?.stale ?? 0,
      commentProviderSlaReady: commentProviderFreshness.sla?.handoff?.ready === true ? 1 : 0,
      literalProviderSlaRows: literalProviderFreshness.sla?.counters?.rows ?? 0,
      literalProviderSlaBlocked: literalProviderFreshness.sla?.counters?.blocked ?? 0,
      literalProviderSlaStale: literalProviderFreshness.sla?.counters?.stale ?? 0,
      literalProviderSlaReady: literalProviderFreshness.sla?.handoff?.ready === true ? 1 : 0,
      sourcePreviewAcceptanceRows: sourcePreview.validationSummary?.rows ?? 0,
      sourcePreviewAcceptanceBlocked: sourcePreview.validationSummary?.blocked ?? 0,
      sourcePreviewAcceptanceReview: sourcePreview.validationSummary?.review ?? 0,
      sourcePreviewAcceptanceReady: sourcePreview.handoff?.ready === true ? 1 : 0,
      literalExternalHandoffRows: literalExternalHandoff.counters?.rows ?? 0,
      literalExternalHandoffBlocked: literalExternalHandoff.counters?.blocked ?? 0,
      literalExternalHandoffReady: literalExternalHandoff.handoff?.ready === true ? 1 : 0,
      literalClientRequestRows: literalClientRequestSnapshot.counters?.rows ?? 0,
      literalClientRequestBlocked: literalClientRequestSnapshot.counters?.blocked ?? 0,
      literalClientRequestReady: literalClientRequestSnapshot.handoff?.ready === true ? 1 : 0,
      literalClientRequestResumeRows: literalClientRequestSnapshot.requestResumeDecision?.counters?.rows ?? 0,
      literalClientRequestResumeHeld: literalClientRequestSnapshot.requestResumeDecision?.counters?.held ?? 0,
      literalClientRequestResumeReplayable: literalClientRequestSnapshot.requestResumeDecision?.counters?.replayable ?? 0,
      literalControls: literalWorkflow.controls?.length ?? 0,
      literalRuntimeCommands: literalRuntime.commandSummary?.total ?? 0,
      literalRuntimeBlocked: literalRuntime.commandSummary?.blocked ?? 0,
      literalStatusLedgerRows: literalRuntime.statusLedger?.counters?.rows ?? 0,
      literalStatusLedgerDrifted: literalRuntime.statusLedger?.counters?.drifted ?? 0,
      literalHealthFailures: literalHealth.failureCount ?? 0,
      literalHealthDegraded: literalHealth.degradedCount ?? 0,
      boundaryWorkspaces: literalBoundary.workspaces?.length ?? 0,
      boundaryTenants: literalBoundary.tenants?.length ?? 0,
      boundaryRoles: literalBoundary.roles?.length ?? 0,
      boundaryAuditEvents: literalBoundary.auditTrail?.length ?? 0,
      boundaryPermissionMatrixRows: literalPermissionMatrix.counters?.rows ?? 0,
      boundaryPermissionMatrixReview: literalPermissionMatrix.counters?.review ?? 0,
      boundaryPermissionMatrixDenied: literalPermissionMatrix.counters?.deny ?? 0,
      boundaryPermissionMatrixExternalPending: literalPermissionMatrix.counters?.externalPending ?? 0,
      boundaryTenantLeaseRows: literalTenantLease.counters?.rows ?? 0,
      boundaryTenantLeaseBlocked: literalTenantLease.counters?.blocked ?? 0,
      boundaryTenantLeaseReview: literalTenantLease.counters?.review ?? 0,
      boundaryTenantLeaseReady: literalTenantLease.handoff?.ready === true ? 1 : 0,
      boundaryCommandRows: literalBoundaryCommandCenter.counters?.rows ?? 0,
      boundaryCommandBlocked: literalBoundaryCommandCenter.counters?.blocked ?? 0,
      boundaryCommandReview: literalBoundaryCommandCenter.counters?.review ?? 0,
      boundaryCommandExternalWrites: literalBoundaryCommandCenter.counters?.externalWrites ?? 0,
      boundaryCommandReady: literalBoundaryCommandCenter.handoff?.ready === true ? 1 : 0,
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
      ...(commentDeployment.controls ?? []).map((row) => Object.freeze({
        source: "comment-deployment",
        label: `${row.field}:${row.value}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalDeployment.controls ?? []).map((row) => Object.freeze({
        source: "literal-deployment",
        label: `${row.type}:${row.key}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalClientReadiness.preview?.rows ?? []).map((row) => Object.freeze({
        source: "literal-client-readiness",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalAnalyticsJournal.timeline ?? []).map((event) => Object.freeze({
        source: "literal-analytics-journal",
        label: `${event.source}:${event.label}`,
        state: event.state,
        nextAction: event.nextAction,
      })),
      ...(literalExportAuditBundle.timeline ?? []).map((event) => Object.freeze({
        source: event.source,
        label: event.label,
        state: event.state,
        nextAction: event.nextAction,
      })),
      ...(comments.syncPreview?.preview?.providerRows ?? []).map((row) => Object.freeze({
        source: "comment-sync-preview",
        label: `${row.field}:${row.value}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(comments.clientActionQueue?.rows ?? []).map((row) => Object.freeze({
        source: "comment-client-action",
        label: row.subject,
        state: row.state,
        nextAction: row.action,
      })),
      ...(literalContracts.syncBridge?.providers ?? []).map((row) => Object.freeze({
        source: "literal-sync-bridge",
        label: `${row.key}:${row.adapter}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalContracts.providerNegotiation?.providers ?? []).map((row) => Object.freeze({
        source: "literal-provider-negotiation",
        label: `${row.sourceKey}:${row.adapter}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(comments.providerAcceptance?.preview?.providerRows ?? []).map((row) => Object.freeze({
        source: "comment-provider-acceptance",
        label: `${row.field}:${row.value}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentProviderCommitWindow.providerRows ?? []).map((row) => Object.freeze({
        source: "comment-provider-commit",
        label: `${row.field}:${row.value}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalProviderCommitWindow.rows ?? []).map((row) => Object.freeze({
        source: "literal-provider-commit",
        label: `${row.sourceKey}:${row.adapter}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalContracts.clientActionQueue?.rows ?? []).map((row) => Object.freeze({
        source: "literal-client-action",
        label: row.subject,
        state: row.state,
        nextAction: row.action,
      })),
      ...(commentWorkflowHandoff.preview?.rows ?? []).map((row) => Object.freeze({
        source: "comment-workflow-handoff",
        label: row.subject,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalWorkflowHandoff.preview?.rows ?? []).map((row) => Object.freeze({
        source: "literal-workflow-handoff",
        label: row.subject,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentLifecycleReadiness.rows ?? []).map((row) => Object.freeze({
        source: "comment-lifecycle-readiness",
        label: `${row.field}:${row.value}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalLifecycleReadiness.rows ?? []).map((row) => Object.freeze({
        source: "literal-lifecycle-readiness",
        label: `${row.type}:${row.key}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentClientStatusAdoption.rows ?? []).map((row) => Object.freeze({
        source: "comment-client-status-adoption",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalClientStatusAdoption.rows ?? []).map((row) => Object.freeze({
        source: "literal-client-status-adoption",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentRecoveryAdoption.rows ?? []).map((row) => Object.freeze({
        source: "comment-recovery-adoption",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalRecoveryAdoption.rows ?? []).map((row) => Object.freeze({
        source: "literal-recovery-adoption",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentOperationalReport.rows ?? []).map((row) => Object.freeze({
        source: "comment-operational-report",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentAnalyticsReport.timeline ?? []).map((event) => Object.freeze({
        source: event.source,
        label: event.label,
        state: event.state,
        nextAction: event.nextAction,
      })),
      ...(commentIncidentAnalytics.rows ?? []).map((row) => Object.freeze({
        source: "comment-incident-analytics",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalOperationalReport.rows ?? []).map((row) => Object.freeze({
        source: "literal-operational-report",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalIncidentSnapshot.rows ?? []).map((row) => Object.freeze({
        source: "literal-incident-snapshot",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentClientResumeEnvelope.rows ?? []).map((row) => Object.freeze({
        source: "comment-client-resume",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalClientResumeEnvelope.rows ?? []).map((row) => Object.freeze({
        source: "literal-client-resume",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalPreviewAcceptance.rows ?? []).map((row) => Object.freeze({
        source: "literal-preview-acceptance",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalResumeManifest.rows ?? []).map((row) => Object.freeze({
        source: "literal-resume-manifest",
        label: `${row.type}:${row.commandId}`,
        state: row.replayState,
        nextAction: row.nextAction,
      })),
      ...(literalRestartDigest.rows ?? []).map((row) => Object.freeze({
        source: "literal-restart-digest",
        label: `${row.type}:${row.commandId}`,
        state: row.restartSafe ? "restart-safe" : "blocked",
        nextAction: row.nextAction,
      })),
      ...(literalCampaignExportReadiness.rows ?? []).map((row) => Object.freeze({
        source: "literal-campaign-export-readiness",
        label: `${row.role}:${row.key}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentLifecycleCommandCenter.commandRows ?? []).map((row) => Object.freeze({
        source: "comment-lifecycle-command-center",
        label: `${row.field}:${row.value}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentProviderHandoffPanel.rows ?? []).map((row) => Object.freeze({
        source: "comment-provider-handoff-panel",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentControlIntent.rows ?? []).map((row) => Object.freeze({
        source: "comment-control-intent",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalOperatorControlPanel.rows ?? []).map((row) => Object.freeze({
        source: "literal-operator-control-panel",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalControlIntent.rows ?? []).map((row) => Object.freeze({
        source: "literal-control-intent",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentExternalHandoff.rows ?? []).map((row) => Object.freeze({
        source: "comment-external-handoff",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentPreviewAcceptance.rows ?? []).map((row) => Object.freeze({
        source: "comment-client-preview-acceptance",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(commentClientRequestSnapshot.requestResumeDecision?.rows ?? []).map((row) => Object.freeze({
        source: "comment-client-request-resume",
        label: `${row.source}:${row.subject}`,
        state: row.replayState,
        nextAction: row.nextAction,
      })),
      ...(commentMailchimpReviewPacket.rows ?? []).map((row) => Object.freeze({
        source: "comment-mailchimp-review",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalMailchimpReviewPacket.rows ?? []).map((row) => Object.freeze({
        source: "literal-mailchimp-review",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(sourcePreview.rows ?? []).map((row) => Object.freeze({
        source: "mailchimp-source-preview-acceptance",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalExternalHandoff.rows ?? []).map((row) => Object.freeze({
        source: "literal-external-handoff",
        label: `${row.source}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalClientRequestSnapshot.requestResumeDecision?.rows ?? []).map((row) => Object.freeze({
        source: "literal-client-request-resume",
        label: `${row.source}:${row.subject}`,
        state: row.replayState,
        nextAction: row.nextAction,
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
      ...(commentRuntime.statusLedger?.rows ?? []).map((row) => Object.freeze({
        source: "comment-status-ledger",
        label: `${row.field}:${row.value}`,
        state: row.persistedState,
        nextAction: row.nextAction,
      })),
      ...(literalRuntime.statusLedger?.rows ?? []).map((row) => Object.freeze({
        source: "literal-status-ledger",
        label: `${row.type}:${row.key}`,
        state: row.persistedState,
        nextAction: row.nextAction,
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
      ...(literalPermissionMatrix.rows ?? []).map((row) => Object.freeze({
        source: "literal-permission-matrix",
        label: `${row.principal}:${row.capability}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalTenantLease.rows ?? []).map((row) => Object.freeze({
        source: "literal-tenant-boundary-lease",
        label: `${row.type}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
      ...(literalBoundaryCommandCenter.rows ?? []).map((row) => Object.freeze({
        source: "literal-boundary-command-center",
        label: `${row.type}:${row.subject}`,
        state: row.state,
        nextAction: row.nextAction,
      })),
    ]),
  });
}

function buildSurfaceOperationalReport(comments, literalContracts) {
  const commentReport = comments.operationalReport ?? {};
  const literalReport = literalContracts.operationalReport ?? {};
  const rows = Object.freeze([
    ...(commentReport.rows ?? []).map((row) => Object.freeze({ ...row, surface: "comment" })),
    ...(literalReport.rows ?? []).map((row) => Object.freeze({ ...row, surface: "literal" })),
  ].sort((left, right) => `${left.surface}:${left.source}:${left.subject}`.localeCompare(`${right.surface}:${right.source}:${right.subject}`)));
  const diagnostics = Object.freeze([
    ...(commentReport.diagnostics ?? []).map((row) => Object.freeze({ ...row, surface: "comment" })),
    ...(literalReport.diagnostics ?? []).map((row) => Object.freeze({ ...row, surface: "literal" })),
  ].sort((left, right) => `${left.surface}:${left.subject}`.localeCompare(`${right.surface}:${right.subject}`)));
  const allRows = Object.freeze([...rows, ...diagnostics]);
  const blockedRows = allRows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = allRows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const checkpoint = commentReport.handoff?.checkpoint
    || literalReport.handoff?.checkpoint
    || "mailchimp:operational";
  const statusChannel = commentReport.handoff?.statusChannel
    || literalReport.handoff?.statusChannel
    || "mailchimp.contract.status";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "publish_mailchimp_surface_operational_report" : "attach_mailchimp_operational_report");

  return Object.freeze({
    schema: "aios.symbol-table.surface-operational-report.v1",
    revision: symbolId("surface-operational-report", `${commentReport.revision ?? "comment"}:${literalReport.revision ?? "literal"}:${state}`, "mailchimp"),
    state,
    rows,
    diagnostics,
    counters: Object.freeze({
      rows: rows.length,
      diagnostics: diagnostics.length,
      commentRows: commentReport.counters?.rows ?? 0,
      literalRows: literalReport.counters?.rows ?? 0,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: allRows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.surface ?? "surface"}:${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.surface ?? "surface"}:${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint,
      statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function buildLifecycleReadinessBridge(comments, literalContracts) {
  const commentReadiness = comments.lifecycleReadiness ?? {};
  const literalReadiness = literalContracts.lifecycleReadiness ?? {};
  const boundaryCommandCenter = literalContracts.boundaryContract?.commandCenter ?? {};
  const rows = Object.freeze([
    ...(commentReadiness.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.lifecycle-readiness-row.v1",
      source: "comment",
      subject: `${row.field}:${row.value}`,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(literalReadiness.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.lifecycle-readiness-row.v1",
      source: "literal",
      subject: `${row.type}:${row.key}`,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(boundaryCommandCenter.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.lifecycle-readiness-row.v1",
      source: "literal-boundary-command",
      subject: `${row.type}:${row.subject}`,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
  ].sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || !row.restartSafe);
  const review = Object.freeze([
    ...(commentReadiness.acceptance?.review ?? []).map((item) => `comment:${item}`),
    ...(literalReadiness.acceptance?.review ?? []).map((item) => `literal:${item}`),
    ...(boundaryCommandCenter.acceptance?.review ?? []).map((item) => `literal-boundary:${item}`),
  ].sort());
  const checkpoint = commentReadiness.handoff?.checkpoint
    || literalReadiness.handoff?.checkpoint
    || boundaryCommandCenter.handoff?.checkpoint
    || "mailchimp:lifecycle";
  const statusChannel = commentReadiness.handoff?.statusChannel
    || literalReadiness.handoff?.statusChannel
    || boundaryCommandCenter.handoff?.statusChannel
    || "mailchimp.contract.status";
  const nextAction = blockedRows[0]?.nextAction
    ?? commentReadiness.handoff?.nextAction
    ?? literalReadiness.handoff?.nextAction
    ?? boundaryCommandCenter.handoff?.nextAction
    ?? "adopt_mailchimp_lifecycle_readiness";

  return Object.freeze({
    schema: "aios.symbol-table.lifecycle-readiness-bridge.v1",
    state: blockedRows.length > 0 ? "blocked" : review.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty",
    rows,
    counters: Object.freeze({
      rows: rows.length,
      commentRows: commentReadiness.counters?.rows ?? 0,
      literalRows: literalReadiness.counters?.rows ?? 0,
      boundaryCommandRows: boundaryCommandCenter.counters?.rows ?? 0,
      boundaryCommandBlocked: boundaryCommandCenter.counters?.blocked ?? 0,
      boundaryCommandReview: boundaryCommandCenter.counters?.review ?? 0,
      blocked: blockedRows.length,
      review: review.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review,
      nextAction,
    }),
    boundaryControls: Object.freeze({
      requiredSettings: boundaryCommandCenter.requiredSettings ?? Object.freeze({}),
      controls: boundaryCommandCenter.controls ?? Object.freeze({}),
      state: boundaryCommandCenter.state ?? "empty",
      nextAction: boundaryCommandCenter.handoff?.nextAction ?? "",
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildMailchimpCampaignExportPreview(comments, literalContracts, recoveryStatus) {
  const literalCampaign = literalContracts.campaignExportReadiness ?? {};
  const commentLifecycleCenter = comments.lifecycleCommandCenter ?? {};
  const recoveryProviderReport = recoveryStatus.providerHandoffReport ?? {};
  const rows = Object.freeze([
    ...(literalCampaign.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.campaign-export-preview-row.v1",
      source: "literal-campaign",
      subject: `${row.role}:${row.key}`,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(literalCampaign.releaseRows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.campaign-export-preview-row.v1",
      source: "literal-release",
      subject: row.key,
      state: row.releaseReady ? "release-ready" : row.state,
      checkpoint: literalCampaign.handoff?.checkpoint ?? "",
      statusChannel: literalCampaign.handoff?.statusChannel ?? "mailchimp.contract.status",
      restartSafe: row.releaseReady === true,
      localOnly: literalCampaign.handoff?.localOnly !== false,
      writesExternalSystem: literalCampaign.handoff?.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(commentLifecycleCenter.commandRows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.campaign-export-preview-row.v1",
      source: "comment-lifecycle",
      subject: `${row.field}:${row.value}`,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(recoveryProviderReport.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.campaign-export-preview-row.v1",
      source: "recovery-provider",
      subject: `${row.source}:${row.subject}`,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
  ].sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.state === "held" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const checkpoint = literalCampaign.handoff?.checkpoint
    || commentLifecycleCenter.handoff?.checkpoint
    || recoveryProviderReport.handoff?.checkpoint
    || "mailchimp:campaign-export";
  const statusChannel = literalCampaign.handoff?.statusChannel
    || commentLifecycleCenter.handoff?.statusChannel
    || recoveryProviderReport.handoff?.statusChannel
    || "mailchimp.contract.status";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "accept_mailchimp_campaign_export_preview" : "attach_mailchimp_campaign_export_contract");
  const state = blockedRows.length > 0
    ? "blocked"
    : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";

  return Object.freeze({
    schema: "aios.symbol-table.campaign-export-preview.v1",
    revision: symbolId("campaign-export-preview", `${literalCampaign.revision ?? "literal"}:${commentLifecycleCenter.revision ?? "comment"}:${recoveryProviderReport.revision ?? "recovery"}:${state}`, "mailchimp"),
    state,
    preview: Object.freeze({
      title: "Mailchimp campaign export",
      rows,
      counters: Object.freeze({
        rows: rows.length,
        literalRows: literalCampaign.counters?.rows ?? 0,
        commentCommands: commentLifecycleCenter.counters?.commands ?? 0,
        recoveryRows: recoveryProviderReport.counters?.rows ?? 0,
        blocked: blockedRows.length,
        review: reviewRows.length,
        restartSafe: rows.filter((row) => row.restartSafe).length,
        externalWrites: rows.filter((row) => row.writesExternalSystem).length,
      }),
    }),
    validationSummary: Object.freeze({
      state,
      blocked: blockedRows.length,
      review: reviewRows.length,
      literalAccepted: literalCampaign.acceptance?.acceptedForRuntime !== false,
      lifecycleAccepted: commentLifecycleCenter.acceptance?.acceptedForRuntime !== false,
      recoveryAccepted: recoveryProviderReport.acceptance?.acceptedForRuntime !== false,
      nextAction,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    nextSteps: Object.freeze([
      ...blockedRows.map((row, index) => Object.freeze({
        order: index + 1,
        action: row.nextAction,
        subject: `${row.source}:${row.subject}`,
        restartSafe: row.restartSafe,
      })),
      ...(blockedRows.length === 0 ? [Object.freeze({
        order: 1,
        action: reviewRows.length > 0 ? "review_mailchimp_campaign_export_preview" : "accept_mailchimp_campaign_export_preview",
        subject: checkpoint,
        restartSafe: true,
      })] : []),
    ]),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildMailchimpSurfaceControlPanel(comments, literalContracts, recoveryStatus) {
  const commentPanel = comments.providerHandoffPanel ?? {};
  const commentControlIntent = comments.controlIntent ?? {};
  const literalPanel = literalContracts.operatorControlPanel ?? {};
  const literalControlIntent = literalContracts.controlIntent ?? {};
  const recoveryPanel = recoveryStatus.previewAcceptanceSummary ?? {};
  const recoveryControlIntent = recoveryStatus.controlIntentAcceptance ?? {};
  const rows = Object.freeze([
    ...(commentPanel.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.surface-control-row.v1",
      source: `comment:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(literalPanel.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.surface-control-row.v1",
      source: `literal:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(commentControlIntent.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.surface-control-row.v1",
      source: `comment-control:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(literalControlIntent.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.surface-control-row.v1",
      source: `literal-control:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(recoveryControlIntent.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.surface-control-row.v1",
      source: `recovery-control:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(recoveryPanel.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.surface-control-row.v1",
      source: `recovery:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: recoveryPanel.handoff?.checkpoint ?? recoveryStatus.handoff?.checkpoint ?? "",
      statusChannel: recoveryPanel.handoff?.statusChannel ?? recoveryStatus.handoff?.statusChannel ?? "",
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
  ].sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const checkpoints = Object.freeze(Array.from(new Set(rows.map((row) => row.checkpoint).filter(Boolean))).sort());
  const statusChannels = Object.freeze(Array.from(new Set(rows.map((row) => row.statusChannel).filter(Boolean))).sort());
  const state = blockedRows.length > 0
    ? "blocked"
    : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "publish_mailchimp_surface_control_panel" : "attach_mailchimp_surface_controls");

  return Object.freeze({
    schema: "aios.symbol-table.surface-control-panel.v1",
    revision: symbolId("surface-control-panel", `${state}:${rows.length}:${blockedRows.length}`, "mailchimp"),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      commentRows: commentPanel.counters?.rows ?? 0,
      literalRows: literalPanel.counters?.rows ?? 0,
      recoveryRows: recoveryPanel.counters?.rows ?? 0,
      commentControlRows: commentControlIntent.counters?.rows ?? 0,
      literalControlRows: literalControlIntent.counters?.rows ?? 0,
      recoveryControlRows: recoveryControlIntent.counters?.rows ?? 0,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0
        && commentPanel.acceptance?.acceptedForRuntime !== false
        && literalPanel.acceptance?.acceptedForRuntime !== false
        && recoveryPanel.acceptance?.acceptedForRuntime !== false,
      acceptedForExternalWrite: blockedRows.length === 0 && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint: checkpoints[0] ?? recoveryStatus.handoff?.checkpoint ?? "",
      statusChannel: statusChannels[0] ?? recoveryStatus.handoff?.statusChannel ?? "mailchimp.contract.status",
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function buildMailchimpSourceExternalHandoff(comments, literalContracts, recoveryStatus) {
  const commentHandoff = comments.externalHandoffState ?? {};
  const literalHandoff = literalContracts.externalHandoffState ?? {};
  const recoveryHandoff = recoveryStatus.externalHandoff ?? {};
  const rows = Object.freeze([
    ...(commentHandoff.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.source-external-handoff-row.v1",
      source: `comment:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: row.idempotencyKey ?? "",
      nextAction: row.nextAction,
    })),
    ...(literalHandoff.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.source-external-handoff-row.v1",
      source: `literal:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: row.idempotencyKey ?? "",
      nextAction: row.nextAction,
    })),
    ...(recoveryHandoff.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.source-external-handoff-row.v1",
      source: `recovery:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: symbolId("idempotent", `${row.source}:${row.subject}`, row.checkpoint || "recovery"),
      nextAction: row.nextAction,
    })),
  ].sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.state === "held" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const checkpoints = Object.freeze(Array.from(new Set([
    commentHandoff.handoff?.checkpoint,
    literalHandoff.handoff?.checkpoint,
    recoveryHandoff.handoff?.checkpoint,
    ...rows.map((row) => row.checkpoint),
  ].filter(Boolean))).sort());
  const statusChannels = Object.freeze(Array.from(new Set([
    commentHandoff.handoff?.statusChannel,
    literalHandoff.handoff?.statusChannel,
    recoveryHandoff.handoff?.statusChannel,
    ...rows.map((row) => row.statusChannel),
  ].filter(Boolean))).sort());
  const commentReady = commentHandoff.handoff?.ready !== false;
  const literalReady = literalHandoff.handoff?.ready !== false;
  const recoveryReady = recoveryHandoff.handoff?.ready !== false;
  const ready = blockedRows.length === 0 && commentReady && literalReady && recoveryReady;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "publish_mailchimp_source_external_handoff" : "attach_mailchimp_source_external_handoff");

  return Object.freeze({
    schema: "aios.symbol-table.source-external-handoff.v1",
    revision: symbolId("source-external-handoff", `${state}:${rows.length}:${blockedRows.length}`, "mailchimp"),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      commentRows: commentHandoff.counters?.rows ?? 0,
      literalRows: literalHandoff.counters?.rows ?? 0,
      recoveryRows: recoveryHandoff.rows?.length ?? 0,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    statusLedgerSeed: Object.freeze({
      checkpoint: checkpoints[0] ?? recoveryStatus.handoff?.checkpoint ?? "",
      statusChannel: statusChannels[0] ?? recoveryStatus.handoff?.statusChannel ?? "mailchimp.contract.status",
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      replayableRows: rows.filter((row) => row.restartSafe && row.state !== "blocked").length,
      heldRows: blockedRows.length,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint: checkpoints[0] ?? recoveryStatus.handoff?.checkpoint ?? "",
      statusChannel: statusChannels[0] ?? recoveryStatus.handoff?.statusChannel ?? "mailchimp.contract.status",
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function buildMailchimpSourcePreviewAcceptance(comments, literalContracts, recoveryStatus, surfaceControlPanel, sourceExternalHandoff) {
  const commentPreview = comments.clientPreviewAcceptance ?? {};
  const literalPreview = literalContracts.previewAcceptance ?? {};
  const recoveryPreview = recoveryStatus.previewAcceptanceSummary ?? {};
  const controlPanel = surfaceControlPanel ?? {};
  const externalHandoff = sourceExternalHandoff ?? {};
  const rows = Object.freeze([
    ...(commentPreview.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.source-preview-acceptance-row.v1",
      source: `comment:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: row.idempotencyKey ?? "",
      nextAction: row.nextAction,
    })),
    ...(literalPreview.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.source-preview-acceptance-row.v1",
      source: `literal:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: row.idempotencyKey ?? symbolId("idempotent", `${row.source}:${row.subject}`, row.checkpoint || "literal"),
      nextAction: row.nextAction,
    })),
    ...(recoveryPreview.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.source-preview-acceptance-row.v1",
      source: `recovery:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: recoveryPreview.handoff?.checkpoint ?? recoveryStatus.handoff?.checkpoint ?? "",
      statusChannel: recoveryPreview.handoff?.statusChannel ?? recoveryStatus.handoff?.statusChannel ?? "",
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: symbolId("idempotent", `${row.source}:${row.subject}`, recoveryPreview.handoff?.checkpoint ?? "recovery"),
      nextAction: row.nextAction,
    })),
    ...(controlPanel.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.source-preview-acceptance-row.v1",
      source: `control:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: symbolId("idempotent", `control:${row.source}:${row.subject}`, row.checkpoint || "control"),
      nextAction: row.nextAction,
    })),
    ...(externalHandoff.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.source-preview-acceptance-row.v1",
      source: `external:${row.source}`,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: row.idempotencyKey ?? symbolId("idempotent", `external:${row.source}:${row.subject}`, row.checkpoint || "external"),
      nextAction: row.nextAction,
    })),
  ].sort((left, right) => `${left.source}:${left.subject}:${left.idempotencyKey}`.localeCompare(`${right.source}:${right.subject}:${right.idempotencyKey}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.state === "held" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const checkpoints = Object.freeze(Array.from(new Set([
    commentPreview.handoff?.checkpoint,
    literalPreview.handoff?.checkpoint,
    recoveryPreview.handoff?.checkpoint,
    controlPanel.handoff?.checkpoint,
    externalHandoff.handoff?.checkpoint,
    ...rows.map((row) => row.checkpoint),
  ].filter(Boolean))).sort());
  const statusChannels = Object.freeze(Array.from(new Set([
    commentPreview.handoff?.statusChannel,
    literalPreview.handoff?.statusChannel,
    recoveryPreview.handoff?.statusChannel,
    controlPanel.handoff?.statusChannel,
    externalHandoff.handoff?.statusChannel,
    ...rows.map((row) => row.statusChannel),
  ].filter(Boolean))).sort());
  const ready = blockedRows.length === 0
    && commentPreview.handoff?.ready !== false
    && literalPreview.handoff?.ready !== false
    && recoveryPreview.handoff?.ready !== false
    && controlPanel.handoff?.ready !== false
    && externalHandoff.handoff?.ready !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "accept_mailchimp_source_preview" : "attach_mailchimp_source_preview");

  return Object.freeze({
    schema: "aios.symbol-table.source-preview-acceptance.v1",
    revision: symbolId("source-preview-acceptance", `${state}:${rows.length}:${blockedRows.length}:${reviewRows.length}`, "mailchimp"),
    state,
    rows,
    validationSummary: Object.freeze({
      state,
      rows: rows.length,
      commentRows: commentPreview.validationSummary?.rows ?? 0,
      literalRows: literalPreview.validationSummary?.rows ?? 0,
      recoveryRows: recoveryPreview.counters?.rows ?? 0,
      controlRows: controlPanel.counters?.rows ?? 0,
      externalRows: externalHandoff.counters?.rows ?? 0,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
      nextAction,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || externalRows.length > 0,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    nextSteps: Object.freeze((blockedRows.length > 0 ? blockedRows : reviewRows).map((row, index) => Object.freeze({
      order: index + 1,
      action: row.nextAction,
      subject: `${row.source}:${row.subject}`,
      restartSafe: row.restartSafe,
    }))),
    handoff: Object.freeze({
      ready,
      checkpoint: checkpoints[0] ?? recoveryStatus.handoff?.checkpoint ?? "",
      statusChannel: statusChannels[0] ?? recoveryStatus.handoff?.statusChannel ?? "mailchimp.contract.status",
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function buildMailchimpSourceReviewPacket(comments, literalContracts, sourcePreviewAcceptance, sourceClientRequestAdoption = null, providerFreshnessBridge = null) {
  const commentPacket = comments.mailchimpReviewPacket ?? {};
  const literalPacket = literalContracts.mailchimpReviewPacket ?? {};
  const sourcePreview = sourcePreviewAcceptance ?? {};
  const sourceRequest = sourceClientRequestAdoption ?? {};
  const freshnessBridge = providerFreshnessBridge ?? {};
  const freshnessSla = freshnessBridge.sla ?? {};
  const normalizeRow = (surface, row) => Object.freeze({
    schema: "aios.symbol-table.mailchimp-source-review-row.v1",
    surface,
    source: row.source,
    subject: row.subject,
    state: row.state,
    checkpoint: row.checkpoint ?? "",
    statusChannel: row.statusChannel ?? "mailchimp.contract.status",
    restartSafe: row.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    idempotencyKey: row.idempotencyKey ?? symbolId("mailchimp-review-row", `${surface}:${row.source}:${row.subject}`, row.checkpoint || "mailchimp"),
    display: row.display ?? Object.freeze({
      title: `${row.source}:${row.subject}`,
      detail: "",
      badge: row.state,
    }),
    nextAction: row.nextAction ?? "review_mailchimp_source_contract",
  });
  const sourceRows = [
    ...(commentPacket.rows ?? []).map((row) => normalizeRow("comment", row)),
    ...(literalPacket.rows ?? []).map((row) => normalizeRow("literal", row)),
    ...(sourcePreview.rows ?? []).map((row) => normalizeRow("source-preview", row)),
    ...(sourceRequest.rows ?? []).map((row) => normalizeRow("source-request", row)),
    ...(freshnessBridge.rows ?? []).map((row) => normalizeRow("provider-freshness", row)),
    ...(freshnessSla.rows ?? []).map((row) => normalizeRow("provider-sla", row)),
  ];
  const deduped = new Map();
  for (const row of sourceRows) {
    const key = `${row.surface}:${row.source}:${row.subject}:${row.idempotencyKey}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }
  const rows = Object.freeze(Array.from(deduped.values())
    .sort((left, right) => `${left.state}:${left.surface}:${left.source}:${left.subject}`.localeCompare(`${right.state}:${right.surface}:${right.source}:${right.subject}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const ready = blockedRows.length === 0
    && commentPacket.handoff?.ready !== false
    && literalPacket.handoff?.ready !== false
    && sourcePreview.handoff?.ready !== false
    && sourceRequest.handoff?.ready !== false
    && freshnessBridge.handoff?.ready !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "ready" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (ready ? "accept_mailchimp_source_review_packet" : "prepare_mailchimp_source_review_packet");
  const checkpoints = Object.freeze(Array.from(new Set(rows.map((row) => row.checkpoint).filter(Boolean))).sort());
  const statusChannels = Object.freeze(Array.from(new Set(rows.map((row) => row.statusChannel).filter(Boolean))).sort());

  return Object.freeze({
    schema: "aios.symbol-table.mailchimp-source-review-packet.v1",
    revision: symbolId("mailchimp-source-review", `${state}:${rows.length}:${blockedRows.length}:${reviewRows.length}`, "mailchimp"),
    state,
    rows,
    validationSummary: Object.freeze({
      state,
      rows: rows.length,
      commentRows: commentPacket.validationSummary?.rows ?? 0,
      literalRows: literalPacket.validationSummary?.rows ?? 0,
      sourcePreviewRows: sourcePreview.validationSummary?.rows ?? 0,
      sourceRequestRows: sourceRequest.counters?.rows ?? 0,
      freshnessRows: freshnessBridge.counters?.rows ?? 0,
      freshnessSlaRows: freshnessSla.counters?.rows ?? 0,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
      nextAction,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || externalRows.length > 0,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.surface}:${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.surface}:${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    nextSteps: Object.freeze((blockedRows.length > 0 ? blockedRows : reviewRows).map((row, index) => Object.freeze({
      order: index + 1,
      action: row.nextAction,
      subject: `${row.surface}:${row.source}:${row.subject}`,
      reason: row.display?.detail ?? "",
      restartSafe: row.restartSafe,
    }))),
    handoff: Object.freeze({
      ready,
      checkpoint: checkpoints[0] ?? sourcePreview.handoff?.checkpoint ?? sourceRequest.handoff?.checkpoint ?? "",
      statusChannel: statusChannels[0] ?? sourcePreview.handoff?.statusChannel ?? "mailchimp.contract.status",
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function buildAcceptanceContract(symbols, literalContracts, comments, recoveryStatus, reconciliation = null, surfaceOperationalReport = null, lifecycleReadinessBridge = null, surfaceControlPanel = null, sourceExternalHandoff = null, sourcePreviewAcceptance = null, sourceClientRequestAdoption = null) {
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
  const commentDeploymentReady = comments.deploymentIntent?.handoff?.ready !== false;
  const literalDeploymentReady = literalContracts.deploymentPlan?.handoff?.ready !== false;
  const literalClientReadinessReady = literalContracts.clientReadiness?.handoff?.ready !== false;
  const literalAnalyticsExportReady = literalContracts.analyticsExportJournal?.handoff?.ready !== false;
  const literalExportAuditReady = literalContracts.exportAuditBundle?.handoff?.ready !== false;
  const literalProviderNegotiationReady = literalContracts.providerNegotiation?.handoff?.ready !== false;
  const commentProviderAcceptanceReady = comments.providerAcceptance?.handoff?.ready !== false;
  const literalProviderCommitWindowReady = literalContracts.providerCommitWindow?.handoff?.ready !== false;
  const commentProviderCommitWindowReady = comments.providerCommitWindow?.handoff?.ready !== false;
  const commentClientActionQueueReady = comments.clientActionQueue?.handoff?.ready !== false;
  const literalClientActionQueueReady = literalContracts.clientActionQueue?.handoff?.ready !== false;
  const commentWorkflowHandoffReady = comments.workflowHandoff?.handoff?.ready !== false;
  const literalWorkflowHandoffReady = literalContracts.workflowHandoff?.handoff?.ready !== false;
  const commentClientStatusAdoptionReady = comments.clientStatusAdoption?.handoff?.ready !== false;
  const literalClientStatusAdoptionReady = literalContracts.clientStatusAdoption?.handoff?.ready !== false;
  const commentRecoveryAdoptionReady = comments.recoveryAdoption?.handoff?.ready !== false;
  const literalRecoveryAdoptionReady = literalContracts.recoveryAdoption?.handoff?.ready !== false;
  const commentOperationalReportReady = comments.operationalReport?.handoff?.ready !== false;
  const literalOperationalReportReady = literalContracts.operationalReport?.handoff?.ready !== false;
  const literalPreviewAcceptanceReady = literalContracts.previewAcceptance?.handoff?.ready !== false;
  const surfaceOperationalReportReady = surfaceOperationalReport?.handoff?.ready !== false;
  const commentLifecycleReadinessReady = comments.lifecycleReadiness?.handoff?.ready !== false;
  const literalLifecycleReadinessReady = literalContracts.lifecycleReadiness?.handoff?.ready !== false;
  const lifecycleReadinessBridgeReady = lifecycleReadinessBridge?.handoff?.ready !== false;
  const surfaceControlPanelReady = surfaceControlPanel?.handoff?.ready !== false;
  const sourceExternalHandoffReady = sourceExternalHandoff?.handoff?.ready !== false;
  const commentClientPreviewAcceptanceReady = comments.clientPreviewAcceptance?.handoff?.ready !== false;
  const sourcePreviewAcceptanceReady = sourcePreviewAcceptance?.handoff?.ready !== false;
  const commentClientRequestReady = comments.clientRequestSnapshot?.handoff?.ready !== false;
  const literalClientRequestReady = literalContracts.clientRequestSnapshot?.handoff?.ready !== false;
  const sourceClientRequestReady = sourceClientRequestAdoption?.handoff?.ready !== false;
  const literalWorkflowValid = literalContracts.workflowControls?.valid !== false;
  const providerReady = comments.providerContract?.handoff?.ready !== false
    && literalContracts.providerContracts?.handoff?.ready !== false;
  const boundaryReady = literalContracts.boundaryContract?.handoff?.ready !== false;
  const permissionEnvelopeReady = literalContracts.boundaryContract?.permissionEnvelope?.auditHandoffReady !== false;
  const permissionMatrixReady = literalContracts.boundaryContract?.permissionEnvelope?.permissionMatrix?.handoff?.ready !== false;
  const tenantBoundaryLeaseReady = literalContracts.boundaryContract?.tenantBoundaryLease?.handoff?.ready !== false;
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
    ...(!commentDeploymentReady ? ["comment_deployment_intent_not_ready"] : []),
    ...(!literalDeploymentReady ? ["literal_deployment_plan_not_ready"] : []),
    ...(!literalClientReadinessReady ? ["literal_client_readiness_not_ready"] : []),
    ...(!literalAnalyticsExportReady ? ["literal_analytics_export_not_ready"] : []),
    ...(!literalExportAuditReady ? ["literal_export_audit_not_ready"] : []),
    ...(!literalProviderNegotiationReady ? ["literal_provider_negotiation_not_ready"] : []),
    ...(!commentProviderAcceptanceReady ? ["comment_provider_acceptance_not_ready"] : []),
    ...(!literalProviderCommitWindowReady ? ["literal_provider_commit_window_not_ready"] : []),
    ...(!commentProviderCommitWindowReady ? ["comment_provider_commit_window_not_ready"] : []),
    ...(!commentClientActionQueueReady ? ["comment_client_actions_not_ready"] : []),
    ...(!literalClientActionQueueReady ? ["literal_client_actions_not_ready"] : []),
    ...(!commentWorkflowHandoffReady ? ["comment_workflow_handoff_not_ready"] : []),
    ...(!literalWorkflowHandoffReady ? ["literal_workflow_handoff_not_ready"] : []),
    ...(!commentClientStatusAdoptionReady ? ["comment_client_status_adoption_not_ready"] : []),
    ...(!literalClientStatusAdoptionReady ? ["literal_client_status_adoption_not_ready"] : []),
    ...(!commentRecoveryAdoptionReady ? ["comment_recovery_adoption_not_ready"] : []),
    ...(!literalRecoveryAdoptionReady ? ["literal_recovery_adoption_not_ready"] : []),
    ...(!commentOperationalReportReady ? ["comment_operational_report_not_ready"] : []),
    ...(!literalOperationalReportReady ? ["literal_operational_report_not_ready"] : []),
    ...(!literalPreviewAcceptanceReady ? ["literal_preview_acceptance_not_ready"] : []),
    ...(!surfaceOperationalReportReady ? ["mailchimp_surface_operational_report_not_ready"] : []),
    ...(!commentLifecycleReadinessReady ? ["comment_lifecycle_readiness_not_ready"] : []),
    ...(!literalLifecycleReadinessReady ? ["literal_lifecycle_readiness_not_ready"] : []),
    ...(!lifecycleReadinessBridgeReady ? ["mailchimp_lifecycle_readiness_bridge_not_ready"] : []),
    ...(!surfaceControlPanelReady ? ["mailchimp_surface_control_panel_not_ready"] : []),
    ...(!sourceExternalHandoffReady ? ["mailchimp_source_external_handoff_not_ready"] : []),
    ...(!commentClientPreviewAcceptanceReady ? ["comment_client_preview_acceptance_not_ready"] : []),
    ...(!sourcePreviewAcceptanceReady ? ["mailchimp_source_preview_acceptance_not_ready"] : []),
    ...(!commentClientRequestReady ? ["comment_client_request_not_ready"] : []),
    ...(!literalClientRequestReady ? ["literal_client_request_not_ready"] : []),
    ...(!sourceClientRequestReady ? ["mailchimp_source_client_request_not_ready"] : []),
    ...(!literalHealthReady ? ["literal_health_failed"] : []),
    ...(!literalWorkflowValid ? ["literal_workflow_invalid"] : []),
    ...(!providerReady ? ["provider_handoff_invalid"] : []),
    ...(!boundaryReady ? ["boundary_handoff_invalid"] : []),
    ...(!permissionEnvelopeReady ? ["permission_envelope_invalid"] : []),
    ...(!permissionMatrixReady ? ["permission_matrix_invalid"] : []),
    ...(!tenantBoundaryLeaseReady ? ["tenant_boundary_lease_invalid"] : []),
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
      commentDeploymentReady,
      literalDeploymentReady,
      literalClientReadinessReady,
      literalAnalyticsExportReady,
      literalExportAuditReady,
      literalProviderNegotiationReady,
      commentProviderAcceptanceReady,
      commentClientActionQueueReady,
      literalClientActionQueueReady,
      commentWorkflowHandoffReady,
      literalWorkflowHandoffReady,
      commentClientStatusAdoptionReady,
      literalClientStatusAdoptionReady,
      commentRecoveryAdoptionReady,
      literalRecoveryAdoptionReady,
      commentOperationalReportReady,
      literalOperationalReportReady,
      literalPreviewAcceptanceReady,
      surfaceOperationalReportReady,
      commentLifecycleReadinessReady,
      literalLifecycleReadinessReady,
      lifecycleReadinessBridgeReady,
      surfaceControlPanelReady,
      sourceExternalHandoffReady,
      commentClientPreviewAcceptanceReady,
      sourcePreviewAcceptanceReady,
      commentClientRequestReady,
      literalClientRequestReady,
      sourceClientRequestReady,
      literalHealthReady,
      literalWorkflowValid,
      providerReady,
      boundaryReady,
      permissionEnvelopeReady,
      permissionMatrixReady,
      tenantBoundaryLeaseReady,
      surfaceReconciliationReady,
      tenantReady: Boolean(tenantReady),
      recoveryRestartSafe: recoveryStatus.restartSafe,
      providerHandoffReady: recoveryStatus.providerContract?.sync?.statusHandoffReady === true,
      literalProviderHandoffReady: literalContracts.providerContracts?.handoff?.ready !== false,
      boundaryHandoffReady: literalContracts.boundaryContract?.handoff?.ready !== false,
      permissionEnvelopeHandoffReady: literalContracts.boundaryContract?.permissionEnvelope?.auditHandoffReady !== false,
      permissionMatrixHandoffReady: literalContracts.boundaryContract?.permissionEnvelope?.permissionMatrix?.handoff?.ready !== false,
      tenantBoundaryLeaseHandoffReady: literalContracts.boundaryContract?.tenantBoundaryLease?.handoff?.ready !== false,
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
  if (blocker === "comment_deployment_intent_not_ready") return comments.deploymentIntent?.handoff?.nextAction ?? "repair_comment_deployment_intent";
  if (blocker === "literal_deployment_plan_not_ready") return literalContracts.deploymentPlan?.handoff?.nextAction ?? "repair_literal_deployment_plan";
  if (blocker === "literal_client_readiness_not_ready") return literalContracts.clientReadiness?.handoff?.nextAction ?? "repair_literal_client_readiness";
  if (blocker === "literal_analytics_export_not_ready") return literalContracts.analyticsExportJournal?.handoff?.nextAction ?? "repair_literal_analytics_export_journal";
  if (blocker === "literal_export_audit_not_ready") return literalContracts.exportAuditBundle?.handoff?.nextAction ?? "repair_literal_export_audit_bundle";
  if (blocker === "literal_provider_negotiation_not_ready") return literalContracts.providerNegotiation?.handoff?.nextAction ?? "repair_literal_provider_negotiation";
  if (blocker === "comment_provider_acceptance_not_ready") return comments.providerAcceptance?.handoff?.nextAction ?? "repair_comment_provider_acceptance";
  if (blocker === "comment_client_actions_not_ready") return comments.clientActionQueue?.handoff?.nextAction ?? "repair_comment_client_actions";
  if (blocker === "literal_client_actions_not_ready") return literalContracts.clientActionQueue?.handoff?.nextAction ?? "repair_literal_client_actions";
  if (blocker === "comment_workflow_handoff_not_ready") return comments.workflowHandoff?.handoff?.nextAction ?? "repair_comment_workflow_handoff";
  if (blocker === "literal_workflow_handoff_not_ready") return literalContracts.workflowHandoff?.handoff?.nextAction ?? "repair_literal_workflow_handoff";
  if (blocker === "comment_client_status_adoption_not_ready") return comments.clientStatusAdoption?.handoff?.nextAction ?? "repair_comment_client_status_adoption";
  if (blocker === "literal_client_status_adoption_not_ready") return literalContracts.clientStatusAdoption?.handoff?.nextAction ?? "repair_literal_client_status_adoption";
  if (blocker === "comment_recovery_adoption_not_ready") return comments.recoveryAdoption?.handoff?.nextAction ?? "repair_comment_recovery_adoption";
  if (blocker === "literal_recovery_adoption_not_ready") return literalContracts.recoveryAdoption?.handoff?.nextAction ?? "repair_literal_recovery_adoption";
  if (blocker === "comment_operational_report_not_ready") return comments.operationalReport?.handoff?.nextAction ?? "repair_comment_operational_report";
  if (blocker === "literal_operational_report_not_ready") return literalContracts.operationalReport?.handoff?.nextAction ?? "repair_literal_operational_report";
  if (blocker === "literal_preview_acceptance_not_ready") return literalContracts.previewAcceptance?.handoff?.nextAction ?? "repair_literal_preview_acceptance";
  if (blocker === "mailchimp_surface_operational_report_not_ready") return "repair_mailchimp_surface_operational_report";
  if (blocker === "comment_lifecycle_readiness_not_ready") return comments.lifecycleReadiness?.handoff?.nextAction ?? "repair_comment_lifecycle_readiness";
  if (blocker === "literal_lifecycle_readiness_not_ready") return literalContracts.lifecycleReadiness?.handoff?.nextAction ?? "repair_literal_lifecycle_readiness";
  if (blocker === "mailchimp_lifecycle_readiness_bridge_not_ready") return "repair_mailchimp_lifecycle_readiness_bridge";
  if (blocker === "mailchimp_surface_control_panel_not_ready") return "repair_mailchimp_surface_control_panel";
  if (blocker === "comment_client_preview_acceptance_not_ready") return comments.clientPreviewAcceptance?.handoff?.nextAction ?? "repair_comment_client_preview_acceptance";
  if (blocker === "mailchimp_source_preview_acceptance_not_ready") return "repair_mailchimp_source_preview_acceptance";
  if (blocker === "comment_client_request_not_ready") return comments.clientRequestSnapshot?.handoff?.nextAction ?? "repair_comment_client_request";
  if (blocker === "literal_client_request_not_ready") return literalContracts.clientRequestSnapshot?.handoff?.nextAction ?? "repair_literal_client_request";
  if (blocker === "mailchimp_source_client_request_not_ready") return "repair_mailchimp_source_client_request";
  if (blocker === "literal_health_failed") return literalContracts.operationalHealth?.statusPatch?.nextAction ?? "repair_literal_operational_health";
  if (blocker === "literal_workflow_invalid") return literalContracts.workflowControls?.nextAction ?? "repair_literal_workflow";
  if (blocker === "provider_handoff_invalid") {
    return literalContracts.providerContracts?.handoff?.ready === false
      ? literalContracts.providerContracts?.handoff?.nextAction ?? "repair_literal_provider_contract"
      : comments.providerContract?.handoff?.nextAction ?? "repair_comment_provider_contract";
  }
  if (blocker === "boundary_handoff_invalid") return literalContracts.boundaryContract?.handoff?.nextAction ?? "repair_boundary_scope";
  if (blocker === "permission_envelope_invalid") return literalContracts.boundaryContract?.permissionEnvelope?.statusPatch?.nextAction ?? "handoff_permission_audit";
  if (blocker === "permission_matrix_invalid") return literalContracts.boundaryContract?.permissionEnvelope?.permissionMatrix?.handoff?.nextAction ?? "repair_role_permission_boundary";
  if (blocker === "tenant_boundary_lease_invalid") return literalContracts.boundaryContract?.tenantBoundaryLease?.handoff?.nextAction ?? "handoff_tenant_boundary_lease";
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
  if (!acceptance.gates.commentLifecycleReadinessReady) {
    steps.push({ action: "repair_comment_lifecycle_readiness", reason: "Comment lifecycle controls need accepted settings and schedules before workflow handoff." });
  }
  if (!acceptance.gates.literalLifecycleReadinessReady) {
    steps.push({ action: "repair_literal_lifecycle_readiness", reason: "Literal lifecycle controls need restart-safe settings and schedules before workflow handoff." });
  }
  if (!acceptance.gates.lifecycleReadinessBridgeReady) {
    steps.push({ action: "repair_mailchimp_lifecycle_readiness_bridge", reason: "Comment and literal lifecycle readiness must agree before client runtime adoption." });
  }
  if (!acceptance.gates.surfaceControlPanelReady) {
    steps.push({ action: "repair_mailchimp_surface_control_panel", reason: "Comment provider controls, literal operator controls, and recovery preview acceptance must be ready before client handoff." });
  }
  if (!acceptance.gates.sourceExternalHandoffReady) {
    steps.push({
      action: "repair_mailchimp_source_external_handoff",
      reason: "Comment, literal, and recovery external handoff rows need restart-safe idempotency before provider status can be published.",
    });
  }
  if (!acceptance.gates.commentClientPreviewAcceptanceReady) {
    steps.push({
      action: "repair_comment_client_preview_acceptance",
      reason: "Comment directives need a user-visible accepted preview before client workflow status can adopt them.",
    });
  }
  if (!acceptance.gates.sourcePreviewAcceptanceReady) {
    steps.push({
      action: "repair_mailchimp_source_preview_acceptance",
      reason: "Comment, literal, recovery, control, and external handoff previews must share one accepted client-facing contract.",
    });
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
  if (!acceptance.gates.commentDeploymentReady) {
    steps.push({ action: "repair_comment_deployment_intent", reason: "Comment lifecycle controls need a restart-safe deployment intent before client adoption." });
  }
  if (!acceptance.gates.literalDeploymentReady) {
    steps.push({ action: "repair_literal_deployment_plan", reason: "Literal settings and schedules need a restart-safe deployment plan before Mailchimp adoption." });
  }
  if (!acceptance.gates.literalClientReadinessReady) {
    steps.push({ action: literalClientReadinessNextAction(preview), reason: "Literal preview, release, boundary, and sync rows must be accepted before client runtime handoff." });
  }
  if (!acceptance.gates.literalAnalyticsExportReady) {
    steps.push({ action: literalAnalyticsJournalNextAction(preview), reason: "Literal analytics counters, export rows, and history snapshots must be journal-ready before client reporting handoff." });
  }
  if (!acceptance.gates.literalExportAuditReady) {
    steps.push({
      action: literalExportAuditNextAction(preview),
      reason: "Literal analytics, export, release, and provider evidence need an accepted audit bundle before Mailchimp reporting can be exported.",
    });
  }
  if (!acceptance.gates.literalProviderNegotiationReady) {
    steps.push({ action: "repair_literal_provider_negotiation", reason: "Literal provider rows must negotiate capabilities, checkpoints, and external sync before Mailchimp handoff." });
  }
  if (!acceptance.gates.commentProviderAcceptanceReady) {
    steps.push({ action: "repair_comment_provider_acceptance", reason: "Comment provider directives need accepted preview state before client workflow adoption." });
  }
  if (!acceptance.gates.commentClientActionQueueReady) {
    steps.push({ action: commentClientActionNextAction(preview), reason: "Comment lifecycle and provider actions must be queued before client runtime adoption." });
  }
  if (!acceptance.gates.literalClientActionQueueReady) {
    steps.push({ action: literalClientActionNextAction(preview), reason: "Literal settings, sync, release, and readiness actions must be queued before client runtime adoption." });
  }
  if (!acceptance.gates.commentWorkflowHandoffReady) {
    steps.push({
      action: commentWorkflowHandoffNextAction(preview),
      reason: "Comment provider acceptance, deployment controls, and client actions must form one restart-safe workflow handoff.",
    });
  }
  if (!acceptance.gates.literalWorkflowHandoffReady) {
    steps.push({
      action: literalWorkflowHandoffNextAction(preview),
      reason: "Literal readiness, provider negotiation, sync, and deployment rows must form one accepted workflow handoff.",
    });
  }
  if (!acceptance.gates.commentClientStatusAdoptionReady) {
    steps.push({
      action: commentClientStatusAdoptionNextAction(preview),
      reason: "Comment client status rows must be accepted before Mailchimp workflow status can be published.",
    });
  }
  if (!acceptance.gates.literalClientStatusAdoptionReady) {
    steps.push({
      action: literalClientStatusAdoptionNextAction(preview),
      reason: "Literal client status rows must be accepted before Mailchimp workflow status can be published.",
    });
  }
  if (!acceptance.gates.commentRecoveryAdoptionReady) {
    steps.push({
      action: commentRecoveryAdoptionNextAction(preview),
      reason: "Comment recovery adoption rows must be restart-safe before status recovery can be replayed.",
    });
  }
  if (!acceptance.gates.literalRecoveryAdoptionReady) {
    steps.push({
      action: literalRecoveryAdoptionNextAction(preview),
      reason: "Literal diagnostics, health rows, and client status recovery must be restart-safe before replay.",
    });
  }
  if (!acceptance.gates.commentOperationalReportReady) {
    steps.push({
      action: commentOperationalReportNextAction(preview),
      reason: "Comment runtime, export, provider, status, and recovery rows must publish one operational report before Mailchimp handoff.",
    });
  }
  if (!acceptance.gates.literalOperationalReportReady) {
    steps.push({
      action: literalOperationalReportNextAction(preview),
      reason: "Literal runtime, health, release, provider, status, and recovery rows must publish one operational report before Mailchimp handoff.",
    });
  }
  if (!acceptance.gates.literalPreviewAcceptanceReady) {
    steps.push({
      action: literalPreviewAcceptanceNextAction(preview),
      reason: "Literal preview acceptance rows must be restart-safe and explainable before the client can accept the Mailchimp preview.",
    });
  }
  if (!acceptance.gates.surfaceOperationalReportReady) {
    steps.push({
      action: "repair_mailchimp_surface_operational_report",
      reason: "Comment and literal operational reports must reconcile into one accepted Mailchimp surface health contract.",
    });
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
  if (!acceptance.gates.permissionEnvelopeReady) {
    steps.push({
      action: "handoff_permission_audit",
      reason: "Tenant, workspace, role, and Mailchimp capability permissions need an auditable envelope before external handoff.",
    });
  }
  if (!acceptance.gates.permissionMatrixReady) {
    steps.push({
      action: "repair_boundary_permission_matrix",
      reason: "Tenant-role-capability permission decisions must be allowed or explicitly reviewed before Mailchimp handoff.",
    });
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

function literalClientReadinessNextAction(preview) {
  return preview.timeline.find((event) => event.source === "literal-client-readiness" && event.state !== "ready" && event.state !== "suppressed")?.nextAction
    ?? "accept_literal_client_readiness";
}

function literalAnalyticsJournalNextAction(preview) {
  return preview.timeline.find((event) => event.source === "literal-analytics-journal" && event.state !== "ready" && event.state !== "export-ready" && event.state !== "publishable" && event.state !== "release-ready")?.nextAction
    ?? "publish_literal_analytics_export_journal";
}

function literalExportAuditNextAction(preview) {
  return preview.timeline.find((event) => event.source?.startsWith?.("literal-export-audit") && event.state !== "ready" && event.state !== "publishable" && event.state !== "export-ready" && event.state !== "release-ready")?.nextAction
    ?? "publish_literal_export_audit_bundle";
}

function commentClientActionNextAction(preview) {
  return preview.timeline.find((event) => event.source === "comment-client-action" && event.state !== "queued" && event.state !== "suppressed")?.nextAction
    ?? "adopt_comment_client_actions";
}

function literalClientActionNextAction(preview) {
  return preview.timeline.find((event) => event.source === "literal-client-action" && event.state !== "queued" && event.state !== "suppressed")?.nextAction
    ?? "adopt_literal_client_actions";
}

function commentWorkflowHandoffNextAction(preview) {
  return preview.timeline.find((event) => event.source === "comment-workflow-handoff" && event.state !== "ready" && event.state !== "queued")?.nextAction
    ?? "handoff_comment_workflow";
}

function literalWorkflowHandoffNextAction(preview) {
  return preview.timeline.find((event) => event.source === "literal-workflow-handoff" && event.state !== "ready" && event.state !== "queued" && event.state !== "release-ready")?.nextAction
    ?? "handoff_literal_workflow";
}

function commentClientStatusAdoptionNextAction(preview) {
  return preview.timeline.find((event) => event.source === "comment-client-status-adoption" && event.state !== "accepted" && event.state !== "pending" && event.state !== "ready")?.nextAction
    ?? "publish_comment_client_status_adoption";
}

function literalClientStatusAdoptionNextAction(preview) {
  return preview.timeline.find((event) => event.source === "literal-client-status-adoption" && event.state !== "accepted" && event.state !== "pending" && event.state !== "ready")?.nextAction
    ?? "publish_literal_client_status_adoption";
}

function commentRecoveryAdoptionNextAction(preview) {
  return preview.timeline.find((event) => event.source === "comment-recovery-adoption" && event.state !== "recoverable" && event.state !== "observed" && event.state !== "ready")?.nextAction
    ?? "publish_comment_recovery_adoption";
}

function literalRecoveryAdoptionNextAction(preview) {
  return preview.timeline.find((event) => event.source === "literal-recovery-adoption" && event.state !== "recoverable" && event.state !== "observed" && event.state !== "ready")?.nextAction
    ?? "publish_literal_recovery_adoption";
}

function commentOperationalReportNextAction(preview) {
  return preview.timeline.find((event) => event.source === "comment-operational-report" && event.state !== "ready")?.nextAction
    ?? "publish_comment_operational_report";
}

function literalOperationalReportNextAction(preview) {
  return preview.timeline.find((event) => event.source === "literal-operational-report" && event.state !== "ready")?.nextAction
    ?? "publish_literal_operational_report";
}

function literalPreviewAcceptanceNextAction(preview) {
  return preview.timeline.find((event) => event.source === "literal-preview-acceptance" && event.state !== "ready" && event.state !== "review")?.nextAction
    ?? "accept_literal_preview_contracts";
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
  const literalClientReadiness = literalContracts.clientReadiness ?? {};
  const literalAnalyticsJournal = literalContracts.analyticsExportJournal ?? {};
  const literalPreviewAcceptance = literalContracts.previewAcceptance ?? {};
  const literalProviderNegotiation = literalContracts.providerNegotiation ?? {};
  const commentProviderAcceptance = comments.providerAcceptance ?? {};
  const commentClientActionQueue = comments.clientActionQueue ?? {};
  const literalClientActionQueue = literalContracts.clientActionQueue ?? {};
  const commentWorkflowHandoff = comments.workflowHandoff ?? {};
  const literalWorkflowHandoff = literalContracts.workflowHandoff ?? {};
  const commentExportPackage = comments.exportPackage ?? {};
  const commentDeployment = comments.deploymentIntent ?? {};
  const literalDeployment = literalContracts.deploymentPlan ?? {};
  const commentSignature = comments.adoptionSignature ?? {};
  const literalSignature = literalContracts.adoptionSignature ?? {};
  const permissionEnvelope = literalBoundary.permissionEnvelope ?? {};
  const permissionMatrix = permissionEnvelope.permissionMatrix ?? {};
  const tenantBoundaryLease = literalBoundary.tenantBoundaryLease ?? {};
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
    permissionEnvelope: Object.freeze({
      state: permissionEnvelope.state ?? "unknown",
      auditHandoffReady: permissionEnvelope.auditHandoffReady === true,
      externalWriteRequested: permissionEnvelope.externalWriteRequested === true,
      externalWriteAllowed: permissionEnvelope.externalWriteAllowed === true,
      localOnly: permissionEnvelope.localOnly !== false,
      blockers: Object.freeze(permissionEnvelope.blockers ?? []),
      capabilityCount: permissionEnvelope.counters?.capabilities ?? 0,
      deniedCount: permissionEnvelope.counters?.denied ?? 0,
      auditRowCount: permissionEnvelope.counters?.auditRows ?? 0,
      nextAction: permissionEnvelope.statusPatch?.nextAction ?? "handoff_permission_audit",
    }),
    permissionMatrix: Object.freeze({
      matrixId: permissionMatrix.matrixId ?? "",
      state: permissionMatrix.state ?? "unknown",
      handoffReady: permissionMatrix.handoff?.ready !== false,
      restartSafe: permissionMatrix.handoff?.restartSafe !== false,
      rows: permissionMatrix.counters?.rows ?? 0,
      allowed: permissionMatrix.counters?.allow ?? 0,
      review: permissionMatrix.counters?.review ?? 0,
      denied: permissionMatrix.counters?.deny ?? 0,
      externalPending: permissionMatrix.counters?.externalPending ?? 0,
      blockers: Object.freeze(permissionMatrix.blockers ?? []),
      reviewQueue: Object.freeze((permissionMatrix.reviewQueue ?? []).map((row) => row.decisionId).sort()),
      nextAction: permissionMatrix.handoff?.nextAction ?? "handoff_permission_audit",
    }),
    tenantBoundaryLease: Object.freeze({
      leaseId: tenantBoundaryLease.leaseId ?? "",
      state: tenantBoundaryLease.state ?? "unknown",
      handoffReady: tenantBoundaryLease.handoff?.ready !== false,
      restartSafe: tenantBoundaryLease.handoff?.restartSafe !== false,
      tenant: tenantBoundaryLease.tenant ?? "",
      workspace: tenantBoundaryLease.workspace ?? "global",
      role: tenantBoundaryLease.role ?? "",
      rows: tenantBoundaryLease.counters?.rows ?? 0,
      leased: tenantBoundaryLease.counters?.leased ?? 0,
      blocked: tenantBoundaryLease.counters?.blocked ?? 0,
      review: tenantBoundaryLease.counters?.review ?? 0,
      externalWrites: tenantBoundaryLease.counters?.externalWrites ?? 0,
      blockers: Object.freeze(tenantBoundaryLease.blockers ?? []),
      reviewQueue: Object.freeze(tenantBoundaryLease.review ?? []),
      nextAction: tenantBoundaryLease.handoff?.nextAction ?? "handoff_tenant_boundary_lease",
    }),
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
    && literalClientReadiness.handoff?.ready !== false
    && literalAnalyticsJournal.handoff?.ready !== false
    && literalPreviewAcceptance.handoff?.ready !== false
    && literalProviderNegotiation.handoff?.ready !== false
    && commentProviderAcceptance.handoff?.ready !== false
    && commentClientActionQueue.handoff?.ready !== false
    && literalClientActionQueue.handoff?.ready !== false
    && commentWorkflowHandoff.handoff?.ready !== false
    && literalWorkflowHandoff.handoff?.ready !== false
    && commentDeployment.handoff?.ready !== false
    && literalDeployment.handoff?.ready !== false
    && literalHealth.handoffReady !== false
    && literalHealth.state !== "failed"
    && provider.handoff?.ready !== false
    && literalProviders.handoff?.ready !== false
    && boundaryAuditReady
    && permissionEnvelope.auditHandoffReady !== false
    && permissionMatrix.handoff?.ready !== false
    && tenantBoundaryLease.handoff?.ready !== false
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
      literalClientReadiness: literalClientReadiness.validationSummary ?? null,
      literalAnalyticsExportJournal: literalAnalyticsJournal.report ?? null,
      literalExportAuditBundle: literalContracts.exportAuditBundle ? Object.freeze({
        revision: literalContracts.exportAuditBundle.revision,
        state: literalContracts.exportAuditBundle.state,
        ready: literalContracts.exportAuditBundle.handoff?.ready === true,
        rows: literalContracts.exportAuditBundle.counters?.rows ?? 0,
        blocked: literalContracts.exportAuditBundle.counters?.blocked ?? 0,
        review: literalContracts.exportAuditBundle.counters?.review ?? 0,
        exportReady: literalContracts.exportAuditBundle.counters?.exportReady ?? 0,
        publishableExports: literalContracts.exportAuditBundle.counters?.publishableExports ?? 0,
        blockedBy: Object.freeze(literalContracts.exportAuditBundle.validationSummary?.blockedBy ?? []),
        reviewItems: Object.freeze(literalContracts.exportAuditBundle.validationSummary?.review ?? []),
        nextAction: literalContracts.exportAuditBundle.handoff?.nextAction ?? "publish_literal_export_audit_bundle",
      }) : null,
      literalPreviewAcceptance: literalPreviewAcceptance.revision ? Object.freeze({
        revision: literalPreviewAcceptance.revision,
        state: literalPreviewAcceptance.state,
        ready: literalPreviewAcceptance.handoff?.ready === true,
        rows: literalPreviewAcceptance.validationSummary?.rows ?? 0,
        blocked: literalPreviewAcceptance.validationSummary?.blocked ?? 0,
        warnings: literalPreviewAcceptance.validationSummary?.warnings ?? 0,
        acceptedForPreview: literalPreviewAcceptance.acceptance?.acceptedForPreview === true,
        acceptedForRuntime: literalPreviewAcceptance.acceptance?.acceptedForRuntime === true,
        acceptedForExternalWrite: literalPreviewAcceptance.acceptance?.acceptedForExternalWrite === true,
        blockedBy: Object.freeze(literalPreviewAcceptance.acceptance?.blockedBy ?? []),
        review: Object.freeze(literalPreviewAcceptance.acceptance?.review ?? []),
        requiredClientState: Object.freeze(literalPreviewAcceptance.clientState?.requiredKeys ?? []),
        persistedState: literalPreviewAcceptance.clientState?.persistedState ?? null,
        nextStepQueue: Object.freeze(literalPreviewAcceptance.nextStepQueue ?? []),
        nextAction: literalPreviewAcceptance.handoff?.nextAction ?? "accept_literal_preview_contracts",
      }) : null,
      providerNegotiation: Object.freeze({
        literalState: literalProviderNegotiation.state ?? "unknown",
        commentState: commentProviderAcceptance.state ?? "unknown",
        literalReady: literalProviderNegotiation.handoff?.ready !== false,
        commentReady: commentProviderAcceptance.handoff?.ready !== false,
        requestedCapabilities: Object.freeze(literalProviderNegotiation.requestedCapabilities ?? []),
        missingCapabilities: Object.freeze(literalProviderNegotiation.missingCapabilities ?? []),
        nextAction: literalProviderNegotiation.handoff?.ready === false
          ? literalProviderNegotiation.handoff.nextAction
          : commentProviderAcceptance.handoff?.ready === false
            ? commentProviderAcceptance.handoff.nextAction
            : "handoff_mailchimp_provider_negotiation",
      }),
      clientActionQueues: Object.freeze({
        comment: Object.freeze({
          revision: commentClientActionQueue.revision ?? "",
          ready: commentClientActionQueue.handoff?.ready !== false,
          rows: commentClientActionQueue.counters?.rows ?? 0,
          blocked: commentClientActionQueue.counters?.blocked ?? 0,
          nextAction: commentClientActionQueue.handoff?.nextAction ?? "adopt_comment_client_actions",
        }),
        literal: Object.freeze({
          revision: literalClientActionQueue.revision ?? "",
          ready: literalClientActionQueue.handoff?.ready !== false,
          rows: literalClientActionQueue.counters?.rows ?? 0,
          blocked: literalClientActionQueue.counters?.blocked ?? 0,
          nextAction: literalClientActionQueue.handoff?.nextAction ?? "adopt_literal_client_actions",
        }),
      }),
      workflowHandoffs: Object.freeze({
        comment: Object.freeze({
          revision: commentWorkflowHandoff.revision ?? "",
          ready: commentWorkflowHandoff.handoff?.ready !== false,
          state: commentWorkflowHandoff.state ?? "unknown",
          rows: commentWorkflowHandoff.preview?.counters?.rows ?? 0,
          blocked: commentWorkflowHandoff.preview?.counters?.blocked ?? 0,
          checkpoint: commentWorkflowHandoff.handoff?.checkpoint ?? "",
          statusChannel: commentWorkflowHandoff.handoff?.statusChannel ?? "",
          nextAction: commentWorkflowHandoff.handoff?.nextAction ?? "handoff_comment_workflow",
        }),
        literal: Object.freeze({
          revision: literalWorkflowHandoff.revision ?? "",
          ready: literalWorkflowHandoff.handoff?.ready !== false,
          state: literalWorkflowHandoff.state ?? "unknown",
          rows: literalWorkflowHandoff.preview?.counters?.rows ?? 0,
          blocked: literalWorkflowHandoff.preview?.counters?.blocked ?? 0,
          checkpoint: literalWorkflowHandoff.handoff?.checkpoint ?? "",
          statusChannel: literalWorkflowHandoff.handoff?.statusChannel ?? "",
          nextAction: literalWorkflowHandoff.handoff?.nextAction ?? "handoff_literal_workflow",
        }),
      }),
      deployment: Object.freeze({
        commentRevision: commentDeployment.revision ?? "",
        literalRevision: literalDeployment.revision ?? "",
        commentReady: commentDeployment.handoff?.ready !== false,
        literalReady: literalDeployment.handoff?.ready !== false,
        commentBlockers: Object.freeze(commentDeployment.blockers ?? []),
        literalBlockers: Object.freeze(literalDeployment.blockers ?? []),
        nextAction: commentDeployment.handoff?.ready === false
          ? commentDeployment.handoff.nextAction
          : literalDeployment.handoff?.ready === false
            ? literalDeployment.handoff.nextAction
            : "adopt_mailchimp_deployment_gate",
      }),
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
      permissionEnvelopeReady: permissionEnvelope.auditHandoffReady !== false,
      permissionEnvelopeState: permissionEnvelope.state ?? "unknown",
      permissionEnvelopeNextAction: permissionEnvelope.statusPatch?.nextAction ?? "handoff_permission_audit",
      boundaryNextAction: boundaryScope.nextAction,
      commentExportReady: comments.exportSummary?.exportReady !== false,
      commentExportPackageReady: commentExportPackage.handoff?.ready !== false,
      literalExportPackageReady: literalExportPackage.handoff?.ready !== false,
      literalReleaseReportReady: literalReleaseReport.handoff?.ready !== false,
      literalClientReadinessReady: literalClientReadiness.handoff?.ready !== false,
      literalAnalyticsExportJournalReady: literalAnalyticsJournal.handoff?.ready !== false,
      literalPreviewAcceptanceReady: literalPreviewAcceptance.handoff?.ready !== false,
      literalPreviewAcceptanceState: literalPreviewAcceptance.state ?? "unknown",
      literalProviderNegotiationReady: literalProviderNegotiation.handoff?.ready !== false,
      commentProviderAcceptanceReady: commentProviderAcceptance.handoff?.ready !== false,
      commentClientActionQueueReady: commentClientActionQueue.handoff?.ready !== false,
      literalClientActionQueueReady: literalClientActionQueue.handoff?.ready !== false,
      commentClientActionRows: commentClientActionQueue.counters?.rows ?? 0,
      literalClientActionRows: literalClientActionQueue.counters?.rows ?? 0,
      commentWorkflowHandoffReady: commentWorkflowHandoff.handoff?.ready !== false,
      literalWorkflowHandoffReady: literalWorkflowHandoff.handoff?.ready !== false,
      commentWorkflowHandoffRows: commentWorkflowHandoff.preview?.counters?.rows ?? 0,
      literalWorkflowHandoffRows: literalWorkflowHandoff.preview?.counters?.rows ?? 0,
      commentDeploymentReady: commentDeployment.handoff?.ready !== false,
      literalDeploymentReady: literalDeployment.handoff?.ready !== false,
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

function buildMailchimpWorkflowHandoff(comments, literalContracts, runtimeAdoption, acceptance, recoveryStatus) {
  const commentWorkflow = comments.workflowHandoff ?? {};
  const literalWorkflow = literalContracts.workflowHandoff ?? {};
  const rows = Object.freeze([
    ...(commentWorkflow.preview?.rows ?? []).map((row) => Object.freeze({
      source: "comment",
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(literalWorkflow.preview?.rows ?? []).map((row) => Object.freeze({
      source: "literal",
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(recoveryStatus.userVisibleWorkflow?.nextSteps ?? []).map((step) => Object.freeze({
      source: "recovery",
      subject: step.subject,
      state: step.restartSafe ? "queued" : "blocked",
      checkpoint: recoveryStatus.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: recoveryStatus.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      restartSafe: step.restartSafe === true,
      localOnly: recoveryStatus.localOnly !== false,
      writesExternalSystem: recoveryStatus.writesExternalSystem === true,
      nextAction: step.action,
    })),
  ].sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
  const blocked = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const review = rows.filter((row) => row.state === "review");
  const ready = blocked.length === 0
    && acceptance.accepted === true
    && runtimeAdoption.handoff.ready === true
    && commentWorkflow.handoff?.ready !== false
    && literalWorkflow.handoff?.ready !== false
    && recoveryStatus.restartSafe === true;
  const checkpoint = runtimeAdoption.handoff.checkpoint
    || commentWorkflow.handoff?.checkpoint
    || literalWorkflow.handoff?.checkpoint
    || recoveryStatus.handoff?.checkpoint
    || "mailchimp:workflow";
  const statusChannel = runtimeAdoption.handoff.statusChannel
    || commentWorkflow.handoff?.statusChannel
    || literalWorkflow.handoff?.statusChannel
    || recoveryStatus.handoff?.statusChannel
    || "mailchimp.contract.status";
  const nextAction = blocked[0]?.nextAction
    ?? (review.length > 0 ? "review_mailchimp_workflow_handoff" : "accept_mailchimp_workflow_handoff");

  return Object.freeze({
    schema: "aios.symbol-table.mailchimp-workflow-handoff.v1",
    revision: stableReportRevision([
      "workflow-handoff",
      commentWorkflow.revision ?? "comment:none",
      literalWorkflow.revision ?? "literal:none",
      recoveryStatus.handoff?.statusLedgerRevision ?? "recovery:none",
      rows.length,
      blocked.length,
    ]),
    ready,
    state: ready ? "ready" : blocked.length > 0 ? "blocked" : "review",
    checkpoint,
    statusChannel,
    preview: Object.freeze({
      title: "Mailchimp workflow handoff",
      rows,
      counters: Object.freeze({
        rows: rows.length,
        commentRows: rows.filter((row) => row.source === "comment").length,
        literalRows: rows.filter((row) => row.source === "literal").length,
        recoveryRows: rows.filter((row) => row.source === "recovery").length,
        blocked: blocked.length,
        review: review.length,
        externalWrites: rows.filter((row) => row.writesExternalSystem).length,
        restartSafe: rows.filter((row) => row.restartSafe).length,
      }),
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || !acceptance.accepted,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && rows.some((row) => row.writesExternalSystem),
      blockedBy: Object.freeze([
        ...blocked.map((row) => `${row.source}:${row.subject}:${row.nextAction}`),
        ...acceptance.blockers.map((blocker) => `acceptance:${blocker}`),
      ].sort()),
      nextAction,
    }),
    nextSteps: Object.freeze((blocked.length > 0 ? blocked : review).map((row, index) => Object.freeze({
      order: index + 1,
      action: row.nextAction,
      subject: row.subject,
      source: row.source,
      restartSafe: row.restartSafe,
    }))),
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction,
    }),
  });
}

function buildMailchimpDeploymentGate(comments, literalContracts, runtimeAdoption, acceptance, recoveryStatus, reconciliation = null) {
  const commentDeployment = comments.deploymentIntent ?? {};
  const literalDeployment = literalContracts.deploymentPlan ?? {};
  const commentBlockers = Object.freeze(commentDeployment.blockers ?? []);
  const literalBlockers = Object.freeze(literalDeployment.blockers ?? []);
  const blockers = Object.freeze([
    ...commentBlockers.map((blocker) => `comment:${blocker}`),
    ...literalBlockers.map((blocker) => `literal:${blocker}`),
    ...(!acceptance.accepted ? acceptance.blockers.map((blocker) => `acceptance:${blocker}`) : []),
    ...(recoveryStatus.restartSafe ? [] : ["recovery:not_restart_safe"]),
    ...(reconciliation?.handoff?.ready === false ? [`surface:${reconciliation.handoff.nextAction}`] : []),
  ].sort());
  const checkpoint = runtimeAdoption.handoff.checkpoint
    || commentDeployment.handoff?.checkpoint
    || literalDeployment.handoff?.checkpoint
    || "mailchimp:deployment";
  const statusChannel = runtimeAdoption.handoff.statusChannel
    || commentDeployment.handoff?.statusChannel
    || literalDeployment.handoff?.statusChannel
    || "mailchimp.contract.status";
  const ready = blockers.length === 0
    && runtimeAdoption.handoff.ready === true
    && commentDeployment.handoff?.ready !== false
    && literalDeployment.handoff?.ready !== false;
  const nextAction = ready
    ? "adopt_mailchimp_deployment_gate"
    : commentDeployment.handoff?.ready === false
      ? commentDeployment.handoff.nextAction
      : literalDeployment.handoff?.ready === false
        ? literalDeployment.handoff.nextAction
        : acceptance.nextAction || recoveryStatus.nextAction;

  return Object.freeze({
    schema: "aios.symbol-table.mailchimp-deployment-gate.v1",
    revision: stableReportRevision([
      "deployment",
      commentDeployment.revision ?? "comment:none",
      literalDeployment.revision ?? "literal:none",
      runtimeAdoption.handoff.checkpoint,
      blockers.length,
    ]),
    ready,
    state: ready ? "ready" : recoveryStatus.state === "recovering" ? "recovering" : "blocked",
    checkpoint,
    statusChannel,
    surfaces: Object.freeze({
      comment: Object.freeze({
        ready: commentDeployment.handoff?.ready !== false,
        revision: commentDeployment.revision ?? "",
        controls: commentDeployment.counters?.controls ?? 0,
        blockedControls: commentDeployment.counters?.blockedControls ?? 0,
        blockers: commentBlockers,
        nextAction: commentDeployment.handoff?.nextAction ?? "adopt_comment_deployment_intent",
      }),
      literal: Object.freeze({
        ready: literalDeployment.handoff?.ready !== false,
        revision: literalDeployment.revision ?? "",
        controls: literalDeployment.counters?.controls ?? 0,
        blockedControls: literalDeployment.counters?.blockedControls ?? 0,
        blockers: literalBlockers,
        nextAction: literalDeployment.handoff?.nextAction ?? "adopt_literal_deployment_plan",
      }),
    }),
    blockers,
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: commentDeployment.handoff?.localOnly !== false && literalDeployment.handoff?.localOnly !== false,
      writesExternalSystem: commentDeployment.handoff?.writesExternalSystem === true || literalDeployment.handoff?.writesExternalSystem === true,
      nextAction,
    }),
    client: Object.freeze({
      userVisibleState: ready ? "queued" : "needs-attention",
      acceptanceRequired: !ready,
      nextAction,
    }),
  });
}

function buildMailchimpSyncBridge(comments, literalContracts, recoveryStatus, negotiation, reconciliation = null) {
  const commentBridge = comments.syncPreview ?? {};
  const literalBridge = literalContracts.syncBridge ?? {};
  const commentRows = (commentBridge.preview?.providerRows ?? []).map((row) => Object.freeze({
    source: "comment",
    subject: `${row.field}:${row.value}`,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    nextAction: row.nextAction,
  }));
  const literalRows = (literalBridge.providers ?? []).map((row) => Object.freeze({
    source: "literal",
    subject: `${row.key}:${row.adapter}`,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe !== false,
    writesExternalSystem: row.externalWriteAllowed === true,
    nextAction: row.nextAction,
  }));
  const commentCommit = comments.providerCommitWindow ?? {};
  const literalCommit = literalContracts.providerCommitWindow ?? {};
  const commentCommitRows = (commentCommit.providerRows ?? []).map((row) => Object.freeze({
    source: "comment-commit",
    subject: `${row.field}:${row.value}`,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    nextAction: row.nextAction,
  }));
  const literalCommitRows = (literalCommit.rows ?? []).map((row) => Object.freeze({
    source: "literal-commit",
    subject: `${row.sourceKey}:${row.adapter}`,
    state: row.state,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    nextAction: row.nextAction,
  }));
  const rows = Object.freeze([...commentRows, ...literalRows, ...commentCommitRows, ...literalCommitRows]
    .sort((left, right) => `${left.source}:${left.subject}`.localeCompare(`${right.source}:${right.subject}`)));
  const commentCapabilities = new Set(comments.providerContract?.requestedCapabilities ?? []);
  const literalCapabilities = new Set([
    ...(literalContracts.providerContracts?.requestedCapabilities ?? []),
    ...(literalContracts.workflowControls?.mailchimpScopes ?? []),
  ]);
  const missingFromLiteral = Object.freeze(Array.from(commentCapabilities).filter((capability) => !literalCapabilities.has(capability)).sort());
  const missingFromComment = Object.freeze(Array.from(literalCapabilities).filter((capability) => !commentCapabilities.has(capability)).sort());
  const statusChannels = Object.freeze(Array.from(new Set([
    commentBridge.handoff?.statusChannel,
    literalBridge.handoff?.statusChannel,
    recoveryStatus.handoff?.statusChannel,
    ...rows.map((row) => row.statusChannel),
  ].filter(Boolean))).sort());
  const checkpoints = Object.freeze(Array.from(new Set([
    commentBridge.handoff?.checkpoint,
    literalBridge.handoff?.checkpoint,
    recoveryStatus.handoff?.checkpoint,
    ...rows.map((row) => row.checkpoint),
  ].filter(Boolean))).sort());
  const blockers = Object.freeze([
    ...(commentBridge.acceptance?.blockedBy ?? []).map((blocker) => `comment:${blocker}`),
    ...(commentCommit.acceptance?.blockedBy ?? []).map((blocker) => `comment-commit:${blocker}`),
    ...(literalBridge.blockers ?? []).map((blocker) => `literal:${blocker}`),
    ...(literalCommit.blockers ?? []).map((blocker) => `literal-commit:${blocker}`),
    ...(rows.filter((row) => row.state === "blocked" || !row.restartSafe).map((row) => `${row.source}:${row.subject}:${row.nextAction}`)),
    ...(reconciliation?.handoff?.ready === false ? [`surface:${reconciliation.handoff.nextAction}`] : []),
  ].sort());
  const review = Object.freeze([
    ...(literalBridge.review ?? []).map((item) => `literal:${item}`),
    ...(commentCommit.acceptance?.review ?? []).map((item) => `comment-commit:${item}`),
    ...(literalCommit.review ?? []).map((item) => `literal-commit:${item}`),
    ...(commentBridge.acceptance?.required && commentBridge.handoff?.writesExternalSystem ? ["comment:external-sync"] : []),
    ...(missingFromLiteral.length > 0 ? [`capability:literal:${missingFromLiteral.length}`] : []),
    ...(missingFromComment.length > 0 ? [`capability:comment:${missingFromComment.length}`] : []),
  ].sort());
  const ready = blockers.length === 0
    && commentBridge.handoff?.ready !== false
    && literalBridge.handoff?.ready !== false
    && commentCommit.handoff?.ready !== false
    && literalCommit.handoff?.ready !== false
    && recoveryStatus.externalHandoff?.handoff?.ready !== false;
  const nextAction = blockers.length > 0
    ? "reconcile_mailchimp_sync_bridge"
    : review.length > 0 ? "review_mailchimp_sync_bridge" : "adopt_mailchimp_sync_bridge";

  return Object.freeze({
    schema: "aios.symbol-table.mailchimp-sync-bridge.v1",
    revision: stableReportRevision([
      "sync-bridge",
      commentBridge.readiness?.checkpoint ?? "comment:none",
      literalBridge.handoff?.checkpoint ?? "literal:none",
      recoveryStatus.externalHandoff?.handoff?.checkpoint ?? "recovery:none",
      blockers.length,
      review.length,
    ]),
    state: blockers.length > 0 ? "blocked" : review.length > 0 ? "review" : ready ? "ready" : "warming",
    ready,
    rows,
    capabilities: Object.freeze({
      comment: Object.freeze(Array.from(commentCapabilities).sort()),
      literal: Object.freeze(Array.from(literalCapabilities).sort()),
      missingFromLiteral,
      missingFromComment,
      negotiated: negotiation.negotiated === true && missingFromLiteral.length === 0 && missingFromComment.length === 0,
    }),
    checkpoints,
    statusChannels,
    blockers,
    review,
    handoff: Object.freeze({
      ready,
      checkpoint: checkpoints[0] || "mailchimp:sync",
      statusChannel: statusChannels[0] || "mailchimp.contract.status",
      localOnly: commentBridge.handoff?.localOnly !== false && literalBridge.handoff?.localOnly !== false,
      writesExternalSystem: commentBridge.handoff?.writesExternalSystem === true
        || literalBridge.handoff?.writesExternalSystem === true
        || commentCommit.handoff?.writesExternalSystem === true
        || literalCommit.handoff?.writesExternalSystem === true,
      nextAction,
    }),
    commitWindow: Object.freeze({
      commentReady: commentCommit.handoff?.ready !== false,
      literalReady: literalCommit.handoff?.ready !== false,
      commentRows: commentCommitRows.length,
      literalRows: literalCommitRows.length,
      externalWrites: [...commentCommitRows, ...literalCommitRows].filter((row) => row.writesExternalSystem).length,
      blockedBy: Object.freeze([
        ...(commentCommit.acceptance?.blockedBy ?? []).map((blocker) => `comment:${blocker}`),
        ...(literalCommit.blockers ?? []).map((blocker) => `literal:${blocker}`),
      ].sort()),
      nextAction: commentCommit.handoff?.ready === false
        ? commentCommit.handoff.nextAction
        : literalCommit.handoff?.ready === false
          ? literalCommit.handoff.nextAction
          : "handoff_mailchimp_provider_commit_window",
    }),
  });
}

function buildMailchimpNegotiation(comments, literalContracts) {
  const commentProvider = comments.providerContract ?? {};
  const literalProviders = literalContracts.providerContracts ?? {};
  const literalNegotiation = literalContracts.providerNegotiation ?? {};
  const commentAcceptance = comments.providerAcceptance ?? {};
  const requested = Array.from(new Set([
    ...(commentProvider.requestedCapabilities ?? []),
    ...(literalProviders.requestedCapabilities ?? []),
    ...(literalNegotiation.requestedCapabilities ?? []),
    ...(literalContracts.workflowControls?.mailchimpScopes ?? []),
  ].filter(Boolean))).sort();
  const providerCapabilities = new Set([
    ...(commentProvider.requestedCapabilities ?? []),
    ...(literalProviders.requestedCapabilities ?? []),
  ]);
  const missingFromProvider = Array.from(new Set([
    ...requested.filter((capability) => !providerCapabilities.has(capability)),
    ...(literalNegotiation.missingCapabilities ?? []),
  ])).sort();
  const externalWriteRequested = commentProvider.sync?.externalWriteRequested === true
    || literalProviders.sync?.externalWriteRequested === true
    || literalNegotiation.sync?.externalWriteRequested === true
    || commentAcceptance.acceptance?.required === true && commentAcceptance.handoff?.writesExternalSystem === true;
  const externalWriteAllowed = commentProvider.sync?.externalWriteAllowed === true
    || literalProviders.sync?.externalWriteAllowed === true
    || literalNegotiation.sync?.externalWriteAllowed === true
    || commentAcceptance.acceptance?.acceptedForExternalWrite === true;
  const blockers = Object.freeze([
    ...missingFromProvider.map((capability) => `capability:${capability}`),
    ...(literalNegotiation.blockers ?? []).map((blocker) => `literal:${blocker}`),
    ...(commentAcceptance.acceptance?.blockedBy ?? []).map((blocker) => `comment:${blocker}`),
  ].sort());
  const review = Object.freeze([
    ...(literalNegotiation.review ?? []).map((item) => `literal:${item}`),
    ...(commentAcceptance.acceptance?.review ?? []).map((item) => `comment:${item}`),
  ].sort());

  return Object.freeze({
    schema: "aios.symbol-table.mailchimp-negotiation.v1",
    requestedCapabilities: Object.freeze(requested),
    missingFromProvider: Object.freeze(missingFromProvider),
    negotiated: blockers.length === 0
      && literalNegotiation.handoff?.ready !== false
      && commentAcceptance.handoff?.ready !== false,
    blockers,
    review,
    sync: Object.freeze({
      externalWriteRequested,
      externalWriteAllowed,
      localOnly: !externalWriteAllowed,
      checkpoints: Object.freeze(Array.from(new Set([
        ...(literalProviders.sync?.checkpoints ?? []),
        ...(literalNegotiation.sync?.checkpoints ?? []),
        commentProvider.sync?.checkpoint,
        commentAcceptance.handoff?.checkpoint,
      ].filter(Boolean))).sort()),
    }),
    nextAction: blockers.length > 0
      ? blockers[0].split(":").slice(2).join(":") || "repair_mailchimp_provider_negotiation"
      : review.length > 0 ? "review_mailchimp_provider_negotiation"
      : missingFromProvider.length > 0
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

function statusLedgerSnapshot(source, ledger = {}) {
  const rows = Object.freeze((ledger.rows ?? []).map((row) => Object.freeze({
    source,
    rowId: row.rowId,
    commandId: row.commandId,
    type: row.type ?? row.field ?? row.phase ?? "status",
    subject: row.key ?? row.field ?? row.action ?? row.commandId,
    expectedState: row.expectedState,
    persistedState: row.persistedState,
    checkpoint: row.checkpoint,
    statusChannel: row.statusChannel,
    restartSafe: row.restartSafe === true,
    drifted: row.drifted === true,
    writesExternalSystem: row.writesExternalSystem === true,
    nextAction: row.nextAction,
  })));
  const drifted = rows.filter((row) => row.drifted || !row.restartSafe);
  return Object.freeze({
    schema: "aios.symbol-table.status-ledger-snapshot.v1",
    source,
    revision: ledger.revision ?? `${source}:ledger:none`,
    state: ledger.state ?? "unknown",
    checkpoint: ledger.checkpoint ?? ledger.handoff?.checkpoint ?? "",
    statusChannel: ledger.statusChannel ?? ledger.handoff?.statusChannel ?? "",
    ready: ledger.handoff?.ready !== false && drifted.length === 0,
    rows,
    blockers: Object.freeze([
      ...(ledger.blockers ?? []),
      ...drifted.map((row) => `${source}:${row.commandId}`),
    ].filter(Boolean).sort()),
    counters: Object.freeze({
      rows: rows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      drifted: drifted.length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    nextAction: drifted[0]?.nextAction ?? ledger.handoff?.nextAction ?? `persist_${source}_status_ledger`,
  });
}

function buildCombinedStatusLedger(comments, literalContracts, recoveryStatus, runtimeAdoption) {
  const snapshots = Object.freeze([
    statusLedgerSnapshot("comment", comments.runtimeState?.statusLedger),
    statusLedgerSnapshot("literal", literalContracts.runtimeState?.statusLedger),
    statusLedgerSnapshot("recovery", recoveryStatus.statusLedger),
  ]);
  const rows = Object.freeze(snapshots.flatMap((snapshot) => snapshot.rows));
  const blockers = Object.freeze(snapshots.flatMap((snapshot) => snapshot.blockers).filter(Boolean).sort());
  const checkpoints = Object.freeze(Array.from(new Set([
    runtimeAdoption.handoff?.checkpoint,
    ...snapshots.map((snapshot) => snapshot.checkpoint),
    ...rows.map((row) => row.checkpoint),
  ].filter(Boolean))).sort());
  const statusChannels = Object.freeze(Array.from(new Set([
    runtimeAdoption.handoff?.statusChannel,
    ...snapshots.map((snapshot) => snapshot.statusChannel),
    ...rows.map((row) => row.statusChannel),
  ].filter(Boolean))).sort());
  const ready = snapshots.every((snapshot) => snapshot.ready) && blockers.length === 0;

  return Object.freeze({
    schema: "aios.symbol-table.combined-status-ledger.v1",
    revision: stableReportRevision([
      "status-ledger",
      ...snapshots.map((snapshot) => snapshot.revision),
      blockers.length,
      rows.length,
    ]),
    state: ready ? "ready" : blockers.length > 0 ? "blocked" : "review",
    ready,
    snapshots,
    rows,
    checkpoints,
    statusChannels,
    blockers,
    counters: Object.freeze({
      rows: rows.length,
      commentRows: snapshots.find((snapshot) => snapshot.source === "comment")?.counters.rows ?? 0,
      literalRows: snapshots.find((snapshot) => snapshot.source === "literal")?.counters.rows ?? 0,
      recoveryRows: snapshots.find((snapshot) => snapshot.source === "recovery")?.counters.rows ?? 0,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      drifted: rows.filter((row) => row.drifted || !row.restartSafe).length,
      externalWrites: rows.filter((row) => row.writesExternalSystem).length,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint: checkpoints[0] || runtimeAdoption.handoff?.checkpoint || "mailchimp:status-ledger",
      statusChannel: statusChannels[0] || runtimeAdoption.handoff?.statusChannel || "mailchimp.contract.status",
      localOnly: rows.every((row) => !row.writesExternalSystem),
      writesExternalSystem: rows.some((row) => row.writesExternalSystem),
      nextAction: blockers.length > 0
        ? snapshots.find((snapshot) => snapshot.blockers.length > 0)?.nextAction ?? "repair_mailchimp_status_ledger"
        : "persist_mailchimp_status_ledger",
    }),
  });
}

function buildPersistedMailchimpState(tableParts) {
  const { symbols, literalContracts, comments, runtimeAdoption, recoveryStatus, acceptance, negotiation, reconciliation, deploymentGate, syncBridge } = tableParts;
  const recoveryPersistence = recoveryStatus.persistence ?? {};
  const commentRuntime = comments.runtimeState ?? {};
  const commentExport = comments.exportSummary ?? {};
  const commentExportPackage = comments.exportPackage ?? {};
  const literalRuntime = literalContracts.runtimeState ?? {};
  const literalHealth = literalContracts.operationalHealth ?? {};
  const literalExportPackage = literalContracts.exportPackage ?? {};
  const literalReleaseReport = literalContracts.releaseReport ?? {};
  const literalClientReadiness = literalContracts.clientReadiness ?? {};
  const literalResumeManifest = literalContracts.resumeManifest ?? {};
  const literalRestartDigest = literalContracts.restartDigest ?? {};
  const literalProviderNegotiation = literalContracts.providerNegotiation ?? {};
  const commentProviderAcceptance = comments.providerAcceptance ?? {};
  const literalProviderCommitWindow = literalContracts.providerCommitWindow ?? {};
  const commentProviderCommitWindow = comments.providerCommitWindow ?? {};
  const commentRecoveryAdoption = comments.recoveryAdoption ?? {};
  const literalRecoveryAdoption = literalContracts.recoveryAdoption ?? {};
  const literalBoundary = literalContracts.boundaryContract ?? {};
  const permissionEnvelope = literalBoundary.permissionEnvelope ?? {};
  const permissionMatrix = permissionEnvelope.permissionMatrix ?? {};
  const tenantBoundaryLease = literalBoundary.tenantBoundaryLease ?? {};
  const statusLedger = buildCombinedStatusLedger(comments, literalContracts, recoveryStatus, runtimeAdoption);
  const revisionParts = [
    symbols.length,
    literalContracts.history?.revision ?? "literal:0",
    comments.directives?.length ?? 0,
    commentRuntime.revision ?? "comment-runtime:none",
    literalRuntime.revision ?? "literal-runtime:none",
    literalReleaseReport.revision ?? "literal-release:none",
    literalClientReadiness.preview?.previewId ?? "literal-client:none",
    literalResumeManifest.revision ?? "literal-resume:none",
    literalRestartDigest.revision ?? "literal-restart:none",
    runtimeAdoption.handoff.checkpoint,
    deploymentGate?.revision ?? "deployment:none",
    syncBridge?.revision ?? "sync:none",
    commentRecoveryAdoption.revision ?? "comment-recovery-adoption:none",
    literalRecoveryAdoption.revision ?? "literal-recovery-adoption:none",
    statusLedger.revision,
    reconciliation?.revision ?? "surface:none",
    literalBoundary.handoff?.workspace ?? "global",
    literalBoundary.handoff?.tenant ?? "tenant:none",
    literalBoundary.handoff?.role ?? "role:none",
    tenantBoundaryLease.leaseId ?? "tenant-lease:none",
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
      idempotencyKey: stableReportRevision(["idempotent", "provider", command, runtimeAdoption.handoff.checkpoint]),
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
      idempotencyKey: stableReportRevision(["idempotent", "provider-negotiate", negotiation.requestedCapabilities.join("+")]),
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
  const permissionCommands = Object.freeze((permissionEnvelope.auditRows ?? []).map((row, index) => Object.freeze({
    id: `permission:audit:${runtimeAdoption.handoff.checkpoint}:${index + 1}:${row.type}:${stableReportRevision([row.subject])}`,
    type: "aios.boundary.permission-audit",
    action: row.nextAction,
    subject: row.subject,
    boundaryType: row.type,
    checkpoint: runtimeAdoption.handoff.checkpoint,
    statusChannel: runtimeAdoption.handoff.statusChannel,
    idempotencyKey: `permission:${row.type}:${stableReportRevision([row.subject])}:${runtimeAdoption.handoff.checkpoint}`,
    idempotent: true,
    restartSafe: row.restartSafe === true && permissionEnvelope.auditHandoffReady !== false,
    localOnly: permissionEnvelope.localOnly !== false,
    writesExternalSystem: permissionEnvelope.externalWriteAllowed === true && row.state !== "blocked",
    state: row.state,
    statusPatch: Object.freeze({
      state: row.state === "audit-ready" || row.state === "local-ready" ? "queued" : row.state,
      nextAction: row.nextAction,
      message: `Permission audit ${row.subject} is ${row.state}.`,
    }),
  })));
  const permissionMatrixCommands = Object.freeze((permissionMatrix.rows ?? []).map((row, index) => Object.freeze({
    id: `permission:matrix:${runtimeAdoption.handoff.checkpoint}:${index + 1}:${stableReportRevision([row.decisionId])}`,
    type: "aios.boundary.permission-matrix",
    action: row.nextAction,
    subject: row.resource,
    principal: row.principal,
    capability: row.capability,
    checkpoint: runtimeAdoption.handoff.checkpoint,
    statusChannel: runtimeAdoption.handoff.statusChannel,
    idempotencyKey: row.idempotencyKey || `permission-matrix:${stableReportRevision([row.decisionId])}:${runtimeAdoption.handoff.checkpoint}`,
    idempotent: true,
    restartSafe: row.restartSafe === true && permissionMatrix.handoff?.restartSafe !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true && permissionMatrix.handoff?.writesExternalSystem === true,
    state: row.state,
    statusPatch: Object.freeze({
      state: row.state === "local-ready" || row.state === "external-ready" ? "queued" : row.state,
      nextAction: row.nextAction,
      message: row.reason,
    }),
  })));
  const tenantLeaseCommands = Object.freeze((tenantBoundaryLease.rows ?? []).map((row, index) => Object.freeze({
    id: `tenant-boundary-lease:${tenantBoundaryLease.leaseId ?? runtimeAdoption.handoff.checkpoint}:${index + 1}:${row.type}:${stableReportRevision([row.subject])}`,
    type: "aios.boundary.tenant-lease",
    action: row.nextAction,
    subject: row.subject,
    boundaryType: row.type,
    checkpoint: row.checkpoint || tenantBoundaryLease.handoff?.checkpoint || runtimeAdoption.handoff.checkpoint,
    statusChannel: row.statusChannel || tenantBoundaryLease.handoff?.statusChannel || runtimeAdoption.handoff.statusChannel,
    idempotencyKey: row.idempotencyKey || `tenant-boundary-lease:${row.type}:${stableReportRevision([row.subject])}`,
    idempotent: true,
    restartSafe: row.restartSafe === true && tenantBoundaryLease.handoff?.ready !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true && tenantBoundaryLease.handoff?.writesExternalSystem === true,
    state: row.state,
    statusPatch: Object.freeze({
      state: row.state === "leased" || row.state === "scoped" || row.state === "granted" ? "queued" : row.state,
      nextAction: row.nextAction,
      message: `Tenant boundary lease ${row.type}:${row.subject} is ${row.state}.`,
    }),
  })));
  const syncBridgeCommands = Object.freeze((syncBridge?.rows ?? []).map((row, index) => Object.freeze({
    id: `sync-bridge:${syncBridge.revision}:${index + 1}:${row.source}:${stableReportRevision([row.subject])}`,
    type: "aios.mailchimp.sync-bridge.handoff",
    action: row.nextAction,
    subject: row.subject,
    checkpoint: row.checkpoint || syncBridge.handoff?.checkpoint || runtimeAdoption.handoff.checkpoint,
    statusChannel: row.statusChannel || syncBridge.handoff?.statusChannel || runtimeAdoption.handoff.statusChannel,
    idempotencyKey: `sync-bridge:${row.source}:${stableReportRevision([row.subject])}:${syncBridge.revision}`,
    idempotent: true,
    restartSafe: row.restartSafe === true && syncBridge.handoff?.ready !== false,
    localOnly: syncBridge.handoff?.localOnly !== false,
    writesExternalSystem: syncBridge.handoff?.writesExternalSystem === true && row.writesExternalSystem === true,
    state: row.state,
    statusPatch: Object.freeze({
      state: row.state === "ready" ? "queued" : row.state,
      nextAction: row.nextAction,
      message: `${row.source} sync bridge ${row.subject} is ${row.state}.`,
    }),
  })));
  const providerNegotiationCommands = Object.freeze([
    ...(literalProviderNegotiation.providers ?? []).map((row, index) => Object.freeze({
      id: `literal-provider-negotiation:${literalProviderNegotiation.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint}:${index + 1}:${row.sourceKey}:${row.adapter}`,
      type: "aios.literal.provider-negotiation.handoff",
      action: row.nextAction,
      subject: `${row.sourceKey}:${row.adapter}`,
      checkpoint: row.checkpoint || literalProviderNegotiation.handoff?.checkpoint || runtimeAdoption.handoff.checkpoint,
      statusChannel: row.statusChannel || literalProviderNegotiation.handoff?.statusChannel || runtimeAdoption.handoff.statusChannel,
      idempotencyKey: row.idempotencyKey || `literal-provider-negotiation:${row.sourceKey}:${row.adapter}`,
      idempotent: true,
      restartSafe: row.restartSafe === true && literalProviderNegotiation.handoff?.ready !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.externalWriteAllowed === true && literalProviderNegotiation.handoff?.writesExternalSystem === true,
      state: row.state,
      statusPatch: Object.freeze({
        state: row.state === "negotiated" ? "queued" : row.state,
        nextAction: row.nextAction,
        message: `Literal provider negotiation ${row.sourceKey} is ${row.state}.`,
      }),
    })),
    ...(commentProviderAcceptance.preview?.providerRows ?? []).map((row, index) => Object.freeze({
      id: `comment-provider-acceptance:${commentProviderAcceptance.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint}:${index + 1}:${row.field}:${stableReportRevision([row.value])}`,
      type: "aios.comment.provider-acceptance.handoff",
      action: row.nextAction,
      subject: `${row.field}:${row.value}`,
      checkpoint: row.checkpoint || commentProviderAcceptance.handoff?.checkpoint || runtimeAdoption.handoff.checkpoint,
      statusChannel: row.statusChannel || commentProviderAcceptance.handoff?.statusChannel || runtimeAdoption.handoff.statusChannel,
      idempotencyKey: row.idempotencyKey || `comment-provider-acceptance:${row.field}:${stableReportRevision([row.value])}`,
      idempotent: true,
      restartSafe: row.restartSafe === true && commentProviderAcceptance.handoff?.ready !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true && commentProviderAcceptance.handoff?.writesExternalSystem === true,
      state: row.state,
      statusPatch: Object.freeze({
        state: row.state === "accepted" ? "queued" : row.state,
        nextAction: row.nextAction,
        message: `Comment provider acceptance ${row.field} is ${row.state}.`,
      }),
    })),
  ].sort((left, right) => left.id.localeCompare(right.id)));
  const providerCommitCommands = Object.freeze([
    ...(literalProviderCommitWindow.rows ?? []).map((row, index) => Object.freeze({
      id: `literal-provider-commit:${literalProviderCommitWindow.revision ?? "commit"}:${index + 1}:${row.sourceKey}:${row.adapter}`,
      type: "aios.literal.provider-commit-window.handoff",
      action: row.nextAction,
      subject: `${row.sourceKey}:${row.adapter}`,
      checkpoint: row.checkpoint || literalProviderCommitWindow.handoff?.checkpoint || runtimeAdoption.handoff.checkpoint,
      statusChannel: row.statusChannel || literalProviderCommitWindow.handoff?.statusChannel || runtimeAdoption.handoff.statusChannel,
      idempotencyKey: row.idempotencyKey || `literal-provider-commit:${row.sourceKey}:${row.adapter}`,
      idempotent: true,
      restartSafe: row.restartSafe === true && literalProviderCommitWindow.handoff?.ready !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true && literalProviderCommitWindow.handoff?.writesExternalSystem === true,
      state: row.state,
      statusPatch: Object.freeze({
        state: row.state === "commit-ready" || row.state === "preview-ready" ? "queued" : row.state,
        nextAction: row.nextAction,
        message: `Literal provider commit window ${row.sourceKey} is ${row.state}.`,
      }),
    })),
    ...(commentProviderCommitWindow.providerRows ?? []).map((row, index) => Object.freeze({
      id: `comment-provider-commit:${commentProviderCommitWindow.revision ?? "commit"}:${index + 1}:${row.field}:${stableReportRevision([row.value])}`,
      type: "aios.comment.provider-commit-window.handoff",
      action: row.nextAction,
      subject: `${row.field}:${row.value}`,
      checkpoint: row.checkpoint || commentProviderCommitWindow.handoff?.checkpoint || runtimeAdoption.handoff.checkpoint,
      statusChannel: row.statusChannel || commentProviderCommitWindow.handoff?.statusChannel || runtimeAdoption.handoff.statusChannel,
      idempotencyKey: row.idempotencyKey || `comment-provider-commit:${row.field}:${stableReportRevision([row.value])}`,
      idempotent: true,
      restartSafe: row.restartSafe === true && commentProviderCommitWindow.handoff?.ready !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true && commentProviderCommitWindow.handoff?.writesExternalSystem === true,
      state: row.state,
      statusPatch: Object.freeze({
        state: row.state === "commit-ready" || row.state === "preview-ready" ? "queued" : row.state,
        nextAction: row.nextAction,
        message: `Comment provider commit window ${row.field} is ${row.state}.`,
      }),
    })),
  ].sort((left, right) => left.id.localeCompare(right.id)));
  const literalClientCommands = Object.freeze((literalClientReadiness.nextSteps ?? []).map((step) => Object.freeze({
    id: `literal-client-readiness:${literalClientReadiness.preview?.previewId ?? "preview"}:${step.order}:${stableReportRevision([step.subject])}`,
    type: "aios.literal.client-readiness.acceptance",
    action: step.action,
    subject: step.subject,
    checkpoint: literalClientReadiness.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint,
    statusChannel: literalClientReadiness.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
    idempotencyKey: `literal-client-readiness:${step.action}:${stableReportRevision([step.subject])}`,
    idempotent: true,
    restartSafe: step.restartSafe === true && literalClientReadiness.handoff?.ready !== false,
    localOnly: literalClientReadiness.handoff?.localOnly !== false,
    writesExternalSystem: literalClientReadiness.handoff?.writesExternalSystem === true,
    state: literalClientReadiness.handoff?.ready === false ? "blocked" : "ready",
    statusPatch: Object.freeze({
      state: literalClientReadiness.handoff?.ready === false ? "blocked" : "queued",
      nextAction: step.action,
      message: `Literal client readiness step ${step.subject} is ${literalClientReadiness.validationSummary?.state ?? "unknown"}.`,
    }),
  })));
  const commentClientActionCommands = Object.freeze((comments.clientActionQueue?.rows ?? []).map((row) => Object.freeze({
    id: `comment-client-action:${comments.clientActionQueue?.revision ?? "queue"}:${row.order}:${stableReportRevision([row.id])}`,
    type: "aios.comment.client-action.replay",
    action: row.action,
    subject: row.subject,
    checkpoint: row.checkpoint || comments.clientActionQueue?.handoff?.checkpoint || runtimeAdoption.handoff.checkpoint,
    statusChannel: row.statusChannel || comments.clientActionQueue?.handoff?.statusChannel || runtimeAdoption.handoff.statusChannel,
    idempotencyKey: `comment-client-action:${row.idempotencyKey || row.id}`,
    idempotent: true,
    restartSafe: row.restartSafe === true && comments.clientActionQueue?.handoff?.ready !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    state: row.state,
    statusPatch: row.statusPatch ?? Object.freeze({
      state: row.state === "queued" ? "queued" : row.state,
      nextAction: row.action,
      message: `Comment client action ${row.subject} is ${row.state}.`,
    }),
  })));
  const literalClientActionCommands = Object.freeze((literalContracts.clientActionQueue?.rows ?? []).map((row) => Object.freeze({
    id: `literal-client-action:${literalContracts.clientActionQueue?.revision ?? "queue"}:${row.order}:${stableReportRevision([row.id])}`,
    type: "aios.literal.client-action.replay",
    action: row.action,
    subject: row.subject,
    checkpoint: row.checkpoint || literalContracts.clientActionQueue?.handoff?.checkpoint || runtimeAdoption.handoff.checkpoint,
    statusChannel: row.statusChannel || literalContracts.clientActionQueue?.handoff?.statusChannel || runtimeAdoption.handoff.statusChannel,
    idempotencyKey: `literal-client-action:${row.idempotencyKey || row.id}`,
    idempotent: true,
    restartSafe: row.restartSafe === true && literalContracts.clientActionQueue?.handoff?.ready !== false,
    localOnly: row.localOnly !== false,
    writesExternalSystem: row.writesExternalSystem === true,
    state: row.state,
    statusPatch: row.statusPatch ?? Object.freeze({
      state: row.state === "queued" ? "queued" : row.state,
      nextAction: row.action,
      message: `Literal client action ${row.subject} is ${row.state}.`,
    }),
  })));
  const recoveryAdoptionCommands = Object.freeze([
    ...(commentRecoveryAdoption.rows ?? []).map((row) => Object.freeze({
      id: `comment-recovery-adoption:${commentRecoveryAdoption.revision ?? "recovery"}:${row.order}:${stableReportRevision([row.rowId])}`,
      type: "aios.comment.recovery-adoption.handoff",
      action: row.nextAction,
      subject: row.subject,
      checkpoint: row.checkpoint || commentRecoveryAdoption.handoff?.checkpoint || runtimeAdoption.handoff.checkpoint,
      statusChannel: row.statusChannel || commentRecoveryAdoption.handoff?.statusChannel || runtimeAdoption.handoff.statusChannel,
      idempotencyKey: `comment-recovery-adoption:${row.idempotencyKey || row.rowId}`,
      idempotent: true,
      restartSafe: row.restartSafe === true && commentRecoveryAdoption.handoff?.ready !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      state: row.state,
      statusPatch: Object.freeze({
        state: row.state === "recoverable" || row.state === "observed" ? "queued" : row.state,
        nextAction: row.nextAction,
        message: `Comment recovery adoption ${row.subject} is ${row.state}.`,
      }),
    })),
    ...(literalRecoveryAdoption.rows ?? []).map((row) => Object.freeze({
      id: `literal-recovery-adoption:${literalRecoveryAdoption.revision ?? "recovery"}:${row.order}:${stableReportRevision([row.rowId])}`,
      type: "aios.literal.recovery-adoption.handoff",
      action: row.nextAction,
      subject: row.subject,
      checkpoint: row.checkpoint || literalRecoveryAdoption.handoff?.checkpoint || runtimeAdoption.handoff.checkpoint,
      statusChannel: row.statusChannel || literalRecoveryAdoption.handoff?.statusChannel || runtimeAdoption.handoff.statusChannel,
      idempotencyKey: `literal-recovery-adoption:${row.idempotencyKey || row.rowId}`,
      idempotent: true,
      restartSafe: row.restartSafe === true && literalRecoveryAdoption.handoff?.ready !== false,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      state: row.state,
      statusPatch: Object.freeze({
        state: row.state === "recoverable" || row.state === "observed" ? "queued" : row.state,
        nextAction: row.nextAction,
        message: `Literal recovery adoption ${row.subject} is ${row.state}.`,
      }),
    })),
  ].sort((left, right) => left.id.localeCompare(right.id)));
  const pendingCommands = Object.freeze([
    ...providerCommands,
    ...commentCommands,
    ...literalCommands,
    ...packageCommands,
    ...recoveryCommands,
    ...boundaryCommands,
    ...permissionCommands,
    ...permissionMatrixCommands,
    ...tenantLeaseCommands,
    ...syncBridgeCommands,
    ...providerNegotiationCommands,
    ...providerCommitCommands,
    ...literalClientCommands,
    ...commentClientActionCommands,
    ...literalClientActionCommands,
    ...recoveryAdoptionCommands,
  ].sort((left, right) => left.id.localeCompare(right.id)));
  const unsafeCommandIds = pendingCommands.filter((command) => !command.restartSafe).map((command) => command.id);
  const replayState = !recoveryStatus.restartSafe
    ? "hold"
    : statusLedger.handoff.ready === false
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
    && statusLedger.handoff.ready === true
    && Boolean(resumeCheckpoint);

  return Object.freeze({
    schema: "aios.symbol-table.persisted-mailchimp-state.v1",
    revision: `mailchimp:${revisionParts.join(":")}`,
    replayState,
    checkpoint: runtimeAdoption.handoff.checkpoint,
    statusChannel: runtimeAdoption.handoff.statusChannel,
    requestedCapabilities: negotiation.requestedCapabilities,
    statusLedger,
    pendingCommands,
    commandSummary: Object.freeze({
      total: pendingCommands.length,
      provider: providerCommands.length,
      comment: commentCommands.length,
      literal: literalCommands.length,
      exportPackages: packageCommands.length,
      recovery: recoveryCommands.length,
      boundary: boundaryCommands.length,
      permission: permissionCommands.length,
      permissionMatrix: permissionMatrixCommands.length,
      tenantBoundaryLease: tenantLeaseCommands.length,
      syncBridge: syncBridgeCommands.length,
      providerNegotiation: providerNegotiationCommands.length,
      providerCommitWindow: providerCommitCommands.length,
      literalClientReadiness: literalClientCommands.length,
      commentClientActions: commentClientActionCommands.length,
      literalClientActions: literalClientActionCommands.length,
      recoveryAdoption: recoveryAdoptionCommands.length,
      restartSafe: pendingCommands.filter((command) => command.restartSafe).length,
      unsafe: unsafeCommandIds.length,
      statusLedgerRows: statusLedger.counters.rows,
      statusLedgerDrifted: statusLedger.counters.drifted,
    }),
    boundaryLedger: Object.freeze({
      workspace: literalBoundary.handoff?.workspace ?? "global",
      tenant: literalBoundary.handoff?.tenant ?? "",
      role: literalBoundary.handoff?.role ?? "",
      ready: literalBoundary.handoff?.ready !== false,
      permissionEnvelopeReady: permissionEnvelope.auditHandoffReady === true,
      permissionEnvelopeState: permissionEnvelope.state ?? "unknown",
      nextAction: literalBoundary.handoff?.nextAction ?? "handoff_boundary_audit",
      deniedCapabilities: Object.freeze(literalBoundary.permissionState?.denied ?? []),
      auditCommandIds: Object.freeze(boundaryCommands.map((command) => command.id).sort()),
      permissionCommandIds: Object.freeze(permissionCommands.map((command) => command.id).sort()),
      permissionMatrixCommandIds: Object.freeze(permissionMatrixCommands.map((command) => command.id).sort()),
      tenantLeaseCommandIds: Object.freeze(tenantLeaseCommands.map((command) => command.id).sort()),
      permissionBlockers: Object.freeze(permissionEnvelope.blockers ?? []),
      permissionCounters: permissionEnvelope.counters ?? null,
      permissionMatrix: Object.freeze({
        matrixId: permissionMatrix.matrixId ?? "",
        state: permissionMatrix.state ?? "unknown",
        ready: permissionMatrix.handoff?.ready !== false,
        blockers: Object.freeze(permissionMatrix.blockers ?? []),
        reviewQueue: Object.freeze((permissionMatrix.reviewQueue ?? []).map((row) => row.decisionId).sort()),
        counters: permissionMatrix.counters ?? null,
        nextAction: permissionMatrix.handoff?.nextAction ?? "handoff_permission_audit",
      }),
      tenantBoundaryLease: Object.freeze({
        leaseId: tenantBoundaryLease.leaseId ?? "",
        state: tenantBoundaryLease.state ?? "unknown",
        ready: tenantBoundaryLease.handoff?.ready !== false,
        restartSafe: tenantBoundaryLease.handoff?.restartSafe !== false,
        blockers: Object.freeze(tenantBoundaryLease.blockers ?? []),
        review: Object.freeze(tenantBoundaryLease.review ?? []),
        counters: tenantBoundaryLease.counters ?? null,
        nextAction: tenantBoundaryLease.handoff?.nextAction ?? "handoff_tenant_boundary_lease",
      }),
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
    deploymentLedger: Object.freeze({
      revision: deploymentGate?.revision ?? "",
      state: deploymentGate?.state ?? "unknown",
      ready: deploymentGate?.handoff?.ready === true,
      checkpoint: deploymentGate?.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: deploymentGate?.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      commentReady: deploymentGate?.surfaces?.comment?.ready === true,
      literalReady: deploymentGate?.surfaces?.literal?.ready === true,
      blockers: Object.freeze(deploymentGate?.blockers ?? []),
      nextAction: deploymentGate?.handoff?.nextAction ?? "adopt_mailchimp_deployment_gate",
    }),
    syncBridgeLedger: Object.freeze({
      revision: syncBridge?.revision ?? "",
      state: syncBridge?.state ?? "unknown",
      ready: syncBridge?.handoff?.ready === true,
      checkpoint: syncBridge?.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: syncBridge?.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      blockers: Object.freeze(syncBridge?.blockers ?? []),
      review: Object.freeze(syncBridge?.review ?? []),
      commandIds: Object.freeze(syncBridgeCommands.map((command) => command.id).sort()),
      nextAction: syncBridge?.handoff?.nextAction ?? "adopt_mailchimp_sync_bridge",
    }),
    providerNegotiationLedger: Object.freeze({
      literalRevision: literalProviderNegotiation.handoff?.checkpoint ?? "",
      commentPreviewId: commentProviderAcceptance.preview?.previewId ?? "",
      literalReady: literalProviderNegotiation.handoff?.ready !== false,
      commentReady: commentProviderAcceptance.handoff?.ready !== false,
      checkpoint: literalProviderNegotiation.handoff?.checkpoint ?? commentProviderAcceptance.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: literalProviderNegotiation.handoff?.statusChannel ?? commentProviderAcceptance.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      blocked: Object.freeze([
        ...(literalProviderNegotiation.blockers ?? []).map((blocker) => `literal:${blocker}`),
        ...(commentProviderAcceptance.acceptance?.blockedBy ?? []).map((blocker) => `comment:${blocker}`),
      ].sort()),
      review: Object.freeze([
        ...(literalProviderNegotiation.review ?? []).map((item) => `literal:${item}`),
        ...(commentProviderAcceptance.acceptance?.review ?? []).map((item) => `comment:${item}`),
      ].sort()),
      commandIds: Object.freeze(providerNegotiationCommands.map((command) => command.id).sort()),
      nextAction: literalProviderNegotiation.handoff?.ready === false
        ? literalProviderNegotiation.handoff.nextAction
        : commentProviderAcceptance.handoff?.ready === false
          ? commentProviderAcceptance.handoff.nextAction
          : "handoff_mailchimp_provider_negotiation",
    }),
    providerCommitWindowLedger: Object.freeze({
      literalRevision: literalProviderCommitWindow.revision ?? "",
      commentRevision: commentProviderCommitWindow.revision ?? "",
      literalReady: literalProviderCommitWindow.handoff?.ready !== false,
      commentReady: commentProviderCommitWindow.handoff?.ready !== false,
      checkpoint: literalProviderCommitWindow.handoff?.checkpoint ?? commentProviderCommitWindow.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: literalProviderCommitWindow.handoff?.statusChannel ?? commentProviderCommitWindow.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      blocked: Object.freeze([
        ...(literalProviderCommitWindow.blockers ?? []).map((blocker) => `literal:${blocker}`),
        ...(commentProviderCommitWindow.acceptance?.blockedBy ?? []).map((blocker) => `comment:${blocker}`),
      ].sort()),
      review: Object.freeze([
        ...(literalProviderCommitWindow.review ?? []).map((item) => `literal:${item}`),
        ...(commentProviderCommitWindow.acceptance?.review ?? []).map((item) => `comment:${item}`),
      ].sort()),
      commandIds: Object.freeze(providerCommitCommands.map((command) => command.id).sort()),
      ready: literalProviderCommitWindow.handoff?.ready !== false && commentProviderCommitWindow.handoff?.ready !== false,
      writesExternalSystem: literalProviderCommitWindow.handoff?.writesExternalSystem === true || commentProviderCommitWindow.handoff?.writesExternalSystem === true,
      nextAction: literalProviderCommitWindow.handoff?.ready === false
        ? literalProviderCommitWindow.handoff.nextAction
        : commentProviderCommitWindow.handoff?.ready === false
          ? commentProviderCommitWindow.handoff.nextAction
          : "handoff_mailchimp_provider_commit_window",
    }),
    literalClientReadinessLedger: Object.freeze({
      previewId: literalClientReadiness.preview?.previewId ?? "",
      state: literalClientReadiness.validationSummary?.state ?? "unknown",
      ready: literalClientReadiness.handoff?.ready === true,
      checkpoint: literalClientReadiness.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: literalClientReadiness.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      blockedBy: Object.freeze(literalClientReadiness.acceptance?.blockedBy ?? []),
      review: Object.freeze(literalClientReadiness.acceptance?.review ?? []),
      commandIds: Object.freeze(literalClientCommands.map((command) => command.id).sort()),
      nextAction: literalClientReadiness.handoff?.nextAction ?? "accept_literal_client_readiness",
    }),
    literalResumeManifestLedger: Object.freeze({
      revision: literalResumeManifest.revision ?? "",
      state: literalResumeManifest.state ?? "unknown",
      ready: literalResumeManifest.handoff?.ready === true,
      checkpoint: literalResumeManifest.handoff?.checkpoint ?? literalResumeManifest.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: literalResumeManifest.handoff?.statusChannel ?? literalResumeManifest.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      resumeToken: literalResumeManifest.clientState?.persistedState?.literalResumeToken ?? "",
      replayAvailable: literalResumeManifest.replay?.available === true,
      replayableRows: literalResumeManifest.counters?.replayable ?? 0,
      heldRows: literalResumeManifest.counters?.held ?? 0,
      blockedBy: Object.freeze(literalResumeManifest.blockers ?? []),
      blockedCommandIds: Object.freeze(literalResumeManifest.replay?.blockedCommandIds ?? []),
      idempotencyKeys: Object.freeze(literalResumeManifest.replay?.idempotencyKeys ?? []),
      clientState: literalResumeManifest.clientState?.persistedState ?? null,
      nextAction: literalResumeManifest.handoff?.nextAction ?? "persist_literal_resume_manifest",
    }),
    literalRestartDigestLedger: Object.freeze({
      revision: literalRestartDigest.revision ?? "",
      state: literalRestartDigest.state ?? "unknown",
      ready: literalRestartDigest.handoff?.ready === true,
      checkpoint: literalRestartDigest.handoff?.checkpoint ?? literalRestartDigest.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: literalRestartDigest.handoff?.statusChannel ?? literalRestartDigest.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      restartToken: literalRestartDigest.persistedState?.restartDigestToken ?? "",
      resumeManifestRevision: literalRestartDigest.persistedState?.resumeManifestRevision ?? literalResumeManifest.revision ?? "",
      restartSafeRows: literalRestartDigest.counters?.restartSafe ?? 0,
      blockedRows: literalRestartDigest.counters?.blocked ?? 0,
      driftedRows: literalRestartDigest.counters?.statusLedgerDrifted ?? 0,
      blockedBy: Object.freeze(literalRestartDigest.blockers ?? []),
      rowCommandIds: Object.freeze((literalRestartDigest.rows ?? []).map((row) => row.commandId).filter(Boolean).sort()),
      clientState: literalRestartDigest.persistedState ?? null,
      nextAction: literalRestartDigest.handoff?.nextAction ?? "persist_literal_restart_digest",
    }),
    clientActionLedger: Object.freeze({
      commentRevision: comments.clientActionQueue?.revision ?? "",
      literalRevision: literalContracts.clientActionQueue?.revision ?? "",
      commentReady: comments.clientActionQueue?.handoff?.ready !== false,
      literalReady: literalContracts.clientActionQueue?.handoff?.ready !== false,
      commentCommandIds: Object.freeze(commentClientActionCommands.map((command) => command.id).sort()),
      literalCommandIds: Object.freeze(literalClientActionCommands.map((command) => command.id).sort()),
      blocked: Object.freeze([
        ...(comments.clientActionQueue?.blockers ?? []).map((blocker) => `comment:${blocker}`),
        ...(literalContracts.clientActionQueue?.blockers ?? []).map((blocker) => `literal:${blocker}`),
      ].sort()),
      review: Object.freeze([
        ...(comments.clientActionQueue?.review ?? []).map((item) => `comment:${item}`),
        ...(literalContracts.clientActionQueue?.review ?? []).map((item) => `literal:${item}`),
      ].sort()),
      nextAction: comments.clientActionQueue?.handoff?.ready === false
        ? comments.clientActionQueue.handoff.nextAction
        : literalContracts.clientActionQueue?.handoff?.ready === false
          ? literalContracts.clientActionQueue.handoff.nextAction
          : "adopt_mailchimp_client_actions",
    }),
    recoveryAdoptionLedger: Object.freeze({
      commentRevision: commentRecoveryAdoption.revision ?? "",
      literalRevision: literalRecoveryAdoption.revision ?? "",
      commentReady: commentRecoveryAdoption.handoff?.ready !== false,
      literalReady: literalRecoveryAdoption.handoff?.ready !== false,
      checkpoint: commentRecoveryAdoption.handoff?.checkpoint ?? literalRecoveryAdoption.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: commentRecoveryAdoption.handoff?.statusChannel ?? literalRecoveryAdoption.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
      commentCommandIds: Object.freeze(recoveryAdoptionCommands.filter((command) => command.type.startsWith("aios.comment.")).map((command) => command.id).sort()),
      literalCommandIds: Object.freeze(recoveryAdoptionCommands.filter((command) => command.type.startsWith("aios.literal.")).map((command) => command.id).sort()),
      blocked: Object.freeze([
        ...(commentRecoveryAdoption.acceptance?.blockedBy ?? []).map((blocker) => `comment:${blocker}`),
        ...(literalRecoveryAdoption.acceptance?.blockedBy ?? []).map((blocker) => `literal:${blocker}`),
      ].sort()),
      review: Object.freeze([
        ...(commentRecoveryAdoption.acceptance?.review ?? []).map((item) => `comment:${item}`),
        ...(literalRecoveryAdoption.acceptance?.review ?? []).map((item) => `literal:${item}`),
      ].sort()),
      idempotencyKeys: Object.freeze([
        ...(commentRecoveryAdoption.persistedView?.idempotencyKeys ?? []).map((key) => `comment:${key}`),
        ...(literalRecoveryAdoption.persistedView?.idempotencyKeys ?? []).map((key) => `literal:${key}`),
      ].sort()),
      resumeFromCheckpoint: commentRecoveryAdoption.persistedView?.resumeFromCheckpoint !== false
        && literalRecoveryAdoption.persistedView?.resumeFromCheckpoint !== false,
      nextAction: commentRecoveryAdoption.handoff?.ready === false
        ? commentRecoveryAdoption.handoff.nextAction
        : literalRecoveryAdoption.handoff?.ready === false
          ? literalRecoveryAdoption.handoff.nextAction
          : "publish_mailchimp_recovery_adoption",
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
        ...statusLedger.blockers,
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

function clientSessionRequiredKeys(runtimeAdoption, persistedState, recoveryStatus) {
  const boundaryScope = runtimeAdoption.requestState.boundaryScope ?? {};
  return Object.freeze(Array.from(new Set([
    "requestId",
    "workflowId",
    "checkpoint",
    "statusChannel",
    "resumeToken",
    "persistenceRevision",
    ...(recoveryStatus.clientHandoff?.clientState?.requiredKeys ?? []),
    ...(boundaryScope.tenant ? ["tenant"] : []),
    ...(boundaryScope.permissionEnvelope?.externalWriteRequested ? ["permissionEnvelopeState"] : []),
  ].filter(Boolean))).sort());
}

function commandSessionState(command) {
  if (command.state === "blocked" || command.restartSafe === false) return "blocked";
  if (command.state === "review" || command.statusPatch?.state === "review") return "review";
  if (command.state === "suppressed" || command.state === "skipped") return "suppressed";
  return "queued";
}

function buildClientSessionCommandQueue(persistedState) {
  return Object.freeze((persistedState.pendingCommands ?? []).map((command, index) => Object.freeze({
    order: index + 1,
    id: command.id,
    type: command.type,
    action: command.action ?? command.statusPatch?.nextAction ?? "inspect_mailchimp_client_command",
    state: commandSessionState(command),
    checkpoint: command.checkpoint,
    statusChannel: command.statusChannel,
    idempotencyKey: command.idempotencyKey,
    idempotent: command.idempotent === true,
    restartSafe: command.restartSafe === true,
    localOnly: command.localOnly !== false,
    writesExternalSystem: command.writesExternalSystem === true,
    statusPatch: command.statusPatch ?? Object.freeze({
      state: commandSessionState(command),
      nextAction: command.action ?? "inspect_mailchimp_client_command",
      message: `${command.type} is queued for Mailchimp client session replay.`,
    }),
  })));
}

function buildMailchimpClientRuntimeSession({ runtimeAdoption, persistedState, recoveryStatus, acceptance, operationalHealthSeed = null }) {
  const requiredKeys = clientSessionRequiredKeys(runtimeAdoption, persistedState, recoveryStatus);
  const requestId = stableReportRevision([
    "mailchimp-client",
    runtimeAdoption.requestState.service,
    runtimeAdoption.handoff.checkpoint,
    persistedState.revision,
  ]);
  const workflowId = "mailchimp-runtime-adoption";
  const stateKey = stableReportRevision([
    "mailchimp-client-state",
    requestId,
    persistedState.revision,
    persistedState.recoveryLedger.resumeToken,
  ]);
  const persistedClientState = Object.freeze({
    requestId,
    workflowId,
    checkpoint: persistedState.recoveryPath.resumeCheckpoint || persistedState.checkpoint,
    statusChannel: persistedState.statusChannel,
    resumeToken: persistedState.recoveryLedger.resumeToken,
    persistenceRevision: persistedState.revision,
    tenant: runtimeAdoption.requestState.boundaryScope?.tenant ?? "",
    workspace: runtimeAdoption.requestState.boundaryScope?.workspace ?? "global",
    permissionEnvelopeState: runtimeAdoption.requestState.boundaryScope?.permissionEnvelope?.state ?? "",
    service: runtimeAdoption.requestState.service,
    adapter: runtimeAdoption.requestState.adapter,
  });
  const missingKeys = Object.freeze(requiredKeys
    .filter((key) => persistedClientState[key] == null || persistedClientState[key] === "")
    .sort());
  const commandQueue = buildClientSessionCommandQueue(persistedState);
  const blockedCommands = commandQueue.filter((command) => command.state === "blocked" || !command.restartSafe);
  const reviewCommands = commandQueue.filter((command) => command.state === "review");
  const readinessBlockers = Object.freeze([
    ...missingKeys.map((key) => `client-state:${key}`),
    ...blockedCommands.map((command) => `command:${command.id}`),
    ...(!acceptance.accepted ? acceptance.blockers.map((blocker) => `acceptance:${blocker}`) : []),
    ...(persistedState.deploymentLedger?.ready === false ? persistedState.deploymentLedger.blockers.map((blocker) => `deployment:${blocker}`) : []),
    ...(persistedState.syncBridgeLedger?.ready === false ? persistedState.syncBridgeLedger.blockers.map((blocker) => `sync:${blocker}`) : []),
    ...(persistedState.providerNegotiationLedger?.literalReady === false ? persistedState.providerNegotiationLedger.blocked.map((blocker) => `provider:${blocker}`) : []),
    ...(persistedState.providerNegotiationLedger?.commentReady === false ? persistedState.providerNegotiationLedger.blocked.map((blocker) => `provider:${blocker}`) : []),
    ...(persistedState.literalClientReadinessLedger?.ready === false ? persistedState.literalClientReadinessLedger.blockedBy.map((blocker) => `literal-client:${blocker}`) : []),
    ...(persistedState.clientActionLedger?.commentReady === false ? persistedState.clientActionLedger.blocked.map((blocker) => `client-action:${blocker}`) : []),
    ...(persistedState.clientActionLedger?.literalReady === false ? persistedState.clientActionLedger.blocked.map((blocker) => `client-action:${blocker}`) : []),
    ...(persistedState.boundaryLedger?.permissionEnvelopeReady === false ? persistedState.boundaryLedger.permissionBlockers.map((blocker) => `permission:${blocker}`) : []),
    ...(recoveryStatus.restartSafe ? [] : ["recovery:not_restart_safe"]),
  ].filter(Boolean).sort());
  const acceptedForRuntime = readinessBlockers.length === 0
    && persistedState.recoveryPath.resumeFromCheckpoint === true
    && runtimeAdoption.handoff.ready === true;
  const acceptedForExternalWrite = acceptedForRuntime
    && runtimeAdoption.handoff.writesExternalSystem === true
    && recoveryStatus.writesExternalSystem === true;
  const sessionState = readinessBlockers.length > 0
    ? "blocked"
    : reviewCommands.length > 0 || recoveryStatus.state === "review"
      ? "review"
      : acceptedForRuntime ? "ready" : "warming";
  const nextAction = missingKeys.length > 0
    ? "hydrate_mailchimp_client_state"
    : ((blockedCommands[0]?.action
      ?? (readinessBlockers.length > 0 ? acceptance.nextAction : ""))
      || (reviewCommands.length > 0 ? "review_mailchimp_client_session" : "adopt_mailchimp_client_runtime_session"));
  const session = Object.freeze({
    schema: "aios.symbol-table.client-runtime-session.v1",
    sessionId: stableReportRevision([
      "client-session",
      requestId,
      persistedState.revision,
      sessionState,
      commandQueue.length,
    ]),
    state: sessionState,
    request: Object.freeze({
      requestId,
      workflowId,
      routeName: "mailchimp.runtime.adoption",
      service: runtimeAdoption.requestState.service,
      adapter: runtimeAdoption.requestState.adapter,
      capabilities: runtimeAdoption.requestState.capabilities,
    }),
    status: Object.freeze({
      checkpoint: persistedClientState.checkpoint,
      statusChannel: persistedClientState.statusChannel,
      localOnly: runtimeAdoption.handoff.localOnly !== false || recoveryStatus.localOnly === true,
      writesExternalSystem: acceptedForExternalWrite,
      userVisibleState: sessionState === "blocked" ? "needs-attention" : runtimeAdoption.client.userVisibleState,
      nextAction,
    }),
    clientState: Object.freeze({
      stateKey,
      requiredKeys,
      missingKeys,
      hydrated: missingKeys.length === 0,
      persistedState: persistedClientState,
    }),
    replay: Object.freeze({
      replayState: persistedState.replayState,
      resumeAvailable: persistedState.recoveryPath.resumeFromCheckpoint === true,
      resumeToken: persistedState.recoveryLedger.resumeToken,
      resumeCheckpoint: persistedState.recoveryPath.resumeCheckpoint,
      nextCommandId: persistedState.recoveryPath.nextCommandId,
      commandCount: commandQueue.length,
      restartSafeCommands: commandQueue.filter((command) => command.restartSafe).length,
      unsafeCommands: blockedCommands.length,
    }),
    acceptance: Object.freeze({
      required: readinessBlockers.length > 0 || runtimeAdoption.handoff.writesExternalSystem === true,
      acceptedForRuntime,
      acceptedForExternalWrite,
      blockedBy: readinessBlockers,
      review: Object.freeze([
        ...reviewCommands.map((command) => `command:${command.id}`),
        ...(persistedState.syncBridgeLedger?.review ?? []).map((item) => `sync:${item}`),
        ...(persistedState.providerNegotiationLedger?.review ?? []).map((item) => `provider:${item}`),
        ...(persistedState.literalClientReadinessLedger?.review ?? []).map((item) => `literal-client:${item}`),
        ...(persistedState.clientActionLedger?.review ?? []).map((item) => `client-action:${item}`),
      ].sort()),
      nextAction,
    }),
    recovery: Object.freeze({
      state: recoveryStatus.state,
      restartSafe: recoveryStatus.restartSafe,
      resumeToken: persistedState.recoveryLedger.resumeToken,
      recoveryNextAction: recoveryStatus.nextAction,
      healthSeedState: operationalHealthSeed?.state ?? "",
    }),
    commandQueue,
  });
  const validation = validateAiosRecoveryClientSession(session);

  return Object.freeze({
    ...session,
    validation,
    handoff: Object.freeze({
      ready: validation.ok && acceptedForRuntime,
      checkpoint: persistedClientState.checkpoint,
      statusChannel: persistedClientState.statusChannel,
      localOnly: session.status.localOnly,
      writesExternalSystem: acceptedForExternalWrite,
      nextAction: validation.ok ? nextAction : validation.summary.nextAction,
    }),
  });
}

function buildSourceClientStatusAdoption(comments, literalContracts, persistedState, clientSession) {
  const commentStatus = comments.clientStatusAdoption ?? {};
  const literalStatus = literalContracts.clientStatusAdoption ?? {};
  const rows = Object.freeze([
    ...(commentStatus.rows ?? []).map((row) => Object.freeze({
      source: "comment",
      rowId: row.rowId,
      subject: `${row.source}:${row.subject}`,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
    ...(literalStatus.rows ?? []).map((row) => Object.freeze({
      source: "literal",
      rowId: row.rowId,
      subject: `${row.source}:${row.subject}`,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      nextAction: row.nextAction,
    })),
  ].sort((left, right) => `${left.source}:${left.subject}:${left.rowId}`.localeCompare(`${right.source}:${right.subject}:${right.rowId}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const checkpoint = clientSession?.handoff?.checkpoint
    || commentStatus.handoff?.checkpoint
    || literalStatus.handoff?.checkpoint
    || persistedState.checkpoint;
  const statusChannel = clientSession?.handoff?.statusChannel
    || commentStatus.handoff?.statusChannel
    || literalStatus.handoff?.statusChannel
    || persistedState.statusChannel;
  const ready = blockedRows.length === 0
    && commentStatus.handoff?.ready !== false
    && literalStatus.handoff?.ready !== false
    && clientSession?.handoff?.ready !== false;
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : ready ? "ready" : "warming";
  const nextAction = blockedRows[0]?.nextAction
    ?? (reviewRows.length > 0 ? "review_source_client_status_adoption" : "publish_source_client_status_adoption");

  return Object.freeze({
    schema: "aios.symbol-table.source-client-status-adoption.v1",
    revision: stableReportRevision([
      "source-client-status",
      commentStatus.revision,
      literalStatus.revision,
      persistedState.revision,
      state,
      rows.length,
      blockedRows.length,
    ]),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      commentRows: commentStatus.counters?.rows ?? 0,
      literalRows: literalStatus.counters?.rows ?? 0,
      accepted: rows.filter((row) => row.state === "accepted" || row.state === "pending" || row.state === "ready").length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || externalRows.length > 0,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint,
      statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function buildSourceClientRequestAdoption(comments, literalContracts, persistedState, clientSession, sourceClientStatusAdoption) {
  const commentSnapshot = comments.clientRequestSnapshot ?? {};
  const literalSnapshot = literalContracts.clientRequestSnapshot ?? {};
  const commentResumeDecision = commentSnapshot.requestResumeDecision ?? {};
  const literalResumeDecision = literalSnapshot.requestResumeDecision ?? {};
  const rows = Object.freeze([
    ...(commentSnapshot.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.source-client-request-row.v1",
      surface: "comment",
      source: row.source,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: row.idempotencyKey,
      nextAction: row.nextAction,
    })),
    ...(literalSnapshot.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.source-client-request-row.v1",
      surface: "literal",
      source: row.source,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: row.idempotencyKey,
      nextAction: row.nextAction,
    })),
  ].sort((left, right) => `${left.surface}:${left.source}:${left.subject}:${left.idempotencyKey}`.localeCompare(`${right.surface}:${right.source}:${right.subject}:${right.idempotencyKey}`)));
  const resumeRows = Object.freeze([
    ...(commentResumeDecision.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.source-client-request-resume-row.v1",
      surface: "comment",
      source: row.source,
      subject: row.subject,
      state: row.replayState ?? row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: row.idempotencyKey,
      nextAction: row.nextAction,
    })),
    ...(literalResumeDecision.rows ?? []).map((row) => Object.freeze({
      schema: "aios.symbol-table.source-client-request-resume-row.v1",
      surface: "literal",
      source: row.source,
      subject: row.subject,
      state: row.replayState ?? row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: row.idempotencyKey,
      nextAction: row.nextAction,
    })),
  ].sort((left, right) => `${left.surface}:${left.source}:${left.subject}:${left.idempotencyKey}`.localeCompare(`${right.surface}:${right.source}:${right.subject}:${right.idempotencyKey}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const heldResumeRows = resumeRows.filter((row) => row.state === "held" || row.restartSafe === false || !row.idempotencyKey);
  const reviewResumeRows = resumeRows.filter((row) => row.state === "review");
  const replayableResumeRows = resumeRows.filter((row) => row.state === "replayable");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const capabilities = Object.freeze(Array.from(new Set([
    ...(commentSnapshot.capabilities ?? []),
    ...(literalSnapshot.capabilities ?? []),
    ...(clientSession.request?.capabilities ?? []),
  ].map(compact).filter(Boolean))).sort());
  const requiredKeys = Object.freeze(Array.from(new Set([
    ...(commentSnapshot.clientState?.requiredKeys ?? []),
    ...(literalSnapshot.clientState?.requiredKeys ?? []),
    ...(clientSession.clientState?.requiredKeys ?? []),
    "requestId",
    "workflowId",
    "checkpoint",
    "statusChannel",
  ].map(compact).filter(Boolean))).sort());
  const persistedClientState = Object.freeze({
    ...(clientSession.clientState?.persistedState ?? {}),
    requestId: clientSession.request?.requestId ?? "",
    workflowId: clientSession.request?.workflowId ?? "",
    service: commentSnapshot.service || literalSnapshot.service || clientSession.request?.service || "mailchimp",
    adapter: commentSnapshot.adapter || literalSnapshot.adapter || clientSession.request?.adapter || "mailchimp",
    tenant: literalSnapshot.tenant || persistedState.boundaryLedger?.tenant || "",
    workspace: literalSnapshot.workspace || persistedState.boundaryLedger?.workspace || "",
    role: literalSnapshot.role || persistedState.boundaryLedger?.role || "",
    checkpoint: sourceClientStatusAdoption.handoff?.checkpoint
      || clientSession.handoff?.checkpoint
      || commentSnapshot.handoff?.checkpoint
      || literalSnapshot.handoff?.checkpoint
      || persistedState.checkpoint,
    statusChannel: sourceClientStatusAdoption.handoff?.statusChannel
      || clientSession.handoff?.statusChannel
      || commentSnapshot.handoff?.statusChannel
      || literalSnapshot.handoff?.statusChannel
      || persistedState.statusChannel,
  });
  const missingKeys = Object.freeze(requiredKeys
    .filter((key) => persistedClientState[key] == null || persistedClientState[key] === "")
    .sort());
  const snapshotBlockers = Object.freeze([
    ...(commentSnapshot.acceptance?.blockedBy ?? []).map((item) => `comment:${item}`),
    ...(literalSnapshot.acceptance?.blockedBy ?? []).map((item) => `literal:${item}`),
    ...(commentResumeDecision.acceptance?.blockedBy ?? []).map((item) => `comment-resume:${item}`),
    ...(literalResumeDecision.acceptance?.blockedBy ?? []).map((item) => `literal-resume:${item}`),
    ...blockedRows.map((row) => `${row.surface}:${row.source}:${row.subject}:${row.nextAction}`),
    ...heldResumeRows.map((row) => `${row.surface}-resume:${row.source}:${row.subject}:${row.nextAction}`),
    ...missingKeys.map((key) => `client-state:${key}`),
  ].sort());
  const ready = snapshotBlockers.length === 0
    && commentSnapshot.handoff?.ready !== false
    && literalSnapshot.handoff?.ready !== false
    && clientSession.handoff?.ready !== false
    && sourceClientStatusAdoption.handoff?.ready !== false
    && commentResumeDecision.handoff?.ready !== false
    && literalResumeDecision.handoff?.ready !== false;
  const state = snapshotBlockers.length > 0
    ? "blocked"
    : reviewRows.length > 0 || reviewResumeRows.length > 0 ? "review" : rows.length > 0 || resumeRows.length > 0 ? "ready" : "empty";
  const resumeMode = snapshotBlockers.length > 0
    ? "hold"
    : reviewResumeRows.length > 0 ? "review" : externalRows.length > 0 ? "handoff" : "local-replay";
  const nextAction = missingKeys.length > 0
    ? "hydrate_source_client_request_state"
    : heldResumeRows[0]?.nextAction
      ?? blockedRows[0]?.nextAction
      ?? commentSnapshot.acceptance?.nextAction
      ?? literalSnapshot.acceptance?.nextAction
      ?? (reviewRows.length > 0 || reviewResumeRows.length > 0 ? "review_source_client_request_adoption" : "adopt_source_client_request");

  return Object.freeze({
    schema: "aios.symbol-table.source-client-request-adoption.v1",
    revision: stableReportRevision([
      "source-client-request",
      commentSnapshot.requestId,
      literalSnapshot.requestId,
      persistedState.revision,
      state,
      rows.length,
      snapshotBlockers.length,
    ]),
    state,
    rows,
    requestResumeDecision: Object.freeze({
      schema: "aios.symbol-table.source-client-request-resume-decision.v1",
      resumeMode,
      replayable: ready && heldResumeRows.length === 0 && replayableResumeRows.length === resumeRows.length,
      rows: resumeRows,
      counters: Object.freeze({
        rows: resumeRows.length,
        commentRows: commentResumeDecision.counters?.rows ?? 0,
        literalRows: literalResumeDecision.counters?.rows ?? 0,
        replayable: replayableResumeRows.length,
        held: heldResumeRows.length,
        review: reviewResumeRows.length,
        externalWrites: resumeRows.filter((row) => row.writesExternalSystem).length,
      }),
      acceptance: Object.freeze({
        acceptedForRuntime: ready,
        acceptedForExternalWrite: ready && externalRows.length > 0,
        blockedBy: Object.freeze([
          ...(commentResumeDecision.acceptance?.blockedBy ?? []).map((item) => `comment:${item}`),
          ...(literalResumeDecision.acceptance?.blockedBy ?? []).map((item) => `literal:${item}`),
          ...heldResumeRows.map((row) => `${row.surface}:${row.source}:${row.subject}:${row.nextAction}`),
        ].sort()),
        review: Object.freeze([
          ...(commentResumeDecision.acceptance?.review ?? []).map((item) => `comment:${item}`),
          ...(literalResumeDecision.acceptance?.review ?? []).map((item) => `literal:${item}`),
          ...reviewResumeRows.map((row) => `${row.surface}:${row.source}:${row.subject}`),
        ].sort()),
        nextAction,
      }),
      handoff: Object.freeze({
        ready,
        checkpoint: persistedClientState.checkpoint,
        statusChannel: persistedClientState.statusChannel,
        localOnly: externalRows.length === 0,
        writesExternalSystem: externalRows.length > 0,
        nextAction,
      }),
    }),
    capabilities,
    counters: Object.freeze({
      rows: rows.length,
      commentRows: commentSnapshot.counters?.rows ?? 0,
      literalRows: literalSnapshot.counters?.rows ?? 0,
      resumeRows: resumeRows.length,
      resumeReplayable: replayableResumeRows.length,
      resumeHeld: heldResumeRows.length,
      blocked: snapshotBlockers.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
      capabilities: capabilities.length,
    }),
    clientState: Object.freeze({
      requiredKeys,
      missingKeys,
      hydrated: missingKeys.length === 0,
      persistedState: persistedClientState,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || externalRows.length > 0,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && externalRows.length > 0,
      blockedBy: snapshotBlockers,
      review: Object.freeze([
        ...(commentSnapshot.acceptance?.review ?? []).map((item) => `comment:${item}`),
        ...(literalSnapshot.acceptance?.review ?? []).map((item) => `literal:${item}`),
        ...reviewRows.map((row) => `${row.surface}:${row.source}:${row.subject}`),
      ].sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint: persistedClientState.checkpoint,
      statusChannel: persistedClientState.statusChannel,
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      userVisibleState: state === "blocked" ? "needs-attention" : state === "review" ? "review" : rows.length > 0 ? "queued" : "idle",
      nextAction,
    }),
  });
}

function buildSourceClientResumeEnvelope(comments, literalContracts, persistedState, clientSession, sourceClientStatusAdoption) {
  const commentResume = comments.clientResumeEnvelope ?? {};
  const literalResume = literalContracts.clientResumeEnvelope ?? {};
  const rows = Object.freeze([
    ...(commentResume.rows ?? []).map((row) => Object.freeze({
      surface: "comment",
      source: row.source,
      rowId: row.rowId,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: row.idempotencyKey,
      nextAction: row.nextAction,
    })),
    ...(literalResume.rows ?? []).map((row) => Object.freeze({
      surface: "literal",
      source: row.source,
      rowId: row.rowId,
      subject: row.subject,
      state: row.state,
      checkpoint: row.checkpoint,
      statusChannel: row.statusChannel,
      restartSafe: row.restartSafe === true,
      localOnly: row.localOnly !== false,
      writesExternalSystem: row.writesExternalSystem === true,
      idempotencyKey: row.idempotencyKey,
      nextAction: row.nextAction,
    })),
  ].sort((left, right) => `${left.surface}:${left.source}:${left.subject}:${left.rowId}`.localeCompare(`${right.surface}:${right.source}:${right.subject}:${right.rowId}`)));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const requiredKeys = Object.freeze(Array.from(new Set([
    ...(commentResume.clientState?.requiredKeys ?? []),
    ...(literalResume.clientState?.requiredKeys ?? []),
    ...(clientSession.clientState?.requiredKeys ?? []),
  ].filter(Boolean))).sort());
  const persistedClientState = Object.freeze({
    ...(clientSession.clientState?.persistedState ?? {}),
    checkpoint: clientSession.handoff?.checkpoint
      || sourceClientStatusAdoption.handoff?.checkpoint
      || commentResume.handoff?.checkpoint
      || literalResume.handoff?.checkpoint
      || persistedState.checkpoint,
    statusChannel: clientSession.handoff?.statusChannel
      || sourceClientStatusAdoption.handoff?.statusChannel
      || commentResume.handoff?.statusChannel
      || literalResume.handoff?.statusChannel
      || persistedState.statusChannel,
    healthState: literalResume.clientState?.healthState ?? "",
    commentResumeToken: commentResume.clientState?.resumeToken ?? "",
    literalResumeToken: literalResume.clientState?.resumeToken ?? "",
    sourceStatusRevision: sourceClientStatusAdoption.revision ?? "",
  });
  const missingKeys = Object.freeze(requiredKeys
    .filter((key) => persistedClientState[key] == null || persistedClientState[key] === "")
    .sort());
  const ready = blockedRows.length === 0
    && missingKeys.length === 0
    && commentResume.handoff?.ready !== false
    && literalResume.handoff?.ready !== false
    && sourceClientStatusAdoption.handoff?.ready !== false
    && clientSession.handoff?.ready !== false;
  const state = missingKeys.length > 0 || blockedRows.length > 0
    ? "blocked"
    : reviewRows.length > 0 ? "review" : ready ? "ready" : "warming";
  const nextAction = missingKeys.length > 0
    ? "hydrate_mailchimp_resume_client_state"
    : blockedRows[0]?.nextAction
      ?? (reviewRows.length > 0 ? "review_mailchimp_source_resume_envelope" : "resume_mailchimp_source_runtime");

  return Object.freeze({
    schema: "aios.symbol-table.source-client-resume-envelope.v1",
    revision: stableReportRevision([
      "source-client-resume",
      commentResume.revision ?? "comment:none",
      literalResume.revision ?? "literal:none",
      sourceClientStatusAdoption.revision ?? "status:none",
      persistedState.revision,
      state,
      rows.length,
      blockedRows.length,
    ]),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      commentRows: commentResume.counters?.rows ?? 0,
      literalRows: literalResume.counters?.rows ?? 0,
      blocked: blockedRows.length,
      review: reviewRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
      missingClientKeys: missingKeys.length,
    }),
    clientState: Object.freeze({
      requiredKeys,
      missingKeys,
      hydrated: missingKeys.length === 0,
      persistedState: persistedClientState,
    }),
    acceptance: Object.freeze({
      required: rows.length > 0 || externalRows.length > 0,
      acceptedForRuntime: ready,
      acceptedForExternalWrite: ready && externalRows.length > 0,
      blockedBy: Object.freeze([
        ...missingKeys.map((key) => `client-state:${key}`),
        ...blockedRows.map((row) => `${row.surface}:${row.source}:${row.subject}:${row.nextAction}`),
      ].sort()),
      review: Object.freeze(reviewRows.map((row) => `${row.surface}:${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    handoff: Object.freeze({
      ready,
      checkpoint: persistedClientState.checkpoint,
      statusChannel: persistedClientState.statusChannel,
      localOnly: rows.every((row) => row.localOnly),
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function buildOperationalHealth({ acceptance, runtimeAdoption, persistedState, recoveryStatus, comments, literalContracts, reconciliation, deploymentGate, syncBridge, surfaceOperationalReport, clientSession, sourceClientStatusAdoption, sourceClientResumeEnvelope }) {
  const commentRuntime = comments.runtimeState ?? {};
  const commentExport = comments.exportSummary ?? {};
  const commentExportPackage = comments.exportPackage ?? {};
  const literalRuntime = literalContracts.runtimeState ?? {};
  const literalProviders = literalContracts.providerContracts ?? {};
  const literalHealth = literalContracts.operationalHealth ?? {};
  const literalExportPackage = literalContracts.exportPackage ?? {};
  const literalReleaseReport = literalContracts.releaseReport ?? {};
  const literalClientReadiness = literalContracts.clientReadiness ?? {};
  const literalProviderNegotiation = literalContracts.providerNegotiation ?? {};
  const commentProviderAcceptance = comments.providerAcceptance ?? {};
  const commentRecoveryAdoption = comments.recoveryAdoption ?? {};
  const literalRecoveryAdoption = literalContracts.recoveryAdoption ?? {};
  const commentOperationalReport = comments.operationalReport ?? {};
  const literalOperationalReport = literalContracts.operationalReport ?? {};
  const literalBoundary = literalContracts.boundaryContract ?? {};
  const tenantBoundaryLease = literalBoundary.tenantBoundaryLease ?? {};
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
  if (literalClientReadiness.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_LITERAL_CLIENT_READINESS_BLOCKED",
      action: literalClientReadiness.handoff.nextAction,
      detail: literalClientReadiness.acceptance?.blockedBy?.[0] ?? `${literalClientReadiness.preview?.counters?.blocked ?? 0} literal readiness rows are blocked.`,
    }));
  }
  if (literalProviderNegotiation.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_LITERAL_PROVIDER_NEGOTIATION_BLOCKED",
      action: literalProviderNegotiation.handoff.nextAction,
      detail: literalProviderNegotiation.blockers?.[0] ?? "Literal provider negotiation is blocked.",
    }));
  }
  if (commentProviderAcceptance.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_COMMENT_PROVIDER_ACCEPTANCE_BLOCKED",
      action: commentProviderAcceptance.handoff.nextAction,
      detail: commentProviderAcceptance.acceptance?.blockedBy?.[0] ?? "Comment provider acceptance is blocked.",
    }));
  }
  if (commentRecoveryAdoption.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_COMMENT_RECOVERY_ADOPTION_BLOCKED",
      action: commentRecoveryAdoption.handoff.nextAction,
      detail: commentRecoveryAdoption.acceptance?.blockedBy?.[0] ?? "Comment recovery adoption is blocked.",
    }));
  }
  if (literalRecoveryAdoption.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_LITERAL_RECOVERY_ADOPTION_BLOCKED",
      action: literalRecoveryAdoption.handoff.nextAction,
      detail: literalRecoveryAdoption.acceptance?.blockedBy?.[0] ?? "Literal recovery adoption is blocked.",
    }));
  }
  if (commentOperationalReport.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_COMMENT_OPERATIONAL_REPORT_BLOCKED",
      action: commentOperationalReport.handoff.nextAction,
      detail: commentOperationalReport.acceptance?.blockedBy?.[0] ?? "Comment operational report is blocked.",
    }));
  }
  if (literalOperationalReport.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_LITERAL_OPERATIONAL_REPORT_BLOCKED",
      action: literalOperationalReport.handoff.nextAction,
      detail: literalOperationalReport.acceptance?.blockedBy?.[0] ?? "Literal operational report is blocked.",
    }));
  }
  if (surfaceOperationalReport?.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_SURFACE_OPERATIONAL_REPORT_BLOCKED",
      action: surfaceOperationalReport.handoff.nextAction,
      detail: surfaceOperationalReport.acceptance?.blockedBy?.[0] ?? "Mailchimp surface operational report is blocked.",
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
  if (persistedState.statusLedger?.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_STATUS_LEDGER_DRIFT",
      action: persistedState.statusLedger.handoff.nextAction,
      detail: persistedState.statusLedger.blockers?.[0] ?? "status_ledger",
    }));
  }
  if (clientSession?.validation?.ok === false) {
    failures.push(Object.freeze({
      code: "AIOS_CLIENT_RUNTIME_SESSION_INVALID",
      action: clientSession.validation.summary.nextAction,
      detail: clientSession.validation.diagnostics[0]?.message ?? "Mailchimp client runtime session did not validate.",
    }));
  }
  if (sourceClientStatusAdoption?.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_SOURCE_CLIENT_STATUS_ADOPTION_BLOCKED",
      action: sourceClientStatusAdoption.handoff.nextAction,
      detail: sourceClientStatusAdoption.acceptance?.blockedBy?.[0] ?? "Source client status adoption is blocked.",
    }));
  }
  if (sourceClientResumeEnvelope?.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_SOURCE_CLIENT_RESUME_BLOCKED",
      action: sourceClientResumeEnvelope.handoff.nextAction,
      detail: sourceClientResumeEnvelope.acceptance?.blockedBy?.[0] ?? "Source client resume envelope is blocked.",
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
  if (tenantBoundaryLease.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_TENANT_BOUNDARY_LEASE_BLOCKED",
      action: tenantBoundaryLease.handoff.nextAction,
      detail: tenantBoundaryLease.blockers?.[0] ?? tenantBoundaryLease.review?.[0] ?? "Tenant boundary lease is not ready.",
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
  if (persistedState.boundaryLedger?.permissionEnvelopeReady === false) {
    failures.push(Object.freeze({
      code: "AIOS_BOUNDARY_PERMISSION_ENVELOPE_BLOCKED",
      action: persistedState.boundaryLedger.nextAction ?? "handoff_permission_audit",
      detail: persistedState.boundaryLedger.permissionBlockers?.[0] ?? "permission_envelope",
    }));
  }
  if (deploymentGate?.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_MAILCHIMP_DEPLOYMENT_GATE_BLOCKED",
      action: deploymentGate.handoff.nextAction,
      detail: deploymentGate.blockers?.[0] ?? "Mailchimp deployment gate is not ready.",
    }));
  }
  if (syncBridge?.handoff?.ready === false) {
    failures.push(Object.freeze({
      code: "AIOS_MAILCHIMP_SYNC_BRIDGE_BLOCKED",
      action: syncBridge.handoff.nextAction,
      detail: syncBridge.blockers?.[0] ?? syncBridge.review?.[0] ?? "Mailchimp sync bridge is not ready.",
    }));
  } else if (syncBridge?.state === "review") {
    degraded.push(Object.freeze({
      code: "AIOS_MAILCHIMP_SYNC_BRIDGE_REVIEW",
      action: syncBridge.handoff.nextAction,
      detail: syncBridge.review?.[0] ?? "Mailchimp sync bridge needs review.",
    }));
  }
  if (literalClientReadiness.acceptance?.review?.length > 0) {
    degraded.push(Object.freeze({
      code: "AIOS_LITERAL_CLIENT_READINESS_REVIEW",
      action: literalClientReadiness.handoff?.nextAction ?? "review_literal_client_readiness",
      detail: literalClientReadiness.acceptance.review[0],
    }));
  }
  if (sourceClientStatusAdoption?.state === "review") {
    degraded.push(Object.freeze({
      code: "AIOS_SOURCE_CLIENT_STATUS_ADOPTION_REVIEW",
      action: sourceClientStatusAdoption.handoff?.nextAction ?? "review_source_client_status_adoption",
      detail: sourceClientStatusAdoption.acceptance?.review?.[0] ?? "Source client status adoption has review rows.",
    }));
  }
  if (sourceClientResumeEnvelope?.state === "review") {
    degraded.push(Object.freeze({
      code: "AIOS_SOURCE_CLIENT_RESUME_REVIEW",
      action: sourceClientResumeEnvelope.handoff?.nextAction ?? "review_mailchimp_source_resume_envelope",
      detail: sourceClientResumeEnvelope.acceptance?.review?.[0] ?? "Source client resume envelope has review rows.",
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
      clientStatusAdoptionState: sourceClientStatusAdoption?.state ?? "unknown",
      clientResumeState: sourceClientResumeEnvelope?.state ?? "unknown",
      message: failures[0]?.detail
        ?? degraded[0]?.detail
        ?? `${persistedState.commandSummary.total} Mailchimp runtime commands are ready.`,
    }),
  });
}

function buildMailchimpProviderServiceContract({ comments, literalContracts, recoveryStatus, runtimeAdoption, operationalHealth, sourceExternalHandoff }) {
  const provider = comments.providerContract ?? {};
  const literalProviders = literalContracts.providerContracts ?? {};
  const commentIncident = comments.incidentAnalytics ?? {};
  const literalIncident = literalContracts.incidentSnapshot ?? {};
  const incidentLifecycle = recoveryStatus.incidentLifecycle ?? {};
  const capabilities = Object.freeze(Array.from(new Set([
    ...(provider.requestedCapabilities ?? []),
    ...(literalProviders.requestedCapabilities ?? []),
    ...(runtimeAdoption.requestState?.capabilities ?? []),
  ].filter(Boolean))).sort());
  const rows = Object.freeze([
    Object.freeze({
      source: "comment-provider",
      subject: provider.service || "mailchimp",
      state: provider.handoff?.ready === false ? "blocked" : "ready",
      checkpoint: provider.sync?.checkpoint ?? "",
      statusChannel: provider.statusChannel ?? "mailchimp.contract.status",
      restartSafe: provider.handoff?.ready !== false,
      localOnly: provider.sync?.localOnly !== false,
      writesExternalSystem: provider.sync?.externalWriteAllowed === true,
      nextAction: provider.handoff?.nextAction ?? "handoff_comment_provider_status",
    }),
    Object.freeze({
      source: "literal-provider",
      subject: literalProviders.service || "mailchimp",
      state: literalProviders.handoff?.ready === false ? "blocked" : "ready",
      checkpoint: literalProviders.sync?.checkpoints?.[0] ?? "",
      statusChannel: literalProviders.sync?.statusChannels?.[0] ?? "mailchimp.contract.status",
      restartSafe: literalProviders.handoff?.ready !== false,
      localOnly: literalProviders.sync?.localOnly !== false,
      writesExternalSystem: literalProviders.sync?.externalWriteAllowed === true,
      nextAction: literalProviders.handoff?.nextAction ?? "handoff_literal_provider_status",
    }),
    Object.freeze({
      source: "comment-incident",
      subject: commentIncident.revision ?? "comment-incidents",
      state: commentIncident.handoff?.ready === false ? "blocked" : commentIncident.state ?? "ready",
      checkpoint: commentIncident.handoff?.checkpoint ?? "",
      statusChannel: commentIncident.handoff?.statusChannel ?? "mailchimp.contract.status",
      restartSafe: commentIncident.handoff?.ready !== false,
      localOnly: commentIncident.handoff?.localOnly !== false,
      writesExternalSystem: commentIncident.handoff?.writesExternalSystem === true,
      nextAction: commentIncident.handoff?.nextAction ?? "export_comment_incident_analytics",
    }),
    Object.freeze({
      source: "literal-incident",
      subject: literalIncident.revision ?? "literal-incidents",
      state: literalIncident.handoff?.ready === false ? "blocked" : literalIncident.state ?? "healthy",
      checkpoint: literalIncident.handoff?.checkpoint ?? "",
      statusChannel: literalIncident.handoff?.statusChannel ?? "mailchimp.contract.status",
      restartSafe: literalIncident.handoff?.ready !== false,
      localOnly: literalIncident.handoff?.localOnly !== false,
      writesExternalSystem: literalIncident.handoff?.writesExternalSystem === true,
      nextAction: literalIncident.handoff?.nextAction ?? "retain_literal_mailchimp_health",
    }),
    Object.freeze({
      source: "recovery-incident-lifecycle",
      subject: incidentLifecycle.state ?? "empty",
      state: incidentLifecycle.handoff?.ready === false ? "blocked" : incidentLifecycle.state ?? "empty",
      checkpoint: incidentLifecycle.handoff?.checkpoint ?? recoveryStatus.handoff?.checkpoint ?? "",
      statusChannel: incidentLifecycle.handoff?.statusChannel ?? recoveryStatus.handoff?.statusChannel ?? "mailchimp.contract.status",
      restartSafe: incidentLifecycle.handoff?.ready !== false,
      localOnly: incidentLifecycle.handoff?.localOnly !== false,
      writesExternalSystem: incidentLifecycle.handoff?.writesExternalSystem === true,
      nextAction: incidentLifecycle.handoff?.nextAction ?? "retain_empty_mailchimp_incident_lifecycle",
    }),
    Object.freeze({
      source: "source-external-handoff",
      subject: sourceExternalHandoff?.revision ?? "source-external",
      state: sourceExternalHandoff?.handoff?.ready === false ? "blocked" : sourceExternalHandoff?.state ?? "ready",
      checkpoint: sourceExternalHandoff?.handoff?.checkpoint ?? "",
      statusChannel: sourceExternalHandoff?.handoff?.statusChannel ?? "mailchimp.contract.status",
      restartSafe: sourceExternalHandoff?.handoff?.ready !== false,
      localOnly: sourceExternalHandoff?.handoff?.localOnly !== false,
      writesExternalSystem: sourceExternalHandoff?.handoff?.writesExternalSystem === true,
      nextAction: sourceExternalHandoff?.handoff?.nextAction ?? "publish_mailchimp_source_external_handoff",
    }),
  ].map((row, index) => Object.freeze({
    schema: "aios.symbol-table.provider-service-row.v1",
    order: index + 1,
    rowId: symbolId("provider-service", `${row.source}:${row.subject}`, "mailchimp"),
    ...row,
  })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false);
  const reviewRows = rows.filter((row) => row.state === "review" || row.state === "degraded");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const nextAction = blockedRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "handoff_mailchimp_provider_service_contract" : "attach_mailchimp_provider_service_contract");

  return Object.freeze({
    schema: "aios.symbol-table.provider-service-contract.v1",
    revision: symbolId("provider-service", `${runtimeAdoption.revision ?? "runtime"}:${operationalHealth.state}:${blockedRows.length}:${reviewRows.length}`, "mailchimp"),
    service: provider.service || literalProviders.service || runtimeAdoption.requestState?.service || "mailchimp",
    adapter: provider.adapter || literalProviders.adapter || runtimeAdoption.requestState?.adapter || "mailchimp",
    capabilities,
    state: blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : "ready",
    rows,
    counters: Object.freeze({
      rows: rows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      capabilities: capabilities.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
      externalWrites: externalRows.length,
      commentIncidents: commentIncident.counters?.rows ?? 0,
      literalIncidents: literalIncident.counters?.rows ?? 0,
      recoveryIncidents: incidentLifecycle.counters?.rows ?? 0,
    }),
    sync: Object.freeze({
      externalWriteRequested: provider.sync?.externalWriteRequested === true || literalProviders.sync?.externalWriteRequested === true,
      externalWriteAllowed: externalRows.length > 0 && blockedRows.length === 0,
      localOnly: externalRows.length === 0,
      checkpoints: Object.freeze(Array.from(new Set(rows.map((row) => row.checkpoint).filter(Boolean))).sort()),
      statusChannels: Object.freeze(Array.from(new Set(rows.map((row) => row.statusChannel).filter(Boolean))).sort()),
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0,
      checkpoint: rows.find((row) => row.checkpoint)?.checkpoint ?? "",
      statusChannel: rows.find((row) => row.statusChannel)?.statusChannel ?? "mailchimp.contract.status",
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction,
    }),
  });
}

function buildSymbolTimelineReport({ preview, persistedState, runtimeAdoption, literalContracts, comments, recoveryStatus, operationalHealth, reconciliation, syncBridge, surfaceOperationalReport, clientSession }) {
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
    permissionCommands: persistedState.commandSummary.permission ?? 0,
    tenantBoundaryLeaseCommands: persistedState.commandSummary.tenantBoundaryLease ?? 0,
    permissionEnvelopeReady: persistedState.boundaryLedger?.permissionEnvelopeReady === true ? 1 : 0,
    permissionEnvelopeBlockers: persistedState.boundaryLedger?.permissionBlockers?.length ?? 0,
    tenantBoundaryLeaseReady: persistedState.boundaryLedger?.tenantBoundaryLease?.ready === true ? 1 : 0,
    tenantBoundaryLeaseBlocked: persistedState.boundaryLedger?.tenantBoundaryLease?.blockers?.length ?? 0,
    tenantBoundaryLeaseReview: persistedState.boundaryLedger?.tenantBoundaryLease?.review?.length ?? 0,
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
    literalClientReadinessRows: literalContracts.clientReadiness?.preview?.counters?.rows ?? 0,
    literalClientReadinessBlocked: literalContracts.clientReadiness?.preview?.counters?.blocked ?? 0,
    literalClientReadinessReady: literalContracts.clientReadiness?.handoff?.ready === true ? 1 : 0,
    literalExportAuditRows: literalContracts.exportAuditBundle?.counters?.rows ?? 0,
    literalExportAuditBlocked: literalContracts.exportAuditBundle?.counters?.blocked ?? 0,
    literalExportAuditReady: literalContracts.exportAuditBundle?.handoff?.ready === true ? 1 : 0,
    literalResumeManifestRows: literalContracts.resumeManifest?.counters?.rows ?? 0,
    literalResumeManifestReplayable: literalContracts.resumeManifest?.counters?.replayable ?? 0,
    literalResumeManifestHeld: literalContracts.resumeManifest?.counters?.held ?? 0,
    literalResumeManifestReady: literalContracts.resumeManifest?.handoff?.ready === true ? 1 : 0,
    literalRestartDigestRows: literalContracts.restartDigest?.counters?.rows ?? 0,
    literalRestartDigestBlocked: literalContracts.restartDigest?.counters?.blocked ?? 0,
    literalRestartDigestReady: literalContracts.restartDigest?.handoff?.ready === true ? 1 : 0,
    recoveryRestartDigestAccepted: recoveryStatus.restartDigest?.accepted === true ? 1 : 0,
    recoveryResumeManifestAccepted: recoveryStatus.resumeManifest?.accepted === true ? 1 : 0,
    literalClientReadinessCommands: persistedState.commandSummary.literalClientReadiness ?? 0,
    exportPackageCommands: persistedState.commandSummary.exportPackages ?? 0,
    commentWarnings: comments.analytics?.counters?.warnings ?? 0,
    surfaceIssues: reconciliation?.issues?.length ?? 0,
    deploymentBlockers: persistedState.deploymentLedger?.blockers?.length ?? 0,
    deploymentReady: persistedState.deploymentLedger?.ready === true ? 1 : 0,
    syncBridgeRows: syncBridge?.rows?.length ?? 0,
    syncBridgeBlockers: syncBridge?.blockers?.length ?? 0,
    syncBridgeReady: syncBridge?.handoff?.ready === true ? 1 : 0,
    providerNegotiationCommands: persistedState.commandSummary.providerNegotiation ?? 0,
    literalProviderNegotiationReady: literalContracts.providerNegotiation?.handoff?.ready === true ? 1 : 0,
    literalProviderNegotiationBlocked: literalContracts.providerNegotiation?.blockers?.length ?? 0,
    commentProviderAcceptanceReady: comments.providerAcceptance?.handoff?.ready === true ? 1 : 0,
    commentProviderAcceptanceBlocked: comments.providerAcceptance?.acceptance?.blockedBy?.length ?? 0,
    clientSessionCommands: clientSession?.commandQueue?.length ?? 0,
    clientSessionBlockers: clientSession?.acceptance?.blockedBy?.length ?? 0,
    clientSessionReady: clientSession?.handoff?.ready === true ? 1 : 0,
    clientSessionValidationErrors: clientSession?.validation?.summary?.errors ?? 0,
    operationalIncidents: operationalHealth.incidentCount ?? 0,
    incidentFailures: operationalHealth.incidentFailureCount ?? 0,
    incidentRetryable: operationalHealth.incidentRetryable === true ? 1 : 0,
    statusLedgerRows: persistedState.statusLedger?.counters?.rows ?? 0,
    statusLedgerDrifted: persistedState.statusLedger?.counters?.drifted ?? 0,
    statusLedgerReady: persistedState.statusLedger?.handoff?.ready === true ? 1 : 0,
    recoveryAdoptionCommands: persistedState.commandSummary.recoveryAdoption ?? 0,
    recoveryAdoptionBlockers: persistedState.recoveryAdoptionLedger?.blocked?.length ?? 0,
    commentRecoveryAdoptionRows: comments.recoveryAdoption?.counters?.rows ?? 0,
    commentRecoveryAdoptionReady: comments.recoveryAdoption?.handoff?.ready === true ? 1 : 0,
    literalRecoveryAdoptionRows: literalContracts.recoveryAdoption?.counters?.rows ?? 0,
    literalRecoveryAdoptionReady: literalContracts.recoveryAdoption?.handoff?.ready === true ? 1 : 0,
    commentOperationalReportRows: comments.operationalReport?.counters?.rows ?? 0,
    commentOperationalReportReady: comments.operationalReport?.handoff?.ready === true ? 1 : 0,
    commentAnalyticsReportRows: comments.analyticsReport?.counters?.rows ?? 0,
    commentAnalyticsReportExportReady: comments.analyticsReport?.counters?.exportReady ?? 0,
    commentAnalyticsReportBlocked: comments.analyticsReport?.counters?.blocked ?? 0,
    commentAnalyticsReportReady: comments.analyticsReport?.handoff?.ready === true ? 1 : 0,
    literalOperationalReportRows: literalContracts.operationalReport?.counters?.rows ?? 0,
    literalOperationalReportReady: literalContracts.operationalReport?.handoff?.ready === true ? 1 : 0,
    surfaceOperationalReportRows: surfaceOperationalReport?.counters?.rows ?? 0,
    surfaceOperationalReportBlocked: surfaceOperationalReport?.counters?.blocked ?? 0,
    surfaceOperationalReportReady: surfaceOperationalReport?.handoff?.ready === true ? 1 : 0,
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
      ...((persistedState.statusLedger?.rows ?? []).map((row, index) => Object.freeze({
        sequence: preview.timeline.length + runtimeEvents.length + index + 1,
        source: `status-ledger:${row.source}`,
        label: row.commandId,
        state: row.persistedState,
        checkpoint: row.checkpoint,
        statusChannel: row.statusChannel,
        nextAction: row.nextAction,
      }))),
      ...((clientSession?.commandQueue ?? []).map((command, index) => Object.freeze({
        sequence: preview.timeline.length + runtimeEvents.length + (persistedState.statusLedger?.rows?.length ?? 0) + index + 1,
        source: "client-session",
        label: command.id,
        state: command.state,
        checkpoint: command.checkpoint,
        statusChannel: command.statusChannel,
        nextAction: command.action,
      }))),
      ...((literalContracts.resumeManifest?.rows ?? []).map((row, index) => Object.freeze({
        sequence: preview.timeline.length
          + runtimeEvents.length
          + (persistedState.statusLedger?.rows?.length ?? 0)
          + (clientSession?.commandQueue?.length ?? 0)
          + index + 1,
        source: "literal-resume-manifest",
        label: row.commandId,
        state: row.replayState,
        checkpoint: row.checkpoint,
        statusChannel: row.statusChannel,
        nextAction: row.nextAction,
      }))),
      ...((literalContracts.restartDigest?.rows ?? []).map((row, index) => Object.freeze({
        sequence: preview.timeline.length
          + runtimeEvents.length
          + (persistedState.statusLedger?.rows?.length ?? 0)
          + (clientSession?.commandQueue?.length ?? 0)
          + (literalContracts.resumeManifest?.rows?.length ?? 0)
          + index + 1,
        source: "literal-restart-digest",
        label: row.commandId,
        state: row.restartSafe ? "restart-safe" : "blocked",
        checkpoint: row.checkpoint,
        statusChannel: row.statusChannel,
        nextAction: row.nextAction,
      }))),
      ...((comments.analyticsReport?.timeline ?? []).map((event, index) => Object.freeze({
        sequence: preview.timeline.length
          + runtimeEvents.length
          + (persistedState.statusLedger?.rows?.length ?? 0)
          + (clientSession?.commandQueue?.length ?? 0)
          + (literalContracts.resumeManifest?.rows?.length ?? 0)
          + (literalContracts.restartDigest?.rows?.length ?? 0)
          + index + 1,
        source: event.source,
        label: event.label,
        state: event.state,
        checkpoint: event.checkpoint,
        statusChannel: event.statusChannel,
        nextAction: event.nextAction,
      }))),
      ...((literalContracts.exportAuditBundle?.timeline ?? []).map((event, index) => Object.freeze({
        sequence: preview.timeline.length
          + runtimeEvents.length
          + (persistedState.statusLedger?.rows?.length ?? 0)
          + (clientSession?.commandQueue?.length ?? 0)
          + (literalContracts.resumeManifest?.rows?.length ?? 0)
          + (literalContracts.restartDigest?.rows?.length ?? 0)
          + (comments.analyticsReport?.timeline?.length ?? 0)
          + index + 1,
        source: event.source,
        label: event.label,
        state: event.state,
        checkpoint: literalContracts.exportAuditBundle?.handoff?.checkpoint ?? runtimeAdoption.handoff.checkpoint,
        statusChannel: literalContracts.exportAuditBundle?.handoff?.statusChannel ?? runtimeAdoption.handoff.statusChannel,
        nextAction: event.nextAction,
      }))),
    ]),
    exportReady: Object.freeze({
      accepted: operationalHealth.state === "healthy" || operationalHealth.state === "warming",
      replayState: persistedState.replayState,
      checkpoint: persistedState.checkpoint,
      commentExportReady: comments.exportSummary?.exportReady === true,
      commentExportPackageReady: comments.exportPackage?.handoff?.ready !== false,
      commentAnalyticsReportReady: comments.analyticsReport?.handoff?.ready !== false,
      literalExportAuditReady: literalContracts.exportAuditBundle?.handoff?.ready !== false,
      literalExportPackageReady: literalContracts.exportPackage?.handoff?.ready !== false,
      literalReleaseReportReady: literalContracts.releaseReport?.handoff?.ready !== false,
      literalClientReadinessReady: literalContracts.clientReadiness?.handoff?.ready !== false,
      literalResumeManifestReady: literalContracts.resumeManifest?.handoff?.ready !== false,
      literalRestartDigestReady: literalContracts.restartDigest?.handoff?.ready !== false,
      recoveryResumeManifestAccepted: recoveryStatus.resumeManifest?.accepted === true,
      recoveryRestartDigestAccepted: recoveryStatus.restartDigest?.accepted === true,
      literalHealthState: literalContracts.operationalHealth?.state ?? "unknown",
      surfaceReconciliationReady: reconciliation?.handoff?.ready !== false,
      deploymentGateReady: persistedState.deploymentLedger?.ready === true,
      syncBridgeReady: syncBridge?.handoff?.ready !== false,
      clientSessionReady: clientSession?.handoff?.ready === true,
      statusLedgerReady: persistedState.statusLedger?.handoff?.ready !== false,
      nextAction: operationalHealth.nextAction,
    }),
  });
}

function incidentDiagnostic(code, severity, message, recovery, detail = {}) {
  return Object.freeze({
    code,
    severity,
    message,
    line: 1,
    column: 1,
    offset: 0,
    recovery,
    detail: Object.freeze(detail),
  });
}

function buildMailchimpIncidentSeed(comments, literalContracts, reconciliation) {
  const diagnostics = [];
  const literalHealth = literalContracts.operationalHealth ?? {};
  const commentRuntime = comments.runtimeState ?? {};
  const commentSync = comments.syncPreview ?? {};
  const literalSync = literalContracts.syncBridge ?? {};
  const commentDeployment = comments.deploymentIntent ?? {};
  const literalDeployment = literalContracts.deploymentPlan ?? {};
  const literalReadiness = literalContracts.clientReadiness ?? {};

  for (const failure of literalHealth.failures ?? []) {
    diagnostics.push(incidentDiagnostic(
      "AIOS_MAILCHIMP_INCIDENT_ACTIVE",
      "error",
      `Mailchimp literal health failure: ${failure.detail}`,
      failure.action ?? "repair_literal_operational_health",
      { source: "literal-health", key: failure.key, failureCode: failure.code },
    ));
  }
  for (const event of literalHealth.degraded ?? []) {
    diagnostics.push(incidentDiagnostic(
      "AIOS_MAILCHIMP_INCIDENT_RETRY_PENDING",
      "warning",
      `Mailchimp literal health is degraded: ${event.detail}`,
      event.action ?? "review_literal_operational_health",
      { source: "literal-health", key: event.key, failureCode: event.code },
    ));
  }
  if (commentRuntime.persistedView?.restartSafe === false) {
    diagnostics.push(incidentDiagnostic(
      "AIOS_MAILCHIMP_INCIDENT_ACTIVE",
      "error",
      "Comment runtime commands are not restart-safe for Mailchimp replay.",
      commentRuntime.resume?.nextAction ?? "repair_comment_runtime_state",
      { source: "comment-runtime", blockers: commentRuntime.persistedView.blockedCommandIds ?? [] },
    ));
  }
  if (commentSync.handoff?.ready === false) {
    diagnostics.push(incidentDiagnostic(
      "AIOS_MAILCHIMP_INCIDENT_RETRY_PENDING",
      "warning",
      "Comment sync preview is not ready for Mailchimp handoff.",
      commentSync.handoff.nextAction ?? "repair_comment_sync_preview",
      { source: "comment-sync", blockers: commentSync.acceptance?.blockedBy ?? [] },
    ));
  }
  if (literalSync.handoff?.ready === false) {
    diagnostics.push(incidentDiagnostic(
      "AIOS_MAILCHIMP_INCIDENT_ACTIVE",
      "error",
      "Literal sync bridge is not ready for Mailchimp handoff.",
      literalSync.handoff.nextAction ?? "repair_literal_sync_bridge",
      { source: "literal-sync", blockers: literalSync.blockers ?? [] },
    ));
  }
  if (commentDeployment.handoff?.ready === false || literalDeployment.handoff?.ready === false) {
    diagnostics.push(incidentDiagnostic(
      "AIOS_MAILCHIMP_INCIDENT_ACTIVE",
      "error",
      "Mailchimp deployment intent is blocked before runtime adoption.",
      commentDeployment.handoff?.ready === false
        ? commentDeployment.handoff.nextAction
        : literalDeployment.handoff?.nextAction ?? "repair_literal_deployment_plan",
      {
        source: "deployment",
        commentBlockers: commentDeployment.blockers ?? [],
        literalBlockers: literalDeployment.blockers ?? [],
      },
    ));
  }
  if (literalReadiness.handoff?.ready === false) {
    diagnostics.push(incidentDiagnostic(
      "AIOS_MAILCHIMP_INCIDENT_ACTIVE",
      "error",
      "Literal client readiness is blocked for Mailchimp runtime adoption.",
      literalReadiness.handoff.nextAction ?? "repair_literal_client_readiness",
      { source: "literal-client-readiness", blockers: literalReadiness.acceptance?.blockedBy ?? [] },
    ));
  }
  for (const issue of reconciliation?.issues ?? []) {
    diagnostics.push(incidentDiagnostic(
      issue.severity === "error" ? "AIOS_MAILCHIMP_INCIDENT_ACTIVE" : "AIOS_MAILCHIMP_INCIDENT_RETRY_PENDING",
      issue.severity,
      issue.detail,
      issue.action,
      { source: "surface-reconciliation", subject: issue.subject, issueCode: issue.code },
    ));
  }

  const failures = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  return Object.freeze({
    schema: "aios.symbol-table.mailchimp-incident-seed.v1",
    state: failures.length > 0 ? "failed" : warnings.length > 0 ? "degraded" : "healthy",
    failureCount: failures.length,
    degradedCount: warnings.length,
    diagnostics: Object.freeze(diagnostics),
    nextAction: diagnostics[0]?.recovery ?? "monitor_mailchimp_operational_health",
  });
}

function incidentRowsFromSources({ comments, literalContracts, recoveryStatus, operationalHealth, persistedState, deploymentGate, syncBridge, clientSession, incidentSeed }) {
  const rows = [];
  const addRow = (source, subject, state, severity, nextAction, detail, restartSafe = true) => {
    rows.push(Object.freeze({
      schema: "aios.symbol-table.mailchimp-incident-row.v1",
      order: rows.length + 1,
      source,
      subject: compact(subject) || source,
      state,
      severity,
      checkpoint: persistedState.recoveryPath?.resumeCheckpoint ?? persistedState.checkpoint,
      statusChannel: persistedState.statusChannel,
      restartSafe,
      retryable: restartSafe && state !== "failed",
      nextAction,
      detail,
    }));
  };

  for (const diagnostic of incidentSeed.diagnostics ?? []) {
    addRow(
      diagnostic.detail?.source ?? "diagnostic",
      diagnostic.detail?.key ?? diagnostic.detail?.subject ?? diagnostic.code,
      diagnostic.severity === "error" ? "failed" : "degraded",
      diagnostic.severity,
      diagnostic.recovery,
      diagnostic.message,
      diagnostic.severity !== "error",
    );
  }
  for (const failure of operationalHealth.failures ?? []) {
    addRow("symbol-health", failure.code, "failed", "error", failure.action, failure.detail, false);
  }
  for (const event of operationalHealth.degraded ?? []) {
    addRow("symbol-health", event.code, "degraded", "warning", event.action, event.detail, true);
  }
  for (const blocker of persistedState.recoveryLedger?.blockedCommands ?? []) {
    addRow("recovery-ledger", blocker, "blocked", "error", persistedState.recoveryPath?.nextAction ?? recoveryStatus.nextAction, blocker, false);
  }
  for (const blocker of deploymentGate?.blockers ?? []) {
    addRow("deployment-gate", blocker, "blocked", "error", deploymentGate.handoff?.nextAction ?? "repair_mailchimp_deployment_gate", blocker, false);
  }
  for (const blocker of syncBridge?.blockers ?? []) {
    addRow("sync-bridge", blocker, "blocked", "error", syncBridge.handoff?.nextAction ?? "reconcile_mailchimp_sync_bridge", blocker, false);
  }
  for (const review of syncBridge?.review ?? []) {
    addRow("sync-bridge", review, "review", "warning", syncBridge.handoff?.nextAction ?? "review_mailchimp_sync_bridge", review, true);
  }
  for (const blocker of clientSession?.acceptance?.blockedBy ?? []) {
    addRow("client-session", blocker, "blocked", "error", clientSession.handoff?.nextAction ?? "repair_mailchimp_client_session", blocker, false);
  }
  if (comments.syncPreview?.handoff?.ready === true && literalContracts.syncBridge?.handoff?.ready === true && rows.length === 0) {
    addRow("mailchimp-runtime", "sync-and-adoption", "healthy", "info", "monitor_mailchimp_operational_health", "Mailchimp sync, deployment, and runtime handoff have no active incidents.", true);
  }

  return Object.freeze(rows.sort((left, right) => `${left.state}:${left.source}:${left.subject}`.localeCompare(`${right.state}:${right.source}:${right.subject}`))
    .map((row, index) => Object.freeze({ ...row, order: index + 1 })));
}

function buildMailchimpOperationalIncidentReport(parts) {
  const { recoveryStatus, persistedState, runtimeAdoption, operationalHealth, incidentSeed } = parts;
  const rows = incidentRowsFromSources(parts);
  const failures = rows.filter((row) => row.severity === "error" || row.state === "failed" || row.state === "blocked");
  const degraded = rows.filter((row) => row.severity === "warning" || row.state === "degraded" || row.state === "review");
  const retryableRows = rows.filter((row) => row.retryable);
  const state = failures.length > 0
    ? "failed"
    : degraded.length > 0 ? "degraded" : "healthy";
  const lifecyclePlan = buildAiosRecoveryLifecyclePlan(incidentSeed.diagnostics ?? [], {
    adapter: runtimeAdoption.requestState.adapter,
    service: runtimeAdoption.requestState.service,
    statusChannel: runtimeAdoption.handoff.statusChannel,
    checkpoint: persistedState.recoveryPath?.resumeCheckpoint ?? runtimeAdoption.handoff.checkpoint,
    requestedCapabilities: ["status.read", "recovery.preview"],
    providedCapabilities: ["status.read", "recovery.preview", "recovery.patch.local"],
    incidentReport: Object.freeze({
      state,
      failureCount: failures.length,
    }),
    lifecycleSettings: Object.freeze({
      retryLimit: retryableRows.length > 0 ? 3 : 0,
      backoffSeconds: Math.max(15, operationalHealth.backoff?.seconds ?? 0),
      degradedMode: true,
      pauseExternalWrites: true,
    }),
  });

  return Object.freeze({
    schema: "aios.symbol-table.mailchimp-operational-incident-report.v1",
    revision: stableReportRevision([
      "incident",
      persistedState.revision,
      recoveryStatus.state,
      state,
      rows.length,
      failures.length,
      degraded.length,
    ]),
    state,
    rows,
    counters: Object.freeze({
      total: rows.length,
      failures: failures.length,
      degraded: degraded.length,
      retryable: retryableRows.length,
      restartSafe: rows.filter((row) => row.restartSafe).length,
    }),
    retry: Object.freeze({
      available: retryableRows.length > 0 && lifecyclePlan.retry.available === true,
      backoffSeconds: lifecyclePlan.retry.backoffSeconds || operationalHealth.backoff?.seconds || 0,
      resumeToken: persistedState.recoveryLedger?.resumeToken ?? "",
      nextAction: retryableRows[0]?.nextAction ?? lifecyclePlan.handoff.nextAction,
    }),
    lifecyclePlan,
    handoff: Object.freeze({
      ready: failures.length === 0 && lifecyclePlan.handoff.ready === true,
      checkpoint: persistedState.recoveryPath?.resumeCheckpoint ?? runtimeAdoption.handoff.checkpoint,
      statusChannel: runtimeAdoption.handoff.statusChannel,
      localOnly: runtimeAdoption.handoff.localOnly !== false || failures.length > 0,
      writesExternalSystem: runtimeAdoption.handoff.writesExternalSystem === true && failures.length === 0,
      nextAction: failures[0]?.nextAction
        ?? degraded[0]?.nextAction
        ?? lifecyclePlan.handoff.nextAction,
    }),
    statusPatch: Object.freeze({
      state: failures.length > 0 ? "blocked" : degraded.length > 0 ? "degraded" : "ready",
      nextAction: failures[0]?.nextAction
        ?? degraded[0]?.nextAction
        ?? "monitor_mailchimp_operational_health",
      message: failures[0]?.detail
        ?? degraded[0]?.detail
        ?? "Mailchimp runtime has no active operational incidents.",
    }),
  });
}

function stableReportRevision(parts) {
  return compact(parts.join(":"))
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "symbol-report:none";
}

function buildMailchimpProviderFreshnessBridge(comments, literalContracts, recoveryStatus) {
  const commentFreshness = comments.providerFreshness ?? {};
  const literalFreshness = literalContracts.providerFreshness ?? {};
  const rows = Object.freeze([
    ...(commentFreshness.rows ?? []).map((row) => Object.freeze({ ...row, surface: "comment" })),
    ...(literalFreshness.rows ?? []).map((row) => Object.freeze({ ...row, surface: "literal" })),
    Object.freeze({
      surface: "recovery",
      source: "recovery-provider",
      subject: recoveryStatus.providerContract?.provider?.service ?? "mailchimp",
      state: recoveryStatus.providerContract?.sync?.statusHandoffReady === false ? "blocked" : "fresh",
      checkpoint: recoveryStatus.handoff?.checkpoint ?? "",
      statusChannel: recoveryStatus.handoff?.statusChannel ?? "mailchimp.contract.status",
      freshnessSeconds: recoveryStatus.providerContract?.sync?.externalWriteRequested ? 300 : 0,
      restartSafe: recoveryStatus.restartSafe === true,
      localOnly: recoveryStatus.localOnly !== false,
      writesExternalSystem: recoveryStatus.writesExternalSystem === true,
      idempotencyKey: symbolId("provider-freshness", recoveryStatus.handoff?.resumeToken ?? "recovery", "recovery"),
      nextAction: "publish_recovery_provider_freshness",
    }),
  ].sort((left, right) => `${left.surface}:${left.source}:${left.subject}`.localeCompare(`${right.surface}:${right.source}:${right.subject}`))
    .map((row, index) => Object.freeze({
      schema: "aios.symbol-table.provider-freshness-row.v1",
      rowId: symbolId("provider-freshness-row", `${index + 1}:${row.surface}:${row.source}:${row.subject}`, "mailchimp"),
      order: index + 1,
      ...row,
    })));
  const blockedRows = rows.filter((row) => row.state === "blocked" || row.restartSafe === false || !row.idempotencyKey);
  const reviewRows = rows.filter((row) => row.state === "review");
  const externalRows = rows.filter((row) => row.writesExternalSystem);
  const staleRows = rows.filter((row) => Number(row.freshnessSeconds ?? 0) > 900);
  const state = blockedRows.length > 0 ? "blocked" : staleRows.length > 0 ? "stale" : reviewRows.length > 0 ? "review" : rows.length > 0 ? "fresh" : "empty";
  const nextAction = blockedRows[0]?.nextAction
    ?? staleRows[0]?.nextAction
    ?? reviewRows[0]?.nextAction
    ?? (rows.length > 0 ? "publish_mailchimp_provider_freshness_bridge" : "attach_mailchimp_provider_freshness");
  const slaRows = Object.freeze([
    ...(commentFreshness.sla?.rows ?? []).map((row) => Object.freeze({ ...row, surface: "comment" })),
    ...(literalFreshness.sla?.rows ?? []).map((row) => Object.freeze({ ...row, surface: "literal" })),
    Object.freeze({
      surface: "recovery",
      source: "recovery-provider",
      subject: recoveryStatus.providerContract?.provider?.service ?? "mailchimp",
      state: recoveryStatus.providerContract?.sync?.statusHandoffReady === false ? "blocked" : "within-sla",
      checkpoint: recoveryStatus.handoff?.checkpoint ?? "",
      statusChannel: recoveryStatus.handoff?.statusChannel ?? "mailchimp.contract.status",
      freshnessSeconds: recoveryStatus.providerContract?.sync?.externalWriteRequested ? 300 : 0,
      targetSeconds: recoveryStatus.providerContract?.sync?.externalWriteRequested ? 300 : 0,
      breach: recoveryStatus.providerContract?.sync?.statusHandoffReady === false,
      restartSafe: recoveryStatus.restartSafe === true,
      localOnly: recoveryStatus.localOnly !== false,
      writesExternalSystem: recoveryStatus.writesExternalSystem === true,
      idempotencyKey: symbolId("provider-sla", recoveryStatus.handoff?.resumeToken ?? "recovery", "recovery"),
      nextAction: recoveryStatus.providerContract?.sync?.statusHandoffReady === false
        ? recoveryStatus.providerContract?.nextAction ?? "repair_recovery_provider_handoff_sla"
        : "monitor_recovery_provider_handoff_sla",
    }),
  ].sort((left, right) => `${left.surface}:${left.source}:${left.subject}`.localeCompare(`${right.surface}:${right.source}:${right.subject}`))
    .map((row, index) => Object.freeze({
      schema: "aios.symbol-table.provider-handoff-sla-row.v1",
      rowId: symbolId("provider-sla-row", `${index + 1}:${row.surface}:${row.source}:${row.subject}`, "mailchimp"),
      order: index + 1,
      ...row,
    })));
  const slaBlockedRows = slaRows.filter((row) => row.state === "blocked" || row.restartSafe === false || row.breach === true);
  const slaStaleRows = slaRows.filter((row) => row.state === "stale");
  const slaExternalRows = slaRows.filter((row) => row.writesExternalSystem);
  const slaNextAction = slaBlockedRows[0]?.nextAction
    ?? slaStaleRows[0]?.nextAction
    ?? (slaRows.length > 0 ? "monitor_mailchimp_provider_handoff_sla" : "attach_mailchimp_provider_handoff_sla");
  const sla = Object.freeze({
    schema: "aios.symbol-table.provider-handoff-sla.v1",
    revision: symbolId("provider-handoff-sla", `${commentFreshness.sla?.revision ?? "comment"}:${literalFreshness.sla?.revision ?? "literal"}:${slaRows.length}:${slaBlockedRows.length}:${slaStaleRows.length}`, "mailchimp"),
    state: slaBlockedRows.length > 0 ? "blocked" : slaStaleRows.length > 0 ? "stale" : slaExternalRows.length > 0 ? "within-sla" : "local",
    rows: slaRows,
    counters: Object.freeze({
      rows: slaRows.length,
      commentRows: commentFreshness.sla?.counters?.rows ?? 0,
      literalRows: literalFreshness.sla?.counters?.rows ?? 0,
      blocked: slaBlockedRows.length,
      stale: slaStaleRows.length,
      withinSla: slaRows.filter((row) => row.state === "within-sla").length,
      local: slaRows.filter((row) => row.state === "local").length,
      externalWrites: slaExternalRows.length,
      maxFreshnessSeconds: Math.max(0, ...slaRows.map((row) => Number(row.freshnessSeconds ?? 0))),
      maxTargetSeconds: Math.max(0, ...slaRows.map((row) => Number(row.targetSeconds ?? 0))),
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: slaBlockedRows.length === 0,
      acceptedForExternalWrite: slaBlockedRows.length === 0 && slaStaleRows.length === 0 && slaExternalRows.length > 0,
      blockedBy: Object.freeze(slaBlockedRows.map((row) => `${row.surface}:${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze(slaStaleRows.map((row) => `${row.surface}:${row.source}:${row.subject}:stale`).sort()),
      nextAction: slaNextAction,
    }),
    handoff: Object.freeze({
      ready: slaBlockedRows.length === 0 && slaStaleRows.length === 0,
      checkpoint: slaRows.find((row) => row.checkpoint)?.checkpoint ?? recoveryStatus.handoff?.checkpoint ?? "",
      statusChannel: slaRows.find((row) => row.statusChannel)?.statusChannel ?? recoveryStatus.handoff?.statusChannel ?? "mailchimp.contract.status",
      localOnly: slaExternalRows.length === 0,
      writesExternalSystem: slaExternalRows.length > 0,
      nextAction: slaNextAction,
    }),
  });

  return Object.freeze({
    schema: "aios.symbol-table.provider-freshness-bridge.v1",
    revision: symbolId("provider-freshness-bridge", `${commentFreshness.revision ?? "comment"}:${literalFreshness.revision ?? "literal"}:${state}:${rows.length}`, "mailchimp"),
    state,
    rows,
    counters: Object.freeze({
      rows: rows.length,
      commentRows: commentFreshness.counters?.rows ?? 0,
      literalRows: literalFreshness.counters?.rows ?? 0,
      blocked: blockedRows.length,
      review: reviewRows.length,
      stale: staleRows.length,
      externalWrites: externalRows.length,
      maxFreshnessSeconds: Math.max(0, ...rows.map((row) => Number(row.freshnessSeconds ?? 0))),
      slaRows: sla.counters.rows,
      slaBlocked: sla.counters.blocked,
      slaStale: sla.counters.stale,
      slaWithinSla: sla.counters.withinSla,
    }),
    acceptance: Object.freeze({
      acceptedForRuntime: blockedRows.length === 0,
      acceptedForExternalWrite: blockedRows.length === 0 && externalRows.length > 0,
      blockedBy: Object.freeze(blockedRows.map((row) => `${row.surface}:${row.source}:${row.subject}:${row.nextAction}`).sort()),
      review: Object.freeze([...reviewRows, ...staleRows].map((row) => `${row.surface}:${row.source}:${row.subject}`).sort()),
      nextAction,
    }),
    persistedView: Object.freeze({
      restartSafe: blockedRows.length === 0,
      idempotencyKeys: Object.freeze(rows.map((row) => row.idempotencyKey).filter(Boolean).sort()),
      checkpoint: rows.find((row) => row.checkpoint)?.checkpoint ?? recoveryStatus.handoff?.checkpoint ?? "",
      statusChannel: rows.find((row) => row.statusChannel)?.statusChannel ?? recoveryStatus.handoff?.statusChannel ?? "mailchimp.contract.status",
      replayState: state === "blocked" ? "blocked" : "replayable",
    }),
    handoff: Object.freeze({
      ready: blockedRows.length === 0 && sla.handoff.ready === true,
      checkpoint: rows.find((row) => row.checkpoint)?.checkpoint ?? recoveryStatus.handoff?.checkpoint ?? "",
      statusChannel: rows.find((row) => row.statusChannel)?.statusChannel ?? recoveryStatus.handoff?.statusChannel ?? "mailchimp.contract.status",
      localOnly: externalRows.length === 0,
      writesExternalSystem: externalRows.length > 0,
      nextAction: blockedRows[0]?.nextAction ?? sla.handoff.nextAction ?? nextAction,
    }),
    sla,
  });
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
  const incidentSeed = buildMailchimpIncidentSeed(comments, literalContracts, reconciliation);
  const diagnostics = mergeRecoveryDiagnostics(
    program.diagnostics,
    comments.diagnostics,
    literalContracts.diagnostics,
    reconciliation.diagnostics,
    incidentSeed.diagnostics,
    symbolDiagnostics,
  );
  const recoveryStatus = buildAiosRecoveryStatus(diagnostics, {
    adapter: provider.adapter || literalProviders.adapter || "aios-language",
    service: provider.service || literalProviders.service || "mailchimp-contract-compiler",
    statusChannel: provider.statusChannel || literalProviders.sync?.statusChannels?.[0] || "aios.semantic.symbol-table",
    requestedCapabilities: ["status.read", "recovery.preview", ...negotiation.requestedCapabilities],
    providedCapabilities: ["status.read", "recovery.preview", "recovery.patch.local", ...negotiation.requestedCapabilities],
    syncMode: provider.sync?.mode,
    checkpoint: provider.sync?.checkpoint || literalProviders.sync?.checkpoints?.[0],
    externalWriteRequested: negotiation.sync.externalWriteRequested,
    allowExternalWrite: negotiation.sync.externalWriteAllowed,
    allowSourceRecovery: options.allowSourceRecovery === true,
    lifecycleSettings: options.recoveryLifecycleSettings,
    incidentReport: incidentSeed,
    literalIncidentSnapshot: literalContracts.incidentSnapshot,
    commentIncidentAnalytics: comments.incidentAnalytics,
    literalResumeManifest: literalContracts.resumeManifest,
    literalRestartDigest: literalContracts.restartDigest,
    controlIntent: Object.freeze({
      comment: comments.controlIntent,
      literal: literalContracts.controlIntent,
    }),
    syncBridge: Object.freeze({
      comment: comments.syncPreview,
      commentCommit: comments.providerCommitWindow,
      literal: literalContracts.syncBridge,
      literalCommit: literalContracts.providerCommitWindow,
    }),
  });
  const surfaceOperationalReport = buildSurfaceOperationalReport(comments, literalContracts);
  const lifecycleReadinessBridge = buildLifecycleReadinessBridge(comments, literalContracts);
  const campaignExportPreview = buildMailchimpCampaignExportPreview(comments, literalContracts, recoveryStatus);
  const surfaceControlPanel = buildMailchimpSurfaceControlPanel(comments, literalContracts, recoveryStatus);
  const sourceExternalHandoff = buildMailchimpSourceExternalHandoff(comments, literalContracts, recoveryStatus);
  const sourcePreviewAcceptance = buildMailchimpSourcePreviewAcceptance(
    comments,
    literalContracts,
    recoveryStatus,
    surfaceControlPanel,
    sourceExternalHandoff,
  );
  const providerFreshnessBridge = buildMailchimpProviderFreshnessBridge(comments, literalContracts, recoveryStatus);
  const preview = buildSymbolPreview(symbols, literalContracts, comments, sourcePreviewAcceptance);
  const acceptance = buildAcceptanceContract(
    symbols,
    literalContracts,
    comments,
    recoveryStatus,
    reconciliation,
    surfaceOperationalReport,
    lifecycleReadinessBridge,
    surfaceControlPanel,
    sourceExternalHandoff,
    sourcePreviewAcceptance,
  );
  const validationSummary = buildValidationSummary(diagnostics, recoveryStatus, acceptance);
  const nextSteps = buildExplainableNextSteps(preview, acceptance, recoveryStatus);
  const runtimeAdoption = buildMailchimpRuntimeAdoption(symbols, literalContracts, comments, acceptance, recoveryStatus, reconciliation);
  const workflowHandoff = buildMailchimpWorkflowHandoff(comments, literalContracts, runtimeAdoption, acceptance, recoveryStatus);
  const deploymentGate = buildMailchimpDeploymentGate(comments, literalContracts, runtimeAdoption, acceptance, recoveryStatus, reconciliation);
  const syncBridge = buildMailchimpSyncBridge(comments, literalContracts, recoveryStatus, negotiation, reconciliation);
  const persistedState = buildPersistedMailchimpState({
    symbols,
    literalContracts,
    comments,
    runtimeAdoption,
    recoveryStatus,
    acceptance,
    negotiation,
    reconciliation,
    deploymentGate,
    workflowHandoff,
    syncBridge,
    surfaceOperationalReport,
    lifecycleReadinessBridge,
  });
  const clientSession = buildMailchimpClientRuntimeSession({
    runtimeAdoption,
    persistedState,
    recoveryStatus,
    acceptance,
  });
  const sourceClientStatusAdoption = buildSourceClientStatusAdoption(comments, literalContracts, persistedState, clientSession);
  const sourceClientRequestAdoption = buildSourceClientRequestAdoption(
    comments,
    literalContracts,
    persistedState,
    clientSession,
    sourceClientStatusAdoption,
  );
  const sourceReviewPacket = buildMailchimpSourceReviewPacket(
    comments,
    literalContracts,
    sourcePreviewAcceptance,
    sourceClientRequestAdoption,
    providerFreshnessBridge,
  );
  const sourceClientResumeEnvelope = buildSourceClientResumeEnvelope(comments, literalContracts, persistedState, clientSession, sourceClientStatusAdoption);
  const operationalHealth = buildOperationalHealth({
    acceptance,
    runtimeAdoption,
    persistedState,
    recoveryStatus,
    comments,
    literalContracts,
    reconciliation,
    deploymentGate,
    syncBridge,
    surfaceOperationalReport,
    lifecycleReadinessBridge,
    clientSession,
    sourceClientStatusAdoption,
    sourceClientRequestAdoption,
    sourceClientResumeEnvelope,
  });
  const incidentReport = buildMailchimpOperationalIncidentReport({
    comments,
    literalContracts,
    recoveryStatus,
    operationalHealth,
    persistedState,
    runtimeAdoption,
    deploymentGate,
    syncBridge,
    surfaceOperationalReport,
    clientSession,
    sourceClientRequestAdoption,
    incidentSeed,
  });
  const operationalHealthWithIncidents = Object.freeze({
    ...operationalHealth,
    incidentCount: incidentReport.counters.total,
    incidentFailureCount: incidentReport.counters.failures,
    incidentRetryable: incidentReport.retry.available,
    incidentReportRevision: incidentReport.revision,
  });
  const providerServiceContract = buildMailchimpProviderServiceContract({
    comments,
    literalContracts,
    recoveryStatus,
    runtimeAdoption,
    operationalHealth: operationalHealthWithIncidents,
    sourceExternalHandoff,
  });
  const timelineReport = buildSymbolTimelineReport({
    preview,
    persistedState,
    runtimeAdoption,
    literalContracts,
    comments,
    recoveryStatus,
    operationalHealth: operationalHealthWithIncidents,
    reconciliation,
    syncBridge,
    surfaceOperationalReport,
    clientSession,
    sourceClientRequestAdoption,
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
    deploymentGate,
    workflowHandoff,
    syncBridge,
    runtimeAdoption,
    persistedState,
    clientSession,
    sourceClientStatusAdoption,
    sourceClientRequestAdoption,
    sourceClientResumeEnvelope,
    operationalHealth: operationalHealthWithIncidents,
    providerServiceContract,
    incidentReport,
    surfaceOperationalReport,
    lifecycleReadinessBridge,
    campaignExportPreview,
    surfaceControlPanel,
    sourceExternalHandoff,
    sourcePreviewAcceptance,
    sourceReviewPacket,
    providerFreshnessBridge,
    boundary: literalContracts.boundaryContract,
    boundaryCommandCenter: literalContracts.boundaryContract?.commandCenter,
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
      deploymentGate,
      workflowHandoff,
      syncBridge,
      runtimeAdoption,
      persistedState,
      statusLedger: persistedState.statusLedger,
      clientSession,
      sourceClientStatusAdoption,
      sourceClientRequestAdoption,
      sourceClientResumeEnvelope,
      operationalHealth: operationalHealthWithIncidents,
      providerServiceContract,
      incidentReport,
      boundary: literalContracts.boundaryContract,
      boundaryCommandCenter: literalContracts.boundaryContract?.commandCenter,
      commentExportPackage: comments.exportPackage,
      literalExportPackage: literalContracts.exportPackage,
      literalReleaseReport: literalContracts.releaseReport,
      literalResumeManifest: literalContracts.resumeManifest,
      literalRestartDigest: literalContracts.restartDigest,
      literalClientReadiness: literalContracts.clientReadiness,
      literalAnalyticsExportJournal: literalContracts.analyticsExportJournal,
      literalExportAuditBundle: literalContracts.exportAuditBundle,
      literalPreviewAcceptance: literalContracts.previewAcceptance,
      commentClientRequestSnapshot: comments.clientRequestSnapshot,
      literalClientRequestSnapshot: literalContracts.clientRequestSnapshot,
      commentSyncPreview: comments.syncPreview,
      literalSyncBridge: literalContracts.syncBridge,
      commentProviderCommitWindow: comments.providerCommitWindow,
      literalProviderCommitWindow: literalContracts.providerCommitWindow,
      commentControlIntent: comments.controlIntent,
      literalControlIntent: literalContracts.controlIntent,
      commentWorkflowHandoff: comments.workflowHandoff,
      literalWorkflowHandoff: literalContracts.workflowHandoff,
      commentClientStatusAdoption: comments.clientStatusAdoption,
      literalClientStatusAdoption: literalContracts.clientStatusAdoption,
      commentRecoveryAdoption: comments.recoveryAdoption,
      literalRecoveryAdoption: literalContracts.recoveryAdoption,
      commentOperationalReport: comments.operationalReport,
      commentAnalyticsReport: comments.analyticsReport,
      commentIncidentAnalytics: comments.incidentAnalytics,
      literalOperationalReport: literalContracts.operationalReport,
      literalIncidentSnapshot: literalContracts.incidentSnapshot,
      recoveryIncidentLifecycle: recoveryStatus.incidentLifecycle,
      recoveryControlIntentAcceptance: recoveryStatus.controlIntentAcceptance,
      surfaceOperationalReport,
      lifecycleReadinessBridge,
      campaignExportPreview,
      surfaceControlPanel,
      sourceExternalHandoff,
      sourcePreviewAcceptance,
      sourceReviewPacket,
      sourceClientRequestAdoption,
      providerFreshnessBridge,
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
      && table.boundary.tenantBoundaryLease.handoff.ready === true
      && table.runtimeAdoption.requestState.boundaryScope.tenantBoundaryLease.handoffReady === true
      && table.acceptance.accepted === true
      && table.reconciliation.handoff.ready === true
      && table.deploymentGate.handoff.ready === true
      && table.persistedState.recoveryPath.resumeFromCheckpoint === true
      && table.persistedState.deploymentLedger.ready === true
      && table.persistedState.syncBridgeLedger.ready === true
      && table.persistedState.boundaryLedger.tenantBoundaryLease.ready === true
      && table.persistedState.statusLedger.handoff.ready === true
      && table.persistedState.statusLedger.counters.rows >= table.comments.runtimeState.statusLedger.counters.rows
      && table.persistedState.literalClientReadinessLedger.ready === true
      && table.clientSession.handoff.ready === true
      && table.clientSession.validation.ok === true
      && table.clientSession.clientState.hydrated === true
      && table.comments.workflowHandoff.handoff.ready === true
      && table.literals.workflowHandoff.handoff.ready === true
      && table.comments.providerCommitWindow.handoff.ready === true
      && table.literals.providerCommitWindow.handoff.ready === true
      && table.persistedState.providerCommitWindowLedger.ready === true
      && table.comments.clientStatusAdoption.handoff.ready === true
      && table.literals.clientStatusAdoption.handoff.ready === true
      && table.comments.recoveryAdoption.handoff.ready === true
      && table.literals.recoveryAdoption.handoff.ready === true
      && table.comments.operationalReport.handoff.ready === true
      && table.comments.analyticsReport.handoff.ready === true
      && table.literals.operationalReport.handoff.ready === true
      && table.surfaceOperationalReport.handoff.ready === true
      && table.lifecycleReadinessBridge.handoff.ready === true
      && table.campaignExportPreview.handoff.ready === true
      && table.surfaceControlPanel.handoff.ready === true
      && table.comments.controlIntent.handoff.ready === true
      && table.literals.controlIntent.handoff.ready === true
      && table.status.controlIntentAcceptance.handoff.ready === true
      && table.surfaceControlPanel.counters.commentControlRows >= table.comments.controlIntent.counters.rows
      && table.surfaceControlPanel.counters.literalControlRows >= table.literals.controlIntent.counters.rows
      && table.sourceExternalHandoff.handoff.ready === true
      && table.comments.clientPreviewAcceptance.handoff.ready === true
      && table.sourcePreviewAcceptance.handoff.ready === true
      && table.sourceReviewPacket.handoff.ready === true
      && table.sourceReviewPacket.validationSummary.rows >= table.sourcePreviewAcceptance.validationSummary.rows
      && table.sourceReviewPacket.validationSummary.commentRows >= table.comments.mailchimpReviewPacket.validationSummary.rows
      && table.sourceReviewPacket.validationSummary.literalRows >= table.literals.mailchimpReviewPacket.validationSummary.rows
      && table.sourcePreviewAcceptance.validationSummary.rows >= table.comments.clientPreviewAcceptance.validationSummary.rows
      && table.preview.counts.sourcePreviewAcceptanceReady === 1
      && table.preview.counts.commentMailchimpReviewReady === 1
      && table.preview.counts.literalMailchimpReviewReady === 1
      && table.sourceExternalHandoff.counters.rows >= table.comments.externalHandoffState.counters.rows
      && table.surfaceControlPanel.counters.rows >= table.comments.providerHandoffPanel.counters.rows
      && table.surfaceControlPanel.counters.literalRows >= table.literals.operatorControlPanel.counters.rows
      && table.campaignExportPreview.preview.counters.rows >= table.literals.campaignExportReadiness.counters.rows
      && table.comments.lifecycleReadiness.handoff.ready === true
      && table.literals.lifecycleReadiness.handoff.ready === true
      && table.persistedState.recoveryAdoptionLedger.resumeFromCheckpoint === true
      && table.sourceClientStatusAdoption.handoff.ready === true
      && table.sourceClientRequestAdoption.handoff.ready === true
      && table.sourceClientRequestAdoption.clientState.hydrated === true
      && table.sourceClientRequestAdoption.capabilities.includes("mailchimp.campaign")
      && table.sourceClientStatusAdoption.counters.rows >= table.comments.clientStatusAdoption.counters.rows
      && table.comments.clientResumeEnvelope.handoff.ready === true
      && table.literals.clientResumeEnvelope.handoff.ready === true
      && table.literals.resumeManifest.handoff.ready === true
      && table.literals.resumeManifest.replay.available === true
      && table.literals.restartDigest.handoff.ready === true
      && table.persistedState.literalRestartDigestLedger.ready === true
      && table.status.restartDigest.accepted === true
      && table.status.resumeManifest.accepted === true
      && table.sourceClientResumeEnvelope.handoff.ready === true
      && table.sourceClientResumeEnvelope.clientState.hydrated === true
      && table.sourceClientResumeEnvelope.counters.rows >= table.sourceClientStatusAdoption.counters.rows
      && table.workflowHandoff.handoff.ready === true
      && table.workflowHandoff.preview.counters.rows >= table.comments.workflowHandoff.preview.counters.rows
      && table.operationalHealth.retryable === false
      && table.providerServiceContract.handoff.ready === true
      && table.providerFreshnessBridge.handoff.ready === true
      && table.providerFreshnessBridge.persistedView.restartSafe === true
      && table.providerFreshnessBridge.counters.rows >= table.comments.providerFreshness.counters.rows
      && table.providerServiceContract.counters.commentIncidents >= 1
      && table.providerServiceContract.counters.recoveryIncidents >= table.providerServiceContract.counters.commentIncidents
      && table.literals.releaseReport.releaseReady === true
      && table.literals.clientReadiness.handoff.ready === true
      && table.literals.analyticsExportJournal.handoff.ready === true
      && table.literals.exportAuditBundle.handoff.ready === true
      && table.exports.literalExportAuditBundle.handoff.ready === true
      && table.preview.counts.literalExportAuditReady === 1
      && table.timelineReport.counters.literalExportAuditReady === 1
      && table.runtimeAdoption.requestState.literalExportAuditBundle.ready === true
      && table.preview.counts.literalAnalyticsJournalExportReady >= 1
      && table.preview.counts.commentProviderCommitRows >= 1
      && table.preview.counts.literalProviderCommitRows >= 1
      && table.preview.counts.commentControlIntentReady === 1
      && table.preview.counts.literalControlIntentReady === 1
      && table.literals.deploymentPlan.handoff.ready === true
      && table.comments.deploymentIntent.handoff.ready === true
      && table.timelineReport.counters.literalReleaseReadyRows >= 1
      && table.timelineReport.counters.deploymentReady === 1
      && table.timelineReport.counters.syncBridgeReady === 1
      && table.timelineReport.counters.statusLedgerReady === 1
      && table.timelineReport.counters.tenantBoundaryLeaseReady === 1
      && table.timelineReport.counters.commentRecoveryAdoptionReady === 1
      && table.timelineReport.counters.literalRecoveryAdoptionReady === 1
      && table.timelineReport.counters.commentOperationalReportReady === 1
      && table.timelineReport.counters.commentAnalyticsReportReady === 1
      && table.preview.counts.commentAnalyticsReportExportReady >= 1
      && table.timelineReport.counters.literalOperationalReportReady === 1
      && table.timelineReport.counters.surfaceOperationalReportReady === 1
      && table.timelineReport.counters.literalClientReadinessReady === 1
      && table.timelineReport.counters.literalResumeManifestReady === 1
      && table.timelineReport.counters.literalRestartDigestReady === 1
      && table.timelineReport.counters.recoveryRestartDigestAccepted === 1
      && table.timelineReport.counters.recoveryResumeManifestAccepted === 1
      && table.timelineReport.counters.clientSessionReady === 1
      && table.timelineReport.counters.pendingCommands >= table.persistedState.commandSummary.total,
    symbolCount: table.symbols.length,
    state: table.status.state,
    health: table.operationalHealth.state,
  });
}
