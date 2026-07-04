import { compileRuntimeContract, createRuntimeProviderReport, validateRuntimeContract } from "./runtime-api.mjs";
import {
  RECOVERY_STATUS,
  createRecoveryHandoff,
  createRecoveryLifecycleState,
  createRecoveryStatus
} from "./recovery-api.mjs";

export const STDLIB_CONTRACT_VERSION = "aios.language.stdlib.v1";

const DEFAULT_MAILCHIMP_TOOLS = Object.freeze([
  Object.freeze({
    name: "mailchimp.audience.lookup",
    capability: "mailchimp.audience:read",
    memory: "mailchimp-audience-cache durable ttl=3600",
    claim: "consent-boundary lookup requires audience opt-in before contact enrichment"
  }),
  Object.freeze({
    name: "mailchimp.campaign.draft",
    capability: "mailchimp.campaign:write",
    memory: "mailchimp-campaign-drafts durable ttl=86400",
    claim: "draft-safety campaign drafts remain unpublished until explicit approval"
  }),
  Object.freeze({
    name: "mailchimp.report.summarize",
    capability: "mailchimp.report:read",
    memory: "mailchimp-report-cache ephemeral ttl=900",
    claim: "metric-trace summaries cite source campaign report identifiers"
  })
]);

export function createStdlibContract(input = {}) {
  const namespace = normalizeNamespace(input.namespace || "mailchimp");
  const tools = normalizeTools(input.tools || DEFAULT_MAILCHIMP_TOOLS, namespace);
  const runtimeContracts = tools.map((tool) => compileRuntimeContract(toolToSource(tool), {
    name: tool.name,
    adapter: input.adapter || namespace,
    adapterStatus: input.adapterStatus,
    tenantId: input.tenantId || input.tenant,
    workspaceId: input.workspaceId || input.workspace,
    roles: input.roles,
    permissions: tool.permissions || input.permissions,
    enforcePermissions: input.enforcePermissions,
    auditSink: input.auditSink || `${namespace}.stdlib.audit`
  }));
  const health = createStdlibHealthContract({ namespace, tools, runtimeContracts, adapterStatus: input.adapterStatus });
  const analytics = createStdlibAnalyticsContract({ namespace, tools, runtimeContracts, health });
  const validation = validateStdlibContractShape(tools, runtimeContracts, health);
  const recovery = createStdlibRecovery(namespace, validation, health, analytics, input.adapterStatus);
  const workflow = createStdlibWorkflowPreview({ namespace, tools, runtimeContracts, health, analytics, validation, recovery });
  return Object.freeze({
    version: STDLIB_CONTRACT_VERSION,
    kind: "aios.language.stdlib-contract",
    namespace,
    tools: Object.freeze(tools),
    runtimeContracts: Object.freeze(runtimeContracts),
    health,
    analytics,
    workflow,
    recovery,
    status: recovery.recovery.status
  });
}

export function createMailchimpStdlibContract(options = {}) {
  return createStdlibContract({ ...options, namespace: "mailchimp", tools: options.tools || DEFAULT_MAILCHIMP_TOOLS });
}

export function validateStdlibContract(contract) {
  const errors = [];
  if (!contract || contract.version !== STDLIB_CONTRACT_VERSION) errors.push("stdlib contract version mismatch");
  if (!contract?.namespace) errors.push("stdlib namespace is required");
  if (!Array.isArray(contract?.tools) || contract.tools.length === 0) errors.push("stdlib tools are required");
  if (!contract?.health?.summary?.status) errors.push("stdlib health summary is required");
  if (!contract?.analytics?.exportSummary?.namespace) errors.push("stdlib analytics export summary is required");
  if (!contract?.workflow?.preview?.nextStep?.action) errors.push("stdlib workflow preview next step is required");
  if (!contract?.workflow?.readiness?.validationSummary) errors.push("stdlib workflow readiness validation is required");
  if (contract?.health?.summary?.status === RECOVERY_STATUS.FAILED) errors.push("stdlib health cannot be failed at compile time");
  if (contract?.analytics?.counters?.tools !== contract?.tools?.length) errors.push("stdlib analytics tool counter mismatch");
  for (const runtime of contract?.runtimeContracts || []) {
    const result = validateRuntimeContract(runtime);
    if (!result.ok) errors.push(...result.errors.map((error) => `runtime:${error}`));
  }
  return Object.freeze({ ok: errors.length === 0, errors });
}

export function selfCheckStdlibApi() {
  const contract = createMailchimpStdlibContract();
  const validation = validateStdlibContract(contract);
  return Object.freeze({
    ok: validation.ok
      && contract.tools.length === DEFAULT_MAILCHIMP_TOOLS.length
      && contract.health.summary.totalTools === DEFAULT_MAILCHIMP_TOOLS.length
      && contract.analytics.exportSummary.exportCount === DEFAULT_MAILCHIMP_TOOLS.length
      && contract.workflow.summary.providerReportCount === DEFAULT_MAILCHIMP_TOOLS.length,
    validation,
    sample: contract
  });
}

export function createStdlibExportReport(contract) {
  const validation = validateStdlibContract(contract);
  return Object.freeze({
    version: STDLIB_CONTRACT_VERSION,
    kind: "aios.language.stdlib-export-report",
    ok: validation.ok,
    namespace: contract?.namespace || "unknown",
    counters: contract?.analytics?.counters || Object.freeze({ tools: 0, exports: 0 }),
    exportSummary: contract?.analytics?.exportSummary || null,
    lifecycle: contract?.analytics?.lifecycleExport || null,
    validation
  });
}

export function createStdlibWorkflowReport(contract) {
  const validation = validateStdlibContract(contract);
  const workflow = contract?.workflow || createStdlibWorkflowPreview({
    namespace: contract?.namespace || "mailchimp",
    tools: contract?.tools || [],
    runtimeContracts: contract?.runtimeContracts || [],
    health: contract?.health || Object.freeze({
      summary: Object.freeze({ status: RECOVERY_STATUS.DEGRADED, readyTools: 0, degradedTools: 0, blockedTools: 0, deniedCapabilities: 0 }),
      runtimeHealth: Object.freeze([])
    }),
    analytics: contract?.analytics || Object.freeze({ summary: Object.freeze({ nextAction: "handoff" }) }),
    validation,
    recovery: contract?.recovery
  });
  return Object.freeze({
    version: STDLIB_CONTRACT_VERSION,
    kind: "aios.language.stdlib-workflow-report",
    ok: validation.ok && workflow.acceptance.canAccept,
    namespace: contract?.namespace || workflow.namespace,
    summary: workflow.summary,
    preview: workflow.preview,
    acceptance: workflow.acceptance,
    readiness: workflow.readiness,
    providerReports: workflow.providerReports,
    validation
  });
}

function createStdlibWorkflowPreview({ namespace, tools, runtimeContracts, health, analytics, validation, recovery }) {
  const providerReports = runtimeContracts.map((runtime, index) => {
    const report = createRuntimeProviderReport(runtime);
    return Object.freeze({
      ...report,
      toolId: tools[index]?.id || `stdlib_tool_${index + 1}`,
      toolName: tools[index]?.name || report.service
    });
  });
  const blockedProviders = providerReports.filter((report) => report.status === RECOVERY_STATUS.BLOCKED || report.negotiation.missing.length > 0);
  const degradedProviders = providerReports.filter((report) => report.status === RECOVERY_STATUS.DEGRADED);
  const status = health.summary.blockedTools > 0 || blockedProviders.length > 0
    ? RECOVERY_STATUS.BLOCKED
    : health.summary.degradedTools > 0 || degradedProviders.length > 0
      ? RECOVERY_STATUS.DEGRADED
      : RECOVERY_STATUS.READY;
  const nextAction = status === RECOVERY_STATUS.BLOCKED
    ? "request-capability"
    : status === RECOVERY_STATUS.DEGRADED
      ? "handoff"
      : analytics.summary.nextAction || "continue";
  const validationSummary = Object.freeze({
    ok: Boolean(validation.ok) && blockedProviders.length === 0,
    errorCount: validation.errors.length + blockedProviders.length,
    warningCount: degradedProviders.length + health.summary.degradedTools,
    errors: Object.freeze([
      ...validation.errors,
      ...blockedProviders.map((report) => `provider missing ${report.negotiation.missing.join(", ")} for ${report.toolName}`)
    ]),
    warnings: Object.freeze(degradedProviders.map((report) => `provider degraded for ${report.toolName}`))
  });
  const preview = Object.freeze({
    namespace,
    status,
    userVisibleSummary: createStdlibUserVisibleSummary({ namespace, status, providerReports, health }),
    nextStep: Object.freeze({
      action: nextAction,
      enabled: validationSummary.ok && status !== RECOVERY_STATUS.BLOCKED,
      schedule: status === RECOVERY_STATUS.READY ? "immediate" : status === RECOVERY_STATUS.DEGRADED ? "manual-review" : "manual-approval",
      retryAfterMs: status === RECOVERY_STATUS.DEGRADED ? 2000 : 0,
      label: createStdlibNextStepLabel(nextAction)
    }),
    validation: validationSummary,
    providerTargets: Object.freeze(providerReports.map((report) => Object.freeze({
      toolId: report.toolId,
      toolName: report.toolName,
      provider: report.provider,
      service: report.service,
      status: report.status,
      endpoint: report.externalHandoff.endpoint,
      missingCapabilities: report.negotiation.missing
    })))
  });
  const acceptance = Object.freeze({
    accepted: status === RECOVERY_STATUS.READY && validationSummary.ok,
    canAccept: validationSummary.ok && status !== RECOVERY_STATUS.FAILED,
    state: validationSummary.ok ? status === RECOVERY_STATUS.READY ? "accepted" : "ready-for-acceptance" : "needs-attention",
    blockers: Object.freeze(validationSummary.errors),
    nextStep: preview.nextStep
  });
  const readinessScore = Math.max(0, 100 - (blockedProviders.length * 25) - (degradedProviders.length * 10) - (validation.errors.length * 15) - (health.summary.blockedTools * 20));
  return Object.freeze({
    version: STDLIB_CONTRACT_VERSION,
    kind: "aios.language.stdlib-workflow-preview",
    namespace,
    summary: Object.freeze({
      status,
      providerReportCount: providerReports.length,
      readyProviderCount: providerReports.filter((report) => report.status === RECOVERY_STATUS.READY).length,
      degradedProviderCount: degradedProviders.length,
      blockedProviderCount: blockedProviders.length,
      nextAction,
      handoffRequired: status !== RECOVERY_STATUS.READY || Boolean(recovery?.handoffRequired)
    }),
    providerReports: Object.freeze(providerReports),
    preview,
    acceptance,
    readiness: Object.freeze({
      status,
      ready: readinessScore >= 80 && acceptance.canAccept,
      score: readinessScore,
      validationSummary,
      nextStep: preview.nextStep,
      explain: Object.freeze([
        `tools:${tools.length}`,
        `providers:${providerReports.length}`,
        `blocked:${blockedProviders.length}`,
        `degraded:${degradedProviders.length}`
      ])
    })
  });
}

function normalizeTools(tools, namespace) {
  return Object.freeze(tools.map((tool, index) => {
    const name = normalizeToolName(tool.name || `${namespace}.tool.${index + 1}`, namespace);
    return Object.freeze({
      id: `stdlib_tool_${index + 1}`,
      name,
      capability: normalizeCapability(tool.capability || `${name}:use`, namespace),
      memory: normalizeMemory(tool.memory || `${name.replaceAll(".", "-")}-state ephemeral`, namespace),
      claim: normalizeClaim(tool.claim || `${name} requires explicit runtime verification`),
      permissions: normalizeToolPermissions(tool.permissions || tool.permission || tool.capability),
      description: String(tool.description || `${name} runtime tool`).trim()
    });
  }));
}

function toolToSource(tool) {
  return [
    `@job ${tool.name}`,
    ...tool.permissions.map((permission) => `@permission ${permission}`),
    `@capability ${tool.capability}`,
    `@memory ${tool.memory}`,
    `@claim ${tool.claim}`,
    "@verify claims>=1",
    "@verify capabilities>=1"
  ].join("\n");
}

function validateStdlibContractShape(tools, runtimeContracts, health) {
  const errors = [];
  const names = new Set();
  for (const tool of tools) {
    if (names.has(tool.name)) errors.push(`duplicate tool name: ${tool.name}`);
    names.add(tool.name);
    if (!tool.name.startsWith(`${tool.name.split(".")[0]}.`)) errors.push(`invalid tool namespace: ${tool.name}`);
  }
  for (const runtime of runtimeContracts) {
    const result = validateRuntimeContract(runtime);
    if (!result.ok) errors.push(...result.errors);
  }
  if (health.summary.blockedTools > 0) errors.push(`blocked stdlib tools: ${health.summary.blockedTools}`);
  if (health.summary.deniedCapabilities > 0) errors.push(`denied stdlib capabilities: ${health.summary.deniedCapabilities}`);
  return Object.freeze({ ok: errors.length === 0, errors });
}

function createStdlibHealthContract({ namespace, tools, runtimeContracts, adapterStatus }) {
  const runtimeHealth = runtimeContracts.map((runtime, index) => {
    const deniedCapabilities = runtime.capabilities.filter((capability) => capability.allowed !== true);
    const validation = validateRuntimeContract(runtime);
    const status = deniedCapabilities.length > 0
      ? RECOVERY_STATUS.BLOCKED
      : validation.ok
        ? runtime.status
        : RECOVERY_STATUS.DEGRADED;
    const retryAfterMs = status === RECOVERY_STATUS.RECOVERING ? 1000 * (index + 1) : 0;
    return Object.freeze({
      toolId: tools[index]?.id || `stdlib_tool_${index + 1}`,
      toolName: tools[index]?.name || runtime.job.name,
      runtimeJobId: runtime.job.id,
      status,
      actionableError: createActionableStdlibError({ runtime, validation, deniedCapabilities }),
      retry: Object.freeze({
        retryAfterMs,
        backoffMs: retryAfterMs === 0 ? 0 : Math.min(retryAfterMs * 2, 30000),
        maxAttempts: status === RECOVERY_STATUS.BLOCKED ? 0 : 3
      }),
      degradedMode: Object.freeze({
        enabled: status === RECOVERY_STATUS.DEGRADED,
        reason: status === RECOVERY_STATUS.DEGRADED ? runtime.recovery.recovery.reason : "none"
      })
    });
  });
  const blockedTools = runtimeHealth.filter((entry) => entry.status === RECOVERY_STATUS.BLOCKED).length;
  const degradedTools = runtimeHealth.filter((entry) => entry.status === RECOVERY_STATUS.DEGRADED).length;
  const deniedCapabilities = runtimeContracts.reduce((count, runtime) => {
    return count + runtime.capabilities.filter((capability) => capability.allowed !== true).length;
  }, 0);
  const adapter = createRecoveryStatus(adapterStatus || {});
  const summaryStatus = adapter.status !== RECOVERY_STATUS.READY
    ? adapter.status
    : blockedTools > 0
      ? RECOVERY_STATUS.BLOCKED
      : degradedTools > 0
        ? RECOVERY_STATUS.DEGRADED
        : RECOVERY_STATUS.READY;
  const lifecycle = createRecoveryLifecycleState({
    status: {
      status: summaryStatus,
      reason: blockedTools > 0 ? "stdlib-boundary" : degradedTools > 0 ? "stdlib-degraded" : "stdlib-ready",
      issues: runtimeHealth.map((entry) => entry.actionableError.message).filter(Boolean),
      recoverable: blockedTools === 0
    },
    controls: {
      enabled: summaryStatus !== RECOVERY_STATUS.BLOCKED,
      schedule: summaryStatus === RECOVERY_STATUS.DEGRADED ? "manual-review" : "immediate",
      maxAttempts: blockedTools > 0 ? 0 : 3
    }
  });
  return Object.freeze({
    namespace,
    summary: Object.freeze({
      status: summaryStatus,
      totalTools: tools.length,
      readyTools: runtimeHealth.filter((entry) => entry.status === RECOVERY_STATUS.READY).length,
      degradedTools,
      blockedTools,
      deniedCapabilities
    }),
    runtimeHealth: Object.freeze(runtimeHealth),
    lifecycle
  });
}

function createActionableStdlibError({ runtime, validation, deniedCapabilities }) {
  if (deniedCapabilities.length > 0) {
    return Object.freeze({
      code: "permission-boundary",
      message: `missing permission for ${deniedCapabilities.map((capability) => `${capability.name}:${capability.mode}`).join(", ")}`,
      action: "add @permission directive or pass matching permissions"
    });
  }
  if (!validation.ok) {
    return Object.freeze({
      code: "runtime-contract",
      message: validation.errors[0] || "runtime validation failed",
      action: "inspect generated runtime contract"
    });
  }
  if (runtime.status !== RECOVERY_STATUS.READY) {
    return Object.freeze({
      code: runtime.recovery.recovery.reason,
      message: runtime.recovery.recovery.issues[0] || "runtime is degraded",
      action: runtime.recovery.recovery.nextAction
    });
  }
  return Object.freeze({ code: "none", message: "", action: "continue" });
}

function createStdlibAnalyticsContract({ namespace, tools, runtimeContracts, health }) {
  const counters = createStdlibAnalyticsCounters({ tools, runtimeContracts, health });
  const history = createStdlibHistorySnapshots({ namespace, counters, health });
  const timeline = createStdlibTimeline({ namespace, tools, runtimeContracts, health, history });
  const exportSummary = createStdlibExportSummary({ namespace, tools, counters, timeline, health });
  const lifecycleExport = createStdlibLifecycleExport({ namespace, health, exportSummary });
  return Object.freeze({
    version: STDLIB_CONTRACT_VERSION,
    kind: "aios.language.stdlib-analytics",
    counters,
    history,
    timeline,
    exportSummary,
    lifecycleExport,
    summary: Object.freeze({
      namespace,
      status: health.summary.status,
      exportedTools: exportSummary.exportCount,
      readyTools: counters.readyTools,
      blockedTools: counters.blockedTools,
      nextAction: lifecycleExport.nextActionState.action
    })
  });
}

function createStdlibAnalyticsCounters({ tools, runtimeContracts, health }) {
  const runtimeCounters = runtimeContracts.map((runtime) => runtime.analytics?.counters || Object.freeze({}));
  return Object.freeze({
    tools: tools.length,
    exports: runtimeContracts.length,
    readyTools: health.summary.readyTools,
    degradedTools: health.summary.degradedTools,
    blockedTools: health.summary.blockedTools,
    deniedCapabilities: health.summary.deniedCapabilities,
    runtimeTimelineEvents: runtimeContracts.reduce((count, runtime) => count + (runtime.analytics?.timeline?.length || 0), 0),
    runtimeHistorySnapshots: runtimeContracts.reduce((count, runtime) => count + (runtime.analytics?.history?.length || 0), 0),
    claims: runtimeCounters.reduce((count, counters) => count + (counters.claims || 0), 0),
    durableMemorySlots: runtimeCounters.reduce((count, counters) => count + (counters.durableMemorySlots || 0), 0),
    auditEvents: runtimeCounters.reduce((count, counters) => count + (counters.auditEvents || 0), 0)
  });
}

function createStdlibHistorySnapshots({ namespace, counters, health }) {
  return Object.freeze([
    Object.freeze({
      sequence: 1,
      label: "tools-normalized",
      namespace,
      counters: Object.freeze({ tools: counters.tools, exports: counters.exports })
    }),
    Object.freeze({
      sequence: 2,
      label: "runtime-analytics-linked",
      namespace,
      counters: Object.freeze({
        runtimeTimelineEvents: counters.runtimeTimelineEvents,
        runtimeHistorySnapshots: counters.runtimeHistorySnapshots
      })
    }),
    Object.freeze({
      sequence: 3,
      label: "lifecycle-evaluated",
      namespace,
      status: health.summary.status,
      counters: Object.freeze({
        readyTools: counters.readyTools,
        degradedTools: counters.degradedTools,
        blockedTools: counters.blockedTools
      })
    })
  ]);
}

function createStdlibTimeline({ namespace, tools, runtimeContracts, health, history }) {
  const toolEvents = tools.map((tool, index) => Object.freeze({
    order: 10 + index,
    type: "stdlib.tool.export",
    toolId: tool.id,
    toolName: tool.name,
    runtimeJobId: runtimeContracts[index]?.job?.id || null,
    status: health.runtimeHealth[index]?.status || RECOVERY_STATUS.DEGRADED
  }));
  return Object.freeze([
    Object.freeze({
      order: 1,
      type: "stdlib.create",
      namespace,
      status: health.summary.status
    }),
    Object.freeze({
      order: 2,
      type: "stdlib.lifecycle",
      namespace,
      action: health.lifecycle.nextActionState.action,
      schedule: health.lifecycle.nextActionState.schedule
    }),
    ...toolEvents,
    ...history.map((snapshot) => Object.freeze({
      order: 100 + snapshot.sequence,
      type: `history.${snapshot.label}`,
      status: "recorded",
      counters: snapshot.counters
    }))
  ]);
}

function createStdlibExportSummary({ namespace, tools, counters, timeline, health }) {
  return Object.freeze({
    namespace,
    exports: Object.freeze(tools.map((tool) => tool.name)),
    exportCount: tools.length,
    status: health.summary.status,
    counters,
    timelineEvents: timeline.length,
    generatedAt: "deterministic-compile"
  });
}

function createStdlibLifecycleExport({ namespace, health, exportSummary }) {
  const blocked = health.summary.blockedTools > 0;
  const degraded = health.summary.degradedTools > 0;
  const action = blocked ? "request-capability" : degraded ? "handoff" : "continue";
  return Object.freeze({
    namespace,
    enabled: !blocked,
    controls: health.lifecycle.controls,
    nextActionState: Object.freeze({
      action,
      enabled: !blocked && health.lifecycle.nextActionState.enabled,
      schedule: blocked ? "manual-approval" : degraded ? "manual-review" : "immediate",
      retryAfterMs: degraded ? 2000 : 0,
      reason: blocked ? "stdlib-blocked" : degraded ? "stdlib-degraded" : "stdlib-ready"
    }),
    exportSummary
  });
}

function createStdlibRecovery(namespace, validation, health, analytics, adapterStatus) {
  const adapterRecovery = adapterStatus ? createRecoveryStatus(adapterStatus) : createRecoveryStatus();
  const stdlibRecovery = createRecoveryStatus({
    status: validation.ok ? health.summary.status : RECOVERY_STATUS.BLOCKED,
    reason: validation.ok ? "stdlib-health" : "stdlib-validation",
    issues: validation.errors,
    recoverable: validation.ok && health.summary.blockedTools === 0,
    controls: health.lifecycle.controls,
    nextAction: analytics.lifecycleExport.nextActionState.action
  });
  const selected = adapterRecovery.status === RECOVERY_STATUS.READY ? stdlibRecovery : adapterRecovery;
  return createRecoveryHandoff({
    stage: "stdlib",
    source: namespace,
    adapter: namespace,
    status: selected,
    validation,
    context: {
      subject: namespace,
      exportName: analytics.exportSummary.namespace,
      auditId: `${namespace}.stdlib.analytics`
    },
    controls: health.lifecycle.controls
  });
}

function createStdlibUserVisibleSummary({ namespace, status, providerReports, health }) {
  if (status === RECOVERY_STATUS.READY) {
    return `${namespace} tools are ready with ${providerReports.length} provider bindings`;
  }
  if (status === RECOVERY_STATUS.BLOCKED) {
    const blocked = providerReports.filter((report) => report.status === RECOVERY_STATUS.BLOCKED || report.negotiation.missing.length > 0);
    return `${namespace} tools need provider capability approval for ${blocked.length || health.summary.blockedTools} binding(s)`;
  }
  return `${namespace} tools need review before provider handoff`;
}

function createStdlibNextStepLabel(action) {
  if (action === "request-capability") return "Request Mailchimp provider capability";
  if (action === "handoff") return "Review Mailchimp provider handoff";
  if (action === "fix-settings") return "Fix stdlib settings";
  return "Continue stdlib workflow";
}

function normalizeNamespace(value) {
  return String(value || "stdlib").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "stdlib";
}

function normalizeToolName(value, namespace) {
  const dotted = String(value || "").trim().toLowerCase().replace(/[^a-z0-9.]+/g, ".").replace(/^\.+|\.+$/g, "");
  return dotted.startsWith(`${namespace}.`) ? dotted : `${namespace}.${dotted || "tool"}`;
}

function normalizeCapability(value, namespace) {
  const [name, mode = "use"] = String(value || "").split(":");
  const dotted = normalizeToolName(name || `${namespace}.capability`, namespace);
  const normalizedMode = ["read", "write", "execute", "use"].includes(mode) ? mode : "use";
  return `${dotted}:${normalizedMode}`;
}

function normalizeMemory(value, namespace) {
  const text = String(value || "").trim();
  if (!text) return `${namespace}-state ephemeral`;
  return text.replace(/[^a-zA-Z0-9=\s.-]+/g, "-");
}

function normalizeClaim(value) {
  return String(value || "verification required").trim().replace(/\s+/g, " ");
}

function normalizeToolPermissions(value) {
  const list = Array.isArray(value) ? value : [value];
  return Object.freeze([...new Set(list.flatMap((entry) => String(entry || "").split(",")).map((entry) => entry.trim().toLowerCase()).filter(Boolean))]);
}
