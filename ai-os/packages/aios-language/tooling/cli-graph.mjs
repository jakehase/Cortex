import {
  assertAiosCliInspectContractReady,
  buildAiosCliInspectContract,
} from "./cli-inspect.mjs";

const GRAPH_CONTRACT_PROTOCOL = "aios.language.cli-graph-contract.v1";

function cleanText(value) {
  return String(value ?? "").trim();
}

function stableList(values) {
  const seen = new Set();
  const output = [];
  for (const value of values ?? []) {
    const text = cleanText(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return Object.freeze(output.sort());
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

function diagnostic(severity, code, message, path = "$") {
  return Object.freeze({ severity, code, message, path });
}

function node(id, kind, label, state, data = {}) {
  return Object.freeze({
    id,
    kind,
    label,
    state,
    data: Object.freeze(data),
  });
}

function edge(from, to, relation, state, data = {}) {
  return Object.freeze({
    id: `${from}->${to}:${relation}`,
    from,
    to,
    relation,
    state,
    data: Object.freeze(data),
  });
}

function createGraphSettings(options = {}) {
  const settings = options.graphSettings ?? options.settings ?? {};
  const layout = cleanText(settings.layout) || "runtime";
  const schedule = cleanText(settings.schedule) || "manual";
  const enabled = settings.enabled !== false;
  const validLayouts = new Set(["runtime", "provider", "audit", "debug"]);
  const validSchedules = new Set(["manual", "on-inspect-ready", "on-provider-sync", "interval"]);
  const intervalMs = Number.isFinite(settings.intervalMs) ? Math.max(0, settings.intervalMs) : 0;
  const diagnostics = [];

  if (!validLayouts.has(layout)) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_GRAPH_LAYOUT_INVALID", "Graph layout must be runtime, provider, audit, or debug.", "$.graph.settings.layout"));
  }
  if (!validSchedules.has(schedule)) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_GRAPH_SCHEDULE_INVALID", "Graph schedule must be manual, on-inspect-ready, on-provider-sync, or interval.", "$.graph.settings.schedule"));
  }
  if (schedule === "interval" && intervalMs <= 0) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_GRAPH_INTERVAL_REQUIRED", "Interval graph scheduling requires a positive intervalMs value.", "$.graph.settings.intervalMs"));
  }

  return Object.freeze({
    valid: diagnostics.filter((entry) => entry.severity === "error").length === 0,
    diagnostics: Object.freeze(diagnostics),
    settings: Object.freeze({
      enabled,
      layout,
      schedule,
      intervalMs,
    }),
  });
}

function createGraphLifecycle(inspectContract, settingsValidation) {
  const settings = settingsValidation.settings;
  const provider = inspectContract.providerInspection;
  const runtime = inspectContract.runtimeInspection;
  const inspectReady = assertAiosCliInspectContractReady(inspectContract).ok;
  const providerBlocked = provider.blockedReasons.length > 0 || provider.negotiation.state === "blocked";
  const enabled = settings.enabled
    && settingsValidation.valid
    && inspectReady
    && providerBlocked !== true;
  const blockedBy = stableList([
    ...(!settings.enabled ? ["operator-disabled"] : []),
    ...(!settingsValidation.valid ? ["settings-invalid"] : []),
    ...(inspectReady ? [] : ["inspect-contract-invalid"]),
    ...(providerBlocked ? ["provider-graph-blocked"] : []),
    ...(runtime.state === "blocked" ? ["runtime-graph-blocked"] : []),
  ]);
  const canSchedule = enabled && settings.schedule !== "manual";
  const resumeWhen = settings.schedule === "on-provider-sync"
    ? "provider-sync-ready"
    : settings.schedule === "on-inspect-ready"
      ? "inspect-ready"
      : settings.schedule === "interval"
        ? "interval-elapsed"
        : "operator-request";
  const nextAction = enabled
    ? canSchedule
      ? settings.schedule === "interval"
        ? "schedule-graph-interval"
        : settings.schedule === "on-provider-sync"
          ? "schedule-graph-after-provider-sync"
          : "schedule-graph-after-inspect-ready"
      : "render-cli-runtime-graph"
    : blockedBy.includes("settings-invalid")
      ? "repair-graph-settings"
      : providerBlocked
        ? "resolve-provider-graph-blockers"
        : inspectContract.nextAction;

  return Object.freeze({
    protocol: "aios.language.cli-graph-lifecycle.v1",
    settings,
    controls: Object.freeze({
      enabled,
      paused: settings.enabled && !enabled,
      canEnable: settingsValidation.valid && inspectReady && providerBlocked !== true,
      canDisable: true,
      canSchedule,
      canRenderProviderGraph: enabled && provider.negotiation.providerCount > 0,
      canRenderAuditGraph: enabled && Boolean(inspectContract.summary.reportName),
    }),
    schedule: Object.freeze({
      mode: settings.schedule,
      queued: canSchedule,
      intervalMs: settings.schedule === "interval" ? settings.intervalMs : 0,
      resumeWhen,
      blockedBy,
    }),
    nextAction,
  });
}

function normalizeGraphBoundary(inspectContract, lifecycle, options = {}) {
  const persisted = inspectContract.persistedState;
  const boundary = inspectContract.summary?.boundary
    ?? inspectContract.boundaryProfile
    ?? {};
  const tenantId = cleanText(options.tenantId || inspectContract.statusHandoff?.tenantId || persisted?.checkpoint?.tenantId || boundary.tenantId)
    || "local";
  const workspaceId = cleanText(options.workspaceId || options.workspace || inspectContract.statusHandoff?.workspaceId || persisted?.checkpoint?.workspaceId || boundary.workspaceId)
    || "default";
  const requestedRole = cleanText(options.role || boundary.role || "reader");
  const allowedRoles = Object.freeze(["runtime-publisher", "preview-operator", "reader", "auditor"]);
  const role = allowedRoles.includes(requestedRole) ? requestedRole : "reader";
  const requestedPermissions = stableList([
    ...(Array.isArray(options.permissions) ? options.permissions : []),
    ...(inspectContract.providerInspection?.negotiation?.requiredCapabilities ?? []),
    "cli:graph:read",
    ...(lifecycle.settings.layout === "audit" ? ["cli:graph:audit"] : []),
    ...(lifecycle.settings.layout === "debug" ? ["cli:graph:debug"] : []),
  ]);
  const deniedPermissions = stableList([
    ...(role === "reader" && lifecycle.settings.layout !== "runtime" ? ["cli:graph:audit", "cli:graph:debug"] : []),
    ...(role === "auditor" && lifecycle.settings.layout === "debug" ? ["cli:graph:debug"] : []),
    ...(tenantId === "local" && lifecycle.settings.layout === "audit" ? ["mailchimp:tenant:identity"] : []),
    ...(workspaceId === "default" && lifecycle.settings.layout === "audit" ? ["mailchimp:workspace:identity"] : []),
    ...((inspectContract.providerInspection?.negotiation?.missingCapabilities ?? []).map((capability) => `missing:${capability}`)),
  ]);
  const allowedPermissions = Object.freeze(requestedPermissions
    .filter((permission) => !deniedPermissions.includes(permission))
    .sort());
  const persistedRestartSafe = persisted?.restartPlan?.restartSafe === true;
  const statusSnapshotValid = Boolean(persisted?.statusSnapshot?.snapshotId)
    && Boolean(persisted?.checkpoint?.checkpointId)
    && persisted?.checkpoint?.sourceHash === inspectContract.source.sourceHash;
  const isolationKey = stableHash([
    tenantId,
    workspaceId,
    role,
    inspectContract.source.sourceHash,
    persisted?.checkpoint?.idempotencyKey ?? "missing-idempotency",
  ].join(":"));
  const state = deniedPermissions.length > 0
    ? "blocked"
    : !statusSnapshotValid || !persistedRestartSafe
      ? "degraded"
      : "enforced";
  const auditEvents = Object.freeze([
    Object.freeze({
      id: "graph-boundary-shaped",
      level: state === "blocked" ? "error" : state === "degraded" ? "warn" : "info",
      tenantId,
      workspaceId,
      role,
      state,
    }),
    Object.freeze({
      id: "graph-permissions-shaped",
      level: deniedPermissions.length > 0 ? "warn" : "info",
      requested: requestedPermissions.length,
      allowed: allowedPermissions.length,
      denied: deniedPermissions.length,
    }),
    Object.freeze({
      id: "graph-persisted-status-linked",
      level: statusSnapshotValid && persistedRestartSafe ? "info" : "warn",
      checkpointId: persisted?.checkpoint?.checkpointId ?? "missing",
      snapshotId: persisted?.statusSnapshot?.snapshotId ?? "missing",
      restartSafe: persistedRestartSafe,
    }),
  ]);

  return Object.freeze({
    protocol: "aios.language.cli-graph-boundary.v1",
    state,
    tenantId,
    workspaceId,
    role,
    isolationKey,
    requestedPermissions,
    allowedPermissions,
    deniedPermissions,
    statusSnapshotValid,
    persistedRestartSafe,
    safeBoundary: Object.freeze({
      canRenderRuntime: state !== "blocked",
      canRenderAudit: state === "enforced" && ["runtime-publisher", "preview-operator", "auditor"].includes(role),
      canRenderDebug: state === "enforced" && role === "runtime-publisher",
      canReplayPersistedStatus: state !== "blocked" && statusSnapshotValid && persistedRestartSafe,
    }),
    audit: Object.freeze({
      protocol: "aios.language.cli-graph-audit-handoff.v1",
      queueHash: stableHash(auditEvents.map((event) => `${event.id}:${event.level}:${event.state ?? ""}`).join("|")),
      eventCount: auditEvents.length,
      events: auditEvents,
      nextAction: state === "blocked"
        ? "repair-cli-graph-boundary"
        : state === "degraded"
          ? "review-cli-graph-persisted-status"
          : "record-cli-graph-audit",
    }),
    nextAction: state === "blocked"
      ? "repair-cli-graph-boundary"
      : state === "degraded"
        ? "review-cli-graph-persisted-status"
        : lifecycle.nextAction,
  });
}

function createGraphNodes(inspectContract, lifecycle, boundary) {
  const provider = inspectContract.providerInspection;
  const runtime = inspectContract.runtimeInspection;
  const externalHandoff = inspectContract.externalHandoffInspection;
  const acceptance = inspectContract.acceptanceInspection;
  const summary = inspectContract.summary;
  const persisted = inspectContract.persistedState;
  const baseNodes = [
    node("source", "source", summary.sourceHash || inspectContract.source.sourceHash, "ready", {
      fileName: inspectContract.source.fileName,
      descriptors: summary.descriptors,
    }),
    node("compile", "tool", "compile", summary.status, {
      runtimeReady: summary.runtimeReady,
      capabilities: summary.capabilities,
    }),
    node("check", "tool", "check", inspectContract.statusHandoff.checkStatus ?? inspectContract.summary.status, {
      health: inspectContract.lifecycle.health.status,
      failureState: inspectContract.lifecycle.health.failureState,
    }),
    node("inspect", "tool", "inspect", inspectContract.readiness.ready ? "ready" : "blocked", {
      lifecycleEnabled: inspectContract.lifecycle.controls.enabled,
      nextAction: inspectContract.nextAction,
    }),
    node("provider", "provider", provider.provider, provider.negotiation.state, {
      syncState: provider.sync.state,
      requiredCapabilities: provider.negotiation.requiredCapabilities.length,
      missingCapabilities: provider.negotiation.missingCapabilities.length,
    }),
    node("runtime", "runtime", "runtime handoff", runtime.state, {
      command: runtime.handoff.runtimeCommand,
      restartSafe: runtime.handoff.restartSafe,
    }),
    node("external-handoff", "handoff", "Mailchimp external handoff", externalHandoff?.state ?? "not_attached", {
      provider: externalHandoff?.provider ?? provider.provider,
      readyCount: externalHandoff?.summary?.readyCount ?? 0,
      blockedCount: externalHandoff?.summary?.blockedCount ?? 0,
      nextAction: externalHandoff?.nextAction ?? "show-cli-inspection",
    }),
    node("acceptance", "handoff", "Runtime acceptance", acceptance?.state ?? "not_attached", {
      accepted: acceptance?.accepted === true,
      required: acceptance?.required === true,
      command: acceptance?.command ?? runtime.handoff.runtimeCommand,
      idempotencyKey: acceptance?.idempotencyKey ?? runtime.request.idempotencyKey,
      restartToken: acceptance?.restartToken ?? runtime.handoff.recoveryToken,
      rowCount: acceptance?.summary?.rowCount ?? 0,
      nextAction: acceptance?.nextAction ?? runtime.nextAction,
    }),
    node("persistence", "runtime", "Mailchimp persistence", runtime.handoff.persistenceState, {
      resumeToken: runtime.handoff.resumeToken,
      recoveryToken: runtime.handoff.recoveryToken,
      checkpointId: persisted?.checkpoint?.checkpointId ?? null,
      snapshotId: persisted?.statusSnapshot?.snapshotId ?? null,
      restartSafe: persisted?.restartPlan?.restartSafe === true,
    }),
    node("workspace-boundary", "boundary", `${boundary.tenantId}/${boundary.workspaceId}`, boundary.state, {
      role: boundary.role,
      isolationKey: boundary.isolationKey,
      deniedPermissions: boundary.deniedPermissions.length,
      canReplayPersistedStatus: boundary.safeBoundary.canReplayPersistedStatus,
    }),
    node("audit-handoff", "audit", "Graph audit handoff", boundary.audit.nextAction === "record-cli-graph-audit" ? "ready" : "review", {
      queueHash: boundary.audit.queueHash,
      eventCount: boundary.audit.eventCount,
      nextAction: boundary.audit.nextAction,
    }),
    node("graph", "tool", "graph", lifecycle.controls.enabled ? "ready" : "paused", {
      layout: lifecycle.settings.layout,
      nextAction: lifecycle.nextAction,
    }),
  ];

  const panelNodes = inspectContract.panels.map((panel) => node(
    `panel:${panel.id}`,
    "panel",
    panel.title,
    panel.status,
    {
      rowCount: panel.rows.length,
    },
  ));

  const handoffQueueNodes = (externalHandoff?.queue ?? []).map((entry) => node(
    `external-handoff:${entry.processId}`,
    "handoff-queue",
    entry.visibleLabel,
    entry.state,
    {
      capability: entry.capability,
      command: entry.command,
      provider: entry.provider,
      idempotencyKey: entry.idempotencyKey,
      syncCursor: entry.syncCursor,
    },
  ));

  return Object.freeze([...baseNodes, ...handoffQueueNodes, ...panelNodes]);
}

function createGraphEdges(inspectContract, lifecycle, boundary) {
  const provider = inspectContract.providerInspection;
  const runtime = inspectContract.runtimeInspection;
  const externalHandoff = inspectContract.externalHandoffInspection;
  const acceptance = inspectContract.acceptanceInspection;
  const baseEdges = [
    edge("source", "compile", "compiles-to", inspectContract.summary.status, {
      nextAction: inspectContract.summary.nextAction,
    }),
    edge("compile", "check", "validates", inspectContract.statusHandoff.checkStatus ?? "unknown", {
      requiredPassed: inspectContract.statusHandoff.requiredPassed,
    }),
    edge("check", "inspect", "feeds", inspectContract.readiness.ready ? "ready" : "blocked", {
      blockerCount: inspectContract.readiness.blockerCount,
    }),
    edge("inspect", "provider", "negotiates", provider.negotiation.state, {
      syncState: provider.sync.state,
      channel: provider.sync.channel,
    }),
    edge("provider", "runtime", "unblocks", runtime.state, {
      runtimeReady: runtime.ready,
      nextAction: runtime.nextAction,
    }),
    edge("provider", "external-handoff", "queues-external-handoff", externalHandoff?.state ?? "not_attached", {
      syncState: provider.sync.state,
      queueLength: externalHandoff?.queue?.length ?? 0,
      required: externalHandoff?.required === true,
    }),
    edge("external-handoff", "runtime", "adopts-client-state", runtime.state, {
      ready: externalHandoff?.ready === true,
      nextAction: externalHandoff?.nextAction ?? runtime.nextAction,
    }),
    edge("runtime", "acceptance", "requires-operator-acceptance", acceptance?.state ?? "not_attached", {
      required: acceptance?.required === true,
      accepted: acceptance?.accepted === true,
      command: acceptance?.command ?? runtime.handoff.runtimeCommand,
    }),
    edge("acceptance", "persistence", "commits-restart-safe-state", acceptance?.ready === true ? "ready" : "review", {
      idempotencyKey: acceptance?.idempotencyKey ?? runtime.request.idempotencyKey,
      restartToken: acceptance?.restartToken ?? runtime.handoff.recoveryToken,
      nextAction: acceptance?.nextAction ?? runtime.nextAction,
    }),
    edge("runtime", "persistence", "restores", runtime.handoff.persistenceState, {
      restartSafe: runtime.handoff.restartSafe,
    }),
    edge("persistence", "workspace-boundary", "scopes-replay", boundary.state, {
      checkpointId: inspectContract.persistedState?.checkpoint?.checkpointId ?? null,
      snapshotId: inspectContract.persistedState?.statusSnapshot?.snapshotId ?? null,
      statusSnapshotValid: boundary.statusSnapshotValid,
    }),
    edge("workspace-boundary", "audit-handoff", "emits-audit", boundary.audit.nextAction === "record-cli-graph-audit" ? "ready" : "review", {
      queueHash: boundary.audit.queueHash,
      deniedPermissions: boundary.deniedPermissions.length,
      nextAction: boundary.audit.nextAction,
    }),
    edge("workspace-boundary", "graph", "authorizes-render", boundary.safeBoundary.canRenderRuntime ? "ready" : "blocked", {
      canRenderAudit: boundary.safeBoundary.canRenderAudit,
      canRenderDebug: boundary.safeBoundary.canRenderDebug,
      canReplayPersistedStatus: boundary.safeBoundary.canReplayPersistedStatus,
    }),
    edge("inspect", "graph", "renders", lifecycle.controls.enabled ? "enabled" : "paused", {
      layout: lifecycle.settings.layout,
      schedule: lifecycle.schedule.mode,
    }),
  ];
  const panelEdges = inspectContract.panels.map((panel) => edge("inspect", `panel:${panel.id}`, "projects-panel", panel.status, {
    rowCount: panel.rows.length,
  }));
  const queueEdges = (externalHandoff?.queue ?? []).map((entry) => edge(
    "external-handoff",
    `external-handoff:${entry.processId}`,
    "contains-provider-work",
    entry.state,
    {
      capability: entry.capability,
      command: entry.command,
    },
  ));

  return Object.freeze([...baseEdges, ...queueEdges, ...panelEdges]);
}

function createBlockedPaths(nodes, edges, inspectContract, lifecycle, boundary) {
  const blockedNodeIds = new Set(nodes
    .filter((entry) => ["blocked", "failed", "unhealthy", "paused"].includes(entry.state))
    .map((entry) => entry.id));
  const blockedEdges = edges.filter((entry) => ["blocked", "failed", "paused"].includes(entry.state));
  const explicitReasons = stableList([
    ...inspectContract.readiness.blockedReasons,
    ...inspectContract.providerInspection.blockedReasons,
    ...inspectContract.runtimeInspection.blockedReasons,
    ...(inspectContract.externalHandoffInspection?.blockedReasons ?? []),
    ...(inspectContract.acceptanceInspection?.blockedReasons ?? []),
    ...lifecycle.schedule.blockedBy,
    ...boundary.deniedPermissions.map((permission) => `graph boundary denied: ${permission}`),
    ...(boundary.statusSnapshotValid ? [] : ["graph persisted status snapshot invalid"]),
    ...(boundary.persistedRestartSafe ? [] : ["graph persisted status is not restart safe"]),
  ]);

  return Object.freeze({
    nodeIds: Object.freeze([...blockedNodeIds].sort()),
    edges: Object.freeze(blockedEdges.map((entry) => entry.id).sort()),
    reasons: explicitReasons,
    firstBlockedNode: [...blockedNodeIds].sort()[0] ?? null,
    nextAction: explicitReasons.length > 0
      ? lifecycle.nextAction
      : inspectContract.nextAction,
  });
}

function createGraphSummary(nodes, edges, blockedPaths, lifecycle, inspectContract, boundary) {
  const providerNodes = nodes.filter((entry) => entry.kind === "provider").length;
  const runtimeNodes = nodes.filter((entry) => entry.kind === "runtime").length;
  const panelNodes = nodes.filter((entry) => entry.kind === "panel").length;
  const handoffNodes = nodes.filter((entry) => entry.kind === "handoff" || entry.kind === "handoff-queue").length;
  const acceptanceNode = nodes.find((entry) => entry.id === "acceptance");
  const renderable = lifecycle.controls.enabled
    && blockedPaths.reasons.length === 0
    && boundary.safeBoundary.canRenderRuntime
    && nodes.length > 0
    && edges.length > 0;

  return Object.freeze({
    protocol: "aios.language.cli-graph-summary.v1",
    renderable,
    layout: lifecycle.settings.layout,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    providerNodes,
    runtimeNodes,
    panelNodes,
    handoffNodes,
    acceptanceState: acceptanceNode?.state ?? "not_attached",
    acceptanceRequired: acceptanceNode?.data?.required === true,
    acceptanceAccepted: acceptanceNode?.data?.accepted === true,
    boundaryState: boundary.state,
    workspaceId: boundary.workspaceId,
    tenantId: boundary.tenantId,
    auditQueueHash: boundary.audit.queueHash,
    persistedStatusSnapshotId: inspectContract.persistedState?.statusSnapshot?.snapshotId ?? "missing",
    canReplayPersistedStatus: boundary.safeBoundary.canReplayPersistedStatus,
    blockedNodeCount: blockedPaths.nodeIds.length,
    blockedEdgeCount: blockedPaths.edges.length,
    providerSyncState: inspectContract.providerInspection.sync.state,
    externalHandoffState: inspectContract.externalHandoffInspection?.state ?? "not_attached",
    runtimeState: inspectContract.runtimeInspection.state,
    lifecycleEnabled: lifecycle.controls.enabled,
    nextAction: renderable ? "render-cli-runtime-graph" : blockedPaths.nextAction,
  });
}

export function buildAiosCliGraphContract(source = "", options = {}) {
  const inspectContract = options.inspectContract ?? buildAiosCliInspectContract(source, options);
  const settingsValidation = createGraphSettings(options);
  const lifecycle = createGraphLifecycle(inspectContract, settingsValidation);
  const boundary = normalizeGraphBoundary(inspectContract, lifecycle, options);
  const nodes = createGraphNodes(inspectContract, lifecycle, boundary);
  const edges = createGraphEdges(inspectContract, lifecycle, boundary);
  const blockedPaths = createBlockedPaths(nodes, edges, inspectContract, lifecycle, boundary);
  const summary = createGraphSummary(nodes, edges, blockedPaths, lifecycle, inspectContract, boundary);
  const diagnostics = Object.freeze([
    ...inspectContract.diagnostics,
    ...settingsValidation.diagnostics,
    ...(nodes.length === 0
      ? [diagnostic("error", "AIOS_CLI_GRAPH_NODES_REQUIRED", "Graph contract requires deterministic nodes.", "$.nodes")]
      : []),
    ...(edges.length === 0
      ? [diagnostic("error", "AIOS_CLI_GRAPH_EDGES_REQUIRED", "Graph contract requires deterministic edges.", "$.edges")]
      : []),
    ...(boundary.state === "blocked"
      ? [diagnostic("error", "AIOS_CLI_GRAPH_BOUNDARY_BLOCKED", "Graph boundary blocked unsafe tenant, workspace, or permission rendering.", "$.boundary")]
      : []),
    ...(boundary.state === "degraded"
      ? [diagnostic("warning", "AIOS_CLI_GRAPH_STATUS_REPLAY_DEGRADED", "Graph persisted status replay requires review before restart-safe rendering.", "$.boundary")]
      : []),
  ]);
  const errorCount = diagnostics.filter((entry) => entry.severity === "error").length;

  return Object.freeze({
    protocol: GRAPH_CONTRACT_PROTOCOL,
    command: "graph",
    source: inspectContract.source,
    inspect: Object.freeze({
      readiness: inspectContract.readiness,
      lifecycle: inspectContract.lifecycle,
      provider: inspectContract.providerInspection,
      runtime: inspectContract.runtimeInspection,
      externalHandoff: inspectContract.externalHandoffInspection,
      acceptance: inspectContract.acceptanceInspection,
    }),
    lifecycle,
    boundary,
    nodes,
    edges,
    blockedPaths,
    summary,
    statusHandoff: Object.freeze({
      ...inspectContract.statusHandoff,
      graphRenderable: summary.renderable,
      graphLayout: lifecycle.settings.layout,
      graphScheduleQueued: lifecycle.schedule.queued,
      graphNextAction: summary.nextAction,
      graphAcceptanceState: summary.acceptanceState,
      graphAcceptanceAccepted: summary.acceptanceAccepted,
      graphBoundaryState: boundary.state,
      graphAuditQueueHash: boundary.audit.queueHash,
      graphCanReplayPersistedStatus: boundary.safeBoundary.canReplayPersistedStatus,
      blockedGraphNodes: blockedPaths.nodeIds,
    }),
    recoveryHandoff: Object.freeze({
      ...inspectContract.recoveryHandoff,
      graphBlockedPaths: blockedPaths,
      graphAcceptance: inspectContract.acceptanceInspection,
      graphBoundary: Object.freeze({
        state: boundary.state,
        tenantId: boundary.tenantId,
        workspaceId: boundary.workspaceId,
        role: boundary.role,
        safeBoundary: boundary.safeBoundary,
        audit: boundary.audit,
      }),
      lifecycleNextAction: lifecycle.nextAction,
      nextAction: summary.nextAction,
    }),
    diagnostics,
    readiness: Object.freeze({
      ready: errorCount === 0 && summary.renderable,
      blockerCount: errorCount + blockedPaths.reasons.length,
      blockedReasons: Object.freeze(stableList([
        ...diagnostics.filter((entry) => entry.severity === "error").map((entry) => entry.code),
        ...blockedPaths.reasons,
      ])),
    }),
    nextAction: summary.nextAction,
  });
}

export function assertAiosCliGraphContractReady(contract) {
  const diagnostics = [];
  if (contract?.protocol !== GRAPH_CONTRACT_PROTOCOL) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_GRAPH_PROTOCOL_INVALID", "Graph contract protocol is missing or unsupported."));
  }
  if (!Array.isArray(contract?.nodes) || contract.nodes.length === 0) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_GRAPH_NODES_REQUIRED", "Graph contract requires nodes.", "$.nodes"));
  }
  if (!Array.isArray(contract?.edges) || contract.edges.length === 0) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_GRAPH_EDGES_REQUIRED", "Graph contract requires edges.", "$.edges"));
  }
  if (!contract?.lifecycle?.controls) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_GRAPH_LIFECYCLE_REQUIRED", "Graph contract requires lifecycle controls.", "$.lifecycle.controls"));
  }
  if (!contract?.summary?.nextAction) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_GRAPH_NEXT_ACTION_REQUIRED", "Graph contract requires a deterministic next action.", "$.summary.nextAction"));
  }
  if (!contract?.boundary?.audit?.queueHash) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_GRAPH_BOUNDARY_REQUIRED", "Graph contract requires tenant, workspace, permission, and audit boundary state.", "$.boundary"));
  }
  if (contract?.boundary?.state === "blocked") {
    diagnostics.push(diagnostic("error", "AIOS_CLI_GRAPH_BOUNDARY_BLOCKED", "Graph boundary blocked unsafe rendering.", "$.boundary"));
  }
  if (contract?.boundary?.safeBoundary?.canReplayPersistedStatus !== true) {
    diagnostics.push(diagnostic("warning", "AIOS_CLI_GRAPH_REPLAY_REVIEW_REQUIRED", "Graph persisted status replay needs review before restart-safe rendering.", "$.boundary.safeBoundary.canReplayPersistedStatus"));
  }
  if (contract?.lifecycle?.settings?.schedule === "interval" && contract.lifecycle.settings.intervalMs <= 0) {
    diagnostics.push(diagnostic("error", "AIOS_CLI_GRAPH_INTERVAL_REQUIRED", "Interval graph scheduling requires a positive interval.", "$.lifecycle.settings.intervalMs"));
  }
  return Object.freeze({
    ok: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
    nextAction: diagnostics[0]?.code || contract?.nextAction || "render-cli-runtime-graph",
  });
}

export { GRAPH_CONTRACT_PROTOCOL };
