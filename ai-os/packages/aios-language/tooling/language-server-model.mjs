import { buildAiosMailchimpManifest } from "./manifest-writer.mjs";
import { buildAiosMailchimpPackageScaffold } from "./package-scaffold.mjs";
import { buildCompletionPreviewContract } from "./completion-model.mjs";

export const LANGUAGE_SERVER_MODEL_PROTOCOL = "aios.language.mailchimp-language-server-model.v1";

function cleanText(value) {
  return String(value ?? "").trim();
}

function diagnostic(severity, code, message, path = "$", range = null, data = null) {
  return Object.freeze({
    severity,
    code,
    message,
    path,
    ...(range ? { range } : {}),
    ...(data ? { data } : {}),
  });
}

function lineRange(lineNumber) {
  const line = Math.max(0, Number(lineNumber ?? 1) - 1);
  return Object.freeze({
    start: Object.freeze({ line, character: 0 }),
    end: Object.freeze({ line, character: 120 }),
  });
}

function stableHash(value) {
  const source = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function countBy(values, selector) {
  const counts = new Map();
  for (const value of values) {
    const key = cleanText(selector(value)) || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.freeze(Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))));
}

function symbolForJob(job, index) {
  return Object.freeze({
    name: job.name || job.id || `job-${index + 1}`,
    kind: "Job",
    path: `$.compileResult.jobs[${index}]`,
    detail: `${job.adapter}:${job.action}`,
    range: lineRange(job.lineNumber ?? index + 1),
    children: Object.freeze([
      ...job.capabilities.map((capability) => Object.freeze({
        name: capability.name,
        kind: "Capability",
        path: `$.compileResult.jobs[${index}].capabilities`,
        detail: capability.mode || "use",
      })),
      ...job.verifiers.map((verifier) => Object.freeze({
        name: cleanText(verifier.name ?? verifier.id ?? verifier) || "verifier",
        kind: "Verifier",
        path: `$.compileResult.jobs[${index}].verifiers`,
        detail: "runtime assertion",
      })),
    ]),
  });
}

function createRouteClientPreview(manifestContract, scaffoldContract, completionPreview, status) {
  const providerHandoff = scaffoldContract.providerServiceHandoff;
  const acceptancePacket = scaffoldContract.acceptancePacket ?? null;
  const accepted = completionPreview.clientRuntimeHandoff.accepted
    && providerHandoff?.clientContract?.restartSafe === true
    && acceptancePacket?.readiness?.ready !== false
    && status !== "blocked";
  const ready = completionPreview.validationSummary.readyForAcceptance
    && providerHandoff?.negotiation?.state === "negotiated"
    && acceptancePacket?.validationSummary?.readyForAcceptance !== false
    && status !== "blocked";
  const blockers = Object.freeze([
    ...(status === "blocked" ? ["language-server-blocked"] : []),
    ...(completionPreview.validationSummary.blocking ?? []),
    ...(acceptancePacket?.validationSummary?.blocking ?? []),
    ...((providerHandoff?.negotiation?.missingScopes ?? []).map((scope) => `scope.${scope}`)),
    ...(providerHandoff?.syncMetadata?.syncChannel ? [] : ["sync-channel-missing"]),
    ...(providerHandoff?.clientContract?.restartSafe ? [] : ["provider-restart-not-safe"]),
  ]);
  const uniqueBlockers = Object.freeze([...new Set(blockers)].sort());
  const readinessSignals = Object.freeze({
    completionReady: completionPreview.validationSummary.readyForAcceptance,
    packageAcceptanceReady: acceptancePacket?.readiness?.ready === true,
    providerNegotiated: providerHandoff?.negotiation?.state === "negotiated",
    providerRestartSafe: providerHandoff?.clientContract?.restartSafe === true,
    languageServerStatus: status,
  });
  const routeFields = Object.freeze([
    "sourceHash",
    "manifestHash",
    "acceptancePacket",
    "providerServiceHandoff",
    "completionAcceptance",
    "clientRuntimeHandoff",
    "nextAction",
  ]);
  const nextAction = accepted
    ? "publish-route-client-handoff"
    : ready
      ? acceptancePacket?.nextAction || completionPreview.acceptance.nextAction
      : uniqueBlockers.includes("provider-restart-not-safe")
        ? "repair-mailchimp-provider-restart"
        : acceptancePacket?.nextSteps?.[0]?.nextAction
          || completionPreview.nextSteps[0]?.nextAction
          || providerHandoff?.externalHandoff?.nextAction
          || "repair-language-server-model";

  return Object.freeze({
    protocol: "aios.language.mailchimp-route-client-preview.v1",
    state: accepted ? "accepted" : ready ? "ready" : "blocked",
    ready,
    accepted,
    sourceHash: manifestContract.manifest.sourceHash,
    manifestHash: manifestContract.manifestHash,
    routeFields,
    readinessSignals,
    validationSummary: completionPreview.validationSummary,
    packageAcceptance: acceptancePacket,
    acceptance: completionPreview.acceptance,
    clientRuntimeHandoff: completionPreview.clientRuntimeHandoff,
    providerServiceHandoff: providerHandoff,
    blockers: uniqueBlockers,
    request: Object.freeze({
      command: "aios.mailchimp.routeClient.acceptProviderHandoff",
      method: "POST",
      bodyFields: routeFields,
      idempotencyKey: stableHash([
        "mailchimp-route-client",
        completionPreview.clientRuntimeHandoff.clientRequest.idempotencyKey,
        acceptancePacket?.request?.idempotencyKey,
        uniqueBlockers.join("|"),
      ].join(":")),
      acceptancePacketId: acceptancePacket?.packetId ?? "",
    }),
    handoffSummary: Object.freeze({
      title: "Mailchimp route client handoff",
      state: accepted ? "accepted" : ready ? "ready" : "blocked",
      packageName: scaffoldContract.packageName,
      provider: providerHandoff?.provider ?? "mailchimp",
      service: providerHandoff?.service ?? "campaign-sync",
      syncChannel: providerHandoff?.syncMetadata?.syncChannel ?? "",
      externalStatusField: providerHandoff?.externalHandoff?.statusField ?? "",
      externalStatusValue: providerHandoff?.externalHandoff?.statusValue ?? "",
      acceptancePacketId: acceptancePacket?.packetId ?? "",
      nextAction,
    }),
    nextAction,
  });
}

function createAnalyticsSnapshot(manifestContract, scaffoldContract, diagnostics, codeActions, workspace, status, lifecycle, routeClientPreview) {
  const documentsByKind = countBy(workspace.documents, (document) => document.kind);
  const diagnosticsBySeverity = countBy(diagnostics, (entry) => entry.severity);
  const actionsByKind = countBy(codeActions, (action) => action.kind);
  const healthState = scaffoldContract.operationalHealth?.state ?? "unknown";
  const tenantState = manifestContract.manifest.tenantBoundary?.state ?? "unknown";
  const counters = Object.freeze({
    documents: workspace.documents.length,
    folders: workspace.folders.length,
    diagnostics: diagnostics.length,
    errors: diagnosticsBySeverity.error ?? 0,
    warnings: diagnosticsBySeverity.warn ?? 0,
    codeActions: codeActions.length,
    manifestFiles: manifestContract.manifest.files.length,
    scaffoldFiles: scaffoldContract.files.length,
    capabilities: manifestContract.manifest.kernel.capabilities.length,
    memoryScopes: manifestContract.manifest.kernel.memoryScopes.length,
    missingScopes: manifestContract.manifest.mailchimp.missingScopes.length,
    lifecycleCommands: lifecycle.commands.length,
    enabledCommands: lifecycle.commands.filter((command) => command.enabled).length,
    disabledCommands: lifecycle.commands.filter((command) => !command.enabled).length,
    routeClientReady: routeClientPreview.ready ? 1 : 0,
    routeClientAccepted: routeClientPreview.accepted ? 1 : 0,
    routeClientBlockers: routeClientPreview.blockers.length,
    packageAcceptanceReady: routeClientPreview.packageAcceptance?.readiness?.ready ? 1 : 0,
    packageAcceptanceWarnings: routeClientPreview.packageAcceptance?.readiness?.warnings?.length ?? 0,
  });
  const timeline = Object.freeze([
    Object.freeze({
      ordinal: 1,
      event: "manifest-shaped",
      state: manifestContract.status.state,
      hash: manifestContract.manifestHash,
      nextAction: manifestContract.status.nextAction,
    }),
    Object.freeze({
      ordinal: 2,
      event: "tenant-boundary-shaped",
      state: tenantState,
      hash: manifestContract.manifest.tenantBoundary?.isolationKey ?? "missing",
      nextAction: manifestContract.manifest.tenantBoundary?.audit?.nextAction ?? "repair-mailchimp-tenant-boundary",
    }),
    Object.freeze({
      ordinal: 3,
      event: "scaffold-shaped",
      state: scaffoldContract.status.state,
      hash: stableHash(scaffoldContract.files.map((file) => file.contentHash).join(":")),
      nextAction: scaffoldContract.status.nextAction,
    }),
    Object.freeze({
      ordinal: 4,
      event: "language-server-indexed",
      state: status,
      hash: stableHash(`${workspace.documents.length}:${diagnostics.length}:${codeActions.length}`),
      nextAction: status === "blocked" ? "repair-language-server-model" : scaffoldContract.status.nextAction,
    }),
    Object.freeze({
      ordinal: 5,
      event: "lifecycle-controls-shaped",
      state: lifecycle.state,
      hash: lifecycle.controlHash,
      nextAction: lifecycle.nextAction,
    }),
    Object.freeze({
      ordinal: 6,
      event: "route-client-preview-shaped",
      state: routeClientPreview.state,
      hash: stableHash(`${routeClientPreview.request.idempotencyKey}:${routeClientPreview.blockers.join("|")}`),
      nextAction: routeClientPreview.nextAction,
    }),
    Object.freeze({
      ordinal: 7,
      event: "package-acceptance-linked",
      state: routeClientPreview.packageAcceptance?.state ?? "missing",
      hash: routeClientPreview.packageAcceptance?.packetId ?? "missing",
      nextAction: routeClientPreview.packageAcceptance?.nextAction ?? "repair-mailchimp-package-acceptance",
    }),
  ]);
  const exportReady = status !== "blocked" && lifecycle.state !== "disabled" && counters.documents > 0 && counters.codeActions > 0 && routeClientPreview.blockers.length === 0;
  const report = Object.freeze({
    title: "Mailchimp language server export summary",
    status,
    exportReady,
    healthState,
    tenantState,
    primaryNextAction: exportReady ? scaffoldContract.status.nextAction : timeline.find((entry) => entry.state === "blocked")?.nextAction || "repair-language-server-model",
    counters,
  });

  return Object.freeze({
    protocol: "aios.language.mailchimp-language-server-analytics.v1",
    status,
    snapshotId: stableHash(`${manifestContract.manifestHash}:${scaffoldContract.status.state}:${status}:${diagnostics.length}:${codeActions.length}`),
    sourceHash: manifestContract.manifest.sourceHash,
    manifestHash: manifestContract.manifestHash,
    healthState,
    tenantState,
    counters,
    dimensions: Object.freeze({
      documentsByKind,
      diagnosticsBySeverity,
      actionsByKind,
    }),
    timeline,
    report,
    exportSummary: Object.freeze({
      protocol: "aios.language.mailchimp-language-server-export-summary.v1",
      ready: exportReady,
      snapshotId: stableHash(`${status}:${workspace.documents.map((document) => document.contentHash).join(":")}`),
      documentCount: counters.documents,
      diagnosticCount: counters.diagnostics,
      actionCount: counters.codeActions,
      nextAction: report.primaryNextAction,
      routeClientState: routeClientPreview.state,
      routeClientNextAction: routeClientPreview.nextAction,
      routeClientAcceptancePacketId: routeClientPreview.packageAcceptance?.packetId ?? "",
      routeClientHandoffSummary: routeClientPreview.handoffSummary,
    }),
  });
}

function createClientWorkflowHandoff(manifestContract, scaffoldContract, lifecycle, routeClientPreview, status) {
  const acceptancePacket = routeClientPreview.packageAcceptance ?? scaffoldContract.acceptancePacket ?? null;
  const tenantBoundary = manifestContract.manifest.tenantBoundary;
  const canAutoPublish = status !== "blocked"
    && lifecycle.state !== "disabled"
    && routeClientPreview.accepted
    && acceptancePacket?.readiness?.ready === true;
  const workflowState = canAutoPublish
    ? "publishable"
    : routeClientPreview.ready
      ? "awaiting-acceptance"
      : routeClientPreview.blockers.length > 0
        ? "repair-required"
        : "preview";
  const persistedFields = Object.freeze([
    "workflowId",
    "sourceHash",
    "manifestHash",
    "acceptancePacketId",
    "routeClientRequestId",
    "tenantIsolationKey",
    "nextAction",
  ]);
  const workflowId = stableHash([
    "mailchimp-client-workflow",
    manifestContract.manifest.sourceHash,
    acceptancePacket?.packetId,
    routeClientPreview.request.idempotencyKey,
    tenantBoundary?.isolationKey,
  ].join(":"));

  return Object.freeze({
    protocol: "aios.language.mailchimp-client-workflow-handoff.v1",
    workflowId,
    state: workflowState,
    publishable: canAutoPublish,
    restartSafe: Boolean(acceptancePacket?.request?.restartToken)
      && routeClientPreview.readinessSignals.providerRestartSafe,
    routeClientState: routeClientPreview.state,
    packageAcceptanceState: acceptancePacket?.state ?? "missing",
    persistedState: Object.freeze({
      key: stableHash(`${workflowId}:${routeClientPreview.request.idempotencyKey}`),
      fields: persistedFields,
      idempotent: true,
      writeMode: canAutoPublish ? "commit" : "preview",
      restartToken: acceptancePacket?.request?.restartToken ?? "",
    }),
    request: Object.freeze({
      command: canAutoPublish
        ? "aios.mailchimp.clientWorkflow.publish"
        : "aios.mailchimp.clientWorkflow.preview",
      method: "POST",
      bodyFields: persistedFields,
      idempotencyKey: stableHash([
        "mailchimp-client-workflow-request",
        workflowId,
        workflowState,
      ].join(":")),
    }),
    audit: Object.freeze({
      tenantId: tenantBoundary?.tenantId ?? "",
      tenantIsolationKey: tenantBoundary?.isolationKey ?? "",
      boundaryState: tenantBoundary?.state ?? "unknown",
      auditEvent: canAutoPublish
        ? "mailchimp-client-workflow-publishable"
        : "mailchimp-client-workflow-preview",
      nextAction: tenantBoundary?.audit?.nextAction ?? routeClientPreview.nextAction,
    }),
    nextAction: canAutoPublish
      ? "publish-mailchimp-client-workflow"
      : routeClientPreview.nextAction,
  });
}

function createLifecycleControls(manifestContract, scaffoldContract, options = {}) {
  const settings = options.settings && typeof options.settings === "object" ? options.settings : {};
  const serverEnabled = settings.enabled === false || options.enabled === false ? false : true;
  const requestedMode = cleanText(settings.mode || options.mode || (scaffoldContract.status.writeEnabled ? "write" : "preview"));
  const mode = ["preview", "write", "disabled"].includes(requestedMode) ? requestedMode : "preview";
  const requestedInterval = Number(settings.scheduleIntervalMs ?? options.scheduleIntervalMs ?? 5000);
  const scheduleIntervalMs = Number.isFinite(requestedInterval) && requestedInterval >= 250
    ? Math.min(Math.floor(requestedInterval), 300000)
    : 5000;
  const autoStart = settings.autoStart === false || options.autoStart === false ? false : true;
  const allowWrite = serverEnabled
    && mode === "write"
    && scaffoldContract.status.state === "write-plan-ready"
    && manifestContract.manifest.tenantBoundary?.safeBoundary?.canWritePackage === true;
  const diagnostics = Object.freeze([
    ...(!["preview", "write", "disabled"].includes(requestedMode)
      ? [diagnostic("warn", "AIOS_LSP_SETTING_MODE_INVALID", "Language server mode must be preview, write, or disabled.", "$.settings.mode", lineRange(1), { requestedMode, nextAction: "use-preview-language-server-mode" })]
      : []),
    ...(settings.scheduleIntervalMs !== undefined && (!Number.isFinite(Number(settings.scheduleIntervalMs)) || Number(settings.scheduleIntervalMs) < 250)
      ? [diagnostic("warn", "AIOS_LSP_SETTING_INTERVAL_INVALID", "Language server schedule interval must be at least 250ms.", "$.settings.scheduleIntervalMs", lineRange(1), { nextAction: "increase-language-server-schedule-interval" })]
      : []),
    ...(mode === "write" && !allowWrite
      ? [diagnostic("warn", "AIOS_LSP_WRITE_CONTROL_DISABLED", "Language server write lifecycle is disabled until scaffold and tenant boundaries allow writes.", "$.lifecycle.commands", lineRange(1), { nextAction: scaffoldContract.status.nextAction })]
      : []),
  ]);
  const state = !serverEnabled || mode === "disabled"
    ? "disabled"
    : diagnostics.some((entry) => entry.severity === "error")
      ? "blocked"
      : allowWrite
        ? "write-enabled"
        : "preview-enabled";
  const scheduler = Object.freeze({
    protocol: "aios.language.mailchimp-language-server-scheduler.v1",
    enabled: serverEnabled && mode !== "disabled",
    autoStart,
    intervalMs: scheduleIntervalMs,
    backoffMs: scaffoldContract.operationalHealth?.retry?.nextBackoffMs ?? 0,
    queue: Object.freeze([
      Object.freeze({
        id: "refresh-manifest",
        command: "aios.mailchimp.languageServer.refreshManifest",
        enabled: serverEnabled,
        afterMs: 0,
      }),
      Object.freeze({
        id: "refresh-scaffold-health",
        command: "aios.mailchimp.languageServer.refreshScaffoldHealth",
        enabled: serverEnabled,
        afterMs: scheduleIntervalMs,
      }),
      Object.freeze({
        id: "publish-status-handoff",
        command: "aios.mailchimp.languageServer.publishStatus",
        enabled: serverEnabled && scaffoldContract.status.state !== "health-blocked",
        afterMs: scheduleIntervalMs * 2,
      }),
    ]),
  });
  const commands = Object.freeze([
    Object.freeze({
      id: "enable-language-server",
      title: "Enable Mailchimp language server",
      enabled: !serverEnabled,
      command: "aios.mailchimp.languageServer.enable",
      nextState: "preview-enabled",
    }),
    Object.freeze({
      id: "disable-language-server",
      title: "Disable Mailchimp language server",
      enabled: serverEnabled,
      command: "aios.mailchimp.languageServer.disable",
      nextState: "disabled",
    }),
    Object.freeze({
      id: "preview-package-scaffold",
      title: "Preview Mailchimp package scaffold",
      enabled: serverEnabled,
      command: "aios.mailchimp.packageScaffold",
      nextState: "preview-enabled",
    }),
    Object.freeze({
      id: "write-package-scaffold",
      title: "Write Mailchimp package scaffold",
      enabled: allowWrite,
      command: "aios.mailchimp.packageScaffold.write",
      nextState: "write-enabled",
    }),
  ]);
  const nextAction = state === "disabled"
    ? "enable-mailchimp-language-server"
    : diagnostics[0]?.data?.nextAction
      || (allowWrite ? "write-mailchimp-package-scaffold" : "preview-mailchimp-package-scaffold");

  return Object.freeze({
    protocol: "aios.language.mailchimp-language-server-lifecycle.v1",
    state,
    settings: Object.freeze({
      enabled: serverEnabled,
      mode,
      autoStart,
      scheduleIntervalMs,
    }),
    scheduler,
    commands,
    diagnostics,
    controlHash: stableHash(`${serverEnabled}:${mode}:${scheduleIntervalMs}:${allowWrite}:${scaffoldContract.status.state}`),
    nextAction,
  });
}

function createCodeActions(manifestContract, scaffoldContract, routeClientPreview = null, clientWorkflowHandoff = null) {
  const mailchimp = manifestContract.manifest.mailchimp;
  const tenantBoundary = manifestContract.manifest.tenantBoundary;
  return Object.freeze([
    ...(mailchimp.missingScopes.length > 0
      ? [Object.freeze({
        title: "Negotiate Mailchimp provider capabilities",
        kind: "quickfix",
        diagnosticCode: "AIOS_MANIFEST_MAILCHIMP_SCOPE_GAP",
        command: "aios.mailchimp.negotiateCapabilities",
        arguments: Object.freeze([mailchimp.missingScopes]),
      })]
      : []),
    ...(!mailchimp.audienceId && !mailchimp.campaignId
      ? [Object.freeze({
        title: "Add Mailchimp audience or campaign identity",
        kind: "quickfix",
        diagnosticCode: "AIOS_CLI_MAILCHIMP_IDENTITY_REQUIRED",
        command: "aios.mailchimp.configureIdentity",
        arguments: Object.freeze([manifestContract.packageName]),
      })]
      : []),
    ...(tenantBoundary?.state === "blocked"
      ? [Object.freeze({
        title: "Repair Mailchimp tenant boundary",
        kind: "quickfix",
        diagnosticCode: "AIOS_MANIFEST_TENANT_BOUNDARY_BLOCKED",
        command: "aios.mailchimp.repairTenantBoundary",
        arguments: Object.freeze([tenantBoundary.tenantId, tenantBoundary.deniedPermissions]),
      })]
      : []),
    Object.freeze({
      title: scaffoldContract.status.state === "write-plan-ready" ? "Write Mailchimp package scaffold" : "Preview Mailchimp package scaffold",
      kind: "source",
      command: "aios.mailchimp.packageScaffold",
      arguments: Object.freeze([scaffoldContract.packageName, scaffoldContract.status.writeEnabled]),
    }),
    ...(routeClientPreview
      ? [Object.freeze({
        title: routeClientPreview.accepted ? "Publish Mailchimp route client handoff" : "Accept Mailchimp route client handoff",
        kind: routeClientPreview.ready ? "source" : "quickfix",
        diagnosticCode: routeClientPreview.ready ? "AIOS_LSP_ROUTE_CLIENT_HANDOFF_READY" : "AIOS_LSP_ROUTE_CLIENT_HANDOFF_BLOCKED",
        command: routeClientPreview.accepted
          ? "aios.mailchimp.routeClient.publishProviderHandoff"
          : "aios.mailchimp.routeClient.acceptProviderHandoff",
        arguments: Object.freeze([
          routeClientPreview.request.idempotencyKey,
          routeClientPreview.state,
          routeClientPreview.blockers,
        ]),
      })]
      : []),
    ...(clientWorkflowHandoff
      ? [Object.freeze({
        title: clientWorkflowHandoff.publishable ? "Publish Mailchimp client workflow" : "Preview Mailchimp client workflow",
        kind: clientWorkflowHandoff.publishable ? "source" : "quickfix",
        diagnosticCode: clientWorkflowHandoff.publishable
          ? "AIOS_LSP_CLIENT_WORKFLOW_PUBLISHABLE"
          : "AIOS_LSP_CLIENT_WORKFLOW_REPAIR_REQUIRED",
        command: clientWorkflowHandoff.publishable
          ? "aios.mailchimp.clientWorkflow.publish"
          : "aios.mailchimp.clientWorkflow.preview",
        arguments: Object.freeze([
          clientWorkflowHandoff.workflowId,
          clientWorkflowHandoff.request.idempotencyKey,
          clientWorkflowHandoff.state,
        ]),
      })]
      : []),
  ]);
}

function createWorkspaceModel(manifestContract, scaffoldContract) {
  return Object.freeze({
    packageName: manifestContract.packageName,
    sourceHash: manifestContract.manifest.sourceHash,
    manifestHash: manifestContract.manifestHash,
    folders: Object.freeze([
      Object.freeze({
        path: `packages/${manifestContract.packageName}`,
        kind: "mailchimp-runtime-package",
        status: scaffoldContract.status.state,
      }),
    ]),
    documents: Object.freeze(scaffoldContract.files.map((file) => Object.freeze({
      uri: `aios://${file.path}`,
      languageId: file.relativePath.endsWith(".mjs") ? "javascript" : "json",
      kind: file.kind,
      contentHash: file.contentHash,
      bytes: file.bytes,
    }))),
  });
}

export function buildAiosMailchimpLanguageServerModel(source = "", options = {}) {
  const manifestContract = options.manifestContract?.protocol
    ? options.manifestContract
    : buildAiosMailchimpManifest(source, options);
  const scaffoldContract = options.scaffoldContract?.protocol
    ? options.scaffoldContract
    : buildAiosMailchimpPackageScaffold(manifestContract, options);
  const compileResult = manifestContract.summary;
  const jobs = manifestContract.manifest.kernel.jobCount;
  const lifecycle = createLifecycleControls(manifestContract, scaffoldContract, options);
  const lspDiagnostics = Object.freeze([
    ...manifestContract.diagnostics.map((entry) => diagnostic(entry.severity, entry.code, entry.message, entry.path, lineRange(1), { nextAction: entry.nextAction })),
    ...scaffoldContract.diagnostics.map((entry) => diagnostic(entry.severity, entry.code, entry.message, entry.path, lineRange(1), { nextAction: entry.nextAction })),
    ...lifecycle.diagnostics,
    ...(jobs === 0
      ? [diagnostic("error", "AIOS_LSP_JOB_REQUIRED", "Mailchimp language server model needs at least one kernel job contract.", "$.manifest.kernel.jobCount", lineRange(1))]
      : []),
  ]);
  const symbols = Object.freeze((manifestContract.manifest.files ?? []).map((file, index) => Object.freeze({
    name: file.relativePath ?? file.path,
    kind: file.kind === "manifest" ? "Manifest" : "Artifact",
    path: `$.manifest.files[${index}]`,
    detail: file.status,
    range: lineRange(index + 1),
  })));
  const workspace = createWorkspaceModel(manifestContract, scaffoldContract);
  const status = lspDiagnostics.some((entry) => entry.severity === "error")
    ? "blocked"
    : lifecycle.state === "disabled"
      ? "disabled"
      : manifestContract.status.state === "publishable"
        ? "ready"
        : "preview";
  const completionPreview = buildCompletionPreviewContract(source, options);
  const routeClientPreview = createRouteClientPreview(manifestContract, scaffoldContract, completionPreview, status);
  const clientWorkflowHandoff = createClientWorkflowHandoff(
    manifestContract,
    scaffoldContract,
    lifecycle,
    routeClientPreview,
    status,
  );
  const codeActions = createCodeActions(manifestContract, scaffoldContract, routeClientPreview, clientWorkflowHandoff);
  const analytics = createAnalyticsSnapshot(manifestContract, scaffoldContract, lspDiagnostics, codeActions, workspace, status, lifecycle, routeClientPreview);

  return Object.freeze({
    protocol: LANGUAGE_SERVER_MODEL_PROTOCOL,
    command: "language-server-model",
    sourceHash: manifestContract.manifest.sourceHash,
    status,
    compile: compileResult,
    workspace,
    symbols,
    syntheticJobSymbols: Object.freeze((options.jobs ?? []).map(symbolForJob)),
    diagnostics: lspDiagnostics,
    codeActions,
    lifecycle,
    routeClientPreview,
    clientWorkflowHandoff,
    analytics,
    statusHandoff: Object.freeze({
      ...manifestContract.statusHandoff,
      languageServerStatus: status,
      diagnosticCount: lspDiagnostics.length,
      codeActionCount: codeActions.length,
      analyticsSnapshotId: analytics.snapshotId,
      exportReady: analytics.exportSummary.ready,
      lifecycleState: lifecycle.state,
      lifecycleControlHash: lifecycle.controlHash,
      schedulerEnabled: lifecycle.scheduler.enabled,
      routeClientState: routeClientPreview.state,
      routeClientReady: routeClientPreview.ready,
      routeClientAccepted: routeClientPreview.accepted,
      routeClientIdempotencyKey: routeClientPreview.request.idempotencyKey,
      packageAcceptancePacketId: routeClientPreview.packageAcceptance?.packetId ?? "",
      clientWorkflowState: clientWorkflowHandoff.state,
      clientWorkflowIdempotencyKey: clientWorkflowHandoff.request.idempotencyKey,
      nextAction: status === "blocked"
        ? lspDiagnostics.find((entry) => entry.severity === "error")?.data?.nextAction || "repair-language-server-model"
        : clientWorkflowHandoff.nextAction || routeClientPreview.nextAction || lifecycle.nextAction,
    }),
    recoveryHandoff: Object.freeze({
      ...scaffoldContract.recoveryHandoff,
      languageServerStatus: status,
      workspaceDocumentCount: workspace.documents.length,
      analyticsSnapshotId: analytics.snapshotId,
      analyticsTimeline: analytics.timeline,
      lifecycle: Object.freeze({
        state: lifecycle.state,
        settings: lifecycle.settings,
        scheduler: lifecycle.scheduler,
        commands: lifecycle.commands.map((command) => Object.freeze({
          id: command.id,
          enabled: command.enabled,
          nextState: command.nextState,
        })),
      }),
      routeClientPreview: Object.freeze({
        state: routeClientPreview.state,
        ready: routeClientPreview.ready,
        accepted: routeClientPreview.accepted,
        blockers: routeClientPreview.blockers,
        request: routeClientPreview.request,
        handoffSummary: routeClientPreview.handoffSummary,
        nextAction: routeClientPreview.nextAction,
      }),
      clientWorkflowHandoff: Object.freeze({
        workflowId: clientWorkflowHandoff.workflowId,
        state: clientWorkflowHandoff.state,
        publishable: clientWorkflowHandoff.publishable,
        restartSafe: clientWorkflowHandoff.restartSafe,
        persistedState: clientWorkflowHandoff.persistedState,
        request: clientWorkflowHandoff.request,
        audit: clientWorkflowHandoff.audit,
        nextAction: clientWorkflowHandoff.nextAction,
      }),
      nextAction: status === "blocked" ? "repair-language-server-model" : clientWorkflowHandoff.nextAction || routeClientPreview.nextAction || lifecycle.nextAction,
    }),
  });
}

export function assertAiosMailchimpLanguageServerModelReady(contract) {
  const diagnostics = [];
  if (contract?.protocol !== LANGUAGE_SERVER_MODEL_PROTOCOL) {
    diagnostics.push(diagnostic("error", "AIOS_LSP_PROTOCOL_INVALID", "Language server model protocol is missing or unsupported."));
  }
  if ((contract?.workspace?.documents?.length ?? 0) === 0) {
    diagnostics.push(diagnostic("error", "AIOS_LSP_DOCUMENTS_REQUIRED", "Language server model must expose projected package documents.", "$.workspace.documents"));
  }
  if ((contract?.codeActions?.length ?? 0) === 0) {
    diagnostics.push(diagnostic("error", "AIOS_LSP_CODE_ACTIONS_REQUIRED", "Language server model must expose recovery or scaffold code actions.", "$.codeActions"));
  }
  if (!contract?.statusHandoff?.nextAction) {
    diagnostics.push(diagnostic("error", "AIOS_LSP_NEXT_ACTION_REQUIRED", "Language server model must expose a deterministic next action.", "$.statusHandoff.nextAction"));
  }
  if (!contract?.analytics?.exportSummary?.snapshotId) {
    diagnostics.push(diagnostic("error", "AIOS_LSP_ANALYTICS_REQUIRED", "Language server model must expose analytics snapshots and export summaries.", "$.analytics.exportSummary"));
  }
  if (!contract?.lifecycle?.scheduler || !contract?.lifecycle?.commands) {
    diagnostics.push(diagnostic("error", "AIOS_LSP_LIFECYCLE_REQUIRED", "Language server model must expose lifecycle commands, settings validation, and scheduler state.", "$.lifecycle"));
  }
  if (!contract?.routeClientPreview?.request?.idempotencyKey) {
    diagnostics.push(diagnostic("error", "AIOS_LSP_ROUTE_CLIENT_PREVIEW_REQUIRED", "Language server model must expose route client preview and idempotent acceptance request state.", "$.routeClientPreview"));
  }
  if (!contract?.routeClientPreview?.packageAcceptance?.packetId) {
    diagnostics.push(diagnostic("error", "AIOS_LSP_PACKAGE_ACCEPTANCE_REQUIRED", "Language server model must consume scaffold package acceptance packet state.", "$.routeClientPreview.packageAcceptance"));
  }
  if (!contract?.clientWorkflowHandoff?.request?.idempotencyKey || !contract?.clientWorkflowHandoff?.persistedState?.key) {
    diagnostics.push(diagnostic("error", "AIOS_LSP_CLIENT_WORKFLOW_REQUIRED", "Language server model must expose restart-safe client workflow handoff state.", "$.clientWorkflowHandoff"));
  }
  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    nextAction: diagnostics[0]?.code || contract?.statusHandoff?.nextAction || "repair-language-server-model",
  });
}
