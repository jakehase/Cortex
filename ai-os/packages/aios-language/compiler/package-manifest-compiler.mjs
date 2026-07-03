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

function buildProviderClientHandoffContract(ast, compiledOperations, lifecycleControls, syncServiceContract, previewContract) {
  const releaseGate = lifecycleControls.releaseGate ?? {};
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
    ...operationRows.filter((row) => !row.statusCommandId).map((row) => `missing-status-command:${row.operationId}`),
    ...operationRows.filter((row) => !row.idempotencyKey).map((row) => `missing-idempotency-key:${row.operationId}`),
  ];
  const reviewReasons = [
    ...(previewContract.status === "review" ? ["package-preview-review"] : []),
    ...(releaseGate.state === "review" ? [`lifecycle-review-${releaseGate.gateReason ?? "required"}`] : []),
    ...(releaseGate.state === "scheduled" ? ["waiting-for-release-schedule"] : []),
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
    blockers: blockedReasons,
    reviewReasons,
    digest: stableId("handoffdigest", contractScope),
  };
}

function handoffBlockerAction(reason) {
  if (String(reason).startsWith("missing-status-command")) return "repair-adapter-status-contracts";
  if (String(reason).startsWith("missing-idempotency-key")) return "declare-operation-idempotency";
  if (String(reason).startsWith("lifecycle-disabled")) return "enable-package-lifecycle";
  if (String(reason).startsWith("lifecycle-")) return "repair-lifecycle-release-gate";
  if (String(reason).startsWith("package-preview")) return "repair-package-preview";
  return "review-client-handoff";
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
    metadata: { product: "mailchimp", sourceFormat: typeof source === "string" ? "text" : "object" },
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
  const syncServiceContract = buildSyncServiceContract(ast, compiledOperations);
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
  );
  const releaseAcceptanceContract = buildLifecycleReleaseAcceptanceContract(
    ast,
    compiledOperations,
    lifecycleControls,
    syncServiceContract,
    previewContract,
    providerClientHandoff,
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
    },
    syncServiceContract,
    providerClientHandoff,
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
      releaseAcceptance: releaseAcceptanceContract,
    },
    releaseAcceptanceContract,
    validationSummary: previewContract.validationSummary,
    userVisiblePreview: previewContract.preview,
    acceptance: {
      ...previewContract.acceptance,
      releaseAcceptance: releaseAcceptanceContract,
    },
    clientHandoff: providerClientHandoff,
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
