import {
  RECOVERY_STATUS,
  createRecoveryHandoff,
  createRecoveryStatus,
  createProviderServiceContract,
  mergeRecoveryStatuses,
  validateProviderServiceContract
} from "./recovery-api.mjs";

export const RUNTIME_CONTRACT_VERSION = "aios.language.runtime.v1";

const DIRECTIVE_PATTERN = /^\s*(?:\/\/|#)?\s*@([a-z][a-z-]*)\s*(.*)$/i;

const DEFAULT_RUNTIME_PROVIDER_CAPABILITIES = Object.freeze([
  "mailchimp.audience:read",
  "mailchimp.campaign:write",
  "mailchimp.report:read"
]);

export function compileRuntimeContract(source = "", options = {}) {
  const text = String(source ?? "");
  const directives = parseRuntimeDirectives(text);
  const job = createKernelJobContract(text, directives, options);
  const boundary = createRuntimeBoundaryContract(directives, options);
  const capabilities = createCapabilityContracts(directives.capability, boundary);
  const memory = createMemoryContracts(directives.memory, boundary);
  const claims = createClaimContracts(directives.claim, job.id, boundary);
  const audit = createRuntimeAuditHandoff({ job, boundary, capabilities, memory, claims });
  const verifier = createVerifierContract(directives.verify, { job, capabilities, memory, claims, boundary, audit });
  const analytics = createRuntimeAnalyticsContract({ source: text, directives, job, boundary, capabilities, memory, claims, verifier, audit });
  const provider = createRuntimeProviderContract({ directives, options, job, boundary, capabilities, audit, analytics });
  const recovery = createRuntimeRecovery({ job, capabilities, memory, claims, verifier, boundary, audit, analytics, provider }, options);
  const status = recovery.handoffRequired ? recovery.recovery.status : RECOVERY_STATUS.READY;
  return Object.freeze({
    version: RUNTIME_CONTRACT_VERSION,
    kind: "aios.language.runtime-contract",
    job,
    boundary,
    capabilities,
    memory,
    verifier,
    claims,
    audit,
    provider,
    analytics,
    recovery,
    status
  });
}

export function parseRuntimeDirectives(source = "") {
  const directives = {
    job: [],
    capability: [],
    memory: [],
    verify: [],
    claim: [],
    tenant: [],
    workspace: [],
    role: [],
    permission: [],
    audit: [],
    provider: [],
    service: [],
    endpoint: [],
    sync: []
  };
  String(source ?? "").split(/\r?\n/).forEach((line, index) => {
    const match = line.match(DIRECTIVE_PATTERN);
    if (!match) return;
    const type = match[1].toLowerCase();
    if (!Object.hasOwn(directives, type)) return;
    directives[type].push(Object.freeze({ value: match[2].trim(), line: index + 1 }));
  });
  return Object.freeze(Object.fromEntries(Object.entries(directives).map(([key, value]) => [key, Object.freeze(value)])));
}

export function validateRuntimeContract(contract) {
  const errors = [];
  if (!contract || contract.version !== RUNTIME_CONTRACT_VERSION) errors.push("runtime contract version mismatch");
  if (!contract?.job?.id) errors.push("runtime job id is required");
  if (!Array.isArray(contract?.capabilities)) errors.push("capability contracts must be an array");
  if (!Array.isArray(contract?.memory)) errors.push("memory contracts must be an array");
  if (!contract?.boundary?.tenantId) errors.push("runtime tenant boundary is required");
  if (!contract?.boundary?.workspaceId) errors.push("runtime workspace boundary is required");
  if (!Array.isArray(contract?.boundary?.roles)) errors.push("runtime roles boundary must be an array");
  if (!Array.isArray(contract?.boundary?.permissions)) errors.push("runtime permissions boundary must be an array");
  if (Array.isArray(contract?.capabilities)) {
    for (const capability of contract.capabilities) {
      if (capability.allowed !== true) errors.push(`capability permission denied: ${capability.name}:${capability.mode}`);
    }
  }
  if (!contract?.verifier?.digest) errors.push("verifier digest is required");
  if (!contract?.recovery?.recovery?.status) errors.push("recovery handoff is required");
  const providerValidation = validateProviderServiceContract(contract?.provider);
  if (!providerValidation.ok) errors.push(...providerValidation.errors.map((error) => `provider:${error}`));
  if (contract?.provider?.negotiation?.missing?.length > 0 && contract?.status !== RECOVERY_STATUS.BLOCKED) {
    errors.push("runtime status must be blocked when provider capabilities are missing");
  }
  if (!contract?.analytics?.summary?.exportName) errors.push("runtime analytics export summary is required");
  if (contract?.analytics?.counters?.capabilities !== contract?.capabilities?.length) errors.push("runtime analytics capability counter mismatch");
  if (contract?.analytics?.counters?.claims !== contract?.claims?.length) errors.push("runtime analytics claim counter mismatch");
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function selfCheckRuntimeApi() {
  const contract = compileRuntimeContract(`
@job sync-mailchimp-audience
@tenant mailchimp-us
@workspace marketing-ops
@role audience-manager
@permission mailchimp.audience:read
@permission mailchimp.campaign:write
@audit mailchimp.runtime.contract
@provider mailchimp
@service marketing-runtime
@endpoint status=https://status.example.invalid/mailchimp sync=https://sync.example.invalid/mailchimp recovery=https://recover.example.invalid/mailchimp
@sync cursor=audience:001 watermark=checkpoint:001 schedule=immediate
@capability mailchimp.audience:read
@capability mailchimp.campaign:write
@memory audience-cache durable ttl=3600
@claim consent-boundary audience contacts require opt-in
@verify claims>=1
`);
  const validation = validateRuntimeContract(contract);
  return Object.freeze({
    ok: validation.ok
      && contract.capabilities.length === 2
      && contract.claims.length === 1
      && contract.provider.negotiation.complete === true
      && contract.boundary.workspaceId === "marketing-ops",
    validation,
    sample: contract
  });
}

function createKernelJobContract(source, directives, options) {
  const explicitName = directives.job[0]?.value;
  const name = normalizeIdentifier(explicitName || options.name || "aios-job");
  const sourceDigest = stableDigest(source);
  return Object.freeze({
    id: `job_${sourceDigest}`,
    name,
    sourceDigest,
    priority: normalizePriority(options.priority),
    entrypoint: String(options.entrypoint || "main")
  });
}

function createRuntimeBoundaryContract(directives, options) {
  const tenantId = normalizeIdentifier(directives.tenant[0]?.value || options.tenantId || options.tenant || "default-tenant");
  const workspaceId = normalizeIdentifier(directives.workspace[0]?.value || options.workspaceId || options.workspace || "default-workspace");
  const optionRoles = Array.isArray(options.roles) ? options.roles : [options.role].filter(Boolean);
  const roles = normalizeBoundaryList([...directives.role.map((entry) => entry.value), ...optionRoles], "runtime-executor");
  const optionPermissions = Array.isArray(options.permissions) ? options.permissions : [options.permission].filter(Boolean);
  const permissions = normalizePermissionContracts([...directives.permission.map((entry) => entry.value), ...optionPermissions]);
  const auditSink = normalizeAuditSink(directives.audit[0]?.value || options.auditSink || options.audit || "runtime.audit");
  const enforcePermissions = Boolean(options.enforcePermissions) || permissions.length > 0;
  const tenantMismatch = options.expectedTenantId && normalizeIdentifier(options.expectedTenantId) !== tenantId;
  const workspaceMismatch = options.expectedWorkspaceId && normalizeIdentifier(options.expectedWorkspaceId) !== workspaceId;
  return Object.freeze({
    tenantId,
    workspaceId,
    roles,
    permissions,
    auditSink,
    enforcePermissions,
    tenantMismatch: Boolean(tenantMismatch),
    workspaceMismatch: Boolean(workspaceMismatch),
    isolationKey: stableDigest(`${tenantId}:${workspaceId}:${roles.join(",")}`),
    deterministicScope: `${tenantId}/${workspaceId}`
  });
}

function createCapabilityContracts(entries, boundary) {
  return Object.freeze(entries.map((entry) => {
    const [rawName, rawMode = "use"] = entry.value.split(":");
    const name = normalizeDottedName(rawName);
    const mode = normalizeCapabilityMode(rawMode);
    const permission = selectPermission(name, mode, boundary);
    const allowed = boundary.enforcePermissions ? permission.allowed : true;
    return Object.freeze({
      id: `cap_${stableDigest(`${name}:${mode}`)}`,
      name,
      mode,
      line: entry.line,
      required: true,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      permission: permission.key,
      allowed
    });
  }));
}

function createMemoryContracts(entries, boundary) {
  return Object.freeze(entries.map((entry) => {
    const [rawName, rawDurability = "ephemeral", ...attributes] = entry.value.split(/\s+/);
    const attributesMap = Object.fromEntries(attributes.map((attribute) => {
      const [key, value = "true"] = attribute.split("=");
      return [normalizeIdentifier(key), value];
    }));
    return Object.freeze({
      id: `mem_${stableDigest(entry.value)}`,
      name: normalizeIdentifier(rawName || "scratch"),
      durability: rawDurability === "durable" ? "durable" : "ephemeral",
      attributes: Object.freeze(attributesMap),
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      isolationKey: boundary.isolationKey,
      line: entry.line
    });
  }));
}

function createClaimContracts(entries, jobId, boundary) {
  return Object.freeze(entries.map((entry, index) => {
    const [rawName, ...text] = entry.value.split(/\s+/);
    const name = normalizeIdentifier(rawName || `claim-${index + 1}`);
    const body = text.join(" ").trim();
    return Object.freeze({
      id: `claim_${stableDigest(`${jobId}:${name}:${body}`)}`,
      name,
      body,
      tenantId: boundary.tenantId,
      workspaceId: boundary.workspaceId,
      line: entry.line,
      verified: false
    });
  }));
}

function createVerifierContract(entries, context) {
  const rules = entries.length > 0 ? entries.map((entry) => entry.value) : ["claims>=0", "capabilities>=0"];
  const digestInput = JSON.stringify({
    job: context.job.id,
    capabilities: context.capabilities.map((capability) => capability.id),
    memory: context.memory.map((slot) => slot.id),
    claims: context.claims.map((claim) => claim.id),
    boundary: context.boundary.isolationKey,
    audit: context.audit.auditId,
    rules
  });
  return Object.freeze({
    id: `verifier_${stableDigest(digestInput)}`,
    digest: stableDigest(digestInput),
    rules: Object.freeze(rules),
    requiredClaims: context.claims.length,
    boundaryDigest: stableDigest(`${context.boundary.tenantId}:${context.boundary.workspaceId}`),
    auditId: context.audit.auditId
  });
}

function createRuntimeProviderContract({ directives, options, job, boundary, capabilities, audit, analytics }) {
  const directiveProvider = directives.provider[0]?.value;
  const directiveService = directives.service[0]?.value;
  const endpointDirectives = Object.assign({}, ...directives.endpoint.map((entry) => parseRuntimeKeyValueList(entry.value)));
  const syncDirectives = Object.assign({}, ...directives.sync.map((entry) => parseRuntimeKeyValueList(entry.value)));
  const requiredCapabilities = capabilities.map((capability) => `${capability.name}:${capability.mode}`);
  const offeredCapabilities = options.providerCapabilities
    || options.offeredCapabilities
    || (requiredCapabilities.length > 0 ? requiredCapabilities : DEFAULT_RUNTIME_PROVIDER_CAPABILITIES);
  const status = analytics?.summary?.status || RECOVERY_STATUS.DEGRADED;
  return createProviderServiceContract({
    provider: directiveProvider || options.provider || options.adapter || "mailchimp",
    service: directiveService || options.providerService || `${job.name}-runtime`,
    requiredCapabilities,
    offeredCapabilities,
    optionalCapabilities: options.optionalProviderCapabilities || options.optionalCapabilities || [],
    capabilityAliases: options.providerCapabilityAliases || options.capabilityAliases,
    endpoints: {
      statusEndpoint: endpointDirectives.status || options.statusEndpoint,
      syncEndpoint: endpointDirectives.sync || endpointDirectives.endpoint || options.syncEndpoint,
      recoveryEndpoint: endpointDirectives.recovery || options.recoveryEndpoint
    },
    sync: {
      cursor: syncDirectives.cursor || options.syncCursor || `runtime:${job.sourceDigest || job.id}`,
      watermark: syncDirectives.watermark || options.syncWatermark || audit.auditId,
      schedule: syncDirectives.schedule || (status === RECOVERY_STATUS.READY ? "immediate" : status === RECOVERY_STATUS.BLOCKED ? "manual-approval" : "manual-review"),
      retryAfterMs: syncDirectives.retryAfterMs || options.syncRetryAfterMs || (status === RECOVERY_STATUS.READY ? 0 : 2000),
      maxAttempts: syncDirectives.maxAttempts || options.syncMaxAttempts || (status === RECOVERY_STATUS.BLOCKED ? 0 : 3),
      mode: syncDirectives.mode || options.syncMode || "incremental"
    },
    signal: options.providerStatus || options.serviceStatus,
    enabled: options.providerEnabled ?? options.enabled
  });
}

function parseRuntimeKeyValueList(value = "") {
  const entries = String(value || "").trim().split(/\s+/).filter(Boolean);
  return Object.freeze(Object.fromEntries(entries.map((entry) => {
    const [rawKey, ...rawValue] = entry.split("=");
    return [normalizeIdentifier(rawKey), rawValue.join("=") || "true"];
  })));
}

function createRuntimeRecovery(context, options) {
  const issues = [];
  if (context.capabilities.length === 0) issues.push("no capability directives declared");
  if (context.claims.length === 0) issues.push("no claim directives declared");
  if (!context.boundary.tenantId || context.boundary.tenantId === "default-tenant") issues.push("tenant boundary defaulted");
  if (!context.boundary.workspaceId || context.boundary.workspaceId === "default-workspace") issues.push("workspace boundary defaulted");
  if (context.boundary.tenantMismatch) issues.push("tenant boundary mismatch");
  if (context.boundary.workspaceMismatch) issues.push("workspace boundary mismatch");
  for (const capability of context.capabilities) {
    if (capability.allowed !== true) issues.push(`permission denied for ${capability.name}:${capability.mode}`);
  }
  const hasBoundaryFailure = issues.some((issue) => issue.includes("mismatch") || issue.includes("permission denied"));
  const status = hasBoundaryFailure ? RECOVERY_STATUS.BLOCKED : issues.length > 0 ? RECOVERY_STATUS.DEGRADED : RECOVERY_STATUS.READY;
  const adapterRecovery = options.adapterStatus ? createRecoveryStatus(options.adapterStatus) : createRecoveryStatus();
  const providerRecovery = context.provider?.recovery || createRecoveryStatus();
  const runtimeRecovery = createRecoveryStatus({
    status,
    reason: hasBoundaryFailure ? "runtime-boundary" : "runtime-validation",
    issues,
    recoverable: !hasBoundaryFailure,
    nextAction: hasBoundaryFailure ? "request-boundary-approval" : undefined
  });
  return createRecoveryHandoff({
    stage: "runtime",
    source: context.job.name,
    adapter: {
      name: options.adapter || context.provider?.provider || "kernel",
      statusEndpoint: context.provider?.endpoints?.statusEndpoint || null
    },
    status: mergeRecoveryStatuses([runtimeRecovery, adapterRecovery, providerRecovery]),
    validation: context.analytics?.validation,
    context: {
      subject: context.job.name,
      exportName: context.analytics?.summary?.exportName,
      tenantId: context.boundary.tenantId,
      workspaceId: context.boundary.workspaceId,
      auditId: context.audit.auditId,
      provider: context.provider?.provider,
      providerService: context.provider?.service
    },
    controls: {
      enabled: status !== RECOVERY_STATUS.BLOCKED,
      schedule: status === RECOVERY_STATUS.DEGRADED ? "manual-review" : "immediate"
    }
  });
}

export function createRuntimeProviderReport(contract) {
  const provider = contract?.provider?.kind === "aios.language.provider-service-contract"
    ? contract.provider
    : createRuntimeProviderContract({
      directives: parseRuntimeDirectives(""),
      options: {},
      job: contract?.job || Object.freeze({ id: "job_unknown", name: "unknown" }),
      boundary: contract?.boundary || Object.freeze({ tenantId: "unknown", workspaceId: "unknown" }),
      capabilities: contract?.capabilities || [],
      audit: contract?.audit || Object.freeze({ auditId: "audit_unknown" }),
      analytics: contract?.analytics || Object.freeze({ summary: Object.freeze({ status: RECOVERY_STATUS.DEGRADED }) })
    });
  const validation = validateProviderServiceContract(provider);
  return Object.freeze({
    version: RUNTIME_CONTRACT_VERSION,
    kind: "aios.language.runtime-provider-report",
    ok: validation.ok,
    jobId: contract?.job?.id || "job_unknown",
    provider: provider.provider,
    service: provider.service,
    status: provider.status,
    negotiation: provider.negotiation,
    sync: provider.sync,
    externalHandoff: provider.externalHandoff,
    validation
  });
}

export function createRuntimeExportReport(contract) {
  const validation = validateRuntimeContract(contract);
  const analytics = contract?.analytics || createRuntimeAnalyticsContract({
    source: "",
    directives: parseRuntimeDirectives(""),
    job: contract?.job || Object.freeze({ id: "job_unknown", name: "unknown", sourceDigest: "unknown" }),
    boundary: contract?.boundary || Object.freeze({ tenantId: "unknown", workspaceId: "unknown", isolationKey: "unknown", deterministicScope: "unknown/unknown" }),
    capabilities: contract?.capabilities || [],
    memory: contract?.memory || [],
    claims: contract?.claims || [],
    verifier: contract?.verifier || Object.freeze({ id: "verifier_unknown", digest: "unknown", rules: Object.freeze([]) }),
    audit: contract?.audit || Object.freeze({ auditId: "audit_unknown", eventTypes: Object.freeze([]), deniedCapabilities: Object.freeze([]) })
  });
  return Object.freeze({
    version: RUNTIME_CONTRACT_VERSION,
    kind: "aios.language.runtime-export-report",
    ok: validation.ok,
    exportSummary: analytics.exportSummary,
    counters: analytics.counters,
    timeline: analytics.timeline,
    history: analytics.history,
    validation
  });
}

function createRuntimeAnalyticsContract({ source, directives, job, boundary, capabilities, memory, claims, verifier, audit }) {
  const counters = createRuntimeAnalyticsCounters({ source, directives, capabilities, memory, claims, audit });
  const validation = createRuntimeAnalyticsValidation({ boundary, capabilities, claims, verifier, counters });
  const history = createRuntimeHistorySnapshots({ job, boundary, counters, validation });
  const timeline = createRuntimeTimeline({ job, boundary, capabilities, memory, claims, audit, history });
  const exportSummary = createRuntimeExportSummary({ job, boundary, counters, validation, timeline, verifier, audit });
  return Object.freeze({
    version: RUNTIME_CONTRACT_VERSION,
    kind: "aios.language.runtime-analytics",
    counters,
    validation,
    history,
    timeline,
    exportSummary,
    summary: Object.freeze({
      exportName: exportSummary.name,
      status: exportSummary.status,
      timelineEvents: timeline.length,
      historySnapshots: history.length,
      auditEvents: counters.auditEvents
    })
  });
}

function createRuntimeAnalyticsCounters({ source, directives, capabilities, memory, claims, audit }) {
  const directiveCounts = Object.freeze(Object.fromEntries(Object.entries(directives).map(([key, entries]) => [key, entries.length])));
  const deniedCapabilities = capabilities.filter((capability) => capability.allowed !== true);
  return Object.freeze({
    sourceLines: String(source || "").split(/\r?\n/).filter((line) => line.trim()).length,
    directives: Object.freeze({
      total: Object.values(directiveCounts).reduce((count, value) => count + value, 0),
      byType: directiveCounts
    }),
    capabilities: capabilities.length,
    allowedCapabilities: capabilities.length - deniedCapabilities.length,
    deniedCapabilities: deniedCapabilities.length,
    memorySlots: memory.length,
    durableMemorySlots: memory.filter((slot) => slot.durability === "durable").length,
    claims: claims.length,
    verifierRules: directiveCounts.verify || 0,
    auditEvents: audit.eventTypes?.length || 0
  });
}

function createRuntimeAnalyticsValidation({ boundary, capabilities, claims, verifier, counters }) {
  const errors = [];
  const warnings = [];
  if (boundary.tenantId === "default-tenant") warnings.push("tenant boundary defaulted");
  if (boundary.workspaceId === "default-workspace") warnings.push("workspace boundary defaulted");
  if (boundary.tenantMismatch) errors.push("tenant boundary mismatch");
  if (boundary.workspaceMismatch) errors.push("workspace boundary mismatch");
  if (capabilities.length === 0) warnings.push("no capabilities exported");
  if (claims.length === 0) warnings.push("no claims exported");
  if (!verifier.digest) errors.push("verifier digest missing");
  if (counters.deniedCapabilities > 0) errors.push(`denied capabilities: ${counters.deniedCapabilities}`);
  return Object.freeze({
    ok: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings)
  });
}

function createRuntimeHistorySnapshots({ job, boundary, counters, validation }) {
  return Object.freeze([
    Object.freeze({
      sequence: 1,
      label: "source-parsed",
      jobId: job.id,
      counters: Object.freeze({
        sourceLines: counters.sourceLines,
        directives: counters.directives.total
      })
    }),
    Object.freeze({
      sequence: 2,
      label: "contracts-bound",
      jobId: job.id,
      counters: Object.freeze({
        capabilities: counters.capabilities,
        memorySlots: counters.memorySlots,
        claims: counters.claims
      })
    }),
    Object.freeze({
      sequence: 3,
      label: "export-validated",
      jobId: job.id,
      scope: boundary.deterministicScope,
      validation: Object.freeze({
        ok: validation.ok,
        errors: validation.errorCount,
        warnings: validation.warningCount
      })
    })
  ]);
}

function createRuntimeTimeline({ job, boundary, capabilities, memory, claims, audit, history }) {
  const capabilityEvents = capabilities.map((capability, index) => Object.freeze({
    order: 20 + index,
    type: "capability.export",
    name: capability.name,
    mode: capability.mode,
    status: capability.allowed ? RECOVERY_STATUS.READY : RECOVERY_STATUS.BLOCKED
  }));
  const memoryEvents = memory.map((slot, index) => Object.freeze({
    order: 40 + index,
    type: "memory.export",
    name: slot.name,
    durability: slot.durability
  }));
  const claimEvents = claims.map((claim, index) => Object.freeze({
    order: 60 + index,
    type: "claim.export",
    name: claim.name,
    verified: claim.verified
  }));
  return Object.freeze([
    Object.freeze({
      order: 1,
      type: "runtime.compile",
      jobId: job.id,
      name: job.name,
      scope: boundary.deterministicScope
    }),
    Object.freeze({
      order: 2,
      type: "audit.bind",
      auditId: audit.auditId,
      sink: audit.sink,
      events: audit.eventTypes.length
    }),
    ...capabilityEvents,
    ...memoryEvents,
    ...claimEvents,
    ...history.map((snapshot) => Object.freeze({
      order: 100 + snapshot.sequence,
      type: `history.${snapshot.label}`,
      status: "recorded"
    }))
  ]);
}

function createRuntimeExportSummary({ job, boundary, counters, validation, timeline, verifier, audit }) {
  const status = validation.errorCount > 0
    ? RECOVERY_STATUS.BLOCKED
    : validation.warningCount > 0
      ? RECOVERY_STATUS.DEGRADED
      : RECOVERY_STATUS.READY;
  return Object.freeze({
    name: job.name,
    jobId: job.id,
    sourceDigest: job.sourceDigest,
    status,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    scope: boundary.deterministicScope,
    verifierDigest: verifier.digest,
    auditId: audit.auditId,
    counters,
    timelineEvents: timeline.length,
    generatedAt: "deterministic-compile"
  });
}

function createRuntimeAuditHandoff({ job, boundary, capabilities, memory, claims }) {
  const deniedCapabilities = capabilities.filter((capability) => capability.allowed !== true);
  const eventTypes = [
    "job.compile",
    "boundary.scope",
    capabilities.length > 0 ? "capability.bind" : "capability.empty",
    memory.length > 0 ? "memory.bind" : "memory.empty",
    claims.length > 0 ? "claim.bind" : "claim.empty"
  ];
  return Object.freeze({
    auditId: `audit_${stableDigest(`${job.id}:${boundary.isolationKey}:${boundary.auditSink}`)}`,
    sink: boundary.auditSink,
    tenantId: boundary.tenantId,
    workspaceId: boundary.workspaceId,
    isolationKey: boundary.isolationKey,
    eventTypes: Object.freeze(eventTypes),
    deniedCapabilities: Object.freeze(deniedCapabilities.map((capability) => `${capability.name}:${capability.mode}`)),
    handoffRequired: deniedCapabilities.length > 0 || boundary.tenantMismatch || boundary.workspaceMismatch
  });
}

function normalizePermissionContracts(values) {
  const normalized = values.flatMap((value) => String(value || "").split(",")).map(normalizePermission).filter(Boolean);
  const byKey = new Map(normalized.map((permission) => [permission.key, permission]));
  return Object.freeze([...byKey.values()].map((permission) => Object.freeze(permission)));
}

function normalizePermission(value) {
  const [rawName, rawMode = "*"] = String(value || "").trim().toLowerCase().split(":");
  const name = rawName === "*" ? "*" : normalizeDottedName(rawName || "*");
  const mode = rawMode === "*" ? "*" : normalizeCapabilityMode(rawMode);
  if (!name) return null;
  return {
    key: `${name}:${mode}`,
    name,
    mode
  };
}

function selectPermission(name, mode, boundary) {
  const keys = [`${name}:${mode}`, `${name}:*`, "*:*"];
  const permission = boundary.permissions.find((entry) => keys.includes(entry.key));
  return Object.freeze({
    key: permission?.key || `${name}:${mode}`,
    allowed: Boolean(permission)
  });
}

function normalizeBoundaryList(values, fallback) {
  const normalized = values.flatMap((value) => String(value || "").split(",")).map((value) => normalizeIdentifier(value)).filter(Boolean);
  const unique = [...new Set(normalized)];
  return Object.freeze(unique.length > 0 ? unique : [fallback]);
}

function normalizeAuditSink(value) {
  return normalizeDottedName(value || "runtime.audit");
}

function normalizeCapabilityMode(value) {
  const mode = String(value || "use").trim().toLowerCase();
  return ["read", "write", "execute", "use"].includes(mode) ? mode : "use";
}

function normalizePriority(value = "normal") {
  const priority = String(value || "normal").trim().toLowerCase();
  return ["low", "normal", "high"].includes(priority) ? priority : "normal";
}

function normalizeDottedName(value = "capability") {
  return String(value || "capability").trim().toLowerCase().replace(/[^a-z0-9.]+/g, ".").replace(/^\.+|\.+$/g, "") || "capability";
}

function normalizeIdentifier(value = "item") {
  return String(value || "item").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function stableDigest(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}
