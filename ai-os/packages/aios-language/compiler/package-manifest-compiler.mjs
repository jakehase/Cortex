const DEFAULT_ADAPTER = "mailchimp.runtime";
const RESERVED_EXTERNAL_WRITE_CAPABILITIES = new Set([
  "external.write",
  "network.write",
  "mailchimp.send",
  "mailchimp.segment.write",
]);

function stableId(prefix, parts) {
  const input = parts.filter((part) => part !== undefined && part !== null).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeIdentifier(value, fallback) {
  const raw = String(value ?? fallback ?? "").trim();
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function parseManifestSource(source) {
  if (typeof source !== "string") {
    return { ...source };
  }

  const trimmed = source.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const manifest = {};
  let currentSection = null;
  for (const line of trimmed.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim();
    if (!clean) {
      continue;
    }
    const sectionMatch = clean.match(/^\[([a-zA-Z0-9_.:-]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      manifest[currentSection] ??= {};
      continue;
    }
    const pair = clean.match(/^([a-zA-Z0-9_.:-]+)\s*[:=]\s*(.+)$/);
    if (!pair) {
      throw new Error(`Invalid manifest line: ${line}`);
    }
    const [, key, value] = pair;
    const target = currentSection ? manifest[currentSection] : manifest;
    target[key] = value.includes(",")
      ? value.split(",").map((item) => item.trim()).filter(Boolean)
      : value.trim();
  }
  return manifest;
}

function parseCapability(entry) {
  if (typeof entry === "string") {
    const [name, scope = "local"] = entry.split("@");
    return { name: normalizeIdentifier(name, "capability"), scope: normalizeIdentifier(scope, "local") };
  }
  return {
    name: normalizeIdentifier(entry?.name, "capability"),
    scope: normalizeIdentifier(entry?.scope, "local"),
    reason: entry?.reason ? String(entry.reason) : undefined,
  };
}

function parseMemoryMount(entry) {
  if (typeof entry === "string") {
    const [name, mode = "read"] = entry.split(":");
    return { name: normalizeIdentifier(name, "memory"), mode: mode === "write" ? "write" : "read" };
  }
  return {
    name: normalizeIdentifier(entry?.name, "memory"),
    mode: entry?.mode === "write" ? "write" : "read",
    retention: entry?.retention ? String(entry.retention) : "ephemeral",
  };
}

function parseVerifier(entry) {
  if (typeof entry === "string") {
    const [name, level = "required"] = entry.split("@");
    return { name: normalizeIdentifier(name, "verifier"), level };
  }
  return {
    name: normalizeIdentifier(entry?.name, "verifier"),
    level: entry?.level === "advisory" ? "advisory" : "required",
    evidence: asArray(entry?.evidence).map(String),
  };
}

function normalizePersistencePolicy(value, fallbackName) {
  const source = typeof value === "string" ? { key: value } : { ...value };
  const scope = ["operation", "package", "tenant"].includes(source.scope) ? source.scope : "operation";
  const retention = ["ephemeral", "checkpoint", "durable"].includes(source.retention)
    ? source.retention
    : "checkpoint";
  return {
    key: normalizeIdentifier(source.key ?? source.name, `${fallbackName}-state`),
    scope,
    retention,
    restartSafe: source.restartSafe !== false,
    replayPolicy: ["skip-completed", "rerun", "manual-review"].includes(source.replayPolicy)
      ? source.replayPolicy
      : "skip-completed",
  };
}

function normalizeIdempotency(value, operationName) {
  const source = typeof value === "string" ? { key: value } : { ...value };
  const mode = ["required", "best-effort", "none"].includes(source.mode) ? source.mode : "required";
  return {
    mode,
    key: mode === "none"
      ? null
      : normalizeIdentifier(source.key ?? source.name, `${operationName}-idempotency`),
    conflict: ["return-existing", "block", "rerun"].includes(source.conflict)
      ? source.conflict
      : "return-existing",
  };
}

function normalizeStatusList(value, fallback) {
  const statuses = asArray(value)
    .map((status) => normalizeIdentifier(status, "status"))
    .filter(Boolean);
  return statuses.length > 0 ? [...new Set(statuses)] : fallback;
}

function normalizeAdapterStatusPolicy(value, operationName) {
  const source = typeof value === "string" ? { probe: value } : { ...(value ?? {}) };
  const statusProbe = normalizeIdentifier(
    source.probe ?? source.statusProbe ?? source.method,
    `${operationName}.status`,
  );
  const successStatuses = normalizeStatusList(source.success ?? source.successStatuses, ["succeeded", "completed"]);
  const pendingStatuses = normalizeStatusList(source.pending ?? source.pendingStatuses, ["queued", "running"]);
  const failureStatuses = normalizeStatusList(source.failure ?? source.failureStatuses, ["failed", "rejected"]);
  const terminalStatuses = [...new Set([...successStatuses, ...failureStatuses])];
  const timeoutMs = Number.isInteger(source.timeoutMs) && source.timeoutMs > 0 ? source.timeoutMs : 30000;
  const pollIntervalMs = Number.isInteger(source.pollIntervalMs) && source.pollIntervalMs > 0
    ? source.pollIntervalMs
    : 1000;
  const maxPolls = Number.isInteger(source.maxPolls) && source.maxPolls > 0 ? source.maxPolls : 30;
  return {
    statusProbe,
    correlationField: normalizeIdentifier(source.correlationField ?? source.correlation ?? "id", "id"),
    successStatuses,
    pendingStatuses,
    failureStatuses,
    terminalStatuses,
    timeoutMs,
    pollIntervalMs,
    maxPolls,
    onPendingAfterTimeout: ["block", "manual-review", "retry"].includes(source.onPendingAfterTimeout)
      ? source.onPendingAfterTimeout
      : "manual-review",
    onFailure: ["rollback", "block", "manual-review"].includes(source.onFailure)
      ? source.onFailure
      : "rollback",
    recoverySignal: normalizeIdentifier(source.recoverySignal ?? source.signal, `${operationName}.adapter-status`),
  };
}

function classifyAdapterStatus(status, policy) {
  const normalized = normalizeIdentifier(status, "unknown");
  if (policy.successStatuses.includes(normalized)) return "success";
  if (policy.failureStatuses.includes(normalized)) return "failure";
  if (policy.pendingStatuses.includes(normalized)) return "pending";
  return "unknown";
}

function normalizeFixtureRows(value, policy) {
  const sourceRows = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(">")
      : asArray(value?.statuses ?? value?.rows ?? value?.sequence);
  const fallbackRows = [
    policy.pendingStatuses[0],
    policy.successStatuses[0],
  ].filter(Boolean);
  return (sourceRows.length > 0 ? sourceRows : fallbackRows).map((entry, index) => {
    const source = typeof entry === "string" ? { status: entry } : { ...(entry ?? {}) };
    const status = normalizeIdentifier(
      source.status ?? source.adapterStatus ?? source.state,
      fallbackRows[index] ?? policy.successStatuses[0] ?? "completed",
    );
    const classification = classifyAdapterStatus(status, policy);
    const terminal = policy.terminalStatuses.includes(status) || ["success", "failure"].includes(classification);
    return {
      sequence: Number.isInteger(source.sequence) && source.sequence > 0 ? source.sequence : index + 1,
      status,
      classification,
      terminal,
      poll: Number.isInteger(source.poll) && source.poll > 0 ? source.poll : index + 1,
      elapsedMs: Number.isInteger(source.elapsedMs) && source.elapsedMs >= 0
        ? source.elapsedMs
        : policy.pollIntervalMs * index,
      correlationValue: source.correlationValue ? String(source.correlationValue) : null,
      visibleStatus: source.visibleStatus
        ? String(source.visibleStatus)
        : classification === "success"
          ? "mailchimp-operation-completed"
          : classification === "failure"
            ? "mailchimp-operation-failed"
            : terminal
              ? "mailchimp-operation-terminal"
              : "waiting-for-mailchimp-status",
      recoveryAction: source.recoveryAction
        ? normalizeIdentifier(source.recoveryAction, "resume-adapter-status-probe")
        : classification === "failure"
          ? policy.onFailure
          : terminal
            ? "return-existing-terminal-state"
            : "resume-adapter-status-probe",
    };
  });
}

function normalizeAdapterStatusFixtures(value, policy, operationName) {
  const source = value === undefined || value === null ? {} : value;
  const fixtureInputs = Array.isArray(source)
    ? source
    : source.fixtures
      ? asArray(source.fixtures)
      : source.statuses || source.rows || source.sequence
        ? [source]
        : [];
  const fixtures = (fixtureInputs.length > 0 ? fixtureInputs : [{
    name: "default-success",
    statuses: [policy.pendingStatuses[0], policy.successStatuses[0]].filter(Boolean),
  }]).map((entry, index) => {
    const fixture = typeof entry === "string" ? { name: entry, statuses: entry } : { ...(entry ?? {}) };
    const rows = normalizeFixtureRows(fixture, policy);
    const terminalRow = rows.find((row) => row.terminal) ?? rows.at(-1);
    const finalClassification = terminalRow?.classification ?? "unknown";
    return {
      id: stableId("statusfixture", [
        operationName,
        fixture.name ?? fixture.id ?? index,
        rows.map((row) => `${row.sequence}:${row.status}`).join(","),
      ]),
      name: normalizeIdentifier(fixture.name ?? fixture.id, `fixture-${index + 1}`),
      mode: ["success", "pending", "failure", "timeout"].includes(fixture.mode)
        ? fixture.mode
        : finalClassification === "success"
          ? "success"
          : finalClassification === "failure"
            ? "failure"
            : terminalRow?.terminal
              ? "terminal"
              : "pending",
      deterministic: fixture.deterministic !== false,
      selectedByDefault: fixture.default === true || index === 0,
      rows,
      terminalStatus: terminalRow?.terminal ? terminalRow.status : null,
      finalClassification,
      finalVisibleStatus: terminalRow?.visibleStatus ?? "waiting-for-mailchimp-status",
      recoveryAction: finalClassification === "failure"
        ? policy.onFailure
        : terminalRow?.terminal
          ? "return-existing-terminal-state"
          : policy.onPendingAfterTimeout,
    };
  });
  return fixtures;
}

function normalizeLifecyclePolicy(value, astName) {
  const source = typeof value === "string" ? { command: value } : { ...(value ?? {}) };
  const command = ["prepare", "enable", "disable", "schedule", "resume", "cancel"].includes(source.command)
    ? source.command
    : "prepare";
  const enabled = source.enabled === undefined ? command !== "disable" : source.enabled === true;
  const schedule = typeof source.schedule === "string" ? { mode: source.schedule } : { ...(source.schedule ?? {}) };
  const scheduleMode = ["manual", "immediate", "windowed", "disabled"].includes(schedule.mode)
    ? schedule.mode
    : command === "schedule"
      ? "windowed"
      : "manual";
  const releasePolicy = ["manual-approval", "auto-when-healthy", "disabled"].includes(source.releasePolicy)
    ? source.releasePolicy
    : command === "enable"
      ? "auto-when-healthy"
      : "manual-approval";
  const maxConcurrentJobs = Number.isInteger(source.maxConcurrentJobs) && source.maxConcurrentJobs > 0
    ? source.maxConcurrentJobs
    : 5;
  return {
    id: stableId("lifecycle", [
      astName,
      command,
      enabled,
      scheduleMode,
      releasePolicy,
      maxConcurrentJobs,
    ]),
    command,
    enabled,
    releasePolicy,
    maxConcurrentJobs,
    requireHealthy: source.requireHealthy !== false,
    allowDegraded: source.allowDegraded === true,
    allowApprovalPause: source.allowApprovalPause !== false,
    schedule: {
      mode: enabled ? scheduleMode : "disabled",
      windowStart: schedule.windowStart ? String(schedule.windowStart) : null,
      windowEnd: schedule.windowEnd ? String(schedule.windowEnd) : null,
      timezone: schedule.timezone ? String(schedule.timezone) : "UTC",
      maxScheduledJobs: Number.isInteger(schedule.maxScheduledJobs) && schedule.maxScheduledJobs > 0
        ? schedule.maxScheduledJobs
        : 25,
    },
  };
}

function normalizeSyncMetadata(value, astName) {
  const source = typeof value === "string" ? { audience: value } : { ...(value ?? {}) };
  const audience = typeof source.audience === "string" ? { id: source.audience } : { ...(source.audience ?? {}) };
  const campaign = typeof source.campaign === "string" ? { id: source.campaign } : { ...(source.campaign ?? {}) };
  const segment = typeof source.segment === "string" ? { id: source.segment } : { ...(source.segment ?? {}) };
  const template = typeof source.template === "string" ? { id: source.template } : { ...(source.template ?? {}) };
  const cursor = typeof source.cursor === "string" ? { field: source.cursor } : { ...(source.cursor ?? {}) };
  const batchSize = Number.isInteger(source.batchSize) && source.batchSize > 0 ? source.batchSize : 500;
  const provider = normalizeIdentifier(source.provider ?? source.service ?? "mailchimp-marketing", "mailchimp-marketing");
  const syncMode = ["pull", "push", "bidirectional", "status-only"].includes(source.mode) ? source.mode : "push";
  const handoffMode = ["adapter", "webhook", "manual"].includes(source.handoffMode) ? source.handoffMode : "adapter";
  const conflictPolicy = ["mailchimp-wins", "local-wins", "manual-review"].includes(source.conflictPolicy)
    ? source.conflictPolicy
    : "manual-review";
  const freshness = ["current-run", "checkpoint", "durable"].includes(source.freshness)
    ? source.freshness
    : "checkpoint";
  const requiredFacts = [
    audience.required !== false ? "audience_id" : null,
    campaign.required === true ? "campaign_id" : null,
    segment.required === true ? "segment_id" : null,
    template.required === true ? "template_id" : null,
  ].filter(Boolean);
  const idParts = [
    astName,
    provider,
    syncMode,
    audience.id ?? audience.source,
    campaign.id ?? campaign.source,
    segment.id ?? segment.source,
    template.id ?? template.source,
    cursor.field,
  ];
  return {
    id: stableId("sync", idParts),
    provider,
    mode: syncMode,
    handoffMode,
    conflictPolicy,
    freshness,
    batchSize,
    requiredFacts,
    audience: {
      id: audience.id ? normalizeIdentifier(audience.id, "audience") : null,
      source: normalizeIdentifier(audience.source ?? audience.sourceField ?? "claim.audience_id", "claim.audience_id"),
      listField: normalizeIdentifier(audience.listField ?? "audience_id", "audience_id"),
      required: audience.required !== false,
    },
    campaign: {
      id: campaign.id ? normalizeIdentifier(campaign.id, "campaign") : null,
      source: normalizeIdentifier(campaign.source ?? campaign.sourceField ?? "claim.campaign_id", "claim.campaign_id"),
      required: campaign.required === true,
      statusField: normalizeIdentifier(campaign.statusField ?? "campaign_status", "campaign_status"),
    },
    segment: {
      id: segment.id ? normalizeIdentifier(segment.id, "segment") : null,
      source: normalizeIdentifier(segment.source ?? segment.sourceField ?? "claim.segment_id", "claim.segment_id"),
      strategy: ["static", "dynamic", "none"].includes(segment.strategy) ? segment.strategy : "dynamic",
      required: segment.required === true,
    },
    template: {
      id: template.id ? normalizeIdentifier(template.id, "template") : null,
      source: normalizeIdentifier(template.source ?? template.sourceField ?? "claim.template_id", "claim.template_id"),
      required: template.required === true,
    },
    cursor: {
      field: normalizeIdentifier(cursor.field ?? cursor.name ?? "updated_at", "updated_at"),
      checkpointKey: normalizeIdentifier(cursor.checkpointKey ?? `${astName}-mailchimp-cursor`, `${astName}-mailchimp-cursor`),
      resumeFrom: ["last-success", "request", "manual"].includes(cursor.resumeFrom) ? cursor.resumeFrom : "last-success",
    },
  };
}

function buildSyncServiceContract(ast, compiledOperations) {
  const sync = ast.syncMetadata;
  const operationIds = compiledOperations.map((operation) => operation.id);
  const writeOperations = compiledOperations.filter((operation) => (
    operation.capabilityNames.some((capability) => (
      capability.endsWith(".write") || capability.endsWith(".send") || capability.includes("segment.write")
    ))
  ));
  const requiredProviderCapabilities = [
    "mailchimp.audience.read",
    sync.mode === "status-only" ? "mailchimp.status.read" : "mailchimp.audience.write",
    sync.campaign.required ? "mailchimp.campaign.read" : null,
    sync.segment.required ? "mailchimp.segment.read" : null,
    sync.template.required ? "mailchimp.template.read" : null,
  ].filter(Boolean);
  const handoffState = ast.lifecycle.enabled === false
    ? "disabled"
    : ast.lifecycle.command === "schedule"
      ? "scheduled"
      : "ready-for-negotiation";
  return {
    id: stableId("syncsvc", [ast.id, sync.id, operationIds.join(","), handoffState]),
    provider: sync.provider,
    contractVersion: "aios.mailchimp.sync.v1",
    mode: sync.mode,
    handoffMode: sync.handoffMode,
    conflictPolicy: sync.conflictPolicy,
    batchSize: sync.batchSize,
    freshness: sync.freshness,
    requiredFacts: sync.requiredFacts,
    requiredProviderCapabilities,
    operationIds,
    writeOperationIds: writeOperations.map((operation) => operation.id),
    cursor: sync.cursor,
    objectBindings: {
      audience: sync.audience,
      campaign: sync.campaign,
      segment: sync.segment,
      template: sync.template,
    },
    externalHandoff: {
      state: handoffState,
      handoffId: stableId("synchandoff", [ast.id, sync.id, handoffState]),
      resumeCursorKey: sync.cursor.checkpointKey,
      nextAction: handoffState === "disabled"
        ? "enable-package-lifecycle"
        : ast.lifecycle.command === "schedule"
          ? "wait-for-schedule-window"
          : "negotiate-provider-capabilities",
    },
  };
}

function normalizeProviderContractPolicy(value, syncMetadata, astName) {
  const source = typeof value === "string" ? { service: value } : { ...(value ?? {}) };
  const service = normalizeIdentifier(source.service ?? source.provider ?? syncMetadata.provider, syncMetadata.provider);
  const apiVersion = normalizeIdentifier(source.apiVersion ?? source.version ?? "marketing-v3", "marketing-v3");
  const region = normalizeIdentifier(source.region ?? source.datacenter ?? "tenant-datacenter", "tenant-datacenter");
  const authMode = ["oauth", "api-key", "connector-token", "mock"].includes(source.authMode)
    ? source.authMode
    : "connector-token";
  const statusMode = ["poll", "webhook", "poll+webhook", "manual"].includes(source.statusMode)
    ? source.statusMode
    : syncMetadata.handoffMode === "webhook"
      ? "webhook"
      : "poll";
  const degradedMode = ["read-only", "status-only", "queue-only", "disabled"].includes(source.degradedMode)
    ? source.degradedMode
    : syncMetadata.mode === "status-only"
      ? "status-only"
      : "queue-only";
  const maxBatchSize = Number.isInteger(source.maxBatchSize) && source.maxBatchSize > 0
    ? source.maxBatchSize
    : 1000;
  const maxStatusLagMs = Number.isInteger(source.maxStatusLagMs) && source.maxStatusLagMs >= 0
    ? source.maxStatusLagMs
    : 120000;
  const requiredFeatures = asArray(source.requiredFeatures ?? source.features)
    .map((feature) => normalizeIdentifier(feature, "feature"))
    .filter(Boolean);
  return {
    id: stableId("providerpolicy", [
      astName,
      service,
      apiVersion,
      region,
      authMode,
      statusMode,
      degradedMode,
      maxBatchSize,
      maxStatusLagMs,
      requiredFeatures.join(","),
    ]),
    service,
    apiVersion,
    region,
    authMode,
    statusMode,
    degradedMode,
    maxBatchSize,
    maxStatusLagMs,
    requiredFeatures,
    endpoint: source.endpoint ? String(source.endpoint) : null,
    webhookTopic: source.webhookTopic ? normalizeIdentifier(source.webhookTopic, "campaign-status") : "campaign-status",
  };
}

function buildProviderIntegrationContract(ast, compiledOperations, syncServiceContract, lifecycleControls) {
  const policy = ast.providerContract;
  const releaseGate = lifecycleControls.releaseGate ?? {};
  const writeLikeOperations = compiledOperations.filter((operation) => (
    operation.capabilityNames.some((capability) => (
      capability.endsWith(".write") || capability.endsWith(".send") || capability.includes("segment.write")
    ))
  ));
  const statusProbeOperations = compiledOperations.filter((operation) => (
    operation.stateContract?.commandState?.commands?.some((command) => command.type === "adapter-status-probe")
  ));
  const requiredFeatures = [...new Set([
    "capability-negotiation",
    "credential-lease",
    "idempotent-command-ledger",
    syncServiceContract.handoffMode === "webhook" ? "webhook-status-handoff" : "poll-status-handoff",
    syncServiceContract.mode === "status-only" ? "status-read" : "audience-sync",
    ...(writeLikeOperations.length > 0 ? ["external-write-approval"] : []),
    ...policy.requiredFeatures,
  ])].sort();
  const providedFeatures = new Set([
    "capability-negotiation",
    "credential-lease",
    "idempotent-command-ledger",
    "poll-status-handoff",
    "status-read",
    "audience-sync",
    ...(policy.statusMode.includes("webhook") ? ["webhook-status-handoff"] : []),
    ...(policy.authMode !== "mock" ? ["external-write-approval"] : []),
  ]);
  const featureRows = requiredFeatures.map((feature, index) => {
    const available = providedFeatures.has(feature);
    const requiredBy = [
      feature.includes("status") ? "adapter-status" : null,
      feature.includes("write") ? "tenant-approval" : null,
      feature.includes("credential") ? "provider-auth" : null,
      feature.includes("ledger") ? "restart-replay" : null,
      feature.includes("sync") ? "sync-service" : null,
    ].filter(Boolean);
    return {
      sequence: index + 1,
      feature,
      available,
      requiredBy: requiredBy.length > 0 ? requiredBy : ["provider-runtime"],
      state: available
        ? releaseGate.state === "scheduled"
          ? "waiting-for-schedule"
          : "ready"
        : "missing",
      nextAction: available
        ? "persist-provider-feature-grant"
        : feature.includes("webhook")
          ? "configure-provider-webhook"
          : "repair-provider-service-contract",
    };
  });
  const missingRows = featureRows.filter((row) => row.state === "missing");
  const waitingRows = featureRows.filter((row) => row.state === "waiting-for-schedule");
  const batchLimited = syncServiceContract.batchSize > policy.maxBatchSize;
  const staleStatusRisk = compiledOperations.some((operation) => (
    operation.adapterStatus?.polling?.timeoutMs > policy.maxStatusLagMs
  ));
  const state = missingRows.length > 0 || batchLimited
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : staleStatusRisk
        ? "degraded"
        : "ready";
  const scope = [
    ast.id,
    syncServiceContract.id,
    policy.id,
    state,
    featureRows.map((row) => `${row.feature}:${row.state}`).join(","),
  ];
  const command = {
    id: stableId("providerintcmd", [...scope, "persist-provider-integration-contract"]),
    type: "persist-provider-integration-contract",
    idempotencyKey: stableId("idem", [...scope, "persist-provider-integration-contract"]),
    statusAfterReplay: state,
    writes: ["providerFeatures", "serviceLevel", "capabilityNegotiation", "handoffState"],
    conflict: "return-existing",
  };
  return {
    id: stableId("providerint", scope),
    product: "mailchimp",
    protocol: "aios.mailchimp.provider-integration-contract.v1",
    service: policy.service,
    apiVersion: policy.apiVersion,
    region: policy.region,
    state,
    ready: state === "ready" || state === "degraded",
    nextAction: missingRows[0]?.nextAction
      ?? (batchLimited ? "reduce-mailchimp-sync-batch-size" : null)
      ?? (waitingRows[0]?.nextAction ? "wait-for-provider-schedule" : null)
      ?? (staleStatusRisk ? "review-status-lag-budget" : "persist-provider-integration-contract"),
    serviceLevel: {
      authMode: policy.authMode,
      statusMode: policy.statusMode,
      degradedMode: policy.degradedMode,
      maxBatchSize: policy.maxBatchSize,
      requestedBatchSize: syncServiceContract.batchSize,
      maxStatusLagMs: policy.maxStatusLagMs,
      endpointConfigured: Boolean(policy.endpoint),
      webhookTopic: policy.statusMode.includes("webhook") ? policy.webhookTopic : null,
    },
    capabilityNegotiation: {
      requiredProviderCapabilities: syncServiceContract.requiredProviderCapabilities,
      requiredFeatures,
      availableFeatures: featureRows.filter((row) => row.available).map((row) => row.feature),
      missingFeatures: missingRows.map((row) => row.feature),
      writeLikeOperationIds: writeLikeOperations.map((operation) => operation.id),
      statusProbeOperationIds: statusProbeOperations.map((operation) => operation.id),
    },
    featureRows,
    command,
    validationSummary: {
      missingFeatures: missingRows.map((row) => row.feature),
      waitingFeatures: waitingRows.map((row) => row.feature),
      batchLimited,
      staleStatusRisk,
      operationCount: compiledOperations.length,
      writeLikeOperations: writeLikeOperations.length,
    },
  };
}

function buildProviderSyncAcceptanceContract(
  ast,
  compiledOperations,
  lifecycleControls,
  syncServiceContract,
  providerIntegrationContract,
  providerClientHandoff,
) {
  const releaseGate = lifecycleControls.releaseGate ?? {};
  const writeLikeOperations = compiledOperations.filter((operation) => (
    operation.capabilityNames.some((capability) => (
      capability.endsWith(".write") || capability.endsWith(".send") || capability.includes("segment.write")
    ))
  ));
  const statusProbeOperations = compiledOperations.filter((operation) => (
    operation.stateContract?.commandState?.commands?.some((command) => command.type === "adapter-status-probe")
  ));
  const missingStatusProbeOperations = compiledOperations.filter((operation) => (
    !statusProbeOperations.some((candidate) => candidate.id === operation.id)
  ));
  const missingProviderCapabilities = providerIntegrationContract.capabilityNegotiation?.missingFeatures ?? [];
  const waitingProviderCapabilities = providerIntegrationContract.capabilityNegotiation?.requiredFeatures
    ?.filter((feature) => providerIntegrationContract.featureRows?.some((row) => row.feature === feature && row.state === "waiting-for-schedule"))
    ?? [];
  const requiredAcceptanceInputs = [
    {
      name: "syncContractId",
      value: syncServiceContract.id,
      required: true,
      source: "sync-service",
    },
    {
      name: "providerIntegrationContractId",
      value: providerIntegrationContract.id,
      required: true,
      source: "provider-integration",
    },
    {
      name: "providerClientHandoffId",
      value: providerClientHandoff.id,
      required: true,
      source: "provider-client-handoff",
    },
    {
      name: "cursorCheckpointKey",
      value: syncServiceContract.cursor?.checkpointKey ?? null,
      required: true,
      source: "sync-cursor",
    },
    {
      name: "operationCheckpointKeys",
      value: compiledOperations.map((operation) => operation.stateContract?.checkpointKey).filter(Boolean),
      required: compiledOperations.length > 0,
      source: "operation-state-contracts",
    },
    {
      name: "adapterStatusResumeCommands",
      value: compiledOperations
        .map((operation) => operation.stateContract?.adapterStatus?.recovery?.resumeCommand)
        .filter(Boolean),
      required: statusProbeOperations.length > 0,
      source: "adapter-status-contracts",
    },
  ];
  const rows = [
    {
      key: "sync-facts",
      state: syncServiceContract.requiredFacts.length > 0 ? "waiting" : "ready",
      sourceId: syncServiceContract.id,
      detail: syncServiceContract.requiredFacts.length > 0
        ? `Waiting for claim facts: ${syncServiceContract.requiredFacts.join(", ")}.`
        : "No additional Mailchimp claim facts are required for sync acceptance.",
      nextAction: syncServiceContract.requiredFacts.length > 0 ? "collect-claim-evidence" : "continue-provider-sync-acceptance",
      blockers: [],
      waiting: syncServiceContract.requiredFacts,
      restartSafe: true,
    },
    {
      key: "provider-capabilities",
      state: missingProviderCapabilities.length > 0
        ? "blocked"
        : waitingProviderCapabilities.length > 0
          ? "waiting"
          : "ready",
      sourceId: providerIntegrationContract.id,
      detail: missingProviderCapabilities.length > 0
        ? `Missing Mailchimp provider features: ${missingProviderCapabilities.join(", ")}.`
        : waitingProviderCapabilities.length > 0
          ? `Waiting for provider feature schedule: ${waitingProviderCapabilities.join(", ")}.`
          : "Mailchimp provider capability negotiation can be accepted.",
      nextAction: missingProviderCapabilities.length > 0
        ? "repair-provider-service-contract"
        : waitingProviderCapabilities.length > 0
          ? "wait-for-provider-schedule"
          : "persist-provider-capability-acceptance",
      blockers: missingProviderCapabilities,
      waiting: waitingProviderCapabilities,
      restartSafe: missingProviderCapabilities.length === 0,
    },
    {
      key: "external-handoff",
      state: providerClientHandoff.state === "ready"
        ? "ready"
        : providerClientHandoff.state === "scheduled" || providerClientHandoff.state === "review"
          ? "waiting"
          : "blocked",
      sourceId: providerClientHandoff.id,
      detail: `Provider client handoff is ${providerClientHandoff.visibleStatus}.`,
      nextAction: providerClientHandoff.nextAction,
      blockers: providerClientHandoff.blockers ?? [],
      waiting: providerClientHandoff.reviewReasons ?? [],
      restartSafe: providerClientHandoff.state !== "blocked",
    },
    {
      key: "lifecycle-release",
      state: releaseGate.releaseAllowed === true
        ? "ready"
        : releaseGate.state === "scheduled" || releaseGate.state === "review"
          ? "waiting"
          : "blocked",
      sourceId: releaseGate.id ?? lifecycleControls.stateId,
      detail: releaseGate.id
        ? `Lifecycle release gate is ${releaseGate.state}.`
        : "Lifecycle release gate has not been compiled.",
      nextAction: releaseGate.nextAction ?? lifecycleControls.nextAction?.action ?? "prepare-manual-release",
      blockers: releaseGate.blockedCheckNames ?? [],
      waiting: releaseGate.reviewCheckNames ?? [],
      restartSafe: releaseGate.state !== "blocked",
    },
    {
      key: "status-handoff",
      state: missingStatusProbeOperations.length > 0 ? "blocked" : "ready",
      sourceId: stableId("statushandoff", [
        ast.id,
        statusProbeOperations.map((operation) => operation.id).join(","),
      ]),
      detail: missingStatusProbeOperations.length > 0
        ? `${missingStatusProbeOperations.length} operation(s) are missing adapter status probes.`
        : "Adapter status probes have deterministic handoff commands.",
      nextAction: missingStatusProbeOperations.length > 0
        ? "repair-adapter-status-contracts"
        : "persist-status-handoff-acceptance",
      blockers: missingStatusProbeOperations.map((operation) => operation.id),
      waiting: [],
      restartSafe: missingStatusProbeOperations.length === 0,
    },
  ];
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const missingRequiredInputs = requiredAcceptanceInputs.filter((input) => (
    input.required && (
      input.value === null
      || input.value === undefined
      || input.value === ""
      || (Array.isArray(input.value) && input.value.length === 0)
    )
  ));
  const state = missingRequiredInputs.length > 0 || blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : "ready";
  const acceptanceScope = [
    ast.id,
    syncServiceContract.id,
    providerIntegrationContract.id,
    providerClientHandoff.id,
    state,
    rows.map((row) => `${row.key}:${row.state}`).join(","),
    requiredAcceptanceInputs.map((input) => `${input.name}:${Array.isArray(input.value) ? input.value.join("+") : input.value}`).join(","),
  ];
  const command = {
    id: stableId("providersyncacceptcmd", [...acceptanceScope, "persist-provider-sync-acceptance"]),
    type: "persist-provider-sync-acceptance",
    idempotencyKey: stableId("idem", [...acceptanceScope, "persist-provider-sync-acceptance"]),
    statusAfterReplay: state === "ready" ? "provider-sync-accepted" : `provider-sync-${state}`,
    writes: ["providerSyncAcceptanceId", "rows", "acceptanceInputs", "nextAction", "externalHandoffState"],
    conflict: "return-existing",
  };
  return {
    id: stableId("providersyncaccept", acceptanceScope),
    product: "mailchimp",
    protocol: "aios.mailchimp.provider-sync-acceptance.v1",
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "provider-sync-acceptance-ready"
      : state === "waiting"
        ? "provider-sync-acceptance-waiting"
        : "provider-sync-acceptance-blocked",
    nextAction: missingRequiredInputs.length > 0
      ? "repair-provider-sync-acceptance-inputs"
      : blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? "persist-provider-sync-acceptance",
    syncContractId: syncServiceContract.id,
    providerIntegrationContractId: providerIntegrationContract.id,
    providerClientHandoffId: providerClientHandoff.id,
    writeLikeOperationIds: writeLikeOperations.map((operation) => operation.id),
    requiredInputs: requiredAcceptanceInputs,
    rows,
    command,
    clientPatch: {
      providerSyncAcceptanceId: stableId("providersyncacceptpatch", acceptanceScope),
      providerSyncAcceptanceState: state,
      providerSyncAcceptanceReady: state === "ready",
      providerSyncAcceptanceVisibleStatus: state === "ready" ? "ready-to-accept-provider-sync" : `provider-sync-${state}`,
      providerSyncAcceptanceNextAction: missingRequiredInputs.length > 0
        ? "repair-provider-sync-acceptance-inputs"
        : blockedRows[0]?.nextAction
          ?? waitingRows[0]?.nextAction
          ?? "persist-provider-sync-acceptance",
      blockedKeys: blockedRows.map((row) => row.key),
      waitingKeys: waitingRows.map((row) => row.key),
      commandId: command.id,
    },
    validationSummary: {
      blockedKeys: blockedRows.map((row) => row.key),
      waitingKeys: waitingRows.map((row) => row.key),
      missingRequiredInputs: missingRequiredInputs.map((input) => input.name),
      requiredProviderCapabilities: syncServiceContract.requiredProviderCapabilities,
      missingProviderFeatures: missingProviderCapabilities,
      waitingProviderFeatures: waitingProviderCapabilities,
      missingStatusProbeOperationIds: missingStatusProbeOperations.map((operation) => operation.id),
      requiredFacts: syncServiceContract.requiredFacts,
      writeLikeOperationIds: writeLikeOperations.map((operation) => operation.id),
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && rows.every((row) => row.restartSafe),
      replayCursor: stableId("providersyncacceptcursor", [
        syncServiceContract.cursor?.checkpointKey,
        providerClientHandoff.digest,
        command.id,
      ]),
      onRestart: state === "ready" ? "load-provider-sync-acceptance" : "rebuild-provider-sync-acceptance",
      onDuplicateCommand: "return-existing-provider-sync-acceptance",
      externalWritesPerformed: false,
    },
  };
}

function buildProviderReadinessExportContract(
  ast,
  compiledOperations,
  syncServiceContract,
  providerIntegrationContract,
  providerSyncAcceptanceContract,
  providerClientHandoff,
) {
  const writeLikeOperations = compiledOperations.filter((operation) => (
    operation.capabilityNames.some((capability) => (
      capability.endsWith(".write") || capability.endsWith(".send") || capability.includes("segment.write")
    ))
  ));
  const statusProbeOperations = compiledOperations.filter((operation) => (
    operation.stateContract?.commandState?.commands?.some((command) => command.type === "adapter-status-probe")
  ));
  const rows = [
    {
      key: "provider-integration",
      state: providerIntegrationContract.state === "blocked"
        ? "blocked"
        : providerIntegrationContract.state === "waiting"
          ? "waiting"
          : providerIntegrationContract.ready === true
            ? "ready"
            : "review",
      sourceId: providerIntegrationContract.id,
      nextAction: providerIntegrationContract.nextAction ?? "review-provider-integration-contract",
      blockedKeys: providerIntegrationContract.validationSummary?.missingFeatures ?? [],
      waitingKeys: providerIntegrationContract.validationSummary?.waitingFeatures ?? [],
      commandId: providerIntegrationContract.command?.id ?? null,
      restartSafe: providerIntegrationContract.state !== "blocked",
    },
    {
      key: "provider-sync-acceptance",
      state: providerSyncAcceptanceContract.state === "blocked"
        ? "blocked"
        : providerSyncAcceptanceContract.state === "waiting"
          ? "waiting"
          : providerSyncAcceptanceContract.ready === true
            ? "ready"
            : "review",
      sourceId: providerSyncAcceptanceContract.id,
      nextAction: providerSyncAcceptanceContract.nextAction ?? "review-provider-sync-acceptance",
      blockedKeys: providerSyncAcceptanceContract.validationSummary?.blockedKeys ?? [],
      waitingKeys: providerSyncAcceptanceContract.validationSummary?.waitingKeys ?? [],
      commandId: providerSyncAcceptanceContract.command?.id ?? null,
      restartSafe: providerSyncAcceptanceContract.restartSemantics?.restartSafe !== false,
    },
    {
      key: "client-provider-handoff",
      state: providerClientHandoff.state === "blocked"
        ? "blocked"
        : ["scheduled", "review", "waiting"].includes(providerClientHandoff.state)
          ? "waiting"
          : "ready",
      sourceId: providerClientHandoff.id,
      nextAction: providerClientHandoff.nextAction ?? "prepare-provider-client-handoff",
      blockedKeys: providerClientHandoff.blockers ?? [],
      waitingKeys: providerClientHandoff.reviewReasons ?? [],
      commandId: providerClientHandoff.command?.id ?? providerClientHandoff.commands?.[0]?.id ?? null,
      restartSafe: providerClientHandoff.state !== "blocked",
    },
    {
      key: "adapter-status-probes",
      state: statusProbeOperations.length === compiledOperations.length ? "ready" : "blocked",
      sourceId: stableId("providerstatus", [ast.id, statusProbeOperations.map((operation) => operation.id).join(",")]),
      nextAction: statusProbeOperations.length === compiledOperations.length
        ? "persist-provider-status-probe-export"
        : "repair-adapter-status-contracts",
      blockedKeys: compiledOperations
        .filter((operation) => !statusProbeOperations.some((candidate) => candidate.id === operation.id))
        .map((operation) => operation.id),
      waitingKeys: [],
      commandId: null,
      restartSafe: statusProbeOperations.length === compiledOperations.length,
    },
  ];
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const reviewRows = rows.filter((row) => row.state === "review");
  const state = blockedRows.length
    ? "blocked"
    : waitingRows.length
      ? "waiting"
      : reviewRows.length
        ? "review"
        : "ready";
  const exportId = stableId("providerready", [
    ast.id,
    syncServiceContract.id,
    providerIntegrationContract.id,
    providerSyncAcceptanceContract.id,
    providerClientHandoff.id,
    state,
    rows.map((row) => `${row.key}:${row.state}:${row.sourceId}`).join(","),
  ]);
  const command = {
    id: stableId("providerreadycmd", [exportId, "persist-provider-readiness-export"]),
    type: "persist-provider-readiness-export",
    idempotencyKey: stableId("idem", [exportId, "persist-provider-readiness-export"]),
    statusAfterReplay: state,
    writes: ["providerReadinessRows", "providerReadinessState", "syncCursor", "capabilityNegotiation"],
    conflict: "return-existing",
  };
  return {
    protocol: "aios.mailchimp.provider-readiness-export.v1",
    id: exportId,
    product: "mailchimp",
    state,
    ready: state === "ready" || state === "review",
    visibleStatus: state === "ready" ? "provider-readiness-ready" : `provider-readiness-${state}`,
    syncContractId: syncServiceContract.id,
    providerIntegrationContractId: providerIntegrationContract.id,
    providerSyncAcceptanceContractId: providerSyncAcceptanceContract.id,
    providerClientHandoffId: providerClientHandoff.id,
    requiredProviderCapabilities: syncServiceContract.requiredProviderCapabilities,
    writeLikeOperationIds: writeLikeOperations.map((operation) => operation.id),
    rows,
    command,
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? reviewRows[0]?.nextAction
      ?? "persist-provider-readiness-export",
    validationSummary: {
      blockedKeys: blockedRows.map((row) => row.key),
      waitingKeys: waitingRows.map((row) => row.key),
      reviewKeys: reviewRows.map((row) => row.key),
      missingProviderFeatures: providerIntegrationContract.validationSummary?.missingFeatures ?? [],
      waitingProviderFeatures: providerIntegrationContract.validationSummary?.waitingFeatures ?? [],
      missingStatusProbeOperationIds: rows.find((row) => row.key === "adapter-status-probes")?.blockedKeys ?? [],
    },
    clientPatch: {
      providerReadinessExportId: exportId,
      providerReadinessState: state,
      providerReadinessReady: state === "ready" || state === "review",
      providerReadinessNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? "persist-provider-readiness-export",
      providerReadinessBlockedKeys: blockedRows.map((row) => row.key),
      providerReadinessWaitingKeys: waitingRows.map((row) => row.key),
      providerReadinessReviewKeys: reviewRows.map((row) => row.key),
      providerReadinessCommandId: command.id,
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && rows.every((row) => row.restartSafe !== false),
      replayCursor: stableId("providerreadycursor", [exportId, syncServiceContract.cursor?.checkpointKey, command.id]),
      onRestart: state === "ready" ? "load-provider-readiness-export" : "rebuild-provider-readiness-export",
      onDuplicateCommand: "return-existing-provider-readiness-export",
      externalWritesPerformed: false,
    },
  };
}

function buildLifecycleControlState(ast, lifecycle, operations) {
  const commandScope = [
    ast.id,
    lifecycle.id,
    operations.map((operation) => operation.id).join(","),
  ];
  const enabledCommands = [
    {
      id: stableId("lifecmd", [...commandScope, "persist-settings"]),
      type: "persist-lifecycle-settings",
      enabled: lifecycle.enabled,
      statusAfterReplay: lifecycle.enabled ? "lifecycle-enabled" : "lifecycle-disabled",
      idempotencyKey: stableId("idem", [...commandScope, "persist-settings"]),
      writes: ["enabled", "releasePolicy", "schedule", "maxConcurrentJobs"],
    },
  ];
  if (lifecycle.command === "schedule" && lifecycle.enabled) {
    enabledCommands.push({
      id: stableId("lifecmd", [...commandScope, "schedule-release"]),
      type: "schedule-runtime-release",
      scheduleMode: lifecycle.schedule.mode,
      statusAfterReplay: lifecycle.schedule.mode === "windowed" ? "scheduled" : "ready",
      idempotencyKey: stableId("idem", [...commandScope, "schedule-release"]),
      writes: ["nextReleaseWindow", "scheduledJobCount"],
    });
  }
  if (["disable", "cancel"].includes(lifecycle.command) || !lifecycle.enabled) {
    enabledCommands.push({
      id: stableId("lifecmd", [...commandScope, "hold-release"]),
      type: "hold-runtime-release",
      statusAfterReplay: "disabled",
      idempotencyKey: stableId("idem", [...commandScope, "hold-release"]),
      writes: ["enabled", "heldJobIds"],
    });
  }
  const nextAction = !lifecycle.enabled || lifecycle.command === "disable"
    ? "hold-runtime-handoff"
    : lifecycle.command === "schedule"
      ? "validate-schedule-window"
      : lifecycle.command === "resume"
        ? "resume-from-command-log"
        : lifecycle.releasePolicy === "auto-when-healthy"
          ? "release-when-plan-healthy"
          : "prepare-manual-release";
  return {
    stateId: stableId("lifestate", commandScope),
    enabled: lifecycle.enabled,
    command: lifecycle.command,
    releasePolicy: lifecycle.releasePolicy,
    schedule: lifecycle.schedule,
    concurrency: {
      maxConcurrentJobs: lifecycle.maxConcurrentJobs,
      operationCount: operations.length,
      requiresQueue: operations.length > lifecycle.maxConcurrentJobs,
    },
    validationRules: [
      "schedule-window-required-for-windowed-mode",
      "healthy-plan-required-unless-allowDegraded",
      "approval-pause-required-for-write-like-capabilities",
      "restart-safe-state-required-for-resume",
    ],
    commands: enabledCommands,
    nextAction: {
      action: nextAction,
      commandId: enabledCommands.at(-1)?.id ?? enabledCommands[0]?.id,
      scheduleMode: lifecycle.schedule.mode,
      requiresHealthyPlan: lifecycle.requireHealthy,
      allowsDegradedPlan: lifecycle.allowDegraded,
    },
  };
}

function buildLifecycleReleaseGate(ast, lifecycle, operations, lifecycleControls, issues) {
  const writeLikeOperations = operations.filter((operation) => (
    operation.capabilityNames.some((capability) => (
      capability.endsWith(".write") || capability.endsWith(".send") || capability.includes("segment.write")
    ))
  ));
  const restartUnsafeOperations = operations.filter((operation) => operation.stateContract?.restartSafe === false);
  const missingStatusProbeOperations = operations.filter((operation) => (
    !operation.stateContract?.commandState?.commands?.some((command) => command.type === "adapter-status-probe")
  ));
  const scheduleWindowMissing = lifecycle.schedule.mode === "windowed"
    && (!lifecycle.schedule.windowStart || !lifecycle.schedule.windowEnd);
  const concurrencyExceeded = operations.length > lifecycle.maxConcurrentJobs;
  const blockingIssues = issues.filter((issue) => issue.severity === "error");
  const checks = [
    {
      name: "enabled",
      status: lifecycle.enabled ? "ready" : "blocked",
      detail: lifecycle.enabled
        ? "Lifecycle controls allow Mailchimp runtime handoff preparation."
        : "Lifecycle controls are disabled and hold Mailchimp runtime handoff.",
      nextAction: lifecycle.enabled ? "continue-release-validation" : "enable-package-lifecycle",
    },
    {
      name: "manifest-health",
      status: blockingIssues.length > 0 ? "blocked" : "ready",
      detail: blockingIssues.length > 0
        ? `${blockingIssues.length} manifest error(s) block release.`
        : "Manifest has no blocking errors for release.",
      nextAction: blockingIssues.length > 0 ? "repair-manifest-errors" : "continue-release-validation",
      issueCodes: blockingIssues.map((issue) => issue.code),
    },
    {
      name: "schedule",
      status: scheduleWindowMissing ? "blocked" : lifecycle.schedule.mode === "disabled" ? "blocked" : "ready",
      detail: scheduleWindowMissing
        ? "Windowed release scheduling requires windowStart and windowEnd."
        : lifecycle.schedule.mode === "disabled"
          ? "Release scheduling is disabled."
          : `Release schedule mode is ${lifecycle.schedule.mode}.`,
      nextAction: scheduleWindowMissing
        ? "declare-release-window"
        : lifecycle.schedule.mode === "disabled"
          ? "choose-release-schedule"
          : "persist-release-schedule",
    },
    {
      name: "concurrency",
      status: concurrencyExceeded ? "review" : "ready",
      detail: concurrencyExceeded
        ? `${operations.length} operation(s) exceed maxConcurrentJobs ${lifecycle.maxConcurrentJobs}.`
        : "Operation count is within lifecycle concurrency controls.",
      nextAction: concurrencyExceeded ? "queue-runtime-release" : "continue-release-validation",
      maxConcurrentJobs: lifecycle.maxConcurrentJobs,
      operationCount: operations.length,
    },
    {
      name: "restart-safety",
      status: restartUnsafeOperations.length > 0 ? "blocked" : "ready",
      detail: restartUnsafeOperations.length > 0
        ? `${restartUnsafeOperations.length} operation(s) are not restart-safe.`
        : "All operations expose restart-safe state contracts.",
      nextAction: restartUnsafeOperations.length > 0 ? "repair-state-contracts" : "persist-command-ledgers",
      operationIds: restartUnsafeOperations.map((operation) => operation.id),
    },
    {
      name: "adapter-status",
      status: missingStatusProbeOperations.length > 0 ? "blocked" : "ready",
      detail: missingStatusProbeOperations.length > 0
        ? `${missingStatusProbeOperations.length} operation(s) lack adapter status probe commands.`
        : "Adapter status probe commands are available for release tracking.",
      nextAction: missingStatusProbeOperations.length > 0 ? "repair-adapter-status-contracts" : "persist-status-cursors",
      operationIds: missingStatusProbeOperations.map((operation) => operation.id),
    },
    {
      name: "write-approval",
      status: writeLikeOperations.length > 0 && lifecycle.allowApprovalPause ? "review" : "ready",
      detail: writeLikeOperations.length > 0
        ? `${writeLikeOperations.length} write-like operation(s) require tenant approval evaluation before handoff.`
        : "No write-like Mailchimp operations require approval pause.",
      nextAction: writeLikeOperations.length > 0 ? "evaluate-tenant-approval" : "continue-release-validation",
      operationIds: writeLikeOperations.map((operation) => operation.id),
    },
  ];
  const blockedChecks = checks.filter((check) => check.status === "blocked");
  const reviewChecks = checks.filter((check) => check.status === "review");
  const releaseState = !lifecycle.enabled || lifecycle.command === "disable" || lifecycle.command === "cancel"
    ? "disabled"
    : blockedChecks.length > 0
      ? "blocked"
      : lifecycle.command === "schedule" || lifecycle.schedule.mode === "windowed"
        ? "scheduled"
        : reviewChecks.length > 0
          ? "review"
          : "ready";
  const releaseCommand = lifecycleControls.commands.find((command) => (
    ["schedule-runtime-release", "persist-lifecycle-settings"].includes(command.type)
  )) ?? lifecycleControls.commands[0] ?? null;
  const holdCommand = lifecycleControls.commands.find((command) => command.type === "hold-runtime-release") ?? null;
  return {
    id: stableId("releasegate", [
      ast.id,
      lifecycle.id,
      releaseState,
      checks.map((check) => `${check.name}:${check.status}`).join(","),
    ]),
    product: "mailchimp",
    state: releaseState,
    releaseAllowed: releaseState === "ready" || (releaseState === "review" && lifecycle.allowDegraded),
    releasePolicy: lifecycle.releasePolicy,
    command: lifecycle.command,
    schedule: lifecycle.schedule,
    gateReason: blockedChecks[0]?.name ?? reviewChecks[0]?.name ?? releaseState,
    nextAction: blockedChecks[0]?.nextAction
      ?? reviewChecks[0]?.nextAction
      ?? lifecycleControls.nextAction.action,
    releaseCommandId: releaseState === "disabled" ? holdCommand?.id ?? null : releaseCommand?.id ?? null,
    checks,
    blockedCheckNames: blockedChecks.map((check) => check.name),
    reviewCheckNames: reviewChecks.map((check) => check.name),
    operationSets: {
      allOperationIds: operations.map((operation) => operation.id),
      writeLikeOperationIds: writeLikeOperations.map((operation) => operation.id),
      restartUnsafeOperationIds: restartUnsafeOperations.map((operation) => operation.id),
      missingStatusProbeOperationIds: missingStatusProbeOperations.map((operation) => operation.id),
    },
  };
}

function buildLifecycleOperatorOverrideContract(ast, compiledOperations, lifecycleControls, source = {}) {
  const releaseGate = lifecycleControls.releaseGate ?? {};
  const overrideSource = source.operatorOverride
    ?? source.lifecycleOverride
    ?? source.runtimeOverride
    ?? {};
  const requestedCommand = ["none", "pause", "resume", "force-hold", "cancel-schedule"].includes(overrideSource.command)
    ? overrideSource.command
    : "none";
  const requestedBy = normalizeIdentifier(overrideSource.requestedBy ?? overrideSource.actor ?? "system", "system");
  const reason = normalizeIdentifier(overrideSource.reason ?? overrideSource.code, requestedCommand === "none" ? "not-requested" : "operator-requested");
  const expiresAfterChecks = Number.isInteger(overrideSource.expiresAfterChecks) && overrideSource.expiresAfterChecks > 0
    ? overrideSource.expiresAfterChecks
    : 1;
  const writeLikeOperationIds = compiledOperations
    .filter((operation) => operation.capabilityNames.some((capability) => (
      capability.endsWith(".write") || capability.endsWith(".send") || capability.includes("segment.write")
    )))
    .map((operation) => operation.id);
  const allowedCommands = releaseGate.state === "disabled"
    ? ["resume"]
    : releaseGate.state === "scheduled"
      ? ["pause", "cancel-schedule", "resume"]
      : ["pause", "force-hold", "resume"];
  const commandAllowed = requestedCommand === "none" || allowedCommands.includes(requestedCommand);
  const rows = [
    {
      key: "override-command",
      state: commandAllowed ? "ready" : "blocked",
      requestedCommand,
      allowedCommands,
      nextAction: commandAllowed ? "record-lifecycle-override" : "choose-supported-lifecycle-override",
    },
    {
      key: "release-gate",
      state: releaseGate.state === "blocked" || releaseGate.state === "disabled"
        ? "blocked"
        : releaseGate.state === "scheduled"
          ? "waiting"
          : "ready",
      sourceId: releaseGate.id ?? lifecycleControls.stateId,
      nextAction: releaseGate.nextAction ?? lifecycleControls.nextAction?.action ?? "prepare-manual-release",
    },
    {
      key: "write-approval-pause",
      state: writeLikeOperationIds.length > 0 && requestedCommand === "resume" && releaseGate.state === "review"
        ? "review"
        : "ready",
      operationIds: writeLikeOperationIds,
      nextAction: writeLikeOperationIds.length > 0 ? "evaluate-tenant-approval" : "continue-runtime-release",
    },
  ];
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const reviewRows = rows.filter((row) => row.state === "review");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const overrideState = blockedRows.length > 0
    ? "blocked"
    : requestedCommand === "pause" || requestedCommand === "force-hold" || requestedCommand === "cancel-schedule"
      ? "held"
      : waitingRows.length > 0
        ? "waiting"
        : reviewRows.length > 0
          ? "review"
          : "ready";
  const overrideId = stableId("lifeoverride", [
    ast.id,
    lifecycleControls.stateId,
    requestedCommand,
    requestedBy,
    reason,
    overrideState,
    rows.map((row) => `${row.key}:${row.state}`).join(","),
  ]);
  const command = {
    id: stableId("lifeoverridecmd", [overrideId, "persist-lifecycle-operator-override"]),
    type: "persist-lifecycle-operator-override",
    idempotencyKey: stableId("idem", [overrideId, "persist-lifecycle-operator-override"]),
    statusAfterReplay: overrideState,
    writes: ["overrideState", "requestedCommand", "requestedBy", "reason", "affectedOperationIds"],
    conflict: "return-existing",
  };
  return {
    id: overrideId,
    product: "mailchimp",
    contractVersion: "aios.mailchimp.lifecycle-operator-override.v1",
    state: overrideState,
    ready: overrideState === "ready" || overrideState === "review",
    requestedCommand,
    requestedBy,
    reason,
    expiresAfterChecks,
    affectsRuntimeHandoff: ["held", "blocked", "waiting"].includes(overrideState),
    rows,
    command,
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? reviewRows[0]?.nextAction
      ?? (overrideState === "held" ? "hold-runtime-handoff" : "persist-lifecycle-operator-override"),
    affectedOperationIds: requestedCommand === "none" ? [] : compiledOperations.map((operation) => operation.id),
    clientPatch: {
      lifecycleOperatorOverrideId: overrideId,
      lifecycleOperatorOverrideState: overrideState,
      lifecycleOperatorOverrideCommand: requestedCommand,
      lifecycleOperatorOverrideNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? "persist-lifecycle-operator-override",
      lifecycleOperatorOverrideAffectedOperationIds: requestedCommand === "none"
        ? []
        : compiledOperations.map((operation) => operation.id),
    },
    restartSemantics: {
      restartSafe: blockedRows.length === 0,
      onRestart: overrideState === "ready" ? "load-lifecycle-operator-override" : "rebuild-lifecycle-operator-override",
      onDuplicateCommand: "return-existing-lifecycle-operator-override",
      externalWritesPerformed: false,
    },
  };
}

function buildLifecycleReleaseAcceptanceContract(
  ast,
  compiledOperations,
  lifecycleControls,
  syncServiceContract,
  previewContract,
  providerClientHandoff,
) {
  const releaseGate = lifecycleControls.releaseGate ?? {};
  const schedule = lifecycleControls.schedule ?? { mode: "manual" };
  const operationRows = compiledOperations.map((operation, index) => {
    const commandState = operation.stateContract?.commandState ?? {};
    const statusLedger = operation.stateContract?.statusLedger ?? {};
    const handoffCommand = commandState.commands?.find((command) => command.type === "adapter-handoff") ?? null;
    const statusCommand = commandState.commands?.find((command) => command.type === "adapter-status-probe") ?? null;
    const restartSafe = operation.stateContract?.restartSafe !== false;
    const hasIdempotency = Boolean(operation.stateContract?.idempotency?.key);
    const hasTerminalStatuses = (operation.stateContract?.adapterStatus?.expected?.terminal ?? []).length > 0;
    const state = !restartSafe || !statusCommand || !hasTerminalStatuses
      ? "blocked"
      : !hasIdempotency
        ? "review"
        : "ready";
    return {
      sequence: index + 1,
      operationId: operation.id,
      operation: operation.operation,
      adapter: operation.adapter,
      state,
      restartSafe,
      checkpointKey: operation.stateContract?.checkpointKey ?? null,
      commandLedgerKey: commandState.ledgerKey ?? null,
      handoffCommandId: handoffCommand?.id ?? null,
      statusCommandId: statusCommand?.id ?? null,
      idempotencyKey: operation.stateContract?.idempotency?.key ?? null,
      terminalStatuses: operation.stateContract?.adapterStatus?.expected?.terminal ?? [],
      visibleStatus: state === "ready"
        ? statusLedger.clientStatusIndex?.checkpointed?.visibleStatus ?? "ready-for-adapter-handoff"
        : state === "review"
          ? "review-idempotency-before-release"
          : "repair-operation-before-release",
      nextAction: !restartSafe
        ? "repair-state-contracts"
        : !statusCommand || !hasTerminalStatuses
          ? "repair-adapter-status-contracts"
          : !hasIdempotency
            ? "review-idempotency-policy"
            : "accept-operation-release",
    };
  });
  const blockedRows = operationRows.filter((row) => row.state === "blocked");
  const reviewRows = operationRows.filter((row) => row.state === "review");
  const requiredInputs = [
    {
      name: "releaseAcceptanceId",
      value: stableId("releaseinput", [ast.id, releaseGate.id, "releaseAcceptanceId"]),
      required: true,
    },
    {
      name: "packagePreviewId",
      value: previewContract.id,
      required: true,
    },
    {
      name: "syncContractId",
      value: syncServiceContract.id,
      required: true,
    },
    {
      name: "lifecycleReleaseGateId",
      value: releaseGate.id ?? null,
      required: Boolean(releaseGate.id),
    },
    {
      name: "providerClientHandoffId",
      value: providerClientHandoff.id,
      required: providerClientHandoff.ready !== false,
    },
    {
      name: "operationStatusCommandIds",
      value: operationRows.map((row) => row.statusCommandId).filter(Boolean),
      required: true,
    },
  ];
  const state = releaseGate.state === "disabled"
    ? "disabled"
    : releaseGate.state === "scheduled"
      ? "scheduled"
      : releaseGate.releaseAllowed === false || blockedRows.length > 0
        ? "blocked"
        : reviewRows.length > 0 || previewContract.status === "review" || providerClientHandoff.state === "review"
          ? "review"
          : "ready";
  const acceptanceId = stableId("releaseaccept", [
    ast.id,
    previewContract.id,
    providerClientHandoff.id,
    state,
    operationRows.map((row) => `${row.operationId}:${row.state}`).join(","),
  ]);
  const command = {
    id: stableId("lifecmd", [acceptanceId, "persist-release-acceptance"]),
    type: "persist-release-acceptance",
    idempotencyKey: stableId("idem", [acceptanceId, "persist-release-acceptance"]),
    statusAfterReplay: state === "ready" ? "release-accepted" : "release-acceptance-recorded",
    writes: ["releaseAcceptanceId", "packagePreviewId", "lifecycleReleaseGateId", "operationStatusCommandIds"],
    conflict: "return-existing",
  };
  return {
    id: acceptanceId,
    product: "mailchimp",
    contractVersion: "aios.mailchimp.lifecycle-release-acceptance.v1",
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "ready-to-accept-release"
      : state === "scheduled"
        ? "waiting-for-release-schedule"
        : state === "review"
          ? "review-before-release-acceptance"
          : state === "disabled"
            ? "release-disabled"
            : "blocked-before-release-acceptance",
    nextAction: state === "ready"
      ? "persist-release-acceptance"
      : state === "scheduled"
        ? "wait-for-release-schedule"
        : state === "disabled"
          ? "enable-package-lifecycle"
          : blockedRows[0]?.nextAction
            ?? releaseGate.nextAction
            ?? previewContract.nextAction
            ?? "review-release-acceptance",
    releaseGateId: releaseGate.id ?? null,
    releaseGateState: releaseGate.state ?? "unknown",
    schedule,
    canReleaseNow: state === "ready" && schedule.mode !== "disabled",
    operationRows,
    blockers: [
      ...(releaseGate.releaseAllowed === false ? [`release-gate:${releaseGate.gateReason ?? "blocked"}`] : []),
      ...blockedRows.map((row) => `operation:${row.operationId}:${row.nextAction}`),
      ...(providerClientHandoff.state === "blocked" ? ["provider-client-handoff-blocked"] : []),
      ...(previewContract.status === "blocked" ? ["package-preview-blocked"] : []),
    ],
    reviewReasons: [
      ...reviewRows.map((row) => `operation:${row.operationId}:${row.nextAction}`),
      ...(providerClientHandoff.state === "review" ? ["provider-client-handoff-review"] : []),
      ...(previewContract.status === "review" ? ["package-preview-review"] : []),
    ],
    requiredInputs,
    command,
    clientPatch: {
      releaseAcceptanceId: acceptanceId,
      releaseAcceptanceState: state,
      releaseAcceptanceReady: state === "ready",
      releaseAcceptanceNextAction: state === "ready" ? "persist-release-acceptance" : null,
      releaseAcceptanceBlockedOperationIds: blockedRows.map((row) => row.operationId),
      releaseAcceptanceReviewOperationIds: reviewRows.map((row) => row.operationId),
    },
  };
}

function buildLifecycleSettingsAdoptionContract(ast, lifecycleControls, syncServiceContract, previewContract) {
  const releaseGate = lifecycleControls.releaseGate ?? {};
  const schedule = lifecycleControls.schedule ?? { mode: "manual" };
  const nextAction = lifecycleControls.nextAction ?? {};
  const windowedSchedule = schedule.mode === "windowed";
  const settingsRows = [
    {
      key: "enabled",
      setting: "runtime.enabled",
      value: lifecycleControls.enabled === true,
      state: lifecycleControls.enabled === false ? "blocked" : "ready",
      nextAction: lifecycleControls.enabled === false ? "enable-package-lifecycle" : "persist-lifecycle-settings",
      commandId: lifecycleControls.commands?.find((command) => command.type === "persist-lifecycle-settings")?.id ?? null,
    },
    {
      key: "release-policy",
      setting: "runtime.releasePolicy",
      value: lifecycleControls.releasePolicy,
      state: lifecycleControls.releasePolicy === "disabled" ? "blocked" : "ready",
      nextAction: lifecycleControls.releasePolicy === "disabled" ? "choose-release-policy" : "persist-lifecycle-settings",
      commandId: lifecycleControls.commands?.find((command) => command.type === "persist-lifecycle-settings")?.id ?? null,
    },
    {
      key: "schedule",
      setting: "runtime.schedule",
      value: {
        mode: schedule.mode,
        windowStart: schedule.windowStart,
        windowEnd: schedule.windowEnd,
        timezone: schedule.timezone,
      },
      state: schedule.mode === "disabled"
        ? "blocked"
        : windowedSchedule && (!schedule.windowStart || !schedule.windowEnd)
          ? "blocked"
          : releaseGate.state === "scheduled"
            ? "waiting"
            : "ready",
      nextAction: schedule.mode === "disabled"
        ? "choose-release-schedule"
        : windowedSchedule && (!schedule.windowStart || !schedule.windowEnd)
          ? "declare-release-window"
          : releaseGate.state === "scheduled"
            ? "wait-for-release-schedule"
            : "persist-release-schedule",
      commandId: lifecycleControls.commands?.find((command) => command.type === "schedule-runtime-release")?.id
        ?? lifecycleControls.commands?.find((command) => command.type === "persist-lifecycle-settings")?.id
        ?? null,
    },
    {
      key: "concurrency",
      setting: "runtime.maxConcurrentJobs",
      value: lifecycleControls.concurrency?.maxConcurrentJobs ?? null,
      state: lifecycleControls.concurrency?.requiresQueue ? "review" : "ready",
      nextAction: lifecycleControls.concurrency?.requiresQueue ? "queue-runtime-release" : "persist-lifecycle-settings",
      commandId: lifecycleControls.commands?.find((command) => command.type === "persist-lifecycle-settings")?.id ?? null,
    },
    {
      key: "sync-handoff",
      setting: "provider.syncHandoff",
      value: syncServiceContract.externalHandoff?.state ?? "unknown",
      state: syncServiceContract.externalHandoff?.state === "disabled"
        ? "blocked"
        : syncServiceContract.externalHandoff?.state === "scheduled"
          ? "waiting"
          : "ready",
      nextAction: syncServiceContract.externalHandoff?.nextAction ?? "negotiate-provider-capabilities",
      commandId: null,
    },
  ];
  const blockedRows = settingsRows.filter((row) => row.state === "blocked");
  const waitingRows = settingsRows.filter((row) => row.state === "waiting");
  const reviewRows = settingsRows.filter((row) => row.state === "review");
  const state = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : reviewRows.length > 0 || previewContract.status === "review"
        ? "review"
        : "ready";
  const adoptionScope = [
    ast.id,
    lifecycleControls.stateId,
    syncServiceContract.id,
    previewContract.id,
    state,
    settingsRows.map((row) => `${row.key}:${row.state}:${row.commandId ?? "none"}`).join(","),
  ];
  const command = {
    id: stableId("settingscmd", [...adoptionScope, "persist-lifecycle-settings-adoption"]),
    type: "persist-lifecycle-settings-adoption",
    idempotencyKey: stableId("idem", [...adoptionScope, "persist-lifecycle-settings-adoption"]),
    statusAfterReplay: state === "ready" ? "lifecycle-settings-adopted" : `lifecycle-settings-${state}`,
    writes: ["lifecycleSettingsAdoptionId", "settingsRows", "settingState", "nextAction"],
    conflict: "return-existing",
  };
  return {
    id: stableId("settingsadopt", adoptionScope),
    product: "mailchimp",
    contractVersion: "aios.mailchimp.lifecycle-settings-adoption.v1",
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "lifecycle-settings-ready"
      : state === "waiting"
        ? "lifecycle-settings-waiting"
        : state === "review"
          ? "review-lifecycle-settings"
          : "repair-lifecycle-settings",
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? reviewRows[0]?.nextAction
      ?? nextAction.action
      ?? "persist-lifecycle-settings-adoption",
    rows: settingsRows,
    command,
    settings: {
      enabled: lifecycleControls.enabled === true,
      command: lifecycleControls.command,
      releasePolicy: lifecycleControls.releasePolicy,
      schedule,
      maxConcurrentJobs: lifecycleControls.concurrency?.maxConcurrentJobs ?? null,
      requiresQueue: lifecycleControls.concurrency?.requiresQueue === true,
      syncHandoffState: syncServiceContract.externalHandoff?.state ?? "unknown",
    },
    validationSummary: {
      blockedKeys: blockedRows.map((row) => row.key),
      waitingKeys: waitingRows.map((row) => row.key),
      reviewKeys: reviewRows.map((row) => row.key),
      releaseGateId: releaseGate.id ?? null,
      releaseGateState: releaseGate.state ?? "unknown",
      previewStatus: previewContract.status,
    },
    clientPatch: {
      lifecycleSettingsAdoptionId: stableId("settingspatch", [ast.id, state, lifecycleControls.stateId]),
      lifecycleSettingsState: state,
      lifecycleSettingsReady: state === "ready",
      lifecycleSettingsNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? "persist-lifecycle-settings-adoption",
      lifecycleSettingsBlockedKeys: blockedRows.map((row) => row.key),
      lifecycleSettingsWaitingKeys: waitingRows.map((row) => row.key),
      lifecycleSettingsReviewKeys: reviewRows.map((row) => row.key),
      lifecycleSettingsCommandId: command.id,
    },
  };
}

function buildLifecycleCommandDispatchPacket(
  ast,
  compiledOperations,
  lifecycleControls,
  syncServiceContract,
  providerIntegrationContract,
  releaseAcceptanceContract,
  runtimeBoundaryRelease,
) {
  const releaseGate = lifecycleControls.releaseGate ?? {};
  const settingsAdoption = lifecycleControls.settingsAdoption ?? {};
  const schedule = lifecycleControls.schedule ?? { mode: "manual" };
  const providerBlocked = providerIntegrationContract.state === "blocked";
  const providerWaiting = providerIntegrationContract.state === "waiting";
  const releaseBlocked = ["blocked", "disabled"].includes(releaseGate.state);
  const releaseWaiting = releaseGate.state === "scheduled" || releaseAcceptanceContract.state === "scheduled";
  const runtimeBlocked = runtimeBoundaryRelease.state === "blocked";
  const writeLikeOperationIds = compiledOperations
    .filter((operation) => operation.capabilityNames.some((capability) => (
      capability.endsWith(".write") || capability.endsWith(".send") || capability.includes("segment.write")
    )))
    .map((operation) => operation.id);
  const dispatchRows = [
    {
      key: "settings",
      state: settingsAdoption.state ?? "unknown",
      commandId: settingsAdoption.command?.id ?? lifecycleControls.commands?.find((command) => (
        command.type === "persist-lifecycle-settings"
      ))?.id ?? null,
      enabled: lifecycleControls.enabled === true,
      nextAction: settingsAdoption.nextAction ?? lifecycleControls.nextAction?.action ?? "persist-lifecycle-settings",
      restartSafe: settingsAdoption.state !== "blocked",
    },
    {
      key: "schedule",
      state: schedule.mode === "disabled"
        ? "blocked"
        : releaseWaiting
          ? "waiting"
          : "ready",
      commandId: lifecycleControls.commands?.find((command) => command.type === "schedule-runtime-release")?.id
        ?? lifecycleControls.commands?.find((command) => command.type === "persist-lifecycle-settings")?.id
        ?? null,
      enabled: lifecycleControls.enabled === true && schedule.mode !== "disabled",
      nextAction: schedule.mode === "disabled"
        ? "choose-release-schedule"
        : releaseWaiting
          ? "wait-for-release-schedule"
          : "persist-release-schedule",
      restartSafe: schedule.mode !== "disabled",
    },
    {
      key: "release-acceptance",
      state: releaseAcceptanceContract.state ?? "unknown",
      commandId: releaseAcceptanceContract.command?.id ?? null,
      enabled: releaseAcceptanceContract.ready === true,
      nextAction: releaseAcceptanceContract.nextAction ?? "review-release-acceptance",
      restartSafe: releaseAcceptanceContract.state !== "blocked",
    },
    {
      key: "provider-integration",
      state: providerIntegrationContract.state ?? "unknown",
      commandId: providerIntegrationContract.command?.id ?? null,
      enabled: providerIntegrationContract.ready === true,
      nextAction: providerIntegrationContract.nextAction ?? "review-provider-integration-contract",
      restartSafe: providerIntegrationContract.state !== "blocked",
    },
    {
      key: "runtime-boundary",
      state: runtimeBoundaryRelease.state ?? "unknown",
      commandId: runtimeBoundaryRelease.command?.id ?? null,
      enabled: runtimeBoundaryRelease.ready === true,
      nextAction: runtimeBoundaryRelease.nextAction ?? "review-runtime-boundary-release",
      restartSafe: runtimeBoundaryRelease.state !== "blocked",
    },
  ];
  const blockedRows = dispatchRows.filter((row) => row.state === "blocked");
  const waitingRows = dispatchRows.filter((row) => ["waiting", "review", "scheduled"].includes(row.state));
  const state = blockedRows.length > 0 || releaseBlocked || providerBlocked || runtimeBlocked
    ? "blocked"
    : waitingRows.length > 0 || providerWaiting
      ? "waiting"
      : "ready";
  const dispatchId = stableId("lifedispatch", [
    ast.id,
    lifecycleControls.stateId,
    syncServiceContract.id,
    providerIntegrationContract.id,
    runtimeBoundaryRelease.id,
    state,
    dispatchRows.map((row) => `${row.key}:${row.state}:${row.commandId ?? "none"}`).join(","),
  ]);
  const command = {
    id: stableId("lifedispatchcmd", [dispatchId, "persist-lifecycle-command-dispatch"]),
    type: "persist-lifecycle-command-dispatch",
    idempotencyKey: stableId("idem", [dispatchId, "persist-lifecycle-command-dispatch"]),
    statusAfterReplay: state === "ready" ? "lifecycle-dispatch-ready" : `lifecycle-dispatch-${state}`,
    writes: ["dispatchRows", "dispatchState", "providerHandoffState", "runtimeBoundaryState"],
    conflict: "return-existing",
  };
  return {
    id: dispatchId,
    product: "mailchimp",
    contractVersion: "aios.mailchimp.lifecycle-command-dispatch.v1",
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "lifecycle-dispatch-ready"
      : state === "waiting"
        ? "lifecycle-dispatch-waiting"
        : "repair-lifecycle-dispatch",
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? (providerWaiting ? "wait-for-provider-integration" : null)
      ?? "persist-lifecycle-command-dispatch",
    rows: dispatchRows,
    command,
    providerHandoff: {
      syncContractId: syncServiceContract.id,
      providerIntegrationContractId: providerIntegrationContract.id,
      providerState: providerIntegrationContract.state,
      providerReady: providerIntegrationContract.ready === true,
      missingFeatures: providerIntegrationContract.validationSummary?.missingFeatures ?? [],
      waitingFeatures: providerIntegrationContract.validationSummary?.waitingFeatures ?? [],
      requiredProviderCapabilities: syncServiceContract.requiredProviderCapabilities ?? [],
    },
    scheduling: {
      mode: schedule.mode,
      windowStart: schedule.windowStart,
      windowEnd: schedule.windowEnd,
      timezone: schedule.timezone,
      releaseGateState: releaseGate.state ?? "unknown",
      releaseAllowed: releaseGate.releaseAllowed === true,
      writeLikeOperationIds,
    },
    validationSummary: {
      blockedKeys: blockedRows.map((row) => row.key),
      waitingKeys: waitingRows.map((row) => row.key),
      providerBlocked,
      providerWaiting,
      releaseBlocked,
      releaseWaiting,
      runtimeBlocked,
      operationCount: compiledOperations.length,
    },
    clientPatch: {
      lifecycleDispatchId: dispatchId,
      lifecycleDispatchState: state,
      lifecycleDispatchReady: state === "ready",
      lifecycleDispatchNextAction: blockedRows[0]?.nextAction
        ?? waitingRows[0]?.nextAction
        ?? "persist-lifecycle-command-dispatch",
      lifecycleDispatchBlockedKeys: blockedRows.map((row) => row.key),
      lifecycleDispatchWaitingKeys: waitingRows.map((row) => row.key),
      lifecycleDispatchCommandId: command.id,
    },
  };
}

function buildOperatorReleaseChecklist(ast, lifecycleControls, previewContract, providerClientHandoff, releaseAcceptanceContract) {
  const releaseGate = lifecycleControls.releaseGate ?? {};
  const schedule = lifecycleControls.schedule ?? { mode: "manual" };
  const acceptanceInputs = releaseAcceptanceContract.requiredInputs ?? [];
  const providerInputs = providerClientHandoff.clientRequiredInputs ?? [];
  const operationRows = releaseAcceptanceContract.operationRows ?? [];
  const checks = [
    {
      key: "package-preview",
      label: "Package Preview",
      state: previewContract.status === "ready" ? "ready" : previewContract.status === "review" ? "review" : "blocked",
      required: true,
      sourceId: previewContract.id,
      nextAction: previewContract.nextAction ?? "review-package-preview",
      blockingReasons: previewContract.status === "blocked" ? ["package-preview-blocked"] : [],
      reviewReasons: previewContract.status === "review" ? ["package-preview-review"] : [],
    },
    {
      key: "lifecycle-release-gate",
      label: "Lifecycle Release Gate",
      state: releaseGate.state === "ready" || releaseGate.releaseAllowed === true
        ? "ready"
        : releaseGate.state === "scheduled"
          ? "waiting"
          : releaseGate.state === "review"
            ? "review"
            : "blocked",
      required: true,
      sourceId: releaseGate.id ?? lifecycleControls.stateId,
      nextAction: releaseGate.nextAction ?? lifecycleControls.nextAction?.action ?? "prepare-manual-release",
      blockingReasons: releaseGate.releaseAllowed === false ? [`release-gate:${releaseGate.gateReason ?? "blocked"}`] : [],
      reviewReasons: releaseGate.state === "review" ? [`release-gate:${releaseGate.gateReason ?? "review"}`] : [],
    },
    {
      key: "provider-client-handoff",
      label: "Provider Client Handoff",
      state: providerClientHandoff.state === "ready"
        ? "ready"
        : providerClientHandoff.state === "scheduled"
          ? "waiting"
          : providerClientHandoff.state === "review"
            ? "review"
            : "blocked",
      required: true,
      sourceId: providerClientHandoff.id,
      nextAction: providerClientHandoff.nextAction ?? "review-client-handoff",
      blockingReasons: providerClientHandoff.blockers ?? [],
      reviewReasons: providerClientHandoff.reviewReasons ?? [],
    },
    {
      key: "release-acceptance",
      label: "Release Acceptance",
      state: releaseAcceptanceContract.state === "ready"
        ? "ready"
        : releaseAcceptanceContract.state === "scheduled"
          ? "waiting"
          : releaseAcceptanceContract.state === "review"
            ? "review"
            : "blocked",
      required: true,
      sourceId: releaseAcceptanceContract.id,
      nextAction: releaseAcceptanceContract.nextAction ?? "review-release-acceptance",
      blockingReasons: releaseAcceptanceContract.blockers ?? [],
      reviewReasons: releaseAcceptanceContract.reviewReasons ?? [],
    },
    {
      key: "operation-status-commands",
      label: "Operation Status Commands",
      state: operationRows.every((row) => row.statusCommandId && row.terminalStatuses?.length > 0)
        ? "ready"
        : "blocked",
      required: true,
      sourceId: stableId("opstatus", [releaseAcceptanceContract.id, operationRows.map((row) => row.operationId).join(",")]),
      nextAction: operationRows.every((row) => row.statusCommandId && row.terminalStatuses?.length > 0)
        ? "persist-status-cursors"
        : "repair-adapter-status-contracts",
      blockingReasons: operationRows
        .filter((row) => !row.statusCommandId || row.terminalStatuses?.length === 0)
        .map((row) => `operation-status:${row.operationId}`),
      reviewReasons: [],
    },
  ];
  const blockedChecks = checks.filter((check) => check.state === "blocked");
  const waitingChecks = checks.filter((check) => check.state === "waiting");
  const reviewChecks = checks.filter((check) => check.state === "review");
  const state = blockedChecks.length > 0
    ? "blocked"
    : waitingChecks.length > 0
      ? "waiting"
      : reviewChecks.length > 0
        ? "review"
        : "ready";
  const checklistScope = [
    ast.id,
    lifecycleControls.stateId,
    previewContract.id,
    providerClientHandoff.id,
    releaseAcceptanceContract.id,
    state,
    checks.map((check) => `${check.key}:${check.state}`).join(","),
  ];
  const requiredInputNames = [...new Set([
    ...acceptanceInputs,
    ...providerInputs,
  ].filter((input) => input.required).map((input) => input.name))].sort();
  const command = {
    id: stableId("lifecmd", [...checklistScope, "persist-operator-release-checklist"]),
    type: "persist-operator-release-checklist",
    idempotencyKey: stableId("idem", [...checklistScope, "persist-operator-release-checklist"]),
    statusAfterReplay: state === "ready" ? "operator-release-checklist-ready" : `operator-release-checklist-${state}`,
    writes: ["operatorReleaseChecklistId", "checkStates", "requiredInputNames", "nextAction"],
    conflict: "return-existing",
  };
  return {
    id: stableId("opcheck", checklistScope),
    product: "mailchimp",
    contractVersion: "aios.mailchimp.operator-release-checklist.v1",
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "ready-for-operator-release"
      : state === "waiting"
        ? "waiting-for-release-window"
        : state === "review"
          ? "review-operator-release"
          : "blocked-before-operator-release",
    nextAction: blockedChecks[0]?.nextAction
      ?? waitingChecks[0]?.nextAction
      ?? reviewChecks[0]?.nextAction
      ?? "persist-operator-release-checklist",
    schedule,
    checks,
    requiredInputNames,
    blockers: [...new Set(blockedChecks.flatMap((check) => check.blockingReasons))].sort(),
    reviewReasons: [...new Set(reviewChecks.flatMap((check) => check.reviewReasons))].sort(),
    command,
    clientPatch: {
      operatorReleaseChecklistId: stableId("opcheckpatch", checklistScope),
      operatorReleaseChecklistState: state,
      operatorReleaseChecklistReady: state === "ready",
      operatorReleaseChecklistNextAction: blockedChecks[0]?.nextAction
        ?? waitingChecks[0]?.nextAction
        ?? reviewChecks[0]?.nextAction
        ?? "persist-operator-release-checklist",
      operatorReleaseBlockedCheckKeys: blockedChecks.map((check) => check.key),
      operatorReleaseWaitingCheckKeys: waitingChecks.map((check) => check.key),
      operatorReleaseReviewCheckKeys: reviewChecks.map((check) => check.key),
    },
  };
}

function summarizeIssueCounts(issues) {
  return issues.reduce((counts, issue) => {
    counts[issue.severity] = (counts[issue.severity] ?? 0) + 1;
    return counts;
  }, {});
}

function buildManifestPreviewContract(ast, compiledOperations, lifecycleControls, syncServiceContract, issues) {
  const issueCounts = summarizeIssueCounts(issues);
  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const warningIssues = issues.filter((issue) => issue.severity === "warning");
  const writeLikeOperations = compiledOperations.filter((operation) => (
    operation.capabilityNames.some((capability) => (
      capability.endsWith(".write") || capability.endsWith(".send") || capability.includes("segment.write")
    ))
  ));
  const restartUnsafeOperations = compiledOperations.filter((operation) => (
    operation.stateContract?.restartSafe === false
  ));
  const missingIdempotencyOperations = compiledOperations.filter((operation) => (
    operation.stateContract?.idempotency?.mode === "required" && !operation.stateContract.idempotency.key
  ));
  const adapterStatusBlockedOperations = compiledOperations.filter((operation) => (
    (operation.stateContract?.adapterStatus?.expected?.terminal ?? []).length === 0
  ));
  const operationRows = compiledOperations.map((operation, index) => ({
    sequence: index + 1,
    id: operation.id,
    operation: operation.operation,
    adapter: operation.adapter,
    descriptorId: operation.descriptorId,
    writeLike: writeLikeOperations.some((entry) => entry.id === operation.id),
    checkpointKey: operation.stateContract?.checkpointKey ?? null,
    ledgerKey: operation.stateContract?.commandState?.ledgerKey ?? null,
    idempotencyKey: operation.stateContract?.idempotency?.key ?? null,
    adapterStatusContractId: operation.stateContract?.adapterStatus?.id ?? null,
    adapterStatusProbe: operation.stateContract?.adapterStatus?.probe ?? null,
    restartSafe: operation.stateContract?.restartSafe !== false,
    visibleStatus: operation.stateContract?.restartSafe === false
      ? "restart-review-required"
      : operation.stateContract?.idempotency?.mode === "none"
        ? "idempotency-review-required"
        : "ready-for-preview",
  }));
  const requiredEvidenceFacts = [...new Set([
    ...syncServiceContract.requiredFacts,
    ...compiledOperations.flatMap((operation) => (
      operation.truthBoundary?.evidenceRequired ? operation.verifierNames : []
    )),
  ])].sort();
  const readinessChecks = [
    {
      name: "manifest-validation",
      status: errorIssues.length > 0 ? "blocked" : warningIssues.length > 0 ? "review" : "ready",
      detail: errorIssues.length > 0
        ? `${errorIssues.length} manifest error(s) block Mailchimp package acceptance.`
        : warningIssues.length > 0
          ? `${warningIssues.length} manifest warning(s) should be reviewed before handoff.`
          : "Manifest validation has no blocking issues.",
      nextAction: errorIssues.length > 0 ? "repair-manifest-errors" : "review-preview",
    },
    {
      name: "sync-bindings",
      status: syncServiceContract.requiredFacts.length > 0 ? "needs-claim-evidence" : "ready",
      detail: syncServiceContract.requiredFacts.length > 0
        ? `Mailchimp sync waits for claim facts: ${syncServiceContract.requiredFacts.join(", ")}.`
        : "Mailchimp sync has concrete object bindings or does not require claim evidence.",
      nextAction: syncServiceContract.requiredFacts.length > 0 ? "collect-claim-evidence" : "negotiate-provider-capabilities",
    },
    {
      name: "restart-safety",
      status: restartUnsafeOperations.length > 0 ? "blocked" : missingIdempotencyOperations.length > 0 ? "review" : "ready",
      detail: restartUnsafeOperations.length > 0
        ? `${restartUnsafeOperations.length} operation(s) are not restart-safe.`
        : missingIdempotencyOperations.length > 0
          ? `${missingIdempotencyOperations.length} operation(s) need idempotency review.`
          : "Operations have restart-safe state contracts.",
      nextAction: restartUnsafeOperations.length > 0 ? "repair-state-contracts" : "persist-command-ledgers",
    },
    {
      name: "adapter-status",
      status: adapterStatusBlockedOperations.length > 0 ? "blocked" : "ready",
      detail: adapterStatusBlockedOperations.length > 0
        ? `${adapterStatusBlockedOperations.length} operation(s) lack deterministic terminal adapter statuses.`
        : "Adapter status probes expose terminal status contracts.",
      nextAction: adapterStatusBlockedOperations.length > 0 ? "declare-adapter-terminal-statuses" : "persist-status-cursors",
    },
    {
      name: "lifecycle",
      status: lifecycleControls.releaseGate?.state === "disabled"
        ? "disabled"
        : lifecycleControls.releaseGate?.state === "blocked"
          ? "blocked"
          : lifecycleControls.releaseGate?.state === "review"
            ? "review"
            : "ready",
      detail: lifecycleControls.enabled === false
        ? "Lifecycle controls hold Mailchimp runtime handoff."
        : `Lifecycle release gate is ${lifecycleControls.releaseGate?.state ?? lifecycleControls.nextAction.action}.`,
      nextAction: lifecycleControls.releaseGate?.nextAction ?? lifecycleControls.nextAction.action,
      releaseGateId: lifecycleControls.releaseGate?.id ?? null,
    },
  ];
  const blockingChecks = readinessChecks.filter((check) => ["blocked", "disabled"].includes(check.status));
  const reviewChecks = readinessChecks.filter((check) => ["review", "needs-claim-evidence"].includes(check.status));
  const readinessStatus = blockingChecks.length > 0
    ? "blocked"
    : reviewChecks.length > 0
      ? "review"
      : "ready";
  const previewId = stableId("pkgpreview", [
    ast.id,
    syncServiceContract.id,
    lifecycleControls.stateId,
    readinessChecks.map((check) => `${check.name}:${check.status}`).join(","),
  ]);
  return {
    id: previewId,
    product: "mailchimp",
    format: "aios.mailchimp.package-preview.v1",
    status: readinessStatus,
    visibleStatus: readinessStatus === "ready"
      ? "ready-to-preview"
      : readinessStatus === "review"
        ? "review-before-acceptance"
        : "blocked-before-preview",
    nextAction: blockingChecks[0]?.nextAction
      ?? reviewChecks[0]?.nextAction
      ?? "preview-runtime-acceptance",
    validationSummary: {
      valid: errorIssues.length === 0,
      issueCounts,
      issueCodes: issues.map((issue) => issue.code),
      operationCount: compiledOperations.length,
      writeLikeOperationIds: writeLikeOperations.map((operation) => operation.id),
      restartUnsafeOperationIds: restartUnsafeOperations.map((operation) => operation.id),
      missingIdempotencyOperationIds: missingIdempotencyOperations.map((operation) => operation.id),
      requiredEvidenceFacts,
    },
    preview: {
      title: "Mailchimp package handoff preview",
      packageName: ast.name,
      version: ast.version,
      adapter: ast.adapter,
      syncContractId: syncServiceContract.id,
      syncMode: syncServiceContract.mode,
      provider: syncServiceContract.provider,
      objectBindings: syncServiceContract.objectBindings,
      cursor: syncServiceContract.cursor,
      lifecycle: {
        stateId: lifecycleControls.stateId,
        command: lifecycleControls.command,
        enabled: lifecycleControls.enabled,
        releasePolicy: lifecycleControls.releasePolicy,
        nextAction: lifecycleControls.nextAction,
        releaseGate: lifecycleControls.releaseGate ?? null,
      },
      operations: operationRows,
    },
    acceptance: {
      canAccept: readinessStatus === "ready",
      acceptAction: readinessStatus === "ready"
        ? "accept-mailchimp-package-preview"
        : "review-package-preview-checks",
      requiredInputs: [
        { name: "previewId", value: previewId, required: true },
        { name: "syncContractId", value: syncServiceContract.id, required: true },
        { name: "lifecycleStateId", value: lifecycleControls.stateId, required: lifecycleControls.enabled !== false },
        {
          name: "commandLedgerKeys",
          value: operationRows.map((operation) => operation.ledgerKey).filter(Boolean),
          required: true,
        },
      ],
      checks: readinessChecks,
    },
  };
}

function buildProviderClientHandoffContract(
  ast,
  compiledOperations,
  lifecycleControls,
  syncServiceContract,
  previewContract,
  providerIntegrationContract,
) {
  const releaseGate = lifecycleControls.releaseGate ?? {};
  const providerIntegration = providerIntegrationContract ?? {};
  const operationRows = compiledOperations.map((operation, index) => {
    const statusLedger = operation.stateContract?.statusLedger ?? {};
    const commandState = operation.stateContract?.commandState ?? {};
    const adapterStatus = operation.stateContract?.adapterStatus ?? {};
    const handoffCommand = commandState.commands?.find((command) => command.type === "adapter-handoff") ?? null;
    const statusCommand = commandState.commands?.find((command) => command.type === "adapter-status-probe") ?? null;
    return {
      sequence: index + 1,
      operationId: operation.id,
      descriptorId: operation.descriptorId,
      operation: operation.operation,
      adapter: operation.adapter,
      checkpointKey: operation.stateContract?.checkpointKey ?? null,
      commandLedgerKey: commandState.ledgerKey ?? null,
      handoffCommandId: handoffCommand?.id ?? null,
      statusCommandId: statusCommand?.id ?? null,
      idempotencyKey: operation.stateContract?.idempotency?.key ?? null,
      adapterStatusContractId: adapterStatus.id ?? null,
      adapterStatusProbe: adapterStatus.probe ?? null,
      adapterStatusResumeCommandId: adapterStatus.recovery?.resumeCommand ?? null,
      terminalStatuses: adapterStatus.expected?.terminal ?? [],
      visibleStatus: statusLedger.clientStatusIndex?.checkpointed?.visibleStatus ?? "ready-for-adapter-handoff",
      nextAction: statusLedger.clientStatusIndex?.checkpointed?.recoveryAction ?? "replay-idempotent-adapter-command",
      restartSafe: operation.stateContract?.restartSafe !== false,
    };
  });
  const requiredInputNames = [
    "packagePreviewId",
    "syncContractId",
    "lifecycleStateId",
    "operationCheckpointKeys",
    "adapterStatusResumeCursors",
  ];
  const blockedReasons = [
    ...(previewContract.status === "blocked" ? ["package-preview-blocked"] : []),
    ...(releaseGate.state === "disabled" ? ["lifecycle-disabled"] : []),
    ...(releaseGate.state === "blocked" ? [`lifecycle-${releaseGate.gateReason ?? "blocked"}`] : []),
    ...(providerIntegration.state === "blocked" ? ["provider-integration-blocked"] : []),
    ...operationRows.filter((row) => !row.statusCommandId).map((row) => `missing-status-command:${row.operationId}`),
    ...operationRows.filter((row) => !row.idempotencyKey).map((row) => `missing-idempotency-key:${row.operationId}`),
  ];
  const reviewReasons = [
    ...(previewContract.status === "review" ? ["package-preview-review"] : []),
    ...(releaseGate.state === "review" ? [`lifecycle-review-${releaseGate.gateReason ?? "required"}`] : []),
    ...(releaseGate.state === "scheduled" ? ["waiting-for-release-schedule"] : []),
    ...(providerIntegration.state === "degraded" ? ["provider-integration-degraded"] : []),
    ...(providerIntegration.state === "waiting" ? ["provider-integration-waiting"] : []),
  ];
  const state = blockedReasons.length > 0
    ? "blocked"
    : releaseGate.state === "scheduled"
      ? "scheduled"
      : reviewReasons.length > 0
        ? "review"
        : "ready";
  const contractScope = [
    ast.id,
    syncServiceContract.id,
    lifecycleControls.stateId,
    previewContract.id,
    state,
    operationRows.map((row) => `${row.operationId}:${row.commandLedgerKey}`).join(","),
  ];
  const providerExternalHandoffLedger = buildProviderExternalHandoffLedger(
    ast,
    operationRows,
    syncServiceContract,
    providerIntegration,
    releaseGate,
    state,
    blockedReasons,
    reviewReasons,
  );
  return {
    id: stableId("clienthandoff", contractScope),
    product: "mailchimp",
    contractVersion: "aios.mailchimp.provider-client-handoff.v1",
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "ready-for-client-handoff"
      : state === "scheduled"
        ? "waiting-for-release-schedule"
        : state === "review"
          ? "review-before-client-handoff"
          : "blocked-before-client-handoff",
    nextAction: blockedReasons.length > 0
      ? handoffBlockerAction(blockedReasons[0])
      : state === "scheduled"
        ? "wait-for-release-schedule"
        : reviewReasons.length > 0
          ? "review-client-handoff"
          : "publish-client-handoff-packet",
    sync: {
      contractId: syncServiceContract.id,
      provider: syncServiceContract.provider,
      mode: syncServiceContract.mode,
      handoffMode: syncServiceContract.handoffMode,
      cursor: syncServiceContract.cursor,
      objectBindings: syncServiceContract.objectBindings,
      requiredFacts: syncServiceContract.requiredFacts,
      requiredProviderCapabilities: syncServiceContract.requiredProviderCapabilities,
      externalHandoff: syncServiceContract.externalHandoff,
    },
    providerIntegration: providerIntegration.id ? {
      contractId: providerIntegration.id,
      service: providerIntegration.service,
      apiVersion: providerIntegration.apiVersion,
      region: providerIntegration.region,
      state: providerIntegration.state,
      ready: providerIntegration.ready === true,
      nextAction: providerIntegration.nextAction,
      serviceLevel: providerIntegration.serviceLevel,
      missingFeatures: providerIntegration.validationSummary?.missingFeatures ?? [],
      waitingFeatures: providerIntegration.validationSummary?.waitingFeatures ?? [],
      commandId: providerIntegration.command?.id ?? null,
    } : null,
    lifecycle: {
      stateId: lifecycleControls.stateId,
      command: lifecycleControls.command,
      enabled: lifecycleControls.enabled,
      releasePolicy: lifecycleControls.releasePolicy,
      releaseGateId: releaseGate.id ?? null,
      releaseGateState: releaseGate.state ?? "unknown",
      releaseAllowed: releaseGate.releaseAllowed === true,
      releaseCommandId: releaseGate.releaseCommandId ?? null,
      nextAction: releaseGate.nextAction ?? lifecycleControls.nextAction?.action ?? "prepare-manual-release",
    },
    clientRequiredInputs: requiredInputNames.map((name) => ({
      name,
      required: true,
      value: {
        packagePreviewId: previewContract.id,
        syncContractId: syncServiceContract.id,
        lifecycleStateId: lifecycleControls.stateId,
        operationCheckpointKeys: operationRows.map((row) => row.checkpointKey).filter(Boolean),
        adapterStatusResumeCursors: operationRows.map((row) => row.adapterStatusResumeCommandId).filter(Boolean),
      }[name],
    })),
    operationRows,
    providerExternalHandoffLedger,
    externalHandoffLedger: providerExternalHandoffLedger,
    blockers: blockedReasons,
    reviewReasons,
    digest: stableId("handoffdigest", contractScope),
  };
}

function buildProviderExternalHandoffLedger(
  ast,
  operationRows,
  syncServiceContract,
  providerIntegration,
  releaseGate,
  handoffState,
  blockedReasons,
  reviewReasons,
) {
  const syncHandoff = syncServiceContract.externalHandoff ?? {};
  const capabilityRows = (syncServiceContract.requiredProviderCapabilities ?? []).map((capability, index) => {
    const featureRows = providerIntegration.featureRows ?? [];
    const relatedFeature = featureRows.find((row) => (
      row.feature === capability
      || row.feature.includes(capability.replace(/^mailchimp\./, "").split(".")[0])
    ));
    return {
      sequence: index + 1,
      capability,
      negotiationState: blockedReasons.includes("provider-integration-blocked")
        ? "blocked"
        : relatedFeature?.state === "missing"
          ? "missing-provider-feature"
          : reviewReasons.includes("provider-integration-degraded")
            ? "review"
            : handoffState === "ready"
              ? "granted"
              : "pending",
      providerFeature: relatedFeature?.feature ?? null,
      nextAction: relatedFeature?.nextAction ?? (
        handoffState === "ready" ? "persist-provider-capability-grant" : "negotiate-provider-capabilities"
      ),
    };
  });
  const operationHandoffRows = operationRows.map((row) => {
    const blocked = !row.statusCommandId || !row.idempotencyKey || row.restartSafe === false;
    return {
      operationId: row.operationId,
      operation: row.operation,
      adapter: row.adapter,
      state: blocked
        ? "blocked"
        : handoffState === "ready"
          ? "ready"
          : handoffState === "scheduled"
            ? "waiting"
            : "review",
      checkpointKey: row.checkpointKey,
      commandLedgerKey: row.commandLedgerKey,
      handoffCommandId: row.handoffCommandId,
      statusCommandId: row.statusCommandId,
      adapterStatusResumeCommandId: row.adapterStatusResumeCommandId,
      idempotencyKey: row.idempotencyKey,
      nextAction: blocked
        ? (!row.statusCommandId ? "repair-adapter-status-contracts" : "declare-operation-idempotency")
        : handoffState === "ready"
          ? "release-provider-operation-handoff"
          : "hold-provider-operation-handoff",
    };
  });
  const blockedOperationRows = operationHandoffRows.filter((row) => row.state === "blocked");
  const waitingOperationRows = operationHandoffRows.filter((row) => row.state === "waiting");
  const ledgerState = blockedOperationRows.length > 0 || handoffState === "blocked"
    ? "blocked"
    : waitingOperationRows.length > 0 || handoffState === "scheduled"
      ? "waiting"
      : handoffState === "review"
        ? "review"
        : "ready";
  const ledgerScope = [
    ast.id,
    syncServiceContract.id,
    providerIntegration.id,
    syncHandoff.handoffId,
    ledgerState,
    operationHandoffRows.map((row) => `${row.operationId}:${row.state}:${row.statusCommandId}`).join(","),
    capabilityRows.map((row) => `${row.capability}:${row.negotiationState}`).join(","),
  ];
  const resumeCursor = stableId("providerhandoffcursor", ledgerScope);
  const command = {
    id: stableId("providerhandoffcmd", [...ledgerScope, "persist-provider-external-handoff-ledger"]),
    type: "persist-provider-external-handoff-ledger",
    idempotencyKey: stableId("idem", [...ledgerScope, "persist-provider-external-handoff-ledger"]),
    statusAfterReplay: ledgerState,
    writes: ["providerHandoffRows", "capabilityNegotiationRows", "resumeCursor", "nextAction"],
    conflict: "return-existing",
  };
  return {
    protocol: "aios.mailchimp.provider-external-handoff-ledger.v1",
    id: stableId("providerhandoffledger", ledgerScope),
    product: "mailchimp",
    state: ledgerState,
    ready: ledgerState === "ready",
    service: providerIntegration.service ?? syncServiceContract.provider,
    syncContractId: syncServiceContract.id,
    syncHandoffId: syncHandoff.handoffId ?? null,
    providerIntegrationContractId: providerIntegration.id ?? null,
    lifecycleGateId: releaseGate.id ?? null,
    lifecycleGateState: releaseGate.state ?? "unknown",
    resumeCursor,
    cursor: {
      checkpointKey: syncServiceContract.cursor?.checkpointKey ?? null,
      resumeFrom: syncServiceContract.cursor?.resumeFrom ?? "last-success",
      ledgerResumeCursor: resumeCursor,
    },
    capabilityRows,
    operationRows: operationHandoffRows,
    command,
    validationSummary: {
      blockedReasons,
      reviewReasons,
      blockedOperationIds: blockedOperationRows.map((row) => row.operationId),
      waitingOperationIds: waitingOperationRows.map((row) => row.operationId),
      missingCapabilities: capabilityRows
        .filter((row) => row.negotiationState === "missing-provider-feature")
        .map((row) => row.capability),
    },
    clientPatch: {
      providerExternalHandoffLedgerId: stableId("providerhandoffpatch", [ast.id, ledgerState]),
      providerExternalHandoffState: ledgerState,
      providerExternalHandoffReady: ledgerState === "ready",
      providerExternalHandoffNextAction: blockedOperationRows[0]?.nextAction
        ?? capabilityRows.find((row) => row.negotiationState === "missing-provider-feature")?.nextAction
        ?? (ledgerState === "waiting" ? "wait-for-provider-handoff" : "release-provider-operation-handoff"),
      providerExternalHandoffResumeCursor: resumeCursor,
      providerExternalHandoffBlockedOperationIds: blockedOperationRows.map((row) => row.operationId),
      providerExternalHandoffWaitingOperationIds: waitingOperationRows.map((row) => row.operationId),
    },
    restartSemantics: {
      restartSafe: ledgerState !== "blocked" && operationHandoffRows.every((row) => row.idempotencyKey),
      onColdRestart: ledgerState === "ready" ? "load-provider-external-handoff-ledger" : "reload-provider-handoff-prerequisites",
      onDuplicateCommand: "return-existing-provider-external-handoff-ledger",
      onMissingStatusCursor: "repair-adapter-status-contracts",
      externalWritesPerformed: false,
    },
  };
}

function buildPackageOperationalIncidentLedger(
  ast,
  compiledOperations,
  lifecycleControls,
  syncServiceContract,
  providerIntegrationContract,
  previewContract,
  providerClientHandoff,
  releaseAcceptanceContract,
  packageAnalyticsExport,
  issues,
) {
  const issueRows = issues.map((issue, index) => ({
    sequence: index + 1,
    key: issue.code ?? `manifest-issue-${index + 1}`,
    source: "manifest-validation",
    state: issue.severity === "error" ? "blocked" : "review",
    severity: issue.severity === "error" ? "error" : "warning",
    operationIds: [issue.operationId, issue.operation].filter(Boolean),
    message: issue.message,
    nextAction: issue.severity === "error" ? "repair-manifest-errors" : "review-manifest-warning",
    restartSafe: issue.severity !== "error",
  }));
  const operationRows = compiledOperations.map((operation, index) => {
    const statusCommand = operation.stateContract?.commandState?.commands?.find((command) => (
      command.type === "adapter-status-probe"
    ));
    const missingTerminalStatuses = (operation.stateContract?.adapterStatus?.expected?.terminal ?? []).length === 0;
    const missingIdempotency = operation.stateContract?.idempotency?.mode !== "none"
      && !operation.stateContract?.idempotency?.key;
    const restartUnsafe = operation.stateContract?.restartSafe === false;
    const state = restartUnsafe || !statusCommand || missingTerminalStatuses
      ? "blocked"
      : missingIdempotency
        ? "review"
        : "ready";
    return {
      sequence: issueRows.length + index + 1,
      key: operation.id,
      source: "operation-runtime-contract",
      state,
      severity: state === "blocked" ? "error" : state === "review" ? "warning" : "info",
      operationIds: [operation.id],
      message: state === "ready"
        ? `${operation.operation} has restart, idempotency, and adapter status contracts.`
        : restartUnsafe
          ? `${operation.operation} is not restart safe.`
          : !statusCommand || missingTerminalStatuses
            ? `${operation.operation} is missing adapter status handoff coverage.`
            : `${operation.operation} should declare a stable idempotency key.`,
      nextAction: restartUnsafe
        ? "repair-state-contracts"
        : !statusCommand || missingTerminalStatuses
          ? "repair-adapter-status-contracts"
          : missingIdempotency
            ? "declare-operation-idempotency"
            : "no-action",
      restartSafe: !restartUnsafe,
      commandIds: operation.stateContract?.commandState?.commands?.map((command) => command.id) ?? [],
      checkpointKey: operation.stateContract?.checkpointKey ?? null,
    };
  });
  const gateRows = [
    {
      key: "lifecycle-release",
      source: "lifecycle-controls",
      state: lifecycleControls.releaseGate?.state === "blocked" || lifecycleControls.releaseGate?.state === "disabled"
        ? "blocked"
        : lifecycleControls.releaseGate?.state === "scheduled" || lifecycleControls.releaseGate?.state === "review"
          ? "review"
          : "ready",
      severity: lifecycleControls.releaseGate?.state === "blocked" || lifecycleControls.releaseGate?.state === "disabled"
        ? "error"
        : lifecycleControls.releaseGate?.state === "scheduled" || lifecycleControls.releaseGate?.state === "review"
          ? "warning"
          : "info",
      operationIds: lifecycleControls.releaseGate?.operationSets?.allOperationIds ?? [],
      message: `Lifecycle release gate is ${lifecycleControls.releaseGate?.state ?? "unknown"}.`,
      nextAction: lifecycleControls.releaseGate?.nextAction ?? lifecycleControls.nextAction?.action ?? "review-lifecycle-release",
      restartSafe: lifecycleControls.releaseGate?.state !== "blocked",
      commandIds: lifecycleControls.commands?.map((command) => command.id) ?? [],
    },
    {
      key: "provider-integration",
      source: "provider-integration",
      state: providerIntegrationContract.state === "blocked"
        ? "blocked"
        : providerIntegrationContract.state === "degraded" || providerIntegrationContract.state === "waiting"
          ? "review"
          : "ready",
      severity: providerIntegrationContract.state === "blocked"
        ? "error"
        : providerIntegrationContract.state === "degraded" || providerIntegrationContract.state === "waiting"
          ? "warning"
          : "info",
      operationIds: providerIntegrationContract.capabilityNegotiation?.writeLikeOperationIds ?? [],
      message: `Provider integration contract is ${providerIntegrationContract.state}.`,
      nextAction: providerIntegrationContract.nextAction ?? "review-provider-integration-contract",
      restartSafe: providerIntegrationContract.state !== "blocked",
      commandIds: [providerIntegrationContract.command?.id].filter(Boolean),
    },
    {
      key: "provider-client-handoff",
      source: "provider-client-handoff",
      state: providerClientHandoff.ready === true
        ? "ready"
        : providerClientHandoff.state === "review" || providerClientHandoff.state === "scheduled"
          ? "review"
          : "blocked",
      severity: providerClientHandoff.ready === true
        ? "info"
        : providerClientHandoff.state === "review" || providerClientHandoff.state === "scheduled"
          ? "warning"
          : "error",
      operationIds: providerClientHandoff.validationSummary?.blockedOperationIds ?? [],
      message: `Provider client handoff is ${providerClientHandoff.state}.`,
      nextAction: providerClientHandoff.nextAction ?? "review-provider-client-handoff",
      restartSafe: providerClientHandoff.restartSemantics?.restartSafe !== false,
      commandIds: providerClientHandoff.command ? [providerClientHandoff.command.id] : [],
    },
    {
      key: "release-acceptance",
      source: "release-acceptance",
      state: releaseAcceptanceContract.ready === true
        ? "ready"
        : releaseAcceptanceContract.state === "review" || releaseAcceptanceContract.state === "scheduled"
          ? "review"
          : "blocked",
      severity: releaseAcceptanceContract.ready === true
        ? "info"
        : releaseAcceptanceContract.state === "review" || releaseAcceptanceContract.state === "scheduled"
          ? "warning"
          : "error",
      operationIds: releaseAcceptanceContract.clientPatch?.releaseAcceptanceBlockedOperationIds ?? [],
      message: `Release acceptance contract is ${releaseAcceptanceContract.state}.`,
      nextAction: releaseAcceptanceContract.nextAction ?? "review-release-acceptance",
      restartSafe: releaseAcceptanceContract.state !== "blocked",
      commandIds: [releaseAcceptanceContract.command?.id].filter(Boolean),
    },
    {
      key: "package-analytics",
      source: "package-analytics-export",
      state: packageAnalyticsExport.exportReady === true
        ? "ready"
        : packageAnalyticsExport.status === "review" || packageAnalyticsExport.status === "waiting"
          ? "review"
          : "blocked",
      severity: packageAnalyticsExport.exportReady === true
        ? "info"
        : packageAnalyticsExport.status === "review" || packageAnalyticsExport.status === "waiting"
          ? "warning"
          : "error",
      operationIds: packageAnalyticsExport.blockedOperationIds ?? [],
      message: `Package analytics export is ${packageAnalyticsExport.status}.`,
      nextAction: packageAnalyticsExport.nextAction ?? "review-package-analytics-export",
      restartSafe: packageAnalyticsExport.status !== "blocked",
      commandIds: packageAnalyticsExport.publishCommands?.map((command) => command.id) ?? [],
    },
  ].map((row, index) => ({
    sequence: issueRows.length + operationRows.length + index + 1,
    ...row,
  }));
  const rows = [...issueRows, ...operationRows, ...gateRows];
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const reviewRows = rows.filter((row) => row.state === "review");
  const state = blockedRows.length > 0 ? "blocked" : reviewRows.length > 0 ? "review" : "ready";
  const ledgerScope = [
    ast.id,
    syncServiceContract.id,
    previewContract.id,
    packageAnalyticsExport.id,
    state,
    rows.map((row) => `${row.source}:${row.key}:${row.state}:${row.nextAction}`).join(","),
  ];
  const command = {
    id: stableId("pkgincidentcmd", [...ledgerScope, "persist-package-operational-incidents"]),
    type: "persist-package-operational-incident-ledger",
    idempotencyKey: stableId("idem", [...ledgerScope, "persist-package-operational-incidents"]),
    statusAfterReplay: state === "ready" ? "package-operational-ready" : `package-operational-${state}`,
    writes: ["packageOperationalIncidentLedgerId", "incidentRows", "nextAction", "resumeCursor"],
    conflict: "return-existing",
  };
  return {
    protocol: "aios.mailchimp.package-operational-incident-ledger.v1",
    id: stableId("pkgincident", ledgerScope),
    product: "mailchimp",
    packageId: ast.id,
    state,
    ready: state === "ready",
    exportReady: state !== "blocked",
    visibleStatus: state === "ready"
      ? "package-operational-ready"
      : state === "review"
        ? "package-operational-review"
        : "package-operational-blocked",
    nextAction: blockedRows[0]?.nextAction ?? reviewRows[0]?.nextAction ?? "persist-package-operational-incident-ledger",
    rows,
    command,
    counters: {
      rows: rows.length,
      blocked: blockedRows.length,
      review: reviewRows.length,
      ready: rows.filter((row) => row.state === "ready").length,
      manifestIssues: issueRows.length,
      operationRows: operationRows.length,
      gateRows: gateRows.length,
      restartUnsafeRows: rows.filter((row) => row.restartSafe === false).length,
    },
    actionableErrors: rows
      .filter((row) => row.state !== "ready")
      .map((row) => ({
        code: `${row.source}.${row.key}.${row.state}`,
        severity: row.severity,
        message: row.message,
        nextAction: row.nextAction,
        operationIds: row.operationIds ?? [],
      })),
    retryPolicy: {
      retryable: state !== "blocked" || blockedRows.every((row) => row.restartSafe),
      maxAttempts: state === "ready" ? 0 : 3,
      backoffScheduleMs: state === "blocked" ? [1000, 2000, 4000] : [250, 500, 1000],
      stopWhen: state === "blocked" ? "blocking-package-incidents-repaired" : "package-incident-ledger-persisted",
    },
    clientPatch: {
      packageOperationalIncidentLedgerId: stableId("pkgincidentpatch", [ast.id, state]),
      packageOperationalIncidentState: state,
      packageOperationalIncidentReady: state === "ready",
      packageOperationalIncidentNextAction: blockedRows[0]?.nextAction ?? reviewRows[0]?.nextAction ?? "persist-package-operational-incident-ledger",
      packageOperationalBlockedKeys: blockedRows.map((row) => row.key),
      packageOperationalReviewKeys: reviewRows.map((row) => row.key),
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && rows.every((row) => row.restartSafe !== false),
      replayCursor: stableId("pkgincidentcursor", ledgerScope),
      onRestart: state === "ready" ? "load-package-operational-incident-ledger" : "rebuild-package-operational-incident-ledger",
      onDuplicateCommand: "return-existing-package-operational-incident-ledger",
      externalWritesPerformed: false,
    },
  };
}

function buildPackageOperationalHealthExport(
  ast,
  compiledOperations,
  operationalIncidentLedger,
  packageAnalyticsExport,
  providerReadinessExport,
) {
  const incidentRows = operationalIncidentLedger.rows ?? [];
  const analyticsRows = packageAnalyticsExport.timelineFeed?.rows
    ?? packageAnalyticsExport.packageTimelineFeed?.rows
    ?? [];
  const blockedIncidentRows = incidentRows.filter((row) => row.state === "blocked");
  const reviewIncidentRows = incidentRows.filter((row) => row.state === "review");
  const blockedOperations = new Set(blockedIncidentRows.flatMap((row) => row.operationIds ?? []));
  const reviewOperations = new Set(reviewIncidentRows.flatMap((row) => row.operationIds ?? []));
  const operationRows = compiledOperations.map((operation, index) => {
    const operationBlocked = blockedOperations.has(operation.id);
    const operationReview = reviewOperations.has(operation.id);
    const analyticsRow = analyticsRows.find((row) => row.operationId === operation.id) ?? null;
    const state = operationBlocked
      ? "blocked"
      : operationReview
        ? "review"
        : analyticsRow?.state === "blocked"
          ? "blocked"
          : analyticsRow?.state === "review" || analyticsRow?.state === "waiting"
            ? "review"
            : "ready";
    return {
      sequence: index + 1,
      operationId: operation.id,
      operation: operation.operation,
      state,
      checkpointKey: operation.stateContract?.checkpointKey ?? null,
      commandLedgerKey: operation.stateContract?.commandState?.ledgerKey ?? null,
      adapterStatusLedgerId: operation.stateContract?.statusLedger?.id ?? null,
      analyticsRowId: analyticsRow?.rowId ?? analyticsRow?.id ?? null,
      incidentKeys: incidentRows
        .filter((row) => (row.operationIds ?? []).includes(operation.id) && row.state !== "ready")
        .map((row) => row.key)
        .sort(),
      nextAction: state === "blocked"
        ? "repair-package-operational-health"
        : state === "review"
          ? "review-package-operational-health"
          : "publish-package-operational-health",
      restartSafe: state !== "blocked" && operation.stateContract?.restartSafe !== false,
    };
  });
  const blockedRows = operationRows.filter((row) => row.state === "blocked");
  const reviewRows = operationRows.filter((row) => row.state === "review");
  const providerState = providerReadinessExport.state ?? providerReadinessExport.status ?? "unknown";
  const providerBlocked = ["blocked", "unhealthy"].includes(providerState);
  const providerReview = ["review", "waiting", "degraded"].includes(providerState);
  const state = blockedRows.length > 0 || providerBlocked || operationalIncidentLedger.state === "blocked"
    ? "blocked"
    : reviewRows.length > 0 || providerReview || operationalIncidentLedger.state === "review"
      ? "review"
      : "ready";
  const scope = [
    ast.id,
    operationalIncidentLedger.id,
    packageAnalyticsExport.id,
    providerReadinessExport.id,
    state,
    operationRows.map((row) => `${row.operationId}:${row.state}:${row.nextAction}`).join(","),
  ];
  const exportId = stableId("pkgopsexport", scope);
  const publishCommands = [
    {
      id: stableId("pkgopsexportcmd", [exportId, "persist-package-operational-health-export"]),
      type: "persist-package-operational-health-export",
      idempotencyKey: stableId("idem", [exportId, "persist-package-operational-health-export"]),
      statusAfterReplay: state === "ready" ? "package-operational-health-export-ready" : `package-operational-health-export-${state}`,
      writes: ["packageOperationalHealthExportId", "operationRows", "incidentLedgerId", "exportState"],
      conflict: "return-existing",
    },
    ...(state === "blocked" ? [{
      id: stableId("pkgopsexportcmd", [exportId, "hold-package-operational-health-export"]),
      type: "hold-package-operational-health-export",
      idempotencyKey: stableId("idem", [exportId, "hold-package-operational-health-export"]),
      statusAfterReplay: "blocked",
      writes: ["blockedOperationIds", "blockedIncidentKeys", "nextAction"],
      conflict: "return-existing",
    }] : []),
  ];
  const blockedIncidentKeys = blockedIncidentRows.map((row) => row.key).sort();
  const reviewIncidentKeys = reviewIncidentRows.map((row) => row.key).sort();
  return {
    protocol: "aios.mailchimp.package-operational-health-export.v1",
    id: exportId,
    product: "mailchimp",
    packageId: ast.id,
    state,
    ready: state === "ready",
    exportReady: state !== "blocked",
    visibleStatus: state === "ready"
      ? "package-operational-health-export-ready"
      : state === "review"
        ? "package-operational-health-export-review"
        : "package-operational-health-export-blocked",
    nextAction: state === "blocked"
      ? "repair-package-operational-health"
      : state === "review"
        ? "review-package-operational-health-export"
        : "publish-package-operational-health-export",
    incidentLedgerId: operationalIncidentLedger.id,
    analyticsExportId: packageAnalyticsExport.id,
    providerReadinessExportId: providerReadinessExport.id ?? null,
    operationRows,
    blockedOperationIds: blockedRows.map((row) => row.operationId),
    reviewOperationIds: reviewRows.map((row) => row.operationId),
    blockedIncidentKeys,
    reviewIncidentKeys,
    publishCommands,
    counters: {
      operations: operationRows.length,
      readyOperations: operationRows.filter((row) => row.state === "ready").length,
      blockedOperations: blockedRows.length,
      reviewOperations: reviewRows.length,
      incidentRows: incidentRows.length,
      blockedIncidents: blockedIncidentRows.length,
      reviewIncidents: reviewIncidentRows.length,
      publishCommands: publishCommands.length,
    },
    retryPolicy: {
      retryable: state !== "blocked" || operationalIncidentLedger.retryPolicy?.retryable === true,
      maxAttempts: state === "ready" ? 0 : 3,
      backoffScheduleMs: state === "blocked" ? [1000, 3000, 9000] : [250, 750, 1500],
      stopWhen: state === "blocked"
        ? "package-operational-blockers-repaired"
        : "package-operational-health-export-published",
    },
    exportSummary: {
      format: "aios.mailchimp.package-operational-health-export.v1",
      packageId: ast.id,
      state,
      exportReady: state !== "blocked",
      nextAction: state === "blocked"
        ? "repair-package-operational-health"
        : state === "review"
          ? "review-package-operational-health-export"
          : "publish-package-operational-health-export",
      incidentLedgerId: operationalIncidentLedger.id,
      blockedOperationIds: blockedRows.map((row) => row.operationId),
      reviewOperationIds: reviewRows.map((row) => row.operationId),
      blockedIncidentKeys,
      reviewIncidentKeys,
      commandIds: publishCommands.map((command) => command.id),
    },
    clientPatch: {
      packageOperationalHealthExportId: exportId,
      packageOperationalHealthExportState: state,
      packageOperationalHealthExportReady: state !== "blocked",
      packageOperationalHealthExportNextAction: state === "blocked"
        ? "repair-package-operational-health"
        : state === "review"
          ? "review-package-operational-health-export"
          : "publish-package-operational-health-export",
      packageOperationalHealthBlockedOperations: blockedRows.map((row) => row.operationId),
      packageOperationalHealthReviewOperations: reviewRows.map((row) => row.operationId),
      packageOperationalHealthBlockedKeys: blockedIncidentKeys,
      packageOperationalHealthReviewKeys: reviewIncidentKeys,
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && operationRows.every((row) => row.restartSafe !== false),
      replayCursor: stableId("pkgopsexportcursor", [exportId, publishCommands.map((command) => command.id).join(",")]),
      onRestart: state === "ready" ? "load-package-operational-health-export" : "rebuild-package-operational-health-export",
      onDuplicateCommand: "return-existing-package-operational-health-export",
      externalWritesPerformed: false,
    },
  };
}

function handoffBlockerAction(reason) {
  if (String(reason).startsWith("missing-status-command")) return "repair-adapter-status-contracts";
  if (String(reason).startsWith("missing-idempotency-key")) return "declare-operation-idempotency";
  if (String(reason).startsWith("provider-integration")) return "repair-provider-integration-contract";
  if (String(reason).startsWith("lifecycle-disabled")) return "enable-package-lifecycle";
  if (String(reason).startsWith("lifecycle-")) return "repair-lifecycle-release-gate";
  if (String(reason).startsWith("package-preview")) return "repair-package-preview";
  return "review-client-handoff";
}

function buildRuntimeBoundaryReleasePacket(
  ast,
  compiledOperations,
  lifecycleControls,
  syncServiceContract,
  providerClientHandoff,
  releaseAcceptanceContract,
  operatorReleaseChecklist,
) {
  const releaseGate = lifecycleControls.releaseGate ?? {};
  const writeLikeOperations = compiledOperations.filter((operation) => (
    operation.capabilityNames.some((capability) => (
      capability.endsWith(".write") || capability.endsWith(".send") || capability.includes("segment.write")
    ))
  ));
  const missingStatusOperations = compiledOperations.filter((operation) => (
    !operation.stateContract?.commandState?.commands?.some((command) => command.type === "adapter-status-probe")
  ));
  const restartUnsafeOperations = compiledOperations.filter((operation) => operation.stateContract?.restartSafe === false);
  const acceptanceReady = releaseAcceptanceContract.ready === true;
  const checklistReady = operatorReleaseChecklist.ready === true;
  const handoffReady = providerClientHandoff.ready === true;
  const releaseGateReady = releaseGate.releaseAllowed === true || releaseGate.state === "review";
  const scheduleWaiting = releaseGate.state === "scheduled" || releaseAcceptanceContract.state === "scheduled";
  const boundaryRows = [
    {
      key: "lifecycle-release-gate",
      state: releaseGate.state === "blocked" || releaseGate.state === "disabled"
        ? "blocked"
        : releaseGate.state === "scheduled"
          ? "waiting"
          : releaseGateReady
            ? "ready"
            : "review",
      sourceId: releaseGate.id ?? lifecycleControls.stateId,
      nextAction: releaseGate.nextAction ?? lifecycleControls.nextAction?.action ?? "prepare-manual-release",
      commandId: releaseGate.releaseCommandId ?? lifecycleControls.nextAction?.commandId ?? null,
    },
    {
      key: "provider-client-handoff",
      state: providerClientHandoff.state === "blocked"
        ? "blocked"
        : providerClientHandoff.state === "scheduled"
          ? "waiting"
          : handoffReady
            ? "ready"
            : "review",
      sourceId: providerClientHandoff.id,
      nextAction: providerClientHandoff.nextAction,
      commandId: providerClientHandoff.operationRows?.find((row) => row.handoffCommandId)?.handoffCommandId ?? null,
    },
    {
      key: "release-acceptance",
      state: releaseAcceptanceContract.state === "blocked" || releaseAcceptanceContract.state === "disabled"
        ? "blocked"
        : releaseAcceptanceContract.state === "scheduled"
          ? "waiting"
          : acceptanceReady
            ? "ready"
            : "review",
      sourceId: releaseAcceptanceContract.id,
      nextAction: releaseAcceptanceContract.nextAction,
      commandId: releaseAcceptanceContract.command?.id ?? null,
    },
    {
      key: "operator-release-checklist",
      state: operatorReleaseChecklist.state === "blocked"
        ? "blocked"
        : operatorReleaseChecklist.state === "waiting"
          ? "waiting"
          : checklistReady
            ? "ready"
            : "review",
      sourceId: operatorReleaseChecklist.id,
      nextAction: operatorReleaseChecklist.nextAction,
      commandId: operatorReleaseChecklist.command?.id ?? null,
    },
    {
      key: "operation-boundaries",
      state: missingStatusOperations.length > 0 || restartUnsafeOperations.length > 0 ? "blocked" : "ready",
      sourceId: stableId("opbounds", [ast.id, compiledOperations.map((operation) => operation.id).join(",")]),
      nextAction: missingStatusOperations.length > 0
        ? "repair-adapter-status-contracts"
        : restartUnsafeOperations.length > 0
          ? "repair-state-contracts"
          : "persist-operation-boundary-ledger",
      commandId: compiledOperations
        .flatMap((operation) => operation.stateContract?.commandState?.commands ?? [])
        .find((command) => command.type === "adapter-status-probe")?.id ?? null,
    },
  ];
  const blockedRows = boundaryRows.filter((row) => row.state === "blocked");
  const waitingRows = boundaryRows.filter((row) => row.state === "waiting");
  const reviewRows = boundaryRows.filter((row) => row.state === "review");
  const state = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0 || scheduleWaiting
      ? "waiting"
      : reviewRows.length > 0
        ? "review"
        : "ready";
  const packetScope = [
    ast.id,
    lifecycleControls.stateId,
    syncServiceContract.id,
    providerClientHandoff.id,
    releaseAcceptanceContract.id,
    operatorReleaseChecklist.id,
    state,
  ];
  const command = {
    id: stableId("boundarycmd", [...packetScope, "persist-runtime-boundary-release"]),
    type: "persist-runtime-boundary-release",
    idempotencyKey: stableId("idem", [...packetScope, "persist-runtime-boundary-release"]),
    statusAfterReplay: state === "ready" ? "runtime-boundary-ready" : `runtime-boundary-${state}`,
    writes: ["runtimeBoundaryReleaseId", "boundaryRows", "operationSets", "nextAction"],
    conflict: "return-existing",
  };
  return {
    id: stableId("runtimeboundary", [
      ...packetScope,
      boundaryRows.map((row) => `${row.key}:${row.state}`).join(","),
    ]),
    product: "mailchimp",
    contractVersion: "aios.mailchimp.runtime-boundary-release.v1",
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "runtime-boundary-ready"
      : state === "waiting"
        ? "runtime-boundary-waiting"
        : state === "review"
          ? "runtime-boundary-review"
          : "runtime-boundary-blocked",
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? reviewRows[0]?.nextAction
      ?? "persist-runtime-boundary-release",
    rows: boundaryRows,
    command,
    operationSets: {
      allOperationIds: compiledOperations.map((operation) => operation.id),
      writeLikeOperationIds: writeLikeOperations.map((operation) => operation.id),
      missingStatusOperationIds: missingStatusOperations.map((operation) => operation.id),
      restartUnsafeOperationIds: restartUnsafeOperations.map((operation) => operation.id),
    },
    requiredInputNames: [
      "runtimeBoundaryReleaseId",
      "providerClientHandoffId",
      "releaseAcceptanceId",
      "operatorReleaseChecklistId",
    ],
    counters: {
      rows: boundaryRows.length,
      ready: boundaryRows.filter((row) => row.state === "ready").length,
      blocked: blockedRows.length,
      waiting: waitingRows.length,
      review: reviewRows.length,
      writeLikeOperations: writeLikeOperations.length,
      missingStatusOperations: missingStatusOperations.length,
      restartUnsafeOperations: restartUnsafeOperations.length,
    },
  };
}

function buildPackageAnalyticsExportContract(
  ast,
  compiledOperations,
  lifecycleControls,
  syncServiceContract,
  previewContract,
  providerClientHandoff,
  releaseAcceptanceContract,
  operatorReleaseChecklist,
  runtimeBoundaryRelease,
  issues,
) {
  const issueCounts = summarizeIssueCounts(issues);
  const releaseGate = lifecycleControls.releaseGate ?? {};
  const operationRows = compiledOperations.map((operation, index) => {
    const commandState = operation.stateContract?.commandState ?? {};
    const adapterStatus = operation.stateContract?.adapterStatus ?? {};
    const statusLedger = operation.stateContract?.statusLedger ?? {};
    const writeLike = operation.capabilityNames.some((capability) => (
      capability.endsWith(".write") || capability.endsWith(".send") || capability.includes("segment.write")
    ));
    const requiredProviderCapabilities = syncServiceContract.requiredProviderCapabilities ?? [];
    const matchedProviderCapabilities = operation.capabilityNames.filter((capability) => (
      requiredProviderCapabilities.includes(capability)
    ));
    const state = operation.stateContract?.restartSafe === false
      ? "blocked"
      : !commandState.commands?.some((command) => command.type === "adapter-status-probe")
        ? "blocked"
        : operation.stateContract?.idempotency?.mode === "none"
          ? "review"
          : "ready";
    return {
      sequence: index + 1,
      operationId: operation.id,
      descriptorId: operation.descriptorId,
      operation: operation.operation,
      adapter: operation.adapter,
      state,
      writeLike,
      capabilityCount: operation.capabilityNames.length,
      verifierCount: operation.verifierNames.length,
      matchedProviderCapabilities,
      checkpointKey: operation.stateContract?.checkpointKey ?? null,
      commandLedgerKey: commandState.ledgerKey ?? null,
      commandCount: commandState.commands?.length ?? 0,
      adapterStatusContractId: adapterStatus.id ?? null,
      adapterStatusProbe: adapterStatus.probe ?? null,
      terminalStatuses: adapterStatus.expected?.terminal ?? [],
      statusLedgerId: statusLedger.id ?? null,
      restartSafe: operation.stateContract?.restartSafe !== false,
      nextAction: state === "blocked"
        ? "repair-operation-runtime-contract"
        : state === "review"
          ? "review-operation-idempotency"
          : "include-operation-in-package-export",
    };
  });
  const blockedRows = operationRows.filter((row) => row.state === "blocked");
  const reviewRows = operationRows.filter((row) => row.state === "review");
  const releaseBlocked = runtimeBoundaryRelease.state === "blocked"
    || releaseGate.state === "blocked"
    || releaseGate.state === "disabled";
  const releaseWaiting = runtimeBoundaryRelease.state === "waiting"
    || releaseGate.state === "scheduled"
    || releaseAcceptanceContract.state === "scheduled";
  const exportStatus = releaseBlocked || blockedRows.length > 0 || (issueCounts.error ?? 0) > 0
    ? "blocked"
    : releaseWaiting
      ? "waiting"
      : reviewRows.length > 0 || previewContract.status === "review" || operatorReleaseChecklist.state === "review"
        ? "review"
        : "ready";
  const exportScope = [
    ast.id,
    syncServiceContract.id,
    lifecycleControls.stateId,
    previewContract.id,
    runtimeBoundaryRelease.id,
    exportStatus,
  ];
  const counters = {
    operations: operationRows.length,
    readyOperations: operationRows.filter((row) => row.state === "ready").length,
    reviewOperations: reviewRows.length,
    blockedOperations: blockedRows.length,
    writeLikeOperations: operationRows.filter((row) => row.writeLike).length,
    capabilities: [...new Set(compiledOperations.flatMap((operation) => operation.capabilityNames))].length,
    providerCapabilities: syncServiceContract.requiredProviderCapabilities?.length ?? 0,
    verifiers: [...new Set(compiledOperations.flatMap((operation) => operation.verifierNames))].length,
    commandLedgers: operationRows.filter((row) => row.commandLedgerKey).length,
    adapterStatusContracts: operationRows.filter((row) => row.adapterStatusContractId).length,
    restartSafeOperations: operationRows.filter((row) => row.restartSafe).length,
    issues: issues.length,
    issueErrors: issueCounts.error ?? 0,
    issueWarnings: issueCounts.warning ?? 0,
    lifecycleCommands: lifecycleControls.commands?.length ?? 0,
    operatorChecklistChecks: operatorReleaseChecklist.checks?.length ?? 0,
    runtimeBoundaryRows: runtimeBoundaryRelease.rows?.length ?? 0,
  };
  const history = [
    {
      id: stableId("pkghist", [...exportScope, "manifest-compiled"]),
      sequence: 1,
      type: "package-manifest-compiled",
      status: issues.some((issue) => issue.severity === "error") ? "blocked" : "compiled",
      packageId: ast.id,
      operationCount: operationRows.length,
      issueCount: issues.length,
    },
    {
      id: stableId("pkghist", [...exportScope, "sync-service"]),
      sequence: 2,
      type: "sync-service-contract-built",
      status: syncServiceContract.externalHandoff?.state ?? "unknown",
      syncContractId: syncServiceContract.id,
      provider: syncServiceContract.provider,
      requiredFacts: syncServiceContract.requiredFacts,
      requiredProviderCapabilities: syncServiceContract.requiredProviderCapabilities,
      nextAction: syncServiceContract.externalHandoff?.nextAction ?? "negotiate-provider-capabilities",
    },
    {
      id: stableId("pkghist", [...exportScope, "preview"]),
      sequence: 3,
      type: "package-preview-evaluated",
      status: previewContract.status,
      previewId: previewContract.id,
      nextAction: previewContract.nextAction,
      requiredInputNames: previewContract.acceptance?.requiredInputs
        ?.filter((input) => input.required)
        .map((input) => input.name) ?? [],
    },
    {
      id: stableId("pkghist", [...exportScope, "runtime-boundary"]),
      sequence: 4,
      type: "runtime-boundary-release-evaluated",
      status: runtimeBoundaryRelease.state,
      runtimeBoundaryReleaseId: runtimeBoundaryRelease.id,
      nextAction: runtimeBoundaryRelease.nextAction,
      blockedKeys: runtimeBoundaryRelease.rows
        ?.filter((row) => row.state === "blocked")
        .map((row) => row.key) ?? [],
    },
  ];
  const timeline = [
    {
      sequence: 1,
      phase: "compile",
      event: "manifest-operations-normalized",
      status: issues.some((issue) => issue.severity === "error") ? "blocked" : "ready",
      nextAction: issues.some((issue) => issue.severity === "error") ? "repair-manifest-errors" : "build-sync-contract",
    },
    {
      sequence: 2,
      phase: "sync",
      event: "mailchimp-sync-contract-evaluated",
      status: syncServiceContract.externalHandoff?.state ?? "ready-for-negotiation",
      nextAction: syncServiceContract.externalHandoff?.nextAction ?? "negotiate-provider-capabilities",
    },
    {
      sequence: 3,
      phase: "lifecycle",
      event: "lifecycle-release-gate-evaluated",
      status: releaseGate.state ?? "unknown",
      nextAction: releaseGate.nextAction ?? lifecycleControls.nextAction?.action ?? "prepare-manual-release",
    },
    {
      sequence: 4,
      phase: "client-handoff",
      event: "provider-client-handoff-evaluated",
      status: providerClientHandoff.state,
      nextAction: providerClientHandoff.nextAction,
    },
    {
      sequence: 5,
      phase: "export",
      event: "package-analytics-export-evaluated",
      status: exportStatus,
      nextAction: exportStatus === "ready" ? "publish-package-analytics-export" : "review-package-analytics-export",
    },
  ];
  const exportReady = exportStatus === "ready";
  const timelineFeed = buildPackageAnalyticsTimelineFeed({
    ast,
    operationRows,
    lifecycleControls,
    syncServiceContract,
    previewContract,
    providerClientHandoff,
    releaseAcceptanceContract,
    operatorReleaseChecklist,
    runtimeBoundaryRelease,
    counters,
    history,
    timeline,
    exportStatus,
    exportReady,
  });
  const adoptionGate = buildPackageAnalyticsAdoptionGate({
    ast,
    lifecycleControls,
    syncServiceContract,
    previewContract,
    runtimeBoundaryRelease,
    operationRows,
    counters,
    exportStatus,
    exportReady,
    timelineFeed,
  });
  const exportLedger = buildPackageAnalyticsExportLedger({
    ast,
    operationRows,
    lifecycleControls,
    syncServiceContract,
    previewContract,
    runtimeBoundaryRelease,
    timelineFeed,
    adoptionGate,
    counters,
    exportStatus,
    exportReady,
  });
  return {
    id: stableId("pkganalytics", [
      ...exportScope,
      operationRows.map((row) => `${row.operationId}:${row.state}`).join(","),
    ]),
    product: "mailchimp",
    protocol: "aios.mailchimp.package-analytics-export.v1",
    status: exportStatus,
    exportReady,
    nextAction: exportReady
      ? "publish-package-analytics-export"
      : blockedRows[0]?.nextAction
        ?? runtimeBoundaryRelease.nextAction
        ?? previewContract.nextAction
        ?? "review-package-analytics-export",
    counters,
    issueCounts,
    operationRows,
    history,
    timeline,
    timelineFeed,
    packageTimelineFeed: timelineFeed,
    adoptionGate,
    packageAnalyticsAdoptionGate: adoptionGate,
    exportLedger,
    packageAnalyticsExportLedger: exportLedger,
    publishCommands: exportLedger.commands,
    blockedOperationIds: blockedRows.map((row) => row.operationId),
    reviewOperationIds: reviewRows.map((row) => row.operationId),
    exportSummary: {
      format: "aios.mailchimp.package-analytics-summary.v1",
      packageId: ast.id,
      status: exportStatus,
      exportReady,
      nextAction: exportReady ? "publish-package-analytics-export" : "review-package-analytics-export",
      syncContractId: syncServiceContract.id,
      previewId: previewContract.id,
      runtimeBoundaryReleaseId: runtimeBoundaryRelease.id,
      historySnapshotIds: history.map((entry) => entry.id),
      timelineEventIds: timeline.map((entry) => `${ast.id}:${entry.sequence}:${entry.phase}`),
      timelineFeedId: timelineFeed.id,
      timelineFeedState: timelineFeed.state,
      timelineFeedReady: timelineFeed.exportReady,
      timelineFeedSnapshotId: timelineFeed.latestSnapshotId,
      timelineFeedBlockedKeys: timelineFeed.blockedKeys,
      timelineFeedWaitingKeys: timelineFeed.waitingKeys,
      adoptionGateId: adoptionGate.id,
      adoptionGateState: adoptionGate.state,
      adoptionGateReady: adoptionGate.ready,
      adoptionGateNextAction: adoptionGate.nextAction,
      adoptionGateBlockedKeys: adoptionGate.blockedKeys,
      adoptionGateWaitingKeys: adoptionGate.waitingKeys,
      adoptionCommandId: adoptionGate.command.id,
      exportLedgerId: exportLedger.id,
      exportLedgerState: exportLedger.state,
      exportLedgerReady: exportLedger.exportReady,
      exportLedgerNextAction: exportLedger.nextAction,
      exportLedgerBlockedKeys: exportLedger.blockedKeys,
      exportLedgerWaitingKeys: exportLedger.waitingKeys,
      publishCommandIds: exportLedger.commands.map((command) => command.id),
      blockedOperationIds: blockedRows.map((row) => row.operationId),
      reviewOperationIds: reviewRows.map((row) => row.operationId),
    },
    clientPatch: {
      packageAnalyticsExportId: stableId("pkganalyticspatch", [ast.id, exportStatus]),
      packageAnalyticsStatus: exportStatus,
      packageAnalyticsExportReady: exportReady,
      packageAnalyticsNextAction: exportReady ? "publish-package-analytics-export" : "review-package-analytics-export",
      packageAnalyticsBlockedOperations: blockedRows.map((row) => row.operationId),
      packageAnalyticsReviewOperations: reviewRows.map((row) => row.operationId),
      packageAnalyticsTimelineFeedId: timelineFeed.id,
      packageAnalyticsTimelineFeedState: timelineFeed.state,
      packageAnalyticsTimelineFeedReady: timelineFeed.exportReady,
      packageAnalyticsTimelineNextAction: timelineFeed.nextAction,
      packageAnalyticsTimelineBlockedKeys: timelineFeed.blockedKeys,
      packageAnalyticsTimelineWaitingKeys: timelineFeed.waitingKeys,
      packageAnalyticsAdoptionGateId: adoptionGate.id,
      packageAnalyticsAdoptionState: adoptionGate.state,
      packageAnalyticsAdoptionReady: adoptionGate.ready,
      packageAnalyticsAdoptionNextAction: adoptionGate.nextAction,
      packageAnalyticsAdoptionBlockedKeys: adoptionGate.blockedKeys,
      packageAnalyticsAdoptionWaitingKeys: adoptionGate.waitingKeys,
      packageAnalyticsAdoptionCommandId: adoptionGate.command.id,
      packageAnalyticsExportLedgerId: exportLedger.id,
      packageAnalyticsExportLedgerState: exportLedger.state,
      packageAnalyticsExportLedgerReady: exportLedger.exportReady,
      packageAnalyticsPublishCommandIds: exportLedger.commands.map((command) => command.id),
    },
  };
}

function buildPackageAnalyticsExportLedger({
  ast,
  operationRows,
  lifecycleControls,
  syncServiceContract,
  previewContract,
  runtimeBoundaryRelease,
  timelineFeed,
  adoptionGate,
  counters,
  exportStatus,
  exportReady,
}) {
  const releaseGate = lifecycleControls.releaseGate ?? {};
  const sources = [
    {
      key: "analytics-summary",
      state: exportReady ? "ready" : exportStatus === "blocked" ? "blocked" : "waiting",
      sourceId: ast.id,
      nextAction: exportReady ? "publish-package-analytics-summary" : "review-package-analytics-export",
      blockers: operationRows.filter((row) => row.state === "blocked").map((row) => row.operationId),
      waiting: operationRows.filter((row) => row.state === "review").map((row) => row.operationId),
      restartSafe: exportStatus !== "blocked",
    },
    {
      key: "timeline-feed",
      state: timelineFeed.exportReady === true
        ? "ready"
        : timelineFeed.state === "blocked"
          ? "blocked"
          : "waiting",
      sourceId: timelineFeed.id,
      nextAction: timelineFeed.nextAction ?? "review-package-timeline-feed",
      blockers: timelineFeed.blockedKeys ?? [],
      waiting: timelineFeed.waitingKeys ?? [],
      restartSafe: timelineFeed.restartSemantics?.restartSafe !== false,
    },
    {
      key: "analytics-adoption",
      state: adoptionGate.ready === true
        ? "ready"
        : adoptionGate.state === "blocked"
          ? "blocked"
          : "waiting",
      sourceId: adoptionGate.id,
      nextAction: adoptionGate.nextAction ?? "review-package-analytics-adoption",
      blockers: adoptionGate.blockedKeys ?? [],
      waiting: adoptionGate.waitingKeys ?? [],
      restartSafe: adoptionGate.restartSemantics?.restartSafe !== false,
    },
    {
      key: "runtime-boundary",
      state: runtimeBoundaryRelease.state === "ready"
        ? "ready"
        : runtimeBoundaryRelease.state === "blocked"
          ? "blocked"
          : "waiting",
      sourceId: runtimeBoundaryRelease.id,
      nextAction: runtimeBoundaryRelease.nextAction ?? "review-runtime-boundary-release",
      blockers: runtimeBoundaryRelease.rows?.filter((row) => row.state === "blocked").map((row) => row.key) ?? [],
      waiting: runtimeBoundaryRelease.rows?.filter((row) => row.state === "waiting").map((row) => row.key) ?? [],
      restartSafe: runtimeBoundaryRelease.restartSemantics?.restartSafe !== false,
    },
    {
      key: "preview-contract",
      state: previewContract.status === "ready"
        ? "ready"
        : previewContract.status === "blocked"
          ? "blocked"
          : "waiting",
      sourceId: previewContract.id,
      nextAction: previewContract.nextAction ?? "review-package-preview",
      blockers: previewContract.acceptance?.requiredInputs
        ?.filter((input) => input.required && input.value == null)
        .map((input) => input.name) ?? [],
      waiting: previewContract.status === "review" ? ["operator-preview-review"] : [],
      restartSafe: previewContract.status !== "blocked",
    },
    {
      key: "sync-service",
      state: syncServiceContract.externalHandoff?.state === "disabled"
        ? "blocked"
        : syncServiceContract.externalHandoff?.state === "scheduled"
          ? "waiting"
          : "ready",
      sourceId: syncServiceContract.id,
      nextAction: syncServiceContract.externalHandoff?.nextAction ?? "negotiate-provider-capabilities",
      blockers: syncServiceContract.externalHandoff?.state === "disabled" ? ["sync-service-disabled"] : [],
      waiting: syncServiceContract.externalHandoff?.state === "scheduled" ? ["sync-service-scheduled"] : [],
      restartSafe: syncServiceContract.externalHandoff?.state !== "disabled",
    },
    {
      key: "lifecycle-release",
      state: releaseGate.releaseAllowed === true || releaseGate.state === "ready"
        ? "ready"
        : ["blocked", "disabled"].includes(releaseGate.state)
          ? "blocked"
          : "waiting",
      sourceId: releaseGate.id ?? lifecycleControls.stateId ?? null,
      nextAction: releaseGate.nextAction ?? lifecycleControls.nextAction?.action ?? "prepare-package-release",
      blockers: releaseGate.state === "blocked" ? ["lifecycle-release-blocked"] : [],
      waiting: releaseGate.state === "scheduled" ? ["lifecycle-release-scheduled"] : [],
      restartSafe: releaseGate.state !== "blocked",
    },
  ];
  const rows = sources.map((row, index) => ({
    sequence: index + 1,
    rowId: stableId("pkganalyticsrow", [
      ast.id,
      row.key,
      row.state,
      row.sourceId,
      row.blockers.join(","),
      row.waiting.join(","),
    ]),
    ...row,
  }));
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => row.state === "waiting");
  const readyRows = rows.filter((row) => row.state === "ready");
  const state = blockedRows.length > 0 ? "blocked" : waitingRows.length > 0 ? "waiting" : "ready";
  const ledgerId = stableId("pkganalyticsledger", [
    ast.id,
    state,
    timelineFeed.id,
    adoptionGate.id,
    rows.map((row) => `${row.key}:${row.state}:${row.sourceId}`).join(","),
  ]);
  const commands = [
    {
      id: stableId("cmd", [ledgerId, "persist-package-analytics-export-ledger"]),
      type: "persist-package-analytics-export-ledger",
      idempotencyKey: stableId("idem", [ledgerId, "persist-package-analytics-export-ledger"]),
      statusAfterReplay: state === "ready" ? "package-analytics-export-ledger-ready" : `package-analytics-export-ledger-${state}`,
      writes: ["packageAnalyticsLedgerRows", "publishReadiness", "blockedKeys", "waitingKeys"],
      conflict: "return-existing",
    },
    ...(state === "ready" ? [{
      id: stableId("cmd", [ledgerId, "publish-package-analytics-export"]),
      type: "publish-package-analytics-export",
      idempotencyKey: stableId("idem", [ledgerId, "publish-package-analytics-export"]),
      statusAfterReplay: "package-analytics-export-published",
      writes: ["packageAnalyticsSummary", "timelineFeed", "adoptionGate", "operationCounters"],
      conflict: "return-existing",
    }] : []),
  ];
  return {
    protocol: "aios.mailchimp.package-analytics-export-ledger.v1",
    id: ledgerId,
    product: "mailchimp",
    packageId: ast.id,
    state,
    exportReady: state === "ready",
    visibleStatus: state === "ready"
      ? "package-analytics-export-ready"
      : state === "waiting"
        ? "package-analytics-export-waiting"
        : "package-analytics-export-blocked",
    nextAction: blockedRows[0]?.nextAction ?? waitingRows[0]?.nextAction ?? "publish-package-analytics-export",
    rows,
    blockedKeys: [...new Set(blockedRows.map((row) => row.key))].sort(),
    waitingKeys: [...new Set(waitingRows.map((row) => row.key))].sort(),
    sourceIds: {
      timelineFeedId: timelineFeed.id,
      adoptionGateId: adoptionGate.id,
      runtimeBoundaryReleaseId: runtimeBoundaryRelease.id,
      syncServiceContractId: syncServiceContract.id,
    },
    counters: {
      rows: rows.length,
      readyRows: readyRows.length,
      waitingRows: waitingRows.length,
      blockedRows: blockedRows.length,
      operations: counters.operations,
      blockedOperations: counters.blockedOperations,
      reviewOperations: counters.reviewOperations,
      timelineFeedRows: timelineFeed.counters?.feedRows ?? 0,
      adoptionRows: adoptionGate.counters?.rows ?? 0,
      publishCommands: commands.length,
    },
    commands,
    restartSemantics: {
      restartSafe: state !== "blocked" && rows.every((row) => row.restartSafe),
      onRestart: state === "ready" ? "load-package-analytics-export-ledger" : "rebuild-package-analytics-export-ledger",
      onDuplicateCommand: "return-existing-package-analytics-export-ledger-command",
      onMissingState: "rebuild-package-analytics-export-ledger",
      externalWritesPerformed: false,
    },
    clientPatch: {
      packageAnalyticsExportLedgerId: ledgerId,
      packageAnalyticsExportLedgerState: state,
      packageAnalyticsExportLedgerReady: state === "ready",
      packageAnalyticsExportLedgerVisibleStatus: state === "ready"
        ? "package-analytics-export-ready"
        : state === "waiting"
          ? "package-analytics-export-waiting"
          : "package-analytics-export-blocked",
      packageAnalyticsExportLedgerNextAction: blockedRows[0]?.nextAction ?? waitingRows[0]?.nextAction ?? "publish-package-analytics-export",
      packageAnalyticsExportLedgerBlockedKeys: blockedRows.map((row) => row.key),
      packageAnalyticsExportLedgerWaitingKeys: waitingRows.map((row) => row.key),
      packageAnalyticsExportLedgerCommandIds: commands.map((command) => command.id),
    },
  };
}

function buildPackageAnalyticsTimelineFeed({
  ast,
  operationRows,
  lifecycleControls,
  syncServiceContract,
  previewContract,
  providerClientHandoff,
  releaseAcceptanceContract,
  operatorReleaseChecklist,
  runtimeBoundaryRelease,
  counters,
  history,
  timeline,
  exportStatus,
  exportReady,
}) {
  const releaseGate = lifecycleControls.releaseGate ?? {};
  const lifecycleNextAction = lifecycleControls.nextAction?.action ?? releaseGate.nextAction ?? "prepare-manual-release";
  const schedule = lifecycleControls.schedule ?? {};
  const scheduleBlocked = schedule.mode === "disabled"
    || (schedule.mode === "windowed" && (!schedule.windowStart || !schedule.windowEnd));
  const scheduleWaiting = releaseGate.state === "scheduled"
    || releaseAcceptanceContract.state === "scheduled"
    || schedule.mode === "windowed";
  const blockedOperations = operationRows.filter((row) => row.state === "blocked");
  const reviewOperations = operationRows.filter((row) => row.state === "review");
  const commandRows = (lifecycleControls.commands ?? []).map((command, index) => ({
    sequence: index + 1,
    commandId: command.id,
    commandType: command.type,
    enabled: command.enabled !== false,
    statusAfterReplay: command.statusAfterReplay ?? null,
    writes: command.writes ?? [],
  }));
  const feedRows = [
    {
      key: "manifest-analytics",
      state: exportReady ? "ready" : exportStatus,
      artifactId: ast.id,
      nextAction: exportReady ? "publish-package-analytics-export" : "review-package-analytics-export",
      blockedKeys: blockedOperations.map((row) => row.operationId),
      waitingKeys: reviewOperations.map((row) => row.operationId),
      exportReady,
      restartSafe: blockedOperations.length === 0,
    },
    {
      key: "release-schedule",
      state: scheduleBlocked ? "blocked" : scheduleWaiting ? "waiting" : "ready",
      artifactId: lifecycleControls.stateId,
      nextAction: scheduleBlocked
        ? schedule.mode === "disabled"
          ? "choose-release-schedule"
          : "declare-release-window"
        : scheduleWaiting
          ? "wait-for-release-window"
          : lifecycleNextAction,
      blockedKeys: scheduleBlocked ? ["release-schedule"] : [],
      waitingKeys: scheduleWaiting && !scheduleBlocked ? ["release-window"] : [],
      exportReady: !scheduleBlocked,
      restartSafe: lifecycleControls.concurrency?.requiresQueue !== true || lifecycleControls.enabled !== false,
    },
    {
      key: "runtime-boundary-release",
      state: runtimeBoundaryRelease.state ?? "unknown",
      artifactId: runtimeBoundaryRelease.id ?? null,
      nextAction: runtimeBoundaryRelease.nextAction ?? "review-runtime-boundary-release",
      blockedKeys: runtimeBoundaryRelease.clientPatch?.runtimeBoundaryBlockedKeys
        ?? runtimeBoundaryRelease.rows?.filter((row) => row.state === "blocked").map((row) => row.key)
        ?? [],
      waitingKeys: runtimeBoundaryRelease.clientPatch?.runtimeBoundaryWaitingKeys
        ?? runtimeBoundaryRelease.rows?.filter((row) => row.state === "waiting").map((row) => row.key)
        ?? [],
      exportReady: runtimeBoundaryRelease.ready === true,
      restartSafe: runtimeBoundaryRelease.restartSemantics?.restartSafe !== false,
    },
    {
      key: "provider-client-handoff",
      state: providerClientHandoff.state ?? "unknown",
      artifactId: providerClientHandoff.id ?? null,
      nextAction: providerClientHandoff.nextAction ?? "review-provider-client-handoff",
      blockedKeys: providerClientHandoff.clientPatch?.blockedKeys
        ?? providerClientHandoff.validationSummary?.blockedKeys
        ?? [],
      waitingKeys: providerClientHandoff.clientPatch?.waitingKeys
        ?? providerClientHandoff.validationSummary?.waitingKeys
        ?? [],
      exportReady: providerClientHandoff.ready === true,
      restartSafe: providerClientHandoff.restartSemantics?.restartSafe !== false,
    },
    {
      key: "operator-release-checklist",
      state: operatorReleaseChecklist.state ?? "unknown",
      artifactId: operatorReleaseChecklist.id ?? null,
      nextAction: operatorReleaseChecklist.nextAction ?? "review-operator-release-checklist",
      blockedKeys: operatorReleaseChecklist.clientPatch?.operatorReleaseBlockedCheckKeys ?? [],
      waitingKeys: [
        ...(operatorReleaseChecklist.clientPatch?.operatorReleaseWaitingCheckKeys ?? []),
        ...(operatorReleaseChecklist.clientPatch?.operatorReleaseReviewCheckKeys ?? []),
      ],
      exportReady: operatorReleaseChecklist.ready === true,
      restartSafe: operatorReleaseChecklist.restartSemantics?.restartSafe !== false,
    },
  ];
  const operationFeedRows = operationRows.map((row, index) => ({
    key: `operation:${row.operationId}`,
    sequence: feedRows.length + index + 1,
    state: row.state,
    artifactId: row.descriptorId,
    operationId: row.operationId,
    operation: row.operation,
    adapter: row.adapter,
    nextAction: row.nextAction,
    blockedKeys: row.state === "blocked" ? [row.operationId] : [],
    waitingKeys: row.state === "review" ? [row.operationId] : [],
    exportReady: row.state === "ready",
    restartSafe: row.restartSafe,
    commandLedgerKey: row.commandLedgerKey,
    adapterStatusContractId: row.adapterStatusContractId,
  }));
  const rows = [...feedRows, ...operationFeedRows].map((row, index) => ({
    sequence: row.sequence ?? index + 1,
    ...row,
  }));
  const blockedRows = rows.filter((row) => row.state === "blocked");
  const waitingRows = rows.filter((row) => ["waiting", "review", "scheduled"].includes(row.state));
  const readyRows = rows.filter((row) => row.state === "ready");
  const state = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : exportReady
        ? "ready"
        : "review";
  const feedId = stableId("pkgtimeline", [
    ast.id,
    lifecycleControls.stateId,
    syncServiceContract.id,
    state,
    rows.map((row) => `${row.key}:${row.state}:${row.artifactId}`).join(","),
  ]);
  const snapshots = [
    ...history.map((entry) => ({
      id: entry.id,
      source: "package-history",
      sequence: entry.sequence,
      status: entry.status,
      type: entry.type,
    })),
    {
      id: stableId("pkgtimelinesnap", [feedId, "current", state]),
      source: "package-timeline-feed",
      sequence: history.length + 1,
      status: state,
      type: "package-analytics-timeline-feed",
      counters: {
        rows: rows.length,
        blockedRows: blockedRows.length,
        waitingRows: waitingRows.length,
        readyRows: readyRows.length,
      },
    },
  ];
  const exportTimeline = [
    ...timeline.map((event) => ({
      sequence: event.sequence,
      source: "package-analytics",
      event: event.event,
      phase: event.phase,
      status: event.status,
      nextAction: event.nextAction,
    })),
    ...rows.map((row, index) => ({
      sequence: timeline.length + index + 1,
      source: "package-timeline-feed",
      event: `feed:${row.key}`,
      phase: row.key.startsWith("operation:") ? "operation" : "control",
      status: row.state,
      artifactId: row.artifactId,
      nextAction: row.nextAction,
    })),
  ];
  return {
    protocol: "aios.mailchimp.package-analytics-timeline-feed.v1",
    id: feedId,
    product: "mailchimp",
    packageId: ast.id,
    state,
    exportReady: state === "ready",
    reportingChannel: "kernel.analytics.mailchimp.package_timeline",
    latestSnapshotId: snapshots.at(-1)?.id ?? null,
    rows,
    commandRows,
    snapshots,
    timeline: exportTimeline,
    counters: {
      ...counters,
      feedRows: rows.length,
      feedBlockedRows: blockedRows.length,
      feedWaitingRows: waitingRows.length,
      feedReadyRows: readyRows.length,
      lifecycleCommandRows: commandRows.length,
    },
    scheduleState: {
      mode: schedule.mode ?? "manual",
      windowStart: schedule.windowStart ?? null,
      windowEnd: schedule.windowEnd ?? null,
      timezone: schedule.timezone ?? "UTC",
      blocked: scheduleBlocked,
      waiting: scheduleWaiting && !scheduleBlocked,
      maxScheduledJobs: schedule.maxScheduledJobs ?? null,
    },
    blockedKeys: [...new Set(blockedRows.flatMap((row) => row.blockedKeys ?? [row.key]))].sort(),
    waitingKeys: [...new Set(waitingRows.flatMap((row) => row.waitingKeys ?? [row.key]))].sort(),
    nextAction: blockedRows[0]?.nextAction
      ?? waitingRows[0]?.nextAction
      ?? (state === "ready" ? "publish-package-analytics-timeline-feed" : "review-package-analytics-timeline-feed"),
    restartSemantics: {
      restartSafe: blockedRows.length === 0 && rows.every((row) => row.restartSafe !== false),
      onRestart: state === "ready" ? "load-package-analytics-timeline-feed" : "rebuild-package-analytics-timeline-feed",
      onDuplicateCommand: "return-existing-package-analytics-timeline-feed",
      externalWritesPerformed: false,
    },
  };
}

function buildPackageAnalyticsAdoptionGate({
  ast,
  lifecycleControls,
  syncServiceContract,
  previewContract,
  runtimeBoundaryRelease,
  operationRows,
  counters,
  exportStatus,
  exportReady,
  timelineFeed,
}) {
  const schedule = timelineFeed.scheduleState ?? lifecycleControls.schedule ?? {};
  const blockedOperationRows = operationRows.filter((row) => row.state === "blocked");
  const reviewOperationRows = operationRows.filter((row) => row.state === "review");
  const feedBlockedKeys = timelineFeed.blockedKeys ?? [];
  const feedWaitingKeys = timelineFeed.waitingKeys ?? [];
  const feedRestartSafe = timelineFeed.restartSemantics?.restartSafe !== false;
  const scheduleDisabled = schedule.mode === "disabled" || lifecycleControls.enabled === false;
  const scheduleWindowMissing = schedule.mode === "windowed" && (!schedule.windowStart || !schedule.windowEnd);
  const adoptionRows = [
    {
      key: "analytics-export",
      state: exportReady ? "ready" : exportStatus,
      sourceId: stableId("pkganalytics", [
        ast.id,
        syncServiceContract.id,
        lifecycleControls.stateId,
        previewContract.id,
        runtimeBoundaryRelease.id,
        exportStatus,
      ]),
      nextAction: exportReady ? "stage-package-analytics-adoption" : "repair-package-analytics-export",
      blockedKeys: exportReady ? [] : blockedOperationRows.map((row) => row.operationId),
      waitingKeys: reviewOperationRows.map((row) => row.operationId),
      restartSafe: exportReady || blockedOperationRows.length === 0,
    },
    {
      key: "timeline-feed",
      state: timelineFeed.state ?? "unknown",
      sourceId: timelineFeed.id,
      nextAction: timelineFeed.nextAction ?? "review-package-analytics-timeline-feed",
      blockedKeys: feedBlockedKeys,
      waitingKeys: feedWaitingKeys,
      restartSafe: feedRestartSafe,
    },
    {
      key: "release-schedule",
      state: scheduleDisabled || scheduleWindowMissing
        ? "blocked"
        : schedule.waiting
          ? "waiting"
          : "ready",
      sourceId: lifecycleControls.stateId,
      nextAction: scheduleDisabled
        ? "enable-package-lifecycle"
        : scheduleWindowMissing
          ? "declare-release-window"
          : schedule.waiting
            ? "wait-for-release-window"
            : "persist-package-analytics-adoption",
      blockedKeys: [
        ...(scheduleDisabled ? ["release-schedule-disabled"] : []),
        ...(scheduleWindowMissing ? ["release-window-missing"] : []),
      ],
      waitingKeys: schedule.waiting && !scheduleWindowMissing ? ["release-window"] : [],
      restartSafe: !scheduleDisabled,
    },
    {
      key: "runtime-boundary-release",
      state: runtimeBoundaryRelease.state ?? "unknown",
      sourceId: runtimeBoundaryRelease.id ?? null,
      nextAction: runtimeBoundaryRelease.nextAction ?? "review-runtime-boundary-release",
      blockedKeys: runtimeBoundaryRelease.rows
        ?.filter((row) => row.state === "blocked")
        .map((row) => row.key) ?? [],
      waitingKeys: runtimeBoundaryRelease.rows
        ?.filter((row) => row.state === "waiting")
        .map((row) => row.key) ?? [],
      restartSafe: runtimeBoundaryRelease.restartSemantics?.restartSafe !== false,
    },
  ];
  const blockedRows = adoptionRows.filter((row) => row.state === "blocked");
  const waitingRows = adoptionRows.filter((row) => ["waiting", "review", "scheduled"].includes(row.state));
  const readyRows = adoptionRows.filter((row) => row.state === "ready");
  const state = blockedRows.length > 0
    ? "blocked"
    : waitingRows.length > 0
      ? "waiting"
      : "ready";
  const blockedKeys = [...new Set(blockedRows.flatMap((row) => row.blockedKeys ?? [row.key]))].sort();
  const waitingKeys = [...new Set(waitingRows.flatMap((row) => row.waitingKeys ?? [row.key]))].sort();
  const scope = [
    ast.id,
    syncServiceContract.id,
    lifecycleControls.stateId,
    timelineFeed.id,
    state,
    adoptionRows.map((row) => `${row.key}:${row.state}:${row.sourceId}`).join(","),
  ];
  const commandType = state === "ready"
    ? "publish-package-analytics-adoption"
    : "hold-package-analytics-adoption";
  const command = {
    id: stableId("pkganalyticsadoptcmd", [...scope, commandType]),
    type: commandType,
    idempotencyKey: stableId("idem", [...scope, commandType]),
    statusAfterReplay: state === "ready" ? "package-analytics-adopted" : `package-analytics-${state}`,
    writes: ["packageAnalyticsAdoptionId", "timelineFeedId", "adoptionRows", "nextAction"],
    conflict: "return-existing",
  };
  const nextAction = blockedRows[0]?.nextAction
    ?? waitingRows[0]?.nextAction
    ?? "publish-package-analytics-adoption";
  return {
    protocol: "aios.mailchimp.package-analytics-adoption-gate.v1",
    id: stableId("pkganalyticsadopt", scope),
    product: "mailchimp",
    packageId: ast.id,
    state,
    ready: state === "ready",
    visibleStatus: state === "ready"
      ? "package-analytics-adoption-ready"
      : state === "waiting"
        ? "package-analytics-adoption-waiting"
        : "package-analytics-adoption-blocked",
    nextAction,
    timelineFeedId: timelineFeed.id,
    latestSnapshotId: timelineFeed.latestSnapshotId ?? null,
    rows: adoptionRows,
    blockedKeys,
    waitingKeys,
    command,
    counters: {
      rows: adoptionRows.length,
      readyRows: readyRows.length,
      blockedRows: blockedRows.length,
      waitingRows: waitingRows.length,
      operationRows: operationRows.length,
      blockedOperations: blockedOperationRows.length,
      reviewOperations: reviewOperationRows.length,
      timelineFeedRows: timelineFeed.counters?.feedRows ?? 0,
      analyticsOperations: counters.operations ?? operationRows.length,
    },
    clientPatch: {
      packageAnalyticsAdoptionGateId: stableId("pkganalyticsadoptpatch", [ast.id, state]),
      packageAnalyticsAdoptionState: state,
      packageAnalyticsAdoptionReady: state === "ready",
      packageAnalyticsAdoptionNextAction: nextAction,
      packageAnalyticsAdoptionBlockedKeys: blockedKeys,
      packageAnalyticsAdoptionWaitingKeys: waitingKeys,
      packageAnalyticsAdoptionCommandId: command.id,
      packageAnalyticsTimelineFeedId: timelineFeed.id,
      packageAnalyticsLatestSnapshotId: timelineFeed.latestSnapshotId ?? null,
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && adoptionRows.every((row) => row.restartSafe !== false),
      onRestart: state === "ready" ? "load-package-analytics-adoption-gate" : "rebuild-package-analytics-adoption-gate",
      onDuplicateCommand: "return-existing-package-analytics-adoption",
      externalWritesPerformed: false,
    },
  };
}

function buildStateContract(ast, operation) {
  const packageState = ast.persistence;
  const operationState = operation.persistence;
  const checkpointKey = [
    "mailchimp",
    ast.name,
    operation.id,
    operationState.key,
  ].map((part) => normalizeIdentifier(part, "state")).join(":");
  const commandState = buildOperationCommandState(ast, operation, checkpointKey);
  const adapterStatus = buildAdapterStatusContract(ast, operation, checkpointKey);
  const statusLedger = buildOperationStatusLedger(ast, operation, checkpointKey);
  return {
    checkpointKey,
    packageStateKey: packageState.key,
    operationStateKey: operationState.key,
    retention: operationState.retention === "ephemeral" ? packageState.retention : operationState.retention,
    restartSafe: packageState.restartSafe && operationState.restartSafe,
    replayPolicy: operationState.replayPolicy,
    idempotency: operation.idempotency,
    persistedFields: [
      "status",
      "attempt",
      "lastVerifierResult",
      "adapterHandoff",
      "rollbackPrepared",
      "adapterStatus",
      "adapterCorrelationId",
      "statusLedgerVersion",
      "clientVisibleStatus",
      "lastRecoveryAction",
    ],
    commandState,
    adapterStatus,
    statusLedger,
    replayManifest: buildOperationReplayManifest(ast, operation, checkpointKey, commandState, statusLedger),
  };
}

function buildOperationReplayManifest(ast, operation, checkpointKey, commandState, statusLedger) {
  const replayScope = [
    ast.name,
    ast.version,
    operation.id,
    checkpointKey,
    commandState.ledgerKey,
    operation.persistence.replayPolicy,
  ];
  const commandRows = commandState.commands.map((command, index) => {
    const terminalAfterReplay = statusLedger.terminalStatuses.includes(command.statusAfter);
    const resumableAfterReplay = statusLedger.resumableStatuses.includes(command.statusAfter);
    const replayAction = terminalAfterReplay
      ? "return-existing-terminal-state"
      : command.type === "rollback-operation"
        ? "prepare-rollback-command"
        : command.type === "adapter-handoff" && operation.idempotency.conflict === "block"
          ? "hold-duplicate-adapter-command"
          : operation.persistence.replayPolicy === "rerun" && command.type === "adapter-handoff"
            ? "rerun-from-checkpoint"
            : "replay-idempotent-command";
    return {
      sequence: index + 1,
      commandId: command.id,
      commandType: command.type,
      statusBefore: command.statusBefore,
      statusAfter: command.statusAfter,
      idempotencyKey: command.idempotencyKey,
      conflict: command.conflict,
      writes: command.writes,
      replayAction,
      resumableAfterReplay,
      terminalAfterReplay,
    };
  });
  const statusRows = statusLedger.rows.map((row) => {
    const nextCommand = commandRows.find((command) => command.commandType === row.nextCommandType) ?? null;
    const restartAction = row.resumable
      ? row.recoveryAction
      : "return-existing-terminal-state";
    return {
      status: row.status,
      visibleStatus: row.visibleStatus,
      resumable: row.resumable,
      restartAction,
      nextCommandType: row.nextCommandType,
      nextCommandId: nextCommand?.commandId ?? null,
      duplicateCommandPolicy: nextCommand?.conflict ?? "return-existing",
    };
  });
  const duplicatePolicies = [...new Set(commandRows.map((command) => command.conflict))].sort();
  const heldDuplicateCommands = commandRows
    .filter((command) => command.replayAction === "hold-duplicate-adapter-command")
    .map((command) => command.commandId);
  return {
    id: stableId("replaymanifest", replayScope),
    contractVersion: "aios.mailchimp.operation-replay.v1",
    checkpointKey,
    ledgerKey: commandState.ledgerKey,
    operationId: operation.id,
    operation: operation.operation,
    adapter: operation.adapter,
    restartSafe: commandState.restartSafe,
    replayPolicy: operation.persistence.replayPolicy,
    idempotencyMode: operation.idempotency.mode,
    idempotencyKey: operation.idempotency.key,
    duplicatePolicies,
    commandRows,
    statusRows,
    resumableStatuses: statusLedger.resumableStatuses,
    terminalStatuses: statusLedger.terminalStatuses,
    replayCursorSeed: stableId("replayseed", replayScope),
    duplicateHandling: {
      adapterCommandConflict: operation.idempotency.conflict,
      heldCommandIds: heldDuplicateCommands,
      safeDefault: heldDuplicateCommands.length > 0
        ? "hold-and-surface-duplicate"
        : "return-existing-or-replay-idempotent",
    },
    restartSemantics: {
      onColdRestart: commandState.restartSafe ? "resume-from-status-ledger" : "manual-review",
      onDuplicateCommand: duplicatePolicies.includes("block")
        ? "hold-duplicate-command"
        : "return-existing-command-result",
      onTerminalStatus: "return-existing-terminal-state",
      onMissingLedger: "rebuild-from-checkpoint",
    },
  };
}

function buildOperationStatusLedger(ast, operation, checkpointKey) {
  const ledgerScope = [
    ast.name,
    ast.version,
    operation.id,
    operation.adapter,
    operation.operation,
    checkpointKey,
  ];
  const statusRows = [
    {
      status: "pending",
      visibleStatus: "waiting-to-checkpoint",
      resumable: true,
      nextCommandType: "checkpoint-operation",
      recoveryAction: "persist-operation-checkpoint",
    },
    {
      status: "checkpointed",
      visibleStatus: "ready-for-adapter-handoff",
      resumable: true,
      nextCommandType: "adapter-handoff",
      recoveryAction: "replay-idempotent-adapter-command",
    },
    {
      status: "admitted",
      visibleStatus: "waiting-for-mailchimp-status",
      resumable: true,
      nextCommandType: "adapter-status-probe",
      recoveryAction: "resume-adapter-status-probe",
    },
    {
      status: "verified",
      visibleStatus: "adapter-status-verified",
      resumable: true,
      nextCommandType: "adapter-status-probe",
      recoveryAction: operation.persistence.replayPolicy === "rerun"
        ? "rerun-from-checkpoint"
        : "return-existing-status",
    },
    {
      status: "completed",
      visibleStatus: "mailchimp-operation-completed",
      resumable: false,
      nextCommandType: null,
      recoveryAction: "return-existing-terminal-state",
    },
    {
      status: "rolled-back",
      visibleStatus: "mailchimp-operation-rolled-back",
      resumable: false,
      nextCommandType: null,
      recoveryAction: "return-existing-terminal-state",
    },
    {
      status: "blocked",
      visibleStatus: "needs-runtime-review",
      resumable: operation.persistence.replayPolicy !== "manual-review",
      nextCommandType: operation.persistence.replayPolicy === "manual-review" ? null : "checkpoint-operation",
      recoveryAction: operation.persistence.replayPolicy === "manual-review"
        ? "manual-review"
        : "resume-from-checkpoint",
    },
  ].map((row, index) => ({
    ...row,
    id: stableId("statusrow", [...ledgerScope, row.status, index]),
    sequence: index + 1,
  }));
  return {
    id: stableId("statusledger", ledgerScope),
    contractVersion: "aios.mailchimp.operation-status-ledger.v1",
    checkpointKey,
    packageStateKey: ast.persistence.key,
    operationStateKey: operation.persistence.key,
    restartSafe: ast.persistence.restartSafe && operation.persistence.restartSafe,
    replayPolicy: operation.persistence.replayPolicy,
    idempotencyMode: operation.idempotency.mode,
    rows: statusRows,
    terminalStatuses: statusRows.filter((row) => !row.resumable).map((row) => row.status),
    resumableStatuses: statusRows.filter((row) => row.resumable).map((row) => row.status),
    clientStatusIndex: statusRows.reduce((index, row) => {
      index[row.status] = {
        visibleStatus: row.visibleStatus,
        recoveryAction: row.recoveryAction,
        nextCommandType: row.nextCommandType,
      };
      return index;
    }, {}),
    persistedFields: [
      "status",
      "statusLedgerVersion",
      "clientVisibleStatus",
      "lastRecoveryAction",
      "adapterCorrelationId",
    ],
  };
}

function buildAdapterStatusContract(ast, operation, checkpointKey) {
  const policy = operation.adapterStatus;
  const statusScope = [
    ast.name,
    ast.version,
    operation.id,
    operation.adapter,
    policy.statusProbe,
    checkpointKey,
  ];
  return {
    id: stableId("adapterstatus", statusScope),
    probe: policy.statusProbe,
    correlationField: policy.correlationField,
    correlationKey: stableId("corr", [...statusScope, policy.correlationField]),
    expected: {
      success: policy.successStatuses,
      pending: policy.pendingStatuses,
      failure: policy.failureStatuses,
      terminal: policy.terminalStatuses,
      fixtures: operation.adapterStatusFixtures,
      defaultFixtureId: operation.adapterStatusFixtures.find((fixture) => fixture.selectedByDefault)?.id
        ?? operation.adapterStatusFixtures[0]?.id
        ?? null,
    },
    polling: {
      intervalMs: policy.pollIntervalMs,
      maxPolls: policy.maxPolls,
      timeoutMs: policy.timeoutMs,
      timeoutStatus: policy.onPendingAfterTimeout,
    },
    recovery: {
      signal: policy.recoverySignal,
      onFailure: policy.onFailure,
      onTimeout: policy.onPendingAfterTimeout,
      rollbackCommand: stableId("cmd", [...statusScope, "adapter-status-rollback"]),
      resumeCommand: stableId("cmd", [...statusScope, "adapter-status-resume"]),
    },
    persistedFields: ["adapterStatus", "adapterCorrelationId", "lastVerifierResult"],
  };
}

function buildOperationCommandState(ast, operation, checkpointKey) {
  const commandScope = [
    ast.name,
    ast.version,
    operation.id,
    checkpointKey,
  ];
  const adapterCommandId = stableId("cmd", [...commandScope, operation.adapter, operation.operation]);
  const checkpointCommandId = stableId("cmd", [...commandScope, "checkpoint"]);
  const rollbackCommandId = stableId("cmd", [...commandScope, "rollback", operation.rollback]);
  const statusCommandId = stableId("cmd", [...commandScope, "adapter-status", operation.adapterStatus.statusProbe]);
  const idempotencyKey = operation.idempotency.key ?? stableId("idem", [...commandScope, "unguarded"]);
  return {
    ledgerKey: stableId("ledger", commandScope),
    restartSafe: operation.persistence.restartSafe && operation.idempotency.mode !== "none",
    commands: [
      {
        id: checkpointCommandId,
        type: "checkpoint-operation",
        statusBefore: "pending",
        statusAfter: "checkpointed",
        idempotencyKey: stableId("idem", [...commandScope, "checkpoint"]),
        conflict: "return-existing",
        writes: ["status", "attempt", "adapterHandoff"],
      },
      {
        id: adapterCommandId,
        type: "adapter-handoff",
        statusBefore: "checkpointed",
        statusAfter: "admitted",
        idempotencyKey,
        conflict: operation.idempotency.conflict,
        writes: ["status", "lastVerifierResult", "adapterHandoff"],
      },
      {
        id: statusCommandId,
        type: "adapter-status-probe",
        statusBefore: "admitted",
        statusAfter: "verified",
        idempotencyKey: stableId("idem", [...commandScope, "adapter-status", operation.adapterStatus.statusProbe]),
        conflict: "return-existing",
        writes: ["status", "adapterStatus", "adapterCorrelationId", "lastVerifierResult"],
      },
      {
        id: rollbackCommandId,
        type: "rollback-operation",
        statusBefore: "verified",
        statusAfter: "rolled-back",
        idempotencyKey: stableId("idem", [...commandScope, "rollback"]),
        conflict: "return-existing",
        writes: ["status", "rollbackPrepared"],
      },
    ],
    replay: {
      policy: operation.persistence.replayPolicy,
      duplicateAdapterCommand: operation.idempotency.conflict,
      completedStatus: operation.persistence.replayPolicy === "rerun" ? "checkpointed" : "verified",
      blockedStatus: operation.persistence.replayPolicy === "manual-review" ? "blocked" : "checkpointed",
    },
    statusTransitions: [
      { from: "pending", command: checkpointCommandId, to: "checkpointed" },
      { from: "checkpointed", command: adapterCommandId, to: "admitted" },
      { from: "admitted", command: statusCommandId, to: "verified" },
      { from: "verified", command: rollbackCommandId, to: "rolled-back" },
      { from: "verified", command: statusCommandId, to: "completed", replay: "skip-completed" },
    ],
  };
}

function parseOperation(entry, index) {
  const source = typeof entry === "string" ? { op: entry } : { ...entry };
  const adapter = normalizeIdentifier(source.adapter, DEFAULT_ADAPTER);
  const operation = normalizeIdentifier(source.op ?? source.operation, `operation-${index + 1}`);
  const adapterStatus = normalizeAdapterStatusPolicy(source.adapterStatus ?? source.status ?? source.recoveryStatus, operation);
  return {
    id: normalizeIdentifier(source.id, `${operation}-${index + 1}`),
    adapter,
    operation,
    inputSchema: source.inputSchema ?? source.input ?? {},
    outputSchema: source.outputSchema ?? source.output ?? {},
    requires: asArray(source.requires).map(parseCapability),
    verifier: asArray(source.verifier ?? source.verifiers).map(parseVerifier),
    rollback: source.rollback ? normalizeIdentifier(source.rollback, "manual-review") : "no-op",
    persistence: normalizePersistencePolicy(source.persistence ?? source.state, operation),
    idempotency: normalizeIdempotency(source.idempotency, operation),
    truthBoundary: normalizeTruthBoundary(source.truthBoundary ?? source.truth),
    adapterStatus,
    adapterStatusFixtures: normalizeAdapterStatusFixtures(
      source.adapterStatusFixtures ?? source.statusFixtures ?? source.dryRunStatuses,
      adapterStatus,
      operation,
    ),
  };
}

function normalizeTruthBoundary(value) {
  const source = typeof value === "string" ? { mode: value } : { ...value };
  const mode = normalizeIdentifier(source.mode, "declared");
  return {
    mode,
    report: source.report !== false,
    evidenceRequired: source.evidenceRequired !== false,
    externalState: source.externalState === true,
  };
}

function collectManifestIssues(ast) {
  const issues = [];
  if (!ast.name) {
    issues.push({ code: "manifest.name.missing", severity: "error", message: "Package manifest requires a name." });
  }
  if (ast.capabilities.some((capability) => RESERVED_EXTERNAL_WRITE_CAPABILITIES.has(capability.name))) {
    issues.push({
      code: "manifest.capability.external-write",
      severity: "error",
      message: "Package manifests may not request external write capabilities from the compiler surface.",
    });
  }
  if (ast.syncMetadata.audience.required && !ast.syncMetadata.audience.id && !ast.syncMetadata.requiredFacts.includes("audience_id")) {
    issues.push({
      code: "manifest.sync.audience-source-missing",
      severity: "warning",
      message: "Mailchimp sync requires an audience binding; provide audience.id or require audience_id claim evidence.",
    });
  }
  if (ast.syncMetadata.campaign.required && ast.syncMetadata.mode === "status-only") {
    issues.push({
      code: "manifest.sync.campaign-status-only",
      severity: "warning",
      message: "Campaign sync is marked required while package sync mode is status-only.",
    });
  }
  if (ast.syncMetadata.batchSize > 1000) {
    issues.push({
      code: "manifest.sync.batch-size-large",
      severity: "warning",
      message: "Mailchimp sync batch size is larger than the compiler recommended maximum of 1000.",
      batchSize: ast.syncMetadata.batchSize,
    });
  }
  for (const operation of ast.operations) {
    if (operation.truthBoundary.externalState && operation.truthBoundary.mode === "declared") {
      issues.push({
        code: "manifest.truth-boundary.external-state",
        severity: "warning",
        message: `Operation ${operation.id} reads external state and should declare observed evidence.`,
      });
    }
    if (operation.persistence.restartSafe && operation.idempotency.mode === "none") {
      issues.push({
        code: "manifest.idempotency.missing",
        severity: "warning",
        message: `Operation ${operation.id} is restart-safe but has no idempotency key.`,
      });
    }
    if (operation.idempotency.mode === "required" && operation.idempotency.conflict === "rerun") {
      issues.push({
        code: "manifest.idempotency.rerun-conflict",
        severity: "warning",
        message: `Operation ${operation.id} uses a required idempotency key but allows duplicate commands to rerun.`,
      });
    }
    if (operation.persistence.retention === "durable" && ast.persistence.retention === "ephemeral") {
      issues.push({
        code: "manifest.persistence.scope-mismatch",
        severity: "warning",
        message: `Operation ${operation.id} requests durable state while package state is ephemeral.`,
      });
    }
    const overlappingStatuses = operation.adapterStatus.successStatuses.filter((status) => (
      operation.adapterStatus.failureStatuses.includes(status)
    ));
    if (overlappingStatuses.length > 0) {
      issues.push({
        code: "manifest.adapter-status.ambiguous-terminal",
        severity: "error",
        message: `Operation ${operation.id} declares adapter statuses as both success and failure.`,
        statuses: overlappingStatuses,
      });
    }
    if (operation.adapterStatus.pollIntervalMs * operation.adapterStatus.maxPolls < operation.adapterStatus.timeoutMs) {
      issues.push({
        code: "manifest.adapter-status.poll-budget-short",
        severity: "warning",
        message: `Operation ${operation.id} adapter status polling may end before timeoutMs.`,
      });
    }
    const nonDeterministicFixtures = operation.adapterStatusFixtures.filter((fixture) => fixture.deterministic === false);
    if (nonDeterministicFixtures.length > 0) {
      issues.push({
        code: "manifest.adapter-status.fixture-nondeterministic",
        severity: "warning",
        message: `Operation ${operation.id} has dry-run adapter status fixtures that are marked non-deterministic.`,
        fixtureIds: nonDeterministicFixtures.map((fixture) => fixture.id),
      });
    }
    const unknownFixtureRows = operation.adapterStatusFixtures.flatMap((fixture) => (
      fixture.rows
        .filter((row) => row.classification === "unknown")
        .map((row) => ({ fixtureId: fixture.id, status: row.status }))
    ));
    if (unknownFixtureRows.length > 0) {
      issues.push({
        code: "manifest.adapter-status.fixture-unknown-status",
        severity: "warning",
        message: `Operation ${operation.id} has dry-run adapter status fixtures outside expected status sets.`,
        rows: unknownFixtureRows,
      });
    }
  }
  return issues;
}

export function parsePackageManifest(source) {
  const manifest = parseManifestSource(source);
  const name = normalizeIdentifier(manifest.name ?? manifest.package, "mailchimp-package");
  const version = String(manifest.version ?? "0.0.0");
  const capabilities = asArray(manifest.capabilities ?? manifest.capability).map(parseCapability);
  const memory = asArray(manifest.memory ?? manifest.mounts).map(parseMemoryMount);
  const verifiers = asArray(manifest.verifiers ?? manifest.verifier).map(parseVerifier);
  const operations = asArray(manifest.operations ?? manifest.operation ?? ["mailchimp.syncAudience"]).map(parseOperation);
  const persistence = normalizePersistencePolicy(
    manifest.persistence ?? manifest.state ?? manifest.runtimeState,
    name,
  );
  const lifecycle = normalizeLifecyclePolicy(manifest.lifecycle ?? manifest.controls ?? manifest.release, name);
  const syncMetadata = normalizeSyncMetadata(
    manifest.syncMetadata ?? manifest.sync ?? manifest.providerSync ?? manifest.mailchimp,
    name,
  );
  const providerContract = normalizeProviderContractPolicy(
    manifest.providerContract ?? manifest.providerService ?? manifest.integrationProvider,
    syncMetadata,
    name,
  );
  return {
    kind: "AiosPackageManifestAst",
    name,
    version,
    id: stableId("pkg", [name, version, operations.map((operation) => operation.id).join(",")]),
    adapter: normalizeIdentifier(manifest.adapter, DEFAULT_ADAPTER),
    capabilities,
    memory,
    verifiers,
    operations,
    persistence,
    lifecycle,
    syncMetadata,
    providerContract,
    tenantPolicy: manifest.tenantPolicy ?? manifest.tenant ?? manifest.permissions ?? {},
    metadata: { product: "mailchimp", sourceFormat: typeof source === "string" ? "text" : "object" },
  };
}

function buildTenantCapabilityBoundaryContract(ast, compiledOperations, syncServiceContract, providerIntegrationContract) {
  const tenantSource = ast.tenantPolicy ?? ast.tenant ?? {};
  const tenantId = normalizeIdentifier(
    tenantSource.tenantId ?? tenantSource.tenant ?? ast.tenantId ?? "mailchimp-tenant",
    "mailchimp-tenant",
  );
  const defaultWorkspaceId = normalizeIdentifier(
    tenantSource.defaultWorkspaceId ?? tenantSource.workspaceId ?? tenantSource.workspace ?? tenantId,
    tenantId,
  );
  const declaredWorkspaces = asArray(tenantSource.workspaces ?? tenantSource.workspacePolicy);
  const workspaceRows = (declaredWorkspaces.length > 0 ? declaredWorkspaces : [{ workspaceId: defaultWorkspaceId }])
    .map((entry, index) => {
      const source = typeof entry === "string" ? { workspaceId: entry } : { ...(entry ?? {}) };
      const workspaceId = normalizeIdentifier(
        source.workspaceId ?? source.workspace ?? source.id,
        index === 0 ? defaultWorkspaceId : `${tenantId}-workspace-${index + 1}`,
      );
      const allowedCapabilities = asArray(
        source.allowedCapabilities
          ?? source.capabilities
          ?? tenantSource.allowedCapabilities
          ?? tenantSource.capabilities,
      )
        .map((capability) => normalizeIdentifier(capability, "capability"))
        .filter(Boolean)
        .sort();
      const allowedRoles = asArray(source.allowedRoles ?? source.roles ?? tenantSource.allowedRoles ?? tenantSource.roles)
        .map((role) => normalizeIdentifier(role, "operator"))
        .filter(Boolean);
      return {
        workspaceId,
        isolationKey: stableId("manifestworkspace", [tenantId, workspaceId]),
        allowedCapabilities,
        allowedRoles: allowedRoles.length > 0 ? [...new Set(allowedRoles)].sort() : ["admin", "approver", "operator"],
        requiresApprovalForExternalWrite: source.requiresApprovalForExternalWrite
          ?? tenantSource.requiresApprovalForExternalWrite
          ?? true,
        auditRequired: source.auditRequired ?? tenantSource.auditRequired ?? true,
      };
    });
  const allCapabilityNames = [...new Set([
    ...ast.capabilities.map((capability) => capability.name),
    ...compiledOperations.flatMap((operation) => operation.capabilityNames),
    ...(syncServiceContract.requiredProviderCapabilities ?? []),
  ])].sort();
  const writeCapabilities = allCapabilityNames.filter((capability) => (
    capability.endsWith(".write")
      || capability.endsWith(".send")
      || capability.includes("segment.write")
      || RESERVED_EXTERNAL_WRITE_CAPABILITIES.has(capability)
  ));
  const capabilityRows = allCapabilityNames.map((capability, index) => {
    const requestedByOperationIds = compiledOperations
      .filter((operation) => operation.capabilityNames.includes(capability))
      .map((operation) => operation.id)
      .sort();
    const blockedWorkspaceIds = workspaceRows
      .filter((workspace) => (
        workspace.allowedCapabilities.length > 0
        && !workspace.allowedCapabilities.includes(capability)
      ))
      .map((workspace) => workspace.workspaceId);
    const writeLike = writeCapabilities.includes(capability);
    return {
      sequence: index + 1,
      capability,
      provider: capability.startsWith("mailchimp.") ? syncServiceContract.provider : DEFAULT_ADAPTER,
      access: writeLike ? "write" : capability.endsWith(".read") || capability.includes("status") ? "read" : "runtime",
      requestedByOperationIds,
      requiredBySync: (syncServiceContract.requiredProviderCapabilities ?? []).includes(capability),
      blockedWorkspaceIds,
      requiresApproval: writeLike || blockedWorkspaceIds.length > 0,
      state: blockedWorkspaceIds.length > 0 ? "blocked" : writeLike ? "approval-required" : "allowed",
      nextAction: blockedWorkspaceIds.length > 0
        ? "repair-manifest-workspace-capability-policy"
        : writeLike
          ? "collect-workspace-write-approval"
          : "persist-workspace-capability-grant",
    };
  });
  const blockedRows = capabilityRows.filter((row) => row.state === "blocked");
  const approvalRows = capabilityRows.filter((row) => row.state === "approval-required");
  const providerMissingFeatures = providerIntegrationContract.validationSummary?.missingFeatures ?? [];
  const state = blockedRows.length > 0 || providerMissingFeatures.length > 0
    ? "blocked"
    : approvalRows.length > 0
      ? "approval-required"
      : "ready";
  const boundaryId = stableId("manifestboundary", [
    ast.id,
    tenantId,
    workspaceRows.map((workspace) => `${workspace.workspaceId}:${workspace.allowedCapabilities.join("+")}`).join(","),
    capabilityRows.map((row) => `${row.capability}:${row.state}`).join(","),
    providerMissingFeatures.join(","),
  ]);
  const command = {
    id: stableId("manifestboundarycmd", [boundaryId, "persist-tenant-capability-boundary"]),
    type: "persist-tenant-capability-boundary",
    idempotencyKey: stableId("idem", [boundaryId, "persist-tenant-capability-boundary"]),
    statusAfterReplay: state,
    writes: ["tenantId", "workspaceRows", "capabilityRows", "providerMissingFeatures"],
    conflict: "return-existing",
  };
  return {
    id: boundaryId,
    product: "mailchimp",
    contractVersion: "aios.mailchimp.manifest-tenant-capability-boundary.v1",
    state,
    ready: state !== "blocked",
    tenantId,
    defaultWorkspaceId,
    isolationMode: tenantSource.workspaceIsolation === false ? "advisory" : "strict",
    workspaceRows,
    capabilityRows,
    blockedCapabilities: blockedRows.map((row) => row.capability),
    approvalRequiredCapabilities: approvalRows.map((row) => row.capability),
    providerMissingFeatures,
    command,
    nextAction: blockedRows[0]?.nextAction
      ?? (providerMissingFeatures.length > 0 ? "repair-provider-service-contract" : null)
      ?? approvalRows[0]?.nextAction
      ?? "persist-tenant-capability-boundary",
    validationSummary: {
      workspaces: workspaceRows.length,
      capabilities: capabilityRows.length,
      blockedCapabilities: blockedRows.length,
      approvalRequiredCapabilities: approvalRows.length,
      writeCapabilities: writeCapabilities.length,
      providerMissingFeatures: providerMissingFeatures.length,
    },
    clientPatch: {
      tenantCapabilityBoundaryId: boundaryId,
      tenantCapabilityBoundaryState: state,
      tenantCapabilityBoundaryReady: state !== "blocked",
      tenantCapabilityBoundaryNextAction: blockedRows[0]?.nextAction
        ?? (providerMissingFeatures.length > 0 ? "repair-provider-service-contract" : null)
        ?? approvalRows[0]?.nextAction
        ?? "persist-tenant-capability-boundary",
      tenantCapabilityBoundaryBlockedCapabilities: blockedRows.map((row) => row.capability),
      tenantCapabilityBoundaryApprovalCapabilities: approvalRows.map((row) => row.capability),
    },
    restartSemantics: {
      restartSafe: state !== "blocked",
      onRestart: state === "ready" ? "load-tenant-capability-boundary" : "rebuild-tenant-capability-boundary",
      onDuplicateCommand: "return-existing-tenant-capability-boundary",
      onWorkspacePolicyMutation: "recompute-tenant-capability-boundary",
      externalWritesPerformed: false,
    },
  };
}

function buildTenantPermissionReplayLedger(ast, compiledOperations, tenantCapabilityBoundary, providerReadinessExport) {
  const tenantSource = ast.tenantPolicy ?? {};
  const roleSource = asArray(
    tenantSource.rolePolicies
      ?? tenantSource.rolesPolicy
      ?? tenantSource.roles
      ?? tenantSource.allowedRoles,
  );
  const roleRows = (roleSource.length > 0 ? roleSource : ["operator", "approver", "admin"])
    .map((entry, index) => {
      const source = typeof entry === "string" ? { role: entry } : { ...(entry ?? {}) };
      const role = normalizeIdentifier(source.role ?? source.name, `role-${index + 1}`);
      const canApprove = source.canApprove === true || ["approver", "admin"].includes(role);
      const canExecute = source.canExecute !== false;
      return {
        sequence: index + 1,
        role,
        canExecute,
        canApprove,
        maxExternalWrites: Number.isInteger(source.maxExternalWrites) && source.maxExternalWrites >= 0
          ? source.maxExternalWrites
          : canApprove
            ? 25
            : 0,
        restartSafe: canExecute,
      };
    })
    .sort((left, right) => left.role.localeCompare(right.role))
    .map((row, index) => ({ ...row, sequence: index + 1 }));
  const roleMap = new Map(roleRows.map((row) => [row.role, row]));
  const workspaceRows = (tenantCapabilityBoundary.workspaceRows ?? []).map((workspace, index) => {
    const roles = (workspace.allowedRoles ?? []).length > 0
      ? workspace.allowedRoles
      : roleRows.map((role) => role.role);
    const missingRoles = roles.filter((role) => !roleMap.has(role)).sort();
    const executeDisabledRoles = roles
      .filter((role) => roleMap.has(role) && roleMap.get(role).canExecute === false)
      .sort();
    return {
      sequence: index + 1,
      workspaceId: workspace.workspaceId,
      isolationKey: workspace.isolationKey,
      allowedRoles: [...new Set(roles)].sort(),
      missingRoles,
      executeDisabledRoles,
      auditRequired: workspace.auditRequired !== false,
      requiresApprovalForExternalWrite: workspace.requiresApprovalForExternalWrite !== false,
      state: missingRoles.length > 0 || executeDisabledRoles.length > 0
        ? "blocked"
        : workspace.auditRequired === false
          ? "review"
          : "ready",
      nextAction: missingRoles.length > 0
        ? "repair-workspace-role-policy"
        : executeDisabledRoles.length > 0
          ? "enable-role-execution-or-remove-workspace-role"
          : workspace.auditRequired === false
            ? "review-audit-waiver"
            : "persist-workspace-permission-ledger-row",
    };
  });
  const writeOperations = compiledOperations.filter((operation) => (
    operation.capabilityNames.some((capability) => (
      capability.endsWith(".write") || capability.endsWith(".send") || capability.includes("segment.write")
    ))
  ));
  const permissionRows = workspaceRows.flatMap((workspace) => (
    roleRows.map((role) => {
      const externalWriteBudgetExceeded = writeOperations.length > role.maxExternalWrites;
      const roleInWorkspace = workspace.allowedRoles.includes(role.role);
      const needsApproval = writeOperations.length > 0 && workspace.requiresApprovalForExternalWrite && !role.canApprove;
      const state = !roleInWorkspace || !role.canExecute || externalWriteBudgetExceeded
        ? "blocked"
        : needsApproval
          ? "approval-required"
          : workspace.state === "review"
            ? "review"
            : "ready";
      return {
        rowId: stableId("tenantpermrow", [
          tenantCapabilityBoundary.id,
          workspace.workspaceId,
          role.role,
          state,
          writeOperations.map((operation) => operation.id).join(","),
        ]),
        workspaceId: workspace.workspaceId,
        role: role.role,
        state,
        canExecute: role.canExecute,
        canApprove: role.canApprove,
        roleInWorkspace,
        auditRequired: workspace.auditRequired,
        writeOperationIds: writeOperations.map((operation) => operation.id),
        requestedExternalWrites: writeOperations.length,
        maxExternalWrites: role.maxExternalWrites,
        blockedReasons: [
          ...(!roleInWorkspace ? ["role-not-allowed-in-workspace"] : []),
          ...(!role.canExecute ? ["role-execution-disabled"] : []),
          ...(externalWriteBudgetExceeded ? ["role-external-write-budget-exceeded"] : []),
        ],
        waitingReasons: needsApproval ? ["external-write-approval-required"] : [],
        nextAction: !roleInWorkspace
          ? "repair-workspace-role-policy"
          : !role.canExecute
            ? "enable-role-execution-or-select-different-role"
            : externalWriteBudgetExceeded
              ? "reduce-external-write-count-or-raise-role-budget"
              : needsApproval
                ? "collect-tenant-approval"
                : workspace.state === "review"
                  ? "review-audit-waiver"
                  : "persist-tenant-permission-row",
        restartSafe: role.canExecute && !externalWriteBudgetExceeded,
      };
    })
  ));
  const blockedRows = permissionRows.filter((row) => row.state === "blocked");
  const approvalRows = permissionRows.filter((row) => row.state === "approval-required");
  const reviewRows = permissionRows.filter((row) => row.state === "review");
  const providerBlocked = providerReadinessExport.state === "blocked";
  const state = blockedRows.length > 0 || providerBlocked
    ? "blocked"
    : approvalRows.length > 0
      ? "approval-required"
      : reviewRows.length > 0
        ? "review"
        : "ready";
  const ledgerId = stableId("tenantpermledger", [
    tenantCapabilityBoundary.id,
    providerReadinessExport.id,
    state,
    permissionRows.map((row) => `${row.workspaceId}:${row.role}:${row.state}`).join(","),
  ]);
  const commands = [
    {
      id: stableId("tenantpermcmd", [ledgerId, "persist-tenant-permission-replay-ledger"]),
      type: "persist-tenant-permission-replay-ledger",
      idempotencyKey: stableId("idem", [ledgerId, "persist-tenant-permission-replay-ledger"]),
      statusAfterReplay: state,
      writes: ["tenantPermissionRows", "workspaceRoleRows", "auditPolicy", "providerReadinessState"],
      conflict: "return-existing",
    },
    ...(blockedRows.length > 0 || providerBlocked ? [{
      id: stableId("tenantpermcmd", [ledgerId, "hold-runtime-boundary", blockedRows.map((row) => row.rowId).join(",")]),
      type: "hold-runtime-boundary-for-tenant-permission",
      idempotencyKey: stableId("idem", [ledgerId, "hold-runtime-boundary", providerReadinessExport.state]),
      statusAfterReplay: "blocked",
      writes: ["blockedPermissionRows", "providerReadinessState", "operatorNextAction"],
      conflict: "return-existing",
    }] : []),
    ...(approvalRows.length > 0 ? [{
      id: stableId("tenantpermcmd", [ledgerId, "persist-approval-hold", approvalRows.map((row) => row.rowId).join(",")]),
      type: "persist-tenant-approval-hold",
      idempotencyKey: stableId("idem", [ledgerId, "persist-approval-hold"]),
      statusAfterReplay: "approval-required",
      writes: ["approvalRows", "resumeCursor", "approverRoles"],
      conflict: "return-existing",
    }] : []),
  ];
  return {
    id: ledgerId,
    product: "mailchimp",
    protocol: "aios.mailchimp.tenant-permission-replay-ledger.v1",
    state,
    ready: state === "ready" || state === "review",
    tenantId: tenantCapabilityBoundary.tenantId,
    defaultWorkspaceId: tenantCapabilityBoundary.defaultWorkspaceId,
    boundaryId: tenantCapabilityBoundary.id,
    providerReadinessExportId: providerReadinessExport.id,
    providerReadinessState: providerReadinessExport.state,
    workspaceRows,
    roleRows,
    permissionRows,
    commands,
    blockedRows: blockedRows.map((row) => row.rowId),
    approvalRows: approvalRows.map((row) => row.rowId),
    reviewRows: reviewRows.map((row) => row.rowId),
    nextAction: providerBlocked
      ? "repair-provider-readiness-before-permission-replay"
      : blockedRows[0]?.nextAction
        ?? approvalRows[0]?.nextAction
        ?? reviewRows[0]?.nextAction
        ?? "persist-tenant-permission-replay-ledger",
    clientPatch: {
      tenantPermissionReplayLedgerId: ledgerId,
      tenantPermissionReplayState: state,
      tenantPermissionReplayReady: state === "ready" || state === "review",
      tenantPermissionReplayNextAction: providerBlocked
        ? "repair-provider-readiness-before-permission-replay"
        : blockedRows[0]?.nextAction
          ?? approvalRows[0]?.nextAction
          ?? reviewRows[0]?.nextAction
          ?? "persist-tenant-permission-replay-ledger",
      blockedPermissionRows: blockedRows.map((row) => row.rowId),
      approvalPermissionRows: approvalRows.map((row) => row.rowId),
      commandIds: commands.map((command) => command.id),
    },
    restartSemantics: {
      restartSafe: state !== "blocked" && permissionRows.every((row) => row.restartSafe !== false),
      replayCursor: stableId("tenantpermcursor", [ledgerId, providerReadinessExport.id, commands.map((command) => command.id).join(",")]),
      onRestart: state === "ready" ? "load-tenant-permission-replay-ledger" : "rebuild-tenant-permission-replay-ledger",
      onDuplicateCommand: "return-existing-tenant-permission-command",
      onWorkspaceRoleMutation: "recompute-tenant-permission-replay-ledger",
      externalWritesPerformed: false,
    },
  };
}

export function compilePackageManifest(source, options = {}) {
  const ast = parsePackageManifest(source);
  const issues = collectManifestIssues(ast);
  const compiledOperations = ast.operations.map((operation) => {
    const stateContract = buildStateContract(ast, operation);
    return {
      ...operation,
      descriptorId: stableId("op", [ast.id, operation.id, operation.adapter, operation.operation]),
      capabilityNames: [...new Set([...ast.capabilities, ...operation.requires].map((capability) => capability.name))],
      verifierNames: [...new Set([...ast.verifiers, ...operation.verifier].map((verifier) => verifier.name))],
      stateContract,
      adapterStatus: stateContract.adapterStatus,
    };
  });
  const baseLifecycleControls = buildLifecycleControlState(ast, ast.lifecycle, compiledOperations);
  const lifecycleReleaseGate = buildLifecycleReleaseGate(
    ast,
    ast.lifecycle,
    compiledOperations,
    baseLifecycleControls,
    issues,
  );
  const lifecycleControls = {
    ...baseLifecycleControls,
    releaseGate: lifecycleReleaseGate,
  };
  const lifecycleOperatorOverride = buildLifecycleOperatorOverrideContract(
    ast,
    compiledOperations,
    lifecycleControls,
    ast.lifecycle,
  );
  const syncServiceContract = buildSyncServiceContract(ast, compiledOperations);
  const providerIntegrationContract = buildProviderIntegrationContract(
    ast,
    compiledOperations,
    syncServiceContract,
    lifecycleControls,
  );
  const previewContract = buildManifestPreviewContract(
    ast,
    compiledOperations,
    lifecycleControls,
    syncServiceContract,
    issues,
  );
  const providerClientHandoff = buildProviderClientHandoffContract(
    ast,
    compiledOperations,
    lifecycleControls,
    syncServiceContract,
    previewContract,
    providerIntegrationContract,
  );
  const providerSyncAcceptanceContract = buildProviderSyncAcceptanceContract(
    ast,
    compiledOperations,
    lifecycleControls,
    syncServiceContract,
    providerIntegrationContract,
    providerClientHandoff,
  );
  const providerReadinessExport = buildProviderReadinessExportContract(
    ast,
    compiledOperations,
    syncServiceContract,
    providerIntegrationContract,
    providerSyncAcceptanceContract,
    providerClientHandoff,
  );
  const releaseAcceptanceContract = buildLifecycleReleaseAcceptanceContract(
    ast,
    compiledOperations,
    lifecycleControls,
    syncServiceContract,
    previewContract,
    providerClientHandoff,
  );
  const lifecycleSettingsAdoption = buildLifecycleSettingsAdoptionContract(
    ast,
    lifecycleControls,
    syncServiceContract,
    previewContract,
  );
  const operatorReleaseChecklist = buildOperatorReleaseChecklist(
    ast,
    lifecycleControls,
    previewContract,
    providerClientHandoff,
    releaseAcceptanceContract,
  );
  const runtimeBoundaryRelease = buildRuntimeBoundaryReleasePacket(
    ast,
    compiledOperations,
    lifecycleControls,
    syncServiceContract,
    providerClientHandoff,
    releaseAcceptanceContract,
    operatorReleaseChecklist,
  );
  const lifecycleCommandDispatch = buildLifecycleCommandDispatchPacket(
    ast,
    compiledOperations,
    {
      ...lifecycleControls,
      settingsAdoption: lifecycleSettingsAdoption,
    },
    syncServiceContract,
    providerIntegrationContract,
    releaseAcceptanceContract,
    runtimeBoundaryRelease,
  );
  const packageAnalyticsExport = buildPackageAnalyticsExportContract(
    ast,
    compiledOperations,
    lifecycleControls,
    syncServiceContract,
    previewContract,
    providerClientHandoff,
    releaseAcceptanceContract,
    operatorReleaseChecklist,
    runtimeBoundaryRelease,
    issues,
  );
  const operationalIncidentLedger = buildPackageOperationalIncidentLedger(
    ast,
    compiledOperations,
    lifecycleControls,
    syncServiceContract,
    providerIntegrationContract,
    previewContract,
    providerClientHandoff,
    releaseAcceptanceContract,
    packageAnalyticsExport,
    issues,
  );
  const packageOperationalHealthExport = buildPackageOperationalHealthExport(
    ast,
    compiledOperations,
    operationalIncidentLedger,
    packageAnalyticsExport,
    providerReadinessExport,
  );
  const tenantCapabilityBoundary = buildTenantCapabilityBoundaryContract(
    ast,
    compiledOperations,
    syncServiceContract,
    providerIntegrationContract,
  );
  const tenantPermissionReplayLedger = buildTenantPermissionReplayLedger(
    ast,
    compiledOperations,
    tenantCapabilityBoundary,
    providerReadinessExport,
  );
  const packageDescriptor = {
    kind: "AiosPackageDescriptor",
    id: ast.id,
    name: ast.name,
    version: ast.version,
    runtimeAdapter: ast.adapter,
    capabilities: ast.capabilities,
    memory: ast.memory,
    verifierContracts: ast.verifiers,
    operations: compiledOperations,
    syncMetadata: {
      ...ast.syncMetadata,
      serviceContractId: syncServiceContract.id,
      providerIntegrationContractId: providerIntegrationContract.id,
      providerSyncAcceptanceContractId: providerSyncAcceptanceContract.id,
      providerReadinessExportId: providerReadinessExport.id,
    },
    syncServiceContract,
    providerIntegrationContract,
    providerSyncAcceptanceContract,
    providerReadinessExport,
    providerClientHandoff,
    tenantCapabilityBoundary,
    tenantPermissionReplayLedger,
    runtimeBoundaryRelease,
    lifecycleSettingsAdoption,
    packageAnalyticsExport,
    packageAnalyticsAdoptionGate: packageAnalyticsExport.adoptionGate,
    packageAnalyticsExportLedger: packageAnalyticsExport.exportLedger,
    analyticsExport: packageAnalyticsExport,
    analyticsExportLedger: packageAnalyticsExport.exportLedger,
    operationalIncidentLedger,
    packageOperationalHealthExport,
    operationalHealthExport: packageOperationalHealthExport,
    previewContract,
    persistence: {
      key: ast.persistence.key,
      scope: ast.persistence.scope,
      retention: ast.persistence.retention,
      restartSafe: ast.persistence.restartSafe,
      replayPolicy: ast.persistence.replayPolicy,
      commandLog: {
        id: stableId("cmdlog", [ast.id, ast.persistence.key, ast.operations.map((operation) => operation.id).join(",")]),
        idempotentBy: ast.operations
          .map((operation) => operation.idempotency.key)
          .filter(Boolean),
        ledgerKeys: ast.operations.map((operation) => buildStateContract(ast, operation).commandState.ledgerKey),
        statuses: ["pending", "checkpointed", "admitted", "verified", "replayed", "completed", "rolled-back"],
      },
    },
    recovery: {
      rollbackStrategy: options.rollbackStrategy ?? "checkpoint-then-adapter-rollback",
      checkpointScope: options.checkpointScope ?? "package-operation",
      restartPolicy: options.restartPolicy ?? ast.persistence.replayPolicy,
      statusStates: ["planned", "checkpointed", "admitted", "verified", "blocked", "replayed", "rolled-back", "completed"],
    },
    lifecycleControls: {
      ...lifecycleControls,
      operatorOverride: lifecycleOperatorOverride,
      settingsAdoption: lifecycleSettingsAdoption,
      releaseAcceptance: releaseAcceptanceContract,
      operatorReleaseChecklist,
      runtimeBoundaryRelease,
      commandDispatch: lifecycleCommandDispatch,
      providerSyncAcceptance: providerSyncAcceptanceContract,
      providerReadinessExport,
      tenantCapabilityBoundary,
      tenantPermissionReplayLedger,
    },
    lifecycleSettingsAdoption,
    lifecycleOperatorOverride,
    lifecycleCommandDispatch,
    releaseAcceptanceContract,
    operatorReleaseChecklist,
    runtimeBoundaryRelease,
    validationSummary: previewContract.validationSummary,
    analyticsSummary: packageAnalyticsExport.exportSummary,
    analyticsExportLedgerSummary: {
      id: packageAnalyticsExport.exportLedger.id,
      state: packageAnalyticsExport.exportLedger.state,
      exportReady: packageAnalyticsExport.exportLedger.exportReady,
      visibleStatus: packageAnalyticsExport.exportLedger.visibleStatus,
      nextAction: packageAnalyticsExport.exportLedger.nextAction,
      blockedKeys: packageAnalyticsExport.exportLedger.blockedKeys,
      waitingKeys: packageAnalyticsExport.exportLedger.waitingKeys,
      commandIds: packageAnalyticsExport.exportLedger.commands.map((command) => command.id),
      restartSafe: packageAnalyticsExport.exportLedger.restartSemantics.restartSafe,
    },
    operationalHealthSummary: {
      state: operationalIncidentLedger.state,
      ready: operationalIncidentLedger.ready,
      nextAction: operationalIncidentLedger.nextAction,
      counters: operationalIncidentLedger.counters,
      blockedKeys: operationalIncidentLedger.clientPatch.packageOperationalBlockedKeys,
      reviewKeys: operationalIncidentLedger.clientPatch.packageOperationalReviewKeys,
      exportId: packageOperationalHealthExport.id,
      exportState: packageOperationalHealthExport.state,
      exportReady: packageOperationalHealthExport.exportReady,
      exportNextAction: packageOperationalHealthExport.nextAction,
      blockedOperationIds: packageOperationalHealthExport.blockedOperationIds,
      reviewOperationIds: packageOperationalHealthExport.reviewOperationIds,
    },
    userVisiblePreview: previewContract.preview,
    acceptance: {
      ...previewContract.acceptance,
      lifecycleSettingsAdoption,
      lifecycleOperatorOverride,
      lifecycleCommandDispatch,
      releaseAcceptance: releaseAcceptanceContract,
      operatorReleaseChecklist,
      providerIntegration: providerIntegrationContract,
      providerSyncAcceptance: providerSyncAcceptanceContract,
      providerReadinessExport,
      tenantCapabilityBoundary,
      tenantPermissionReplayLedger,
    },
    clientHandoff: providerClientHandoff,
    runtimeBoundaryHandoff: runtimeBoundaryRelease,
    truthBoundary: {
      product: "mailchimp",
      generatedBy: "package-manifest-compiler",
      reportsExternalState: ast.operations.some((operation) => operation.truthBoundary.externalState),
      evidenceRequired: ast.operations.some((operation) => operation.truthBoundary.evidenceRequired),
    },
  };
  return {
    ast,
    descriptor: packageDescriptor,
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}
