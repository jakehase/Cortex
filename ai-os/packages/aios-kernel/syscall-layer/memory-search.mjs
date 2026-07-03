export const surfaceId = "aios_syscall-layer_memory-search_026";
export const surfaceGroup = "syscall-layer";
export const surfaceName = "memory-search";

const SCHEMA_VERSION = 1;
const DEFAULT_STATUS = "idle";
const DEFAULT_TENANT_ID = "hosted-kernel";
const DEFAULT_WORKSPACE_ID = "default";
const REPORTING_HISTORY_LIMIT = 16;
const EXPORT_SAMPLE_LIMIT = 8;
const QUERY_RESULT_LIMIT = 10;
const QUERY_TERM_LIMIT = 12;
const QUERY_EXCERPT_LIMIT = 160;
const PROVIDER_OUTBOX_LIMIT = 32;
const CLIENT_KNOWN_OUTBOX_LIMIT = 16;
const PROVIDER_RETRY_BASE_MS = 500;
const PROVIDER_RETRY_MAX_MS = 60000;
const PROVIDER_PENDING_STALE_MS = 5 * 60 * 1000;
const PROVIDER_PENDING_FAILED_MS = 30 * 60 * 1000;
const MIN_FRAGMENT_BYTES = 32;
const DEFAULT_MAX_FRAGMENT_BYTES = 8192;
const DEFAULT_MAX_WORKSPACE_FRAGMENTS = 250;
const MIN_SCHEDULE_INTERVAL_MINUTES = 5;
const MAX_SCHEDULE_INTERVAL_MINUTES = 1440;
const STATUS_ORDER = ["idle", "restored", "searching", "degraded", "failed"];
const COMMANDS = new Set(["restore", "index-fragment", "query", "clear", "configure", "enable", "disable", "schedule", "ack-provider-dispatch"]);
const PROVIDER_MODES = new Set(["local", "hosted", "external"]);
const PROVIDER_CAPABILITIES = new Set(["restore", "query", "index-fragment", "clear", "schedule", "sync-metadata", "external-handoff"]);
const PROVIDER_RESULT_STATUSES = new Set(["accepted", "completed", "deferred", "failed"]);
const CAPABILITY_COMMANDS = {
  restore: "restore",
  query: "query",
  "index-fragment": "index-fragment",
  clear: "clear",
  schedule: "schedule"
};
const RETRYABLE_FAILURES = new Set(["missing-fragment-text", "empty-query", "degraded-persistence", "invalid-settings", "provider-dispatch-not-found", "provider-result-invalid"]);
const TERMINAL_FAILURES = new Set(["unsupported-command", "permission-denied", "scope-boundary-violation", "workspace-policy-violation", "surface-disabled", "provider-capability-unavailable"]);
const HEALTH_LEVELS = {
  healthy: "healthy",
  degraded: "degraded",
  failed: "failed"
};
const HOSTED_KERNEL_ROUTE = {
  routeId: "hosted-kernel.memory-search",
  transport: "kernel-syscall",
  protocol: "memory-search.command.v1",
  ackRequired: false
};
const DEFAULT_PROVIDER_CONTRACT = {
  providerId: "kernel-local-memory-search",
  service: "memory-search",
  mode: "local",
  endpointId: "in-process-index",
  capabilities: ["restore", "query", "index-fragment", "clear", "schedule", "sync-metadata"],
  sync: {
    cursor: "",
    generation: 0,
    syncedAt: ""
  },
  externalHandoff: {
    required: false,
    reason: "",
    endpointId: ""
  }
};
const DEFAULT_SETTINGS = {
  enabled: true,
  queryEnabled: true,
  indexingEnabled: true,
  schedule: {
    enabled: false,
    mode: "manual",
    intervalMinutes: 0,
    nextRunAt: ""
  },
  updatedAt: "",
  updatedBy: "system"
};
const DEFAULT_WORKSPACE_POLICY = {
  maxFragments: DEFAULT_MAX_WORKSPACE_FRAGMENTS,
  maxFragmentBytes: DEFAULT_MAX_FRAGMENT_BYTES,
  allowCrossWorkspaceQuery: false,
  allowClear: true,
  locked: false,
  roleGrants: {
    restore: ["reader", "writer", "admin"],
    query: ["reader", "writer", "admin"],
    "index-fragment": ["writer", "admin"],
    clear: ["admin"],
    configure: ["admin"],
    enable: ["admin"],
    disable: ["admin"],
    schedule: ["admin"],
    "ack-provider-dispatch": ["admin"]
  },
  auditHandoffRequired: true
};
const ROLE_PERMISSIONS = {
  reader: new Set(["restore", "query"]),
  writer: new Set(["restore", "query", "index-fragment"]),
  admin: new Set(["restore", "query", "index-fragment", "clear", "configure", "enable", "disable", "schedule", "ack-provider-dispatch"])
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clampInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function clampBoundedInteger(value, fallback, min, max) {
  const next = clampInteger(value, fallback);
  return Math.min(max, Math.max(min, next));
}

function stableBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function stableIsoTime(value, fallback = "") {
  const text = stableText(value);
  return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : fallback;
}

function normalizeActor(input = {}) {
  const principal = isRecord(input.principal) ? input.principal : {};
  const actor = isRecord(input.actor) ? input.actor : principal;
  const role = ROLE_PERMISSIONS[actor.role] ? actor.role : "reader";
  const tenantId = stableText(actor.tenantId, DEFAULT_TENANT_ID);
  const workspaceId = stableText(actor.workspaceId, DEFAULT_WORKSPACE_ID);

  return {
    actorId: stableText(actor.actorId, stableText(actor.id, "anonymous")),
    tenantId,
    workspaceId,
    role,
    permissions: [...ROLE_PERMISSIONS[role]],
    scopeKey: `${tenantId}/${workspaceId}`
  };
}

function commandScope(commandInput, actor) {
  const record = isRecord(commandInput.scope) ? commandInput.scope : commandInput;
  return {
    tenantId: stableText(record.tenantId, actor.tenantId),
    workspaceId: stableText(record.workspaceId, actor.workspaceId)
  };
}

function isActorScope(scope, actor) {
  return scope.tenantId === actor.tenantId && scope.workspaceId === actor.workspaceId;
}

function hasCommandPermission(actor, command) {
  return ROLE_PERMISSIONS[actor.role]?.has(command) === true;
}

function scopedCommandKey(actor, commandId) {
  return `${actor.tenantId}/${actor.workspaceId}/${commandId}`;
}

function scopeKeyFor(scope) {
  return `${stableText(scope.tenantId, DEFAULT_TENANT_ID)}/${stableText(scope.workspaceId, DEFAULT_WORKSPACE_ID)}`;
}

function normalizeRoleList(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  const roles = source.map((role) => stableText(role)).filter((role) => ROLE_PERMISSIONS[role]);
  return [...new Set(roles)].length ? [...new Set(roles)] : [...fallback];
}

function normalizeWorkspacePolicy(input = {}, scope = {}) {
  const record = isRecord(input) ? input : {};
  const grants = isRecord(record.roleGrants) ? record.roleGrants : {};
  const roleGrants = Object.fromEntries(
    Object.entries(DEFAULT_WORKSPACE_POLICY.roleGrants).map(([command, fallbackRoles]) => [
      command,
      normalizeRoleList(grants[command], fallbackRoles)
    ])
  );
  const maxFragmentBytes = clampBoundedInteger(
    record.maxFragmentBytes,
    DEFAULT_WORKSPACE_POLICY.maxFragmentBytes,
    MIN_FRAGMENT_BYTES,
    DEFAULT_MAX_FRAGMENT_BYTES * 8
  );

  return {
    schema: "memory-search.workspace-policy.v1",
    tenantId: stableText(record.tenantId, stableText(scope.tenantId, DEFAULT_TENANT_ID)),
    workspaceId: stableText(record.workspaceId, stableText(scope.workspaceId, DEFAULT_WORKSPACE_ID)),
    maxFragments: clampBoundedInteger(record.maxFragments, DEFAULT_WORKSPACE_POLICY.maxFragments, 1, DEFAULT_MAX_WORKSPACE_FRAGMENTS * 4),
    maxFragmentBytes,
    allowCrossWorkspaceQuery: stableBoolean(record.allowCrossWorkspaceQuery, DEFAULT_WORKSPACE_POLICY.allowCrossWorkspaceQuery),
    allowClear: stableBoolean(record.allowClear, DEFAULT_WORKSPACE_POLICY.allowClear),
    locked: stableBoolean(record.locked, DEFAULT_WORKSPACE_POLICY.locked),
    roleGrants,
    auditHandoffRequired: stableBoolean(record.auditHandoffRequired, DEFAULT_WORKSPACE_POLICY.auditHandoffRequired),
    updatedAt: stableIsoTime(record.updatedAt, ""),
    updatedBy: stableText(record.updatedBy)
  };
}

function normalizeWorkspacePolicies(value = {}) {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, policy]) => {
        const [tenantId = DEFAULT_TENANT_ID, workspaceId = DEFAULT_WORKSPACE_ID] = key.split("/");
        const normalized = normalizeWorkspacePolicy(policy, { tenantId, workspaceId });
        return [scopeKeyFor(normalized), normalized];
      })
      .filter(([key]) => key.includes("/"))
  );
}

function workspacePolicyForScope(state, scope) {
  const key = scopeKeyFor(scope);
  return state.workspacePolicies?.[key] || normalizeWorkspacePolicy({}, scope);
}

function workspaceBoundaryDecision(state, command, commandInput, scope, actor) {
  const policy = workspacePolicyForScope(state, scope);
  const scopedFragments = fragmentsForScope(state, scope);
  const fragmentRecord = isRecord(commandInput.fragment) ? commandInput.fragment : {};
  const fragmentText = stableText(fragmentRecord.text);
  const fragmentId = stableText(fragmentRecord.id);
  const replacesExisting = fragmentId
    ? scopedFragments.some((fragment) => fragment.id === fragmentId)
    : false;
  const projectedFragmentCount = command === "index-fragment" && !replacesExisting
    ? scopedFragments.length + 1
    : scopedFragments.length;
  const requestedCrossWorkspace = stableBoolean(commandInput.crossWorkspace, false) || stableBoolean(commandInput.includeTenantWide, false);
  const grantedRoles = policy.roleGrants[command] || [];
  const violations = [];

  if (!grantedRoles.includes(actor.role)) {
    violations.push({
      code: "memory-search/workspace-role-denied",
      reason: "role-not-granted",
      action: `Grant ${actor.role} for ${command} in workspace policy before retrying.`
    });
  }
  if (policy.locked && ["index-fragment", "clear", "configure", "enable", "disable", "schedule"].includes(command)) {
    violations.push({
      code: "memory-search/workspace-locked",
      reason: "workspace-locked",
      action: "Unlock the workspace policy before issuing mutating memory-search commands."
    });
  }
  if (command === "clear" && !policy.allowClear) {
    violations.push({
      code: "memory-search/workspace-clear-disabled",
      reason: "clear-disabled",
      action: "Enable allowClear in the workspace policy or use per-fragment retention outside this syscall."
    });
  }
  if (command === "query" && requestedCrossWorkspace && !policy.allowCrossWorkspaceQuery) {
    violations.push({
      code: "memory-search/cross-workspace-query-denied",
      reason: "cross-workspace-query-denied",
      action: "Query only the actor workspace or enable allowCrossWorkspaceQuery for this workspace policy."
    });
  }
  if (command === "index-fragment" && projectedFragmentCount > policy.maxFragments) {
    violations.push({
      code: "memory-search/workspace-fragment-limit",
      reason: "fragment-limit",
      limit: policy.maxFragments,
      projected: projectedFragmentCount,
      action: "Clear old workspace fragments or raise maxFragments before indexing new content."
    });
  }
  if (command === "index-fragment" && fragmentText && fragmentText.length > policy.maxFragmentBytes) {
    violations.push({
      code: "memory-search/workspace-fragment-bytes-limit",
      reason: "fragment-too-large",
      limit: policy.maxFragmentBytes,
      actual: fragmentText.length,
      action: "Split the memory fragment or raise maxFragmentBytes before indexing."
    });
  }

  return {
    schema: "memory-search.workspace-boundary-decision.v1",
    allowed: violations.length === 0,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    scopeKey: scopeKeyFor(scope),
    command,
    actorRole: actor.role,
    policy: {
      maxFragments: policy.maxFragments,
      maxFragmentBytes: policy.maxFragmentBytes,
      allowCrossWorkspaceQuery: policy.allowCrossWorkspaceQuery,
      allowClear: policy.allowClear,
      locked: policy.locked,
      auditHandoffRequired: policy.auditHandoffRequired,
      grantedRoles
    },
    currentFragmentCount: scopedFragments.length,
    projectedFragmentCount,
    requestedCrossWorkspace,
    violations
  };
}

function normalizeFragment(fragment, index, scope = {}) {
  const record = isRecord(fragment) ? fragment : {};
  const id = stableText(record.id, `fragment-${index + 1}`);
  const text = stableText(record.text);
  const tags = Array.isArray(record.tags)
    ? record.tags.map((tag) => stableText(tag)).filter(Boolean).slice(0, 12)
    : [];

  return {
    id,
    text,
    tags,
    tenantId: stableText(record.tenantId, stableText(scope.tenantId, DEFAULT_TENANT_ID)),
    workspaceId: stableText(record.workspaceId, stableText(scope.workspaceId, DEFAULT_WORKSPACE_ID)),
    revision: clampInteger(record.revision, 0),
    indexedAt: stableText(record.indexedAt)
  };
}

function normalizeJournalEntry(entry, index) {
  const record = isRecord(entry) ? entry : {};
  const commandId = stableText(record.commandId, `legacy-${index + 1}`);
  const command = COMMANDS.has(record.command) ? record.command : "restore";
  const tenantId = stableText(record.tenantId, DEFAULT_TENANT_ID);
  const workspaceId = stableText(record.workspaceId, DEFAULT_WORKSPACE_ID);
  const actorRole = ROLE_PERMISSIONS[record.actorRole] ? record.actorRole : "reader";

  return {
    commandId,
    commandKey: stableText(record.commandKey, `${tenantId}/${workspaceId}/${commandId}`),
    command,
    status: record.status === "rejected" ? "rejected" : "applied",
    at: stableText(record.at),
    reason: stableText(record.reason),
    tenantId,
    workspaceId,
    actorId: stableText(record.actorId, "unknown"),
    actorRole
  };
}

function commandFailureContract(reason, command, commandId, scope, actor, now, details = {}) {
  const retryable = RETRYABLE_FAILURES.has(reason);
  const terminal = TERMINAL_FAILURES.has(reason);
  const attempts = clampInteger(details.attempts, 0);
  const retryAfterMs = retryable ? Math.min(30000, 250 * 2 ** Math.min(attempts, 6)) : 0;
  const actionByReason = {
    "unsupported-command": "Use one of restore, index-fragment, query, clear, configure, enable, disable, schedule, or ack-provider-dispatch.",
    "permission-denied": "Reissue with an actor role permitted for this command.",
    "scope-boundary-violation": "Use the actor tenant/workspace scope or switch actor context before retrying.",
    "workspace-policy-violation": "Reissue within the workspace policy role, quota, lock, and cross-workspace query boundaries.",
    "missing-fragment-text": "Provide fragment.text before indexing memory content.",
    "empty-query": "Provide at least one searchable query token.",
    "degraded-persistence": "Persist the returned normalized state before accepting write commands.",
    "invalid-settings": "Correct lifecycle settings and scheduling values before retrying.",
    "surface-disabled": "Enable memory-search before issuing query, indexing, or clear commands.",
    "provider-capability-unavailable": "Configure a memory-search provider that advertises the required command capability.",
    "provider-dispatch-not-found": "Replay with an outboxId or provider commandId that is still pending for this actor scope.",
    "provider-result-invalid": "Replay with a providerResult containing status, providerId, and the dispatched command id."
  };

  return {
    code: `memory-search/${reason}`,
    reason,
    command,
    commandId,
    retryable,
    terminal,
    retryAfterMs,
    severity: terminal ? "error" : "warning",
    degradedMode: retryable && !terminal,
    actionable: actionByReason[reason] || "Inspect command proof and retry with corrected input.",
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    actorId: actor.actorId,
    actorRole: actor.role,
    at: now
  };
}

function normalizeProviderCapabilities(value, fallback = DEFAULT_PROVIDER_CONTRACT.capabilities) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map((capability) => stableText(capability)).filter((capability) => PROVIDER_CAPABILITIES.has(capability)))];
}

function normalizeProviderContract(input = {}, now = "", actor = normalizeActor()) {
  const record = isRecord(input) ? input : {};
  const mode = PROVIDER_MODES.has(record.mode) ? record.mode : DEFAULT_PROVIDER_CONTRACT.mode;
  const capabilities = normalizeProviderCapabilities(record.capabilities);
  const endpointId = stableText(record.endpointId, mode === "local" ? DEFAULT_PROVIDER_CONTRACT.endpointId : "");
  const providerId = stableText(record.providerId, mode === "local" ? DEFAULT_PROVIDER_CONTRACT.providerId : `${mode}-memory-search`);
  const externalRequired = mode === "external" || stableBoolean(record.externalHandoff?.required, false);
  const sync = isRecord(record.sync) ? record.sync : {};
  const handoff = isRecord(record.externalHandoff) ? record.externalHandoff : {};
  const issues = [];

  if (mode !== "local" && !endpointId) {
    issues.push({
      code: "memory-search/provider-endpoint-missing",
      severity: "warning",
      action: "Set providerContract.endpointId before routing hosted or external memory-search calls."
    });
  }
  if (mode === "external" && !capabilities.includes("external-handoff")) {
    capabilities.push("external-handoff");
  }
  if (!capabilities.includes("sync-metadata")) {
    issues.push({
      code: "memory-search/provider-sync-metadata-unavailable",
      severity: "info",
      action: "Provider results will not include durable sync cursor metadata."
    });
  }

  return {
    providerId,
    service: stableText(record.service, DEFAULT_PROVIDER_CONTRACT.service),
    mode,
    endpointId,
    capabilities,
    negotiatedAt: stableIsoTime(record.negotiatedAt, now),
    negotiatedBy: stableText(record.negotiatedBy, actor.actorId),
    sync: {
      cursor: stableText(sync.cursor),
      generation: clampInteger(sync.generation, 0),
      syncedAt: stableIsoTime(sync.syncedAt, "")
    },
    externalHandoff: {
      required: externalRequired,
      reason: externalRequired ? stableText(handoff.reason, "provider-executes-search") : "",
      endpointId: externalRequired ? stableText(handoff.endpointId, endpointId) : ""
    },
    issues
  };
}

function providerSupportsCommand(providerContract, command) {
  const requiredCapability = CAPABILITY_COMMANDS[command];
  return !requiredCapability || providerContract.capabilities.includes(requiredCapability);
}

function buildExternalHandoff(providerContract, command, commandId, scope, actor, now, payload = {}) {
  const handoffId = `${providerContract.providerId}:${scope.tenantId}/${scope.workspaceId}:${commandId}`;
  return {
    handoffId,
    service: providerContract.service,
    providerId: providerContract.providerId,
    endpointId: providerContract.externalHandoff.endpointId || providerContract.endpointId,
    command,
    commandId,
    required: true,
    reason: providerContract.externalHandoff.reason || "provider-executes-search",
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    actorId: actor.actorId,
    at: now,
    payload
  };
}

function buildHostedKernelInvocation(providerContract, command, commandId, scope, actor, now, payload = {}) {
  if (providerContract.mode !== "hosted") return null;

  return {
    invocationId: `${providerContract.providerId}:${commandId}:${providerContract.sync.generation}`,
    ...HOSTED_KERNEL_ROUTE,
    service: providerContract.service,
    providerId: providerContract.providerId,
    endpointId: providerContract.endpointId,
    command,
    commandId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    actorId: actor.actorId,
    at: now,
    payload,
    resultContract: {
      schema: "memory-search.provider-result.v1",
      statusField: "status",
      cursorField: "sync.cursor",
      generationField: "sync.generation",
      resultIdsField: command === "query" ? "matches[].fragmentId" : "",
      requiredFields: ["status", "providerId", "commandId"]
    }
  };
}

function providerExecutionSnapshot(providerContract) {
  const transport = providerContract.externalHandoff.required
    ? "external-handoff"
    : providerContract.mode === "hosted"
      ? HOSTED_KERNEL_ROUTE.transport
      : "in-process";

  return {
    mode: providerContract.mode,
    providerId: providerContract.providerId,
    endpointId: providerContract.endpointId,
    routeId: providerContract.mode === "hosted" ? HOSTED_KERNEL_ROUTE.routeId : "",
    transport,
    externalHandoffRequired: providerContract.externalHandoff.required,
    syncGeneration: providerContract.sync.generation,
    syncCursor: providerContract.sync.cursor
  };
}

function buildProviderServiceContract(state, actor, now, commandInput = null) {
  const providerContract = state.providerContract || normalizeProviderContract({}, now, actor);
  const command = stableText(commandInput?.command, "restore");
  const scopedPending = providerOutboxForScope(state, actor);
  const pendingGenerations = scopedPending.map((entry) => clampInteger(entry.syncGeneration, 0));
  const highWatermarkGeneration = pendingGenerations.length
    ? Math.max(providerContract.sync.generation, ...pendingGenerations)
    : providerContract.sync.generation;
  const commandCapabilities = Object.entries(CAPABILITY_COMMANDS).map(([commandName, capability]) => ({
    command: commandName,
    capability,
    supported: providerContract.capabilities.includes(capability),
    routable: providerContract.capabilities.includes(capability) && (
      providerContract.mode === "local" || Boolean(providerContract.endpointId || providerContract.externalHandoff.endpointId)
    )
  }));
  const unavailableCommands = commandCapabilities
    .filter((entry) => !entry.supported)
    .map((entry) => entry.command);
  const requestedCapability = CAPABILITY_COMMANDS[command] || "";
  const latestPending = scopedPending.at(-1) || null;
  const externalEndpointId = providerContract.externalHandoff.endpointId || providerContract.endpointId;
  const syncMetadataAvailable = providerContract.capabilities.includes("sync-metadata");
  const externalHandoffAvailable = providerContract.capabilities.includes("external-handoff") || providerContract.externalHandoff.required;
  const routeReady = providerContract.mode === "local" || Boolean(providerContract.endpointId || externalEndpointId);
  const negotiationIssues = [
    ...providerContract.issues,
    ...(routeReady
      ? []
      : [{
          code: "memory-search/provider-route-unavailable",
          severity: "error",
          action: "Set providerContract.endpointId or externalHandoff.endpointId before dispatching provider-backed commands."
        }]),
    ...(requestedCapability && !providerContract.capabilities.includes(requestedCapability)
      ? [{
          code: "memory-search/requested-provider-capability-missing",
          severity: "error",
          command,
          capability: requestedCapability,
          action: `Advertise ${requestedCapability} before routing ${command}.`
        }]
      : []),
    ...(providerContract.externalHandoff.required && !externalHandoffAvailable
      ? [{
          code: "memory-search/external-handoff-capability-missing",
          severity: "error",
          action: "External providers must advertise external-handoff capability."
        }]
      : [])
  ];

  return {
    schema: "memory-search.provider-service-contract.v1",
    generatedAt: now,
    scopeKey: actor.scopeKey,
    provider: {
      providerId: providerContract.providerId,
      service: providerContract.service,
      mode: providerContract.mode,
      endpointId: providerContract.endpointId,
      negotiatedAt: providerContract.negotiatedAt,
      negotiatedBy: providerContract.negotiatedBy
    },
    negotiation: {
      accepted: negotiationIssues.every((issue) => issue.severity !== "error"),
      requestedCommand: command,
      requestedCapability,
      capabilities: providerContract.capabilities,
      commandCapabilities,
      unavailableCommands,
      issues: negotiationIssues
    },
    syncMetadata: {
      available: syncMetadataAvailable,
      cursor: providerContract.sync.cursor,
      generation: providerContract.sync.generation,
      highWatermarkGeneration,
      syncedAt: providerContract.sync.syncedAt,
      pendingGenerationCount: pendingGenerations.length,
      pendingGenerations: pendingGenerations.slice(-EXPORT_SAMPLE_LIMIT)
    },
    route: {
      routeId: providerContract.mode === "hosted" ? HOSTED_KERNEL_ROUTE.routeId : "",
      transport: providerExecutionSnapshot(providerContract).transport,
      protocol: providerContract.mode === "hosted" ? HOSTED_KERNEL_ROUTE.protocol : "",
      endpointId: providerContract.externalHandoff.required ? externalEndpointId : providerContract.endpointId,
      ready: routeReady,
      ackRequired: providerContract.externalHandoff.required || scopedPending.length > 0
    },
    externalHandoff: {
      required: providerContract.externalHandoff.required,
      available: externalHandoffAvailable,
      reason: providerContract.externalHandoff.reason,
      endpointId: externalEndpointId,
      pendingCount: scopedPending.filter((entry) => entry.dispatchType === "external-handoff").length,
      latestHandoffId: latestPending?.dispatchType === "external-handoff" ? latestPending.dispatch?.handoffId || latestPending.outboxId : ""
    },
    pendingAck: latestPending
      ? {
          outboxId: latestPending.outboxId,
          dispatchType: latestPending.dispatchType,
          command: latestPending.command,
          commandId: latestPending.commandId,
          queuedAt: latestPending.queuedAt,
          providerId: latestPending.providerId,
          endpointId: latestPending.endpointId,
          ackCommand: {
            command: "ack-provider-dispatch",
            outboxId: latestPending.outboxId,
            providerCommandId: latestPending.commandId,
            scope: {
              tenantId: actor.tenantId,
              workspaceId: actor.workspaceId
            }
          }
        }
      : null
  };
}

function normalizeProviderOutboxEntry(entry, index) {
  const record = isRecord(entry) ? entry : {};
  const dispatch = isRecord(record.dispatch) ? record.dispatch : {};
  const providerResult = isRecord(record.providerResult) ? record.providerResult : {};
  const dispatchType = record.dispatchType === "external-handoff" ? "external-handoff" : "hosted-kernel";
  const command = COMMANDS.has(record.command) ? record.command : stableText(dispatch.command, "query");
  const tenantId = stableText(record.tenantId, stableText(dispatch.tenantId, DEFAULT_TENANT_ID));
  const workspaceId = stableText(record.workspaceId, stableText(dispatch.workspaceId, DEFAULT_WORKSPACE_ID));
  const commandId = stableText(record.commandId, stableText(dispatch.commandId, `provider-${index + 1}`));
  const status = record.status === "acked" || providerResult.status === "completed" ? "acked" : "pending";

  return {
    outboxId: stableText(record.outboxId, `${dispatchType}:${tenantId}/${workspaceId}:${commandId}`),
    dispatchType,
    status,
    command,
    commandId,
    tenantId,
    workspaceId,
    providerId: stableText(record.providerId, stableText(dispatch.providerId)),
    endpointId: stableText(record.endpointId, stableText(dispatch.endpointId)),
    queuedAt: stableIsoTime(record.queuedAt, stableIsoTime(dispatch.at, "")),
    ackedAt: status === "acked" ? stableIsoTime(record.ackedAt, stableIsoTime(providerResult.receivedAt, "")) : "",
    syncGeneration: clampInteger(record.syncGeneration, clampInteger(dispatch.sync?.generation, 0)),
    syncCursor: stableText(record.syncCursor, stableText(dispatch.sync?.cursor)),
    providerResult: status === "acked" ? providerResult : null,
    dispatch
  };
}

function normalizeProviderOutbox(value = []) {
  if (!Array.isArray(value)) return [];

  const entriesById = new Map();
  for (const entry of value.map(normalizeProviderOutboxEntry).filter((entry) => entry.providerId && entry.commandId)) {
    const existing = entriesById.get(entry.outboxId);
    if (!existing || (existing.status === "pending" && entry.status === "acked")) {
      entriesById.set(entry.outboxId, entry);
    }
  }

  return [...entriesById.values()].slice(-PROVIDER_OUTBOX_LIMIT);
}

function normalizeProviderResult(input = {}, fallback = {}, now = "") {
  const record = isRecord(input) ? input : {};
  const status = PROVIDER_RESULT_STATUSES.has(record.status) ? record.status : "";
  const resultIds = Array.isArray(record.resultIds)
    ? record.resultIds.map((id) => stableText(id)).filter(Boolean).slice(0, QUERY_RESULT_LIMIT)
    : Array.isArray(record.matches)
      ? record.matches.map((match) => stableText(isRecord(match) ? match.fragmentId : match)).filter(Boolean).slice(0, QUERY_RESULT_LIMIT)
      : [];
  const sync = isRecord(record.sync) ? record.sync : {};

  return {
    schema: "memory-search.provider-result.v1",
    status,
    providerId: stableText(record.providerId, fallback.providerId),
    endpointId: stableText(record.endpointId, fallback.endpointId),
    outboxId: stableText(record.outboxId, fallback.outboxId),
    commandId: stableText(record.commandId, fallback.commandId),
    command: stableText(record.command, fallback.command),
    receivedAt: stableIsoTime(record.receivedAt, now),
    resultIds,
    sync: {
      cursor: stableText(sync.cursor, stableText(record.syncCursor, fallback.syncCursor)),
      generation: clampInteger(sync.generation, clampInteger(record.syncGeneration, fallback.syncGeneration))
    },
    errorCode: stableText(record.errorCode, stableText(record.reason)),
    message: stableText(record.message)
  };
}

function providerDispatchMatchesResult(entry, result, scope) {
  if (entry.tenantId !== scope.tenantId || entry.workspaceId !== scope.workspaceId) return false;
  if (result.outboxId && entry.outboxId === result.outboxId) return true;
  if (result.commandId && entry.commandId === result.commandId && entry.providerId === result.providerId) return true;
  return false;
}

function acknowledgeProviderDispatch(state, providerResult, scope, now) {
  let matchedEntry = null;
  let alreadyAcked = false;
  const providerOutbox = (state.providerOutbox || []).map((entry) => {
    if (!providerDispatchMatchesResult(entry, providerResult, scope)) return entry;
    if (!matchedEntry) matchedEntry = entry;
    if (entry.status === "acked") {
      alreadyAcked = true;
      return entry;
    }
    return {
      ...entry,
      status: "acked",
      ackedAt: now,
      syncCursor: providerResult.sync.cursor || entry.syncCursor,
      syncGeneration: Math.max(entry.syncGeneration, providerResult.sync.generation),
      providerResult
    };
  });

  return { providerOutbox, matchedEntry, alreadyAcked };
}

function providerOutboxRecord(dispatchType, dispatch, state, now) {
  if (!isRecord(dispatch)) return null;
  const nextGeneration = state.generation + 1;
  const tenantId = stableText(dispatch.tenantId, DEFAULT_TENANT_ID);
  const workspaceId = stableText(dispatch.workspaceId, DEFAULT_WORKSPACE_ID);
  const commandId = stableText(dispatch.commandId, `${dispatch.command}:${nextGeneration}`);

  return {
    outboxId: `${dispatchType}:${tenantId}/${workspaceId}:${commandId}`,
    dispatchType,
    status: "pending",
    command: stableText(dispatch.command, "query"),
    commandId,
    tenantId,
    workspaceId,
    providerId: stableText(dispatch.providerId, state.providerContract.providerId),
    endpointId: stableText(dispatch.endpointId, state.providerContract.endpointId),
    queuedAt: now,
    ackedAt: "",
    syncGeneration: nextGeneration,
    syncCursor: stableText(state.providerContract.sync.cursor),
    dispatch: {
      ...dispatch,
      sync: {
        cursor: stableText(state.providerContract.sync.cursor),
        generation: nextGeneration,
        queuedAt: now
      }
    }
  };
}

function appendProviderOutbox(state, dispatchType, dispatch, now) {
  const entry = providerOutboxRecord(dispatchType, dispatch, state, now);
  return entry ? [...(state.providerOutbox || []), entry].slice(-PROVIDER_OUTBOX_LIMIT) : state.providerOutbox || [];
}

function providerOutboxForScope(state, actor) {
  return (state.providerOutbox || []).filter(
    (entry) => entry.tenantId === actor.tenantId && entry.workspaceId === actor.workspaceId && entry.status === "pending"
  );
}

function providerPendingAgeMs(entry, now) {
  const queuedAt = Date.parse(stableText(entry?.queuedAt));
  const nowMs = Date.parse(now);
  return Number.isNaN(queuedAt) || Number.isNaN(nowMs) ? 0 : Math.max(0, nowMs - queuedAt);
}

function providerRetryDelayMs(entry, ageMs) {
  const attemptSeed = Math.max(0, Math.floor(ageMs / PROVIDER_PENDING_STALE_MS));
  const generationSeed = clampInteger(entry?.syncGeneration, 0) % 4;
  return Math.min(PROVIDER_RETRY_MAX_MS, PROVIDER_RETRY_BASE_MS * 2 ** Math.min(attemptSeed + generationSeed, 7));
}

function providerPendingOperationHealth(state, actor, now) {
  const scopedPending = providerOutboxForScope(state, actor);
  const dispatches = scopedPending.map((entry) => {
    const ageMs = providerPendingAgeMs(entry, now);
    const stale = ageMs >= PROVIDER_PENDING_STALE_MS;
    const expired = ageMs >= PROVIDER_PENDING_FAILED_MS;
    const retryAfterMs = stale ? providerRetryDelayMs(entry, ageMs) : 0;

    return {
      outboxId: entry.outboxId,
      dispatchType: entry.dispatchType,
      command: entry.command,
      commandId: entry.commandId,
      providerId: entry.providerId,
      endpointId: entry.endpointId,
      queuedAt: entry.queuedAt,
      ageMs,
      stale,
      expired,
      retryable: stale && !expired,
      retryAfterMs,
      action: expired
        ? "Acknowledge a failed provider result or reissue the command after confirming provider status."
        : stale
          ? "Retry provider dispatch with the same commandId after retryAfterMs, then ack-provider-dispatch."
          : "Wait for provider result and acknowledge the outbox entry when it arrives."
    };
  });
  const expiredCount = dispatches.filter((entry) => entry.expired).length;
  const staleCount = dispatches.filter((entry) => entry.stale && !entry.expired).length;
  const nextRetryAfterMs = dispatches
    .filter((entry) => entry.retryable)
    .map((entry) => entry.retryAfterMs)
    .sort((left, right) => left - right)[0] || 0;

  return {
    schema: "memory-search.provider-operation-health.v1",
    generatedAt: now,
    pendingCount: scopedPending.length,
    staleCount,
    expiredCount,
    level: expiredCount > 0
      ? HEALTH_LEVELS.failed
      : staleCount > 0
        ? HEALTH_LEVELS.degraded
        : HEALTH_LEVELS.healthy,
    degradedMode: staleCount > 0 && expiredCount === 0,
    retryable: staleCount > 0 && expiredCount === 0,
    nextRetryAfterMs,
    staleAfterMs: PROVIDER_PENDING_STALE_MS,
    failAfterMs: PROVIDER_PENDING_FAILED_MS,
    guidance: expiredCount > 0
      ? "Provider dispatches exceeded the failure threshold; surface a failed provider state and require acknowledgement or replay."
      : staleCount > 0
        ? "Provider dispatches are stale; keep query results read-only and retry with backoff."
        : scopedPending.length > 0
          ? "Provider dispatches are pending within the healthy window."
          : "No provider dispatches are pending for this scope.",
    dispatches: dispatches.slice(0, EXPORT_SAMPLE_LIMIT)
  };
}

function normalizeQueryTerms(value) {
  const terms = stableText(value)
    .toLowerCase()
    .split(/[^a-z0-9_:-]+/i)
    .filter(Boolean);

  return [...new Set(terms)].slice(0, QUERY_TERM_LIMIT);
}

function fragmentExcerpt(fragment, terms) {
  const text = stableText(fragment.text);
  const lower = text.toLowerCase();
  const firstMatch = terms
    .map((term) => lower.indexOf(term))
    .filter((position) => position >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, firstMatch - 40);
  const excerpt = text.slice(start, start + QUERY_EXCERPT_LIMIT);
  return start > 0 ? `...${excerpt}` : excerpt;
}

function scoreFragment(fragment, terms) {
  const haystack = `${fragment.text} ${fragment.tags.join(" ")}`.toLowerCase();
  const tokens = new Set(haystack.split(/[^a-z0-9_:-]+/i).filter(Boolean));
  const tagTokens = new Set(fragment.tags.map((tag) => tag.toLowerCase()));
  const matchedTerms = terms.filter((term) => tokens.has(term) || haystack.includes(term));
  const score = matchedTerms.reduce((total, term) => {
    if (tagTokens.has(term)) return total + 3;
    if (tokens.has(term)) return total + 2;
    return total + 1;
  }, 0);

  return { score, matchedTerms };
}

function buildQueryResults(fragments, terms) {
  return fragments
    .map((fragment) => ({ fragment, ...scoreFragment(fragment, terms) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || right.fragment.revision - left.fragment.revision || left.fragment.id.localeCompare(right.fragment.id))
    .slice(0, QUERY_RESULT_LIMIT)
    .map((result, rank) => ({
      rank: rank + 1,
      fragmentId: result.fragment.id,
      score: result.score,
      matchedTerms: result.matchedTerms,
      revision: result.fragment.revision,
      indexedAt: result.fragment.indexedAt,
      tags: result.fragment.tags,
      excerpt: fragmentExcerpt(result.fragment, result.matchedTerms)
    }));
}

function nextScheduledRun(now, intervalMinutes) {
  const start = Date.parse(now);
  if (Number.isNaN(start) || intervalMinutes <= 0) return "";
  return new Date(start + intervalMinutes * 60 * 1000).toISOString();
}

function normalizeLifecycleSettings(input = {}, now = "", actor = normalizeActor()) {
  const record = isRecord(input) ? input : {};
  const priorSchedule = isRecord(record.schedule) ? record.schedule : {};
  const scheduleEnabled = stableBoolean(priorSchedule.enabled, DEFAULT_SETTINGS.schedule.enabled);
  const intervalMinutes = scheduleEnabled
    ? clampBoundedInteger(priorSchedule.intervalMinutes, MIN_SCHEDULE_INTERVAL_MINUTES, MIN_SCHEDULE_INTERVAL_MINUTES, MAX_SCHEDULE_INTERVAL_MINUTES)
    : 0;
  const mode = scheduleEnabled ? "interval" : stableText(priorSchedule.mode, DEFAULT_SETTINGS.schedule.mode);
  const normalizedMode = scheduleEnabled ? "interval" : mode === "disabled" ? "disabled" : "manual";
  const enabled = stableBoolean(record.enabled, DEFAULT_SETTINGS.enabled);

  return {
    enabled,
    queryEnabled: enabled && stableBoolean(record.queryEnabled, DEFAULT_SETTINGS.queryEnabled),
    indexingEnabled: enabled && stableBoolean(record.indexingEnabled, DEFAULT_SETTINGS.indexingEnabled),
    schedule: {
      enabled: enabled && scheduleEnabled,
      mode: enabled && scheduleEnabled ? "interval" : normalizedMode,
      intervalMinutes: enabled && scheduleEnabled ? intervalMinutes : 0,
      nextRunAt: enabled && scheduleEnabled
        ? stableIsoTime(priorSchedule.nextRunAt, nextScheduledRun(now, intervalMinutes))
        : ""
    },
    updatedAt: stableIsoTime(record.updatedAt, now),
    updatedBy: stableText(record.updatedBy, actor.actorId)
  };
}

function lifecycleSettingsFromCommand(current, commandInput, command, now, actor) {
  const patch = isRecord(commandInput.settings) ? commandInput.settings : {};
  const schedulePatch = isRecord(commandInput.schedule) ? commandInput.schedule : {};
  const merged = {
    ...current,
    ...patch,
    updatedAt: now,
    updatedBy: actor.actorId,
    schedule: {
      ...current.schedule,
      ...(isRecord(patch.schedule) ? patch.schedule : {}),
      ...schedulePatch
    }
  };

  if (command === "enable") {
    merged.enabled = true;
    merged.queryEnabled = true;
    merged.indexingEnabled = true;
    if (merged.schedule.mode === "disabled") merged.schedule.mode = "manual";
  }
  if (command === "disable") {
    merged.enabled = false;
    merged.queryEnabled = false;
    merged.indexingEnabled = false;
    merged.schedule = { ...merged.schedule, enabled: false, mode: "disabled", intervalMinutes: 0, nextRunAt: "" };
  }
  if (command === "schedule") {
    merged.schedule.enabled = stableBoolean(schedulePatch.enabled, true);
    if (schedulePatch.intervalMinutes !== undefined) merged.schedule.intervalMinutes = schedulePatch.intervalMinutes;
  }

  const issues = [];
  const wantsSchedule = stableBoolean(merged.schedule.enabled, false);
  const rawInterval = merged.schedule.intervalMinutes;
  if (wantsSchedule && (!Number.isSafeInteger(rawInterval) || rawInterval < MIN_SCHEDULE_INTERVAL_MINUTES || rawInterval > MAX_SCHEDULE_INTERVAL_MINUTES)) {
    issues.push({
      code: "memory-search/schedule-interval-out-of-range",
      severity: "warning",
      minMinutes: MIN_SCHEDULE_INTERVAL_MINUTES,
      maxMinutes: MAX_SCHEDULE_INTERVAL_MINUTES
    });
  }
  if (merged.enabled && merged.queryEnabled === false && merged.indexingEnabled === false) {
    issues.push({ code: "memory-search/no-enabled-capabilities", severity: "warning" });
  }

  return {
    settings: normalizeLifecycleSettings(merged, now, actor),
    issues
  };
}

function stateHealth(state, actor = null, now = "") {
  const lastRejected = [...state.journal].reverse().find((entry) => entry.status === "rejected");
  const recoveryIssues = Array.isArray(state.recovery?.issues) ? state.recovery.issues : [];
  const pendingProviderDispatches = (state.providerOutbox || []).filter((entry) => entry.status === "pending").length;
  const providerOperation = actor ? providerPendingOperationHealth(state, actor, now) : null;
  const degraded = state.status === "degraded" || recoveryIssues.some((issue) => issue.severity !== "info") || providerOperation?.level === HEALTH_LEVELS.degraded;
  const disabled = state.settings?.enabled === false;
  const failed = state.status === "failed" || providerOperation?.level === HEALTH_LEVELS.failed;
  const providerCanQuery = providerSupportsCommand(state.providerContract, "query");
  const providerCanIndex = providerSupportsCommand(state.providerContract, "index-fragment");
  const handoffRequired = state.providerContract.externalHandoff.required;

  return {
    level: failed ? HEALTH_LEVELS.failed : degraded ? HEALTH_LEVELS.degraded : HEALTH_LEVELS.healthy,
    mode: failed ? "failure-quarantined" : disabled ? "disabled" : degraded ? "read-only-degraded" : handoffRequired ? "external-handoff" : "normal",
    canQuery: !disabled && providerCanQuery && state.settings?.queryEnabled !== false && state.status !== "failed",
    canIndex: !disabled && providerCanIndex && state.settings?.indexingEnabled !== false && !degraded && state.status !== "failed",
    lastFailure: state.lastFailure || null,
    lastRejectedCommandId: lastRejected?.commandId || "",
    pendingProviderDispatches,
    providerOperation,
    recoveryIssueCount: recoveryIssues.length,
    guidance: failed
      ? providerOperation?.level === HEALTH_LEVELS.failed
        ? providerOperation.guidance
        : "Resolve the last failure before trusting memory-search writes."
      : disabled
        ? "Memory search is disabled; enable it before scoped queries or writes."
      : degraded
        ? providerOperation?.level === HEALTH_LEVELS.degraded
          ? providerOperation.guidance
          : "Queries remain available from normalized fragments; persist normalized state before writes."
        : handoffRequired
          ? "Memory-search commands will be handed to the configured external provider contract."
          : "Memory search is healthy for scoped reads and writes."
  };
}

function buildNextActionState(state, actor, now, health) {
  const settings = state.settings || normalizeLifecycleSettings({}, now, actor);
  const scheduleDue = settings.schedule.enabled && settings.schedule.nextRunAt && Date.parse(settings.schedule.nextRunAt) <= Date.parse(now);
  const scopedFragments = fragmentsForScope(state, actor);

  if (!settings.enabled) {
    return {
      action: "enable-memory-search",
      blocked: true,
      reason: "surface-disabled",
      command: "enable",
      scheduleDue: false,
      nextRunAt: ""
    };
  }
  if (health.level === HEALTH_LEVELS.failed) {
    return {
      action: "inspect-last-failure",
      blocked: true,
      reason: state.lastFailure?.reason || "failed",
      command: "restore",
      scheduleDue: false,
      nextRunAt: settings.schedule.nextRunAt
    };
  }
  if (health.mode === "read-only-degraded") {
    return {
      action: "persist-normalized-state",
      blocked: true,
      reason: "degraded-persistence",
      command: "restore",
      scheduleDue: false,
      nextRunAt: settings.schedule.nextRunAt
    };
  }
  if (scheduleDue && settings.indexingEnabled) {
    return {
      action: "run-scheduled-index",
      blocked: false,
      reason: "schedule-due",
      command: "index-fragment",
      scheduleDue: true,
      nextRunAt: settings.schedule.nextRunAt
    };
  }
  if (state.providerContract.externalHandoff.required && settings.queryEnabled) {
    return {
      action: "handoff-ready",
      blocked: false,
      reason: "external-provider",
      command: "query",
      scheduleDue: false,
      nextRunAt: settings.schedule.nextRunAt
    };
  }
  if (scopedFragments.length === 0 && settings.indexingEnabled) {
    return {
      action: "index-first-fragment",
      blocked: false,
      reason: "empty-scope",
      command: "index-fragment",
      scheduleDue: false,
      nextRunAt: settings.schedule.nextRunAt
    };
  }
  return {
    action: settings.queryEnabled ? "query-ready" : "enable-query-capability",
    blocked: settings.queryEnabled === false,
    reason: settings.queryEnabled ? "ready" : "query-disabled",
    command: settings.queryEnabled ? "query" : "configure",
    scheduleDue: false,
    nextRunAt: settings.schedule.nextRunAt
  };
}

function scheduleClockState(settings, now) {
  const schedule = isRecord(settings?.schedule) ? settings.schedule : DEFAULT_SETTINGS.schedule;
  const nowMs = Date.parse(now);
  const nextRunMs = Date.parse(schedule.nextRunAt);
  const enabled = stableBoolean(schedule.enabled, false);
  const hasNextRun = Boolean(enabled && schedule.nextRunAt && !Number.isNaN(nextRunMs));
  const due = hasNextRun && !Number.isNaN(nowMs) && nextRunMs <= nowMs;
  const minutesUntilRun = hasNextRun && !Number.isNaN(nowMs)
    ? Math.ceil((nextRunMs - nowMs) / 60000)
    : null;

  return {
    enabled,
    mode: enabled ? "interval" : stableText(schedule.mode, "manual"),
    intervalMinutes: enabled ? clampInteger(schedule.intervalMinutes, 0) : 0,
    nextRunAt: enabled ? stableText(schedule.nextRunAt) : "",
    hasNextRun,
    due,
    overdueMinutes: due ? Math.max(0, Math.floor((nowMs - nextRunMs) / 60000)) : 0,
    minutesUntilRun: minutesUntilRun === null ? null : Math.max(0, minutesUntilRun)
  };
}

function lifecycleControlPayloads(settings, scheduleClock) {
  const defaultIntervalMinutes = scheduleClock.intervalMinutes || settings.schedule.intervalMinutes || MIN_SCHEDULE_INTERVAL_MINUTES;
  return {
    enable: { command: "enable" },
    disable: { command: "disable" },
    configure: {
      command: "configure",
      settings: {
        enabled: settings.enabled,
        queryEnabled: settings.queryEnabled,
        indexingEnabled: settings.indexingEnabled,
        schedule: {
          enabled: settings.schedule.enabled,
          intervalMinutes: settings.schedule.enabled ? defaultIntervalMinutes : 0
        }
      }
    },
    schedule: {
      command: "schedule",
      schedule: {
        enabled: true,
        intervalMinutes: defaultIntervalMinutes
      }
    },
    pauseSchedule: {
      command: "schedule",
      schedule: { enabled: false }
    }
  };
}

function lifecycleMutationPreview(state, actor, now, health, controlName, commandInput) {
  const command = stableText(commandInput?.command, controlName === "pauseSchedule" ? "schedule" : controlName);
  const { settings: projectedSettings, issues: settingsIssues } = lifecycleSettingsFromCommand(
    state.settings,
    commandInput,
    command,
    now,
    actor
  );
  const projectedState = { ...state, settings: projectedSettings };
  const projectedHealth = stateHealth(projectedState, actor, now);
  const projectedNextAction = buildNextActionState(projectedState, actor, now, projectedHealth);
  const providerReady = command === "schedule" ? providerSupportsCommand(state.providerContract, "schedule") : true;
  const permissionReady = hasCommandPermission(actor, command);
  const scheduleClock = scheduleClockState(projectedSettings, now);
  const guardrails = [
    ...settingsIssues.map((issue) => ({
      ...issue,
      blocking: true,
      action: issue.action || "Correct lifecycle settings before applying this command."
    }))
  ];

  if (!permissionReady) {
    guardrails.push({
      code: "memory-search/lifecycle-permission-denied",
      severity: "error",
      blocking: true,
      command,
      action: `Use an actor role granted for ${command} before applying this lifecycle control.`
    });
  }
  if (!providerReady) {
    guardrails.push({
      code: "memory-search/lifecycle-provider-capability-missing",
      severity: "error",
      blocking: true,
      command,
      action: "Configure a provider with schedule capability before enabling or changing scheduling."
    });
  }
  if (health.level === HEALTH_LEVELS.failed && command !== "restore") {
    guardrails.push({
      code: "memory-search/lifecycle-state-failed",
      severity: "warning",
      blocking: false,
      action: "Surface lastFailure alongside this control so operators can restore before trusting writes."
    });
  }
  if (command === "disable" && providerOutboxForScope(state, actor).length > 0) {
    guardrails.push({
      code: "memory-search/lifecycle-disable-with-pending-provider-dispatches",
      severity: "warning",
      blocking: false,
      pendingProviderDispatches: providerOutboxForScope(state, actor).length,
      action: "Acknowledge pending provider dispatches after disabling so restart recovery does not stay searching."
    });
  }

  const blockingGuardrails = guardrails.filter((issue) => issue.blocking || issue.severity === "error");

  return {
    schema: "memory-search.lifecycle-mutation-preview.v1",
    control: controlName,
    command,
    allowed: blockingGuardrails.length === 0,
    disabledReason: blockingGuardrails[0]?.code?.replace("memory-search/", "") || "",
    payload: commandInput,
    guardrails,
    projectedSettings,
    scheduleTransition: {
      wasEnabled: state.settings.schedule.enabled,
      willBeEnabled: projectedSettings.schedule.enabled,
      previousNextRunAt: state.settings.schedule.nextRunAt,
      nextRunAt: projectedSettings.schedule.nextRunAt,
      intervalMinutes: projectedSettings.schedule.intervalMinutes,
      dueAfterApply: scheduleClock.due,
      minutesUntilRun: scheduleClock.minutesUntilRun
    },
    projectedNextAction: {
      action: projectedNextAction.action,
      command: projectedNextAction.command,
      blocked: projectedNextAction.blocked,
      reason: projectedNextAction.reason,
      scheduleDue: projectedNextAction.scheduleDue,
      nextRunAt: projectedNextAction.nextRunAt
    }
  };
}

function lifecycleMutationPlan(state, actor, now, health, payloads = lifecycleControlPayloads(state.settings, scheduleClockState(state.settings, now))) {
  return Object.fromEntries(
    Object.entries(payloads).map(([controlName, payload]) => [
      controlName,
      lifecycleMutationPreview(state, actor, now, health, controlName, payload)
    ])
  );
}

function buildLifecycleControlContract(state, actor, now, health = stateHealth(state), nextAction = null) {
  const settings = state.settings || normalizeLifecycleSettings({}, now, actor);
  const scheduleClock = scheduleClockState(settings, now);
  const resolvedNextAction = nextAction || buildNextActionState(state, actor, now, health);
  const providerCanSchedule = providerSupportsCommand(state.providerContract, "schedule");
  const providerCanQuery = providerSupportsCommand(state.providerContract, "query");
  const providerCanIndex = providerSupportsCommand(state.providerContract, "index-fragment");
  const canConfigure = hasCommandPermission(actor, "configure");
  const canSchedule = hasCommandPermission(actor, "schedule") && providerCanSchedule;
  const canEnable = hasCommandPermission(actor, "enable");
  const canDisable = hasCommandPermission(actor, "disable");
  const lifecycleIssues = [];
  const payloads = lifecycleControlPayloads(settings, scheduleClock);
  const mutationPlan = lifecycleMutationPlan(state, actor, now, health, payloads);

  if (settings.enabled && !settings.queryEnabled && !settings.indexingEnabled) {
    lifecycleIssues.push({
      code: "memory-search/no-enabled-capabilities",
      severity: "warning",
      action: "Enable query or indexing so memory-search can serve a product workflow."
    });
  }
  if (settings.schedule.enabled && !providerCanSchedule) {
    lifecycleIssues.push({
      code: "memory-search/schedule-provider-capability-missing",
      severity: "error",
      action: "Configure a provider with schedule capability before enabling interval scheduling."
    });
  }
  if (settings.schedule.enabled && !scheduleClock.hasNextRun) {
    lifecycleIssues.push({
      code: "memory-search/schedule-next-run-missing",
      severity: "warning",
      action: "Reissue the schedule command so nextRunAt can be normalized."
    });
  }
  if (health.level === HEALTH_LEVELS.failed) {
    lifecycleIssues.push({
      code: "memory-search/lifecycle-failed-state",
      severity: "error",
      action: "Inspect lastFailure and run restore before changing lifecycle controls."
    });
  }

  const disabledReasons = {
    enable: canEnable ? "" : "permission-denied",
    disable: canDisable ? "" : "permission-denied",
    configure: canConfigure ? "" : "permission-denied",
    schedule: !hasCommandPermission(actor, "schedule")
      ? "permission-denied"
      : providerCanSchedule
        ? ""
        : "provider-capability-unavailable",
    query: !settings.enabled || !settings.queryEnabled
      ? "query-disabled"
      : providerCanQuery
        ? ""
        : "provider-capability-unavailable",
    "index-fragment": !settings.enabled || !settings.indexingEnabled
      ? "indexing-disabled"
      : providerCanIndex && health.canIndex
        ? ""
        : health.canIndex
          ? "provider-capability-unavailable"
          : "health-blocked"
  };

  return {
    schema: "memory-search.lifecycle-controls.v1",
    generatedAt: now,
    actorRole: actor.role,
    enabled: settings.enabled,
    capabilities: {
      query: {
        enabled: settings.enabled && settings.queryEnabled,
        controllable: canConfigure || canEnable,
        providerReady: providerCanQuery,
        command: "query",
        disabledReason: disabledReasons.query
      },
      indexing: {
        enabled: settings.enabled && settings.indexingEnabled,
        controllable: canConfigure || canEnable,
        providerReady: providerCanIndex,
        command: "index-fragment",
        disabledReason: disabledReasons["index-fragment"]
      },
      scheduling: {
        enabled: scheduleClock.enabled,
        controllable: canSchedule,
        providerReady: providerCanSchedule,
        command: "schedule",
        disabledReason: disabledReasons.schedule
      }
    },
    commands: {
      enable: { allowed: canEnable && mutationPlan.enable.allowed, disabledReason: disabledReasons.enable || mutationPlan.enable.disabledReason, payload: payloads.enable },
      disable: { allowed: canDisable && mutationPlan.disable.allowed, disabledReason: disabledReasons.disable || mutationPlan.disable.disabledReason, payload: payloads.disable },
      configure: { allowed: canConfigure && mutationPlan.configure.allowed, disabledReason: disabledReasons.configure || mutationPlan.configure.disabledReason, payload: payloads.configure },
      schedule: {
        allowed: canSchedule && mutationPlan.schedule.allowed,
        disabledReason: disabledReasons.schedule || mutationPlan.schedule.disabledReason,
        payload: payloads.schedule
      },
      pauseSchedule: {
        allowed: canSchedule && scheduleClock.enabled && mutationPlan.pauseSchedule.allowed,
        disabledReason: scheduleClock.enabled ? disabledReasons.schedule || mutationPlan.pauseSchedule.disabledReason : "schedule-not-enabled",
        payload: payloads.pauseSchedule
      }
    },
    mutationPlan,
    settingsValidation: {
      schema: "memory-search.lifecycle-settings-validation.v1",
      valid: Object.values(mutationPlan).every((entry) => entry.allowed),
      invalidControls: Object.entries(mutationPlan)
        .filter(([, entry]) => !entry.allowed)
        .map(([control]) => control),
      scheduleInterval: {
        minMinutes: MIN_SCHEDULE_INTERVAL_MINUTES,
        maxMinutes: MAX_SCHEDULE_INTERVAL_MINUTES,
        currentMinutes: settings.schedule.intervalMinutes,
        normalizedMinutes: mutationPlan.schedule.projectedSettings.schedule.intervalMinutes
      }
    },
    schedule: scheduleClock,
    nextAction: {
      action: resolvedNextAction.action,
      command: resolvedNextAction.command,
      blocked: resolvedNextAction.blocked,
      reason: resolvedNextAction.reason,
      scheduleDue: resolvedNextAction.scheduleDue,
      nextRunAt: resolvedNextAction.nextRunAt
    },
    issues: lifecycleIssues,
    readyForLifecycleMutation: lifecycleIssues.every((issue) => issue.severity !== "error") && (canConfigure || canEnable || canDisable || canSchedule),
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy
  };
}

function validationIssueSource(issue = {}) {
  const code = stableText(issue.code);
  if (code.includes("provider")) return "provider";
  if (code.includes("workspace") || code.includes("boundary")) return "workspace-policy";
  if (code.includes("schedule") || code.includes("lifecycle")) return "lifecycle";
  if (code.includes("persistence") || code.includes("recovery")) return "recovery";
  if (code.includes("permission")) return "permission";
  return "command";
}

function validationIssueNextStep(issue = {}, actor = normalizeActor()) {
  const code = stableText(issue.code);
  const reason = stableText(issue.reason, code.replace("memory-search/", ""));
  const retryable = issue.retryable === true || RETRYABLE_FAILURES.has(reason);
  const terminal = issue.terminal === true || TERMINAL_FAILURES.has(reason);

  if (code.includes("provider-dispatch-expired")) {
    return {
      command: "ack-provider-dispatch",
      action: "acknowledge-provider-failure-or-replay",
      route: HOSTED_KERNEL_ROUTE.routeId,
      retryable: false,
      request: {
        command: "ack-provider-dispatch",
        scope: { tenantId: actor.tenantId, workspaceId: actor.workspaceId }
      }
    };
  }
  if (code.includes("provider-dispatch-stale")) {
    return {
      command: "ack-provider-dispatch",
      action: "retry-dispatch-then-ack",
      route: HOSTED_KERNEL_ROUTE.routeId,
      retryable: true,
      retryAfterMs: clampInteger(issue.retryAfterMs, 0),
      request: {
        command: "ack-provider-dispatch",
        scope: { tenantId: actor.tenantId, workspaceId: actor.workspaceId }
      }
    };
  }
  if (code.includes("permission") || code.includes("role-denied")) {
    return {
      command: "configure",
      action: "switch-actor-or-grant-role",
      route: "actor-context",
      retryable: false,
      request: { command: "configure" }
    };
  }
  if (code.includes("workspace") || code.includes("boundary")) {
    return {
      command: "configure",
      action: "update-workspace-policy",
      route: HOSTED_KERNEL_ROUTE.routeId,
      retryable: !terminal,
      request: {
        command: "configure",
        scope: { tenantId: actor.tenantId, workspaceId: actor.workspaceId }
      }
    };
  }
  if (code.includes("schedule")) {
    return {
      command: "schedule",
      action: "repair-schedule-settings",
      route: HOSTED_KERNEL_ROUTE.routeId,
      retryable: true,
      request: { command: "schedule", schedule: { enabled: true, intervalMinutes: MIN_SCHEDULE_INTERVAL_MINUTES } }
    };
  }
  if (code.includes("surface-disabled")) {
    return {
      command: "enable",
      action: "enable-memory-search",
      route: HOSTED_KERNEL_ROUTE.routeId,
      retryable: true,
      request: { command: "enable" }
    };
  }

  return {
    command: retryable ? "restore" : "",
    action: retryable ? "restore-and-retry" : "inspect-command-proof",
    route: HOSTED_KERNEL_ROUTE.routeId,
    retryable,
    request: retryable ? { command: "restore" } : null
  };
}

function buildValidationIssueCatalog(issues, actor) {
  return issues.map((issue, index) => {
    const code = stableText(issue.code, `memory-search/issue-${index + 1}`);
    const severity = stableText(issue.severity, issue.terminal === true ? "error" : "warning");
    const blocking = severity === "error" || issue.terminal === true || issue.blocking === true;
    const nextStep = validationIssueNextStep(issue, actor);

    return {
      issueId: `${actor.scopeKey}:${code}:${index + 1}`,
      code,
      source: validationIssueSource(issue),
      severity,
      blocking,
      retryable: nextStep.retryable === true,
      retryAfterMs: clampInteger(issue.retryAfterMs, clampInteger(nextStep.retryAfterMs, 0)),
      action: stableText(issue.action, stableText(issue.actionable, nextStep.action)),
      nextStep
    };
  });
}

function buildValidationSummary(state, actor, health, proof = null) {
  const scopedPendingProviderDispatches = providerOutboxForScope(state, actor);
  const providerIssues = Array.isArray(state.providerContract?.issues) ? state.providerContract.issues : [];
  const recoveryIssues = Array.isArray(state.recovery?.issues) ? state.recovery.issues : [];
  const commandIssue = proof?.failure ? [proof.failure] : [];
  const boundaryIssues = Array.isArray(proof?.boundaryDecision?.violations)
    ? proof.boundaryDecision.violations.map((violation) => ({
        ...violation,
        severity: "error",
        terminal: true
      }))
    : [];
  const providerOperationIssues = health.providerOperation?.level && health.providerOperation.level !== HEALTH_LEVELS.healthy
    ? [{
        code: health.providerOperation.level === HEALTH_LEVELS.failed
          ? "memory-search/provider-dispatch-expired"
          : "memory-search/provider-dispatch-stale",
        severity: health.providerOperation.level === HEALTH_LEVELS.failed ? "error" : "warning",
        action: health.providerOperation.guidance,
        retryable: health.providerOperation.retryable,
        retryAfterMs: health.providerOperation.nextRetryAfterMs,
        staleCount: health.providerOperation.staleCount,
        expiredCount: health.providerOperation.expiredCount
      }]
    : [];
  const issues = [...providerIssues, ...recoveryIssues, ...providerOperationIssues, ...boundaryIssues, ...commandIssue];
  const blockingIssues = issues.filter((issue) => issue.severity === "error" || issue.terminal === true);
  const issueCatalog = buildValidationIssueCatalog(issues, actor);
  const primaryIssue = issueCatalog.find((issue) => issue.blocking) || issueCatalog[0] || null;

  return {
    schema: "memory-search.validation-summary.v1",
    valid: blockingIssues.length === 0 && health.level !== HEALTH_LEVELS.failed,
    accepted: proof?.rejected !== true,
    issueCount: issues.length,
    blockingIssueCount: blockingIssues.length,
    warningCount: Math.max(0, issues.length - blockingIssues.length),
    scopedFragmentCount: fragmentsForScope(state, actor).length,
    scopedPendingProviderDispatches: scopedPendingProviderDispatches.length,
    staleProviderDispatches: health.providerOperation?.staleCount || 0,
    expiredProviderDispatches: health.providerOperation?.expiredCount || 0,
    providerRetryable: health.providerOperation?.retryable === true,
    providerRetryAfterMs: health.providerOperation?.nextRetryAfterMs || 0,
    canQuery: health.canQuery,
    canIndex: health.canIndex,
    providerReady: providerSupportsCommand(state.providerContract, "query") && providerSupportsCommand(state.providerContract, "index-fragment"),
    lifecycleReady: state.settings.enabled && (state.settings.queryEnabled || state.settings.indexingEnabled),
    boundaryAllowed: proof?.boundaryDecision?.allowed !== false,
    boundaryViolationCount: proof?.boundaryDecision?.violations?.length || 0,
    failureCode: proof?.failure?.code || "",
    failureAction: proof?.failure?.actionable || "",
    issueCatalog,
    primaryIssue,
    readinessSummary: {
      level: health.level,
      mode: health.mode,
      blocked: blockingIssues.length > 0 || health.level === HEALTH_LEVELS.failed,
      reason: primaryIssue?.code?.replace("memory-search/", "") || (health.level === HEALTH_LEVELS.failed ? "health-failed" : "valid"),
      guidance: primaryIssue?.action || health.guidance
    },
    nextValidationRequest: primaryIssue?.nextStep?.request || null
  };
}

function buildPreviewAcceptanceContract(state, actor, now, commandInput = null, proof = null, health = stateHealth(state)) {
  const command = stableText(commandInput?.command, proof?.command || "restore");
  const commandId = stableText(commandInput?.commandId, proof?.commandId || "");
  const scopedFragments = fragmentsForScope(state, actor);
  const scopedIndex = buildSearchIndex(scopedFragments);
  const nextAction = buildNextActionState(state, actor, now, health);
  const lifecycleControls = buildLifecycleControlContract(state, actor, now, health, nextAction);
  const validation = buildValidationSummary(state, actor, health, proof);
  const execution = providerExecutionSnapshot(state.providerContract);
  const resultIds = Array.isArray(proof?.matchIds)
    ? proof.matchIds
    : proof?.indexedFragmentId
      ? [proof.indexedFragmentId]
      : Array.isArray(proof?.providerResult?.resultIds)
        ? proof.providerResult.resultIds
      : [];
  const previewRows = Array.isArray(proof?.results)
    ? proof.results.map((result) => ({
        type: "query-result",
        id: result.fragmentId,
        rank: result.rank,
        title: result.tags[0] || result.fragmentId,
        score: result.score,
        summary: result.excerpt,
        command: "query"
      }))
    : resultIds.map((id, index) => ({
        type: command === "index-fragment" ? "indexed-fragment" : "result-reference",
        id,
        rank: index + 1,
        title: id,
        score: 0,
        summary: command === "index-fragment" ? "Fragment accepted into scoped memory index." : "Provider returned this memory reference.",
        command
      }));
  const ready = validation.valid && !nextAction.blocked && health.level !== HEALTH_LEVELS.failed;
  const nextRequest = validation.nextValidationRequest || (
    nextAction.blocked
      ? { command: nextAction.command }
      : {
          command: nextAction.command,
          scope: {
            tenantId: actor.tenantId,
            workspaceId: actor.workspaceId
          }
        }
  );

  return {
    schema: "memory-search.preview-acceptance.v1",
    generatedAt: now,
    command,
    commandId,
    scopeKey: actor.scopeKey,
    preview: {
      status: state.status,
      generation: state.generation,
      fragmentCount: scopedFragments.length,
      tokenCount: Object.keys(scopedIndex).length,
      providerMode: state.providerContract.mode,
      routeId: state.providerContract.mode === "hosted" ? HOSTED_KERNEL_ROUTE.routeId : "",
      transport: execution.transport,
      resultIds,
      resultCount: resultIds.length,
      pendingProviderDispatches: providerOutboxForScope(state, actor).length,
      rows: previewRows,
      display: {
        title: command === "query"
          ? `${resultIds.length} memory matches`
          : command === "index-fragment"
            ? "Memory fragment preview"
            : "Memory-search readiness preview",
        emptyState: resultIds.length === 0
          ? scopedFragments.length === 0
            ? "No scoped memory fragments have been indexed yet."
            : "No matching memory fragments were found for this command."
          : "",
        routeLabel: execution.transport === "in-process" ? "Local memory index" : execution.transport,
        canRenderResults: command === "query" && resultIds.length > 0,
        canRenderProviderHandoff: providerOutboxForScope(state, actor).length > 0
      }
    },
    acceptance: {
      accepted: proof?.rejected !== true,
      acceptedAt: proof && proof.rejected !== true ? now : "",
      rejected: proof?.rejected === true,
      rejectionCode: proof?.failure?.code || "",
      idempotentReplay: proof?.idempotentReplay === true,
      persistedGeneration: state.generation,
      commandKey: proof?.commandKey || scopedCommandKey(actor, commandId || command)
    },
    readiness: {
      ready,
      level: health.level,
      mode: health.mode,
      canQuery: health.canQuery,
      canIndex: health.canIndex,
      commandRoutable: providerSupportsCommand(state.providerContract, command),
      routeAckRequired: HOSTED_KERNEL_ROUTE.ackRequired,
      providerOperationalLevel: health.providerOperation?.level || HEALTH_LEVELS.healthy,
      providerRetryAfterMs: health.providerOperation?.nextRetryAfterMs || 0,
      lifecycleControlsReady: lifecycleControls.readyForLifecycleMutation,
      nextAction: nextAction.action,
      nextCommand: nextAction.command,
      blocked: nextAction.blocked,
      reason: nextAction.reason,
      scheduleDue: nextAction.scheduleDue,
      nextRunAt: nextAction.nextRunAt
    },
    validation,
    providerOperation: health.providerOperation,
    lifecycleControls,
    nextStep: {
      action: nextAction.action,
      command: nextAction.command,
      reason: nextAction.reason,
      blocked: nextAction.blocked,
      explain: nextAction.blocked
        ? health.guidance
        : ready
          ? "Clients may render the preview and offer the next command without another recovery pass."
          : "Clients should inspect validation before offering the next command.",
      providerOutboxId: proof?.providerOutboxEntry?.outboxId || "",
      externalHandoffId: proof?.externalHandoff?.handoffId || "",
      hostedInvocationId: proof?.hostedInvocation?.invocationId || "",
      providerAcked: proof?.providerAcked === true,
      ackedProviderCommandId: proof?.ackedProviderCommandId || ""
    },
    routeContract: {
      schema: "memory-search.route-preview.v1",
      routeId: execution.routeId || HOSTED_KERNEL_ROUTE.routeId,
      transport: execution.transport,
      protocol: state.providerContract.mode === "hosted" ? HOSTED_KERNEL_ROUTE.protocol : "memory-search.local-preview.v1",
      request: nextRequest,
      responseFields: [
        "state.previewAcceptance.preview.rows",
        "state.previewAcceptance.acceptance",
        "state.previewAcceptance.readiness",
        "state.previewAcceptance.validation.issueCatalog",
        "state.clientWorkflow"
      ],
      continuationToken: `${actor.scopeKey}:${state.generation}:${state.status}`,
      auditRequired: workspacePolicyForScope(state, actor).auditHandoffRequired,
      proofFields: ["commandId", "commandKey", "generation", "boundaryDecision", "providerOutboxEntry"]
    }
  };
}

function normalizeClientRuntime(input = {}, actor = normalizeActor(), now = "") {
  const client = isRecord(input.clientState)
    ? input.clientState
    : isRecord(input.client)
      ? input.client
      : {};
  const request = isRecord(input.request) ? input.request : {};
  const context = isRecord(input.context) ? input.context : {};
  const knownOutboxIds = Array.isArray(client.knownProviderOutboxIds)
    ? client.knownProviderOutboxIds.map((id) => stableText(id)).filter(Boolean).slice(-CLIENT_KNOWN_OUTBOX_LIMIT)
    : [];
  const acceptsAsyncHandoff = stableBoolean(client.acceptsAsyncHandoff, stableBoolean(request.acceptsAsyncHandoff, true));
  const requestId = stableText(request.requestId, stableText(client.requestId, `memory-search:${actor.scopeKey}:${now}`));
  const view = stableText(client.view, stableText(context.view, "memory-search"));
  const intent = stableText(request.intent, stableText(client.intent, "continue-workflow"));

  return {
    schema: "memory-search.client-runtime.v1",
    requestId,
    sessionId: stableText(client.sessionId, stableText(request.sessionId)),
    tabId: stableText(client.tabId),
    view,
    intent,
    acceptsAsyncHandoff,
    lastSeenGeneration: clampInteger(client.lastSeenGeneration, 0),
    lastSeenStatus: STATUS_ORDER.includes(client.lastSeenStatus) ? client.lastSeenStatus : "",
    optimisticCommandId: stableText(client.optimisticCommandId, stableText(request.commandId)),
    continuationToken: stableText(client.continuationToken, stableText(request.continuationToken)),
    knownProviderOutboxIds: knownOutboxIds,
    actorScopeKey: actor.scopeKey,
    generatedAt: now
  };
}

function buildClientRuntimeAdoption(state, actor, now, proof, previewAcceptance, clientRuntime, pendingDispatches) {
  const knownOutboxIds = new Set(clientRuntime.knownProviderOutboxIds);
  const newOutboxId = proof?.providerOutboxEntry?.outboxId || "";
  const pendingRows = pendingDispatches.map((entry) => {
    const knownByClient = knownOutboxIds.has(entry.outboxId);
    const isNewForCommand = entry.outboxId === newOutboxId;
    return {
      outboxId: entry.outboxId,
      dispatchType: entry.dispatchType,
      command: entry.command,
      commandId: entry.commandId,
      providerId: entry.providerId,
      endpointId: entry.endpointId,
      queuedAt: entry.queuedAt,
      syncGeneration: entry.syncGeneration,
      knownByClient,
      isNewForCommand,
      adoptionRequired: !knownByClient || isNewForCommand,
      ackRequest: {
        command: "ack-provider-dispatch",
        outboxId: entry.outboxId,
        providerCommandId: entry.commandId,
        scope: {
          tenantId: actor.tenantId,
          workspaceId: actor.workspaceId
        }
      }
    };
  });
  const adoptionRows = pendingRows.filter((entry) => entry.adoptionRequired);
  const stateChanged = clientRuntime.lastSeenGeneration < state.generation || clientRuntime.lastSeenStatus !== state.status;
  const continuationToken = `${actor.scopeKey}:${state.generation}:${state.status}`;
  const requestedTokenCurrent = clientRuntime.continuationToken === continuationToken;
  const providerOperation = previewAcceptance.providerOperation || providerPendingOperationHealth(state, actor, now);
  const canAdoptAsync = clientRuntime.acceptsAsyncHandoff && providerOperation.expiredCount === 0;
  const adoptionState = previewAcceptance.validation.valid === false
    ? "blocked-by-validation"
    : providerOperation.expiredCount > 0
      ? "provider-expired"
      : adoptionRows.length > 0
        ? canAdoptAsync
          ? "awaiting-provider"
          : "handoff-required"
        : stateChanged
          ? "state-refresh-required"
          : requestedTokenCurrent
            ? "current"
            : "token-refresh-required";

  return {
    schema: "memory-search.client-runtime-adoption.v1",
    generatedAt: now,
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    scopeKey: actor.scopeKey,
    adoptionState,
    acceptedByClient: adoptionState === "current" || adoptionState === "awaiting-provider",
    stateCursor: {
      generation: state.generation,
      status: state.status,
      lastSeenGeneration: clientRuntime.lastSeenGeneration,
      lastSeenStatus: clientRuntime.lastSeenStatus,
      changed: stateChanged,
      continuationToken,
      requestedToken: clientRuntime.continuationToken,
      requestedTokenCurrent
    },
    providerOutbox: {
      pendingCount: pendingDispatches.length,
      knownCount: pendingRows.filter((entry) => entry.knownByClient).length,
      adoptionRequiredCount: adoptionRows.length,
      newestOutboxId: newOutboxId,
      rows: pendingRows.slice(0, EXPORT_SAMPLE_LIMIT)
    },
    handoff: {
      asyncAccepted: clientRuntime.acceptsAsyncHandoff,
      ackRequired: adoptionRows.length > 0,
      nextAckRequest: adoptionRows[0]?.ackRequest || null,
      transport: adoptionRows[0]?.dispatchType === "external-handoff" ? "external-handoff" : providerExecutionSnapshot(state.providerContract).transport,
      routeId: state.providerContract.mode === "hosted" ? HOSTED_KERNEL_ROUTE.routeId : "",
      retryAfterMs: providerOperation.nextRetryAfterMs,
      operationalLevel: providerOperation.level
    },
    nextClientState: {
      requestId: `${clientRuntime.requestId}:next`,
      continuationToken,
      lastSeenGeneration: state.generation,
      lastSeenStatus: state.status,
      knownProviderOutboxIds: [...new Set([...clientRuntime.knownProviderOutboxIds, ...adoptionRows.map((entry) => entry.outboxId)])]
        .slice(-CLIENT_KNOWN_OUTBOX_LIMIT)
    }
  };
}

function buildClientWorkflowHandoff(state, actor, now, commandInput, proof, previewAcceptance, clientRuntime) {
  const pendingDispatches = providerOutboxForScope(state, actor);
  const newDispatch = proof?.providerOutboxEntry || null;
  const unseenDispatch = pendingDispatches.find((entry) => !clientRuntime.knownProviderOutboxIds.includes(entry.outboxId)) || null;
  const dispatchForClient = newDispatch || unseenDispatch;
  const queryResults = Array.isArray(proof?.results) ? proof.results : [];
  const command = stableText(commandInput?.command, proof?.command || "");
  const needsPersistence = clientRuntime.lastSeenGeneration < state.generation;
  const providerAwait = Boolean(dispatchForClient && dispatchForClient.status === "pending");
  const providerOperation = previewAcceptance.providerOperation || providerPendingOperationHealth(state, actor, now);
  const providerStale = providerOperation.staleCount > 0;
  const providerExpired = providerOperation.expiredCount > 0;
  const rejected = proof?.rejected === true;
  const blocked = previewAcceptance.nextStep.blocked === true || rejected || providerExpired;
  const action = rejected
    ? "show-command-error"
    : providerExpired
      ? "show-provider-failure"
      : providerStale
        ? "retry-provider-dispatch"
        : providerAwait && clientRuntime.acceptsAsyncHandoff
          ? "await-provider-result"
          : providerAwait
            ? "show-provider-handoff"
            : queryResults.length > 0
              ? "render-query-results"
              : needsPersistence
                ? "persist-normalized-state"
                : previewAcceptance.nextStep.action;
  const ackCommand = dispatchForClient
    ? {
        command: "ack-provider-dispatch",
        outboxId: dispatchForClient.outboxId,
        providerCommandId: dispatchForClient.commandId,
        scope: {
          tenantId: actor.tenantId,
          workspaceId: actor.workspaceId
        }
      }
    : null;
  const runtimeAdoption = buildClientRuntimeAdoption(
    state,
    actor,
    now,
    proof,
    previewAcceptance,
    clientRuntime,
    pendingDispatches
  );

  return {
    schema: "memory-search.client-workflow-handoff.v1",
    generatedAt: now,
    requestId: clientRuntime.requestId,
    sessionId: clientRuntime.sessionId,
    view: clientRuntime.view,
    intent: clientRuntime.intent,
    action,
    blocked,
    reason: rejected ? proof.failure?.reason || "command-rejected" : previewAcceptance.nextStep.reason,
    command,
    commandId: proof?.commandId || stableText(commandInput?.commandId),
    scopeKey: actor.scopeKey,
    stateCursor: {
      generation: state.generation,
      status: state.status,
      lastSeenGeneration: clientRuntime.lastSeenGeneration,
      changed: needsPersistence,
      continuationToken: `${actor.scopeKey}:${state.generation}:${state.status}`
    },
    resultEnvelope: {
      schema: "memory-search.query-results.v1",
      resultCount: queryResults.length,
      resultLimit: QUERY_RESULT_LIMIT,
      results: queryResults
    },
    providerHandoff: dispatchForClient
      ? {
          outboxId: dispatchForClient.outboxId,
          dispatchType: dispatchForClient.dispatchType,
          providerId: dispatchForClient.providerId,
          endpointId: dispatchForClient.endpointId,
          command: dispatchForClient.command,
          commandId: dispatchForClient.commandId,
          queuedAt: dispatchForClient.queuedAt,
          transport: dispatchForClient.dispatchType === "external-handoff" ? "external-handoff" : HOSTED_KERNEL_ROUTE.transport,
          ackRequired: true,
          ackCommand,
          operationalState: {
            level: providerOperation.level,
            stale: providerStale,
            expired: providerExpired,
            retryable: providerOperation.retryable,
            retryAfterMs: providerOperation.nextRetryAfterMs,
            guidance: providerOperation.guidance
          }
        }
      : null,
    retryBackoff: {
      required: providerStale || providerExpired,
      retryable: providerOperation.retryable,
      retryAfterMs: providerOperation.nextRetryAfterMs,
      staleCount: providerOperation.staleCount,
      expiredCount: providerOperation.expiredCount,
      action: providerExpired ? "ack-provider-failure-or-replay" : providerStale ? "retry-provider-dispatch" : ""
    },
    runtimeAdoption,
    validation: {
      schema: "memory-search.client-validation.v1",
      valid: previewAcceptance.validation.valid,
      accepted: previewAcceptance.validation.accepted,
      issueCount: previewAcceptance.validation.issueCount,
      blockingIssueCount: previewAcceptance.validation.blockingIssueCount,
      primaryIssue: previewAcceptance.validation.primaryIssue,
      issues: previewAcceptance.validation.issueCatalog,
      nextValidationRequest: previewAcceptance.validation.nextValidationRequest,
      readinessSummary: previewAcceptance.validation.readinessSummary
    },
    nextClientRequest: {
      requestId: `${clientRuntime.requestId}:next`,
      continuationToken: `${actor.scopeKey}:${state.generation}:${state.status}`,
      lastSeenGeneration: state.generation,
      lastSeenStatus: state.status,
      knownProviderOutboxIds: dispatchForClient
        ? runtimeAdoption.nextClientState.knownProviderOutboxIds
        : clientRuntime.knownProviderOutboxIds
    },
    persistence: {
      required: needsPersistence,
      persistableGeneration: state.generation,
      reason: needsPersistence ? "client-generation-behind" : ""
    }
  };
}

function buildSearchIndex(fragments) {
  const index = new Map();

  for (const fragment of fragments) {
    const haystack = `${fragment.text} ${fragment.tags.join(" ")}`.toLowerCase();
    for (const token of haystack.split(/[^a-z0-9_:-]+/i)) {
      if (!token) continue;
      const existing = index.get(token) || [];
      if (!existing.includes(fragment.id)) existing.push(fragment.id);
      index.set(token, existing);
    }
  }

  return Object.fromEntries([...index.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function shapePersistedState(snapshot = {}, now) {
  const record = isRecord(snapshot) ? snapshot : {};
  const rawFragments = Array.isArray(record.fragments) ? record.fragments : [];
  const rawProviderOutbox = Array.isArray(record.providerOutbox) ? record.providerOutbox : [];
  const fragments = Array.isArray(record.fragments)
    ? record.fragments.map(normalizeFragment).filter((fragment) => fragment.text)
    : [];
  const journal = Array.isArray(record.journal)
    ? record.journal.map(normalizeJournalEntry).slice(-100)
    : [];
  const knownCommandIds = new Set(journal.map((entry) => entry.commandKey || entry.commandId));
  const recoveredStatus = STATUS_ORDER.includes(record.status) ? record.status : DEFAULT_STATUS;
  const settings = normalizeLifecycleSettings(record.settings, now);
  const providerContract = normalizeProviderContract(record.providerContract, now);
  const providerOutbox = normalizeProviderOutbox(record.providerOutbox);
  const workspacePolicies = normalizeWorkspacePolicies(record.workspacePolicies);
  const analytics = normalizeAnalyticsState(record.analytics);
  const droppedFragments = rawFragments.length - fragments.length;
  const repairedProviderOutboxEntries = Math.max(0, rawProviderOutbox.length - providerOutbox.length);
  const pendingProviderDispatches = providerOutbox.filter((entry) => entry.status === "pending").length;
  const ackedProviderDispatches = providerOutbox.filter((entry) => entry.status === "acked").length;
  const repairedSearchingStatus = recoveredStatus === "searching" && pendingProviderDispatches === 0;
  const issues = [...providerContract.issues];
  if (!isRecord(snapshot)) {
    issues.push({ code: "memory-search/persistence-not-record", severity: "warning", action: "Replace persistedState with an object snapshot." });
  }
  if (Array.isArray(record.fragments) && droppedFragments > 0) {
    issues.push({ code: "memory-search/dropped-fragments", severity: "warning", count: droppedFragments, action: "Reindex dropped fragments with non-empty text." });
  }
  if (!STATUS_ORDER.includes(record.status) && record.status !== undefined) {
    issues.push({ code: "memory-search/status-repaired", severity: "info", previousStatus: String(record.status), action: "Persist the normalized status returned by this surface." });
  }
  if (repairedProviderOutboxEntries > 0) {
    issues.push({
      code: "memory-search/provider-outbox-deduped",
      severity: "info",
      count: repairedProviderOutboxEntries,
      action: "Persist the normalized providerOutbox to keep provider acknowledgement replay deterministic."
    });
  }
  if (repairedSearchingStatus) {
    issues.push({
      code: "memory-search/searching-status-recovered",
      severity: "info",
      previousStatus: "searching",
      action: "Persist restored or idle status after all provider dispatches have been acknowledged."
    });
  }
  const degradedPersistence = issues.some((issue) => issue.severity === "warning");
  const status = degradedPersistence
    ? "degraded"
    : repairedSearchingStatus
      ? fragments.length
        ? "restored"
        : "idle"
    : fragments.length && recoveredStatus === "idle"
      ? "restored"
      : recoveredStatus;

  return {
    schemaVersion: record.schemaVersion === SCHEMA_VERSION ? SCHEMA_VERSION : SCHEMA_VERSION,
    status,
    generation: clampInteger(record.generation, 0),
    settings,
    providerContract,
    providerOutbox,
    workspacePolicies,
    analytics,
    fragments,
    index: buildSearchIndex(fragments),
    journal,
    knownCommandIds,
    lastFailure: null,
    recoveredAt: now,
    recovery: {
      acceptedFragments: fragments.length,
      acceptedJournalEntries: journal.length,
      pendingProviderDispatches,
      ackedProviderDispatches,
      repairedProviderOutboxEntries,
      workspacePolicyCount: Object.keys(workspacePolicies).length,
      droppedFragments,
      scopedFragments: fragments.filter((fragment) => fragment.tenantId && fragment.workspaceId).length,
      statusRepaired: recoveredStatus !== record.status || repairedSearchingStatus,
      degraded: degradedPersistence,
      issues
    }
  };
}

function appendJournal(state, command, commandId, status, at, reason = "", actor = normalizeActor(), scope = actor) {
  const entry = {
    commandId,
    commandKey: scopedCommandKey(scope, commandId),
    command,
    status,
    at,
    reason,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    actorId: actor.actorId,
    actorRole: actor.role
  };
  return [...state.journal, entry].slice(-100);
}

function fragmentsForScope(state, actor) {
  return state.fragments.filter(
    (fragment) => fragment.tenantId === actor.tenantId && fragment.workspaceId === actor.workspaceId
  );
}

function journalForScope(state, actor) {
  return state.journal.filter(
    (entry) => entry.tenantId === actor.tenantId && entry.workspaceId === actor.workspaceId
  );
}

function incrementCounter(bucket, key) {
  const counterKey = stableText(key, "unknown");
  return { ...bucket, [counterKey]: clampInteger(bucket[counterKey], 0) + 1 };
}

function analyticsCounters(entries, fragments, index) {
  return entries.reduce(
    (counters, entry) => {
      const next = {
        ...counters,
        totalCommands: counters.totalCommands + 1,
        commandsByType: incrementCounter(counters.commandsByType, entry.command),
        commandsByStatus: incrementCounter(counters.commandsByStatus, entry.status),
        actorCommandCounts: incrementCounter(counters.actorCommandCounts, entry.actorId)
      };

      if (entry.status === "rejected") {
        return {
          ...next,
          rejectedCommands: next.rejectedCommands + 1,
          rejectionReasons: incrementCounter(next.rejectionReasons, entry.reason)
        };
      }

      return { ...next, appliedCommands: next.appliedCommands + 1 };
    },
    {
      totalCommands: 0,
      appliedCommands: 0,
      rejectedCommands: 0,
      fragmentCount: fragments.length,
      tokenCount: Object.keys(index).length,
      commandsByType: {},
      commandsByStatus: {},
      rejectionReasons: {},
      actorCommandCounts: {}
    }
  );
}

function elapsedMsBetween(start, end) {
  const startMs = Date.parse(stableText(start));
  const endMs = Date.parse(stableText(end));
  return Number.isNaN(startMs) || Number.isNaN(endMs) ? 0 : Math.max(0, endMs - startMs);
}

function ageBucketForMs(ageMs) {
  if (ageMs >= PROVIDER_PENDING_FAILED_MS) return "expired";
  if (ageMs >= PROVIDER_PENDING_STALE_MS) return "stale";
  if (ageMs >= 60000) return "warm";
  return "fresh";
}

function buildProviderDispatchReport(state, actor, now) {
  const scopedDispatches = (state.providerOutbox || []).filter(
    (entry) => entry.tenantId === actor.tenantId && entry.workspaceId === actor.workspaceId
  );
  const rows = scopedDispatches.slice(-REPORTING_HISTORY_LIMIT).map((entry) => {
    const pendingAgeMs = entry.status === "pending" ? providerPendingAgeMs(entry, now) : 0;
    const ackLatencyMs = entry.status === "acked" ? elapsedMsBetween(entry.queuedAt, entry.ackedAt || now) : 0;
    const ageBucket = ageBucketForMs(entry.status === "pending" ? pendingAgeMs : ackLatencyMs);

    return {
      outboxId: entry.outboxId,
      dispatchType: entry.dispatchType,
      status: entry.status,
      command: entry.command,
      commandId: entry.commandId,
      providerId: entry.providerId,
      endpointId: entry.endpointId,
      queuedAt: entry.queuedAt,
      ackedAt: entry.ackedAt,
      syncGeneration: entry.syncGeneration,
      pendingAgeMs,
      ackLatencyMs,
      ageBucket,
      resultStatus: entry.providerResult?.status || "",
      resultCount: Array.isArray(entry.providerResult?.resultIds) ? entry.providerResult.resultIds.length : 0
    };
  });
  const pendingRows = rows.filter((row) => row.status === "pending");
  const ackedRows = rows.filter((row) => row.status === "acked");
  const ackLatencies = ackedRows.map((row) => row.ackLatencyMs).filter((value) => value > 0);

  return {
    schema: "memory-search.provider-dispatch-report.v1",
    generatedAt: now,
    scopeKey: actor.scopeKey,
    rowLimit: REPORTING_HISTORY_LIMIT,
    totalDispatches: scopedDispatches.length,
    sampledDispatches: rows.length,
    pendingCount: pendingRows.length,
    ackedCount: ackedRows.length,
    hostedCount: scopedDispatches.filter((entry) => entry.dispatchType === "hosted-kernel").length,
    externalHandoffCount: scopedDispatches.filter((entry) => entry.dispatchType === "external-handoff").length,
    staleCount: pendingRows.filter((row) => row.ageBucket === "stale").length,
    expiredCount: pendingRows.filter((row) => row.ageBucket === "expired").length,
    averageAckLatencyMs: ackLatencies.length
      ? Math.round(ackLatencies.reduce((total, value) => total + value, 0) / ackLatencies.length)
      : 0,
    latestOutboxId: rows.at(-1)?.outboxId || "",
    latestDispatchStatus: rows.at(-1)?.status || "",
    rows
  };
}

function buildCommandReportRows(scopedJournal, now) {
  const offset = Math.max(0, scopedJournal.length - REPORTING_HISTORY_LIMIT);
  return scopedJournal.slice(-REPORTING_HISTORY_LIMIT).map((entry, index) => {
    const ageMs = elapsedMsBetween(entry.at, now);
    return {
      rowId: `${entry.commandKey || entry.commandId}:${offset + index + 1}`,
      sequence: offset + index + 1,
      commandId: entry.commandId,
      commandKey: entry.commandKey,
      command: entry.command,
      status: entry.status,
      reason: entry.reason,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      at: entry.at,
      ageMs,
      ageBucket: ageBucketForMs(ageMs),
      exportClass: entry.status === "rejected" ? "audit-failure" : "audit-success"
    };
  });
}

function buildAnalyticsReportState(state, actor, now, scopedJournal, historySnapshots, providerDispatchReport) {
  const commandRows = buildCommandReportRows(scopedJournal, now);
  const latestSnapshot = historySnapshots.at(-1) || null;
  const latestCommandRow = commandRows.at(-1) || null;

  return {
    schema: "memory-search.analytics-reporting.v1",
    generatedAt: now,
    scopeKey: actor.scopeKey,
    reportCursor: `${actor.scopeKey}:${state.generation}:${scopedJournal.length}:${providerDispatchReport.totalDispatches}`,
    rowLimit: REPORTING_HISTORY_LIMIT,
    commandRows,
    providerDispatchReport,
    timelineWindow: {
      firstSnapshotAt: historySnapshots[0]?.at || "",
      latestSnapshotAt: latestSnapshot?.at || "",
      snapshotCount: historySnapshots.length,
      latestSnapshotType: latestSnapshot?.type || "",
      latestStatus: latestSnapshot?.status || state.status,
      latestHealthLevel: latestSnapshot?.healthLevel || ""
    },
    latestCommand: latestCommandRow
      ? {
          commandId: latestCommandRow.commandId,
          command: latestCommandRow.command,
          status: latestCommandRow.status,
          reason: latestCommandRow.reason,
          at: latestCommandRow.at
        }
      : null
  };
}

function buildHistorySnapshots(state, actor, now, health, scopedFragments, scopedIndex, scopedJournal) {
  const recoveryAt = stableText(state.recoveredAt, now);
  const recoverySnapshot = {
    type: "recovery",
    at: recoveryAt,
    status: state.status,
    generation: state.generation,
    fragmentCount: scopedFragments.length,
    tokenCount: Object.keys(scopedIndex).length,
    journalDepth: scopedJournal.length,
    healthLevel: health.level,
    issueCount: state.recovery?.issues?.length || 0
  };
  const commandSnapshots = scopedJournal.slice(-REPORTING_HISTORY_LIMIT).map((entry, index) => ({
    type: "command",
    sequence: Math.max(0, scopedJournal.length - REPORTING_HISTORY_LIMIT) + index + 1,
    at: stableText(entry.at, recoveryAt),
    commandId: entry.commandId,
    command: entry.command,
    status: entry.status,
    reason: entry.reason || "",
    actorId: entry.actorId,
    generation: state.generation,
    healthLevel: health.level
  }));
  const currentSnapshot = {
    type: "current",
    at: now,
    status: state.status,
    generation: state.generation,
    fragmentCount: scopedFragments.length,
    tokenCount: Object.keys(scopedIndex).length,
    journalDepth: scopedJournal.length,
    healthLevel: health.level,
    degradedMode: health.mode === "read-only-degraded"
  };

  return [recoverySnapshot, ...commandSnapshots, currentSnapshot].slice(-(REPORTING_HISTORY_LIMIT + 2));
}

function normalizeAnalyticsState(value = {}) {
  const record = isRecord(value) ? value : {};
  const timeline = isRecord(record.timeline) ? record.timeline : {};
  const exportReadySummary = isRecord(record.exportReadySummary) ? record.exportReadySummary : {};
  const counters = isRecord(record.counters) ? record.counters : {};
  const reporting = isRecord(record.reporting) ? record.reporting : {};
  const providerDispatchReport = isRecord(reporting.providerDispatchReport) ? reporting.providerDispatchReport : {};

  return {
    schema: "memory-search.analytics-state.v1",
    scopeKey: stableText(record.scopeKey),
    generatedAt: stableIsoTime(record.generatedAt, ""),
    counters: {
      totalCommands: clampInteger(counters.totalCommands, 0),
      appliedCommands: clampInteger(counters.appliedCommands, 0),
      rejectedCommands: clampInteger(counters.rejectedCommands, 0),
      fragmentCount: clampInteger(counters.fragmentCount, 0),
      tokenCount: clampInteger(counters.tokenCount, 0),
      pendingProviderDispatches: clampInteger(counters.pendingProviderDispatches, 0),
      staleProviderDispatches: clampInteger(counters.staleProviderDispatches, 0),
      expiredProviderDispatches: clampInteger(counters.expiredProviderDispatches, 0),
      commandResultCount: clampInteger(counters.commandResultCount, 0),
      providerAckCount: clampInteger(counters.providerAckCount, 0),
      hostedDispatchCount: clampInteger(counters.hostedDispatchCount, 0),
      externalHandoffCount: clampInteger(counters.externalHandoffCount, 0),
      commandsByType: isRecord(counters.commandsByType) ? counters.commandsByType : {},
      commandsByStatus: isRecord(counters.commandsByStatus) ? counters.commandsByStatus : {},
      rejectionReasons: isRecord(counters.rejectionReasons) ? counters.rejectionReasons : {},
      actorCommandCounts: isRecord(counters.actorCommandCounts) ? counters.actorCommandCounts : {}
    },
    timeline: {
      historyLimit: clampBoundedInteger(timeline.historyLimit, REPORTING_HISTORY_LIMIT, 1, REPORTING_HISTORY_LIMIT),
      latestCommandId: stableText(timeline.latestCommandId),
      latestCommand: stableText(timeline.latestCommand),
      latestStatus: stableText(timeline.latestStatus),
      latestHealthLevel: stableText(timeline.latestHealthLevel),
      latestSnapshotAt: stableIsoTime(timeline.latestSnapshotAt, ""),
      snapshots: Array.isArray(timeline.snapshots) ? timeline.snapshots.slice(-REPORTING_HISTORY_LIMIT - 2) : []
    },
    exportReadySummary: {
      schema: stableText(exportReadySummary.schema, "memory-search.analytics-export-summary.v1"),
      ready: stableBoolean(exportReadySummary.ready, false),
      reason: stableText(exportReadySummary.reason),
      generatedAt: stableIsoTime(exportReadySummary.generatedAt, ""),
      exportCursor: stableText(exportReadySummary.exportCursor),
      nextExportCursor: stableText(exportReadySummary.nextExportCursor),
      sampleLimit: clampBoundedInteger(exportReadySummary.sampleLimit, EXPORT_SAMPLE_LIMIT, 1, EXPORT_SAMPLE_LIMIT),
      historySnapshotCount: clampInteger(exportReadySummary.historySnapshotCount, 0),
      commandReportRowCount: clampInteger(exportReadySummary.commandReportRowCount, 0),
      providerDispatchReportRowCount: clampInteger(exportReadySummary.providerDispatchReportRowCount, 0),
      reportSections: Array.isArray(exportReadySummary.reportSections)
        ? exportReadySummary.reportSections.map((section) => stableText(section)).filter(Boolean).slice(0, 12)
        : []
    },
    reporting: {
      schema: stableText(reporting.schema, "memory-search.analytics-reporting.v1"),
      generatedAt: stableIsoTime(reporting.generatedAt, ""),
      scopeKey: stableText(reporting.scopeKey),
      reportCursor: stableText(reporting.reportCursor),
      rowLimit: clampBoundedInteger(reporting.rowLimit, REPORTING_HISTORY_LIMIT, 1, REPORTING_HISTORY_LIMIT),
      commandRows: Array.isArray(reporting.commandRows) ? reporting.commandRows.slice(-REPORTING_HISTORY_LIMIT) : [],
      providerDispatchReport: {
        schema: stableText(providerDispatchReport.schema, "memory-search.provider-dispatch-report.v1"),
        generatedAt: stableIsoTime(providerDispatchReport.generatedAt, ""),
        scopeKey: stableText(providerDispatchReport.scopeKey),
        rowLimit: clampBoundedInteger(providerDispatchReport.rowLimit, REPORTING_HISTORY_LIMIT, 1, REPORTING_HISTORY_LIMIT),
        totalDispatches: clampInteger(providerDispatchReport.totalDispatches, 0),
        sampledDispatches: clampInteger(providerDispatchReport.sampledDispatches, 0),
        pendingCount: clampInteger(providerDispatchReport.pendingCount, 0),
        ackedCount: clampInteger(providerDispatchReport.ackedCount, 0),
        hostedCount: clampInteger(providerDispatchReport.hostedCount, 0),
        externalHandoffCount: clampInteger(providerDispatchReport.externalHandoffCount, 0),
        staleCount: clampInteger(providerDispatchReport.staleCount, 0),
        expiredCount: clampInteger(providerDispatchReport.expiredCount, 0),
        averageAckLatencyMs: clampInteger(providerDispatchReport.averageAckLatencyMs, 0),
        latestOutboxId: stableText(providerDispatchReport.latestOutboxId),
        latestDispatchStatus: stableText(providerDispatchReport.latestDispatchStatus),
        rows: Array.isArray(providerDispatchReport.rows) ? providerDispatchReport.rows.slice(-REPORTING_HISTORY_LIMIT) : []
      },
      timelineWindow: isRecord(reporting.timelineWindow) ? reporting.timelineWindow : {},
      latestCommand: isRecord(reporting.latestCommand) ? reporting.latestCommand : null
    }
  };
}

function buildAnalyticsRuntimeState(state, actor, now, proof = null) {
  const scopedFragments = fragmentsForScope(state, actor);
  const scopedIndex = buildSearchIndex(scopedFragments);
  const scopedJournal = journalForScope(state, actor);
  const scopedProviderOutbox = providerOutboxForScope(state, actor);
  const health = stateHealth(state, actor, now);
  const baseCounters = analyticsCounters(scopedJournal, scopedFragments, scopedIndex);
  const historySnapshots = buildHistorySnapshots(state, actor, now, health, scopedFragments, scopedIndex, scopedJournal);
  const providerDispatchReport = buildProviderDispatchReport(state, actor, now);
  const reporting = buildAnalyticsReportState(state, actor, now, scopedJournal, historySnapshots, providerDispatchReport);
  const latestJournalEntry = scopedJournal.at(-1) || null;
  const latestSnapshot = historySnapshots.at(-1) || null;
  const exportCursor = `${actor.scopeKey}:${state.generation}:${baseCounters.totalCommands}`;
  const providerOperation = health.providerOperation || providerPendingOperationHealth(state, actor, now);
  const ready = health.level !== HEALTH_LEVELS.failed && scopedJournal.length === baseCounters.totalCommands;
  const commandResultCount = Array.isArray(proof?.results)
    ? proof.results.length
    : Array.isArray(proof?.matchIds)
      ? proof.matchIds.length
      : Array.isArray(proof?.providerResult?.resultIds)
        ? proof.providerResult.resultIds.length
        : 0;

  return {
    schema: "memory-search.analytics-state.v1",
    scopeKey: actor.scopeKey,
    generatedAt: now,
    counters: {
      ...baseCounters,
      pendingProviderDispatches: scopedProviderOutbox.length,
      staleProviderDispatches: providerOperation.staleCount,
      expiredProviderDispatches: providerOperation.expiredCount,
      commandResultCount,
      providerAckCount: scopedJournal.filter((entry) => entry.command === "ack-provider-dispatch" && entry.status === "applied").length,
      hostedDispatchCount: (state.providerOutbox || []).filter((entry) => entry.dispatchType === "hosted-kernel" && entry.tenantId === actor.tenantId && entry.workspaceId === actor.workspaceId).length,
      externalHandoffCount: (state.providerOutbox || []).filter((entry) => entry.dispatchType === "external-handoff" && entry.tenantId === actor.tenantId && entry.workspaceId === actor.workspaceId).length
    },
    timeline: {
      historyLimit: REPORTING_HISTORY_LIMIT,
      latestCommandId: latestJournalEntry?.commandId || proof?.commandId || "",
      latestCommand: latestJournalEntry?.command || proof?.command || "",
      latestStatus: latestJournalEntry?.status || (proof?.rejected ? "rejected" : ""),
      latestHealthLevel: health.level,
      latestSnapshotAt: stableText(latestSnapshot?.at, now),
      snapshots: historySnapshots
    },
    exportReadySummary: {
      schema: "memory-search.analytics-export-summary.v1",
      ready,
      reason: ready ? "analytics-current" : health.level === HEALTH_LEVELS.failed ? "health-failed" : "journal-incomplete",
      generatedAt: now,
      exportCursor,
      nextExportCursor: `${actor.scopeKey}:${state.generation + 1}:${baseCounters.totalCommands}`,
      sampleLimit: EXPORT_SAMPLE_LIMIT,
      historySnapshotCount: historySnapshots.length,
      commandReportRowCount: reporting.commandRows.length,
      providerDispatchReportRowCount: providerDispatchReport.rows.length,
      reportSections: [
        "counters",
        "timeline",
        "commandRows",
        "providerDispatchReport",
        "workspacePolicy",
        "providerOutbox",
        "lifecycleControls",
        "readiness"
      ]
    },
    reporting
  };
}

function refreshAnalyticsState(state, actor, now, proof = null) {
  return { ...state, analytics: buildAnalyticsRuntimeState(state, actor, now, proof) };
}

function buildExportSummary(state, actor, now) {
  const scopedFragments = fragmentsForScope(state, actor);
  const scopedIndex = buildSearchIndex(scopedFragments);
  const scopedJournal = journalForScope(state, actor);
  const scopedProviderOutbox = providerOutboxForScope(state, actor);
  const workspacePolicy = workspacePolicyForScope(state, actor);
  const health = stateHealth(state, actor, now);
  const readinessContract = buildPreviewAcceptanceContract(state, actor, now, null, null, health);
  const lifecycleControls = readinessContract.lifecycleControls;
  const providerServiceContract = buildProviderServiceContract(state, actor, now);
  const analyticsState = state.analytics?.scopeKey === actor.scopeKey
    ? normalizeAnalyticsState(state.analytics)
    : buildAnalyticsRuntimeState(state, actor, now);
  const counters = analyticsState.counters;
  const historySnapshots = analyticsState.timeline.snapshots;
  const latestRejected = [...scopedJournal].reverse().find((entry) => entry.status === "rejected") || null;

  return {
    exportSchema: "memory-search.analytics.v1",
    generatedAt: now,
    surfaceId,
    scopeKey: actor.scopeKey,
    tenantId: actor.tenantId,
    workspaceId: actor.workspaceId,
    status: state.status,
    generation: state.generation,
    settings: {
      enabled: state.settings.enabled,
      queryEnabled: state.settings.queryEnabled,
      indexingEnabled: state.settings.indexingEnabled,
      schedule: state.settings.schedule,
      updatedAt: state.settings.updatedAt,
      updatedBy: state.settings.updatedBy
    },
    providerContract: {
      providerId: state.providerContract.providerId,
      service: state.providerContract.service,
      mode: state.providerContract.mode,
      endpointId: state.providerContract.endpointId,
      capabilities: state.providerContract.capabilities,
      sync: state.providerContract.sync,
      externalHandoff: state.providerContract.externalHandoff,
      issueCount: state.providerContract.issues.length
    },
    providerExecution: providerExecutionSnapshot(state.providerContract),
    providerServiceContract,
    workspacePolicy: {
      schema: workspacePolicy.schema,
      tenantId: workspacePolicy.tenantId,
      workspaceId: workspacePolicy.workspaceId,
      maxFragments: workspacePolicy.maxFragments,
      maxFragmentBytes: workspacePolicy.maxFragmentBytes,
      allowCrossWorkspaceQuery: workspacePolicy.allowCrossWorkspaceQuery,
      allowClear: workspacePolicy.allowClear,
      locked: workspacePolicy.locked,
      auditHandoffRequired: workspacePolicy.auditHandoffRequired,
      roleGrants: workspacePolicy.roleGrants,
      currentFragmentCount: scopedFragments.length,
      remainingFragmentSlots: Math.max(0, workspacePolicy.maxFragments - scopedFragments.length),
      updatedAt: workspacePolicy.updatedAt,
      updatedBy: workspacePolicy.updatedBy
    },
    readiness: {
      schema: readinessContract.schema,
      ready: readinessContract.readiness.ready,
      nextAction: readinessContract.readiness.nextAction,
      nextCommand: readinessContract.readiness.nextCommand,
      blocked: readinessContract.readiness.blocked,
      reason: readinessContract.readiness.reason,
      lifecycleControlsReady: readinessContract.readiness.lifecycleControlsReady,
      validation: readinessContract.validation
    },
    lifecycleControls,
    providerOutbox: {
      pendingCount: scopedProviderOutbox.length,
      staleCount: health.providerOperation?.staleCount || 0,
      expiredCount: health.providerOperation?.expiredCount || 0,
      retryAfterMs: health.providerOperation?.nextRetryAfterMs || 0,
      limit: PROVIDER_OUTBOX_LIMIT,
      dispatches: scopedProviderOutbox.slice(0, EXPORT_SAMPLE_LIMIT).map((entry) => ({
        outboxId: entry.outboxId,
        dispatchType: entry.dispatchType,
        command: entry.command,
        commandId: entry.commandId,
        providerId: entry.providerId,
        endpointId: entry.endpointId,
        queuedAt: entry.queuedAt,
        syncGeneration: entry.syncGeneration,
        syncCursor: entry.syncCursor
      }))
    },
    healthLevel: health.level,
    providerOperation: health.providerOperation,
    degradedMode: health.mode === "read-only-degraded",
    analyticsState,
    exportReadySummary: analyticsState.exportReadySummary,
    analyticsReporting: analyticsState.reporting,
    counters,
    latestRejectedCommand: latestRejected
      ? {
          commandId: latestRejected.commandId,
          command: latestRejected.command,
          reason: latestRejected.reason,
          at: latestRejected.at
        }
      : null,
    fragmentSample: scopedFragments.slice(0, EXPORT_SAMPLE_LIMIT).map((fragment) => ({
      id: fragment.id,
      revision: fragment.revision,
      tagCount: fragment.tags.length,
      indexedAt: fragment.indexedAt
    })),
    tokenSample: Object.keys(scopedIndex).slice(0, EXPORT_SAMPLE_LIMIT),
    historySnapshots
  };
}

function applyMemorySearchCommand(state, commandInput = {}, now, actor = normalizeActor()) {
  const command = stableText(commandInput.command, "restore");
  const commandId = stableText(commandInput.commandId, `${command}:${state.generation}`);
  const scope = commandScope(commandInput, actor);
  const commandKey = scopedCommandKey(scope, commandId);
  const attempts = clampInteger(commandInput.attempts, clampInteger(commandInput.retryAttempt, 0));

  if (state.knownCommandIds.has(commandKey)) {
    return {
      state,
      proof: {
        commandId,
        commandKey,
        command,
        idempotentReplay: true,
        status: state.status,
        generation: state.generation,
        scope
      }
    };
  }

  if (!COMMANDS.has(command)) {
    const failure = commandFailureContract("unsupported-command", command, commandId, scope, actor, now, { attempts });
    const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
    return {
      state: { ...state, status: "failed", lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
      proof: { commandId, commandKey, command, rejected: true, failure, scope }
    };
  }

  if (!hasCommandPermission(actor, command)) {
    const failure = commandFailureContract("permission-denied", command, commandId, scope, actor, now, { attempts });
    const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
    return {
      state: { ...state, status: "failed", lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
      proof: { commandId, commandKey, command, rejected: true, failure, actorRole: actor.role, scope }
    };
  }

  if (!isActorScope(scope, actor)) {
    const failure = commandFailureContract("scope-boundary-violation", command, commandId, scope, actor, now, { attempts });
    const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
    return {
      state: { ...state, status: "failed", lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
      proof: { commandId, commandKey, command, rejected: true, failure, actorScope: actor.scopeKey, requestedScope: `${scope.tenantId}/${scope.workspaceId}` }
    };
  }

  const boundaryDecision = workspaceBoundaryDecision(state, command, commandInput, scope, actor);
  if (!boundaryDecision.allowed) {
    const failure = commandFailureContract("workspace-policy-violation", command, commandId, scope, actor, now, { attempts });
    const lastFailure = { ...failure, violations: boundaryDecision.violations };
    const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
    return {
      state: { ...state, status: "failed", lastFailure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
      proof: { commandId, commandKey, command, rejected: true, failure: lastFailure, boundaryDecision, scope }
    };
  }

  if (state.status === "degraded" && (command === "index-fragment" || command === "clear")) {
    const failure = commandFailureContract("degraded-persistence", command, commandId, scope, actor, now, { attempts });
    const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
    return {
      state: { ...state, lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
      proof: { commandId, commandKey, command, rejected: true, failure, degradedReadOnly: true, scope }
    };
  }

  if (!state.settings.enabled && !["restore", "configure", "enable", "disable", "schedule"].includes(command)) {
    const failure = commandFailureContract("surface-disabled", command, commandId, scope, actor, now, { attempts });
    const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
    return {
      state: { ...state, lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
      proof: { commandId, commandKey, command, rejected: true, failure, settings: state.settings, scope }
    };
  }

  if (command === "configure" || command === "enable" || command === "disable" || command === "schedule") {
    if (command === "schedule" && !providerSupportsCommand(state.providerContract, command)) {
      const failure = commandFailureContract("provider-capability-unavailable", command, commandId, scope, actor, now, { attempts });
      const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
      return {
        state: { ...state, lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, rejected: true, failure, providerContract: state.providerContract, scope }
      };
    }
    const { settings, issues } = lifecycleSettingsFromCommand(state.settings, commandInput, command, now, actor);
    const providerPatch = isRecord(commandInput.providerContract)
      ? commandInput.providerContract
      : isRecord(commandInput.provider)
        ? commandInput.provider
        : null;
    const providerContract = providerPatch
      ? normalizeProviderContract({ ...state.providerContract, ...providerPatch, sync: { ...state.providerContract.sync, ...providerPatch.sync } }, now, actor)
      : state.providerContract;
    const workspacePolicyPatch = isRecord(commandInput.workspacePolicy)
      ? commandInput.workspacePolicy
      : isRecord(commandInput.policy)
        ? commandInput.policy
        : null;
    const workspacePolicies = workspacePolicyPatch
      ? {
          ...state.workspacePolicies,
          [actor.scopeKey]: normalizeWorkspacePolicy(
            { ...workspacePolicyForScope(state, scope), ...workspacePolicyPatch, tenantId: scope.tenantId, workspaceId: scope.workspaceId, updatedAt: now, updatedBy: actor.actorId },
            scope
          )
        }
      : state.workspacePolicies;
    const patch = isRecord(commandInput.settings) ? commandInput.settings : {};
    const schedulePatch = isRecord(commandInput.schedule) ? commandInput.schedule : {};
    const lifecycleMutation = lifecycleMutationPreview(state, actor, now, stateHealth(state, actor, now), command, {
      command,
      ...(Object.keys(patch).length ? { settings: patch } : {}),
      ...(Object.keys(schedulePatch).length ? { schedule: schedulePatch } : {})
    });
    if (issues.length > 0) {
      const failure = commandFailureContract("invalid-settings", command, commandId, scope, actor, now, { attempts });
      const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
      return {
        state: { ...state, lastFailure: { ...failure, issues }, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, rejected: true, failure: { ...failure, issues }, proposedSettings: settings, lifecycleMutation, scope }
      };
    }
    const journal = appendJournal(state, command, commandId, "applied", now, "", actor, scope);
    const status = command === "disable" ? state.status : state.fragments.length ? "restored" : "idle";
    const nextStateForLifecycle = { ...state, status, settings, providerContract, workspacePolicies, generation: state.generation + 1 };
    const lifecycleNextAction = buildNextActionState(nextStateForLifecycle, actor, now, stateHealth(nextStateForLifecycle, actor, now));
    return {
      state: { ...state, status, settings, providerContract, workspacePolicies, generation: state.generation + 1, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
      proof: {
        commandId,
        commandKey,
        command,
        settings,
        providerContract,
        workspacePolicy: workspacePolicyForScope({ ...state, workspacePolicies }, scope),
        boundaryDecision,
        lifecycleChanged: true,
        lifecycleMutation: {
          ...lifecycleMutation,
          applied: true,
          projectedNextAction: {
            action: lifecycleNextAction.action,
            command: lifecycleNextAction.command,
            blocked: lifecycleNextAction.blocked,
            reason: lifecycleNextAction.reason,
            scheduleDue: lifecycleNextAction.scheduleDue,
            nextRunAt: lifecycleNextAction.nextRunAt
          }
        },
        generation: state.generation + 1,
        scope
      }
    };
  }

  if (command === "ack-provider-dispatch") {
    const rawResult = isRecord(commandInput.providerResult)
      ? commandInput.providerResult
      : isRecord(commandInput.result)
        ? commandInput.result
        : {};
    const providerResult = normalizeProviderResult(rawResult, {
      providerId: state.providerContract.providerId,
      endpointId: state.providerContract.endpointId,
      commandId: stableText(rawResult.commandId, stableText(commandInput.providerCommandId)),
      command: stableText(rawResult.command),
      outboxId: stableText(rawResult.outboxId, stableText(commandInput.outboxId)),
      syncCursor: state.providerContract.sync.cursor,
      syncGeneration: state.providerContract.sync.generation
    }, now);

    if (!providerResult.status || !providerResult.providerId || !providerResult.commandId) {
      const failure = commandFailureContract("provider-result-invalid", command, commandId, scope, actor, now, { attempts });
      const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
      return {
        state: { ...state, lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, rejected: true, failure, providerResult, scope }
      };
    }

    const { providerOutbox, matchedEntry, alreadyAcked } = acknowledgeProviderDispatch(state, providerResult, scope, now);
    if (!matchedEntry) {
      const failure = commandFailureContract("provider-dispatch-not-found", command, commandId, scope, actor, now, { attempts });
      const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
      return {
        state: { ...state, lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, rejected: true, failure, providerResult, scope }
      };
    }

    const providerFailed = providerResult.status === "failed";
    const nextSyncGeneration = Math.max(state.providerContract.sync.generation, providerResult.sync.generation, matchedEntry.syncGeneration);
    const providerContract = {
      ...state.providerContract,
      sync: {
        cursor: providerResult.sync.cursor || state.providerContract.sync.cursor,
        generation: nextSyncGeneration,
        syncedAt: now
      }
    };
    const journal = appendJournal(state, command, commandId, "applied", now, alreadyAcked ? "provider-ack-replay" : providerResult.status, actor, scope);
    const scopedPending = providerOutbox.filter(
      (entry) => entry.status === "pending" && entry.tenantId === scope.tenantId && entry.workspaceId === scope.workspaceId
    ).length;
    const status = providerFailed
      ? "degraded"
      : scopedPending > 0
        ? "searching"
        : state.fragments.length
          ? "restored"
          : "idle";
    const lastFailure = providerFailed
      ? commandFailureContract("provider-result-invalid", matchedEntry.command, matchedEntry.commandId, scope, actor, now, { attempts })
      : state.lastFailure;

    return {
      state: {
        ...state,
        status,
        providerContract,
        providerOutbox,
        generation: alreadyAcked ? state.generation : state.generation + 1,
        lastFailure,
        journal,
        knownCommandIds: new Set([...state.knownCommandIds, commandKey])
      },
      proof: {
        commandId,
        commandKey,
        command,
        providerAcked: true,
        alreadyAcked,
        providerResult,
        matchedOutboxId: matchedEntry.outboxId,
        ackedProviderCommandId: matchedEntry.commandId,
        pendingProviderDispatches: scopedPending,
        status,
        generation: alreadyAcked ? state.generation : state.generation + 1,
        boundaryDecision,
        scope
      }
    };
  }

  if (command === "clear") {
    if (!providerSupportsCommand(state.providerContract, command)) {
      const failure = commandFailureContract("provider-capability-unavailable", command, commandId, scope, actor, now, { attempts });
      const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
      return {
        state: { ...state, lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, rejected: true, failure, providerContract: state.providerContract, scope }
      };
    }
    if (state.settings.indexingEnabled === false) {
      const failure = commandFailureContract("surface-disabled", command, commandId, scope, actor, now, { attempts });
      const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
      return {
        state: { ...state, lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, rejected: true, failure, indexingEnabled: false, scope }
      };
    }
    const hostedInvocation = buildHostedKernelInvocation(state.providerContract, command, commandId, scope, actor, now, {
      operation: "clear-scope",
      targetScope: actor.scopeKey
    });
    const journal = appendJournal(state, command, commandId, "applied", now, "", actor, scope);
    const fragments = state.fragments.filter(
      (fragment) => fragment.tenantId !== actor.tenantId || fragment.workspaceId !== actor.workspaceId
    );
    const providerOutbox = appendProviderOutbox(state, "hosted-kernel", hostedInvocation, now);
    return {
      state: { ...state, status: fragments.length ? "restored" : "idle", generation: state.generation + 1, fragments, index: buildSearchIndex(fragments), providerOutbox, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
      proof: { commandId, commandKey, command, cleared: true, clearedScope: actor.scopeKey, hostedInvocation, providerOutboxEntry: hostedInvocation ? providerOutbox.at(-1) || null : null, boundaryDecision, generation: state.generation + 1 }
    };
  }

  if (command === "index-fragment") {
    if (!providerSupportsCommand(state.providerContract, command)) {
      const failure = commandFailureContract("provider-capability-unavailable", command, commandId, scope, actor, now, { attempts });
      const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
      return {
        state: { ...state, lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, rejected: true, failure, providerContract: state.providerContract, scope }
      };
    }
    if (state.settings.indexingEnabled === false) {
      const failure = commandFailureContract("surface-disabled", command, commandId, scope, actor, now, { attempts });
      const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
      return {
        state: { ...state, lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, rejected: true, failure, indexingEnabled: false, scope }
      };
    }
    const fragment = normalizeFragment({ ...commandInput.fragment, tenantId: actor.tenantId, workspaceId: actor.workspaceId, indexedAt: now }, state.fragments.length, scope);
    if (!fragment.text) {
      const failure = commandFailureContract("missing-fragment-text", command, commandId, scope, actor, now, { attempts });
      const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
      return {
        state: { ...state, status: "failed", lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, rejected: true, failure, scope }
      };
    }
    if (state.providerContract.externalHandoff.required) {
      const handoff = buildExternalHandoff(state.providerContract, command, commandId, scope, actor, now, {
        fragmentId: fragment.id,
        revision: fragment.revision,
        tagCount: fragment.tags.length
      });
      const journal = appendJournal(state, command, commandId, "applied", now, "external-handoff", actor, scope);
      const providerContract = {
        ...state.providerContract,
        sync: { ...state.providerContract.sync, generation: state.generation + 1, syncedAt: now }
      };
      const providerOutbox = appendProviderOutbox(state, "external-handoff", handoff, now);
      return {
        state: { ...state, status: "searching", providerContract, providerOutbox, generation: state.generation + 1, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, externalHandoff: handoff, providerOutboxEntry: providerOutbox.at(-1) || null, providerContract, boundaryDecision, generation: state.generation + 1, scope }
      };
    }
    const hostedInvocation = buildHostedKernelInvocation(state.providerContract, command, commandId, scope, actor, now, {
      fragmentId: fragment.id,
      revision: fragment.revision,
      tagCount: fragment.tags.length,
      textBytes: fragment.text.length
    });
    const fragments = [
      ...state.fragments.filter(
        (existing) =>
          existing.id !== fragment.id ||
          existing.tenantId !== fragment.tenantId ||
          existing.workspaceId !== fragment.workspaceId
      ),
      fragment
    ];
    const journal = appendJournal(state, command, commandId, "applied", now, "", actor, scope);
    const providerOutbox = appendProviderOutbox(state, "hosted-kernel", hostedInvocation, now);
    return {
      state: { ...state, status: "restored", generation: state.generation + 1, fragments, index: buildSearchIndex(fragments), providerOutbox, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
      proof: { commandId, commandKey, command, indexedFragmentId: fragment.id, hostedInvocation, providerOutboxEntry: hostedInvocation ? providerOutbox.at(-1) || null : null, boundaryDecision, scope, generation: state.generation + 1 }
    };
  }

  if (command === "query") {
    if (!providerSupportsCommand(state.providerContract, command)) {
      const failure = commandFailureContract("provider-capability-unavailable", command, commandId, scope, actor, now, { attempts });
      const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
      return {
        state: { ...state, lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, rejected: true, failure, providerContract: state.providerContract, scope }
      };
    }
    if (state.settings.queryEnabled === false) {
      const failure = commandFailureContract("surface-disabled", command, commandId, scope, actor, now, { attempts });
      const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
      return {
        state: { ...state, lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, rejected: true, failure, queryEnabled: false, scope }
      };
    }
    const terms = normalizeQueryTerms(commandInput.query);
    if (terms.length === 0) {
      const failure = commandFailureContract("empty-query", command, commandId, scope, actor, now, { attempts });
      const journal = appendJournal(state, command, commandId, "rejected", now, failure.reason, actor, scope);
      return {
        state: { ...state, status: state.status === "degraded" ? "degraded" : "failed", lastFailure: failure, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, rejected: true, failure, scope }
      };
    }
    if (state.providerContract.externalHandoff.required) {
      const handoff = buildExternalHandoff(state.providerContract, command, commandId, scope, actor, now, {
        queryTerms: terms,
        syncCursor: state.providerContract.sync.cursor
      });
      const journal = appendJournal(state, command, commandId, "applied", now, "external-handoff", actor, scope);
      const providerOutbox = appendProviderOutbox(state, "external-handoff", handoff, now);
      return {
        state: { ...state, status: "searching", providerOutbox, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
        proof: { commandId, commandKey, command, queryTerms: terms, externalHandoff: handoff, providerOutboxEntry: providerOutbox.at(-1) || null, providerContract: state.providerContract, boundaryDecision, searchedScope: actor.scopeKey }
      };
    }
    const scopedFragments = fragmentsForScope(state, actor);
    const results = buildQueryResults(scopedFragments, terms);
    const matchIds = results.map((result) => result.fragmentId);
    const hostedInvocation = buildHostedKernelInvocation(state.providerContract, command, commandId, scope, actor, now, {
      queryTerms: terms,
      localCandidateCount: matchIds.length,
      resultLimit: QUERY_RESULT_LIMIT,
      syncCursor: state.providerContract.sync.cursor
    });
    const journal = appendJournal(state, command, commandId, "applied", now, "", actor, scope);
    const providerOutbox = appendProviderOutbox(state, "hosted-kernel", hostedInvocation, now);
    return {
      state: { ...state, status: "restored", providerOutbox, journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
      proof: {
        commandId,
        commandKey,
        command,
        queryTerms: terms,
        matchIds,
        matchCount: matchIds.length,
        results,
        resultLimit: QUERY_RESULT_LIMIT,
        hostedInvocation,
        providerOutboxEntry: hostedInvocation ? providerOutbox.at(-1) || null : null,
        boundaryDecision,
        searchedScope: actor.scopeKey
      }
    };
  }

  const journal = appendJournal(state, command, commandId, "applied", now, "", actor, scope);
  return {
    state: { ...state, status: state.fragments.length ? "restored" : "idle", journal, knownCommandIds: new Set([...state.knownCommandIds, commandKey]) },
    proof: { commandId, commandKey, command, restored: true, fragmentCount: fragmentsForScope(state, actor).length, boundaryDecision, scope }
  };
}

function publicState(state, actor, now, clientContract = null, clientWorkflow = null) {
  const fragments = fragmentsForScope(state, actor);
  const index = buildSearchIndex(fragments);
  const scopedProviderOutbox = providerOutboxForScope(state, actor);
  const health = stateHealth(state, actor, now);
  const exportSummary = buildExportSummary(state, actor, now);
  const nextAction = buildNextActionState(state, actor, now, health);
  const previewAcceptance = clientContract || buildPreviewAcceptanceContract(state, actor, now, null, null, health);
  const lifecycleControls = previewAcceptance.lifecycleControls || buildLifecycleControlContract(state, actor, now, health, nextAction);
  const workspacePolicy = workspacePolicyForScope(state, actor);
  const providerServiceContract = buildProviderServiceContract(state, actor, now);
  return {
    schemaVersion: state.schemaVersion,
    status: state.status,
    generation: state.generation,
    scope: {
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      actorRole: actor.role,
      permissions: actor.permissions
    },
    fragmentCount: fragments.length,
    totalFragmentCount: state.fragments.length,
    indexTokenCount: Object.keys(index).length,
    journalDepth: state.journal.length,
    settings: state.settings,
    workspacePolicy: {
      ...workspacePolicy,
      currentFragmentCount: fragments.length,
      remainingFragmentSlots: Math.max(0, workspacePolicy.maxFragments - fragments.length)
    },
    providerContract: state.providerContract,
    providerExecution: providerExecutionSnapshot(state.providerContract),
    providerServiceContract,
    providerOutbox: {
      pendingCount: scopedProviderOutbox.length,
      dispatches: scopedProviderOutbox
    },
    nextAction,
    lifecycleControls,
    previewAcceptance,
    clientWorkflow,
    readiness: previewAcceptance.readiness,
    validationSummary: previewAcceptance.validation,
    health: { ...health, pendingProviderDispatches: scopedProviderOutbox.length },
    degradedMode: health.mode === "read-only-degraded",
    fragments,
    index,
    analytics: exportSummary.analyticsState,
    historySnapshots: exportSummary.historySnapshots,
    reporting: {
      exportSchema: exportSummary.exportSchema,
      generatedAt: exportSummary.generatedAt,
      scopeKey: exportSummary.scopeKey,
      exportReadySummary: exportSummary.exportReadySummary,
      analyticsReporting: exportSummary.analyticsReporting,
      schedule: exportSummary.settings.schedule,
      lifecycleControls: exportSummary.lifecycleControls,
      workspacePolicy: exportSummary.workspacePolicy,
      providerContract: exportSummary.providerContract,
      providerExecution: exportSummary.providerExecution,
      providerServiceContract: exportSummary.providerServiceContract,
      readiness: exportSummary.readiness,
      providerOutbox: exportSummary.providerOutbox,
      providerOperation: exportSummary.providerOperation,
      latestRejectedCommand: exportSummary.latestRejectedCommand,
      fragmentSample: exportSummary.fragmentSample,
      tokenSample: exportSummary.tokenSample
    },
    recovery: state.recovery
  };
}

function persistableState(state) {
  return {
    schemaVersion: state.schemaVersion,
    status: state.status,
    generation: state.generation,
    settings: state.settings,
    workspacePolicies: state.workspacePolicies,
    providerContract: state.providerContract,
    providerOutbox: state.providerOutbox || [],
    analytics: state.analytics || normalizeAnalyticsState(),
    fragments: state.fragments,
    journal: state.journal,
    lastFailure: state.lastFailure
  };
}

export function describeMemorySearchSurface(input = {}) {
  const now = input.now || new Date().toISOString();
  const actor = normalizeActor(input);
  const recovered = shapePersistedState(input.persistedState, now);
  const rawCommandResult = input.command
    ? applyMemorySearchCommand(recovered, input.command, now, actor)
    : { state: recovered, proof: null };
  const commandResult = {
    ...rawCommandResult,
    state: refreshAnalyticsState(rawCommandResult.state, actor, now, rawCommandResult.proof)
  };
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const scopedFragments = fragmentsForScope(commandResult.state, actor);
  const health = stateHealth(commandResult.state, actor, now);
  const exportSummary = buildExportSummary(commandResult.state, actor, now);
  const nextAction = buildNextActionState(commandResult.state, actor, now, health);
  const previewAcceptance = buildPreviewAcceptanceContract(commandResult.state, actor, now, input.command || null, commandResult.proof, health);
  const lifecycleControls = previewAcceptance.lifecycleControls;
  const clientRuntime = normalizeClientRuntime(input, actor, now);
  const clientWorkflow = buildClientWorkflowHandoff(commandResult.state, actor, now, input.command || null, commandResult.proof, previewAcceptance, clientRuntime);

  return {
    ok: health.level !== HEALTH_LEVELS.failed,
    surfaceId,
    surfaceGroup,
    surfaceName,
    generatedAt: now,
    wave: 'ai-os-wave1-hosted-kernel-boot-proof',
    contract: 'hosted-kernel memory-search scoped recovery, permission, and idempotent command contract',
    state: publicState(commandResult.state, actor, now, previewAcceptance, clientWorkflow),
    persistableState: persistableState(commandResult.state),
    exportSummary,
    audit: {
      restartSafe: true,
      commandProof: commandResult.proof,
      previewAcceptance,
      analyticsProof: {
        schema: exportSummary.analyticsState.schema,
        reportingSchema: exportSummary.analyticsReporting.schema,
        exportSchema: exportSummary.exportSchema,
        scopeKey: exportSummary.scopeKey,
        generatedAt: exportSummary.analyticsState.generatedAt,
        exportReady: exportSummary.exportReadySummary.ready,
        exportReadyReason: exportSummary.exportReadySummary.reason,
        exportCursor: exportSummary.exportReadySummary.exportCursor,
        nextExportCursor: exportSummary.exportReadySummary.nextExportCursor,
        reportSections: exportSummary.exportReadySummary.reportSections,
        reportCursor: exportSummary.analyticsReporting.reportCursor,
        commandReportRowCount: exportSummary.exportReadySummary.commandReportRowCount,
        providerDispatchReportRowCount: exportSummary.exportReadySummary.providerDispatchReportRowCount,
        totalCommands: exportSummary.counters.totalCommands,
        appliedCommands: exportSummary.counters.appliedCommands,
        rejectedCommands: exportSummary.counters.rejectedCommands,
        fragmentCount: exportSummary.counters.fragmentCount,
        tokenCount: exportSummary.counters.tokenCount,
        commandResultCount: exportSummary.counters.commandResultCount,
        providerAckCount: exportSummary.counters.providerAckCount,
        hostedDispatchCount: exportSummary.counters.hostedDispatchCount,
        externalHandoffCount: exportSummary.counters.externalHandoffCount,
        latestRejectedCommandId: exportSummary.latestRejectedCommand?.commandId || "",
        historySnapshotCount: exportSummary.historySnapshots.length,
        latestTimelineCommandId: exportSummary.analyticsState.timeline.latestCommandId,
        latestTimelineCommand: exportSummary.analyticsState.timeline.latestCommand,
        latestTimelineStatus: exportSummary.analyticsState.timeline.latestStatus,
        latestTimelineHealthLevel: exportSummary.analyticsState.timeline.latestHealthLevel,
        latestReportCommandId: exportSummary.analyticsReporting.latestCommand?.commandId || "",
        latestReportCommandStatus: exportSummary.analyticsReporting.latestCommand?.status || "",
        providerDispatchAverageAckLatencyMs: exportSummary.analyticsReporting.providerDispatchReport.averageAckLatencyMs,
        providerDispatchLatestOutboxId: exportSummary.analyticsReporting.providerDispatchReport.latestOutboxId,
        providerDispatchLatestStatus: exportSummary.analyticsReporting.providerDispatchReport.latestDispatchStatus,
        lifecycleEnabled: exportSummary.settings.enabled,
        scheduleEnabled: exportSummary.settings.schedule.enabled,
        nextRunAt: exportSummary.settings.schedule.nextRunAt,
        lifecycleControlSchema: lifecycleControls.schema,
        lifecycleControlIssueCount: lifecycleControls.issues.length,
        lifecycleControlsReady: lifecycleControls.readyForLifecycleMutation,
        scheduleDue: lifecycleControls.schedule.due,
        scheduleOverdueMinutes: lifecycleControls.schedule.overdueMinutes,
        workspacePolicySchema: exportSummary.workspacePolicy.schema,
        workspacePolicyLocked: exportSummary.workspacePolicy.locked,
        workspacePolicyMaxFragments: exportSummary.workspacePolicy.maxFragments,
        workspacePolicyRemainingSlots: exportSummary.workspacePolicy.remainingFragmentSlots,
        boundaryAllowed: previewAcceptance.validation.boundaryAllowed,
        boundaryViolationCount: previewAcceptance.validation.boundaryViolationCount,
        providerId: exportSummary.providerContract.providerId,
        providerMode: exportSummary.providerContract.mode,
        providerCapabilities: exportSummary.providerContract.capabilities,
        providerSyncGeneration: exportSummary.providerContract.sync.generation,
        externalHandoffRequired: exportSummary.providerContract.externalHandoff.required,
        providerServiceContractSchema: exportSummary.providerServiceContract.schema,
        providerNegotiationAccepted: exportSummary.providerServiceContract.negotiation.accepted,
        providerRouteReady: exportSummary.providerServiceContract.route.ready,
        providerSyncHighWatermarkGeneration: exportSummary.providerServiceContract.syncMetadata.highWatermarkGeneration,
        providerPendingAckOutboxId: exportSummary.providerServiceContract.pendingAck?.outboxId || "",
        pendingProviderDispatches: exportSummary.providerOutbox.pendingCount,
        staleProviderDispatches: exportSummary.providerOutbox.staleCount,
        expiredProviderDispatches: exportSummary.providerOutbox.expiredCount,
        providerRetryAfterMs: exportSummary.providerOutbox.retryAfterMs,
        providerOperationalLevel: previewAcceptance.readiness.providerOperationalLevel,
        readyForNextCommand: previewAcceptance.readiness.ready,
        validationIssueCount: previewAcceptance.validation.issueCount,
        validationBlockingIssueCount: previewAcceptance.validation.blockingIssueCount,
        validationPrimaryIssueCode: previewAcceptance.validation.primaryIssue?.code || "",
        validationPrimaryIssueAction: previewAcceptance.validation.primaryIssue?.nextStep?.action || "",
        previewRowCount: previewAcceptance.preview.rows.length,
        previewRouteContractSchema: previewAcceptance.routeContract.schema,
        previewRouteNextCommand: previewAcceptance.routeContract.request?.command || "",
        previewContinuationToken: previewAcceptance.routeContract.continuationToken,
        clientWorkflowSchema: clientWorkflow.schema,
        clientWorkflowAction: clientWorkflow.action,
        clientWorkflowBlocked: clientWorkflow.blocked,
        clientRuntimeAdoptionSchema: clientWorkflow.runtimeAdoption.schema,
        clientRuntimeAdoptionState: clientWorkflow.runtimeAdoption.adoptionState,
        clientRuntimeAdoptionAccepted: clientWorkflow.runtimeAdoption.acceptedByClient,
        clientRuntimeAdoptionPendingCount: clientWorkflow.runtimeAdoption.providerOutbox.pendingCount,
        clientRuntimeAdoptionRequiredCount: clientWorkflow.runtimeAdoption.providerOutbox.adoptionRequiredCount,
        clientRuntimeAdoptionAckRequired: clientWorkflow.runtimeAdoption.handoff.ackRequired,
        clientRuntimeAdoptionNextAckCommand: clientWorkflow.runtimeAdoption.handoff.nextAckRequest?.command || "",
        clientRuntimeAdoptionTokenCurrent: clientWorkflow.runtimeAdoption.stateCursor.requestedTokenCurrent,
        clientValidationSchema: clientWorkflow.validation.schema,
        clientValidationPrimaryIssueCode: clientWorkflow.validation.primaryIssue?.code || "",
        clientGenerationChanged: clientWorkflow.stateCursor.changed,
        clientProviderHandoffOutboxId: clientWorkflow.providerHandoff?.outboxId || ""
      },
      clientRuntime,
      clientWorkflow,
      actorScope: {
        actorId: actor.actorId,
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        role: actor.role,
        permissions: actor.permissions
      },
      boundaryProof: {
        scopedFragmentCount: scopedFragments.length,
        persistedFragmentCount: commandResult.state.fragments.length,
        publicStateFiltered: scopedFragments.length !== commandResult.state.fragments.length,
        policyScopeKey: exportSummary.workspacePolicy.tenantId
          ? `${exportSummary.workspacePolicy.tenantId}/${exportSummary.workspacePolicy.workspaceId}`
          : actor.scopeKey,
        policyLocked: exportSummary.workspacePolicy.locked,
        policyMaxFragments: exportSummary.workspacePolicy.maxFragments,
        policyRemainingFragmentSlots: exportSummary.workspacePolicy.remainingFragmentSlots,
        policyMaxFragmentBytes: exportSummary.workspacePolicy.maxFragmentBytes,
        policyRoleGrants: exportSummary.workspacePolicy.roleGrants,
        auditHandoffRequired: exportSummary.workspacePolicy.auditHandoffRequired,
        commandBoundaryDecision: commandResult.proof?.boundaryDecision || null,
        tenantIsolation: true,
        workspaceIsolation: true
      },
      statusSemantics: {
        idle: 'no searchable fragments are currently persisted',
        restored: 'persisted fragments were shaped into a queryable index',
        searching: 'async provider dispatches are pending and must be acknowledged before restart-safe restored status',
        degraded: 'persistence was normalized with warnings; scoped queries continue while writes are held',
        failed: 'last command was rejected or recovery repaired invalid state'
      },
      operationalHealth: {
        level: health.level,
        mode: health.mode,
        canQuery: health.canQuery,
        canIndex: health.canIndex,
        pendingProviderDispatches: exportSummary.providerOutbox.pendingCount,
        staleProviderDispatches: exportSummary.providerOutbox.staleCount,
        expiredProviderDispatches: exportSummary.providerOutbox.expiredCount,
        retryAfterMs: exportSummary.providerOutbox.retryAfterMs,
        providerOperation: health.providerOperation,
        guidance: health.guidance,
        lastFailure: health.lastFailure
      },
      lifecycleControls: {
        enabled: commandResult.state.settings.enabled,
        queryEnabled: commandResult.state.settings.queryEnabled,
        indexingEnabled: commandResult.state.settings.indexingEnabled,
        schedule: commandResult.state.settings.schedule,
        updatedAt: commandResult.state.settings.updatedAt,
        updatedBy: commandResult.state.settings.updatedBy,
        contract: lifecycleControls,
        nextAction,
        readiness: previewAcceptance.readiness
      },
      providerContract: {
        providerId: commandResult.state.providerContract.providerId,
        service: commandResult.state.providerContract.service,
        mode: commandResult.state.providerContract.mode,
        endpointId: commandResult.state.providerContract.endpointId,
        capabilities: commandResult.state.providerContract.capabilities,
        sync: commandResult.state.providerContract.sync,
        externalHandoff: commandResult.state.providerContract.externalHandoff,
        issues: commandResult.state.providerContract.issues,
        serviceContract: exportSummary.providerServiceContract,
        canServeQuery: providerSupportsCommand(commandResult.state.providerContract, "query"),
        canServeIndex: providerSupportsCommand(commandResult.state.providerContract, "index-fragment")
      },
      providerExecution: {
        ...providerExecutionSnapshot(commandResult.state.providerContract),
        hostedRoute: HOSTED_KERNEL_ROUTE,
        commandRoutedToHost: commandResult.proof?.hostedInvocation !== null && commandResult.proof?.hostedInvocation !== undefined,
        externalHandoffId: commandResult.proof?.externalHandoff?.handoffId || "",
        providerOutboxId: commandResult.proof?.providerOutboxEntry?.outboxId || "",
        providerAcked: commandResult.proof?.providerAcked === true,
        ackedProviderCommandId: commandResult.proof?.ackedProviderCommandId || "",
        pendingProviderDispatches: exportSummary.providerOutbox.pendingCount
      },
      reportingTimeline: {
        generatedAt: exportSummary.generatedAt,
        sampleLimit: EXPORT_SAMPLE_LIMIT,
        historyLimit: REPORTING_HISTORY_LIMIT,
        exportReady: exportSummary.exportReadySummary.ready,
        exportCursor: exportSummary.exportReadySummary.exportCursor,
        firstSnapshotType: exportSummary.historySnapshots[0]?.type || "",
        latestSnapshotType: exportSummary.historySnapshots.at(-1)?.type || "",
        latestSnapshotStatus: exportSummary.historySnapshots.at(-1)?.status || commandResult.state.status
      }
    },
    evidence: [
      ...evidence,
      {
        type: 'memory-search-state-proof',
        schemaVersion: SCHEMA_VERSION,
        status: commandResult.state.status,
        generation: commandResult.state.generation,
        scopedFragmentCount: scopedFragments.length,
        persistedFragmentCount: commandResult.state.fragments.length,
        journalDepth: commandResult.state.journal.length,
        healthLevel: health.level,
        healthMode: health.mode,
        degradedMode: health.mode === "read-only-degraded",
        retryAfterMs: commandResult.state.lastFailure?.retryAfterMs || 0,
        lifecycle: {
          enabled: commandResult.state.settings.enabled,
          queryEnabled: commandResult.state.settings.queryEnabled,
          indexingEnabled: commandResult.state.settings.indexingEnabled,
          scheduleEnabled: commandResult.state.settings.schedule.enabled,
          nextRunAt: commandResult.state.settings.schedule.nextRunAt,
          scheduleDue: lifecycleControls.schedule.due,
          scheduleOverdueMinutes: lifecycleControls.schedule.overdueMinutes,
          lifecycleControlIssueCount: lifecycleControls.issues.length,
          lifecycleControlsReady: lifecycleControls.readyForLifecycleMutation,
          allowedLifecycleCommands: Object.entries(lifecycleControls.commands)
            .filter(([, control]) => control.allowed)
            .map(([commandName]) => commandName),
          nextAction: nextAction.action,
          nextActionBlocked: nextAction.blocked
        },
        workspacePolicy: {
          schema: exportSummary.workspacePolicy.schema,
          locked: exportSummary.workspacePolicy.locked,
          maxFragments: exportSummary.workspacePolicy.maxFragments,
          maxFragmentBytes: exportSummary.workspacePolicy.maxFragmentBytes,
          remainingFragmentSlots: exportSummary.workspacePolicy.remainingFragmentSlots,
          allowCrossWorkspaceQuery: exportSummary.workspacePolicy.allowCrossWorkspaceQuery,
          allowClear: exportSummary.workspacePolicy.allowClear,
          auditHandoffRequired: exportSummary.workspacePolicy.auditHandoffRequired,
          boundaryAllowed: previewAcceptance.validation.boundaryAllowed,
          boundaryViolationCount: previewAcceptance.validation.boundaryViolationCount
        },
        providerContract: {
          providerId: commandResult.state.providerContract.providerId,
          mode: commandResult.state.providerContract.mode,
          endpointId: commandResult.state.providerContract.endpointId,
          capabilities: commandResult.state.providerContract.capabilities,
          syncCursor: commandResult.state.providerContract.sync.cursor,
          syncGeneration: commandResult.state.providerContract.sync.generation,
          externalHandoffRequired: commandResult.state.providerContract.externalHandoff.required,
          negotiationAccepted: exportSummary.providerServiceContract.negotiation.accepted,
          routeReady: exportSummary.providerServiceContract.route.ready,
          syncHighWatermarkGeneration: exportSummary.providerServiceContract.syncMetadata.highWatermarkGeneration,
          pendingAckOutboxId: exportSummary.providerServiceContract.pendingAck?.outboxId || "",
          issueCount: commandResult.state.providerContract.issues.length
        },
        providerOutbox: {
          pendingCount: exportSummary.providerOutbox.pendingCount,
          staleCount: exportSummary.providerOutbox.staleCount,
          expiredCount: exportSummary.providerOutbox.expiredCount,
          retryAfterMs: exportSummary.providerOutbox.retryAfterMs,
          limit: exportSummary.providerOutbox.limit,
          latestOutboxId: commandResult.proof?.providerOutboxEntry?.outboxId || "",
          latestDispatchType: commandResult.proof?.providerOutboxEntry?.dispatchType || ""
        },
        providerExecution: {
          ...providerExecutionSnapshot(commandResult.state.providerContract),
          commandRoutedToHost: commandResult.proof?.hostedInvocation !== null && commandResult.proof?.hostedInvocation !== undefined,
          externalHandoffId: commandResult.proof?.externalHandoff?.handoffId || "",
          providerOutboxId: commandResult.proof?.providerOutboxEntry?.outboxId || ""
        },
        previewAcceptance: {
          schema: previewAcceptance.schema,
          accepted: previewAcceptance.acceptance.accepted,
          ready: previewAcceptance.readiness.ready,
          lifecycleControlsReady: previewAcceptance.readiness.lifecycleControlsReady,
          nextAction: previewAcceptance.nextStep.action,
          validationValid: previewAcceptance.validation.valid,
          blockingIssueCount: previewAcceptance.validation.blockingIssueCount,
          issueCatalogCount: previewAcceptance.validation.issueCatalog.length,
          primaryIssueCode: previewAcceptance.validation.primaryIssue?.code || "",
          nextValidationCommand: previewAcceptance.validation.nextValidationRequest?.command || "",
          previewRowCount: previewAcceptance.preview.rows.length,
          routeContractSchema: previewAcceptance.routeContract.schema,
          routeNextCommand: previewAcceptance.routeContract.request?.command || "",
          continuationToken: previewAcceptance.routeContract.continuationToken,
          providerOutboxId: previewAcceptance.nextStep.providerOutboxId,
          externalHandoffId: previewAcceptance.nextStep.externalHandoffId,
          providerOperationalLevel: previewAcceptance.readiness.providerOperationalLevel,
          providerRetryAfterMs: previewAcceptance.readiness.providerRetryAfterMs,
          providerAcked: previewAcceptance.nextStep.providerAcked,
          ackedProviderCommandId: previewAcceptance.nextStep.ackedProviderCommandId
        },
        clientWorkflow: {
          schema: clientWorkflow.schema,
          requestId: clientWorkflow.requestId,
          action: clientWorkflow.action,
          blocked: clientWorkflow.blocked,
          stateGeneration: clientWorkflow.stateCursor.generation,
          stateChanged: clientWorkflow.stateCursor.changed,
          providerOutboxId: clientWorkflow.providerHandoff?.outboxId || "",
          ackRequired: clientWorkflow.providerHandoff?.ackRequired === true,
          runtimeAdoptionSchema: clientWorkflow.runtimeAdoption.schema,
          runtimeAdoptionState: clientWorkflow.runtimeAdoption.adoptionState,
          runtimeAcceptedByClient: clientWorkflow.runtimeAdoption.acceptedByClient,
          runtimePendingOutboxCount: clientWorkflow.runtimeAdoption.providerOutbox.pendingCount,
          runtimeAdoptionRequiredCount: clientWorkflow.runtimeAdoption.providerOutbox.adoptionRequiredCount,
          runtimeKnownOutboxCount: clientWorkflow.runtimeAdoption.providerOutbox.knownCount,
          runtimeNextAckCommand: clientWorkflow.runtimeAdoption.handoff.nextAckRequest?.command || "",
          runtimeNextAckOutboxId: clientWorkflow.runtimeAdoption.handoff.nextAckRequest?.outboxId || "",
          runtimeContinuationToken: clientWorkflow.runtimeAdoption.stateCursor.continuationToken,
          runtimeRequestedTokenCurrent: clientWorkflow.runtimeAdoption.stateCursor.requestedTokenCurrent,
          validationIssueCount: clientWorkflow.validation.issueCount,
          validationPrimaryIssueCode: clientWorkflow.validation.primaryIssue?.code || "",
          nextValidationCommand: clientWorkflow.validation.nextValidationRequest?.command || "",
          retryBackoff: clientWorkflow.retryBackoff,
          resultCount: clientWorkflow.resultEnvelope.resultCount
        },
        analytics: {
          schema: exportSummary.analyticsState.schema,
          exportReady: exportSummary.exportReadySummary.ready,
          exportCursor: exportSummary.exportReadySummary.exportCursor,
          reportSections: exportSummary.exportReadySummary.reportSections,
          reportCursor: exportSummary.analyticsReporting.reportCursor,
          totalCommands: exportSummary.counters.totalCommands,
          appliedCommands: exportSummary.counters.appliedCommands,
          rejectedCommands: exportSummary.counters.rejectedCommands,
          commandResultCount: exportSummary.counters.commandResultCount,
          providerAckCount: exportSummary.counters.providerAckCount,
          hostedDispatchCount: exportSummary.counters.hostedDispatchCount,
          externalHandoffCount: exportSummary.counters.externalHandoffCount,
          rejectionReasons: exportSummary.counters.rejectionReasons,
          tokenSample: exportSummary.tokenSample,
          historySnapshotCount: exportSummary.historySnapshots.length,
          commandReportRowCount: exportSummary.exportReadySummary.commandReportRowCount,
          providerDispatchReportRowCount: exportSummary.exportReadySummary.providerDispatchReportRowCount,
          providerDispatchAverageAckLatencyMs: exportSummary.analyticsReporting.providerDispatchReport.averageAckLatencyMs,
          latestReportCommandId: exportSummary.analyticsReporting.latestCommand?.commandId || "",
          latestTimelineCommandId: exportSummary.analyticsState.timeline.latestCommandId,
          latestTimelineStatus: exportSummary.analyticsState.timeline.latestStatus
        },
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        actorRole: actor.role
      }
    ]
  };
}

export default describeMemorySearchSurface;
